# gazonionaire/CLAUDE.md

Game-specific guidance for Claude Code when working in `gazonionaire/`. The repo-root `../CLAUDE.md` covers the static-site basics (no build, no tests, GH Pages, local server); this file covers what's unique to this game.

## Architecture: data / rules / DOM split

Three JS files, loaded in this exact order from [index.html](index.html):

1. **[js/data.js](js/data.js)** — static tables only (GOODS, LOCATIONS, EVENTS, LOCAL_EVENTS, TICKER_SEEDS, SHIPS, SHIP_SPRITES, PLANET_SPRITES, COMPETITORS, FUEL_PRICES) plus pure helpers (`distance`, `travelCost`, `travelDays`, `travelFuel`, `fuelBasePrice`, `goodName`, `locById`, `fmt`). Wrapped in an IIFE that exports `GAME_DATA`.
2. **[js/game.js](js/game.js)** — pure state + rules. Reads `GAME_DATA`, exposes the global `Game` (state, MODES, CONFIG, `newGame`, `buy`, `sell`, `travel`, `borrow`, `repay`, `buyFuel`, `waitOneDay`, `priceOf`, `netWorth`, etc.). **No DOM access.** A `document.*` reference inside game.js is a bug.
3. **[js/ui.js](js/ui.js)** — DOM rendering, event wiring, audio playback. Reads `Game` + `GAME_DATA`, never touches game state directly except by calling `Game.*` methods. **No game-rule logic.** A new game mechanic does not live here.

Preserve this split when editing. The current ordering means `game.js` sees `GAME_DATA` and `ui.js` sees both. Adding a new file? Slot it in the same `<script>` chain in `index.html`.

## Sprite atlases

Two consolidated atlases, same pattern: one PNG, one JSON of per-frame coords, mirrored hand-typed into [js/data.js](js/data.js).

| Atlas | PNG | JSON | data.js export | Frame keys |
|---|---|---|---|---|
| Ships | [ships.png](assets/sprites/ships.png) (2514×1508) | [ships.json](assets/sprites/ships.json) | `SHIP_SPRITES` | `eyeball`, `skull`, `spider`, `squid`, `submarine`, `whale`, `worm`, `bee`, `bottle`, `brain`, `cube`, `cyber` |
| Planets | [planets.png](assets/sprites/planets.png) (4325×3380, **22 MB**) | [planets.json](assets/sprites/planets.json) | `PLANET_SPRITES` | `terra-prime`, `ledger-hub`, `kallis-rock`, `vroom-outpost`, `obsidian-spire`, `halcyon-junk`, `caldera-9`, `bubble-erebus`, `pavonis-clouds`, `solenne-gardens`, `threnody-stack`, `yoxai-jungle` |

`SHIPS[].sprite` is a key into `SHIP_SPRITES.frames`. `LOCATIONS[].planetSprite` is a key into `PLANET_SPRITES.frames`. **The planet sprite key is *not* the location id** (e.g. `goog → "threnody-stack"`, `obsid → "obsidian-spire"`, `zeph → "ledger-hub"`) — keep the existing mapping in `LOCATIONS` when renaming.

`applySprite(boxEl, key, w, h, atlas?)` in [js/ui.js](js/ui.js) renders either atlas — defaults to `SHIP_SPRITES`, pass `PLANET_SPRITES` (or any atlas with `{src, sheetW, sheetH, frames}`) for planets.

**Don't revert `applySprite` to a single `<div>` with a centered `background-image`.** Frames are non-square, so the empty padding inside a square box used to leak neighboring sprites through (e.g. whale's bottom band exposed bottle directly below it on the sheet). The current code renders into an inner `.sprite-frame` div sized **exactly** to the scaled frame, centered with flex — that clips neighbors at the inner div's bounds. If you change the function, reverify in the ship picker AND the star map that adjacent frames don't bleed through.

**To add a ship/planet**: extend the PNG, update the JSON, mirror the new frame in `SHIP_SPRITES.frames` / `PLANET_SPRITES.frames` in [js/data.js](js/data.js), then either append a `SHIPS` entry or set `planetSprite` on a `LOCATIONS` entry. There is **no** `sheet:` field on `SHIPS` anymore (consolidated single-sheet design). Legacy [ships-one.png](assets/sprites/ships-one.png) / [ships-two.png](assets/sprites/ships-two.png) are still on disk but unreferenced — safe to delete.

## Star map (Travel panel)

The Travel sub-panel is a visual planet picker. DOM (in [index.html](index.html), inside `#side-panel`):

```
#travel-panel.sub-panel
├── #travel-map.travel-map           ← 220px-tall windowed viewport
│   ├── #map-bg                      ← static background (placeholder CSS starfield)
│   ├── #map-viewport                ← absolute-positioned planet nodes + ship marker
│   └── #map-tip                     ← "Docked at X. Click a planet to plot a course."
└── #travel-list                     ← original list, kept as accessible fallback
```

`renderTravelMap()` in [js/ui.js](js/ui.js): viewport center = player's current location; every other planet positioned at `(loc.x - here.x) * SCALE` px relative to center, with `SCALE = 0.62`. Planets near the edges clip — that's intentional, the user said "planets … move around the background based on the user's current planet location". The ship marker uses the player's `state.shipId` sprite from `SHIP_SPRITES`, hovers above the current planet, and has a CSS `ship-bob` animation.

Both the map and `#travel-list` route clicks through `attemptTravel(destId)` — that's the single place that calls `Game.travel()`, plays the `travel` sfx, and chains the post-travel modal queue (lore on first visit → local event → global event → game-over). New post-travel side effects belong there.

To **swap the placeholder starfield** for real art: replace the `.map-bg` CSS rule (currently radial-gradient stars) with `background: url("…") center/cover no-repeat;`. Don't add a new `<img>` — the bg div is already in place.

## Ship audio (per-ship ambient)

A ship card click plays an ambient loop tied to that ship via element id `sfx-ship-<ship.id>`. The `<audio>` elements live at the bottom of [index.html](index.html). `assets/sounds/bee-ambient.mp3` is the only one currently shipping; the rest are placeholder `<id>-ambient.mp3` filenames. Missing files fail silently per [assets/sounds/README.txt](assets/sounds/README.txt). To wire a new ambient, drop the file in `assets/sounds/` matching the audio element's `src`.

Game event audio uses a separate `sfx-<event>` id convention (`click`, `ship`, `buy`, `sell`, `travel`, `event`, `good`, `bad`). Same silent-fail rule.

## Location-id consistency

Each location's `id` is the join key for **three other tables**. When renaming a location id, update all four:

- `LOCATIONS[].id` in [js/data.js](js/data.js)
- `LOCAL_EVENTS[id]` keys (the per-location event arrays)
- `FUEL_PRICES[id]` (per-location fuel prices)
- Any references in `EVENTS[].apply` or `LOCAL_EVENTS[*][].apply` bodies

`LOCATIONS[].icon` (`loc_<id>.png`) and `LOCATIONS[].planetSprite` (key into `PLANET_SPRITES.frames`) are **independent string fields** — neither has to match the id. Keeping `loc_thren.png` as the icon for the `goog` location, or `planetSprite: "threnody-stack"` for `goog`, is fine. The `THRENODY` competitor is also independent of the location id.

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
- **Add/edit a location** — `LOCATIONS` array, plus matching `LOCAL_EVENTS[id]` and `FUEL_PRICES[id]` entries. Coordinates `x,y` drive `distance()` → fuel + travel days, **and** the planet's position on the star map (relative to whichever planet the player is currently docked at).
- **Add a random event** — append to `EVENTS` (global, post-travel) or `LOCAL_EVENTS[id]` (per-location). `apply(g)` returns a resolution string and may mutate `g.cargo`, `g.cash`, `g.priceMods`, `g.market[g.location]`, or `g.tickerQueue`.
- **Tweak difficulty** — `Game.MODES` in [js/game.js](js/game.js): startCash, maxDays, goal, hold cap, interest rate, event-table density.
- **Change loan rules** — `Game.borrow` / `Game.repay` in [js/game.js](js/game.js); UI buttons and labels in [js/ui.js](js/ui.js)'s bank section + [index.html](index.html).
- **Swap a planet sprite** — extend `planets.png`, update `planets.json`, mirror the frame in `PLANET_SPRITES.frames` in [js/data.js](js/data.js), then point `LOCATIONS[i].planetSprite` at the new key.
- **Replace the star-map background** — the `.map-bg` CSS rule in [css/style.css](css/style.css) currently paints a radial-gradient starfield placeholder. Swap that ruleset for `background: url("assets/.../starfield.png") center/cover no-repeat;` once real art lands. Don't add a new `<img>`.
- **Tune star-map density** — `SCALE` constant in `renderTravelMap()` (currently `0.62` px/location-unit). Larger = planets spread further, more clip off-edge; smaller = everything squeezed near center. Viewport size is set on `.travel-map` in CSS.
- **Hook a new post-travel side effect** — add it inside `attemptTravel(destId)` in [js/ui.js](js/ui.js), not at every call site. The map and the list both route through it.

## Gotchas

- **Single-quoted strings in [js/data.js](js/data.js) must use curly apostrophes (’) for inner quotes.** A straight `'` inside a `'…'` string silently breaks the parse and leaves `GAME_DATA` undefined — no console error in the file panel, just a syntax error you'll only spot in DevTools. The flavor text in `COMPETITORS` already follows this convention. Same trap applies to bracketed quotes — write `‘Sky-Parties’`, not `'Sky-Parties'`.
- **`planets.png` is 22 MB.** Browsers cache it after first load, but full-page screenshot capture (e.g. `preview_screenshot`) can time out while it decodes. DOM inspection via `preview_eval` is reliable for verifying map state. Be deliberate about expanding the atlas.
- **Verify the map after editing `applySprite`.** Both the ship picker AND the star map use it. Adjacent-frame bleed regressions show up first on whatever atlas has the tightest packing — currently the ship sheet.
- **Worktree ↔ main-repo asset drift.** Multiple worktrees live under `.claude/worktrees/`; new binary assets dropped into the *main* working tree (or a sibling worktree) won't be in yours. If `data.js` references a sprite key but the rendered output is solid black, check that the matching PNG/JSON actually exists at the expected path *in your worktree* before debugging the code.
