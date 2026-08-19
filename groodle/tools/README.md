# groodle/tools — the paper-doll rig

Groodle's body is a **paper doll**: five hand-drawn parts (torso+head, one
arm, one leg — the other side is a mirror) pinned at the shoulders and hips
with visible brass fasteners. A pose is four joint angles.

`trace_rig.py` turns the drawings into the `const RIG = {...};` block in
`game.js`. Everything else about the rig is data.

`fit_standing.py` is how the joint anchors and limb lengths were derived.
Standing must be Onion's original full-figure drawing *exactly*, so it
rasterises the assembled doll against `art-src/body/original-full-figure.png`
and maximises IoU over the anchor offsets, rest angles and limb scales.
Hand-guessed values scored **0.563**; the fitted ones score **0.977**. The
guess had the legs 32% too short and their pins less than half far enough
apart -- which is what read as "the legs look wrong". Re-run it if a part is
redrawn, and paste the numbers into `trace_rig.py`.

## Redraw a part

1. Draw/generate the part as black line art on a light background. Any size.
   **Do not clean the background up** — grid lines and generator watermarks
   are removed automatically (see "Why no cleanup" below).
2. Overwrite the matching file in **`groodle/art-src/body/`**
   (`torso.png` / `arm.png` / `leg.png`). These are tracked on purpose so
   the rig stays regenerable from a fresh clone.
3. Regenerate and paste the output over the `const RIG = ...;` line in
   `game.js`:

   ```bash
   python groodle/tools/trace_rig.py
   ```

4. Read the scale line it prints to stderr. **If the head radius moved, you
   must retune `BODY`, `HEAD_CROWN_Y` and every `HATS` anchor.y/scale in
   `game.js`** — they are all anchored to head size.
5. Bump `SHELL_VERSION` in `sw.js`. The service worker is cache-first, so
   without this you will keep testing the old file and conclude your change
   did nothing. (This happened. Twice.)
6. Verify geometry, not screenshots — same battery the rest of the game
   uses:

   ```js
   const f = document.querySelector('.silhouette-fill path');
   f.isPointInFill(new DOMPoint(200, 190))   // head        -> true
   f.isPointInFill(new DOMPoint(200,  60))   // sky         -> false
   f.isPointInFill(new DOMPoint(200, 520))   // between legs-> false
   ```

## Why no cleanup is needed

- The figure's strokes are ~10px; background grid lines are 1px. More
  usefully, the **figure is one connected component** (~98k px) while grid
  lines and the watermark are separate ~2.5k ones, so taking the largest
  component discards both.
- **Interior linework is extracted differently**, and this is the trap: the
  face circles and the smile *float free* inside the head, so they are their
  own components. Pull ink from the largest component and the face silently
  vanishes. It comes from the full ink mask, restricted to the part's
  interior and minus a band along the outer contour.

## The frame constraint (read before touching an angle)

His arms are 217 units long, against 150 of clearance to the frame edge and
186 of headroom above the shoulder. A flat T-pose spans 534 units in a
400-wide frame, so it fits only if the whole doll shrinks — and the
**colourable area shrinks with the square of that scale**, on a colouring
game. Measured:

| pose set | scale | head r | colourable area |
|---|---|---|---|
| standing only          | 1.000 | 58.0 | 100% |
| + dance swing to ±18°  | 1.000 | 58.0 | 100% |
| static poses to 25°    | 0.912 | 52.9 |  83% |
| static poses to 40°    | 0.770 | 44.7 |  59% |

**±18° is free** — the frame already has room for it — so that is the dance
swing, and the static poses live inside the same budget. Standing is `{}`,
the drawing untouched at full size, which is also why `HATS` needs no
rescaling: head r is 58, the value it was always tuned to.

Motion is the dance's job, not the pose picker's. Big static poses buy very
little and cost real colouring surface.

`trace_rig.py` **re-solves the scale from whatever pose set it is given**, so
widening one pose silently shrinks the whole doll and every hat drifts. The
scale is printed on every run — check it.

## Why parts are stored, not baked poses

Six poses baked into path strings is ~285KB. Storing the five parts once as
point rings and composing at runtime (`rigPathD` in `game.js`) is ~10KB, and
it is the same machinery live limb animation during the dance would need —
the creature is currently a single rigid transform.

`rigPathD` concatenates the transformed parts into **one nonzero-fill path**,
so joint overlaps melt into a single silhouette and every downstream consumer
(canvas clip, silhouette fill/outline, pattern window, PNG export) still gets
a single `d` string and needed no changes.
