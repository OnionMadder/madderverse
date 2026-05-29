# Pootery — Google Play Store listing

Copy-paste source for the Play Console **Main store listing**. Voice = playful
but parent-legible (keeps the wink; stays clear and reviewer-safe). Audience = **13+**
(matches `privacy.html` — the app has an optional public gallery + online battles).

> **Distancing note:** the brand is **Pootery**, not "Let's CRAYte! Pootery." The
> listing title drops the old "Let's CRAYte!" prefix so it no longer reads as a play on
> the existing app "Let's Create Pottery." The full canonical name is **Pootery: Throw, Glaze, Fire**;
> the under-the-icon / casual name is just **Pootery**. The folder/URL was renamed to `/pootery/`
> (2026-05-29), with redirect stubs left at the old `/lets-crayte-pootery/` path so existing share
> links + the published app's baked URLs keep resolving. Keep the `crayte-*` storage keys as-is —
> those are invisible plumbing, and renaming them would wipe saved pots + paid packs. The distancing
> (and the rename) happen in the *visible* name + URL, never the internal storage keys.

---

## App title  (max 30 chars)

```
Pootery: Throw, Glaze, Fire
```
(27 chars)

## Short description  (max 80 chars)

```
Throw, glaze & fire your own pots. A playful pottery studio — no ads, ever.
```
(~75 chars)

## Full description  (max 4000 chars)

```
Throw clay. Glaze it in cursed colors. Fire it in the kiln and pray it doesn't explode. Pootery is a playful pottery studio where every pot is gloriously yours — and there are no ads, ever.

Spin up a lump of clay on the wheel, pull it into a shape, then decorate it with brushes, sprays, splatters, stamps, and a stash of glazes. Fire it in the KILN-9000. Most pots come out beautiful. A few come out as... a learning experience. Both go in your gallery.

WHAT YOU DO
• Shape clay on a spinning wheel — pinch it skinny, push it thicc
• Decorate with brushes, sprays, splatters, and stamps
• Glaze it in colors that range from "lovely" to "what is that"
• Fire it in the kiln (small chance of a dramatic kaboom — still saved!)
• Fill a gallery with everything you make
• Share pots to the EVERYONE gallery and remix other potters' shapes
• Enter weekly pot battles and win trophies

NO NONSENSE
• No ads. None. Not even the "rewarded" kind.
• No third-party trackers, no data selling, no advertising profiles.
• Plays 100% offline — no account needed to shape, decorate, fire, or save.
• An optional account only adds the social bits (sharing, battles, profiles) and syncs your pots across devices.

PACKS
Extra glaze + stamp packs are one-time purchases — no subscriptions, ever. The free packs are always included, and you can earn more just by playing.

MADE BY THE MADDERVERSE
Pootery is part of The Madderverse, a small collection of ad-free games built by a parent who got tired of kids' apps stuffed with ads and dark patterns. We don't do engagement traps. We do pots.

Intended for ages 13 and up (it includes an optional public gallery and online battles). Questions or data requests: pootery@madderverse.org
```

## What's new  (release notes — starter)

```
Fresh clay, same Pootery. Polished the studio and squashed some bugs. Now go make a pot.
```

---

## App display name  (the under-the-icon name + Console "App name")

Set everywhere to exactly:

```
Pootery
```

Where to change it (these live in `pootery-app/`, **outside this worktree** — apply in the main checkout):
- `pootery-app/capacitor.config.*` → `"appName": "Pootery"`
- `pootery-app/android/app/src/main/res/values/strings.xml` → `<string name="app_name">Pootery</string>`
- Play Console → **App name** field → `Pootery`

(CLAUDE.md records the display name as **Pootery** and the canonical full name as **Pootery: Throw, Glaze, Fire**.)

After editing, re-run the build recipe (JDK 21 + `npx cap copy android`, bump `versionCode`) and rebuild the AAB.

---

## Categorization & rating

- **Application type:** Game
- **Category:** Casual  (alt: Simulation)
- **Tags:** pottery, creative, art, casual
- **Content rating:** complete Google's IARC questionnaire honestly. Expect **Teen** — the app has *user-generated content* (public gallery, remixes) and *online interactivity* (battles), which raise the rating regardless of the gentle subject matter. This is consistent with the 13+ audience.
- **Target audience:** 13+. **Do NOT** enrol in "Designed for Families" / the kids program — the open social features don't fit that program's requirements, and 13+ keeps you out of it.

## Store settings / contact

- **Developer / publisher:** Mad Sundar LLC
- **Package name:** `org.madderverse.pootery`
- **Email:** pootery@madderverse.org
- **Privacy policy URL:** https://madderverse.org/pootery/privacy.html
- **Account deletion URL (Data safety form):** https://madderverse.org/pootery/delete-my-account/

---

## Graphics deliverables  (PLACEHOLDER — finalize your own art at launch)

Play Console requires these. The in-app `icons/` set is a placeholder; produce final art before publishing.

| Asset | Spec | Status |
|-------|------|--------|
| App icon | 512×512 PNG, 32-bit, ≤1 MB | placeholder exists (`icons/icon-512.png`) — replace with final |
| Feature graphic | 1024×500 PNG/JPG (no alpha) | **needed** |
| Phone screenshots | 2–8 images, 16:9 or 9:16, min 320 px side | **needed** (capture title, wheel, decorate, kiln, gallery, battles) |
| 7" tablet screenshots | optional, up to 8 | optional |
| 10" tablet screenshots | optional, up to 8 | optional |
| Promo video (YouTube URL) | optional | optional |

Keep all graphics consistent with the onioncore palette (dark `#06141a`, teal `#00ffcc`, pink `#ff2e88`) and the "extra Os" wink.

---

## ASO / keyword notes

- Play has **no separate keywords field** — discovery comes from the title + descriptions. The copy above naturally seeds: pottery, clay, ceramics, kiln, glaze, pottery game, creative, ad-free.
- **Do not** use "Let's Create Pottery" (or close variants) as a keyword or in copy. It's a competitor's app name; leaning on it invites both brand confusion and a takedown risk. The whole point of the rebrand is to stand on "Pootery."
- Lead with the ad-free / no-tracker angle in the short description — it's the strongest differentiator for the parent making the install decision.
