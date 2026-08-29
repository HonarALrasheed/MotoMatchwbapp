/**
 * Bike Detail Page — Porsche Configurator Experience
 * State 1: "Deckblatt" — Hero image with giant specs
 * State 2: "Konfigurator" — Split-screen with sticky 3D viewer + scrollable data
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { getGear } from './gear.js'
import { initHubMap, searchNearby, getHubSearchResults, onHubResults, focusHubResult, recenterHubMap, zoomHubMap, getUserCoords, searchNearbyAt, retryHubLocation, hasMapsConsent, onHubMapMoved, panHubToCoords, haversineKm } from './garage.js'
import { esc, fmtRelative } from './util.js'
import { enterScreen, goBack } from './nav.js'
import { findBikeByShortName, findTopMatches, findSimilarBikes, scoreBikeAgainst, MATCH_WEIGHTS } from './matching.js'
import { getMatches, addMatch, removeMatch, clearMatches, restoreMatch, hasMatch, getLastAnswers, getPrimaryBike, setPrimaryBike } from './match-history.js'

// Deterministic pseudo-random number from a seed string, returns float in [0,1)
function seededRand(seed) {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return (h >>> 0) / 0x100000000
}
// Returns an integer in [min, max] deterministically based on seed string + salt
function hashInt(seed, salt, min, max) {
  return min + Math.floor(seededRand(seed + '\x00' + salt) * (max - min + 1))
}

import { trackBikeVisit, getAccount } from './account.js'

/* Der Anzeigename ist frei waehlbar (auth.js, updateProfile({ name })) und
 * landet an sieben Stellen per Template-String in innerHTML. Statt dort
 * siebenmal esc() zu streuen — und beim achten Aufruf zu vergessen — geben
 * die beiden Getter fertig escapte Werte zurueck. Wer den Rohwert braucht,
 * nimmt rawUserName(). */
function rawUserName() {
  try { return getAccount().name || 'Du' } catch { return 'Du' }
}
function getCurrentUserName() {
  return esc(rawUserName())
}
function rawUserInitials() {
  const name = rawUserName()
  return name.split(/[\s·]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || 'DU'
}
function getCurrentUserInitials() {
  return esc(rawUserInitials())
}

// Universal toast for transient feedback (3s)
function showToast(message) {
  let el = document.getElementById('mm-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'mm-toast'
    el.className = 'mm-toast'
    document.body.appendChild(el)
  }
  el.textContent = message
  el.classList.remove('mm-toast--show')
  void el.offsetWidth
  el.classList.add('mm-toast--show')
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.remove('mm-toast--show'), 2400)
}

export const BIKE_DATA = {
  'Iron 883': {
    fullName: 'Iron 883', brand: 'Harley-Davidson', bgText: 'Iron 883',
    img1: '/bikes/2/harley_iron883_2018.png', img2: '/bikes/harley_iron883_2018.jpg',
    glb: 'https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/harley_iron883_2018.glb', style: 'Cruiser',
    specs: { accel: '6.5', topSpeed: '161', power: '38 kW / 51 PS', cc: '883', weight: '256', seat: '65.3', tank: '12.5', gear: '5-Gang' },
    desc: 'Dark Custom mit V-Twin. Minimalistisch, roh, unverkennbar.',
    price: 'Ab EUR 7.000',
    highlights: [
      { title: 'V-Twin Evolution', text: 'Der luftgekühlte 883cc V-Twin liefert das charakteristische Harley-Drehmoment ab der ersten Umdrehung. Perfekt abgestimmt für souveränes Cruisen.' },
      { title: 'Dark Custom Ästhetik', text: 'Mattschwarz trifft auf reduzierten Purismus. Jedes Detail wurde auf das Wesentliche reduziert — kein Chrom, keine Kompromisse.' },
      { title: 'Niedrige Sitzhöhe', text: 'Mit 65.3 cm Sitzhöhe bietet die Iron 883 selbst kleineren Fahrern maximale Kontrolle und Vertrauen.' },
    ],
    equipment: [
      { name: 'Drag-Style Lenker', category: 'Ergonomie' },
      { name: 'Doppelsitzbank', category: 'Komfort' },
      { name: 'LED-Rücklicht', category: 'Beleuchtung' },
      { name: 'Einzelanzeige Tacho', category: 'Cockpit' },
      { name: 'Riemenantrieb', category: 'Antrieb' },
      { name: 'ABS', category: 'Sicherheit' },
    ],
  },
  'Seventy-Two': {
    fullName: 'Seventy-Two', brand: 'Harley-Davidson', bgText: 'Seventy-Two',
    img1: '/bikes/2/harley_seventytwo_2015.png', img2: '/bikes/harley_seventytwo_2015.jpg',
    glb: 'https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/harley_seventytwo_2015.glb', style: 'Cruiser',
    specs: { accel: '5.2', topSpeed: '170', power: '49 kW / 66 PS', cc: '1202', weight: '255', seat: '67.6', tank: '7.9', gear: '5-Gang' },
    desc: 'Klassischer Chopper-Stil mit V-Twin Power. Purer Cruiser-Charakter.',
    price: 'Ab EUR 15.000',
    highlights: [
      { title: '1202cc V-Twin', text: 'Der Evolution-Motor mit 1202 Kubik liefert massives Drehmoment für entspanntes Cruisen auf jedem Boulevard.' },
      { title: '70er Chopper-DNA', text: 'Inspiriert von der goldenen Ära der Custom-Kultur: Ape-Hanger, Speichenräder und Metalflake-Lack.' },
      { title: 'Peanut Tank', text: 'Der ikonische 7.9L Peanut-Tank ist mehr als nur ein Designelement — er definiert die Silhouette.' },
    ],
    equipment: [
      { name: 'Ape-Hanger Lenker', category: 'Ergonomie' },
      { name: 'Speichenräder', category: 'Fahrwerk' },
      { name: 'Solositz', category: 'Komfort' },
      { name: 'Metalflake Lack', category: 'Design' },
      { name: 'Riemenantrieb', category: 'Antrieb' },
      { name: 'ABS', category: 'Sicherheit' },
    ],
  },
  'CB 750 F': {
    fullName: 'CB 750 F', brand: 'Honda', bgText: 'CB750F',
    img1: '/bikes/2/honda_cb750f_1970.png', img2: '/bikes/honda_cb750f_1970.jpg',
    glb: 'https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/honda_cb750f_1970.glb', style: 'Klassiker',
    specs: { accel: '5.8', topSpeed: '200', power: '49 kW / 67 PS', cc: '736', weight: '235', seat: '80.0', tank: '14.0', gear: '5-Gang' },
    desc: 'Die Legende, die alles veränderte. Vier Zylinder, Geschichte.',
    price: 'Ab EUR 12.000',
    highlights: [
      { title: 'Der Beginn einer Ära', text: 'Die CB 750 definierte 1969 die Superbike-Klasse neu. Vier Zylinder, Scheibenbremse vorn — eine Revolution.' },
      { title: 'SOHC Reihenvierzylinder', text: '736cc luftgekühlter Vierzylinder mit dem unverwechselbaren mechanischen Sound, der Generationen prägte.' },
      { title: 'Investment-Grade Klassiker', text: 'Als eine der begehrtesten Klassiker-Maschinen steigt der Wert kontinuierlich. Fahrspaß und Wertanlage vereint.' },
    ],
    equipment: [
      { name: '4-in-4 Auspuff', category: 'Auspuff' },
      { name: 'Scheibenbremse vorn', category: 'Bremsen' },
      { name: 'Kickstarter', category: 'Start' },
      { name: 'Rundscheinwerfer', category: 'Beleuchtung' },
      { name: 'Analoges Cockpit', category: 'Cockpit' },
      { name: 'Speichenräder', category: 'Fahrwerk' },
    ],
  },
  '500 Custom': {
    fullName: '500 Custom', brand: 'Yamaha', bgText: '500 Custom',
    img1: '/bikes/2/yamaha_500custom.png', img2: '/bikes/yamaha_500custom.png',
    glb: 'https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/yamaha_500custom.glb', style: 'Custom',
    specs: { accel: '5.5', topSpeed: '180', power: '35 kW / 48 PS', cc: '500', weight: '195', seat: '82.0', tank: '13.0', gear: '5-Gang' },
    desc: 'Moderner Custom-Cruiser. Vielseitig, komfortabel, einzigartig.',
    price: 'Ab EUR 5.500',
    highlights: [
      { title: 'Leichtgewicht-Cruiser', text: 'Mit nur 195 kg ist die 500 Custom agiler als jeder andere Cruiser. Perfekt für Stadt und Landstraße.' },
      { title: 'Vielseitige 500cc', text: 'Der wassergekühlte Zweizylinder bietet die ideale Balance aus Leistung und Effizienz für den Alltag.' },
      { title: 'Custom-Plattform', text: 'Die neutrale Basis lädt zur Individualisierung ein. Vom Bobber bis zum Café Racer ist alles möglich.' },
    ],
    equipment: [
      { name: 'Breiter Lenker', category: 'Ergonomie' },
      { name: 'LCD Display', category: 'Cockpit' },
      { name: 'LED-Beleuchtung', category: 'Beleuchtung' },
      { name: 'Doppelsitzbank', category: 'Komfort' },
      { name: 'ABS', category: 'Sicherheit' },
      { name: 'Kettenantrieb', category: 'Antrieb' },
    ],
  },
  'YZF-R3': {
    fullName: 'YZF-R3', brand: 'Yamaha', bgText: 'YZF-R3',
    img1: '/bikes/2/yamaha_yzfr3_2017.png', img2: '/bikes/yamaha_yzfr3_2017.jpg',
    glb: 'https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/yamaha_yzfr3_2017.glb', style: 'Sportbike',
    specs: { accel: '5.6', topSpeed: '180', power: '31 kW / 42 PS', cc: '321', weight: '167', seat: '78.0', tank: '14.0', gear: '6-Gang' },
    desc: 'Idealer Einstieg in die Sportwelt. Agil, leicht, perfekt für A2.',
    price: 'Ab EUR 4.500',
    highlights: [
      { title: 'A2-Perfektioniert', text: 'Mit 31 kW exakt auf die A2-Grenze abgestimmt. Kein Drosseln nötig — volle Leistung ab Tag eins.' },
      { title: 'Rennstrecken-DNA', text: 'Die YZF-R3 teilt ihre Designsprache mit der YZF-R1. Deltabox-Rahmen und aggressive Aerodynamik inklusive.' },
      { title: 'Federleichte 167 kg', text: 'Das niedrige Gewicht sorgt für spielerisches Handling in Kurven und müheloses Manövrieren in der Stadt.' },
    ],
    equipment: [
      { name: 'Deltabox-Rahmen', category: 'Fahrwerk' },
      { name: 'Upside-Down Gabel', category: 'Fahrwerk' },
      { name: 'LED-Scheinwerfer', category: 'Beleuchtung' },
      { name: 'Digitales Cockpit', category: 'Cockpit' },
      { name: 'ABS', category: 'Sicherheit' },
      { name: 'Assist & Slipper Clutch', category: 'Antrieb' },
    ],
  },
  'NR750': {
    fullName: 'NR750', brand: 'Honda', bgText: 'NR750',
    img1: '/bikes/2/honda_nr750_1994.png', img2: '/bikes/honda_nr750_1994.png',
    glb: 'https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/honda_nr750_1994.glb', style: 'Sportbike',
    specs: { accel: '3.5', topSpeed: '259', power: '92 kW / 125 PS', cc: '747', weight: '244', seat: '78.5', tank: '18.0', gear: '6-Gang' },
    desc: 'Ikonischer V4-Sportler mit ovalen Kolben. Technisches Meisterwerk.',
    price: 'Ab EUR 18.000',
    highlights: [
      { title: 'Ovale Kolben-Technologie', text: 'Hondas revolutionäre Oval-Piston-Technologie: 32 Ventile in 4 Zylindern. Ein Engineering-Wunder, das nie übertroffen wurde.' },
      { title: 'V4 mit 125 PS', text: 'Der V4-Motor dreht bis 14.000 U/min und liefert dabei einen Klang, der unter Sammlern Kultstatus genießt.' },
      { title: 'Sammlerstück', text: 'Nur 322 Exemplare weltweit. Jede NR750 ist ein rollendes Museum und eine der wertvollsten Maschinen der Geschichte.' },
    ],
    equipment: [
      { name: 'Titan-Beschichtung', category: 'Oberfläche' },
      { name: 'Pro-Link Federbein', category: 'Fahrwerk' },
      { name: 'Einarmschwinge', category: 'Fahrwerk' },
      { name: 'LCD Cockpit', category: 'Cockpit' },
      { name: 'Doppelscheiben vorn', category: 'Bremsen' },
      { name: 'Kohlefaser-Verkleidung', category: 'Karosserie' },
    ],
  },
}

let detailScene, detailCamera, detailRenderer, detailBike, detailRaf
let camDist = 5, camHeight = 1.5, lookAtY = 0.45
// Start-Tab des Konfigurators. Der frueher erste Reiter "Ansicht" wurde durch
// "Profil" ersetzt; seine Inhalte stecken jetzt im Panel "Alle technischen
// Details" auf Deckblatt/Garage-Seite.
const KONF_DEFAULT_TAB = 'match'

let currentView = 'deckblatt' // 'deckblatt' | 'konfigurator'
let currentBikeData = null
let konfObserver = null
let isDragging = false, angle = 0.8, prevX = 0

/**
 * Normalize garage bikeData (from matching.js) to our internal format.
 */
export function normalizeGarageData(bikeData) {
  const shortName = bikeData.name.replace(/^(Honda|Yamaha|Harley-Davidson|Suzuki|Kawasaki|BMW|Ducati|KTM|Triumph)\s+/i, '')
  const existing = BIKE_DATA[shortName]

  return {
    fullName: existing?.fullName || shortName,
    brand: bikeData.brand,
    bgText: existing?.bgText || shortName,
    img1: bikeData.image2 || bikeData.image || existing?.img1,
    img2: bikeData.image || existing?.img2,
    glb: bikeData.glb,
    style: bikeData.style,
    specs: {
      accel: String(bikeData.accel),
      topSpeed: String(bikeData.topSpeed),
      power: `${bikeData.kw} kW / ${bikeData.ps} PS`,
      cc: String(bikeData.cc),
      weight: String(bikeData.weight),
      seat: String(bikeData.seat_height),
      tank: String(bikeData.tank),
      gear: bikeData.gear,
      license: bikeData.license || '',
    },
    desc: existing?.desc || `${bikeData.brand} ${shortName}. ${bikeData.style}-Klasse.`,
    price: bikeData.priceDisplay || '',
    highlights: existing?.highlights || [
      { title: `${bikeData.ps} PS ${bikeData.style}`, text: `Der ${bikeData.cc}cc Motor liefert ${bikeData.kw} kW Leistung f\u00fcr ein authentisches ${bikeData.style}-Erlebnis.` },
      { title: `${bikeData.topSpeed} km/h Spitze`, text: `In ${bikeData.accel} Sekunden auf 100 km/h \u2014 Fahrfreude pur auf jeder Stra\u00dfe.` },
      { title: `${bikeData.weight} kg Fahrzeuggewicht`, text: `Ausgewogen und kontrolliert. ${bikeData.weight} kg sorgen f\u00fcr ein sicheres Fahrgef\u00fchl.` },
    ],
    equipment: existing?.equipment || [
      { name: bikeData.gear, category: 'Getriebe' },
      { name: `${bikeData.seat_height} cm Sitzh\u00f6he`, category: 'Ergonomie' },
      { name: `${bikeData.tank} L Tank`, category: 'Reichweite' },
      { name: `F\u00fchrerschein ${bikeData.license}`, category: 'Zulassung' },
    ],
  }
}

/**
 * Open Konfigurator split-screen directly from garage.
 * garageCleanup: function to call to clean up the garage 3D/state before we take over.
 */
export function openKonfigurator(bikeData, garageCleanup, initialTab) {
  // garageCleanup ist der verlässliche Herkunfts-Indikator: nur die Garage
  // übergibt ihn. Die Startseite ruft mit null auf.
  konfOrigin = garageCleanup ? 'garage' : 'landing'
  if (garageCleanup) garageCleanup()
  const data = normalizeGarageData(bikeData)
  currentBikeData = data
  currentView = 'konfigurator'
  // Resolve target tab: explicit initialTab > last saved tab > Standard-Tab.
  // 'ansicht' hat keinen eigenen Reiter mehr (Inhalt steckt unter "Alle
  // technischen Details") — ein alter gespeicherter Wert faellt daher zurueck.
  let targetTab = initialTab
  if (!targetTab) {
    try { targetTab = localStorage.getItem('mm_last_tab') || KONF_DEFAULT_TAB } catch { targetTab = KONF_DEFAULT_TAB }
    if (targetTab === 'ansicht') targetTab = KONF_DEFAULT_TAB
  }
  if (!tabViewBuilders[targetTab]) targetTab = KONF_DEFAULT_TAB
  activeKonfTab = targetTab // reset for consistent initial render
  trackBikeVisit(data.fullName || bikeData.name, data.style)

  const garageContainer = document.getElementById('garage-container')
  const detail = document.getElementById('bike-detail')
  const landing = document.getElementById('landing')

  // Fade out garage
  if (garageContainer) {
    garageContainer.style.transition = 'opacity 0.22s ease'
    garageContainer.style.opacity = '0'
  }
  // Startseite ausblenden, sonst bleibt ihre fixe Kopfzeile (.p-nav, z-index
  // 500) über der Konfigurator-Taskbar (z-index 300) sichtbar und fängt
  // Klicks ab. Manche Aufrufer (Drawer) blenden schon vorher selbst aus —
  // dann ist landing hier bereits display:none und das bleibt unangetastet.
  if (landing && konfOrigin === 'landing' && landing.style.display !== 'none') {
    landing.style.transition = 'opacity 0.22s ease'
    landing.style.opacity = '0'
  }

  setTimeout(() => {
    if (garageContainer) {
      garageContainer.style.display = 'none'
      garageContainer.innerHTML = ''
    }
    if (landing && konfOrigin === 'landing') {
      landing.style.display = 'none'
      document.documentElement.classList.remove('has-landing')
    }

    detail.innerHTML = buildKonfiguratorHTML(data, targetTab)
    detail.style.display = 'block'
    detail.classList.add('bd-konfigurator-active')
    enterScreen('bd-konfigurator', () => konfiguratorBack(data, bikeData), isKonfiguratorActive,
                { screen: 'konfigurator', bike: bikeData?.name || data.fullName, tab: targetTab })

    try { localStorage.setItem('mm_last_tab', targetTab) } catch {}

    requestAnimationFrame(() => {
      detail.classList.add('bd-konfigurator-visible')
      initKonfiguratorAnimations()
      initViewerPills(data)
      bindKonfiguratorEvents(data, bikeData)
      // Direkt die Ziel-Ansicht initialisieren — kein Umweg über "Ansicht"
      if (targetTab === 'ansicht') animateBarsOnReveal()
      if (targetTab === 'match') bindMatchViewEvents(data)
      if (targetTab === 'karte') bindKarteViewEvents()
      if (targetTab === 'community') import('./community.js').then(m => m.mountCommunity(document.getElementById('mm-comm-root')))
    })

    window.scrollTo(0, 0)
  }, 220)
}

/* ═══════════════════════════════════════════════════
   RÜCKWEG — Registrierung bei nav.js
   ═══════════════════════════════════════════════════ */

/** Woher der Konfigurator geöffnet wurde — bestimmt das Ziel des Zurück-Wegs. */
let konfOrigin = 'deckblatt'

function detailVisible() {
  const detail = document.getElementById('bike-detail')
  return !!detail && detail.style.display !== 'none'
}
const isDeckblattActive = () => detailVisible() && currentView === 'deckblatt'
const isKonfiguratorActive = () => detailVisible() && currentView === 'konfigurator'

/** Bike-Detail schließen und zur Startseite zurück. */
function closeDetailToLanding() {
  const detail = document.getElementById('bike-detail')
  const landing = document.getElementById('landing')
  cleanup3D()
  cleanupKonfigurator()
  detail.style.transition = 'opacity 0.22s ease'
  detail.style.opacity = '0'
  setTimeout(() => {
    detail.style.display = 'none'
    detail.innerHTML = ''
    detail.style.opacity = ''
    detail.style.transition = ''
    landing.style.display = 'block'
    // Der Drawer-Weg in landing.js nimmt has-landing beim Verlassen weg —
    // ohne das Zurücksetzen bliebe die Startseite unscrollbar.
    document.documentElement.classList.add('has-landing')
    requestAnimationFrame(() => { landing.style.opacity = '1' })
  }, 220)
}

/**
 * Ein Schritt zurück aus dem Konfigurator — zum tatsächlichen Herkunfts-
 * bildschirm. Vorher entschied das an `bindKonfiguratorEvents` übergebene
 * `garageBikeData` darüber, das aber von `openKonfigurator` immer gesetzt
 * wurde: auch der Weg Startseite → Ausrüstung/Karte/Community landete
 * dadurch in der Garage eines Bikes, das nie ausgewählt wurde.
 */
function konfiguratorBack(data, garageBikeData) {
  if (konfOrigin === 'garage' && garageBikeData) returnToGarage(garageBikeData)
  else if (konfOrigin === 'landing') closeDetailToLanding()
  else transitionToDeckblatt(data)
}

export function openBikeDetail(bikeName) {
  const data = BIKE_DATA[bikeName]
  if (!data) return
  currentBikeData = data
  currentView = 'deckblatt'
  trackBikeVisit(bikeName, data.style)
  const landing = document.getElementById('landing')
  const detail = document.getElementById('bike-detail')

  detail.innerHTML = buildDeckblattHTML(data)

  // Smooth transition
  landing.style.transition = 'opacity 0.22s ease'
  landing.style.opacity = '0'
  setTimeout(() => {
    landing.style.display = 'none'
    detail.style.display = 'block'
    // Erst jetzt registrieren: History-Eintrag und sichtbarer Bildschirm
    // sollen zum selben Zeitpunkt entstehen.
    enterScreen('bd-deckblatt', closeDetailToLanding, isDeckblattActive,
                { screen: 'deckblatt', bike: data.fullName })
    window.scrollTo(0, 0)
    requestAnimationFrame(() => {
      detail.style.opacity = '1'
      initDetailAnimations(detail)
      initDetail3D(data)
      bindDeckblattEvents(data, detail, landing)
    })
  }, 220)
}

/* ═══════════════════════════════════════════════════
   DECKBLATT — Hero View (State 1)
   ═══════════════════════════════════════════════════ */

function buildDeckblattHTML(data) {
  return `
    <section class="bd-hero">
      <button class="bd-back" id="bd-back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <!-- Wortmarke sitzt in der Bildbox, damit sie an das Motorrad
           gekoppelt bleibt statt an die Hero-Hoehe. -->
      <div class="bd-hero-img-wrap">
        <div class="bd-hero-bg-text">${data.bgText}</div>
        <img class="bd-hero-img" src="${data.img1}" alt="${data.fullName}">
      </div>
      <div class="bd-hero-info">
        <h1 class="bd-model-name">${data.fullName}</h1>
        <span class="bd-badge">${data.style}</span>
        <p class="bd-price">${data.price} inkl. MwSt.</p>
        <div class="bd-actions">
          <button class="bd-btn bd-btn-primary" id="bd-quiz-btn">Match finden</button>
          <button class="bd-btn bd-btn-outline" id="bd-3d-btn">3D ansehen</button>
          <button class="bd-btn bd-btn-outline" id="bd-config-btn">Konfigurieren</button>
        </div>
      </div>
    </section>

    <section class="bd-specs">
      <div class="bd-specs-inner">
        <div class="bd-specs-left">
          ${buildDetailsAnsichtHTML(data)}
        </div>
        <div class="bd-specs-right">
          <div class="bd-3d-canvas-wrap" id="bd-3d-wrap">
            <canvas id="bd-3d-canvas"></canvas>
          </div>
        </div>
      </div>
    </section>

    <footer class="landing-footer">
      <span class="landing-footer-logo">MotoMatch</span>
      <span class="landing-footer-copy">\u00a9 2026 \u00b7 Alle Rechte vorbehalten</span>
    </footer>
  `
}

/**
 * Die komplette "Ansicht"-Seite als eingebetteter Block fuer das aufklappbare
 * Panel "Alle technischen Details" (Deckblatt- und Garage-Seite). Erwartet ein
 * normalisiertes Bike-Objekt — siehe normalizeGarageData().
 */
export function buildDetailsAnsichtHTML(content) {
  if (!content) return ''
  // Statt der Titel-Karte (Name/Preis stehen schon im Hero) steht hier das
  // technische Raster — es lag vorher lose ueber dem Block.
  const gridCard = `
    <div class="konf-card konf-reveal">
      ${buildDetailsGridHTML(content.specs)}
    </div>`
  return `<div class="bd-ansicht-embed">${buildAnsichtView(content, gridCard)}</div>`
}

/** Das Kennzahlen-Raster (Hubraum, Gewicht, …) aus einem specs-Objekt. */
export function buildDetailsGridHTML(specs = {}) {
  const items = [
    [`${specs.cc} ccm`, 'Hubraum'],
    [`${specs.weight} kg`, 'Gewicht'],
    [`${specs.seat} cm`, 'Sitzh\u00f6he'],
    [`${specs.tank} L`, 'Tankvolumen'],
    [specs.gear, 'Getriebe'],
  ]
  if (specs.license) items.push([specs.license, 'F\u00fchrerschein'])

  return `
    <div class="bd-details-grid">
      ${items.map(([val, lbl]) => `
        <div class="bd-detail-item">
          <span class="bd-detail-val">${esc(val)}</span>
          <span class="bd-detail-lbl">${lbl}</span>
        </div>
      `).join('')}
    </div>`
}

/**
 * Bindet die interaktiven Teile der eingebetteten Ansicht-Seite. Der normale
 * Konfigurator erledigt das ueber initKonfiguratorAnimations(), das hier aber
 * nicht passt: es haengt an .konf-right / .konf-split, die es im Panel nicht
 * gibt. openTab(tab) springt von hier aus in den Konfigurator.
 */
export function bindDetailsAnsichtEvents(host, openTab) {
  if (!host) return

  // Ohne Scroll-Container laeuft der Reveal-Observer nie an — direkt zeigen.
  host.querySelectorAll('.konf-reveal').forEach(el => el.classList.add('konf-visible'))

  // Leistungsbalken + Zaehler starten, sobald das Panel im Viewport steht
  const barsCard = host.querySelector('#konf-bars-card')
  if (barsCard) {
    const obs = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return
      obs.disconnect()
      barsCard.querySelectorAll('.konf-bar-group').forEach((group, i) => {
        const fill = group.querySelector('.konf-bar-fill')
        const counters = group.querySelectorAll('.konf-bar-counter')
        setTimeout(() => {
          if (fill) fill.style.width = fill.dataset.pct + '%'
          counters.forEach(animateBarNumber)
        }, i * 120)
      })
    }, { threshold: 0.2 })
    obs.observe(barsCard)
  }

  // "Mehr / Weniger anzeigen"
  const mehrBtn = host.querySelector('#konf-mehr-btn')
  const mehrSection = host.querySelector('#konf-mehr-section')
  mehrBtn?.addEventListener('click', () => {
    const isOpen = mehrSection.classList.toggle('konf-mehr-open')
    mehrBtn.querySelector('.konf-mehr-label').textContent = isOpen ? 'Weniger anzeigen' : 'Mehr anzeigen'
    mehrBtn.classList.toggle('konf-mehr-btn--open', isOpen)
    // Beim Zuklappen zurueck nach oben — der Block scrollt in sich, sonst
    // bliebe man im leeren Rest haengen.
    if (!isOpen) host.scrollTo({ top: 0, behavior: 'smooth' })
  })

  // Weiter in den Konfigurator
  if (typeof openTab === 'function') {
    host.querySelector('.konf-next-btn')?.addEventListener('click', (e) => {
      openTab(e.currentTarget.dataset.next || 'ausstattung')
    })
  }
}

function bindDeckblattEvents(data, detail, landing) {
  document.getElementById('bd-back').addEventListener('click', () => {
    // Über die History zurück, damit In-App-Button und Browser-Zurück
    // denselben Weg nehmen; der Fallback greift nur, wenn kein Eintrag
    // existiert (z. B. Direkteinstieg über ?bike=).
    if (!goBack()) closeDetailToLanding()
  })

  document.getElementById('bd-quiz-btn').addEventListener('click', () => {
    cleanup3D()
    cleanupKonfigurator()
    detail.style.transition = 'opacity 0.22s ease'
    detail.style.opacity = '0'
    setTimeout(() => {
      detail.style.display = 'none'
      detail.style.opacity = ''
      detail.style.transition = ''
      document.documentElement.classList.remove('has-landing')
      document.getElementById('quiz-screen').style.display = 'flex'
      import('./quiz.js').then(m => m.initQuiz())
    }, 220)
  })

  document.getElementById('bd-3d-btn').addEventListener('click', () => {
    document.querySelector('.bd-specs').scrollIntoView({ behavior: 'smooth' })
  })

  // Ansicht steht fest in der linken Spalte — direkt binden
  bindDetailsAnsichtEvents(
    detail.querySelector('.bd-specs-left .bd-ansicht-embed'),
    tab => transitionToKonfigurator(data, tab),
  )

  // "Konfigurieren" — transition to configurator
  document.getElementById('bd-config-btn').addEventListener('click', () => {
    transitionToKonfigurator(data)
  })
}

/* ═══════════════════════════════════════════════════
   KONFIGURATOR — Porsche Split-Screen (State 2)
   ═══════════════════════════════════════════════════ */

function transitionToKonfigurator(data, initialTab) {
  if (currentView === 'konfigurator') return
  currentView = 'konfigurator'
  konfOrigin = 'deckblatt'
  const tab = tabViewBuilders[initialTab] ? initialTab : KONF_DEFAULT_TAB

  const detail = document.getElementById('bike-detail')

  // Phase 1: Fade out deckblatt
  detail.classList.add('bd-transitioning')
  cleanup3D()

  setTimeout(() => {
    // activeKonfTab muss mitgezogen werden, sonst ignoriert
    // bindKonfiguratorEvents den ersten Klick auf den Reiter, der beim
    // letzten Besuch aktiv war.
    activeKonfTab = tab
    detail.innerHTML = buildKonfiguratorHTML(data, tab)
    detail.classList.remove('bd-transitioning')
    detail.classList.add('bd-konfigurator-active')
    enterScreen('bd-konfigurator', () => konfiguratorBack(data, null), isKonfiguratorActive,
                { screen: 'konfigurator', bike: data.fullName, tab })

    requestAnimationFrame(() => {
      detail.classList.add('bd-konfigurator-visible')
      initKonfiguratorAnimations()
      initViewerPills(data)
      animateBarsOnReveal()
      bindKonfiguratorEvents(data)
    })

    window.scrollTo(0, 0)
  }, 240)
}

const GEAR_ICON_SMALL = {
  helmet:        `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M16 4C9 4 5 10 5 16c0 4 1.5 7 4 9h14c2.5-2 4-5 4-9 0-6-4-12-11-12z"/><path d="M10 19 Q16 21 22 19"/></svg>`,
  jacket:        `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 L5 10 L5 27 L13 27 L13 17 L19 17 L19 27 L27 27 L27 10 L21 5 L18 8 L16 7 L14 8 Z"/></svg>`,
  gloves:        `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18 L7 12 Q7 10 9 10 Q11 10 11 12 L11 9 Q11 7 13 7 Q15 7 15 9 L15 8 Q15 6 17 6 Q19 6 19 8 L19 9 Q19 7 21 7 Q23 7 23 9 L23 18 Q23 25 16 26 Q9 25 7 18Z"/></svg>`,
  boots:         `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6 L9 19 Q9 22 12 23 L23 23 L23 26 L6 26 L6 23 Q6 20 9 19"/><path d="M9 6 L14 6 L14 19"/></svg>`,
  pants:         `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5 L25 5 L25 8 L21 27 L16 27 L16 16 L16 27 L11 27 L7 8 Z"/></svg>`,
  kidneybelt:    `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="26" height="10" rx="5"/><path d="M12 11 L12 21 M20 11 L20 21"/><circle cx="16" cy="16" r="2"/></svg>`,
  balaclava:     `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M16 3C10 3 6 8 6 14c0 4 2 8 6 10v5h8v-5c4-2 6-6 6-10 0-6-4-11-10-11z"/><ellipse cx="16" cy="19" rx="4" ry="2.5"/></svg>`,
  backprotector: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="10" y="3" width="12" height="26" rx="4"/><path d="M13 8 L19 8 M13 13 L19 13 M13 18 L19 18 M13 23 L19 23"/></svg>`,
}

const GEAR_COLOR = {
  helmet:        { bg: '#1a1530', fg: '#d4a843' },
  jacket:        { bg: '#1c1c1c', fg: '#c8c8c8' },
  gloves:        { bg: '#0e1f36', fg: '#5ab4ef' },
  boots:         { bg: '#1e1008', fg: '#c97a50' },
  pants:         { bg: '#0f1e10', fg: '#6dba72' },
  kidneybelt:    { bg: '#1e0f18', fg: '#d46fa0' },
  balaclava:     { bg: '#1a1a1a', fg: '#b0b0b0' },
  backprotector: { bg: '#0c1828', fg: '#7ab3e0' },
}

const GEAR_LABEL = {
  helmet: 'Helm', jacket: 'Jacke', gloves: 'Handschuhe', boots: 'Stiefel',
  pants: 'Hose', kidneybelt: 'Nierengurt', balaclava: 'Sturmhaube', backprotector: 'Rückenprotektor',
}

const STYLE_TIPS = {
  Sportbike:    { icon: '🏎', text: 'Eng anliegend & aerodynamisch — CE Level 2 empfohlen' },
  Naked:        { icon: '🛣', text: 'Vielseitig & alltagstauglich — Textil oder Leder' },
  Cruiser:      { icon: '☀️', text: 'Klassische Lederoptik & Heritage-Designs mit Komfort' },
  Enduro:       { icon: '🏔', text: 'Wasserdicht & robust — für jedes Terrain ausgerüstet' },
  Motocross:    { icon: '🤸', text: 'Leicht & ventiliert — MX-spezifisch, volle Bewegungsfreiheit' },
  Klassiker:    { icon: '🕰', text: 'Heritage-Optik mit modernem CE-Schutzstandard' },
  Custom:       { icon: '✂️', text: 'Custom-Culture Look mit soliden CE-zertifizierten Protektoren' },
  Touring:      { icon: '🗺', text: 'Komfort auf langen Strecken — wasser- & winddicht' },
}

/* ═══════════════════════════════════════════════════
   COMMUNITY DATA & HELPERS — same visual layout as gear
   ═══════════════════════════════════════════════════ */

const COMMUNITY_LABEL = {
  tour: 'Tour', event: 'Event', group: 'Gruppe', stammtisch: 'Stammtisch', forum: 'Forum',
  video: 'Video', short: 'Short',
}

const COMMUNITY_COLOR = {
  tour:       { bg: '#0e1d2e', fg: '#5aa8d8' },
  event:      { bg: '#1f1226', fg: '#c074dc' },
  group:      { bg: '#102018', fg: '#5fc587' },
  stammtisch: { bg: '#241404', fg: '#d49258' },
  forum:      { bg: '#1a1a1a', fg: '#b0b0b0' },
  video:      { bg: '#2a0d10', fg: '#e85a5a' },
  short:      { bg: '#0d1a2a', fg: '#ff8c42' },
}

const COMMUNITY_ICON_SMALL = {
  tour:       `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 26c0-4 2-6 6-6s6 2 6 6"/><path d="M14 20V12c0-3 2-5 5-5h5"/><circle cx="14" cy="20" r="2"/><circle cx="24" cy="7" r="2"/></svg>`,
  event:      `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="22" height="20" rx="2"/><path d="M5 13h22M11 4v6M21 4v6"/><circle cx="16" cy="20" r="2" fill="currentColor"/></svg>`,
  group:      `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="12" r="4"/><circle cx="22" cy="13" r="3"/><path d="M4 26c0-4 3-7 7-7s7 3 7 7M18 26c0-3 2-5 4-5s4 2 4 5"/></svg>`,
  stammtisch: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13h20l-1 9c-.5 3-2 5-9 5s-8.5-2-9-5L6 13z"/><path d="M6 13c0-3 4-6 10-6s10 3 10 6"/><path d="M13 7v-3M19 7v-3"/></svg>`,
  forum:      `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h22v14H17l-5 5v-5H5z"/><path d="M11 14h10M11 18h7"/></svg>`,
  video:      `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="26" height="18" rx="2"/><path d="M13 13l7 4-7 4z" fill="currentColor"/></svg>`,
  short:      `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="14" height="26" rx="2.5"/><path d="M14 13l5 3-5 3z" fill="currentColor"/></svg>`,
}

const COMMUNITY_DATA = {
  tour: [
    { title: 'Schwarzwald Runde',  desc: 'Kurvige Hochstraßen, Aussichtspunkte', meta: 'Kurvig', extra: '245 km · 4.8★', tier: 'BELIEBT' },
    { title: 'Alpenüberquerung',   desc: 'Panorama-Tour über mehrere Pässe',     meta: 'Panorama', extra: '380 km · 4.9★', tier: 'TOP' },
    { title: 'Eifel Schleifen',    desc: 'Klassische Eifel-Runde mit Pausen',    meta: 'Kurvig', extra: '165 km · 4.7★', tier: 'NEU' },
  ],
  event: [
    { title: 'Saisonstart 2026',   desc: 'Großes Saisoneröffnungs-Event',        meta: 'Nürburgring', extra: '12. April · 1.200 TN', tier: 'HOT' },
    { title: 'Custom Bike Show',   desc: 'Ausstellung & Wettbewerb für Customs', meta: 'Hamburg',     extra: '3. Mai · 800 TN',       tier: 'BELIEBT' },
    { title: 'Klassikertreffen',   desc: 'Treffen für Vintage- und Oldtimer-Bikes', meta: 'München',  extra: '15. Juni · 600 TN',     tier: 'NEU' },
  ],
  group: [
    { title: 'Cruiser Crew Süd',   desc: 'Cruiser-Fahrer aus Süddeutschland',    meta: 'Region Süd',  extra: '1.200 Mitglieder', tier: 'AKTIV' },
    { title: 'Sportbike Riders DE',desc: 'Sportbike-Enthusiasten deutschlandweit', meta: 'Bundesweit', extra: '850 Mitglieder',   tier: 'BELIEBT' },
    { title: 'Klassiker Freunde',  desc: 'Liebhaber klassischer Motorräder',     meta: 'Bundesweit',  extra: '420 Mitglieder',   tier: 'NEU' },
  ],
  stammtisch: [
    { title: 'Stammtisch München', desc: 'Lockerer Austausch jeden 2. Donnerstag', meta: 'Bayern',    extra: 'Do · 19 Uhr', tier: 'BELIEBT' },
    { title: 'Stammtisch Hamburg', desc: 'Jeden 1. Freitag im Monat',            meta: 'Nord',       extra: 'Fr · 20 Uhr', tier: 'AKTIV' },
    { title: 'Stammtisch Köln',    desc: 'Jeden 3. Mittwoch · Locker & offen',   meta: 'NRW',        extra: 'Mi · 19 Uhr', tier: 'NEU' },
  ],
  forum: [
    { title: 'Wartung & Reparatur',desc: 'Tipps, Tricks & Fragen rund um Wartung', meta: 'Aktiv',    extra: '4.200 Threads', tier: 'TOP' },
    { title: 'Reise & Touren',     desc: 'Tour-Tipps und Reiseberichte',         meta: 'Beliebt',    extra: '2.800 Threads', tier: 'BELIEBT' },
    { title: 'Custom & Tuning',    desc: 'Alles rund um Custom-Builds & Tuning', meta: 'Aktiv',      extra: '1.900 Threads', tier: 'AKTIV' },
  ],
  video: [
    { title: 'Pässe der Alpen',     desc: 'Tour-Vlog: 5 Tage durch die Alpen',  meta: '12:34 min', extra: '48k Views',  tier: 'TOP' },
    { title: 'Helm-Test 2026',      desc: 'Vergleich der besten Integralhelme',   meta: '18:42 min', extra: '32k Views',  tier: 'NEU' },
    { title: 'Custom Build Story',  desc: 'Vom Stockbike zum Café-Racer',         meta: '25:10 min', extra: '21k Views',  tier: 'BELIEBT' },
  ],
  short: [
    { title: 'First Ride Reaction', desc: 'Erste Ausfahrt nach Saisonstart',     meta: '0:45 min',  extra: '120k Views', tier: 'HOT' },
    { title: 'Sound Check V-Twin',  desc: 'Originaler Harley-Sound im Detail',   meta: '0:30 min',  extra: '85k Views',  tier: 'TOP' },
    { title: 'Wheelie Fail Compilation', desc: 'Best of Wheelie-Fails 2025',     meta: '1:00 min',  extra: '210k Views', tier: 'HOT' },
  ],
}

/* Die Filterleiste der Ausruestungsseite ist fixiert; .konf-right haelt ihren
   Platz ueber ein hartes padding-top frei. Auf schmalen Schirmen bricht die
   Leiste je nach Breite um, das feste Mass passt dann nicht mehr und die erste
   Karte verschwindet dahinter. Deshalb messen statt raten. Greift nur auf
   Mobil — das CSS liest die Variable ausschliesslich unter 767px, Desktop
   behaelt sein festes Mass. */
let gearBarObserver = null

/* Ausruestung und Community bauen verschiedene Leisten: hier .gear-filter-bar,
   dort .gear-price-row als eigene Topbar. Gemessen wird die, die im DOM steht —
   immer nur eine Registerkarte ist gleichzeitig aufgebaut. */
function gearBarEl() {
  return document.querySelector('.gear-filter-bar') || document.querySelector('.gear-price-row')
}

function syncGearBarHeight() {
  const row = gearBarEl()
  const right = document.querySelector('.konf-right')
  // Die weiche Kante rechts an der Kategorieleiste nur zeigen, wenn dort
  // wirklich noch etwas ausserhalb liegt.
  const cats = document.querySelector('.gear-filter-cats')
  if (cats) cats.classList.toggle('gear-filter-cats--overflow', cats.scrollWidth > cats.clientWidth + 1)
  if (!row || !right) return
  const bottom = row.getBoundingClientRect().bottom
  // Waehrend der Einblendanimation kann die Leiste noch bei 0 stehen — dann
  // nichts schreiben und auf den naechsten Beobachter-Durchlauf warten.
  if (bottom > 0) right.style.setProperty('--gear-bars-h', Math.ceil(bottom) + 'px')
}

/* Setzt Umschalter und Leistenmessung auf.
 *
 * Die Klicks laufen bewusst ueber Delegation am Dokument statt ueber je einen
 * Listener pro Knopf: Die Ausruestungsseite wird auf mehreren Wegen aufgebaut
 * (Deckblatt, untere Leiste, Menue), und nicht auf jedem laeuft die uebliche
 * Bindungsrunde. Ein einziger Listener am Dokument ueberlebt jeden Neuaufbau
 * des Markups und kann sich nicht verdoppeln.
 */
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.gear-view-btn')
  if (!btn) return
  const view = btn.dataset.view === 'list' ? 'list' : 'grid'
  setGearView(view)
  applyGearView(view)
  observeGearBar()
})

function initGearView() {
  applyGearView(getGearView())
  observeGearBar()
}

/* Die Ausruestungsseite wird ueber mehrere Wege aufgebaut (Deckblatt, untere
   Leiste, Menue) und nicht auf jedem laeuft die uebliche Bindungsrunde. Statt
   sich auf einen dieser Wege zu verlassen, wird auf das Erscheinen der Leiste
   selbst reagiert — dann stimmen gemerkte Ansicht und gemessene Leistenhoehe
   unabhaengig davon, wer die Seite gebaut hat. */
function watchForGearBar() {
  const host = document.getElementById('bike-detail')
  if (!host || typeof MutationObserver === 'undefined') return
  let seen = false
  new MutationObserver(() => {
    const there = !!document.querySelector('.gear-view-toggle')
    if (there === seen) return
    seen = there
    if (there) initGearView()
  }).observe(host, { childList: true, subtree: true })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForGearBar, { once: true })
  } else {
    watchForGearBar()
  }
}

/* Beobachtet die untere Filterleiste. Ein ResizeObserver statt eines
   Aufrufs zum Aufbauzeitpunkt, weil die Leiste erst nach der Einblendung
   ihre endgueltige Hoehe hat und je nach Fensterbreite auf zwei oder drei
   Zeilen umbricht — beides meldet der Beobachter von selbst. */
function observeGearBar() {
  const row = gearBarEl()
  if (!row || typeof ResizeObserver === 'undefined') return
  if (gearBarObserver) gearBarObserver.disconnect()
  gearBarObserver = new ResizeObserver(syncGearBarHeight)
  gearBarObserver.observe(row)
  syncGearBarHeight()
}

/* Gemerkte Ansicht der Ausruestungsliste ("grid" = Kacheln, "list" = Liste).
   Bewusst geraetweit und nicht pro Stil gespeichert: Wer einmal Liste gewaehlt
   hat, will sie auch beim naechsten Bike sehen. */
const GEAR_VIEW_KEY = 'mm_gear_view_v1'

function getGearView() {
  try { return localStorage.getItem(GEAR_VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}
function setGearView(view) {
  try { localStorage.setItem(GEAR_VIEW_KEY, view) } catch {}
}

/* Setzt die Ansicht auf das Raster und synchronisiert die beiden Knoepfe.
   Laeuft nur, wenn der Umschalter im DOM steht — die Community nutzt dasselbe
   .gear-grid/#gear-list, hat aber keinen Umschalter und darf nicht mit
   umgeschaltet werden. */
function applyGearView(view) {
  const toggle = document.querySelector('.gear-view-toggle')
  if (!toggle) return
  const grid = document.getElementById('gear-list')
  if (grid) grid.classList.toggle('gear-grid--list', view === 'list')
  toggle.querySelectorAll('.gear-view-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === view))
  })
}

/* localStorage helpers for community state */
const COMMUNITY_LS_KEY = 'mm_community_state_v1'
function getCommunityState() {
  try { return JSON.parse(localStorage.getItem(COMMUNITY_LS_KEY) || '{}') } catch { return {} }
}
function saveCommunityState(state) {
  try { localStorage.setItem(COMMUNITY_LS_KEY, JSON.stringify(state)) } catch {}
}
function getCardState(cardId) {
  const state = getCommunityState()
  return state[cardId] || { likes: 0, liked: false, subscribed: false, comments: 0 }
}
function setCardState(cardId, patch) {
  const state = getCommunityState()
  state[cardId] = { ...getCardState(cardId), ...patch }
  saveCommunityState(state)
}
function getUserPosts() {
  try { return JSON.parse(localStorage.getItem('mm_user_posts_v1') || '[]') } catch { return [] }
}
function saveUserPosts(posts) {
  try { localStorage.setItem('mm_user_posts_v1', JSON.stringify(posts)) } catch {}
}
/* User-written comments per card */
function getUserComments(cardId) {
  try { return JSON.parse(localStorage.getItem('mm_comments_' + cardId) || '[]') } catch { return [] }
}
function saveUserComments(cardId, comments) {
  try { localStorage.setItem('mm_comments_' + cardId, JSON.stringify(comments)) } catch {}
}

/* ═══════════════════════════════════════════════════
   COMMUNITY DETAIL VIEWS — YouTube / Profile / Chat
   ═══════════════════════════════════════════════════ */

// Helper: deterministic color from string
function stringColor(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  const palette = ['#e05555','#c074dc','#5aa8d8','#5fc587','#d49258','#ff8c42','#6dba72','#7ab3e0']
  return palette[Math.abs(h) % palette.length]
}
function getInitials(name) {
  return name.split(/[\s·]+/).filter(Boolean).slice(0,2).map(s => s[0]).join('').toUpperCase()
}
function timeAgo(min) {
  if (min < 60) return `vor ${min} Min`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std`
  const d = Math.floor(h / 24)
  return `vor ${d} Tag${d > 1 ? 'en' : ''}`
}

const MOCK_COMMENTS = [
  { user: 'Markus Berger', text: 'Krasse Tour! Wo ist der Aussichtspunkt am Ende?', min: 25,   likes: 142 },
  { user: 'Lisa K.',       text: 'Endlich mal jemand der gutes Equipment empfiehlt. Top!', min: 90, likes: 87 },
  { user: 'Thomas Schmidt',text: 'Ich fahre die Strecke jeden Sonntag. Beste Kurven 🏍', min: 180, likes: 56 },
  { user: 'Anna Petrov',   text: 'Wer fährt am Wochenende mit? Schreibt mir gerne.', min: 360, likes: 23 },
  { user: 'Felix Wagner',  text: 'Sound vom V-Twin ist Musik in den Ohren', min: 720,         likes: 11 },
  { user: 'Sandra Hoffmann', text: 'Danke für den Tipp, baue das nach!', min: 1440,           likes: 4 },
]

// Build suggestion list: pick 8 random other community items
function getSuggestions(currentCardId) {
  const all = []
  Object.entries(COMMUNITY_DATA).forEach(([cat, items]) => {
    items.forEach((item, i) => all.push({ ...item, category: cat, fallbackId: `c${i}_${cat}` }))
  })
  // Shuffle deterministically based on currentCardId
  let seed = 0
  for (let i = 0; i < currentCardId.length; i++) seed = (seed * 31 + currentCardId.charCodeAt(i)) | 0
  const filtered = all.filter(x => x.fallbackId !== currentCardId)
  filtered.sort((a, b) => {
    const ha = ((a.title.charCodeAt(0) * 31) ^ seed) >>> 0
    const hb = ((b.title.charCodeAt(0) * 31) ^ seed) >>> 0
    return ha - hb
  })
  return filtered.slice(0, 8)
}

const MOCK_GROUP_MESSAGES = [
  { user: 'Markus B.', text: 'Sonntag 10 Uhr Treffpunkt Tankstelle?', min: 45,  me: false },
  { user: 'Lisa K.',   text: 'Bin dabei! Wer kommt noch?',           min: 40,  me: false },
  { user: 'Du',        text: 'Ich komme mit, bringe einen Freund mit', min: 35, me: true  },
  { user: 'Thomas S.', text: 'Top, bis dann!',                       min: 30,  me: false },
  { user: 'Anna P.',   text: 'Wetterapp sagt 22 Grad und sonnig 🌞', min: 15,  me: false },
  { user: 'Felix W.',  text: 'Perfekt. Frische Reifen sind drauf.',  min: 10,  me: false },
  { user: 'Du',        text: 'Sehen uns gleich!',                     min: 5,   me: true  },
]

function buildVideoDetailView(item, cardId, category) {
  const col = COMMUNITY_COLOR[category]
  const channelName = item.title.split(' ')[0] + ' Channel'
  const channelColor = stringColor(channelName)
  const state = getCardState(cardId)
  const subscribed = state.subscribed
  const liked = state.liked
  const baseLikes = parseInt(item.baseLikes ?? 4800)
  const totalLikes = baseLikes + (liked ? 1 : 0)
  const views = parseInt(item.extra) || hashInt(item.title, 'views', 10000, 60000)
  const suggestions = getSuggestions(cardId)
  return `
    <button class="cc-detail-back" id="cc-detail-back" aria-label="Zurück">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    </button>
    <div class="ccd-scroll">
      <div class="ccd-player" style="background:${col.bg}; color:${col.fg}" id="ccd-player">
        <div class="ccd-player-icon">${COMMUNITY_ICON_SMALL[category]}</div>
        ${(category === 'video' || category === 'short') ? `
          <video class="ccd-video" id="ccd-video" controls preload="metadata" playsinline poster="" style="display:none">
            <source src="/__video/hero.mp4" type="video/mp4">
          </video>
          <button class="ccd-play-btn" id="ccd-play-btn" aria-label="Abspielen">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
        ` : `
          <button class="ccd-play-btn" aria-label="Abspielen">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
        `}
        <span class="ccd-duration">${item.meta}</span>
      </div>

      <div class="ccd-layout">
      <div class="ccd-main">
      <div class="ccd-content">
        <h1 class="ccd-title">${item.title}</h1>
        <div class="ccd-meta-line">
          <span>${item.extra}</span>
          <span class="ccd-dot">·</span>
          <span>${timeAgo(120)}</span>
        </div>

        <div class="ccd-actions-bar">
          <button class="ccd-action-pill ccd-like-pill ${liked ? 'ccd-like-pill--active' : ''}" data-card-id="${cardId}" data-base-likes="${baseLikes}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22V11l5-8 1 1v6h7l-2 12H7z"/></svg>
            <span class="ccd-like-count">${totalLikes.toLocaleString('de-DE')}</span>
          </button>
          <button class="ccd-action-pill ccd-share-btn" data-share-title="${item.title.replace(/"/g,'&quot;')}" data-share-text="${item.desc.replace(/"/g,'&quot;')}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l5 5-5 5M22 7H10a5 5 0 0 0-5 5v3"/></svg>
            <span>Teilen</span>
          </button>
          <button class="ccd-action-pill ccd-save-btn" data-save-id="${cardId}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            <span>Speichern</span>
          </button>
        </div>

        <div class="ccd-channel-row" data-profile="${encodeURIComponent(channelName)}">
          <div class="ccd-avatar" style="background:${channelColor}">${getInitials(channelName)}</div>
          <div class="ccd-channel-info">
            <div class="ccd-channel-name">${channelName}</div>
            <div class="ccd-channel-subs">${hashInt(channelName,'subs_k',5,45)}.${hashInt(channelName,'subs_r',100,999)} Abonnenten</div>
          </div>
          <button class="ccd-subscribe-big" data-card-id="${cardId}" data-subscribed="${subscribed}">
            ${subscribed ? '✓ Abonniert' : 'Abonnieren'}
          </button>
        </div>

        <div class="ccd-desc-box" id="ccd-desc-box">
          <div class="ccd-desc-head">
            <span class="ccd-desc-label">Beschreibung</span>
            <span class="ccd-desc-stats">${item.extra} · ${timeAgo(7200)}</span>
          </div>
          <div class="ccd-desc-content ccd-desc-collapsed" id="ccd-desc-content">
            <p class="ccd-desc">${item.desc}</p>
            <p class="ccd-desc-extra">In diesem ${COMMUNITY_LABEL[category]} zeige ich dir alles was du wissen musst. Ob Einsteiger oder erfahrener Fahrer — hier ist für jeden was dabei. Schreibt mir gerne in die Kommentare was eure Erfahrungen sind und welche Themen ihr als nächstes sehen wollt!

Equipment in diesem Video:
• Helm: AGV K6
• Jacke: Alpinestars Racer v2
• Stiefel: Sidi Touring

Folgt mir für mehr Content rund ums Motorrad. Bleibt sicher unterwegs! 🏍</p>
            <p class="ccd-meta-text">Veröffentlicht am ${new Date(Date.now() - 86400000 * 5).toLocaleDateString('de-DE')} · #motorrad #${category} #community #ride</p>
          </div>
          <button class="ccd-desc-toggle" id="ccd-desc-toggle">…mehr anzeigen</button>
        </div>

        <div class="ccd-comments-section">
          <div class="ccd-comments-head">
            <h3 class="ccd-comments-title">Kommentare <span class="ccd-comments-count" id="ccd-comments-count">· ${MOCK_COMMENTS.length + getUserComments(cardId).length}</span></h3>
            <button class="ccd-sort-trigger" id="ccd-sort-trigger" data-sort="top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
              <span id="ccd-sort-label">Top Kommentare</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div class="ccd-sort-menu" id="ccd-sort-menu">
              <button class="ccd-sort-opt" data-sort="top">Top Kommentare</button>
              <button class="ccd-sort-opt" data-sort="new">Neueste zuerst</button>
            </div>
          </div>
          <div class="ccd-comment-input-row">
            <div class="ccd-avatar ccd-avatar-sm" style="background:${stringColor(rawUserName())}">${getCurrentUserInitials()}</div>
            <div class="ccd-comment-input-wrap">
              <input type="text" class="ccd-comment-input" id="ccd-comment-input" data-card-id="${cardId}" placeholder="Kommentar hinzufügen…" maxlength="280">
              <div class="ccd-comment-input-actions" id="ccd-comment-input-actions" style="display:none">
                <button class="ccd-mini-btn ccd-cancel-comment" id="ccd-cancel-comment">Abbrechen</button>
                <button class="ccd-comment-submit" id="ccd-comment-submit" disabled>Kommentieren</button>
              </div>
            </div>
          </div>
          <div id="ccd-comments-list" data-card-id="${cardId}">
            ${getUserComments(cardId).reverse().map(c => `
              <div class="ccd-comment ccd-comment--mine" data-likes="0" data-ts="${c.ts}">
                <div class="ccd-avatar ccd-avatar-sm" style="background:${stringColor(rawUserName())}">${getCurrentUserInitials()}</div>
                <div class="ccd-comment-body">
                  <div class="ccd-comment-head">
                    <span class="ccd-comment-user">${getCurrentUserName()}</span>
                    <span class="ccd-comment-time">${timeAgo(Math.floor((Date.now() - c.ts) / 60000))}</span>
                  </div>
                  <div class="ccd-comment-text">${esc(c.text)}</div>
                  <div class="ccd-comment-actions">
                    <button class="ccd-mini-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 22V11l5-8 1 1v6h7l-2 12H7z"/></svg> 0</button>
                    <button class="ccd-mini-btn">Antworten</button>
                    <button class="ccd-mini-btn ccd-delete-comment" data-comment-ts="${c.ts}" data-card-id="${cardId}">Löschen</button>
                  </div>
                </div>
              </div>
            `).join('')}
            ${MOCK_COMMENTS.map(c => `
              <div class="ccd-comment" data-profile="${encodeURIComponent(c.user)}" data-likes="${c.likes}" data-ts="${Date.now() - c.min * 60000}">
                <div class="ccd-avatar ccd-avatar-sm" style="background:${stringColor(c.user)}">${getInitials(c.user)}</div>
                <div class="ccd-comment-body">
                  <div class="ccd-comment-head">
                    <span class="ccd-comment-user">${c.user}</span>
                    <span class="ccd-comment-time">${timeAgo(c.min)}</span>
                  </div>
                  <div class="ccd-comment-text">${c.text}</div>
                  <div class="ccd-comment-actions">
                    <button class="ccd-mini-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 22V11l5-8 1 1v6h7l-2 12H7z"/></svg> ${c.likes}</button>
                    <button class="ccd-mini-btn">Antworten</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      </div><!-- /.ccd-main -->

      <aside class="ccd-sidebar">
        <h3 class="ccd-sidebar-title">Empfohlene Inhalte</h3>
        <div class="ccd-sidebar-list">
          ${suggestions.map(s => {
            const sCol = COMMUNITY_COLOR[s.category]
            const sId = s.fallbackId
            return `
            <a class="ccd-sugg" href="#" data-sugg-id="${sId}" data-sugg-cat="${s.category}" onclick="event.preventDefault()">
              <div class="ccd-sugg-thumb" style="background:${sCol.bg}; color:${sCol.fg}">
                ${COMMUNITY_ICON_SMALL[s.category]}
                <span class="ccd-sugg-cat-tag">${COMMUNITY_LABEL[s.category]}</span>
              </div>
              <div class="ccd-sugg-info">
                <div class="ccd-sugg-title">${s.title}</div>
                <div class="ccd-sugg-meta">${s.meta} · ${s.extra}</div>
                <div class="ccd-sugg-channel">${s.title.split(' ')[0]} Channel</div>
              </div>
            </a>`
          }).join('')}
        </div>
      </aside>
      </div><!-- /.ccd-layout -->
    </div>
  `
}

function buildProfileView(userName) {
  const color = stringColor(userName)
  const initials = getInitials(userName)
  const isMe = userName === 'Du'
  return `
    <button class="cc-detail-back" id="cc-detail-back" aria-label="Zurück">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    </button>
    <div class="ccd-scroll">
      <div class="ccp-banner" style="background:linear-gradient(135deg, ${color}, #1a1a1a)"></div>
      <div class="ccp-header">
        <div class="ccp-avatar" style="background:${color}">${initials}</div>
        <h1 class="ccp-name">${userName}</h1>
        <p class="ccp-handle">@${userName.toLowerCase().replace(/[^a-z0-9]+/g,'_')}</p>
        <p class="ccp-bio">${isMe ? 'Motorradfahrer · Sammler von Touren-Erinnerungen 🏍' : 'Cruiser-Fan · Touren in Süddeutschland · Custom-Liebhaber'}</p>
        <div class="ccp-stats">
          <div class="ccp-stat"><div class="ccp-stat-num">${hashInt(userName,'posts',30,230)}</div><div class="ccp-stat-label">Beiträge</div></div>
          <div class="ccp-stat"><div class="ccp-stat-num">${hashInt(userName,'followers',5,45)}k</div><div class="ccp-stat-label">Follower</div></div>
          <div class="ccp-stat"><div class="ccp-stat-num">${hashInt(userName,'following',50,550)}</div><div class="ccp-stat-label">Folgt</div></div>
        </div>
        ${isMe ? '' : `
          <div class="ccp-actions">
            <button class="ccp-follow-btn">+ Folgen</button>
            <button class="ccp-message-btn">Nachricht</button>
          </div>
        `}
        <h3 class="ccp-section-title">Letzte Aktivität</h3>
        <div class="ccp-activity">
          <div class="ccp-activity-item">
            <div class="ccp-activity-icon" style="background:${COMMUNITY_COLOR.tour.bg}; color:${COMMUNITY_COLOR.tour.fg}">${COMMUNITY_ICON_SMALL.tour}</div>
            <div>
              <div class="ccp-activity-title">Hat eine neue Tour geteilt</div>
              <div class="ccp-activity-sub">Schwarzwald Sonntagstour · vor 3 Tagen</div>
            </div>
          </div>
          <div class="ccp-activity-item">
            <div class="ccp-activity-icon" style="background:${COMMUNITY_COLOR.video.bg}; color:${COMMUNITY_COLOR.video.fg}">${COMMUNITY_ICON_SMALL.video}</div>
            <div>
              <div class="ccp-activity-title">Hat ein Video kommentiert</div>
              <div class="ccp-activity-sub">"Helm-Test 2026" · vor 1 Woche</div>
            </div>
          </div>
          <div class="ccp-activity-item">
            <div class="ccp-activity-icon" style="background:${COMMUNITY_COLOR.event.bg}; color:${COMMUNITY_COLOR.event.fg}">${COMMUNITY_ICON_SMALL.event}</div>
            <div>
              <div class="ccp-activity-title">Hat sich für Event angemeldet</div>
              <div class="ccp-activity-sub">Saisonstart 2026 · vor 2 Wochen</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}

function buildGroupChatView(item, cardId, category) {
  const col = COMMUNITY_COLOR[category]
  const memberCount = item.extra
  return `
    <div class="ccg-header">
      <button class="ccg-back-btn" id="cc-detail-back" aria-label="Zurück">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div class="ccg-avatar" style="background:${col.bg}; color:${col.fg}">${COMMUNITY_ICON_SMALL[category]}</div>
      <div class="ccg-title-block">
        <div class="ccg-title">${item.title}</div>
        <div class="ccg-subtitle">${memberCount} · ${item.meta}</div>
      </div>
      <button class="ccg-call-btn" aria-label="Anrufen">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      </button>
    </div>

    <div class="ccg-day-sep"><span>Heute</span></div>

    <div class="ccg-messages" id="ccg-messages">
      ${MOCK_GROUP_MESSAGES.map(m => `
        <div class="ccg-msg ${m.me ? 'ccg-msg--me' : 'ccg-msg--other'}" ${!m.me ? `data-profile="${encodeURIComponent(m.user)}"` : ''}>
          ${!m.me ? `<div class="ccg-msg-avatar" style="background:${stringColor(m.user)}">${getInitials(m.user)}</div>` : ''}
          <div class="ccg-bubble">
            ${!m.me ? `<div class="ccg-msg-user" style="color:${stringColor(m.user)}">${m.user}</div>` : ''}
            <div class="ccg-msg-text">${m.text}</div>
            <div class="ccg-msg-time">${timeAgo(m.min)}${m.me ? ' ✓✓' : ''}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="ccg-input-bar">
      <button class="ccg-attach-btn" aria-label="Anhang">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input type="text" class="ccg-text-input" placeholder="Nachricht" id="ccg-text-input">
      <button class="ccg-send-btn" id="ccg-send-btn" aria-label="Senden">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
      </button>
    </div>
  `
}

// Global lookup map: cardId -> { item, category }
let COMMUNITY_LOOKUP = {}

function buildCommunityCards() {
  COMMUNITY_LOOKUP = {} // reset on rebuild
  const categories = [
    { key: 'video',      items: COMMUNITY_DATA.video },
    { key: 'short',      items: COMMUNITY_DATA.short },
    { key: 'tour',       items: COMMUNITY_DATA.tour },
    { key: 'event',      items: COMMUNITY_DATA.event },
    { key: 'group',      items: COMMUNITY_DATA.group },
    { key: 'stammtisch', items: COMMUNITY_DATA.stammtisch },
    { key: 'forum',      items: COMMUNITY_DATA.forum },
  ]
  // Merge user-added posts into the default categories
  const userPosts = getUserPosts()
  let cardId = 0
  const buildCard = (key, item, i, isUser = false) => {
    const col = COMMUNITY_COLOR[key]
    const tierClass = i === 0 ? 'gear-tier--mid' : i === 1 ? 'gear-tier--premium' : 'gear-tier--budget'
    const id = isUser ? `u${item.id}` : `c${cardId++}_${key}`
    COMMUNITY_LOOKUP[id] = { item, category: key, isUser }
    const cardState = getCardState(id)
    const baseLikes = item.baseLikes ?? hashInt(item.title, 'likes', 40, 240)
    const totalLikes = baseLikes + (cardState.liked ? 1 : 0) + cardState.likes
    const subscribable = key === 'video' || key === 'short'
    const subscribeBtn = subscribable ? `
      <button class="cc-subscribe" data-card-id="${id}" data-subscribed="${cardState.subscribed ? 'true' : 'false'}" onclick="event.preventDefault();event.stopPropagation()">
        ${cardState.subscribed ? '✓ Abonniert' : '+ Abonnieren'}
      </button>` : ''
    const userBadge = isUser ? `<span class="cc-user-badge">DU</span>` : ''
    return `
    <a class="gear-card konf-reveal" data-gear="${key}" data-price-min="0" data-price-max="9999" data-card-id="${id}"
       href="#" onclick="event.preventDefault()">
      <div class="gear-card-img" style="background:${col.bg}; color:${col.fg}">
        <div class="gear-card-svg">${COMMUNITY_ICON_SMALL[key]}</div>
        <button class="gear-card-heart" aria-label="Merken" onclick="event.preventDefault();event.stopPropagation()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <span class="gear-card-badge ${tierClass}">${item.tier}</span>
        ${userBadge}
      </div>
      <div class="gear-card-body">
        <span class="gear-card-cat">${COMMUNITY_LABEL[key]}</span>
        <div class="gear-card-brand">${item.title}</div>
        <div class="gear-card-name">${item.desc}</div>
        <div class="gear-card-type">${item.meta}</div>
        <div class="gear-card-price">${item.extra}</div>
        <div class="cc-actions">
          <button class="cc-act cc-like ${cardState.liked ? 'cc-like--active' : ''}" data-card-id="${id}" data-base-likes="${baseLikes}" onclick="event.preventDefault();event.stopPropagation()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${cardState.liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 22V11l5-8 1 1v6h7l-2 12H7z"/></svg>
            <span class="cc-like-count">${totalLikes.toLocaleString('de-DE')}</span>
          </button>
          <button class="cc-act cc-comment" data-card-id="${id}" onclick="event.preventDefault();event.stopPropagation()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11a8 8 0 0 1-12 7l-5 1 1-4A8 8 0 1 1 21 11z"/></svg>
            <span>${item.comments ?? hashInt(item.title, 'comments', 5, 55)}</span>
          </button>
          ${subscribeBtn}
        </div>
      </div>
    </a>`
  }
  const cards = []
  categories.forEach(({ key, items }) => {
    items.forEach((item, i) => cards.push(buildCard(key, item, i, false)))
    // Append user posts that match this category
    userPosts.filter(p => p.category === key).forEach((post, i) => cards.push(buildCard(key, post, i, true)))
  })
  return `<div class="gear-grid" id="gear-list">${cards.join('')}</div>`
}

function buildGearCards(style) {
  const gear = getGear(style)
  const categories = [
    { key: 'helmet',        items: gear.helmet },
    { key: 'jacket',        items: gear.jacket },
    { key: 'gloves',        items: gear.gloves },
    { key: 'boots',         items: gear.boots  },
    { key: 'pants',         items: gear.pants  },
    { key: 'kidneybelt',    items: gear.kidneybelt },
    { key: 'balaclava',     items: gear.balaclava },
    { key: 'backprotector', items: gear.backprotector },
  ]

  const cards = categories.flatMap(({ key, items }) =>
    items.map((item, i) => {
      const searchQ = encodeURIComponent(item.name)
      const tier = i === 0 ? 'Budget' : i === 1 ? 'Empfohlen' : 'Premium'
      const tierClass = i === 0 ? 'gear-tier--budget' : i === 1 ? 'gear-tier--mid' : 'gear-tier--premium'
      // Split brand (first word) from product name
      const nameParts = item.name.split(' ')
      const brand = nameParts[0]
      const productName = nameParts.slice(1).join(' ') || item.type
      // CE level detection from reason text
      const ceMatch = item.reason?.match(/CE-?Level\s*(\d)/i)
      const ceLevel = ceMatch ? parseInt(ceMatch[1]) : null
      const ceBadge = ceLevel
        ? `<span class="gear-card-ce gear-card-ce--${ceLevel}">CE ${ceLevel}</span>`
        : ''
      const productUrl = item.url || `https://www.louis.de/suche?query=${searchQ}`
      /* Der Platzhalter liegt IMMER darunter, das Foto legt sich darueber.
         Vorher stand hinter onerror ein blankes this.remove() — schlug ein
         Bild fehl, blieb eine leere Flaeche stehen, die wie ein kaputter
         Balken aussah statt wie "kein Foto vorhanden". So deckt das Foto den
         Platzhalter ab, sobald es da ist, und gibt ihn beim Fehlschlag von
         selbst wieder frei; nebenbei steht waehrend des Ladens etwas da.
         44 der 105 Ausruestungsteile in gear.js haben ohnehin keine
         Bild-URL — fuer die ist der Platzhalter der Normalfall. */
      const photoHtml = `
        <div class="gear-card-svg">${GEAR_ICON_SMALL[key]}</div>
        ${item.image
          ? `<img class="gear-card-photo" src="${esc(item.image)}" alt="${esc(item.name)}"
                  loading="lazy" decoding="async" onerror="this.remove()">`
          : ''}`
      // Der Kaufgrund nennt das CE-Level oft selbst — steht es schon als
      // Plakette am Bild, waere es in der Zeile darunter doppelt.
      const reason = (item.reason || '')
        .replace(/^CE-?Level\s*\d\+?\s*,\s*/i, '')
        .replace(/^./, c => c.toUpperCase())
      // Echter Shop-Preis wird auf den Cent genau und deutsch formatiert
      // ausgegeben; die selbst geschaetzte Spanne bekommt ein "ca.", damit
      // beide nicht als dieselbe Art Angabe gelesen werden.
      const priceHtml = item.price
        ? `${item.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0\u20ac`
        : `<span class="gear-card-price-ca">ca.</span> ${item.priceMin}\u2013${item.priceMax}\u00a0\u20ac`
      const cardId = `${style}-${key}-${i}`
      return `
      <a class="gear-card gear-card--product konf-reveal" data-gear="${key}" data-price-min="${item.priceMin}" data-price-max="${item.priceMax}" data-card-id="${cardId}"
         href="${productUrl}" target="_blank" rel="noopener sponsored">
        <div class="gear-card-img">
          ${photoHtml}
          <button class="gear-card-heart" aria-label="Merken">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
          <span class="gear-card-badge ${tierClass}">${tier}</span>
          ${ceBadge}
        </div>
        <div class="gear-card-body">
          <span class="gear-card-cat">${GEAR_LABEL[key]}</span>
          <div class="gear-card-brand">${brand}</div>
          <div class="gear-card-name">${productName}</div>
          <div class="gear-card-type">${item.type}</div>
          <div class="gear-card-price">${priceHtml}</div>
          <p class="gear-card-reason">${reason}</p>
        </div>
      </a>`
    })
  ).join('')

  return `<div class="gear-grid" id="gear-list">${cards}</div>`
}

/* ═══════════════════════════════════════════════════
   TAB VIEW BUILDERS — Each tab gets its own dedicated view
   ═══════════════════════════════════════════════════ */

let activeKonfTab = KONF_DEFAULT_TAB
let konfData = null
let _accountUpdatedListenerRegistered = false

/* Startzustand des Sekundaerblocks ("Mehr anzeigen").
 *
 * Ab 769px scrollt .bd-ansicht-embed in sich (max-height in main.css) — dort
 * kostet der offene Block nichts, die Karten bleiben in ihrem Rahmen und das
 * 3D-Modell daneben stehen. Darunter stapelt sich alles: offen ist die Spalte
 * ~2200px hoch und das Modell haengt hinter der gesamten Strecke. Auf
 * Handybreite startet der Block deshalb zugeklappt, aufklappen bleibt ein Tipp
 * entfernt. Bewusst derselbe Breakpoint wie das max-height im CSS, damit
 * Startzustand und Scrollverhalten nicht auseinanderlaufen.
 */
function mehrStartsOpen() {
  return window.matchMedia('(min-width: 769px)').matches
}

export function buildAnsichtView(data, headerCard) {
  const mehrOpen = mehrStartsOpen()
  const kw = data.specs.power.split('/')[0].replace(/[^0-9]/g, '').trim()
  const ps = data.specs.power.split('/')[1].replace(/[^0-9]/g, '').trim()
  const accel = parseFloat(data.specs.accel)
  const topSpeed = parseFloat(data.specs.topSpeed)
  const psNum = parseFloat(ps)

  const accelPct = Math.max(5, Math.min(100, ((15 - accel) / 15) * 100))
  const speedPct = Math.max(5, Math.min(100, (topSpeed / 300) * 100))
  const psPct   = Math.max(5, Math.min(100, (psNum / 200) * 100))

  return `
    <!-- \u2500\u2500 Wichtig: immer sichtbar \u2500\u2500 -->
    <div class="konf-top-row">
      ${headerCard || `
      <div class="konf-card konf-card-header konf-reveal">
        <h1 class="konf-title">${data.fullName}</h1>
        <p class="konf-desc">${data.desc}</p>
        <div class="konf-price-row">
          <span class="konf-price-tag">${data.price}</span>
          <span class="konf-price-note">inkl. MwSt.</span>
        </div>
      </div>`}

      <div class="konf-card konf-reveal" id="konf-bars-card">
      <h3 class="konf-card-title">Leistungsdaten</h3>
      <div class="konf-bar-group">
        <div class="konf-bar-header">
          <span class="konf-bar-label">Beschleunigung 0\u2013100 km/h</span>
          <span class="konf-bar-value"><span class="konf-bar-counter" data-target="${accel}" data-decimals="1">0</span> s</span>
        </div>
        <div class="konf-bar-track"><div class="konf-bar-fill" data-pct="${accelPct}" style="width:0%"></div></div>
      </div>
      <div class="konf-bar-group">
        <div class="konf-bar-header">
          <span class="konf-bar-label">Leistung</span>
          <span class="konf-bar-value"><span class="konf-bar-counter" data-target="${kw}" data-decimals="0">0</span> kW / <span class="konf-bar-counter" data-target="${ps}" data-decimals="0">0</span> PS</span>
        </div>
        <div class="konf-bar-track"><div class="konf-bar-fill" data-pct="${psPct}" style="width:0%"></div></div>
      </div>
      <div class="konf-bar-group">
        <div class="konf-bar-header">
          <span class="konf-bar-label">H\u00f6chstgeschwindigkeit</span>
          <span class="konf-bar-value"><span class="konf-bar-counter" data-target="${topSpeed}" data-decimals="0">0</span> km/h</span>
        </div>
        <div class="konf-bar-track"><div class="konf-bar-fill" data-pct="${speedPct}" style="width:0%"></div></div>
      </div>
    </div>
    </div><!-- end konf-top-row -->

    <!-- \u2500\u2500 Toggle \u2500\u2500 -->
    <button class="konf-mehr-btn${mehrOpen ? ' konf-mehr-btn--open' : ''}" id="konf-mehr-btn">
      <span class="konf-mehr-label">${mehrOpen ? 'Weniger anzeigen' : 'Mehr anzeigen'}</span>
      <svg class="konf-mehr-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </button>

    <!-- \u2500\u2500 Sekund\u00e4r: offen ab Tablet, auf Handybreite zugeklappt \u2500\u2500 -->
    <div class="konf-mehr-section${mehrOpen ? ' konf-mehr-open' : ''}" id="konf-mehr-section">
      ${data.highlights.map(h => `
        <div class="konf-card">
          <h3 class="konf-card-title">${h.title}</h3>
          <p class="konf-card-text">${h.text}</p>
        </div>
      `).join('')}

      <div class="konf-card">
        <h3 class="konf-card-title">Technische Daten</h3>
        <div class="konf-table">
          <div class="konf-table-row"><span class="konf-table-key">Hubraum</span><span class="konf-table-val">${data.specs.cc} ccm</span></div>
          <div class="konf-table-row"><span class="konf-table-key">Leistung</span><span class="konf-table-val">${data.specs.power}</span></div>
          <div class="konf-table-row"><span class="konf-table-key">H\u00f6chstgeschwindigkeit</span><span class="konf-table-val">${data.specs.topSpeed} km/h</span></div>
          <div class="konf-table-row"><span class="konf-table-key">Beschleunigung 0\u2013100</span><span class="konf-table-val">${data.specs.accel} s</span></div>
          <div class="konf-table-row"><span class="konf-table-key">Gewicht</span><span class="konf-table-val">${data.specs.weight} kg</span></div>
          <div class="konf-table-row"><span class="konf-table-key">Sitzh\u00f6he</span><span class="konf-table-val">${data.specs.seat} cm</span></div>
          <div class="konf-table-row"><span class="konf-table-key">Tankvolumen</span><span class="konf-table-val">${data.specs.tank} L</span></div>
          <div class="konf-table-row"><span class="konf-table-key">Getriebe</span><span class="konf-table-val">${data.specs.gear}</span></div>
        </div>
      </div>

      <div class="konf-card">
        <h3 class="konf-card-title">Ausstattung</h3>
        <div class="konf-equip-grid">
          ${data.equipment.map(e => `
            <div class="konf-equip-item">
              <span class="konf-equip-name">${e.name}</span>
              <span class="konf-equip-cat">${e.category}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="konf-next-cta">
        <button class="konf-next-btn" data-next="ausstattung">
          <span class="konf-next-label">Ausr\u00fcstung entdecken</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>
  `
}

function buildAusstattungView(data) {
  return `
    <!-- Eine Leiste statt zwei: Kategorien scrollen links, rechts die vier
         Bedienelemente, die man im Blick behalten will (Anzahl, Favoriten,
         Ansicht) bzw. haeufig oeffnet (Filter). Preis, Sortierung und
         Preisauswahl liegen im Blatt darunter — zusammen belegten sie vorher
         eine zweite fixierte Zeile und 168px Hoehe vor der ersten Kachel. -->
    <div class="gear-filter-bar">
      <div class="gear-filter-cats">
        <button class="gear-filter-btn gear-filter-btn--active" data-filter="all">Alle</button>
        <button class="gear-filter-btn" data-filter="helmet">Helm</button>
        <button class="gear-filter-btn" data-filter="jacket">Jacke</button>
        <button class="gear-filter-btn" data-filter="gloves">Handschuhe</button>
        <button class="gear-filter-btn" data-filter="boots">Stiefel</button>
        <button class="gear-filter-btn" data-filter="pants">Hose</button>
        <button class="gear-filter-btn" data-filter="kidneybelt">Nierengurt</button>
        <button class="gear-filter-btn" data-filter="balaclava">Sturmhaube</button>
        <button class="gear-filter-btn" data-filter="backprotector">R\u00fcckenprotektor</button>
      </div>

      <div class="gear-bar-tools">
        <span class="gear-count-badge" id="gear-count-badge">0 Artikel</span>
        <button class="gear-pill gear-fav-toggle" id="gear-fav-toggle" data-active="false" aria-label="Nur Favoriten zeigen">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span class="gear-pill-count" id="gear-fav-toggle-count">0</span>
        </button>
        <button class="gear-pill gear-tools-btn" id="gear-tools-btn" type="button" aria-expanded="false" aria-controls="gear-tools-sheet">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          <span class="gear-tools-label">Filter</span>
          <span class="gear-tools-dot" id="gear-tools-dot" hidden></span>
        </button>
        <div class="gear-view-toggle" role="group" aria-label="Ansicht">
          <button class="gear-view-btn" data-view="grid" aria-pressed="true" title="Kachelansicht" aria-label="Kachelansicht">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
          <button class="gear-view-btn" data-view="list" aria-pressed="false" title="Listenansicht" aria-label="Listenansicht">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- Filterblatt: haengt unter dem Filter-Knopf, nimmt keinen Platz im
           Fluss ein und schliesst bei Klick daneben, Escape oder Scrollen. -->
      <div class="gear-tools-sheet" id="gear-tools-sheet" hidden>
        <div class="gear-tools-group">
          <span class="gear-tools-legend">Preis</span>
          <div class="gear-price-inputs">
            <div class="gear-price-field">
              <input class="gear-price-input" id="gear-price-min" type="number" min="0" max="2000" step="10" value="0" placeholder="0" aria-label="Mindestpreis in Euro">
              <span class="gear-price-field-unit">\u20ac</span>
            </div>
            <span class="gear-price-sep">\u2013</span>
            <div class="gear-price-field">
              <input class="gear-price-input" id="gear-price-max" type="number" min="0" max="2000" step="10" value="1000" placeholder="1000" aria-label="H\u00f6chstpreis in Euro">
              <span class="gear-price-field-unit">\u20ac</span>
            </div>
          </div>
        </div>

        <div class="gear-tools-group">
          <span class="gear-tools-legend">Sortierung</span>
          <button class="gear-pill gear-sort-btn" id="gear-sort-btn" data-dir="none" type="button">
            <span class="gear-sort-label">Preis \u2191</span>
          </button>
        </div>

        <div class="gear-tools-group">
          <span class="gear-tools-legend">Auswahl</span>
          <button class="gear-pill gear-deal-toggle" id="gear-deal-toggle" data-active="false" type="button">
            <span class="gear-pill-icon">\u20ac</span><span>G\u00fcnstigstes Viertel</span>
          </button>
        </div>

        <button class="gear-tools-reset" id="gear-tools-reset" type="button">Zur\u00fccksetzen</button>
      </div>
    </div>

    <div class="gear-empty-state" id="gear-empty" style="display:none">
      <div class="gear-empty-icon">\ud83d\udd0d</div>
      <span>Keine Produkte in dieser Preisspanne</span>
    </div>

    ${buildGearCards(data.style)}

    <div class="konf-next-cta konf-reveal">
      <button class="konf-next-btn" data-next="community">
        <span class="konf-next-label">Community entdecken</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    </div>
  `
}


function buildCommunityView(data) {
  return `
    <div class="gear-price-row">
      <div class="gear-price-top cc-topbar">
        <button class="cc-menu-btn" id="cc-menu-btn" aria-label="Menü">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
        <div class="cc-filter-strip cc-filter-strip--hidden">
          <button class="cc-filter-pill gear-filter-btn gear-filter-btn--active" data-filter="all">Alle</button>
          <button class="cc-filter-pill gear-filter-btn" data-filter="video">Videos</button>
          <button class="cc-filter-pill gear-filter-btn" data-filter="short">Shorts</button>
          <button class="cc-filter-pill gear-filter-btn" data-filter="tour">Touren</button>
          <button class="cc-filter-pill gear-filter-btn" data-filter="event">Events</button>
          <button class="cc-filter-pill gear-filter-btn" data-filter="group">Gruppen</button>
          <button class="cc-filter-pill gear-filter-btn" data-filter="stammtisch">Stammtische</button>
          <button class="cc-filter-pill gear-filter-btn" data-filter="forum">Forum</button>
        </div>
        <div class="cc-search-wrap">
          <div class="cc-search-field">
            <input type="text" class="cc-search-input" id="cc-search-input" placeholder="Suchen">
            <button class="cc-search-go" aria-label="Suchen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </button>
          </div>
          <button class="cc-mic-btn" aria-label="Spracheingabe">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
          </button>
        </div>
        <div class="cc-topbar-right">
          <button class="cc-create-btn" id="cc-create-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>Erstellen</span>
          </button>
          <button class="cc-notif-btn" id="cc-notif-btn" aria-label="Benachrichtigungen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span class="cc-notif-badge">9+</span>
          </button>
          <button class="cc-profile-btn" aria-label="Profil" id="cc-profile-btn">${getCurrentUserInitials()}</button>
        </div>
      </div>
    </div>

    <div class="gear-empty-state" id="gear-empty" style="display:none">
      <div class="gear-empty-icon">\ud83d\udd0d</div>
      <span>Keine Eintr\u00e4ge in dieser Kategorie</span>
    </div>

    ${buildCommunityCards()}

    <button class="cc-fab" id="cc-fab" aria-label="Eigenen Eintrag hinzuf\u00fcgen">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>

    <div class="cc-detail-overlay" id="cc-detail-overlay" style="display:none"></div>

    <div class="cc-modal" id="cc-modal" style="display:none">
      <div class="cc-modal-backdrop" id="cc-modal-backdrop"></div>
      <div class="cc-modal-card">
        <button class="cc-modal-close" id="cc-modal-close" aria-label="Schlie\u00dfen">\u00d7</button>
        <h3 class="cc-modal-title">Eigenen Eintrag hinzuf\u00fcgen</h3>
        <p class="cc-modal-sub">Teile etwas mit der Community</p>
        <form id="cc-modal-form">
          <label class="cc-field">
            <span class="cc-field-label">Kategorie</span>
            <select class="cc-input" id="cc-form-category" required>
              <option value="video">Video</option>
              <option value="short">Short</option>
              <option value="tour">Tour</option>
              <option value="event">Event</option>
              <option value="group">Gruppe</option>
              <option value="stammtisch">Stammtisch</option>
              <option value="forum">Forum-Thread</option>
            </select>
          </label>
          <label class="cc-field">
            <span class="cc-field-label">Titel</span>
            <input class="cc-input" id="cc-form-title" type="text" maxlength="40" placeholder="z.B. Schwarzwald Sonntagstour" required>
          </label>
          <label class="cc-field">
            <span class="cc-field-label">Beschreibung</span>
            <textarea class="cc-input" id="cc-form-desc" rows="2" maxlength="80" placeholder="Kurze Beschreibung..." required></textarea>
          </label>
          <div class="cc-field-row">
            <label class="cc-field">
              <span class="cc-field-label">Meta</span>
              <input class="cc-input" id="cc-form-meta" type="text" maxlength="20" placeholder="z.B. Kurvig">
            </label>
            <label class="cc-field">
              <span class="cc-field-label">Info</span>
              <input class="cc-input" id="cc-form-extra" type="text" maxlength="25" placeholder="z.B. 120 km \u00b7 4.8\u2605">
            </label>
          </div>
          <div class="cc-modal-actions">
            <button type="button" class="cc-btn-secondary" id="cc-modal-cancel">Abbrechen</button>
            <button type="submit" class="cc-btn-primary">Ver\u00f6ffentlichen</button>
          </div>
        </form>
      </div>
    </div>

    <div class="konf-next-cta konf-reveal">
      <button class="konf-next-btn" data-next="karte">
        <span class="konf-next-label">Karte \u00f6ffnen</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    </div>
  `
}

function buildKarteView(data) {
  return `
    <section class="hub-section konf-karte-hub" id="gr-hub-section">
      <div class="hub-inner">
        <!-- Map + Sidebar layout -->
        <div class="kv-layout">
          <div class="hub-map-wrap kv-map-wrap">
            <div class="hub-map" id="hub-gmap">
              <div class="hub-map-loading" id="hub-map-loading">
                <span class="hub-map-spinner"></span>
                <span>Standort wird ermittelt\u2026</span>
              </div>
            </div>
            <div class="kv-map-controls" id="kv-map-controls">
              <div class="kv-zoom-group">
                <button type="button" class="kv-zoom-btn" id="kv-zoom-in-btn" aria-label="Vergr\u00f6\u00dfern" title="Vergr\u00f6\u00dfern">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
                <div class="kv-zoom-divider"></div>
                <button type="button" class="kv-zoom-btn" id="kv-zoom-out-btn" aria-label="Verkleinern" title="Verkleinern">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>
                </button>
              </div>
              <button type="button" class="kv-map-fab" id="kv-map-recenter-btn" aria-label="Mein Standort" title="Mein Standort">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>
              </button>
            </div>
            <!-- Erscheint erst, wenn der Nutzer die Karte selbst verschoben
                 hat: bis dahin gaebe es nichts Neues zu suchen. -->
            <button type="button" class="kv-search-here" id="kv-search-here" hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
              <span>Hier suchen</span>
            </button>
          </div>

          <aside class="kv-sidebar">
            <!-- Drag-Handle: nur unterhalb des kv-layout-Breakpoints sichtbar,
                 dort wird das Panel per CSS zum Apple-Maps-artigen Bottom-Sheet -->
            <div class="kv-sheet-handle" id="kv-sheet-handle" aria-hidden="true"></div>
            <!-- Radius + Ortssuche -->
            <div class="kv-search-row">
              <div class="kv-radius-group" role="group" aria-label="Suchradius">
                <div class="kv-radius-pills">
                  <button class="kv-radius-pill" data-radius="2000">2 km</button>
                  <button class="kv-radius-pill kv-radius-pill--active" data-radius="5000">5 km</button>
                  <button class="kv-radius-pill" data-radius="10000">10 km</button>
                  <button class="kv-radius-pill" data-radius="25000">25 km</button>
                  <button class="kv-radius-pill" data-radius="50000">50 km</button>
                </div>
              </div>
              <div class="kv-search-wrap">
                <button class="kv-search-toggle" id="kv-search-toggle" aria-label="Ort suchen" aria-expanded="false" title="Ort suchen">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                </button>
                <div class="kv-search-field" id="kv-search-field">
                  <svg class="kv-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                  <input type="text" class="kv-search-input" id="kv-search-input" placeholder="PLZ oder Ort eingeben…">
                  <button class="kv-recenter-btn" id="kv-recenter-btn" aria-label="Mein Standort" title="Mein Standort">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- Category pills -->
            <div class="hub-filters kv-filters">
              <button class="hub-pill active" data-query="Motorradwerkstatt">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                <span>Werkst\u00e4tten</span>
              </button>
              <button class="hub-pill" data-query="Motorradh\u00e4ndler">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4l1-3h14zM2 7h20v5H2zM4 12v9h4v-5h8v5h4v-9"/></svg>
                <span>H\u00e4ndler</span>
              </button>
              <button class="hub-pill" data-query="Fahrschule">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                <span>Fahrschulen</span>
              </button>
              <button class="hub-pill" data-query="Tankstelle">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h12M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M5 11h10M15 6l3 3v8a2 2 0 0 1-4 0v-2"/></svg>
                <span>Tankstellen</span>
              </button>
              <button class="hub-pill" data-query="Parkplatz">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>
                <span>Parkpl\u00e4tze</span>
              </button>
              <button class="hub-pill" data-query="Cafe">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 1v3M10 1v3M14 1v3"/></svg>
                <span>Biker-Treffs</span>
              </button>
              <button class="hub-pill" data-query="Notdienst">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                <span>Notdienst</span>
              </button>
            </div>

            <!-- Kopfzeile der Trefferliste: sagt, wie viele es sind, und
                 traegt die drei Schalter, die auf die vorhandenen Daten
                 zugreifen (Entfernung/Bewertung, Oeffnungsstatus, Gemerkte). -->
            <div class="kv-list-bar">
              <span class="kv-list-count" id="kv-list-count"></span>
              <div class="kv-list-tools">
                <button type="button" class="kv-chip" id="kv-sort-btn" data-sort="distance">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18M3 7l4-4 4 4M17 21V3M13 17l4 4 4-4"/></svg>
                  <span class="kv-sort-label">Entfernung</span>
                </button>
                <button type="button" class="kv-chip" id="kv-open-toggle" data-active="false">Ge\u00f6ffnet</button>
                <button type="button" class="kv-chip kv-chip--fav" id="kv-fav-filter" data-active="false" aria-label="Gemerkte Orte">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  <span class="kv-chip-count" id="kv-fav-count">0</span>
                </button>
              </div>
            </div>

            <div class="kv-results-list" id="kv-results-list">
              <div class="kv-results-empty"><span>\u2026</span></div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `
}

/* ═══════════════════════════════════════════════════
   MATCH-REITER
   Drei Ebenen: wie gut passt das offene Bike zum Quiz-Profil,
   welche Matches liegen schon gespeichert vor, und was empfiehlt
   das Profil sonst noch.
   ═══════════════════════════════════════════════════ */

/** Sortierung der gespeicherten Matches — überlebt Tab-Wechsel. */
let matchSort = 'recent' // 'recent' | 'score'
/** Zuletzt gelöschter Eintrag für "Rückgängig" — { entry, index, timer }. */
let matchUndo = null

const RING_CIRCUMFERENCE = 2 * Math.PI * 28

/** Katalog-Bike zum gerade geöffneten (normalisierten) Datensatz. */
function catalogBikeFor(data) {
  if (!data) return null
  return findBikeByShortName(data.fullName || data.bgText || '') || null
}

/** Voller Anzeigename inkl. Marke — der Katalogname ist der Speicher-Schlüssel. */
function matchDisplayName(data, bike) {
  if (bike?.name) return bike.name
  return [data?.brand, data?.fullName].filter(Boolean).join(' ')
}

/**
 * Ergänzt einen gespeicherten Eintrag aus dem Katalog. Alte Einträge (aus
 * der Übernahme von `mm_primary_bike`) haben weder Bild noch Stil, und ein
 * geänderter Katalog soll sich in der Liste zeigen statt eingefroren zu sein.
 */
function enrichMatch(m) {
  const bike = findBikeByShortName(m.name)
  return {
    ...m,
    style: m.style || bike?.style || '',
    image: m.image || bike?.image2 || bike?.image || '',
    price: m.price || bike?.priceDisplay || '',
  }
}

function sortedMatches() {
  const list = getMatches().map(enrichMatch)
  if (matchSort === 'score') {
    // Einträge ohne Score (Alt-Übernahme) ans Ende, sonst stünden sie oben.
    return list.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.ts - a.ts)
  }
  return list.sort((a, b) => b.ts - a.ts)
}

const MM_ICON_STAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
const MM_ICON_X = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
const MM_ICON_PLUS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
const MM_ICON_CHECK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'

function buildMatchView(data) {
  const bike = catalogBikeFor(data)
  // Der Suchbegriff hing vorher an `data.name` — das Feld gibt es auf dem
  // normalisierten Objekt nicht, die Gebraucht-Links landeten dadurch auf
  // einer leeren Suche.
  const q = encodeURIComponent(matchDisplayName(data, bike))
  const kleinanzeigenUrl = `https://www.kleinanzeigen.de/s-motorraeder-roller/${q}/k0c305`
  const mobileUrl = `https://suchen.mobile.de/fahrzeuge/search.html?ms=&s=Motorbike&fr=&sfmr=false&isSearchRequest=true&makeModelVariantExact=true&fnai=prem&keyword=${q}`
  const ebayUrl = `https://www.ebay.de/sch/i.html?_from=R40&_trksid=p2334524.m570.l1313&_nkw=${q}&_sacat=6024`

  return `
    ${buildMatchScoreCard(data, bike)}
    ${buildMatchSavedCard(bike)}
    ${buildMatchRecoCard(bike)}
    <div class="konf-card konf-card-cta konf-reveal">
      <span class="konf-overline konf-overline--light">Nächster Schritt</span>
      <h3 class="konf-card-title konf-card-title--lg">Bereit für dein Bike?</h3>
      <p class="konf-card-text">Finde einen Händler in deiner Nähe oder starte das Quiz für eine personalisierte Empfehlung.</p>
      <div class="konf-cta-row">
        <button class="konf-cta-btn konf-cta-primary" id="konf-cta-dealer">Händler finden</button>
        <button class="konf-cta-btn konf-cta-secondary" id="konf-cta-quiz">Neues Match finden</button>
      </div>
      <div class="konf-used-row">
        <span class="konf-used-label">Gebraucht suchen:</span>
        <a class="konf-used-btn" href="${kleinanzeigenUrl}" target="_blank" rel="noopener noreferrer">Kleinanzeigen</a>
        <a class="konf-used-btn" href="${mobileUrl}" target="_blank" rel="noopener noreferrer">mobile.de</a>
        <a class="konf-used-btn" href="${ebayUrl}" target="_blank" rel="noopener noreferrer">eBay</a>
      </div>
    </div>
  `
}

/** Speichern-/Gespeichert-Schalter für das gerade offene Bike. */
/**
 * Beschriftung des Merken-Schalters als Lang-/Kurz-Paar. Auf 375px passt
 * "Als Match merken" nicht neben "Quiz wiederholen" in eine Zeile — es fehlen
 * rund 5px, der Text brach mitten im Knopf um. Gleiches Muster wie die
 * Reiter-Beschriftung in der Taskleiste (tb-lbl-lang/tb-lbl-kurz).
 */
function matchSaveLabel(saved) {
  return saved
    ? '<span class="mm-lbl-lang">Gemerkt</span><span class="mm-lbl-kurz">Gemerkt</span>'
    : '<span class="mm-lbl-lang">Als Match merken</span><span class="mm-lbl-kurz">Merken</span>'
}

function buildMatchSaveBtn(bike) {
  if (!bike) return ''
  const saved = hasMatch(bike.name)
  return `
    <button class="mm-match-btn${saved ? ' mm-match-btn--on' : ''}" id="mm-match-save" data-saved="${saved}">
      <span class="mm-match-btn-icon">${saved ? MM_ICON_CHECK : MM_ICON_PLUS}</span>
      <span class="mm-match-btn-label">${matchSaveLabel(saved)}</span>
    </button>`
}

/**
 * Preiszeile in der Passgenauigkeits-Karte. Nutzt die Preis-Typografie der
 * Ansicht-Seite, damit derselbe Wert überall gleich aussieht.
 */
function buildMatchPriceRow(data, bike) {
  const price = data?.price || bike?.priceDisplay || ''
  if (!price) return ''
  return `
    <div class="konf-price-row mm-match-price">
      <span class="konf-price-tag">${esc(price)}</span>
      <span class="konf-price-note">inkl. MwSt.</span>
    </div>`
}

function buildMatchScoreCard(data, bike) {
  const answers = getLastAnswers()
  const title = esc(matchDisplayName(data, bike))
  const priceRow = buildMatchPriceRow(data, bike)

  // Ohne Quiz-Antworten (oder ohne Katalog-Treffer) gibt es nichts zu
  // rechnen — dann führt die Karte zum Quiz, statt eine Zahl zu erfinden.
  if (!answers || !bike) {
    return `
      <div class="konf-card mm-match-card konf-reveal" id="mm-match-score">
        <span class="konf-overline">Passgenauigkeit</span>
        <h3 class="konf-card-title konf-card-title--lg">${title}</h3>
        ${priceRow}
        <p class="konf-card-text">${answers
          ? 'Für dieses Modell liegen noch keine Matching-Daten vor.'
          : 'Beantworte das Quiz — danach siehst du hier, wie gut dieses Bike zu Führerschein, Budget, Körpergröße und Einsatzzweck passt.'}</p>
        <div class="mm-match-actions">
          ${buildMatchSaveBtn(bike)}
          <button class="mm-match-btn" id="mm-match-quiz">${answers ? 'Quiz wiederholen' : 'Quiz starten'}</button>
        </div>
      </div>`
  }

  const res = scoreBikeAgainst(bike, answers)
  const W = MATCH_WEIGHTS
  const factors = [
    ['style', 'Stil & Charakter', W.STYLE],
    ['use', 'Einsatzzweck', W.USE_CASE],
    ['budget', 'Budget', W.BUDGET],
    ['seatHeight', 'Sitzhöhe', W.SEAT_HEIGHT],
  ]
  if (answers.q7 === 'Ja') factors.push(['passenger', 'Sozius-Tauglichkeit', W.PASSENGER])

  const bars = factors.map(([key, label, weight]) => {
    const pct = Math.max(0, Math.min(100, Math.round(((res.breakdown[key] ?? 0) / weight) * 100)))
    return `
      <div class="konf-bar-group">
        <div class="konf-bar-header">
          <span class="konf-bar-label">${label}</span>
          <span class="konf-bar-value"><span class="konf-bar-counter" data-target="${pct}" data-decimals="0">0</span>&thinsp;%</span>
        </div>
        <div class="konf-bar-track"><div class="konf-bar-fill" data-pct="${pct}" style="width:0%"></div></div>
      </div>`
  }).join('')

  const notes = []
  if (!res.fits.license) notes.push(`Braucht Führerschein <b>${esc(bike.license)}</b> — dein Profil: <b>${esc(answers.q1 || '–')}</b>.`)
  if (!res.fits.budget) notes.push(`Liegt über deinem Budget von <b>${fmtBudget(answers.q5)}</b>.`)
  if ((res.breakdown.beginnerPenalty ?? 0) < 0) notes.push('Für den Einstieg anspruchsvoll — viel Leistung, wenig Fehlerverzeihung.')

  return `
    <div class="konf-card mm-match-card konf-reveal" id="mm-match-score">
      <div class="mm-match-score-head">
        <div class="mm-match-score-text">
          <span class="konf-overline">Passgenauigkeit</span>
          <h3 class="konf-card-title konf-card-title--lg">${title}</h3>
          ${priceRow}
          <p class="mm-match-score-sub">${esc(matchVerdict(res.pct))}</p>
        </div>
        <div class="mm-match-ring">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle class="mm-match-ring-bg" cx="32" cy="32" r="28"/>
            <circle class="mm-match-ring-fill" cx="32" cy="32" r="28"
                    data-pct="${res.pct}"
                    stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(1)}"
                    stroke-dashoffset="${RING_CIRCUMFERENCE.toFixed(1)}"/>
          </svg>
          <span class="mm-match-ring-num"><span class="konf-bar-counter" data-target="${res.pct}" data-decimals="0">0</span><i>%</i></span>
        </div>
      </div>
      <div class="mm-match-bars">${bars}</div>
      ${notes.length ? `<ul class="mm-match-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ul>` : ''}
      <div class="mm-match-actions">
        ${buildMatchSaveBtn(bike)}
        <button class="mm-match-btn" id="mm-match-quiz">Quiz wiederholen</button>
      </div>
    </div>`
}

function matchVerdict(pct) {
  if (pct >= 85) return 'Passt hervorragend zu deinem Profil.'
  if (pct >= 65) return 'Passt gut — mit kleinen Abstrichen.'
  if (pct >= 45) return 'Teilweise passend. Sieh dir die Punkte unten an.'
  return 'Passt nur bedingt zu deinen Angaben.'
}

function fmtBudget(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('de-DE')} €` : '–'
}

/* ── Gespeicherte Matches ── */

function buildMatchSavedCard(currentBike) {
  const list = sortedMatches()
  return `
    <div class="konf-card mm-match-card konf-reveal" id="mm-match-saved">
      <div class="mm-match-head">
        <div class="mm-match-head-text">
          <span class="konf-overline">Deine Matches</span>
          <h3 class="konf-card-title konf-card-title--lg">Gespeichert <span class="mm-match-count" id="mm-match-count">${list.length}</span></h3>
        </div>
        <div class="mm-match-tools">
          <button type="button" class="mm-match-chip" id="mm-match-sort">${matchSort === 'score' ? 'Nach Score' : 'Neueste'}</button>
          <button type="button" class="mm-match-chip mm-match-chip--danger" id="mm-match-clear"${list.length ? '' : ' hidden'}>Alle löschen</button>
        </div>
      </div>
      <div class="mm-match-undo" id="mm-match-undo" hidden></div>
      <div class="mm-match-list" id="mm-match-list">${buildMatchRows(list, currentBike)}</div>
    </div>`
}

function buildMatchRows(list, currentBike) {
  if (!list.length) {
    return `
      <div class="mm-match-empty">
        <span class="mm-match-empty-title">Noch keine Matches gespeichert.</span>
        <span class="mm-match-empty-sub">Jeder Quiz-Treffer landet automatisch hier — oder merke dir das offene Bike über den Schalter oben.</span>
      </div>`
  }
  const primary = getPrimaryBike()
  return list.map(m => `
    <div class="mm-match-row${m.name === currentBike?.name ? ' mm-match-row--current' : ''}" data-row-match="${esc(m.name)}">
      <button type="button" class="mm-match-open" data-open-match="${esc(m.name)}">
        <span class="mm-match-thumb">${m.image
          ? `<img src="${esc(m.image)}" alt="" loading="lazy">`
          : '<span class="mm-match-thumb-ph">\u{1F3CD}</span>'}</span>
        <span class="mm-match-info">
          <span class="mm-match-name">${esc(m.name)}</span>
          <span class="mm-match-meta">${[esc(m.style), m.source === 'legacy' ? 'Früheres Match' : fmtRelative(m.ts)].filter(Boolean).join(' · ')}</span>
        </span>
        ${m.pct != null ? `<span class="mm-match-pct">${m.pct}<i>%</i></span>` : ''}
      </button>
      <div class="mm-match-row-actions">
        <button type="button" class="mm-match-icon${primary === m.name ? ' mm-match-icon--on' : ''}"
                data-star-match="${esc(m.name)}"
                aria-pressed="${primary === m.name}"
                aria-label="${primary === m.name ? 'Hauptbike zurücknehmen' : 'Als Hauptbike festlegen'}"
                title="${primary === m.name ? 'Hauptbike zurücknehmen' : 'Als Hauptbike festlegen'}">${MM_ICON_STAR}</button>
        <button type="button" class="mm-match-icon mm-match-icon--del" data-del-match="${esc(m.name)}"
                aria-label="Match entfernen" title="Match entfernen">${MM_ICON_X}</button>
      </div>
    </div>`).join('')
}

/* ── Vorschläge: was sonst noch passen könnte ── */

/** Mindestpreis aus dem Katalogfeld ("18000-25000" → 18000). */
function bikeMinPrice(bike) {
  const match = String(bike?.price ?? '').match(/(\d[\d.]*)/)
  return match ? parseInt(match[1].replace(/\./g, ''), 10) : 0
}

/**
 * Kurze Begründung, warum ein Vorschlag hier steht — höchstens zwei Chips,
 * sonst wird die Kachel zur Textwüste.
 */
function matchWhyChips(bike, currentBike) {
  const chips = []
  if (currentBike && bike.style === currentBike.style) chips.push('Gleicher Stil')
  else if (currentBike && bike.use === currentBike.use) chips.push(`Auch für ${bike.use}`)
  else if (bike.beginner) chips.push('Einsteigerfreundlich')

  if (currentBike) {
    const dPrice = bikeMinPrice(bike) - bikeMinPrice(currentBike)
    if (Math.abs(dPrice) >= 500) {
      chips.push(`${Math.abs(dPrice).toLocaleString('de-DE')} € ${dPrice < 0 ? 'günstiger' : 'teurer'}`)
    } else {
      const dPs = (bike.ps || 0) - (currentBike.ps || 0)
      if (Math.abs(dPs) >= 5) chips.push(`${dPs > 0 ? '+' : '−'}${Math.abs(dPs)} PS`)
    }
  }
  if (!chips.length && bike.license) chips.push(`Führerschein ${bike.license}`)
  return chips.slice(0, 2)
}

function buildMatchRecoCard(currentBike) {
  const answers = getLastAnswers()
  const saved = new Set(getMatches().map(m => m.name))

  // Erste Wahl: Treffer aus dem Quiz-Profil. Bleibt davon nach Abzug des
  // offenen und der bereits gemerkten Bikes fast nichts übrig, ist eine
  // Ein-Eintrag-Karte wertlos — dann lieber ähnliche Modelle zum offenen
  // Bike zeigen. Ohne Quiz gibt es ohnehin nur diesen Weg.
  const fromProfile = answers
    ? findTopMatches(answers, 10)
        .filter(r => r.bike.name !== currentBike?.name && !saved.has(r.bike.name))
        .slice(0, 3)
    : []
  const useProfile = fromProfile.length >= 2

  const recs = useProfile
    ? fromProfile
    : findSimilarBikes(currentBike, 8)
        .filter(r => !saved.has(r.bike.name))
        .slice(0, 3)

  if (!recs.length) return ''

  const overline = useProfile ? 'Aus deinem Profil' : 'Alternativen'
  const title = useProfile ? 'Passt auch zu dir' : 'Könnte dir auch gefallen'
  const sub = useProfile
    ? 'Aus deinen Quiz-Antworten berechnet.'
    : `Ähnliche Modelle zur ${esc(currentBike?.style || 'Auswahl')}-Klasse, die du gerade ansiehst.`

  return `
    <div class="konf-card mm-match-card konf-reveal" id="mm-match-reco">
      <span class="konf-overline">${overline}</span>
      <h3 class="konf-card-title konf-card-title--lg">${title}</h3>
      <p class="mm-match-score-sub">${sub}</p>
      <div class="mm-reco-grid">
        ${recs.map(r => {
          const b = r.bike
          const pct = useProfile ? (scoreBikeAgainst(b, answers)?.pct ?? 0) : null
          const img = b.image2 || b.image || ''
          const chips = matchWhyChips(b, currentBike)
          return `
            <article class="mm-reco-card" data-row-match="${esc(b.name)}">
              <button type="button" class="mm-reco-open" data-open-match="${esc(b.name)}">
                <span class="mm-reco-media">
                  ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="mm-reco-media-ph">\u{1F3CD}</span>'}
                  ${pct != null ? `<span class="mm-reco-badge">${pct}<i>%</i></span>` : ''}
                </span>
                <span class="mm-reco-body">
                  <span class="mm-reco-name">${esc(b.name)}</span>
                  <span class="mm-reco-meta">${[esc(b.style), esc(b.priceDisplay || '')].filter(Boolean).join(' · ')}</span>
                  ${chips.length ? `<span class="mm-reco-why">${chips.map(c => `<span class="mm-reco-chip">${esc(c)}</span>`).join('')}</span>` : ''}
                </span>
              </button>
              <button type="button" class="mm-reco-add" data-add-match="${esc(b.name)}">
                ${MM_ICON_PLUS}<span>Merken</span>
              </button>
            </article>`
        }).join('')}
      </div>
    </div>`
}
// Discord-style community mounts into this root (see community.js)
function buildCommunityRoot() {
  return `<div id="mm-comm-root" class="mm-comm-root"></div>`
}

const tabViewBuilders = {
  ansicht: buildAnsichtView,
  ausstattung: buildAusstattungView,
  community: buildCommunityRoot,
  karte: buildKarteView,
  match: buildMatchView,
}

function switchTab(tabName, data) {
  const container = document.getElementById('konf-right')
  if (!container || !tabViewBuilders[tabName]) return

  activeKonfTab = tabName
  document.querySelectorAll('.konf-tb-wrap .tb-btn[data-tab]').forEach(b => {
    b.classList.toggle('tb-btn-active', b.dataset.tab === tabName)
  })

  // Persist last active tab
  try { localStorage.setItem('mm_last_tab', tabName) } catch {}

  container.classList.add('konf-right--fading')

  setTimeout(() => {
    // Vollbild-/Hintergrund-Umschaltung erst jetzt, während der Inhalt
    // unsichtbar (opacity 0) ist — sonst blitzt kurz der helle Grund-
    // hintergrund hinter dem noch sichtbaren, alten Tab-Inhalt durch.
    const split = document.querySelector('.konf-split')
    if (split) {
      const fullscreen = tabName === 'ausstattung' || tabName === 'community' || tabName === 'karte'
      split.classList.toggle('konf-split--fullscreen', fullscreen)
      split.classList.toggle('konf-split--ausstattung', tabName === 'ausstattung')
      split.classList.toggle('konf-split--community', tabName === 'community')
      split.classList.toggle('konf-split--karte', tabName === 'karte')
      split.classList.remove('konf-bars-hidden') // reset scroll-hide state
    }

    container.innerHTML = tabViewBuilders[tabName](data)
    container.scrollTop = 0

    requestAnimationFrame(() => {
      container.classList.remove('konf-right--fading')

      initKonfiguratorAnimations()
      if (tabName === 'ansicht') animateBarsOnReveal()

      container.querySelector('.konf-next-btn')?.addEventListener('click', (e) => {
        const next = e.currentTarget.dataset.next
        if (next) switchTab(next, data)
      })

      if (tabName === 'match') bindMatchViewEvents(data)
      if (tabName === 'karte') bindKarteViewEvents()
      if (tabName === 'community') import('./community.js').then(m => m.mountCommunity(document.getElementById('mm-comm-root')))
    })
  }, 100)
}

// Fallback fuer die eingeklappte Hoehe, falls die Messung (syncKvPeek) noch
// nicht gelaufen ist.
const KV_SHEET_PEEK_FALLBACK = 116
// Wie nah an einem der beiden Enden das Sheet doch noch einrastet. Ohne das
// bliebe es auch 4px vor "ganz zu" stehen, was nach Fehler aussieht statt nach
// Absicht — dazwischen bleibt es aber stehen, wo man es loslaesst.
const KV_SHEET_EDGE_SNAP = 28
// Ab wann das Sheet als "oben" gilt: nur dafuer da, anderen Regeln (dem
// Feedback-Knopf) zu sagen, dass der Schirm jetzt dem Sheet gehoert.
const KV_SHEET_EXPANDED_AT = 0.2

/* Wie hoch das eingeklappte Sheet steht.
 *
 * Vorher ein fester Anteil der Fensterhoehe (28vh = 227px auf einem 812px
 * hohen Schirm). Das reichte genau aus, um alle vier Bedienzeilen plus 40px
 * leere Trefferliste zu zeigen — das Sheet nahm ein Viertel des Bildes ein
 * und zeigte darin nichts als sich selbst. Jetzt endet es in der Luecke unter
 * der Kategoriezeile: eingeklappt sind Radius und Kategorie zu sehen (das,
 * was man vor dem Suchen einstellt), die Treffer holt man mit einem Zug nach
 * oben. Gemessen statt geraten, weil die Zeilenhoehe von der Schriftgroesse
 * des Geraets abhaengt und ein fester Wert sonst mitten in eine Zeile
 * schneidet.
 */
function syncKvPeek() {
  const sheet = document.querySelector('.konf-karte-hub .kv-sidebar')
  const filters = sheet?.querySelector('.hub-filters')
  if (!sheet || !filters) return
  const top = sheet.getBoundingClientRect().top
  const bottom = filters.getBoundingClientRect().bottom
  if (bottom <= top) return
  const peek = Math.round(bottom - top + 12) + 'px'
  sheet.style.setProperty('--kv-peek', peek)
  // Zusaetzlich global: der Beta-Feedback-Knopf steht ausserhalb des Sheets
  // und weicht ueber dessen Kante aus (main.css, 767px-Block).
  document.documentElement.style.setProperty('--kv-peek', peek)
  // Steht das Sheet gerade auf einer frei gezogenen Hoehe, gilt die — die hat
  // setFree() schon gemeldet und darf hier nicht ueberschrieben werden.
  if (!sheet.style.transform) {
    publishKvVisible(sheet, sheet.classList.contains('kv-sheet--expanded')
      ? 0
      : sheet.offsetHeight - parseFloat(peek))
  }
}

function kvPeekPx(sheet) {
  const v = parseFloat(getComputedStyle(sheet).getPropertyValue('--kv-peek'))
  return Number.isFinite(v) && v > 0 ? v : KV_SHEET_PEEK_FALLBACK
}

/**
 * Sichtbare Hoehe der Sheet-Kante nach aussen melden.
 *
 * Der Beta-Feedback-Knopf steht ausserhalb des Sheets und weicht ueber dessen
 * Kante aus (main.css, 767px-Block). Solange das Sheet nur zwei Zustaende
 * hatte, reichte dafuer --kv-peek; seit es auf jeder Hoehe stehen bleiben
 * kann, braucht es die *aktuelle* Kante. --kv-peek bleibt daher, was es war
 * (die eingeklappte Ruhehoehe, aus der das CSS seinen Grundzustand rechnet),
 * und --kv-visible sagt, wo die Kante gerade wirklich steht.
 */
function publishKvVisible(sheet, translate) {
  const visible = Math.max(0, Math.round(sheet.offsetHeight - translate))
  document.documentElement.style.setProperty('--kv-visible', visible + 'px')
}

function bindKarteSheet() {
  const sheet = document.querySelector('.konf-karte-hub .kv-sidebar')
  const handle = document.getElementById('kv-sheet-handle')
  if (!sheet || !handle) return

  const mobileQuery = window.matchMedia('(max-width: 759.98px)')
  let dragging = false
  let didDrag = false
  let startY = 0
  let startTranslate = 0
  let sheetHeight = 0
  let peekPx = 0
  let currentTranslate = 0

  const isExpanded = () => sheet.classList.contains('kv-sheet--expanded')

  /** Auf einen der beiden Ruhezustaende zurueck — das CSS uebernimmt wieder. */
  const setExpanded = (expanded) => {
    sheet.style.transform = ''
    sheet.style.clipPath = ''
    sheet.classList.toggle('kv-sheet--expanded', expanded)
    publishKvVisible(sheet, expanded ? 0 : sheet.offsetHeight - kvPeekPx(sheet))
  }
  const toggle = () => setExpanded(!isExpanded())

  /**
   * Das Sheet auf eine frei gewaehlte Hoehe stellen.
   *
   * Inline gesetzt und inline gelassen: eine Inline-Deklaration schlaegt die
   * Klassenregel, das Sheet bleibt also stehen, wo es losgelassen wurde,
   * obwohl .kv-sheet--expanded weiterhin ein transform mitbringt. Die Klasse
   * ist damit nur noch Zustandsmerkmal fuer andere Regeln, nicht mehr die
   * Quelle der Position.
   */
  const setFree = (translate) => {
    currentTranslate = translate
    sheet.style.transform = `translateY(${translate}px)`
    // Mitgefuehrter Schnitt: verschoben wird um translate, also liegt genau
    // diese Strecke unterhalb der sichtbaren Kante.
    sheet.style.clipPath = `inset(0 0 ${translate}px 0)`
    sheet.classList.toggle('kv-sheet--expanded',
                           translate < (sheetHeight - peekPx) * KV_SHEET_EXPANDED_AT)
    publishKvVisible(sheet, translate)
  }

  const onPointerMove = (e) => {
    if (!dragging) return
    const y = e.touches ? e.touches[0].clientY : e.clientY
    const delta = y - startY
    if (Math.abs(delta) > 6) didDrag = true
    setFree(Math.max(0, Math.min(sheetHeight - peekPx, startTranslate + delta)))
    if (e.cancelable) e.preventDefault()
  }
  const onPointerUp = () => {
    if (!dragging) return
    dragging = false
    sheet.classList.remove('kv-sheet--dragging')
    document.removeEventListener('touchmove', onPointerMove)
    document.removeEventListener('touchend', onPointerUp)
    document.removeEventListener('mousemove', onPointerMove)
    document.removeEventListener('mouseup', onPointerUp)
    if (!didDrag) {
      // Kein Zug, nur ein Antipper — den behandelt onTap.
      return
    }
    // Stehenbleiben, wo losgelassen wurde. Nur ganz dicht an den beiden Enden
    // doch einrasten: dort ist "fast zu" bzw. "fast ganz oben" nie gemeint,
    // und der Rest-Spalt saehe aus wie ein Fehler.
    const maxTranslate = sheetHeight - peekPx
    if (currentTranslate <= KV_SHEET_EDGE_SNAP) setExpanded(true)
    else if (currentTranslate >= maxTranslate - KV_SHEET_EDGE_SNAP) setExpanded(false)
  }
  const onPointerDown = (e) => {
    if (!mobileQuery.matches) return
    if (e.target.closest('select, button, a, input')) return
    dragging = true
    didDrag = false
    startY = e.touches ? e.touches[0].clientY : e.clientY
    // Gemessen statt aus einem vh-Faktor gerechnet: offsetHeight ist die
    // Layout-Hoehe (vom transform unberuehrt) und stimmt damit immer mit dem
    // CSS ueberein, auch wenn dort jemand die 80vh aendert.
    sheetHeight = sheet.offsetHeight
    peekPx = kvPeekPx(sheet)
    // Aus einer freien Position weiterziehen statt zurueckzuspringen.
    const inline = parseFloat(sheet.style.transform.replace(/[^\d.-]/g, ''))
    startTranslate = Number.isFinite(inline)
      ? inline
      : (isExpanded() ? 0 : sheetHeight - peekPx)
    currentTranslate = startTranslate
    sheet.classList.add('kv-sheet--dragging')
    document.addEventListener('touchmove', onPointerMove, { passive: false })
    document.addEventListener('touchend', onPointerUp)
    document.addEventListener('mousemove', onPointerMove)
    document.addEventListener('mouseup', onPointerUp)
  }
  const onTap = (e) => {
    if (!mobileQuery.matches) return
    if (didDrag) { didDrag = false; return }
    if (e.target.closest('select, button, a, input')) return
    toggle()
  }

  handle.addEventListener('touchstart', onPointerDown, { passive: true })
  handle.addEventListener('mousedown', onPointerDown)
  handle.addEventListener('click', onTap)
}

/** ResizeObserver der zuletzt montierten Indikator-Leisten. Beim erneuten
 *  Öffnen des Karte-Tabs wird der Karteninhalt neu gebaut — die alten
 *  Beobachter zeigen dann auf abgehängte Knoten und werden hier getrennt. */
let kvThumbObservers = []

/**
 * Gleitender Auswahl-Indikator für eine Button-Leiste (Kategorien, Radius).
 * Statt den Hintergrund hart umzuschalten, wandert ein einzelnes weisses Feld
 * zur neuen Auswahl. Das Feld wird erst hier erzeugt: ohne JS bleibt der
 * .active-Hintergrund aus dem CSS als Fallback stehen.
 *
 * Gibt eine reposition()-Funktion zurück, die Aufrufer nach jedem Auswahl-
 * wechsel aufrufen. Layout-Änderungen deckt ein ResizeObserver selbst ab.
 * Rückgabe null, wenn die Leiste nicht existiert.
 */
function mountKvThumb(container, activeSelector, extraClass) {
  if (!container) return null
  const thumb = document.createElement('span')
  thumb.className = extraClass ? `kv-pill-thumb ${extraClass}` : 'kv-pill-thumb'
  thumb.setAttribute('aria-hidden', 'true')
  container.prepend(thumb)

  const reposition = (animate = true) => {
    const active = container.querySelector(activeSelector)
    if (!active || !active.offsetWidth) {
      thumb.style.opacity = '0'
      return
    }
    // Beim ersten Setzen ohne Übergang, sonst gleitet das Feld sichtbar aus
    // der linken Ecke an seine Startposition.
    if (!animate) thumb.style.transition = 'none'
    thumb.style.width = `${active.offsetWidth}px`
    thumb.style.height = `${active.offsetHeight}px`
    thumb.style.transform = `translate(${active.offsetLeft}px, -50%)`
    thumb.style.opacity = '1'
    if (!animate) {
      void thumb.offsetWidth // Reflow erzwingen, bevor die Transition zurückkommt
      thumb.style.transition = ''
    }
  }

  reposition(false)
  container.classList.add('kv-has-thumb')

  // Die Pillen ändern ihre Maße an mehreren Stellen, die kein window-resize
  // zuverlässig zum richtigen Zeitpunkt meldet: Breakpoint-Wechsel (kleinere
  // Schrift/Padding auf Mobil), Wechsel Desktop ↔ Bottom-Sheet und das
  // Wegklappen der Radius-Pillen beim Öffnen der Ortssuche. Deshalb werden
  // die Pillen selbst gemessen statt auf das Fenster zu hören.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => reposition(false))
    // Der Indikator selbst wird bewusst nicht beobachtet — sonst löst sein
    // eigenes Neuvermessen die nächste Runde aus.
    container.querySelectorAll(':scope > *:not(.kv-pill-thumb)').forEach(el => ro.observe(el))
    kvThumbObservers.push(ro)
  }

  // Schlusspunkt nach Übergängen: Beim Ein-/Ausklappen der Ortssuche ändert
  // die gewählte Pille nur ihre *Position* (die Nachbarn klappen weg), nicht
  // ihre Größe. Der ResizeObserver verfolgt das zwar während der Animation,
  // meldet die letzte Teilpixel-Änderung aber nicht mehr — der Indikator blieb
  // dadurch ein paar Pixel neben der Pille stehen. transitionend liefert den
  // verlässlichen Endzustand nach.
  container.addEventListener('transitionend', (e) => {
    if (e.target !== thumb) reposition(false)
  })

  return reposition
}

function bindKarteViewEvents() {
  // Init the Google Map (re-uses garage's hub map implementation)
  // Ergebnisliste danach einmal aktualisieren, damit sie bei fehlendem
  // Standort sofort "Standort nicht verfügbar" statt für immer "Suche läuft…" zeigt.
  initHubMap().then(() => {
    /* Nur dort abschalten, wo gar keine Suche laufen kann. Steht Karte und
       Standort, hat initHubMap() gerade selbst eine angestossen — dann bleibt
       der Platzhalter, bis onHubResults() meldet. */
    if (!hasMapsConsent() || getUserCoords().lat == null) searchPending = false
    renderResults()
    /* Ohne Standort ist das Eingabefeld der einzige Weg weiter. Es hinter der
       Lupe eingeklappt zu lassen, versteckt genau dann die Loesung, wenn sie
       gebraucht wird. */
    if (hasMapsConsent() && getUserCoords().lat == null) openSearch()
  })

  let currentRadius = 5000
  /* Ungeschuetzt geparst riss ein einziger kaputter Wert den ganzen
     Karten-Reiter mit: der Aufruf steht im Aufbau des Hubs, eine Ausnahme hier
     beendet ihn, bevor Karte und Liste stehen. Der direkte Nachbar
     readFavMeta() unten macht es fuer denselben Speicherschluessel schon
     richtig. Zusaetzlich auf Array festnageln — gueltiges JSON ist noch keine
     Liste, und weiter unten laufen .includes()/.filter() darauf. */
  let currentFavorites = (() => {
    try {
      const v = JSON.parse(localStorage.getItem('mm_kv_favs') || '[]')
      return Array.isArray(v) ? v : []
    } catch { return [] }
  })()
  // Zustand der Listen-Kopfzeile. Bewusst nur hier gehalten und nicht
  // gespeichert: Sortierung und Oeffnungsfilter beziehen sich auf die gerade
  // laufende Suche, nicht auf den Nutzer.
  let sortMode = 'distance'
  let openOnly = false
  let favOnly = false
  // Solange true, zeigt die Liste Platzhalterzeilen statt "nichts gefunden" —
  // sonst behauptet sie waehrend jeder laufenden Suche, es gaebe keine Treffer.
  let searchPending = true

  const RADIUS_STEPS = [2000, 5000, 10000, 25000, 50000]

  const readFavMeta = () => {
    try { return JSON.parse(localStorage.getItem('mm_kv_favs_meta') || '{}') } catch { return {} }
  }

  /* Gemerkte Orte als Treffer aufbereitet. Sie wurden bisher zwar gespeichert
     (mm_kv_favs + mm_kv_favs_meta), aber nirgends wieder ausgelesen — merken
     war eine Einbahnstrasse. Die Eintraege koennen ausserhalb der aktuellen
     Suche liegen, deshalb Entfernung nur, wenn ein Standort bekannt ist. */
  const favResults = () => {
    const meta = readFavMeta()
    const { lat, lng } = getUserCoords()
    return currentFavorites.map(id => {
      const m = meta[id]
      if (!m) return null
      return {
        placeId: id,
        name: m.name || '—',
        address: m.address || '',
        rating: m.rating || null,
        userRatings: 0,
        isOpen: null,
        lat: m.lat,
        lng: m.lng,
        distanceKm: (lat != null && m.lat != null) ? haversineKm(lat, lng, m.lat, m.lng) : null,
      }
    }).filter(Boolean)
  }

  const syncFavCount = () => {
    const el = document.getElementById('kv-fav-count')
    if (el) el.textContent = currentFavorites.length
  }

  const emptyState = (icon, title, hint, actions = []) => `
    <div class="kv-results-empty">
      <span class="kv-empty-icon">${icon}</span>
      <span class="kv-empty-title">${title}</span>
      ${hint ? `<span class="kv-empty-hint">${hint}</span>` : ''}
      ${actions.length ? `<div class="kv-empty-actions">${actions.map(a =>
        `<button type="button" class="kv-empty-btn${a.primary ? ' kv-empty-btn--primary' : ''}" id="${a.id}">${a.label}</button>`
      ).join('')}</div>` : ''}
    </div>`

  /* Vier Platzhalterzeilen statt eines "Suche laeuft"-Satzes: die Liste behaelt
     ihre Hoehe, statt beim Eintreffen der Treffer aufzuspringen. */
  const skeleton = () => `<div class="kv-skeleton">${
    Array.from({ length: 4 }, (_, i) => `<div class="kv-skeleton-row" style="--i:${i}"><span class="kv-skeleton-line kv-skeleton-line--name"></span><span class="kv-skeleton-line kv-skeleton-line--addr"></span></div>`).join('')
  }</div>`

  const renderEmpty = (list) => {
    // Reihenfolge = Reihenfolge der tatsaechlichen Blockade. Vorher stand hier
    // immer "Standort nicht verfuegbar" — auch dann, wenn in Wahrheit noch die
    // Einwilligung fuer die Karte fehlte und der Standort nie erfragt wurde.
    // Gemerkte Orte zuerst: sie stehen im localStorage und haengen weder an
    // der Karte noch am Standort. "Karte noch nicht geladen" waere hier die
    // falsche Erklaerung fuer eine leere Merkliste.
    if (favOnly) {
      list.innerHTML = emptyState('\u{1F516}', 'Noch nichts gemerkt',
        'Tippe bei einem Treffer auf \u201eMerken\u201c \u2014 gemerkte Orte findest du hier wieder.')
      return
    }
    if (!hasMapsConsent()) {
      // Bewusst kein hervorgehobener Knopf: der Datenschutzhinweis auf der
      // Karte traegt bereits den weissen "Karte laden"-Knopf. Zwei gleich
      // starke Aufforderungen nebeneinander waeren eine zuviel — hier steht
      // nur der zweite Weg dorthin, fuer den Fall, dass das Sheet auf dem
      // Handy die Karte gerade verdeckt.
      list.innerHTML = emptyState('\u{1F5FA}\u{FE0F}', 'Karte noch nicht geladen',
        'Orte in deiner N\u00e4he findest du erst, wenn die Karte geladen ist.',
        [{ id: 'kv-empty-consent', label: 'Karte laden' }])
      return
    }
    const { lat } = getUserCoords()
    if (lat == null) {
      list.innerHTML = emptyState('\u{1F4CD}', 'Kein Standortzugriff',
        'Erlaube den Zugriff im Browser \u2014 oder gib einen Ort ein.',
        [{ id: 'kv-empty-retry', label: 'Erneut versuchen', primary: true },
         { id: 'kv-empty-search', label: 'Ort eingeben' }])
      return
    }
    if (searchPending) { list.innerHTML = skeleton(); return }
    if (openOnly) {
      list.innerHTML = emptyState('\u{1F551}', 'Gerade nichts ge\u00f6ffnet',
        `Im Umkreis von ${currentRadius / 1000}\u00a0km hat aktuell nichts offen.`,
        [{ id: 'kv-empty-openoff', label: 'Auch Geschlossene zeigen' }])
      return
    }
    const next = RADIUS_STEPS.find(r => r > currentRadius)
    list.innerHTML = emptyState('\u{1F50D}', 'Nichts gefunden',
      `Im Umkreis von ${currentRadius / 1000}\u00a0km gibt es hier keine Treffer.`,
      next ? [{ id: 'kv-empty-expand', label: `Auf ${next / 1000}\u00a0km erweitern`, primary: true }] : [])
  }

  const renderResults = () => {
    const list = document.getElementById('kv-results-list')
    if (!list) return
    syncFavCount()

    let results = favOnly ? favResults() : [...getHubSearchResults()]
    if (openOnly) results = results.filter(r => r.isOpen === true)
    results.sort(sortMode === 'rating'
      // Ohne Bewertung nach hinten statt vor alles andere; bei Gleichstand
      // entscheidet die Zahl der Bewertungen, sonst schiebt sich eine einzelne
      // 5-Sterne-Stimme vor eine 4,8 aus 300.
      ? (a, b) => (b.rating || 0) - (a.rating || 0) || (b.userRatings || 0) - (a.userRatings || 0)
      : (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))

    // Ohne Treffer bleibt die Zeile leer statt einen Gedankenstrich zu zeigen:
    // der stand allein links neben den Schaltern und sah aus wie ein Fehler.
    const countEl = document.getElementById('kv-list-count')
    if (countEl) countEl.textContent = results.length ? `${results.length} Treffer` : ''

    if (!results.length) { renderEmpty(list); return }

    list.innerHTML = results.map((r, i) => {
      const distance = r.distanceKm == null ? ''
        : r.distanceKm < 1 ? `${Math.round(r.distanceKm * 1000)} m` : `${r.distanceKm.toFixed(1)} km`
      const rating = r.rating ? `<span class="kv-result-rating">\u2605 ${r.rating.toFixed(1)}${r.userRatings ? `<span class="kv-result-ratings-count">(${r.userRatings})</span>` : ''}</span>` : ''
      const openStatus = r.isOpen === true ? '<span class="kv-result-open">Ge\u00f6ffnet</span>'
        : r.isOpen === false ? '<span class="kv-result-closed">Geschlossen</span>' : ''
      // Bewertung und Status stehen in einer Zeile, getrennt durch einen
      // Mittelpunkt — aber nur, wenn beide Angaben vorhanden sind.
      const meta = [rating, openStatus].filter(Boolean)
        .join('<span class="kv-result-dot">\u00b7</span>')
      const isFav = currentFavorites.includes(r.placeId)
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`
      // --i staffelt den Einlauf; ab Position 12 gedeckelt, sonst tropfen
      // lange Trefferlisten sekundenlang nach.
      return `
        <div class="kv-result-card" data-place-id="${r.placeId}" data-lat="${r.lat}" data-lng="${r.lng}" style="--i:${Math.min(i, 12)}">
          <div class="kv-result-head">
            <span class="kv-result-name">${esc(r.name)}</span>
            ${distance ? `<span class="kv-result-distance">${distance}</span>` : ''}
          </div>
          ${meta ? `<div class="kv-result-meta">${meta}</div>` : ''}
          <div class="kv-result-address">${esc(r.address)}</div>
          <div class="kv-result-actions">
              <a class="kv-action-btn" href="${mapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
                Route
              </a>
              <button class="kv-action-btn kv-fav-btn ${isFav ? 'kv-fav-btn--active' : ''}" data-place-id="${r.placeId}" onclick="event.stopPropagation()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                ${isFav ? 'Gespeichert' : 'Merken'}
              </button>
          </div>
        </div>`
    }).join('')

    // Wire card click → focus on map
    list.querySelectorAll('.kv-result-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.placeId
        // Gemerkte Orte liegen oft ausserhalb der aktuellen Trefferliste — dann
        // gibt es keinen Marker, auf den focusHubResult() zielen koennte.
        if (!focusHubResult(id)) {
          const lat = parseFloat(card.dataset.lat), lng = parseFloat(card.dataset.lng)
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) panHubToCoords(lat, lng)
        }
        // Visually highlight on click
        list.querySelectorAll('.kv-result-card').forEach(c => c.classList.remove('kv-result-card--active'))
        card.classList.add('kv-result-card--active')
      })
    })
    // Favorite toggle
    list.querySelectorAll('.kv-fav-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const id = btn.dataset.placeId
        const idx = currentFavorites.indexOf(id)
        if (idx >= 0) {
          currentFavorites.splice(idx, 1)
          try {
            const meta = JSON.parse(localStorage.getItem('mm_kv_favs_meta') || '{}')
            delete meta[id]
            localStorage.setItem('mm_kv_favs_meta', JSON.stringify(meta))
          } catch {}
        } else {
          currentFavorites.push(id)
          // Persist place metadata so the Orte tab can show name/address/coords
          try {
            const result = getHubSearchResults().find(r => r.placeId === id)
            if (result) {
              const meta = JSON.parse(localStorage.getItem('mm_kv_favs_meta') || '{}')
              meta[id] = { name: result.name, address: result.address, lat: result.lat, lng: result.lng, rating: result.rating, ts: Date.now() }
              localStorage.setItem('mm_kv_favs_meta', JSON.stringify(meta))
            }
          } catch {}
        }
        try { localStorage.setItem('mm_kv_favs', JSON.stringify(currentFavorites)) } catch {}
        syncFavCount()
        // In der Gemerkt-Ansicht muss die Zeile verschwinden, sonst bliebe ein
        // Eintrag stehen, den es nicht mehr gibt.
        if (favOnly) { renderResults(); return }
        // Sonst nur diesen Knopf umschalten statt die Liste neu zu bauen: ein
        // Neuaufbau würde den gestaffelten Einlauf aller Karten erneut
        // auslösen — ein Klick auf "Merken" ließe die ganze Liste flackern.
        const nowFav = currentFavorites.includes(id)
        btn.classList.toggle('kv-fav-btn--active', nowFav)
        btn.querySelector('svg')?.setAttribute('fill', nowFav ? 'currentColor' : 'none')
        btn.lastChild.textContent = nowFav ? ' Gespeichert' : ' Merken'
        btn.classList.remove('kv-fav-btn--pop')
        void btn.offsetWidth // Reflow, damit die Animation auch beim Wiederholen startet
        btn.classList.add('kv-fav-btn--pop')
      })
    })
  }

  /* Aktionen der Leerzustaende. Delegiert, weil die Knoepfe erst mit dem
     jeweiligen Zustand entstehen. */
  document.getElementById('kv-results-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.kv-empty-btn')
    if (!btn) return
    if (btn.id === 'kv-empty-consent') {
      document.getElementById('hub-map-consent-btn')?.click()
      searchPending = true
      renderResults()
    } else if (btn.id === 'kv-empty-retry') {
      searchPending = true
      renderResults()
      retryHubLocation()
    } else if (btn.id === 'kv-empty-search') {
      openSearch()
    } else if (btn.id === 'kv-empty-openoff') {
      openOnly = false
      document.getElementById('kv-open-toggle')?.setAttribute('data-active', 'false')
      renderResults()
    } else if (btn.id === 'kv-empty-expand') {
      const next = RADIUS_STEPS.find(r => r > currentRadius)
      document.querySelector(`.kv-radius-pill[data-radius="${next}"]`)?.click()
    }
  })

  // Subscribe to result updates from the map
  onHubResults(() => { searchPending = false; renderResults() })

  /* Karte verschoben -> "Hier suchen" anbieten. Die Suche laeuft weiter um die
     alte Mitte, bis der Nutzer das ausdruecklich will — ein automatisches
     Nachsuchen bei jeder Geste waere teuer und wuerde die Liste unter dem
     Finger umsortieren. */
  const searchHereBtn = document.getElementById('kv-search-here')
  let movedCenter = null
  onHubMapMoved((center) => {
    movedCenter = center
    if (searchHereBtn) searchHereBtn.hidden = false
  })
  searchHereBtn?.addEventListener('click', () => {
    if (!movedCenter) return
    searchHereBtn.hidden = true
    searchPending = true
    renderResults()
    searchNearbyAt(movedCenter.lat, movedCenter.lng)
  })

  // Sortierung: Entfernung <-> Bewertung
  document.getElementById('kv-sort-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('kv-sort-btn')
    sortMode = sortMode === 'distance' ? 'rating' : 'distance'
    btn.dataset.sort = sortMode
    const label = btn.querySelector('.kv-sort-label')
    if (label) label.textContent = sortMode === 'distance' ? 'Entfernung' : 'Bewertung'
    renderResults()
  })

  // Nur geoeffnete Orte
  document.getElementById('kv-open-toggle')?.addEventListener('click', (e) => {
    openOnly = !openOnly
    e.currentTarget.dataset.active = String(openOnly)
    renderResults()
  })

  /* Gemerkte Orte. Kategorie-, Radius- und Oeffnungsfilter treten dabei
     zurueck: die Merkliste ist eine eigene Sicht, keine Verfeinerung der
     laufenden Suche. */
  document.getElementById('kv-fav-filter')?.addEventListener('click', (e) => {
    favOnly = !favOnly
    e.currentTarget.dataset.active = String(favOnly)
    document.querySelector('.kv-sidebar')?.classList.toggle('kv-sidebar--favs', favOnly)
    renderResults()
  })

  // Gleitende Auswahl-Indikatoren für Kategorie- und Radius-Leiste. Der
  // Karteninhalt wird bei jedem Tab-Wechsel neu gebaut — Beobachter der
  // vorigen, jetzt abgehängten Leisten vorher trennen.
  kvThumbObservers.forEach(ro => ro.disconnect())
  kvThumbObservers = []
  const filterBar = document.querySelector('.konf-karte-hub .hub-filters')
  const radiusBar = document.querySelector('.kv-radius-pills')

  /* Weiche Kante rechts, solange Kategorien ausserhalb liegen. Ueber einen
     ResizeObserver statt einmalig beim Aufbau: das Panel ist am Desktop 360px
     breit und wird auf Handybreite zum Sheet ueber die volle Breite. */
  const syncFilterOverflow = () => {
    if (!filterBar) return
    filterBar.classList.toggle('hub-filters--overflow', filterBar.scrollWidth > filterBar.clientWidth + 1)
  }
  if (filterBar && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(syncFilterOverflow)
    ro.observe(filterBar)
    kvThumbObservers.push(ro)
  }
  syncFilterOverflow()
  const moveFilterThumb = mountKvThumb(filterBar, '.hub-pill.active')
  const moveRadiusThumb = mountKvThumb(radiusBar, '.kv-radius-pill--active', 'kv-pill-thumb--radius')

  // Angeklickte Kategorie in den sichtbaren Bereich holen — bei sieben Pillen
  // liegt die gewählte sonst halb außerhalb des Scrollfensters.
  const revealPill = (pill) => {
    if (!filterBar) return
    const pad = 16
    const left = pill.offsetLeft - pad
    const right = pill.offsetLeft + pill.offsetWidth + pad
    if (left < filterBar.scrollLeft) filterBar.scrollLeft = left
    else if (right > filterBar.scrollLeft + filterBar.clientWidth) {
      filterBar.scrollLeft = right - filterBar.clientWidth
    }
  }

  // Wire filter pills
  document.querySelectorAll('.konf-karte-hub .hub-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.konf-karte-hub .hub-pill').forEach(p => p.classList.remove('active'))
      pill.classList.add('active')
      revealPill(pill)
      moveFilterThumb?.()
      searchPending = true
      renderResults()
      searchNearby(pill.dataset.query, currentRadius)
    })
  })
  // Radius pills
  document.querySelectorAll('.kv-radius-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.kv-radius-pill').forEach(p => p.classList.remove('kv-radius-pill--active'))
      pill.classList.add('kv-radius-pill--active')
      moveRadiusThumb?.()
      currentRadius = parseInt(pill.dataset.radius) || 5000
      const activeFilter = document.querySelector('.konf-karte-hub .hub-pill.active')?.dataset.query
      if (activeFilter) {
        searchPending = true
        renderResults()
        searchNearby(activeFilter, currentRadius)
      }
    })
  })
  // Search toggle — collapsed magnifying glass expands into the PLZ/Ort field
  const searchToggle = document.getElementById('kv-search-toggle')
  const searchField = document.getElementById('kv-search-field')
  const searchWrap = searchToggle?.closest('.kv-search-wrap')
  const searchRow = searchToggle?.closest('.kv-search-row')
  const openSearch = () => {
    searchField?.classList.add('kv-search-field--open')
    searchRow?.classList.add('kv-searching')
    searchToggle?.setAttribute('aria-expanded', 'true')
    setTimeout(() => document.getElementById('kv-search-input')?.focus(), 10)
  }
  const closeSearch = () => {
    searchField?.classList.remove('kv-search-field--open')
    searchRow?.classList.remove('kv-searching')
    searchToggle?.setAttribute('aria-expanded', 'false')
    document.getElementById('mm-recent-dd')?.remove()
  }
  searchToggle?.addEventListener('click', () => {
    searchField?.classList.contains('kv-search-field--open') ? closeSearch() : openSearch()
  })
  document.addEventListener('mousedown', e => {
    if (searchWrap && !searchWrap.contains(e.target)) closeSearch()
  })
  searchField?.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSearch()
  })
  // Recenter — shared by the panel's inline button and the floating map
  // control (Apple-Maps-style), so both trigger the same handler.
  const handleRecenter = () => {
    recenterHubMap()
    const input = document.getElementById('kv-search-input')
    if (input) input.value = ''
  }
  document.getElementById('kv-recenter-btn')?.addEventListener('click', handleRecenter)
  document.getElementById('kv-map-recenter-btn')?.addEventListener('click', handleRecenter)

  // Retry-Button im Fehlerzustand ("Standort nicht verfügbar") — der Button
  // wird per innerHTML injiziert (siehe getUserLocation in garage.js), daher
  // hier per Delegation binden (analog zur Garage-Variante in garage.js).
  document.querySelector('.konf-karte-hub')?.addEventListener('click', (e) => {
    if (e.target.closest('#hub-retry-btn')) retryHubLocation()
  })

  // Mobile bottom sheet: Drag am Handle + Tap-Fallback (Handle/Kopfbereich)
  // zum Auf-/Zuziehen. Nur unterhalb 760px CSS-wirksam (siehe .kv-sidebar
  // im @container-Block in main.css) — auf Desktop-Breite bleibt matches
  // false, die Klassen werden zwar gesetzt, haben dort aber keine Wirkung.
  bindKarteSheet()
  syncKvPeek()
  const peekHost = document.querySelector('.konf-karte-hub .kv-sidebar')
  if (peekHost && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(syncKvPeek)
    ro.observe(peekHost)
    kvThumbObservers.push(ro)
  }

  // Floating zoom controls (right side of the map, Apple-Maps-style)
  document.getElementById('kv-zoom-in-btn')?.addEventListener('click', () => zoomHubMap(1))
  document.getElementById('kv-zoom-out-btn')?.addEventListener('click', () => zoomHubMap(-1))
  // Location search (geocode + recenter) + recent searches
  const searchInput = document.getElementById('kv-search-input')
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      let list = []
      try { list = JSON.parse(localStorage.getItem('mm_recent_kv') || '[]') } catch {}
      if (!list.length) return
      document.getElementById('mm-recent-dd')?.remove()
      const dd = document.createElement('div')
      dd.id = 'mm-recent-dd'
      dd.className = 'mm-recent-dropdown'
      dd.innerHTML = `
        <div class="mm-recent-head">
          <span>Letzte Suchen</span>
          <button class="mm-recent-clear">Löschen</button>
        </div>
        ${list.map(q => `<button class="mm-recent-item" data-q="${esc(q)}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg><span>${esc(q)}</span></button>`).join('')}
      `
      const rect = searchInput.getBoundingClientRect()
      dd.style.top = (rect.bottom + 6) + 'px'
      dd.style.left = rect.left + 'px'
      dd.style.width = rect.width + 'px'
      document.body.appendChild(dd)
      dd.querySelectorAll('.mm-recent-item').forEach(btn => {
        btn.addEventListener('mousedown', ev => {
          ev.preventDefault()
          searchInput.value = btn.dataset.q
          searchInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }))
          dd.remove()
        })
      })
      dd.querySelector('.mm-recent-clear')?.addEventListener('mousedown', ev => {
        ev.preventDefault()
        try { localStorage.removeItem('mm_recent_kv') } catch {}
        dd.remove()
      })
      setTimeout(() => {
        const h = (ev) => {
          if (!dd.contains(ev.target) && ev.target !== searchInput) {
            dd.remove(); document.removeEventListener('mousedown', h)
          }
        }
        document.addEventListener('mousedown', h)
      }, 0)
    })
  }
  searchInput?.addEventListener('keypress', async (e) => {
    if (e.key !== 'Enter' || !searchInput.value.trim()) return
    const query = searchInput.value.trim()
    // Save recent
    try {
      let recent = JSON.parse(localStorage.getItem('mm_recent_kv') || '[]').filter(q => q !== query)
      recent.unshift(query)
      localStorage.setItem('mm_recent_kv', JSON.stringify(recent.slice(0, 5)))
    } catch {}
    document.getElementById('mm-recent-dd')?.remove()
    if (typeof google === 'undefined' || !google.maps?.Geocoder) return
    const geocoder = new google.maps.Geocoder()
    geocoder.geocode({ address: query + ', Deutschland' }, (results, status) => {
      if (status !== 'OK' || !results[0]) {
        const input = document.getElementById('kv-search-input')
        if (input) input.placeholder = 'Ort nicht gefunden'
        return
      }
      const loc = results[0].geometry.location
      searchNearbyAt(loc.lat(), loc.lng())
    })
  })
}

function bindMatchViewEvents(data) {
  const bike = catalogBikeFor(data)

  // "Händler finden" führte bisher in einen alert(). Der Karten-Reiter IST
  // die Händlersuche — also dorthin wechseln und gleich die richtige Kachel
  // auslösen, statt auf ein späteres Feature zu vertrösten.
  document.getElementById('konf-cta-dealer')?.addEventListener('click', () => {
    switchTab('karte', data)
    setTimeout(() => {
      document.querySelector('.konf-karte-hub .hub-pill[data-query="Motorradhändler"]')?.click()
    }, 320)
  })

  document.getElementById('konf-cta-quiz')?.addEventListener('click', startQuizFromKonfigurator)
  document.getElementById('mm-match-quiz')?.addEventListener('click', startQuizFromKonfigurator)

  // Merken/Vergessen des offenen Bikes
  document.getElementById('mm-match-save')?.addEventListener('click', (e) => {
    if (!bike) return
    const btn = e.currentTarget
    if (btn.dataset.saved === 'true') {
      removeMatch(bike.name)
      showToast('Aus deinen Matches entfernt.')
    } else {
      const answers = getLastAnswers()
      const res = answers ? scoreBikeAgainst(bike, answers) : null
      addMatch(bike, { score: res?.score, pct: res?.pct, source: 'manual' })
      showToast('Als Match gemerkt.')
    }
    refreshSaveBtn(bike)
    refreshMatchList(bike)
  })

  // Sortierung
  document.getElementById('mm-match-sort')?.addEventListener('click', (e) => {
    matchSort = matchSort === 'recent' ? 'score' : 'recent'
    e.currentTarget.textContent = matchSort === 'score' ? 'Nach Score' : 'Neueste'
    refreshMatchList(bike)
  })

  // "Alle löschen" — zweistufig statt Bestätigungsdialog: der Schalter fragt
  // sich selbst nach, und die Rückfrage verfällt von allein.
  const clearBtn = document.getElementById('mm-match-clear')
  clearBtn?.addEventListener('click', (e) => {
    const btn = e.currentTarget
    if (btn.dataset.armed !== 'true') {
      btn.dataset.armed = 'true'
      btn.textContent = 'Wirklich alle?'
      btn.classList.add('mm-match-chip--armed')
      clearTimeout(btn._t)
      btn._t = setTimeout(() => {
        btn.dataset.armed = 'false'
        btn.textContent = 'Alle löschen'
        btn.classList.remove('mm-match-chip--armed')
      }, 4000)
      return
    }
    clearTimeout(btn._t)
    btn.dataset.armed = 'false'
    btn.textContent = 'Alle löschen'
    btn.classList.remove('mm-match-chip--armed')
    clearMatches()
    clearMatchUndo()
    refreshSaveBtn(bike)
    refreshMatchList(bike)
    showToast('Alle Matches gelöscht.')
  })

  // Zeilen-Aktionen laufen über Delegation an den Karten, damit ein Neu-
  // rendern der Liste die Handler nicht mitreißt.
  document.getElementById('mm-match-saved')?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-match]')
    if (open) { openMatchBike(open.dataset.openMatch); return }

    const del = e.target.closest('[data-del-match]')
    if (del) { deleteMatchWithUndo(del.dataset.delMatch, bike); return }

    const star = e.target.closest('[data-star-match]')
    if (star) {
      const name = star.dataset.starMatch
      const isPrimary = getPrimaryBike() === name
      setPrimaryBike(isPrimary ? null : name)
      showToast(isPrimary ? 'Hauptbike zurückgenommen.' : `${name} ist jetzt dein Hauptbike.`)
      refreshMatchList(bike)
    }
  })

  document.getElementById('mm-match-reco')?.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-match]')
    if (add) {
      const recBike = findBikeByShortName(add.dataset.addMatch)
      if (!recBike) return
      const answers = getLastAnswers()
      const res = answers ? scoreBikeAgainst(recBike, answers) : null
      addMatch(recBike, { score: res?.score, pct: res?.pct, source: 'manual' })
      showToast(`${recBike.name} gemerkt.`)
      rerenderMatchTab(data)
      return
    }
    const open = e.target.closest('[data-open-match]')
    if (open) openMatchBike(open.dataset.openMatch)
  })

  animateMatchScore()
}

/** Ring + Balken der Score-Karte einlaufen lassen. */
function animateMatchScore() {
  const card = document.getElementById('mm-match-score')
  if (!card) return
  const ring = card.querySelector('.mm-match-ring-fill')
  const groups = card.querySelectorAll('.konf-bar-group')

  requestAnimationFrame(() => {
    if (ring) {
      const pct = Number(ring.dataset.pct) || 0
      ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - pct / 100))
    }
    card.querySelectorAll('.mm-match-ring-num .konf-bar-counter').forEach(animateBarNumber)
    groups.forEach((group, i) => {
      setTimeout(() => {
        const fill = group.querySelector('.konf-bar-fill')
        if (fill) fill.style.width = fill.dataset.pct + '%'
        group.querySelectorAll('.konf-bar-counter').forEach(animateBarNumber)
      }, i * 110)
    })
  })
}

/** Nur die Liste neu zeichnen — die Karte selbst trägt die Delegation. */
function refreshMatchList(currentBike) {
  const list = document.getElementById('mm-match-list')
  if (!list) return
  const entries = sortedMatches()
  list.innerHTML = buildMatchRows(entries, currentBike)
  const count = document.getElementById('mm-match-count')
  if (count) count.textContent = String(entries.length)
  const clearBtn = document.getElementById('mm-match-clear')
  if (clearBtn) clearBtn.hidden = entries.length === 0
}

function refreshSaveBtn(bike) {
  const btn = document.getElementById('mm-match-save')
  if (!btn || !bike) return
  const saved = hasMatch(bike.name)
  btn.dataset.saved = String(saved)
  btn.classList.toggle('mm-match-btn--on', saved)
  btn.querySelector('.mm-match-btn-icon').innerHTML = saved ? MM_ICON_CHECK : MM_ICON_PLUS
  btn.querySelector('.mm-match-btn-label').innerHTML = matchSaveLabel(saved)
}

/** Kompletter Neuaufbau — nötig, wenn sich auch die Empfehlungsliste ändert. */
function rerenderMatchTab(data) {
  const container = document.getElementById('konf-right')
  if (!container) return
  container.innerHTML = buildMatchView(data)
  container.querySelectorAll('.konf-reveal').forEach(el => el.classList.add('konf-visible'))
  bindMatchViewEvents(data)
}

/**
 * Löschen mit Rückgängig-Streifen: ein Fehlgriff in einer Liste, die man
 * nicht wiederherstellen kann, wäre sonst endgültig.
 */
function deleteMatchWithUndo(name, currentBike) {
  const list = getMatches()
  const index = list.findIndex(m => m.name === name)
  if (index === -1) return
  const entry = list[index]
  removeMatch(name)
  refreshSaveBtn(currentBike)
  refreshMatchList(currentBike)

  const bar = document.getElementById('mm-match-undo')
  if (!bar) return
  clearTimeout(matchUndo?.timer)
  matchUndo = { entry, index, timer: setTimeout(clearMatchUndo, 7000) }
  bar.innerHTML = `
    <span class="mm-match-undo-text">„${esc(name)}“ entfernt</span>
    <button type="button" class="mm-match-undo-btn" id="mm-match-undo-btn">Rückgängig</button>`
  bar.hidden = false
  document.getElementById('mm-match-undo-btn')?.addEventListener('click', () => {
    if (!matchUndo) return
    restoreMatch(matchUndo.entry, matchUndo.index)
    clearMatchUndo()
    refreshSaveBtn(currentBike)
    refreshMatchList(currentBike)
  })
}

function clearMatchUndo() {
  clearTimeout(matchUndo?.timer)
  matchUndo = null
  const bar = document.getElementById('mm-match-undo')
  if (bar) { bar.hidden = true; bar.innerHTML = '' }
}

/**
 * Ein gespeichertes Match öffnen. Weg über die Garage-Seite — derselbe
 * Pfad, den auch der Zurück-Weg aus dem Konfigurator nimmt, inklusive
 * sauberem Abbau des laufenden 3D-Viewers.
 */
function openMatchBike(name) {
  const bike = findBikeByShortName(name)
  if (!bike) { showToast('Dieses Bike ist nicht mehr im Katalog.'); return }

  cleanup3D()
  cleanupKonfigurator()
  const detail = document.getElementById('bike-detail')
  detail.style.transition = 'opacity 0.22s ease'
  detail.style.opacity = '0'
  setTimeout(() => {
    detail.style.display = 'none'
    detail.innerHTML = ''
    detail.classList.remove('bd-konfigurator-active', 'bd-konfigurator-visible')
    detail.style.opacity = ''
    detail.style.transition = ''
    import('./garage.js').then(m => m.openBikeGarage(bike.name))
  }, 220)
}

/** Konfigurator verlassen und das Quiz starten. */
function startQuizFromKonfigurator() {
  cleanup3D()
  cleanupKonfigurator()
  const detail = document.getElementById('bike-detail')
  detail.style.transition = 'opacity 0.22s ease'
  detail.style.opacity = '0'
  setTimeout(() => {
    detail.style.display = 'none'
    detail.innerHTML = ''
    detail.classList.remove('bd-konfigurator-active', 'bd-konfigurator-visible')
    detail.style.opacity = ''
    detail.style.transition = ''
    document.documentElement.classList.remove('has-landing')
    document.getElementById('quiz-screen').style.display = 'flex'
    import('./quiz.js').then(m => m.initQuiz())
  }, 220)
}
function buildKonfiguratorHTML(data, initialTab = KONF_DEFAULT_TAB) {
  const userHeight = getUserHeight()
  konfData = data
  const tab = tabViewBuilders[initialTab] ? initialTab : KONF_DEFAULT_TAB
  const fullscreen = tab === 'ausstattung' || tab === 'community' || tab === 'karte'

  return `
    <!-- Touchbar Navigation -->
    <div class="tb-wrap scrolled konf-tb-wrap${tab === 'community' ? ' konf-tb-wrap--community' : ''}" id="konf-taskbar">
      <nav class="tb-bar">
        <button class="tb-btn" type="button" id="konf-profil-btn">Profil</button>
        <button class="tb-btn${tab === 'ausstattung' ? ' tb-btn-active' : ''}" data-tab="ausstattung">Ausr\u00fcstung</button>
        <button class="tb-btn${tab === 'match' ? ' tb-btn-active' : ''}" data-tab="match"><span class="tb-lbl-lang">Match finden</span><span class="tb-lbl-kurz">Match</span></button>
        <button class="tb-btn${tab === 'community' ? ' tb-btn-active' : ''}" data-tab="community">Community</button>
        <button class="tb-btn${tab === 'karte' ? ' tb-btn-active' : ''}" data-tab="karte">Karte</button>
      </nav>
    </div>
    <button class="konf-back-float" id="konf-back" type="button" aria-label="Zur\u00fcck">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    </button>

    <!-- Split Screen -->
    <div class="konf-split${fullscreen ? ' konf-split--fullscreen' : ''}${tab === 'ausstattung' ? ' konf-split--ausstattung' : ''}${tab === 'community' ? ' konf-split--community' : ''}${tab === 'karte' ? ' konf-split--karte' : ''}">

      <!-- Left: Cinematic 2D Viewer -->
      <div class="konf-left">
        <div class="konf-bg-text" aria-hidden="true">${data.bgText || data.fullName}</div>
        <div class="konf-viewer" id="konf-viewer">
          <img class="konf-viewer-img konf-viewer-img--active" id="konf-img-bike" src="${data.img1}" alt="${data.fullName}">
          <img class="konf-viewer-img" id="konf-img-rider" src="${data.img2}" alt="${data.fullName} mit Fahrer">
        </div>
        <div class="konf-viewer-label" id="konf-height-label" style="display:none">
          Fahrgr\u00f6\u00dfe: ${userHeight} cm
        </div>
        <div class="konf-pills" id="konf-pills">
          <button class="konf-pill konf-pill--active" data-view="bike">Motorrad</button>
          <button class="konf-pill" data-view="rider">Mit Fahrer</button>
        </div>
      </div>

      <!-- Right: Tab Content (swapped per tab) -->
      <div class="konf-right" id="konf-right">
        ${tabViewBuilders[tab](data)}
      </div>
    </div>
  `
}


/* ═══════════════════════════════════════════════════
   2D VIEWER — Pill Navigation + Image Fade
   ═══════════════════════════════════════════════════ */

function getUserHeight() {
  try {
    const stored = localStorage.getItem('motoMatchAnswers')
    if (stored) {
      const answers = JSON.parse(stored)
      const q6 = Number(answers.q6)
      if (q6) return String(Math.round(q6))
    }
  } catch (e) { /* ignore */ }
  return '175'
}

function initViewerPills(data) {
  const pills = document.querySelectorAll('.konf-pill')
  const imgBike = document.getElementById('konf-img-bike')
  const imgRider = document.getElementById('konf-img-rider')
  const heightLabel = document.getElementById('konf-height-label')

  if (!pills.length) return

  const images = { bike: imgBike, rider: imgRider }

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      const view = pill.dataset.view
      pills.forEach(p => p.classList.remove('konf-pill--active'))
      pill.classList.add('konf-pill--active')

      // Fade transition
      Object.values(images).forEach(img => {
        if (img) img.classList.remove('konf-viewer-img--active')
      })
      const target = images[view]
      if (target) {
        requestAnimationFrame(() => target.classList.add('konf-viewer-img--active'))
      }

      // Show height label for rider view
      if (heightLabel) {
        heightLabel.style.display = (view === 'rider') ? 'block' : 'none'
      }
    })
  })
}

// Muss zur CSS-Transition von .konf-bar-fill passen (main.css: width 0.8s cubic-bezier(0.16,1,0.3,1))
const KONF_BAR_FILL_MS = 800
function konfBarEase(t) { return 1 - Math.pow(1 - t, 4) } // ~ cubic-bezier(0.16,1,0.3,1)

function animateBarNumber(el) {
  const target = parseFloat(el.dataset.target)
  const decimals = parseInt(el.dataset.decimals) || 0
  if (Number.isNaN(target)) return
  const t0 = performance.now()
  function tick(now) {
    const progress = Math.min((now - t0) / KONF_BAR_FILL_MS, 1)
    const current = konfBarEase(progress) * target
    el.textContent = decimals > 0 ? current.toFixed(decimals) : Math.round(current)
    if (progress < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function animateBarsOnReveal() {
  const barsCard = document.getElementById('konf-bars-card')
  if (!barsCard) return

  const scrollRoot = document.querySelector('.konf-right')
  const barObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const groups = barsCard.querySelectorAll('.konf-bar-group')
        groups.forEach((group, i) => {
          const fill = group.querySelector('.konf-bar-fill')
          const counters = group.querySelectorAll('.konf-bar-counter')
          setTimeout(() => {
            if (fill) fill.style.width = fill.dataset.pct + '%'
            counters.forEach(animateBarNumber)
          }, i * 120)
        })
        barObserver.unobserve(entry.target)
      }
    })
  }, { root: scrollRoot, threshold: 0.2 })

  barObserver.observe(barsCard)
}

// initTabObserver removed — no longer needed with dedicated tab views

function bindKonfiguratorEvents(data, garageBikeData) {
  const detail = document.getElementById('bike-detail')

  // Back button
  document.getElementById('konf-back')?.addEventListener('click', () => {
    if (!goBack()) konfiguratorBack(data, garageBikeData)
  })

  // Profil-Reiter → Konto-Overlay (kein eigener Tab-View, daher kein switchTab)
  document.getElementById('konf-profil-btn')?.addEventListener('click', async () => {
    const { openAccount } = await import('./account.js')
    openAccount(document.querySelector('.konf-tb-wrap .tb-bar'))
  })

  // Taskbar tabs → switch dedicated views
  document.querySelectorAll('.konf-tb-wrap .tb-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      if (tab !== activeKonfTab) switchTab(tab, data)
    })
  })

  // Bind initial next-step CTA in Ansicht view
  document.querySelector('.konf-next-btn')?.addEventListener('click', (e) => {
    const next = e.currentTarget.dataset.next
    if (next) switchTab(next, data)
  })
}

function returnToGarage(bikeData) {
  cleanup3D()
  cleanupKonfigurator()
  const detail = document.getElementById('bike-detail')

  detail.style.transition = 'opacity 0.22s ease'
  detail.style.opacity = '0'
  setTimeout(() => {
    detail.style.display = 'none'
    detail.innerHTML = ''
    detail.classList.remove('bd-konfigurator-active', 'bd-konfigurator-visible')
    // Inline-Styles zurücksetzen — sonst überstrahlt das alte opacity:0
    // beim nächsten Öffnen des Konfigurators die CSS-Klasse (schwarzer Bildschirm)
    detail.style.opacity = ''
    detail.style.transition = ''
    // Re-open garage
    import('./garage.js').then(m => m.openBikeGarage(bikeData.name.replace(/^(Honda|Yamaha|Harley-Davidson|Suzuki|Kawasaki|BMW|Ducati|KTM|Triumph)\s+/i, '')))
  }, 220)
}

function transitionToDeckblatt(data) {
  if (currentView === 'deckblatt') return
  currentView = 'deckblatt'

  const detail = document.getElementById('bike-detail')
  const landing = document.getElementById('landing')

  detail.classList.add('bd-transitioning')

  setTimeout(() => {
    // Save canvas
    const canvas = detailRenderer?.domElement
    cleanup3D()
    cleanupKonfigurator()

    detail.classList.remove('bd-konfigurator-active', 'bd-konfigurator-visible', 'bd-transitioning')
    detail.innerHTML = buildDeckblattHTML(data)

    // Re-init 3D
    requestAnimationFrame(() => {
      initDetailAnimations(detail)
      initDetail3D(data)
      bindDeckblattEvents(data, detail, landing)
    })

    // Abgleich statt Neuanlage: kam der Konfigurator vom Deckblatt, liegt
    // dessen Ebene bereits auf dem Stack und enterScreen dedupliziert.
    enterScreen('bd-deckblatt', closeDetailToLanding, isDeckblattActive,
                { screen: 'deckblatt', bike: data.fullName })

    window.scrollTo(0, 0)
  }, 220)
}

/* ═══════════════════════════════════════════════════
   KONFIGURATOR — Scroll Reveal Animations
   ═══════════════════════════════════════════════════ */

function initKonfiguratorAnimations() {
  cleanupKonfigurator()

  const reveals = document.querySelectorAll('.konf-reveal')
  if (reveals.length) {
    const scrollRoot = document.querySelector('.konf-right')
    konfObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('konf-visible')
          konfObserver.unobserve(entry.target)
        }
      })
    }, { root: scrollRoot, threshold: 0.15, rootMargin: '0px 0px -40px 0px' })
    reveals.forEach(el => konfObserver.observe(el))
  }

  // Gear filters (category + price range + budget calc)
  function applyGearFilters() {
    const activeBtn = document.querySelector('.gear-filter-btn--active')
    const catFilter = activeBtn ? activeBtn.dataset.filter : 'all'
    const minInput = document.getElementById('gear-price-min')
    const maxInput = document.getElementById('gear-price-max')
    const minPrice = minInput ? (parseInt(minInput.value) || 0) : 0
    const maxPrice = maxInput ? (parseInt(maxInput.value) || 9999) : 9999
    const favToggle = document.getElementById('gear-fav-toggle')
    const favOnly = favToggle?.dataset.active === 'true'
    const dealOnly = document.getElementById('gear-deal-toggle')?.dataset.active === 'true'
    const items = document.querySelectorAll('.gear-card')
    let visible = 0, budgetMin = 0, budgetMax = 0
    items.forEach(item => {
      const catMatch = catFilter === 'all' || item.dataset.gear === catFilter
      const itemMin = parseInt(item.dataset.priceMin) || 0
      const itemMax = parseInt(item.dataset.priceMax) || 9999
      const priceMatch = itemMin <= maxPrice && itemMax >= minPrice
      const favMatch = !favOnly || item.querySelector('.gear-card-heart--active')
      const dealMatch = !dealOnly || item.dataset.deal === '1'
      const searchMatch = item.dataset.searchHidden !== '1'
      const show = catMatch && priceMatch && favMatch && dealMatch && searchMatch
      if (show) {
        if (item.style.display === 'none') {
          item.style.display = ''
          item.classList.remove('gear-card--anim')
          void item.offsetWidth
          item.classList.add('gear-card--anim')
        }
        budgetMin += itemMin
        budgetMax += itemMax
        visible++
      } else {
        item.style.display = 'none'
        item.classList.remove('gear-card--anim')
      }
    })
    const badge = document.getElementById('gear-count-badge') || document.querySelector('.gear-count-badge')
    if (badge) badge.textContent = `${visible} Artikel`
    // Budget bar
    const budgetRange = document.getElementById('gear-budget-range')
    if (budgetRange) {
      budgetRange.innerHTML = visible > 0
        ? `<span>${budgetMin.toLocaleString('de-DE')}</span> – <span>${budgetMax.toLocaleString('de-DE')} €</span>`
        : '—'
    }
    // Empty state
    const emptyState = document.getElementById('gear-empty')
    const grid = document.getElementById('gear-list')
    if (emptyState) emptyState.style.display = visible === 0 ? 'flex' : 'none'
    if (grid) grid.style.display = visible === 0 ? 'none' : ''
  }

  // Sort gear cards by price
  function sortGearCards(dir) {
    const grid = document.getElementById('gear-list')
    if (!grid) return
    const cards = Array.from(grid.querySelectorAll('.gear-card'))
    cards.sort((a, b) => {
      const ap = parseInt(a.dataset.priceMin) || 0
      const bp = parseInt(b.dataset.priceMin) || 0
      return dir === 'asc' ? ap - bp : bp - ap
    })
    cards.forEach(c => grid.appendChild(c))
  }

  document.querySelectorAll('.gear-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gear-filter-btn').forEach(b => b.classList.remove('gear-filter-btn--active'))
      btn.classList.add('gear-filter-btn--active')
      applyGearFilters()
      // Update menu button indicator (red dot if non-"all" filter active)
      const menuBtn = document.getElementById('cc-menu-btn')
      if (menuBtn) menuBtn.classList.toggle('cc-menu-btn--filtered', btn.dataset.filter !== 'all')
    })
  })

  const onPriceInput = () => { applyGearFilters(); syncToolsDot() }
  document.getElementById('gear-price-min')?.addEventListener('input', onPriceInput)
  document.getElementById('gear-price-max')?.addEventListener('input', onPriceInput)

  // Sort button
  document.getElementById('gear-sort-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('gear-sort-btn')
    const label = btn.querySelector('.gear-sort-label')
    const cur = btn.dataset.dir
    const next = cur === 'asc' ? 'desc' : 'asc'
    btn.dataset.dir = next
    label.textContent = next === 'asc' ? 'Preis ↑' : 'Preis ↓'
    sortGearCards(next)
    applyGearFilters()
    syncToolsDot()
  })

  // Ansichtsumschalter und Leistenmessung aufsetzen (delegiert, s. initGearView)
  initGearView()

  // Helper: update favorites counter on the toggle button
  function updateFavCount() {
    const count = document.querySelectorAll('.gear-card-heart--active').length
    const countEl = document.getElementById('gear-fav-toggle-count')
    if (countEl) countEl.textContent = count
    const favBadge = document.getElementById('gear-fav-count')
    if (favBadge) {
      favBadge.textContent = `${count} ♥`
      favBadge.style.display = count > 0 ? '' : 'none'
    }
    // If favOnly is on but no favorites left, turn it off
    const toggle = document.getElementById('gear-fav-toggle')
    if (toggle && toggle.dataset.active === 'true' && count === 0) {
      toggle.dataset.active = 'false'
    }
  }

  // Restore gear favorites from localStorage
  try {
    const savedGearFavs = JSON.parse(localStorage.getItem('mm_gear_favs') || '[]')
    document.querySelectorAll('.gear-card').forEach(card => {
      const id = card.dataset.cardId
      if (id && savedGearFavs.includes(id)) {
        card.querySelector('.gear-card-heart')?.classList.add('gear-card-heart--active')
      }
    })
    updateFavCount?.()
  } catch {}

  // Favorites (heart button on card) — persist to localStorage
  document.querySelectorAll('.gear-card-heart').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      btn.classList.toggle('gear-card-heart--active')
      // Persist
      try {
        const card = btn.closest('.gear-card')
        const id = card?.dataset.cardId
        if (id) {
          let favs = JSON.parse(localStorage.getItem('mm_gear_favs') || '[]')
          if (btn.classList.contains('gear-card-heart--active')) {
            if (!favs.includes(id)) favs.push(id)
          } else {
            favs = favs.filter(f => f !== id)
          }
          // Also store metadata for the account page (name, price, category)
          const metaKey = 'mm_gear_favs_meta'
          let meta = {}
          try { meta = JSON.parse(localStorage.getItem(metaKey) || '{}') } catch {}
          if (btn.classList.contains('gear-card-heart--active')) {
            meta[id] = {
              gear: card?.dataset.gear || '',
              brand: card?.querySelector('.gear-card-brand')?.textContent || '',
              name: card?.querySelector('.gear-card-name')?.textContent || '',
              price: card?.querySelector('.gear-card-price')?.textContent || '',
              type: card?.querySelector('.gear-card-type')?.textContent || '',
              ts: Date.now(),
            }
          } else {
            delete meta[id]
          }
          localStorage.setItem('mm_gear_favs', JSON.stringify(favs))
          localStorage.setItem(metaKey, JSON.stringify(meta))
        }
      } catch {}
      updateFavCount()
      // Re-apply filter if showing only favorites
      const toggle = document.getElementById('gear-fav-toggle')
      if (toggle?.dataset.active === 'true') applyGearFilters()
    })
  })

  // Favorites toggle (middle of price-top row) — show only favorites
  document.getElementById('gear-fav-toggle')?.addEventListener('click', () => {
    const toggle = document.getElementById('gear-fav-toggle')
    toggle.dataset.active = toggle.dataset.active === 'true' ? 'false' : 'true'
    applyGearFilters()
  })

  /* Markiert das guenstigste Viertel des Sortiments.
   *
   * Hier stand zuvor zusaetzlich ein "Sales"-Filter, der per Math.random()
   * jeder fuenften Karte bei jedem Neuaufbau ein frisch gewuerfeltes "-20%"
   * anheftete. Die Karten verlinken per rel="sponsored" auf echte Shops —
   * ein erfundener Rabatt daneben ist irrefuehrende Werbung (UWG/PAngV) und
   * liesse sich ohne ein Feld fuer den Listenpreis auch nicht ehrlich
   * berechnen: priceMin/priceMax sind selbst geschaetzte Spannen, keine
   * Referenzpreise. Kommt zurueck, sobald die Daten einen Streichpreis
   * fuehren.
   */
  function tagPriceTips() {
    const cards = Array.from(document.querySelectorAll('.gear-card'))
    if (!cards.length) return
    const sorted = [...cards].sort((a, b) =>
      (parseInt(a.dataset.priceMin) || 0) - (parseInt(b.dataset.priceMin) || 0))
    const dealCount = Math.max(1, Math.round(sorted.length * 0.25))
    sorted.slice(0, dealCount).forEach(c => c.dataset.deal = '1')
  }

  /* Filterblatt.
   *
   * Der Punkt am Knopf zeigt, dass hinter dem geschlossenen Blatt noch etwas
   * filtert — ohne ihn waere eine gesetzte Preisspanne unsichtbar und die
   * halbleere Liste unerklaerlich. */
  const toolsBtn = document.getElementById('gear-tools-btn')
  const toolsSheet = document.getElementById('gear-tools-sheet')

  function syncToolsDot() {
    const dot = document.getElementById('gear-tools-dot')
    if (!dot) return
    const min = parseInt(document.getElementById('gear-price-min')?.value) || 0
    const max = parseInt(document.getElementById('gear-price-max')?.value) || 1000
    const active = min !== 0 || max !== 1000
      || document.getElementById('gear-deal-toggle')?.dataset.active === 'true'
      || document.getElementById('gear-sort-btn')?.dataset.dir !== 'none'
    dot.hidden = !active
  }

  function setToolsOpen(open) {
    if (!toolsBtn || !toolsSheet) return
    toolsSheet.hidden = !open
    toolsBtn.setAttribute('aria-expanded', String(open))
    toolsBtn.classList.toggle('gear-tools-btn--open', open)
  }

  if (toolsBtn && toolsSheet && !toolsBtn.dataset.bound) {
    toolsBtn.dataset.bound = '1'
    toolsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      setToolsOpen(toolsSheet.hidden)
    })
    toolsSheet.addEventListener('click', e => e.stopPropagation())
    document.addEventListener('click', () => setToolsOpen(false))
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setToolsOpen(false) })
    // Beim Scrollen faehrt die Leiste weg; ein Blatt, das dann in der Luft
    // haengen bliebe, waere von seinem Knopf abgeloest.
    document.querySelector('.konf-right')?.addEventListener('scroll', () => {
      if (!toolsSheet.hidden) setToolsOpen(false)
    }, { passive: true })
  }

  document.getElementById('gear-tools-reset')?.addEventListener('click', () => {
    const min = document.getElementById('gear-price-min')
    const max = document.getElementById('gear-price-max')
    if (min) min.value = '0'
    if (max) max.value = '1000'
    const deal = document.getElementById('gear-deal-toggle')
    if (deal) deal.dataset.active = 'false'
    const sort = document.getElementById('gear-sort-btn')
    if (sort) {
      sort.dataset.dir = 'none'
      const lbl = sort.querySelector('.gear-sort-label')
      if (lbl) lbl.textContent = 'Preis \u2191'
    }
    applyGearFilters()
    syncToolsDot()
  })

  function bindGearToggle(id) {
    const btn = document.getElementById(id)
    if (!btn) return
    btn.addEventListener('click', () => {
      btn.dataset.active = btn.dataset.active === 'true' ? 'false' : 'true'
      applyGearFilters()
      syncToolsDot()
    })
  }
  bindGearToggle('gear-deal-toggle')

  // Initial budget calculation (on first load of Ausrüstung tab)
  if (document.getElementById('gear-fav-toggle')) {
    tagPriceTips()
    applyGearFilters()
  }

  // ── Community: Like buttons ──
  document.querySelectorAll('.cc-like').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      const id = btn.dataset.cardId
      const baseLikes = parseInt(btn.dataset.baseLikes) || 0
      const state = getCardState(id)
      const newLiked = !state.liked
      setCardState(id, { liked: newLiked })
      btn.classList.toggle('cc-like--active', newLiked)
      const svg = btn.querySelector('svg')
      if (svg) svg.setAttribute('fill', newLiked ? 'currentColor' : 'none')
      const countEl = btn.querySelector('.cc-like-count')
      if (countEl) {
        const total = baseLikes + (newLiked ? 1 : 0) + (state.likes || 0)
        countEl.textContent = total.toLocaleString('de-DE')
      }
    })
  })

  // ── Community: Subscribe buttons ──
  document.querySelectorAll('.cc-subscribe').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      const id = btn.dataset.cardId
      const state = getCardState(id)
      const subscribed = !state.subscribed
      setCardState(id, { subscribed })
      btn.dataset.subscribed = subscribed ? 'true' : 'false'
      btn.textContent = subscribed ? '✓ Abonniert' : '+ Abonnieren'
    })
  })

  // ── Community: FAB → open modal ──
  const fab = document.getElementById('cc-fab')
  const modal = document.getElementById('cc-modal')
  const modalBackdrop = document.getElementById('cc-modal-backdrop')
  const modalClose = document.getElementById('cc-modal-close')
  const modalCancel = document.getElementById('cc-modal-cancel')
  const modalForm = document.getElementById('cc-modal-form')

  function openCcModal() {
    if (!modal) return
    modal.style.display = 'flex'
    requestAnimationFrame(() => modal.classList.add('cc-modal--open'))
    // Preselect category from active filter
    const activeBtn = document.querySelector('.gear-filter-btn--active')
    const catSelect = document.getElementById('cc-form-category')
    if (catSelect && activeBtn && activeBtn.dataset.filter !== 'all') {
      catSelect.value = activeBtn.dataset.filter
    }
  }
  function closeCcModal() {
    if (!modal) return
    modal.classList.remove('cc-modal--open')
    setTimeout(() => { modal.style.display = 'none' }, 200)
  }

  fab?.addEventListener('click', openCcModal)
  // Topbar "Erstellen" button also opens the same modal
  document.getElementById('cc-create-btn')?.addEventListener('click', openCcModal)
  // Topbar profile avatar → open full account page
  document.getElementById('cc-profile-btn')?.addEventListener('click', () => {
    openAccount(document.querySelector('.konf-tb-wrap .tb-bar'))
  })

  // Listen for account updates to refresh profile button (registered once)
  if (!_accountUpdatedListenerRegistered) {
    _accountUpdatedListenerRegistered = true
    window.addEventListener('mm:account-updated', () => {
      const btn = document.getElementById('cc-profile-btn')
      if (btn) btn.textContent = rawUserInitials()
    })
  }

  // Topbar notifications → dropdown
  const ccNotifBtn = document.getElementById('cc-notif-btn')
  ccNotifBtn?.addEventListener('click', e => {
    e.stopPropagation()
    let dropdown = document.getElementById('cc-notif-dropdown')
    if (dropdown) { dropdown.remove(); return }
    const mockNotifs = [
      { icon: '❤', title: 'Markus Berger hat deinen Beitrag geliked', time: 'vor 5 Min', unread: true },
      { icon: '💬', title: 'Lisa K. hat auf dein Video kommentiert', time: 'vor 20 Min', unread: true },
      { icon: '📅', title: 'Event "Saisonstart 2026" startet in 3 Tagen', time: 'vor 1 Std', unread: true },
      { icon: '🏍', title: 'Neue Touren in deiner Region', time: 'vor 3 Std', unread: false },
      { icon: '🎒', title: 'Reduzierte Helme bei Louis — bis -30%', time: 'vor 5 Std', unread: false },
      { icon: '👥', title: 'Thomas Schmidt folgt dir jetzt', time: 'vor 1 Tag', unread: false },
      { icon: '⚠️', title: 'Wartung für Iron 883 fällig', time: 'vor 2 Tagen', unread: false },
      { icon: '⭐', title: 'Anna Petrov hat dein Profil besucht', time: 'vor 2 Tagen', unread: false },
      { icon: '🗺', title: 'Neue Werkstatt in deiner Nähe entdeckt', time: 'vor 3 Tagen', unread: false },
    ]
    dropdown = document.createElement('div')
    dropdown.id = 'cc-notif-dropdown'
    dropdown.className = 'cc-notif-dropdown'
    dropdown.innerHTML = `
      <div class="cc-notif-head">
        <span>Benachrichtigungen</span>
        <button class="cc-notif-mark-read">Alle gelesen</button>
      </div>
      <div class="cc-notif-list">
        ${mockNotifs.map(n => `
          <div class="cc-notif-item ${n.unread ? 'cc-notif-item--unread' : ''}">
            <span class="cc-notif-icon">${n.icon}</span>
            <div class="cc-notif-body">
              <div class="cc-notif-title">${n.title}</div>
              <div class="cc-notif-time">${n.time}</div>
            </div>
            ${n.unread ? '<span class="cc-notif-dot"></span>' : ''}
          </div>
        `).join('')}
      </div>
    `
    const rect = ccNotifBtn.getBoundingClientRect()
    dropdown.style.top = (rect.bottom + 8) + 'px'
    dropdown.style.right = (window.innerWidth - rect.right) + 'px'
    document.body.appendChild(dropdown)
    requestAnimationFrame(() => dropdown.classList.add('cc-notif-dropdown--open'))
    dropdown.querySelector('.cc-notif-mark-read')?.addEventListener('click', e2 => {
      e2.stopPropagation()
      dropdown.querySelectorAll('.cc-notif-item--unread').forEach(it => {
        it.classList.remove('cc-notif-item--unread')
        it.querySelector('.cc-notif-dot')?.remove()
      })
      const badge = ccNotifBtn.querySelector('.cc-notif-badge')
      if (badge) badge.style.display = 'none'
    })
    setTimeout(() => {
      const handler = e2 => {
        if (!dropdown.contains(e2.target)) {
          dropdown.remove()
          document.removeEventListener('click', handler)
        }
      }
      document.addEventListener('click', handler)
    }, 0)
  })

  // Community search — filter cards live + recent search dropdown
  const ccSearchInput = document.getElementById('cc-search-input')
  function getRecentSearches(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
  }
  function saveRecentSearch(key, query) {
    if (!query || !query.trim()) return
    let list = getRecentSearches(key).filter(q => q !== query)
    list.unshift(query)
    list = list.slice(0, 5)
    try { localStorage.setItem(key, JSON.stringify(list)) } catch {}
  }
  function showRecentDropdown(input, key, applyQuery) {
    const existing = document.getElementById('mm-recent-dd')
    if (existing) existing.remove()
    const recent = getRecentSearches(key)
    if (!recent.length) return
    const dd = document.createElement('div')
    dd.id = 'mm-recent-dd'
    dd.className = 'mm-recent-dropdown'
    dd.innerHTML = `
      <div class="mm-recent-head">
        <span>Letzte Suchen</span>
        <button class="mm-recent-clear">Löschen</button>
      </div>
      ${recent.map(q => `
        <button class="mm-recent-item" data-q="${esc(q)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
          <span>${esc(q)}</span>
        </button>
      `).join('')}
    `
    const rect = input.getBoundingClientRect()
    dd.style.top = (rect.bottom + 6) + 'px'
    dd.style.left = rect.left + 'px'
    dd.style.width = rect.width + 'px'
    document.body.appendChild(dd)
    dd.querySelectorAll('.mm-recent-item').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault()
        const q = btn.dataset.q
        input.value = q
        applyQuery(q)
        dd.remove()
      })
    })
    dd.querySelector('.mm-recent-clear')?.addEventListener('mousedown', e => {
      e.preventDefault()
      try { localStorage.removeItem(key) } catch {}
      dd.remove()
    })
    setTimeout(() => {
      const h = (ev) => {
        if (!dd.contains(ev.target) && ev.target !== input) {
          dd.remove(); document.removeEventListener('mousedown', h)
        }
      }
      document.addEventListener('mousedown', h)
    }, 0)
  }
  if (ccSearchInput) {
    const applyCommunitySearch = (q) => {
      const lc = q.trim().toLowerCase()
      document.querySelectorAll('#gear-list .gear-card').forEach(card => {
        if (!lc) { card.dataset.searchHidden = '' }
        else { card.dataset.searchHidden = card.textContent.toLowerCase().includes(lc) ? '' : '1' }
      })
      applyGearFilters()
    }
    ccSearchInput.addEventListener('input', e => applyCommunitySearch(e.target.value))
    ccSearchInput.addEventListener('focus', () => showRecentDropdown(ccSearchInput, 'mm_recent_cc', applyCommunitySearch))
    ccSearchInput.addEventListener('keypress', e => {
      if (e.key === 'Enter' && ccSearchInput.value.trim()) {
        saveRecentSearch('mm_recent_cc', ccSearchInput.value.trim())
        document.getElementById('mm-recent-dd')?.remove()
      }
    })
  }
  // Topbar menu → toggle dropdown with community filter categories
  const ccMenuBtn = document.getElementById('cc-menu-btn')
  ccMenuBtn?.addEventListener('click', e => {
    e.stopPropagation()
    let dropdown = document.getElementById('cc-menu-dropdown')
    if (dropdown) {
      dropdown.remove()
      return
    }
    // Determine currently active category
    const activeFilter = document.querySelector('.cc-filter-strip .gear-filter-btn--active')?.dataset.filter || 'all'
    const categories = [
      { key: 'all',        label: 'Alle',         icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
      { key: 'video',      label: 'Videos',       icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M10 11l5 3-5 3z" fill="currentColor"/></svg>' },
      { key: 'short',      label: 'Shorts',       icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 11l4 2-4 2z" fill="currentColor"/></svg>' },
      { key: 'tour',       label: 'Touren',       icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' },
      { key: 'event',      label: 'Events',       icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>' },
      { key: 'group',      label: 'Gruppen',      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 20c0-2 2-3 4-3s4 1 4 3"/></svg>' },
      { key: 'stammtisch', label: 'Stammtische',  icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11h14l-1 7c-.4 2-1.5 3-7 3s-6.6-1-7-3z"/><path d="M5 11c0-2 3-4 7-4s7 2 7 4"/><path d="M10 6V4M14 6V4"/></svg>' },
      { key: 'forum',      label: 'Forum',        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12h-7l-4 4v-4H4z"/><path d="M8 11h8M8 14h5"/></svg>' },
    ]
    dropdown = document.createElement('div')
    dropdown.id = 'cc-menu-dropdown'
    dropdown.className = 'cc-menu-dropdown'
    dropdown.innerHTML = `
      <div class="cc-menu-section-title">Kategorien</div>
      ${categories.map(c => `
        <button class="cc-menu-item ${c.key === activeFilter ? 'cc-menu-item--active' : ''}" data-filter="${c.key}">
          <span class="cc-menu-item-icon">${c.icon}</span>
          <span class="cc-menu-item-label">${c.label}</span>
        </button>
      `).join('')}
    `
    const rect = ccMenuBtn.getBoundingClientRect()
    dropdown.style.top = (rect.bottom + 8) + 'px'
    dropdown.style.left = rect.left + 'px'
    document.body.appendChild(dropdown)
    requestAnimationFrame(() => dropdown.classList.add('cc-menu-dropdown--open'))
    dropdown.querySelectorAll('.cc-menu-item').forEach(btn => {
      btn.addEventListener('click', evt => {
        evt.stopPropagation()
        const filter = btn.dataset.filter
        // Click the corresponding hidden filter pill (re-uses existing logic)
        const targetPill = document.querySelector(`.cc-filter-strip .gear-filter-btn[data-filter="${filter}"]`)
        targetPill?.click()
        dropdown.remove()
      })
    })
    setTimeout(() => {
      const handler = () => { dropdown.remove(); document.removeEventListener('click', handler) }
      document.addEventListener('click', handler)
    }, 0)
  })
  modalBackdrop?.addEventListener('click', closeCcModal)
  modalClose?.addEventListener('click', closeCcModal)
  modalCancel?.addEventListener('click', closeCcModal)

  // ── Community: open detail view on card click ──
  function openCommunityDetail(viewHtml) {
    const overlay = document.getElementById('cc-detail-overlay')
    if (!overlay) return
    overlay.innerHTML = viewHtml
    overlay.style.display = 'block'
    requestAnimationFrame(() => overlay.classList.add('cc-detail-overlay--open'))
    document.querySelector('.konf-right')?.classList.add('konf-right--locked')
    // Wire close button
    const backBtn = document.getElementById('cc-detail-back')
    backBtn?.addEventListener('click', closeCommunityDetail)
    // Wire actions inside detail view
    wireDetailViewActions()
  }
  function closeCommunityDetail() {
    const overlay = document.getElementById('cc-detail-overlay')
    if (!overlay) return
    overlay.classList.remove('cc-detail-overlay--open')
    setTimeout(() => {
      overlay.style.display = 'none'
      overlay.innerHTML = ''
    }, 250)
    document.querySelector('.konf-right')?.classList.remove('konf-right--locked')
  }
  function wireDetailViewActions() {
    // Like in detail view
    document.querySelector('.ccd-like-pill')?.addEventListener('click', e => {
      const btn = e.currentTarget
      const id = btn.dataset.cardId
      const baseLikes = parseInt(btn.dataset.baseLikes) || 0
      const state = getCardState(id)
      const newLiked = !state.liked
      setCardState(id, { liked: newLiked })
      btn.classList.toggle('ccd-like-pill--active', newLiked)
      const svg = btn.querySelector('svg')
      if (svg) svg.setAttribute('fill', newLiked ? 'currentColor' : 'none')
      const countEl = btn.querySelector('.ccd-like-count')
      if (countEl) countEl.textContent = (baseLikes + (newLiked ? 1 : 0)).toLocaleString('de-DE')
    })
    // Subscribe in detail view
    document.querySelector('.ccd-subscribe-big')?.addEventListener('click', e => {
      const btn = e.currentTarget
      const id = btn.dataset.cardId
      const state = getCardState(id)
      const sub = !state.subscribed
      setCardState(id, { subscribed: sub })
      btn.dataset.subscribed = sub ? 'true' : 'false'
      btn.textContent = sub ? '✓ Abonniert' : 'Abonnieren'
    })
    // Click on channel/comment user → open profile
    document.querySelectorAll('[data-profile]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        const name = decodeURIComponent(el.dataset.profile)
        openCommunityDetail(buildProfileView(name))
      })
    })
    // Share button → Web Share API with clipboard fallback
    document.querySelector('.ccd-share-btn')?.addEventListener('click', async () => {
      const btn = document.querySelector('.ccd-share-btn')
      const title = btn.dataset.shareTitle || 'MotoMatch'
      const text = btn.dataset.shareText || ''
      const url = window.location.href
      try {
        if (navigator.share) {
          await navigator.share({ title, text, url })
        } else {
          await navigator.clipboard.writeText(url)
          showToast('Link in Zwischenablage kopiert ✓')
        }
      } catch (err) { /* user cancelled */ }
    })
    // Save button → toggle saved state in localStorage
    document.querySelector('.ccd-save-btn')?.addEventListener('click', () => {
      const btn = document.querySelector('.ccd-save-btn')
      const id = btn.dataset.saveId
      try {
        let saved = JSON.parse(localStorage.getItem('mm_saved_videos') || '[]')
        if (saved.includes(id)) {
          saved = saved.filter(s => s !== id)
          btn.classList.remove('ccd-action-pill--active')
          showToast('Aus Gespeichert entfernt')
        } else {
          saved.push(id)
          btn.classList.add('ccd-action-pill--active')
          showToast('Gespeichert ✓')
        }
        localStorage.setItem('mm_saved_videos', JSON.stringify(saved))
      } catch {}
    })

    // Video play (real HTML5 video)
    const playBtn = document.getElementById('ccd-play-btn')
    const videoEl = document.getElementById('ccd-video')
    if (playBtn && videoEl) {
      playBtn.addEventListener('click', () => {
        videoEl.style.display = 'block'
        playBtn.style.display = 'none'
        const icon = document.querySelector('#ccd-player .ccd-player-icon')
        const dur = document.querySelector('#ccd-player .ccd-duration')
        if (icon) icon.style.display = 'none'
        if (dur) dur.style.display = 'none'
        videoEl.play().catch(() => {})
      })
    }

    // Description toggle (expand/collapse)
    const descToggle = document.getElementById('ccd-desc-toggle')
    const descContent = document.getElementById('ccd-desc-content')
    if (descToggle && descContent) {
      descToggle.addEventListener('click', () => {
        const collapsed = descContent.classList.toggle('ccd-desc-collapsed')
        descToggle.textContent = collapsed ? '…mehr anzeigen' : 'weniger anzeigen'
      })
    }

    // Comment input — show actions on focus
    const cInput = document.getElementById('ccd-comment-input')
    const cActions = document.getElementById('ccd-comment-input-actions')
    const cSubmit = document.getElementById('ccd-comment-submit')
    const cCancel = document.getElementById('ccd-cancel-comment')
    if (cInput) {
      cInput.addEventListener('focus', () => {
        if (cActions) cActions.style.display = 'flex'
      })
      cInput.addEventListener('input', () => {
        if (cSubmit) cSubmit.disabled = !cInput.value.trim()
      })
      cInput.addEventListener('keypress', e => {
        if (e.key === 'Enter' && cInput.value.trim()) {
          e.preventDefault()
          submitComment()
        }
      })
    }
    cCancel?.addEventListener('click', () => {
      if (cInput) { cInput.value = ''; cInput.blur() }
      if (cActions) cActions.style.display = 'none'
      if (cSubmit) cSubmit.disabled = true
    })
    function submitComment() {
      const text = cInput?.value.trim()
      const cardId = cInput?.dataset.cardId
      if (!text || !cardId) return
      const comments = getUserComments(cardId)
      const entry = { text, ts: Date.now() }
      comments.push(entry)
      saveUserComments(cardId, comments)
      // Insert at top of list
      const list = document.getElementById('ccd-comments-list')
      if (list) {
        const html = `
          <div class="ccd-comment ccd-comment--mine ccd-comment--new">
            <div class="ccd-avatar ccd-avatar-sm" style="background:${stringColor(rawUserName())}">${getCurrentUserInitials()}</div>
            <div class="ccd-comment-body">
              <div class="ccd-comment-head">
                <span class="ccd-comment-user">${getCurrentUserName()}</span>
                <span class="ccd-comment-time">gerade eben</span>
              </div>
              <div class="ccd-comment-text">${esc(text)}</div>
              <div class="ccd-comment-actions">
                <button class="ccd-mini-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 22V11l5-8 1 1v6h7l-2 12H7z"/></svg> 0</button>
                <button class="ccd-mini-btn">Antworten</button>
                <button class="ccd-mini-btn ccd-delete-comment" data-comment-ts="${entry.ts}" data-card-id="${cardId}">Löschen</button>
              </div>
            </div>
          </div>`
        list.insertAdjacentHTML('afterbegin', html)
        // Wire delete on the new comment
        list.querySelector('.ccd-comment--new .ccd-delete-comment')?.addEventListener('click', handleDeleteComment)
        // Update count
        const countEl = document.getElementById('ccd-comments-count')
        if (countEl) {
          const total = MOCK_COMMENTS.length + getUserComments(cardId).length
          countEl.textContent = `· ${total}`
        }
      }
      // Clear input
      if (cInput) cInput.value = ''
      if (cActions) cActions.style.display = 'none'
      if (cSubmit) cSubmit.disabled = true
      cInput?.blur()
    }
    cSubmit?.addEventListener('click', submitComment)

    // Comment sort menu
    const sortTrigger = document.getElementById('ccd-sort-trigger')
    const sortMenu = document.getElementById('ccd-sort-menu')
    const sortLabel = document.getElementById('ccd-sort-label')
    sortTrigger?.addEventListener('click', e => {
      e.stopPropagation()
      sortMenu?.classList.toggle('ccd-sort-menu--open')
    })
    document.addEventListener('click', () => sortMenu?.classList.remove('ccd-sort-menu--open'))
    function applyCommentSort(mode) {
      const list = document.getElementById('ccd-comments-list')
      if (!list) return
      const comments = Array.from(list.querySelectorAll('.ccd-comment'))
      comments.sort((a, b) => {
        if (mode === 'new') {
          return (parseInt(b.dataset.ts) || 0) - (parseInt(a.dataset.ts) || 0)
        }
        // top: by likes desc, ties by recency
        const dl = (parseInt(b.dataset.likes) || 0) - (parseInt(a.dataset.likes) || 0)
        if (dl !== 0) return dl
        return (parseInt(b.dataset.ts) || 0) - (parseInt(a.dataset.ts) || 0)
      })
      comments.forEach(c => list.appendChild(c))
    }
    document.querySelectorAll('.ccd-sort-opt').forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation()
        const mode = opt.dataset.sort
        if (sortTrigger) sortTrigger.dataset.sort = mode
        if (sortLabel) sortLabel.textContent = mode === 'new' ? 'Neueste zuerst' : 'Top Kommentare'
        sortMenu?.classList.remove('ccd-sort-menu--open')
        applyCommentSort(mode)
      })
    })
    // Apply default sort once on open
    applyCommentSort('top')

    // Sidebar suggestion click → open that detail view
    document.querySelectorAll('.ccd-sugg').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault()
        const sId = el.dataset.suggId
        const sCat = el.dataset.suggCat
        // Find item by matching cardId in COMMUNITY_LOOKUP
        const entry = COMMUNITY_LOOKUP[sId]
        const itemData = entry?.item || COMMUNITY_DATA[sCat]?.find(x => true)
        if (!itemData) return
        const newCardId = sId
        let viewHtml
        if (sCat === 'group' || sCat === 'stammtisch') {
          viewHtml = buildGroupChatView(itemData, newCardId, sCat)
        } else {
          viewHtml = buildVideoDetailView(itemData, newCardId, sCat)
        }
        // Scroll-reset and replace overlay content
        const overlay = document.getElementById('cc-detail-overlay')
        if (overlay) {
          overlay.innerHTML = viewHtml
          overlay.querySelector('.ccd-scroll')?.scrollTo({ top: 0 })
          // Re-wire close + actions for the new view
          document.getElementById('cc-detail-back')?.addEventListener('click', closeCommunityDetail)
          wireDetailViewActions()
        }
      })
    })

    // Delete own comment
    function handleDeleteComment(e) {
      const btn = e.currentTarget
      const ts = parseInt(btn.dataset.commentTs)
      const cardId = btn.dataset.cardId
      const comments = getUserComments(cardId).filter(c => c.ts !== ts)
      saveUserComments(cardId, comments)
      btn.closest('.ccd-comment')?.remove()
      // Update count
      const countEl = document.getElementById('ccd-comments-count')
      if (countEl) {
        const total = MOCK_COMMENTS.length + comments.length
        countEl.textContent = `· ${total}`
      }
    }
    document.querySelectorAll('.ccd-delete-comment').forEach(btn => {
      btn.addEventListener('click', handleDeleteComment)
    })

    // Group chat: send message
    const sendBtn = document.getElementById('ccg-send-btn')
    const textInput = document.getElementById('ccg-text-input')
    const sendMessage = () => {
      const text = textInput?.value.trim()
      if (!text) return
      const list = document.getElementById('ccg-messages')
      if (!list) return
      const msgHtml = `
        <div class="ccg-msg ccg-msg--me">
          <div class="ccg-bubble">
            <div class="ccg-msg-text">${esc(text)}</div>
            <div class="ccg-msg-time">gerade eben ✓</div>
          </div>
        </div>`
      list.insertAdjacentHTML('beforeend', msgHtml)
      textInput.value = ''
      list.scrollTop = list.scrollHeight
    }
    sendBtn?.addEventListener('click', sendMessage)
    textInput?.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage() })
    // Auto-scroll chat to bottom on open
    const msgList = document.getElementById('ccg-messages')
    if (msgList) msgList.scrollTop = msgList.scrollHeight
  }

  // Bind card-click handlers (open the appropriate detail view)
  document.querySelectorAll('#gear-list .gear-card').forEach(card => {
    card.addEventListener('click', e => {
      // Don't open if user clicked an action button inside the card
      if (e.target.closest('.gear-card-heart, .cc-like, .cc-comment, .cc-subscribe')) return
      // Only for community cards (have COMMUNITY_LOOKUP entry)
      const id = card.dataset.cardId
      const entry = COMMUNITY_LOOKUP[id]
      if (!entry) return
      e.preventDefault()
      const { item, category } = entry
      let viewHtml
      if (category === 'video' || category === 'short') {
        viewHtml = buildVideoDetailView(item, id, category)
      } else if (category === 'group' || category === 'stammtisch') {
        viewHtml = buildGroupChatView(item, id, category)
      } else {
        // tour, event, forum → use video-like detail
        viewHtml = buildVideoDetailView(item, id, category)
      }
      openCommunityDetail(viewHtml)
    })
  })

  modalForm?.addEventListener('submit', e => {
    e.preventDefault()
    const category = document.getElementById('cc-form-category')?.value
    const title    = document.getElementById('cc-form-title')?.value.trim()
    const desc     = document.getElementById('cc-form-desc')?.value.trim()
    const meta     = document.getElementById('cc-form-meta')?.value.trim() || 'Neu'
    const extra    = document.getElementById('cc-form-extra')?.value.trim() || 'Gerade veröffentlicht'
    if (!category || !title || !desc) return
    const posts = getUserPosts()
    posts.push({
      id: Date.now().toString(36),
      category, title, desc, meta, extra,
      tier: 'NEU',
      baseLikes: 0,
      comments: 0,
      createdAt: Date.now(),
    })
    saveUserPosts(posts)
    closeCcModal()
    // Re-render the community grid in place
    const list = document.getElementById('gear-list')
    if (list) {
      const newGrid = document.createRange().createContextualFragment(buildCommunityCards()).firstElementChild
      list.replaceWith(newGrid)
      // Re-bind handlers for the new cards
      setTimeout(() => initKonfiguratorAnimations(), 0)
    }
  })

  // Scroll-direction hide/show for fixed bars in Ausrüstung-Modus
  const konfRightEl = document.querySelector('.konf-right')
  const splitEl = document.querySelector('.konf-split')
  if (konfRightEl && splitEl && !konfRightEl.dataset.scrollHideBound) {
    konfRightEl.dataset.scrollHideBound = '1'
    let lastY = 0
    let ticking = false
    konfRightEl.addEventListener('scroll', () => {
      if (!splitEl.classList.contains('konf-split--fullscreen')) return
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = konfRightEl.scrollTop
        const delta = y - lastY
        if (y < 4) {
          splitEl.classList.remove('konf-bars-hidden')
        } else if (delta > 1) {
          splitEl.classList.add('konf-bars-hidden')
        } else if (delta < -1) {
          splitEl.classList.remove('konf-bars-hidden')
        }
        lastY = y
        ticking = false
      })
    }, { passive: true })
  }

  // "Mehr anzeigen" toggle
  const mehrBtn = document.getElementById('konf-mehr-btn')
  const mehrSection = document.getElementById('konf-mehr-section')
  if (mehrBtn && mehrSection) {
    mehrBtn.addEventListener('click', () => {
      const isOpen = mehrSection.classList.toggle('konf-mehr-open')
      mehrBtn.querySelector('.konf-mehr-label').textContent = isOpen ? 'Weniger anzeigen' : 'Mehr anzeigen'
      mehrBtn.classList.toggle('konf-mehr-btn--open', isOpen)
      if (!isOpen) document.querySelector('.konf-right')?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }
}

function cleanupKonfigurator() {
  if (konfObserver) {
    konfObserver.disconnect()
    konfObserver = null
  }
}

/* ═══════════════════════════════════════════════════
   3D VIEWER — Shared between both views
   ═══════════════════════════════════════════════════ */

function resizeRendererToContainer(container) {
  if (!detailRenderer || !detailCamera || !container) return
  const w = container.offsetWidth
  const h = container.offsetHeight || 550
  detailRenderer.setSize(w, h)
  detailCamera.aspect = w / h
  detailCamera.updateProjectionMatrix()
}

function rebindPointerEvents(container) {
  if (!container) return
  const canvas = container.querySelector('canvas')
  if (!canvas) return

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true
    prevX = e.clientX
    canvas.style.cursor = 'grabbing'
  })
  canvas.style.cursor = 'grab'
}

function initDetail3D(data, darkMode) {
  const wrap = document.getElementById('bd-3d-wrap') || document.getElementById('konf-3d-wrap')
  const canvas = wrap?.querySelector('canvas')
  if (!wrap || !canvas) return

  detailScene = new THREE.Scene()
  detailScene.background = darkMode ? new THREE.Color(0x1a1a1a) : null

  const w = wrap.offsetWidth
  const h = wrap.offsetHeight || Math.min(w * 0.75, 550)
  canvas.style.height = h + 'px'

  detailCamera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100)
  detailCamera.position.set(4, 2, 5)

  detailRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !darkMode })
  if (!darkMode) detailRenderer.setClearColor(0x000000, 0)
  detailRenderer.setSize(w, h)
  detailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  detailRenderer.toneMapping = THREE.ACESFilmicToneMapping
  detailRenderer.toneMappingExposure = darkMode ? 0.9 : 1.1

  const pmrem = new THREE.PMREMGenerator(detailRenderer)
  detailScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  const ambient = new THREE.AmbientLight(0xffffff, darkMode ? 0.4 : 0.6)
  detailScene.add(ambient)
  const dirLight = new THREE.DirectionalLight(0xffffff, darkMode ? 1.5 : 1.2)
  dirLight.position.set(3, 6, 4)
  detailScene.add(dirLight)

  if (darkMode) {
    const rimLight = new THREE.DirectionalLight(0xaabbff, 0.4)
    rimLight.position.set(-4, 3, -2)
    detailScene.add(rimLight)
  }

  // Floor for dark studio mode
  if (darkMode) {
    const floorGeo = new THREE.PlaneGeometry(20, 20)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111111, roughness: 0.85, metalness: 0.0
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.01
    floor.receiveShadow = true
    detailScene.add(floor)
  }

  // Load model
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
  loader.setDRACOLoader(dracoLoader)
  loader.load(data.glb, (gltf) => {
    if (!detailScene || !detailRenderer) {
      dracoLoader.dispose()
      return
    }
    detailBike = gltf.scene

    const toRemove = []
    detailBike.traverse((child) => {
      if (child.isMesh) {
        const name = (child.name || '').toLowerCase()
        if (name.includes('shadow') || name.includes('floor') || name.includes('ground') || name.includes('plane')) {
          toRemove.push(child)
          return
        }
        if (child.geometry) {
          const geo = child.geometry
          geo.computeBoundingBox()
          const gSize = geo.boundingBox.getSize(new THREE.Vector3())
          if (gSize.y < gSize.x * 0.01 && gSize.x > 0.5) {
            toRemove.push(child)
            return
          }
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach(m => { m.side = THREE.DoubleSide })
        }
      }
    })
    toRemove.forEach(obj => obj.parent?.remove(obj))

    const box = new THREE.Box3().setFromObject(detailBike)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetSize = 2.5
    const scale = targetSize / maxDim
    detailBike.scale.setScalar(scale)

    const scaledBox = new THREE.Box3().setFromObject(detailBike)
    const scaledSize = scaledBox.getSize(new THREE.Vector3())
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3())

    detailBike.position.x -= scaledCenter.x
    detailBike.position.z -= scaledCenter.z
    detailBike.position.y -= scaledBox.min.y

    const modelWidth = scaledSize.x
    const modelDepth = scaledSize.z
    const modelHeight = scaledSize.y
    const diagonal = Math.sqrt(modelWidth * modelWidth + modelDepth * modelDepth)

    const fovRad = (detailCamera.fov * Math.PI) / 180
    const fitDist = (diagonal / 2) / Math.tan(fovRad / 2)
    camDist = fitDist * 1.35
    camHeight = modelHeight * 0.6
    lookAtY = modelHeight * 0.35

    detailScene.add(detailBike)
  })

  // Pointer controls
  isDragging = false
  angle = 0.8

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true
    prevX = e.clientX
    canvas.style.cursor = 'grabbing'
  })
  const onPointerMove = (e) => {
    if (!isDragging) return
    angle += (e.clientX - prevX) * 0.008
    prevX = e.clientX
  }
  const onPointerUp = () => {
    isDragging = false
    const c = detailRenderer?.domElement
    if (c) c.style.cursor = 'grab'
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  canvas.style.cursor = 'grab'

  function animate() {
    detailRaf = requestAnimationFrame(animate)
    if (!isDragging) angle += 0.003
    if (detailCamera && detailRenderer && detailScene) {
      detailCamera.position.x = camDist * Math.sin(angle)
      detailCamera.position.z = camDist * Math.cos(angle)
      detailCamera.position.y = camHeight
      detailCamera.lookAt(0, lookAtY, 0)
      detailRenderer.render(detailScene, detailCamera)
    }
  }
  animate()

  const onResize = () => {
    const activeWrap = document.getElementById('bd-3d-wrap') || document.getElementById('konf-3d-wrap')
    if (!activeWrap || !detailRenderer || !detailCamera) return
    const nw = activeWrap.offsetWidth
    const nh = activeWrap.offsetHeight || Math.min(nw * 0.6, 600)
    detailRenderer.setSize(nw, nh)
    detailCamera.aspect = nw / nh
    detailCamera.updateProjectionMatrix()
  }
  window.addEventListener('resize', onResize)

  if (detailRenderer) {
    detailRenderer._resizeHandler = onResize
    detailRenderer._pointerMoveHandler = onPointerMove
    detailRenderer._pointerUpHandler = onPointerUp
  }
}

/* ═══════════════════════════════════════════════════
   DECKBLATT ANIMATIONS
   ═══════════════════════════════════════════════════ */

function initDetailAnimations(detail) {
  const specItems = detail.querySelectorAll('.bd-spec-anim')
  let countersStarted = false

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !countersStarted) {
        countersStarted = true
        specItems.forEach((el, i) => {
          setTimeout(() => el.classList.add('visible'), i * 200)
        })
        setTimeout(() => animateCounters(detail), 100)
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.3 })
  if (specItems[0]) observer.observe(specItems[0])
}

function animateCounters(detail) {
  const counters = detail.querySelectorAll('.bd-counter')
  counters.forEach((el, idx) => {
    const target = parseFloat(el.dataset.target)
    const decimals = parseInt(el.dataset.decimals) || 0
    const duration = 1800
    const startDelay = idx * 150
    setTimeout(() => {
      const t0 = performance.now()
      function tick(now) {
        const elapsed = now - t0
        const progress = Math.min(elapsed / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 4)
        const current = eased * target
        el.textContent = decimals > 0 ? current.toFixed(decimals) : Math.round(current)
        if (progress < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, startDelay)
  })
}

/* ═══════════════════════════════════════════════════
   CLEANUP
   ═══════════════════════════════════════════════════ */

function cleanup3D() {
  if (detailRaf) cancelAnimationFrame(detailRaf)
  if (detailRenderer) {
    if (detailRenderer._resizeHandler) window.removeEventListener('resize', detailRenderer._resizeHandler)
    if (detailRenderer._pointerMoveHandler) window.removeEventListener('pointermove', detailRenderer._pointerMoveHandler)
    if (detailRenderer._pointerUpHandler) window.removeEventListener('pointerup', detailRenderer._pointerUpHandler)
    detailRenderer.dispose()
  }
  if (detailScene) {
    detailScene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach((m) => {
          if (m.map) m.map.dispose()
          if (m.normalMap) m.normalMap.dispose()
          if (m.roughnessMap) m.roughnessMap.dispose()
          if (m.metalnessMap) m.metalnessMap.dispose()
          if (m.aoMap) m.aoMap.dispose()
          if (m.emissiveMap) m.emissiveMap.dispose()
          if (m.envMap) m.envMap.dispose()
          m.dispose()
        })
      }
    })
    if (detailScene.environment) detailScene.environment.dispose()
  }
  detailScene = null
  detailCamera = null
  detailRenderer = null
  detailBike = null
  detailRaf = null
}
