/* ============================================================
   Hole — prototype (hole.io-style)
   ------------------------------------------------------------
   "Faked" hole: the ground is a solid plane and the hole is just
   a flat dark disk drawn on top of it. When a prop is swallowed it
   is pulled to the hole's centre, shrinks, spins, and sinks below
   y=0 — the opaque ground (and the dark disk over the centre) hide
   it on the way down, so it reads as falling into a pit. No stencil
   buffer, no physics engine.

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
// Movement tuning lives in `dev` so the ?dev slider panel can live-edit it.
const dev = {
    MOVE_SPEED:   5,    // hole travel speed (world units/sec) — calm, kid-paced
    SPEED_GROWTH: 0.35, // gentle speed gain as the hole grows
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

let holeR = HOLE_START;
let eaten = 0;

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
    return { mesh, size: a.size, swallowR: a.size * 0.62, falling: false };
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
    hole.position.set(0, 0.03, 0);
    target.set(0, 0, 0);
    scatterProps();
}

// ---- Pointer → ground target -----------------------------------
const ray         = new THREE.Raycaster();
const ndc         = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const target      = new THREE.Vector3();
const _hit        = new THREE.Vector3();

function aim(e) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(groundPlane, _hit)) target.copy(_hit);
    hideHint();
}

canvas.addEventListener("pointermove", aim);
canvas.addEventListener("pointerdown", aim);

const hintEl = document.getElementById("hint");
let hintGone = false;
function hideHint() {
    if (hintGone) return;
    hintGone = true;
    hintEl.classList.add("is-hidden");
}

document.getElementById("resetBtn").addEventListener("click", reset);

// ?dev tuning panel — hidden in normal play, shown when the URL has ?dev.
// Lets you dial in MOVE_SPEED / SPEED_GROWTH live, then copy the values.
if (new URLSearchParams(location.search).has("dev")) {
    const panel   = document.getElementById("devPanel");
    const move    = document.getElementById("devMove");
    const moveOut = document.getElementById("devMoveOut");
    const grow    = document.getElementById("devGrow");
    const growOut = document.getElementById("devGrowOut");
    const copy    = document.getElementById("devCopy");
    const copyMsg = document.getElementById("devCopyMsg");

    panel.hidden = false;
    move.value = dev.MOVE_SPEED;
    moveOut.textContent = dev.MOVE_SPEED.toFixed(1);
    grow.value = dev.SPEED_GROWTH;
    growOut.textContent = dev.SPEED_GROWTH.toFixed(2);

    move.addEventListener("input", e => {
        dev.MOVE_SPEED = parseFloat(e.target.value);
        moveOut.textContent = dev.MOVE_SPEED.toFixed(1);
    });
    grow.addEventListener("input", e => {
        dev.SPEED_GROWTH = parseFloat(e.target.value);
        growOut.textContent = dev.SPEED_GROWTH.toFixed(2);
    });
    copy.addEventListener("click", async () => {
        const txt = `MOVE_SPEED=${dev.MOVE_SPEED}, SPEED_GROWTH=${dev.SPEED_GROWTH}`;
        try { await navigator.clipboard.writeText(txt); copyMsg.textContent = "copied"; }
        catch { copyMsg.textContent = txt; }
        setTimeout(() => { copyMsg.textContent = ""; }, 2500);
    });
}

// ---- HUD -------------------------------------------------------
const hudSize  = document.getElementById("hudSize");
const hudEaten = document.getElementById("hudEaten");

// ---- Per-frame simulation + render -----------------------------
const lim = GROUND / 2 - 1;

function frame(dt) {
    // Steady capped glide toward the pointer's spot on the ground —
    // calm and kid-paced, instead of snapping to the cursor.
    const dx = target.x - hole.position.x;
    const dz = target.z - hole.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-4) {
        const step = Math.min(dist, (dev.MOVE_SPEED + holeR * dev.SPEED_GROWTH) * dt);
        hole.position.x += (dx / dist) * step;
        hole.position.z += (dz / dist) * step;
    }
    hole.position.x = Math.max(-lim, Math.min(lim, hole.position.x));
    hole.position.z = Math.max(-lim, Math.min(lim, hole.position.z));
    hole.scale.set(holeR, holeR, 1);

    // Eat + fall.
    for (let i = props.length - 1; i >= 0; i--) {
        const p = props[i];
        if (!p.falling) {
            const d = Math.hypot(p.mesh.position.x - hole.position.x, p.mesh.position.z - hole.position.z);
            if (holeR >= p.swallowR && d < holeR) {
                p.falling = true;
                holeR += p.size * GROWTH;
                eaten++;
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
    get eaten() { return eaten; },
    get remaining() { return props.length; },
    moveTo(x, z) { target.set(x, 0, z); hole.position.x = x; hole.position.z = z; },
    aimAt(x, z) { target.set(x, 0, z); },
    get pos() { return { x: +hole.position.x.toFixed(3), z: +hole.position.z.toFixed(3) }; },
    tick(dt = 0.016) { frame(dt); },
    step(n = 60, dt = 0.016) { for (let i = 0; i < n; i++) frame(dt); },
    reset,
    THREE, scene, camera, dev,
};
