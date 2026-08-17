/**
 * MotoMatch — Service Worker für Web Push
 *
 * Bewusst minimal: kein Offline-Caching, keine PWA-Installierbarkeit — nur
 * der Teil, den die Push-API zwingend braucht (ein 'push'-Event-Listener
 * kann nur in einem registrierten Service Worker laufen).
 */

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}

  const title = data.title || 'MotoMatch'
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
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
