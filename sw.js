// Service worker: makes the app open offline.
// App files: network-first (you always get the latest deploy when online).
// CDN libraries: cache-first (their URLs are version-pinned, so they never change).
// Supabase API calls are never cached.

const CACHE = 'cit-v4'
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/crypto.js',
  'js/calc.js',
  'js/invoice.js',
  'js/excel.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
]
const CDN = [
  'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => Promise.all([c.addAll(SHELL), ...CDN.map((u) => c.add(u).catch(() => {}))])).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.origin === location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()))
          return res
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))),
    )
    return
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()))
            return res
          }),
      ),
    )
  }
})
