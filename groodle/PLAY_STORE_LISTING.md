# Groodle — Google Play Store listing

Copy for the Play Console listing. Everything here is checked against the
shipped build; counts come from `game.js`, not from memory. If you change
the game's content, re-count before editing this file.

- **Package:** `org.madderverse.groodle`
- **Price:** **Free. No in-app purchases, no ads, no billing SDK at all** —
  same posture as All Munkis. (The old `PLAY_STORE_PLAN.md` proposed a
  $1.99 `studio_pack`; that was dropped, deliberately.)
- **Privacy policy URL:** `https://madderverse.org/groodle/privacy/`
- **Category:** Art & Design (alt: Casual)
- **Target audience:** Ages 5–8 primary, "Ages 5 and under" through
  "Ages 9–12" selectable — designed for the Families programme.

---

## App name  (max 30 chars)

```
Groodle: Draw & Dance
```
21 chars. "Groodle" alone is meaningless to someone browsing; the verbs are
what the store search has to match on.

---

## Short description  (max 80 chars)

```
Colour in a silly little guy, then hit DANCE and watch your doodle groove.
```
73 chars.

---

## Full description  (max 4000 chars)

```
Colour him in. Then make him dance.

Groodle is a drawing toy for kids. There's a funny little character waiting
on screen, and everything you scribble inside him becomes his outfit, his
face, his fur, his whatever. Then you press DANCE — and he gets up and
grooves to your drawing.

He's a paper doll, so his arms and legs are pinned at the joints and swing
on the beat. Whatever you coloured swings with them.

WHAT'S INSIDE

• Colour inside the lines, always. The brush simply doesn't paint outside
  his body, so there's no wrong move and nothing to tidy up afterwards.
• 8 poses — standing, cheering, waving, groovy and more.
• 8 backgrounds — a disco, the deep sea, a stadium, a candy world, night,
  sunset, outdoors, and a plain studio.
• Music that you build. 4 dance moves x 4 drum beats = 16 different
  grooves, and the whole soundtrack is generated as it plays.
• 8 characters to colour in — robot, princess, astronaut, pirate, clown,
  superhero, rockstar, disco king — each one a line drawing waiting for
  your colours.
• A hat shop. Earn Doodles by playing, then unlock 16 hats: a rocket ship,
  a haunted house, a bowl of candy, a gelatinous cube, and stranger things.
• 22 achievements to stumble into.
• A face-parts bank for when you don't feel like drawing a face.
• SURPRISE, which colours him in for you if you'd rather skip to the
  dancing.
• Your own gallery. Save the ones you like and come back to them.

THE PROMISE

No ads. Not one, not ever.
No in-app purchases. The whole app is free — there is nothing to buy.
No accounts, no sign-in, no email address.
No analytics, no tracking, no third-party SDKs.
Works completely offline — the app makes no network requests at all.

Drawings your child saves stay on the device. They are never uploaded and
we cannot see them. There is no shared gallery and no way to send a drawing
to anyone from inside the app.

Groodle is made by a parent of four, for the kind of app you can hand a kid
without reading the fine print first. Full privacy policy:
https://madderverse.org/groodle/privacy/

You can also play it free in any browser at madderverse.org/groodle/
```

Character count: ~1,760 of 4,000. Deliberately short of the cap — the
Slip Studio lesson was that a listing nobody finishes reading is worse than
a shorter one, but *under-filling* it (that listing ran ~470 chars) costs
you every keyword Play's search indexes. This aims between the two.

---

## What's new  (release notes — max 500 chars)

```
First release!

Colour in a funny little guy, then press DANCE and watch him groove to your
drawing. He's a paper doll, so his arms and legs swing on the beat — and
whatever you coloured swings with them.

8 poses, 8 backgrounds, 8 characters to colour, 16 hats to unlock, and 16
different grooves to build from the moves and beats.

Free, no ads, no purchases, works offline.
```
~390 chars.

---

## Store settings checklist  (Play Console — user does these)

- [ ] Create the app: **Groodle**, free, Art & Design
- [ ] Upload `Desktop/groodle-v1.0.0-vc1.aab` (versionCode 1, 1.0.0)
- [ ] **Enrol in Play App Signing on first upload; save the returned upload
      certificate PEM somewhere safe**
- [ ] Privacy policy URL → `https://madderverse.org/groodle/privacy/`
- [ ] **Data safety form → "No data collected", "No data shared".** This is
      literally true: the bundle makes no network request. Answer "No" to
      every collection question.
- [ ] Content rating questionnaire → expect **Everyone / PEGI 3**
- [ ] Target audience → include children's age bands; the app then needs
      the Families policy answers, all of which are "no" (no ads, no IAP,
      no data collection, no external links)
- [ ] Ads declaration → **contains no ads**
- [ ] Set countries / regions
- [ ] Review the pre-launch report before rolling out

## Graphic assets needed  (to be produced)

- [ ] **App icon, 512×512 PNG** — downscale `groodle-app/assets/icon.png`
      (it's 1024², generated by `groodle-app/scripts/make-icon.py`)
- [ ] **Feature graphic, 1024×500 PNG** — required. Suggestion: the doll
      mid-dance on the disco background, logo to one side.
- [ ] **Phone screenshots, minimum 2 (up to 8)** — suggested shots:
      1. A finished, colourful Groodle standing on the disco background
      2. Mid-dance, limbs swung out
      3. The colour palette + brush sizes in use, part-way through
      4. The character picker (robot / astronaut / pirate)
      5. The hat shop
      6. The gallery with several saved Groodles
- [ ] Optional but recommended: 7" and 10" tablet screenshots
- [ ] Optional: a short promo video

## ASO notes

- The name carries "Draw" and "Dance" because "Groodle" is an invented word
  with no search volume of its own.
- Terms worth having somewhere in the description, all of which are true:
  *drawing, colour/color, doodle, dance, music, kids, offline, no ads,
  free, hats, paper doll*.
- The strongest differentiator is **"the thing you drew comes alive and
  dances"** — no other kids' colouring app on Play does that. Lead the
  screenshots with it rather than with the palette.
- Second differentiator is the promise block. Parents searching "kids app
  no ads" are a real segment, and this app can make the claim without any
  asterisk.
