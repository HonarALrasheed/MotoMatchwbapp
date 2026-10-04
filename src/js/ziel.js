/* ═══════════════════════════════════════════════════
   ZIEL — zu einem gesuchten Ort oder Treffer hinfahren (wie bei Google Maps).

   Kleine Karte an der Stecknadel: Name, Adresse, "Route". Die Route kommt
   von deinem Standort über /api/route; danach stehen Länge und Fahrzeit da
   und "Losfahren" startet das Navi (tour-fahren.js, mit Heike).
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { getHubMap, getMapLib, getUserCoords } from './karte.js'
import { route, RoutingFehler } from './routing.js'

const LEER = { type: 'FeatureCollection', features: [] }
let popup = null
let aktuell = null

const ICON = {
  route: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>',
}

function ebene(map) {
  if (map.getSource('ziel-route')) return
  map.addSource('ziel-route', { type: 'geojson', data: LEER })
  map.addLayer({ id: 'ziel-route-rand', type: 'line', source: 'ziel-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } })
  map.addLayer({ id: 'ziel-route-linie', type: 'line', source: 'ziel-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1f7bff', 'line-width': 5.5 } })
}

function linie(pts) {
  const map = getHubMap()
  if (!map) return
  ebene(map)
  map.getSource('ziel-route').setData(pts ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([la, ln]) => [ln, la]) } } : LEER)
}

/** Eigener Standort — bekannt oder frisch erfragt. */
function standort() {
  const u = getUserCoords()
  if (u.lat != null) return Promise.resolve(u)
  return new Promise((ok, nein) => {
    if (!navigator.geolocation) { nein(new Error('Dein Browser gibt keinen Standort frei.')); return }
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => nein(new Error('Ohne deinen Standort lässt sich keine Route berechnen. Erlaube ihn in den Website-Einstellungen.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  })
}

const dauer = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m} Min` }
const kmText = (m) => (m / 1000).toFixed(m >= 100000 ? 0 : 1).replace('.', ',')

function inhalt(el, v, zustand = {}) {
  const { laedt, ergebnis, fehler } = zustand
  el.innerHTML = `
    <span class="hub-info-name">${esc(v.titel)}</span>
    ${v.zusatz ? `<span class="hub-info-addr">${esc(v.zusatz)}</span>` : ''}
    ${ergebnis ? `<span class="ziel-werte"><strong>${dauer(ergebnis.sekunden)}</strong> · ${kmText(ergebnis.meter)} km</span>` : ''}
    ${fehler ? `<span class="ziel-fehler">${esc(fehler)}</span>` : ''}
    <div class="ziel-knoepfe">
      ${ergebnis
        ? '<button type="button" class="ziel-los" data-ziel="los">Losfahren</button>'
        : `<button type="button" class="ziel-route" data-ziel="route" ${laedt ? 'disabled' : ''}>${ICON.route}<span>${laedt ? 'Route wird berechnet …' : 'Route'}</span></button>`}
    </div>`
}

/**
 * Karte an einem Ziel öffnen (Stecknadel der Suche, Treffer der Orte-Liste).
 * @param {{ titel: string, zusatz?: string, lat: number, lng: number }} v
 * @param {{ sofortRoute?: boolean }} opts  sofortRoute rechnet gleich los
 */
export function zielZeigen(v, { sofortRoute = false } = {}) {
  const map = getHubMap(), ml = getMapLib()
  if (!map || !ml || !v) return
  zielWeg()
  aktuell = { v, ergebnis: null }
  const el = document.createElement('div')
  el.className = 'hub-info ziel-karte'
  inhalt(el, v)
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ziel]')
    if (!b || !aktuell || aktuell.v !== v) return
    if (b.dataset.ziel === 'route') rechnen(el, v)
    if (b.dataset.ziel === 'los' && aktuell.ergebnis) losfahren(v, aktuell.ergebnis)
  })
  const mobil = window.matchMedia('(max-width: 759.98px)').matches
  popup = new ml.Popup({ offset: [0, -38], anchor: mobil ? 'bottom' : undefined, closeButton: true, closeOnClick: false, className: 'mm-popup', maxWidth: '280px' })
    .setLngLat([v.lng, v.lat]).setDOMContent(el).addTo(map)
  popup.on('close', () => { if (aktuell?.v === v) { aktuell = null; linie(null) } })
  if (sofortRoute) rechnen(el, v)
}

async function rechnen(el, v) {
  inhalt(el, v, { laedt: true })
  try {
    const pos = await standort()
    const r = await route([[pos.lat, pos.lng], [v.lat, v.lng]])
    if (aktuell?.v !== v) return
    aktuell.ergebnis = r
    inhalt(el, v, { ergebnis: r })
    linie(r.pts)
    // Ganze Route zeigen, Panel links (Desktop) bzw. unten (Handy) freihalten
    const map = getHubMap()
    let s = 90, w = 180, n = -90, o = -180
    for (const [la, ln] of r.pts) { if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > o) o = ln }
    const panel = document.querySelector('.konf-karte-hub .kv-sidebar')
    const mobil = window.matchMedia('(max-width: 759.98px)').matches
    // Handy: unten liegt das Panel — darüber bleibt Platz für Linie und diese Karte
    const unten = mobil ? Math.max(120, window.innerHeight - (panel?.getBoundingClientRect().top ?? window.innerHeight)) + 40 : 60
    if (map.getCanvas().clientWidth) map.fitBounds([[w, s], [o, n]], { padding: mobil ? { top: 200, bottom: Math.min(unten, window.innerHeight * 0.5), left: 120, right: 120 } /* Karte am Pin passt seitlich drauf */ : { top: 140, bottom: unten, left: (panel?.getBoundingClientRect().width || 0) + 60, right: 90 }, duration: 800, maxZoom: 15 })
  } catch (err) {
    if (aktuell?.v !== v) return
    inhalt(el, v, { fehler: err instanceof RoutingFehler || err?.message ? err.message : 'Die Route konnte nicht berechnet werden.' })
  }
}

async function losfahren(v, r) {
  const t = { id: `ziel-${Math.round(v.lat * 1e4)}-${Math.round(v.lng * 1e4)}`, name: v.titel, typ: 'strecke', min: Math.max(1, Math.round((r.sekunden || 0) / 60)), km: Math.round(r.meter / 1000) }
  zielWeg()
  document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: false } }))
  const { starteFahrt } = await import('./tour-fahren.js')
  starteFahrt(t, r)
}

/** Karte und Routenlinie weg (neue Suche, Mein Standort, Moduswechsel). */
export function zielWeg() {
  aktuell = null
  popup?.remove()
  popup = null
  linie(null)
}
