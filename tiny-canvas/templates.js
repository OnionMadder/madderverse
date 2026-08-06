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
     art-src/coloring-pages/ (untracked working art, 2816x1536);
     assets/ holds the optimized 1800px-wide builds produced by
     the session scratchpad's process_pages.py pipeline
     (grayscale -> luminance-to-alpha LUT -> despeckle).

   - svg: inline SVG string (the original hand-drawn format —
     viewBox="0 0 800 800", currentColor strokes, no background).
     BLANK is the only remaining entry without art; the engine
     keeps full support for svg pages, see game.js.

   The picker auto-discovers this array; no other code change is
   needed to add a page. New raster pages MUST go through the
   audit in CLAUDE.md ("Auditing a page for fillable regions") —
   closedness can't be judged by eye.
   ============================================================ */

/* Page PACKS. The picker renders one section per pack (header rows
   appear once more than one section is visible). `pro: true` packs
   are the Unlocked upsell content: on web they always show (isPro is
   true there); on a locked native build the whole section simply
   does not render — no padlocks, no greyed cards, per the
   no-pressure rule.

   To add a page to a pro pack: drop the source scene into
   art-src/coloring-pages/<packdir>/, run
   scripts/process-coloring-pages.py (it mirrors subfolders into
   assets/ and audits fillable regions), then append the entry to the
   pack's `pages` below. An empty pack renders nothing anywhere. */

window.TINY_CANVAS_PAGE_PACKS = [
    {
        id: "starters", label: "STARTERS", pro: false,
        pages: [
            { id: "blank",     name: "BLANK",          svg: "" },
            { id: "cat",       name: "KITCHEN CAT",    image: "assets/coloring-pages/cat.png" },
            { id: "dog",       name: "PUPPY",          image: "assets/coloring-pages/dog.png" },
            { id: "unicorn",   name: "UNICORN",        image: "assets/coloring-pages/unicorn.png" },
            { id: "sun",       name: "SUNNY DAY",      image: "assets/coloring-pages/sun.png" },
            { id: "fish",      name: "BIG FISH",       image: "assets/coloring-pages/fish.png" },
            { id: "butterfly", name: "BUTTERFLY",      image: "assets/coloring-pages/butterfly.png" },
            { id: "bird",      name: "BIRD NEST",      image: "assets/coloring-pages/bird.png" },
            { id: "bear",      name: "TEDDY BEAR",     image: "assets/coloring-pages/bear.png" },
            { id: "rocket",    name: "ROCKET SHIP",    image: "assets/coloring-pages/rocket.png" },
            { id: "robot",     name: "ROBOT LAB",      image: "assets/coloring-pages/robot.png" },
            { id: "car",       name: "ROAD TRIP",      image: "assets/coloring-pages/car.png" },
            { id: "airplane",  name: "AIRPLANE",       image: "assets/coloring-pages/airplane.png" },
            { id: "donut",     name: "DONUT CHEST",    image: "assets/coloring-pages/donut.png" },
            { id: "cabin",     name: "COZY CABIN",     image: "assets/coloring-pages/cabin.png" }
        ]
    },
    {
        id: "ocean", label: "OCEAN", pro: true,
        pages: [
            /* Art in progress — entries land here as
               assets/coloring-pages/ocean/<id>.png ships. */
        ]
    },
    {
        id: "dinosaurs", label: "DINOSAURS", pro: true,
        pages: [
            /* Art in progress — entries land here as
               assets/coloring-pages/dinosaurs/<id>.png ships. */
        ]
    }
];

/* Flat view — the engine (loadTemplate, audits, tests) iterates this;
   the picker iterates the packs. Derived, never hand-edited. */
window.TINY_CANVAS_TEMPLATES = window.TINY_CANVAS_PAGE_PACKS.reduce(
    function (all, pack) { return all.concat(pack.pages); }, []);
