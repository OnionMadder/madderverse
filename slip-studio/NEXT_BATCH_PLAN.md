# Slip Studio — Next Batch Build Plan

Goal: **outstanding value for the money.** Deepen the craft, add delight, make the
results beautiful and worth keeping — all as generous, unlocked content. No
engagement/monetization/attention tricks (paid app, ad-free, no IAP, Teacher
Approved, local-only gallery). Calm/meditative brand throughout.

---

## ⚠ Ship state & git workflow — READ FIRST
- **`main` = web v136** = what Play AAB **vc13 / 2.4.0** bundles (uploaded, **in Google review**) = live at madderverse.org/slip-studio/. `?v=136` on main is correct.
- This plan's work continues on branch **`slip-next-batch`** (already holds v137–140: Lane-1 content, stamps removed, set-handle fix). **Stay on this branch. Do NOT push to `main`** — Pages auto-deploys on any push to main, and the reviewed build + live trial must stay matched until vc13 is approved.
- **After vc13 is approved:** `git checkout main && git merge slip-next-batch` → deploy web (verify live `?v=`) → rebuild the Play AAB as **vc14** (bump versionCode 13→14 / versionName). See CLAUDE.md "Big feature + value run" + the `project_slip_studio_android_build` memory.

## How to work
- **Verify in the preview** via the `?dev` `window.__slip` handle + `preview_eval` (numeric/state checks). **WebGL screenshots time out** on this app — don't rely on them; measure state/pixels or use `preview_resize` for layout. Serve on a free port (8796 is the canonical `slip-studio` config; others may be held by concurrent sessions).
- **Cache-bust every web change:** bump `main.js?v=N` + `style.css?v=N` in `index.html` (currently v140 on the branch). The module `<script>`/`<link>` URL is what actually reloads — the page `&t=` does not.
- **Optimize any new art** with `scratchpad/optimize_assets.py` (Pillow: 640px q82 JPEG for opaque tiles; 256-colour FASTOCTREE PNG preserving alpha for transparent art). Keeps size near-free.
- Key code map: decoration = baked `paintCanvas` + `placements[]` → `composeDeco()` → `decoCanvas`; clay shader `onBeforeCompile` (cache key `clay-gradient-sgraffito-dip-v6`) samples decoMap + sgraffitoMap + uDipMap; glaze dips live in the dip canvas (`state.dips[]`, `renderDips`/`paintDip`); bump relief in `bumpCanvas` (`bumpDab`/`bumpDabWrap`); shapes in `SHAPES`, lids in `LID_STYLES`; firing arc wet→leather→fired (`advanceStage`/`startFiringMoment`/`endFiringMoment`).

---

## Phase A — Glaze magic (high delight, mostly shader/data, reuses the dip system)
**A1. Overlapping-dip colour reactions ⭐** — when two dips overlap, the overlap shows an emergent *third* colour instead of the top simply covering. Cheapest win: in `paintDip`/`renderDips`, composite stacked dips with a *blend* (multiply/average in linear space) so overlaps mix naturally; optional curated `REACTION_PAIRS` table for signature combos (e.g. cobalt+honey→green). Verify: sample the dip canvas in an overlap band. Delight: "glaze chemistry" discovery.
**A2. Speckled + crackle glazes** — add procedural texture to the clay shader over the glaze: a hash-noise **speckle** term and a cellular **crackle** network, gated by per-glaze flags (`glaze("Ash", …, { speckle: 0.5 })`). Bump the shader cache key. New **Stoneware** glaze pack (speckled earthies) + a couple of crackle/raku glazes. Verify: shader compiles, fired swatch differs from flat.
**A3. Finish variants** — per-glaze **matte ↔ glossy** (roughness/clearcoat) and an **iridescent luster** (enable `material.iridescence` on MeshPhysicalMaterial). Cheap: matte/gloss are material params; luster is one material flag. Adds a whole finish dimension to existing glazes.

## Phase B — Craft techniques (the "endless depth" lever)
**B1. Slip trailing ⭐** — a "pipe" tool that draws a **raised coloured bead** line: paint colour into the deco layer AND positive relief into `bumpCanvas` along the stroke (reuse `dab`/`dabWrap` + `bumpDab`/`bumpDabWrap`). Very tactile, very kid-friendly. Save/load already carries the bump canvas. New family/variant in the tool tray.
**B2. Wax resist ⭐** — paint a **resist mask** (new `resistCanvas`, like sgraffito); the clay shader skips glaze/dip/deco where resist alpha > 0 (`_dip.a *= 1.0 - resist;` etc.), so resisted areas fire as bare clay. New "Resist" tool. Save/load the resist canvas + sync to the partner mesh. Layered, sophisticated results from one gesture.
**B3. Marbling** — v1: **marbled dip presets** (swirled 2-colour gradients baked into `DIP_SETS`-style presets) — cheap. Stretch: an interactive **swirl** tool that warps the dip/deco canvas along the drag (fluid displacement) — magical but higher effort; do only if v1 lands well.

## Phase C — The keepsake payoff (why people treasure the app) ⭐
**C1. Kiln-shelf photo ⭐** — a "Shelf" view that composites your saved pot **thumbnails** onto a warm wooden shelf (2D composite of existing thumbs — cheap, no multi-pot 3D render) and **exports the whole shelf as one photo**. Turns the gallery into a proud, printable showcase. Reuse the photo-export path (`composeStyledPhoto` / Web Share + anchor download).
**C2. Named collections/shelves** — group gallery pots into named collections (localStorage, e.g. `slip-collections`); gallery UI to create/assign/filter. Fully local (Teacher-Approved safe).
**C3. More photo frames/styles** — add a few framing styles to the Photo modal (currently Studio/Sunlit/Museum) + confirm easy save-to-camera-roll on device.

## Phase D — More to make (forms & structure)
**D1. New shapes** — add lathe-able `SHAPES`: planter, goblet, bud vase, tumbler, and a **mug** preset (cup profile that auto-enables a single handle). Easy (control-point profiles). Spout/teapot need added non-lathe geometry (like the handle) → stretch.
**D2. Foot & rim variety** — footed vs flat bases (profile), then scalloped/fluted rims (geometry at the top rows) as a stretch.
**D3. Fluting** — v1 faux fluting as vertical grooves painted into `bumpCanvas` (cheap relief). Real faceting = per-angle radius modulation in the geometry → stretch.

## Phase E — Content packs (Lane 2 — Onion sources art, next session wires + optimizes)
- **Wire `mythological-creatures`** — already on disk at `assets/motifs/mythological-creatures/` (roc/dragon/phoenix/griffin/unicorn), unoptimized (~5.6M), NOT in `MOTIF_PACKS`. Optimize + add a pack entry.
- New motif packs as supplied: sea life, space, dinosaurs, flowers, birds, bugs, more world folk-art.
- New band friezes (Greek key, Celtic, Nordic, florals), enamel/pattern tiles, backdrops.
- Each = folder-drop + a few lines in the PACKS tables; run the optimizer.

## Phase F — Housekeeping (fold in alongside)
- **Remove dead stamp code** — `drawStamp`, `stampAt`, `STAMP_SHAPES`, `starPath`, `heartPath`, `setStampShape`, and the `__slip` dev-handle refs (the Stamp *tool* is gone; these are now unreferenced).
- Keep bumping cache-bust (v141+). Stay on `slip-next-batch`.

---

## Suggested order for the session
1. **A1 (dip reactions)** + **A2 (speckle/crackle glazes)** — fast, high-delight, low-risk; a great warm-up that visibly deepens glazing.
2. **B1 (slip trailing)** + **B2 (wax resist)** — the craft-depth centerpiece.
3. **C1 (kiln-shelf photo)** — the keepsake headline.
4. **D1 (new shapes)** + **A3 (finishes)** — breadth.
5. **E (wire mythological + any new packs)** + **F (stamp cleanup)** — content + tidy.
Ship each phase verified; keep it all on `slip-next-batch` until vc13 clears, then merge → deploy → vc14. Marbling-interactive, teapot spouts, real faceting, and scalloped rims are explicit **stretch** goals — only if the core lands cleanly.

Guardrail check for every idea: does it add creative depth / delight / beauty / keepsake / calm — with everything unlocked and no pressure mechanics? If yes, build it.
