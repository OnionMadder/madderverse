/* ============================================================
   Madderverse push gateway — Cloudflare Worker entry point
   ============================================================
   Generic Web Push gateway. Subscriptions live in KV; admin can
   fan a message out across every subscriber whose topics include
   the requested event.

   Routes:
     GET  /health                  -> 200 OK
     POST /subscribe               -> store/refresh a subscription
     POST /unsubscribe             -> delete a subscription
     POST /send/pack-drop          -> admin-only fanout
     POST /send/battle-start       -> admin-only fanout
     POST /send/battle-end         -> admin-only fanout

   KV shape (keyed by sha-256 of endpoint, base64url):
     subscription:<hash> -> StoredSubscription (see types below)

   The Worker is meant to be reusable across Madderverse projects;
   the `user_id` field on each subscription is opaque and any
   caller may use it for whatever attribution it likes.
   ============================================================ */

import { sendPush } from "./push.js";

export interface Env {
    SUBSCRIPTIONS: KVNamespace;
    /* secrets (set via `wrangler secret put`) */
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    ADMIN_TOKEN?: string;
    /* non-secret vars (wrangler.toml) */
    CORS_ALLOW_ORIGINS: string;
    DEFAULT_TOPICS: string;
}

/* The exact shape we accept from `pushManager.subscribe()`. */
interface SubscriptionKeys {
    p256dh: string;
    auth:   string;
}

interface WebPushSubscription {
    endpoint: string;
    keys:     SubscriptionKeys;
    expirationTime?: number | null;
}

interface StoredSubscription extends WebPushSubscription {
    user_id:       string | null;
    subscribed_at: string;
    topics:        string[];
}

/* ============================================================
   Router
   ============================================================ */

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const url    = new URL(req.url);
        const path   = url.pathname.replace(/\/+$/, "") || "/";
        const origin = req.headers.get("Origin");

        /* CORS preflight first -- short-circuit before routing. */
        if (req.method === "OPTIONS") {
            return preflight(req, env);
        }

        try {
            switch (path) {
                case "/health":
                    return json({ ok: true }, 200, corsHeaders(origin, env));

                case "/subscribe":
                    if (req.method !== "POST") return methodNotAllowed(origin, env);
                    return handleSubscribe(req, env, origin);

                case "/unsubscribe":
                    if (req.method !== "POST") return methodNotAllowed(origin, env);
                    return handleUnsubscribe(req, env, origin);

                case "/send/pack-drop":
                    if (req.method !== "POST") return methodNotAllowed(origin, env);
                    return handleSend(req, env, origin, "pack-drop");

                case "/send/battle-start":
                    if (req.method !== "POST") return methodNotAllowed(origin, env);
                    return handleSend(req, env, origin, "battle-start");

                case "/send/battle-end":
                    if (req.method !== "POST") return methodNotAllowed(origin, env);
                    return handleSend(req, env, origin, "battle-end");

                default:
                    return json(
                        { error: "not_found", path },
                        404,
                        corsHeaders(origin, env)
                    );
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return json(
                { error: "internal_error", message },
                500,
                corsHeaders(origin, env)
            );
        }
    }
};

/* ============================================================
   /subscribe
   ============================================================
   Accepts a Web Push subscription object plus an optional
   user_id. Idempotent: re-subscribing with the same endpoint
   refreshes the stored topics + user_id (so a user can rotate
   their topic preferences just by POSTing again).             */

async function handleSubscribe(
    req: Request, env: Env, origin: string | null
): Promise<Response> {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return json({ error: "invalid_json" }, 400, corsHeaders(origin, env));
    }

    const sub = body?.subscription as WebPushSubscription | undefined;
    if (!sub || typeof sub.endpoint !== "string" ||
        !sub.keys || typeof sub.keys.p256dh !== "string" ||
        typeof sub.keys.auth !== "string") {
        return json(
            { error: "invalid_subscription" },
            400,
            corsHeaders(origin, env)
        );
    }

    /* Topics: clamp to the configured allow-list -- callers can't
       invent new event types we don't fan out.                  */
    const allowed   = env.DEFAULT_TOPICS.split(",").map(s => s.trim());
    const requested = Array.isArray(body?.topics)
        ? (body.topics as unknown[]).filter(t => typeof t === "string") as string[]
        : allowed;
    const topics = requested.filter(t => allowed.includes(t));
    /* Empty subscribe = subscribe to everything (so the simple
       "yes notify me" tap in the UI doesn't have to enumerate
       topics it doesn't know about yet). */
    const finalTopics = topics.length ? topics : allowed;

    const userId = typeof body?.user_id === "string" ? body.user_id : null;
    const key    = await subscriptionKey(sub.endpoint);

    const stored: StoredSubscription = {
        endpoint:      sub.endpoint,
        keys:          sub.keys,
        user_id:       userId,
        subscribed_at: new Date().toISOString(),
        topics:        finalTopics
    };

    await env.SUBSCRIPTIONS.put(key, JSON.stringify(stored));

    return json(
        { ok: true, key, topics: finalTopics },
        200,
        corsHeaders(origin, env)
    );
}

/* ============================================================
   /unsubscribe
   ============================================================
   Removes a subscription by endpoint. Always returns ok=true
   even if the key didn't exist, so callers don't leak "was this
   endpoint subscribed?" via the response.                       */

async function handleUnsubscribe(
    req: Request, env: Env, origin: string | null
): Promise<Response> {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return json({ error: "invalid_json" }, 400, corsHeaders(origin, env));
    }

    const endpoint = body?.endpoint;
    if (typeof endpoint !== "string") {
        return json(
            { error: "missing_endpoint" },
            400,
            corsHeaders(origin, env)
        );
    }

    const key = await subscriptionKey(endpoint);
    await env.SUBSCRIPTIONS.delete(key);

    return json({ ok: true }, 200, corsHeaders(origin, env));
}

/* ============================================================
   Helpers — CORS, hashing, JSON, error shortcuts
   ============================================================ */

function originAllowed(origin: string | null, env: Env): boolean {
    if (!origin) return false;
    return env.CORS_ALLOW_ORIGINS.split(",")
        .map(s => s.trim())
        .some(o => o === origin);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
    const headers: Record<string, string> = {
        "Vary": "Origin"
    };
    if (originAllowed(origin, env) && origin) {
        headers["Access-Control-Allow-Origin"]  = origin;
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
        headers["Access-Control-Max-Age"]       = "86400";
    }
    return headers;
}

function preflight(req: Request, env: Env): Response {
    const origin = req.headers.get("Origin");
    return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env)
    });
}

function json(
    body: unknown,
    status: number,
    extra: Record<string, string> = {}
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...extra
        }
    });
}

function methodNotAllowed(origin: string | null, env: Env): Response {
    return json(
        { error: "method_not_allowed" },
        405,
        corsHeaders(origin, env)
    );
}

/* ============================================================
   /send/<topic>
   ============================================================
   Admin-only fanout. Requires `Authorization: Bearer <ADMIN_TOKEN>`.
   Body: { title:string, body:string, url?:string, icon?:string }.
   Iterates KV in pages, encrypts + signs per subscription, posts
   in batches of 10 concurrent requests. Deletes any subscription
   that returns 404/410 (the push service told us it's gone).    */

const SEND_BATCH_SIZE = 10;

interface SendPayload {
    /* Stable shape consumed by the Pootery service worker's
       `push` event handler. Keep additions backward-compatible. */
    topic:    string;
    title:    string;
    body:     string;
    url?:     string;
    icon?:    string;
    /* Coarse-grained timestamp for client-side debouncing if a
       device wakes from sleep and receives a stack of pushes. */
    sent_at:  string;
}

interface StoredSubscriptionPlus extends StoredSubscription { _key: string; }

async function handleSend(
    req: Request, env: Env, origin: string | null, topic: string
): Promise<Response> {
    /* Auth gate */
    const adminToken = env.ADMIN_TOKEN;
    if (!adminToken) {
        return json(
            { error: "admin_token_unset" },
            500,
            corsHeaders(origin, env)
        );
    }
    const provided = (req.headers.get("Authorization") || "")
        .replace(/^Bearer\s+/i, "");
    if (provided !== adminToken) {
        return json(
            { error: "unauthorized" },
            401,
            corsHeaders(origin, env)
        );
    }

    /* VAPID config gate */
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
        return json(
            { error: "vapid_unconfigured" },
            500,
            corsHeaders(origin, env)
        );
    }
    const vapid = {
        publicKey:  env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject:    env.VAPID_SUBJECT
    };

    /* Body */
    let body: any;
    try { body = await req.json(); }
    catch { return json({ error: "invalid_json" }, 400, corsHeaders(origin, env)); }

    if (typeof body?.title !== "string" || typeof body?.body !== "string") {
        return json(
            { error: "missing_title_or_body" },
            400,
            corsHeaders(origin, env)
        );
    }

    const payloadObj: SendPayload = {
        topic,
        title:   body.title,
        body:    body.body,
        url:     typeof body.url  === "string" ? body.url  : undefined,
        icon:    typeof body.icon === "string" ? body.icon : undefined,
        sent_at: new Date().toISOString()
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));

    /* Collect every subscription that's subscribed to this topic.
       KV.list paginates -- walk all pages. Worker free tier
       allows up to ~30s wall clock; thousands of subscriptions
       are fine here. If we ever blow past that we'll need to
       paginate the work itself (e.g. queue-driven fanout).      */
    const subs: StoredSubscriptionPlus[] = [];
    let cursor: string | undefined = undefined;
    do {
        const page: KVNamespaceListResult<unknown> = await env.SUBSCRIPTIONS.list({
            prefix: "subscription:",
            cursor
        });
        for (const k of page.keys) {
            const raw = await env.SUBSCRIPTIONS.get(k.name);
            if (!raw) continue;
            try {
                const sub = JSON.parse(raw) as StoredSubscription;
                if (sub.topics && sub.topics.indexOf(topic) >= 0) {
                    subs.push({ ...sub, _key: k.name });
                }
            } catch { /* skip malformed records */ }
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    let sent = 0;
    let failed = 0;
    let removed = 0;

    for (let i = 0; i < subs.length; i += SEND_BATCH_SIZE) {
        const batch = subs.slice(i, i + SEND_BATCH_SIZE);
        const results = await Promise.all(batch.map(async (sub) => {
            try {
                const r = await sendPush(sub.endpoint, sub.keys, payloadBytes, vapid);
                if (r.expired) {
                    await env.SUBSCRIPTIONS.delete(sub._key);
                    return { kind: "expired" } as const;
                }
                return { kind: r.ok ? "sent" : "failed", status: r.status } as const;
            } catch (e) {
                return {
                    kind: "failed",
                    status: 0,
                    error: e instanceof Error ? e.message : String(e)
                } as const;
            }
        }));
        for (const r of results) {
            if (r.kind === "sent")    sent++;
            if (r.kind === "expired") removed++;
            if (r.kind === "failed")  failed++;
        }
    }

    return json(
        { ok: true, topic, sent, failed, removed_expired: removed, total: subs.length },
        200,
        corsHeaders(origin, env)
    );
}

/* SHA-256(endpoint) -> base64url -> `subscription:<hash>` KV key.
   Same endpoint always hashes to the same key, so re-subscribing
   from the same device just rewrites the record (idempotent).   */
async function subscriptionKey(endpoint: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(endpoint)
    );
    return "subscription:" + base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
