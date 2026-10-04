/* ═══════════════════════════════════════════════════
   ROUTING & STRECKEN-WERKZEUGE

   - route(punkte): Strecke über /api/route (OpenRouteService, Schlüssel
     bleibt auf dem Server) mit Abbiegehinweisen und Höhen.
   - Werkzeuge für das Navi: Strecken zusammensetzen (Anfahrt + Tour),
     ab einem Punkt beginnen lassen (Rundtour), nächster Punkt auf der Linie.

   Eine "Strecke" ist überall dasselbe Objekt:
     { pts: [[lat, lng], …], kum: [Meter ab Start je Punkt],
       schritte: [[meter, art, richtung, straße, ausfahrt], …],
       hoehen?: [m je Punkt], sekunden?: Fahrzeit }
   Die Meter der Schritte beziehen sich auf kum (Meter entlang der Linie).
   ═══════════════════════════════════════════════════ */

import { haversineKm } from './karte.js'

export class RoutingFehler extends Error {
  constructor(code, message) { super(message); this.code = code }
}

/** Kumulierte Meter entlang der Punkte. */
export function kumuliert(pts) {
  const kum = [0]
  for (let i = 1; i < pts.length; i++) kum.push(kum[i - 1] + haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * 1000)
  return kum
}

/** Schritt-Meter (fremde Zählung, z. B. OSRM/ORS) auf die Meter der Linie umrechnen. */
export function schritteAufLinie(schritte, kum, gesamtQuelle) {
  const gesamt = kum[kum.length - 1]
  const f = gesamtQuelle > 0 ? gesamt / gesamtQuelle : 1
  return schritte.map((s) => [Math.round(s[0] * f), ...s.slice(1)])
}

const anfragen = new Map()

/**
 * Route zwischen Punkten ([[lat, lng], …], 2–50).
 * @returns {Promise<{pts, kum, schritte, hoehen, meter, sekunden, auf, ab}>}
 */
export function route(punkte, { rundtour = null } = {}) {
  const schluessel = punkte.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';') + (rundtour ? `|${rundtour.km}-${rundtour.seed}` : '')
  if (anfragen.has(schluessel)) return anfragen.get(schluessel)
  const p = (async () => {
    let r
    try {
      r = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ punkte: punkte.map(([la, ln]) => [+ln.toFixed(6), +la.toFixed(6)]), ...(rundtour ? { rundtour } : {}) }),
      })
    } catch {
      throw new RoutingFehler('offline', 'Keine Verbindung — die Route kann gerade nicht berechnet werden.')
    }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new RoutingFehler(j.error?.code || 'fehler', j.error?.message || 'Die Route konnte nicht berechnet werden.')
    const pts = j.linie.map(([la, ln]) => [la, ln])
    const kum = kumuliert(pts)
    return {
      pts, kum,
      hoehen: j.linie.map((x) => x[2]),
      schritte: schritteAufLinie(j.schritte, kum, j.meter),
      meter: kum[kum.length - 1], sekunden: j.sekunden, auf: j.auf, ab: j.ab,
    }
  })()
  anfragen.set(schluessel, p)
  p.catch(() => anfragen.delete(schluessel))
  if (anfragen.size > 60) anfragen.delete(anfragen.keys().next().value)
  return p
}

/** Nächster Punkt der Linie zu (lat, lng): { index, meter (Abstand), entlang (Meter ab Start) }. */
export function naechster(strecke, lat, lng, von = 0, bis = strecke.pts.length) {
  let best = -1, bestD = Infinity
  const { pts } = strecke
  for (let i = Math.max(0, von); i < Math.min(pts.length, bis); i++) {
    // grobe Vorauswahl ohne Trigonometrie, genaue Entfernung nur für Kandidaten
    const dLat = pts[i][0] - lat, dLng = (pts[i][1] - lng) * 0.65
    const grob = dLat * dLat + dLng * dLng
    if (grob < bestD) { bestD = grob; best = i }
  }
  if (best < 0) return { index: 0, meter: Infinity, entlang: 0 }
  return { index: best, meter: haversineKm(lat, lng, pts[best][0], pts[best][1]) * 1000, entlang: strecke.kum[best] }
}

/** Teilstück ab Punkt i bis j (exklusive j), Schritte mitgenommen und verschoben. */
export function teil(strecke, i, j = strecke.pts.length) {
  const pts = strecke.pts.slice(i, j)
  const basis = strecke.kum[i]
  const ende = strecke.kum[Math.max(i, j - 1)]
  const kum = strecke.kum.slice(i, j).map((m) => m - basis)
  const schritte = strecke.schritte.filter((s) => s[0] >= basis - 1 && s[0] <= ende + 1).map((s) => [s[0] - basis, ...s.slice(1)])
  return { ...strecke, pts, kum, schritte, hoehen: strecke.hoehen?.slice(i, j) }
}

/**
 * Strecken hintereinanderhängen. Das "arrive" der vorderen wird zu einem
 * Zwischenziel (art "waypoint", Text im 4. Feld), die "depart" der hinteren entfällt.
 */
export function verbinde(a, b, zwischenText = '') {
  const versatz = a.kum[a.kum.length - 1]
  const schritteA = a.schritte.map((s) => (s[1] === 'arrive' ? [s[0], 'waypoint', '', zwischenText, 0] : s))
  if (!schritteA.some((s) => s[1] === 'waypoint')) schritteA.push([Math.round(versatz), 'waypoint', '', zwischenText, 0])
  const schritteB = b.schritte.filter((s) => s[1] !== 'depart').map((s) => [s[0] + versatz, ...s.slice(1)])
  const dupl = haversineKm(a.pts[a.pts.length - 1][0], a.pts[a.pts.length - 1][1], b.pts[0][0], b.pts[0][1]) < 0.002
  const bPts = dupl ? b.pts.slice(1) : b.pts
  const bKum = (dupl ? b.kum.slice(1) : b.kum)
  return {
    pts: [...a.pts, ...bPts],
    kum: [...a.kum, ...bKum.map((m) => m + versatz)],
    schritte: [...schritteA, ...schritteB],
    hoehen: a.hoehen && b.hoehen ? [...a.hoehen, ...(dupl ? b.hoehen.slice(1) : b.hoehen)] : undefined,
    sekunden: (a.sekunden || 0) + (b.sekunden || 0) || undefined,
  }
}

/** Rundtour ab Punkt i beginnen lassen (Start = nächster Punkt zum Fahrer). */
export function rundAb(strecke, i) {
  if (i <= 0) return strecke
  const vorne = teil(strecke, i)
  const hinten = teil(strecke, 0, i + 1)
  const v = vorne.kum[vorne.kum.length - 1]
  const schritte = [...vorne.schritte.filter((s) => s[1] !== 'arrive'), ...hinten.schritte.filter((s) => s[1] !== 'depart').map((s) => [s[0] + v, ...s.slice(1)])]
  if (!schritte.some((s) => s[1] === 'arrive')) schritte.push([Math.round(v + hinten.kum[hinten.kum.length - 1]), 'arrive', '', '', 0])
  return {
    ...strecke,
    pts: [...vorne.pts, ...hinten.pts.slice(1)],
    kum: [...vorne.kum, ...hinten.kum.slice(1).map((m) => m + v)],
    hoehen: strecke.hoehen ? [...vorne.hoehen, ...hinten.hoehen.slice(1)] : undefined,
    schritte,
  }
}

/** Punkte gleichmäßig auf höchstens n ausdünnen (Start und Ende bleiben). */
export function ausduennen(pts, n) {
  if (pts.length <= n) return pts.slice()
  const out = []
  for (let k = 0; k < n; k++) out.push(pts[Math.round((k * (pts.length - 1)) / (n - 1))])
  return out
}

/** Höchstens n Stützpunkte, gleichmäßig nach Strecke verteilt (für Routing durch eine Linie). */
export function stuetzpunkte(pts, n) {
  const kum = kumuliert(pts)
  const gesamt = kum[kum.length - 1]
  if (pts.length <= n) return pts.slice()
  const out = [pts[0]]
  let j = 0
  for (let k = 1; k < n - 1; k++) {
    const ziel = (k * gesamt) / (n - 1)
    while (j < kum.length - 1 && kum[j] < ziel) j++
    out.push(pts[j])
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Punkt auf der Linie bei m Metern (zwischen den Stützpunkten interpoliert). */
export function punktBei(strecke, m) {
  const { kum, pts } = strecke
  if (m <= 0) return pts[0]
  if (m >= kum[kum.length - 1]) return pts[pts.length - 1]
  let lo = 0, hi = kum.length - 1
  while (lo < hi) { const k = (lo + hi) >> 1; if (kum[k] < m) lo = k + 1; else hi = k }
  const a = pts[lo - 1], b = pts[lo], f = (m - kum[lo - 1]) / Math.max(1e-6, kum[lo] - kum[lo - 1])
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** Kompasskurs von a nach b in Grad. */
export function kursZwischen(a, b) {
  const r = Math.PI / 180
  const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r)
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r)
  return (Math.atan2(y, x) / r + 360) % 360
}

/** Fahrtrichtung der Linie bei m Metern (über ein kurzes Stück voraus geglättet). */
export function kursBei(strecke, m, voraus = 25) {
  const gesamt = strecke.kum[strecke.kum.length - 1]
  const von = Math.max(0, Math.min(m, gesamt - 1))
  return kursZwischen(punktBei(strecke, von), punktBei(strecke, Math.min(gesamt, von + voraus)))
}

/** Genaue Lage auf der Linie: Lot auf die Abschnitte neben Punkt i → Meter ab Start. */
export function projiziere(strecke, lat, lng, i) {
  const { pts, kum } = strecke
  const k = Math.cos((lat * Math.PI) / 180)
  let best = { meter: kum[i], abstand: Infinity }
  for (const j of [i - 1, i]) {
    if (j < 0 || j >= pts.length - 1) continue
    const a = pts[j], b = pts[j + 1]
    const bx = (b[1] - a[1]) * k, by = b[0] - a[0], px = (lng - a[1]) * k, py = lat - a[0]
    const l2 = bx * bx + by * by
    const t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0
    const dx = px - bx * t, dy = py - by * t
    const abstand = Math.sqrt(dx * dx + dy * dy) * 111320
    if (abstand < best.abstand) best = { meter: kum[j] + (kum[j + 1] - kum[j]) * t, abstand }
  }
  return best
}
