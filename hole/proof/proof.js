/* ============================================================
   Hole — physics proof (throwaway)
   ------------------------------------------------------------
   Proving the "do it right" approach: a REAL hole in the ground
   (the floor literally has a pit) + a REAL physics engine
   (cannon-es), so cubes lose support over the edge, teeter on the
   rim, and tumble in on their own. No "suck to centre + shrink".

   The hole is SQUARE here on purpose: the floor collider is four
   static boxes around the opening, which uses cannon-es's rock-solid
   box-vs-box path. (A first pass used a round Trimesh floor and every
   cube fell straight through — cannon-es box-vs-Trimesh contacts are
   unreliable.) A round hole is a follow-up once the FEEL is confirmed
   — convex pie-slices or a fixed trimesh — and doesn't change the loop.

   Cubes are dynamic boxes synced to meshes each frame.
   ============================================================ */

import * as THREE from "three";
import * as CANNON from "cannon-es";

// ---- Dimensions ------------------------------------------------
const R    = 3;    // hole half-width (opening is 2R x 2R)
const HALF = 10;   // floor is 2*HALF square
const PIT  = 8;    // visual pit depth
const CUBE = 1;    // cube edge
const HC   = CUBE / 2;
const G    = -20;  // gravity (snappy)

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

// ---- Ground with a real (square) hole, baked flat --------------
const shape = new THREE.Shape();
shape.moveTo(-HALF, -HALF);
shape.lineTo( HALF, -HALF);
shape.lineTo( HALF,  HALF);
shape.lineTo(-HALF,  HALF);
shape.closePath();
const holePath = new THREE.Path();           // wound opposite to the outline
holePath.moveTo(-R, -R);
holePath.lineTo( R, -R);
holePath.lineTo( R,  R);
holePath.lineTo(-R,  R);
holePath.closePath();
shape.holes.push(holePath);

const floorGeo = new THREE.ShapeGeometry(shape);
floorGeo.rotateX(-Math.PI / 2);  // lay flat in XZ at y=0
floorGeo.computeVertexNormals();
const floorMesh = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: 0x86c96a, roughness: 1, side: THREE.DoubleSide })
);
floorMesh.receiveShadow = true;
scene.add(floorMesh);

// Dark pit walls + floor (visual only — sells the depth).
const pitMat = new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 1, side: THREE.DoubleSide });
function addWall(x, z, ry) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, PIT), pitMat);
    m.position.set(x, -PIT / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    scene.add(m);
}
addWall(0, -R, 0);              // -Z wall
addWall(0,  R, Math.PI);       // +Z wall
addWall(-R, 0, Math.PI / 2);   // -X wall
addWall( R, 0, -Math.PI / 2);  // +X wall
const pitFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * R, 2 * R),
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

// Floor collider = four static boxes tiling the square MINUS the hole.
// Tops sit at y=0; the inner edges (x=+-R, z=+-R) are the rim to teeter on.
const floorBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: groundMat });
const SIDE = (HALF - R) / 2;          // half-depth of each border strip
const MID  = (HALF + R) / 2;          // strip centre offset from origin
const addStrip = (hx, hz, ox, oz) =>
    floorBody.addShape(new CANNON.Box(new CANNON.Vec3(hx, 1, hz)), new CANNON.Vec3(ox, -1, oz));
addStrip(HALF, SIDE, 0,  MID);   // +Z border  (x:-HALF..HALF, z:R..HALF)
addStrip(HALF, SIDE, 0, -MID);   // -Z border
addStrip(SIDE, R,  MID, 0);      // +X border  (z:-R..R, x:R..HALF)
addStrip(SIDE, R, -MID, 0);      // -X border
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

// Four deterministic cubes that demonstrate the whole rule:
//  A & D rest on solid ground, B drops straight through, C teeters in.
function spawnTest() {
    addCube(R + 1.3, HC + 0.02, 0,   false); // A: fully on the floor  -> rests
    addCube(0,       HC + 0.02, 0,   false); // B: dead over the hole  -> falls in
    addCube(R - 0.2, HC + 0.02, 0,   false); // C: straddling the rim  -> tips in
    addCube(-R - 2,  HC + 0.02, 2.2, false); // D: out on the floor     -> rests
}

// A messy pile dropped from a height, spanning the hole + the ground.
function dropCluster(n = 14) {
    for (let i = 0; i < n; i++) {
        addCube((Math.random() * 2 - 1) * (R + 2.6), 5 + Math.random() * 3, (Math.random() * 2 - 1) * (R + 2.6));
    }
}

function reset() { clearCubes(); spawnTest(); }

// ---- Manual orbit camera (drag to look around) -----------------
const camTarget = new THREE.Vector3(0, 0, 0);
let camAz = Math.PI * 0.16;
let camPolar = Math.PI * 0.34; // from +Y (smaller = more top-down)
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

let dragging = false, px = 0, py = 0;
canvas.addEventListener("pointerdown", e => { dragging = true; px = e.clientX; py = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} });
canvas.addEventListener("pointermove", e => {
    if (!dragging) return;
    camAz   -= (e.clientX - px) * 0.01;
    camPolar = Math.max(0.12, Math.min(1.35, camPolar - (e.clientY - py) * 0.01));
    px = e.clientX; py = e.clientY;
});
addEventListener("pointerup", () => { dragging = false; });

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
        if (c.body.position.y < -(PIT + 4)) { // fell through -> despawn
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
    return _up.angleTo(UP); // radians from upright; ~0 rests, large = tipped
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
    spawnTest, dropCluster, reset, clearCubes,
    cubes, world, scene, camera, THREE, CANNON,
};
