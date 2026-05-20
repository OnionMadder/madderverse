/* ============================================================
   Let's CRAYte! Pootery — main script
   ============================================================
   Single IIFE. Chunk 1 covers the title screen + screen-switching
   scaffold. Chunks 2-3 (shape + decorate) bolt onto SCREENS via
   registerScreen() and the SCREENS map. Chunks 5-6 add KILN +
   GALLERY the same way.
   ============================================================ */

(function () {
    "use strict";

    /* ---------- 0. SUPABASE AUTH ----------
       Magic-link + Google OAuth. Session JWT cached in
       localStorage; refreshed transparently when near expiry.
       The shim sits in front of every Supabase request — when
       a user is signed in, authHeader() sends their JWT as
       the Authorization bearer (so RLS sees auth.uid()); when
       signed out, the anon key is used for both apikey and
       Authorization (RLS treats the call as anonymous, exactly
       as before).                                              */

    const AUTH = {
        session: null,   /* { access_token, refresh_token, expires_at, user } */
        profile: null,   /* row from profiles table */
        loaded:  false,
        listeners: []
    };

    const AUTH_KEY = "crayte-auth-session";

    function loadStoredSession() {
        try {
            const raw = localStorage.getItem(AUTH_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            if (s && s.access_token && s.expires_at) return s;
        } catch (_) {}
        return null;
    }

    function saveStoredSession(s) {
        try {
            if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
            else   localStorage.removeItem(AUTH_KEY);
        } catch (_) {}
    }

    function currentUserId() {
        return (AUTH.session && AUTH.session.user)
            ? AUTH.session.user.id : null;
    }

    function isSignedIn() {
        return !!currentUserId();
    }

    /* Subscribe to auth-state changes. Each listener fn() runs
       whenever sign-in / sign-out / profile-update lands. */
    function onAuthChange(fn) {
        AUTH.listeners.push(fn);
    }

    function notifyAuthListeners() {
        AUTH.listeners.forEach(function (fn) {
            try { fn(); } catch (e) { console.warn("[CRAYte] auth listener", e); }
        });
    }

    /* Token refresh — exchange the long-lived refresh_token for
       a fresh access_token when the current one is near expiry.
       Returns true on success, false if the refresh failed (in
       which case the session is cleared).                       */
    function refreshAuthSession() {
        if (!AUTH.session || !AUTH.session.refresh_token) {
            return Promise.resolve(false);
        }
        return fetch(
            SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
            {
                method: "POST",
                headers: {
                    "apikey":       SUPABASE_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    refresh_token: AUTH.session.refresh_token
                })
            }
        ).then(function (r) {
            if (!r.ok) {
                AUTH.session = null;
                AUTH.profile = null;
                saveStoredSession(null);
                return false;
            }
            return r.json().then(function (data) {
                AUTH.session = {
                    access_token:  data.access_token,
                    refresh_token: data.refresh_token,
                    expires_at:    Date.now() + (data.expires_in || 3600) * 1000,
                    user:          data.user
                };
                saveStoredSession(AUTH.session);
                return true;
            });
        }).catch(function (e) {
            console.warn("[CRAYte] auth refresh failed", e);
            return false;
        });
    }

    function fetchProfile() {
        const uid = currentUserId();
        if (!uid) return Promise.resolve(null);
        return fetch(
            SUPABASE_URL + "/rest/v1/profiles?id=eq." + uid + "&select=*",
            { headers: supabaseHeaders() }
        ).then(function (r) {
            return r.ok ? r.json() : [];
        }).then(function (rows) {
            AUTH.profile = (rows && rows[0]) || null;
            return AUTH.profile;
        }).catch(function () { return null; });
    }

    function updateProfile(patch) {
        const uid = currentUserId();
        if (!uid) return Promise.resolve(null);
        return fetch(
            SUPABASE_URL + "/rest/v1/profiles?id=eq." + uid,
            {
                method: "PATCH",
                headers: supabaseHeaders({
                    "Content-Type": "application/json",
                    "Prefer":       "return=representation"
                }),
                body: JSON.stringify(patch)
            }
        ).then(function (r) {
            if (!r.ok) return null;
            return r.json().then(function (rows) {
                AUTH.profile = (rows && rows[0]) || AUTH.profile;
                notifyAuthListeners();
                return AUTH.profile;
            });
        });
    }

    /* Magic-link sign-in. Returns { ok: bool, error?: string }.
       On success, Supabase emails a one-tap link to the address;
       the user clicks it and lands back here with #access_token
       in the URL hash, which initAuth() consumes.              */
    function signInWithMagicLink(email) {
        if (!supabaseEnabled()) return Promise.resolve({ ok: false, error: "offline" });
        const redirect = window.location.origin + window.location.pathname;
        return fetch(SUPABASE_URL + "/auth/v1/otp", {
            method: "POST",
            headers: {
                "apikey":       SUPABASE_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email:   email,
                options: { emailRedirectTo: redirect }
            })
        }).then(function (r) {
            if (r.ok) return { ok: true };
            return r.json().then(function (data) {
                return { ok: false, error: data.error_description || data.msg || "send failed" };
            }).catch(function () {
                return { ok: false, error: "send failed" };
            });
        }).catch(function (e) {
            return { ok: false, error: e.message || "network" };
        });
    }

    /* Google OAuth — full-page redirect. The user comes back to
       the same path with #access_token in the URL hash. */
    function signInWithGoogle() {
        if (!supabaseEnabled()) return;
        const redirect = window.location.origin + window.location.pathname;
        window.location.href = SUPABASE_URL +
            "/auth/v1/authorize?provider=google&redirect_to=" +
            encodeURIComponent(redirect);
    }

    function signOut() {
        const access = AUTH.session && AUTH.session.access_token;
        const done = function () {
            AUTH.session = null;
            AUTH.profile = null;
            saveStoredSession(null);
            notifyAuthListeners();
        };
        if (!access) { done(); return Promise.resolve(); }
        return fetch(SUPABASE_URL + "/auth/v1/logout", {
            method: "POST",
            headers: supabaseHeaders()
        }).catch(function () { /* ignore */ })
          .then(done);
    }

    /* Boot — runs once on page load. Consumes the OAuth/magic-
       link callback hash if present, else restores any cached
       session and refreshes if near-expiry.                    */
    function initAuth() {
        const hash = window.location.hash || "";
        if (hash.indexOf("access_token=") >= 0) {
            const params = new URLSearchParams(hash.replace(/^#/, ""));
            const access = params.get("access_token");
            if (access) {
                AUTH.session = {
                    access_token:  access,
                    refresh_token: params.get("refresh_token") || null,
                    expires_at:    Date.now() +
                                   (parseInt(params.get("expires_in") || "3600", 10) * 1000),
                    user:          null
                };
                /* Replace the URL so the hash doesn't linger if the
                   user copies the URL. Done in two steps to satisfy
                   browsers that strip the hash via replaceState. */
                window.history.replaceState(
                    null, "", window.location.pathname + window.location.search
                );
                return fetch(SUPABASE_URL + "/auth/v1/user", {
                    headers: supabaseHeaders()
                })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (user) {
                    if (user) AUTH.session.user = user;
                    saveStoredSession(AUTH.session);
                    return fetchProfile();
                })
                .then(function () {
                    AUTH.loaded = true;
                    notifyAuthListeners();
                });
            }
        }
        const stored = loadStoredSession();
        if (stored) {
            AUTH.session = stored;
            const nearExpiry = (stored.expires_at - Date.now()) < 60000;
            const ready = nearExpiry
                ? refreshAuthSession().then(function (ok) {
                      if (!ok) return null;
                      return fetchProfile();
                  })
                : fetchProfile();
            return ready.then(function () {
                AUTH.loaded = true;
                notifyAuthListeners();
            });
        }
        AUTH.loaded = true;
        notifyAuthListeners();
        return Promise.resolve();
    }

    /* ---------- 0a. SUPABASE BACKEND ----------
       Public gallery + (future) pot battles live in a Supabase
       project. The anon/publishable key below is SAFE to embed
       in client-side code — that's its designed purpose. Row-
       level security policies on the public_pots table control
       what anonymous callers can actually do:
         - SELECT  allowed (anyone can read)
         - INSERT  allowed (anyone can submit)
         - UPDATE  blocked
         - DELETE  blocked
       So a leaked key still can't vandalize.

       If you ever rotate keys, update both constants below and
       re-deploy. If supabaseEnabled() returns false (network
       blocked, project deleted, etc.) the gallery's PUBLIC tab
       and all submit/fetch helpers degrade silently — the rest
       of the game keeps working offline.                       */

    const SUPABASE_URL = "https://qucwhtkbnugslkgbtxwk.supabase.co";
    const SUPABASE_KEY = "sb_publishable_bGVCKFvYwHiiJUhen8q-4A_p6le2Jcv";

    function supabaseEnabled() {
        return !!(SUPABASE_URL && SUPABASE_KEY);
    }

    function supabaseHeaders(extra) {
        /* apikey is always the publishable key. Authorization is
           the signed-in user's JWT when we have one — RLS sees
           auth.uid() and allows owner-only operations. When
           signed out, we send the anon key in both positions
           (the same behavior as before chunk 1 of Phase 1). */
        const authToken = (AUTH.session && AUTH.session.access_token)
            ? AUTH.session.access_token : SUPABASE_KEY;
        const h = {
            "apikey":        SUPABASE_KEY,
            "Authorization": "Bearer " + authToken
        };
        if (extra) for (const k in extra) h[k] = extra[k];
        return h;
    }

    /* Fetch latest N public pots, newest first. */
    /* Fetch a single public_pots row by uuid. Used by the URL
       deep-link (?pot=<uuid>) so shared pot URLs land straight
       on the detail modal. Returns null if missing / failed. */
    function fetchPublicPotById(id) {
        if (!supabaseEnabled() || !id) return Promise.resolve(null);
        const url = SUPABASE_URL +
            "/rest/v1/public_pots?select=*&id=eq." +
            encodeURIComponent(id) + "&limit=1";
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (rows) { return rows && rows[0] ? rows[0] : null; })
            .catch(function () { return null; });
    }

    function fetchPublicPots(limit) {
        if (!supabaseEnabled()) return Promise.resolve([]);
        const n = Math.max(1, Math.min(100, limit || 50));
        const url = SUPABASE_URL +
            "/rest/v1/public_pots?select=*&order=created_at.desc&limit=" + n;
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(enrichWithProfiles)
            .catch(function (e) {
                console.warn("[CRAYte] public fetch failed", e);
                return [];
            });
    }

    /* Bulk-load profile rows for any user_ids appearing in the
       passed array of records, then stamp ._profile on each
       record. Skips records without user_id (true anonymous).  */
    function enrichWithProfiles(rows) {
        if (!Array.isArray(rows) || rows.length === 0) return rows;
        const seen = Object.create(null);
        const ids = [];
        rows.forEach(function (r) {
            const uid = r && r.user_id;
            if (uid && !seen[uid]) { seen[uid] = true; ids.push(uid); }
        });
        if (ids.length === 0) return rows;
        const inClause = "(" + ids.join(",") + ")";
        const url = SUPABASE_URL + "/rest/v1/profiles?select=id,username,display_name" +
            "&id=in." + encodeURIComponent(inClause);
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (profs) {
                const map = Object.create(null);
                (profs || []).forEach(function (p) { map[p.id] = p; });
                rows.forEach(function (r) {
                    if (r && r.user_id && map[r.user_id]) {
                        r._profile = map[r.user_id];
                    }
                });
                return rows;
            })
            .catch(function () { return rows; });
    }

    /* Submit one local pot to the public gallery. Returns the
       inserted row (with .id and .created_at) on success, null
       on failure. */
    function submitPublicPot(entry, author) {
        if (!supabaseEnabled()) return Promise.resolve(null);
        const url = SUPABASE_URL + "/rest/v1/public_pots";
        const body = {
            name:           entry.name || "UNNAMED POT",
            author:         (author || "anonymous").slice(0, 40),
            pack_id:        entry.packId       || null,
            clay_type_id:   entry.clayTypeId   || null,
            fired:          !!entry.fired,
            overfired:      !!entry.overfired,
            exploded:       !!entry.exploded,
            clay:           entry.clay         || null,
            paint_data_url: entry.paintDataUrl || null,
            /* Phase 1 chunk 1d: tag the pot with the signed-in
               user's id if any, so it shows up on their profile
               and they can rename/claim it later. Anon submits
               leave this NULL — same RLS behavior as before. */
            user_id:        currentUserId()
        };
        /* Remix lineage -- only include the keys if the entry
           actually carries them. PostgREST drops unknown columns
           gracefully when the request body omits them, but
           explicitly sending nulls when SUPABASE_REMIX.sql hasn't
           run yet would 400. */
        if (entry.remixedFrom) {
            body.remixed_from        = entry.remixedFrom;
            body.remixed_from_author = entry.remixedFromAuthor || "anonymous";
        }
        return submitWithRemixFallback(url, body);
    }

    /* POST + on a 400 that smells like "remixed_from column not
       found" (Supabase project hasn't run SUPABASE_REMIX.sql
       yet), retry without the lineage fields. Lets remix ship
       client-side before the SQL migration is applied. */
    function submitWithRemixFallback(url, body) {
        return fetch(url, {
            method: "POST",
            headers: supabaseHeaders({
                "Content-Type": "application/json",
                "Prefer":       "return=representation"
            }),
            body: JSON.stringify(body)
        })
            .then(function (r) {
                if (r.ok) {
                    return r.json().then(function (rows) {
                        return Array.isArray(rows) && rows[0] ? rows[0] : null;
                    });
                }
                /* 400 may be "remixed_from column missing" before
                   the SQL migration runs. Strip + retry once. */
                if ((r.status === 400 || r.status === 404) &&
                    (body.remixed_from || body.remixed_from_author)) {
                    const stripped = Object.assign({}, body);
                    delete stripped.remixed_from;
                    delete stripped.remixed_from_author;
                    return fetch(url, {
                        method: "POST",
                        headers: supabaseHeaders({
                            "Content-Type": "application/json",
                            "Prefer":       "return=representation"
                        }),
                        body: JSON.stringify(stripped)
                    }).then(function (r2) {
                        if (!r2.ok) return null;
                        return r2.json().then(function (rows) {
                            return Array.isArray(rows) && rows[0] ? rows[0] : null;
                        });
                    });
                }
                return null;
            })
            .catch(function (e) {
                console.warn("[CRAYte] public submit failed", e);
                return null;
            });
    }

    /* ---------- 0c. PWA INSTALL ----------
       Service worker registration + Add-to-Home-Screen prompt.
       Android Chrome / Edge fire `beforeinstallprompt` before
       letting us call .prompt() on it later (must be triggered
       by a user gesture). iOS Safari doesn't fire that event —
       users have to use the share-sheet "Add to Home Screen",
       so we surface a hint instead. Once installed, the launch
       runs with display-mode: standalone — we hide the button.
       ============================================================ */

    let deferredInstallPrompt = null;

    function isStandaloneInstalled() {
        return window.matchMedia("(display-mode: standalone)").matches
            || window.navigator.standalone === true;   /* iOS legacy */
    }

    function isIOSLike() {
        const ua = navigator.userAgent || "";
        return /iPhone|iPad|iPod/.test(ua);
    }

    /* Register the SW once (no-op if already controlling). The
       browser handles update detection; cache invalidation lives
       in sw.js via CACHE_VERSION. */
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            navigator.serviceWorker.register("sw.js", { scope: "./" })
                .catch(function (e) {
                    console.warn("[CRAYte] SW register failed", e);
                });
        });
    }

    /* Capture the install prompt event the moment the browser
       decides we're installable. Don't call .prompt() yet —
       that requires a user gesture, so we stash it until the
       INSTALL APP button is clicked. */
    window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        deferredInstallPrompt = e;
        const btn = document.getElementById("btnInstall");
        if (btn && !isStandaloneInstalled()) btn.hidden = false;
    });

    /* Browser tells us the install finished — clean up. */
    window.addEventListener("appinstalled", function () {
        deferredInstallPrompt = null;
        const btn = document.getElementById("btnInstall");
        if (btn) btn.hidden = true;
    });

    function wireInstallButton() {
        const btn = document.getElementById("btnInstall");
        if (!btn) return;
        /* iOS path: no beforeinstallprompt, but we still want to
           tell the user how to install. Show the button if we're
           on iOS Safari + not already installed. */
        if (isIOSLike() && !isStandaloneInstalled()) {
            btn.hidden = false;
        }
        /* Hide if already running as an installed app */
        if (isStandaloneInstalled()) btn.hidden = true;

        btn.addEventListener("click", function () {
            if (deferredInstallPrompt) {
                /* Android / Chromium — native prompt. */
                deferredInstallPrompt.prompt();
                deferredInstallPrompt.userChoice.then(function (choice) {
                    if (choice && choice.outcome === "accepted") {
                        btn.hidden = true;
                    }
                    deferredInstallPrompt = null;
                });
            } else if (isIOSLike()) {
                /* iOS — share-sheet instructions. */
                alert(
                    "To install:\n\n" +
                    "1. Tap the share button (square with an up-arrow)\n" +
                    "2. Scroll down to \"Add to Home Screen\"\n" +
                    "3. Tap Add"
                );
            } else {
                /* Desktop / unknown — generic hint. */
                alert(
                    "Use your browser menu and pick " +
                    "\"Install app\" or \"Add to Home Screen\"."
                );
            }
        });
    }

    /* ---------- 0d. PUSH NOTIFICATIONS (chunk W3) ----------
       Talks to the Madderverse push gateway at PUSH_WORKER_URL.
       Browser permission is requested only after the user's first
       fired pot so the prompt feels earned, not interrogative.
       Opt-in state is mirrored in localStorage so we know whether
       to surface the "subscribed" badge in the account screen
       even before the SW registration resolves.
       ============================================================ */

    /* Live Cloudflare Worker (workers.dev subdomain). If the
       push.onionmadder.rocks custom domain gets provisioned
       later, swap this + redeploy -- the worker answers on
       both once the custom domain is added. */
    const PUSH_WORKER_URL = "https://madderverse-push.onionmadder.workers.dev";

    /* PASTE the VAPID public key here AFTER you generate it on the
       worker side. Until set, the subscribe flow short-circuits
       with a friendly "not configured yet" message instead of
       throwing. The same key is set as VAPID_PUBLIC_KEY in the
       Cloudflare Worker secrets — they must match.            */
    const VAPID_PUBLIC_KEY = "BF7amYCYvu6JVmYOcuJM6wx6XN9CaqOGgQPDnYVc2s9GKcoDwXkoywiZLu6RbkeAnhqJRjV8JzTA6o8bMlGjK24";

    const PUSH_KEYS = {
        prompted:       "pootery-push-prompted",
        optIn:          "pootery-push-opt-in",
        endpoint:       "pootery-push-endpoint",
        dismissedUntil: "pootery-push-dismissed-until"
    };

    /* True iff the build has a real VAPID public key wired. */
    function pushConfigured() {
        return typeof VAPID_PUBLIC_KEY === "string" &&
               VAPID_PUBLIC_KEY.indexOf("REPLACE_WITH_") !== 0 &&
               VAPID_PUBLIC_KEY.length > 40;
    }

    /* The browser can be in five states; we surface the union to
       the settings UI:
         "unsupported" – no SW or PushManager (older iOS Safari)
         "denied"      – the user blocked notifications globally
         "default"     – never asked yet
         "granted-on"  – granted + currently subscribed via us
         "granted-off" – granted, but we don't have an active sub
       This is read by refreshPushSettingsUI(). */
    function pushSupported() {
        return "serviceWorker" in navigator &&
               "PushManager" in window &&
               "Notification" in window;
    }

    function pushState() {
        if (!pushSupported()) return "unsupported";
        const perm = Notification.permission;
        if (perm === "denied")  return "denied";
        if (perm === "default") return "default";
        try {
            return localStorage.getItem(PUSH_KEYS.optIn) === "yes"
                ? "granted-on"
                : "granted-off";
        } catch (_) { return "granted-off"; }
    }

    /* base64url -> Uint8Array for the applicationServerKey. */
    function b64urlToUint8(s) {
        const pad   = "=".repeat((4 - s.length % 4) % 4);
        const norm  = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
        const bin   = atob(norm);
        const out   = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function getSWRegistration() {
        if (!("serviceWorker" in navigator)) return Promise.resolve(null);
        return navigator.serviceWorker.ready.catch(function () { return null; });
    }

    /* Subscribe + POST to the gateway. Resolves with
       { ok:bool, reason?:string }. Caller is responsible for
       toggling permission first. */
    function pushSubscribe(userId) {
        if (!pushSupported())  return Promise.resolve({ ok: false, reason: "unsupported" });
        if (!pushConfigured()) return Promise.resolve({ ok: false, reason: "unconfigured" });
        return getSWRegistration().then(function (reg) {
            if (!reg) return { ok: false, reason: "no-sw" };
            return reg.pushManager.subscribe({
                userVisibleOnly:      true,
                applicationServerKey: b64urlToUint8(VAPID_PUBLIC_KEY)
            }).then(function (sub) {
                const json = sub.toJSON();
                /* Persist endpoint client-side so unsubscribe works
                   even if pushManager.getSubscription() returns null
                   later (Safari has been known to lose track). */
                try {
                    localStorage.setItem(PUSH_KEYS.endpoint, json.endpoint || "");
                    localStorage.setItem(PUSH_KEYS.optIn, "yes");
                } catch (_) {}
                return fetch(PUSH_WORKER_URL + "/subscribe", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({
                        subscription: json,
                        user_id:      userId || null
                    })
                }).then(function (r) {
                    return { ok: r.ok, reason: r.ok ? "" : "gateway-" + r.status };
                }).catch(function (e) {
                    return { ok: false, reason: "network: " + (e && e.message || e) };
                });
            }).catch(function (e) {
                return { ok: false, reason: "subscribe: " + (e && e.message || e) };
            });
        });
    }

    function pushUnsubscribe() {
        if (!pushSupported()) return Promise.resolve({ ok: true });
        return getSWRegistration().then(function (reg) {
            if (!reg) return { ok: true };
            return reg.pushManager.getSubscription().then(function (sub) {
                const endpoint = (sub && sub.endpoint) ||
                    (function () {
                        try { return localStorage.getItem(PUSH_KEYS.endpoint) || ""; }
                        catch (_) { return ""; }
                    })();
                const localCleanup = function () {
                    try {
                        localStorage.setItem(PUSH_KEYS.optIn, "no");
                        localStorage.removeItem(PUSH_KEYS.endpoint);
                    } catch (_) {}
                };
                /* Tell the gateway first (so it stops sending), then
                   drop the browser-side subscription. Either step
                   can fail without affecting the user's intent. */
                const tellWorker = endpoint
                    ? fetch(PUSH_WORKER_URL + "/unsubscribe", {
                          method:  "POST",
                          headers: { "Content-Type": "application/json" },
                          body:    JSON.stringify({ endpoint: endpoint })
                      }).catch(function () { /* best-effort */ })
                    : Promise.resolve();
                return tellWorker.then(function () {
                    if (!sub) { localCleanup(); return { ok: true }; }
                    return sub.unsubscribe().then(function () {
                        localCleanup();
                        return { ok: true };
                    }).catch(function () {
                        localCleanup();
                        return { ok: true };
                    });
                });
            });
        });
    }

    /* ----- After-first-pot prompt -----
       Lives as an overlay sheet in index.html (#pushOptInModal).
       autoSaveFiredPot() calls maybeShowPushOptIn() once a pot
       has been saved -- ONE TIME ever, and only if we haven't
       prompted before + we're not inside a "maybe-later"
       cool-down. */

    const PUSH_DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   /* 7 days */

    function maybeShowPushOptIn() {
        if (!pushSupported())  return;
        if (!pushConfigured()) return;
        if (Notification.permission !== "default") return;
        try {
            if (localStorage.getItem(PUSH_KEYS.prompted) === "yes") return;
            const until = parseInt(localStorage.getItem(PUSH_KEYS.dismissedUntil) || "0", 10);
            if (until && Date.now() < until) return;
        } catch (_) {}
        showPushOptInModal();
    }

    function showPushOptInModal() {
        const modal = document.getElementById("pushOptInModal");
        if (!modal) return;
        modal.hidden = false;
    }

    function hidePushOptInModal() {
        const modal = document.getElementById("pushOptInModal");
        if (modal) modal.hidden = true;
    }

    function initPushOptInModal() {
        const yes  = document.getElementById("pushOptInYes");
        const no   = document.getElementById("pushOptInNo");
        const modal = document.getElementById("pushOptInModal");
        if (!modal) return;

        const markPrompted = function () {
            try { localStorage.setItem(PUSH_KEYS.prompted, "yes"); } catch (_) {}
        };

        if (yes) yes.addEventListener("click", function () {
            yes.disabled = true;
            const lbl = yes.querySelector(".btn-label");
            if (lbl) lbl.textContent = "REQUESTING...";
            Notification.requestPermission().then(function (perm) {
                yes.disabled = false;
                if (lbl) lbl.textContent = "YES, NOTIFY ME";
                markPrompted();
                if (perm === "granted") {
                    pushSubscribe(currentUserId()).then(function (res) {
                        if (!res.ok) {
                            console.warn("[CRAYte] push subscribe failed:", res.reason);
                        }
                        refreshPushSettingsUI();
                        hidePushOptInModal();
                    });
                } else {
                    refreshPushSettingsUI();
                    hidePushOptInModal();
                }
            });
        });

        if (no) no.addEventListener("click", function () {
            try {
                localStorage.setItem(
                    PUSH_KEYS.dismissedUntil,
                    String(Date.now() + PUSH_DISMISS_WINDOW_MS)
                );
            } catch (_) {}
            markPrompted();
            hidePushOptInModal();
        });

        /* Click outside the card closes (same as "maybe later"). */
        modal.addEventListener("click", function (e) {
            if (e.target === modal && no) no.click();
        });
    }

    /* Helper -- returns AUTH user.id if signed in, otherwise null. */
    function currentUserId() {
        try {
            return (AUTH && AUTH.session && AUTH.session.user &&
                    AUTH.session.user.id) || null;
        } catch (_) { return null; }
    }

    /* ----- Account screen toggle -----
       The toggle is a single button that reflects pushState():
         - granted-on  -> "ON"    -> tapping unsubscribes
         - granted-off -> "OFF"   -> tapping subscribes
         - default     -> "OFF"   -> tapping requests permission first
         - denied      -> shown disabled with "BLOCKED IN BROWSER"
         - unsupported -> hidden entirely (no UI noise for an
                          unsupported browser)                          */

    function refreshPushSettingsUI() {
        const card     = document.getElementById("pushSettingsCard");
        const btn      = document.getElementById("pushToggleBtn");
        const lbl      = btn && btn.querySelector(".btn-label");
        const note     = document.getElementById("pushSettingsNote");
        if (!card || !btn) return;

        if (!pushSupported()) { card.hidden = true; return; }
        card.hidden = false;

        if (!pushConfigured()) {
            btn.disabled = true;
            if (lbl) lbl.textContent = "COMING SOON";
            if (note) note.textContent = "Notifications haven't been turned on for this build yet.";
            return;
        }

        const state = pushState();
        btn.disabled = false;
        if (state === "denied") {
            btn.disabled = true;
            if (lbl) lbl.textContent = "BLOCKED IN BROWSER";
            if (note) note.textContent =
                "Notifications are blocked at the browser level. Enable them in your site settings to turn this on.";
            return;
        }
        if (state === "granted-on") {
            if (lbl) lbl.textContent = "ON";
            btn.classList.add("is-on");
            if (note) note.textContent =
                "You'll get a heads-up for new packs + battle starts/ends.";
            return;
        }
        btn.classList.remove("is-on");
        if (lbl) lbl.textContent = "OFF";
        if (note) note.textContent =
            "Tap to get a heads-up for new packs + battle starts/ends.";
    }

    function initPushSettingsToggle() {
        const btn = document.getElementById("pushToggleBtn");
        if (!btn) return;
        btn.addEventListener("click", function () {
            const state = pushState();
            btn.disabled = true;
            const lbl = btn.querySelector(".btn-label");
            const restore = function () { btn.disabled = false; refreshPushSettingsUI(); };

            if (state === "granted-on") {
                if (lbl) lbl.textContent = "UNSUBSCRIBING...";
                pushUnsubscribe().then(restore);
                return;
            }
            if (state === "default") {
                if (lbl) lbl.textContent = "REQUESTING...";
                Notification.requestPermission().then(function (perm) {
                    if (perm !== "granted") { restore(); return; }
                    pushSubscribe(currentUserId()).then(restore);
                });
                return;
            }
            /* granted-off path */
            if (lbl) lbl.textContent = "SUBSCRIBING...";
            pushSubscribe(currentUserId()).then(restore);
        });
    }

    /* ---------- 0bb. WEEKLY THEME ----------
       The battle theme rotates every Thursday at 00:00 UTC, so
       the whole world is on the same prompt the same week. The
       anchor (2026-01-01) is itself a Thursday, so every
       THEME_ANCHOR + 7n boundary lands on a Thursday for free.

       THEME_SCHEDULE is just an ordered list — append as many
       future weeks as you want; it modulo-wraps, so the game
       NEVER breaks if the schedule isn't topped up (it simply
       cycles). ~5 months / 20 weeks seeded below; add more any
       time, no other code changes needed.                      */

    const THEME_ANCHOR = Date.UTC(2026, 0, 1); /* Thu 2026-01-01 */
    const WEEK_MS = 7 * 86400000;

    const THEME_SCHEDULE = [
        "BLUE",    "MONSTER", "GOLD",    "SLIME",
        "SPOOKY",  "RAINBOW", "ROBOT",   "CANDY",
        "ICE",     "JUNGLE",  "GALAXY",  "FANCY",
        "TINY",    "FIRE",    "OCEAN",   "WIZARD",
        "GLITCH",  "ANCIENT", "GHOST",   "VOLCANO"
    ];

    /* Whole Thursday-weeks since the anchor (clamped >= 0 so any
       date before the anchor still resolves to week 0). UTC keeps
       the rollover identical for everyone, worldwide. */
    function weekIndex(d) {
        const utcMid = Date.UTC(
            d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        const w = Math.floor((utcMid - THEME_ANCHOR) / WEEK_MS);
        return w < 0 ? 0 : w;
    }

    function currentWeekKey() { return weekIndex(new Date()); }

    function currentTheme() {
        const L = THEME_SCHEDULE.length;
        return THEME_SCHEDULE[currentWeekKey() % L];
    }

    /* Back-compat alias — older call sites still call todaysTheme(). */
    function todaysTheme() { return currentTheme(); }

    /* "daily-bot" is kept as the system author string for backward
       compat with rows already in the DB + the sort/style code.
       Identity is now the Thursday-WEEK the battle was created in,
       so ONE bot battle serves the whole week regardless of the
       row's server-side expiry. Falls back to theme + still-live
       if a row somehow has no created_at. */
    function isTodayDailyBattle(b) {
        if (!b || b.created_by !== "daily-bot") return false;
        if (b.created_at) {
            return weekIndex(new Date(b.created_at)) === currentWeekKey();
        }
        return b.theme === currentTheme() &&
               new Date(b.expires_at).getTime() > Date.now();
    }

    /* createBattle without owner attribution. user_id stays NULL
       so the row is system-owned, not credited to whichever user
       happened to be online first. */
    function createDailyBattle(theme) {
        if (!supabaseEnabled()) return Promise.resolve(null);
        return fetch(SUPABASE_URL + "/rest/v1/battles", {
            method: "POST",
            headers: supabaseHeaders({
                "Content-Type": "application/json",
                "Prefer":       "return=representation"
            }),
            body: JSON.stringify({
                theme: theme,
                created_by: "daily-bot",
                user_id: null
            })
        })
            .then(function (r) {
                if (!r.ok) return null;
                return r.json().then(function (rows) {
                    return Array.isArray(rows) && rows[0] ? rows[0] : null;
                });
            })
            .catch(function () { return null; });
    }

    /* ---------- 0b. POT BATTLES (Day 5 chunk F) ----------
       Backend helpers for the battles / battle_entries /
       battle_votes tables. UI lives in the BATTLES gallery tab
       further down. Two limits stack: (1) the server's
       unique(entry_id, voter_token) constraint stops voting the
       same entry twice (409 -> treated as "already voted"), and
       (2) a client-side one-vote-per-calendar-day cap
       (hasVotedToday / markVotedToday) — same trust level as the
       per-browser token, no backend change.                    */

    /* Per-browser voter token (uuid v4 cached in localStorage).
       Also doubles as the device id for "you submitted this
       entry" lookups so people can't vote for their own.      */
    function getVoterToken() {
        let t = localStorage.getItem("crayte-voter-token");
        if (!t) {
            if (crypto && crypto.randomUUID) {
                t = crypto.randomUUID();
            } else {
                t = "voter-" + Date.now().toString(36) + "-" +
                    Math.random().toString(36).slice(2, 10);
            }
            try { localStorage.setItem("crayte-voter-token", t); }
            catch (_) {}
        }
        return t;
    }

    /* Persisted author byline across submissions. */
    function getRememberedAuthor() {
        return localStorage.getItem("crayte-author") || "";
    }

    function rememberAuthor(name) {
        if (!name) return;
        try { localStorage.setItem("crayte-author", name); }
        catch (_) {}
    }

    function fetchBattles(limit) {
        if (!supabaseEnabled()) return Promise.resolve([]);
        const n = Math.max(1, Math.min(50, limit || 20));
        const url = SUPABASE_URL +
            "/rest/v1/battles?select=*&order=created_at.desc&limit=" + n;
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(enrichWithProfiles)
            .catch(function (e) {
                console.warn("[CRAYte] battles fetch failed", e);
                return [];
            });
    }

    function createBattle(theme, author) {
        if (!supabaseEnabled()) return Promise.resolve(null);
        return fetch(SUPABASE_URL + "/rest/v1/battles", {
            method: "POST",
            headers: supabaseHeaders({
                "Content-Type": "application/json",
                "Prefer":       "return=representation"
            }),
            body: JSON.stringify({
                theme: theme.slice(0, 40),
                created_by: (author || "anonymous").slice(0, 40),
                user_id: currentUserId()
            })
        })
            .then(function (r) {
                if (!r.ok) return null;
                return r.json().then(function (rows) {
                    return Array.isArray(rows) && rows[0] ? rows[0] : null;
                });
            })
            .catch(function (e) {
                console.warn("[CRAYte] battle create failed", e);
                return null;
            });
    }

    function fetchBattleEntries(battleId) {
        if (!supabaseEnabled()) return Promise.resolve([]);
        const url = SUPABASE_URL + "/rest/v1/battle_entries?select=*" +
            "&battle_id=eq." + encodeURIComponent(battleId) +
            "&order=created_at.asc";
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(enrichWithProfiles)
            .catch(function (e) {
                console.warn("[CRAYte] entries fetch failed", e);
                return [];
            });
    }

    /* Vote counts for a battle's entries — fetched as raw vote
       rows + grouped client-side. PostgREST also supports an
       aggregate endpoint but the row-count is small enough that
       the simple GET is cleaner.                              */
    function fetchBattleVotes(entryIds) {
        if (!supabaseEnabled() || !entryIds || entryIds.length === 0) {
            return Promise.resolve([]);
        }
        const inClause = encodeURIComponent("(" + entryIds.join(",") + ")");
        const url = SUPABASE_URL + "/rest/v1/battle_votes?select=*" +
            "&entry_id=in." + inClause;
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .catch(function (e) {
                console.warn("[CRAYte] votes fetch failed", e);
                return [];
            });
    }

    function submitBattleEntry(battleId, entry, author) {
        if (!supabaseEnabled()) return Promise.resolve(null);
        const body = {
            battle_id:      battleId,
            name:           entry.name || "UNNAMED",
            author:         (author || "anonymous").slice(0, 40),
            pack_id:        entry.packId       || null,
            clay_type_id:   entry.clayTypeId   || null,
            fired:          !!entry.fired,
            overfired:      !!entry.overfired,
            exploded:       !!entry.exploded,
            clay:           entry.clay         || null,
            paint_data_url: entry.paintDataUrl || null,
            user_id:        currentUserId()
        };
        return fetch(SUPABASE_URL + "/rest/v1/battle_entries", {
            method: "POST",
            headers: supabaseHeaders({
                "Content-Type": "application/json",
                "Prefer":       "return=representation"
            }),
            body: JSON.stringify(body)
        })
            .then(function (r) {
                if (!r.ok) return null;
                return r.json().then(function (rows) {
                    return Array.isArray(rows) && rows[0] ? rows[0] : null;
                });
            })
            .catch(function (e) {
                console.warn("[CRAYte] battle submit failed", e);
                return null;
            });
    }

    function voteForEntry(entryId) {
        if (!supabaseEnabled()) return Promise.resolve({ ok: false });
        const token = getVoterToken();
        return fetch(SUPABASE_URL + "/rest/v1/battle_votes", {
            method: "POST",
            headers: supabaseHeaders({
                "Content-Type": "application/json",
                "Prefer":       "return=representation"
            }),
            body: JSON.stringify({
                entry_id:    entryId,
                voter_token: token
            })
        })
            .then(function (r) {
                /* PostgREST returns 409 on unique-constraint
                   violation — i.e. "you already voted". */
                if (r.status === 409) return { ok: false, duplicate: true };
                return r.ok ? { ok: true } : { ok: false };
            })
            .catch(function (e) {
                console.warn("[CRAYte] vote failed", e);
                return { ok: false };
            });
    }

    /* ---------- 0. AUDIO BOOTSTRAP ----------
       Single shared AudioContext. Web Audio requires a user
       gesture to start; we lazy-create on the first gesture
       anywhere on the page, then any sound function can call
       ensureAudio() to get the context (returns null if creation
       failed or the context is still suspended — sound funcs
       must no-op silently in that case). KILN, SHAPE, and the
       title-screen poot all route through here.                */

    let audioCtx = null;

    function ensureAudio() {
        if (audioCtx) {
            if (audioCtx.state === "suspended") {
                try { audioCtx.resume(); } catch (_) {}
            }
            return audioCtx;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            audioCtx = new AC();
            if (audioCtx.state === "suspended") {
                try { audioCtx.resume(); } catch (_) {}
            }
        } catch (e) {
            audioCtx = null;
        }
        return audioCtx;
    }

    /* First user gesture anywhere on the page unlocks audio. */
    function unlockAudioOnce() {
        ensureAudio();
        document.removeEventListener("pointerdown", unlockAudioOnce, true);
        document.removeEventListener("keydown",     unlockAudioOnce, true);
    }
    document.addEventListener("pointerdown", unlockAudioOnce, true);
    document.addEventListener("keydown",     unlockAudioOnce, true);

    /* "Poot" — short, low, farty sawtooth blip with a tiny pitch
       wobble and a band-pass to round off the buzz. Used on the
       title screen, synced to the clay-drifter animation cycle. */
    /* Poot variants — small/medium/large picked at random so
       repeated title-screen poots don't sound identical. Each
       tunes start pitch, drop ratio, duration, and LFO wobble. */
    const POOT_VARIANTS = [
        { startF: 140, endF: 80,  dur: 0.20, wobble: 22, vol: 0.11 },   /* small */
        { startF: 110, endF: 58,  dur: 0.28, wobble: 17, vol: 0.13 },   /* medium (classic) */
        { startF:  82, endF: 42,  dur: 0.38, wobble: 12, vol: 0.15 },   /* large / longer */
        { startF: 165, endF: 100, dur: 0.15, wobble: 27, vol: 0.10 }    /* squeaker */
    ];

    function poot() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const v = POOT_VARIANTS[Math.floor(Math.random() * POOT_VARIANTS.length)];

        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(v.startF, now);
        osc.frequency.exponentialRampToValueAtTime(v.endF, now + v.dur);

        /* Pitch wobble for the comedic farty character. */
        const lfo = ctx.createOscillator();
        lfo.frequency.value = v.wobble;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 7;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        /* Band-pass shapes it into "poot" not "buzz". */
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 200;
        bp.Q.value = 3.5;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(v.vol, now + 0.025);
        g.gain.exponentialRampToValueAtTime(0.001, now + v.dur + 0.04);

        osc.connect(bp);
        bp.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + v.dur + 0.06);
        lfo.start(now);
        lfo.stop(now + v.dur + 0.06);
    }

    /* Wet-clay sustain — low-pass-filtered noise with an LFO
       riding the cutoff. Subtle, sits under the squelch pops.   */
    let wetLoop = null;

    function wetLoopStart() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        if (wetLoop) return;

        const len = Math.floor(ctx.sampleRate * 0.5);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        /* Pink-ish noise via Voss-McCartney-style filter. */
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + w * 0.0990460;
            b1 = 0.96300 * b1 + w * 0.2965164;
            b2 = 0.57000 * b2 + w * 1.0526913;
            data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.13;
        }

        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 480;
        lp.Q.value = 3.5;

        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 2.2;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 260;
        lfo.connect(lfoGain);
        lfoGain.connect(lp.frequency);

        const g = ctx.createGain();
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.08, now + 0.10);

        src.connect(lp);
        lp.connect(g);
        g.connect(ctx.destination);
        src.start(now);
        lfo.start(now);

        wetLoop = { src: src, lfo: lfo, g: g, ctx: ctx };
    }

    function wetLoopStop() {
        if (!wetLoop) return;
        const { src, lfo, g, ctx } = wetLoop;
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.18);
        try { src.stop(now + 0.20); } catch (_) {}
        try { lfo.stop(now + 0.20); } catch (_) {}
        wetLoop = null;
    }

    /* Wheel hum — a low sustained drone that plays whenever the
       wheel is visually spinning (shape / decorate / kiln). Two
       slightly-detuned sines through a low-pass + tremolo so it
       has texture without being intrusive. ~0.03 gain — sits
       under everything else.                                   */
    let wheelHum = null;

    function wheelHumStart() {
        /* Prefer the recorded looping spinning-wheel ambient.
           Synth oscillator hum below is the fallback. */
        if (WHEEL_AMBIENT.start()) return;
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        if (wheelHum) return;
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = "sine";
        osc2.type = "sine";
        osc1.frequency.value = 78;
        osc2.frequency.value = 78 * 1.012;   /* tiny detune */

        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 280;
        lp.Q.value = 0.7;

        /* Slow tremolo */
        const trem = ctx.createOscillator();
        trem.type = "sine";
        trem.frequency.value = 0.6;
        const tremGain = ctx.createGain();
        tremGain.gain.value = 0.008;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.03, now + 0.4);

        trem.connect(tremGain);
        tremGain.connect(g.gain);

        osc1.connect(lp);
        osc2.connect(lp);
        lp.connect(g);
        g.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        trem.start(now);

        wheelHum = { osc1, osc2, trem, g, ctx };
    }

    function wheelHumStop() {
        /* Stop both the recorded ambient AND the synth fallback —
           idempotent; whichever wasn't running becomes a no-op. */
        WHEEL_AMBIENT.stop();
        if (!wheelHum) return;
        const { osc1, osc2, trem, g, ctx } = wheelHum;
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.40);
        try { osc1.stop(now + 0.45); } catch (_) {}
        try { osc2.stop(now + 0.45); } catch (_) {}
        try { trem.stop(now + 0.45); } catch (_) {}
        wheelHum = null;
    }

    /* Brush stroke softness — short high-pass noise puff. Fires
       on a fraction of paint moves so a long stroke sounds like
       a stream of soft bristly "shh"es rather than a constant
       hiss. Volume ~0.04.                                       */
    function brushStroke() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;

        const len = Math.floor(ctx.sampleRate * 0.10);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.exp(-i / len * 3);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;

        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 2200 + Math.random() * 800;
        hp.Q.value = 0.7;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0,    now);
        g.gain.linearRampToValueAtTime(0.04, now + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.10);

        src.connect(hp);
        hp.connect(g);
        g.connect(ctx.destination);
        src.start(now);
    }

    /* Spray hiss — prefers the recorded spray-paint.mp3 (pool of
       3 so rapid taps overlap). Synth high-pass noise puff below
       is the fallback. */
    function spraySound() {
        if (SPRAY_SFX && SPRAY_SFX.play(0.9)) return;
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.05);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 1.5);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 4200 + Math.random() * 800;
        const g = ctx.createGain();
        g.gain.value = 0.03;
        src.connect(hp); hp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    /* Splatter — short wet "thwap". Brown noise burst through a
       fast-decaying low-bandpass. One per actual splat event. */
    function splatterSound() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.10);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            last = (last + 0.04 * w) / 1.04;
            const env = Math.pow(1 - i / len, 2.8);
            data[i] = last * 4 * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(230 + Math.random() * 90, now);
        bp.frequency.exponentialRampToValueAtTime(80, now + 0.06);
        bp.Q.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.13, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        src.connect(bp); bp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    /* Stamp click — sharp wood-block-ish pluck. Two stacked
       sines (high + low) with a tight envelope. One per stamp
       placement, no throttle needed.                            */
    function stampClick() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;

        /* High click */
        const oscH = ctx.createOscillator();
        oscH.type = "sine";
        oscH.frequency.setValueAtTime(1800, now);
        oscH.frequency.exponentialRampToValueAtTime(900, now + 0.05);
        const gH = ctx.createGain();
        gH.gain.setValueAtTime(0,    now);
        gH.gain.linearRampToValueAtTime(0.10, now + 0.003);
        gH.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        oscH.connect(gH);
        gH.connect(ctx.destination);

        /* Body */
        const oscL = ctx.createOscillator();
        oscL.type = "triangle";
        oscL.frequency.setValueAtTime(420, now);
        oscL.frequency.exponentialRampToValueAtTime(180, now + 0.08);
        const gL = ctx.createGain();
        gL.gain.setValueAtTime(0,    now);
        gL.gain.linearRampToValueAtTime(0.08, now + 0.004);
        gL.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        oscL.connect(gL);
        gL.connect(ctx.destination);

        oscH.start(now); oscH.stop(now + 0.12);
        oscL.start(now); oscL.stop(now + 0.16);
    }

    /* Haptic feedback — no-ops on platforms without vibrate.
       Patterns chosen to feel like the matching audio event.    */
    function haptic(pattern) {
        if (!navigator.vibrate) return;
        try { navigator.vibrate(pattern); } catch (_) {}
    }

    /* Squelch — sloppier, wetter "blorp" than the original
       chunk-7 version: wider pitch sweep, longer tail, higher
       Q for more resonance, occasional double-blip via a
       second deeper layer for cartoon mouth-feel. Fires on
       actual clay deformation; throttled in applyShaping so a
       sustained drag emits one every ~90-160ms.                */
    /* User-recorded clay audio (splat for lump-on-wheel + six
       squelches for shaping) sits in assets/audio/. We prefer
       the files; if any pool fails to load (e.g. very first run
       offline, or the file was renamed) we transparently fall
       back to the synth squelch below — the app can never go
       silent. Each file is wrapped in a small pool of Audio
       objects so two rapid plays don't clobber each other. */

    const CLAY_SFX_POOL_SIZE = 3;
    const SQUELCH_FILE_NAMES = [
        "squelch-one",   "squelch-two",  "squelch-three",
        "squelch-four",  "squelch-five", "squelch-six"
    ];

    function makeAudioPool(src) {
        const pool = [];
        let failed = false;
        for (let i = 0; i < CLAY_SFX_POOL_SIZE; i++) {
            const a = new Audio(src);
            a.preload = "auto";
            a.addEventListener("error", function () { failed = true; });
            pool.push(a);
        }
        return {
            play: function (vol) {
                if (failed) return false;
                /* Find a free Audio (paused / ended); else steal #0. */
                let pick = null;
                for (let i = 0; i < pool.length; i++) {
                    if (pool[i].paused || pool[i].ended) {
                        pick = pool[i]; break;
                    }
                }
                if (!pick) pick = pool[0];
                try {
                    pick.currentTime = 0;
                    pick.volume = (vol == null) ? 1 : vol;
                    const p = pick.play();
                    /* Suppress unhandled rejections from autoplay
                       policy / brief race conditions — fallback
                       below still gives us synth coverage. */
                    if (p && typeof p.catch === "function") {
                        p.catch(function () {});
                    }
                    return true;
                } catch (_) { return false; }
            }
        };
    }

    const CLAY_SFX = {
        splat: makeAudioPool("assets/audio/splat.mp3"),
        squelches: SQUELCH_FILE_NAMES.map(function (n) {
            return makeAudioPool("assets/audio/" + n + ".mp3");
        })
    };

    /* Kiln audio: one single recorded track for the entire firing
       moment (was previously split into door + fire). Plays at
       firing-stage entry; closing/opening stages are silent
       (the recording covers the dramatic arc itself). */
    const KILN_SFX = {
        sequence: makeAudioPool("assets/audio/kiln-sequence.mp3")
    };

    /* Recorded fire sequence preferred; synth kilnRoar kept as
       fallback. */
    function kilnSequencePlay(durationSec) {
        if (KILN_SFX.sequence && KILN_SFX.sequence.play(1.0)) return;
        if (typeof kilnRoar === "function") kilnRoar(durationSec);
    }

    /* Ambient looping spinning-wheel — plays underneath squelches
       during the entire shape/decorate/kiln cycle. One Audio
       element (not a pool — single ambient track), .loop=true,
       moderate volume so the squelches sit on top. Replaces the
       synth wheel hum; synth wheelHumStart still fires as a
       fallback if the file fails. */
    const WHEEL_AMBIENT = (function () {
        try {
            const a = new Audio("assets/audio/spinning-wheel.mp3");
            a.preload = "auto";
            a.loop = true;
            a.volume = 0.55;
            let failed = false;
            a.addEventListener("error", function () { failed = true; });
            return {
                start: function () {
                    if (failed) return false;
                    try {
                        const p = a.play();
                        if (p && typeof p.catch === "function") p.catch(function () {});
                        return true;
                    } catch (_) { return false; }
                },
                stop: function () {
                    try { a.pause(); a.currentTime = 0; } catch (_) {}
                }
            };
        } catch (_) {
            return { start: function () { return false; }, stop: function () {} };
        }
    }());

    /* Spray-paint recording for the SPRAY decorate tool — replaces
       the synth spraySound. Pool of 3 so rapid taps overlap. */
    const SPRAY_SFX = makeAudioPool("assets/audio/spray-paint.mp3");

    /* Squelch ships in 4 timbre variants randomly chosen on each
       call so sustained shaping doesn't repeat the same beat.
       Each variant tunes the noise sweep + decides whether to
       layer the deep blorp. SHARP = quick high tap, WET = the
       classic, BLORP = low blubbery, PLOP = quick wet drop. */
    const SQUELCH_VARIANTS = ["sharp", "wet", "blorp", "plop"];

    function squelch() {
        /* Prefer the recorded squelches — random pick from the six. */
        const list = CLAY_SFX.squelches;
        if (list && list.length) {
            const idx = Math.floor(Math.random() * list.length);
            if (list[idx].play(1.0)) return;
        }
        /* Synth fallback so the game never goes silent. */
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const variant = SQUELCH_VARIANTS[
            Math.floor(Math.random() * SQUELCH_VARIANTS.length)
        ];
        playSquelchVariant(variant);
    }

    /* Lump landing on the wheel — the recorded splat. Synth
       fallback is the original juicy double-blop. */
    function claySplat() {
        if (CLAY_SFX.splat && CLAY_SFX.splat.play(1.0)) return;
        playSquelchVariant("plop");
        setTimeout(function () { squelch(); }, 80);
    }

    function playSquelchVariant(variant) {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;

        /* Per-variant timbre parameters. */
        const params = (function () {
            switch (variant) {
                case "sharp":
                    return {
                        len: 0.085, startF: 720, endR: 0.40,
                        Q: 9.5,  vol: 0.10, decay: 0.09,
                        blorpChance: 0.10, blorpF: 180, blorpDecay: 0.06
                    };
                case "blorp":
                    return {
                        len: 0.20, startF: 320, endR: 0.20,
                        Q: 6,    vol: 0.10, decay: 0.20,
                        blorpChance: 0.85, blorpF: 90,  blorpDecay: 0.14
                    };
                case "plop":
                    return {
                        len: 0.10, startF: 540, endR: 0.30,
                        Q: 7.5,  vol: 0.12, decay: 0.10,
                        blorpChance: 0.55, blorpF: 130, blorpDecay: 0.11
                    };
                default:   /* "wet" — the classic */
                    return {
                        len: 0.14, startF: 360 + Math.random() * 460, endR: 0.28 + Math.random() * 0.32,
                        Q: 8,    vol: 0.11, decay: 0.14,
                        blorpChance: 0.30, blorpF: 110, blorpDecay: 0.10
                    };
            }
        }());

        /* Layer 1: noise sweep — the wet attack */
        const len1 = Math.floor(ctx.sampleRate * params.len);
        const buf1 = ctx.createBuffer(1, len1, ctx.sampleRate);
        const data1 = buf1.getChannelData(0);
        for (let i = 0; i < len1; i++) {
            const env = Math.exp(-i / len1 * 3.2);
            data1[i] = (Math.random() * 2 - 1) * env;
        }
        const src1 = ctx.createBufferSource();
        src1.buffer = buf1;
        const bp1 = ctx.createBiquadFilter();
        bp1.type = "bandpass";
        const startF = params.startF;
        const endF   = startF * params.endR;
        bp1.frequency.setValueAtTime(startF, now);
        bp1.frequency.exponentialRampToValueAtTime(endF, now + params.decay * 0.7);
        bp1.Q.value = params.Q;
        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(0,    now);
        g1.gain.linearRampToValueAtTime(params.vol, now + 0.005);
        g1.gain.exponentialRampToValueAtTime(0.001, now + params.decay);
        src1.connect(bp1); bp1.connect(g1); g1.connect(ctx.destination);
        src1.start(now);

        /* Layer 2: optional deep "blorp" body */
        if (Math.random() < params.blorpChance) {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            const f0 = params.blorpF + Math.random() * 30;
            osc.frequency.setValueAtTime(f0, now);
            osc.frequency.exponentialRampToValueAtTime(f0 * 0.55,
                now + params.blorpDecay * 0.8);
            const g2 = ctx.createGain();
            g2.gain.setValueAtTime(0.06, now);
            g2.gain.exponentialRampToValueAtTime(0.001, now + params.blorpDecay);
            osc.connect(g2); g2.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + params.blorpDecay + 0.02);
        }
    }

    /* ---------- 1. SCREEN ROUTER ----------
       Screens are <main class="screen" id="screen-{id}">. Showing
       one hides the others. Each screen optionally registers an
       onEnter / onLeave hook via registerScreen(). The body's
       class swaps in lockstep so screen-specific CSS can hook.   */

    const SCREENS = Object.create(null);

    function registerScreen(id, hooks) {
        SCREENS[id] = Object.assign(
            { onEnter: null, onLeave: null },
            hooks || {}
        );
    }

    let currentScreen = "title";

    function showScreen(id) {
        const target = document.getElementById("screen-" + id);
        if (!target) {
            console.warn("[CRAYte] no screen:", id);
            return;
        }

        const prev = SCREENS[currentScreen];
        if (prev && typeof prev.onLeave === "function") {
            try { prev.onLeave(); }
            catch (e) { console.error("[CRAYte] onLeave " + currentScreen, e); }
        }

        document.querySelectorAll("main.screen").forEach(function (el) {
            el.hidden = true;
        });
        target.hidden = false;

        document.body.classList.remove("screen-" + currentScreen);
        document.body.classList.add("screen-" + id);
        currentScreen = id;

        const next = SCREENS[id];
        if (next && typeof next.onEnter === "function") {
            try { next.onEnter(); }
            catch (e) { console.error("[CRAYte] onEnter " + id, e); }
        }

        window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }

    /* ---------- 1b. ANDROID HARDWARE / GESTURE BACK ----------
       @capacitor/app surfaces the system Back gesture as a
       'backButton' event. With no listener Android kills the
       whole app on every back press — brutal mid-pot. Route it:
       close an open modal first, else step up the screen tree,
       and only exit from the title. The web build has no
       window.Capacitor so this is inert there (browser Back is
       untouched). */
    const BACK_PARENT = {
        shape: "title",
        decorate: "shape",
        kiln: "decorate",
        gallery: "title",
        shop: "title",
        achievements: "title",
        profile: "title",
        account: "profile",
        stats: "title"
    };

    /* Full-screen modals are overlays toggled via [hidden]. Back
       should dismiss the open one before navigating. Ordered
       most-transient first; the close fns reset inputs/state. */
    function closeTopModal() {
        const modals = [
            ["devMenu",           typeof closeDevMenu === "function" ? closeDevMenu : null],
            ["submitPickerModal", typeof closeSubmitPicker === "function" ? closeSubmitPicker : null],
            ["createBattleModal", typeof closeCreateBattleModal === "function" ? closeCreateBattleModal : null],
            ["battleDetail",      typeof closeBattleDetail === "function" ? closeBattleDetail : null],
            ["potDetail",         typeof closeDetail === "function" ? closeDetail : null],
            ["specsPanel",        null]
        ];
        for (let i = 0; i < modals.length; i++) {
            const el = document.getElementById(modals[i][0]);
            if (el && !el.hidden) {
                if (modals[i][1]) { try { modals[i][1](); } catch (_) {} }
                else el.hidden = true;
                return true;
            }
        }
        return false;
    }

    function capacitorApp() {
        return window.Capacitor &&
               window.Capacitor.Plugins &&
               window.Capacitor.Plugins.App;
    }

    function handleHardwareBack() {
        if (closeTopModal()) return;
        const parent = BACK_PARENT[currentScreen];
        if (parent) { showScreen(parent); return; }
        /* Title (or any unmapped root): Back exits the app, the
           Android-standard behavior from a home screen. */
        const App = capacitorApp();
        if (App && typeof App.exitApp === "function") App.exitApp();
    }

    function wireHardwareBack() {
        const App = capacitorApp();
        if (!App || typeof App.addListener !== "function") return; /* web */
        App.addListener("backButton", handleHardwareBack);
    }

    /* ---------- 2. TITLE SCREEN ---------- */

    registerScreen("title", {
        onEnter: function () {
            startClock();
            startTitlePoot();
            wheelHumStop();   /* wheel only hums when it's spinning */
            /* Clear any pending REMIX lineage -- if the user backs
               out to title without firing, the next fresh pot they
               make shouldn't carry stale credit. */
            if (typeof REMIX !== "undefined") {
                REMIX.pending = null;
                if (typeof refreshRemixInProgressChip === "function") {
                    refreshRemixInProgressChip();
                }
            }
        },
        onLeave: function () {
            stopClock();
            stopTitlePoot();
        }
    });

    /* ---------- 2A. TITLE POOT ----------
       The clay-drifter CSS animation is a 14s loop with peak
       visibility around the 50% mark. We schedule a poot at
       ~7s into each cycle so it sounds like the particle is
       making the noise. If audio isn't unlocked yet, poot()
       no-ops silently; the first time it does fire, the user
       has already interacted somewhere so audio is alive.   */

    const TITLE_POOT = {
        firstT: null,    /* setTimeout — initial offset */
        intervalT: null  /* setInterval — repeating cycle */
    };

    function startTitlePoot() {
        stopTitlePoot();
        TITLE_POOT.firstT = setTimeout(function () {
            poot();
            TITLE_POOT.intervalT = setInterval(poot, 14000);
        }, 7000);
    }

    function stopTitlePoot() {
        if (TITLE_POOT.firstT)    clearTimeout(TITLE_POOT.firstT);
        if (TITLE_POOT.intervalT) clearInterval(TITLE_POOT.intervalT);
        TITLE_POOT.firstT = null;
        TITLE_POOT.intervalT = null;
    }

    function initTitle() {
        const btnStart    = document.getElementById("btnStart");
        const btnGallery  = document.getElementById("btnGallery");
        /* Day 4 chunk C: SETTINGS button repurposed to TROPHIES
           (achievements). Old #btnSettings markup is gone — this
           reads #btnTrophies. */
        const btnTrophies = document.getElementById("btnTrophies");

        if (btnStart) {
            btnStart.addEventListener("click", function () {
                /* Chunk 2 mounts #screen-shape and showScreen("shape")
                   becomes the real handoff. For chunk 1, give the user
                   honest, in-character feedback that this is coming. */
                if (SCREENS["shape"]) {
                    /* New pot from the title — start with an empty
                       wheel; the kid drags a lump on to begin. */
                    SHAPE.needsLump = true;
                    showScreen("shape");
                } else {
                    flashStub(btnStart, "WHEEL BOOTING...");
                }
            });
        }

        if (btnGallery) {
            btnGallery.addEventListener("click", function () {
                if (SCREENS["gallery"]) {
                    showScreen("gallery");
                } else {
                    flashStub(btnGallery, "NO POTS YET");
                }
            });
        }

        if (btnTrophies) {
            btnTrophies.addEventListener("click", function () {
                if (SCREENS["achievements"]) {
                    showScreen("achievements");
                } else {
                    flashStub(btnTrophies, "NO TROPHIES YET");
                }
            });
        }

        const btnShop = document.getElementById("btnShop");
        if (btnShop) btnShop.addEventListener("click", function () {
            showScreen("shop");
        });

        const btnStats = document.getElementById("btnStats");
        if (btnStats) btnStats.addEventListener("click", function () {
            showScreen("stats");
        });

        const btnAccount = document.getElementById("btnAccount");
        if (btnAccount) btnAccount.addEventListener("click", function () {
            showScreen("account");
        });

        /* Daily theme banner — populate with today's theme + wire
           tap to land in BATTLES tab on today's daily battle. */
        const dtbBtn   = document.getElementById("dailyThemeBtn");
        const dtbTheme = document.getElementById("dtbTheme");
        if (dtbTheme) dtbTheme.textContent = todaysTheme();
        if (dtbBtn) dtbBtn.addEventListener("click", function () {
            /* Tell BATTLES tab to surface today's daily on its
               next render. Set the flag BEFORE navigating so
               renderBattlesTab can act on it. */
            BATTLE.openDailyOnLoad = true;
            GALLERY.tab = "battles";
            if (SCREENS["gallery"]) {
                showScreen("gallery");
            } else {
                flashStub(dtbBtn, "BATTLES OFFLINE");
            }
        });

        /* Achievements screen back button */
        const achBack = document.getElementById("achBack");
        if (achBack) achBack.addEventListener("click", function () {
            showScreen("title");
        });

        wireSpecsPanel();
        wireInstallButton();
        loadFeaturedStrip();
    }

    /* Featured-pots strip on the title screen. The strip itself
       is always visible (skeleton placeholders pre-rendered in
       index.html occupy the space at page load -- no layout
       shift when real cards swap in). On fetch failure or empty
       DB, the skeleton placeholders stay -- low-key acceptable.
       Lives BELOW the menu so a delayed fetch can't push the
       primary navigation off-screen. */
    function loadFeaturedStrip() {
        const row = document.getElementById("featuredRow");
        if (!row || !supabaseEnabled()) return;
        if (typeof fetchPublicPots !== "function") return;

        fetchPublicPots(6).then(function (rows) {
            if (!rows || rows.length === 0) return;
            /* Shuffle + take the first 2 so reloads feel fresh. */
            const shuffled = rows.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
            }
            const picks = shuffled.slice(0, 2);
            row.innerHTML = "";
            picks.forEach(function (raw) {
                row.appendChild(buildFeaturedCard(raw));
            });
        }).catch(function () { /* silent -- skeletons stay */ });
    }

    function buildFeaturedCard(raw) {
        const entry = normalizePublicRow(raw);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "featured-card";

        const thumb = document.createElement("div");
        thumb.className = "featured-thumb";
        const canvas = document.createElement("canvas");
        canvas.width  = 200;
        canvas.height = 300;
        thumb.appendChild(canvas);
        card.appendChild(thumb);

        const meta = document.createElement("div");
        meta.className = "featured-meta";
        const name = document.createElement("span");
        name.className = "featured-name";
        name.textContent = entry.name || "UNNAMED";
        meta.appendChild(name);

        const profile = raw._profile;
        const by = document.createElement("span");
        by.className = "featured-by";
        by.textContent = profile && profile.username
            ? "@" + profile.username
            : "by " + (raw.author || "anonymous");
        meta.appendChild(by);

        card.appendChild(meta);

        card.addEventListener("click", function () {
            /* Land on gallery -> EVERYONE (data-tab="public" --
               the label is "EVERYONE" but the internal key is
               "public") so the modal close drops into the public
               grid rather than dead-ending on title. */
            GALLERY.tab = "public";
            showScreen("gallery");
            setTimeout(function () { openDetail(entry); }, 200);
        });

        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry);
        });
        return card;
    }

    /* Temporary "feature not built yet" feedback. Swaps the button
       label for a beat. Removed once chunks 2-3 wire real screens. */
    function flashStub(btn, msg) {
        const label = btn.querySelector(".btn-label");
        if (!label) return;
        if (btn._stubT) clearTimeout(btn._stubT);
        const original = label.dataset.orig || label.textContent;
        label.dataset.orig = original;
        label.textContent = msg;
        btn.classList.add("is-stub");
        btn._stubT = setTimeout(function () {
            label.textContent = original;
            btn.classList.remove("is-stub");
        }, 1100);
    }

    /* ---------- 3. SPECS PANEL ----------
       Easter-egg payload (chunk 8) lives here. The opener is the
       small [?] in the corner. Chunk 1 ships the panel itself so
       there's already something to find; chunk 8 layers Konami /
       overheat / PINGAS on top.                                  */

    function wireSpecsPanel() {
        const hook  = document.getElementById("specsHook");
        const panel = document.getElementById("specsPanel");
        const close = document.getElementById("specsClose");
        if (!hook || !panel || !close) return;

        function open() {
            panel.hidden = false;
            document.body.classList.add("specs-open");
            close.focus({ preventScroll: true });
        }
        function shut() {
            panel.hidden = true;
            document.body.classList.remove("specs-open");
            hook.focus({ preventScroll: true });
        }

        hook.addEventListener("click", open);
        close.addEventListener("click", shut);

        panel.addEventListener("click", function (e) {
            if (e.target === panel) shut();
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !panel.hidden) shut();
        });
    }

    /* ---------- 4. CRT CLOCK ----------
       The HH:MM:SS in the top bar. Only ticks while a screen that
       requests it is mounted. Title screen does; in-game screens
       in later chunks may want to suppress it.                   */

    let clockTimer = null;

    function tickClock() {
        const el = document.getElementById("crtClock");
        if (!el) return;
        const d = new Date();
        const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
        el.textContent =
            pad(d.getHours()) + ":" +
            pad(d.getMinutes()) + ":" +
            pad(d.getSeconds());
    }

    function startClock() {
        tickClock();
        if (clockTimer) return;
        clockTimer = setInterval(tickClock, 1000);
    }

    function stopClock() {
        if (!clockTimer) return;
        clearInterval(clockTimer);
        clockTimer = null;
    }

    /* ============================================================
       SHAPE SCREEN — chunk 2: wheel-throwing
       ============================================================
       Model: a 1-D array of sample points along the pot's vertical
       axis. Each sample stores (y, radius). The renderer draws the
       right side of the silhouette by walking the samples bottom
       -> top, then mirrors back down the left side to close the
       path. The pot looks 3-D thanks to a horizontal clay-tone
       gradient + a vertical highlight strip near the centerline.

       Input model: pointer x position relative to the centerline =
       target radius for the slice nearest the pointer's y. A
       gaussian kernel pulls neighboring slices proportionally so
       the deformation is smooth, not a pinch. Each frame eases
       toward the target by SHAPE.EASE (frame-rate independent).

       Real wheel rotation isn't visible on a symmetric clay form,
       so we sell rotation via animated wedges on the wheel platform.
       ============================================================ */

    /* Clay types — chunk A of Day 4. Each entry drives the body
       gradient (left-edge -> center -> right-edge stops), the
       outline, the highlight tint, the fired overlay color, and
       the small picker-swatch color. Currently selected type is
       SHAPE.clayTypeId; the gallery preserves each entry's type
       so a porcelain pot stays porcelain in the vault. Galaxy
       is the weird one — exists for the modder.                */
    const CLAY_TYPES = [
        {
            id: "earthenware",
            label: "EARTH",
            flavor: "Common red clay. The default.",
            unfired: ["#2c1306", "#5a2b14", "#a25a2c", "#b06a36",
                      "#7a3d1a", "#2c1306"],
            swatch: "#a25a2c",
            firedTint: "rgba(180, 70, 22, 0.22)",
            outline:   "#1f0a02",
            highlight: "rgba(255, 224, 184, 0.34)"
        },
        {
            id: "porcelain",
            label: "PORCY",
            flavor: "Smooth white. Very expensive.",
            unfired: ["#9a8d7c", "#cdc1ad", "#ebe3cf", "#f4eddb",
                      "#cfc4af", "#9a8d7c"],
            swatch: "#ebe3cf",
            firedTint: "rgba(255, 218, 175, 0.16)",
            outline:   "#5a4e40",
            highlight: "rgba(255, 255, 240, 0.45)"
        },
        {
            id: "stoneware",
            label: "STONE",
            flavor: "Speckled gray-brown. Practical.",
            unfired: ["#241f1a", "#4d4338", "#7e7361", "#8a7e69",
                      "#5a5042", "#241f1a"],
            swatch: "#7e7361",
            firedTint: "rgba(120, 90, 60, 0.22)",
            outline:   "#1a1612",
            highlight: "rgba(255, 245, 220, 0.34)"
        },
        {
            id: "basalt",
            label: "BASALT",
            flavor: "Volcanic charcoal black.",
            unfired: ["#070707", "#1c1a17", "#3b342e", "#433c34",
                      "#22201c", "#070707"],
            swatch: "#1c1a17",
            firedTint: "rgba(40, 35, 30, 0.34)",
            outline:   "#000000",
            highlight: "rgba(140, 120, 105, 0.48)"
        },
        {
            id: "galaxy",
            label: "GALAXY",
            flavor: "Deep blue. Shimmers if you tilt it.",
            unfired: ["#03060f", "#0d1338", "#1e2880", "#2c3aa0",
                      "#111a52", "#03060f"],
            swatch: "#1e2880",
            firedTint: "rgba(90, 60, 200, 0.30)",
            outline:   "#02030a",
            highlight: "rgba(185, 205, 255, 0.55)"
        }
    ];

    function currentClay() {
        for (let i = 0; i < CLAY_TYPES.length; i++) {
            if (CLAY_TYPES[i].id === SHAPE.clayTypeId) return CLAY_TYPES[i];
        }
        return CLAY_TYPES[0];
    }

    const SHAPE = {
        /* Logical canvas size. Display scales via CSS aspect-ratio;
           backing store is W*dpr × H*dpr. */
        W: 400,
        H: 600,
        centerX: 200,
        baseY:  510,    /* pot base sits here, on the wheel */
        topY:   95,     /* fully-extended pot rim height */

        /* Clay material — see CLAY_TYPES above. Swap via the
           clay-picker tray on the shape screen. */
        clayTypeId: "earthenware",

        /* Sample model */
        N:      28,
        MIN_R:  20,     /* clay can't pinch to nothing */
        MAX_R:  170,    /* clay can't escape the canvas — bumped
                           from 128 so pots can reach actual roundness
                           instead of squaring up against the inner
                           frame (was leaving ~72px of unused margin
                           on each side; now ~30px of breathing room). */
        INIT_R: 72,     /* starting cylinder radius */

        /* Shaping behavior.
           EASE is the per-frame snap rate -- higher = clay catches
           your finger faster, lower = more viscous + you can feel
           it taking shape. 0.30 was Photoshop-liquify quick;
           0.14 reads as "actual clay" without being slow enough
           to frustrate a 5yo. */
        KERNEL_SIGMA: 2.4,   /* gaussian spread (in sample-index units) */
        KERNEL_CUT:   0.06,  /* below this weight, skip the slice */
        EASE:         0.14,  /* per-16.67-ms ease factor */

        /* Wheel.
           Real pottery: the wheel slows when you press on it -- the
           clay resists your hand + the potter eases the foot pedal.
           We simulate that by dropping the rotation rate during
           active sculpting, smoothed so it doesn't jerk between
           speeds. Both numbers are tuned by feel. */
        WHEEL_RPM: 26,
        WHEEL_SLOW_FACTOR: 0.55,   /* multiplier while finger is on clay */
        WHEEL_BLEND:       0.06,   /* per-frame smoothing toward target speed */

        /* Particles */
        PART_GRAV: 0.00045,
        PART_LIFE: 700,
        PART_MAX:  90,

        /* Runtime */
        canvas: null,
        ctx: null,
        dpr: 1,
        clay: null,
        clayLocked: false,    /* FINISH FORM flips this — input ignored */

        pointer: null,        /* {x, y} in logical coords, or null */
        pointerActive: false,
        pointerLastX: 0,      /* used to detect "actually shaping" */
        pointerLastY: 0,

        particles: [],
        wheelPhase: 0,
        wheelSpeedFactor: 1.0,   /* smoothed 0..1; multiplies WHEEL_RPM */
        lastT: 0,
        rafId: null,
        running: false,
        shapeInited: false,

        /* When true the wheel is empty and shaping is blocked until
           the kid drags a clay lump onto it. Set only at genuine
           "new pot" entry points (title START, fresh-slate); every
           other path (re-shape, remix) leaves it false so existing
           clay is immediately shapeable. */
        needsLump: false
    };

    /* ----- 5A. Init (lazy on first onEnter) ----- */

    function initShape() {
        const canvas = document.getElementById("shapeCanvas");
        if (!canvas) {
            console.warn("[CRAYte] no #shapeCanvas");
            return;
        }
        SHAPE.canvas = canvas;
        SHAPE.ctx = canvas.getContext("2d");
        sizeShapeCanvas();
        resetClay();
        attachShapePointer();
        wireShapeButtons();
        buildClayPicker();
        buildLumpTray();

        /* DPR can change on display swap. Re-size when the canvas
           is reflowed (cheap — only rebuilds the backing store). */
        if (typeof ResizeObserver === "function") {
            const ro = new ResizeObserver(function () { sizeShapeCanvas(); });
            ro.observe(canvas);
        }
    }

    function buildClayPicker() {
        const pick = document.getElementById("clayPicker");
        if (!pick) return;
        /* Wipe existing swatches (keep the row label that's in HTML) */
        Array.from(pick.querySelectorAll(".clay-swatch")).forEach(function (b) {
            b.remove();
        });
        CLAY_TYPES.forEach(function (mat) {
            /* Hidden clays (e.g. VOID) stay out until the
               unlocking achievement lands. */
            if (!isClayUnlocked(mat)) return;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "clay-swatch";
            btn.dataset.clay = mat.id;
            btn.title = mat.flavor;
            btn.setAttribute("aria-label", mat.label + " clay — " + mat.flavor);

            const disc = document.createElement("span");
            disc.className = "clay-disc";
            disc.style.background = mat.swatch;
            btn.appendChild(disc);

            const name = document.createElement("span");
            name.className = "clay-name";
            name.textContent = mat.label;
            btn.appendChild(name);

            if (mat.id === SHAPE.clayTypeId) btn.classList.add("active");
            btn.addEventListener("click", function () { setClay(mat.id); });
            pick.appendChild(btn);
        });
    }

    function setClay(clayTypeId) {
        SHAPE.clayTypeId = clayTypeId;
        document.querySelectorAll(".clay-swatch[data-clay]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.clay === clayTypeId);
        });
        document.querySelectorAll(".clay-lump[data-clay]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.clay === clayTypeId);
        });
    }

    /* ----- 5A2. Clay-lump tray (drag a lump onto the wheel) ----- */

    const SHAPE_HINT_DROP  = "Grab a lump of clay and plop it on the wheel!";
    const SHAPE_HINT_SHAPE = "Drag the clay. Pinch in to NARROW. Push out to WIDEN.";

    function setShapeHint(text) {
        const el = document.getElementById("shapeHint");
        if (el) el.textContent = text;
    }

    /* Keep the hint + tray prompt in sync with whether a lump is
       still needed. Called on shape onEnter and after a drop. */
    function refreshShapeMode() {
        setShapeHint(SHAPE.needsLump ? SHAPE_HINT_DROP : SHAPE_HINT_SHAPE);
        const prompt = document.querySelector(".clay-lump-prompt");
        if (prompt) {
            prompt.textContent = SHAPE.needsLump ? "DRAG A LUMP →"
                                                 : "SWAP CLAY →";
        }
    }

    function buildLumpTray() {
        const tray = document.getElementById("clayLumpTray");
        if (!tray) return;
        tray.innerHTML = "";

        const prompt = document.createElement("span");
        prompt.className = "clay-lump-prompt";
        tray.appendChild(prompt);

        CLAY_TYPES.forEach(function (mat) {
            if (!isClayUnlocked(mat)) return;
            const lump = document.createElement("button");
            lump.type = "button";
            lump.className = "clay-lump";
            lump.dataset.clay = mat.id;
            lump.title = mat.flavor;
            lump.setAttribute("aria-label",
                "Drag " + mat.label + " clay onto the wheel — " + mat.flavor);

            const ball = document.createElement("span");
            ball.className = "lump-ball";
            ball.style.setProperty("--lump-color", mat.swatch);
            lump.appendChild(ball);

            const name = document.createElement("span");
            name.className = "lump-name";
            name.textContent = mat.label;
            lump.appendChild(name);

            if (mat.id === SHAPE.clayTypeId) lump.classList.add("active");
            attachLumpDrag(lump, mat);
            tray.appendChild(lump);
        });
        refreshShapeMode();
    }

    /* Pointer-driven drag: a ghost ball follows the finger; drop
       it over the wheel canvas to load that clay. A plain tap
       (no real movement) also places it — forgiving for little
       kids who just poke the lump they want. */
    function attachLumpDrag(lump, mat) {
        let ghost = null, startX = 0, startY = 0, moved = false, dragId = null;

        function onMove(e) {
            if (dragId !== e.pointerId) return;
            if (!moved &&
                Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
                moved = true;
                lump.classList.add("is-dragging");
            }
            if (ghost) {
                ghost.style.transform =
                    "translate(" + (e.clientX) + "px," + (e.clientY) +
                    "px) translate(-50%,-50%) scale(1.12)";
            }
        }

        function overWheel(e) {
            const c = SHAPE.canvas ||
                      document.getElementById("shapeCanvas");
            if (!c) return false;
            const r = c.getBoundingClientRect();
            return e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top  && e.clientY <= r.bottom;
        }

        function cleanup() {
            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            window.removeEventListener("pointercancel", onUp, true);
            lump.classList.remove("is-dragging");
            dragId = null;
        }

        function onUp(e) {
            if (dragId !== e.pointerId) return;
            const dropped = (!moved) || overWheel(e);  /* tap OR drop on wheel */
            if (ghost) {
                if (dropped) {
                    ghost.remove();
                } else {
                    /* Snap back toward the lump, then fade. */
                    const lr = lump.getBoundingClientRect();
                    ghost.classList.add("is-snapback");
                    ghost.style.transform =
                        "translate(" + (lr.left + lr.width / 2) + "px," +
                        (lr.top + lr.height / 2) + "px) " +
                        "translate(-50%,-50%) scale(0.6)";
                    setTimeout(function () { if (ghost) ghost.remove(); }, 240);
                }
                ghost = null;
            }
            cleanup();
            if (dropped) placeLump(mat.id);
        }

        lump.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            dragId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            moved = false;
            ghost = document.createElement("div");
            ghost.className = "clay-lump-ghost";
            ghost.style.setProperty("--lump-color", mat.swatch);
            ghost.style.transform =
                "translate(" + e.clientX + "px," + e.clientY +
                "px) translate(-50%,-50%) scale(1.12)";
            document.body.appendChild(ghost);
            squelch();        /* wet "grab" */
            haptic(6);
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
        });
    }

    /* Lump lands on the wheel: juicy double squelch, load that
       clay as the starting form, drop the gate so shaping works. */
    function placeLump(clayId) {
        setClay(clayId);
        resetClay();
        SHAPE.needsLump = false;
        claySplat();                                /* recorded splat, synth fallback */
        haptic([6, 26, 12]);
        /* Splat burst at the wheel where the clay lands (emitParticles
           is sparse + randomly no-ops, so fire a few for a real pop). */
        for (let i = 0; i < 8; i++) {
            emitParticles({
                x: SHAPE.centerX + (Math.random() - 0.5) * 70,
                y: SHAPE.baseY - 150
            });
        }
        refreshShapeMode();
    }

    function sizeShapeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        SHAPE.dpr = dpr;
        const c = SHAPE.canvas;
        const bw = Math.round(SHAPE.W * dpr);
        const bh = Math.round(SHAPE.H * dpr);
        if (c.width !== bw)  c.width  = bw;
        if (c.height !== bh) c.height = bh;
        /* setTransform also resets — so coords stay in logical 400×600 space. */
        SHAPE.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resetClay() {
        const arr = new Array(SHAPE.N);
        const span = SHAPE.baseY - SHAPE.topY;
        for (let i = 0; i < SHAPE.N; i++) {
            const t = i / (SHAPE.N - 1);
            arr[i] = {
                /* i=0 at base (high y), i=N-1 at rim (low y) */
                y: SHAPE.baseY - t * span,
                radius: SHAPE.INIT_R
            };
        }
        SHAPE.clay = arr;
        SHAPE.clayLocked = false;
        SHAPE.particles.length = 0;
    }

    /* ----- 5B. Pointer input ----- */

    function shapePointerPos(e) {
        const r = SHAPE.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * SHAPE.W / r.width,
            y: (e.clientY - r.top)  * SHAPE.H / r.height
        };
    }

    function attachShapePointer() {
        const c = SHAPE.canvas;

        c.addEventListener("pointerdown", function (e) {
            if (SHAPE.clayLocked || SHAPE.needsLump) return;
            e.preventDefault();
            try { c.setPointerCapture(e.pointerId); } catch (_) {}
            const p = shapePointerPos(e);
            SHAPE.pointer = p;
            SHAPE.pointerLastX = p.x;
            SHAPE.pointerLastY = p.y;
            SHAPE.pointerActive = true;
            wetLoopStart();   /* sustained wet hum under the squelches */
            haptic(5);        /* light tap — "you grabbed the clay" */
        });

        c.addEventListener("pointermove", function (e) {
            if (!SHAPE.pointerActive) return;
            SHAPE.pointer = shapePointerPos(e);
        });

        function endPointer(e) {
            if (!SHAPE.pointerActive) return;
            SHAPE.pointerActive = false;
            SHAPE.pointer = null;
            try { c.releasePointerCapture(e.pointerId); } catch (_) {}
            wetLoopStop();
        }
        c.addEventListener("pointerup",     endPointer);
        c.addEventListener("pointercancel", endPointer);
        c.addEventListener("pointerleave",  endPointer);
    }

    /* ----- 5C. Buttons ----- */

    function wireShapeButtons() {
        const back   = document.getElementById("shapeBack");
        const reset  = document.getElementById("shapeReset");
        const finish = document.getElementById("shapeFinish");

        if (back) back.addEventListener("click", function () {
            showScreen("title");
        });

        if (reset) reset.addEventListener("click", function () {
            resetClay();
            flashButton(reset);
        });

        if (finish) finish.addEventListener("click", function () {
            SHAPE.clayLocked = true;
            flashButton(finish);
            if (SCREENS["decorate"]) {
                showScreen("decorate");
            } else {
                flashStub(finish, "KILN HEATING...");
                /* Unlock so user can keep playing while chunk 3 is pending. */
                setTimeout(function () { SHAPE.clayLocked = false; }, 1100);
            }
        });
    }

    function flashButton(btn) {
        btn.classList.add("is-flash");
        setTimeout(function () { btn.classList.remove("is-flash"); }, 220);
    }

    /* ----- 5D. Shape deformation (per-frame) ----- */

    function applyShaping(p, dt) {
        const clay = SHAPE.clay;
        const N = clay.length;

        /* Map pointer y to a sample-index domain. Outside the pot's
           vertical zone? Don't deform. */
        const span = SHAPE.baseY - SHAPE.topY;
        const t = (SHAPE.baseY - p.y) / span;
        if (t < -0.05 || t > 1.05) return false;
        const centerIdx = Math.max(0, Math.min(N - 1, t * (N - 1)));

        /* Target radius = pointer's horizontal distance from centerline.
           Allow targets a touch under MIN_R so a hard pinch still feels
           like it's biting; clamp below. */
        const targetR = Math.max(SHAPE.MIN_R - 4,
                                 Math.min(SHAPE.MAX_R + 10,
                                          Math.abs(p.x - SHAPE.centerX)));

        const sigma2 = 2 * SHAPE.KERNEL_SIGMA * SHAPE.KERNEL_SIGMA;
        /* Frame-rate independent ease: at 60fps with EASE=0.30, ~30%
           per frame; at 30fps, ~52% per frame; both feel the same. */
        const ease = 1 - Math.pow(1 - SHAPE.EASE, dt / 16.67);

        let didShape = false;
        const minR = EGG.infiniteClay ? 0   : SHAPE.MIN_R;
        const maxR = EGG.infiniteClay ? 9999 : SHAPE.MAX_R;
        for (let i = 0; i < N; i++) {
            const d = i - centerIdx;
            const w = Math.exp(-d * d / sigma2);
            if (w < SHAPE.KERNEL_CUT) continue;
            /* desired pulls slice toward targetR weighted by kernel,
               then we ease toward that desired over the frame. */
            const desired = clay[i].radius + (targetR - clay[i].radius) * w;
            const next = clay[i].radius + (desired - clay[i].radius) * ease;
            const clamped = Math.max(minR, Math.min(maxR, next));
            if (Math.abs(clamped - clay[i].radius) > 0.04) didShape = true;
            clay[i].radius = clamped;
        }
        return didShape;
    }

    /* ----- 5E. Clay-shaving particles ----- */

    function emitParticles(p) {
        if (SHAPE.particles.length >= SHAPE.PART_MAX) return;
        /* Sparse — most pointer-moves emit nothing, so the field
           looks like the occasional flake instead of a stream. */
        if (Math.random() > 0.35) return;
        const sign = (p.x >= SHAPE.centerX) ? 1 : -1;
        const count = 1 + (Math.random() < 0.35 ? 1 : 0);
        for (let i = 0; i < count; i++) {
            SHAPE.particles.push({
                x: p.x + (Math.random() - 0.5) * 6,
                y: p.y + (Math.random() - 0.5) * 4,
                vx: sign * (0.05 + Math.random() * 0.06),
                vy: -0.07 - Math.random() * 0.05,
                life: SHAPE.PART_LIFE * (0.7 + Math.random() * 0.6),
                age: 0,
                size: 1.4 + Math.random() * 1.9,
                /* Vary brown tones a bit for warmth. */
                hue: 22 + Math.random() * 14,
                lit: 28 + Math.random() * 18
            });
        }
    }

    function updateParticles(dt) {
        const parts = SHAPE.particles;
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.age += dt;
            if (p.age >= p.life) {
                parts.splice(i, 1);
                continue;
            }
            p.vy += SHAPE.PART_GRAV * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;
        }
    }

    /* ----- 5F. Render ----- */

    /* OVERFIRED overlay (Day 4 chunk B) — heavy multiply char +
       seeded crack network + ash blobs + ember specks. Clipped
       to the pot path. Caller already swapped SHAPE.clay if it
       wants a specific shape. Seed must be non-zero (use a hash
       of the entry id or a Date.now() at overheat time).        */
    function drawOverfiredOverlay(ctx, seed) {
        const rand = mulberry32(seed || 1);
        ctx.save();
        buildPotPath(ctx);
        ctx.clip();

        /* Deep char — heavier multiply than the chunk-8 first pass. */
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgba(48, 22, 8, 0.65)";
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
        ctx.globalCompositeOperation = "source-over";

        /* Crack network — 6 jagged polylines wandering across the
           pot, each with optional perpendicular branch. */
        for (let c = 0; c < 6; c++) {
            let x = SHAPE.centerX + (rand() - 0.5) * 200;
            let y = 110 + rand() * 380;
            let angle = rand() * Math.PI * 2;
            ctx.strokeStyle = "rgba(0, 0, 0, " +
                (0.45 + rand() * 0.25) + ")";
            ctx.lineWidth = 0.6 + rand() * 0.6;
            ctx.beginPath();
            ctx.moveTo(x, y);
            const segs = 6 + Math.floor(rand() * 4);
            for (let s = 0; s < segs; s++) {
                angle += (rand() - 0.5) * 1.4;
                x += Math.cos(angle) * (5 + rand() * 7);
                y += Math.sin(angle) * (5 + rand() * 7);
                ctx.lineTo(x, y);
            }
            ctx.stroke();
            if (rand() < 0.6) {
                ctx.beginPath();
                ctx.moveTo(x, y);
                const bx = x + Math.cos(angle + 1.3) * 8;
                const by = y + Math.sin(angle + 1.3) * 8;
                ctx.lineTo(bx, by);
                ctx.stroke();
            }
        }

        /* Ash blobs — bigger than chunk-8 dots, irregular. */
        for (let i = 0; i < 14; i++) {
            const px = SHAPE.centerX + (rand() - 0.5) * 180;
            const py = 100 + rand() * 400;
            const r1 = 2 + rand() * 5;
            const r2 = r1 * (0.4 + rand() * 0.4);
            ctx.fillStyle = "rgba(0, 0, 0, " +
                (0.30 + rand() * 0.30) + ")";
            ctx.beginPath();
            ctx.ellipse(px, py, r1, r2,
                        rand() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }

        /* Ember-orange specks. */
        for (let i = 0; i < 6; i++) {
            const px = SHAPE.centerX + (rand() - 0.5) * 160;
            const py = 130 + rand() * 360;
            ctx.fillStyle = "rgba(255, 90, 30, " +
                (0.30 + rand() * 0.35) + ")";
            ctx.beginPath();
            ctx.arc(px, py, 0.8 + rand() * 1.4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    /* EXPLODED memorial (Day 4 chunk B) — the gallery treats an
       exploded entry like a tribute. We render the saved pot
       (so the user can still see what it looked like) and then
       overlay severe cracks + a dimmer + a tilted EXPLODED tag.
       Seeded for stability.                                      */
    function drawExplodedMemorial(ctx, seed) {
        const rand = mulberry32(seed || 1);
        /* Dim the whole image */
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.40)";
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
        /* Severe cracks — straight lines radiating from a central
           "impact point" + a few wandering polylines for texture. */
        const cx = SHAPE.centerX + (rand() - 0.5) * 60;
        const cy = 200 + rand() * 200;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 1.2;
        const radial = 9;
        for (let i = 0; i < radial; i++) {
            const a = (i / radial) * Math.PI * 2 + rand() * 0.4;
            const len = 100 + rand() * 130;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            ctx.stroke();
        }
        /* Central impact glow */
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90);
        g.addColorStop(0,    "rgba(255, 200, 100, 0.55)");
        g.addColorStop(0.4,  "rgba(255, 90, 30, 0.30)");
        g.addColorStop(1,    "rgba(255, 90, 30, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
        ctx.restore();

        /* Tilted "EXPLODED" tag stamped in the corner */
        ctx.save();
        ctx.translate(SHAPE.W * 0.5, SHAPE.H * 0.18);
        ctx.rotate(-0.14);
        ctx.font = "bold 28px \"Bungee\", Impact, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 5;
        ctx.strokeText("EXPLODED", 0, 0);
        ctx.fillStyle = "#ff4040";
        ctx.fillText("EXPLODED", 0, 0);
        ctx.restore();
    }

    /* Shared by SHAPE, DECORATE, and KILN. All three render the same
       pot from SHAPE.clay; decorate composites a paint layer, kiln
       additionally applies a "fired" warm overlay + can suppress its
       own backdrop so the kiln's chrome wraps the scene.            */
    function renderPotScene(ctx, opts) {
        opts = opts || {};

        if (opts.background !== false) {
            ctx.fillStyle = "#0c1f25";
            ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
            drawShapeBackdrop(ctx);
        }

        /* Wheel platform — drawn first so the pot covers the front
           half, leaving the back rim visible as an arc. */
        if (opts.wheel !== false) drawWheel(ctx);

        /* Pot silhouette + 3-D shading. Skipped while the wheel is
           still empty (waiting for a lump drop) — opts.pot:false. */
        if (opts.pot !== false) drawPot(ctx);

        /* Paint layer (decorate mode) — clipped to the pot silhouette
           so strokes outside the body never show. */
        if (opts.paintCanvas) {
            ctx.save();
            buildPotPath(ctx);
            ctx.clip();
            ctx.drawImage(opts.paintCanvas, 0, 0, SHAPE.W, SHAPE.H);
            ctx.restore();
        }

        /* Fired overlay — warm-tone "overlay" composite that pumps
           midtone saturation and shifts toward kiln-orange. Brief
           calls for "deeper / richer glaze color (slight color shift
           to suggest firing has set the glaze)." Clipped to pot. */
        if (opts.fired) {
            ctx.save();
            buildPotPath(ctx);
            ctx.clip();
            ctx.globalCompositeOperation = "overlay";
            /* Per-clay fired tint — porcelain stays cream, basalt
               glazes nearly black, galaxy gets a violet shift. */
            ctx.fillStyle = currentClay().firedTint;
            ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
            ctx.globalCompositeOperation = "source-over";
            /* Subtle gloss highlight on top to feel "vitrified" */
            const g = ctx.createLinearGradient(0, 80, 0, 510);
            g.addColorStop(0,    "rgba(255, 245, 220, 0.10)");
            g.addColorStop(0.35, "rgba(255, 245, 220, 0.00)");
            g.addColorStop(1,    "rgba(0, 0, 0, 0.12)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
            ctx.restore();
        }

        /* OVERFIRED — chunk-8 egg, refined in Day 4 chunk B.
           Heavier multiply char + crack network + ash + embers.
           Same renderer used by gallery thumbnails — deterministic
           per-pot via the seed. */
        if (opts.overfired) {
            drawOverfiredOverlay(ctx, (opts.overfiredSeed | 0) || 1);
        }

        /* Rim opening on top — drawn AFTER paint so the rim ring
           stays visible even with a painted pot. Gated alongside
           drawPot so the empty wheel before lump placement doesn't
           show a phantom pot opening floating in the air. */
        if (opts.pot !== false) drawRim(ctx);

        /* Particles last so they're on top. Decorate disables. */
        if (opts.particles !== false) drawParticles(ctx);

        /* Decorative HUD ticks in the corners — onioncore polish */
        if (opts.corners !== false) drawCornerTicks(ctx);
    }

    /* Back-compat alias used by SHAPE's frame loop. While a lump
       hasn't been dropped yet the pot is hidden and a pulsing
       "drop here" ring is drawn over the spinning wheel. */
    function renderShape() {
        const ctx = SHAPE.ctx;
        renderPotScene(ctx, SHAPE.needsLump ? { pot: false } : undefined);
        if (SHAPE.needsLump) drawDropTarget(ctx);
    }

    function drawDropTarget(ctx) {
        const cx = SHAPE.centerX;
        const cy = SHAPE.baseY - 150;   /* over the wheel, where clay sits */
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);
        const r = 70 + pulse * 10;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.strokeStyle = "rgba(0, 255, 204, " + (0.35 + pulse * 0.4) + ")";
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 9]);
        ctx.lineDashOffset = -(performance.now() / 60) % 19;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        /* Down-chevron so the gesture reads as "drop it in here". */
        ctx.strokeStyle = "rgba(0, 255, 204, " + (0.45 + pulse * 0.4) + ")";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        const a = 16, yOff = -6 + pulse * 6;
        ctx.beginPath();
        ctx.moveTo(-a, yOff - a * 0.6);
        ctx.lineTo(0, yOff + a * 0.6);
        ctx.lineTo(a, yOff - a * 0.6);
        ctx.stroke();
        ctx.restore();
    }

    function drawShapeBackdrop(ctx) {
        /* Faint vertical gradient — top a touch lighter than bottom
           to suggest a soft light from above. */
        const g = ctx.createLinearGradient(0, 0, 0, SHAPE.H);
        g.addColorStop(0,    "rgba(0, 255, 204, 0.06)");
        g.addColorStop(0.6,  "rgba(0, 0, 0, 0)");
        g.addColorStop(1,    "rgba(0, 0, 0, 0.35)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);

        /* Centerline guide — very faint, helps the eye see the axis */
        ctx.strokeStyle = "rgba(0, 255, 204, 0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(SHAPE.centerX, 30);
        ctx.lineTo(SHAPE.centerX, SHAPE.baseY);
        ctx.stroke();
    }

    function drawWheel(ctx) {
        const cx = SHAPE.centerX;
        const cy = SHAPE.baseY;
        const rx = 150;
        const ry = 22;

        /* Disc body */
        const disc = ctx.createLinearGradient(cx - rx, cy, cx + rx, cy);
        disc.addColorStop(0,    "#0d2228");
        disc.addColorStop(0.5,  "#2a626c");
        disc.addColorStop(1,    "#0d2228");
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = disc;
        ctx.fill();

        /* Rotating wedges — sells the spin without literally rotating
           the symmetric pot. Six wedges, alternating light/dark. */
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 2, ry - 2, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        ctx.rotate(SHAPE.wheelPhase);
        const segs = 6;
        for (let i = 0; i < segs; i++) {
            const a0 = (i / segs) * Math.PI * 2;
            const a1 = ((i + 1) / segs) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, rx, a0, a1);
            ctx.closePath();
            ctx.fillStyle = (i % 2 === 0)
                ? "rgba(255, 255, 255, 0.05)"
                : "rgba(0, 0, 0, 0.18)";
            ctx.fill();
        }
        ctx.restore();

        /* Rim ring */
        ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        /* Subtle highlight stripe on the front edge */
        ctx.strokeStyle = "rgba(0, 255, 204, 0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0.1, Math.PI - 0.1);
        ctx.stroke();
    }

    function buildPotPath(ctx) {
        /* Right side bottom -> top with midpoint-quadratic smoothing,
           lineTo across the rim, left side top -> bottom smoothed,
           lineTo across the base. */
        const cx = SHAPE.centerX;
        const clay = SHAPE.clay;
        const N = clay.length;

        ctx.beginPath();
        ctx.moveTo(cx + clay[0].radius, clay[0].y);
        for (let i = 1; i < N - 1; i++) {
            const xc = cx + (clay[i].radius + clay[i + 1].radius) * 0.5;
            const yc = (clay[i].y + clay[i + 1].y) * 0.5;
            ctx.quadraticCurveTo(cx + clay[i].radius, clay[i].y, xc, yc);
        }
        ctx.lineTo(cx + clay[N - 1].radius, clay[N - 1].y);
        ctx.lineTo(cx - clay[N - 1].radius, clay[N - 1].y);
        for (let i = N - 2; i > 0; i--) {
            const xc = cx - (clay[i].radius + clay[i - 1].radius) * 0.5;
            const yc = (clay[i].y + clay[i - 1].y) * 0.5;
            ctx.quadraticCurveTo(cx - clay[i].radius, clay[i].y, xc, yc);
        }
        ctx.lineTo(cx - clay[0].radius, clay[0].y);
        ctx.closePath();
    }

    function drawPot(ctx) {
        const cx = SHAPE.centerX;
        const clay = SHAPE.clay;
        const N = clay.length;

        /* Compute current max radius (for gradient stops). */
        let maxR = 0;
        for (let i = 0; i < N; i++) {
            if (clay[i].radius > maxR) maxR = clay[i].radius;
        }
        if (maxR < 1) maxR = 1;

        /* Soft shadow under the pot */
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.beginPath();
        ctx.ellipse(cx, SHAPE.baseY + 6, maxR * 1.05, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        /* Fill pot body — gradient stops come from the active clay
           material so porcelain reads cream, basalt reads charcoal,
           galaxy reads deep-blue, etc.                              */
        const mat = currentClay();
        buildPotPath(ctx);
        const grad = ctx.createLinearGradient(cx - maxR, 0, cx + maxR, 0);
        const stops = mat.unfired;
        grad.addColorStop(0.00, stops[0]);
        grad.addColorStop(0.18, stops[1]);
        grad.addColorStop(0.42, stops[2]);
        grad.addColorStop(0.55, stops[3]);
        grad.addColorStop(0.78, stops[4]);
        grad.addColorStop(1.00, stops[5]);
        ctx.fillStyle = grad;
        ctx.fill();

        /* Highlight strip — rolls left/right as the wheel spins
           in SHAPE mode (sells the rotation that a symmetric
           silhouette can't show by itself). In DECORATE the
           wheel is conceptually stopped so we render the
           highlight at its original static offset. In KILN it
           animates with the kiln's spin.                       */
        ctx.save();
        buildPotPath(ctx);
        ctx.clip();
        const hlColor = mat.highlight;
        const hlAlphaMatch = hlColor.match(/([\d.]+)\)\s*$/);
        const baseAlpha = hlAlphaMatch ? parseFloat(hlAlphaMatch[1]) : 0.34;
        const hlEdge = hlColor.replace(/[\d.]+\)\s*$/, "0)");

        let hlX, alphaMult;
        if (currentScreen === "decorate") {
            hlX = cx - 11;          /* original static position */
            alphaMult = 1.0;
        } else {
            const phase = SHAPE.wheelPhase;
            const visibility = Math.max(0, Math.cos(phase));
            hlX = cx + Math.sin(phase) * (maxR * 0.55);
            alphaMult = visibility;
        }

        if (alphaMult > 0.02) {
            const dynamicAlpha = (baseAlpha * alphaMult).toFixed(3);
            const fullColor = hlColor.replace(/[\d.]+\)\s*$/,
                                              dynamicAlpha + ")");
            const hl = ctx.createLinearGradient(hlX - 25, 0, hlX + 25, 0);
            hl.addColorStop(0,   hlEdge);
            hl.addColorStop(0.5, fullColor);
            hl.addColorStop(1,   hlEdge);
            ctx.fillStyle = hl;
            ctx.fillRect(hlX - 30, clay[N - 1].y - 4,
                         60, SHAPE.baseY - clay[N - 1].y + 14);
        }

        /* Faint horizontal throwing rings (potter's mark) — only
           visible where the clay catches the light. */
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 0.6;
        const ringStep = 16;
        for (let y = clay[N - 1].y + 12; y < SHAPE.baseY - 4; y += ringStep) {
            ctx.beginPath();
            ctx.moveTo(cx - maxR, y);
            ctx.lineTo(cx + maxR, y);
            ctx.stroke();
        }
        ctx.restore();

        /* Outline */
        buildPotPath(ctx);
        ctx.strokeStyle = mat.outline;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        /* SENTIENT POT — dev-menu egg. A single blinking eye on the
           front of the pot. Tracks the centerline at the middle of
           the pot's height. */
        if (EGG.sentientPot) {
            const midIdx = Math.floor(N / 2);
            const eyeY = clay[midIdx].y;
            const eyeR = Math.min(18, clay[midIdx].radius * 0.32);
            const blink = (Math.sin(performance.now() / 540) > 0.94);
            /* whites of the eye */
            ctx.fillStyle = "#f4f6ea";
            ctx.beginPath();
            ctx.ellipse(cx, eyeY, eyeR * 1.4, eyeR * (blink ? 0.05 : 0.9),
                        0, 0, Math.PI * 2);
            ctx.fill();
            if (!blink) {
                /* pupil tracks pointer if shaping, else looks ahead */
                let pupilX = cx;
                let pupilY = eyeY;
                if (SHAPE.pointer) {
                    const dx = SHAPE.pointer.x - cx;
                    const dy = SHAPE.pointer.y - eyeY;
                    const m = Math.hypot(dx, dy);
                    if (m > 0.01) {
                        const off = eyeR * 0.45;
                        pupilX = cx     + (dx / m) * off;
                        pupilY = eyeY   + (dy / m) * off * 0.55;
                    }
                }
                ctx.fillStyle = "#1a0e08";
                ctx.beginPath();
                ctx.arc(pupilX, pupilY, eyeR * 0.55, 0, Math.PI * 2);
                ctx.fill();
                /* highlight */
                ctx.fillStyle = "#fff";
                ctx.beginPath();
                ctx.arc(pupilX - eyeR * 0.2, pupilY - eyeR * 0.2,
                        eyeR * 0.18, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function drawRim(ctx) {
        const cx = SHAPE.centerX;
        const top = SHAPE.clay[SHAPE.N - 1];

        /* Inner cavity (the dark hole at the top of the pot) */
        ctx.beginPath();
        ctx.ellipse(cx, top.y, top.radius - 3, (top.radius - 3) * 0.20,
                    0, 0, Math.PI * 2);
        ctx.fillStyle = "#1a0904";
        ctx.fill();

        /* Highlight on the back of the rim */
        ctx.strokeStyle = "rgba(255, 200, 150, 0.45)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(cx, top.y - 0.5, top.radius - 3, (top.radius - 3) * 0.20,
                    0, Math.PI + 0.1, Math.PI * 2 - 0.1);
        ctx.stroke();

        /* Slight rim thickness (outer ellipse stroke) */
        ctx.strokeStyle = "rgba(60, 24, 6, 0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, top.y, top.radius, top.radius * 0.20,
                    0, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawParticles(ctx) {
        const parts = SHAPE.particles;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            const t = p.age / p.life;
            const a = (1 - t) * 0.85;
            ctx.fillStyle = "hsla(" + p.hue + ", 55%, " + p.lit + "%, " + a + ")";
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - t * 0.4), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawCornerTicks(ctx) {
        ctx.save();
        ctx.strokeStyle = "rgba(0, 255, 204, 0.25)";
        ctx.lineWidth = 1.5;
        const m = 10;
        const len = 14;
        const w = SHAPE.W;
        const h = SHAPE.H;
        ctx.beginPath();
        /* TL */ ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m);
        /* TR */ ctx.moveTo(w - m - len, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + len);
        /* BL */ ctx.moveTo(m, h - m - len); ctx.lineTo(m, h - m); ctx.lineTo(m + len, h - m);
        /* BR */ ctx.moveTo(w - m - len, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - len);
        ctx.stroke();
        ctx.restore();
    }

    /* ----- 5G. Main loop ----- */

    function shapeFrame(t) {
        if (!SHAPE.running) return;
        if (!SHAPE.lastT) SHAPE.lastT = t;
        const dt = Math.min(48, t - SHAPE.lastT); /* clamp dt for stability */
        SHAPE.lastT = t;

        /* Wheel spin -- slows during active sculpting so the player
           can see what they're doing (real-pottery behavior). The
           smoothing prevents a jerk when the finger lands / lifts. */
        const isShaping = !!(SHAPE.pointerActive && SHAPE.pointer && !SHAPE.clayLocked);
        const targetFactor = isShaping ? SHAPE.WHEEL_SLOW_FACTOR : 1.0;
        SHAPE.wheelSpeedFactor += (targetFactor - SHAPE.wheelSpeedFactor) * SHAPE.WHEEL_BLEND;
        SHAPE.wheelPhase += (2 * Math.PI * SHAPE.WHEEL_RPM / 60) *
                            SHAPE.wheelSpeedFactor * (dt / 1000);
        if (SHAPE.wheelPhase > Math.PI * 2) SHAPE.wheelPhase -= Math.PI * 2;

        /* Shaping */
        if (SHAPE.pointerActive && SHAPE.pointer && !SHAPE.clayLocked) {
            const didShape = applyShaping(SHAPE.pointer, dt);
            if (didShape) {
                emitParticles(SHAPE.pointer);
                /* Throttled squelch — fires once every 90-160ms
                   while clay is actually being reshaped. */
                SHAPE.squelchT = (SHAPE.squelchT || 0) + dt;
                if (SHAPE.squelchT > 90 + Math.random() * 70) {
                    squelch();
                    SHAPE.squelchT = 0;
                }
            } else {
                SHAPE.squelchT = 0;
            }
        }

        updateParticles(dt);
        renderShape();
        SHAPE.rafId = requestAnimationFrame(shapeFrame);
    }

    function startShapeLoop() {
        if (SHAPE.running) return;
        SHAPE.running = true;
        SHAPE.lastT = 0;
        SHAPE.rafId = requestAnimationFrame(shapeFrame);
    }

    function stopShapeLoop() {
        SHAPE.running = false;
        if (SHAPE.rafId) cancelAnimationFrame(SHAPE.rafId);
        SHAPE.rafId = null;
    }

    /* ----- 5H. Register with the screen router ----- */

    registerScreen("shape", {
        onEnter: function () {
            if (!SHAPE.shapeInited) {
                initShape();
                SHAPE.shapeInited = true;
            } else {
                /* Ensure backing store matches current DPR after a
                   trip away from the screen. */
                sizeShapeCanvas();
            }
            startShapeLoop();
            wheelHumStart();   /* wheel is spinning */
            /* Sync hint + tray prompt with whether a lump is still
               needed (set by the new-pot entry points). */
            refreshShapeMode();
            /* Show the "remixing @user" chip if this session has
               a pending remix. Safe to call always -- no-op if
               not remixing. */
            if (typeof refreshRemixInProgressChip === "function") {
                refreshRemixInProgressChip();
            }
        },
        onLeave: function () {
            stopShapeLoop();
            /* Don't stop the hum here — decorate/kiln may follow
               and the wheel keeps spinning across all three. The
               title/gallery onEnter handlers stop it. */
        }
    });

    /* Eager init: build the default cylinder before any screen
       mounts so renderPotScene has a clay array to read even if
       the user jumps to decorate without entering shape (e.g.,
       deep links via window.CRAYte.showScreen, future "load from
       gallery" paths). resetClay() is idempotent; initShape will
       re-run it from a clean state. */
    resetClay();

    /* ============================================================
       DECORATE SCREEN — chunk 3: brushes / glazes / stamps
       ============================================================
       Same pot from SHAPE.clay (locked). An offscreen paint canvas
       accumulates strokes / stamps; renderPotScene composites it
       clipped to the pot's silhouette so paint outside the body
       is never visible. Chunk 4 will add themed packs as new
       entries in GLAZE_PACKS without changing this layer.
       ============================================================ */

    /* ----- 6A. Stamp drawers + helpers -----
       Each pattern is a function (ctx, x, y, r, c) that draws
       itself at (x, y) with radius r and ink/fill color c. The
       same drawers are used for on-canvas stamping AND for the
       mini palette icons.

       Helpers below are shared by the themed-pack stamps (chunk
       4 adds 23 more drawers — silhouettes, pixel art, text
       labels, circuit traces). Keep them generic.               */

    function roundedRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /* Deterministic PRNG (Mulberry32) — used by anything that
       wants frame-to-frame stable randomness from a seed.
       Returns a [0, 1) generator. Currently powers the
       overfired crack/ash pattern so it doesn't flicker. */
    function mulberry32(seed) {
        let t = (seed | 0) >>> 0;
        return function () {
            t = (t + 0x6D2B79F5) | 0;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* Cheap string -> 32-bit hash for seeding from entry IDs. */
    function strHash(s) {
        s = String(s || "");
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    /* Tint a hex color lighter (amt > 0) or darker (amt < 0).
       amt is a [-1, 1] fraction; non-hex inputs pass through. */
    function shiftColor(hex, amt) {
        if (typeof hex !== "string" || hex.charAt(0) !== "#") return hex;
        let h = hex.slice(1);
        if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
        if (h.length !== 6) return hex;
        let r = parseInt(h.slice(0, 2), 16);
        let g = parseInt(h.slice(2, 4), 16);
        let b = parseInt(h.slice(4, 6), 16);
        const pad = function (v) {
            v = Math.max(0, Math.min(255, Math.round(v)));
            return (v < 16 ? "0" : "") + v.toString(16);
        };
        if (amt >= 0) {
            r += (255 - r) * amt;
            g += (255 - g) * amt;
            b += (255 - b) * amt;
        } else {
            r *= (1 + amt);
            g *= (1 + amt);
            b *= (1 + amt);
        }
        return "#" + pad(r) + pad(g) + pad(b);
    }

    /* Text in a chunky framed box — used by GOOD BOY, POWER,
       GAME OVER, PRESS START stamps. Bungee is the title font
       (already in <head>); fallback chain keeps it chunky. */
    function textStamp(ctx, x, y, r, color, text, opts) {
        opts = opts || {};
        const fontSize  = (opts.fontSize || 0.42) * r;
        const fontStack = opts.fontFamily ||
            '"Bungee", "Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif';
        ctx.save();
        ctx.font = fontSize + "px " + fontStack;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(text).width;
        const padX = r * 0.18;
        const padY = r * 0.12;
        const w = tw + padX * 2;
        const h = fontSize + padY * 2;
        ctx.fillStyle = "#000";
        roundedRect(ctx, x - w / 2, y - h / 2, w, h, h * 0.22);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, r * 0.06);
        roundedRect(ctx, x - w / 2 + 1, y - h / 2 + 1, w - 2, h - 2, h * 0.22);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(text, x, y + 1);
        ctx.restore();
    }

    /* Rasterized pixel art — used by pixel-heart, pixel-skull,
       cloud-8bit. Cell size scales with stamp radius.         */
    function pixelGrid(ctx, x, y, color, grid, cell) {
        const rows = grid.length;
        const cols = grid[0].length;
        const ox = x - (cols * cell) / 2;
        const oy = y - (rows * cell) / 2;
        ctx.fillStyle = color;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c]) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
            }
        }
    }
    const PATTERN_DRAWERS = {
        dot: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
            ctx.fill();
        },
        ring: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.32);
            ctx.beginPath();
            ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
            ctx.stroke();
        },
        star: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
                const rad = (i % 2 === 0) ? r : r * 0.42;
                const px = x + Math.cos(a) * rad;
                const py = y + Math.sin(a) * rad;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        },
        chevron: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.32);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(x - r * 0.9, y + r * 0.35);
            ctx.lineTo(x, y - r * 0.35);
            ctx.lineTo(x + r * 0.9, y + r * 0.35);
            ctx.stroke();
        },
        wave: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.30);
            ctx.lineCap = "round";
            ctx.beginPath();
            const steps = 18;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const px = x - r + t * 2 * r;
                const py = y + Math.sin(t * Math.PI * 2) * r * 0.42;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        },
        triangle: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(x, y - r * 0.85);
            ctx.lineTo(x + r * 0.74, y + r * 0.45);
            ctx.lineTo(x - r * 0.74, y + r * 0.45);
            ctx.closePath();
            ctx.fill();
        },
        x: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.30);
            ctx.lineCap = "round";
            const k = r * 0.65;
            ctx.beginPath();
            ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
            ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k);
            ctx.stroke();
        },
        heart: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            ctx.beginPath();
            const top = y - r * 0.35;
            ctx.moveTo(x, top + r * 0.30);
            ctx.bezierCurveTo(x, top - r * 0.15,
                              x - r * 0.95, top - r * 0.05,
                              x - r * 0.95, top + r * 0.50);
            ctx.bezierCurveTo(x - r * 0.95, top + r * 0.95,
                              x - r * 0.40, top + r * 1.05,
                              x, y + r * 0.70);
            ctx.bezierCurveTo(x + r * 0.40, top + r * 1.05,
                              x + r * 0.95, top + r * 0.95,
                              x + r * 0.95, top + r * 0.50);
            ctx.bezierCurveTo(x + r * 0.95, top - r * 0.05,
                              x, top - r * 0.15,
                              x, top + r * 0.30);
            ctx.fill();
        },

        /* ===== CANDY pack ===== */
        lollipop: function (ctx, x, y, r, c) {
            /* stick */
            ctx.strokeStyle = "#f4f4ea";
            ctx.lineWidth = Math.max(2, r * 0.14);
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x, y + r * 0.10);
            ctx.lineTo(x, y + r * 0.95);
            ctx.stroke();
            /* candy disc */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y - r * 0.20, r * 0.62, 0, Math.PI * 2);
            ctx.fill();
            /* swirl */
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = Math.max(1.4, r * 0.10);
            ctx.lineCap = "round";
            ctx.beginPath();
            for (let t = 0; t < Math.PI * 4; t += 0.18) {
                const rad = 1.5 + t * r * 0.06;
                const px = x + Math.cos(t) * rad;
                const py = y - r * 0.20 + Math.sin(t) * rad;
                if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        },

        "candy-cane": function (ctx, x, y, r, c) {
            ctx.save();
            ctx.fillStyle = "#fff";
            roundedRect(ctx, x - r * 0.30, y - r * 0.90,
                        r * 0.60, r * 1.80, r * 0.18);
            ctx.fill();
            ctx.clip();
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.20);
            for (let i = -3; i <= 5; i++) {
                ctx.beginPath();
                ctx.moveTo(x - r + i * r * 0.45, y - r);
                ctx.lineTo(x + r + i * r * 0.45, y + r);
                ctx.stroke();
            }
            ctx.restore();
            /* dark outline for definition */
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = Math.max(1, r * 0.05);
            roundedRect(ctx, x - r * 0.30, y - r * 0.90,
                        r * 0.60, r * 1.80, r * 0.18);
            ctx.stroke();
        },

        gumballs: function (ctx, x, y, r, c) {
            /* cluster of 5 gumballs in slightly varied tints */
            const spots = [
                [ 0.00,  0.00, 0.42, c],
                [-0.55, -0.40, 0.28, shiftColor(c,  0.18)],
                [ 0.55, -0.40, 0.28, shiftColor(c, -0.18)],
                [-0.50,  0.45, 0.28, shiftColor(c,  0.28)],
                [ 0.50,  0.45, 0.28, shiftColor(c, -0.10)]
            ];
            for (let i = 0; i < spots.length; i++) {
                const s = spots[i];
                ctx.fillStyle = s[3];
                ctx.beginPath();
                ctx.arc(x + s[0] * r, y + s[1] * r, r * s[2], 0, Math.PI * 2);
                ctx.fill();
                /* highlight */
                ctx.fillStyle = "rgba(255,255,255,0.4)";
                ctx.beginPath();
                ctx.arc(x + s[0] * r - r * s[2] * 0.35,
                        y + s[1] * r - r * s[2] * 0.35,
                        r * s[2] * 0.22, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        drip: function (ctx, x, y, r, c) {
            /* glaze drip — teardrop */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(x, y - r * 0.95);
            ctx.bezierCurveTo(x + r * 0.55, y - r * 0.40,
                              x + r * 0.65, y + r * 0.55,
                              x, y + r * 0.95);
            ctx.bezierCurveTo(x - r * 0.65, y + r * 0.55,
                              x - r * 0.55, y - r * 0.40,
                              x, y - r * 0.95);
            ctx.fill();
            /* shine */
            ctx.fillStyle = "rgba(255,255,255,0.42)";
            ctx.beginPath();
            ctx.ellipse(x - r * 0.18, y + r * 0.15, r * 0.10, r * 0.30,
                        -0.3, 0, Math.PI * 2);
            ctx.fill();
        },

        /* ===== PLUSHIE pack ===== */
        teddy: function (ctx, x, y, r, c) {
            const belly = shiftColor(c, 0.28);
            const dark  = shiftColor(c, -0.30);
            /* body */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y + r * 0.30, r * 0.55, 0, Math.PI * 2);
            ctx.fill();
            /* head */
            ctx.beginPath();
            ctx.arc(x, y - r * 0.35, r * 0.42, 0, Math.PI * 2);
            ctx.fill();
            /* ears */
            ctx.beginPath();
            ctx.arc(x - r * 0.38, y - r * 0.68, r * 0.18, 0, Math.PI * 2);
            ctx.arc(x + r * 0.38, y - r * 0.68, r * 0.18, 0, Math.PI * 2);
            ctx.fill();
            /* ear inners */
            ctx.fillStyle = belly;
            ctx.beginPath();
            ctx.arc(x - r * 0.38, y - r * 0.68, r * 0.10, 0, Math.PI * 2);
            ctx.arc(x + r * 0.38, y - r * 0.68, r * 0.10, 0, Math.PI * 2);
            ctx.fill();
            /* belly patch */
            ctx.beginPath();
            ctx.arc(x, y + r * 0.32, r * 0.34, 0, Math.PI * 2);
            ctx.fill();
            /* snout */
            ctx.fillStyle = belly;
            ctx.beginPath();
            ctx.arc(x, y - r * 0.22, r * 0.18, 0, Math.PI * 2);
            ctx.fill();
            /* eyes */
            ctx.fillStyle = "#1a0e08";
            ctx.beginPath();
            ctx.arc(x - r * 0.14, y - r * 0.42, r * 0.06, 0, Math.PI * 2);
            ctx.arc(x + r * 0.14, y - r * 0.42, r * 0.06, 0, Math.PI * 2);
            ctx.fill();
            /* nose */
            ctx.fillStyle = dark;
            ctx.beginPath();
            ctx.arc(x, y - r * 0.26, r * 0.05, 0, Math.PI * 2);
            ctx.fill();
        },

        paw: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            /* 4 toe beans */
            const toes = [
                [-0.38, -0.40, 0.18],
                [-0.12, -0.60, 0.18],
                [ 0.12, -0.60, 0.18],
                [ 0.38, -0.40, 0.18]
            ];
            for (let i = 0; i < toes.length; i++) {
                const t = toes[i];
                ctx.beginPath();
                ctx.arc(x + t[0] * r, y + t[1] * r, r * t[2], 0, Math.PI * 2);
                ctx.fill();
            }
            /* main pad — three-lobed */
            ctx.beginPath();
            ctx.moveTo(x - r * 0.42, y + r * 0.10);
            ctx.bezierCurveTo(x - r * 0.55, y + r * 0.30,
                              x - r * 0.35, y + r * 0.55,
                              x,            y + r * 0.50);
            ctx.bezierCurveTo(x + r * 0.35, y + r * 0.55,
                              x + r * 0.55, y + r * 0.30,
                              x + r * 0.42, y + r * 0.10);
            ctx.bezierCurveTo(x + r * 0.25, y - r * 0.05,
                              x - r * 0.25, y - r * 0.05,
                              x - r * 0.42, y + r * 0.10);
            ctx.fill();
        },

        button: function (ctx, x, y, r, c) {
            const dark = shiftColor(c, -0.35);
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
            ctx.fill();
            /* rim ring */
            ctx.strokeStyle = dark;
            ctx.lineWidth = Math.max(1, r * 0.07);
            ctx.beginPath();
            ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
            ctx.stroke();
            /* 4 thread holes */
            ctx.fillStyle = "#1a0e08";
            const holes = [[-0.18, -0.18], [0.18, -0.18],
                           [-0.18,  0.18], [0.18,  0.18]];
            for (let i = 0; i < holes.length; i++) {
                ctx.beginPath();
                ctx.arc(x + holes[i][0] * r, y + holes[i][1] * r,
                        r * 0.075, 0, Math.PI * 2);
                ctx.fill();
            }
            /* thread X */
            ctx.strokeStyle = "rgba(0,0,0,0.55)";
            ctx.lineWidth = Math.max(1, r * 0.04);
            ctx.beginPath();
            ctx.moveTo(x - r * 0.18, y - r * 0.18);
            ctx.lineTo(x + r * 0.18, y + r * 0.18);
            ctx.moveTo(x + r * 0.18, y - r * 0.18);
            ctx.lineTo(x - r * 0.18, y + r * 0.18);
            ctx.stroke();
        },

        "plush-grain": function (ctx, x, y, r, c) {
            /* soft cross-hatch — short fuzz tufts */
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(1, r * 0.06);
            ctx.lineCap = "round";
            for (let i = 0; i < 22; i++) {
                /* deterministic-ish positions via i for stability */
                const a = (i * 137.5) % 360 * Math.PI / 180;
                const rad = ((i * 41) % 80) / 100 * r * 0.85;
                const px = x + Math.cos(a) * rad;
                const py = y + Math.sin(a) * rad;
                const ang = (i * 29) % 180 * Math.PI / 180;
                const len = r * 0.18;
                ctx.beginPath();
                ctx.moveTo(px - Math.cos(ang) * len * 0.5,
                           py - Math.sin(ang) * len * 0.5);
                ctx.lineTo(px + Math.cos(ang) * len * 0.5,
                           py + Math.sin(ang) * len * 0.5);
                ctx.stroke();
            }
        },

        /* ===== GOOD DOG pack ===== */
        bone: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            /* shaft */
            roundedRect(ctx, x - r * 0.75, y - r * 0.18,
                        r * 1.50, r * 0.36, r * 0.10);
            ctx.fill();
            /* 4 bulb ends */
            const ends = [[-0.75, -0.30], [-0.75, 0.30],
                          [ 0.75, -0.30], [ 0.75, 0.30]];
            for (let i = 0; i < ends.length; i++) {
                ctx.beginPath();
                ctx.arc(x + ends[i][0] * r, y + ends[i][1] * r,
                        r * 0.30, 0, Math.PI * 2);
                ctx.fill();
            }
            /* subtle outline */
            ctx.strokeStyle = "rgba(0,0,0,0.35)";
            ctx.lineWidth = Math.max(1, r * 0.05);
            roundedRect(ctx, x - r * 0.75, y - r * 0.18,
                        r * 1.50, r * 0.36, r * 0.10);
            ctx.stroke();
        },

        doghouse: function (ctx, x, y, r, c) {
            ctx.save();
            /* body */
            ctx.fillStyle = c;
            roundedRect(ctx, x - r * 0.70, y - r * 0.10,
                        r * 1.40, r * 0.85, r * 0.05);
            ctx.fill();
            /* roof */
            ctx.fillStyle = shiftColor(c, -0.30);
            ctx.beginPath();
            ctx.moveTo(x - r * 0.85, y - r * 0.05);
            ctx.lineTo(x, y - r * 0.75);
            ctx.lineTo(x + r * 0.85, y - r * 0.05);
            ctx.closePath();
            ctx.fill();
            /* door (arched) — punch through */
            ctx.globalCompositeOperation = "destination-out";
            ctx.beginPath();
            ctx.arc(x, y + r * 0.40, r * 0.25, Math.PI, 0);
            ctx.lineTo(x + r * 0.25, y + r * 0.75);
            ctx.lineTo(x - r * 0.25, y + r * 0.75);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        },

        goodboy: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "GOOD BOY");
        },

        whosagoodboy: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "WHO'S A GOOD BOY?",
                      { fontSize: 0.28 });
        },

        dachshund: function (ctx, x, y, r, c) {
            ctx.fillStyle = c;
            /* long body */
            ctx.beginPath();
            ctx.ellipse(x, y, r * 0.82, r * 0.26, 0, 0, Math.PI * 2);
            ctx.fill();
            /* head */
            ctx.beginPath();
            ctx.arc(x - r * 0.72, y - r * 0.12, r * 0.22, 0, Math.PI * 2);
            ctx.fill();
            /* snout */
            ctx.beginPath();
            ctx.ellipse(x - r * 0.92, y - r * 0.04,
                        r * 0.13, r * 0.09, 0, 0, Math.PI * 2);
            ctx.fill();
            /* droopy ear */
            ctx.fillStyle = shiftColor(c, -0.25);
            ctx.beginPath();
            ctx.ellipse(x - r * 0.65, y - r * 0.04,
                        r * 0.12, r * 0.20, -0.3, 0, Math.PI * 2);
            ctx.fill();
            /* 4 short legs */
            ctx.fillStyle = c;
            const legs = [-0.50, -0.18, 0.28, 0.58];
            for (let i = 0; i < legs.length; i++) {
                roundedRect(ctx, x + legs[i] * r - r * 0.06,
                            y + r * 0.18, r * 0.12, r * 0.30, r * 0.04);
                ctx.fill();
            }
            /* tail */
            ctx.beginPath();
            roundedRect(ctx, x + r * 0.70, y - r * 0.04,
                        r * 0.28, r * 0.08, r * 0.03);
            ctx.fill();
            /* eye */
            ctx.fillStyle = "#1a0e08";
            ctx.beginPath();
            ctx.arc(x - r * 0.70, y - r * 0.16, r * 0.04, 0, Math.PI * 2);
            ctx.fill();
        },

        /* ===== MODDED pack ===== */
        circuit: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.fillStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.10);
            ctx.lineCap = "square";
            /* L-shaped trace */
            ctx.beginPath();
            ctx.moveTo(x - r * 0.70, y - r * 0.55);
            ctx.lineTo(x - r * 0.70, y + r * 0.15);
            ctx.lineTo(x + r * 0.35, y + r * 0.15);
            ctx.lineTo(x + r * 0.35, y + r * 0.70);
            ctx.stroke();
            /* pads */
            const pads = [[-0.70, -0.55], [0.35, 0.70]];
            for (let i = 0; i < pads.length; i++) {
                ctx.beginPath();
                ctx.arc(x + pads[i][0] * r, y + pads[i][1] * r,
                        r * 0.13, 0, Math.PI * 2);
                ctx.fill();
            }
            /* zig-zag resistor */
            ctx.lineWidth = Math.max(2, r * 0.07);
            ctx.beginPath();
            const baseY = y + r * 0.15;
            for (let i = 0; i < 7; i++) {
                const px = x - r * 0.50 + i * r * 0.12;
                const py = baseY + (i % 2 === 0 ? -r * 0.14 : r * 0.14);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        },

        "fan-hex": function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.10);
            /* outer hex */
            for (let pass = 0; pass < 2; pass++) {
                const size = pass === 0 ? r * 0.90 : r * 0.48;
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
                    const px = x + Math.cos(a) * size;
                    const py = y + Math.sin(a) * size;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.stroke();
            }
            /* center dot */
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x, y, r * 0.10, 0, Math.PI * 2);
            ctx.fill();
        },

        "rgb-strip": function (ctx, x, y, r, c) {
            const colors = ["#ff3030", "#ffaa30", "#ffff30",
                            "#30ff30", "#30c0ff", "#5040ff", "#cc40ff"];
            const segW = (r * 1.50) / colors.length;
            const startX = x - r * 0.75;
            /* dark backing */
            ctx.fillStyle = "#0c0c0c";
            roundedRect(ctx, startX - r * 0.06, y - r * 0.25,
                        r * 1.62, r * 0.50, r * 0.10);
            ctx.fill();
            /* LEDs */
            for (let i = 0; i < colors.length; i++) {
                ctx.fillStyle = colors[i];
                roundedRect(ctx, startX + i * segW + segW * 0.10,
                            y - r * 0.18, segW * 0.80, r * 0.36,
                            r * 0.07);
                ctx.fill();
                /* shine */
                ctx.fillStyle = "rgba(255,255,255,0.45)";
                ctx.beginPath();
                ctx.ellipse(startX + i * segW + segW * 0.50,
                            y - r * 0.05,
                            segW * 0.30, r * 0.06,
                            0, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        power: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "POWER");
        },

        reset: function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "RESET");
        },

        trace: function (ctx, x, y, r, c) {
            ctx.strokeStyle = c;
            ctx.fillStyle = c;
            ctx.lineWidth = Math.max(2, r * 0.10);
            ctx.lineCap = "square";
            ctx.lineJoin = "miter";
            /* serpentine right-angle path */
            ctx.beginPath();
            ctx.moveTo(x - r * 0.85, y - r * 0.55);
            ctx.lineTo(x - r * 0.30, y - r * 0.55);
            ctx.lineTo(x - r * 0.30, y);
            ctx.lineTo(x + r * 0.30, y);
            ctx.lineTo(x + r * 0.30, y - r * 0.40);
            ctx.lineTo(x + r * 0.85, y - r * 0.40);
            ctx.stroke();
            /* vias */
            const vias = [[-0.85, -0.55], [-0.30, 0], [0.30, 0], [0.85, -0.40]];
            for (let i = 0; i < vias.length; i++) {
                ctx.beginPath();
                ctx.arc(x + vias[i][0] * r, y + vias[i][1] * r,
                        r * 0.09, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        /* ===== GAMER pack ===== */
        "pixel-heart": function (ctx, x, y, r, c) {
            const cell = r * 0.18;
            pixelGrid(ctx, x, y, c, [
                [0,1,1,0,1,1,0],
                [1,1,1,1,1,1,1],
                [1,1,1,1,1,1,1],
                [0,1,1,1,1,1,0],
                [0,0,1,1,1,0,0],
                [0,0,0,1,0,0,0]
            ], cell);
        },

        "pixel-skull": function (ctx, x, y, r, c) {
            const cell = r * 0.16;
            pixelGrid(ctx, x, y, c, [
                [0,1,1,1,1,1,0],
                [1,1,1,1,1,1,1],
                [1,0,1,1,1,0,1],
                [1,1,1,1,1,1,1],
                [0,1,0,1,0,1,0],
                [0,1,1,1,1,1,0]
            ], cell);
        },

        "cloud-8bit": function (ctx, x, y, r, c) {
            const cell = r * 0.15;
            pixelGrid(ctx, x, y, c, [
                [0,0,0,1,1,1,0,0,0],
                [0,0,1,1,1,1,1,0,0],
                [0,1,1,1,1,1,1,1,0],
                [1,1,1,1,1,1,1,1,1],
                [1,1,1,1,1,1,1,1,1],
                [0,1,1,1,1,1,1,1,0]
            ], cell);
        },

        controller: function (ctx, x, y, r, c) {
            /* body */
            ctx.fillStyle = c;
            roundedRect(ctx, x - r * 0.85, y - r * 0.32,
                        r * 1.70, r * 0.64, r * 0.28);
            ctx.fill();
            /* grips */
            ctx.beginPath();
            ctx.arc(x - r * 0.62, y + r * 0.18, r * 0.22, 0, Math.PI * 2);
            ctx.arc(x + r * 0.62, y + r * 0.18, r * 0.22, 0, Math.PI * 2);
            ctx.fill();
            /* D-pad */
            ctx.fillStyle = "#1a0e08";
            ctx.fillRect(x - r * 0.52, y - r * 0.08, r * 0.34, r * 0.16);
            ctx.fillRect(x - r * 0.43, y - r * 0.17, r * 0.16, r * 0.34);
            /* 4 face buttons */
            const cb = [[0.24, -0.10], [0.45, 0.05], [0.24, 0.20], [0.03, 0.05]];
            for (let i = 0; i < cb.length; i++) {
                ctx.beginPath();
                ctx.arc(x + cb[i][0] * r, y + cb[i][1] * r,
                        r * 0.07, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        "game-over": function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "GAME OVER");
        },

        "press-start": function (ctx, x, y, r, c) {
            textStamp(ctx, x, y, r, c, "PRESS START", { fontSize: 0.30 });
        }
    };

    /* ----- 6B. Decorate state -----
       Each pack defines its own glaze list + pattern list. The
       active pack drives the GLAZE + STAMPS palette rows. Tabs
       above the rows switch the active pack. The "@rgb-cycle"
       glaze id is a dynamic glaze whose color cycles through HSL
       in real time — see currentPaintColor().                   */
    /* Pack record schema (additive over the original):
         id         -- stable string identifier
         label      -- display name in pickers + the shop
         glazes     -- array of hex colors or @rgb-cycle
         patterns   -- array of stamp ids (PATTERN_DRAWERS keys)
         priceCents -- omit / null for free packs; integer for paid
         description -- one-liner for the shop card
         releaseDate -- ISO string; if in the future, the pack
                        appears in the shop as "DROPS <date>"
                        but isn't purchasable yet. omit = available now.
         coverEmoji -- single emoji used as shop-card cover until
                       real art lands. */
    const GLAZE_PACKS = [
        /* ============================================================
           6 FREE PACKS — 7 glazes + 5 stamps each.
           User finalizes stamps as custom PNGs pre-release.
           ============================================================ */
        {
            id: "core",  label: "BASIC",
            description: "The starter set. Earth, sage, sky, and ink.",
            coverEmoji: "\u{1FAB4}",   /* potted plant */
            glazes: [
                "#3a2218",   /* dark clay */
                "#7a3a18",   /* sienna */
                "#cc6633",   /* terracotta */
                "#e4b13e",   /* amber */
                "#f4f6ea",   /* milk white */
                "#5f8d5d",   /* sage */
                "#1a0e08"    /* ink */
            ],
            patterns: ["dot", "ring", "star", "chevron", "wave"]
        },
        {
            id: "candy", label: "CANDY",
            description: "Cherry red, blue raspberry, root beer brown.",
            coverEmoji: "\u{1F36C}",   /* candy */
            glazes: [
                "#d92128",   /* cherry red */
                "#2b6fff",   /* blue raspberry */
                "#b3e51c",   /* sour green */
                "#ffa6c9",   /* cotton candy pink */
                "#4a230b",   /* root beer brown */
                "#ff7a00",   /* orange creamsicle */
                "#9534d8"    /* grape soda */
            ],
            patterns: ["lollipop", "candy-cane", "gumballs", "drip", "dot"]
        },
        {
            id: "plushie", label: "PLUSH",
            description: "Teddy brown, pastel pink, soft plush palette.",
            coverEmoji: "\u{1F9F8}",   /* teddy bear */
            glazes: [
                "#a07050",   /* teddy brown */
                "#ffc8e0",   /* pastel pink */
                "#fff4e0",   /* soft cream */
                "#c8aedb",   /* lavender */
                "#b8d8ed",   /* sky blue */
                "#ffd5b8",   /* peach */
                "#c8efd1"    /* mint */
            ],
            patterns: ["teddy", "paw", "button", "plush-grain", "heart"]
        },
        {
            id: "modded", label: "MODDED",
            description: "RGB cycle + neon + brushed aluminum. PC-builder vibes.",
            coverEmoji: "\u{1F5A5}",   /* desktop computer */
            glazes: [
                "@rgb-cycle",   /* animated rainbow */
                "#39ff14",      /* neon green */
                "#ff10a0",      /* hot pink */
                "#00d4ff",      /* electric blue */
                "#0a0a0a",      /* black ops */
                "#c8c8c8",      /* brushed aluminum */
                "#b347ff"       /* cyber violet */
            ],
            patterns: ["circuit", "fan-hex", "rgb-strip", "power", "reset"]
        },
        {
            id: "gamer", label: "GAMER",
            description: "CRT green, scanline gray, PRESS START.",
            coverEmoji: "\u{1F3AE}",   /* video game */
            glazes: [
                "#33ff66",   /* CRT green */
                "#ff8c1a",   /* retro orange */
                "#ff2a8a",   /* arcade pink */
                "#2a3a3a",   /* scanline gray */
                "#ffea00",   /* hi-score yellow */
                "#6b1da6",   /* pixel purple */
                "#6e3713"    /* atari brown */
            ],
            patterns: ["pixel-heart", "controller", "game-over",
                       "pixel-skull", "press-start"]
        },
        {
            id: "space", label: "SPACE",
            description: "Cosmic void, nebula violet, supernova white.",
            coverEmoji: "\u{1F680}",   /* rocket */
            glazes: [
                "#05030f",   /* cosmic void */
                "#3a1f80",   /* nebula violet */
                "#7a3c8c",   /* galactic purple */
                "#2b6fff",   /* supernova blue */
                "#f4f6ea",   /* starfield white */
                "#ffd700",   /* quasar gold */
                "#00d4ff"    /* comet cyan */
            ],
            patterns: ["star", "ring", "triangle", "dot", "chevron"]
        },

        /* ============================================================
           4 PAID PACKS
           ============================================================
           99¢ each except MEGA at $1.99 (double-size: 14 glazes /
           10 stamps). releaseDate omitted = available now (no
           "DROPS <date>" gate on the shop card).

           Stamp lists are placeholder ids (core-set stamp ids) until
           user authors the bespoke PNGs for each pack. MEGA's stamps
           are loaded dynamically from MEGA_STAMP_FILES below — its
           patterns array starts empty and gets populated as PNGs
           land.
           ============================================================ */
        {
            id: "dinosaur", label: "DINOSAUR",
            description: "Fossil bone, amber, jurassic jungle greens, T-rex red.",
            coverEmoji: "\u{1F996}",   /* T-Rex */
            priceCents: 99,
            glazes: [
                "#6b5a3c",   /* fossil bone */
                "#cdb98a",   /* amber sand */
                "#e4b13e",   /* amber */
                "#3f5d2a",   /* jungle green */
                "#7a3a18",   /* dirt brown */
                "#2c1810",   /* swamp shadow */
                "#c84a3a"    /* t-rex red */
            ],
            patterns: ["triangle", "star", "x", "dot", "ring"]
        },
        {
            id: "unicorn", label: "UNICORN",
            description: "Cotton-candy pastels, holo sparkle, magic gold.",
            coverEmoji: "\u{1F984}",   /* unicorn */
            priceCents: 99,
            glazes: [
                "#ffc8e0",   /* cotton pink */
                "#c8aedb",   /* lilac */
                "#b8d8ed",   /* sky */
                "#fff4e0",   /* cream */
                "#ff8cd0",   /* hot pink */
                "#cce8c8",   /* mint */
                "#ffd700"    /* magic gold */
            ],
            patterns: ["heart", "star", "triangle", "dot", "ring"]
        },
        {
            id: "onioncore", label: "ONIONCORE",
            description: "Pootery's own palette. Hot pink + teal, dark teal frame.",
            coverEmoji: "\u{1F9C5}",   /* onion */
            priceCents: 99,
            glazes: [
                "#00ffcc",   /* teal */
                "#ff2e88",   /* hot pink */
                "#ff5cab",   /* pink bright */
                "#143842",   /* frame teal */
                "#b81866",   /* deep pink */
                "#06141a",   /* near black */
                "#eaf6f4"    /* chalk white */
            ],
            patterns: ["dot", "ring", "x", "chevron", "heart"]
        },
        {
            id: "mega", label: "MEGA",
            description: "Double-size pack: 14 metallics + electrics + RGB, 10 custom stamps.",
            coverEmoji: "\u{1F31F}",   /* glowing star */
            priceCents: 199,
            glazes: [
                "@rgb-cycle",   /* animated rainbow */
                "#ffd700",      /* gold */
                "#c0c0c0",      /* silver */
                "#b87333",      /* copper */
                "#4a4a4a",      /* gunmetal */
                "#ff0080",      /* electric magenta */
                "#00ff80",      /* electric mint */
                "#80ff00",      /* electric lime */
                "#ff8000",      /* electric orange */
                "#8000ff",      /* electric violet */
                "#f5f5f5",      /* chalk */
                "#1a0e08",      /* deep ink */
                "#ffa6c9",      /* cotton */
                "#c8e2a8"       /* soft sage */
            ],
            /* Empty — populated by loadMegaStamps() from
               MEGA_STAMP_FILES below. Target: 10 stamps. */
            patterns: []
        }
    ];

    const D = {
        canvas: null,
        ctx: null,
        paintCanvas: null,   /* offscreen — accumulates strokes / stamps */
        paintCtx: null,
        dpr: 1,

        activePackId: "core",
        glaze:   "#cc6633",
        tool:    "brush",     /* "brush" | "stamp" | "eraser" */
        size:    14,          /* logical-px stroke half-thickness */
        pattern: "dot",
        stampRotation: 0,     /* radians — applied in stampAt */

        pointer: null,
        pointerActive: false,
        lastPaintPos: null,
        strokedThisGesture: false,

        /* Flips true the moment the kid places a custom imported
           sticker on this pot. Persisted onto the saved gallery
           entry; the battle-submit path blocks any tainted entry
           from going public (local-only UGC safety boundary). */
        usedCustomSticker: false,

        /* Zoom + pan for detail work.
           zoom: display multiplier (1.0 = canvas at its natural CSS
                 size; 4.0 = 4x scale on top of CSS sizing).
           panX, panY: CSS-pixel offsets applied BEFORE the scale,
                 because transform-origin is 0 0. Clamped so the
                 canvas can't drift entirely off the wrap.
           Two-finger pinch zooms; two-finger drag pans; single
           finger still paints at any zoom level. Reset button +
           desktop wheel-zoom round it out. */
        zoom: 1,
        panX: 0,
        panY: 0,

        /* Multi-touch tracking state for pinch / pan gestures.
           pointerId -> { clientX, clientY }. */
        activePointers: null,
        gestureStart: null,    /* { distance, midX, midY, zoom, panX, panY } */

        /* Undo / redo stacks — PNG dataURL snapshots of the paint
           canvas. Undo captures the BEFORE state at the start of
           each user gesture; popping it pushes the current state
           into redoStack so the user can step back forward. Any
           NEW action (pushUndoSnapshot) clears redoStack — once
           you start a new branch, the old future is gone (this
           is the standard editor model). PNG compresses sparse
           canvases extremely well so 20 levels of each stays well
           under a couple of MB even with busy decoration. */
        undoStack: [],
        redoStack: [],

        running: false,
        rafId: null,
        lastT: 0,
        inited: false
    };

    const UNDO_LIMIT = 20;

    function snapshotPaint() {
        if (!D.paintCanvas) return null;
        try { return D.paintCanvas.toDataURL("image/png"); }
        catch (e) {
            console.warn("[CRAYte] snapshot failed", e);
            return null;
        }
    }

    /* Replace the paint canvas pixels with a dataURL snapshot.
       Transform is reset before drawImage so the snapshot lands
       in pixel coords (it was taken at native res via toDataURL),
       not in the DPR-scaled logical space the brush uses. */
    function restorePaintFromDataURL(dataUrl, onDone) {
        if (!dataUrl || !D.paintCtx) { if (onDone) onDone(); return; }
        const img = new Image();
        img.onload = function () {
            D.paintCtx.save();
            D.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
            D.paintCtx.clearRect(0, 0,
                D.paintCanvas.width, D.paintCanvas.height);
            D.paintCtx.drawImage(img, 0, 0);
            D.paintCtx.restore();
            if (onDone) onDone();
        };
        img.src = dataUrl;
    }

    function pushUndoSnapshot() {
        if (!D.paintCanvas) return;
        const snap = snapshotPaint();
        if (snap) {
            D.undoStack.push(snap);
            while (D.undoStack.length > UNDO_LIMIT) D.undoStack.shift();
        }
        /* A new action invalidates any redo branch — once you start
           drawing again, the previously-undone future is gone. */
        D.redoStack.length = 0;
        updateUndoRedoButtons();
    }

    function popUndo() {
        if (D.undoStack.length === 0) return;
        /* Stash current state in redoStack so REDO can come back. */
        const before = snapshotPaint();
        const dataUrl = D.undoStack.pop();
        restorePaintFromDataURL(dataUrl, function () {
            if (before) {
                D.redoStack.push(before);
                while (D.redoStack.length > UNDO_LIMIT) D.redoStack.shift();
            }
            updateUndoRedoButtons();
        });
    }

    function popRedo() {
        if (D.redoStack.length === 0) return;
        /* Stash current so UNDO can step back through this branch. */
        const before = snapshotPaint();
        const dataUrl = D.redoStack.pop();
        restorePaintFromDataURL(dataUrl, function () {
            if (before) {
                D.undoStack.push(before);
                while (D.undoStack.length > UNDO_LIMIT) D.undoStack.shift();
            }
            updateUndoRedoButtons();
        });
    }

    function clearUndoStack() {
        D.undoStack.length = 0;
        D.redoStack.length = 0;
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        const u = document.getElementById("undoBtn");
        const r = document.getElementById("redoBtn");
        if (u) u.disabled = D.undoStack.length === 0;
        if (r) r.disabled = D.redoStack.length === 0;
    }

    function activePack() {
        for (let i = 0; i < GLAZE_PACKS.length; i++) {
            if (GLAZE_PACKS[i].id === D.activePackId) return GLAZE_PACKS[i];
        }
        return GLAZE_PACKS[0];
    }

    /* ============================================================
       MEGA PACK custom stamps — Day 5 chunk D
       ============================================================
       MEGA is now defined as a paid pack in GLAZE_PACKS above; this
       block just populates its patterns[] array dynamically from
       PNGs committed to assets/patterns/. To add a stamp:
         1. Drop a PNG (transparent bg recommended) into
            lets-crayte-pootery/assets/patterns/
         2. Add an entry to MEGA_STAMP_FILES below with a unique id
            (becomes the pattern id) + the filename
         3. Commit + push — next page load shows it in the MEGA tab.
       Target: 10 stamps for the launch MEGA pack.
       ============================================================ */

    /* Locate the MEGA pack inside GLAZE_PACKS so loadMegaStamps
       can push pattern ids into its patterns array. */
    const MEGA_PACK = (function () {
        for (let i = 0; i < GLAZE_PACKS.length; i++) {
            if (GLAZE_PACKS[i].id === "mega") return GLAZE_PACKS[i];
        }
        return null;
    }());

    /* Stamp manifest. Add entries here as you commit PNGs.
       Example (uncomment AFTER the file lands in the folder):

           { id: "shrek",     file: "shrek.png" },
           { id: "doge",      file: "doge.png" },
           { id: "rare-pepe", file: "rare-pepe.png" }
    */
    const MEGA_STAMP_FILES = [
        { id: "arrows",     file: "arrows.png" },
        { id: "hatchmark",  file: "hatchmark.png" },
        { id: "kokopelli",  file: "kokopelli.png" },
        { id: "mountains",  file: "mountains.png" },
        { id: "triangles",  file: "triangles.png" }
    ];

    /* Image cache — populated by loadMegaStamps so the PATTERN
       drawer can reach the HTMLImageElement on each render. */
    const MEGA_IMAGES = Object.create(null);

    function megaStampDrawer(id) {
        return function (ctx, x, y, r, _c) {
            const img = MEGA_IMAGES[id];
            const size = r * 1.9;
            if (img && img.complete && img.naturalWidth > 0) {
                ctx.save();
                /* Preserve aspect ratio: fit the image within a
                   2r x 2r box and center. */
                const ratio = img.naturalWidth / img.naturalHeight;
                let w = size * 2;
                let h = size * 2;
                if (ratio > 1) h = w / ratio;
                else if (ratio < 1) w = h * ratio;
                ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
                ctx.restore();
            } else {
                /* Not loaded yet — placeholder ring so the stamp
                   doesn't render as a void. Replaced once onload
                   fires + the UI rebuilds. */
                ctx.strokeStyle = "rgba(255, 46, 136, 0.55)";
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        };
    }

    function loadMegaStamps() {
        if (!MEGA_PACK) return;
        if (!MEGA_STAMP_FILES || MEGA_STAMP_FILES.length === 0) return;

        MEGA_STAMP_FILES.forEach(function (entry) {
            if (!entry || !entry.id || !entry.file) return;
            if (MEGA_PACK.patterns.indexOf(entry.id) >= 0) return;

            const img = new Image();
            /* Same-origin requests don't need CORS; if a user ever
               moves PNGs to an external host they should set
               img.crossOrigin = "anonymous" here. */
            img.onload = function () {
                /* Rebuild the decorate palette so the placeholder
                   icon swaps to the real image. */
                if (currentScreen === "decorate" &&
                    typeof buildToolUI === "function") {
                    buildToolUI();
                }
            };
            img.onerror = function () {
                console.warn("[CRAYte] mega stamp missing: " + entry.file);
            };
            img.src = "assets/patterns/" + entry.file;
            MEGA_IMAGES[entry.id] = img;

            PATTERN_DRAWERS[entry.id] = megaStampDrawer(entry.id);
            MEGA_PACK.patterns.push(entry.id);
        });
    }

    /* Register on module eval — happens after PATTERN_DRAWERS is
       defined and before init() so the MEGA pack is ready when
       decorate first mounts. */
    loadMegaStamps();

    /* The MODDED pack's "@rgb-cycle" glaze cycles through HSL in
       real time. Strokes / stamps placed with it capture the
       current cycle color at paint time, so a single stroke
       produces a smooth rainbow trail (the user sees the swatch
       cycling and can time their motion). Chunk 8 will layer a
       real-time animated overlay on top (the OVERCLOCKED easter
       egg). For any static hex, this just passes through.       */
    function currentPaintColor() {
        if (D.glaze === "@rgb-cycle") {
            const h = (performance.now() * 0.18) % 360;
            return "hsl(" + h.toFixed(1) + ", 95%, 55%)";
        }
        return D.glaze;
    }

    function setPack(packId) {
        if (D.activePackId === packId) return;
        D.activePackId = packId;
        const pack = activePack();
        /* Snap glaze + pattern back to the new pack's first item
           so the user never has a non-existent selection. */
        D.glaze = pack.glazes[0];
        D.pattern = pack.patterns[0];
        buildToolUI();
    }

    /* ----- 6C. Init / sizing ----- */

    function initDecorate() {
        const c = document.getElementById("decorateCanvas");
        if (!c) {
            console.warn("[CRAYte] no #decorateCanvas");
            return;
        }
        D.canvas = c;
        D.ctx = c.getContext("2d");

        /* Offscreen paint layer — DPR-scaled so strokes look crisp
           on retina. Coordinates are in logical 400×600 space via
           setTransform; resize keeps existing strokes by drawImage
           through a temp canvas. */
        D.paintCanvas = document.createElement("canvas");
        D.paintCtx = D.paintCanvas.getContext("2d");
        sizeDecorateCanvas();

        D.paintCtx.lineCap = "round";
        D.paintCtx.lineJoin = "round";

        attachDecoratePointer();
        wireDecorateButtons();
        attachPackTabs();
        wireUndoAndRotate();
        buildToolUI();

        if (typeof ResizeObserver === "function") {
            const ro = new ResizeObserver(function () { sizeDecorateCanvas(); });
            ro.observe(c);
        }
    }

    /* Pack ownership -- localStorage source of truth.
       Free packs are always considered "owned" (priceCents
       missing or 0). Paid packs require explicit purchase.
       Eventually syncs from profiles.owned_packs when signed
       in, but localStorage stays canonical so anonymous play
       keeps working. */
    const OWNED_PACKS_KEY = "crayte-owned-packs";

    function loadOwnedPacks() {
        try {
            const raw = JSON.parse(localStorage.getItem(OWNED_PACKS_KEY) || "[]");
            return new Set(Array.isArray(raw) ? raw : []);
        } catch (_) { return new Set(); }
    }

    function saveOwnedPacks(set) {
        try {
            localStorage.setItem(OWNED_PACKS_KEY,
                JSON.stringify(Array.from(set)));
        } catch (_) {}
    }

    function markPackOwned(packId) {
        const s = loadOwnedPacks();
        s.add(packId);
        saveOwnedPacks(s);
        /* If user is in decorate, refresh the tabs so the newly
           owned pack appears immediately. */
        if (currentScreen === "decorate") renderPackTabs();
    }

    function isPackOwned(pack) {
        if (!pack) return false;
        if (!pack.priceCents) return true;   /* free */
        return loadOwnedPacks().has(pack.id);
    }

    function isPackReleased(pack) {
        if (!pack || !pack.releaseDate) return true;
        return new Date(pack.releaseDate).getTime() <= Date.now();
    }

    /* A pack is decorate-visible iff it's free, OR it's paid +
       owned + released. Paid-not-owned packs live in the SHOP
       screen only -- they don't clutter the decorate picker. */
    function isPackUsable(pack) {
        if (!pack) return false;
        if (!isPackReleased(pack)) return false;
        if (!pack.priceCents) return true;
        return isPackOwned(pack);
    }

    /* (Re)build the decorate pack-tabs row from GLAZE_PACKS.
       Owned + free packs only. Clicks are handled via event
       delegation on the container so re-renders don't need
       re-binding. */
    function renderPackTabs() {
        const row = document.getElementById("packTabs");
        if (!row) return;
        row.innerHTML = "";
        GLAZE_PACKS.forEach(function (p) {
            if (!isPackUsable(p)) return;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "pack-tab";
            btn.dataset.pack = p.id;
            btn.textContent = p.label;
            if (p.id === D.activePackId) btn.classList.add("active");
            row.appendChild(btn);
        });
    }

    function attachPackTabs() {
        const row = document.getElementById("packTabs");
        if (!row) return;
        /* Event delegation so dynamic re-renders don't lose handlers. */
        if (row._delegated) return;
        row.addEventListener("click", function (e) {
            const tab = e.target.closest(".pack-tab[data-pack]");
            if (!tab) return;
            setPack(tab.dataset.pack);
        });
        row._delegated = true;
        renderPackTabs();
    }

    function wireUndoAndRotate() {
        /* Undo + Redo buttons */
        const undoBtn = document.getElementById("undoBtn");
        if (undoBtn) undoBtn.addEventListener("click", popUndo);
        const redoBtn = document.getElementById("redoBtn");
        if (redoBtn) redoBtn.addEventListener("click", popRedo);

        /* Global keyboard:
             Ctrl/Cmd+Z         -> undo
             Ctrl/Cmd+Shift+Z   -> redo
             Ctrl/Cmd+Y         -> redo (Windows convention)
           Only fires on the decorate screen, and skipped when
           focus is in a text input so we don't hijack the gallery
           name field / auth email field. */
        document.addEventListener("keydown", function (e) {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (currentScreen !== "decorate") return;
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
            const k = (e.key || "").toLowerCase();
            if (k === "z" && !e.shiftKey) {
                e.preventDefault();
                popUndo();
            } else if ((k === "z" && e.shiftKey) || k === "y") {
                e.preventDefault();
                popRedo();
            }
        });

        /* Rotation slider */
        const slider = document.getElementById("stampRotate");
        const valEl  = document.getElementById("stampRotateValue");
        const reset  = document.getElementById("stampRotateReset");

        function applyRotation(deg) {
            const d = ((deg % 360) + 360) % 360;
            D.stampRotation = d * Math.PI / 180;
            if (slider && slider.value !== String(d)) slider.value = d;
            if (valEl) valEl.textContent = d + "°";
        }

        if (slider) slider.addEventListener("input", function () {
            applyRotation(parseInt(slider.value, 10) || 0);
        });
        if (reset) reset.addEventListener("click", function () { applyRotation(0); });
    }

    function sizeDecorateCanvas() {
        const dpr = window.devicePixelRatio || 1;
        D.dpr = dpr;
        const bw = Math.round(SHAPE.W * dpr);
        const bh = Math.round(SHAPE.H * dpr);
        if (D.canvas) {
            if (D.canvas.width !== bw)  D.canvas.width  = bw;
            if (D.canvas.height !== bh) D.canvas.height = bh;
            D.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        if (D.paintCanvas && (D.paintCanvas.width !== bw ||
                              D.paintCanvas.height !== bh)) {
            /* Preserve existing paint across DPR / resize. */
            const tmp = document.createElement("canvas");
            tmp.width  = D.paintCanvas.width  || 1;
            tmp.height = D.paintCanvas.height || 1;
            if (D.paintCanvas.width && D.paintCanvas.height) {
                tmp.getContext("2d").drawImage(D.paintCanvas, 0, 0);
            }
            D.paintCanvas.width  = bw;
            D.paintCanvas.height = bh;
            D.paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            D.paintCtx.lineCap = "round";
            D.paintCtx.lineJoin = "round";
            if (tmp.width > 1 && tmp.height > 1) {
                D.paintCtx.drawImage(tmp, 0, 0, SHAPE.W, SHAPE.H);
            }
        }
    }

    function clearPaint() {
        if (!D.paintCtx) return;
        D.paintCtx.save();
        D.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
        D.paintCtx.clearRect(0, 0, D.paintCanvas.width, D.paintCanvas.height);
        D.paintCtx.restore();
        /* Clearing wipes any prior custom-sticker pixels too — flag
           starts fresh until a new sticker lands. */
        D.usedCustomSticker = false;
    }

    /* ----- 6D. Pointer / paint ----- */

    function decPointerPos(e) {
        const r = D.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * SHAPE.W / r.width,
            y: (e.clientY - r.top)  * SHAPE.H / r.height
        };
    }

    /* ----- Zoom + pan helpers ----- */

    const ZOOM_MIN = 1, ZOOM_MAX = 4;

    function wireZoomControls() {
        const inBtn  = document.getElementById("zoomInBtn");
        const outBtn = document.getElementById("zoomOutBtn");
        const resetBtn = document.getElementById("zoomResetBtn");
        /* Idempotent -- attach once, reset wiring on re-entry just
           updates the badge. */
        if (inBtn && !inBtn._wired) {
            inBtn.addEventListener("click", function () {
                /* Zoom around the canvas center when invoked via
                   button -- no focal cursor available. */
                const r = D.canvas ? D.canvas.getBoundingClientRect() : null;
                if (!r) return;
                setZoom(D.zoom * 1.25,
                        r.left + r.width / 2, r.top + r.height / 2);
            });
            inBtn._wired = true;
        }
        if (outBtn && !outBtn._wired) {
            outBtn.addEventListener("click", function () {
                const r = D.canvas ? D.canvas.getBoundingClientRect() : null;
                if (!r) return;
                setZoom(D.zoom / 1.25,
                        r.left + r.width / 2, r.top + r.height / 2);
            });
            outBtn._wired = true;
        }
        if (resetBtn && !resetBtn._wired) {
            resetBtn.addEventListener("click", resetZoom);
            resetBtn._wired = true;
        }
        updateZoomBadge();
    }

    function applyDecorateTransform() {
        if (!D.canvas) return;
        D.canvas.style.transformOrigin = "0 0";
        D.canvas.style.transform =
            "translate(" + D.panX + "px, " + D.panY + "px) scale(" + D.zoom + ")";
        updateZoomBadge();
    }

    /* Keep the canvas anchored so it can't drift entirely off the
       visible wrap. Allows ~half the canvas to spill in either
       direction so the user can comfortably edit edges. */
    function clampPan() {
        if (!D.canvas) return;
        const r = D.canvas.getBoundingClientRect();
        const wrap = D.canvas.parentElement;
        if (!wrap) return;
        const wr = wrap.getBoundingClientRect();
        const maxOff = 0.5 * Math.max(r.width, r.height);
        /* When zoom = 1 + content fits, force pan to 0. */
        if (D.zoom <= 1.001) { D.panX = 0; D.panY = 0; return; }
        const minX = wr.width - r.width - maxOff;
        const maxX = maxOff;
        const minY = wr.height - r.height - maxOff;
        const maxY = maxOff;
        D.panX = Math.max(minX, Math.min(maxX, D.panX));
        D.panY = Math.max(minY, Math.min(maxY, D.panY));
    }

    function setZoom(z, focusClientX, focusClientY) {
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
        if (Math.abs(next - D.zoom) < 0.001) return;
        /* Zoom around a focal point (pinch center or cursor) so
           the content under the focus stays put. */
        if (focusClientX != null && D.canvas) {
            const r = D.canvas.getBoundingClientRect();
            /* The focus's offset from the canvas's CURRENT top-left
               (in unscaled CSS coords) */
            const ox = (focusClientX - r.left) / D.zoom;
            const oy = (focusClientY - r.top)  / D.zoom;
            const dz = next - D.zoom;
            D.panX -= ox * dz;
            D.panY -= oy * dz;
        }
        D.zoom = next;
        clampPan();
        applyDecorateTransform();
    }

    function resetZoom() {
        D.zoom = 1; D.panX = 0; D.panY = 0;
        applyDecorateTransform();
    }

    function updateZoomBadge() {
        const badge = document.getElementById("zoomBadge");
        if (badge) badge.textContent = Math.round(D.zoom * 100) + "%";
        const reset = document.getElementById("zoomResetBtn");
        if (reset) reset.disabled = (D.zoom <= 1.001 && D.panX === 0 && D.panY === 0);
    }

    /* ----- Multi-pointer attach ----- */

    function attachDecoratePointer() {
        const c = D.canvas;
        D.activePointers = new Map();

        const startPaintAt = function (p) {
            D.pointer = p;
            D.pointerActive = true;
            D.lastPaintPos = p;
            D.strokedThisGesture = false;
            /* Snapshot BEFORE the gesture so undo restores the
               canvas to its pre-gesture state. One snapshot per
               gesture = one undo per stroke / stamp / eraser
               action — natural Ctrl+Z behavior. */
            pushUndoSnapshot();
            if (D.tool === "stamp") { stampAt(p); }
            else                    { paintDot(p); }
            D.strokedThisGesture = true;
        };

        const cancelPaint = function () {
            if (!D.pointerActive) return;
            D.pointerActive = false;
            D.lastPaintPos = null;
            /* The undo snapshot already landed but the gesture
               is being interrupted by a second finger -- that's
               fine, the snapshot still represents the pre-paint
               state if the user undoes. */
        };

        const beginGesture = function () {
            const pts = Array.from(D.activePointers.values());
            if (pts.length < 2) return;
            const a = pts[0], b = pts[1];
            const dx = b.clientX - a.clientX;
            const dy = b.clientY - a.clientY;
            D.gestureStart = {
                distance: Math.hypot(dx, dy) || 1,
                midX:    (a.clientX + b.clientX) / 2,
                midY:    (a.clientY + b.clientY) / 2,
                zoom:    D.zoom,
                panX:    D.panX,
                panY:    D.panY
            };
        };

        const updateGesture = function () {
            const pts = Array.from(D.activePointers.values());
            if (pts.length < 2 || !D.gestureStart) return;
            const a = pts[0], b = pts[1];
            const dx = b.clientX - a.clientX;
            const dy = b.clientY - a.clientY;
            const dist = Math.hypot(dx, dy) || 1;
            const midX = (a.clientX + b.clientX) / 2;
            const midY = (a.clientY + b.clientY) / 2;

            /* Compute target zoom relative to the gesture start. */
            const targetZoom = D.gestureStart.zoom * (dist / D.gestureStart.distance);
            const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, targetZoom));

            /* Apply zoom around the original gesture midpoint, then
               add the pan delta from midpoint movement. */
            const wrap = D.canvas.parentElement;
            const wr = wrap.getBoundingClientRect();
            /* Convert original midpoint to canvas-local (unscaled) */
            const startRect = {
                /* We need the canvas position AT GESTURE START -- but
                   it's moved since then. Reconstruct using the
                   stored start pan/zoom: */
                left: wr.left + D.gestureStart.panX,
                top:  wr.top  + D.gestureStart.panY
            };
            const ox = (D.gestureStart.midX - startRect.left) / D.gestureStart.zoom;
            const oy = (D.gestureStart.midY - startRect.top)  / D.gestureStart.zoom;

            D.zoom = clamped;
            D.panX = D.gestureStart.panX - ox * (clamped - D.gestureStart.zoom)
                                         + (midX - D.gestureStart.midX);
            D.panY = D.gestureStart.panY - oy * (clamped - D.gestureStart.zoom)
                                         + (midY - D.gestureStart.midY);
            clampPan();
            applyDecorateTransform();
        };

        c.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            try { c.setPointerCapture(e.pointerId); } catch (_) {}
            D.activePointers.set(e.pointerId,
                { clientX: e.clientX, clientY: e.clientY });

            if (D.activePointers.size === 1) {
                startPaintAt(decPointerPos(e));
            } else if (D.activePointers.size === 2) {
                /* Second finger landed -- cancel paint, start
                   pinch/pan gesture. */
                cancelPaint();
                beginGesture();
            }
        });

        c.addEventListener("pointermove", function (e) {
            if (!D.activePointers.has(e.pointerId)) return;
            const ref = D.activePointers.get(e.pointerId);
            ref.clientX = e.clientX;
            ref.clientY = e.clientY;

            if (D.activePointers.size >= 2) {
                updateGesture();
                return;
            }
            /* Single-finger -- normal paint flow */
            if (!D.pointerActive) return;
            const p = decPointerPos(e);
            if (D.tool !== "stamp") paintStrokeTo(p);
            D.lastPaintPos = p;
            D.pointer = p;
        });

        const endPointer = function (e) {
            D.activePointers.delete(e.pointerId);
            try { c.releasePointerCapture(e.pointerId); } catch (_) {}

            if (D.activePointers.size === 0) {
                /* All fingers lifted */
                if (D.pointerActive) {
                    D.pointerActive = false;
                    D.lastPaintPos = null;
                }
                D.gestureStart = null;
            } else if (D.activePointers.size === 1 && D.gestureStart) {
                /* Was a 2-finger gesture, now down to 1. Don't
                   resume painting mid-stroke -- wait for full
                   release. */
                D.gestureStart = null;
            } else if (D.activePointers.size >= 2) {
                /* Re-anchor the gesture so removing one finger
                   from a 3-finger touch doesn't cause a jump. */
                beginGesture();
            }
        };
        c.addEventListener("pointerup",     endPointer);
        c.addEventListener("pointercancel", endPointer);
        c.addEventListener("pointerleave",  endPointer);

        /* Desktop wheel -> zoom around cursor */
        c.addEventListener("wheel", function (e) {
            e.preventDefault();
            const delta = -Math.sign(e.deltaY) * 0.18;
            setZoom(D.zoom * (1 + delta), e.clientX, e.clientY);
        }, { passive: false });
    }

    /* Spray + splat painter (Day-5 QoL chunk).
       kind = "spray"    -> ~16 small low-alpha dots clustered
                            tightly around p, density-builds
                            into soft airbrush gradient.
       kind = "splatter" -> ~6 bigger high-alpha dots scattered
                            further out, less density.
       Uses globalAlpha rather than building rgba strings so the
       same code path handles hex glazes and hsl() RGB-cycle. */
    function spraySplat(p, kind) {
        const ctx = D.paintCtx;
        const isSplat = (kind === "splatter");
        const dots    = isSplat ? (4 + Math.floor(Math.random() * 5))
                                : (12 + Math.floor(Math.random() * 8));
        const eSize  = effectiveBrushSize();
        const spread  = isSplat ? (eSize * 2.6) : (eSize * 1.3);
        const baseAlpha = isSplat ? 0.38 : 0.10;
        ctx.save();
        ctx.fillStyle = currentPaintColor();
        for (let i = 0; i < dots; i++) {
            /* sqrt(rand) for uniform distribution in disk
               (otherwise dots cluster at center). */
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * spread;
            const dx = p.x + Math.cos(a) * r;
            const dy = p.y + Math.sin(a) * r;
            const dotR = isSplat
                ? (1 + Math.random() * 3)
                : (0.6 + Math.random() * 1.5);
            ctx.globalAlpha = baseAlpha * (0.7 + Math.random() * 0.6);
            ctx.beginPath();
            ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        noteGlazeUsed(D.glaze);
    }

    /* Splatter is throttled in paintStrokeTo so drag-events
       don't paint a continuous wall — every 3rd move emits. */
    let _splatStrokeCount = 0;

    /* Effective paint radius in canvas-px. Divides D.size by D.zoom
       so a zoomed-in view lets the kid draw fine details — the tool
       tip stays roughly the same SCREEN size at any zoom level.
       Floored so it can't disappear into sub-pixel land. */
    function effectiveBrushSize() {
        const z = (D && D.zoom > 0.01) ? D.zoom : 1;
        return Math.max(0.6, D.size / z);
    }

    function paintDot(p) {
        const ctx = D.paintCtx;
        if (D.tool === "spray") {
            spraySplat(p, "spray");
            spraySound();
            return;
        }
        if (D.tool === "splatter") {
            spraySplat(p, "splatter");
            splatterSound();
            haptic(10);
            return;
        }
        ctx.save();
        if (D.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "#000";
        } else {
            ctx.fillStyle = currentPaintColor();
            noteGlazeUsed(D.glaze);
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, effectiveBrushSize(), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function paintStrokeTo(p) {
        const ctx = D.paintCtx;
        const last = D.lastPaintPos;
        if (!last) { paintDot(p); return; }

        if (D.tool === "spray") {
            spraySplat(p, "spray");
            if (Math.random() < 0.18) spraySound();
            return;
        }
        if (D.tool === "splatter") {
            _splatStrokeCount++;
            if (_splatStrokeCount % 3 === 0) {
                spraySplat(p, "splatter");
                splatterSound();
                haptic(8);
            }
            return;
        }

        ctx.save();
        if (D.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.strokeStyle = "#000";
        } else {
            ctx.strokeStyle = currentPaintColor();
        }
        ctx.lineWidth = effectiveBrushSize() * 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
        /* Soft "shh" on a fraction of moves — a long stroke
           becomes a stream of brushy puffs, not a constant hiss.
           Only for brush (eraser stays silent — it's destructive
           and the user wants to focus on what they're removing). */
        if (D.tool === "brush" && Math.random() < 0.18) brushStroke();
    }

    function stampAt(p) {
        const fn = PATTERN_DRAWERS[D.pattern];
        if (!fn) return;
        /* Custom-sticker placements taint the pot — it stays local. */
        if (isCustomStickerId(D.pattern)) D.usedCustomSticker = true;
        /* Slightly bigger than brush dot so a "thin" stamp still
           reads as a recognizable shape. Scales with zoom alongside
           the brush so a zoomed-in view stamps smaller details. */
        const r = effectiveBrushSize() * 1.7;
        const color = currentPaintColor();
        const ctx = D.paintCtx;
        if (D.stampRotation) {
            /* Rotate around the stamp's center: translate to (p.x,
               p.y), rotate, then draw the stamp at (0,0). */
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(D.stampRotation);
            fn(ctx, 0, 0, r, color);
            ctx.restore();
        } else {
            fn(ctx, p.x, p.y, r, color);
        }
        stampClick();
        haptic(15);
        noteGlazeUsed(D.glaze);
        notePatternUsed(D.pattern);
    }

    /* ----- 6D2. CUSTOM STICKERS (local-only) -----
       The kid imports a transparent PNG from their device, it
       becomes a stamp tile in the decorate palette, persists
       across sessions, and any pot that uses one is flagged
       (D.usedCustomSticker -> entry.usedCustomSticker). The
       battle-submit path REFUSES tainted entries, so arbitrary
       user images never enter the shared/public surface. */

    const CUSTOM_STICKER_KEY = "crayte-custom-stickers";
    const CUSTOM_STICKER_MAX = 12;     /* cabinet size */
    const CUSTOM_STICKER_PX  = 256;    /* downsample max edge */
    let CUSTOM_STICKERS = [];          /* {id, dataURL, img}[] */

    function isCustomStickerId(id) {
        return typeof id === "string" && id.indexOf("custom-") === 0;
    }

    function registerCustomStickerDrawer(rec) {
        /* Imported PNG keeps its own pixels — ignore the paint
           color so transparency + sticker colors are preserved.
           Drawn into the same r*2 box every other stamp uses. */
        PATTERN_DRAWERS[rec.id] = function (ctx, x, y, r /*, color */) {
            if (rec.img && rec.img.complete && rec.img.naturalWidth > 0) {
                ctx.drawImage(rec.img, x - r, y - r, r * 2, r * 2);
            }
        };
    }

    function loadCustomStickers() {
        try {
            const raw = localStorage.getItem(CUSTOM_STICKER_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            CUSTOM_STICKERS = arr.map(function (s) {
                const img = new Image();
                img.src = s.dataURL;
                const rec = { id: s.id, dataURL: s.dataURL, img: img };
                registerCustomStickerDrawer(rec);
                return rec;
            });
        } catch (_) { CUSTOM_STICKERS = []; }
    }

    function persistCustomStickers() {
        try {
            const arr = CUSTOM_STICKERS.map(function (s) {
                return { id: s.id, dataURL: s.dataURL };
            });
            localStorage.setItem(CUSTOM_STICKER_KEY, JSON.stringify(arr));
        } catch (_) {}
    }

    function pickCustomStickerFile() {
        /* Plain <input type=file> works fine in Capacitor's WebView
           — no native camera/photos plugin needed. */
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png";
        input.style.display = "none";
        input.addEventListener("change", function () {
            const f = input.files && input.files[0];
            document.body.removeChild(input);
            if (f) importStickerFile(f);
        });
        document.body.appendChild(input);
        input.click();
    }

    function importStickerFile(file) {
        const reader = new FileReader();
        reader.onload = function () {
            const img = new Image();
            img.onload = function () {
                /* Downsample so localStorage + render cost stay sane. */
                const max = CUSTOM_STICKER_PX;
                const scale = Math.min(1,
                    max / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width  * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const c = document.createElement("canvas");
                c.width = w; c.height = h;
                c.getContext("2d").drawImage(img, 0, 0, w, h);
                const dataURL = c.toDataURL("image/png");
                const rec = {
                    id: "custom-" + Date.now().toString(36) + "-" +
                        Math.random().toString(36).slice(2, 6),
                    dataURL: dataURL,
                    img: new Image()
                };
                rec.img.src = dataURL;
                CUSTOM_STICKERS.push(rec);
                /* Cap the cabinet — drop the oldest beyond the limit
                   and unregister its drawer so the id can't resolve. */
                while (CUSTOM_STICKERS.length > CUSTOM_STICKER_MAX) {
                    const dropped = CUSTOM_STICKERS.shift();
                    delete PATTERN_DRAWERS[dropped.id];
                }
                registerCustomStickerDrawer(rec);
                persistCustomStickers();
                /* Pre-select the freshly-imported sticker, rebuild the
                   palette so it appears, and flip into STAMP mode. */
                D.pattern = rec.id;
                if (typeof buildToolUI === "function") buildToolUI();
                if (typeof setTool === "function") setTool("stamp");
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    /* Eager load so PATTERN_DRAWERS entries are registered before
       any render touches them. */
    loadCustomStickers();

    /* ----- 6E. Tool UI ----- */

    function buildToolUI() {
        const pack = activePack();

        /* Pack tabs are dynamic (renderPackTabs filters by
           ownership). The render itself toggles .active on the
           matching tab; just call it. */
        renderPackTabs();

        /* Glaze swatches */
        const gp = document.getElementById("glazePalette");
        if (gp) {
            gp.innerHTML = "";
            pack.glazes.forEach(function (gid) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "swatch";
                btn.dataset.glaze = gid;
                if (gid === "@rgb-cycle") {
                    /* CSS handles the animated rainbow background. */
                    btn.classList.add("dynamic-rgb");
                    btn.setAttribute("aria-label", "RGB cycle glaze");
                    btn.title = "RGB CYCLE";
                } else {
                    btn.style.background = gid;
                    btn.setAttribute("aria-label", "Glaze " + gid);
                }
                if (gid === D.glaze) btn.classList.add("active");
                btn.addEventListener("click", function () {
                    D.glaze = gid;
                    gp.querySelectorAll(".swatch").forEach(function (s) {
                        s.classList.toggle("active", s.dataset.glaze === gid);
                    });
                    /* Picking a glaze while on eraser snaps back to brush. */
                    if (D.tool === "eraser") setTool("brush");
                });
                gp.appendChild(btn);
            });
        }

        /* Pattern stamps */
        const pp = document.getElementById("patternPalette");
        if (pp) {
            pp.innerHTML = "";
            pack.patterns.forEach(function (id) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "stamp-btn";
                btn.dataset.pattern = id;
                btn.setAttribute("aria-label", "Pattern " + id);
                /* Mini preview canvas as the icon */
                const mini = document.createElement("canvas");
                mini.width = 36;
                mini.height = 36;
                const mctx = mini.getContext("2d");
                mctx.translate(18, 18);
                const fn = PATTERN_DRAWERS[id];
                if (fn) fn(mctx, 0, 0, 12, "#eaf6f4");
                btn.appendChild(mini);
                if (id === D.pattern) btn.classList.add("active");
                btn.addEventListener("click", function () {
                    D.pattern = id;
                    pp.querySelectorAll(".stamp-btn").forEach(function (s) {
                        s.classList.toggle("active", s.dataset.pattern === id);
                    });
                    /* Picking a stamp implies STAMP mode. */
                    setTool("stamp");
                });
                pp.appendChild(btn);
            });

            /* Custom imported stickers — always appended, after the
               current pack's stamps, so the kid's own collection
               travels across pack switches. Visually marked so it's
               obvious they're personal (and that submitting them to
               battles is blocked). */
            CUSTOM_STICKERS.forEach(function (rec) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "stamp-btn is-custom-sticker";
                btn.dataset.pattern = rec.id;
                btn.setAttribute("aria-label",
                    "Your imported sticker (local only, not for battles)");
                btn.title = "Imported sticker — local only";
                /* Use the image itself as the icon. */
                const thumb = document.createElement("img");
                thumb.src = rec.dataURL;
                thumb.alt = "";
                thumb.width = 32; thumb.height = 32;
                thumb.style.objectFit = "contain";
                btn.appendChild(thumb);
                if (rec.id === D.pattern) btn.classList.add("active");
                btn.addEventListener("click", function () {
                    D.pattern = rec.id;
                    pp.querySelectorAll(".stamp-btn").forEach(function (s) {
                        s.classList.toggle("active",
                            s.dataset.pattern === rec.id);
                    });
                    setTool("stamp");
                });
                pp.appendChild(btn);
            });

            /* "+" tile that opens the file picker — PAID PACKS
               ONLY. Custom-PNG import is a paid-tier feature; free
               packs surface only their bundled stamps + any custom
               stickers the kid already owns (those still display
               in every pack so a paid-pack import isn't trapped
               behind one specific pack tab). */
            if (pack && pack.priceCents > 0) {
                const addBtn = document.createElement("button");
                addBtn.type = "button";
                addBtn.className = "stamp-btn is-add-sticker";
                addBtn.setAttribute("aria-label",
                    "Import a transparent PNG as a custom sticker");
                addBtn.title = "Import sticker (PNG)";
                addBtn.textContent = "+";
                addBtn.addEventListener("click", pickCustomStickerFile);
                pp.appendChild(addBtn);
            }
        }

        /* Tool-mode buttons */
        document.querySelectorAll(".tool-btn[data-tool]").forEach(function (b) {
            b.addEventListener("click", function () {
                setTool(b.dataset.tool);
            });
            b.classList.toggle("active", b.dataset.tool === D.tool);
        });

        /* Size slider (matches the ROT slider pattern so all
           tool-row inputs share one control vocabulary). */
        const sizeSlider = document.getElementById("brushSize");
        const sizeValue  = document.getElementById("brushSizeValue");
        if (sizeSlider) {
            sizeSlider.value = String(D.size);
            if (sizeValue) sizeValue.textContent = String(D.size);
            sizeSlider.addEventListener("input", function () {
                const v = parseInt(sizeSlider.value, 10);
                if (!isNaN(v) && v > 0) {
                    D.size = v;
                    if (sizeValue) sizeValue.textContent = String(v);
                }
            });
        }
    }

    function setTool(tool) {
        D.tool = tool;
        document.querySelectorAll(".tool-btn[data-tool]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.tool === tool);
        });
        if (D.canvas) {
            D.canvas.style.cursor = (tool === "eraser") ? "cell" : "crosshair";
        }
    }

    /* ----- 6F. Buttons ----- */

    function wireDecorateButtons() {
        const back  = document.getElementById("decBack");
        const clear = document.getElementById("decClear");
        const fire  = document.getElementById("decFire");

        if (back) back.addEventListener("click", function () {
            /* Re-shape escape hatch: unlock clay; paint persists so
               the decoration deforms with any re-shaping (the paint
               composite is clipped to the new silhouette). Undo
               stack is decorate-scope; clear it on the way out. */
            clearUndoStack();
            SHAPE.clayLocked = false;
            showScreen("shape");
        });

        if (clear) clear.addEventListener("click", function () {
            /* Make CLEAR undoable — push the current state before
               wiping. One tap CLEAR + one tap UNDO restores the
               previous paint, which is the expected mental model. */
            pushUndoSnapshot();
            clearPaint();
            flashButton(clear);
        });

        if (fire) fire.addEventListener("click", function () {
            flashButton(fire);
            if (SCREENS["kiln"]) {
                /* User gesture — wake up Web Audio here so the kiln
                   roar can play (browsers block context until then). */
                ensureKilnAudio();
                /* Firing commits — no undo back through the firing. */
                clearUndoStack();
                showScreen("kiln");
            } else {
                flashStub(fire, "KILN OFFLINE");
            }
        });
    }

    /* ----- 6G. Frame loop ----- */

    function decorateFrame(t) {
        if (!D.running) return;
        if (!D.lastT) D.lastT = t;
        const dt = Math.min(48, t - D.lastT);
        D.lastT = t;

        /* Wheel is FROZEN in decorate so the pot reads as "off
           the wheel" while you paint. drawPot also keys off
           currentScreen to pin the highlight strip to a static
           offset instead of animating it. */
        renderPotScene(D.ctx, { paintCanvas: D.paintCanvas, particles: false });
        D.rafId = requestAnimationFrame(decorateFrame);
    }

    function startDecorateLoop() {
        if (D.running) return;
        D.running = true;
        D.lastT = 0;
        D.rafId = requestAnimationFrame(decorateFrame);
    }

    function stopDecorateLoop() {
        D.running = false;
        if (D.rafId) cancelAnimationFrame(D.rafId);
        D.rafId = null;
    }

    /* ----- 6H. Register with the router ----- */

    registerScreen("decorate", {
        onEnter: function () {
            if (!D.inited) {
                initDecorate();
                D.inited = true;
            } else {
                sizeDecorateCanvas();
            }
            /* Reset zoom on every entry so the canvas always
               starts at 100% -- avoids confusing the next pot
               with a half-zoomed view from a previous one. */
            resetZoom();
            wireZoomControls();
            startDecorateLoop();
            wheelHumStart();
            if (typeof refreshRemixInProgressChip === "function") {
                refreshRemixInProgressChip();
            }
        },
        onLeave: function () {
            stopDecorateLoop();
        }
    });

    /* ============================================================
       KILN SCREEN — chunk 5: firing animation
       ============================================================
       State machine: intro -> closing -> firing -> opening ->
       reveal -> done. Each transition fires the matching audio
       (door thunk, kiln roar, ding) and triggers auto-save when
       reveal lands. The pot itself renders via renderPotScene
       with opts.fired so the same composite chain handles the
       fired-glaze warmth.
       ============================================================ */

    const KILN = {
        canvas: null,
        ctx: null,
        dpr: 1,

        state: "idle",       /* idle | intro | closing | firing | opening | reveal | done */
        stateT: 0,

        doorProgress: 1.0,   /* 1 = fully open, 0 = fully closed */
        potOffsetY: 0,       /* slide-in from below during intro */
        glowIntensity: 0,    /* 0-1 — orange interior glow */
        glowPhase: 0,        /* for pulsing */
        sparks: [],
        crackleTimer: 0,

        fired: false,        /* true once the firing reveal lands */
        exploded: false,     /* set true if the pot blows up mid-fire */
        willExplode: false,  /* the 3% roll, decided at intro */
        shards: [],          /* clay shrapnel during/after explosion */
        audio: null,
        savedId: null,       /* id of the latest auto-saved pot */

        lastT: 0,
        rafId: null,
        running: false,
        inited: false
    };

    const KILN_DUR = {
        intro:    500,
        closing:  700,
        /* Firing extended from 3500ms -> 5000ms. The longer window
           gives the kid more time to click during firing, which
           feeds the overheat / burnt-pot mechanic. Recorded
           kiln-fire.mp3 is sized to this 5s window. */
        firing:   5000,
        opening:  700,
        reveal:   1500,
        exploded: 2500,   /* shards-fly window after a kaboom */
        done:     Infinity
    };

    /* ~3% chance any given firing ends in tears. The reward
       loop is that exploded pots still save to the gallery as
       their own kind of trophy — see autoSaveFiredPot. */
    const EXPLODE_CHANCE = 0.03;

    const NICE_POT_LINES = [
        "NICE POT",
        "POT IS HARD NOW",
        "POTTERY ACHIEVED",
        "HOT STUFF",
        "VERY WAS POOTED",
        "CONGRATS DUDE",
        "SO CRAYTED"
    ];

    const EXPLODED_LINES = [
        "POT EXPLODED",
        "WELP",
        "RIP POT",
        "POOTSPLOSION",
        "NOT THE POT",
        "POT FELL APART",
        "KILN SAID NO",
        "TOO MUCH CLAY ENERGY"
    ];

    /* ----- 7A. Init ----- */

    function initKiln() {
        const c = document.getElementById("kilnCanvas");
        if (!c) { console.warn("[CRAYte] no #kilnCanvas"); return; }
        KILN.canvas = c;
        KILN.ctx = c.getContext("2d");
        sizeKilnCanvas();
        wireKilnButtons();

        if (typeof ResizeObserver === "function") {
            const ro = new ResizeObserver(function () { sizeKilnCanvas(); });
            ro.observe(c);
        }
    }

    function sizeKilnCanvas() {
        const dpr = window.devicePixelRatio || 1;
        KILN.dpr = dpr;
        const c = KILN.canvas;
        if (!c) return;
        const bw = Math.round(SHAPE.W * dpr);
        const bh = Math.round(SHAPE.H * dpr);
        if (c.width !== bw)  c.width  = bw;
        if (c.height !== bh) c.height = bh;
        KILN.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ----- 7B. Buttons ----- */

    function wireKilnButtons() {
        const back    = document.getElementById("kilnBack");
        const again   = document.getElementById("kilnAgain");
        const fresh   = document.getElementById("kilnNew");
        const gallery = document.getElementById("kilnGallery");

        if (back) back.addEventListener("click", function () {
            stopKilnLoop();
            /* Drop fired status if user bailed mid-firing; keep it
               otherwise so a subsequent re-fire still looks fired. */
            if (KILN.state !== "done" && KILN.state !== "reveal") {
                KILN.fired = false;
            }
            SHAPE.clayLocked = false;
            showScreen("decorate");
        });

        if (again) again.addEventListener("click", function () {
            /* Lock clay back so decorate stays in paint mode. */
            SHAPE.clayLocked = true;
            showScreen("decorate");
        });

        if (fresh) fresh.addEventListener("click", function () {
            /* Fresh slate — reset clay + paint, return to shape.
               New pot ⇒ empty wheel, drag a fresh lump on. */
            resetClay();
            if (typeof clearPaint === "function") clearPaint();
            SHAPE.clayLocked = false;
            SHAPE.needsLump = true;
            KILN.fired = false;
            showScreen("shape");
        });

        if (gallery) gallery.addEventListener("click", function () {
            if (SCREENS["gallery"]) {
                showScreen("gallery");
            } else {
                flashStub(gallery, "GALLERY SOON");
            }
        });
    }

    function setKilnStatus(text) {
        const el = document.getElementById("kilnStatus");
        if (el) el.textContent = text;
    }

    function showCelebrate() {
        const cel = document.getElementById("kilnCelebrate");
        const sub = document.getElementById("kilnSub");
        const title = document.getElementById("kilnCelebTitle");
        const saved = document.getElementById("kilnSaved");
        const ctrls = document.getElementById("kilnControls");
        const pool = KILN.exploded ? EXPLODED_LINES : NICE_POT_LINES;
        if (sub) sub.textContent = pool[
            Math.floor(Math.random() * pool.length)
        ];
        if (title) title.textContent = KILN.exploded ? "EXPLODED" : "FIRED";
        if (cel) cel.classList.toggle("is-exploded", KILN.exploded);
        if (saved) {
            saved.textContent = KILN.savedId
                ? (KILN.exploded
                    ? "✓ SHRAPNEL ARCHIVED"
                    : "✓ SAVED TO GALLERY")
                : "⚠ SAVE FAILED";
            saved.hidden = false;
        }
        if (cel) cel.hidden = false;
        if (ctrls) ctrls.hidden = false;
    }

    function hideCelebrate() {
        const cel = document.getElementById("kilnCelebrate");
        const ctrls = document.getElementById("kilnControls");
        if (cel) cel.hidden = true;
        if (ctrls) ctrls.hidden = true;
    }

    /* ----- 7C. Auto-save (chunk 6 reads from the same key) ----- */

    function autoSaveFiredPot() {
        try {
            const key = "crayte-gallery";
            let existing = [];
            try {
                existing = JSON.parse(localStorage.getItem(key) || "[]");
                if (!Array.isArray(existing)) existing = [];
            } catch (_) { existing = []; }

            const entry = {
                id: "pot-" + Date.now() + "-" +
                    Math.random().toString(36).slice(2, 8),
                createdAt: Date.now(),
                clay: SHAPE.clay.map(function (c) {
                    return { y: c.y, radius: c.radius };
                }),
                clayTypeId: SHAPE.clayTypeId,
                paintDataUrl: (D.paintCanvas)
                    ? D.paintCanvas.toDataURL("image/png")
                    : null,
                packId: D.activePackId,
                fired: true,
                /* Chunk-8 egg: overheated pots get an extra-crispy
                   render in the gallery + a tag. */
                overfired: EGG.overheatTriggered === true,
                /* Stable seed so the saved char pattern matches
                   what the user saw in the kiln. */
                overfiredSeed: EGG.overheatSeed || 0,
                /* Day-4 chunk B: exploded pots saved as shattered
                   trophies rather than thrown out. */
                exploded: KILN.exploded === true,
                /* Local-only UGC flag — any imported PNG sticker
                   used on this pot taints the entry and blocks it
                   from public battle submission. Carries forward
                   on remix so a tainted source can't be laundered. */
                usedCustomSticker: !!D.usedCustomSticker ||
                    !!(REMIX.pending && REMIX.pending.usedCustomSticker)
            };
            /* If this firing was started via REMIX, bake the
               lineage in. Cleared after consumption so a follow-up
               un-remixed firing doesn't get the stale credit. */
            if (REMIX.pending) {
                entry.remixedFrom       = REMIX.pending.remixedFrom;
                entry.remixedFromAuthor = REMIX.pending.remixedFromAuthor;
                entry.remixedFromHandle = REMIX.pending.remixedFromHandle;
                entry.remixedFromName   = REMIX.pending.remixedFromName;
                REMIX.pending = null;
                /* Hide the persistent chip now that the remix is
                   committed to a real local pot. */
                if (typeof refreshRemixInProgressChip === "function") {
                    refreshRemixInProgressChip();
                }
            }
            existing.push(entry);
            /* Cap at 50 — keep newest. Brief calls for the "you have
               a lot of pots" celebration screen at ~50.            */
            while (existing.length > 50) existing.shift();
            localStorage.setItem(key, JSON.stringify(existing));
            KILN.savedId = entry.id;
            /* Day-4 chunk C — every new pot may complete an
               achievement; run the check after the save lands. */
            checkAchievements();
            /* Chunk W3 — first fired pot is the earned moment to
               surface the push opt-in. maybeShowPushOptIn() is a
               no-op if we've already prompted, are still inside
               a "maybe later" window, or push isn't supported.   */
            maybeShowPushOptIn();
            return true;
        } catch (e) {
            console.warn("[CRAYte] auto-save failed", e);
            KILN.savedId = null;
            return false;
        }
    }

    /* ----- 7D. Audio (Web Audio, all synthesized) ----- */

    /* Routes through the shared bootstrap so KILN, SHAPE, and the
       title poot all live on the same AudioContext. KILN.audio
       kept as a cache for the rest of the chunk-5 functions that
       still reference it; populate it here on first call.       */
    function ensureKilnAudio() {
        const ctx = ensureAudio();
        if (ctx) KILN.audio = ctx;
        return ctx;
    }

    function kilnRoar(durationSec) {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        const now = ctx.currentTime;
        /* Brown-ish noise via low-pass-filtered noise buffer */
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5),
                                      ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 220;
        lp.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.20, now + 0.5);
        g.gain.linearRampToValueAtTime(0.20, now + Math.max(0.5, durationSec - 0.5));
        g.gain.linearRampToValueAtTime(0,    now + durationSec);
        src.connect(lp); lp.connect(g); g.connect(ctx.destination);
        src.start(now);
        src.stop(now + durationSec + 0.05);
    }

    function kilnCrackle() {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        const now = ctx.currentTime;
        const len = Math.floor(ctx.sampleRate * 0.06);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 2.5);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1100;
        const g = ctx.createGain();
        g.gain.value = 0.07 + Math.random() * 0.05;
        src.connect(hp); hp.connect(g); g.connect(ctx.destination);
        src.start(now);
    }

    function kilnDoorThunk(strength) {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        strength = strength || 1;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.32);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.45 * strength, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
    }

    function kilnDing() {
        const ctx = ensureKilnAudio();
        if (!ctx) return;
        const now = ctx.currentTime;
        /* Two-tone bell (perfect fifth) for a "pot done" celebration */
        [1320, 1980].forEach(function (freq, i) {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq;
            const g = ctx.createGain();
            const start = now + i * 0.05;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(0.18, start + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, start + 1.6);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 1.7);
        });
    }

    /* ----- 7E. Sparks (rise above the chimney during firing) ----- */

    function emitKilnSpark() {
        if (KILN.sparks.length > 36) return;
        const cx = SHAPE.centerX + (Math.random() - 0.5) * 50;
        KILN.sparks.push({
            x: cx,
            y: 60 + Math.random() * 20,
            vx: (Math.random() - 0.5) * 0.04,
            vy: -0.06 - Math.random() * 0.05,
            life: 900 + Math.random() * 600,
            age: 0,
            size: 1.2 + Math.random() * 1.6,
            hue: 22 + Math.random() * 22
        });
    }

    function updateSparks(dt) {
        const s = KILN.sparks;
        for (let i = s.length - 1; i >= 0; i--) {
            const p = s[i];
            p.age += dt;
            if (p.age >= p.life) { s.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            /* Sparks drift sideways slightly */
            p.vx += (Math.random() - 0.5) * 0.0008 * dt;
        }
    }

    function drawKilnSparks(ctx) {
        const s = KILN.sparks;
        for (let i = 0; i < s.length; i++) {
            const p = s[i];
            const t = p.age / p.life;
            const a = (1 - t) * 0.9;
            ctx.fillStyle = "hsla(" + p.hue + ", 100%, 65%, " + a + ")";
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ----- 7E2. Shards (kiln explosion) -----
       28 chunks of clay launch outward from the pot at the
       moment of detonation. Each carries gravity + rotation +
       its own clay-colored facets so they look like ceramic
       fragments, not just generic confetti.                   */
    function spawnExplosion() {
        KILN.shards.length = 0;
        const mat = currentClay();
        /* The shards inherit one of the clay's gradient stops so a
           porcelain explosion is white shards, a galaxy explosion
           is blue, etc. */
        const palette = mat.unfired.slice(1, 5);
        const count = 28;
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const speed = 0.18 + Math.random() * 0.25;
            const startY = 150 + Math.random() * 320;
            KILN.shards.push({
                x:  SHAPE.centerX + (Math.random() - 0.5) * 80,
                y:  startY,
                vx: Math.cos(a) * speed,
                vy: Math.sin(a) * speed - 0.18,   /* bias upward */
                rot: Math.random() * Math.PI * 2,
                vrot: (Math.random() - 0.5) * 0.012,
                size: 7 + Math.random() * 14,
                color: palette[Math.floor(Math.random() * palette.length)],
                edge:  mat.outline,
                life:  KILN_DUR.exploded,
                age:   0
            });
        }
    }

    function updateShards(dt) {
        const s = KILN.shards;
        const grav = 0.0009;
        for (let i = s.length - 1; i >= 0; i--) {
            const p = s[i];
            p.age += dt;
            if (p.age >= p.life) { s.splice(i, 1); continue; }
            p.vy += grav * dt;
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;
            p.rot += p.vrot * dt;
        }
    }

    function drawKilnShards(ctx) {
        const s = KILN.shards;
        for (let i = 0; i < s.length; i++) {
            const p = s[i];
            const t = p.age / p.life;
            const a = Math.max(0, 1 - t * 0.85);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            /* Jagged triangular shard */
            ctx.fillStyle = p.color;
            ctx.strokeStyle = p.edge;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(0, -p.size * 0.5);
            ctx.lineTo(p.size * 0.45, p.size * 0.3);
            ctx.lineTo(-p.size * 0.35, p.size * 0.55);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }

    /* Explosion SFX — big low rumble + sharp crack + reverb-y
       crackle tail. All synthesized, no samples.               */
    function explosionSfx() {
        const ctx = ensureAudio();
        if (!ctx || ctx.state !== "running") return;
        const now = ctx.currentTime;
        /* Low rumble */
        const rumbleLen = Math.floor(ctx.sampleRate * 0.7);
        const buf = ctx.createBuffer(1, rumbleLen, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < rumbleLen; i++) {
            const env = Math.pow(1 - i / rumbleLen, 0.45);
            const white = Math.random() * 2 - 1;
            last = (last + 0.03 * white) / 1.03;
            data[i] = last * 4.5 * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 380;
        const gR = ctx.createGain();
        gR.gain.value = 0.45;
        src.connect(lp); lp.connect(gR); gR.connect(ctx.destination);
        src.start(now);
        /* Sharp transient */
        const oscK = ctx.createOscillator();
        oscK.type = "square";
        oscK.frequency.setValueAtTime(90, now);
        oscK.frequency.exponentialRampToValueAtTime(22, now + 0.18);
        const gK = ctx.createGain();
        gK.gain.setValueAtTime(0.42, now);
        gK.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
        oscK.connect(gK); gK.connect(ctx.destination);
        oscK.start(now); oscK.stop(now + 0.32);
        /* Crackle tail (4 quick pops) */
        for (let i = 0; i < 4; i++) {
            setTimeout(kilnCrackle, 80 + i * 90 + Math.random() * 60);
        }
    }

    /* ----- 7F. Kiln chrome ----- */

    /* Layout constants for the kiln frame around the doorway. */
    const KILN_FRAME = {
        wallX:   18,        /* left wall thickness */
        wallY:   60,        /* top wall (under chimney) */
        floorY:  20,        /* bottom wall thickness */
        doorY0:  60,        /* top of doorway */
        doorY1:  580,       /* bottom of doorway */
        doorX0:  18,        /* left edge of doorway interior */
        doorX1:  382,       /* right edge of doorway interior */
        chimneyX0: 162,
        chimneyX1: 238,
        chimneyTop: 0,
        chimneyBot: 60
    };

    function drawKilnChrome(ctx) {
        const f = KILN_FRAME;

        /* Outer body fill — dark steel with subtle vertical gradient */
        const body = ctx.createLinearGradient(0, 0, 0, SHAPE.H);
        body.addColorStop(0,   "#1a2830");
        body.addColorStop(0.6, "#101c22");
        body.addColorStop(1,   "#0a1418");
        ctx.fillStyle = body;
        /* Top hood */
        ctx.fillRect(0, 0, SHAPE.W, f.doorY0);
        /* Left wall */
        ctx.fillRect(0, f.doorY0, f.doorX0, f.doorY1 - f.doorY0);
        /* Right wall */
        ctx.fillRect(f.doorX1, f.doorY0, SHAPE.W - f.doorX1, f.doorY1 - f.doorY0);
        /* Hearth floor */
        ctx.fillRect(0, f.doorY1, SHAPE.W, SHAPE.H - f.doorY1);

        /* Chimney cutout (lighter — looks like it's open to sky/smoke) */
        ctx.fillStyle = "#06141a";
        ctx.fillRect(f.chimneyX0, 0, f.chimneyX1 - f.chimneyX0,
                     f.chimneyBot);

        /* Chimney walls (frame the cutout) */
        ctx.fillStyle = body;
        const chW = 12;
        ctx.fillRect(f.chimneyX0 - chW, 0, chW, f.chimneyBot + 4);
        ctx.fillRect(f.chimneyX1,       0, chW, f.chimneyBot + 4);

        /* Copper trim along the doorway opening */
        const copperGrad = ctx.createLinearGradient(0, 0, SHAPE.W, 0);
        copperGrad.addColorStop(0,    "#5a3010");
        copperGrad.addColorStop(0.5,  "#c08040");
        copperGrad.addColorStop(1,    "#5a3010");
        ctx.fillStyle = copperGrad;
        const tw = 4;
        /* Top trim */
        ctx.fillRect(f.doorX0 - tw, f.doorY0 - tw,
                     f.doorX1 - f.doorX0 + tw * 2, tw);
        /* Left trim */
        ctx.fillRect(f.doorX0 - tw, f.doorY0,
                     tw, f.doorY1 - f.doorY0);
        /* Right trim */
        ctx.fillRect(f.doorX1, f.doorY0,
                     tw, f.doorY1 - f.doorY0);
        /* Bottom trim */
        ctx.fillRect(f.doorX0 - tw, f.doorY1,
                     f.doorX1 - f.doorX0 + tw * 2, tw);

        /* Rivets along the hood */
        ctx.fillStyle = "#4a5860";
        for (let x = 30; x < SHAPE.W - 30; x += 28) {
            ctx.beginPath();
            ctx.arc(x, 12, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x, 42, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        /* CRT-style nameplate on the hood */
        ctx.fillStyle = "#0a1418";
        roundedRect(ctx, SHAPE.W / 2 - 70, 22, 140, 22, 4);
        ctx.fill();
        ctx.strokeStyle = "#c08040";
        ctx.lineWidth = 1;
        roundedRect(ctx, SHAPE.W / 2 - 70, 22, 140, 22, 4);
        ctx.stroke();
        ctx.fillStyle = "#ff6a2a";
        ctx.font = "13px " + "\"VT323\", \"Courier New\", monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("KILN-9000", SHAPE.W / 2, 34);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";

        /* Heat-indicator LED — pulses brighter during firing */
        const ledX = SHAPE.W / 2 + 80;
        const ledOn = KILN.glowIntensity > 0.1;
        if (ledOn) {
            ctx.fillStyle = "rgba(255, 80, 30, 0.5)";
            ctx.beginPath();
            ctx.arc(ledX, 34, 8, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = ledOn ? "#ff5a1f" : "#3a1818";
        ctx.beginPath();
        ctx.arc(ledX, 34, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawKilnDoors(ctx, progress) {
        /* progress: 1 = fully open (doors hidden against walls),
                    0 = fully closed (doors meet at centerX).      */
        const f = KILN_FRAME;
        const doorH = f.doorY1 - f.doorY0;
        const halfDoor = (f.doorX1 - f.doorX0) / 2;
        /* When open, doors are tucked behind a strip along the walls. */
        const tucked = 6;
        const leftDoorX  = f.doorX0 - tucked + progress * (halfDoor - tucked) * 0;
        const closedLeftX  = f.doorX0;
        const openLeftX    = f.doorX0 - halfDoor + tucked;
        const lx = openLeftX + (closedLeftX - openLeftX) * (1 - progress);

        const closedRightX = f.doorX0 + halfDoor;
        const openRightX   = f.doorX1 - tucked;
        const rx = openRightX + (closedRightX - openRightX) * (1 - progress);

        /* Door body gradient */
        const dGrad = ctx.createLinearGradient(0, 0, 0, doorH);
        dGrad.addColorStop(0,   "#22323a");
        dGrad.addColorStop(0.5, "#101a22");
        dGrad.addColorStop(1,   "#0a1418");

        /* Left door */
        ctx.fillStyle = dGrad;
        ctx.fillRect(lx, f.doorY0, halfDoor, doorH);
        /* Right door */
        ctx.fillRect(rx, f.doorY0, halfDoor, doorH);

        /* Door-edge highlight */
        ctx.strokeStyle = "rgba(255, 200, 140, 0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx + halfDoor - 0.5, f.doorY0);
        ctx.lineTo(lx + halfDoor - 0.5, f.doorY1);
        ctx.moveTo(rx + 0.5, f.doorY0);
        ctx.lineTo(rx + 0.5, f.doorY1);
        ctx.stroke();

        /* Door rivets — 4 down the inner edge of each */
        ctx.fillStyle = "#4a5860";
        for (let i = 0; i < 4; i++) {
            const y = f.doorY0 + 40 + i * ((doorH - 80) / 3);
            ctx.beginPath();
            ctx.arc(lx + halfDoor - 14, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(rx + 14, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        /* Copper handles */
        ctx.fillStyle = "#c08040";
        roundedRect(ctx, lx + halfDoor - 22, f.doorY0 + doorH / 2 - 18,
                    6, 36, 2);
        ctx.fill();
        roundedRect(ctx, rx + 16,           f.doorY0 + doorH / 2 - 18,
                    6, 36, 2);
        ctx.fill();
    }

    function drawKilnGlow(ctx) {
        const f = KILN_FRAME;
        const intensity = KILN.glowIntensity *
            (0.85 + 0.15 * Math.sin(KILN.glowPhase * 0.18));

        /* Interior glow — radial from the seam between doors. The
           glow leaks out where the doors are most closed. */
        const cx = SHAPE.centerX;
        const cy = (f.doorY0 + f.doorY1) / 2;
        const seamGap = Math.max(0, (1 - KILN.doorProgress)); /* 0..1 */

        ctx.save();
        ctx.globalCompositeOperation = "lighter";

        /* Big radial body glow visible through the doorway interior
           (when doors are fully closed, this still bleeds through
           the door faces a touch — sells the heat). */
        const bigR = 240;
        const radGlow = ctx.createRadialGradient(cx, cy, 20, cx, cy, bigR);
        radGlow.addColorStop(0,
            "rgba(255, 180, 60, " + (0.55 * intensity) + ")");
        radGlow.addColorStop(0.4,
            "rgba(255, 90, 30, "  + (0.35 * intensity) + ")");
        radGlow.addColorStop(1, "rgba(255, 90, 30, 0)");
        ctx.fillStyle = radGlow;
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);

        /* Bright seam line where the doors meet — most visible at
           the moment of full closure. */
        if (seamGap > 0.85) {
            const seamA = (seamGap - 0.85) / 0.15;
            const seamGrad = ctx.createLinearGradient(cx - 12, 0, cx + 12, 0);
            seamGrad.addColorStop(0,   "rgba(255, 200, 80, 0)");
            seamGrad.addColorStop(0.5,
                "rgba(255, 240, 120, " + (0.9 * seamA * intensity) + ")");
            seamGrad.addColorStop(1,   "rgba(255, 200, 80, 0)");
            ctx.fillStyle = seamGrad;
            ctx.fillRect(cx - 12, f.doorY0, 24, f.doorY1 - f.doorY0);
        }

        /* Chimney plume — column of warm glow rising out the top */
        const chimGrad = ctx.createLinearGradient(0, 0, 0, f.chimneyBot);
        chimGrad.addColorStop(0, "rgba(255, 90, 30, 0)");
        chimGrad.addColorStop(1, "rgba(255, 180, 60, " + (0.55 * intensity) + ")");
        ctx.fillStyle = chimGrad;
        ctx.fillRect(KILN_FRAME.chimneyX0, 0,
                     KILN_FRAME.chimneyX1 - KILN_FRAME.chimneyX0,
                     f.chimneyBot);

        ctx.restore();
    }

    function renderKiln() {
        const ctx = KILN.ctx;

        /* Background */
        ctx.fillStyle = "#04101a";
        ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);

        /* Pot in place (translated during intro for slide-in). The
           pot's own backdrop is suppressed — kiln chrome is its own
           background. Wheel + corners suppressed (kiln chrome owns
           those areas). Skip the pot entirely once the kiln has
           detonated — there's nothing left to render. */
        if (!KILN.exploded) {
            ctx.save();
            ctx.translate(0, KILN.potOffsetY);
            renderPotScene(ctx, {
                paintCanvas: D.paintCanvas,
                particles:   false,
                background:  false,
                wheel:       false,
                corners:     false,
                fired:       KILN.fired,
                overfired:   EGG.overheatTriggered,
                overfiredSeed: EGG.overheatSeed
            });
            ctx.restore();
        }

        /* Glow comes from BEHIND the doors when doors are mostly
           closed (firing). For visual layering we draw it now —
           the doors will mask most of it. */
        if (KILN.glowIntensity > 0) drawKilnGlow(ctx);

        /* Kiln chrome wraps around the pot. */
        drawKilnChrome(ctx);

        /* Doors over the doorway. */
        drawKilnDoors(ctx, KILN.doorProgress);

        /* Sparks live ABOVE the kiln (chimney smoke). */
        drawKilnSparks(ctx);

        /* Shards on top of everything during explosion. */
        if (KILN.shards.length) drawKilnShards(ctx);
    }

    /* ----- 7G. State machine ----- */

    function kilnEnter(state) {
        KILN.state = state;
        KILN.stateT = 0;
        if (state === "intro") {
            setKilnStatus("LOADING");
            KILN.doorProgress = 1.0;
            KILN.glowIntensity = 0;
            KILN.fired = false;
            KILN.exploded = false;
            KILN.shards.length = 0;
            /* Roll the 3% kaboom now so the kiln knows whether
               it's heading for FIRED or EXPLODED before doors
               close. EGG.oneFrameFire skips the roll (devs want
               predictable behavior). */
            KILN.willExplode = !EGG.oneFrameFire &&
                               Math.random() < EXPLODE_CHANCE;
            clearOverheat();
            hideCelebrate();
            /* 1-FRAME EXPLOSION ON FIRE (dev egg) — skip every
               intermediate state and land at reveal next frame.
               Plays the ding immediately for the "explosion".  */
            if (EGG.oneFrameFire) {
                setKilnStatus("FIRED");
                KILN.fired = true;
                autoSaveFiredPot();
                kilnDing();
                showCelebrate();
                kilnEnter("done");
                return;
            }
        } else if (state === "closing") {
            setKilnStatus("DOORS CLOSING");
            haptic([16]);
            /* No door audio — kiln-sequence covers the dramatic arc
               at firing-entry. (Synth kilnDoorThunk available as a
               manual fallback if she ever wants door clunks back.) */
        } else if (state === "firing") {
            setKilnStatus("FIRING IT");
            haptic([22]);
            kilnSequencePlay(KILN_DUR.firing / 1000);
        } else if (state === "opening") {
            setKilnStatus("DOORS OPENING");
            haptic([16]);
        } else if (state === "reveal") {
            setKilnStatus("FIRED");
            KILN.fired = true;
            autoSaveFiredPot();
            kilnDing();
            haptic([12, 40, 24, 40, 60]);
            showCelebrate();
        } else if (state === "exploded") {
            setKilnStatus("EXPLODED");
            KILN.exploded = true;
            spawnExplosion();
            explosionSfx();
            haptic([90, 40, 60, 40, 200]);
            autoSaveFiredPot();
            showCelebrate();
        } else if (state === "done") {
            /* user takes the wheel from here */
        }
    }

    function kilnAdvance() {
        switch (KILN.state) {
            case "intro":    kilnEnter("closing");  break;
            case "closing":  kilnEnter("firing");   break;
            /* Firing branches: explode at the peak (~60% in) or
               continue to a normal opening + reveal. */
            case "firing":   kilnEnter(KILN.willExplode
                                ? "exploded" : "opening"); break;
            case "opening":  kilnEnter("reveal");   break;
            case "reveal":   kilnEnter("done");     break;
            case "exploded": kilnEnter("done");     break;
        }
    }

    function kilnFrame(t) {
        if (!KILN.running) return;
        if (!KILN.lastT) KILN.lastT = t;
        const dt = Math.min(48, t - KILN.lastT);
        KILN.lastT = t;

        SHAPE.wheelPhase += (2 * Math.PI * SHAPE.WHEEL_RPM / 60) * (dt / 1000);
        if (SHAPE.wheelPhase > Math.PI * 2) SHAPE.wheelPhase -= Math.PI * 2;

        KILN.stateT += dt;
        KILN.glowPhase += dt / 100;

        const dur = KILN_DUR[KILN.state] || Infinity;
        if (KILN.stateT >= dur) kilnAdvance();

        /* Per-state derived values */
        const st = KILN.state, t01 = KILN.stateT / dur;
        if (st === "intro") {
            /* slide pot up from below */
            const eased = 1 - Math.pow(1 - t01, 3); /* easeOutCubic */
            KILN.potOffsetY = (1 - eased) * 220;
            KILN.doorProgress = 1.0;
            KILN.glowIntensity = 0;
        } else if (st === "closing") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = 1 - t01;
            KILN.glowIntensity = t01 * 0.25;
        } else if (st === "firing") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = 0;
            /* Ramp up to peak in the first 25%, hold, then cool */
            if (t01 < 0.25) {
                KILN.glowIntensity = 0.25 + (t01 / 0.25) * 0.75;
            } else if (t01 < 0.80) {
                KILN.glowIntensity = 1.0;
            } else {
                KILN.glowIntensity = 1.0 - (t01 - 0.80) / 0.20 * 0.55;
            }
            if (Math.random() < 0.6) emitKilnSpark();
            KILN.crackleTimer += dt;
            if (KILN.crackleTimer > 160 + Math.random() * 240) {
                kilnCrackle();
                KILN.crackleTimer = 0;
            }
            /* Pre-emptive kaboom at the peak (~60% in) — gives
               the explosion time to play its full 2.5s window
               before the user clicks anything. The else branch
               in kilnAdvance still routes to "opening" if we
               somehow reach 100% without detonating. */
            if (KILN.willExplode && t01 >= 0.60) {
                kilnEnter("exploded");
            }
        } else if (st === "opening") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = t01;
            KILN.glowIntensity = Math.max(0, 0.45 - t01 * 0.45);
        } else if (st === "reveal" || st === "done") {
            KILN.potOffsetY = 0;
            KILN.doorProgress = 1;
            KILN.glowIntensity = 0;
        } else if (st === "exploded") {
            /* Doors fling open + a brief glow flare that fades fast */
            KILN.potOffsetY = 0;
            KILN.doorProgress = Math.min(1, t01 * 3);
            KILN.glowIntensity = Math.max(0, 1.0 - t01 * 2.5);
            updateShards(dt);
        } else { /* idle */
            KILN.doorProgress = 1;
            KILN.glowIntensity = 0;
        }

        updateSparks(dt);
        renderKiln();
        KILN.rafId = requestAnimationFrame(kilnFrame);
    }

    function startKilnLoop() {
        if (KILN.running) return;
        KILN.running = true;
        KILN.lastT = 0;
        KILN.rafId = requestAnimationFrame(kilnFrame);
    }

    function stopKilnLoop() {
        KILN.running = false;
        if (KILN.rafId) cancelAnimationFrame(KILN.rafId);
        KILN.rafId = null;
    }

    /* ----- 7H. Register with the router ----- */

    registerScreen("kiln", {
        onEnter: function () {
            if (!KILN.inited) {
                initKiln();
                KILN.inited = true;
            } else {
                sizeKilnCanvas();
            }
            KILN.sparks.length = 0;
            hideCelebrate();
            kilnEnter("intro");
            startKilnLoop();
            wheelHumStart();
        },
        onLeave: function () {
            stopKilnLoop();
            hideCelebrate();
            /* Drop the egg's overheat shake class so leaving the
               kiln doesn't leave glitch CSS attached to <body>. */
            document.body.classList.remove("kiln-overheat");
        }
    });

    /* ============================================================
       GALLERY SCREEN — chunk 6: thumbnail grid + PNG export
       ============================================================
       Source of truth is localStorage key "crayte-gallery" — same
       key the kiln writes to on every successful firing. Each
       thumbnail re-renders the saved pot at small size using the
       same drawPot / drawRim / fired-overlay chain as the live
       canvas; the clay snapshot is swapped into SHAPE.clay for
       the duration of each render (synchronous within a .then()
       callback, so no race even with parallel thumbnail loads).
       ============================================================ */

    const GALLERY = {
        items: [],          /* current visible list (mine OR public) */
        detailEntry: null,
        inited: false,
        tab: "mine",        /* "mine" | "public" */
        publicCache: null,  /* last fetched public list, cached for tab toggles */
        publicLoading: false,
        publicLastFetch: 0  /* timestamp — refetch if older than 60s */
    };

    const GALLERY_KEY  = "crayte-gallery";
    const LOT_OF_POTS  = 50;

    function loadGalleryEntries() {
        try {
            const raw = localStorage.getItem(GALLERY_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function saveGalleryEntries(arr) {
        try {
            /* Strip the cached _paintImg before serializing — Image
               objects don't survive JSON. */
            const clean = arr.map(function (e) {
                const o = {};
                for (const k in e) {
                    if (k === "_paintImg") continue;
                    o[k] = e[k];
                }
                return o;
            });
            localStorage.setItem(GALLERY_KEY, JSON.stringify(clean));
            return true;
        } catch (e) {
            console.warn("[CRAYte] gallery save failed", e);
            return false;
        }
    }

    function loadEntryPaint(entry) {
        if (entry._paintImg) return Promise.resolve(entry._paintImg);
        if (!entry.paintDataUrl) return Promise.resolve(null);
        return new Promise(function (resolve) {
            const img = new Image();
            img.onload  = function () { entry._paintImg = img; resolve(img); };
            img.onerror = function () { resolve(null); };
            img.src = entry.paintDataUrl;
        });
    }

    function formatPotDate(ts) {
        const d = new Date(ts);
        const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" +
               pad(d.getDate()) + " " + pad(d.getHours()) + ":" +
               pad(d.getMinutes());
    }

    /* Pack-id -> friendly label for the detail tag. Falls back to
       the id itself for any future-added pack. */
    function packLabel(packId) {
        for (let i = 0; i < GLAZE_PACKS.length; i++) {
            if (GLAZE_PACKS[i].id === packId) return GLAZE_PACKS[i].label;
        }
        return (packId || "BASIC").toUpperCase();
    }

    /* ----- 8A. Render a saved entry into any 2D context -----
       Logical coords are 400×600. Caller is responsible for the
       ctx transform so the logical space maps to the destination
       canvas size. clay-swap is purely synchronous within this
       call, so no race with parallel renders.                   */
    function renderSavedPot(ctx, entry, opts) {
        opts = opts || {};
        const savedClay = SHAPE.clay;
        const savedClayTypeId = SHAPE.clayTypeId;
        SHAPE.clay = entry.clay || SHAPE.clay;
        if (entry.clayTypeId) SHAPE.clayTypeId = entry.clayTypeId;
        try {
            if (opts.background !== false) {
                ctx.fillStyle = "#0c1f25";
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                drawShapeBackdrop(ctx);
            }
            if (opts.wheel !== false) drawWheel(ctx);
            drawPot(ctx);
            if (entry._paintImg) {
                ctx.save();
                buildPotPath(ctx);
                ctx.clip();
                ctx.drawImage(entry._paintImg, 0, 0, SHAPE.W, SHAPE.H);
                ctx.restore();
            }
            if (entry.fired) {
                ctx.save();
                buildPotPath(ctx);
                ctx.clip();
                ctx.globalCompositeOperation = "overlay";
                ctx.fillStyle = "rgba(180, 70, 22, 0.20)";
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                ctx.globalCompositeOperation = "source-over";
                const g = ctx.createLinearGradient(0, 80, 0, 510);
                g.addColorStop(0,    "rgba(255, 245, 220, 0.10)");
                g.addColorStop(0.35, "rgba(255, 245, 220, 0.00)");
                g.addColorStop(1,    "rgba(0, 0, 0, 0.12)");
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                ctx.restore();
            }
            /* Overfired-tag entries get the burnt char overlay too —
               same renderer as the kiln so gallery matches reveal. */
            if (entry.overfired) {
                const seed = entry.overfiredSeed || strHash(entry.id);
                drawOverfiredOverlay(ctx, seed);
            }
            drawRim(ctx);
            /* Exploded memorial — overlay a "shattered" treatment
               on top of the rendered pot. Deterministic seed from
               the entry id so the cracks are stable.              */
            if (entry.exploded) {
                drawExplodedMemorial(ctx, strHash(entry.id));
            }
        } finally {
            SHAPE.clay = savedClay;
            SHAPE.clayTypeId = savedClayTypeId;
        }
    }

    function renderEntryIntoCanvas(canvas, entry) {
        const cssW = canvas.clientWidth  || canvas.width;
        const cssH = canvas.clientHeight || canvas.height;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(cssW * dpr));
        const bh = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== bw)  canvas.width  = bw;
        if (canvas.height !== bh) canvas.height = bh;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr * (cssW / SHAPE.W), 0, 0,
                         dpr * (cssH / SHAPE.H), 0, 0);
        renderSavedPot(ctx, entry);
    }

    /* ----- 8B. Grid building ----- */

    /* Pot-age decay class. Layered on top of .pot-thumb so the
       gallery visually telegraphs how long a pot has been in the
       collection. Reinforces the ceramic theme + makes the
       gallery feel layered over time.
         < 7 days   -> "" (fresh, no overlay)
         7-29 days  -> "is-vintage" (sepia + faint crack)
         >= 30 days -> "is-cracked" (heavier crack + chip)
       Public-tab pots use createdAt from the server row, which
       is the original public submission time -- so an old pot
       in someone else's profile reads as old to everyone. */
    function potAgeClass(createdAt) {
        if (!createdAt) return "";
        const days = (Date.now() - createdAt) / 86400000;
        if (days >= 30) return "is-cracked";
        if (days >= 7)  return "is-vintage";
        return "";
    }

    function buildThumbCard(entry) {
        /* Card is a div (not <button>) so author byline can be a
           real <button> nested inside without invalid HTML. The
           div gets role=button + keyboard handlers for a11y. */
        const card = document.createElement("div");
        card.className = "pot-card";
        card.dataset.id = entry.id;
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");

        const thumb = document.createElement("div");
        thumb.className = "pot-thumb " + potAgeClass(entry.createdAt);
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 300;
        thumb.appendChild(canvas);

        /* Shared indicator -- on the user's own pot that they've
           also pushed to the EVERYONE gallery. Reads as "this is
           ALSO out there," not "this is gone." Hidden on public-tab
           rows (which are themselves the "out there" copy) so we
           don't double-flag.                                    */
        if (entry.publicId && !entry._isPublic) {
            const flag = document.createElement("span");
            flag.className = "pot-shared-flag";
            flag.setAttribute("aria-label", "Shared to Everyone gallery");
            flag.title = "Shared to Everyone gallery";
            flag.textContent = "\u{1F310}";   /* globe */
            thumb.appendChild(flag);
        }

        /* Trophy emblem -- when this local pot's battle entry has
           won a trophy. Sits in the top-left corner so it doesn't
           collide with the shared-globe. */
        if (!entry._isPublic) {
            const trophy = bestTrophyForLocalEntry(entry);
            if (trophy) {
                const tEl = document.createElement("span");
                tEl.className = "pot-trophy-flag tier-" + trophy.tier;
                tEl.setAttribute("aria-label",
                    trophyNameForTier(trophy.tier));
                tEl.title = trophyNameForTier(trophy.tier);
                tEl.textContent = "\u{1F3C6}";   /* trophy */
                thumb.appendChild(tEl);
            }
        }

        card.appendChild(thumb);

        const meta = document.createElement("div");
        meta.className = "pot-meta";

        const name = document.createElement("span");
        name.className = "pot-name";
        name.textContent = entry.name || "UNNAMED POT";
        meta.appendChild(name);

        const date = document.createElement("span");
        date.className = "pot-date";
        date.textContent = formatPotDate(entry.createdAt);
        meta.appendChild(date);

        const tag = document.createElement("span");
        tag.className = "pot-pack-tag";
        tag.textContent = packLabel(entry.packId);
        meta.appendChild(tag);

        /* Public entries get an author byline. If the row is
           linked to a real account (entry._profile.username
           exists), render as a clickable button that opens the
           profile. Otherwise plain span — anonymous bylines
           aren't linkable. */
        if (entry._isPublic && entry.author) {
            const linkable = entry._profile && entry._profile.username;
            const by = linkable
                ? document.createElement("button")
                : document.createElement("span");
            by.className = "pot-author";
            if (linkable) {
                by.type = "button";
                by.classList.add("pot-author-link");
                by.dataset.profile = entry._profile.username;
                by.textContent = "by @" + entry._profile.username;
                by.addEventListener("click", function (e) {
                    e.stopPropagation();
                    openProfile(entry._profile.username);
                });
            } else {
                by.textContent = "by " + entry.author;
            }
            meta.appendChild(by);
        }

        /* Remix credit chip -- this pot was remixed from someone
           else's. Shows on both local entries (after the kid
           remixed a public pot + fired) and public entries (the
           shared copy of a remix carries lineage from
           SUPABASE_REMIX.sql columns). */
        const remixSource = entry.remixedFromHandle || entry.remixedFromAuthor;
        if (remixSource) {
            const chip = document.createElement("span");
            chip.className = "pot-remix-chip";
            chip.textContent = "remix ← " + (
                entry.remixedFromHandle ? "@" + entry.remixedFromHandle
                                        : entry.remixedFromAuthor
            );
            chip.title = "Remixed from " + remixSource;
            if (entry.remixedFromHandle) {
                chip.style.cursor = "pointer";
                chip.addEventListener("click", function (e) {
                    e.stopPropagation();
                    openProfile(entry.remixedFromHandle);
                });
            }
            meta.appendChild(chip);
        }

        card.appendChild(meta);

        card.addEventListener("click", function () { openDetail(entry); });
        card.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openDetail(entry);
            }
        });

        /* Render async — paint may be a dataURL that needs loading. */
        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry);
        });

        return card;
    }

    /* Normalize a row coming back from Supabase into the same
       shape buildThumbCard / renderEntryIntoCanvas already
       understands (snake_case -> camelCase, plus the public-flag). */
    function normalizePublicRow(row) {
        return {
            id:           "public-" + row.id,
            createdAt:    row.created_at ? new Date(row.created_at).getTime() : Date.now(),
            clay:         Array.isArray(row.clay) ? row.clay : [],
            paintDataUrl: row.paint_data_url || null,
            packId:       row.pack_id || "core",
            clayTypeId:   row.clay_type_id || "earthenware",
            fired:        !!row.fired,
            overfired:    !!row.overfired,
            exploded:     !!row.exploded,
            name:         row.name || "",
            author:       row.author || "anonymous",
            userId:       row.user_id || null,
            _profile:     row._profile || null,   /* attached by enrichWithProfiles */
            _isPublic:    true,
            _publicId:    row.id,
            /* Remix lineage -- only present when the row has the
               columns + values. May be undefined on rows shared
               before SUPABASE_REMIX.sql ran. */
            remixedFrom:       row.remixed_from        || null,
            remixedFromAuthor: row.remixed_from_author || null
        };
    }

    function refreshGalleryGrid() {
        const grid    = document.getElementById("galleryGrid");
        const empty   = document.getElementById("galleryEmpty");
        const count   = document.getElementById("galleryCount");
        const banner  = document.getElementById("lotOfPotsBanner");
        if (!grid) return;

        /* Reflect active tab on the tab buttons */
        document.querySelectorAll(".gallery-tab[data-tab]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.tab === GALLERY.tab);
        });

        if (GALLERY.tab === "public") {
            renderPublicTab(grid, empty, count, banner);
        } else if (GALLERY.tab === "battles") {
            renderBattlesTab(grid, empty, count, banner);
        } else {
            renderMineTab(grid, empty, count, banner);
        }
    }

    /* ----- 8F. BATTLES (Day 5 chunk F) ----- */

    const BATTLE = {
        currentBattleId: null,
        cachedList: null,
        cachedAt:   0,
        cachedEntries: null,
        cachedVotes: null,
        myVotes: null,     /* Set of entry_ids voted this session */
        /* Trophy resolution / reveal */
        revealQueue: [],   /* trophies pending celebratory modal on this load */
        revealing:   false /* mutex so we don't overlap reveal modals */
    };

    /* ============================================================
       TROPHIES (chunk T)
       ============================================================
       Three tiers, picked by the user. Capitalization is the
       spec; don't lowercase PINGAS.                             */
    const TROPHY_TIERS = {
        first:     "Holy Heck, A Pot",
        second:    "The Silver PINGAS",
        honorable: "Technically a Pot"
    };

    function trophyNameForTier(tier) { return TROPHY_TIERS[tier] || ""; }

    /* Compute placements from raw entries + votes. Pure function;
       used both during the resolution write and locally when the
       backend hasn't been updated yet but we want a preview.

       Rules (matches the user's spec verbatim):
        - 1st = top distinct vote tier; ties co-place
        - 2nd = next distinct vote tier; ties co-place
        - HM  = distinct tier(s) at positions 3+; reach depends
                on total submissions:
                    < 3 subs        -> no HM
                    3 or 4 subs     -> tier[2] only
                    5+ subs         -> tier[2..4] (up to "position 5")
        - 0-vote pots can still place (a 1-submission battle
          still crowns a 1st-place winner).
       Returns { first:[entryId,...], second:[...], honorable:[...] }. */
    function computePlacements(entries, votes) {
        const result = { first: [], second: [], honorable: [] };
        if (!Array.isArray(entries) || entries.length === 0) return result;

        const tally = {};
        (votes || []).forEach(function (v) {
            tally[v.entry_id] = (tally[v.entry_id] || 0) + 1;
        });

        /* Bucket entries by vote count. */
        const byCount = new Map();
        entries.forEach(function (e) {
            const c = tally[e.id] || 0;
            if (!byCount.has(c)) byCount.set(c, []);
            byCount.get(c).push(e.id);
        });
        const counts = Array.from(byCount.keys()).sort(function (a, b) { return b - a; });

        if (counts.length === 0) return result;
        result.first = byCount.get(counts[0]).slice();
        if (counts.length >= 2) {
            result.second = byCount.get(counts[1]).slice();
        }

        const total = entries.length;
        if (total >= 5) {
            for (let i = 2; i < Math.min(counts.length, 5); i++) {
                result.honorable = result.honorable.concat(byCount.get(counts[i]));
            }
        } else if (total >= 3 && counts.length >= 3) {
            result.honorable = byCount.get(counts[2]).slice();
        }
        return result;
    }

    /* Returns the tier name a given entry_id belongs to in the
       passed placements object, or null if it didn't place.    */
    function entryTier(placements, entryId) {
        if (!placements) return null;
        if (Array.isArray(placements.first)     && placements.first.indexOf(entryId)     >= 0) return "first";
        if (Array.isArray(placements.second)    && placements.second.indexOf(entryId)    >= 0) return "second";
        if (Array.isArray(placements.honorable) && placements.honorable.indexOf(entryId) >= 0) return "honorable";
        return null;
    }

    /* If this battle is expired + unresolved AND we have entries
       + votes loaded, race to write the placements via an atomic
       PostgREST UPDATE filtered by resolved_at IS NULL. The first
       client to land the write wins; later clients see the row
       already-resolved on next fetch.

       Returns Promise<placements-object | null> -- the placements
       are returned (computed locally) so callers can render
       immediately without a re-fetch. */
    function resolveBattleIfNeeded(battle, entries, votes) {
        if (!battle || battle.placements) {
            return Promise.resolve(battle ? battle.placements : null);
        }
        const expired = new Date(battle.expires_at).getTime() <= Date.now();
        if (!expired) return Promise.resolve(null);
        if (!supabaseEnabled()) return Promise.resolve(null);

        const placements = computePlacements(entries, votes);
        if (placements.first.length === 0) {
            /* Empty battle (no submissions) -- mark resolved so we
               don't keep retrying every load, but no trophies. */
        }
        const url = SUPABASE_URL +
            "/rest/v1/battles?id=eq." + encodeURIComponent(battle.id) +
            "&resolved_at=is.null";
        return fetch(url, {
            method: "PATCH",
            headers: supabaseHeaders({
                "Content-Type": "application/json",
                "Prefer":       "return=representation"
            }),
            body: JSON.stringify({
                placements:  placements,
                resolved_at: new Date().toISOString()
            })
        }).then(function (r) {
            if (!r.ok) return null;
            return r.json().then(function (rows) {
                if (Array.isArray(rows) && rows[0]) {
                    /* Persist back onto the cached battle row so
                       subsequent renders skip the write. */
                    battle.placements  = rows[0].placements;
                    battle.resolved_at = rows[0].resolved_at;
                    return rows[0].placements;
                }
                /* Empty array => someone else already resolved;
                   keep going (the next fetch will pick it up). */
                return null;
            });
        }).catch(function () { return null; });
    }

    /* Track which battle_entry_ids the user has submitted from
       this device so anonymous users still get trophy reveals +
       gallery badges. Set per local entry too (entry.battleEntries
       array) so we can map local pot -> award without a join. */
    function rememberMyBattleEntry(localEntry, battleId, entryRow) {
        if (!localEntry || !entryRow) return;
        const ref = { battleId: battleId, battleEntryId: entryRow.id };
        localEntry.battleEntries = (localEntry.battleEntries || []).concat([ref]);
        const arr = loadGalleryEntries();
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].id === localEntry.id) {
                arr[i].battleEntries = (arr[i].battleEntries || []).concat([ref]);
                break;
            }
        }
        saveGalleryEntries(arr);

        /* Also write a global list keyed by battle_entry_id so
           reveal-on-load doesn't need to scan every local pot. */
        try {
            const key = "crayte-my-battle-entries";
            const raw = JSON.parse(localStorage.getItem(key) || "[]");
            raw.push(ref);
            /* Cap at 500 entries so this localStorage key never
               balloons; trophies on older entries beyond 500 just
               won't auto-reveal. The user can still see them on
               the battle results page. */
            while (raw.length > 500) raw.shift();
            localStorage.setItem(key, JSON.stringify(raw));
        } catch (_) {}
    }

    function loadMyBattleEntries() {
        try {
            const raw = JSON.parse(
                localStorage.getItem("crayte-my-battle-entries") || "[]");
            return Array.isArray(raw) ? raw : [];
        } catch (_) { return []; }
    }

    /* Cache of {battleEntryId -> {tier, battle}} for trophies the
       user has earned. Populated by checkTrophyReveals() so we
       can light up gallery thumbnails + pot-detail badges without
       a per-render network round-trip. Persisted to localStorage
       so the badge survives reloads while offline.              */
    const TROPHY_CACHE = { map: null };

    function trophyCacheLoad() {
        if (TROPHY_CACHE.map) return TROPHY_CACHE.map;
        try {
            const raw = JSON.parse(
                localStorage.getItem("crayte-trophy-cache") || "{}");
            TROPHY_CACHE.map = (raw && typeof raw === "object") ? raw : {};
        } catch (_) { TROPHY_CACHE.map = {}; }
        return TROPHY_CACHE.map;
    }

    function trophyCacheWrite(battleEntryId, tier, battle) {
        const map = trophyCacheLoad();
        map[battleEntryId] = {
            tier:      tier,
            battleId:  battle.id,
            theme:     battle.theme || "",
            wonAt:     battle.resolved_at || new Date().toISOString()
        };
        try {
            localStorage.setItem("crayte-trophy-cache", JSON.stringify(map));
        } catch (_) {}
    }

    /* Look up the best trophy this local entry has earned (across
       any of its battle submissions). Returns {tier, battleId,
       theme} or null. "Best" = first > second > honorable.       */
    const TIER_RANK = { first: 0, second: 1, honorable: 2 };
    function bestTrophyForLocalEntry(entry) {
        if (!entry || !Array.isArray(entry.battleEntries)) return null;
        const cache = trophyCacheLoad();
        let best = null;
        entry.battleEntries.forEach(function (ref) {
            const rec = cache[ref.battleEntryId];
            if (!rec) return;
            if (!best || TIER_RANK[rec.tier] < TIER_RANK[best.tier]) best = rec;
        });
        return best;
    }

    function loadRevealedTrophies() {
        try {
            const raw = JSON.parse(
                localStorage.getItem("crayte-trophies-revealed") || "[]");
            return new Set(Array.isArray(raw) ? raw : []);
        } catch (_) { return new Set(); }
    }

    function markTrophyRevealed(battleEntryId) {
        const s = loadRevealedTrophies();
        s.add(battleEntryId);
        try {
            localStorage.setItem("crayte-trophies-revealed",
                JSON.stringify(Array.from(s)));
        } catch (_) {}
    }

    /* Walk this device's battle entries + look up each parent
       battle. For any resolved battle where my entry placed in
       a tier I haven't yet seen, queue a reveal. Awaits the
       fetch chain then drains the queue serially. */
    function checkTrophyReveals() {
        if (!supabaseEnabled()) return Promise.resolve();
        const mine = loadMyBattleEntries();
        if (mine.length === 0) return Promise.resolve();

        const seen = loadRevealedTrophies();
        const unrevealed = mine.filter(function (m) {
            return !seen.has(m.battleEntryId);
        });
        if (unrevealed.length === 0) return Promise.resolve();

        /* Deduplicate battle_ids so we don't fetch the same battle
           twice (a single battle has at most 3 of our entries). */
        const battleIds = Array.from(new Set(unrevealed.map(function (m) { return m.battleId; })));
        const inClause = "(" + battleIds.join(",") + ")";
        const url = SUPABASE_URL +
            "/rest/v1/battles?select=*&id=in." +
            encodeURIComponent(inClause);
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (battles) {
                battles.forEach(function (battle) {
                    if (!battle.placements) return;
                    /* For each of my entries in this battle, check
                       if it placed. */
                    unrevealed.forEach(function (m) {
                        if (m.battleId !== battle.id) return;
                        const tier = entryTier(battle.placements, m.battleEntryId);
                        if (!tier) {
                            /* Didn't place; still mark seen so we
                               don't recheck every load. */
                            markTrophyRevealed(m.battleEntryId);
                            return;
                        }
                        /* Cache the trophy so gallery thumbnails +
                           pot-detail badges have offline data. */
                        trophyCacheWrite(m.battleEntryId, tier, battle);
                        BATTLE.revealQueue.push({
                            battle:         battle,
                            battleEntryId:  m.battleEntryId,
                            tier:           tier
                        });
                    });
                });
                drainTrophyRevealQueue();
            })
            .catch(function () { /* best-effort */ });
    }

    function drainTrophyRevealQueue() {
        if (BATTLE.revealing) return;
        const next = BATTLE.revealQueue.shift();
        if (!next) return;
        BATTLE.revealing = true;
        showTrophyReveal(next.battle, next.battleEntryId, next.tier, function () {
            markTrophyRevealed(next.battleEntryId);
            BATTLE.revealing = false;
            /* Brief gap before chaining the next one so phones
               can settle. */
            setTimeout(drainTrophyRevealQueue, 300);
        });
    }

    function showTrophyReveal(battle, battleEntryId, tier, onDone) {
        const modal     = document.getElementById("trophyRevealModal");
        const nameEl    = document.getElementById("trophyRevealName");
        const themeEl   = document.getElementById("trophyRevealTheme");
        const canvas    = document.getElementById("trophyRevealCanvas");
        const okBtn     = document.getElementById("trophyRevealOk");
        const viewBtn   = document.getElementById("trophyRevealView");
        const ribbonEl  = document.getElementById("trophyRevealRibbon");
        if (!modal || !nameEl || !okBtn || !viewBtn) { onDone && onDone(); return; }

        nameEl.textContent  = trophyNameForTier(tier);
        if (themeEl)  themeEl.textContent  = battle.theme || "BATTLE";
        if (ribbonEl) ribbonEl.dataset.tier = tier;
        modal.dataset.tier = tier;

        /* Pull the entry row so we can render the winning pot. */
        fetchBattleEntryById(battleEntryId).then(function (entryRow) {
            if (!entryRow || !canvas) return;
            const entry = normalizePublicRow(entryRow);
            loadEntryPaint(entry).then(function () {
                renderEntryIntoCanvas(canvas, entry);
            });
        });

        modal.hidden = false;
        playTrophyFanfare(tier);

        const cleanup = function () {
            modal.hidden = true;
            okBtn.removeEventListener("click", onOk);
            viewBtn.removeEventListener("click", onView);
            onDone && onDone();
        };
        const onOk = function () { cleanup(); };
        const onView = function () {
            cleanup();
            /* Jump to gallery -> battles -> open this battle. */
            GALLERY.tab = "battles";
            showScreen("gallery");
            setTimeout(function () { openBattleDetail(battle); }, 250);
        };
        okBtn.addEventListener("click", onOk);
        viewBtn.addEventListener("click", onView);
    }

    /* The reveal-modal close handlers are wired once at boot
       rather than per-reveal so the same listeners survive
       across the .revealQueue draining. */
    function wireTrophyRevealModal() {
        const modal = document.getElementById("trophyRevealModal");
        if (!modal) return;
        modal.addEventListener("click", function (e) {
            /* Click outside the card -> treat as OK (mark seen +
               continue draining). */
            if (e.target === modal) {
                const ok = document.getElementById("trophyRevealOk");
                if (ok) ok.click();
            }
        });
    }

    /* Tap on the pot-detail trophy badge -> jump to that battle. */
    function wireDetailTrophyBadge() {
        const badge = document.getElementById("detailTrophyBadge");
        if (!badge) return;
        badge.addEventListener("click", function () {
            const battleId = badge.dataset.battle;
            if (!battleId) return;
            /* Close pot-detail, swap to BATTLES tab, open the
               battle. We don't have the full battle row in the
               cache here -- fetch it. */
            closeDetail();
            const url = SUPABASE_URL + "/rest/v1/battles?select=*&id=eq." +
                encodeURIComponent(battleId) + "&limit=1";
            fetch(url, { headers: supabaseHeaders() })
                .then(function (r) { return r.ok ? r.json() : []; })
                .then(function (rows) {
                    if (rows && rows[0]) {
                        GALLERY.tab = "battles";
                        showScreen("gallery");
                        setTimeout(function () {
                            openBattleDetail(rows[0]);
                        }, 250);
                    }
                });
        });
    }

    function fetchBattleEntryById(id) {
        if (!supabaseEnabled() || !id) return Promise.resolve(null);
        const url = SUPABASE_URL +
            "/rest/v1/battle_entries?select=*&id=eq." +
            encodeURIComponent(id) + "&limit=1";
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (rows) { return rows && rows[0] ? rows[0] : null; })
            .catch(function () { return null; });
    }

    /* Brief synthesized fanfare. Notes scale with tier (1st gets
       the highest + brightest, HM gets a single short blip). */
    function playTrophyFanfare(tier) {
        const ctx = ensureAudio();
        if (!ctx) return;
        const t0 = ctx.currentTime;
        let notes;
        if (tier === "first") {
            /* C major bugle call -> high triumphant chord */
            notes = [
                [392.00, 0.00, 0.18],   /* G4 */
                [523.25, 0.18, 0.18],   /* C5 */
                [659.25, 0.36, 0.30],   /* E5 */
                [783.99, 0.66, 0.45]    /* G5 hold */
            ];
        } else if (tier === "second") {
            notes = [
                [392.00, 0.00, 0.18],   /* G4 */
                [523.25, 0.18, 0.22],   /* C5 */
                [587.33, 0.40, 0.35]    /* D5 */
            ];
        } else {
            notes = [
                [392.00, 0.00, 0.18],   /* G4 */
                [466.16, 0.18, 0.32]    /* A#4 */
            ];
        }
        notes.forEach(function (n) {
            const freq = n[0], offset = n[1], dur = n[2];
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.value = freq;
            g.gain.setValueAtTime(0, t0 + offset);
            g.gain.linearRampToValueAtTime(0.18, t0 + offset + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + offset + dur);
            osc.connect(g).connect(ctx.destination);
            osc.start(t0 + offset);
            osc.stop(t0 + offset + dur + 0.02);
        });
    }


    function loadMyVotes() {
        if (BATTLE.myVotes) return BATTLE.myVotes;
        try {
            const raw = localStorage.getItem("crayte-battle-votes");
            BATTLE.myVotes = new Set(raw ? JSON.parse(raw) : []);
        } catch (_) { BATTLE.myVotes = new Set(); }
        return BATTLE.myVotes;
    }

    function rememberMyVote(entryId) {
        loadMyVotes().add(entryId);
        try {
            localStorage.setItem("crayte-battle-votes",
                JSON.stringify(Array.from(BATTLE.myVotes)));
        } catch (_) {}
    }

    /* One vote per user per calendar day. Same client-trust level
       as the existing per-browser vote token (no backend change).
       Local date so "tomorrow" matches the kid's wall clock. */
    function voteDayKey() {
        const d = new Date();
        return d.getFullYear() + "-" + (d.getMonth() + 1) +
               "-" + d.getDate();
    }
    function hasVotedToday() {
        try {
            return localStorage.getItem("crayte-vote-day") ===
                   voteDayKey();
        } catch (_) { return false; }
    }
    function markVotedToday() {
        try { localStorage.setItem("crayte-vote-day", voteDayKey()); }
        catch (_) {}
    }

    function formatBattleTime(expiresAt) {
        const ms = new Date(expiresAt).getTime() - Date.now();
        if (ms <= 0) return { text: "FINISHED", live: false };
        const days  = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        const mins  = Math.floor((ms % 3600000) / 60000);
        if (days >= 1)  return { text: days + "d " + hours + "h LEFT", live: true };
        if (hours >= 1) return { text: hours + "h " + mins + "m LEFT", live: true };
        return { text: mins + "m LEFT", live: true };
    }

    function renderBattlesTab(grid, empty, count, banner) {
        if (banner) banner.hidden = true;
        if (empty)  empty.hidden  = true;
        grid.innerHTML = "";

        if (!supabaseEnabled()) {
            if (count) count.textContent = "BATTLES OFFLINE";
            const msg = document.createElement("p");
            msg.className = "gallery-msg";
            msg.textContent = "Battles aren't configured.";
            grid.appendChild(msg);
            return;
        }

        /* Replace the grid contents with a battle-list layout. The
           gallery-grid CSS doesn't apply to .battle-list — we just
           reuse the container.                                    */
        const cta = document.createElement("button");
        cta.type = "button";
        cta.className = "battle-new-cta";
        cta.textContent = "+ POST A NEW THEME";
        cta.addEventListener("click", openCreateBattleModal);
        grid.appendChild(cta);

        const list = document.createElement("div");
        list.className = "battle-list";
        grid.appendChild(list);

        if (count) count.textContent = "LOADING...";
        fetchBattles(50).then(function (rawRows) {
            if (currentScreen !== "gallery" || GALLERY.tab !== "battles") return;
            /* Transition cleanup: when the theme rotated daily, every
               day's bot battle was a fresh row. Under the new weekly
               cadence those old daily-bot rows are leftovers — their
               themes don't match this week's, and surfacing them
               makes the list look "still on the daily updates."
               Drop bot battles that aren't the current Thursday-
               week's; keep all user-created battles regardless. The
               filtered-out rows still exist in Supabase, so trophies
               / personal entries from them are recoverable through
               crayte-my-battle-entries — we just don't surface the
               stale rows in the gallery list anymore. */
            const rows = rawRows.filter(function (b) {
                if (!b) return false;
                if (b.created_by !== "daily-bot") return true;
                return isTodayDailyBattle(b);
            });
            BATTLE.cachedList = rows;
            BATTLE.cachedAt = Date.now();

            /* Weekly-battle housekeeping: if this week's bot battle
               doesn't exist yet, anyone visiting creates it (first-
               come, first-served). The created row is appended to
               the local cache so it renders immediately. */
            const existingDaily = rows.find(isTodayDailyBattle);
            const ensureDaily = existingDaily
                ? Promise.resolve(existingDaily)
                : createDailyBattle(todaysTheme()).then(function (created) {
                    if (created) {
                        /* Re-enrich (give it a _profile slot — empty,
                           since it has no user_id). */
                        rows.unshift(created);
                        BATTLE.cachedList = rows;
                    }
                    return created || null;
                });

            ensureDaily.then(function (daily) {
                renderBattleList(rows, list, count);
                if (BATTLE.openDailyOnLoad && daily) {
                    BATTLE.openDailyOnLoad = false;
                    openBattleDetail(daily);
                }
            });
        });
    }

    function renderBattleList(rows, list, count) {
        if (count) {
            const live = rows.filter(function (b) {
                return new Date(b.expires_at).getTime() > Date.now();
            }).length;
            count.textContent = rows.length + " BATTLES" +
                (live ? " · " + live + " LIVE" : "");
        }
        if (rows.length === 0) {
            const msg = document.createElement("p");
            msg.className = "gallery-msg";
            msg.textContent = "No battles yet. Post one!";
            list.appendChild(msg);
            return;
        }
        /* Daily-bot battles bubble to the top of the list. */
        const sorted = rows.slice().sort(function (a, b) {
            const aDaily = a.created_by === "daily-bot" ? 1 : 0;
            const bDaily = b.created_by === "daily-bot" ? 1 : 0;
            if (aDaily !== bDaily) return bDaily - aDaily;
            return 0;
        });
        sorted.forEach(function (b) {
            list.appendChild(buildBattleCard(b));
        });
    }

    function buildBattleCard(b) {
        /* Wrapper is a div so we can put a real <button> author
           byline inside without nesting buttons. */
        const card = document.createElement("div");
        card.className = "battle-card";
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        const time = formatBattleTime(b.expires_at);
        if (!time.live) card.classList.add("is-expired");
        if (b.created_by === "daily-bot") card.classList.add("is-daily");

        const theme = document.createElement("div");
        theme.className = "battle-theme";
        if (b.created_by === "daily-bot") {
            const badge = document.createElement("span");
            badge.className = "battle-daily-badge";
            badge.textContent = "★ THIS WEEK";
            theme.appendChild(badge);
            theme.appendChild(document.createTextNode(" " + b.theme));
        } else {
            theme.textContent = b.theme;
        }
        card.appendChild(theme);

        const meta = document.createElement("div");
        meta.className = "battle-meta-line";
        const status = document.createElement("span");
        status.className = time.live ? "live" : "ended";
        status.textContent = (time.live ? "★ " : "✓ ") + time.text;
        meta.appendChild(status);

        /* Creator byline — clickable if there's a real account. */
        const profile = b._profile;
        const linkable = profile && profile.username;
        const author = linkable
            ? document.createElement("button")
            : document.createElement("span");
        if (linkable) {
            author.type = "button";
            author.className = "pot-author-link";
            author.dataset.profile = profile.username;
            author.textContent = "by @" + profile.username;
            author.addEventListener("click", function (e) {
                e.stopPropagation();
                openProfile(profile.username);
            });
        } else {
            author.textContent = "by " + (b.created_by || "anonymous");
        }
        meta.appendChild(author);
        card.appendChild(meta);

        card.addEventListener("click", function () { openBattleDetail(b); });
        card.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openBattleDetail(b);
            }
        });
        return card;
    }

    /* Create-battle modal */
    function openCreateBattleModal() {
        const panel = document.getElementById("createBattleModal");
        const input = document.getElementById("createBattleTheme");
        if (!panel || !input) return;
        input.value = "";
        panel.hidden = false;
        setTimeout(function () { input.focus(); }, 50);
    }

    function closeCreateBattleModal() {
        const panel = document.getElementById("createBattleModal");
        if (panel) panel.hidden = true;
    }

    function submitNewBattle() {
        const input = document.getElementById("createBattleTheme");
        if (!input) return;
        const theme = input.value.trim();
        if (!theme) return;
        const author = (window.prompt(
            "Sign as (optional):",
            getRememberedAuthor()
        ) || "").trim() || "anonymous";
        rememberAuthor(author === "anonymous" ? "" : author);
        const btn = document.getElementById("createBattleSubmit");
        if (btn) btn.disabled = true;
        createBattle(theme, author).then(function (row) {
            if (btn) btn.disabled = false;
            if (!row) {
                alert("Couldn't post the battle. Try again.");
                return;
            }
            closeCreateBattleModal();
            /* Refresh battles tab + jump straight into the new
               battle so the user can submit a pot to it. */
            if (GALLERY.tab === "battles") refreshGalleryGrid();
            openBattleDetail(row);
        });
    }

    /* Battle detail modal */
    function openBattleDetail(battle) {
        BATTLE.currentBattleId = battle.id;
        const panel = document.getElementById("battleDetail");
        const themeEl = document.getElementById("battleTheme");
        const time = document.getElementById("battleTimeLeft");
        const author = document.getElementById("battleAuthor");
        const grid = document.getElementById("battleGrid");
        if (!panel) return;

        if (themeEl) themeEl.textContent = battle.theme;
        if (author) author.textContent = "by " + (battle.created_by || "anonymous");
        const t = formatBattleTime(battle.expires_at);
        if (time) time.textContent = t.text;

        if (grid) grid.innerHTML =
            "<p class='gallery-msg'>Loading entries...</p>";

        panel.hidden = false;
        loadAndRenderBattleEntries(battle);
    }

    function loadAndRenderBattleEntries(battle) {
        const grid  = document.getElementById("battleGrid");
        const count = document.getElementById("battleEntryCount");
        const submit = document.getElementById("battleSubmit");
        const expired = new Date(battle.expires_at).getTime() <= Date.now();

        if (submit) {
            submit.disabled = expired;
            const lbl = submit.querySelector(".btn-label");
            if (lbl) lbl.textContent = expired ? "BATTLE FINISHED" : "SUBMIT A POT";
        }

        Promise.all([
            fetchBattleEntries(battle.id),
            Promise.resolve(null)
        ]).then(function (results) {
            const entries = results[0];
            BATTLE.cachedEntries = entries;
            if (count) count.textContent = entries.length +
                (entries.length === 1 ? " ENTRY" : " ENTRIES");
            if (entries.length === 0) {
                if (grid) grid.innerHTML =
                    "<p class='gallery-msg'>No entries yet. Be first.</p>";
                return;
            }
            const ids = entries.map(function (e) { return e.id; });
            return fetchBattleVotes(ids).then(function (votes) {
                BATTLE.cachedVotes = votes;
                /* If the battle is expired but not yet resolved on
                   the server, race to write the placements. Either
                   way we end up with a placements object to render
                   from -- battle.placements after a successful
                   resolve, or a local computation if we lost the
                   race (next reload will pick up the server's). */
                return resolveBattleIfNeeded(battle, entries, votes)
                    .then(function (resolved) {
                        const placements = resolved
                            || battle.placements
                            || (expired ? computePlacements(entries, votes) : null);
                        renderBattleEntries(entries, votes, expired, grid, placements);
                    });
            });
        });
    }

    function renderBattleEntries(entries, votes, expired, grid, placements) {
        if (!grid) return;
        grid.innerHTML = "";

        /* Group votes by entry */
        const tally = {};
        votes.forEach(function (v) {
            tally[v.entry_id] = (tally[v.entry_id] || 0) + 1;
        });

        const myVotes = loadMyVotes();

        /* When the battle has resolved (placements exist), render
           in trophy-tier order with section headers. Otherwise
           render in original chronological order (the live
           voting view).                                          */
        const showTrophies = expired && placements &&
            (placements.first.length > 0);

        const byId = {};
        entries.forEach(function (e) { byId[e.id] = e; });

        /* Helper -- build one entry card. Same shape as before,
           plus tier-aware decoration. */
        const buildEntryCard = function (raw, tier) {
            /* Normalize to the same shape buildThumbCard uses */
            const entry = normalizePublicRow(raw);
            entry.id = "battle-" + raw.id;  /* avoid clash */
            entry._publicId = raw.id;

            const card = document.createElement("div");
            card.className = "battle-entry-card";
            if (tier) {
                card.classList.add("is-trophy");
                card.classList.add("is-trophy-" + tier);
            }
            if (tier) {
                const tag = document.createElement("span");
                tag.className = "battle-winner-tag tier-" + tier;
                tag.textContent = trophyNameForTier(tier);
                card.appendChild(tag);
            }

            const thumb = document.createElement("div");
            thumb.className = "battle-entry-thumb";
            const canvas = document.createElement("canvas");
            canvas.width = 200;
            canvas.height = 300;
            thumb.appendChild(canvas);
            card.appendChild(thumb);

            /* Author byline — clickable if the entry has a real
               account behind it (row.user_id + _profile.username). */
            const profile = raw._profile;
            const linkable = profile && profile.username;
            const author = linkable
                ? document.createElement("button")
                : document.createElement("span");
            author.className = "battle-entry-author";
            if (linkable) {
                author.type = "button";
                author.classList.add("pot-author-link");
                author.dataset.profile = profile.username;
                author.textContent = "@" + profile.username;
                author.addEventListener("click", function (e) {
                    e.stopPropagation();
                    openProfile(profile.username);
                });
            } else {
                author.textContent = entry.author || raw.author || "anonymous";
            }
            card.appendChild(author);

            const voteRow = document.createElement("div");
            voteRow.className = "battle-vote-row";

            const count = document.createElement("span");
            count.className = "battle-vote-count";
            count.textContent = (tally[raw.id] || 0);
            voteRow.appendChild(count);

            const voteBtn = document.createElement("button");
            voteBtn.type = "button";
            voteBtn.className = "battle-vote-btn";
            const alreadyVoted = myVotes.has(raw.id);
            /* One vote per day: once spent, every other pot's
               button shows the locked state so the kid sees why
               they can't keep tapping. */
            const lockedToday = hasVotedToday() && !alreadyVoted;
            if (alreadyVoted) voteBtn.classList.add("voted");
            if (lockedToday)  voteBtn.classList.add("day-locked");
            /* Heart glyph -- empty pre-vote, filled post-vote.
               Reads at a glance for a 5yo without needing literacy. */
            voteBtn.innerHTML = alreadyVoted
                ? "<span class='vote-heart' aria-hidden='true'>&#10084;</span>" +
                  "<span class='vote-label'>VOTED</span>"
                : lockedToday
                ? "<span class='vote-heart' aria-hidden='true'>&#9825;</span>" +
                  "<span class='vote-label'>1/DAY</span>"
                : "<span class='vote-heart' aria-hidden='true'>&#9825;</span>" +
                  "<span class='vote-label'>VOTE</span>";
            voteBtn.setAttribute("aria-label",
                alreadyVoted ? "You voted for this pot"
                : lockedToday ? "You've used today's vote — come back tomorrow"
                : "Vote for this pot");
            voteBtn.disabled = expired || alreadyVoted || lockedToday;
            voteBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                handleVoteClick(raw.id, voteBtn, count, card);
            });
            voteRow.appendChild(voteBtn);

            card.appendChild(voteRow);

            /* Whole-card tap also fires a vote (when not already
               voted + not expired). Kid-accessible -- they can
               just tap the pot they like. The vote button stays
               for adult muscle-memory + screen readers.        */
            if (!alreadyVoted && !expired && !lockedToday) {
                card.classList.add("is-votable");
                card.addEventListener("click", function (e) {
                    /* If the tap originated on the author link
                       (clickable byline) or the vote button itself,
                       let those handlers run instead. */
                    if (e.target.closest(".pot-author-link")) return;
                    if (e.target.closest(".battle-vote-btn")) return;
                    handleVoteClick(raw.id, voteBtn, count, card);
                });
            }

            loadEntryPaint(entry).then(function () {
                renderEntryIntoCanvas(canvas, entry);
            });
            return card;
        };

        if (showTrophies) {
            /* Tier-grouped rendering -- one section per tier, then
               any unranked entries (0-vote pots that didn't make
               HM, only relevant in battles with >5 submissions)
               in a final "OTHER ENTRIES" section. */
            const sections = [
                { tier: "first",     label: trophyNameForTier("first")     },
                { tier: "second",    label: trophyNameForTier("second"),
                    skipIfEmpty: true },
                { tier: "honorable", label: trophyNameForTier("honorable"),
                    skipIfEmpty: true }
            ];
            const placedIds = new Set();
            sections.forEach(function (s) {
                const ids = placements[s.tier] || [];
                if (ids.length === 0 && s.skipIfEmpty) return;
                const head = document.createElement("h4");
                head.className = "battle-tier-head tier-" + s.tier;
                head.textContent = s.label;
                grid.appendChild(head);
                ids.forEach(function (id) {
                    placedIds.add(id);
                    const raw = byId[id];
                    if (raw) grid.appendChild(buildEntryCard(raw, s.tier));
                });
            });
            const rest = entries.filter(function (e) { return !placedIds.has(e.id); });
            if (rest.length > 0) {
                const head = document.createElement("h4");
                head.className = "battle-tier-head tier-rest";
                head.textContent = "OTHER ENTRIES";
                grid.appendChild(head);
                rest.forEach(function (raw) {
                    grid.appendChild(buildEntryCard(raw, null));
                });
            }
        } else {
            /* Live (or pre-resolution) view: chronological. */
            entries.forEach(function (raw) {
                grid.appendChild(buildEntryCard(raw, null));
            });
        }
    }

    function handleVoteClick(entryId, btn, countEl, card) {
        if (btn.disabled) return;
        const heart = btn.querySelector(".vote-heart");
        const label = btn.querySelector(".vote-label");
        /* One vote per day. If it's spent, say so kindly (no
           modal — a 5yo just needs the button to explain itself)
           and bail without consuming anything. */
        if (hasVotedToday()) {
            const prev = label ? label.textContent : "";
            if (label) label.textContent = "TMRW!";
            btn.classList.add("day-locked");
            btn.setAttribute("aria-label",
                "You've used today's vote — come back tomorrow");
            setTimeout(function () {
                if (label && label.textContent === "TMRW!") {
                    label.textContent = prev || "1/DAY";
                }
            }, 1600);
            return;
        }
        btn.disabled = true;
        if (label) label.textContent = "...";
        voteForEntry(entryId).then(function (res) {
            if (res.ok || res.duplicate) {
                markVotedToday();
                rememberMyVote(entryId);
                btn.classList.add("voted");
                if (heart)  heart.innerHTML = "&#10084;";   /* filled heart */
                if (label)  label.textContent = "VOTED";
                btn.setAttribute("aria-label", "You voted for this pot");
                if (card) card.classList.remove("is-votable");
                if (res.ok && countEl) {
                    /* Increment + pop animation. */
                    countEl.textContent =
                        (parseInt(countEl.textContent, 10) + 1);
                    countEl.classList.remove("is-popped");
                    /* Force reflow so the class re-add restarts the anim. */
                    void countEl.offsetWidth;
                    countEl.classList.add("is-popped");
                    /* +1 confetti float on the card. */
                    if (card) spawnVoteFloat(card);
                }
                playVoteChime();
            } else {
                btn.disabled = false;
                if (heart) heart.innerHTML = "&#9825;";
                if (label) label.textContent = "RETRY";
            }
        });
    }

    /* Drift a small "+1 ♥" element up from the bottom of the
       battle entry card. Pure DOM + CSS animation; self-cleans. */
    function spawnVoteFloat(card) {
        if (!card) return;
        const f = document.createElement("span");
        f.className = "vote-float";
        f.innerHTML = "+1&nbsp;&#10084;";
        card.appendChild(f);
        setTimeout(function () {
            if (f.parentNode) f.parentNode.removeChild(f);
        }, 1100);
    }

    /* Soft synthesized chime on vote -- short major-third blip
       so it feels rewarding without being startling. */
    function playVoteChime() {
        const ctx = typeof ensureAudio === "function" ? ensureAudio() : null;
        if (!ctx) return;
        const t0 = ctx.currentTime;
        [659.25, 783.99].forEach(function (freq, i) {
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            const offset = i * 0.06;
            g.gain.setValueAtTime(0, t0 + offset);
            g.gain.linearRampToValueAtTime(0.10, t0 + offset + 0.015);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.22);
            osc.connect(g).connect(ctx.destination);
            osc.start(t0 + offset);
            osc.stop(t0 + offset + 0.25);
        });
    }

    function closeBattleDetail() {
        const panel = document.getElementById("battleDetail");
        if (panel) panel.hidden = true;
        BATTLE.currentBattleId = null;
    }

    /* Submit picker — pick one of your local pots to submit to
       the currently-open battle. */
    function openSubmitPicker() {
        if (!BATTLE.currentBattleId) return;
        const battle = BATTLE.cachedList
            ? BATTLE.cachedList.find(function (b) { return b.id === BATTLE.currentBattleId; })
            : null;
        if (!battle) return;
        const expired = new Date(battle.expires_at).getTime() <= Date.now();
        if (expired) {
            alert("This battle has ended.");
            return;
        }

        const panel = document.getElementById("submitPickerModal");
        const themeEl = document.getElementById("submitPickerTheme");
        const grid = document.getElementById("submitPickerGrid");
        if (!panel || !grid) return;
        if (themeEl) themeEl.textContent = battle.theme;
        grid.innerHTML = "";

        /* Hide tainted pots (custom-sticker UGC) from the picker
           entirely — they're private and the gate downstream would
           reject them anyway. Cleaner to not offer the choice. */
        const mine = loadGalleryEntries()
            .filter(function (e) { return !e.usedCustomSticker; })
            .slice()
            .reverse();
        if (mine.length === 0) {
            panel.hidden = false;
            return;
        }
        mine.forEach(function (entry) {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "pot-card";

            const thumb = document.createElement("div");
            thumb.className = "pot-thumb";
            const canvas = document.createElement("canvas");
            canvas.width = 200;
            canvas.height = 300;
            thumb.appendChild(canvas);
            card.appendChild(thumb);

            const meta = document.createElement("div");
            meta.className = "pot-meta";
            const name = document.createElement("span");
            name.className = "pot-name";
            name.textContent = entry.name || "UNNAMED POT";
            meta.appendChild(name);
            card.appendChild(meta);

            card.addEventListener("click", function () {
                submitChosenToBattle(entry, battle);
            });

            grid.appendChild(card);
            loadEntryPaint(entry).then(function () {
                renderEntryIntoCanvas(canvas, entry);
            });
        });

        panel.hidden = false;
    }

    function closeSubmitPicker() {
        const panel = document.getElementById("submitPickerModal");
        if (panel) panel.hidden = true;
    }

    function submitChosenToBattle(entry, battle) {
        /* Local-only UGC boundary: any pot that used an imported
           custom sticker is BLOCKED from public submission. The
           pot stays fully playable in the kid's own gallery; this
           gate only prevents arbitrary user images entering the
           shared battles surface. */
        if (entry && entry.usedCustomSticker) {
            alert(
                "Pots with imported stickers stay in your own gallery — " +
                "they can't be submitted to public battles.\n\n" +
                "Pick a different pot, or make one without custom stickers!"
            );
            closeSubmitPicker();
            return;
        }
        const author = (window.prompt(
            "Sign as (optional):",
            getRememberedAuthor()
        ) || "").trim() || "anonymous";
        rememberAuthor(author === "anonymous" ? "" : author);
        submitBattleEntry(battle.id, entry, author).then(function (row) {
            closeSubmitPicker();
            if (row) {
                /* Remember the link from this local pot to the
                   battle_entry it spawned -- powers trophy reveal
                   + gallery emblem when the battle resolves. */
                rememberMyBattleEntry(entry, battle.id, row);
                /* Refresh the open battle detail so the new entry
                   shows up. */
                loadAndRenderBattleEntries(battle);
            } else {
                alert("Couldn't submit. Try again.");
            }
        });
    }

    function wireBattleUI() {
        const closeB = document.getElementById("battleClose");
        if (closeB) closeB.addEventListener("click", closeBattleDetail);
        const panelB = document.getElementById("battleDetail");
        if (panelB) panelB.addEventListener("click", function (e) {
            if (e.target === panelB) closeBattleDetail();
        });

        const closeC = document.getElementById("createBattleClose");
        if (closeC) closeC.addEventListener("click", closeCreateBattleModal);
        const panelC = document.getElementById("createBattleModal");
        if (panelC) panelC.addEventListener("click", function (e) {
            if (e.target === panelC) closeCreateBattleModal();
        });

        const createSubmit = document.getElementById("createBattleSubmit");
        if (createSubmit) createSubmit.addEventListener("click", submitNewBattle);

        const battleSubmit = document.getElementById("battleSubmit");
        if (battleSubmit) battleSubmit.addEventListener("click", openSubmitPicker);

        const closeP = document.getElementById("submitPickerClose");
        if (closeP) closeP.addEventListener("click", closeSubmitPicker);
        const panelP = document.getElementById("submitPickerModal");
        if (panelP) panelP.addEventListener("click", function (e) {
            if (e.target === panelP) closeSubmitPicker();
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") {
                if (panelP && !panelP.hidden) closeSubmitPicker();
                else if (panelC && !panelC.hidden) closeCreateBattleModal();
                else if (panelB && !panelB.hidden) closeBattleDetail();
            }
        });
    }

    function renderMineTab(grid, empty, count, banner) {
        GALLERY.items = loadGalleryEntries();
        grid.innerHTML = "";

        if (GALLERY.items.length === 0) {
            if (empty)  empty.hidden = false;
            if (banner) banner.hidden = true;
            if (count)  count.textContent = "0 POTS";
            return;
        }
        if (empty) empty.hidden = true;

        if (count) {
            count.textContent = GALLERY.items.length +
                (GALLERY.items.length === 1 ? " POT" : " POTS");
        }
        if (banner) banner.hidden = GALLERY.items.length < LOT_OF_POTS;

        const arr = GALLERY.items.slice().reverse();
        for (let i = 0; i < arr.length; i++) {
            grid.appendChild(buildThumbCard(arr[i]));
        }
    }

    function renderPublicTab(grid, empty, count, banner) {
        if (banner) banner.hidden = true;
        if (empty)  empty.hidden  = true;
        grid.innerHTML = "";

        if (!supabaseEnabled()) {
            if (count) count.textContent = "PUBLIC OFFLINE";
            const msg = document.createElement("p");
            msg.className = "gallery-msg";
            msg.textContent = "Public gallery isn't configured.";
            grid.appendChild(msg);
            return;
        }

        const stale = (Date.now() - GALLERY.publicLastFetch) > 60000;
        if (GALLERY.publicCache && !stale) {
            paintPublicGrid(GALLERY.publicCache, grid, count);
            return;
        }

        if (count) count.textContent = "FETCHING...";
        if (GALLERY.publicLoading) return;
        GALLERY.publicLoading = true;
        fetchPublicPots(50).then(function (rows) {
            GALLERY.publicLoading = false;
            GALLERY.publicCache = rows.map(normalizePublicRow);
            GALLERY.publicLastFetch = Date.now();
            /* Only paint if user is still on the public tab */
            if (currentScreen === "gallery" && GALLERY.tab === "public") {
                paintPublicGrid(GALLERY.publicCache, grid, count);
            }
        });
    }

    function paintPublicGrid(items, grid, count) {
        grid.innerHTML = "";
        if (count) {
            count.textContent = items.length +
                (items.length === 1 ? " PUBLIC POT" : " PUBLIC POTS");
        }
        if (items.length === 0) {
            const msg = document.createElement("p");
            msg.className = "gallery-msg";
            msg.textContent = "No public pots yet. Submit one!";
            grid.appendChild(msg);
            return;
        }
        GALLERY.items = items;
        for (let i = 0; i < items.length; i++) {
            grid.appendChild(buildThumbCard(items[i]));
        }
    }

    /* ----- 8C. Detail modal ----- */

    function openDetail(entry) {
        GALLERY.detailEntry = entry;
        const panel  = document.getElementById("potDetail");
        const canvas = document.getElementById("detailCanvas");
        const name   = document.getElementById("detailName");
        const date   = document.getElementById("detailDate");
        const pack   = document.getElementById("detailPack");
        if (!panel || !canvas) return;

        if (name) {
            name.value = entry.name || "";
            /* Public entries are read-only; clear the input lock
               on mine entries so user can rename. */
            name.disabled = !!entry._isPublic;
        }
        if (date) {
            const author = entry._isPublic && entry.author
                ? " · by " + entry.author
                : "";
            date.textContent = formatPotDate(entry.createdAt) + author;
        }
        if (pack) pack.textContent = packLabel(entry.packId);

        refreshDetailSubmitButton();
        refreshDetailUnshareButton();
        refreshDetailCopyLink();
        refreshDetailTrophyBadge();
        refreshDetailRemixButton();
        refreshDetailRemixChip();
        refreshDetailRemixesStrip();
        setPotURLParam(entry);

        panel.hidden = false;

        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry);
        });
    }

    /* Show / hide the trophy badge on the detail modal. Tapping
       it jumps to the awarding battle's detail view.            */
    function refreshDetailTrophyBadge() {
        const badge = document.getElementById("detailTrophyBadge");
        if (!badge) return;
        const entry = GALLERY.detailEntry;
        const trophy = entry && !entry._isPublic ? bestTrophyForLocalEntry(entry) : null;
        if (!trophy) {
            badge.hidden = true;
            return;
        }
        badge.hidden = false;
        badge.dataset.tier  = trophy.tier;
        badge.dataset.battle = trophy.battleId;
        const nameEl = badge.querySelector(".detail-trophy-name");
        const themeEl = badge.querySelector(".detail-trophy-theme");
        if (nameEl)  nameEl.textContent  = trophyNameForTier(trophy.tier);
        if (themeEl) themeEl.textContent = trophy.theme;
    }

    function closeDetail() {
        GALLERY.detailEntry = null;
        const panel = document.getElementById("potDetail");
        if (panel) panel.hidden = true;
        clearPotURLParam();
    }

    /* "X people remixed this" strip on the pot-detail modal.
       Only renders on PUBLIC pots that have one or more remixes
       in the database. Hidden + early-out for local entries and
       for public pots with no remixes (or before SUPABASE_REMIX.sql
       has run -- the fetch just returns empty in that case).   */
    function refreshDetailRemixesStrip() {
        const strip = document.getElementById("detailRemixes");
        const row   = document.getElementById("detailRemixesRow");
        const count = document.getElementById("detailRemixesCount");
        if (!strip || !row) return;
        /* Reset to hidden by default; the async fetch reveals
           it if there are remixes. */
        strip.hidden = true;
        row.innerHTML = "";

        const entry = GALLERY.detailEntry;
        if (!entry || !entry._isPublic || !entry._publicId) return;
        if (!supabaseEnabled()) return;

        /* Capture the id at fetch-time so a late response on
           a stale modal doesn't paint into a different pot. */
        const myId = entry._publicId;

        fetchRemixesOf(myId).then(function (rows) {
            /* Bail if the modal moved on or this isn't the entry
               we kicked off the fetch for. */
            const current = GALLERY.detailEntry;
            if (!current || current._publicId !== myId) return;
            if (!rows || rows.length === 0) return;

            if (count) count.textContent = rows.length;
            /* Show up to 6 thumbs -- past that, the strip starts
               feeling like a feed and we want it scoped. */
            const picks = rows.slice(0, 6);
            picks.forEach(function (raw) {
                row.appendChild(buildRemixThumbCard(raw));
            });
            strip.hidden = false;
        });
    }

    /* Fetch public_pots WHERE remixed_from = <id>. Tolerant of
       the column not existing (returns empty if Supabase rejects
       the filter). */
    function fetchRemixesOf(publicId) {
        if (!supabaseEnabled() || !publicId) return Promise.resolve([]);
        const url = SUPABASE_URL +
            "/rest/v1/public_pots?select=*&order=created_at.desc&limit=12" +
            "&remixed_from=eq." + encodeURIComponent(publicId);
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(enrichWithProfiles)
            .catch(function () { return []; });
    }

    function buildRemixThumbCard(raw) {
        const entry = normalizePublicRow(raw);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "detail-remix-thumb";

        const canvas = document.createElement("canvas");
        canvas.width  = 100;
        canvas.height = 150;
        card.appendChild(canvas);

        const by = document.createElement("span");
        by.className = "detail-remix-thumb-by";
        const profile = raw._profile;
        by.textContent = profile && profile.username
            ? "@" + profile.username
            : raw.author || "anonymous";
        card.appendChild(by);

        card.addEventListener("click", function () {
            /* Re-open detail on the clicked remix -- replaces
               current detail in place. */
            openDetail(entry);
        });

        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry);
        });
        return card;
    }

    /* Show / hide REMIX LINEAGE chip on the detail modal. Visible
       on any entry (local or public) that carries remixedFrom
       fields. Tap to jump to the source author's profile (if
       handle is known). */
    function refreshDetailRemixChip() {
        const chip = document.getElementById("detailRemixChip");
        if (!chip) return;
        const entry = GALLERY.detailEntry;
        const src = entry && (entry.remixedFromHandle || entry.remixedFromAuthor);
        if (!src) {
            chip.hidden = true;
            return;
        }
        chip.hidden = false;
        const txt = chip.querySelector(".detail-remix-text");
        if (txt) {
            txt.textContent = "remix ← " + (
                entry.remixedFromHandle ? "@" + entry.remixedFromHandle
                                        : entry.remixedFromAuthor
            );
        }
        chip.dataset.handle = entry.remixedFromHandle || "";
        chip.style.cursor = entry.remixedFromHandle ? "pointer" : "default";
    }

    /* Show / hide REMIX. Visible on public pots only -- you don't
       remix your own local pot (just open it from MINE and keep
       shaping) and you can't remix a draft. */
    function refreshDetailRemixButton() {
        const btn = document.getElementById("detailRemix");
        if (!btn) return;
        const entry = GALLERY.detailEntry;
        const canRemix = !!(entry && entry._isPublic && Array.isArray(entry.clay));
        btn.hidden = !canRemix;
    }

    /* Clone the public pot's clay silhouette into a fresh shape
       session. Paint is NOT copied -- that's the canvas the
       remixer paints on. The new local entry carries lineage
       (remixedFrom / remixedFromAuthor / remixedFromHandle) so
       the credit chip can render later + the public copy of the
       remix gets a remixed_from FK on share.                   */
    const REMIX_ONBOARD_KEY = "crayte-remix-onboard-seen";

    function startRemix() {
        const entry = GALLERY.detailEntry;
        if (!entry || !entry._isPublic || !Array.isArray(entry.clay)) return;

        /* First time? Show the explainer first so a 5yo isn't
           confused when the wheel boots with someone else's
           clay shape. Then proceed to the actual remix. */
        let seen = false;
        try { seen = localStorage.getItem(REMIX_ONBOARD_KEY) === "yes"; } catch (_) {}
        if (!seen) {
            openRemixOnboardModal(entry, function () { doRemix(entry); });
        } else {
            doRemix(entry);
        }
    }

    function doRemix(entry) {
        /* Stash lineage on a session global so the kiln-save path
           can write it onto the new local entry. Cleared in
           autoSaveFiredPot after consumption. */
        REMIX.pending = {
            remixedFrom:       entry._publicId || null,
            remixedFromAuthor: entry.author || "anonymous",
            remixedFromHandle: (entry._profile && entry._profile.username) || null,
            /* Snapshot the source pot's name + thumbnail so the
               credit chip has data even if the FK target is gone
               or offline. */
            remixedFromName:   entry.name || "",
            /* Carry the local-only UGC taint so a remix of a pot
               that used an imported sticker stays blocked from
               public battles even if the user clears + repaints. */
            usedCustomSticker: !!entry.usedCustomSticker
        };

        /* Drop into shape mode with the cloned clay. Deep-copy
           so the user's morphs don't mutate the public entry
           we still have a reference to. */
        const cloned = entry.clay.map(function (c) {
            return { y: c.y, radius: c.radius };
        });

        closeDetail();
        showScreen("shape");
        /* Wait a tick so SHAPE's onEnter resets clay first, then
           overwrite with the clone. */
        setTimeout(function () {
            SHAPE.clay = cloned;
            /* Remix loads real clay — never gate it behind a lump
               drop even if a new-pot start left the flag set. */
            SHAPE.needsLump = false;
            /* Match the source's clay type so the remix starts
               with the same material vibe. */
            if (entry.clayTypeId) SHAPE.clayTypeId = entry.clayTypeId;
            /* Re-render so the wheel reflects the new shape. */
            if (typeof renderShape === "function") renderShape();
            refreshShapeMode();
            /* Update the persistent in-progress chip too. */
            refreshRemixInProgressChip();
        }, 50);
    }

    /* First-time-only modal. Renders source pot in a preview
       canvas + a friendly explainer + a "got it" CTA. Marks
       seen + chains to doRemix(entry). */
    function openRemixOnboardModal(entry, onDone) {
        const modal = document.getElementById("remixOnboardModal");
        const ok    = document.getElementById("remixOnboardOk");
        const cancel = document.getElementById("remixOnboardCancel");
        const canvas = document.getElementById("remixOnboardCanvas");
        const author = document.getElementById("remixOnboardAuthor");
        if (!modal || !ok || !cancel) { onDone && onDone(); return; }

        if (author) {
            const handle = entry._profile && entry._profile.username;
            author.textContent = handle ? "@" + handle
                                        : (entry.author || "anonymous");
        }
        if (canvas) {
            loadEntryPaint(entry).then(function () {
                renderEntryIntoCanvas(canvas, entry);
            });
        }
        modal.hidden = false;

        const cleanup = function () {
            modal.hidden = true;
            ok.removeEventListener("click", onOk);
            cancel.removeEventListener("click", onCancel);
            modal.removeEventListener("click", onBackdrop);
        };
        const onOk = function () {
            try { localStorage.setItem(REMIX_ONBOARD_KEY, "yes"); } catch (_) {}
            cleanup();
            onDone && onDone();
        };
        const onCancel = function () { cleanup(); };
        const onBackdrop = function (e) { if (e.target === modal) cleanup(); };
        ok.addEventListener("click", onOk);
        cancel.addEventListener("click", onCancel);
        modal.addEventListener("click", onBackdrop);
    }

    /* Persistent "remixing @user" chip, visible across SHAPE +
       DECORATE while REMIX.pending is set. Disappears once the
       pot fires (REMIX.pending consumed in autoSaveFiredPot)
       or the user bails to title (cleared in title onEnter). */
    function refreshRemixInProgressChip() {
        const chip = document.getElementById("remixInProgressChip");
        if (!chip) return;
        const p = REMIX.pending;
        if (!p) { chip.hidden = true; return; }
        const text = chip.querySelector(".remix-in-progress-text");
        if (text) {
            text.textContent = "remixing " + (
                p.remixedFromHandle ? "@" + p.remixedFromHandle
                                    : p.remixedFromAuthor
            );
        }
        chip.hidden = false;
    }

    /* Session-scoped lineage box. The kiln-save path consumes it
       and clears it; closing without firing also clears it on
       returning to title. */
    const REMIX = { pending: null };

    /* Show/hide the COPY LINK button. Only public pots have a
       shareable URL — locals and unsubmitted drafts don't.       */
    function refreshDetailCopyLink() {
        const btn = document.getElementById("detailCopyLink");
        if (!btn) return;
        const entry = GALLERY.detailEntry;
        const sharableId = (entry && entry._isPublic && entry._publicId) ||
                           (entry && entry.publicId) || null;
        btn.hidden = !sharableId;
        const lbl = btn.querySelector(".btn-label");
        if (lbl) lbl.textContent = "COPY LINK";
        btn.classList.remove("is-copied");
    }

    function potDeepLinkURL(publicId) {
        return "https://madderverse.org/lets-crayte-pootery/?pot=" +
               encodeURIComponent(publicId);
    }

    function setPotURLParam(entry) {
        try {
            const id = (entry && entry._isPublic && entry._publicId) ||
                       (entry && entry.publicId) || null;
            const url = new URL(window.location.href);
            if (id) url.searchParams.set("pot", id);
            else    url.searchParams.delete("pot");
            history.replaceState(null, "", url.toString());
        } catch (_) {}
    }

    function clearPotURLParam() {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has("pot")) return;
            url.searchParams.delete("pot");
            history.replaceState(null, "", url.toString());
        } catch (_) {}
    }

    function copyDetailLink() {
        const entry = GALLERY.detailEntry;
        if (!entry) return;
        const id = (entry._isPublic && entry._publicId) || entry.publicId;
        if (!id) return;
        const url = potDeepLinkURL(id);
        const btn = document.getElementById("detailCopyLink");
        const lbl = btn && btn.querySelector(".btn-label");
        const flash = function () {
            if (!btn || !lbl) return;
            lbl.textContent = "✓ COPIED";
            btn.classList.add("is-copied");
            setTimeout(function () {
                if (lbl) lbl.textContent = "COPY LINK";
                if (btn) btn.classList.remove("is-copied");
            }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(flash, function () {
                window.prompt("Copy this link:", url);
            });
        } else {
            window.prompt("Copy this link:", url);
        }
    }

    function saveDetailName() {
        const entry = GALLERY.detailEntry;
        if (!entry) return;
        const input = document.getElementById("detailName");
        if (!input) return;
        const newName = input.value.trim();
        if ((entry.name || "") === newName) return;
        entry.name = newName;
        /* Persist to the master array (find by id and patch). */
        const arr = loadGalleryEntries();
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].id === entry.id) { arr[i].name = newName; break; }
        }
        saveGalleryEntries(arr);
    }

    function deleteCurrentEntry() {
        const entry = GALLERY.detailEntry;
        if (!entry || !entry.id) return;
        const wasShared = !!entry.publicId;
        const ok = window.confirm(
            wasShared
                ? "Delete this pot from your gallery AND stop " +
                  "sharing it with everyone? This cannot be undone."
                : "Delete this pot? This cannot be undone."
        );
        if (!ok) return;

        /* Remove from local gallery first so the UI updates even
           if the public-delete network call is slow / fails. */
        const targetId = entry.id;
        const before = loadGalleryEntries();
        const after = before.filter(function (e) {
            return e && e.id !== targetId;
        });
        if (after.length === before.length) {
            console.warn("[CRAYte] delete: no local entry matched id=" + targetId);
        }
        saveGalleryEntries(after);

        /* If this pot was shared to the public gallery, also remove
           it from Supabase — otherwise the user sees their deleted
           pot still alive on the Public tab and thinks delete is
           broken. Cache invalidation forces a fresh fetch next time
           the Public tab paints. */
        const pubId = entry.publicId;
        const cleanup = function () {
            GALLERY.publicCache = null;
            closeDetail();
            refreshGalleryGrid();
        };
        if (wasShared && pubId && typeof deletePublicPot === "function") {
            deletePublicPot(pubId).then(function (success) {
                if (!success) {
                    console.warn("[CRAYte] public unshare failed for", pubId);
                }
                cleanup();
            });
        } else {
            cleanup();
        }
    }

    /* ----- 8D. PNG export -----
       Renders the current detail entry to a high-res offscreen
       canvas (800×1200 — 2× logical) and triggers a download.
       Includes the wheel + backdrop so the exported PNG reads
       as a complete artwork, not just a floating silhouette.   */
    function exportCurrentEntry() {
        const entry = GALLERY.detailEntry;
        if (!entry) return;
        const W = 800, H = 1200;
        const off = document.createElement("canvas");
        off.width = W;
        off.height = H;
        const ctx = off.getContext("2d");
        ctx.setTransform(W / SHAPE.W, 0, 0, H / SHAPE.H, 0, 0);

        loadEntryPaint(entry).then(function () {
            /* Backdrop + wheel ON for shareable image */
            renderSavedPot(ctx, entry);

            off.toBlob(function (blob) {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const safe = (entry.name && entry.name.trim()) ||
                             ("pootery-" + entry.id);
                a.href = url;
                a.download = safe.replace(/[^a-z0-9_-]+/gi, "_") + ".png";
                document.body.appendChild(a);
                a.click();
                setTimeout(function () {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 200);
            }, "image/png");
        });
    }

    /* ----- 8E. Init / wiring ----- */

    function initGallery() {
        const back  = document.getElementById("galleryBack");
        const startBtn = document.getElementById("galleryStartBtn");
        const close = document.getElementById("detailClose");
        const del   = document.getElementById("detailDelete");
        const expt  = document.getElementById("detailExport");
        const submit = document.getElementById("detailSubmit");
        const name  = document.getElementById("detailName");
        const panel = document.getElementById("potDetail");

        if (back) back.addEventListener("click", function () {
            closeDetail();
            showScreen("title");
        });

        if (startBtn) startBtn.addEventListener("click", function () {
            showScreen("shape");
        });

        if (close)  close.addEventListener("click", closeDetail);
        if (del)    del.addEventListener("click",   deleteCurrentEntry);
        if (expt)   expt.addEventListener("click",  exportCurrentEntry);
        if (submit) submit.addEventListener("click", startShareFlow);

        const unshare = document.getElementById("detailUnshare");
        if (unshare) unshare.addEventListener("click", unshareCurrent);

        const copyLink = document.getElementById("detailCopyLink");
        if (copyLink) copyLink.addEventListener("click", copyDetailLink);

        const remix = document.getElementById("detailRemix");
        if (remix) remix.addEventListener("click", startRemix);

        const remixChip = document.getElementById("detailRemixChip");
        if (remixChip) remixChip.addEventListener("click", function () {
            const handle = remixChip.dataset.handle;
            if (handle) openProfile(handle);
        });

        wireDetailTrophyBadge();

        if (name) {
            name.addEventListener("change", saveDetailName);
            name.addEventListener("blur",   saveDetailName);
        }

        if (panel) {
            panel.addEventListener("click", function (e) {
                if (e.target === panel) closeDetail();
            });
        }

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && panel && !panel.hidden) closeDetail();
        });

        /* Gallery tabs (Day 5 chunk E — MINE / EVERYONE,
           chunk F — BATTLES) */
        document.querySelectorAll(".gallery-tab[data-tab]").forEach(function (b) {
            b.addEventListener("click", function () {
                if (GALLERY.tab === b.dataset.tab) return;
                GALLERY.tab = b.dataset.tab;
                refreshGalleryGrid();
            });
        });

        wireBattleUI();
    }

    /* ============================================================
       SHARE FLOW (rewritten)
       ============================================================
       Three-step flow tuned for a 5-year-old player to understand
       that sharing CREATES A COPY, not MOVES the pot:

         1) Tap SHARE TO EVERYONE on a personal pot.
         2) If this is the first share ever on this device, show
            the "sharing makes a copy" onboarding modal once.
         3) Show the two-card share-confirm modal -- their pot in
            MINE on the left ("STAYS HERE"), the same pot on the
            right ("NEW COPY" in EVERYONE). Author input lives here.
         4) On confirm, upload. On success, close confirm modal,
            play the "+1 copy lifts off" animation overlay (which
            visually proves the original stays).
       ============================================================ */

    const SHARE_ONBOARD_KEY = "crayte-share-onboard-seen";

    function startShareFlow() {
        const entry = GALLERY.detailEntry;
        if (!entry || entry._isPublic) return;
        if (!supabaseEnabled()) {
            alert("Public gallery isn't configured yet.");
            return;
        }
        if (entry.publicId) {
            alert("This pot is already shared. Use STOP SHARING to remove it.");
            return;
        }

        const goConfirm = function () { openShareConfirmModal(entry); };

        let seen = false;
        try { seen = localStorage.getItem(SHARE_ONBOARD_KEY) === "yes"; } catch (_) {}
        if (!seen) {
            openShareOnboardModal(goConfirm);
        } else {
            goConfirm();
        }
    }

    /* ----- First-time onboarding ----- */

    function openShareOnboardModal(onDone) {
        const modal = document.getElementById("shareOnboardModal");
        const ok    = document.getElementById("shareOnboardOk");
        if (!modal || !ok) { onDone && onDone(); return; }
        modal.hidden = false;
        const handler = function () {
            try { localStorage.setItem(SHARE_ONBOARD_KEY, "yes"); } catch (_) {}
            modal.hidden = true;
            ok.removeEventListener("click", handler);
            onDone && onDone();
        };
        ok.addEventListener("click", handler);
    }

    /* ----- Two-card confirm modal ----- */

    function openShareConfirmModal(entry) {
        const modal  = document.getElementById("shareConfirmModal");
        const mine   = document.getElementById("sharePreviewMine");
        const copy   = document.getElementById("sharePreviewCopy");
        const input  = document.getElementById("shareConfirmAuthor");
        const cancel = document.getElementById("shareConfirmCancel");
        const go     = document.getElementById("shareConfirmGo");
        if (!modal || !mine || !copy || !cancel || !go) return;

        /* Render the user's actual pot into both preview cards
           so the kid can SEE the same pot appearing twice. */
        const cMine = mine.querySelector("canvas");
        const cCopy = copy.querySelector("canvas");
        loadEntryPaint(entry).then(function () {
            if (cMine) renderEntryIntoCanvas(cMine, entry);
            if (cCopy) renderEntryIntoCanvas(cCopy, entry);
        });

        if (input) {
            try {
                const remembered = localStorage.getItem("crayte-author") || "";
                input.value = entry._author || remembered;
            } catch (_) { input.value = entry._author || ""; }
        }

        modal.hidden = false;

        const cleanup = function () {
            modal.hidden = true;
            cancel.removeEventListener("click", onCancel);
            go.removeEventListener("click", onGo);
            modal.removeEventListener("click", onBackdrop);
        };
        const onCancel = function () { cleanup(); };
        const onBackdrop = function (e) { if (e.target === modal) cleanup(); };
        const onGo = function () {
            const author = (input && input.value || "").trim() || "anonymous";
            try { localStorage.setItem("crayte-author", author === "anonymous" ? "" : author); } catch (_) {}
            go.disabled = true;
            cancel.disabled = true;
            const lbl = go.querySelector(".btn-label");
            if (lbl) lbl.textContent = "SHARING...";
            uploadShareCopy(entry, author).then(function (ok) {
                go.disabled = false;
                cancel.disabled = false;
                if (lbl) lbl.textContent = "YES, SHARE A COPY";
                if (ok) {
                    cleanup();
                    playShareCompleteAnim();
                } else {
                    if (lbl) lbl.textContent = "TRY AGAIN";
                }
            });
        };
        cancel.addEventListener("click", onCancel);
        go.addEventListener("click", onGo);
        modal.addEventListener("click", onBackdrop);
    }

    /* Upload + local state patch. Resolves true on success. */
    function uploadShareCopy(entry, author) {
        return submitPublicPot(entry, author).then(function (row) {
            if (!row || !row.id) return false;
            entry.publicId = row.id;
            entry._author  = author;
            const arr = loadGalleryEntries();
            for (let i = 0; i < arr.length; i++) {
                if (arr[i].id === entry.id) {
                    arr[i].publicId = row.id;
                    arr[i]._author  = author;
                    break;
                }
            }
            saveGalleryEntries(arr);
            GALLERY.publicCache = null;
            refreshDetailSubmitButton();
            refreshDetailCopyLink();
            return true;
        });
    }

    /* "+1 copy lifts off" overlay that fires after a successful
       share. Plays from anywhere -- a fixed-position overlay so it
       doesn't depend on the gallery tab being active. The pot
       thumbnail on the left is rendered from GALLERY.detailEntry so
       the kid sees "same pot, now ALSO in Everyone." */
    function playShareCompleteAnim() {
        const entry = GALLERY.detailEntry;
        if (!entry) return;
        const overlay = document.getElementById("shareCompleteOverlay");
        if (!overlay) return;
        const stayCanvas = overlay.querySelector(".share-complete-stay canvas");
        const flyCanvas  = overlay.querySelector(".share-complete-fly canvas");
        loadEntryPaint(entry).then(function () {
            if (stayCanvas) renderEntryIntoCanvas(stayCanvas, entry);
            if (flyCanvas)  renderEntryIntoCanvas(flyCanvas, entry);
        });
        overlay.hidden = false;
        overlay.classList.remove("is-playing");
        /* Force reflow so the class re-add triggers animation. */
        void overlay.offsetWidth;
        overlay.classList.add("is-playing");
        setTimeout(function () {
            overlay.classList.remove("is-playing");
            overlay.hidden = true;
            /* Refresh the open MINE tab grid so the new globe
               indicator appears immediately under the modal. */
            if (currentScreen === "gallery" && GALLERY.tab === "mine") {
                refreshGalleryGrid();
            }
        }, 2200);
    }

    /* ----- Unshare ----- */

    function unshareCurrent() {
        const entry = GALLERY.detailEntry;
        if (!entry || !entry.publicId) return;
        const ok = window.confirm(
            "Stop sharing this pot?\n\n" +
            "Your pot stays in your gallery. Only the copy in Everyone is removed."
        );
        if (!ok) return;

        const btn = document.getElementById("detailUnshare");
        if (btn) {
            btn.disabled = true;
            const lbl = btn.querySelector(".btn-label");
            if (lbl) lbl.textContent = "STOPPING...";
        }

        deletePublicPot(entry.publicId).then(function (success) {
            if (btn) btn.disabled = false;
            const lbl = btn && btn.querySelector(".btn-label");
            if (!success) {
                if (lbl) lbl.textContent = "TRY AGAIN";
                return;
            }
            if (lbl) lbl.textContent = "STOP SHARING";
            entry.publicId = null;
            const arr = loadGalleryEntries();
            for (let i = 0; i < arr.length; i++) {
                if (arr[i].id === entry.id) {
                    delete arr[i].publicId;
                    break;
                }
            }
            saveGalleryEntries(arr);
            GALLERY.publicCache = null;
            refreshDetailSubmitButton();
            refreshDetailCopyLink();
            refreshDetailUnshareButton();
            if (currentScreen === "gallery" && GALLERY.tab === "mine") {
                refreshGalleryGrid();
            }
        });
    }

    /* DELETE the public copy. Owner-only via RLS (user_id auth
       check). Returns true on 2xx. */
    function deletePublicPot(publicId) {
        if (!supabaseEnabled() || !publicId) return Promise.resolve(false);
        const url = SUPABASE_URL + "/rest/v1/public_pots?id=eq." +
                    encodeURIComponent(publicId);
        return fetch(url, {
            method: "DELETE",
            headers: supabaseHeaders({
                "Prefer": "return=minimal"
            })
        }).then(function (r) {
            return r.ok;
        }).catch(function () { return false; });
    }

    /* Show/hide STOP SHARING based on whether this entry has a
       publicId we can revoke. Hidden for public-tab entries
       (you can't unshare someone else's pot) and for anonymous
       local entries that have never been shared. */
    function refreshDetailUnshareButton() {
        const btn = document.getElementById("detailUnshare");
        if (!btn) return;
        const entry = GALLERY.detailEntry;
        const canUnshare = !!(entry && !entry._isPublic && entry.publicId);
        btn.hidden = !canUnshare;
        const lbl = btn.querySelector(".btn-label");
        if (lbl) lbl.textContent = "STOP SHARING";
    }

    /* Show/hide the SHARE TO EVERYONE button:
         - hidden for public-tab entries (you don't share someone
           else's pot) and for entries already-shared by us (STOP
           SHARING takes over that slot)
         - shown with the friendly "share a copy" wording on
           personal pots that aren't yet shared                     */
    function refreshDetailSubmitButton() {
        const submit = document.getElementById("detailSubmit");
        const del    = document.getElementById("detailDelete");
        const entry  = GALLERY.detailEntry;
        if (!submit) return;
        if (!entry || entry._isPublic) {
            submit.hidden = true;
            if (del) del.hidden = !!(entry && entry._isPublic);
            return;
        }
        if (del) del.hidden = false;
        /* Already-shared local entries hide SHARE; STOP SHARING
           shows up instead (refreshDetailUnshareButton handles
           that side). */
        submit.hidden = !!entry.publicId;
        submit.disabled = false;
        const lbl = submit.querySelector(".btn-label");
        if (lbl) lbl.textContent = "SHARE TO EVERYONE";
    }

    registerScreen("gallery", {
        onEnter: function () {
            if (!GALLERY.inited) {
                initGallery();
                GALLERY.inited = true;
            }
            refreshGalleryGrid();
            wheelHumStop();
        },
        onLeave: function () {
            closeDetail();
        }
    });

    /* ============================================================
       ACCOUNT screen (Phase 1)
       ============================================================ */

    function initAccountScreen() {
        const back = document.getElementById("accountBack");
        if (back) back.addEventListener("click", function () {
            showScreen("title");
        });

        initPushSettingsToggle();

        const googleBtn = document.getElementById("signInGoogleBtn");
        if (googleBtn) googleBtn.addEventListener("click", signInWithGoogle);

        const magicBtn = document.getElementById("signInMagicBtn");
        const emailInp = document.getElementById("signInEmail");
        const status   = document.getElementById("signInStatus");
        if (magicBtn) magicBtn.addEventListener("click", function () {
            const email = (emailInp.value || "").trim();
            if (!email || email.indexOf("@") < 0) {
                if (status) {
                    status.hidden = false;
                    status.classList.add("is-error");
                    status.textContent = "Enter a valid email.";
                }
                return;
            }
            magicBtn.disabled = true;
            const lbl = magicBtn.querySelector(".btn-label");
            if (lbl) lbl.textContent = "SENDING...";
            signInWithMagicLink(email).then(function (res) {
                magicBtn.disabled = false;
                if (lbl) lbl.textContent = "SEND MAGIC LINK";
                if (status) status.hidden = false;
                if (res.ok) {
                    if (status) {
                        status.classList.remove("is-error");
                        status.textContent = "Check " + email + " — link inside.";
                    }
                } else {
                    if (status) {
                        status.classList.add("is-error");
                        status.textContent = res.error || "Send failed. Try again.";
                    }
                }
            });
        });

        const signOutBtn = document.getElementById("signOutBtn");
        if (signOutBtn) signOutBtn.addEventListener("click", function () {
            signOutBtn.disabled = true;
            signOut().then(function () {
                signOutBtn.disabled = false;
                refreshAccountScreen();
            });
        });

        const saveBtn = document.getElementById("profileSaveBtn");
        if (saveBtn) saveBtn.addEventListener("click", function () {
            const username = (document.getElementById("profileUsername").value || "")
                .trim().toLowerCase();
            const displayName = (document.getElementById("profileDisplayName").value || "").trim();
            const bio = (document.getElementById("profileBio").value || "").trim();
            const status = document.getElementById("profileStatus");

            /* Client-side validate the username format so a bad input
               doesn't burn a Supabase round-trip. */
            if (username && !/^[a-z0-9_]{3,20}$/.test(username)) {
                if (status) {
                    status.hidden = false;
                    status.classList.add("is-error");
                    status.textContent = "@handle: 3-20 chars, lowercase/digits/underscore only.";
                }
                return;
            }

            saveBtn.disabled = true;
            const lbl = saveBtn.querySelector(".btn-label");
            if (lbl) lbl.textContent = "SAVING...";
            updateProfile({
                username:     username || null,
                display_name: displayName || null,
                bio:          bio || null,
                updated_at:   new Date().toISOString()
            }).then(function (p) {
                saveBtn.disabled = false;
                if (lbl) lbl.textContent = "SAVE";
                if (status) status.hidden = false;
                if (p) {
                    if (status) {
                        status.classList.remove("is-error");
                        status.textContent = "Saved.";
                    }
                    updateAuthUI();
                } else {
                    if (status) {
                        status.classList.add("is-error");
                        status.textContent = "Save failed — username may be taken.";
                    }
                }
            });
        });
    }

    function refreshAccountScreen() {
        const outView = document.getElementById("accountSignedOut");
        const inView  = document.getElementById("accountSignedIn");
        const status  = document.getElementById("accountStatus");
        const signed  = isSignedIn();
        if (outView) outView.hidden = signed;
        if (inView)  inView.hidden  = !signed;
        if (status)  status.textContent = signed ? "SIGNED IN" : "SIGNED OUT";
        if (signed) {
            const p = AUTH.profile || {};
            const u = (AUTH.session && AUTH.session.user) || {};
            const uname  = document.getElementById("profileUsername");
            const dname  = document.getElementById("profileDisplayName");
            const bio    = document.getElementById("profileBio");
            const head   = document.getElementById("profileHeadline");
            if (uname) uname.value = p.username || "";
            if (dname) dname.value = p.display_name || u.email || "";
            if (bio)   bio.value   = p.bio || "";
            if (head)  head.textContent = p.username
                ? "@" + p.username
                : (p.display_name || u.email || "YOUR PROFILE");
            const stat = document.getElementById("profileStatus");
            if (stat) stat.hidden = true;
        } else {
            const inStatus = document.getElementById("signInStatus");
            if (inStatus) inStatus.hidden = true;
        }
    }

    registerScreen("account", {
        onEnter: function () {
            if (!AUTH._screenInited) {
                initAccountScreen();
                AUTH._screenInited = true;
            }
            refreshAccountScreen();
            refreshPushSettingsUI();
            wheelHumStop();
        }
    });

    /* Update the TITLE-screen ACCOUNT button + any other places
       that reflect auth state. Called by notifyAuthListeners on
       sign-in / sign-out / profile change. */
    function updateAuthUI() {
        const btn = document.getElementById("btnAccount");
        if (btn) {
            const lbl = btn.querySelector(".btn-label");
            if (lbl) {
                if (isSignedIn()) {
                    const p = AUTH.profile || {};
                    const u = AUTH.session.user || {};
                    const name = p.username
                        ? "@" + p.username
                        : (p.display_name || u.email || "ACCOUNT");
                    lbl.textContent = name.toUpperCase().slice(0, 20);
                } else {
                    lbl.textContent = "SIGN IN";
                }
            }
        }
        /* If the account screen is mounted, refresh its view too. */
        if (currentScreen === "account") refreshAccountScreen();
    }

    onAuthChange(updateAuthUI);

    /* ----- Achievements screen registration (uses helpers below) ----- */

    function refreshAchievementsGrid() {
        ensureAchievements();
        const grid  = document.getElementById("achGrid");
        const count = document.getElementById("achCount");
        if (!grid) return;
        const total = ACHIEVEMENTS.length;
        const unlockedCount = ACH_STATE.unlocked.size;
        if (count) count.textContent = unlockedCount + " / " + total;
        grid.innerHTML = "";
        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            const ok = ACH_STATE.unlocked.has(a.id);
            const card = document.createElement("div");
            card.className = "ach-card" + (ok ? " is-unlocked" : " is-locked");
            const ic = document.createElement("div");
            ic.className = "ach-icon";
            ic.textContent = ok ? (a.icon || "★") : "?";
            const ttl = document.createElement("h3");
            ttl.className = "ach-title";
            ttl.textContent = ok ? a.title : "???";
            const desc = document.createElement("p");
            desc.className = "ach-desc";
            desc.textContent = ok ? a.desc : "Locked. Keep playing.";
            card.appendChild(ic);
            card.appendChild(ttl);
            card.appendChild(desc);
            if (a.grant && ok) {
                const tag = document.createElement("span");
                tag.className = "ach-reward";
                tag.textContent = a.grant.stamp
                    ? "REWARD: " + a.grant.stamp.toUpperCase() + " STAMP"
                    : (a.grant.unlocksClay
                        ? "REWARD: " + a.grant.unlocksClay.toUpperCase() + " CLAY"
                        : "");
                if (tag.textContent) card.appendChild(tag);
            }
            grid.appendChild(card);
        }
    }

    registerScreen("achievements", {
        onEnter: function () {
            /* Re-scan so any achievements earned offline (or via dev
               tools) show up. */
            checkAchievements();
            refreshAchievementsGrid();
            wheelHumStop();
        }
    });

    /* ============================================================
       PACK SHOP screen
       ============================================================
       Renders every pack in GLAZE_PACKS as a card. Status varies
       by free / owned / released / queued. Tapping a paid pack
       opens a stub "AVAILABLE SOON" alert until Stripe lands. */

    function initShopScreen() {
        const back = document.getElementById("shopBack");
        if (back) back.addEventListener("click", function () {
            showScreen("title");
        });
        const grid = document.getElementById("shopGrid");
        /* Click delegation -- one listener handles every card. */
        if (grid && !grid._delegated) {
            grid.addEventListener("click", function (e) {
                const card = e.target.closest(".shop-card[data-pack]");
                if (!card) return;
                handleShopCardClick(card.dataset.pack);
            });
            grid._delegated = true;
        }
    }

    function refreshShopScreen() {
        const grid  = document.getElementById("shopGrid");
        const count = document.getElementById("shopOwnedCount");
        if (!grid) return;
        grid.innerHTML = "";

        let ownedCount = 0;
        GLAZE_PACKS.forEach(function (p) {
            if (isPackOwned(p)) ownedCount++;
        });
        if (count) {
            const total = GLAZE_PACKS.length;
            count.textContent = ownedCount + " / " + total + " OWNED";
        }

        /* Sort: owned first (free + bought), then unreleased
           paid (drops soon), then released paid (buy now). */
        const sorted = GLAZE_PACKS.slice().sort(function (a, b) {
            const rankA = shopSortRank(a);
            const rankB = shopSortRank(b);
            return rankA - rankB;
        });
        sorted.forEach(function (p) {
            grid.appendChild(buildShopCard(p));
        });
    }

    function shopSortRank(p) {
        if (isPackOwned(p)) return 0;
        if (!isPackReleased(p)) return 1;   /* queued / coming soon */
        return 2;   /* paid + released + not owned -- top buy candidates */
    }

    function buildShopCard(p) {
        const card = document.createElement("div");
        card.className = "shop-card";
        card.dataset.pack = p.id;
        const owned    = isPackOwned(p);
        const released = isPackReleased(p);
        const free     = !p.priceCents;
        if (owned)         card.classList.add("is-owned");
        if (!released)     card.classList.add("is-queued");
        if (free)          card.classList.add("is-free");

        const cover = document.createElement("div");
        cover.className = "shop-cover";
        cover.textContent = p.coverEmoji || "\u{1FAB4}";
        card.appendChild(cover);

        const meta = document.createElement("div");
        meta.className = "shop-meta";

        const name = document.createElement("h3");
        name.className = "shop-name";
        name.textContent = p.label;
        meta.appendChild(name);

        const desc = document.createElement("p");
        desc.className = "shop-desc";
        desc.textContent = p.description || "";
        meta.appendChild(desc);

        const status = document.createElement("span");
        status.className = "shop-status";
        status.textContent = shopStatusText(p);
        meta.appendChild(status);

        card.appendChild(meta);

        const cta = document.createElement("span");
        cta.className = "shop-cta";
        cta.textContent = shopCtaText(p);
        card.appendChild(cta);

        return card;
    }

    function shopStatusText(p) {
        if (!p.priceCents) return "FREE";
        if (isPackOwned(p)) return "OWNED";
        if (!isPackReleased(p)) {
            const d = new Date(p.releaseDate);
            return "DROPS " + d.toLocaleDateString(undefined, {
                month: "short", day: "numeric"
            }).toUpperCase();
        }
        /* paid + released + not owned */
        return "$" + (p.priceCents / 100).toFixed(2);
    }

    function shopCtaText(p) {
        if (!p.priceCents)            return "PLAY";
        if (isPackOwned(p))           return "PLAY";
        if (!isPackReleased(p))       return "NOTIFY ME";
        return "BUY";
    }

    function handleShopCardClick(packId) {
        const p = GLAZE_PACKS.find(function (x) { return x.id === packId; });
        if (!p) return;
        const free   = !p.priceCents;
        const owned  = isPackOwned(p);
        if (free || owned) {
            /* Jump straight into shape mode with this pack pre-selected.
               Uses the existing clay — don't gate behind a lump drop. */
            D.activePackId = p.id;
            SHAPE.needsLump = false;
            showScreen("shape");
            return;
        }
        if (!isPackReleased(p)) {
            alert(
                p.label + " drops on " +
                new Date(p.releaseDate).toLocaleDateString() + ".\n\n" +
                "Turn on push notifications in your account screen to get " +
                "a heads-up the moment it lands."
            );
            return;
        }
        /* Released + paid + not owned -- Stripe wiring TBD. */
        alert(
            p.label + " — $" + (p.priceCents / 100).toFixed(2) + "\n\n" +
            "Pay-to-own packs are landing soon. " +
            "Bookmark this and check back."
        );
    }

    registerScreen("shop", {
        onEnter: function () {
            initShopScreen();
            refreshShopScreen();
            wheelHumStop();
        }
    });

    /* ============================================================
       STATS screen
       ============================================================
       Computes a tile grid of counts from local gallery + trophy
       cache + egg flags. The "remixes of your pots" tile fetches
       Supabase live if the user has any shared pots.            */

    function initStatsScreen() {
        const back = document.getElementById("statsBack");
        if (back && !back._wired) {
            back.addEventListener("click", function () {
                showScreen("title");
            });
            back._wired = true;
        }
    }

    function refreshStatsScreen() {
        const grid = document.getElementById("statsGrid");
        const days = document.getElementById("statsDays");
        if (!grid) return;
        grid.innerHTML = "";

        const entries = loadGalleryEntries();
        const stats = computeStats(entries);
        if (days) days.textContent = stats.daysCreating > 0
            ? stats.daysCreating + (stats.daysCreating === 1 ? " DAY" : " DAYS")
            : "TODAY";

        const tiles = [
            { label: "POTS MADE",        val: stats.total },
            { label: "FIRED",            val: stats.fired },
            { label: "EXPLODED",         val: stats.exploded, dim: stats.exploded === 0 },
            { label: "OVERFIRED",        val: stats.overfired, dim: stats.overfired === 0 },
            { label: "SHARED PUBLIC",    val: stats.publicShared },
            { label: "TROPHIES WON",     val: stats.trophyCount,
              accent: stats.trophyCount > 0 ? "gold" : null },
            { label: "REMIXED BY OTHERS", val: "—",
              tile: "remixedByOthersTile", accent: "pink" },
            { label: "EGGS FOUND",       val: stats.eggsFound,
              accent: stats.eggsFound > 0 ? "pink" : null },
            { label: "FAV CLAY",         val: stats.favClay   || "—",
              big: false },
            { label: "FAV PACK",         val: stats.favPack   || "—",
              big: false }
        ];
        tiles.forEach(function (t) {
            const card = document.createElement("div");
            card.className = "stats-tile";
            if (t.accent) card.classList.add("accent-" + t.accent);
            if (t.dim)    card.classList.add("is-dim");
            if (t.tile)   card.id = t.tile;
            const valEl = document.createElement("span");
            valEl.className = "stats-val" + (t.big === false ? " stats-val-small" : "");
            valEl.textContent = t.val;
            const lblEl = document.createElement("span");
            lblEl.className = "stats-lbl";
            lblEl.textContent = t.label;
            card.appendChild(valEl);
            card.appendChild(lblEl);
            grid.appendChild(card);
        });

        /* Async fetch for remix-by-others count */
        fetchRemixedByOthersCount().then(function (n) {
            const tile = document.getElementById("remixedByOthersTile");
            if (!tile) return;   /* user navigated away */
            const valEl = tile.querySelector(".stats-val");
            if (valEl) valEl.textContent = n;
        });
    }

    /* Pure local-stats computation. */
    function computeStats(entries) {
        let fired = 0, exploded = 0, overfired = 0, publicShared = 0;
        const clayTally = Object.create(null);
        const packTally = Object.create(null);
        let oldestT = Infinity;
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e.fired)     fired++;
            if (e.exploded)  exploded++;
            if (e.overfired) overfired++;
            if (e.publicId)  publicShared++;
            if (e.clayTypeId) clayTally[e.clayTypeId] = (clayTally[e.clayTypeId] || 0) + 1;
            if (e.packId)     packTally[e.packId]     = (packTally[e.packId]     || 0) + 1;
            if (e.createdAt && e.createdAt < oldestT) oldestT = e.createdAt;
        }

        const trophyCache = trophyCacheLoad();
        const trophyCount = Object.keys(trophyCache).length;

        /* Egg flags live on the EGG state object. Count true ones. */
        let eggsFound = 0;
        if (typeof EGG === "object" && EGG) {
            ["konami", "pingas", "overheatTriggered", "overclocked",
             "sentient", "infiniteClay", "oneFrameFire"]
                .forEach(function (k) { if (EGG[k]) eggsFound++; });
        }

        const daysCreating = oldestT === Infinity ? 0 :
            Math.max(1, Math.ceil((Date.now() - oldestT) / 86400000));

        const top = function (tally) {
            let best = null, max = 0;
            for (const k in tally) {
                if (tally[k] > max) { max = tally[k]; best = k; }
            }
            return best;
        };
        const favClayId = top(clayTally);
        const favPackId = top(packTally);

        const claySwatch = favClayId
            ? (function () {
                for (let i = 0; i < CLAY_TYPES.length; i++) {
                    if (CLAY_TYPES[i].id === favClayId) return CLAY_TYPES[i].label;
                }
                return favClayId.toUpperCase();
              }())
            : null;
        const packLbl = favPackId ? packLabel(favPackId) : null;

        return {
            total:        entries.length,
            fired:        fired,
            exploded:     exploded,
            overfired:    overfired,
            publicShared: publicShared,
            trophyCount:  trophyCount,
            eggsFound:    eggsFound,
            daysCreating: daysCreating,
            favClay:      claySwatch,
            favPack:      packLbl
        };
    }

    /* Async — count public_pots.remixed_from IN <my publicIds>.
       Anon-friendly: the local entries carry their own publicIds
       so we don't need an authed query. */
    function fetchRemixedByOthersCount() {
        if (!supabaseEnabled()) return Promise.resolve(0);
        const myIds = loadGalleryEntries()
            .map(function (e) { return e.publicId; })
            .filter(Boolean);
        if (myIds.length === 0) return Promise.resolve(0);
        const inClause = "(" + myIds.join(",") + ")";
        const url = SUPABASE_URL +
            "/rest/v1/public_pots?select=id&remixed_from=in." +
            encodeURIComponent(inClause);
        return fetch(url, { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (rows) { return Array.isArray(rows) ? rows.length : 0; })
            .catch(function () { return 0; });
    }

    registerScreen("stats", {
        onEnter: function () {
            initStatsScreen();
            refreshStatsScreen();
            wheelHumStop();
        }
    });

    /* ============================================================
       PROFILE pages (Phase 1 chunk 2)
       ============================================================
       Public profile pages. Click any @handle byline anywhere ->
       lands here. URL param ?profile=<handle> deep-links straight
       to a profile on cold load.
       ============================================================ */

    const PROFILE = {
        currentHandle: null,
        previousScreen: "title",
        inited: false
    };

    function setProfileUI(state) {
        const loading = document.getElementById("profileLoading");
        const empty   = document.getElementById("profileEmpty");
        const missing = document.getElementById("profileMissing");
        const grid    = document.getElementById("profileGrid");
        const header  = document.getElementById("profileHeader");
        if (loading) loading.hidden = state !== "loading";
        if (empty)   empty.hidden   = state !== "empty";
        if (missing) missing.hidden = state !== "missing";
        if (header)  header.hidden  = state === "missing" || state === "loading";
        if (grid && state === "missing") grid.innerHTML = "";
    }

    function loadProfile(username) {
        if (!supabaseEnabled() || !username) {
            setProfileUI("missing");
            return;
        }
        PROFILE.currentHandle = username;
        setProfileUI("loading");
        const grid = document.getElementById("profileGrid");
        if (grid) grid.innerHTML = "";

        /* 1) fetch the profile row */
        fetch(SUPABASE_URL + "/rest/v1/profiles?select=*" +
                "&username=eq." + encodeURIComponent(username),
              { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (rows) {
                const profile = rows && rows[0];
                if (!profile) {
                    setProfileUI("missing");
                    const title = document.getElementById("profileScreenTitle");
                    if (title) title.textContent = "< NOT FOUND >";
                    return;
                }
                renderProfileHeader(profile);
                /* 2) fetch their public pots */
                return fetch(
                    SUPABASE_URL + "/rest/v1/public_pots?select=*" +
                        "&user_id=eq." + encodeURIComponent(profile.id) +
                        "&order=created_at.desc&limit=50",
                    { headers: supabaseHeaders() }
                )
                .then(function (r) { return r.ok ? r.json() : []; })
                .then(function (pots) {
                    /* Stamp the profile back into each row so the
                       byline render is consistent + opening a pot
                       detail from a profile still shows the @handle. */
                    pots.forEach(function (p) { p._profile = profile; });
                    renderProfilePots(profile, pots);
                    /* 3) fetch their battle trophies + render the shelf */
                    return fetchProfileTrophies(profile).then(function (trophies) {
                        renderProfileTrophyShelf(trophies);
                    });
                });
            })
            .catch(function (e) {
                console.warn("[CRAYte] profile load failed", e);
                setProfileUI("missing");
            });
    }

    /* Pull all battle_entries this user has submitted, then the
       parent battles, and derive a flat list of {tier, theme,
       wonAt, entryRow}. Used by the Trophy Shelf section.       */
    function fetchProfileTrophies(profile) {
        if (!supabaseEnabled() || !profile || !profile.id) {
            return Promise.resolve([]);
        }
        const userId = profile.id;
        return fetch(SUPABASE_URL + "/rest/v1/battle_entries?select=*" +
                "&user_id=eq." + encodeURIComponent(userId) +
                "&order=created_at.desc&limit=200",
              { headers: supabaseHeaders() })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (entries) {
                if (!entries || entries.length === 0) return [];
                const battleIds = Array.from(new Set(
                    entries.map(function (e) { return e.battle_id; })));
                const inClause = "(" + battleIds.join(",") + ")";
                return fetch(SUPABASE_URL + "/rest/v1/battles?select=*" +
                        "&id=in." + encodeURIComponent(inClause),
                      { headers: supabaseHeaders() })
                    .then(function (r) { return r.ok ? r.json() : []; })
                    .then(function (battles) {
                        const byId = {};
                        battles.forEach(function (b) { byId[b.id] = b; });
                        const trophies = [];
                        entries.forEach(function (e) {
                            const b = byId[e.battle_id];
                            if (!b || !b.placements) return;
                            const tier = entryTier(b.placements, e.id);
                            if (!tier) return;
                            trophies.push({
                                tier:     tier,
                                battle:   b,
                                entry:    e,
                                wonAt:    b.resolved_at || b.created_at
                            });
                        });
                        /* Sort: tier rank ascending (first first),
                           then most-recent wonAt. */
                        trophies.sort(function (a, b) {
                            const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
                            if (t !== 0) return t;
                            return new Date(b.wonAt) - new Date(a.wonAt);
                        });
                        return trophies;
                    });
            })
            .catch(function () { return []; });
    }

    function renderProfileTrophyShelf(trophies) {
        const shelf = document.getElementById("profileTrophyShelf");
        const list  = document.getElementById("profileTrophyList");
        const count = document.getElementById("profileTrophyCount");
        if (!shelf || !list) return;
        list.innerHTML = "";
        if (!trophies || trophies.length === 0) {
            shelf.hidden = true;
            return;
        }
        shelf.hidden = false;
        if (count) count.textContent = trophies.length +
            (trophies.length === 1 ? " TROPHY" : " TROPHIES");

        trophies.forEach(function (t) {
            const card = document.createElement("div");
            card.className = "trophy-shelf-card tier-" + t.tier;

            const thumb = document.createElement("div");
            thumb.className = "trophy-shelf-thumb";
            const canvas = document.createElement("canvas");
            canvas.width = 160;
            canvas.height = 240;
            thumb.appendChild(canvas);
            card.appendChild(thumb);

            const meta = document.createElement("div");
            meta.className = "trophy-shelf-meta";

            const nameEl = document.createElement("span");
            nameEl.className = "trophy-shelf-name";
            nameEl.textContent = trophyNameForTier(t.tier);
            meta.appendChild(nameEl);

            const themeEl = document.createElement("span");
            themeEl.className = "trophy-shelf-theme";
            themeEl.textContent = t.battle.theme || "(untitled battle)";
            meta.appendChild(themeEl);

            const dateEl = document.createElement("span");
            dateEl.className = "trophy-shelf-date";
            dateEl.textContent = formatPotDate(new Date(t.wonAt).getTime());
            meta.appendChild(dateEl);

            card.appendChild(meta);

            /* Clicking the card jumps to that battle's results. */
            card.addEventListener("click", function () {
                GALLERY.tab = "battles";
                showScreen("gallery");
                setTimeout(function () { openBattleDetail(t.battle); }, 250);
            });

            list.appendChild(card);

            /* Render the entry's pot into the thumb canvas. */
            const entry = normalizePublicRow(t.entry);
            loadEntryPaint(entry).then(function () {
                renderEntryIntoCanvas(canvas, entry);
            });
        });
    }

    function renderProfileHeader(profile) {
        const title  = document.getElementById("profileScreenTitle");
        const handle = document.getElementById("profileHandle");
        const disp   = document.getElementById("profileDisplay");
        const bio    = document.getElementById("profileBioRead");
        if (title)  title.textContent  = "< @" + profile.username + " >";
        if (handle) handle.textContent = "@" + profile.username;
        if (disp)   disp.textContent   = profile.display_name || profile.username;
        if (bio) {
            if (profile.bio && profile.bio.trim()) {
                bio.textContent = profile.bio;
                bio.hidden = false;
            } else {
                bio.textContent = "";
                bio.hidden = true;
            }
        }
    }

    function renderProfilePots(profile, pots) {
        const grid   = document.getElementById("profileGrid");
        const count  = document.getElementById("profilePotCount");
        const stats  = document.getElementById("profileStats");
        if (count)  count.textContent =
            pots.length + (pots.length === 1 ? " POT" : " POTS");
        if (stats) {
            stats.innerHTML = "";
            const potsStat = document.createElement("span");
            potsStat.className = "profile-stat";
            potsStat.innerHTML = "<strong>" + pots.length + "</strong>&nbsp;pots";
            stats.appendChild(potsStat);
            const expl = pots.filter(function (p) { return p.exploded; }).length;
            if (expl > 0) {
                const explStat = document.createElement("span");
                explStat.className = "profile-stat";
                explStat.innerHTML = "<strong>" + expl + "</strong>&nbsp;exploded";
                stats.appendChild(explStat);
            }
            const fired = pots.filter(function (p) {
                return p.fired && !p.exploded;
            }).length;
            if (fired > 0) {
                const firedStat = document.createElement("span");
                firedStat.className = "profile-stat";
                firedStat.innerHTML = "<strong>" + fired + "</strong>&nbsp;fired";
                stats.appendChild(firedStat);
            }
        }
        if (!grid) return;
        grid.innerHTML = "";
        if (pots.length === 0) {
            setProfileUI("empty");
            return;
        }
        setProfileUI("ok");
        pots.forEach(function (row) {
            const entry = normalizePublicRow(row);
            grid.appendChild(buildThumbCard(entry));
        });
    }

    function openProfile(username) {
        if (!username) return;
        if (currentScreen !== "profile") {
            PROFILE.previousScreen = currentScreen;
        }
        /* Update URL silently so the profile is shareable, without
           pushing a new history entry (so browser back goes to
           wherever the user came from in the browser sense). */
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("profile", username);
            window.history.replaceState(null, "", url.toString());
        } catch (_) {}
        showScreen("profile");
        loadProfile(username);
    }

    function backFromProfile() {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete("profile");
            window.history.replaceState(null, "", url.toString());
        } catch (_) {}
        showScreen(PROFILE.previousScreen || "title");
    }

    function initProfileScreen() {
        const back = document.getElementById("profileBack");
        if (back) back.addEventListener("click", backFromProfile);
    }

    registerScreen("profile", {
        onEnter: function () {
            if (!PROFILE.inited) {
                initProfileScreen();
                PROFILE.inited = true;
            }
            wheelHumStop();
        }
    });

    /* Synchronous adopt-from-URL handler. Runs BEFORE the trophy
       reveal timer fires so a freshly-adopted entry's reveal
       fires on the same load.

       URL shape: ?adopt=<battleId>:<entryId>,<battleId>:<entryId>
       Empty / missing pairs are ignored. Strips the param from
       the URL bar after running so refresh doesn't redo it. */
    function adoptFromURL() {
        try {
            const params = new URLSearchParams(window.location.search);
            const raw = params.get("adopt");
            if (!raw) return;

            const refs = raw.split(",").map(function (pair) {
                const parts = pair.split(":");
                if (parts.length !== 2) return null;
                const battleId      = parts[0].trim();
                const battleEntryId = parts[1].trim();
                if (!battleId || !battleEntryId) return null;
                return { battleId: battleId, battleEntryId: battleEntryId };
            }).filter(Boolean);

            if (refs.length === 0) {
                stripAdoptParam();
                return;
            }

            const existing = loadMyBattleEntries();
            const merged = existing.concat(
                refs.filter(function (r) {
                    return !existing.some(function (x) {
                        return x.battleEntryId === r.battleEntryId;
                    });
                })
            );
            localStorage.setItem(
                "crayte-my-battle-entries", JSON.stringify(merged));

            /* Clear the seen flag for adopted entries so the
               reveal can fire (instead of being silenced as
               "already shown"). */
            const seen = loadRevealedTrophies();
            refs.forEach(function (r) { seen.delete(r.battleEntryId); });
            localStorage.setItem(
                "crayte-trophies-revealed",
                JSON.stringify(Array.from(seen)));

            stripAdoptParam();
        } catch (_) { /* best-effort */ }
    }

    function stripAdoptParam() {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has("adopt")) return;
            url.searchParams.delete("adopt");
            history.replaceState(null, "", url.toString());
        } catch (_) {}
    }

    /* On cold load, honor ?profile=<handle> and ?pot=<uuid> in
       the URL — deep-link straight to the target after auth has
       had a chance to resolve (so signed-in callers see their
       own ownership affordances if they land on their own page).
       Pot deep-links take priority — they're how shared pot URLs
       open straight onto the detail modal. */
    function checkURLDeepLinks() {
        try {
            const params = new URLSearchParams(window.location.search);
            const potId  = params.get("pot");
            const handle = params.get("profile");

            if (potId) {
                /* Land on gallery → EVERYONE (internal key "public",
                   UI label "EVERYONE") so closing the modal reveals
                   the public grid (encourages browsing). */
                GALLERY.tab = "public";
                showScreen("gallery");
                fetchPublicPotById(potId).then(function (row) {
                    if (!row) {
                        clearPotURLParam();
                        return;
                    }
                    /* Enrich with profile (best-effort) so the
                       byline / author shows correctly. */
                    return enrichWithProfiles([row]).then(function () {
                        const entry = normalizePublicRow(row);
                        openDetail(entry);
                    });
                }).catch(function () { clearPotURLParam(); });
                return;
            }

            if (handle) {
                PROFILE.previousScreen = "title";
                showScreen("profile");
                loadProfile(handle);
            }
        } catch (_) {}
    }

    /* ============================================================
       ACHIEVEMENTS — Day 4 chunk C
       ============================================================
       Local-only meta progression. Each achievement has a check
       function that reads gallery state + egg flags and returns
       true once the player has earned it. Unlocked ids are
       persisted to localStorage "crayte-achievements". Some
       achievements unlock content (REWARDS_PACK stamps, the
       hidden VOID clay) — see grantReward().
       ============================================================ */

    const ACH_KEY = "crayte-achievements";

    const ACH_STATE = {
        /* Set of unlocked achievement ids; hydrated from localStorage
           on first scan. */
        unlocked: null
    };

    /* Reward pack — grows with unlocked stamps. Hidden from the
       decorate tabs until it has at least 1 pattern.            */
    const REWARDS_PACK = {
        id: "rewards",
        label: "TROPHY",
        glazes: ["#ffd24a", "#ff8c1a", "#ff2a8a", "#33ff66",
                 "#f4f6ea", "#1a0e08"],
        patterns: []
    };

    /* The secret 6th clay — locked behind MASTER_POTTER. Added to
       CLAY_TYPES at module init; buildClayPicker hides it until
       unlocked. */
    const VOID_CLAY = {
        id: "void",
        label: "VOID",
        flavor: "Obsidian black. Eldritch shimmer. (unlocked)",
        unfired: ["#000000", "#0a0a16", "#1a1030", "#241540",
                  "#100820", "#000000"],
        swatch: "#1a1030",
        firedTint: "rgba(180, 90, 220, 0.45)",
        outline:   "#000000",
        highlight: "rgba(220, 180, 255, 0.60)",
        unlockedBy: "master_potter"
    };
    CLAY_TYPES.push(VOID_CLAY);

    /* Hidden-until-unlocked reward stamp drawers (text via the
       existing textStamp helper). */
    PATTERN_DRAWERS["rookie"]  = function (ctx, x, y, r, c) {
        textStamp(ctx, x, y, r, c, "ROOKIE");
    };
    PATTERN_DRAWERS["boom"]    = function (ctx, x, y, r, c) {
        textStamp(ctx, x, y, r, c, "BOOM");
    };
    PATTERN_DRAWERS["toast"]   = function (ctx, x, y, r, c) {
        textStamp(ctx, x, y, r, c, "TOAST");
    };
    PATTERN_DRAWERS["hoarder"] = function (ctx, x, y, r, c) {
        textStamp(ctx, x, y, r, c, "WHO'S A HOARDER",
                  { fontSize: 0.26 });
    };
    PATTERN_DRAWERS["pack-master"] = function (ctx, x, y, r, c) {
        textStamp(ctx, x, y, r, c, "PACK MASTER");
    };

    const ACHIEVEMENTS = [
        {
            id: "first_pot",
            title: "FIRST POT",
            desc: "Fire your first pot.",
            icon: "★",
            grant: { stamp: "rookie" },
            check: function (s) { return s.firedCount >= 1; }
        },
        {
            id: "apprentice",
            title: "POTTERY APPRENTICE",
            desc: "Fire 5 pots.",
            icon: "♦",
            check: function (s) { return s.firedCount >= 5; }
        },
        {
            id: "master_potter",
            title: "MASTER POTTER",
            desc: "Fire 20 pots. Unlocks the VOID clay.",
            icon: "✪",
            grant: { unlocksClay: "void" },
            check: function (s) { return s.firedCount >= 20; }
        },
        {
            id: "pot_hoarder",
            title: "POT HOARDER",
            desc: "Stuff 50 pots into the vault.",
            icon: "▣",
            grant: { stamp: "hoarder" },
            check: function (s) { return s.firedCount >= 50; }
        },
        {
            id: "material_master",
            title: "MATERIAL MASTER",
            desc: "Fire a pot with every base clay (5).",
            icon: "◆",
            check: function (s) {
                /* Don't count VOID toward the requirement — it's
                   the reward, not the prerequisite. */
                const baseCount = CLAY_TYPES.filter(function (c) {
                    return !c.unlockedBy;
                }).length;
                return s.clayTypes.size >= baseCount;
            }
        },
        {
            id: "pack_pioneer",
            title: "PACK PIONEER",
            desc: "Decorate with every glaze pack (6).",
            icon: "✦",
            grant: { stamp: "pack-master" },
            check: function (s) { return s.packs.size >= 6; }
        },
        {
            id: "exploded",
            title: "EXPLODED!",
            desc: "Survive an exploding pot.",
            icon: "✸",
            grant: { stamp: "boom" },
            check: function (s) { return s.explodedCount >= 1; }
        },
        {
            id: "demolition",
            title: "DEMOLITION EXPERT",
            desc: "5 exploded pots. On purpose? probably.",
            icon: "✺",
            check: function (s) { return s.explodedCount >= 5; }
        },
        {
            id: "burnt_offering",
            title: "BURNT OFFERING",
            desc: "Overheat the kiln. Tap-tap-tap.",
            icon: "🔥",
            grant: { stamp: "toast" },
            check: function (s) { return s.overfiredCount >= 1; }
        },
        {
            id: "pingas",
            title: "PINGAS",
            desc: "You know what you did.",
            icon: "ᗒ",
            check: function () { return !!EGG.pingasUnlocked; }
        },
        {
            id: "konami_master",
            title: "KONAMI MASTER",
            desc: "↑↑↓↓←→←→BA. Unlocks DEV_MENU.",
            icon: "▲",
            check: function () { return !!EGG.konamiTriggered; }
        },
        {
            id: "overclocked",
            title: "OVERCLOCKED",
            desc: "RGB + a pixel pattern. Now you're modding.",
            icon: "⚡",
            check: function () { return !!EGG.overclocked; }
        },
        {
            id: "all_eggs",
            title: "ALL EGGS FOUND",
            desc: "Trigger every easter egg.",
            icon: "✶",
            check: function () {
                return EGG.pingasUnlocked && EGG.konamiTriggered &&
                       EGG.overheatTriggered && EGG.overclocked;
            }
        }
    ];

    function loadAchievements() {
        try {
            const raw = localStorage.getItem(ACH_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (_) { return new Set(); }
    }

    function saveAchievements() {
        if (!ACH_STATE.unlocked) return;
        try {
            localStorage.setItem(ACH_KEY,
                JSON.stringify(Array.from(ACH_STATE.unlocked)));
        } catch (_) {}
    }

    function ensureAchievements() {
        if (!ACH_STATE.unlocked) {
            ACH_STATE.unlocked = loadAchievements();
        }
    }

    function computeAchStats() {
        const entries = loadGalleryEntries();
        const clayTypes = new Set();
        const packs = new Set();
        let firedCount = 0;
        let explodedCount = 0;
        let overfiredCount = 0;
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e.fired) firedCount++;
            if (e.exploded) explodedCount++;
            if (e.overfired) overfiredCount++;
            if (e.clayTypeId) clayTypes.add(e.clayTypeId);
            if (e.packId)     packs.add(e.packId);
        }
        return {
            firedCount: firedCount,
            explodedCount: explodedCount,
            overfiredCount: overfiredCount,
            clayTypes: clayTypes,
            packs: packs
        };
    }

    function grantReward(grant) {
        if (!grant) return;
        if (grant.stamp) {
            /* Append to REWARDS_PACK if not already there */
            if (REWARDS_PACK.patterns.indexOf(grant.stamp) < 0) {
                REWARDS_PACK.patterns.push(grant.stamp);
            }
            /* Make sure the TROPHY pack is in GLAZE_PACKS once. */
            if (GLAZE_PACKS.indexOf(REWARDS_PACK) < 0) {
                GLAZE_PACKS.push(REWARDS_PACK);
            }
            /* If the decorate UI is currently mounted, rebuild
               so the new tab/stamp shows up. */
            if (currentScreen === "decorate" &&
                typeof buildToolUI === "function") {
                buildToolUI();
            }
        }
        /* unlocksClay is handled by buildClayPicker filtering on
           isClayUnlocked() — no list mutation needed here. */
    }

    function isClayUnlocked(c) {
        if (!c.unlockedBy) return true;
        ensureAchievements();
        return ACH_STATE.unlocked.has(c.unlockedBy);
    }

    /* Main entry point — called from anywhere an achievement
       might fire (after autoSaveFiredPot, on egg triggers, on
       entering the achievements screen). Scans for newly-met
       conditions and toasts each one.                          */
    function checkAchievements() {
        ensureAchievements();
        const stats = computeAchStats();
        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            if (ACH_STATE.unlocked.has(a.id)) continue;
            try {
                if (a.check(stats)) unlockAch(a);
            } catch (e) {
                console.warn("[CRAYte] ach check failed: " + a.id, e);
            }
        }
    }

    function unlockAch(a) {
        ACH_STATE.unlocked.add(a.id);
        saveAchievements();
        grantReward(a.grant);
        toastAch(a);
        /* Chain — a granted reward might satisfy another ach */
        if (a.grant) checkAchievements();
        /* Refresh the achievements screen if user is on it */
        if (currentScreen === "achievements") refreshAchievementsGrid();
        /* If we just unlocked VOID, rebuild the clay picker so it
           appears (if user is on shape screen). */
        if (a.grant && a.grant.unlocksClay) {
            buildClayPicker();
            buildLumpTray();
        }
    }

    function toastAch(a) {
        const t = document.getElementById("achToast");
        if (!t) return;
        const ic = document.getElementById("achToastIcon");
        const txt = document.getElementById("achToastText");
        if (ic) ic.textContent = a.icon || "★";
        /* Title only -- the "ACHIEVEMENT UNLOCKED" eyebrow is
           static in the markup. */
        if (txt) txt.textContent = a.title;
        t.hidden = false;
        /* clone+replace restarts the animation when a second
           unlock fires before the first slides out. */
        const fresh = t.cloneNode(true);
        t.parentNode.replaceChild(fresh, t);
        setTimeout(function () { fresh.hidden = true; }, 4800);
        playAchFanfare();
    }

    /* Three-note arpeggio in C major — bright, kid-friendly,
       distinguishable from the trophy fanfare (which is longer
       and heavier). ~0.6s total. */
    function playAchFanfare() {
        const ctx = typeof ensureAudio === "function" ? ensureAudio() : null;
        if (!ctx) return;
        const t0 = ctx.currentTime;
        [523.25, 659.25, 783.99].forEach(function (freq, i) {
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.value = freq;
            const offset = i * 0.10;
            g.gain.setValueAtTime(0, t0 + offset);
            g.gain.linearRampToValueAtTime(0.14, t0 + offset + 0.015);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.32);
            osc.connect(g).connect(ctx.destination);
            osc.start(t0 + offset);
            osc.stop(t0 + offset + 0.35);
        });
    }

    /* ============================================================
       EASTER EGGS — chunk 8
       ============================================================
       Konami code (title) -> DEV_MENU with cursed toggles.
       Type "PINGAS" anywhere -> Robotnik flash + PINGAS stamp
       unlocked in every pack for the rest of the session.
       Click the kiln 10x during firing -> OVERHEATS — glitch
       effect + the saved pot gets an "overfired" flag with an
       extra-crispy glaze overlay.
       Use @rgb-cycle + a GAMER pixel pattern in the same paint
       session -> OVERCLOCKED — toast + new MODDED stamp that
       draws a rainbow pixel-heart.
       ============================================================ */

    const EGG = {
        infiniteClay: false,
        sentientPot:  false,
        oneFrameFire: false,
        pingasUnlocked: false,
        overclocked:    false,
        overheatLoad:   0,    /* clicks on kiln canvas during firing */
        overheatTriggered: false,
        usedRgb:        false,
        usedGamerPixel: false
    };

    const GAMER_PIXEL_PATTERNS = {
        "pixel-heart": true,
        "pixel-skull": true,
        "cloud-8bit":  true
    };

    /* ----- 8X.A. Konami code (title screen) ----- */

    const KONAMI_SEQ = [
        "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
        "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
        "b", "a"
    ];
    let konamiIdx = 0;

    document.addEventListener("keydown", function (e) {
        /* Only count while on the title screen — otherwise arrow keys
           in inputs / other contexts would compete. */
        if (currentScreen !== "title") { konamiIdx = 0; return; }
        const key = (e.key.length === 1) ? e.key.toLowerCase() : e.key;
        if (key === KONAMI_SEQ[konamiIdx]) {
            konamiIdx++;
            if (konamiIdx === KONAMI_SEQ.length) {
                konamiIdx = 0;
                openDevMenu();
            }
        } else {
            /* Allow restarting from the head if the user just struck
               the first key again. */
            konamiIdx = (key === KONAMI_SEQ[0]) ? 1 : 0;
        }
    });

    function openDevMenu() {
        const panel = document.getElementById("devMenu");
        if (!panel) return;
        panel.hidden = false;
        /* sync checkboxes to current flag state */
        const sync = function (id, flag) {
            const el = document.getElementById(id);
            if (el) el.checked = !!EGG[flag];
        };
        sync("devInfiniteClay", "infiniteClay");
        sync("devSentientPot",  "sentientPot");
        sync("devOneFrameFire", "oneFrameFire");
        poot(); poot();   /* victory chord */
        EGG.konamiTriggered = true;
        checkAchievements();
    }

    function closeDevMenu() {
        const panel = document.getElementById("devMenu");
        if (panel) panel.hidden = true;
    }

    function wireDevMenu() {
        const close = document.getElementById("devClose");
        if (close) close.addEventListener("click", closeDevMenu);
        const panel = document.getElementById("devMenu");
        if (panel) panel.addEventListener("click", function (e) {
            if (e.target === panel) closeDevMenu();
        });
        const ic = document.getElementById("devInfiniteClay");
        const sp = document.getElementById("devSentientPot");
        const of = document.getElementById("devOneFrameFire");
        if (ic) ic.addEventListener("change", function () {
            EGG.infiniteClay = ic.checked;
        });
        if (sp) sp.addEventListener("change", function () {
            EGG.sentientPot = sp.checked;
        });
        if (of) of.addEventListener("change", function () {
            EGG.oneFrameFire = of.checked;
        });
    }

    /* ----- 8X.B. PINGAS ----- */

    const PINGAS_SEQ = ["p","i","n","g","a","s"];
    let pingasIdx = 0;

    document.addEventListener("keydown", function (e) {
        /* Don't capture when typing in the gallery name input. */
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
            pingasIdx = 0;
            return;
        }
        const k = (e.key || "").toLowerCase();
        if (k === PINGAS_SEQ[pingasIdx]) {
            pingasIdx++;
            if (pingasIdx === PINGAS_SEQ.length) {
                pingasIdx = 0;
                firePingas();
            }
        } else {
            pingasIdx = (k === PINGAS_SEQ[0]) ? 1 : 0;
        }
    });

    function firePingas() {
        /* Flash overlay */
        const flash = document.getElementById("pingasFlash");
        if (flash) {
            flash.hidden = false;
            /* Restart the animation by removing+re-adding the element */
            const fresh = flash.cloneNode(true);
            flash.parentNode.replaceChild(fresh, flash);
            setTimeout(function () { fresh.hidden = true; }, 1200);
        }
        /* Unlock the PINGAS stamp in every pack (once). */
        if (!EGG.pingasUnlocked) {
            EGG.pingasUnlocked = true;
            for (let i = 0; i < GLAZE_PACKS.length; i++) {
                if (GLAZE_PACKS[i].patterns.indexOf("pingas") < 0) {
                    GLAZE_PACKS[i].patterns.push("pingas");
                }
            }
            /* Rebuild the palette if we're already on decorate. */
            if (currentScreen === "decorate" && typeof buildToolUI === "function") {
                buildToolUI();
            }
        }
        poot();
        checkAchievements();
    }

    /* PINGAS stamp drawer — text framed in the chunky style. */
    PATTERN_DRAWERS["pingas"] = function (ctx, x, y, r, c) {
        textStamp(ctx, x, y, r, c, "PINGAS", { fontSize: 0.42 });
    };

    /* ----- 8X.C. Kiln overheat ----- */

    function wireKilnOverheat() {
        const c = document.getElementById("kilnCanvas");
        if (!c) return;
        c.addEventListener("click", function () {
            if (KILN.state !== "firing") return;
            if (EGG.overheatTriggered) return;
            EGG.overheatLoad++;
            /* Tiny visual feedback — pulse the kiln LED phase */
            KILN.glowPhase += 4;
            if (EGG.overheatLoad >= 10) triggerOverheat();
        });
    }

    function triggerOverheat() {
        EGG.overheatTriggered = true;
        /* Freeze the crack-network seed once per overheat so the
           pattern stays put across frames + reads as the same
           pot in the gallery save. */
        EGG.overheatSeed = (Date.now() & 0x7fffffff) | 1;
        document.body.classList.add("kiln-overheat");
        /* Longer roar + extra crackle storm */
        kilnRoar(2.5);
        for (let i = 0; i < 14; i++) {
            setTimeout(kilnCrackle, i * 110 + Math.random() * 80);
        }
        haptic([60, 30, 80, 30, 120]);
        checkAchievements();
    }

    function clearOverheat() {
        EGG.overheatLoad = 0;
        EGG.overheatTriggered = false;
        document.body.classList.remove("kiln-overheat");
    }

    /* ----- 8X.D. OVERCLOCKED combo ----- */

    function noteGlazeUsed(glaze) {
        if (glaze === "@rgb-cycle") {
            EGG.usedRgb = true;
            checkOverclocked();
        }
    }

    function notePatternUsed(pat) {
        if (GAMER_PIXEL_PATTERNS[pat]) {
            EGG.usedGamerPixel = true;
            checkOverclocked();
        }
    }

    function checkOverclocked() {
        if (EGG.overclocked) return;
        if (!(EGG.usedRgb && EGG.usedGamerPixel)) return;
        EGG.overclocked = true;
        /* Unlock the OVERCLOCKED stamp in MODDED */
        for (let i = 0; i < GLAZE_PACKS.length; i++) {
            if (GLAZE_PACKS[i].id === "modded") {
                if (GLAZE_PACKS[i].patterns.indexOf("overclocked") < 0) {
                    GLAZE_PACKS[i].patterns.push("overclocked");
                }
            }
        }
        if (currentScreen === "decorate" && typeof buildToolUI === "function") {
            buildToolUI();
        }
        showOverclockedToast();
        /* triple-ding for ceremony */
        kilnDing();
        checkAchievements();
    }

    function showOverclockedToast() {
        const t = document.getElementById("overclockedToast");
        if (!t) return;
        t.hidden = false;
        /* Restart the animation chain */
        const fresh = t.cloneNode(true);
        t.parentNode.replaceChild(fresh, t);
        setTimeout(function () { fresh.hidden = true; }, 4500);
    }

    /* OVERCLOCKED stamp — multi-color pixel heart that captures
       a different RGB hue per cell so each stamp is its own
       rainbow.                                                  */
    PATTERN_DRAWERS["overclocked"] = function (ctx, x, y, r, c) {
        const cell = r * 0.18;
        const grid = [
            [0,1,1,0,1,1,0],
            [1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1],
            [0,1,1,1,1,1,0],
            [0,0,1,1,1,0,0],
            [0,0,0,1,0,0,0]
        ];
        const rows = grid.length;
        const cols = grid[0].length;
        const ox = x - (cols * cell) / 2;
        const oy = y - (rows * cell) / 2;
        const baseHue = (performance.now() * 0.4) % 360;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (!grid[row][col]) continue;
                const h = (baseHue + (row + col) * 25) % 360;
                ctx.fillStyle = "hsl(" + h.toFixed(0) + ", 95%, 60%)";
                ctx.fillRect(ox + col * cell, oy + row * cell, cell, cell);
            }
        }
    };

    /* ----- 8X.E. Hook noteGlazeUsed / notePatternUsed into paint -----
       The actual hooks live inside paintDot / stampAt — they call
       these note* functions every time a glaze or pattern is
       actually used. The function exports here let the hooks find
       them via closure. */

    /* Override paint funcs to track usage. Re-define paintDot /
       paintStrokeTo / stampAt isn't worth the indirection — we
       can just wire from inside them via the closure variables.
       But those funcs are defined above. So we add wrappers via
       window-level interception. Cleanest: re-export the funcs
       once they're declared elsewhere via window.CRAYte.        */

    /* Helpful: small hook to ensure dev menu is wired and overheat
       click listener is attached once. Runs from init().         */
    function initEggs() {
        wireDevMenu();
        wireKilnOverheat();
    }

    /* ---------- 9. INIT (must run after all registerScreen calls) ---------- */

    /* Bottom-sheet drawer wiring (phone only). The .drawer-handle
       inside each side-rail toggles .is-open. Tapping the canvas
       auto-collapses any open drawer so the user can paint /
       shape without first dismissing it. */
    function wireDrawerHandles() {
        document.querySelectorAll(".drawer-handle").forEach(function (h) {
            h.addEventListener("click", function () {
                const rail = h.parentElement;
                if (!rail) return;
                const open = rail.classList.toggle("is-open");
                h.setAttribute("aria-expanded", open ? "true" : "false");
                h.setAttribute("aria-label",
                    open ? "Hide tools" : "Show tools");
            });
        });

        function collapseOpenDrawers() {
            document.querySelectorAll(
                ".shape-side-rail.is-open, .decorate-side-rail.is-open"
            ).forEach(function (rail) {
                rail.classList.remove("is-open");
                const h = rail.querySelector(".drawer-handle");
                if (h) {
                    h.setAttribute("aria-expanded", "false");
                    h.setAttribute("aria-label", "Show tools");
                }
            });
        }

        ["shapeCanvas", "decorateCanvas"].forEach(function (id) {
            const c = document.getElementById(id);
            if (c) c.addEventListener("pointerdown", collapseOpenDrawers);
        });
    }

    function init() {
        initTitle();
        initEggs();
        showScreen("title");
        wireDrawerHandles();
        wireHardwareBack();
        initPushOptInModal();
        /* Phase 1: kick off auth boot AFTER the title is mounted
           so the user sees something immediately. The auth
           round-trip is async (esp. on the callback hash path,
           which fetches /user) and notifies via onAuthChange
           listeners when ready — no blocking. Once auth resolves,
           honor any ?profile=<handle> deep-link in the URL. */
        /* ?adopt=<battleId>:<entryId>,... -- backfill a device's
           crayte-my-battle-entries so trophies on existing battle
           submissions can reveal. Pre-trophy-code entries don't
           have the localStorage link, so this URL is the way to
           recover them on phones / tablets without dev tools. */
        adoptFromURL();
        initAuth().then(checkURLDeepLinks);
        /* Trophy reveal -- runs in parallel with auth boot.
           Doesn't need a session (uses crayte-my-battle-entries
           from localStorage) so anonymous players still see
           their wins.                                          */
        setTimeout(checkTrophyReveals, 600);
        wireTrophyRevealModal();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    /* ---------- 10. EXPORT ----------
       A tiny window namespace so chunks 2+ can register screens
       without rewriting this file. Strictly internal.            */
    window.CRAYte = {
        registerScreen: registerScreen,
        showScreen: function (id) { showScreen(id); },
        get currentScreen() { return currentScreen; },
        /* Pure helpers exposed for verification + admin tinkering.
           Internal callers should still use the in-module names. */
        _trophy: {
            computePlacements: computePlacements,
            entryTier:         entryTier,
            tierName:          trophyNameForTier,
            TIERS:             TROPHY_TIERS
        },
        /* Live read-outs for tuning the shape physics. Useful in
           the preview console; harmless in prod. */
        _shape: {
            get wheelSpeedFactor() { return SHAPE.wheelSpeedFactor; },
            get pointerActive()    { return SHAPE.pointerActive; },
            get pointer()          { return SHAPE.pointer; },
            get running()          { return SHAPE.running; },
            get wheelPhase()       { return SHAPE.wheelPhase; },
            get EASE()             { return SHAPE.EASE; },
            get WHEEL_SLOW_FACTOR() { return SHAPE.WHEEL_SLOW_FACTOR; }
        }
    };

})();
