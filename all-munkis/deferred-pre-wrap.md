# Pre-wrap audit — deferred items

Findings from the Phase 1 audit that were **intentionally deferred** to keep the
web site stable while All Munkis gets Capacitor-wrapped for Google Play.

## Fixed in this commit

- **P1-1** Tray overlapped the stage at 360-wide phones because the 7-chip
  4+3 wrap pushed `.tray-wrap` to 371px tall, while `--tray-h` was stuck at
  the 273px single-row initial value. Two changes:
  1. Smaller chips on `≤720px` (`64×84` from `76×100`) and `≤420px`
     (`58×78` from `70×92`) so the tray comes down to ~230px on phones.
  2. `watchTrayHeight()` now schedules its measurement on a double-RAF so
     it reads the *post-layout* height (not the mid-resize transient). Also
     re-measures after `document.fonts.ready` for the late-arriving font.

- **P1-2** Audio scheduler kept running while the page was hidden. New
  `watchVisibility()` handler suspends the audio context + clears the
  scheduler on `visibilitychange → hidden`, resumes on `→ visible`. Stops
  the queued-step catchup-blast when a user comes back from a locked
  screen, and stops draining battery in the background.

## Deferred to `all-munkis-app/` (Phase 2 will handle in the app copy only)

- **P1-3** GoatCounter analytics (`//gc.zgo.at/count.js`) — strip from the
  app copy so Play's Data Safety form can be "no data collected." Web copy
  keeps analytics.
- **P1-4** Absolute `https://madderverse.org/...` URLs for favicons +
  webmanifest in `<head>` — fail offline in the WebView. Bundle locally
  in the app copy.
- **P1-5** `.madder-home` button (`href="../"`) and the slim footer's
  cross-game links — broken inside a standalone app. Hide them in the
  app copy.

## Deferred polish (not blocking ship)

- **P2-6 ✅ DONE (2026-07-30)** — `.icon-btn` + `.btn` mobile min-heights
  bumped to 44px; `.madder-home` bumped site-wide (40→44 desktop, 36→40
  small); `#eggCounter` padding grown to hit 44px min. Shared file
  `assets/css/site-footer.css` was edited (ripples to every game).
- **P2-7 ✅ DONE (2026-07-30)** — `.slot-label` now only renders for
  Madballz (`sheet === 'mb'`). Rainbow crew + Ice/Moon: color IS the
  name, no label. Empty slot: the `+` placeholder is enough, "EMPTY"
  text removed. `renderSlot` in `game.js` gates on `ch.sheet === 'mb'`.
- **P2-8 ✅ DONE (2026-07-30)** — meta description + og:description +
  twitter:description rewritten to the rainbow narrative. `<meta
  name="title">` + og:title + twitter:title simplified to
  "All Munkis — Madderverse". Keywords intentionally kept (sprunki
  is still a real search term).
- **P3-9 / P3-10 — NOT DEAD.** The deferred audit was wrong. Both are
  actively wired: `.bank-switcher` is toggled by
  `updateBankSwitcherVisibility` (hidden until a second bank unlocks
  via the seventh-wheel swap); `#madballzBtn` is the "MEET THE
  MADBALLZ" button revealed by `revealMadballzButton()` and wired to
  `enterMadballzMode`. Do not delete.
- **P3-11 ✅ DONE (2026-07-30)** — Stale lore comment in `index.html`
  rewritten. Old comment claimed 7 crew colors + BLACK Watchers + 4
  WHITE evils (Ice/Moon/Void/Static/Madballz); the real lore is 6
  rainbow crew + 2 evils (Ice + Moon) + the cursed Flying Creeps.
- **P3-12 ✅ DONE (2026-07-30)** — covered by P2-8 (meta title
  updated in the same pass).
- **P3-13 — NOT DEAD.** `about.html` exists at repo root and every
  game's footer links to it. The link works.
