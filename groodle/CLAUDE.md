# Groodle — game-level guide

Scribble inside the silhouette, watch your drawing come alive and dance.

**Read the repo-root [`../CLAUDE.md`](../CLAUDE.md) first** for project-wide
rules (no build system, GitHub Pages deploy, "flat" game shape, GoatCounter
beacon, ad-free / kid-friendly branding). This file is only what's specific
to `groodle/`.

## What it is

- One frontal humanoid silhouette on a stage. Kid colors inside it with a
  palette + brush sizes; the canvas's 2D context is hard-clipped to the
  body shape (via `ctx.clip(buildBodyPath())` in `buildCanvas`) so strokes
  outside the silhouette are never painted to the bitmap at all.
- DANCE button toggles ▶ DANCE / ■ STOP in place — drawing **stays
  enabled** while the creature dances (the canvas pointer events remain
  live), so kids can keep editing on a bouncing canvas. The dance-dock
  ■ STOP exit is kept as a redundant escape hatch.
- Audio is procedural Web Audio — kick, snare, hat, bass, lead — no
  audio files anywhere. 4 MOVES × 4 BEATS combine for 16 grooves; kid
  cycles each independently with the ↻ MOVE / ↻ BEAT buttons.
- 8 background presets (studio, disco, outdoors, night, sunset,
  underwater, stadium, candy) chosen via thumbnail buttons in the Stage
  drawer.
- 4 poses (standing, cheer, star, groovy) chosen from the Pose picker in
  the Stage drawer. Each pose is data-driven via `POSES` and re-renders
  the SVG silhouette groups + the canvas clip when selected.
- **Coloring-book pages** ("freedom inside a fence"): the kid can pick
  a pre-made line-art template (Robot, Princess, Astronaut, Clown,
  Pirate, Superhero) from the 📖 Pages dock button and color inside
  the lines. Pressing DANCE while a page is loaded unlocks that page's
  achievement + Doodles reward. The body silhouette is the *outer*
  fence; the page template adds an *inner* structure.
- **Public Gallery** (optional, Supabase-backed): the 💾 SAVE button in
  the New drawer composites the silhouette + drawing + outline into a
  PNG and uploads it to a public Supabase bucket; the 🖼️ Gallery dock
  button shows the most recent submissions. Anonymous + kid-safe name
  field. While the Supabase credentials in `game.js` are placeholders,
  both buttons render but display a setup hint — see `SUPABASE_SETUP.md`.

## File layout

```
groodle/
  index.html             — silhouette SVG + draw canvas + tool dock + drawers + modals
  style.css              — full stylesheet (no build, no preprocessor)
  game.js                — single IIFE; canvas + audio + dance + pages + gallery
  cover.jpg              — hub-page card art
  manifest.webmanifest   — PWA manifest (name, icons, theme, start_url)
  sw.js                  — service worker (cache-first shell for offline play)
  SUPABASE_SETUP.md      — one-shot SQL + RLS setup for the public gallery
  PLAY_STORE_PLAN.md     — phased rollout plan to ship as a Capacitor Android app
```

All runtime files are loaded directly by the browser. Path conventions
match the rest of the hub (relative for in-game assets, absolute for SEO
/ favicon). The Supabase JS SDK is loaded from jsDelivr in `index.html`
and only does work once the placeholder credentials in `game.js` are
filled in.

## PWA / service worker

Groodle ships as an installable PWA — manifest at `manifest.webmanifest`,
service worker at `sw.js`. Both are referenced from `index.html` (the
`<link rel="manifest">` tag) and `game.js` (the `serviceWorker.register`
block at the bottom of the IIFE). The SW is registered only on `https:`
or `localhost` so a Python `http.server` round-trip works for local
testing.

The SW uses a **cache-first** strategy for the game shell (HTML, CSS,
JS, hat sprites, favicons, footer CSS one directory up) and bypasses
everything cross-origin that needs live responses (`*.supabase.co`,
`goatcounter.com`). Bump `SHELL_VERSION` in `sw.js` whenever any
precached file changes — the `activate` handler deletes every cache
that doesn't match the current version so stale assets can't linger.

Icons in `manifest.webmanifest` currently reuse
`../assets/favi/android-chrome-{192,512}x{192,512}.png` (the
site-wide Madderverse logo). Both are `"purpose": "any"`; **no
maskable variant ships yet**. Chunk 9 in `PLAY_STORE_PLAN.md` covers
swapping to Groodle-branded icons + commissioning maskable layouts
for Android adaptive icon shapes.

**`game.js` is a single IIFE.** If you ever see `})();` appear twice in
the file (e.g. after a sloppy paste), the whole game initializes twice
— double event handlers, double audio scheduler, two `state` objects
fighting over the same localStorage key. The fix is to keep exactly one
IIFE; verify with `grep -n '^})();$' game.js` showing one match.

## Architecture (`game.js`, top → bottom)

| Section | What lives there |
|---|---|
| **CONFIG** | `STAGE_W=400`, `STAGE_H=600`, `COLORS` (10), `SIZES` (4/12/22), `BODY_SHAPES` (6 silhouette pieces — must match the SVG copies in `index.html`), `TEMPO=112`, `STEPS_PER_BAR=16`, `BARS_PER_LOOP=4`, `MOVES`, `BEATS` |
| **STATE** | `currentColor`, `currentSize`, `isErasing`, `isDrawing`, `lastX/Y`, `isPlaying`, `currentMoveIdx`, `currentBeatIdx`, `danceStartTime` |
| **AUDIO** | `audioCtx`, `masterGain` + `DynamicsCompressor`. `ensureAudio()` lazy-inits on first user click. `startAudio` / `stopAudio` drive the scheduler. |
| `scheduler()` | Look-ahead scheduler — every 25 ms, schedule any beats due in the next 100 ms. Advances `currentStep` (0..15) then increments `currentBar` (0..3). |
| `scheduleStep(step, bar, when)` | Per-beat dispatcher. Picks drum hits from the active `BEAT` pattern + bass / lead from the active `MOVE`. |
| **SYNTH VOICES** | `kick`, `snare`, `hat`, `bass`, `lead`. All synthesized with oscillators + filters; no samples. |
| **CANVAS** | `buildCanvas` sizes the canvas at `STAGE_W*dpr × STAGE_H*dpr`, scales the 2D context so coordinates are in logical 400×600 units, and calls `ctx.clip(buildBodyPath())` so the drawable area is the silhouette itself. `buildBodyPath` constructs a `Path2D` from `BODY_SHAPES` (using `addRoundRect` + a `DOMMatrix` for each transformed rect). `getPos(e)` converts pointer coords to logical units. `attachDrawing` wires the pointer events. |
| **TOOLS UI** | `buildPalette`, `buildSizes`, `attachBgPicker` — generates the swatches / size pucks and the 4 background thumbnails. |
| `drawSurprise()` | Goofy default character (skin fill, green shirt, blue pants, red star, eyes, smile, purple hair tufts) so kids can hit DANCE without drawing first. Relies on the clip to trim everything outside the silhouette. Nulls `currentPageId` before clearing so SURPRISE doesn't fight with a stamped page template. |
| **DANCE** | `startDance` / `stopDance` toggle audio + `body.dancing` class; `togglePlay` is the unified click handler on `#playBtn`. `setPlayBtnState(playing)` flips the button between "▶ Dance" and "■ Stop" labels. The draw canvas pointer-events stay live the whole time — drawing while dancing is intentional. `danceFrame` runs the RAF loop; `applyMove(move, beats)` computes the per-move transform; `scheduleBubblePulse` flashes the corner bubble on quarter notes. |
| **PAGES** | `PAGES` is a static catalog of coloring-book templates; each has its own `draw(ctx)` that strokes line-art on the same clipped 2D context the kid draws on. `applyPage(id)` clears the canvas and stamps in the chosen page; `clearCanvas()` re-stamps the active template so CLEAR resets to "freshly outlined" instead of fully blank. `startDance()` calls `trackPageCompleted(currentPageId)` so pressing DANCE with a page loaded unlocks its achievement. SURPRISE explicitly nulls `currentPageId` first so it doesn't fight with the template re-stamp. |
| **GALLERY** | `composeGroodleBlob()` re-renders the kid's drawing into an offscreen 800×1200 PNG using the same `buildBodyPath` the live canvas uses — silhouette fill, draw canvas, outline ring, no SVG serialization. `submitGroodle()` uploads to the `groodle-art` bucket then inserts a `groodles` row; `loadRecentGroodles()` pulls the latest 48 rows for the gallery modal. Both bail to a friendly empty state when `SUPABASE_URL`/`SUPABASE_ANON_KEY` are still placeholders. |
| **INIT** | `init()` builds everything; fires on `DOMContentLoaded`. |

## The silhouette + clip trick

The same 6 shapes (head circle + torso rect + 2 angled arms + 2 angled
legs) live in **four** places that must stay in lockstep:

```
.silhouette-fill            — pale white wash, the "coloring page" surface
.silhouette-outline         — same shapes, fed through #innerOutlineFilter
                              (feMorphology erode → composite out) to draw
                              a dark ring sitting inside the body
<clipPath id="bodyClip">    — defined in <defs>. No longer referenced by
                              CSS — kept as a legacy / fallback hook in
                              case future features (e.g. a "save your
                              drawing as SVG" export) want it.
BODY_SHAPES (game.js)       — the SAME shapes as a JS data array. Used by
                              buildBodyPath() to build a Path2D, which
                              buildCanvas() hands to ctx.clip(). This is
                              the single source of truth for "the drawable
                              area".
```

**The canvas's 2D context is hard-clipped to the silhouette.** Strokes
outside the body are never painted to the backing bitmap — not just
visually hidden. Consequences:

- Dragging the cursor outside the silhouette simply produces no marks
  (no more "the brush snaps" illusion — there's nothing there to snap).
- The eraser can only ever act on visible pixels.
- A wide brush near the silhouette edge gets cleanly cropped at the
  boundary, so strokes meet the inner outline ring perfectly.
- `drawSurprise()` can still paint full-rect fills across `400×600` and
  trust the clip to trim everything that isn't a body. The clip
  intersects every draw call, so the rect-painting trick still works.

If you change the silhouette, update BOTH the three SVG copies in
`index.html` AND the `BODY_SHAPES` array in `game.js`, or the visible
body and the clipped drawing area will drift apart.

The creature `<div id="creature">` wraps both the silhouette and the draw
canvas, so when `applyMove()` sets `creature.style.transform`, the silhouette
and the kid's drawing both transform together — one cohesive sprite.
`transform-origin: 50% 92%` keeps the feet planted on the floor.

## Audio role assignments (the 16 combos)

Each `MOVE` controls melody/bass; each `BEAT` controls the drum pattern:

| | BOOM | FUNKY | SHUFFLE | WILD |
|---|---|---|---|---|
| **BOUNCE** | 4-on-floor, no bass | syncopated kick, no bass | shuffle ghost notes, no bass | scattered kicks, no bass |
| **TWIST** | + bass on quarter notes (root + 7th on step 8) | same +funky drums | +bass +shuffle drums | +bass +wild drums |
| **DISCO** | TWIST + 4-note lead phrase on bars 1 & 3 | same | same | same |
| **PARTY** | DISCO + lead hit on step 8 every bar | same | same | same |

When tweaking, drum hits live in the `if (beat === 'BOOM') {...}` blocks
inside `scheduleStep`. Bass/lead live just below in the `move !== 'BOUNCE'`
guards.

## Drawing flow

1. `pointerdown` on `.draw-canvas` → draws a single dot at the pointer,
   captures the pointer.
2. `pointermove` extends a stroke from `lastX/lastY` to the new position.
3. `pointerup` / `pointercancel` / `pointerleave` ends the stroke.
4. Eraser uses `globalCompositeOperation = 'destination-out'` to punch holes
   in whatever's painted.
5. `body.dancing .draw-canvas { pointer-events: none }` — drawing is hard-
   locked off while the creature is dancing.

DPR scaling matters: the canvas backing store is `STAGE_W*dpr × STAGE_H*dpr`,
the 2D context is scaled by `dpr`, and coords are normalized in `getPos()`
to the logical `400×600` space so JS only ever thinks in those units.

## Things that bite

- **The drawable area is defined by `BODY_SHAPES` in `game.js`, not by
  the SVG.** The SVG copies (`.silhouette-fill`, `.silhouette-outline`,
  `<clipPath id="bodyClip">`) only control what the kid SEES; the Canvas2D
  `ctx.clip()` in `buildCanvas` decides what the kid can actually PAINT.
  If the four copies drift out of sync, the visible silhouette and the
  drawable area will mismatch. Pointer events still fire over the full
  canvas rect — they just hit a clipped 2D context that paints nothing
  outside the body.
- **`audioCtx` needs a user gesture to start.** `ensureAudio` lazy-inits,
  and `startDance` calls `audioCtx.resume()` before its `begin()` callback
  — don't try to schedule audio from page load.
- **The scheduler is look-ahead, not RAF-driven.** It advances 0..15 steps
  then loops; `currentBar` increments 0..3. `applyMove` runs on RAF and
  reads `audioCtx.currentTime - danceStartTime` for the beat phase, so the
  dance stays locked to the music even if frames drop.
- **`transform-origin` on `.creature` is `50% 92%`** so the feet stay
  planted. If you change pose dimensions, re-check this — a different pose
  height shifts where 92% lands and the feet will lift off / sink through
  the floor.
- **Don't change `STEPS_PER_BAR`** without auditing every literal step
  comparison in `scheduleStep` (`step === 4`, `step % 4 === 0`, etc.).
- **DPR sizing**: the canvas is set up once in `buildCanvas` from
  `window.devicePixelRatio`. It does **not** re-init on viewport / pixel-
  ratio changes, so dragging a window between displays of different DPR
  can blur strokes until reload.
- **Surprise relies on the clip.** `drawSurprise()` paints rects across the
  whole `400×600` rectangle (skin tone everywhere, shirt 0-400 x 175-350,
  pants 0-400 x 350-570). It only looks like a body because the clip
  trims everything outside the silhouette. If the clip ever changes shape,
  surprise will look wrong.

## How to make common changes

### Add a new color or brush size
- Color: append a hex to the `COLORS` array in `game.js`. Palette UI is
  data-driven — `buildPalette` renders one swatch per entry.
- Brush size: append a number to `SIZES`. `buildSizes` renders one button
  per entry; the visual dot inside scales with the value (clamped 6–28 px).

### Add a new background
1. Add a new `.bg-newname { background: ... }` rule to `style.css` under
   the "background variants" section.
2. Add a `<button class="bg-thumb" data-bg="newname">` to the `.bg-picker`
   in `index.html`, with a matching `<span class="bg-preview bg-newname">`
   inside.
3. `attachBgPicker` is data-driven via `data-bg`; no JS change needed.

### Add a new MOVE or BEAT
1. Append to the `MOVES` or `BEATS` arrays at the top of `game.js`.
2. Add a new branch inside `applyMove()` (MOVE) or `scheduleStep()` (BEAT)
   that handles the new id. The pattern is the same as the existing four.
3. Cycle buttons in `dancePanel` cycle through the arrays automatically.

### Swap or add a silhouette pose

> NOTE: parts of this doc still describe an older model where the body
> was a `BODY_SHAPES` rect array duplicated into 3 SVG copies in
> `index.html`. That is gone. There is now ONE source of truth: the
> `POSES` map + the path generators in `game.js`. `posePathD(pose)`
> resolves a pose to a single SVG path `d` string, and every consumer
> (canvas clip via `buildBodyPath()` → `new Path2D`, the injected SVG
> fill/outline groups, the static-pattern window, the gallery export)
> reads from it. Change the pose, every consumer updates for free.

Each entry in `POSES` is either:

- **Skeleton-driven** — `skeleton: hum(handL, handR, footL, footR)`.
  `groodleBodyPath()` builds the body from shared `SK` proportions +
  those four limb tips: a head circle + a neck + a waisted two-part
  torso + four tapered `capsule()` limbs, concatenated into one
  nonzero-fill path (overlaps melt into a seamless solid; gaps — e.g.
  between the legs — stay open). To add a skeleton pose, add one line
  to `POSES` with the four limb-tip coords; nothing else.
- **Hand-drawn** — `path: 'M … Z'`. The generator is bypassed entirely
  (this is how Ghost and Animal work). This is how you ship custom
  art: replace any pose's `skeleton:` with a `path:` string.

To hand-draw / replace a pose silhouette:

1. Open `groodle/pose-template.svg` in any vector editor (Figma /
   Illustrator / Inkscape) or trace a paper drawing. It has the
   `viewBox 0 0 400 600`, the head/shoulder/waist/hip/foot anchor
   guides, and the live verified Standing body embedded as a
   reshapeable reference.
2. Produce **one closed filled path** (Union any pieces). M/L/C/Q/Z
   only — no `A` arcs (renderers flatten them inconsistently; the
   generator avoids them deliberately, see `arcBezier`), no strokes,
   no transforms, no groups.
3. Put the `d` string on that pose as `path:` (drop the `skeleton:`).
4. Bump `SHELL_VERSION` in `sw.js` (game.js changed → precache stale).
5. Verify geometry, not screenshots: in the preview, click the pose
   then `document.querySelector('.silhouette-fill path').isPointInFill`
   a battery of points — every body part IN, sky/sides OUT, the gap
   between spread legs OUT. (A bad arc/winding shows up as holes or
   runaway fill; this is exactly how the `capsule()` generator was
   validated.)

Keep the figure within the template's anchor envelope or the prefab
faces / clothing / coloring-book pages (which position art via the
`BODY` anchor object) will not line up. A wholesale re-proportion
means retuning `BODY` (and each pose's `origin` for foot-planting).

## Adding a new coloring-book page

1. Append an entry to `PAGES` in `game.js` — `{ id, label, emoji,
   draw: (c) => {...} }`. The `draw` function paints onto the same
   clipped 2D context as free drawing, so anything outside the
   silhouette is trimmed for free; design lines around `(200, 100)` for
   the head and `(200, 264)` for torso center.
2. Add a per-page achievement to `ACHIEVEMENTS` (`id: 'page-<id>'`,
   reward 15 Doodles) and bump the `page-master` check's threshold if
   you've changed the total number of pages.
3. Refresh — `buildPagesGrid` is data-driven, no UI change needed.

Pages don't get a thumbnail today; the cards are emoji + label. If you
want true thumbnails, the cheapest add is a `<canvas>` per card that
runs `page.draw` once at the card's logical scale during `buildPagesGrid`.

## Local dev

```bash
python -m http.server 8000
# then open http://localhost:8000/groodle/
```

GitHub Pages auto-deploys on push to `main`; the file you see live is the
file at the committed SHA.

## TODOs (pending — Bala's feedback)

These are open work items, in rough priority order. Each is sized for a
single focused session.

### 1. Increase amount of poses and backgrounds

**Poses (bigger work, ~1 session):**
- Today there's exactly one silhouette: a front-facing humanoid (head + torso
  + 2 arms + 2 legs). The shapes are duplicated four times: three SVG copies
  in `index.html` (fill / outline / clipPath) plus the `BODY_SHAPES` array
  in `game.js` that drives the canvas-level clip.
- The `BODY_SHAPES` array is already in the right shape to be the basis of
  a `POSES` data structure — each pose would be its own array of shape
  records. To add more poses cleanly: lift `BODY_SHAPES` into a
  `POSES[poseId]` map, have JS inject the same shapes into all three SVG
  groups at init (so they're no longer hand-maintained in HTML), drive the
  canvas clip off `POSES[currentPose]`, and add a pose-picker UI similar
  to the background picker.
- Pose candidates to try: side profile (one-arm extended), arms-up
  ("yay!"), seated, animal (cat / dog), abstract blob (no-rules drawing).
- Each pose needs to re-anchor `transform-origin` if its bottom isn't at
  ~92% (e.g. seated pose's "feet" might be at 75%).

**Backgrounds (easier, ~30 min):**
- Add 3-4 more under `style.css` "background variants" section, register
  them in the `.bg-picker` in `index.html`. No JS change.
- Candidates: stadium / concert (spotlight beams), underwater, rainbow,
  forest at dawn, candy land.

### 2. (DONE — kept here for context) Fix figure "snapping" for coloring within the lines

**Resolved by hard-clipping the canvas 2D context to the silhouette** via
`ctx.clip(buildBodyPath())` in `buildCanvas`. Strokes outside the body
are no longer painted to the bitmap at all (previously they were drawn
and only visually masked by a CSS `clip-path`, which made the brush
appear to "snap" at the silhouette edge).

Open follow-ups that the original TODO floated but this change did NOT
do, in case the kid UX still feels off:
- **Visual feedback outside the body.** Today, dragging outside the
  silhouette produces literally nothing — no shadow stroke, no cursor
  hint, no "you're outside the body" affordance. If kids start to feel
  the brush is "broken" outside the lines, render a faint ghost stroke
  under the clip (a second canvas, low opacity, NOT clipped) so they
  see their input is at least being tracked.
- **Stroke clamping.** When the pointer crosses the silhouette boundary
  mid-drag, the line currently jumps with no draw outside the body.
  Pixel-accurate clamping (line-segment vs clip-path intersection so
  the visible stroke ends exactly at the edge) would feel even crisper,
  but it's real geometry work and the current behavior already looks
  clean because the inner outline ring covers the boundary.

### 3. Improve layout

Current layout is mobile-first single-column: stage → bg-picker → tool
panel → footer. Known rough edges:
- On landscape / desktop the tool panel falls way below the stage with
  wasted side gutters. A horizontal layout (tools to one side of the
  stage) would use the screen better.
- The hint tag ("STAY IN THE LINES TO GROOVE!") overlaps the bg-picker
  on small phones.
- `.stage` is `width: min(94vw, 380px)` — caps narrower than it needs to
  on tablets.
- The dance panel (MOVE / BEAT / DRAW buttons) is fine on mobile but
  could be a sidebar on desktop.

Likely fix: a CSS grid layout with media-query breakpoints at ~720 px and
~1100 px. Keep mobile single-column; tablet = stage + tools side-by-side;
desktop = same but bigger stage.
