/* Deterministic IndexedDB subset used by integration tests. Native same-profile
   concurrency remains covered separately by ride-store-native.html. */
export class TestIndexedDB {
  databases = new Map()
  failNextWrite = false
  reset() { this.failNextWrite = false; for (const db of this.databases.values()) for (const store of db.stores.values()) store.clear() }
  open(name) {
    const request = {}
    queueMicrotask(() => {
      let backend = this.databases.get(name)
      const fresh = !backend
      if (!backend) {
        backend = { stores: new Map(), keys: new Map(), tail: Promise.resolve() }
        this.databases.set(name, backend)
      }
      request.result = {
        objectStoreNames: { contains: (key) => backend.stores.has(key) },
        createObjectStore: (key, { keyPath }) => { backend.stores.set(key, new Map()); backend.keys.set(key, keyPath) },
        transaction: (stores, mode) => new TestTransaction(this, backend, stores, mode), close() {},
      }
      if (fresh) request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  }
}

class TestTransaction {
  queue = []
  stopped = false
  constructor(factory, backend, stores, mode) {
    this.factory = factory
    this.backend = backend; this.stores = stores; this.mode = mode
    let release
    const current = new Promise((resolve) => { release = resolve })
    const previous = backend.tail; backend.tail = current; this.release = release
    previous.then(() => {
      this.working = new Map([...backend.stores].map(([key, value]) =>
        [key, new Map([...value].map(([id, record]) => [id, structuredClone(record)]))]))
      queueMicrotask(() => this.pump())
    })
  }
  objectStore(name) {
    if (!this.stores.includes(name)) throw new Error('Store not in transaction')
    const enqueue = (fn) => { const request = {}; this.queue.push({ fn, request }); return request }
    return {
      get: (id) => enqueue(() => this.working.get(name).get(id)),
      getAll: () => enqueue(() => [...this.working.get(name).values()]),
      put: (record) => enqueue(() => this.write(name, record, false)),
      add: (record) => enqueue(() => this.write(name, record, true)),
      delete: (id) => enqueue(() => { this.working.get(name).delete(id) }),
    }
  }
  write(name, record, onlyNew) {
    if (this.factory.failNextWrite) {
      this.factory.failNextWrite = false
      throw new DOMException('Injected write failure', 'QuotaExceededError')
    }
    const store = this.working.get(name), id = record[this.backend.keys.get(name)]
    if (onlyNew && store.has(id)) throw new Error('Duplicate key')
    store.set(id, structuredClone(record)); return id
  }
  pump() {
    if (this.stopped) return
    if (!this.queue.length) {
      if (this.mode === 'readwrite') this.backend.stores = this.working
      this.stopped = true; this.release(); this.oncomplete?.(); return
    }
    const { fn, request } = this.queue.shift()
    try { request.result = structuredClone(fn()); request.onsuccess?.(); queueMicrotask(() => this.pump()) }
    catch (error) { this.error = error; this.abort() }
  }
  abort() {
    if (this.stopped) return
    this.stopped = true; this.release(); queueMicrotask(() => this.onabort?.())
  }
}
