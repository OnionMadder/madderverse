# Madderverse push gateway

Cloudflare Worker that owns the Web Push subscription store + send
plumbing for The Madderverse. Lives on `push.onionmadder.rocks` and
is meant to be reusable across games — only Pootery talks to it
today, but the routes (`/subscribe`, `/unsubscribe`,
`/send/pack-drop`, `/send/battle-start`, `/send/battle-end`) are
generic.

> Why a separate Worker? GitHub Pages can't host server code, and
> Web Push needs a backend that can sign VAPID JWTs + POST to each
> subscriber's push endpoint. Cloudflare Workers are free-tier
> generous and KV storage is plenty for subscription records.

## One-time setup (you, on your laptop)

You only need to do this once. After that, `wrangler deploy` is
the only command that ships changes.

### 0. Install + log in to Cloudflare

```sh
cd push-worker
npm install
npx wrangler login          # opens a browser, OAuth into Cloudflare
```

### 1. Create the KV namespace

```sh
npx wrangler kv:namespace create SUBSCRIPTIONS
npx wrangler kv:namespace create SUBSCRIPTIONS --preview
```

Each command prints an `id = "…"`. Paste the production id into
`wrangler.toml` under `[[kv_namespaces]]` -> `id`, and the preview
id under `preview_id`.

### 2. Generate VAPID keys

VAPID is the auth scheme that lets your Worker prove "I am the
sender" to push services (FCM, APNs, Mozilla). The key pair stays
on the Worker as secrets.

```sh
npx -y web-push generate-vapid-keys
```

Note the `Public Key` and `Private Key` — both are base64url.

### 3. Set the Worker's four secrets

```sh
npx wrangler secret put VAPID_PUBLIC_KEY
# paste the base64url public key when prompted

npx wrangler secret put VAPID_PRIVATE_KEY
# paste the base64url private key

npx wrangler secret put VAPID_SUBJECT
# paste e.g. "mailto:onion@madsundar.com"  (any reachable email)

npx wrangler secret put ADMIN_TOKEN
# paste any opaque random string -- this is what curl/cron use
# to authenticate to the /send/* endpoints. Keep it safe.
```

Generate ADMIN_TOKEN with:

```sh
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

### 4. Add `push.onionmadder.rocks` as a custom domain

In the Cloudflare dashboard:

1. Open the Workers project (`madderverse-push`) after the first deploy.
2. **Triggers → Custom Domains → Add Custom Domain**.
3. Type `push.onionmadder.rocks`. Cloudflare will provision the DNS
   record + TLS cert automatically (this only works if `onionmadder.rocks`
   is on Cloudflare DNS — if it's on Spaceship, move DNS to Cloudflare
   first or add a CNAME yourself pointing at the workers.dev URL).

### 5. Deploy

```sh
npx wrangler deploy
```

You should see something like:

```
Deployed madderverse-push triggers (4.2 sec)
  https://madderverse-push.<your-subdomain>.workers.dev
  https://push.onionmadder.rocks/*           (after step 4)
```

### 6. Smoke test

```sh
curl https://push.onionmadder.rocks/health
# -> {"ok":true}
```

## What the Pootery frontend will need (chunk W3)

The frontend needs the **VAPID public key** to convert a
`pushManager.subscribe()` call into a valid subscription. Paste
the same public key you set in step 2 into Pootery's
`game.js` (the constant near the top of the push module —
chunk W3 wires this in). Public is fine to ship in client code;
private must stay on the Worker.

## Routes

| Method | Path                     | Auth          | Body                                                                | What it does                                                                          |
|-------:|--------------------------|---------------|---------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| GET    | `/health`                | none          | —                                                                   | Liveness check.                                                                       |
| POST   | `/subscribe`             | CORS-gated    | `{subscription:PushSubscriptionJSON, user_id?:string, topics?:string[]}` | Idempotent upsert. Empty `topics` = subscribe to all.                                 |
| POST   | `/unsubscribe`           | CORS-gated    | `{endpoint:string}`                                                 | Best-effort delete; always returns ok.                                                |
| POST   | `/send/pack-drop`        | Bearer admin  | `{title, body, url?, icon?}`                                        | Fans out to every subscription with `pack-drop` in topics. Lands in chunk W2.         |
| POST   | `/send/battle-start`     | Bearer admin  | same                                                                | Fans out to `battle-start` subscribers.                                               |
| POST   | `/send/battle-end`       | Bearer admin  | same                                                                | Fans out to `battle-end` subscribers.                                                 |

CORS is locked to `madderverse.org`, `www.madderverse.org`,
`localhost:8000`, `127.0.0.1:8000`. Edit `CORS_ALLOW_ORIGINS` in
`wrangler.toml` if you add another origin (e.g. a staging domain).

## Local development

```sh
npx wrangler dev
```

Starts the Worker on `http://localhost:8787`. The CORS allow-list
already includes localhost, so a locally served Pootery copy
(`python3 -m http.server 8000`) can subscribe against it.

## Tail logs in prod

```sh
npx wrangler tail
```

Streams console output from the running Worker — useful for
debugging which subscription endpoint just returned 410 Gone
during a fanout.

## Setup checklist (copy-paste for yourself)

- [ ] `npm install` ran in `push-worker/`.
- [ ] `wrangler login` completed.
- [ ] Production KV id pasted into `wrangler.toml`.
- [ ] Preview KV id pasted into `wrangler.toml`.
- [ ] VAPID keys generated; public + private set as secrets.
- [ ] `VAPID_SUBJECT` set (mailto: address).
- [ ] `ADMIN_TOKEN` set (random opaque string, saved elsewhere too).
- [ ] `push.onionmadder.rocks` added as custom domain in the dashboard.
- [ ] `wrangler deploy` succeeded.
- [ ] `curl https://push.onionmadder.rocks/health` returns `{"ok":true}`.
- [ ] Pasted VAPID **public** key into Pootery `game.js` (replace
      the `VAPID_PUBLIC_KEY = "REPLACE_WITH_VAPID_PUBLIC_KEY"`
      constant near the top of `pootery/game.js`).
- [ ] Sent a test push to a subscribed device using one of the
      curl recipes below.

---

## Triggering a send (admin)

Once the Worker is live + you've subscribed at least one device
(open Pootery -> fire a pot -> tap "YES, NOTIFY ME"), you can
fan out a notification with curl.

### Pack drop

```sh
curl -X POST https://push.onionmadder.rocks/send/pack-drop \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "NEW PACK: BLACKLIGHT",
    "body":  "Glow-in-the-dark glazes just dropped.",
    "url":   "https://madderverse.org/pootery/?pack=blacklight"
  }'
```

### Battle start

```sh
curl -X POST https://push.onionmadder.rocks/send/battle-start \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "BATTLE: HAUNTED VASE",
    "body":  "Round opens now. 24h to submit.",
    "url":   "https://madderverse.org/pootery/?battle=<battle-uuid>"
  }'
```

### Battle end

```sh
curl -X POST https://push.onionmadder.rocks/send/battle-end \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "RESULTS: HAUNTED VASE",
    "body":  "Voting is in -- see the winner.",
    "url":   "https://madderverse.org/pootery/?battle=<battle-uuid>"
  }'
```

Successful response shape:

```json
{
  "ok": true,
  "topic": "pack-drop",
  "sent": 17,
  "failed": 0,
  "removed_expired": 2,
  "total": 19
}
```

`removed_expired` is the number of dead endpoints the Worker
pruned during this fanout (push services return 404/410 when the
user has uninstalled or disabled the site).

### Storing the admin token locally

For day-to-day admin sends, drop `ADMIN_TOKEN` into a
`~/.config/madderverse-admin` or 1Password item and `export
ADMIN_TOKEN=...` in your shell. **Never** commit it to the repo.

---

## Wiring Pootery's existing battle lifecycle

Push fanout for battle starts/ends is meant to be triggered the
moment a battle row transitions in Supabase, not on a schedule.
Two options:

1. **Manual / opportunistic.** When you create a daily battle (or
   when one expires), run the curl recipe above by hand. Fine
   while there are <50 subscribers.

2. **Supabase database webhook -> Worker.** Add a webhook on the
   `battles` table:
   - On INSERT: POST to the Worker's `/send/battle-start`.
   - On UPDATE where `expires_at` just passed (or when you flip a
     `resolved` flag): POST `/send/battle-end`.
   The webhook sender must include the `Authorization: Bearer
   $ADMIN_TOKEN` header. Supabase database webhooks support custom
   headers, so add `ADMIN_TOKEN` there directly. **Do not** check
   the token into client code.

Pack drops happen on a release cadence you control -- run the
curl by hand the moment you flip a pack from "queued" to "live"
in the pack bank.

---

## Frontend integration notes (Pootery)

These are facts the W3 chunk relies on. Useful if you're ever
porting the integration to another Madderverse game.

- `pootery/sw.js` registers the `push` +
  `notificationclick` handlers. The Pootery main page registers
  this SW once on `window.load`. Bumping the cache version forces
  a clean install on next visit (which is needed to pick up the
  new handlers).
- `pootery/game.js` section `0d. PUSH NOTIFICATIONS`
  owns the subscribe/unsubscribe flow + the in-app prompt + the
  settings toggle. The constant `VAPID_PUBLIC_KEY` near the top
  of that section must match the Worker's `VAPID_PUBLIC_KEY`
  secret exactly (base64url, no padding).
- The in-app prompt fires once per device, gated by:
  - `localStorage["pootery-push-prompted"] === "yes"` -> never again
  - `localStorage["pootery-push-dismissed-until"] > Date.now()` -> 7-day cooldown after "maybe later"
  - `Notification.permission !== "default"` -> already decided
- The settings toggle reflects the union state from `pushState()`:
  granted-on / granted-off / default / denied / unsupported.
  Unsupported hides the whole card so older Safari shows nothing.
- `pushSubscribe(userId)` POSTs the subscription object + an
  optional user id (the Supabase auth user id if signed in). The
  Worker treats `user_id` as opaque -- safe to leave null for
  pre-auth subscribers.

---

## Troubleshooting

| Symptom                                          | Likely cause                                                                                          |
|--------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `curl /send/* -> {"error":"vapid_unconfigured"}` | One of the three VAPID secrets isn't set. Re-run `wrangler secret put`.                               |
| `curl /send/* -> 401 unauthorized`               | `Authorization: Bearer …` missing or `ADMIN_TOKEN` mismatch.                                          |
| Worker logs `subscribe: 410 Gone`                | Expected; the push service told us this endpoint is dead. The Worker prunes it from KV automatically. |
| All sends silently zero out                      | KV namespace id is the placeholder in `wrangler.toml`. Replace + redeploy.                            |
| Browser opt-in modal never appears               | `VAPID_PUBLIC_KEY` in `game.js` still starts with `REPLACE_WITH_` -- the build is gated until it's pasted. |
| Notifications don't show after granting          | iOS Safari requires the site to be **installed to Home Screen** before push works -- check `(display-mode: standalone)`. |
| `wrangler kv:namespace` returns command not found | New Wrangler split this off; use `wrangler kv namespace create` (no colon) on Wrangler 4+.            |
