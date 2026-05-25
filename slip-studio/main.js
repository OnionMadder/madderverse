/* ============================================================
   Slip Studio — scene foundation
   ------------------------------------------------------------
   Phase 0: render pipeline (renderer / camera / lights / loop).
   Phase 1: a lathe-turned pot on a slowly spinning wheel.

   Architecture notes for future phases:
   - `state` holds the long-lived scene objects so later phases
     (touch-to-sculpt, PBR/HDR, glazing, gallery) can reach them
     without re-querying the graph.
   - The pot + wheel live under `state.turntable`, a single group
     that owns the meditative rotation. Anything that should spin
     with the wheel gets parented here.
   - Tone mapping + colour space are set ACES/sRGB now so dropping
     in real PBR maps + an HDR environment later "just works".
   ============================================================ */

import * as THREE from "three";

const BG_COLOR    = 0x1b1815; // warm charcoal (matches CSS --bg)
const CLAY_COLOR  = 0xb87a5e; // natural terracotta
const WHEEL_COLOR = 0x2d2a26; // dark stone
const SPIN_SPEED  = 0.3;      // radians / second — contemplative, not nervous

const state = {
    renderer: null,
    scene: null,
    camera: null,
    turntable: null,
    clock: new THREE.Clock(),
};

init();

function init() {
    const canvas = document.getElementById("scene");

    // --- Renderer -------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    state.renderer = renderer;

    // --- Scene ----------------------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    state.scene = scene;

    // --- Camera ---------------------------------------------------
    // Pot centre sits near y≈0.7; frame it at a calm three-quarter
    // distance. OrbitControls arrive in Phase 6.
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 1.15, 4.1);
    camera.lookAt(0, 0.66, 0);
    state.camera = camera;

    buildLights(scene);

    // --- Turntable (pot + wheel spin together) --------------------
    const turntable = new THREE.Group();
    turntable.add(buildWheel());
    turntable.add(buildPot());
    scene.add(turntable);
    state.turntable = turntable;

    resize();
    window.addEventListener("resize", resize, { passive: true });

    // First frame, then reveal the scene and start the loop.
    renderer.render(scene, camera);
    hideLoader();
    renderer.setAnimationLoop(tick);
}

function buildLights(scene) {
    // Soft warm fill so shadowed clay never reads as black.
    const ambient = new THREE.AmbientLight(0xfff1e0, 0.55);
    scene.add(ambient);

    // Key: one warm directional light, casting the pot's shadow.
    const key = new THREE.DirectionalLight(0xfff0dc, 3.0);
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
    const geo = new THREE.CylinderGeometry(0.72, 0.76, height, 96);
    const mat = new THREE.MeshStandardMaterial({
        color: WHEEL_COLOR,
        roughness: 0.85,
        metalness: 0.0,
    });
    const wheel = new THREE.Mesh(geo, mat);
    wheel.position.y = -height / 2; // top face flush with y=0
    wheel.receiveShadow = true;
    wheel.castShadow = true;
    return wheel;
}

// A lathe-turned vase: narrow foot, full belly, tapered neck, small
// rim. Control points (radius, height) are smoothed through a spline
// so the silhouette is curvy rather than faceted.
function buildPot() {
    const controls = [
        [0.00, 0.00], // capped centre of the foot
        [0.30, 0.00], // foot outer edge (narrow foot)
        [0.33, 0.06], // foot lip
        [0.27, 0.16], // slight pinch above the foot
        [0.41, 0.34],
        [0.54, 0.58], // widest point of the belly
        [0.53, 0.74],
        [0.42, 0.92], // shoulder, taper begins
        [0.31, 1.08], // neck
        [0.30, 1.20],
        [0.35, 1.32], // small rim flare
        [0.33, 1.40], // rim lip
    ].map(([x, y]) => new THREE.Vector2(x, y));

    const profile = new THREE.SplineCurve(controls).getPoints(128);
    const geo = new THREE.LatheGeometry(profile, 96);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: CLAY_COLOR,
        roughness: 0.72,
        metalness: 0.0,
        side: THREE.DoubleSide, // open vase — render the inner wall too
    });

    const pot = new THREE.Mesh(geo, mat);
    pot.castShadow = true;
    pot.receiveShadow = true;
    return pot;
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
    state.renderer.render(state.scene, state.camera);
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.classList.add("is-hidden");
}
