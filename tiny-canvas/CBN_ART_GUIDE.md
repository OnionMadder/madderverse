# CBN-Friendly Coloring Page Checklist

Rules of thumb for designing coloring pages that work as **color-by-number**.
The runtime detects regions from the line-art alone (same fill mask the FILL
bucket uses), so a page that *fills* cleanly for freehand may still be a bad
CBN page if regions are too few, too crowded, or too tiny to label. This
guide is what to check BEFORE you run `scripts/process-cbn-page.py`.

If a rule is violated, the engine won't crash — it'll just make a page that's
frustrating to color by number.

## The line art

- [ ] **Every region is fully sealed.** No hairline gaps at corners, no
      incomplete curves. A single pixel where alpha < 96 lets fill escape
      into the neighboring region. Zoom to 200% and eyeball every join.
- [ ] **Ink thickness ≥ 3 px at the 1800 px shipping width.** Thinner lines
      antialias below the alpha-96 threshold and read to the engine as an
      open border. Digital lineart at 2 px looks fine to the eye and leaks
      to the fill.
- [ ] **Solid #1c2226 (or close). No half-opacity shading strokes.** A
      grey wash counts as a partial boundary — sometimes seals, sometimes
      leaks, unpredictably. Save shading for the reference PNG, not the
      line art.
- [ ] **No "decorative" open strokes inside a region.** A mouth curve, a
      whisker, a rain streak — all fine visually but they split the parent
      region into oddly-shaped pieces the auto-detector will label
      separately. If a mark isn't meant to hold color, it needs to leave
      the parent region intact (drop it to the reference PNG instead).

## Region count and distribution

- [ ] **6 to 20 fillable regions.** Under 6 reads as too simple; over 20
      crowds the label overlay and overwhelms the kid. The engine caps
      at 40 total (`CBN_MAX_REGIONS`) and bails out entirely if the count
      is exploding.
- [ ] **Each region is at least ~40×40 px at 1800 px width.** The engine
      drops regions under 400 device px (`CBN_MIN_REGION_PX`) — a 20×20
      patch — because a stray speck between antialiased strokes isn't a
      colorable feature. Even at 40×40 the number label will crowd it;
      60×60+ is comfortable.
- [ ] **Region centroids are at least ~50 px apart.** Two labels landing
      on top of each other are unreadable. Adjacent narrow slivers of the
      same shape (e.g. petal segments) will collide — either merge them
      into one region or space them out.
- [ ] **Every region has room for a number label INSIDE it.** The label
      sits at the region's centroid; a curved ribbon whose centroid lies
      outside its own shape (a horseshoe, a crescent) will show its label
      floating off the ink. Break such shapes into fillable sub-regions
      or accept that the label may sit visually off.

## Palette

- [ ] **4 to 8 numbered colors.** Fewer than 4 is a mood, not a game;
      more than 8 is more than a kid can hold in their head.
- [ ] **Each color is at least 18 units apart in RGB.** The fill
      tolerance is 6 (see the comment on `TOL2` in `floodFillAt`), and
      the general palette rule enforces a minimum separation of 18.4 —
      colors closer than that will occasionally read as the same to the
      fill tool.
- [ ] **Colors make visual sense with the scene.** A kid learns colors
      partly by association — sky = blue, grass = green, sun = yellow.
      Random palettes work mechanically but land as noise. The pipeline
      script snaps sampled colors from your reference PNG to the closest
      palette entry, so choose a palette that CAN represent your scene.
- [ ] **No two consecutive numbers share a color.** Two adjacent regions
      that both want yellow but are numbered 3 and 4 (different swatches)
      is a bug of the pipeline; two that both are 3 is fine. Check the
      emitted JSON — if the same `ci` shows up on 60%+ of regions, your
      palette is skewed or your reference PNG's colors are too clustered.

## Composition

- [ ] **No stacked overlaps.** A region hidden behind another region
      (e.g. a bird half-behind a cloud) confuses the auto-detector; it
      sees "front cloud" and "back bird" as one region if their gap isn't
      inked. Compose scenes as flat/tiled layouts, not depth stacks.
- [ ] **Big regions in the middle, small ones at the edges.** The label
      overlay uses percent positioning; regions near the very edge can
      have their label clipped by the tool rail or safe-area insets on
      mobile.
- [ ] **Full-bleed backgrounds must include a border-region.** The
      engine treats the page's outer frame as one region if the top-left
      pixel is non-ink; on a full-bleed sky page that becomes a giant
      "1" covering everything. Either include a distinct border inside
      the sky (a horizon line, a frame), or accept that CBN pages are
      best drawn as OBJECTS on paper (like the current single-object
      pages: donut, leaf, snowflakes).

## Testing before you ship

Bake the page through `scripts/process-coloring-pages.py` as usual, then
run the CBN pipeline against your colored reference:

```bash
python3 tiny-canvas/scripts/process-cbn-page.py \
    tiny-canvas/assets/coloring-pages/<pack>/<page>.png \
    tiny-canvas/art-src/coloring-pages/<pack>/<page>-reference.png \
    --palette "#7ecfff,#ff8b3d,#f7d94c,#8ac36b,#ff8fb0,#a67849" \
    --out /tmp/cbn.json
```

The script prints `(N regions)` to stderr.

- [ ] **N is between 6 and 20.** If it's 1 or 2, the ink is leaking (see
      "Every region is fully sealed"). If it's 40+, your ink is
      producing false regions from antialiasing halos (see "Ink
      thickness ≥ 3 px").
- [ ] **`--min-area` bumped for larger art.** The default 400 px matches
      the runtime; if your reference is 2× res, pass `--min-area 1600`.
- [ ] **Paste the JSON into templates.js under `cbn:` for the new page.**
      Use an explicit `regions` array (not an `assign` function) — the
      pipeline's sampling is more accurate than any zone rule you'll
      hand-tune.

Once pasted, open the app and:

- [ ] **Every region shows a number.** If one doesn't, it fell under
      `CBN_MIN_REGION_PX` — either enlarge it in the art or lower the
      threshold in game.js.
- [ ] **Every numbered swatch fills the intended region on a correct
      tap.** If a "sky = 1" fill lands on grass instead, the reference
      colors don't match the palette closely enough (nearest-neighbor
      picked a wrong index) — retune the reference or the palette.

## Notes

- The engine explicitly does **not** punish wrong taps — a kid who fills
  region 3 with color 2 just gets a fill in color 2 and no eureka
  reaction. Design accordingly: correctness is the reward, not the gate.
- CBN pages can share art with freehand pages (as `cbn-sun` shares
  `sun.png` in the current demo), but only if the freehand art meets
  the checklist above. Most freehand pages won't.
- The palette hides the color-group tabs and the custom-color swatch in
  CBN mode. If you want the kid to have any color outside the numbered
  palette, this feature isn't for that page.
