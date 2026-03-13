/**
 * TaskBoard Service Worker  ·  NullYex
 *
 * Caching strategies:
 *   Precache (install)  → app shell, icons, offline page, font CSS
 *   Cache-first         → fonts (gstatic), images, static assets
 *   Network-first       → navigation (page loads)
 *   Network-only        → API, Supabase auth, Turnstile
 *
 * Version: auto-generated on every SW parse — no manual bumping needed.
 */

const CACHE_VERSION = 'taskboard-' + Date.now();
const CACHE_NAME    = CACHE_VERSION;

// ─── PRECACHE ────────────────────────────────────────────────────────────────
const PRECACHE_URLS = [
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700;800&display=swap',
];

// ─── NETWORK-ONLY PATTERNS ───────────────────────────────────────────────────
const NETWORK_ONLY_PATTERNS = [
  /supabase\.co\/auth/,
  /cloudflare\.com\/turnstile/,
  /nullyex-api\.onestreakgaming2\.workers\.dev/,
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Precache miss:', url, err.message)
          )
        )
      )
    )
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => { console.log('[SW] Pruning old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET
  if (request.method !== 'GET') return;

  // ① Hard-bypass: Supabase auth
  if (request.url.includes('/auth/v1/')) {
    event.respondWith(fetch(request));
    return;
  }

  // ② Navigation — network first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline.html').then(r => r || caches.match('/index.html'))
      )
    );
    return;
  }

  // ③ Network-only patterns
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // ④ Google Fonts — stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => null);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // ⑤ Images — cache-first, placeholder fallback
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, clone);
              limitCache(CACHE_NAME, 50);
            });
          }
          return response;
        }).catch(() => caches.match('/icons/icon-192.png'));
      })
    );
    return;
  }

  // ⑥ Everything else — cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'error') return response;
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, toCache);
          limitCache(CACHE_NAME, 50);
        });
        return response;
      }).catch(() => {
        if (request.destination === 'document') return caches.match('/index.html');
      });
    })
  );
});

// ─── CACHE LIMIT ─────────────────────────────────────────────────────────────
async function limitCache(name, maxSize) {
  const cache = await caches.open(name);
  const keys  = await cache.keys();
  if (keys.length > maxSize) {
    await cache.delete(keys[0]);
    await limitCache(name, maxSize);
  }
}

// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'TaskBoard', body: event.data.text() }; }

  const title   = payload.title || 'TaskBoard';
  const options = {
    body:                payload.body    || 'You have a new notification.',
    icon:                '/icons/icon-192.png',
    badge:               '/icons/icon-192.png',
    tag:                 payload.tag     || 'taskboard-notification',
    data:                { url: payload.url || '/' },
    vibrate:             [100, 50, 100],
    requireInteraction:  payload.requireInteraction !== false, // stay visible until dismissed
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── NOTIFICATION CLICK ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ─── MESSAGE BUS ─────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION')  event.ports[0]?.postMessage({ version: CACHE_VERSION });
});
