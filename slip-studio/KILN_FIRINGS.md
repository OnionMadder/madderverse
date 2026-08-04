# Slip Studio — firing types and the kiln load

A spec for making the kiln a source of genuine, honest surprise: choosing *how*
a piece is fired, and eventually firing several pieces together where placement
in the kiln changes what comes out.

Written against **web v224**. Nothing here is built yet.

---

## Why

The kiln is currently deterministic. You glaze a pot, you fire it, and you get
exactly the colours you picked. The sequence is beautiful — chamber closes, glow
rises, raw chalk melts to gloss — but it is a *reveal of something already
decided*. Once a player has seen it three times, there is no reason to be curious
about the fourth.

Real firing isn't like that, and the difference is the whole appeal of ceramics.
Ash lands where flame touches. A pot facing the firebox flashes orange down one
side. Glaze runs further at the bottom of the kiln than the top. Two potters can
put identical pots in the same load and take out different objects.

**That is replayability of the most honest kind.** You aren't chasing a rare drop
on a random table — you're watching a physical process you partly control and
partly don't. The same pot fired twice is genuinely two pots, and you want to see
what happens. No currency, no gacha, no engagement mechanic required: the appeal
is the appeal of the real craft.

It also gives every piece already in the gallery a reason to exist again.

---

## What the player does

Before tapping Fire, they choose a firing:

| Firing | What it does | Character |
|--------|--------------|-----------|
| **Electric** | Exactly what you glazed. The current behaviour. | The safe one. Always the default. |
| **Wood** | Ash settles on upward-facing surfaces and the side that faced the flame; long flame-marks streak down the exposed side; glaze runs a little further. | Warm, earthy, asymmetric. |
| **Soda** | Vapour glaze — a faint orange-peel texture and soft blushing where the vapour struck, thinning to bare clay where it didn't reach. | Subtle, atmospheric. |
| **Raku** | Pulled from the kiln hot and smoked: crackle through the glaze, bare clay smoked to matte black, metallic flashes where copper is present. | Dramatic. The showpiece. |

Then the kiln sequence plays as it does now, and the piece comes out changed in a
way they didn't fully specify.

### The rules that keep this kind

- **Electric is always there and always the default.** Chance is something a
  player opts into deliberately, never something that happens to them.
- **A firing can never make a piece worse.** Every result must read as
  *different and interesting*, never as damage. This is the single most important
  constraint in this document. A player who feels the kiln ruined an hour of work
  will not shrug — they will refund.
- **Nothing is ever lost.** A saved pot can always be loaded and re-fired, and a
  re-firing saves as a *new* gallery entry rather than overwriting the old one.
  There is no irreversible outcome anywhere in this feature.
- **No rarity, no grading, no "perfect firing."** The app never tells the player
  a result was lucky or unlucky. It's just what came out.

---

## The technical shape

The good news: **this needs no new texture, no new uniform, and no shader cache
key bump.**

The dip layer is already a canvas painted in unwrapped UV space, uploaded as
`uDipMap` and mixed over the diffuse by its alpha. `renderDips()` rebuilds it
deterministically by replaying an ordered list (`state.dips`), and
`applyFrozenDip` already demonstrates the pattern of compositing an extra pass
into that same canvas afterward.

So kiln effects become **one more replayed layer in the same canvas**:

```js
renderDips():
    paintDipList(ctx, dips)          // existing
    applyFrozenDip(...)              // existing — the wax seal
    paintKilnEffects(ctx, state.kiln) // NEW — ash, flashing, smoke
```

Because they're painted with their own alpha, effects land correctly over bare
clay as well as over glaze. And because they're derived from a serialisable
description rather than a bitmap, they cost almost nothing to store, replay
identically on reload, and sync to the partner (lid) mesh through the path that
already exists for dips.

### Determinism

Randomness must be **seeded and stored**, not rolled at render time — otherwise a
reload changes the pot, which would be the worst possible bug in a feature about
keeping what you make.

```js
// On the saved entry, alongside dips/glaze/finish:
kiln: { type: "wood", seed: 1837465, slot: 2 }   // slot = shelf position, phase 2
```

`paintKilnEffects` derives every mark from `(seed, type, slot)` through a small
seeded PRNG — the same discipline `makeDrips` already follows, where all the
variation is baked in at generation time so `renderDips` replays it identically.

### What each firing paints

- **Wood** — a directional ash gradient concentrated on one side (angle derived
  from the seed), heavier toward the top and on the shoulder; a few long vertical
  flame-marks with soft edges; a slight downward extension of existing dip edges
  to suggest running.
- **Soda** — a low-amplitude noise texture at high frequency (orange peel) plus a
  broad soft blush on one side, and a subtle thinning elsewhere.
- **Raku** — a crackle line network over the glazed area (the Stoneware pack
  already has crackle art to borrow from), smoked near-black on unglazed clay,
  and an iridescence bump on the fired look for copper-family glazes. `lustre`
  already establishes that `MeshPhysicalMaterial.iridescence` works here — note
  the existing gotcha that the material must be *created* with a nonzero base
  iridescence for the shader to compile that path.

### The sequence

Reuse the existing firing moment, with the type modulating it: wood burns longer
and warmer, raku ends with an abrupt cut to the smoke. Keep every change inside
`FIRING_DURATION` / `REDUCED_FIRING_DURATION` and honour `reduceMotion` — the
v192 lesson applies (a CSS-only reduced-motion pass isn't enough when `tick()`
writes inline styles).

---

## Phase 2 — the kiln load

The bigger version, and the reason to hold `slot` in the data model from day one.

Load several pieces from the gallery onto a kiln shelf, arrange them (front/back,
high/low), and fire them together. Position drives the effects: pieces at the
front of a wood kiln catch more ash and flame, pieces low down run more, pieces
sheltered behind another get less of everything.

This is genuinely novel — I'm not aware of another pottery game that models it —
and it gives sessions a natural shape ("I'll make three for this load") without a
single timer or quota.

**It is also substantially more work than phase 1.** The app is currently built
around one active piece plus an optional partner; rendering N pots in a shelf
view means a real multi-mesh scene, per-piece materials, and a placement UI. The
partner-mesh code (`syncPartnerMesh`, `tickPartnerMaterial`, `lookForPiece`) is
the closest existing analogue and shows roughly what each additional piece costs.

Phase 1 delivers most of the replay value at a small fraction of this. Do it
first, ship it, and only build the shelf if the firing types prove they get used.

---

## Integration points

| What | Where | Change |
|------|-------|--------|
| `renderDips` | ~ dip section | Add the `paintKilnEffects` pass after `applyFrozenDip`. |
| `paintDipList` / `paintDrips` / `makeDrips` | dip section | The model to copy for seeded, replayable, baked-in variation. |
| `state.dips`, `state.dipCanvas`, `dipTex` | `state` | Reused as-is; effects ride the same canvas. |
| `corePieceFields()` | ~ save section | Add `kiln: {type, seed, slot}`. **Spread `corePieceFields()` for the partner entry too** — the v223 fix exists precisely because that field list was hand-copied and drifted. |
| `advanceStage` (`leather` → fired) | ~4570–4620 | Read the chosen firing type; roll and store the seed here, once. |
| `beginFiringMoment` / `endFiringMoment` / `cancelFiringMoment` | ~4570–4600 | Modulate by type. `cancelFiringMoment` must also clear a rolled-but-unused seed. |
| `currentLook` / `lookForPiece` / `withFinish` | ~ finishes | Raku needs an iridescence path; extend `withFinish` rather than adding a parallel system. |
| `syncPartnerMesh` | partner section | Replay the partner's kiln effects, the same way it already replays `saved.dips`. |
| `FIRING_DURATION`, `REDUCED_FIRING_DURATION`, `reduceMotion` | 64, 4542 | Gate all timing. |
| `window.__slip` | ~1937 | Add `setFiring`, `kilnInfo()`, and a seed override so results are assertable from a page script. |
| `index.html` `?v=` | — | Bump. |

**Where the picker goes:** the firing type belongs on the Dry→Fire control at the
leather stage, not buried in a menu. A row of four chips above the Fire button,
using the established `--pill-active-bg` treatment. If it lands inside a
`pointer-events: none` container, every chip needs `pointer-events: auto`.

---

## Build phases

**Phase 1 — firing types on a single pot.** The four types, seeded effects painted
into the dip canvas, persistence in `corePieceFields`, the picker, partner sync.
This is the whole idea in its simplest form and it's shippable alone.

**Phase 2 — re-fire from the gallery.** Load a saved pot, pick a different
firing, fire again, save as a new entry. Very cheap once phase 1 exists, and it's
what turns the gallery into a reason to come back.

**Phase 3 — the kiln load.** Multi-piece shelf, placement, position-driven
effects. Large. Only if phases 1–2 earn it.

---

## Open questions for Onion

1. **Is raku too dramatic for the calm brand?** It's the most visually exciting
   of the four and the most likely to make someone say "look what happened." It's
   also the one furthest from "a quiet place to make things."
2. **Should the firing type be visible on the gallery card** — a small mark
   saying this one was wood-fired? It's honest labelling and it makes the variety
   legible, but it's also more chrome on a card that was just simplified.
3. **How strong should the effects be by default?** My instinct is *noticeably
   under* what feels right in isolation. A subtle effect that makes someone lean
   in beats a strong one that makes them feel the app overrode their choices.
4. **Should wood/soda/raku be available from the very first pot,** or introduced
   once someone has fired a few? Introducing them later is more discoverable but
   edges toward progression gating, which we've otherwise avoided entirely.
