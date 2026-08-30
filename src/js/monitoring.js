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
      // Dieselben Schlüssel ohne Anführungszeichen: `token=abc123`,
      // `?access_token=xyz`, `secret: hunter2`. Die Regel darüber greift nur bei
      // JSON-Notation — eine Adresszeile mit ?token=… lief bisher durch, und
      // query_string läuft durch genau diese Funktion.
      .replace(/((?:password|passwort|token|secret|api[_-]?key)\s*[:=]\s*)[^\s"'&,;)\]}]+/gi, '$1[redacted]')
      // Bearer-Header und JWTs im Freitext. Supabase-Fehler zitieren beides
      // gern wörtlich; `eyJ` ist der base64-Anfang von `{"` und damit für ein
      // JWT eindeutig genug, um es überall im String zu erwischen.
      .replace(/\bBearer\s+[\w.\-]+/gi, 'Bearer [redacted]')
      .replace(/\beyJ[\w-]*\.[\w-]*\.[\w-]*/g, '[jwt]')
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
  // Exception-Nachrichten: Supabase-Auth-Fehler tragen die Adresse im Klartext
  // ("User already registered: x@y.de"). Die ging bisher ungefiltert raus — und
  // erzeugte nebenbei je Adresse eine eigene Issue-Gruppe, weil Sentry u. a.
  // nach `value` gruppiert. Filtern hilft hier also doppelt.
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(v => ({
      ...v,
      value: v.value ? scrub(v.value) : v.value,
    }))
  }
  return event
}

let _enabled = false
let _handlersInstalled = false

/**
 * Ein gefangener Fehler, der sonst nirgends auftaucht.
 * Gegenstück zu `report()` in api/_shared.js — dieselbe Rolle auf dem Client.
 *
 * Warum nicht bloß `console.warn`: die Konsole landet bei Sentry nur als
 * Breadcrumb an einem *anderen* Ereignis. Ein geschluckter Fehler erzeugt aber
 * per Definition kein anderes Ereignis — er bliebe damit unsichtbar. Erst
 * captureException macht daraus einen eigenen Eintrag. Die Alternative,
 * `captureConsoleIntegration` global einzuschalten, würde auch die 16
 * bestehenden console.warn mitnehmen (größtenteils „Migration evtl. noch nicht
 * ausgeführt“ aus community-api.js) und dafür Kontingent verbrennen.
 *
 * @param {unknown} err   Der gefangene Fehler.
 * @param {{where: string, [k: string]: unknown}} [extra]
 *        `where` benennt die Fundstelle und wird auch als Konsolen-Präfix
 *        genutzt. Keine Nutzerdaten hier hineinlegen — beforeSend filtert zwar
 *        E-Mails und Token, aber Namen und IDs kommen durch.
 */
export function report(err, extra) {
  console.warn(`[${extra?.where || 'report'}]`, err)
  if (_enabled) Sentry.captureException(err, { level: 'warning', extra })
}

/** Wie report(), aber für Fehler, an denen der Bildschirm hängenbleibt —
 *  eigene Stufe, damit die Alarmregel sie von den Warnungen trennen kann. */
export function reportFatal(err, extra) {
  console.error(`[${extra?.where || 'fatal'}]`, err)
  if (_enabled) Sentry.captureException(err, { level: 'fatal', extra })
}

/**
 * Unbehandelte Promise-Ablehnungen sichtbar machen — die häufigste Fehlerklasse
 * hier, weil community-api.js reihenweise ungeprüfte `await`s hat (AUDIT 7.1).
 *
 * Meldet bewusst NICHT selbst an Sentry: sobald ein DSN gesetzt ist, fängt
 * Sentrys `globalHandlersIntegration` (Standard-Integration) dieselben
 * Ereignisse schon ab — ein eigener captureException ergäbe jede Ablehnung
 * doppelt. Dieser Handler ist für den anderen Fall da: ohne DSN, lokal und
 * in jedem Zeitfenster vor dem Init, ist die Konsole die einzige Spur.
 * Deshalb wird er auch dann installiert, wenn Sentry aus bleibt.
 */
function installGlobalHandlers() {
  if (_handlersInstalled) return
  _handlersInstalled = true
  window.addEventListener('unhandledrejection', e => {
    console.error('[unhandledrejection]', e?.reason)
  })
}

export function initMonitoring() {
  // Vor der DSN-Prüfung: der Handler soll auch im Demo-Betrieb ohne Sentry stehen.
  installGlobalHandlers()
  if (_enabled) return
  const dsn = import.meta.env.VITE_SENTRY_DSN || ''
  if (!dsn) {
    console.info('[Monitoring] deaktiviert — kein DSN')
    return
  }
  Sentry.init({
    dsn,
    // MODE allein reicht nicht: `vite build` läuft auch für Vercel-Preview im
    // Modus "production" — Preview-Fehler landeten sonst in den Produktions-
    // Alarmen. VITE_SENTRY_ENVIRONMENT wird je Vercel-Umgebung gesetzt; lokal
    // fällt es auf MODE ("development") zurück. Serverseitig macht
    // @sentry/node dasselbe von sich aus über SENTRY_ENVIRONMENT.
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend,
  })
  _enabled = true
  console.info('[Monitoring] Sentry initialisiert')
}
