/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — match-history.js
 *  Chronik der Matches: welches Bike wann mit welchem Score getroffen
 *  wurde. Bewusst getrennt von `mm_recent_bikes_v1` (reine Ansichts-
 *  Chronik) und `mm_owned_bikes_v1` (Besitz) — ein Match ist eine
 *  Empfehlung, kein Besuch und kein Eigentum.
 *
 *  Gefüllt wird die Liste an zwei Stellen:
 *    - automatisch nach jedem Quiz (Sieger des Durchlaufs)
 *    - manuell über "Als Match merken" im Match-Reiter
 * ══════════════════════════════════════════════════════════════════
 */

const LS_KEY = 'mm_matches_v1'
const LS_ANSWERS = 'motoMatchAnswers' // von quiz.js geschrieben
const MAX_ENTRIES = 24

/**
 * Ein Eintrag:
 *   { name, style, image, price, score, pct, ts, source: 'quiz'|'manual' }
 * `name` ist immer der volle Katalogname ("Honda NR750") — er ist der
 * Schlüssel für Dedupe und zum Wiederauffinden im Katalog.
 */

function read() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw === null) return null // "noch nie initialisiert" ≠ "leer"
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function write(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES))) } catch {}
}

/**
 * Einmalige Übernahme des alten Einzelwerts `mm_primary_bike`: wer vor
 * dieser Version schon ein Quiz gemacht hat, findet seinen Treffer sonst
 * in einer leeren Liste nicht wieder.
 */
function migrateFromPrimaryBike() {
  let primary = null
  try { primary = localStorage.getItem('mm_primary_bike') } catch {}
  const seeded = primary
    ? [{ name: primary, style: '', image: '', price: '', score: null, pct: null, ts: Date.now(), source: 'legacy' }]
    : []
  write(seeded)
  return seeded
}

/** Alle Matches, neueste zuerst. */
export function getMatches() {
  const list = read()
  if (list === null) return migrateFromPrimaryBike()
  return list
}

export function hasMatch(name) {
  return getMatches().some(m => m.name === name)
}

/**
 * Legt ein Match an bzw. aktualisiert es. Ein erneuter Treffer desselben
 * Bikes rutscht nach oben und bekommt den frischen Score — statt die Liste
 * mit Dubletten zu füllen.
 * @returns der gespeicherte Eintrag
 */
export function addMatch(bike, { score = null, pct = null, source = 'manual' } = {}) {
  if (!bike?.name) return null
  const entry = {
    name: bike.name,
    style: bike.style || '',
    image: bike.image2 || bike.image || '',
    price: bike.priceDisplay || bike.price || '',
    score: score == null ? null : Math.round(score * 10) / 10,
    pct: pct == null ? null : Math.round(pct),
    ts: Date.now(),
    source,
  }
  write([entry, ...getMatches().filter(m => m.name !== entry.name)])
  return entry
}

/** @returns true, wenn tatsächlich etwas entfernt wurde */
export function removeMatch(name) {
  const list = getMatches()
  const next = list.filter(m => m.name !== name)
  if (next.length === list.length) return false
  write(next)
  return true
}

export function clearMatches() {
  write([])
}

/** Stellt einen gelöschten Eintrag an seiner alten Position wieder her (Undo). */
export function restoreMatch(entry, index = 0) {
  if (!entry?.name) return
  const list = getMatches().filter(m => m.name !== entry.name)
  list.splice(Math.max(0, Math.min(index, list.length)), 0, entry)
  write(list)
}

/** Die zuletzt im Quiz gegebenen Antworten — oder null, wenn nie gespielt. */
export function getLastAnswers() {
  try {
    const raw = localStorage.getItem(LS_ANSWERS)
    if (!raw) return null
    const answers = JSON.parse(raw)
    // Ohne Führerschein-Antwort (q1) ist ein Durchlauf nicht verwertbar —
    // das Quiz speichert nach jeder Frage, auch nach einem Abbruch.
    return answers && answers.q1 ? answers : null
  } catch { return null }
}

/* ─── Hauptbike ───
   `mm_primary_bike` steuert die "Dein Bike"-Verknüpfung auf der Startseite.
   Der Schlüssel wird hier gekapselt, damit der Match-Reiter ihn setzen kann,
   ohne den Namen erneut zu kennen. ─── */
export function getPrimaryBike() {
  try { return localStorage.getItem('mm_primary_bike') } catch { return null }
}

export function setPrimaryBike(name) {
  try {
    if (name) localStorage.setItem('mm_primary_bike', name)
    else localStorage.removeItem('mm_primary_bike')
  } catch {}
}
