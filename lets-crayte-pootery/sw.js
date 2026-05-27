/* ============================================================
   Pootery — service worker
   ============================================================
   Makes the app installable + offline-capable on phones.

   Caching strategies:
   - HTML / navigations: network-first (so the latest build
     lands the moment the user's online; falls back to cache
     when offline).
   - Static assets (CSS/JS/SVG/manifest): cache-first; on a
     hit we still kick off a background fetch to keep the
     cache fresh.
   - Supabase + any cross-origin requests: never intercepted
     (the public gallery / battles need live data).
   - POST/PUT/DELETE: pass through, never cached.

   Cache invalidation:
   - Bump CACHE_VERSION on every release that ships a new
     asset list or wants to force a clean install.
   - activate() deletes any cache that doesn't match the
     current version.
   ============================================================ */

const CACHE_VERSION = "pootery-v64";
const SCOPE = "/lets-crayte-pootery/";

const PRECACHE_URLS = [
    SCOPE,
    SCOPE + "index.html",
    SCOPE + "style.css",
    SCOPE + "game.js",
    SCOPE + "manifest.webmanifest",
    SCOPE + "icons/icon.svg",
    SCOPE + "icons/icon-maskable.svg",
    /* Shared hub asset — the slim footer stylesheet is loaded
       by index.html. */
    "/assets/css/site-footer.css"
];

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function (cache) {
            /* addAll fails atomically if any URL 404s — wrap
               each one so a missing asset doesn't kill the
               whole install. */
            return Promise.all(PRECACHE_URLS.map(function (u) {
                return cache.add(u).catch(function (e) {
                    console.warn("[CRAYte-sw] precache miss:", u, e);
                });
            }));
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) {
                if (k !== CACHE_VERSION) return caches.delete(k);
                return null;
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener("fetch", function (event) {
    const req = event.request;
    const url = new URL(req.url);

    /* Bypass: cross-origin (Supabase, GoatCounter, Google
       Fonts, etc.) and non-GET. */
    if (url.origin !== self.location.origin) return;
    if (req.method !== "GET") return;

    /* Network-first for EVERYTHING same-origin (HTML, game.js,
       style.css, icons, manifest).

       Why not cache-first for "static" assets: this app ships
       multiple times a day and game.js / style.css change every
       ship. Cache-first served the stale copy and only refreshed
       the cache for the NEXT load, so every device ran one
       version behind permanently -- the "only works with
       DevTools open" bug (DevTools bypasses the SW). Network-
       first means: online users always get the just-shipped
       code; the cache is purely the offline safety net so the
       PWA still launches on a plane.

       The tiny per-request latency of waiting for the network is
       negligible against a GH Pages CDN, and far cheaper than
       shipping fixes nobody receives. */
    event.respondWith(
        fetch(req)
            .then(function (res) {
                if (res && res.ok && res.type === "basic") {
                    const copy = res.clone();
                    caches.open(CACHE_VERSION).then(function (c) {
                        c.put(req, copy);
                    });
                }
                return res;
            })
            .catch(function () {
                /* Offline / network failure -> serve last-known
                   cached copy. For navigations with no cached
                   match, fall back to the cached app shell so
                   the PWA still boots. */
                return caches.match(req).then(function (cached) {
                    if (cached) return cached;
                    if (req.mode === "navigate" ||
                        req.destination === "document") {
                        return caches.match(SCOPE) ||
                               caches.match(SCOPE + "index.html");
                    }
                    return Response.error();
                });
            })
    );
});

/* Allow the page to ask the SW to skip waiting if it ever
   defers activation (we use skipWaiting in install above so
   this is mostly belt-and-suspenders).                        */
self.addEventListener("message", function (event) {
    if (event.data && event.data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});

/* ============================================================
   PUSH (chunk W3)
   ============================================================
   Payload shape (set by push-worker /send/<topic>):
     { topic, title, body, url?, icon?, sent_at }

   - On `push` we surface a system notification with the title +
     body. `data.url` rides along so notificationclick knows where
     to land.
   - On `notificationclick` we focus an existing Pootery tab if
     one is open (and same origin), otherwise open a new one
     pointed at data.url. The notification closes either way.

   Both handlers are wrapped in try/catch -- a malformed payload
   or missing data.url must not throw out of the SW (which would
   kill subsequent push delivery on some browsers).
   ============================================================ */

const DEFAULT_PUSH_ICON  = "/lets-crayte-pootery/icons/icon.svg";
const DEFAULT_PUSH_BADGE = "/lets-crayte-pootery/icons/icon-maskable.svg";
const DEFAULT_PUSH_URL   = "/lets-crayte-pootery/";

self.addEventListener("push", function (event) {
    let data = {};
    try {
        if (event.data) data = event.data.json();
    } catch (e) {
        try {
            data = { title: "Pootery", body: event.data ? event.data.text() : "" };
        } catch (_) { data = {}; }
    }

    const title = data.title || "Pootery";
    const body  = data.body  || "";
    const url   = data.url   || DEFAULT_PUSH_URL;
    const icon  = data.icon  || DEFAULT_PUSH_ICON;
    /* tag groups notifications so a rapid second push of the
       same topic (e.g. battle-start retry) doesn't stack on
       the lock screen. */
    const tag = data.topic ? ("pootery-" + data.topic) : "pootery";

    event.waitUntil(
        self.registration.showNotification(title, {
            body:  body,
            icon:  icon,
            badge: DEFAULT_PUSH_BADGE,
            tag:   tag,
            renotify: true,
            data:  { url: url, topic: data.topic || "" }
        })
    );
});

self.addEventListener("notificationclick", function (event) {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) ||
                   DEFAULT_PUSH_URL;
    /* Resolve target against the worker's origin so relative URLs
       (we send /lets-crayte-pootery/?pot=… on Pootery sends) work
       just as well as absolute https URLs. */
    const targetURL = new URL(target, self.location.origin).href;

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true })
            .then(function (clientList) {
                for (let i = 0; i < clientList.length; i++) {
                    const c = clientList[i];
                    /* Same-origin existing window -> focus + nav. */
                    if (c.url && new URL(c.url).origin === self.location.origin) {
                        return c.focus().then(function () {
                            if ("navigate" in c) return c.navigate(targetURL);
                        });
                    }
                }
                return self.clients.openWindow(targetURL);
            })
    );
});
