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
// The clay progresses wet → leather-hard → bone-dry → fired. Each
// state has its own surface look and rules: you can only throw
// (sculpt) wet clay, and only trim a foot at leather-hard. Colours
// here are tunable placeholders. clearcoat is kept slightly > 0 in
// every state so the shader define never toggles mid-tween (no
// recompile hitch). `action` is the label that advances to `next`.
// Bare-clay "looks" for each lifecycle phase up to bisque. `bump`
// scales the procedural relief: wet reads smoother (water fills the
// tooth), bone-dry shows the most grain.
const CLAY_STATES = {
    wet:     { label: "Wet clay",     color: 0xa3674a, roughness: 0.48, clearcoat: 0.40, clearcoatRoughness: 0.45, envMapIntensity: 0.85, bump: 0.008 },
    leather: { label: "Leather-hard", color: 0xb87a5e, roughness: 0.72, clearcoat: 0.05, clearcoatRoughness: 0.90, envMapIntensity: 0.60, bump: 0.018 },
    bonedry: { label: "Bone-dry",     color: 0xc9a98c, roughness: 0.95, clearcoat: 0.02, clearcoatRoughness: 1.00, envMapIntensity: 0.38, bump: 0.024 },
    bisque:  { label: "Bisque",       color: 0xbf6a45, roughness: 0.66, clearcoat: 0.10, clearcoatRoughness: 0.75, envMapIntensity: 0.55, bump: 0.017 },
};
const INITIAL_STATE = "wet";

// Full phase order. glazedRaw/glazed are only reached once a glaze is
// chosen on the bisque pot.
const PHASES = ["wet", "leather", "bonedry", "bisque", "glazedRaw", "glazed"];
// Forward-button label per phase; null hides the button (at bisque the
// glaze palette is the action).
const ADVANCE_LABEL = {
    wet: "Firm up", leather: "Dry", bonedry: "Fire",
    bisque: null, glazedRaw: "Glaze fire", glazed: "New pot",
};

// Glazes. `raw` is the chalky matte coat before firing; `fired` is the
// glossy vitrified result. Shared surface params, per-glaze colours
// (tunable placeholders). The reveal is raw → fired on the glaze fire.
const GLAZE_RAW   = { roughness: 0.92, clearcoat: 0.03, clearcoatRoughness: 0.95, envMapIntensity: 0.32, bump: 0.012 };
const GLAZE_FIRED = { roughness: 0.26, clearcoat: 0.90, clearcoatRoughness: 0.10, envMapIntensity: 1.10, bump: 0.004 };
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
    spin: SPIN_SPEED,           // current angular speed (eases to 0 while sculpting)
    clock: new THREE.Clock(),
};

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
    camera.position.set(0, 1.15, 4.1);
    camera.lookAt(0, 0.66, 0);
    state.camera = camera;

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
    setPhase(INITIAL_STATE); // sets the tween target + toolbar

    // First frame, then reveal the scene and start the loop.
    renderer.render(scene, camera);
    hideLoader();
    renderer.setAnimationLoop(tick);

    // Dev handle (inert unless the URL carries ?dev) — used to drive
    // and inspect the sculpt during testing across the build.
    if (location.search.includes("dev")) {
        window.__slip = {
            state, profile, radiusAt, sculptToward, maxRadiusAt,
            setPhase, advanceStage, stepBack, setBrush, setGlaze,
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

// --- Material states (wet → leather → bone-dry → bisque → glaze) -

// The material look for the current phase: a glaze (raw/fired) once
// glazing, otherwise the bare-clay state.
function currentLook() {
    const cs = state.clayState;
    if (cs === "glazed" && state.glaze) return GLAZES[state.glaze].fired;
    if (cs === "glazedRaw" && state.glaze) return GLAZES[state.glaze].raw;
    return CLAY_STATES[cs] || CLAY_STATES.bisque;
}

// Enter a phase: point the material tween at its look, refresh the UI.
function setPhase(name) {
    state.clayState = name;
    state.clayTarget = currentLook();
    updateToolbar();
}

// The forward control. Bisque has no forward action (you pick a glaze
// swatch); glaze-fire happens from glazedRaw; New pot resets.
function advanceStage() {
    switch (state.clayState) {
        case "wet":       setPhase("leather"); break;
        case "leather":   setPhase("bonedry"); break;
        case "bonedry":   setPhase("bisque");  break;
        case "glazedRaw": setPhase("glazed");  break; // glaze fire — the reveal
        case "glazed":    resetPot();          break;
    }
}

// Pick a glaze on the bisque pot (or change it before firing).
function setGlaze(id) {
    if (!GLAZES[id]) return;
    state.glaze = id;
    if (state.clayState === "bisque") setPhase("glazedRaw");
    else if (state.clayState === "glazedRaw") setPhase("glazedRaw");
    updateGlazeBar();
}

// Step back one phase to keep editing. The two ends are commitments:
// wet (start) and glazed (fired). Leaving glazedRaw drops the glaze.
function stepBack() {
    const cs = state.clayState;
    if (cs === "wet" || cs === "glazed") return;
    const prev = PHASES[PHASES.indexOf(cs) - 1];
    if (cs === "glazedRaw") state.glaze = null; // wipe the unfired glaze
    setPhase(prev);
    updateGlazeBar();
}

// Start a fresh wet pot.
function resetPot() {
    seedProfile();
    profileDirty = true;
    state.glaze = null;
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

// The stage label, including the glaze name once glazing.
function stageLabelText() {
    const cs = state.clayState;
    if (cs === "bisque") return "Pick a glaze";
    if (cs === "glazedRaw") return GLAZES[state.glaze].name + " · raw";
    if (cs === "glazed") return GLAZES[state.glaze].name + " glaze";
    return CLAY_STATES[cs].label;
}

// Reflect the current phase in the UI: stage label, advance button
// (hidden where there's no forward action), back button (hidden at the
// ends), the brush bar (only while wet), and the glaze palette (bisque
// + glazedRaw).
function updateToolbar() {
    const cs = state.clayState;
    const label = document.getElementById("stageLabel");
    const advance = document.getElementById("advanceBtn");
    const back = document.getElementById("backBtn");
    const brushBar = document.getElementById("brushBar");
    const glazeBar = document.getElementById("glazeBar");
    if (label) label.textContent = stageLabelText();
    const adv = ADVANCE_LABEL[cs];
    if (advance) {
        advance.hidden = !adv;
        if (adv) advance.textContent = adv;
    }
    if (back) back.hidden = cs === "wet" || cs === "glazed";
    if (brushBar) brushBar.hidden = cs !== "wet";
    if (glazeBar) glazeBar.hidden = !(cs === "bisque" || cs === "glazedRaw");
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

// --- Pointer → clay ---------------------------------------------
function bindSculpt(canvas) {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
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
    if (state.clayState !== "wet") return; // only wet clay can be thrown
    const p = pointerToProfile(ev);
    if (!p) return;
    if (p.y < -0.05 || p.y > TOP + 0.15) return;
    // Must grab near the current surface — taps in empty space, or
    // on the pot's front face well inside the silhouette, are ignored.
    if (Math.abs(p.r - radiusAt(p.y)) > GRAB_TOL) return;

    sculpting = true;
    try { state.canvas.setPointerCapture(ev.pointerId); } catch (_) {}
    sculptToward(p.y, p.r);
    ev.preventDefault();
}

function onPointerMove(ev) {
    if (!sculpting) return;
    const p = pointerToProfile(ev);
    if (p) sculptToward(p.y, p.r);
    ev.preventDefault();
}

function onPointerUp(ev) {
    if (!sculpting) return;
    sculpting = false;
    try { state.canvas.releasePointerCapture(ev.pointerId); } catch (_) {}
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
    // The wheel eases to a stop while a finger is down, so you can
    // target a band precisely, then drifts back up on release.
    const targetSpin = sculpting ? 0 : SPIN_SPEED;
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
