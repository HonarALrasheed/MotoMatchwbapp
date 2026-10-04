/* ═══════════════════════════════════════════════════
   EIGENE KARTE — MapLibre + OpenStreetMap-Kacheln (OpenFreeMap).
   Ersetzt Google Maps samt Places-Suche.

   - Kacheln, Schriften und Symbole laufen über die eigene Domain (/kacheln/…,
     Rewrite in vercel.json, Proxy in vite.config.js). Der Browser spricht damit
     mit keinem fremden Server — kein Einwilligungs-Klick vor der Karte nötig.
   - Orte (Werkstätten, Händler, Fahrschulen …) kommen aus dem eigenen
     OSM-Datenbestand unter /data/orte/ (scripts/orte/bauen.mjs), geladen je
     1°-Kachel um die Suchmitte. Keine Kosten je Suche, keine Kontingente.
   - Die Ortssuche (PLZ/Ort) nutzt /data/orte/suche.json.

   Die Exporte tragen die Namen der früheren Google-Fassung in garage.js —
   der Karten-Reiter (bike-detail.js), die Garage und touren.js rufen sie so auf.
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'

const KACHEL_HOST = 'https://tiles.openfreemap.org/'
const KACHEL_PROXY = `${location.origin}/kacheln/`
const STIL_URL = `${KACHEL_PROXY}styles/liberty`
const DE_MITTE = { lat: 51.16, lng: 10.45 }
const MAX_TREFFER = 100

let ml = null // maplibre-gl, dynamisch geladen
let mlPromise = null
let karte = null
let karteBereit = null // Promise, löst nach 'load' auf
let userMarker = null
let popup = null

let userLat = DE_MITTE.lat
let userLng = DE_MITTE.lng
let userLocationKnown = false
let geoPromise = null

/* Letzter Kartenausschnitt: Die Karte öffnet dort, wo man zuletzt war, statt
   erst ganz Deutschland zu laden und dann zum Standort zu fliegen. */
const BLICK_KEY = 'mm_karte_blick_v1'
function letzterBlick() {
  try {
    const b = JSON.parse(localStorage.getItem(BLICK_KEY) || 'null')
    return b && Number.isFinite(b.lat) && Number.isFinite(b.lng) && Number.isFinite(b.zoom) ? b : null
  } catch { return null }
}
function blickMerken() {
  if (!karte) return
  const c = karte.getCenter()
  try { localStorage.setItem(BLICK_KEY, JSON.stringify({ lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), zoom: +karte.getZoom().toFixed(2) })) } catch {}
}

// ── Hilfen ───────────────────────────────────────────────────────────────

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Die Karte braucht keine Einwilligung mehr (alles über die eigene Domain). */
export function hasMapsConsent() { return true }

export function ladeMapLibre() {
  if (ml) return Promise.resolve(ml)
  if (!mlPromise) {
    mlPromise = Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      .then(([m]) => { ml = m.default || m; return ml })
      .catch((err) => { mlPromise = null; throw err })
  }
  return mlPromise
}
export function getMapLib() { return ml }

/** Karte im Leerlauf vorwärmen (Bibliothek, Stil, Kachelverzeichnis), damit der Reiter sofort steht. */
export function karteVorwaermen() {
  if (navigator.connection?.saveData) return
  ladeMapLibre().catch(() => {})
  ladeKartenStil().catch(() => {})
  fetch('/kacheln/planet').catch(() => {})
}

// ── Kategorien ───────────────────────────────────────────────────────────

/* Schlüssel = data-query der Kacheln im Markup (unverändert aus der
   Google-Fassung), Wert = Ordner unter /data/orte/. */
const KATEGORIE = {
  Motorradwerkstatt: 'werkstatt',
  'Motorradhändler': 'haendler',
  Fahrschule: 'fahrschule',
  Tankstelle: 'tankstelle',
  Parkplatz: 'parkplatz',
  Cafe: 'treff',
  Notdienst: 'werkstatt',
}
const FARBEN = {
  Motorradwerkstatt: { fill: '#ff6a13', label: 'Werkstatt' },
  'Motorradhändler': { fill: '#5ee61e', label: 'Händler' },
  Fahrschule: { fill: '#a020f0', label: 'Fahrschule' },
  Tankstelle: { fill: '#e63946', label: 'Tankstelle' },
  Parkplatz: { fill: '#2f7dd1', label: 'Motorradparkplatz' },
  Cafe: { fill: '#a9652e', label: 'Biker-Treff' },
  Notdienst: { fill: '#ffc300', label: 'Werkstatt' },
}
const GLYPHEN = {
  Motorradwerkstatt: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'Motorradhändler': '<path d="M20 7H4l1-3h14zM2 7h20v5H2zM4 12v9h4v-5h8v5h4v-9"/>',
  Fahrschule: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  Tankstelle: '<path d="M3 21h12M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M5 11h10M15 6l3 3v8a2 2 0 0 1-4 0v-2"/>',
  Parkplatz: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  Cafe: '<path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 1v3M10 1v3M14 1v3"/>',
  Notdienst: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
}

function glyphBild(filter, gross = false) {
  const farbe = FARBEN[filter]?.fill || '#fff'
  const g = GLYPHEN[filter] || GLYPHEN.Motorradwerkstatt
  const px = gross ? 46 : 34
  // Runde Plakette mit weißem Rand — auf der hellen Karte klar abgesetzt (wie die Punkte bei komoot)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 36 36" width="${px * 2}" height="${px * 2}"><circle cx="12" cy="12" r="15.5" fill="rgba(0,0,0,0.18)" transform="translate(0 1)"/><circle cx="12" cy="12" r="15" fill="${farbe}" stroke="#fff" stroke-width="2.6"/><g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(12 12) scale(0.66) translate(-12 -12)">${g}</g></svg>`
  return new Promise((ok, fehler) => {
    const img = new Image(px * 2, px * 2)
    img.onload = () => ok(img)
    img.onerror = fehler
    img.src = 'data:image/svg+xml,' + encodeURIComponent(svg)
  })
}

// ── Öffnungszeiten (OSM opening_hours, gängige Teilmenge) ────────────────

const TAGE = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
/** true/false = offen/zu, null = nicht lesbar oder unbekannt. */
export function istGeoeffnet(zeiten, jetzt = new Date()) {
  if (!zeiten) return null
  const s = zeiten.trim()
  if (s === '24/7') return true
  const tag = jetzt.getDay()
  const minute = jetzt.getHours() * 60 + jetzt.getMinutes()
  let ergebnis = null
  for (const regel of s.split(';').map((r) => r.trim()).filter(Boolean)) {
    if (/\b(PH|SH|week|[A-Z][a-z]{2} \d|easter|sunrise|sunset|\[)/.test(regel)) {
      if (/^PH\b/.test(regel)) continue // Feiertage: nicht auswertbar, überspringen
      return null
    }
    const m = regel.match(/^((?:[A-Z][a-z](?:-[A-Z][a-z])?,?)+)?\s*(.*)$/)
    if (!m) return null
    const tageTeil = m[1], zeitTeil = m[2].trim()
    let gilt = !tageTeil
    if (tageTeil) {
      for (const stueck of tageTeil.split(',').filter(Boolean)) {
        const [a, b] = stueck.split('-').map((x) => TAGE.indexOf(x))
        if (a < 0 || (b !== undefined && b < 0)) return null
        if (b === undefined ? a === tag : a <= b ? tag >= a && tag <= b : tag >= a || tag <= b) gilt = true
      }
    }
    if (!gilt) continue
    if (/^(off|closed)$/i.test(zeitTeil)) { ergebnis = false; continue }
    if (zeitTeil === '' || zeitTeil === '24/7') { ergebnis = true; continue }
    let offen = false
    for (const spanne of zeitTeil.split(',')) {
      const z = spanne.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/)
      if (!z) return null
      const von = +z[1] * 60 + +z[2]
      let bis = +z[3] * 60 + +z[4]
      if (bis <= von) bis += 24 * 60
      if (minute >= von && minute < bis) offen = true
    }
    ergebnis = offen
  }
  return ergebnis
}

// ── Standort ─────────────────────────────────────────────────────────────

function getUserLocation() {
  if (geoPromise) return geoPromise
  geoPromise = new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(false)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude
        userLng = pos.coords.longitude
        userLocationKnown = true
        zeigeStandort()
        resolve(true)
      },
      () => { geoPromise = null; resolve(false) },
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 60000 },
    )
  })
  return geoPromise
}

function zeigeStandort() {
  if (!karte || !ml || !userLocationKnown) return
  if (!userMarker) {
    const el = document.createElement('div')
    el.className = 'mm-standort-punkt'
    userMarker = new ml.Marker({ element: el }).setLngLat([userLng, userLat]).addTo(karte)
  } else userMarker.setLngLat([userLng, userLat])
}

export function getUserCoords() {
  if (!userLocationKnown) return { lat: null, lng: null }
  return { lat: userLat, lng: userLng }
}

// ── Karte ────────────────────────────────────────────────────────────────

/* Helle Landschaftskarte in der Art von komoot: kräftig grüner Wald, blaues
   Wasser, gelb-orange Hauptstraßen, damit man Landschaft und Strecke liest.
   Grundlage ist der OpenFreeMap-Stil "liberty", die Farben setzen wir hier. */
const STIL_FARBEN = {
  background: { 'background-color': '#f3f1e8' },
  park: { 'fill-color': '#cfe5b3' },
  landcover_wood: { 'fill-color': '#b9d996', 'fill-opacity': 0.9 },
  landcover_grass: { 'fill-color': '#dcebc4' },
  landuse_residential: { 'fill-color': '#ebe6db' },
  landuse_cemetery: { 'fill-color': '#d6e3c3' },
  water: { 'fill-color': '#a9d3f2' },
  waterway_river: { 'line-color': '#8cc2ec' },
  waterway_other: { 'line-color': '#8cc2ec' },
  waterway_tunnel: { 'line-color': '#8cc2ec' },
  building: { 'fill-color': '#e1dbcf' },
  road_motorway: { 'line-color': '#f5a05a' },
  road_motorway_casing: { 'line-color': '#d07a35' },
  road_motorway_link: { 'line-color': '#f5a05a' },
  road_motorway_link_casing: { 'line-color': '#d07a35' },
  road_trunk_primary: { 'line-color': '#fbd27c' },
  road_trunk_primary_casing: { 'line-color': '#d6a04c' },
  road_secondary_tertiary: { 'line-color': '#fff1bf' },
  road_secondary_tertiary_casing: { 'line-color': '#d8b46e' },
  bridge_motorway: { 'line-color': '#f5a05a' },
  bridge_trunk_primary: { 'line-color': '#fbd27c' },
  bridge_secondary_tertiary: { 'line-color': '#fff1bf' },
  water_name_point_label: { 'text-color': '#3f6f9e' },
  water_name_line_label: { 'text-color': '#3f6f9e' },
  label_village: { 'text-color': '#3a3a3a' },
  label_town: { 'text-color': '#262626' },
  label_city: { 'text-color': '#1a1a1a' },
  label_city_capital: { 'text-color': '#1a1a1a' },
}

/* Der Stil kommt als JSON und wird vor der Übergabe angepasst: Farben (s. o.),
   deutsche Namen, alle Adressen über den eigenen Proxy. */
async function ladeStil() {
  const r = await fetch(STIL_URL)
  if (!r.ok) throw new Error(`Kartenstil HTTP ${r.status}`)
  const stil = await r.json()
  // 3D-Gebäude kosten auf dem Handy Leistung und verdecken im Fahrmodus die Straße
  stil.layers = stil.layers.filter((l) => l.id !== 'building-3d')
  // Relief wie bei komoot: Schummerung aus freien Höhendaten (über die eigene Domain).
  // Zwei Quellen — MapLibre empfiehlt getrennte für Schummerung und 3D-Gelände.
  const hoehen = {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 12,
    tiles: [`${location.origin}/hoehe/{z}/{x}/{y}.png`],
    attribution: '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Höhen: Tilezen Joerd</a>',
  }
  // Schummerung mit 512er-Kacheln: MapLibre holt dann je Ansicht ein Viertel der
  // Höhenbilder (je ~130 KB) — sonst sind es über 50 und die Karte baut sich zäh auf.
  // Das Relief ist weich gezeichnet, die halbe Auflösung sieht man nicht.
  stil.sources.gelaende = { ...hoehen, tileSize: 512 }
  const { attribution: _quelle, ...ohneQuelle } = hoehen // Quellenangabe nur einmal
  stil.sources['gelaende-3d'] = ohneQuelle
  // Satellitenbild für "Strecke abfliegen" — normal ausgeblendet (touren.js schaltet es zu)
  stil.sources.satellit = {
    type: 'raster', tileSize: 256, maxzoom: 15,
    tiles: [`${location.origin}/satellit/{z}/{y}/{x}.jpg`],
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless by EOX</a> (Copernicus Sentinel 2016)',
  }
  const vorStrassen = stil.layers.findIndex((l) => /^(tunnel_|road_|bridge_)/.test(l.id))
  stil.layers.splice(vorStrassen < 0 ? stil.layers.length : vorStrassen, 0, {
    id: 'relief', type: 'hillshade', source: 'gelaende', minzoom: 5,
    paint: {
      'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 5, 0.25, 10, 0.4, 14, 0.3],
      'hillshade-shadow-color': 'rgba(52, 66, 40, 0.55)',
      'hillshade-highlight-color': 'rgba(255, 255, 250, 0.35)',
      'hillshade-accent-color': 'rgba(70, 80, 60, 0.25)',
      'hillshade-illumination-direction': 315,
    },
  }, {
    id: 'satellit', type: 'raster', source: 'satellit', layout: { visibility: 'none' },
    paint: { 'raster-saturation': 0.12, 'raster-contrast': 0.08, 'raster-brightness-max': 0.95, 'raster-fade-duration': 200 },
  })
  for (const l of stil.layers) {
    if (STIL_FARBEN[l.id]) l.paint = { ...l.paint, ...STIL_FARBEN[l.id] }
    // Deutsche Namen zuerst ("Niedersachsen" statt "Lower Saxony"), sonst der Ortsname —
    // nur in Ebenen, die Namen zeigen; Straßenschilder tragen die Nummer (ref)
    if (l.layout?.['text-field'] && JSON.stringify(l.layout['text-field']).includes('name') && !l.id.includes('shield')) {
      l.layout['text-field'] = ['coalesce', ['get', 'name:de'], ['get', 'name_de'], ['get', 'name'], ['get', 'name:latin']]
    }
  }
  return stil
}

let stilPromise = null
/** Fertig angepasster Kartenstil (einmal geladen, für Hauptkarte und Vorschaubilder). */
export function ladeKartenStil() {
  if (!stilPromise) stilPromise = ladeStil().catch((err) => { stilPromise = null; throw err })
  // Kopie: MapLibre verändert das übergebene Objekt
  return stilPromise.then((s) => structuredClone(s))
}

export const umleiten = (url) => (url.startsWith(KACHEL_HOST) ? { url: KACHEL_PROXY + url.slice(KACHEL_HOST.length) } : { url })

let _onMapMovedCallback = null
let _onMapReadyCallback = null
let _onResultsCallback = null

export function onHubMapMoved(cb) { _onMapMovedCallback = cb }
export function onHubMapReady(cb) {
  _onMapReadyCallback = cb
  if (karte && karte.loaded() && cb) try { cb(karte) } catch {}
}
export function onHubResults(cb) { _onResultsCallback = cb }
function emitResultsUpdate() { if (_onResultsCallback) try { _onResultsCallback(getHubMarkers()) } catch {} }
function emitMapReady() {
  if (_onMapReadyCallback) try { _onMapReadyCallback(karte) } catch (err) { console.warn('[karte] ready:', err) }
}

export function getHubMap() { return karte }
export function getHubMapCenter() {
  const c = karte?.getCenter()
  return c ? { lat: c.lat, lng: c.lng } : null
}

function zeigeFehler(el) {
  el.innerHTML = `
    <div class="hub-map-loading" id="hub-map-loading">
      <div class="hub-map-fehler-titel">Karte nicht verfügbar</div>
      <div class="hub-map-fehler-text">Die Karte konnte gerade nicht geladen werden. Prüfe deine Verbindung und versuch es noch einmal.</div>
      <button type="button" id="hub-map-retry-btn" class="hub-retry-btn">Erneut versuchen</button>
    </div>`
  el.querySelector('#hub-map-retry-btn')?.addEventListener('click', () => {
    el.innerHTML = '<div class="hub-map-loading" id="hub-map-loading"><span class="hub-map-spinner"></span><span>Karte wird geladen…</span></div>'
    initHubMap()
  })
}

let initToken = 0
/**
 * Karte in #hub-gmap aufbauen oder die bestehende dorthin umziehen.
 * Wartet NICHT auf den Standort: die Karte steht sofort (Deutschland bzw. der
 * letzte Standort), der Standort springt nach, sobald er da ist.
 */
export async function initHubMap() {
  const el = document.getElementById('hub-gmap')
  if (!el) return
  const token = ++initToken

  if (karte) {
    const feld = karte.getContainer()
    if (feld !== el) { el.replaceWith(feld); feld.id = 'hub-gmap' }
    karte.resize()
    await karteBereit
    emitMapReady()
    sucheAktiveKachel()
    if (!userLocationKnown) getUserLocation().then((ok) => { if (ok) standortGefunden() })
    return
  }

  try {
    const [, stil] = await Promise.all([ladeMapLibre(), ladeKartenStil()])
    if (token !== initToken || !document.body.contains(el)) return
    el.innerHTML = ''
    const blick = !userLocationKnown && letzterBlick()
    karte = new ml.Map({
      container: el,
      style: stil,
      center: blick ? [blick.lng, blick.lat] : [userLng, userLat],
      zoom: userLocationKnown ? 12.5 : blick ? blick.zoom : 5.4,
      attributionControl: { compact: true },
      transformRequest: umleiten,
      cooperativeGestures: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
    })
    karte.touchZoomRotate.disableRotation()
    if (import.meta.env.DEV) window.__mmKarte = karte // nur zum Prüfen im Dev-Server
    karteBereit = new Promise((ok) => karte.once('load', ok))
    karte.on('moveend', (e) => {
      blickMerken()
      // Nur Gesten des Nutzers — flyTo/fitBounds aus dem Code zählen nicht
      if (!e.originalEvent || !_onMapMovedCallback) return
      const c = karte.getCenter()
      try { _onMapMovedCallback({ lat: c.lat, lng: c.lng }) } catch {}
    })
    await karteBereit
    karte.__mmBereit = true
    await richteOrteEbenenEin()
    zeigeStandort()
    emitMapReady()
    if (userLocationKnown) sucheAktiveKachel()
    else getUserLocation().then((ok) => { if (ok) standortGefunden() })
  } catch (err) {
    console.warn('[karte] Init fehlgeschlagen:', err)
    karte = null
    zeigeFehler(el)
  }
}

/** Standort kam an: hinfliegen und die aktive Kachel suchen. */
function standortGefunden() {
  if (!karte) return
  if (!orteAusgesetzt) {
    const c = karte.getCenter()
    // Weite Flüge laden unterwegs alle Zwischenzooms — dann lieber direkt springen
    if (haversineKm(c.lat, c.lng, userLat, userLng) > 60) karte.jumpTo({ center: [userLng, userLat], zoom: 12.5 })
    else karte.flyTo({ center: [userLng, userLat], zoom: Math.max(karte.getZoom(), 11), duration: 700 })
  }
  sucheAktiveKachel()
  emitMapReady() // Touren rechnen Entfernungen neu
}

function sucheAktiveKachel() {
  const aktiv = document.querySelector('.hub-pill.active')
  if (aktiv && userLocationKnown) searchNearby(aktiv.dataset.query, letzterRadius || 5000)
  else emitResultsUpdate()
}

export function retryHubLocation() {
  geoPromise = null
  getUserLocation().then((ok) => {
    if (ok) standortGefunden()
    else emitResultsUpdate()
  })
}

export function recenterHubMap() {
  if (!karte) return
  if (!userLocationKnown) { retryHubLocation(); return }
  karte.flyTo({ center: [userLng, userLat], zoom: 13 })
}
export function zoomHubMap(delta) {
  if (!karte) return
  karte.easeTo({ zoom: karte.getZoom() + delta, duration: 250 })
}
export function panHubToCoords(lat, lng) {
  if (!karte) return false
  karte.flyTo({ center: [lng, lat], zoom: 15.5 })
  return true
}

/** Suchmitte verlegen (Ortssuche, "Hier suchen") und neu suchen. */
export function searchNearbyAt(lat, lng) {
  userLat = lat
  userLng = lng
  userLocationKnown = true
  if (!karte) { initHubMap(); return }
  if (!orteAusgesetzt) karte.flyTo({ center: [lng, lat], zoom: 12.5 })
  const aktiv = document.querySelector('.konf-karte-hub .hub-pill.active') || document.querySelector('.hub-pill.active')
  searchNearby(aktiv ? aktiv.dataset.query : letzterFilter || 'Motorradwerkstatt', letzterRadius || 5000)
}

// ── Orte ─────────────────────────────────────────────────────────────────

let orteIndex = null
const kachelSpeicher = new Map() // `${kat}/${zelle}` → Promise<Array>
let treffer = []
let letzterFilter = null
let letzterRadius = 0
let suchGeneration = 0
let orteAusgesetzt = false

function ladeOrteIndex() {
  if (!orteIndex) {
    orteIndex = fetch('/data/orte/index.json').then((r) => r.json()).catch((err) => { orteIndex = null; throw err })
  }
  return orteIndex
}
function ladeKachel(kat, zelle) {
  const k = `${kat}/${zelle}`
  if (!kachelSpeicher.has(k)) {
    kachelSpeicher.set(k, fetch(`/data/orte/${kat}/${zelle}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => { kachelSpeicher.delete(k); return [] }))
  }
  return kachelSpeicher.get(k)
}

async function richteOrteEbenenEin() {
  if (!karte || karte.getSource('orte')) return
  for (const f of Object.keys(GLYPHEN)) {
    try {
      karte.addImage(`ort-${f}`, await glyphBild(f), { pixelRatio: 2 })
    } catch (err) { console.warn('[karte] Symbol', f, err) }
  }
  karte.addSource('orte', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  karte.addLayer({
    id: 'orte-symbole',
    type: 'symbol',
    source: 'orte',
    layout: {
      'icon-image': ['concat', 'ort-', ['get', 'filter']],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 13, 1],
      'icon-allow-overlap': true,
      'symbol-sort-key': ['get', 'rang'],
    },
  })
  karte.on('click', 'orte-symbole', (e) => {
    const id = e.features?.[0]?.properties?.id
    if (id) focusHubResult(id, false)
  })
  karte.on('mouseenter', 'orte-symbole', () => { karte.getCanvas().style.cursor = 'pointer' })
  karte.on('mouseleave', 'orte-symbole', () => { karte.getCanvas().style.cursor = '' })
}

function setzeOrteAufKarte() {
  const quelle = karte?.getSource('orte')
  if (!quelle) return
  quelle.setData({
    type: 'FeatureCollection',
    features: orteAusgesetzt ? [] : treffer.map((t, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
      properties: { id: t.placeId, filter: letzterFilter, rang: i },
    })),
  })
}

/**
 * Orte einer Kategorie im Umkreis um die Suchmitte. Lädt nur die 1°-Kacheln,
 * die den Kreis berühren — höchstens vier bei 50 km.
 */
export async function searchNearby(filter, radius = 5000) {
  letzterFilter = filter
  letzterRadius = radius
  if (orteAusgesetzt) return
  const gen = ++suchGeneration
  popup?.remove()
  const kat = KATEGORIE[filter] || 'werkstatt'
  const lat = userLat, lng = userLng
  const km = radius / 1000
  try {
    const index = await ladeOrteIndex()
    const vorhanden = new Set(index.kategorien?.[kat]?.kacheln || [])
    const dLat = km / 111, dLng = km / (111 * Math.cos((lat * Math.PI) / 180))
    const zellen = []
    for (let a = Math.floor(lat - dLat); a <= Math.floor(lat + dLat); a++)
      for (let b = Math.floor(lng - dLng); b <= Math.floor(lng + dLng); b++)
        if (vorhanden.has(`${a}_${b}`)) zellen.push(`${a}_${b}`)
    const listen = await Promise.all(zellen.map((z) => ladeKachel(kat, z)))
    if (gen !== suchGeneration) return
    const jetzt = new Date()
    treffer = listen.flat()
      .map(([id, name, la, ln, adresse, tel, web, zeiten, marke]) => ({
        placeId: id,
        name: name || (kat === 'parkplatz' ? 'Motorradparkplatz' : kat === 'tankstelle' ? 'Tankstelle' : '—'),
        address: adresse || '',
        tel: tel || '', web: web || '', zeiten: zeiten || '', marke: marke || '',
        rating: null, userRatings: 0,
        isOpen: istGeoeffnet(zeiten, jetzt),
        lat: la, lng: ln,
        distanceKm: haversineKm(lat, lng, la, ln),
      }))
      .filter((t) => t.distanceKm <= km)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, MAX_TREFFER)
  } catch (err) {
    console.warn('[karte] Orte laden:', err)
    if (gen !== suchGeneration) return
    treffer = []
  }
  setzeOrteAufKarte()
  zeigeAlleTreffer(lat, lng)
  emitResultsUpdate()
}

/** Ausschnitt auf Suchmitte + Treffer legen, mit Platz für das Panel. */
function zeigeAlleTreffer(lat, lng) {
  if (!karte || orteAusgesetzt || !treffer.length) return
  let s = lat, n = lat, w = lng, o = lng
  for (const t of treffer.slice(0, 40)) {
    if (t.lat < s) s = t.lat; if (t.lat > n) n = t.lat
    if (t.lng < w) w = t.lng; if (t.lng > o) o = t.lng
  }
  const panel = document.querySelector('.konf-karte-hub .kv-sidebar')
  const mobil = window.matchMedia('(max-width: 759.98px)').matches
  const padding = !panel ? 60
    : mobil ? { top: 90, left: 40, right: 60, bottom: Math.min(window.innerHeight * 0.6, Math.max(140, window.innerHeight - panel.getBoundingClientRect().top + 16)) }
    : { top: 100, bottom: 50, left: panel.getBoundingClientRect().width + 60, right: 90 }
  karte.fitBounds([[w, s], [o, n]], { padding, maxZoom: 15, duration: 700 })
}

export function getHubSearchResults() {
  return treffer.map((t) => ({ ...t, distanceKm: haversineKm(userLat, userLng, t.lat, t.lng) }))
}
export function getHubMarkers() {
  return treffer.map((t) => ({ title: t.name, position: { lat: t.lat, lng: t.lng } }))
}
export function hatHubTreffer() { return treffer.length > 0 }

function infoHtml(t) {
  const f = FARBEN[letzterFilter] || FARBEN.Motorradwerkstatt
  const offen = t.isOpen === true ? '<span class="hub-info-offen">Geöffnet</span>' : t.isOpen === false ? '<span class="hub-info-zu">Geschlossen</span>' : ''
  return `<div class="hub-info">
    <span class="hub-info-name">${esc(t.name)}</span>
    <span class="hub-info-type" style="color:${f.fill}">${f.label}${t.marke && t.marke !== t.name ? ` · ${esc(t.marke)}` : ''}</span>
    ${t.address ? `<span class="hub-info-addr">${esc(t.address)}</span>` : ''}
    ${offen ? `<span class="hub-info-open">${offen}</span>` : ''}
  </div>`
}

/** Auf einen Treffer schwenken und sein Infofenster öffnen. */
export function focusHubResult(id, schwenken = true) {
  if (!karte || !ml) return false
  const t = treffer.find((x) => x.placeId === id)
  if (!t) return false
  if (schwenken) karte.flyTo({ center: [t.lng, t.lat], zoom: Math.max(karte.getZoom(), 15) })
  popup?.remove()
  popup = new ml.Popup({ offset: 18, closeButton: false, className: 'mm-popup', maxWidth: '260px' })
    .setLngLat([t.lng, t.lat]).setHTML(infoHtml(t)).addTo(karte)
  document.dispatchEvent(new CustomEvent('mm:ort-gewaehlt', { detail: { id } }))
  return true
}

/** Touren-Modus: Orte-Suche und -Symbole ruhen. */
export function setHubPlacesPausiert(an) {
  orteAusgesetzt = !!an
  if (an) popup?.remove()
  setzeOrteAufKarte()
}
/** Früher nötig, weil Google ohne Standort keine Karte baute — jetzt steht sie immer. */
export function setHubKarteOhneStandort() {}

/** Beim Verlassen der Garage: Suchzustand weg, Karte bleibt (wird wiederverwendet). */
export function resetHubSuche() {
  suchGeneration++
  treffer = []
  letzterFilter = null
  letzterRadius = 0
  popup?.remove()
  setzeOrteAufKarte()
}

// ── Ortssuche (PLZ / Ort) ────────────────────────────────────────────────

let suchIndex = null
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()

function ladeSuchIndex() {
  if (!suchIndex) {
    suchIndex = fetch('/data/orte/suche.json').then((r) => r.json()).then((j) => ({
      orte: j.orte.map(([name, lat, lng, rang, zusatz]) => ({ name, lat, lng, rang, zusatz, n: norm(name) })),
      plz: j.plz,
    })).catch((err) => { suchIndex = null; throw err })
  }
  return suchIndex
}

/**
 * Ort oder Postleitzahl zu Koordinaten auflösen.
 * @returns {Promise<{ok:true,lat:number,lng:number,label:string}|{ok:false,grund:'nicht_gefunden'|'technisch'}>}
 */
export async function resolveOrt(query) {
  let idx
  try { idx = await ladeSuchIndex() } catch { return { ok: false, grund: 'technisch' } }
  const q = query.trim()
  const plz = q.match(/^\d{5}$/)
  if (plz) {
    const p = idx.plz.find((x) => x[0] === q)
    return p ? { ok: true, lat: p[1], lng: p[2], label: `${p[0]} ${p[3] || ''}`.trim() } : { ok: false, grund: 'nicht_gefunden' }
  }
  const n = norm(q.replace(/^\d{5}\s+/, ''))
  if (!n) return { ok: false, grund: 'nicht_gefunden' }
  const kandidaten = idx.orte.filter((o) => o.n === n)
  const liste = kandidaten.length ? kandidaten : idx.orte.filter((o) => o.n.startsWith(n))
  if (!liste.length) return { ok: false, grund: 'nicht_gefunden' }
  // Stadt vor Ortsteil vor Dorf; bei Gleichstand der kürzere Name
  liste.sort((a, b) => a.rang - b.rang || a.name.length - b.name.length)
  const o = liste[0]
  return { ok: true, lat: o.lat, lng: o.lng, label: o.zusatz ? `${o.name}, ${o.zusatz}` : o.name }
}
