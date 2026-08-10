import { initLanding } from './landing.js'

export function startApp() {
  document.getElementById('landing').style.display = 'none'
  document.getElementById('quiz-screen').style.display = 'none'
  document.getElementById('drop-container').style.display = 'none'
  document.getElementById('garage-container').style.display = 'none'

  // Direct garage link: ?bike=Iron+883 → opens garage immediately
  const params = new URLSearchParams(window.location.search)
  const bikeName = params.get('bike')
  if (bikeName) {
    import('./garage.js').then(m => m.openBikeGarage(bikeName))
    return
  }

  initLanding()
}
