/* ═══════════════════════════════════════════════════
   TOUR FAHREN — Navigation entlang einer Tour, ohne die App zu verlassen.

   Folgt dem GPS-Standort auf der vorberechneten Linie (touren/<id>.json):
   nächster Abbiegehinweis mit Entfernung, Rest-Kilometer und -Zeit, Hinweis
   beim Verlassen der Strecke, Ansage per Sprachausgabe, Bildschirm bleibt an.

   Grenzen einer Web-App: bei gesperrtem Bildschirm liefert der Browser keinen
   Standort mehr — deshalb Wake Lock. Neu berechnet wird nicht; wer abweicht,
   bekommt Richtung und Abstand zurück zur Linie.
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { getHubMap, getMapLib, haversineKm } from './karte.js'

const ABSEITS_M = 70 // ab hier gilt man als neben der Strecke
const ANSAGEN_M = [500, 120] // Ansagen vor einem Hinweis

let fahrt = null

const RICHTUNG = {
  left: 'links', right: 'rechts', 'slight left': 'leicht links', 'slight right': 'leicht rechts',
  'sharp left': 'scharf links', 'sharp right': 'scharf rechts', straight: 'geradeaus', uturn: 'wenden',
}

/** Hinweis als Satz: "Rechts abbiegen auf L 782". */
function satz([, art, richtung, strasse, ausfahrt]) {
  const r = RICHTUNG[richtung] || ''
  const auf = strasse ? ` auf ${strasse}` : ''
  switch (art) {
    case 'arrive': return 'Ziel erreicht'
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return `Im Kreisverkehr ${ausfahrt ? `die ${ausfahrt}. Ausfahrt` : 'ausfahren'}${auf}`
    case 'exit roundabout': case 'exit rotary': return `Kreisverkehr verlassen${auf}`
    case 'merge': return `Einfädeln${auf}`
    case 'on ramp': return `Auffahrt ${r}${auf}`.replace('  ', ' ')
    case 'off ramp': return `Ausfahrt ${r}${auf}`.replace('  ', ' ')
    case 'fork': return `An der Gabelung ${r} halten${auf}`
    case 'end of road': return `Am Ende der Straße ${r}${auf}`
    default:
      if (richtung === 'uturn') return 'Wenden'
      if (richtung === 'straight') return `Geradeaus${auf}`
      return `${r.charAt(0).toUpperCase() + r.slice(1)} abbiegen${auf}`
  }
}

function pfeil([, art, richtung]) {
  if (art === 'arrive') return '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>'
  if (/roundabout|rotary/.test(art)) return '<svg viewBox="0 0 24 24"><circle cx="12" cy="11" r="4.5"/><path d="M12 15.5V22M16 7.5l3-3M19 4.5h-3.5M19 4.5V8"/></svg>'
  const winkel = { left: -90, right: 90, 'slight left': -45, 'slight right': 45, 'sharp left': -135, 'sharp right': 135, uturn: 180 }[richtung] ?? 0
  return `<svg viewBox="0 0 24 24"><g transform="rotate(${winkel} 12 13)"><path d="M12 21V6M6 11l6-6 6 6"/></g></svg>`
}

const mFormat = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',')} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`)

function sprich(text, ton = fahrt?.ton) {
  if (!ton || !('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'de-DE'
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {}
}

/** Nächster Punkt der Linie: erst im Fenster um den letzten Treffer, sonst überall. */
function aufLinie(lat, lng) {
  const { pts, kum } = fahrt.d
  const suche = (von, bis) => {
    let best = -1, bestD = Infinity
    for (let i = Math.max(0, von); i < Math.min(pts.length, bis); i++) {
      const d = haversineKm(lat, lng, pts[i][0], pts[i][1])
      if (d < bestD) { bestD = d; best = i }
    }
    return [best, bestD * 1000]
  }
  let [i, m] = suche(fahrt.index - 30, fahrt.index + 400)
  if (m > ABSEITS_M) {
    const [j, mj] = suche(0, pts.length)
    // Global nur übernehmen, wenn es deutlich näher ist (Rundtour: Start = Ziel)
    if (mj < m - 30) { i = j; m = mj }
  }
  return { index: i, abstand: m, meter: kum[i] }
}

function zeichne() {
  const f = fahrt
  if (!f) return
  const { schritte } = f.d
  const gesamt = f.d.kum[f.d.kum.length - 1]
  const faktor = gesamt / (schritte[schritte.length - 1][0] || gesamt) // OSRM-Meter → Meter der Linie
  while (f.schritt < schritte.length - 1 && schritte[f.schritt][0] * faktor < f.meter - 15) f.schritt++
  const naechster = schritte[f.schritt]
  const bis = Math.max(0, naechster[0] * faktor - f.meter)
  const rest = Math.max(0, gesamt - f.meter)
  const restMin = Math.round((rest / gesamt) * f.t.min)
  const an = new Date(Date.now() + restMin * 60000)

  const box = f.el
  box.querySelector('.fahrt-pfeil').innerHTML = pfeil(naechster)
  box.querySelector('.fahrt-bis').textContent = f.gestartet ? mFormat(bis) : ''
  box.querySelector('.fahrt-satz').textContent = f.gestartet ? satz(naechster) : 'Warte auf GPS…'
  box.querySelector('.fahrt-rest').textContent = `${mFormat(rest)}`
  box.querySelector('.fahrt-zeit').textContent = `${Math.floor(restMin / 60)}:${String(restMin % 60).padStart(2, '0')} Std`
  box.querySelector('.fahrt-an').textContent = an.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  box.querySelector('.fahrt-fortschritt i').style.width = `${Math.min(100, (f.meter / gesamt) * 100)}%`

  const abseits = box.querySelector('.fahrt-abseits')
  if (f.gestartet && f.abstand > ABSEITS_M) {
    abseits.hidden = false
    abseits.textContent = f.meter < 50 && f.abstand > 1000
      ? `Zum Start der Tour: ${mFormat(f.abstand)} Luftlinie`
      : `Neben der Tour — ${mFormat(f.abstand)} zurück zur Linie`
  } else abseits.hidden = true

  // Ansagen, je Hinweis jede Stufe einmal
  if (f.gestartet && f.abstand <= ABSEITS_M) {
    for (const stufe of ANSAGEN_M) {
      const schluessel = `${f.schritt}-${stufe}`
      if (bis <= stufe && !f.angesagt.has(schluessel)) {
        f.angesagt.add(schluessel)
        sprich(naechster[1] === 'arrive' ? (bis < 60 ? 'Ziel erreicht' : `In ${mFormat(bis)} Ziel erreicht`) : `In ${mFormat(bis).replace(' ', ' ')} ${satz(naechster)}`)
        break
      }
    }
  }
}

function position(pos) {
  const f = fahrt
  if (!f) return
  const { latitude: lat, longitude: lng, heading } = pos.coords
  const l = aufLinie(lat, lng)
  f.abstand = l.abstand
  if (l.abstand <= ABSEITS_M) { f.index = l.index; f.meter = Math.max(f.meter, l.meter) }
  f.gestartet = true
  const map = getHubMap()
  // Fahrtrichtung: GPS-Kurs, sonst die Richtung der Linie an dieser Stelle
  let kurs = Number.isFinite(heading) ? heading : null
  if (kurs == null) {
    const a = f.d.pts[f.index], b = f.d.pts[Math.min(f.index + 3, f.d.pts.length - 1)]
    kurs = (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI
  }
  f.marker.setLngLat([lng, lat])
  f.marker.getElement().style.setProperty('--kurs', `${kurs - (map?.getBearing() || 0)}deg`)
  // Position ins untere Drittel, damit vorne mehr Strecke zu sehen ist
  if (map && f.folgen) {
    const h = map.getContainer().clientHeight
    map.easeTo({ center: [lng, lat], bearing: kurs, zoom: Math.max(map.getZoom(), 15.5), pitch: 50, duration: 800, padding: { top: Math.round(h * 0.42), bottom: 0, left: 0, right: 0 } })
  }
  zeichne()
  if (f.d.schritte[f.schritt][1] === 'arrive' && f.meter > f.d.kum[f.d.kum.length - 1] - 60) beenden(true)
}

async function wachHalten() {
  try { fahrt.wach = await navigator.wakeLock?.request('screen') } catch {}
}

/**
 * Fahrmodus starten.
 * @param {object} t Tour aus index.json, d = { pts, kum, schritte }
 */
export function starteFahrt(t, d, { onEnde } = {}) {
  if (fahrt) beenden()
  const map = getHubMap(), ml = getMapLib()
  const host = document.querySelector('.konf-karte-hub .kv-map-wrap')
  if (!map || !ml || !host || !d.schritte?.length) return false
  if (!navigator.geolocation) { alert('Dein Browser gibt keinen Standort frei — ohne GPS kann die Tour nicht geführt werden.'); return false }

  const el = document.createElement('div')
  el.className = 'fahrt'
  el.innerHTML = `
    <div class="fahrt-oben">
      <div class="fahrt-pfeil" aria-hidden="true"></div>
      <div class="fahrt-hinweis">
        <div class="fahrt-bis"></div>
        <div class="fahrt-satz">Warte auf GPS…</div>
      </div>
    </div>
    <div class="fahrt-abseits" hidden></div>
    <div class="fahrt-unten">
      <div class="fahrt-fortschritt"><i></i></div>
      <div class="fahrt-zahlen">
        <div><strong class="fahrt-rest"></strong><span>Rest</span></div>
        <div><strong class="fahrt-zeit"></strong><span>Fahrzeit</span></div>
        <div><strong class="fahrt-an"></strong><span>Ankunft</span></div>
      </div>
      <div class="fahrt-knoepfe">
        <button type="button" class="fahrt-btn" data-fahrt="ton" aria-pressed="true">Ton an</button>
        <button type="button" class="fahrt-btn" data-fahrt="folgen" hidden>Zentrieren</button>
        <button type="button" class="fahrt-btn fahrt-btn--ende" data-fahrt="ende">Beenden</button>
      </div>
      <div class="fahrt-name">${esc(t.name)}</div>
    </div>`
  host.appendChild(el)
  document.querySelector('.konf-karte-hub')?.classList.add('kv-faehrt')

  const pfeilEl = document.createElement('div')
  pfeilEl.className = 'fahrt-position'
  // MapLibre setzt transform am Marker-Element selbst — gedreht wird das Kind
  pfeilEl.innerHTML = '<div class="fahrt-position-pfeil"></div>'
  fahrt = {
    t, d, el, onEnde,
    index: 0, meter: 0, schritt: 0, abstand: 0, gestartet: false, folgen: true, ton: true,
    angesagt: new Set(),
    marker: new ml.Marker({ element: pfeilEl, rotationAlignment: 'viewport' }).setLngLat([d.pts[0][1], d.pts[0][0]]).addTo(map),
    watch: null, wach: null,
  }
  map.setMaxPitch(60)
  // Nutzer verschiebt die Karte → nicht mehr hinterherfahren, bis "Zentrieren"
  fahrt.wegschieben = (e) => {
    if (!e.originalEvent || !fahrt) return
    fahrt.folgen = false
    el.querySelector('[data-fahrt="folgen"]').hidden = false
  }
  map.on('dragstart', fahrt.wegschieben)

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fahrt]')
    if (!b || !fahrt) return
    if (b.dataset.fahrt === 'ende') beenden()
    if (b.dataset.fahrt === 'folgen') { fahrt.folgen = true; b.hidden = true }
    if (b.dataset.fahrt === 'ton') {
      fahrt.ton = !fahrt.ton
      b.textContent = fahrt.ton ? 'Ton an' : 'Ton aus'
      b.setAttribute('aria-pressed', String(fahrt.ton))
      if (!fahrt.ton) try { speechSynthesis.cancel() } catch {}
    }
  })
  fahrt.sichtbar = () => { if (document.visibilityState === 'visible' && fahrt && !fahrt.wach) wachHalten() }
  document.addEventListener('visibilitychange', fahrt.sichtbar)

  wachHalten()
  fahrt.watch = navigator.geolocation.watchPosition(position, (err) => {
    if (!fahrt) return
    fahrt.el.querySelector('.fahrt-satz').textContent = err.code === 1 ? 'Standort nicht freigegeben' : 'Kein GPS-Signal'
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 })
  sprich(`Tour ${t.name}. Gute Fahrt.`)
  zeichne()
  return true
}

export function beenden(ziel = false) {
  const f = fahrt
  if (!f) return
  fahrt = null
  if (f.watch != null) navigator.geolocation.clearWatch(f.watch)
  try { f.wach?.release() } catch {}
  document.removeEventListener('visibilitychange', f.sichtbar)
  const map = getHubMap()
  map?.off('dragstart', f.wegschieben)
  f.marker.remove()
  f.el.remove()
  document.querySelector('.konf-karte-hub')?.classList.remove('kv-faehrt')
  if (map) { map.easeTo({ pitch: 0, bearing: 0, duration: 600, padding: { top: 0, bottom: 0, left: 0, right: 0 } }); map.once('moveend', () => map.setMaxPitch(0)) }
  if (ziel) sprich('Ziel erreicht. Sch\u00f6ne Tour gewesen.', f.ton)
  f.onEnde?.(ziel)
}

export const faehrtGerade = () => !!fahrt
