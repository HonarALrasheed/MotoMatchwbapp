/**
 * MotoMatch Viewport — Bildschirmtastatur browserübergreifend gleich behandeln
 *
 * Chromium (Edge/Chrome auf Android) verkleinert beim Öffnen der Tastatur das
 * Layout-Viewport: `100dvh` schrumpft, die Eingabezeile bleibt über der
 * Tastatur stehen, `position: fixed`-Leisten rutschen mit nach oben. WebKit —
 * und damit *jeder* Browser auf dem iPhone, auch Chrome und Edge — macht das
 * nicht: das Layout bleibt bildschirmhoch, die Tastatur legt sich darüber, und
 * Safari schiebt zusätzlich die ganze Seite nach oben, obwohl html/body auf
 * `overflow: hidden` stehen. Sichtbar wird das als verrutschte Kopfzeile und
 * einer Eingabezeile, die unter der Tastatur verschwindet.
 *
 * Gemessen wird die Tastaturhöhe über `window.visualViewport`; sie landet als
 * CSS-Variable `--kb-inset` auf <html>, dazu `kb-open` auf <body>. Die Rechnung
 * ist selbstneutralisierend: verkleinert ein Browser das Layout bereits selbst,
 * schrumpft `window.innerHeight` mit und es bleiben 0px — dort ändert sich also
 * nichts. Wer die Variable auswertet, steht im Tastatur-Block am Ende von
 * main.css.
 */

/** Unterhalb dieser Breite greifen die Tastatur-Regeln in main.css. */
const MOBILE_MAX = 767

let _initialised = false

export function initViewport() {
  if (_initialised) return
  _initialised = true

  const root = document.documentElement
  const vv = window.visualViewport
  // Ohne visualViewport (sehr alte Browser) bleibt --kb-inset schlicht 0px —
  // exakt der Zustand von vorher, kein Sonderfall nötig.
  if (!vv) return

  let last = -1

  const apply = () => {
    // offsetTop kommt dazu, weil WebKit das visuelle Viewport beim Fokus
    // zusätzlich nach oben schiebt, statt es nur zu verkleinern.
    const raw = window.innerHeight - vv.height - vv.offsetTop
    // Unter ~120px ist es keine Tastatur, sondern die ein-/ausfahrende
    // Browserleiste beim Scrollen — die darf das Layout nicht anfassen.
    const inset = raw > 120 && window.innerWidth <= MOBILE_MAX ? Math.round(raw) : 0
    if (inset === last) return
    last = inset
    root.style.setProperty('--kb-inset', inset + 'px')
    document.body.classList.toggle('kb-open', inset > 0)

    // Der Chat wird durch die schrumpfende Höhe oben abgeschnitten: ohne das
    // hier bleibt der Blick auf der Mitte des Verlaufs stehen, statt auf der
    // Nachricht, auf die gerade geantwortet wird. Erst nach dem Layout-Schritt,
    // sonst rechnet der Browser noch mit der alten Höhe.
    if (inset > 0) {
      requestAnimationFrame(() => {
        const msgs = document.getElementById('mmc-messages')
        if (msgs) msgs.scrollTop = msgs.scrollHeight
      })
    }
  }

  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  window.addEventListener('orientationchange', () => setTimeout(apply, 250))

  // Safari scrollt das Fenster beim Fokus in ein Feld nach oben, auch wenn es
  // (overflow: hidden) gar nichts zu scrollen gibt. Das Layout wandert dann um
  // die Tastaturhöhe aus dem Bild. Zurücksetzen, sobald das Feld verlassen wird.
  window.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        window.scrollTo(0, 0)
      }
      apply()
    }, 60)
  })

  apply()
}
