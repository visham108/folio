// Folio service worker: lets the site open without a connection.
// Pages are network-first (you always get the latest version when online);
// the app's hashed files and fonts are cache-first. Book data is not handled
// here: the app keeps its own offline copy and syncs changes itself.
const CACHE = 'folio-shell-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  const isFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com'
  if (!sameOrigin && !isFont) return // database, book search, covers: straight to the network

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req)
        const cache = await caches.open(CACHE)
        cache.put('./index.html', fresh.clone())
        return fresh
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cached = await caches.match(req)
    if (cached) return cached
    try {
      const res = await fetch(req)
      if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone())
      return res
    } catch {
      return Response.error()
    }
  })())
})
