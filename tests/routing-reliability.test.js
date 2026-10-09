import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const vorherigerOrt = globalThis.location
const vorherigerSpeicher = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const echtesFetch = globalThis.fetch
const echterTimer = globalThis.setTimeout
const echtesLoeschen = globalThis.clearTimeout
globalThis.location = { origin: 'http://localhost:5173' }
globalThis.localStorage = { getItem: () => null }
const { route, RoutingFehler } = await import('../src/js/routing.js')

test.afterEach(() => {
  globalThis.fetch = echtesFetch
  globalThis.setTimeout = echterTimer
  globalThis.clearTimeout = echtesLoeschen
})
test.after(() => {
  if (vorherigerOrt === undefined) delete globalThis.location
  else globalThis.location = vorherigerOrt
  if (vorherigerSpeicher === undefined) delete globalThis.localStorage
  else Object.defineProperty(globalThis, 'localStorage', vorherigerSpeicher)
})

let nummer = 0
function punkte() {
  nummer++
  return [[50 + nummer / 1000, 8], [50.01 + nummer / 1000, 8.01]]
}
const browserRoute = () => ({
  linie: [[50, 8, 100], [50.01, 8.01, 110]], meter: 1400, sekunden: 120, auf: 10, ab: 0,
  schritte: [[0, 'depart', '', '', 0], [1400, 'arrive', '', '', 0]],
})
const browserAntwort = (daten, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => daten })
const pruefeFehler = (code, kind, status = null) => (err) => {
  assert.ok(err instanceof RoutingFehler)
  assert.equal(err.code, code)
  assert.equal(err.kind, kind)
  assert.equal(err.status, status)
  return true
}
function sofortigeFrist() {
  globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 1 }
  globalThis.clearTimeout = () => {}
}

test('Browser: gültige Route behält das Navi-Format und wird für identische Aufrufe geteilt', async () => {
  let aufrufe = 0
  globalThis.fetch = async () => { aufrufe++; return browserAntwort(browserRoute()) }
  const p = punkte()
  const a = route(p), b = route(p)
  assert.equal(a, b)
  const r = await a
  assert.equal(aufrufe, 1)
  assert.equal(r.pts.length, 2)
  assert.equal(r.schritte.at(-1)[1], 'arrive')
  assert.ok(r.meter > 0)
  assert.equal(await route(p), r)
  assert.equal(aufrufe, 1)
})

test('Browser: Rundtour-Anfrage behält das vorhandene Payload-Format', async () => {
  let body
  globalThis.fetch = async (_, opts) => { body = JSON.parse(opts.body); return browserAntwort(browserRoute()) }
  const r = await route([[50, 8]], { rundtour: { km: 60, seed: 2 } })
  assert.equal(r.pts.length, 2)
  assert.deepEqual(body, { punkte: [[8, 50]], rundtour: { km: 60, seed: 2 } })
})

test('Browser: optionale Höhe darf wie bisher null sein', async () => {
  globalThis.fetch = async () => browserAntwort({ ...browserRoute(), linie: [[50, 8, null], [50.01, 8.01, 110]] })
  const r = await route(punkte())
  assert.equal(r.hoehen[0], null)
})

test('Browser: erfolgreicher Aufruf räumt Timer und Abbruchlistener auf', async () => {
  let gestartet = 0, geloescht = 0, entfernt = 0
  globalThis.setTimeout = () => { gestartet++; return 1 }
  globalThis.clearTimeout = () => { geloescht++ }
  globalThis.fetch = async () => browserAntwort(browserRoute())
  const signal = { aborted: false, addEventListener() {}, removeEventListener() { entfernt++ } }
  assert.ok((await route(punkte(), { signal })).meter > 0)
  assert.deepEqual([gestartet, geloescht, entfernt], [1, 1, 1])
})

test('Browser: Timeout beendet auch einen Fetch, der das Abbruchsignal ignoriert; danach ist der Cache frei', async () => {
  const p = punkte()
  let signal, aufrufe = 0
  globalThis.fetch = (_, opts) => {
    aufrufe++
    signal = opts.signal
    return aufrufe === 1 ? new Promise(() => {}) : Promise.resolve(browserAntwort(browserRoute()))
  }
  sofortigeFrist()
  await assert.rejects(route(p), pruefeFehler('timeout', 'timeout'))
  assert.equal(signal.aborted, true)
  globalThis.setTimeout = echterTimer
  globalThis.clearTimeout = echtesLoeschen
  assert.ok((await route(p)).meter > 0)
  assert.equal(aufrufe, 2)
})

test('Browser: die Frist gilt auch beim Lesen der Antwort', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })
  sofortigeFrist()
  await assert.rejects(route(punkte()), pruefeFehler('timeout', 'timeout'))
})

test('Browser: expliziter Abbruch ist kein Netzwerkfehler und beeinflusst einen anderen Aufruf nicht', async () => {
  const p = punkte()
  let aufrufe = 0
  globalThis.fetch = () => {
    aufrufe++
    return aufrufe === 1 ? new Promise(() => {}) : Promise.resolve(browserAntwort(browserRoute()))
  }
  const controller = new AbortController()
  const abgebrochen = route(p, { signal: controller.signal })
  controller.abort()
  await assert.rejects(abgebrochen, pruefeFehler('abbruch', 'abbruch'))
  assert.ok((await route(p)).meter > 0)
  assert.equal(aufrufe, 2)
})

test('Browser: Netzwerkfehler wird unterschieden und nicht gecacht', async () => {
  const p = punkte()
  let aufrufe = 0
  globalThis.fetch = async () => {
    aufrufe++
    if (aufrufe === 1) throw new TypeError('offline')
    return browserAntwort(browserRoute())
  }
  await assert.rejects(route(p), pruefeFehler('offline', 'netzwerk'))
  assert.ok((await route(p)).meter > 0)
  assert.equal(aufrufe, 2)
})

test('Browser: HTTP 429 und 5xx behalten Status und Server-Fehlercode', async () => {
  for (const [status, code, kind] of [
    [429, 'rate_limited', 'http'], [503, 'quota', 'http'], [502, 'upstream', 'http'],
    [504, 'timeout', 'timeout'], [502, 'invalid_response', 'validierung'],
  ]) {
    globalThis.fetch = async () => browserAntwort({ error: { code, message: 'Routing nicht verfügbar' } }, status)
    await assert.rejects(route(punkte()), pruefeFehler(code, kind, status))
  }
})

test('Browser: ungültiges JSON und fehlerhafte Geometrien werden nicht gecacht', async () => {
  const ungueltig = [
    { ok: true, status: 200, json: async () => { throw new SyntaxError('JSON') } },
    browserAntwort({ ...browserRoute(), linie: [[50, 8, 0]] }),
    browserAntwort({ ...browserRoute(), linie: [[50, 8, 0], [91, 8, 0]] }),
    browserAntwort({ ...browserRoute(), linie: [[50, 8, 0], [NaN, 8, 0]] }),
    browserAntwort({ ...browserRoute(), linie: [[50, 8, 0], [50, 8, 0]] }),
    browserAntwort({ ...browserRoute(), schritte: [] }),
  ]
  for (const fehler of ungueltig) {
    const p = punkte()
    let aufrufe = 0
    globalThis.fetch = async () => (++aufrufe === 1 ? fehler : browserAntwort(browserRoute()))
    await assert.rejects(route(p), pruefeFehler('invalid_response', 'validierung'))
    assert.ok((await route(p)).meter > 0)
    assert.equal(aufrufe, 2)
  }
})

const serverQuelle = readFileSync(new URL('../api/route.js', import.meta.url), 'utf8')
  .replace('import { sendError, report } from "./_shared.js";', '')
  .replace('export default async function handler', 'async function handler')

function server(fetchMock, { timer = echterTimer, clearTimer = echtesLoeschen } = {}) {
  const context = vm.createContext({
    process: { env: { ALLOWED_ORIGINS: 'https://dev.test', ORS_KEY: 'test-only' } },
    fetch: fetchMock, AbortController, setTimeout: timer, clearTimeout: clearTimer,
    sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
    report: () => {},
  })
  vm.runInContext(`${serverQuelle}\nglobalThis.handler = handler`, context)
  const anfrage = (signal) => ({
    method: 'POST', headers: { origin: 'https://dev.test', 'x-forwarded-for': 'test-ip' },
    body: { punkte: [[8, 50], [8.01, 50.01]] }, signal,
  })
  const antwort = () => ({
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this },
    setHeader(key, value) { this.headers[key] = value },
    json(value) { this.body = value; return this },
  })
  return async (signal, body = { punkte: [[8, 50], [8.01, 50.01]] }) => {
    const res = antwort()
    await context.handler({ ...anfrage(signal), body }, res)
    return res
  }
}

const orsRoute = () => ({ features: [{
  geometry: { type: 'LineString', coordinates: [[8, 50, 100], [8.01, 50.01, 110]] },
  properties: {
    segments: [{ steps: [
      { type: 11, distance: 700, name: '' },
      { type: 10, distance: 700, name: '' },
    ] }],
    summary: { distance: 1400, duration: 120 }, ascent: 10, descent: 0,
  },
}] })
const orsAntwort = (daten, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => daten, text: async () => '',
})
const schnellerTimer = (fn) => { queueMicrotask(fn); return 1 }

test('Server: gültige ORS-Route wird konvertiert und erst danach gecacht', async () => {
  let aufrufe = 0
  const handler = server(async (_, opts) => {
    assert.ok(opts.signal)
    aufrufe++
    return orsAntwort(orsRoute())
  })
  const a = await handler(), b = await handler()
  assert.equal(a.statusCode, 200)
  assert.equal(a.body.linie.length, 2)
  assert.equal(a.body.schritte.at(-1)[1], 'arrive')
  assert.equal(b.statusCode, 200)
  assert.equal(aufrufe, 1)
})

test('Server: Rundtour nutzt weiterhin ORS round_trip mit einem Startpunkt', async () => {
  let body
  const handler = server(async (_, opts) => { body = JSON.parse(opts.body); return orsAntwort(orsRoute()) })
  const r = await handler(undefined, { punkte: [[8, 50]], rundtour: { km: 60, seed: 2 } })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(body.coordinates, [[8, 50]])
  assert.deepEqual(body.options.round_trip, { length: 60000, points: 5, seed: 2 })
})

test('Server: fehlende optionale Höhen- und Summenwerte behalten den bisherigen Fallback', async () => {
  const handler = server(async () => {
    const j = orsRoute()
    j.features[0].geometry.coordinates[0][2] = null
    j.features[0].properties.summary = { distance: null, duration: null }
    j.features[0].properties.ascent = null
    j.features[0].properties.descent = null
    return orsAntwort(j)
  })
  const r = await handler()
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.linie[0][2], 0)
  assert.equal(r.body.meter, 1400)
  assert.equal(r.body.sekunden, 0)
  assert.equal(r.body.auf, 0)
})

test('Server: erfolgreicher Aufruf räumt Timer und Abbruchlistener auf', async () => {
  let gestartet = 0, geloescht = 0, entfernt = 0
  const signal = { aborted: false, addEventListener() {}, removeEventListener() { entfernt++ } }
  const handler = server(async () => orsAntwort(orsRoute()), {
    timer: () => { gestartet++; return 1 }, clearTimer: () => { geloescht++ },
  })
  assert.equal((await handler(signal)).statusCode, 200)
  assert.deepEqual([gestartet, geloescht, entfernt], [1, 1, 1])
})

test('Server: Timeout beendet hängenden Fetch und hängende Antwortverarbeitung', async () => {
  for (const haengt of ['fetch', 'json', 'text']) {
    let signal
    const handler = server((_, opts) => {
      signal = opts.signal
      if (haengt === 'fetch') return new Promise(() => {})
      return Promise.resolve(haengt === 'json'
        ? { ok: true, status: 200, json: () => new Promise(() => {}) }
        : { ok: false, status: 500, text: () => new Promise(() => {}) })
    }, { timer: schnellerTimer, clearTimer: () => {} })
    const r = await handler()
    assert.equal(r.statusCode, 504)
    assert.equal(r.body.error.code, 'timeout')
    assert.equal(signal.aborted, true)
  }
})

test('Server: Client-Abbruch wird getrennt vom Timeout behandelt', async () => {
  let upstreamSignal
  const handler = server((_, opts) => { upstreamSignal = opts.signal; return new Promise(() => {}) })
  const controller = new AbortController()
  const laufend = handler(controller.signal)
  controller.abort()
  const r = await laufend
  assert.equal(r.statusCode, 499)
  assert.equal(r.body.error.code, 'aborted')
  assert.equal(upstreamSignal.aborted, true)
})

test('Server: Netzwerk-, HTTP- und JSON-Fehler bleiben unterscheidbar', async () => {
  const faelle = [
    [async () => { throw new TypeError('offline') }, 502, 'upstream_network'],
    [async () => orsAntwort({}, 429), 503, 'quota'],
    [async () => orsAntwort({}, 500), 502, 'upstream'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('JSON') } }), 502, 'invalid_response'],
  ]
  for (const [fetchMock, status, code] of faelle) {
    const r = await server(fetchMock)()
    assert.equal(r.statusCode, status)
    assert.equal(r.body.error.code, code)
  }
})

test('Server: ungültige Geometrie wird nicht gecacht; erneuter Versuch kann gelingen', async () => {
  for (const linie of [[], [[8, 50, 0]], [[8, 50, 0], [8, 50, 0]], [[8, 50, 0], [200, 50, 0]], [[8, 50, 0], [NaN, 50, 0]]]) {
    let aufrufe = 0
    const handler = server(async () => {
      aufrufe++
      const j = orsRoute()
      if (aufrufe === 1) j.features[0].geometry.coordinates = linie
      return orsAntwort(j)
    })
    const fehler = await handler()
    assert.equal(fehler.statusCode, 502)
    assert.equal(fehler.body.error.code, 'invalid_response')
    assert.equal((await handler()).statusCode, 200)
    assert.equal(aufrufe, 2)
  }
})

test('Server: ungültige Abbiegeschritte und Distanz werden nicht als Route ausgeliefert', async () => {
  for (const veraendern of [
    (j) => { j.features[0].properties.segments[0].steps[0].distance = NaN },
    (j) => { j.features[0].properties.summary.distance = -1 },
    (j) => { j.features[0].geometry.type = 'Point' },
  ]) {
    const handler = server(async () => {
      const j = orsRoute()
      veraendern(j)
      return orsAntwort(j)
    })
    const r = await handler()
    assert.equal(r.statusCode, 502)
    assert.equal(r.body.error.code, 'invalid_response')
  }
})

test('Server: fehlende Route bleibt 422 und wird nicht gecacht', async () => {
  let aufrufe = 0
  const handler = server(async () => { aufrufe++; return orsAntwort({ features: [] }) })
  assert.equal((await handler()).statusCode, 422)
  assert.equal((await handler()).statusCode, 422)
  assert.equal(aufrufe, 2)
})
