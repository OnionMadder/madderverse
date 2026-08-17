# Tiny Canvas CBN — Gemini prompt kit

Rules and a master template for generating **color-by-number–ready
line art** with Gemini. Companion to
[`CBN_ART_GUIDE.md`](CBN_ART_GUIDE.md) — that doc is the engine
constraints; this one translates them into prompt-language Gemini
will actually respect.

The dense "cozy" line art we already have doesn't work as CBN
because AI defaults to interior detail (cat stripes, cabin siding,
tree bark texture) — every internal line splits what should be a
big chunky region into dozens of small cells, so the engine
overflows its 40-region cap. **This guide asks Gemini for the
OPPOSITE of that default:** simple silhouettes, thick outlines,
NO texture.

---

## The non-negotiables (must appear in every prompt)

Every CBN prompt has to hit these six rules or the output won't
process. Copy-paste these into the prompt verbatim; Gemini follows
imperative language more reliably than adjectives.

1. **"Bold black outlines, minimum 4 pixels wide."** Thinner lines
   antialias below the engine's alpha threshold and read as an open
   border. Wider is fine; too thin is fatal.
2. **"Every shape is a closed loop with no gaps or breaks."** The
   engine's flood fill escapes through a single-pixel gap. Ask
   explicitly.
3. **"No interior detail lines inside any shape."** No whiskers, no
   stripes, no wood grain, no fur strands, no rain streaks. Interior
   lines split one paintable region into many tiny cells and blow
   the engine's cap.
4. **"Solid pure black lines only. No shading, no crosshatching, no
   gray, no color."** A grey wash counts as a partial boundary — the
   fill sometimes leaks through it, sometimes doesn't. Save shading
   for the reference PNG (see §Companion reference).
5. **"12 to 16 chunky fillable regions, each large enough to fit a
   circled number inside."** The magic number. Fewer than 12 reads
   as too simple; more than 16 crowds the number labels.
6. **"Flat 2D composition. No overlapping foreground/background. No
   depth stacks."** A bird half-hidden behind a cloud confuses the
   detector (it sees ONE region, not two). Keep everything flat and
   side-by-side.

---

## The don'ts (explicit negative prompts)

Gemini responds better to a short "DO NOT" list than to hoping it
figures out what you don't want. Include these:

- **DO NOT** add texture, hatching, wood grain, fur strands, feather
  details, whiskers, scales, or stripes.
- **DO NOT** add shadows, shading, gradients, or color of any kind.
- **DO NOT** include multiple thin parallel lines (like a rainbow
  with 7 arcs, or fence slats). Consolidate to a few chunky bands.
- **DO NOT** overlap objects — everything sits side-by-side or
  clearly separated with visible gaps.
- **DO NOT** use dotted, dashed, or broken lines. Solid closed
  outlines only.
- **DO NOT** put small decorative elements (stars, flowers, sparks)
  around the main subject. They inflate the region count.

---

## Master prompt template

Fill the `[BRACKETS]`. Keep the exact wording of the numbered rules
below the subject line — that's the load-bearing part.

> A simple black-and-white **coloring page** for a **color-by-number
> app for kids**. Subject: **[SIMPLE SUBJECT — e.g. "a smiling cat
> face, front view"]**. Composition: **[LAYOUT — e.g. "cat face
> centered on a plain white background"]**.
>
> **STYLE RULES (all must be followed):**
> 1. Bold black outlines, minimum 4 pixels wide. Every outline must
>    be a closed loop — no gaps, no breaks.
> 2. **Exactly 12 to 16 distinct fillable regions.** Each region
>    must be large enough (at least 5% of the image area) to hold
>    a numbered circle inside it.
> 3. **NO interior detail lines inside any shape.** No stripes, no
>    fur texture, no wood grain, no whiskers, no scales, no
>    crosshatching.
> 4. Solid pure black lines on a pure white background. No shading,
>    no color, no gradients.
> 5. Flat 2D layout. No overlaps between objects. Every object is
>    clearly separated from every other object.
> 6. Chunky simple shapes — as if drawn for a 4-year-old to color.
> 7. Aspect ratio 16:9 (landscape).
>
> **DO NOT:** add texture, hatching, wood grain, fur, whiskers,
> stripes, shading, color, decorative stars/sparkles, or any small
> details around the subject.

---

## Worked examples

Each is subject + layout only — the numbered rules block above stays
the same for every generation.

### CAT (10-14 regions target)
> Subject: **a sleeping cat curled in a circle, side view**.
> Composition: **cat fills the centre; two big eyes closed as
> curves; one belly patch, one head patch, one tail on top, four
> paws visible, ground line beneath.**

### FISH (12 regions)
> Subject: **a plump tropical fish, side view, facing right**.
> Composition: **big oval body split into three vertical stripe
> panels; one large eye; one top fin, one bottom fin, one big tail
> fin split into two panels; three round bubbles floating above.**

### HOUSE (14 regions)
> Subject: **a simple two-story house with a garden**.
> Composition: **square house body, triangle roof on top, one
> chimney, one door in the middle, one square window on each side
> of the door, one round window in the roof, one tree to the left
> (round leafy top and straight trunk), one round sun in the sky,
> grass strip along the bottom.**

### BUTTERFLY (14 regions)
> Subject: **a symmetric butterfly, seen from directly above, wings
> spread wide.** Composition: **oval body in the centre; two big
> antennae as curves above; each wing split into three chunky
> segments (large upper, medium lower, small tail)**; one big round
> dot in the centre of each of the four wing segments closest to
> the body.

### ROCKET (13 regions)
> Subject: **a cartoon rocket flying up, side view**.
> Composition: **long rounded rocket body; pointed nose cone on
> top; one big round porthole window in the middle of the body;
> two fins at the base (left + right); flame at the bottom
> (three chunky flame shapes stacked); three stars around it (top-
> left, top-right, bottom-right corners).**

---

## Companion reference (for the pipeline)

The engine needs TWO inputs per CBN page:
1. **The line-art PNG** — what Gemini produces here (black lines,
   white background, no color).
2. **The reference PNG** — a *coloured* version of the same layout,
   used by `scripts/process-cbn-page.py` to sample the intended
   colour for each region.

Prompt Gemini for the reference in a SECOND generation in the same
chat, referencing the first: **"Now take the exact same line art
and colour each region with a distinct simple flat colour, no
shading."** Gemini staying in-chat keeps the layout identical, which
is what the pipeline needs to line the two up.

Palette instruction to include in the reference generation:
> Use only these 6 colours, and use each colour on more than one
> region: **[hex1], [hex2], [hex3], [hex4], [hex5], [hex6]**. Flat
> colour fill, no gradients, no shading, no white borders inside
> shapes.

Pick 4-8 palette colours per page — the engine's max is 8 and 4-6 is
the kid-comfortable range. Match the subject: warm palette for a
sunset, cool palette for an ocean scene.

---

## Post-generation QC checklist

Before running `scripts/process-cbn-page.py`, eyeball at 200%:

- [ ] Count fillable regions. **Target 12–16.** Under 12 = too
      simple, over 20 = re-prompt with "fewer regions, larger shapes."
- [ ] Every outline forms a closed loop. Trace with a finger; no
      corner gaps.
- [ ] No interior detail lines split any single "object" into
      slivers. If you see stripes/whiskers/hair strands, Gemini
      ignored rule 3 — re-prompt with those words explicitly.
- [ ] Every region is at least ~40×40 px at 1800 px wide. Squint
      test: could you drop a number circle inside each region and
      have it be readable? If no, region is too thin — re-prompt.
- [ ] All lines are pure black (not dark grey). If any line looks
      soft/anti-aliased/greyish, tell Gemini "harder edges, pure
      black lines."
- [ ] The line-art and the reference PNG have the SAME layout.
      Identical composition, just one uncoloured and one coloured.

If any check fails, re-prompt in the same chat. Gemini usually
corrects on the second try when you name the specific rule.

---

## Fallback: what if Gemini won't follow the region count?

Gemini image models sometimes drift toward "more detail = more
impressive" and ignore the 12-16 target. Two tactics that help:

1. **Explicit region enumeration.** After the subject line, add:
   *"The image will have exactly these regions: [list them]. Do not
   add any other lines."* Enumerate every shape. Restrictive
   prompts beat aspirational ones.
2. **Reference an example.** Drop a real CBN-style page from any
   coloring book into the chat and say *"match this level of
   simplicity — same chunky shapes, same thick outlines, no
   interior detail."* Visual references beat adjectives here just
   like in the paper-art prompts.

If both fail on a specific subject, the subject is probably too
detailed for the format — swap for a simpler one and try again.
