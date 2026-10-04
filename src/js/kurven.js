/* ═══════════════════════════════════════════════════
   KURVENSTRECKEN — alle kurvigen Straßen Deutschlands auf der Karte.

   Daten: public/data/kurven/<lat>_<lng>.json (1°-Kacheln), berechnet mit
   scripts/kurven/bauen.py aus OpenStreetMap: Kurvenradien je Knoten,
   enge Radien zählen gewichtet ("Kurvigkeit" in Metern, wie bei
   roadcurvature.com). Eintrag: [Bezeichnung, Kurvigkeit, Länge m, Polyline].
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { getHubMap, getMapLib, haversineKm } from './karte.js'

const MIN_ZOOM = 6.5
let indexPromise = null
const kacheln = new Map() // zelle → Promise<Array<strecke>>
let sichtbar = false
let popup = null
let gebundenAn = null

/* Farbe nach Kurvendichte (Kurvigkeit je km), nicht nach der Summe — sonst
   wirkt jede lange Straße "extrem". Grenzen aus der Verteilung der eigenen
   Daten: ab 400 die obersten ~8 % (B 308 Jochstraße, Wehratal …).
   Violett statt Rot/Orange: Straßen sind im Kartenstil gelb/orange, und rote
   Stücke lesen sich wie Baustellen. Violett kommt sonst nirgends vor. */
export const STUFEN = [
  { ab: 400, label: 'Extrem kurvig', farbe: '#9c1fd6' },
  { ab: 250, label: 'Sehr kurvig', farbe: '#b44ee8' },
  { ab: 0, label: 'Kurvig', farbe: '#c98af2' },
]
const FARBE = ['step', ['get', 'dichte'], STUFEN[2].farbe, STUFEN[1].ab, STUFEN[1].farbe, STUFEN[0].ab, STUFEN[0].farbe]
// Kurvigere Strecken etwas breiter, damit die Stufen auch ohne Farbsinn lesbar sind
const BREITE = (basis) => ['*', basis, ['step', ['get', 'dichte'], 1, STUFEN[1].ab, 1.2, STUFEN[0].ab, 1.4]]
const dichte = (k) => Math.round((k.kurvig / Math.max(k.laenge, 1)) * 1000)
export const stufe = (k) => STUFEN.find((s) => dichte(k) >= s.ab)

function dekodieren(s) {
  const pts = []
  let i = 0, lat = 0, lng = 0
  const zahl = () => {
    let e = 0, sh = 0, b
    do { b = s.charCodeAt(i++) - 63; e |= (b & 0x1f) << sh; sh += 5 } while (b >= 0x20)
    return e & 1 ? ~(e >> 1) : e >> 1
  }
  while (i < s.length) { lat += zahl(); lng += zahl(); pts.push([lat / 1e5, lng / 1e5]) }
  return pts
}

function ladeIndex() {
  if (!indexPromise) indexPromise = fetch('/data/kurven/index.json').then((r) => r.json()).then((j) => new Set(j.kacheln)).catch(() => { indexPromise = null; return new Set() })
  return indexPromise
}

function ladeKachel(zelle) {
  if (!kacheln.has(zelle)) {
    kacheln.set(zelle, fetch(`/data/kurven/${zelle}.json`).then((r) => (r.ok ? r.json() : [])).then((liste) =>
      liste.map(([name, kurvig, laenge, linie], i) => ({ id: `${zelle}:${i}`, name, kurvig, laenge, pts: dekodieren(linie) }))
    ).catch(() => { kacheln.delete(zelle); return [] }))
  }
  return kacheln.get(zelle)
}

/** Alle Kurvenstrecken im Rechteck (Süd, West, Nord, Ost). */
export async function streckenIn(s, w, n, o) {
  const index = await ladeIndex()
  const zellen = []
  for (let a = Math.floor(s); a <= Math.floor(n); a++)
    for (let b = Math.floor(w); b <= Math.floor(o); b++)
      if (index.has(`${a}_${b}`)) zellen.push(`${a}_${b}`)
  return (await Promise.all(zellen.slice(0, 24).map(ladeKachel))).flat()
}

/** Kurvenstrecken im Umkreis, kurvigste zuerst — für das Band in der Tourenliste. */
export async function kurvenInDerNaehe(lat, lng, km = 60, max = 10) {
  const dLat = km / 111, dLng = km / (111 * Math.cos((lat * Math.PI) / 180))
  const alle = await streckenIn(lat - dLat, lng - dLng, lat + dLat, lng + dLng)
  return alle
    .map((k) => ({ ...k, abstand: Math.min(...k.pts.filter((_, i) => i % 4 === 0).map(([a, b]) => haversineKm(lat, lng, a, b))) }))
    .filter((k) => k.abstand <= km)
    // Kurvig UND lang genug zum Fahren: Summe als Maß, Dichte nur für die Farbe
    .sort((a, b) => b.kurvig - a.kurvig)
    .slice(0, max)
}

export function findeStrecke(id) {
  const zelle = id.split(':')[0]
  return ladeKachel(zelle).then((l) => l.find((k) => k.id === id))
}

const zuFeature = (k) => ({
  type: 'Feature',
  properties: { id: k.id, kurvig: k.kurvig, dichte: dichte(k), name: k.name || '' },
  geometry: { type: 'LineString', coordinates: k.pts.map(([a, b]) => [b, a]) },
})

/** Runde Plakette mit Serpentine — erkennbar als "Kurven", nicht als Warnzeichen. */
function kurvenZeichen() {
  const g = 44, c = document.createElement('canvas')
  c.width = c.height = g
  const x = c.getContext('2d')
  x.fillStyle = '#ffffff'
  x.beginPath(); x.arc(g / 2, g / 2, g / 2 - 1, 0, Math.PI * 2); x.fill()
  x.fillStyle = STUFEN[0].farbe
  x.beginPath(); x.arc(g / 2, g / 2, g / 2 - 4, 0, Math.PI * 2); x.fill()
  x.strokeStyle = '#ffffff'; x.lineWidth = 3.6; x.lineCap = 'round'; x.lineJoin = 'round'
  x.beginPath()
  x.moveTo(13, 31); x.bezierCurveTo(13, 22, 22, 26, 22, 22); x.bezierCurveTo(22, 17, 31, 21, 31, 13)
  x.stroke()
  return x.getImageData(0, 0, g, g)
}

const EBENEN = ['kurven-rand', 'kurven-linie', 'kurven-zeichen']

function ebene(map) {
  if (map.getSource('kurven')) return
  map.addSource('kurven', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  if (!map.hasImage('kurven-zeichen')) map.addImage('kurven-zeichen', kurvenZeichen(), { pixelRatio: 2 })
  const vor = map.getLayer('touren-linie') ? 'touren-linie' : undefined
  const zoomBreite = (a, b, c) => ['interpolate', ['linear'], ['zoom'], 7, BREITE(a), 11, BREITE(b), 14, BREITE(c)]
  // Weißer Rand: hebt die Linie von Straßen und Relief ab
  map.addLayer({
    id: 'kurven-rand', type: 'line', source: 'kurven',
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': '#ffffff', 'line-width': zoomBreite(3.4, 5.6, 9), 'line-opacity': 0.95 },
  }, vor)
  map.addLayer({
    id: 'kurven-linie', type: 'line', source: 'kurven',
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
    paint: { 'line-color': FARBE, 'line-width': zoomBreite(1.8, 3.2, 5.5) },
  }, vor)
  // Kurven-Zeichen auf der Linie und der Straßenname — ab mittlerem Zoom
  map.addLayer({
    id: 'kurven-zeichen', type: 'symbol', source: 'kurven', minzoom: 11,
    layout: {
      visibility: 'none',
      'symbol-placement': 'line-center',
      'icon-image': 'kurven-zeichen',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.75, 14, 1],
      'icon-rotation-alignment': 'viewport',
      'text-field': ['step', ['zoom'], '', 12, ['get', 'name']],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11.5,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': '#5f1690', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  }, vor)
  for (const id of ['kurven-rand', 'kurven-zeichen']) {
    map.on('click', id, async (e) => {
      const fid = e.features?.[0]?.properties?.id
      const k = fid && await findeStrecke(fid)
      if (k) zeigeStrecke(k, { schwenken: false, lngLat: e.lngLat })
    })
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
  }
}

async function aktualisieren() {
  const map = getHubMap()
  if (!map?.__mmBereit || !sichtbar) return
  ebene(map)
  // Legende nur, wenn auch Linien zu sehen sind
  map.getContainer().querySelector('.kurven-legende')?.toggleAttribute('hidden', map.getZoom() < MIN_ZOOM)
  if (map.getZoom() < MIN_ZOOM) {
    map.getSource('kurven').setData({ type: 'FeatureCollection', features: [] })
    return
  }
  const b = map.getBounds()
  const liste = await streckenIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())
  if (!sichtbar) return
  // Weit draußen nur die kurvigsten, sonst ist jede Landstraße eingefärbt
  const z = map.getZoom()
  const ab = z < 8 ? 2500 : z < 9.5 ? 1500 : z < 11 ? 1000 : 0
  map.getSource('kurven').setData({ type: 'FeatureCollection', features: liste.filter((k) => k.kurvig >= ab).map(zuFeature) })
}

/** Kleine Legende unten auf der Karte, solange die Ebene an ist. */
function legende(map, an) {
  const wurzel = map.getContainer()
  let el = wurzel.querySelector('.kurven-legende')
  if (!an) { el?.remove(); return }
  if (el) return
  el = document.createElement('div')
  el.className = 'kurven-legende'
  el.innerHTML = `<span class="kurven-legende-titel">Kurvenstrecken</span>${[...STUFEN].reverse().map((s) =>
    `<span class="kurven-legende-stufe"><i style="background:${s.farbe}"></i>${s.label.replace(' kurvig', '')}</span>`).join('')}`
  wurzel.appendChild(el)
}

/** Kurvenstrecken-Ebene ein-/ausschalten. */
export function setKurvenSichtbar(an) {
  sichtbar = !!an
  const map = getHubMap()
  if (!map?.__mmBereit) return
  ebene(map)
  for (const id of EBENEN) map.setLayoutProperty(id, 'visibility', an ? 'visible' : 'none')
  legende(map, an)
  if (gebundenAn !== map) {
    gebundenAn = map
    map.on('moveend', aktualisieren)
  }
  if (!an) popup?.remove()
  aktualisieren()
}
export const kurvenSichtbar = () => sichtbar

function grenzen(pts) {
  let s = 90, w = 180, n = -90, o = -180
  for (const [a, b] of pts) { if (a < s) s = a; if (a > n) n = a; if (b < w) w = b; if (b > o) o = b }
  return [[w, s], [o, n]]
}

/** Strecke zeigen: hinschwenken, Infofenster mit "Strecke fahren". */
export function zeigeStrecke(k, { schwenken = true, lngLat = null, padding = 80 } = {}) {
  const map = getHubMap(), ml = getMapLib()
  if (!map || !ml) return
  if (schwenken) map.fitBounds(grenzen(k.pts), { padding, duration: 700, maxZoom: 13.5 })
  const st = stufe(k)
  popup?.remove()
  const el = document.createElement('div')
  el.className = 'hub-info'
  el.innerHTML = `
    <span class="hub-info-name">${esc(k.name || 'Kurvenstrecke')}</span>
    <span class="hub-info-type" style="color:${st.farbe}">${st.label}</span>
    <span class="hub-info-addr">${(k.laenge / 1000).toFixed(1).replace('.', ',')} km · Kurvigkeit ${k.kurvig.toLocaleString('de-DE')}</span>
    <button type="button" class="kurve-fahren">Strecke fahren</button>`
  el.querySelector('.kurve-fahren').addEventListener('click', () => streckeFahren(k))
  const mitte = k.pts[Math.floor(k.pts.length / 2)]
  popup = new ml.Popup({ offset: 10, closeButton: true, className: 'mm-popup', maxWidth: '260px' })
    .setLngLat(lngLat || [mitte[1], mitte[0]]).setDOMContent(el).addTo(map)
}

/** Kurvenstrecke mit dem Fahrmodus abfahren (ohne Abbiegehinweise — nur Linie und Rest). */
export async function streckeFahren(k) {
  popup?.remove()
  const kum = [0]
  for (let i = 1; i < k.pts.length; i++) kum.push(kum[i - 1] + haversineKm(k.pts[i - 1][0], k.pts[i - 1][1], k.pts[i][0], k.pts[i][1]) * 1000)
  const gesamt = kum[kum.length - 1]
  const t = { id: k.id, name: k.name || 'Kurvenstrecke', typ: 'strecke', min: Math.max(1, Math.round((gesamt / 1000 / 50) * 60)) }
  const d = { pts: k.pts, kum, schritte: [[Math.round(gesamt), 'arrive', '', '', 0]] }
  const map = getHubMap()
  if (map?.getSource('tour-detail')) map.getSource('tour-detail').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: k.pts.map(([a, b]) => [b, a]) } })
  const { fahrtVorbereiten } = await import('./tour-fahren.js')
  fahrtVorbereiten(t, d, { zurueck: () => import('./touren.js').then((m) => m.zeigeTourenListe()) })
}
