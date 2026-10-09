import test from 'node:test'
import assert from 'node:assert/strict'
import { TestIndexedDB } from './test-indexeddb.js'
import { createRideStore } from '../src/js/ride-store.js'

class BrowserSpeicher {
  daten = new Map()
  fehlerBei = new Set()
  getItem(key) { return this.daten.get(key) ?? null }
  setItem(key, value) {
    if (this.fehlerBei.has(key)) throw new DOMException('Speicher voll', 'QuotaExceededError')
    this.daten.set(key, String(value))
  }
  removeItem(key) { this.daten.delete(key) }
}

const AKTIV = 'mm_ride_track_active_v1'
const RIDES = 'mm_rides_v1'

const speicher = new BrowserSpeicher()
globalThis.localStorage = speicher
const idb = new TestIndexedDB()
globalThis.indexedDB = idb
globalThis.location = { origin: 'http://localhost:5173' }
globalThis.window = { isSecureContext: true }
globalThis.document = {
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
}

let gps = null
let sichern = null
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  geolocation: {
    watchPosition(ok) { gps = ok; return 1 },
    clearWatch() { gps = null },
  },
} })
const echtesIntervall = globalThis.setInterval
const echtesIntervallEnde = globalThis.clearInterval
globalThis.setInterval = (fn) => { sichern = fn; return 1 }
globalThis.clearInterval = () => { sichern = null }

const tracker = await import('../src/js/ride-tracker.js')
const strecken = await import('../src/js/eigene-strecken.js')

function ort(lat, lng, zeit) {
  return { timestamp: zeit, coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 15, altitude: 100, altitudeAccuracy: 5 } }
}

async function fahrtStarten({ beiFehler } = {}) {
  const start = Date.now()
  const versprechen = tracker.starteAufzeichnung({ beiFehler })
  for (let i = 0; i < 100 && !gps; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(typeof gps, 'function', 'Recorder hat keine GPS-Wache gestartet')
  gps(ort(50, 8, start))
  const steuerung = await versprechen
  return { steuerung, start }
}

function weiterfahren(start, { luecke = false } = {}) {
  gps(ort(50.01, 8.01, start + (luecke ? 60_000 : 120_000)))
}

test.beforeEach(() => {
  speicher.daten.clear()
  speicher.fehlerBei.clear()
  idb.reset()
  gps = null
  sichern = null
})

test.after(() => {
  globalThis.setInterval = echtesIntervall
  globalThis.clearInterval = echtesIntervallEnde
})

test('fertige Fahrt bleibt bis zum bestätigten Speichern erhalten; Bestandsfahrten bleiben', async () => {
  const alt = { id: 'alt', title: 'Vorhanden', track: null }
  speicher.setItem(RIDES, JSON.stringify([alt]))
  const { steuerung, start } = await fahrtStarten()
  weiterfahren(start)
  await sichern()
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).fertig, undefined)
  const track = await steuerung.beenden()
  assert.equal(track.wiederherstellungGesichert, true)
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).track.id, track.id)
  const id = strecken.speichereFahrt(track, 'Probefahrt')
  assert.equal(await tracker.bestaetigeGespeicherteFahrt(track), true)
  assert.equal(await tracker.ladeUnterbrocheneAufzeichnung(), null)
  const rides = JSON.parse(speicher.getItem(RIDES))
  assert.deepEqual(rides[0], alt)
  assert.equal(rides[1].id, id.slice('fahrt-'.length))
})

test('periodischer Speicherfehler wird gemeldet, fertiger Track bleibt im Speicher', async () => {
  const fehler = []
  const { steuerung, start } = await fahrtStarten({ beiFehler: (text) => fehler.push(text) })
  weiterfahren(start)
  idb.failNextWrite = true
  await sichern()
  await sichern()
  assert.equal(fehler.length, 1)
  const track = await steuerung.beenden()
  assert.equal(track.wiederherstellungGesichert, false)
  assert.equal(fehler.length, 2)
  assert.equal(track.punkte.length, 2)
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).punkte.length, 0)
})

test('QuotaExceededError beim endgültigen Speichern lässt fertige Fahrt wiederherstellbar', async () => {
  const { steuerung, start } = await fahrtStarten()
  weiterfahren(start)
  const track = await steuerung.beenden()
  speicher.fehlerBei.add(RIDES)
  assert.throws(() => strecken.speichereFahrt(track, 'Test'), /Speicher/)
  assert.equal(speicher.getItem(RIDES), null)
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).track.id, track.id)
  speicher.fehlerBei.delete(RIDES)
  const wiederhergestellt = (await tracker.ladeUnterbrocheneAufzeichnung()).track
  strecken.speichereFahrt(wiederhergestellt, 'Test')
  assert.equal(await tracker.bestaetigeGespeicherteFahrt(wiederhergestellt), true)
  assert.equal(JSON.parse(speicher.getItem(RIDES)).length, 1)
})

test('neuer Modulzustand liest die fertige Fahrt nach einem Neuladen', async () => {
  const { steuerung, start } = await fahrtStarten()
  weiterfahren(start)
  const track = await steuerung.beenden()
  const neuGeladen = await import(`../src/js/ride-tracker.js?neuladen=${Date.now()}`)
  assert.equal((await neuGeladen.ladeUnterbrocheneAufzeichnung()).track.id, track.id)
  await assert.rejects(neuGeladen.starteAufzeichnung(), /ungespeicherte Fahrt/)
})

test('verspäteter erster GPS-Zeitstempel erzeugt keine negative Fahrtdauer', async () => {
  const start = tracker.starteAufzeichnung()
  for (let i = 0; i < 100 && !gps; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  gps(ort(50, 8, Date.now() - 3000))
  const steuerung = await start
  assert.equal(steuerung.stand().punkte[0].t, 0)
  await steuerung.abbrechen()
})

test('wenn beide Speicherziele fehlschlagen, bleibt der vollständige Track für eine Datei-Sicherung verfügbar', async () => {
  const { steuerung, start } = await fahrtStarten()
  weiterfahren(start)
  speicher.fehlerBei.add(RIDES)
  const track = await steuerung.beenden()
  assert.equal(track.wiederherstellungGesichert, true)
  assert.throws(() => strecken.speichereFahrt(track, 'Test'), /Speicher/)
  assert.equal(track.punkte.length, 2)

  const altesBody = document.body
  const alteCreateElement = document.createElement
  const alteCreateObjectURL = URL.createObjectURL
  const altesTimeout = globalThis.setTimeout
  let datei
  try {
    document.body = { appendChild() {} }
    document.createElement = () => ({ click() {}, remove() {} })
    URL.createObjectURL = (blob) => { datei = blob; return 'blob:test' }
    globalThis.setTimeout = () => 1
    strecken.fahrtSichernAlsDatei(track)
    const inhalt = JSON.parse(await datei.text())
    assert.equal(inhalt.track.id, track.id)
    assert.deepEqual(inhalt.track.punkte, track.punkte)
  } finally {
    document.body = altesBody
    document.createElement = alteCreateElement
    URL.createObjectURL = alteCreateObjectURL
    globalThis.setTimeout = altesTimeout
  }
})

test('Wiederholung nach Speichern vor Bereinigung erzeugt keinen doppelten Eintrag', async () => {
  const { steuerung, start } = await fahrtStarten()
  weiterfahren(start)
  const track = await steuerung.beenden()
  const id = strecken.speichereFahrt(track, 'Erster Name')
  assert.equal(strecken.speichereFahrt((await tracker.ladeUnterbrocheneAufzeichnung()).track, 'Zweiter Name'), id)
  assert.equal(JSON.parse(speicher.getItem(RIDES)).length, 1)
})

test('nicht lesbares oder ungültiges Fahrtenbuch wird nie überschrieben', async () => {
  for (const roh of ['{kaputt', '{"rides":[]}', 'null']) {
    speicher.setItem(RIDES, roh)
    assert.throws(() => strecken.speichereFahrt({ id: 'auf-test', start: 1, km: 1, fahrMs: 1000, punkte: [[50, 8], [50.01, 8.01]] }, 'Test'), /nicht gelesen/)
    assert.equal(speicher.getItem(RIDES), roh)
  }
})

test('neue Fahrt überschreibt weder fertigen noch laufenden Zwischenstand', async () => {
  const { steuerung, start } = await fahrtStarten()
  weiterfahren(start)
  await sichern()
  await assert.rejects(tracker.starteAufzeichnung(), /läuft bereits/)
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).start, start)
  await steuerung.beenden()
  await assert.rejects(tracker.starteAufzeichnung(), /ungespeicherte Fahrt/)
})

test('Abbrechen entfernt nur den Zwischenstand der eigenen Aufzeichnung', async () => {
  const { steuerung } = await fahrtStarten()
  await sichern()
  await steuerung.abbrechen()
  assert.equal(await tracker.ladeUnterbrocheneAufzeichnung(), null)
})

test('Abbrechen von Aufzeichnung A bewahrt den laufenden Zwischenstand von Tab B', async () => {
  const { steuerung } = await fahrtStarten()
  const fremd = JSON.stringify({ id: 'auf-tab-b', start: Date.now(), punkte: [[51, 9, 0, null, 0]] })
  speicher.setItem(AKTIV, fremd)

  await steuerung.abbrechen()

  assert.equal(speicher.getItem(AKTIV), fremd)
  assert.equal(tracker.unterbrocheneAufzeichnung().id, 'auf-tab-b')
})

test('Abbrechen von Aufzeichnung A bewahrt eine fertige ungespeicherte Fahrt von Tab B', async () => {
  const { steuerung } = await fahrtStarten()
  const fremd = JSON.stringify({ fertig: true, track: { id: 'auf-tab-b', punkte: [[51, 9, 0, null], [51.01, 9.01, 60, null]] } })
  speicher.setItem(AKTIV, fremd)

  await steuerung.abbrechen()

  assert.equal(speicher.getItem(AKTIV), fremd)
  assert.equal(tracker.unterbrocheneAufzeichnung().track.id, 'auf-tab-b')
})

test('abweichende Legacy-Recovery bleibt neben der transaktionalen Fahrt erhalten und blockiert Resume', async () => {
  const { steuerung } = await fahrtStarten()
  await sichern()
  const fremd = JSON.stringify({ id: 'legacy-other-tab', start: Date.now(), meter: 900,
    punkte: [[51, 9, 0, null, 0]] })
  speicher.setItem(AKTIV, fremd)

  await assert.rejects(tracker.ladeUnterbrocheneAufzeichnung(),
    (error) => error.code === 'legacy_conflict')
  assert.equal(speicher.getItem(AKTIV), fremd)
  const inspect = createRideStore({ indexedDB: idb })
  assert.equal((await inspect.listRecoveries()).length, 2)
  inspect.close()
  await steuerung.abbrechen()
  assert.equal(speicher.getItem(AKTIV), fremd)
})

test('fortgesetzte Aufzeichnung behält ihre ID bis zum Beenden und bestätigten Speichern', async () => {
  const start = Date.now() - 120_000
  const fortsetzen = { id: 'auf-fortgesetzt', start, punkte: [[50, 8, 0, null, 0]], meter: 0, fahrMs: 0 }
  speicher.setItem(AKTIV, JSON.stringify(fortsetzen))

  const steuerung = await tracker.starteAufzeichnung({ fortsetzen })
  await sichern()
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).id, fortsetzen.id)
  gps(ort(50.01, 8.01, Date.now()))
  const track = await steuerung.beenden()
  assert.equal(track.id, fortsetzen.id)
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).track.id, fortsetzen.id)
  strecken.speichereFahrt(track, 'Fortgesetzte Fahrt')
  assert.equal(await tracker.bestaetigeGespeicherteFahrt(track), true)
  assert.equal(speicher.getItem(AKTIV), null)
})

test('Pause und GPS-Lücke bleiben im Track und im Wiederherstellungsstand', async () => {
  const { steuerung, start } = await fahrtStarten()
  steuerung.pause()
  gps(ort(50.01, 8.01, start + 30_000))
  assert.equal(steuerung.stand().punkte.length, 1)
  steuerung.weiter()
  weiterfahren(start, { luecke: true })
  gps(ort(50.02, 8.02, start + 120_000))
  await sichern()
  assert.equal((await tracker.ladeUnterbrocheneAufzeichnung()).punkte[2][4], 1)
  const track = await steuerung.beenden()
  assert.deepEqual(track.luecken, [1])
  assert.deepEqual((await tracker.ladeUnterbrocheneAufzeichnung()).track.luecken, [1])
})

test('optionaler Navigationsmitschnitt nutzt denselben bestätigten Speicherpfad', async () => {
  const fehler = []
  const { steuerung, start } = await fahrtStarten({ beiFehler: (text) => fehler.push(text) })
  weiterfahren(start)
  const track = await steuerung.beenden()
  assert.equal(fehler.length, 0)
  strecken.speichereFahrt(track, 'Tour')
  assert.equal(await tracker.bestaetigeGespeicherteFahrt(track), true)
  assert.equal(JSON.parse(speicher.getItem(RIDES))[0].track.id, track.id)
})
