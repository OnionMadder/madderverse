# Munki Madness v2.0 — Physics + Mesh Spec (Phase 1)

Source of truth for the engine. v1.0 (Matter.js iso tile maze) lives in
git history; v2.0 is a continuous heightmap world rendered as a glowing
wireframe mesh. The goal is a **WELL** — a deep depression the marble
falls into and cannot roll back out of.

This document covers Phase 1 (engine foundation). Obstacle layers
(Phase 2), the sculptural editor (Phase 3), audio (Phase 4), and the
level catalog (Phase 5) will extend it in subsequent commits.

## World model

The world is a **grid of corner heights**, not tiles.

- Grid size: `gw × gh` cells → `(gw+1) × (gh+1)` corner heights
  (default Phase 1: 18 × 18).
- Each cell `(cx, cy)` is bounded by corners
  `(cx,cy) (cx+1,cy) (cx,cy+1) (cx+1,cy+1)`.
- Heights are signed scalars; `0` = flat plane, negative = depression
  (well), positive = hill.
- Heights are stored as `Float64Array` of length `(gw+1) × (gh+1)`,
  row-major: `H[i + j*(gw+1)]`.

The marble's world position `(x, y)` is in **cell units** (range
`[MARBLE_R, gw - MARBLE_R] × [MARBLE_R, gh - MARBLE_R]`), not pixels.

## Bilinear elevation

At any world point `(wx, wy)` inside a cell with origin corner
`(i0, j0)` and fractional offsets `fx = wx - i0`, `fy = wy - j0`:

```
top    = h00 + (h10 - h00) * fx
bot    = h01 + (h11 - h01) * fx
height = top + (bot - top) * fy
```

This is a `C^0` continuous surface (smooth within a cell; the gradient
is piecewise-linear across cell boundaries).

## Gradient — the gravity source

Partial derivatives of the same bilinear patch, in `height / cell`:

```
dH/dx = (h10 - h00) + ((h11 - h01) - (h10 - h00)) * fy
dH/dy = (h01 - h00) + ((h11 - h10) - (h01 - h00)) * fx
```

Slope gravity accel applied to the marble each substep:

```
ax_grav = -GRAVITY_K * dH/dx
ay_grav = -GRAVITY_K * dH/dy
```

The marble accelerates **opposite** the gradient (downhill). A well —
which is a Gaussian depression dug into the corners — produces a smooth
radial pull that grows from zero at the rim into a strong central
funnel.

## Marble feel — heavy ball on a curved sheet

Tunable constants at the top of `game.js` (live-tunable via `?tune=1`):

| Constant | v2.0 value | Meaning |
|---|---|---|
| `ACCEL` | `20` | player-input push (cells/s²) |
| `MAX_SPEED` | `7` | top speed (cells/s) |
| `WALL_BOUNCE` | `0.4` | edge restitution — pinball bonk |
| `FRICTION_FLOOR` | `0.955` | per-frame@60 velocity multiplier — higher = heavier (momentum lingers) |
| `GRAVITY_K` | `40` | slope → accel multiplier (see above) |
| `TILT_FULL` | `10°` | deg past the recentred zero that saturates tilt input |
| `TILT_FORCE_MULTIPLIER` | `2.0` | extra tilt-input gain |
| `MARBLE_R` | `0.42` | marble radius (cells); keeps it off the rim |
| `ESCAPE_SPEED` | `2.2` | bowl-speed threshold below which the marble is captured (cells/s) |

The marble should feel **heavy** — gravity dominates, player input
nudges. On a flat plane the marble barely accelerates from tilt alone;
near a well, the slope wins and the player has to actively fight or
guide the pull.

`FRICTION_FLOOR` and `WALL_BOUNCE` must stay strictly less than `1` or
velocity runs away. The `?tune=1` sliders clamp `FRICTION_FLOOR` to
`[0.30, 0.9999]` and `WALL_BOUNCE` to `[0, 0.98]`.

## Integration

Fixed-timestep substepping for determinism across framerates:

```
FIXED_DT     = 1/120 s
MAX_SUBSTEPS = 8       // anti spiral-of-death
```

Each substep:

1. Sample `(h, dH/dx, dH/dy)` at the marble's current position.
2. `ax = -GRAVITY_K * dH/dx + inputX * ACCEL`
   `ay = -GRAVITY_K * dH/dy + inputY * ACCEL`
3. `v += a * dt`
4. Apply drag: `v *= FRICTION_FLOOR ^ (dt * 60)` (frame-rate-independent).
5. Clamp `|v|` to `MAX_SPEED`.
6. `x += vx * dt; y += vy * dt`.
7. Bounce off mesh boundary: clamp `x` to `[MARBLE_R, gw - MARBLE_R]`
   and `y` similarly; invert the offending velocity component with
   `WALL_BOUNCE` restitution.
8. Well check (see next section).

## Goal mechanic — captured by the well

A level defines `well = { x, y, captureR }`. The marble is **captured**
when it is simultaneously:

1. Inside the capture bowl: `distance((x,y), (well.x, well.y)) < captureR`, **and**
2. Too slow to climb back out: `|v| < ESCAPE_SPEED` (Phase 1: `2.2` cells/s),
3. for at least `0.28 s` of continuous dwell (anti-flicker; a marble
   that streaks across the bowl at high speed will not falsely trigger).

While captured, the marble visually **sinks** into the hole (`marble.sink`
ramps `0 → 1` and lifts the marble down into the bowl on screen).

Phase 1 ships **one built-in level**, the **Tutorial Well**:
- 18 × 18 grid, all corners zero except a Gaussian dome `depth=-7.5`,
  `sigma=3.4` centred at the grid middle.
- Spawn at `(2, 2)`, far enough out on the flat to require active
  steering toward the slope before gravity takes over.
- `time = 45s` budget for the 3★ time bracket (`≤22.5s` = 3★,
  `≤36s` = 2★, otherwise 1★).

Phase 5 replaces the built-in with a `levels/*.json` catalog.

## Per-level physics overlay

The constants above are the **global BASE**. A level JSON MAY carry a
sparse `"physics"` block listing only the knobs it overrides:

```json
"physics": {
  "ACCEL": 14,
  "FRICTION_FLOOR": 0.94
}
```

`effectivePhysics(level.physics)` overlays it onto `BASE_PHYS` (clamped
per `clampPhys`). Levels with no `"physics"` block keep the global feel
byte-identical. The `?tune=1` panel's **Copy physics block** button
emits a paste-ready sparse block reflecting any sliders the playtester
moved away from defaults.

Allowed keys: `ACCEL`, `MAX_SPEED`, `WALL_BOUNCE`, `FRICTION_FLOOR`,
`GRAVITY_K`, `TILT_FORCE_MULTIPLIER`. Unknown keys are ignored.

## Input → world acceleration

Three control paths feed the same `(inputX, inputY)` unit-ish vector,
which is multiplied by `ACCEL` and added to slope gravity:

- **Keyboard** (always on): WASD + arrows; full deflection per axis.
- **Tilt** (mobile, opt-in): `DeviceOrientationEvent.gamma` →
  `inputX`, `beta` → `inputY`. Both pass through a `TILT_DEADZONE`
  (`2.5°`) and saturate at `TILT_FULL` (`10°` past the recentered
  zero) × `TILT_FORCE_MULTIPLIER`. A smaller `TILT_FULL` makes
  subtle tilts more authoritative. A **Recenter** button snapshots
  the current orientation as the new neutral.
- **Drag** (touch + mouse): pointer offset from press origin →
  `inputX/Y`, saturating at `DRAG_FULL` (`90 px`).

All three sum, then the combined `(sx, sy)` is renormalised to
magnitude `≤ 1` so combining tilt + keys can't yield a `>1.4` boost.

The `?tune=1` `TILT_FORCE_MULTIPLIER` slider scales the tilt path only.

## Rendering — wireframe triangular mesh

Canvas2D, no WebGL. Each frame:

1. Project every corner `(i, j, H[i,j])` through `project()` into
   screen space, once.
2. Stroke each **row** as a single polyline (horizontal grid lines).
3. Stroke each **column** as a single polyline (vertical grid lines).
4. Stroke all **diagonals** (split each cell into two triangles) in one
   batched path, dimmer than the row/column lines.
5. Stroke three concentric **well rings** at the bowl bottom, sampled
   through `hm.sample` so the rings hug the curved surface.
6. Draw the marble as a glowing radial gradient at its projected
   position, scaled by perspective and the `sink` amount.

Line color tints by row/column **average height** to give a depth cue:
deeper-than-average lines glow more saturated cyan; ridges fade toward
white. `shadowBlur` is applied per stroke pass for the glow.

## Camera — fixed angled topographic view

Fixed for Phase 1 (no rotation). Pitch is the angle of the ground plane
toward the camera; `pitchCos / pitchSin` are precomputed.

```
project(gx, gy, h):
  a       = gx - gw/2
  b       = gy - gh/2
  depthN  = b * pitchSin / gh + 0.5    // ~0 far, ~1 near
  pscale  = 1 / (1 + persp * (1 - depthN))
  screenX = W/2 + a * cell * pscale
  ground  = b * pitchCos
  screenY = H * 0.40 + (ground * cell - h * heightK * cell * 0.5) * pscale
```

Defaults: `pitch ≈ 35.5°` (`cos=0.81, sin=0.58`), `heightK = 0.85`,
`persp = 0.34`. A well's bottom appears as a clear depression on
screen; hills rise off the mesh.

## State machine

`phase ∈ { menu, play, win }`.

- `menu`: start overlay visible; engine still ticks the renderer so
  the menu has a live mesh background.
- `play`: physics runs, timer counts, input feeds.
- `win`: end overlay visible, best time updated.

Restart (`R` / button) increments `attempts`, resets the marble to
spawn, zeroes the timer. Best time is keyed `mm2.best.<levelNum>` in
`localStorage`.

## Editor bridge (Phase 3 placeholder)

`game.js` exposes `window.MM`:

```js
MM.getBundledLevels()   // -> [tutorialLevel]
MM.playLevel(level)     // swap to a runtime-built level (editor test-play)
```

Phase 3 will fill `MM.loadCatalog` and add load/save round-tripping.

---

## Workflow notes

- Build in chunks; commit per phase; push direct to `main` as a clean
  fast-forward of `origin/main` (never force). Pause for user playtest
  between phases.
- The All-Munkis v1.0/v1.1 branch-isolation rule does **not** apply to
  this folder.
- Not linked from the hub `index.html` yet (intentionally unadvertised
  until further along).
