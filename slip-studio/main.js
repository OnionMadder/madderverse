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
const MIN_R       = 0.06; // clay can't pinch to nothing
const MAX_R       = 0.95; // belly may bulge this wide (wider than the wheel)
const GRAB_TOL    = 0.30; // must start the drag this close to the surface
const BRUSH_SIGMA = 0.13; // vertical softness of the pull, world units
const STRENGTH    = 0.5;  // how hard each move pulls toward the finger

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
const CLAY_STATES = {
    wet:     { label: "Wet clay",     color: 0xa3674a, roughness: 0.48, clearcoat: 0.40, clearcoatRoughness: 0.45, envMapIntensity: 0.85, action: "Firm up",   next: "leather" },
    leather: { label: "Leather-hard", color: 0xb87a5e, roughness: 0.72, clearcoat: 0.05, clearcoatRoughness: 0.90, envMapIntensity: 0.60, action: "Dry",       next: "bonedry" },
    bonedry: { label: "Bone-dry",     color: 0xc9a98c, roughness: 0.95, clearcoat: 0.02, clearcoatRoughness: 1.00, envMapIntensity: 0.38, action: "Fire",      next: "fired"   },
    fired:   { label: "Fired",        color: 0xbf6a45, roughness: 0.66, clearcoat: 0.10, clearcoatRoughness: 0.75, envMapIntensity: 0.55, action: "New pot",   next: null      },
};
const INITIAL_STATE = "wet";

const state = {
    renderer: null,
    scene: null,
    camera: null,
    canvas: null,
    turntable: null,
    pot: null,
    clayMaterial: null,
    clayState: INITIAL_STATE,   // wet | leather | bonedry | fired
    clayTarget: null,           // material params currently tweening toward
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

    const trimBtn = document.getElementById("trimFoot");
    if (trimBtn) trimBtn.addEventListener("click", trimFoot);
    const advanceBtn = document.getElementById("advanceBtn");
    if (advanceBtn) advanceBtn.addEventListener("click", advanceStage);
    setClayState(INITIAL_STATE); // sets the tween target + toolbar

    // First frame, then reveal the scene and start the loop.
    renderer.render(scene, camera);
    hideLoader();
    renderer.setAnimationLoop(tick);

    // Dev handle (inert unless the URL carries ?dev) — used to drive
    // and inspect the sculpt during testing across the build.
    if (location.search.includes("dev")) {
        window.__slip = {
            state, profile, radiusAt, sculptToward, maxRadiusAt, trimFoot,
            setClayState, advanceStage,
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
        side: THREE.DoubleSide, // open vase — render the inner wall too
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
    const sigmaRows = (BRUSH_SIGMA / TOP) * ROWS;
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

function smoothstep(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
}

// Finishing pass (like trimming a foot at the leather-hard stage):
// shape the base into a flat contact ring, an undercut "ankle" just
// above it, then a smooth blend into the body. The pot then visibly
// stands on a foot. The bottom stays a closed solid form — the foot
// is an outer-silhouette feature, which is what's seen on the wheel.
function trimFoot() {
    if (state.clayState !== "leather") return; // trimmed at leather-hard
    const baseTopY  = 0.022; // flat contact base up to here
    const ankleY    = 0.058; // deepest point of the undercut
    const blendTopY = 0.16;  // foot rejoins the body here
    const bodyR = radiusAt(blendTopY);
    const rFoot = THREE.MathUtils.clamp(bodyR * 0.96, 0.20, BASE_MAX);
    const rTuck = Math.max(MIN_R + 0.02, rFoot * 0.74);

    for (let r = 0; r <= ROWS; r++) {
        const y = (r / ROWS) * TOP;
        if (y > blendTopY) break;
        if (y <= baseTopY) {
            profile[r] = rFoot;
        } else if (y <= ankleY) {
            profile[r] = THREE.MathUtils.lerp(
                rFoot, rTuck, smoothstep((y - baseTopY) / (ankleY - baseTopY)));
        } else {
            profile[r] = THREE.MathUtils.lerp(
                rTuck, bodyR, smoothstep((y - ankleY) / (blendTopY - ankleY)));
        }
    }
    clampProfile(); // keeps the center cap + the wheel limit
    profileDirty = true;
}

// --- Material states (wet → leather → bone-dry → fired) ---------

// Switch to a clay state: point the material tween at its look and
// refresh the toolbar (which gates sculpt/trim and labels the action).
function setClayState(name) {
    if (!CLAY_STATES[name]) return;
    state.clayState = name;
    state.clayTarget = CLAY_STATES[name];
    updateToolbar();
}

// The single forward control: advance to the next state, or — once
// fired — start a fresh wet pot.
function advanceStage() {
    const def = CLAY_STATES[state.clayState];
    if (def.next) {
        setClayState(def.next);
    } else {
        seedProfile();          // fresh silhouette
        profileDirty = true;
        setClayState(INITIAL_STATE);
    }
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
}

// Reflect the current state in the toolbar: stage label, the
// advance-button text, and whether "Trim foot" is offered.
function updateToolbar() {
    const def = CLAY_STATES[state.clayState];
    const label = document.getElementById("stageLabel");
    const advance = document.getElementById("advanceBtn");
    const trim = document.getElementById("trimFoot");
    if (label) label.textContent = def.label;
    if (advance) advance.textContent = def.action;
    if (trim) trim.hidden = state.clayState !== "leather"; // trim at leather-hard
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
    state.turntable.rotation.y += SPIN_SPEED * dt;
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
