/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — ride-share.js
 *  Eine Fahrt als Bild teilen.
 *
 *  Gebaut wird das Bild im Browser auf einer Zeichenflaeche, aus Daten, die
 *  ohnehin schon auf dem Geraet liegen. Es geht nichts an einen Server: Das
 *  Bild wandert direkt in die Teilen-Auswahl des Systems, und wo die fehlt,
 *  wird es heruntergeladen. Wohin es danach geht, entscheidet allein der
 *  Nutzer.
 *
 *  Bewusst NICHT im Bild: Ortsnamen, Start- und Zieladresse, Koordinaten. Die
 *  Linie zeigt die Form der Strecke, nicht ihre Lage — wer ein geteiltes Bild
 *  sieht, soll daraus nicht die Haustuer ablesen koennen.
 * ══════════════════════════════════════════════════════════════
 */

import { spurPfad, formatiereDauer } from './ride-tracker.js'

const B = 1080, H = 1350   // Hochformat, passt in die ueblichen Verlaeufe

/** Zeichnet die Strecke auf den Kontext — SVG-Pfad waere hier nicht verfuegbar. */
function zeichneSpur(ctx, punkte, x, y, b, h, farbe) {
  const d = spurPfad(punkte, b, h, 24)
  if (!d) return false
  const schritte = d.split(/(?=[ML])/).map(s => {
    const [px, py] = s.slice(1).trim().split(/\s+/).map(Number)
    return { art: s[0], x: x + px, y: y + py }
  })

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Breiter, dunkler Unterstrich: die Linie bleibt auf hellen Stellen lesbar.
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.lineWidth = 16
  ctx.beginPath()
  schritte.forEach(s => s.art === 'M' ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y))
  ctx.stroke()

  ctx.strokeStyle = farbe
  ctx.lineWidth = 9
  ctx.beginPath()
  schritte.forEach(s => s.art === 'M' ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y))
  ctx.stroke()

  // Start und Ziel
  const ersterP = schritte[0], letzterP = schritte[schritte.length - 1]
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.arc(ersterP.x, ersterP.y, 11, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = farbe
  ctx.beginPath(); ctx.arc(ersterP.x, ersterP.y, 6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.arc(letzterP.x, letzterP.y, 11, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#111'
  ctx.beginPath(); ctx.arc(letzterP.x, letzterP.y, 6, 0, Math.PI * 2); ctx.fill()
  return true
}

function schriftart(groesse, gewicht = 400) {
  return `${gewicht} ${groesse}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`
}

/** Baut das Bild zur Fahrt und liefert die Zeichenflaeche. */
export function baueFahrtBild(fahrt) {
  const c = document.createElement('canvas')
  c.width = B; c.height = H
  const ctx = c.getContext('2d')
  const akzent = fahrt.accent || '#e8c56d'

  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, B, H)

  // Kopf
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = schriftart(26, 600)
  ctx.letterSpacing = '6px'
  ctx.fillText('MOTOMATCH', 72, 96)
  ctx.letterSpacing = '0px'

  const datum = new Date(fahrt.date).toLocaleDateString('de-DE', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.font = schriftart(28)
  ctx.fillText(datum, 72, 150)

  // Titel, bis zu zwei Zeilen
  ctx.fillStyle = '#fff'
  ctx.font = schriftart(62, 300)
  const worte = String(fahrt.title || 'Fahrt').split(/\s+/)
  const zeilen = []
  let zeile = ''
  worte.forEach(w => {
    const test = zeile ? `${zeile} ${w}` : w
    if (ctx.measureText(test).width > B - 144 && zeile) { zeilen.push(zeile); zeile = w }
    else zeile = test
  })
  if (zeile) zeilen.push(zeile)
  zeilen.slice(0, 2).forEach((z, i) => ctx.fillText(z, 72, 240 + i * 72))

  // Strecke
  const spurOben = 240 + Math.min(zeilen.length, 2) * 72 + 40
  const spurHoehe = 560
  const hatSpur = fahrt.track?.punkte?.length >= 2
  if (hatSpur) {
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(72, spurOben, B - 144, spurHoehe)
    zeichneSpur(ctx, fahrt.track.punkte, 72, spurOben, B - 144, spurHoehe, akzent)
  }

  // Zahlen
  const zahlenOben = hatSpur ? spurOben + spurHoehe + 90 : spurOben + 140
  const werte = [
    [`${(fahrt.km || 0).toLocaleString('de-DE')}`, 'Kilometer'],
  ]
  if (fahrt.track?.fahrMs) werte.push([formatiereDauer(fahrt.track.fahrMs), 'Fahrzeit'])
  else if (fahrt.hours) werte.push([`${fahrt.hours}`, 'Stunden'])
  if (fahrt.track?.schnittKmh) werte.push([`${Math.round(fahrt.track.schnittKmh)}`, 'km/h ø'])

  const spaltenBreite = (B - 144) / werte.length
  werte.forEach(([wert, label], i) => {
    const x = 72 + i * spaltenBreite
    ctx.fillStyle = '#fff'
    ctx.font = schriftart(66, 300)
    ctx.fillText(wert, x, zahlenOben)
    ctx.fillStyle = 'rgba(255,255,255,0.38)'
    ctx.font = schriftart(24)
    ctx.fillText(label, x, zahlenOben + 40)
  })

  // Fuss
  ctx.fillStyle = akzent
  ctx.fillRect(72, H - 118, 64, 3)
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.font = schriftart(24)
  ctx.fillText('motomatch.studio', 72, H - 72)

  return c
}

/** Kurztext zur Fahrt — fuer Nachrichten, die kein Bild annehmen. */
export function fahrtText(fahrt) {
  const teile = [`${fahrt.title} — ${(fahrt.km || 0).toLocaleString('de-DE')} km`]
  if (fahrt.track?.fahrMs) teile.push(`${formatiereDauer(fahrt.track.fahrMs)} Fahrzeit`)
  else if (fahrt.hours) teile.push(`${fahrt.hours} h`)
  if (fahrt.track?.schnittKmh) teile.push(`ø ${Math.round(fahrt.track.schnittKmh)} km/h`)
  return `${teile.join(' · ')}\nAufgezeichnet mit MotoMatch`
}

function alsDatei(canvas, name) {
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      resolve(blob ? new File([blob], name, { type: 'image/png' }) : null)
    }, 'image/png')
  })
}

/**
 * Teilt die Fahrt. Gibt zurueck, was tatsaechlich passiert ist, damit der
 * Aufrufer die richtige Rueckmeldung zeigen kann.
 * @returns {Promise<'geteilt'|'abgebrochen'|'geladen'>}
 */
export async function teileFahrt(fahrt) {
  const canvas = baueFahrtBild(fahrt)
  const name = `motomatch-${String(fahrt.title || 'fahrt').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.png`
  const datei = await alsDatei(canvas, name)
  const text = fahrtText(fahrt)

  /* canShare mit der konkreten Datei fragen, nicht nur auf navigator.share
     pruefen: Desktop-Browser koennen teilen, lehnen aber Dateien ab — ohne
     diese Pruefung wirft share() dort einen Fehler statt zu teilen. */
  if (datei && navigator.canShare?.({ files: [datei] })) {
    try {
      await navigator.share({ files: [datei], text })
      return 'geteilt'
    } catch (err) {
      if (err?.name === 'AbortError') return 'abgebrochen'
      // sonst faellt es unten auf den Download zurueck
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: `MotoMatch — ${fahrt.title}`, text })
      return 'geteilt'
    } catch (err) {
      if (err?.name === 'AbortError') return 'abgebrochen'
    }
  }

  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = name
  a.click()
  return 'geladen'
}
