/* ═══════════════════════════════════════════════════
   STRECKEN-VORSCHAU — echte Kartenausschnitte statt Fotos.

   Ein unsichtbarer MapLibre-Renderer zeichnet für jede Strecke einmal den
   passenden Kartenausschnitt (gleicher Stil wie die große Karte) und legt das
   Bild im Browser-Cache ab. Die Linie selbst ist ein SVG darüber: so lässt
   sie sich animieren und bleibt gestochen scharf. Ausschnitt und Linie
   rechnen mit derselben Web-Mercator-Projektion, deshalb passen sie exakt.

   Nutzung:
     vorschauBeobachten(wurzel, quelle)   füllt alle [data-vorschau] in wurzel,
                                           sobald sie sichtbar werden;
                                           quelle(id) → { pts, typ }
   Markup:  <div data-vorschau="<id>" data-art="quadrat|breit" [data-animiert]>
   ═══════════════════════════════════════════════════ */

import { ladeMapLibre, ladeKartenStil, umleiten, getHubMap } from './karte.js'

const VERSION = 'v2' // bei Stiländerungen hochzählen, dann werden alle Bilder neu gezeichnet
const CACHE = 'mm-vorschau'
const GROESSE = { quadrat: [176, 176], breit: [400, 210] }
const RAND = 0.13 // Anteil Rand um die Strecke
const MAX_ZOOM = 14

const speicher = new Map() // schlüssel → Promise<objectURL>
let renderer = null // { map, el }
let rendererBereit = null
let kette = Promise.resolve()
let aufraeumen = null

// ── Projektion ───────────────────────────────────────────────────────────

const merc = ([lat, lng]) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]
}
const unmerc = ([x, y]) => [
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  x * 360 - 180,
]

/** Kamera und Linienpfad für einen Ausschnitt w×h (CSS-Pixel). */
export function ausschnitt(pts, w, h) {
  const m = pts.map(merc)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of m) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const rx = w * (1 - 2 * RAND), ry = h * (1 - 2 * RAND)
  let s = Math.min(rx / Math.max(x1 - x0, 1e-9), ry / Math.max(y1 - y0, 1e-9)) // px je Welteinheit
  let zoom = Math.log2(s / 512)
  if (zoom > MAX_ZOOM) { zoom = MAX_ZOOM; s = 512 * 2 ** MAX_ZOOM }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const [lat, lng] = unmerc([cx, cy])
  // Pfad ausdünnen: höchstens ein Punkt je 1,5 px
  const xy = []
  let lx = -99, ly = -99
  m.forEach(([x, y], i) => {
    const px = (x - cx) * s + w / 2, py = (y - cy) * s + h / 2
    if (i === 0 || i === m.length - 1 || Math.abs(px - lx) + Math.abs(py - ly) > 1.5) { xy.push([px, py]); lx = px; ly = py }
  })
  return { center: [lng, lat], zoom, xy }
}

// ── Renderer ─────────────────────────────────────────────────────────────

/** Erst die große Karte fertig laden lassen — die Vorschaubilder holen dieselben
    Kacheln und würden ihr sonst die Leitung wegnehmen. */
async function hauptkarteFertig(ms = 8000) {
  const ende = Date.now() + ms
  // Die große Karte entsteht evtl. erst gleich — so lange warten
  while (!getHubMap()?.__mmBereit && Date.now() < ende) await new Promise((r) => setTimeout(r, 150))
  const haupt = getHubMap()
  if (!haupt || (haupt.loaded() && haupt.areTilesLoaded())) return
  await new Promise((ok) => {
    const t = setTimeout(ok, Math.max(0, ende - Date.now()))
    haupt.once('idle', () => { clearTimeout(t); ok() })
  })
}

async function holeRenderer() {
  if (renderer) return renderer
  if (!rendererBereit) {
    rendererBereit = (async () => {
      await hauptkarteFertig()
      const [ml, stil] = await Promise.all([ladeMapLibre(), ladeKartenStil()])
      // Ohne Relief und Satellit: Auf den kleinen Bildern sieht man die Schummerung
      // kaum, sie kostete aber ~14 Höhenbilder je Vorschau (je ~130 KB).
      stil.layers = stil.layers.filter((l) => l.type !== 'hillshade' && l.source !== 'satellit')
      for (const q of ['gelaende', 'gelaende-3d', 'satellit']) delete stil.sources[q]
      const el = document.createElement('div')
      el.setAttribute('aria-hidden', 'true')
      el.style.cssText = 'position:fixed;left:-10000px;top:0;width:400px;height:210px;pointer-events:none;'
      document.body.appendChild(el)
      const map = new ml.Map({
        container: el, style: stil, interactive: false, attributionControl: false,
        transformRequest: umleiten, pixelRatio: 2, fadeDuration: 0,
        canvasContextAttributes: { preserveDrawingBuffer: true },
        center: [10.4, 51.1], zoom: 5,
      })
      await new Promise((ok) => map.once('load', ok))
      renderer = { map, el }
      return renderer
    })().catch((err) => { rendererBereit = null; throw err })
  }
  return rendererBereit
}

/** Unbenutzten Renderer nach einer Weile freigeben (WebGL-Speicher auf dem Handy). */
function spaeterAufraeumen() {
  clearTimeout(aufraeumen)
  aufraeumen = setTimeout(() => {
    if (!renderer) return
    renderer.map.remove(); renderer.el.remove()
    renderer = null; rendererBereit = null
  }, 45_000)
}

function warteAufFertig(map, ms = 8000) {
  return new Promise((ok) => {
    const t = setTimeout(ok, ms)
    const pruefen = () => { if (map.loaded() && map.areTilesLoaded()) { clearTimeout(t); ok() } else map.once('idle', pruefen) }
    map.once('idle', pruefen)
    map.triggerRepaint()
  })
}

async function zeichneBild(pts, art) {
  const [w, h] = GROESSE[art]
  const { map, el } = await holeRenderer()
  el.style.width = `${w}px`; el.style.height = `${h}px`
  map.resize()
  const a = ausschnitt(pts, w, h)
  map.jumpTo({ center: a.center, zoom: a.zoom, bearing: 0, pitch: 0 })
  await warteAufFertig(map)
  const blob = await new Promise((ok) => map.getCanvas().toBlob(ok, 'image/webp', 0.82))
  spaeterAufraeumen()
  return blob
}

async function ausCache(schluessel) {
  try {
    const c = await caches.open(CACHE)
    const r = await c.match(`/__vorschau/${schluessel}`)
    return r ? await r.blob() : null
  } catch { return null }
}
async function inCache(schluessel, blob) {
  try { await (await caches.open(CACHE)).put(`/__vorschau/${schluessel}`, new Response(blob, { headers: { 'Content-Type': blob.type } })) } catch {}
}

/** Bild-URL des Kartenausschnitts (aus dem Cache oder frisch gezeichnet). */
export function vorschauBild(id, pts, art = 'quadrat') {
  const schluessel = `${VERSION}-${art}-${id}`
  if (!speicher.has(schluessel)) {
    const p = (async () => {
      let blob = await ausCache(schluessel)
      if (!blob) {
        // Nacheinander zeichnen — ein Renderer für alle
        const auftrag = kette.then(() => zeichneBild(pts, art))
        kette = auftrag.catch(() => {})
        blob = await auftrag
        if (!blob) throw new Error('Vorschau leer')
        inCache(schluessel, blob)
      }
      return URL.createObjectURL(blob)
    })()
    p.catch(() => speicher.delete(schluessel))
    speicher.set(schluessel, p)
  }
  return speicher.get(schluessel)
}

// ── Einsetzen ins Markup ─────────────────────────────────────────────────

/** Linie als SVG über dem Bild; animiert = zeichnet sich ab dem Start nach. */
function linienSvg(pts, art, typ, animiert) {
  const [w, h] = GROESSE[art]
  const { xy } = ausschnitt(pts, w, h)
  const d = 'M' + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')
  const [sx, sy] = xy[0], [zx, zy] = xy[xy.length - 1]
  const breit = art === 'breit'
  return `<svg class="vs-linie${animiert ? ' vs-linie--animiert' : ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <path d="${d}" class="vs-rand" pathLength="1000" style="stroke-width:${breit ? 6.5 : 6}"/>
    <path d="${d}" class="vs-strich" pathLength="1000" style="stroke-width:${breit ? 3.6 : 3.4}"/>
    ${typ === 'strecke' ? `<circle cx="${zx.toFixed(1)}" cy="${zy.toFixed(1)}" r="${breit ? 5 : 4.6}" class="vs-ziel"/>` : ''}
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${breit ? 5.5 : 5}" class="vs-start"/>
  </svg>`
}

async function fuellen(el, quelle) {
  const id = el.dataset.vorschau
  const q = quelle(id)
  if (!q?.pts?.length) return
  const art = el.dataset.art === 'breit' ? 'breit' : 'quadrat'
  el.dataset.vorschauStatus = 'laedt'
  try {
    const url = await vorschauBild(id, q.pts, art)
    if (!el.isConnected) return
    el.querySelector('.vs-karte')?.remove()
    const img = new Image()
    img.className = 'vs-karte'
    img.alt = ''
    img.decoding = 'async'
    img.src = url
    await img.decode().catch(() => {})
    if (!el.isConnected) return
    // Gezeichnete Landschaft (Platzhalter) durch Karte + Linie ersetzen
    el.querySelector('.tour-landschaft')?.remove()
    el.querySelector('.vs-linie')?.remove()
    el.insertAdjacentHTML('afterbegin', linienSvg(q.pts, art, q.typ, el.hasAttribute('data-animiert')))
    el.prepend(img)
    el.dataset.vorschauStatus = 'fertig'
  } catch (err) {
    el.dataset.vorschauStatus = 'fehler'
    console.warn('[vorschau]', id, err)
  }
}

let beobachter = null
const quellen = new WeakMap()

/** Alle [data-vorschau] in wurzel füllen, sobald sie in Sichtweite kommen. */
export function vorschauBeobachten(wurzel, quelle) {
  if (!wurzel) return
  if (!('IntersectionObserver' in window)) {
    wurzel.querySelectorAll('[data-vorschau]').forEach((el) => fuellen(el, quelle))
    return
  }
  beobachter ||= new IntersectionObserver((eintraege) => {
    for (const e of eintraege) {
      if (!e.isIntersecting) continue
      beobachter.unobserve(e.target)
      const q = quellen.get(e.target)
      if (q) fuellen(e.target, q)
    }
  }, { rootMargin: '200px 200px' })
  wurzel.querySelectorAll('[data-vorschau]:not([data-vorschau-status])').forEach((el) => {
    quellen.set(el, quelle)
    beobachter.observe(el)
  })
}
