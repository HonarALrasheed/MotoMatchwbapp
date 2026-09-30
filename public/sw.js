/**
 * MotoMatch — Service Worker für Web Push
 *
 * Bewusst minimal: kein Offline-Caching. Enthaelt den 'push'-Listener (der
 * kann nur in einem registrierten Service Worker laufen) und einen
 * Durchreich-'fetch'-Listener — letzterer cached nichts, ist aber Teil von
 * Chromiums Pruefliste fuer die Installierbarkeit, und ohne Installation
 * gibt es auf dem Handy kein Vollbild.
 */

// Sofort uebernehmen statt auf das Schliessen aller Tabs zu warten: sonst
// bliebe nach einem Deploy die alte Version aktiv.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

// Reines Durchreichen. Bewusst ohne eigene Antwort: ein Cache waere hier
// still gefaehrlich, weil die App ihre Daten live aus Supabase zieht.
self.addEventListener('fetch', () => {})

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}

  const title = data.title || 'MotoMatch'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
