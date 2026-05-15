# Spook sprite sheet — drop spec

The Spook entity (an ambient ghost that drifts across the stage and
scares the Munkis) is **fully implemented**. Until the real art is
dropped here it renders a clearly-marked **PLACEHOLDER** ghost SVG.

To replace the placeholder with real art, drop **two files** into
this folder (`all-munkis/assets/sprites/`):

```
spook.png      the sprite sheet (one image, all frames)
spook.json     frame coordinates (TexturePacker JSON Hash format)
```

That's it — `loadSpookSheet()` in `game.js` auto-detects them on the
next load. No code change needed. (Then re-sync into
`all-munkis-app/` per that folder's README so the Android build
inherits it.)

## spook.json format

Exactly the same shape as the existing `mb-heads.json` /
`default-heads.json` in this folder (TexturePacker → JSON (Hash)).
Both an object map and a plain array of frames are accepted; the
object map is preferred for parity with the other sheets:

```json
{
  "frames": {
    "spook-0": { "frame": { "x": 0,   "y": 0, "w": 256, "h": 320 } },
    "spook-1": { "frame": { "x": 256, "y": 0, "w": 256, "h": 320 } },
    "spook-2": { "frame": { "x": 512, "y": 0, "w": 256, "h": 320 } },
    "spook-3": { "frame": { "x": 768, "y": 0, "w": 256, "h": 320 } }
  },
  "meta": {
    "image": "spook.png",
    "size": { "w": 1024, "h": 320 },
    "fps": 8
  }
}
```

### Field requirements

| Field | Required | Notes |
|---|---|---|
| `frames[*].frame.x/y/w/h` | **yes** | Pixel rect of each frame in `spook.png`. |
| `meta.size.w/h` | recommended | Natural pixel size of the whole sheet. If omitted, it's inferred by bounding the frame rects (works, but explicit is safer). |
| `meta.fps` | optional | Playback speed. Defaults to **8** fps if absent. |
| `meta.image` | optional | Ignored — the loader always uses `spook.png` next to this JSON. |

### Art guidance (matches the in-game look)

- **Frame count:** 4–12 frames of a gentle idle/float cycle (it
  loops continuously the whole time the Spook is on screen). 6–8 is
  a good target.
- **Per-frame canvas:** consistent w/h across frames keeps the
  scaling stable. Square-ish or slightly tall (it's a ghost) — e.g.
  256×320. The engine scales the longest side to
  `SPOOK.SIZE_PX` (128 px default; tunable in `game.js` → `SPOOK`).
- **Transparency:** PNG with alpha. The Spook drifts over the dark
  stage photo; a soft translucent body reads best (the placeholder
  is ~0.9 opacity — the sheet can bake its own alpha).
- **Palette:** cool pale blues/whites read as "spooky" against the
  warm rainbow Munkis without clashing. Not required — your call.
- **Mood:** unsettling-but-cute. This is a kids' game; the Spook is
  a playful threat, not nightmare fuel. It should pair with the
  existing gentle 12 s horror creep, not out-scare it.

## Behavior already wired (no art needed to test the logic)

- Spawns every 30–90 s (first one 20–45 s in), drifts from a random
  edge across a sine path at 30–50 px/s, leaves after 10–15 s.
- Within 80 px of an on-stage Munki → that Munki flinches
  (`.spooked`: shake + startled brightness, stacks on the sulk) and
  gains fear at 5/s. Beyond 120 px fear decays at 1/s (hysteresis
  between the two stops flicker).
- Total fear ≥ 150 → horror mode trips (the shared 12 s slow-creep
  corner-sprite visual, same as an Ice/Moon drop) and the hidden
  **Spookmaster** achievement unlocks (2 moon points). Releases
  when total fear falls back below 60.
- Not interactive in v1 — the kid can't tap/drag/dismiss it.

All thresholds/timing live in the `SPOOK` config object at the top
of `game.js` — tune freely; nothing else hard-codes them.
