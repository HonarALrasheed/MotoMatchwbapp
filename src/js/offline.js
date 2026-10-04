/* ═══════════════════════════════════════════════════
   OFFLINE-KARTE — Kacheln entlang einer Strecke vorladen.

   Beim Losfahren holt das Navi die Vektorkacheln im Korridor der Strecke
   (Zoom 10–14, darüber vergrößert MapLibre selbst). Der Service Worker
   (public/sw.js) legt sie ab und liefert sie im Funkloch aus.
   Eine Tour von 100 km sind etwa 250–350 Kacheln, rund 8–12 MB.
   ═══════════════════════════════════════════════════ */

const ZOOMS = [10, 11, 12, 13, 14]
const GLEICHZEITIG = 4

function kachel(lat, lng, z) {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const s = Math.sin((lat * Math.PI) / 180)
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)
  return [x, y]
}

/** Alle Kacheln im Korridor: unterhalb Zoom 14 mit Nachbarn, auf 14 nur die Linie selbst. */
export function kachelnEntlang(pts) {
  const menge = new Set()
  for (const z of ZOOMS) {
    const rand = z < 14 ? 1 : 0
    let vorher = null
    for (const [la, ln] of pts) {
      const [x, y] = kachel(la, ln, z)
      const k = `${x},${y}`
      if (k === vorher) continue
      vorher = k
      for (let dx = -rand; dx <= rand; dx++) for (let dy = -rand; dy <= rand; dy++) menge.add(`${z}/${x + dx}/${y + dy}`)
    }
  }
  return [...menge]
}

let laufend = null

/**
 * Kacheln entlang der Strecke vorladen.
 * @param {Array<[number, number]>} pts
 * @param {(fertig: number, gesamt: number) => void} [fortschritt]
 * @returns {Promise<{ geladen: number, gesamt: number } | null>}
 */
export async function vorladen(pts, fortschritt) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return null
  if (navigator.connection?.saveData) return null
  laufend?.abbrechen()
  let abgebrochen = false
  const lauf = { abbrechen: () => { abgebrochen = true } }
  laufend = lauf
  try {
    const tj = await (await fetch('/kacheln/planet')).json()
    const vorlage = (tj.tiles?.[0] || '').replace('https://tiles.openfreemap.org/', `${location.origin}/kacheln/`)
    if (!vorlage.includes('{z}')) return null
    const liste = kachelnEntlang(pts)
    let fertig = 0
    let i = 0
    const arbeiter = async () => {
      while (!abgebrochen && i < liste.length) {
        const [z, x, y] = liste[i++].split('/')
        try { await fetch(vorlage.replace('{z}', z).replace('{x}', x).replace('{y}', y)) } catch {}
        fertig++
        if (fertig % 10 === 0 || fertig === liste.length) fortschritt?.(fertig, liste.length)
      }
    }
    await Promise.all(Array.from({ length: GLEICHZEITIG }, arbeiter))
    return abgebrochen ? null : { geladen: fertig, gesamt: liste.length }
  } catch {
    return null
  } finally {
    if (laufend === lauf) laufend = null
  }
}

export function vorladenAbbrechen() { laufend?.abbrechen() }
