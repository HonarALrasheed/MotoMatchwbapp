import test from 'node:test'
import assert from 'node:assert/strict'
import { createRideMigration, RideMigrationError } from '../src/js/ride-store-migration.js'

const active = { id: 'aufnahme-1', start: 1000, meter: 200, fahrMs: 300,
  punkte: [[50, 8, 1000, null, 0], [50.01, 8.01, 2000, 120, 1]] }
const completed = { fertig: true, track: { id: 'aufnahme-2', start: 1000, ende: 2000,
  punkte: [[50, 8, 1000, null], [50.01, 8.01, 2000, 120]] } }
const saved = { id: 'tagebuch-1', date: 1000, title: 'Fahrt', notes: 'Notiz',
  track: { ...completed.track, id: 'anderer-track' } }

function legacy(values) {
  const data = new Map(Object.entries(values))
  return { getItem: (key) => data.get(key) ?? null,
    setItem: () => { throw new Error('Legacy-Daten duerfen nicht geaendert werden') },
    removeItem: () => { throw new Error('Legacy-Daten duerfen nicht geloescht werden') } }
}

test('erkennt gespeicherte Fahrt mit eigenstaendiger Track-ID und aktive Recovery', () => {
  const migration = createRideMigration({ storage: legacy({
    mm_rides_v1: JSON.stringify([saved, { id: 'manuell-1', track: null }]),
    mm_ride_track_active_v1: JSON.stringify(active),
  }) })
  assert.deepEqual(migration.inspectLegacy(), {
    candidates: [
      { source: 'mm_rides_v1', id: 'tagebuch-1', kind: 'ride' },
      { source: 'mm_rides_v1', id: 'manuell-1', kind: 'ride' },
      { source: 'mm_ride_track_active_v1', id: 'aufnahme-1', kind: 'recovery' },
    ], invalid: [],
  })
})

test('erkennt fertige, noch nicht gespeicherte Recovery', () => {
  assert.deepEqual(createRideMigration({ storage: legacy({
    mm_ride_track_active_v1: JSON.stringify(completed),
  }) }).inspectLegacy().candidates,
  [{ source: 'mm_ride_track_active_v1', id: 'aufnahme-2', kind: 'recovery' }])
})

test('markiert doppelte IDs und unvollstaendige Eintraege ohne gueltige Eintraege zu verlieren', () => {
  const inspection = createRideMigration({ storage: legacy({
    mm_rides_v1: JSON.stringify([saved, saved, { id: 'ohne-track', track: { id: 't', punkte: [] } },
      { id: 'gut', track: null }]),
  }) }).inspectLegacy()
  assert.deepEqual(inspection.candidates, [{ source: 'mm_rides_v1', id: 'gut', kind: 'ride' }])
  assert.deepEqual(inspection.invalid.map((item) => item.reason),
    ['duplicate_legacy_id', 'duplicate_legacy_id', 'incomplete_ride'])
})

test('meldet defektes JSON, fehlende Pflichtdaten und gesperrtes Lesen explizit', () => {
  const migration = createRideMigration({ storage: legacy({
    mm_rides_v1: '{', mm_ride_track_active_v1: JSON.stringify({ id: 'x', punkte: [] }),
  }) })
  assert.deepEqual(migration.inspectLegacy().invalid.map((item) => item.reason),
    ['malformed_json', 'incomplete_recovery'])
  const denied = createRideMigration({ storage: {
    getItem: () => { throw new DOMException('Gesperrt', 'SecurityError') },
  } })
  assert.deepEqual(denied.inspectLegacy().invalid.map((item) => item.reason),
    ['read_failed', 'read_failed'])
})

test('verweigert Import ohne IndexedDB und laesst Legacy-Werte unveraendert', async () => {
  const storage = legacy({ mm_rides_v1: JSON.stringify([saved]) })
  const migration = createRideMigration({ storage, indexedDB: null })
  await assert.rejects(migration.importLegacy(),
    (error) => error instanceof RideMigrationError && error.code === 'unavailable')
  assert.equal(storage.getItem('mm_rides_v1'), JSON.stringify([saved]))
})
