# Store assets — swap spec

Everything in `icons/` and `store-assets/` is a **PLACEHOLDER**.
It's presentable enough to survive a quick internal-test review,
but swap it for finished art before the **public production**
release. This file is the exact spec for each asset.

When you replace a source SVG, keep the **viewBox / dimensions
identical** so the layout/cropping math still holds, then re-run
the generation commands.

---

## 1. App icon — `icons/icon.svg`

| | |
|---|---|
| Source | `icons/icon.svg` (also mirrored at `www/icons/icon.svg`) |
| Master size | 1024×1024, full-bleed, **no transparency, no pre-rounded corners** |
| Generates | every Android launcher density via `npm run assets:generate` |
| Play listing icon | 512×512 PNG — export `icons/icon.svg` at 512 (Play Console "App icon" field) |

Rules: art must read at 48px. Keep the focal Munki inside the
centred ~72%-diameter circle (Android adaptive masks). Background
should be (or sit on) `#0c0c1a` — it's the configured adaptive
background in `capacitor.config.json`.

## 2. Adaptive-icon foreground — `icons/icon-foreground.svg`

| | |
|---|---|
| Source | `icons/icon-foreground.svg` (+ `www/icons/`) |
| Size | 1024×1024, **foreground only, no opaque background** |
| Safe zone | inner ~61% circle (≈ x/y 200→824). Anything outside may clip under teardrop/squircle masks. |
| Generates | `mipmap-*/ic_launcher_foreground` via `npm run assets:generate` |

The system fills `#0c0c1a` behind it (set in `capacitor.config.json`
+ the generated `ic_launcher_background`).

## 3. Splash — `icons/splash.svg`

| | |
|---|---|
| Source | `icons/splash.svg` (+ `www/icons/`) |
| Size | 2732×2732 square (Capacitor `CENTER_CROP`s to any device aspect) |
| Safe zone | keep critical art within the centred ~1600px circle |
| Background | must equal `#0c0c1a` (matches `SplashScreen.backgroundColor`) so crop seams are invisible |
| Generates | `drawable-*/splash.png` via `npm run assets:generate` |

## 4. Feature graphic — `store-assets/feature-graphic/feature-graphic.svg`

| | |
|---|---|
| Source | `store-assets/feature-graphic/feature-graphic.svg` |
| Size | **exactly 1024×500**, PNG or JPG, no alpha, < 1 MB |
| Used | the banner at the top of the Play Store listing |
| Export | rasterize at 2048×1000 (2×) then downscale to 1024×500 |

Keep the wordmark + at least one full Munki centred; no critical
content in the outer ~24px (Play overlays a play button + crops
slightly on some surfaces).

## 5. Screenshots — generated, not hand-made

`scripts/capture-screenshots.js` (run via `npm run screenshots`)
produces 4 PNGs per device profile into
`store-assets/screenshots/<profile>/`:

| File | State |
|---|---|
| `01-title.png` | fresh load — empty rainbow stage + full bank |
| `02-rainbow.png` | all six rainbow Munkis on the stage |
| `03-drag.png` | a Munki mid-drag (ghost + drop-target glow) |
| `04-achievements.png` | achievements panel open, a few unlocked |

Profiles: `android-phone` (required), `android-7in-tablet`,
`android-10in-tablet` (Designed-for-Families tablet slots).

Play Console minimums: **2–8 phone screenshots**, 16:9 or 9:16,
each 320–3840px per side. The generated phone set (412×915 @2.5×
= 1030×2288) satisfies this. Re-run after any visual change.

---

## Rasterizing SVG → PNG

`@capacitor/assets` handles the launcher/splash matrix automatically
from the SVG sources (`npm run assets:generate`). For the two
**hand-export** assets (512 Play icon, 1024×500 feature graphic),
any of these works:

- **Inkscape:** `inkscape icon.svg -w 512 -h 512 -o icon-512.png`
- **rsvg-convert:** `rsvg-convert -w 1024 -h 500 feature-graphic.svg -o feature-graphic.png`
- **Browser:** open the SVG, set the viewport to the target size,
  screenshot. (Lowest fidelity — prefer the CLI tools.)

## Final-art brief (when you're ready to replace placeholders)

The placeholders establish the visual language; finished art should
keep it consistent with the in-game look:

- **Palette:** stage `#0c0c1a`; the six Munki colours are
  `#dc2626 #ff9800 #fbbf24 #43a047 #1e88e5 #9c27b0`; accent pink
  `#ff5cab`; teal LED `#2dd4bf`.
- **Character:** rounded body + big round head + oversized matte-black
  studio headphones with a teal "live" LED. That headphone silhouette
  is the brand — keep it.
- **Premise to convey:** a cheerful rainbow of Munkis, with the
  faint sense that someone's been left out (room for the Ice/Moon
  "jealous outsider" beat in the feature graphic if you want it).
- **Tone:** warm, cozy, kid-safe. Not spooky on the icon — horror
  mode is a discovery, not the cover.
