/* ============================================================
   Hole — physics proof (throwaway), ROUND hole
   ------------------------------------------------------------
   Real pit + real physics (cannon-es): cubes rest, teeter on the
   rim, and tumble in — emergent, no scripting.

   ROUND hole done with BOXES (cannon-es's reliable path — a round
   Trimesh floor let every cube fall through). The floor is an
   annulus built from NSEG wedge-boxes: each box spans the full
   ring radius, rotated to its slice; their inner faces all sit at
   radius R, so the uncovered centre is a near-perfect circle (rim
   deviation < 0.3%). Robust box-vs-box contacts, clean round rim.

   Still FIXED + non-growing here — this proves the round opening +
   teeter. Moving/growing a round hole is the next proof.
   ============================================================ */

import * as THREE from "three";
import * as CANNON from "cannon-es";

// ---- Dimensions ------------------------------------------------
const R    = 3;    // hole radius (round)
const ROUT = 9;    // arena (annulus) outer radius
const NSEG = 48;   // floor wedge count -> roundness of the rim
const PIT  = 8;    // visual pit depth
const CUBE = 1;
const HC   = CUBE / 2;
const G    = -20;

// ---- Three: renderer / scene / camera --------------------------
const canvas   = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);

scene.add(new THREE.HemisphereLight(0xcfeaff, 0x4a6b3a, 0.7));
const sun = new THREE.DirectionalLight(0xfff3df, 2.0);
sun.position.set(9, 17, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { near: 1, far: 60, left: -14, right: 14, top: 14, bottom: -14 });
scene.add(sun, sun.target);

// ---- Visual: round ground (annulus) + round pit ---------------
const floorMesh = new THREE.Mesh(
    new THREE.RingGeometry(R, ROUT, 96),
    new THREE.MeshStandardMaterial({ color: 0x86c96a, roughness: 1, side: THREE.DoubleSide })
);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const pitWall = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R * 0.72, PIT, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 1, side: THREE.BackSide })
);
pitWall.position.y = -PIT / 2;
pitWall.receiveShadow = true;
scene.add(pitWall);
const pitFloor = new THREE.Mesh(
    new THREE.CircleGeometry(R * 0.72, 96),
    new THREE.MeshStandardMaterial({ color: 0x0b0d13, roughness: 1 })
);
pitFloor.rotation.x = -Math.PI / 2;
pitFloor.position.y = -PIT;
scene.add(pitFloor);

// ---- cannon-es world -------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, G, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 16;
world.allowSleep = true;

const groundMat = new CANNON.Material("ground");
const boxMat    = new CANNON.Material("box");
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, boxMat, { friction: 0.5, restitution: 0.0 }));
world.addContactMaterial(new CANNON.ContactMaterial(boxMat,    boxMat, { friction: 0.3, restitution: 0.0 }));

// Round floor = NSEG wedge boxes. Each box spans the ring radially
// (R..ROUT) and is rotated to its slice; inner faces all land at
// radius R, so the opening is a near-perfect circle. Tops at y=0.
const floorBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: groundMat });
const seg        = (Math.PI * 2) / NSEG;
const rMid       = (R + ROUT) / 2;
const radialHalf = (ROUT - R) / 2;
const tangHalf   = ROUT * Math.tan(seg / 2) * 1.12; // sized for the OUTER arc (+overlap) -> no gaps
for (let i = 0; i < NSEG; i++) {
    const a = i * seg;
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a); // local X -> radial direction at angle a
    floorBody.addShape(
        new CANNON.Box(new CANNON.Vec3(radialHalf, 1, tangHalf)),
        new CANNON.Vec3(Math.cos(a) * rMid, -1, Math.sin(a) * rMid),
        q
    );
}
world.addBody(floorBody);

// ---- Cubes (dynamic boxes <-> meshes) --------------------------
const cubeGeo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
const COLORS  = [0xff6b6b, 0xffd166, 0x6bcb77, 0x4d96ff, 0xc77dff, 0xff9f1c];
let cubes = [];

function addCube(x, y, z, jitter = true) {
    const mesh = new THREE.Mesh(cubeGeo, new THREE.MeshStandardMaterial({
        color: COLORS[(Math.random() * COLORS.length) | 0], roughness: 0.65,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 1, material: boxMat });
    body.addShape(new CANNON.Box(new CANNON.Vec3(HC, HC, HC)));
    body.position.set(x, y, z);
    if (jitter) body.quaternion.setFromEuler((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit  = 0.4;
    world.addBody(body);

    const c = { mesh, body };
    cubes.push(c);
    return c;
}

function clearCubes() {
    for (const c of cubes) { scene.remove(c.mesh); world.removeBody(c.body); }
    cubes = [];
}

// Four deterministic cubes demonstrating the rule on the ROUND rim:
//  A & D rest on the ring, B drops straight through, C teeters in.
function spawnTest() {
    addCube(R + 1.3, HC + 0.02, 0,   false); // A: on the ring        -> rests
    addCube(0,       HC + 0.02, 0,   false); // B: dead over the hole -> falls in
    addCube(R - 0.2, HC + 0.02, 0,   false); // C: straddling the rim -> tips in
    addCube(-R - 2,  HC + 0.02, 2.2, false); // D: out on the ring     -> rests
}

// A messy pile dropped from a height, spanning the hole + the ring.
function dropCluster(n = 14) {
    for (let i = 0; i < n; i++) {
        addCube((Math.random() * 2 - 1) * (R + 2.6), 5 + Math.random() * 3, (Math.random() * 2 - 1) * (R + 2.6));
    }
}

function reset() { clearCubes(); spawnTest(); }

// ---- Orbit camera (single pointer, viewport-scaled) ------------
const camTarget = new THREE.Vector3(0, 0, 0);
let camAz = Math.PI * 0.16;
let camPolar = Math.PI * 0.34;
const camR = 18;
function updateCamera() {
    const sp = Math.sin(camPolar);
    camera.position.set(
        camTarget.x + camR * sp * Math.sin(camAz),
        camTarget.y + camR * Math.cos(camPolar),
        camTarget.z + camR * sp * Math.cos(camAz)
    );
    camera.lookAt(camTarget);
}

let dragId = null, px = 0, py = 0;
canvas.addEventListener("pointerdown", e => {
    if (dragId !== null) return;          // ignore extra fingers
    dragId = e.pointerId; px = e.clientX; py = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener("pointermove", e => {
    if (e.pointerId !== dragId) return;
    camAz   -= (e.clientX - px) / window.innerWidth  * 2.2;
    camPolar = Math.max(0.12, Math.min(1.4, camPolar - (e.clientY - py) / window.innerHeight * 1.6));
    px = e.clientX; py = e.clientY;
});
function endOrbit(e) { if (e.pointerId === dragId) dragId = null; }
canvas.addEventListener("pointerup", endOrbit);
canvas.addEventListener("pointercancel", endOrbit);

// ---- Sync + loop -----------------------------------------------
function syncOne(c) {
    c.mesh.position.copy(c.body.position);
    c.mesh.quaternion.copy(c.body.quaternion);
}

let last = performance.now();
function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    world.step(1 / 60, dt, 3);
    for (let i = cubes.length - 1; i >= 0; i--) {
        const c = cubes[i];
        syncOne(c);
        if (c.body.position.y < -(PIT + 4)) {
            scene.remove(c.mesh); world.removeBody(c.body); cubes.splice(i, 1);
        }
    }
    updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

document.getElementById("dropBtn").addEventListener("click", () => dropCluster());
document.getElementById("resetBtn").addEventListener("click", reset);
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

spawnTest();
updateCamera();
requestAnimationFrame(loop);

// ---- Debug handle (deterministic stepping for verification) ----
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function tiltOf(body) {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    return _up.angleTo(UP);
}
window.__proof = {
    step(n = 60) { for (let i = 0; i < n; i++) world.step(1 / 60); cubes.forEach(syncOne); },
    list() {
        return cubes.map(c => ({
            x: +c.body.position.x.toFixed(2),
            y: +c.body.position.y.toFixed(2),
            z: +c.body.position.z.toFixed(2),
            tilt: +tiltOf(c.body).toFixed(2),
        }));
    },
    count() { return cubes.length; },
    spawn(x, y, z) { return addCube(x, y, z, false); },
    get camAngles() { return { az: +camAz.toFixed(3), polar: +camPolar.toFixed(3) }; },
    spawnTest, dropCluster, reset, clearCubes,
    cubes, world, scene, camera, THREE, CANNON,
};
