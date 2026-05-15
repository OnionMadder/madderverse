# All Munkis — Google Play store listing (paste-ready)

> ## ⚙️ Decisions made for you — override if you disagree
>
> These were chosen as sensible defaults. Each is easy to change in
> Play Console; flagged here so nothing is a silent assumption.
>
> | Decision | Default chosen | Why / how to change |
> |---|---|---|
> | **Category** | Casual (game) | The play loop is a calm sandbox toy, not a puzzle with win states. "Educational" doesn't fit. Change in Play Console → Store settings → Category. |
> | **Tags** | Casual · Creative · Pretend play | Play picks 5 max from its fixed list; these match best. |
> | **Age / content rating** | Everyone (ESRB) / PEGI 3 | Horror mode is mild & cartoonish (a sad Munki creeps in, no gore, no jump-audio louder than the music). If the IARC questionnaire (answers in CHECKLIST §K) pushes it to "Everyone 10+", accept that — it doesn't hurt a kids' toy. |
> | **Designed for Families** | **Opt in** | No data collection, no ads, no IAP — it qualifies cleanly and the badge helps discovery. Opt in at Play Console → Policy → App content → Target audience (select age groups incl. "Ages 5 & under" / "Ages 6–8"). |
> | **Pricing** | Free, no IAP, no ads | Permanent. There is no monetization code in the app. |
> | **Countries** | All countries | No legal reason to geo-restrict. |
> | **Contact email** | support@madderverse.org | Must be a mailbox you can read — Google emails it during review. |
> | **Privacy policy URL** | https://madderverse.org/all-munkis/legal/privacy.html | Goes live when `all-munkis/legal/` is pushed to main (GitHub Pages). Verify it loads before submitting. |

---

## 1. App title (max 30 chars)

```
All Munkis
```
(10 chars — well under the limit.)

## 2. Short description (max 80 chars)

```
Make a rainbow with six happy Munkis. Two get left out — and they really notice.
```
(79 chars.)

## 3. Full description (max 4000 chars)

```
All Munkis is a cozy little toy for kids. No timer. No score to chase. No way to lose.

Six cheerful Munkis — Red, Orange, Yellow, Green, Blue, and Purple — are waiting in the bank. Drag them onto the stage one by one and watch a whole rainbow come together. They bounce. They make a warm little tune. It feels good.

But here's the thing the game never says out loud: there are only six slots, and the rainbow only needs six colors. So Ice Munki and Moon Munki always have to watch from the side. And they REALLY wish you'd pick them. Tap the one who's left out and you might hear what they're thinking. It's gentle, it's a little bit funny, and it's the whole heart of the game.

WHAT YOUR KID CAN DO
• Drag any Munki onto the stage — they bob along to a soft, generated tune
• Tap a Munki on stage to change its face
• Drag a Munki off to send it back
• Hit REMIX to shuffle the whole stage
• Find the two Munkis who got left out and see how they feel about it

A LITTLE BIT OF MYSTERY
There's a shy Munki hiding somewhere. Curious kids who tap around, try things, and explore the screen will start turning up hidden surprises — small discoveries that quietly add up. We won't spoil how. Finding things IS the game; the reward is just the cherry.

There are also hidden achievements for the kid who really plays with it — building patterns, filling the stage over and over, noticing the quiet details. They appear only once you've found them, so every one is a genuine little surprise.

MADE FOR PARENTS TO TRUST
• No ads. Ever.
• No in-app purchases. Nothing to buy, nothing to unlock with money.
• No accounts, no sign-in, no chat, no other people.
• No data collected. None. The app doesn't even connect to the internet — it works completely offline, on an airplane, anywhere.
• No third-party trackers or analytics SDKs.
• Everything your child does stays on your device and never leaves it.

All Munkis is made by an indie developer under Mad Sundar LLC, part of The Madderverse — a small collection of safe, ad-free, made-with-care games for kids. We make these because we have a kid too.

Works on phones and tablets. Quietly. Forever.
```
(≈1,950 chars — comfortably under 4000.)

## 4. ASO keywords (Play has no keyword field; these inform the
copy above and the tag picks)

```
rainbow, munki, monster, cute, kids, toddler, preschool, family,
no ads, offline, free, calm, sandbox, creative, pretend play,
music toy, sensory, ad-free, safe for kids
```

## 5. Category & tags (Play Console → Store presence → Store settings)

- **Application type:** Game
- **Category:** Casual
- **Tags (pick up to 5 from Play's fixed list):** Casual, Creativity,
  Pretend play, Music, Brain games

## 6. Contact details

- **Email:** support@madderverse.org
- **Website:** https://madderverse.org/all-munkis/
- **Phone:** (optional — leave blank unless you want it public)

## 7. Privacy policy URL

```
https://madderverse.org/all-munkis/legal/privacy.html
```
Terms (not required by Play but good to have, referenced from the
privacy page): https://madderverse.org/all-munkis/legal/terms.html

## 8. Copyright

```
© 2026 Mad Sundar LLC
```

## 9. Data safety form answers (Play Console → Policy → Data safety)

- **Does your app collect or share any required user data?** → **No**
- **Is all of the user data encrypted in transit?** → N/A (no data
  collected, no network)
- **Do you provide a way for users to request data deletion?** → N/A
  (no data collected; uninstalling clears on-device storage)
- Result you want the form to produce: **"No data collected. No data
  shared."**

## 10. Ads declaration

- **Does your app contain ads?** → **No**

## 11. Target audience & content (Play Console → Policy → App content
→ Target audience and content)

- **Target age groups:** select the youngest bands too — Ages 5 &
  under, Ages 6–8, Ages 9–12 (plus older is fine). This opts the app
  into the **Designed for Families** program.
- **Is the app designed for children?** → **Yes**
- **Do you want the app to be included in the Designed for Families
  program?** → **Yes**

## 12. Government / news / financial / health flags

All **No**. It's a kids' toy.

## 13. Screenshot slot map

`npm run screenshots` writes to
`store-assets/screenshots/<profile>/`. Upload mapping:

| Folder | Play Console slot |
|---|---|
| `android-phone` | Phone screenshots (required: 2–8) |
| `android-7in-tablet` | 7-inch tablet screenshots |
| `android-10in-tablet` | 10-inch tablet screenshots |

Each folder has 4 PNGs: `01-title`, `02-rainbow`, `03-drag`,
`04-achievements`. Recommended display order is exactly that.

## 14. Feature graphic

`store-assets/feature-graphic/feature-graphic.svg` → rasterize to
**1024×500 PNG** (see `store-assets/README.md`). Upload under Play
Console → Store presence → Main store listing → Graphics → Feature
graphic. **Required** before the listing can go live.

## 15. App icon

`icons/icon.svg` → rasterize to **512×512 PNG** (32-bit, < 1 MB).
Upload under Graphics → App icon. The launcher densities are
generated separately into the AAB by `npm run assets:generate`.

## 16. Release notes (first release — "What's new")

```
First release of All Munkis. Make a rainbow, meet the two Munkis who
always get left out, and find what's hiding. No ads, no purchases,
works offline. Made with care for small humans.
```
