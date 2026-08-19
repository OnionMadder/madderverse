# Tiny Canvas — game/app-level guide

A polished kids coloring app. Pick a page, color it in, save it.
Shipping to **App Store + Google Play + the web**, all from one codebase
via Capacitor.

## Where things stand (2026-08-05)

- **Web build is LIVE and advertised** at madderverse.org/tiny-canvas/,
  on the hub grid since 2026-08-04. Cache-bust is at **?v=71** — bump it
  on every change to style.css / templates.js / game.js.
- **RAINBOW moved from Pro to free (2026-08-14) and the confusingly-
  co-named RAINBOW palette group was renamed BRIGHTS.** Bala (5),
  testing on the paid Android app, tapped the RAINBOW palette tab
  expecting rainbow strokes and got a colour-selector swap; two things
  labelled RAINBOW in the same tray (the brush *does* draw rainbow,
  the palette tab *doesn't*) was a real UX trap for early readers. The
  fix in one change: (1) the palette group id `rainbow` → `brights`
  (label BRIGHTS) so the word RAINBOW no longer appears twice in the
  tray, (2) the RAINBOW brush's `data-pro hidden` removed in
  index.html so it shows on locked native builds, (3) `BRUSH_IDS`
  reordered so the three remaining Pro brushes read together (SPRAY /
  GLOW / SMUDGE). Existing users with `colorGroup: "rainbow"` in
  localStorage auto-migrate via `activeColorGroup()`'s
  first-available-group fallback — no schema bump. Free brush set is
  now CRAYON / GLITTER / RAINBOW; Pro is SPRAY / GLOW / SMUDGE +
  everything else. Every notice below that still says "4 Pro brushes"
  is historical narrative from before this change.
- **⭐ Color-by-number engine REBUILT (2026-08-18) and the whole
  8-page pack is now authored.** The 2026-08-09 engine proved the
  mechanic and then sat on three measured geometry bugs. All three are
  fixed; if you remember anything about centroids,
  `CBN_MIN_REGION_PX`, a 40-region cap or reference PNGs, it is gone.

  **What was wrong** (measured against the shipped art, not guessed):
  1. **Numbers were positioned in the wrong coordinate space.** Labels
     were placed as a percentage of `#cbnLabels`, which was sized to
     `.line-art`'s CONTAINER (94vw x 78vh), while the coordinates were
     fractions of the CANVAS backing store — and the artwork
     letterboxes inside that container, making three different
     rectangles treated as one. They agreed at dead centre and drifted
     to **~39 px off at quarter height**.
  2. **The centroid is frequently not inside its own region.** A
     background that wraps around a subject has its centre of mass on
     the subject. **39 of 135 regions across the 8 pages put their
     number outside their own shape** (12 of 17 on cactus, 6 of 9 on
     rainbow). `cbnResolveTap` used the same anchor as a
     nearest-centroid guess, so the "did you use the right colour"
     check was wrong for exactly those regions.
  3. **Every badge was a fixed 12px/20px pill.** Region sizes are not
     remotely uniform — the median cactus region has an inscribed
     radius of 0.63% of page width, about 6 px on a phone, wearing a
     26x20 px badge. At 1x on a phone only 2–11 of a page's regions
     could show a readable number; the rest were unreadable
     overlapping pills.

  **Root cause:** regions were derived at runtime from the FILL MASK,
  which is rasterized at viewport resolution against the artwork's
  CURRENT on-screen rect. So region identity changed with the window
  size AND with zoom (at 4x the mask is a crop of the zoomed art). CBN
  cannot be built on it. Two more bugs fell out of the same cause: a
  fixed 400-device-px area floor meant **a phone and a desktop
  detected different region sets on the same page**, and the resize
  handler never re-synced CBN, leaving hit-testing on stale
  coordinates while the labels still looked fine.

- **`cbn-core.js` is the new shared region model** — a third top-level
  script, loaded BEFORE game.js, and **also loaded by
  `tools/cbn-editor.html`, so the editor and the game cannot disagree
  about what a region is**. It rasterizes the source PNG once at a
  FIXED working width (`WORK_W` 1024), independent of viewport, zoom
  and device, then:
  - labels connected components, **keeping the per-pixel label map**
    (`Int16Array`) — that map is what makes tap lookup an exact O(1)
    read instead of a distance heuristic;
  - runs a chamfer 3-4 distance transform and takes each region's
    **pole of inaccessibility** (centre of the largest inscribed
    circle) as its anchor. **Verified 0 of 135 anchors outside their
    own region**, against 39 with centroids;
  - emits a normalized inscribed radius per region, which is what lets
    the runtime size a number to its region.

  The area floor is `MIN_AREA_FRAC` — a fraction of page area, not a
  pixel count, which is what fixes the resolution dependence.
  `MAX_REGIONS` is 120 and is a runaway guard, not a design limit; the
  old cap of 40 silently truncated real regions off the end of a page.

- **Numbers size themselves, and hide when they cannot fit.**
  `cbnSyncLabels` derives each badge's font size from its region's
  on-screen inscribed radius, clamped to 9–26 px, written in layout px
  so the `#zoomLayer` transform scales it correctly. Below a
  legibility floor the label is **not drawn at all**, and reappears as
  the kid zooms in — which is what Onion asked for ("they should scale
  when you zoom to color small spaces"). Measured on cbn-sun at phone
  size: **4 of 36 numbers at 1x, 18 at 1.5x, 28 at 2.25x, 32 at 3.4x,
  all 36 by 5x**, zero misplaced at any level, placement error
  **0.039 px** (was ~39 px).
- **`ZOOM_MAX_CBN` = 8; freehand pages keep 4.** Measured: the
  smallest cactus region needs 6.5x on a phone before it can hold a
  digit, so at the old 4x ceiling those numbers were permanently
  invisible. `zoomMax()` picks the ceiling and
  `applyView` / `zoomAt` / `syncZoomButtons` all route through it.
- **A `N / M` progress pill** (`#cbnProgress`, left rail under the
  zoom buttons) is **load-bearing, not decoration** — because small
  numbers hide themselves, a kid can be looking at a page with no
  visible numbers left that is not finished. Completion persists too:
  `rec.cbn.done` rides the in-progress record as region ids (which are
  deterministic from the artwork), restored by `cbnRestoreDone`. And
  **fill-erasing a correct region un-completes it** and brings the
  number back — `floodFillEraseAt` had no CBN awareness at all before.
- **Two ordering bugs found during verification, both real and both
  silent.** Worth knowing, because they will bite anything else that
  measures the artwork:
  1. **`img.decode()` can never resolve when the page is not
     compositing** (backgrounded app, hidden tab, headless pane). The
     await never returned, CBN never activated, and the page silently
     behaved as a plain freehand page — no error, nothing to see. Wait
     on `complete && naturalWidth` instead; `drawImage` needs no
     decode.
  2. **`loadTemplate` runs while `#screen-draw` is still `[hidden]`**,
     and a hidden element has no layout box, so there was nothing to
     measure the overlay against. `showScreen("draw")` now re-syncs. A
     `ResizeObserver` on the artwork covers the rest (drawer opening,
     safe-area insets, fonts landing) — zoom is a CSS transform and
     changes no layout box, so `applyView` alone cannot catch those.
- **All 8 pages are authored** (2026-08-18), in pack order: cactus 6
  regions / 5 colours, rainbow 9/8, tulip 10/5, pumpkin 12/5,
  snowman 14/6, cat 15/6, donkey 22/8, sunny day 36/7. Verified in the live runtime — every
  seed lands, every region gets exactly one number, no region
  double-assigned, **0 unreachable at 8x on any page**, and every
  palette is fully used with a minimum colour separation of 53 (the
  fill tolerance is 6). `cbn-sun`'s hand-tuned `assign(cx, cy)`
  heuristic is retired; the function form is still supported, just
  unused.
- **Authoring is now `tools/cbn-editor.html`** — click a region, click
  a number, copy the block. Exported entries are `{x, y, ci}`: a point
  plus a palette index, where the point is the region's anchor.
  **No geometry is exported**, so a page can never go stale against a
  re-detect. The panel carries a live fitness report (regions numbered
  at 1x, unreachable count, deepest zoom needed) plus per-region
  hover stats, so a page that will not work as CBN is obvious before
  it ships rather than after.
- **`scripts/process-cbn-page.py` is now primarily an AUDIT tool**,
  and is an exact port of cbn-core's rules — the four governing
  constants are named identically on both sides, so change one and you
  must change the other. Verified producing identical region counts
  and worst-zoom figures to the JS on all 8 pages. `--map` writes a
  region map PNG with ids drawn at each anchor, which is how you
  decide what colour each region should be; `--reference` still
  samples a coloured reference for bulk runs.
  **See [`CBN_ART_GUIDE.md`](CBN_ART_GUIDE.md)**, rewritten alongside
  this. Headline rule: **a region that must carry a number needs an
  inscribed radius of about 2% of page width.**
- **Numbers are judged by whether a DIGIT fits, not a circle
  (2026-08-18, same day, second pass).** The first cut of the rebuild
  sized every number from its region's inscribed circle, which is far
  too strict for anything ribbon-shaped — a digit is tall and narrow,
  and so is a rainbow band or a cactus rib. `labelFit()` in
  cbn-core.js now measures the region's width and height through its
  anchor and picks one of three outcomes:
  - **pill** — the full badge (paper capsule + outline), needs ~1.7em
    in both directions;
  - **slim** — bare glyph with a halo instead of a capsule, needs
    little more than the digit itself. This is what lets a narrow band
    carry a number at all;
  - **hidden** — no room for either at this zoom; zooming in brings it
    back.

  Free win, no art change: numbers readable at 1x on a phone went
  **sun 4 → 22, rainbow 3 → 9 (the whole page, no zoom at all), donkey
  7 → 10, tulip 6 → 8, snowman 8 → 9**, and every page's worst-case
  zoom dropped. `labelFit` / `zoomToShow` live in cbn-core so the game,
  the editor and the audit script cannot disagree about legibility —
  verified identical region-by-region across all 8 pages.

- **The cactus art was re-cut (2026-08-18) — it demanded too much
  zooming and no code could fix it.** Its ribs were 3–7 px wide on a
  phone; a digit needs ~7 px of width, so 12 of its 17 regions could
  never show a number without zooming, worst case 5.8x.

  The ribs are *decoration* — they say "saguaro" — but the fill mask
  cannot tell decoration from structure, so they shattered the trunk
  into ribbons. Fix: **demote them by dropping their alpha just below
  INK_ALPHA.** They still render (the line art draws over the kid's
  colour, so they still read as ribs) but fill and CBN see through
  them. Same behaviour the pumpkin's interior rib curves already had.
  Result: **17 regions needing 5.8x → 6 regions, all numbered at 1x,
  worst-zoom 1.0x**, and the artwork looks the same. Colouring it now
  reads better too — the ribs look like real folds rather than five
  flat stripes.

  New `scripts/process-cbn-page.py --soften`. Two things it got wrong
  before it got them right, both worth keeping in mind for any future
  page:
  1. **Thickness alone is not a safe test.** The pot's soil ellipse is
     the same 4–7 px as the ribs; demoting it merged the soil into the
     pot rim. So the rule is what softening ACHIEVES: demote only a
     stroke that separates two regions where at least one is too small
     to number.
  2. **That rule alone destroys the picture.** It also matches the
     outline between a thin rib and the sky, so the whole cactus fell
     into the background and the region count collapsed **17 → 4**.
     A stroke touching any region that reaches the page edge is now
     never demoted: you may dissolve a shape's internal divisions,
     never its silhouette. The script re-checks its own output and
     refuses if the background region grew.

  ⚠ **Softening runs AFTER `process-coloring-pages.py`, on the shipped
  PNG** (alpha ink only exists at that stage), so re-running the art
  pipeline silently reverts it. Re-soften after any regeneration.

- **⚠ `image:` paths need a `?v=` when the ART changes.** `cbn-cactus`
  now reads `assets/coloring-pages/cbn/cactus.png?v=2`. The `?v=` on
  index.html covers game.js / templates.js / style.css / cbn-core.js
  but NOT the page PNGs, so a returning kid held the old cactus.png in
  cache while templates.js handed it seeds authored against the new
  art — the page numbered itself wrongly and quietly. It cost a
  confusing debugging detour here (the runtime reported 17 regions
  while the file on disk had 6). `thumbSrc()` carries the query onto
  the thumb, which is correct — the thumb was regenerated from the
  same alpha. **Bump it whenever a page's PNG is re-cut.**

- **The CBN pack is ordered by ascending region count** = ascending
  difficulty: cactus 6 → rainbow 9 → tulip 10 → pumpkin 12 →
  snowman 14 → cat 15 → donkey 22 → sunny day 36. Sunny day used to be
  first, which meant a kid's first color-by-number page was the one
  with 36 numbers. Keep the order when adding a page.

- **`window.__tinycanvas` dev handle added.** Every other Madderverse
  game has one (`__slip`, `__petalcraft`, `__holeup`) and this app not
  having one cost real time on this run: the whole app is a closure,
  so from a console a feature silently not activating looks identical
  to one that is broken. Exposes `state`, `view`, `loadTemplate` and
  the CBN internals. Not gated behind `?dev`.
- **Free tier bumped 1 → 3 reps per category (2026-08-09).** Every Pro
  category now shows THREE `free: true` pages instead of one. Free tier
  = BLANK + 6 basics + 33 reps = **40 pages** (was 18); Pro adds the
  other 33. Rationale: a kid who liked ANIMALS previously saw one cat
  and nothing else — three animals reads as a category worth returning
  to. The picker still shows no locks — buildPicker just iterates every
  `tpl.free` per pack in flat mode. See templates.js.
- **Erase is now a REVEAL, not a wipe (2026-08-09).** Dragging the
  eraser peels back to the canvas state as it was just BEFORE the most
  recent non-erase op (stroke, fill, or stamp). Paint a cloud over a
  red sky, erase the cloud → red sky comes back. Mode follows the
  last brush: last was FILL → ERASE is tap-to-unfill a region; any
  brush → ERASE is drag-to-brush-erase. Machinery: `revealCanvas`
  (persistent snapshot) + `revealScratch` (per-segment mask); helpers
  `captureRevealSnapshot()`, `clearRevealCanvas()`, `eraserPaintReveal()`,
  `floodFillEraseAt()`. Snapshots fire from `onPointerDown` (non-erase
  stroke path), `floodFillAt`, and `placeStampAt`; erase strokes don't
  re-snapshot (they consume the reveal, they don't advance it).
  `clearCanvas` also `clearRevealCanvas()` so an erase after CLEAR
  reveals bare paper, not the ghost of the previous drawing.
- **Soft tutorial on no-op erase (2026-08-09).** First time an erase
  gesture changes zero pixels — kid dragged over printed lines, over
  bare paper, or fill-erased an already-empty region — a one-shot
  pink toast appears: "The printed lines stay — color around them!"
  Flagged with `ERASE_TIP_KEY` so it never nags again. `eraseWasNoop()`
  compares pre/post pixel data in the dirty rect; `maybeShowEraseTip()`
  is the fire-once entry point.
- **Four brushes retired (2026-08-09): PEN, MARKER, PENCIL, PAINT.**
  All four were solid-color stroke variants with subtle textural
  differences — kids couldn't tell them apart, and Onion called them
  redundant. Surviving set: CRAYON (default), GLITTER, + the four
  Pro brushes (SPRAY / RAINBOW / GLOW / SMUDGE). Combined with
  STAMP + FILL that packs 8 tools cleanly as 2 rows of 4 in the
  tool grid. `state.currentTool` defaults to `"crayon"` now; every
  fallback to `BRUSHES.pen` was rewritten to `BRUSHES.crayon`.
- **UNDO + CLEAR moved into the tool tray's action-row (2026-08-09).**
  A new `.tool-row.action-row` sits directly under the tool grid where
  the big ERASE pill used to. Three equal-width buttons — UNDO / ERASE
  / CLEAR — so the destructive actions live together. UNDO+CLEAR were
  deleted from `.draw-controls` at the bottom of the tray (SAVE stays
  there as the primary CTA). Same IDs (`drawUndo`, `drawClear`) so the
  JS bindings survived unchanged; ERASE is still `data-tool="eraser"`,
  picked up by the standard tool-switch handler.
- **Page catalog REWORKED AGAIN (2026-08-07, Onion's art — 72
  pages, the current model).** `TINY_CANVAS_PAGE_PACKS` in
  templates.js: a **FREE pack (pro:false — BLANK + sun, rainbow,
  leaf, icecube, markers, beans)** and **eleven pro CATEGORIES of
  six — ANIMALS, BUGS (folder `insects/`), OCEAN, DINOSAURS, SPACE,
  GO GO GO (folder `transportation/`), MUSIC, FOOD, HOME, PLACES,
  SNOWFLAKES** = 66 category pages + 6 basics + BLANK = 73 entries
  (72 image files). Four categories are new this rework — bugs,
  music, snowflakes, space. Each category carries exactly ONE
  `free: true` representative (cat, ladybug, fish, longneck, base,
  rocket, guitar, donut, cabin, egypt, 1flake), so the **free tier
  shows 40 cards** (BLANK + 6 basics + 33 reps — three per category
  after the 2026-08-09 bump; see the change-log bullets at the very
  top for the rationale) and Pro adds the other 33. buildPicker: unlocked → 12 headed sections, everything;
  locked native → ONE flat headerless grid of the free pack + the 11
  reps. **`?free=1` forces the free tier on web** (FORCE_FREE in
  isPro) — the only way to preview it there, and what free-tier
  store screenshots get shot against. The pipeline mirrors
  `art-src/coloring-pages/<pack>/` subfolders into `assets/` (folder
  name == pack id; page ids must be unique across ALL packs — they
  are the localStorage in-progress keys). *(Previous 2026-08-05
  layout was 52 pages / 8 categories + an EXTRAS pack of
  beans/monster/robot/singing; monster/robot/singing are retired,
  beans moved into the FREE pack.)*
  Stamps: **60 in 6 pack tabs**
  (CLASSICS/ANIMALS/NATURE/FOOD/SPACE/VEHICLES — `STAMP_PACKS`
  groups by id; new shapes with interior detail are stroked-outline
  because same-color strokes on a fill are invisible).
- **Pro BILLING is WIRED (2026-08-05) but inert until activated.** The
  RevenueCat module + parent-gated Settings card are in game.js ("PRO
  BILLING" section carries the full activation checklist). It needs:
  the RC account/project (user-side), the `goog_` key pasted into
  `RC_PUBLIC_API_KEY`, the `tiny_canvas_pro` Play product + `pro`
  entitlement, and `npx cap sync` (the plugin is in package.json,
  pinned ^9 for Capacitor 6 — if Capacitor is ever bumped, move the
  plugin major with it). With the placeholder key the card never
  shows, so no dead purchase UI ships. Privacy pages + terms +
  STORE_LISTING were all updated for the single optional IAP.
- **Zoom + pan shipped (2026-08-05)** — the detailed pages needed it.
  Two fingers pinch/pan, +/- buttons (left edge), ctrl+wheel; one
  finger always draws. See "Zoom" under Things that bite for the
  geometry invariants.
- **The coloring pages are REAL ART now (2026-08-05).** The 34
  hand-drawn SVG templates were replaced by 14 full-scene raster
  coloring pages (+ BLANK) — see "The raster coloring pages" below.
  These 14 are the FREE set; Pro will add more pages on top, never
  instead.
- **The Pro value-pass CONTENT is BUILT (2026-08-05):** 4 new brushes
  (spray/rainbow/glow/smudge), a STAMP tool with 60 shapes in 6
  themed packs (CLASSICS/ANIMALS/NATURE/FOOD/SPACE/VEHICLES), 8 paper
  textures, 12 export frames — all gated by `isPro()`, which is
  always true on web (the showcase) and false on native until billing
  sets the flag. Pattern fills stay free forever. See "Tiny Canvas
  Pro" below for the locked decisions and engine notes.
- **⚠ Android vc2 / 1.0.1 is SUBMITTED and IN REVIEW on Play**
  (2026-08-06, Onion's report; the listing and screenshots are done —
  the older "NOT UPLOADED / screenshots are the blocker" note was
  stale). Targeting API 35; Play rejected vc1 for targeting 34 and
  that is fixed. The upload keystore exists (§F) — do not generate
  another.

  **The build in review is far behind the web.** Verified inside
  `android/app/build/outputs/bundle/release/app-release.aab` (built
  Aug 5): `base/assets/public/index.html` reads `?v=22` and its
  `game.js` is 117,900 bytes against the current 229,833. So it
  predates the 14 raster coloring pages, the whole Pro value pass
  (brushes / stamps / papers / frames / billing), zoom, and the
  2026-08-06 export fixes. **This is known and deliberate — Onion is
  letting it clear review and updating immediately after.** Do not
  treat the in-review build as representative of the code, and do not
  push her to replace the submission.

  For that update build: bump `versionCode` to 3 in
  `android/app/build.gradle`, and note `www/` is still staged at v22 —
  re-run `node scripts/build-www.mjs` before `npx cap copy android`,
  or the "new" build ships the old payload again.
- **Pro tier is decided but not built.** Pattern fills are the first
  piece and are in, ungated. No billing code exists yet. See "Tiny
  Canvas Pro" below.
- **Rotation, stroke feel and fill behaviour are all device-verified.**
  The only headless-unverifiable path left is anything that runs inside
  requestAnimationFrame.

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
- [`privacy/index.html`](privacy/index.html) — the store-listing
  privacy URL, `https://madderverse.org/tiny-canvas/privacy/`, matching
  the cookie-cache and slip-studio pattern. `legal/privacy.html` and
  [`legal/terms.html`](legal/terms.html) are the older long-form pages
  and ship inside the app.

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
- **73 templates: 72 raster coloring scenes + BLANK** (the
  2026-08-07 catalog — see the "Page catalog" bullet up top for the
  12-pack breakdown). Real coloring-book art — dense full-bleed
  scenes, ~1.83:1 landscape — rendered as a `pointer-events: none`
  overlay above the kid's canvas so the kid colors UNDER the lines.
  See "The raster coloring pages" below for the format and pipeline.
  The engine still fully supports the original inline-SVG template
  format (BLANK is the only remaining svg entry; the 34 retired SVG
  pages are in git history).
- **Templates must be built from CLOSED shapes.** The fill tool
  rasterizes the overlay into a boundary mask, so any gap in a line
  lets fill escape into the rest of the page. This can't be judged by
  eye — audit every new page (see "Auditing a page for fillable
  regions"). For SVG pages, prefer `<circle>`, `<ellipse>`, `<rect>`
  and paths ending in `Z`; an open stroke is fine only for decoration
  that isn't meant to hold colour.
- **6 distinct brushes** (was 10 pre-2026-08-09 — see the change-log
  bullet up top for the four retirements) — 3 free (CRAYON default,
  GLITTER, RAINBOW) + 3 Pro (SPRAY / GLOW / SMUDGE), each with its
  own beginStroke + drawSegment + textural feel. Plus ERASER (now a
  reveal, not a wipe — see up top), the FILL bucket, and the Pro
  STAMP tool (60 tap-to-place shapes tinted by the armed color, in
  6 themed pack tabs).
- **FILL does MS Paint semantics**, not just template regions: it
  spreads over pixels matching the colour under the finger and stops at
  anything different, so the kid's OWN strokes bound it. The printed
  line art is an absolute boundary on top of that via the mask.
- **8 fill patterns** (dots, stripes, checks, stars, hearts, scales,
  zigzag, grid) + solid. Each is a MASK painted in the armed colour, so
  one tile serves all 42 colours; gaps are left untouched so paper shows
  through. All drawn in code — no image assets.
- **42 colors in 5 groups** (RAINBOW 12 / PASTELS 10 / NEONS 7 /
  EARTH 8 / METALLIC 5) via tab switcher, plus a custom picker.
  ⚠ The fill tool distinguishes colours by a squared tolerance of 6, so
  any colour added here must sit further than that from every existing
  one. The palette shipped with #00ffcc and #00ffd5 only 9 apart, which
  let fill run straight between them; the neons duplicate was removed
  and the minimum separation is now 18.4.
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
  Chromium browsers — **web only**. `scripts/build-www.mjs` strips that
  button out of the native payload entirely (Chrome's Android WebView
  does fire the event, so the app was offering to install itself).
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
  templates.js            # window.TINY_CANVAS_PAGE_PACKS — the page
                          # catalog, incl. each CBN page's cbn: block
  cbn-core.js             # window.TinyCanvasCBN — the color-by-number
                          # region model (labeling + distance
                          # transform + anchors). Loaded BEFORE
                          # game.js, and ALSO by tools/cbn-editor.html
                          # so the two cannot drift.
  manifest.webmanifest    # PWA manifest, theme-color #ff2e88

  assets/
    fonts/                # self-hosted woff2 — bungee-latin,
                          # vt323, press-start-2p (74.7KB total).
                          # Do NOT move these back to a CDN.
    coloring-pages/       # the 14 shipped pages — 1800px palette
                          # PNGs, lines baked as alpha (~1.9MB
                          # total). GENERATED — regenerate via
                          # scripts/process-coloring-pages.py

  art-src/
    coloring-pages/       # UNTRACKED master art — the 2816x1536
                          # white-paper originals (53MB). Never
                          # ships; keep it, it's the only source.

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
    process-coloring-pages.py  # art-src masters -> assets pages +
                               # fillable-region audit (Pillow+numpy)
    process-cbn-page.py     # color-by-number AUDIT (is this page
                            # usable as CBN?) + --map region maps.
                            # Exact port of cbn-core.js's rules.
    build-www.mjs           # stages www/ for the native build

  tools/
    cbn-editor.html         # click-to-assign CBN authoring tool.
                            # Loads ../cbn-core.js, so what it shows
                            # IS what the game detects. Not shipped —
                            # build-www.mjs does not copy tools/.

  package.json            # Capacitor 6 + plugins
  capacitor.config.json   # appId org.madderverse.tinycanvas, webDir "www"
  .gitignore              # node_modules + native build outputs

  STORE_LISTING.md        # paste-ready store-listing metadata
  CLAUDE.md               # this file
  cover.jpg               # hub card art (1280x720, live on the hub)
  privacy/index.html      # /tiny-canvas/privacy/ — store privacy URL
  www/                    # generated app payload (gitignored)
  android/                # Capacitor project (UNTRACKED, see below)
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
| **FILL PATTERNS** | `FILL_PATTERNS` (8 tiles + solid), each a `draw(ctx,size)` that paints coverage into a tile; `patternTile(id)` rasterizes once per DPR and caches a `Uint8Array` of alpha. `state.fillPattern` holds the armed id. Chips live in the pattern row, which swaps in for the SIZE row when FILL is armed. |
| **FILL MASK** | `buildFillMask()` rasterizes the line-art SVG into a 1-byte-per-pixel boundary mask aligned to the canvas, `floodFillAt()` scanline-fills the tapped region against it. `fillGeomKey()` fingerprints every geometry input (canvas size, svg rect, template id) so a stale mask rebuilds itself. Boundary threshold `FILL_BOUNDARY_ALPHA=96` — high on purpose so fill runs *under* the antialiased stroke skirt and leaves no pale halo; the line art draws on top, so the underlap is invisible. |
| **HISTORY** | Dirty-rect patches, not full snapshots. `beginHistoryCapture()` blits the canvas into an offscreen buffer (cheap, no encode); the stroke path grows a bounding box via `growBounds`; `commitHistory()` keeps only that rectangle as raw `ImageData`. `undo()` is synchronous (`putImageData`). See "Things that bite" for why the box needs slack. |
| **DRAWING** | Pointer handlers delegate to the active brush. Midpoint-quadratic smoothing one layer above the brush API: pointer-down → set smoothX/Y = raw point + brush.beginStroke; pointer-move → drawSegment from smoothed to midpoint(last, current); pointer-up → drawSegment final raw segment so the line doesn't stop short of the finger. |
| **TEMPLATES** | `loadTemplate(tpl)` swaps line-art SVG, sets the title, clears the canvas, calls `tryRestoreInProgress(tpl.id)` to silently paint back any saved in-progress strokes for this template. |
| **UI BUILDERS** | `buildPicker`, `buildPaletteTabs`, `buildPalette`, `rebuildSizeButtons` (driven by tool), `attachToolHandlers`, `attachSettingsHandlers`. |
| **SCREENS** | `showScreen(name)` toggles `[hidden]` on the 5 screen containers, fires `sfxSwoosh`. Settings screen rebuilds toggle states on entry. |
| **SETTINGS** | `loadSettings()` / `persistSettings()` (via setStorage). `syncSettingsUI()` mirrors state → DOM. |
| **PARENT GATE** | `parentGate(label, onPass)` is the public entry point. Caches unlock state per session. `renderParentGate()` generates a random 2-digit addition + 3 distractors within ±10. Wrong shakes + shows feedback; cancel closes; correct fires the deferred callback. |
| **AUTOSAVE** | `persistInProgress()` writes `canvasSnapshotPng()` (a bounded scale-down of the RAW canvas — strokes on transparency) + templateId to the in-progress key. ⚠ It briefly used `composePng()`, which bakes the paper + line art into an opaque image; restoring that dragged the old paper texture around as canvas pixels and double-painted the line art — fixed 2026-08-05 with the paper-texture work. Fires every 60s while strokes are pending, on visibilitychange-hidden, on beforeunload/pagehide. `tryRestoreInProgress(templateId)` paints back the saved PNG on template re-entry. `clearInProgress()` fires on SAVE (work graduated) and CLEAR (work discarded). |
| **TOASTS** | `showSavedToast` (every save, 1.4s) and `showFirstSaveToast` (one-shot ever, 2.4s, flagged via `tinyCanvas.firstSaveCelebrated.v1`). |
| **GALLERY** | `loadGallery` / `persistGallery` (via setStorage). `composePng()` renders canvas + line-art onto an offscreen canvas (long side `SAVE_LONG_SIDE`) → PNG dataURL, **cropped to the content, not the viewport** (`alphaBBox` / `withArtImage` / `renderExport`) — see "Things that bite". `saveDrawing()` writes the record + fires both toasts + clears in-progress. `openDetail`, `deleteCurrent` (parent-gated), `exportCurrent` (parent-gated; branches to nativeExport on iOS/Android, anchor-download on web). |
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

## The raster coloring pages (the shipped format since 2026-08-05)

The 14 pages are AI-generated coloring-book scenes. Sources are
2816x1536 PNGs (line art on white paper) in `art-src/coloring-pages/`
— **untracked working art**, keep them, they're the masters. What
ships is `assets/coloring-pages/*.png`: 1800px-wide **palette PNGs**
where the **lines are baked as ALPHA** (constant ink `#1c2226` =
`--line-ink`, alpha = inverted luminance; the palette encoding is 1
byte/px — see the note in the script for why, and why lossless WebP
was rejected). ~1.9MB total for all 14 (the sources are 53MB).
Produced by `scripts/process-coloring-pages.py` — grayscale →
LANCZOS downscale → luminance-to-alpha LUT (≥225 → 0, ≤100 → 255,
ramp between; kills the paper-grain texture) → despeckle ink blobs
under 30px → audit. Run it from `tiny-canvas/` after dropping new
sources in.

Why alpha instead of black-on-white: the overlay sits ABOVE the kid's
canvas, so an opaque page would hide every stroke; and the fill mask
thresholds **alpha ≥ 96**, so baked-as-alpha art feeds the existing
SVG mask path with zero format branching in the threshold.

Engine specifics worth knowing:

- A template is `{ id, name, image: "assets/coloring-pages/x.png" }`;
  `loadTemplate` puts an `<img>` in the overlay, `buildFillMask` and
  `composePng` `drawImage` it directly (no Blob/serialize roundtrip —
  that path still exists for SVG pages).
- **Every geometry consumer measures the ART element's own box** via
  `overlayArtEl()` (`svg` or `img`), never the `.line-art` container.
  The container is a generous landscape frame (94vw x 78vh); the art
  letterboxes itself inside it with max-width/max-height + auto
  sizing, which keeps the element's layout rect identical to its
  displayed bitmap. Don't give `.line-art img` an `object-fit` that
  letterboxes INSIDE the element — that would silently break mask
  alignment.
- **The page edge is a fill boundary on raster pages.** The scenes are
  full-bleed — sky/wall/floor run to the image border — so
  `buildFillMask` marks a 2-device-px frame around the image rect
  (`markPageBorder`). Without it a tap on the sky escapes the page and
  floods the paper margins around the whole screen. SVG pages keep
  their old open-margin behavior; BLANK still floods the whole canvas.
- If a fill lands before the page's `<img>` finishes loading, the mask
  build waits on the img's load event, and `fillGeomKey`'s re-measure
  invalidates any mask built against the pre-load empty rect.

## Adding a new template

Raster (preferred): drop the source PNG in `art-src/coloring-pages/`,
run `python scripts/process-coloring-pages.py`, check its audit line
(region count at both scales, no leak-shaped "largest region" jump),
then append `{ id, name, image: "assets/coloring-pages/<id>.png" }`
to `window.TINY_CANVAS_TEMPLATES`. The picker auto-discovers it.

SVG (legacy, still supported): append `{ id, name, svg }`. The SVG
must:

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

Current baseline (the 72 raster scenes, 2026-08-07, audited at 1800px
wide, regions ≥ 64px, image perimeter counted as boundary): dense
**scene** pages run **120–692** fillable regions (median ~230), no
leaks; counts hold at a 900px re-audit. **Single-OBJECT pages read
differently and that is fine** — leaf (2 regions), icecube (11),
bananas (25), donut (57), and the snowflakes/guitar/harp all show ONE
region covering 70–89% of the open area, because the object sits on
open paper and the background is legitimately one connected fill. The
leak signature is a page that should be a dense scene but shows few
regions + one giant region; none of the 72 do. If a NEW page lands far
below the scene band AND isn't a single object, look for an ink gap in
the source art. (`scripts/
process-coloring-pages.py` prints this audit automatically.)

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
- **The export is cropped to the CONTENT, never the viewport** (fixed
  2026-08-06). `composePng` used to size the output from
  `canvas.width/height` — but the canvas fills the whole screen, so
  every save carried the *device's window aspect*: a 2.07:1 desktop
  viewport exported a 2.07:1 PNG with the 1.83:1 page letterboxed
  inside a band of bare paper, and the Pro frames then framed the
  paper rather than the drawing. `renderExport()` now crops to the
  **union of the page's ink and the kid's own strokes** — both halves
  are load-bearing:
  - Ink alone would clip a kid who coloured out past the lines onto
    the paper. The canvas allows that; the page border only stops
    *fills*, not brush strokes.
  - Strokes alone would crop an untouched or barely-touched page down
    to nothing.

  Around that: a 3% margin, a 25%-of-page minimum so a single dot
  can't export as a postage stamp, and a clamp to the page box
  widened by the strokes — that clamp is what keeps a full-bleed
  scene exporting as exactly its page (1.833) instead of gaining a
  paper mat. **All 52 pages are 1.833:1 but their ART is not**: ink
  spans 100% of page width on the full scenes and as little as 31%
  (leaf) / 35% (beans) on the single-object EXTRAS, which is why
  beans now exports portrait (~0.70) and unicorn stays 1.832. Page
  ink boxes are static, so they're scanned once and cached per
  template id.

  Two invariants this must keep: **BLANK has no art element**, so its
  crop comes from strokes alone against a whole-canvas box; and
  **zoom is neutralized first** — every rect here is a live client
  rect, so saving while pinched in would otherwise export the zoomed
  crop. The view is reset, measured, and restored inside one
  synchronous block (layout is forced, nothing repaints between),
  then the async drawing runs off the captured numbers.

  Verified at a 2.065:1 viewport: beans 720x1024, unicorn 1024x559,
  beans + an off-page stroke 1024x671 (stroke kept), BLANK doodle at
  the 25% floor, donut with zero strokes 1024x835, zoomed save
  identical to unzoomed with the view restored.
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
  `templates.js` or `game.js` (currently **v71**). Without it the
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
- **Zoom is ONE CSS transform on `#zoomLayer`** (paper + canvas + line
  art as a unit; see game.js "ZOOM + PAN VIEW"). It works with zero
  changes to the drawing pipeline because every geometry consumer
  measures live client rects, which reflect the transform — the scale
  factors cancel. The invariants that keep it true:
  - **`setupCanvas` must `resetView()` BEFORE measuring** — a zoomed
    canvas box would multiply the backing store by the zoom factor.
  - **Map client→device coords PER AXIS**, never with one shared
    ratio: the STAGE_W/H floor of 320 makes the x and y ratios diverge
    on viewports under 320px, and a shared ratio misplaces the fill
    mask exactly like the innerWidth bug above (found via a 284px
    preview pane; `artBox()` and `composePng` both carry the fix).
  - A second finger mid-stroke cancels the partial stroke by restoring
    the `histCanvas` snapshot; landing within 500ms of a fill/stamp
    commit undoes it (`lastOneShotCommit`) — both are a kid reaching
    to pinch. The one-shot undo is gated on the COMMIT timestamp so a
    no-op tap (landed on a line) can't undo older work.
  - The canvas is `touch-action: none`; one finger always draws.
  - **Brush/stamp/eraser sizes are zoom-compensated** —
    `effectiveSize()` = `activeSize() / view.s`, used at every drawing
    call site, so the nib keeps a constant ON-SCREEN size and zooming
    in is the fine-detail mode (verified: a 10-device-px pen line at
    1x is 3 device px at 3.4x). UI code keeps reading `activeSize()`
    — the size buttons show the kid's nominal pick.
- **`viewport-fit=cover` is set** but `user-scalable=no` is **not** —
  unlike Pootery. Browser pinch still works on the non-draw screens;
  on the canvas the app's own pinch (above) takes over. Capacitor's
  iOS WebView respects this.

## ⏰ Play Billing Library 8 — HARD DEADLINE 2026-08-31

**Play Console is warning on Tiny Canvas: "Update to a newer version of
Google Play Billing Library to prevent your updates from being
rejected", action by Aug 31 2026.** It is real and it is a *publishing*
gate, not a runtime one: builds already on the store keep transacting,
but **after Aug 31 you cannot upload an update** unless it uses Billing
Library **8 or later**. Google will grant an extension to Nov 1 2026 on
request.

**Tiny Canvas ships Billing 7.1.1** (verified from the resolved Gradle
graph, not inferred). The chain is:

    @revenuecat/purchases-capacitor 9.2.2
      -> purchases-hybrid-common 13.26.0
        -> purchases-android 8.15.0
          -> com.android.billingclient:billing 7.1.1

**The trap: no RevenueCat build with Billing 8 runs on Capacitor 6.**
This cannot be fixed with `npm update` — it needs a Capacitor major
upgrade. Verified across the plugin's published versions:

| RC plugin | needs Capacitor | hybrid-common | purchases-android | Billing |
|---|---|---|---|---|
| **9.2.2 (current)** | 6 | 13.26.0 | 8.15.0 | **7.1.1** ❌ |
| 10.3.5 | >=7 | 13.37.0 | 8.19.2 | **7.1.1** ❌ |
| 11.1.0 | >=7 | 16.1.0 | 9.1.2 | **8.0.0** ✅ |
| 12.3.2 | >=8 | 17.55.1 | 9.29.0 | **8.0.0** ✅ |
| 13.4.0 (latest) | >=8 | 18.29.0 | 10.16.0 | **8.3.0** ✅ |

So the minimum compliant move is **Capacitor 7 + RC 11**; the move that
matches Pootery (already Capacitor 8 / RC ^13) is **Capacitor 8 + RC
13**, which also buys the most runway before the next deprecation.

**Decision (Onion, 2026-08-18): ship the CBN rebuild FIRST on the
current stack, migrate after.** Billing 7.1.1 uploads are still accepted
until Aug 31, so vc7 is a legal upload; doing the Capacitor jump
separately keeps the migration diff clean and leaves time to test it on
a real device. Two uploads instead of one, deliberately.

⚠ **When doing the migration, remember `android/` is untracked and
carries two hand-applied fixes that do NOT survive a regenerate** — the
recreated `res/values/colors.xml` and the `signingConfigs.release`
block reading `android/keystore.properties`. See the "Android build"
section above. Also re-check `variables.gradle` (compile/target SDK 36)
and the AGP/Gradle pins, which a Capacitor major will want to move.

Do not let this slip past Aug 31 without either the upgrade or a filed
extension.

## Play build state (2026-08-18)

**`Desktop/tiny-canvas-v1.3.0-vc7.aab`** (22.0 MB, built 2026-08-18) —
the color-by-number rebuild, ready to upload. Verified:

- bundled `index.html` reads `?v=71`, and the bundled `game.js`,
  `cbn-core.js` and `templates.js` are **byte-identical** to the shipped
  web build;
- `cbn-core.js` is present in `base/assets/public/` (it is a third
  top-level script — `scripts/build-www.mjs` had to learn about it, and
  a missing copy degrades every CBN page to freehand *silently*);
- signed by the existing upload key — `CN=Tiny Canvas, OU=Mad Sundar
  LLC`, SHA-256 `5B:08:5A:48:7C:05:A3:A8:…:6C:0D:84:25`, matching §F;
- versionCode 7 / versionName 1.3.0, package `org.madderverse.tinycanvas`.

Use `jarsigner -verify -certs` on an **AAB** and `apksigner verify` on
an **APK** — apksigner rejects a bundle outright ("Missing
AndroidManifest.xml"), which is a tooling mismatch, not a broken build.

Earlier bundles on the Desktop: vc2 (1.0.1, api35), vc3 (1.1.0), vc4
(1.1.1), vc5 (1.1.2), vc6 (1.2.0). The RevenueCat key in `game.js` is a
**real `goog_` key**, so billing is configured, not inert — the
"placeholder / inert" language elsewhere in this file is stale.

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

### Android 15 / API 35 (Play's current floor)

Play rejects anything targeting below **API 35**. The Capacitor 6
template ships targetSdk 34, so this had to be raised — and it is not
just a number:

- `android/variables.gradle` -> `compileSdkVersion`/`targetSdkVersion` 35
- **AGP 8.2.1 cannot compile against SDK 35.** Raised to **8.6.1**,
  which needs Gradle **8.9** (`gradle/wrapper/gradle-wrapper.properties`).
  Leaving AGP alone fails the build outright.
- **API 35 ENFORCES edge-to-edge.** The status and navigation bars
  become transparent overlays and the app draws underneath them, so the
  titlebar would slide under the clock and `colorPrimaryDark` would stop
  colouring the status bar at all. `res/values-v35/styles.xml` sets
  `android:windowOptOutEdgeToEdgeEnforcement`, Google's opt-out for this
  transition. It is in `values-v35` because the attribute does not exist
  on older API levels.

⚠ **The opt-out is deprecated in API 36** and stops working once the app
targets it. Before the next targetSdk bump, the titlebar and tool rail
need real safe-area padding. The page already sets `viewport-fit=cover`
and the overlay-top property already consumes `safe-area-inset-top`, so
this is half done rather than untouched.

Verify what a build actually targets before uploading — the manifest is
the thing Play reads, not the gradle file:

```bash
aapt dump badging app-release.apk | grep -E "package|targetSdkVersion"
# package: ... versionCode='2' versionName='1.0.1' compileSdkVersion='35'
# targetSdkVersion:'35'
```

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

## Tiny Canvas Pro — CONTENT BUILT (2026-08-05), billing not

A **99¢ one-off unlock**, decided 2026-08-05. Not a separate app, not
packs, not a subscription. **The value-pass content shipped the same
day** — see "What's built" below; only the billing layer remains.

**The governing rule, in Onion's words:**

> "we never ever remove the value from the 'lowest common denominator'
> audience. every kid should be able to play the game, period. and they
> should want to play it, because it's fun and has features and never
> shows ads. that's the whole model, the walled purchase is just a way
> for me to recover costs of creating apps."

So Pro is **purely additive**. Never propose capping, watermarking or
degrading anything free already does. Tools, colours and core mechanics
belong to everyone; Pro is **content abundance**, in the shape of Slip
Studio's value pass — many dimensions each with lots of options, never
engagement tricks.

**Why one unlock rather than packs:** Pootery carries five product ids,
five entitlements and a Play Console catalogue to keep in sync. A single
flag means every future pack lands in Pro automatically, so what a
parent bought keeps growing without a single new SKU.

**Where the upsell lives:** behind the **existing parent gate**, in
Settings. NOT in the picker. No padlocks, no greyed rows, no "Pro"
badges in the child's flow — Apple Kids and Play Families both look for
pressure on children, and a kid tapping a locked unicorn ten times is
unkind regardless of policy. The kid should experience the free app as
complete; the parent finds the upgrade by going looking.

**What's built (the 2026-08-05 value pass — all code, no assets):**

| Dimension | Free | Pro (BUILT) |
|---|---|---|
| Pages | 14 scenes + blank | more scenes later (art task, pipeline ready) |
| Fill patterns | ALL 8 tiles — **free forever**, decided 2026-08-05 | — |
| Brushes | 6 + eraser + fill | +4: SPRAY, RAINBOW, GLOW, SMUDGE |
| Stamps | — | STAMP tool, 24 code-drawn shapes × any color |
| Paper textures | classic | +7 (dotty/grid/lines/kraft/mint/sky/blush) |
| Export frames | plain PNG | 12 frames, applied at export only |

**Three decisions locked with Onion (2026-08-05, don't relitigate):**
1. **Pattern fills stay free forever.** They shipped ungated a day
   earlier; clawing them back would remove value from kids. Pro sells
   on brushes/stamps/papers/frames/pages instead.
2. **The WEB build gets everything.** `isPro()` returns true off
   native — web is the showcase/trial (Slip Studio's model); the 99¢
   gate exists only in the store apps.
3. **All four content layers in one pass** rather than staging them.

**How the gating works (`game.js`):** `isPro()` = `!isNative() ||
state.proUnlocked`; the flag loads from `tinyCanvas.pro.v1` (mirrored
to Capacitor Preferences). Gated DOM carries `data-pro hidden`;
`revealProUI()` un-hides it in one pass at init. On a locked native
build the Pro tools/rows simply don't exist in the UI — no padlocks,
per the rule above. The stamp chip row needs no `data-pro`: its
visibility is tool-driven, and an unreachable tool never arms.

Engine notes: GLOW redraws the whole stroke path per move on the wet
layer (per-segment translucent passes bead at the joints — that's why
it's shaped differently from PAINT); SMUDGE and the eraser carry
`direct: true` and bypass the wet layer (smudge must read real canvas
pixels); RAINBOW subdivides segments to ~5px hue slices so fast swipes
don't band; frames render at export/preview from the clean stored
record, never baked in; paper is visual-only (a fixed layer under the
transparent canvas + the same tile painted by `composePng`), so fill
semantics are untouched.

**Billing is WIRED (2026-08-05), inert until activated.** The game.js
"PRO BILLING" section holds `initBilling` / `syncEntitlements` /
`purchasePro` / `restoreProPurchases` / `unlockPro` / `syncProCard` +
the full activation checklist (RC project → `goog_` key into
`RC_PUBLIC_API_KEY` → Play product `tiny_canvas_pro` @ $0.99 → RC
entitlement `pro` in a current Offering → `npx cap sync`). One product,
one entitlement, anonymous RC user (no accounts), price string pulled
live from the store. The parent-gated Settings card shows ONLY when
native + locked + the store answered — with the placeholder key it
never renders, so no dead purchase UI can ship. `findProPackage` reads
`getOfferings()` correctly ({current, all} — NO `.offerings` wrapper;
that shape bug once blocked every Pootery purchase). Plugin:
`@revenuecat/purchases-capacitor` **^9** (the Capacitor-6-compatible
major — Pootery runs ^13 on Capacitor 8; move this in lockstep with
any Capacitor bump).

The privacy pages (`privacy/index.html`, `legal/privacy.html`),
`legal/terms.html`, the in-app ABOUT blurb and `STORE_LISTING.md` were
all updated 2026-08-05 for the single optional IAP. ⚠ Two submission-
time flags for Onion: the Play **Data safety** form and Apple's **App
Privacy** currently plan "no data collected" — RevenueCat receives the
store receipt + a random per-install id, so check the current
RC-in-kids-apps guidance when filling those forms; and the store
listing description deliberately still describes the FREE tier (6
brushes, no stamps) — that is what an unpurchased install shows.

## Better coloring-page art — RESOLVED 2026-08-05

This was the "biggest single lever on perceived quality" open question,
and it closed with the raster-page shipment (see "The raster coloring
pages" above). How the analysis resolved, for the record:

- The luminance-threshold prediction became a **luminance→alpha bake at
  build time** instead of a runtime branch — the engine's alpha≥96
  threshold then needed no change at all.
- **Vectorizing lost to raster**: these scenes are dense enough that a
  trace would not be smaller, and the optimized PNGs came in at ~1.9MB
  for all 14, which made the tracer's size argument moot.
- **Landscape was handled explicitly** (aspect-preserving letterbox +
  the page-edge fill boundary) rather than cropping the scenes square.
- **Provenance**: the pages are AI-generated for this app (no stock
  license to clear); watermark check happened during the audit pass.

The audit requirement carries forward unchanged — see "Auditing a page
for fillable regions" for the current baseline.

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

### Also shipped 2026-08-05 (all device-verified)

- **Fill does MS Paint semantics** — bounded by the kid's own strokes,
  not just template lines.
- **Fill tolerance corrected** 48 → 6. It was wider than the palette's
  own minimum separation, so tapping a line could swallow an adjacent
  fill. The duplicate `#00ffd5` was removed; separation is now 18.4.
- **Strokes are smooth** — the wet-layer rewrite; no more beads at each
  pointer sample.
- **One undo, in the tray.** Both marquees removed. Madderverse dropped
  from the footer.
- **Rotation keeps the drawing centred** (was pinned to the top-left).
- **Pattern fills** — the first Pro content layer, currently ungated.
- **cover.jpg** exists and is live on the hub.
- **Store assets** in `store/`; **release keystore** generated and
  backed up; **API 35** build produced.

### Still open

1. **Screenshots** — `store/screenshots/` is empty and this is the
   remaining blocker for the Play listing. Shoot on a device, not a
   desktop browser: below 1030px the layout is a different arrangement.
2. **Upload to Play.** The signed AAB exists (vc2 / 1.0.1 / API 35).
   Everything from §F2 onward is Play Console work, user-side.
3. ~~**Better page art**~~ — DONE 2026-08-05: the 14 raster scenes
   shipped, replacing the hand-drawn SVG set. `cover.jpg` was
   regenerated the same day from the KITCHEN CAT page via
   `scripts/make-cover.py` (half-colored with the fill tool's own
   region model — re-run the script to regenerate). Remaining knock-on:
   the staged store screenshots still predate the new pages entirely.
4. **Pro billing** — CODE DONE 2026-08-05 (RevenueCat module +
   parent-gated Settings card, see "Tiny Canvas Pro"). Remaining is
   user-side activation: RC account, key paste, Play product,
   entitlement, cap sync, license-tester purchase test.
5. ~~**Stamps**~~ — DONE 2026-08-05 (60 shapes in 6 packs; originally
   24; spec said 60+, so
   more shapes is still an open widening).
6. **More templates** — read the region-audit section before
   authoring. Next batch is Pro page content (Onion's art).
7. **Native save-to-photo-library directly** (skip share sheet) —
   requires `@capacitor-community/camera-preview` or a small custom
   plugin. Share-sheet path works.
8. **Localization** — the locale stub in Settings is shipped UI. Add a
   locale dictionary + i18n wrapper around all visible strings.
9. ~~**More brushes**~~ — DONE 2026-08-05 (spray, rainbow, glow,
   smudge).
10. **Edge-to-edge, before the API 36 bump — CSS DONE 2026-08-13.** The
    values-v35 `windowOptOutEdgeToEdgeEnforcement` opt-out has been
    DELETED and targetSdk is now **36** — the whole build now runs
    edge-to-edge and the safe-area CSS is the only thing keeping
    content out from under the system bars. The CSS covers `.screen`
    base padding, `#screen-draw .screen-titlebar`, `.settings-hook`,
    both `.draw-side-rail` breakpoints (mobile bottom-sheet anchored
    above the nav bar via `bottom: env(safe-area-inset-bottom)`, not
    just padded), `.pages-btn`, `.zoom-ctrls`, AND — added 2026-08-16
    after Bala's report — the two per-screen padding overrides on
    `#screen-gallery` and `#screen-settings`, which were previously
    silently discarding `.screen`'s inset-aware padding and pinning
    the ← TITLE back button under the phone status bar. Every one of
    these consumes `env(safe-area-inset-*, 0px)` additively so desktop
    web (where env is 0) is unchanged. ⚠ **New screen-level padding
    overrides must include `env(safe-area-inset-*)`** or the button
    will end up under a bar on edge-to-edge Android — this is the
    trap that bit gallery + settings; grep for `padding-top:` inside
    any `#screen-*` block before shipping.
