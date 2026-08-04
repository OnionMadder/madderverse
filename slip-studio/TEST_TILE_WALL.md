# Slip Studio — the test-tile wall

A spec for the glaze test-tile wall: a place to try glaze combinations on small
tiles instead of on whole pots, and to pin the results up permanently.

Written against **web v224**. Nothing here is built yet.

---

## Why

Slip Studio already has glaze chemistry. Overlapping dips fire an emergent third
colour via `REACTION_PAIRS`, and `checkRecipeDiscoveries()` quietly records the
curated pairs a player has fired into a journal.

**The problem is that the journal is almost impossible to make progress in.**

There are 21 curated pairs. With 48 glazes there are 1,128 possible pairs, so a
player picking two glazes at random has roughly a **2% chance** of hitting a
curated one. And each attempt costs a whole pot — shape it, dip it twice with
overlapping coverage, dry it, fire it. Most players will fire a handful of pots
in a session, will never overlap two dips deliberately, and will therefore never
see the journal do anything at all.

So we built a discovery system with no practical way to discover things in it.

Real potters solve exactly this problem with a test-tile wall: small slabs,
dipped in one glaze then half-dipped in another, fired in batches, and pinned up
as a permanent reference library. It is one of the most beloved objects in a real
studio — a wall of small accidents you can look at for years.

That gives us:

- **Deliberate experimentation.** Trying a pair costs seconds, not a whole pot.
- **A reason to open the app** that isn't "make a pot." Thirty seconds is a
  complete, satisfying session.
- **A self-directed goal with no pressure.** "Fill the wall" is a goal the player
  sets, not one we nag them about.
- **Something true about ceramics**, which suits the Teacher Approved posture and
  makes the app quietly educational without ever being a lesson.
- **Colour mixing as a toy.** A five-year-old can dip two colours and watch them
  make a third. That's the shortest path to delight in the whole app.

---

## What the player does

1. Opens the wall (a fixture of the studio, reachable from the landing and the
   fired stage).
2. Takes a blank tile from the rack.
3. Dips it in a glaze — the tile shows that glaze's raw, chalky colour.
4. Optionally dips it again, part way, in a second glaze. The tile now has three
   zones: **glaze A alone**, **the overlap**, **glaze B alone**.
5. Loads up to six tiles onto the rack.
6. Fires the rack. A short kiln moment, then the raw chalky colours melt into
   their fired ones and the overlap resolves to its true reaction colour.
7. The fired tiles pin themselves to the wall, permanently.

Three zones is the point. It's how a real test tile is read, and it shows the
chemistry directly: here's what each glaze does alone, and here's what they do to
each other.

### Two tiers of result

- **Named recipes** — the curated `REACTION_PAIRS`. These get a name, a card in
  the journal, and a gentle toast on first discovery. Currently 21 of them.
- **Your own tests** — any other pair. Still fires, still produces a real blended
  colour via `blendGlaze`, still pins to the wall. Not a "recipe", just yours.

This mirrors a real wall, where most tiles aren't famous — they're just tiles you
made, and the wall is worth looking at because of them.

---

## Non-goals — the rules that keep this benevolent

These are load-bearing. The whole point of this feature over a merchant economy
is that it adds a reason to play without adding a reason to feel bad.

- **Tiles are free and unlimited.** No currency, no clay budget, no cost per
  firing. The player already paid for the app.
- **No timer anywhere.** The kiln is instant-ish and the rack waits forever.
- **Nothing is gated behind recipes.** Discovering a pair unlocks no glaze, no
  tool, no shape. Discovery is the reward.
- **No nagging.** The `found / total` count is visible when the player opens the
  wall and never pushed at them. No badge on the button, no "3 left to
  complete!", no notification, ever.
- **No sharing, no online wall, no comparing.** Local only, per the standing
  gallery rule.
- **A tile can't fail.** There is no ruined tile and no wasted firing. Every
  result is a result.

---

## Data model

A tile is fully described by which glazes went on it. **The visual is derived,
not stored** — so a tile is about 20 bytes.

```js
// One fired tile on the wall.
{ a: "cobalt", b: "honey" | null, t: 1785312000000 }   // t = fired-at, for wall order
```

That means **localStorage, not IndexedDB** — no image blobs, so no reason to bump
`DB_NAME`/version 2 and write a migration. Even a completionist's 1,128 tiles is
under 30 KB.

```js
const TILES_STORE_KEY = "slip-tiles";   // sits alongside RECIPES_STORE_KEY
```

Load/save mirror `loadDiscoveredRecipes` / `saveDiscoveredRecipes` exactly,
including their try/catch-and-shrug posture, and filter unknown glaze ids on load
so a removed glaze can't break the wall.

Dedupe on `a|b` sorted, same key shape as `RECIPE_KEYS`. Re-firing a pair you
already have updates its timestamp rather than adding a duplicate tile — a wall
of the same tile six times is noise.

---

## Rendering a tile

**Do not build a 3D slab.** Tiles render as 2D canvas (or pure CSS gradients),
using the same colour data the shader uses. What matters about a test tile is the
colour, and the colour maths is already written.

A tile is a rounded rect, taller than wide, with three horizontal bands:

| Band | Colour source |
|------|---------------|
| Top (glaze A alone) | `GLAZES[a].fired.color`, or `.raw.color` before firing |
| Middle (the overlap) | `reactGlaze(firedA, firedB)` — the existing function |
| Bottom (glaze B alone) | `GLAZES[b].fired.color` |

Single-glaze tiles are one band. `reactGlaze` already resolves curated pairs
first and falls back to `blendGlaze`, so the tile and the pot cannot disagree
about what a combination looks like — that's the reason to call it rather than
reimplement.

To read as ceramic rather than as a swatch, borrow what the pot already does:

- A soft drip edge where each band ends, not a ruler-straight line.
- A little speckle for the Stoneware pack (it already has speckle/crackle).
- A slight sheen on fired tiles and a flat chalky look on raw ones — the same
  raw→fired story the kiln tells on a pot, in miniature.
- A hanging hole at the top. Real test tiles have one. It costs nothing and it's
  the detail that makes the object read as real.

---

## UI

### Fold the recipe journal into the wall

The wall and the journal are the same subject, so **don't add a second modal** —
make the journal a tab of the wall. Net UI surface stays flat.

```
┌─ The wall ───────────────────────────┐
│  [ Wall ]  [ Recipes ]         12/21 │
│                                      │
│   ▓▓  ▓▓  ▓▓  ▓▓  ▓▓  ▓▓             │   ← fired tiles, newest first
│   ▓▓  ▓▓  ▓▓                         │
│                                      │
│  ─────────── the rack ────────────   │
│   ░░  ░░  ░░  ▫︎  ▫︎  ▫︎               │   ← up to 6, raw
│           [ Fire the rack ]          │
└──────────────────────────────────────┘
```

- **Wall tab** — every tile fired, newest first. Tapping one names its glazes and
  its result. Named recipes get their name; unnamed ones just say what they are.
- **Recipes tab** — the existing `renderRecipeGrid()` output, unchanged.
- **The rack** — up to six slots. Tap a slot to pick glaze A, tap again for an
  optional B. Reuse the existing glaze picker rows and pack tabs wholesale.
- **Fire the rack** — disabled when empty; otherwise always available.

`recipeCount` moves into the header and keeps its `found / total` format.

### Entry point

A wall button beside the gallery button, on the landing and at the fired stage.
Same corner-button treatment, same 44px target the v202 sweep established.

### The firing moment

Reuse the kiln vignette and `playSfx("kiln")`, compressed to about 1.2 s — this
is a modal, so no camera work is needed. The raw→fired colour transition is the
whole show; let it be a real tween rather than a swap.

Respect `reduceMotion` the way the pot kiln now does: skip the vignette writes
entirely and cut the duration, per the lesson in the v192 commit (a CSS-only
reduced-motion pass isn't enough when JS writes inline styles).

---

## Integration points

Everything below already exists in `main.js` at v224.

| What | Where | Change |
|------|-------|--------|
| `REACTION_PAIRS`, `RECIPE_KEYS`, `RECIPE_KEY_SET`, `RECIPE_NAMES` | ~496–552 | Read as-is. Grow the table (see below). |
| `reactGlaze` / `blendGlaze` / `FIRED_HEX_TO_ID` | ~478–540 | Call as-is. Do not reimplement. |
| `checkRecipeDiscoveries()` | ~8762 | **Refactor.** It currently reads `state.dips` directly. Extract `recordRecipePairs(ids)` taking a plain array of glaze ids; the pot path passes its dip ids, the tile path passes the tile's one or two. Toast and persistence stay shared. |
| `loadDiscoveredRecipes` / `saveDiscoveredRecipes` | ~8750 | Reuse untouched. |
| `renderRecipeGrid` / `openRecipes` / `closeRecipes` | ~8781–8830 | Becomes a tab inside the wall modal. |
| `showToast`, `haptic` | ~8831 | Reuse. |
| `trapFocus` / `releaseFocus` | v192 | **Required** — the wall is a dialog, and it can raise a glaze picker on top of itself, which is exactly what the focus stack was built for. Escape closes. |
| `GLAZES`, `glaze()`, `GLAZE_PACKS` | ~250, ~439 | Read for names, raw and fired colours, and the pack tabs. |
| `reduceMotion`, `REDUCED_FIRING_DURATION` | v192 | Gate the firing animation. |
| `window.__slip` | ~1929 | Add `openWall`, `fireRack`, `tiles()`, `clearTiles` — the preview pane has rAF paused, so the wall must be drivable and assertable from a page script. |
| `index.html` `?v=` | — | Bump on every change, as always. |

**Declaration order:** `TILES_STORE_KEY` and any new table are top-level consts.
If anything is read by the `state` object literal, it must be declared **above**
`state` — the v189 bottom-boot fix cures TDZ on the `init()` path only, not
ordering between top-level initialisers.

**Pointer events:** if the rack lives inside a container with
`pointer-events: none` (the `.deco-stack` pattern), every interactive control
inside needs `pointer-events: auto`. Programmatic `.click()` ignores this, so
automated tests will not catch it. This has cost hours before.

---

## Grow the reaction table

**This is the content half of the feature and it's pure data.**

The wall makes experimentation cheap, which means 21 curated pairs will feel thin
almost immediately — a motivated player can now try dozens of combinations in a
sitting. The table should grow to something like **60–80 pairs**, spread across
all six glaze packs rather than concentrated in Studio and Modern.

This is Lane-1 work in the sense the value pass already established: no new art,
no new assets, just more of the thing that's already good. Every added pair is
one line of hex and one name.

Worth seeding a few deliberately delightful ones — the tortoiseshell that Honey
over Tenmoku already gives is the model. Real glaze names (oxblood, celadon
break, tenmoku kaki, chun blue) carry a lot of atmosphere for free.

---

## Build phases

Each phase is shippable on its own. Stop after any of them.

**Phase 1 — the wall exists.** Tile data model, localStorage, 2D tile rendering,
the wall modal with the journal folded in as a tab. Rack of six, pick one or two
glazes per tile, fire, pin. `recordRecipePairs` refactored so tile firings feed
the existing journal. This is the whole feature in its simplest honest form.

**Phase 2 — make it feel like a kiln.** The firing tween, kiln SFX, drip edges,
speckle on Stoneware tiles, the hanging hole, raw-vs-fired sheen.

**Phase 3 — grow the table.** 21 → 60–80 curated pairs with names.

**Phase 4 — depth, if it's earned.** Only if the wall proves it gets used:

- **Thickness.** Real tiles are dipped at an angle so one end is thick and the
  other thin, and many glazes break completely differently at the two. This is
  the single most authentic axis left and it doubles the information per tile.
- **Pin a tile to a pot.** From the wall, "use this combination" arms both glazes
  on the next pot you dip — closing the loop from experiment back to making.
- **Name your own tiles.** The gallery already lets you rename a pot.

---

## Open questions for Onion

1. **Where should the wall live?** A modal beside the gallery is the cheap answer.
   The atmospheric answer is a real wall in the studio you turn to look at — more
   charming, considerably more work, and it fights the existing modal pattern.
2. **Should a tile show the glaze names before firing, or only after?** Hiding
   them makes it more of a surprise; showing them makes it a usable reference
   tool. My instinct is show them — a real test tile has the recipe written on the
   back, and the surprise is the *colour*, not which glazes you picked.
3. **Six tiles per rack?** Picked to feel like a batch without becoming a chore
   to fill. Easy to change.
4. **Should the rack persist across sessions,** so an unfired rack is still there
   tomorrow? Leaning yes — it's a studio, and leaving work out overnight is what
   studios are for.
