const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ESC_MAP[c])
}

/**
 * Schwesterfunktion zu esc() fuer URLs, die in ein href oder src gehen.
 *
 * esc() maskiert Zeichen — ein Schema ueberlebt das unbeschadet: aus
 * `javascript:alert(1)` wird durch esc() nichts Harmloses, das Attribut bleibt
 * syntaktisch heil und der Klick fuehrt Code aus. Deshalb hier eine Whitelist
 * der Schemata, die die App selbst erzeugt:
 *   - http:/https:  — oeffentliche Bucket-Dateien (chat-attachments), Sticker-CDN
 *   - data:image/   — Offline-Modus und Profilbilder (base64 aus dem FileReader)
 *   - ohne Schema   — relative Pfade wie /bikes/x.png; koennen die Herkunft
 *                     nicht verlassen und sind darum unbedenklich
 * Alles andere (javascript:, vbscript:, data:text/html, file: …) ergibt null.
 *
 * Rueckgabe ist die *bereinigte* URL, nicht die urspruengliche: geprueft und
 * ausgegeben werden muss derselbe String, sonst sieht der Browser etwas
 * anderes als die Pruefung. Was bei null passiert, entscheidet der Aufrufer —
 * meist: das Element gar nicht erst rendern.
 *
 * @param {unknown} url
 * @returns {string|null}
 */
export function safeUrl(url) {
  if (typeof url !== 'string') return null
  // Der Browser wirft beim URL-Parsen Tab/CR/LF an *jeder* Stelle weg und
  // schneidet fuehrende/abschliessende Steuerzeichen ab. Ein Tabulator mitten im
  // Schema ("java<TAB>script:") ist fuer ihn also "javascript:". Genau dieselbe
  // Normalisierung hier, sonst pruefen wir eine Zeichenkette, die es im DOM
  // so nie gibt.
  const u = url.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
  if (!u) return null

  const m = /^([a-z][a-z0-9+.\-]*):/i.exec(u)
  if (!m) return u                       // kein Schema → relativ → ungefaehrlich
  const scheme = m[1].toLowerCase()
  if (scheme === 'http' || scheme === 'https') return u
  if (scheme === 'data') return /^data:image\//i.test(u) ? u : null
  return null
}

/** Datum im Listen-Format — "23. Aug. 2026". */
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Relative Zeit für Chroniken — "Gerade eben" / "vor 3 Std." / "Gestern" / Datum. */
export function fmtRelative(ts) {
  if (!ts) return ''
  const diffMs = Date.now() - ts
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'Gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std.`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Gestern'
  if (d < 7) return `vor ${d} Tagen`
  return fmtDate(ts)
}

/* ── Quiz-Antworten: localStorage-Schluessel ────────────────────── */

/**
 * Fuehrerscheinklasse, Fahrerfahrung, Budget, Koerpergroesse und
 * Beifahrer-Angabe. Hiess frueher 'motoMatchAnswers' und war damit der
 * einzige Schluessel ohne mm_-Praefix — "Alle lokalen Daten loeschen" und der
 * Datenexport im Konto arbeiten beide ueber mm_*, der Datensatz ueberlebte
 * also das Loeschen und fehlte im Export.
 */
export const LS_QUIZ_ANSWERS = 'mm_quiz_answers_v1'
const LS_QUIZ_ANSWERS_LEGACY = 'motoMatchAnswers'

/**
 * Einmalige Uebernahme des alten Schluessels — wer vor dieser Version ein
 * Quiz gemacht hat, soll seine Antworten behalten. Laeuft beim Laden des
 * Moduls, damit sie vor jedem Lesezugriff steht (util.js wird von allen
 * lesenden Modulen importiert); der alte Schluessel wird danach entfernt,
 * sonst bliebe genau der Datensatz liegen, um den es hier geht.
 */
function migrateQuizAnswersKey() {
  try {
    const legacy = localStorage.getItem(LS_QUIZ_ANSWERS_LEGACY)
    if (legacy === null) return
    if (localStorage.getItem(LS_QUIZ_ANSWERS) === null) {
      localStorage.setItem(LS_QUIZ_ANSWERS, legacy)
    }
    localStorage.removeItem(LS_QUIZ_ANSWERS_LEGACY)
  } catch {}
}
migrateQuizAnswersKey()
