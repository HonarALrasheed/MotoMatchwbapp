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
import { meldung, eingeben, fragen } from './meldung.js'
import { getHubMap, onHubMapReady, getUserCoords, haversineKm, getMapLib } from './karte.js'
import { setKurvenSichtbar, kurvenInDerNaehe, zeigeStrecke, stufe } from './kurven.js'
import { vorschauBeobachten } from './vorschau.js'
import { schritteAufLinie } from './routing.js'
import { PRAEFIX, alleEigenen, findeEigene, alsTour, speichereStrecke, umbenennen, loesche, gpxLesen, teilenLink, ausLink } from './eigene-strecken.js'

const PRO_SEITE = 12
const LS_GEMERKT = 'mm_touren_gemerkt_v1'
const LS_KURVEN_EBENE = 'mm_kurven_ebene_v1'
const kurvenEbeneGemerkt = () => { try { return localStorage.getItem(LS_KURVEN_EBENE) !== '0' } catch { return true } }
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
  kurvenEbene: kurvenEbeneGemerkt(),
  meine: false, // eigene Strecken statt der Tourenvorschläge
}

let indexPromise = null
let touren = []
let quellenText = ''
const kurvenQuellen = new Map() // id → { pts, typ } für die Vorschaubilder der Kurvenstrecken
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
  if (id.startsWith(PRAEFIX)) {
    const t = findeTour(id)
    if (!t) throw new Error('Strecke nicht gefunden')
    details.set(id, t._detail)
    return t._detail
  }
  const r = await fetch(`/data/touren/${encodeURIComponent(id)}.json`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  const pts = dekodieren(j.linie)
  // kumulierte Strecke in m — für den Punkt unter dem Mauszeiger im Höhenprofil
  const kum = [0]
  for (let i = 1; i < pts.length; i++) kum.push(kum[i - 1] + haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * 1000)
  // Schritt-Meter (OSRM) auf die Meter der Linie umrechnen — so rechnet das Navi
  const roh = j.schritte || []
  const schritte = schritteAufLinie(roh, kum, roh.length ? roh[roh.length - 1][0] : kum[kum.length - 1])
  const d = { pts, kum, profil: j.profil || [], schritte }
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

// Eigene Strecken in Tour-Form; neu berechnet, sobald sich der Speicher ändert
let eigenCache = null
function eigeneTouren() {
  if (!eigenCache) eigenCache = alleEigenen().map(alsTour)
  return eigenCache
}
function eigeneGeaendert() {
  eigenCache = null
  for (const id of [...details.keys()]) if (id.startsWith(PRAEFIX)) details.delete(id)
}

/** Tour oder eigene Strecke zur id. */
function findeTour(id) {
  if (!id) return null
  if (id.startsWith(PRAEFIX)) return eigeneTouren().find((x) => x.id === id) || (findeEigene(id) ? alsTour(findeEigene(id)) : null)
  return touren.find((x) => x.id === id) || null
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
  if (zustand.meine) return eigeneTouren().map((t) => ({ t, km: abstandKm(t, h) }))
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
  meine: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  rec: '<svg width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="#e63946"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  hochladen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>',
  teilen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  regler: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  pfeil: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
}

/** Kurvigkeit als drei Balken — gleiche Idee wie die Schwierigkeitsbalken bei komoot. */
function kurvenBalken(k) {
  const n = KURVEN_STUFEN.indexOf(kurvenStufe(k)) + 1
  return `<span class="tour-kurven" title="${kurvenStufe(k).label} (${k}°/km)">${ICON.kurve}<span class="tour-kurven-balken">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'an' : ''}"></i>`).join('')}</span>${kurvenStufe(k).label}</span>`
}

/** Zufall mit fester Saat — dieselbe Tour bekommt immer dieselbe Landschaft. */
function saat(text) {
  let x = 2166136261
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619)
  return () => ((x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909)) >>> 0) / 4294967296
}

/** Kleine gezeichnete Landschaftskarte mit der Strecke darauf — für Touren und
    Kurvenstrecken ohne Foto. Wald, Höhenlinien und Straßen sind Dekor in den
    Farben der Karte, die Linie ist die echte Form der Strecke. */
function streckenBild(t, b = 96, h = 96) {
  const pts = t._pts
  const k = Math.cos((pts[0][0] * Math.PI) / 180)
  const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const pad = Math.max(10, Math.min(b, h) * 0.12)
  const s = Math.min((b - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxY - minY || 1))
  const ox = (b - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2
  const xy = pts.map((_, i) => [(xs[i] - minX) * s + ox, (ys[i] - minY) * s + oy].map((v) => v.toFixed(1)))
  const d = 'M' + xy.map((p) => p.join(',')).join('L')
  const [sx, sy] = xy[0], [zx, zy] = xy[xy.length - 1]

  const r = saat(t.id || d.slice(0, 40))
  const f = (v) => v.toFixed(1)
  const m = Math.max(b, h)
  let deko = ''
  // Waldflecken als unregelmäßige, weich gerundete Formen
  const fleck = (cx, cy, groesse) => {
    const n = 8, p = []
    for (let i = 0; i < n; i++) {
      const w = (i / n) * Math.PI * 2, rr = groesse * (0.55 + r() * 0.6)
      p.push([cx + Math.cos(w) * rr, cy + Math.sin(w) * rr * 0.75])
    }
    const mitte = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]
    let pfad = `M${mitte(p[n - 1], p[0]).map(f).join(',')}`
    for (let i = 0; i < n; i++) pfad += `Q${p[i].map(f).join(',')} ${mitte(p[i], p[(i + 1) % n]).map(f).join(',')}`
    return pfad + 'Z'
  }
  for (let i = 0; i < 6; i++) deko += `<path d="${fleck(r() * b, r() * h, m * (0.1 + r() * 0.16))}" class="tb-wald"/>`
  for (let i = 0; i < 3; i++) deko += `<path d="${fleck(r() * b, r() * h, m * (0.05 + r() * 0.06))}" class="tb-wald tb-wald--dicht"/>`
  // ab und zu ein See
  if (r() < 0.4) {
    const cx = r() * b, cy = r() * h, rx = m * (0.05 + r() * 0.06)
    deko += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(rx * 0.6)}" class="tb-see"/>`
  }
  // Höhenlinien und zwei Landstraßen als sanfte Wellen
  for (let i = 0; i < 4; i++) {
    const y0 = r() * h, a = h * (0.06 + r() * 0.1), w = b / (1 + r() * 1.5)
    deko += `<path d="M${-5},${f(y0)} C${f(w * 0.5)},${f(y0 - a)} ${f(w)},${f(y0 + a)} ${f(b * 0.6)},${f(y0)} S${f(b * 0.9)},${f(y0 - a)} ${b + 5},${f(y0 + a * 0.5)}" class="tb-hoehe"/>`
  }
  for (let i = 0; i < 2; i++) {
    const x0 = r() * b, a = b * (0.1 + r() * 0.15)
    const weg = `M${f(x0)},-5 C${f(x0 + a)},${f(h * 0.35)} ${f(x0 - a)},${f(h * 0.65)} ${f(x0 + a * 0.4)},${h + 5}`
    // eine Bundesstraße in Kartengelb, eine kleine Straße in Weiß
    deko += i === 0 ? `<path d="${weg}" class="tb-strasse-rand"/><path d="${weg}" class="tb-strasse tb-strasse--gelb"/>` : `<path d="${weg}" class="tb-strasse"/>`
  }
  return `<svg viewBox="0 0 ${b} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" class="tour-landschaft">
    ${deko}
    <path d="${d}" class="tour-bild-schatten"/>
    <path d="${d}" class="tour-bild-linie"/>
    ${t.typ === 'strecke' ? `<circle cx="${zx}" cy="${zy}" r="3.4" class="tour-bild-ziel"/>` : ''}
    <circle cx="${sx}" cy="${sy}" r="3.8" class="tour-bild-start"/>
  </svg>`
}

/** Vorschau-Quelle: Tour (Detail-Linie, wenn schon geladen) oder Kurvenstrecke. */
function vorschauQuelle(id) {
  if (kurvenQuellen.has(id)) return kurvenQuellen.get(id)
  const t = findeTour(id)
  return t ? { pts: details.get(id)?.pts || t._pts, typ: t.typ } : null
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
        <div class="tour-neu-wrap">
          <button type="button" class="tour-neu" id="tour-neu" aria-haspopup="menu" aria-expanded="false">${ICON.plus}<span>Neu</span></button>
          <div class="tour-neu-menue" role="menu" hidden>
            <button type="button" role="menuitem" data-aktion="planen">${ICON.plus}Route planen</button>
            <button type="button" role="menuitem" data-aktion="aufzeichnen">${ICON.rec}Fahrt aufzeichnen</button>
            <button type="button" role="menuitem" data-aktion="import">${ICON.hochladen}GPX-Datei laden</button>
          </div>
        </div>
        <input type="file" accept=".gpx,application/gpx+xml" id="tour-gpx-datei" hidden>
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
  const kurvenChip = `<button type="button" class="kv-chip tour-filter-chip tour-kurven-chip" data-filter="kurvenebene" data-active="${zustand.kurvenEbene}" aria-pressed="${zustand.kurvenEbene}" title="Alle kurvigen Straßen auf der Karte">${ICON.kurve}Kurvenstrecken</button>`
  const meineChip = `<button type="button" class="kv-chip tour-filter-chip tour-meine-chip" data-filter="meine" data-active="${zustand.meine}" aria-pressed="${zustand.meine}" title="Deine aufgezeichneten, geplanten und importierten Strecken">${ICON.meine}Meine<span class="kv-chip-count">${eigeneTouren().length}</span></button>`
  const gemerktChip = `<button type="button" class="kv-chip kv-chip--fav" data-filter="gemerkt" data-active="${zustand.gemerkt}" aria-pressed="${zustand.gemerkt}" aria-label="Gemerkte Touren">${ICON.merken(false)}<span class="kv-chip-count">${n}</span></button>`
  // Länge, Kurven und Art stecken zusammen hinter "Filter" — die Leiste bleibt eine Zeile
  const aktiveFilter = Object.keys(FILTER).filter((k) => zustand[k] !== 'alle').length
  const offen = zustand.offenerFilter === 'filter' && !zustand.meine
  const filterChip = `<button type="button" class="kv-chip tour-filter-chip" data-filter="filter" data-active="${aktiveFilter > 0}" aria-expanded="${offen}">${ICON.regler}Filter${aktiveFilter ? `<span class="kv-chip-count">${aktiveFilter}</span>` : ''}</button>`
  leiste.innerHTML = (zustand.meine ? '' : filterChip) + meineChip + kurvenChip + (zustand.meine ? '' : gemerktChip)

  const opt = document.getElementById('tour-optionen')
  if (!opt) return
  opt.hidden = !offen
  // Kurze Beschriftungen, damit jede Gruppe in eine Zeile passt
  const KURZ = { kurz: '< 100 km', mittel: '100–200', lang: '> 200 km', sehr: 'Sehr kurvig', strecke: 'Strecke' }
  opt.innerHTML = offen ? `<div class="tour-opt-karte">${Object.entries(FILTER).map(([key, f]) => `<div class="tour-opt-gruppe">
      <span class="tour-opt-titel">${esc(f.label)}</span>
      <div class="tour-opt-werte" role="group" aria-label="${esc(f.label)}">${f.werte.map(([id, label]) => `<button type="button" class="tour-option${zustand[key] === id ? ' tour-option--aktiv' : ''}" aria-pressed="${zustand[key] === id}" data-gruppe="${key}" data-wert="${id}" title="${esc(label)}">${esc(id === 'alle' ? 'Alle' : KURZ[id] || label)}</button>`).join('')}</div>
    </div>`).join('')}
    ${aktiveFilter ? '<button type="button" class="tour-opt-reset" data-filter-reset>Zurücksetzen</button>' : ''}</div>` : ''

  const sortLabel = document.getElementById('tour-sort-label')
  if (sortLabel) sortLabel.textContent = { entfernung: 'Entfernung', kurven: 'Kurvigkeit', laenge: 'Länge' }[sortWirksam()]
}

function karte(t, km, i) {
  return `<article class="tour-card${hoverId === t.id ? ' tour-card--hover' : ''}" data-tour="${esc(t.id)}" style="--i:${Math.min(i, 12)}" tabindex="0">
    <div class="tour-bild" data-vorschau="${esc(t.id)}" data-art="quadrat">${streckenBild(t)}</div>
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
        <span class="tour-sammlung-bild" data-vorschau="${esc(t.id)}" data-art="breit">${streckenBild(t, 220, 120)}</span>
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

/** Planen, Aufzeichnen, Importieren — wie "Neue Route planen" bei komoot, nur mit mehr. */
function aktionsleiste() {
  return `<div class="tour-aktionsleiste">
    <button type="button" class="tour-aktion" data-aktion="planen">${ICON.plus}<span>Planen</span></button>
    <button type="button" class="tour-aktion" data-aktion="aufzeichnen">${ICON.rec}<span>Aufzeichnen</span></button>
    <button type="button" class="tour-aktion" data-aktion="import">${ICON.hochladen}<span>GPX laden</span></button>
  </div>`
}

function leer() {
  const h = herkunft()
  if (zustand.meine) return `<div class="kv-results-empty"><span class="kv-empty-title">Noch keine eigenen Strecken</span><span class="kv-empty-hint">Plane eine Route, zeichne deine nächste Fahrt auf oder lade eine GPX-Datei — zum Beispiel aus deinem Navi.</span></div>`
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
  if (count) count.textContent = liste.length ? `${von + 1}–${von + seite.length} von ${liste.length} ${zustand.meine ? 'eigenen Strecken' : 'Touren'}` : ''

  if (!liste.length) {
    box.innerHTML = (zustand.meine ? aktionsleiste() : '') + leer()
    zeichneListe([], karteAnpassen)
    return
  }
  const mitSammlung = zustand.seite === 1 && !zustand.gemerkt && !zustand.meine && zustand.typ !== 'rund'
  const mitKurven = zustand.seite === 1 && !zustand.gemerkt && !zustand.meine && herkunft()
  box.innerHTML = (zustand.meine && zustand.seite === 1 ? '<div class="meine-bilanz" id="meine-bilanz" hidden></div>' : '') + seite.map(({ t, km }, i) => karte(t, km, i)
    + (mitSammlung && i === 1 ? sammlung() : '')
    + (mitKurven && i === Math.min(4, seite.length - 1) ? '<section class="tour-sammlung" id="kurven-band" hidden></section>' : '')).join('') + seiten(liste.length)
  if (mitKurven) fuelleKurvenBand()
  if (zustand.meine) fuelleBilanz()
  box.scrollTop = 0
  vorschauBeobachten(box, vorschauQuelle)
  zeichneListe(seite.map((x) => x.t), karteAnpassen)
}

/** Bilanz der eigenen Fahrten: Kilometer und gesammelte Kurvenstrecken. */
async function fuelleBilanz() {
  const el = document.getElementById('meine-bilanz')
  if (!el) return
  const { bilanz } = await import('./eigene-strecken.js')
  const b = await bilanz().catch(() => null)
  if (!b || !b.fahrten || !el.isConnected) return
  const extrem = b.kurven.filter((k) => k.stufe === 'Extrem kurvig').length
  el.hidden = false
  el.innerHTML = `
    <div class="meine-bilanz-zahlen">
      <div><strong>${b.fahrten}</strong><span>${b.fahrten === 1 ? 'Fahrt' : 'Fahrten'}</span></div>
      <div><strong>${zahl(b.km)}</strong><span>km aufgezeichnet</span></div>
      <div><strong>${b.kurven.length}</strong><span>Kurvenstrecken gesammelt</span></div>
    </div>
    ${b.kurven.length ? `<div class="meine-bilanz-liste">${b.kurven.slice(0, 12).map((k) => `<span class="${k.stufe === 'Extrem kurvig' ? 'extrem' : ''}">${esc(k.name || 'Kurvenstrecke')}</span>`).join('')}${b.kurven.length > 12 ? `<span>+${b.kurven.length - 12}</span>` : ''}</div>` : '<p class="meine-bilanz-tipp">Fahr eine der markierten Kurvenstrecken mit Aufzeichnung — sie landet hier in deiner Sammlung.</p>'}
    ${extrem ? `<p class="meine-bilanz-tipp">${extrem} davon extrem kurvig.</p>` : ''}`
}

/** Band "Kurvenstrecken in der Nähe": die kurvigsten Straßen im Umkreis. */
let kurvenBandGen = 0
async function fuelleKurvenBand() {
  const gen = ++kurvenBandGen
  const h = herkunft()
  const band = document.getElementById('kurven-band')
  if (!h || !band) return
  const km = zustand.umkreis || 100
  const liste = await kurvenInDerNaehe(h.lat, h.lng, Math.min(km, 100), 10).catch(() => [])
  if (gen !== kurvenBandGen || !liste.length || !document.body.contains(band)) return
  band.hidden = false
  band.innerHTML = `
    <div class="tour-sammlung-kopf">
      <h4>Kurvenstrecken in der N\u00e4he</h4>
      <div class="tour-sammlung-pfeile">
        <button type="button" class="tour-pfeil" data-scroll="-1" aria-label="Zur\u00fcck">\u2039</button>
        <button type="button" class="tour-pfeil" data-scroll="1" aria-label="Weiter">\u203a</button>
      </div>
    </div>
    <div class="tour-sammlung-band">
      ${liste.map((k) => {
        const st = stufe(k)
        const pts = k.pts.map(([a, b]) => [a, b])
        kurvenQuellen.set(k.id, { pts, typ: 'strecke' })
        const bild = streckenBild({ id: k.id, _pts: pts, typ: 'strecke' }, 220, 120)
        return `<button type="button" class="tour-sammlung-karte" data-kurve="${esc(k.id)}">
          <span class="tour-sammlung-bild" data-vorschau="${esc(k.id)}" data-art="breit">${bild}</span>
          <span class="tour-sammlung-text">
            <strong>${esc(k.name || 'Kurvenstrecke')}</strong>
            <span><b style="color:${st.farbe}">${st.label}</b> \u00b7 ${(k.laenge / 1000).toFixed(1).replace('.', ',')}\u00a0km \u00b7 ${entfernung(k.abstand)}</span>
          </span>
        </button>`
      }).join('')}
    </div>`
  band._liste = liste
  vorschauBeobachten(band, vorschauQuelle)
}

// ── Detail ───────────────────────────────────────────────────────────────

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
  // Dateiname aus dem Tournamen: "Zittauer Gebirge" → Zittauer-Gebirge.gpx
  const datei = t.name.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'strecke'
  a.download = `${datei}.gpx`
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
  const t = findeTour(id)
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
  const wp = t.typ === 'rund' && t.wp.length ? [...t.wp, [`${t.wp[0][0]} (Ziel)`]] : t.wp
  box.innerHTML = `<div class="tour-detail">
    <button type="button" class="tour-zurueck" data-zurueck>‹ ${t.eigen ? 'Meine Strecken' : 'Alle Touren'}</button>
    <div class="tour-detail-bild" data-vorschau="${esc(t.id)}" data-art="breit" data-animiert>
      ${streckenBild({ ...t, _pts: d.pts }, 320, 168)}
      <button type="button" class="tour-flug-btn" data-flug>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Strecke abfliegen
      </button>
    </div>
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
      ${t.fahrt?.schnittKmh ? kz(`${zahl(t.fahrt.schnittKmh)} km/h`, 'Schnitt') : kz(`${zahl(t.hmax)} m`, 'Höchster Punkt')}
    </div>
    <div class="tour-aktionen">
      <button type="button" class="tour-btn tour-btn--primaer" data-fahren>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
        Tour fahren
      </button>
      <button type="button" class="tour-btn" data-gpx>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
        GPX
      </button>
      ${t.eigen
        ? `<button type="button" class="tour-btn" data-teilen>${ICON.teilen}<span>Teilen</span></button>`
        : `<button type="button" class="tour-btn${istGemerkt ? ' tour-btn--gemerkt' : ''}" data-merken aria-pressed="${istGemerkt}">
        ${ICON.merken(istGemerkt)}<span>${istGemerkt ? 'Gemerkt' : 'Merken'}</span>
      </button>`}
    </div>
    ${t.eigen ? `<div class="tour-eigen-aktionen">
      <button type="button" class="tour-link-btn" data-umbenennen>Umbenennen</button>
      <button type="button" class="tour-link-btn tour-link-btn--rot" data-loeschen>Löschen</button>
    </div>` : ''}
    ${hoehenprofil(t, d)}
    ${t.text ? `<p class="tour-text">${esc(t.text)}</p>` : ''}
    ${t.tags?.length ? `<div class="tour-tags">${t.tags.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    ${wp.length ? `<h4 class="tour-abschnitt">Wegpunkte</h4>
    <ol class="tour-wegpunkte">${wp.map((w) => `<li>${esc(w[0])}</li>`).join('')}</ol>` : ''}
    ${t.autobahnKm > 2 ? `<p class="tour-hinweis">Enthält rund ${zahl(t.autobahnKm)} km Autobahn als Verbindung.</p>` : ''}
    <p class="tour-hinweis">\u201eTour fahren\u201c f\u00fchrt dich mit Abbiegehinweisen und Ansage \u00fcber die Strecke \u2014 lass dabei den Bildschirm an, gesperrt gibt der Browser keinen Standort weiter. F\u00fcr ein Motorrad-Navi gibt es die Strecke als GPX.</p>
    ${t.eigen ? `<p class="tour-quelle">${t.art === 'aufgezeichnet' ? 'Aufgezeichnet mit MotoMatch. Gespeichert nur auf diesem Gerät, auch im Fahrtenbuch im Profil.' : 'Gespeichert nur auf diesem Gerät. Kartendaten © OpenStreetMap-Mitwirkende.'}</p>` : `<p class="tour-quelle">${esc(quellenText)}</p>`}
  </div>`
  box.scrollTop = 0
  vorschauBeobachten(box, vorschauQuelle)
  zeichneDetail(t, d)
  bindeProfil(t, d)
}

// ── Karte (MapLibre) ─────────────────────────────────────────────────────

const LEER = { type: 'FeatureCollection', features: [] }
const linie = (pts, props = {}, id) => ({ type: 'Feature', id, properties: props, geometry: { type: 'LineString', coordinates: pts.map(([la, ln]) => [ln, la]) } })
const punkt = (p, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p[1], p[0]] } })

const LINIE = '#3b5bdb'
// line-gradient statt line-color, damit sich die Linie beim Öffnen nachzeichnen lässt
const VOLL = (farbe) => ['interpolate', ['linear'], ['line-progress'], 0, farbe, 1, farbe]
const BIS = (farbe, p) => ['step', ['line-progress'], farbe, Math.max(0.0001, Math.min(0.9999, p)), 'rgba(0,0,0,0)']

/** Quellen und Ebenen einmal je Karte anlegen. */
function ebenen(map) {
  if (map.getSource('touren-liste')) return
  // Pfeil für die Fahrtrichtung als Bild — die Kartenschrift hat kein passendes Zeichen
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath(); g.moveTo(11, 8); g.lineTo(21, 16); g.lineTo(11, 24); g.stroke()
  map.addImage('tour-pfeil', g.getImageData(0, 0, 32, 32), { pixelRatio: 2 })

  // Umkreis der Suche als zarter Kreis (unter allem anderen)
  map.addSource('touren-umkreis', { type: 'geojson', data: LEER })
  const vorStrassen = map.getStyle().layers.find((l) => /^(tunnel_|road_|bridge_)/.test(l.id))?.id
  map.addLayer({ id: 'touren-umkreis-flaeche', type: 'fill', source: 'touren-umkreis', paint: { 'fill-color': '#4263eb', 'fill-opacity': 0.07 } }, vorStrassen)
  map.addLayer({ id: 'touren-umkreis-rand', type: 'line', source: 'touren-umkreis', paint: { 'line-color': '#3b5bdb', 'line-width': 2.2, 'line-opacity': 0.85, 'line-dasharray': [2.5, 1.8] } }, vorStrassen)
  map.addSource('touren-liste', { type: 'geojson', data: LEER })
  map.addSource('touren-start', { type: 'geojson', data: LEER })
  map.addSource('tour-detail', { type: 'geojson', data: LEER, lineMetrics: true })
  map.addSource('tour-detail-punkte', { type: 'geojson', data: LEER })
  const vorOrten = map.getLayer('orte-symbole') ? 'orte-symbole' : undefined
  map.addLayer({
    id: 'touren-linie', type: 'line', source: 'touren-liste',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#2b3fb8', '#4263eb'],
      'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 5.5, 3.5],
      'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, ['boolean', ['feature-state', 'gedimmt'], false], 0.3, 0.85],
    },
  }, vorOrten)
  map.addLayer({
    id: 'touren-start', type: 'circle', source: 'touren-start',
    paint: { 'circle-radius': 5, 'circle-color': '#4263eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
  }, vorOrten)
  map.addLayer({ id: 'tour-detail-rand', type: 'line', source: 'tour-detail', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-gradient': VOLL('#ffffff'), 'line-opacity': 0.95, 'line-width': 10 } }, vorOrten)
  map.addLayer({ id: 'tour-detail-linie', type: 'line', source: 'tour-detail', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-gradient': VOLL(LINIE), 'line-width': 5.5 } }, vorOrten)
  map.addLayer({
    id: 'tour-detail-pfeile', type: 'symbol', source: 'tour-detail',
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'tour-pfeil', 'icon-size': 0.8, 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map' },
  }, vorOrten)
  map.addLayer({
    id: 'tour-detail-punkte', type: 'circle', source: 'tour-detail-punkte',
    paint: {
      'circle-radius': 7,
      'circle-color': ['match', ['get', 'art'], 'ziel', '#1f1f1f', '#3b5bdb'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2.5,
    },
  })

  const oeffnen = (e) => { const id = e.features?.[0]?.properties?.id; if (id) oeffneTour(id) }
  map.on('click', 'touren-linie', oeffnen)
  map.on('click', 'touren-start', oeffnen)
  map.on('mousemove', 'touren-linie', (e) => {
    map.getCanvas().style.cursor = 'pointer'
    const id = e.features?.[0]?.properties?.id
    if (id && id !== hoverId) markiere(id)
  })
  map.on('mouseleave', 'touren-linie', () => { map.getCanvas().style.cursor = ''; markiere(null) })
}

const quelle = (map, id) => map.getSource(id)
// Erst nach dem 'load' der Karte dürfen Quellen dazukommen (karte.js setzt die Marke)
const istBereit = (map) => !!map?.__mmBereit

/** Kreis als Polygon (64 Ecken) um h mit Radius km. */
function umkreisKreis(h, km) {
  const ring = []
  const dLat = km / 111.32, dLng = km / (111.32 * Math.cos((h.lat * Math.PI) / 180))
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    ring.push([h.lng + dLng * Math.cos(a), h.lat + dLat * Math.sin(a)])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

function entferneListe() {
  const map = getHubMap()
  if (!map?.getSource('touren-liste')) return
  quelle(map, 'touren-umkreis').setData(LEER)
  quelle(map, 'touren-liste').setData(LEER)
  quelle(map, 'touren-start').setData(LEER)
  listenLinien = []
}
function entferneDetail() {
  const map = getHubMap()
  profilMarker?.remove()
  profilMarker = null
  if (!map?.getSource('tour-detail')) return
  quelle(map, 'tour-detail').setData(LEER)
  quelle(map, 'tour-detail-punkte').setData(LEER)
}

function grenzen(punkte) {
  let s = 90, w = 180, n = -90, o = -180
  for (const [la, ln] of punkte) { if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > o) o = ln }
  return [[w, s], [o, n]]
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
  if (!istBereit(map) || !zustand.aktiv) return
  ebenen(map)
  setKurvenSichtbar(zustand.kurvenEbene) // erst jetzt steht die Karte sicher
  entferneDetail()
  hoverId = null
  listenLinien = liste.map((t, i) => ({ id: t.id, fid: i + 1 }))
  quelle(map, 'touren-liste').setData({ type: 'FeatureCollection', features: liste.map((t, i) => linie(t._pts, { id: t.id }, i + 1)) })
  quelle(map, 'touren-start').setData({ type: 'FeatureCollection', features: liste.map((t) => punkt(t._pts[0], { id: t.id })) })
  // Umkreis um Standort bzw. die gesuchte Kartenmitte zeigen und einpassen
  const h = herkunft()
  const kreis = h && zustand.umkreis && !zustand.meine && !zustand.gemerkt ? umkreisKreis(h, zustand.umkreis) : null
  quelle(map, 'touren-umkreis').setData(kreis || LEER)
  // Reiter wird gerade neu aufgebaut (Karte 0×0): Ausschnitt bleibt, wie er war
  if (!map.getCanvas().clientWidth) anpassen = false
  if (anpassen && kreis) {
    // Etwas Luft um den Kreis, damit sein Rand sichtbar bleibt
    const r = rand()
    map.fitBounds(grenzen(kreis.geometry.coordinates[0].map(([ln, la]) => [la, ln])), { padding: { top: r.top + 24, bottom: r.bottom + 24, left: r.left + 24, right: r.right + 24 }, duration: 700 })
  }
  else if (anpassen && liste.length) map.fitBounds(grenzen(liste.flatMap((t) => t._pts)), { padding: rand(), duration: 700, maxZoom: 12 })
}

/** Karte und Liste zeigen dieselbe Tour hervorgehoben — von beiden Seiten aus. */
function markiere(id) {
  hoverId = id
  const map = getHubMap()
  if (map?.getSource('touren-liste')) {
    for (const o of listenLinien) map.setFeatureState({ source: 'touren-liste', id: o.fid }, { hover: o.id === id, gedimmt: id != null && o.id !== id })
  }
  document.querySelectorAll('#tour-liste .tour-card').forEach((c) => c.classList.toggle('tour-card--hover', c.dataset.tour === id))
}

function zeichneDetail(t, d) {
  const map = getHubMap()
  if (!istBereit(map) || !zustand.aktiv) return
  ebenen(map)
  entferneListe()
  quelle(map, 'tour-detail').setData(linie(d.pts))
  const punkte = [punkt(d.pts[0], { art: 'start' })]
  if (t.typ === 'strecke') punkte.unshift(punkt(d.pts[d.pts.length - 1], { art: 'ziel' }))
  quelle(map, 'tour-detail-punkte').setData({ type: 'FeatureCollection', features: punkte })
  // Reiter wird gerade neu aufgebaut (Karte 0×0): gleich danach passt oeffneTour ein
  if (map.getCanvas().clientWidth) map.fitBounds(grenzen(d.pts), { padding: rand(), duration: 700 })
  map.once('moveend', () => nachzeichnen(map))
}

/** Linie auf der Karte vom Start bis zum Ziel nachzeichnen lassen. */
let zeichenLauf = 0
function nachzeichnen(map, dauer = 1600) {
  const lauf = ++zeichenLauf
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !map.getLayer('tour-detail-linie')) return
  const t0 = performance.now()
  const schritt = (jetzt) => {
    if (lauf !== zeichenLauf || !map.getLayer('tour-detail-linie')) return
    const t = Math.min(1, (jetzt - t0) / dauer)
    const p = 1 - (1 - t) ** 3
    if (t < 1) {
      map.setPaintProperty('tour-detail-linie', 'line-gradient', BIS(LINIE, p))
      map.setPaintProperty('tour-detail-rand', 'line-gradient', BIS('#ffffff', p))
      requestAnimationFrame(schritt)
    } else {
      map.setPaintProperty('tour-detail-linie', 'line-gradient', VOLL(LINIE))
      map.setPaintProperty('tour-detail-rand', 'line-gradient', VOLL('#ffffff'))
    }
  }
  requestAnimationFrame(schritt)
}

// ── Strecke abfliegen (Kamera fährt die Tour in 3D ab) ───────────────────

let flug = null

function winkelZu(a, b) {
  const y = Math.sin(((b[1] - a[1]) * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180)
  const x = Math.cos((a[0] * Math.PI) / 180) * Math.sin((b[0] * Math.PI) / 180) - Math.sin((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.cos(((b[1] - a[1]) * Math.PI) / 180)
  return (Math.atan2(y, x) * 180) / Math.PI
}

function punktBei(d, m) {
  const { kum, pts } = d
  let lo = 0, hi = kum.length - 1
  while (lo < hi) { const k = (lo + hi) >> 1; if (kum[k] < m) lo = k + 1; else hi = k }
  if (lo === 0) return pts[0]
  const a = pts[lo - 1], b = pts[lo], f = (m - kum[lo - 1]) / Math.max(1e-6, kum[lo] - kum[lo - 1])
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/* Während des Flugs: Satellitenbild statt Kartenflächen, Straßen und Symbole
   aus, nur Ortsnamen und die Route bleiben — wie ein Überflug bei Apple. */
const FLUG_AUS = /^(tunnel_|road_|bridge_|building|landuse|landcover|park|aeroway|relief|poi_|highway-|road_shield|boundary|kurven-|touren-|waterway)/

function flugKarte(map, an, f) {
  if (an) {
    f.aus = []
    for (const l of map.getStyle().layers) {
      if (!FLUG_AUS.test(l.id) || map.getLayoutProperty(l.id, 'visibility') === 'none') continue
      map.setLayoutProperty(l.id, 'visibility', 'none')
      f.aus.push(l.id)
    }
    if (map.getLayer('satellit')) map.setLayoutProperty('satellit', 'visibility', 'visible')
    // Ortsnamen hell mit dunklem Rand — auf dem Satellitenbild sonst unlesbar
    f.schrift = []
    for (const l of map.getStyle().layers) {
      if (l.type !== 'symbol' || !/^(label_|water_name)/.test(l.id)) continue
      f.schrift.push([l.id, map.getPaintProperty(l.id, 'text-color'), map.getPaintProperty(l.id, 'text-halo-color'), map.getPaintProperty(l.id, 'text-halo-width')])
      map.setPaintProperty(l.id, 'text-color', '#ffffff')
      map.setPaintProperty(l.id, 'text-halo-color', 'rgba(0,0,0,0.75)')
      map.setPaintProperty(l.id, 'text-halo-width', 1.6)
    }
    f.himmel = map.getSky?.()
    try {
      map.setSky({
        'sky-color': '#6fa6dc', 'horizon-color': '#e4eef8', 'fog-color': '#dfe8f0',
        'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0.6,
      })
    } catch {}
    try { if (map.getSource('gelaende-3d')) map.setTerrain({ source: 'gelaende-3d', exaggeration: 1.7 }) } catch {}
    f.breite = [map.getPaintProperty('tour-detail-linie', 'line-width'), map.getPaintProperty('tour-detail-rand', 'line-width')]
    map.setPaintProperty('tour-detail-linie', 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 8])
    map.setPaintProperty('tour-detail-rand', 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 15])
  } else {
    for (const id of f.aus || []) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
    if (map.getLayer('satellit')) map.setLayoutProperty('satellit', 'visibility', 'none')
    for (const [id, farbe, halo, breite] of f.schrift || []) {
      if (!map.getLayer(id)) continue
      map.setPaintProperty(id, 'text-color', farbe)
      map.setPaintProperty(id, 'text-halo-color', halo)
      map.setPaintProperty(id, 'text-halo-width', breite)
    }
    try { map.setSky(f.himmel || {}) } catch {}
    try { map.setTerrain(null) } catch {}
    if (f.breite?.[0] != null) {
      map.setPaintProperty('tour-detail-linie', 'line-width', f.breite[0])
      map.setPaintProperty('tour-detail-rand', 'line-width', f.breite[1])
    }
  }
}

function hoeheBei(d, km) {
  const p = d.profil || []
  if (!p.length) return null
  let j = 0
  while (j < p.length - 1 && p[j + 1][0] < km) j++
  const a = p[j], b = p[Math.min(j + 1, p.length - 1)]
  const f = b[0] > a[0] ? (km - a[0]) / (b[0] - a[0]) : 0
  return Math.round(a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, f)))
}

export function flugStoppen(zurueck = true) {
  if (!flug) return
  const f = flug
  flug = null
  cancelAnimationFrame(f.raf)
  f.map.off('dragstart', f.abbruch); f.map.off('wheel', f.abbruch)
  f.punkt?.remove()
  f.hud?.remove()
  flugKarte(f.map, false, f)
  document.body.classList.remove('mm-fliegt')
  if (f.sheetWarAuf) document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: true } }))
  document.getElementById('tour-profil-cursor')?.classList.remove('an')
  document.querySelectorAll('[data-flug]').forEach((b) => { b.classList.remove('an'); b.lastChild.textContent = ' Strecke abfliegen' })
  // Der Flug setzt einen Kamera-Innenrand, der sonst haften bleibt und jedes
  // spätere Zentrieren (Mein Standort, Tour öffnen) verschiebt
  f.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 })
  if (zurueck) f.map.fitBounds(grenzen(f.d.pts), { padding: rand(), pitch: 0, bearing: 0, duration: 1400 })
  else f.map.easeTo({ pitch: 0, bearing: 0, duration: 800 })
  f.map.once('moveend', () => { if (!flug) f.map.setMaxPitch(0) })
}

function abfliegen(d, t) {
  const map = getHubMap(), ml = getMapLib()
  if (!map || !ml) return
  if (flug) { flugStoppen(); return }
  const gesamt = d.kum[d.kum.length - 1]
  const dauer = Math.min(60, Math.max(24, (gesamt / 1000) * 0.26)) * 1000
  const el = document.createElement('div')
  el.className = 'flug-punkt'
  map.setMaxPitch(76)
  const f = flug = { map, d, raf: 0, punkt: new ml.Marker({ element: el }).setLngLat([d.pts[0][1], d.pts[0][0]]).addTo(map), kurs: null, t0: 0, tLetzt: 0 }
  flugKarte(map, true, f)
  document.body.classList.add('mm-fliegt')
  // Handy: Panel einklappen, sonst sieht man vom Flug nichts — danach wieder auf
  const mobil = window.matchMedia('(max-width: 759.98px)').matches
  if (mobil) {
    f.sheetWarAuf = !!document.querySelector('.konf-karte-hub .kv-sidebar.kv-sheet--expanded')
    document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: false } }))
  }
  // Anzeige oben auf der Karte: Name, Fortschritt, Kilometer und Höhe
  const host = document.querySelector('.konf-karte-hub .kv-map-wrap')
  if (host) {
    f.hud = document.createElement('div')
    f.hud.className = 'flug-hud'
    f.hud.innerHTML = `<button type="button" class="flug-hud-zu" aria-label="Flug beenden">×</button><strong>${esc(t?.name || 'Strecke')}</strong><div class="flug-hud-zeile"><span class="flug-km">km 0</span><span class="flug-hoehe"></span></div><div class="flug-hud-balken"><i></i></div>`
    f.hud.querySelector('.flug-hud-zu').addEventListener('click', () => flugStoppen())
    host.appendChild(f.hud)
  }
  f.abbruch = (e) => { if (e.originalEvent) flugStoppen(false) }
  map.on('dragstart', f.abbruch); map.on('wheel', f.abbruch)
  document.querySelectorAll('[data-flug]').forEach((b) => { b.classList.add('an'); b.lastChild.textContent = ' Flug stoppen' })
  const pad = mobil ? { top: 90, bottom: Math.round(Math.min(260, window.innerHeight * 0.33)), left: 20, right: 20 } : rand()
  const padding = { top: Math.round(pad.top + (window.innerHeight * 0.18)), bottom: pad.bottom, left: pad.left, right: pad.right }
  const cursor = document.getElementById('tour-profil-cursor')
  const wert = document.getElementById('tour-profil-wert')
  // Anflug: aus der Übersicht hinter den Start, langsam absenken
  map.flyTo({ center: [d.pts[0][1], d.pts[0][0]], zoom: 12.9, pitch: 68, bearing: winkelZu(d.pts[0], punktBei(d, 2000)), padding, duration: 3200, curve: 1.6 })
  map.once('moveend', () => {
    if (flug !== f) return
    f.t0 = performance.now()
    f.tLetzt = f.t0
    const schritt = (jetzt) => {
      if (flug !== f) return
      const dt = Math.min(0.1, (jetzt - f.tLetzt) / 1000)
      f.tLetzt = jetzt
      const t = Math.min(1, (jetzt - f.t0) / dauer)
      // sanft anfahren und ausrollen, dazwischen gleichmäßig
      const p = t < 0.06 ? (t * t) / 0.12 : t > 0.94 ? 1 - ((1 - t) * (1 - t)) / 0.12 : 0.03 + (t - 0.06) * (0.94 / 0.88)
      const m = Math.min(1, Math.max(0, p)) * gesamt
      const hier = punktBei(d, m)
      const ziel = winkelZu(hier, punktBei(d, Math.min(gesamt, m + 2200)))
      // Kurs weich nachführen (unabhängig von der Bildrate), sonst wackelt das Bild in jeder Kehre
      if (f.kurs == null) f.kurs = ziel
      f.kurs += ((((ziel - f.kurs) % 360) + 540) % 360 - 180) * Math.min(1, dt * 1.6)
      map.jumpTo({ center: [hier[1], hier[0]], bearing: f.kurs, pitch: 68, zoom: 12.9, padding })
      f.punkt.setLngLat([hier[1], hier[0]])
      if (f.hud && jetzt - (f.hudZeit || 0) > 120) {
        f.hudZeit = jetzt
        const km = m / 1000
        const h = hoeheBei(d, km)
        f.hud.querySelector('.flug-km').textContent = `km ${zahl(km)} von ${zahl(gesamt / 1000)}`
        f.hud.querySelector('.flug-hoehe').textContent = h != null ? `${zahl(h)} m` : ''
        f.hud.querySelector('.flug-hud-balken i').style.width = `${(m / gesamt) * 100}%`
        if (cursor) {
          const x = String((m / gesamt) * 320)
          cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.classList.add('an')
          if (wert && h != null) wert.textContent = `km ${zahl(km)} · ${zahl(h)} m`
        }
      }
      if (t < 1) f.raf = requestAnimationFrame(schritt)
      else flugStoppen()
    }
    f.raf = requestAnimationFrame(schritt)
  })
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
    const map = getHubMap(), ml = getMapLib()
    if (!map || !ml) return
    if (!profilMarker) {
      const el = document.createElement('div')
      el.className = 'tour-profil-punkt'
      profilMarker = new ml.Marker({ element: el })
    }
    profilMarker.setLngLat([d.pts[lo][1], d.pts[lo][0]]).addTo(map)
  }
  const weg = () => {
    cursor.classList.remove('an')
    wert.textContent = grundtext
    profilMarker?.remove()
  }
  svg.addEventListener('pointermove', bewegen)
  svg.addEventListener('pointerdown', bewegen)
  svg.addEventListener('pointerleave', weg)
}

// ── Steuerung von außen ──────────────────────────────────────────────────

/** Karte steht (neu oder umgezogen): aktuellen Zustand darauf zeichnen. */
function neuZeichnen(anpassen = false) {
  if (!zustand.aktiv) return
  setKurvenSichtbar(zustand.kurvenEbene)
  if (zustand.offeneTour && details.has(zustand.offeneTour)) {
    const t = findeTour(zustand.offeneTour)
    if (t) { zeichneDetail(t, details.get(zustand.offeneTour)); return }
  }
  const von = (zustand.seite - 1) * PRO_SEITE
  zeichneListe(passendeTouren.slice(von, von + PRO_SEITE).map((x) => x.t), anpassen)
}

export function setTourenAktiv(an) {
  zustand.aktiv = an
  document.querySelector('.konf-karte-hub .kv-sidebar')?.classList.remove('kv-kopf-weg')
  setKurvenSichtbar(an && zustand.kurvenEbene)
  if (!an) { entferneListe(); entferneDetail(); return }
  renderUmkreis() // war versteckt und ist erst jetzt messbar
  neuZeichnen(true)
}

/** "In diesem Gebiet suchen" bzw. Ortssuche: neue Mitte für Entfernung und Umkreis. */
export function setTourenHerkunft(lat, lng, { karteAnpassen = true } = {}) {
  zustand.herkunft = lat == null ? null : { lat, lng }
  zustand.seite = 1
  zustand.offeneTour = null
  zustand.meine = false
  zustand.gemerkt = false
  if (!zustand.umkreis && karteAnpassen) {
    // "Alle" gewählt: Umkreis passend zum sichtbaren Ausschnitt nehmen
    const map = getHubMap()
    let r = 100
    if (lat != null && map) {
      const b = map.getBounds()
      r = Math.min(haversineKm(lat, lng, b.getNorth(), lng), haversineKm(lat, lng, lat, b.getEast()))
    }
    zustand.umkreis = UMKREISE.find((u) => u && u >= r) || 200
  }
  renderUmkreis()
  renderListe({ karteAnpassen })
}

let umkreisThumb = null
function renderUmkreis() {
  document.querySelectorAll('.tour-umkreis .kv-radius-pill').forEach((b) => b.classList.toggle('kv-radius-pill--active', +b.dataset.umkreis === zustand.umkreis))
  umkreisThumb?.()
}

/** Route vom eigenen Standort zu einer gesuchten Adresse planen (Ortssuche). */
export function planeZu(ziel) {
  return import('./planer.js').then((m) => m.planerOeffnen({ fertig: zeigeEigene, ziel }))
}

/** Eigene Strecken zeigen, optional gleich eine davon öffnen. */
function zeigeEigene(id) {
  eigeneGeaendert()
  zustand.meine = true
  zustand.gemerkt = false
  zustand.seite = 1
  if (id) { renderFilter(); oeffneTour(id) } else { zustand.offeneTour = null; renderListe({ karteAnpassen: true }) }
}

/** Kurze Meldung unten im Panel. */
function hinweis(text) {
  const panel = document.getElementById('kv-touren')
  if (!panel) return
  panel.querySelector('.tour-toast')?.remove()
  const el = document.createElement('div')
  el.className = 'tour-toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  panel.appendChild(el)
  setTimeout(() => el.remove(), 3200)
}

/** Teilen: Link, der die Strecke selbst enthält — über das Teilen-Menü des Handys oder in die Zwischenablage. */
async function teilen(t, d) {
  const url = teilenLink(t.name, d.pts)
  const text = `${t.name} — ${zahl(t.km)} km auf MotoMatch`
  try {
    if (navigator.share) { await navigator.share({ title: t.name, text, url }); return }
  } catch (err) { if (err?.name === 'AbortError') return }
  try { await navigator.clipboard.writeText(url); hinweis('Link kopiert — schick ihn, wem du willst.') }
  catch { meldung({ titel: 'Link zum Teilen', eingabe: url, knoepfe: [{ label: 'Fertig', wert: true, haupt: true }] }) }
}

/** Geteilte Strecke aus dem Link (app.js legt sie in sessionStorage ab). */
function geteilteUebernehmen() {
  let hash = null
  try { hash = sessionStorage.getItem('mm_strecke_import'); sessionStorage.removeItem('mm_strecke_import') } catch {}
  const s = hash && ausLink(hash)
  if (!s) return false
  try {
    const id = speichereStrecke({ name: s.name, art: 'geteilt', pts: s.pts })
    zeigeEigene(PRAEFIX + id)
    hinweis('Geteilte Strecke gespeichert')
    return true
  } catch { return false }
}

/**
 * Touren-Ansicht verdrahten. Läuft bei jedem Aufbau des Karten-Reiters.
 * @param {{ mountThumb?: (el: Element, sel: string, cls?: string) => (() => void) | null }} opts
 */
export function initTouren({ mountThumb } = {}) {
  const ansicht = document.getElementById('kv-touren')
  // Zweiter Aufruf auf demselben DOM (Reiter erneut gebunden): nichts doppelt
  // verdrahten — sonst schaltet jeder Klick zweimal und hebt sich auf.
  if (!ansicht || ansicht.dataset.gebunden) return
  ansicht.dataset.gebunden = '1'

  umkreisThumb = mountThumb?.(document.querySelector('.tour-umkreis'), '.kv-radius-pill--active', 'kv-pill-thumb--radius') || null
  document.querySelectorAll('.tour-umkreis .kv-radius-pill').forEach((b) => b.addEventListener('click', () => {
    zustand.umkreis = +b.dataset.umkreis
    zustand.seite = 1
    zustand.offeneTour = null
    renderUmkreis()
    renderListe({ karteAnpassen: true })
  }))

  // Kopf (Touren/Orte, Umkreis, Filter) beim Runterscrollen ausblenden, beim
  // Hochscrollen wieder zeigen — mehr Platz für die Liste
  const box = document.getElementById('tour-liste')
  const seitenleiste = ansicht.closest('.kv-sidebar')
  let letzteY = 0
  box?.addEventListener('scroll', () => {
    const y = box.scrollTop
    if (y < 24) seitenleiste?.classList.remove('kv-kopf-weg')
    else if (y > letzteY + 6) {
      seitenleiste?.classList.add('kv-kopf-weg')
      const menue = ansicht.querySelector('.tour-neu-menue')
      if (menue && !menue.hidden) { menue.hidden = true; ansicht.querySelector('#tour-neu')?.setAttribute('aria-expanded', 'false') }
    }
    else if (y < letzteY - 6) seitenleiste?.classList.remove('kv-kopf-weg')
    if (Math.abs(y - letzteY) > 6 || y < 24) letzteY = y
  }, { passive: true })

  // "+ Neu"-Menü schließt bei jedem Tipp daneben (auch auf der Karte)
  document.addEventListener('pointerdown', (e) => {
    const menue = ansicht.querySelector('.tour-neu-menue')
    if (!menue || menue.hidden || e.target.closest?.('.tour-neu-wrap')) return
    menue.hidden = true
    ansicht.querySelector('#tour-neu')?.setAttribute('aria-expanded', 'false')
  })
  ansicht.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]')
    if (chip) {
      const key = chip.dataset.filter
      if (key === 'kurvenebene') {
        zustand.kurvenEbene = !zustand.kurvenEbene
        try { localStorage.setItem(LS_KURVEN_EBENE, zustand.kurvenEbene ? '1' : '0') } catch {}
        setKurvenSichtbar(zustand.kurvenEbene)
        renderFilter()
        return
      }
      if (key === 'gemerkt') {
        zustand.gemerkt = !zustand.gemerkt
        zustand.offenerFilter = null
      } else if (key === 'meine') {
        zustand.meine = !zustand.meine
        zustand.gemerkt = false
        zustand.offenerFilter = null
      } else {
        zustand.offenerFilter = zustand.offenerFilter === 'filter' ? null : 'filter'
        renderFilter()
        return
      }
      zustand.seite = 1
      renderListe({ karteAnpassen: true })
      return
    }
    const option = e.target.closest('.tour-option[data-gruppe]')
    if (option) {
      zustand[option.dataset.gruppe] = option.dataset.wert
      zustand.seite = 1
      renderListe({ karteAnpassen: true })
      return
    }
    const neu = e.target.closest('#tour-neu')
    const menue = ansicht.querySelector('.tour-neu-menue')
    if (neu) {
      const auf = menue.hidden
      menue.hidden = !auf
      neu.setAttribute('aria-expanded', String(auf))
      return
    }
    if (menue && !menue.hidden && !e.target.closest('.tour-neu-menue')) { menue.hidden = true; ansicht.querySelector('#tour-neu')?.setAttribute('aria-expanded', 'false') }
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
    const aktion = e.target.closest('[data-aktion]')
    if (aktion) {
      const was = aktion.dataset.aktion
      if (menue) { menue.hidden = true; ansicht.querySelector('#tour-neu')?.setAttribute('aria-expanded', 'false') }
      if (was === 'import') document.getElementById('tour-gpx-datei')?.click()
      if (was === 'aufzeichnen') import('./aufzeichnen.js').then((m) => m.aufzeichnungStarten({ fertig: zeigeEigene }))
      if (was === 'planen') import('./planer.js').then((m) => m.planerOeffnen({ fertig: zeigeEigene }))
      return
    }
    if (e.target.closest('[data-teilen]')) {
      const t = findeTour(zustand.offeneTour), d = details.get(zustand.offeneTour)
      if (t && d) teilen(t, d)
      return
    }
    if (e.target.closest('[data-umbenennen]')) {
      const t = findeTour(zustand.offeneTour)
      if (!t) return
      eingeben('Neuer Name der Strecke', t.name).then((name) => {
        if (name?.trim()) { umbenennen(t.id, name.trim().slice(0, 80)); eigeneGeaendert(); oeffneTour(t.id) }
      })
      return
    }
    if (e.target.closest('[data-loeschen]')) {
      const t = findeTour(zustand.offeneTour)
      if (!t) return
      fragen(`„${t.name}“ löschen?`, 'Das lässt sich nicht rückgängig machen.', { ja: 'Löschen', gefahr: true }).then((ja) => {
        if (!ja) return
        loesche(t.id); eigeneGeaendert()
        zustand.offeneTour = null
        renderListe({ karteAnpassen: true })
      })
      return
    }
    if (e.target.closest('[data-flug]')) {
      const d = details.get(zustand.offeneTour)
      if (d) abfliegen(d, findeTour(zustand.offeneTour))
      return
    }
    if (e.target.closest('[data-zurueck]')) {
      flugStoppen(false)
      zustand.offeneTour = null
      renderListe({ karteAnpassen: true })
      return
    }
    if (e.target.closest('[data-fahren]')) {
      const t = findeTour(zustand.offeneTour)
      const d = details.get(zustand.offeneTour)
      if (t && d) {
        flugStoppen(false)
        import('./tour-fahren.js').then((m) => m.fahrtVorbereiten(t, d, { zurueck: () => oeffneTour(t.id) }))
      }
      return
    }
    if (e.target.closest('[data-gpx]')) {
      const t = findeTour(zustand.offeneTour)
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
      renderFilter() // Zähler am Gemerkt-Chip
      return
    }
    const kurve = e.target.closest('[data-kurve]')
    if (kurve) {
      const k = document.getElementById('kurven-band')?._liste?.find((x) => x.id === kurve.dataset.kurve)
      if (k) {
        if (!zustand.kurvenEbene) { zustand.kurvenEbene = true; setKurvenSichtbar(true); renderFilter() }
        zeigeStrecke(k, { padding: rand() })
      }
      return
    }
    const tour = e.target.closest('[data-tour]')
    if (tour) oeffneTour(tour.dataset.tour)
  })
  ansicht.addEventListener('change', async (e) => {
    if (e.target.id !== 'tour-gpx-datei') return
    const datei = e.target.files?.[0]
    e.target.value = ''
    if (!datei) return
    try {
      if (datei.size > 15 * 1024 * 1024) throw new Error('Die Datei ist zu groß (höchstens 15 MB).')
      const g = gpxLesen(await datei.text())
      const id = speichereStrecke({ name: g.name || datei.name.replace(/\.gpx$/i, ''), art: 'importiert', pts: g.pts, hoehen: g.hoehen })
      zeigeEigene(PRAEFIX + id)
      hinweis('Strecke importiert')
    } catch (err) {
      hinweis(err.message || 'Die Datei konnte nicht gelesen werden.')
    }
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
    if (geteilteUebernehmen()) return
    if (zustand.offeneTour) oeffneTour(zustand.offeneTour)
    else renderListe({ karteAnpassen: true })
  }).catch(() => {
    const box = document.getElementById('tour-liste')
    if (box) box.innerHTML = '<div class="kv-results-empty"><span class="kv-empty-title">Touren konnten nicht geladen werden</span><span class="kv-empty-hint">Prüfe deine Verbindung und öffne den Reiter erneut.</span></div>'
  })
}

/** Karte frei machen (Planer, Aufzeichnung): Tourlinien und Detail weg. */
export function tourenKarteLeeren() {
  flugStoppen(false)
  entferneListe()
  entferneDetail()
}

/** Eine eigene Strecke öffnen (z. B. nach dem Speichern einer Fahrt). */
export function zeigeEigeneStrecke(id) { zeigeEigene(id) }

/** Zurück zur Tourenliste (z. B. aus dem Startbildschirm einer Kurvenstrecke). */
export function zeigeTourenListe() {
  zustand.offeneTour = null
  renderListe({ karteAnpassen: true })
}

/** Standort kam nachträglich (Freigabe, Ortssuche): Entfernungen neu rechnen. */
export function tourenStandortGeaendert() {
  if (!touren.length || zustand.offeneTour) return
  if (!zustand.herkunft && zustand.umkreis === 0 && herkunft()) { zustand.umkreis = 100; renderUmkreis() }
  renderListe({ karteAnpassen: true })
}
