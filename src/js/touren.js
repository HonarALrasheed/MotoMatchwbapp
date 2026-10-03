/* ═══════════════════════════════════════════════════
   TOUREN im Karten-Reiter — nach dem Vorbild von komoot:
   Liste vorgeschlagener Touren neben der Karte, Filter (Umkreis, Länge,
   Kurven, Art), Seiten zu je 12, Linien der sichtbaren Touren auf der Karte,
   Detailansicht mit Höhenprofil, GPX und Navigation.

   Daten: public/data/touren/index.json (alle Touren, grobe Vorschaulinie) und
   public/data/touren/<id>.json (genaue Linie + Höhenprofil, erst beim Öffnen).
   Erzeugt von scripts/touren/bauen.mjs — eigene Auswahl, Strecken aus
   OpenStreetMap. Fremde Tourendatenbanken (Calimoto, Kurviger …) sind
   geschützt und werden bewusst nicht übernommen.

   Der Zustand lebt auf Modulebene: der Karten-Reiter baut sein DOM bei jedem
   Wechsel neu, Filter und offene Tour sollen das überleben.
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { getHubMap, onHubMapReady, getUserCoords, haversineKm } from './garage.js'

const PRO_SEITE = 12
const LS_GEMERKT = 'mm_touren_gemerkt_v1'
const UMKREISE = [25, 50, 100, 200, 0] // 0 = ganz Deutschland
/* Kurvigkeit in Grad Richtungsänderung je km (bauen.mjs). Grenzen aus der
   Verteilung der eigenen Touren: unteres und oberes Drittel. */
const KURVEN_STUFEN = [
  { id: 'entspannt', label: 'Entspannt', bis: 100 },
  { id: 'kurvig', label: 'Kurvig', bis: 140 },
  { id: 'sehr', label: 'Sehr kurvig', bis: Infinity },
]
const SCHWIERIGKEIT = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Anspruchsvoll' }

const zustand = {
  umkreis: 100,
  laenge: 'alle', // alle | kurz | mittel | lang
  kurven: 'alle', // alle | entspannt | kurvig | sehr
  typ: 'alle', // alle | rund | strecke
  gemerkt: false,
  sort: 'entfernung', // entfernung | kurven | laenge
  seite: 1,
  offenerFilter: null,
  herkunft: null, // { lat, lng } aus "In diesem Gebiet suchen" / Ortssuche
  offeneTour: null,
  aktiv: false,
}

let indexPromise = null
let touren = []
let quellenText = ''
const details = new Map()
let listenLinien = [] // { id, linie, start }
let detailObjekte = []
let profilMarker = null
let hoverId = null

// ── Daten ────────────────────────────────────────────────────────────────

function ladeIndex() {
  if (!indexPromise) {
    indexPromise = fetch('/data/touren/index.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => {
        quellenText = j.quellen || ''
        touren = (j.touren || []).map((t) => ({ ...t, _pts: dekodieren(t.vorschau) }))
        return touren
      })
      .catch((err) => { indexPromise = null; throw err })
  }
  return indexPromise
}

async function ladeDetail(id) {
  if (details.has(id)) return details.get(id)
  const r = await fetch(`/data/touren/${encodeURIComponent(id)}.json`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  const pts = dekodieren(j.linie)
  // kumulierte Strecke in m — für den Punkt unter dem Mauszeiger im Höhenprofil
  const kum = [0]
  for (let i = 1; i < pts.length; i++) kum.push(kum[i - 1] + haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * 1000)
  const d = { pts, kum, profil: j.profil || [] }
  details.set(id, d)
  return d
}

/** Google-Polyline → [[lat, lng], …] */
function dekodieren(s = '') {
  const pts = []
  let i = 0, lat = 0, lng = 0
  const zahl = () => {
    let erg = 0, shift = 0, b
    do { b = s.charCodeAt(i++) - 63; erg |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    return erg & 1 ? ~(erg >> 1) : erg >> 1
  }
  while (i < s.length) {
    lat += zahl(); lng += zahl()
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}

const gemerkt = () => {
  try { const v = JSON.parse(localStorage.getItem(LS_GEMERKT) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function merkenUmschalten(id) {
  const liste = gemerkt()
  const neu = liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]
  try { localStorage.setItem(LS_GEMERKT, JSON.stringify(neu)) } catch {}
  return neu.includes(id)
}

function herkunft() {
  if (zustand.herkunft) return zustand.herkunft
  const { lat, lng } = getUserCoords()
  return lat == null ? null : { lat, lng }
}

/** Kürzester Abstand zur Strecke (nicht nur zum Start) — wie bei komoot. */
function abstandKm(t, h) {
  if (!h) return null
  let min = Infinity
  for (const [la, ln] of t._pts) {
    const d = haversineKm(h.lat, h.lng, la, ln)
    if (d < min) min = d
  }
  return min
}

// Ohne Standort gibt es keine Entfernung — dann nach Kurven
const sortWirksam = () => (zustand.sort === 'entfernung' && !herkunft() ? 'kurven' : zustand.sort)

const kurvenStufe = (k) => KURVEN_STUFEN.find((s) => k < s.bis)

function gefiltert() {
  const h = herkunft()
  const merk = gemerkt()
  let liste = touren.map((t) => ({ t, km: abstandKm(t, h) }))
  if (zustand.gemerkt) liste = liste.filter(({ t }) => merk.includes(t.id))
  else {
    if (h && zustand.umkreis) liste = liste.filter(({ km }) => km <= zustand.umkreis)
    if (zustand.laenge === 'kurz') liste = liste.filter(({ t }) => t.km < 100)
    if (zustand.laenge === 'mittel') liste = liste.filter(({ t }) => t.km >= 100 && t.km <= 200)
    if (zustand.laenge === 'lang') liste = liste.filter(({ t }) => t.km > 200)
    if (zustand.kurven !== 'alle') liste = liste.filter(({ t }) => kurvenStufe(t.kurven).id === zustand.kurven)
    if (zustand.typ !== 'alle') liste = liste.filter(({ t }) => t.typ === zustand.typ)
  }
  const sortierer = {
    entfernung: (a, b) => (a.km ?? 0) - (b.km ?? 0) || a.t.name.localeCompare(b.t.name, 'de'),
    kurven: (a, b) => b.t.kurven - a.t.kurven,
    laenge: (a, b) => a.t.km - b.t.km,
  }
  liste.sort(sortierer[sortWirksam()])
  return liste
}

// ── Formatierung ─────────────────────────────────────────────────────────

const zahl = (n) => Math.round(n).toLocaleString('de-DE')
const dauer = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')} Std`
const entfernung = (km) => km == null ? '' : km < 1 ? 'direkt hier' : `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km entfernt`

const ICON = {
  uhr: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  auf: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  ab: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 9v8H9"/></svg>',
  kurve: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20c0-5 4-6 8-8s8-3 8-8"/></svg>',
  merken: (an) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="${an ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  pfeil: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
}

/** Kurvigkeit als drei Balken — gleiche Idee wie die Schwierigkeitsbalken bei komoot. */
function kurvenBalken(k) {
  const n = KURVEN_STUFEN.indexOf(kurvenStufe(k)) + 1
  return `<span class="tour-kurven" title="${kurvenStufe(k).label} (${k}°/km)">${ICON.kurve}<span class="tour-kurven-balken">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'an' : ''}"></i>`).join('')}</span>${kurvenStufe(k).label}</span>`
}

/** Form der Strecke als kleines Bild — wir haben keine Fotos, aber jede Tour eine Linie. */
function streckenBild(t, b = 96, h = 96) {
  const pts = t._pts
  const k = Math.cos((pts[0][0] * Math.PI) / 180)
  const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const pad = 12
  const s = Math.min((b - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxY - minY || 1))
  const ox = (b - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2
  const xy = pts.map((_, i) => [(xs[i] - minX) * s + ox, (ys[i] - minY) * s + oy].map((v) => v.toFixed(1)))
  const d = 'M' + xy.map((p) => p.join(',')).join('L')
  const [sx, sy] = xy[0], [zx, zy] = xy[xy.length - 1]
  return `<svg viewBox="0 0 ${b} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="${d}" class="tour-bild-schatten"/>
    <path d="${d}" class="tour-bild-linie"/>
    ${t.typ === 'strecke' ? `<circle cx="${zx}" cy="${zy}" r="3.2" class="tour-bild-ziel"/>` : ''}
    <circle cx="${sx}" cy="${sy}" r="3.6" class="tour-bild-start"/>
  </svg>`
}

// ── Markup ───────────────────────────────────────────────────────────────

/** Umkreis-Leiste — sitzt in der Suchzeile an der Stelle der Orte-Radien. */
export function buildTourenUmkreis() {
  return `<div class="kv-radius-group tour-umkreis-group" role="group" aria-label="Umkreis der Touren">
    <div class="kv-radius-pills tour-umkreis">
      ${UMKREISE.map((u) => `<button type="button" class="kv-radius-pill${u === zustand.umkreis ? ' kv-radius-pill--active' : ''}" data-umkreis="${u}">${u ? `${u} km` : 'Alle'}</button>`).join('')}
    </div>
  </div>`
}

export function buildTourenAnsicht() {
  return `<div class="kv-ansicht kv-ansicht--touren" id="kv-touren">
    <div class="tour-filters" id="tour-filters"></div>
    <div class="tour-optionen" id="tour-optionen" hidden></div>
    <div class="kv-list-bar tour-list-bar">
      <span class="kv-list-count" id="tour-count"></span>
      <div class="kv-list-tools">
        <button type="button" class="kv-chip" id="tour-sort">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18M3 7l4-4 4 4M17 21V3M13 17l4 4 4-4"/></svg>
          <span id="tour-sort-label"></span>
        </button>
      </div>
    </div>
    <div class="tour-liste" id="tour-liste"><div class="kv-results-empty"><span>…</span></div></div>
  </div>`
}

const FILTER = {
  laenge: { label: 'Länge', werte: [['alle', 'Alle Längen'], ['kurz', 'Unter 100 km'], ['mittel', '100–200 km'], ['lang', 'Über 200 km']] },
  kurven: { label: 'Kurven', werte: [['alle', 'Alle'], ...KURVEN_STUFEN.map((s) => [s.id, s.label])] },
  typ: { label: 'Art', werte: [['alle', 'Alle'], ['rund', 'Rundtour'], ['strecke', 'Strecke & Ferienstraße']] },
}

function renderFilter() {
  const leiste = document.getElementById('tour-filters')
  if (!leiste) return
  const n = gemerkt().length
  leiste.innerHTML = Object.entries(FILTER).map(([key, f]) => {
    const wert = zustand[key]
    const aktiv = wert !== 'alle'
    const text = aktiv ? f.werte.find((w) => w[0] === wert)[1] : f.label
    return `<button type="button" class="kv-chip tour-filter-chip" data-filter="${key}" data-active="${aktiv}" aria-expanded="${zustand.offenerFilter === key}">${esc(text)}${ICON.pfeil}</button>`
  }).join('') + `<button type="button" class="kv-chip kv-chip--fav" data-filter="gemerkt" data-active="${zustand.gemerkt}" aria-pressed="${zustand.gemerkt}" aria-label="Gemerkte Touren">${ICON.merken(false)}<span class="kv-chip-count">${n}</span></button>`

  const opt = document.getElementById('tour-optionen')
  const f = FILTER[zustand.offenerFilter]
  if (!opt) return
  opt.hidden = !f
  opt.innerHTML = f ? f.werte.map(([id, label]) => `<button type="button" class="tour-option${zustand[zustand.offenerFilter] === id ? ' tour-option--aktiv' : ''}" data-wert="${id}">${esc(label)}</button>`).join('') : ''

  const sortLabel = document.getElementById('tour-sort-label')
  if (sortLabel) sortLabel.textContent = { entfernung: 'Entfernung', kurven: 'Kurvigkeit', laenge: 'Länge' }[sortWirksam()]
}

function karte(t, km, i) {
  return `<article class="tour-card${hoverId === t.id ? ' tour-card--hover' : ''}" data-tour="${esc(t.id)}" style="--i:${Math.min(i, 12)}" tabindex="0">
    <div class="tour-bild">${streckenBild(t)}</div>
    <div class="tour-card-body">
      <div class="tour-badges">
        <span class="tour-badge tour-badge--${t.schwierigkeit}">${SCHWIERIGKEIT[t.schwierigkeit]}</span>
        ${kurvenBalken(t.kurven)}
      </div>
      <h3 class="tour-name">${esc(t.name)}</h3>
      <div class="tour-stats">${ICON.uhr}${dauer(t.min)}<span class="kv-result-dot">·</span>${zahl(t.km)} km<span class="kv-result-dot">·</span>${ICON.auf}${zahl(t.auf)} m</div>
      <div class="tour-sub">${t.typ === 'rund' ? 'Rundtour' : 'Strecke'} · ${esc(t.region)}${km != null ? ` · ${entfernung(km)}` : ''}</div>
    </div>
  </article>`
}

/** "Ferienstraßen in der Nähe" — die Sammlungen, die komoot zwischen die Touren schiebt. */
function sammlung() {
  const h = herkunft()
  const fs = touren.filter((t) => t.tags?.includes('Ferienstraße'))
    .map((t) => ({ t, km: abstandKm(t, h) }))
    .sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
    .slice(0, 8)
  if (fs.length < 2) return ''
  return `<section class="tour-sammlung" aria-label="Ferienstraßen in der Nähe">
    <div class="tour-sammlung-kopf">
      <h4>Ferienstraßen ${h ? 'in der Nähe' : 'in Deutschland'}</h4>
      <div class="tour-sammlung-pfeile">
        <button type="button" class="tour-pfeil" data-scroll="-1" aria-label="Zurück">‹</button>
        <button type="button" class="tour-pfeil" data-scroll="1" aria-label="Weiter">›</button>
      </div>
    </div>
    <div class="tour-sammlung-band">
      ${fs.map(({ t, km }) => `<button type="button" class="tour-sammlung-karte" data-tour="${esc(t.id)}">
        <span class="tour-sammlung-bild">${streckenBild(t, 220, 120)}</span>
        <span class="tour-sammlung-text">
          <strong>${esc(t.name)}</strong>
          <span>${zahl(t.km)} km${km != null ? ` · ${entfernung(km)}` : ''}</span>
        </span>
      </button>`).join('')}
    </div>
  </section>`
}

function seiten(gesamt) {
  const n = Math.ceil(gesamt / PRO_SEITE)
  if (n <= 1) return ''
  const s = zustand.seite
  const nummern = [...new Set([1, s - 1, s, s + 1, n].filter((x) => x >= 1 && x <= n))].sort((a, b) => a - b)
  let html = '', vorher = 0
  for (const x of nummern) {
    if (x - vorher > 1) html += '<span class="tour-seite-luecke">…</span>'
    html += `<button type="button" class="tour-seite${x === s ? ' tour-seite--aktiv' : ''}" data-seite="${x}" ${x === s ? 'aria-current="page"' : ''}>${x}</button>`
    vorher = x
  }
  return `<nav class="tour-seiten" aria-label="Seiten">
    <button type="button" class="tour-seite tour-seite--pfeil" data-seite="${s - 1}" ${s <= 1 ? 'disabled' : ''} aria-label="Vorige Seite">‹</button>
    ${html}
    <button type="button" class="tour-seite tour-seite--pfeil" data-seite="${s + 1}" ${s >= n ? 'disabled' : ''} aria-label="Nächste Seite">›</button>
  </nav>`
}

function leer() {
  const h = herkunft()
  if (zustand.gemerkt) return `<div class="kv-results-empty"><span class="kv-empty-icon">\u{1F516}</span><span class="kv-empty-title">Noch keine Tour gemerkt</span><span class="kv-empty-hint">Öffne eine Tour und tippe auf „Merken“.</span></div>`
  const naechster = UMKREISE.find((u) => u > zustand.umkreis) ?? 0
  const mehr = h && zustand.umkreis
  return `<div class="kv-results-empty">
    <span class="kv-empty-icon">\u{1F3CD}\u{FE0F}</span>
    <span class="kv-empty-title">Keine passende Tour</span>
    <span class="kv-empty-hint">${mehr ? `Im Umkreis von ${zustand.umkreis} km passt nichts zu deinen Filtern.` : 'Keine Tour passt zu deinen Filtern.'}</span>
    <div class="kv-empty-actions">
      ${mehr ? `<button type="button" class="kv-empty-btn kv-empty-btn--primary" data-umkreis-setzen="${naechster}">${naechster ? `Auf ${naechster} km erweitern` : 'Ganz Deutschland zeigen'}</button>` : ''}
      <button type="button" class="kv-empty-btn" data-filter-reset>Filter zurücksetzen</button>
    </div>
  </div>`
}

// ── Liste ────────────────────────────────────────────────────────────────

let passendeTouren = []

function renderListe({ karteAnpassen = false } = {}) {
  const box = document.getElementById('tour-liste')
  const ansicht = document.getElementById('kv-touren')
  if (!box || !ansicht) return
  ansicht.classList.remove('kv-ansicht--detail')
  renderFilter()
  const liste = gefiltert()
  passendeTouren = liste
  const seitenZahl = Math.max(1, Math.ceil(liste.length / PRO_SEITE))
  if (zustand.seite > seitenZahl) zustand.seite = seitenZahl
  const von = (zustand.seite - 1) * PRO_SEITE
  const seite = liste.slice(von, von + PRO_SEITE)

  const count = document.getElementById('tour-count')
  if (count) count.textContent = liste.length ? `${von + 1}–${von + seite.length} von ${liste.length} Touren` : ''

  if (!liste.length) {
    box.innerHTML = leer()
    zeichneListe([], karteAnpassen)
    return
  }
  const mitSammlung = zustand.seite === 1 && !zustand.gemerkt && zustand.typ !== 'rund'
  box.innerHTML = seite.map(({ t, km }, i) => karte(t, km, i) + (mitSammlung && i === 1 ? sammlung() : '')).join('') + seiten(liste.length)
  box.scrollTop = 0
  zeichneListe(seite.map((x) => x.t), karteAnpassen)
}

// ── Detail ───────────────────────────────────────────────────────────────

function googleMapsLink(t) {
  const wp = t.typ === 'rund' ? [...t.wp, t.wp[0]] : t.wp
  const p = (w) => `${w[1]},${w[2]}`
  const mitte = wp.slice(1, -1)
  // Google nimmt höchstens 9 Zwischenziele — gleichmäßig auswählen
  const auswahl = mitte.length <= 8 ? mitte : Array.from({ length: 8 }, (_, i) => mitte[Math.round((i * (mitte.length - 1)) / 7)])
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${p(wp[0])}&destination=${p(wp[wp.length - 1])}${auswahl.length ? `&waypoints=${encodeURIComponent(auswahl.map(p).join('|'))}` : ''}`
}

function gpxHerunterladen(t, d) {
  const x = (s) => esc(s)
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MotoMatch" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${x(t.name)}</name>
    <desc>${x(t.text)}</desc>
    <copyright author="OpenStreetMap-Mitwirkende"><license>https://opendatacommons.org/licenses/odbl/</license></copyright>
    <link href="https://motomatch.studio"><text>MotoMatch</text></link>
  </metadata>
${t.wp.map((w) => `  <wpt lat="${w[1]}" lon="${w[2]}"><name>${x(w[0])}</name></wpt>`).join('\n')}
  <trk>
    <name>${x(t.name)}</name>
    <trkseg>
${d.pts.map(([la, ln]) => `      <trkpt lat="${la.toFixed(5)}" lon="${ln.toFixed(5)}"/>`).join('\n')}
    </trkseg>
  </trk>
</gpx>
`
  const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `motomatch-${t.id}.gpx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function hoehenprofil(t, d) {
  const p = d.profil
  if (p.length < 2) return ''
  const B = 320, H = 92, OBEN = 8, UNTEN = 4
  const maxKm = p[p.length - 1][0] || 1
  const hs = p.map((x) => x[1])
  let lo = Math.min(...hs), hi = Math.max(...hs)
  if (hi - lo < 60) { const m = (hi + lo) / 2; lo = m - 30; hi = m + 30 }
  const X = (km) => (km / maxKm) * B
  const Y = (m) => OBEN + (1 - (m - lo) / (hi - lo)) * (H - OBEN - UNTEN)
  const linie = p.map(([km, m], i) => `${i ? 'L' : 'M'}${X(km).toFixed(1)},${Y(m).toFixed(1)}`).join('')
  return `<div class="tour-profil" data-max-km="${maxKm}">
    <div class="tour-profil-kopf"><span>Höhenprofil</span><span class="tour-profil-wert" id="tour-profil-wert">${zahl(t.hmin)}–${zahl(t.hmax)} m</span></div>
    <svg viewBox="0 0 ${B} ${H}" preserveAspectRatio="none" class="tour-profil-svg" id="tour-profil-svg">
      <defs><linearGradient id="tourProfilVerlauf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0.02"/></linearGradient></defs>
      <path d="${linie}L${B},${H}L0,${H}Z" fill="url(#tourProfilVerlauf)"/>
      <path d="${linie}" class="tour-profil-linie" vector-effect="non-scaling-stroke"/>
      <line class="tour-profil-cursor" id="tour-profil-cursor" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="tour-profil-achse"><span>0 km</span><span>${zahl(maxKm / 2)} km</span><span>${zahl(maxKm)} km</span></div>
  </div>`
}

async function oeffneTour(id) {
  await ladeIndex()
  const t = touren.find((x) => x.id === id)
  const box = document.getElementById('tour-liste')
  const ansicht = document.getElementById('kv-touren')
  if (!t || !box || !ansicht) return
  zustand.offeneTour = id
  ansicht.classList.add('kv-ansicht--detail')
  const count = document.getElementById('tour-count')
  if (count) count.textContent = ''
  box.innerHTML = '<div class="kv-skeleton"><div class="kv-skeleton-row"><span class="kv-skeleton-line kv-skeleton-line--name"></span><span class="kv-skeleton-line kv-skeleton-line--addr"></span></div></div>'

  let d
  try { d = await ladeDetail(id) } catch {
    box.innerHTML = '<div class="kv-results-empty"><span class="kv-empty-title">Tour konnte nicht geladen werden</span><div class="kv-empty-actions"><button type="button" class="kv-empty-btn" data-zurueck>Zurück</button></div></div>'
    return
  }
  if (zustand.offeneTour !== id) return
  const istGemerkt = gemerkt().includes(id)
  const km = abstandKm(t, herkunft())
  const kz = (wert, label) => `<div class="tour-kz"><strong>${wert}</strong><span>${label}</span></div>`
  const wp = t.typ === 'rund' ? [...t.wp, [`${t.wp[0][0]} (Ziel)`]] : t.wp
  box.innerHTML = `<div class="tour-detail">
    <button type="button" class="tour-zurueck" data-zurueck>‹ Alle Touren</button>
    <div class="tour-detail-bild">${streckenBild(t, 320, 150)}</div>
    <div class="tour-badges">
      <span class="tour-badge tour-badge--${t.schwierigkeit}">${SCHWIERIGKEIT[t.schwierigkeit]}</span>
      ${kurvenBalken(t.kurven)}
    </div>
    <h2 class="tour-detail-name">${esc(t.name)}</h2>
    <div class="tour-sub">${t.typ === 'rund' ? 'Rundtour' : 'Strecke'} · ${esc(t.region)}${km != null ? ` · ${entfernung(km)}` : ''}</div>
    <div class="tour-kennzahlen">
      ${kz(dauer(t.min), 'Fahrzeit')}
      ${kz(`${zahl(t.km)} km`, 'Distanz')}
      ${kz(`${t.kurven}°/km`, 'Kurvigkeit')}
      ${kz(`${ICON.auf}${zahl(t.auf)} m`, 'Bergauf')}
      ${kz(`${ICON.ab}${zahl(t.ab)} m`, 'Bergab')}
      ${kz(`${zahl(t.hmax)} m`, 'Höchster Punkt')}
    </div>
    <div class="tour-aktionen">
      <a class="tour-btn tour-btn--primaer" href="${esc(googleMapsLink(t))}" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
        Navigation starten
      </a>
      <button type="button" class="tour-btn" data-gpx>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
        GPX
      </button>
      <button type="button" class="tour-btn${istGemerkt ? ' tour-btn--gemerkt' : ''}" data-merken aria-pressed="${istGemerkt}">
        ${ICON.merken(istGemerkt)}<span>${istGemerkt ? 'Gemerkt' : 'Merken'}</span>
      </button>
    </div>
    ${hoehenprofil(t, d)}
    <p class="tour-text">${esc(t.text)}</p>
    ${t.tags?.length ? `<div class="tour-tags">${t.tags.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    <h4 class="tour-abschnitt">Wegpunkte</h4>
    <ol class="tour-wegpunkte">${wp.map((w) => `<li>${esc(w[0])}</li>`).join('')}</ol>
    ${t.autobahnKm > 2 ? `<p class="tour-hinweis">Enthält rund ${zahl(t.autobahnKm)} km Autobahn als Verbindung.</p>` : ''}
    <p class="tour-hinweis">Die Navigation über Google Maps kann zwischen den Wegpunkten anders fahren. Die genaue Strecke steckt in der GPX-Datei (z. B. für Calimoto, Kurviger, Garmin, TomTom).</p>
    <p class="tour-quelle">${esc(quellenText)}</p>
  </div>`
  box.scrollTop = 0
  zeichneDetail(t, d)
  bindeProfil(t, d)
}

// ── Karte ────────────────────────────────────────────────────────────────

const LINIE = { strokeColor: '#ffffff', strokeOpacity: 0.62, strokeWeight: 3, zIndex: 2 }
const LINIE_HOVER = { strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 5, zIndex: 20 }
const LINIE_GEDIMMT = { strokeColor: '#ffffff', strokeOpacity: 0.22, strokeWeight: 3, zIndex: 1 }

function startSymbol(skala = 5.5) {
  return { path: google.maps.SymbolPath.CIRCLE, scale: skala, fillColor: '#ffffff', fillOpacity: 1, strokeColor: '#111', strokeWeight: 2.5 }
}

function entferneListe() {
  listenLinien.forEach((o) => { o.linie.setMap(null); o.start.setMap(null) })
  listenLinien = []
}
function entferneDetail() {
  detailObjekte.forEach((o) => o.setMap(null))
  detailObjekte = []
  profilMarker?.setMap(null)
  profilMarker = null
}

function grenzen(punkte) {
  const b = new google.maps.LatLngBounds()
  punkte.forEach(([la, ln]) => b.extend({ lat: la, lng: ln }))
  return b
}

/** Platz für das schwebende Panel lassen, sonst liegen Linien darunter. */
function rand() {
  const panel = document.querySelector('.konf-karte-hub .kv-sidebar')
  const mobil = window.matchMedia('(max-width: 759.98px)').matches
  if (!panel) return { top: 90, bottom: 140, left: 30, right: 30 }
  // Handy: das Sheet deckt den unteren Teil ab — bis zu seiner sichtbaren Kante
  if (mobil) return { top: 90, bottom: Math.min(window.innerHeight * 0.6, Math.max(140, window.innerHeight - panel.getBoundingClientRect().top + 16)), left: 30, right: 60 }
  return { top: 100, bottom: 40, left: panel.getBoundingClientRect().width + 50, right: 80 }
}

function zeichneListe(liste, anpassen) {
  const map = getHubMap()
  if (!map || !zustand.aktiv || typeof google === 'undefined') return
  entferneDetail()
  entferneListe()
  hoverId = null
  for (const t of liste) {
    const linie = new google.maps.Polyline({ ...LINIE, path: t._pts.map(([lat, lng]) => ({ lat, lng })), map })
    const start = new google.maps.Marker({ position: { lat: t._pts[0][0], lng: t._pts[0][1] }, map, icon: startSymbol(4.5), title: t.name, zIndex: 30 })
    const oeffnen = () => oeffneTour(t.id)
    linie.addListener('click', oeffnen)
    start.addListener('click', oeffnen)
    linie.addListener('mouseover', () => markiere(t.id))
    linie.addListener('mouseout', () => markiere(null))
    listenLinien.push({ id: t.id, linie, start })
  }
  if (anpassen && liste.length) map.fitBounds(grenzen(liste.flatMap((t) => t._pts)), rand())
}

/** Karte und Liste zeigen dieselbe Tour hervorgehoben — von beiden Seiten aus. */
function markiere(id) {
  hoverId = id
  listenLinien.forEach((o) => o.linie.setOptions(id == null ? LINIE : o.id === id ? LINIE_HOVER : LINIE_GEDIMMT))
  document.querySelectorAll('#tour-liste .tour-card').forEach((c) => c.classList.toggle('tour-card--hover', c.dataset.tour === id))
}

function zeichneDetail(t, d) {
  const map = getHubMap()
  if (!map || !zustand.aktiv || typeof google === 'undefined') return
  entferneListe()
  entferneDetail()
  const path = d.pts.map(([lat, lng]) => ({ lat, lng }))
  detailObjekte.push(
    new google.maps.Polyline({ path, map, strokeColor: '#000', strokeOpacity: 0.55, strokeWeight: 9, zIndex: 3 }),
    new google.maps.Polyline({
      path, map, strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 4.5, zIndex: 4,
      // Fahrtrichtung, wie sie die Tour vorsieht
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2.2, strokeColor: '#111', strokeWeight: 2 }, offset: '40px', repeat: '110px' }],
    }),
    new google.maps.Marker({ position: path[0], map, icon: startSymbol(7), title: `Start: ${t.wp[0][0]}`, zIndex: 40 }),
  )
  if (t.typ === 'strecke') {
    detailObjekte.push(new google.maps.Marker({
      position: path[path.length - 1], map, title: `Ziel: ${t.wp[t.wp.length - 1][0]}`, zIndex: 40,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#111', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5 },
    }))
  }
  map.fitBounds(grenzen(d.pts), rand())
}

function bindeProfil(t, d) {
  const svg = document.getElementById('tour-profil-svg')
  const cursor = document.getElementById('tour-profil-cursor')
  const wert = document.getElementById('tour-profil-wert')
  if (!svg || !cursor || !wert) return
  const p = d.profil
  const maxKm = p[p.length - 1][0] || 1
  const gesamtM = d.kum[d.kum.length - 1]
  const grundtext = wert.textContent
  const bewegen = (e) => {
    const r = svg.getBoundingClientRect()
    const anteil = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const km = anteil * maxKm
    let j = 0
    while (j < p.length - 1 && p[j + 1][0] < km) j++
    cursor.setAttribute('x1', String(anteil * 320))
    cursor.setAttribute('x2', String(anteil * 320))
    cursor.classList.add('an')
    wert.textContent = `km ${zahl(km)} · ${zahl(p[j][1])} m`
    // Punkt auf der Linie zur selben Strecke
    const ziel = anteil * gesamtM
    let lo = 0, hi = d.kum.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (d.kum[m] < ziel) lo = m + 1; else hi = m }
    const map = getHubMap()
    if (!map || typeof google === 'undefined') return
    const pos = { lat: d.pts[lo][0], lng: d.pts[lo][1] }
    if (!profilMarker) profilMarker = new google.maps.Marker({ map, zIndex: 50, clickable: false, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#e8c56d', fillOpacity: 1, strokeColor: '#111', strokeWeight: 2 } })
    profilMarker.setPosition(pos)
    profilMarker.setMap(map)
  }
  const weg = () => {
    cursor.classList.remove('an')
    wert.textContent = grundtext
    profilMarker?.setMap(null)
  }
  svg.addEventListener('pointermove', bewegen)
  svg.addEventListener('pointerdown', bewegen)
  svg.addEventListener('pointerleave', weg)
}

// ── Steuerung von außen ──────────────────────────────────────────────────

/** Karte steht (neu oder umgezogen): aktuellen Zustand darauf zeichnen. */
function neuZeichnen(anpassen = false) {
  if (!zustand.aktiv) return
  if (zustand.offeneTour && details.has(zustand.offeneTour)) {
    const t = touren.find((x) => x.id === zustand.offeneTour)
    if (t) { zeichneDetail(t, details.get(zustand.offeneTour)); return }
  }
  const von = (zustand.seite - 1) * PRO_SEITE
  zeichneListe(passendeTouren.slice(von, von + PRO_SEITE).map((x) => x.t), anpassen)
}

export function setTourenAktiv(an) {
  zustand.aktiv = an
  if (!an) { entferneListe(); entferneDetail(); return }
  renderUmkreis() // war versteckt und ist erst jetzt messbar
  neuZeichnen(true)
}

/** "In diesem Gebiet suchen" bzw. Ortssuche: neue Mitte für Entfernung und Umkreis. */
export function setTourenHerkunft(lat, lng) {
  zustand.herkunft = lat == null ? null : { lat, lng }
  zustand.seite = 1
  zustand.offeneTour = null
  if (!zustand.umkreis) zustand.umkreis = 100
  renderUmkreis()
  renderListe({ karteAnpassen: true })
}

let umkreisThumb = null
function renderUmkreis() {
  document.querySelectorAll('.tour-umkreis .kv-radius-pill').forEach((b) => b.classList.toggle('kv-radius-pill--active', +b.dataset.umkreis === zustand.umkreis))
  umkreisThumb?.()
}

/**
 * Touren-Ansicht verdrahten. Läuft bei jedem Aufbau des Karten-Reiters.
 * @param {{ mountThumb?: (el: Element, sel: string, cls?: string) => (() => void) | null }} opts
 */
export function initTouren({ mountThumb } = {}) {
  const ansicht = document.getElementById('kv-touren')
  if (!ansicht) return

  umkreisThumb = mountThumb?.(document.querySelector('.tour-umkreis'), '.kv-radius-pill--active', 'kv-pill-thumb--radius') || null
  document.querySelectorAll('.tour-umkreis .kv-radius-pill').forEach((b) => b.addEventListener('click', () => {
    zustand.umkreis = +b.dataset.umkreis
    zustand.seite = 1
    zustand.offeneTour = null
    renderUmkreis()
    renderListe({ karteAnpassen: true })
  }))

  ansicht.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]')
    if (chip) {
      const key = chip.dataset.filter
      if (key === 'gemerkt') {
        zustand.gemerkt = !zustand.gemerkt
        zustand.offenerFilter = null
      } else {
        zustand.offenerFilter = zustand.offenerFilter === key ? null : key
        renderFilter()
        return
      }
      zustand.seite = 1
      renderListe({ karteAnpassen: true })
      return
    }
    const option = e.target.closest('.tour-option')
    if (option && zustand.offenerFilter) {
      zustand[zustand.offenerFilter] = option.dataset.wert
      zustand.offenerFilter = null
      zustand.seite = 1
      renderListe({ karteAnpassen: true })
      return
    }
    if (e.target.closest('#tour-sort')) {
      const reihe = herkunft() ? ['entfernung', 'kurven', 'laenge'] : ['kurven', 'laenge']
      zustand.sort = reihe[(reihe.indexOf(sortWirksam()) + 1) % reihe.length]
      zustand.seite = 1
      renderListe()
      return
    }
    const seite = e.target.closest('.tour-seite[data-seite]')
    if (seite && !seite.disabled) {
      zustand.seite = +seite.dataset.seite
      renderListe({ karteAnpassen: true })
      return
    }
    const pfeil = e.target.closest('.tour-pfeil')
    if (pfeil) {
      const band = pfeil.closest('.tour-sammlung')?.querySelector('.tour-sammlung-band')
      band?.scrollBy({ left: +pfeil.dataset.scroll * band.clientWidth * 0.8, behavior: 'smooth' })
      return
    }
    if (e.target.closest('[data-umkreis-setzen]')) {
      zustand.umkreis = +e.target.closest('[data-umkreis-setzen]').dataset.umkreisSetzen
      renderUmkreis()
      renderListe({ karteAnpassen: true })
      return
    }
    if (e.target.closest('[data-filter-reset]')) {
      Object.assign(zustand, { laenge: 'alle', kurven: 'alle', typ: 'alle', gemerkt: false, seite: 1 })
      renderListe({ karteAnpassen: true })
      return
    }
    if (e.target.closest('[data-zurueck]')) {
      zustand.offeneTour = null
      renderListe({ karteAnpassen: true })
      return
    }
    if (e.target.closest('[data-gpx]')) {
      const t = touren.find((x) => x.id === zustand.offeneTour)
      const d = details.get(zustand.offeneTour)
      if (t && d) gpxHerunterladen(t, d)
      return
    }
    const merken = e.target.closest('[data-merken]')
    if (merken && zustand.offeneTour) {
      const an = merkenUmschalten(zustand.offeneTour)
      merken.classList.toggle('tour-btn--gemerkt', an)
      merken.setAttribute('aria-pressed', String(an))
      merken.innerHTML = `${ICON.merken(an)}<span>${an ? 'Gemerkt' : 'Merken'}</span>`
      return
    }
    const tour = e.target.closest('[data-tour]')
    if (tour) oeffneTour(tour.dataset.tour)
  })
  ansicht.addEventListener('keydown', (e) => {
    const tour = e.target.closest?.('.tour-card')
    if (tour && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); oeffneTour(tour.dataset.tour) }
  })
  // Hover in der Liste hebt die Linie auf der Karte hervor (nur Maus)
  ansicht.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return
    const c = e.target.closest('.tour-card')
    if (c && c.dataset.tour !== hoverId) markiere(c.dataset.tour)
  })
  ansicht.addEventListener('pointerleave', () => { if (hoverId) markiere(null) })

  // Karte steht erst, wenn der Standort da ist — dann Entfernungen neu rechnen
  onHubMapReady(() => { if (touren.length && !zustand.offeneTour) tourenStandortGeaendert(); else neuZeichnen(true) })

  ladeIndex().then(() => {
    if (!herkunft() && zustand.umkreis) { zustand.umkreis = 0; renderUmkreis() }
    if (zustand.offeneTour) oeffneTour(zustand.offeneTour)
    else renderListe({ karteAnpassen: true })
  }).catch(() => {
    const box = document.getElementById('tour-liste')
    if (box) box.innerHTML = '<div class="kv-results-empty"><span class="kv-empty-title">Touren konnten nicht geladen werden</span><span class="kv-empty-hint">Prüfe deine Verbindung und öffne den Reiter erneut.</span></div>'
  })
}

/** Standort kam nachträglich (Freigabe, Ortssuche): Entfernungen neu rechnen. */
export function tourenStandortGeaendert() {
  if (!touren.length || zustand.offeneTour) return
  if (!zustand.herkunft && zustand.umkreis === 0 && herkunft()) { zustand.umkreis = 100; renderUmkreis() }
  renderListe({ karteAnpassen: true })
}
