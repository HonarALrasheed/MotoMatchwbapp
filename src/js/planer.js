/* ═══════════════════════════════════════════════════
   ROUTENPLANER — eigene Route auf der Karte bauen.

   - Punkte setzen durch Tippen auf die Karte, verschieben durch Ziehen.
   - "Kurvig": zwischen je zwei Punkten sucht der Planer die besten unserer
     Kurvenstrecken (kurven.js, aus OSM berechnet) im Korridor und legt die
     Route über sie. Gerechnet im Browser, verbunden über /api/route — kein
     eigener Routing-Server nötig.
   - "Rundtour vorschlagen": ab dem Start eine Runde der gewünschten Länge
     über drei kurvige Abschnitte rund um den Startpunkt.
   - Speichern in "Meine" (eigene-strecken.js) oder direkt losfahren.
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { hinweisen, eingeben } from './meldung.js'
import { getHubMap, getMapLib, haversineKm, getUserCoords, resolveOrt, sucheAdressen } from './karte.js'
import { route, naechster, RoutingFehler } from './routing.js'
import { streckenIn } from './kurven.js'
import { speichereStrecke, profilAus, alsTour, kurvigkeit, PRAEFIX } from './eigene-strecken.js'

const MAX_PUNKTE = 50
let plan = null

const LEER = { type: 'FeatureCollection', features: [] }
const km1 = (m) => (m / 1000).toFixed(m >= 100000 ? 0 : 1).replace('.', ',')
const dauer = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} Std` : `${m} Min` }
const dist = (a, b) => haversineKm(a[0], a[1], b[0], b[1])

// ── Kurvige Abschnitte zwischen zwei Punkten ─────────────────────────────

/** Projektion von p auf die Gerade a→b (0 = a, 1 = b) und seitlicher Abstand in km. */
function projektion(a, b, p) {
  const k = Math.cos((a[0] * Math.PI) / 180)
  const bx = (b[1] - a[1]) * k, by = b[0] - a[0]
  const px = (p[1] - a[1]) * k, py = p[0] - a[0]
  const l2 = bx * bx + by * by || 1e-12
  const t = (px * bx + py * by) / l2
  const seit = Math.abs(px * by - py * bx) / Math.sqrt(l2) * 111
  return { t, seit }
}

/** Kurvenstrecke als Stützpunkte in Fahrtrichtung: Anfang und Ende, bei langen Abschnitten auch die Mitte. */
function stuetzen(k, a, b) {
  const p = k.pts
  const vorne = projektion(a, b, p[0]).t <= projektion(a, b, p[p.length - 1]).t
  const r = vorne ? p : p.slice().reverse()
  return k.laenge > 9000 ? [r[0], r[Math.floor(r.length / 2)], r[r.length - 1]] : [r[0], r[r.length - 1]]
}

/** Wie gut liegt der Abschnitt in Richtung (dy, dx)? 1 = parallel, 0 = quer. */
function ausrichtung(k, richtung) {
  const a = k.pts[0], b = k.pts[k.pts.length - 1]
  const c = Math.cos((a[0] * Math.PI) / 180)
  const sx = (b[1] - a[1]) * c, sy = b[0] - a[0]
  const l = Math.hypot(sx, sy) * Math.hypot(richtung[0], richtung[1]) || 1
  return Math.abs(sx * richtung[1] + sy * richtung[0]) / l
}

async function kurvigeVias(a, b) {
  const d = dist(a, b)
  if (d < 4) return []
  const rand = Math.min(25, 4 + d * 0.3) / 111
  const s = Math.min(a[0], b[0]) - rand, n = Math.max(a[0], b[0]) + rand
  const kx = rand / Math.cos((a[0] * Math.PI) / 180)
  const w = Math.min(a[1], b[1]) - kx, o = Math.max(a[1], b[1]) + kx
  const alle = await streckenIn(s, w, n, o)
  const umweg = d * 1.35 + 6
  const kandidaten = alle
    .filter((k) => k.laenge >= 2500 && (k.kurvig / k.laenge) * 1000 >= 180)
    .map((k) => {
      const m = k.pts[Math.floor(k.pts.length / 2)]
      return { k, m, pr: projektion(a, b, m), weg: dist(a, m) + dist(m, b) }
    })
    .filter((x) => x.weg <= umweg && x.pr.t > 0.03 && x.pr.t < 0.97)
    // in Fahrtrichtung liegende Abschnitte zuerst — quer liegende erzwingen Stichwege
    .map((x) => ({ ...x, wert: x.k.kurvig * (0.35 + 0.65 * ausrichtung(x.k, [b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180)])) }))
    .sort((x, y) => y.wert - x.wert)
  // Höchstens ein Abschnitt je Fünftel der Strecke, bis zu 4 — so bleibt es eine Linie und kein Zickzack
  const gewaehlt = []
  const anzahl = Math.min(4, 1 + Math.floor(d / 25))
  for (const x of kandidaten) {
    if (gewaehlt.length >= anzahl) break
    if (gewaehlt.some((g) => Math.abs(g.pr.t - x.pr.t) < 0.2)) continue
    gewaehlt.push(x)
  }
  gewaehlt.sort((x, y) => x.pr.t - y.pr.t)
  // Gesamtumweg begrenzen: der schwächste fliegt raus, bis es passt
  const laenge = (liste) => {
    const kette = [a, ...liste.flatMap((x) => stuetzen(x.k, a, b)), b]
    let m = 0
    for (let i = 1; i < kette.length; i++) m += dist(kette[i - 1], kette[i])
    return m
  }
  while (gewaehlt.length && laenge(gewaehlt) > d * 1.6 + 8) {
    let schwach = 0
    gewaehlt.forEach((x, i) => { if (x.k.kurvig < gewaehlt[schwach].k.kurvig) schwach = i })
    gewaehlt.splice(schwach, 1)
  }
  return gewaehlt.flatMap((x) => stuetzen(x.k, a, b))
}

// ── Karte ────────────────────────────────────────────────────────────────

function ebene(map) {
  if (map.getSource('plan')) return
  map.addSource('plan', { type: 'geojson', data: LEER })
  map.addLayer({ id: 'plan-rand', type: 'line', source: 'plan', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } })
  map.addLayer({ id: 'plan-linie', type: 'line', source: 'plan', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3b5bdb', 'line-width': 5 } })
  // unsichtbare, breite Greiffläche — die Linie selbst ist zum Greifen zu schmal
  map.addLayer({ id: 'plan-griff', type: 'line', source: 'plan', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 26 } })
}

function zeichneLinie(pts) {
  const map = getHubMap()
  map?.getSource('plan')?.setData(pts?.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([a, b]) => [b, a]) } } : LEER)
}

function markerSetzen() {
  const map = getHubMap(), ml = getMapLib()
  if (!plan || !map || !ml) return
  plan.marker.forEach((m) => m.remove())
  plan.marker = plan.punkte.map((p, i) => {
    const el = document.createElement('div')
    const letzter = i === plan.punkte.length - 1 && (i > 0 || plan.startFehlt) && !plan.rund
    const start = i === 0 && !plan.startFehlt
    el.className = `plan-punkt${start ? ' plan-punkt--start' : letzter ? ' plan-punkt--ziel' : ''}`
    el.textContent = start ? 'S' : letzter ? 'Z' : String(i)
    const m = new ml.Marker({ element: el, draggable: true }).setLngLat([p[1], p[0]]).addTo(map)
    m.on('dragstart', () => merken())
    m.on('dragend', () => {
      const ll = m.getLngLat()
      plan.punkte[i] = [ll.lat, ll.lng]
      vorschlagVerwerfen(plan)
      neuRechnen()
    })
    el.addEventListener('click', (e) => e.stopPropagation())
    return m
  })
}

function einpassen(pts) {
  let s = 90, w = 180, n = -90, o = -180
  for (const [la, ln] of pts) { if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > o) o = ln }
  const panel = document.querySelector('.konf-karte-hub .kv-sidebar')
  const mobil = window.matchMedia('(max-width: 759.98px)').matches
  getHubMap()?.fitBounds([[w, s], [o, n]], { padding: mobil ? { top: 90, bottom: 260, left: 30, right: 30 } : { top: 80, bottom: 50, left: (panel?.getBoundingClientRect().width || 0) + 50, right: 80 }, duration: 800 })
}

/** Stand vor einer Änderung merken (für "Rückgängig"). */
function merken() {
  const p = plan
  if (!p) return
  p.verlauf.push({ punkte: p.punkte.map((x) => x.slice()), rund: p.rund, vorschlagVias: p.vorschlagVias, vorschlagKm: p.vorschlagKm, ergebnis: aktuellesErgebnis(p) })
  if (p.verlauf.length > 40) p.verlauf.shift()
}

function vorschlagVerwerfen(p) {
  p.vorschlagVias = null
  p.vorschlagKm = null
}

function planSignatur(p) {
  const punkte = p.punkte.map(([lat, lng]) => [lat, lng])
  if (p.rund && punkte.length === 1 && p.vorschlagKm != null) return JSON.stringify([punkte, 'vorschlag', p.vorschlagKm])
  return JSON.stringify([punkte, p.rund, p.vorschlagVias, p.vorschlagVias && punkte.length === 1 ? null : p.modus])
}

function aktuellesErgebnis(p) {
  return p?.ergebnis && p.ergebnisSignatur === planSignatur(p) ? p.ergebnis : null
}

function neueBerechnung(p) {
  const lauf = ++p.lauf
  p.abbruch?.abort()
  p.abbruch = null
  p.fehler = null
  if (!aktuellesErgebnis(p)) zeichneLinie(null)
  return lauf
}

function gueltigerLauf(p, lauf, signatur, controller) {
  return plan === p && p.lauf === lauf && planSignatur(p) === signatur && !controller.signal.aborted
}

/** Punkt an der richtigen Stelle einfügen: zwischen die Wegpunkte, auf deren Abschnitt er liegt. */
function einfuegen(lat, lng) {
  const p = plan
  const r = aktuellesErgebnis(p)
  if (!r || p.punkte.length < 2) { p.punkte.push([lat, lng]); return }
  const ort = naechster(r, lat, lng).index
  const lage = p.punkte.map((pt) => naechster(r, pt[0], pt[1]).index)
  let nach = 0
  for (let i = 0; i < lage.length; i++) if (lage[i] <= ort) nach = i
  p.punkte.splice(nach + 1, 0, [lat, lng])
}

// ── Rechnen ──────────────────────────────────────────────────────────────

async function neuRechnen() {
  const p = plan
  if (!p) return
  const lauf = neueBerechnung(p)
  const signatur = planSignatur(p)
  markerSetzen()
  renderInfo()
  const kette = p.rund && p.punkte.length > 1 ? [...p.punkte, p.punkte[0]] : p.punkte
  const vorschlag = p.vorschlagVias && p.punkte.length === 1
  if (!vorschlag && kette.length < 2) { p.rechnet = false; renderInfo(); return }
  const controller = new AbortController()
  p.abbruch = controller
  p.rechnet = true
  renderInfo()
  try {
    let wegpunkte = kette
    if (vorschlag) wegpunkte = [p.punkte[0], ...p.vorschlagVias, p.punkte[0]]
    else if (p.modus === 'kurvig') {
      wegpunkte = [kette[0]]
      for (let i = 1; i < kette.length; i++) {
        const vias = await kurvigeVias(kette[i - 1], kette[i])
        if (!gueltigerLauf(p, lauf, signatur, controller)) return
        wegpunkte.push(...vias, kette[i])
      }
    }
    if (wegpunkte.length > MAX_PUNKTE) wegpunkte = [wegpunkte[0], ...wegpunkte.slice(1, -1).filter((_, i, arr) => i % Math.ceil(arr.length / (MAX_PUNKTE - 2)) === 0), wegpunkte[wegpunkte.length - 1]]
    if (!gueltigerLauf(p, lauf, signatur, controller)) return
    if (wegpunkte.length < 2) return
    const r = await route(wegpunkte, { signal: controller.signal })
    if (!gueltigerLauf(p, lauf, signatur, controller)) return
    p.ergebnis = r
    p.ergebnisSignatur = signatur
    p.fehler = null
    zeichneLinie(r.pts)
    if (p.einpassen) { p.einpassen = false; einpassen(r.pts) }
  } catch (err) {
    if (!gueltigerLauf(p, lauf, signatur, controller)) return
    if (!(err instanceof RoutingFehler && err.kind === 'abbruch'))
      p.fehler = err instanceof RoutingFehler ? err.message : 'Die Route konnte nicht berechnet werden.'
  } finally {
    if (p.abbruch === controller) p.abbruch = null
    if (plan === p && lauf === p.lauf) { p.rechnet = false; renderInfo() }
  }
}

// ── Panel ────────────────────────────────────────────────────────────────

function box() { return document.getElementById('tour-liste') }

const PI = {
  zurueck: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  leeren: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
  suche: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  standort: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>',
  kurvig: '<svg viewBox="0 0 24 24"><path d="M4 20c0-5 4-6 8-8s8-3 8-8"/></svg>',
  schnell: '<svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z"/></svg>',
  rund: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  ziel: '<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>',
  zauber: '<svg viewBox="0 0 24 24"><path d="M5 19L17 7M14 4l1.5 1.5M19 9l1.5 1.5M18 3v3M21 6h-3"/></svg>',
  tippen: '<svg viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10.5V9a1.5 1.5 0 0 1 3 0v2M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-1.6-2.8a1.5 1.5 0 0 1 2.5-1.6L9 15"/></svg>',
}

function renderInfo() {
  const p = plan, el = document.getElementById('plan-info')
  if (!p || !el) return
  const r = aktuellesErgebnis(p)
  const nPunkte = p.punkte.length
  // Werkzeuge im Kopf aktuell halten (Punkte kommen auch über die Karte dazu)
  const undo = box()?.querySelector('[data-plan="zurueck"]')
  if (undo) undo.disabled = !p.verlauf.length
  const leeren = box()?.querySelector('[data-plan="leeren"]')
  if (leeren) leeren.hidden = !nPunkte
  const vorschlag = box()?.querySelector('.plan-vorschlag-karte')
  if (vorschlag) vorschlag.hidden = !(p.rund && nPunkte >= 1)
  // Handy: Kurzfassung direkt unter dem Kopf — bleibt bei eingeklapptem Panel sichtbar
  const mini = box()?.querySelector('#plan-mini')
  if (mini) {
    mini.innerHTML = r
      ? `<span class="plan-mini-werte"><strong>${km1(r.meter)} km</strong> · ${dauer(r.sekunden * (p.modus === 'kurvig' ? 1.1 : 1))} · ↗ ${r.auf} m</span>
         <button type="button" class="tour-btn" data-plan="speichern">Speichern</button>
         <button type="button" class="fahrt-los" data-plan="fahren">Los</button>`
      : `<span class="plan-mini-text">${p.rechnet ? 'Route wird berechnet …' : p.fehler ? esc(p.fehler) : nPunkte === 0 ? 'Tippe auf die Karte, um den Start zu setzen.' : nPunkte === 1 && !p.rund && !p.vorschlagVias ? 'Jetzt das Ziel auf der Karte antippen.' : p.fehler ? esc(p.fehler) : ''}</span>`
  }
  const standort = box()?.querySelector('[data-plan="standort"]')
  if (standort) standort.hidden = nPunkte > 0
  const name = (i) => p.punkte[i]?.[2] || (i === 0 ? 'Start' : i === nPunkte - 1 && !p.rund ? 'Ziel' : `Zwischenpunkt ${i}`)
  el.innerHTML = `
    ${nPunkte === 0 ? `<p class="plan-tipp">${PI.tippen}<span>Tippe auf die Karte, um den Start zu setzen.</span></p>`
      : nPunkte === 1 && !p.vorschlagVias && !p.rund && !p.startFehlt ? `<p class="plan-tipp">${PI.tippen}<span>Jetzt das Ziel auf der Karte antippen.</span></p>` : ''}
    ${p.fehler ? `<p class="fahrt-start-fehler">${esc(p.fehler)}</p>` : ''}
    ${nPunkte ? `<ol class="plan-liste">${p.punkte.map((pt, i) => `<li class="plan-liste-punkt plan-liste-punkt--${i === 0 && !p.startFehlt ? 'start' : i === nPunkte - 1 && !p.rund ? 'ziel' : 'via'}">
        <span class="plan-nr">${i === 0 && !p.startFehlt ? 'S' : i === nPunkte - 1 && !p.rund ? 'Z' : i}</span><span class="plan-liste-name">${name(i)}</span>
        <button type="button" class="plan-weg" data-plan-weg="${i}" aria-label="${name(i)} entfernen">×</button></li>`).join('')}
        ${p.rund && nPunkte ? '<li class="plan-liste-punkt plan-liste-punkt--zurueck"><span class="plan-nr">↺</span><span class="plan-liste-name">Zurück zum Start</span></li>' : ''}</ol>` : ''}
    ${r ? `<div class="plan-zahlen${p.rechnet ? ' plan-zahlen--alt' : ''}">
      <div><strong>${km1(r.meter)} km</strong><span>Distanz</span></div>
      <div><strong>${dauer(r.sekunden * (p.modus === 'kurvig' ? 1.1 : 1))}</strong><span>Fahrzeit</span></div>
      <div><strong>${r.auf} m</strong><span>Bergauf</span></div>
      <div><strong>${(r.kurven ??= kurvigkeit(r.pts))}°/km</strong><span>Kurvigkeit</span></div>
    </div>` : p.rechnet ? '<div class="fahrt-laedt"><span class="hub-map-spinner"></span> Route wird berechnet…</div>' : ''}
    ${r ? `<div class="plan-aktionen">
      <button type="button" class="fahrt-los" data-plan="fahren">Losfahren</button>
      <button type="button" class="tour-btn" data-plan="speichern">Speichern</button>
    </div>` : ''}`
  document.dispatchEvent(new CustomEvent('mm:kv-peek'))
}

function renderPanel() {
  const p = plan, b = box()
  if (!p || !b) return
  b.innerHTML = `<div class="fahrt-start plan">
    <div class="plan-kopf">
      <button type="button" class="plan-icon" data-plan="schliessen" aria-label="Zurück">${PI.zurueck}</button>
      <h2>Route planen</h2>
      <button type="button" class="plan-icon" data-plan="zurueck" aria-label="Rückgängig" title="Rückgängig" ${p.verlauf.length ? '' : 'disabled'}>${PI.undo}</button>
      <button type="button" class="plan-icon" data-plan="leeren" aria-label="Alles löschen" title="Alles löschen" ${p.punkte.length ? '' : 'hidden'}>${PI.leeren}</button>
    </div>
    <div class="plan-mini" id="plan-mini"></div>
    <form class="plan-suche" data-plan-suche>
      <span class="plan-suche-icon" aria-hidden="true">${PI.suche}</span>
      <input type="search" placeholder="Adresse oder Ort hinzufügen" aria-label="Adresse oder Ort hinzufügen" enterkeyhint="go">
      <button type="submit" class="plan-suche-los" aria-label="Hinzufügen">${PI.plus}</button>
    </form>
    <button type="button" class="plan-standort" data-plan="standort" ${p.punkte.length ? 'hidden' : ''}>${PI.standort}<span>Mein Standort als Start</span></button>
    <div class="plan-optionen">
      <div class="plan-segment" role="group" aria-label="Strecke">
        <button type="button" data-plan-modus="kurvig" aria-pressed="${p.modus === 'kurvig'}">${PI.kurvig}Kurvig</button>
        <button type="button" data-plan-modus="schnell" aria-pressed="${p.modus === 'schnell'}">${PI.schnell}Schnell</button>
      </div>
      <div class="plan-segment" role="group" aria-label="Art der Route">
        <button type="button" data-plan-rund="1" aria-pressed="${p.rund}">${PI.rund}Rundtour</button>
        <button type="button" data-plan-rund="0" aria-pressed="${!p.rund}">${PI.ziel}Bis zum Ziel</button>
      </div>
    </div>
    <div class="plan-vorschlag-karte" ${p.rund && p.punkte.length ? '' : 'hidden'}>
      <button type="button" class="plan-vorschlag-knopf" data-plan="vorschlag">${PI.zauber}<span><strong>Rundtour vorschlagen</strong><em>Die kurvigste Runde ab deinem Start</em></span></button>
      <div class="plan-vorschlag" id="plan-vorschlag" hidden>
        ${[60, 100, 150, 200].map((k) => `<button type="button" class="tour-option" data-vorschlag-km="${k}">${k} km</button>`).join('')}
      </div>
    </div>
    <div id="plan-info"></div>
  </div>`
  renderInfo()
}

function aufKarteGetippt(e) {
  const p = plan
  if (!p) return
  // Klick auf eine Tour-/Kurvenlinie oder einen Ort: dort nicht zusätzlich einen Punkt setzen
  const map = getHubMap()
  const treffer = map.queryRenderedFeatures(e.point, { layers: ['kurven-linie', 'orte-symbole'].filter((l) => map.getLayer(l)) })
  if (treffer.length) return
  if (p.punkte.length >= 25) return
  if (p.ziehtGerade) return
  merken()
  vorschlagVerwerfen(p)
  if (p.startFehlt) { p.startFehlt = false; p.fehler = null; p.punkte.unshift([e.lngLat.lat, e.lngLat.lng]); p.einpassen = true }
  else p.punkte.push([e.lngLat.lat, e.lngLat.lng])
  if (p.punkte.length === 1) renderPanel()
  neuRechnen()
}

function speichern(name, p, r) {
  if (plan !== p || aktuellesErgebnis(p) !== r || !r) throw new Error('Die Route ist nicht mehr aktuell. Bitte berechne sie erneut.')
  return speichereStrecke({ name, art: 'geplant', pts: r.pts, hoehen: r.hoehen, sekunden: r.sekunden * (p.modus === 'kurvig' ? 1.1 : 1) })
}

function standardName(p, r) {
  return `${p.modus === 'kurvig' ? 'Kurvige ' : ''}${p.rund ? 'Runde' : 'Strecke'} · ${km1(r.meter)} km`
}

function schliessen(nach = null) {
  const p = plan
  if (!p) return
  p.lauf++
  p.abbruch?.abort()
  p.abbruch = null
  plan = null
  p.marker.forEach((m) => m.remove())
  zeichneLinie(null)
  const map = getHubMap()
  map?.off('click', p.klick)
  map?.getCanvas().classList.remove('plan-aktiv')
  document.body.classList.remove('mm-plant')
  document.dispatchEvent(new CustomEvent('mm:kv-peek'))
  if (nach) nach()
  else import('./touren.js').then((m) => m.zeigeTourenListe())
}

/**
 * Planer öffnen (Knopf "Planen" im Touren-Panel).
 * @param {{ fertig?: (id: string) => void }} opts  fertig öffnet eine gespeicherte Strecke
 */
export async function planerOeffnen({ fertig, ziel = null } = {}) {
  const map = getHubMap()
  if (!map?.__mmBereit || !box()) return
  if (plan) schliessen(() => {})
  const { tourenKarteLeeren } = await import('./touren.js')
  tourenKarteLeeren()
  ebene(map)
  plan = { punkte: [], marker: [], modus: 'kurvig', rund: false, ergebnis: null, ergebnisSignatur: null, rechnet: false, lauf: 0, abbruch: null, fertig, vorschlagVias: null, vorschlagKm: null, fehler: null, verlauf: [] }
  plan.klick = aufKarteGetippt
  map.on('click', plan.klick)
  map.getCanvas().classList.add('plan-aktiv')
  document.body.classList.add('mm-plant')
  // Filterleiste und Zähler der Liste ausblenden wie in der Detailansicht
  document.getElementById('kv-touren')?.classList.add('kv-ansicht--detail')
  const zaehler = document.getElementById('tour-count')
  if (zaehler) zaehler.textContent = ''
  renderPanel()
  document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: false } }))

  box().addEventListener('click', planKlick)
  box().addEventListener('submit', planSuche)
  linieZiehenAn(map)
  const u = getUserCoords()
  if (ziel) { mitZiel(ziel, u); return }
  // Weit herausgezoomt tippt man keine sinnvollen Punkte — zum eigenen Standort
  if (map.getZoom() < 9 && u.lat != null) map.flyTo({ center: [u.lng, u.lat], zoom: 11, duration: 800 })
}

/* Aus der Adresssuche: wie "Route" bei Google Maps — Start ist der eigene
   Standort, Ziel die Adresse, die Route steht sofort. Ohne Standort bleibt
   das Ziel gesetzt und der nächste Tipp auf die Karte wird der Start. */
function mitZiel(ziel, u) {
  const p = plan
  p.punkte = [[ziel.lat, ziel.lng, ziel.titel]]
  p.modus = ziel.modus || 'schnell' // zu einer Adresse will man ankommen; "Kurvig" ist einen Tipp entfernt
  const start = (lat, lng) => {
    if (plan !== p) return
    p.startFehlt = false
    p.fehler = null
    p.punkte.unshift([lat, lng, 'Mein Standort'])
    p.einpassen = true
    renderPanel()
    neuRechnen()
  }
  if (u.lat != null) { start(u.lat, u.lng); return }
  p.startFehlt = true
  p.fehler = 'Dein Standort fehlt — tippe den Start auf der Karte an.'
  renderPanel()
  getHubMap()?.flyTo({ center: [ziel.lng, ziel.lat], zoom: 12, duration: 800 })
  navigator.geolocation?.getCurrentPosition((pos) => { if (p.startFehlt) start(pos.coords.latitude, pos.coords.longitude) }, () => {}, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 })
}

/** Ort aus der Suche als nächsten Punkt setzen. */
async function planSuche(e) {
  if (!e.target.matches('[data-plan-suche]')) return
  e.preventDefault()
  const p = plan
  const feld = e.target.querySelector('input')
  const text = feld.value.trim()
  if (!p || !text) return
  // Erst Adressen (Straße, Hausnummer, Ort wie bei Google Maps), sonst eigener Ortsindex
  let ort = null
  try { const a = (await sucheAdressen(text, { limit: 1 }))[0]; if (a) ort = { ok: true, lat: a.lat, lng: a.lng, label: a.titel } } catch { /* Ortsindex */ }
  if (!ort) ort = await resolveOrt(text)
  if (plan !== p) return
  if (!ort.ok) { feld.setCustomValidity('Ort nicht gefunden'); feld.reportValidity(); setTimeout(() => feld.setCustomValidity(''), 1500); return }
  merken()
  vorschlagVerwerfen(p)
  // Gesuchter Name bleibt am Punkt (3. Feld) — die Liste zeigt dann "Titisee" statt "Zwischenpunkt 2"
  p.punkte.push([ort.lat, ort.lng, ort.label || text])
  feld.value = ''
  renderPanel()
  neuRechnen()
  if (p.punkte.length === 1) getHubMap()?.flyTo({ center: [ort.lng, ort.lat], zoom: 10.5, duration: 900 })
  else p.einpassen = true
}

/** Die blaue Linie greifen und ziehen: an der Stelle entsteht ein neuer Zwischenpunkt. */
function linieZiehenAn(map) {
  if (map.__mmPlanZiehen) return
  map.__mmPlanZiehen = true
  const ml = getMapLib()
  let geist = null
  const start = (e) => {
    const p = plan
    if (!aktuellesErgebnis(p) || e.originalEvent?.button > 0) return
    e.preventDefault()
    p.ziehtGerade = true
    map.dragPan.disable()
    const el = document.createElement('div')
    el.className = 'plan-punkt plan-punkt--geist'
    geist = new ml.Marker({ element: el }).setLngLat(e.lngLat).addTo(map)
    const bewegen = (ev) => geist?.setLngLat(ev.lngLat)
    const ende = (ev) => {
      map.off('mousemove', bewegen); map.off('touchmove', bewegen)
      map.off('mouseup', ende); map.off('touchend', ende)
      map.dragPan.enable()
      const ll = (ev.lngLat || geist.getLngLat())
      geist?.remove(); geist = null
      setTimeout(() => { if (plan) plan.ziehtGerade = false }, 50)
      if (plan !== p) return
      merken()
      vorschlagVerwerfen(p)
      einfuegen(ll.lat, ll.lng)
      renderPanel()
      neuRechnen()
    }
    map.on('mousemove', bewegen); map.on('touchmove', bewegen)
    map.on('mouseup', ende); map.on('touchend', ende)
  }
  map.on('mousedown', 'plan-griff', start)
  map.on('touchstart', 'plan-griff', start)
  map.on('mouseenter', 'plan-griff', () => { if (plan) map.getCanvas().style.cursor = 'grab' })
  map.on('mouseleave', 'plan-griff', () => { map.getCanvas().style.cursor = '' })
}

async function planKlick(e) {
  const p = plan
  if (!p) { e.currentTarget.removeEventListener('click', planKlick); return }
  const t = e.target
  const modus = t.closest('[data-plan-modus]')
  if (modus) {
    p.modus = modus.dataset.planModus
    renderPanel()
    // Ein Rundtour-Vorschlag ist schon kurvig ausgesucht — nicht neu rechnen
    if (!(p.vorschlagVias && p.punkte.length === 1)) neuRechnen()
    return
  }
  const rund = t.closest('[data-plan-rund]')
  if (rund) { merken(); p.rund = rund.dataset.planRund === '1'; vorschlagVerwerfen(p); renderPanel(); neuRechnen(); return }
  const weg = t.closest('[data-plan-weg]')
  if (weg) { merken(); p.punkte.splice(+weg.dataset.planWeg, 1); vorschlagVerwerfen(p); if (!p.punkte.length) p.ergebnis = null; renderPanel(); neuRechnen(); return }
  const km = t.closest('[data-vorschlag-km]')
  if (km && p.punkte.length) {
    document.getElementById('plan-vorschlag').hidden = true
    const ziel = +km.dataset.vorschlagKm
    p.punkte = [p.punkte[0]]
    p.rund = true
    p.vorschlagVias = null
    p.vorschlagKm = ziel
    const lauf = neueBerechnung(p)
    const signatur = planSignatur(p)
    const controller = new AbortController()
    p.abbruch = controller
    p.rechnet = true
    renderPanel()
    try {
      // Sechs Rundtouren mit verschiedenem Zufallsstart rechnen lassen und die
      // kurvigste nehmen, deren Länge passt. ORS baut echte Runden ohne Stichwege,
      // die Kurvigkeit messen wir selbst (wie bei den Touren).
      const start = p.punkte[0]
      // ORS plant die Länge über ein Vieleck aus Luftlinien; auf kurvigen Straßen wird die Runde
      // deutlich länger (im Schwarzwald gemessen: Faktor ~1,5)
      const anfrage = Math.round(ziel / 1.5)
      const kandidaten = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((seed) => route([start], { rundtour: { km: anfrage, seed }, signal: controller.signal })))
      if (!gueltigerLauf(p, lauf, signatur, controller)) return
      const ergebnisse = kandidaten.filter((x) => x.status === 'fulfilled').map((x) => x.value)
      const bewertet = ergebnisse.map((r) => {
        const abw = Math.abs(r.meter / 1000 - ziel) / ziel
        return { r, kurven: kurvigkeit(r.pts), abw }
      }).sort((x, y) => (y.kurven * (1 - Math.min(0.9, y.abw))) - (x.kurven * (1 - Math.min(0.9, x.abw))))
      if (!bewertet.length) {
        const fehler = kandidaten.find((x) => x.status === 'rejected' && x.reason instanceof RoutingFehler && x.reason.kind !== 'abbruch')?.reason
        p.fehler = fehler?.message || 'Für diesen Start ließ sich keine Rundtour berechnen — setz die Punkte selbst.'
        return
      }
      const best = bewertet[0].r
      p.vorschlagVias = []
      p.ergebnis = best
      p.ergebnisSignatur = signatur
      p.fehler = null
      p.einpassen = true
      renderPanel()
      zeichneLinie(best.pts)
      einpassen(best.pts)
    } catch (err) {
      if (gueltigerLauf(p, lauf, signatur, controller)) p.fehler = err instanceof RoutingFehler ? err.message : 'Die Rundtour konnte nicht berechnet werden.'
    } finally {
      if (p.abbruch === controller) p.abbruch = null
      if (plan === p && p.lauf === lauf) { p.rechnet = false; renderInfo() }
    }
    return
  }
  const a = t.closest('[data-plan]')
  if (!a) return
  const was = a.dataset.plan
  if (was === 'schliessen') schliessen()
  if (was === 'zurueck' && p.verlauf.length) {
    const alt = p.verlauf.pop()
    Object.assign(p, { punkte: alt.punkte, rund: alt.rund, vorschlagVias: alt.vorschlagVias, vorschlagKm: alt.vorschlagKm })
    if (alt.ergebnis && alt.vorschlagVias) neueBerechnung(p)
    renderPanel()
    if (alt.ergebnis && alt.vorschlagVias) { p.ergebnis = alt.ergebnis; p.ergebnisSignatur = planSignatur(p); p.rechnet = false; zeichneLinie(alt.ergebnis.pts); markerSetzen(); renderInfo() } else neuRechnen()
    return
  }
  if (was === 'leeren') { merken(); p.punkte = []; p.ergebnis = null; vorschlagVerwerfen(p); renderPanel(); neuRechnen() }
  if (was === 'vorschlag') { const v = document.getElementById('plan-vorschlag'); v.hidden = !v.hidden }
  if (was === 'standort') {
    const u = getUserCoords()
    const setze = (lat, lng) => { if (plan !== p) return; p.punkte.unshift([lat, lng]); vorschlagVerwerfen(p); renderPanel(); neuRechnen(); getHubMap()?.flyTo({ center: [lng, lat], zoom: Math.max(getHubMap().getZoom(), 10) }) }
    if (u.lat != null) setze(u.lat, u.lng)
    else navigator.geolocation?.getCurrentPosition((pos) => setze(pos.coords.latitude, pos.coords.longitude), () => hinweisen('Standort nicht verfügbar', 'Tippe den Start einfach auf der Karte an.'), { enableHighAccuracy: true, timeout: 12000 })
  }
  if (was === 'speichern' && aktuellesErgebnis(p)) {
    const r = aktuellesErgebnis(p), lauf = p.lauf
    const name = await eingeben('Name der Strecke', standardName(p, r))
    if (name == null) return
    if (plan !== p || p.lauf !== lauf || aktuellesErgebnis(p) !== r) { hinweisen('Nicht gespeichert', 'Die Route hat sich geändert. Bitte prüfe sie erneut.'); return }
    try {
      const id = speichern(name.trim() || standardName(p, r), p, r)
      schliessen(() => p.fertig?.(PRAEFIX + id))
    } catch (err) { hinweisen('Nicht gespeichert', err.message) }
  }
  if (was === 'fahren' && aktuellesErgebnis(p)) {
    const r = aktuellesErgebnis(p)
    try {
      const name = standardName(p, r)
      const id = speichern(name, p, r)
      const tour = alsTour({ id, name, art: 'geplant', datum: Date.now(), pts: r.pts, hoehen: r.hoehen, sekunden: r.sekunden })
      const d = { pts: r.pts, kum: r.kum, schritte: r.schritte, profil: profilAus(r.pts, r.hoehen) }
      schliessen(() => {})
      const { fahrtVorbereiten } = await import('./tour-fahren.js')
      fahrtVorbereiten(tour, d, { zurueck: () => p.fertig?.(PRAEFIX + id) })
    } catch (err) { hinweisen('Das hat nicht geklappt', err.message) }
  }
}

export const plantGerade = () => !!plan
