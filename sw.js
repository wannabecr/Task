/**
 * TaskBoard Service Worker
 * Cache version is bumped on every deploy — the page detects the new SW
 * and shows an "Update available" banner with a force-reload button.
 *
 * Strategy:
 *   - App shell (HTML, fonts, icons CDN) → Cache-First
 *   - API calls (/assignments, /tickets, etc.) → Network-First, no cache
 *   - Supabase auth → Network-only (never cache tokens)
 */

const CACHE_VERSION = 'taskboard-v9';
const CACHE_NAME    = CACHE_VERSION;

// Resources to precache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700;800&display=swap',
  'https://unpkg.com/@phosphor-icons/web',
];

// Never cache these — always hit network
const NETWORK_ONLY_PATTERNS = [
  /supabase\.co/,
  /cloudflare\.com\/turnstile/,
  /nullyex-api\.onestreakgaming2\.workers\.dev/,
  /cdnjs\.cloudflare\.com\/ajax\/libs\/html2canvas/,
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting(); // Activate immediately — page will prompt user to reload

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Failed to precache:', url, err);
          })
        )
      );
    })
  );
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // Take control of all open pages
  );
});

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Network-only for API / auth / dynamic CDN resources
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first for everything else (app shell, fonts, icons)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Only cache valid responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        return response;
      }).catch(() => {
        // Offline fallback — serve index.html for navigation requests
        if (request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ─── MESSAGE BUS ────────────────────────────────────────────────────────────
// Page can send { type: 'SKIP_WAITING' } to force the new SW to activate
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Respond with current cache version so the page can detect staleness
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
});
