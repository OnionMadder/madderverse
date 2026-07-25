# Florigami — Asset Drop-In Guide

Everything below is **already wired**. The game ships and plays with zero art
(CSS-drawn flowers + the living CSS sky). When you have real art, drop the files
in the paths here, add a couple of config lines, bump the cache-bust, and it
takes over automatically. Nothing else in the code needs to change.

Two independent systems: **flower sprite sheets** and **photo backdrops**. You
can do either, both, or one species/scene at a time — anything you haven't
supplied keeps its current placeholder.

Test the plumbing before you've drawn anything final, from the dev console:
`__petalcraft.mockSprites()` (generates placeholder sheets) and
`__petalcraft.mockBackdrop()` (generates a gradient backdrop). Reload to clear.

---

## 1. Flower sprite sheets — one sheet per species

**File:** `assets/img/flowers/<species>.png` — one PNG per species. Species ids
(exactly): `cosmos`, `tulips`, `pansies`, `hyacinths`, `lilies`, `mums`,
`windflowers`, `roses`.

**Layout: a fixed grid of square cells.**
- **Columns = growth stages, in this order:** `seed · sprout · bud · bloom · night`
  (5 columns). The `night` column is **optional** — a closed/dimmed bloom shown
  after dark. If you skip it, drop to a 4-column sheet and set `stages` (below).
- **Rows = the species' colors, in dex order** (row 0 = the first dex color).
  The dex order per species:

  | species | rows (top → bottom) |
  |---|---|
  | cosmos | white, yellow, red, pink, orange, black |
  | tulips | white, yellow, red, pink, orange, purple, black |
  | pansies | white, yellow, red, orange, blue, purple |
  | hyacinths | white, yellow, red, pink, orange, blue, purple |
  | lilies | white, yellow, red, pink, orange, black |
  | mums | white, yellow, red, pink, purple, green |
  | windflowers | white, red, orange, pink, blue, purple |
  | roses | white, yellow, red, pink, orange, purple, black, blue |

- **Seed + sprout are shared:** the engine only reads them from **row 0**, so
  draw a seed and a sprout once in the top row and leave those two cells blank in
  every other row. (Bud, bloom, night are drawn per color, every row.)

**Cell size:** square. Default **128×128** per cell. A cosmos sheet is therefore
5 × 6 = 640 × 768 px; roses (8 colors) = 5 × 8 = 640 × 1024 px. You can use any
square size — just set `frame` to match. Draw the flower centered in the cell; it
scales to fill the tile, so keep a little margin.

**Transparency:** PNG with alpha. The tile/soil shows behind the flower.

**Wire it in** — add one line to the species in `game.js` (`const SPECIES`):
```js
roses: {
  name: "Roses",
  …,
  sprites: { src: "assets/img/flowers/roses.png", frame: 128 },
},
```
Optional keys on `sprites`:
- `frame`: cell size in px (default 128).
- `stages`: override the column list, e.g. `["seed","sprout","bud","bloom"]` if
  your sheet has no night column.

That's it — `initSpriteSheets()` preloads it and flowers switch to the sheet once
it loads. If the file is missing or fails, that species silently stays on the CSS
shape, so a half-finished art pass never breaks the game.

*(Pixel art? Uncomment `image-rendering: pixelated;` in the `.flower.sprited
.fl-body` rule in `style.css`.)*

---

## 2. Photo backdrops — day/night + seasons

**Files:** `assets/img/backdrops/<name>-day.jpg` and `<name>-night.jpg`. A day
and a night version of the same scene; the engine crossfades between them on the
in-game clock (night fades in after dusk, out at dawn). Night is optional — omit
it and day is used around the clock.

**Size / crop:** the layer is `background-size: cover`, centered. The garden plot
sits in the middle-lower area, so keep the interesting scenery toward the top and
edges. A ~**1600 × 1200** (4:3-ish) landscape JPEG is plenty; these are the one
place file size matters, so compress (rawpixel JPEGs re-saved ~q80 are fine).
rawpixel art is cleared to ship (see the license note in memory).

**Register scenes** in `game.js` (the `BACKDROPS` object, currently `{}`):
```js
const BACKDROPS = {
  meadow: {
    name: "Sunny meadow",
    day:   "assets/img/backdrops/meadow-day.jpg",
    night: "assets/img/backdrops/meadow-night.jpg",
    // celestial: false,  // hide the CSS sun/moon/stars over this photo (default keeps them)
  },
  // …one entry per scene…
};
```

**Seasons** — map each real-world season to a scene (`SEASON_SCENES` in
`game.js`):
```js
const SEASON_SCENES = {
  spring: "meadow",
  summer: "meadow",
  autumn: "orchard",
  winter: "snowgarden",
};
```
The player's **real-world date** picks the season automatically (northern
hemisphere: Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn). Any
season left `null` (or pointing at a scene you haven't added) falls back to the
living CSS sky.

**Player control:** once `BACKDROPS` has any entry, a **Scene** picker appears in
Settings automatically — `Auto (season)`, `Living sky`, and one row per scene.
The choice persists.

**Seasonal tint (optional):** the garden wrapper carries `data-season="spring|
summer|autumn|winter"`. There are commented example rules in `style.css`
(search "Seasonal hooks") if you want a gentle per-season wash on top of the
living sky even without photos — off by default so nothing surprises you.

---

## 3. After dropping assets in

1. Put files under `florigami/assets/img/flowers/` and `…/backdrops/`.
2. Add the `sprites:` lines and/or `BACKDROPS` / `SEASON_SCENES` entries in
   `game.js`.
3. **Bump the cache-bust** in `index.html` (`game.js?v=N` + `style.css?v=N`) so
   players get the new build — this is the #1 cause of "my change did nothing."
4. Commit + push to `main`; Pages auto-deploys. Verify the live `?v=` matches.

Nothing here is load-bearing until you supply it, so you can ship art
incrementally — one species, one season — and the rest keeps its placeholder.
