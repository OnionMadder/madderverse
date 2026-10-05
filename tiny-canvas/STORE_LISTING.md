# Tiny Canvas — Store Listing Reference

**Status:** v1.0 ship-ready. All strings below are paste-ready for the
App Store Connect and Google Play Console listing fields. Where the
consoles' character limits differ, both versions are provided.

**Bundle ID / Application ID:** `org.madderverse.tinycanvas`
**Studio name:** Mad Sundar LLC
**Trade name (display in stores):** Onion Madder
**Privacy policy URL:** `https://madderverse.org/tiny-canvas/privacy/`
**Terms URL:** `https://madderverse.org/tiny-canvas/legal/terms.html`
**Support email:** `support@madderverse.org`
**Marketing URL (optional):** `https://madderverse.org/tiny-canvas/`

---

## 1. App name (both stores, max 30 chars)

```
Tiny Canvas
```

(11 chars — well under both store limits.)

---

## 2. App Store Connect — Subtitle (max 30 chars)

```
Color, no ads, no fuss.
```

(23 chars.)

---

## 3. Google Play — Short description (max 80 chars)

```
A calm coloring book for kids: color by number, glitter, stickers. No ads.
```

(74 chars. 2026-10-05: "Ad-free" was flagged by Play Console — "may not be promoted… should not use keywords that indicate price or promotion"; the word "free" trips it. Keep "free" OUT of the short description; "No ads" says the same thing.)

---

## 4. Promotional text (App Store Connect, max 170 chars — can change post-submission without re-review)

```
14 richly detailed coloring scenes, 6 brushes, tap-to-fill, 42 colors, a sparkly gallery — all offline. No ads, no accounts. Your child's drawings stay on the device.
```

(166 chars.)

---

## 5. Full description — Google Play (4000 char limit; this is 2639, 2680 with CRLF)

Rewritten 2026-09-25 against the code (every count verified from templates.js / game.js). The LIVE listing until then still said "No in-app purchases" — false since Pro shipped, and Play shows an IAP badge on the same page — plus "20 hand-drawn pages" and four retired brushes. Apple lines dropped: there is no App Store build.

```
Tiny Canvas is a calm, ad-free coloring book for kids. Pick a page, grab a crayon, tap to fill, save it to the gallery. No ads, no accounts, no pop-ups asking your child to buy anything. It just lets them color.

✦ WHAT'S INSIDE (FREE)
• 49 coloring pages plus a blank page for free drawing: a kitchen cat, a puppy, a unicorn, dinosaurs, rockets, sea creatures, bugs, snowflakes, trucks, food, music, cozy rooms and more.
• 8 color-by-number pages, ordered from easy to tricky. Numbers size themselves to fit, and zoom in close for the little spaces.
• Tap-to-fill paint bucket that stays inside the lines, with 8 fill patterns: dots, stripes, checks, stars, hearts, scales, zigzags and grids.
• Crayon, glitter and rainbow brushes, plus an eraser that gently uncovers what was underneath.
• 42 colors in 5 groups (brights, pastels, neons, earth and metallic) and a custom color picker.
• Stickers: tap to place, then drag them anywhere on the picture.
• Mirror mode: draw on one side and it paints the other. Left-right, up-down or four ways, great for butterflies and snowflakes.
• Pinch to zoom for the tiny details.
• A gallery where every saved picture lives, with a little "comes to life" moment when you save.
• Profiles for up to 5 kids on one tablet, so everyone keeps their own gallery.
• Auto-save, so nothing gets lost if the tablet goes to sleep.
• Undo, gentle sounds, and optional calm background music.
• Works completely offline.

✦ TINY CANVAS PRO (optional, one-time $0.99)
A single purchase for grown-ups, behind a parent gate in Settings. It adds:
• 43 more coloring pages (92 in all)
• Spray, glow and smudge brushes
• 50 more stickers (60 in all)
• 7 more paper styles, including a glowing NEON dark paper
• 10 more picture frames for saved drawings

Everything in the free app stays free forever. There are no locked pages or padlocks in your child's view, no subscriptions, and no coins. Kids never see a sales pitch.

✦ WHAT'S NOT INSIDE
• No ads. Ever.
• No accounts, no sign-in, no chat, no social features.
• No data collection, no analytics, no advertising IDs.
• No links out of the app without a parent gate.
• No streaks, daily quotas or "come back tomorrow!" nagging.

✦ MADE FOR KIDS
Tiny Canvas is built around one idea: a kid's gallery is theirs. Drawings stay on the device, and we never see them. Designed to follow Google Play's Families Policy.

✦ FROM THE MADDERVERSE
Tiny Canvas is part of The Madderverse, a small collection of ad-free games and apps for kids from Mad Sundar LLC. More at madderverse.org.

Privacy: https://madderverse.org/tiny-canvas/privacy/
Questions? support@madderverse.org
```

---

## 5b. Google Play — What's new (vc8 / 1.3.1, max 500)

```
Behind-the-scenes update so the optional Pro unlock keeps working with the latest Google Play billing. Your child's drawings and galleries carry over untouched. Tiny Canvas now needs Android 7.0 or newer.
```

(204 chars.)

---

## 6. Keywords (App Store Connect, max 100 chars, comma-separated, no spaces around commas)

```
coloring,kids,color,art,draw,doodle,paint,crayon,unicorn,dinosaur,ad-free,offline,sticker,gallery
```

(99 chars.)

---

## 7. Google Play — Tags (choose up to 5 from Google's predefined list)

When prompted in the Play Console, select these tags:

- **Education** — Creative Tools
- **Art & Design**
- **Kids & Family**
- **Family** — Ages 5 & Under

(These are dropdowns; the strings above are what Google's UI shows. Don't paste them as freeform text.)

---

## 8. Category

| Store | Primary | Secondary |
|---|---|---|
| App Store Connect | **Kids** (subcategory: 5 & Under) | Education |
| Google Play | **Art & Design** | Designed for Families enrolled, age band 5 & Under |

---

## 9. Age rating

### App Store Connect questionnaire answers

| Question | Answer |
|---|---|
| Does your app contain unrestricted web access? | **No** |
| Does your app contain gambling, contests, or sweepstakes? | **No** |
| Cartoon or fantasy violence | **None** |
| Realistic violence | **None** |
| Sexual content or nudity | **None** |
| Profanity or crude humor | **None** |
| Alcohol, tobacco, drug use, or references | **None** |
| Mature/suggestive themes | **None** |
| Horror/fear themes | **None** |
| Prolonged graphic or sadistic realistic violence | **None** |
| Graphic sexual content and nudity | **None** |
| Made for Kids (Apple's Kids category enrollment) | **Yes — Ages 5 and Under** |
| Contains ads | **No** |
| Apple-approved-only links (parent-gated) | **Yes** |

Expected result: **4+** (Apple's lowest age rating).

### Google Play content rating questionnaire (IARC)

Most questions answered the same way as Apple. Expected result:
**Everyone** (PEGI 3 / ESRB Everyone).

| Question | Answer |
|---|---|
| Violence, cartoon | **No** |
| Sexuality | **No** |
| Language | **No** |
| Controlled substances | **No** |
| Gambling | **No** |
| User-generated content shared online | **No** |
| Personally identifying information shared | **No** |
| Location shared | **No** |
| Digital purchases | **Yes** — one optional one-time IAP (Tiny Canvas Pro, $0.99), behind a parent gate |
| Unrestricted internet access from the app | **No** |
| Designed for Families | **Yes** |
| Target age | **Ages 5 & Under** |

---

## 10. Copyright (App Store Connect)

```
© 2026 Mad Sundar LLC
```

---

## 11. Apple — App privacy "Data Types" answers

App Store Connect now asks you to declare every data type collected.
**For Tiny Canvas every checkbox should be UNCHECKED.** When the Apple
Connect UI asks "Do you or your third-party partners collect data from
this app?" the answer is **No**.

If the wizard pushes you down a path: declare *no data collection, no
data linked to user, no tracking*. The result should display as
**"Data Not Collected"** on the App Store privacy nutrition label.

---

## 12. Apple — App Review notes / demo account

Paste this into the "App Review Information → Notes" field when
submitting:

```
Tiny Canvas is a fully offline coloring app for children. There is no
sign-in, account, or backend service to test.

Highlights for review:
- All drawings stored locally; no network calls except Google Fonts CDN
  (Bungee, VT323, Press Start 2P) and a static privacy/terms page.
- No third-party analytics SDK, no advertising SDK.
- Parental gate: tap the small home glyph in the top-left corner of any
  screen. A two-digit addition problem appears. Answer correctly to
  exit the app to the Madderverse hub. Same gate guards Delete and
  Export from the Gallery.
- Apple Kids category target: Ages 5 and Under.

No demo account needed.
```

---

## 13. Google Play — Data safety form answers

In the Play Console "Data safety" section:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | (N/A — no data collected) |
| Do you provide a way for users to request that their data is deleted? | (N/A — nothing to delete on our side) |
| Designed for Families program enrollment | **Yes** |
| Target audience age groups | **Ages 5 & Under** |

The resulting Data safety label should show **"No data collected, no
data shared"**.

---

## 14. App icon spec (for the user — Chunk 7 produces the SVG source)

| Use | Size | Format | Notes |
|---|---|---|---|
| App Store Marketing | 1024×1024 | PNG, no alpha, no rounded corners | Apple rounds the corners themselves |
| iOS app icon set | 20, 29, 40, 60, 76, 83.5 pt @ 1x/2x/3x | PNG | Xcode Asset Catalog handles the matrix |
| Google Play feature graphic | 1024×500 | PNG/JPG | Wide banner — should re-use the splash art crop |
| Google Play Store listing icon | 512×512 | PNG, alpha allowed | |
| Android adaptive icon foreground | 432×432 | PNG with alpha | The icon art, no background |
| Android adaptive icon background | 432×432 | PNG (or color) | Solid `#06141a` is fine |

These are produced from the master SVG at `icons/icon.svg` (Chunk 7
delivers the real art). Generation tooling: any of —

- https://www.appicon.co/ (web)
- `npx capacitor-assets generate` (CLI, after `npm i -D @capacitor/assets`)
- `pwa-asset-generator` (CLI)

---

## 15. Screenshots (Chunk 8 delivers the capture script)

### App Store Connect — required sizes

| Device class | Pixels | Required? |
|---|---|---|
| 6.9-inch iPhone (iPhone 16 Pro Max, etc.) | 1290×2796 portrait | **Required** as of June 2024 |
| 6.5-inch iPhone (legacy, optional in 2026) | 1242×2688 | Optional |
| 6.1-inch iPhone | 1170×2532 | Optional but recommended |
| 13-inch iPad Pro | 2064×2752 portrait | **Required** if you ship iPad support |

Apple lets you upload 3-10 screenshots per device class. Recommended:
**7** — Title, Picker, Mid-drawing, Fill+pattern, Stamps, Gallery,
Settings. `scripts/capture-screenshots.js` produces exactly this set
per device profile, numbered `01-title.png` … `07-settings.png`, in
the order they read as a marketing walkthrough.

### Google Play — screenshot sizes

| Device class | Pixels | Required? |
|---|---|---|
| Phone | min 1080×1920 portrait | **Required**, at least 2, max 8 |
| 7-inch tablet | 1024×600 (or larger) | Required for Designed for Families |
| 10-inch tablet | 1080×1920 | Required for Designed for Families |
| Feature graphic | 1024×500 | **Required** |

---

## 16. Pricing & availability

- **Price:** Free
- **In-app purchases:** One — `tiny_canvas_pro`, **$0.99 one-time**
  ("Tiny Canvas Pro": all 8 coloring-page packs — BASIC, ANIMALS,
  HOME, FOOD, GO GO GO, OCEAN, DINOSAURS, PLACES — 48 scenes vs. the
  free tier's 12, +4 brushes, 60-shape stamp tool, 8 papers, 12
  export frames). No subscriptions. Both consoles must list the IAP;
  RevenueCat is the validation layer (see game.js "PRO BILLING" for
  the full activation checklist — RC project, `pro` entitlement,
  current Offering, then paste the goog_ key into RC_PUBLIC_API_KEY).
- **Availability:** All countries (no regional restrictions)
- **App Store Family Sharing:** Eligible (free app)
- **Google Play countries:** All available

---

## 17. Things the consoles need from YOU (not paste-able)

These require your personal/business credentials and can't be
paste-prepped:

- [ ] **Apple Developer Program** annual membership ($99/yr)
- [ ] **D-U-N-S number** for Mad Sundar LLC (required for organization
      account; free from Dun & Bradstreet, takes 1-3 business days)
- [ ] **Apple Developer Team ID** (auto-issued after enrollment)
- [ ] **Google Play Developer account** ($25 one-time)
- [ ] **Bank info + tax forms** in both consoles (even for free apps,
      they want this on file)
- [ ] **App Store Connect "App Information"** form: territories,
      pricing tier (Free), etc.
- [ ] **TestFlight build** uploaded via Xcode for internal testing
      before public submission
- [ ] **App signing keys**: Apple manages iOS automatically once you
      upload via Xcode; for Android, generate a release keystore
      (`keytool -genkey -v -keystore tiny-canvas-release.jks ...`),
      **back up to two physically separate locations** — if you lose
      this keystore, you can never publish updates as the same app on
      Play
- [ ] **Privacy policy + terms** must be live at the URLs above
      before submission (push this commit to main; GitHub Pages
      serves them automatically)

---

## 18. Pre-submission checklist (per chunk 8 / CLAUDE.md)

See [tiny-canvas/CLAUDE.md](CLAUDE.md) for the full shipping checklist
once Chunk 8 lands.
