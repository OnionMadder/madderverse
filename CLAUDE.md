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

- **Flat shape** (most games — `cookie-cache/`, `georges-jump/`, `friend-picker/`, `bala-draws/`, `all-monkeys/`): `index.html` + `game.js` + `style.css` at the game root, with `assets/` (typically `audio/`, `img/`, `sprites/`) alongside.
- **Split shape** (`gazonionaire/` only): `index.html` at root, with `css/style.css`, and `js/` split into `data.js` (constants/economy tables), `game.js` (pure state + rules, no DOM), and `ui.js` (DOM/event layer). Load order in HTML is `data.js` → `game.js` → `ui.js`; preserve that ordering when editing.

Other top-level entries:
- `index.html` — hub page; the `<nav class="game-grid">` is the **source of truth for which games are advertised** (see "Advertised vs. unlisted games" below). Add/remove a `.game-card` here when shipping/retiring a game. The hub also carries JSON-LD (`WebSite`/`Organization`/`Person`/`CollectionPage`) and visible About/Promise sections used for SEO + AI discoverability — keep the JSON-LD `ItemList` in sync with the grid when games are added/removed.
- `404.html` — GitHub Pages 404; uses the shared `assets/css/style.css`.
- `assets/css/style.css` — **only** styles `index.html` and `404.html` (selectors are scoped under `body.kids-hub` and `.not-found-container`). It is not imported by any game; do not move game-specific styles here.
- `assets/favi/` + `site.webmanifest` — site-wide favicon set referenced by absolute `https://madderverse.org/...` URLs from every page.
- `sitemap.xml`, `robots.txt`, `llms.txt` — site-wide discovery files at the repo root. `robots.txt` intentionally **allows** AI crawlers (GPTBot, ClaudeBot, Google-Extended, anthropic-ai, PerplexityBot, etc.) — we *want* them indexing. `sitemap.xml` lists only the advertised games + key pages. `llms.txt` is a plain-English studio/catalog summary for LLMs (per llmstxt.org). Keep all three in sync with the advertised game set.

### Advertised vs. unlisted games

The hub grid lists only finished, shipping games. **Every game directory that is NOT on the hub grid is a work-in-progress** — present on disk and sometimes reachable by direct URL, but deliberately not advertised, and intentionally excluded from `sitemap.xml`, `llms.txt`, and the hub's JSON-LD `ItemList`. Do not add a WIP game to the hub / sitemap / schema until the user says it's ready.

- **Advertised (on the hub, in grid order, as of 2026-07-24):** Slip Studio, All Munkis, Pootery, Groodle, Tub's Cookie Cache, George's Jump, Friend Picker, **Florigami**. *(Florigami was added to the grid / sitemap / llms / JSON-LD when it went live — see its section at the very bottom. Slip Studio was **relisted 2026-07-02** after earning Google Play's Teacher Approved badge — it had been unlisted 2026-07-01 when it migrated to nodehole; it's now effectively dual-listed like George's Jump. George's Jump is also published on nodehole — deliberately dual-listed, it's an all-audiences game. See "The nodehole sister site" below for games migrated off the hub. Glass Gallery and Tonehouse were unlisted from the hub 2026-07-02 — dirs kept on disk, reachable by direct URL.)*
- **Unlisted / WIP (on disk, NOT advertised):** `munki-madness/`, `bala-draws/`, `eat-worms/`, `giggle-gears/`, `spoiler-alert/`, `smash-studio/`, `sua-sponte/`, `misfile/` (and any future dir not yet on the grid). *(`tiny-canvas/` was **listed on the hub 2026-08-04** — grid card, JSON-LD `ItemList` position 9, `sitemap.xml`, `llms.txt` — and is no longer WIP for web purposes; its store release is still outstanding.)* The last four were committed to `main` on 2026-07-24 as WIP — reachable by direct URL but deliberately off the hub/sitemap/llms/JSON-LD. `giggle-gears/` in particular still carries stale FYMZ branding and is not launch-ready.
- **Migrated to nodehole (unlisted from the hub, but `dir kept on disk`):** `krazy-kritters/` (removed 2026-06-30, dir deleted), `hole-up/` + `gazonionaire/` (2026-07-01, dirs kept, web-only). These are pulled from the grid / JSON-LD / `sitemap.xml` / `llms.txt` but stay reachable by direct URL. See below. *(`slip-studio/` was also migrated here 2026-07-01 but was **relisted on the hub 2026-07-02** after Teacher Approved — it's back in the grid / JSON-LD / sitemap / llms while its nodehole copy also stands, so treat it as dual-listed, not migrated-away.)*

## The nodehole sister site

**nodehole.com is a separate site — an itch.io-style game PORTAL hosted on NearlyFreeSpeech (NFSN), NOT part of this repo and NOT locally checked out.** It's the **older/adult-skewing** brand; madderverse is the **kids** brand. The two-brand split is the point: kid-targeted games live on madderverse, older/edgier games on nodehole, and genuinely all-audiences games can be **dual-listed** on both.

**Portal structure (important).** Each nodehole game has a **platform-generated landing page** at `nodehole.com/games/<shelf>/<game>/` (nodehole banner, category shelves, login, favorites, `cover.jpg`, and nodehole's own favicons at `nodehole.com/assets/favi/`). The **actual game runs at the `…/<game>/play/` subpath**, which the landing links to. Shelves seen so far: `crittercore`, `erotic`, `glitch`, `interactivefiction`, `narrative`, `simulation`.

**Publishing / updating a game on nodehole:**
1. The game payload (`index.html` + js/css/assets) goes to **`games/<shelf>/<game>/play/`** — **never** overwrite the platform-generated landing at the game root.
2. Make the `/play/` copy **self-contained + nodehole-branded**: canonical/`og:url`/`twitter:url` → `…/<game>/play/`; `og:image` → the game's own `cover.jpg`; favicons/manifest → relative local `assets/favi/` (copy a set in if the game lacks one); **GoatCounter beacon → `https://nodehole.goatcounter.com/count`**; strip madderverse chrome (the ⌂ "Back to Madderverse" home button, the slim site footer, any `../assets/css/site-footer.css` link); neutralize kids/Madderverse SEO copy to game-specific/audience-neutral text.
3. There is **no local nodehole checkout** — stage the copy to a Desktop folder mirroring the target (`Desktop/<game>-nodehole/play/…`) and the user uploads it via NFSN. (I have no NFSN access.)
4. Old live `/play/` pages may be stale **`fymz.lol`-branded** dumps; overwriting fixes that.

**Migration ledger (as of 2026-07-01):**
| Game | nodehole path | madderverse | Staged copy |
|---|---|---|---|
| Krazy Kritters | (crittercore) | dir **deleted** | `Desktop/krazy-kritters/` |
| Slip Studio | `crittercore/slip-studio/play/` | unlisted, **dir kept** (app privacy URL); app stays `org.madderverse.slipstudio` (Level-1) | `Desktop/slip-studio-nodehole/play/` |
| George's Jump | `crittercore/georges-jump/play/` | **dual-listed (stays on hub)** | `Desktop/georges-jump-nodehole/play/` |
| Hole-Up | `simulation/hole-up/play/` | unlisted, dir kept | `Desktop/hole-up-nodehole/play/` |
| GazOnionaire | `simulation/gazonionaire/play/` | unlisted, dir kept | `Desktop/gazonionaire-nodehole/play/` |
| Poly Hi | `glitch/poly-hi/play/` | n/a (never on madderverse; source at `Desktop/PolyHi/`) | `Desktop/poly-hi-nodehole/play/` |

All staged copies are **pending user upload to NFSN**. GazOnionaire's in-game story text still references "Madderverse" as its fictional universe name (flavor, left as-is).

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
- **Package id:** `org.madderverse.slipstudio` · **App name** (under-icon launcher): "Slip Studio" · **Play listing title** (what users see in search + on the store page): **"Slip Studio: Shape Clay"** — *with a colon*, changed in the 2026-08-01 vc22 submission (it was "Slip Studio Shape Clay" before). Use the colon form in any outward-facing copy.
- **Web source of truth** is the git repo's `slip-studio/`. Edits there do NOT reach the AAB until synced (see rebuild steps).
- **Three.js is vendored locally** at `slip-studio/vendor/` (import map points there, NOT esm.sh) so the app runs offline. Re-vendor if bumping the Three version.
- **Immersive fullscreen:** `MainActivity.java` hides the status + navigation bars (the bottom button row) via `WindowInsetsControllerCompat`, swipe-to-reveal. Keep this — it's a product requirement.

**Release keystore** (safe to keep here): `slip-studio-app/android/app/slip-studio-release.keystore` · store/key password `slipstudio_2026_release` · alias `slipstudio` · PKCS12, 10000 days · DN `CN=Slip Studio, OU=Mad Sundar LLC, O=Mad Sundar LLC, L=Minneapolis, ST=Minnesota, C=US`. **⚠ The `L=`/`ST=` fields are keystore-DN artefacts, NOT Onion's location** — she isn't in Minnesota. Never use these values as her location anywhere (docs, pitches, screenshots, social copy). Same applies to the Pootery keystore DN above.

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

**Bundle convention (v2.0+):** the AAB ships ONLY `assets/backgrounds/preload/` (3 starter backdrops). The Art/Botanical/Digital/Paper/Motion folders are 28MB combined (mostly motion videos) and are filtered out of the picker in the Capacitor wrap via `visibleBackgrounds()` in `main.js`. When refreshing `www/`, **do not** copy those folders — only `assets/backgrounds/preload/`. Future v2.1+ work: an in-app "Download backdrops" feature will fetch them on demand from madderverse.org and persist via Capacitor Filesystem.

**Done (no longer TODO):**
- **App icon + splash** — Slip Studio rose-striped vase icon is at `slip-studio-app/assets/icon.png` (1080×1080) and was propagated to `android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png` via `npx @capacitor/assets generate --android`. ⚠ **This source is stale (May 27) and no longer matches the Play listing icon** — see the "DO BEFORE THE NEXT BUILD" note in the Android build state section. Replace the source and regenerate at the next rebuild.
- **Listing assets staged** at `slip-studio-app/assets/`: `slip-feature.png` (feature graphic — 1488×720, **needs resize to Play's required 1024×500** before upload), `title.jpg` / `shape.jpg` / `decorate.jpg` / `fired.jpg` / `gallery.jpg` (5 screenshots).
- **Listing icon** — Play wants a separate **512×512 PNG** for the storefront. Downscale `assets/icon.png` before upload.

**TODO before publishing (user-side):**
- **Google Play Console (user only):** upload AAB → set Paid + price → listing copy from `slip-studio/PLAY_STORE_LISTING.md` (full description + What's new + ASO notes already drafted there) → privacy URL `https://madderverse.org/slip-studio/privacy/` → screenshots (phone min 2, optional 7"+10" tablet) + feature graphic (**1024×500, resize first if reusing the old 1488×720 source**) + 512² icon → **promo video URL** (paste an unlisted landscape-16:9 YouTube link into Main store listing → Promo video field — shot list + 30s script in `slip-studio/PLAY_STORE_LISTING.md`) → content rating → submit. First Play upload extracts the signing cert from this keystore (or enroll in Play App Signing).

**v2 craft-deepening pass (2026-06-10):** added a starter-shape picker (vase/bowl/cup/bottle) on the landing, a four-stage clay arc (Wet → **Leather-hard** → Bone-dry → Fired) with a foot-zone-constrained Trim tool at leather-hard, a photo-export button on the fired stage (1024px PNG of the pot composited on the chosen backdrop, via Web Share + anchor-download fallback), and a "Make a lid" flow that links a fired pot to a partner via `setId` (saved pots with shared id render as twin thumbnails in the gallery). Two tools were prototyped and pulled before commit: **wet-clay texture stamps** (coil/weave/dots/lines/leaves — relief too faint against wet bump scale; the user couldn't tell anything was happening) and **leather-hard carving** (sgraffito patterns — even with a dark-slip overlay alongside the bump groove, the marks read as drawn stamps rather than carved grooves; the Decorate stage already covers "draw on the pot"). Saved entries still serialize the bump canvas (`entry.bump`) so reloads are bit-for-bit, even though the canvas is now procedural-only. **No free trial / no Google Play trial mechanism is wired up** — the web build at madderverse.org/slip-studio/ is positioned as the trial in the store listing copy.
- **⚠ SUPERSEDED — build state is now much further along; see the "Motif / Pattern / Tutorial era" note at the bottom for current versionCode/versionName and the updated www-sync steps.** (Historical: vc2 = v1.1 was live; vc3 was discarded for size; vc4 = corrected v2.0.) Always bump `versionCode` (+ `versionName`) in `slip-studio-app/android/app/build.gradle` for every upload.

**v2.1 perceived-value pass (2026-06-11):** five things to push the app from "neat 3D toy" toward "this is worth $2.99":
- **Sound design** — Lazy-loaded SFX manager (`SFX_SOURCES` dict + `playSfx`/`stopSfx`/`maybeSquelch`). Five triggers: looping wheel hum (volume scales with `state.spin`), throttled clay squelch on sculpt + trim drags, water drip on Re-wet → wet, glaze pour on selecting a glaze swatch, kiln crackle on Fire. The Music toggle was renamed to "Sound" and now controls both music + SFX. Files load from `slip-studio/assets/sfx/*.mp3` — missing files fail silently. User to drop in actual clips (rawpixel / Pixabay / Epidemic Sound).
- **The firing moment** — `state.firing` flag + CSS `.kiln-glow.is-firing` animation. Bone-dry → fired now plays a ~1.2 s sequence: warm-orange radial-gradient scrim fades up to ~92 % opacity then out, camera leans 1.0 → 1.13 → 1.0 (bell-shaped smoothstep in `tick`), auto-spin held at zero via `state.firing` in the busy flag. Kiln SFX fires alongside.
- **Gallery as portfolio** — Default view is "shelf" (240×140 cards with thumbnail on the left + title / glaze name / save date on the right). Toggle in the gallery bar flips to the old compact grid. Saved entries gained a `title` field (nullable; user taps the title to rename via `prompt()`). View pref persists in localStorage as `slip-gallery-view`.
- **Photo styling presets** — The Photo button now opens a modal (`#photoModal`) with a live preview canvas, 3 framing styles (Studio shelf / Sunlit window / Museum plinth) and a 1:1 / 9:16 aspect toggle. The GL pot render is captured ONCE on modal open; toggling style or aspect just re-composites the 2D layer over the cached render. Save Photo uses the same Web Share + anchor-download fallback path as before.
- **Content variety** — 6 new glazes: gold / copper / platinum (3 metallics — added a `metalness` field to CLAY_STATES + GLAZE_FIRED + a tween line in `tickMaterial`), iron-red, mint, pearl. The backdrop picker grew categories (Painted / Botanical / Earthy / Abstract / Architectural) so adding a backdrop = one entry in `BACKGROUNDS` with `category`. Music switched from a single file to `MUSIC_TRACKS` array; `initMusic` picks one at random per session, falls back to track 0 on load error.

### Teacher Approved + big feature push (2026-07-02 → 2026-07-03)

**Teacher Approved / $0.99 / relisted.** The paid Android release earned Google Play's **Teacher Approved** badge; store price dropped to **$0.99** to prime reviews. Slip Studio was **relisted on the madderverse hub** (top grid card, JSON-LD `ItemList` position 1, `sitemap.xml`, `llms.txt`, About paragraph) — it's now **dual-listed** (hub + nodehole/crittercore), NOT migrated-away. The badge lives on the store surface only — do NOT add a "Teacher Approved" banner inside the app.

**Cache-busting.** `index.html` loads `main.js?v=N` + `style.css?v=N`; **bump `N` on every web change** (currently **v214** — see the "Gallery + decorate polish run" note at the very bottom for everything since v140). The recurring "my change reverted / does nothing" reports were almost always the browser serving a stale cached `index.html` — always tell the user to hard-refresh (Ctrl+Shift+R) and confirm the source shows the new `?v=`. When iterating in the preview, the page URL's `&t=` does NOT bust the module — you must bump `?v=N` (or the cached `main.js` serves and `window.__slip` looks stale/missing).

**⚠ The init-TDZ trap is FIXED (v189) — `main.js` boots from the BOTTOM.** `init()` used to be invoked at ~line 1532, mid-file, so every top-level `const`/`let` declared *below* that line was in its temporal dead zone for the whole startup path. Touching one threw, aborted `init()` half-built, and — because a module-evaluation error surfaces poorly — read as some unrelated feature quietly not working (`window.__slip` never appearing and SFX being dead were the usual symptoms, not the cause). It bit three times in one sitting. The call is now the **last statement in the file**, wrapped in a `try/catch` that `console.error`s with a `[Slip Studio]` prefix before rethrowing, so a startup failure is loud. **Do not move that call back up** — it re-arms the trap for everything declared after it. With it at the bottom you can call any helper from `init()` regardless of where its constants sit; the old "declare it up top to dodge the init TDZ" workarounds are obsolete.

**What that fix does NOT cover: top-level initializers that read other top-level constants.** The `state` object literal is evaluated in place and reads the `*_PACKS` tables + `GALLERY_BACKDROPS` as it's built, so those must still be **defined above `state`** — that's ordinary declaration order, nothing to do with `init()`. Same for anything else computed at module scope rather than inside a function.

**Clay arc is THREE stages** — `PHASES = ["wet","leather","fired"]` (wet = shape, leather = **Decorate**, fired = done). The v2 notes above say "four-stage"; that's stale — trust the code.

**v2.2 polish pass.** First-run control-hint overlay (idle-triggered ~2.6 s after Begin, gated by `slip-seen-first-run`); descriptive photo filename `slip-studio-<shape>-<glaze>-<date>.png`; save micro-celebration (white flashbulb `#saveFlash` + Save icon → `#icon-check` + `navigator.vibrate`) — this also fixed a latent bug where `flashSaved` set `button.textContent` and would wipe the icon-only Save button's SVG; light haptics on control taps; photo "Preview" pill; reduced-motion gating; first-visit "Pick a starter shape" caption; wheel-hum ramp-in from silence on Begin; auto pot titles on save ("Vase in Cobalt"); confirm-modal on gallery delete; shelf-thumbnail glaze-tinted hairline; **4:5** photo aspect (`photoHeightFor`).

**Handles — full rework.** Geometry: much thicker (`HANDLE_THICKNESSES` ≈ doubled), rounder (custom `buildHandleGeometry` sweeps a **varying-radius flared tube** — swells ~1.9× at the roots via `HANDLE_ROOT_FLARE` so the ear blends into the wall like pulled clay; Three's `TubeGeometry` is constant-radius so it's hand-built), with a **minimum standoff** (`HANDLE_GAP`, `buildHandleCurve` clamps bulge so the ear never grazes the wall). **Reshape**: grab an ear and drag — grabbed zone decides what moves: **top** third → shoulder end (`topOffset`), **bottom** → belly end (`bottomOffset`), **middle** → both = placement; horizontal drag = bulge/width. Offsets persist as `handleTop`/`handleBottom`/`handleBulge` in saved entries (old `handleHeight` maps to both). **Handles moved from the wet stage to the DECORATE (leather) stage** (2026-07-03) — attach + reshape a handle on the *finalized* shape, like a finishing step. Toolbar `handleBtn` + `handleStylePicker` show at `leather`; wet is pure sculpting again. At leather: grabbing an ear reshapes it, grabbing the pot body dips/paints (different raycast targets, no conflict); `handleDrag` in the busy flag holds the wheel still during a reshape.

**Glaze DIP / DRIP system** (replaced the earlier "rainbow glaze"). A **2-D glaze layer** (`GLAZE_W`×`GLAZE_H` canvas → `state.dipCanvas`/`dipCtx`/`dipTex`, uniform `uDipMap`) the clay shader mixes over the diffuse by its alpha, UNDER decoration, taking the fired gloss. Shader cache key `clay-gradient-sgraffito-dip-v5`.
- **Model:** glaze coats from the RIM **down** to a line; your finger sets the glaze's lower edge. Below it is bare clay; **drips hang DOWN** from the edge as solid, opaque, rounded tendrils each ending in a droplet bulb (randomized u/length/bulb via `makeDrips`; `Off/Few/Lots`).
- **State:** `state.dips[]` (ordered, non-destructive) + `dipPreview` (live drag) → `renderDips()` replays them (`paintDip`/`paintDrips`/`paintPresetDip`). *(`dipPreview`'s `let` used to have to sit before `init()` because `currentLook()` reads it — obsolete since v189 boots from the bottom of the file; see the init-TDZ note above.)*
- **Interaction:** Glaze panel **Dip** toggle (`state.dipMode`) auto-arms the first pack glaze (`state.dipColor`) so a drag works immediately; drag the pot body at leather to pour, tap a glaze to recolour. Presets = `DIP_SETS` (Rainbow/Sunset/Ocean/Ember) one-tap full-height gradients; **Rainbow moved here from a glaze swatch** — old `entry.glaze==='rainbow'` saves auto-convert to a rainbow dip on load (`GLAZES.rainbow` kept only for that).
- **Gloss on a dipped pot:** `state.glaze` is null when dipping, so `currentLook` returns new `DIP_FIRED`/`DIP_RAW` (glossy fired / chalky raw over a bare-clay base) whenever `state.dips.length > 0`; `renderDips` refreshes `state.clayTarget` so the finish tracks dips live.
- **Handles get dipped too:** the handle material has its own `onBeforeCompile` sampling `uDipMap` by height (`v = position.y / TOP`; handle geometry local-y is profile-space, same as the pot's dip UV.y); cache key `handle-dip-v1`.
- **⚠ Gotcha that cost hours:** `.deco-stack` is `pointer-events:none` (so the pot behind the tray stays draggable); EVERY interactive control inside must set `pointer-events:auto` or real taps fall THROUGH to the `#scene` canvas. The dip controls didn't, so "the Dip button does nothing" — programmatic `.click()` ignores `pointer-events`, which is why automated tests never caught it. When adding controls to the deco tray, add `pointer-events:auto`.

**Band overlay patterns.** `OVERLAY_PATTERNS` (Decorate → Overlay) gained **Triangles / Diamonds / Chevron / Crosses** — horizontal geometric bands wrapping the pot, seamless around the u-seam, single-colour motif over the glaze.

**Decorate stage stands still** (2026-07-03). `targetSpin = 0` at `leather` so the pot is static to dip / paint / handle against; **wet** throws on a live spinning wheel, **fired** spins to show off the piece. Rotate a static pot by dragging the wheel/empty space or two-finger.

**itch.io build.** A self-contained standalone copy is staged at **`Desktop/slip-studio-itch/`** and zipped flat to **`Desktop/slip-studio.zip`** (40MB, `index.html` at zip root — itch's HTML5 uploader needs it there, not nested in a wrapper folder). Madderverse chrome stripped — home button, footer's Madderverse link, canonical/og:url metas; **all** backdrops bundled. The "Get the Android app" link is deliberately KEPT — cross-promo to Play is fine on itch, and CLAUDE.md's old strip list never included it. **Resynced to web v216 on 2026-07-30**, boot-verified headless (init clean, no failed requests, all 6 backdrop categories load). Stripping is handled by `scratchpad/strip_for_itch.py` — it asserts each match count so an upstream `index.html` rewrite fails loudly instead of silently drifting. **Historical:** Resynced to web v170 on 2026-07-08. Resync = copy `main.js`/`style.css`/`vendor`/`assets` (ALL of `assets`, incl. the big backdrop folders) from this checkout, then regenerate `index.html` from the web `index.html` stripping exactly: the 3 URL metas (`canonical`/`og:url`/`twitter:url`), the `<a class="home">` back-to-Madderverse button, and the footer's `· Madderverse` link (`.sep` span + the `<a href="../">Madderverse</a>`). It drifts behind the live web build; **only resync it when Onion asks** (same deferral as the Play AAB — she ships those in batches, don't nudge per-change).

**Operational hazards seen this session:** GitHub **Pages deploys are flaky** — the deploy step intermittently returns "Deployment failed, try again later" (a GitHub-side incident, distinct from the 401 blip); retry via `gh workflow run deploy-pages.yml` until the live `?v=` matches and re-check, don't trust one green run. **Concurrent-session churn** — a second Claude session on this same OneDrive checkout (Cookie Cache / George's Jump) repeatedly diverged the branch mid-work; always `git fetch` before commit, and prefer one session per checkout (or worktrees).

### Motif / Pattern / Tutorial era + mobile polish (2026-07-04 → 07-05, v99 → v119)

Big feature run. **Cache-bust is now v119.** All of this is on `main` and live at madderverse.org/slip-studio/.

**Decoration decisions locked with Onion (don't relitigate):** motifs default to a **single-colour silhouette** (tint-able) with a per-user **Full colour** toggle; **frames are placed like full-colour stickers**; **shima-shima are allover patterns**; **gems were tried as a dedicated tool and REMOVED** (looked poor — assets deleted). Uploaded images are reduced to a silhouette **entirely on-device, never uploaded** (preserves the "collects nothing / offline" Data Safety posture — matters on a kids' app). Frames/shima-shima and the newest packs are **test integrations Onion is still evaluating.**

**Motif tool** (Decorate → `Motif`). Places a picture on the pot: drag-to-place + a size slider (`motifSizePx` divides by `state.zoom` so it tracks zoom like brush/stamp), non-destructive preview (snapshot `motifBase` → `renderMotifPreview` → `commitMotifPlace`), bakes into `state.decoCanvas` so it wraps + saves + fires. **Silhouette ↔ Full colour** toggle (`motifFullColor`, `#motifColorToggle`): silhouette = a tinted alpha mask (`buildMotifMask` — alpha where present, else a luminance cut) drawn in `state.decoColor`; full colour keeps the image's own colours (`motifImage`, the paint-colour row hides). Grouped into **packs** (`MOTIF_PACKS` + `#motifPackTabs` + `setMotifPack`): Sumi-e Animals, Sumi-e Plants, Dogs, Dutch Berries, Roman, Egyptian, Frames. A `＋` uploads your own (`#motifUpload`).

**Pattern tool** (Decorate → `Pattern`). One-tap **full-colour allover tiled fill** of the deco canvas (`applyPattern` → `createPattern('repeat')`; square **512×512** tiles wrap exactly **4×** around the pot, seamless). Grouped into **packs** (`PATTERN_PACKS` + the same `#motifPackTabs` row + `setPatternPack`): **Enamel** / **Overlays** (Egyptian, PNG-alpha so they overlay) / **Shima-shima**.

**Undo** (Decorate row, `#decoUndo`, `undoDeco`). Bounded snapshot history (`decoHistory`, cap 10) of the deco **+ sgraffito** canvases, `pushDecoHistory()` BEFORE each decorate action (paint/stamp/carve/motif/overlay/pattern/clear), disabled when empty, `resetDecoHistory()` on new pot / load / piece swap. The Glaze tab keeps its own separate dip undo. **Gate:** the dip drag now only fires while the Glaze tab is showing (`!panelGlaze.hidden`) — else a still-armed dip hijacked paint/motif drags in the Decorate tab.

**Tutorial = per-stage guiding-hand coach marks** (replaced the static `#firstRunHint` legend). `#coach` overlay draws a minimal SVG motion line + the **hand image** (`assets/img/tutorial/hand.png`) animating the gesture, once per stage on first arrival (wet=shape in/out+up/down, leather=the dip, fired=caption). Gated by `slip-coach-<stage>` localStorage flags, fades on the first real gesture; a **"How to play"** landing button (`replayCoaching`) replays it. Fns: `COACH_CAPTIONS`, `scheduleCoach`/`showCoachFor`/`dismissCoach`, hooked at Begin (`dismissLanding`), `advanceStage`, `endFiringMoment`, `onPointerDown`. The caption sits **above** the hand (`.coach-cap { top:19% }`) — it used to be `bottom:15%` and got hidden behind the open deco tray (a bad-rating bug).

**Continuous set gradient.** A gradient dip on a pot **+ lid set** now reads as ONE gradient running unbroken from the top of the lid to the pot's foot (lid = top slice / the gradient's beginning, pot = the rest, seamless at the rim). Done with a shader **vertical remap** of the dip sample: uniforms `uDipVScale`/`uDipVOffset`; `updateDipRemap()` computes each piece's slice from the two pieces' heights (`potFrac`), driven every frame in `tick` while a set exists; identity (1,0) for a lone piece so single pots are unchanged. Shader keys bumped to `clay-gradient-sgraffito-dip-v6` / `-dip-v2-partner`.

**Lid-dip render fix.** The **partner mesh** (the non-active piece shown in the fired assembly) was built before dips existed, so a dipped lid rendered as bare matte clay. Gave it its own dip canvas/texture + `uDipMap` + the `DIP_FIRED` look; `syncPartnerMesh` replays `saved.dips`; `lookForPiece` considers dips. Also: the lid rendered the **wrong colour in gallery cards / photos** because the capture snapped only `tickMaterial` (active piece) — `captureAssemblyThumb` + `captureScenePot` now also call `tickPartnerMaterial(10)` + `updateDipRemap()`.

**Drips reworked** (`makeDrips`/`paintDrips`): shorter + less intense (short-biased length capped ~62% of the bare zone), more random (per-drip sideways drift, meander, variable/optional beads, occasional mid-run belly), and blobbier — each run is a column of overlapping circles necking to a thin tip with baked edge-jitter, ending in a merged teardrop bead. All variation baked into `makeDrips` so `renderDips` replays identically.

**More colour** (v102): 3rd glaze pack **"Garden"** (8 glazes, all dippable); `DIP_SETS` now 8 presets (Rainbow/Sunset/Ocean/Ember/Meadow/Orchid/Terra/Storm); `DECO_COLORS` doubled to 16.

**Mobile / gallery polish (v119):** **zoom OUT** now works (`ZOOM_MIN` 1→**0.6**, camera dollies back — needed for handles/tall pots on mobile); bigger touch targets (`.tool-btn-icon` 38→**46px**, corner buttons home/title/gallery 38→**44px**); bigger gallery cards (compact `minmax` 96→**140**, shelf card 140→**180px**).

**Asset layout (Onion reorganized 2026-07-05).** Motif/pattern art lives under top-level `slip-studio/assets/`, NOT `assets/img/motifs/` anymore: `assets/motifs/<pack>/` (japan-animals, japan-vegetables, netherlands-berries, roman-costumes, egyptian-heiroglyphs [sic], austrian-dogs), `assets/patterns/{enamel,overlays,shima-shima}/`, `assets/frames/`, and the tutorial hand at `assets/img/tutorial/hand.png`. `motifSrc(id)` = `"assets/" + id` and every pack/pattern id carries its category prefix. All motif/pattern/frame art is **size-optimized** (256-colour FASTOCTREE PNG quantize + JPEG re-encode: ~14MB → ~3.6MB, no visible loss — verified full-size). The old `assets/img/motifs/` SVGs (Basics/Aegean placeholder packs) were deleted in the move.

**`indian-gods` motif pack** is staged at `Desktop/nodehole motifs/` for the **nodehole (adult) copy ONLY** — deity/sacred imagery, deliberately NOT wired into the kids hub (the two versions can carry different motif content).

**Android build state.** ⚠ **SUPERSEDED — see "Android build state (current)" in the "Big feature + value run" note below: Play is now vc13/2.4.0/v136 (uploaded, in review).** Last **AAB** on the Play track is **vc7 (versionName 2.2.1, web v100)** — outdated now. For screenshot testing Onion sideloads a **signed release APK** built with `./gradlew assembleRelease` (NOT `bundleRelease` — an AAB isn't directly installable) using the same signing `-P` flags; latest is **vc8/2.3.0** and a staged **vc9/2.3.1** at `slip-studio-app/android/app/build/outputs/apk/release/app-release.apk` (copied to `Desktop/`). **www sync now ALSO needs the new asset folders**: copy `slip-studio/assets/{motifs,patterns,frames,img}` into `slip-studio-app/www/assets/` (plus the usual index.html/main.js/style.css/vendor and preload-only backgrounds). **As of 2026-07-05 Onion is bug-hunting on the sideload and asked to HOLD the APK rebuild** until she's found them all — batch every fix into one rebuild. When cleared: refresh www, bump versionCode/versionName, `npx cap copy android`, then `assembleRelease` (sideload) or `bundleRelease` (Play).

**Deploy note (2026-07-05):** the flaky Pages "Deployment failed, try again later" incident was exceptionally persistent all day — a single commit often took several `gh workflow run deploy-pages.yml` **fresh dispatches** (re-running the failed job also failed; a NEW dispatch is what eventually lands). Always verify the live `?v=` before declaring a deploy done.

### Big feature + value run (2026-07-05, v120 → v140)

A large same-day run. **Cache-bust is now v140.**

**⚠ Ship / git state (READ THIS before touching Slip Studio — updated 2026-07-27):**
- **`main` = web v238** as of 2026-08-04 (`slip-studio/index.html` reads `?v=238`; everything from v225 on is in the Replayability era section below). *(This bullet previously read v185:)* The **sculpting overhaul (2026-07-25, v171→v180)**, **Display mode (v181→v182)**, **glaze recipe journal (v183)**, **named gallery collections/shelves (v184)** and the **teapot shape + pouring spout (v185)** all landed. Everything through v170 (dated notes below) is also live. Confirm the deployed `?v=` with `curl` before assuming a given version reached madderverse.org.
- **Display mode (v181–v182):** an immersive full-screen showcase (`state.displayMode`, `enterDisplayMode`/`exitDisplayMode`, `#displayLayer` overlay). Hides all chrome (`body.display-mode`), slow-rotates the pot (`DISPLAY_SPIN`) on its backdrop with music (wheel hum silenced), soft vignette; drag turns, tap/✕ exits. Entry: the eye `#displayBtn` on the fired stage, and tapping any gallery tile (`loadPot` → `enterDisplayMode`; exit lands on the loaded fired pot). Pure UI/render, no new assets, no persistence.
- **Worktree / git (pruned 2026-07-27):** there is now **exactly ONE working copy** — the in-place OneDrive checkout `C:\Users\kelly\OneDrive\Desktop\website backups\madderverse`, sitting **on `main`**. Work Slip Studio directly here. The four extra copies are **gone**: the three nested `.claude/worktrees/*` worktrees (`slip-studio-exploration-524fee`, cookie-cache `project-improvement-review-e2aba0`, pootery `clay-decorations-integration-ff3eeb` — all merged into `main` before removal) and the outside worktree `C:\Users\kelly\slip-next-worktree` (deleted; its 19 untracked Florigami art files were copied into this checkout first). Local branches were pruned 45 → 15 (every branch already merged into `origin/main`); the retired **`slip-next` and `slip-next-batch` branches are deleted** — don't look for them. Only spin up a worktree again if a second concurrent session actually needs one.
- **OneDrive locking:** mostly benign, but it does bite. During the 2026-07-27 prune a **stale `.git/index.lock` with no git process behind it** blocked `git checkout` — `rm -f .git/index.lock` and retry.
- **Deploy loop (used for v180):** commit → `git fetch origin` → `git rebase origin/main` (Pootery commits sometimes land first; they never touch `slip-studio/`, so it's clean) → `git push origin HEAD:main` → `gh run watch <deploy-run> --exit-status` → confirm live `?v=` via `curl`. Verify Slip changes in the preview via `window.__slip` + JS eval (WebGL screenshots time out; the landing/shape-picker SVG icons DO screenshot).
- **Android/version:** **vc21 / 2.7.0 (web v224) is BUILT, SIGNED & STAGED** (2026-07-31) at `Desktop/slip-studio-v2.7.0-vc21.aab` (19M) — **this is the one to upload.** It covers web v137 → v224 in a single release: everything vc17/vc20 carried (glaze chemistry, wax resist, finishes, the gallery overhaul, the whole sculpting overhaul, Display mode, the glaze recipe journal, collections, the teapot, sculpting + trim undo, the accessibility/touch-target sweep) **plus the 2026-07-31 bug sweep (web v219→v224)**: the pointer-capture leak that killed the wheel, the title-screen wheel hum, zoom surviving New pot, the stranded kiln sequence + unstoppable kiln roar, Display-mode hardening, the set-save drift that lost a partner's `heightScale`/`glazeGradient`, a cancelled share writing a file and claiming it saved, dipped pots exporting as `bare-clay`, and the draft heartbeat's ~30 ms PNG hitch. Verified inside the bundle: `base/assets/public/index.html` reads `?v=224`, the bundled `main.js` is byte-identical to the shipped web v224, only the `preload`+`gallery` backdrop folders are packaged, and `jarsigner` confirms `CN=Slip Studio, OU=Mad Sundar LLC` (SHA256 `53:53:1C:8E…`) — the same upload key. **The superseded builds are GONE** — vc20 was deleted 2026-07-31 once vc21 was verified (vc14–vc17 had already been cleared), so `Desktop/` now holds exactly one Slip Studio AAB and there's no wrong-file risk. (vc14–vc20 were all staged but never shipped.) versionName is **2.7.0**, matching the v2.7.0 release-notes block already drafted in `PLAY_STORE_LISTING.md` — it was briefly built as 2.7.1 and renamed back on 2026-07-31 so the notes and the build agree. Note the versionName has now been used by two *builds* (vc20 and vc21) but only ever uploaded once, if at all — **versionCode 21 is what Play actually dedupes on**, and it's clear of the live vc13. The other AAB on the Desktop, `cookie-cache-v1.1-vc2.aab`, belongs to Cookie Cache and is still awaiting its own upload — don't clear that one. Play track is still **vc13 (web v136)**, so this is the first upload in a long while — release notes for it are the v2.7.0 block in `slip-studio/PLAY_STORE_LISTING.md`. (upload + release notes + store event are Play Console, user-side; copy drafted in `slip-studio/PLAY_STORE_LISTING.md`). **Rebuild recipe:** bump `versionCode`/`versionName` in `slip-studio-app/android/app/build.gradle`, re-sync www (below), `npx cap copy android` from `slip-studio-app/`, then JDK 21 `bundleRelease` with the `-PSLIP_*` signing flags. **www-sync copies these into `slip-studio-app/www/assets/`** (rebuild `www/assets` fresh to avoid drift): `audio`, `sfx`, `favi`, `bands`, `frames`, `img`, `motifs` (incl. the wired+optimized `mythological-creatures`, 712K), `patterns` (incl. `enamels/`, `frescoes/`), `backgrounds/gallery` (now just the single `showcase.jpg` Studio backdrop) **+ preload-only `backgrounds/preload`** — NOT the big Art/Botanical/Digital/Paper/Motion backdrop folders (those download on demand). Plus `index.html`/`main.js`/`style.css`/`vendor`.

**Lid-dip colour fixes (v120–121).** A dipped pot+lid SET recoloured the lid. (1) `savePot` nulled `state.savedPot/savedLid` while the assembly was still on screen, killing the continuous-set dip remap (the lid reverted to identity → sampled the gradient's maroon foot instead of its yellow top slice) — fix: KEEP the partner refs after save (duplicate-save guarded by `state.dirty`). (2) Gallery card + exported photo captured the lid at an identity remap because rendering to a `WebGLRenderTarget` compiles a separate program variant whose dip uniforms reset to defaults AFTER `updateDipRemap` ran — fix: `captureRender()` warm-up-renders, re-applies the material snap + remap, then renders for real (wired into captureThumb / captureAssemblyThumb / captureScenePot).

**Sunlit-veil gallery (v122–123).** Gallery + Photo modal restyled from a cold near-black box to a warm "sunlit studio veil" (shared `--veil` / `--g-card*` :root tokens): warm luminous wash, frosted cream cards, Fraunces titles, colours in an 8-per-row grid. Dipped-but-unglazed pots now name their dip in the gallery ("Ember" / "Glaze dip") instead of "Bare clay".

**Handles (v124–125, +v139).** (a) Handles now take DECORATION, not just glaze — the handle shader also samples `decoMap` in the pot's cylindrical space (v = height, u = atan2 angle) so patterns/enamels/motifs wrap the ear (cache key `handle-deco-dip-v2`). (b) New One/Two chip toggle (`state.handle.count`) — a single ear (mug) hides the mirror mesh; persisted as `handleCount`. (c) **Set-handle fix:** a handle binds to the ACTIVE mesh (the partner mesh has none), so firing a set with the LID active dropped the pot's handle. Fix: at leather→fired, if `isLid && savedPot && handle.on`, `swapActivePiece()` so the POT fires as the active piece with its handle showing; and `loadPot` redirects a handled-set lid entry to its pot member so the handle survives reload.

**Band tool + movable-object decoration (v126–129).** Frescoes (`assets/frescoes/`, transparent Egyptian friezes) are a new **Band** tool: a horizontal band that repeats around the pot (integer tiling, seamless) but NOT vertically, sized + slid up/down. Decoration became a **baked freehand layer (`paintCanvas`) + an ordered `placements[]` list** composited into `decoCanvas` by `composeDeco()` — every motif AND band is now a movable object (drag to place; the **Adjust** toggle selects any placed motif/band and moves it — bands vertical-only, motifs free; the size slider resizes the selection). Undo snapshots baked+placements; save/load carry `paintDeco` + `placements` (legacy `deco` loads as the baked layer); partner sync + thumbnails unchanged (they read the composite). New **Art Nouveau** allover-pattern pack. Band friezes trim their transparent end-padding (`bandContentBounds`) so repeats butt together with no gap.

**Grouped-family decorate tray (v130–135).** The 11-button text row → icon **FAMILIES**: Paint (brush/splatter), Carve, Picture (motif), Pattern (overlay/tile/band) — multi-tool families expand to a variant chip row, single-tool families select directly (`DECO_FAMILIES` / `familyLastTool` — declared up top to dodge an init TDZ, no longer required since v189). Edit ACTIONS (Adjust/Undo/Clear) split to their own bottom icon row. Colours → 8-per-row grid. New line-art icons (paint = paintbrush, carve = pencil — the first-pass droplet/blade read badly on a kids' app). **Stamps then REMOVED entirely (v138)** — Stamp family/button/branch pulled; low-level `drawStamp`/`stampAt`/`STAMP_SHAPES` left as dead code.

**Consistent decorate rotation (v136).** An armed paint/carve tool captured EVERY one-finger press as painting — even off the pot — so rotation only worked with no tool armed. Fix: paint/carve only capture a press ON the pot; a press that misses (wheel, backdrop) falls through to a spin. One finger off-pot rotates (any tool), two fingers rotate anywhere, on-pot uses the tool. Adjust-mode misses spin too.

**Lane-1 value pass (v137).** Pure-code content generosity (see the `project_slip_value_pass` memory): glazes 24→**40** (Jewel: ruby/sapphire/emerald/amethyst/topaz/turquoise/garnet/onyx + Sorbet pastels: bubblegum/lemon/sky/pistachio/lavender/peach/periwinkle/rosewater), dip presets 8→**14**, paint colours 16→**24**, starter shapes 4→**7** (plate/jar/egg), lid styles 3→**4** (pointed). Motivated by 4 refunds at $2.99 — the north star is "outstanding value for the money" via content abundance, never engagement tricks. **Lane 2** (art packs Onion sources → wire + optimize) is queued, starting with the WIP `mythological-creatures` pack.

**⚠ Android build state (CURRENT as of 2026-08-04 — supersedes BOTH "Android build state" paragraphs above, incl. the "vc21 staged / Play is still vc13" claim in the ship-state block).**

**⚠ DO BEFORE THE NEXT BUILD — the launcher icon has drifted from the Play listing.** The storefront icon was refreshed on 2026-07-07 (`slip-studio-app/assets/slip-icon-512.png`, 512², Jul 7) but the *launcher* icon still derives from the older source (`slip-studio-app/assets/icon.png`, 1080², **May 27**), and the shipped mipmaps under `android/app/src/main/res/mipmap-*/` were generated from it on **Jun 3**. So the icon on the store page and the icon under the app on the phone are two different pieces of art. To fix at rebuild time: replace `slip-studio-app/assets/icon.png` with a 1080×1080 export of the current listing art, then re-run `npx @capacitor/assets generate --android` from `slip-studio-app/` to regenerate `ic_launcher{,_round,_foreground}.png` across every density, and confirm the mipmap timestamps moved before building. (The CLAUDE.md line further down saying the icon "is in place… don't regenerate unless replacing the source" refers to that May 27 source — the source IS now being replaced, so regeneration is expected.)

**⚠ NO UPLOAD PENDING — deliberately held.** Onion's call on 2026-08-04: nothing goes to Play until the UI polish and bug hunt are finished. Don't rebuild or nudge about uploading; wait to be asked. (Same posture as the standing "defer itch/Play" rule, but stricter and for a specific reason: vc13 sat broken on the store for a month and cost refunds, so she is not shipping another build sight-unseen.)

**Sideload test APK: `Desktop/slip-studio-v2.8.0-vc24-TEST.apk`** (19.3 MB, built 2026-08-04, **web v238**) — for Onion to bug-hunt on real hardware; NOT for Play. Cut at the current web tip, so it carries all four post-vc23 fixes (lid dead-end, firing titles, bare lid, lid fitting). Verified: bundled `index.html` reads `?v=238`, bundled `main.js` byte-identical to shipped web v238, only `gallery`+`preload` backdrops packaged. **Verify APK signing with `apksigner`, not `jarsigner`** — Gradle signs APKs with **v2 scheme only**, so `jarsigner -verify` reports "jar is unsigned" and that is a false alarm, not a broken build. `$ANDROID_HOME/build-tools/37.0.0/apksigner.bat verify --print-certs` confirms v2, `CN=Slip Studio, OU=Mad Sundar LLC`, SHA-256 `53531c8e…` — the same key. ⚠ **The launcher icon in this APK is still the old May 27 art** (see above); it's a functional test build, and the icon doesn't affect what's being tested. Gradle is now at **versionCode 24**, so the eventual Play build is vc24+ (`slip-studio-app/` is outside git, so that bump isn't in any commit).

**The staged AAB is STALE — do not upload it.** `Desktop/slip-studio-v2.8.0-vc23.aab` (18.8 MB, built 2026-08-04) was cut at **web v232** and web is now at **v238**. It is missing five things, four of them bug fixes found *after* it was built: the lid dead-end (v233), firing-type titles (v234), the bare-lid fix (v235), the lid-fitting fixes (v238), and the launcher-icon refresh above. It was verified sound at the time — bundled `index.html` reads `?v=232`, bundled `main.js` byte-identical to shipped web v232, only `gallery` (showcase.jpg alone) + `preload` backdrop folders packaged, `jarsigner` confirms `CN=Slip Studio, OU=Mad Sundar LLC` SHA-256 `53:53:1C:8E…` — but it has been overtaken. **When the hold lifts: bump to vc24, refresh the icon, re-sync www, rebuild.** Release notes = the v2.8.0 block in `slip-studio/PLAY_STORE_LISTING.md` (498 chars); the feature list in it still describes v232, so re-read it against the code before pasting. The superseded `slip-studio-v2.7.0-vc22.aab` was deleted 2026-08-04 once vc23 was verified (vc22 is safe — Play holds the uploaded copy, and it's reproducible from commit `14eb598`).

Play AAB = **vc22 / 2.7.0 / web v224**, submitted 2026-08-01 21:22 and **Published at 21:53 on full rollout** (Play Console submission 11). That upload also changed the **listing title to "Slip Studio: Shape Clay"** (note the colon — see the App display name section) and added the promo video. vc22 supersedes the never-shipped vc14–vc21. The long vc13 era is over: everything from web v137 → v224 reached users on 2026-08-01, including the pointer-capture leak fix, the landing-screen phone fit, the shipped fonts and the recovered kiln SFX.

**The live listing, read off the store page 2026-08-04** (not inferred from the draft — an earlier version of this note claimed it advertised "ten stamp shapes" and that was wrong; Onion caught it):

- **Title** "Slip Studio: Shape Clay" · **v2.7.0** · updated Aug 1 · **$0.99** · Everyone · Teacher Approved · Simulation · Released Jun 3, 2026 · **10+ downloads** · 7 screenshots · the v2.7.0 "Major update" event is running · Data safety shows no data collected or shared under the Families Policy.
- **The whole description is two paragraphs** — the "calm place to shape clay" opener and "Pull a vase, a bowl, a cup, or a bottle…". Nothing after. That is **~470 characters of Play's 4,000.** No mention of stamps (or of anything else). Onion pasted the opening of the draft and stopped.
- So the problem is **under-selling, not over-promising**: the listing has never carried the ad-free / no-IAP / no-data / offline promise, none of the feature words Play search runs on, and nothing added since v2.2. At 10+ lifetime downloads, **discovery looks like a bigger constraint than retention** — which also reframes the refunds, since "about half" of a dozen-ish sales is ~5–7, a real but small and noisy sample.
- Replacement copy accurate to **v235** is ready in `slip-studio/PLAY_STORE_LISTING.md` (3,962/4,000 — it took three passes to fit, so recount rather than eyeball if you add to it). Needs no build, just a paste. Staged screenshots in `slip-studio-app/assets/` are July 5–8 and predate the sculpting overhaul, the gallery rework, Display mode and everything below.

*(Historical: Play AAB was vc13 / 2.4.0 / web v136, uploaded 2026-07-05, and stayed there for nearly a month while web ran ahead to v224.)* Web is now far ahead at **v238** — see the Replayability era section below for everything since v224, and the ship-state block above for the current www-sync folder list. Recipe unchanged: JDK 21 `bundleRelease` with the `-PSLIP_*` signing flags (`assembleRelease` for sideload APKs). The old `mythological-creatures`-is-unwired gotcha is **RESOLVED** — it's optimized + wired into `MOTIF_PACKS` now. Asset optimizer = Pillow (throwaway scripts written to the session scratchpad, not committed): 640–800px q82 progressive JPEG for opaque tiles; downscale + 256-colour FASTOCTREE PNG **preserving alpha** for transparent art (motifs/patterns/frescoes) — typically 6–15MB → sub-1MB with no visible loss.

### Craft-depth run (2026-07-06, v141 → v149)

Glaze/decorate depth, all live on `main`. Architecture worth knowing:
- **Glaze chemistry (dip reactions).** `paintDipList` resolves the dip layer per horizontal row so stacked dips fire an emergent third colour: `reactGlaze()` (curated `REACTION_PAIRS` keyed by unordered glaze-id pair, else `blendGlaze` = geometric-mean-in-linear + saturation lift). `FIRED_HEX_TO_ID` maps a dip's stored fired hex back to its glaze id.
- **Speckle/crackle + Stoneware glazes**, and a global **finish** dimension: `FINISHES` (Glossy/Matte/Lustre) merged into the fired look via `withFinish()` in `currentLook`/`lookForPiece`; Lustre uses `MeshPhysicalMaterial.iridescence` — the material is created with a tiny base iridescence so the shader compiles the code path (toggling 0→>0 later wouldn't recompile).
- **Slip trailing** (colour + positive bump) and **wax resist** — see the wax architecture note in the next run (it was reworked 07-07).
- **Content generosity:** `DIP_SET_PACKS` (Sky/Sea/Ember/Garden/Earth, 30 gradients), `GLAZE_PACKS` grown, `DECO_COLOR_PACKS` (Basics/Warm/Cool/Bright), the **Mythical** motif pack (`mythological-creatures`, optimized + wired). **Every PACKS table + `GALLERY_BACKDROPS` must be defined ABOVE the `state` object** — `state` is a top-level object literal that reads them *as it is built*, and a const referenced before definition is a TDZ ReferenceError that kills module evaluation (silent: `window.__slip` just never appears). **This one is still live** — the v189 bottom-boot fix cures TDZ on the `init()` path only, not ordering between top-level initializers.
- **UI unification:** one `--pill-active-bg`/`--pill-active-ink` treatment for every text pill (tabs, pack tabs, dip/finish chips, etc.) — a cascade-winning override block at the end of `style.css`. Overlay patterns render circular previews (`drawOverlayPattern(ctx,W,H,hex,cell,id)` shared by `applyOverlay` + `overlayPreviewURL`).
- **Shapes:** `SHAPES` icons are lathe-generated from each shape's `controls` (edit the profile → icon + 3D pot both change). Bowl/egg/planter reshaped to Onion's drawings; plate/tumbler removed; new planter/goblet/budvase/mug (mug auto-attaches a handle). The pot foot renders at ~**0.753** of the framed thumbnail (wheel hidden).

### Gallery + decorate polish run (2026-07-07, v150 → v168)

- **Wax resist reworked to PRESERVE the colour under the wax** (not bare clay). A `frozenDipCanvas` snapshots the dip layer under the wax at wax time (`freezeDipUnderWax` on pointer-up, `destination-over` so each area seals what it had); `renderDips` calls `applyFrozenDip` to restore the seal into waxed areas so later dips can't reach under it; a `uShowWax` milky sheen shows the wax until the **Clear wax** button peels it (reveal). The frozen seal is captured/restored across swap, undo, save/load, and the partner (lid) mesh. Shader keys `clay-…-dip-resist-v9` / `-v5-partner`.
- **Motif tool:** Full-colour toggle now only affects the NEXT placement (not the just-placed one); the size **slider was removed everywhere** (size is zoom-driven, `motifSize` is a fixed const); the **Frames** motif pack was removed.
- **Asset reorg (Onion moved files):** `patterns/enamel→enamels`, top-level `frescoes→bands` (band-tool friezes; `motifSrc` has a legacy `frescoes/…→bands/…` remap for old saved bands), and the old `overlays` PATTERN pack → new **Frescoes** pattern pack (`patterns/frescoes/`, 7 images).
- **Gallery overhaul.** Thumbnails are now **transparent PNGs of the pot only** — `captureThumb`/`captureAssemblyThumb` hide `state.wheel` (the "dark base under the pot" was the wheel mesh being captured). The card composites the pot over a **player-chosen showcase backdrop** at display time: `GALLERY_BACKDROPS` (Studio/Forest/Gallery, in `assets/backgrounds/gallery/`, each with `surfaceY`/`centerX`/`scale`), `stageThumb()` places the foot (`POT_FOOT_FRAC` 0.753) on the surface + a contact shadow + clips below the foot (hides any wheel baked into legacy thumbs). Legacy opaque thumbs are flood-keyed (`keyOutThumbBg` floods `BG_COLOR` from the edges inward, so interior dark glazes are protected — a plain colour key would hole them). Picker persists as `slip-gallery-bg`. The overlay **veil is a neutral transparent charcoal** (not the old brown); auto-titles use `glazeNameFor` (shape + dip/glaze, e.g. "Bud vase in Ocean").
- **Fired screen:** the bottom-right **New pot** advance button is gone (the advance button only progresses Dry→Fire, hidden at fired); the top-left return arrow becomes a visible **"New pot" pill** at fired (`.title-btn.is-newpot`), action = `returnToTitle` (reset + shape picker; confirms discard only when unsaved).
- **Lid screen:** no Dry/Fire button on the lid — the arc is driven from the pot (the pot's Fire promotes a still-wet lid so a set fires together).

### Sculpting overhaul (2026-07-25, v171 → v180)

The wet/throwing stage was the long-standing weak spot ("sculpting could be so much better"). This run deepened it. All live on `main`.

- **Grab-anywhere shaping + grab-the-rim gestures.** Removed the fuzzy drag-direction guess that confused height vs. width. Now the grab **location** decides: grab the **body** → always shape the wall in/out (`sculptToward`, unchanged); grab the **top lip** (profile height ≥ `RIM_GRAB_FRAC` = 0.84·TOP) → the "rim" family. `WET_GRAB_MARGIN` widens the on-clay hit test so drags rarely miss.
- **Rim-pull (v179).** At the lip, a **decisive axis lock** (`RIM_LOCK_FRAC` 0.03 travel, `RIM_AXIS_RATIO` 1.25, wait-until-clear else force at 3× travel) splits the drag: **up/down → raise** (`setHeightScale` + `applyPullSlim`), **sideways → flare/collar** (reuses `sculptToward` at the top rows). Never misfires the way the old body-drag did. Caveat: the flare's brush is half-truncated at the lip so it reads a touch weak — boost with a dedicated rim-biased pull if Onion asks.
- **Altering = real asymmetry (v172+).** `profile[r]` stays the round baseline; a **per-vertex displacement field** `displace[(ROWS+1)·(COLS+1)]` adds a local radial offset → final radius = `profile[r] + displace[r,c]`. The **Alter tool** (`state.alterMode`, `#alterBtn`) stops the wheel and lets a drag dent/oval/bulge ONE side (`alterToward` — 2-D Gaussian in height+angle, `pointerToUV` for the true angle, `pointerToProfile` for target radius, rate-capped, seam mirrored). Round pots pass `null` for the field (`displaceActive` gate) so they keep the **fast analytic-normal path**; altered surfaces get **exact analytic normals** from the radius grid (`_radGrid`, cross-product of ∂P/∂θ×∂P/∂y — verified 0 bad normals across the mesh). Reduces exactly to the round normal when symmetric.
- **Facets (v172).** `applyFacets(n, depth)` writes a `cos(nθ)` ripple into the same displace field (foot-tapered); `#facetBtn` cycles `FACET_CYCLE = [0,6,8,12]` (`FACET_DEPTH` 0.07). Onion loves this one.
- **Scalloped rim (v179).** `state.rimScallop` (count) waves the **lip's Y up/down** N times, tapered in over the top `SCALLOP_SPAN` (0.20) at `SCALLOP_AMP` (0.055) — a *parametric* feature applied in the geometry writer (NOT a baked field), so it composes with facets/altering/rim-styles; `#scallopBtn` cycles `SCALLOP_CYCLE = [0,6,8,12]`.
- **Rim styles (earlier in the run).** `RIM_STYLES` (cut/rounded/flared/rolled/collared) are radial profile transforms applied at render via `computeStyledProfile`; `#rimStylePicker`, `state.rimStyle`.
- **Persistence.** `displace` is saved quantized (Int16/4096, base64 — `encode/decodeDisplaceField`) on every entry + piece snapshot; `facetCount`/`rimScallop`/`rimStyle` are plain fields on `capturePieceState`/save/load. Backward-compatible (missing = round). Reset on new pot.
- **Lids stay round (v180).** `makeLidPartner` now clears the live altering/facets/scallop when a lid is born (they live on in `savedPot`, restored on swap), and the geometry writer **hard-guards** `(displaceActive && !state.isLid)` + `state.isLid ? 0 : rimScallop` so a lid never inherits the pot's dents/facets. Verified: altered pot → round lid → swap back restores the pot's shape.
- Dev handle adds: `setAlterMode`, `alterToward`, `applyFacets`, `clearDisplace`, `writeProfileToGeometry`, `displace`, `displaceInfo`. Shape buttons (`.shape-btn`) hidden on lids (`showShape = cs==="wet" && !isLid`, force-offs `alterMode`).

### Polish + robustness run (2026-07-28, v186 → v193)

Driven by an audit of `slip-studio/POLISH_IDEAS.md` (written at v2.2) against the live code — **most of its headline items had already shipped**; treat that doc as historical, not a backlog. Its "trim SFX missing" item is also stale (`maybeSquelch` already fires on trim). What was actually still open:

- **Onboarding for the v179–v185 tools (v186).** The wet coach caption predated Alter/Facets/Scallop, so three new pills had no discovery path at all. Caption now names them, the fired caption points at Display mode, and the pills **breathe once** on first sight (`markShapeToolsOffered` / `.shape-btn.is-new`, flag `slip-seen-shape-tools`, retired for good on the first tap of any of them; "How to play" re-offers it). A caption alone doesn't move a thumb toward buttons nobody has noticed.
- **Context-loss + draft recovery (v187–v188).** See the commits — `webglcontextlost`/`restored` handling and an IndexedDB draft heartbeat with a Continue prompt.
- **⚠ `prefers-reduced-motion` was being actively defeated (v192).** `style.css` sets `.kiln-vignette { opacity: 0 }` under reduce, but `tick()` wrote an **inline** opacity, which outranks a stylesheet rule — so the full 4.5 s glow sequence played for exactly the users who asked for less motion. JS now reads a live `matchMedia` (`reduceMotion`): wet wheel keeps turning at **40%** (`REDUCED_SPIN_SCALE` — a dead wheel reads as broken), decorative spins (fired, Display) stop, kiln compresses to **1.6 s** (`REDUCED_FIRING_DURATION`) and skips the vignette writes. The backdrop cross-fade stays — a fade is the *substitute* for motion, not a violation. **Lesson: a CSS-only reduced-motion audit is not enough when JS writes inline styles.**
- **Modal focus trap (v192).** Every overlay is `role="dialog"` over a full-screen studio, but Tab walked straight out into the toolbar behind and focus was never restored on close. `trapFocus`/`releaseFocus` are a **stack** (the gallery can raise collections/confirm on top of itself), covering gallery / photo / recipes / collections / confirm, plus **Escape-to-close** for the four that had no keyboard exit. Uses `getClientRects().length` for visibility — `offsetParent` is always null on these `position:fixed` dialogs and would have filtered out every control.
- **`spinTargetFor()` extracted** from `tick()` — states the wheel-speed rule in one place *and* is checkable without a render loop, which matters because the preview pane is hidden and rAF is paused there (see `project_preview_raf_shim`).
- **Small sweep (v193).** Carve **aim ring** (`#carveDot`, mouse-only, one raycast per move, only while Carve is armed) — sgraffito is permanent, so blind aiming was the one costly slip in Decorate. Canvas **cursors**: `grab`/`grabbing`, → `crosshair` via `body.tool-armed` (`syncSceneCursor`) whenever a press would mark rather than turn. Empty shelf now **illustrates** shape → fire → save (new `icon-kiln`); the message moved into `#galleryEmptyText` because `openGallery()` writes `textContent` and would wipe the icons.
- **Dev handle adds:** `getReduceMotion`/`setReduceMotion` (reduced motion can't be emulated from a page script), `spinTargetFor`, `firingDuration`.
- **⚠ Don't `git add -A slip-studio`** — it sweeps in ~2.9 MB of deliberately-untracked working art (`icons/`, `hand.png`, `slipstudio.png`, `store-screenshots/`) plus the `backgrounds/gallery/` backdrops v170 *removed* from the picker. Stage the code files by name.

### Replayability era (2026-08-04, v225 → v238) — all live on web, NONE of it on Play

The problem: Slip Studio is a sandbox with no reason to open it a fifth time. The genre's answer is a merchant economy, which we refused — currency gating content already paid for, deadlines turning making into obligation, selling that *consumes* the pot, star ratings replacing the player's own judgment. What a merchant loop actually provides is a reason to make *this* pot, a constraint to work against, and a sense the work goes somewhere; all three are available without a coin. Three specs were written first and live alongside the code: **`slip-studio/TEST_TILE_WALL.md`**, **`KILN_FIRINGS.md`**, **`COMMISSIONS.md`**. Each names the functions it touches and phases so it can be stopped after any cut. **Commissions is unbuilt** — it's ~20% code and ~80% Onion's writing (30–40 request/reply pairs), so it waits on her.

- **Test-tile wall (v226).** Fixed a system that was already broken rather than adding one: 21 curated reactions out of 1,128 possible pairs is a ~2% hit rate per random pick, at one whole pot per attempt, so the recipe journal was effectively undiscoverable. A rack of six small tiles decouples experimenting from pot-making. **A tile is stored as nothing but its one or two glaze ids** (~20 bytes) and rendered from `reactGlaze()` — the same function the shader calls, so a tile and a pot can't disagree. That meant `localStorage` (`slip-tiles`, `slip-rack`), no IndexedDB version bump, no migration. Two tiers, as a real wall has: curated pairs get a journal name, everything else still fires to a real blend and still pins up. The journal folded in as a **tab of the wall** rather than a second modal, so the landing link and the gallery button both land there. `checkRecipeDiscoveries` was hand-rolling its pair scan; extracted **`recordRecipePairs(ids)`** so the pot and tile paths share it, with announcement split out (a rack fires six at once and should say one thing).
- **Reactions 21 → 72 (v227).** Twelve per pack, evenly. **Stoneware had zero before this** — the pack with the most real chemistry behind it, every overlap falling through to the generic blend; it now carries carbon trap, kaki, nuka, wood ash, salt blush, celadon break. Every pair is **within a pack**, because the picker shows one pack at a time and a pair nobody can reach is the same as no pair. Verified by script (72 hand-written hexes is where a typo hides): no duplicate keys after sorting, no duplicate names, `REACTION_PAIRS`/`RECIPE_NAMES` covering an identical key set, no cross-pack pairs. Also checked each colour against what `blendGlaze` would return anyway — **a curated reaction landing on top of its own fallback adds a name and nothing else** — and pushed nine that came in under 14 RGB units toward what the named effect really looks like. Distances now run 14 (ash+dune, two pale ashes that *should* land close) to 115 (copper+mint, which really does go verdigris), median 30.
- **Firing types (v229).** Electric stays exact and stays the default, so chance is opted INTO. Wood lays ash and flame-marks on the side that faced the fire; soda stipples and blushes; raku smokes and crazes — and **inverts wood on both axes**, because smoke pools low and in the *lee*. **No new texture, uniform, or shader cache-key bump**: effects paint into the same dip canvas as one more replayed pass after `applyFrozenDip`, so they carry their own alpha (landing on bare clay, which is what makes smoke read) and ride the existing save/load and partner paths. Everything derives from `(type, seed)` through `mulberry32`; **the roll happens once, in `advanceStage`, and is stored** — a pot that changed when you came back would be the worst possible bug here. A set shares one roll. `resetPot` clears `state.kiln` explicitly rather than leaning on `cancelFiringMoment`, which early-returns once the sequence has *finished* — otherwise a fresh pot inherits the last one's ash.
- **Re-fire (v229).** A finished pot goes back through the kiln in a different firing. `savePot` always mints a fresh id, so this is structurally incapable of overwriting: the original stays and a re-fire is always a second copy. The modal says so, because someone afraid of losing a pot won't press the button.
- **Kiln loads (v232).** Pack a 2×3 shelf and fire up to six together; **where a piece stands changes what comes out** — `slotFx` gives the front column 1.32× and the back 0.66×, and the top shelf catches falling ash while the bottom runs. Measured front-vs-back **1.95×**. Built without an N-mesh scene: pieces cycle **sequentially** through the live studio (`loadPot` → set kiln → `renderDips` → `captureThumb` → `dbPut`), so only one set of canvases is ever live. Originals are never touched; members are new entries. **`slot == null` must keep reproducing the pre-shelf look exactly** — verified at mean 8.69 / top 11.1 / bottom 6.3, identical to the pre-slot measurement, so pots saved before kiln loads reload unchanged.
- **Bug fixes found after the vc23 build (v233 → v238).** All from Onion using the app, not from assertions:
  - **v233 — a lid added at Decorate was a dead end.** `makeLidPartner` seeds a lid at wet while the pot stays at leather, so it starts a stage behind, and the advance button is hidden on lids outright (v151 made the pot drive the arc — which assumed lids are born at wet *alongside* the pot). No advance, no Decorate tray, no shape tools: the lid could never be dried, so never glazed, and the pot's Fire promoted it silently and it came out bare. **`lidIsBehindPartner()`** now shows the advance while a lid trails its partner; once level the pot drives again.
  - **v234 — a pot and its own re-fire saved under identical titles**, which defeats the point of re-firing. `defaultPotTitle` now appends the firing ("Jar in Ocean · Raku"); electric stays unmarked so nothing already saved renames. The suffix is **idempotent** — re-firing a re-fire replaces the tag rather than stacking, and going back to electric strips it.
  - **v235 — a fresh lid inherited the pot's dips.** `makeLidPartner` reset glaze, decoration, bump, altering, facets and scallop but never `state.dips`, so a lid seeded at Decorate arrived pre-glazed and named "Lid in Ocean" while one seeded at wet came out bare. Same button, two behaviours.
  - **v238 — lids were fitted to the wrong rim.** `RIM_STYLES` apply at *render*, so the raw profile's top row is not where the lip is: flared draws **+46.8%**, collared **−45.0%**, rolled −38.1%, rounded −18.4%. All three sizing sites read the raw row, so a lid on a collared pot came out nearly twice too wide. Only `cut` agreed — the default, and the only style predating rim styles, which is exactly why it looked fine until the new ones got used. **New `rimRadiusOf(profileArr, rimStyle)`** applies the style function to the rim row directly. ⚠ **It must NOT route through `computeStyledProfile`, which is not pure** — its clamp calls `maxRadiusAt`, which returns 0 above a lid's cap whenever `state.isLid` is set, so asking it about a *pot's* profile while a *lid* is live (exactly `matchLidRim`) collapses every styled rim to `ALTER_MIN_R` and the match silently no-ops on its `newRim <= MIN_R` guard. Second fault in the same button: seeding gives a lid a base **1.0739×** the rim (a lid *overhangs* the lip), but Match rim rescaled to flush and shaved the overhang off every press — `seedLidForRim` now records `state.lidBaseRatio` and `matchLidRim` aims at the same fit. The ratio rides the shape-history snapshot and `capturePieceState`, since unlike `lidMaxY` it can't be recomputed from the silhouette.
- **Resilience checks that came back clean:** 95 asset references, 0 missing on disk and 0 missing from the AAB; a full runtime walk logged **118 requests with zero 4xx/5xx** including 30 mp3s and 10 woff2s (the two categories that shipped missing for months); and the app **boots fine with all 19 `slip-*` localStorage keys corrupted**, every preference falling back to default with no console errors.

**⚠ Testing gotchas from this run — all three produced false results before being spotted:**
1. **The kiln sequence completes on rAF, which is throttled in a hidden preview pane.** Asserting straight after a fire reads a half-finished state and invents bugs (it looked like re-fire wasn't re-rolling seeds). Call **`__slip.endFiringMoment()`** explicitly instead of waiting.
2. **`getBoundingClientRect().height` is the painted box, not the hit area.** Flagged touch targets as too small twice; both were 34px once probed with `elementFromPoint`. Measure the hit area.
3. **Bumping `?v=` doesn't help if `index.html` itself is cached.** A "the fix didn't work" result was the browser still serving `main.js?v=232`. Bust the page URL too, and check `document.querySelector('script[type=module]').src` before trusting any assertion.

---

## Tub's Cookie Cache — Fruit-Ninja arcade game + Android paid app

Lives at `cookie-cache/` (flat shape: `index.html` + `game.js` + `style.css` + `assets/`). Fast landscape arcade game — **Tub Butter** (a fuzzy orange data-eater; the `eater.png` sprite) eats "data cookies" and dodges veggie "bombs," with a storybook that teaches what web cookies really are. Advertised on the hub as **"Tub's Cookie Cache."** LIVE at madderverse.org/cookie-cache/.

**Big rework (2026-07-04/05): tap → Fruit-Ninja swipe-slice.** Was a tap-to-catch game; now a swipe-slicer. Key `game.js` architecture:
- **Swipe + tap hybrid.** ONE stage-level pointer tracker (`onBladeDown/Move/Up`) drives both — a tap slices the cookie under the finger; a drag carves a **blade trail** (canvas overlay) that geometrically hit-tests every cookie (`sliceSegment`, point-to-segment distance). 2+ in one stroke = a **combo** (`awardCombo`; escalates ×3 flash → ×5 "SLICE FRENZY" + jackpot). No per-cookie listeners.
- **⚠ Blade-canvas DPR gotcha (cost hours):** the blade `<canvas>` (`.blade-layer`) MUST have explicit CSS `width/height:100%`. A `<canvas>` is a *replaced element*, so `inset:0` does NOT stretch it — without a CSS size it displays at its backing-pixel size (stageW×dpr), so on a high-DPI phone the trail draws at 2× scale + offset (invisible at desktop dpr=1, which is why browser testing missed it). Diagnosed with an on-canvas overlay drawing each cookie's hitbox. See `reference_canvas_replaced_element_dpr` memory.
- **Bottom-launch physics.** Cookies are tossed UP from below the bottom edge in arcs / fanned waves (`launchCookie`/`spawnCookie`), not flown across from the sides. A "miss" = letting one drop back off the bottom (gated by `entered`). Tune `LAUNCH_PEAK_HIGH/LOW`, `WAVE_CHANCE`.
- **Slice-split.** A caught cookie becomes two masked halves that tumble apart + fade (`sliceSplitCookie`). The in-play Tub + pile-zone were REMOVED (CSS `display:none`) so cookies get the full-bleed stage; Tub only reappears at the feast.
- **CSS bite** (`applyBite` / `.bitten`): the eaten look is a radial-gradient mask punched out of the whole-cookie sprite — this **replaced `cookies-after.png`** (deleted, −11.7 MB). Still used for the feast pile.
- **Specials** (`launchCookie` roll; disjoint chance bands frenzy→golden→slowmo): **golden** cookie (5× points); **frenzy** cookie → `startFrenzy()` (~5s cookie storm: rapid spawns, no bombs, 2× points, rainbow blade, code-rain races, gated on `TUNE.allowFrenzy`); **slow-mo "BUFFERING…"** cookie → `startSlowmo()` (~3.2s: eases every cookie's motion to `SLOWMO_FACTOR` via a global `timeScale` in `loop` — the round CLOCK stays full-speed so it's a calm catch-up breather, not a points farm; cool-blue `.slowmo-active` tint; allowed in all modes incl. Zen). Both frenzy/slowmo use absolute-time deadlines (`*Until`) that pause() shifts forward. Reusable pattern for future power-ups.
- **Modes** (`MODES`/`TUNE`/`applyMode`, saved `cookie-cache-mode`): **Cozy** (easy), **Classic** (arcade rush), **Zen** (calm, no bombs, no fail — via `missBreaksStreak`/`allowFrenzy` flags).
- **Round length** (`VALID_LENS`=[30,60,90], saved `cookie-cache-length`, menu `.len-toggle`/`setLen`/`renderLenToggle`): 30s (default/quick) · 60s · 90s. `startRound` writes the choice to `CFG.duration`, which drives the clock AND the difficulty ramp (time-normalised, so a 90s round eases in more gradually). Level music now **loops** (`playLevelMusic` sets `.loop`) so longer rounds keep their soundtrack. The `.len-btn`/`.mode-btn` CSS is shared via grouped selectors; keep the mode click handler (`querySelectorAll('.mode-btn')`) and the length one (`.len-btn`) on their distinct classes so they don't cross-fire.
- **Pause** (`pauseGame`/`resumeGame`/`togglePause`): top-right ❚❚ button (in-game only), dimmed `#pause-overlay` with RESUME + QUIT (backdrop-tap resumes), P/Space keys, and **auto-pause on `visibilitychange` hidden** (no auto-resume). Freezes loop/spawn/clock/glitches/music; `lastTs` resets on resume.
- **Personal best** (`cookie-cache-best` localStorage) on menu + feast; "NEW HIGH SCORE!" + feast confetti on a beat.
- **Feast** finale: Tub eats the whole pile in exactly **3 bites** (chomp-chomp-swallow, `chompPile`) regardless of size, then a burp. A rotating **"DID YOU KNOW?" cookie fact** (`COOKIE_FACTS`/`pickCookieFact`, `#end-fact`) shows under the rank — the data-cookie lesson, landed at the reward.
- **Particle governor** (`spawnParticle`/`PARTICLE_CAP`=150/`burstCount`): every catch fires ~50 short-lived DOM particles across the chunk/crumb/spark/confetti/veg-splatter bursts; a combo/Frenzy could ask for 150-200 in one frame. A single slice still spawns full; heavy moments degrade gracefully to the cap instead of stuttering low-end phones. `burstCount` also thins bursts under reduce-motion. `clearParticles()` zeroes the pool on reset.
- **Polish:** "TIME'S UP!" transition (`ROUND_END_MS`), round-start `showModeFlash`, music fade, swipe whoosh (WebAudio), screen shake, final-5s urgency (red pulse + ticks — NOT in Zen), first-run "SWIPE TO SLICE!" hint (`cookie-cache-seen-swipe`), `prefers-reduced-motion` support.

**Full-bleed layout.** Framed cyan border + margins removed; HUD floats as an absolute overlay so the stage fills the screen. Menu + feast have a `@media (max-height:540px)` block to fit phone-landscape — the feast overrides must be **id-scoped** (`#screen-feast .feast-*`) because the base `.feast-*` rules appear later in the file and would win the specificity tie otherwise.

**Android paid app** (like Slip Studio — one-time price, **NO IAP/RevenueCat**):
- Capacitor wrap `cookie-cache-app/` — **outside git** (gitignored). pkg `org.madderverse.cookiecache`; launcher name **"Cookie Cache"**, listing title **"Tub's Cookie Cache."**
- Rebuild (JDK 21): `cp cookie-cache/{game.js,style.css} cookie-cache-app/www/` — **NOT index.html** (`www/index.html` is an app-stripped copy: no GoatCounter / site-footer / home button, for the offline + no-data-collection claims; add new HTML like the Zen button to BOTH files). Then `npx cap copy android` → `assembleDebug` (sideload) / `bundleRelease` (Play) with `JAVA_HOME` at jdk-21. Bump `versionCode`/`versionName` per upload.
- **Landscape edge-to-edge under the camera (Galaxy S21):** set `windowLayoutInDisplayCutoutMode: always` in **`res/values-v30/styles.xml`** (in the THEME, not programmatically — programmatic is unreliable on Samsung landscape). MainActivity keeps ONLY: immersive `setDecorFitsSystemWindows(false)` + hide bars + dark window bg + gesture exclusion. Do NOT consume WebView insets (it interferes). A landscape lock moves the punch-hole to a *side* edge, which portrait apps never hit — that's why the other Madderverse apps "just worked." (One residual bar the user has accepted as a later-update item.)
- **App icon** built from Tub via `scratchpad/make_icon.py` (PIL — no ImageMagick on this box; `convert` is the Windows exe). @capacitor/assets added ~6MB of unused splash pngs — trim before the final AAB.
- **Release paperwork:** listing copy in `cookie-cache/PLAY_STORE_LISTING.md`; **privacy LIVE at `/cookie-cache/privacy/`** (no data collected, localStorage-only high-score + mode); Data-safety form = nothing collected; paid, match the Madderverse price.

**Web vs app source:** the same `cookie-cache/{game.js,style.css}` feed both. The dev `DEBUG` scaffold + `BUILD_TAG` stamp were stripped from the shipping source for release; the build tag (when present) is gated on `window.Capacitor` so it never shows on the web.

---

## Florigami — cozy flower-breeding game (LIVE, advertised)

**Renamed from "Petalcraft" → "Florigami" 2026-07-25** (flower + origami — matches the torn-paper art direction being built). The folder + URL moved `petalcraft/` → `florigami/`; a **redirect shim at the old `/petalcraft/` path** (a tiny `petalcraft/index.html`) forwards to `/florigami/` preserving query/hash, so old shared links resolve. **Internal identifiers were deliberately KEPT on the old name** — `localStorage` key `petalcraft-save` (+ `-corrupt`), the export filename now `florigami-garden-*`, and the `window.__petalcraft` dev handle. Renaming the save key would wipe every existing player's garden (same reasoning as Pootery keeping its `crayte-*` keys). The rebrand is visible-name-only; `GAME_NAME` in `game.js` drives the topbar + tab title + toasts.

Lives at `florigami/` (flat shape: `index.html` + `game.js` + `style.css`, plus `DESIGN.md` = full spec). **LIVE + advertised** at madderverse.org/florigami/ (hub grid card #8, in sitemap/llms/JSON-LD). Vanilla JS + CSS + WebAudio + SVG. Mendelian genetics reimplemented from the community-documented AC:NH flower model (phenotype tables cross-verified against Joey Parrish's GPLv3 `phenotypes.py` — see the code comments and `DESIGN.md §10` for attribution); genotype is hidden ("accidental discovery"). No timers, no fail states, no ads, no accounts, no IAP — the Madderverse Promise. Real-time accelerated clock with offline catch-up; localStorage save (`petalcraft-save`, schema-versioned with a `migrateSave` step — currently **v3**).

- **Cache-bust:** `index.html` loads `game.js?v=N` + `style.css?v=N` — **bump `N` on every web change** (currently **v15**). Stale-cache "my change did nothing" reports = hard-refresh (Ctrl+Shift+R) and confirm the new `?v=`.
- **⭐ Colour/breeding system — FINALIZED 2026-07-25 (unified across ALL 8 species).** Every species breeds identically via one shared table (`MIX_TABLE`/`MIX_SEEDS`/`MIX_DEX`/`MIX_RARE`, assembled by `mixSpecies()`). The 3 genes are pigment presence R/Y/B ("present" at strength ≥1): R=red, Y=yellow, B=blue, R+Y=orange, Y+B=green, R+B=purple, none=**white**, all=**black**. Seeds are the 3 **primaries** (red `200`, yellow `020`, blue `002`); crossing two primaries **deterministically** yields the mix (red×yellow→orange…), so breeding teaches real colour theory. **dex = the 6-colour rainbow** (red/orange/yellow/green/blue/purple); **white + black are the 2 universal RARES** (deep-recessive / all-pigment crosses) on the `★ Rares` shelf. **Full collection = 8 species × 8 colours = 64.** Species differ ONLY by silhouette + rare pattern — no per-species genetics, no 4-gene rose, no species-specific colours (the old AC:NH per-species palettes are gone; roses is now 3-gene). Flavour is shared (`SHARED_FLAVOR` + `flavorFor()`, per-species overrides via `FLAVOR`). `isHybridColor` is species-aware.
- **⭐ Patterns = the rare tier (finalized).** **Base 6 colours render PLAIN watercolour** (calm screen); **only white/black rares are PATTERNED**, each species wearing its own signature pattern from `patterns/` — so a patterned bloom always reads as "rare," and the pattern says which species. Pattern is a cosmetic rarity marker, does NOT affect breeding. Compositor arg `<pattern_index>` = that species' rare pattern; `RARE={white,black}` in `compositor.py` gates plain-vs-patterned.
- **Art pipeline is LIVE (torn-paper collage), cosmos is the first shipped species.** Inputs (untracked, local working art): raw paper shapes `florigami/shapes/*.png` (circle/oval/kite/seed/leaf/stem/triangle/rhombus/pentagon), rawpixel patterns `florigami/patterns/*.png` (10), and art-direction reference shots `florigami/_previews/*.jpg` (7 — vision / hierarchy_ab / edge_compare / maxed_patterns / orient / paper_flower_test / patterns_contact). *(2026-07-27: these three untracked sets were consolidated here — `shapes`/`patterns` recovered from the deleted `slip-next-worktree`, `_previews` moved out of the stale pre-rename `petalcraft/` copy. `petalcraft/` now holds ONLY its tracked redirect `index.html`; its leftover pre-rename `game.js`/`style.css`/`DESIGN.md`/`tools`/`cover.jpg`/`patterns`/`shapes` were deleted as older duplicates of the `florigami/` originals.)* Tools: **petal-formation editor** `florigami/tools/petal-editor.html` (design a flower layout by rings + per-petal drag → export formation JSON); **compositor** `florigami/tools/compositor.py` (`shapes patterns formation.json pattern_index out.png` → stamps a sprite sheet: 8 colour rows × seed/sprout/bud/bloom, base plain + rares patterned). Formations in `florigami/formations/` (cosmos = `Downloads/cosmos.formation.json`). **Shipped:** `florigami/assets/img/flowers/cosmos.png` (rare pattern = dots A / index 0). The in-game sprite system (`SPECIES[x].sprites`, `initSpriteSheets`, `spriteFrameFor`, `applySprite`; rows = `spriteColorsFor` = dex+rares) draws from the sheet when it loads, **CSS shapes stay the fallback**. Locked recipe: **watercolour pigment-pool shading** (edge emerges from the shading, no drawn line), plain watercolour centre. Convention in `ASSETS.md`; Gemini prompts in `PAPER_ART_PROMPTS.md`. **Next: rework cosmos formation if desired, then bake the other 7 species' sheets (each = a formation + a signature rare pattern).**
- **Interaction (v11–v12):** tap a flower = water (or plant an armed seed on empty soil). **Drag** a grown flower to empty soil = MOVE it; drag onto the **compost** pile (appears mid-drag) = PICK/remove it, freeing the tile — all free, cozy. Garden-level pointer handling (`initGardenPointer`, `onGardenDown/Move/Up`; `movePlant`/`removePlant`). **Replant:** the plant tray shows **every colour you've discovered** per unlocked species (not just seeds); bred colours are marked leaf-green ✿ and replant the **exact first-found genotype** (`plantGenotype`, `plantableColorsFor`) — enables intentional crosses (plant an orange next to a blue on purpose). Bigger play area (app 720 / garden 640px).
- **Species (unlock chain, total-discovery gates):** cosmos (free) → tulips (first cosmos hybrid) → pansies (5 cosmos dex slots) → hyacinths (10 total) → lilies (14) → mums (18) → windflowers (23) → roses (28, the endgame). All 8 share the unified genetics above (see `mixSpecies`); they differ only by art/silhouette + signature rare pattern.
- **Phase 3 systems (2026-07-24):** rare-tier collectibles (bigger sparkle + jingle + keepsake card + a `★ Rares` trophy shelf), a card-list Floridex with All/Found/Rare filters + inline flavor + locked-species tabs, and progression-unlocked **garden ornaments** (cozy scene decorations, no gameplay effect). Display name is variablized as `GAME_NAME` in `game.js` (drives topbar + `document.title` + toasts).
- Dev handle: `window.__petalcraft` (kept on the old name as invisible plumbing; state, `advanceDay`, `unlockAll`, `reset`, `mockSprites`, `mockBackdrop`, rarity helpers). Phase 6 (Android paid app via Capacitor, pkg `org.madderverse.florigami`) is not built yet — see `DESIGN.md §7`.
- **`cover.jpg` was reshot 2026-08-04.** The old one still had **"Petalcraft"** painted into the artwork — the rename missed it, and it sat on the hub card for ten days. If you rename anything again, grep the *docs and markup* for the old name but also **look at the images**; a name baked into a JPEG is invisible to grep. The current cover is composed from real shipped assets, not hand-painted: **`assets/img/backdrops/garden-day.jpg`** full-bleed as the backdrop — the same file `BACKDROPS.garden` loads at runtime, deliberately NOT the 8.3MB `assets/img/garden.png`, which is *untracked local working art* (a cover has to be regenerable from what's in the repo; the two are the same photograph, mean abs diff 0.99/255) — plus eight bloom frames cropped straight out of the `cosmos`/`daisy`/`pansy` sheets (col 3 of 4 = `bloom`; rows are `spriteColorsFor()` order, dex then rares). Two rares are deliberately in the front row — they're the only patterned rows, so they're what makes the cover show the collection hook instead of just flowers. Regenerate by rebuilding that composition and screenshotting at 1280×720 with headless Chrome, then Pillow to JPEG q88 progressive.

---

## Tiny Canvas — kids coloring app (LIVE on the hub, has its own guide)

Lives at `tiny-canvas/`. **Read [`tiny-canvas/CLAUDE.md`](tiny-canvas/CLAUDE.md)
before touching it** — it's the only game here with enough machinery to
need its own guide, and the traps in it are not obvious.

Two things that make it unlike every other game in this repo:

- **It's the first madderverse product with a build system.** Capacitor
  wrap for iOS + Android, `package.json`, `node_modules/`. It still
  works as a plain static site (no bundler), so local dev is unchanged,
  but the native path is real.
- **It deliberately ships NO third-party requests at all** — no
  GoatCounter (Apple's Kids category forbids third-party analytics SDKs
  that collect identifying data) and, as of 2026-08-04, no Google Fonts
  either; the three fonts are self-hosted woff2 in
  `tiny-canvas/assets/fonts/`. Don't "helpfully" restore either one.
  This is the documented per-product exception — see `DESIGN.md §16`.

**Status: web build advertised on the hub since 2026-08-04; Android release built, signed and targeting API 35 but NOT yet uploaded — screenshots are the remaining blocker.** A 99¢ Pro unlock is decided but unbuilt; see the game's own CLAUDE.md.

**Status detail:** — grid card (last
real card, before "More Soon"), JSON-LD `ItemList` position 9,
`sitemap.xml`, `llms.txt`. `cover.jpg` exists.

**The web game is what's listed; the STORE release is not done.** The
v1.0 shipping checklist in its CLAUDE.md still has the whole accounts /
signing / store-listing half outstanding, so don't describe Tiny Canvas
as being on Google Play or the App Store anywhere — listing copy, social
posts, or the hub's own About text.

`cover.jpg` is generated by `tiny-canvas/scripts/make-cover.py`: it
renders the shipped KITCHEN CAT page half-colored using the same
region model the FILL tool uses (alpha≥96 mask, flood regions, app
RAINBOW palette, seeded), so the cover literally shows what the
product does and can't drift from it. Regenerated 2026-08-05 when the
raster pages replaced the SVG set (the old cover rendered the retired
SVG butterfly). It isn't a hand-painted asset — re-run the script.

**The 34 hand-drawn SVG templates were replaced 2026-08-05 by 14
full-scene raster coloring pages** (+ BLANK) — the free set; Pro will
add more. Sources in untracked `tiny-canvas/art-src/coloring-pages/`,
shipped pages generated by `tiny-canvas/scripts/
process-coloring-pages.py`. See the game's CLAUDE.md ("The raster
coloring pages").

**The Pro value-pass content is BUILT (2026-08-05)**: 4 new brushes,
a 24-shape STAMP tool, 8 paper textures, 12 export frames — gated by
`isPro()` (always true on web = the showcase). Pattern fills stay
free forever. **Billing is WIRED the same day** (RevenueCat, one
`pro` entitlement, parent-gated Settings card; inert until Onion
creates the RC project and pastes the key — checklist in game.js) and
**pinch/button zoom shipped** for the detailed pages. Details +
locked decisions in the game's CLAUDE.md.

Its own cache-bust convention applies: **bump `?v=N` in
`tiny-canvas/index.html` on every change** to `style.css`,
`templates.js` or `game.js` (currently v28).

---

## All Munkis — Android **free app** build & publish (Onion Madder dev account)

**Two projects on disk, do not mingle:**
- `all-munkis-app/` — **current** build project, on the **Onion Madder** dev account. Package id `com.onionmadder.munkis`, signed by `all-munkis-om-release.keystore` (`CN=All Munkis, O=Onion Madder, C=US`, no L/ST — no location leakage). PKCS12, alias `allmunkis`, both passwords `allmunkis_2026_release`, 10000 days, SHA-256 `EC:11:F3:58:7D:FB:3F:80:26:93:83:C4:C5:FC:52:D3:C6:BF:66:01:A2:38:AC:11:3F:3E:67:BE:6D:C2:83:A8`.
- `all-munkis-app.archive-madsundar/` — **frozen** Mad Sundar LLC project. Package id `org.madderverse.munkis`, signed by `all-munkis-release.keystore` (`O=Mad Sundar LLC`, has the Minneapolis/MN decoy). vc11 is live on Play under this signing chain; vc12 was built but not promoted (default Capacitor icon); vc13 built 2026-05-29 with the correct Munki icon, staged AAB preserved in the archive. **Do not build here anymore; do not cross-sign.**

Both projects are **OUTSIDE git** (untracked, sibling to `pootery-app/`, `slip-studio-app/`, `cookie-cache-app/`).

**Why split?** Onion moved this listing off the Mad Sundar LLC dev account onto a personal "Onion Madder" account. Play doesn't let two accounts share a package id, so the new listing gets a fresh pkg id + fresh keystore + fresh Play App Signing enrolment on first upload — it appears as a brand-new app in the Play store even though the game content is the same.

**In-app branding stays "Madderverse."** Only the Play Console "Developer" line and the underlying pkg id change. Launcher name (`app_name = "All Munkis"`), in-game copy, canonical URL, all unchanged.

**Version lineage split:**
- Mad Sundar chain (archived): vc11 live / vc12 (bad icon) built / vc13 built + staged / STOP.
- Onion Madder chain (current): **vc1 / 1.1.1** — first upload; game state = v1.1 + the 2026-07-27 rebrand + the 2026-07-30 polish sweep.

**Free, no IAP.** Do not add RevenueCat or billing (ad-free/kid-friendly).

**Rebuild recipe** (JDK 21, mirrors Slip Studio's `-P` signing pattern):
```bash
APP="/c/Users/kelly/OneDrive/Desktop/website backups/madderverse/all-munkis-app"
SRC="/c/Users/kelly/OneDrive/Desktop/website backups/madderverse/all-munkis"
cd "$APP"
rm -rf www/*
cp "$SRC/index.html" "$SRC/game.js" "$SRC/style.css" www/
cp -r "$SRC/assets" "$SRC/legal" www/
sed -i '/goatcounter/d' www/index.html
# (append the app-only .madder-home + .site-footer-slim { display:none } CSS to www/style.css)
# bump versionCode + versionName in android/app/build.gradle
npx cap copy android && npx cap sync android
cd android
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" ./gradlew bundleRelease \
  -PMUNKIS_STORE_FILE=all-munkis-om-release.keystore \
  -PMUNKIS_STORE_PASSWORD=allmunkis_2026_release \
  -PMUNKIS_KEY_ALIAS=allmunkis \
  -PMUNKIS_KEY_PASSWORD=allmunkis_2026_release --console=plain
```
Output: `all-munkis-app/android/app/build/outputs/bundle/release/app-release.aab`. Full flow in `all-munkis-app/BUILD_RECIPE.md`.

**Privacy strip is mandatory** for every rebuild — Play Data Safety declares "no data collected," so GoatCounter MUST NOT ship in the app copy, and `.madder-home` + `.site-footer-slim` must be hidden (they link to `../` on madderverse.org and 404 in a WebView).

**Current staged AAB (uploaded? or pending Onion):** `Desktop/all-munkis-v1.1.2-vc2-onionmadder.aab` (14.1 MB, built 2026-07-31, signed with the Onion Madder keystore). vc1 was built 2026-07-30 at ~28 MB but never uploaded (superseded by vc2 after the backdrop-optimization pass shrunk the 5 CSS-backdrop assets from ~15.6 MB to ~0.8 MB). First-upload paperwork on Onion's side: create the app in Play Console under the Onion Madder account, enrol Play App Signing on first upload, back up the returned upload certificate PEM, adapt store listing from `all-munkis/PLAY_STORE_LISTING.md` (Mad Sundar draft), Data Safety = no data collected, privacy URL **`https://onionmadder.com/apps/all-munkis/privacy/`** (matches the Onion Madder dev identity — better fit than the old madderverse.org path).
