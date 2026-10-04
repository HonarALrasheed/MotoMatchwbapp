/* ═══════════════════════════════════════════════════
   FREUNDE AUF DER KARTE — wie "Wo ist?", nur für Motorradfahrer.

   - Eigener Standort als Profilbild statt blauem Punkt.
   - "Freunde": Freunde (friendships) mit genauer Position, Liste mit
     Entfernung und "vor 3 Min", Route zum Freund mit dem Navi.
   - "Öffentlich": andere Fahrer in der Gegend, auf ~1 km gerundet
     (Supabase-Funktion oeffentliche_standorte).
   - Mein Standort teilen: Aus (Standard) / Freunde / Öffentlich. Nur solange
     die Seite offen ist; "Aus" löscht die gespeicherte Position.
   Tabelle und Regeln: supabase/migrations/20261004000000_a18_standorte.sql
   ═══════════════════════════════════════════════════ */

import { esc, safeUrl } from './util.js'
import { supabase, OFFLINE_MODE } from './supabase.js'
import { getSession, currentUser } from './auth.js'
import { getHubMap, getMapLib, haversineKm, getUserCoords } from './karte.js'

const TEILEN_KEY = 'mm_standort_teilen_v1' // 'aus' | 'freunde' | 'oeffentlich'
const ANSICHT_KEY = 'mm_karte_leute_v1'    // { freunde: bool, oeffentlich: bool }
const VERBORGEN_KEY = 'mm_standort_verborgen_v1' // Benutzernamen, die mich nicht sehen
const ABFRAGE_MS = 15_000
const SENDEN_MS = 20_000

const zustand = {
  freunde: false,
  naheListe: [],
  personen: new Map(), // schluessel → { marker, daten }
  freundesListe: [],   // letzte Abfrage für die Liste
  fehler: '',
  timer: null,
  watch: null,
  zuletztGesendet: 0,
  letztePos: null,
}

// ── Hilfen ───────────────────────────────────────────────────────────────

const ich = () => getSession()?.username || ''
const angemeldet = () => !OFFLINE_MODE && !!supabase && !!getSession()?.uid
const lesen = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const schreiben = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
const verborgen = () => { const l = lesen(VERBORGEN_KEY, []); return Array.isArray(l) ? l : [] }
const uidCache = new Map() // Benutzername → uid
async function uidsVon(namen) {
  const offen = namen.filter((n) => !uidCache.has(n))
  if (offen.length && angemeldet()) {
    const { data } = await supabase.from('profiles').select('id, username').in('username', offen)
    for (const r of data || []) uidCache.set(r.username, r.id)
  }
  return namen.map((n) => uidCache.get(n)).filter(Boolean)
}
export const teilenModus = () => { const m = lesen(TEILEN_KEY, 'aus'); return ['freunde', 'oeffentlich'].includes(m) ? m : 'aus' }

const FARBEN = ['#e8590c', '#2b8a3e', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#5f3dc4', '#d9480f']
function farbeFuer(name, farbe) {
  if (typeof farbe === 'string' && /^#[0-9a-f]{3,8}$/i.test(farbe.trim())) return farbe.trim()
  let h = 0
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0
  return FARBEN[h % FARBEN.length]
}
const initialen = (n) => (n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

function vor(zeit) {
  const min = Math.round((Date.now() - new Date(zeit).getTime()) / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} Min`
  const h = Math.round(min / 60)
  return h < 24 ? `vor ${h} Std` : 'vor über einem Tag'
}

/** Profilbild aus dem Community-Speicher (lädt fehlende Bilder nach). */
async function bildVon(username) {
  try {
    const api = await import('./community-api.js')
    if (username !== ich()) await api.ensureAvatars([username])
    const p = api.getProfile(username) || {}
    return { bild: safeUrl(p.avatarImg) || null, farbe: p.avatarColor, name: p.displayName || username }
  } catch { return { bild: null, farbe: null, name: username } }
}

function avatarHtml({ bild, farbe, name, username }) {
  return bild
    ? `<img src="${esc(bild)}" alt="">`
    : `<span style="background:${farbeFuer(username || name, farbe)}">${esc(initialen(name || username))}</span>`
}

// ── Eigener Standort als Profilbild ──────────────────────────────────────

/** Füllt den Standort-Marker der Karte mit dem eigenen Profilbild. */
export async function eigenesBild(el) {
  const s = getSession()
  if (!el || !s || s.guest) return
  const me = currentUser()
  let daten = { bild: safeUrl(me?.avatar) || null, farbe: null, name: me?.name || s.username, username: s.username }
  if (!daten.bild) daten = { ...daten, ...(await bildVon(s.username)) }
  el.classList.add('mm-standort-punkt--avatar')
  el.innerHTML = `<span class="mm-standort-bild">${avatarHtml({ ...daten, username: s.username })}</span>`
}

// ── Mein Standort senden ─────────────────────────────────────────────────

async function senden(lat, lng, kmh) {
  const modus = teilenModus()
  if (modus === 'aus' || !angemeldet()) return
  const jetzt = Date.now()
  const bewegt = zustand.letztePos ? haversineKm(zustand.letztePos[0], zustand.letztePos[1], lat, lng) * 1000 : Infinity
  if (jetzt - zustand.zuletztGesendet < SENDEN_MS && bewegt < 150) return
  zustand.zuletztGesendet = jetzt
  zustand.letztePos = [lat, lng]
  const unterwegs = document.body.classList.contains('mm-faehrt') || (kmh ?? 0) > 15
  const { error } = await supabase.from('standorte').upsert({
    user_id: getSession().uid, lat: +lat.toFixed(5), lng: +lng.toFixed(5),
    tempo: kmh != null ? Math.round(kmh) : null, unterwegs, sichtbar: modus,
    verborgen_vor: await uidsVon(verborgen()),
  })
  if (error) console.warn('[freunde] Standort senden', error.message)
}

function teilenStarten() {
  if (zustand.watch != null || teilenModus() === 'aus' || !navigator.geolocation) return
  zustand.watch = navigator.geolocation.watchPosition(
    (p) => senden(p.coords.latitude, p.coords.longitude, Number.isFinite(p.coords.speed) ? p.coords.speed * 3.6 : null),
    () => {},
    { enableHighAccuracy: false, maximumAge: 15_000, timeout: 30_000 },
  )
}
function teilenStoppen() {
  if (zustand.watch != null) navigator.geolocation.clearWatch(zustand.watch)
  zustand.watch = null
}

export async function teilenSetzen(modus) {
  schreiben(TEILEN_KEY, modus)
  zustand.zuletztGesendet = 0
  if (modus === 'aus') {
    teilenStoppen()
    if (angemeldet()) await supabase.from('standorte').delete().eq('user_id', getSession().uid)
    return
  }
  const c = getUserCoords()
  if (c.lat != null) senden(c.lat, c.lng, null)
  teilenStarten()
}

/** Vor einem Freund verbergen / wieder zeigen. Wirkt sofort, auch auf die gespeicherte Position. */
async function verbergenUmschalten(username) {
  const l = verborgen()
  const neu = l.includes(username) ? l.filter((u) => u !== username) : [...l, username]
  schreiben(VERBORGEN_KEY, neu)
  if (teilenModus() !== 'aus' && angemeldet()) {
    const { error } = await supabase.from('standorte').update({ verborgen_vor: await uidsVon(neu) }).eq('user_id', getSession().uid)
    if (error) console.warn('[freunde] verbergen', error.message)
  }
}

// ── Andere abfragen ──────────────────────────────────────────────────────

async function freundeHolen() {
  const { data, error } = await supabase
    .from('standorte')
    .select('user_id, lat, lng, tempo, unterwegs, aktualisiert, profiles(username, display_name, avatar_color)')
  if (error) throw error
  return (data || [])
    .filter((r) => r.user_id !== getSession().uid && r.profiles?.username)
    .map((r) => ({ username: r.profiles.username, name: r.profiles.display_name || r.profiles.username, farbe: r.profiles.avatar_color, lat: r.lat, lng: r.lng, tempo: r.tempo, unterwegs: r.unterwegs, zeit: r.aktualisiert, freund: true }))
}

async function oeffentlicheHolen(map) {
  const b = map.getBounds()
  const { data, error } = await supabase.rpc('oeffentliche_standorte', { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), o: b.getEast() })
  if (error) throw error
  return (data || []).map((r) => ({ username: r.username, name: r.display_name || r.username, farbe: r.avatar_color, lat: r.lat, lng: r.lng, unterwegs: r.unterwegs, zeit: r.aktualisiert, freund: false }))
}

async function aktualisieren() {
  const map = getHubMap()
  if (!map?.__mmBereit || document.hidden || !map.getContainer().offsetParent || zustand.demo) return
  // Der Modus regelt beides: wen ich sehe und wer mich sieht. Unsichtbar = niemand.
  const modus = teilenModus()
  if (!zustand.freunde || modus === 'aus') { zustand.freundesListe = []; zustand.naheListe = []; zeichnen([]); liste(); return }
  if (!angemeldet()) { zustand.fehler = 'anmelden'; zeichnen([]); liste(); return }
  try {
    const [fr, oe] = await Promise.all([
      freundeHolen(),
      modus === 'oeffentlich' ? oeffentlicheHolen(map) : [],
    ])
    zustand.fehler = ''
    zustand.freundesListe = fr
    zustand.naheListe = oe.filter((p) => !fr.some((f) => f.username === p.username))
    const freundNamen = new Set(fr.map((p) => p.username))
    zeichnen([...fr, ...oe.filter((p) => !freundNamen.has(p.username))])
  } catch (err) {
    console.warn('[freunde]', err?.message || err)
    zustand.fehler = /does not exist|schema cache|PGRST20/.test(err?.message || '') ? 'fehlt' : 'netz'
  }
  liste()
}

// ── Darstellung auf der Karte ────────────────────────────────────────────

function zeichnen(personen) {
  const map = getHubMap(), ml = getMapLib()
  if (!map || !ml) return
  const neu = new Set()
  for (const p of personen) {
    const k = `${p.freund ? 'f' : 'o'}:${p.username}`
    neu.add(k)
    let e = zustand.personen.get(k)
    if (!e) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `leute-marker${p.freund ? '' : ' leute-marker--oeffentlich'}`
      el.setAttribute('aria-label', p.name)
      el.innerHTML = `<span class="leute-marker-bild">${avatarHtml(p)}</span><span class="leute-marker-name">${esc(p.name)}</span>`
      el.addEventListener('click', (ev) => { ev.stopPropagation(); zeigeInfo(zustand.personen.get(k)?.daten) })
      e = { marker: new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map), daten: p }
      zustand.personen.set(k, e)
      bildVon(p.username).then((b) => { if (b.bild) el.querySelector('.leute-marker-bild').innerHTML = avatarHtml({ ...p, bild: b.bild }) })
    } else {
      e.marker.setLngLat([p.lng, p.lat])
      e.daten = p
    }
    e.marker.getElement().classList.toggle('leute-marker--unterwegs', !!p.unterwegs)
    e.marker.getElement().classList.toggle('leute-marker--alt', Date.now() - new Date(p.zeit).getTime() > 60 * 60_000)
  }
  for (const [k, e] of zustand.personen) if (!neu.has(k)) { e.marker.remove(); zustand.personen.delete(k) }
}

let popup = null
function zeigeInfo(p) {
  const map = getHubMap(), ml = getMapLib()
  if (!p || !map || !ml) return
  popup?.remove()
  const c = getUserCoords()
  const km = c.lat != null ? haversineKm(c.lat, c.lng, p.lat, p.lng) : null
  const el = document.createElement('div')
  el.className = 'hub-info'
  el.innerHTML = `
    <span class="hub-info-name">${esc(p.name)}</span>
    <span class="hub-info-type">${p.unterwegs ? 'Fährt gerade' : 'Steht'}${p.freund ? '' : ' · ungefähre Position'}</span>
    <span class="hub-info-addr">${km != null ? `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km entfernt · ` : ''}${vor(p.zeit)}</span>
    ${p.freund ? '<button type="button" class="kurve-fahren" data-hinfahren>Hinfahren</button>' : ''}`
  el.querySelector('[data-hinfahren]')?.addEventListener('click', () => hinfahren(p))
  popup = new ml.Popup({ offset: 46, closeButton: true, className: 'mm-popup', maxWidth: '240px' }).setLngLat([p.lng, p.lat]).setDOMContent(el).addTo(map)
}

async function hinfahren(p) {
  popup?.remove()
  const c = getUserCoords()
  if (c.lat == null) { alert('Dein Standort ist noch nicht bekannt.'); return }
  try {
    const [{ route }, { fahrtVorbereiten }] = await Promise.all([import('./routing.js'), import('./tour-fahren.js')])
    const r = await route([[c.lat, c.lng], [p.lat, p.lng]])
    const t = { id: `freund:${p.username}`, name: `Zu ${p.name}`, typ: 'strecke', min: Math.max(1, Math.round((r.sekunden || 0) / 60)) }
    fahrtVorbereiten(t, r, { zurueck: () => import('./touren.js').then((m) => m.zeigeTourenListe?.()) })
  } catch (err) {
    alert(err?.message || 'Die Route konnte nicht berechnet werden.')
  }
}

// ── Knöpfe und Liste ─────────────────────────────────────────────────────

const ICON = {
  freunde: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.3"/><path d="M2.8 19.5c.6-3.4 3.1-5.3 6.2-5.3s5.6 1.9 6.2 5.3"/><circle cx="17" cy="9" r="2.6"/><path d="M16.3 14.3c2.6.1 4.4 1.8 4.9 4.6"/></svg>',
  auge: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  zu: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.6 6.7C3.7 8.6 2 12 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.9-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  welt: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/></svg>',
}

function knoepfe() {
  const ctrl = document.getElementById('kv-map-controls')
  if (!ctrl || ctrl.querySelector('.leute-knoepfe')) return
  const g = document.createElement('div')
  g.className = 'leute-knoepfe'
  g.innerHTML = `<button type="button" class="kv-map-fab leute-knopf" data-leute aria-pressed="false" title="Freunde und Fahrer in der Nähe" aria-label="Freunde">${ICON.freunde}</button>`
  ctrl.prepend(g)
  g.addEventListener('click', () => {
    zustand.freunde = !zustand.freunde
    ansichtMerken()
    panelUmschalten(zustand.freunde)
    aktualisieren()
  })
  knopfStatus()
}
const ansichtMerken = () => schreiben(ANSICHT_KEY, { freunde: zustand.freunde })
function knopfStatus() {
  document.querySelectorAll('.leute-knopf').forEach((b) => b.setAttribute('aria-pressed', String(zustand.freunde)))
}

/* Die Übersicht "Du siehst / Dich sieht" erscheint nur beim ersten Öffnen
   nach dem App-Start; danach weiß man es. */
let regelGesehen = false

function panelUmschalten(an) {
  const wrap = document.querySelector('.konf-karte-hub .kv-map-wrap')
  let el = wrap?.querySelector('.leute-panel')
  knopfStatus()
  if (!an) { if (el) regelGesehen = true; el?.remove(); return }
  if (!wrap) return
  if (!el) {
    el = document.createElement('div')
    el.className = 'leute-panel'
    wrap.appendChild(el)
    el.addEventListener('click', async (e) => {
      const zu = e.target.closest('[data-leute-zu]')
      if (zu) { zustand.freunde = false; ansichtMerken(); knopfStatus(); panelUmschalten(false); aktualisieren(); return }
      const v = e.target.closest('[data-verbergen]')
      if (v) { await verbergenUmschalten(v.dataset.verbergen); liste(); return }
      const m = e.target.closest('[data-teilen]')
      if (m) { await teilenSetzen(m.dataset.teilen); liste(); aktualisieren(); return }
      const p = e.target.closest('[data-person]')
      if (p) {
        const d = zustand.freundesListe.find((x) => x.username === p.dataset.person)
        if (d) { getHubMap()?.flyTo({ center: [d.lng, d.lat], zoom: Math.max(getHubMap().getZoom(), 13), duration: 800 }); zeigeInfo(d) }
      }
    })
  }
  liste()
}

async function liste() {
  const el = document.querySelector('.konf-karte-hub .leute-panel')
  if (!el) return
  const modus = teilenModus()
  const c = getUserCoords()
  let freundeNamen = []
  try { freundeNamen = (await import('./community-api.js')).getFriends() || [] } catch {}
  if (zustand.demo) freundeNamen = [...zustand.freundesListe.map((p) => p.username), 'tom']
  const mitPos = new Map(zustand.freundesListe.map((p) => [p.username, p]))
  const versteckt = new Set(verborgen())
  const zeilen = freundeNamen
    .map((u) => mitPos.get(u) || { username: u, name: u, ohne: true })
    .sort((a, b) => (a.ohne - b.ohne) || new Date(b.zeit || 0) - new Date(a.zeit || 0))
  const ERKL = {
    aus: { siehst: 'Niemanden', sehen: 'Niemand' },
    freunde: { siehst: 'Nur deine Freunde', sehen: 'Freunde mit offenem Auge' },
    oeffentlich: { siehst: 'Freunde + Fahrer in der Nähe', sehen: 'Freunde genau, andere ~1 km' },
  }[modus]
  const zeile = (p, mitAuge) => {
    const km = !p.ohne && c.lat != null ? haversineKm(c.lat, c.lng, p.lat, p.lng) : null
    const vers = versteckt.has(p.username)
    return `<li>
      <button type="button" class="leute-liste-person" ${p.ohne ? 'disabled' : `data-person="${esc(p.username)}"`}>
        <span class="leute-liste-bild" data-bild="${esc(p.username)}">${avatarHtml(p)}</span>
        <span class="leute-liste-text"><strong>${esc(p.name)}</strong><em>${p.ohne ? 'Teilt keinen Standort' : `${p.unterwegs ? 'Fährt gerade · ' : ''}${vor(p.zeit)}`}${km != null ? ` · ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km` : ''}</em></span>
      </button>
      ${mitAuge ? `<button type="button" class="leute-auge" data-verbergen="${esc(p.username)}" aria-pressed="${vers}" title="${vers ? `${esc(p.name)} sieht dich nicht – tippen zum Zeigen` : `${esc(p.name)} sieht dich – tippen zum Verbergen`}">${vers ? ICON.zu : ICON.auge}<span>${vers ? 'Verborgen' : 'Sieht dich'}</span></button>` : ''}
    </li>`
  }
  let inhalt = ''
  if (!angemeldet() && !zustand.demo) inhalt = '<p class="leute-hinweis">Melde dich an, um deinen Standort mit Freunden zu teilen.</p>'
  else if (modus === 'aus') inhalt = '<p class="leute-hinweis">Du bist unsichtbar. Wähle „Freunde“ oder „Öffentlich“, um andere zu sehen. Gesehen wirst du nur, wenn du selbst teilst.</p>'
  else if (zustand.fehler === 'fehlt') inhalt = '<p class="leute-hinweis">Standorte sind noch nicht eingerichtet. Gleich wieder da.</p>'
  else if (zustand.fehler === 'netz') inhalt = '<p class="leute-hinweis">Gerade keine Verbindung.</p>'
  else {
    inhalt = `<div class="leute-abschnitt">Deine Freunde${zeilen.length ? ` <span>Auge = sieht dich</span>` : ''}</div>`
      + (zeilen.length ? `<ul class="leute-liste">${zeilen.map((p) => zeile(p, true)).join('')}</ul>`
        : '<p class="leute-hinweis">Noch keine Freunde. Füge in der Community Fahrer als Freunde hinzu.</p>')
    if (modus === 'oeffentlich') {
      const nah = zustand.naheListe
      inhalt += `<div class="leute-abschnitt">In der Nähe <span>${nah.length ? `${nah.length} im Kartenausschnitt` : 'gerade niemand'}</span></div>`
        + (nah.length ? `<ul class="leute-liste">${nah.slice(0, 20).map((p) => zeile(p, false)).join('')}</ul>` : '')
    }
  }
  el.innerHTML = `
    <div class="leute-kopf"><strong>Standort</strong><button type="button" class="leute-zu" data-leute-zu aria-label="Schließen">×</button></div>
    <div class="leute-modi" role="radiogroup" aria-label="Standort-Modus">
      <button type="button" role="radio" data-teilen="aus" aria-checked="${modus === 'aus'}">${ICON.zu}<span>Unsichtbar</span></button>
      <button type="button" role="radio" data-teilen="freunde" aria-checked="${modus === 'freunde'}">${ICON.freunde}<span>Freunde</span></button>
      <button type="button" role="radio" data-teilen="oeffentlich" aria-checked="${modus === 'oeffentlich'}">${ICON.welt}<span>Öffentlich</span></button>
    </div>
    ${regelGesehen ? '' : `<dl class="leute-regel leute-regel--${modus}">
      <div><dt>Du siehst</dt><dd>${ERKL.siehst}</dd></div>
      <div><dt>Dich sieht</dt><dd>${ERKL.sehen}</dd></div>
    </dl>`}
    ${inhalt}
    ${modus !== 'aus' ? '<p class="leute-fuss">Geteilt wird nur, solange MotoMatch offen ist.</p>' : ''}`
  zeilen.push(...(modus === 'oeffentlich' ? zustand.naheListe : []))
  for (const p of zeilen) {
    bildVon(p.username).then((b) => {
      const z = el.querySelector(`[data-bild="${CSS.escape(p.username)}"]`)
      if (z && b.bild) z.innerHTML = avatarHtml({ ...p, bild: b.bild })
    })
  }
}

// ── Start ────────────────────────────────────────────────────────────────

let gestartet = false
/** Einmal nach dem Laden der Karte aufrufen (karte.js). */
export function leuteStarten() {
  knoepfe()
  if (gestartet) { aktualisieren(); return }
  gestartet = true
  const a = lesen(ANSICHT_KEY, {})
  zustand.freunde = !!a.freunde
  knopfStatus()
  teilenStarten()
  getHubMap()?.on('moveend', () => { if (teilenModus() === 'oeffentlich') aktualisieren() })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) aktualisieren() })
  zustand.timer = setInterval(aktualisieren, ABFRAGE_MS)
  aktualisieren()
}

// Nur im Dev-Server: Darstellung ohne Anmeldung prüfen
if (import.meta.env.DEV) {
  window.__mmLeute = {
    zeigen(personen, eigenes) {
      zustand.demo = true
      zustand.freundesListe = personen.filter((p) => p.freund)
      zustand.naheListe = personen.filter((p) => !p.freund)
      zeichnen(personen)
      if (eigenes) {
        const el = document.querySelector('.mm-standort-punkt')
        if (el) { el.classList.add('mm-standort-punkt--avatar'); el.innerHTML = `<span class="mm-standort-bild">${avatarHtml(eigenes)}</span>` }
      }
    },
    panel: () => panelUmschalten(true),
    info: (i) => zeigeInfo([...zustand.personen.values()][i]?.daten),
  }
}
