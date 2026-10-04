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
import { sage, verstummen, manoever, stimmeEntsperren, wartetAufDich, wartetSetzen, PERSONA } from './stimme.js'

const LS_MITSCHNEIDEN = 'mm_fahrt_aufzeichnen_v1'
const mitschneidenGemerkt = () => { try { return localStorage.getItem(LS_MITSCHNEIDEN) !== '0' } catch { return true } }
import { route, naechster, teil, verbinde, rundAb, kumuliert, stuetzpunkte, punktBei, kursBei, projiziere, RoutingFehler } from './routing.js'

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

/** Heiko sagt an (stimme.js): eingesprochene Ansage, sonst die Gerätestimme mit text. */
function sprich(schluessel, text, { ton = fahrt?.ton, anhaengen = false } = {}) {
  if (!ton) return
  // Die Begrüßung läuft aus, die erste Ansage stellt sich hinten an
  sage(schluessel, text, { anhaengen: anhaengen || Date.now() < (fahrt?.begruessungBis || 0) })
}
/** "In 250 Metern rechts abbiegen" — klein nach der Entfernung. */
const nachEntfernung = (satzText) => satzText.replace(/^(Links|Rechts|Leicht|Scharf|Geradeaus|Wenden|Einfädeln|Im|Am|An)\b/, (w) => w.toLowerCase())
/** Ansage-Schlüssel "800-abbiegen-links" bzw. "abbiegen-links" (kurz davor). */
function ansageFuer(stufe, s) {
  const m = manoever(s)
  if (!m) return null
  return stufe === 60 ? m : `${stufe}-${m}`
}
const PAUSE_NACH_MS = 90 * 60_000

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
    <div class="fahrt-heiko">
      <div class="fahrt-heiko-kopf">
        <span class="fahrt-heiko-zeichen" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 11.5L12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M12 17.2s-3-1.9-3-3.9a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 2-3 3.9-3 3.9z"/></svg></span>
        <span class="fahrt-heiko-text"><strong>${PERSONA.name} sagt an</strong><em>${esc(PERSONA.zeile)}</em></span>
        <button type="button" class="fahrt-heiko-probe" data-probe aria-label="Stimme anhören"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg></button>
      </div>
      <label class="fahrt-heiko-wartet">
        <span>Wer wartet auf dich?</span>
        <input type="text" data-wartet maxlength="40" placeholder="z. B. Lena, Mama, die Kids" value="${esc(wartetAufDich())}" autocomplete="off">
      </label>
    </div>
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
  el.querySelector('[data-probe]').addEventListener('click', () => {
    stimmeEntsperren()
    const w = el.querySelector('[data-wartet]').value.trim()
    sage(w ? 'hallo' : 'probe', w ? `Hi, ich bin ${PERSONA.name}. Fahr vorsichtig. ${w} wartet auf dich.` : null)
  })
  el.querySelector('[data-wartet]').addEventListener('change', (e) => wartetSetzen(e.target.value))
  el.querySelector('[data-losfahren]').addEventListener('click', () => {
    stimmeEntsperren()
    wartetSetzen(el.querySelector('[data-wartet]').value)
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
/* Darstellung nach dem Vorbild von Apple Karten:
   - breite blaue Route mit dunklerem Rand und weichem Schatten, gefahrener
     Teil grau; weißer Abbiegepfeil direkt auf der Straße vor jeder Abzweigung
   - flacher Positions-Puck, Kamera in Fahrtrichtung, schräg von hinten
   - Position und Kamera laufen mit 60 Bildern/s: zwischen zwei GPS-Meldungen
     (≈1/s) gleitet der Puck entlang der Linie mit der gemessenen Geschwindigkeit
   - während der Fahrt ist die Karte aufgeräumt (keine POI-Symbole) */

const ICON = {
  ton: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  stumm: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  uebersicht: '<svg viewBox="0 0 24 24"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  folgen: '<svg viewBox="0 0 24 24"><path d="M12 3l7 18-7-4-7 4z"/></svg>',
}

const BLAU = '#1f7bff'
const BLAU_RAND = '#0b55d1'
const GEFAHREN = '#9aa6b6'
const GEFAHREN_RAND = '#7d8898'
// Breite der Route je Zoom (wie bei Apple: auf Straßenebene kräftig)
const BREITE = (plus = 0, faktor = 1) => ['interpolate', ['exponential', 1.6], ['zoom'], 10, 3.5 * faktor + plus, 14, 8 * faktor + plus, 16.5, 15 * faktor + plus, 19, 30 * faktor + plus]
const VERLAUF = (p, farbe, grau) => (p <= 0.0005
  ? ['interpolate', ['linear'], ['line-progress'], 0, farbe, 1, farbe]
  : ['step', ['line-progress'], grau, Math.min(0.9999, p), farbe])
const AUSGEBLENDET = /^(poi_|road_one_way_arrow|highway-name-path|airport)|^(tour-detail|touren-|tour-anfahrt|kurven-|plan-|aufnahme-)/

function ersteSymbolEbene(map) {
  return map.getStyle().layers.find((l) => l.type === 'symbol' && !l.id.startsWith('navi'))?.id
}

function pfeilspitzeBild() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.lineJoin = 'round'
  g.beginPath(); g.moveTo(32, 8); g.lineTo(56, 52); g.lineTo(32, 42); g.lineTo(8, 52); g.closePath()
  g.fillStyle = '#ffffff'; g.strokeStyle = '#123e8f'; g.lineWidth = 4
  g.fill(); g.stroke()
  return g.getImageData(0, 0, 64, 64)
}

function naviEbenen(map) {
  if (map.getSource('navi')) return
  const vor = ersteSymbolEbene(map)
  map.addSource('navi', { type: 'geojson', data: LEER, lineMetrics: true })
  map.addSource('navi-pfeil', { type: 'geojson', data: LEER })
  map.addSource('navi-spitze', { type: 'geojson', data: LEER })
  map.addSource('navi-ziel', { type: 'geojson', data: LEER })
  if (!map.hasImage('navi-spitze')) map.addImage('navi-spitze', pfeilspitzeBild(), { pixelRatio: 2 })
  const rund = { 'line-join': 'round', 'line-cap': 'round' }
  map.addLayer({ id: 'navi-schatten', type: 'line', source: 'navi', layout: rund, paint: { 'line-color': 'rgba(0,30,80,0.22)', 'line-width': BREITE(10), 'line-blur': 8, 'line-translate': [0, 3] } }, vor)
  map.addLayer({ id: 'navi-rand', type: 'line', source: 'navi', layout: rund, paint: { 'line-gradient': VERLAUF(0, BLAU_RAND, GEFAHREN_RAND), 'line-width': BREITE(4) } }, vor)
  map.addLayer({ id: 'navi-linie', type: 'line', source: 'navi', layout: rund, paint: { 'line-gradient': VERLAUF(0, BLAU, GEFAHREN), 'line-width': BREITE() } }, vor)
  map.addLayer({ id: 'navi-pfeil-rand', type: 'line', source: 'navi-pfeil', layout: rund, paint: { 'line-color': '#123e8f', 'line-width': BREITE(3, 0.62) } })
  map.addLayer({ id: 'navi-pfeil-linie', type: 'line', source: 'navi-pfeil', layout: rund, paint: { 'line-color': '#ffffff', 'line-width': BREITE(0, 0.62) } })
  map.addLayer({
    id: 'navi-spitze', type: 'symbol', source: 'navi-spitze',
    layout: {
      'icon-image': 'navi-spitze', 'icon-rotate': ['get', 'winkel'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 0.25, 14, 0.5, 16.5, 0.95, 19, 1.9],
    },
  })
  map.addLayer({ id: 'navi-ziel', type: 'circle', source: 'navi-ziel', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 17, 11], 'circle-color': '#e5383b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } })
}

/** Während der Fahrt: andere Linien und Symbole aus, Navi-Ebenen an — und umgekehrt. */
function karteFuerFahrt(map, an, f) {
  if (an) {
    f.versteckt = []
    for (const l of map.getStyle().layers) {
      if (!AUSGEBLENDET.test(l.id)) continue
      if (map.getLayoutProperty(l.id, 'visibility') === 'none') continue
      map.setLayoutProperty(l.id, 'visibility', 'none')
      f.versteckt.push(l.id)
    }
    naviEbenen(map)
  } else {
    for (const id of f.versteckt || []) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
    for (const id of ['navi', 'navi-pfeil', 'navi-spitze', 'navi-ziel']) map.getSource(id)?.setData(LEER)
  }
}

function minutenRest(f, meter = f.meter) {
  const rest = Math.max(0, f.gesamt - meter)
  const i = f.info
  // Anfahrt mit der Zeit des Routings, die Tour mit ihrer eigenen Fahrzeit
  const inAnfahrt = Math.max(0, f.anfahrtEnde - meter)
  const anf = f.anfahrtEnde > 0 && i.anfahrtSek ? (inAnfahrt / Math.max(1, f.anfahrtEnde)) * (i.anfahrtSek / 60) : 0
  return anf + (rest - inAnfahrt) * (i.tourMinJeM || 1 / 900)
}

/** Kurzer Text fürs Banner: Straße (wie bei Apple), sonst die Handlung. */
function bannerText(s) {
  const [, art, , strasse, ausfahrt] = s
  if (art === 'arrive') return 'Ziel'
  if (art === 'waypoint') return strasse || 'Start der Tour'
  if (/roundabout|rotary/.test(art)) return `${ausfahrt ? `${ausfahrt}. Ausfahrt` : 'Kreisverkehr'}${strasse ? ` · ${strasse}` : ''}`
  return strasse || satz(s)
}

const ABBIEGEN = /turn|fork|roundabout|rotary|end of road|merge|ramp|exit/

/** Weißer Pfeil auf der Straße vor der nächsten Abzweigung. */
function zeichnePfeil(f) {
  const map = getHubMap()
  const s = f.d.schritte[f.schritt]
  const zeigen = s && ABBIEGEN.test(s[1]) && s[2] !== 'straight' && s[0] - f.meter < 700
  const schluessel = zeigen ? `${f.dVersion}-${f.schritt}` : ''
  if (schluessel === f.pfeilSchluessel || !map?.getSource('navi-pfeil')) return
  f.pfeilSchluessel = schluessel
  if (!zeigen) { map.getSource('navi-pfeil').setData(LEER); map.getSource('navi-spitze').setData(LEER); return }
  const m0 = s[0]
  const linie = []
  for (let m = Math.max(0, m0 - 32); m <= Math.min(f.gesamt, m0 + 22); m += 2) {
    const p = punktBei(f.d, m)
    linie.push([p[1], p[0]])
  }
  const ende = punktBei(f.d, Math.min(f.gesamt, m0 + 22))
  map.getSource('navi-pfeil').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: linie } })
  map.getSource('navi-spitze').setData({ type: 'Feature', properties: { winkel: kursBei(f.d, m0 + 14, 8) }, geometry: { type: 'Point', coordinates: [ende[1], ende[0]] } })
}

function zeichne() {
  const f = fahrt
  if (!f) return
  const { schritte } = f.d
  // Abfahrt zählt nicht als Hinweis — sofort den nächsten zeigen
  while (f.schritt < schritte.length - 1 && (schritte[f.schritt][0] < f.meter - 12 || schritte[f.schritt][1] === 'depart')) f.schritt++
  const naechsterS = schritte[f.schritt]
  const bis = Math.max(0, naechsterS[0] - f.meter)
  const danach = schritte[f.schritt + 1]
  const restMin = minutenRest(f)
  const el = f.el
  const set = (sel, text) => { const x = el.querySelector(sel); if (x.textContent !== text) x.textContent = text }

  set('.fahrt-an', uhr(restMin))
  set('.fahrt-dauer', restMin >= 60 ? `${Math.floor(restMin / 60)}:${String(Math.round(restMin % 60)).padStart(2, '0')} h` : `${Math.max(1, Math.round(restMin))} min`)
  set('.fahrt-km', mFormat(Math.max(0, f.gesamt - f.meter)))
  set('.fahrt-tempo strong', f.tempo != null ? String(Math.round(f.tempo)) : '–')
  const dEl = el.querySelector('.fahrt-danach')

  // Weit neben der Strecke ist der Abbiegehinweis wertlos — bis zur Neuberechnung: zurück zur Linie
  if (f.gestartet && f.abstand > 150) {
    el.querySelector('.fahrt-pfeil').innerHTML = pfeil([0, 'waypoint'])
    set('.fahrt-bis', mFormat(f.abstand))
    set('.fahrt-satz', f.neuBerechnung ? 'Route wird neu berechnet …' : 'Zurück zur Strecke')
    dEl.hidden = true
    return
  }
  const pfeilSchl = `${naechsterS[1]}|${naechsterS[2]}`
  if (f.pfeilHtml !== pfeilSchl) { f.pfeilHtml = pfeilSchl; el.querySelector('.fahrt-pfeil').innerHTML = pfeil(naechsterS) }
  set('.fahrt-bis', f.gestartet ? mFormat(bis) : '')
  set('.fahrt-satz', f.gestartet ? (naechsterS[1] === 'arrive' && bis > 150 ? 'Bis zum Ziel' : bannerText(naechsterS)) : (f.gpsText || 'Warte auf GPS …'))
  const dannZeigen = danach && f.gestartet && danach[0] - naechsterS[0] < 400 && !['waypoint', 'arrive'].includes(danach[1])
  if (dannZeigen) {
    const schl = `${f.dVersion}-${f.schritt}`
    if (dEl.dataset.s !== schl) { dEl.dataset.s = schl; dEl.innerHTML = `<span>Dann</span>${pfeil(danach)}<span>${esc(bannerText(danach))}</span>` }
    dEl.hidden = false
  } else dEl.hidden = true
  const abseits = el.querySelector('.fahrt-abseits')
  if (f.neuBerechnung) { abseits.hidden = false; set('.fahrt-abseits', 'Route wird neu berechnet …') }
  else abseits.hidden = true
  zeichnePfeil(f)

  // Ansagen: je Hinweis jede Stufe einmal
  if (f.gestartet && f.abstand <= ABSEITS_M) {
    for (let i = 0; i < ANSAGEN_M.length; i++) {
      const stufe = ANSAGEN_M[i]
      const schluessel = `${f.dVersion}-${f.schritt}-${stufe}`
      if (bis <= stufe && !f.angesagt.has(schluessel)) {
        ANSAGEN_M.filter((x) => x >= stufe).forEach((x) => f.angesagt.add(`${f.dVersion}-${f.schritt}-${x}`))
        // Schon fast bei der nächsten Stufe (z. B. 300 m bei 800/250): diese Ansage
        // auslassen, sonst folgen zwei Ansagen im Sekundenabstand und schneiden sich ab
        const tiefer = ANSAGEN_M[i + 1]
        if (tiefer != null && bis < tiefer + (stufe - tiefer) * 0.25) continue
        if (naechsterS[1] === 'waypoint') sprich(bis < 80 ? 'start-erreicht' : ansageFuer(stufe, naechsterS), bis < 80 ? `${satz(naechsterS)} erreicht. Viel Spaß, und fahr vorsichtig.` : `In ${mSprache(bis)} beginnt die Tour.`)
        else if (naechsterS[1] === 'arrive') sprich(bis < 80 ? 'angekommen' : ansageFuer(stufe, naechsterS), bis < 80 ? 'Du bist angekommen.' : `In ${mSprache(bis)} erreichst du dein Ziel.`)
        else sprich(ansageFuer(stufe, naechsterS), stufe === 60 ? satz(naechsterS) : `In ${mSprache(bis)} ${nachEntfernung(satz(naechsterS))}`)
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
    if (g.meter < n.meter - 40 && g.index >= f.index - 50) n = g
  }
  const p = projiziere(f.d, lat, lng, n.index)
  return { index: n.index, meter: Math.min(n.meter, p.abstand), entlang: p.meter }
}

const winkelDiff = (a, b) => ((b - a + 540) % 360) - 180

/** Eine GPS-Meldung: Lage auf der Linie bestimmen, die Bildschleife gleitet dorthin. */
function position(pos) {
  const f = fahrt
  if (!f) return
  const { latitude: lat, longitude: lng, heading, speed, accuracy } = pos.coords
  if (accuracy > 80 && f.gestartet) return // grobe Ausreißer verwerfen
  const jetzt = performance.now()
  const l = aufLinie(lat, lng)
  f.abstand = l.meter
  const aufStrecke = l.meter <= ABSEITS_M
  // Geschwindigkeit: GPS, sonst aus dem Fortschritt entlang der Linie
  let v = Number.isFinite(speed) && speed >= 0 ? speed : null
  if (v == null && f.fix?.aufStrecke && aufStrecke) v = Math.max(0, (l.entlang - f.fix.meter) / Math.max(0.3, (jetzt - f.fix.zeit) / 1000))
  f.tempo = v != null ? v * 3.6 : f.tempo
  if (aufStrecke) { f.index = l.index; f.meter = Math.max(f.meter, l.entlang); f.abseitsSeit = 0 }
  else if (!f.abseitsSeit) f.abseitsSeit = Date.now()
  const gpsKurs = Number.isFinite(heading) && (v || 0) > 1.5 ? heading : null
  f.fix = { zeit: jetzt, meter: f.meter, v: Math.min(70, v || 0), lat, lng, kurs: gpsKurs, aufStrecke }
  if (!f.gestartet) { f.anzeigeM = f.meter; f.frei = [lat, lng] }
  f.gestartet = true
  f.letztePos = { lat, lng }
  // Pause-Erinnerung nach 90 min Fahrt; wer 10 min steht, hat Pause gemacht
  const jetztMs = Date.now()
  if ((f.tempo ?? 0) < 5) f.stehtSeit ||= jetztMs
  else {
    if (f.stehtSeit && jetztMs - f.stehtSeit > 10 * 60_000) f.pauseAb = jetztMs + PAUSE_NACH_MS
    f.stehtSeit = 0
  }
  if (jetztMs > f.pauseAb && (f.tempo ?? 0) >= 5) {
    f.pauseAb = jetztMs + PAUSE_NACH_MS
    sprich('pause', 'Du bist jetzt seit anderthalb Stunden unterwegs. Gönn dir eine kurze Pause. Ausgeruht fährt es sich sicherer.', { anhaengen: true })
  }
  // Nach 8 s neben der Strecke: Rückführung berechnen
  if (f.abseitsSeit && Date.now() - f.abseitsSeit > 8000 && !f.neuBerechnung && Date.now() - (f.letzteNeuberechnung || 0) > 20000) neuBerechnen()
  zeichne()
  const letzter = f.d.schritte[f.d.schritte.length - 1]
  if (letzter[1] === 'arrive' && f.meter > f.gesamt - 40) beenden(true)
}

function kameraRand(map) {
  const h = map.getContainer().clientHeight
  return { top: Math.round(h * 0.5), bottom: Math.round(h * 0.06), left: 0, right: 0 }
}

/** Bildschleife: Puck und Kamera gleiten, Route färbt sich hinter dem Puck grau. */
function schleife(jetzt) {
  const f = fahrt
  if (!f) return
  f.raf = requestAnimationFrame(schleife)
  const map = getHubMap()
  const dt = Math.min(0.1, (jetzt - (f.tLetzt || jetzt)) / 1000)
  f.tLetzt = jetzt
  if (!map || !f.fix) return
  let lat, lng, kursZiel
  if (f.fix.aufStrecke) {
    // voraus schätzen mit der gemessenen Geschwindigkeit, höchstens 2,5 s
    const seit = Math.min(2.5, (jetzt - f.fix.zeit) / 1000)
    const ziel = Math.min(f.gesamt, f.fix.meter + f.fix.v * seit)
    f.anzeigeM = (f.anzeigeM ?? ziel) + (ziel - (f.anzeigeM ?? ziel)) * Math.min(1, dt * 6)
    ;[lat, lng] = punktBei(f.d, f.anzeigeM)
    f.frei = [lat, lng]
    kursZiel = kursBei(f.d, f.anzeigeM, 30)
  } else {
    f.frei[0] += (f.fix.lat - f.frei[0]) * Math.min(1, dt * 4)
    f.frei[1] += (f.fix.lng - f.frei[1]) * Math.min(1, dt * 4)
    ;[lat, lng] = f.frei
    kursZiel = f.fix.kurs ?? f.kurs ?? 0
  }
  f.kurs = f.kurs == null ? kursZiel : (f.kurs + winkelDiff(f.kurs, kursZiel) * Math.min(1, dt * 3.2) + 360) % 360
  f.marker.setLngLat([lng, lat])
  f.marker.setRotation(f.kurs)
  if (f.folgen && !f.anflug) {
    const kmh = f.tempo || 0
    const naechsterS = f.d.schritte[f.schritt]
    const nahAbzweig = naechsterS && ABBIEGEN.test(naechsterS[1]) && naechsterS[0] - (f.anzeigeM ?? 0) < 160
    const zoomZiel = (kmh < 25 ? 17.4 : kmh < 55 ? 16.8 : kmh < 85 ? 16.2 : 15.6) + (nahAbzweig ? 0.5 : 0)
    f.zoom = f.zoom == null ? zoomZiel : f.zoom + (zoomZiel - f.zoom) * Math.min(1, dt * 1.2)
    map.jumpTo({ center: [lng, lat], bearing: f.kurs, pitch: 60, zoom: f.zoom, padding: f.rand || (f.rand = kameraRand(map)) })
  }
  // gefahrener Teil grau — die Verlaufsgrafik nur alle 200 ms neu
  if (jetzt - (f.tGrau || 0) > 200 && map.getLayer('navi-linie')) {
    f.tGrau = jetzt
    const p = Math.max(0, Math.min(1, (f.anzeigeM ?? 0) / f.gesamt))
    map.setPaintProperty('navi-linie', 'line-gradient', VERLAUF(p, BLAU, GEFAHREN))
    map.setPaintProperty('navi-rand', 'line-gradient', VERLAUF(p, BLAU_RAND, GEFAHREN_RAND))
  }
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
    const tourStartAlt = f.anfahrtEnde
    f.anfahrtEnde = tourStartAlt > f.d.kum[ziel] ? rueck.kum[rueck.kum.length - 1] + (tourStartAlt - f.d.kum[ziel]) : 0
    f.d = neu
    f.gesamt = neu.kum[neu.kum.length - 1]
    f.index = 0; f.meter = 0; f.schritt = 0; f.abseitsSeit = 0; f.dVersion++
    f.anzeigeM = 0
    if (f.fix) f.fix = { ...f.fix, meter: 0, aufStrecke: true }
    zeichneNaviLinie()
    sprich('neu', 'Kein Problem, ich habe die Route neu berechnet.')
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
  map.getSource('navi')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: f.d.pts.map(([a, b]) => [b, a]) } })
  map.getSource('navi-ziel')?.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [f.d.pts.at(-1)[1], f.d.pts.at(-1)[0]] } })
  f.pfeilSchluessel = null
}

async function wachHalten() {
  try { fahrt.wach = await navigator.wakeLock?.request('screen') } catch {}
}

/** Simulierte Fahrt entlang der Linie (nur zum Testen, s. Kopf). */
function simulieren() {
  const f = fahrt
  let sek = 0
  const abweichen = (() => { try { return localStorage.getItem('mm_sim_abweichen') === '1' } catch { return false } })()
  const tick = () => {
    if (fahrt !== f) return
    sek++
    // 50 km/h im Ort, 90 außerhalb — grob nach Kurvigkeit egal: konstant 22 m/s
    const p = punktBei(f.d, f.meter + 22)
    const weg = abweichen && sek > 20 && f.dVersion === 0 ? 0.004 + (sek - 20) * 0.0002 : 0
    position({ coords: { latitude: p[0] + weg, longitude: p[1], heading: null, speed: 22, accuracy: 5 } })
    f.simT = setTimeout(tick, 1000)
  }
  const s = simStart()
  if (s) position({ coords: { latitude: s.lat, longitude: s.lng, heading: null, speed: 0, accuracy: 5 } })
  f.simT = setTimeout(tick, 2400)
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
      <div class="fahrt-banner">
        <div class="fahrt-banner-haupt">
          <div class="fahrt-pfeil" aria-hidden="true"></div>
          <div class="fahrt-hinweis">
            <div class="fahrt-bis"></div>
            <div class="fahrt-satz">Warte auf GPS …</div>
          </div>
        </div>
        <div class="fahrt-danach" hidden></div>
      </div>
      <div class="fahrt-abseits" hidden></div>
    </div>
    <div class="fahrt-mitte">
      <div class="fahrt-tempo" aria-label="Geschwindigkeit"><strong>–</strong><span>km/h</span></div>
      <div class="fahrt-seite">
        <button type="button" class="fahrt-rund" data-fahrt="ton" aria-pressed="true" aria-label="Ansagen">${ICON.ton}</button>
        <button type="button" class="fahrt-rund" data-fahrt="uebersicht" aria-label="Übersicht">${ICON.uebersicht}</button>
        <button type="button" class="fahrt-rund fahrt-rund--folgen" data-fahrt="folgen" hidden aria-label="Wieder mitfahren">${ICON.folgen}</button>
      </div>
    </div>
    <div class="fahrt-unten">
      <div class="fahrt-werte">
        <div><strong class="fahrt-an"></strong><span>Ankunft</span></div>
        <div><strong class="fahrt-dauer"></strong><span>Fahrzeit</span></div>
        <div><strong class="fahrt-km"></strong><span>Strecke</span></div>
      </div>
      <button type="button" class="fahrt-ende" data-fahrt="ende">Ende</button>
      <div class="fahrt-name">${esc(t.name)}</div>
    </div>`
  host.appendChild(el)
  document.querySelector('.konf-karte-hub')?.classList.add('kv-faehrt')
  document.body.classList.add('mm-faehrt')

  const puck = document.createElement('div')
  puck.className = 'navi-puck'
  puck.innerHTML = '<div class="navi-puck-scheibe"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l6.2 15.2a.6.6 0 0 1-.85.74L12 16.6l-5.35 2.84a.6.6 0 0 1-.85-.74z"/></svg></div>'
  fahrt = {
    t, d, el, onEnde, info,
    gesamt: d.kum.at(-1), anfahrtEnde: info.anfahrtM || 0,
    index: 0, meter: 0, schritt: 0, abstand: 0, gestartet: false, folgen: true, ton: true, tempo: null,
    angesagt: new Set(), dVersion: 0, anflug: true, pauseAb: Date.now() + PAUSE_NACH_MS, stehtSeit: 0,
    marker: new ml.Marker({ element: puck, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([d.pts[0][1], d.pts[0][0]]).addTo(map),
    watch: null, wach: null,
  }
  const f = fahrt
  karteFuerFahrt(map, true, f)
  zeichneNaviLinie()
  map.setMaxPitch(65)
  // Anflug wie bei Apple: aus der Übersicht schräg hinter den Start, dann übernimmt die Bildschleife
  const start = d.pts[0]
  map.flyTo({ center: [start[1], start[0]], zoom: 16.8, pitch: 60, bearing: kursBei(d, 0, 40), padding: kameraRand(map), duration: 2200, essential: true })
  map.once('moveend', () => { if (fahrt === f) f.anflug = false })
  f.raf = requestAnimationFrame(schleife)
  f.groesse = () => { if (fahrt === f) f.rand = kameraRand(map) }
  map.on('resize', f.groesse)
  // Nutzer verschiebt die Karte → nicht mehr hinterherfahren, bis "Zentrieren"
  f.wegschieben = (e) => {
    if (!e.originalEvent || !fahrt) return
    fahrt.folgen = false
    el.querySelector('[data-fahrt="folgen"]').hidden = false
  }
  map.on('dragstart', f.wegschieben)

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fahrt]')
    if (!b || !fahrt) return
    const was = b.dataset.fahrt
    if (was === 'ende') beenden()
    if (was === 'folgen') {
      fahrt.anflug = true
      b.hidden = true
      const p = fahrt.frei || start
      map.easeTo({ center: [p[1], p[0]], zoom: fahrt.zoom || 16.8, pitch: 60, bearing: fahrt.kurs || 0, padding: kameraRand(map), duration: 900 })
      map.once('moveend', () => { if (fahrt) { fahrt.anflug = false; fahrt.folgen = true } })
    }
    if (was === 'uebersicht') {
      fahrt.folgen = false
      el.querySelector('[data-fahrt="folgen"]').hidden = false
      const rest = fahrt.d.pts.slice(fahrt.index)
      map.fitBounds(grenzen(fahrt.letztePos ? [...rest, [fahrt.letztePos.lat, fahrt.letztePos.lng]] : rest), { padding: { top: 200, bottom: 190, left: 50, right: 50 }, pitch: 0, bearing: 0, duration: 900 })
    }
    if (was === 'ton') {
      fahrt.ton = !fahrt.ton
      b.innerHTML = fahrt.ton ? ICON.ton : ICON.stumm
      b.setAttribute('aria-pressed', String(fahrt.ton))
      if (!fahrt.ton) verstummen()
    }
  })
  f.sichtbar = () => { if (document.visibilityState === 'visible' && fahrt && !fahrt.wach) wachHalten() }
  document.addEventListener('visibilitychange', f.sichtbar)

  wachHalten()
  // Aufzeichnung im Hintergrund (ride-tracker.js) — am Ende wird gefragt, ob sie gespeichert wird
  if (mitschneiden && !sim()) {
    starteAufzeichnung({}).then((st) => { if (fahrt === f) f.aufnahme = st; else st.abbrechen() }).catch(() => {})
  }
  if (sim()) simulieren()
  else {
    f.watch = navigator.geolocation.watchPosition(position, (err) => {
      if (!fahrt) return
      fahrt.gpsText = err.code === 1 ? 'Standort nicht freigegeben' : 'Kein GPS-Signal'
      zeichne()
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
  }
  // Karte entlang der Strecke offline ablegen (Funklöcher im Wald und in den Bergen)
  import('./offline.js').then(({ vorladen }) => vorladen(d.pts, (n, g) => {
    if (fahrt?.el !== el) return
    el.querySelector('.fahrt-name').textContent = n < g ? `${t.name} · Karte wird offline gespeichert ${Math.round((n / g) * 100)} %` : `${t.name} · Karte offline verfügbar`
  })).catch(() => {})
  const wartet = wartetAufDich()
  f.begruessungBis = Date.now() + 9000
  sprich('hallo', `Hi, ich bin ${PERSONA.name}. Fahr vorsichtig. ${wartet ? `${wartet} wartet auf dich.` : 'Zu Hause wartet jemand auf dich.'}`)
  sprich(info.anfahrtM ? 'los-anfahrt' : 'los', info.anfahrtM ? `Los geht's. Erst ${mSprache(info.anfahrtM)} zum Start der Tour.` : "Los geht's. Gute Fahrt, und komm gut heim.", { anhaengen: true })
  zeichne()
  return true
}

export function beenden(ziel = false) {
  const f = fahrt
  if (!f) return
  fahrt = null
  cancelAnimationFrame(f.raf)
  clearTimeout(f.simT)
  import('./offline.js').then((m) => m.vorladenAbbrechen()).catch(() => {})
  if (f.watch != null) navigator.geolocation.clearWatch(f.watch)
  try { f.wach?.release() } catch {}
  document.removeEventListener('visibilitychange', f.sichtbar)
  const map = getHubMap()
  map?.off('dragstart', f.wegschieben)
  map?.off('resize', f.groesse)
  f.marker.remove()
  f.el.remove()
  zeigeAnfahrt(null)
  if (map) karteFuerFahrt(map, false, f)
  document.querySelector('.konf-karte-hub')?.classList.remove('kv-faehrt')
  document.body.classList.remove('mm-faehrt')
  if (map) { map.easeTo({ pitch: 0, bearing: 0, duration: 700, padding: { top: 0, bottom: 0, left: 0, right: 0 } }); map.once('moveend', () => map.setMaxPitch(0)) }
  if (ziel) {
    sprich('angekommen', 'Du bist angekommen. Schön, dass du heil zurück bist.', { ton: f.ton })
    heimMelden()
  } else verstummen()
  const aufnahme = f.aufnahme?.beenden()
  if (aufnahme && aufnahme.km >= 1) aufnahmeSpeichern(f, aufnahme)
  else f.onEnde?.(ziel)
}

/** Am Ziel: kurz Bescheid geben, dass man heil angekommen ist. */
function heimMelden() {
  const wer = wartetAufDich()
  const host = document.querySelector('.konf-karte-hub .kv-map-wrap')
  if (!host) return
  host.querySelector('.fahrt-heim')?.remove()
  const el = document.createElement('div')
  el.className = 'fahrt-heim'
  el.setAttribute('role', 'status')
  el.innerHTML = `<strong>Gut angekommen</strong>
    <span>${wer ? `Sag ${esc(wer)} Bescheid, dass du heil da bist.` : 'Sag zu Hause Bescheid, dass du heil da bist.'}</span>
    <div class="fahrt-heim-knoepfe">
      <button type="button" data-heim="nein">Später</button>
      <button type="button" data-heim="ja" class="fahrt-heim-haupt">Bescheid geben</button>
    </div>`
  host.appendChild(el)
  const weg = setTimeout(() => el.remove(), 60_000)
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-heim]')
    if (!b) return
    clearTimeout(weg)
    el.remove()
    if (b.dataset.heim !== 'ja') return
    const text = 'Bin gut angekommen 🏍️ – bis gleich!'
    try {
      if (navigator.share) await navigator.share({ text })
      else location.href = `sms:?&body=${encodeURIComponent(text)}`
    } catch {}
  })
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
