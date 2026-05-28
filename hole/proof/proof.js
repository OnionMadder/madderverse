/* ============================================================
   Hole — physics proof (throwaway): MOVING round hole (treadmill)
   ------------------------------------------------------------
   Proves the steering mechanic for the real game. The round pit
   is a KINEMATIC floor body (48 wedge boxes, inner faces at radius
   R -> clean circle). It is repositioned to the hole position H
   every frame, sliding UNDER a field of fixed dynamic props. A
   prop rests until the hole's gap reaches it, then loses support,
   teeters on the round rim, and tumbles in — all emergent.

   Because the floor's velocity stays zero (we set position, never
   velocity), it does NOT drag props sideways; the hole simply
   arrives and removes their support. Steering = instant-halt drag
   (H only changes on active pointer motion). "Grow" rebuilds the
   ring at a larger radius.

   Camera is fixed over the field so you can watch the hole roam
   and eat. (The real game will re-center the hole + scroll instead.)
   ============================================================ */

import * as THREE from "three";
import * as CANNON from "cannon-es";

// ---- Dimensions ------------------------------------------------
const R0   = 3;     // starting hole radius
const ROUT = 50;    // floor annulus outer radius (huge: always covers the field)
const NSEG = 48;    // wedge count -> roundness of the rim
const PIT  = 8;
const CUBE = 1;
const HC   = CUBE / 2;
const G    = -20;
const FIELD = 14;   // props scattered within this radius
const HMAX  = 14;   // hole roams within this radius of origin
let R = R0;

// ---- Three: renderer / scene / fixed camera --------------------
const canvas   = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 30, 25);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xcfeaff, 0x4a6b3a, 0.7));
const sun = new THREE.DirectionalLight(0xfff3df, 2.0);
sun.position.set(14, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { near: 1, far: 90, left: -28, right: 28, top: 28, bottom: -28 });
scene.add(sun, sun.target);

// ---- Materials -------------------------------------------------
const groundMat   = new THREE.MeshStandardMaterial({ color: 0x86c96a, roughness: 1, side: THREE.DoubleSide });
const wallMat     = new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 1, side: THREE.BackSide });
const pitFloorMat = new THREE.MeshStandardMaterial({ color: 0x0b0d13, roughness: 1 });

// ---- Hole position (what the player steers) --------------------
const H = new THREE.Vector3(0, 0, 0);

// ---- Visual: ground ring + pit, grouped, follows H -------------
const holeGroup = new THREE.Group();
scene.add(holeGroup);
let ringMesh, wallMesh, pitFloorMesh;
function buildVisual(r) {
    for (const m of [ringMesh, wallMesh, pitFloorMesh]) if (m) { holeGroup.remove(m); m.geometry.dispose(); }
    ringMesh = new THREE.Mesh(new THREE.RingGeometry(r, ROUT, 96), groundMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.receiveShadow = true;
    wallMesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.72, PIT, 96, 1, true), wallMat);
    wallMesh.position.y = -PIT / 2;
    pitFloorMesh = new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 96), pitFloorMat);
    pitFloorMesh.rotation.x = -Math.PI / 2;
    pitFloorMesh.position.y = -PIT;
    holeGroup.add(ringMesh, wallMesh, pitFloorMesh);
}

// ---- cannon-es world -------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, G, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 16;

const cGround = new CANNON.Material("g");
const cBox    = new CANNON.Material("b");
world.addContactMaterial(new CANNON.ContactMaterial(cGround, cBox, { friction: 0.5, restitution: 0.0 }));
world.addContactMaterial(new CANNON.ContactMaterial(cBox,    cBox, { friction: 0.3, restitution: 0.0 }));

// Kinematic round floor (rebuilt on grow). Repositioned to H each frame.
let floorBody = null;
function buildFloor(r) {
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
}

// ---- Props (dynamic boxes at FIXED world positions) ------------
const cubeGeo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
const COLORS  = [0xff6b6b, 0xffd166, 0x6bcb77, 0x4d96ff, 0xc77dff, 0xff9f1c];
let props = [];

function spawn(x, z) {
    const mesh = new THREE.Mesh(cubeGeo, new THREE.MeshStandardMaterial({
        color: COLORS[(Math.random() * COLORS.length) | 0], roughness: 0.65,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const body = new CANNON.Body({ mass: 1, material: cBox, allowSleep: false });
    body.addShape(new CANNON.Box(new CANNON.Vec3(HC, HC, HC)));
    body.position.set(x, HC + 0.02, z);
    world.addBody(body);
    const p = { mesh, body };
    props.push(p);
    return p;
}

function clearProps() {
    for (const p of props) { scene.remove(p.mesh); world.removeBody(p.body); }
    props = [];
}

function scatter(n = 40) {
    for (let i = 0; i < n; i++) {
        let x, z, d;
        do { x = (Math.random() * 2 - 1) * FIELD; z = (Math.random() * 2 - 1) * FIELD; d = Math.hypot(x, z); }
        while (d < R + 2 || d > FIELD);
        spawn(x, z);
    }
}

function reset() { clearProps(); R = R0; H.set(0, 0, 0); buildFloor(R); buildVisual(R); scatter(); }
function grow(step = 0.75) { R = Math.min(R + step, 9); buildFloor(R); buildVisual(R); }

// ---- Steering: instant-halt relative drag (fixed camera) -------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _g = new THREE.Vector3();
const _last = new THREE.Vector3();
let dragId = null;

function groundAt(e, out) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(groundPlane, out) ? out : null;
}
function clampH() {
    const d = Math.hypot(H.x, H.z);
    if (d > HMAX) { H.x *= HMAX / d; H.z *= HMAX / d; }
}
canvas.addEventListener("pointerdown", e => {
    if (dragId !== null) return;
    if (!groundAt(e, _last)) return;
    dragId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener("pointermove", e => {
    if (e.pointerId !== dragId) return;       // single pointer; moves only while dragging
    if (!groundAt(e, _g)) return;
    H.x += _g.x - _last.x;                     // 1:1 with the ground under your finger
    H.z += _g.z - _last.z;
    clampH();
    _last.copy(_g);
});
function endDrag(e) { if (e.pointerId === dragId) dragId = null; }
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// ---- Buttons + resize ------------------------------------------
document.getElementById("growBtn").addEventListener("click", () => grow());
document.getElementById("resetBtn").addEventListener("click", reset);
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Loop ------------------------------------------------------
function moveHoleTo(p) { floorBody.position.set(p.x, 0, p.z); holeGroup.position.set(p.x, 0, p.z); }
function syncProps() { for (const p of props) { p.mesh.position.copy(p.body.position); p.mesh.quaternion.copy(p.body.quaternion); } }

let last = performance.now();
function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    moveHoleTo(H);
    world.step(1 / 60, dt, 3);
    for (let i = props.length - 1; i >= 0; i--) {
        const p = props[i];
        p.mesh.position.copy(p.body.position);
        p.mesh.quaternion.copy(p.body.quaternion);
        if (p.body.position.y < -(PIT + 4)) { scene.remove(p.mesh); world.removeBody(p.body); props.splice(i, 1); }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

buildFloor(R);
buildVisual(R);
scatter();
requestAnimationFrame(loop);

// ---- Debug handle (deterministic verification) -----------------
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function tiltOf(b) {
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    return _up.angleTo(UP);
}
window.__proof = {
    setHole(x, z) { H.set(x, 0, z); clampH(); },
    step(n = 60) { for (let i = 0; i < n; i++) { moveHoleTo(H); world.step(1 / 60); } syncProps(); },
    list() { return props.map(p => ({ x: +p.body.position.x.toFixed(2), y: +p.body.position.y.toFixed(2), z: +p.body.position.z.toFixed(2), tilt: +tiltOf(p.body).toFixed(2) })); },
    get hole() { return { x: +H.x.toFixed(2), z: +H.z.toFixed(2), r: R }; },
    count() { return props.length; },
    spawn, clearProps, scatter, grow, reset,
    props, world, scene, camera, THREE, CANNON,
};
