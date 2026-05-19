# Flying Creeps sprite sheet — drop spec

The **Flying Creep** entity (an ambient creature that drifts across the
stage and scares the Munkis) is **fully implemented and ships in v1.0**.
With no valid sheet present it renders a clearly-marked **PLACEHOLDER**
ghost SVG — the feature works completely with the placeholder; only
the visuals are pending.

## Two sheets — STANDARD vs ITCH-EXCLUSIVE

The Flying Creeps concept was born from rude "AI slop" comments on the
itch.io release — the haters' comments reincarnated as the things that
haunt the game. That meta version is a deliberate easter egg, but it's
**itch.io-only**: the social-media-screenshot art doesn't fit a
kid-clean Play / web listing (it openly flags AI-generated assets and
reads as out-of-context UI on the Designed-for-Families track).

So there are **two sheets**, by naming convention:

| File | Role | Ships in |
|---|---|---|
| `flying-creeps.{png,json}` | **STANDARD** sheet — kid-clean creep art | **Every standard release**: madderverse.org web **and** the Google Play app. The single default. |
| `itch-creeps.{png,json}`  | **ITCH-EXCLUSIVE** — the haters'-comment meta creeps | **itch.io builds only**, swapped in at package time. |

`game.js` is never aware of `itch-creeps.*` — `loadCreepSheet()` only
ever reads `flying-creeps.{png,json}`. The itch flavour is purely a
**build-time asset swap**, zero code change:

> **Packaging the itch.io build (manual step):** from a clean checkout,
> before zipping the itch release, in `all-munkis/assets/sprites/`:
> ```
> cp itch-creeps.png  flying-creeps.png
> cp itch-creeps.json flying-creeps.json
> ```
> Zip + upload to itch. Do **not** commit that swap — `flying-creeps.*`
> in git is always the STANDARD sheet. (Web/Play deploys must never get
> the itch art.)

### Divergence rule (don't let a sync clobber this)

`flying-creeps.{png,json}` is a deliberately divergent asset, like the
Capacitor native bridge in `game.js`. The STANDARD sheet is identical
across `all-munkis/` and `all-munkis-app/www/`. **`itch-creeps.*`
lives only in `all-munkis/assets/sprites/`** (the web source the itch
build is cut from) — it must never be copied into
`all-munkis-app/www/` (Play has no business carrying the itch art).

## Dropping / replacing the STANDARD sheet

Drop **two files** into BOTH
`all-munkis/assets/sprites/` and `all-munkis-app/www/assets/sprites/`:

```
flying-creeps.png      the sprite sheet (one image, all N variants)
flying-creeps.json     frame coordinates (TexturePacker JSON Hash)
```

`loadCreepSheet()` auto-detects them on next load — no code change.
After updating the app copy: `npx cap sync android` so the Android
build inherits it. If the new PNG's dimensions/grid differ from the
old sheet, the `.json` MUST be rewritten to match the new frame rects
(wrong coords → variants crop wrong).

> **Status (2026-05-15):** SHIPPED. `flying-creeps.{png,json}` is the
> real 6-variant STANDARD sheet (3248×1738, 3×2 grid, one Creep per
> Rainbow Munki colour). The meta art is preserved as `itch-creeps.*`
> for the itch-only swap. This is the v1.0 art.

## Official lore (canon — standard builds)

The Flying Creeps **are the Rainbow Munkis**. Long ago the evil
Munkis — **Ice** and **Moon** — cursed Red, Orange, Yellow, Green,
Blue, and Purple out of jealousy, twisting each into a winged,
sorrowful **Flying Creep** and casting them out. Now they're doomed
to drift back to the stage forever — not to rejoin the rainbow, but
to ruin the performance they can never be part of again. Six Munkis,
six curses, six Creeps. This is the official story in every standard
build (web + Play); the lore modal in `index.html` tells it.

**itch.io is the exception.** There the Creeps are the game's real
"AI slop" haters'-comments reincarnated (the `itch-creeps.*` swap) —
the original meta joke, kept where the comments were actually made.

## 6 creeps × 5 ANIMATION frames (v1.1)

The STANDARD sheet is **6 creeps** (one per rainbow colour) ×
**5 ordered animation frames** each. Per creep the frames are:

| Frame | Pose | Used by state |
|---|---|---|
| 1 | wings up   | HUNT flap-A |
| 2 | wings down | HUNT flap-B |
| 3 | spot / wind-up | EXIT dive (t < 180 ms) |
| 4 | dive       | EXIT dive (t < 360 ms) |
| 5 | strike     | EXIT dive (held, ≥ 360 ms) |

Lifecycle (see the FLYING CREEPS block in `game.js`) — a **hunting
cycle**: **HUNT → EXIT**. In HUNT the creep steers toward the nearest
Munki it hasn't scared yet (wings beat-flapping 1↔2) — that's the
hunt, it visits Munkis one at a time. **Passive proximity is the
interaction**: any Munki within `CLOSE_PX` flinches (`.creep-scared`
→ shocked face) and accrues fear, bleeding off once clearly past
`FAR_PX` (CLOSE/FAR hysteresis stops boundary flicker). Once it has
scared `CREEP.SCARE_COUNT` (3) **distinct** Munkis — or the hunt
exceeds `MAX_HUNT_MS` — it **EXIT**s in a fast dive
(`EXIT_SPEED_MULT`, frames 3→4→5) off the **opposite edge from
entry**. Fewer than 3 Munkis on stage → it scares what's there then
times out and leaves; an empty stage → it just cruises through and
leaves.
`CREEP.VARIANT_COUNT` (6) is the creep count and the "All Creeps
Encountered" target — that achievement counts **creeps seen, not
frames**.

## Sheet format (as shipped) — PER-CREEP sheets

The STANDARD is **one sheet per creep**:
`assets/sprites/creep-<colour>.{png,json}` for `<colour>` in
**blue, green, orange, purple, red, yellow** (6 creeps). Each JSON is
a plain exporter hash (Sprite Sheet Maker / TexturePacker) of **5
frames** on a single strip; the frame keys **start with the frame
number 1–5** (e.g. `1G-flight 2G-flight 3G-swoop 4G-swoop 5G-swoop`).
The loader (`loadOneCreepSheet`) sorts each creep's frames by that
leading integer. The `-flight` / `-swoop` suffix is documentation
only — the engine maps frame index **0–1 → the beat-locked wing-flap,
2–4 → the swoop**, regardless of the label.

```json
{
  "frames": {
    "1G-flight": { "frame": { "x": 1,   "y": 1, "w": 216, "h": 217 } },
    "2G-flight": { "frame": { "x": 218, "y": 1, "w": 216, "h": 217 } },
    "3G-swoop":  { "frame": { "x": 435, "y": 1, "w": 216, "h": 217 } },
    "4G-swoop":  { "frame": { "x": 652, "y": 1, "w": 216, "h": 217 } },
    "5G-swoop":  { "frame": { "x": 869, "y": 1, "w": 216, "h": 217 } }
  },
  "meta": { "size": { "w": 1086, "h": 219 } }
}
```

Frames are **uniform exporter canvases**, but the creep drawn inside
each varies in size. So the engine **measures each frame's real
painted content in-browser** (alpha bbox, once per creep at load),
then scales every frame so its `CREEP.NORM_DIM` (`'area'` — geom-mean
of the content box) renders to `NORM_FILL` × the creep box, with the
content-box centred and the frame element sized to exactly the sprite
(`overflow:hidden`) so **no neighbouring strip frame can bleed in**.
Net: every pose & every creep reads the **same size, centred**, and
the wing-flap shows as motion, not a size jump. Sprites are drawn
flying **left→right**; the engine mirrors (`scaleX(-1)`) any creep
travelling leftward so it always faces its heading. No detector / no
hand-edited rects — the exporter `frame` rects are used verbatim;
size/centre normalisation is automatic from the measured content.

### Adding / replacing a creep

Drop `creep-<colour>.{png,json}` into **both**
`all-munkis/assets/sprites/` and `all-munkis-app/www/assets/sprites/`
(byte-identical). No code change — present sheets auto-load in
parallel; `<colour>` must be one of the six in `CREEP_COLORS`
(`game.js`). Frame keys must start `1`..`5`. "All Creeps Encountered"
counts the creeps actually present.

### FALLBACK (legacy single sheet — itch only)

If **no** per-creep sheets are found, the loader falls back to a
single `assets/sprites/flying-creeps.{png,json}` (schema-detected:
grouped `creep-<colour>-<n>`, else 1-frame-per-creep static drifters).
This path now exists **only in the itch flat build**, where
`flying-creeps.*` is the itch-exclusive single-frame `itch-creeps`
meta art — it drifts → swoops → dissipates but does not animate. The
web + Play (`all-munkis-app/www`) builds ship the 6 per-creep sheets
and **no longer carry** `flying-creeps.*`. Make a per-creep itch set
later if the itch build should animate too.

### Replacing the sheet later

Any layout works as long as every variant's `frame.x/y/w/h` is
correct and the count matches `CREEP.VARIANT_COUNT`. Drop the new
`flying-creeps.{png,json}` into BOTH `all-munkis/assets/sprites/` and
`all-munkis-app/www/assets/sprites/`, then `npx cap sync android`.
Keep `itch-creeps.*` (web source only) as the itch swap.

### Art guidance (matches the shipped look)

- **One Creep per rainbow colour** — each is its colour's Munki,
  cursed and winged (the lore made literal): yellow=fairy wings,
  orange=moth, purple=shadow, red=demon, blue=feathered, green=bat.
- **Per-variant canvas:** consistent w/h keeps scaling uniform; the
  engine scales the longest side to `CREEP.SIZE_PX` (128px, tunable).
- **Transparency:** PNG with alpha; soft edges read best over the
  dark stage photo.
- **Mood:** unsettling-but-cute. Kids' game — playful threat, not
  nightmare fuel. Pairs with the gentle 12-second horror creep,
  doesn't out-scare it.
- **Anchor:** art centred in each cell; the engine centres the frame
  box, so consistent in-cell placement keeps drift smooth.

## Behavior already wired (no art needed)

- One Creep at a time. Spawns every 30–90s (first 20–45s in), random
  variant, drifts from a random edge on a sine path at 30–50px/s,
  leaves after 10–15s.
- Within 80px of an on-stage Munki → that Munki flinches
  (`.creep-scared`: shake + startled brightness, stacks on the sulk)
  and gains fear at 5/s. Beyond 120px fear decays at 1/s (80/120
  hysteresis stops flicker).
- Total fear ≥ 150 → horror mode trips (shared 12s slow-creep visual,
  same as an Ice/Moon drop) and the hidden **Creep Whisperer**
  achievement unlocks (2 moon points). Releases below 60.
- Seeing every variant at least once across all play sessions unlocks
  **All Creeps Encountered** (3 moon points, hidden). Tracked in
  `localStorage` under `all-munkis-creeps-seen-v1`. Inert until a real
  sheet exists (the placeholder has no variants).
- Not interactive in v1 — the kid can't tap/drag/dismiss it.

All thresholds/timing live in the `CREEP` config object at the top of
`game.js` — tune freely; nothing else hard-codes them.
