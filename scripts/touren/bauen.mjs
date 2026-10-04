/* Baut aus scripts/touren/quelle.mjs die Tourendaten der Karte:
     public/data/touren/index.json   Liste mit Kennzahlen + grober Vorschaulinie
     public/data/touren/<id>.json    genaue Linie + Höhenprofil (lädt erst beim Öffnen)

   Quellen (alle frei nutzbar, Namensnennung im Index und in der App):
     Nominatim (OpenStreetMap)  Wegpunkte → Koordinaten, Ergebnis in orte.json zwischengespeichert
     OSRM-Demoserver (OSM)      Strecke zwischen den Wegpunkten
     OpenTopoData (EU-DEM 25 m) Höhen; 1 Abfrage/s, 1.000 am Tag, je bis 100 Punkte
   Beide OSM-Dienste erlauben nur sparsame Nutzung — deshalb strikt nacheinander
   mit Pause, und Nominatim nur für Orte, die noch nicht im Zwischenspeicher stehen.

   Aufruf:  node scripts/touren/bauen.mjs            fehlende Touren (fertige bleiben stehen)
            node scripts/touren/bauen.mjs --neu      alle neu
            node scripts/touren/bauen.mjs harz-hochstrasse rhoen   nur diese neu (Index wird trotzdem vollständig geschrieben) */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOUREN } from './quelle.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const ORTE_DATEI = join(HIER, 'orte.json')
const ZIEL = join(HIER, '..', '..', 'public', 'data', 'touren')
const UA = 'MotoMatch-Touren/1.0 (kontakt@motomatch.studio)'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function holeJson(url, versuche = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } })
      if (r.ok) return await r.json()
      if (i >= versuche) throw new Error(`HTTP ${r.status}`)
    } catch (err) {
      if (i >= versuche) throw new Error(`${url.slice(0, 90)}… → ${err.message}`)
    }
    await pause(2000 * i)
  }
}

// ── Wegpunkte ────────────────────────────────────────────────────────────
const orte = existsSync(ORTE_DATEI) ? JSON.parse(await readFile(ORTE_DATEI, 'utf8')) : {}

async function wegpunkt(wp) {
  if (Array.isArray(wp)) return { name: wp[0], lat: wp[1], lng: wp[2] }
  const [name, zusatz] = wp.split('|')
  if (!orte[wp]) {
    // "Glashütten (Taunus)" kennt Nominatim nicht, "Glashütten, Taunus" schon
    const klammer = name.match(/^(.*?)\s*\((.*)\)$/)
    const varianten = [[name, zusatz], klammer && [klammer[1], zusatz || klammer[2]], klammer && [klammer[1], zusatz]].filter(Boolean)
    let treffer = [], q = ''
    for (const v of varianten) {
      q = [...v, 'Deutschland'].filter(Boolean).join(', ')
      treffer = await holeJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`)
      await pause(1100)
      if (treffer[0]) break
    }
    if (!treffer[0]) throw new Error(`Ort nicht gefunden: ${q}`)
    orte[wp] = { lat: +(+treffer[0].lat).toFixed(5), lng: +(+treffer[0].lon).toFixed(5), osm: treffer[0].display_name }
    await writeFile(ORTE_DATEI, JSON.stringify(orte, null, 1))
  }
  return { name: name.replace(/\s*\(.*\)$/, ''), lat: orte[wp].lat, lng: orte[wp].lng }
}

// ── Geometrie ────────────────────────────────────────────────────────────
const RAD = Math.PI / 180
function distM(a, b) {
  const dLat = (b[1] - a[1]) * RAD, dLng = (b[0] - a[0]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}
function kurs(a, b) {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD)
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD)
  return Math.atan2(y, x) / RAD
}

/** Linie in gleichen Abständen neu abtasten. */
function abtasten(pts, schrittM) {
  const aus = [pts[0]]
  let rest = schrittM
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]
    const b = pts[i]
    let d = distM(a, b)
    while (d >= rest) {
      const t = rest / d
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      aus.push(a)
      d -= rest
      rest = schrittM
    }
    rest -= d
  }
  return aus
}

/* Kurvigkeit in Grad Richtungsänderung je Kilometer. Abgetastet in 25-m-Schritten:
   so zählen Kurven, nicht das Zittern einzelner OSM-Knoten. Richtungswechsel unter
   4° pro Schritt sind Geradeaus-Rauschen, über 120° Wendepunkte an Wegpunkten —
   beides fließt nicht ein. Je Schritt höchstens 25°: ein Abbiegen an einer
   Kreuzung (90° auf einen Schlag) zählt so wenig, eine Kehre über mehrere
   Schritte voll. Sonst wirkte jede Ortsdurchfahrt kurviger als ein Pass. */
function kurvigkeit(pts) {
  const p = abtasten(pts, 25)
  let summe = 0
  for (let i = 2; i < p.length; i++) {
    let d = Math.abs(kurs(p[i - 1], p[i]) - kurs(p[i - 2], p[i - 1]))
    if (d > 180) d = 360 - d
    if (d >= 4 && d <= 120) summe += Math.min(d, 25)
  }
  return summe / ((p.length * 25) / 1000)
}

/** Douglas-Peucker in Metern (flache Näherung, reicht für Tourlängen). */
function vereinfachen(pts, tolM) {
  if (pts.length < 3) return pts
  const k = Math.cos(pts[0][1] * RAD) * 111320, m = 110540
  const xy = pts.map((p) => [p[0] * k, p[1] * m])
  const behalten = new Uint8Array(pts.length)
  behalten[0] = behalten[pts.length - 1] = 1
  const stapel = [[0, pts.length - 1]]
  while (stapel.length) {
    const [s, e] = stapel.pop()
    const [x1, y1] = xy[s], [x2, y2] = xy[e]
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const [x, y] = xy[i]
      let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0
      t = Math.max(0, Math.min(1, t))
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tolM) { behalten[idx] = 1; stapel.push([s, idx], [idx, e]) }
  }
  return pts.filter((_, i) => behalten[i])
}

/** Google-Polyline-Kodierung (Genauigkeit 1e-5), Eingabe [lng, lat]. */
function kodieren(pts) {
  let out = '', pLat = 0, pLng = 0
  const zahl = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5 }
    out += String.fromCharCode(v + 63)
  }
  for (const [lng, lat] of pts) {
    const la = Math.round(lat * 1e5), ln = Math.round(lng * 1e5)
    zahl(la - pLat); zahl(ln - pLng)
    pLat = la; pLng = ln
  }
  return out
}

// ── Höhen ────────────────────────────────────────────────────────────────
/* Open-Meteo zählt jeden Punkt als eigene Abfrage und sperrte nach drei Touren
   (HTTP 429). OpenTopoData zählt Anfragen, nicht Punkte. */
async function hoehen(pts) {
  const aus = []
  for (let i = 0; i < pts.length; i += 100) {
    const teil = pts.slice(i, i + 100)
    const url = `https://api.opentopodata.org/v1/eudem25m?locations=${teil.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join('|')}`
    const j = await holeJson(url)
    if (j.status !== 'OK') throw new Error(`OpenTopoData: ${j.status} ${j.error || ''}`)
    aus.push(...j.results.map((r) => r.elevation ?? 0))
    await pause(1200)
  }
  return aus
}

/* Auf- und Abstieg mit Glättung und 5-m-Schwelle — ungeglättet zählt jedes
   Rauschen des Höhenmodells als Höhenmeter und die Summe wird doppelt so groß. */
function hoehenmeter(h) {
  const g = h.map((_, i) => {
    const f = h.slice(Math.max(0, i - 2), i + 3)
    return f.reduce((a, b) => a + b, 0) / f.length
  })
  let auf = 0, ab = 0, ref = g[0]
  for (const v of g) {
    if (v - ref >= 5) { auf += v - ref; ref = v }
    else if (ref - v >= 5) { ab += ref - v; ref = v }
  }
  return { auf: Math.round(auf), ab: Math.round(ab), min: Math.round(Math.min(...h)), max: Math.round(Math.max(...h)) }
}

/* Schwierigkeit wie bei Wander-Apps in drei Stufen, aber nach dem, was beim
   Motorradfahren fordert: Kurvendichte zuerst, dann Steigung und Länge. */
function schwierigkeit(km, kurven, aufJeKm) {
  let p = 0
  if (kurven >= 150) p += 2; else if (kurven >= 110) p += 1
  if (aufJeKm >= 13) p += 1
  if (km >= 200) p += 1
  return p >= 3 ? 'schwer' : p >= 1 ? 'mittel' : 'leicht'
}

/* Abbiegehinweise für "Tour fahren": [Meter ab Start, Art, Richtung, Straße, Ausfahrt].
   Nur Stellen, an denen man etwas tun muss — "geradeaus weiter auf neuer
   Straße" ohne Richtungswechsel fliegt raus. */
function schritte(route) {
  const aus = []
  let km = 0
  for (const leg of route.legs) {
    for (const st of leg.steps) {
      const m = st.maneuver
      const strasse = [st.ref, st.name].filter(Boolean).join(' ').trim()
      const egal = (m.type === 'new name' || m.type === 'continue') && (!m.modifier || m.modifier === 'straight')
      if (m.type !== 'depart' && m.type !== 'arrive' && !egal) {
        aus.push([Math.round(km), m.type, m.modifier || '', strasse, m.exit || 0])
      }
      km += st.distance
    }
  }
  aus.push([Math.round(route.distance), 'arrive', '', '', 0])
  return aus
}

// ── Lauf ─────────────────────────────────────────────────────────────────
await mkdir(ZIEL, { recursive: true })
const args = process.argv.slice(2)
if (args.includes('--schritte')) {
  // Nachrüsten ohne Neuberechnung der Höhen: nur OSRM fragen, Schritte ergänzen
  for (const t of TOUREN) {
    const datei = join(ZIEL, `${t.id}.json`)
    if (!existsSync(datei)) continue
    const d = JSON.parse(await readFile(datei, 'utf8'))
    if (d.schritte) continue
    const wps = []
    for (const w of t.wp) wps.push(await wegpunkt(w))
    const route = t.typ === 'rund' ? [...wps, wps[0]] : wps
    const osrm = await holeJson(`https://router.project-osrm.org/route/v1/driving/${route.map((p) => `${p.lng},${p.lat}`).join(';')}?overview=false&steps=true`)
    await pause(1100)
    d.schritte = schritte(osrm.routes[0])
    await writeFile(datei, JSON.stringify(d))
    console.log(`${t.id}: ${d.schritte.length} Hinweise`)
  }
  process.exit(0)
}
const alleNeu = args.includes('--neu')
const nur = new Set(args.filter((a) => !a.startsWith('--')))
const indexDatei = join(ZIEL, 'index.json')
const alterIndex = existsSync(indexDatei) ? JSON.parse(await readFile(indexDatei, 'utf8')) : { touren: [] }
const alt = new Map(alterIndex.touren.map((t) => [t.id, t]))
const ergebnis = []
const warnungen = []

for (const t of TOUREN) {
  const fertig = alt.has(t.id) && existsSync(join(ZIEL, `${t.id}.json`))
  const neu = alleNeu || nur.has(t.id) || (!nur.size && !fertig)
  if (!neu && fertig) {
    // Texte und Tags dürfen sich ohne Neuberechnung ändern
    const a = alt.get(t.id)
    ergebnis.push({ ...a, name: t.name, region: t.region, text: t.text, tags: t.tags, schwierigkeit: schwierigkeit(a.km, a.kurven, a.auf / a.km) })
    continue
  }
  process.stdout.write(`${t.id} … `)
  const wps = []
  for (const w of t.wp) wps.push(await wegpunkt(w))
  // Gleichnamige Orte landen gern im falschen Bundesland: jeder Punkt muss
  // einen Nachbarn in Reichweite haben, sonst stimmt die Zuordnung nicht.
  for (const p of wps) {
    const naechster = Math.min(...wps.filter((q) => q !== p).map((q) => distM([p.lng, p.lat], [q.lng, q.lat])))
    if (naechster > 60000) throw new Error(`${t.id}: "${p.name}" liegt ${(naechster / 1000).toFixed(0)} km vom nächsten Wegpunkt — Zusatz (|Kreis) ergänzen und Eintrag aus orte.json löschen`)
  }
  const route = t.typ === 'rund' ? [...wps, wps[0]] : wps

  const coords = route.map((p) => `${p.lng},${p.lat}`).join(';')
  const osrm = await holeJson(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`)
  await pause(1100)
  if (osrm.code !== 'Ok') throw new Error(`${t.id}: OSRM ${osrm.code}`)
  const r = osrm.routes[0]
  const linie = r.geometry.coordinates

  // Autobahnanteil: gibt OSRM nur über die Klassen der Kreuzungen preis.
  let autobahnM = 0
  r.legs.forEach((leg, i) => {
    const luft = distM([route[i].lng, route[i].lat], [route[i + 1].lng, route[i + 1].lat])
    if (leg.distance > 2.6 * luft && leg.distance > 8000) warnungen.push(`${t.id}: Umweg ${route[i].name} → ${route[i + 1].name} (${(leg.distance / 1000).toFixed(0)} km Strecke, ${(luft / 1000).toFixed(0)} km Luftlinie)`)
    for (const s of leg.steps) if (s.intersections?.some((x) => x.classes?.includes('motorway'))) autobahnM += s.distance
  })
  const km = r.distance / 1000
  if (autobahnM / r.distance > 0.03) warnungen.push(`${t.id}: ${(autobahnM / 1000).toFixed(1)} km Autobahn (${Math.round((autobahnM / r.distance) * 100)} %)`)

  const proben = abtasten(linie, Math.max(200, r.distance / 299))
  const h = await hoehen(proben)
  const hm = hoehenmeter(h)
  const kurven = Math.round(kurvigkeit(linie))

  const genau = vereinfachen(linie, 6)
  const vorschau = vereinfachen(linie, 250)
  const lats = linie.map((p) => p[1]), lngs = linie.map((p) => p[0])
  // Höhenprofil für das Diagramm: höchstens ~160 Punkte, [km, m]
  const schritt = Math.max(1, Math.ceil(h.length / 160))
  const profil = []
  for (let i = 0; i < h.length; i += schritt) profil.push([+(((i * r.distance) / (proben.length - 1)) / 1000).toFixed(2), Math.round(h[i])])
  if ((h.length - 1) % schritt) profil.push([+km.toFixed(2), Math.round(h[h.length - 1])])

  await writeFile(join(ZIEL, `${t.id}.json`), JSON.stringify({ id: t.id, linie: kodieren(genau), profil, schritte: schritte(r) }))
  const eintrag = {
    id: t.id, name: t.name, region: t.region, typ: t.typ, text: t.text, tags: t.tags,
    km: Math.round(km), min: Math.round(r.duration / 60),
    auf: hm.auf, ab: hm.ab, hmin: hm.min, hmax: hm.max,
    kurven, schwierigkeit: schwierigkeit(km, kurven, hm.auf / km),
    autobahnKm: +(autobahnM / 1000).toFixed(1),
    wp: wps.map((p) => [p.name, p.lat, p.lng]),
    box: [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)].map((v) => +v.toFixed(4)),
    vorschau: kodieren(vorschau),
  }
  ergebnis.push(eintrag)
  // Zwischenstand sichern: bricht ein Dienst ab, ist die Arbeit bis hier nicht verloren
  await writeFile(indexDatei, JSON.stringify({ ...alterIndex, touren: [...ergebnis, ...alterIndex.touren.filter((x) => !ergebnis.some((e) => e.id === x.id))] }))
  console.log(`${eintrag.km} km, ${eintrag.min} min, ↑${hm.auf} m, ${kurven}°/km, ${eintrag.schwierigkeit}, Linie ${genau.length} Pkt`)
}

await writeFile(indexDatei, JSON.stringify({
  stand: new Date().toISOString().slice(0, 10),
  quellen: 'Strecken: © OpenStreetMap-Mitwirkende (ODbL), berechnet mit OSRM · Höhen: EU-DEM über OpenTopoData',
  touren: ergebnis,
}))
console.log(`\n${ergebnis.length} Touren → ${indexDatei}`)
if (warnungen.length) console.log(`\nWarnungen:\n  ${warnungen.join('\n  ')}`)
