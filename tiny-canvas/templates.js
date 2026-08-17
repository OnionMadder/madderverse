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
       2026-08-17). Ordered by ascending region count = ascending
       difficulty — cbn-sun's 4-region tutorial → cbn-donkey's 22.

       All eight pages fit the CBN engine's shape rules (thick
       outlines, no interior detail, chunky sealed regions); each
       new one was audited against CBN_MIN_REGION_PX=400 and
       CBN_MAX_REGIONS=40 in scripts before wiring. See
       CBN_PROMPT_GUIDE.md for the Gemini prompt kit that produced
       this second cohort — the "cozy" art before it was too dense
       to work as CBN and lives in its own freehand pack.

       Pack stays pro:false so the CBN mechanic isn't paywalled —
       CBN is the app's most distinctive learning moment; hiding it
       behind Pro would undercut the "every kid can play the whole
       game" rule (see CLAUDE.md).

       ⚠ The seven new pages ship WITHOUT a `cbn` field for now —
       Onion is colouring each one and feeding the paired reference
       PNGs through scripts/process-cbn-page.py to auto-generate
       the palette + regions JSON. Until that lands they behave as
       freehand pages IN the CBN pack (they show up, tapping paints
       normally). Replace each entry's line with a full { cbn: {
       palette, regions } } block as references arrive. */
    {
        id: "cbn", label: "COLOR BY NUMBER", pro: false,
        pages: [
            /* cbn-sun keeps the hand-written zone-assign (proof-of-
               concept from Aug 9). The others wait on the pipeline. */
            {
                id:    "cbn-sun",
                name:  "SUNNY DAY 1-2-3",
                image: "assets/coloring-pages/free/sun.png",
                cbn: {
                    palette: ["#7ecfff", "#ff8b3d", "#f7d94c", "#8ac36b"],
                    assign: function (cx, cy) {
                        if (cy > 0.75) return 4;             /* grass */
                        if (cy < 0.30) return 1;             /* upper sky */
                        const d = Math.hypot(cx - 0.5, cy - 0.5);
                        if (d < 0.18) return 3;              /* sun body */
                        if (d < 0.32) return 2;              /* rays */
                        return 1;                             /* rest of sky */
                    }
                }
            },
            { id: "cbn-rainbow",  name: "RAINBOW",  image: "assets/coloring-pages/cbn/rainbow.png"  /* 9 regions;  TODO cbn */ },
            { id: "cbn-tulip",    name: "TULIP",    image: "assets/coloring-pages/cbn/tulip.png"    /* 11 regions; TODO cbn */ },
            { id: "cbn-pumpkin",  name: "PUMPKIN",  image: "assets/coloring-pages/cbn/pumpkin.png"  /* 14 regions; TODO cbn */ },
            { id: "cbn-snowman",  name: "SNOWMAN",  image: "assets/coloring-pages/cbn/snowman.png"  /* 14 regions; TODO cbn */ },
            { id: "cbn-cat",      name: "CAT",      image: "assets/coloring-pages/cbn/cat.png"      /* 15 regions; TODO cbn */ },
            { id: "cbn-cactus",   name: "CACTUS",   image: "assets/coloring-pages/cbn/cactus.png"   /* 17 regions; TODO cbn */ },
            { id: "cbn-donkey",   name: "DONKEY",   image: "assets/coloring-pages/cbn/donkey.png"   /* 22 regions; TODO cbn */ }
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
