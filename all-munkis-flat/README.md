# All Munkis — itch.io flat build

This folder is the **itch.io-ready static clone** of the game. It is a
mirror of `../all-munkis/` (the canonical web/Play source), flattened so
every path is relative and nothing phones home — suitable for itch.io's
zip-upload hosting where the game runs inside an iframe.

**Do not edit files in here directly.** This folder is *regenerated*
from `../all-munkis/` whenever the source changes substantively. Make
game changes in `../all-munkis/`, then re-flatten.

## Test locally

Just open `index.html` — it works straight off the filesystem
(`file://`) with no server, because every path is relative and there is
no analytics / service worker / cross-origin fetch. Audio starts on the
first tap (Web Audio autoplay policy), exactly as on itch.

## Package for itch.io upload

Zip the **contents of this folder**, NOT the folder itself:

```
cd all-munkis-flat
zip -r ../all-munkis-itch.zip . -x "README.md" -x ".itchignore" -x "*.md"
```

`index.html` must sit at the **root of the zip** (itch serves the zip
root). Upload `all-munkis-itch.zip` to itch.io and set the embed/viewport
to roughly 960×640 (the game is responsive and also auto-fits portrait
phones).

Do **not** zip the parent folder — if itch sees `all-munkis-flat/index.html`
instead of `index.html` at the zip root the game 404s.

## What was changed vs. `../all-munkis/`

- **Cross-site meta stripped** — `canonical`, `og:url`, `twitter:url`
  removed (placeholder comment left to optionally point at the itch URL).
- **GoatCounter analytics removed** — itch builds don't phone home.
- **Shared footer CSS localized** — `../assets/css/site-footer.css`
  copied in as `assets/css/site-footer.css` (no parent refs survive).
- **Prominent top-left "home" button removed** — an iframed itch game
  shouldn't aggressively push players off-platform. The footer keeps an
  unobtrusive Madderverse link that opens in a **new tab**
  (`target="_blank" rel="noopener"`).
- **Flying Creeps = the itch-exclusive meta sheet.** Per the documented
  build step in `../all-munkis/assets/sprites/FLYING_CREEPS_README.md`,
  itch.io builds swap `itch-creeps.{png,json}` over
  `flying-creeps.{png,json}`. That swap is baked into this folder; the
  separate `itch-creeps.*` source files are not shipped here. (The
  web/Play source keeps the kid-clean standard sheet — untouched.)
- **Dev/internal docs excluded** — `CLAUDE.md`, `DESIGN_NOTES.md`,
  `deferred-pre-wrap.md`, the sprite `*_README.md` files, and `legal/`
  (not referenced by the game) are intentionally absent.

## Excluded from the upload zip

`README.md`, `.itchignore`, and any `*.md` must NOT be in the itch zip.
The zip command above and `.itchignore` both enforce this. The only
Markdown in this folder is this README; keep it that way.

## Source of truth

`../all-munkis/` — the canonical source. This folder is a build
artifact. Regenerate it (don't hand-patch) after source changes.
