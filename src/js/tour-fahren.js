/* ═══════════════════════════════════════════════════
   TOUR FAHREN — Startbildschirm und Navigation, ohne die App zu verlassen.

   1. fahrtVorbereiten(t, d): Startbildschirm im Panel. Standort holen,
      Einstieg wählen (Rundtour: nächster Punkt der Strecke), Richtung,
      Anfahrt zum Start berechnen (routing.js → /api/route) und zeigen.
   2. starteFahrt(t, strecke): Navi über der Karte. Abbiegehinweise mit
      Ansage, Ankunftszeit, Tempo; wer die Strecke verlässt, bekommt eine neu
      berechnete Rückführung (fällt das Netz aus: Richtung zur Linie).

   Grenzen einer Web-App: bei gesperrtem Bildschirm liefert der Browser keinen
   Standort mehr — deshalb Wake Lock. Mit dem Handy in der Halterung ist der
   Bildschirm ohnehin an.

   Zum Testen ohne Fahrt: localStorage.mm_sim_fahrt = '1' simuliert die
   Bewegung entlang der Strecke (Start: localStorage.mm_sim_start = 'lat,lng').
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { getHubMap, getMapLib, haversineKm, getUserCoords } from './karte.js'
import { wetterEntlang, wetterWarnung, wetterSymbol } from './wetter.js'
import { starteAufzeichnung } from './ride-tracker.js'

const LS_MITSCHNEIDEN = 'mm_fahrt_aufzeichnen_v1'
const mitschneidenGemerkt = () => { try { return localStorage.getItem(LS_MITSCHNEIDEN) !== '0' } catch { return true } }
import { route, naechster, teil, verbinde, rundAb, kumuliert, stuetzpunkte, RoutingFehler } from './routing.js'

const ABSEITS_M = 60 // ab hier gilt man als neben der Strecke
const ANSAGEN_M = [800, 250, 60] // Ansagen vor einem Hinweis
const ANFAHRT_AB_M = 150 // näher als das: direkt auf der Strecke starten

let fahrt = null
let vorbereitung = null

const sim = () => { try { return localStorage.getItem('mm_sim_fahrt') === '1' } catch { return false } }

// ── Texte und Symbole ────────────────────────────────────────────────────

const RICHTUNG = {
  left: 'links', right: 'rechts', 'slight left': 'leicht links', 'slight right': 'leicht rechts',
  'sharp left': 'scharf links', 'sharp right': 'scharf rechts', straight: 'geradeaus', uturn: 'wenden',
}

/** Hinweis als Satz: "Rechts abbiegen auf L 782". */
function satz([, art, richtung, strasse, ausfahrt]) {
  const r = RICHTUNG[richtung] || ''
  const auf = strasse ? ` auf ${strasse}` : ''
  switch (art) {
    case 'arrive': return 'Ziel erreicht'
    case 'waypoint': return strasse || 'Start der Tour'
    case 'depart': return strasse ? `Losfahren auf ${strasse}` : 'Losfahren'
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return `Im Kreisverkehr ${ausfahrt ? `die ${ausfahrt}. Ausfahrt` : 'ausfahren'}${auf}`
    case 'exit roundabout': case 'exit rotary': return `Kreisverkehr verlassen${auf}`
    case 'merge': return `Einfädeln${auf}`
    case 'on ramp': return `Auffahrt ${r}${auf}`.replace('  ', ' ')
    case 'off ramp': return `Ausfahrt ${r}${auf}`.replace('  ', ' ')
    case 'fork': return `An der Gabelung ${r} halten${auf}`
    case 'end of road': return `Am Ende der Straße ${r}${auf}`
    default:
      if (richtung === 'uturn') return 'Wenden'
      if (richtung === 'straight' || !r) return `Geradeaus weiter${auf}`
      return `${r.charAt(0).toUpperCase() + r.slice(1)} abbiegen${auf}`
  }
}

function pfeil([, art, richtung]) {
  if (art === 'arrive') return '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>'
  if (art === 'waypoint') return '<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>'
  if (/roundabout|rotary/.test(art)) return '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="4.5"/><path d="M12 14.5V22M15.2 6.8l3.3-3.3M18.5 3.5H15M18.5 3.5V7"/></svg>'
  const winkel = { left: -90, right: 90, 'slight left': -45, 'slight right': 45, 'sharp left': -135, 'sharp right': 135, uturn: 180 }[richtung] ?? 0
  if (richtung === 'uturn') return '<svg viewBox="0 0 24 24"><path d="M8 21V9a5 5 0 0 1 10 0v4M14 9l4 4 4-4"/></svg>'
  return `<svg viewBox="0 0 24 24"><g transform="rotate(${winkel} 12 14)"><path d="M12 22V5M6 10.5l6-6 6 6"/></g></svg>`
}

const mFormat = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',')} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`)
const mSprache = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',')} Kilometern` : `${Math.max(10, Math.round(m / 50) * 50)} Metern`)
const dauer = (min) => (min >= 60 ? `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')} Std` : `${Math.max(1, Math.round(min))} Min`)
const uhr = (minAb) => new Date(Date.now() + minAb * 60000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

let stimme = null
function sprich(text, ton = fahrt?.ton) {
  if (!ton || !('speechSynthesis' in window)) return
  try {
    if (!stimme) stimme = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('de')) || null
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'de-DE'
    if (stimme) u.voice = stimme
    u.rate = 1.03
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {}
}

// ── Standort ─────────────────────────────────────────────────────────────

function simStart() {
  try {
    const [la, ln] = (localStorage.getItem('mm_sim_start') || '').split(',').map(Number)
    if (Number.isFinite(la) && Number.isFinite(ln)) return { lat: la, lng: ln }
  } catch {}
  return null
}

async function standortStatus() {
  if (sim()) return 'granted'
  if (!navigator.geolocation) return 'unsupported'
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state } catch { return 'prompt' }
}

function holeStandort() {
  if (sim()) {
    const s = simStart() || getUserCoords()
    if (s?.lat != null) return Promise.resolve(s)
  }
  return new Promise((ok, fehler) => navigator.geolocation.getCurrentPosition(
    (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, genau: p.coords.accuracy }),
    fehler, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }))
}

// ── Karte: Anfahrt gestrichelt ───────────────────────────────────────────

const LEER = { type: 'FeatureCollection', features: [] }
function anfahrtEbene(map) {
  if (map.getSource('tour-anfahrt')) return
  map.addSource('tour-anfahrt', { type: 'geojson', data: LEER })
  map.addLayer({ id: 'tour-anfahrt-rand', type: 'line', source: 'tour-anfahrt', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.9 } })
  map.addLayer({ id: 'tour-anfahrt-linie', type: 'line', source: 'tour-anfahrt', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1f1f1f', 'line-width': 4, 'line-dasharray': [0.1, 2] } })
}
function zeigeAnfahrt(pts) {
  const map = getHubMap()
  if (!map?.__mmBereit) return
  anfahrtEbene(map)
  map.getSource('tour-anfahrt').setData(pts?.length ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([a, b]) => [b, a]) } } : LEER)
}
function zeigeTourLinie(pts) {
  const map = getHubMap()
  map?.getSource('tour-detail')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([a, b]) => [b, a]) } })
  map?.getSource('tour-detail-punkte')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { art: 'start' }, geometry: { type: 'Point', coordinates: [pts[0][1], pts[0][0]] } }] })
}

function grenzen(pts) {
  let s = 90, w = 180, n = -90, o = -180
  for (const [la, ln] of pts) { if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > o) o = ln }
  return [[w, s], [o, n]]
}
function panelRand() {
  const panel = document.querySelector('.konf-karte-hub .kv-sidebar')
  const mobil = window.matchMedia('(max-width: 759.98px)').matches
  if (!panel) return 60
  if (mobil) return { top: 90, bottom: Math.min(window.innerHeight * 0.6, Math.max(140, window.innerHeight - panel.getBoundingClientRect().top + 16)), left: 30, right: 60 }
  return { top: 100, bottom: 40, left: panel.getBoundingClientRect().width + 50, right: 80 }
}

// ── 1. Startbildschirm ───────────────────────────────────────────────────

/** Tour-Strecke als routing-Objekt (Schritte schon in Linien-Metern). */
const alsStrecke = (d) => ({ pts: d.pts, kum: d.kum, schritte: d.schritte, hoehen: d.hoehen })

/**
 * Startbildschirm im Panel zeigen.
 * @param {object} t Tour ({ id, name, typ, min, km })
 * @param {object} d Detail ({ pts, kum, schritte })
 * @param {{ zurueck?: () => void }} opts
 */
export async function fahrtVorbereiten(t, d, { zurueck } = {}) {
  const box = document.getElementById('tour-liste')
  if (!box) return starteFahrt(t, alsStrecke(d))
  vorbereitung = { t, d, zurueck, pos: null, umgekehrt: false, einstieg: t.typ === 'rund' ? 'naechster' : 'start', gegen: null, laeuft: 0 }
  box.innerHTML = `<div class="fahrt-start">
    <button type="button" class="tour-zurueck" data-start-zurueck>‹ Zur Tour</button>
    <h2 class="fahrt-start-titel">Tour fahren</h2>
    <div class="fahrt-start-name">${esc(t.name)}</div>
    <div class="fahrt-start-inhalt" id="fahrt-start-inhalt"></div>
  </div>`
  box.scrollTop = 0
  document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: true } }))
  box.querySelector('[data-start-zurueck]').addEventListener('click', () => { vorbereitungBeenden(); zurueck?.() })
  const status = await standortStatus()
  if (status === 'granted') standortHolen()
  else zeigeStandortBitte(status)
}

function vorbereitungBeenden() {
  vorbereitung = null
  zeigeAnfahrt(null)
}

function inhalt() { return document.getElementById('fahrt-start-inhalt') }

function zeigeStandortBitte(status) {
  const el = inhalt()
  if (!el) return
  const gesperrt = status === 'denied'
  el.innerHTML = `<div class="fahrt-karte">
    <div class="fahrt-karte-symbol"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg></div>
    <div>
      <strong>${gesperrt ? 'Standort ist gesperrt' : 'Standort für die Führung'}</strong>
      <p>${gesperrt
        ? 'Dein Browser hat den Standort für MotoMatch blockiert. Erlaube ihn in den Website-Einstellungen (Schloss-Symbol neben der Adresse) und tippe dann erneut.'
        : 'Damit wir dich zum Start führen und unterwegs ansagen können, wo es langgeht. Der Standort bleibt auf deinem Gerät und wird nicht gespeichert.'}</p>
    </div>
  </div>
  <button type="button" class="fahrt-los" data-standort>${gesperrt ? 'Erneut versuchen' : 'Standort freigeben'}</button>
  ${status === 'unsupported' ? '<p class="fahrt-start-hinweis">Dieser Browser kann keinen Standort liefern. Lade die Strecke als GPX für dein Navi herunter.</p>' : ''}`
  el.querySelector('[data-standort]').addEventListener('click', standortHolen)
}

async function standortHolen() {
  const v = vorbereitung, el = inhalt()
  if (!v || !el) return
  el.innerHTML = '<div class="fahrt-laedt"><span class="hub-map-spinner"></span> Standort wird bestimmt…</div>'
  try {
    v.pos = await holeStandort()
  } catch (err) {
    if (vorbereitung !== v) return
    zeigeStandortBitte(err?.code === 1 ? 'denied' : 'prompt')
    if (err?.code !== 1) inhalt()?.insertAdjacentHTML('afterbegin', '<p class="fahrt-start-fehler">Kein GPS-Signal. Geh kurz ins Freie und versuch es noch einmal.</p>')
    return
  }
  if (vorbereitung !== v) return
  planen()
}

const hatHinweise = (d) => (d.schritte || []).filter((s) => s[1] !== 'arrive' && s[1] !== 'depart').length > 0

/**
 * Strecke in der gewählten Richtung. Ohne Abbiegehinweise (eigene Strecke,
 * GPX, Kurvenstrecke) wird sie über Stützpunkte entlang der Linie neu
 * berechnet — dann sagt das Navi auch dort jede Abzweigung an.
 */
async function streckeInRichtung(v) {
  let basis = alsStrecke(v.d)
  if (!hatHinweise(v.d) && !v.umgekehrt) {
    if (v.gefuehrt === undefined) {
      inhalt() && (inhalt().innerHTML = '<div class="fahrt-laedt"><span class="hub-map-spinner"></span> Abbiegehinweise werden berechnet…</div>')
      v.gefuehrt = await route(stuetzpunkte(v.d.pts, 48)).catch(() => null)
    }
    if (v.gefuehrt) basis = v.gefuehrt
  }
  if (!v.umgekehrt) return basis
  if (!v.gegen) {
    const r = await route(stuetzpunkte(v.d.pts.slice().reverse(), 48))
    v.gegen = r
  }
  return v.gegen
}

async function planen() {
  const v = vorbereitung, el = inhalt()
  if (!v || !el) return
  const lauf = ++v.laeuft
  el.innerHTML = '<div class="fahrt-laedt"><span class="hub-map-spinner"></span> Anfahrt wird berechnet…</div>'
  try {
    let tour = await streckeInRichtung(v)
    // Einstieg
    const n = naechster(tour, v.pos.lat, v.pos.lng)
    const start = v.d.pts[0]
    const zumStartKm = haversineKm(v.pos.lat, v.pos.lng, (v.umgekehrt ? tour.pts[0] : start)[0], (v.umgekehrt ? tour.pts[0] : start)[1])
    let einstiegIdx = 0
    if (v.t.typ === 'rund' && v.einstieg === 'naechster' && n.index > 0 && n.index < tour.pts.length - 1) {
      einstiegIdx = n.index
      tour = rundAb(tour, n.index)
    }
    const einstieg = tour.pts[0]
    const abstand = haversineKm(v.pos.lat, v.pos.lng, einstieg[0], einstieg[1]) * 1000
    let anfahrt = null
    if (abstand > ANFAHRT_AB_M) {
      try {
        anfahrt = await route([[v.pos.lat, v.pos.lng], einstieg])
      } catch (err) {
        if (lauf !== v.laeuft || vorbereitung !== v) return
        // Ohne Netz/Route: trotzdem fahrbar, das Navi zeigt die Richtung zur Linie
        anfahrt = null
        v.anfahrtFehler = err instanceof RoutingFehler ? err.message : 'Anfahrt nicht berechenbar.'
      }
    }
    if (lauf !== v.laeuft || vorbereitung !== v) return
    v.tour = tour
    v.anfahrt = anfahrt
    v.einstiegIdx = einstiegIdx
    zeigeTourLinie(tour.pts)
    zeigeAnfahrt(anfahrt?.pts || null)
    const map = getHubMap()
    if (map) map.fitBounds(grenzen([...(anfahrt?.pts || []), ...tour.pts, [v.pos.lat, v.pos.lng]]), { padding: panelRand(), duration: 800, pitch: 0, bearing: 0 })
    zeigePlan(v, { zumStartKm, abstand })
  } catch (err) {
    if (lauf !== v.laeuft || vorbereitung !== v) return
    el.innerHTML = `<p class="fahrt-start-fehler">${esc(err?.message || 'Die Strecke konnte nicht vorbereitet werden.')}</p>
      <button type="button" class="fahrt-los" data-nochmal>Noch einmal</button>`
    el.querySelector('[data-nochmal]').addEventListener('click', planen)
  }
}

function tourMinuten(v, meter) {
  const gesamt = v.d.kum[v.d.kum.length - 1] || 1
  return (meter / gesamt) * (v.t.min || (gesamt / 1000) * 1.2)
}

function zeigePlan(v, { abstand }) {
  const el = inhalt()
  if (!el) return
  const tourM = v.tour.kum[v.tour.kum.length - 1]
  const tourMin = tourMinuten(v, tourM)
  const anfM = v.anfahrt?.meter || 0
  const anfMin = v.anfahrt ? v.anfahrt.sekunden / 60 : 0
  const gesamtMin = tourMin + anfMin
  const rund = v.t.typ === 'rund'
  const einstiegName = v.einstiegIdx > 0 ? 'Nächster Punkt der Strecke' : (v.umgekehrt ? 'Ende der Strecke' : 'Offizieller Start')
  el.innerHTML = `
    <div class="fahrt-wahl">
      ${rund ? `<div class="fahrt-wahl-zeile">
        <span>Einstieg</span>
        <div class="fahrt-schalter" role="group">
          <button type="button" data-einstieg="naechster" aria-pressed="${v.einstieg === 'naechster'}">Nächster Punkt</button>
          <button type="button" data-einstieg="start" aria-pressed="${v.einstieg === 'start'}">Start</button>
        </div>
      </div>` : ''}
      <div class="fahrt-wahl-zeile">
        <span>Richtung</span>
        <div class="fahrt-schalter" role="group">
          <button type="button" data-richtung="normal" aria-pressed="${!v.umgekehrt}">Wie geplant</button>
          <button type="button" data-richtung="gegen" aria-pressed="${v.umgekehrt}">Umgekehrt</button>
        </div>
      </div>
    </div>
    <ol class="fahrt-plan">
      <li class="fahrt-plan-punkt fahrt-plan-punkt--du"><strong>Dein Standort</strong></li>
      ${v.anfahrt ? `<li class="fahrt-plan-strecke fahrt-plan-strecke--anfahrt"><span>Anfahrt</span><strong>${mFormat(anfM)} · ${dauer(anfMin)}</strong></li>`
        : abstand > ANFAHRT_AB_M ? `<li class="fahrt-plan-strecke fahrt-plan-strecke--anfahrt"><span>Anfahrt</span><strong>${mFormat(abstand)} Luftlinie</strong></li>` : ''}
      <li class="fahrt-plan-punkt"><strong>${esc(einstiegName)}</strong>${abstand <= ANFAHRT_AB_M ? '<em>Du bist schon da</em>' : ''}</li>
      <li class="fahrt-plan-strecke"><span>${esc(v.t.name)}</span><strong>${mFormat(tourM)} · ${dauer(tourMin)}</strong></li>
      <li class="fahrt-plan-punkt fahrt-plan-punkt--ziel"><strong>${rund ? 'Zurück am Einstieg' : 'Ziel'}</strong><em>an ${uhr(gesamtMin)} Uhr</em></li>
    </ol>
    <div class="fahrt-wetter" id="fahrt-wetter"><div class="fahrt-laedt"><span class="hub-map-spinner"></span> Wetter unterwegs…</div></div>
    ${v.anfahrtFehler && !v.anfahrt && abstand > ANFAHRT_AB_M ? `<p class="fahrt-start-fehler">${esc(v.anfahrtFehler)} Das Navi zeigt dir dann die Richtung zur Strecke.</p>` : ''}
    <label class="fahrt-mitschnitt">
      <input type="checkbox" data-mitschneiden ${mitschneidenGemerkt() ? 'checked' : ''}>
      <span><strong>Fahrt aufzeichnen</strong><em>Landet danach in „Meine“ und im Fahrtenbuch — nur auf diesem Gerät.</em></span>
    </label>
    <button type="button" class="fahrt-los" data-losfahren>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
      Losfahren
    </button>
    <p class="fahrt-start-hinweis">Halte das Handy in der Halterung, der Bildschirm bleibt an. Gesperrt gibt der Browser keinen Standort weiter.</p>`
  zeigeWetter(v, { anfM, anfMin, tourMin, tourM })
  el.querySelectorAll('[data-einstieg]').forEach((b) => b.addEventListener('click', () => { if (v.einstieg !== b.dataset.einstieg) { v.einstieg = b.dataset.einstieg; planen() } }))
  el.querySelectorAll('[data-richtung]').forEach((b) => b.addEventListener('click', () => { const u = b.dataset.richtung === 'gegen'; if (v.umgekehrt !== u) { v.umgekehrt = u; planen() } }))
  el.querySelector('[data-losfahren]').addEventListener('click', () => {
    const strecke = v.anfahrt ? verbinde(v.anfahrt, v.tour, 'Start der Tour') : v.tour
    const info = { anfahrtM: v.anfahrt ? v.anfahrt.kum[v.anfahrt.kum.length - 1] : 0, anfahrtSek: v.anfahrt?.sekunden || 0, tourMinJeM: tourMin / Math.max(1, tourM) }
    const t = v.t, zurueck = v.zurueck
    const mitschneiden = el.querySelector('[data-mitschneiden]')?.checked
    try { localStorage.setItem(LS_MITSCHNEIDEN, mitschneiden ? '1' : '0') } catch {}
    vorbereitungBeenden()
    starteFahrt(t, strecke, { info, mitschneiden, onEnde: () => zurueck?.() })
  })
}

/** Wetter zur Ankunftszeit an mehreren Punkten von Anfahrt + Tour. */
async function zeigeWetter(v, { anfM, anfMin, tourMin, tourM }) {
  const lauf = v.laeuft
  const strecke = v.anfahrt ? verbinde(v.anfahrt, v.tour) : v.tour
  const minutenBis = (m) => (m <= anfM ? (anfM ? (m / anfM) * anfMin : 0) : anfMin + ((m - anfM) / Math.max(1, tourM)) * tourMin)
  let liste = []
  try { liste = await wetterEntlang(strecke, minutenBis) } catch {}
  const el = document.getElementById('fahrt-wetter')
  if (!el || vorbereitung !== v || v.laeuft !== lauf) return
  if (!liste.length) { el.remove(); return }
  const warnung = wetterWarnung(liste)
  el.innerHTML = `
    <div class="fahrt-wetter-kopf"><span>Wetter unterwegs</span><span>DWD</span></div>
    <div class="fahrt-wetter-reihe">${liste.map((w) => `<div class="fahrt-wetter-punkt${(w.regenProz ?? 0) >= 50 ? ' nass' : ''}">
      <span class="fahrt-wetter-km">${w.meter < 1000 ? 'Start' : `km ${Math.round(w.meter / 1000)}`}</span>
      ${wetterSymbol(w.icon)}
      <strong>${w.temp != null ? `${w.temp}°` : '–'}</strong>
      <span>${w.regenProz != null ? `${w.regenProz} %` : ''}</span>
    </div>`).join('')}</div>
    ${warnung ? `<p class="fahrt-wetter-warnung">${esc(warnung)}</p>` : '<p class="fahrt-wetter-gut">Trocken auf der ganzen Strecke — gute Fahrt.</p>'}`
}

// ── 2. Navi ──────────────────────────────────────────────────────────────

const ICON = {
  ton: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  stumm: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  uebersicht: '<svg viewBox="0 0 24 24"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  folgen: '<svg viewBox="0 0 24 24"><path d="M12 2l7 19-7-4-7 4z"/></svg>',
  ende: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
}

function minutenRest(f) {
  const rest = Math.max(0, f.gesamt - f.meter)
  const i = f.info
  // Anfahrt mit der Zeit des Routings, die Tour mit ihrer eigenen Fahrzeit
  const inAnfahrt = Math.max(0, f.anfahrtEnde - f.meter)
  const anf = f.anfahrtEnde > 0 && i.anfahrtSek ? (inAnfahrt / Math.max(1, f.anfahrtEnde)) * (i.anfahrtSek / 60) : 0
  return anf + (rest - inAnfahrt) * (i.tourMinJeM || 1 / 900)
}

function zeichne() {
  const f = fahrt
  if (!f) return
  const { schritte } = f.d
  while (f.schritt < schritte.length - 1 && schritte[f.schritt][0] < f.meter - 12) f.schritt++
  const naechsterS = schritte[f.schritt]
  const bis = Math.max(0, naechsterS[0] - f.meter)
  const danach = schritte[f.schritt + 1]
  const restMin = minutenRest(f)
  const el = f.el

  // Weit neben der Strecke ist der alte Abbiegehinweis wertlos — bis zur Neuberechnung: zurück zur Linie
  if (f.gestartet && f.abstand > 150) {
    el.querySelector('.fahrt-pfeil').innerHTML = pfeil([0, 'waypoint'])
    el.querySelector('.fahrt-bis').textContent = mFormat(f.abstand)
    el.querySelector('.fahrt-satz').textContent = f.neuBerechnung ? 'Route wird neu berechnet…' : 'Zurück zur Strecke'
    el.querySelector('.fahrt-danach').hidden = true
    el.querySelector('.fahrt-abseits').hidden = true
    el.querySelector('.fahrt-an').textContent = uhr(restMin)
    el.querySelector('.fahrt-rest').textContent = `${mFormat(Math.max(0, f.gesamt - f.meter))} · ${dauer(restMin)}`
    el.querySelector('.fahrt-tempo strong').textContent = f.tempo != null ? Math.round(f.tempo) : '–'
    return
  }
  el.querySelector('.fahrt-pfeil').innerHTML = pfeil(naechsterS)
  el.querySelector('.fahrt-bis').textContent = f.gestartet ? mFormat(bis) : ''
  const text = naechsterS[1] === 'arrive' && bis > 150 ? 'Der Strecke folgen bis zum Ziel' : satz(naechsterS)
  el.querySelector('.fahrt-satz').textContent = f.gestartet ? text : (f.gpsText || 'Warte auf GPS…')
  const dEl = el.querySelector('.fahrt-danach')
  if (danach && f.gestartet && danach[0] - naechsterS[0] < 400 && danach[1] !== 'waypoint') {
    dEl.hidden = false
    dEl.innerHTML = `<span>Dann</span>${pfeil(danach)}`
  } else dEl.hidden = true

  el.querySelector('.fahrt-an').textContent = uhr(restMin)
  el.querySelector('.fahrt-rest').textContent = `${mFormat(Math.max(0, f.gesamt - f.meter))} · ${dauer(restMin)}`
  el.querySelector('.fahrt-fortschritt i').style.width = `${Math.min(100, (f.meter / f.gesamt) * 100)}%`
  el.querySelector('.fahrt-tempo strong').textContent = f.tempo != null ? Math.round(f.tempo) : '–'

  const abseits = el.querySelector('.fahrt-abseits')
  if (f.neuBerechnung) { abseits.hidden = false; abseits.textContent = 'Route wird neu berechnet…' }
  else if (f.gestartet && f.abstand > ABSEITS_M) {
    abseits.hidden = false
    abseits.textContent = `Neben der Strecke — ${mFormat(f.abstand)} zur Linie`
  } else abseits.hidden = true

  // Ansagen: je Hinweis jede Stufe einmal
  if (f.gestartet && f.abstand <= ABSEITS_M) {
    for (const stufe of ANSAGEN_M) {
      const schluessel = `${f.dVersion}-${f.schritt}-${stufe}`
      if (bis <= stufe && !f.angesagt.has(schluessel)) {
        // kleinere Stufen gelten mit, sonst folgen zwei Ansagen kurz hintereinander
        ANSAGEN_M.filter((s) => s >= stufe).forEach((s) => f.angesagt.add(`${f.dVersion}-${f.schritt}-${s}`))
        if (naechsterS[1] === 'waypoint') sprich(bis < 80 ? `${satz(naechsterS)} erreicht. Viel Spaß auf der Tour.` : `In ${mSprache(bis)}: ${satz(naechsterS)}`)
        else if (naechsterS[1] === 'arrive') sprich(bis < 80 ? 'Ziel erreicht.' : `In ${mSprache(bis)} erreichst du das Ziel.`)
        else sprich(stufe === 60 ? satz(naechsterS) : `In ${mSprache(bis)} ${satz(naechsterS)}`)
        break
      }
    }
  }
}

/** Nächster Punkt nahe der letzten Position zuerst (Rundtour: Start = Ziel). */
function aufLinie(lat, lng) {
  const f = fahrt
  let n = naechster(f.d, lat, lng, f.index - 20, f.index + 600)
  if (n.meter > ABSEITS_M) {
    const g = naechster(f.d, lat, lng)
    // weit springen nur, wenn es deutlich näher ist und nicht zurück
    if (g.meter < n.meter - 40 && g.index >= f.index - 50) n = g
  }
  return n
}

function kameraNachfuehren(lng, lat, kurs) {
  const f = fahrt, map = getHubMap()
  if (!map || !f.folgen) return
  const h = map.getContainer().clientHeight
  const v = f.tempo || 0
  const zoom = v < 25 ? 17 : v < 60 ? 16.3 : v < 90 ? 15.7 : 15.2
  map.easeTo({ center: [lng, lat], bearing: kurs, zoom, pitch: 55, duration: 900, easing: (t) => t, padding: { top: Math.round(h * 0.45), bottom: 80, left: 0, right: 0 } })
}

function position(pos) {
  const f = fahrt
  if (!f) return
  const { latitude: lat, longitude: lng, heading, speed, accuracy } = pos.coords
  if (accuracy > 80 && f.gestartet) return // grobe Ausreißer verwerfen
  f.tempo = Number.isFinite(speed) && speed >= 0 ? speed * 3.6 : f.tempo
  const l = aufLinie(lat, lng)
  f.abstand = l.meter
  if (l.meter <= ABSEITS_M) { f.index = l.index; f.meter = Math.max(f.meter, l.entlang); f.abseitsSeit = 0 }
  else if (!f.abseitsSeit) f.abseitsSeit = Date.now()
  f.gestartet = true
  f.letztePos = { lat, lng }

  // Kurs: GPS, sonst Richtung der Linie
  let kurs = Number.isFinite(heading) && f.tempo > 5 ? heading : null
  if (kurs == null) {
    const a = f.d.pts[f.index], b = f.d.pts[Math.min(f.index + 4, f.d.pts.length - 1)]
    kurs = (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI
  }
  const map = getHubMap()
  f.marker.setLngLat([lng, lat])
  f.marker.getElement().style.setProperty('--kurs', `${kurs - (map?.getBearing() || 0)}deg`)
  kameraNachfuehren(lng, lat, kurs)
  // Nach 8 s neben der Strecke: Rückführung berechnen
  if (f.abseitsSeit && Date.now() - f.abseitsSeit > 8000 && !f.neuBerechnung && Date.now() - (f.letzteNeuberechnung || 0) > 20000) neuBerechnen()
  zeichne()
  const letzter = f.d.schritte[f.d.schritte.length - 1]
  if (letzter[1] === 'arrive' && f.meter > f.gesamt - 50) beenden(true)
}

/** Wer die Strecke verlässt: Route zurück auf die Strecke, ein Stück voraus. */
async function neuBerechnen() {
  const f = fahrt
  if (!f?.letztePos) return
  f.neuBerechnung = true
  f.letzteNeuberechnung = Date.now()
  zeichne()
  const { lat, lng } = f.letztePos
  try {
    // Wiedereinstieg: der Punkt der restlichen Strecke (bis 8 km voraus), der am nächsten liegt, plus 300 m
    const vorausBis = f.d.kum.findIndex((m) => m > f.meter + 8000)
    const n = naechster(f.d, lat, lng, f.index, vorausBis < 0 ? f.d.pts.length : vorausBis)
    let ziel = n.index
    while (ziel < f.d.pts.length - 1 && f.d.kum[ziel] < f.d.kum[n.index] + 300) ziel++
    const rueck = await route([[lat, lng], f.d.pts[ziel]])
    if (fahrt !== f) return
    const rest = teil(f.d, ziel)
    const neu = verbinde({ ...rueck, schritte: rueck.schritte.filter((s) => s[1] !== 'arrive' && s[1] !== 'depart') }, rest, null)
    neu.schritte = neu.schritte.filter((s) => s[1] !== 'waypoint' || s[3])
    // Anfahrt-Ende relativ zur neuen Linie mitführen
    const tourStartAlt = f.anfahrtEnde
    f.anfahrtEnde = tourStartAlt > f.d.kum[ziel] ? rueck.kum[rueck.kum.length - 1] + (tourStartAlt - f.d.kum[ziel]) : 0
    f.d = neu
    f.gesamt = neu.kum[neu.kum.length - 1]
    f.index = 0; f.meter = 0; f.schritt = 0; f.abseitsSeit = 0; f.dVersion++
    zeichneNaviLinie()
    sprich('Route neu berechnet.')
  } catch (err) {
    console.warn('[fahrt] Neuberechnung', err)
  } finally {
    if (fahrt === f) { f.neuBerechnung = false; zeichne() }
  }
}

function zeichneNaviLinie() {
  const f = fahrt, map = getHubMap()
  if (!f || !map) return
  zeigeAnfahrt(null)
  map.getSource('tour-detail')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: f.d.pts.map(([a, b]) => [b, a]) } })
  map.getSource('tour-detail-punkte')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { art: 'ziel' }, geometry: { type: 'Point', coordinates: [f.d.pts.at(-1)[1], f.d.pts.at(-1)[0]] } }] })
}

async function wachHalten() {
  try { fahrt.wach = await navigator.wakeLock?.request('screen') } catch {}
}

/** Simulierte Fahrt entlang der Linie (nur zum Testen, s. Kopf). */
function simulieren() {
  const f = fahrt
  let m = 0
  let sek = 0
  const abweichen = (() => { try { return localStorage.getItem('mm_sim_abweichen') === '1' } catch { return false } })()
  const tick = () => {
    if (fahrt !== f) return
    m += 25 // 90 km/h bei 1 Hz
    sek++
    const { kum, pts } = f.d
    let i = kum.findIndex((x) => x >= f.meter + 25)
    if (i < 0) i = pts.length - 1
    const p = pts[i]
    // Test der Neuberechnung: ab Sekunde 20 seitlich weg, bis neu berechnet wurde
    const weg = abweichen && sek > 20 && f.dVersion === 0 ? 0.004 + (sek - 20) * 0.0002 : 0
    position({ coords: { latitude: p[0] + weg, longitude: p[1], heading: null, speed: 25, accuracy: 5 } })
    f.simT = setTimeout(tick, 1000)
  }
  // erste Position: der Simulationsstart (Anfahrt beginnt dort)
  const s = simStart()
  if (s) position({ coords: { latitude: s.lat, longitude: s.lng, heading: null, speed: 0, accuracy: 5 } })
  f.simT = setTimeout(tick, 1200)
  return m
}

/**
 * Navi starten.
 * @param {object} t Tour ({ name, min })
 * @param {object} strecke { pts, kum, schritte } (Meter entlang der Linie)
 */
export function starteFahrt(t, strecke, { info = {}, onEnde, mitschneiden = false } = {}) {
  if (fahrt) beenden()
  const map = getHubMap(), ml = getMapLib()
  const host = document.querySelector('.konf-karte-hub .kv-map-wrap')
  if (!map || !ml || !host || !strecke?.pts?.length) return false
  if (!navigator.geolocation && !sim()) { alert('Dein Browser gibt keinen Standort frei — ohne GPS kann die Tour nicht geführt werden.'); return false }
  const d = { ...strecke, kum: strecke.kum || kumuliert(strecke.pts) }
  if (!d.schritte?.length || d.schritte.at(-1)[1] !== 'arrive') d.schritte = [...(d.schritte || []), [Math.round(d.kum.at(-1)), 'arrive', '', '', 0]]

  const el = document.createElement('div')
  el.className = 'fahrt'
  el.innerHTML = `
    <div class="fahrt-oben">
      <div class="fahrt-hinweis-karte">
        <div class="fahrt-pfeil" aria-hidden="true"></div>
        <div class="fahrt-hinweis">
          <div class="fahrt-bis"></div>
          <div class="fahrt-satz">Warte auf GPS…</div>
        </div>
      </div>
      <div class="fahrt-danach" hidden></div>
      <div class="fahrt-abseits" hidden></div>
    </div>
    <div class="fahrt-mitte">
      <div class="fahrt-tempo" aria-label="Geschwindigkeit"><strong>–</strong><span>km/h</span></div>
      <button type="button" class="fahrt-rund" data-fahrt="folgen" hidden aria-label="Wieder mitfahren">${ICON.folgen}<span>Zentrieren</span></button>
    </div>
    <div class="fahrt-unten">
      <div class="fahrt-fortschritt"><i></i></div>
      <div class="fahrt-leiste">
        <button type="button" class="fahrt-knopf" data-fahrt="ton" aria-pressed="true" aria-label="Ansagen">${ICON.ton}</button>
        <div class="fahrt-ankunft">
          <strong class="fahrt-an"></strong>
          <span class="fahrt-rest"></span>
        </div>
        <button type="button" class="fahrt-knopf" data-fahrt="uebersicht" aria-label="Übersicht">${ICON.uebersicht}</button>
        <button type="button" class="fahrt-knopf fahrt-knopf--ende" data-fahrt="ende" aria-label="Beenden">${ICON.ende}</button>
      </div>
      <div class="fahrt-name">${esc(t.name)}</div>
    </div>`
  host.appendChild(el)
  document.querySelector('.konf-karte-hub')?.classList.add('kv-faehrt')
  document.body.classList.add('mm-faehrt')

  const pfeilEl = document.createElement('div')
  pfeilEl.className = 'fahrt-position'
  // MapLibre setzt transform am Marker-Element selbst — gedreht wird das Kind
  pfeilEl.innerHTML = '<div class="fahrt-position-pfeil"></div>'
  fahrt = {
    t, d, el, onEnde, info,
    gesamt: d.kum.at(-1), anfahrtEnde: info.anfahrtM || 0,
    index: 0, meter: 0, schritt: 0, abstand: 0, gestartet: false, folgen: true, ton: true, tempo: null,
    angesagt: new Set(), dVersion: 0,
    marker: new ml.Marker({ element: pfeilEl, rotationAlignment: 'viewport' }).setLngLat([d.pts[0][1], d.pts[0][0]]).addTo(map),
    watch: null, wach: null,
  }
  zeichneNaviLinie()
  map.setMaxPitch(60)
  // Nutzer verschiebt die Karte → nicht mehr hinterherfahren, bis "Zentrieren"
  fahrt.wegschieben = (e) => {
    if (!e.originalEvent || !fahrt) return
    fahrt.folgen = false
    el.querySelector('[data-fahrt="folgen"]').hidden = false
  }
  map.on('dragstart', fahrt.wegschieben)

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fahrt]')
    if (!b || !fahrt) return
    const was = b.dataset.fahrt
    if (was === 'ende') beenden()
    if (was === 'folgen') {
      fahrt.folgen = true; b.hidden = true
      if (fahrt.letztePos) kameraNachfuehren(fahrt.letztePos.lng, fahrt.letztePos.lat, map.getBearing())
    }
    if (was === 'uebersicht') {
      fahrt.folgen = false
      el.querySelector('[data-fahrt="folgen"]').hidden = false
      const rest = fahrt.d.pts.slice(fahrt.index)
      map.fitBounds(grenzen(fahrt.letztePos ? [...rest, [fahrt.letztePos.lat, fahrt.letztePos.lng]] : rest), { padding: { top: 200, bottom: 160, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 800 })
    }
    if (was === 'ton') {
      fahrt.ton = !fahrt.ton
      b.innerHTML = fahrt.ton ? ICON.ton : ICON.stumm
      b.setAttribute('aria-pressed', String(fahrt.ton))
      if (!fahrt.ton) try { speechSynthesis.cancel() } catch {}
    }
  })
  fahrt.sichtbar = () => { if (document.visibilityState === 'visible' && fahrt && !fahrt.wach) wachHalten() }
  document.addEventListener('visibilitychange', fahrt.sichtbar)

  wachHalten()
  // Aufzeichnung im Hintergrund (ride-tracker.js) — am Ende wird gefragt, ob sie gespeichert wird
  if (mitschneiden && !sim()) {
    const f = fahrt
    starteAufzeichnung({}).then((st) => { if (fahrt === f) f.aufnahme = st; else st.abbrechen() }).catch(() => {})
  }
  if (sim()) simulieren()
  else {
    fahrt.watch = navigator.geolocation.watchPosition(position, (err) => {
      if (!fahrt) return
      fahrt.gpsText = err.code === 1 ? 'Standort nicht freigegeben' : 'Kein GPS-Signal'
      zeichne()
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 })
  }
  // Karte entlang der Strecke offline ablegen (Funklöcher im Wald und in den Bergen)
  import('./offline.js').then(({ vorladen }) => vorladen(d.pts, (n, g) => {
    if (fahrt?.el !== el) return
    el.querySelector('.fahrt-name').textContent = n < g ? `${t.name} · Karte wird offline gespeichert ${Math.round((n / g) * 100)} %` : `${t.name} · Karte offline verfügbar`
  })).catch(() => {})
  sprich(info.anfahrtM ? `Los geht's. Erst ${mSprache(info.anfahrtM)} zum Start der Tour.` : `Tour ${t.name}. Gute Fahrt.`)
  zeichne()
  return true
}

export function beenden(ziel = false) {
  const f = fahrt
  if (!f) return
  fahrt = null
  clearTimeout(f.simT)
  import('./offline.js').then((m) => m.vorladenAbbrechen()).catch(() => {})
  if (f.watch != null) navigator.geolocation.clearWatch(f.watch)
  try { f.wach?.release() } catch {}
  document.removeEventListener('visibilitychange', f.sichtbar)
  const map = getHubMap()
  map?.off('dragstart', f.wegschieben)
  f.marker.remove()
  f.el.remove()
  zeigeAnfahrt(null)
  document.querySelector('.konf-karte-hub')?.classList.remove('kv-faehrt')
  document.body.classList.remove('mm-faehrt')
  if (map) { map.easeTo({ pitch: 0, bearing: 0, duration: 600, padding: { top: 0, bottom: 0, left: 0, right: 0 } }); map.once('moveend', () => map.setMaxPitch(0)) }
  if (ziel) sprich('Ziel erreicht. Schöne Tour gewesen.', f.ton)
  const aufnahme = f.aufnahme?.beenden()
  if (aufnahme && aufnahme.km >= 1) aufnahmeSpeichern(f, aufnahme)
  else f.onEnde?.(ziel)
}

/** Nach der Fahrt: mitgeschnittene Strecke unter dem Namen der Tour speichern. */
function aufnahmeSpeichern(f, aufnahme) {
  const host = document.querySelector('.konf-karte-hub .kv-map-wrap')
  if (!host) { f.onEnde?.(true); return }
  const el = document.createElement('div')
  el.className = 'aufnahme'
  const km = aufnahme.km.toFixed(1).replace('.', ',')
  el.innerHTML = `<div class="aufnahme-speichern">
    <strong>Fahrt speichern?</strong>
    <span>${km} km · Ø ${Math.round(aufnahme.schnittKmh)} km/h · ${Math.round(aufnahme.hoehenMeter)} Höhenmeter</span>
    <input type="text" class="aufnahme-name" maxlength="80" value="${esc(f.t.name)}" aria-label="Name der Fahrt">
    <div class="aufnahme-knoepfe">
      <button type="button" class="aufnahme-btn" data-auf="weg">Verwerfen</button>
      <button type="button" class="aufnahme-btn aufnahme-btn--haupt" data-auf="sichern">Speichern</button>
    </div>
  </div>`
  host.appendChild(el)
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-auf]')
    if (!b) return
    if (b.dataset.auf === 'weg' && !confirm('Aufgezeichnete Fahrt verwerfen?')) return
    let id = null
    if (b.dataset.auf === 'sichern') {
      const { speichereFahrt, PRAEFIX } = await import('./eigene-strecken.js')
      try { id = PRAEFIX + speichereFahrt(aufnahme, el.querySelector('.aufnahme-name').value.trim() || f.t.name) } catch (err) { alert(err.message); return }
    }
    el.remove()
    if (id) import('./touren.js').then((m) => m.zeigeEigeneStrecke?.(id))
    else f.onEnde?.(true)
  })
}

export const faehrtGerade = () => !!fahrt
