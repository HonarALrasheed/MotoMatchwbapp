/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — avatar-zuschnitt.js
 *  Profilbild zuschneiden, bevor es gespeichert wird.
 *
 *  Vorher wurde die gewaehlte Datei einfach verkleinert und mittig in einen
 *  Kreis gesteckt. Bei einem Hochformat-Foto war dann der Bauch im Kreis und
 *  der Kopf daneben. Hier waehlt der Nutzer den Ausschnitt selbst: schieben,
 *  zoomen, uebernehmen.
 *
 *  Nichts davon verlaesst das Geraet — gelesen wird die Datei ueber eine
 *  lokale Objekt-URL, gezeichnet wird auf einer Zeichenflaeche im Browser.
 *  Zurueck kommt ein quadratisches JPEG als Data-URL.
 * ══════════════════════════════════════════════════════════════
 */

const AUSGABE_PX = 512     // Kantenlaenge des Ergebnisses
const GUETE = 0.82         // JPEG-Guete; 512px bei 0.82 bleibt klar unter 150 KB
const ZOOM_MAX = 4

/**
 * Oeffnet das Zuschneide-Fenster.
 *
 * Abbruch und Lesefehler sind zwei verschiedene Dinge: beim Abbruch will der
 * Nutzer keine Meldung sehen, bei einer kaputten Datei schon. Deshalb ein
 * Ergebnis mit beiden Angaben statt zweier Bedeutungen fuer null.
 *
 * @param {File} datei
 * @returns {Promise<{bild: string|null, lesbar: boolean}>}
 */
export function avatarZuschneiden(datei) {
  return new Promise(fertig => {
    const url = URL.createObjectURL(datei)
    const bild = new Image()
    bild.onerror = () => { URL.revokeObjectURL(url); fertig({ bild: null, lesbar: false }) }
    bild.onload = () => baueFenster(bild, url, b => fertig({ bild: b, lesbar: true }))
    bild.src = url
  })
}

function baueFenster(bild, url, fertig) {
  const nw = bild.naturalWidth
  const nh = bild.naturalHeight
  if (!nw || !nh) { URL.revokeObjectURL(url); fertig(null); return }


  /* Die Buehne ist quadratisch und zugleich der Ausschnitt. Sie muss auf den
     Bildschirm passen, ohne dass die Knoepfe darunter wegrutschen. */
  const S = Math.max(200, Math.min(
    window.innerWidth - 48,
    window.innerHeight - 260,
    420,
  ))

  const overlay = document.createElement('div')
  overlay.className = 'av-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Profilbild zuschneiden')
  overlay.innerHTML = `
    <div class="av-box">
      <p class="av-titel">Ausschnitt wählen</p>
      <p class="av-hinweis">Schieben, mit zwei Fingern größer ziehen</p>
      <div class="av-buehne" style="width:${S}px;height:${S}px">
        <div class="av-maske"></div>
      </div>
      <div class="av-aktionen">
        <button type="button" class="av-btn av-btn--still" data-av="abbrechen">Abbrechen</button>
        <button type="button" class="av-btn av-btn--haupt" data-av="ok">Übernehmen</button>
      </div>
    </div>
  `
  const buehne = overlay.querySelector('.av-buehne')
  bild.className = 'av-bild'
  bild.alt = ''
  buehne.insertBefore(bild, buehne.firstChild)

  /* Vollbild braucht einen Vorfahren ohne transform — .acc-panel hat einen,
     und der wuerde position:fixed auf das Panel beziehen statt auf das
     Fenster. Deshalb direkt an <body>. */
  document.body.appendChild(overlay)
  document.body.classList.add('av-offen')

  // Anfangsgroesse: das Bild deckt die Buehne gerade vollstaendig ab
  const grund = Math.max(S / nw, S / nh)
  let z = 1
  let tx = (S - nw * grund) / 2
  let ty = (S - nh * grund) / 2

  const massstab = () => grund * z

  const begrenzen = () => {
    const s = massstab()
    const w = nw * s, h = nh * s
    // w und h sind nie kleiner als S, das Bild kann also keine Luecke lassen
    tx = Math.min(0, Math.max(S - w, tx))
    ty = Math.min(0, Math.max(S - h, ty))
  }

  const zeichnen = () => {
    const s = massstab()
    begrenzen()
    bild.style.width = `${nw * s}px`
    bild.style.height = `${nh * s}px`
    bild.style.transform = `translate(${tx}px, ${ty}px)`
  }

  /** Zoomt so, dass der Punkt unter (ax, ay) an seiner Stelle bleibt. */
  const zoomeAuf = (zNeu, ax, ay) => {
    const zAlt = z
    z = Math.min(ZOOM_MAX, Math.max(1, zNeu))
    if (z === zAlt) return
    const sAlt = grund * zAlt, sNeu = grund * z
    tx = ax - (ax - tx) / sAlt * sNeu
    ty = ay - (ay - ty) / sAlt * sNeu
    zeichnen()
  }

  // ── Schieben und Zusammenziehen ────────────────────────────────────────
  const zeiger = new Map()
  let letzterAbstand = 0

  const mitte = () => {
    const p = [...zeiger.values()]
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }
  }
  const abstand = () => {
    const p = [...zeiger.values()]
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
  }
  const lokal = (e) => {
    const r = buehne.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  buehne.addEventListener('pointerdown', e => {
    buehne.setPointerCapture(e.pointerId)
    zeiger.set(e.pointerId, lokal(e))
    if (zeiger.size === 2) letzterAbstand = abstand()
  })

  buehne.addEventListener('pointermove', e => {
    if (!zeiger.has(e.pointerId)) return
    e.preventDefault()
    const vorher = zeiger.get(e.pointerId)
    const jetzt = lokal(e)
    zeiger.set(e.pointerId, jetzt)

    if (zeiger.size === 1) {
      tx += jetzt.x - vorher.x
      ty += jetzt.y - vorher.y
      zeichnen()
      return
    }
    if (zeiger.size >= 2) {
      const neuerAbstand = abstand()
      if (letzterAbstand > 0) {
        const m = mitte()
        zoomeAuf(z * (neuerAbstand / letzterAbstand), m.x, m.y)
      }
      letzterAbstand = neuerAbstand
    }
  })

  const zeigerWeg = e => {
    zeiger.delete(e.pointerId)
    if (zeiger.size < 2) letzterAbstand = 0
  }
  buehne.addEventListener('pointerup', zeigerWeg)
  buehne.addEventListener('pointercancel', zeigerWeg)

  buehne.addEventListener('wheel', e => {
    e.preventDefault()
    const p = lokal(e)
    zoomeAuf(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), p.x, p.y)
  }, { passive: false })

  // ── Abschluss ──────────────────────────────────────────────────────────
  let erledigt = false
  const schliessen = (ergebnis) => {
    if (erledigt) return
    erledigt = true
    document.removeEventListener('keydown', beiTaste)
    document.body.classList.remove('av-offen')
    overlay.remove()
    URL.revokeObjectURL(url)
    fertig(ergebnis)
  }

  const uebernehmen = () => {
    const s = massstab()
    const c = document.createElement('canvas')
    c.width = c.height = AUSGABE_PX
    const ctx = c.getContext('2d')
    /* JPEG kennt keine Transparenz; ohne Grund waere ein durchsichtiges PNG
       hinterher schwarz. */
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, AUSGABE_PX, AUSGABE_PX)
    ctx.imageSmoothingQuality = 'high'
    // Der sichtbare Ausschnitt in den Massen des Originals
    ctx.drawImage(bild, -tx / s, -ty / s, S / s, S / s, 0, 0, AUSGABE_PX, AUSGABE_PX)
    schliessen(c.toDataURL('image/jpeg', GUETE))
  }

  function beiTaste(e) {
    if (e.key === 'Escape') { e.preventDefault(); schliessen(null) }
    if (e.key === 'Enter') { e.preventDefault(); uebernehmen() }
  }
  document.addEventListener('keydown', beiTaste)

  overlay.addEventListener('click', e => {
    const was = e.target.closest('[data-av]')?.dataset.av
    if (was === 'abbrechen') schliessen(null)
    else if (was === 'ok') uebernehmen()
    else if (e.target === overlay) schliessen(null)
  })

  zeichnen()
  overlay.querySelector('[data-av="ok"]').focus()
}
