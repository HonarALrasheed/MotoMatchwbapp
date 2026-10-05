/**
 * MotoMatch — Service Worker für Web Push und Offline-Karte
 *
 * Enthaelt den 'push'-Listener (der kann nur in einem registrierten Service
 * Worker laufen) und einen 'fetch'-Listener. Gecacht wird NUR, was sich nicht
 * pro Nutzer aendert und fuers Navi im Funkloch gebraucht wird:
 *   /kacheln/*  Kartenkacheln, Schriften, Symbole (OpenFreeMap ueber die eigene Domain)
 *   /hoehe/*    Hoehendaten fuers Relief
 *   /stimme/*   Ansagen der Navi-Stimme (auch im Funkloch)
 *   /data/touren|kurven|orte/*  die statischen Strecken- und Ortsdaten
 * Alles andere (App, Supabase, API) geht unveraendert durchs Netz.
 * Vorladen entlang einer Strecke: src/js/offline.js.
 */

const KARTEN_CACHE = 'mm-karte-v1'
const MAX_EINTRAEGE = 4000

/* Kacheln mit Versionspfad aendern sich nie -> zuerst Cache. Stil, TileJSON und
   Daten-Indizes koennen sich aendern -> zuerst Netz, Cache nur als Rueckfall. */
const zuerstNetz = (url) => /\/kacheln\/(styles|planet$)|\/index\.json$/.test(url.pathname)

async function aufraeumen(cache) {
  const keys = await cache.keys()
  if (keys.length > MAX_EINTRAEGE) for (const k of keys.slice(0, keys.length - MAX_EINTRAEGE)) await cache.delete(k)
}

async function kartenAntwort(request) {
  const url = new URL(request.url)
  const cache = await caches.open(KARTEN_CACHE)
  // Stil und TileJSON: sofort aus dem Cache, im Hintergrund erneuern
  if (/\/kacheln\/(styles|planet$)/.test(url.pathname)) {
    const alt = await cache.match(request)
    const neu = fetch(request).then((r) => { if (r.ok) cache.put(request, r.clone()); return r }).catch(() => null)
    if (alt) return alt
    return (await neu) || Response.error()
  }
  if (zuerstNetz(url)) {
    try {
      const r = await fetch(request)
      if (r.ok) cache.put(request, r.clone())
      return r
    } catch {
      return (await cache.match(request)) || Response.error()
    }
  }
  const treffer = await cache.match(request)
  if (treffer) return treffer
  const r = await fetch(request)
  if (r.ok) {
    cache.put(request, r.clone()).then(() => { if (Math.random() < 0.02) aufraeumen(cache) })
  }
  return r
}

// Sofort uebernehmen statt auf das Schliessen aller Tabs zu warten: sonst
// bliebe nach einem Deploy die alte Version aktiv.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

// Nur Kartenteile beantwortet der Worker selbst; alles andere reicht er durch
// (ohne eigene Antwort) — die App zieht ihre Daten live aus Supabase.
self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (/^\/(kacheln|hoehe|stimme)\//.test(url.pathname) || /^\/data\/(touren|kurven|orte)\//.test(url.pathname)) {
    event.respondWith(kartenAntwort(req))
  }
})

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
