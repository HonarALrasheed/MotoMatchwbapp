/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — ride-stats.js
 *  Auswertung aufgezeichneter Fahrten.
 *
 *  Reine Rechenfunktionen ueber eine gespeicherte Spur: Kilometer-Abschnitte,
 *  Tempo- und Hoehenverlauf, Bestwerte ueber alle Fahrten. Nichts hier greift
 *  auf das Dokument oder den Speicher zu — das macht die Zahlen pruefbar und
 *  haelt sie aus der Darstellung heraus.
 *
 *  Ein Punkt ist [lat, lon, sekundenSeitStart, hoeheMeterOderNull].
 * ══════════════════════════════════════════════════════════════
 */

import { entfernungM } from './ride-tracker.js'

const P_LAT = 0, P_LON = 1, P_T = 2, P_ALT = 3

/** Laufende Distanz in Metern zu jedem Punkt. */
function distanzen(punkte) {
  const d = [0]
  for (let i = 1; i < punkte.length; i++) {
    d.push(d[i - 1] + entfernungM(
      punkte[i - 1][P_LAT], punkte[i - 1][P_LON],
      punkte[i][P_LAT], punkte[i][P_LON],
    ))
  }
  return d
}

/**
 * Die Fahrt in Kilometer-Abschnitte zerlegt — die Tabelle, die man nach einer
 * Tour als Erstes anschaut.
 *
 * Die Kilometergrenze faellt fast nie genau auf einen Messpunkt. Zwischen den
 * beiden umliegenden Punkten wird deshalb linear interpoliert; ohne das waere
 * jeder Abschnitt um bis zu eine Messluecke verschoben, und bei grossen
 * Abstaenden zwischen den Punkten summiert sich das sichtbar auf.
 */
export function kilometerAbschnitte(track) {
  const punkte = track?.punkte
  if (!punkte || punkte.length < 2) return []

  const dist = distanzen(punkte)
  const gesamtM = dist[dist.length - 1]
  if (gesamtM < 200) return []

  const abschnitte = []
  let grenze = 1000
  let letzteZeit = punkte[0][P_T]
  let letzteHoehe = punkte[0][P_ALT]
  let i = 1

  const zeitBei = (meter) => {
    while (i < dist.length && dist[i] < meter) i++
    if (i >= dist.length) return null
    const d0 = dist[i - 1], d1 = dist[i]
    const t0 = punkte[i - 1][P_T], t1 = punkte[i][P_T]
    const anteil = d1 > d0 ? (meter - d0) / (d1 - d0) : 0
    /* Die Hoehe muss genauso interpoliert werden wie die Zeit. Vorher stand
       hier die Hoehe des Punktes HINTER der Grenze — bei Punkten im
       Kilometerabstand war der Anstieg dadurch um eine volle Messluecke zu
       gross, im Test glatt das Doppelte. */
    const h0 = punkte[i - 1][P_ALT], h1 = punkte[i][P_ALT]
    return {
      t: t0 + (t1 - t0) * anteil,
      hoehe: h0 != null && h1 != null ? h0 + (h1 - h0) * anteil : (h1 ?? h0 ?? null),
    }
  }

  while (grenze <= gesamtM) {
    const treffer = zeitBei(grenze)
    if (!treffer) break
    const dauerS = treffer.t - letzteZeit
    abschnitte.push({
      km: grenze / 1000,
      dauerMs: Math.max(0, dauerS * 1000),
      kmh: dauerS > 0 ? 3600 / dauerS : 0,
      anstieg: letzteHoehe != null && treffer.hoehe != null
        ? Math.round(treffer.hoehe - letzteHoehe) : null,
    })
    letzteZeit = treffer.t
    letzteHoehe = treffer.hoehe
    grenze += 1000
  }

  // Angebrochener letzter Kilometer — als Teilstueck, klar gekennzeichnet
  const restM = gesamtM - (grenze - 1000)
  if (restM > 100) {
    const dauerS = punkte[punkte.length - 1][P_T] - letzteZeit
    abschnitte.push({
      km: +(gesamtM / 1000).toFixed(2),
      teil: +(restM / 1000).toFixed(2),
      dauerMs: Math.max(0, dauerS * 1000),
      kmh: dauerS > 0 ? (restM / 1000) / (dauerS / 3600) : 0,
      anstieg: null,
    })
  }

  return abschnitte
}

/**
 * Tempo ueber die Strecke, geglaettet.
 * Punkt-zu-Punkt gerechnet zappelt die Kurve so stark, dass man nichts
 * erkennt — gemittelt wird deshalb ueber ein Fenster von fuenf Punkten.
 */
export function tempoVerlauf(track) {
  const punkte = track?.punkte
  if (!punkte || punkte.length < 3) return []
  const dist = distanzen(punkte)
  const roh = []
  for (let i = 1; i < punkte.length; i++) {
    const dm = dist[i] - dist[i - 1]
    const dt = punkte[i][P_T] - punkte[i - 1][P_T]
    roh.push({ m: dist[i], kmh: dt > 0 ? dm / dt * 3.6 : 0 })
  }
  const F = 2
  return roh.map((r, i) => {
    let summe = 0, zahl = 0
    for (let k = Math.max(0, i - F); k <= Math.min(roh.length - 1, i + F); k++) {
      summe += roh[k].kmh; zahl++
    }
    return { m: r.m, kmh: summe / zahl }
  })
}

/** Hoehe ueber die Strecke — leer, wenn das Geraet keine Hoehe liefert. */
export function hoehenVerlauf(track) {
  const punkte = track?.punkte
  if (!punkte || punkte.length < 3) return []
  const dist = distanzen(punkte)
  const mitHoehe = punkte
    .map((p, i) => ({ m: dist[i], h: p[P_ALT] }))
    .filter(p => p.h != null)
  return mitHoehe.length >= 3 ? mitHoehe : []
}

/**
 * Eine Kurve als SVG-Pfad in einer Flaeche b x h.
 * Die Y-Achse wird auf den tatsaechlichen Wertebereich gespreizt und nicht bei
 * null begonnen: bei einer Fahrt zwischen 380 und 420 Metern Hoehe waere sonst
 * eine gerade Linie zu sehen.
 */
export function verlaufPfad(werte, schluessel, b, h, rand = 4) {
  if (!werte || werte.length < 2) return { d: '', min: 0, max: 0 }
  const xs = werte.map(w => w.m)
  const ys = werte.map(w => w[schluessel])
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const xSpan = Math.max(xMax - xMin, 1e-6)
  const ySpan = Math.max(yMax - yMin, 1e-6)
  const d = werte.map((w, i) => {
    const px = rand + (w.m - xMin) / xSpan * (b - 2 * rand)
    const py = h - rand - (w[schluessel] - yMin) / ySpan * (h - 2 * rand)
    return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`
  }).join(' ')
  return { d, min: yMin, max: yMax }
}

/** Derselbe Pfad, unten geschlossen — fuer eine gefuellte Flaeche. */
export function verlaufFlaeche(pfad, b, h, rand = 4) {
  if (!pfad) return ''
  const ersterX = pfad.slice(1).split(' ')[0]
  const letzterX = pfad.slice(pfad.lastIndexOf('L') + 1).split(' ')[0]
  return `${pfad} L${letzterX} ${h - rand} L${ersterX} ${h - rand} Z`
}

/**
 * Bestwerte ueber alle Fahrten. Zaehlt nur, was auch belegt ist: fuer das
 * Tempo und die Hoehenmeter braucht es eine Aufzeichnung, eine von Hand
 * eingetragene Fahrt kennt beides nicht.
 */
export function bestwerte(fahrten) {
  const alle = fahrten || []
  const mitSpur = alle.filter(f => f.track?.punkte?.length >= 2)
  const jetzt = new Date()
  const diesenMonat = alle.filter(f => {
    const d = new Date(f.date)
    return d.getFullYear() === jetzt.getFullYear() && d.getMonth() === jetzt.getMonth()
  })

  const groesstes = (liste, wert) =>
    liste.reduce((best, f) => (wert(f) > (best ? wert(best) : -Infinity) ? f : best), null)

  return {
    fahrten: alle.length,
    kmGesamt: Math.round(alle.reduce((s, f) => s + (f.km || 0), 0)),
    kmMonat: Math.round(diesenMonat.reduce((s, f) => s + (f.km || 0), 0)),
    hoehenMeter: Math.round(mitSpur.reduce((s, f) => s + (f.track.hoehenMeter || 0), 0)),
    laengste: groesstes(alle, f => f.km || 0),
    schnellste: groesstes(mitSpur, f => f.track.schnittKmh || 0),
    aufgezeichnet: mitSpur.length,
  }
}
