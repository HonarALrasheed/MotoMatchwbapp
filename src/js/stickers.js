/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — Sticker (KLIPY)
 *
 *  Liefert echte Bild-Sticker (animierte, freigestellte Grafiken).
 *
 *  Warum KLIPY und nicht Tenor: Google hat die Tenor-API am 30.06.2026
 *  abgeschaltet und seit 13.01.2026 keine neuen Keys mehr vergeben. KLIPY ist
 *  der Dienst, zu dem WhatsApp, Discord, Canva und Figma gewechselt sind.
 *
 *  Ohne VITE_KLIPY_KEY ist HAS_STICKER_API false — die Community faellt dann
 *  auf die eingebauten Emoji-Sticker zurueck, statt leere Raster zu zeigen.
 * ══════════════════════════════════════════════════════════════════
 */

const KEY = import.meta.env.VITE_KLIPY_KEY || ''
const BASE = 'https://api.klipy.com/api/v1'

export const HAS_STICKER_API = !!KEY

/* KLIPY erwartet eine stabile Kennung pro Nutzer (Empfehlungen, "Zuletzt
   benutzt"). Kein Login noetig — eine zufaellige, lokal gemerkte ID reicht. */
const LS_CUSTOMER = 'mm_klipy_customer_v1'
function customerId() {
  try {
    let id = localStorage.getItem(LS_CUSTOMER)
    if (!id) { id = 'mm-' + Math.random().toString(36).slice(2, 12); localStorage.setItem(LS_CUSTOMER, id) }
    return id
  } catch { return 'mm-anon' }
}

/* Antworten kurz vorhalten: Tippen loest schnell mehrere gleiche Suchen aus. */
const _cache = new Map()
const CACHE_MAX = 60
function _cacheSet(k, v) {
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value)
  _cache.set(k, v)
}

/* KLIPY liefert jede Datei in vier Groessen und vier Formaten:
   file.{hd,md,sm,xs}.{gif,webp,webm,png}. webp ist animiert und am kleinsten,
   webm taugt nicht fuer <img>, png ist nur ein Standbild. */
const SIZE_PREVIEW = ['xs', 'sm', 'md', 'hd']
const SIZE_FULL    = ['md', 'hd', 'sm', 'xs']
const FORMATS      = ['webp', 'gif']   // animiert; png waere nur ein Standbild

function _pick(file, sizes, formats) {
  for (const sz of sizes) {
    const bucket = file?.[sz]
    if (!bucket) continue
    for (const fmt of formats) {
      const f = bucket[fmt]
      if (f?.url) return { url: f.url, w: Number(f.width) || 0, h: Number(f.height) || 0 }
    }
  }
  return null
}

/**
 * Rueckfallebene, falls KLIPY die Verschachtelung aendert: rekursiv nach
 * {url,width,height}-Blaettern suchen. Ohne das waere ein Formatwechsel ein
 * leerer Picker statt nur schlechter gewaehlter Groessen.
 */
function _anyFile(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (typeof node.url === 'string') {
    if (!/\.(mp4|webm)(\?|$)/i.test(node.url)) {
      out.push({ url: node.url, w: Number(node.width) || 0, h: Number(node.height) || 0 })
    }
    return out
  }
  for (const v of Object.values(node)) _anyFile(v, out)
  return out
}

/** KLIPY-Ergebnis auf das reduzieren, was die UI braucht. */
function _map(item) {
  const file = item.file || item.files
  let preview = _pick(file, SIZE_PREVIEW, FORMATS)
  let full    = _pick(file, SIZE_FULL, FORMATS)

  if (!preview || !full) {
    const all = _anyFile(file).sort((a, b) => (a.w * a.h) - (b.w * b.h))
    if (!all.length) return null
    preview ||= all[0]
    full    ||= all[all.length - 1]
  }
  return {
    id: String(item.id ?? item.slug ?? full.url),
    preview: preview.url,
    url: full.url,
    desc: item.title || item.slug || 'Sticker',
    w: full.w,
    h: full.h,
  }
}

async function _get(path, params = {}) {
  if (!HAS_STICKER_API) return []
  const qs = new URLSearchParams({
    customer_id: customerId(),
    per_page: '24',
    page: '1',
    ...params,
  })
  const url = `${BASE}/${KEY}/stickers/${path}?${qs}`
  const hit = _cache.get(url)
  if (hit) return hit

  try {
    const res = await fetch(url)
    if (!res.ok) { console.warn('[KLIPY]', res.status, await res.text()); return [] }
    const json = await res.json()
    // Umschlag: { result, data: { data: [...] } } — beide Ebenen absichern,
    // damit ein Formatwechsel nicht in einen TypeError laeuft.
    const items = json?.data?.data || json?.data || []
    const list = (Array.isArray(items) ? items : []).map(_map).filter(Boolean)
    _cacheSet(url, list)
    return list
  } catch (e) {
    console.warn('[KLIPY] Anfrage fehlgeschlagen:', e?.message)
    return []
  }
}

/** Sticker zu einem Suchbegriff. */
export function searchStickerApi(query, limit = 24) {
  const q = query.trim()
  if (!q) return Promise.resolve([])
  return _get('search', { q, per_page: String(limit) })
}

/** Aktuell beliebte Sticker — Startansicht des Pickers. */
export function trendingStickerApi(limit = 24) {
  return _get('trending', { per_page: String(limit) })
}
