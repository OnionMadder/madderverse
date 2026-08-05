# Tiny Canvas — store assets

Everything a Play Console / App Store Connect listing needs, other than
the copy (that lives in `../STORE_LISTING.md`).

| File | Where it goes | Spec |
|---|---|---|
| `icon-512.png` | Play Console → Main store listing → App icon | 512×512, 32-bit PNG, **no alpha** |
| `icon-1024.png` | App Store Connect → Marketing icon | 1024×1024, **no alpha, no rounded corners** (Apple masks them itself) |
| `feature-graphic.png` | Play Console → Main store listing → Feature graphic | 1024×500, PNG or JPEG, **no alpha** |
| `screenshots/` | Both stores | see below |

## Screenshots

Google Play needs **at least 2** phone screenshots; 4–8 is the useful
range. 16:9 or 9:16, each side between 320px and 3840px, and the long
side no more than twice the short side. PNG or JPEG, no alpha.

Drop them in `screenshots/` named so they sort into the order you want
them shown — `01-title.png`, `02-picker.png`, and so on. Play displays
them in filename order.

Worth capturing, in roughly this order of persuasiveness:

1. A finished, colourful drawing on a template page — the payoff shot
2. The picker grid, showing the range of pages
3. The tool tray open, showing brushes and the colour palette
4. The fill tool mid-use, since tap-to-fill is the thing that makes it
   usable for a small child
5. The gallery with several saved drawings

Shoot on a real device rather than a desktop browser: the layout below
1030px is a different arrangement, and that is what a phone user sees.

## Regenerating the icon and feature graphic

Both derive from `../icons/*.svg`. The icon rasters come from
`icons/icon.svg` at 1024 and downscale; the feature graphic is composed
from the butterfly template coloured by the app's own flood-fill, the
same way `../cover.jpg` is — see the Tiny Canvas section of the repo
root `CLAUDE.md` for that recipe.

**Do not put alpha in any of these.** Play rejects a feature graphic
with transparency, and Apple rejects a marketing icon with it.
