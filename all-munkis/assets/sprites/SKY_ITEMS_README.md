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

**The loader (`loadSkyItemsSheet`) splits frames by name into
`moons` (name does NOT contain `comet`) and `comets` (name DOES,
case-insensitive). So:

- The **8 moon variants** (e.g. `moon-red`, `moon-cyan`, …) feed the
  Moon-chaos splash and the gentle Moon-horror rain — picked at
  random, cropped, scaled small. Names don't matter beyond the
  `comet` substring rule, but keep them clean.
- The **4 `comet-*` frames are LIVE as of v1.1.** They are the rarer,
  bigger, fast **diagonal streaks** woven into the Moon-horror rain
  (`spawnFallingComet`, `MOON_FALL.COMET_CHANCE`). Keep them named
  with the `comet` substring so the split works; do **not** remove
  them.

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

**SHIPPED.** 8 moons live in the Moon-chaos splash + Moon-horror
rain (v1.0); the 4 comets are now LIVE too as the v1.1 Moon-horror
diagonal streaks. This is the standard sheet for web **and** the Play
app (no itch-exclusive variant, unlike `flying-creeps`).
