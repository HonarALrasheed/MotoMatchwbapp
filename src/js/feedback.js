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

/** Gemerkte Position des Knopfs: Seite plus Abstand vom unteren Rand. */
const LS_FAB_POS = 'mm_fb_fab_pos_v1'
/** Ab dieser Zugstrecke ist es ein Verschieben und kein Tippen mehr. */
const DRAG_THRESHOLD = 6
/** Luft, die oben frei bleibt — darueber liegen Kopfzeilen und Zurueck-Pfeil. */
const TOP_GUARD = 76

function readFabPos() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_FAB_POS) || 'null')
    if (!v || (v.side !== 'left' && v.side !== 'right')) return null
    return { side: v.side, bottom: Number(v.bottom) || 0 }
  } catch { return null }
}

/**
 * Position anwenden: die Seite ueber eine Klasse, die Hoehe ueber eine
 * Variable. Beides absichtlich nicht als Inline-`bottom` — die Ausweich-
 * Regeln in main.css rechnen die Variable per max() als Untergrenze ein, ein
 * Inline-Wert wuerde sie dagegen alle ueberschreiben und den Knopf wieder
 * unter der Tab-Leiste oder der Tastatur landen lassen.
 */
function applyFabPos(fab, pos) {
  fab.classList.toggle('mm-fb-fab--left', pos?.side === 'left')
  if (pos) fab.style.setProperty('--fab-user-bottom', Math.round(pos.bottom) + 'px')
  else fab.style.removeProperty('--fab-user-bottom')
}

/**
 * Den Knopf mit dem Finger (oder der Maus) verschiebbar machen.
 *
 * Waehrend des Zugs haengt er inline an left/top, beim Loslassen rastet er an
 * der naeheren Seite ein und die Hoehe wandert in die Variable. Pointer-Events
 * statt Touch: damit gilt derselbe Code fuer Finger und Maus, und
 * setPointerCapture haelt den Zug auch dann fest, wenn der Finger den kleinen
 * Knopf verlaesst.
 */
function makeFabDraggable(fab) {
  let dragging = false, moved = false
  let startX = 0, startY = 0, offX = 0, offY = 0

  fab.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return
    const r = fab.getBoundingClientRect()
    startX = e.clientX; startY = e.clientY
    offX = e.clientX - r.left; offY = e.clientY - r.top
    dragging = true; moved = false
    try { fab.setPointerCapture(e.pointerId) } catch {}
  })

  fab.addEventListener('pointermove', e => {
    if (!dragging) return
    if (!moved) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return
      moved = true
      // Erst jetzt umschalten: ein reiner Tipper soll den Knopf nicht
      // unmerklich um einen Pixel versetzen.
      fab.classList.add('mm-fb-fab--dragging')
      fab.classList.remove('mm-fb-fab--peek')
    }
    const r = fab.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - offX, 4), window.innerWidth - r.width - 4)
    const y = Math.min(Math.max(e.clientY - offY, TOP_GUARD), window.innerHeight - r.height - 4)
    fab.style.left = x + 'px'
    fab.style.top = y + 'px'
  })

  const finish = e => {
    if (!dragging) return
    dragging = false
    try { fab.releasePointerCapture(e.pointerId) } catch {}
    if (!moved) return
    const r = fab.getBoundingClientRect()
    // Naehere Seite gewinnt — dazwischen stehen bleiben waere weder Rand
    // noch Mitte, und das Peek braucht eine Seite, in die es verschwinden kann.
    const side = (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right'
    const bottom = Math.max(0, Math.round(window.innerHeight - r.bottom))
    fab.classList.remove('mm-fb-fab--dragging')
    fab.style.left = ''
    fab.style.top = ''
    const pos = { side, bottom }
    applyFabPos(fab, pos)
    try { localStorage.setItem(LS_FAB_POS, JSON.stringify(pos)) } catch {}
  }
  fab.addEventListener('pointerup', finish)
  fab.addEventListener('pointercancel', finish)

  // Der Klick nach einem Zug wuerde sonst das Modal oeffnen.
  fab.addEventListener('click', e => {
    if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false }
  }, true)
}

export function initFeedbackFab() {
  if (document.getElementById('mm-fb-fab')) return
  const fab = document.createElement('button')
  fab.id = 'mm-fb-fab'
  fab.type = 'button'
  fab.className = 'mm-fb-fab'
  fab.setAttribute('aria-label', 'Feedback geben')
  fab.innerHTML = `<span class="mm-fb-fab-icon" aria-hidden="true">💬</span><span class="mm-fb-fab-label">Feedback</span>`
  fab.addEventListener('click', e => {
    // Angepeekt (nur der 34px-Stummel sichtbar): erster Tap klappt nur aus,
    // statt sofort das Modal zu oeffnen — ein Treffer auf den schmalen
    // Rand sonst wirkt wie ein Versehen. Bei Maus/Tastatur ist das Peek
    // dank :hover/:focus (siehe scheduleFabPeek) hier nie aktiv, das
    // Modal geht dort weiter mit einem Klick auf.
    if (fab.classList.contains('mm-fb-fab--peek')) {
      e.preventDefault()
      fab.classList.remove('mm-fb-fab--peek')
      return
    }
    openFeedbackModal()
  })
  document.body.appendChild(fab)
  applyFabPos(fab, readFabPos())
  makeFabDraggable(fab)
  scheduleFabPeek(fab)
}

/**
 * Nach 6s versteckt sich der FAB halb am rechten Rand (nur Icon schaut raus).
 * Alle 45s wackelt er kurz komplett raus als dezenter Hinweis.
 * Hover / Fokus bringt ihn sofort wieder komplett rein; auf Touch macht das
 * der erste Tap (siehe Klick-Handler oben — bewusst nicht per touchstart,
 * sonst waere die Klasse schon weg, bevor der Klick-Handler das Peek noch
 * erkennen und den ersten Tap zum reinen Ausklappen machen kann).
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
