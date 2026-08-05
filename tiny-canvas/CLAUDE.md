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
- **35 line-art templates** (BLANK + 34 themed pages): smiley sun,
  cat, rocket, fish, house, dog, bear, butterfly, bird, car, airplane,
  truck, unicorn, dragon, castle, donut, ice cream, dinosaur, robot,
  snowflake, flower, tree, rainbow, cupcake, hot-air balloon, sailboat,
  train, frog, owl, turtle, ladybug, penguin, mushroom, crab. Each is a
  `viewBox="0 0 800 800"` SVG drawn in `currentColor` strokes; rendered
  as a `pointer-events: none` overlay above the kid's canvas so the kid
  colors UNDER the lines.
- **Templates must be built from CLOSED shapes.** The fill tool
  rasterizes this SVG into a boundary mask, so any gap in a path lets
  fill escape into the rest of the page. Prefer `<circle>`, `<ellipse>`,
  `<rect>` and paths ending in `Z`; an open polyline is fine only for
  decoration that isn't meant to hold colour (a ground line, a rope).
  A line drawn ACROSS an enclosed shape is a useful trick — it splits
  that shape into separate fill zones (the cupcake pleats, the turtle
  shell segments, the balloon panels all use this).
- **6 distinct brushes** (PEN / MARKER / CRAYON / PENCIL / PAINT /
  GLITTER), each with its own beginStroke + drawSegment + textural
  feel. Plus ERASER, plus the FILL bucket.
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
  toggle, locale stub (English only for v1, designed for future
  expansion).
- **Web Audio synthesized SFX** (tap / save / erase / swoosh) **and a
  synthesized ambient music bed**. No audio files at all — the music is
  four detuned voices on a pentatonic chord, each breathing on its own
  slow LFO through a lowpass, with no scheduler (so nothing drifts out
  of sync over a long session). Default OFF, 4s fade-in, stops on
  visibilitychange. Generating it rather than shipping a track also
  keeps this clear of the licensing trap Slip Studio hit, where a stock
  -music subscription turned out not to cover an app with a music
  toggle — see the root CLAUDE.md.
- **Self-hosted fonts** in `assets/fonts/` (Bungee, VT323, Press Start
  2P as woff2, 74.7KB total). Deliberately NOT fonts.googleapis.com: a
  CDN font breaks the offline promise, and hands Google the client IP
  on every launch, which contradicts this app's "no data collected"
  Data Safety declaration. See `style.css` §0.
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
  templates.js            # window.TINY_CANVAS_TEMPLATES — 35 SVG pages
  manifest.webmanifest    # PWA manifest, theme-color #ff2e88

  assets/
    fonts/                # self-hosted woff2 — bungee-latin,
                          # vt323, press-start-2p (74.7KB total).
                          # Do NOT move these back to a CDN.

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
| **CONFIG** | `STAGE_W`/`STAGE_H` (set at runtime from the canvas's own box — NOT constants, see CANVAS SETUP), `COLOR_GROUPS` (5 named groups, 36 colors), `BRUSH_SIZES` (5), `ERASER_SIZES` (3), storage keys, `MAX_HISTORY=30`, `HISTORY_BYTE_BUDGET=24MB`, `STROKE_BOUNDS_SLACK=12`, `SAVE_MAX=60`, `AUTOSAVE_INTERVAL_MS=60000` |
| **BRUSHES** | Map keyed by brush id. Each entry: `{ label, defaultSize, beginStroke(ctx,p,size,color), drawSegment(ctx,p0,p1,size,color) }`. Adding a brush is two-line: entry here + button in DOM. **`fill` lives in this table but is not a stroke tool** — it has no beginStroke/drawSegment and is flagged `sizeless: true`; `onPointerDown` intercepts it before the stroke path. It's in the table only so the tool button, active-state refresh and tool-switch handler all work off one list. |
| **MUSIC** | `MUSIC_VOICES` / `startMusic` / `stopMusic` / `syncMusic`. Synthesized ambient bed, no audio files, default off. |
| **CAPACITOR NATIVE BRIDGE** | `getCapacitor()`, `isNative()`, `nativePlugin(name)`, `rehydrateFromNativePrefs()`, `mirrorToNativePrefs()`, `setStorage()` / `removeStorage()` (write-through wrappers), `setupStatusBar()`, `hideSplashScreen()`, `nativeExport(rec)` (Filesystem + Share). |
| **STATE** | Single object. `screen`, `templateId/Name`, brush + size + color, smoothing buffer (`smoothX/Y`), drawing state, history stack, parent-gate flags, settings sub-object. |
| **AUDIO** | Lazy `ensureAudio()`. `sfxTap/Erase/Save/Swoosh` — all SFX-toggle-gated via `audioEnabled()`. |
| **CANVAS SETUP** | `setupCanvas()` measures the canvas's **own laid-out box** (falling back to `innerWidth`/`innerHeight` only when it has none yet, i.e. the draw screen is still hidden at init), sets `STAGE_W`/`STAGE_H` from it, resizes the backing store to `STAGE_W*dpr × STAGE_H*dpr` and rescales the context. `getPos(e)` maps pointer coords into logical canvas space off that same box. **Both must derive from the same measurement** — see "Things that bite". |
| **FILL MASK** | `buildFillMask()` rasterizes the line-art SVG into a 1-byte-per-pixel boundary mask aligned to the canvas, `floodFillAt()` scanline-fills the tapped region against it. `fillGeomKey()` fingerprints every geometry input (canvas size, svg rect, template id) so a stale mask rebuilds itself. Boundary threshold `FILL_BOUNDARY_ALPHA=96` — high on purpose so fill runs *under* the antialiased stroke skirt and leaves no pale halo; the line art draws on top, so the underlap is invisible. |
| **HISTORY** | Dirty-rect patches, not full snapshots. `beginHistoryCapture()` blits the canvas into an offscreen buffer (cheap, no encode); the stroke path grows a bounding box via `growBounds`; `commitHistory()` keeps only that rectangle as raw `ImageData`. `undo()` is synchronous (`putImageData`). See "Things that bite" for why the box needs slack. |
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
|  #drawCanvas          z = 1        |   ← kid's strokes
|  (viewport-sized, DPR-scaled)      |
+------------------------------------+
|  #lineArt (SVG overlay)   z = 2    |   ← printed lines
|  pointer-events: none              |     (stay above strokes)
|  viewBox 0 0 800 800, letterboxed  |
+------------------------------------+
|  .canvas-overlay-btn      z = 2    |   ← floating controls
|  (undo, PAGES)                     |
+------------------------------------+

        ... and off-screen, never composited:

  fillMask  Uint8Array, 1 byte/px      ← the SAME line art,
  aligned to the canvas backing store    rasterized as a
                                         boundary mask
```

The line-art is `currentColor` so it inherits `var(--line-ink)` from
CSS — never re-stroke individual elements with explicit colors inside
the SVG.

**The consequence of this layering is the whole reason the fill tool is
built the way it is.** The lines live in an SVG *above* the canvas, so
the canvas bitmap contains no line information whatsoever — a naive
flood fill on it would bleed straight across the page. Hence the
separate rasterized mask. It also means fill never depends on what the
kid already drew: tapping a region always fills that region, whatever
is in it.

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
5. **Draw every colourable feature as a CLOSED shape.** This is the one
   that gets missed. An open `<line>` or a path without `Z` still
   *looks* right — it just can't hold colour, so the feature is dead to
   the fill tool. The snowflake shipped with eight arms made of bare
   lines and had exactly 2 fillable regions; the smiley sun's eight rays
   were `<line>`s; the fish's fins were open curves. All three read fine
   to the eye and were useless to a bucket.
   Genuinely-open strokes are still correct for things that shouldn't
   hold colour — a mouth, a ground line, the sailboat's waves, the
   fish's scale arcs. The test is "would a kid want to colour this
   separately?"

### Auditing a page for fillable regions

Don't eyeball it. Rasterize the SVG and count connected components of
non-boundary pixels — that is exactly what the fill tool sees:

```js
// in the browser console on the draw screen
const t = TINY_CANVAS_TEMPLATES.find(x => x.id === 'donut');
// rasterize t.svg to an offscreen canvas at 700x700, threshold
// alpha >= 96 into a mask, then flood-fill each unvisited non-mask
// pixel and count regions that do NOT touch the canvas edge.
```

Two things this catches that reading the SVG does not:

- **A feature that appears separated but isn't.** The fish's gill arc
  stopped ~18px short of the body outline at both ends, so the "head"
  it appears to divide off was not actually a separate region.
- **Shapes that attach at a coordinate that doesn't quite meet.** A
  sub-pixel mismatch where a leaflet joins a shaft opens a gap the fill
  escapes through, merging two cells into one.

Current baseline: **34 drawable pages, 406 fillable regions, median 11
per page**, no leaks. If a page you add lands at 3-4 regions, look for
open strokes before assuming it's just a simple drawing.

When closing a curve into a ribbon (the donut's icing drizzles), offset
the source curve both ways rather than hand-drawing a second edge: move
the endpoints along their own tangent normals and put the control point
at the **intersection of the two offset tangent lines**. That keeps the
offset tangent to the original at both ends so the ribbon holds an even
width. Offsetting the control point along a single normal pinches it in
the middle.

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

- **⚠ `window.innerWidth` is NOT the canvas's width, and assuming it is
  was a real shipped bug.** `setupCanvas()` used to size the backing
  store from `innerWidth`/`innerHeight` while the element laid out
  narrower — a desktop scrollbar is enough, and a WebView inset does it
  vertically. That made `canvas.width / rect.width` **2.117 when dpr was
  2**, and everything that assumed the ratio *was* dpr silently landed
  in the wrong place:
  - `buildFillMask()` positioned the mask by the true ratio while
    `floodFillAt()` seeded by dpr. They disagreed by 10px horizontally
    and **46px vertically** — enough to seed fills in the wrong region,
    which from the outside looks exactly like "the coloring page leaks."
    Hours went into auditing templates before the cause turned out to be
    here.
  - Every brush stroke was compressed toward the top-left. At the edge
    of the screen the line landed ~10px from the finger.

  Both `setupCanvas()` and `getPos()` now derive from
  `canvas.getBoundingClientRect()`. **Keep them deriving from one
  measurement.** If you add another consumer of canvas geometry, do not
  reach for `devicePixelRatio` or `innerWidth` — ask the canvas.
- **A stale fill mask fails silently, so the mask self-validates.**
  Explicit invalidation on template-load and resize is not enough: the
  mask is positioned from the *live* svg rect against the *live* backing
  store, so any layout shift that doesn't route through `setupCanvas()`
  leaves a mask that still looks valid and is drawn in the wrong place.
  `fillGeomKey()` re-measures on every fill and rebuilds on any change.
  Cheap; the alternative is unfalsifiable bug reports about leaking
  pages.
- **Undo's dirty rect needs slack around the stroke.** Several brushes
  paint wider than their nominal nib — glitter throws sparkles out to
  `size/2 + ~2.4`, paint stacks passes wider than the line. Anything
  drawn outside the recorded rectangle **survives the undo as a stray
  mark**. `STROKE_BOUNDS_SLACK = 12` logical px covers the current set;
  a new brush that scatters further must raise it.
- **`getImageData` can throw** under cross-origin / taint rules. The
  history and fill code wrap it in try/catch.
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
- **Bump `?v=N` in `index.html` on EVERY change** to `style.css`,
  `templates.js` or `game.js` (currently **v12**). Without it the
  browser serves a stale `game.js` against a fresh `index.html` and the
  change reads as "did nothing" — the same trap Slip Studio and
  Florigami both hit. Note that a hard-reload which refetches
  subresources does **not** necessarily refetch the *document*: if the
  cached `index.html` still says `?v=11` you keep getting the old
  bundle. Load `/?cb=<anything>` to bust the document itself.
- **`requestAnimationFrame` is paused when the page isn't compositing.**
  The resize handler rebuilds the backing store inside a rAF callback,
  so in a hidden/headless preview pane it never fires and the canvas
  stays stale relative to the layout — which then misaligns the fill
  mask and mimics a template leak. This is a harness artifact, not an
  app bug, but it will waste your afternoon. Same issue Slip Studio
  documents. If the viewport reports `innerWidth === 0`, nothing has
  laid out and no geometry assertion means anything; give the pane a
  real size first.
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

## Android build (sideload) — and what does NOT survive a regenerate

**`android/` is not committed**, matching every other Madderverse app
(`slip-studio-app/`, `pootery-app/`, `cookie-cache-app/`,
`all-munkis-app/` all keep the Capacitor wrap outside git). So the
native project is disposable — but two hand-applied fixes go with it,
and both fail *silently*:

**1. `android/app/src/main/res/values/colors.xml` must be recreated.**
`npx @capacitor/assets generate` rewrites `res/values/` and **deletes**
the `colors.xml` the Capacitor template ships — while `styles.xml` still
references `@color/colorPrimaryDark`. Builds keep working only because
stale merged resources under `android/app/build/` still carry the value;
a clean checkout fails outright. `colorPrimaryDark` is also the
status-bar colour at targetSdk 34, so without it the bar above the app
renders Capacitor's grey-blue instead of the app's near-black teal:

```xml
<!-- android/app/src/main/res/values/colors.xml -->
<resources>
    <color name="colorPrimary">#06141a</color>
    <color name="colorPrimaryDark">#06141a</color>
    <color name="colorAccent">#ff2e88</color>
</resources>
```

**2. Signing config**, once a release keystore exists (see below).

### Full sideload recipe

```bash
npm install
node scripts/build-www.mjs        # stage www/ — NEVER set webDir to "."
npx cap add android               # only if android/ is absent
# rasterize icons/*.svg to .assetsrc/{icon,icon-foreground,splash}.png at 1024
npx @capacitor/assets generate --android --assetPath .assetsrc \
    --iconBackgroundColor '#06141a' --splashBackgroundColor '#06141a'
# >>> recreate colors.xml here — see above <<<
npx cap copy android
cd android && JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot" \
    ./gradlew assembleDebug --console=plain
# -> app/build/outputs/apk/debug/app-debug.apk
```

**`assembleDebug` for sideloading, deliberately.** A test build has no
business generating the release keystore — that is a one-way door (§F)
and there is no reason to burn it before an actual upload.
`assembleRelease` needs the signing flags; an AAB is not installable.

**JDK 21 must be pinned** — the machine default is 17 and Gradle fails
with `invalid source release: 21`.

**Sanity-check the payload after building**, because `webDir` mistakes
are invisible until someone inspects the APK:

```bash
unzip -l app-debug.apk | grep assets/public
```

It should list only `index.html`, `game.js`, `templates.js`,
`style.css`, `manifest.webmanifest`, `assets/fonts/*`, `icons/*`,
`legal/*`, plus Capacitor's own `cordova.js` / `cordova_plugins.js`.
Anything else — `CLAUDE.md`, `cover.jpg`, `node_modules/` — means the
staging step was bypassed.

## F. Android signing key — DONE (2026-08-05)

**The upload keystore exists. Do not generate another one.**

```
  keystore : android/app/tiny-canvas-release.keystore   (PKCS12, 10000 days)
  props    : android/keystore.properties                (gitignored)
  alias    : tinycanvas
  store pw : tinycanvas_2026_release
  key pw   : tinycanvas_2026_release
  DN       : CN=Tiny Canvas, OU=Mad Sundar LLC, O=Mad Sundar LLC, C=US
  SHA256   : 5B:08:5A:48:7C:05:A3:A8:B9:CB:0C:E0:B3:11:E6:70:
             77:C7:BF:DA:07:C5:B0:B5:1E:02:BA:9B:6C:0D:84:25
```

**No `L=` / `ST=` fields, deliberately** — the older Pootery and Slip
Studio keystores carry a Minneapolis/Minnesota decoy that is not Onion's
location; All Munkis already dropped them and this follows All Munkis.

**Backed up to `~/Keystore-Backups/tiny-canvas/`** (keystore, properties
and a README with these details). That backup is the ONLY durable copy —
`android/` is untracked and both files are gitignored. Losing it means
the listing can never be updated again; you would have to republish
under a new package id and lose installs and reviews. Put a second copy
somewhere physically separate.

`app/build.gradle` reads the creds from `android/keystore.properties`
via a `signingConfigs.release` block, the same shape all-munkis uses,
and bails safely when the file is absent so debug builds still work on a
machine without the keystore.

### Release builds

```bash
node scripts/build-www.mjs && npx cap copy android
cd android && JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot"     ./gradlew assembleRelease bundleRelease --console=plain
#   APK (sideload/testing) -> app/build/outputs/apk/release/app-release.apk
#   AAB (Play upload)      -> app/build/outputs/bundle/release/app-release.aab
```

Bump `versionCode` (and `versionName`) in `android/app/build.gradle`
before every Play upload. Verify a build actually got signed with:

```bash
jarsigner -verify -verbose:summary -certs app-release.aab | grep CN=
```

## F2. Play Console steps (still to do, user-side)

**Application ID: `org.madderverse.tinycanvas` — DECIDED 2026-08-04,
don't relitigate.** That is the `org.madderverse.*` namespace, i.e. the
**Mad Sundar LLC** dev account, matching Pootery and Slip Studio.

It is deliberately NOT the `com.onionmadder.*` namespace that All Munkis
(`com.onionmadder.munkis`) and mComic '96 (`com.onionmadder.mcomic`)
moved to. Those went to Onion's personal dev account, and Play does not
let two accounts share a package id — so this choice picks the account
too, and it cannot be changed after the first upload without shipping as
a brand-new listing. `capacitor.config.json` and `STORE_LISTING.md`
already agree; if you change one, change all three.

The release keystore signs every Play Store update for the life of
the app. If you lose it, you cannot publish updates as the same app
— you must start fresh under a new application ID.

- [ ] Generate the keystore:
      ```bash
      keytool -genkey -v -keystore tiny-canvas-release.jks \
              -keyalg RSA -keysize 2048 -validity 10000 \
              -alias tinycanvas
      ```
- [ ] **Give the DN no `L=` / `ST=` fields.** The older Mad Sundar
      keystores (Pootery, Slip Studio) carry `L=Minneapolis,
      ST=Minnesota`, which is a decoy and *not* Onion's location — the
      root CLAUDE.md warns never to repeat those values as her location
      anywhere. The newer All Munkis keystore dropped them entirely
      (`CN=All Munkis, O=Onion Madder, C=US`). Follow All Munkis, not
      the older pair: a DN with no location can't leak one. So:
      `CN=Tiny Canvas, OU=Mad Sundar LLC, O=Mad Sundar LLC, C=US`.
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

## Roadmap

### Shipped since the v1.0 checklist was written (2026-08-04)

Don't re-plan these — they're done and verified:

- **FILL bucket** — mask-based tap-to-fill. The single biggest
  functional gap for a colouring app; kids under ~6 can't keep a brush
  inside lines.
- **First-run onboarding** — coach marks, gated per screen, replayable.
- **Templates 21 → 35**, and every page audited for fillable regions
  (snowflake rebuilt from 2 regions to 37; smiley sun 3 → 11; fish
  4 → 8; donut 3 → 7).
- **Music** — synthesized ambient bed, replacing the disabled toggle.
- **Colour picker** — native `<input type="color">` beside the 36
  presets.
- **Self-hosted fonts** — no more fonts.googleapis.com.
- **Undo rebuilt** — dirty-rect patches instead of full-canvas PNG
  dataURLs; depth 12 → 30; synchronous. **CLEAR is now undoable**, which
  it never was: the handler called `pushHistory()` and then
  `clearCanvas()` wiped the entry it had just pushed, so an accidental
  CLEAR destroyed the drawing outright.

### Still open

1. **Stamps** — the spec called for 60+, still deferred. Whole new tool
   category. Implementation pattern: `STAMPS` array parallel to
   `BRUSHES`, tool button switching to a mode where pointer-down places
   the stamp SVG instead of drawing a stroke.
2. **More templates** — 35 now; more is always better for a colouring
   app. Read the region-audit section above before authoring.
3. **Native save-to-photo-library directly** (skip share sheet) —
   requires `@capacitor-community/camera-preview` or a small custom
   plugin. Share-sheet path works.
4. **Cover.jpg for the hub** — still missing from `tiny-canvas/`.
5. **Localization** — the locale stub in Settings is shipped UI. Add a
   locale dictionary + i18n wrapper around all visible strings.
6. **More brushes** — spray, smudge.
7. **Rotation / orientation-change behaviour is UNVERIFIED.** The
   resize path rebuilds the backing store inside a `requestAnimationFrame`
   callback, which never fires in a non-compositing preview, so this
   could not be exercised. Needs a real device.
