# Slip Studio — the showroom

A room your pots stand in. Wooden shelves against a warm wall, every finished
piece on display at a size the gallery grid never gives them, filling up as
the potter's body of work grows.

Written against **web v244**. Built same day (v245).

---

## Why

The last unbuilt pillar from the 2026-08-26 competitive research: strong
collection systems reward the player with **display, not currency** — Master
of Pottery's expandable showroom is what its reviewers credit for "way more
time than I meant to," and Animal Crossing's museum is a walkable exhibit,
not a checklist. Slip Studio's gallery is management (search, collections,
delete, rename); the showroom is the *payoff view* — the room you show
someone.

## What it is

- **Showroom** button in the gallery bar → a full-screen room: pots standing
  on shelf boards, oldest at the top — the room reads as the story of the
  potter, filling downward.
- Pots are shown as cutouts (the transparent thumbs the gallery already
  captures; legacy opaque thumbs keyed out) standing ON the shelf with a
  contact shadow, clipped at the foot — no cards, no chrome, no captions.
- Sets stand assembled (the shared assembly shot).
- Tap a pot → it loads and opens Display mode, same as tapping a gallery
  card.
- A single quiet count line ("Fourteen pieces."). Empty room: *"Your first
  fired pot will stand here."*

## Non-goals

- **No empty slots begging to be filled**, no capacity, no upgrades, no
  visitors' scores. The room grows; it never asks.
- No rearranging in v1 (order is time; collections may become rooms later).
- No new assets — the wall and boards are CSS, the pots are existing thumbs.

## Mechanics

`stageThumb`'s pot-isolation half is extracted as `potCutoutURL` (cutout +
legacy key-out, no backdrop). Each slot clips its image at `POT_FOOT_FRAC`
(`ASSEMBLY_FOOT_FRAC` for sets) so the foot lands exactly on the board and
the wheel baked into legacy thumbs never shows. Shelves are discrete rows
chunked at render time from the container width. Modal follows the kiln-load
pattern: opens over the gallery, focus trap, Escape.

## Later, if it earns it

Collections as separate rooms · a noticeboard-cast visitor admiring a piece
(one line, no rating) · the showroom as the shelf-photo composition source.
