# Slip Studio — the study shelf

Classic pot forms from real ceramic traditions, offered as things to *study* at
the wheel: a ghost silhouette to throw against, a live closeness readout that is
a mirror rather than a grade, and a shelf that records what you've studied.

Written against **web v242**. This is the de-fanged version of Let's Create!
Pottery's order system — the one mechanic the market leader has that Slip
lacked: a reason to make *this specific pot*, and a way to feel your control
of the clay improving.

---

## Why

Slip Studio's wheel is deep, but every session starts from "make anything,"
and the noticeboard's requests are deliberately loose prompts. What LCP proved
(60M downloads) is that a **pictured target with live feedback on how close you
are** converts "make a pot" into "make *this* pot well" — it's the skill loop,
and it's what players of the original praise most.

What we refuse from their version: the pass/fail bar (7 stars or the order
fails), the coin payout, and the shop trap (orders requiring brushes you
haven't bought). A grading system is exactly the thing that tells a child
their pot doesn't count. So:

## The design decision that makes this work

**The meter is information; nothing reads it.** The closeness number exists
only live at the wheel, as a tool while throwing — like a potter holding a
rib against the wall. It is never stored, never shown on the shelf, never
compared, and completion doesn't ask it. **Any pot begun as a study and saved
counts as having studied that form** — in the way an artist's "study after
Hokusai" is a study no matter how far it wandered. Wandering off the target
on purpose is a legitimate outcome; the ghost was still the reason the pot
exists.

## What the player does

1. Opens **The study shelf** (landing link, beside "The wall"): a shelf of
   ~10 classic forms — silhouette, name, where and when it's from, and two
   warm sentences about it.
2. Taps one → a fresh lump on the wheel, seeded as a plain cylinder, with the
   form's **ghost silhouette** standing translucent around it, and a small
   pill reading e.g. **"Moon jar · 42% close."**
3. Throws. The number follows the wall in real time. A **Ghost** toggle hides
   the overlay for players who'd rather glance at the shelf card and throw
   from memory.
4. Decorates and fires as normal — the ghost retires after the wet stage; the
   study was about the *form*.
5. Saves. The shelf now shows their pot's thumbnail beside the form, marked
   studied, and the gallery card gains a line: *"A study after the moon jar."*

## Non-goals — the rules that keep this benevolent

- **No stars, no pass/fail, no threshold.** Saving = studied. Always.
- **The number is never recorded.** Not on the shelf, not on the entry, not
  anywhere it could be compared between pots, sessions, or children.
- **No locked forms.** All ten visible and throwable from day one — abundance,
  not a ladder.
- **No rewards.** The studied mark and the pot are the outcome. Nothing else
  in the app checks the shelf.
- **No nagging.** No badge, no count of unstudied forms, no "3 to go."
- **Re-study freely** — throwing a form again is normal practice; the shelf
  keeps the first pot's thumbnail unless the player studies it again (latest
  replaces, nothing stacks or is lost from the gallery).

## The forms (launch set — blurbs are Claude drafts for Onion to rewrite)

Ten, chosen to be lathe-throwable, visually distinct, and from a wide map:
moon jar (Joseon Korea) · meiping plum vase (Song China) · ginger jar (Qing
China) · chawan tea bowl (Japan) · tokkuri sake bottle (Japan) · amphora
(ancient Greece — its two handles are yours to add at Decorate) · olla water
jar (San Ildefonso Pueblo, as made famous by Maria Martinez) · ukhamba beer
pot (Zulu, South Africa) · albarello pharmacy jar (Renaissance Italy) ·
kylix wine cup (ancient Greece). Blurbs never say "try to match it" — they
say what the pot was *for*, which is the same voice as the noticeboard.

## Data model

```js
// Curated, in main.js. Controls in the same [radius, y] profile space as
// SHAPES — one authoring format, and shapeIconSVG-style icons come free.
const STUDY_FORMS = {
  moonjar: { name: "Moon jar", origin: "Korea · Joseon dynasty",
             blurb: "…", controls: [[0,0], …] },
  …
};
const STUDIES_KEY = "slip-studies";   // { moonjar: { potId, at } }
```

`state.studyId` marks the live pot as a study (cleared on new pot, restored
by loadPot from the entry). The saved entry carries `studyId` like
`commissionId` does — where the pot *came from*, deliberately NOT in
`corePieceFields`, so kiln-load copies and partners don't silently claim it.
Dangling ids (form renamed later) degrade to no line, `loadCollections`-style.

## Mechanics

- **Ghost**: a `THREE.LatheGeometry` built from the form's resampled profile
  (share `applyControlsToProfile`'s spline via a pure helper), added beside
  `state.potGroup` at scale 1 — NOT inside it, so pulling the pot taller
  visibly diverges from the target instead of dragging the ghost along.
  Translucent unlit material, `depthWrite: false`. Removed at leather+.
- **Closeness** is *progress from the starting lump*, not distance on a fixed
  scale: `100 · (1 − meanAbs(profile − target) / baselineMad)`, where
  `baselineMad` is the seed cylinder's distance from this form — so every
  form starts at 0% and reads 100% at the form, and a wide bowl isn't
  punished for beginning farther from a cylinder than a jar does. Minus a
  small term for `|heightScale − 1|`. Computed in `tick()` while a study is
  live at wet; the DOM pill updates only when the rounded value changes.
- **Starting clay** is a plain cylinder (`STUDY_SEED` controls), not a starter
  shape — the throwing IS the study.
- The shelf modal follows the wall's pattern: `.gallery` overlay, focus trap,
  Escape, corruption-safe localStorage load.

## Build phases

**Phase 1 (this build):** the shelf, ten forms, ghost + meter + toggle,
studied marks with pot thumbnails, the gallery-card line, persistence.
**Phase 2:** Onion rewrites blurbs / adjusts target silhouettes to taste.
**Phase 3 (if it earns it):** more forms; possibly a noticeboard crossover —
a cast member who mentions a form from their part of the world.
