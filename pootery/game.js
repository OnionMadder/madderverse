/* ============================================================
   Pootery — main script
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

    /* Compose a single flat dataURL combining the entry's surface
       texture skin + brush layer + sticker records. Used for
       public uploads (public_pots + battle_entries) because the
       server schema has only paint_data_url — no columns for the
       v1.1 additions (vector stickers, surfaceTexturePackId).
       Without this composite the EVERYONE gallery + battle cards
       render shared pots missing their texture skin AND stamps.

       Layer order matches the live render (bottom -> top):
         1. surface texture skin (the TEXTURE button's pack skin)
         2. brush / spray / splat paint
         3. stickers
       The whole thing is drawn clipped-to-pot at render time
       (renderSavedPot clips _paintImg), so we don't clip here.

       Returns a Promise<string|null>. Resolves to the original
       paintDataUrl unchanged when there's nothing extra to bake
       (legacy entries already have everything in one image). */
    function composePublicPaintDataUrl(entry) {
        return new Promise(function (resolve) {
            if (!entry) return resolve(null);
            const hasStickers = Array.isArray(entry.stickers) &&
                                entry.stickers.length > 0;
            const hasSurface  = !!entry.surfaceTexturePackId;
            if (!hasStickers && !hasSurface) {
                /* Nothing to add — keep the existing image. */
                return resolve(entry.paintDataUrl || null);
            }
            const w = SHAPE.W, h = SHAPE.H;
            const tmp = document.createElement("canvas");
            tmp.width = w; tmp.height = h;
            const ctx = tmp.getContext("2d");

            /* ---- Layer 1: surface texture skin (bottom) ----
               surfaceTexturePackId holds the texture FILE id now
               (old saves stored a pack id == the base texture file). */
            if (hasSurface) {
                const pat = getSurfacePattern(ctx, entry.surfaceTexturePackId);
                if (pat) {
                    ctx.save();
                    ctx.globalAlpha =          /* matches paintSurfaceTexture */
                        surfaceTextureAlpha(entry.surfaceTexturePackId);
                    ctx.fillStyle = pat;
                    ctx.fillRect(0, 0, w, h);
                    ctx.restore();
                }
            }

            const finish = function () {
                /* ---- Layer 3: stickers (top) ---- via shared
                   drawSticker so rotation + flipH bake in
                   identically to the live render path. */
                if (hasStickers) {
                    for (let i = 0; i < entry.stickers.length; i++) {
                        drawSticker(ctx, entry.stickers[i]);
                    }
                }
                try { resolve(tmp.toDataURL("image/png")); }
                catch (_) { resolve(entry.paintDataUrl || null); }
            };

            /* ---- Layer 2: brush paint (middle) ---- */
            if (entry.paintDataUrl) {
                const img = new Image();
                img.onload  = function () {
                    ctx.drawImage(img, 0, 0, w, h);
                    finish();
                };
                img.onerror = finish;   /* still composite the rest */
                img.src = entry.paintDataUrl;
            } else {
                finish();
            }
        });
    }

    /* Common public-pot fields shared by the recipe + baked tiers.
       Excludes the image + the v1.1 recipe columns (those differ
       per tier). */
    function publicPotCommonBody(entry, author) {
        const b = {
            name:         entry.name || "UNNAMED POT",
            author:       (author || "anonymous").slice(0, 40),
            pack_id:      entry.packId     || null,
            clay_type_id: entry.clayTypeId || null,
            fired:        !!entry.fired,
            overfired:    !!entry.overfired,
            exploded:     !!entry.exploded,
            clay:         entry.clay       || null,
            /* Phase 1 chunk 1d: tag the pot with the signed-in
               user's id if any. Anon submits leave this NULL. */
            user_id:      currentUserId()
        };
        if (entry.remixedFrom) {
            b.remixed_from        = entry.remixedFrom;
            b.remixed_from_author = entry.remixedFromAuthor || "anonymous";
        }
        return b;
    }

    function rawPostPot(url, body) {
        return fetch(url, {
            method: "POST",
            headers: supabaseHeaders({
                "Content-Type": "application/json",
                "Prefer":       "return=representation"
            }),
            body: JSON.stringify(body)
        }).then(function (r) {
            if (!r.ok) return null;
            return r.json().then(function (rows) {
                return Array.isArray(rows) && rows[0] ? rows[0] : null;
            });
        }).catch(function () { return null; });
    }

    /* Submit one local pot to the public gallery. Returns the
       inserted row (with .id and .created_at) on success, null
       on failure.

       Two-tier "recipe first, bake on fallback" strategy:
         TIER 1 stores the recipe — brush-only paint_data_url +
           surface_texture_pack_id + stickers (jsonb) in their own
           columns. Public pots then render through the SAME live
           pipeline as local pots: texture lit correctly, stickers
           spin in the detail view. Requires SUPABASE_POTS_V11.sql.
         TIER 2 (columns missing → tier 1 returns null) bakes the
           texture + stickers flat into paint_data_url and drops
           the new columns, routing through submitWithRemixFallback
           for remix-column compatibility too. Keeps sharing
           working BEFORE the migration runs — it just renders
           flat (the pre-v1.1 behavior). */
    function submitPublicPot(entry, author) {
        if (!supabaseEnabled()) return Promise.resolve(null);
        const url = SUPABASE_URL + "/rest/v1/public_pots";

        const recipe = Object.assign(publicPotCommonBody(entry, author), {
            paint_data_url:          entry.paintDataUrl || null,
            surface_texture_pack_id: entry.surfaceTexturePackId || null,
            stickers: (entry.stickers && entry.stickers.length)
                ? entry.stickers : null
        });

        return rawPostPot(url, recipe).then(function (row) {
            if (row) return row;
            /* Tier 2 — bake + drop the v1.1 columns. */
            return composePublicPaintDataUrl(entry).then(function (flat) {
                const baked = Object.assign(publicPotCommonBody(entry, author), {
                    paint_data_url: flat || null
                });
                return submitWithRemixFallback(url, baked);
            });
        });
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
        const url = SUPABASE_URL + "/rest/v1/battle_entries";

        function commonBody() {
            return {
                battle_id:    battleId,
                name:         entry.name || "UNNAMED",
                author:       (author || "anonymous").slice(0, 40),
                pack_id:      entry.packId     || null,
                clay_type_id: entry.clayTypeId || null,
                fired:        !!entry.fired,
                overfired:    !!entry.overfired,
                exploded:     !!entry.exploded,
                clay:         entry.clay       || null,
                user_id:      currentUserId()
            };
        }

        /* Same recipe-first / bake-fallback strategy as
           submitPublicPot — store the texture id + sticker
           records in their own columns when SUPABASE_POTS_V11.sql
           has run (so battle cards render lit + spinnable), else
           bake everything flat into paint_data_url. */
        const recipe = Object.assign(commonBody(), {
            paint_data_url:          entry.paintDataUrl || null,
            surface_texture_pack_id: entry.surfaceTexturePackId || null,
            stickers: (entry.stickers && entry.stickers.length)
                ? entry.stickers : null
        });

        return rawPostPot(url, recipe).then(function (row) {
            if (row) return row;
            return composePublicPaintDataUrl(entry).then(function (flat) {
                const baked = Object.assign(commonBody(), {
                    paint_data_url: flat || null
                });
                return rawPostPot(url, baked);
            });
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
                    /* Return the element (not just true) so a caller that
                       needs to track the actual playback — e.g. the kiln
                       sequence syncing its visual window to the clip — can
                       read duration / hook "ended". Still truthy, so
                       boolean-only callers are unaffected. */
                    return pick;
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
        const el = KILN_SFX.sequence && KILN_SFX.sequence.play(1.0);
        if (el) { syncFiringWindowToClip(el); return; }
        if (typeof kilnRoar === "function") kilnRoar(durationSec);
    }

    /* Lock the firing VISUAL to the clip that is actually playing.
       The module-eval probe (syncFiringWindowToAudio) reads duration
       off a preload="metadata" element, which is unreliable in the
       Android WebView — metadata often never resolves there, so on the
       packaged app KILN_DUR.firing stayed at the 5000ms default while
       the real clip is shorter, and the animation outlasted the sound
       (desktop was fine because the probe resolves there). The pool's
       elements are preload="auto", so the one we just started has a
       valid duration; read it here, and also end firing on the clip's
       own "ended" event so the visual can never run past the audio on
       any platform. */
    function syncFiringWindowToClip(el) {
        function applyDur() {
            const ms = Math.floor((el.duration || 0) * 1000);
            if (ms > 500 && ms < 9000) KILN_DUR.firing = ms;
        }
        if (el.duration && isFinite(el.duration)) applyDur();
        else {
            el.addEventListener("loadedmetadata", applyDur, { once: true });
            el.addEventListener("durationchange", applyDur, { once: true });
        }
        el.addEventListener("ended", function () {
            /* Only the normal (non-explode) firing path is still in
               "firing" when the clip ends; a kaboom already advanced. */
            if (KILN.state === "firing") kilnAdvance();
        }, { once: true });
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

    /* Screens that survive a refresh. Listed here so a tab the
       user is browsing (battles, gallery, etc.) doesn't bounce
       back to title when they pull-to-refresh. Mid-pot screens
       (shape, decorate, kiln) are intentionally NOT here because
       the live D/SHAPE state would be lost on reload anyway and
       the user's safer landing point in that case is the title
       with their draft saved in gallery. */
    const PERSISTENT_SCREENS = {
        battles:  true,
        gallery:  true,
        stats:    true,
        shop:     true,
        account:  true,
        profile:  true,
        trophies: true
    };

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

        /* Persist the screen choice in the URL so a refresh on
           battles / gallery / etc. doesn't dump the user back
           on the title. Title itself clears the param so the
           bare URL stays clean. */
        try {
            const url = new URL(window.location.href);
            if (PERSISTENT_SCREENS[id]) {
                url.searchParams.set("screen", id);
            } else {
                url.searchParams.delete("screen");
            }
            history.replaceState(null, "", url.toString());
        } catch (_) {}

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

        /* Match the vault's "display cabinet" look: render the pot on
           a TRANSPARENT canvas (no baked wheel/background) so the CSS
           display niche + steel shelf on .featured-thumb show through,
           exactly like #screen-gallery .pot-thumb. */
        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry, { background: false, wheel: false });
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
        },
        /* ============================================================
           BONUS CLAY BODIES. Free, ungated, appended so the original
           five keep their positions in the tray.

           `bonus: true` keeps them OUT of the MATERIAL MASTER
           achievement's requirement — that counts base clays
           dynamically, so without this flag adding four bodies would
           quietly turn "fire a pot with every base clay (5)" into a
           nine-clay grind still labelled 5. Adding content must never
           inflate a completion requirement.

           These fill the gaps in the existing palette rather than
           crowding it: EARTH is red, STONE a warm grey, and nothing
           was gold, blue-grey, pink or green. Worth having now that
           the form pass shades by local radius — a clay body finally
           reads as its own material instead of the same gradient in a
           different hue.                                            */
        {
            id: "ochre",
            label: "OCHRE",
            flavor: "Golden earth. Fancy without trying.",
            unfired: ["#2e1e05", "#5c3d0d", "#a87b1e", "#c69a2e",
                      "#7d5714", "#2e1e05"],
            swatch: "#a87b1e",
            firedTint: "rgba(200, 150, 40, 0.22)",
            outline:   "#1d1203",
            highlight: "rgba(255, 240, 190, 0.36)",
            bonus: true
        },
        {
            id: "slate",
            label: "SLATE",
            flavor: "Cool blue-grey. Very architect.",
            unfired: ["#12181c", "#2c3a44", "#56707e", "#647f8d",
                      "#3a4c58", "#12181c"],
            swatch: "#56707e",
            firedTint: "rgba(90, 120, 140, 0.20)",
            outline:   "#0c1114",
            highlight: "rgba(225, 240, 255, 0.38)",
            bonus: true
        },
        {
            id: "blush",
            label: "BLUSH",
            flavor: "Soft pink clay. Yes, really.",
            unfired: ["#33141a", "#6b2f3a", "#c07f88", "#d4959c",
                      "#8d4a55", "#33141a"],
            swatch: "#c07f88",
            firedTint: "rgba(215, 130, 145, 0.20)",
            outline:   "#240d12",
            highlight: "rgba(255, 230, 235, 0.40)",
            bonus: true
        },
        {
            id: "moss",
            label: "MOSS",
            flavor: "Green clay. Smells like a forest.",
            unfired: ["#131c10", "#2c3f26", "#5b7a4c", "#6b8c59",
                      "#3d5434", "#131c10"],
            swatch: "#5b7a4c",
            firedTint: "rgba(110, 150, 80, 0.20)",
            outline:   "#0d140b",
            highlight: "rgba(235, 250, 215, 0.34)",
            bonus: true
        }
    ];

    function currentClay() {
        for (let i = 0; i < CLAY_TYPES.length; i++) {
            if (CLAY_TYPES[i].id === SHAPE.clayTypeId) return CLAY_TYPES[i];
        }
        return CLAY_TYPES[0];
    }

    /* Push a clay's colours onto a DOM element as CSS custom
       properties so the picker discs + lump balls build their clay
       surface entirely in CSS (see .clay-disc / .lump-ball) — no more
       baked PNG texture tiles. `unfired` runs dark→light→dark, so
       [3] is the highlight and [1] the shadow. */
    function setClaySurfaceVars(el, mat) {
        const u = mat.unfired || [];
        el.style.setProperty("--lump-color", mat.swatch);
        el.style.setProperty("--clay-hi", u[3] || mat.swatch);
        el.style.setProperty("--clay-lo", u[1] || mat.swatch);
    }

    /* ============================================================
       CLAY TEXTURES — generated procedurally (no PNGs to ship)
       ============================================================
       Six 128x128 seamless tiles, one per clay type, built in a
       canvas from the same seeded-noise system as the surface skins
       below (stRng / stMottle / stFiber / stSparkle + the per-pixel
       grain loop). Each is applied on top of the linear gradient
       fill via a soft-light composite so the existing global shading
       (the cross-pot gradient + highlight strip + throwing rings)
       still reads clearly, but the surface picks up grit / specks /
       cloudy mottle that flat color can't sell.

       Built lazily on first use (well after the st* helpers below are
       defined) and cached; the per-(ctx,clayId) Pattern is cached the
       first time it paints, so there's no per-frame allocation in the
       render hot path. void is the MASTER_POTTER unlock clay; its tile
       builds on demand like the rest. */
    const CLAY_SIZE = 128;
    const CLAY_TEXTURE_RECIPES = {
        earthenware: { base: "#a8502a", style: "mottle", blobs: 14, grain: 13, grit: 0.03 },
        porcelain:   { base: "#e9e6df", style: "grit",   grain: 8,  grit: 0.11 },
        stoneware:   { base: "#877a67", style: "mottle", blobs: 14, grain: 12, grit: 0.04 },
        basalt:      { base: "#1f1f22", style: "grit",   grain: 10, grit: 0.02, speckLight: true },
        galaxy:      { base: "#24386a", style: "mottle", blobs: 12, grain: 9 },
        void:        { base: "#4c2a7e", style: "mottle", blobs: 12, grain: 12 }
    };
    const CLAY_TEXTURE_CACHE = Object.create(null);     /* matId -> {canvas,url} */
    const CLAY_PATTERN_CACHE = new WeakMap();           /* ctx -> {matId:Pattern} */

    /* Same construction as buildSurfaceTexture (base fill -> per-pixel
       grain -> one style pass), seeded per clay id so it's stable. */
    function buildClayTexture(matId) {
        const rec = CLAY_TEXTURE_RECIPES[matId];
        const W = CLAY_SIZE, H = CLAY_SIZE;
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d");
        const rng = stRng(stHash("clay-" + matId));
        ctx.fillStyle = rec.base;
        ctx.fillRect(0, 0, W, H);
        const gr = rec.grain == null ? 16 : rec.grain;
        const grit = rec.grit || 0, speckSign = rec.speckLight ? 1 : -1;
        const img = ctx.getImageData(0, 0, W, H), d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            let j = (rng() * 2 - 1) * gr;
            if (grit && rng() < grit) j += speckSign * (28 + rng() * 42);
            d[i]     = Math.max(0, Math.min(255, d[i]     + j));
            d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + j));
            d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + j));
        }
        ctx.putImageData(img, 0, 0);
        if (rec.style === "mottle")       stMottle(ctx, W, H, rng, rec);
        else if (rec.style === "fiber")   stFiber(ctx, W, H, rng, rec);
        else if (rec.style === "sparkle") stSparkle(ctx, W, H, rng, rec);
        return cv;
    }
    function getClayTexture(matId) {
        if (!CLAY_TEXTURE_RECIPES[matId]) return null;
        let e = CLAY_TEXTURE_CACHE[matId];
        if (!e) { e = { canvas: buildClayTexture(matId), url: null }; CLAY_TEXTURE_CACHE[matId] = e; }
        return e;
    }

    /* CSS-side helper: a data-URL of the generated tile (or "" if the
       clay has no texture) so the drag-a-lump balls + clay-picker discs
       show the same grain as the rendered pot, not a flat swatch color. */
    function clayTextureUrl(matId) {
        const e = getClayTexture(matId);
        if (!e) return "";
        if (!e.url) e.url = e.canvas.toDataURL("image/png");
        return e.url;
    }

    function getClayPattern(ctx, matId) {
        if (!ctx) return null;
        let cache = CLAY_PATTERN_CACHE.get(ctx);
        if (!cache) {
            cache = Object.create(null);
            CLAY_PATTERN_CACHE.set(ctx, cache);
        }
        if (cache[matId]) return cache[matId];
        const e = getClayTexture(matId);
        if (!e) return null;
        try {
            const pat = ctx.createPattern(e.canvas, "repeat");
            cache[matId] = pat;
            return pat;
        } catch (err) {
            return null;
        }
    }

    /* Paint the clay's surface texture over the gradient fill.
       Caller must have already built the pot path + filled it
       with the gradient. We clip to the path, lay the pattern
       in via soft-light + a faint color pass, then restore.

       The pattern scrolls horizontally in sync with the wheel's
       rotation phase so the surface appears to co-rotate with
       the platform instead of being a static skin (a static skin
       reads as "spinning the wrong way" because the eye picks
       relative motion against the moving wheel wedges). The
       scroll direction matches the existing highlight sweep
       (Math.sin(phase)*maxR*0.55 — rightward as phase grows).

       Decorate freezes the wheel, so we hold the pattern static
       there too. */
    /* SPIN-VIEW OVERRIDE
       When the gallery detail modal is drag-spinning the pot,
       it sets _viewSpinDx to the pixel offset both texture
       layers should scroll by. Texture painters honor this
       override INSTEAD of the wheel-phase calculation, so the
       drag drives the rotation directly. renderSavedPot sets
       it before painting + clears it after so other render
       paths are unaffected. null = use wheel phase as before. */
    let _viewSpinDx = null;

    /* DISPLAY WHEEL: gallery / saved-pot renders sit the finished
       pot on the perspective wood plinth (assets/img/display.png)
       instead of the spinning top-down wheel head used while
       sculpting. renderSavedPot flips this on before painting and
       restores it after, so the live shape phase keeps wheel.png.
       false = use the spinning wheel.png as before. */
    let _displayWheel = false;

    function paintClayTexture(ctx, mat, bounds) {
        if (!ctx || !mat) return;
        const pat = getClayPattern(ctx, mat.id);
        if (!pat) return;

        let dx = 0;
        if (_viewSpinDx != null &&
                typeof DOMMatrix === "function" &&
                typeof pat.setTransform === "function") {
            dx = _viewSpinDx;
            try { pat.setTransform(new DOMMatrix().translateSelf(dx, 0)); }
            catch (_) { dx = 0; }
        } else if (currentScreen === "shape" &&
                typeof DOMMatrix === "function" &&
                typeof pat.setTransform === "function") {
            /* Only scroll the surface texture while the wheel is
               actively spinning. Decorate freezes the wheel; kiln
               has the pot locked inside a closed oven — neither
               should look like a rotating cylinder.
               maxR derived from the bounds the caller passed in
               (bounds.w ~ 2*maxR + 8). Scrolling one circumference
               per revolution would be 2π·maxR; we slow it to
               ~maxR·0.55 per radian which visually matches the
               highlight's amplitude and reads as natural rotation. */
            const visibleRadius = bounds.w * 0.5 - 4;
            dx = SHAPE.wheelPhase * visibleRadius * 0.55;
            try { pat.setTransform(new DOMMatrix().translateSelf(dx, 0)); }
            catch (_) { dx = 0; }
        } else if (typeof pat.setTransform === "function") {
            /* Reset any prior transform left over from shape so a
               decorate / kiln render isn't seeded with stale dx. */
            try { pat.setTransform(new DOMMatrix()); } catch (_) {}
        }

        ctx.save();
        buildPotPath(ctx);
        ctx.clip();
        /* soft-light keeps the gradient's color + lighting intact
           and just adds the texture's value variation. multiply
           darkens too aggressively; source-over with reduced
           alpha flattens the gradient. */
        ctx.globalCompositeOperation = "soft-light";
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = pat;
        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        /* A faint source-over pass re-introduces the texture's
           color so porcelain reads chalkier, basalt mattier. */
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.22;
        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.restore();
    }

    /* ============================================================
       SURFACE TEXTURES — one per asset pack, applied via the
       TEXTURE button in decorate.
       ============================================================
       Different concept from clay textures above. Clay textures
       are part of the pot's BODY (always on, soft-light over the
       gradient). Surface textures are a kid-controlled SKIN
       applied during decorate as a one-tap toggle — e.g., tap
       TEXTURE on the PLUSH pack and the pot looks like fur.

       Each pack with textures has surfaceTextures: ["<file>", ...]
       in GLAZE_PACKS (up to 3 skins). The files live at
       assets/textures/<n>.png (same folder as clay textures —
       all tilable PNGs).

       D.surfaceTexturePackId tracks the applied skin. NOTE: despite
       the historical name, it now holds the specific TEXTURE FILE id
       (e.g., "candy-lemon"), not a pack id. Old saved pots stored a
       pack id, which equals each pack's base texture filename, so
       they still resolve to that pack's first skin. Null = no skin.
       Persisted on the saved pot's entry + surface_texture_pack_id
       column (column name kept for back-compat).

       Render: painted INSIDE the pot-path clip, AFTER the user's
       paint canvas (so the kid's glaze/stickers can still influence
       what bleeds through), BEFORE the fired overlay + rim. Uses
       source-over at 0.92 alpha so it reads as a skin replacing
       the clay color (with a hint of underlying paint peeking
       through at high-contrast spots).
       ============================================================ */
    /* Surface skins are generated procedurally (see the PROCEDURAL
       block below) — no image map, just the per-ctx pattern cache. */
    const SURFACE_PATTERN_CACHE = new WeakMap();           /* ctx -> {fileId:Pattern} */

    /* Per-texture render flags, keyed by texture FILE id. The default
       (a texture NOT listed here) is the original opaque-skin behavior:
       painted at 0.92 alpha so it reads as a solid color replacing the
       clay. Setting translucent:true opts a texture into the "let the
       PNG's own alpha decide" path — we paint at full alpha so a half-
       transparent PNG (e.g. a 50%-alpha purple) only covers the clay by
       its authored amount, and the clay tint (terracotta, porcelain,
       basalt, ...) shows through. This is what unlocks looks like the
       "atomic purple Gameboy" stained-plastic shell, frosted acrylic,
       gauze, oil slick, stained glass, etc.

       Authoring a translucent texture (see commit body for the full
       note): export a 128x128 (or 256x256) seamless RGBA PNG that
       actually carries an alpha channel — partial-alpha pixels are the
       whole point, so do NOT flatten to JPG or strip alpha on export.
       Drop it in assets/textures/<id>.png, add it to a pack's
       surfaceTextures array, and list its id here with translucent:true. */
    const SURFACE_TEXTURE_FLAGS = {
        /* List a texture id here with translucent:true to let its PNG
           alpha show the clay through (frosted/stained-plastic look).
           Default (unlisted) = opaque skin at 0.92 alpha. */
    };
    function isTranslucentTexture(id) {
        const f = id && SURFACE_TEXTURE_FLAGS[id];
        return !!(f && f.translucent);
    }
    /* Alpha to paint a given texture at: translucent textures honor
       their PNG alpha (paint at 1.0), opaque skins keep the 0.92 clamp. */
    function surfaceTextureAlpha(id) {
        return isTranslucentTexture(id) ? 1 : 0.92;
    }

    /* ============================================================
       PROCEDURAL surface textures (no image files shipped).
       ============================================================
       The pack skins used to be ~36 uploaded PNGs (~870 KB). They
       are now generated on-device as seamless, tileable clay grains
       — one recipe per texture FILE id (a tint pulled from the
       pack's own palette + a grain STYLE). This keeps every pack's
       "3 textures" while shipping zero texture bytes.

       Each id maps to { base, style, ... }. Styles:
         grit    — fine clay speckle (per-pixel; inherently seamless)
         mottle  — soft cloudy blotches (crater/slime/scale look)
         fiber   — short soft strokes (fur / feathers / brushed metal)
         sparkle — dark base + star pinpoints + faint glows (cosmic)
       Low-frequency features are drawn with ±tile wrap copies so the
       128² tile repeats without a visible seam. Grain is seeded off
       the id, so a given skin looks the same every time it renders. */
    const ST_SIZE = 128;
    const SURFACE_TEXTURE_CACHE = Object.create(null);   /* id -> {canvas,url} */
    const SURFACE_TEXTURE_RECIPES = {
        /* BASIC */
        "basic":                         { base: "#b06a3a", style: "grit",    grit: 0.05 },
        "basic-feathers":                { base: "#6f9a68", style: "fiber" },
        "basic-pattern":                 { base: "#d9a94a", style: "mottle" },
        /* CANDY */
        "candy":                         { base: "#d64b57", style: "grit",    grit: 0.14, speckLight: true },
        "candy-chocolate":               { base: "#5a3418", style: "grit",    grit: 0.06 },
        "candy-lemon":                   { base: "#cfe04a", style: "grit",    grit: 0.14, speckLight: true },
        /* PLUSH (fur) */
        "builder/plushie":               { base: "#a07050", style: "fiber" },
        "builder/plushie-blue":          { base: "#b8d8ed", style: "fiber" },
        "builder/plushie-pink":          { base: "#ffc8e0", style: "fiber" },
        /* MODDED (tech) */
        "modded":                        { base: "#141414", style: "grit",    grit: 0.05, grain: 12 },
        "modded-aluminum":               { base: "#b8b8b8", style: "fiber",   fiberAngle: Math.PI / 2, fibers: 340 },
        "modded-led":                    { base: "#181818", style: "sparkle", glow: "60,255,120", stars: 40, glows: 8 },
        /* GAMER */
        "builder/gamer":                 { base: "#2f8f4a", style: "mottle" },
        "builder/gamer-black":           { base: "#2a3a3a", style: "grit",    grit: 0.05 },
        "builder/gamer-crt":             { base: "#5a2a8a", style: "mottle" },
        /* SPACE (cosmic) */
        "space":                         { base: "#07061a", style: "sparkle", glow: "150,120,255" },
        "space-galaxy":                  { base: "#3a1f55", style: "sparkle", glow: "210,120,255" },
        "space-blackhole":               { base: "#0a0818", style: "sparkle", glow: "90,120,255" },
        /* DINOSAUR (scales) */
        "builder/dinosaur":              { base: "#3f5d2a", style: "mottle" },
        "builder/dinosaur-blue":         { base: "#2b5f80", style: "mottle" },
        "builder/dinosaur-purpleorange": { base: "#6a3a7a", style: "mottle" },
        /* BREAKFAST */
        "breakfast-egg":                 { base: "#f3e6c8", style: "mottle" },
        "breakfast-pancake":             { base: "#cdb98a", style: "mottle" },
        "breakfast-strawberry":          { base: "#c84a3a", style: "grit",    grit: 0.12, speckLight: true },
        /* MUSIC */
        "music":                         { base: "#101010", style: "fiber",   fiberAngle: Math.PI / 2, fibers: 300, grain: 10 },
        "music-neon":                    { base: "#201025", style: "sparkle", glow: "255,60,160", stars: 30, glows: 9 },
        "music-vinyl":                   { base: "#1a1a1a", style: "fiber",   fiberAngle: Math.PI / 2, fibers: 340, grain: 10 },
        /* CHICKENS (feathers) */
        "chickens":                      { base: "#efe8d8", style: "fiber" },
        "chickens-clay":                 { base: "#6b4a2a", style: "grit",    grit: 0.06 },
        "chickens-skin":                 { base: "#e0982a", style: "mottle" },
        /* ALIENS (slime) */
        "aliens":                        { base: "#5fbf2a", style: "mottle" },
        "aliens-mars":                   { base: "#c8472e", style: "mottle" },
        "aliens-venus":                  { base: "#e6c15c", style: "mottle" },
        /* MOONS (cratered) */
        "literally-moons":               { base: "#cfc8b8", style: "mottle" },
        "literally-moons-sponge":        { base: "#8a6fc4", style: "mottle" },
        "literally-moons-stars":         { base: "#0a0a1f", style: "sparkle", glow: "200,200,255" }
    };

    function stHash(str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }
    function stRng(seed) {                 /* xorshift32 — deterministic per id */
        let s = seed >>> 0 || 1;
        return function () {
            s ^= s << 13; s >>>= 0;
            s ^= s >> 17;
            s ^= s << 5;  s >>>= 0;
            return s / 4294967296;
        };
    }
    function stRgb(hex) {
        hex = String(hex).replace("#", "");
        if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
        const n = parseInt(hex, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    /* Draw a primitive at its position + the 8 ±tile neighbours so any
       feature crossing an edge appears on the opposite side → seamless. */
    function stWrap(W, H, x, y, draw) {
        for (let ox = -1; ox <= 1; ox++)
            for (let oy = -1; oy <= 1; oy++)
                draw(x + ox * W, y + oy * H);
    }
    function stMottle(ctx, W, H, rng, rec) {
        const n = rec.blobs || 11;
        for (let k = 0; k < n; k++) {
            const x = rng() * W, y = rng() * H, r = W * (0.12 + rng() * 0.22);
            const c = rng() < 0.5 ? "255,255,255" : "0,0,0";
            const a = 0.10 + rng() * 0.15;
            stWrap(W, H, x, y, function (px, py) {
                const g = ctx.createRadialGradient(px, py, 0, px, py, r);
                g.addColorStop(0, "rgba(" + c + "," + a + ")");
                g.addColorStop(1, "rgba(" + c + ",0)");
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
            });
        }
    }
    function stFiber(ctx, W, H, rng, rec) {
        const n = rec.fibers || 260, baseAng = rec.fiberAngle || 0;
        ctx.lineCap = "round";
        for (let k = 0; k < n; k++) {
            const x = rng() * W, y = rng() * H;
            const len = 3 + rng() * 7, ang = baseAng + (rng() - 0.5) * 0.7;
            const dx = Math.sin(ang) * len, dy = Math.cos(ang) * len;
            const c = rng() < 0.5 ? "255,255,255" : "0,0,0";
            ctx.strokeStyle = "rgba(" + c + "," + (0.09 + rng() * 0.17) + ")";
            ctx.lineWidth = 0.8 + rng() * 0.9;
            stWrap(W, H, x, y, function (px, py) {
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + dx, py + dy); ctx.stroke();
            });
        }
    }
    function stSparkle(ctx, W, H, rng, rec) {
        const glows = rec.glows == null ? 6 : rec.glows, tint = rec.glow || "180,150,255";
        for (let k = 0; k < glows; k++) {
            const x = rng() * W, y = rng() * H, r = 6 + rng() * 16;
            stWrap(W, H, x, y, function (px, py) {
                const g = ctx.createRadialGradient(px, py, 0, px, py, r);
                g.addColorStop(0, "rgba(" + tint + ",0.22)");
                g.addColorStop(1, "rgba(" + tint + ",0)");
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
            });
        }
        const stars = rec.stars == null ? 90 : rec.stars;  /* pinpoints: high-freq, seam-safe */
        for (let k = 0; k < stars; k++) {
            const big = rng() < 0.15 ? 2 : 1;
            ctx.fillStyle = "rgba(255,255,255," + (0.5 + rng() * 0.5) + ")";
            ctx.fillRect(rng() * W, rng() * H, big, big);
        }
    }
    function buildSurfaceTexture(id) {
        const rec = SURFACE_TEXTURE_RECIPES[id] || { base: "#b08050", style: "grit" };
        const W = ST_SIZE, H = ST_SIZE;
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d");
        const rng = stRng(stHash(id));
        ctx.fillStyle = rec.base;
        ctx.fillRect(0, 0, W, H);
        /* Per-pixel grain — pure high-frequency noise tiles with no seam. */
        const gr = rec.grain == null ? 16 : rec.grain;
        const grit = rec.grit || 0, speckSign = rec.speckLight ? 1 : -1;
        const img = ctx.getImageData(0, 0, W, H), d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            let j = (rng() * 2 - 1) * gr;
            if (grit && rng() < grit) j += speckSign * (28 + rng() * 42);
            d[i]     = Math.max(0, Math.min(255, d[i]     + j));
            d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + j));
            d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + j));
        }
        ctx.putImageData(img, 0, 0);
        if (rec.style === "mottle")       stMottle(ctx, W, H, rng, rec);
        else if (rec.style === "fiber")   stFiber(ctx, W, H, rng, rec);
        else if (rec.style === "sparkle") stSparkle(ctx, W, H, rng, rec);
        return cv;
    }
    function getSurfaceTexture(id) {
        if (LEGACY_TEXTURE_ALIASES[id]) id = LEGACY_TEXTURE_ALIASES[id];
        let e = SURFACE_TEXTURE_CACHE[id];
        if (!e) { e = { canvas: buildSurfaceTexture(id), url: null }; SURFACE_TEXTURE_CACHE[id] = e; }
        return e;
    }
    /* Data URL of the generated tile, for CSS background-image swatches
       (decorate palette + shop pack modal). Built lazily, then cached. */
    function surfaceTextureUrl(id) {
        const e = getSurfaceTexture(id);
        if (!e.url) e.url = e.canvas.toDataURL("image/png");
        return e.url;
    }

    function loadSurfaceTextures(packs) {
        /* Pre-warm the canvases so the first decorate open / render is
           instant. Cheap: 39 small seeded 128² tiles. */
        packs.forEach(function (p) {
            (p.surfaceTextures || []).forEach(function (id) {
                if (id) getSurfaceTexture(id);
            });
        });
    }

    /* Saved pots from before the texture reorg stored legacy ids:
       the builder-pack textures lived at the root (they're now under
       assets/textures/builder/), and "chicken" was renamed "chickens".
       Remap those to the current file ids so old gallery + shared pots
       keep their skins instead of rendering bare. Current pots already
       store the new ids (e.g. "builder/plushie"), which pass through
       untouched. */
    const LEGACY_TEXTURE_ALIASES = {
        "plush":                  "builder/plushie",
        "plushie":                "builder/plushie",
        "plushie-blue":           "builder/plushie-blue",
        "plushie-pink":           "builder/plushie-pink",
        "gamer":                  "builder/gamer",
        "gamer-black":            "builder/gamer-black",
        "gamer-crt":              "builder/gamer-crt",
        "dinosaur":               "builder/dinosaur",
        "dinosaur-blue":          "builder/dinosaur-blue",
        "dinosaur-purpleorange":  "builder/dinosaur-purpleorange",
        "chicken":                "chickens"
    };

    function getSurfacePattern(ctx, fileId) {
        if (!ctx || !fileId) return null;
        if (LEGACY_TEXTURE_ALIASES[fileId]) fileId = LEGACY_TEXTURE_ALIASES[fileId];
        let cache = SURFACE_PATTERN_CACHE.get(ctx);
        if (!cache) {
            cache = Object.create(null);
            SURFACE_PATTERN_CACHE.set(ctx, cache);
        }
        if (cache[fileId]) return cache[fileId];
        const canvas = getSurfaceTexture(fileId).canvas;   /* procedural tile */
        if (!canvas) return null;
        try {
            const pat = ctx.createPattern(canvas, "repeat");
            cache[fileId] = pat;
            return pat;
        } catch (_) { return null; }
    }

    /* Render the surface texture skin. Called from renderPotScene
       right after the paint canvas composite, so the skin layers
       over the user's stickers (the texture is what the OUTSIDE of
       the pot looks like, after all). No-op when no skin is selected
       or the asset isn't decoded. textureId defaults to the live
       D.surfaceTexturePackId (a texture FILE id); gallery thumbnails
       pass the saved entry's id explicitly to override. */
    function paintSurfaceTexture(ctx, bounds, textureId) {
        const id = (textureId === undefined)
            ? (D && D.surfaceTexturePackId)
            : textureId;
        if (!id) return;
        const pat = getSurfacePattern(ctx, id);
        if (!pat) return;

        /* SPIN-VIEW override: gallery detail modal sets _viewSpinDx
           when the user is drag-spinning the pot, in which case
           we use that pixel offset directly (1:1 with finger
           motion). Otherwise on the shape screen the wheel is
           spinning and we use the wheel-phase trick at 0.22 of
           the visible radius (less than half the clay layer's
           0.55 so busy pack patterns don't get dizzying). */
        if (_viewSpinDx != null &&
                typeof DOMMatrix === "function" &&
                typeof pat.setTransform === "function") {
            try { pat.setTransform(new DOMMatrix().translateSelf(_viewSpinDx, 0)); }
            catch (_) {}
        } else if (currentScreen === "shape" &&
                typeof DOMMatrix === "function" &&
                typeof pat.setTransform === "function") {
            const visibleRadius = bounds.w * 0.5 - 4;
            const dx = SHAPE.wheelPhase * visibleRadius * 0.22;
            try { pat.setTransform(new DOMMatrix().translateSelf(dx, 0)); }
            catch (_) {}
        } else if (typeof pat.setTransform === "function") {
            try { pat.setTransform(new DOMMatrix()); } catch (_) {}
        }

        ctx.save();
        buildPotPath(ctx);
        ctx.clip();
        /* source-over + the PNG pattern preserves the source PNG's alpha
           channel, so translucent textures composite over the clay below.
           Opaque skins get the 0.92 clamp; translucent ones paint at full
           alpha and let their own PNG alpha control how much clay shows. */
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = surfaceTextureAlpha(id);
        ctx.fillStyle = pat;
        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.restore();
    }

    /* ============================================================
       PACK BACKGROUNDS — per-pack SVG scene wash
       ============================================================
       Optional per-pack vibe-setter that paints inside the pot-box
       behind the wheel + pot. Lightweight SVGs at
       assets/backgrounds/<n>.svg (filename comes from each
       pack's optional `backgroundSvg` field).

       Same lazy-image pattern as the wheel.png + clay/surface
       texture loaders: an Image is constructed once on demand,
       cached, drawn when complete. Packs without a background
       file skip silently — no warning, no fallback art needed.
       Painted at low alpha (0.32) so it acts as a soft accent
       rather than a competing layer; only shows on shape +
       decorate where the pack identity is the user's focus.
       ============================================================ */
    const PACK_BACKGROUNDS = Object.create(null);          /* file -> Image */

    function getPackBackgroundImg(file) {
        if (!file) return null;
        let img = PACK_BACKGROUNDS[file];
        if (img) return img;
        img = new Image();
        img._loaded = false;
        img._failed = false;
        img.addEventListener("load",  function () { img._loaded = true; });
        img.addEventListener("error", function () { img._failed = true; });
        img.src = "assets/backgrounds/" + file + ".svg";
        PACK_BACKGROUNDS[file] = img;
        return img;
    }

    function paintPackBackground(ctx) {
        /* Only paint on screens that "belong to" the active pack
           — shape (you picked this pack to shape with) + decorate
           (you're painting in this pack's style). Kiln has its
           own dramatic chrome that would fight the wash. */
        if (currentScreen !== "shape" && currentScreen !== "decorate") return;
        const pack = (typeof activePack === "function") ? activePack() : null;
        if (!pack || !pack.backgroundSvg) return;
        const img = getPackBackgroundImg(pack.backgroundSvg);
        if (!img || !img._loaded || img._failed) return;
        ctx.save();
        ctx.globalAlpha = 0.32;
        ctx.drawImage(img, 0, 0, SHAPE.W, SHAPE.H);
        ctx.restore();
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
        PULL_EASE:    0.62,  /* outward pulls ease slower — clay has weight */

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
        needsLump: false,

        /* --- Starter shape + lip-drag height (ported from Slip Studio) ---
           shapeId  : which starter silhouette a fresh lump throws into
                      (see POT_SHAPES). "cylinder" = the classic straight
                      wall, so old behavior is the default.
           heightScale: vertical stretch factor. Geometry (incl. height)
                      lives in clay[].y, so this is a live-editing convenience
                      re-derived from the loaded rim height, never persisted
                      on its own. */
        shapeId:    "cylinder",
        heightScale: 1,

        /* Rim-pull stroke state (grab the lip → raise/lower height).
           Null unless the current drag started on the top lip. */
        rimStroke: null
    };

    /* ---- Starter shapes: control profiles thrown from a fresh lump ----
       Each `controls` is a list of [t, radius] points, t = 0 at the
       base (on the wheel) up to t = 1 at the rim, radius in logical px.
       seedShape() resamples these into SHAPE.clay's N radius samples;
       buildPotPath's midpoint smoothing rounds the corners. Base radii
       stay under the wheel cap (WHEEL_RX) so pots keep a foot. */
    const POT_SHAPES = [
        { id: "cylinder", label: "TUBE",
          controls: [[0, 72], [1, 72]] },
        { id: "vase", label: "VASE",
          controls: [[0, 46], [0.15, 60], [0.42, 94], [0.68, 62], [0.86, 42], [1, 52]] },
        { id: "bowl", label: "BOWL",
          controls: [[0, 40], [0.3, 80], [0.62, 112], [1, 130]] },
        { id: "cup", label: "CUP",
          controls: [[0, 50], [0.5, 62], [1, 68]] },
        { id: "bottle", label: "BOTTLE",
          controls: [[0, 60], [0.24, 90], [0.44, 82], [0.6, 34], [0.82, 26], [1, 31]] },
        { id: "jar", label: "JAR",
          controls: [[0, 54], [0.3, 94], [0.55, 102], [0.78, 78], [1, 72]] },
        { id: "egg", label: "EGG",
          controls: [[0, 34], [0.34, 96], [0.6, 92], [0.85, 50], [1, 40]] },
        { id: "planter", label: "POT",
          controls: [[0, 58], [0.5, 92], [1, 122]] },
        /* Bonus silhouettes. Every shape spans the full height (the
           profile is sampled 0..1 across it and heightScale is a
           separate control), so these earn their place by CURVE, not
           by size — each does something none of the first eight does.
           AMPHORA: narrowest foot of the set under the widest belly.
           TULIP:   S-curve — pinches to a waist, then flares open.
           GOURD:   two separate bulges, the only double-belly form.
           GOBLET:  narrow lower third carrying a wide upper cup.    */
        { id: "amphora", label: "AMPHORA",
          controls: [[0, 26], [0.15, 56], [0.4, 100], [0.62, 72], [0.8, 36], [1, 40]] },
        { id: "tulip", label: "TULIP",
          controls: [[0, 40], [0.2, 70], [0.45, 58], [0.72, 88], [1, 116]] },
        { id: "gourd", label: "GOURD",
          controls: [[0, 44], [0.18, 88], [0.36, 62], [0.6, 104], [0.82, 54], [1, 58]] },
        { id: "goblet", label: "GOBLET",
          controls: [[0, 58], [0.18, 40], [0.34, 34], [0.55, 72], [0.78, 96], [1, 104]] }
    ];

    /* Sample a control-point profile at parameter t (0..1). Linear
       between points; buildPotPath smooths the result visually. */
    function sampleShapeProfile(controls, t) {
        if (t <= controls[0][0]) return controls[0][1];
        const last = controls.length - 1;
        if (t >= controls[last][0]) return controls[last][1];
        for (let i = 0; i < last; i++) {
            const a = controls[i], b = controls[i + 1];
            if (t >= a[0] && t <= b[0]) {
                const f = (t - a[0]) / (b[0] - a[0] || 1);
                return a[1] + (b[1] - a[1]) * f;
            }
        }
        return controls[last][1];
    }

    /* Rim-pull tuning (grab the lip → raise/lower the pot height). */
    const RIM_GRAB_FRAC  = 0.90;   /* t at/above this = a lip grab (top ~10%) */
    const RIM_LOCK_PX    = 7;      /* travel before the drag axis locks */
    const HEIGHT_MIN     = 0.55;
    const HEIGHT_MAX     = 1.05;
    /* A fresh lump throws SHORT, so "grab the lip and pull up" has
       somewhere to go. It used to start at 1.0 against a 1.05 ceiling,
       which meant an 80px up-drag bought 5% and then clamped — half the
       gesture was dead while down-drags got the full range. The ceiling
       can't rise instead: topY (95) is the design headroom, and a wide
       bowl's lip ellipse already reaches ~34px above the rim, so past
       ~1.05 the mouth clips off the top of the canvas. Starting lower
       also matches how throwing actually goes — you pull the wall up. */
    const FRESH_HEIGHT   = 0.84;

    /* Lay out the fixed y for each clay sample from the current
       heightScale (radii preserved). Called by resetClay/seedShape
       and whenever a rim-pull changes the pot's height. */
    function layoutClayY() {
        const clay = SHAPE.clay;
        if (!clay) return;
        const N = clay.length;
        const span = (SHAPE.baseY - SHAPE.topY) * SHAPE.heightScale;
        for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            clay[i].y = SHAPE.baseY - t * span;
        }
    }

    /* Re-throw the current clay into a named starter shape (keeps the
       current heightScale + clay material). */
    function seedShape(shapeId) {
        const shape = POT_SHAPES.find(function (s) { return s.id === shapeId; }) ||
                      POT_SHAPES[0];
        SHAPE.shapeId = shape.id;
        if (!SHAPE.clay) resetClay();
        const clay = SHAPE.clay;
        const N = clay.length;
        for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            let r = sampleShapeProfile(shape.controls, t);
            /* Keep the base under the wheel cap so it sits on a foot. */
            if (i <= 4) r = Math.min(r, WHEEL_RX + (SHAPE.MAX_R - WHEEL_RX) * (i / 4));
            clay[i].radius = Math.max(SHAPE.MIN_R, Math.min(SHAPE.MAX_R, r));
        }
        layoutClayY();
    }

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
        buildShapePicker();
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
            setClaySurfaceVars(disc, mat);
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

    /* ----- Starter-shape picker ----- */
    function buildShapePicker() {
        const pick = document.getElementById("shapePicker");
        if (!pick) return;
        Array.from(pick.querySelectorAll(".shape-chip")).forEach(function (b) {
            b.remove();
        });
        POT_SHAPES.forEach(function (shape) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chip shape-chip";
            btn.dataset.shape = shape.id;
            btn.textContent = shape.label;
            btn.setAttribute("aria-label", shape.label + " shape");
            if (shape.id === SHAPE.shapeId) btn.classList.add("active");
            btn.addEventListener("click", function () { setStarterShape(shape.id); });
            pick.appendChild(btn);
        });
    }

    /* Re-throw the clay into a starter silhouette. Blocked while the
       wheel is empty (drop a lump first) or the form is locked. */
    function setStarterShape(shapeId) {
        if (SHAPE.needsLump || SHAPE.clayLocked) return;
        SHAPE.shapeId = shapeId;
        seedShape(shapeId);
        SHAPE.rimStroke = null;
        document.querySelectorAll(".shape-chip[data-shape]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.shape === shapeId);
        });
        squelch();
        haptic(8);
    }

    /* Adopt a loaded/remixed entry's shape state into live SHAPE:
       starter-shape label + heightScale re-derived from the loaded rim
       height so a subsequent rim-pull continues from the right place.
       Call AFTER SHAPE.clay is set. */
    function adoptEntryShape(entry) {
        SHAPE.shapeId = entry.shapeId || "cylinder";
        const clay = SHAPE.clay;
        if (clay && clay.length) {
            const span = SHAPE.baseY - SHAPE.topY;
            const rimY = clay[clay.length - 1].y;
            SHAPE.heightScale = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX,
                (SHAPE.baseY - rimY) / span));
        }
        SHAPE.rimStroke = null;
        refreshShapePickers();
    }

    /* Sync the shape picker's active chip to the live SHAPE state (used
       after loading / remixing a pot re-derives its starter shape). */
    function refreshShapePickers() {
        document.querySelectorAll(".shape-chip[data-shape]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.shape === SHAPE.shapeId);
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

    /* ----- 5A2. Clay-lump tray (tap a lump to plop it on the wheel) ----- */

    const SHAPE_HINT_DROP  = "TAP a lump. SMACK it on the wheel. POTTERY HAPPENS.";
    const SHAPE_HINT_SHAPE = "TAP to boss the clay. PINCH = skinnier. PUSH = THICCER.";

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
            prompt.textContent = SHAPE.needsLump ? "PLOP A LUMP →"
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
                "Tap " + mat.label + " clay to plop it on the wheel — " + mat.flavor);

            const ball = document.createElement("span");
            ball.className = "lump-ball";
            setClaySurfaceVars(ball, mat);
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
            setClaySurfaceVars(ghost, mat);
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
        SHAPE.wetSince = performance.now();   /* fresh lump = freshly wet */
        claySplat();                                /* recorded splat, synth fallback */
        /* Splat just landed — the wheel can start humming now. */
        wheelHumStart();
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
        SHAPE.heightScale = FRESH_HEIGHT;
        const span = (SHAPE.baseY - SHAPE.topY) * SHAPE.heightScale;
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
        SHAPE.rimStroke = null;
        SHAPE.particles.length = 0;
        /* Throw into the currently-selected starter silhouette
           (cylinder = the classic straight wall). */
        if (SHAPE.shapeId && SHAPE.shapeId !== "cylinder") {
            seedShape(SHAPE.shapeId);
        }
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
            SHAPE.wetSince = performance.now();  /* refresh drying-ring timer */
            /* Rim-pull: a grab on the top lip becomes a dedicated
               stroke — drag up/down to raise/lower the pot, or
               sideways to flare/collar the mouth. Axis locks after a
               few px of travel so the intent is unambiguous. */
            const clay = SHAPE.clay;
            const span = (SHAPE.baseY - SHAPE.topY) * SHAPE.heightScale;
            const grabT = (SHAPE.baseY - p.y) / span;
            const nearMouth = Math.abs(p.x - SHAPE.centerX) <
                              clay[clay.length - 1].radius + 46;
            if (grabT >= RIM_GRAB_FRAC && grabT <= 1.14 && nearMouth) {
                SHAPE.rimStroke = {
                    startX: p.x, startY: p.y,
                    axis: null, startHeight: SHAPE.heightScale
                };
            } else {
                SHAPE.rimStroke = null;
            }
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
            SHAPE.rimStroke = null;
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
            /* Clean slate: re-throw the selected starter shape at full
               height so RESET visibly clears everything the kid did. */
            resetClay();
            refreshShapePickers();
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
           vertical zone? Don't deform. Scale by heightScale so the
           finger still maps to the right samples after a rim-pull has
           stretched or squashed the pot's height. */
        const span = (SHAPE.baseY - SHAPE.topY) * SHAPE.heightScale;
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
        /* Base-width cap: the pot rests ON the wheel head, so its bottom
           can't be pushed wider than the wheel (WHEEL_RX). The cap
           relaxes over the first few samples so the body above is still
           free to flare to MAX_R. clay[0] is the base, clay[N-1] the rim. */
        const RAMP = 4;
        for (let i = 0; i < N; i++) {
            const d = i - centerIdx;
            const w = Math.exp(-d * d / sigma2);
            if (w < SHAPE.KERNEL_CUT) continue;
            /* desired pulls slice toward targetR weighted by kernel,
               then we ease toward that desired over the frame. */
            const cur = clay[i].radius;
            const desired = cur + (targetR - cur) * w;
            /* Clay feel (ported from Slip Studio): pulling the wall
               OUTWARD is weightier than pushing in (you're fighting
               the clay's cohesion), and the wall gets stubborn as it
               thins toward MIN_R so a hard pinch doesn't snap it to
               nothing in one frame. */
            let e = ease;
            if (desired > cur) e *= SHAPE.PULL_EASE;
            const thin = (cur - minR) / 26;
            if (desired < cur && thin < 1) e *= 0.4 + 0.6 * Math.max(0, thin);
            const next = cur + (desired - cur) * e;
            let hiR = maxR;
            if (!EGG.infiniteClay && i <= RAMP) {
                hiR = Math.min(maxR, WHEEL_RX + (maxR - WHEEL_RX) * (i / RAMP));
            }
            const clamped = Math.max(minR, Math.min(hiR, next));
            if (Math.abs(clamped - cur) > 0.04) didShape = true;
            clay[i].radius = clamped;
        }
        /* Light wheel-polish smoothing: a spinning wheel evens out
           sharp local bumps into a fair curve. One weak neighbour
           blur pass, skipped at the base/rim ends so the foot and lip
           stay crisp. */
        if (didShape) {
            for (let i = 1; i < N - 1; i++) {
                clay[i].radius += (0.5 * (clay[i - 1].radius + clay[i + 1].radius) -
                                   clay[i].radius) * 0.08;
            }
        }
        return didShape;
    }

    /* Rim-pull: the current drag grabbed the very lip. It ONLY claims
       the stroke for a clearly VERTICAL drag — dragging the lip up/down
       raises/lowers the whole pot (heightScale). A sideways drag is
       ordinary wall shaping (which already flares/collars the mouth),
       so we hand it straight back to applyShaping instead of fighting
       it — this is what keeps shaping the upper wall from feeling
       broken. Returns whether the clay changed. */
    function applyRimPull(p, dt) {
        const rs = SHAPE.rimStroke;
        if (!rs) return false;
        const dx = p.x - rs.startX;
        const dy = p.y - rs.startY;
        if (!rs.axis) {
            if (Math.hypot(dx, dy) < RIM_LOCK_PX) return false;
            /* Claim it for RAISE only if the drag is decisively vertical;
               otherwise it's a normal wall/mouth shaping drag. */
            if (Math.abs(dy) > Math.abs(dx) * 1.3) {
                rs.axis = "raise";
            } else {
                SHAPE.rimStroke = null;
                return applyShaping(p, dt);
            }
        }
        /* RAISE: drag up (dy negative) = taller, down = shorter. Map
           screen travel to a height-scale delta, clamped to the canvas. */
        const span = SHAPE.baseY - SHAPE.topY;
        const target = rs.startHeight + (-dy / span);
        const next = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, target));
        if (Math.abs(next - SHAPE.heightScale) < 0.001) return false;
        SHAPE.heightScale = next;
        layoutClayY();
        return true;
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
            /* Pack vibe wash — paints between the backdrop and the
               wheel so the SVG sits in the deep background, not
               competing with the foreground composition. No-op
               unless the active pack has a backgroundSvg file. */
            if (typeof paintPackBackground === "function") {
                paintPackBackground(ctx);
            }
        }

        /* Wheel platform — drawn first so the pot covers the front
           half, leaving the back rim visible as an arc. */
        if (opts.wheel !== false) drawWheel(ctx);

        /* Pot silhouette + 3-D shading. Skipped while the wheel is
           still empty (waiting for a lump drop) — opts.pot:false. */
        if (opts.pot !== false) drawPot(ctx);

        /* Surface texture + light catches are pot-shape derived,
           so they only run when the pot itself is being drawn.
           This is what kept the empty-wheel state ghosting a
           cylindrical silhouette before a lump landed — the
           texture / sheen / rim were painting against the
           default SHAPE.clay path even with opts.pot:false. */
        if (opts.pot !== false) {
            /* Surface texture (TEXTURE button) — applied to the
               bare clay BEFORE the paint canvas so stickers,
               brush strokes, and stamps the kid lays on top stay
               visible above the skin. No-op if no skin is
               selected or the active pack has no surfaceTexture.
               opts.surfaceTexturePackId lets gallery thumbnails
               pass the entry's saved skin id; absent, the live
               D state drives the decorate render.
               Suppressed during the SCULPTING phase — only the clay's
               own material texture shows while throwing; pack surface
               skins are a decorate-phase choice. */
            if (currentScreen !== "shape" &&
                    typeof paintSurfaceTexture === "function") {
                const clay = SHAPE.clay;
                const N = clay.length;
                const maxR = (function () {
                    let m = 0;
                    for (let i = 0; i < N; i++) if (clay[i].radius > m) m = clay[i].radius;
                    return m;
                }());
                paintSurfaceTexture(ctx, {
                    x: SHAPE.centerX - maxR - 4,
                    y: clay[N - 1].y - 4,
                    w: (maxR + 4) * 2,
                    h: SHAPE.baseY - clay[N - 1].y + 14
                }, opts.surfaceTexturePackId);
            }

            /* Dip glaze — coats the clay/skin BEFORE the light catches
               so the sheen sits on top for a glossy glazed look, and
               UNDER the kid's brush/stamps so they can still draw on a
               dipped pot. Arrays come from D (live) or the saved entry
               (thumbnails); absent = no-op. */
            if (opts.dips && opts.dips.length) compositeDips(ctx, opts.dips);

            /* Light catches — sheen + rim painted on TOP of the
               surface texture so the 3D-lit feel survives even
               when a pack skin is wrapped over the bare clay.
               Below the paint canvas + stickers so the kid's
               decorations stay crisp against the lit surface. */
            if (typeof paintLightCatches === "function") {
                paintLightCatches(ctx);
            }

            /* Frieze bands — applied decoration, painted crisp on top
               of the sheen. */
            if (opts.bands && opts.bands.length) compositeBands(ctx, opts.bands);
        }

        /* Paint layer (decorate mode) — clipped to the pot silhouette
           so strokes outside the body never show. Sits ABOVE the
           surface texture so stickers + brush stay visible. */
        if (opts.paintCanvas) {
            ctx.save();
            buildPotPath(ctx);
            ctx.clip();
            ctx.drawImage(opts.paintCanvas, 0, 0, SHAPE.W, SHAPE.H);
            ctx.restore();
        }

        /* Sticker layer — stamps moved out of paintCanvas in the
           v1.1 move-tool refactor so they can be picked back up
           and dragged. Same clip-to-pot as paintCanvas so they
           never overhang the silhouette. */
        if (opts.stickerCanvas) {
            ctx.save();
            buildPotPath(ctx);
            ctx.clip();
            ctx.drawImage(opts.stickerCanvas, 0, 0, SHAPE.W, SHAPE.H);
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
        else drawWetRing(ctx);   /* drying halo at the pot's base */
    }

    /* Soft wet halo at the wheel base. Bigger + brighter right
       after the kid touches the clay, shrinks + fades back to
       its idle size over ~6 seconds. Pure visual — sells the
       "wet clay on a wheel" mood without any new mechanic. */
    function drawWetRing(ctx) {
        const now = performance.now();
        const wetMs = SHAPE.wetSince ? (now - SHAPE.wetSince) : Infinity;
        const DRY_WINDOW = 6000;
        /* freshness goes 1 (just touched) -> 0 (fully dried),
           clamped + eased so the drop is gentle. */
        const fresh = Math.max(0, 1 - Math.min(1, wetMs / DRY_WINDOW));
        const cx = SHAPE.centerX;
        const cy = SHAPE.baseY + 4;
        const baseRx = 110;
        const baseRy = 14;
        const rx = baseRx + fresh * 22;   /* 110 idle, 132 fresh */
        const ry = baseRy + fresh * 4;    /*  14 idle,  18 fresh */
        const alpha = 0.07 + fresh * 0.11;  /* 0.07 idle, 0.18 fresh */
        ctx.save();
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        halo.addColorStop(0,   "rgba(140, 220, 220, " + alpha.toFixed(3) + ")");
        halo.addColorStop(0.6, "rgba(140, 220, 220, " + (alpha * 0.45).toFixed(3) + ")");
        halo.addColorStop(1,   "rgba(140, 220, 220, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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

    /* ---- Wheel asset hook ----
       If assets/img/wheel.png exists + decodes, drawWheel uses it
       in place of the procedural disc/wedges. Two asset shapes are
       supported, picked automatically from the image's aspect:

         • SQUARE (w≈h) — a top-down circular wheel head. It is
           rotated by SHAPE.wheelPhase, then flattened to an
           ellipse, so it spins like a real wheel under perspective.

         • LANDSCAPE (w noticeably > h) — a pre-rendered 3D /
           perspective wheel (already shows the side wall + an
           elliptical top, baked lighting). You CANNOT rotate this
           in circular space — that would spin the whole 3D body
           every frame and look broken. So it's drawn STATIC at its
           native aspect, centred on the pot, with its top surface
           parked at SHAPE.baseY. The spin is decorative anyway (the
           pot silhouette never visually rotates either), so a still
           wheel reads fine.

       Until the file lands, we fall back to the procedural disc +
       alternating wedge slices that shipped originally. */
    function loadWheelImg(src) {
        const img = new Image();
        img._loaded = false;
        img.addEventListener("load", function () { img._loaded = true; });
        img.addEventListener("error", function () {/* no-op — fallback runs */});
        img.src = src;
        return img;
    }
    /* (wheel.png removed — the shape-screen wheel head is now drawn as
       generated metal chrome; see drawWheelHeadMetal.) */
    /* Static perspective wood plinth the finished pot sits on in the
       gallery / saved-pot renders (used when _displayWheel is on). */
    const DISPLAY_IMG = loadWheelImg("assets/img/display.png");

    /* Fraction of a perspective wheel image's HEIGHT that sits ABOVE
       the visible top surface (the ellipse the pot rests on). Tune if
       a future plinth render has its top surface higher/lower in
       frame. For the shipped wood plinth the top-surface centre is
       ~30% down. */
    const WHEEL_ASSET_TOP_FRAC = 0.30;

    /* Throwing-wheel geometry. WHEEL_RX also CAPS the pot's base radius
       in applyShaping — the base can't spill wider than the wheel head
       it sits on (the body above is free to flare). */
    const WHEEL_RX = 132, WHEEL_RY = 30;

    /* Finishes shared with the KILN-9000 chrome (see drawKilnChrome):
       dark steel body, bright copper trim, steel rivets — so the wheel
       + stand read as the same machined appliance family. */
    function steelFill(ctx, y0, y1) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0,    "#1f2e36");
        g.addColorStop(0.55, "#101c22");
        g.addColorStop(1,    "#0a1418");
        return g;
    }
    function copperBand(ctx, x0, x1) {
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0,   "#5a3010");
        g.addColorStop(0.5, "#c08040");
        g.addColorStop(1,   "#5a3010");
        return g;
    }

    function drawWheel(ctx) {
        const cx = SHAPE.centerX;
        const cy = SHAPE.baseY;

        /* Gallery display path — pot on the perspective plinth. (This
           becomes a CSS display cabinet in a later pass.) */
        const useDisplay = _displayWheel && DISPLAY_IMG &&
                           DISPLAY_IMG._loaded && DISPLAY_IMG.naturalWidth > 0;
        if (useDisplay) {
            const aspectD = DISPLAY_IMG.naturalWidth / DISPLAY_IMG.naturalHeight;
            const drawW = 150 * 2.1;
            const drawH = drawW / aspectD;
            ctx.drawImage(DISPLAY_IMG, cx - drawW / 2,
                          cy - drawH * WHEEL_ASSET_TOP_FRAC, drawW, drawH);
            return;
        }

        /* SHAPE / DECORATE: a generated metal throwing wheel + stand,
           finished to match the KILN-9000 chrome (replaces wheel.png). */
        drawWheelStand(ctx, cx, cy);
        drawWheelHeadMetal(ctx, cx, cy, SHAPE.wheelPhase);
    }

    /* The cabinet/stand the wheel head is mounted in — a steel pedestal
       flaring slightly to the floor, with a copper top band + rivets. */
    function drawWheelStand(ctx, cx, cy) {
        const top = cy - 2;
        const bot = SHAPE.H;
        /* Near-vertical sides + rounded base = a cabinet, not a splayed
           stool. (The old version flared wider at the floor, which read
           as stool legs.) */
        const half = WHEEL_RX * 0.92;
        const r = 22;   /* rounded bottom corners */

        ctx.beginPath();
        ctx.moveTo(cx - half, top);
        ctx.lineTo(cx + half, top);
        ctx.lineTo(cx + half, bot - r);
        ctx.quadraticCurveTo(cx + half, bot, cx + half - r, bot);
        ctx.lineTo(cx - half + r, bot);
        ctx.quadraticCurveTo(cx - half, bot, cx - half, bot - r);
        ctx.closePath();
        ctx.fillStyle = steelFill(ctx, top, bot);
        ctx.fill();

        /* copper trim down the sides, following the rounded corners */
        ctx.strokeStyle = copperBand(ctx, cx - half, cx + half);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - half, top);
        ctx.lineTo(cx - half, bot - r);
        ctx.quadraticCurveTo(cx - half, bot, cx - half + r, bot);
        ctx.moveTo(cx + half, top);
        ctx.lineTo(cx + half, bot - r);
        ctx.quadraticCurveTo(cx + half, bot, cx + half - r, bot);
        ctx.stroke();

        /* copper band + rivet row just below the wheel head */
        const bandY = cy + WHEEL_RY + 3;
        const bandHalf = WHEEL_RX * 0.86;
        ctx.fillStyle = copperBand(ctx, cx - bandHalf, cx + bandHalf);
        ctx.fillRect(cx - bandHalf, bandY, bandHalf * 2, 5);
        ctx.fillStyle = "#4a5860";
        for (let x = cx - bandHalf + 12; x < cx + bandHalf - 6; x += 26) {
            ctx.beginPath();
            ctx.arc(x, bandY + 2.5, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* The spinning metal wheel head: turned-steel disc, concentric
       grooves, copper rim, a few copper bolts that rotate to sell the
       spin, and a center spindle cap. */
    function drawWheelHeadMetal(ctx, cx, cy, phase) {
        const rx = WHEEL_RX, ry = WHEEL_RY;

        const g = ctx.createRadialGradient(cx, cy - ry * 0.3, 4, cx, cy, rx);
        g.addColorStop(0,    "#3c4e57");
        g.addColorStop(0.5,  "#243741");
        g.addColorStop(1,    "#0e1a20");
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();
        /* concentric turn-grooves */
        ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
        ctx.lineWidth = 1;
        for (let r = rx - 10; r > 8; r -= 12) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, r, r * (ry / rx), 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        /* rotating copper bolts near the rim — the spin cue */
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        ctx.rotate(phase);
        ctx.fillStyle = "#c08040";
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * (rx - 14), Math.sin(a) * (rx - 14), 3.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        /* copper rim trim */
        ctx.strokeStyle = copperBand(ctx, cx - rx, cx + rx);
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        /* teal sheen on the front lip */
        ctx.strokeStyle = "rgba(0, 255, 204, 0.16)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 1, ry - 1, 0, 0.12, Math.PI - 0.12);
        ctx.stroke();

        /* center spindle cap */
        ctx.fillStyle = "#3c4e57";
        ctx.beginPath();
        ctx.ellipse(cx, cy, 9, 9 * (ry / rx), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = copperBand(ctx, cx - 9, cx + 9);
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    function buildPotPath(ctx) {
        /* Right side bottom -> top with midpoint-quadratic smoothing,
           lineTo across the rim, left side top -> bottom smoothed,
           lineTo across the base. Traces the RENDER profile (clay +
           active rim style) so the lip treatment is part of the
           silhouette / clip everywhere. */
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

        /* (max radius no longer needed here — the body is a flat albedo
           and all modelling comes from the form pass in
           paintLightCatches(), which works per row off its own radius.) */

        /* (Overhead contact shadow removed — the symmetric dark ellipse
           directly under the pot read as high-noon lighting, fighting
           the left-and-behind key light. The pot now sits straight on
           the metal wheel head, which grounds it on its own.) */

        /* Fill pot body — gently asymmetric gradient tuned for a
           mid-distance studio feel (vs the previous close/macro
           feel). Pull-back changes from v16:
             - Bright peak moved 0.32 -> 0.40 (less extreme
               off-center; still reads as upper-left lighting
               but the dramatic "spotlight on a tiny object" is
               gone)
             - Silhouette edges lifted from stops[0] (darkest) to
               stops[1] (mid-dark) so the pot edges don't go
               pitch-black against the backdrop — far-away
               cylinders never lose their edges to total black
             - Shadow side stops[1] (was stops[1]) carried out to
               1.00 — the cylinder's dark edge stays in the same
               value family as the shadow mid instead of dropping
               into pure dark like a close-range falloff would */
        const mat = currentClay();
        const stops = mat.unfired;
        buildPotPath(ctx);
        /* FLAT albedo. Every bit of modelling now comes from the
           cylindrical form pass in paintLightCatches(), which multiplies
           this base by ramp(s) / stops[3] — so bare clay lands on exactly
           the authored stops 1..3 value range it always had, while the
           same lighting also wraps whatever gets laid on top (pack skin,
           dip glaze). The old horizontal gradient ran across ±maxR and so
           handed every row the slice of light meant for the pot's WIDEST
           point; that is why necks, shoulders and tapers read flat. */
        ctx.fillStyle = stops[3];
        ctx.fill();

        /* (Procedural clay grain removed — the clay body is now a clean
           side-lit base gradient. The grain used to be a soft-light PNG
           tile over the gradient; it read as muddy under the new dip
           glazes and the picker swatches now carry the clay-surface look
           in CSS instead.) */

        /* Foot ring — now that the base is capped to the wheel, give the
           pot a turned foot: the body tucks in just above the base to a
           narrower foot rim it stands on. An undercut shadow marks where
           the base overhangs, then a darker clay foot band sits on the
           wheel. Skipped when the base is pinched near minimum. */
        const footBaseR = clay[0].radius;
        if (footBaseR > SHAPE.MIN_R + 8) {
            const footR = footBaseR * 0.80;
            const footY = SHAPE.baseY;
            ctx.save();
            /* undercut shadow where the wider base overhangs the foot */
            ctx.fillStyle = "rgba(0, 0, 0, 0.30)";
            ctx.beginPath();
            ctx.ellipse(cx, footY - 5, footBaseR * 0.93, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            /* the foot rim the pot stands on — darker clay tone */
            ctx.fillStyle = stops[1];
            ctx.beginPath();
            ctx.ellipse(cx, footY, footR, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            /* front-left sheen on the foot (matches the key light) */
            ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(cx, footY, footR, 6, 0, Math.PI * 0.05, Math.PI * 0.62);
            ctx.stroke();
            ctx.restore();
        }

        /* Light catches (sheen + rim) moved OUT of drawPot into
           paintLightCatches() below — they're now called from
           renderPotScene AFTER paintSurfaceTexture so the
           cylindrical 3D-lit feel survives even when a pack
           skin (plush fur, candy stripes, etc.) is wrapped over
           the bare clay. */

        /* (Cartoony silhouette outline removed — on a textured
           clay surface the 1.5px black stroke read as an ink
           cartoon. The texture + gradient + the dark backdrop
           give enough edge contrast on their own. mat.outline
           is still used by the rim and the wheel rim ring.) */

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

    /* ---- Light catches ----
       Specular sheen + rim light, painted on TOP of whatever
       surface is showing (bare clay OR an applied pack skin).
       Called from renderPotScene AFTER paintSurfaceTexture so
       the highlight always reads, regardless of whether the
       kid has applied a texture — the 3D-lit feel survives.

         1. Specular sheen — wide, soft, clay-tinted highlight
            peaking at x = ~0.40 of pot width (matches the
            body gradient's bright spot). 0.18 alpha for the
            mid-distance studio feel.

         2. Rim light — narrow warm catch on the right cylinder
            edge. Tiny 0.06 alpha; just enough to define the
            silhouette against the dark backdrop.

       Both clay-tinted via mat.highlight — porcelain stays
       cream, basalt stays warm grey, etc. Both clip to the
       pot path so neither bleeds past the silhouette.        */
    /* GALLERY DISPLAY LIGHTING
       renderSavedPot flips this on so gallery thumbnails + the
       detail modal get a more dramatic "display case" light than
       the calm working-screen light: a stronger side key plus a
       bright rim tracing the silhouette + a soft fill rim on the
       far edge. It makes a finished pot read as "lit on a shelf"
       rather than "wet on the wheel". null = the normal mid-
       distance studio light used on shape / decorate / kiln. */
    let _galleryLighting = false;

    /* ---- Cylindrical form lighting ----
       A pot is a surface of revolution, so for a side-on view the
       surface normal at horizontal offset x on a row of radius r is
       exactly (x/r, -dr/dy, sqrt(1 - (x/r)^2)), normalised. Every term
       is derivable from SHAPE.clay, which means real per-row modelling
       without a 3D engine and without touching the data model.

       The old light catches were global horizontal gradients sized to
       the pot's WIDEST point, so a bottle neck at r=26 got the middle
       slice of a gradient built for r=90 and lost its roundness. Worse,
       the position of the highlight drifted with a row's width instead
       of its shape: on BOTTLE it sat at 14% across the neck and 39%
       across the belly, for no physical reason.

       Output is two layers so it can light whatever is underneath —
       bare clay, a pack skin, a dip glaze — with one consistent model:
         mul  multiply layer, ramp(s) / stops[3]. Against the flat
              stops[3] albedo drawPot() lays down, bare clay resolves to
              the clay's own authored stops 1..3 ramp, so the palette is
              unchanged; anything painted over the clay simply takes the
              same falloff.
         spec additive specular + fresnel rim, in the clay's highlight
              colour, replacing the old sheen/rim rectangles.
       Bands, brush strokes and stickers composite AFTER this pass, so
       they stay crisp decals rather than being dimmed on the shadow
       side.                                                          */
    const FORM_U = 257;            /* samples across a row: u = x / r */
    const FORM_S = 129;            /* profile-slope buckets           */
    const FORM_SLOPE_MAX = 3;
    /* Darkest clay stop the shadow side is allowed to reach. 1 = the
       value range the old horizontal gradient had; 0 = deeper, more
       sculptural shadows. See the ramp note in formMaps(). */
    const FORM_RAMP_FLOOR = 0;

    /* Key light per mode, in canvas space (y grows DOWN, +z toward the
       viewer). Working screens keep the calm mid-distance studio key;
       the gallery gets a harder side key + a strong key-side rim so a
       finished pot still reads as lit on a plinth.

       spec / rimL / rimR are absolute peak strengths, deliberately
       matching the alphas the old sheen + rim rectangles used (work
       0.18 sheen + 0.06 right rim; gallery 0.26 sheen + 0.30 left key
       rim + 0.14 right fill rim) so the highlight reads at the same
       intensity it always did. They are NOT scaled by the clay's
       highlight alpha — mat.highlight contributes its COLOUR only,
       exactly as tint() did, or porcelain and void would blow out. */
    const FORM_LIGHTS = {
        work:    { dir: [-0.50, -0.46, 0.73], spec: 0.18, rimR: 0.06, rimL: 0.00 },
        gallery: { dir: [-0.74, -0.34, 0.58], spec: 0.26, rimR: 0.14, rimL: 0.30 }
    };

    function formHexRGB(h) {
        return [parseInt(h.slice(1, 3), 16),
                parseInt(h.slice(3, 5), 16),
                parseInt(h.slice(5, 7), 16)];
    }
    function formHlParts(s) {
        const m = s.match(/rgba?\(([^)]+)\)/)[1].split(",").map(Number);
        return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] };
    }

    /* (clay id + mode) -> {mul, spec} byte tables. Built once, so the
       per-frame pass is a plain array copy with no trigonometry. */
    const FORM_MAPS = {};
    function formMaps(mat, gallery) {
        const key = mat.id + (gallery ? "|g" : "");
        if (FORM_MAPS[key]) return FORM_MAPS[key];
        const stops = mat.unfired;
        /* Ramp floor. The old horizontal gradient only ever reached
           stops[1] at its darkest, so floor 1 reproduces its exact value
           range. Floor 0 lets the shadow side fall all the way to the
           clay's darkest stop — same highlights, deeper shadow, a more
           sculptural read. One constant, easy to put back. */
        const ramp = FORM_RAMP_FLOOR === 0
            ? [formHexRGB(stops[0]), formHexRGB(stops[1]),
               formHexRGB(stops[2]), formHexRGB(stops[3])]
            : [formHexRGB(stops[1]), formHexRGB(stops[2]),
               formHexRGB(stops[3])];
        const segs = ramp.length - 1;
        const peak = ramp[segs];
        const hl  = formHlParts(mat.highlight);
        const cfg = gallery ? FORM_LIGHTS.gallery : FORM_LIGHTS.work;
        const ll = Math.hypot(cfg.dir[0], cfg.dir[1], cfg.dir[2]);
        const Lx = cfg.dir[0] / ll, Ly = cfg.dir[1] / ll, Lz = cfg.dir[2] / ll;
        /* half-vector against an orthographic view direction (0,0,1) */
        const hvx = Lx, hvy = Ly, hvz = Lz + 1;
        const hvl = Math.hypot(hvx, hvy, hvz);
        const hx = hvx / hvl, hy = hvy / hvl, hz = hvz / hvl;

        const mul  = new Uint8ClampedArray(FORM_U * FORM_S * 4);
        const spec = new Uint8ClampedArray(FORM_U * FORM_S * 4);
        for (let sy = 0; sy < FORM_S; sy++) {
            const slope = -FORM_SLOPE_MAX +
                          (2 * FORM_SLOPE_MAX) * (sy / (FORM_S - 1));
            /* |(u, -slope, nz)| is sqrt(1 + slope^2) exactly, since
               u^2 + nz^2 == 1. */
            const inv = 1 / Math.sqrt(1 + slope * slope);
            for (let ux = 0; ux < FORM_U; ux++) {
                const u  = -1 + 2 * (ux / (FORM_U - 1));
                const nz = Math.sqrt(Math.max(0, 1 - u * u));
                const nx = u * inv, ny = -slope * inv, nzz = nz * inv;
                const dot = nx * Lx + ny * Ly + nzz * Lz;
                /* A little wrap past the terminator — clay is soft and
                   shouldn't snap to graphic black on the shadow side. */
                const wrap = Math.max(0, (dot + 0.35) / 1.35);
                let s = 0.16 + 0.62 * Math.max(0, dot) + 0.26 * wrap;
                if (s < 0) s = 0; else if (s > 1) s = 1;

                const f = s * segs;
                let i0 = f | 0;
                if (i0 > segs - 1) i0 = segs - 1;
                const t = f - i0;
                const a = ramp[i0], b = ramp[i0 + 1];
                const o = (sy * FORM_U + ux) * 4;
                for (let c = 0; c < 3; c++) {
                    const lit = a[c] + (b[c] - a[c]) * t;
                    mul[o + c] = peak[c] ? 255 * lit / peak[c] : 0;
                }
                mul[o + 3] = 255;

                const sp = Math.pow(Math.max(0, nx * hx + ny * hy + nzz * hz),
                                    34) * cfg.spec;
                const fr = Math.pow(1 - nz, 5) *
                           (u > 0 ? cfg.rimR : cfg.rimL);
                const k = Math.min(1, sp + fr);
                spec[o]     = hl.r * k;
                spec[o + 1] = hl.g * k;
                spec[o + 2] = hl.b * k;
                spec[o + 3] = 255;
            }
        }
        FORM_MAPS[key] = { mul: mul, spec: spec };
        return FORM_MAPS[key];
    }

    /* r(y) for every pixel row, sampled off the SAME quadratic chain
       buildPotPath draws — a linear walk of the clay samples would put
       the shading's u = ±1 edge slightly inside the silhouette and leave
       a bright seam down both sides. */
    let _formR = null;
    function formRadiusTable() {
        const clay = SHAPE.clay, N = clay.length, cx = SHAPE.centerX;
        if (!_formR) _formR = new Float32Array(SHAPE.H);
        const R = _formR;
        R.fill(-1);
        const put = function (x, y) {
            const yi = Math.round(y);
            if (yi < 0 || yi >= SHAPE.H) return;
            const r = x - cx;
            if (r > R[yi]) R[yi] = r;
        };
        let px = cx + clay[0].radius, py = clay[0].y;
        put(px, py);
        for (let i = 1; i < N - 1; i++) {
            const c1x = cx + clay[i].radius, c1y = clay[i].y;
            const e1x = cx + (clay[i].radius + clay[i + 1].radius) * 0.5;
            const e1y = (clay[i].y + clay[i + 1].y) * 0.5;
            for (let s = 1; s <= 20; s++) {
                const t = s / 20, mt = 1 - t;
                put(mt * mt * px + 2 * mt * t * c1x + t * t * e1x,
                    mt * mt * py + 2 * mt * t * c1y + t * t * e1y);
            }
            px = e1x; py = e1y;
        }
        const rx = cx + clay[N - 1].radius, ry = clay[N - 1].y;
        for (let s = 1; s <= 8; s++) {
            const t = s / 8;
            put(px + (rx - px) * t, py + (ry - py) * t);
        }
        /* interpolate the rows the curve stepped over */
        let last = -1;
        for (let y = 0; y < SHAPE.H; y++) {
            if (R[y] >= 0) {
                if (last >= 0 && y - last > 1) {
                    for (let k = last + 1; k < y; k++) {
                        R[k] = R[last] + (R[y] - R[last]) *
                               ((k - last) / (y - last));
                    }
                }
                last = y;
            }
        }
        return R;
    }

    /* dr/dy per row, smoothed.
       R is built by rasterising a curve and linearly filling the rows
       the curve stepped over, so it's piecewise-linear: its raw
       derivative is a staircase, and feeding that straight into the
       slope buckets banded the lower wall of flared shapes (adjacent
       rows differing by 105/255 where the smooth stretch differed by
       43). A wide central difference plus two box-blur passes turns it
       back into the smooth gradient the real profile has. */
    let _formSlope = null, _formSlopeTmp = null;
    function formSlopeTable(R, rimY, footY) {
        if (!_formSlope) {
            _formSlope    = new Float32Array(SHAPE.H);
            _formSlopeTmp = new Float32Array(SHAPE.H);
        }
        const S = _formSlope, T = _formSlopeTmp;
        const D = 4;
        for (let y = rimY; y <= footY; y++) {
            const a = R[Math.max(rimY, y - D)];
            const b = R[Math.min(footY, y + D)];
            const span = Math.min(footY, y + D) - Math.max(rimY, y - D);
            S[y] = span > 0 ? (b - a) / span : 0;
        }
        for (let pass = 0; pass < 2; pass++) {
            for (let y = rimY; y <= footY; y++) {
                let sum = 0, n = 0;
                for (let k = -2; k <= 2; k++) {
                    const yy = y + k;
                    if (yy < rimY || yy > footY) continue;
                    sum += S[yy]; n++;
                }
                T[y] = sum / n;
            }
            S.set(T.subarray(rimY, footY + 1), rimY);
        }
        return S;
    }

    /* Scratch canvases, reused every frame. Built in logical 400x600
       space and drawn with drawImage (which honours the target's
       transform) so gallery thumbnails scale correctly — putImageData
       would ignore the transform and blow out the thumbnail. */
    let _formMulCv = null, _formMulCtx = null, _formMulImg = null;
    let _formSpecCv = null, _formSpecCtx = null, _formSpecImg = null;
    function formBuffers() {
        if (_formMulCv) return;
        _formMulCv = document.createElement("canvas");
        _formMulCv.width = SHAPE.W; _formMulCv.height = SHAPE.H;
        _formMulCtx = _formMulCv.getContext("2d");
        _formMulImg = _formMulCtx.createImageData(SHAPE.W, SHAPE.H);
        _formSpecCv = document.createElement("canvas");
        _formSpecCv.width = SHAPE.W; _formSpecCv.height = SHAPE.H;
        _formSpecCtx = _formSpecCv.getContext("2d");
        _formSpecImg = _formSpecCtx.createImageData(SHAPE.W, SHAPE.H);
    }

    function paintLightCatches(ctx) {
        const clay = SHAPE.clay;
        if (!clay || !clay.length) return;
        const mat  = currentClay();
        const maps = formMaps(mat, _galleryLighting);
        const R    = formRadiusTable();
        formBuffers();

        const mulD = _formMulImg.data, specD = _formSpecImg.data;
        mulD.fill(0); specD.fill(0);   /* alpha 0 outside the pot: multiply
                                          and lighter both leave the
                                          destination untouched there */

        const cx = SHAPE.centerX, W = SHAPE.W, N = clay.length;
        const rimY  = Math.max(0, Math.round(clay[N - 1].y));
        const footY = Math.min(SHAPE.H - 1, Math.round(clay[0].y));
        const US = (FORM_U - 1) * 0.5;
        const SL = formSlopeTable(R, rimY, footY);

        for (let y = rimY; y <= footY; y++) {
            const r = R[y];
            if (!(r > 0.5)) continue;
            let slope = SL[y];
            if (slope >  FORM_SLOPE_MAX) slope =  FORM_SLOPE_MAX;
            if (slope < -FORM_SLOPE_MAX) slope = -FORM_SLOPE_MAX;
            const row = (((slope + FORM_SLOPE_MAX) / (2 * FORM_SLOPE_MAX) *
                          (FORM_S - 1) + 0.5) | 0) * FORM_U * 4;
            const invR = 1 / r;
            const x0 = Math.max(0, Math.ceil(cx - r));
            const x1 = Math.min(W - 1, Math.floor(cx + r));
            let o = (y * W + x0) * 4;
            for (let x = x0; x <= x1; x++, o += 4) {
                let ux = (((x - cx) * invR + 1) * US + 0.5) | 0;
                if (ux < 0) ux = 0;
                else if (ux > FORM_U - 1) ux = FORM_U - 1;
                const s = row + ux * 4;
                mulD[o]      = maps.mul[s];
                mulD[o + 1]  = maps.mul[s + 1];
                mulD[o + 2]  = maps.mul[s + 2];
                mulD[o + 3]  = 255;
                specD[o]     = maps.spec[s];
                specD[o + 1] = maps.spec[s + 1];
                specD[o + 2] = maps.spec[s + 2];
                specD[o + 3] = 255;
            }
        }
        _formMulCtx.putImageData(_formMulImg, 0, 0);
        _formSpecCtx.putImageData(_formSpecImg, 0, 0);

        ctx.save();
        buildPotPath(ctx);
        ctx.clip();
        ctx.globalCompositeOperation = "multiply";
        ctx.drawImage(_formMulCv, 0, 0, SHAPE.W, SHAPE.H);
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(_formSpecCv, 0, 0, SHAPE.W, SHAPE.H);
        ctx.globalCompositeOperation = "source-over";

        /* Gallery keeps its overhead spotlight — brightest at the
           shoulder, falling off downward, so a saved pot still reads as
           lit from the display case's lamp above. It's a purely vertical
           term, so unlike the old horizontal sheen it was never part of
           the flat-shading problem and carries over unchanged. */
        if (_galleryLighting) {
            const hl2 = currentClay().highlight;
            const tint2 = function (a) {
                return hl2.replace(/[\d.]+\)\s*$/, a.toFixed(3) + ")");
            };
            let wide = 0;
            for (let i = 0; i < N; i++) {
                if (clay[i].radius > wide) wide = clay[i].radius;
            }
            const topY = clay[N - 1].y - 4;
            const spotH = (SHAPE.baseY - clay[N - 1].y + 14) * 0.66;
            const spot = ctx.createLinearGradient(0, topY, 0, topY + spotH);
            spot.addColorStop(0.00, tint2(0.24));
            spot.addColorStop(0.55, tint2(0.07));
            spot.addColorStop(1.00, hl2.replace(/[\d.]+\)\s*$/, "0)"));
            ctx.fillStyle = spot;
            ctx.fillRect(cx - wide, topY, wide * 2, spotH);
        }
        ctx.restore();
    }

    /* ---- Pot rim / mouth ----
       The old version drew a flat dark ellipse + two strokes (one
       on the back of the rim, one on the outer perimeter). That
       reads as a cartoon hole. A more natural rim has THICKNESS
       — there's an outer wall, a top ring, and an inner wall, and
       each catches light differently.

       Layers (back-to-front):
       1. Inner cavity — radial fade from a darker inner-clay tone
          at the front lip down to near-black at the bottom of the
          hole; sells depth instead of a flat black disc.
       2. Lip ring — the visible top surface of the rim, an
          annulus between outer and inner ellipses. Filled with a
          lateral light->shadow gradient using the active clay's
          highlight + outline colors. This is the bit that makes
          the pot look thick.
       3. Front-lip catchlight — a thin warm stroke on the front
          arc of the inner ellipse where the rim catches the
          imaginary key light.
       (No more hard outer stroke; the lip-ring's gradient + the
       cavity fade carry the rim's edges.)                       */
    function drawRim(ctx) {
        const cx = SHAPE.centerX;
        const top = SHAPE.clay[SHAPE.N - 1];
        const mat = currentClay();
        const ry = top.radius * 0.20;
        const rxOuter = top.radius;
        const ryOuter = ry;
        /* Wall thickness — scales with pot size so wide pots get a
           proportional lip, narrow pots stay subtle. Clamped so
           tiny necks don't lose their hole entirely. */
        const wall = Math.max(2.5, Math.min(6, top.radius * 0.10));
        const rxInner = Math.max(2, rxOuter - wall);
        const ryInner = Math.max(0.8, ryOuter - wall * 0.20);

        /* ---- 1. Inner cavity ----
           Radial gradient from a clay-tinted lip color (top) down
           to near-black (center bottom of the hole). Falls inside
           the inner ellipse so the lip ring on top sits cleanly. */
        const cavityCx = cx;
        const cavityCy = top.y + ryInner * 0.35;   /* "bottom of hole" */
        const cavityGrad = ctx.createRadialGradient(
            cavityCx, cavityCy, 0,
            cavityCx, cavityCy, rxInner
        );
        cavityGrad.addColorStop(0,   "#08060a");
        cavityGrad.addColorStop(0.55, mat.outline);
        cavityGrad.addColorStop(1,    mat.unfired[1]);   /* inner wall tone */
        ctx.beginPath();
        ctx.ellipse(cx, top.y, rxInner, ryInner, 0, 0, Math.PI * 2);
        ctx.fillStyle = cavityGrad;
        ctx.fill();

        /* ---- 2. Lip ring ----
           Painted as a single ellipse fill (outer), then the inner
           ellipse cut out via destination-out. The fill uses a
           horizontal gradient mixing the clay's highlight (light
           side) and its outline tone (shadow side) so the lip
           reads as a 3D ring with a key light from the left. */
        ctx.save();
        const lipGrad = ctx.createLinearGradient(
            cx - rxOuter, top.y, cx + rxOuter, top.y
        );
        const hl = mat.highlight;
        /* Bump highlight alpha to ~0.7 for the lip — the body uses
           a subtler version, but the rim is where you'd see a
           wet-clay shine sharpest. */
        const lipLight = hl.replace(/[\d.]+\)\s*$/, "0.78)");
        const lipMid   = mat.unfired[2];
        const lipShade = mat.outline;
        lipGrad.addColorStop(0.00, lipLight);
        lipGrad.addColorStop(0.35, lipMid);
        lipGrad.addColorStop(1.00, lipShade);
        ctx.beginPath();
        ctx.ellipse(cx, top.y, rxOuter, ryOuter, 0, 0, Math.PI * 2);
        ctx.fillStyle = lipGrad;
        ctx.fill();
        /* Cut the cavity hole back out of the lip ring. */
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.ellipse(cx, top.y, rxInner, ryInner, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.restore();

        /* ---- 3. Front-lip catchlight ----
           Thin warm arc on the front (lower-half) of the inner
           ellipse where the lip would catch a key light. Keeps
           the rim visually crisp without resorting to a hard
           cartoon stroke. */
        ctx.strokeStyle = hl.replace(/[\d.]+\)\s*$/, "0.55)");
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(cx, top.y + 0.6, rxInner, ryInner,
                    0, 0.15, Math.PI - 0.15);
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
            const didShape = SHAPE.rimStroke
                ? applyRimPull(SHAPE.pointer, dt)
                : applyShaping(SHAPE.pointer, dt);
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
            /* Wheel only hums during the SHAPING phase, and only
               after the clay has been plopped onto the wheel. If
               the user is still in the "drag a lump" state the
               wheel is silent — placeLump() will kick the hum on
               the moment the splat lands. Re-entering shape with
               clay already on the wheel resumes the hum. */
            if (!SHAPE.needsLump) wheelHumStart();
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
            /* Decorate + kiln are silent on the wheel front, so
               we stop the hum here. Title / gallery handlers
               already stop it defensively too. */
            wheelHumStop();
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
    /* ============================================================
       STICKER SHEETS — sprite-sheet stamps + shop-card icons
       ============================================================
       Each themed pack has a single PNG + JSON in assets/stickers/:
         <sheetName>.png  — the sprite sheet (TexturePacker layout)
         <sheetName>.json — frame coords keyed by frame name
       The frame named after the sheet's theme is the SHOP CARD
       ICON; every other frame in the sheet is a BANK STAMP. The
       loader registers a PATTERN_DRAWERS entry per non-icon frame
       under a namespaced id "<sheet>/<frameId>" so two sheets can
       both have a frame called "heart" or "star" without
       colliding. GLAZE_PACKS.patterns arrays reference those
       namespaced ids. BASIC has no sheet — its stamps stay
       procedural (geometric outlines).
       ============================================================ */

    const STICKER_SHEETS = Object.create(null); /* sheetName -> {img, frames, iconFrame} */

    function makeSheetDrawer(rec, frameId) {
        return function (ctx, x, y, r, _color) {
            if (!rec || !rec.img || !rec.frames) return;
            if (!rec.img.complete || rec.img.naturalWidth === 0) return;
            const fr = rec.frames[frameId];
            if (!fr || !fr.frame) return;
            const sx = fr.frame.x, sy = fr.frame.y;
            const sw = fr.frame.w, sh = fr.frame.h;
            /* Fit into a 2r x 2r box, preserve sprite aspect. */
            const max = r * 2;
            const aspect = sw / sh;
            let dw = max, dh = max;
            if (aspect > 1) dh = max / aspect;
            else if (aspect < 1) dw = max * aspect;
            ctx.drawImage(rec.img, sx, sy, sw, sh,
                          x - dw / 2, y - dh / 2, dw, dh);
        };
    }

    /* Builder-pack sheets live in a "builder packs/" subfolder
       (Kelly's content organization). Everything else sits flat
       in assets/stickers/. encodeURI handles the space in the
       folder name so the fetch + Image src stay valid. */
    const STICKER_SHEET_DIRS = {
        plush:    "builder packs/",
        gamer:    "builder packs/",
        dinosaur: "builder packs/"
    };

    /* Override for sheets whose shop-card ICON frame is named
       differently from the sheet file. Most sheets name their
       icon frame after the sheet (candy.json has a "candy"
       frame); chickens.json's icon frame is the singular
       "chicken". The override tells the loader which frame to
       treat as the icon (skip from the stamp bank) + tells
       applyPackIconToCover which frame to paint. */
    const STICKER_ICON_FRAMES = {
        chickens: "chicken"
    };

    function stickerSheetPath(name, ext) {
        const dir = STICKER_SHEET_DIRS[name] || "";
        return encodeURI("assets/stickers/" + dir + name + "." + ext);
    }

    function loadStickerSheets() {
        const sheets = [
            /* crafter */
            "candy", "modded", "space", "breakfast", "music",
            /* builder (subfolder) */
            "plush", "gamer", "dinosaur",
            /* special */
            "mega", "chickens", "aliens", "literally-moons"
        ];
        sheets.forEach(function (name) {
            const img = new Image();
            img.src = stickerSheetPath(name, "png");
            const iconFrame = STICKER_ICON_FRAMES[name] || name;
            const rec = { img: img, frames: null, iconFrame: iconFrame };
            STICKER_SHEETS[name] = rec;
            fetch(stickerSheetPath(name, "json"))
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (manifest) {
                    if (!manifest || !manifest.frames) return;
                    rec.frames = manifest.frames;
                    Object.keys(manifest.frames).forEach(function (frameId) {
                        if (frameId === iconFrame) return;   /* icon, not a bank stamp */
                        PATTERN_DRAWERS[name + "/" + frameId] = makeSheetDrawer(rec, frameId);
                    });
                    if (currentScreen === "decorate" &&
                        typeof buildToolUI === "function") {
                        buildToolUI();
                    }
                    if (currentScreen === "shop" &&
                        typeof refreshShopScreen === "function") {
                        refreshShopScreen();
                    }
                })
                .catch(function (e) {
                    console.warn("[CRAYte] sticker manifest failed: " + name, e);
                });
        });
    }

    /* Paint the icon frame from a sheet onto a small canvas and
       drop it into a shop-card cover element. Called from
       buildShopCard; no-op if the pack has no sheet (BASIC) OR
       the sheet hasn't loaded yet (the emoji fallback stays
       visible until the upgrade happens). */
    function applyPackIconToCover(coverEl, pack) {
        if (!coverEl || !pack || !pack.sheet) return;
        const rec = STICKER_SHEETS[pack.sheet];
        if (!rec) return;
        function paint() {
            if (!rec.img.complete || !rec.frames) return false;
            const fr = rec.frames[rec.iconFrame];
            if (!fr || !fr.frame) return false;
            const SIZE = 56;   /* matches .shop-cover (48px on phones, both fit) */
            const c = document.createElement("canvas");
            c.width = SIZE; c.height = SIZE;
            const ctx = c.getContext("2d");
            const sw = fr.frame.w, sh = fr.frame.h;
            const aspect = sw / sh;
            let dw = SIZE, dh = SIZE;
            if (aspect > 1) dh = SIZE / aspect;
            else if (aspect < 1) dw = SIZE * aspect;
            ctx.drawImage(rec.img, fr.frame.x, fr.frame.y, sw, sh,
                          (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
            c.style.width = "100%";
            c.style.height = "100%";
            c.style.objectFit = "contain";
            coverEl.textContent = "";
            coverEl.appendChild(c);
            return true;
        }
        if (!paint()) {
            rec.img.addEventListener("load", paint, { once: true });
        }
    }

    loadStickerSheets();

    const GLAZE_PACKS = [
        /* ============================================================
           6 FREE PACKS — 7 glazes + 5 stamps each.
           ============================================================ */
        {
            id: "core",  label: "BASIC",
            packType: "crafter",
            backgroundSvg: "core",    /* assets/backgrounds/core.svg (optional) */
            surfaceTextures: ["basic", "basic-feathers", "basic-pattern"],
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
            glazeNames: [
                "DARK CLAY", "SIENNA", "TERRACOTTA", "AMBER",
                "MILK WHITE", "SAGE", "INK"
            ],
            patterns: ["dot", "ring", "star", "chevron", "wave"]
        },
        {
            id: "candy", label: "CANDY",
            packType: "crafter",
            sheet: "candy",
            surfaceTextures: ["candy", "candy-chocolate", "candy-lemon"],
            backgroundSvg: "candy",    /* assets/backgrounds/candy.svg (optional) */
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
            glazeNames: [
                "CHERRY RED", "BLUE RASPBERRY", "SOUR GREEN",
                "COTTON CANDY", "ROOT BEER", "CREAMSICLE",
                "GRAPE SODA"
            ],
            patterns: ["candy/jawbreaker", "candy/hardcandy",
                       "candy/licorice", "candy/gummybear",
                       "candy/jellybean"]
        },
        {
            id: "plushie", label: "PLUSH",
            packType: "builder",   /* parts build a teddy bear */
            buildSubject: "bear",
            sheet: "plush",   /* sheet file is named "plush", pack id is "plushie" */
            surfaceTextures: ["builder/plushie", "builder/plushie-blue", "builder/plushie-pink"],
            unlock: "points",   /* earned, not bought — unlocked with sparks */
            sparkCost: 250,     /* cheapest points pack — first goal */
            backgroundSvg: "plush",    /* assets/backgrounds/plush.svg (optional) */
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
            glazeNames: [
                "TEDDY BROWN", "PASTEL PINK", "SOFT CREAM",
                "LAVENDER", "SKY BLUE", "PEACH", "MINT"
            ],
            /* Bear-building parts: place the eyes, nose, mouth,
               ears + a heart to assemble a teddy face on the pot. */
            patterns: ["plush/eyes", "plush/heart", "plush/mouth",
                       "plush/nose", "plush/ear"]
        },
        {
            id: "modded", label: "MODDED",
            packType: "crafter",
            sheet: "modded",
            surfaceTextures: ["modded", "modded-aluminum", "modded-led"],
            unlock: "points",   /* earned, not bought — unlocked with sparks */
            sparkCost: 800,     /* flashiest points pack — the big goal */
            backgroundSvg: "modded",   /* assets/backgrounds/modded.svg (optional) */
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
            glazeNames: [
                "RGB CYCLE", "NEON GREEN", "HOT PINK",
                "ELECTRIC BLUE", "BLACK OPS",
                "BRUSHED ALUMINUM", "CYBER VIOLET"
            ],
            /* Frame names match modded.json's re-exported sheet
               (cap/ic/led/resistors/wires; "modded" is the shop
               icon, excluded from the bank). The old robotic/disc/
               icon/reader/laptop names no longer exist in the sheet,
               so they resolved to undefined drawers = blank stamps. */
            patterns: ["modded/cap", "modded/ic", "modded/led",
                       "modded/resistors", "modded/wires"]
        },
        {
            id: "gamer", label: "GAMER",
            packType: "builder",   /* parts build a handheld console */
            buildSubject: "handheld console",
            sheet: "gamer",
            surfaceTextures: ["builder/gamer", "builder/gamer-black", "builder/gamer-crt"],
            backgroundSvg: "gamer",    /* assets/backgrounds/gamer.svg (optional) */
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
            glazeNames: [
                "CRT GREEN", "RETRO ORANGE", "ARCADE PINK",
                "SCANLINE GRAY", "HI-SCORE YELLOW",
                "PIXEL PURPLE", "ATARI BROWN"
            ],
            /* Console-building parts: screen, d-pad, buttons,
               joystick + start/select to assemble a handheld. */
            patterns: ["gamer/screen", "gamer/dpad", "gamer/buttons",
                       "gamer/joystick", "gamer/startselect"]
        },
        {
            id: "space", label: "SPACE",
            packType: "crafter",
            sheet: "space",
            surfaceTextures: ["space", "space-galaxy", "space-blackhole"],
            backgroundSvg: "space",    /* assets/backgrounds/space.svg (optional) */
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
            glazeNames: [
                "COSMIC VOID", "NEBULA VIOLET", "GALACTIC PURPLE",
                "SUPERNOVA BLUE", "STARFIELD WHITE",
                "QUASAR GOLD", "COMET CYAN"
            ],
            patterns: ["space/galaxy", "space/star", "space/meteor",
                       "space/comet", "space/moon"]
        },

        /* ============================================================
           4 PAID PACKS
           ============================================================
           99¢ each except MEGA at $1.99 (double-size: 14 glazes /
           10 stamps). releaseDate omitted = available now (no
           "DROPS <date>" gate on the shop card).

           Stamp ids reference frames in assets/stickers/<sheet>.json
           via the namespaced "<sheet>/<frame>" form. Sheets are
           loaded by loadStickerSheets() above.
           ============================================================ */
        {
            id: "dinosaur", label: "DINOSAUR",
            packType: "builder",   /* parts build a dinosaur */
            buildSubject: "dino",
            sheet: "dinosaur",
            surfaceTextures: ["builder/dinosaur", "builder/dinosaur-blue", "builder/dinosaur-purpleorange"],
            backgroundSvg: "dinosaur", /* assets/backgrounds/dinosaur.svg (optional) */
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
            glazeNames: [
                "FOSSIL BONE", "AMBER SAND", "AMBER",
                "JUNGLE GREEN", "DIRT BROWN",
                "SWAMP SHADOW", "T-REX RED"
            ],
            patterns: ["dinosaur/paws", "dinosaur/scales",
                       "dinosaur/teeth", "dinosaur/nostrils",
                       "dinosaur/eyes"]
        },
        {
            id: "breakfast", label: "BREAKFAST",
            packType: "crafter",
            sheet: "breakfast",
            surfaceTextures: ["breakfast-egg", "breakfast-pancake", "breakfast-strawberry"],
            unlock: "points",   /* earned, not bought — unlocked with sparks */
            sparkCost: 500,     /* mid-tier points pack */
            backgroundSvg: "breakfast",/* assets/backgrounds/breakfast.svg (optional) */
            description: "Maple syrup, golden butter, berry jam, espresso.",
            coverEmoji: "\u{1F95E}",   /* pancakes */
            glazes: [
                "#7a3a18",   /* maple syrup */
                "#e4b13e",   /* golden butter */
                "#c84a3a",   /* berry jam */
                "#3a1e10",   /* espresso */
                "#fff4e0",   /* cream */
                "#cdb98a",   /* oat */
                "#a07050"    /* toast */
            ],
            glazeNames: [
                "MAPLE SYRUP", "GOLDEN BUTTER", "BERRY JAM",
                "ESPRESSO", "CREAM", "OAT", "TOAST"
            ],
            patterns: ["breakfast/bigbowl", "breakfast/waffles",
                       "breakfast/pancakes", "breakfast/frenchtoast",
                       "breakfast/fruitbowl"]
        },
        {
            id: "music", label: "MUSIC",
            packType: "crafter",
            sheet: "music",
            surfaceTextures: ["music", "music-neon", "music-vinyl"],
            backgroundSvg: "music",    /* assets/backgrounds/music.svg (optional) */
            description: "Vinyl black, brass, neon stage lights.",
            coverEmoji: "\u{1F3B5}",   /* musical note */
            priceCents: 99,
            glazes: [
                "#0a0a0a",   /* vinyl black */
                "#b87333",   /* brass */
                "#ff2a8a",   /* stage pink */
                "#2b6fff",   /* spotlight blue */
                "#33ff66",   /* neon green */
                "#ffea00",   /* amp yellow */
                "#c0c0c0"    /* mic chrome */
            ],
            glazeNames: [
                "VINYL BLACK", "BRASS", "STAGE PINK",
                "SPOTLIGHT BLUE", "NEON GREEN",
                "AMP YELLOW", "MIC CHROME"
            ],
            patterns: ["music/blue", "music/orange", "music/red",
                       "music/pink", "music/green"]
        },
        /* ============================================================
           MEGA PACKS — chickens / aliens / moons. $1.99 each. Bigger
           sets: 10 glazes + 8+ stamps + 3 textures. (The old generic
           "MEGA" pack was removed; these themed packs ARE the mega
           tier now.) Descriptions are placeholders — final copy TBD.
           ============================================================ */
        {
            id: "chickens", label: "CHICKENS",
            packType: "special",
            sheet: "chickens",
            surfaceTextures: ["chickens", "chickens-clay", "chickens-skin"],
            backgroundSvg: "chickens", /* assets/backgrounds/chickens.svg (optional) */
            description: "Ten hen-house glazes and a whole flock of costume stamps — ninja, pirate, astronaut, robocluck and more. Dress your pot's very own chicken.",
            coverEmoji: "\u{1F414}",   /* chicken */
            priceCents: 199,
            glazes: [
                "#f4f0e6",   /* hen white */
                "#c8923a",   /* feed gold */
                "#d23b2a",   /* comb red */
                "#ffb000",   /* beak orange */
                "#6b4a2a",   /* coop brown */
                "#3f8a4a",   /* pasture green */
                "#2a2a2a",   /* rooster black */
                "#8fb8d6",   /* coop sky — costume range */
                "#b6ff3a",   /* neon cluck */
                "#8a4fff"    /* cyber violet */
            ],
            glazeNames: [
                "HEN WHITE", "FEED GOLD", "COMB RED",
                "BEAK ORANGE", "COOP BROWN", "PASTURE GREEN",
                "ROOSTER BLACK", "COOP SKY", "NEON CLUCK",
                "CYBER VIOLET"
            ],
            patterns: [
                "chickens/magician", "chickens/ninja", "chickens/gears",
                "chickens/pirate", "chickens/neon", "chickens/robocluck",
                "chickens/cyborg", "chickens/christmas", "chickens/halloween",
                "chickens/astronaut", "chickens/comboy"
            ]
        },
        {
            id: "aliens", label: "ALIENS",
            packType: "special",
            sheet: "aliens",
            surfaceTextures: ["aliens", "aliens-mars", "aliens-venus"],
            backgroundSvg: "aliens",   /* assets/backgrounds/aliens.svg (optional) */
            description: "Cosmic greens, ray-gun cyans and saucer chrome, plus eight little visitors from far-off worlds. Beam an alien onto your pot.",
            coverEmoji: "\u{1F47D}",   /* alien */
            priceCents: 199,
            glazes: [
                "#7CFC00",   /* alien green */
                "#9b30ff",   /* cosmic violet */
                "#00e5ff",   /* ray cyan */
                "#ff2e88",   /* nebula pink */
                "#c0c0c0",   /* saucer chrome */
                "#1b1b3a",   /* deep space */
                "#ffe600",   /* tractor-beam yellow */
                "#c8472e",   /* martian red — matches aliens-mars */
                "#e6c15c",   /* venus gold — matches aliens-venus */
                "#4fe0a0"    /* slime green */
            ],
            glazeNames: [
                "ALIEN GREEN", "COSMIC VIOLET", "RAY CYAN",
                "NEBULA PINK", "SAUCER CHROME", "DEEP SPACE",
                "BEAM YELLOW", "MARTIAN RED", "VENUS GOLD",
                "SLIME GREEN"
            ],
            patterns: [
                "aliens/alien-one", "aliens/alien-two",
                "aliens/alien-three", "aliens/alien-four",
                "aliens/alien-five", "aliens/alien-six",
                "aliens/alien-seven", "aliens/alien-eight"
            ]
        },
        {
            id: "moons", label: "MOONS",
            packType: "special",
            sheet: "literally-moons",   /* sheet file is hyphenated */
            surfaceTextures: ["literally-moons", "literally-moons-sponge", "literally-moons-stars"],
            backgroundSvg: "moons",    /* assets/backgrounds/moons.svg (optional) */
            description: "Ten lunar glazes from lunar grey to comet gold, with a sky full of moons in every phase and color. Give your pot the whole night sky.",
            coverEmoji: "\u{1F319}",   /* crescent moon */
            priceCents: 199,
            glazes: [
                "#d8d2c4",   /* lunar grey */
                "#8a6fc4",   /* moon violet */
                "#ff8c42",   /* moon orange */
                "#ff7ab0",   /* moon pink */
                "#39c0d8",   /* moon cyan */
                "#3a6fff",   /* moon blue */
                "#0a0a1f",   /* void black */
                "#e0524a",   /* moon red — matches moon-red stamp */
                "#5ad07a",   /* moon green — matches moon-green stamp */
                "#f2c84b"    /* comet gold */
            ],
            glazeNames: [
                "LUNAR GREY", "MOON VIOLET", "MOON ORANGE",
                "MOON PINK", "MOON CYAN", "MOON BLUE",
                "VOID BLACK", "MOON RED", "MOON GREEN",
                "COMET GOLD"
            ],
            patterns: [
                "literally-moons/moon-violet", "literally-moons/moon-orange",
                "literally-moons/moon-pink", "literally-moons/moon-red",
                "literally-moons/moon-cyan", "literally-moons/moon-blue",
                "literally-moons/moon-green",
                "literally-moons/comet-yellow", "literally-moons/comet-blue",
                "literally-moons/comet-purple", "literally-moons/comet-red"
            ]
        }
    ];

    /* Kick off async loading of every pack's surface texture PNG
       now that GLAZE_PACKS is populated. Packs without a
       surfaceTexture field are silently skipped. */
    loadSurfaceTextures(GLAZE_PACKS);

    const D = {
        canvas: null,
        ctx: null,
        paintCanvas: null,   /* offscreen — accumulates brush/spray/splat
                                strokes ONLY. Stamps moved to D.stickers
                                + D.stickerCanvas in the v1.1 move-tool
                                refactor so they can be picked back up
                                and dragged after placement. */
        paintCtx: null,

        /* Sticker layer — vector records + a derived raster canvas.
           D.stickers is the source of truth (x, y, r, rot, flipH,
           pattern, color); D.stickerCanvas is just a cached raster
           of those records, re-rendered whenever the array changes.
           Render order in renderPotScene: paintCanvas -> stickerCanvas.
           MOVE tool hit-tests against D.stickers (reverse order so
           the top-most sticker picks first). */
        stickers: [],
        stickerCanvas: null,
        stickerCtx: null,

        /* SCOOT (move) drag state — non-null only between a pointerdown
           on a sticker and the following pointerup. Holds the sticker
           reference + the pointer-to-sticker offset so the drag doesn't
           snap to the cursor center. */
        movingSticker: null,

        /* --- Dip glaze + band decoration (ported from Slip Studio) ---
           dips : ordered list of glaze coats, each covering from the
                  RIM down to a coverage line. Overlapping dips react
                  into an emergent third colour (see reactGlaze). Entry
                  shapes: { color, cover, drips, seed } freehand, or
                  { preset } for a one-tap gradient. Rendered UNDER the
                  brush/stamp decoration so kids can still draw on a
                  glazed pot.
           bands: ordered list of frieze stripes, each { id, cy, h }
                  (cy = centre height fraction, h = thickness fraction).
                  Rendered as a horizontally-repeating band. */
        dips: [],
        bands: [],
        dipDrag: null,        /* in-progress freehand dip during a drag */
        movingBand: null,     /* { band, grabFrac } while dragging a band */
        dripAmount: 1,        /* 0=off, 1=few, 2=lots — new dips inherit this */
        bandFriezeId: null,   /* frieze chosen for the next band placement */

        dpr: 1,

        activePackId: "core",
        glaze:   "#cc6633",
        tool:    "brush",     /* "brush" | "stamp" | "eraser" */
        size:    14,          /* logical-px stroke half-thickness */
        pattern: "dot",
        stampRotation: 0,     /* radians — applied in stampAt */
        stampFlipH: false,    /* horizontal mirror — applied in stampAt
                                 alongside rotation. Sheet-backed stamps
                                 like a left-facing dolphin become a
                                 right-facing dolphin without authoring
                                 a separate frame. */

        /* Surface texture (TEXTURE button) — applies the named
           pack's tilable PNG over the entire pot's painted body.
           Null = no skin applied. Stored as the source pack id
           (not file name) so save/load picks up the right asset
           even if the file name -> pack mapping changes. */
        surfaceTexturePackId: null,

        /* Draft tracking — when the kid hits SAVE in decorate
           without firing, the entry is stored with draft:true
           and its id is captured here so subsequent SAVEs update
           the SAME entry (instead of producing five copies).
           Cleared on CLEAR + on fresh-pot flows + on successful
           firing (the draft becomes a fired pot, mutated in
           place). Set by resumeDraft() when the user re-opens
           a draft from the gallery. */
        draftId: null,

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
        try {
            /* v1.1 — snapshot captures BOTH layers so undo
               restores the full decorate state, not just the
               brush pixels. The sticker array is shallow-cloned
               (deep enough for our flat records). */
            return {
                paint: D.paintCanvas.toDataURL("image/png"),
                stickers: (D.stickers || []).map(function (s) {
                    return {
                        pattern: s.pattern, x: s.x, y: s.y, r: s.r,
                        rot: s.rot || 0, flipH: !!s.flipH,
                        color: s.color || null
                    };
                }),
                /* Dip coats + bands travel with undo so NUKE/UNDID
                   restore the full decorate state. */
                dips: (D.dips || []).map(function (d) {
                    return d.preset ? { preset: d.preset }
                        : { color: d.color, cover: d.cover,
                            drips: d.drips || 0, seed: d.seed || 1,
                            rgb: d.rgb ? d.rgb.slice() : null };
                }),
                bands: (D.bands || []).map(function (b) {
                    return { id: b.id, cy: b.cy, h: b.h };
                })
            };
        } catch (e) {
            console.warn("[CRAYte] snapshot failed", e);
            return null;
        }
    }

    /* Replace BOTH layers from a snapshot taken via snapshotPaint:
         - paint:    dataURL goes into D.paintCanvas (raster brush)
         - stickers: array goes into D.stickers (vector records)
       The dataURL paste is paint-only; the sticker layer is then
       re-rendered from the restored records. */
    function restorePaintFromDataURL(snapshot, onDone) {
        if (!snapshot || !D.paintCtx) { if (onDone) onDone(); return; }
        /* Backward-compat: pre-v1.1 callers passed a plain dataURL
           string instead of a {paint, stickers} object. Wrap it
           so the same code path handles both. */
        if (typeof snapshot === "string") snapshot = { paint: snapshot, stickers: [] };
        const img = new Image();
        img.onload = function () {
            D.paintCtx.save();
            D.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
            D.paintCtx.clearRect(0, 0,
                D.paintCanvas.width, D.paintCanvas.height);
            D.paintCtx.drawImage(img, 0, 0);
            D.paintCtx.restore();
            D.stickers = (snapshot.stickers || []).map(function (s) {
                return {
                    pattern: s.pattern, x: s.x, y: s.y, r: s.r,
                    rot: s.rot || 0, flipH: !!s.flipH,
                    color: s.color || null
                };
            });
            /* Restore dip coats + bands from the snapshot (absent on
               pre-dip snapshots → cleared, which is correct). */
            D.dips = (snapshot.dips || []).map(function (d) {
                return d.preset ? { preset: d.preset }
                    : { color: d.color, cover: d.cover,
                        drips: d.drips || 0, seed: d.seed || 1,
                        rgb: d.rgb ? d.rgb.slice() : dipHexToRgb(d.color) };
            });
            D.bands = (snapshot.bands || []).map(function (b) {
                return { id: b.id, cy: b.cy, h: b.h };
            });
            D.dipDrag = null;
            D.movingBand = null;
            if (typeof renderStickerLayer === "function") renderStickerLayer();
            if (onDone) onDone();
        };
        img.src = snapshot.paint;
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

    /* MEGA pack stamps + every themed pack's stamps now load via
       the unified STICKER_SHEETS / loadStickerSheets() module above
       (PATTERN_DRAWERS["<sheet>/<frame>"] entries are registered as
       each TexturePacker manifest finishes parsing). The old
       per-PNG MEGA_STAMP_FILES manifest in assets/patterns/ is
       retired. */

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

    /* ============================================================
       DIP GLAZE + BAND DECORATION  (ported from Slip Studio)
       ------------------------------------------------------------
       Dips coat the pot from the RIM downward to a coverage line;
       overlapping dips blend into an emergent third colour; drips
       hang below the line. Bands are frieze stripes wrapped around
       the pot. Everything renders straight onto the scene ctx,
       clipped to the pot silhouette — no extra offscreen canvas.
       ============================================================ */

    function dipHexToRgb(hex) {
        if (typeof hex !== "string") return [200, 120, 80];
        /* Support hsl() (rgb-cycle glaze) by sampling via a scratch. */
        if (hex[0] !== "#") {
            _dipParseCtx = _dipParseCtx ||
                document.createElement("canvas").getContext("2d");
            _dipParseCtx.fillStyle = hex;
            hex = _dipParseCtx.fillStyle;   /* normalized to #rrggbb */
        }
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    let _dipParseCtx = null;

    /* Emergent glaze chemistry: two overlapping coats fire into a
       muddier/mixed third colour (geometric mean per channel, with a
       faint saturation lift so the result never goes flat grey). */
    function reactGlaze(a, b) {
        const mix = [
            Math.round(Math.sqrt(a[0] * b[0])),
            Math.round(Math.sqrt(a[1] * b[1])),
            Math.round(Math.sqrt(a[2] * b[2]))
        ];
        const avg = (mix[0] + mix[1] + mix[2]) / 3;
        for (let i = 0; i < 3; i++) {
            mix[i] = Math.max(0, Math.min(255, Math.round(mix[i] + (mix[i] - avg) * 0.18)));
        }
        return mix;
    }

    /* One-tap full-height gradient dips. Stops are rim -> foot. */
    /* One-tap gradient pours. Stops run rim -> foot. These are pure
       colour data — no art, no download weight — and deliberately NOT
       pack-gated: every pour is free for everyone, which is where the
       generosity in this game should live. A pour recolours the whole
       pot, so each one is a genuinely different finished piece.
       Saves store only the preset id and placePresetDip() ignores an id
       it doesn't know, so adding to this table is backward-compatible
       and removing from it can never corrupt an old pot. */
    const DIP_PRESETS = {
        /* the original four — kept first so existing muscle memory holds */
        rainbow:  ["#ff3b3b", "#ff9e2c", "#ffe14d", "#3fd067", "#3aa0ff", "#8a5cff"],
        sunset:   ["#ffd36b", "#ff9a4d", "#ff5e7e", "#8a4f8f"],
        ocean:    ["#bff7ff", "#4fc8e0", "#2b7bd0", "#123a86"],
        ember:    ["#ffe8a3", "#ff9b3d", "#e0431f", "#611015"],
        /* warm */
        terra:    ["#f4d9a8", "#dda15e", "#bc6c25", "#6b3410"],
        honey:    ["#fff6d6", "#ffd98a", "#e8a33d", "#8a5216"],
        lava:     ["#2b0a06", "#7a1c0c", "#e0431f", "#ffd24a"],
        /* pink + purple */
        bubble:   ["#fff0f7", "#ffb3d9", "#ff5ea8", "#c11e6e"],
        orchid:   ["#ffe3f5", "#ff9ad5", "#c060c8", "#5c2a7a"],
        plum:     ["#f6e0ef", "#c98ac0", "#8a3a76", "#3a1030"],
        /* green */
        meadow:   ["#eaf7a8", "#9fd45c", "#4a9b46", "#1e5a2e"],
        mint:     ["#f2fff9", "#b8f0d8", "#6dc9a8", "#2b7a63"],
        forest:   ["#dff0c8", "#8fbf6a", "#3f7a3a", "#14351c"],
        /* cool */
        frost:    ["#ffffff", "#dff4ff", "#a8d8f0", "#6fa8c8"],
        storm:    ["#dfe9f2", "#9fb3c8", "#5a7a99", "#22303f"],
        midnight: ["#cfe0ff", "#5a7fd6", "#26356e", "#080c1e"]
    };
    const DIP_PRESET_ORDER = [
        { id: "rainbow",  label: "RAINBOW" },
        { id: "sunset",   label: "SUNSET" },
        { id: "ocean",    label: "OCEAN" },
        { id: "ember",    label: "EMBER" },
        { id: "terra",    label: "TERRA" },
        { id: "honey",    label: "HONEY" },
        { id: "lava",     label: "LAVA" },
        { id: "bubble",   label: "BUBBLE" },
        { id: "orchid",   label: "ORCHID" },
        { id: "plum",     label: "PLUM" },
        { id: "meadow",   label: "MEADOW" },
        { id: "mint",     label: "MINT" },
        { id: "forest",   label: "FOREST" },
        { id: "frost",    label: "FROST" },
        { id: "storm",    label: "STORM" },
        { id: "midnight", label: "MIDNIGHT" }
    ];

    /* Band friezes (reused from Slip Studio, covered by the studio's
       rawpixel license). File ids resolved via bandSrc(). */
    const BAND_FRIESES = [
        "element-download--1783299972",
        "element-download--1783300000",
        "element-download--1783300035",
        "element-download--1783300065",
        "element-download--1783300399",
        "element-download--1783300461"
    ];
    const BAND_IMAGES = {};   /* id -> HTMLImageElement (async) */
    function bandSrc(id) { return "assets/bands/" + id + ".png"; }
    function loadBandImages() {
        BAND_FRIESES.forEach(function (id) {
            if (BAND_IMAGES[id]) return;
            const img = new Image();
            img.src = bandSrc(id);
            BAND_IMAGES[id] = img;
        });
    }
    /* Preload frieze art at module init so gallery thumbnails render
       bands even if the gallery is opened before the decorate stage. */
    loadBandImages();

    /* Pot vertical geometry in logical px, honouring the active rim
       style + height. rimY = top lip, footY = base on the wheel. */
    function potGeom() {
        const clay = SHAPE.clay;
        const N = clay.length;
        const rimY = clay[N - 1].y;
        const footY = clay[0].y;
        return { clay: clay, N: N, rimY: rimY, footY: footY,
                 span: Math.max(1, footY - rimY) };
    }

    /* Pot radius at a logical y, interpolated between clay samples.
       clay[0] is the base (largest y), clay[N-1] the rim (smallest). */
    function radiusAtY(y) {
        const clay = SHAPE.clay;
        if (!clay) return 0;
        const N = clay.length;
        if (y >= clay[0].y)     return clay[0].radius;
        if (y <= clay[N - 1].y) return clay[N - 1].radius;
        for (let i = 0; i < N - 1; i++) {
            const a = clay[i], b = clay[i + 1];   /* a.y > b.y */
            if (y <= a.y && y >= b.y) {
                const f = (a.y - y) / ((a.y - b.y) || 1);
                return a.radius + (b.radius - a.radius) * f;
            }
        }
        return clay[N - 1].radius;
    }

    /* Deterministic drip tendrils hanging below a dip's line. */
    function makeDrips(seed, amount) {
        if (!amount) return [];
        const rand = mulberry32(seed || 1);
        const count = amount === 2 ? (6 + Math.floor(rand() * 4))
                                   : (2 + Math.floor(rand() * 2));
        const drips = [];
        for (let i = 0; i < count; i++) {
            drips.push({
                x:   0.08 + rand() * 0.84,        /* fraction across width */
                len: 0.10 + rand() * 0.30,        /* fraction of pot span  */
                w:   4 + rand() * 6,
                bead: 0.6 + rand() * 0.9
            });
        }
        return drips;
    }

    /* Alpha of a dip's coat at row y: solid above the line, a short
       feather just below it, nothing lower. */
    function dipCoverageAlpha(lineY, y) {
        const FEATHER = 11;
        if (y <= lineY) return 1;
        if (y <= lineY + FEATHER) return 1 - (y - lineY) / FEATHER;
        return 0;
    }

    /* Paint a dip list onto ctx (already in logical 400x600 space),
       clipped to the pot silhouette. Handles presets, per-row
       chemistry for overlapping freehand coats, and drips. */
    function compositeDips(ctx, dips) {
        if (!dips || !dips.length) return;
        const g = potGeom();
        ctx.save();
        buildPotPath(ctx);
        ctx.clip();

        /* Preset gradients render first as a base coat. */
        for (let i = 0; i < dips.length; i++) {
            const d = dips[i];
            if (!d.preset) continue;
            const stops = DIP_PRESETS[d.preset];
            if (!stops) continue;
            const grad = ctx.createLinearGradient(0, g.rimY, 0, g.footY);
            for (let s = 0; s < stops.length; s++) {
                grad.addColorStop(s / (stops.length - 1), stops[s]);
            }
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = grad;
            ctx.fillRect(0, g.rimY, SHAPE.W, g.footY - g.rimY + 2);
            ctx.globalAlpha = 1;
        }

        /* Freehand coats: precompute each line + rgb. */
        const coats = [];
        for (let i = 0; i < dips.length; i++) {
            const d = dips[i];
            if (d.preset) continue;
            coats.push({
                lineY: g.rimY + Math.max(0, Math.min(1, d.cover)) * g.span,
                rgb:   d.rgb || dipHexToRgb(d.color),
                drips: d.drips || 0,
                seed:  d.seed || 1
            });
        }
        if (coats.length) {
            for (let y = Math.floor(g.rimY); y <= g.footY; y++) {
                let rgb = null, aMax = 0;
                for (let c = 0; c < coats.length; c++) {
                    const a = dipCoverageAlpha(coats[c].lineY, y);
                    if (a <= 0) continue;
                    rgb = rgb ? reactGlaze(rgb, coats[c].rgb) : coats[c].rgb.slice();
                    if (a > aMax) aMax = a;
                }
                if (rgb && aMax > 0) {
                    ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," +
                                    rgb[2] + "," + (0.86 * aMax).toFixed(3) + ")";
                    ctx.fillRect(0, y, SHAPE.W, 1);
                }
            }
            /* Drips on top, in each coat's colour. */
            for (let c = 0; c < coats.length; c++) {
                if (!coats[c].drips) continue;
                const rgb = coats[c].rgb;
                ctx.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," +
                                rgb[2] + ",0.86)";
                const drips = makeDrips(coats[c].seed, coats[c].drips);
                /* Spread drips across the POT's width at the dip line, not
                   across the whole 400px canvas. Spreading over SHAPE.W put
                   most runs outside the silhouette, where the clip threw
                   them away — with FEW's 2-3 drips that regularly left a
                   dip with no visible drips at all. 0.82 keeps the bead off
                   the very edge, where a run would read as the outline
                   rather than as glaze on the face. */
                const rLine = Math.max(1, radiusAtY(coats[c].lineY) * 0.82);
                for (let k = 0; k < drips.length; k++) {
                    const dr = drips[k];
                    const x = SHAPE.centerX + (dr.x * 2 - 1) * rLine;
                    const y0 = coats[c].lineY;
                    const y1 = Math.min(g.footY, y0 + dr.len * g.span);
                    ctx.beginPath();
                    ctx.moveTo(x - dr.w / 2, y0);
                    ctx.lineTo(x + dr.w / 2, y0);
                    ctx.lineTo(x + dr.w / 2, y1);
                    ctx.arc(x, y1, dr.w / 2, 0, Math.PI);
                    ctx.lineTo(x - dr.w / 2, y0);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(x, y1, dr.w * 0.5 * dr.bead, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }

    /* Paint frieze bands onto ctx, clipped to the pot silhouette.
       Each band repeats horizontally across the pot width. */
    function compositeBands(ctx, bands) {
        if (!bands || !bands.length) return;
        const g = potGeom();
        ctx.save();
        buildPotPath(ctx);
        ctx.clip();
        for (let i = 0; i < bands.length; i++) {
            const b = bands[i];
            const img = BAND_IMAGES[b.id];
            if (!img || !img.complete || !img.naturalWidth) continue;
            const h = Math.max(8, b.h * g.span);
            const cy = g.rimY + b.cy * g.span;
            const top = cy - h / 2;
            /* Tile width keeps the frieze's aspect ratio. */
            const tileW = h * (img.naturalWidth / img.naturalHeight);
            const reps = Math.ceil(SHAPE.W / tileW) + 1;
            for (let r = 0; r < reps; r++) {
                ctx.drawImage(img, r * tileW, top, tileW, h);
            }
        }
        ctx.restore();
    }

    /* --- Dip + band interaction (pointer-driven) --- */

    /* Pointer y -> coverage fraction (0 at rim, 1 at foot). */
    function coverFracFromY(y) {
        const g = potGeom();
        return Math.max(0, Math.min(1, (y - g.rimY) / g.span));
    }

    /* Begin a freehand dip on drag: adds a live coat whose lower edge
       tracks the finger. Colour = current glaze; drips = current pref. */
    function dipDragStart(p) {
        const coat = {
            color: (D.glaze === "@rgb-cycle") ? currentPaintColor() : D.glaze,
            cover: coverFracFromY(p.y),
            drips: D.dripAmount,
            seed:  Math.floor(Math.random() * 1e9) || 1
        };
        coat.rgb = dipHexToRgb(coat.color);
        D.dips.push(coat);
        D.dipDrag = coat;
    }
    function dipDragTo(p) {
        if (D.dipDrag) D.dipDrag.cover = coverFracFromY(p.y);
    }
    /* A tap places a coat reaching from the rim down to the tap. */
    function placeDipTap(p) {
        dipDragStart(p);
        D.dipDrag = null;
    }
    /* One-tap gradient pour — replaces any existing preset, keeps
       freehand coats layered on top. */
    function placePresetDip(presetId) {
        if (!DIP_PRESETS[presetId]) return;
        pushUndoSnapshot();
        D.dips = D.dips.filter(function (d) { return !d.preset; });
        D.dips.unshift({ preset: presetId });
        haptic(8);
    }

    /* Band hit-test (topmost first) + move. */
    function hitTestBand(p) {
        const g = potGeom();
        for (let i = D.bands.length - 1; i >= 0; i--) {
            const b = D.bands[i];
            const cy = g.rimY + b.cy * g.span;
            const half = (b.h * g.span) / 2 + 6;
            if (p.y >= cy - half && p.y <= cy + half) {
                return { band: b, index: i };
            }
        }
        return null;
    }
    function moveBandTo(p) {
        if (!D.movingBand) return;
        D.movingBand.band.cy = Math.max(0.06, Math.min(0.94, coverFracFromY(p.y)));
    }
    function placeBandTap(p) {
        const id = D.bandFriezeId || BAND_FRIESES[0];
        D.bandFriezeId = id;
        loadBandImages();
        D.bands.push({ id: id, cy: Math.max(0.1, Math.min(0.9, coverFracFromY(p.y))), h: 0.15 });
        haptic(8);
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

        /* Sticker layer — separate offscreen so stamps can be
           rebuilt from D.stickers[] records whenever the array
           changes (move-tool drag, undo, gallery load) without
           disturbing the persistent brush/spray/splat pixels in
           paintCanvas. Same DPR + transform as paintCanvas; sized
           in sizeDecorateCanvas. */
        D.stickerCanvas = document.createElement("canvas");
        D.stickerCtx = D.stickerCanvas.getContext("2d");

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
        /* Points-unlock packs (plush/modded/breakfast) are "coming
           soon": owned only once bought with earned points — not yet
           possible, so they stay locked despite having no price. */
        if (pack.unlock === "points") return loadOwnedPacks().has(pack.id);
        if (!pack.priceCents) return true;   /* free */
        return loadOwnedPacks().has(pack.id);
    }

    /* ============================================================
       SPARKS — the earned-currency economy (✦)
       ============================================================
       Sparks are a PURE DERIVED readout of durable creative history
       — the same sources computeStats() reads: gallery entries +
       the trophy cache + egg flags. Nothing is stored as a mutable
       balance, so it can't drift or be gamed by poking localStorage:

           balance = earned − Σ(sparkCost of owned points-packs)

       "earned" is recomputed from what you've actually made; "spent"
       is inferred from which points-packs you already own (unlocking
       is permanent, so the pack itself IS the receipt).

       No dark patterns: sparks only accrue from real creative acts —
       no daily-login timer, no grind counter, nothing time-gated. */
    const SPARK_RATES = {
        fired:  8,    /* each pot successfully fired */
        shared: 12,   /* each pot shared to the public gallery */
        egg:    20,   /* each easter egg discovered */
        trophy: 40    /* each battle trophy won */
    };

    /* The spark price of a points pack (0 for anything else). */
    function sparkCost(pack) {
        return (pack && pack.unlock === "points") ? (pack.sparkCost || 0) : 0;
    }

    /* Total sparks the player has earned across their whole history. */
    function sparksEarned() {
        const entries = loadGalleryEntries();
        let fired = 0, shared = 0;
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].fired)    fired++;
            if (entries[i].publicId) shared++;
        }
        const trophies = Object.keys(trophyCacheLoad()).length;
        let eggs = 0;
        if (typeof EGG === "object" && EGG) {
            ["konami", "pingas", "overheatTriggered", "overclocked",
             "sentient", "infiniteClay", "oneFrameFire"]
                .forEach(function (k) { if (EGG[k]) eggs++; });
        }
        return fired    * SPARK_RATES.fired  +
               shared   * SPARK_RATES.shared +
               eggs     * SPARK_RATES.egg    +
               trophies * SPARK_RATES.trophy;
    }

    /* Sparks already spent = the cost of every points-pack owned. */
    function sparksSpent() {
        const owned = loadOwnedPacks();
        let spent = 0;
        GLAZE_PACKS.forEach(function (p) {
            if (p.unlock === "points" && owned.has(p.id)) spent += sparkCost(p);
        });
        return spent;
    }

    /* Spendable balance (never negative). */
    function sparksBalance() {
        return Math.max(0, sparksEarned() - sparksSpent());
    }

    /* A points pack the player can unlock right now. */
    function isPackAffordable(pack) {
        return !!(pack && pack.unlock === "points" && !isPackOwned(pack) &&
                  sparksBalance() >= sparkCost(pack));
    }

    /* True for a points pack that isn't unlocked yet (regardless of
       whether it's currently affordable). */
    function isPackSparkLocked(pack) {
        return !!(pack && pack.unlock === "points" && !isPackOwned(pack));
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
        if (pack.unlock === "points") return isPackOwned(pack);  /* locked until points-unlock */
        if (!pack.priceCents) return true;
        return isPackOwned(pack);
    }

    /* ============================================================
       BILLING (RevenueCat)
       ============================================================
       RC is the source of truth for paid-pack entitlements. The
       local OWNED_PACKS_KEY localStorage is a CACHE — RC writes
       to it via syncEntitlements() so cross-device restore "just
       works": user signs in to Supabase on a new device, we tell
       RC their app user id, RC returns the entitlements they
       already own, we cache locally + the pack tab appears.

       Setup checklist (in CLAUDE.md "RevenueCat billing setup"):
         1. Create RC account, add Android app, get public SDK key
         2. Set RC_PUBLIC_API_KEY below
         3. Create products in Play Console with these EXACT IDs
            (the CURRENT paid set — breakfast moved to the points
            unlock, and the old generic "mega" pack was removed):
              pack_dinosaur   $0.99   (builder — dino)
              pack_music      $0.99   (crafter)
              pack_chickens   $1.99   (mega)
              pack_aliens     $1.99   (mega)
              pack_moons      $1.99   (mega)
         4. Mirror them in RC dashboard with matching identifiers
         5. Create an entitlement in RC named the same as each
            product id and attach the matching product to it
         6. Ship and test purchases via Play Console "License
            Testing" with test accounts
       ============================================================ */

    /* RevenueCat Android (Public) SDK key for the Pootery project's
       Play Store app (RC App ID app85c31987ea). Public app keys are
       safe to ship in the client; they work for BOTH sandbox (closed-
       testing) and production purchases (RC picks the environment
       server-side). NEVER put an sk_… secret key here. */
    const RC_PUBLIC_API_KEY = "goog_gGJWQPpraQvPTZWUDorLozXmuxK";

    /* Pack id -> RC entitlement id mapping. The Play Console
       product IDs + the RC entitlement IDs must match these
       values exactly (1:1 model: each pack has its own product +
       its own entitlement). */
    const PACK_ENTITLEMENTS = {
        dinosaur:  "pack_dinosaur",
        music:     "pack_music",
        chickens:  "pack_chickens",
        aliens:    "pack_aliens",
        moons:     "pack_moons"
    };

    function rcPlugin() {
        return window.Capacitor &&
               window.Capacitor.Plugins &&
               window.Capacitor.Plugins.Purchases;
    }

    function rcConfigured() {
        return RC_PUBLIC_API_KEY &&
               RC_PUBLIC_API_KEY.indexOf("REPLACE_") < 0;
    }

    let _rcReady = false;

    async function initBilling() {
        const P = rcPlugin();
        if (!P) return;                /* web preview / no native bridge */
        if (!rcConfigured()) {
            console.warn("[CRAYte] RC_PUBLIC_API_KEY not set — billing inert");
            return;
        }
        try {
            await P.configure({
                apiKey: RC_PUBLIC_API_KEY,
                appUserID: currentUserId() || null
            });
            _rcReady = true;
            await syncEntitlements();
        } catch (e) {
            console.warn("[CRAYte] RC init failed", e);
        }
    }

    /* Sign-in / sign-out side: tell RC about the user id change so
       entitlements follow the account, not the device. Hooked into
       onAuthChange in init(). */
    async function rcSyncUser() {
        const P = rcPlugin();
        if (!P || !_rcReady) return;
        try {
            const uid = currentUserId();
            if (uid) {
                await P.logIn({ appUserID: uid });
            } else {
                await P.logOut();
            }
            await syncEntitlements();
        } catch (e) {
            console.warn("[CRAYte] RC user sync failed", e);
        }
    }

    /* Pull current entitlements from RC and mark matching packs
       as owned in the local cache. We never auto-unmark — a
       missing entitlement (refund, expiry) is rare enough that
       a slightly-stale cache is fine; the next purchase + sync
       will rectify any drift. */
    async function syncEntitlements() {
        const P = rcPlugin();
        if (!P || !_rcReady) return;
        try {
            const result = await P.getCustomerInfo();
            const info = result && result.customerInfo;
            const active = (info && info.entitlements && info.entitlements.active) || {};
            Object.keys(PACK_ENTITLEMENTS).forEach(function (packId) {
                if (active[PACK_ENTITLEMENTS[packId]]) markPackOwned(packId);
            });
        } catch (e) {
            console.warn("[CRAYte] entitlement sync failed", e);
        }
    }

    /* Real purchase flow. Called from handleShopCardClick when a
       paid pack is tapped. */
    async function purchasePack(packId) {
        const P = rcPlugin();
        if (!P || !_rcReady) {
            /* Two different situations, and they used to share one line
               that said purchases arrive "when the app launches on Google
               Play" — stale ever since it did launch, and simply wrong for
               the web build, where the free version is the point.
                 no Capacitor -> this IS the web build; packs are bought in
                                 the Android app, so say that.
                 Capacitor but RC not ready -> the store didn't answer
                                 (usually offline); it's worth retrying. */
            alert(window.Capacitor
                ? "Couldn't reach the Play Store just now. Check your " +
                  "connection and try again."
                : "Pack purchases happen in the Pootery app on Google Play. " +
                  "Everything else here is free to play — no account needed.");
            return;
        }
        const entId = PACK_ENTITLEMENTS[packId];
        if (!entId) return;
        try {
            /* Fetch the matching product from the current offering.
               The offering on the RC dashboard must include all four
               pack products. */
            const offResult = await P.getOfferings();
            /* getOfferings() resolves to PurchasesOfferings DIRECTLY
               ({ current, all }) — there is NO `.offerings` wrapper.
               Reading offResult.offerings.current was the bug that made
               every pack report "not available." */
            const matches = function (p) {
                return p && p.product && p.product.identifier === entId;
            };
            let pkgs = (offResult && offResult.current &&
                        offResult.current.availablePackages) || [];
            /* Fallback: if it's not in the "current" offering, scan all
               offerings so a missing/misconfigured "current" pointer can't
               block a product that really is set up to sell. */
            if (!pkgs.some(matches) && offResult && offResult.all) {
                Object.keys(offResult.all).forEach(function (k) {
                    const o = offResult.all[k];
                    if (o && o.availablePackages) pkgs = pkgs.concat(o.availablePackages);
                });
            }
            const pkg = pkgs.find(matches);
            if (!pkg) {
                console.warn("[CRAYte] no RC package for " + entId +
                    " (current=" + (offResult && offResult.current ? "set" : "none") +
                    ", offerings=" + (offResult && offResult.all ?
                        Object.keys(offResult.all).length : 0) + ")");
                alert("This pack isn't available right now. Try again later.");
                return;
            }
            const purchase = await P.purchasePackage({ aPackage: pkg });
            const customerInfo = purchase && purchase.customerInfo;
            const active = (customerInfo && customerInfo.entitlements &&
                            customerInfo.entitlements.active) || {};
            if (active[entId]) {
                markPackOwned(packId);
                if (currentScreen === "shop" &&
                    typeof refreshShopScreen === "function") {
                    refreshShopScreen();
                }
            }
        } catch (e) {
            if (e && e.userCancelled) return;
            console.warn("[CRAYte] purchase failed", e);
            alert("Purchase didn't go through. Try again or use " +
                  "Restore Purchases in your account.");
        }
    }

    /* Restore-purchases button (Settings / Account screen). Always
       safe to call — even on first run after a fresh install. */
    async function restorePurchases() {
        const P = rcPlugin();
        if (!P || !_rcReady) {
            alert("Restore is only available in the installed app.");
            return false;
        }
        try {
            await P.restorePurchases();
            await syncEntitlements();
            alert("Purchases restored. Any packs you've bought before " +
                  "should appear now.");
            return true;
        } catch (e) {
            console.warn("[CRAYte] restore failed", e);
            alert("Restore failed. Make sure you're signed in to the " +
                  "same Google account that made the original purchase.");
            return false;
        }
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

        function applyRotation(deg) {
            const d = ((deg % 360) + 360) % 360;
            D.stampRotation = d * Math.PI / 180;
            if (slider && slider.value !== String(d)) slider.value = d;
            if (valEl) valEl.textContent = d + "°";
        }

        if (slider) slider.addEventListener("input", function () {
            applyRotation(parseInt(slider.value, 10) || 0);
        });

        /* Flip-horizontal toggle — lives in the same .rotate-row as
           the ROT slider. Mirrors the next stamp on the X axis;
           click again to flip back. Persists across stamps until
           the user toggles it off (matches the rotation behavior). */
        const flipBtn = document.getElementById("stampFlipH");
        function syncFlipBtn() {
            if (!flipBtn) return;
            flipBtn.classList.toggle("is-active", !!D.stampFlipH);
            flipBtn.setAttribute("aria-pressed", D.stampFlipH ? "true" : "false");
        }
        if (flipBtn) {
            flipBtn.addEventListener("click", function () {
                D.stampFlipH = !D.stampFlipH;
                syncFlipBtn();
            });
            syncFlipBtn();
        }
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
        /* Sticker layer — match paint canvas size + DPR. Unlike
           paintCanvas, we don't bother preserving raster pixels
           across resize because the layer is fully rebuilt from
           D.stickers[] (the source of truth). */
        if (D.stickerCanvas && (D.stickerCanvas.width !== bw ||
                                D.stickerCanvas.height !== bh)) {
            D.stickerCanvas.width  = bw;
            D.stickerCanvas.height = bh;
            D.stickerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (typeof renderStickerLayer === "function") renderStickerLayer();
        }
    }

    /* ---- Sticker layer rendering ----
       D.stickers is the source of truth. drawSticker / renderStickerLayer
       walk it in array order so later placements visually sit on
       top of earlier ones (consistent with the in-place stamp
       behavior they replaced). Called whenever the array changes —
       new placement, move-tool drag tick, undo, clear, gallery
       load. drawSticker is also reused by renderSavedPot to paint
       a saved entry's stickers into a one-shot canvas (no separate
       offscreen needed). */
    function drawSticker(ctx, s) {
        const fn = PATTERN_DRAWERS[s.pattern];
        if (!fn) return;

        /* Landing pop — for ~110ms after a fresh placement the
           sticker draws scaled-up from 1.12 back to 1.00 via
           easeOutCubic. Gives a tactile "thunk" feel without
           any audio overlap (stampClick already covered that).
           Skipped for saved entries (placedAt absent or stale). */
        const STAMP_POP_MS = 110;
        let scaleBoost = 1;
        if (s.placedAt) {
            const t = (performance.now() - s.placedAt) / STAMP_POP_MS;
            if (t >= 0 && t < 1) {
                const eased = 1 - Math.pow(1 - t, 3);   /* easeOutCubic */
                scaleBoost = 1.12 - 0.12 * eased;        /* 1.12 -> 1.00 */
            }
        }

        const rotated = !!s.rot;
        const flipped = !!s.flipH;
        const scaled  = scaleBoost !== 1;
        if (rotated || flipped || scaled) {
            ctx.save();
            ctx.translate(s.x, s.y);
            if (rotated) ctx.rotate(s.rot);
            if (flipped) ctx.scale(-1, 1);
            if (scaled)  ctx.scale(scaleBoost, scaleBoost);
            fn(ctx, 0, 0, s.r, s.color || "#fff");
            ctx.restore();
        } else {
            fn(ctx, s.x, s.y, s.r, s.color || "#fff");
        }
    }

    function renderStickerLayer() {
        if (!D.stickerCtx || !D.stickerCanvas) return;
        D.stickerCtx.save();
        D.stickerCtx.setTransform(1, 0, 0, 1, 0, 0);
        D.stickerCtx.clearRect(0, 0,
            D.stickerCanvas.width, D.stickerCanvas.height);
        D.stickerCtx.restore();
        D.stickerCtx.save();
        D.stickerCtx.setTransform(D.dpr, 0, 0, D.dpr, 0, 0);
        for (let i = 0; i < D.stickers.length; i++) {
            drawSticker(D.stickerCtx, D.stickers[i]);
        }
        D.stickerCtx.restore();
    }

    /* Hit-test the sticker stack for the MOVE tool. Walks in
       REVERSE so the visually-topmost sticker is picked first
       (matches what the eye expects when stickers overlap).
       The hit radius is the sticker's render r plus a small
       finger-friendly padding so kids don't need pixel-perfect
       taps. */
    function hitTestSticker(p) {
        const PAD = 6;
        for (let i = D.stickers.length - 1; i >= 0; i--) {
            const s = D.stickers[i];
            const dx = p.x - s.x;
            const dy = p.y - s.y;
            const reach = (s.r || 14) + PAD;
            if (dx * dx + dy * dy <= reach * reach) {
                return { sticker: s, index: i, offsetX: dx, offsetY: dy };
            }
        }
        return null;
    }

    function clearPaint() {
        if (!D.paintCtx) return;
        D.paintCtx.save();
        D.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
        D.paintCtx.clearRect(0, 0, D.paintCanvas.width, D.paintCanvas.height);
        D.paintCtx.restore();
        /* CLEAR also wipes the sticker layer + records. */
        D.stickers = [];
        /* ...and the dip glaze coats + frieze bands. */
        D.dips = [];
        D.bands = [];
        D.dipDrag = null;
        D.movingBand = null;
        if (typeof renderStickerLayer === "function") renderStickerLayer();
        /* Clearing wipes any prior custom-sticker pixels too — flag
           starts fresh until a new sticker lands. */
        D.usedCustomSticker = false;
        /* CLEAR also strips any applied surface texture skin —
           the kid's intent is "start over on bare clay". */
        D.surfaceTexturePackId = null;
        /* And drops the link to any draft being edited — a fully
           cleared pot is a fresh canvas, not the same draft. */
        D.draftId = null;
        if (typeof buildTexturePalette === "function") {
            buildTexturePalette();
        }
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
            /* MOBILE-ZOOM GUARD: we no longer paint/stamp on this
               first pointerdown. A pinch begins with ONE finger
               touching, so acting here dropped a stamp (or a stray
               brush dab) before the second finger could be seen — the
               "zoom places a stamp" bug. Instead we DEFER: record the
               start point and commit only once we're sure this is a
               genuine single-finger action — a drag (first
               pointermove) or a clean tap (pointerup with no 2nd
               finger). The size===2 branch below clears this pending
               state so a pinch commits nothing. */
            D.gestureCommitted = false;
            D.multiTouched = false;
            D.pendingPos = p;

            /* BALEET (eraser) sticker-delete is resolved on tap-up in
               endPointer (so a drag-from-sticker still rubs paint
               instead of deleting). Nothing to grab on down for it. */

            /* SCOOT (move) grabs a sticker on down for drag-reposition.
               It only acts when the pointer actually hits an existing
               sticker, so a pinch that happens to start on a sticker is
               released by the size===2 branch (which nulls
               movingSticker). */
            if (D.tool === "move") {
                const hit = hitTestSticker(p);
                if (hit) {
                    pushUndoSnapshot();
                    D.movingSticker = hit;
                    D.canvas.style.cursor = "grabbing";
                    D.gestureCommitted = true;   /* a real grab, not a tap */
                }
                return;
            }

            /* BAND: a press on an existing band grabs it to slide up/down;
               otherwise the tap on pointerup places a new band. */
            if (D.tool === "band") {
                const hit = hitTestBand(p);
                if (hit) {
                    pushUndoSnapshot();
                    D.movingBand = hit;
                    D.canvas.style.cursor = "grabbing";
                    D.gestureCommitted = true;
                }
                return;
            }
        };

        /* Commit the deferred paint START (brush / spray / splatter /
           eraser). Fires on the first single-finger move OR on a clean
           tap-up. One undo snapshot per gesture. */
        const commitPaintStart = function () {
            if (D.gestureCommitted) return;
            pushUndoSnapshot();
            if (D.tool === "dip") {
                dipDragStart(D.pendingPos);   /* begin a live glaze coat */
            } else {
                paintDot(D.pendingPos, true); /* true = stroke start -> taper the head */
            }
            D.gestureCommitted = true;
            D.strokedThisGesture = true;
        };

        /* Commit a STAMP tap (deferred from pointerdown). The 2nd tap
           of a double-tap (within the window + radius) is treated as a
           "zoom" intent: it removes the 1st tap's sticker and places
           nothing, so a double-tap nets ZERO stamps instead of two. */
        const STAMP_DBLTAP_MS = 300;
        const STAMP_DBLTAP_PX = 30;
        const handleStampTap = function (p) {
            const now  = performance.now();
            const last = D.lastStampTap;
            if (last && (now - last.t) < STAMP_DBLTAP_MS &&
                Math.hypot(p.x - last.x, p.y - last.y) < STAMP_DBLTAP_PX) {
                /* Pop the 1st tap's sticker record + drop its now-
                   meaningless undo snapshot so both stacks stay sane. */
                if (D.undoStack.length) D.undoStack.pop();
                if (D.stickers.length) { D.stickers.pop(); renderStickerLayer(); }
                updateUndoRedoButtons();
                D.lastStampTap = null;        /* a 3rd tap starts fresh */
                return;
            }
            pushUndoSnapshot();
            stampAt(p);
            D.lastStampTap = { t: now, x: p.x, y: p.y };
        };

        const cancelPaint = function () {
            if (!D.pointerActive) return;
            D.pointerActive = false;
            D.lastPaintPos = null;
            /* Nothing was painted yet (placement is deferred), so
               there's no stray mark or undo snapshot to roll back. */
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
                /* Second finger landed -> this is a pinch/pan, NOT a
                   placement. Drop the deferred paint/stamp + release
                   any grabbed sticker so the gesture leaves no marks. */
                cancelPaint();
                D.pendingPos = null;
                D.multiTouched = true;
                if (D.movingSticker) {
                    D.movingSticker = null;
                    if (D.tool === "move") D.canvas.style.cursor = "grab";
                }
                /* Drop a half-drawn dip coat / band grab so a pinch
                   leaves nothing behind. */
                if (D.dipDrag) {
                    const idx = D.dips.indexOf(D.dipDrag);
                    if (idx !== -1) D.dips.splice(idx, 1);
                    D.dipDrag = null;
                }
                D.movingBand = null;
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
            /* SCOOT (move) drag — track the active sticker. We preserve
               the pointer-to-sticker offset captured on pointerdown so
               the drag doesn't snap to the cursor center; the sticker
               keeps its grab point throughout the drag. */
            if (D.tool === "move" && D.movingSticker) {
                const s = D.movingSticker.sticker;
                s.x = p.x - D.movingSticker.offsetX;
                s.y = p.y - D.movingSticker.offsetY;
                renderStickerLayer();
                D.lastPaintPos = p;
                D.pointer = p;
                return;
            }
            /* Stamps are tap-only: dragging never paints a trail of
               stamps. The actual placement happens on tap-up. */
            if (D.tool === "stamp") {
                D.lastPaintPos = p;
                D.pointer = p;
                return;
            }
            /* BAND drag — slide a grabbed band up/down; a drag that
               didn't grab a band does nothing (placement is on tap). */
            if (D.tool === "band") {
                if (D.movingBand) moveBandTo(p);
                D.lastPaintPos = p;
                D.pointer = p;
                return;
            }
            /* DIP drag — the first move commits a live glaze coat, then
               the finger sets its lower edge. */
            if (D.tool === "dip") {
                if (!D.gestureCommitted) commitPaintStart();
                dipDragTo(p);
                D.lastPaintPos = p;
                D.pointer = p;
                return;
            }
            /* Paint tools: the first single-finger move commits the
               deferred start dab, then we stroke from there. */
            if (!D.gestureCommitted) commitPaintStart();
            paintStrokeTo(p);
            D.lastPaintPos = p;
            D.pointer = p;
        });

        const endPointer = function (e) {
            D.activePointers.delete(e.pointerId);
            try { c.releasePointerCapture(e.pointerId); } catch (_) {}

            if (D.activePointers.size === 0) {
                /* All fingers lifted. A clean single-finger TAP — one
                   that never escalated to a pinch and never committed
                   as a drag — commits its deferred action HERE. This
                   is what makes a tap place a stamp / single dab while
                   a pinch (multiTouched) places nothing. */
                if (D.pointerActive && !D.gestureCommitted &&
                        !D.multiTouched && D.pendingPos) {
                    if (D.tool === "stamp") {
                        handleStampTap(D.pendingPos);
                    } else if (D.tool === "eraser") {
                        /* BALEET tap: if it landed on a sticker, delete
                           that sticker; otherwise rub off paint at the
                           tap point (eraser dab). */
                        const hit = hitTestSticker(D.pendingPos);
                        pushUndoSnapshot();
                        if (hit) {
                            D.stickers.splice(hit.index, 1);
                            renderStickerLayer();
                        } else {
                            paintDot(D.pendingPos);
                        }
                    } else if (D.tool === "dip") {
                        pushUndoSnapshot();
                        placeDipTap(D.pendingPos);
                    } else if (D.tool === "band") {
                        pushUndoSnapshot();
                        placeBandTap(D.pendingPos);
                    } else if (D.tool !== "move") {
                        /* SCOOT (move) only acts on a drag — a clean tap
                           with nothing grabbed places/erases nothing. */
                        pushUndoSnapshot();
                        paintDot(D.pendingPos);
                    }
                }
                if (D.pointerActive) {
                    /* Finish a brush DRAG with a thin lift-off tail so the
                       stroke ends in a point, not a blunt full-width stop. */
                    if (D.strokedThisGesture && D.tool === "brush" && D.lastPaintPos) {
                        brushTaperEnd(D.lastPaintPos);
                    }
                    D.pointerActive = false;
                    D.lastPaintPos = null;
                }
                /* End any SCOOT drag in progress + restore the idle
                   grab cursor. */
                if (D.movingSticker) {
                    D.movingSticker = null;
                    if (D.tool === "move") D.canvas.style.cursor = "grab";
                }
                /* Finalize any dip coat / band drag from this gesture. */
                D.dipDrag = null;
                if (D.movingBand) {
                    D.movingBand = null;
                    if (D.tool === "band") D.canvas.style.cursor = "pointer";
                }
                D.gestureStart = null;
                D.gestureCommitted = false;
                D.multiTouched = false;
                D.pendingPos = null;
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

    /* ---- Soft brush tip (cached) ----
       A real-feeling paintbrush instead of a flat monotone stripe: we
       stamp a soft, feathered, translucent tip densely along the stroke
       so colour BUILDS UP (like glaze thickness) and the edges feather
       out. The stroke tapers THIN at both ends (light head via a live
       ramp; light lift-off tail on release) and stays HEAVY through the
       middle. Tunables live here so the feel is easy to dial in. */
    const BRUSH_ALPHA = 0.10;   /* per-dab opacity — low so it's translucent + builds up */
    const BRUSH_STEP  = 0.25;   /* dab spacing as a fraction of the radius */
    const BRUSH_TAPER = 2.6;    /* taper length at each end, in radii */

    let _brushTipCanvas = null;
    function brushTip() {
        if (_brushTipCanvas) return _brushTipCanvas;
        const S = 64;
        const c = document.createElement("canvas");
        c.width = S; c.height = S;
        const g = c.getContext("2d");
        const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        /* Gentle falloff — no hard core. Feathering starts early (30%)
           so even a single dab has a soft edge. */
        grad.addColorStop(0,    "rgba(255,255,255,1)");
        grad.addColorStop(0.30, "rgba(255,255,255,0.82)");
        grad.addColorStop(0.70, "rgba(255,255,255,0.30)");
        grad.addColorStop(1,    "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, S, S);
        _brushTipCanvas = c;
        return c;
    }

    /* The white soft tip recoloured to the active glaze. Rebuilt only
       when the colour changes, so a stroke is just cheap drawImage calls. */
    let _brushTintColor = null, _brushTintCanvas = null;
    function brushTinted(color) {
        if (_brushTintCanvas && _brushTintColor === color) return _brushTintCanvas;
        const tip = brushTip();
        const c = document.createElement("canvas");
        c.width = tip.width; c.height = tip.height;
        const g = c.getContext("2d");
        g.drawImage(tip, 0, 0);
        g.globalCompositeOperation = "source-in";
        g.fillStyle = color;
        g.fillRect(0, 0, c.width, c.height);
        _brushTintColor = color;
        _brushTintCanvas = c;
        return c;
    }

    /* One soft dab. `r` and `alpha` already carry any taper scaling; we
       just add light per-dab jitter so the stroke reads as hand-painted
       glaze, not a printed line. Caller wraps runs in ctx.save/restore. */
    function brushDab(ctx, tinted, x, y, r, alpha) {
        if (r <= 0.2 || alpha <= 0.003) return;
        const jr = r * (0.85 + Math.random() * 0.30);
        const jx = (Math.random() - 0.5) * r * 0.40;
        const jy = (Math.random() - 0.5) * r * 0.40;
        ctx.globalAlpha = Math.min(1, alpha * (0.8 + Math.random() * 0.4));
        ctx.drawImage(tinted, x + jx - jr, y + jy - jr, jr * 2, jr * 2);
    }

    /* Lift-off tail: on release, continue a few shrinking, fading dabs
       along the last travel direction so the stroke ends in a thin point
       (a brush lifting off) instead of a blunt full-width stop. Additive
       + translucent, so it never gouges the art underneath the way an
       eraser-style trim would. */
    function brushTaperEnd(p) {
        const dir = D._lastBrushDir;
        if (!dir) return;
        const r = effectiveBrushSize();
        const tinted = brushTinted(currentPaintColor());
        const taperLen = r * BRUSH_TAPER;
        const step = Math.max(1, r * BRUSH_STEP);
        const ctx = D.paintCtx;
        ctx.save();
        for (let d = step; d <= taperLen; d += step) {
            const t  = d / taperLen;            /* 0..1 along the tail */
            const rs = r * (1 - t) * (1 - t);   /* radius eases to 0 */
            const as = BRUSH_ALPHA * (1 - t);   /* alpha fades to 0 */
            brushDab(ctx, tinted, p.x + dir.x * d, p.y + dir.y * d, rs, as);
        }
        ctx.restore();
    }

    function paintDot(p, isStrokeStart) {
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
            ctx.beginPath();
            ctx.arc(p.x, p.y, effectiveBrushSize(), 0, Math.PI * 2);
            ctx.fill();
        } else {
            /* brush: (re)start this stroke's taper + spacing bookkeeping.
               A TAP lays a full soft dab of glaze; a stroke START
               (isStrokeStart) draws nothing here — paintStrokeTo lays the
               thin, ramping-up head the moment the finger moves. */
            const r = effectiveBrushSize();
            D._strokeDist   = 0;
            D._lastBrushDir = null;
            D._dabResidual  = Math.max(1, r * BRUSH_STEP);
            if (!isStrokeStart) {
                const tinted = brushTinted(currentPaintColor());
                const n = 3 + Math.floor(Math.random() * 2);
                for (let i = 0; i < n; i++) {
                    brushDab(ctx, tinted, p.x, p.y, r, BRUSH_ALPHA);
                }
            }
            noteGlazeUsed(D.glaze);
        }
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

        if (D.tool === "eraser") {
            ctx.save();
            ctx.globalCompositeOperation = "destination-out";
            ctx.strokeStyle = "#000";
            ctx.lineWidth = effectiveBrushSize() * 2;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            ctx.restore();
            return;
        }

        /* BRUSH — stamp soft, translucent dabs evenly along the segment,
           building up like glaze. Distance-based spacing keeps it smooth
           at any speed and stops a held-still spot from caking. A live
           taper ramps the HEAD up from thin->full over the first stretch
           (BRUSH_TAPER radii of travel); the matching thin TAIL is added
           on release by brushTaperEnd. Net: heavy middle, light ends. */
        const r = effectiveBrushSize();
        const tinted = brushTinted(currentPaintColor());
        const dx = p.x - last.x, dy = p.y - last.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.max(1, r * BRUSH_STEP);
        const taperLen = r * BRUSH_TAPER;
        ctx.save();
        if (dist < 0.001) {
            const tIn = Math.min(1, (D._strokeDist || 0) / taperLen);
            brushDab(ctx, tinted, p.x, p.y,
                     r * (0.25 + 0.75 * tIn), BRUSH_ALPHA * (0.4 + 0.6 * tIn));
        } else {
            const ux = dx / dist, uy = dy / dist;
            D._lastBrushDir = { x: ux, y: uy };
            let d = (D._dabResidual != null) ? D._dabResidual : step;
            for (; d <= dist; d += step) {
                const sd  = (D._strokeDist || 0) + d;
                const tIn = Math.min(1, sd / taperLen);   /* thin-head ramp */
                brushDab(ctx, tinted, last.x + ux * d, last.y + uy * d,
                         r * (0.25 + 0.75 * tIn), BRUSH_ALPHA * (0.4 + 0.6 * tIn));
            }
            D._dabResidual = d - dist;                    /* carry remainder */
            D._strokeDist  = (D._strokeDist || 0) + dist;
        }
        ctx.restore();

        /* Soft "shh" on a fraction of moves — a long stroke becomes a
           stream of brushy puffs, not a constant hiss. */
        if (Math.random() < 0.18) brushStroke();
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
        /* Push a vector record (NOT baked pixels). The MOVE tool
           hit-tests + drags these records; renderStickerLayer
           re-builds the sticker canvas from the array, and
           autoSaveFiredPot serializes the array on the entry so
           a saved pot can be re-opened and its stickers picked
           back up. The render is reusable: drawSticker(ctx, s)
           handles the rotation + flip transforms identically to
           how this site used to do it inline. */
        D.stickers.push({
            pattern: D.pattern,
            x: p.x,
            y: p.y,
            r: r,
            rot: D.stampRotation || 0,
            flipH: !!D.stampFlipH,
            color: color,
            /* placedAt drives a short 110%->100% pop animation
               in drawSticker. Cleared on save/load so re-opened
               pots don't replay the landing pop. */
            placedAt: performance.now()
        });
        renderStickerLayer();
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

        /* Glaze swatches. Each glaze gets a friendly name from the
           pack's parallel glazeNames array (BLUE RASPBERRY,
           SCANLINE GRAY, etc.) — shown as a tooltip on desktop
           hover, an aria-label for screen readers, and a small
           floating chip via the .data-name attr on long-press /
           focus (CSS-driven for mobile-friendliness). */
        const gp = document.getElementById("glazePalette");
        if (gp) {
            gp.innerHTML = "";
            pack.glazes.forEach(function (gid, idx) {
                const name = (pack.glazeNames && pack.glazeNames[idx]) ||
                             (gid === "@rgb-cycle" ? "RGB CYCLE" : gid);
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "swatch";
                btn.dataset.glaze = gid;
                btn.dataset.name  = name;
                btn.title = name;
                btn.setAttribute("aria-label", "Glaze: " + name);
                if (gid === "@rgb-cycle") {
                    /* CSS handles the animated rainbow background. */
                    btn.classList.add("dynamic-rgb");
                } else {
                    btn.style.background = gid;
                }
                if (gid === D.glaze) btn.classList.add("active");
                btn.addEventListener("click", function () {
                    D.glaze = gid;
                    gp.querySelectorAll(".swatch").forEach(function (s) {
                        s.classList.toggle("active", s.dataset.glaze === gid);
                    });
                    /* Picking a color while on a non-painting tool
                       (BALEET/eraser or SCOOT/move) implies "I want to
                       paint with this" -> snap to brush. On a painting
                       tool (brush/spray/splatter/stamp) the color just
                       re-tints the current tool, so leave it. */
                    if (D.tool === "eraser" || D.tool === "move") setTool("brush");
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

        /* Tool-mode buttons. data-tool="texture" is special — it
           doesn't change D.tool; it toggles whether the active
           pack's surface texture is applied over the whole pot
           (one-tap full skin). Everything else routes through
           setTool. buildToolUI re-runs on every pack swap, so
           we gate the wiring with _wired to avoid stacking N
           listeners that flip the toggle even/odd times. */
        document.querySelectorAll(".tool-btn[data-tool]").forEach(function (b) {
            if (!b._wired) {
                b.addEventListener("click", function () { setTool(b.dataset.tool); });
                b._wired = true;
            }
            b.classList.toggle("active", b.dataset.tool === D.tool);
        });
        buildTexturePalette();
        buildDipControls();
        buildFriezePalette();

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

        /* Reflect the active tool's contextual rows on mount + on
           every pack swap (buildToolUI re-runs then). */
        syncToolContext();
    }

    /* Build the DIP tool's DRIPS toggle + POURS (gradient presets).
       Wired once; re-run is cheap + keeps the active chips in sync. */
    function buildDipControls() {
        const drip = document.getElementById("dripPicker");
        if (drip) {
            drip.innerHTML = "";
            [{ v: 0, label: "OFF" }, { v: 1, label: "FEW" }, { v: 2, label: "LOTS" }]
                .forEach(function (o) {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "chip";
                    btn.textContent = o.label;
                    if (o.v === D.dripAmount) btn.classList.add("active");
                    btn.addEventListener("click", function () {
                        D.dripAmount = o.v;
                        drip.querySelectorAll(".chip").forEach(function (c) {
                            c.classList.remove("active");
                        });
                        btn.classList.add("active");
                    });
                    drip.appendChild(btn);
                });
        }
        const pour = document.getElementById("pourPicker");
        if (pour) {
            pour.innerHTML = "";
            DIP_PRESET_ORDER.forEach(function (o) {
                const btn = document.createElement("button");
                btn.type = "button";
                /* Swatches, not text chips. As text these took 7 rows and
                   211px of a 269px-wide tray once there were 16 of them —
                   the picker crowded out the pot it was meant to decorate.
                   Reusing .swatch borrows the glaze palette's sizing AND
                   its data-name hover label, so the name is still there
                   without spending a row on it. Rounded square vs the
                   glazes' circle reads as "gradient pour" vs "one
                   colour" at a glance. */
                btn.className = "swatch pour-swatch";
                btn.dataset.name = o.label;
                btn.setAttribute("aria-label", o.label + " pour");
                /* Vertical gradient: a pour runs rim -> foot, so the
                   swatch previews how it actually lands on the pot. */
                const stops = DIP_PRESETS[o.id];
                btn.style.background =
                    "linear-gradient(180deg," + stops.join(",") + ")";
                btn.addEventListener("click", function () {
                    if (D.tool !== "dip") setTool("dip");
                    placePresetDip(o.id);
                    pour.querySelectorAll(".pour-swatch").forEach(function (s) {
                        s.classList.remove("active");
                    });
                    btn.classList.add("active");
                });
                pour.appendChild(btn);
            });
        }
    }

    /* Build the BAND tool's frieze picker. */
    function buildFriezePalette() {
        const fp = document.getElementById("friezePalette");
        if (!fp) return;
        loadBandImages();
        fp.innerHTML = "";
        BAND_FRIESES.forEach(function (id) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "frieze-swatch";
            btn.dataset.frieze = id;
            btn.setAttribute("aria-label", "Frieze band");
            const img = document.createElement("img");
            img.src = bandSrc(id);
            img.alt = "";
            btn.appendChild(img);
            if (id === D.bandFriezeId) btn.classList.add("active");
            btn.addEventListener("click", function () {
                D.bandFriezeId = id;
                fp.querySelectorAll(".frieze-swatch").forEach(function (s) {
                    s.classList.toggle("active", s.dataset.frieze === id);
                });
                if (D.tool !== "band") setTool("band");
            });
            fp.appendChild(btn);
        });
    }

    /* Progressive disclosure: show only the contextual rows the
       active tool actually uses. Each .ctx-block in the tray lists
       its applicable tools in data-ctx; we toggle .ctx-hidden so
       CSS can animate the collapse. ERASE lives in the floating
       ribbon now but is still the "eraser" tool internally, so it
       participates in the size context like the paint tools. */
    function syncToolContext() {
        const tool = D.tool;
        document.querySelectorAll(".decorate-tools .ctx-block").forEach(
            function (row) {
                const ctx = (row.dataset.ctx || "").split(/\s+/);
                row.classList.toggle("ctx-hidden", ctx.indexOf(tool) === -1);
            }
        );
    }

    function setTool(tool) {
        D.tool = tool;
        document.querySelectorAll(".tool-btn[data-tool]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.tool === tool);
        });
        if (D.canvas) {
            /* Cursor: BALEET (eraser) -> "cell" so the kid sees what
               they're removing; SCOOT (move) -> "grab"; everything
               else -> the interactive pointer. */
            D.canvas.style.cursor =
                (tool === "eraser") ? "cell" :
                (tool === "move")   ? "grab" :
                                       "pointer";
        }
        syncToolContext();
    }

    /* Build the CRUNCH texture-skin palette for the active pack.
       Each swatch shows a tilable skin; tap to apply it over the
       whole pot, re-tap the active one to remove it (one skin at a
       time). The whole CRUNCH row hides when the pack has no skins
       (e.g., BASIC). Re-run on pack swap, fresh decorate mount, CLEAR,
       and gallery loads so the active swatch tracks D.
       surfaceTexturePackId (which holds a texture FILE id). */
    function buildTexturePalette() {
        const tp = document.getElementById("texturePalette");
        if (!tp) return;
        const row = tp.closest(".crunch-row");
        const pack = activePack();
        const textures = (pack && pack.surfaceTextures) || [];
        tp.innerHTML = "";
        textures.forEach(function (tid) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "texture-swatch";
            /* Translucent textures get a checker backing so the swatch
               reads as see-through (not flat purple on the dark panel) —
               the PNG's alpha lets the checker show, just like the clay
               shows through on the pot. */
            btn.dataset.texture = tid;
            const texUrl = 'url("' + surfaceTextureUrl(tid) + '")';
            if (isTranslucentTexture(tid)) {
                /* Stack the texture over a light checker so the swatch
                   reads as see-through (not flat purple on the dark
                   panel). Inline background-image wins over CSS, so the
                   checker has to be layered here, beneath the texture. */
                btn.classList.add("translucent");
                btn.style.backgroundImage = texUrl +
                    ", linear-gradient(45deg, #c9c9c9 25%, transparent 25%, transparent 75%, #c9c9c9 75%)" +
                    ", linear-gradient(45deg, #c9c9c9 25%, transparent 25%, transparent 75%, #c9c9c9 75%)";
                btn.style.backgroundSize = "cover, 12px 12px, 12px 12px";
                btn.style.backgroundPosition = "center, 0 0, 6px 6px";
            } else {
                btn.style.backgroundImage = texUrl;
            }
            btn.title = tid;
            btn.setAttribute("aria-label", "Texture skin: " + tid);
            if (tid === D.surfaceTexturePackId) btn.classList.add("active");
            btn.addEventListener("click", function () {
                /* Tap to apply; re-tap the active skin to clear it. */
                D.surfaceTexturePackId =
                    (D.surfaceTexturePackId === tid) ? null : tid;
                tp.querySelectorAll(".texture-swatch").forEach(function (s) {
                    s.classList.toggle("active",
                        s.dataset.texture === D.surfaceTexturePackId);
                });
            });
            tp.appendChild(btn);
        });
        if (row) row.classList.toggle("ctx-empty", textures.length === 0);
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

        /* Stamp landing pop — rebuild the sticker layer every
           frame while any sticker is mid-animation (110ms
           window after placement). stickerCanvas is cached
           between placements normally; we just punch through
           the cache here. Cheap because there are usually
           only a handful of stickers and one rebuild costs
           <1ms even with 30+ records. */
        if (D.stickers && D.stickers.length > 0) {
            const now = performance.now();
            for (let i = 0; i < D.stickers.length; i++) {
                const pa = D.stickers[i].placedAt;
                if (pa && (now - pa) < 110) {
                    renderStickerLayer();
                    break;
                }
            }
        }

        /* Wheel is FROZEN in decorate so the pot reads as "off
           the wheel" while you paint. drawPot also keys off
           currentScreen to pin the highlight strip to a static
           offset instead of animating it. */
        renderPotScene(D.ctx, {
            dips:          D.dips,
            bands:         D.bands,
            paintCanvas:   D.paintCanvas,
            stickerCanvas: D.stickerCanvas,
            particles:     false
        });
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
            /* Wheel hum belongs to the shape screen only — the user
               is decorating a static, fired-yet-unglazed pot here,
               so the wheel-spinning audio would be misleading. The
               shape onLeave handler already stopped it. */
            if (typeof refreshRemixInProgressChip === "function") {
                refreshRemixInProgressChip();
            }
            /* TEXTURE button state depends on the active pack
               (some have a surfaceTexture, some don't). Re-sync
               on every entry so swapping packs in the shop and
               coming back here updates the button correctly. */
            if (typeof buildTexturePalette === "function") {
                buildTexturePalette();
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
        /* The firing window now matches the kiln-sequence.mp3's
           actual length (probed below when the metadata loads).
           The 5000ms default is a fallback in case the metadata
           probe hasn't completed by the first fire (rare — the
           audio element starts loading on module eval). Capped
           at 9000ms so an unexpectedly long audio file can't
           make a kid sit through a 30-second firing. */
        firing:   5000,
        opening:  700,
        reveal:   1500,
        exploded: 2500,   /* shards-fly window after a kaboom */
        done:     Infinity
    };

    /* Probe the kiln-sequence audio's actual duration and clamp
       KILN_DUR.firing to it the moment metadata is available. A
       separate Audio() is used (not the playback pool) so we
       don't disturb the pool's pre-warmed instances. */
    (function syncFiringWindowToAudio() {
        try {
            const probe = new Audio();
            probe.preload = "metadata";
            probe.addEventListener("loadedmetadata", function () {
                const ms = Math.floor((probe.duration || 0) * 1000);
                if (ms > 500 && ms < 9000) KILN_DUR.firing = ms;
            }, { once: true });
            probe.src = "assets/audio/kiln-sequence.mp3";
        } catch (_) { /* fall back to the 5000ms default */ }
    }());

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
        "BIG POT ENERGY"
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

        /* Tap-to-explode: the only way a pot blows up now is if
           the user pokes the kiln during firing. Arms willExplode
           + jumps state straight to "exploded" so the kaboom is
           immediate rather than waiting for the 60% mark (which
           was an artifact of the old random-roll model). Outside
           the firing state, taps are ignored. */
        c.addEventListener("pointerdown", function () {
            if (KILN.state !== "firing") return;
            KILN.willExplode = true;
            kilnEnter("exploded");
        });

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

    /* Build a gallery entry from the current live state. Shared by
       autoSaveFiredPot (fired:true) + saveDraftPot (fired:false,
       draft:true). prevEntry, if passed, supplies an existing id
       + createdAt so we mutate in place instead of generating a
       fresh entry — used both for re-saving a draft and for
       firing a previously-saved draft. */
    function buildPotEntry(opts) {
        opts = opts || {};
        const fired = !!opts.fired;
        const prev  = opts.prevEntry || null;
        const entry = {
            id: prev ? prev.id : (
                "pot-" + Date.now() + "-" +
                Math.random().toString(36).slice(2, 8)
            ),
            createdAt: prev ? prev.createdAt : Date.now(),
            updatedAt: Date.now(),
            clay: SHAPE.clay.map(function (c) {
                return { y: c.y, radius: c.radius };
            }),
            clayTypeId: SHAPE.clayTypeId,
            /* Starter shape (metadata only — the geometry, including
               height, is fully baked into clay[]). Backward compatible:
               absent → "cylinder". */
            shapeId: SHAPE.shapeId || "cylinder",
            paintDataUrl: (D.paintCanvas)
                ? D.paintCanvas.toDataURL("image/png")
                : null,
            packId: D.activePackId,
            fired: fired,
            draft: !fired,
            /* Chunk-8 egg: overheated pots get an extra-crispy
               render in the gallery + a tag. Only meaningful for
               fired entries; draft entries leave them false. */
            overfired: fired && EGG.overheatTriggered === true,
            overfiredSeed: fired ? (EGG.overheatSeed || 0) : 0,
            /* Day-4 chunk B: exploded pots saved as shattered
               trophies rather than thrown out. Drafts can't have
               exploded yet (they haven't been to the kiln). */
            exploded: fired && KILN.exploded === true,
            /* Local-only UGC flag — any imported PNG sticker
               used on this pot taints the entry and blocks it
               from public battle submission. Carries forward
               on remix so a tainted source can't be laundered.
               Drafts also carry the flag so re-opening + firing
               doesn't accidentally clear it. */
            usedCustomSticker: !!D.usedCustomSticker ||
                !!(REMIX.pending && REMIX.pending.usedCustomSticker) ||
                !!(prev && prev.usedCustomSticker),
            /* Surface texture (TEXTURE button) — the pack id
               whose tilable skin is currently wrapped around
               the pot, or null/undefined. */
            surfaceTexturePackId: D.surfaceTexturePackId || null,
            /* Sticker records (vector). */
            stickers: (D.stickers || []).map(function (s) {
                return {
                    pattern: s.pattern,
                    x: s.x, y: s.y, r: s.r,
                    rot: s.rot || 0,
                    flipH: !!s.flipH,
                    color: s.color || null
                };
            }),
            /* Dip glaze coats + frieze bands (ported from Slip Studio).
               Deep-copied so later edits don't mutate the saved entry.
               Absent on legacy pots → render as bare (backward safe). */
            dips: (D.dips || []).map(function (d) {
                return d.preset
                    ? { preset: d.preset }
                    : { color: d.color, cover: d.cover,
                        drips: d.drips || 0, seed: d.seed || 1 };
            }),
            bands: (D.bands || []).map(function (b) {
                return { id: b.id, cy: b.cy, h: b.h };
            })
        };
        /* Carry forward the user's name on a re-save. */
        if (prev && prev.name) entry.name = prev.name;
        return entry;
    }

    /* Read/write helpers around localStorage gallery so the save
       paths can update an existing entry in place by id. */
    function readGalleryArr() {
        try {
            const arr = JSON.parse(localStorage.getItem("crayte-gallery") || "[]");
            return Array.isArray(arr) ? arr : [];
        } catch (_) { return []; }
    }
    function writeGalleryArr(arr) {
        /* Cap at 50 — keep newest. Brief calls for the "you have
           a lot of pots" celebration at ~50. */
        while (arr.length > 50) arr.shift();
        localStorage.setItem("crayte-gallery", JSON.stringify(arr));
    }

    function autoSaveFiredPot() {
        try {
            const existing = readGalleryArr();
            /* If we're firing a previously-saved DRAFT (D.draftId
               set by resumeDraft), mutate that entry in place so
               the gallery position + id are preserved. Otherwise
               create a fresh fired entry. */
            let prevEntry = null;
            let prevIdx = -1;
            if (D.draftId) {
                for (let i = 0; i < existing.length; i++) {
                    if (existing[i].id === D.draftId) {
                        prevEntry = existing[i];
                        prevIdx = i;
                        break;
                    }
                }
            }
            const entry = buildPotEntry({ fired: true, prevEntry: prevEntry });

            /* If this firing was started via REMIX, bake the
               lineage in. Cleared after consumption so a follow-up
               un-remixed firing doesn't get the stale credit. */
            if (REMIX.pending) {
                entry.remixedFrom       = REMIX.pending.remixedFrom;
                entry.remixedFromAuthor = REMIX.pending.remixedFromAuthor;
                entry.remixedFromHandle = REMIX.pending.remixedFromHandle;
                entry.remixedFromName   = REMIX.pending.remixedFromName;
                REMIX.pending = null;
                if (typeof refreshRemixInProgressChip === "function") {
                    refreshRemixInProgressChip();
                }
            }

            if (prevIdx >= 0) existing[prevIdx] = entry;
            else              existing.push(entry);
            writeGalleryArr(existing);
            KILN.savedId = entry.id;
            /* Draft is now a real fired pot — clear the tracker so
               subsequent New-Pot flows don't accidentally write
               back into this slot. */
            D.draftId = null;
            checkAchievements();
            maybeShowPushOptIn();
            return true;
        } catch (e) {
            console.warn("[CRAYte] auto-save failed", e);
            KILN.savedId = null;
            return false;
        }
    }

    /* (saveDraftPot removed — the SAVE-draft / "come back later" flow
       was dropped. Firing is the only path into the gallery now.) */

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
                dips:          D.dips,
                bands:         D.bands,
                paintCanvas:   D.paintCanvas,
                stickerCanvas: D.stickerCanvas,
                particles:     false,
                background:    false,
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
            /* Explosions are now USER-TRIGGERED ONLY — tap the
               kiln during firing and the pot blows up. The old
               3% random roll was frustrating for kids who spent
               20 minutes decorating only to lose the pot to a
               coin flip. willExplode starts false; the tap
               handler in kilnPointerDown flips it true and jumps
               state to "exploded" mid-firing. (EGG.oneFrameFire
               keeps its dev-shortcut path below; it still skips
               the firing animation entirely.) */
            KILN.willExplode = false;
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

        /* Don't advance the wheel phase in the kiln — the pot
           is locked inside the oven. (Previously this ticked
           wheelPhase so the procedural wedge animation kept
           moving; with real clay textures + a static highlight
           that motion read as the pot spinning inside the kiln,
           which it isn't.) The wedge rotation comes back the
           moment the user re-enters shape. */

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
            /* Synth crackle pops removed — the recorded
               kiln-sequence.mp3 now includes its own ticking, so
               doubling it up would muddy the mix. Sparks (visual)
               keep their pace; only the audio popper is gone. */
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
            /* No wheel hum on the kiln page — the pot is fixed in
               the kiln, the wheel isn't spinning. The shape
               onLeave handler already stopped it. */
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
        /* SPIN-VIEW: gallery detail modal passes opts.spinDx so the
           texture painters scroll the pattern in lock-step with
           the drag. Default null = no override (thumbnails render
           in their normal static state). Captured + restored
           around the render so concurrent paths can't see a stale
           value. */
        const savedSpinDx = _viewSpinDx;
        if (typeof opts.spinDx === "number") _viewSpinDx = opts.spinDx;
        /* GALLERY LIGHTING: every saved-pot render (thumbnails +
           detail modal + battle cards) gets the dramatic display-
           case light unless the caller opts out (opts.galleryLight
           === false). Restored in finally so the live working
           screens keep their calm studio light. */
        const savedGalleryLight = _galleryLighting;
        _galleryLighting = (opts.galleryLight !== false);
        /* DISPLAY WHEEL: saved pots sit on the perspective wood plinth
           (display.png) unless the caller opts out (opts.displayWheel
           === false). Restored in finally so the live shape phase
           keeps the spinning top-down wheel.png. */
        const savedDisplayWheel = _displayWheel;
        _displayWheel = (opts.displayWheel !== false);
        try {
            if (opts.background !== false) {
                ctx.fillStyle = "#0c1f25";
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                drawShapeBackdrop(ctx);
            }
            if (opts.wheel !== false) drawWheel(ctx);
            drawPot(ctx);
            /* Surface texture skin (TEXTURE button) — apply the
               saved entry's skin if it had one. Matches the live
               renderPotScene layering: BEFORE the paint canvas so
               the kid's stickers stay visible above the skin. */
            if (entry.surfaceTexturePackId &&
                    typeof paintSurfaceTexture === "function") {
                const clay = SHAPE.clay;
                const N = clay.length;
                let maxR = 0;
                for (let i = 0; i < N; i++) {
                    if (clay[i].radius > maxR) maxR = clay[i].radius;
                }
                paintSurfaceTexture(ctx, {
                    x: SHAPE.centerX - maxR - 4,
                    y: clay[N - 1].y - 4,
                    w: (maxR + 4) * 2,
                    h: SHAPE.baseY - clay[N - 1].y + 14
                }, entry.surfaceTexturePackId);
            }
            /* Dip glaze coat — under the sheen (glossy) + under the
               kid's paint, matching the live renderPotScene order. */
            if (entry.dips && entry.dips.length) compositeDips(ctx, entry.dips);
            /* Light catches on TOP of the surface texture so saved
               pots with skins still read as 3D-lit. Same layering
               as live renderPotScene: lighting then paint then
               stickers then fired overlay then rim. */
            if (typeof paintLightCatches === "function") {
                paintLightCatches(ctx);
            }
            /* Frieze bands on top of the sheen. */
            if (entry.bands && entry.bands.length) compositeBands(ctx, entry.bands);
            if (entry._paintImg) {
                ctx.save();
                buildPotPath(ctx);
                ctx.clip();
                ctx.drawImage(entry._paintImg, 0, 0, SHAPE.W, SHAPE.H);
                ctx.restore();
            }
            /* Sticker records (v1.1+ entries). Legacy entries
               without a stickers array had stamps baked into
               paintDataUrl, so they render correctly above
               without any extra work. */
            if (entry.stickers && entry.stickers.length > 0) {
                ctx.save();
                buildPotPath(ctx);
                ctx.clip();
                for (let i = 0; i < entry.stickers.length; i++) {
                    drawSticker(ctx, entry.stickers[i]);
                }
                ctx.restore();
            }
            if (entry.fired) {
                /* Warm "baked" tint so fired pots read hotter than
                   greenware. The old top->bottom glaze-sheen gradient
                   (light at the top, dark at the bottom) was stripped:
                   it imposed a vertical light direction that fought
                   the gallery's explicit side-key lighting. */
                ctx.save();
                buildPotPath(ctx);
                ctx.clip();
                ctx.globalCompositeOperation = "overlay";
                ctx.fillStyle = "rgba(180, 70, 22, 0.20)";
                ctx.fillRect(0, 0, SHAPE.W, SHAPE.H);
                ctx.globalCompositeOperation = "source-over";
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
            _viewSpinDx = savedSpinDx;
            _galleryLighting = savedGalleryLight;
            _displayWheel = savedDisplayWheel;
        }
    }

    function renderEntryIntoCanvas(canvas, entry, opts) {
        const cssW = canvas.clientWidth  || canvas.width;
        const cssH = canvas.clientHeight || canvas.height;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.max(1, Math.round(cssW * dpr));
        const bh = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== bw)  canvas.width  = bw;
        if (canvas.height !== bh) canvas.height = bh;
        const ctx = canvas.getContext("2d");
        /* Always clear the full bitmap first. The detail modal re-uses
           ONE canvas across opens and renders with background:false
           (transparent — the CSS pedestal shows behind), so without an
           explicit clear each opened pot composites on top of the last
           one ("stacking pots" bug, made obvious by translucent skins).
           Resizing clears implicitly, but same-size re-opens don't
           resize — hence the unconditional clear here. */
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bw, bh);
        ctx.setTransform(dpr * (cssW / SHAPE.W), 0, 0,
                         dpr * (cssH / SHAPE.H), 0, 0);
        /* The "display cabinet" look is the default for EVERY saved-pot
           surface (gallery grid, profile, battle cards, featured strip,
           detail modal, etc.): render on a TRANSPARENT canvas with no
           baked wood plinth or background fill, so the CSS display niche
           behind the thumb shows through. A caller can still opt back
           into the old look with background:true / wheel:true. */
        const o = opts || {};
        if (o.background === undefined) o.background = false;
        if (o.wheel === undefined)      o.wheel = false;
        renderSavedPot(ctx, entry, o);
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

        /* Shared-to-Everyone pots get a pink glow (replaces the old
           globe badge). Only on the user's own shared pots — public-
           tab rows ARE the "out there" copy, so flagging them is
           redundant. */
        if (entry.publicId && !entry._isPublic) {
            card.classList.add("is-shared");
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

        /* Render async — paint may be a dataURL that needs loading.
           background:false + wheel:false render the pot on a TRANSPARENT
           canvas with no wood plinth, so the CSS display niche + pedestal
           (#screen-gallery .pot-thumb) show through behind it. */
        loadEntryPaint(entry).then(function () {
            renderEntryIntoCanvas(canvas, entry, { background: false, wheel: false });
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
            remixedFromAuthor: row.remixed_from_author || null,
            /* v1.1 "store the recipe" columns. Present once
               SUPABASE_POTS_V11.sql has run + the pot was shared
               after. surfaceTexturePackId drives the live texture
               render; stickers is the vector array (jsonb) so
               public pots spin + light identically to local ones.
               Rows shared before the migration have these null and
               fall back to whatever's baked in paint_data_url. */
            surfaceTexturePackId: row.surface_texture_pack_id || null,
            stickers:     Array.isArray(row.stickers) ? row.stickers : null
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

        /* Hide tainted pots (custom-sticker UGC) + unfired drafts
           from the picker entirely — battles only accept fired
           public-safe pots, the gate downstream would reject them
           anyway. Cleaner to not offer the choice. */
        const mine = loadGalleryEntries()
            .filter(function (e) {
                if (e.usedCustomSticker) return false;
                if (e.draft) return false;
                return true;
            })
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
            /* Client-side filter: hide rows the user already
               deleted but whose server delete failed (most
               commonly because the row was shared anonymously
               and RLS won't let the now-signed-in user remove
               it). The hidden set lives in localStorage. */
            const hidden = loadHiddenPublic();
            GALLERY.publicCache = rows
                .filter(function (r) { return !hidden.has(r.id); })
                .map(normalizePublicRow);
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
        /* SPIN-VIEW: reset on every open so each pot starts from
           its natural front-facing orientation. Drag-spin updates
           this value below; renderEntryIntoCanvas passes it to
           renderSavedPot as opts.spinDx. */
        GALLERY.detailSpin = 0;
        const panel  = document.getElementById("potDetail");
        const canvas = document.getElementById("detailCanvas");
        const name   = document.getElementById("detailName");
        const date   = document.getElementById("detailDate");
        const pack   = document.getElementById("detailPack");
        if (!panel || !canvas) return;

        /* Drag-to-spin pointer handlers. Wired once per canvas
           element; the _spinWired flag prevents stacking. */
        attachDetailSpinHandlers(canvas);

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
        refreshDetailGlow();
        refreshNameSaveButton();
        setPotURLParam(entry);

        panel.hidden = false;

        loadEntryPaint(entry).then(function () {
            renderDetailCanvas();
        });
    }

    /* Re-render the detail-modal canvas honoring the current
       spin offset. Called on open + every drag tick. */
    function renderDetailCanvas() {
        const canvas = document.getElementById("detailCanvas");
        const entry  = GALLERY.detailEntry;
        if (!canvas || !entry) return;
        renderEntryIntoCanvas(canvas, entry, {
            spinDx: GALLERY.detailSpin || 0,
            background: false,   /* CSS display niche shows behind */
            wheel: false         /* no wood plinth — pedestal is CSS */
        });
    }

    /* Drag-to-spin handlers on the detail-modal canvas. Mapping:
       1 logical canvas pixel of horizontal drag = 1 pixel of
       texture scroll, which feels 1:1 with the finger. Wraps
       around naturally because CanvasPattern repeats infinitely
       — no special wrap logic needed. Wired ONCE per canvas
       element (the modal reuses the same canvas across opens);
       _spinWired flag prevents stacking listeners on re-open. */
    function attachDetailSpinHandlers(canvas) {
        if (!canvas || canvas._spinWired) return;
        canvas._spinWired = true;
        canvas.style.cursor = "grab";
        canvas.style.touchAction = "none";

        let dragging = false;
        let startX = 0;
        let startSpin = 0;
        /* Convert client X to logical canvas X. The detail canvas
           is scaled via CSS; we want the drag-to-scroll ratio
           to feel 1:1 with what the user SEES, so we compute the
           scale and divide deltas by it. */
        function logicalDx(e) {
            const rect = canvas.getBoundingClientRect();
            const scale = rect.width / SHAPE.W;
            return (e.clientX - startX) / (scale || 1);
        }

        canvas.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            dragging = true;
            startX = e.clientX;
            startSpin = GALLERY.detailSpin || 0;
            canvas.style.cursor = "grabbing";
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        });
        canvas.addEventListener("pointermove", function (e) {
            if (!dragging) return;
            GALLERY.detailSpin = startSpin + logicalDx(e);
            renderDetailCanvas();
        });
        const endDrag = function (e) {
            if (!dragging) return;
            dragging = false;
            canvas.style.cursor = "grab";
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        };
        canvas.addEventListener("pointerup",     endDrag);
        canvas.addEventListener("pointercancel", endDrag);
        canvas.addEventListener("pointerleave",  endDrag);
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

    /* Guarded close — pops a confirm before exiting the detail modal
       so a stray tap on the X / backdrop / Escape doesn't drop the
       kid out of a pot unexpectedly. Direct closeDetail() is still
       used by the explicit nav actions (back, delete, resume). */
    function requestCloseDetail() {
        /* Only nag if there's an unsaved name edit — otherwise the
           pot is fully saved and closing is harmless. */
        if (detailNameDirty() &&
                !window.confirm("Exit without saving the name?")) {
            return;
        }
        closeDetail();
    }

    /* (resumeDraft removed — the drafting/"continue editing" phase was
       a parked half-feature. Pots are made in one sitting, fired, then
       named in the vault; there's nothing to resume.) */

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
            /* Adopt the source's rim finish + starter-shape label and
               re-derive its height so continued shaping matches. */
            adoptEntryShape(entry);
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
        return "https://madderverse.org/pootery/?pot=" +
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
                    /* Server-side delete failed (most commonly:
                       RLS denied because the pot was shared
                       anonymously before sign-in). Hide locally
                       so EVERYONE / battle views don't show it
                       anymore from THIS device, and tell the
                       user honestly. The pot still exists on the
                       server until it can be claimed + deleted;
                       contacting support is the fallback. */
                    hideFromPublic(pubId);
                    setTimeout(function () {
                        alert(
                            "Removed from your gallery + hidden from " +
                            "your view of EVERYONE.\n\n" +
                            "We couldn't fully delete the server copy " +
                            "(usually because the pot was first shared " +
                            "before you signed in — the system can't " +
                            "tell it's yours). Email " +
                            "pootery@madderverse.org with your @handle " +
                            "and we'll clean it up server-side."
                        );
                    }, 200);
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

        if (close)  close.addEventListener("click", requestCloseDetail);
        if (del)    del.addEventListener("click",   deleteCurrentEntry);
        if (expt)   expt.addEventListener("click",  exportCurrentEntry);
        if (submit) submit.addEventListener("click", startShareFlow);

        const unshare = document.getElementById("detailUnshare");
        if (unshare) unshare.addEventListener("click", unshareCurrent);

        /* NAME POOT — commit the typed name to the pot (explicit;
           the pot itself is already saved by firing). */
        const nameSave = document.getElementById("detailNameSave");
        if (nameSave) nameSave.addEventListener("click", function () {
            if (!detailNameDirty()) return;
            saveDetailName();
            flashButton(nameSave);
            const lbl = nameSave.querySelector(".btn-label");
            if (lbl) {
                const orig = lbl.textContent;
                lbl.textContent = "NAMED!";
                setTimeout(function () { lbl.textContent = orig; }, 1200);
            }
            refreshNameSaveButton();   /* now matches saved -> disabled */
            if (currentScreen === "gallery") refreshGalleryGrid();
        });

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
            /* Explicit save now (no auto-save): typing just re-checks
               the dirty state to enable/disable NAME POOT. Enter is a
               shortcut for the button. */
            name.addEventListener("input", refreshNameSaveButton);
            name.addEventListener("keydown", function (e) {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const b = document.getElementById("detailNameSave");
                if (b && detailNameDirty()) b.click();
            });
        }

        if (panel) {
            panel.addEventListener("click", function (e) {
                if (e.target === panel) requestCloseDetail();
            });
        }

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && panel && !panel.hidden) requestCloseDetail();
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
            refreshDetailUnshareButton();
            refreshDetailCopyLink();
            if (currentScreen === "gallery" && GALLERY.tab === "mine") {
                refreshGalleryGrid();
            }
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

        /* Clear LOCAL state first so the UI reflects the unshare
           immediately + the user can re-share fresh if the server
           call fails. Without this, a failed DELETE used to leave
           the button stuck on "TRY AGAIN" indefinitely with no
           clear path forward. The public copy is best-effort
           cleaned server-side after. */
        const publicIdSnapshot = entry.publicId;
        entry.publicId = null;
        const arr = loadGalleryEntries();
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].id === entry.id) {
                delete arr[i].publicId;
                break;
            }
        }
        saveGalleryEntries(arr);
        /* Hide it from EVERYONE right away (the public-tab render filters
           out loadHiddenPublic() ids). The server DELETE below is
           best-effort and is denied by RLS for pots shared while
           signed-out (user_id IS NULL), so without this the copy
           lingered in Everyone — exactly the "stop sharing doesn't
           remove it" bug. Hiding is idempotent + harmless even when
           the server delete succeeds. */
        hideFromPublic(publicIdSnapshot);
        GALLERY.publicCache = null;
        refreshDetailSubmitButton();
        refreshDetailCopyLink();
        refreshDetailUnshareButton();
        if (currentScreen === "gallery" && GALLERY.tab === "mine") {
            refreshGalleryGrid();
        }

        /* Fire-and-forget server delete. If it fails (network
           hiccup, auth expiry, RLS edge case), the user's local
           view is already in the right state and they can
           re-share later if needed. */
        deletePublicPot(publicIdSnapshot).then(function (success) {
            if (btn) {
                btn.disabled = false;
                const lbl = btn.querySelector(".btn-label");
                if (lbl) lbl.textContent = "STOP SHARING";
            }
            if (!success) {
                console.warn("[CRAYte] unshare server delete failed for " +
                             publicIdSnapshot + " — local state is clean.");
            }
        });
    }

    /* DELETE the public copy. Owner-only via RLS (user_id auth
       check). Returns true on 2xx. */
    function deletePublicPot(publicId) {
        if (!supabaseEnabled() || !publicId) return Promise.resolve(false);
        const url = SUPABASE_URL + "/rest/v1/public_pots?id=eq." +
                    encodeURIComponent(publicId);
        /* return=representation makes PostgREST echo the rows it
           ACTUALLY deleted. A 204 / 200 with an empty array means
           RLS silently denied (most often: the pot was shared
           anonymously so user_id IS NULL on the row, and the
           current authed user isn't the "owner" per the policy).
           Without this we'd treat a no-op delete as success and
           the kid would see her pot still on the EVERYONE tab. */
        return fetch(url, {
            method: "DELETE",
            headers: supabaseHeaders({
                "Prefer": "return=representation"
            })
        }).then(function (r) {
            if (!r.ok) {
                console.warn("[CRAYte] deletePublicPot HTTP " + r.status +
                             " for id=" + publicId);
                return false;
            }
            return r.json().then(function (rows) {
                const deleted = Array.isArray(rows) && rows.length > 0;
                if (!deleted) {
                    console.warn("[CRAYte] deletePublicPot: 0 rows for id=" +
                                 publicId + " — likely RLS / user_id mismatch " +
                                 "(pot may have been shared anonymously before " +
                                 "sign-in).");
                }
                return deleted;
            }).catch(function () { return r.ok; });
        }).catch(function () { return false; });
    }

    /* Client-side hide-list for public pots whose server-side
       delete failed (most common cause: pot was shared while
       signed-out, so RLS won't let the now-signed-in user delete
       it). We honor the user's intent locally by hiding the row
       from EVERYONE / battles even if the server still has it.
       Persisted so a refresh doesn't un-hide. */
    const HIDDEN_PUBLIC_KEY = "crayte-hidden-public";

    function loadHiddenPublic() {
        try {
            const arr = JSON.parse(localStorage.getItem(HIDDEN_PUBLIC_KEY) || "[]");
            return new Set(Array.isArray(arr) ? arr : []);
        } catch (_) { return new Set(); }
    }
    function saveHiddenPublic(set) {
        try {
            localStorage.setItem(HIDDEN_PUBLIC_KEY,
                JSON.stringify(Array.from(set)));
        } catch (_) {}
    }
    function hideFromPublic(publicId) {
        if (!publicId) return;
        const s = loadHiddenPublic();
        s.add(publicId);
        saveHiddenPublic(s);
    }
    function isHiddenPublic(publicId) {
        if (!publicId) return false;
        return loadHiddenPublic().has(publicId);
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
        /* Already-shared local entries flip the button to a
           non-interactive "SHARED" status (STOP SHARING, handled by
           refreshDetailUnshareButton, sits beside it to revert).
           Unshared pots show the tappable "SHARE TO EVERYONE". */
        const lbl = submit.querySelector(".btn-label");
        submit.hidden = false;
        if (entry.publicId) {
            submit.disabled = true;
            submit.classList.add("is-shared-status");
            if (lbl) lbl.textContent = "SHARED";
        } else {
            submit.disabled = false;
            submit.classList.remove("is-shared-status");
            if (lbl) lbl.textContent = "SHARE TO EVERYONE";
        }
        refreshDetailGlow();
    }

    /* Pink "this is out in the world" glow on the detail-modal card
       when the open pot is shared (own pot with a publicId, or a
       public-gallery copy). Mirrors the .pot-card.is-shared glow in
       the vault grid. */
    function refreshDetailGlow() {
        const card = document.querySelector("#potDetail .pot-detail-card");
        if (!card) return;
        const e = GALLERY.detailEntry;
        const shared = !!(e && (e.publicId || (e._isPublic && e._publicId)));
        card.classList.toggle("is-shared", shared);
    }

    /* NAME POOT — the pot is already saved (firing does that); this
       button just commits the typed name. Only the user's own pots
       are nameable (public copies are read-only). The button enables
       only when the field differs from the stored name, so closing
       with an unsaved edit is what the "Exit without saving?" guard
       protects. */
    function detailNameDirty() {
        const entry = GALLERY.detailEntry;
        const input = document.getElementById("detailName");
        if (!entry || !input || entry._isPublic) return false;
        return input.value.trim() !== (entry.name || "");
    }

    function refreshNameSaveButton() {
        const btn = document.getElementById("detailNameSave");
        if (!btn) return;
        const entry = GALLERY.detailEntry;
        btn.hidden = !(entry && !entry._isPublic);
        btn.disabled = !detailNameDirty();
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

    /* ============================================================
       DATA & PRIVACY — Play Store Data Safety compliance
       ============================================================
       Two operations:

       wipeLocalData(): clears every crayte-* localStorage key on
         THIS device. Gallery, drafts, owned packs, achievements,
         egg flags, push prefs — all gone. Server data untouched.
         Available signed-in or signed-out.

       deleteAccount(): full GDPR/CCPA right-to-be-forgotten —
         cascades a hard delete across every server-side row tied
         to the user's id, then deletes the auth user itself, then
         wipes local. Order is important: server rows go FIRST
         while the user's JWT still has RLS access; auth user goes
         LAST because after that we lose the bearer token.

       Both functions update a status line in the data-privacy
       card so the user gets reassuring feedback while the (slow)
       network calls run.
       ============================================================ */

    function dataPrivacyStatus(msg, isError) {
        const el = document.getElementById("dataPrivacyStatus");
        if (!el) return;
        if (!msg) { el.hidden = true; el.textContent = ""; return; }
        el.hidden = false;
        el.textContent = msg;
        el.classList.toggle("is-error", !!isError);
    }

    /* Iterate localStorage + drop every key that belongs to Pootery
       (crayte-* prefix). Other apps on the same origin are
       untouched. Returns the count cleared. */
    function clearLocalCrayteKeys() {
        const toDelete = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf("crayte-") === 0) toDelete.push(k);
            }
            toDelete.forEach(function (k) {
                try { localStorage.removeItem(k); } catch (_) {}
            });
        } catch (_) {}
        return toDelete.length;
    }

    function confirmWipeLocalData() {
        const ok = window.confirm(
            "Wipe Pootery from this device?\n\n" +
            "This deletes your gallery, drafts, owned packs cache, " +
            "achievements, and settings — ON THIS DEVICE.\n\n" +
            "If you're signed in, anything saved on the server stays " +
            "(use DELETE MY ACCOUNT below to remove that too).\n\n" +
            "This cannot be undone."
        );
        if (!ok) return;
        const wiped = clearLocalCrayteKeys();
        dataPrivacyStatus(
            wiped + " local key(s) wiped. Reloading…", false);
        setTimeout(function () { location.reload(); }, 1200);
    }

    /* Server cascade — best-effort DELETE on each table the user
       has RLS access to via owner-only policies. Each table is
       independent so a 404 / 403 on one doesn't block the rest.
       Resolves to true on overall success (auth user deletion
       worked), false otherwise. */
    function cascadeDeleteServerData() {
        if (!supabaseEnabled() || !isSignedIn()) return Promise.resolve(true);
        const uid = currentUserId();
        if (!uid) return Promise.resolve(true);

        const base = SUPABASE_URL + "/rest/v1/";
        const headers = supabaseHeaders({ "Prefer": "return=minimal" });

        /* Tables owned by the user, deleted in reverse-dependency
           order (votes -> battles -> public/battle entries ->
           profile). PostgREST returns 204 No Content on success
           regardless of how many rows were deleted (including 0).
           A 404 means the table doesn't exist in this Supabase
           project (e.g., remix/profile migrations not run) — we
           treat that as success and move on. */
        const deletes = [
            base + "votes?user_id=eq."          + uid,
            base + "battle_entries?user_id=eq." + uid,
            base + "battles?created_by=eq."     + uid,
            base + "public_pots?user_id=eq."    + uid,
            base + "profiles?id=eq."            + uid
        ];

        return deletes.reduce(function (chain, url) {
            return chain.then(function () {
                return fetch(url, { method: "DELETE", headers: headers })
                    .catch(function () { return null; });
            });
        }, Promise.resolve()).then(function () {
            /* Finally delete the auth user itself. After this the
               session is dead and subsequent requests with the
               same JWT will 401. */
            return fetch(SUPABASE_URL + "/auth/v1/user", {
                method: "DELETE",
                headers: {
                    "apikey":        SUPABASE_KEY,
                    "Authorization": "Bearer " + AUTH.session.access_token
                }
            }).then(function (r) { return r.ok; })
              .catch(function () { return false; });
        });
    }

    function confirmDeleteAccount() {
        if (!isSignedIn()) return;
        const ok = window.confirm(
            "Delete your Pootery account?\n\n" +
            "This permanently removes:\n" +
            "  • your profile (handle, name, bio)\n" +
            "  • every pot you shared to the EVERYONE gallery\n" +
            "  • every battle you started\n" +
            "  • every pot you entered in battles\n" +
            "  • every vote you cast\n" +
            "  • your sign-in identity\n" +
            "\nIt also wipes everything on this device.\n\n" +
            "This CANNOT be undone."
        );
        if (!ok) return;

        const btn = document.getElementById("deleteAccountBtn");
        if (btn) {
            btn.disabled = true;
            const lbl = btn.querySelector(".btn-label");
            if (lbl) lbl.textContent = "DELETING…";
        }
        dataPrivacyStatus("Removing server data…", false);

        cascadeDeleteServerData().then(function (success) {
            /* Wipe local regardless of server outcome — the user
               asked to be forgotten and we don't want their
               device hanging on to gallery pots if the server
               call partially failed. */
            clearLocalCrayteKeys();
            if (success) {
                dataPrivacyStatus("Account deleted. Reloading…", false);
            } else {
                dataPrivacyStatus(
                    "Local data wiped. Server cleanup may be " +
                    "incomplete — email pootery@madderverse.org " +
                    "to finish the job. Reloading…", true);
            }
            setTimeout(function () { location.reload(); }, 2000);
        });
    }

    function initAccountScreen() {
        const back = document.getElementById("accountBack");
        if (back) back.addEventListener("click", function () {
            showScreen("title");
        });

        const restore = document.getElementById("restorePurchasesBtn");
        if (restore) restore.addEventListener("click", restorePurchases);

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

        /* DATA & PRIVACY — wipe local + delete account. */
        const wipeBtn = document.getElementById("wipeLocalBtn");
        if (wipeBtn) wipeBtn.addEventListener("click", confirmWipeLocalData);

        const delAcct = document.getElementById("deleteAccountBtn");
        if (delAcct) delAcct.addEventListener("click", confirmDeleteAccount);

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
        /* DELETE MY ACCOUNT only makes sense when there IS an
           account. Hidden for signed-out users — they can still
           wipe local data via the always-visible button above. */
        const delBtn = document.getElementById("deleteAccountBtn");
        if (delBtn) delBtn.hidden = !signed;
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

        const sparksVal = document.getElementById("shopSparksVal");
        if (sparksVal) sparksVal.textContent = sparksBalance();

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
        const free     = !p.priceCents && p.unlock !== "points";
        if (owned)                    card.classList.add("is-owned");
        if (!released)                card.classList.add("is-queued");
        if (free)                     card.classList.add("is-free");
        if (isPackSparkLocked(p)) {
            card.classList.add("is-spark-locked");
            if (isPackAffordable(p)) card.classList.add("is-affordable");
        }
        /* MEGA tier (the $1.99 "special" themed packs) gets the pink
           glow, matching shared pots in the vault. */
        if (p.packType === "special") card.classList.add("is-mega");

        const cover = document.createElement("div");
        cover.className = "shop-cover";
        cover.textContent = p.coverEmoji || "\u{1FAB4}";
        /* Upgrade emoji to the pack's sheet-icon frame when ready
           (no-op for BASIC, which has no sheet). Paints async if
           the sheet PNG hasn't loaded yet. */
        applyPackIconToCover(cover, p);
        card.appendChild(cover);

        const meta = document.createElement("div");
        meta.className = "shop-meta";

        const name = document.createElement("h3");
        name.className = "shop-name";
        name.textContent = p.label;
        /* Pack-type tag — CRAFTER / BUILDER / SPECIAL chip next to
           the name so the kid knows at a glance whether they're
           getting random decals (crafter), character-build parts
           (builder), or a big elaborate set (special). */
        if (p.packType) {
            const tag = document.createElement("span");
            tag.className = "shop-type-tag type-" + p.packType;
            tag.textContent = packTypeLabel(p);
            name.appendChild(tag);
        }
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

        /* No CTA button on the card — tapping anywhere on the card
           opens the pack-detail modal (see openPackPreviewModal),
           which is where the PLAY / BUY / NOTIFY ME button lives.
           Pack state (FREE / $0.99 / DROPS XYZ / OWNED) is already
           shown by .shop-status inside .shop-meta, so the card
           grid drops the trailing auto column. */
        return card;
    }

    /* Pack-type chip label — one word per tag (CRAFTER / BUILDER
       / SPECIAL). buildSubject is still kept on the pack data for
       use in descriptions / the modal, but the card tag stays a
       single clean word. */
    function packTypeLabel(p) {
        if (!p || !p.packType) return "";
        if (p.packType === "builder") return "BUILDER";
        if (p.packType === "special") return "MEGA";
        return "CRAFTER";
    }

    function shopStatusText(p) {
        if (p.unlock === "points") return isPackOwned(p) ? "OWNED"
            : (sparkCost(p) + " ✦");
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
        if (p.unlock === "points") {
            if (isPackOwned(p))      return "PLAY";
            if (isPackAffordable(p)) return "UNLOCK · " + sparkCost(p) + " ✦";
            return (sparkCost(p) - sparksBalance()) + " ✦ TO GO";
        }
        if (!p.priceCents)            return "PLAY";
        if (isPackOwned(p))           return "PLAY";
        if (!isPackReleased(p))       return "NOTIFY ME";
        return "BUY";
    }

    /* Tap on a shop card -> open the pack-detail modal. The modal
       shows every glaze + every stamp included in the pack and
       hosts the single PLAY / BUY / NOTIFY ME button. The previous
       inline-CTA flow lived here directly; that logic now belongs
       to performPackAction(), which the modal's action button
       calls. */
    function handleShopCardClick(packId) {
        const p = GLAZE_PACKS.find(function (x) { return x.id === packId; });
        if (!p) return;
        openPackPreviewModal(p);
    }

    /* Runs the actual PLAY / BUY / NOTIFY-ME action for a pack.
       Called by the modal's action button. Mirrors what the
       inline shop-card CTA used to do. */
    function performPackAction(p) {
        if (!p) return;
        /* Points packs unlock with earned sparks (✦), not money. */
        if (isPackSparkLocked(p)) {
            const cost = sparkCost(p);
            const bal  = sparksBalance();
            if (bal < cost) {
                const need = cost - bal;
                alert(p.label + " unlocks for " + cost + " ✦ sparks.\n\n" +
                      "You have " + bal + " — just " + need + " to go!\n\n" +
                      "Earn sparks by firing pots (+" + SPARK_RATES.fired +
                      "), sharing them (+" + SPARK_RATES.shared +
                      "), finding secrets (+" + SPARK_RATES.egg +
                      "), and winning battles (+" + SPARK_RATES.trophy + ").");
                return;
            }
            const ok = confirm("Unlock " + p.label + " for " + cost +
                " ✦ sparks?\n\nYou have " + bal + " sparks — you'll have " +
                (bal - cost) + " left.");
            if (!ok) return;
            markPackOwned(p.id);          /* permanent; also charges the cost */
            toastSparks(p, cost);
            closePackPreviewModal();
            if (typeof refreshShopScreen === "function") refreshShopScreen();
            /* Drop straight into shaping with the freshly-unlocked pack. */
            D.activePackId = p.id;
            SHAPE.needsLump = false;
            showScreen("shape");
            return;
        }
        const free  = !p.priceCents;
        const owned = isPackOwned(p);
        if (free || owned) {
            /* Jump into shape mode with this pack pre-selected. */
            D.activePackId = p.id;
            SHAPE.needsLump = false;
            closePackPreviewModal();
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
        /* Released + paid + not owned -- real RC purchase. */
        purchasePack(p.id);
    }

    /* ----- Pack-detail modal -----
       A single element pair (overlay + card) is lazily created the
       first time openPackPreviewModal runs and reused thereafter.
       Re-opening rebuilds the inner content for whichever pack
       was tapped. Closing leaves the elements detached so the
       hover styles + ESC/backdrop listeners aren't doubled up. */

    let _packModalEls = null;

    function ensurePackModalEls() {
        if (_packModalEls) return _packModalEls;
        const overlay = document.createElement("div");
        overlay.className = "pack-modal-overlay";
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) closePackPreviewModal();
        });

        const card = document.createElement("div");
        card.className = "pack-modal";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        overlay.appendChild(card);

        const onKey = function (e) {
            if (e.key === "Escape") closePackPreviewModal();
        };

        _packModalEls = { overlay, card, onKey };
        return _packModalEls;
    }

    function closePackPreviewModal() {
        if (!_packModalEls) return;
        const { overlay, onKey } = _packModalEls;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener("keydown", onKey);
    }

    function openPackPreviewModal(p) {
        if (!p) return;
        const els = ensurePackModalEls();
        const { overlay, card, onKey } = els;

        /* Pack-state classes mirror the card so the modal accents
           match (owned = green, queued = pink, free/paid = teal). */
        card.classList.remove("is-owned", "is-queued", "is-free",
                              "is-spark-locked", "is-affordable");
        if (isPackOwned(p))         card.classList.add("is-owned");
        if (!isPackReleased(p))     card.classList.add("is-queued");
        /* Free = no price AND not a spark-unlock pack. */
        if (!p.priceCents && p.unlock !== "points") card.classList.add("is-free");
        if (isPackSparkLocked(p)) {
            card.classList.add("is-spark-locked");
            if (isPackAffordable(p)) card.classList.add("is-affordable");
        }

        card.innerHTML = "";

        const close = document.createElement("button");
        close.className = "pack-modal-close";
        close.type = "button";
        close.setAttribute("aria-label", "Close");
        close.textContent = "✕";   /* × */
        close.addEventListener("click", closePackPreviewModal);
        card.appendChild(close);

        const header = document.createElement("div");
        header.className = "pack-modal-header";

        const cover = document.createElement("div");
        cover.className = "pack-modal-cover";
        cover.textContent = p.coverEmoji || "\u{1FAB4}";
        applyPackIconToCover(cover, p);
        header.appendChild(cover);

        const heading = document.createElement("div");
        heading.className = "pack-modal-heading";
        const name = document.createElement("h2");
        name.className = "pack-modal-name";
        name.textContent = p.label;
        heading.appendChild(name);
        const status = document.createElement("span");
        status.className = "pack-modal-status";
        status.textContent = shopStatusText(p);
        heading.appendChild(status);
        header.appendChild(heading);

        card.appendChild(header);

        if (p.description) {
            const desc = document.createElement("p");
            desc.className = "pack-modal-desc";
            desc.textContent = p.description;
            card.appendChild(desc);
        }

        /* Colors strip ----------------------------------------- */
        const colorsTitle = document.createElement("h3");
        colorsTitle.className = "pack-modal-section";
        colorsTitle.textContent = "GLAZES";
        card.appendChild(colorsTitle);

        const colors = document.createElement("div");
        colors.className = "pack-modal-colors";
        (p.glazes || []).forEach(function (g) {
            const s = document.createElement("div");
            s.className = "pack-modal-swatch";
            if (g === "@rgb-cycle") {
                s.classList.add("is-rgb");
                s.title = "RGB cycle";
            } else {
                s.style.background = g;
                s.title = g;
            }
            colors.appendChild(s);
        });
        card.appendChild(colors);

        /* Stamps strip ----------------------------------------- */
        const stampsTitle = document.createElement("h3");
        stampsTitle.className = "pack-modal-section";
        stampsTitle.textContent = "STAMPS";
        card.appendChild(stampsTitle);

        const stamps = document.createElement("div");
        stamps.className = "pack-modal-stamps";
        (p.patterns || []).forEach(function (id) {
            const tile = document.createElement("div");
            tile.className = "pack-modal-stamp";
            const cv = document.createElement("canvas");
            cv.width  = 64;
            cv.height = 64;
            tile.appendChild(cv);
            stamps.appendChild(tile);
            paintStampPreview(cv, id);
        });
        card.appendChild(stamps);

        /* Textures strip --------------------------------------- */
        const texList = p.surfaceTextures || [];
        if (texList.length) {
            const texTitle = document.createElement("h3");
            texTitle.className = "pack-modal-section";
            texTitle.textContent = "TEXTURES";
            card.appendChild(texTitle);

            const textures = document.createElement("div");
            textures.className = "pack-modal-textures";
            texList.forEach(function (tid) {
                const tile = document.createElement("div");
                tile.className = "pack-modal-texture";
                tile.style.backgroundImage =
                    'url("' + surfaceTextureUrl(tid) + '")';
                tile.title = tid;
                textures.appendChild(tile);
            });
            card.appendChild(textures);
        }

        /* Action button --------------------------------------- */
        const action = document.createElement("button");
        action.className = "pack-modal-action";
        action.type = "button";
        action.textContent = shopCtaText(p);
        action.addEventListener("click", function () {
            performPackAction(p);
        });
        card.appendChild(action);

        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKey);
    }

    /* Render a single stamp preview onto a small canvas. Works
       for both procedural drawers (dot, ring, wave...) and the
       sheet-backed drawers (candy/jawbreaker, mega/icecream...).
       Sheet drawers are registered when each sheet's TexturePacker
       JSON resolves; the same applies for the sheet img's pixels.
       If either is missing on first paint, we poll a few rAF
       frames so the preview pops in as soon as it's ready,
       without needing the modal to be torn down + rebuilt. */
    function paintStampPreview(cv, id) {
        const ctx = cv.getContext("2d");
        const w = cv.width, h = cv.height;
        let tries = 0;
        const MAX_TRIES = 90;   /* ~1.5s @ 60fps */
        function attempt() {
            ctx.clearRect(0, 0, w, h);
            const fn = PATTERN_DRAWERS[id];
            const slash = id.indexOf("/");
            let imgReady = true;
            if (slash > 0) {
                const sheetName = id.slice(0, slash);
                const rec = STICKER_SHEETS[sheetName];
                imgReady = !!(rec && rec.img && rec.img.complete &&
                              rec.img.naturalWidth > 0 && rec.frames);
            }
            if (fn && imgReady) {
                /* Procedural drawers need a paint color — pick a
                   tone that reads on the modal's dark background. */
                fn(ctx, w / 2, h / 2, w * 0.45, "#eaf6f4");
                return;
            }
            if (tries++ < MAX_TRIES) {
                requestAnimationFrame(attempt);
                return;
            }
            /* Give-up placeholder — readable but unobtrusive. */
            ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
            ctx.font = "bold 22px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("?", w / 2, h / 2);
        }
        attempt();
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
            { label: "SPARKS",           val: sparksBalance(),
              accent: "spark" },
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
                return;
            }

            /* No pot/profile deep-link — honor ?screen= if it's
               one of the persistent screens we set on navigation.
               This is what makes pull-to-refresh on the battles
               tab actually keep the user on battles. */
            const screen = params.get("screen");
            if (screen && PERSISTENT_SCREENS[screen]) {
                showScreen(screen);
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
                   the reward, not the prerequisite. Bonus bodies
                   (OCHRE/SLATE/BLUSH/MOSS) are excluded too: this
                   count is dynamic, so without the flag every clay
                   added later would silently raise the bar while the
                   description still promised five. New content should
                   never make an existing achievement harder. */
                const baseCount = CLAY_TYPES.filter(function (c) {
                    return !c.unlockedBy && !c.bonus;
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
        const eye = t.querySelector(".ach-toast-eyebrow");
        if (ic) ic.textContent = a.icon || "★";
        /* Reset the eyebrow — toastSparks() borrows this same toast
           and rewrites it, so restore the default here. */
        if (eye) eye.textContent = "ACHIEVEMENT UNLOCKED";
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

    /* Celebration when a points pack is unlocked with sparks. Borrows
       the achievement toast element, swapping the eyebrow to read
       "PACK UNLOCKED" (toastAch resets it back). */
    function toastSparks(p, cost) {
        const t = document.getElementById("achToast");
        if (t) {
            const ic  = document.getElementById("achToastIcon");
            const txt = document.getElementById("achToastText");
            const eye = t.querySelector(".ach-toast-eyebrow");
            if (ic)  ic.textContent  = p.coverEmoji || "✦";
            if (eye) eye.textContent = "PACK UNLOCKED · −" + cost + " ✦";
            if (txt) txt.textContent = p.label;
            t.hidden = false;
            const fresh = t.cloneNode(true);
            t.parentNode.replaceChild(fresh, t);
            setTimeout(function () { fresh.hidden = true; }, 4800);
        }
        playAchFanfare();
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
        /* Unlock-all reflects whether every paid pack is currently
           in the owned cache. */
        const up = document.getElementById("devUnlockPacks");
        if (up) up.checked = allPaidPacksOwned();
        poot(); poot();   /* victory chord */
        EGG.konamiTriggered = true;
        checkAchievements();
    }

    /* Dev testing helper — every paid pack id (priceCents set). */
    function paidPackIds() {
        return GLAZE_PACKS
            .filter(function (p) { return !!p.priceCents; })
            .map(function (p) { return p.id; });
    }
    function allPaidPacksOwned() {
        const owned = loadOwnedPacks();
        return paidPackIds().every(function (id) { return owned.has(id); });
    }
    function setAllPacksUnlocked(on) {
        const owned = loadOwnedPacks();
        paidPackIds().forEach(function (id) {
            if (on) owned.add(id);
            else    owned.delete(id);
        });
        saveOwnedPacks(owned);
        /* Refresh whatever's on screen so the change shows now. */
        if (currentScreen === "shop" &&
                typeof refreshShopScreen === "function") refreshShopScreen();
        if (currentScreen === "decorate" &&
                typeof renderPackTabs === "function") renderPackTabs();
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
        const up = document.getElementById("devUnlockPacks");
        if (up) up.addEventListener("change", function () {
            setAllPacksUnlocked(up.checked);
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
        initAuth().then(checkURLDeepLinks).then(initBilling);
        /* When auth state changes (sign-in / sign-out), tell RC so
           paid-pack entitlements follow the user account, not the
           device. No-op if RC isn't configured yet. */
        onAuthChange(rcSyncUser);
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
            get WHEEL_SLOW_FACTOR() { return SHAPE.WHEEL_SLOW_FACTOR; },
            get shapeId()          { return SHAPE.shapeId; },
            get heightScale()      { return SHAPE.heightScale; }
        },
        /* Live read-outs for the dip glaze + band decoration port. */
        _dec: {
            get tool()  { return D.tool; },
            get dips()  { return D.dips.slice(); },
            get bands() { return D.bands.slice(); },
            get dripAmount()  { return D.dripAmount; },
            get bandFriezeId() { return D.bandFriezeId; },
            bandImgReady: function (id) {
                const im = BAND_IMAGES[id];
                return !!(im && im.complete && im.naturalWidth);
            }
        }
    };

})();
