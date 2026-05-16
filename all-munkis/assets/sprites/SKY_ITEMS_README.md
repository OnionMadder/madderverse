# sky-items sprite sheet — drop spec

`sky-items.{png,json}` is the art for the **Moon-chaos rain** — the
falling sky objects spawned by `moonRain()` when Moon Munki is on the
stage and the kid clicks. It replaced the old childish `🌙` emoji rain;
the game never falls back to an emoji (see "Fallback" below).

## What the game reads

`loadSkyItemsSheet()` in `game.js` fetches
`assets/sprites/sky-items.json`, a **TexturePacker JSON-hash** sheet
(same shape as `flying-creeps.json` / `mb-heads.json`):

```json
{ "frames": {
    "moon-red":  { "frame": { "x":.., "y":.., "w":.., "h":.. } },
    ... 8 moon-* frames ...
    "comet-red": { "frame": { "x":.., "y":.., "w":.., "h":.. } },
    ... 4 comet-* frames ...
  },
  "meta": { "size": { "w":2602, "h":1089 } } }
```

**The loader keeps ONLY frames whose name does NOT contain `comet`**
(case-insensitive). So:

- The **8 moon variants** (any name, e.g. `moon-red`, `moon-cyan`, …)
  are picked at random, one per rain particle, cropped from the PNG and
  scaled small. Frame names don't matter beyond the `comet` exclusion —
  a leading-letter typo (`oon-cyan`) would still have worked, but keep
  them clean.
- The **4 `comet-*` frames are deliberately ignored in v1.0.** They are
  reserved for **v1.1** (large comet streaks). Leaving them in the sheet
  is fine and intended — `game.js` will simply not draw them until the
  1.1 feature lands. Do **not** remove them to "clean up"; 1.1 expects
  them here.

`meta.image` is ignored — the loader always uses
`assets/sprites/sky-items.png`. `meta.size` is recommended; if absent
it's inferred from the moon frame rects.

## Two copies must stay byte-identical

Like every gameplay asset, drop the **same** `sky-items.{png,json}` into
**both**:

- `all-munkis/assets/sprites/` (web — deploys to madderverse.org)
- `all-munkis-app/www/assets/sprites/` (Capacitor app source; then
  `npx cap sync android` before an AAB build)

> ⚠️ Path-mismatch warning (this has bitten us — see the `stage.jpg`
> note in `../../CLAUDE.md`): editing a *local checkout* does nothing.
> Builds, `cap sync`, the AAB and the GitHub Pages deploy all come from
> what's **committed to git in the build worktree**. A new sheet isn't
> "done" until both paths above are committed to `main`.

## Replacing the sheet later

Any layout works as long as every moon frame's `frame.x/y/w/h` is
correct and there are ≥1 non-`comet` frames. The renderer scales each
frame's longest side to a small random size (~22–56px) and shaves
`SKY_RAIN_INSET` (3px) per side to kill neighbour bleed at the sheet's
~2px gutter. Drop the new pair into both dirs, commit, `npx cap sync
android`. No code change needed unless you rename so that a moon frame
accidentally contains the substring "comet".

## Fallback (no sheet present)

If `sky-items.json` is missing or fails to load, `moonRain()` draws a
small pale **radial-gradient orb** (CSS, no asset) — never an emoji.
The chaos effect still works; it just isn't the painted moons.

## Status

**SHIPPED in v1.0.** 8 moons live in the rain; 4 comets parked for
v1.1. This is the standard sheet for web **and** the Play app (no
itch-exclusive variant, unlike `flying-creeps`).
