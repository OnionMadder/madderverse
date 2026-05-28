/* ============================================================
   Hole — the real game (chunk 1: core loop)
   ------------------------------------------------------------
   REAL hole + REAL physics (cannon-es). The round pit is a
   KINEMATIC floor (NSEG wedge boxes, inner faces at radius R ->
   clean circle) that follows the hole position H every frame,
   sliding under a field of dynamic props. Props rest until the
   hole's gap reaches them, then teeter on the round rim and tumble
   in — emergent, no scripting. Eating a prop grows the hole.

   The "right size to enter" rule is FREE: a wide prop bridges a
   small hole (rests on the rim all around) and only falls once the
   hole is wider than it. Steering = instant-halt screen drag. The
   camera follows H, so the hole stays centred and the world scrolls
   past it (hole.io look).

   Placeholder cubes for now — swap makeMesh() to load .glb later.
   Tunables live in `dev`; add ?dev to the URL for live sliders.
   ============================================================ */

import * as THREE from "three";
import * as CANNON from "cannon-es";

// ---- Tunables --------------------------------------------------
const R0    = 0.9;   // starting hole radius
const ROUT  = 70;    // floor annulus outer radius (huge: always covers the field)
const NSEG  = 56;    // wedge count -> roundness of the rim
const PIT   = 10;    // pit depth
const G     = -22;   // gravity
const FIELD = 26;    // props scatter within this radius
const HMAX  = 26;    // hole roams within this radius
const RMAX  = 14;    // hole can't grow past this

const dev = {
    SENS:   0.045,  // steer sensitivity (world units per screen px, at base zoom)
    GROWTH: 0.045,  // hole radius gained per unit of swallowed prop size
};

// Prop tiers (size = cube edge; a prop falls once R exceeds ~its half-width).
const TIERS = [
    { size: 1.0, color: 0x7bc86c, count: 80 }, // tiny   — eat from the start
    { size: 2.0, color: 0xf2b134, count: 40 }, // small
    { size: 3.4, color: 0xe8633a, count: 18 }, // medium
    { size: 5.4, color: 0x8a63d2, count: 8  }, // large  — need to grow a lot
];

// ---- Three: renderer / scene / camera --------------------------
const canvas   = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 600);

scene.add(new THREE.HemisphereLight(0xcfeaff, 0x4a6b3a, 0.75));
const sun = new THREE.DirectionalLight(0xfff3df, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { near: 1, far: 120, left: -30, right: 30, top: 30, bottom: -30 });
scene.add(sun, sun.target);

// ---- Materials -------------------------------------------------
const groundMat   = new THREE.MeshStandardMaterial({ color: 0x86c96a, roughness: 1, side: THREE.DoubleSide });
const wallMat     = new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 1, side: THREE.BackSide });
const pitFloorMat = new THREE.MeshStandardMaterial({ color: 0x0b0d13, roughness: 1 });

// ---- Hole state ------------------------------------------------
const H = new THREE.Vector3(0, 0, 0);
let R = R0;        // current (target) hole radius
let Rbuilt = -1;   // radius the floor/visual were last built at
let eaten = 0;

// ---- cannon-es world -------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, G, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 16;
world.allowSleep = true;

const cGround = new CANNON.Material("g");
const cBox    = new CANNON.Material("b");
world.addContactMaterial(new CANNON.ContactMaterial(cGround, cBox, { friction: 0.5, restitution: 0.0 }));
world.addContactMaterial(new CANNON.ContactMaterial(cBox,    cBox, { friction: 0.3, restitution: 0.0 }));

// ---- Round floor (kinematic) + visual, rebuilt as R grows ------
const holeGroup = new THREE.Group();
scene.add(holeGroup);
let ringMesh, wallMesh, pitFloorMesh, floorBody;

function rebuild(r) {
    // visual
    for (const m of [ringMesh, wallMesh, pitFloorMesh]) if (m) { holeGroup.remove(m); m.geometry.dispose(); }
    ringMesh = new THREE.Mesh(new THREE.RingGeometry(r, ROUT, 120), groundMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.receiveShadow = true;
    wallMesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.78, PIT, 96, 1, true), wallMat);
    wallMesh.position.y = -PIT / 2;
    pitFloorMesh = new THREE.Mesh(new THREE.CircleGeometry(r * 0.78, 96), pitFloorMat);
    pitFloorMesh.rotation.x = -Math.PI / 2;
    pitFloorMesh.position.y = -PIT;
    holeGroup.add(ringMesh, wallMesh, pitFloorMesh);

    // physics
    if (floorBody) world.removeBody(floorBody);
    floorBody = new CANNON.Body({ type: CANNON.Body.KINEMATIC, material: cGround });
    const seg = (Math.PI * 2) / NSEG;
    const rMid = (r + ROUT) / 2;
    const radialHalf = (ROUT - r) / 2;
    const tangHalf = ROUT * Math.tan(seg / 2) * 1.12;
    for (let i = 0; i < NSEG; i++) {
        const a = i * seg;
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a);
        floorBody.addShape(
            new CANNON.Box(new CANNON.Vec3(radialHalf, 1, tangHalf)),
            new CANNON.Vec3(Math.cos(a) * rMid, -1, Math.sin(a) * rMid),
            q
        );
    }
    floorBody.position.set(H.x, 0, H.z);
    world.addBody(floorBody);
    Rbuilt = r;
}

// ---- Props -----------------------------------------------------
const tierGeo = TIERS.map(t => new THREE.BoxGeometry(t.size, t.size, t.size));
const tierMat = TIERS.map(t => new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.7 }));
let props = [];

// Swap THIS to load a .glb (return a mesh) when real models are ready.
function makeMesh(tier) {
    const m = new THREE.Mesh(tierGeo[tier], tierMat[tier]);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

function spawn(tier, x, z) {
    const size = TIERS[tier].size;
    const mesh = makeMesh(tier);
    scene.add(mesh);
    const body = new CANNON.Body({ mass: size, material: cBox, allowSleep: true });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)));
    body.position.set(x, size / 2 + 0.02, z);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.random() * Math.PI * 2);
    body.sleepSpeedLimit = 0.4;
    body.sleepTimeLimit = 0.5;
    world.addBody(body);
    props.push({ mesh, body, half: size / 2, size, counted: false });
}

function clearProps() {
    for (const p of props) { scene.remove(p.mesh); world.removeBody(p.body); }
    props = [];
}

function scatter() {
    TIERS.forEach((t, tier) => {
        for (let i = 0; i < t.count; i++) {
            let x, z, d;
            do { x = (Math.random() * 2 - 1) * FIELD; z = (Math.random() * 2 - 1) * FIELD; d = Math.hypot(x, z); }
            while (d < R0 + t.size); // keep the start clear
            spawn(tier, x, z);
        }
    });
}

function reset() {
    clearProps();
    R = R0; eaten = 0;
    H.set(0, 0, 0);
    rebuild(R);
    scatter();
    camera.position.set(0, 6 + R * 4, 5 + R * 3.2);
    hideHint(true);
}

// ---- Steering: instant-halt screen drag (single pointer) -------
let dragId = null, px = 0, py = 0;
let camHeight = 6 + R0 * 4;
const BASE_H = 6 + R0 * 4;
canvas.addEventListener("pointerdown", e => {
    if (dragId !== null) return;
    dragId = e.pointerId; px = e.clientX; py = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    hideHint();
});
canvas.addEventListener("pointermove", e => {
    if (e.pointerId !== dragId) return;           // single pointer; only moves while dragging
    const k = dev.SENS * (camHeight / BASE_H);    // keep the feel consistent as we zoom out
    H.x += (e.clientX - px) * k;
    H.z += (e.clientY - py) * k;
    const d = Math.hypot(H.x, H.z);
    if (d > HMAX) { H.x *= HMAX / d; H.z *= HMAX / d; }
    px = e.clientX; py = e.clientY;
});
function endDrag(e) { if (e.pointerId === dragId) dragId = null; }
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// ---- Hint ------------------------------------------------------
const hintEl = document.getElementById("hint");
let hintGone = false;
function hideHint(reShow) {
    if (reShow) { hintGone = false; hintEl.classList.remove("is-hidden"); return; }
    if (hintGone) return;
    hintGone = true;
    hintEl.classList.add("is-hidden");
}

// ---- HUD + reset ----------------------------------------------
const hudSize  = document.getElementById("hudSize");
const hudEaten = document.getElementById("hudEaten");
document.getElementById("resetBtn").addEventListener("click", reset);

// ---- ?dev sliders ----------------------------------------------
if (new URLSearchParams(location.search).has("dev")) {
    const panel = document.getElementById("devPanel");
    const sp = document.getElementById("devSpeed"), spOut = document.getElementById("devSpeedOut");
    const gr = document.getElementById("devGrow"),  grOut = document.getElementById("devGrowOut");
    const copy = document.getElementById("devCopy"), msg = document.getElementById("devCopyMsg");
    panel.hidden = false;
    sp.value = dev.SENS;   spOut.textContent = dev.SENS.toFixed(3);
    gr.value = dev.GROWTH; grOut.textContent = dev.GROWTH.toFixed(3);
    sp.addEventListener("input", e => { dev.SENS = parseFloat(e.target.value); spOut.textContent = dev.SENS.toFixed(3); });
    gr.addEventListener("input", e => { dev.GROWTH = parseFloat(e.target.value); grOut.textContent = dev.GROWTH.toFixed(3); });
    copy.addEventListener("click", async () => {
        const t = `SENS=${dev.SENS}, GROWTH=${dev.GROWTH}`;
        try { await navigator.clipboard.writeText(t); msg.textContent = "copied"; } catch (_) { msg.textContent = t; }
        setTimeout(() => { msg.textContent = ""; }, 2500);
    });
}

// ---- Loop ------------------------------------------------------
function moveHole() { floorBody.position.set(H.x, 0, H.z); holeGroup.position.set(H.x, 0, H.z); }

function frame(dt) {
    moveHole();

    // Wake props near the hole so they react when their support leaves.
    const wakeR = R + 5;
    for (const p of props) {
        if (Math.hypot(p.body.position.x - H.x, p.body.position.z - H.z) < wakeR) p.body.wakeUp();
    }

    world.step(1 / 60, dt, 3);

    // Sync meshes; count + grow on swallow; despawn at the bottom.
    let grew = false;
    for (let i = props.length - 1; i >= 0; i--) {
        const p = props[i];
        p.mesh.position.copy(p.body.position);
        p.mesh.quaternion.copy(p.body.quaternion);
        if (!p.counted && p.body.position.y < -1.5) {
            p.counted = true;
            eaten++;
            R = Math.min(RMAX, R + p.size * dev.GROWTH);
            grew = true;
        }
        if (p.body.position.y < -(PIT + 5)) { scene.remove(p.mesh); world.removeBody(p.body); props.splice(i, 1); }
    }
    if (grew && R - Rbuilt > 0.08) rebuild(R);

    // Camera follows H and pulls back as the hole grows.
    camHeight = 6 + R * 4;
    const camBack = 5 + R * 3.2;
    const cl = Math.min(1, dt * 3);
    camera.position.x += (H.x - camera.position.x) * cl;
    camera.position.y += (camHeight - camera.position.y) * cl;
    camera.position.z += (H.z + camBack - camera.position.z) * cl;
    camera.lookAt(H.x, 0, H.z);

    sun.position.set(H.x + 20, 36, H.z + 14);
    sun.target.position.set(H.x, 0, H.z);

    hudSize.textContent = R.toFixed(1);
    hudEaten.textContent = String(eaten);

    renderer.render(scene, camera);
}

let last = performance.now();
function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    requestAnimationFrame(loop);
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

rebuild(R);
scatter();
camera.position.set(0, 6 + R * 4, 5 + R * 3.2);
requestAnimationFrame(loop);

// ---- Debug handle (numeric verification) -----------------------
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function tiltOf(b) { _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w); _up.set(0, 1, 0).applyQuaternion(_q); return _up.angleTo(UP); }
window.__hole = {
    get size() { return R; },
    set size(r) { R = Math.min(RMAX, r); rebuild(R); },
    get eaten() { return eaten; },
    get remaining() { return props.length; },
    get hole() { return { x: +H.x.toFixed(2), z: +H.z.toFixed(2), r: +R.toFixed(2) }; },
    get cam() { return { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) }; },
    setHole(x, z) { H.set(x, 0, z); const d = Math.hypot(H.x, H.z); if (d > HMAX) { H.x *= HMAX / d; H.z *= HMAX / d; } },
    nearest(tierSize) { let best = null, bd = 1e9; for (const p of props) { if (tierSize && p.size !== tierSize) continue; const d = Math.hypot(p.body.position.x - H.x, p.body.position.z - H.z); if (d < bd) { bd = d; best = p; } } return best ? { x: +best.body.position.x.toFixed(2), z: +best.body.position.z.toFixed(2), size: best.size, y: +best.body.position.y.toFixed(2) } : null; },
    step(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); },
    spawn, clearProps, reset, dev,
    props, world, scene, camera, THREE, CANNON,
};
