/**
 * MotoMatch — Onboarding Tour
 * Shown on first visit. 3-step walkthrough of key features.
 */
const ONBOARDING_KEY = 'mm_onboarded_v1'

const STEPS = [
  {
    eyebrow: 'Willkommen',
    title: 'Willkommen bei MotoMatch',
    text: 'Finde dein perfektes Motorrad, vergleiche Modelle und triff Gleichgesinnte — alles an einem Ort.',
    cta: 'Los geht\'s',
  },
  {
    eyebrow: 'Match-Quiz',
    title: 'Dein perfektes Match',
    text: 'Beantworte ein paar Fragen zu deinem Fahrstil und wir empfehlen dir passende Bikes plus Ausrüstung.',
    cta: 'Weiter',
  },
  {
    eyebrow: 'Community & Karte',
    title: 'Bleib vernetzt',
    text: 'Tausche dich aus, finde Touren, Werkstätten in deiner Nähe und tracke deine Fahrten.',
    cta: 'Starten',
  },
]

export function maybeShowOnboarding() {
  try {
    if (localStorage.getItem(ONBOARDING_KEY) === '1') return
  } catch {}
  // Defer slightly to avoid jank during initial load
  setTimeout(showOnboarding, 800)
}

function showOnboarding() {
  if (document.getElementById('ob-overlay')) return
  let step = 0
  const overlay = document.createElement('div')
  overlay.id = 'ob-overlay'
  overlay.className = 'ob-overlay'
  overlay.innerHTML = `
    <div class="ob-backdrop"></div>
    <div class="ob-card">
      <button class="ob-skip" id="ob-skip">Überspringen</button>
      <div class="ob-content" id="ob-content"></div>
      <div class="ob-dots" id="ob-dots"></div>
    </div>
  `
  document.body.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('ob-overlay--open'))

  const render = () => {
    const s = STEPS[step]
    const c = document.getElementById('ob-content')
    if (c) {
      const num = String(step + 1).padStart(2, '0')
      const total = String(STEPS.length).padStart(2, '0')
      c.innerHTML = `
        <div class="ob-step">${num} <i>/ ${total}</i> &nbsp;·&nbsp; ${s.eyebrow}</div>
        <h2 class="ob-title">${s.title}</h2>
        <p class="ob-text">${s.text}</p>
        <button class="ob-cta" id="ob-cta">${s.cta}${step < STEPS.length - 1 ? ' <span class="ob-cta-arrow">→</span>' : ''}</button>
      `
      c.classList.remove('ob-content--anim')
      void c.offsetWidth
      c.classList.add('ob-content--anim')
    }
    const dots = document.getElementById('ob-dots')
    if (dots) {
      dots.innerHTML = STEPS.map((_, i) => `<span class="ob-dot ${i === step ? 'ob-dot--active' : ''}"></span>`).join('')
    }
    document.getElementById('ob-cta')?.addEventListener('click', () => {
      if (step < STEPS.length - 1) { step++; render() }
      else finish()
    })
  }
  const finish = () => {
    overlay.classList.remove('ob-overlay--open')
    setTimeout(() => overlay.remove(), 280)
    try { localStorage.setItem(ONBOARDING_KEY, '1') } catch {}
  }
  document.getElementById('ob-skip')?.addEventListener('click', finish)
  render()
}
