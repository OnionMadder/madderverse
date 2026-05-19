# Munki Madness — game-specific guidance (v2.0)

**v2.0 is a wholesale rewrite.** The earlier Matter.js iso-tile maze
(v1.0) lives in git history; v2.0 is a **continuous heightmap world**
rendered as a glowing wireframe triangular mesh. The goal is a
**well** — a deep depression the marble falls into via slope gravity.
v1.0 features (tile types, iso projection, level editor, level
catalog) do NOT map forward 1:1; they are being rebuilt phase by phase.

The player ball is just called a **"marble"** (the earlier "Munkable"
name was dropped 2026-05-18; do not reintroduce it). Visually it's a
curled-up Munki (cross-pollination with All Munkis — same character
family + Web-Audio engine signature). Game *title* stays
**"Munki Madness"**.

Flat-shape game (matches the repo convention): `index.html` + `game.js`
+ `style.css` at the root. No build system — files ship to the browser
as-is.

## Files

- `index.html` — page + the **dev-only editor gate** (a tiny inline
  script that injects `editor.js` *only* on `?editor=1` or the Konami
  code; zero footprint in normal play). `editor.js` is rebuilt in
  Phase 3; until then the gate is harmlessly inert.
- `game.js` — engine: heightmap data model + bilinear interp +
  gradient gravity + marble physics + Canvas2D wireframe rendering +
  tilt/drag/keyboard input + `?tune=1` live tune. Exposes `window.MM`
  (`getBundledLevels` / `playLevel`) as the editor bridge.
- `style.css` — dark wireframe-aesthetic page chrome (badges, overlays,
  buttons). Game canvas background is a deep space-blue radial.
- `PHYSICS_SPEC.md` — the locked Phase 1 spec (heightmap model,
  gradient gravity, well capture, projection, tune knobs).

## v2.0 phase plan

1. **Phase 1 — heightmap physics + wireframe rendering + well-as-goal.**
   Engine foundation. One built-in tutorial level. *Current commit.*
2. **Phase 2 — obstacle types** layered on top of the mesh: reverse-gravity
   zones, bumpers, ice, mud, conveyors, wind, tractor wells.
3. **Phase 3 — sculptural level editor** (`?editor=1` / Konami). Press /
   pull / smooth / flatten brushes for the terrain itself, obstacle
   palette drag-and-drop, spawn + well placement, save/load JSON.
   Gloved-hand cursor matching the wireframe aesthetic.
4. **Phase 4 — audio + polish.** Bala's Song background, rolling SFX
   scaled by velocity, whoosh on well entry, "captured!" on goal-reach,
   reverse-gravity hum. All Web Audio synthesized.
5. **Phase 5 — 5 test levels** built using the new physics.

User playtests between phases; `claude/busy-hopper-647bab` pushes
directly to `main` as fast-forwards (memory rule:
`project_munki_madness` — "iso marble maze; chunked, push direct to
main, pause per chunk; isolation rule does NOT apply"). The
All-Munkis v1.0/v1.1 branch-isolation rule does **not** apply here.

## Level model

Phase 1 ships **one built-in level** built programmatically in
`buildTutorialLevel()`. The runtime level object is:

```js
{
  title:   string,
  hm:      HeightMap,           // gw × gh cells, (gw+1) × (gh+1) corners
  spawn:   { x, y },            // cell coords
  well:    { x, y, captureR },  // cell coords, capture radius (cells)
  time:    seconds,             // 3★ budget reference
  physics: null | { ... }       // sparse override on BASE_PHYS
}
```

Phase 5 will load JSON levels from `levels/*.json` (the old v1.0
`levels/` files were removed in the rewrite — they don't translate to
the heightmap model). The portable JSON schema lands with the editor
in Phase 3.

## Per-level physics override

A level may carry a sparse `"physics"` block listing only the knobs it
overrides. `effectivePhysics(level.physics)` overlays it onto
`BASE_PHYS` (clamped per `clampPhys`). Allowed keys mirror the
`?tune=1` panel: `ACCEL`, `MAX_SPEED`, `WALL_BOUNCE`,
`FRICTION_FLOOR`, `GRAVITY_K`, `TILT_FORCE_MULTIPLIER`. Levels with
no block keep the global feel byte-identical. The Live Tune panel's
**Copy physics block** emits a paste-ready sparse block.

## Storage abstraction (UGC seam, deferred to Phase 3)

The v1.0 `LevelStorage` interface (sync/async LocalLevelStorage →
RemoteLevelStorage drop-in) carries forward conceptually but is not
materialised in Phase 1 — there's nothing to store yet. Phase 3 brings
it back as part of the editor.

## Workflow notes

- Build in phases; commit per phase; push direct to `main` as a clean
  fast-forward of `origin/main` (never force). Pause for user feedback
  between phases.
- Not linked from the hub `index.html` (intentionally unadvertised
  until v2.0 is further along).
