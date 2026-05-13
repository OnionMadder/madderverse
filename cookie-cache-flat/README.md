# Tub's Cookie Cache — itch.io flat build

Self-contained, fully-relative-path copy of `../cookie-cache/`, ready to zip
and upload to itch.io as an HTML5 game.

## What's different from the source?

| File | Difference |
|---|---|
| `index.html` | Cross-site `canonical` / `og:url` / `twitter:url` meta tags stripped (placeholder comment marks where to drop the real itch.io URL). The top-left `< RETURN` button became a small bottom-center `↗ MORE AT MADDERVERSE.ORG` cross-promo that opens in a new tab. og/twitter title + description retitled around the game itself instead of FYMZ branding. |
| `style.css` | New `.btn-return-flat` modifier that repositions the button (bottom-center, smaller, lower opacity). |
| `game.js` | Identical to the source. |
| `assets/` | Identical to the source. |
| Favicons, og:image, twitter:image | Still point to `https://madderverse.org/...` — these are read by external scrapers and PWA installers, and resolving them online is fine. |
| Analytics | GoatCounter beacon still fires to the madderverse account. Remove the `<script data-goatcounter=...>` tag if itch.io tracking should be off. |

## Test locally

Open `index.html` directly in a browser via `file://` — no web server needed.
That's the closest local approximation to itch.io's static container. The
game should fully play through with no console 404s.

```
# Windows
start cookie-cache-flat\index.html

# macOS
open cookie-cache-flat/index.html

# Linux
xdg-open cookie-cache-flat/index.html
```

## Package for itch.io

Zip the **contents** of this folder, not the folder itself. itch.io expects
`index.html` at the root of the uploaded archive.

```bash
# from repo root
cd cookie-cache-flat
zip -r ../cookie-cache-itch.zip . -x "README.md" ".itchignore"
```

**Do not include `README.md` or `.itchignore`** in the upload — they're
build/repo metadata, not runtime files. The `.itchignore` is honored by the
`butler` CLI if the user uploads via that tool. The manual `zip -x` flags
above mirror the same exclusion for ad-hoc zips.

## Editing rule

**Don't edit files in `cookie-cache-flat/` directly.** Edit the source in
`../cookie-cache/` and re-flatten by re-running Chunk 6. The flat build is a
release artifact, not a fork.
