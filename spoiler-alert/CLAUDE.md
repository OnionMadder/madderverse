# CLAUDE.md — Spoiler Alert

Guidance for Claude Code when working inside `spoiler-alert/`. The repo-root
`CLAUDE.md` still applies (static site, no build step, GitHub Pages, etc.);
this file adds game-specific detail. Read it before editing `game.js`.

## What this game is

**Spoiler Alert** — "clean out the fridge." The player drags every item from
the fridge into one of three bins — **Compost / Keep / Trash** — tossing
spoiled food, composting organic scraps, and keeping the good stuff. The
intended feel is the *satisfying-cleaning* genre (PowerWash / Unpacking vibe),
**skewing older than the rest of the hub — it is deliberately NOT a 5-year-old
game.** Don't dumb it down or re-theme it toward toddlers.

**Status: WIP.** Not on the hub grid, `sitemap.xml`, `llms.txt`, or the hub
JSON-LD `ItemList`. Reachable only by direct URL
(`madderverse.org/spoiler-alert/`). Don't advertise it until the user says so.

## Shape & files

Standard **flat shape** — do not reorganize:

- `index.html` — boilerplate `<head>` (absolute favicon/OG URLs, GoatCounter
  beacon, footer-year script), the static shell (HUD / `#fridge` / `#bins` /
  `#overlay`), loads `style.css` + `game.js` by relative path.
- `style.css` — its **own clean "kitchen" palette** (soft whites, fridge-blue
  interior, chrome shelves), NOT the neon hub theme. CSS vars at `:root`.
  Spoiled-food decay (mold dots, sepia tint, bulge wobble) is pure CSS.
- `game.js` — one IIFE, `"use strict"`, vanilla JS, no deps.
- `assets/` — empty for now; **art is placeholder emoji + CSS** until launch.

## game.js architecture (read before editing)

- **`CATALOG`** — every food item: `{ e: emoji, n: name, bin: 'compost'|'trash',
  modes: [...], canBulge? }`. `bin` is the **bad bin** (where it goes *when
  spoiled*): organic → `compost`, packaged → `trash`. `modes` lists which
  inspection styles fit the item.
- **Three inspection modes** (the four "difficulty sources" live here +
  the timer):
  - `visual` — decay is visible on sight (mold/fuzz/bulge); no hidden info.
  - `date` — a printed `USE BY <date>` label compared to **today** (real
    `new Date()`, shown in HUD). Expired = discard. Labels can be `smudged`
    (blurred on the tile; tap to magnify a clear read).
  - `mystery` — a sealed container (`🥡/🍱/📦`). Tap to **pop the lid**; a
    spoiled one reveals decay + a `💨` puff. Only `leftovers`-type items use it.
- **`makeItem(cfg)`** decides `spoiled` (verdict), picks a weighted `mode`
  (`chooseMode`), and sets **`correctBin = spoiled ? base.bin : 'keep'`** —
  this is the single source of truth for scoring. Date items get an
  expiration relative to today (`spoiled` ⇒ past, fresh ⇒ future).
- **`levelConfig(lvl)`** is the difficulty curve: item `count`, `spoiledRatio`,
  mode weights (`wVisual/wDate/wMystery`), `smudge` chance, `bulge` chance,
  and `time` (seconds). Tune game balance here.
- **Drag-to-bin** (`attachDrag`): pointer events. A **clone** (`.drag-clone`,
  which *also* carries `.tile`) follows the pointer so the shelf doesn't
  reflow; the original is hidden (`.lifting`) and removed on a successful
  drop. Move threshold ~9px distinguishes **drag** (sort) from **tap**
  (inspect). Bins are hit-tested by `getBoundingClientRect`.
  - ⚠️ Listeners are attached **before** `setPointerCapture` (wrapped in
    try/catch) so a thrown capture call can't abort a drag. Keep that order.
  - ⚠️ `.drag-clone` matches `.tile` in `querySelectorAll('.tile')` until it's
    removed (~220ms after drop). Use `.tile:not(.drag-clone)` when counting.
- **`resolve(it, bin, clone)`** — scores it: correct ⇒ `+100 × combo`, combo++,
  sparkle/FX; wrong ⇒ `−40`, combo reset to 0, shake + a contextual
  `mistakeMsg`. Then removes the item, updates grime, and ends the level when
  the shelves are empty.
- **Grime** (`#grime` opacity) scales with spoiled items *remaining* — the
  fridge visibly gets cleaner as you clear it (the core payoff). Don't sever
  this; it's the "satisfying" hook.
- **Level flow** — `startLevel` → play → `endLevel` (time bonus = `timeLeft×10`,
  accuracy %, emoji grade) → `showSummary` → next/retry/menu overlays.
- **Audio** — WebAudio only, **no sound files**. `tone()`/`noise()` + the `SFX`
  map. A new sound = another `SFX` entry. Respects the mute button.
- **`window.__spoiler`** exposes the **state object `S`** (not functions) for
  debugging. Items carry their live DOM node at `it.el`.

## Conventions / gotchas

- **`correctBin` is authoritative** — when adding mechanics, set it correctly in
  `makeItem` rather than special-casing `resolve`.
- New foods: add a `CATALOG` row with the right `bin` and the `modes` that make
  sense for it. Mystery mode only fits sealed containers.
- Keep everything **emoji + CSS placeholder** until the user calls for final
  art (see the repo-wide placeholder-assets rule).
- **Verify by state, not screenshots.** This is a DOM/CSS-animated game; drive
  it with synthetic pointer events and assert against `window.__spoiler`
  (`score`, `combo`, `items`, `correct/wrong`). `preview_screenshot` has timed
  out here mid-animation — don't depend on it.

## Prototype lineage (scrub direction)

The hub-style tile-sort game is `index.html`/`game.js`. The newer
*satisfying-cleaning* direction lives in separate prototype pages so the
shippable game stays intact:

- `scrub-proto.html` — feel sandbox for the PowerWash-style goop scrape
  (canvas `destination-out` over a clean layer, tool upgrades, translucent slime).
- `fridge.html` — the "big" scene: CSS French-door fridge that swings open to a
  grungy stocked interior; grab an item → CSS kitchen-**sink** station (faucet,
  basin, rising foam suds) → scrub → put away; clear all items → wipe the fridge
  interior itself. One generic scrub engine (`attachScrub`/`paintSlime`/`strokeT`/
  `measureT`) powers both items and the interior; `onProgress`/`onDone` hooks drive
  suds + the washing/faucet state. Debug handle `window.__fridge`.

## 3D items (experimental — Three.js, like Slip Studio)

`item3d.html` is the harness for making items **3D** (the original
"rotate & examine" idea). Browser/WebGL via **vendored Three.js r165** at
`vendor/three.module.js` (copied from slip-studio; NOT a CDN — keep it local/
offline per house style). Approach **A** (chosen): a rotatable 3D model with the
existing 2D goop layer composited on top — slime is clipped to the *rendered
model's silhouette* by `destination-in`-drawing the GL canvas into the goop
canvas (renderer needs `alpha:true` + `preserveDrawingBuffer:true`). Renders
**on demand** (init / Turn / re-slime), not a continuous rAF loop, so it's
verifiable even when the preview's animation clock is frozen. Later upgrade =
per-texel dirt shader so goop persists through free rotation (needs a unique-UV
unwrap per model in Blender). `window.__item3d` is the debug handle.

**Synty assets:** the user drops POLYGON-pack **FBX**; convert with
`tools/synty_fbx_to_glb.py` (headless Blender — builds a Principled material
from the pack's shared atlas at NEAREST filter, embeds it in a self-contained
GLB). See [[synty-fbx-to-glb]] for gotchas. Swap `buildPlaceholderBottle()` in
`item3d.html` for a `GLTFLoader` call (marked in code); `GLTFLoader.js` still
needs vendoring into `vendor/addons/loaders/` when the first GLB lands.
