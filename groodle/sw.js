/* groodle — service worker
 *
 * Cache-first for the game shell so reopens are instant and offline-
 * capable; network-only for the gallery + analytics + anything third-
 * party that needs to be live.
 *
 * Versioning rule: bump SHELL_VERSION whenever any precached file
 * changes. The `activate` handler deletes every cache that doesn't
 * match the current version so stale assets can't linger. Bumping
 * triggers a fresh download on the next visit + skipWaiting/claim
 * so the new SW takes over without waiting for every tab to close.
 *
 * Scope: the SW file sits at /groodle/sw.js so registration without
 * a Service-Worker-Allowed header limits scope to /groodle/. That's
 * fine — the game lives entirely under that prefix; references up to
 * /assets/ resolve through fetches initiated from inside the scope
 * and get cached just fine. */

'use strict';

const SHELL_VERSION = 'groodle-shell-v3';

/* Files baked into the cache during `install`. List anything the
   game absolutely needs to render the first frame. Hat sprites are
   here so the equipped-hat preview renders offline. */
const SHELL_FILES = [
    './',
    './index.html',
    './style.css',
    './game.js',
    './manifest.webmanifest',
    './assets/sprites/hats.png',
    './assets/sprites/hats.json',
    '../assets/css/site-footer.css',
    '../assets/favi/favicon.ico',
    '../assets/favi/favicon-16x16.png',
    '../assets/favi/favicon-32x32.png',
    '../assets/favi/apple-touch-icon.png',
    '../assets/favi/android-chrome-192x192.png',
    '../assets/favi/android-chrome-512x512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_VERSION).then((cache) => {
            /* addAll fails the whole install if any URL 404s — keep this
               list lean and accurate or the SW won't register. Each entry
               is individually addAll'd via Promise.all for clearer error
               surfaces during dev. */
            return Promise.all(SHELL_FILES.map((url) =>
                cache.add(url).catch(() => {
                    /* Don't block the install on a single optional asset
                       (e.g. a renamed favicon). The fetch handler will
                       still cache it on first request. */
                })
            ));
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys
                .filter((k) => k !== SHELL_VERSION)
                .map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    /* Only intercept GET — POST goes straight to the network so save
       submissions don't get cached + replayed. */
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    /* Network-only bypasses. Supabase and GoatCounter must hit the
       wire fresh every time (the gallery + analytics depend on live
       responses; caching them is wrong). The browser handles these
       fetches normally when we don't call respondWith. */
    if (url.hostname.endsWith('supabase.co') ||
        url.hostname.endsWith('supabase.in') ||
        url.hostname.endsWith('goatcounter.com')) {
        return;
    }

    /* Navigation requests (the kid hits the URL directly or via the
       installed shortcut) — try network first so a content update
       shows up immediately when online; fall back to the cached shell
       when offline. */
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).then((resp) => {
                const clone = resp.clone();
                caches.open(SHELL_VERSION).then((c) => c.put(req, clone)).catch(() => {});
                return resp;
            }).catch(() =>
                caches.match(req).then((cached) =>
                    cached || caches.match('./index.html')
                )
            )
        );
        return;
    }

    /* Everything else: cache-first. Serve the cached copy when we
       have it; otherwise fetch, cache successful responses, and
       return them. Cross-origin opaque responses (Google Fonts,
       jsDelivr) are also cacheable — opaque means we can't read
       the body but the browser can still replay it. */
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((resp) => {
                if (resp && (resp.ok || resp.type === 'opaque')) {
                    const clone = resp.clone();
                    caches.open(SHELL_VERSION).then((c) => c.put(req, clone)).catch(() => {});
                }
                return resp;
            }).catch(() =>
                /* Last-ditch fallback for offline images — return a tiny
                   1x1 transparent GIF rather than a network error so the
                   UI doesn't break on a missing sprite. */
                new Response(new Uint8Array([
                    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
                    0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
                    0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
                    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
                    0x01, 0x00, 0x3b
                ]), { headers: { 'Content-Type': 'image/gif' } })
            );
        })
    );
});

/* Allow the page to trigger a manual SW update without a reload. The
   page posts { type: 'SKIP_WAITING' } after an updatefound event. */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
