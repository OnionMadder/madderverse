# Munki Madness v2.0 — Physics + Mesh Spec (Phase 1)

Source of truth for the engine. v1.0 (Matter.js iso tile maze) lives in
git history; v2.0 is a continuous heightmap world rendered as a glowing
wireframe mesh. The goal is a **WELL** — a deep depression the marble
falls into and cannot roll back out of.

This document covers Phases 1–2 (engine foundation + obstacle layer).
The sculptural editor (Phase 3), audio polish / SFX (Phase 4), and the
JSON level catalog (Phase 5) will extend it in subsequent commits.

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

Slope gravity accel applied to the marble each substep (effective
strength `= GRAVITY_K × GRAVITY_MULT`):

```
gK      = GRAVITY_K * GRAVITY_MULT
ax_grav = -gK * dH/dx
ay_grav = -gK * dH/dy
```

## Well-pull force (per-well attraction layer)

Separate, additive force toward each level's well centre. Decouples
the **terrain feel** (gradient gravity, kept light) from **capture
reliability** (well-pull, kept punchy). Without it, lowering
`GRAVITY_MULT` to make the open mesh feel gentle would also weaken
the well's draw and let the marble roll past the rim.

Computed each physics substep:

```
d_vec  = (well.x - marble.x, well.y - marble.y)
d      = |d_vec|
d_c    = max(d, WELL_PULL_MIN_DIST)                   // singularity clamp
mag    = WELL_PULL_STRENGTH * (WELL_PULL_RADIUS / d_c) ^ WELL_PULL_FALLOFF_EXP
mag    = min(mag, WELL_PULL_MAX)                      // safety cap
n_hat  = d_vec / d
ax_well = gravFlip * mag * n_hat.x
ay_well = gravFlip * mag * n_hat.y
```

Then `ax_well, ay_well` are **added** to the gradient-gravity `ax, ay`
before player input + field obstacles. `gravFlip` is the same factor
the slope gravity uses (`-1` inside reverse-gravity zones), so a
reverse zone consistently flips both the terrain pull AND the well
pull — wells *repel* inside a reverse zone.

### Intuition

- At `d == WELL_PULL_RADIUS` (default `3.0` cells): `mag = STRENGTH = 5.2` — a real tug from the rim.
- At `d == WELL_PULL_MIN_DIST` (default `0.5` cells): raw formula gives `5.2 × 36 = 187` cells/s² — but **clamped to `WELL_PULL_MAX_FORCE = 12`** before being applied.
- At `d == 6.0` cells (twice `RADIUS`): `mag = STRENGTH × 0.5² = 1.3` — present but weak.

So the marble feels free across most of the mesh and gets pulled in
sharply only after it crosses the rim. Crank `STRENGTH` for stickier
wells; raise `RADIUS` for wider reach (the rim "begins" further out);
raise `FALLOFF_EXP` for a steeper near-field grab (an exponent of `3`
makes the close-up pull dramatic without lengthening the reach).

### Well-pull cap + drain zone (capture reliability)

A previous build had an internal `WELL_PULL_MAX = 500` cap that was
useless for gameplay: at the default `STRENGTH=5.2, MIN_DIST=0.5,
EXP=2`, the raw force at the rim of the inner zone is `187` cells/s²,
which yanked the marble *through* the well centre at exit speed faster
than `ESCAPE_THRESHOLD` could ever fire. Two-stage fix:

1. **`WELL_PULL_MAX_FORCE` (tunable, default `12`)** — the well-pull
   magnitude is clamped to this value after the inverse-square formula.
   Keeps the near-field force in the realm of `ACCEL`-sized numbers
   so the marble can be decelerated by drag instead of overshooting.
2. **Drain zone — `WELL_DRAIN_RADIUS` + `WELL_DRAIN_FRICTION`**: once
   the marble is within `WELL_DRAIN_RADIUS` (default `1.5` cells) of
   the well centre, an extra per-frame@60 velocity multiplier
   (`WELL_DRAIN_FRICTION`, default `0.85`) is applied after the
   normal drag. From `|v| = 7` the marble reaches `|v| < 1.1` in
   ~14 frames (~230 ms) — solidly below `ESCAPE_THRESHOLD`.

### Two capture paths (whichever fires first)

The classic capture (in-bowl AND below `ESCAPE_THRESHOLD` continuously
for `0.14 s`) remains the primary route. The fix adds a **drain-dwell
bypass**:

```
inDrain   = distance(marble, well) < WELL_DRAIN_RADIUS
drainDwell += dt   while inDrain   (reset to 0 when outside)
if drainDwell > 0.15 → captured (regardless of velocity)
```

Both dwell thresholds were halved 2026-05-19 — the original 0.28/0.30 s
post-capture wait was too long. The marble.sink visual ramp was also
doubled (`dt*3 → dt*6`) so the marble settles into the hole in ~0.17 s
instead of ~0.33 s. Both paths share the `win()` handler; whichever
triggers first wins.

### Live diagnostic overlay

When `?tune=1` is active, the panel shows a tiny readout updated at
~12 Hz with the marble's `pos`, `vel` (vector + `|v|`), well-pull
force (`pull` vector + `|F|`), distance to well `d`, and `bowl` /
`drain` zone flags. Useful for watching the capture sequence happen
(or fail) in real time as you dial.

The marble accelerates **opposite** the gradient (downhill). A well —
which is a Gaussian depression dug into the corners — produces a smooth
radial pull that grows from zero at the rim into a strong central
funnel.

## Marble feel — heavy ball on a curved sheet

Tunable constants at the top of `game.js` (live-tunable via `?tune=1`):

| Constant | v2.0 value | Meaning |
|---|---|---|
| `ACCEL` | `30` | player-input push (cells/s²) |
| `MAX_SPEED` | `7` | top speed (cells/s) |
| `WALL_BOUNCE` | `0.4` | edge restitution — pinball bonk |
| `FRICTION_FLOOR` | `0.96` | per-frame@60 velocity multiplier (drag) |
| `GRAVITY_K` | `40` | base slope→accel constant (internal; not on the tune panel) |
| `GRAVITY_MULT` | `0.15` | player-tunable multiplier on `GRAVITY_K`. Effective gravity = `GRAVITY_K × GRAVITY_MULT`. `0` = flat-plane (no slope pull); `2` = wild. *Currently low — terrain is gentle; wells get their own pull (see below).* |
| `TILT_FULL` | `10°` | deg past the recentred zero that saturates tilt input |
| `TILT_FORCE_MULTIPLIER` | `2.8` | extra tilt-input gain |
| `MARBLE_R` | `0.42` | marble radius (cells); keeps it off the rim |
| `ESCAPE_THRESHOLD` | `1.1` | bowl-speed threshold below which the marble is captured (cells/s) |
| `WELL_PULL_STRENGTH` | `5.2` | well-attraction magnitude at `d = RADIUS` (cells/s²) |
| `WELL_PULL_RADIUS` | `3.0` | characteristic radius of the well's gravitational reach (cells) |
| `WELL_PULL_MIN_DIST` | `0.5` | distance clamp to avoid an infinite spike at d→0 (cells) |
| `WELL_PULL_FALLOFF_EXP` | `2.0` | power of the falloff. `1` = linear · `2` = inverse-square · `3` = cubic |
| `WELL_PULL_MAX_FORCE` | `12` | hard cap on the well-pull magnitude (cells/s²). **Critical**: without this, default STRENGTH/RADIUS/EXP at d=MIN_DIST yields ≥187 cells/s² and shoots the marble through the well |
| `WELL_DRAIN_RADIUS` | `1.5` | inner damping zone — marble bleeds momentum hard while inside (cells) |
| `WELL_DRAIN_FRICTION` | `0.85` | per-frame@60 velocity multiplier applied inside the drain zone (separate from `FRICTION_FLOOR`) |

Constants locked from a `?tune=1` L1 Tutorial Well playthrough on
2026-05-19; previous values archived in the commit immediately before
this one.

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
2. Too slow to climb back out: `|v| < ESCAPE_THRESHOLD` (default `2.2` cells/s),
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

Phase 2 ships six obstacle-demo levels alongside the Tutorial Well:
Bumper Ring, Reverse Crossing, Ice Approach, Conveyor Belt, Wind Lane,
Tractor Slingshot. Phase 5 replaces the whole catalog with `levels/*.json`.

## Obstacles (Phase 2)

Each level may carry an `obstacles` array of sparse objects. Effects
are accumulated per physics substep into a small `state` struct read
by the integrator. Zones use a cosine falloff (`1.0` at centre, `0.0`
at the edge) so transitions are smooth.

| Type | Fields | Effect |
|---|---|---|
| `bumper` | `{ x, y, r }` | Solid disc collision — position correction + reflect along contact normal × `(1+WALL_BOUNCE)` + outward `BUMPER_KICK` kick. Rendered as a short 3D-look post (top + bottom rings + vertical struts, `BUMPER_POST_H` tall). |
| `reverse` | `{ x, y, r }` | While inside, slope gravity flips sign (`gravFlip = -1`). The terrain that was downhill now pushes you uphill. Well-pull flips too. |
| `ice` | `{ x, y, r }` | Pull effective drag toward `ICE_DRAG_TARGET` (slippery) and input grip down by `ICE_GRIP_REDUCE` × `falloff`. |
| `mud` | `{ x, y, r }` | Pull effective drag toward `MUD_DRAG_TARGET` (sticky) and grip down by `MUD_GRIP_REDUCE` × `falloff`. |
| `conveyor` | `{ x, y, r, dx, dy, strength? }` | Constant directional accel `(dx, dy) × (strength || CONVEYOR_STR)` while inside — full force, no falloff (it's a moving belt). |
| `wind` | `{ x, y, r, dx, dy, strength? }` | Same as conveyor but multiplied by `falloff` — strongest at the centre, fades at the edge. `strength || WIND_STR`. |
| `tractor` | `{ x, y, r, strength? }` | Pulls the marble toward `(x, y)` with `(strength || TRACTOR_STR) × falloff`. A mini-well that *does not capture*. |

Each obstacle MAY override its own `strength` inline. The constants
above (`BUMPER_KICK`, `CONVEYOR_STR`, `WIND_STR`, `TRACTOR_STR`,
`ICE_*`, `MUD_*`) are the level-builder defaults, all tunable on
`?tune=1`.

`dx, dy` for directional types are unit-ish; the integrator does not
renormalise them, so e.g. `{ dx: 0.6, dy: 0.8 }` plays as a 1.0-strength
push in that direction. Phase 3 editor will keep them normalised.

Bumpers resolve immediately during effect accumulation (position
correction + impulse). Field zones contribute to `state.extraAx/Ay`
which the integrator adds to slope gravity + player input.

The default obstacle list is empty (`[]`); a level with no obstacles is
**byte-identical to the Phase 1 integrator**.

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
`GRAVITY_MULT`, `TILT_FORCE_MULTIPLIER`, `ESCAPE_THRESHOLD`,
`WELL_PULL_STRENGTH`, `WELL_PULL_RADIUS`, `WELL_PULL_MIN_DIST`,
`WELL_PULL_FALLOFF_EXP`, `WELL_PULL_MAX_FORCE`, `WELL_DRAIN_RADIUS`,
`WELL_DRAIN_FRICTION`, `BUMPER_KICK`, `CONVEYOR_STR`, `WIND_STR`,
`TRACTOR_STR`, `ICE_DRAG_TARGET`, `ICE_GRIP_REDUCE`,
`MUD_DRAG_TARGET`, `MUD_GRIP_REDUCE`. Unknown keys are ignored.
(`GRAVITY_K` and `BUMPER_POST_H` are internal; the rest are tunable.)

## Tune panel (`?tune=1`)

Slider ranges (clamped on apply to keep the engine numerically safe):

| Knob | Range | Step |
|---|---|---|
| `ACCEL` | 5 – 40 | 1 |
| `GRAVITY_MULT` | 0 – 2.0 | 0.05 |
| `MAX_SPEED` | 2 – 15 | 0.5 |
| `WALL_BOUNCE` | 0 – 0.99 | 0.05 |
| `FRICTION_FLOOR` | 0.70 – 0.99 | 0.01 |
| `TILT_FORCE_MULTIPLIER` | 0.5 – 3.0 | 0.1 |
| `ESCAPE_THRESHOLD` | 0 – 5.0 | 0.1 |
| `WELL_PULL_STRENGTH` | 0 – 10 | 0.1 |
| `WELL_PULL_RADIUS` | 0.5 – 8 | 0.1 |
| `WELL_PULL_MIN_DIST` | 0.1 – 1.0 | 0.05 |
| `WELL_PULL_FALLOFF_EXP` | 0.5 – 4.0 | 0.1 |
| `WELL_PULL_MAX_FORCE` | 1 – 30 | 0.5 |
| `WELL_DRAIN_RADIUS` | 0.5 – 5 | 0.1 |
| `WELL_DRAIN_FRICTION` | 0.5 – 0.99 | 0.01 |
| `BUMPER_KICK` | 0 – 10 | 0.1 |
| `CONVEYOR_STR` | 0 – 40 | 1 |
| `WIND_STR` | 0 – 30 | 1 |
| `TRACTOR_STR` | 0 – 30 | 1 |
| `ICE_DRAG_TARGET` | 0.90 – 0.999 | 0.001 |
| `ICE_GRIP_REDUCE` | 0 – 1 | 0.05 |
| `MUD_DRAG_TARGET` | 0.30 – 0.99 | 0.01 |
| `MUD_GRIP_REDUCE` | 0 – 1 | 0.05 |

Panel layout matches v1.0's: a fixed-width `320px` panel pinned
bottom-left over the gameplay (NOT panel-spanning). Sliders span the
panel's inner width — ~296 px of pixel-travel per slider track, which
is the precision dimension that matters. Slider visuals are native
HTML range inputs (no custom thumb / track CSS). Value readout is
14 px bold cyan above each slider with `font-variant-numeric:
tabular-nums`. Tap the header bar to collapse the body to a small
tab; tap again to expand. Default is **expanded on first load**;
collapse state persists in `localStorage` (`mm2.tune.collapsed`).
**"Copy current values"** at the bottom emits ALL knobs as a JSON
snippet for paste-back; those values become the new defaults the
next time the file is committed.

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

## Audio (Phase 2: BG loop only; Phase 4 adds SFX)

Bala's Theme is played as an HTMLAudio loop at `assets/audio/balas-theme.mp3`.
The user records his own arrangement per game ([Chocobo doctrine](../../memory/project_balas_theme_per_game_arrangement.md));
do not synth-port Tonehouse for this game. Volume defaults to `0.55`;
mute state persists in `localStorage` (`mm2.muted`). The mute button
gates volume via the existing UI button. Browsers block autoplay until
a user gesture — `Sound.resume()` is called from the Start handler
and from the mute toggle to satisfy that.

Phase 4 adds: rolling SFX scaled by velocity, whoosh on well entry,
"captured!" on goal-reach, reverse-gravity hum.

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
   **The marble's screen-Y is shifted up by the rendered pixel radius
   after projection** so the visual sphere's BOTTOM rides the mesh
   (its centre is one rendered-radius above). A world-Z lift can't
   address this cleanly: the visual sphere is 2× the physics radius
   (~21 px on screen), and a world-Z lift only translates to ~5 px
   through perspective — still buries the ball. The screen-space lift
   uses the actual rendered pixel value. A dark outline stroke
   (`rgba(40,18,8,0.70)`) on top of the radial gradient keeps the
   ball readable against any translucent obstacle fill.

**Render order is load-bearing:** mesh → well rings → obstacles →
marble. The marble MUST be drawn last; anything drawn after it can
occlude it. Fixed 2026-05-19 after the ice tile's translucent cyan
fill was covering the marble's lower hemisphere because the marble's
visual centre was being drawn at the surface plane.

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
