import './styles/main.css'
import { initMonitoring, reportFatal } from './js/monitoring.js'

// Zuerst, vor allem anderen: was hier drunter schiefgeht, soll gemeldet werden —
// auch ein Fehler beim Auswerten von app.js selbst. Stand vorher in startApp(),
// also innerhalb genau des Aufrufs, den es absichern soll.
initMonitoring()

/**
 * Sichtbare Meldung, wenn der Start scheitert.
 *
 * Ohne das bleibt ein weißer Bildschirm stehen und niemand weiß, ob die App
 * noch lädt oder kaputt ist. Bewusst mit Inline-Styles und als Overlay obenauf:
 * die Stylesheets können mit ausgefallen sein, und ein halb aufgebauter
 * Bildschirm soll nicht zusätzlich weggeräumt werden — was schon da ist, kann
 * für die Fehlersuche noch nützlich sein.
 */
function showBootFailure() {
  try {
    if (document.getElementById('boot-failure')) return
    const box = document.createElement('div')
    box.id = 'boot-failure'
    box.setAttribute('role', 'alert')
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;' +
      'background:#0a0a0a;color:#f5f5f5;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif'

    const title = document.createElement('p')
    title.textContent = 'MotoMatch konnte nicht starten.'
    title.style.cssText = 'margin:0;font-size:20px;font-weight:600'

    const hint = document.createElement('p')
    hint.textContent = 'Bitte lade die Seite neu. Klappt es dann immer noch nicht, versuch es in ein paar Minuten noch einmal.'
    hint.style.cssText = 'margin:0;max-width:36ch;opacity:.75'

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Neu laden'
    btn.style.cssText = 'padding:12px 24px;border:0;border-radius:8px;background:#f5f5f5;' +
      'color:#0a0a0a;font:inherit;font-weight:600;cursor:pointer'
    btn.addEventListener('click', () => window.location.reload())

    box.append(title, hint, btn)
    document.body.appendChild(box)
  } catch {
    // Wenn nicht einmal das DOM mitspielt, bleibt die Konsole — reportFatal
    // oben hat den eigentlichen Fehler da schon abgelegt.
  }
}

// Dynamisch statt statisch importiert, damit das .catch() auch Fehler *beim
// Auswerten* von app.js und seiner Importkette fängt. Bei einem statischen
// Import würde ein kaputtes Modul irgendwo in den ~30 darunter schon main.js
// mitreißen — dann liefe hier nichts mehr, auch kein try/catch. Kostet einen
// zusätzlichen Chunk-Abruf beim ersten Laden; in der Beta ist mir das den
// Unterschied zwischen „weißer Bildschirm“ und „gemeldeter Fehler“ wert.
import('./js/app.js')
  .then(({ startApp }) => startApp())
  .catch(err => {
    reportFatal(err, { where: 'main.bootstrap' })
    showBootFailure()
  })
