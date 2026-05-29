# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A static site published as GitHub Pages at **madderverse.org** (see `CNAME`). It is the landing hub for a collection of standalone, ad-free browser games for kids ("The Madderverse"). There is **no build system, no package manager, no test suite, and no lint config** — every file is shipped to the browser exactly as it appears on disk.

`index.html` is the hub that links to each game; `404.html` is the GitHub Pages fallback; `assets/` holds the favicon set and the *hub-only* shared stylesheet (`assets/css/style.css`). Each game lives in its own top-level directory and is otherwise self-contained.

## Local workflow

Because everything is static, "running" the site means serving the repo root over HTTP so relative paths and `fetch()`-style requests behave the same as on madderverse.org:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

Open a specific game directly at `http://localhost:8000/<game-dir>/`. Opening `index.html` via `file://` will break asset paths in some games and is not a valid test of behavior.

Deployment: pushing to `main` publishes via GitHub Pages (through a GitHub Actions workflow — see **Deployment** below) — there is no staging environment. Do **not** push speculative changes to `main`; the working branch for Claude-driven changes is `claude/add-claude-documentation-aByyj` (see the development-branch instructions in your task setup).

## Deployment

The site deploys to GitHub Pages via a **GitHub Actions workflow**, not the legacy "deploy from a branch" mode. Some of this is invisible from the code alone:

- **Source = "GitHub Actions"** is set in the repo's Settings → Pages (a GitHub web-UI setting, not a file in the repo). The deploy is driven by **`.github/workflows/deploy-pages.yml`**, which runs on every push to `main` (or manually via *Actions → Deploy to GitHub Pages → Run workflow*).
- **Do not delete or rename `.github/workflows/deploy-pages.yml`** — there is no branch-deploy fallback anymore, so removing it silently stops all deploys. It uploads the repo root (`path: '.'`), which keeps `CNAME` (the madderverse.org custom domain) intact.
- **Intermittent `Bad credentials` (HTTP 401) failures are a known transient GitHub-side blip**, not a misconfiguration. If a deploy fails with that error at the *Setup Pages* or *Deploy to GitHub Pages* step, just re-run it — an identical re-run usually passes:
  ```bash
  gh run list --repo OnionMadder/madderverse --limit 5   # find the failed run id (needs `gh auth login` first)
  gh run rerun <run-id> --repo OnionMadder/madderverse
  ```
  Confirm live status with `gh api repos/OnionMadder/madderverse/pages` → expect `"status":"built"` and `"build_type":"workflow"`.
- This replaced the old auto *pages-build-deployment* workflow on 2026-05-23, after that began failing with `401 Bad credentials` and updates stopped reaching the live site.

## Repository layout

Each game directory follows one of two shapes. **Match the existing shape of the game you are editing — do not reorganize.**

- **Flat shape** (most games — `cookie-cache/`, `krazy-kritters/`, `georges-jump/`, `friend-picker/`, `bala-draws/`, `all-monkeys/`): `index.html` + `game.js` + `style.css` at the game root, with `assets/` (typically `audio/`, `img/`, `sprites/`) alongside.
- **Split shape** (`gazonionaire/` only): `index.html` at root, with `css/style.css`, and `js/` split into `data.js` (constants/economy tables), `game.js` (pure state + rules, no DOM), and `ui.js` (DOM/event layer). Load order in HTML is `data.js` → `game.js` → `ui.js`; preserve that ordering when editing.

Other top-level entries:
- `index.html` — hub page; the `<nav class="game-grid">` is the **source of truth for which games are advertised** (see "Advertised vs. unlisted games" below). Add/remove a `.game-card` here when shipping/retiring a game. The hub also carries JSON-LD (`WebSite`/`Organization`/`Person`/`CollectionPage`) and visible About/Promise sections used for SEO + AI discoverability — keep the JSON-LD `ItemList` in sync with the grid when games are added/removed.
- `404.html` — GitHub Pages 404; uses the shared `assets/css/style.css`.
- `assets/css/style.css` — **only** styles `index.html` and `404.html` (selectors are scoped under `body.kids-hub` and `.not-found-container`). It is not imported by any game; do not move game-specific styles here.
- `assets/favi/` + `site.webmanifest` — site-wide favicon set referenced by absolute `https://madderverse.org/...` URLs from every page.
- `sitemap.xml`, `robots.txt`, `llms.txt` — site-wide discovery files at the repo root. `robots.txt` intentionally **allows** AI crawlers (GPTBot, ClaudeBot, Google-Extended, anthropic-ai, PerplexityBot, etc.) — we *want* them indexing. `sitemap.xml` lists only the advertised games + key pages. `llms.txt` is a plain-English studio/catalog summary for LLMs (per llmstxt.org). Keep all three in sync with the advertised game set.

### Advertised vs. unlisted games

The hub grid lists only finished, shipping games. **Every game directory that is NOT on the hub grid is a work-in-progress** — present on disk and sometimes reachable by direct URL, but deliberately not advertised, and intentionally excluded from `sitemap.xml`, `llms.txt`, and the hub's JSON-LD `ItemList`. Do not add a WIP game to the hub / sitemap / schema until the user says it's ready.

- **Advertised (on the hub, in the order they appear):** Hole-Up, Glass Gallery, Slip Studio, All Munkis, Pootery, Tonehouse, Groodle, Tub's Cookie Cache, George's Jump, GazOnionaire, Krazy Kritters, Friend Picker.
- **Unlisted / WIP (on disk, NOT advertised):** `munki-madness/`, `bala-draws/`, `eat-worms/`, `giggle-gears/`, `tiny-canvas/` (and any future dir not yet on the grid). `giggle-gears/` in particular still carries stale FYMZ branding and is not launch-ready.

## Conventions worth knowing

**Game stylesheets and scripts load via relative paths from the game's own directory** (`href="style.css"`, `src="game.js"`, or `css/style.css` + `js/*.js` for `gazonionaire/`). Do not introduce absolute `https://madderverse.org/...` URLs for in-game CSS/JS — they break local dev by silently loading production assets. SEO meta tags (`canonical`, `og:url`, `og:image`, `twitter:*`) and the favicon set are intentionally kept as absolute production URLs because they're consumed by external scrapers and PWA installers.

**FYMZ is legacy branding.** The site was previously hosted at `fymz.lol` ("Find Your Madder Zone"). New/updated pages should brand as "The Madderverse", point all absolute URLs at `madderverse.org`, and use the shared GoatCounter beacon `https://madderverse.goatcounter.com/count`. Several older game pages (e.g. `cookie-cache/`) still carry "FYMZ" / "Find Your Madder Zone" in their `<meta name="keywords">` and `<meta name="title">` — leave those alone unless explicitly asked to migrate.

**Sprite sheets are addressed by hand-coded pixel coordinates.** See `cookie-cache/game.js` (`SHEETS`/`FRAMES`/`applySprite`) for the canonical pattern: a sheet's full pixel `w`/`h` plus per-frame `x,y,w,h`, scaled to display size in `applySprite`. If you change a sprite sheet image, the coordinate tables in the matching `game.js` must be updated to match.

**Gazonionaire layering is load-bearing.** `js/game.js` is written as pure state + rules with no DOM access (see the comment at the top of the file); `js/ui.js` owns the DOM. Keep that split — don't reach into `document.*` from `game.js`, and don't put game-rule logic into `ui.js`.

**Analytics + footer year boilerplate** appears on every page: a GoatCounter `<script data-goatcounter="https://madderverse.goatcounter.com/count" ...>` tag, and a small inline `document.getElementById("year").textContent = new Date().getFullYear()` for the footer. New pages should include both.

**The site brands itself as ad-free and kid-friendly** (see `index.html` meta tags and tagline). Do not add ad networks, third-party trackers beyond the existing GoatCounter, or external script dependencies without explicit instruction.

## Commit style

`git log` shows many commits of the form "Add files via upload" (GitHub web UI uploads) interleaved with descriptive messages like "Gazonionaire: ship sprite atlases, Win95 UI, fuel system, competitors". When committing through Claude Code, prefer the descriptive form: short imperative subject, mention the affected game directory by name when the change is scoped to one game.

---

## Pootery — canonical name & folder (authoritative)

The game's **canonical name is "Pootery: Throw, Glaze, Fire"**; the short brand / under-the-icon name is **"Pootery"**. The old name **"Let's CRAYte! Pootery" is retired** — do not reintroduce it in any title, heading, meta tag, store listing, or doc on future builds or rebuilds.

- **Folder / URL:** the game lives at **`pootery/`** (`madderverse.org/pootery/`). Renamed from `lets-crayte-pootery/` on 2026-05-29; redirect shims left at the old `/lets-crayte-pootery/` path forward to `/pootery/` (preserving the `?pot=` / `?pack=` / `?battle=` query string) so already-shared pot links and the published app's baked-in URLs keep resolving. Don't delete those shims while a pre-rename app build is still live on Play.
- **Internal storage keys stay `crayte-*`.** The `localStorage` keys (`crayte-gallery`, `crayte-owned-packs` = PAID pack entitlements, `crayte-achievements`, `crayte-auth-session`, …), the `window.CRAYte` global, and the `[CRAYte]` log prefixes are invisible plumbing and are **deliberately NOT renamed** — renaming them would wipe every existing player's saved pots and purchased packs. The rebrand is visible-name-only.
- **App display name** is already `Pootery` in `pootery-app/capacitor.config.json` and `android/app/src/main/res/values/strings.xml`. In Play Console: **App name = `Pootery`**, **listing title = `Pootery: Throw, Glaze, Fire`** (see `pootery/PLAY_STORE_LISTING.md`).

## Pootery: Throw, Glaze, Fire — Android App Rollout

**Status:** Ready to build and sign for Google Play upload.

**What's done:**
- Web app fully functional (shape, decorate, kiln, gallery, battles, profiles, auth, achievements)
- Capacitor project set up at `pootery-app/` with Android platform added
- Web assets copied to `pootery-app/www/`
- Release keystore generated at `pootery-app/android/app/pootery-release.keystore`

**Keystore details (safe to keep here):**
- **File location:** `pootery-app/android/app/pootery-release.keystore`
- **Store password:** `pootery_2026_release`
- **Key alias:** `pootery`
- **Key password:** `pootery_2026_release` (PKCS12 stores use same password for both)
- **Validity:** 10,000 days
- **DN:** CN=Pootery, OU=Mad Sundar LLC, O=Mad Sundar LLC, L=Minneapolis, ST=Minnesota, C=US

**App config:**
- **Package ID:** `org.madderverse.pootery`
- **App Name:** Pootery  (canonical full name: Pootery: Throw, Glaze, Fire)
- **Min SDK:** (Capacitor default, check `android/app/build.gradle`)

**Next steps:**
1. Run `cd pootery-app/android && ./gradlew bundleRelease` with signing flags to generate signed AAB
2. Verify the AAB in `pootery-app/android/app/build/outputs/bundle/release/`
3. Upload AAB to Google Play Console
4. Google Play will extract public cert from the signature for future uploads

**Notes:**
- The old `lets-crayte-pootery-app` folder was zipped as `lets-crayte-pootery.zip` on Desktop; recovered and used to populate `pootery-app/www/`
- User had previous failed attempt with Google Play (deleted from Console); this is a fresh upload
- No waiting on Google cert—we generate our own, sign with it, and upload to Console

---

## Pootery: Throw, Glaze, Fire — RevenueCat billing setup (paid packs)

**Status:** Code skeleton wired; awaiting external setup before paid packs are actually purchasable.

The Capacitor plugin `@revenuecat/purchases-capacitor` is installed and the billing module (`initBilling` / `purchasePack` / `restorePurchases` / `syncEntitlements` / `rcSyncUser`) is integrated in `game.js`. While the placeholder API key is in place, paid-pack taps show a friendly "available when the app launches on Google Play" alert — billing is INERT, not broken.

**To activate billing before the production push:**

### 1. RevenueCat dashboard

1. Create a free RevenueCat account at https://app.revenuecat.com
2. Create a new project → add an Android app with package id `org.madderverse.pootery`
3. Under **API Keys** → copy the **Android (Public) SDK key** (starts with `goog_…`)
4. Paste it into `game.js`, replacing the `RC_PUBLIC_API_KEY` constant value

### 2. Google Play Console product catalog

Under your Pootery app → **Monetize** → **In-app products**, create **five products** with these **exact** product IDs (must match `PACK_ENTITLEMENTS` in `game.js`):

| Product ID | Price | Label | Type |
|------------|-------|-------|------|
| `pack_dinosaur`  | $0.99 | DINOSAUR | builder (dino) |
| `pack_music`     | $0.99 | MUSIC | crafter |
| `pack_chickens`  | $1.99 | CHICKENS | mega |
| `pack_aliens`    | $1.99 | ALIENS | mega |
| `pack_moons`     | $1.99 | MOONS | mega |

> ⚠️ **Do NOT create `pack_breakfast` or `pack_mega`.** As of the pack rework, BREAKFAST moved to the **points** unlock (earned, not bought) and the old generic MEGA pack was **deleted**. Only the five products above are real paid packs.

**Pack tiers / unlock model (current):**
- **FREE (auto-unlocked):** BASIC, SPACE, CANDY (crafters) + GAMER (the one free builder).
- **POINTS (coming soon — earned, not paid; no Play product):** PLUSH, MODDED, BREAKFAST.
- **PAID $0.99:** DINOSAUR (builder), MUSIC (crafter).
- **PAID $1.99 "mega" tier** (10 glazes / 8+ stamps / 3 textures, pink glow): CHICKENS, ALIENS, MOONS.

Each must be **Active** and have a price set.

### 3. RevenueCat product + entitlement linkage

Back in the RC dashboard:

1. **Products** → add the 5 products, identifiers matching the Play Console IDs above
2. **Entitlements** → create 5 entitlements with the same identifiers (`pack_dinosaur`, `pack_music`, `pack_chickens`, `pack_aliens`, `pack_moons`)
3. For each entitlement, attach its matching product (1:1)
4. **Offerings** → create a "current" offering containing all 5 products

### 4. Cap-sync + build

```
cd pootery-app
npx cap sync android      # registers RC's native code into android/
```

Then rebuild the AAB. The `@revenuecat/purchases-capacitor` plugin requires the cap-sync step to wire its native Android module; without it, `window.Capacitor.Plugins.Purchases` won't be present and `initBilling` will silently no-op.

### 5. Test purchases (before production)

Add a Google account as a **License tester** in Play Console (`Setup` → `License testing`). Closed-testing track installs from that tester account let you make purchases without being charged.

### How the cross-device flow works

- On app launch, `initBilling()` configures RC with the user's Supabase user ID as `appUserID` (or anonymous if not signed in).
- `syncEntitlements()` queries RC for active entitlements and mirrors them to the local `crayte-owned-packs` cache.
- When the user signs in to Supabase (`onAuthChange` listener), `rcSyncUser()` tells RC the new user ID via `Purchases.logIn` → RC returns the entitlements tied to that account → packs the user bought on a *different* device now appear here.
- When the user buys a pack, RC validates the purchase server-side with Google Play (no app-side validation needed).
- **Restore Purchases** button in the Account screen calls `Purchases.restorePurchases()` as a manual fallback (Play Store reviewers and users both expect this button).

### What this delivers

- ✅ Pack purchases via Google Play Billing (no Stripe — Google requires Billing for digital goods)
- ✅ Each purchase tied to the user's Google Play account
- ✅ On app launch: query RC entitlements + sync to local cache
- ✅ Cross-device restore via Supabase user id ↔ RC app user id link
- ✅ Manual "Restore Purchases" button in Account screen
- ✅ Server-side purchase validation (RC handles this against Google Play Developer API)

### What this does NOT yet deliver

- ❌ Gallery pots syncing across devices (still localStorage-only; v1.1 work)
- ❌ Refund-handling UI flow if RC reports a previously-owned entitlement is no longer active (current behavior: the cache keeps it; harmless drift until next purchase)

---

## Slip Studio — Android **paid app** build & publish

**Model:** a **paid app** (one-time price). Google Play handles the purchase at the store, so there is **NO in-app billing code, NO RevenueCat, NO product catalog** — the opposite of Pootery. Don't add billing.

**Capacitor wrap:** `slip-studio-app/` — a SIBLING of the web app `slip-studio/`, **outside git** (untracked, like `pootery-app/`). Minimal deps: `@capacitor/core` + `@capacitor/android` only.
- **Package id:** `org.madderverse.slipstudio` · **App name:** "Slip Studio"
- **Web source of truth** is the git repo's `slip-studio/`. Edits there do NOT reach the AAB until synced (see rebuild steps).
- **Three.js is vendored locally** at `slip-studio/vendor/` (import map points there, NOT esm.sh) so the app runs offline. Re-vendor if bumping the Three version.
- **Immersive fullscreen:** `MainActivity.java` hides the status + navigation bars (the bottom button row) via `WindowInsetsControllerCompat`, swipe-to-reveal. Keep this — it's a product requirement.

**Release keystore** (safe to keep here): `slip-studio-app/android/app/slip-studio-release.keystore` · store/key password `slipstudio_2026_release` · alias `slipstudio` · PKCS12, 10000 days · DN `CN=Slip Studio, OU=Mad Sundar LLC, O=Mad Sundar LLC, L=Minneapolis, ST=Minnesota, C=US`.

**Rebuild the signed AAB after a web change:**
1. Edit web source in `slip-studio/`, commit, push.
2. `cp -r slip-studio/index.html slip-studio/main.js slip-studio/style.css slip-studio/vendor slip-studio-app/www/`
3. From `slip-studio-app/`: `npx cap copy android`
4. **Bump `versionCode` (+ `versionName`)** in `slip-studio-app/android/app/build.gradle` before every Play upload.
5. From `slip-studio-app/android/`, build with **JDK 21** (machine default is 17 → `invalid source release: 21` otherwise):
   ```
   JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" ./gradlew bundleRelease \
     -PSLIP_STORE_FILE=slip-studio-release.keystore -PSLIP_STORE_PASSWORD=slipstudio_2026_release \
     -PSLIP_KEY_ALIAS=slipstudio -PSLIP_KEY_PASSWORD=slipstudio_2026_release --console=plain
   ```
6. Output: `slip-studio-app/android/app/build/outputs/bundle/release/app-release.aab`. (ANDROID_HOME must point at the SDK — already set on this machine.)

**TODO before publishing (user-side / final art):**
- **App icon + splash** are still the default Capacitor icon. Drop a 1024×1024 `slip-studio-app/assets/icon.png` (+ `splash.png`), then `npx @capacitor/assets generate --android` and rebuild.
- **Google Play Console (user only):** create the app → upload the AAB → set it as a **Paid app + price** → store listing (title, short/full description, screenshots, feature graphic) → content rating questionnaire → privacy policy URL → select countries → submit for review. First Play upload extracts the signing cert from this keystore (or enroll in Play App Signing).
