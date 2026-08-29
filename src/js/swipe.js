/**
 * MotoMatch Swipe — Wischgesten für Zurück und Vorwärts
 *
 * Wischen nach links geht eine Ebene zurück, Wischen nach rechts wieder
 * vorwärts auf den Bildschirm, den man verlassen hat. Beides läuft durch
 * `goBack()`/`goForward()` aus nav.js, also durch denselben Code wie der
 * In-App-Pfeil und die Browser-Knöpfe — die drei Wege können nicht
 * auseinanderlaufen.
 *
 * ── Wo die Geste bewusst NICHT greift ────────────────────────────────────
 *
 * Eine App voller waagerechter Elemente kann nicht jede Querbewegung als
 * Navigation lesen. Ausgenommen sind darum:
 *
 * - **Die Bildschirmränder.** iOS Safari und die Android-Gestennavigation
 *   legen dort ihre eigene Zurück-Geste hin. Reagierten wir mit, ginge es
 *   zwei Ebenen statt einer zurück.
 * - **Waagerecht scrollbare Bereiche** (Kategorie-Leisten, Filter-Pillen,
 *   Radius-Stufen): dort ist die Querbewegung schon vergeben. Erkannt wird
 *   das an der tatsaechlichen Scrollbreite, nicht an einer Klassenliste —
 *   die veraltet beim naechsten neuen Element.
 * - **Karte, 3D-Ansicht, das Karten-Sheet und Eingabefelder**: alle vier
 *   verarbeiten Zeigerbewegungen selbst.
 */

import { goBack, goForward } from './nav.js'

/** Mindeststrecke, damit ein Verrutschen beim Tippen nicht navigiert. */
const MIN_DISTANCE = 70
/** Wie eindeutig waagerecht die Bewegung sein muss (dx zu dy). */
const MIN_RATIO = 1.8
/** Länger gehalten ist kein Wischen mehr, sondern Ziehen. */
const MAX_DURATION = 700
/** Randstreifen, der dem Browser bzw. dem System gehört. */
const EDGE_GUARD = 28
/** Oberhalb dieser Breite gibt es keine Wischgeste — dort sind Maus und Zurück-Pfeil da. */
const MOBILE_MAX = 767

let installed = false

/** Bereich, der die Querbewegung selbst braucht? */
function claimsHorizontal(target) {
  const blocking = 'input, textarea, select, [contenteditable="true"], canvas, ' +
                   '.leaflet-container, .kv-sidebar, .kv-sheet-handle, .gm-style, ' +
                   // Der Feedback-Knopf laesst sich selbst verschieben — ein Zug
                   // nach links waere sonst gleichzeitig ein Schritt zurueck.
                   '.mm-fb-fab'
  if (target.closest?.(blocking)) return true

  // Waagerecht scrollbare Vorfahren: gemessen statt aufgezaehlt.
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

export function initSwipeNav() {
  if (installed) return
  installed = true

  let startX = 0, startY = 0, startT = 0, tracking = false

  document.addEventListener('touchstart', e => {
    tracking = false
    if (window.innerWidth > MOBILE_MAX) return
    if (e.touches.length !== 1) return          // Zwei Finger: Zoomen, nicht Wischen
    const t = e.touches[0]
    if (t.clientX < EDGE_GUARD || t.clientX > window.innerWidth - EDGE_GUARD) return
    if (claimsHorizontal(e.target)) return
    startX = t.clientX
    startY = t.clientY
    startT = Date.now()
    tracking = true
  }, { passive: true })

  document.addEventListener('touchend', e => {
    if (!tracking) return
    tracking = false
    if (Date.now() - startT > MAX_DURATION) return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dx) < MIN_DISTANCE) return
    if (Math.abs(dx) < Math.abs(dy) * MIN_RATIO) return

    // Nach links: eine Ebene zurück. Nach rechts: wieder vorwärts.
    if (dx < 0) goBack()
    else goForward()
  }, { passive: true })

  // Ein abgebrochener Kontakt (eingehender Anruf, Systemgeste) darf keine
  // halbe Geste stehen lassen, die der naechste touchend auswertet.
  document.addEventListener('touchcancel', () => { tracking = false }, { passive: true })
}
