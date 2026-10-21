// Folio service worker: lets the site open without a connection.
// Pages are network-first (you always get the latest version when online);
// the app's hashed files and fonts are cache-first; version.json ("is there a newer
// Folio?") always goes to the network. Book data is not handled
// here: the app keeps its own offline copy and syncs changes itself.
const CACHE = 'folio-shell-v3'
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

// Store the newest app page. When it's a new version, drop the old version's files;
// the app re-fetches the screens it needs (and preloads the rest) straight away.
async function keepLatest(res) {
  const cache = await caches.open(CACHE)
  const html = await res.clone().text()
  const old = await cache.match('./index.html')
  const changed = !old || (await old.text()) !== html
  await cache.put('./index.html', res)
  if (!changed) return
  const used = new Set([...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href))
  if (!used.size) return
  for (const key of await cache.keys()) {
    if (key.url.startsWith(self.registration.scope + 'assets/') && !used.has(key.url)) await cache.delete(key)
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  const isFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com'
  if (!sameOrigin && !isFont) return // database, book search, covers: straight to the network
  if (sameOrigin && url.pathname.endsWith('/version.json')) return

  if (req.mode === 'navigate') {
    // Only the app itself is kept for offline use; other pages (e.g. privacy.html) aren't.
    const scope = new URL(self.registration.scope).pathname
    const isApp = url.pathname === scope || url.pathname === scope + 'index.html'
    event.respondWith((async () => {
      try {
        // Revalidate rather than take the browser's cached copy, so a reload after a deploy gets the new version.
        const fresh = await fetch(req, { cache: 'no-cache' })
        if (isApp && fresh.ok) event.waitUntil(keepLatest(fresh.clone()))
        return fresh
      } catch {
        return (isApp && ((await caches.match('./index.html')) || (await caches.match('./')))) || (await caches.match(req)) || Response.error()
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
