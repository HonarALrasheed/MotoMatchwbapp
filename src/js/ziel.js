/* ═══════════════════════════════════════════════════
   ZIEL — zu einer gesuchten Adresse oder einem Ort hinfahren (wie Google Maps).

   Nach der Wahl einer Adresse legt sich eine Zielkarte über das Panel:
   Adresse, sofort die Route ab dem eigenen Standort (Dauer · km) und
   "Losfahren". Von dort: kurvige Variante im Planer, Touren in der Nähe.
   Auf dem Handy bleibt eingeklappt die Kurzzeile mit "Los" stehen.
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { getHubMap, getUserCoords } from './karte.js'
import { route } from './routing.js'

const LEER = { type: 'FeatureCollection', features: [] }
let aktuell = null // { v, el, ergebnis, laedt, fehler }

const ICON = {
  zurueck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  ich: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8"/></svg>',
  los: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>',
  kurvig: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20c0-5 4-6 8-8s8-3 8-8"/></svg>',
  touren: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/></svg>',
}

const dauer = (s) => { const m = Math.max(1, Math.round(s / 60)); return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m} Min` }
const kmText = (m) => (m / 1000).toFixed(m >= 100000 ? 0 : 1).replace('.', ',')
const mobil = () => window.matchMedia('(max-width: 759.98px)').matches

function ebene(map) {
  if (map.getSource('ziel-route')) return
  map.addSource('ziel-route', { type: 'geojson', data: LEER })
  map.addLayer({ id: 'ziel-route-rand', type: 'line', source: 'ziel-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } })
  map.addLayer({ id: 'ziel-route-linie', type: 'line', source: 'ziel-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1f7bff', 'line-width': 5.5 } })
}

function linie(pts) {
  const map = getHubMap()
  if (!map?.__mmBereit) return
  ebene(map)
  map.getSource('ziel-route').setData(pts ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([la, ln]) => [ln, la]) } } : LEER)
}

/** Eigener Standort — bekannt oder frisch erfragt. */
function standort() {
  const u = getUserCoords()
  if (u.lat != null) return Promise.resolve(u)
  return new Promise((ok, nein) => {
    if (!navigator.geolocation) { nein(new Error('kein-standort')); return }
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => nein(new Error('kein-standort')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  })
}

/** Karte so legen, dass Route (oder Ziel) neben bzw. über dem Panel frei liegt. */
function einpassen(pts) {
  const map = getHubMap()
  if (!map?.getCanvas().clientWidth) return
  const panel = document.querySelector('.konf-karte-hub .kv-sidebar')
  if (pts.length < 2) { map.flyTo({ center: [pts[0][1], pts[0][0]], zoom: 15, duration: 800 }); return }
  let s = 90, w = 180, n = -90, o = -180
  for (const [la, ln] of pts) { if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > o) o = ln }
  const padding = mobil()
    ? { top: 110, left: 40, right: 70, bottom: Math.min(window.innerHeight * 0.55, Math.max(150, window.innerHeight - (panel?.getBoundingClientRect().top ?? window.innerHeight)) + 30) }
    : { top: 110, bottom: 60, left: (panel?.getBoundingClientRect().width || 0) + 70, right: 90 }
  map.fitBounds([[w, s], [o, n]], { padding, duration: 800, maxZoom: 15 })
}

function zeichnen() {
  const a = aktuell
  if (!a) return
  const { v, ergebnis: r, laedt, fehler } = a
  a.el.innerHTML = `
    <div class="ziel-kopf">
      <button type="button" class="plan-icon" data-ziel="zu" aria-label="Zurück">${ICON.zurueck}</button>
      <div class="ziel-name"><strong>${esc(v.titel)}</strong>${v.zusatz ? `<em>${esc(v.zusatz)}</em>` : ''}</div>
    </div>
    <div class="ziel-kurz">
      ${r ? `<span class="ziel-zeit"><strong>${dauer(r.sekunden || 0)}</strong><em>${kmText(r.meter)} km · schnellste Route</em></span>
             <button type="button" class="fahrt-los ziel-los" data-ziel="los">${ICON.los}<span>Los</span></button>`
        : laedt ? '<span class="ziel-zeit ziel-zeit--laedt"><span class="hub-map-spinner"></span><em>Route wird berechnet …</em></span>'
        : fehler === 'kein-standort' ? `<span class="ziel-zeit"><em>Für die Route brauchen wir deinen Standort.</em></span>
             <button type="button" class="tour-btn ziel-nochmal" data-ziel="route">Standort nutzen</button>`
        : fehler ? `<span class="ziel-zeit"><em>${esc(fehler)}</em></span><button type="button" class="tour-btn ziel-nochmal" data-ziel="route">Nochmal</button>` : ''}
    </div>
    ${r ? `<ol class="ziel-weg">
      <li>${ICON.ich}<span>Mein Standort</span></li>
      <li>${ICON.pin}<span>${esc(v.titel)}</span></li>
    </ol>` : ''}
    <div class="ziel-mehr">
      <button type="button" class="ziel-option" data-ziel="kurvig">${ICON.kurvig}<span><strong>Kurvige Route planen</strong><em>Im Planer — Start und Ziel sind schon gesetzt</em></span></button>
      <button type="button" class="ziel-option" data-ziel="touren">${ICON.touren}<span><strong>Touren in der Nähe</strong><em>Ausfahrten rund um dieses Ziel</em></span></button>
    </div>`
  document.dispatchEvent(new CustomEvent('mm:kv-peek'))
}

async function rechnen() {
  const a = aktuell
  if (!a) return
  a.laedt = true; a.fehler = null; a.ergebnis = null
  zeichnen()
  try {
    const pos = await standort()
    const r = await route([[pos.lat, pos.lng], [a.v.lat, a.v.lng]])
    if (aktuell !== a) return
    a.ergebnis = r
    linie(r.pts)
    einpassen(r.pts)
  } catch (err) {
    if (aktuell !== a) return
    a.fehler = err?.message === 'kein-standort' ? 'kein-standort' : (err?.message || 'Die Route konnte nicht berechnet werden.')
    einpassen([[a.v.lat, a.v.lng]])
  }
  a.laedt = false
  zeichnen()
}

/**
 * Zielkarte über dem Panel öffnen und gleich die Route rechnen.
 * @param {{ titel: string, zusatz?: string, lat: number, lng: number }} v
 */
export function zielZeigen(v) {
  const sidebar = document.querySelector('.konf-karte-hub .kv-sidebar')
  if (!sidebar || !v) return
  zielWeg({ still: true })
  const el = document.createElement('div')
  el.className = 'ziel-panel'
  sidebar.appendChild(el)
  sidebar.classList.add('kv-ziel-offen')
  aktuell = { v, el, ergebnis: null }
  const zuTouren = () => {
    if (document.querySelector('.konf-karte-hub .kv-sidebar')?.dataset.modus !== 'touren') document.querySelector('.kv-modus-btn[data-modus="touren"]')?.click()
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ziel]')
    const a = aktuell
    if (!b || !a || a.el !== el) return
    const was = b.dataset.ziel
    if (was === 'zu') zielWeg()
    if (was === 'route') rechnen()
    if (was === 'los' && a.ergebnis) losfahren(a.v, a.ergebnis)
    if (was === 'kurvig') {
      zielWeg({ still: true })
      zuTouren()
      import('./touren.js').then((m) => m.planeZu({ ...a.v, modus: 'kurvig' }))
    }
    if (was === 'touren') {
      zielWeg({ still: true })
      zuTouren()
      import('./touren.js').then((m) => m.setTourenHerkunft(a.v.lat, a.v.lng))
    }
  })
  // Handy: eingeklappt — oben bleiben Ziel, Dauer und "Los" stehen
  document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: false } }))
  rechnen()
}

async function losfahren(v, r) {
  const t = { id: `ziel-${Math.round(v.lat * 1e4)}-${Math.round(v.lng * 1e4)}`, name: v.titel, typ: 'strecke', min: Math.max(1, Math.round((r.sekunden || 0) / 60)), km: Math.round(r.meter / 1000) }
  zielWeg()
  document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: false } }))
  const { starteFahrt } = await import('./tour-fahren.js')
  starteFahrt(t, r)
}

export const zielOffen = () => !!aktuell

/** Zielkarte und Routenlinie weg. Ohne still auch Stecknadel und Suchfeld leeren. */
export function zielWeg({ still = false } = {}) {
  const a = aktuell
  aktuell = null
  a?.el.remove()
  document.querySelector('.konf-karte-hub .kv-sidebar')?.classList.remove('kv-ziel-offen')
  linie(null)
  if (!still && a) {
    import('./karte.js').then((m) => m.entferneSuchPin?.())
    const eingabe = document.getElementById('kv-search-input')
    if (eingabe) eingabe.value = ''
  }
  document.dispatchEvent(new CustomEvent('mm:kv-peek'))
}
