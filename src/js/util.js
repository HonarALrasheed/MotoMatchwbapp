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
