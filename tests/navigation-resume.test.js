import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const NAV_KEY = 'mm_navigation_active_v1'
const TRACK_KEY = 'mm_ride_track_active_v1'
const navigationSource = readFileSync(new URL('../src/js/tour-fahren.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')
  .replaceAll("import('./offline.js')", 'ladeOffline()')
const tourenSource = readFileSync(new URL('../src/js/touren.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')
  .replace("await import('./tour-fahren.js')", 'globalThis.navigationModul')

const route = (n = 1) => ({
  pts: [[50, 8], [50 + 0.01 * n, 8 + 0.01 * n]], kum: [0, 1400 * n],
  schritte: [[0, 'depart', '', '', 0], [1400 * n, 'arrive', '', '', 0]],
})
const tour = { id: 'test-route', name: 'Isolierte Testtour', typ: 'strecke' }

function speicher(eintraege = {}) {
  const daten = new Map(Object.entries(eintraege))
  const fehler = { lesen: false, schreiben: false, entfernen: false }
  return {
    daten, fehler,
    getItem(k) { if (fehler.lesen) throw new Error('Lesefehler'); return daten.has(k) ? daten.get(k) : null },
    setItem(k, v) { if (fehler.schreiben) throw new DOMException('Voll', 'QuotaExceededError'); daten.set(k, String(v)) },
    removeItem(k) { if (fehler.entfernen) throw new Error('Entfernen fehlgeschlagen'); daten.delete(k) },
  }
}

function navigation({ sitzung = speicher(), rides = speicher(), gpsFehler = false } = {}) {
  const zaehler = { gps: 0, watch: 0, tracker: 0, offlineImport: 0, korridorDownloads: 0, meldungen: [], optionen: null }
  let positionAufRoute = 700
  let neueRoute = route(2)
  let routingFehler = false
  const klassen = { add() {}, remove() {} }
  const tourName = { textContent: tour.name }
  const el = () => ({ classList: klassen, innerHTML: '', addEventListener() {}, remove() {},
    querySelector: (selector) => selector === '.fahrt-name' ? tourName : { hidden: false } })
  const host = { appendChild() {}, querySelector: () => null }
  const canvas = { addEventListener() {}, removeEventListener() {} }
  const map = {
    setMaxPitch() {}, flyTo() {}, once() {}, on() {}, off() {}, easeTo() {},
    getContainer: () => ({ clientHeight: 800, clientWidth: 1200 }),
    getCanvasContainer: () => canvas, getZoom: () => 16, getBearing: () => 0, getPitch: () => 0,
  }
  class Marker {
    setLngLat() { return this }
    addTo() { return this }
    setRotation() { return this }
    remove() {}
  }
  const ctx = vm.createContext({
    sessionStorage: sitzung, localStorage: rides, Date, JSON, DOMException,
    document: {
      createElement: el,
      querySelector: (selector) => selector.includes('kv-map-wrap') ? host : selector === '.konf-karte-hub' ? { classList: klassen } : null,
      body: { classList: klassen }, addEventListener() {}, removeEventListener() {},
    },
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: { geolocation: {
      getCurrentPosition(ok, error, options) {
        zaehler.gps++; zaehler.optionen = options
        if (gpsFehler) error(new Error('GPS nicht verfügbar'))
        else ok({ coords: { latitude: 50.005, longitude: 8.005, accuracy: 5, heading: null, speed: 0 } })
      },
      watchPosition() { zaehler.watch++; return zaehler.watch }, clearWatch() {},
    } },
    performance: { now: () => 1000 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout, clearTimeout, console: { warn() {} },
    ladeOffline: () => {
      zaehler.offlineImport++
      return Promise.resolve({ vorladen: () => { zaehler.korridorDownloads++ }, vorladenAbbrechen() {} })
    },
    esc: (s) => s, hinweisen: (...args) => { zaehler.meldungen.push(args) }, fragen: async () => false,
    getHubMap: () => map, getMapLib: () => ({ Marker }), getUserCoords: () => ({ lat: null, lng: null }),
    haversineKm: () => 1, wetterEntlang: async () => null, wetterWarnung: () => null, wetterSymbol: () => '',
    starteAufzeichnung: async () => { zaehler.tracker++; return { beenden: () => null, abbrechen() {} } },
    unterbrocheneAufzeichnung: () => rides.getItem(TRACK_KEY) ? { id: 'track' } : null,
    ladeUnterbrocheneAufzeichnung: async () => rides.getItem(TRACK_KEY) ? { id: 'track' } : null,
    verwerfeUnterbrochene: () => { rides.removeItem(TRACK_KEY); return true },
    verwerfeGesicherteAufzeichnung: async () => { rides.removeItem(TRACK_KEY); return true },
    bestaetigeGespeicherteFahrt: () => true,
    sage() {}, verstummen() {}, manoever: () => null, stimmeEntsperren() {},
    wartetAufDich: () => null, wartetSetzen() {}, PERSONA: { name: 'Test', zeile: '' },
    route: async () => { if (routingFehler) throw new Error('Routingfehler'); return route() },
    naechster: () => ({ index: 0, meter: 0 }), teil: () => route(), verbinde: () => neueRoute,
    rundAb: (d) => d, kumuliert: (pts) => [0, Math.round((pts.at(-1)[0] - pts[0][0]) * 140_000)], stuetzpunkte: (pts) => pts,
    punktBei: (d) => d.pts[0], kursBei: () => 0,
    projiziere: () => ({ abstand: 0, meter: positionAufRoute }), RoutingFehler: class extends Error {},
  })
  vm.runInContext(`${navigationSource}
    karteFuerFahrt = () => {}; zeichneNaviLinie = () => {}; zeichne = () => {}; heimMelden = () => {};
    globalThis.pruefung = { starteFahrt, navigationFortsetzen, leseNavigationssitzung,
      verwerfeNavigationssitzung, beenden, neuBerechnen, position, faehrtGerade,
      getFahrt: () => fahrt }`, ctx)
  return {
    ...ctx.pruefung, sitzung, rides, zaehler, tourName,
    setPositionAufRoute(m) { positionAufRoute = m },
    setNeueRoute(d) { neueRoute = d },
    setRoutingFehler(v) { routingFehler = v },
  }
}

function tourenDialog(nav, entscheidung) {
  const dialoge = []
  const ctx = vm.createContext({
    localStorage: { getItem: () => null },
    navigationModul: nav,
    meldung: async (opts) => { dialoge.push(opts); return entscheidung },
  })
  vm.runInContext(`${tourenSource}
    globalThis.pruefung = { navigationWiederaufnahmeAnbieten }`, ctx)
  return { anbieten: ctx.pruefung.navigationWiederaufnahmeAnbieten, dialoge }
}

test('normaler Navigationsstart sichert die Route und lädt die vorhandene Offline-Karte vor', async () => {
  const n = navigation()
  assert.equal(n.starteFahrt(tour, route()), true)
  await new Promise((resolve) => setImmediate(resolve))
  const s = n.leseNavigationssitzung()
  assert.equal(s.tour.name, tour.name)
  assert.equal(s.strecke.schritte.at(-1)[1], 'arrive')
  assert.equal(s.strecke.pts.length, 2)
  assert.equal(n.rides.daten.size, 0)
  assert.equal(n.zaehler.watch, 1)
  assert.equal(n.zaehler.offlineImport, 1)
  assert.equal(n.zaehler.korridorDownloads, 1)
  assert.equal(n.tourName.textContent, tour.name)
})

test('Reload erkennt die gültige Sitzung, startet aber weder GPS noch Aufzeichnung automatisch', async () => {
  const sitzung = speicher()
  navigation({ sitzung }).starteFahrt(tour, route())
  const nachReload = navigation({ sitzung })
  const dialog = tourenDialog(nachReload, null)
  await dialog.anbieten()
  assert.equal(dialog.dialoge[0].titel, 'Navigation fortsetzen?')
  assert.deepEqual(Array.from(dialog.dialoge[0].knoepfe, k => k.label), ['Nicht fortsetzen', 'Navigation fortsetzen'])
  assert.equal(nachReload.zaehler.gps, 0)
  assert.equal(nachReload.zaehler.watch, 0)
  assert.equal(nachReload.zaehler.tracker, 0)
  assert.ok(sitzung.getItem(NAV_KEY))
})

test('ausdrückliche Fortsetzung holt frisches GPS und projiziert den Fortschritt neu', async () => {
  const sitzung = speicher()
  navigation({ sitzung }).starteFahrt(tour, route())
  const nachReload = navigation({ sitzung })
  const dialog = tourenDialog(nachReload, 'ja')
  await dialog.anbieten()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(nachReload.zaehler.gps, 1)
  assert.equal(nachReload.zaehler.optionen.maximumAge, 0)
  assert.equal(nachReload.zaehler.watch, 1)
  assert.equal(nachReload.getFahrt().meter, 700)
  assert.equal(nachReload.zaehler.tracker, 0)
  assert.equal(nachReload.zaehler.offlineImport, 1)
  assert.equal(nachReload.zaehler.korridorDownloads, 1)
  assert.equal(nachReload.tourName.textContent, tour.name)
})

test('Navigationsstart mit Mitschnitt behält die Aufnahme ohne Korridor-Download', async () => {
  const n = navigation()
  assert.equal(n.starteFahrt(tour, route(), { mitschneiden: true }), true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(n.zaehler.tracker, 1)
  assert.equal(n.zaehler.watch, 1)
  assert.equal(n.zaehler.offlineImport, 1)
  assert.equal(n.zaehler.korridorDownloads, 1)
})

test('Ablehnen entfernt nur die Navigationsmarkierung, nicht den aktiven Track', async () => {
  const sitzung = speicher(), rides = speicher({ [TRACK_KEY]: 'laufender-test-track' })
  navigation({ sitzung }).starteFahrt(tour, route())
  const nachReload = navigation({ sitzung, rides })
  await tourenDialog(nachReload, 'nein').anbieten()
  assert.equal(sitzung.getItem(NAV_KEY), null)
  assert.equal(rides.getItem(TRACK_KEY), 'laufender-test-track')
  assert.equal(nachReload.zaehler.gps, 0)
})

test('ohne Sitzung erscheint kein Wiederaufnahme-Dialog', async () => {
  const n = navigation(), dialog = tourenDialog(n, 'ja')
  await dialog.anbieten()
  assert.equal(dialog.dialoge.length, 0)
  assert.equal(n.zaehler.gps, 0)
})

test('beschädigtes JSON, ungültige Geometrie und ungültige Hinweise werden nicht angeboten', async () => {
  const sitzung = speicher({ [NAV_KEY]: '{kaputt' })
  const n = navigation({ sitzung })
  assert.equal(n.leseNavigationssitzung(), null)
  const roh = JSON.parse((() => { const s = speicher(); navigation({ sitzung: s }).starteFahrt(tour, route()); return s.getItem(NAV_KEY) })())
  for (const ungueltig of [
    { ...roh, strecke: { ...roh.strecke, pts: [[91, 8], [50.01, 8.01]] } },
    { ...roh, strecke: { ...roh.strecke, schritte: [] } },
    { ...roh, strecke: { ...roh.strecke, kum: [0, 100_000] } },
    { ...roh, version: 2 },
  ]) {
    sitzung.setItem(NAV_KEY, JSON.stringify(ungueltig))
    const dialog = tourenDialog(navigation({ sitzung }), 'ja')
    await dialog.anbieten()
    assert.equal(dialog.dialoge.length, 0)
  }
})

test('veraltete oder zukünftige Sitzungen werden nicht wiederhergestellt', () => {
  const sitzung = speicher()
  navigation({ sitzung }).starteFahrt(tour, route())
  const s = JSON.parse(sitzung.getItem(NAV_KEY))
  for (const zeit of [Date.now() - 13 * 60 * 60_000, Date.now() + 120_000]) {
    sitzung.setItem(NAV_KEY, JSON.stringify({ ...s, zeit }))
    assert.equal(navigation({ sitzung }).leseNavigationssitzung(), null)
  }
})

test('sessionStorage-Lesefehler verhindern das Angebot und starten kein GPS', async () => {
  const sitzung = speicher()
  sitzung.fehler.lesen = true
  const n = navigation({ sitzung }), dialog = tourenDialog(n, 'ja')
  await dialog.anbieten()
  assert.equal(dialog.dialoge.length, 0)
  assert.equal(n.zaehler.gps, 0)
})

test('sessionStorage-Schreibfehler lassen Navigation laufen und melden fehlende Wiederaufnahme', () => {
  const sitzung = speicher()
  sitzung.fehler.schreiben = true
  const n = navigation({ sitzung })
  assert.equal(n.starteFahrt(tour, route()), true)
  assert.equal(n.faehrtGerade(), true)
  assert.equal(sitzung.getItem(NAV_KEY), null)
  assert.match(n.zaehler.meldungen[0][0], /Wiederaufnahme nicht verfügbar/)
})

test('erfolgreiches Rerouting ersetzt den gültigen Sitzungsweg', async () => {
  const n = navigation()
  n.starteFahrt(tour, route())
  n.getFahrt().letztePos = { lat: 50.005, lng: 8.005 }
  n.setNeueRoute(route(2))
  await n.neuBerechnen()
  assert.equal(n.leseNavigationssitzung().strecke.kum.at(-1), 2800)
  assert.equal(n.getFahrt().dVersion, 1)
})

test('fehlgeschlagenes Rerouting behält die vorherige gültige Sitzung', async () => {
  const n = navigation()
  n.starteFahrt(tour, route())
  const vorher = n.sitzung.getItem(NAV_KEY)
  n.getFahrt().letztePos = { lat: 50.005, lng: 8.005 }
  n.setRoutingFehler(true)
  await n.neuBerechnen()
  assert.equal(n.sitzung.getItem(NAV_KEY), vorher)
  assert.equal(n.getFahrt().dVersion, 0)
})

test('Schreibfehler nach Rerouting entfernt die nun veraltete Sitzungsroute', async () => {
  const n = navigation()
  n.starteFahrt(tour, route())
  n.getFahrt().letztePos = { lat: 50.005, lng: 8.005 }
  n.sitzung.fehler.schreiben = true
  await n.neuBerechnen()
  assert.equal(n.sitzung.getItem(NAV_KEY), null)
  assert.equal(n.faehrtGerade(), true)
})

test('reguläres Beenden entfernt die Navigationsmarkierung', () => {
  const n = navigation()
  n.starteFahrt(tour, route())
  n.beenden()
  assert.equal(n.sitzung.getItem(NAV_KEY), null)
  assert.equal(n.faehrtGerade(), false)
})

test('Ankunft per frischem GPS entfernt die Navigationsmarkierung', () => {
  const n = navigation()
  n.starteFahrt(tour, route())
  n.setPositionAufRoute(1390)
  n.position({ coords: { latitude: 50.01, longitude: 8.01, accuracy: 5, speed: 0, heading: null } })
  assert.equal(n.sitzung.getItem(NAV_KEY), null)
  assert.equal(n.faehrtGerade(), false)
})

test('unterbrochene Aufzeichnung bleibt bei Wiederaufnahme und Navigationsende erhalten', async () => {
  const sitzung = speicher(), rides = speicher({ [TRACK_KEY]: 'laufender-test-track' })
  navigation({ sitzung }).starteFahrt(tour, route())
  const n = navigation({ sitzung, rides })
  assert.equal(await n.navigationFortsetzen(), true)
  n.beenden()
  assert.equal(rides.getItem(TRACK_KEY), 'laufender-test-track')
  assert.equal(n.zaehler.tracker, 0)
})

test('fertiger ungespeicherter Track bleibt bei Wiederaufnahme unverändert', async () => {
  const sitzung = speicher(), fertig = JSON.stringify({ fertig: true, track: { id: 'test-track', punkte: [[50, 8]] } })
  const rides = speicher({ [TRACK_KEY]: fertig })
  navigation({ sitzung }).starteFahrt(tour, route())
  const n = navigation({ sitzung, rides })
  await n.navigationFortsetzen()
  assert.equal(rides.getItem(TRACK_KEY), fertig)
  assert.equal(n.zaehler.tracker, 0)
})

test('GPS-Fehler nach Zustimmung startet weder Navigation noch Aufzeichnung', async () => {
  const sitzung = speicher()
  navigation({ sitzung }).starteFahrt(tour, route())
  const n = navigation({ sitzung, gpsFehler: true })
  assert.equal(await n.navigationFortsetzen(), false)
  assert.equal(n.zaehler.watch, 0)
  assert.equal(n.zaehler.tracker, 0)
  assert.ok(sitzung.getItem(NAV_KEY))
})

test('Wiederaufnahme verwendet trotz gemerkter Mitschnitt-Einstellung mitschneiden: false', async () => {
  const sitzung = speicher(), rides = speicher({ mm_fahrt_aufzeichnen_v1: '1' })
  navigation({ sitzung }).starteFahrt(tour, route())
  const n = navigation({ sitzung, rides })
  assert.equal(await n.navigationFortsetzen(), true)
  assert.equal(n.zaehler.tracker, 0)
  assert.equal(rides.getItem('mm_fahrt_aufzeichnen_v1'), '1')
})
