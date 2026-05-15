# Tiny Canvas — game/app-level guide

A polished kids coloring app. Pick a page, color it in, save it.
Shipping to **App Store + Google Play + the web**, all from one codebase
via Capacitor.

**Read these first:**
- The repo-root [`../CLAUDE.md`](../CLAUDE.md) for project-wide rules
  (no build system on the *static-site* games; absolute URLs for SEO;
  GoatCounter beacon used by other games; ad-free / kid-friendly
  branding).
- The repo-root [`../DESIGN.md`](../DESIGN.md) for tokens, type stack,
  drawer pattern, animation timings, and voice — **all of which were
  the design source for this app**.
- [`STORE_LISTING.md`](STORE_LISTING.md) for paste-ready App Store
  Connect + Google Play Console metadata.
- [`legal/privacy.html`](legal/privacy.html) and
  [`legal/terms.html`](legal/terms.html) — published to
  madderverse.org as the store-listing privacy/terms URLs.

## What's different about Tiny Canvas (vs. the static-site games)

Tiny Canvas is the **first madderverse product with a build system**.
Every other game in the hub is pure HTML/CSS/JS served as-is by GitHub
Pages. Tiny Canvas:

- Is wrapped with **Capacitor** for iOS + Android distribution.
- Has a `package.json`, `node_modules/`, and (after first `cap add`)
  `ios/` + `android/` directories.
- Still works as a plain static site at `madderverse.org/tiny-canvas/`
  (the web build is just the HTML/CSS/JS — no bundler).
- Intentionally **does NOT load GoatCounter**. Apple's Kids category
  forbids third-party analytics SDKs that collect identifying data;
  the rest of madderverse keeps the beacon, this one product is the
  documented exception (see [`../DESIGN.md`](../DESIGN.md) §16).

The web version is fully independent of the native build. Local dev is
still `python3 -m http.server 8000` from this directory; you only touch
Capacitor when you're packaging for a store.

## What it is

- **5 screens**, swapped via the `[hidden]` attribute on
  `<main class="screen">`: title → picker → draw → gallery → settings.
- **21 line-art templates** (BLANK + 20 themed pages): smiley sun,
  cat, rocket, fish, house, dog, bear, butterfly, bird, car, airplane,
  truck, unicorn, dragon, castle, donut, ice cream, dinosaur, robot,
  snowflake. Each is a `viewBox="0 0 800 800"` SVG drawn in
  `currentColor` strokes; rendered as a `pointer-events: none` overlay
  above the kid's canvas so the kid colors UNDER the lines.
- **6 distinct brushes** (PEN / MARKER / CRAYON / PENCIL / PAINT /
  GLITTER), each with its own beginStroke + drawSegment + textural
  feel. Plus ERASER.
- **36 colors organized in 5 groups** (RAINBOW / PASTELS / NEONS /
  EARTH / METALLIC) via tab switcher.
- **Per-tool sizes** — 5 sizes for brushes (4/10/18/28/42), 3 for
  eraser (14/28/50). Each brush's defaultSize is a member of
  BRUSH_SIZES so its size button is always active on tool-switch.
- **Brush smoothing** — midpoint-quadratic smoothing on by default,
  togglable in Settings. Each brush is smoothing-agnostic; smoothing
  happens one layer up in the pointer handler.
- **Undo / Clear** + Ctrl/Cmd+Z keyboard shortcut.
- **localStorage gallery**, cap 60 entries. Each save composites the
  canvas + line-art into a PNG dataURL, stored as a record:
  `{ id, name, template, date, png }`.
- **Auto-save** — independent in-progress slot every 60s, plus on
  visibilitychange + beforeunload + pagehide. Kid's work survives
  backgrounding, device lock, and tab close.
- **Parent gate** — two-digit-addition gate before DELETE / EXPORT
  PNG / external links (home button + footer). Once unlocked, holds
  for the session. Apple Kids category compliant.
- **Settings screen** — brush smoothing toggle, SFX toggle, music
  toggle (disabled, "Coming soon"), locale stub (English only for
  v1, designed for future expansion).
- **Web Audio synthesized SFX** (tap / save / erase / swoosh). No
  audio files. SFX-toggle-gated.
- **PWA**: manifest + theme-color + Apple PWA chrome.
  `beforeinstallprompt` reveals the INSTALL APP button on supported
  Chromium browsers.
- **Capacitor native plugins wired**: Preferences (mirror localStorage
  to native KV store), Filesystem + Share (native export to Save to
  Photos / Save to Files sheet), StatusBar (DARK + `#06141a`),
  SplashScreen (auto-hide at init+400ms). All feature-detected — web
  build is untouched.

## File layout

```
tiny-canvas/
  index.html              # 5 screens + parent-gate + first-save toast
  style.css               # onioncore tokens, drawer pattern,
                          # settings card, parent-gate modal, toasts
  game.js                 # IIFE: canvas + 6 brushes + auto-save +
                          # parent gate + settings + native bridge
  templates.js            # window.TINY_CANVAS_TEMPLATES — 21 SVG pages
  manifest.webmanifest    # PWA manifest, theme-color #ff2e88

  icons/
    icon.svg              # master 1024x1024 app icon (full bleed)
    icon-foreground.svg   # Android adaptive-icon foreground
    splash.svg            # 2732x2732 splash (square, center-crops)

  legal/
    privacy.html          # hosted at /tiny-canvas/legal/privacy.html
    terms.html            # hosted at /tiny-canvas/legal/terms.html
    legal.css             # plain-prose long-form style

  scripts/
    capture-screenshots.js  # Playwright-driven, captures 5 screens
                            # at 6 device profiles into ./screenshots/

  package.json            # Capacitor 6 + plugins
  capacitor.config.json   # appId org.madderverse.tinycanvas, webDir "."
  .gitignore              # node_modules + native build outputs

  STORE_LISTING.md        # paste-ready store-listing metadata
  CLAUDE.md               # this file
  cover.jpg               # hub card art (TODO — placeholder until shot)
```

## Architecture (`game.js`, top → bottom)

| Section | What lives there |
|---|---|
| **CONFIG** | `STAGE_W=800`, `STAGE_H=800`, `COLOR_GROUPS` (5 named groups, 36 colors), `BRUSH_SIZES` (5), `ERASER_SIZES` (3), storage keys, `MAX_HISTORY=20`, `SAVE_MAX=60`, `AUTOSAVE_INTERVAL_MS=60000` |
| **BRUSHES** | Map keyed by brush id. Each entry: `{ label, defaultSize, beginStroke(ctx,p,size,color), drawSegment(ctx,p0,p1,size,color) }`. Adding a 7th brush is two-line: entry here + button in DOM. |
| **CAPACITOR NATIVE BRIDGE** | `getCapacitor()`, `isNative()`, `nativePlugin(name)`, `rehydrateFromNativePrefs()`, `mirrorToNativePrefs()`, `setStorage()` / `removeStorage()` (write-through wrappers), `setupStatusBar()`, `hideSplashScreen()`, `nativeExport(rec)` (Filesystem + Share). |
| **STATE** | Single object. `screen`, `templateId/Name`, brush + size + color, smoothing buffer (`smoothX/Y`), drawing state, history stack, parent-gate flags, settings sub-object. |
| **AUDIO** | Lazy `ensureAudio()`. `sfxTap/Erase/Save/Swoosh` — all SFX-toggle-gated via `audioEnabled()`. |
| **CANVAS SETUP** | `setupCanvas()` resizes the backing store to `STAGE_W*dpr × STAGE_H*dpr` and rescales the 2D context. `getPos(e)` converts pointer coords to logical 800×800 units. |
| **HISTORY** | `pushHistory()` snapshots the canvas via `getImageData` before each stroke. |
| **DRAWING** | Pointer handlers delegate to the active brush. Midpoint-quadratic smoothing one layer above the brush API: pointer-down → set smoothX/Y = raw point + brush.beginStroke; pointer-move → drawSegment from smoothed to midpoint(last, current); pointer-up → drawSegment final raw segment so the line doesn't stop short of the finger. |
| **TEMPLATES** | `loadTemplate(tpl)` swaps line-art SVG, sets the title, clears the canvas, calls `tryRestoreInProgress(tpl.id)` to silently paint back any saved in-progress strokes for this template. |
| **UI BUILDERS** | `buildPicker`, `buildPaletteTabs`, `buildPalette`, `rebuildSizeButtons` (driven by tool), `attachToolHandlers`, `attachSettingsHandlers`. |
| **SCREENS** | `showScreen(name)` toggles `[hidden]` on the 5 screen containers, fires `sfxSwoosh`. Settings screen rebuilds toggle states on entry. |
| **SETTINGS** | `loadSettings()` / `persistSettings()` (via setStorage). `syncSettingsUI()` mirrors state → DOM. |
| **PARENT GATE** | `parentGate(label, onPass)` is the public entry point. Caches unlock state per session. `renderParentGate()` generates a random 2-digit addition + 3 distractors within ±10. Wrong shakes + shows feedback; cancel closes; correct fires the deferred callback. |
| **AUTOSAVE** | `persistInProgress()` writes `canvas.toDataURL()` + templateId to the in-progress key. Fires every 60s while strokes are pending, on visibilitychange-hidden, on beforeunload/pagehide. `tryRestoreInProgress(templateId)` paints back the saved PNG on template re-entry. `clearInProgress()` fires on SAVE (work graduated) and CLEAR (work discarded). |
| **TOASTS** | `showSavedToast` (every save, 1.4s) and `showFirstSaveToast` (one-shot ever, 2.4s, flagged via `tinyCanvas.firstSaveCelebrated.v1`). |
| **GALLERY** | `loadGallery` / `persistGallery` (via setStorage). `composePng()` renders canvas + line-art onto an offscreen 800×800 canvas → PNG dataURL. `saveDrawing()` writes the record + fires both toasts + clears in-progress. `openDetail`, `deleteCurrent` (parent-gated), `exportCurrent` (parent-gated; branches to nativeExport on iOS/Android, anchor-download on web). |
| **PWA** | `beforeinstallprompt` listener — reveals `#btnInstall` on the title screen. |
| **KEYBOARD** | Ctrl/Cmd+Z = undo (only on the draw screen). |
| **INIT** | `init()` is async: `await rehydrateFromNativePrefs()` → `loadSettings()` → builders → handlers → `startAutosave()` → `setupStatusBar()` + delayed `hideSplashScreen()`. |

## The drawing model

```
+------------------------------------+
|  .canvas-wrap (dark teal frame)    |
|  +------------------------------+  |
|  | #drawCanvas       z = 1      |  |   ← kid's strokes
|  | (paper background, 800x800   |  |
|  |  logical, DPR-scaled)        |  |
|  +------------------------------+  |
|  | .line-art (SVG overlay)      |  |   ← printed lines
|  |  pointer-events: none        |  |     (stay above strokes)
|  |  z = 2                       |  |
|  +------------------------------+  |
|  | .canvas-overlay-btn (undo)   |  |   ← floating control
|  |  z = 2                       |  |
|  +------------------------------+  |
+------------------------------------+
```

The line-art is `currentColor` so it inherits `var(--line-ink)` from
CSS — never re-stroke individual elements with explicit colors inside
the SVG.

## Adding a new template

Append to `window.TINY_CANVAS_TEMPLATES` in `templates.js`. Each entry
is `{ id, name, svg }`. The SVG must:

1. Use `viewBox="0 0 800 800"` (matches the canvas logical size).
2. Set `fill="none"`, `stroke="currentColor"`, `stroke-width="6-10"`,
   `stroke-linecap="round"`, `stroke-linejoin="round"` on the root
   `<svg>` — child elements inherit.
3. Have **no background fill** — the canvas's `--paper` color is the
   background; the SVG just draws lines on top.
4. Keep strokes thick enough that color stays cleanly enclosed at
   normal viewing size (6-10 stroke-width works at 800px logical).

The picker auto-discovers the array, so no other code change is needed.

## Adding a new brush

1. Add an entry to `BRUSHES` in `game.js`. Implement `beginStroke`
   (sets composite mode + lays the initial dot) and `drawSegment`
   (draws one segment of the stroke). See the existing 6 for the
   pattern. Pick a `defaultSize` that's a member of `BRUSH_SIZES`.
2. Add a button to `.tool-modes` in `index.html` with the matching
   `data-tool` attribute. The grid auto-rebalances; you may need to
   bump the `grid-template-columns` count on the tablet breakpoint
   if you go past 7.

That's it. Pointer handlers route to whichever brush state.currentTool
points at; smoothing wraps around the brush API.

## Capacitor setup (first-time, per machine)

You need **Node 18+**, **Xcode** (for iOS), **Android Studio** (for
Android), and **CocoaPods** (`brew install cocoapods` on macOS).

```bash
# from inside tiny-canvas/
npm install
npx cap add ios       # generates ios/ — commit it
npx cap add android   # generates android/ — commit it
npx cap sync          # copies the web build into the native projects
```

After that, day-to-day:

```bash
npx cap sync          # after any web change you want to test natively
npx cap open ios      # opens Xcode
npx cap open android  # opens Android Studio
```

### Icon + splash PNG generation

The icons in `icons/` are SVG sources. To rasterize all the device
sizes that iOS + Android require:

```bash
npm i -D @capacitor/assets
npx capacitor-assets generate \
    --iconBackgroundColor       '#06141a' \
    --iconBackgroundColorDark   '#06141a' \
    --splashBackgroundColor     '#06141a' \
    --splashBackgroundColorDark '#06141a'
```

This reads `icons/icon.svg` and `icons/splash.svg` and writes the
matrix into `ios/App/App/Assets.xcassets/` and
`android/app/src/main/res/mipmap-*/`. Re-run after any icon change.

The Android adaptive-icon foreground source is `icons/icon-foreground.svg`;
`@capacitor/assets` picks it up automatically when present.

## Screenshot capture

`scripts/capture-screenshots.js` is a Playwright-driven script that
walks the 5 core screens at 6 device profiles and dumps PNGs into
`screenshots/<profile>/`.

```bash
# from inside tiny-canvas/
npm i -D playwright
npx playwright install chromium

# in one terminal:
python3 -m http.server 8000

# in another terminal:
node scripts/capture-screenshots.js
```

Profiles produced:

| Folder | Use | Required by |
|---|---|---|
| `ios-6.9-iphone-pro-max` | App Store 6.9" required slot | **Apple** |
| `ios-6.1-iphone` | App Store 6.1" optional | Apple (recommended) |
| `ios-13-ipad-pro` | App Store iPad required slot | Apple (if iPad support) |
| `android-phone` | Play Store phone screenshots | **Google** |
| `android-7in-tablet` | Designed for Families 7" tablet | Google |
| `android-10in-tablet` | Designed for Families 10" tablet | Google |

Each folder gets 5 numbered PNGs: 01-title, 02-picker, 03-drawing,
04-gallery, 05-settings. Drag-drop these directly into the matching
App Store Connect / Play Console upload slot
(map in [`STORE_LISTING.md`](STORE_LISTING.md) §15).

## Things that bite

- **DPR scaling matters.** The canvas backing store is `STAGE_W*dpr ×
  STAGE_H*dpr`, the 2D context is scaled by DPR, and pointer coords
  are normalized in `getPos()` to logical 800×800 space.
- **`getImageData` can throw** under cross-origin / taint rules. The
  history code wraps it in try/catch.
- **`composePng()` is async** because it inline-renders the SVG via a
  Blob URL → Image roundtrip. Only `await` it on save.
- **Audio is gesture-gated.** First `pointerdown` / `keydown` unlocks
  the `AudioContext`. Title-screen audio is silent until the first
  tap.
- **`localStorage` is capped** (~5MB). 60 PNGs at ~25KB each = 1.5MB
  — fits comfortably. On native, writes mirror to Preferences which
  has higher caps.
- **Auto-save dirty flag is set on pointerdown.** A long drawing session
  with many strokes triggers persist every 60s when something dirty
  is pending; idle sessions don't write.
- **Parent gate `parentGateUnlocked` persists ONLY for the session.**
  Closing the app or reloading the web build re-locks. This matches
  Apple's documented Kids-category requirement.
- **Brushes that texture (CRAYON, PAINT, GLITTER) stamp multiple dabs
  per segment.** Performance was tested on iPhone 8-class hardware
  but if drawing slows on very-low-end Android, the dab counts in
  CRAYON's `_stampDot` and GLITTER's `_sparkles` are the knobs.
- **PAINT brush soft edges aren't from the canvas filter** — they're
  three stacked passes at different widths/alphas. Don't replace
  with a CSS filter or compositor blur — the edge has to be baked
  into the bitmap for save/export to capture it.
- **`viewport-fit=cover` is set** but `user-scalable=no` is **not** —
  unlike Pootery. We allow pinch-zoom so kids can get close to a
  specific area of a coloring page. Capacitor's iOS WebView respects
  this.

---

# v1.0 SHIPPING CHECKLIST

Everything below requires **your** terminal, accounts, or
hardware. Tiny Canvas v1.0 in this repo is feature-complete; this
checklist closes the gap between "code is ready" and "store listings
are live."

## A. Accounts & legal entities

- [ ] **Apple Developer Program** active ($99/yr).
      https://developer.apple.com/programs/
- [ ] **D-U-N-S number** for Mad Sundar LLC (free from Dun &
      Bradstreet; required for organization-type Apple Developer
      account; takes 1-3 business days).
- [ ] **Google Play Developer account** active ($25 one-time).
      https://play.google.com/console/
- [ ] **Bank info + tax forms** filed in both consoles (required even
      for free apps).
- [ ] **support@madderverse.org** email is live and you can read it.
      Privacy policy + Terms list it as the contact address; Apple +
      Google check this during review.

## B. Hosted policy pages

- [ ] Push `tiny-canvas/legal/privacy.html` to main → GitHub Pages
      serves it at `https://madderverse.org/tiny-canvas/legal/privacy.html`.
- [ ] Push `tiny-canvas/legal/terms.html` similarly.
- [ ] Verify both URLs load in a normal browser before submission.
      Apple's reviewer WILL click these.

## C. Capacitor native projects

From `tiny-canvas/`:

- [ ] `npm install` succeeds (Node 18+, may need Xcode CLT on macOS).
- [ ] `npx cap add ios` succeeds — generates `ios/` directory.
      Commit it to main.
- [ ] `npx cap add android` succeeds — generates `android/` directory.
      Commit it to main.
- [ ] `npx cap sync` runs cleanly (no plugin link warnings).

## D. Bundle / package identifiers

- [ ] Verify `capacitor.config.json` has `appId:
      "org.madderverse.tinycanvas"`. This MUST match the bundle ID
      you register in App Store Connect and the application ID in
      Play Console. Once published, you cannot change it.
- [ ] In Xcode (`ios/App/App.xcodeproj`): set the Team to your Apple
      Developer Team ID. Verify the Bundle Identifier matches.
- [ ] In Android Studio: verify `android/app/build.gradle`
      `applicationId` matches `org.madderverse.tinycanvas`.

## E. App icon + splash raster generation

- [ ] `npm i -D @capacitor/assets`
- [ ] `npx capacitor-assets generate --iconBackgroundColor '#06141a'
      --iconBackgroundColorDark '#06141a' --splashBackgroundColor
      '#06141a' --splashBackgroundColorDark '#06141a'`
- [ ] Verify `ios/App/App/Assets.xcassets/AppIcon.appiconset/` has
      a complete set including the 1024×1024 Marketing icon (no
      transparency, no rounded corners — Apple masks them).
- [ ] Verify `android/app/src/main/res/mipmap-*/` got both the
      adaptive icon foreground + background pair.
- [ ] Open the Xcode project, run on a simulator — eyeball the home
      screen icon. Same for an Android emulator.

## F. Android signing key (CRITICAL, ONE-WAY DOOR)

The release keystore signs every Play Store update for the life of
the app. If you lose it, you cannot publish updates as the same app
— you must start fresh under a new application ID.

- [ ] Generate the keystore:
      ```bash
      keytool -genkey -v -keystore tiny-canvas-release.jks \
              -keyalg RSA -keysize 2048 -validity 10000 \
              -alias tinycanvas
      ```
- [ ] **Back up the .jks file to TWO physically separate locations**
      (e.g. encrypted USB drive in a different room + a password
      manager attachment).
- [ ] Record the keystore password, key alias, and key password in
      a password manager. Do NOT lose these.
- [ ] Do NOT commit the .jks file to git. Add it to `.gitignore`
      explicitly if it's anywhere in the worktree:
      ```
      *.jks
      *.keystore
      ```
- [ ] Configure `android/app/build.gradle` to sign release builds
      with the keystore. Reference Capacitor docs for the exact
      syntax: https://capacitorjs.com/docs/android/configuration

## G. iOS signing

Apple handles iOS signing automatically once the team is set in
Xcode. Worth verifying once:

- [ ] In Xcode → Target App → Signing & Capabilities:
      "Automatically manage signing" is on, Team is your Apple
      Developer Team.
- [ ] Build → Archive succeeds (Product → Archive in Xcode menu).

## H. TestFlight (iOS) / Internal Testing (Android)

Both stores let you push a build to a small group BEFORE submitting
for public review. Do this first.

- [ ] iOS: archive in Xcode → distribute via App Store Connect →
      wait for processing (~10-30 min) → invite yourself and one or
      two trusted testers via TestFlight.
- [ ] Android: in Android Studio → Build → Generate Signed Bundle
      (AAB format) → upload to Play Console → Internal testing
      track → invite testers.
- [ ] Install on a real iPhone + a real Android device. Tap through
      every screen, draw on every template, confirm the parent gate
      fires on the home button + DELETE + EXPORT, confirm Save to
      Photos works on iOS (the system share sheet should show "Save
      to Photos").
- [ ] Open Settings, toggle SFX off — confirm no sound on subsequent
      strokes.
- [ ] Background the app mid-drawing, reopen — confirm strokes
      restored on the same template.

## I. Store listing setup

From [`STORE_LISTING.md`](STORE_LISTING.md), paste-ready:

- [ ] App name, subtitle, descriptions, keywords entered in App
      Store Connect.
- [ ] App name, short description, full description, tags entered
      in Play Console.
- [ ] Age rating questionnaires completed on both stores → result
      shows 4+ (Apple) / Everyone (Google).
- [ ] Privacy policy URL field on both stores = the live madderverse.org
      URL.
- [ ] Apple "App Privacy" section answered: **Data Not Collected**.
- [ ] Google Play "Data safety" section answered: **No data collected,
      no data shared**.
- [ ] Copyright string: `© 2026 Mad Sundar LLC`.

## J. Screenshots

From `scripts/capture-screenshots.js`:

- [ ] `npm i -D playwright && npx playwright install chromium`
- [ ] In one terminal: `python3 -m http.server 8000`
- [ ] In another terminal: `node scripts/capture-screenshots.js`
- [ ] Review the 6 profile folders in `tiny-canvas/screenshots/`.
      Each has 5 PNGs (title / picker / drawing / gallery / settings).
- [ ] Drag-drop into matching App Store Connect / Play Console
      upload slot. Map: `STORE_LISTING.md` §15.
- [ ] Play Console also requires a 1024×500 feature graphic — crop
      a portion of `icons/splash.svg` rasterized at 2048×1000 then
      crop-fit. (Or design a fresh wide banner — fine to defer if
      you want.)

## K. Compliance smoke test (before tapping Submit)

- [ ] **No third-party SDK loads.** Open the deployed web app in
      DevTools → Network tab → reload. The only outbound requests
      should be: fonts.googleapis.com / fonts.gstatic.com (Bungee,
      VT323, Press Start 2P). NO GoatCounter, NO analytics, NO ads.
- [ ] **Parent gate works** on home button + DELETE + EXPORT.
- [ ] **All external links are gated.** Tap each footer link with the
      gate locked — should fire.
- [ ] **No IAP, no signed-in account, no leaderboard, no chat.**
      Apple Kids category will reject these.
- [ ] **Privacy policy + Terms pages load** at the URLs you submitted.

## L. Submit

- [ ] iOS: in App Store Connect → Add for Review → Submit for Review.
      Expect 24-72 hours for first review. Be ready to respond to
      reviewer questions (parent gate is the most likely thing they
      ask about).
- [ ] Android: in Play Console → Production track → Send for review.
      Expect 1-7 days. Designed for Families review is stricter than
      regular Play review.

---

## Roadmap (v1.1+)

Things v1.0 deferred:

1. **Stamps** — the user's spec called for 60+ stamps, deferred per
   user instruction. Whole new tool category. Implementation pattern:
   add `STAMPS` array (parallel to BRUSHES), tool button that switches
   to a "stamp" mode where pointer-down places the stamp SVG at the
   coords instead of drawing a stroke.
2. **Onboarding** — wordless first-launch tour. Storage flag tracks
   if it's been seen. Not required for App Store approval; UX win.
3. **Music** — the disabled toggle in Settings is shipped UI for
   this. Likely approach: ambient Tone.js-style synth loop, very
   quiet (~0.04 gain), togglable.
4. **More templates** — aim for 30-40 in v1.2.
5. **Native save-to-photo-library directly** (skip share sheet) —
   requires adding `@capacitor-community/camera-preview` or building
   a tiny custom plugin. Share-sheet path works for v1.0.
6. **Cover.jpg for the hub** — currently missing from `tiny-canvas/`.
   The hub already has the game card linking here (committed
   2026-05-14 as `5ad3773`).
7. **Localization** — the locale stub in Settings is shipped UI. Add
   a locale dictionary + i18n wrapper around all visible strings.
8. **More brushes** — spray, smudge, fill bucket.
9. **Color picker** — full-spectrum picker as a power-user option
   beyond the 36 grouped colors.
