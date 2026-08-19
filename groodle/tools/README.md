# groodle/tools — the paper-doll rig

Groodle's body is a **paper doll**: five hand-drawn parts (torso+head, one
arm, one leg — the other side is a mirror) pinned at the shoulders and hips
with visible brass fasteners. A pose is four joint angles.

`trace_rig.py` turns the drawings into the `const RIG = {...};` block in
`game.js`. Everything else about the rig is data.

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
| includes a horizontal T-pose | 0.757 | 43.9 | 57% |
| steep arms-up instead        | 0.872 | 50.6 | 76% |

We ship the second: `cheer` and `wave` raise the arms to 163–166° (nearly
vertical, so narrow), and `tpose` is a 40° half-T rather than a flat one.

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
