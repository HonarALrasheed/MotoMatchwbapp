import { initLanding } from './landing.js'
import { findBikeByShortName, ladeVollkatalog } from './matching.js'
import { initSupabaseAuth, openPasswordResetScreen } from './auth.js'
import { initFeedbackFab } from './feedback.js'
import { initNav, setViewResolver, readRestoreView, clearRestoreView, rebuild } from './nav.js'
import { initSwipeNav } from './swipe.js'
import { initViewport } from './viewport.js'
import { initInstall } from './install.js'

/**
 * Aus einer view-Beschreibung (nav.js) wieder den Bildschirm bauen.
 *
 * Ein Ort für zwei Wege: die Vorwärts-Navigation und die Wiederherstellung
 * nach dem Neuladen. Gibt eine Zusage zurück, damit nav.js weiss, wann der
 * Aufbau durch ist — die Bildschirm-Module werden nachgeladen.
 *
 * @returns {Promise<boolean>} false, wenn sich die Beschreibung nicht
 *          aufloesen laesst (Bike aus dem Katalog verschwunden o. Ae.).
 */
async function openView(view) {
  if (!view?.bike) return false
  if (view.screen === 'konfigurator') {
    /* matching.js wird von landing.js ohnehin statisch geladen und liegt damit
       schon im Start-Bundle — der dynamische Import hier brachte kein eigenes
       Stueck Code, nur eine Build-Warnung. */
    const { openKonfigurator } = await import('./bike-detail.js')
    const bikeData = findBikeByShortName(view.bike)
    if (!bikeData) return false
    openKonfigurator(bikeData, null, view.tab)
    return true
  }
  // Garage und Deckblatt führen beide über die Garage-Seite des Bikes — der
  // einzige Einstieg, der ohne Quiz-Antworten auskommt.
  const { openBikeGarage } = await import('./garage.js')
  openBikeGarage(view.bike)
  return true
}

export function startApp() {
  // Misst die Bildschirmtastatur und legt sie als --kb-inset ab; muss stehen,
  // bevor der erste Bildschirm ein Eingabefeld rendert.
  initViewport()
  // Vor allem anderen: der popstate-Handler muss stehen, bevor irgendein
  // Bildschirm einen History-Eintrag anlegen kann.
  initNav()
  // Muss vor dem ersten Bildschirmwechsel stehen: ohne Auflöser kann nav.js
  // beim Vorwärts nichts aufbauen.
  setViewResolver(openView)
  initSwipeNav()
  /* Den Katalog des deutschen Marktes (public/data/katalog-de.json) im Hintergrund holen,
     damit er dasteht, wenn das Quiz fertig ist. Schlägt es fehl, rechnet die Seite mit den
     eingebauten Bikes weiter (matching.js).
     Erst nach dem load-Ereignis und im Leerlauf: gleich beim Start konkurrierte die Datei
     (ca. 900 KB, gepackt ~150 KB) auf dem Handy mit dem Aufbau der Startseite um die Leitung —
     gemessen bei langsamem 4G ~0,7 s später sichtbarer Hero. Wer ihn früher braucht, stößt ihn
     selbst an (ladeVollkatalog() ist idempotent): das Quiz, die Suchfelder, Direktlinks. */
  const katalogImLeerlauf = () =>
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => ladeVollkatalog(), { timeout: 3000 })
  if (document.readyState === 'complete') katalogImLeerlauf()
  else window.addEventListener('load', katalogImLeerlauf, { once: true })
  initSupabaseAuth()
  initFeedbackFab()
  // Registriert den Service Worker und bietet die Installation an — nur so
  // laeuft die App auf dem Handy im Vollbild ohne Browserleiste.
  initInstall()
  if (new URLSearchParams(window.location.search).get('reset') === '1') {
    openPasswordResetScreen()
  }
  document.getElementById('landing').style.display = 'none'
  document.getElementById('quiz-screen').style.display = 'none'
  document.getElementById('drop-container').style.display = 'none'
  document.getElementById('garage-container').style.display = 'none'

  // Direct garage link: ?bike=Iron+883 → opens garage immediately
  const params = new URLSearchParams(window.location.search)
  const bikeName = params.get('bike')
  if (bikeName) {
    import('./garage.js')
      .then(m => m.openBikeGarage(bikeName))
      .catch(err => {
        console.error('[app] Direktlink konnte nicht geladen werden:', err)
        initLanding()
      })
    return
  }

  // Nach dem Neuladen dort weitermachen, wo man war. Ohne das landete jeder
  // Reload auf der Startseite, weil alle Bildschirme dieselbe Adresse haben.
  // Der Eintrag steckt in sessionStorage: er ueberlebt das Neuladen, aber
  // nicht das Schliessen des Tabs — ein Bike von vorgestern beim Neustart
  // waere keine Wiederherstellung mehr, sondern eine Ueberraschung.
  // Über nav.js' rebuild() statt direkt über openView(): nur so setzt nav.js
  // sein `restoring`-Flag, bevor der wiederhergestellte Bildschirm sich per
  // enterScreen() anmeldet — sonst legt das einen zweiten, doppelten
  // History-Eintrag an, statt den bestehenden Eintrag zu übernehmen.
  const saved = readRestoreView()
  if (saved) {
    rebuild(saved)
      .then(ok => { if (!ok) { clearRestoreView(); initLanding() } })
      .catch(err => {
        console.error('[app] Ansicht konnte nicht wiederhergestellt werden:', err)
        clearRestoreView()
        initLanding()
      })
    return
  }

  initLanding()
}
