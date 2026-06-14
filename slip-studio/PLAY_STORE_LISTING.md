# Slip Studio — v2 release notes + Google Play Store listing

Copy-paste source for the **Play Console Main store listing** and the public
v2 release notes. Voice = calm, confident, minimal — matches the app's own
tone. Audience = **Everyone** (no social, no UGC sharing, no network calls
after install). Pricing = **paid app, one-time price, no in-app purchases**.

> The web build at https://madderverse.org/slip-studio/ is the de-facto trial —
> the store listing mentions it as a free preview so buyers can try the studio
> in their browser before paying. There is intentionally no Play-side trial,
> no IAP, no RevenueCat, and no ads. (See CLAUDE.md → "Slip Studio Android
> paid app build & publish".)

---

## App title  (max 30 chars)

```
Slip Studio
```
(11 chars — room left if a tagline ever wants to ride along)

Optional longer variant (still ≤30):
```
Slip Studio — Shape Clay
```
(23 chars)

## Short description  (max 80 chars)

```
A calm 3D pottery studio. Shape, glaze, fire, and keep your pieces.
```
(67 chars)

Alternative if you want to lead with the no-ads angle:
```
A calm pottery studio in 3D. No ads, no upsells, no internet needed.
```
(67 chars)

## Full description  (max 4000 chars)

```
Slip Studio is a calm place to shape clay.

Pull a vase, a bowl, a cup, or a bottle from a slow-spinning wheel. Trim the foot at leather-hard. Pour a glaze, paint a pattern, fire it in the kiln, and watch the raw chalky coat melt into a glossy finish. Keep what you make in a quiet portfolio that lives on your device, not on a server.

There is no progress bar. There are no daily quests, no streaks, no notifications. Slip Studio is a studio, not a game.

WHAT YOU DO
• Start from one of four silhouettes — vase, bowl, cup, or bottle
• Throw clay on a contemplative, slow-turning wheel
• Trim the foot at leather-hard for a clean profile
• Glaze in one of 16 colours, including three metallics, an iron red, a pearl, and a true cobalt
• Paint with brushes, splatter, ten stamp shapes, or eight repeating overlay patterns
• Fire in a kiln that closes around the scene, glows warm, and opens onto a finished pot
• Sculpt a matching lid for any pot — flat, domed, or tall — and fire the set together
• Save your pieces to a portfolio shelf, name them, frame them, and come back later

PHOTOS WORTH KEEPING
A built-in photo composer renders your pot at print size, on three styled backgrounds — a studio shelf, a sunlit window, or a museum plinth — square for a feed or tall for a phone wallpaper. Share the file or save it straight to your photos.

PAID ONCE. NOTHING ELSE.
• No ads. Not banner, not interstitial, not "rewarded."
• No subscriptions, no in-app purchases, no glaze packs to unlock.
• No account. No sign-in.
• Works offline — the studio, glazes, kiln, gallery, and three starter backdrops are all bundled at install. Every save is local.
• No analytics, no third-party trackers, no advertising profiles.

ATMOSPHERE
• Three hand-picked starter backdrops included at install; five more themed packs (Art, Botanical, Digital, Paper, Motion videos) are free downloads you opt into one at a time, so motion videos only land on your phone if you want them
• Independent toggles for music and ambient sound — the wheel hum, the clay squelch, the kiln crackle
• Multiple ambient music tracks, chosen at random each session

BUILT FOR QUIET
The app launches into an immersive view — no status bar, no navigation bar, just the wheel and the clay. The whole interface fits one thumb. Pinch to zoom, drag to spin, two-finger pan to look. Re-wet the pot any time before you fire.

TRY BEFORE YOU BUY
A free browser preview lives at madderverse.org/slip-studio/. The full studio is the same — the paid app adds offline play, no browser chrome, immersive fullscreen, and a portfolio that's yours forever.

MADE BY MAD SUNDAR LLC
Slip Studio is part of The Madderverse, a small collection of ad-free apps made by a parent who got tired of creative apps stuffed with timers and upsells. We don't do engagement traps. We do pots.

Questions or data requests: hello@madderverse.org
```
(~3,170 chars — room to add a line or two if you want.)

## What's new  (release notes for the v2.0 first Play upload)

```
Slip Studio v2.0 — the first Play Store release.

Throw, trim, glaze, paint, fire. Make matching lids and pots. Frame a photo on a studio shelf. Save everything to a portfolio that's yours forever.

No ads. No subscriptions. No account. No internet needed.
```

## What's new  (release notes for v2.1)

```
Slip Studio v2.1 — backdrop packs you choose.

The five extra backdrop sets — Art, Botanical, Digital, Paper, and Motion videos — are now optional downloads inside the app, so the install stays small and you only keep what you'll use. Tap a category in the title-screen picker to install it; manage installed packs from "Packs" any time.

Still no ads. Still no subscriptions. Still nothing to sign in to.
```

(Future "What's new" blocks should stay short — one screen of text, not a changelog.)

---

## App display name  (under-the-icon name + Console "App name")

Already set in the Capacitor wrap:
- `slip-studio-app/capacitor.config.json` → `"appName": "Slip Studio"`
- `slip-studio-app/android/app/src/main/res/values/strings.xml` → `<string name="app_name">Slip Studio</string>`
- Play Console → **App name** field → `Slip Studio`

---

## Categorization & pricing

- **Application type:** App  (not Game — Slip Studio is a creative tool, no win-state)
  - Alt: if Play's discovery surfaces favour Games for casual creative apps, "Game → Casual" is also defensible.
- **Category:** Art & Design  (primary recommendation)
- **Tags:** pottery, ceramics, art, creative, 3D, calm, meditative
- **Pricing:** **Paid**. One-time price. **No in-app purchases.** Suggest US $2.99 launch; raise after the first wave of reviews if it lands.
- **Content rating:** complete IARC honestly. Expect **Everyone**.
- **Target audience:** All ages. Slip Studio has **no UGC sharing, no online play, no network connectivity** post-install, so it is safe to declare a low minimum age. Enrolling in "Designed for Families" is OPTIONAL and worth considering — the app cleanly meets the program's rules (no third-party SDKs, no ads, no behavioural data collection).

## Store settings / contact

- **Developer / publisher:** Mad Sundar LLC
- **Package name:** `org.madderverse.slipstudio`
- **Email:** hello@madderverse.org
- **Website:** https://madderverse.org/slip-studio/
- **Privacy policy URL:** https://madderverse.org/slip-studio/privacy/
- **Account deletion URL (Data safety form):** not applicable — the app has no account; the Data Safety form should report "No data collected" / "No data shared." Saves are device-local in IndexedDB and can be cleared via Android system Settings → Apps → Slip Studio → Clear storage.

---

## Graphics deliverables  (PLACEHOLDER — finalize at launch)

| Asset | Spec | Status |
|-------|------|--------|
| App icon | 512×512 PNG, 32-bit, ≤1 MB | **needs downscale for the listing only**. Source at `slip-studio-app/assets/icon.png` is 1080×1080 (rose-striped vase scene) and is already wired into the Android launcher mipmaps via `npx @capacitor/assets generate --android`. For Play's storefront field, downscale the source to 512×512. |
| Feature graphic | 1024×500 PNG/JPG (no alpha) | **needs resize**. Source at `slip-studio-app/assets/slip-feature.png` is 1488×720 — Play will reject this size. Crop/resize to exactly 1024×500 before upload. |
| Phone screenshots | 2–8 images, 16:9 or 9:16, min 320 px side | **5 staged at `slip-studio-app/assets/`**: `title.jpg`, `shape.jpg`, `decorate.jpg`, `fired.jpg`, `gallery.jpg`. Three more optional (the kiln moment mid-fire, the assembled set view, the photo composer). |
| 7" tablet screenshots | optional, up to 8 | optional |
| 10" tablet screenshots | optional, up to 8 | optional |
| Promo video (YouTube URL) | optional but high-leverage for a creative app | optional — a 30-second silent capture of throwing → glazing → firing → photo would convert |

Visual direction = the app's own minimal palette: warm charcoal (`#1b1815`) bg, soft warm ink, no neon. Anti-onioncore. The point is calm.

---

## ASO / keyword notes

- Play has no separate keywords field — discovery is driven by the title + descriptions. The full description naturally seeds: pottery, ceramics, clay, kiln, glaze, 3D pottery, pottery app, calm, meditative, no ads, creative.
- Lead the short description with **calm / 3D / no internet** — that's the differentiation against the existing pottery-game cluster on the store.
- Do **not** name competitor apps in any copy field.

---

# v2.0 full feature list

The complete v2 surface, organized by area. Use this for the website, press kit,
or to expand the store description if Play's character limit changes.

### Throwing
- Four starter silhouettes: vase, bowl, cup, bottle
- A continuously editable lathe profile — every height row is its own radius, sculpted with a Gaussian falloff
- Three brush widths (Fine / Medium / Broad)
- Real wheel physics-feel: the foot can't bulge wider than the wheel head; the belly can
- Pinch-to-zoom, drag-to-spin, two-finger pan; auto-spin eases out while you work

### The clay arc
- Three stages: **Wet** (throw) → **Leather-hard** (decorate + trim) → **Fired** (keep)
- "Re-wet" steps back from leather to wet at any time
- Trim tool at leather-hard, scoped to the foot zone — narrower than wet-stage sculpting, cuts inward only
- The bone-dry phase was deliberately folded into leather-hard so decorating + trim share one stage

### Glazes (16)
- Painterly: Celadon, Cobalt, Oatmeal, Honey, Tenmoku, Blush, Forest, Slate, Plum, Sand, Iron red, Mint
- Metallics: Gold, Copper, Platinum
- Pearl (high clearcoat)
- Each glaze has a chalky **raw** look at leather-hard and a glossy **fired** result — the kiln reveals the transformation live

### Decoration
- Four tools: **Brush**, **Splatter**, **Stamp**, **Overlay**
- 10 stamp shapes: dot, ring, star, spark, heart, flower, cross, triangle, diamond, square
- 8 overlay patterns (one tap fills the whole pot): dots, rings, stripes, grid, scatter, checker, waves, diagonal
- 8 paint colours
- Three brush/stamp sizes that stay constant in screen-space as you zoom

### The kiln
- A cinematic ~4.5-second firing sequence — close, fire, cool, open
- Dark vignette + warm inner glow + camera lean + music duck + kiln crackle SFX
- The glaze visibly melts from raw matte to fired gloss inside the kiln view
- Reduced-motion honoured via `prefers-reduced-motion`

### Lids + matched sets
- "+ Lid" at the leather-hard stage seeds a fresh lid whose base radius matches your pot's rim exactly
- Three lid styles: **Flat**, **Domed**, **Tall** — each ends at a different height so they genuinely vary
- Style swap mid-shaping while wet
- Swap between pot and lid at any pre-fired stage
- Fired sets render in an assembled view — lid resting on pot — both pieces tween through the kiln together
- The set saves as a single shared composite thumbnail (no awkward stacked halves)

### Portfolio (gallery)
- Local-only — saves to IndexedDB on the device, never leaves
- Two views: **Shelf** (default — title + glaze + save date) and **Compact** (icon grid)
- Tap a title to rename a piece
- Tap any piece to load it back into the studio as a fired finish
- Sets appear as a single tile and reload as the assembled pair

### Photo export
- Three framing styles: **Studio shelf**, **Sunlit window**, **Museum plinth**
- Two aspect ratios: square (1:1) and portrait (9:16)
- 1024-wide PNG output, composited over the active backdrop
- Web Share (where supported) with anchor-download fallback

### Atmosphere
- 18 backdrops in six categories: **Studio**, **Art**, **Botanical**, **Digital**, **Paper**, **Motion**
- Studio (3 backdrops) is bundled at install in the Android app; the other five categories are opt-in download packs the player installs from the title-screen picker (v2.1) — Art / Botanical / Digital / Paper are ~1 MB each, Motion (3 looping videos) is ~23 MB
- Three motion (looping video) backdrops: Balloons, Birds, Hearts
- Pack files persist in the app's private Data dir via `@capacitor/filesystem`; tracked in `slip-packs-installed` (localStorage) and resolved at load time via `Capacitor.convertFileSrc`
- Bundle convention: only `assets/backgrounds/preload/` is copied into `slip-studio-app/www/`; the other folders are filtered out of the picker via `visibleBackgrounds()` in `main.js` and fetched on demand from `https://madderverse.org/slip-studio/assets/backgrounds/<folder>/`
- Multiple ambient music tracks, randomised per session
- Five sound effects, all subtle: wheel hum (volume tracks the spin), clay squelch (throttled), water drip on re-wet, glaze pour on selection, kiln crackle on fire
- Independent toggles for music and SFX

### Rendering
- Real 3D via Three.js (vendored — no CDN, no network calls)
- PBR clay with procedural image-based lighting, soft shadows, an editable bump layer for the clay grain + throwing lines
- Custom shader patch overlays the deco layer over the diffuse colour
- Analytic normals (derived from the profile slope) — no faceting, no lighting seam at the lathe wrap

### Privacy + offline
- No account, no sign-in, no online play
- No analytics, no third-party SDKs, no advertising IDs
- All work saves to local IndexedDB; preferences in localStorage
- Runs fully offline after first launch
- "Clear storage" in Android Settings wipes everything cleanly

### App shell (Android wrap)
- Capacitor wrap (`slip-studio-app/`)
- Immersive fullscreen: status bar + navigation bar hidden, swipe-to-reveal
- Vendored Three.js so the app works without an internet connection
- Built and signed with a local PKCS12 keystore (see CLAUDE.md → Slip Studio build recipe)
