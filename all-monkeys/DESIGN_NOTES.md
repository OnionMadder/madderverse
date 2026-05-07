# All Munkis — Design Notes

Working notes for in-flight design changes. Not architectural docs (those live in [CLAUDE.md](CLAUDE.md)) — these capture decisions that haven't been implemented yet.

## Munki banks (pending implementation)

> Reduce the munki bank from 16 to 8 per page — 16 is far too clunky on mobile.
> Each bank = 5 regular munkis + 1 evil munki.
> The first two banks are unlocked and swappable.
> The third bank is all madballs munkis, no evil munki.
> All madball munkis have powers similar to the evil munkis but on a lesser scale.

### Implications for the existing code

The current setup has one fixed `STANDARD_ORDER` of 16 munki ids and one fixed `MADBALLZ_ORDER` of 8 ids; the tray renders whichever array matches the current screen. Reworking to banks-of-6 changes:

- The shape of the data: `STANDARD_ORDER` becomes two banks of 6 (5 regular + 1 evil each), and `MADBALLZ_ORDER` becomes one bank of 6 (all madballs, no evil). Total displayed = 6, not 16.
- A bank-switcher UI element (left/right arrows? bank dots?) lets the kid swap between bank 1 and bank 2. The third (madballs) bank still gates behind the existing horror-trigger unlock.
- Madballs munkis need new `play()` voices — currently they're full antagonist-strength textures (distorted pluck, wail, bubble arp, chopper-LFO bass, electric, thud). They need to be re-tuned as "lesser-scale" versions of the evil munkis' powers (Ice freeze / Moon void), retaining horror flavor without the auto-jumpscare trigger.

### Open design questions

- Which 5 regular munkis go in bank 1 vs. bank 2? (Probably split by musical role — drums/bass/lead grouped sensibly within each bank so any one bank still composes a coherent loop.)
- Is the "evil" munki the same in both unlocked banks (Ice in bank 1, Moon in bank 2)? Or one repeated across? Or both available in both?
- Madballs powers — does each madball munki get a "weaker" version of a specific evil power (e.g. mb-zorb does a brief shimmer like Ice, mb-brain does a short low rumble like Moon), or is each just a tilted texture without a horror tie-in?
