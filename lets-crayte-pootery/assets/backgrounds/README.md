# Pack background SVGs

Per-pack scene wash painted inside the pot-box behind the wheel
+ pot during shape + decorate. Optional — packs without a file
here render the plain teal backdrop.

## File convention

One SVG per pack, named to match the `backgroundSvg` field in
`GLAZE_PACKS` (game.js):

```
assets/backgrounds/<n>.svg
```

Wired packs (`backgroundSvg` field already set; drop a file in
and it just appears on next reload):

- `core.svg`       → BASIC
- `candy.svg`      → CANDY
- `plush.svg`      → PLUSH
- `modded.svg`     → MODDED
- `gamer.svg`      → GAMER
- `space.svg`      → SPACE
- `dinosaur.svg`   → DINOSAUR
- `breakfast.svg`  → BREAKFAST
- `music.svg`      → MUSIC
- `mega.svg`       → MEGA

## Design notes

- Canvas size is **400 × 600** logical pixels (2:3 portrait).
  SVG `viewBox="0 0 400 600"` matches the render exactly.
- Painted at **alpha 0.32** by `paintPackBackground` in
  game.js, so design for the FULL color and the engine softens
  it. (Bright colors will read as mid-tones; very dark
  colors will read as near-invisible.)
- Sits BEHIND the wheel + pot. Anything in the lower-center
  ~30% of the canvas will be mostly covered. Put the focal
  visuals in the upper half + edges.
- Keep file size **under 5 KB** ideally (the "lightweight"
  reason for choosing SVG over PNG). Vectors + flat fills
  + low node count + no embedded raster data.
- No filters or `<image>` tags that depend on external
  resources; the engine draws each SVG via the Canvas
  `drawImage` path which doesn't run external loaders.

## Composite tuning

If 0.32 alpha is wrong for any specific pack (e.g., MODDED's
circuit board reads too prominent), tell Claude — it's a one
number tweak in `paintPackBackground`. Could also become
per-pack later (e.g., `backgroundAlpha: 0.18` field).
