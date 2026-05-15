# Groodle → Google Play Store rollout plan

A staged plan for turning the existing `groodle/` web game into an
ad-free, kid-friendly Android app on the Google Play Store. Wrapping
strategy is **Capacitor 6** (WebView + native plugin bridge) so we can
keep the existing canvas / Web Audio code unchanged while gaining
native share, file system, and Google Play Billing for theme-pack
IAPs.

Each numbered chunk is sized for a single focused session and ships as
its own commit / PR. Chunks are ordered so each one is shippable even
if later chunks slip — `Chunk 1` produces a working PWA the kids can
already install, `Chunk 4` produces a sideloadable APK, `Chunk 11`
is the actual Play Store launch.

Cross-cutting principle: **the web build at madderverse.org/groodle/
must stay green every step of the way.** The Capacitor app and the web
game share the same source — what we do for the app should not break
the web. If a feature only makes sense in the app, gate it behind a
`window.Capacitor != null` runtime check.

## Decisions locked in

- **Distribution shape**: Capacitor 6 hybrid shell wrapping the
  existing static `groodle/` directory bundled INTO the app (not
  loaded over the network from madderverse.org). Lets the game launch
  with no internet; only the gallery requires connectivity.
- **Monetization**: free base game, optional IAPs for theme/beat/
  accessory packs via Google Play Billing. No ads, ever.
- **Identity**: anonymous, no accounts. Save state in localStorage
  (web) + `@capacitor/preferences` (app, transparently mirrors LS).
- **Backend**: existing Supabase project for the public gallery.
  Anonymous PNG uploads with a kid-safe name field, same as today.
- **Platform scope (v1)**: Android only. iOS is on hold — Apple's kid
  app + IAP rules are stricter and Capacitor handles it the same way
  whenever we're ready.
- **App ID**: `org.madderverse.groodle` (reverse-DNS of the public
  domain — keeps room for `org.madderverse.<other-game>` later if
  more Madderverse games ship as apps).
- **App display name**: "Groodle".
- **First-release IAP catalog**: a single `studio_pack` at **$1.99**.
  Contents proposed: 4 extra backgrounds + 2 extra moves + 2 extra
  beats. One product on launch proves the IAP flow without splitting
  attention; we add more packs in follow-up updates once it's
  working.
- **Privacy policy hosting**: extend the existing site-wide
  `madderverse.org/legal.html` rather than create a Groodle-specific
  page. The Play Store listing's "Privacy Policy" field points at
  the same URL all other Madderverse games already use; the page
  gains a new Groodle-specific section covering the public gallery,
  IAP, and any data the app collects beyond the web version.

## Open decisions

None — all strategic calls resolved. Play Console developer account
confirmed; app ID, IAP catalog, and privacy hosting locked above.

## Chunk 0 — Logistics & prerequisites (no code yet)

Out-of-band setup that's needed before any code:

- Play Console developer account: confirmed (Kelly already paid the
  $25 one-time fee and has access).
- Install Android Studio (or just the command-line tools) — Capacitor
  needs the Android SDK to build. Java 17+ JDK.
- Install Node.js 20+ and npm. Capacitor CLI is npm-distributed.
- App ID is locked at `org.madderverse.groodle`. Once we publish to
  Play it is permanent — Play will not let us change it after the
  first release. Triple-check during chunk 4 setup.
- Generate the upload signing keystore (one-time, kept somewhere safe;
  losing it means losing the ability to update the app). Treat like a
  password — never check in.

**Effort**: ~1 hour, mostly downloads + account setup.
**Deliverable**: a notes doc with the account/keystore details (NOT
checked in).

## Chunk 1 — PWA foundation (web-only)

Even with Capacitor wrapping, the web game itself should be a proper
PWA. This chunk ships value to madderverse.org users immediately (kids
can install the web game to their home screen on any device) and gives
us a solid base for chunk 4.

- Add `groodle/manifest.webmanifest` with name, short_name, theme
  color, background color, display: standalone, start_url, icons in
  72, 96, 128, 144, 152, 192, 384, 512 px.
- Add a maskable icon variant (Android adaptive icons require it).
  Generated from the existing `cover.jpg` or a dedicated `icon.svg`.
- Add `groodle/sw.js` service worker that pre-caches the core game
  shell (`index.html`, `game.js`, `style.css`, hat sprites, body
  silhouette assets). Cache-first strategy. Bump cache name on
  release.
- Add `<link rel="manifest">` to `index.html` head.
- Register the service worker in `game.js` init under a feature flag.
- Hub `index.html` gets an "Install Groodle" affordance for browsers
  that fire `beforeinstallprompt`. Optional but nice.

**Effort**: 1 session.
**Deliverable**: Lighthouse PWA score ≥90; kid can install Groodle on
an Android phone from Chrome and play offline after first load.
**Risk**: low — purely additive to web build.

## Chunk 2 — Default Groodles library (web)

Pre-made character templates for kids who don't know what to draw.
Like the existing SURPRISE / Coloring Book pages, but each "default
Groodle" is a fully drawn-and-decorated character the kid can pick as
a starting point, then tweak. Acts as the seed for the in-app gallery
on first launch (so the gallery is never empty) and as the basis for
"theme bundle" IAPs in chunk 8.

- New `DEFAULT_GROODLES` catalog in `game.js`, each entry: `{ id,
  label, emoji, pose, bg, hat, draw(ctx) }`. Half a dozen seeds:
  Astronaut Bo, Rockstar Daisy, Disco King, Pirate Pip, Princess
  Lily, Robo-9000.
- New 🪄 drawer or section in the existing New / Pages picker. Each
  card shows the rendered Groodle thumb + label + "Use this" button.
- Picking a default Groodle: switch pose, set BG, equip hat, apply
  the draw() template to the canvas, set `currentColor` to something
  sensible. Like SURPRISE but for a chosen identity.
- Optional bonus: a daily-rotating "Featured Groodle" tile in the
  picker that highlights one default each day.

**Effort**: 1 session.
**Deliverable**: 6 well-drawn defaults the kid can pick from.
**Depends on**: nothing.

## Chunk 3 — Pose / "frame" expansion + accessories (web)

The current pose system has 4 poses (standing, cheer, star, groovy).
"Frames" interpretation: more poses. Accessories: hats already exist;
extend to glasses, capes, hand-held props.

- Add 4–6 more poses to `POSES` in `game.js`: sitting, dancing
  (asymmetric), arms-on-hips, animal (cat / dog), ghost / no-legs
  blob. Each updates `transform-origin` so feet stay planted.
- Re-render the silhouette SVG groups from `POSES[poseId]` at runtime
  (already partially done — finish so adding a pose only requires the
  data entry, no SVG handwriting).
- Add an "Accessories" layer parallel to `hat-layer` — a second SVG
  layer above the silhouette that holds glasses, capes, mustaches,
  etc. Each accessory: id, sprite frame (or inline SVG), anchor (eye
  / chin / shoulder / hand-left / hand-right), scale.
- Extend the existing HAT_SHEET sprite atlas with a `props-sheet.png`
  for non-hat accessories. Render via the same `applyHatFrame`-style
  helper, parameterized by anchor.
- Hat shop becomes "Wardrobe" with two tabs: Hats + Accessories. Same
  buy-with-Doodles mechanic.

**Effort**: 1–2 sessions (poses + accessories are independent — split
if needed).
**Deliverable**: 8–10 poses, 15+ hats, 10+ accessories.
**Depends on**: nothing.

## Chunk 4 — Capacitor scaffolding + first APK

Wrap the static `groodle/` directory in a Capacitor 6 Android shell.
First sideloadable APK that runs the game offline on a real phone.

- New top-level `groodle-app/` directory (separate from `groodle/` to
  keep the web build untouched). Contains `package.json`, Capacitor
  config, Android project.
- `package.json` deps: `@capacitor/core`, `@capacitor/cli`,
  `@capacitor/android`, `@capacitor/preferences`, `@capacitor/share`,
  `@capacitor/filesystem`, `@capacitor/app`. No build step — Capacitor
  copies the `webDir` straight into the Android assets.
- `capacitor.config.ts` with `appId: 'org.madderverse.groodle'`,
  `appName: 'Groodle'`, `webDir: '../groodle'` (point at the existing
  static directory). `bundledWebRuntime: false`.
- A pre-build step (npm script `prebuild` or a small Node script)
  that copies `groodle/` into `groodle-app/www/` and rewrites the
  absolute `https://madderverse.org/...` favicon + manifest URLs to
  relative paths (so they resolve inside the WebView's local
  `capacitor://` scheme).
- Generate app icon + adaptive icon variants at all densities. Use
  `@capacitor/assets` to generate from a single 1024×1024 source.
- Splash screen using the brand neon palette.
- `npx cap add android` → `npx cap sync` → `npx cap open android` →
  build debug APK in Android Studio → sideload to a real Android
  phone.
- Smoke test: game loads offline, drawing works, audio plays,
  achievements/hats persist across kills.

**Effort**: 1 session.
**Deliverable**: debug APK file you can drop on a phone and play.
**Depends on**: chunk 0 (Android Studio + JDK + Play Console).
**Risk**: medium — first time the game runs without a real http
server, so all paths must be relative. The favicon + manifest + SEO
absolute URLs are the likely papercuts; the prebuild script handles
those.

## Chunk 5 — Native share + filesystem (Capacitor plugins)

Wire the SAVE button and the gallery to Android's native facilities
so kids can share Groodles to other apps and the app feels like a
real app.

- `@capacitor/share` integration: detect Capacitor at runtime; when
  available, after a successful gallery save (or in parallel to it),
  offer "Share" that calls `Share.share({ files: [pngPath], dialogTitle:
  'Share your Groodle' })` opening the OS share sheet.
- `@capacitor/filesystem`: save Groodle PNGs into the app's external
  documents directory so kids find them in their phone's gallery
  alongside other photos. Optional "Save to phone" button next to
  "Save to gallery".
- Local "My Groodles" tab in the gallery modal — a list of PNGs saved
  locally on this device, even if not posted to the Supabase gallery.
- Use `@capacitor/preferences` as a drop-in replacement for
  `localStorage` in the app build. Wrapper in `game.js` that picks
  the right backend at runtime.

**Effort**: 1 session.
**Deliverable**: native share sheet works; "My Groodles" local
gallery shows.
**Depends on**: chunk 4.

## Chunk 6 — Theme/beat/accessory pack data model (web + app)

Bundle the content we have today (and from chunks 2–3) into "packs"
so the IAP plumbing in chunk 8 has something to sell. No payment code
yet — packs are owned-by-default this chunk; chunk 8 gates ownership.

- `PACKS` catalog in `game.js`. Each pack: `{ id, name, kind,
  description, contents, priceUsd, defaultOwned }`. Kinds: `theme`
  (BGs + maybe a pose), `beat` (1 MOVE + 1 BEAT), `accessory` (3–5
  hats or props). Base game owns the existing content as the
  default pack `groodle-original`.
- New "Packs" modal accessible from the main dock. Each card: pack
  preview (mini Groodle wearing the pack's hat on the pack's BG with
  a label showing the pack's beat), Own/Locked badge, price tag
  (hidden until chunk 8 wires IAP).
- Per-pack ownership in `state.packs.owned: ['groodle-original']`.
  When a kid switches to a locked pack's pose / BG / hat / beat, the
  picker shows a "Locked" pill and routes to the pack purchase
  screen.
- Initial packs: `groodle-original` (free), `studio-pack` (4 BGs +
  beats — locked starter IAP), `disco-pack`, `cosmic-pack`,
  `circus-pack`, `garden-pack`.
- Designed so a future "all packs" pseudo-pack ($9.99 unlocks
  everything forever) is a one-line addition.

**Effort**: 1–2 sessions (data model is small; UI is the bulk).
**Deliverable**: kid can browse 5 packs, sees lock badges, but
everything is unlocked since IAP isn't wired yet.
**Depends on**: chunks 2 + 3 (content to bundle).

## Chunk 7 — Backend hardening for the gallery

Before we ship to thousands of kids via Play, tighten Supabase RLS +
add minimal moderation.

- New `groodle_reports` table — anonymous report POSTs with `(groodle_id,
  reason, created_at)`, INSERT-only public, SELECT admin-only. Report
  button on each gallery card; a Groodle gets auto-hidden client-side
  after N reports.
- Storage upload rate-limit: a Supabase Edge Function fronting the
  upload that enforces "1 submission per device per 60 seconds" via a
  device fingerprint (Capacitor `App.getInfo().id`-style anonymous
  install id). No PII.
- Move from anon JWT to a per-install Supabase JWT minted by a Play
  Integrity-verified Edge Function (so only legit app installs can
  POST). Web build keeps anon JWT.
- Gallery client side: paginated, lazy-load images, "Show more"
  button. Today's `limit(48)` becomes the page size with offset.
- Optional: a one-time client-side ML profanity / NSFW check on the
  composed PNG before upload (TensorFlow.js with a tiny model). Adds
  ~500 KB to the bundle; opt-in.

**Effort**: 1–2 sessions.
**Deliverable**: safer gallery that resists spam and abuse.
**Depends on**: existing Supabase setup (`SUPABASE_SETUP.md`).

## Chunk 8 — IAP integration (Google Play Billing)

Wire pack ownership to real money via Google Play Billing.

- Add `@revenuecat/purchases-capacitor` (RevenueCat wraps Google Play
  Billing + iOS StoreKit, handles receipt validation server-side, and
  is free up to $10K/month). Alternative: pure
  `capacitor-google-play-billing` plugin if you'd rather self-host
  receipt validation.
- Define one product in Play Console matching the launch IAP:
  `studio_pack` at $1.99, one-time non-consumable. The PACKS catalog
  in chunk 6 carries the others (`disco_pack`, `cosmic_pack`,
  `circus_pack`, `garden_pack`) as `defaultOwned: false, priceUsd:
  null` placeholders so adding them later is a Play Console + price
  edit, not a code change. Optional bundle `all_packs` similarly
  stays a placeholder until we ship more packs.
- Init the IAP SDK on app launch. On first launch and on resume,
  call `restorePurchases()` so reinstalls and device changes restore
  what the kid already owns.
- Wire pack purchase: tap the lock pill → show pack-purchase modal →
  call SDK's `purchase(productId)` → on success, write
  `state.packs.owned.push(packId)`, save, re-render. On failure or
  cancel, return to the lock pill with a status message.
- Refund handling: on `purchaseStatusUpdated`, remove from
  `state.packs.owned`.
- Test track: use Play Console license testers + sandbox products so
  purchases don't charge real money during development.

**Effort**: 2 sessions (one to wire SDK + flow, one for cross-device
testing).
**Deliverable**: an IAP works end-to-end on a real device with sandbox
billing, including restore on reinstall.
**Depends on**: chunks 4 + 6, Play Console product setup.

## Chunk 9 — Polish + native UX

The kind of stuff Play reviewers and parents notice immediately.

- Splash screen — branded Groodle splash that fades into the home
  screen rather than the default Capacitor white-screen-flash. Tune
  `@capacitor/splash-screen` config.
- Status bar — `@capacitor/status-bar` set to the brand purple so
  the system bars don't break the immersive theme.
- Keyboard handling — if any UI field ever has a software-keyboard
  pop (the gallery save name field does), make sure the page doesn't
  scroll into a weird state.
- Haptic feedback on key actions: tap a swatch, hit Dance, unlock an
  achievement → tiny vibration via `@capacitor/haptics`.
- App icon polish — replace the placeholder with finished art at
  every density (mdpi → xxxhdpi + adaptive layers). Use
  `@capacitor/assets` from a single 1024×1024 + foreground SVG.
- Localization scaffolding (even if v1 is English-only, the JSON
  pattern means a translator can add `groodle/i18n/es.json` later
  without code changes).

**Effort**: 1 session.
**Deliverable**: the app feels native, not "a website in a box".
**Depends on**: chunk 4.

## Chunk 10 — Compliance + Play Console readiness

Everything the Play Console asks for during submission.

- Extend the existing `madderverse.org/legal.html` (site-wide for
  every Madderverse game) with a new "Groodle-specific" section
  covering: the public gallery (what kids can / can't post, how to
  report or request takedown), the Studio Pack IAP and how to refund
  via Google Play, anonymous device-install identifiers used only
  for rate-limiting gallery uploads, and how to clear all local data
  (uninstall the app or use the web game's "Clear" + browser local-
  storage clear). The Play Console "Privacy Policy" field points at
  `https://madderverse.org/legal.html` — same URL every other
  Madderverse property already uses.
- Data safety form (Play Console questionnaire) — should be mostly
  "Doesn't collect" + "Yes, kids can post user-generated content"
  + "Doesn't share data with third parties".
- Content rating questionnaire — Everyone. Note the gallery is
  moderated.
- Family policy + Designed for Families compliance:
  - No PII collection for under-13.
  - Ad-free (we are).
  - IAPs require Play Billing (we will).
  - Persistent identifiers off (no analytics SDKs; goatcounter is
    server-side IP, no client cookies — verify it's still ok for the
    DFF program or strip it from the app build).
- COPPA notice in-app under About / Settings.
- Pre-launch report — Play runs the APK on a fleet of real devices.
  Fix any crashes or accessibility flags it surfaces.

**Effort**: 1–2 sessions (policy doc + form filling + fixes).
**Deliverable**: green status on every Play Console readiness check.

## Chunk 11 — Store listing + launch

The Play Store presence itself.

- App icon (1024×1024, no transparency).
- Feature graphic (1024×500).
- Phone screenshots (≥4, max 8) showing: drawing inside the
  silhouette, a finished Groodle dancing, the pack picker, the
  gallery, an achievement toast.
- 7-inch and 10-inch tablet screenshots.
- Short description (80 chars) — punchy hook.
- Full description (4000 chars) — sell it: kid-safe, ad-free,
  multiple poses, dance to your own creation, share with friends,
  unlockable theme packs.
- Promo video (optional, 30s) — screen recording with a kid drawing
  + dance reveal.
- Initial release rollout: Internal Testing (Kelly + friends) →
  Closed Testing (a dozen+ kid testers) → Open Testing (anyone with
  the opt-in link) → Production at small staged % rollout (5% → 20%
  → 100%).
- Post-launch monitoring: Play Console crash reporting + ANR
  reports; check reviews daily for the first week.

**Effort**: 1–2 sessions (assets are the bulk).
**Deliverable**: live listing at
`play.google.com/store/apps/details?id=org.madderverse.groodle`.
**Depends on**: every prior chunk green.

## Effort summary

| Chunk | Title | Sessions | Risk |
|---|---|---|---|
| 0 | Logistics + prereqs | 1h | — |
| 1 | PWA foundation | 1 | low |
| 2 | Default Groodles | 1 | low |
| 3 | Poses + accessories | 1–2 | low |
| 4 | Capacitor + first APK | 1 | medium |
| 5 | Native share + FS | 1 | low |
| 6 | Pack data model | 1–2 | low |
| 7 | Backend hardening | 1–2 | medium |
| 8 | IAP integration | 2 | medium |
| 9 | Native polish | 1 | low |
| 10 | Compliance | 1–2 | low |
| 11 | Store listing + launch | 1–2 | low |

**Total**: 13–18 focused sessions to Play Store production, assuming
no major Play review pushback. Chunks 1–3 ship value to the web users
along the way, so this isn't "13 sessions of nothing." Chunk 4 is
the inflection point — after that, we have a real APK and every
chunk improves it.

## Parallelization

The chunks below run in parallel if you ever want to split work:

- **Web content track** (chunks 1, 2, 3, 6) — pure groodle/ web edits,
  no Android dependency. Could be a separate person / session.
- **Mobile shell track** (chunks 4, 5, 9) — requires Android Studio
  and a phone.
- **Backend track** (chunk 7) — pure Supabase / SQL work, parallel
  to everything.
- **Storefront track** (chunks 10, 11) — content + policy writing,
  no engineering.
- **Billing track** (chunk 8) — depends on chunks 4 + 6.

## After v1 ships

Not in scope of this plan but worth noting so we don't paint into a
corner:

- **iOS version** — the same Capacitor source ports to iOS with
  `npx cap add ios`. The IAP plugin already covers iOS via
  StoreKit. The blocker is Apple's separate Family policy review.
- **Tablet-specific layouts** — the current responsive CSS handles
  bigger screens, but a dedicated landscape tablet UX (split view:
  canvas on left, dock on right) would shine.
- **A second pose-driven game** in the Madderverse hub built from
  the same engine. The shape system in `POSES` + the canvas clip
  already generalizes; the missing piece is content + theming.

## How to start

Tell me which chunk to begin and I'll either implement it or break
it into the smallest first commit if it's still too big. Most natural
order is chunks 1 → 2 → 3 in parallel-ish (web only), then 4 (the
APK), then everything downstream.
