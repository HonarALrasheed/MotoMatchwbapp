import test from 'node:test'
import assert from 'node:assert/strict'
import { createRideStore, RideStoreError } from '../src/js/ride-store.js'

// Kleine deterministische IDB-Nachbildung: getrennte Verbindungen, serialisierte
// Transaktionen, Copy-on-write/Commit, Abbruch und injizierte Schreibfehler.
// Sie ersetzt keinen Test mit echter IndexedDB in Safari/Chromium.
class TestIndexedDB {
  databases = new Map()
  failNextWrite = false
  abortBeforeCommit = false
  blocked = false
  denied = false

  open(name) {
    if (this.denied) throw new DOMException('Speicher gesperrt', 'SecurityError')
    const request = {}
    queueMicrotask(() => {
      if (this.blocked) { request.onblocked?.(); return }
      let backend = this.databases.get(name)
      const neu = !backend
      if (!backend) {
        backend = { stores: new Map(), keyPaths: new Map(), tail: Promise.resolve() }
        this.databases.set(name, backend)
      }
      const connection = {
        objectStoreNames: { contains: (key) => backend.stores.has(key) },
        createObjectStore: (key, { keyPath }) => {
          backend.stores.set(key, new Map())
          backend.keyPaths.set(key, keyPath)
        },
        transaction: (stores, mode) => new TestTransaction(this, backend, stores, mode),
        close() {},
      }
      request.result = connection
      if (neu) request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  }
}

class TestTransaction {
  queue = []
  started = false
  stopped = false
  working = null

  constructor(factory, backend, stores, mode) {
    this.factory = factory
    this.backend = backend
    this.stores = stores
    this.mode = mode
    let release
    const current = new Promise((resolve) => { release = resolve })
    const previous = backend.tail
    backend.tail = current
    this.release = release
    previous.then(() => {
      this.started = true
      this.working = new Map([...backend.stores].map(([key, value]) =>
        [key, new Map([...value].map(([id, record]) => [id, structuredClone(record)]))]))
      queueMicrotask(() => this.pump())
    })
  }

  objectStore(name) {
    if (!this.stores.includes(name)) throw new Error('Store not in transaction')
    const enqueue = (fn) => {
      const request = {}
      this.queue.push({ fn, request })
      return request
    }
    return {
      get: (id) => enqueue(() => this.working.get(name).get(id)),
      getAll: () => enqueue(() => [...this.working.get(name).values()]),
      put: (record) => enqueue(() => this.write(name, record, false)),
      add: (record) => enqueue(() => this.write(name, record, true)),
      delete: (id) => enqueue(() => {
        this.checkWrite()
        this.working.get(name).delete(id)
      }),
    }
  }

  checkWrite() {
    if (this.mode !== 'readwrite') throw new Error('Read-only transaction')
    if (this.factory.failNextWrite) {
      this.factory.failNextWrite = false
      throw new DOMException('Speicher voll', 'QuotaExceededError')
    }
  }

  write(name, record, onlyNew) {
    this.checkWrite()
    const store = this.working.get(name)
    const id = record[this.backend.keyPaths.get(name)]
    if (onlyNew && store.has(id)) throw new DOMException('ID vorhanden', 'ConstraintError')
    store.set(id, structuredClone(record))
    return id
  }

  pump() {
    if (this.stopped) return
    if (!this.queue.length) {
      if (this.factory.abortBeforeCommit && this.mode === 'readwrite') {
        this.factory.abortBeforeCommit = false
        this.error = new Error('Unterbrochene Transaktion')
        this.abort()
        return
      }
      if (this.mode === 'readwrite') this.backend.stores = this.working
      this.stopped = true
      this.release()
      this.oncomplete?.()
      return
    }
    const { fn, request } = this.queue.shift()
    try {
      request.result = structuredClone(fn())
      request.onsuccess?.()
      queueMicrotask(() => this.pump())
    } catch (error) {
      this.error = error
      this.abort()
    }
  }

  abort() {
    if (this.stopped) return
    this.stopped = true
    if (this.started) this.release()
    queueMicrotask(() => this.onabort?.())
  }
}

function setup() {
  const indexedDB = new TestIndexedDB()
  let time = 1_000, sequence = 0
  const tab = () => createRideStore({ indexedDB, name: 'isolierte-test-fahrten',
    now: () => time, makeId: () => `uuid-${++sequence}`, leaseMs: 100 })
  return { indexedDB, tab, advance: (ms) => { time += ms } }
}

const snapshot = (n = 1) => ({ start: 1000, punkte: [[50, 8, n]] })
const track = (id) => ({ id, start: 1000, punkte: [[50, 8], [50.01, 8.01]], km: 2 })
const ride = (id) => ({ id, title: 'Ausfahrt', date: 1000, track: track(id) })
const isConflict = (error) => error instanceof RideStoreError && error.code === 'conflict'

test('zwei Aufzeichnungen behalten eigene IDs; nur ein Tab besitzt den aktiven Slot', async () => {
  const { tab, advance } = setup()
  const a = tab(), b = tab()
  const first = await a.beginRecording(snapshot(), 'ride-a')
  await assert.rejects(b.beginRecording(snapshot(), 'ride-b'), isConflict)
  advance(101)
  const second = await b.beginRecording(snapshot(2), 'ride-b')
  assert.equal(second.id, 'ride-b')
  assert.deepEqual((await b.listRecoveries()).map((r) => r.id).sort(), ['ride-a', 'ride-b'])
  await assert.rejects(a.checkpointRecording(first, snapshot(3)), isConflict)
  await assert.rejects(a.cancelRecording(first), isConflict)
  assert.deepEqual((await a.getRecovery('ride-a')).snapshot, snapshot())
})

test('abgelaufene Eigentümerschaft wird nach Absturz mit neuer Generation uebernommen', async () => {
  const { tab, advance } = setup()
  const old = tab(), fresh = tab()
  const first = await old.beginRecording(snapshot(), 'ride-a')
  old.close()
  await assert.rejects(fresh.resumeRecording('ride-a', first.revision), isConflict)
  advance(101)
  const resumed = await fresh.resumeRecording('ride-a', first.revision)
  assert.ok(resumed.generation > first.generation)
  assert.notEqual(resumed.ownerToken, first.ownerToken)
  await assert.rejects(old.finishRecording(first, track('ride-a')), isConflict)
  const updated = await fresh.checkpointRecording(resumed, snapshot(2))
  await assert.rejects(fresh.checkpointRecording(resumed, snapshot(3)), isConflict)
  assert.equal((await fresh.getRecovery('ride-a')).revision, updated.revision)
})

test('falsches Eigentuer-Token oder falsche Generation wird trotz passender Revision abgelehnt', async () => {
  const { tab } = setup()
  const store = tab()
  const active = await store.beginRecording(snapshot(), 'ride-a')
  await assert.rejects(store.checkpointRecording({ ...active, ownerToken: 'alter-tab' }, snapshot(2)), isConflict)
  await assert.rejects(store.cancelRecording({ ...active, generation: active.generation + 1 }), isConflict)
  assert.deepEqual((await store.getRecovery('ride-a')).snapshot, snapshot())
})

test('fertige ungespeicherte Fahrt bleibt erhalten und wird nur passend atomar gespeichert', async () => {
  const { tab } = setup()
  const a = tab(), b = tab()
  const first = await a.beginRecording(snapshot(), 'ride-a')
  const completed = await a.finishRecording(first, track('ride-a'))
  const other = await b.beginRecording(snapshot(2), 'ride-b')
  await assert.rejects(a.discardCompleted('ride-a', first.revision), isConflict)
  const saved = await b.saveCompleted('ride-a', completed.revision, ride('ride-a'))
  assert.equal(saved.revision, 1)
  assert.equal(await a.getRecovery('ride-a'), null)
  assert.equal((await a.getRecovery('ride-b')).id, other.id)
  assert.equal((await a.listRides()).length, 1)
  assert.deepEqual(await b.saveCompleted('ride-a', completed.revision, ride('ride-a')), saved)
})

test('Abbruch vor Commit und Schreibfehler lassen fertige Recovery unangetastet', async () => {
  const { tab, indexedDB } = setup()
  const store = tab()
  const first = await store.beginRecording(snapshot(), 'ride-a')
  const completed = await store.finishRecording(first, track('ride-a'))
  indexedDB.abortBeforeCommit = true
  await assert.rejects(store.saveCompleted('ride-a', completed.revision, ride('ride-a')),
    (error) => error.code === 'failed')
  assert.equal(await store.getRide('ride-a'), null)
  assert.equal((await store.getRecovery('ride-a')).state, 'completed')
  indexedDB.failNextWrite = true
  await assert.rejects(store.saveCompleted('ride-a', completed.revision, ride('ride-a')),
    (error) => error.code === 'quota')
  assert.equal(await store.getRide('ride-a'), null)
  assert.equal((await store.getRecovery('ride-a')).state, 'completed')
  store.close()
  const reopened = tab()
  assert.equal((await reopened.getRecovery('ride-a')).state, 'completed')
  assert.equal((await reopened.saveCompleted('ride-a', completed.revision, ride('ride-a'))).id, 'ride-a')
})

test('unterbrochener Abschluss bleibt nach Wiedereroeffnen als aktive Fahrt recoverbar', async () => {
  const { tab, indexedDB, advance } = setup()
  const firstTab = tab()
  const active = await firstTab.beginRecording(snapshot(), 'ride-a')
  indexedDB.abortBeforeCommit = true
  await assert.rejects(firstTab.finishRecording(active, track('ride-a')),
    (error) => error.code === 'failed')
  firstTab.close()
  const nextTab = tab()
  assert.equal((await nextTab.getRecovery('ride-a')).state, 'active')
  advance(101)
  const resumed = await nextTab.resumeRecording('ride-a', active.revision)
  assert.equal((await nextTab.finishRecording(resumed, track('ride-a'))).state, 'completed')
})

test('fehlgeschlagener Checkpoint veraendert weder Recovery noch Revision', async () => {
  const { tab, indexedDB } = setup()
  const store = tab()
  const active = await store.beginRecording(snapshot(), 'ride-a')
  indexedDB.failNextWrite = true
  await assert.rejects(store.checkpointRecording(active, snapshot(2)),
    (error) => error.code === 'quota')
  assert.equal((await store.getRecovery('ride-a')).revision, active.revision)
  assert.deepEqual((await store.getRecovery('ride-a')).snapshot, snapshot())
  assert.equal((await store.checkpointRecording(active, snapshot(2))).revision, active.revision + 1)
})

test('parallele Fahrtenbuch-Aenderungen erkennen Revisionen und tombstones', async () => {
  const { tab } = setup()
  const a = tab(), b = tab()
  const [one, two] = await Promise.all([
    a.createRide({ id: 'manual-a', title: 'A' }),
    b.createRide({ id: 'manual-b', title: 'B' }),
  ])
  assert.deepEqual((await a.listRides()).map((r) => r.id).sort(), ['manual-a', 'manual-b'])
  const edited = await a.replaceRide(one.id, one.revision, { id: one.id, title: 'Neu' })
  await assert.rejects(b.replaceRide(one.id, one.revision, { id: one.id, title: 'Alt' }), isConflict)
  await assert.rejects(b.deleteRide(one.id, one.revision), isConflict)
  assert.equal(await b.deleteRide(one.id, edited.revision), true)
  assert.equal(await a.getRide(one.id), null)
  await assert.rejects(a.createRide({ id: one.id, title: 'Wiederbelebt' }), isConflict)
  assert.equal((await b.getRide(two.id)).title, 'B')
})

test('gleichzeitiges Bearbeiten und Loeschen derselben Fahrt hat nur einen Gewinner', async () => {
  const { tab } = setup()
  const a = tab(), b = tab()
  const original = await a.createRide({ id: 'manual-a', title: 'Original' })
  const results = await Promise.allSettled([
    a.replaceRide(original.id, original.revision, { id: original.id, title: 'Neu' }),
    b.deleteRide(original.id, original.revision),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter((r) => r.status === 'rejected' && isConflict(r.reason)).length, 1)
  const surviving = await a.getRide(original.id)
  assert.ok(surviving === null || surviving.title === 'Neu')
})

test('konkurrierende Starts mit derselben ID lassen nur einen Eigentuer zu', async () => {
  const { tab } = setup()
  const a = tab(), b = tab()
  const results = await Promise.allSettled([
    a.beginRecording(snapshot(), 'same-id'), b.beginRecording(snapshot(2), 'same-id'),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter((r) => r.status === 'rejected' && isConflict(r.reason)).length, 1)
  assert.equal((await a.listRecoveries()).length, 1)
})

test('eine gespeicherte oder geloeschte Fahrten-ID wird nie als neue Aufzeichnung wiederverwendet', async () => {
  const { tab } = setup()
  const store = tab()
  const saved = await store.createRide({ id: 'manual-a', title: 'Alt' })
  await assert.rejects(store.beginRecording(snapshot(), 'manual-a'), isConflict)
  await store.deleteRide(saved.id, saved.revision)
  await assert.rejects(store.beginRecording(snapshot(), 'manual-a'), isConflict)
  assert.deepEqual(await store.listRecoveries(), [])
})

test('manuelle Fahrt kann keine ID einer ungespeicherten Aufzeichnung belegen', async () => {
  const { tab } = setup()
  const store = tab()
  const active = await store.beginRecording(snapshot(), 'ride-a')
  const completed = await store.finishRecording(active, track('ride-a'))
  await assert.rejects(store.createRide({ id: 'ride-a', title: 'Kollision' }), isConflict)
  assert.equal((await store.getRecovery('ride-a')).revision, completed.revision)
  assert.equal(await store.getRide('ride-a'), null)
})

test('fertige Fahrt kann nur mit der angezeigten Revision verworfen werden', async () => {
  const { tab } = setup()
  const store = tab()
  const active = await store.beginRecording(snapshot(), 'ride-a')
  const completed = await store.finishRecording(active, track('ride-a'))
  await assert.rejects(store.discardCompleted('ride-a', active.revision), isConflict)
  assert.equal((await store.getRecovery('ride-a')).state, 'completed')
  assert.equal(await store.discardCompleted('ride-a', completed.revision), true)
  assert.equal(await store.getRecovery('ride-a'), null)
})

test('nicht verfuegbarer oder verweigerter Speicher liefert explizite Fehler', async () => {
  await assert.rejects(createRideStore({ indexedDB: null }).listRides(),
    (error) => error.code === 'unavailable')
  const denied = new TestIndexedDB()
  denied.denied = true
  await assert.rejects(createRideStore({ indexedDB: denied }).listRides(),
    (error) => error.code === 'denied')
  const blocked = new TestIndexedDB()
  blocked.blocked = true
  await assert.rejects(createRideStore({ indexedDB: blocked }).listRides(),
    (error) => error.code === 'blocked')
})

test('Phase 1 liest und schreibt keinen Legacy-localStorage-Schluessel', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { throw new Error('Legacy-Speicher gelesen') },
    setItem() { throw new Error('Legacy-Speicher veraendert') },
    removeItem() { throw new Error('Legacy-Speicher geloescht') },
  } })
  try {
    const { tab } = setup()
    const store = tab()
    const active = await store.beginRecording(snapshot(), 'ride-a')
    await store.cancelRecording(active)
    assert.equal((await store.listRecoveries()).length, 0)
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before)
    else delete globalThis.localStorage
  }
})
