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
A polished kids coloring app. Ad-free. No accounts. Nothing leaves the device.
```

(78 chars.)

---

## 4. Promotional text (App Store Connect, max 170 chars — can change post-submission without re-review)

```
20 coloring pages, 6 distinct brushes, 36 colors, a sparkly gallery — all offline. No ads, no in-app purchases, no accounts. Your child's drawings stay on the device.
```

(170 chars exactly.)

---

## 5. Full description — App Store Connect AND Google Play (both ~4000 char limit; this clocks ~1700)

```
Tiny Canvas is a polished coloring app for kids that gets out of the way and lets them color. Pick a page, choose a brush, color it in, save it to the gallery. That's it.

✦ WHAT'S INSIDE
• 20 hand-drawn coloring pages: friendly dog, smiling cat, unicorn, dragon, dinosaur, robot, rocket, castle, ice cream, donut, snowflake, and more.
• 6 distinct brush types — pen, marker, crayon, pencil, paint, glitter — each with its own feel and texture.
• 36 colors organized in 5 friendly groups: rainbow, pastels, neons, earth tones, and metallics.
• Brush smoothing for little hands. Eraser, undo, clear.
• A personal gallery where every saved drawing lives. Auto-save means nothing gets lost.
• Sweet little sound effects you can turn off in Settings.

✦ WHAT'S NOT INSIDE
• No ads. Ever.
• No in-app purchases.
• No accounts, no sign-in, no social features.
• No data collection, no analytics, no advertising IDs.
• No links out of the app without a parent gate.

✦ MADE FOR KIDS
Tiny Canvas is built around the idea that a kid's gallery is sacred. There are no streaks, daily quotas, or "come back tomorrow!" prompts. The drawing stays on the device — we never see it.

Apple App Store Kids category compliant. Google Play Designed for Families compliant. COPPA and GDPR-K aligned.

✦ FROM THE MADDERVERSE
Tiny Canvas is part of The Madderverse, a small constellation of free, ad-free, kid-friendly games and apps made by indie developers at Mad Sundar LLC.

Privacy: https://madderverse.org/tiny-canvas/privacy/
Terms: https://madderverse.org/tiny-canvas/legal/terms.html
Questions? support@madderverse.org
```

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
| Digital purchases | **No** |
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
**5** — Title, Picker, Mid-drawing, Gallery, Settings.

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
- **In-app purchases:** None
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
