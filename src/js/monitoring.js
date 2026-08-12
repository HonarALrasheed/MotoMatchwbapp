/**
 * MotoMatch — Sentry Frontend-Monitoring
 *
 * Wenn VITE_SENTRY_DSN gesetzt ist, wird Sentry Browser initialisiert.
 * Andernfalls no-op (analog zum OFFLINE_MODE-Muster in supabase.js).
 * PII (E-Mails, Passwörter) werden in `beforeSend` rausgefiltert.
 */
import * as Sentry from '@sentry/browser'

const PII_KEYS = /(mail|e-?mail|password|passwort|token|secret|api[_-]?key|authorization)/i

function scrub(value) {
  if (value == null) return value
  if (typeof value === 'string') {
    return value
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
      .replace(/("?(password|passwort|token)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"')
  }
  if (Array.isArray(value)) return value.map(scrub)
  if (typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) {
      out[k] = PII_KEYS.test(k) ? '[redacted]' : scrub(value[k])
    }
    return out
  }
  return value
}

function beforeSend(event) {
  if (event.user) {
    delete event.user.email
    delete event.user.ip_address
    delete event.user.username
  }
  if (event.request) {
    if (event.request.cookies) event.request.cookies = '[redacted]'
    if (event.request.headers) event.request.headers = scrub(event.request.headers)
    if (event.request.data) event.request.data = scrub(event.request.data)
    if (event.request.query_string) event.request.query_string = scrub(event.request.query_string)
  }
  if (event.extra) event.extra = scrub(event.extra)
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(b => ({
      ...b,
      data: b.data ? scrub(b.data) : b.data,
      message: b.message ? scrub(b.message) : b.message,
    }))
  }
  if (event.message) event.message = scrub(event.message)
  return event
}

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN || ''
  if (!dsn) {
    console.info('[Monitoring] deaktiviert — kein DSN')
    return
  }
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend,
  })
  console.info('[Monitoring] Sentry initialisiert')
}
