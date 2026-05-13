# Groodle hat sprites

Each file in this directory is a single hat sprite that gets rendered
on top of the Groodle figure's head in-game. Updating the look of a
hat is a drop-in replacement — change the file, refresh the page.

## File format

- **PNG with transparency** or **SVG** — both work. The renderer uses
  `<svg><image href="…"/></svg>`, which handles both formats.
- **Filename** is kebab-case matching the catalog `id` (see `HATS`
  array in `../../game.js`). Example: `cowboy-hat.svg`.
- **Recommended natural dimensions:** 200 × 120 (logical units; this
  matches the placeholder sprites that ship in this directory).
  Different dimensions work — they just need a matching tweak to the
  `scale` field if the visual size feels off.
- **Background:** transparent. Anything opaque in your image will
  block the figure beneath the hat.

## Anchor + scale convention

The renderer in `renderEquippedHat()` positions each sprite via the
catalog's `anchor` and `scale` fields:

- The sprite's **bottom-center** (sprite x = W/2, sprite y = H) is the
  reference point. By default it lands at the figure's head-crown
  (canvas coordinates `x = 200`, `y = 42`).
- `anchor.x` shifts the reference point horizontally (positive = right
  in canvas coordinates).
- `anchor.y` shifts it vertically (positive = down). Negative pulls
  the hat upward.
- `scale` multiplies both dimensions (1.0 = natural, 1.5 = 50 % bigger,
  0.8 = 20 % smaller).

Most hats want a small positive `anchor.y` so the brim / lower edge
overlaps into the head crown a touch, rather than floating above it.

Hats that don't sit on the crown (snorkel mask covers the eyes; halo
floats above the head; antlers extend upward) need their own anchor /
scale combo — see the catalog for the placeholder values, then tune.

## Tuning when you drop in real art

1. Save your new sprite over the placeholder file (same name).
2. Reload `http://localhost:8000/groodle/` and equip the hat from the
   Hat Shop.
3. If it sits too high / low / left / right, edit the matching entry's
   `anchor` in `../../game.js`. If it's too big / small, edit `scale`.
4. The figure's head-crown reference is at canvas `(200, 42)` in the
   400 × 600 logical viewport. The head circle has radius 58, so its
   bottom is at `y = 158`.

## What's here right now

Each placeholder is a simple colored shape with a small `PLACEHOLDER`
marker text in the top-left corner. Once you swap them for real
artwork, the marker disappears with the file.
