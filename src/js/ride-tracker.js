/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — ride-tracker.js
 *  Fahrten aufzeichnen ueber die Standortschnittstelle des Browsers.
 *
 *  Die Aufzeichnung bleibt auf dem Geraet. Neue Zwischenstaende liegen in
 *  transaktionaler IndexedDB, Legacy-Recovery bleibt unveraendert bis zur
 *  bestaetigten Uebernahme. Es geht keine Koordinate an einen Server und keine Karte eines
 *  Anbieters geladen — die Strecke zeichnet die Seite selbst als Linie. Geteilt
 *  wird nur, was der Nutzer ausdruecklich teilt, und zwar als fertiges Bild.
 *
 *  Standortdaten sind personenbezogen: die Aufzeichnung startet ausschliesslich
 *  auf Knopfdruck, der Browser fragt zusaetzlich um Erlaubnis, und eine
 *  laufende Aufzeichnung ist waehrend der ganzen Zeit sichtbar.
 * ══════════════════════════════════════════════════════════════
 */

import { createRideStore, RideStoreError } from './ride-store.js'
import { createRideMigration } from './ride-store-migration.js'

const LS_LAUFEND = 'mm_ride_track_active_v1'
let rideStore
const store = () => rideStore || (rideStore = createRideStore())
let aufzeichnungAktiv = false

function recoveryToLegacy(record) {
  return record?.state === 'completed' ? { fertig: true, track: record.track } : record?.snapshot || null
}

function legacyDigest(value) {
  const text = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Read the transactional store first; import any legacy recovery without
 * deleting its localStorage source. Multiple recoveries are surfaced as a
 * conflict instead of silently selecting or discarding one. */
export async function ladeUnterbrocheneAufzeichnung() {
  let records
  try {
    const migration = createRideMigration()
    const results = await migration.importLegacyRecovery()
    records = (await store().listRecoveries()).filter((r) => ['active', 'completed'].includes(r.state))
    if (results.some((r) => r.status === 'failed' || r.status === 'invalid' ||
      (r.status === 'conflicted' && !records.some((record) => record.id === r.id)))) {
      throw new RideStoreError('legacy_conflict', 'Vorhandene Fahrtdaten konnten nicht eindeutig übernommen werden.')
    }
  } catch (error) {
    if (error?.code === 'unavailable' || error?.code === 'denied' || error?.code === 'failed') {
      // Legacy data stays viewable, but recording start still requires IDB.
      return unterbrocheneAufzeichnung()
    }
    throw error
  }
  const legacy = unterbrocheneAufzeichnung()
  if (legacy) {
    const id = legacy.fertig ? legacy.track?.id : legacy.id
    const record = records.find((r) => r.id === id)
    const differs = record && record.legacyDigest !== legacyDigest(legacy) && (legacy.fertig
      ? record.state !== 'completed' || JSON.stringify(record.track) !== JSON.stringify(legacy.track)
      : record.state !== 'active' || JSON.stringify(record.snapshot) !== JSON.stringify(legacy))
    if (!record || differs) throw new RideStoreError('legacy_conflict', 'Legacy- und IndexedDB-Aufzeichnungen weichen voneinander ab. Beide bleiben unverändert erhalten.')
  }
  if (records.length > 1) throw new RideStoreError('legacy_conflict', 'Mehrere ungespeicherte Fahrten vorhanden. Keine wurde verändert.')
  return records.length ? recoveryToLegacy(records[0]) : null
}

export async function verwerfeGesicherteAufzeichnung(erwarteteId) {
  if (!erwarteteId) return false
  await ladeUnterbrocheneAufzeichnung()
  const record = await store().getRecovery(erwarteteId)
  if (!record) return verwerfeUnterbrochene(erwarteteId)
  try {
    if (record.state === 'completed') await store().discardCompleted(record.id, record.revision)
    else {
      const handle = await store().resumeRecording(record.id, record.revision)
      await store().cancelRecording(handle)
    }
  } catch { return false }
  // Legacy removal happens only after the durable IndexedDB delete committed.
  verwerfeUnterbrochene(erwarteteId)
  return true
}

export async function bestaetigeGespeicherteFahrt(track) {
  if (!track?.id) return false
  await ladeUnterbrocheneAufzeichnung()
  const record = await store().getRecovery(track.id)
  if (record) {
    if (record.state !== 'completed' || record.track?.id !== track.id) return false
    try { await store().discardCompleted(record.id, record.revision) }
    catch { return false }
  }
  verwerfeUnterbrochene(track.id)
  return true
}

/* Rohpunkte des Satellitenempfaengers sind nicht sauber. Ohne diese Grenzen
   zaehlt eine Fahrt Kilometer, die niemand gefahren ist: an der Ampel wandert
   die Position im Rauschen hin und her, und beim Wechsel zwischen Funkzelle
   und Satellit springt sie gern einmal quer durch die Stadt. */
const MAX_UNGENAUIGKEIT_M = 50   // schlechter gemessene Punkte fliegen raus
const MIN_SCHRITT_M       = 5    // darunter: Rauschen im Stand, kein Weg
const MAX_TEMPO_KMH       = 260  // darueber: Sprung, kein Motorrad
const LUECKE_AB_S         = 25   // so lange kein GPS (Hintergrund) …
const LUECKE_AB_M         = 300  // … und so weit weg: Lücke, kein Sprung
const FAHRT_AB_KMH        = 3    // darunter laeuft die Fahrzeit nicht weiter
const SICHERN_ALLE_MS     = 5000 // Zwischenstand gegen Absturz/Neuladen

/* Automatische Pause. An der Ampel soll die Uhr stehen bleiben, ohne dass
   jemand mit Handschuhen einen Knopf sucht — und beim Anfahren von selbst
   weiterlaufen. Die beiden Schwellen liegen bewusst auseinander: mit nur einer
   Grenze wuerde die Anzeige bei Schrittgeschwindigkeit staendig zwischen
   "Pause" und "faehrt" springen. */
const AUTOPAUSE_AB_MS   = 12000  // so lange still -> Pause
const AUTOPAUSE_STILL   = 2      // km/h, darunter gilt als Stillstand
const AUTOPAUSE_LOS     = 6      // km/h, darueber geht es weiter

/* Hoehenmeter. Die Hoehe aus dem Satellitenempfang schwankt selbst im Stand um
   mehrere Meter; ungefiltert summiert eine Standpause 300 Hoehenmeter. Gezaehlt
   wird erst, wenn der geglaettete Wert den letzten Ankerpunkt um mehr als
   diese Schwelle ueberschreitet. */
const HOEHE_SCHWELLE_M  = 4
const HOEHE_MAX_FEHLER  = 30     // schlechter gemessene Hoehen zaehlen nicht

// ── Geometrie ────────────────────────────────────────────────

/** Entfernung zweier Punkte auf der Erdkugel, in Metern (Haversine). */
export function entfernungM(lat1, lon1, lat2, lon2) {
  const R = 6371008.8
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/* Douglas-Peucker. Eine Stunde Fahrt sind rund 3.600 Punkte; als JSON waeren
   das ueber 100 KB pro Eintrag, und localStorage hat insgesamt etwa 5 MB.
   Fuer eine Linie in Kartengroesse reichen ein paar hundert Punkte, der
   sichtbare Verlauf bleibt derselbe. */
function vereinfache(punkte, toleranzM) {
  if (punkte.length <= 2) return punkte
  const lat0 = punkte[0].lat * Math.PI / 180
  const mX = 111320 * Math.cos(lat0)   // Meter je Grad Laenge auf dieser Breite
  const mY = 110540                     // Meter je Grad Breite
  const x = p => p.lon * mX
  const y = p => p.lat * mY

  const abstand = (p, a, b) => {
    const dx = x(b) - x(a), dy = y(b) - y(a)
    const laenge = dx * dx + dy * dy
    if (laenge === 0) return Math.hypot(x(p) - x(a), y(p) - y(a))
    let t = ((x(p) - x(a)) * dx + (y(p) - y(a)) * dy) / laenge
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(x(p) - (x(a) + t * dx), y(p) - (y(a) + t * dy))
  }

  const behalten = new Array(punkte.length).fill(false)
  behalten[0] = behalten[punkte.length - 1] = true
  const stapel = [[0, punkte.length - 1]]
  while (stapel.length) {
    const [von, bis] = stapel.pop()
    let maxD = 0, maxI = -1
    for (let i = von + 1; i < bis; i++) {
      const d = abstand(punkte[i], punkte[von], punkte[bis])
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD > toleranzM && maxI > 0) {
      behalten[maxI] = true
      stapel.push([von, maxI], [maxI, bis])
    }
  }
  return punkte.filter((_, i) => behalten[i])
}

/**
 * Die Strecke als SVG-Pfad in einer Flaeche der Groesse b x h.
 * Dieselbe Funktion bedient die Karte waehrend der Fahrt, die Vorschau auf der
 * Karteikarte und das Bild zum Teilen — sonst laufen drei Darstellungen
 * derselben Strecke auseinander.
 */
export function spurPfad(punkte, b, h, rand = 6) {
  if (!punkte || punkte.length < 2) return ''
  const lats = punkte.map(p => p.lat ?? p[0])
  const lons = punkte.map(p => p.lon ?? p[1])
  const latMin = Math.min(...lats), latMax = Math.max(...lats)
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons)

  /* Laengengrade ruecken zu den Polen hin zusammen. Ohne diesen Faktor waere
     jede Strecke in Deutschland rund 35 % zu breit gezeichnet. */
  const kx = Math.cos((latMin + latMax) / 2 * Math.PI / 180)
  const spanX = Math.max((lonMax - lonMin) * kx, 1e-9)
  const spanY = Math.max(latMax - latMin, 1e-9)
  const skala = Math.min((b - 2 * rand) / spanX, (h - 2 * rand) / spanY)
  const versatzX = (b - spanX * skala) / 2
  const versatzY = (h - spanY * skala) / 2

  return punkte.map((p, i) => {
    const lat = p.lat ?? p[0], lon = p.lon ?? p[1]
    const px = versatzX + (lon - lonMin) * kx * skala
    const py = versatzY + (latMax - lat) * skala   // Norden nach oben
    return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`
  }).join(' ')
}

// ── Aufzeichnung ─────────────────────────────────────────────

export function standortVerfuegbar() {
  return typeof navigator !== 'undefined' &&
         'geolocation' in navigator &&
         window.isSecureContext !== false
}

/** Ein abgebrochener Lauf (Neuladen, Absturz) — oder null. */
export function unterbrocheneAufzeichnung() {
  try {
    const roh = JSON.parse(localStorage.getItem(LS_LAUFEND) || 'null')
    if (roh?.fertig) return roh.track?.punkte?.length ? roh : null
    if (!roh?.punkte?.length) return null
    return roh
  } catch { return null }
}

export function verwerfeUnterbrochene(erwarteteId = null) {
  try {
    if (erwarteteId) {
      const offen = unterbrocheneAufzeichnung()
      if (!offen && localStorage.getItem(LS_LAUFEND) != null) return false
      if (offen && (offen.fertig ? offen.track?.id : offen.id) !== erwarteteId) return false
    }
    localStorage.removeItem(LS_LAUFEND)
    return true
  } catch { return false }
}

/**
 * Startet die Aufzeichnung.
 * @param {(stand) => void} beiAenderung  bekommt nach jedem Punkt den Stand
 * @param {(text) => void}  beiFehler
 * @returns {Promise<object>} Steuerung mit pause/weiter/beenden/abbrechen
 */
export async function starteAufzeichnung({ beiAenderung, beiFehler, fortsetzen = null } = {}) {
    if (!standortVerfuegbar()) {
      throw new Error('Dieses Geraet oder dieser Browser gibt den Standort nicht frei.')
    }
    if (aufzeichnungAktiv) {
      throw new Error('Es läuft bereits eine Fahrtaufzeichnung.')
    }

    const offen = await ladeUnterbrocheneAufzeichnung()
    if (offen?.fertig || (offen && (!fortsetzen || offen.start !== fortsetzen.start))) {
      throw new Error('Eine ungespeicherte Fahrt wartet noch. Bitte zuerst speichern oder verwerfen.')
    }
    const id = fortsetzen?.id || `auf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const start = fortsetzen?.start || Date.now()
    let ownership
    if (fortsetzen) {
      const record = await store().getRecovery(id)
      if (!record || record.state !== 'active' || record.snapshot?.start !== start) {
        throw new RideStoreError('conflict', 'Die Wiederherstellung hat sich geändert. Keine Daten wurden verändert.')
      }
      ownership = await store().resumeRecording(id, record.revision, {
        legacyDigest: unterbrocheneAufzeichnung() ? legacyDigest(unterbrocheneAufzeichnung()) : undefined,
      })
    } else {
      if (offen) throw new Error('Eine ungespeicherte Fahrt wartet noch. Bitte zuerst speichern oder verwerfen.')
      ownership = await store().beginRecording({ id, start, meter: 0, fahrMs: 0, maxKmh: 0, hoehe: 0, punkte: [] }, id)
    }
    return new Promise((aufloesen, ablehnen) => {
    aufzeichnungAktiv = true

    const punkte = fortsetzen?.punkte?.map(p => ({ lat: p[0], lon: p[1], t: p[2], alt: p[3] ?? null, luecke: !!p[4] })) || []
    let meterGesamt = fortsetzen?.meter || 0
    let fahrMs      = fortsetzen?.fahrMs || 0
    let maxKmh      = fortsetzen?.maxKmh || 0
    let hoehenMeter = fortsetzen?.hoehe || 0
    let pausiert    = false      // von Hand
    let autoPause   = false      // erkannter Stillstand
    let stillSeit   = 0
    let hoeheAnker  = null       // letzte gezaehlte Hoehe
    let hoeheGlatt  = null       // gleitender Mittelwert
    let beendet     = false
    let letzter     = punkte.length ? punkte[punkte.length - 1] : null
    let letzterMs   = letzter ? start + letzter.t * 1000 : 0
    let tempoKmh    = 0
    let watchId     = null
    let sicherTimer = null
    let wakeLock    = null
    let ersterPunkt = punkte.length > 0
    let speicherFehlerGemeldet = false
    let besitzerVerloren = false
    let sicherungKette = Promise.resolve()

    const stand = () => ({
      km: meterGesamt / 1000,
      fahrMs,
      gesamtMs: Date.now() - start,
      tempoKmh,
      maxKmh,
      schnittKmh: fahrMs > 0 ? (meterGesamt / 1000) / (fahrMs / 3600000) : 0,
      hoehenMeter,
      punkte,
      pausiert,
      autoPause,
      ruht: pausiert || autoPause,
      punktZahl: punkte.length,
    })

    // Bildschirm wach halten — sonst stoppt das Telefon die Messung im Sperrbildschirm.
    const wachHalten = async () => {
      try {
        if ('wakeLock' in navigator && !wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen')
          wakeLock.addEventListener('release', () => { wakeLock = null })
        }
      } catch { /* z. B. bei niedrigem Akkustand abgelehnt — die Messung laeuft trotzdem */ }
    }
    const beiSichtbar = () => { if (document.visibilityState === 'visible' && !beendet) wachHalten() }
    document.addEventListener('visibilitychange', beiSichtbar)

    const snapshot = () => ({
          id, start, meter: meterGesamt, fahrMs, maxKmh, hoehe: hoehenMeter,
          punkte: punkte.map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5), p.t, p.alt, p.luecke ? 1 : 0]),
    })
    const meldenSpeicherfehler = () => {
      if (!speicherFehlerGemeldet) {
        beiFehler?.('Zwischenstand konnte nicht gesichert werden. Die Fahrt ist nur in dieser Sitzung vollständig vorhanden.')
        speicherFehlerGemeldet = true
      }
    }
    const sichern = () => {
      const standJetzt = snapshot()
      sicherungKette = sicherungKette.then(async () => {
        if (beendet || besitzerVerloren) return
        ownership = await store().checkpointRecording(ownership, standJetzt)
        speicherFehlerGemeldet = false
      }).catch((error) => {
        besitzerVerloren = true
        if (watchId != null) navigator.geolocation.clearWatch(watchId)
        watchId = null
        meldenSpeicherfehler()
        if (error?.code === 'conflict') beiFehler?.('Die Aufnahme wurde in einem anderen Tab übernommen. Dieser Tab zeichnet nicht weiter auf; die Fahrt bleibt zur Sicherung erhalten.')
      })
      return sicherungKette
    }

    /* Hoehenmeter sammeln. Erst glaetten, dann nur Anstiege ueber der Schwelle
       zaehlen — sonst macht das Rauschen des Empfaengers aus jeder Standpause
       eine Bergetappe. */
    const hoeheVerarbeiten = (alt, fehler) => {
      if (alt == null || (fehler != null && fehler > HOEHE_MAX_FEHLER)) return
      hoeheGlatt = hoeheGlatt == null ? alt : hoeheGlatt * 0.7 + alt * 0.3
      if (hoeheAnker == null) { hoeheAnker = hoeheGlatt; return }
      const diff = hoeheGlatt - hoeheAnker
      if (diff > HOEHE_SCHWELLE_M) { hoehenMeter += diff; hoeheAnker = hoeheGlatt }
      else if (diff < -HOEHE_SCHWELLE_M) { hoeheAnker = hoeheGlatt }
    }

    const neuerPunkt = (pos) => {
      if (beendet || pausiert) return
      const { latitude: lat, longitude: lon, accuracy, speed, altitude, altitudeAccuracy } = pos.coords
      if (accuracy != null && accuracy > MAX_UNGENAUIGKEIT_M) return

      const jetzt = pos.timestamp || Date.now()
      hoeheVerarbeiten(altitude, altitudeAccuracy)
      const punkt = {
        lat, lon,
        t: Math.max(0, Math.round((jetzt - start) / 1000)),
        alt: hoeheGlatt != null ? Math.round(hoeheGlatt) : null,
      }

      if (letzter) {
        const d = entfernungM(letzter.lat, letzter.lon, lat, lon)
        const dtS = Math.max((jetzt - letzterMs) / 1000, 0.001)
        const kmh = d / dtS * 3.6
        /* Lücke: Im Hintergrund (Bildschirm gesperrt, andere App vorn) liefert
           der Browser kein GPS. Kommt danach ein weit entfernter Punkt, ist das
           keine gerade Fahrt — markieren, beim Speichern über Straßen ergänzen. */
        // ab dem letzten Wegpunkt gemessen: manche Browser melden im Stand
        // dieselbe Position immer wieder, das zählt nicht als "GPS da"
        const seitWegpunktS = (jetzt - (start + letzter.t * 1000)) / 1000
        const luecke = seitWegpunktS > LUECKE_AB_S && d > LUECKE_AB_M
        if (kmh > MAX_TEMPO_KMH && !luecke) return          // Sprung des Empfaengers
        if (luecke) punkt.luecke = true

        const gemessen = speed != null && speed >= 0 ? speed * 3.6 : kmh

        // Automatische Pause: zwei Schwellen gegen Flattern (siehe oben)
        if (autoPause) {
          if (gemessen >= AUTOPAUSE_LOS) { autoPause = false; stillSeit = 0; letzterMs = jetzt }
        } else if (gemessen < AUTOPAUSE_STILL) {
          if (!stillSeit) stillSeit = jetzt
          else if (jetzt - stillSeit > AUTOPAUSE_AB_MS) autoPause = true
        } else {
          stillSeit = 0
        }

        if (d < MIN_SCHRITT_M) {           // Rauschen im Stand
          tempoKmh = 0
          letzterMs = jetzt
          beiAenderung?.(stand())
          return
        }

        meterGesamt += d
        if (kmh >= FAHRT_AB_KMH && !autoPause) fahrMs += jetzt - letzterMs
        tempoKmh = autoPause ? 0 : gemessen
        if (gemessen > maxKmh && gemessen <= MAX_TEMPO_KMH) maxKmh = gemessen
      }

      punkte.push(punkt)
      letzter = punkt
      letzterMs = jetzt
      if (!ersterPunkt) { ersterPunkt = true; sichern(); aufloesen(steuerung) }
      beiAenderung?.(stand())
    }

    const fehler = (err) => {
      const texte = {
        1: 'Ohne Standortfreigabe kann die Fahrt nicht aufgezeichnet werden.',
        2: 'Kein Standort verfuegbar — unter freiem Himmel klappt es meist besser.',
        3: 'Der Standort kam nicht rechtzeitig.',
      }
      const text = texte[err.code] || 'Der Standort konnte nicht ermittelt werden.'
      if (!ersterPunkt) {
        Promise.resolve().then(() => store().cancelRecording(ownership)).catch(() => {})
          .finally(() => { aufraeumen(); ablehnen(new Error(text)) })
        return
      }
      beiFehler?.(text)
    }

    function aufraeumen() {
      beendet = true
      aufzeichnungAktiv = false
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      clearInterval(sicherTimer)
      document.removeEventListener('visibilitychange', beiSichtbar)
      try { wakeLock?.release() } catch {}
      wakeLock = null
    }

    const steuerung = {
      stand,
      pause() { pausiert = true; tempoKmh = 0; letzter = null; beiAenderung?.(stand()); return sichern() },
      weiter() {
        pausiert = false; autoPause = false; stillSeit = 0
        letzterMs = Date.now(); beiAenderung?.(stand()); return sichern()
      },
      async abbrechen() {
        if (beendet) return false
        await sicherungKette
        try {
          await store().cancelRecording(ownership)
          verwerfeUnterbrochene(id)
          aufraeumen()
          return true
        } catch (error) {
          meldenSpeicherfehler()
          beiFehler?.('Die Fahrt wurde nicht verworfen. Der gespeicherte Wiederherstellungsstand bleibt erhalten.')
          return false
        }
      },
      /** Beendet und liefert die fertige Fahrt — oder null, wenn zu kurz. */
      async beenden() {
        const s = stand()
        await sicherungKette
        aufraeumen()
        if (punkte.length < 2) {
          if (!besitzerVerloren) {
            try { await store().cancelRecording(ownership); verwerfeUnterbrochene(id) }
            catch { meldenSpeicherfehler() }
          }
          return null
        }
        // Je Abschnitt zwischen GPS-Lücken vereinfachen, damit die Lücken-Enden
        // erhalten bleiben; lange Fahrten gröber statt abgeschnitten
        const abschnitte = [[]]
        for (const p of punkte) {
          if (p.luecke && abschnitte[abschnitte.length - 1].length) abschnitte.push([])
          abschnitte[abschnitte.length - 1].push(p)
        }
        let knapp, toleranz = 12
        do {
          knapp = []
          const luecken = []
          for (const a of abschnitte) {
            if (knapp.length) luecken.push(knapp.length - 1)
            knapp.push(...(a.length > 2 ? vereinfache(a, toleranz) : a))
          }
          knapp.luecken = luecken
          toleranz *= 1.5
        } while (knapp.length > 1500)
        const track = {
          id,
          punkte: knapp.map(p => [+p.lat.toFixed(5), +p.lon.toFixed(5), p.t, p.alt]),
          luecken: knapp.luecken,
          km: +(s.km).toFixed(2),
          fahrMs: Math.round(s.fahrMs),
          gesamtMs: Math.round(s.gesamtMs),
          maxKmh: +s.maxKmh.toFixed(1),
          schnittKmh: +s.schnittKmh.toFixed(1),
          hoehenMeter: Math.round(hoehenMeter),
          start,
          ende: Date.now(),
          rohPunkte: punkte.length,
        }
        let gesichert = false
        try {
          if (besitzerVerloren) throw new RideStoreError('conflict', 'Besitz der Aufnahme verloren')
          await store().finishRecording(ownership, track)
          gesichert = true
        } catch {
          meldenSpeicherfehler()
          beiFehler?.('Die fertige Fahrt konnte nicht dauerhaft gesichert werden. Bitte jetzt speichern oder eine Sicherung herunterladen.')
        }
        Object.defineProperty(track, 'wiederherstellungGesichert', { value: gesichert })
        return track
      },
    }

    wachHalten()
    sicherTimer = setInterval(sichern, SICHERN_ALLE_MS)
    try {
      watchId = navigator.geolocation.watchPosition(neuerPunkt, fehler, {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 20000,
      })
    } catch (err) {
      Promise.resolve().then(() => store().cancelRecording(ownership)).catch(() => {})
        .finally(() => { aufraeumen(); ablehnen(err) })
      return
    }

    // Wird beim ersten Punkt aufgeloest; bei Fortsetzung sofort.
    if (ersterPunkt) aufloesen(steuerung)
    })
}

// ── Darstellung ──────────────────────────────────────────────

export function formatiereDauer(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sek = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sek).padStart(2, '0')}`
    : `${m}:${String(sek).padStart(2, '0')}`
}
