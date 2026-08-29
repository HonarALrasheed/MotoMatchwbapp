const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ESC_MAP[c])
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
