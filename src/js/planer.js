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
import { getHubMap, getMapLib, haversineKm, getUserCoords } from './karte.js'
import { route, RoutingFehler } from './routing.js'
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
    const letzter = i === plan.punkte.length - 1 && i > 0 && !plan.rund
    el.className = `plan-punkt${i === 0 ? ' plan-punkt--start' : letzter ? ' plan-punkt--ziel' : ''}`
    el.textContent = i === 0 ? 'S' : letzter ? 'Z' : String(i)
    const m = new ml.Marker({ element: el, draggable: true }).setLngLat([p[1], p[0]]).addTo(map)
    m.on('dragend', () => {
      const ll = m.getLngLat()
      plan.punkte[i] = [ll.lat, ll.lng]
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

// ── Rechnen ──────────────────────────────────────────────────────────────

async function neuRechnen() {
  const p = plan
  if (!p) return
  markerSetzen()
  renderInfo()
  const kette = p.rund && p.punkte.length > 1 ? [...p.punkte, p.punkte[0]] : p.punkte
  const vorschlag = p.vorschlagVias && p.punkte.length === 1
  if (!vorschlag && kette.length < 2) { p.ergebnis = null; p.rechnet = false; zeichneLinie(null); renderInfo(); return }
  const lauf = ++p.lauf
  p.rechnet = true
  renderInfo()
  try {
    let wegpunkte = kette
    if (vorschlag) wegpunkte = [p.punkte[0], ...p.vorschlagVias, p.punkte[0]]
    else if (p.modus === 'kurvig') {
      wegpunkte = [kette[0]]
      for (let i = 1; i < kette.length; i++) {
        const vias = await kurvigeVias(kette[i - 1], kette[i])
        wegpunkte.push(...vias, kette[i])
      }
    }
    if (wegpunkte.length > MAX_PUNKTE) wegpunkte = [wegpunkte[0], ...wegpunkte.slice(1, -1).filter((_, i, arr) => i % Math.ceil(arr.length / (MAX_PUNKTE - 2)) === 0), wegpunkte[wegpunkte.length - 1]]
    if (wegpunkte.length < 2) { p.rechnet = false; renderInfo(); return }
    const r = await route(wegpunkte)
    if (plan !== p || lauf !== p.lauf) return
    p.ergebnis = r
    p.fehler = null
    zeichneLinie(r.pts)
    if (p.einpassen) { p.einpassen = false; einpassen(r.pts) }
  } catch (err) {
    if (plan !== p || lauf !== p.lauf) return
    p.fehler = err instanceof RoutingFehler ? err.message : 'Die Route konnte nicht berechnet werden.'
  } finally {
    if (plan === p && lauf === p.lauf) { p.rechnet = false; renderInfo() }
  }
}

// ── Panel ────────────────────────────────────────────────────────────────

function box() { return document.getElementById('tour-liste') }

function renderInfo() {
  const p = plan, el = document.getElementById('plan-info')
  if (!p || !el) return
  const r = p.ergebnis
  const nPunkte = p.punkte.length
  el.innerHTML = `
    ${nPunkte === 0 ? '<p class="plan-tipp">Tippe auf die Karte, um den Start zu setzen — oder nimm deinen Standort.</p>'
      : nPunkte === 1 && !p.vorschlagVias ? '<p class="plan-tipp">Jetzt das Ziel antippen. Oder lass dir eine Rundtour ab hier vorschlagen.</p>' : ''}
    ${p.fehler ? `<p class="fahrt-start-fehler">${esc(p.fehler)}</p>` : ''}
    ${r ? `<div class="plan-zahlen${p.rechnet ? ' plan-zahlen--alt' : ''}">
      <div><strong>${km1(r.meter)} km</strong><span>Distanz</span></div>
      <div><strong>${dauer(r.sekunden * (p.modus === 'kurvig' ? 1.1 : 1))}</strong><span>Fahrzeit</span></div>
      <div><strong>${r.auf} m</strong><span>Bergauf</span></div>
      <div><strong>${(r.kurven ??= kurvigkeit(r.pts))}°/km</strong><span>Kurvigkeit</span></div>
    </div>` : p.rechnet ? '<div class="fahrt-laedt"><span class="hub-map-spinner"></span> Route wird berechnet…</div>' : ''}
    ${nPunkte ? `<ol class="plan-liste">${p.punkte.map((pt, i) => `<li><span class="plan-nr">${i === 0 ? 'S' : i === nPunkte - 1 && !p.rund ? 'Z' : i}</span><span>${i === 0 ? 'Start' : i === nPunkte - 1 && !p.rund ? 'Ziel' : `Zwischenpunkt ${i}`}</span><button type="button" class="plan-weg" data-plan-weg="${i}" aria-label="Punkt entfernen">×</button></li>`).join('')}</ol>` : ''}
    ${r ? `<div class="plan-aktionen">
      <button type="button" class="fahrt-los" data-plan="fahren">Losfahren</button>
      <button type="button" class="tour-btn" data-plan="speichern">Speichern</button>
    </div>` : ''}`
}

function renderPanel() {
  const p = plan, b = box()
  if (!p || !b) return
  b.innerHTML = `<div class="fahrt-start plan">
    <button type="button" class="tour-zurueck" data-plan="schliessen">‹ Zurück</button>
    <h2 class="fahrt-start-titel">Route planen</h2>
    <div class="fahrt-wahl">
      <div class="fahrt-wahl-zeile"><span>Strecke</span>
        <div class="fahrt-schalter" role="group">
          <button type="button" data-plan-modus="kurvig" aria-pressed="${p.modus === 'kurvig'}">Kurvig</button>
          <button type="button" data-plan-modus="schnell" aria-pressed="${p.modus === 'schnell'}">Schnell</button>
        </div>
      </div>
      <div class="fahrt-wahl-zeile"><span>Zurück zum Start</span>
        <div class="fahrt-schalter" role="group">
          <button type="button" data-plan-rund="1" aria-pressed="${p.rund}">Rundtour</button>
          <button type="button" data-plan-rund="0" aria-pressed="${!p.rund}">Bis zum Ziel</button>
        </div>
      </div>
    </div>
    <div class="plan-werkzeuge">
      <button type="button" class="tour-btn" data-plan="standort">Mein Standort als Start</button>
      <button type="button" class="tour-btn" data-plan="vorschlag" ${p.punkte.length ? '' : 'disabled'}>Rundtour vorschlagen</button>
      <button type="button" class="tour-link-btn" data-plan="leeren" ${p.punkte.length ? '' : 'hidden'}>Alles löschen</button>
    </div>
    <div class="plan-vorschlag" id="plan-vorschlag" hidden>
      <span>Wie lang?</span>
      ${[60, 100, 150, 200].map((k) => `<button type="button" class="tour-option" data-vorschlag-km="${k}">${k} km</button>`).join('')}
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
  p.vorschlagVias = null
  p.punkte.push([e.lngLat.lat, e.lngLat.lng])
  if (p.punkte.length === 1) renderPanel()
  neuRechnen()
}

async function speichern(name) {
  const p = plan
  const r = p.ergebnis
  return speichereStrecke({ name, art: 'geplant', pts: r.pts, hoehen: r.hoehen, sekunden: r.sekunden * (p.modus === 'kurvig' ? 1.1 : 1) })
}

function standardName() {
  const r = plan.ergebnis
  return `${plan.modus === 'kurvig' ? 'Kurvige ' : ''}${plan.rund ? 'Runde' : 'Strecke'} · ${km1(r.meter)} km`
}

function schliessen(nach = null) {
  const p = plan
  if (!p) return
  plan = null
  p.marker.forEach((m) => m.remove())
  zeichneLinie(null)
  const map = getHubMap()
  map?.off('click', p.klick)
  map?.getCanvas().classList.remove('plan-aktiv')
  if (nach) nach()
  else import('./touren.js').then((m) => m.zeigeTourenListe())
}

/**
 * Planer öffnen (Knopf "Planen" im Touren-Panel).
 * @param {{ fertig?: (id: string) => void }} opts  fertig öffnet eine gespeicherte Strecke
 */
export async function planerOeffnen({ fertig } = {}) {
  const map = getHubMap()
  if (!map?.__mmBereit || !box()) return
  if (plan) schliessen(() => {})
  const { tourenKarteLeeren } = await import('./touren.js')
  tourenKarteLeeren()
  ebene(map)
  plan = { punkte: [], marker: [], modus: 'kurvig', rund: false, ergebnis: null, rechnet: false, lauf: 0, fertig, vorschlagVias: null, fehler: null }
  plan.klick = aufKarteGetippt
  map.on('click', plan.klick)
  map.getCanvas().classList.add('plan-aktiv')
  // Filterleiste und Zähler der Liste ausblenden wie in der Detailansicht
  document.getElementById('kv-touren')?.classList.add('kv-ansicht--detail')
  const zaehler = document.getElementById('tour-count')
  if (zaehler) zaehler.textContent = ''
  renderPanel()
  document.dispatchEvent(new CustomEvent('mm:kv-sheet', { detail: { auf: false } }))

  box().addEventListener('click', planKlick)
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
  if (rund) { p.rund = rund.dataset.planRund === '1'; p.vorschlagVias = null; renderPanel(); neuRechnen(); return }
  const weg = t.closest('[data-plan-weg]')
  if (weg) { p.punkte.splice(+weg.dataset.planWeg, 1); p.vorschlagVias = null; if (!p.punkte.length) p.ergebnis = null; renderPanel(); neuRechnen(); return }
  const km = t.closest('[data-vorschlag-km]')
  if (km && p.punkte.length) {
    document.getElementById('plan-vorschlag').hidden = true
    p.punkte = [p.punkte[0]]
    p.rund = true
    p.rechnet = true
    renderPanel()
    try {
      // Sechs Rundtouren mit verschiedenem Zufallsstart rechnen lassen und die
      // kurvigste nehmen, deren Länge passt. ORS baut echte Runden ohne Stichwege,
      // die Kurvigkeit messen wir selbst (wie bei den Touren).
      const ziel = +km.dataset.vorschlagKm
      const start = p.punkte[0]
      // ORS plant die Länge über ein Vieleck aus Luftlinien; auf kurvigen Straßen wird die Runde
      // deutlich länger (im Schwarzwald gemessen: Faktor ~1,5)
      const anfrage = Math.round(ziel / 1.5)
      const ergebnisse = (await Promise.all([1, 2, 3, 4, 5, 6].map((seed) => route([start], { rundtour: { km: anfrage, seed } }).catch(() => null)))).filter(Boolean)
      if (plan !== p) return
      const bewertet = ergebnisse.map((r) => {
        const abw = Math.abs(r.meter / 1000 - ziel) / ziel
        return { r, kurven: kurvigkeit(r.pts), abw }
      }).sort((x, y) => (y.kurven * (1 - Math.min(0.9, y.abw))) - (x.kurven * (1 - Math.min(0.9, x.abw))))
      if (!bewertet.length) { p.fehler = 'Für diesen Start ließ sich keine Rundtour berechnen — setz die Punkte selbst.'; p.rechnet = false; renderInfo(); return }
      const best = bewertet[0].r
      p.lauf++
      p.vorschlagVias = []
      p.ergebnis = best
            p.rund = true
      p.rechnet = false
      p.fehler = null
      p.einpassen = true
      renderPanel()
      zeichneLinie(best.pts)
      einpassen(best.pts)
    } catch { p.rechnet = false; renderInfo() }
    return
  }
  const a = t.closest('[data-plan]')
  if (!a) return
  const was = a.dataset.plan
  if (was === 'schliessen') schliessen()
  if (was === 'leeren') { p.punkte = []; p.ergebnis = null; p.vorschlagVias = null; renderPanel(); neuRechnen() }
  if (was === 'vorschlag') { const v = document.getElementById('plan-vorschlag'); v.hidden = !v.hidden }
  if (was === 'standort') {
    const u = getUserCoords()
    const setze = (lat, lng) => { p.punkte.unshift([lat, lng]); p.vorschlagVias = null; renderPanel(); neuRechnen(); getHubMap()?.flyTo({ center: [lng, lat], zoom: Math.max(getHubMap().getZoom(), 10) }) }
    if (u.lat != null) setze(u.lat, u.lng)
    else navigator.geolocation?.getCurrentPosition((pos) => setze(pos.coords.latitude, pos.coords.longitude), () => alert('Standort nicht verfügbar — tippe den Start auf der Karte an.'), { enableHighAccuracy: true, timeout: 12000 })
  }
  if (was === 'speichern' && p.ergebnis) {
    const name = prompt('Name der Strecke', standardName())
    if (name == null) return
    try {
      const id = await speichern(name.trim() || standardName())
      schliessen(() => p.fertig?.(PRAEFIX + id))
    } catch (err) { alert(err.message) }
  }
  if (was === 'fahren' && p.ergebnis) {
    try {
      const id = await speichern(standardName())
      const r = p.ergebnis
      const tour = alsTour({ id, name: standardName(), art: 'geplant', datum: Date.now(), pts: r.pts, hoehen: r.hoehen, sekunden: r.sekunden })
      const d = { pts: r.pts, kum: r.kum, schritte: r.schritte, profil: profilAus(r.pts, r.hoehen) }
      schliessen(() => {})
      const { fahrtVorbereiten } = await import('./tour-fahren.js')
      fahrtVorbereiten(tour, d, { zurueck: () => p.fertig?.(PRAEFIX + id) })
    } catch (err) { alert(err.message) }
  }
}

export const plantGerade = () => !!plan
