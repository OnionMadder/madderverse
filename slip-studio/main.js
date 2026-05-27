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
    wet:     { label: "Wet clay", color: 0xa3674a, roughness: 0.48, clearcoat: 0.40, clearcoatRoughness: 0.45, envMapIntensity: 0.85, bump: 0.008 },
    bonedry: { label: "Bone-dry", color: 0xc9a98c, roughness: 0.95, clearcoat: 0.02, clearcoatRoughness: 1.00, envMapIntensity: 0.38, bump: 0.024 },
    fired:   { label: "Fired",    color: 0xbf6a45, roughness: 0.60, clearcoat: 0.15, clearcoatRoughness: 0.70, envMapIntensity: 0.62, bump: 0.014 },
};
const INITIAL_STATE = "wet";

// Three-step arc: shape it wet, decorate it bone-dry (pick a glaze),
// fire it. Glazing is optional — a bare bone-dry pot fires to plain
// earthenware.
const PHASES = ["wet", "bonedry", "fired"];
const ADVANCE_LABEL = { wet: "Dry", bonedry: "Fire", fired: "New pot" };

// Glazes. `raw` is the chalky matte coat before firing; `fired` is the
// glossy vitrified result. Shared surface params, per-glaze colours
// (tunable placeholders). The reveal is raw → fired on the glaze fire.
const GLAZE_RAW   = { roughness: 0.92, clearcoat: 0.03, clearcoatRoughness: 0.95, envMapIntensity: 0.32, bump: 0.012 };
const GLAZE_FIRED = { roughness: 0.30, clearcoat: 0.72, clearcoatRoughness: 0.14, envMapIntensity: 0.85, bump: 0.004 };
function glaze(name, rawHex, firedHex) {
    return { name, raw: { ...GLAZE_RAW, color: rawHex }, fired: { ...GLAZE_FIRED, color: firedHex } };
}
const GLAZES = {
    celadon: glaze("Celadon", 0xb9c3b3, 0x7d9b7e),
    cobalt:  glaze("Cobalt",  0x9aa3b6, 0x37507e),
    oatmeal: glaze("Oatmeal", 0xd8d2c4, 0xe7ddca),
    honey:   glaze("Honey",   0xc2a274, 0xb27a33),
    tenmoku: glaze("Tenmoku", 0x6e6258, 0x2c2320),
};
const GLAZE_IDS = ["celadon", "cobalt", "oatmeal", "honey", "tenmoku"];

// --- Decoration -------------------------------------------------
// Painted onto the surface (over the glaze) by dragging on the pot.
// One unwrapped RGBA canvas wraps the pot via UVs; a shader overlays
// it on the clay. Brush = soft dab; splatter = scattered droplets.
const DECO_COLORS = [0xf4efe6, 0x2b2622, 0x37507e, 0x7d9b7e, 0xc98a3c, 0xc97f86];
const DECO_W = 2048, DECO_H = 1024; // unwrapped surface (≈ circumference:height)
// Brush radii in canvas px (at zoom 1). The effective radius is divided
// by the zoom, so the brush keeps a constant on-screen size — zoom in
// for finer detail.
const DECO_SIZES = [{ label: "S", px: 30 }, { label: "M", px: 62 }, { label: "L", px: 108 }];
const DEFAULT_DECO_SIZE = 1;
const SPLATTER_DROPS = 9;

// Stamp shapes (tap/drag to place) and overlay patterns (one tap fills
// the whole surface). Both reuse the paint layer + current colour/size.
const STAMP_SHAPES = [
    { id: "dot",    glyph: "●" },
    { id: "ring",   glyph: "◯" },
    { id: "star",   glyph: "★" },
    { id: "heart",  glyph: "♥" },
    { id: "flower", glyph: "✿" },
    { id: "cross",  glyph: "✚" },
];
const OVERLAY_PATTERNS = [
    { id: "dots",    label: "Dots" },
    { id: "rings",   label: "Rings" },
    { id: "stripes", label: "Stripes" },
    { id: "grid",    label: "Grid" },
    { id: "scatter", label: "Scatter" },
];

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
    zoom: 1,                    // 1 = default framing; up to ZOOM_MAX
    userRotating: false,        // manually spinning the pot
    clock: new THREE.Clock(),
};
let lastPaintUV = null;         // for continuous paint strokes

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
        powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer = renderer;

    // --- Scene ----------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
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
    document.getElementById("saveBtn")?.addEventListener("click", () => savePot());
    document.getElementById("galleryBtn")?.addEventListener("click", () => openGallery());
    document.getElementById("galleryClose")?.addEventListener("click", closeGallery);
    document.querySelectorAll(".deco-size").forEach((b, idx) =>
        b.addEventListener("click", () => setDecoSize(idx)));
    setDecoTool("brush");
    setDecoSize(DEFAULT_DECO_SIZE);
    setPhase(INITIAL_STATE); // sets the tween target + toolbar

    // First frame, then reveal the scene and start the loop.
    renderer.render(scene, camera);
    hideLoader();
    renderer.setAnimationLoop(tick);

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
            state, profile, radiusAt, sculptToward, maxRadiusAt,
            setPhase, advanceStage, stepBack, setBrush, setGlaze,
            setDecoColor, setDecoTool, setDecoSize, paintAt, clearDeco,
            setStampShape, stampAt, applyOverlay,
            setZoom, zoomBy, rotateBy,
            savePot, loadPot, openGallery, closeGallery, dbAll, dbDelete, dismissLanding,
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
// the grain and lines sweep past the light as the pot turns.
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
function makeClayTexture() {
    const SIZE = 768;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(SIZE, SIZE);
    const data = img.data;
    const g1 = randGrid(128), g2 = randGrid(48);
    for (let y = 0; y < SIZE; y++) {
        const v = y / SIZE;
        for (let x = 0; x < SIZE; x++) {
            const u = x / SIZE;
            const grain = valueNoise(g1, 128, u, v) * 0.6 +
                          valueNoise(g2, 48, u, v) * 0.4 - 0.5;
            const lines = Math.sin((v * 22 + u * 1.5) * Math.PI * 2);
            const h = 0.5 + grain * 0.5 + lines * 0.16;
            const c = Math.max(0, Math.min(255, h * 255)) | 0;
            const i = (y * SIZE + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = c;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace; // data, not colour
    tex.anisotropy = 4;
    return tex;
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
    const s0 = CLAY_STATES[INITIAL_STATE];
    const mat = new THREE.MeshPhysicalMaterial({
        color: s0.color,
        roughness: s0.roughness,
        metalness: 0.0,
        clearcoat: s0.clearcoat,
        clearcoatRoughness: s0.clearcoatRoughness,
        envMapIntensity: s0.envMapIntensity,
        bumpMap: makeClayTexture(),     // clay grain + throwing lines
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

// Seed `profile` from a vase silhouette: narrow foot, full belly,
// tapered neck, small rim. Control points are run through a spline
// (C1-continuous) so the surface reads smooth, not faceted, then
// resampled to one radius per evenly-spaced height row.
function seedProfile() {
    const controls = [
        [0.00, 0.00], [0.30, 0.00], [0.33, 0.06], [0.27, 0.16],
        [0.41, 0.34], [0.54, 0.58], [0.53, 0.74], [0.42, 0.92],
        [0.31, 1.08], [0.30, 1.20], [0.35, 1.32], [0.33, 1.40],
    ].map(([x, y]) => new THREE.Vector2(x, y));

    const curve = new THREE.SplineCurve(controls).getPoints(600);
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
    clampProfile(); // seed must obey the wheel envelope too
}

// Rewrite vertex positions + normals from the current profile.
// Normals are ANALYTIC (derived from the profile slope) rather than
// face-averaged: a surface of revolution has an exact normal, which
// is smooth around each ring (no radial facet banding) and identical
// at angle 0 and 2π (no lighting seam where the lathe wraps). Cheap
// enough to call on every sculpting frame.
function writeProfileToGeometry(geo) {
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const dyStep = TOP / ROWS;
    for (let r = 0; r <= ROWS; r++) {
        const y = r * dyStep;
        const rad = profile[r];

        // 2D outward normal in the (radius, height) plane, from the
        // local profile slope. Central difference inside, one-sided
        // at the ends.
        let dr, dy;
        if (r === 0)         { dr = profile[1] - profile[0];           dy = dyStep; }
        else if (r === ROWS) { dr = profile[ROWS] - profile[ROWS - 1]; dy = dyStep; }
        else                 { dr = profile[r + 1] - profile[r - 1];   dy = 2 * dyStep; }
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
    if (y <= FOOT_TOP) return BASE_MAX;
    const t = THREE.MathUtils.clamp((y - FOOT_TOP) / FOOT_BLEND, 0, 1);
    return THREE.MathUtils.lerp(BASE_MAX, MAX_R, t);
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

// Pull the silhouette toward `targetR` around height `y`, with a
// Gaussian vertical falloff so the clay bulges instead of stepping.
function sculptToward(y, targetR) {
    targetR = THREE.MathUtils.clamp(targetR, MIN_R, MAX_R);
    const centerRow = (y / TOP) * ROWS;
    const sigmaRows = (BRUSHES[state.brushIndex].sigma / TOP) * ROWS;
    const reach = Math.ceil(sigmaRows * 3);
    const lo = Math.max(1, Math.floor(centerRow - reach));
    const hi = Math.min(ROWS, Math.ceil(centerRow + reach));
    for (let r = lo; r <= hi; r++) {
        const d = (r - centerRow) / sigmaRows;
        const w = Math.exp(-0.5 * d * d) * STRENGTH;
        profile[r] = THREE.MathUtils.lerp(profile[r], targetR, w);
    }
    clampProfile(); // the foot can't pull wider than the wheel
    profileDirty = true;
}

// --- Material states (wet → bone-dry/decorate → fired) ----------

// The material look for the current phase. A chosen glaze shows as a
// matte raw coat while bone-dry, then glossy once fired; with no glaze
// it's bare clay (and plain fired earthenware).
function currentLook() {
    const cs = state.clayState;
    if (cs === "fired")   return state.glaze ? GLAZES[state.glaze].fired : CLAY_STATES.fired;
    if (cs === "bonedry") return state.glaze ? GLAZES[state.glaze].raw   : CLAY_STATES.bonedry;
    return CLAY_STATES.wet;
}

// Enter a phase: point the material tween at its look, refresh the UI.
function setPhase(name) {
    state.clayState = name;
    state.clayTarget = currentLook();
    updateToolbar();
}

// The forward control: dry → fire → new pot.
function advanceStage() {
    switch (state.clayState) {
        case "wet":     setPhase("bonedry"); break;
        case "bonedry": setPhase("fired");   break; // fire — the glaze reveal
        case "fired":   resetPot();          break;
    }
}

// Decorate: pick a glaze on the bone-dry pot (tap the active one again
// to clear it and fire bare).
function setGlaze(id) {
    if (!GLAZES[id]) return;
    state.glaze = state.glaze === id ? null : id;
    if (state.clayState === "bonedry") setPhase("bonedry"); // refresh the raw look
    updateGlazeBar();
}

// Step back one phase to keep editing. The ends are commitments: wet
// (start) and fired. The glaze choice is kept across a re-wet.
function stepBack() {
    const cs = state.clayState;
    if (cs === "wet" || cs === "fired") return;
    setPhase(PHASES[PHASES.indexOf(cs) - 1]);
    updateGlazeBar();
}

// Start a fresh wet pot.
function resetPot() {
    seedProfile();
    profileDirty = true;
    state.glaze = null;
    clearDeco();
    setPhase(INITIAL_STATE);
    updateGlazeBar();
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
function tickMaterial(dt) {
    const m = state.clayMaterial;
    const t = state.clayTarget;
    if (!m || !t) return;
    const k = 1 - Math.exp(-dt * 5); // frame-rate-independent smoothing
    targetColor.setHex(t.color);
    m.color.lerp(targetColor, k);
    m.roughness          += (t.roughness          - m.roughness)          * k;
    m.clearcoat          += (t.clearcoat          - m.clearcoat)          * k;
    m.clearcoatRoughness += (t.clearcoatRoughness - m.clearcoatRoughness) * k;
    m.envMapIntensity    += (t.envMapIntensity    - m.envMapIntensity)    * k;
    m.bumpScale          += (t.bump               - m.bumpScale)          * k;
}

// The stage label, including the glaze name once chosen.
function stageLabelText() {
    const cs = state.clayState;
    if (cs === "bonedry") return state.glaze ? GLAZES[state.glaze].name + " · raw" : "Decorate";
    if (cs === "fired") return state.glaze ? GLAZES[state.glaze].name + " glaze" : "Fired";
    return CLAY_STATES.wet.label;
}

// Reflect the current phase in the UI: stage label, advance button,
// back button (hidden at the ends), the brush bar (only while wet),
// and the glaze palette (only while bone-dry / decorating).
function updateToolbar() {
    const cs = state.clayState;
    const label = document.getElementById("stageLabel");
    const advance = document.getElementById("advanceBtn");
    const back = document.getElementById("backBtn");
    const brushBar = document.getElementById("brushBar");
    const decoStack = document.getElementById("decoStack");
    if (label) label.textContent = stageLabelText();
    if (advance) advance.textContent = ADVANCE_LABEL[cs];
    const saveBtn = document.getElementById("saveBtn");
    if (back) back.hidden = cs === "wet" || cs === "fired";
    if (brushBar) brushBar.hidden = cs !== "wet";
    if (decoStack) decoStack.hidden = cs !== "bonedry";
    if (saveBtn) saveBtn.hidden = cs !== "fired"; // save finished pieces
    if (cs === "bonedry") updateDecoSub(); // contextual sub-palette
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
    const f = 1 / state.zoom; // higher zoom → camera closer to the target
    state.camera.position.set(
        CAM_TARGET.x + (CAM_BASE.x - CAM_TARGET.x) * f,
        CAM_TARGET.y + (CAM_BASE.y - CAM_TARGET.y) * f,
        CAM_TARGET.z + (CAM_BASE.z - CAM_TARGET.z) * f,
    );
    state.camera.lookAt(CAM_TARGET);
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
        ev.preventDefault();
    } else if (state.clayState === "bonedry" && state.decoColor != null && state.decoTool !== "overlay") {
        state.painting = true;
        const uv = pointerToUV(ev);
        if (uv) { decoApplyAt(uv.x, uv.y); lastPaintUV = { x: uv.x, y: uv.y }; }
        else lastPaintUV = null;
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
        if (p) sculptToward(p.y, p.r);
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
    const cam = state.camera;
    const prevAspect = cam.aspect;
    const prevPos = cam.position.clone();
    cam.aspect = 1;
    cam.position.copy(CAM_BASE);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(size, size);
    state.renderer.setRenderTarget(rt);
    state.renderer.render(state.scene, cam);
    const buf = new Uint8Array(size * size * 4);
    state.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    state.renderer.setRenderTarget(null);
    rt.dispose();

    // restore the live camera
    cam.aspect = prevAspect;
    cam.position.copy(prevPos);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();

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

async function savePot() {
    const entry = {
        id: Date.now().toString(36),
        ts: Date.now(),
        profile: Array.from(profile, (x) => +x.toFixed(4)),
        glaze: state.glaze,
        deco: state.decoCanvas.toDataURL("image/png"),
        thumb: captureThumb(),
    };
    try {
        await dbPut(entry);
        flashSaved();
    } catch (e) {
        console.warn("save failed", e);
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
    for (let i = 0; i < profile.length; i++) profile[i] = entry.profile?.[i] ?? 0;
    profileDirty = true;
    state.glaze = entry.glaze || null;
    await new Promise((res) => {
        const img = new Image();
        img.onload = () => {
            state.decoCtx.clearRect(0, 0, DECO_W, DECO_H);
            state.decoCtx.drawImage(img, 0, 0, DECO_W, DECO_H);
            state.decoTex.needsUpdate = true;
            res();
        };
        img.onerror = () => { clearDeco(); res(); };
        img.src = entry.deco;
    });
    setPhase("fired");
    updateGlazeBar();
    // Force an immediate frame so the piece shows right away.
    writeProfileToGeometry(state.pot.geometry);
    profileDirty = false;
    tickMaterial(10); // snap material to the fired look
    state.renderer.render(state.scene, state.camera);
}

async function openGallery() {
    const grid = document.getElementById("galleryGrid");
    const empty = document.getElementById("galleryEmpty");
    if (!grid) return;
    grid.innerHTML = "";
    let pots = [];
    try { pots = await dbAll(); } catch (_) {}
    pots.sort((a, b) => b.ts - a.ts);
    if (empty) empty.hidden = pots.length > 0;
    pots.forEach((p) => {
        const item = document.createElement("div");
        item.className = "gallery-item";
        const img = document.createElement("img");
        img.src = p.thumb;
        img.alt = "Saved pot";
        img.loading = "lazy";
        img.addEventListener("click", async () => { await loadPot(p); closeGallery(); });
        const del = document.createElement("button");
        del.className = "gallery-del";
        del.type = "button";
        del.textContent = "×";
        del.setAttribute("aria-label", "Delete pot");
        del.addEventListener("click", async (e) => { e.stopPropagation(); await dbDelete(p.id); openGallery(); });
        item.append(img, del);
        grid.appendChild(item);
    });
    document.getElementById("gallery").hidden = false;
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
    // The auto-spin eases to a stop while you work (throwing/painting),
    // while you manually spin, and whenever zoomed in — then drifts
    // back up once you're idle at the default framing.
    const zoomed = state.zoom > 1.02;
    const busy = sculpting || state.painting || state.userRotating || zoomed;
    const targetSpin = busy ? 0 : SPIN_SPEED;
    state.spin += (targetSpin - state.spin) * (1 - Math.exp(-dt * 4));
    state.turntable.rotation.y += state.spin * dt;
    if (profileDirty) {
        writeProfileToGeometry(state.pot.geometry);
        profileDirty = false;
    }
    tickMaterial(dt);
    state.renderer.render(state.scene, state.camera);
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.classList.add("is-hidden");
}

function dismissLanding() {
    const l = document.getElementById("landing");
    if (l) l.classList.add("is-gone");
}
