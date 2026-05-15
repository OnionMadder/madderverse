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

- **P2-6** Some tap targets are 40px tall on phones (header buttons) or
  smaller (`madder-home` 36×36, `eggCounter` 30 high). Material wants 48dp.
  Worth a polish pass but won't get rejected.
- **P2-7** A few labels are very small + alpha-blended (`.slot-label` is
  `rgba(45,212,191,0.32)` at 8px). Slot labels are arguably redundant once
  a Munki is on stage — the *color* is the name. Could drop them entirely.
- **P2-8** `<meta name="description">` still says "Sprunki-style music
  game" — could update to reflect the rainbow narrative for link previews.
- **P3-9 / P3-10 / P3-11 / P3-12 / P3-13** Various dead HTML
  (`.bank-switcher`, `#madballzBtn`, stale lore comment, stale `<meta>`
  title, footer "About" link). Not user-visible mid-play; cosmetic cleanup.

These can be picked up after the Play submission lands.
