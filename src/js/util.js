const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ESC_MAP[c])
}
