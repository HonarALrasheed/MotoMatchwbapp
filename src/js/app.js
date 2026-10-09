import { initLanding } from './landing.js'
import { findBikeByShortName, ladeVollkatalog, getCatalog, findBestBike } from './matching.js'
import { initSupabaseAuth, openPasswordResetScreen } from './auth.js'
import { initFeedbackFab } from './feedback.js'
import { initNav, setViewResolver, readRestoreState, clearRestoreView, rebuild } from './nav.js'
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
  if (!view?.bike || typeof view.bike !== 'string') return false
  if (view.screen === 'match-result') {
    try {
      await ladeVollkatalog()
      const { getLastAnswers } = await import('./match-history.js')
      const answers = getLastAnswers()
      if (!answers || findBestBike(answers)?.name !== view.bike) return false
      const { loadGarage } = await import('./garage.js')
      loadGarage(answers)
      await new Promise(resolve => setTimeout(resolve, 280))
      return document.getElementById('garage-container')?.style.display !== 'none'
    } catch (err) {
      console.error('[app] Match-Ergebnis konnte nicht wiederhergestellt werden:', err)
      return false
    }
  }
  if (view.screen === 'deckblatt') {
    const { openBikeDetail } = await import('./bike-detail.js')
    // openBikeDetail accepts only its fixed, reviewed catalogue identifiers.
    // Unknown or removed destinations fall back to the landing page.
    openBikeDetail(view.bike)
    await new Promise(resolve => setTimeout(resolve, 280))
    return document.getElementById('bike-detail')?.style.display !== 'none'
  }
  if (view.screen === 'konfigurator') {
    // Vor dem Finden auf den Vollkatalog warten: ein gleichnamiges Seed-Bike
    // kann dieselbe Anzeige, aber unvollständige oder abweichende Daten haben.
    // Sonst würde ein Resume vor dem Idle-Import falsche technische Werte zeigen.
    await ladeVollkatalog()
    /* matching.js wird von landing.js ohnehin statisch geladen und liegt damit
       schon im Start-Bundle — der dynamische Import hier brachte kein eigenes
       Stueck Code, nur eine Build-Warnung. */
    const { openKonfigurator } = await import('./bike-detail.js')
    const bikeData = findBikeByShortName(view.bike)
    if (!bikeData) return false
    openKonfigurator(bikeData, null, view.tab, { restoring: true })
    await new Promise(resolve => setTimeout(resolve, 280))
    return true
  }
  if (view.screen !== 'garage') return false
  if (!findBikeByShortName(view.bike)) await ladeVollkatalog()
  // Garage ist der Einstieg, der ohne Quiz-Antworten auskommt.
  const { openBikeGarage } = await import('./garage.js')
  openBikeGarage(view.bike)
  await new Promise(resolve => setTimeout(resolve, 280))
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
  // Karte vorwärmen, sobald der Karten-Reiter in Reichweite ist (Zeiger drauf,
  // Fokus, Antippen) — MapLibre und der Stil sind dann schon da, wenn er aufgeht.
  let karteGewaermt = false
  const karteWaermen = (e) => {
    if (karteGewaermt || !e.target.closest?.('[data-tab="karte"]')) return
    karteGewaermt = true
    import('./karte.js').then((m) => m.karteVorwaermen()).catch(() => { karteGewaermt = false })
  }
  for (const typ of ['pointerover', 'pointerdown', 'focusin']) document.addEventListener(typ, karteWaermen, { passive: true })
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

  // Direktlinks in die Garage eines Bikes:
  //   ?motorrad=<slug>  von den statischen Katalogseiten (scripts/seo-seiten.mjs) — eindeutig
  //   ?bike=Iron+883    ältere Form über den Namen
  // Beide warten auf den Vollkatalog, der sonst erst im Leerlauf lädt: ohne ihn kennt die App
  // nur die Bikes mit Foto, und ein Link auf eins der übrigen landete bei "Bike nicht gefunden".
  const params = new URLSearchParams(window.location.search)
  const slug = params.get('motorrad')
  if (slug) {
    const gesucht = slug.toLowerCase().replace(/_/g, '-')
    Promise.all([ladeVollkatalog(), import('./garage.js')])
      .then(([, m]) => {
        const bike = getCatalog().find(b => String(b.slug || '').toLowerCase().replace(/_/g, '-') === gesucht)
        if (bike) m.openBikeGarage(bike)
        else { clearRestoreView(); initLanding() }
      })
      .catch(err => {
        console.error('[app] Direktlink konnte nicht geladen werden:', err)
        clearRestoreView()
        initLanding()
      })
    return
  }
  const bikeName = params.get('bike')
  if (bikeName) {
    Promise.all([ladeVollkatalog(), import('./garage.js')])
      .then(([, m]) => {
        if (findBikeByShortName(bikeName)) m.openBikeGarage(bikeName)
        else { clearRestoreView(); initLanding() }
      })
      .catch(err => {
        console.error('[app] Direktlink konnte nicht geladen werden:', err)
        clearRestoreView()
        initLanding()
      })
    return
  }

  // Geteilte Strecke (#strecke=… aus eigene-strecken.js): in "Meine" übernehmen
  // und direkt die Karte öffnen. Der Link enthält die Strecke selbst.
  if (/[#&]strecke=/.test(window.location.hash)) {
    sessionStorage.setItem('mm_strecke_import', window.location.hash)
    history.replaceState(history.state, '', window.location.pathname + window.location.search)
    initLanding()
    window.dispatchEvent(new CustomEvent('mm:open-karte', { detail: {} }))
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
  const saved = readRestoreState()
  if (saved) {
    rebuild(saved.view, saved.scrollY)
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
