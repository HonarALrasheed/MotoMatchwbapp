/* ═══════════════════════════════════════════════════
   EIGENE STRECKEN — aufgezeichnet, geplant, importiert, geteilt.

   Alles bleibt auf dem Gerät:
   - Aufzeichnungen liegen im Fahrtenbuch (localStorage mm_rides_v1, Feld
     track — dasselbe Format wie im Profil, account.js/ride-tracker.js).
   - Geplante und importierte Strecken liegen in mm_strecken_v1.
   - Teilen ohne Server: die Strecke steckt (ausgedünnt, als Polyline) im
     Link selbst (#strecke=…). Wer ihn öffnet, bekommt sie in "Meine".

   Für Liste, Detail und Navi werden eigene Strecken in die Form der Touren
   gebracht (alsTour), damit touren.js sie genauso zeigt und fährt.
   ═══════════════════════════════════════════════════ */

import { haversineKm } from './karte.js'
import { kumuliert, ausduennen } from './routing.js'

const LS_STRECKEN = 'mm_strecken_v1'
const LS_RIDES = 'mm_rides_v1'
export const PRAEFIX = 'eigen:'

// ── Polyline (Präzision 1e-5) ────────────────────────────────────────────

export function kodieren(pts) {
  let out = '', plat = 0, plng = 0
  for (const [la, ln] of pts) {
    for (const [wert, vorher] of [[Math.round(la * 1e5), plat], [Math.round(ln * 1e5), plng]]) {
      let v = wert - vorher
      v = v < 0 ? ~(v << 1) : v << 1
      while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5 }
      out += String.fromCharCode(v + 63)
    }
    plat = Math.round(la * 1e5); plng = Math.round(ln * 1e5)
  }
  return out
}

export function dekodieren(s = '') {
  const pts = []
  let i = 0, lat = 0, lng = 0
  const zahl = () => {
    let e = 0, sh = 0, b
    do { b = s.charCodeAt(i++) - 63; e |= (b & 0x1f) << sh; sh += 5 } while (b >= 0x20)
    return e & 1 ? ~(e >> 1) : e >> 1
  }
  while (i < s.length) { lat += zahl(); lng += zahl(); pts.push([lat / 1e5, lng / 1e5]) }
  return pts
}

// ── Kennzahlen ───────────────────────────────────────────────────────────

/** Kurvigkeit wie bei den Touren: Grad Richtungsänderung je km (je 25-m-Schritt höchstens 25°). */
export function kurvigkeit(pts) {
  const kum = kumuliert(pts)
  const gesamt = kum[kum.length - 1]
  if (gesamt < 500) return 0
  // gleichmäßig alle 25 m abtasten
  const proben = []
  let j = 0
  for (let m = 0; m <= gesamt; m += 25) {
    while (j < kum.length - 2 && kum[j + 1] < m) j++
    const f = (m - kum[j]) / Math.max(1e-6, kum[j + 1] - kum[j])
    proben.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f])
  }
  const kurs = (a, b) => Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180 / Math.PI
  let summe = 0
  for (let k = 2; k < proben.length; k++) {
    let d = Math.abs(kurs(proben[k - 1], proben[k]) - kurs(proben[k - 2], proben[k - 1]))
    if (d > 180) d = 360 - d
    summe += Math.min(d, 25)
  }
  return Math.round(summe / (gesamt / 1000))
}

/** Höhenprofil [[km, m], …] aus Höhen je Punkt (höchstens ~200 Stützstellen). */
export function profilAus(pts, hoehen) {
  if (!hoehen?.length || hoehen.filter((h) => h != null).length < pts.length * 0.5) return []
  const kum = kumuliert(pts)
  const schritt = Math.max(1, Math.floor(pts.length / 200))
  const out = []
  for (let i = 0; i < pts.length; i += schritt) if (hoehen[i] != null) out.push([kum[i] / 1000, hoehen[i]])
  if (hoehen.at(-1) != null) out.push([kum.at(-1) / 1000, hoehen.at(-1)])
  return out
}

function aufAb(hoehen) {
  let auf = 0, ab = 0, anker = null
  for (const h of hoehen || []) {
    if (h == null) continue
    if (anker == null) { anker = h; continue }
    if (h - anker > 4) { auf += h - anker; anker = h } else if (anker - h > 4) { ab += anker - h; anker = h }
  }
  return { auf: Math.round(auf), ab: Math.round(ab) }
}

// ── Speicher ─────────────────────────────────────────────────────────────

const lies = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } }

/** Alle eigenen Strecken, neueste zuerst: { id, name, art, datum, pts, hoehen, sekunden }. */
export function alleEigenen() {
  const strecken = lies(LS_STRECKEN).map((s) => ({
    id: s.id, name: s.name, art: s.art, datum: s.datum,
    pts: dekodieren(s.linie), hoehen: s.hoehen || null, sekunden: s.sekunden || null,
  }))
  const fahrten = lies(LS_RIDES).filter((r) => r.track?.punkte?.length > 1).map((r) => ({
    id: `fahrt-${r.id}`, name: r.title || 'Aufgezeichnete Fahrt', art: 'aufgezeichnet', datum: r.track.start || r.date,
    pts: r.track.punkte.map((p) => [p[0], p[1]]),
    hoehen: r.track.punkte.map((p) => p[3] ?? null),
    sekunden: r.track.fahrMs ? r.track.fahrMs / 1000 : null,
    fahrt: { maxKmh: r.track.maxKmh, schnittKmh: r.track.schnittKmh },
  }))
  return [...strecken, ...fahrten].sort((a, b) => (b.datum || 0) - (a.datum || 0))
}

export function findeEigene(id) {
  const roh = id.startsWith(PRAEFIX) ? id.slice(PRAEFIX.length) : id
  return alleEigenen().find((s) => s.id === roh) || null
}

/** Strecke speichern (geplant/importiert/geteilt). Liefert die id. */
export function speichereStrecke({ name, art, pts, hoehen = null, sekunden = null }) {
  const liste = lies(LS_STRECKEN)
  const id = `${art.slice(0, 3)}-${Date.now().toString(36)}`
  const dicht = ausduennen(pts, 4000)
  liste.unshift({
    id, name: (name || 'Meine Strecke').slice(0, 80), art, datum: Date.now(), linie: kodieren(dicht),
    hoehen: hoehen ? ausduennen(hoehen.map((h, i) => [h, i]), 4000).map((x) => x[0]) : null, sekunden,
  })
  if (!schreib(LS_STRECKEN, liste)) throw new Error('Der Speicher deines Browsers ist voll — lösche ältere Strecken.')
  return id
}

/** Neue Fahrt (vom Recorder) ins Fahrtenbuch — dasselbe Format wie im Profil. */
export function speichereFahrt(track, titel) {
  const rides = lies(LS_RIDES)
  const id = Date.now().toString(36)
  rides.push({
    id, date: track.start || Date.now(), km: Math.round(track.km), hours: +(track.fahrMs / 3600000).toFixed(1),
    title: (titel || 'Aufgezeichnete Fahrt').slice(0, 80), notes: '', mood: null, accent: null, photo: null, track,
  })
  if (!schreib(LS_RIDES, rides)) throw new Error('Der Speicher deines Browsers ist voll.')
  return `fahrt-${id}`
}

export function umbenennen(id, name) {
  const roh = id.replace(PRAEFIX, '')
  if (roh.startsWith('fahrt-')) {
    const rides = lies(LS_RIDES).map((r) => (`fahrt-${r.id}` === roh ? { ...r, title: name } : r))
    return schreib(LS_RIDES, rides)
  }
  return schreib(LS_STRECKEN, lies(LS_STRECKEN).map((s) => (s.id === roh ? { ...s, name } : s)))
}

export function loesche(id) {
  const roh = id.replace(PRAEFIX, '')
  if (roh.startsWith('fahrt-')) return schreib(LS_RIDES, lies(LS_RIDES).filter((r) => `fahrt-${r.id}` !== roh))
  return schreib(LS_STRECKEN, lies(LS_STRECKEN).filter((s) => s.id !== roh))
}

// ── In die Form der Touren bringen ───────────────────────────────────────

const ART_TEXT = { aufgezeichnet: 'Aufgezeichnet', geplant: 'Geplant', importiert: 'Importiert', geteilt: 'Geteilt' }

export function alsTour(s) {
  const kum = kumuliert(s.pts)
  const meter = kum.at(-1)
  const km = meter / 1000
  const hs = (s.hoehen || []).filter((h) => h != null)
  const { auf, ab } = aufAb(s.hoehen)
  const kurven = kurvigkeit(s.pts)
  const rund = s.pts.length > 2 && haversineKm(s.pts[0][0], s.pts[0][1], s.pts.at(-1)[0], s.pts.at(-1)[1]) < 0.6
  // Fahrzeit: gemessen oder geschätzt (Landstraße mit Kurven ~ 55 km/h)
  const min = s.sekunden ? s.sekunden / 60 : (km / Math.max(35, 62 - kurven / 8)) * 60
  let punkte = (kurven >= 150 ? 2 : kurven >= 110 ? 1 : 0) + (km > 0 && auf / km >= 13 ? 1 : 0) + (km >= 200 ? 1 : 0)
  const datum = s.datum ? new Date(s.datum).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return {
    id: PRAEFIX + s.id,
    eigen: true,
    art: s.art,
    name: s.name,
    region: [ART_TEXT[s.art] || 'Eigene Strecke', datum].filter(Boolean).join(' · '),
    typ: rund ? 'rund' : 'strecke',
    text: '',
    tags: [],
    km: Math.round(km * 10) / 10,
    min: Math.round(min),
    auf, ab,
    hmin: hs.length ? Math.min(...hs) : 0,
    hmax: hs.length ? Math.max(...hs) : 0,
    kurven,
    schwierigkeit: punkte >= 3 ? 'schwer' : punkte >= 1 ? 'mittel' : 'leicht',
    autobahnKm: 0,
    wp: [],
    fahrt: s.fahrt || null,
    _pts: ausduennen(s.pts, 300),
    _detail: { pts: s.pts, kum, profil: profilAus(s.pts, s.hoehen), schritte: [] },
  }
}

// ── GPX ──────────────────────────────────────────────────────────────────

/** GPX lesen: Track, sonst Route, sonst Wegpunkte. */
export function gpxLesen(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Die Datei ist keine gültige GPX-Datei.')
  const punkteAus = (sel) => [...doc.querySelectorAll(sel)].map((p) => {
    const ele = p.querySelector('ele')?.textContent
    return [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon')), ele != null ? Math.round(parseFloat(ele)) : null]
  }).filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln))
  let p = punkteAus('trkpt')
  if (p.length < 2) p = punkteAus('rtept')
  if (p.length < 2) p = punkteAus('wpt')
  if (p.length < 2) throw new Error('In der Datei steckt keine Strecke.')
  const name = (doc.querySelector('trk > name')?.textContent || doc.querySelector('rte > name')?.textContent || doc.querySelector('metadata > name')?.textContent || '').trim()
  return { name, pts: p.map(([la, ln]) => [la, ln]), hoehen: p.map((x) => x[2]) }
}

export function gpxText(name, pts, hoehen = null) {
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MotoMatch" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${x(name)}</name><link href="https://motomatch.studio"><text>MotoMatch</text></link></metadata>
  <trk>
    <name>${x(name)}</name>
    <trkseg>
${pts.map(([la, ln], i) => `      <trkpt lat="${la.toFixed(5)}" lon="${ln.toFixed(5)}">${hoehen?.[i] != null ? `<ele>${hoehen[i]}</ele>` : ''}</trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>
`
}

export function herunterladen(dateiname, inhalt, typ = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([inhalt], { type: typ }))
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ── Teilen per Link ──────────────────────────────────────────────────────

const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

/** Link, der die Strecke selbst enthält (bis ~600 Punkte, wenige KB). */
export function teilenLink(name, pts) {
  const daten = b64(JSON.stringify({ n: name, p: kodieren(ausduennen(pts, 600)) }))
  return `${location.origin}/#strecke=${daten}`
}

/** Strecke aus dem Link lesen — oder null. */
export function ausLink(hash = location.hash) {
  const m = /[#&]strecke=([A-Za-z0-9_-]+)/.exec(hash)
  if (!m) return null
  try {
    const j = JSON.parse(unb64(m[1]))
    const pts = dekodieren(j.p)
    if (pts.length < 2 || pts.some(([la, ln]) => !Number.isFinite(la) || Math.abs(la) > 90 || Math.abs(ln) > 180)) return null
    return { name: String(j.n || 'Geteilte Strecke').slice(0, 80), pts }
  } catch { return null }
}

// ── Gesammelte Kurvenstrecken ────────────────────────────────────────────

const LS_GESAMMELT = 'mm_kurven_gesammelt_v1'

/**
 * Welche Kurvenstrecken wurden auf den aufgezeichneten Fahrten gefahren?
 * Eine Strecke zählt, wenn mindestens 70 % ihrer Punkte näher als 60 m an
 * der Spur liegen. Ergebnis je Fahrt gemerkt (die Spur ändert sich nicht).
 * Bewusst ohne Zeiten oder Ranglisten — gesammelt wird, nicht gerast.
 * @returns {Promise<{ fahrten, km, kurven: Array<{ id, name, stufe }> }>}
 */
export async function bilanz() {
  const eigene = alleEigenen().filter((s) => s.art === 'aufgezeichnet')
  let gemerkt = {}
  try { gemerkt = JSON.parse(localStorage.getItem(LS_GESAMMELT) || '{}') } catch {}
  const { streckenIn, stufe } = await import('./kurven.js')
  let geaendert = false
  for (const s of eigene) {
    if (gemerkt[s.id]) continue
    // Spur in ein Raster legen (~110 m Zellen), damit der Vergleich schnell bleibt
    const raster = new Map()
    for (const [la, ln] of s.pts) {
      const k = `${Math.round(la * 900)},${Math.round(ln * 600)}`
      if (!raster.has(k)) raster.set(k, [])
      raster.get(k).push([la, ln])
    }
    const nah = (la, ln) => {
      const gx = Math.round(la * 900), gy = Math.round(ln * 600)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const p of raster.get(`${gx + dx},${gy + dy}`) || []) if (haversineKm(la, ln, p[0], p[1]) < 0.06) return true
      }
      return false
    }
    let sMin = 90, wMin = 180, nMax = -90, oMax = -180
    for (const [la, ln] of s.pts) { if (la < sMin) sMin = la; if (la > nMax) nMax = la; if (ln < wMin) wMin = ln; if (ln > oMax) oMax = ln }
    const kandidaten = await streckenIn(sMin, wMin, nMax, oMax)
    gemerkt[s.id] = kandidaten.filter((k) => {
      const probe = k.pts.filter((_, i) => i % 3 === 0)
      return probe.length && probe.filter(([la, ln]) => nah(la, ln)).length / probe.length >= 0.7
    }).map((k) => [k.id, k.name, stufe(k).label])
    geaendert = true
  }
  if (geaendert) try { localStorage.setItem(LS_GESAMMELT, JSON.stringify(gemerkt)) } catch {}
  const kurven = new Map()
  for (const s of eigene) for (const [id, name, st] of gemerkt[s.id] || []) kurven.set(id, { id, name, stufe: st })
  const km = eigene.reduce((summe, s) => summe + kumuliert(s.pts).at(-1) / 1000, 0)
  return { fahrten: eigene.length, km, kurven: [...kurven.values()] }
}
