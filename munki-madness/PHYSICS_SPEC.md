# Munki Madness — Physics + Tile Spec v1.0 (LOCKED)

Source of truth for the engine. Locked 2026-05-17. Future sessions: build
to match this exactly; change the spec here first if behaviour must change.

## Marble feel: heavy metal ball (pinball weight)

Tunable constants at the top of `game.js`:

| Constant | v1.0 value | Meaning |
|---|---|---|
| `ACCEL` | `14` | input push force (heavy but responsive; between old snappy 16 and the too-slow 8) |
| `MAX_SPEED` | `6` | top speed (tiles/s), unchanged |
| `WALL_BOUNCE` | `0.4` | wall restitution — satisfying pinball bonk recovery |
| `FRICTION_FLOOR` | `0.92` | default per-frame (@60fps) velocity multiplier |
| `BUMPER_FORCE` | `4` | instantaneous velocity-add a bumper imparts |
| `GRAVITY` | `0` | no gravity in v1 (flat plane); reserved for Endeavor |

The Munkable should feel like a steel ball-bearing on a wood-and-plastic
maze toy: slow to start, slow to stop, lots of mid-roll momentum. Players
win through careful control, not snap reflexes.

Drag values are **per-frame multipliers referenced to 60fps** and are
applied frame-rate-independently in the engine (converted per physics
substep as `drag^(dt*60)`).

## Surfaces (3 tile types)

| Tile | drag | grip | Visual |
|---|---|---|---|
| `floor` | 0.92 (normal) | 1.0 | standard isometric tile (purple) |
| `gravel` | 0.78 (sticky) | 1.0 | brown speckled tile |
| `ice` | 0.99 (glides) | 0.3 (weak steering) | pale blue, subtle shimmer |

Higher drag = retains more velocity (0.99 ice glides far; 0.78 gravel
bites). grip multiplies control acceleration on that surface.

## Traps (3 types)

- **Hole** — kill tile. When the Munkable's *center* crosses a hole:
  fall animation (scale-down + opacity fade over **350ms**) + the
  descending scream SFX, then a **600ms** beat, then respawn at the
  level `spawn`. `attempts` increments. Visual: dark pit with rough rim.
- **Bumper** — directional force tile, `direction: N|S|E|W`. On contact,
  an instantaneous velocity-add in that direction (`BUMPER_FORCE`,
  default 4). "thunk" SFX + small flash. Visual: colored arrow tile.
  Fires once per entry.
- **Spinner** — velocity rotator, `rotation: CW90|CCW90` (v1; `CW45`
  etc. reserved for v1.1). On the center crossing the tile, the velocity
  vector rotates by the configured amount. "whoosh" SFX. Visual: swirl
  icon + rotating arrow. Fires once per entry.

## Win condition + star rating

Single `goal` tile per level. Reaching it = level-complete with stars:

- **1 star** — completed (always granted on goal-reach)
- **2 stars** — completed with zero falls (no hole respawns)
- **3 stars** — zero falls AND under the level's `target_time_ms`

Each level JSON sets `target_time_ms` (default: a reasonable medium
target if omitted).

## Death / fail

Only a hole kills. Board edges are hard walls (cannot fall off). Infinite
retries, no game-over screen — respawn at `spawn`, `attempts` visible.

## Time pressure: soft

A visible clock counts **up** during play. Bonus star if under
`target_time_ms`. No fail-state on running long.

## Control modes

- **Tilt** (DeviceOrientation) — default on mobile
- **Drag-anywhere** — default on desktop, fallback on tilt-less devices
- **Keyboard arrows/WASD (+gamepad)** — always-on desktop convenience
- **Toggle** cycles: Tilt-only / Drag-only / Both-active

## Grid: variable per level

Each level JSON sets `grid: { w, h }`. 8x8 (tutorial) up to 32x32 (deep).
Rendering scales to viewport. Board edge is implicitly a hard wall.

## Level JSON schema (v1.0)

```json
{
  "name": "First Roll",
  "grid": { "w": 8, "h": 7 },
  "target_time_ms": 20000,
  "tiles": [
    { "x": 1, "y": 1, "type": "spawn" },
    { "x": 6, "y": 5, "type": "goal" },
    { "x": 3, "y": 3, "type": "hole" },
    { "x": 2, "y": 4, "type": "bumper", "direction": "E" },
    { "x": 5, "y": 2, "type": "spinner", "rotation": "CW90" },
    { "x": 4, "y": 1, "type": "gravel" },
    { "x": 1, "y": 5, "type": "ice" },
    { "x": 3, "y": 1, "type": "wall" }
  ]
}
```

Tile types: `floor` `gravel` `ice` `wall` `hole` `bumper`(+`direction`)
`spinner`(+`rotation`) `spawn` `goal`. **Cells not listed default to
`floor`.** Exactly one `spawn` and one `goal` per level. `spawn`/`goal`
roll like floor (visual-only special). `wall` is impassable.

## Audio (Web Audio synthesis only)

- Rolling: filtered brown noise, gain + cutoff scaled by velocity; silent
  when stationary.
- Wall bonk squeak: pitch by impact speed (unchanged).
- Hole scream: descending saw ~600→80Hz with wobble.
- Bumper thunk: low percussive pop on contact.
- Spinner whoosh: rising swirl on contact.
- Goal chime: C-E-G sine arpeggio ~200ms.
- **BG music slot**: empty; reserved for the harmonized Bala's Song once
  `madderverse/lib/audio/` is extracted.

## Rendering

Isometric Canvas2D. `screenX=(wx-wy)*tileW/2; screenY=(wx+wy)*tileH/2`
(render-only). Each tile type has a distinct visual identity per the
tables above.
