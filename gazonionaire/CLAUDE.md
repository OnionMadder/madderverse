# gazonionaire/CLAUDE.md

Game-specific guidance for Claude Code when working in `gazonionaire/`. The repo-root `../CLAUDE.md` covers the static-site basics (no build, no tests, GH Pages, local server); this file covers what's unique to this game.

## Architecture: data / rules / DOM split

Three JS files, loaded in this exact order from [index.html](index.html):

1. **[js/data.js](js/data.js)** — static tables only (GOODS, LOCATIONS, EVENTS, LOCAL_EVENTS, TICKER_SEEDS, SHIPS, SHIP_SPRITES, COMPETITORS, FUEL_PRICES) plus pure helpers (`distance`, `travelCost`, `travelDays`, `travelFuel`, `fuelBasePrice`, `goodName`, `locById`, `fmt`). Wrapped in an IIFE that exports `GAME_DATA`.
2. **[js/game.js](js/game.js)** — pure state + rules. Reads `GAME_DATA`, exposes the global `Game` (state, MODES, CONFIG, `newGame`, `buy`, `sell`, `travel`, `borrow`, `repay`, `buyFuel`, `waitOneDay`, `priceOf`, `netWorth`, etc.). **No DOM access.** A `document.*` reference inside game.js is a bug.
3. **[js/ui.js](js/ui.js)** — DOM rendering, event wiring, audio playback. Reads `Game` + `GAME_DATA`, never touches game state directly except by calling `Game.*` methods. **No game-rule logic.** A new game mechanic does not live here.

Preserve this split when editing. The current ordering means `game.js` sees `GAME_DATA` and `ui.js` sees both. Adding a new file? Slot it in the same `<script>` chain in `index.html`.

## Sprite atlas

**Single consolidated sheet** at [assets/sprites/ships.png](assets/sprites/ships.png) (2514×1508), with per-frame coordinates in [assets/sprites/ships.json](assets/sprites/ships.json) and mirrored hand-typed in `SHIP_SPRITES.frames` in [js/data.js](js/data.js). The legacy [ships-one.png](assets/sprites/ships-one.png) / [ships-two.png](assets/sprites/ships-two.png) and their JSONs are still on disk but no longer referenced — safe to delete once you're confident.

**Don't revert `applySprite` in [js/ui.js](js/ui.js) to a single `<div>` with a centered `background-image`.** Frames are non-square, so the empty padding inside a square box used to leak neighboring sprites through (e.g. whale's bottom band exposed bottle which sits directly below it on the sheet). The current code renders into an inner `.sprite-frame` div sized **exactly** to the scaled frame, centered with flex inside the outer box — that clips neighbors at the inner div's bounds. If you change the function, reverify in the ship picker that adjacent frames don't bleed through.

**To add a ship**: extend the sprite sheet, update `ships.json`, mirror the new frame in `SHIP_SPRITES.frames` in [js/data.js](js/data.js), then append a `SHIPS` entry. The `sprite:` field on a ship is just a key into `SHIP_SPRITES.frames`. There is **no** `sheet:` field anymore (consolidated single-sheet design).

## Ship audio (per-ship ambient)

A ship card click plays an ambient loop tied to that ship via element id `sfx-ship-<ship.id>`. The `<audio>` elements live at the bottom of [index.html](index.html). `assets/sounds/bee-ambient.mp3` is the only one currently shipping; the rest are placeholder `<id>-ambient.mp3` filenames. Missing files fail silently per [assets/sounds/README.txt](assets/sounds/README.txt). To wire a new ambient, drop the file in `assets/sounds/` matching the audio element's `src`.

Game event audio uses a separate `sfx-<event>` id convention (`click`, `ship`, `buy`, `sell`, `travel`, `event`, `good`, `bad`). Same silent-fail rule.

## Location-id consistency

Each location's `id` is the join key for **three other tables**. When renaming a location id, update all four:

- `LOCATIONS[].id` in [js/data.js](js/data.js)
- `LOCAL_EVENTS[id]` keys (the per-location event arrays)
- `FUEL_PRICES[id]` (per-location fuel prices)
- Any references in `EVENTS[].apply` or `LOCAL_EVENTS[*][].apply` bodies

The icon filename `loc_<id>.png` is naming-only — keeping `loc_thren.png` as the icon for the `goog` location is fine. The `THRENODY` competitor is independent of the location id.

## Data-only fields with no game logic yet

These fields exist on data records but **do not affect gameplay** until corresponding logic is added:

- `SHIPS[].passCap` — passenger berth count
- `SHIPS[].maint` — daily maintenance cost
- `LOCATIONS[].canLoan` — marks the sector's banking hub (only `zeph` has it)

If asked to "make ship maintenance cost credits each day", the work is in [js/game.js](js/game.js) day-tick logic, not just touching `data.js`.

## Brand & meta

- Brand: **The Madderverse** (legacy: FYMZ / "Find Your Madder Zone" — leave old `<meta name="keywords">` alone unless explicitly migrating).
- Domain: `madderverse.org`. Absolute URLs are intentional for canonical/og/twitter/favicon/manifest tags (consumed by external scrapers and PWA installers). **Don't switch them to relative paths** — root [`../CLAUDE.md`](../CLAUDE.md) explains why.
- In-game CSS/JS: relative paths (`css/style.css`, `js/data.js`, etc.). Don't change these to absolute production URLs — that breaks local dev.
- Analytics: GoatCounter beacon `https://madderverse.goatcounter.com/count` (same as the rest of the hub).
- Footer year: inline `document.getElementById("year").textContent = new Date().getFullYear()`.

## Local dev

```bash
python3 -m http.server 8000
# then http://localhost:8000/gazonionaire/
```

Opening `index.html` via `file://` is **not** equivalent — relative `fetch()`-style asset paths break under file://. Always serve over HTTP.

## Common workflows

- **Add/edit a commodity** — `GOODS` in [js/data.js](js/data.js). Make sure at least one location `produces` and at least one `demands` it, otherwise it never moves price.
- **Add/edit a location** — `LOCATIONS` array, plus matching `LOCAL_EVENTS[id]` and `FUEL_PRICES[id]` entries. Coordinates `x,y` drive `distance()` → fuel + travel days.
- **Add a random event** — append to `EVENTS` (global, post-travel) or `LOCAL_EVENTS[id]` (per-location). `apply(g)` returns a resolution string and may mutate `g.cargo`, `g.cash`, `g.priceMods`, `g.market[g.location]`, or `g.tickerQueue`.
- **Tweak difficulty** — `Game.MODES` in [js/game.js](js/game.js): startCash, maxDays, goal, hold cap, interest rate, event-table density.
- **Change loan rules** — `Game.borrow` / `Game.repay` in [js/game.js](js/game.js); UI buttons and labels in [js/ui.js](js/ui.js)'s bank section + [index.html](index.html).
