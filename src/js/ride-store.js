/* Isolierte IndexedDB-Grundlage fuer Fahrten. Phase 1: kein Import aus
   localStorage und keine Verbindung zu Recorder, Profil oder Navigation.
   recoveries: ein Datensatz pro Aufnahme (active oder completed).
   rides: ein Datensatz pro Fahrt; geloeschte IDs bleiben als Tombstone.
   meta/active: genau ein Besitzer mit Token, Generation und Ablaufzeit.
   Alle Pruefungen und ihre Schreibvorgaenge liegen in derselben Transaktion. */

const VERSION = 1
const DEFAULT_NAME = 'motomatch-rides-v1'
const DEFAULT_LEASE_MS = 45_000

export class RideStoreError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'RideStoreError'
    this.code = code
  }
}

const konflikt = () => new RideStoreError('conflict', 'Der Fahrtenstand wurde in einem anderen Tab geaendert.')
const fehlt = () => new RideStoreError('not_found', 'Die Fahrt oder Wiederherstellung wurde nicht gefunden.')
const ungueltig = () => new RideStoreError('invalid', 'Ungueltige Fahrtdaten oder Versionsangabe.')

function speicherFehler(error) {
  if (error instanceof RideStoreError) return error
  const code = error?.name === 'QuotaExceededError' ? 'quota'
    : error?.name === 'SecurityError' || error?.name === 'NotAllowedError' ? 'denied' : 'failed'
  return new RideStoreError(code, 'Der Fahrtspeicher konnte nicht verwendet werden.', error)
}

function pruefeId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 128) throw ungueltig()
}

function pruefeRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw ungueltig()
}

function pruefeObjekt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw ungueltig()
}

function zufallsId() {
  const crypto = globalThis.crypto
  if (crypto?.randomUUID) return crypto.randomUUID()
  if (!crypto?.getRandomValues) throw new RideStoreError('unavailable', 'Sichere Zufalls-IDs sind nicht verfuegbar.')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// work() legt Requests synchron an. Weitere Requests duerfen nur in deren
// onsuccess-Callbacks folgen; ein fremdes await wuerde die Transaktion schliessen.
function transact(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    let tx
    try { tx = db.transaction(stores, mode) }
    catch (error) { reject(speicherFehler(error)); return }
    let result, expectedError
    const fail = (error) => {
      expectedError = error
      try { tx.abort() } catch { reject(speicherFehler(error)) }
    }
    const read = (store, key, next) => {
      const req = tx.objectStore(store).get(key)
      req.onsuccess = () => { try { next(req.result) } catch (error) { fail(error) } }
    }
    const readAll = (store, next) => {
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () => { try { next(req.result) } catch (error) { fail(error) } }
    }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(expectedError ? speicherFehler(expectedError) : speicherFehler(tx.error))
    try {
      work({ store: (name) => tx.objectStore(name), read, readAll, fail,
        setResult: (value) => { result = value } })
    } catch (error) { fail(error) }
  })
}

/** Eine Instanz pro Tab ist moeglich; die Datenbank koordiniert alle Instanzen. */
export function createRideStore({ indexedDB = globalThis.indexedDB, name = DEFAULT_NAME,
  now = () => Date.now(), makeId = zufallsId, leaseMs = DEFAULT_LEASE_MS } = {}) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw ungueltig()
  let dbPromise = null

  function open() {
    if (dbPromise) return dbPromise
    if (!indexedDB?.open) return Promise.reject(new RideStoreError('unavailable', 'IndexedDB ist nicht verfuegbar.'))
    const promise = new Promise((resolve, reject) => {
      let request, settled = false
      try { request = indexedDB.open(name, VERSION) }
      catch (error) { reject(speicherFehler(error)); return }
      request.onupgradeneeded = () => {
        if (settled) { request.transaction?.abort(); return }
        const db = request.result
        if (!db.objectStoreNames.contains('recoveries')) db.createObjectStore('recoveries', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('rides')) db.createObjectStore('rides', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      }
      request.onerror = () => { if (!settled) { settled = true; reject(speicherFehler(request.error)) } }
      request.onblocked = () => { if (!settled) { settled = true; reject(new RideStoreError('blocked', 'Ein anderer Tab blockiert den Fahrtspeicher.')) } }
      request.onsuccess = () => {
        if (settled) { request.result.close(); return }
        settled = true
        const db = request.result
        db.onversionchange = () => { db.close(); if (dbPromise === promise) dbPromise = null }
        resolve(db)
      }
    })
    dbPromise = promise
    promise.catch(() => { if (dbPromise === promise) dbPromise = null })
    return promise
  }

  async function run(stores, mode, work) {
    return transact(await open(), stores, mode, work)
  }

  function owned(t, handle, next) {
    t.read('meta', 'active', (owner) => t.read('recoveries', handle.id, (record) => {
      if (!owner || owner.id !== handle.id || owner.ownerToken !== handle.ownerToken ||
          owner.generation !== handle.generation || !record || record.state !== 'active' ||
          record.ownerToken !== handle.ownerToken || record.generation !== handle.generation ||
          record.revision !== handle.revision) { t.fail(konflikt()); return }
      next(owner, record)
    }))
  }

  function pruefeHandle(handle) {
    pruefeObjekt(handle)
    pruefeId(handle.id)
    pruefeId(handle.ownerToken)
    pruefeRevision(handle.revision)
    pruefeRevision(handle.generation)
  }

  return {
    async beginRecording(snapshot, id = makeId()) {
      pruefeObjekt(snapshot); pruefeId(id)
      const ownerToken = makeId()
      pruefeId(ownerToken)
      return run(['meta', 'recoveries', 'rides'], 'readwrite', (t) => {
        t.read('meta', 'active', (owner) => {
          if (owner?.id && owner.leaseUntil > now()) { t.fail(konflikt()); return }
          t.read('recoveries', id, (existing) => {
            if (existing) { t.fail(konflikt()); return }
            t.read('rides', id, (saved) => {
              if (saved) { t.fail(konflikt()); return }
              const generation = (owner?.generation || 0) + 1
              const record = { id, state: 'active', revision: 1, generation, ownerToken,
                snapshot, updatedAt: now() }
              t.store('meta').put({ key: 'active', id, ownerToken, generation,
                leaseUntil: now() + leaseMs })
              t.store('recoveries').add(record)
              t.setResult(record)
            })
          })
        })
      })
    },

    async resumeRecording(id, expectedRevision, metadata = {}) {
      pruefeId(id); pruefeRevision(expectedRevision)
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
          (metadata.legacyDigest != null && !/^[0-9a-f]{8}$/.test(metadata.legacyDigest))) throw ungueltig()
      const ownerToken = makeId()
      pruefeId(ownerToken)
      return run(['meta', 'recoveries'], 'readwrite', (t) => {
        t.read('meta', 'active', (owner) => {
          if (owner?.id && owner.leaseUntil > now()) { t.fail(konflikt()); return }
          t.read('recoveries', id, (record) => {
            if (!record) { t.fail(fehlt()); return }
            if (record.state !== 'active' || record.revision !== expectedRevision) { t.fail(konflikt()); return }
            const generation = (owner?.generation || 0) + 1
            const resumed = { ...record, ...metadata, ownerToken, generation, revision: record.revision + 1, updatedAt: now() }
            t.store('meta').put({ key: 'active', id, ownerToken, generation,
              leaseUntil: now() + leaseMs })
            t.store('recoveries').put(resumed)
            t.setResult(resumed)
          })
        })
      })
    },

    async checkpointRecording(handle, snapshot) {
      pruefeHandle(handle); pruefeObjekt(snapshot)
      return run(['meta', 'recoveries'], 'readwrite', (t) => {
        owned(t, handle, (owner, record) => {
          const updated = { ...record, snapshot, revision: record.revision + 1, updatedAt: now() }
          t.store('meta').put({ ...owner, leaseUntil: now() + leaseMs })
          t.store('recoveries').put(updated)
          t.setResult(updated)
        })
      })
    },

    async finishRecording(handle, track) {
      pruefeHandle(handle); pruefeObjekt(track)
      if (track.id !== handle.id) throw ungueltig()
      return run(['meta', 'recoveries'], 'readwrite', (t) => {
        owned(t, handle, (owner, record) => {
          const completed = { id: record.id, state: 'completed', revision: record.revision + 1,
            ...(record.legacyDigest ? { legacyDigest: record.legacyDigest } : {}),
            track, updatedAt: now() }
          t.store('recoveries').put(completed)
          t.store('meta').put({ key: 'active', id: null, ownerToken: null,
            generation: owner.generation, leaseUntil: 0 })
          t.setResult(completed)
        })
      })
    },

    async cancelRecording(handle) {
      pruefeHandle(handle)
      return run(['meta', 'recoveries'], 'readwrite', (t) => {
        owned(t, handle, (owner) => {
          t.store('recoveries').delete(handle.id)
          t.store('meta').put({ key: 'active', id: null, ownerToken: null,
            generation: owner.generation, leaseUntil: 0 })
          t.setResult(true)
        })
      })
    },

    async discardCompleted(id, expectedRevision) {
      pruefeId(id); pruefeRevision(expectedRevision)
      return run(['recoveries'], 'readwrite', (t) => {
        t.read('recoveries', id, (record) => {
          if (!record) { t.fail(fehlt()); return }
          if (record.state !== 'completed' || record.revision !== expectedRevision) { t.fail(konflikt()); return }
          t.store('recoveries').delete(id)
          t.setResult(true)
        })
      })
    },

    async saveCompleted(id, expectedRevision, ride) {
      pruefeId(id); pruefeRevision(expectedRevision); pruefeObjekt(ride)
      if (ride.id !== id || ride.track?.id !== id) throw ungueltig()
      return run(['recoveries', 'rides'], 'readwrite', (t) => {
        t.read('recoveries', id, (record) => t.read('rides', id, (saved) => {
          if (!record) {
            // Antwort nach Commit verloren: dieselbe gespeicherte ID zurueckgeben,
            // aber niemals einen neuen Inhalt ueber die vorhandene Fahrt schreiben.
            if (saved && !saved.deleted && saved.track?.id === id) { t.setResult(saved); return }
            t.fail(fehlt()); return
          }
          if (record.state !== 'completed' || record.revision !== expectedRevision || saved) {
            t.fail(konflikt()); return
          }
          const stored = { ...ride, id, revision: 1, deleted: false }
          t.store('rides').add(stored)
          t.store('recoveries').delete(id)
          t.setResult(stored)
        }))
      })
    },

    async createRide(ride) {
      pruefeObjekt(ride); pruefeId(ride.id)
      const stored = { ...ride, revision: 1, deleted: false }
      return run(['rides', 'recoveries'], 'readwrite', (t) => {
        t.read('rides', ride.id, (existing) => {
          if (existing) { t.fail(konflikt()); return }
          t.read('recoveries', ride.id, (recovery) => {
            if (recovery) { t.fail(konflikt()); return }
            t.store('rides').add(stored)
            t.setResult(stored)
          })
        })
      })
    },

    async replaceRide(id, expectedRevision, ride) {
      pruefeId(id); pruefeRevision(expectedRevision); pruefeObjekt(ride)
      if (ride.id !== id) throw ungueltig()
      return run(['rides'], 'readwrite', (t) => {
        t.read('rides', id, (old) => {
          if (!old || old.deleted || old.revision !== expectedRevision) { t.fail(konflikt()); return }
          const updated = { ...ride, id, revision: old.revision + 1, deleted: false }
          t.store('rides').put(updated)
          t.setResult(updated)
        })
      })
    },

    async deleteRide(id, expectedRevision) {
      pruefeId(id); pruefeRevision(expectedRevision)
      return run(['rides'], 'readwrite', (t) => {
        t.read('rides', id, (old) => {
          if (!old || old.deleted || old.revision !== expectedRevision) { t.fail(konflikt()); return }
          // Tombstone verhindert, dass ein alter Tab dieselbe ID neu anlegt.
          t.store('rides').put({ id, revision: old.revision + 1, deleted: true })
          t.setResult(true)
        })
      })
    },

    async getRecovery(id) {
      pruefeId(id)
      return run(['recoveries'], 'readonly', (t) => t.read('recoveries', id, (record) => t.setResult(record || null)))
    },
    async listRecoveries() {
      return run(['recoveries'], 'readonly', (t) =>
        t.readAll('recoveries', (records) => t.setResult(records)))
    },
    async getRide(id) {
      pruefeId(id)
      return run(['rides'], 'readonly', (t) => t.read('rides', id, (record) => t.setResult(record?.deleted ? null : record || null)))
    },
    async listRides() {
      return run(['rides'], 'readonly', (t) =>
        t.readAll('rides', (records) => t.setResult(records.filter((record) => !record.deleted))))
    },
    close() {
      if (dbPromise) dbPromise.then((db) => db.close()).catch(() => {})
      dbPromise = null
    },
  }
}
