# Munki Madness — Sprite Asset Hand-off

The player marble in Munki Madness **is a curled-up Munki** (same character
family as All Munkis — this is intentional cross-pollination). Until real
art is dropped here, the game renders a shaded placeholder circle and a
placeholder "curl pop" at level start. Everything below is what you (the
artist / user) provide to swap the placeholder for the real Munki.

## Where the files go

Drop the PNGs directly in this folder:

```
munki-madness/assets/sprites/
  munki-curl-1.png   <- standing (un-curled)
  munki-curl-2.png
  munki-curl-3.png
  munki-curl-4.png
  munki-curl-5.png   <- fully rolled into a ball
  munki-ball.png     <- the rolled ball used while rolling (can equal frame 5)
```

Optional unlockable skins (Chunk 5 — not needed now, but the loader will
pick them up later):

```
  munki-ball-red.png
  munki-ball-blue.png
  munki-ball-<name>.png
```

## How to turn them on

One line in `munki-madness/game.js`, near the top of the file:

```js
var USE_SPRITES = false;   // <- flip to true once the 6 PNGs above exist
```

Set it to `true`. No other code change is needed. The loader checks that
all six required files load; if any are missing it silently stays on the
placeholder so the game never breaks mid-roll.

## Format spec

| Property      | Requirement                                                        |
|---------------|--------------------------------------------------------------------|
| File type     | PNG, 32-bit, **transparent background** (alpha, not white/matte)    |
| Dimensions    | Square. **256×256 recommended** (512×512 fine; all frames identical)|
| Anchor        | Munki **centered** in the canvas; pivot = image center             |
| Headroom      | Leave ~8% transparent padding on every edge (no clipping on spin)   |
| Color         | Full color; the engine does not tint frames 1–5                    |
| Ball frame    | `munki-ball.png` should look good **rotating about its center**     |

### Curl sequence (frames 1 → 5)

The five `munki-curl-*` frames are a single transition read in order:

1. **`munki-curl-1`** — Munki standing / neutral (the "uncurled" pose).
2. **`munki-curl-2`** — starting to tuck.
3. **`munki-curl-3`** — half curled.
4. **`munki-curl-4`** — nearly a ball.
5. **`munki-curl-5`** — fully rolled, tight ball.

The engine plays 1→5 over ~400 ms at **level start** (curl up) and 5→1
over ~400 ms at **level complete** (uncurl / celebrate). During normal
rolling it shows `munki-ball.png`, rotated to match the marble's physics
velocity (so design the ball to read well spinning in any orientation —
a visible seam / face offset helps the spin feel fast).

### Animation states (for reference)

The `Munki` class drives these — you only supply art for the frames:

```
STANDING   -> frame 1
CURLING    -> frames 1..5  (level start, ~400ms)
ROLLED     -> munki-ball.png, spun by velocity
UNCURLING  -> frames 5..1  (level complete, ~400ms)
```

## Sizing in-game

A frame is drawn at roughly the marble's on-screen diameter (about
`2 × tileW × 0.30`, ~30–40 px on a phone, scaled with the board). Provide
high-res (256+) so it stays crisp when the board is large on desktop.

## Cross-pollination note (future chunks, just context)

Chunk 5 adds skin unlocks; later versions may let the player roll as a
specific All Munkis character they've unlocked (e.g. "Moon Munki"). Keep
the curl frames generic enough that recolors / alternate characters can
follow the same 5-frame + ball convention.
