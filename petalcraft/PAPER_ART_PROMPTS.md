# Petalcraft — Torn-Paper Art: Gemini prompt kit

Goal: a **cut/torn construction-paper collage** look (Eric-Carle-ish), produced
as a *reusable kit* of paper pieces, then assembled + patterned into flower
frames for the sprite sheets in `ASSETS.md`.

Division of labor:
- **Gemini** makes the **torn-paper shapes** — realistic hand-torn fiber edges +
  matte paper grain. That's the thing AI does well and is tedious by hand.
- **rawpixel patterns** + your editor do the **color** — clip a pattern (gingham,
  honeycomb, dots, chevron) into each shape, or tint the neutral paper. Crisp,
  controllable, recolorable.

---

## How to work with Gemini (read once)

1. **Generate NEUTRAL paper, not 8 color sets.** Make the kit in a warm off-white
   ("warm white sugar paper"). Recolor/pattern per phenotype color later. One kit
   → every species and color.
2. **Flat white background, always.** Gemini won't give clean alpha. Put every
   piece on `#FFFFFF` seamless so you can key it out. (You can then say: *"place
   this exact piece on a transparent background"* — sometimes works; if not, key
   the white in Procreate/Affinity/Photoshop or remove.bg.)
3. **Build the set in one chat.** Generate one great petal, then ask for more
   "in the EXACT same paper, texture, lighting, and torn-edge style." Staying in
   the conversation is what keeps the set consistent.
4. **Feed a reference.** Drop a real torn-paper photo (or the beach collage) into
   the chat and say "match this paper and edge style." References beat adjectives.
5. **Square, max resolution.** Ask for square 1:1, highest quality. Each piece
   centered and large (~80% of frame) so it extracts cleanly.
6. **Consistent orientation.** Petals **tip pointing up, base down** — so you can
   rotate one petal around a center to build the bloom predictably.

---

## The kit to generate (neutral paper, white bg)

For a first **test flower (cosmos)** you only need: a **petal set** + a **center
disc**. The rest completes the kit for the full art pass.

| piece | how many | notes |
|---|---|---|
| Rounded petal | 4–6 silhouettes | cosmos/pansy/windflower/mum blooms |
| Pointed petal | 4–6 silhouettes | lily/rose star petals |
| Tulip cup | 2–3 | tulip bloom (one closed cup shape) |
| Center disc | 2–3 | flower centers (small round torn disc) |
| Leaf | 3–4 | varied leaf silhouettes |
| Thin stem | 2 | straight + slightly curved |
| Closed bud | 2–3 | teardrop of overlapping scraps |
| Seed speck | 2–3 | tiny brown torn scrap (seed stage) |
| Sprout | 2 | short stem + two tiny leaves (sprout stage) |

---

## Master prompt template

Fill the `[BRACKETS]`:

> Top-down flat-lay of a single **[SHAPE]** hand-torn from **[warm off-white]**
> construction paper. Real matte sugar-paper texture with fine grain and a faint
> speckle. The edge is irregularly **hand-torn with a soft deckled tear — pale
> paper pulp and fibers showing along the torn contour**, never a clean cut.
> Soft even studio softbox lighting with a **faint soft shadow directly beneath**
> the piece. The piece is centered and large, filling about 80% of the frame.
> **Isolated on a flat pure white #FFFFFF seamless background.** Children's-book
> cut-paper-collage aesthetic. **No perspective, no gloss or plastic, no flat
> vector look, no text, no watermark, no hands, no other objects.**

---

## Ready-to-paste prompts

**1 — Petal set (the important one).**
> A neat, evenly spaced grid of **twelve flower-petal shapes**, each **hand-torn
> from the same warm off-white construction paper**, all sharing identical paper
> texture, lighting, and torn-edge style, but with gently varied organic
> silhouettes — some rounder, some more teardrop. Each petal **tip pointing up**,
> base down. Soft hand-torn deckled edges with visible paper fibers, matte
> sugar-paper grain, faint soft shadow under each. Flat pure white #FFFFFF
> seamless background. Children's-book cut-paper-collage style. No perspective,
> no gloss, no text, no hands.

Then, in the same chat, to extend/refine:
> Same paper, lighting and torn edge exactly — give me **6 more, but pointed
> star-shaped petals** for lilies and roses.

**2 — Center discs.**
> Three small **round discs hand-torn from warm off-white construction paper**,
> slightly irregular circles for flower centers, same torn-fiber edge and matte
> grain, faint shadow beneath, evenly spaced on a flat pure white #FFFFFF
> background. Cut-paper-collage style, no gloss, no text.

**3 — Leaf + stem.**
> A set of **four leaf shapes and two thin stems, hand-torn from warm off-white
> construction paper**, varied natural leaf silhouettes, same torn-fiber deckled
> edge and matte paper grain, soft shadow beneath each, evenly spaced on flat
> pure white #FFFFFF background. Cut-paper-collage style, no gloss, no text.

**4 — Bud / seed / sprout (growth stages).**
> On a flat pure white #FFFFFF background, three small paper-collage pieces, hand-
> torn warm off-white construction paper with fibrous torn edges and matte grain:
> (a) a **closed teardrop flower bud** made of a few overlapping torn scraps,
> (b) a **tiny seed speck** (small rounded torn scrap),
> (c) a **sprout** — a short stem with two little leaves. Evenly spaced, soft
> shadow beneath each. No gloss, no text.

**5 — Tulip cup (species-specific bloom).**
> A **tulip flower cup shape hand-torn from warm off-white construction paper** —
> a rounded goblet silhouette with three soft torn lobes at the top — same torn-
> fiber deckled edge, matte grain, faint shadow, on a flat pure white #FFFFFF
> background. Cut-paper-collage style, no gloss, no text.

**Quick-and-dirty colored test (skip the kit, see the vibe now):** swap "warm
off-white" for the color+pattern directly, e.g. *"hand-torn from **buttery-yellow
polka-dot patterned paper**"* or *"…from **soft-red gingham paper**."* Less
control than clipping rawpixel patterns, but instant to eyeball.

---

## From Gemini output → a game frame

1. **Key out the white** on each piece → transparent PNG of the bare shape.
2. **Color it:** either tint the neutral paper to the phenotype color
   (multiply/color-overlay keeps the texture), **and/or** clip a **rawpixel
   pattern** into the shape (gingham/honeycomb/dots per color). rawpixel art is
   cleared to ship.
3. **Assemble the bloom:** rotate one petal ~5× around a center disc; add stem/
   leaf for lower stages. Bake a soft drop-shadow between layers (that paper-on-
   paper depth is what sells it).
4. **Export to the grid** per `ASSETS.md`: one PNG per species, columns
   `seed·sprout·bud·bloom·night`, rows = the species' dex colors, 128px cells,
   flower centered with a little margin, transparent.
5. Keep patterns bolder on the big bloom, plainer on tiny seed/sprout — busy
   patterns muddy at ~64px on a phone.

---

## For the test loop

Make **one** cosmos: a red bloom (5 petals + a yellow center), even rough. Save
it as `assets/img/flowers/_test.png` (or just send me the pieces) and I'll wire
it into the sprite pipeline so you can see it at real tile size, on a paper
background, next to the CSS flowers — before you commit to the full set.
