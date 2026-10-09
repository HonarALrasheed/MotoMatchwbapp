/* ═══════════════════════════════════════════════════
   AUFZEICHNEN AUF DER KARTE — eine Fahrt mitschneiden wie bei Strava.

   Die Messung selbst macht ride-tracker.js (Filter gegen GPS-Sprünge,
   automatische Pause, Höhenmeter, Sicherung gegen Neuladen). Hier: die
   Anzeige über der Karte, die wachsende Linie, Speichern ins Fahrtenbuch
   (eigene-strecken.js → dasselbe Format wie im Profil).

   Standortdaten bleiben auf dem Gerät; die Aufzeichnung startet nur auf
   Knopfdruck und ist die ganze Zeit sichtbar.
   ═══════════════════════════════════════════════════ */

import { esc } from './util.js'
import { hinweisen, fragen, standortGesperrt } from './meldung.js'
import { getHubMap, getMapLib, getUserCoords, haversineKm } from './karte.js'
import { route } from './routing.js'
import { starteAufzeichnung, ladeUnterbrocheneAufzeichnung, verwerfeGesicherteAufzeichnung, bestaetigeGespeicherteFahrt, formatiereDauer, standortVerfuegbar } from './ride-tracker.js'
import { speichereFahrt, fahrtSichernAlsDatei, PRAEFIX } from './eigene-strecken.js'

let lauf = null

const LEER = { type: 'FeatureCollection', features: [] }
const kmText = (km) => km.toFixed(km >= 100 ? 0 : 1).replace('.', ',')

function ebene(map) {
  if (map.getSource('aufnahme')) return
  map.addSource('aufnahme', { type: 'geojson', data: LEER })
  map.addLayer({ id: 'aufnahme-rand', type: 'line', source: 'aufnahme', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } })
  map.addLayer({ id: 'aufnahme-linie', type: 'line', source: 'aufnahme', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#e63946', 'line-width': 4.5 } })
}

function zeichneLinie(punkte) {
  const map = getHubMap()
  if (!map?.getSource('aufnahme')) return
  map.getSource('aufnahme').setData(punkte.length > 1
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: punkte.map((p) => [p.lon, p.lat]) } }
    : LEER)
}

function zeige(stand) {
  const l = lauf
  if (!l) return
  const el = l.el
  el.querySelector('[data-wert="zeit"]').textContent = formatiereDauer(stand.fahrMs)
  el.querySelector('[data-wert="km"]').textContent = kmText(stand.km)
  el.querySelector('[data-wert="zeit-kurz"]').textContent = formatiereDauer(stand.fahrMs)
  el.querySelector('[data-wert="km-kurz"]').textContent = kmText(stand.km)
  el.querySelector('[data-wert="tempo"]').textContent = Math.round(stand.tempoKmh || 0)
  el.querySelector('[data-wert="schnitt"]').textContent = Math.round(stand.schnittKmh || 0)
  el.querySelector('[data-wert="hoehe"]').textContent = Math.round(stand.hoehenMeter || 0)
  el.classList.toggle('aufnahme--ruht', stand.ruht)
  el.querySelector('.aufnahme-status').textContent = stand.pausiert ? 'Pausiert' : stand.autoPause ? 'Automatische Pause' : 'Aufnahme läuft'
  el.querySelector('[data-auf="pause"]').textContent = stand.pausiert ? 'Weiter' : 'Pause'
  zeichneLinie(stand.punkte)
  const letzter = stand.punkte[stand.punkte.length - 1]
  const map = getHubMap()
  if (letzter && map) {
    setzeMarker(letzter.lat, letzter.lon)
    if (l.folgen) map.easeTo({ center: [letzter.lon, letzter.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 700 })
  }
}

/** Karte groß/klein: am Griff oder Kopf ziehen (hoch = groß, runter = klein) oder antippen. */
function ziehbar(el) {
  let y0 = null, gezogen = false
  el.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.aufnahme-griff, .aufnahme-kopf') || e.target.closest('button')) return
    y0 = e.clientY
    el.setPointerCapture?.(e.pointerId)
  })
  el.addEventListener('pointerup', (e) => {
    if (y0 == null) return
    const dy = e.clientY - y0
    y0 = null
    if (Math.abs(dy) <= 20) return // Tipp: erst im click umschalten
    gezogen = true
    // Größe erst nach dem Loslassen ändern — sonst liegt unter dem Finger
    // plötzlich "Pause" und der nachfolgende Klick trifft ihn
    requestAnimationFrame(() => el.classList.toggle('aufnahme--klein', dy > 0))
  })
  el.addEventListener('click', (e) => {
    if (gezogen) { gezogen = false; return }
    if (!e.target.closest('.aufnahme-griff, .aufnahme-kopf') || e.target.closest('button')) return
    el.classList.toggle('aufnahme--klein')
  })
  el.addEventListener('pointercancel', () => { y0 = null })
}

/** Eigener Punkt mit Profilbild — derselbe wie sonst auf der Karte. */
function setzeMarker(lat, lon) {
  const l = lauf, map = getHubMap(), ml = getMapLib()
  if (!l || !map || !ml) return
  if (l.marker) { l.marker.setLngLat([lon, lat]); return }
  const m = document.createElement('div')
  m.className = 'mm-standort-punkt aufnahme-ich'
  import('./freunde-karte.js').then((f) => f.eigenesBild(m)).catch(() => {})
  l.marker = new ml.Marker({ element: m }).setLngLat([lon, lat]).addTo(map)
}

/* GPS-Lücken (Browser im Hintergrund) über die Straßen ergänzen statt sie
   als Luftlinie zu speichern. Liefert die ergänzten Kilometer. */
async function lueckenFuellen(fahrt) {
  const luecken = (fahrt.luecken || []).slice(0, 12)
  if (!luecken.length) return 0
  let ergaenzt = 0
  for (const i of [...luecken].sort((a, b) => b - a)) {
    const a = fahrt.punkte[i], b = fahrt.punkte[i + 1]
    if (!a || !b || haversineKm(a[0], a[1], b[0], b[1]) > 150) continue
    try {
      const r = await route([[a[0], a[1]], [b[0], b[1]]])
      const innen = r.pts.slice(1, -1)
      const n = innen.length + 1
      fahrt.punkte.splice(i + 1, 0, ...innen.map(([la, ln], k) => [+la.toFixed(5), +ln.toFixed(5), Math.round(a[2] + ((b[2] - a[2]) * (k + 1)) / n), null]))
      ergaenzt += r.meter / 1000
    } catch { /* ohne Netz bleibt die Lücke gerade */ }
  }
  let km = 0
  for (let k = 1; k < fahrt.punkte.length; k++) km += haversineKm(fahrt.punkte[k - 1][0], fahrt.punkte[k - 1][1], fahrt.punkte[k][0], fahrt.punkte[k][1])
  fahrt.km = +km.toFixed(2)
  fahrt.ergaenztKm = +ergaenzt.toFixed(1)
  if (fahrt.fahrMs > 0) fahrt.schnittKmh = +(km / (fahrt.fahrMs / 3600000)).toFixed(1)
  return ergaenzt
}

function abbauen() {
  const l = lauf
  if (!l) return
  lauf = null
  l.marker?.remove()
  l.el.remove()
  zeichneLinie([])
  document.querySelector('.konf-karte-hub')?.classList.remove('kv-faehrt')
  document.body.classList.remove('mm-faehrt')
  const map = getHubMap()
  if (l.wegschieben) map?.off('dragstart', l.wegschieben)
}

/** Name eingeben und ins Fahrtenbuch speichern. */
function speichernFragen(fahrt) {
  const l = lauf
  const datum = new Date(fahrt.start).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
  const stunde = new Date(fahrt.start).getHours()
  const tageszeit = stunde < 11 ? 'Morgenrunde' : stunde < 17 ? 'Ausfahrt' : 'Abendrunde'
  l.el.innerHTML = `
    <div class="aufnahme-speichern">
      <strong>Fahrt speichern</strong>
      <span>${kmText(fahrt.km)} km · ${formatiereDauer(fahrt.fahrMs)} · Ø ${Math.round(fahrt.schnittKmh)} km/h</span>
      ${fahrt.ergaenztKm ? `<span class="aufnahme-ergaenzt">${kmText(fahrt.ergaenztKm)} km ohne GPS (Handy gesperrt oder andere App vorn) — über die Straße ergänzt.</span>` : ''}
      <input type="text" class="aufnahme-name" maxlength="80" value="${esc(`${tageszeit} am ${datum}`)}" aria-label="Name der Fahrt">
      <div class="aufnahme-knoepfe">
        <button type="button" class="aufnahme-btn" data-auf="weg">Verwerfen</button>
        <button type="button" class="aufnahme-btn aufnahme-btn--haupt" data-auf="sichern">Speichern</button>
      </div>
      <button type="button" class="aufnahme-btn" data-auf="datei" hidden>Sicherung herunterladen</button>
    </div>`
  const name = l.el.querySelector('.aufnahme-name')
  name.focus(); name.select()
  l.el.querySelector('[data-auf="sichern"]').addEventListener('click', async () => {
    try {
      const id = speichereFahrt(fahrt, name.value.trim())
      if (!await bestaetigeGespeicherteFahrt(fahrt)) hinweisen('Fahrt gespeichert', 'Der Wiederherstellungsstand konnte nicht entfernt werden und bleibt erhalten.')
      const fertig = l.fertig
      abbauen()
      fertig?.(PRAEFIX + id)
    } catch (err) {
      l.el.querySelector('[data-auf="datei"]').hidden = false
      hinweisen('Nicht gespeichert', `${err.message} Die Fahrt bleibt hier für einen erneuten Versuch. Du kannst eine Sicherung herunterladen.`)
    }
  })
  l.el.querySelector('[data-auf="datei"]').addEventListener('click', () => {
    try { fahrtSichernAlsDatei(fahrt) } catch { hinweisen('Sicherung fehlgeschlagen', 'Die Datei konnte nicht heruntergeladen werden. Die Fahrt bleibt hier für einen erneuten Versuch.') }
  })
  l.el.querySelector('[data-auf="weg"]').addEventListener('click', async () => {
    if (await fragen('Fahrt verwerfen?', 'Die aufgezeichnete Strecke geht dabei verloren.', { ja: 'Verwerfen', gefahr: true })) {
      if (!await verwerfeGesicherteAufzeichnung(fahrt.id)) { hinweisen('Nicht verworfen', 'Der Wiederherstellungsstand konnte nicht entfernt werden.'); return }
      abbauen()
    }
  })
  if (fahrt.wiederherstellungGesichert === false) {
    l.el.querySelector('[data-auf="datei"]').hidden = false
    hinweisen('Fahrt nicht dauerhaft gesichert', 'Speichere sie jetzt oder lade eine Sicherung herunter. Schließe die Seite vorher nicht.')
  }
}

/**
 * Aufzeichnung starten (Knopf "Aufzeichnen" im Touren-Panel).
 * @param {{ fertig?: (id: string) => void }} opts  fertig bekommt die id der gespeicherten Fahrt
 */
export async function aufzeichnungStarten({ fertig } = {}) {
  if (lauf) return
  const map = getHubMap()
  const host = document.querySelector('.konf-karte-hub .kv-map-wrap')
  if (!map || !host) return
  if (!standortVerfuegbar()) { hinweisen('Kein Standort', 'Dieser Browser gibt keinen Standort frei — ohne GPS lässt sich nichts aufzeichnen.'); return }
  let fortsetzen = null
  let offen
  try { offen = await ladeUnterbrocheneAufzeichnung() }
  catch (error) { hinweisen('Fahrt nicht geöffnet', error.message); return }
  if (offen?.fertig) {
    const el = document.createElement('div')
    el.className = 'aufnahme'
    host.appendChild(el)
    lauf = { el, fertig, marker: null }
    speichernFragen(offen.track)
    hinweisen('Ungespeicherte Fahrt', 'Die fertige Aufzeichnung wurde wiederhergestellt. Bitte speichere sie im Fahrtenbuch.')
    return
  }
  if (offen) {
    if (await fragen('Weiter aufzeichnen?', 'Es gibt eine unterbrochene Aufzeichnung. Dort weitermachen?', { ja: 'Weitermachen', nein: 'Neu starten' })) fortsetzen = offen
    else if (!offen.id || !await verwerfeGesicherteAufzeichnung(offen.id)) { hinweisen('Nicht verworfen', 'Der Wiederherstellungsstand hat sich geändert oder konnte nicht entfernt werden. Bitte erneut öffnen.'); return }
  }

  // Angezeigte Tourlinien weg — sonst sieht man nicht, was gerade aufgezeichnet wird
  import('./touren.js').then((m) => m.tourenKarteLeeren()).catch(() => {})
  const el = document.createElement('div')
  // Klein (eine Zeile + Knöpfe) ist Standard — hochziehen oder antippen zeigt alle Werte
  el.className = 'aufnahme aufnahme--klein'
  el.innerHTML = `
    <div class="aufnahme-griff" aria-hidden="true"></div>
    <div class="aufnahme-kopf"><span class="aufnahme-punkt"></span><span class="aufnahme-status">Warte auf GPS…</span>
      <span class="aufnahme-kurz"><b data-wert="zeit-kurz">0:00</b> · <b data-wert="km-kurz">0,0</b> km</span>
      <button type="button" class="aufnahme-folgen" data-auf="folgen" hidden>Zentrieren</button></div>
    <div class="aufnahme-haupt">
      <div><strong data-wert="zeit">0:00</strong><span>Fahrzeit</span></div>
      <div><strong data-wert="km">0,0</strong><span>km</span></div>
    </div>
    <div class="aufnahme-werte">
      <div><strong data-wert="tempo">0</strong><span>km/h</span></div>
      <div><strong data-wert="schnitt">0</strong><span>Ø km/h</span></div>
      <div><strong data-wert="hoehe">0</strong><span>Höhenmeter</span></div>
    </div>
    <div class="aufnahme-knoepfe">
      <button type="button" class="aufnahme-btn" data-auf="pause">Pause</button>
      <button type="button" class="aufnahme-btn aufnahme-btn--stopp" data-auf="stopp">Beenden</button>
    </div>
    <p class="aufnahme-hinweis">Bildschirm bleibt an. Gesperrt zeichnet der Browser nicht weiter auf.</p>`
  host.appendChild(el)
  ziehbar(el)
  document.querySelector('.konf-karte-hub')?.classList.add('kv-faehrt')
  document.body.classList.add('mm-faehrt')
  ebene(map)
  lauf = { el, fertig, steuerung: null, marker: null, folgen: true }
  lauf.wegschieben = (e) => {
    if (!e.originalEvent || !lauf) return
    lauf.folgen = false
    el.querySelector('[data-auf="folgen"]').hidden = false
  }
  map.on('dragstart', lauf.wegschieben)
  // Eigener Punkt sofort, nicht erst mit dem ersten Aufnahmepunkt
  const hier = getUserCoords()
  if (hier.lat != null) setzeMarker(hier.lat, hier.lng)

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-auf]')
    if (!b || !lauf) return
    const s = lauf.steuerung
    if (b.dataset.auf === 'folgen') { lauf.folgen = true; b.hidden = true }
    if (b.dataset.auf === 'pause' && s) { s.stand().pausiert ? s.weiter() : s.pause() }
    if (b.dataset.auf === 'stopp') {
      if (!s) { abbauen(); return }
      b.disabled = true
      const fahrt = await s.beenden()
      if (!fahrt || fahrt.km < 0.2) { if (fahrt) await verwerfeGesicherteAufzeichnung(fahrt.id); hinweisen('Nichts gespeichert', 'Zu wenig Strecke aufgezeichnet.'); abbauen(); return }
      if (fahrt.luecken?.length) {
        lauf.el.innerHTML = '<div class="aufnahme-speichern"><strong>Strecke wird ergänzt …</strong><span>Abschnitte ohne GPS werden über die Straße nachgerechnet.</span></div>'
        await lueckenFuellen(fahrt)
        zeichneLinie(fahrt.punkte.map(([lat, lon]) => ({ lat, lon })))
      }
      if (lauf) speichernFragen(fahrt)
    }
  })

  const l = lauf
  try {
    l.steuerung = await starteAufzeichnung({
      fortsetzen,
      beiAenderung: (stand) => { if (lauf === l) zeige(stand) },
      beiFehler: (text) => { if (lauf === l) l.el.querySelector('.aufnahme-status').textContent = text },
    })
    if (lauf !== l) { l.steuerung.abbrechen(); return }
    zeige(l.steuerung.stand())
  } catch (err) {
    if (lauf === l) {
      abbauen()
      // Standort gesperrt: erklären, wie man ihn freigibt, und neu versuchen lassen
      if (/Standort/i.test(err.message) && await standortGesperrt('Das Aufzeichnen')) aufzeichnungStarten({ fertig })
      else if (!/Standort/i.test(err.message)) hinweisen('Aufzeichnung nicht möglich', err.message)
    }
  }
}

export const zeichnetAuf = () => !!lauf
