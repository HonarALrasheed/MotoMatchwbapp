/* Manuell aufrufbarer Phase-2A-Adapter. Keine Runtime-Imports und keine
   Schreibzugriffe auf mm_rides_v1 oder mm_ride_track_active_v1. */

const DB_VERSION = 1
const DB_NAME = 'motomatch-rides-v1'
const RIDES_KEY = 'mm_rides_v1'
const RECOVERY_KEY = 'mm_ride_track_active_v1'

export class RideMigrationError extends Error {
  constructor(code, cause) {
    super('Die Fahrtdaten-Migration konnte nicht abgeschlossen werden.', cause ? { cause } : undefined)
    this.name = 'RideMigrationError'
    this.code = code
  }
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const idValid = (id) => typeof id === 'string' && !!id.trim() && id.length <= 128
const number = (value) => typeof value === 'number' && Number.isFinite(value)
const point = (p) => Array.isArray(p) && p.length >= 2 && number(p[0]) && Math.abs(p[0]) <= 90 &&
  number(p[1]) && Math.abs(p[1]) <= 180 && (p[2] === undefined || number(p[2])) &&
  (p[3] == null || number(p[3]))
const trackValid = (track) => object(track) && idValid(track.id) &&
  Array.isArray(track.punkte) && track.punkte.length > 0 && track.punkte.every(point)

// Nur die vom aktuellen Speicherformat benoetigten Mindestfelder erzwingen.
// Optionale Metadaten und alle GPS-Punkte werden unveraendert uebernommen.
function rideValid(ride) {
  return object(ride) && idValid(ride.id) &&
    !Object.prototype.hasOwnProperty.call(ride, 'revision') &&
    !Object.prototype.hasOwnProperty.call(ride, 'deleted') &&
    (ride.track == null || trackValid(ride.track))
}

function recoveryValid(value) {
  if (!object(value)) return false
  if (value.fertig === true) return trackValid(value.track)
  return idValid(value.id) && number(value.start) && Array.isArray(value.punkte) &&
    value.punkte.length > 0 && value.punkte.every((p) => point(p) && p.length >= 3 &&
      (p[4] === undefined || p[4] === 0 || p[4] === 1))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!object(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

function storageError(error) {
  if (error instanceof RideMigrationError) return error
  const code = error?.name === 'SecurityError' || error?.name === 'NotAllowedError' ? 'denied'
    : error?.name === 'VersionError' ? 'version' : error?.name === 'QuotaExceededError' ? 'quota' : 'failed'
  return new RideMigrationError(code, error)
}

function parseLegacy(storage) {
  const raw = {}, candidates = [], results = []
  for (const key of [RIDES_KEY, RECOVERY_KEY]) {
    try { raw[key] = storage.getItem(key) }
    catch { raw[key] = undefined; results.push({ source: key, id: null, status: 'invalid', reason: 'read_failed' }) }
  }

  if (raw[RIDES_KEY] !== undefined && raw[RIDES_KEY] !== null) {
    let rides
    try { rides = JSON.parse(raw[RIDES_KEY]) }
    catch { results.push({ source: RIDES_KEY, id: null, status: 'invalid', reason: 'malformed_json' }) }
    if (rides !== undefined) {
      if (!Array.isArray(rides)) results.push({ source: RIDES_KEY, id: null, status: 'invalid', reason: 'not_array' })
      else {
        const counts = new Map()
        for (const ride of rides) if (idValid(ride?.id)) counts.set(ride.id, (counts.get(ride.id) || 0) + 1)
        for (const ride of rides) {
          const id = idValid(ride?.id) ? ride.id : null
          if (!rideValid(ride)) results.push({ source: RIDES_KEY, id, status: 'invalid', reason: 'incomplete_ride' })
          else if (counts.get(id) !== 1) results.push({ source: RIDES_KEY, id, status: 'invalid', reason: 'duplicate_legacy_id' })
          else candidates.push({ source: RIDES_KEY, id, kind: 'ride', value: ride })
        }
      }
    }
  }

  if (raw[RECOVERY_KEY] !== undefined && raw[RECOVERY_KEY] !== null) {
    let recovery
    try { recovery = JSON.parse(raw[RECOVERY_KEY]) }
    catch { results.push({ source: RECOVERY_KEY, id: null, status: 'invalid', reason: 'malformed_json' }) }
    if (recovery !== undefined) {
      const id = recovery?.fertig === true ? recovery.track?.id : recovery?.id
      if (!recoveryValid(recovery)) results.push({ source: RECOVERY_KEY,
        id: idValid(id) ? id : null, status: 'invalid', reason: 'incomplete_recovery' })
      else candidates.push({ source: RECOVERY_KEY, id, kind: 'recovery', value: recovery })
    }
  }
  return { raw, candidates, results }
}

function openDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    if (!indexedDB?.open) { reject(new RideMigrationError('unavailable')); return }
    let request, settled = false
    try { request = indexedDB.open(name, DB_VERSION) }
    catch (error) { reject(storageError(error)); return }
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return }
      const db = request.result
      if (!db.objectStoreNames.contains('recoveries')) db.createObjectStore('recoveries', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('rides')) db.createObjectStore('rides', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onerror = () => { if (!settled) { settled = true; reject(storageError(request.error)) } }
    request.onblocked = () => { if (!settled) { settled = true; reject(new RideMigrationError('blocked')) } }
    request.onsuccess = () => {
      if (settled) { request.result.close(); return }
      settled = true
      resolve(request.result)
    }
  })
}

function importOne(db, candidate) {
  return new Promise((resolve, reject) => {
    let tx, result
    try { tx = db.transaction(['rides', 'recoveries'], 'readwrite') }
    catch (error) { reject(storageError(error)); return }
    const storeName = candidate.kind === 'ride' ? 'rides' : 'recoveries'
    const otherName = candidate.kind === 'ride' ? 'recoveries' : 'rides'
    const current = tx.objectStore(storeName).get(candidate.id)
    const others = tx.objectStore(otherName).getAll()
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(storageError(tx.error))
    others.onsuccess = () => {
      const cross = candidate.kind === 'ride'
        ? others.result.some((r) => r.id === candidate.id || (candidate.value.track?.id && r.id === candidate.value.track.id))
        : others.result.some((r) => r.id === candidate.id || (!r.deleted && r.track?.id === candidate.id))
      if (cross) { result = { status: 'conflicted', reason: 'other_store_id' }; return }
      const existing = current.result
      if (existing) {
        let equal = false
        if (candidate.kind === 'ride' && !existing.deleted) {
          const { revision, deleted, ...storedRide } = existing
          equal = same(storedRide, candidate.value)
        } else if (candidate.kind === 'recovery' && existing.revision === 1) {
          equal = candidate.value.fertig === true
            ? existing.state === 'completed' && same(existing.track, candidate.value.track)
            : existing.state === 'active' && existing.ownerToken == null &&
              existing.generation === 0 && same(existing.snapshot, candidate.value)
        }
        result = { status: equal ? 'skipped' : 'conflicted', reason: equal ? 'identical' : 'different_record' }
        return
      }
      const value = candidate.value
      const record = candidate.kind === 'ride'
        ? { ...value, revision: 1, deleted: false }
        : value.fertig === true
          ? { id: candidate.id, state: 'completed', revision: 1, track: value.track,
            updatedAt: number(value.track.ende) ? value.track.ende : (number(value.track.start) ? value.track.start : 0) }
          : { id: candidate.id, state: 'active', revision: 1, generation: 0,
            ownerToken: null, snapshot: value, updatedAt: value.start }
      tx.objectStore(storeName).add(record)
      result = { status: 'imported' }
    }
  })
}

function readSnapshot(db) {
  return new Promise((resolve, reject) => {
    let tx, rides, recoveries
    try { tx = db.transaction(['rides', 'recoveries'], 'readonly') }
    catch (error) { reject(storageError(error)); return }
    const rideRequest = tx.objectStore('rides').getAll()
    const recoveryRequest = tx.objectStore('recoveries').getAll()
    rideRequest.onsuccess = () => { rides = rideRequest.result }
    recoveryRequest.onsuccess = () => { recoveries = recoveryRequest.result }
    tx.oncomplete = () => resolve({ rides, recoveries })
    tx.onabort = () => reject(storageError(tx.error))
  })
}

/** Ausschliesslich manuelle Aufrufe; der Adapter wird nicht vom App-Start geladen. */
export function createRideMigration({ indexedDB = globalThis.indexedDB,
  storage, name = DB_NAME } = {}) {
  const legacy = () => storage === undefined ? globalThis.localStorage : storage
  const readLegacy = () => {
    try { return legacy() }
    catch (error) { throw storageError(error) }
  }
  return {
    inspectLegacy() {
      const parsed = parseLegacy(readLegacy())
      return { candidates: parsed.candidates.map(({ source, id, kind }) => ({ source, id, kind })),
        invalid: parsed.results }
    },
    async importLegacy() {
      const parsed = parseLegacy(readLegacy())
      const results = [...parsed.results]
      if (parsed.candidates.length) {
        const db = await openDatabase(indexedDB, name)
        try {
          for (const candidate of parsed.candidates) {
            try {
              const outcome = await importOne(db, candidate)
              results.push({ source: candidate.source, id: candidate.id, ...outcome })
            } catch (error) {
              results.push({ source: candidate.source, id: candidate.id, status: 'failed',
                reason: storageError(error).code })
              break // spaetere Wiederholung prueft bereits importierte Eintraege erneut
            }
          }
        } finally { db.close() }
      }
      for (const key of [RIDES_KEY, RECOVERY_KEY]) {
        if (parsed.raw[key] === undefined) continue
        try {
          if (readLegacy().getItem(key) !== parsed.raw[key]) results.push({ source: key, id: null,
            status: 'conflicted', reason: 'legacy_changed_during_import' })
        } catch { results.push({ source: key, id: null, status: 'failed', reason: 'legacy_recheck_failed' }) }
      }
      return results
    },
    async importLegacyRecovery() {
      const parsed = parseLegacy(readLegacy())
      const results = parsed.results.filter((item) => item.source === RECOVERY_KEY)
      const candidates = parsed.candidates.filter((item) => item.kind === 'recovery')
      if (parsed.raw[RECOVERY_KEY] != null &&
          !results.length && !candidates.length) {
        results.push({ source: RECOVERY_KEY, id: null, status: 'invalid', reason: 'incomplete_recovery' })
      }
      if (candidates.length) {
        const db = await openDatabase(indexedDB, name)
        try {
          for (const candidate of candidates) {
            try {
              results.push({ source: RECOVERY_KEY, id: candidate.id,
                ...await importOne(db, candidate) })
            } catch (error) {
              results.push({ source: RECOVERY_KEY, id: candidate.id, status: 'failed',
                reason: storageError(error).code })
              break
            }
          }
        } finally { db.close() }
      }
      try {
        if (readLegacy().getItem(RECOVERY_KEY) !== parsed.raw[RECOVERY_KEY]) {
          results.push({ source: RECOVERY_KEY, id: null, status: 'conflicted', reason: 'legacy_changed_during_import' })
        }
      } catch { results.push({ source: RECOVERY_KEY, id: null, status: 'failed', reason: 'legacy_recheck_failed' }) }
      return results
    },
    async exportJson() {
      const db = await openDatabase(indexedDB, name)
      try {
        const { rides, recoveries } = await readSnapshot(db)
        // Enthält auch Tombstones und fertige, ungespeicherte Aufzeichnungen.
        // Der Aufrufer entscheidet ueber Download/Speicherort; nichts wird geloggt.
        return JSON.stringify({ format: 'motomatch-ride-store-v1', rides, recoveries })
      } finally { db.close() }
    },
  }
}
