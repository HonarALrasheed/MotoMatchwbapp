/**
 * MotoMatch Push — Web-Push-Benachrichtigungen (DMs, Freundschaftsanfragen)
 *
 * Registriert public/sw.js, holt die Nutzer-Erlaubnis, abonniert beim
 * Push-Dienst des Browsers und speichert die Subscription in
 * `push_subscriptions` (RLS: nur eigene Zeilen) — der Versand selbst läuft
 * serverseitig über api/push-trigger.js, ausgelöst per Supabase-Webhook.
 */

import { supabase, OFFLINE_MODE } from './supabase.js'

/** Browser unterstützt Service Worker + Push API? */
export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

/**
 * Service Worker registrieren — ohne Permission-Abfrage, ohne Abo.
 *
 * Zwei Aufrufer: enablePushNotifications() braucht die Registrierung fuer das
 * Push-Abo, und install.js braucht sie, weil Chromium eine App ohne aktiven
 * Service Worker nicht zur Installation anbietet (und ohne Installation gibt
 * es auf dem Handy kein Vollbild). Fehler bleiben still: beides sind
 * Zusatzfunktionen, die App laeuft ohne sie unveraendert weiter.
 *
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    return registration
  } catch {
    return null
  }
}

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

/**
 * Push aktivieren: Permission anfragen, Service Worker registrieren,
 * beim Browser-Push-Dienst abonnieren und die Subscription speichern.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function enablePushNotifications() {
  if (OFFLINE_MODE || !supabase) return { ok: false, error: 'Push benötigt eine Online-Verbindung.' }
  if (!isPushSupported()) return { ok: false, error: 'Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.' }

  const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!VAPID_PUBLIC_KEY) return { ok: false, error: 'Push ist noch nicht konfiguriert.' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'Benachrichtigungen wurden nicht erlaubt.' }
  }

  const registration = await registerServiceWorker()
  if (!registration) {
    return { ok: false, error: 'Service Worker konnte nicht registriert werden.' }
  }

  let subscription
  try {
    subscription = await registration.pushManager.getSubscription()
      || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
  } catch {
    return { ok: false, error: 'Push-Abo fehlgeschlagen.' }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'Bitte melde dich an.' }

  const json = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: session.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'endpoint' })

  if (error) return { ok: false, error: 'Push-Abo konnte nicht gespeichert werden.' }
  return { ok: true }
}

/** Push deaktivieren: Browser-Abo kündigen + Subscription-Zeile löschen. */
export async function disablePushNotifications() {
  if (!isPushSupported()) return
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      const endpoint = subscription.endpoint
      await subscription.unsubscribe()
      if (!OFFLINE_MODE && supabase) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
      }
    }
  } catch {}
}

/** Ist Push für dieses Gerät aktuell abonniert? */
export async function isPushEnabled() {
  if (!isPushSupported()) return false
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    const subscription = await registration?.pushManager.getSubscription()
    return !!subscription
  } catch {
    return false
  }
}
