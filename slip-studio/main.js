/* ============================================================
   Slip Studio — scene + sculpting
   ------------------------------------------------------------
   Phase 0: render pipeline (renderer / camera / lights / loop).
   Phase 1: a lathe-turned pot on a slowly spinning wheel.
   Phase 2: touch-to-sculpt — grab the pot's edge and the
            silhouette follows your finger, clay-soft falloff.
   Phase 3: PBR clay + image-based lighting (procedural studio
            environment via PMREM); soft reflections, warm fill.

   Architecture notes for future phases:
   - The pot is a hand-built lathe surface: a (ROWS+1)×(COLS+1)
     vertex grid driven by `profile` (one editable radius per
     height row). Sculpting mutates `profile` and rewrites vertex
     positions in place — no per-frame geometry allocation. UVs
     are baked now so Phase 3 PBR maps map straight on. When we
     add freeform (non-radial) sculpting, this same grid moves to
     per-vertex displacement instead of a per-row radius.
   - `state` holds the long-lived objects so later phases reach
     them without re-walking the graph.
   - The pot + wheel live under `state.turntable`, the group that
     owns the meditative rotation. The pot spins while you sculpt;
     because the profile is radially symmetric, the band you pull
     forms a ring all the way around — shaping on a wheel.
   - Tone mapping + colour space are ACES/sRGB now so a real HDR
     environment + PBR maps drop in later without rework.
   ============================================================ */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const BG_COLOR    = 0x1b1815; // warm charcoal (matches CSS --bg)
const WHEEL_COLOR = 0x2d2a26; // dark stone
const SPIN_SPEED  = 0.3;      // radians / second — contemplative, not nervous

// --- View (dolly-zoom toward the pot + manual spin) -------------
const CAM_BASE    = new THREE.Vector3(0, 1.15, 4.1); // camera at zoom = 1
const CAM_TARGET  = new THREE.Vector3(0, 0.66, 0);
// Pulled-back framing for the assembled set view (lid on pot).
const CAM_ASSEMBLED_BASE   = new THREE.Vector3(0, 1.85, 5.6);
const CAM_ASSEMBLED_TARGET = new THREE.Vector3(0, 1.35, 0);
const ZOOM_MIN    = 1, ZOOM_MAX = 3.2;
const ROTATE_SENS = 0.009;    // radians of pot spin per px of drag

// --- Pot surface resolution + bounds ----------------------------
const ROWS = 160;   // height segments (vertical)
const COLS = 128;   // radial segments (around)
const TOP  = 1.40;  // pot height in world units; foot sits at y=0

// --- Sculpt feel ------------------------------------------------
const MIN_R    = 0.06; // clay can't pinch to nothing
const MAX_R    = 0.95; // belly may bulge this wide (wider than the wheel)
const GRAB_TOL = 0.26; // must start the drag this close to the surface
const STRENGTH = 0.20; // gentle: the clay lags the finger, for fine control

// Selectable brush sizes (vertical softness of the pull, world units).
// A fine brush lets you shape small features like a foot or a crisp
// rim; a broad one sweeps the whole belly.
const BRUSHES = [
    { label: "Fine",   sigma: 0.045 },
    { label: "Medium", sigma: 0.090 },
    { label: "Broad",  sigma: 0.160 },
];
const DEFAULT_BRUSH = 1;

// --- Physical limits of the wheel -------------------------------
// The foot that rests on the wheel can never be wider than the wheel
// head; the belly *above* it is free to bulge wider. So the allowed
// radius is a height-dependent envelope: capped to the foot zone near
// the base, opening up to MAX_R higher up.
const WHEEL_TOP_R = 0.72; // wheel head radius (the contact surface)
const BASE_MAX    = 0.66; // max foot radius — a margin inside the rim
const FOOT_TOP    = 0.10; // height of the base/foot contact zone
const FOOT_BLEND  = 0.14; // allowed width opens to MAX_R over this rise

// --- Clay material states ---------------------------------------
// The clay progresses wet → bone-dry (decorate) → fired. You can only
// throw (sculpt) wet clay; you decorate (pick a glaze) bone-dry.
// Colours here are tunable placeholders. clearcoat is kept slightly
// > 0 in every state so the shader define never toggles mid-tween (no
// recompile hitch).
// Bare-clay "looks" per phase. `bump` scales the procedural relief:
// wet reads smoother (water fills the tooth), bone-dry shows the most
// grain. `fired` is the bare (unglazed) fired earthenware look.
const CLAY_STATES = {
    wet:     { label: "Wet clay", color: 0xa3674a, roughness: 0.48, clearcoat: 0.40, clearcoatRoughness: 0.45, envMapIntensity: 0.85, bump: 0.03 },
    leather: { label: "Decorate", color: 0xb38566, roughness: 0.78, clearcoat: 0.18, clearcoatRoughness: 0.70, envMapIntensity: 0.55, bump: 0.05 },
    fired:   { label: "Fired",    color: 0xbf6a45, roughness: 0.60, clearcoat: 0.15, clearcoatRoughness: 0.70, envMapIntensity: 0.62, bump: 0.04 },
};
const INITIAL_STATE = "wet";

// Three-step arc: shape it wet → decorate the leather-hard clay
// (pick a glaze, paint, trim the foot in passing) → fire it. The
// previous bone-dry phase was just a transition with no unique role;
// it's been folded into leather so decorating + trim share a stage.
const PHASES = ["wet", "leather", "fired"];
const ADVANCE_LABEL = { wet: "Dry", leather: "Fire", fired: "New pot" };
const BACK_LABEL    = { leather: "&larr; Re-wet" };

// Glazes. `raw` is the chalky matte coat before firing; `fired` is the
// glossy vitrified result. Shared surface params, per-glaze colours.
// Optional 4th arg to glaze() overrides fired params (used for the
// metallics: gold / copper / platinum get high metalness; pearl gets
// extra clearcoat). The reveal is raw → fired on the glaze fire.
const GLAZE_RAW   = { roughness: 0.92, clearcoat: 0.03, clearcoatRoughness: 0.95, envMapIntensity: 0.32, bump: 0.012, metalness: 0.00 };
const GLAZE_FIRED = { roughness: 0.30, clearcoat: 0.72, clearcoatRoughness: 0.14, envMapIntensity: 0.85, bump: 0.004, metalness: 0.00 };
function glaze(name, rawHex, firedHex, firedOver) {
    return {
        name,
        raw:   { ...GLAZE_RAW,   color: rawHex },
        fired: { ...GLAZE_FIRED, color: firedHex, ...(firedOver || {}) },
    };
}
const GLAZES = {
    celadon:  glaze("Celadon",  0xb9c3b3, 0x7d9b7e),
    cobalt:   glaze("Cobalt",   0x9aa3b6, 0x37507e),
    oatmeal:  glaze("Oatmeal",  0xd8d2c4, 0xe7ddca),
    honey:    glaze("Honey",    0xc2a274, 0xb27a33),
    tenmoku:  glaze("Tenmoku",  0x6e6258, 0x2c2320),
    blush:    glaze("Blush",    0xd9c2c0, 0xc98a86),
    forest:   glaze("Forest",   0x9fb0a0, 0x3f5e4a),
    slate:    glaze("Slate",    0xb0b6bd, 0x4a5a68),
    plum:     glaze("Plum",     0xbcaebe, 0x6e4a6b),
    sand:     glaze("Sand",     0xd8cbb0, 0xc2a35e),
    gold:     glaze("Gold",     0xc9a575, 0xd9aa3f, { metalness: 0.72, roughness: 0.22, envMapIntensity: 1.20 }),
    copper:   glaze("Copper",   0xb2895c, 0xb35030, { metalness: 0.58, roughness: 0.30, envMapIntensity: 1.10 }),
    platinum: glaze("Platinum", 0xbcbcbc, 0xd5d5dc, { metalness: 0.75, roughness: 0.20, envMapIntensity: 1.25 }),
    ironred:  glaze("Iron red", 0xb87055, 0xa53a1f, { roughness: 0.42, envMapIntensity: 0.92 }),
    mint:     glaze("Mint",     0xc5ddcd, 0x84b899),
    pearl:    glaze("Pearl",    0xe8dfd2, 0xf2ead8, { clearcoat: 0.88, clearcoatRoughness: 0.08, envMapIntensity: 1.00 }),
};
const GLAZE_IDS = [
    "celadon", "cobalt", "oatmeal", "honey", "tenmoku",
    "blush", "forest", "slate", "plum", "sand",
    "gold", "copper", "platinum", "ironred", "mint", "pearl",
];

// --- Decoration -------------------------------------------------
// Painted onto the surface (over the glaze) by dragging on the pot.
// One unwrapped RGBA canvas wraps the pot via UVs; a shader overlays
// it on the clay. Brush = soft dab; splatter = scattered droplets.
const DECO_COLORS = [0xf4efe6, 0x2b2622, 0x37507e, 0x7d9b7e, 0xc98a3c, 0xc97f86, 0x6e4a6b, 0x4a5a68];
const DECO_W = 2048, DECO_H = 1024; // unwrapped surface (≈ circumference:height)
// Bump canvas. The procedural clay grain is rendered into it once at
// pot reset; the texture stays static for v2 (earlier prototypes of
// texture-stamp + carve tools were pulled — see the section comment
// where carving used to live). Same wrap as the deco layer; smaller
// because relief reads softer than colour.
const BUMP_W = 1024, BUMP_H = 512;
// Brush radii in canvas px (at zoom 1). The effective radius is divided
// by the zoom, so the brush keeps a constant on-screen size — zoom in
// for finer detail.
const DECO_SIZES = [{ label: "S", px: 30 }, { label: "M", px: 62 }, { label: "L", px: 108 }];
const DEFAULT_DECO_SIZE = 1;
const SPLATTER_DROPS = 9;

// Stamp shapes (tap/drag to place) and overlay patterns (one tap fills
// the whole surface). Both reuse the paint layer + current colour/size.
const STAMP_SHAPES = [
    { id: "dot",      glyph: "●" },
    { id: "ring",     glyph: "◯" },
    { id: "star",     glyph: "★" },
    { id: "spark",    glyph: "✦" },
    { id: "heart",    glyph: "♥" },
    { id: "flower",   glyph: "✿" },
    { id: "cross",    glyph: "✚" },
    { id: "triangle", glyph: "▲" },
    { id: "diamond",  glyph: "◆" },
    { id: "square",   glyph: "■" },
];
const OVERLAY_PATTERNS = [
    { id: "dots",     label: "Dots" },
    { id: "rings",    label: "Rings" },
    { id: "stripes",  label: "Stripes" },
    { id: "grid",     label: "Grid" },
    { id: "scatter",  label: "Scatter" },
    { id: "checker",  label: "Checker" },
    { id: "waves",    label: "Waves" },
    { id: "diagonal", label: "Diagonal" },
];


// --- Ambiance: backdrops + music --------------------------------
// Backdrops are CSS images behind the (transparent) canvas; chosen on
// the title screen and remembered. Music is one looping ambient track.
// Backdrops are tagged with a category so the title-screen picker can
// group them. Adding a new image = one entry here (drop the file at
// assets/backgrounds/<id>.jpg). The picker renders categories in the
// order they appear in BG_CATEGORIES.
const BG_CATEGORIES = ["Painted", "Botanical", "Earthy", "Abstract", "Architectural", "Motion"];
const BACKGROUNDS = [
    { id: "watercolor",     label: "Watercolor",    category: "Painted" },
    { id: "dried-flowers",  label: "Dried flowers", category: "Botanical" },
    { id: "shadow-flowers", label: "Shadow",        category: "Botanical" },
    { id: "clay-tunnel",    label: "Clay tunnel",   category: "Earthy" },
    { id: "cardboard",      label: "Cardboard",     category: "Earthy" },
    { id: "waves",          label: "Waves",         category: "Abstract" },
    { id: "abstract",       label: "Abstract",      category: "Abstract" },
    { id: "wireframe",      label: "Wireframe",     category: "Architectural" },
    { id: "balloons", label: "Balloons", category: "Motion", type: "video", src: "assets/backgrounds/motion/balloons.mp4" },
    { id: "birds",    label: "Birds",    category: "Motion", type: "video", src: "assets/backgrounds/motion/birds.mp4" },
    { id: "hearts",   label: "Hearts",   category: "Motion", type: "video", src: "assets/backgrounds/motion/hearts.mp4" },
];
const DEFAULT_BG = "watercolor";
// Multiple ambient tracks — initMusic picks one per session so it
// doesn't get repetitive across launches. Missing files fail silently
// (the Audio element errors and the rest of the app keeps working).
const MUSIC_TRACKS = [
    { src: "assets/audio/New Plan - Out To The World.mp3", label: "Out to the World" },
    { src: "assets/audio/ambient-2.mp3",                   label: "Track 2" },
    { src: "assets/audio/ambient-3.mp3",                   label: "Track 3" },
];

// --- Sound effects ----------------------------------------------
// Lazy-loaded ambient + one-shot clips. The wheel hum is looping and
// fades with the auto-spin; the rest are one-shots cloned per play so
// overlapping triggers don't restart the source. All paths are local
// — the user supplies the audio files (drop into assets/sfx/). A
// missing file fails silently; the rest of the app still works.
const SFX_SOURCES = {
    wheel:   { src: "assets/sfx/wheel-hum.mp3",    loop: true,  vol: 0.22 },
    squelch: { src: "assets/sfx/clay-squelch.mp3", loop: false, vol: 0.40, pitchVar: 0.18 },
    drip:    { src: "assets/sfx/water-drip.mp3",   loop: false, vol: 0.45, pitchVar: 0.10 },
    pour:    { src: "assets/sfx/glaze-pour.mp3",   loop: false, vol: 0.42 },
    kiln:    { src: "assets/sfx/kiln-fire.mp3",    loop: false, vol: 0.55 },
};

// --- Starter silhouettes ----------------------------------------
// Spline control points for the seed profile: (radius, height) in
// world units. All shapes terminate at y=TOP (1.40) so they fill the
// vertex grid without leaving degenerate rings above. The picker on
// the title screen exposes vase / bowl / cup / bottle; `lid` is used
// internally by the matched-set flow when you make a partner piece.
const SHAPES = {
    vase: {
        label: "Vase",
        controls: [
            [0.00, 0.00], [0.30, 0.00], [0.33, 0.06], [0.27, 0.16],
            [0.41, 0.34], [0.54, 0.58], [0.53, 0.74], [0.42, 0.92],
            [0.31, 1.08], [0.30, 1.20], [0.35, 1.32], [0.33, 1.40],
        ],
    },
    bowl: {
        label: "Bowl",
        controls: [
            [0.00, 0.00], [0.40, 0.00], [0.46, 0.06], [0.52, 0.18],
            [0.66, 0.40], [0.78, 0.70], [0.86, 1.00], [0.90, 1.25],
            [0.88, 1.40],
        ],
    },
    cup: {
        label: "Cup",
        controls: [
            [0.00, 0.00], [0.32, 0.00], [0.35, 0.08], [0.38, 0.30],
            [0.42, 0.60], [0.45, 0.90], [0.47, 1.15], [0.50, 1.32],
            [0.52, 1.40],
        ],
    },
    bottle: {
        label: "Bottle",
        controls: [
            [0.00, 0.00], [0.28, 0.00], [0.32, 0.08], [0.40, 0.20],
            [0.52, 0.40], [0.55, 0.55], [0.45, 0.72], [0.28, 0.85],
            [0.22, 1.00], [0.20, 1.18], [0.22, 1.32], [0.20, 1.40],
        ],
    },
};

// Lid silhouettes — keyed by style. Each entry generates control
// points scaled to a given rim radius. Lives up here (above init())
// so the picker can wire up at startup without TDZ errors.
// Each style now ENDS at a different y so the lid genuinely varies
// in height. Above the silhouette's end, the profile collapses to
// radius 0 — the rings stack at the axis and produce no visible
// geometry, so the lid actually looks short, medium, or tall.
const LID_STYLES = {
    flat: (k) => [
        [0.00,     0.00],
        [k,        0.00],
        [k,        0.08],   // base lip
        [k * 0.94, 0.14],
        [k * 0.86, 0.22],
        [k * 0.70, 0.30],
        [k * 0.46, 0.40],
        [k * 0.24, 0.50],   // small knob bulb
        [k * 0.14, 0.58],
        [0.00,     0.62],   // ends here — flat lid is short
        [0.00,     1.40],   // unused — collapsed to axis
    ],
    domed: (k) => [
        [0.00,     0.00],
        [k,        0.00],
        [k,        0.08],
        [k * 0.96, 0.14],
        [k * 0.88, 0.22],
        [k * 0.72, 0.34],
        [k * 0.50, 0.48],
        [k * 0.28, 0.60],
        [k * 0.16, 0.72],
        [k * 0.28, 0.84],   // knob bulb
        [k * 0.14, 0.94],
        [0.00,     1.00],   // medium-tall lid
        [0.00,     1.40],
    ],
    tall: (k) => [
        [0.00,     0.00],
        [k,        0.00],
        [k,        0.08],
        [k * 0.90, 0.14],
        [k * 0.62, 0.28],
        [k * 0.30, 0.44],
        [k * 0.16, 0.62],
        [k * 0.12, 0.80],
        [k * 0.12, 1.00],
        [k * 0.30, 1.12],   // prominent knob base
        [k * 0.36, 1.24],
        [k * 0.20, 1.34],
        [0.00,     1.40],   // tall — uses the full height
    ],
};
const LID_STYLE_IDS = ["flat", "domed", "tall"];

// Lids are now generated parametrically from the source pot's rim
// (see seedLidForRim) — no preset silhouette needed.
const SHAPE_IDS = ["vase", "bowl", "cup", "bottle"]; // picker order; lid is set-only
const DEFAULT_SHAPE = "vase";

const state = {
    renderer: null,
    scene: null,
    camera: null,
    canvas: null,
    turntable: null,
    pot: null,
    clayMaterial: null,
    clayState: INITIAL_STATE,   // a key of PHASES
    clayTarget: null,           // material params currently tweening toward
    glaze: null,                // chosen glaze id (once glazing), else null
    brushIndex: DEFAULT_BRUSH,  // index into BRUSHES
    spin: SPIN_SPEED,           // current angular speed (eases to 0 while busy)
    decoTool: "brush",          // brush | splatter | stamp | overlay
    decoColor: null,            // paint colour (hex), or null = painting off
    decoSizeIndex: DEFAULT_DECO_SIZE,
    stampShape: "dot",
    painting: false,
    decoCanvas: null, decoCtx: null, decoTex: null,
    // Editable bump layer: painted into by wet-clay texture stamps
    // (positive relief) and leather-hard carving (negative grooves).
    // Mixed additively with the procedural clay grain in the shader.
    bumpCanvas: null, bumpCtx: null, bumpTex: null,
    pendingSetId: null,                   // carried across save → reset for lid pairs
    isLid: false,                         // current piece is a lid (relaxes the foot envelope)
    savedPot: null,                       // paused pot state while user shapes a lid
    savedLid: null,                       // paused lid state while user edits the pot
    lidStyle: "domed",                    // flat | domed | tall — picked while shaping a lid
    lidMaxY: null,                        // y where the lid silhouette caps (set in seedLidForRim)
    partnerMesh: null,                    // second mesh, used for the fired-set assembly view
    partnerMaterial: null,
    partnerTarget: null,                  // material look the partner is tweening toward
    partnerDecoCanvas: null, partnerDecoCtx: null, partnerDecoTex: null,
    partnerBumpCanvas: null, partnerBumpCtx: null, partnerBumpTex: null,
    assemblyShown: false,                 // true while the fired set view is on
    firing: false,                        // true during the 1.2s firing sequence
    firingStart: 0,                       // performance.now() when firing began
    galleryView: (() => {
        try { return localStorage.getItem("slip-gallery-view") || "shelf"; }
        catch (_) { return "shelf"; }
    })(),
    photoStyle: "studio",                // studio | sunlit | museum
    photoAspect: "square",               // square | portrait
    bgCategory: null,                    // resolved by buildBgPicker
    zoom: 1,                    // 1 = default framing; up to ZOOM_MAX
    userRotating: false,        // manually spinning the pot
    background: DEFAULT_BG,
    musicOn: true,
    sfxOn: true,
    shape: (() => {
        try { const s = localStorage.getItem("slip-shape"); return s && SHAPES[s] ? s : DEFAULT_SHAPE; }
        catch (_) { return DEFAULT_SHAPE; }
    })(),
    clock: new THREE.Clock(),
};
let lastPaintUV = null;         // for continuous paint strokes
let music = null;               // looping ambient track

const targetColor = new THREE.Color(); // scratch for the material tween

// Editable silhouette: profile[r] = clay radius at height row r.
const profile = new Float32Array(ROWS + 1);
let profileDirty = false;

// Sculpt interaction scratch.
const raycaster = new THREE.Raycaster();
// Vertical plane through the spin axis, facing the camera. Pointer
// rays hit this to read a height (y) and a radius (|x|).
const axisPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint  = new THREE.Vector3();
let sculpting = false;

init();

function init() {
    const canvas = document.getElementById("scene");
    state.canvas = canvas;

    // --- Renderer -------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true, // transparent canvas — the CSS backdrop shows behind
        powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearAlpha(0);
    state.renderer = renderer;

    // --- Scene ----------------------------------------------------
    // No scene.background — the pot + wheel render over a transparent
    // canvas, with the chosen backdrop image behind it (CSS).
    const scene = new THREE.Scene();
    state.scene = scene;

    // --- Image-based lighting -------------------------------------
    // A procedural soft-studio environment (no external HDR file —
    // keeps the app fast + asset-free) gives the clay realistic
    // ambient + subtle reflections. Used for lighting only; the flat
    // charcoal background is kept for the calm, minimal look.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();

    // --- Camera ---------------------------------------------------
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    state.camera = camera;
    applyCamera(); // position from zoom + target

    buildLights(scene);

    // --- Turntable (pot + wheel spin together) --------------------
    const turntable = new THREE.Group();
    turntable.add(buildWheel());
    state.pot = buildPot();
    turntable.add(state.pot);
    scene.add(turntable);
    state.turntable = turntable;

    resize();
    window.addEventListener("resize", resize, { passive: true });
    bindSculpt(canvas);

    const advanceBtn = document.getElementById("advanceBtn");
    if (advanceBtn) advanceBtn.addEventListener("click", advanceStage);
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", stepBack);
    document.querySelectorAll(".brush-btn").forEach((b, idx) =>
        b.addEventListener("click", () => setBrush(idx)));
    setBrush(DEFAULT_BRUSH);
    buildGlazeBar();
    buildDecoBar();
    document.getElementById("toolBrush")?.addEventListener("click", () => setDecoTool("brush"));
    document.getElementById("toolSplatter")?.addEventListener("click", () => setDecoTool("splatter"));
    document.getElementById("toolStamp")?.addEventListener("click", () => setDecoTool("stamp"));
    document.getElementById("toolOverlay")?.addEventListener("click", () => setDecoTool("overlay"));
    document.getElementById("decoClear")?.addEventListener("click", clearDeco);
    document.getElementById("tabGlaze")?.addEventListener("click", () => setDecoTab("glaze"));
    document.getElementById("tabDecorate")?.addEventListener("click", () => setDecoTab("decorate"));
    document.getElementById("saveBtn")?.addEventListener("click", () => savePot());
    document.getElementById("photoBtn")?.addEventListener("click", () => openPhotoModal());
    document.getElementById("photoClose")?.addEventListener("click", closePhotoModal);
    document.getElementById("photoSave")?.addEventListener("click", finalizePhoto);
    document.querySelectorAll("#photoStyles .photo-chip").forEach((el) =>
        el.addEventListener("click", () => setPhotoStyle(el.dataset.style)));
    document.querySelectorAll("#photoAspects .photo-chip").forEach((el) =>
        el.addEventListener("click", () => setPhotoAspect(el.dataset.aspect)));
    document.getElementById("makeLidBtn")?.addEventListener("click", () => {
        makeLidPartner();
        updateToolbar();
    });
    document.getElementById("swapBtn")?.addEventListener("click", () => {
        swapActivePiece();
        updateToolbar();
    });
    document.getElementById("galleryBtn")?.addEventListener("click", () => openGallery());
    document.getElementById("galleryClose")?.addEventListener("click", closeGallery);
    document.getElementById("galleryViewToggle")?.addEventListener("click", () => {
        setGalleryView(state.galleryView === "shelf" ? "compact" : "shelf");
    });
    document.querySelectorAll(".deco-size").forEach((b, idx) =>
        b.addEventListener("click", () => setDecoSize(idx)));
    setDecoTool("brush");
    setDecoSize(DEFAULT_DECO_SIZE);
    setPhase(INITIAL_STATE); // sets the tween target + toolbar

    // First frame, then reveal the scene and start the loop.
    renderer.render(scene, camera);
    hideLoader();
    renderer.setAnimationLoop(tick);

    // Ambiance: backdrop + music. Restore saved choices.
    initMusic();
    buildShapePicker();
    buildBgPicker();
    buildLidStylePicker();
    let savedBg = DEFAULT_BG, savedMusic = true, savedSfx = true;
    try { savedBg = localStorage.getItem("slip-bg") || DEFAULT_BG; } catch (_) {}
    try { savedMusic = localStorage.getItem("slip-music") !== "0"; } catch (_) {}
    try { savedSfx = localStorage.getItem("slip-sfx") !== "0"; } catch (_) {}
    setBackground(BACKGROUNDS.some((b) => b.id === savedBg) ? savedBg : DEFAULT_BG);
    state.musicOn = savedMusic;
    state.sfxOn = savedSfx;
    updateMusicToggle();
    updateSfxToggle();
    document.getElementById("musicToggle")?.addEventListener("click", () => setMusic(!state.musicOn));
    document.getElementById("sfxToggle")?.addEventListener("click", () => setSfx(!state.sfxOn));
    document.getElementById("titleBtn")?.addEventListener("click", showLanding);

    // Title screen sits over the (already-spinning) studio until "Begin".
    const landing = document.getElementById("landing");
    if (landing) landing.hidden = false;
    document.getElementById("beginBtn")?.addEventListener("click", dismissLanding);
    document.getElementById("landingGallery")?.addEventListener("click", () => {
        dismissLanding();
        openGallery();
    });

    // Dev handle (inert unless the URL carries ?dev) — used to drive
    // and inspect the sculpt during testing across the build.
    if (location.search.includes("dev")) {
        window.__slip = {
            state, profile, radiusAt, sculptToward, trimToward, maxRadiusAt,
            setPhase, advanceStage, stepBack, setBrush, setGlaze, setShape, setLidStyle,
            startFiringMoment, endFiringMoment,
            bumpDab, resetBumpLayer,
            playSfx, stopSfx,
            setDecoColor, setDecoTool, setDecoSize, paintAt, clearDeco,
            setStampShape, stampAt, applyOverlay,
            setZoom, zoomBy, rotateBy,
            savePot, openPhotoModal, closePhotoModal, finalizePhoto,
            setPhotoStyle, setPhotoAspect,
            makeLidPartner, swapActivePiece, capturePieceState, restorePieceState,
            loadPot, openGallery, closeGallery,
            dbAll, dbDelete, dismissLanding,
            pause: () => state.renderer.setAnimationLoop(null),
            resume: () => state.renderer.setAnimationLoop(tick),
            redraw: () => {
                writeProfileToGeometry(state.pot.geometry);
                tickMaterial(10); // snap material to target (skip tween)
                state.renderer.render(state.scene, state.camera);
            },
        };
    }
}

function buildLights(scene) {
    // The environment map carries most of the fill now; a touch of
    // warm ambient just biases the shadows warm rather than neutral.
    const ambient = new THREE.AmbientLight(0xfff1e0, 0.15);
    scene.add(ambient);

    // Key: one warm directional light, casting the pot's shadow and
    // giving the clay its directional shaping over the soft IBL fill.
    const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
    key.position.set(2.6, 4.2, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4; // softness for PCFSoftShadowMap
    key.shadow.bias = -0.0005;

    const cam = key.shadow.camera;
    cam.near = 0.5;
    cam.far = 14;
    cam.left = -2.5;
    cam.right = 2.5;
    cam.top = 2.5;
    cam.bottom = -2.5;
    scene.add(key);
}

// A low cylindrical wheel/pedestal. Top surface sits at y=0 so the
// pot's foot rests on it; the pot casts its shadow here.
function buildWheel() {
    const height = 0.16;
    const geo = new THREE.CylinderGeometry(WHEEL_TOP_R, WHEEL_TOP_R + 0.04, height, 96);
    const mat = new THREE.MeshStandardMaterial({
        color: WHEEL_COLOR,
        roughness: 0.9,
        metalness: 0.0,
        envMapIntensity: 0.35, // matte stone — barely catches the room
    });
    const wheel = new THREE.Mesh(geo, mat);
    wheel.position.y = -height / 2; // top face flush with y=0
    wheel.receiveShadow = true;
    wheel.castShadow = true;
    return wheel;
}

// --- Procedural clay surface ------------------------------------
// A bump texture generated in code (no image asset): fine clay grain
// (wrapping value noise) plus gentle spiral throwing lines. Because it
// has angular variation, it also makes the wheel's rotation visible —
// the grain and lines sweep past the light as the pot turns. The
// canvas is editable (see paintProceduralClayGrain), so texture-stamps
// and carved grooves are drawn straight into this same surface.
function randGrid(n) {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return a;
}
function valueNoise(g, n, u, v) {
    const x = u * n, y = v * n;
    const x0 = Math.floor(x) % n, y0 = Math.floor(y) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * n + x0], b = g[y0 * n + x1];
    const c = g[y1 * n + x0], d = g[y1 * n + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function paintProceduralClayGrain(ctx) {
    const img = ctx.createImageData(BUMP_W, BUMP_H);
    const data = img.data;
    const g1 = randGrid(128), g2 = randGrid(48);
    for (let y = 0; y < BUMP_H; y++) {
        const v = y / BUMP_H;
        for (let x = 0; x < BUMP_W; x++) {
            const u = x / BUMP_W;
            const grain = valueNoise(g1, 128, u, v) * 0.6 +
                          valueNoise(g2, 48, u, v) * 0.4 - 0.5;
            const lines = Math.sin((v * 22 + u * 2) * Math.PI * 2); // u*2 = integer turns → seamless wrap
            const h = 0.5 + grain * 0.5 + lines * 0.16;
            const c = Math.max(0, Math.min(255, h * 255)) | 0;
            const i = (y * BUMP_W + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = c;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

// --- Decoration layer -------------------------------------------
// A transparent RGBA canvas that wraps the pot (u around, v height).
// Painting draws into it; a shader overlays it on the clay diffuse.
function makeDecoLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = DECO_W;
    canvas.height = DECO_H;
    state.decoCanvas = canvas;
    state.decoCtx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;        // wraps around the pot
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    state.decoTex = tex;
    return tex;
}

// --- Editable bump layer ----------------------------------------
// A paintable grayscale canvas that ADDS to the procedural clay
// grain in the bump shader. Neutral grey (0.5) = no change; brighter
// = raised relief (the wet-clay texture stamps press patterns INTO
// the soft clay); darker = carved groove (the leather-hard carve
// tool incises lines). Persists through firing.
// (Dimensions live up top with DECO_W so they're declared before init().)

// The bump canvas is BOTH the procedural clay grain (a fresh paint at
// the start of every pot) AND the surface that wet-clay stamps + carve
// grooves draw onto. There is only one bump texture; stamps/carves
// composite directly on top of the grain. That avoids juggling a
// separate paint layer with custom shader uniforms.
function makeBumpLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = BUMP_W;
    canvas.height = BUMP_H;
    state.bumpCanvas = canvas;
    state.bumpCtx = canvas.getContext("2d");
    resetBumpLayer(); // fill with the procedural clay grain
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;     // height data, not colour
    tex.wrapS = THREE.RepeatWrapping;        // wraps around the pot
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    state.bumpTex = tex;
    return tex;
}

function resetBumpLayer() {
    if (!state.bumpCtx) return;
    paintProceduralClayGrain(state.bumpCtx);
    if (state.bumpTex) state.bumpTex.needsUpdate = true;
}

// One circular dab into the bump layer. positive=true raises the
// surface (a pressed stamp); positive=false carves a groove. The dab
// is mostly flat-toned with a thin feathered edge — the sharp edge
// produces the strong screen-space derivative the bump shader needs
// to read as relief.
function bumpDab(cx, cy, positive, radius, alpha) {
    const ctx = state.bumpCtx;
    const tone = positive ? 255 : 0;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0,    `rgba(${tone},${tone},${tone},${alpha})`);
    g.addColorStop(0.78, `rgba(${tone},${tone},${tone},${alpha * 0.92})`);
    g.addColorStop(1,    `rgba(${tone},${tone},${tone},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
}

// Bump dab, mirrored across the u=0/1 seam so strokes wrap cleanly.
function bumpDabWrap(cx, cy, positive, radius, alpha) {
    bumpDab(cx, cy, positive, radius, alpha);
    if (cx < radius) bumpDab(cx + BUMP_W, cy, positive, radius, alpha);
    else if (cx > BUMP_W - radius) bumpDab(cx - BUMP_W, cy, positive, radius, alpha);
}

// (Carve tool removed 2026-06-10 — marks read as drawn stamps, not
// carved grooves. Leather-hard is Trim-only now.)

function rgba(hex, a) {
    return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
}

// One soft dab (radial falloff).
function dab(cx, cy, hex, radius, alpha) {
    const ctx = state.decoCtx;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, rgba(hex, alpha));
    g.addColorStop(0.55, rgba(hex, alpha * 0.9));
    g.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
}

// Dab, mirrored across the u=0/1 seam so strokes wrap cleanly.
function dabWrap(cx, cy, hex, radius, alpha) {
    dab(cx, cy, hex, radius, alpha);
    if (cx < radius) dab(cx + DECO_W, cy, hex, radius, alpha);
    else if (cx > DECO_W - radius) dab(cx - DECO_W, cy, hex, radius, alpha);
}

// Effective brush radius (canvas px): base size shrunk by the zoom so
// the brush stays a constant size on screen — zoom in for fine detail.
function decoRadius() {
    return Math.max(3, DECO_SIZES[state.decoSizeIndex].px / state.zoom);
}

// Paint the current tool at a UV coordinate.
function paintAt(u, v) {
    if (state.decoColor == null) return;
    const cx = u * DECO_W;
    const cy = (1 - v) * DECO_H; // v=0 (foot) → canvas bottom
    const size = decoRadius();
    if (state.decoTool === "splatter") {
        const spread = size * 2.2;
        for (let i = 0; i < SPLATTER_DROPS; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.random() * spread;
            const r = Math.max(2, size * (0.18 + Math.random() * 0.42));
            dabWrap(cx + Math.cos(a) * d, cy + Math.sin(a) * d, state.decoColor, r, 0.85);
        }
    } else {
        dabWrap(cx, cy, state.decoColor, size, 0.9);
    }
    state.decoTex.needsUpdate = true;
}

// A continuous stroke between two UVs (skip if it crossed the seam).
function paintStroke(au, av, bu, bv) {
    if (Math.abs(bu - au) > 0.5) { paintAt(bu, bv); return; }
    const dist = Math.hypot((bu - au) * DECO_W, (bv - av) * DECO_H);
    const steps = Math.max(1, Math.floor(dist / (decoRadius() * 0.4)));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        paintAt(au + (bu - au) * t, av + (bv - av) * t);
    }
}

function clearDeco() {
    if (!state.decoCtx) return;
    state.decoCtx.clearRect(0, 0, DECO_W, DECO_H);
    state.decoTex.needsUpdate = true;
}

// --- Stamps -----------------------------------------------------
function starPath(ctx, r, points = 5) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const fn = i === 0 ? "moveTo" : "lineTo";
        ctx[fn](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
}
function heartPath(ctx, r) {
    const s = r / 16;
    ctx.beginPath();
    ctx.moveTo(0, 6 * s);
    ctx.bezierCurveTo(0, 1 * s, -8 * s, -6 * s, -13 * s, -1 * s);
    ctx.bezierCurveTo(-18 * s, 5 * s, -8 * s, 12 * s, 0, 17 * s);
    ctx.bezierCurveTo(8 * s, 12 * s, 18 * s, 5 * s, 13 * s, -1 * s);
    ctx.bezierCurveTo(8 * s, -6 * s, 0, 1 * s, 0, 6 * s);
    ctx.closePath();
}
function drawStamp(cx, cy, r, shape, hex) {
    const ctx = state.decoCtx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = rgba(hex, 0.95);
    ctx.strokeStyle = rgba(hex, 0.95);
    if (shape === "dot") {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    } else if (shape === "ring") {
        ctx.lineWidth = r * 0.34; ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.stroke();
    } else if (shape === "star") {
        starPath(ctx, r); ctx.fill();
    } else if (shape === "spark") {
        starPath(ctx, r, 4); ctx.fill();
    } else if (shape === "triangle") {
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.92, r * 0.7);
        ctx.lineTo(-r * 0.92, r * 0.7);
        ctx.closePath(); ctx.fill();
    } else if (shape === "diamond") {
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0);
        ctx.closePath(); ctx.fill();
    } else if (shape === "square") {
        ctx.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
    } else if (shape === "heart") {
        heartPath(ctx, r); ctx.fill();
    } else if (shape === "flower") {
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
    } else if (shape === "cross") {
        const w = r * 0.5, l = r * 1.7;
        ctx.fillRect(-w / 2, -l / 2, w, l);
        ctx.fillRect(-l / 2, -w / 2, l, w);
    }
    ctx.restore();
}
function stampAt(u, v) {
    if (state.decoColor == null) return;
    const r = decoRadius() * 1.25;
    const cx = u * DECO_W, cy = (1 - v) * DECO_H;
    drawStamp(cx, cy, r, state.stampShape, state.decoColor);
    if (cx < r * 2) drawStamp(cx + DECO_W, cy, r, state.stampShape, state.decoColor);
    else if (cx > DECO_W - r * 2) drawStamp(cx - DECO_W, cy, r, state.stampShape, state.decoColor);
    state.decoTex.needsUpdate = true;
}

// --- Overlays (one tap fills the whole surface) -----------------
function applyOverlay(id) {
    if (state.decoColor == null) return;
    const ctx = state.decoCtx, hex = state.decoColor;
    const cell = DECO_SIZES[state.decoSizeIndex].px * 2.4;
    ctx.save();
    ctx.fillStyle = rgba(hex, 0.85);
    if (id === "dots") {
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols;
        const rows = Math.max(3, Math.round(DECO_H / cw)), rh = DECO_H / rows, dr = cw * 0.22;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            let x = c * cw + cw * 0.5 + (r % 2 ? cw * 0.5 : 0);
            if (x > DECO_W) x -= DECO_W;
            const y = r * rh + rh * 0.5;
            ctx.beginPath(); ctx.arc(x, y, dr, 0, Math.PI * 2); ctx.fill();
            if (x < dr * 2) { ctx.beginPath(); ctx.arc(x + DECO_W, y, dr, 0, Math.PI * 2); ctx.fill(); }
        }
    } else if (id === "rings") {
        const rows = Math.max(3, Math.round(DECO_H / cell)), rh = DECO_H / rows, sh = rh * 0.32;
        for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rh + (rh - sh) / 2, DECO_W, sh);
    } else if (id === "stripes") {
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols, sw = cw * 0.4;
        for (let c = 0; c < cols; c++) ctx.fillRect(c * cw, 0, sw, DECO_H);
    } else if (id === "grid") {
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols, lw = Math.max(2, cw * 0.08);
        const rows = Math.max(3, Math.round(DECO_H / cw)), rh = DECO_H / rows;
        for (let c = 0; c < cols; c++) ctx.fillRect(c * cw, 0, lw, DECO_H);
        for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rh, DECO_W, lw);
    } else if (id === "scatter") {
        const n = Math.round((DECO_W * DECO_H) / (cell * cell * 1.4));
        for (let i = 0; i < n; i++) {
            const x = Math.random() * DECO_W, y = Math.random() * DECO_H;
            const dr = DECO_SIZES[state.decoSizeIndex].px * (0.12 + Math.random() * 0.28);
            ctx.beginPath(); ctx.arc(x, y, dr, 0, Math.PI * 2); ctx.fill();
        }
    } else if (id === "checker") {
        let cols = Math.max(4, Math.round(DECO_W / cell));
        if (cols % 2) cols++; // even cols → parity wraps seamlessly at the u-seam
        const cw = DECO_W / cols;
        const rows = Math.max(4, Math.round(DECO_H / cw)), rh = DECO_H / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if ((r + c) % 2 === 0) ctx.fillRect(c * cw, r * rh, cw + 1, rh + 1);
        }
    } else if (id === "waves") {
        const rows = Math.max(3, Math.round(DECO_H / cell)), rh = DECO_H / rows;
        const amp = rh * 0.28, lw = Math.max(3, rh * 0.12);
        const N = 256; // even segments; last point lands exactly on DECO_W
        ctx.strokeStyle = rgba(hex, 0.85);
        ctx.lineWidth = lw;
        for (let r = 0; r < rows; r++) {
            const y = r * rh + rh * 0.5;
            ctx.beginPath();
            for (let i = 0; i <= N; i++) {
                const x = (i / N) * DECO_W;
                // 8 full cycles across the width → value matches at x=0 and x=DECO_W
                const yy = y + Math.sin((x / DECO_W) * Math.PI * 8) * amp;
                i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
            }
            ctx.stroke();
        }
    } else if (id === "diagonal") {
        // Sheared vertical stripes: integer columns wrap in u, and the
        // per-row x-shift (with wrap) makes it read diagonal but seamless.
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols, sw = cw * 0.45;
        const slice = 3;
        for (let y = 0; y < DECO_H; y += slice) {
            const shift = y % DECO_W; // 45°: 1px of x per 1px of y
            for (let c = 0; c < cols; c++) {
                const x = (c * cw + shift) % DECO_W;
                ctx.fillRect(x, y, sw, slice + 1);
                if (x > DECO_W - sw) ctx.fillRect(x - DECO_W, y, sw, slice + 1); // wrap overflow
            }
        }
    }
    ctx.restore();
    state.decoTex.needsUpdate = true;
}

// Dispatch a pot-touch to the active decorate tool.
function decoApplyAt(u, v) {
    if (state.decoTool === "stamp") stampAt(u, v);
    else paintAt(u, v); // brush / splatter
}

// Raycast a pointer onto the pot and return the surface UV (or null).
function pointerToUV(ev) {
    const rect = state.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, state.camera);
    const hits = raycaster.intersectObject(state.pot, false);
    return hits.length && hits[0].uv ? hits[0].uv : null;
}

// Build the editable lathe pot: seed the profile, then build a
// vertex grid we can rewrite in place as the profile changes.
function buildPot() {
    seedProfile();

    const vCount = (ROWS + 1) * (COLS + 1);
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const uvs = new Float32Array(vCount * 2);
    const indices = [];

    for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c <= COLS; c++) {
            const v = r * (COLS + 1) + c;
            uvs[v * 2]     = c / COLS;
            uvs[v * 2 + 1] = r / ROWS;
        }
    }
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const a = r * (COLS + 1) + c;
            const b = a + (COLS + 1);
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    // Clay surface. MeshPhysicalMaterial so the wet sheen (a subtle
    // clearcoat) and a future glaze pass both work. Initialised from
    // the starting state; material-state changes tween its props.
    // The bump canvas is shared: procedural clay grain + texture
    // stamps + carve grooves are all painted into the SAME canvas, so
    // we don't have to wrangle a custom sampler uniform.
    const s0 = CLAY_STATES[INITIAL_STATE];
    const bumpTex = makeBumpLayer();
    const mat = new THREE.MeshPhysicalMaterial({
        color: s0.color,
        roughness: s0.roughness,
        metalness: 0.0,
        clearcoat: s0.clearcoat,
        clearcoatRoughness: s0.clearcoatRoughness,
        envMapIntensity: s0.envMapIntensity,
        bumpMap: bumpTex,               // clay grain + throwing lines + edits
        bumpScale: s0.bump,
        side: THREE.DoubleSide,         // open vase — render the inner wall too
    });
    state.clayMaterial = mat;

    // Overlay the painted decoration layer on the clay diffuse colour.
    // (sRGB → linear via pow(2.2) before mixing into linear space.)
    const decoTex = makeDecoLayer();
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.decoMap = { value: decoTex };
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "varying vec2 vDecoUv;\n#include <common>")
            .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vDecoUv = uv;");
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "uniform sampler2D decoMap;\nvarying vec2 vDecoUv;\n#include <common>")
            .replace(
                "#include <map_fragment>",
                "#include <map_fragment>\n  vec4 _deco = texture2D( decoMap, vDecoUv );\n  diffuseColor.rgb = mix( diffuseColor.rgb, pow( _deco.rgb, vec3( 2.2 ) ), _deco.a );",
            );
    };
    mat.customProgramCacheKey = () => "clay-deco-v1";

    const pot = new THREE.Mesh(geo, mat);
    pot.castShadow = true;
    pot.receiveShadow = true;
    writeProfileToGeometry(pot.geometry);
    return pot;
}

// Seed `profile` from one of the starter silhouettes (see SHAPES).
// Control points are run through a spline (C1-continuous) so the
// surface reads smooth, not faceted, then resampled to one radius per
// evenly-spaced height row.
function seedProfile(shapeId) {
    const id = SHAPES[shapeId] ? shapeId : (SHAPES[state.shape] ? state.shape : DEFAULT_SHAPE);
    applyControlsToProfile(SHAPES[id].controls);
}

// Resample a [x, y] control-points array through a spline into the
// per-row profile array. Shared by seedProfile (preset silhouettes)
// and seedLidForRim (parametric lid generation).
function applyControlsToProfile(controls) {
    const ctrl = controls.map(([x, y]) => new THREE.Vector2(x, y));
    const curve = new THREE.SplineCurve(ctrl).getPoints(600);
    let j = 0;
    for (let r = 0; r <= ROWS; r++) {
        const y = (r / ROWS) * TOP;
        while (j < curve.length - 2 && curve[j + 1].y < y) j++;
        const a = curve[j];
        const b = curve[j + 1];
        const span = b.y - a.y;
        const t = span > 1e-6 ? THREE.MathUtils.clamp((y - a.y) / span, 0, 1) : 0;
        profile[r] = a.x + (b.x - a.x) * t;
    }
    clampProfile(); // seed must obey the (possibly relaxed) envelope
}

// Generate a lid silhouette whose base radius matches the source
// pot's rim exactly, so the two pieces visibly fit together. Style
// picks the dome + knob proportions — Flat is a shallow disc-like
// lid, Domed is a graceful default, Tall is steep with a prominent
// finial. Picked from state.lidStyle when not passed explicitly.
function seedLidForRim(rimR, style) {
    rimR = Math.max(MIN_R, Math.min(MAX_R, rimR));
    const id = (LID_STYLES[style] ? style : state.lidStyle) || "domed";
    const controls = LID_STYLES[id](rimR);
    state.lidMaxY = lidCapY(controls);
    applyControlsToProfile(controls);
}

// Find the y at which the lid's silhouette first closes to the axis
// (the first control point with x≈0 after a non-zero one). Above this
// y, the lid is just collapsed rings -- sculpting there would regrow
// the silhouette, which is what we want to prevent.
function lidCapY(controls) {
    let lastX = 0;
    for (const [x, y] of controls) {
        if (lastX > 0.001 && x < 0.001) return y;
        lastX = x;
    }
    return TOP; // never closes — use full height
}

// Rewrite vertex positions + normals from the current profile.
// Normals are ANALYTIC (derived from the profile slope) rather than
// face-averaged: a surface of revolution has an exact normal, which
// is smooth around each ring (no radial facet banding) and identical
// at angle 0 and 2π (no lighting seam where the lathe wraps). Cheap
// enough to call on every sculpting frame.
function writeProfileToGeometry(geo) {
    writeProfileArrayToGeometry(geo, profile);
}
function writeProfileArrayToGeometry(geo, prof) {
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const dyStep = TOP / ROWS;
    // Find the highest contiguous tail of zero-radius rings at the top
    // of the profile (lid silhouettes collapse to the axis above the
    // dome). All those rings will share the cap row's y so the
    // triangles between them have zero area in every dimension —
    // otherwise they'd render as a thin needle along the y axis.
    const EPS = 0.001;
    let firstCollapse = ROWS + 1;
    for (let r = ROWS; r >= 0; r--) {
        if (prof[r] < EPS) firstCollapse = r; else break;
    }
    const capY = firstCollapse <= ROWS ? firstCollapse * dyStep : ROWS * dyStep;
    for (let r = 0; r <= ROWS; r++) {
        const y = (r < firstCollapse) ? r * dyStep : capY;
        const rad = prof[r] < EPS ? 0 : prof[r];

        // 2D outward normal in the (radius, height) plane, from the
        // local profile slope. Central difference inside, one-sided
        // at the ends.
        let dr, dy;
        if (r === 0)         { dr = prof[1] - prof[0];           dy = dyStep; }
        else if (r === ROWS) { dr = prof[ROWS] - prof[ROWS - 1]; dy = dyStep; }
        else                 { dr = prof[r + 1] - prof[r - 1];   dy = 2 * dyStep; }
        let n2x = dy;
        let n2y = -dr;
        const len = Math.hypot(n2x, n2y) || 1;
        n2x /= len;
        n2y /= len;
        const cap = r === 0; // degenerate ring at the axis → faces down

        for (let c = 0; c <= COLS; c++) {
            const theta = (c / COLS) * Math.PI * 2;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const i = (r * (COLS + 1) + c) * 3;
            pos[i]     = rad * cos;
            pos[i + 1] = y;
            pos[i + 2] = rad * sin;
            if (cap) {
                nor[i] = 0; nor[i + 1] = -1; nor[i + 2] = 0;
            } else {
                nor[i] = n2x * cos; nor[i + 1] = n2y; nor[i + 2] = n2x * sin;
            }
        }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
}

function radiusAt(y) {
    const f = THREE.MathUtils.clamp((y / TOP) * ROWS, 0, ROWS);
    const lo = Math.floor(f);
    const hi = Math.min(lo + 1, ROWS);
    return THREE.MathUtils.lerp(profile[lo], profile[hi], f - lo);
}

// The widest the clay may be at height `y`: capped to the wheel near
// the foot, opening up to MAX_R above it. This is the physical wheel
// constraint — the contact base can't overhang the wheel head.
function maxRadiusAt(y) {
    // Above a lid's cap, the silhouette is supposed to be the axis —
    // any radius leaking up there (from a Gaussian sculpt) gets
    // clamped back to 0 via clampProfile.
    if (state.isLid && state.lidMaxY != null && y > state.lidMaxY) return 0;
    // A lid sits on the pot, not on the wheel — the foot can be as
    // wide as MAX_R. A regular pot's foot is capped to the wheel head
    // so the contact base can't overhang.
    const baseMax = state.isLid ? MAX_R : BASE_MAX;
    if (y <= FOOT_TOP) return baseMax;
    const t = THREE.MathUtils.clamp((y - FOOT_TOP) / FOOT_BLEND, 0, 1);
    return THREE.MathUtils.lerp(baseMax, MAX_R, t);
}

// Enforce the envelope across the whole profile.
function clampProfile() {
    for (let r = 0; r <= ROWS; r++) {
        const y = (r / ROWS) * TOP;
        const m = maxRadiusAt(y);
        if (profile[r] > m) profile[r] = m;
    }
    profile[0] = 0; // keep the bottom capped at the axis
}

// Leather-hard trimming: a finer sculpt that ONLY affects the foot
// zone, and ONLY cuts inward (you can't bulge a leather-hard foot).
// Real potters trim with a loop tool to clean up the foot ring — this
// is the digital equivalent.
const TRIM_MAX_Y    = FOOT_TOP * 1.9;  // trim only acts below this height
const TRIM_STRENGTH = 0.28;            // a touch firmer than wet sculpting
function trimToward(y, targetR) {
    if (y > TRIM_MAX_Y) return;
    const currentR = radiusAt(y);
    if (targetR >= currentR) return;   // trim only carves inward
    targetR = THREE.MathUtils.clamp(targetR, MIN_R, MAX_R);
    const centerRow = (y / TOP) * ROWS;
    const sigma = BRUSHES[state.brushIndex].sigma * 0.55; // narrower than throw
    const sigmaRows = (sigma / TOP) * ROWS;
    const reach = Math.ceil(sigmaRows * 3);
    const lo = Math.max(1, Math.floor(centerRow - reach));
    const hi = Math.min(ROWS, Math.ceil(centerRow + reach));
    for (let r = lo; r <= hi; r++) {
        // Stay inside the foot envelope — never pull rows above TRIM_MAX_Y.
        const rowY = (r / ROWS) * TOP;
        if (rowY > TRIM_MAX_Y) continue;
        const d = (r - centerRow) / sigmaRows;
        const w = Math.exp(-0.5 * d * d) * TRIM_STRENGTH;
        profile[r] = THREE.MathUtils.lerp(profile[r], targetR, w);
    }
    clampProfile();
    profileDirty = true;
}

// Pull the silhouette toward `targetR` around height `y`, with a
// Gaussian vertical falloff so the clay bulges instead of stepping.
function sculptToward(y, targetR) {
    // For lids, refuse sculpting above the cap — neither the touch
    // point nor the falloff loop should touch collapsed rings.
    if (state.isLid && state.lidMaxY != null && y > state.lidMaxY) return;
    targetR = THREE.MathUtils.clamp(targetR, MIN_R, MAX_R);
    const centerRow = (y / TOP) * ROWS;
    const sigmaRows = (BRUSHES[state.brushIndex].sigma / TOP) * ROWS;
    const reach = Math.ceil(sigmaRows * 3);
    const lo = Math.max(1, Math.floor(centerRow - reach));
    const hi = Math.min(ROWS, Math.ceil(centerRow + reach));
    for (let r = lo; r <= hi; r++) {
        if (state.isLid && state.lidMaxY != null && (r / ROWS) * TOP > state.lidMaxY) continue;
        const d = (r - centerRow) / sigmaRows;
        const w = Math.exp(-0.5 * d * d) * STRENGTH;
        profile[r] = THREE.MathUtils.lerp(profile[r], targetR, w);
    }
    clampProfile(); // the foot can't pull wider than the wheel
    profileDirty = true;
}

// --- Material states (wet → bone-dry/decorate → fired) ----------

// The material look for the current phase. A chosen glaze shows as a
// matte raw coat at the leather-hard / decorate stage, then glossy
// once fired; with no glaze it's bare clay (and plain fired
// earthenware).
function currentLook() {
    const cs = state.clayState;
    if (cs === "fired")   return state.glaze ? GLAZES[state.glaze].fired : CLAY_STATES.fired;
    if (cs === "leather") return state.glaze ? GLAZES[state.glaze].raw   : CLAY_STATES.leather;
    return CLAY_STATES.wet;
}

// Enter a phase: point the material tween at its look, refresh the UI.
function setPhase(name) {
    state.clayState = name;
    state.clayTarget = currentLook();
    // Show or hide the assembled lid-on-pot view: only at Fired, only
    // when a partner is paused in memory.
    const hasPartner = !!(state.savedPot || state.savedLid);
    if (name === "fired" && hasPartner) {
        showAssemblyView();
    } else if (state.assemblyShown) {
        hideAssemblyView();
    }
    updateToolbar();
}

// The forward control: dry → fire → new pot.
function advanceStage() {
    switch (state.clayState) {
        case "wet":     setPhase("leather"); break; // firms to leather-hard, ready to decorate
        case "leather":
            setPhase("fired");
            playSfx("kiln");
            startFiringMoment();
            // The partner's clayState stays "leather" through the kiln
            // animation so it enters the view at its raw-glaze look
            // and tweens to fired alongside the active piece;
            // endFiringMoment flips it to "fired" when the sequence
            // wraps up.
            break;
        case "fired":   resetPot();          break;
    }
}

// The cinematic kiln sequence: ~4.5 s of close → fire → cool → open.
// The kiln-vignette overlay (dark edge + warm inner glow) takes over
// the frame; the backdrop fades to near-black; the auto-spin stops
// (state.firing in the busy flag); the material tween slows so the
// glaze visibly melts raw → fired; the music ducks; the kiln SFX
// plays alongside. Tick() drives the per-frame interpolation.
const FIRING_DURATION = 4.5;
const FIRING_MUSIC_DUCK = 0.38; // multiplier on saved music volume during firing

function startFiringMoment() {
    state.firing = true;
    state.firingStart = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const v = document.getElementById("kilnVignette");
    if (v) {
        v.style.opacity = "0";   // tick() will ramp it up
        const edge = v.querySelector(".kiln-edge");
        const glow = v.querySelector(".kiln-inner-glow");
        if (edge) edge.style.opacity = "0";
        if (glow) glow.style.opacity = "0";
    }
    // Save current music volume so we can restore on exit.
    if (music && !music.paused) {
        state._musicSavedVol = music.volume;
    } else {
        state._musicSavedVol = null;
    }
}

function endFiringMoment() {
    state.firing = false;
    const v = document.getElementById("kilnVignette");
    if (v) {
        v.style.opacity = "0";
        const glow = v.querySelector(".kiln-inner-glow");
        if (glow) glow.style.opacity = "0";
    }
    const bd = document.getElementById("backdrop");
    if (bd) bd.style.opacity = "1";
    if (music && state._musicSavedVol != null) music.volume = state._musicSavedVol;
    state._musicSavedVol = null;
    // The partner finished firing alongside the active piece — keep
    // its saved clayState consistent so later swap/save logic works.
    if (state.savedPot) state.savedPot.clayState = "fired";
    if (state.savedLid) state.savedLid.clayState = "fired";
}

// 0..1 ease for smooth-in/out transitions inside the firing phases.
function smoothstep(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
}

// Decorate: pick a glaze on the bone-dry pot (tap the active one again
// to clear it and fire bare).
function setGlaze(id) {
    if (!GLAZES[id]) return;
    const wasActive = state.glaze === id;
    state.glaze = wasActive ? null : id;
    if (!wasActive) playSfx("pour"); // soft pour when a glaze is selected
    if (state.clayState === "leather") setPhase("leather"); // refresh the raw look
    updateGlazeBar();
}

// Step back one phase to keep editing. The ends are commitments: wet
// (start) and fired. The glaze choice is kept across a re-wet.
function stepBack() {
    const cs = state.clayState;
    if (cs === "wet" || cs === "fired") return;
    const next = PHASES[PHASES.indexOf(cs) - 1];
    setPhase(next);
    if (next === "wet") playSfx("drip");
    updateGlazeBar();
}

// Start a fresh wet pot.
function resetPot() {
    state.isLid = false; // back to regular pot rules — wheel constrains the foot
    state.lidMaxY = null;
    state.savedPot = null;
    state.savedLid = null;
    seedProfile();
    profileDirty = true;
    state.glaze = null;
    clearDeco();
    resetBumpLayer();
    setPhase(INITIAL_STATE);
    updateGlazeBar();
}

// Choose which silhouette new pots seed from. Persists to localStorage.
// Resets the live pot too, so the choice is immediately visible.
function setShape(id) {
    if (!SHAPES[id]) return;
    state.shape = id;
    try { localStorage.setItem("slip-shape", id); } catch (_) {}
    updateShapePicker();
    resetPot();
}

function updateShapePicker() {
    const wrap = document.getElementById("shapePicker");
    if (!wrap) return;
    Array.from(wrap.children).forEach((el, i) => {
        el.classList.toggle("is-active", SHAPE_IDS[i] === state.shape);
    });
}

// Build a tiny SVG silhouette of a shape from its spline control points,
// so the picker icon matches exactly what the seeded pot will look like.
function shapeIconSVG(shapeId) {
    const sh = SHAPES[shapeId];
    if (!sh) return "";
    const pts = sh.controls;
    const VW = 60, VH = 70, CX = 30, SY = 48, SX = 28, MY = 4;
    const left  = pts.map(([r, y]) => `${(CX - r * SX).toFixed(1)},${(VH - MY - y * SY).toFixed(1)}`);
    const right = [...pts].reverse().map(([r, y]) => `${(CX + r * SX).toFixed(1)},${(VH - MY - y * SY).toFixed(1)}`);
    const d = `M${left.join(" L")} L${right.join(" L")} Z`;
    return `<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="currentColor"/></svg>`;
}

function buildShapePicker() {
    const wrap = document.getElementById("shapePicker");
    if (!wrap) return;
    wrap.innerHTML = "";
    SHAPE_IDS.forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "shape-swatch";
        b.innerHTML = shapeIconSVG(id) + `<span>${SHAPES[id].label}</span>`;
        b.setAttribute("aria-label", SHAPES[id].label + " starter shape");
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => setShape(id));
        wrap.appendChild(b);
    });
    updateShapePicker();
}

// Choose a brush size; reflect the active one in the brush bar.
function setBrush(i) {
    state.brushIndex = THREE.MathUtils.clamp(i, 0, BRUSHES.length - 1);
    document.querySelectorAll(".brush-btn").forEach((b, idx) => {
        const on = idx === state.brushIndex;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

// Ease the material toward the current state's look each frame, so
// stage changes read as a calm transition rather than a hard cut.
// During the firing sequence the time constant slows ~7x so the user
// actually watches the glaze melt raw → fired instead of snapping.
function tickMaterial(dt) {
    const m = state.clayMaterial;
    const t = state.clayTarget;
    if (!m || !t) return;
    const rate = state.firing ? 0.8 : 5; // tau = 1/rate seconds
    const k = 1 - Math.exp(-dt * rate);
    targetColor.setHex(t.color);
    m.color.lerp(targetColor, k);
    m.roughness          += (t.roughness          - m.roughness)          * k;
    m.clearcoat          += (t.clearcoat          - m.clearcoat)          * k;
    m.clearcoatRoughness += (t.clearcoatRoughness - m.clearcoatRoughness) * k;
    m.envMapIntensity    += (t.envMapIntensity    - m.envMapIntensity)    * k;
    m.bumpScale          += (t.bump               - m.bumpScale)          * k;
    m.metalness          += ((t.metalness != null ? t.metalness : 0) - m.metalness) * k;
}

// The stage label, including the glaze name once chosen.
function stageLabelText() {
    const cs = state.clayState;
    if (cs === "fired")   return state.glaze ? GLAZES[state.glaze].name + " glaze" : "Fired";
    if (cs === "leather") return state.glaze ? GLAZES[state.glaze].name + " · raw" : CLAY_STATES.leather.label;
    return CLAY_STATES.wet.label;
}

// Reflect the current phase in the UI: stage label, advance button,
// back button (hidden at the ends), the brush bar (wet sculpting +
// leather-hard trimming), and the glaze palette (only while bone-dry
// / decorating).
function updateToolbar() {
    const cs = state.clayState;
    const label = document.getElementById("stageLabel");
    const advance = document.getElementById("advanceBtn");
    const back = document.getElementById("backBtn");
    const brushBar = document.getElementById("brushBar");
    const decoStack = document.getElementById("decoStack");
    if (label) label.textContent = stageLabelText();
    if (advance) advance.textContent = ADVANCE_LABEL[cs];
    if (back) {
        back.hidden = cs === "wet" || cs === "fired";
        if (!back.hidden) back.innerHTML = BACK_LABEL[cs] || "&larr; Back";
    }
    const saveBtn    = document.getElementById("saveBtn");
    const photoBtn   = document.getElementById("photoBtn");
    const makeLidBtn = document.getElementById("makeLidBtn");
    const swapBtn    = document.getElementById("swapBtn");
    const hasPartner = !!(state.savedPot || state.savedLid);
    const lidStylePicker = document.getElementById("lidStylePicker");
    // The brush bar is for wet sculpting only. Trim at leather reuses
    // whatever brush size you set in wet — no UI here so the
    // decorate panel doesn't get crowded with controls.
    if (brushBar) brushBar.hidden = cs !== "wet";
    if (decoStack) decoStack.hidden = cs !== "leather";
    if (lidStylePicker) lidStylePicker.hidden = !(state.isLid && cs === "wet");
    if (saveBtn) {
        saveBtn.hidden = cs !== "fired";
        saveBtn.textContent = hasPartner ? "Save set" : "Save";
    }
    if (photoBtn) photoBtn.hidden = cs !== "fired";
    // Make lid: only at decorate, only if you don't already have a partner.
    if (makeLidBtn) makeLidBtn.hidden = !(cs === "leather" && !hasPartner && !state.isLid);
    // Swap: visible while a partner is paused — but NOT at fired,
    // where the assembled view already shows both pieces together.
    if (swapBtn) {
        swapBtn.hidden = !hasPartner || cs === "fired";
        swapBtn.textContent = state.isLid ? "↻ Pot" : "↻ Lid";
    }
    if (cs === "leather") updateDecoSub();   // contextual sub-palette
}

// Build the glaze palette once (swatches coloured by each glaze's
// fired result — what you'll get).
function buildGlazeBar() {
    const bar = document.getElementById("glazeBar");
    if (!bar) return;
    GLAZE_IDS.forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "glaze-btn";
        b.style.background = "#" + new THREE.Color(GLAZES[id].fired.color).getHexString();
        b.setAttribute("aria-label", GLAZES[id].name + " glaze");
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => setGlaze(id));
        bar.appendChild(b);
    });
}

// Mark the active glaze swatch.
function updateGlazeBar() {
    const bar = document.getElementById("glazeBar");
    if (!bar) return;
    Array.from(bar.children).forEach((b, i) => {
        const on = GLAZE_IDS[i] === state.glaze;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

// --- Decoration UI ----------------------------------------------
function setDecoTool(name) {
    state.decoTool = name;
    [["toolBrush", "brush"], ["toolSplatter", "splatter"],
     ["toolStamp", "stamp"], ["toolOverlay", "overlay"]].forEach(([id, t]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const on = name === t;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    updateDecoSub();
}

// Switch the tray between the Glaze and Decorate panels.
function setDecoTab(name) {
    const glaze = name === "glaze";
    const pG = document.getElementById("panelGlaze");
    const pD = document.getElementById("panelDecorate");
    const tG = document.getElementById("tabGlaze");
    const tD = document.getElementById("tabDecorate");
    if (pG) pG.hidden = !glaze;
    if (pD) pD.hidden = glaze;
    if (tG) { tG.classList.toggle("is-active", glaze); tG.setAttribute("aria-selected", glaze ? "true" : "false"); }
    if (tD) { tD.classList.toggle("is-active", !glaze); tD.setAttribute("aria-selected", !glaze ? "true" : "false"); }
}

// Pick which stamp shape to place.
function setStampShape(id) {
    state.stampShape = id;
    updateDecoSub();
}

// Build the contextual sub-palette: stamp shapes, or overlay patterns,
// or nothing (brush/splatter).
function updateDecoSub() {
    const sub = document.getElementById("decoSub");
    if (!sub) return;
    if (state.decoTool === "stamp") {
        sub.hidden = false;
        sub.innerHTML = "";
        STAMP_SHAPES.forEach((sh) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "deco-sub-btn";
            b.textContent = sh.glyph;
            b.setAttribute("aria-label", sh.id + " stamp");
            b.classList.toggle("is-active", sh.id === state.stampShape);
            b.addEventListener("click", () => setStampShape(sh.id));
            sub.appendChild(b);
        });
    } else if (state.decoTool === "overlay") {
        sub.hidden = false;
        sub.innerHTML = "";
        OVERLAY_PATTERNS.forEach((p) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "deco-sub-btn deco-sub-text";
            b.textContent = p.label;
            b.setAttribute("aria-label", p.label + " overlay");
            b.addEventListener("click", () => applyOverlay(p.id));
            sub.appendChild(b);
        });
    } else {
        sub.hidden = true;
        sub.innerHTML = "";
    }
}

// Pick a brush size (S/M/L).
function setDecoSize(i) {
    state.decoSizeIndex = THREE.MathUtils.clamp(i, 0, DECO_SIZES.length - 1);
    document.querySelectorAll(".deco-size").forEach((b, idx) => {
        const on = idx === state.decoSizeIndex;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

// Pick a paint colour (tap the active one again to stop painting).
function setDecoColor(hex) {
    state.decoColor = state.decoColor === hex ? null : hex;
    updateDecoSwatches();
}

function buildDecoBar() {
    const wrap = document.getElementById("decoColors");
    if (!wrap) return;
    DECO_COLORS.forEach((hex) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "deco-swatch";
        b.style.background = "#" + hex.toString(16).padStart(6, "0");
        b.setAttribute("aria-label", "Paint colour");
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => setDecoColor(hex));
        wrap.appendChild(b);
    });
}

function updateDecoSwatches() {
    const wrap = document.getElementById("decoColors");
    if (!wrap) return;
    Array.from(wrap.children).forEach((b, i) => {
        const on = DECO_COLORS[i] === state.decoColor;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

// --- Pointer: tools + view gestures -----------------------------
// One finger = the active tool (sculpt wet / paint bone-dry), or a
// drag-to-spin when there's no tool (fired). Two fingers = view
// control: pinch to zoom, drag to spin. Any zoom pauses the auto-spin.
const pointers = new Map(); // active pointerId -> {x, y}
let pinchPrevDist = 0;      // last two-finger distance (px)
let viewPrevX = 0;          // last drag x for manual spin (px)

function bindSculpt(canvas) {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
}

// --- View control -----------------------------------------------
function applyCamera() {
    const base   = state.assemblyShown ? CAM_ASSEMBLED_BASE   : CAM_BASE;
    const target = state.assemblyShown ? CAM_ASSEMBLED_TARGET : CAM_TARGET;
    const f = 1 / state.zoom; // higher zoom → camera closer to the target
    state.camera.position.set(
        target.x + (base.x - target.x) * f,
        target.y + (base.y - target.y) * f,
        target.z + (base.z - target.z) * f,
    );
    state.camera.lookAt(target);
}
function setZoom(z) {
    state.zoom = THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX);
    applyCamera();
}
function zoomBy(factor) { setZoom(state.zoom * factor); }
function rotateBy(rad) { state.turntable.rotation.y += rad; }

function onWheel(ev) {
    ev.preventDefault();
    zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
}

// Map a pointer event onto the axis plane → {y: height, r: radius}.
function pointerToProfile(ev) {
    const rect = state.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, state.camera);
    if (!raycaster.ray.intersectPlane(axisPlane, hitPoint)) return null;
    return { y: hitPoint.y, r: Math.abs(hitPoint.x) };
}

function onPointerDown(ev) {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size >= 2) {
        // Two fingers → view gesture; abandon any in-progress stroke.
        sculpting = false;
        state.painting = false;
        lastPaintUV = null;
        state.userRotating = true;
        const [a, b] = [...pointers.values()];
        pinchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
        viewPrevX = (a.x + b.x) / 2;
        ev.preventDefault();
        return;
    }

    if (state.clayState === "wet") {
        const p = pointerToProfile(ev);
        if (!p) return;
        if (p.y < -0.05 || p.y > TOP + 0.15) return;
        if (Math.abs(p.r - radiusAt(p.y)) > GRAB_TOL) return;
        sculpting = true;
        sculptToward(p.y, p.r);
        maybeSquelch();
        ev.preventDefault();
    } else if (state.clayState === "leather") {
        // Two actions live here. A silhouette grab in the foot zone
        // is a trim (constrained inward sculpt). Anything else, when
        // a paint colour is selected, is a brush/splatter/stamp tap.
        const p = pointerToProfile(ev);
        const inFoot = p && p.y >= -0.05 && p.y <= TRIM_MAX_Y
                    && Math.abs(p.r - radiusAt(p.y)) <= GRAB_TOL;
        if (inFoot) {
            sculpting = true;
            trimToward(p.y, p.r);
            maybeSquelch();
            ev.preventDefault();
            return;
        }
        if (state.decoColor != null && state.decoTool !== "overlay") {
            state.painting = true;
            const uv = pointerToUV(ev);
            if (uv) { decoApplyAt(uv.x, uv.y); lastPaintUV = { x: uv.x, y: uv.y }; }
            else lastPaintUV = null;
            ev.preventDefault();
            return;
        }
        // No tool engaged — fall through to spin.
        state.userRotating = true;
        viewPrevX = ev.clientX;
        ev.preventDefault();
    } else {
        // No tool here (e.g. fired) → drag to spin and inspect.
        state.userRotating = true;
        viewPrevX = ev.clientX;
        ev.preventDefault();
    }
}

function onPointerMove(ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size >= 2) {
        // Pinch → zoom, centroid drift → manual spin.
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchPrevDist > 0) zoomBy(dist / pinchPrevDist);
        pinchPrevDist = dist;
        const cx = (a.x + b.x) / 2;
        rotateBy((cx - viewPrevX) * ROTATE_SENS);
        viewPrevX = cx;
        ev.preventDefault();
        return;
    }

    if (sculpting) {
        const p = pointerToProfile(ev);
        if (p) {
            if (state.clayState === "leather") trimToward(p.y, p.r);
            else sculptToward(p.y, p.r);
            maybeSquelch();
        }
        ev.preventDefault();
    } else if (state.painting) {
        const uv = pointerToUV(ev);
        if (uv) {
            if (state.decoTool === "stamp") {
                // Place spaced stamps along the drag.
                const moved = !lastPaintUV ? Infinity : Math.hypot(
                    (uv.x - lastPaintUV.x) * DECO_W, (uv.y - lastPaintUV.y) * DECO_H);
                if (moved > decoRadius() * 1.8) { stampAt(uv.x, uv.y); lastPaintUV = { x: uv.x, y: uv.y }; }
            } else {
                if (lastPaintUV) paintStroke(lastPaintUV.x, lastPaintUV.y, uv.x, uv.y);
                else paintAt(uv.x, uv.y);
                lastPaintUV = { x: uv.x, y: uv.y };
            }
        } else {
            lastPaintUV = null;
        }
        ev.preventDefault();
    } else if (state.userRotating) {
        rotateBy((ev.clientX - viewPrevX) * ROTATE_SENS);
        viewPrevX = ev.clientX;
        ev.preventDefault();
    }
}

function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchPrevDist = 0;
    if (pointers.size === 0) {
        sculpting = false;
        state.painting = false;
        state.userRotating = false;
        lastPaintUV = null;
    } else {
        // Dropped from two fingers to one — stop spinning to avoid a jump.
        state.userRotating = false;
    }
}

// --- Persistence + gallery (local, IndexedDB) -------------------
const DB_NAME = "slip-studio", DB_STORE = "pots";

function openDB() {
    return new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE, { keyPath: "id" });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function dbPut(entry) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(entry);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}
async function dbAll() {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const rq = tx.objectStore(DB_STORE).getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
    });
}
async function dbDelete(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

// A square thumbnail of the pot. Rendered into an offscreen render
// target and read back with readRenderTargetPixels — reliable on every
// device (unlike toDataURL on the live canvas, which returns blank on
// some mobile GPUs). Framed square at the default (zoom-1) view.
function captureThumb(size = 320) {
    tickMaterial(10); // snap the glaze to its final look (skip the tween)
    const cam = state.camera;
    const prevAspect = cam.aspect;
    const prevPos = cam.position.clone();
    // Each saved entry is one piece — frame the active mesh alone
    // even if the live view is the assembled set.
    const prevPartnerVisible = state.partnerMesh && state.partnerMesh.visible;
    if (prevPartnerVisible) state.partnerMesh.visible = false;
    const prevPotY = state.pot.position.y;
    state.pot.position.y = 0;
    cam.aspect = 1;
    cam.position.copy(CAM_BASE);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(size, size);
    state.renderer.setRenderTarget(rt);
    state.renderer.setClearColor(BG_COLOR, 1); // opaque warm bg for the thumb
    state.renderer.clear();
    state.renderer.render(state.scene, cam);
    const buf = new Uint8Array(size * size * 4);
    state.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    state.renderer.setRenderTarget(null);
    state.renderer.setClearAlpha(0); // back to transparent for the live canvas
    rt.dispose();

    // restore everything
    cam.aspect = prevAspect;
    cam.position.copy(prevPos);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();
    state.pot.position.y = prevPotY;
    if (prevPartnerVisible) state.partnerMesh.visible = true;
    // (rest of the function returns the thumb data URL below)

    // GL pixels are bottom-up; flip into a 2D canvas, then encode.
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.85);
}

// Capture the assembled lid-on-pot view as a square thumbnail. Used
// once at save time so the gallery's set tile can show a single
// "set complete" image rather than two stacked halves. Only valid
// when state.assemblyShown is true (both meshes are positioned).
function captureAssemblyThumb(size = 360) {
    if (!state.assemblyShown) return null;
    tickMaterial(10);
    const cam = state.camera;
    const prevAspect = cam.aspect;
    const prevPos = cam.position.clone();
    cam.aspect = 1;
    cam.position.copy(CAM_ASSEMBLED_BASE);
    cam.lookAt(CAM_ASSEMBLED_TARGET);
    cam.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(size, size);
    state.renderer.setRenderTarget(rt);
    state.renderer.setClearColor(BG_COLOR, 1);
    state.renderer.clear();
    state.renderer.render(state.scene, cam);
    const buf = new Uint8Array(size * size * 4);
    state.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    state.renderer.setRenderTarget(null);
    state.renderer.setClearAlpha(0);
    rt.dispose();

    cam.aspect = prevAspect;
    cam.position.copy(prevPos);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();

    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.86);
}

// --- Photo modal ------------------------------------------------
// The Photo button opens a modal with a live preview, 3 framing
// styles (Studio shelf / Sunlit window / Museum plinth), and a 1:1 /
// 9:16 aspect toggle. The pot is rendered once via the GL pipeline on
// modal open; toggling style/aspect just re-composites the 2D layer
// over that cached pot, so the preview updates instantly.

// Render the fired pot to a 1024×1024 transparent canvas (no backdrop).
// Reused for both preview and final save.
function captureScenePot(size) {
    size = size || 1024;
    tickMaterial(10); // snap the glaze to its fired look
    const cam = state.camera;
    const prevAspect = cam.aspect;
    const prevPos = cam.position.clone();
    // In set mode, frame the assembly (lid on pot); otherwise just the piece.
    const base   = state.assemblyShown ? CAM_ASSEMBLED_BASE   : CAM_BASE;
    const target = state.assemblyShown ? CAM_ASSEMBLED_TARGET : CAM_TARGET;
    cam.aspect = 1;
    cam.position.copy(base);
    cam.lookAt(target);
    cam.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(size, size);
    state.renderer.setRenderTarget(rt);
    state.renderer.setClearAlpha(0);
    state.renderer.clear();
    state.renderer.render(state.scene, cam);
    const buf = new Uint8Array(size * size * 4);
    state.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    state.renderer.setRenderTarget(null);
    rt.dispose();

    cam.aspect = prevAspect;
    cam.position.copy(prevPos);
    cam.lookAt(target);
    cam.updateProjectionMatrix();

    // GL pixels are bottom-up — flip into a 2D canvas.
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

async function loadBackdropImage() {
    return new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = `assets/backgrounds/${state.background}.jpg`;
    });
}

// Compose the chosen style + aspect into target canvas.
function composeStyledPhoto(potCanvas, bgImage, style, aspect, target) {
    const isPortrait = aspect === "portrait";
    const W = 1024;
    const H = isPortrait ? 1820 : 1024;
    target.width = W;
    target.height = H;
    const ctx = target.getContext("2d");

    // 1) Backdrop, cover-fit
    if (bgImage) {
        const r = Math.max(W / bgImage.width, H / bgImage.height);
        const w = bgImage.width * r, h = bgImage.height * r;
        const x = (W - w) / 2, y = (H - h) / 2;
        ctx.drawImage(bgImage, x, y, w, h);
    } else {
        ctx.fillStyle = "#1b1815";
        ctx.fillRect(0, 0, W, H);
    }

    // 2) Style decorations (under the pot)
    const baseY = isPortrait ? H * 0.62 : H * 0.66;
    if (style === "studio") {
        // Subtle shelf line + soft cast shadow
        ctx.fillStyle = "rgba(60, 40, 30, 0.20)";
        ctx.fillRect(0, baseY + 8, W, 4);
        const sh = ctx.createRadialGradient(W / 2, baseY + 30, 40, W / 2, baseY + 30, W * 0.42);
        sh.addColorStop(0, "rgba(0,0,0,0.42)");
        sh.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(0, baseY - 30, W, 130);
    } else if (style === "sunlit") {
        // Warm sun gradient from upper-right
        const sun = ctx.createRadialGradient(W * 0.82, H * 0.18, 0, W * 0.82, H * 0.18, W * 0.95);
        sun.addColorStop(0,    "rgba(255, 196, 110, 0.45)");
        sun.addColorStop(0.45, "rgba(255, 156,  80, 0.18)");
        sun.addColorStop(1,    "rgba(255, 156,  80, 0.00)");
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, W, H);
        // Long lower-left shadow
        const sh = ctx.createRadialGradient(W * 0.42, baseY + 30, 30, W * 0.42, baseY + 30, W * 0.5);
        sh.addColorStop(0, "rgba(0,0,0,0.50)");
        sh.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(0, baseY - 20, W, 130);
    } else if (style === "museum") {
        // Muted backdrop tint
        ctx.fillStyle = "rgba(20, 18, 16, 0.34)";
        ctx.fillRect(0, 0, W, H);
        // Plinth beneath the pot
        const plinthY = baseY + 60;
        const plinthH = isPortrait ? 220 : 180;
        const grad = ctx.createLinearGradient(0, plinthY, 0, plinthY + plinthH);
        grad.addColorStop(0, "rgba(34, 28, 22, 0.92)");
        grad.addColorStop(1, "rgba(14, 11,  9, 0.94)");
        ctx.fillStyle = grad;
        ctx.fillRect(W * 0.22, plinthY, W * 0.56, plinthH);
        // Caption strip
        const stripH = isPortrait ? 120 : 90;
        const stripY = H - stripH;
        ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
        ctx.fillRect(0, stripY, W, stripH);
        ctx.fillStyle = "rgba(243, 237, 230, 0.85)";
        ctx.font = `${isPortrait ? 26 : 20}px Quicksand, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const glaze = (state.glaze && GLAZES[state.glaze])
            ? GLAZES[state.glaze].name : "Bare clay";
        ctx.fillText(`SLIP STUDIO · ${glaze.toUpperCase()}`, W / 2, stripY + stripH / 2);
    }

    // 3) Pot render — square pot fills full width, vertically anchored.
    const potY = isPortrait ? Math.floor((H - W) * 0.42) : 0;
    ctx.drawImage(potCanvas, 0, potY, W, W);

    return target;
}

let photoPotCache = null;
let photoBgCache = null;

async function openPhotoModal() {
    photoPotCache = captureScenePot(1024);
    photoBgCache = await loadBackdropImage();
    syncPhotoChips();
    renderPhotoPreview();
    document.getElementById("photoModal").hidden = false;
}

function closePhotoModal() {
    document.getElementById("photoModal").hidden = true;
    photoPotCache = null;
    photoBgCache = null;
}

function renderPhotoPreview() {
    const preview = document.getElementById("photoPreview");
    if (!preview || !photoPotCache) return;
    composeStyledPhoto(photoPotCache, photoBgCache, state.photoStyle, state.photoAspect, preview);
}

function setPhotoStyle(name) {
    if (!["studio", "sunlit", "museum"].includes(name)) return;
    state.photoStyle = name;
    syncPhotoChips();
    renderPhotoPreview();
}

function setPhotoAspect(name) {
    state.photoAspect = name === "portrait" ? "portrait" : "square";
    syncPhotoChips();
    renderPhotoPreview();
}

function syncPhotoChips() {
    document.querySelectorAll("#photoStyles .photo-chip").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.style === state.photoStyle);
    });
    document.querySelectorAll("#photoAspects .photo-chip").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.aspect === state.photoAspect);
    });
}

async function finalizePhoto() {
    if (!photoPotCache) return;
    const out = document.createElement("canvas");
    composeStyledPhoto(photoPotCache, photoBgCache, state.photoStyle, state.photoAspect, out);
    const filename = `slip-studio-${Date.now().toString(36)}.png`;
    const blob = await new Promise((res) => out.toBlob(res, "image/png"));
    try {
        if (blob && navigator.canShare) {
            const file = new File([blob], filename, { type: "image/png" });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: "Slip Studio pot" });
                flashPhotoSave();
                return;
            }
        }
    } catch (_) { /* user cancelled or share blocked — fall through to download */ }
    const url = blob ? URL.createObjectURL(blob) : out.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    try { a.remove(); } catch (_) {}
    if (blob) setTimeout(() => URL.revokeObjectURL(url), 5000);
    flashPhotoSave();
}

function flashPhotoSave() {
    const b = document.getElementById("photoSave");
    if (!b) return;
    const prev = b.textContent;
    b.textContent = "Saved ✓";
    setTimeout(() => { b.textContent = prev; }, 1300);
}

async function savePot() {
    // If a partner is paused in memory, generate a shared set id so
    // both pieces save together. The active piece is written first
    // using the live canvases; the partner is restored briefly so its
    // thumb captures the right look, then the active piece is put back.
    const partner = state.savedPot || state.savedLid;
    let setId = state.pendingSetId || null;
    if (partner && !setId) {
        setId = "set-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    }
    // For sets, capture the assembled lid-on-pot thumb FIRST while
    // both meshes are still in their assembly positions. Both saved
    // entries share this thumb so the gallery shows the set together.
    const assemblyThumb = partner ? captureAssemblyThumb() : null;
    const entry = {
        id: Date.now().toString(36),
        ts: Date.now(),
        profile: Array.from(profile, (x) => +x.toFixed(4)),
        glaze: state.glaze,
        deco: state.decoCanvas.toDataURL("image/png"),
        bump: state.bumpCanvas.toDataURL("image/png"),
        thumb: captureThumb(),
        setId,
        title: null, // user can name from the gallery
        isLid: state.isLid,
        assemblyThumb,
    };
    try {
        await dbPut(entry);
        flashSaved();
        state.pendingSetId = null;

        if (partner) {
            // Swap in the partner, save it under the same set id, then
            // swap back to the original so the view doesn't lurch.
            const active = capturePieceState();
            restorePieceState(partner);
            // Force material to settle into the fired look before thumb.
            tickMaterial(10);
            const partnerEntry = {
                id: (Date.now() + 1).toString(36),
                ts: Date.now() + 1,
                profile: Array.from(profile, (x) => +x.toFixed(4)),
                glaze: state.glaze,
                deco: state.decoCanvas.toDataURL("image/png"),
                bump: state.bumpCanvas.toDataURL("image/png"),
                thumb: captureThumb(),
                setId,
                title: null,
                isLid: state.isLid,
                assemblyThumb, // same shared shot
            };
            await dbPut(partnerEntry);
            restorePieceState(active);
            tickMaterial(10);
            state.savedPot = null;
            state.savedLid = null;
        }
    } catch (e) {
        console.warn("save failed", e);
    }
}

// "Make a lid" — save the current fired pot under a fresh set id, then
// reset to a new lid-shaped wet pot that will carry the same set id on
// its eventual save. Saved pots that share a set id render as a pair
// in the gallery.
// Snapshot the live piece's full editable state (profile, glaze, deco
// canvas, bump canvas, lid flag, current phase) into a plain object
// so we can swap it in/out of memory while the user shapes a partner.
function capturePieceState() {
    const decoCopy = document.createElement("canvas");
    decoCopy.width = DECO_W;
    decoCopy.height = DECO_H;
    decoCopy.getContext("2d").drawImage(state.decoCanvas, 0, 0);
    const bumpCopy = document.createElement("canvas");
    bumpCopy.width = BUMP_W;
    bumpCopy.height = BUMP_H;
    bumpCopy.getContext("2d").drawImage(state.bumpCanvas, 0, 0);
    return {
        profile: Float32Array.from(profile),
        glaze: state.glaze,
        decoCanvas: decoCopy,
        bumpCanvas: bumpCopy,
        isLid: state.isLid,
        clayState: state.clayState,
    };
}

// Inverse of capturePieceState — write a paused piece back into the
// live editable state. Phase is set last so the toolbar refreshes
// against the fully-restored state.
function restorePieceState(saved) {
    for (let i = 0; i < saved.profile.length; i++) profile[i] = saved.profile[i];
    profileDirty = true;
    state.glaze = saved.glaze;
    state.isLid = saved.isLid;
    state.decoCtx.clearRect(0, 0, DECO_W, DECO_H);
    state.decoCtx.drawImage(saved.decoCanvas, 0, 0);
    state.decoTex.needsUpdate = true;
    state.bumpCtx.clearRect(0, 0, BUMP_W, BUMP_H);
    state.bumpCtx.drawImage(saved.bumpCanvas, 0, 0);
    state.bumpTex.needsUpdate = true;
    setPhase(saved.clayState);
    updateGlazeBar();
}

// --- Partner mesh (used for the fired-set assembly view) -------
// A second pot mesh that shares the geometry topology of state.pot
// but has its own deco / bump canvases + material. Built lazily on
// first set-fire; reused thereafter.
function buildPartnerMesh() {
    if (state.partnerMesh) return state.partnerMesh;

    const vCount = (ROWS + 1) * (COLS + 1);
    const positions = new Float32Array(vCount * 3);
    const normals = new Float32Array(vCount * 3);
    const uvs = new Float32Array(vCount * 2);
    const indices = [];
    for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c <= COLS; c++) {
            const v = r * (COLS + 1) + c;
            uvs[v * 2]     = c / COLS;
            uvs[v * 2 + 1] = r / ROWS;
        }
    }
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const a = r * (COLS + 1) + c;
            const b = a + (COLS + 1);
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal",   new THREE.BufferAttribute(normals,   3));
    geo.setAttribute("uv",       new THREE.BufferAttribute(uvs,       2));
    geo.setIndex(indices);

    // Partner's own deco canvas + texture (syncPartnerMesh copies the
    // saved piece's deco/bump into these on each show).
    const pdc = document.createElement("canvas");
    pdc.width  = DECO_W;
    pdc.height = DECO_H;
    state.partnerDecoCanvas = pdc;
    state.partnerDecoCtx    = pdc.getContext("2d");
    const pdt = new THREE.CanvasTexture(pdc);
    pdt.colorSpace = THREE.SRGBColorSpace;
    pdt.wrapS = THREE.RepeatWrapping;
    pdt.wrapT = THREE.ClampToEdgeWrapping;
    pdt.anisotropy = 4;
    state.partnerDecoTex = pdt;

    // Partner's own bump canvas + texture.
    const pbc = document.createElement("canvas");
    pbc.width  = BUMP_W;
    pbc.height = BUMP_H;
    state.partnerBumpCanvas = pbc;
    state.partnerBumpCtx    = pbc.getContext("2d");
    const pbt = new THREE.CanvasTexture(pbc);
    pbt.colorSpace = THREE.NoColorSpace;
    pbt.wrapS = THREE.RepeatWrapping;
    pbt.wrapT = THREE.ClampToEdgeWrapping;
    pbt.anisotropy = 4;
    state.partnerBumpTex = pbt;

    const mat = new THREE.MeshPhysicalMaterial({
        color: CLAY_STATES.fired.color,
        roughness: CLAY_STATES.fired.roughness,
        metalness: 0.0,
        clearcoat: CLAY_STATES.fired.clearcoat,
        clearcoatRoughness: CLAY_STATES.fired.clearcoatRoughness,
        envMapIntensity: CLAY_STATES.fired.envMapIntensity,
        bumpMap: pbt,
        bumpScale: CLAY_STATES.fired.bump,
        side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.decoMap = { value: pdt };
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "varying vec2 vDecoUv;\n#include <common>")
            .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vDecoUv = uv;");
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "uniform sampler2D decoMap;\nvarying vec2 vDecoUv;\n#include <common>")
            .replace(
                "#include <map_fragment>",
                "#include <map_fragment>\n  vec4 _deco = texture2D( decoMap, vDecoUv );\n  diffuseColor.rgb = mix( diffuseColor.rgb, pow( _deco.rgb, vec3( 2.2 ) ), _deco.a );",
            );
    };
    mat.customProgramCacheKey = () => "clay-deco-v1-partner";
    state.partnerMaterial = mat;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    state.turntable.add(mesh);
    state.partnerMesh = mesh;
    return mesh;
}

// Populate the partner mesh from a saved piece (profile + deco +
// bump + glaze). The material is set to the saved piece's CURRENT
// look (so a leather-stage piece enters the kiln as raw glaze), and
// state.partnerTarget is set to the fired look so tickPartnerMaterial
// can tween the partner alongside the active piece during firing.
function syncPartnerMesh(saved) {
    if (!state.partnerMesh) buildPartnerMesh();
    writeProfileArrayToGeometry(state.partnerMesh.geometry, saved.profile);
    state.partnerDecoCtx.clearRect(0, 0, DECO_W, DECO_H);
    state.partnerDecoCtx.drawImage(saved.decoCanvas, 0, 0);
    state.partnerDecoTex.needsUpdate = true;
    state.partnerBumpCtx.clearRect(0, 0, BUMP_W, BUMP_H);
    state.partnerBumpCtx.drawImage(saved.bumpCanvas, 0, 0);
    state.partnerBumpTex.needsUpdate = true;
    const initial = lookForPiece(saved);
    const target  = saved.glaze ? GLAZES[saved.glaze].fired : CLAY_STATES.fired;
    const mat = state.partnerMaterial;
    mat.color.setHex(initial.color);
    mat.roughness          = initial.roughness;
    mat.clearcoat          = initial.clearcoat;
    mat.clearcoatRoughness = initial.clearcoatRoughness;
    mat.envMapIntensity    = initial.envMapIntensity;
    mat.bumpScale          = initial.bump;
    mat.metalness          = initial.metalness != null ? initial.metalness : 0;
    state.partnerTarget = target;
}

// Same shape as currentLook() but reads from a snapshot rather than
// the live state. Used for the partner mesh which lives in memory.
function lookForPiece(piece) {
    const cs = piece.clayState;
    if (cs === "fired")   return piece.glaze ? GLAZES[piece.glaze].fired : CLAY_STATES.fired;
    if (cs === "leather") return piece.glaze ? GLAZES[piece.glaze].raw   : CLAY_STATES.leather;
    return CLAY_STATES.wet;
}

// Tween the partner material toward state.partnerTarget. Runs from
// tick() once per frame using the same rate constants as
// tickMaterial — slower during firing so the glaze melts visibly.
const partnerTweenColor = new THREE.Color();
function tickPartnerMaterial(dt) {
    const m = state.partnerMaterial;
    const t = state.partnerTarget;
    if (!m || !t || !state.partnerMesh || !state.partnerMesh.visible) return;
    const rate = state.firing ? 0.8 : 5;
    const k = 1 - Math.exp(-dt * rate);
    partnerTweenColor.setHex(t.color);
    m.color.lerp(partnerTweenColor, k);
    m.roughness          += (t.roughness          - m.roughness)          * k;
    m.clearcoat          += (t.clearcoat          - m.clearcoat)          * k;
    m.clearcoatRoughness += (t.clearcoatRoughness - m.clearcoatRoughness) * k;
    m.envMapIntensity    += (t.envMapIntensity    - m.envMapIntensity)    * k;
    m.bumpScale          += (t.bump               - m.bumpScale)          * k;
    m.metalness          += ((t.metalness != null ? t.metalness : 0) - m.metalness) * k;
}

// Show both pieces in their natural assembled positions. The pot
// always sits on the wheel (y=0); the lid always sits on top of the
// pot (y=TOP). Whichever piece is the live editable one gets moved
// to the right y; the other is rendered from the saved snapshot.
function showAssemblyView() {
    const partnerSaved = state.isLid ? state.savedPot : state.savedLid;
    if (!partnerSaved) return;
    syncPartnerMesh(partnerSaved);
    if (state.isLid) {
        // Active is the LID → goes on top. Partner is the pot at y=0.
        state.pot.position.y = TOP;
        state.partnerMesh.position.y = 0;
    } else {
        // Active is the POT → stays on the wheel. Partner is the lid on top.
        state.pot.position.y = 0;
        state.partnerMesh.position.y = TOP;
    }
    state.partnerMesh.visible = true;
    state.assemblyShown = true;
    applyCamera();
}

function hideAssemblyView() {
    if (state.partnerMesh) state.partnerMesh.visible = false;
    state.pot.position.y = 0;
    state.assemblyShown = false;
    applyCamera();
}

// "+ Make lid" at the decorate stage. Pauses the pot in memory (NOT
// to the gallery) and seeds a fresh wet lid whose base matches this
// pot's rim. The two pieces share a set id at save time.
function makeLidPartner() {
    if (state.clayState !== "leather") return;
    if (state.isLid) return;          // already a lid
    if (state.savedPot) return;       // a partner already exists
    const rimR = profile[ROWS];
    state.savedPot = capturePieceState();
    state.isLid = true;
    seedLidForRim(rimR, state.lidStyle);
    profileDirty = true;
    state.glaze = null;
    clearDeco();
    resetBumpLayer();
    setPhase(INITIAL_STATE);
    updateGlazeBar();
    updateLidStylePicker();
}

// Mid-shaping style swap. Reseeds the lid using the source pot's rim
// (or the lid's own current rim if no source — fallback for testing).
function setLidStyle(style) {
    if (!LID_STYLES[style]) return;
    state.lidStyle = style;
    if (state.isLid && state.clayState === "wet") {
        const rimR = (state.savedPot && state.savedPot.profile) ? state.savedPot.profile[ROWS] : profile[ROWS];
        seedLidForRim(rimR, style);
        profileDirty = true;
        clearDeco();
        resetBumpLayer();
    }
    updateLidStylePicker();
}

function buildLidStylePicker() {
    const wrap = document.getElementById("lidStylePicker");
    if (!wrap) return;
    wrap.innerHTML = "";
    LID_STYLE_IDS.forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lid-style-btn";
        b.dataset.style = id;
        b.textContent = id[0].toUpperCase() + id.slice(1);
        b.addEventListener("click", () => setLidStyle(id));
        wrap.appendChild(b);
    });
    updateLidStylePicker();
}

function updateLidStylePicker() {
    const wrap = document.getElementById("lidStylePicker");
    if (!wrap) return;
    wrap.querySelectorAll(".lid-style-btn").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.style === state.lidStyle);
    });
}

// Toggle which piece is live for editing/viewing. The currently-live
// piece is captured into the OTHER slot; the paused piece is restored
// into the live state. Available whenever exactly one piece is paused.
function swapActivePiece() {
    const wasLid = state.isLid;
    const other = wasLid ? state.savedPot : state.savedLid;
    if (!other) return;
    const current = capturePieceState();
    restorePieceState(other);
    if (wasLid) {
        state.savedLid = current;
        state.savedPot = null;
    } else {
        state.savedPot = current;
        state.savedLid = null;
    }
}

function flashSaved() {
    const b = document.getElementById("saveBtn");
    if (!b) return;
    b.textContent = "Saved ✓";
    setTimeout(() => { b.textContent = "Save"; }, 1300);
}

// Restore a saved pot into the scene as a finished (fired) piece.
async function loadPot(entry) {
    // Reset set state first; populated below if the loaded entry pairs.
    state.savedPot = null;
    state.savedLid = null;

    for (let i = 0; i < profile.length; i++) profile[i] = entry.profile?.[i] ?? 0;
    profileDirty = true;
    state.glaze = entry.glaze || null;
    state.isLid = lookupIsLid(entry);
    await loadImageOntoCanvas(entry.deco, state.decoCtx, DECO_W, DECO_H, clearDeco);
    state.decoTex.needsUpdate = true;
    await loadImageOntoCanvas(entry.bump, state.bumpCtx, BUMP_W, BUMP_H, resetBumpLayer);
    state.bumpTex.needsUpdate = true;

    // If this entry is part of a set, also load the partner so the
    // assembly view auto-triggers at setPhase("fired") below.
    if (entry.setId) {
        try {
            const all = await dbAll();
            const partnerEntry = all.find((p) => p.setId === entry.setId && p.id !== entry.id);
            if (partnerEntry) {
                const partnerSaved = await loadAsCapturedState(partnerEntry);
                if (state.isLid) state.savedPot = partnerSaved;
                else            state.savedLid = partnerSaved;
            }
        } catch (_) { /* gallery read failed — fall back to solo view */ }
    }

    setPhase("fired");
    updateGlazeBar();
    // Force an immediate frame so the piece shows right away.
    writeProfileToGeometry(state.pot.geometry);
    profileDirty = false;
    tickMaterial(10); // snap material to the fired look
    state.renderer.render(state.scene, state.camera);
}

// Read isLid off a saved entry; fall back to a profile-shape heuristic
// for legacy entries that didn't persist the flag (lids have a narrow
// top "knob" radius while pots have a wider rim).
function lookupIsLid(entry) {
    if (entry && typeof entry.isLid === "boolean") return entry.isLid;
    const top = entry?.profile?.[ROWS];
    return typeof top === "number" && top < 0.12;
}

// Tiny helper to draw a data-URL onto an existing 2D context.
async function loadImageOntoCanvas(src, ctx, w, h, onFail) {
    return new Promise((res) => {
        if (!src) { if (onFail) onFail(); res(); return; }
        const img = new Image();
        img.onload = () => { ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); res(); };
        img.onerror = () => { if (onFail) onFail(); res(); };
        img.src = src;
    });
}

// Convert a saved gallery entry into a capturePieceState-shape object
// so it can be slotted into state.savedPot / state.savedLid and feed
// the assembly view + swap logic.
async function loadAsCapturedState(entry) {
    const decoCanvas = document.createElement("canvas");
    decoCanvas.width  = DECO_W;
    decoCanvas.height = DECO_H;
    await loadImageOntoCanvas(entry.deco, decoCanvas.getContext("2d"), DECO_W, DECO_H);
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width  = BUMP_W;
    bumpCanvas.height = BUMP_H;
    const bctx = bumpCanvas.getContext("2d");
    // Default to the neutral grey baseline if the entry has no bump.
    bctx.fillStyle = "rgb(128,128,128)";
    bctx.fillRect(0, 0, BUMP_W, BUMP_H);
    await loadImageOntoCanvas(entry.bump, bctx, BUMP_W, BUMP_H);
    return {
        profile: Float32Array.from(entry.profile || []),
        glaze: entry.glaze || null,
        decoCanvas,
        bumpCanvas,
        isLid: lookupIsLid(entry),
        clayState: "fired",
    };
}

async function openGallery() {
    const grid = document.getElementById("galleryGrid");
    const empty = document.getElementById("galleryEmpty");
    if (!grid) return;
    grid.innerHTML = "";
    grid.classList.toggle("shelf",   state.galleryView === "shelf");
    grid.classList.toggle("compact", state.galleryView !== "shelf");
    let pots = [];
    try { pots = await dbAll(); } catch (_) {}
    pots.sort((a, b) => b.ts - a.ts);
    if (empty) empty.hidden = pots.length > 0;

    // Group set-mates together; each setId yields a single paired tile.
    const seen = new Set();
    pots.forEach((p) => {
        if (p.setId) {
            if (seen.has(p.setId)) return;
            seen.add(p.setId);
            const members = pots.filter((q) => q.setId === p.setId);
            renderGalleryTile(grid, members);
        } else {
            renderGalleryTile(grid, [p]);
        }
    });
    syncGalleryViewToggle();
    document.getElementById("gallery").hidden = false;
}

function renderGalleryTile(grid, members) {
    const isShelf = state.galleryView === "shelf";
    const isSet = members.length > 1;
    // For sets where we captured an assembly shot at save time, show
    // that single composite thumb instead of two stacked halves.
    const assemblyThumb = isSet && members[0].assemblyThumb;
    const item = document.createElement("div");
    item.className = "gallery-item" + (isSet ? " gallery-set" : "") + (isShelf ? " is-shelf" : "")
                   + (assemblyThumb ? " has-assembly" : "");

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "pot-thumb-wrap";
    if (assemblyThumb) {
        // Single combined image — clicking it loads either piece (the
        // assembly view restores both anyway).
        const half = document.createElement("div");
        half.className = "pot-thumb";
        const img = document.createElement("img");
        img.src = assemblyThumb;
        img.alt = (members[0].title || "Saved set");
        img.loading = "lazy";
        img.addEventListener("click", async () => { await loadPot(members[0]); closeGallery(); });
        half.appendChild(img);
        thumbWrap.appendChild(half);
    } else {
        // Solo pot, or a legacy set without an assembly thumb.
        members.forEach((p) => {
            const half = document.createElement("div");
            half.className = isSet ? "gallery-half" : "pot-thumb";
            const img = document.createElement("img");
            img.src = p.thumb;
            img.alt = p.title || "Saved pot";
            img.loading = "lazy";
            img.addEventListener("click", async () => { await loadPot(p); closeGallery(); });
            half.appendChild(img);
            thumbWrap.appendChild(half);
        });
    }
    item.appendChild(thumbWrap);

    // Metadata column (shelf view only): title (tap to rename) + glaze
    // name + saved-on date. Title acts as the portfolio caption.
    if (isShelf) {
        const meta = document.createElement("div");
        meta.className = "pot-meta";
        const titleBtn = document.createElement("button");
        titleBtn.type = "button";
        const hasTitle = !!(members[0].title && members[0].title.length);
        titleBtn.className = "pot-title" + (hasTitle ? "" : " is-empty");
        titleBtn.textContent = hasTitle ? members[0].title : "Tap to name";
        titleBtn.title = "Rename this pot";
        titleBtn.addEventListener("click", (e) => { e.stopPropagation(); renameTile(members[0]); });
        meta.appendChild(titleBtn);
        const sub = document.createElement("div");
        sub.className = "pot-sub";
        const dateStr = formatPotDate(members[0].ts);
        const glaze = glazeNameFor(members[0]);
        sub.textContent = isSet ? `Lid set · ${glaze} · ${dateStr}` : `${glaze} · ${dateStr}`;
        meta.appendChild(sub);
        item.appendChild(meta);
    }

    const del = document.createElement("button");
    del.className = "gallery-del";
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", isSet ? "Delete set" : "Delete pot");
    del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await Promise.all(members.map((m) => dbDelete(m.id)));
        openGallery();
    });
    item.appendChild(del);
    grid.appendChild(item);
}

function renameTile(p) {
    const cur = p.title || "";
    // prompt() is enough for a casual name-edit; the title is stored
    // verbatim (no markup) and rendered with textContent.
    const next = window.prompt("Name this pot", cur);
    if (next == null) return;
    p.title = next.trim() ? next.trim().slice(0, 60) : null;
    dbPut(p).then(() => openGallery()).catch(() => {});
}

function glazeNameFor(p) {
    if (!p.glaze || !GLAZES[p.glaze]) return "Bare clay";
    return GLAZES[p.glaze].name;
}

function formatPotDate(ts) {
    const d = new Date(ts);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
}

function setGalleryView(name) {
    state.galleryView = name === "compact" ? "compact" : "shelf";
    try { localStorage.setItem("slip-gallery-view", state.galleryView); } catch (_) {}
    syncGalleryViewToggle();
    openGallery();
}

function syncGalleryViewToggle() {
    const btn = document.getElementById("galleryViewToggle");
    if (!btn) return;
    btn.textContent = state.galleryView === "shelf" ? "Grid" : "Shelf";
}
function closeGallery() {
    const g = document.getElementById("gallery");
    if (g) g.hidden = true;
}

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.renderer.setSize(w, h, false);
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
}

function tick() {
    const dt = state.clock.getDelta();
    // The auto-spin eases to a stop while you work (throwing/trimming/
    // painting), while you manually spin, and whenever zoomed in —
    // then drifts back up once you're idle at the default framing.
    const zoomed = state.zoom > 1.02;
    const busy = sculpting || state.painting || state.userRotating || zoomed || state.firing;
    const targetSpin = busy ? 0 : SPIN_SPEED;
    state.spin += (targetSpin - state.spin) * (1 - Math.exp(-dt * 4));
    state.turntable.rotation.y += state.spin * dt;
    // Wheel hum tracks the spin: as the auto-spin eases out while the
    // user works, the hum quiets to near-silent; restored when idle.
    if (state.sfxOn) {
        const ratio = Math.max(0, state.spin / SPIN_SPEED);
        playSfx("wheel", { volume: ratio * SFX_SOURCES.wheel.vol });
    } else {
        stopSfx("wheel");
    }
    // The kiln sequence drives the dark-edge vignette opacity, the
    // warm inner glow, the backdrop fade and the music ducking each
    // frame. The slowed material tween (see tickMaterial) lets the
    // glaze melt visibly through the firing phase.
    if (state.firing) {
        const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const elapsed = (now - state.firingStart) / 1000;
        if (elapsed >= FIRING_DURATION) {
            endFiringMoment();
        } else {
            const phaseT = elapsed / FIRING_DURATION;
            // Phase fractions of the total: close 11%, fire 44%, cool 11%, open 33%.
            const closeEnd = 0.11, fireEnd = 0.55, coolEnd = 0.66;
            let edge = 0, glow = 0, bd = 1, ducked = 1;
            if (phaseT < closeEnd) {
                const t = smoothstep(phaseT / closeEnd);
                edge = t;            // dark walls fade in
                glow = t * 0.4;      // warm light starts
                bd = 1 - 0.88 * t;   // studio darkens
                ducked = 1 - (1 - FIRING_MUSIC_DUCK) * t;
            } else if (phaseT < fireEnd) {
                const t = (phaseT - closeEnd) / (fireEnd - closeEnd);
                edge = 1;
                glow = 0.4 + 0.6 * smoothstep(t); // glow builds toward peak
                bd = 0.12;
                ducked = FIRING_MUSIC_DUCK;
            } else if (phaseT < coolEnd) {
                const t = (phaseT - fireEnd) / (coolEnd - fireEnd);
                edge = 1;
                glow = 1 - 0.4 * smoothstep(t);   // glow softens
                bd = 0.12;
                ducked = FIRING_MUSIC_DUCK;
            } else {
                const t = smoothstep((phaseT - coolEnd) / (1 - coolEnd));
                edge = 1 - t;            // walls fade out
                glow = 0.6 * (1 - t);    // last embers
                bd = 0.12 + 0.88 * t;    // studio brightens back
                ducked = FIRING_MUSIC_DUCK + (1 - FIRING_MUSIC_DUCK) * t;
            }
            const vignette = document.getElementById("kilnVignette");
            if (vignette) {
                vignette.style.opacity = "1";
                const edgeEl = vignette.querySelector(".kiln-edge");
                const glowEl = vignette.querySelector(".kiln-inner-glow");
                if (edgeEl) edgeEl.style.opacity = edge.toFixed(3);
                if (glowEl) glowEl.style.opacity = glow.toFixed(3);
            }
            const backdrop = document.getElementById("backdrop");
            if (backdrop) backdrop.style.opacity = bd.toFixed(3);
            if (music && state._musicSavedVol != null) {
                music.volume = state._musicSavedVol * ducked;
            }
        }
    }
    if (profileDirty) {
        writeProfileToGeometry(state.pot.geometry);
        profileDirty = false;
    }
    tickMaterial(dt);
    tickPartnerMaterial(dt);
    state.renderer.render(state.scene, state.camera);
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.classList.add("is-hidden");
}

function dismissLanding() {
    const l = document.getElementById("landing");
    if (l) l.classList.add("is-gone");
    // The Begin tap is a user gesture — safe to start audio here.
    if (state.musicOn && music) music.play().catch(() => {});
}

// Return to the title screen (re-show the landing over the studio).
function showLanding() {
    const l = document.getElementById("landing");
    if (l) { l.hidden = false; l.classList.remove("is-gone"); }
}

// --- Ambiance: backdrops + music --------------------------------
function setBackground(id) {
    const bg = BACKGROUNDS.find((b) => b.id === id);
    if (!bg) return;
    state.background = id;
    const bd = document.getElementById("backdrop");
    const vid = document.getElementById("backdropVideo");
    if (bg.type === "video") {
        if (bd) bd.classList.add("is-hidden");
        if (vid) {
            // Only swap the src if it changed — avoids reloading the
            // file when the same motion bg is reselected.
            const want = new URL(bg.src, location.href).href;
            if (vid.src !== want) vid.src = bg.src;
            vid.classList.add("is-active");
            vid.play().catch(() => {}); // user gesture or muted autoplay
        }
    } else {
        if (vid) {
            vid.classList.remove("is-active");
            vid.pause();
        }
        if (bd) {
            bd.classList.remove("is-hidden");
            bd.style.backgroundImage = `url("assets/backgrounds/${id}.jpg")`;
        }
    }
    try { localStorage.setItem("slip-bg", id); } catch (_) {}
    updateBgPicker();
}
// Background picker: a row of category tabs above a single row of
// swatches. Only the active category's swatches show — keeps the
// title screen compact, scales to many backdrops without a scrollbar.
function buildBgPicker() {
    const wrap = document.getElementById("bgPicker");
    if (!wrap) return;
    wrap.innerHTML = "";

    // Pick the initial category: whichever one the saved background lives in.
    const current = BACKGROUNDS.find((b) => b.id === state.background);
    state.bgCategory = current ? current.category : BG_CATEGORIES[0];

    const tabs = document.createElement("div");
    tabs.className = "bg-tabs";
    BG_CATEGORIES.forEach((cat) => {
        if (!BACKGROUNDS.some((b) => b.category === cat)) return;
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "bg-tab";
        tab.dataset.category = cat;
        tab.textContent = cat;
        tab.addEventListener("click", () => setBgCategory(cat));
        tabs.appendChild(tab);
    });
    wrap.appendChild(tabs);

    const row = document.createElement("div");
    row.className = "bg-row";
    row.id = "bgRow";
    wrap.appendChild(row);

    renderBgRow();
}

function setBgCategory(cat) {
    if (!BG_CATEGORIES.includes(cat)) return;
    state.bgCategory = cat;
    renderBgRow();
}

function renderBgRow() {
    const row = document.getElementById("bgRow");
    if (!row) return;
    row.innerHTML = "";
    BACKGROUNDS.filter((b) => b.category === state.bgCategory).forEach((b) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "bg-swatch" + (b.type === "video" ? " is-video" : "");
        el.dataset.id = b.id;
        // Video swatches use a chip-coloured tile + play glyph (CSS).
        // Static swatches show their JPG as the swatch background.
        if (b.type !== "video") {
            el.style.backgroundImage = `url("assets/backgrounds/${b.id}.jpg")`;
        }
        el.setAttribute("aria-label", b.label + " background");
        el.addEventListener("click", () => setBackground(b.id));
        row.appendChild(el);
    });
    syncBgTabs();
    updateBgPicker();
}

function syncBgTabs() {
    document.querySelectorAll(".bg-tab").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.category === state.bgCategory);
    });
}

function updateBgPicker() {
    const wrap = document.getElementById("bgPicker");
    if (!wrap) return;
    wrap.querySelectorAll(".bg-swatch").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.id === state.background);
    });
}

function initMusic() {
    // Pick a random track per session for variety. If the file is
    // missing the Audio element will error; we fall back to track 0
    // so a typo in the listing doesn't silence the whole studio.
    let idx = 0;
    if (MUSIC_TRACKS.length > 1) idx = Math.floor(Math.random() * MUSIC_TRACKS.length);
    music = new Audio(MUSIC_TRACKS[idx].src);
    music.loop = true;
    music.volume = 0.45;
    music.addEventListener("error", () => {
        if (idx === 0) return;
        music = new Audio(MUSIC_TRACKS[0].src);
        music.loop = true;
        music.volume = 0.45;
        if (state.musicOn) music.play().catch(() => {});
    }, { once: true });
}

// --- SFX manager -----------------------------------------------
const sfxCache = {};       // id -> { audio, def } (lazy-instantiated)
const sfxFailed = new Set(); // ids whose file errored — don't retry

function loadSfx(id) {
    if (sfxCache[id]) return sfxCache[id];
    if (sfxFailed.has(id)) return null;
    const def = SFX_SOURCES[id];
    if (!def) return null;
    const a = new Audio(def.src);
    a.preload = "auto";
    a.loop = !!def.loop;
    a.addEventListener("error", () => { sfxFailed.add(id); }, { once: true });
    sfxCache[id] = { audio: a, def };
    return sfxCache[id];
}

// Play a sound. For looping ambient (wheel) the same audio element is
// reused and the volume is set in-place; for one-shots we clone the
// node so a fast burst of triggers can overlap without restarting.
function playSfx(id, opts) {
    if (!state.sfxOn) return;
    const s = loadSfx(id);
    if (!s) return;
    const vol = (opts && opts.volume != null) ? opts.volume : s.def.vol;
    if (s.def.loop) {
        s.audio.volume = Math.max(0, Math.min(1, vol));
        if (s.audio.paused && vol > 0.005) s.audio.play().catch(() => {});
        return;
    }
    const clone = s.audio.cloneNode(true);
    clone.loop = false;
    clone.volume = Math.max(0, Math.min(1, vol));
    if (s.def.pitchVar) clone.playbackRate = 1 + (Math.random() - 0.5) * s.def.pitchVar;
    clone.play().catch(() => {});
}

function stopSfx(id) {
    const s = sfxCache[id];
    if (!s) return;
    s.audio.pause();
    if (!s.def.loop) s.audio.currentTime = 0;
}

// Squelch trigger gets called from every sculpt move — throttle so
// it sounds like soft pressure, not a buzzing machine gun.
let lastSquelch = 0;
function maybeSquelch() {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (now - lastSquelch < 220) return;
    lastSquelch = now;
    playSfx("squelch");
}
function setMusic(on) {
    state.musicOn = on;
    try { localStorage.setItem("slip-music", on ? "1" : "0"); } catch (_) {}
    if (music) {
        if (on) music.play().catch(() => {});
        else music.pause();
    }
    updateMusicToggle();
}
function updateMusicToggle() {
    const btn = document.getElementById("musicToggle");
    if (!btn) return;
    btn.classList.toggle("is-on", state.musicOn);
    btn.setAttribute("aria-pressed", state.musicOn ? "true" : "false");
    btn.textContent = state.musicOn ? "♪ Music on" : "♪ Music off";
}

function setSfx(on) {
    state.sfxOn = on;
    try { localStorage.setItem("slip-sfx", on ? "1" : "0"); } catch (_) {}
    if (!on) stopSfx("wheel"); // hum restarts from the tick loop next frame when re-enabled
    updateSfxToggle();
}
function updateSfxToggle() {
    const btn = document.getElementById("sfxToggle");
    if (!btn) return;
    btn.classList.toggle("is-on", state.sfxOn);
    btn.setAttribute("aria-pressed", state.sfxOn ? "true" : "false");
    btn.textContent = state.sfxOn ? "♫ SFX on" : "♫ SFX off";
}
