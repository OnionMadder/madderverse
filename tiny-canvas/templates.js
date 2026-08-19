/* ============================================================
   Tiny Canvas — coloring-page templates
   ============================================================
   Each template renders on top of the kid's canvas at
   pointer-events: none — the kid colors UNDER the lines, the
   lines stay visible.

   Two formats:

   - image: path to a transparent-background PNG in
     assets/coloring-pages/. Lines are baked as ALPHA (ink color
     #1c2226, matching --line-ink) so the fill mask's alpha>=96
     threshold works on it unchanged and the kid's strokes show
     through everywhere there is no line. Sources live in
     art-src/coloring-pages/ (untracked working art, ~2816x1536);
     assets/ holds the optimized 1800px-wide builds produced by
     scripts/process-coloring-pages.py, plus 360px picker thumbs
     under assets/coloring-pages/thumbs/.

   - svg: inline SVG string (the original hand-drawn format).
     BLANK is the only remaining entry without art; the engine
     keeps full support for svg pages, see game.js.

   ------------------------------------------------------------
   PACKS (the 2026-08-07 catalog, Onion's art — 72 pages):

   - FREE (pro: false) — BLANK + six basics. Everyone gets these.
   - Eleven themed CATEGORIES (pro: true) — six scenes each. In
     each, THREE pages carry `free: true` — the category's free
     representatives (bumped 2026-08-09; was one apiece). Free
     tier = BLANK + 6 basics + 33 reps = 40 pages; Pro adds the
     other 33.

   The picker (buildPicker in game.js) renders:
   - unlocked (all of web, purchased native): every pack as its
     own headed section, all pages.
   - locked native: ONE flat headerless grid — the FREE pack
     plus each category's `free` page. No locks, no greyed cards;
     the free app just looks complete.

   To add/replace a page: drop the source scene into
   art-src/coloring-pages/<packdir>/, run
   scripts/process-coloring-pages.py (mirrors subfolders into
   assets/ + thumbs/ and audits fillable regions — read its
   output), then edit the pack below. Folder name == pack id;
   page id must be UNIQUE across all packs (it is the localStorage
   key for saved in-progress work).
   ============================================================ */

window.TINY_CANVAS_PAGE_PACKS = [
    {
        id: "free", label: "FREE", pro: false,
        pages: [
            { id: "blank",   name: "BLANK",     svg: "" },
            /* SUNNY DAY moved out of FREE 2026-08-17 — it now anchors the
               COLOR BY NUMBER pack as `cbn-sun`, so leaving it here would
               double-list the same page. The `free/sun.png` file stays on
               disk because cbn-sun still references it. */
            { id: "rainbow", name: "RAINBOW",   image: "assets/coloring-pages/free/rainbow.png" },
            { id: "leaf",    name: "LEAF",      image: "assets/coloring-pages/free/leaf.png" },
            { id: "icecube", name: "ICE CUBE",  image: "assets/coloring-pages/free/icecube.png" },
            { id: "markers", name: "MARKERS",   image: "assets/coloring-pages/free/markers.png" },
            { id: "beans",   name: "BEANS",     image: "assets/coloring-pages/free/beans.png" }
        ]
    },
    /* COLOR BY NUMBER pack (grew from a one-page demo to a real pack
       2026-08-17; all eight authored 2026-08-18). Ordered by ascending
       region count = ascending difficulty: cactus 6 -> rainbow 9 ->
       tulip 10 -> pumpkin 12 -> snowman 14 -> cat 15 -> donkey 22 ->
       sunny day 36. Keep that order when adding a page; the first card
       is the one a kid meets first, and 36 numbers is not a welcome.

       All eight fit the engine's shape rules (thick outlines, no
       interior detail, chunky sealed regions). See
       CBN_PROMPT_GUIDE.md for the Gemini prompt kit that produced
       this cohort — the "cozy" art before it was too dense to work
       as CBN and lives in its own freehand pack.

       Pack stays pro:false so the CBN mechanic isn't paywalled —
       CBN is the app's most distinctive learning moment; hiding it
       behind Pro would undercut the "every kid can play the whole
       game" rule (see CLAUDE.md).

       ── What a `cbn` block is ────────────────────────────────────

       `palette` is 1-indexed: the number a kid sees IS the index.
       `regions` are SEEDS, not geometry — `{x, y, ci}` where the
       point is that region's anchor (guaranteed inside it) and `ci`
       is the palette index it should be. The runtime detects the
       regions itself via cbn-core.js and maps each seed onto
       whichever region contains it. Nothing about the region's
       shape, size or position is stored here, so re-running the
       detector can never leave this data stale.

       Authored with tools/cbn-editor.html — open it, click a
       region, click a number, copy the block. It loads the same
       cbn-core.js the game does, so what you click is what the game
       detects. `scripts/process-cbn-page.py` audits a page and can
       write a region map to look at.

       An `assign(ax, ay)` function is still supported in place of
       `regions` (it gets each region's anchor and returns a palette
       index), but nothing uses it — cbn-sun's hand-tuned version
       was retired when the pack was authored properly. */
    {
        id: "cbn", label: "COLOR BY NUMBER", pro: false,
        pages: [
            {
                id:    "cbn-cactus",
                name:  "CACTUS",
                /* ?v=2 because the ARTWORK changed on 2026-08-18, not just the
                   code. Its rib lines were demoted from boundaries to
                   decoration (see the CACTUS note below), which changes
                   what the region detector sees — and the `regions`
                   seeds below are authored against the NEW art. A
                   browser holding the old cactus.png in cache would pair
                   old art with new seeds and number it wrongly, and
                   image files carry no cache-bust of their own. Bump
                   this whenever a page's PNG is re-cut. The thumb picks
                   the query up too (thumbSrc keeps it), which is right —
                   the thumb was regenerated from the same alpha. */
                image: "assets/coloring-pages/cbn/cactus.png?v=2",
                cbn: {
                    palette: ["#a8dcf6", "#5cae43", "#8ed968", "#d97a4a", "#8a5a3c"],
                    regions: [
                        { x: 0.7974, y: 0.5358, ci: 1 },
                        { x: 0.4917, y: 0.3680, ci: 2 },
                        { x: 0.6079, y: 0.2404, ci: 3 },
                        { x: 0.4399, y: 0.5621, ci: 3 },
                        { x: 0.6460, y: 0.8663, ci: 4 },
                        { x: 0.4185, y: 0.8645, ci: 5 }
                    ]
                }
            },
            {
                id:    "cbn-rainbow",
                name:  "RAINBOW",
                image: "assets/coloring-pages/cbn/rainbow.png",
                cbn: {
                    palette: ["#a8dcf6", "#ff5a5a", "#ff9d42", "#ffd23f", "#7ed957", "#4aa8ff", "#b47cff", "#ffffff"],
                    regions: [
                        { x: 0.4995, y: 0.7107, ci: 1 },
                        { x: 0.3940, y: 0.0848, ci: 2 },
                        { x: 0.4146, y: 0.1477, ci: 3 },
                        { x: 0.4165, y: 0.2194, ci: 4 },
                        { x: 0.4370, y: 0.2823, ci: 5 },
                        { x: 0.5532, y: 0.3505, ci: 6 },
                        { x: 0.4419, y: 0.4257, ci: 7 },
                        { x: 0.2456, y: 0.8575, ci: 8 },
                        { x: 0.7534, y: 0.8575, ci: 8 }
                    ]
                }
            },
            {
                id:    "cbn-tulip",
                name:  "TULIP",
                image: "assets/coloring-pages/cbn/tulip.png",
                cbn: {
                    palette: ["#a8dcf6", "#ff5a8a", "#ffa3c4", "#7ed957", "#4f9e3f"],
                    regions: [
                        { x: 0.1958, y: 0.3505, ci: 1 },
                        { x: 0.4946, y: 0.1355, ci: 3 },
                        { x: 0.4517, y: 0.1198, ci: 3 },
                        { x: 0.5356, y: 0.2194, ci: 3 },
                        { x: 0.4673, y: 0.3103, ci: 2 },
                        { x: 0.5728, y: 0.6827, ci: 4 },
                        { x: 0.5571, y: 0.6023, ci: 5 },
                        { x: 0.5024, y: 0.8698, ci: 4 },
                        { x: 0.4321, y: 0.5830, ci: 5 },
                        { x: 0.4292, y: 0.6792, ci: 4 }
                    ]
                }
            },
            {
                id:    "cbn-pumpkin",
                name:  "PUMPKIN",
                image: "assets/coloring-pages/cbn/pumpkin.png",
                cbn: {
                    palette: ["#a8dcf6", "#ff9d42", "#e0741f", "#8ac36b", "#4f9e3f"],
                    regions: [
                        { x: 0.1626, y: 0.2911, ci: 1 },
                        { x: 0.5474, y: 0.1040, ci: 4 },
                        { x: 0.4663, y: 0.3051, ci: 4 },
                        { x: 0.4976, y: 0.2823, ci: 4 },
                        { x: 0.4116, y: 0.2037, ci: 5 },
                        { x: 0.5278, y: 0.3016, ci: 4 },
                        { x: 0.5835, y: 0.2299, ci: 5 },
                        { x: 0.5581, y: 0.2911, ci: 5 },
                        { x: 0.4360, y: 0.2928, ci: 5 },
                        { x: 0.6812, y: 0.4851, ci: 3 },
                        { x: 0.3218, y: 0.4816, ci: 3 },
                        { x: 0.5034, y: 0.8173, ci: 2 }
                    ]
                }
            },
            {
                id:    "cbn-snowman",
                name:  "SNOWMAN",
                image: "assets/coloring-pages/cbn/snowman.png",
                cbn: {
                    palette: ["#a8dcf6", "#ffffff", "#3a3f4a", "#ff5a5a", "#ff8b3d", "#a67849"],
                    regions: [
                        { x: 0.1782, y: 0.6809, ci: 1 },
                        { x: 0.4849, y: 0.0865, ci: 3 },
                        { x: 0.4604, y: 0.1705, ci: 4 },
                        { x: 0.4224, y: 0.2054, ci: 3 },
                        { x: 0.4507, y: 0.3365, ci: 2 },
                        { x: 0.5044, y: 0.3313, ci: 5 },
                        { x: 0.3618, y: 0.4677, ci: 6 },
                        { x: 0.5347, y: 0.4642, ci: 4 },
                        { x: 0.6382, y: 0.4677, ci: 6 },
                        { x: 0.4780, y: 0.6075, ci: 2 },
                        { x: 0.5581, y: 0.5935, ci: 4 },
                        { x: 0.5142, y: 0.8191, ci: 2 },
                        { x: 0.4370, y: 0.9362, ci: 6 },
                        { x: 0.5630, y: 0.9362, ci: 6 }
                    ]
                }
            },
            {
                id:    "cbn-cat",
                name:  "CAT",
                image: "assets/coloring-pages/cbn/cat.png",
                cbn: {
                    palette: ["#a8dcf6", "#8ac36b", "#f0a060", "#fff0d8", "#ff8fb0", "#3a3f4a"],
                    regions: [
                        { x: 0.1753, y: 0.4886, ci: 1 },
                        { x: 0.3579, y: 0.1215, ci: 5 },
                        { x: 0.5630, y: 0.1215, ci: 5 },
                        { x: 0.4595, y: 0.1932, ci: 3 },
                        { x: 0.3862, y: 0.4047, ci: 4 },
                        { x: 0.4038, y: 0.3365, ci: 6 },
                        { x: 0.5161, y: 0.3365, ci: 6 },
                        { x: 0.7075, y: 0.3977, ci: 3 },
                        { x: 0.4614, y: 0.3907, ci: 5 },
                        { x: 0.4546, y: 0.4607, ci: 4 },
                        { x: 0.6069, y: 0.7509, ci: 3 },
                        { x: 0.4058, y: 0.6337, ci: 3 },
                        { x: 0.4438, y: 0.7264, ci: 3 },
                        { x: 0.4185, y: 0.8523, ci: 3 },
                        { x: 0.2944, y: 0.8907, ci: 2 }
                    ]
                }
            },
            {
                id:    "cbn-donkey",
                name:  "DONKEY",
                image: "assets/coloring-pages/cbn/donkey.png",
                cbn: {
                    palette: ["#a8dcf6", "#ffd23f", "#9fb6cf", "#ffe9a8", "#ff8fb0", "#a67849", "#8ac36b", "#ff9d42"],
                    regions: [
                        { x: 0.1997, y: 0.3575, ci: 1 },
                        { x: 0.3853, y: 0.1058, ci: 4 },
                        { x: 0.5093, y: 0.3295, ci: 4 },
                        { x: 0.4038, y: 0.1879, ci: 5 },
                        { x: 0.5562, y: 0.2019, ci: 5 },
                        { x: 0.8638, y: 0.2334, ci: 2 },
                        { x: 0.4702, y: 0.2351, ci: 5 },
                        { x: 0.5562, y: 0.3523, ci: 5 },
                        { x: 0.4312, y: 0.4712, ci: 6 },
                        { x: 0.5483, y: 0.6267, ci: 3 },
                        { x: 0.9663, y: 0.6233, ci: 8 },
                        { x: 0.9829, y: 0.6635, ci: 8 },
                        { x: 0.7153, y: 0.7579, ci: 7 },
                        { x: 0.6548, y: 0.7177, ci: 6 },
                        { x: 0.5679, y: 0.9816, ci: 7 },
                        { x: 0.5640, y: 0.7841, ci: 3 },
                        { x: 0.2104, y: 0.9659, ci: 7 },
                        { x: 0.9448, y: 0.7893, ci: 2 },
                        { x: 0.9390, y: 0.9030, ci: 5 },
                        { x: 0.6089, y: 0.8645, ci: 6 },
                        { x: 0.4722, y: 0.8890, ci: 6 },
                        { x: 0.5220, y: 0.8925, ci: 6 }
                    ]
                }
            },
            /* cbn-sun was the original demo and until 2026-08-18 was
               the ONLY page with CBN data — a hand-tuned assign(cx, cy)
               that classified regions by where they sat (a circle test
               for the sun body, an angle bucket for the rays, boxes for
               the clouds and the butterfly). It kept the mechanic
               working end-to-end while the engine was proven, and it is
               retired now that the pack is authored properly: the
               numbers below are per-region, so the eyes, cheeks and
               butterfly get their own colours instead of falling into
               whichever zone rule happened to catch them.

               Rays alternate yellow/orange around the disc, matching
               the artwork — assigned by angle at authoring time rather
               than by a rule at runtime. See tools/cbn-editor.html. */
            {
                id:    "cbn-sun",
                name:  "SUNNY DAY",
                image: "assets/coloring-pages/free/sun.png",
                cbn: {
                    palette: ["#a8dcf6", "#ffffff", "#f7ce4b", "#f39a3a", "#ff8fb0", "#3a3f4a", "#b47cff"],
                    regions: [
                        { x: 0.1392, y: 0.7379, ci: 1 },
                        { x: 0.5005, y: 0.0814, ci: 3 },
                        { x: 0.8540, y: 0.1887, ci: 2 },
                        { x: 0.1479, y: 0.1852, ci: 2 },
                        { x: 0.3833, y: 0.1386, ci: 3 },
                        { x: 0.6177, y: 0.1386, ci: 3 },
                        { x: 0.4468, y: 0.1440, ci: 4 },
                        { x: 0.5542, y: 0.1422, ci: 4 },
                        { x: 0.3521, y: 0.2388, ci: 4 },
                        { x: 0.6489, y: 0.2388, ci: 4 },
                        { x: 0.4995, y: 0.3444, ci: 3 },
                        { x: 0.2964, y: 0.2943, ci: 3 },
                        { x: 0.7046, y: 0.2943, ci: 3 },
                        { x: 0.8706, y: 0.4123, ci: 7 },
                        { x: 0.2983, y: 0.4052, ci: 4 },
                        { x: 0.7026, y: 0.4052, ci: 4 },
                        { x: 0.8374, y: 0.4159, ci: 7 },
                        { x: 0.4409, y: 0.4267, ci: 6 },
                        { x: 0.5591, y: 0.4267, ci: 6 },
                        { x: 0.8179, y: 0.4660, ci: 7 },
                        { x: 0.8530, y: 0.4660, ci: 7 },
                        { x: 0.2661, y: 0.5000, ci: 3 },
                        { x: 0.7339, y: 0.5000, ci: 3 },
                        { x: 0.4106, y: 0.5286, ci: 5 },
                        { x: 0.5806, y: 0.5286, ci: 5 },
                        { x: 0.2983, y: 0.5948, ci: 4 },
                        { x: 0.7017, y: 0.5948, ci: 4 },
                        { x: 0.2983, y: 0.7057, ci: 3 },
                        { x: 0.7056, y: 0.7093, ci: 3 },
                        { x: 0.3530, y: 0.7630, ci: 4 },
                        { x: 0.6450, y: 0.7594, ci: 4 },
                        { x: 0.3833, y: 0.8703, ci: 3 },
                        { x: 0.6167, y: 0.8685, ci: 3 },
                        { x: 0.4458, y: 0.8703, ci: 4 },
                        { x: 0.5552, y: 0.8685, ci: 4 },
                        { x: 0.5005, y: 0.9293, ci: 3 }
                    ]
                }
            }
        ]
    },
    {
        id: "animals", label: "ANIMALS", pro: true,
        pages: [
            { id: "cat",     name: "KITCHEN CAT", image: "assets/coloring-pages/animals/cat.png", free: true },
            { id: "dog",     name: "PUPPY",       image: "assets/coloring-pages/animals/dog.png", free: true },
            { id: "unicorn", name: "UNICORN",     image: "assets/coloring-pages/animals/unicorn.png", free: true },
            { id: "bird",    name: "BIRD NEST",   image: "assets/coloring-pages/animals/bird.png" },
            { id: "lizard",  name: "IGUANA",      image: "assets/coloring-pages/animals/lizard.png" },
            { id: "skunk",   name: "SKUNK",       image: "assets/coloring-pages/animals/skunk.png" }
        ]
    },
    {
        id: "insects", label: "BUGS", pro: true,
        pages: [
            { id: "ladybug",   name: "LADYBUG",    image: "assets/coloring-pages/insects/ladybug.png", free: true },
            { id: "butterfly", name: "BUTTERFLY",  image: "assets/coloring-pages/insects/butterfly.png", free: true },
            { id: "bees",      name: "BEEHIVE",    image: "assets/coloring-pages/insects/bees.png" },
            { id: "ants",      name: "ANT CITY",   image: "assets/coloring-pages/insects/ants.png" },
            { id: "snails",    name: "SNAIL RACE", image: "assets/coloring-pages/insects/snails.png", free: true },
            { id: "spider",    name: "SPIDER WEB", image: "assets/coloring-pages/insects/spider.png" }
        ]
    },
    {
        id: "ocean", label: "OCEAN", pro: true,
        pages: [
            { id: "fish",      name: "BIG FISH",   image: "assets/coloring-pages/ocean/fish.png", free: true },
            { id: "reef",      name: "CORAL REEF", image: "assets/coloring-pages/ocean/reef.png", free: true },
            { id: "shipwreck", name: "SHIPWRECK",  image: "assets/coloring-pages/ocean/shipwreck.png" },
            { id: "mermaids",  name: "MERMAIDS",   image: "assets/coloring-pages/ocean/mermaids.png" },
            { id: "treasure",  name: "TREASURE",   image: "assets/coloring-pages/ocean/treasure.png", free: true },
            { id: "atlantis",  name: "ATLANTIS",   image: "assets/coloring-pages/ocean/atlantis.png" }
        ]
    },
    {
        id: "dinosaurs", label: "DINOSAURS", pro: true,
        pages: [
            { id: "longneck",     name: "LONGNECK",     image: "assets/coloring-pages/dinosaurs/longneck.png", free: true },
            { id: "trex",         name: "T-REX",        image: "assets/coloring-pages/dinosaurs/predator.png", free: true },
            { id: "raptor",       name: "RAPTOR",       image: "assets/coloring-pages/dinosaurs/feathered.png" },
            { id: "stego-family", name: "STEGO FAMILY", image: "assets/coloring-pages/dinosaurs/family.png", free: true },
            { id: "dino-parade",  name: "DINO PARADE",  image: "assets/coloring-pages/dinosaurs/herd.png" },
            { id: "dino-meadow",  name: "DINO MEADOW",  image: "assets/coloring-pages/dinosaurs/pastoral.png" }
        ]
    },
    {
        id: "space", label: "SPACE", pro: true,
        pages: [
            { id: "base",      name: "MOON BASE",       image: "assets/coloring-pages/space/base.png", free: true },
            { id: "spacewalk", name: "SPACEWALK",       image: "assets/coloring-pages/space/spacewalk.png", free: true },
            { id: "picnic",    name: "ALIEN PICNIC",    image: "assets/coloring-pages/space/picnic.png" },
            { id: "comet",     name: "COMET RIDE",      image: "assets/coloring-pages/space/comet.png" },
            { id: "control",   name: "MISSION CONTROL", image: "assets/coloring-pages/space/control.png" },
            { id: "earth",     name: "EARTHRISE",       image: "assets/coloring-pages/space/earth.png", free: true }
        ]
    },
    {
        id: "transportation", label: "GO GO GO", pro: true,
        pages: [
            { id: "rocket",   name: "ROCKET SHIP", image: "assets/coloring-pages/transportation/rocket.png", free: true },
            { id: "car",      name: "ROAD TRIP",   image: "assets/coloring-pages/transportation/car.png", free: true },
            { id: "truck",    name: "FIRE TRUCK",  image: "assets/coloring-pages/transportation/truck.png", free: true },
            { id: "airplane", name: "AIRPLANE",    image: "assets/coloring-pages/transportation/airplane.png" },
            { id: "ship",     name: "CRUISE SHIP", image: "assets/coloring-pages/transportation/ship.png" },
            { id: "hover",    name: "HOVER CAR",   image: "assets/coloring-pages/transportation/hover.png" },
            { id: "racecar",  name: "RACECAR",     image: "assets/coloring-pages/transportation/racecar.png" }
        ]
    },
    {
        id: "music", label: "MUSIC", pro: true,
        pages: [
            { id: "guitar",  name: "GUITAR",  image: "assets/coloring-pages/music/guitar.png", free: true },
            { id: "drums",   name: "DRUMS",   image: "assets/coloring-pages/music/drums.png", free: true },
            { id: "bass",    name: "BASS",    image: "assets/coloring-pages/music/bass.png" },
            { id: "harp",    name: "HARP",    image: "assets/coloring-pages/music/harp.png" },
            { id: "synth",   name: "SYNTH",   image: "assets/coloring-pages/music/synth.png" },
            { id: "maracas", name: "MARACAS", image: "assets/coloring-pages/music/maracas.png", free: true },
            { id: "keyboard", name: "KEYBOARD", image: "assets/coloring-pages/music/keyboard.png" }
        ]
    },
    {
        id: "food", label: "FOOD", pro: true,
        pages: [
            { id: "donut",     name: "DONUT",       image: "assets/coloring-pages/food/donut.png", free: true },
            { id: "cupcakes",  name: "CUPCAKES",    image: "assets/coloring-pages/food/cupcakes.png", free: true },
            { id: "bananas",   name: "BANANAS",     image: "assets/coloring-pages/food/bananas.png", free: true },
            { id: "breakfast", name: "BREAKFAST",   image: "assets/coloring-pages/food/breakfast.png" },
            { id: "curry",     name: "CURRY FEAST", image: "assets/coloring-pages/food/curry.png" },
            { id: "dinner",    name: "FISH DINNER", image: "assets/coloring-pages/food/dinner.png" },
            { id: "pancakes",  name: "PANCAKES",    image: "assets/coloring-pages/food/pancakes.png" }
        ]
    },
    {
        id: "home", label: "HOME", pro: true,
        pages: [
            { id: "cabin",    name: "COZY CABIN", image: "assets/coloring-pages/home/cabin.png", free: true },
            { id: "bear",     name: "TEDDY BEAR", image: "assets/coloring-pages/home/bear.png", free: true },
            { id: "kitchen",  name: "KITCHEN",    image: "assets/coloring-pages/home/kitchen.png" },
            { id: "den",      name: "PIANO ROOM", image: "assets/coloring-pages/home/den.png" },
            { id: "garage",   name: "GARAGE",     image: "assets/coloring-pages/home/garage.png" },
            { id: "backyard", name: "BACKYARD",   image: "assets/coloring-pages/home/backyard.png", free: true }
        ]
    },
    {
        id: "places", label: "PLACES", pro: true,
        pages: [
            { id: "egypt",        name: "EGYPT",         image: "assets/coloring-pages/places/egypt.png", free: true },
            { id: "brazil",       name: "BRAZIL",        image: "assets/coloring-pages/places/brazil.png", free: true },
            { id: "alaska",       name: "ALASKA",        image: "assets/coloring-pages/places/alaska.png", free: true },
            { id: "cabo",         name: "CABO",          image: "assets/coloring-pages/places/cabo.png" },
            { id: "tamilnadu",    name: "TAMIL NADU",    image: "assets/coloring-pages/places/tamilnadu.png" },
            { id: "newhampshire", name: "NEW HAMPSHIRE", image: "assets/coloring-pages/places/newhampshire.png" }
        ]
    },
    {
        id: "snowflakes", label: "SNOWFLAKES", pro: true,
        pages: [
            { id: "1flake", name: "SNOWFLAKE 1", image: "assets/coloring-pages/snowflakes/1flake.png", free: true },
            { id: "2flake", name: "SNOWFLAKE 2", image: "assets/coloring-pages/snowflakes/2flake.png", free: true },
            { id: "3flake", name: "SNOWFLAKE 3", image: "assets/coloring-pages/snowflakes/3flake.png", free: true },
            { id: "4flake", name: "SNOWFLAKE 4", image: "assets/coloring-pages/snowflakes/4flake.png" },
            { id: "5flake", name: "SNOWFLAKE 5", image: "assets/coloring-pages/snowflakes/5flake.png" },
            { id: "6flake", name: "SNOWFLAKE 6", image: "assets/coloring-pages/snowflakes/6flake.png" }
        ]
    },
    /* COZY — 10 detailed grown-up-leaning pages (2026-08-17). Onion
       calls them "adult oriented" — dense scenes with lots of
       interior line-work: whiskers, wood grain, tree textures.
       Marketed as its own pack because the aesthetic doesn't match
       the chunky kid-first pages in the other 11 packs. Every ID is
       prefixed `cozy-` to stay clear of the existing `cat`, `unicorn`,
       `butterfly`, `fish`, `rocket`, `cabin`, `rainbow` IDs — that
       collision was the whole reason for the separate pack.

       These were briefly considered as CBN candidates and rejected —
       every page overflows the 40-region cap (rainbow was closest at
       85 regions, butterfly densest at 614). Freehand only; CBN art
       needs its own commission per CBN_PROMPT_GUIDE.md. */
    {
        id: "cozy", label: "COZY", pro: true,
        pages: [
            { id: "cozy-rainbow",   name: "RAINBOW SKY",       image: "assets/coloring-pages/cozy/rainbow.png",   free: true },
            { id: "cozy-cat",       name: "NAPPING CAT",       image: "assets/coloring-pages/cozy/cat.png",       free: true },
            { id: "cozy-unicorn",   name: "UNICORN GROVE",     image: "assets/coloring-pages/cozy/unicorn.png",   free: true },
            { id: "cozy-butterfly", name: "BUTTERFLY GARDEN",  image: "assets/coloring-pages/cozy/butterfly.png" },
            { id: "cozy-cabin",     name: "WOODLAND COTTAGE",  image: "assets/coloring-pages/cozy/cabin.png" },
            { id: "cozy-duck",      name: "DUCK POND",         image: "assets/coloring-pages/cozy/duck.png" },
            { id: "cozy-fish",      name: "SCHOOL OF FISH",    image: "assets/coloring-pages/cozy/fish.png" },
            { id: "cozy-rocket",    name: "STAR CRUISER",      image: "assets/coloring-pages/cozy/rocket.png" },
            { id: "cozy-sunflower", name: "SUNFLOWER FIELD",   image: "assets/coloring-pages/cozy/sunflower.png" },
            { id: "cozy-tropical",  name: "TROPICAL PARADISE", image: "assets/coloring-pages/cozy/tropical.png" }
        ]
    }
];

/* Flat view — the engine (loadTemplate, audits, tests) iterates this;
   the picker iterates the packs. Derived, never hand-edited. */
window.TINY_CANVAS_TEMPLATES = window.TINY_CANVAS_PAGE_PACKS.reduce(
    function (all, pack) { return all.concat(pack.pages); }, []);
