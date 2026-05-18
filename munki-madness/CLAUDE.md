# Munki Madness — game-specific guidance

Marble-Madness-style isometric maze. The player ball is just called a
**"marble"** — the old "marble" name was dropped (2026-05-18); keep it
"marble" in code, UI, and docs. Visually it's a curled-up Munki
(deliberate cross-pollination with All Munkis — same character family +
Web-Audio engine signature). Game *title* stays **"Munki Madness"**.
Internals: physics object `marble`; the curl/roll-animation class is
`Marble` with instance `marbleAnim` (distinct from the `marble` object);
sprite files are `marble-curl-1..5.png` + `marble-ball.png`.

Flat-shape game (matches the repo convention): `index.html` + `game.js` +
`style.css` + `editor.js` at the root, `assets/` and `levels/` alongside.
No build system — files ship to the browser as-is.

## Files

- `index.html` — page + the **dev-only editor gate** (a tiny inline
  script that injects `editor.js` *only* on `?editor=1` or the Konami
  code; zero footprint in normal play).
- `game.js` — engine: Matter.js physics (vendored at
  `assets/vendor/matter.min.js`, MIT), iso projection (render-only),
  tilt+drag controls, Web-Audio synthesis, level state machine. Exposes
  `window.MM` (`loadCatalog` / `getBundledLevels` / `playLevel`) as the
  editor bridge.
- `editor.js` — dev-only level editor (see UGC roadmap below).
- `levels/*.json` + `levels/index.json` — the curated launch catalog.
- `assets/sprites/SPRITES_README.md` — marble sprite hand-off spec
  (`USE_SPRITES` flag in game.js flips placeholder → real art).

## Two level representations (intentional)

1. **Curated catalog** (`levels/*.json`, listed in `levels/index.json`):
   the readable form `{ "name", "time", "rows": ["####", ...] }`. Kept
   deliberately terse for clean git diffs and hand-tweaking. This is
   repo-authored content, NOT user content.
2. **Editor / UGC portable schema** (`schema_version: 1`): self-contained
   and portable, emitted by the editor's Save / Export File. Carries
   every UGC field from day one so v1.5 needs **no schema migration**.

`game.js normalizeLevel()` accepts BOTH (`title||name`, `tiles||rows||grid`).
Tile alphabet (shared by both): `#` wall · `.` floor · `S` slow/sticky ·
`I` ice · `O` hole · `@` spawn · `G` goal.

### Portable schema v1

```json
{
  "schema_version": 1,
  "level_id": "<uuid, minted on first save, then preserved>",
  "title": "<user name>",
  "author": "ME",                 // v1.5: user's creator handle
  "created_at": "<ISO>", "updated_at": "<ISO>",
  "grid_dimensions": { "w": 16, "h": 16 },
  "tiles": ["####", "#@.G", ...], // array of row strings
  "spawn": { "x": .., "y": .. },
  "goals": [{ "x": .., "y": .. }],
  "metadata": { "tags": [], "estimated_difficulty": null, "creator_notes": "" },
  "stats": { "plays": 0, "attempts_per_play": [], "completions": 0, "best_time_ms": null },
  "time": 60                      // engine time budget (extra top-level)
}
```
Fields without UI in v1.0 are still written so v1.5 populates them
naturally. `stats` accumulates locally in v1.0; v1.5 syncs to server.

### Storage abstraction (the load-bearing UGC seam)

`editor.js` defines a `LevelStorage` interface; the editor UI talks ONLY
to the bound `Storage` instance, never to `localStorage` directly. All
methods (`save` / `load` / `list` / `remove`) return Promises.

- **v1.0:** `Storage = new LocalLevelStorage()` — localStorage, id-keyed.
- **v1.5:** `Storage = new RemoteLevelStorage(API_BASE)` — HTTP + local
  cache. Drop-in: **no editor-UI changes**, because the UI is already
  async-against-the-interface.

## Future UGC roadmap

The level editor is the seed of player-facing user-generated content.

- **v1.0 (now): editor is dev-only via Konami code / `?editor=1`.**
  Players *will* find it within days of launch — that's fine, even good.
  Local-only: saves in browser localStorage, Export/Import as portable
  `*.munki-level.json` files. Power users will share levels manually
  (Discord / itch / etc.) before formal sharing exists — embrace it; the
  portable schema is built for exactly that.
- **v1.5 (UGC launch, target ~6–8 weeks post-v1.0):** Cloudflare Worker
  backend at `api.onionmadder.rocks/munki-madness/levels/...` (KV
  storage; same pattern as the existing `onionmadder.rocks` APIs / the
  `push.onionmadder.rocks` worker). New in-game **"COMMUNITY LEVELS"**
  tab: browse user submissions, upvotes/ratings, creator-follow.
  Lightweight moderation: a Report button per level, auto-hide after N
  reports into an admin review queue. Implemented by binding
  `RemoteLevelStorage` — no editor rewrite.
- **v2.0+:** featured community levels in official rotation, a weekly
  community pick promoted in-app, creator profiles with Bronze/Silver/
  Gold badges (by plays/upvotes), eventual revenue share for
  officially-promoted community level packs.

## Chunk plan / status

1. Scaffold + physics + 3 test levels + placeholder marble + audio — **shipped**
2. Real sprite integration + 5-phase curl animation — *blocked on user-supplied art*
3. In-app level editor (dev-only) + UGC-ready portable schema + storage abstraction — **shipped**
4. 30-level launch catalog built via the editor — **shipped** (Claude-drafted, user refines)
5. Daily challenge (date-seeded) + per-level best-time — *next*
6. Cosmetic marble skins (unlock + paid pack)
7. Capacitor wrap for Android + Play Store assets
8. Ghost-run replay feature
9. **(v1.5, separate ship)** UGC backend (Cloudflare Worker) + Community
   Levels tab + moderation pipeline

## Workflow notes

- Build in chunks; commit per chunk; push direct to `main` as a clean
  fast-forward of `origin/main` (never force). Pause for user feedback
  between chunks.
- The All-Munkis v1.0/v1.1 branch-isolation rule does **not** apply to
  this folder — Munki Madness is an isolated, additive sibling game.
- Not linked from the hub `index.html` yet (intentionally unadvertised
  until further along).
