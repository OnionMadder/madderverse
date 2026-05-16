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

> **Status (2026-05-15):** `flying-creeps.{png,json}` currently still
> holds the *meta* art (now also preserved as `itch-creeps.*`). The
> kid-clean STANDARD sheet is being generated; once it's dropped in as
> `flying-creeps.{png,json}` (web + app), `itch-creeps.*` remains the
> itch-only swap-in. Until then the meta sheet renders everywhere — do
> not ship a non-itch build in that state.

## 12 VARIANTS, not animation frames

Each frame in the sheet is a **distinct creep design** (a variant), not
a frame of a flap animation. On every appearance the game picks **one**
variant uniformly at random and renders it **statically** for that
whole pass. Target count: **12** (`CREEP.VARIANT_COUNT` in `game.js`).
The actual count used at runtime is however many frames the loaded JSON
has — 12 is the design goal and the "All Creeps Encountered"
achievement target.

(If a future sheet bakes a per-variant flap animation, that's a v1.1
concern — v1 is static-per-variant. The render path would need a small
change to cycle a sub-range of frames per variant; not done now.)

## flying-creeps.json format

Exactly the shape of the existing `mb-heads.json` / `default-heads.json`
in this folder (TexturePacker → JSON (Hash)). An object map is
preferred for parity; a plain array of frames is also accepted.

```json
{
  "frames": {
    "creep-01": { "frame": { "x": 0,   "y": 0,   "w": 256, "h": 256 } },
    "creep-02": { "frame": { "x": 256, "y": 0,   "w": 256, "h": 256 } },
    "creep-03": { "frame": { "x": 512, "y": 0,   "w": 256, "h": 256 } },
    "creep-04": { "frame": { "x": 768, "y": 0,   "w": 256, "h": 256 } },
    "creep-05": { "frame": { "x": 0,   "y": 256, "w": 256, "h": 256 } },
    "creep-06": { "frame": { "x": 256, "y": 256, "w": 256, "h": 256 } },
    "creep-07": { "frame": { "x": 512, "y": 256, "w": 256, "h": 256 } },
    "creep-08": { "frame": { "x": 768, "y": 256, "w": 256, "h": 256 } },
    "creep-09": { "frame": { "x": 0,   "y": 512, "w": 256, "h": 256 } },
    "creep-10": { "frame": { "x": 256, "y": 512, "w": 256, "h": 256 } },
    "creep-11": { "frame": { "x": 512, "y": 512, "w": 256, "h": 256 } },
    "creep-12": { "frame": { "x": 768, "y": 512, "w": 256, "h": 256 } }
  },
  "meta": {
    "image": "flying-creeps.png",
    "size": { "w": 1024, "h": 768 }
  }
}
```

That example is a **4-column × 3-row grid of 256×256 cells** in a
1024×768 sheet — the recommended clean layout for 12 variants. Any
layout works as long as every variant's `frame.x/y/w/h` is correct;
the grid is just the easiest to author and to hand-write JSON for.

### Field requirements

| Field | Required | Notes |
|---|---|---|
| `frames[*].frame.x/y/w/h` | **yes** | Pixel rect of each variant in `flying-creeps.png`. |
| `meta.size.w/h` | recommended | Natural pixel size of the whole sheet. If omitted it's inferred by bounding the frame rects (works, but explicit is safer). |
| `meta.image` | optional | Ignored — the loader always uses `flying-creeps.png` next to this JSON. |
| `meta.fps` | ignored | Variants are static; there is no animation cycle in v1. |

### Layout options for 12 variants

| Sheet | Grid | Cell |
|---|---|---|
| 1024×768 | 4 × 3 | 256×256 *(recommended)* |
| 1536×512 | 6 × 2 | 256×256 |
| 3072×256 | 12 × 1 | 256×256 (horizontal strip) |
| 1080×810 | 4 × 3 | 270×270 |

Pick whatever the art was authored at; just make the JSON rects match.

### Art guidance (matches the in-game look)

- **12 distinct creeps.** Variety is the point — different silhouettes,
  colors, expressions. They share no mechanics, only vibe.
- **Per-variant canvas:** consistent w/h across all 12 keeps scaling
  uniform. Square (e.g. 256×256) is easiest; the engine scales the
  longest side to `CREEP.SIZE_PX` (128px default, tunable in `game.js`
  → `CREEP`).
- **Transparency:** PNG with alpha — each creep drifts over the dark
  stage photo; soft translucent edges read best.
- **Palette:** cool pale blues/whites read "creepy" against the warm
  rainbow Munkis without clashing. Your call.
- **Mood:** unsettling-but-cute. Kids' game — playful threat, not
  nightmare fuel. Pairs with the gentle 12s horror creep, doesn't
  out-scare it.
- **Anchor:** art centered in each cell; the engine centers the frame
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
