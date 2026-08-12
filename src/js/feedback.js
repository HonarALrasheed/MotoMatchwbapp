/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — Beta-Feedback-Kanal
 *
 *  Floating Action Button rechts unten, öffnet ein Modal mit Textarea.
 *  Submit → INSERT in `beta_feedback` (Supabase). Im OFFLINE_MODE
 *  Fallback in `mm_beta_feedback_local` (für Dev ohne Keys).
 * ══════════════════════════════════════════════════════════════════
 */

import { supabase, OFFLINE_MODE } from './supabase.js'
import { currentUser, getSession } from './auth.js'

const LS_LOCAL = 'mm_beta_feedback_local'
const MIN_LEN = 20
const MAX_LEN = 2000

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function initFeedbackFab() {
  if (document.getElementById('mm-fb-fab')) return
  const fab = document.createElement('button')
  fab.id = 'mm-fb-fab'
  fab.type = 'button'
  fab.className = 'mm-fb-fab'
  fab.setAttribute('aria-label', 'Feedback geben')
  fab.innerHTML = `<span class="mm-fb-fab-icon" aria-hidden="true">💬</span><span class="mm-fb-fab-label">Feedback</span>`
  fab.addEventListener('click', openFeedbackModal)
  document.body.appendChild(fab)
  scheduleFabPeek(fab)
}

/**
 * Nach 6s versteckt sich der FAB halb am rechten Rand (nur Icon schaut raus).
 * Alle 45s wackelt er kurz komplett raus als dezenter Hinweis.
 * Hover / Fokus bringt ihn sofort wieder komplett rein.
 */
function scheduleFabPeek(fab) {
  const hide = () => fab.classList.add('mm-fb-fab--peek')
  const show = () => fab.classList.remove('mm-fb-fab--peek')
  const nudge = () => {
    if (document.getElementById('mm-fb-modal')) return
    show()
    setTimeout(hide, 2500)
  }
  setTimeout(hide, 6000)
  setInterval(nudge, 45000)
  fab.addEventListener('mouseenter', show)
  fab.addEventListener('focus', show)
  fab.addEventListener('touchstart', show, { passive: true })
}

function openFeedbackModal() {
  if (document.getElementById('mm-fb-modal')) return
  const overlay = document.createElement('div')
  overlay.id = 'mm-fb-modal'
  overlay.className = 'p-auth-overlay'
  document.body.appendChild(overlay)

  const close = () => {
    overlay.classList.remove('p-auth-overlay--open')
    setTimeout(() => overlay.remove(), 200)
  }

  overlay.innerHTML = `
    <div class="p-auth-backdrop" id="mm-fb-backdrop"></div>
    <div class="p-auth-card">
      <div class="p-auth-brand">MOTOMATCH · BETA</div>
      <h3 class="p-auth-title">Dein Feedback</h3>
      <p class="p-auth-sub">Was hakt? Was fehlt? Was gefällt dir? Ich lese jedes Feedback persönlich.</p>
      <form id="mm-fb-form" autocomplete="off">
        <label class="p-auth-field">
          <span class="p-auth-label">Deine Nachricht (mind. ${MIN_LEN} Zeichen)</span>
          <textarea class="p-auth-input mm-fb-textarea" id="mm-fb-text"
            minlength="${MIN_LEN}" maxlength="${MAX_LEN}" rows="6"
            placeholder="Beschreib es so konkret wie möglich — auf welchem Screen, was hast du erwartet, was ist passiert…" required></textarea>
          <span class="p-auth-sub mm-fb-counter" id="mm-fb-counter">0 / ${MAX_LEN}</span>
        </label>
        <div class="p-auth-error" id="mm-fb-error" hidden></div>
        <div class="p-auth-sub" id="mm-fb-success" hidden style="color:#0a0;margin:8px 0"></div>
        <div class="p-auth-actions">
          <button type="button" class="p-auth-cancel" id="mm-fb-cancel">Abbrechen</button>
          <button type="submit" class="p-auth-submit" id="mm-fb-submit">Senden</button>
        </div>
      </form>
    </div>`

  requestAnimationFrame(() => {
    overlay.classList.add('p-auth-overlay--open')
    overlay.querySelector('#mm-fb-text')?.focus()
  })

  const ta = overlay.querySelector('#mm-fb-text')
  const counter = overlay.querySelector('#mm-fb-counter')
  ta.addEventListener('input', () => { counter.textContent = `${ta.value.length} / ${MAX_LEN}` })

  overlay.querySelector('#mm-fb-backdrop').addEventListener('click', close)
  overlay.querySelector('#mm-fb-cancel').addEventListener('click', close)

  overlay.querySelector('#mm-fb-form').addEventListener('submit', async e => {
    e.preventDefault()
    const btn = overlay.querySelector('#mm-fb-submit')
    const errBox = overlay.querySelector('#mm-fb-error')
    const okBox = overlay.querySelector('#mm-fb-success')
    errBox.hidden = true
    const text = ta.value.trim()
    if (text.length < MIN_LEN) {
      errBox.textContent = `Bitte schreib mindestens ${MIN_LEN} Zeichen (${text.length} bisher).`
      errBox.hidden = false
      return
    }
    btn.disabled = true
    btn.textContent = 'Senden…'
    const res = await submitFeedback(text)
    if (res.ok) {
      okBox.textContent = 'Danke! Ich lese jedes Feedback.'
      okBox.hidden = false
      setTimeout(close, 1200)
    } else {
      errBox.textContent = res.error || 'Konnte nicht gesendet werden. Versuch es später erneut.'
      errBox.hidden = false
      btn.disabled = false
      btn.textContent = 'Senden'
    }
  })
}

async function submitFeedback(text) {
  const s = getSession()
  const uid = s && !s.guest ? (s.uid || null) : null
  const page = window.location.pathname + window.location.hash
  const user_agent = navigator.userAgent

  if (OFFLINE_MODE) {
    try {
      const list = JSON.parse(localStorage.getItem(LS_LOCAL) || '[]')
      list.push({ id: crypto.randomUUID?.() || String(Date.now()), user_id: uid, username: currentUser()?.username || null, text, page, user_agent, created_at: new Date().toISOString() })
      localStorage.setItem(LS_LOCAL, JSON.stringify(list))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'Konnte lokal nicht speichern.' }
    }
  }

  try {
    const { error } = await supabase.from('beta_feedback').insert({ user_id: uid, text, page, user_agent })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'Netzwerkfehler.' }
  }
}
