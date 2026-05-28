/* ============================================================
   Hole — prototype (hole.io-style)
   ------------------------------------------------------------
   "Faked" hole: the ground is a solid plane and the hole is just
   a flat dark disk drawn on top of it. When a prop is swallowed it
   is pulled to the hole's centre, shrinks, spins, and sinks below
   y=0 — the opaque ground (and the dark disk over the centre) hide
   it on the way down, so it reads as falling into a pit. No stencil
   buffer, no physics engine.

   Control = relative drag: grab anywhere and the hole moves with
   your finger. It moves ONLY while you are actively dragging, so it
   halts the instant you stop moving or lift off (no glide / inertia).

   Size gate: a prop drops only when its whole footprint fits inside
   the opening (dist + propRadius <= holeR). A prop too big to fit is
   a SOLID BLOCK — the hole can't slide its centre under it, so it
   sits on the rim until the hole grows enough to swallow it.

   To use real 3D models later, swap the body of makeProp() to load
   a GLB with THREE's GLTFLoader and return the model instead of a
   cube. Nothing else in the eat/grow loop needs to change.
   ============================================================ */

import * as THREE from "three";

// ---- Tunables --------------------------------------------------
const GROUND      = 64;     // ground plane is GROUND x GROUND world units
const SPAWN_HALF  = 28;     // props scatter within +/- this from centre
const HOLE_START  = 1.1;    // starting hole radius
const GROWTH      = 0.10;   // hole radius gained per unit of prop size
// Feel tuning lives in `dev` so the ?dev slider panel can live-edit it.
const dev = {
    SENSITIVITY: 1.0,  // hole movement per unit of drag (1.0 = tracks finger 1:1)
    FIT_SLACK:   0.30, // how forgiving the "it fits" test is (world units)
};

// Prop tiers: bigger props need a bigger hole before they can be
// swallowed, which is the whole game loop — eat small, grow, eat big.
const TIERS = [
    { size: 0.8, color: 0x7bc86c, count: 64 }, // green  — tiny
    { size: 1.5, color: 0xf2b134, count: 30 }, // amber  — small
    { size: 2.6, color: 0xe8633a, count: 16 }, // orange — medium
    { size: 4.2, color: 0x8a63d2, count: 6  }, // purple — big
];

// ---- Renderer / scene / camera ---------------------------------
const canvas   = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 16, 14);

// ---- Lights ----------------------------------------------------
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x6b8f4e, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
scene.add(sun, sun.target);

// ---- Ground ----------------------------------------------------
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND, GROUND),
    new THREE.MeshStandardMaterial({ color: 0x8fcf6f })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---- The hole (flat dark disk that sits just above the ground) -
const hole = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshBasicMaterial({ color: 0x0c0e14 })
);
hole.rotation.x = -Math.PI / 2;
hole.position.y = 0.03; // hair above the ground so it wins the depth test
scene.add(hole);

const lim = GROUND / 2 - 1; // keep the hole inside the ground
let holeR  = HOLE_START;
let eaten  = 0;

function clampHole() {
    hole.position.x = Math.max(-lim, Math.min(lim, hole.position.x));
    hole.position.z = Math.max(-lim, Math.min(lim, hole.position.z));
}

// ---- Props -----------------------------------------------------
// Shared geometry + material per tier (cheap; props never mutate them).
const tierAssets = TIERS.map(t => ({
    geo: new THREE.BoxGeometry(t.size, t.size, t.size),
    mat: new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.85 }),
    size: t.size,
}));

let props = [];

function makeProp(tierIndex, x, z) {
    const a = tierAssets[tierIndex];
    const mesh = new THREE.Mesh(a.geo, a.mat);
    mesh.castShadow = true;
    mesh.position.set(x, a.size / 2, z); // rest flat on the ground
    mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);
    // half = footprint radius. The hole must be at least this wide to
    // admit the prop; until then the prop is a solid block.
    return { mesh, size: a.size, half: a.size * 0.5, falling: false };
}

function scatterProps() {
    for (const p of props) scene.remove(p.mesh);
    props = [];
    TIERS.forEach((t, i) => {
        for (let n = 0; n < t.count; n++) {
            let x, z;
            do {
                x = (Math.random() * 2 - 1) * SPAWN_HALF;
                z = (Math.random() * 2 - 1) * SPAWN_HALF;
            } while (Math.hypot(x, z) < 4); // keep the start clear
            props.push(makeProp(i, x, z));
        }
    });
}

function reset() {
    holeR = HOLE_START;
    eaten = 0;
    dragging = false;
    hole.position.set(0, 0.03, 0);
    scatterProps();
}

// ---- Pointer → relative drag -----------------------------------
// The hole moves by the change in the pointer's ground position while
// a drag is active. No drag motion = no movement, so releasing or
// holding still brings the hole to an immediate halt.
const ray         = new THREE.Raycaster();
const ndc         = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _g          = new THREE.Vector3(); // scratch: pointer ground point this event
const _last       = new THREE.Vector3(); // pointer ground point at the previous event
let   dragging    = false;

function groundAt(e, out) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(groundPlane, out) ? out : null;
}

canvas.addEventListener("pointerdown", e => {
    if (!groundAt(e, _last)) return;
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    hideHint();
});
canvas.addEventListener("pointermove", e => {
    if (!dragging) return;                 // only moves during an active drag
    if (!groundAt(e, _g)) return;
    hole.position.x += (_g.x - _last.x) * dev.SENSITIVITY;
    hole.position.z += (_g.z - _last.z) * dev.SENSITIVITY;
    clampHole();
    _last.copy(_g);
});
function endDrag(e) {
    if (!dragging) return;
    dragging = false;                      // immediate halt on release
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

const hintEl = document.getElementById("hint");
let hintGone = false;
function hideHint() {
    if (hintGone) return;
    hintGone = true;
    hintEl.classList.add("is-hidden");
}

document.getElementById("resetBtn").addEventListener("click", reset);

// ?dev tuning panel — hidden in normal play, shown when the URL has ?dev.
// Lets you dial in SENSITIVITY / FIT_SLACK live, then copy the values.
if (new URLSearchParams(location.search).has("dev")) {
    const panel   = document.getElementById("devPanel");
    const sens     = document.getElementById("devSens");
    const sensOut  = document.getElementById("devSensOut");
    const fit       = document.getElementById("devFit");
    const fitOut    = document.getElementById("devFitOut");
    const copy     = document.getElementById("devCopy");
    const copyMsg  = document.getElementById("devCopyMsg");

    panel.hidden = false;
    sens.value = dev.SENSITIVITY;
    sensOut.textContent = dev.SENSITIVITY.toFixed(1);
    fit.value = dev.FIT_SLACK;
    fitOut.textContent = dev.FIT_SLACK.toFixed(2);

    sens.addEventListener("input", e => {
        dev.SENSITIVITY = parseFloat(e.target.value);
        sensOut.textContent = dev.SENSITIVITY.toFixed(1);
    });
    fit.addEventListener("input", e => {
        dev.FIT_SLACK = parseFloat(e.target.value);
        fitOut.textContent = dev.FIT_SLACK.toFixed(2);
    });
    copy.addEventListener("click", async () => {
        const txt = `SENSITIVITY=${dev.SENSITIVITY}, FIT_SLACK=${dev.FIT_SLACK}`;
        try { await navigator.clipboard.writeText(txt); copyMsg.textContent = "copied"; }
        catch (_) { copyMsg.textContent = txt; }
        setTimeout(() => { copyMsg.textContent = ""; }, 2500);
    });
}

// ---- HUD -------------------------------------------------------
const hudSize  = document.getElementById("hudSize");
const hudEaten = document.getElementById("hudEaten");

// ---- Per-frame simulation + render -----------------------------
function frame(dt) {
    hole.scale.set(holeR, holeR, 1);

    for (let i = props.length - 1; i >= 0; i--) {
        const p = props[i];

        if (!p.falling) {
            const dxp = p.mesh.position.x - hole.position.x;
            const dzp = p.mesh.position.z - hole.position.z;
            const d = Math.hypot(dxp, dzp);

            if (holeR >= p.half && d + p.half <= holeR + dev.FIT_SLACK) {
                // The whole footprint fits inside the opening → it drops.
                p.falling = true;
                holeR += p.size * GROWTH;
                eaten++;
            } else if (holeR < p.half && d < p.half) {
                // Too big to fit → solid block: shove the hole's centre
                // back out to the prop's rim so it can't slide under.
                let nx = dxp, nz = dzp, nd = d;
                if (nd < 1e-4) { nx = 1; nz = 0; nd = 1; } // degenerate: pick a dir
                const push = p.half - d;
                hole.position.x -= (nx / nd) * push;
                hole.position.z -= (nz / nd) * push;
                clampHole();
            }
            continue;
        }

        // Falling: drag to centre, sink, shrink, tumble.
        const f = Math.min(1, dt * 10);
        p.mesh.position.x += (hole.position.x - p.mesh.position.x) * f;
        p.mesh.position.z += (hole.position.z - p.mesh.position.z) * f;
        p.mesh.position.y -= dt * 6;
        p.mesh.rotation.x += dt * 5;
        p.mesh.rotation.y += dt * 4;
        const s = p.mesh.scale.x - dt * 1.8;
        if (s <= 0.02 || p.mesh.position.y < -4) {
            scene.remove(p.mesh);
            props.splice(i, 1);
        } else {
            p.mesh.scale.setScalar(s);
        }
    }

    // Camera trails the hole and pulls back as it grows.
    const desiredH = 12 + holeR * 3.2;
    const desiredB = 8 + holeR * 2.6;
    const cl = Math.min(1, dt * 4);
    camera.position.x += (hole.position.x - camera.position.x) * cl;
    camera.position.y += (desiredH - camera.position.y) * cl;
    camera.position.z += (hole.position.z + desiredB - camera.position.z) * cl;
    camera.lookAt(hole.position.x, 0, hole.position.z);

    // Keep the sun (and its shadow frustum) over the action.
    sun.position.set(hole.position.x + 18, 32, hole.position.z + 12);
    sun.target.position.set(hole.position.x, 0, hole.position.z);

    hudSize.textContent = holeR.toFixed(1);
    hudEaten.textContent = String(eaten);

    renderer.render(scene, camera);
}

// ---- Loop ------------------------------------------------------
let last = performance.now();
function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); // clamp big tab-switch gaps
    last = now;
    frame(dt);
    requestAnimationFrame(loop);
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

scatterProps();
requestAnimationFrame(loop);

// ---- Debug handle (numeric verification; rAF is paused in hidden tabs) ----
window.__hole = {
    get size() { return holeR; },
    set size(r) { holeR = r; },             // force hole radius for testing the gate
    get eaten() { return eaten; },
    get remaining() { return props.length; },
    get pos() { return { x: +hole.position.x.toFixed(3), z: +hole.position.z.toFixed(3) }; },
    moveTo(x, z) { hole.position.x = x; hole.position.z = z; clampHole(); },
    drag(dx, dz) { hole.position.x += dx; hole.position.z += dz; clampHole(); }, // world-unit nudge
    list() { return props.map(p => ({ x: +p.mesh.position.x.toFixed(2), z: +p.mesh.position.z.toFixed(2), size: p.size, half: p.half, falling: p.falling })); },
    tick(dt = 0.016) { frame(dt); },
    step(n = 60, dt = 0.016) { for (let i = 0; i < n; i++) frame(dt); },
    reset,
    THREE, scene, camera, dev,
};
