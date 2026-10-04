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
import { getHubMap, getMapLib } from './karte.js'
import { starteAufzeichnung, unterbrocheneAufzeichnung, verwerfeUnterbrochene, formatiereDauer, standortVerfuegbar } from './ride-tracker.js'
import { speichereFahrt, PRAEFIX } from './eigene-strecken.js'

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
  el.querySelector('[data-wert="tempo"]').textContent = Math.round(stand.tempoKmh || 0)
  el.querySelector('[data-wert="schnitt"]').textContent = Math.round(stand.schnittKmh || 0)
  el.querySelector('[data-wert="hoehe"]').textContent = Math.round(stand.hoehenMeter || 0)
  el.classList.toggle('aufnahme--ruht', stand.ruht)
  el.querySelector('.aufnahme-status').textContent = stand.pausiert ? 'Pausiert' : stand.autoPause ? 'Automatische Pause' : 'Aufnahme läuft'
  el.querySelector('[data-auf="pause"]').textContent = stand.pausiert ? 'Weiter' : 'Pause'
  zeichneLinie(stand.punkte)
  const letzter = stand.punkte[stand.punkte.length - 1]
  const map = getHubMap(), ml = getMapLib()
  if (letzter && map && ml) {
    if (!l.marker) {
      const m = document.createElement('div')
      m.className = 'mm-standort-punkt'
      l.marker = new ml.Marker({ element: m }).setLngLat([letzter.lon, letzter.lat]).addTo(map)
    } else l.marker.setLngLat([letzter.lon, letzter.lat])
    if (l.folgen) map.easeTo({ center: [letzter.lon, letzter.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 700 })
  }
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
  map?.off('dragstart', l.wegschieben)
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
      <input type="text" class="aufnahme-name" maxlength="80" value="${esc(`${tageszeit} am ${datum}`)}" aria-label="Name der Fahrt">
      <div class="aufnahme-knoepfe">
        <button type="button" class="aufnahme-btn" data-auf="weg">Verwerfen</button>
        <button type="button" class="aufnahme-btn aufnahme-btn--haupt" data-auf="sichern">Speichern</button>
      </div>
    </div>`
  const name = l.el.querySelector('.aufnahme-name')
  name.focus(); name.select()
  l.el.querySelector('[data-auf="sichern"]').addEventListener('click', () => {
    try {
      const id = speichereFahrt(fahrt, name.value.trim())
      const fertig = l.fertig
      abbauen()
      fertig?.(PRAEFIX + id)
    } catch (err) { alert(err.message) }
  })
  l.el.querySelector('[data-auf="weg"]').addEventListener('click', () => {
    if (confirm('Fahrt wirklich verwerfen?')) abbauen()
  })
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
  if (!standortVerfuegbar()) { alert('Dieser Browser gibt keinen Standort frei — ohne GPS lässt sich nichts aufzeichnen.'); return }
  let fortsetzen = null
  const offen = unterbrocheneAufzeichnung()
  if (offen) {
    if (confirm('Es gibt eine unterbrochene Aufzeichnung. Dort weitermachen?')) fortsetzen = offen
    else verwerfeUnterbrochene()
  }

  // Angezeigte Tourlinien weg — sonst sieht man nicht, was gerade aufgezeichnet wird
  import('./touren.js').then((m) => m.tourenKarteLeeren()).catch(() => {})
  const el = document.createElement('div')
  el.className = 'aufnahme'
  el.innerHTML = `
    <div class="aufnahme-kopf"><span class="aufnahme-punkt"></span><span class="aufnahme-status">Warte auf GPS…</span>
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

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-auf]')
    if (!b || !lauf) return
    const s = lauf.steuerung
    if (b.dataset.auf === 'folgen') { lauf.folgen = true; b.hidden = true }
    if (b.dataset.auf === 'pause' && s) { s.stand().pausiert ? s.weiter() : s.pause() }
    if (b.dataset.auf === 'stopp') {
      if (!s) { abbauen(); return }
      const fahrt = s.beenden()
      if (!fahrt || fahrt.km < 0.2) { alert('Zu wenig Strecke aufgezeichnet — es wurde nichts gespeichert.'); abbauen(); return }
      speichernFragen(fahrt)
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
    if (lauf === l) { abbauen(); alert(err.message) }
  }
}

export const zeichnetAuf = () => !!lauf
