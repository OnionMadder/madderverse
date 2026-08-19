# CBN-Friendly Coloring Page Checklist

Rules of thumb for designing coloring pages that work as **color-by-number**.

A page that *fills* cleanly for freehand can still be a bad CBN page. Freehand
only needs regions to be sealed; CBN also needs every region to be **big enough
to hold a number**, which is a much stronger requirement and the one that is
easiest to miss by eye.

If a rule is violated the engine won't crash — you'll just get a page that is
frustrating to color by number, or regions that can never be numbered at all.

> **Rewritten 2026-08-18** alongside the engine rebuild. Anything you remember
> about centroids, `CBN_MIN_REGION_PX`, a 40-region cap, or hand-coloring a
> reference PNG is from the old engine and no longer true.

---

## The one number that decides everything: how much room for a digit

A number has to fit **inside** its region. But a digit is tall and narrow, and
so is a ribbon — so the test is not "does a circle fit", it is "does a digit
fit". A cactus rib 5 px wide and 400 px tall has room for nothing; a rainbow
band 14 px wide and 300 px tall has room for a number.

The runtime measures each region's width and height through its anchor and
picks one of three outcomes:

- **pill** — the full badge (paper capsule, dark outline). Needs about 1.7×
  the font size in both directions.
- **slim** — the bare glyph with a halo instead of a capsule. Needs little
  more than the digit. This is what lets narrow bands carry a number at all.
- **hidden** — no room for either at this zoom. Zooming in grows the region
  on screen and the number appears.

So a too-small region isn't broken, it's just extra work for the kid. What you
are designing against is *how much zooming your page demands.*

`scripts/process-cbn-page.py` measures it:

```bash
python3 scripts/process-cbn-page.py assets/coloring-pages/cbn/cactus.png
# cactus.png  1024x572  regions=6  numbered: 1x=6  8x=6  worst-zoom= 1.0x
```

- `numbered: 1x=N` — regions readable on a phone with no zoom. **Aim for most
  of them.** The shipped pack runs from 6-of-6 (cactus, rainbow) down to
  22-of-36 (sunny day, whose 24 rays are genuinely fine detail).
- `numbered: 8x=N` — should equal the region count. Anything less is flagged
  `UNREACHABLE` and lists the offending region ids.
- `worst-zoom` — the deepest zoom any region demands. Under 4x is comfortable;
  the app's ceiling on CBN pages is 8x.

If a page demands a lot of zooming, the honest fix is usually the art, not the
data — see "When fine interior detail shatters a shape" below.

**`UNREACHABLE` is the only hard failure.** It means a region can never hold a
number no matter how far the kid zooms. Fix it in the art.

---

## The line art

- [ ] **Every region is fully sealed.** No hairline gaps at corners, no
      incomplete curves. A single pixel where alpha < 96 lets fill escape into
      the neighboring region. Zoom to 200% and eyeball every join.
- [ ] **Ink thickness ≥ 3 px at the 1800 px shipping width.** Thinner lines
      antialias below the alpha-96 threshold and read to the engine as an open
      border. Digital lineart at 2 px looks fine to the eye and leaks.
- [ ] **Solid #1c2226 (or close). No half-opacity shading strokes.** A grey
      wash counts as a partial boundary — sometimes seals, sometimes leaks,
      unpredictably.
- [ ] **Watch "decorative" open strokes.** A mouth curve, a whisker, a rain
      streak: visually fine, but if one *does* close against another line it
      splits the parent into oddly-shaped pieces that each get their own
      number. Check the region map (below) rather than guessing.

## Region count and shape

- [ ] **Roughly 6 to 25 fillable regions.** The shipped pack runs 6 (cactus)
      to 36 (sunny day). Under 6 reads as too simple; much over 25 is a long
      sit for a small kid. The engine bails past `MAX_REGIONS` (120), which is
      a runaway signal — a page hitting that has shattered into speckle.
      Keep the pack ordered by region count: the first card is the one a kid
      meets first.
- [ ] **Concave shapes are fine now.** Numbers sit at each region's *pole of
      inaccessibility* — the center of the largest inscribed circle — not its
      centroid, so a horseshoe, crescent or wrap-around background gets its
      number placed inside itself. (Under the old engine 39 of 135 regions
      across this pack put their number outside their own shape. That is what
      the rebuild fixed; you no longer have to design around it.)
- [ ] **Thin ribbons are the remaining hazard**, but less than they were: a
      digit is itself tall and narrow, so a ribbon needs to be wide enough for
      the glyph, not for a circle. Rainbow's bands all number without zooming.
      Below roughly 2% of page width a ribbon starts demanding zoom, and at
      that point the honest fix is usually to stop treating it as a region at
      all — see "When fine interior detail shatters a shape".
- [ ] **Specks are free.** Anything under the area floor (`MIN_AREA_FRAC`,
      ~0.04% of the page) gets no number and no completion requirement — the
      kid colors it however they like. Antialiasing crumbs don't need
      designing around.

### When fine interior detail shatters a shape

Some art is drawn with thin decorative lines *inside* a shape — cactus ribs,
hatching, fur. The fill mask cannot tell decoration from structure: anything
at alpha ≥ 96 is a wall. So the shape shatters into ribbons far too narrow to
hold a number, and the page demands constant zooming.

The fix is to demote those strokes: drop their alpha just **below** the ink
threshold. They still render — the line art draws over the kid's colour, so
they still read as ribs — but fill and CBN see straight through them, and the
shape becomes one region. This is how the pumpkin's interior rib curves
already behave, because they were drawn as open strokes.

```bash
python3 scripts/process-cbn-page.py assets/coloring-pages/cbn/cactus.png \
    --soften assets/coloring-pages/cbn/cactus.png
```

It is deliberately conservative about *which* strokes it touches. Thickness
alone is not a safe test — on the cactus the pot's soil ellipse is the same
4–7 px as the ribs. So a stroke is demoted only when **it separates two
regions, at least one of them too small to number, and neither of them
reaches the page edge.** That last condition is the important one: without
it the outline between a thin rib and the sky qualifies, the whole cactus
falls into the background, and the region count collapses (17 → 4, which is
exactly what happened the first time). The script re-checks its own output
and refuses if the background grew.

The cactus went 17 regions needing 5.8× zoom → **6 regions, all numbered with
no zoom at all**, and the artwork looks the same.

⚠ **Softening happens AFTER `process-coloring-pages.py`, on the shipped PNG** —
alpha ink only exists at that stage. So re-running the art pipeline will
overwrite it and the page will silently go back to shattering. Re-soften
after any regeneration, and **bump the `?v=` on that page's `image:` path in
templates.js** — a cached copy of the old art paired with the new seeds
numbers the page wrongly, and image files carry no cache-bust of their own.

## Palette

- [ ] **4 to 8 numbered colors.** The shipped pack runs 5 to 8. Fewer than 4
      is a mood, not a game; more than 8 is more than a kid holds in their
      head, and the numbered swatch row gets crowded.
- [ ] **Each color at least ~18 units apart in RGB.** The fill tolerance is 6
      (`TOL2` in `floodFillAt`) and the general palette rule is 18.4. The
      shipped CBN palettes are all ≥53 apart, which is a good target — kids
      have to tell the swatches apart at a glance, which is a stricter demand
      than the fill tool's.
- [ ] **Colors make visual sense with the scene.** A kid learns colors partly
      by association — sky is blue, grass is green. Random palettes work
      mechanically and land as noise.
- [ ] **Use every number.** A palette entry no region wants is a swatch that
      does nothing, which reads as a bug.
- [ ] **Reuse a number across regions freely.** All eight clouds being "8" is
      correct and good; it teaches the kid to scan for a color.

## Composition

- [ ] **No stacked overlaps.** A region hidden behind another (a bird
      half-behind a cloud) merges with it unless the gap is inked. Compose
      flat, not in depth stacks.
- [ ] **Full-bleed backgrounds are fine.** The engine seals the page edge, so
      a full-bleed sky is one clean region bounded by the page border rather
      than escaping into the paper margins. (The old guide warned against
      this; it has been handled in the fill mask for a while.)

---

## Authoring the colors

**Use the editor.** `tools/cbn-editor.html` loads the same `cbn-core.js` the
game runs, so the regions you click are exactly the regions the game detects.

```bash
python3 -m http.server 8000        # from tiny-canvas/
# then open http://localhost:8000/tools/cbn-editor.html
```

Pick the page, click a region, click a number. The panel shows the fitness
report live, and each region's inscribed radius and required zoom on hover.
When it looks right, **copy cbn block** and paste it into `templates.js`.

The exported entries are `{ x, y, ci }` — a point plus a palette index. The
point is the region's anchor, so it is always inside its region; the runtime
maps it back onto whichever region it lands in. **No geometry is exported**, so
re-running the detector later can never leave the data stale.

*(The old workflow — hand-color a full reference PNG, sample it with
`process-cbn-page.py --reference` — still works and is kept for bulk runs. It
is no longer the recommended route: coloring a whole reference per page is what
left seven of the eight pages unauthored for a month.)*

### Looking at the regions

To decide colors you need to see what the engine sees:

```bash
python3 scripts/process-cbn-page.py assets/coloring-pages/cbn/cat.png \
    --map /tmp/cat-map.png
```

That writes the page with every region flat-tinted and its id drawn at its
anchor. Two regions sharing a tint next to each other means they **merged** —
an ink gap. A region you expected and can't find is under the area floor.

## Testing in the app

- [ ] **Open the page and check the counter.** The `N / M` pill on the left
      rail is the region count; if `M` is not what you authored, some seeds
      missed.
- [ ] **Every region shows a number, eventually.** At 1x on a phone most
      pages hide some — that is by design. Zoom in and they appear. If one
      never appears at full zoom, the audit would have flagged it
      `UNREACHABLE`.
- [ ] **A correct tap advances the counter and the number disappears.** A
      wrong tap fills anyway, and the counter does not move.
- [ ] **Come back to the page later.** Completed regions stay completed —
      progress rides the in-progress save.

## Notes

- The engine explicitly does **not** punish wrong taps. A kid who fills region
  3 with color 2 gets a fill in color 2 and no eureka reaction, and can fix it
  by tapping again with the right number. Correctness is the reward, not the
  gate.
- **Fill-erasing a correct region un-completes it** and brings its number back,
  so a kid can undo without the counter lying.
- CBN pages can share art with freehand pages (`cbn-sun` uses the free pack's
  `sun.png`), but only if the art meets this checklist. Most freehand pages
  won't — they are dense scenes with hundreds of regions.
- The palette hides the color-group tabs and the custom-color swatch in CBN
  mode. If a page should let the kid use any color, it shouldn't be a CBN page.
