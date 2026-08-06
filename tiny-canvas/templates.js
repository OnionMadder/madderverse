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
     scripts/process-coloring-pages.py.

   - svg: inline SVG string (the original hand-drawn format).
     BLANK is the only remaining entry without art; the engine
     keeps full support for svg pages, see game.js.

   ------------------------------------------------------------
   PACKS (the 2026-08-05 rework, Onion's design):

   - EXTRAS (pro: false) — BLANK + four bonus one-off pages.
     Everyone gets these.
   - Eight themed CATEGORIES (pro: true) — six scenes each
     (ocean + dinosaurs currently five, sixths welcome). In each,
     exactly ONE page carries `free: true` — the category's free
     representative.

   The picker (buildPicker in game.js) renders:
   - unlocked (all of web, purchased native): every pack as its
     own headed section, all pages.
   - locked native: ONE flat headerless grid — the EXTRAS pages
     plus each category's `free` page. No locks, no greyed cards;
     the free app just looks complete.

   To add a page: drop the source scene into
   art-src/coloring-pages/<packdir>/, run
   scripts/process-coloring-pages.py (mirrors subfolders into
   assets/ and audits fillable regions — read its output), then
   append the entry to the pack below.
   ============================================================ */

window.TINY_CANVAS_PAGE_PACKS = [
    {
        id: "extras", label: "EXTRAS", pro: false,
        pages: [
            { id: "blank",   name: "BLANK",     svg: "" },
            { id: "beans",   name: "BEANS",     image: "assets/coloring-pages/beans.png" },
            { id: "monster", name: "MONSTER",   image: "assets/coloring-pages/monster.png" },
            { id: "robot",   name: "ROBOT LAB", image: "assets/coloring-pages/robot.png" },
            { id: "singing", name: "DOG CHOIR", image: "assets/coloring-pages/singing.png" }
        ]
    },
    {
        id: "basic", label: "BASIC", pro: true,
        pages: [
            { id: "sun",       name: "SUNNY DAY", image: "assets/coloring-pages/basic/sun.png", free: true },
            { id: "rainbow",   name: "RAINBOW",   image: "assets/coloring-pages/basic/rainbow.png" },
            { id: "snowflake", name: "SNOWFLAKE", image: "assets/coloring-pages/basic/snowflake.png" },
            { id: "leaf",      name: "LEAF",      image: "assets/coloring-pages/basic/leaf.png" },
            { id: "icecube",   name: "ICE CUBE",  image: "assets/coloring-pages/basic/icecube.png" },
            { id: "guitar",    name: "GUITAR",    image: "assets/coloring-pages/basic/guitar.png" }
        ]
    },
    {
        id: "animals", label: "ANIMALS", pro: true,
        pages: [
            { id: "cat",       name: "KITCHEN CAT", image: "assets/coloring-pages/animals/cat.png", free: true },
            { id: "dog",       name: "PUPPY",       image: "assets/coloring-pages/animals/dog.png" },
            { id: "unicorn",   name: "UNICORN",     image: "assets/coloring-pages/animals/unicorn.png" },
            { id: "butterfly", name: "BUTTERFLY",   image: "assets/coloring-pages/animals/butterfly.png" },
            { id: "bird",      name: "BIRD NEST",   image: "assets/coloring-pages/animals/bird.png" },
            { id: "lizard",    name: "IGUANA",      image: "assets/coloring-pages/animals/lizard.png" }
        ]
    },
    {
        id: "home", label: "HOME", pro: true,
        pages: [
            { id: "cabin",    name: "COZY CABIN", image: "assets/coloring-pages/home/cabin.png", free: true },
            { id: "bear",     name: "TEDDY BEAR", image: "assets/coloring-pages/home/bear.png" },
            { id: "kitchen",  name: "KITCHEN",    image: "assets/coloring-pages/home/kitchen.png" },
            { id: "den",      name: "PIANO ROOM", image: "assets/coloring-pages/home/den.png" },
            { id: "garage",   name: "GARAGE",     image: "assets/coloring-pages/home/garage.png" },
            { id: "backyard", name: "BACKYARD",   image: "assets/coloring-pages/home/backyard.png" }
        ]
    },
    {
        id: "food", label: "FOOD", pro: true,
        pages: [
            { id: "donut",     name: "DONUT",       image: "assets/coloring-pages/food/donut.png", free: true },
            { id: "cupcakes",  name: "CUPCAKES",    image: "assets/coloring-pages/food/cupcakes.png" },
            { id: "bananas",   name: "BANANAS",     image: "assets/coloring-pages/food/bananas.png" },
            { id: "breakfast", name: "BREAKFAST",   image: "assets/coloring-pages/food/breakfast.png" },
            { id: "curry",     name: "CURRY FEAST", image: "assets/coloring-pages/food/curry.png" },
            { id: "dinner",    name: "FISH DINNER", image: "assets/coloring-pages/food/dinner.png" }
        ]
    },
    {
        id: "transportation", label: "GO GO GO", pro: true,
        pages: [
            { id: "rocket",   name: "ROCKET SHIP", image: "assets/coloring-pages/transportation/rocket.png", free: true },
            { id: "car",      name: "ROAD TRIP",   image: "assets/coloring-pages/transportation/car.png" },
            { id: "truck",    name: "FIRE TRUCK",  image: "assets/coloring-pages/transportation/truck.png" },
            { id: "airplane", name: "AIRPLANE",    image: "assets/coloring-pages/transportation/airplane.png" },
            { id: "ship",     name: "CRUISE SHIP", image: "assets/coloring-pages/transportation/ship.png" },
            { id: "hover",    name: "HOVER CAR",   image: "assets/coloring-pages/transportation/hover.png" }
        ]
    },
    {
        id: "ocean", label: "OCEAN", pro: true,
        pages: [
            { id: "fish",      name: "BIG FISH",   image: "assets/coloring-pages/ocean/fish.png", free: true },
            { id: "shipwreck", name: "SHIPWRECK",  image: "assets/coloring-pages/ocean/shipwreck.png" },
            { id: "reef",      name: "CORAL REEF", image: "assets/coloring-pages/ocean/reef.png" },
            { id: "mermaids",  name: "MERMAIDS",   image: "assets/coloring-pages/ocean/mermaids.png" },
            { id: "atlantis",  name: "ATLANTIS",   image: "assets/coloring-pages/ocean/atlantis.png" }
        ]
    },
    {
        id: "dinosaurs", label: "DINOSAURS", pro: true,
        pages: [
            { id: "longneck",     name: "LONGNECK",     image: "assets/coloring-pages/dinosaurs/longneck.png", free: true },
            { id: "stego-family", name: "STEGO FAMILY", image: "assets/coloring-pages/dinosaurs/family.png" },
            { id: "trex",         name: "T-REX",        image: "assets/coloring-pages/dinosaurs/predator.png" },
            { id: "raptor",       name: "RAPTOR",       image: "assets/coloring-pages/dinosaurs/feathered.png" },
            { id: "dino-parade",  name: "DINO PARADE",  image: "assets/coloring-pages/dinosaurs/herd.png" }
        ]
    },
    {
        id: "places", label: "PLACES", pro: true,
        pages: [
            { id: "egypt",        name: "EGYPT",         image: "assets/coloring-pages/places/egypt.png", free: true },
            { id: "alaska",       name: "ALASKA",        image: "assets/coloring-pages/places/alaska.png" },
            { id: "brazil",       name: "BRAZIL",        image: "assets/coloring-pages/places/brazil.png" },
            { id: "cabo",         name: "CABO",          image: "assets/coloring-pages/places/cabo.png" },
            { id: "newhampshire", name: "NEW HAMPSHIRE", image: "assets/coloring-pages/places/newhampshire.png" },
            { id: "tamilnadu",    name: "TAMIL NADU",    image: "assets/coloring-pages/places/tamilnadu.png" }
        ]
    }
];

/* Flat view — the engine (loadTemplate, audits, tests) iterates this;
   the picker iterates the packs. Derived, never hand-edited. */
window.TINY_CANVAS_TEMPLATES = window.TINY_CANVAS_PAGE_PACKS.reduce(
    function (all, pack) { return all.concat(pack.pages); }, []);
