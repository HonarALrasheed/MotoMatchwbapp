/**
 * MotoMatch Install — Vollbild auf dem Handy
 *
 * Eine Website in einem normalen Browser-Tab kann sich den Bildschirm nicht
 * selbst nehmen: die Adressleiste gehoert dem Browser. Den ganzen Schirm gibt
 * es nur als **installierte** Web-App — dann startet MotoMatch ohne Adress-
 * und Reiterleiste, auf Android wie auf dem iPhone.
 *
 * Die beiden Engines kommen unterschiedlich dorthin:
 * - Chromium (Edge/Chrome/Samsung, Android) meldet `beforeinstallprompt`,
 *   sobald Manifest, Icons und Service Worker stimmen. Daraus wird ein
 *   richtiger Knopf, der den Systemdialog oeffnet.
 * - WebKit (iPhone — Safari, Chrome, Edge und Firefox nutzen dort dieselbe
 *   Engine) kennt kein solches Ereignis. Apple laesst nur den Weg ueber
 *   "Teilen → Zum Home-Bildschirm", also zeigt der Hinweis genau den.
 *
 * Firefox auf Android kennt `beforeinstallprompt` ebenfalls nicht, hat aber
 * einen eigenen Eintrag im Menue — dort greift derselbe manuelle Hinweis.
 */

import { registerServiceWorker } from './push.js'

/** Einmal weggeklickt bleibt der Hinweis weg. Konvention: mm_ + Version. */
const DISMISS_KEY = 'mm_install_hint_v1'
/** Erst zeigen, wenn jemand wirklich in der App ist — nicht beim ersten Blick. */
const DELAY_MS = 20000

let _deferredPrompt = null
let _shown = false

/** Laeuft die App bereits installiert, also im Vollbild? */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    // iOS meldet den installierten Zustand ueber diese eigene Eigenschaft,
    // display-mode blieb dort lange auf 'browser'.
    || navigator.standalone === true
}

/** WebKit auf einem Touchgeraet — also iPhone/iPad, unabhaengig vom Browser. */
function isIOS() {
  return CSS.supports('-webkit-touch-callout: none')
    && window.matchMedia('(pointer: coarse)').matches
}

function dismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

function dismiss() {
  try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
  document.querySelector('.mm-install')?.remove()
}

function render({ canPrompt }) {
  if (_shown || document.querySelector('.mm-install')) return
  _shown = true

  const el = document.createElement('div')
  el.className = 'mm-install'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', 'MotoMatch installieren')
  el.innerHTML = `
    <div class="mm-install-icon"><img src="/icon-192.png" alt="" width="40" height="40"></div>
    <div class="mm-install-text">
      <strong>MotoMatch als App</strong>
      <span>${canPrompt
        ? 'Startet im Vollbild, ohne Browserleiste.'
        : 'Teilen-Symbol antippen, dann &bdquo;Zum Home-Bildschirm&ldquo; &mdash; startet danach im Vollbild.'}</span>
    </div>
    ${canPrompt ? '<button class="mm-install-go" type="button">Installieren</button>' : ''}
    <button class="mm-install-x" type="button" aria-label="Hinweis schließen">&times;</button>
  `

  el.querySelector('.mm-install-x').addEventListener('click', dismiss)
  el.querySelector('.mm-install-go')?.addEventListener('click', async () => {
    if (!_deferredPrompt) return
    _deferredPrompt.prompt()
    const { outcome } = await _deferredPrompt.userChoice
    _deferredPrompt = null
    // Auch ein "spaeter" ist eine Antwort — der Hinweis hat seinen Zweck
    // erfuellt und muss nicht beim naechsten Start wieder auftauchen.
    if (outcome) dismiss()
  })

  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('mm-install--in'))
}

export function initInstall() {
  // Der Service Worker ist Teil von Chromiums Pruefliste fuer die
  // Installierbarkeit — ohne ihn kaeme `beforeinstallprompt` nie. Er lief
  // bisher nur, wenn jemand Push aktiviert hat.
  registerServiceWorker()

  if (isStandalone()) return          // laeuft schon im Vollbild
  if (dismissed()) return
  if (!window.matchMedia('(pointer: coarse)').matches) return  // nur Touchgeraete

  window.addEventListener('beforeinstallprompt', e => {
    // Ohne preventDefault zeigt Chromium seinen eigenen Mini-Balken; der
    // gespeicherte Event laesst sich spaeter aus einer echten Nutzeraktion
    // heraus ausloesen, was der Systemdialog verlangt.
    e.preventDefault()
    _deferredPrompt = e
    setTimeout(() => render({ canPrompt: true }), DELAY_MS)
  })

  window.addEventListener('appinstalled', dismiss)

  if (isIOS()) setTimeout(() => render({ canPrompt: false }), DELAY_MS)
}
