/* ═══════════════════════════════════════════════════
   HEIKO — die Stimme des Navis.

   "Hei-ko" wie "heimkommen": Er erinnert daran, vorsichtig zu fahren, weil
   zu Hause jemand wartet. Die Ansagen sind vorab mit einer freien neuronalen
   Stimme eingesprochen (public/stimme/heiko/, gebaut von scripts/stimme/bauen.py
   aus src/js/stimme-saetze.json) und klingen auf jedem Gerät gleich menschlich.
   Fehlt eine Ansage (oder der ganze Ordner), spricht die beste Stimme des
   Geräts den Text — Straßennamen gibt es nur dort, die Bildschirmanzeige
   nennt sie ohnehin.
   ═══════════════════════════════════════════════════ */

import SAETZE from './stimme-saetze.json'

export const PERSONA = {
  name: 'Heiko',
  zeile: 'Hei-ko wie heimkommen: Er bringt dich sicher ans Ziel und wieder nach Hause.',
}

const ORDNER = '/stimme/heiko/'
const WARTET_KEY = 'mm_wartet_auf_dich_v1'

/** Wer zu Hause wartet (frei eingegeben, nur lokal gespeichert). */
export function wartetAufDich() {
  try { return (localStorage.getItem(WARTET_KEY) || '').trim().slice(0, 40) } catch { return '' }
}
export function wartetSetzen(name) {
  try {
    const n = (name || '').trim().slice(0, 40)
    if (n) localStorage.setItem(WARTET_KEY, n)
    else localStorage.removeItem(WARTET_KEY)
  } catch {}
}

// ── Sätze ────────────────────────────────────────────────────────────────

const RICHTUNG_KEY = { left: 'links', right: 'rechts', 'slight left': 'leicht-links', 'slight right': 'leicht-rechts', 'sharp left': 'scharf-links', 'sharp right': 'scharf-rechts' }
const seite = (richtung) => (/left/.test(richtung) ? 'links' : /right/.test(richtung) ? 'rechts' : null)

/** Ansage-Schlüssel für einen Navi-Schritt [m, art, richtung, strasse, ausfahrt]. */
export function manoever([, art, richtung, , ausfahrt]) {
  switch (art) {
    case 'arrive': return 'ziel'
    case 'waypoint': return 'start-tour'
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return ausfahrt >= 1 && ausfahrt <= 6 ? `kreisel-${ausfahrt}` : 'kreisel'
    case 'exit roundabout': case 'exit rotary': return 'kreisel-raus'
    case 'merge': return 'einfaedeln'
    case 'on ramp': return 'auffahrt'
    case 'off ramp': return seite(richtung) ? `ausfahrt-${seite(richtung)}` : null
    case 'fork': return seite(richtung) ? `gabel-${seite(richtung)}` : null
    case 'end of road': return seite(richtung) ? `ende-${seite(richtung)}` : null
    default:
      if (richtung === 'uturn') return 'wenden'
      if (RICHTUNG_KEY[richtung]) return `abbiegen-${RICHTUNG_KEY[richtung]}`
      return 'geradeaus'
  }
}

/** Text zu einem Schlüssel ("800-abbiegen-links", "abbiegen-links", "hallo"). */
export function satzText(schluessel) {
  if (SAETZE.einzeln[schluessel]) return SAETZE.einzeln[schluessel]
  const [, ab, rest] = schluessel.match(/^(\d+)-(.+)$/) || [null, null, schluessel]
  const m = SAETZE.manoever[rest]
  if (!m) return null
  if (ab && SAETZE.abstaende[ab]) return `${SAETZE.abstaende[ab]} ${m}.`
  return `${m.charAt(0).toUpperCase()}${m.slice(1)}.`
}

/** Alle Schlüssel, die eingesprochen werden (für das Bau-Skript und Tests). */
export function alleSchluessel() {
  const liste = Object.keys(SAETZE.einzeln)
  for (const m of Object.keys(SAETZE.manoever)) {
    if (m !== 'ziel' && m !== 'start-tour') liste.push(m)
    for (const ab of Object.keys(SAETZE.abstaende)) liste.push(`${ab}-${m}`)
  }
  return liste
}

// ── Eingesprochene Ansagen ───────────────────────────────────────────────

let verzeichnis = null // Promise<Set<schluessel>> — leer, wenn es keine gibt
function ansagen() {
  verzeichnis ||= fetch(`${ORDNER}index.json`)
    .then((r) => (r.ok ? r.json() : { dateien: [] }))
    .then((j) => new Set(j.dateien || []))
    .catch(() => new Set())
  return verzeichnis
}

let spieler = null
/** Muss in einer Nutzer-Geste laufen (Start-Knopf) — sonst bleibt iOS stumm. */
let vorgeladen = false
export function stimmeEntsperren() {
  // Alle Ansagen einmal holen — der Service Worker legt sie für Funklöcher ab
  ansagen().then((da) => {
    if (vorgeladen || !da.size) return
    vorgeladen = true
    for (const k of da) fetch(`${ORDNER}${k}.m4a`, { priority: 'low' }).catch(() => {})
  })
  try {
    spieler ||= new Audio()
    spieler.preload = 'auto'
    // Ein stilles Stück abspielen gibt das Element für spätere Ansagen frei
    spieler.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
    spieler.play().catch(() => {})
  } catch {}
  besteStimme()
}

// ── Gerätestimme als Rückfall ────────────────────────────────────────────

/* Neuronale/Premium-Stimmen zuerst, die Spaßstimmen von macOS/iOS (Grandpa,
   Rocko …) nie. Männliche Stimmen leicht bevorzugt, weil Heiko ein Mann ist. */
const SPASS = /eddy|flo\b|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy/i
function punkte(v) {
  let p = 0
  if (/natural|neural|online/i.test(v.name)) p += 60
  if (/premium|enhanced|erweitert|siri/i.test(v.name)) p += 45
  if (/google/i.test(v.name)) p += 25
  if (/markus|yannick|martin|viktor|conrad|killian|stefan|jonas|ralf|florian|bernd/i.test(v.name)) p += 12
  if (/anna|petra|helena|katja|amala|hedda|vicki/i.test(v.name)) p += 6
  if (/^de[-_]DE/i.test(v.lang)) p += 5
  if (SPASS.test(v.name)) p -= 200
  return p
}
let geraeteStimme = null
function besteStimme() {
  if (!('speechSynthesis' in window)) return null
  const de = speechSynthesis.getVoices().filter((v) => /^de([-_]|$)/i.test(v.lang))
  if (de.length) geraeteStimme = de.sort((a, b) => punkte(b) - punkte(a))[0]
  return geraeteStimme
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try { speechSynthesis.addEventListener('voiceschanged', besteStimme) } catch {}
}

/** Gerätestimme; löst nach dem Satz auf (oder sofort, wenn es keine gibt). */
function geraetSpricht(text) {
  return new Promise((fertig) => {
    if (!('speechSynthesis' in window) || !text) return fertig()
    try {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'de-DE'
      const v = geraeteStimme || besteStimme()
      if (v) u.voice = v
      u.rate = 1
      u.pitch = 1
      u.onend = u.onerror = () => fertig()
      speechSynthesis.speak(u)
      setTimeout(fertig, 15000) // manche Browser melden das Ende nie
    } catch { fertig() }
  })
}

/** Eingesprochene Ansage abspielen; löst nach dem Ende auf. */
function abspielen(schluessel) {
  return new Promise((fertig, fehler) => {
    spieler ||= new Audio()
    const ende = () => { spieler.onended = spieler.onerror = spieler.onpause = null; fertig() }
    spieler.onended = spieler.onpause = ende
    spieler.onerror = () => { spieler.onended = spieler.onerror = spieler.onpause = null; fehler(new Error('Ansage fehlt')) }
    spieler.src = `${ORDNER}${schluessel}.m4a`
    spieler.play().catch(fehler)
  })
}

// ── Sprechen ─────────────────────────────────────────────────────────────

let nummer = 0
let kette = Promise.resolve()

/**
 * Eine Ansage. Ohne anhaengen unterbricht sie, was gerade läuft.
 * @param {string|null} schluessel  eingesprochene Ansage, falls vorhanden
 * @param {string|null} [text]      Text für die Gerätestimme (mit Straßennamen)
 */
export function sage(schluessel, text, { anhaengen = false } = {}) {
  if (!anhaengen) verstummen()
  const meine = nummer
  const los = async () => {
    if (meine !== nummer) return
    const da = schluessel ? await ansagen() : new Set()
    if (meine !== nummer) return
    if (schluessel && da.has(schluessel)) {
      try { await abspielen(schluessel); return } catch {}
      if (meine !== nummer) return
    }
    await geraetSpricht(text || (schluessel && satzText(schluessel)) || '')
  }
  kette = (anhaengen ? kette : Promise.resolve()).then(los, los)
  return kette
}

export function verstummen() {
  nummer++
  try { spieler?.pause() } catch {} // löst die laufende Ansage über onpause auf
  try { speechSynthesis.cancel() } catch {}
}
