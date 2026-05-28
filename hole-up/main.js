/* ============================================================
   Hole-Up — the real game (manifest-driven)
   ------------------------------------------------------------
   REAL hole + REAL physics (cannon-es). The round pit is a
   KINEMATIC floor (NSEG wedge boxes, inner faces at radius R ->
   clean circle) that follows the hole position H every frame,
   sliding under a field of dynamic props. Props rest until the
   hole's gap reaches them, then teeter on the round rim and tumble
   in — emergent. Eating a prop grows the hole; the "right size to
   enter" rule is FREE (a prop bridges the rim until the hole is
   wider than it). Steering = instant-halt screen drag; the camera
   follows the hole so it stays centred and the world scrolls past.

   Content is data-driven:
     - manifest.json   = the food catalog (one row per item).
     - assets/levels/*.json = a placed/scattered scene.
   Add a food: drop a GLB into assets/Models/, add a manifest row.
   Author a level: open ?editor=1, place food, Save, drop the JSON
   into assets/levels/.

   Tunables live in `dev`; add ?dev for live sliders.
   ?editor=1 loads the hidden level designer (editor.js).
   ============================================================ */

import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const VERSION = "holeup2";   // cache-buster for fetched data + dynamic imports

// ---- Tunables --------------------------------------------------
const R0    = 0.9;   // starting hole radius
const ROUT  = 70;    // floor annulus outer radius (huge: always covers the field)
const NSEG  = 56;    // wedge count -> roundness of the rim
const PIT   = 10;    // pit depth
const G     = -22;   // gravity
const FIELD = 26;    // props scatter within this radius (default; a level can override)
const HMAX  = 26;    // hole roams within this radius
const RMAX  = 14;    // hole can't grow past this

// Weight -> in-game footprint (max horizontal size the model is scaled to).
// The "big enough to eat it" gate is emergent: a prop keeps support until the
// hole is wider than its footprint. Bigger footprint => more growth on eating.
const WEIGHT_FOOTPRINT = { tiny: 1.2, small: 2.2, medium: 3.6, large: 5.6, giant: 8.5 };

// Fallback level if assets/levels/<id>.json can't be fetched (e.g. file://).
// Mirrors the original prototype field exactly.
const DEFAULT_LEVEL = {
    id: "field",
    name: "Open Field",
    field: FIELD,
    items: [],
    scatter: [
        { weight: "tiny",   count: 70 },
        { weight: "small",  count: 38 },
        { weight: "medium", count: 16 },
        { weight: "large",  count: 7 },
    ],
};

// Live-tunable feel knobs. DEV_TUNABLES drives the self-building ?dev panel,
// so adding a knob = one row here + read dev.KEY where you need it.
const dev = {
    STEER:   1.0,   // 1.0 = the grabbed ground point stays under your finger (1:1)
    GROWTH:  0.01,  // hole radius gained per unit of swallowed footprint
    SUCTION: 25,    // pull toward the hole (constant force -> light food zips in, heavy resists)
    REACH:   3,     // suction radius as a multiple of the hole radius
    GRAVITY: 22,    // fall acceleration
};
const DEV_TUNABLES = [
    { key: "STEER",   label: "Steer",   min: 0.3,   max: 3,    step: 0.05 },
    { key: "GROWTH",  label: "Growth",  min: 0.005, max: 0.15, step: 0.005 },
    { key: "SUCTION", label: "Suction", min: 0,     max: 100,  step: 1 },
    { key: "REACH",   label: "Reach",   min: 1,     max: 6,    step: 0.25 },
    { key: "GRAVITY", label: "Gravity", min: 5,     max: 50,   step: 1 },
];

const params  = new URLSearchParams(location.search);
const EDITOR   = params.get("editor") === "1";
const LEVEL_ID = params.get("level") || "field";

// ---- Three: renderer / scene / camera --------------------------
const canvas   = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 600);

scene.add(new THREE.HemisphereLight(0xcfeaff, 0x4a6b3a, 0.85));
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
let R = R0;
let Rbuilt = -1;
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

// ---- Manifest + models -----------------------------------------
// protoByPath: each unique GLB loaded once, recentred on its bbox.
// Clones get scaled per-prop; the box collider comes from the scaled bbox.
const loader = new GLTFLoader();           // modelPath in the manifest is a full relative path
let MANIFEST = { items: [] };
const ITEMS = {};                          // id -> manifest item
const protoByPath = {};                    // modelPath -> { obj: centred Group, half: Vector3 }

async function loadManifest() {
    const res = await fetch("manifest.json?v=" + VERSION);
    if (!res.ok) throw new Error("manifest " + res.status);
    MANIFEST = await res.json();
    for (const it of MANIFEST.items) ITEMS[it.id] = it;
    if (MANIFEST.weights) for (const w in WEIGHT_FOOTPRINT) if (MANIFEST.weights[w] != null) WEIGHT_FOOTPRINT[w] = MANIFEST.weights[w];
}

async function loadModels() {
    const paths = [...new Set(MANIFEST.items.map(i => i.modelPath))];
    const results = await Promise.allSettled(paths.map(async path => {
        const gltf = await loader.loadAsync(path);
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        obj.position.sub(center);                       // recentre on bbox centre
        obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const wrap = new THREE.Group();
        wrap.add(obj);
        protoByPath[path] = { obj: wrap, half: size.multiplyScalar(0.5) };
    }));
    const failed = results.filter(r => r.status === "rejected").length;
    if (failed) console.warn(`[hole-up] ${failed} model(s) failed to load`);
}

// Footprint (max horizontal size) an item is scaled to: weight tier * the
// item's manifest scale * any per-placement scale override.
function footprintFor(item, scaleMul = 1) {
    return (WEIGHT_FOOTPRINT[item.weight] ?? WEIGHT_FOOTPRINT.small) * (item.scale ?? 1) * scaleMul;
}

function itemsByWeight(weight, includeLocked = false) {
    return MANIFEST.items
        .filter(i => i.weight === weight && protoByPath[i.modelPath] && (includeLocked || i.unlock == null))
        .map(i => i.id);
}

// ---- Props -----------------------------------------------------
let props = [];
let lingerers = [];   // multi-piece "linger" parts mid-sink (none of the stock food uses this)

function spawn(itemId, x, z, opts = {}) {
    const item = ITEMS[itemId];
    if (!item) return null;
    const proto = protoByPath[item.modelPath];
    if (!proto) return null;

    const target = footprintFor(item, opts.scale ?? 1);
    const modelFootprint = Math.max(proto.half.x, proto.half.z) * 2;
    const s = target / modelFootprint;
    const hx = proto.half.x * s, hy = proto.half.y * s, hz = proto.half.z * s;

    const mesh = proto.obj.clone(true);
    mesh.scale.setScalar(s);
    scene.add(mesh);

    const body = new CANNON.Body({ mass: target, material: cBox, allowSleep: true });
    body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    body.position.set(x, hy + 0.02, z);
    const rot = opts.rot != null ? opts.rot : Math.random() * Math.PI * 2;
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rot);
    body.sleepSpeedLimit = 0.4;
    body.sleepTimeLimit = 0.5;
    world.addBody(body);

    const p = { mesh, body, size: target, itemId, weight: item.weight, eat: item.eatAnimation || "single-piece", parts: item.parts || null, counted: false };
    props.push(p);
    return p;
}

function clearProps() {
    for (const p of props) { scene.remove(p.mesh); world.removeBody(p.body); }
    props = [];
    for (const L of lingerers) scene.remove(L.obj);
    lingerers = [];
}

// Multi-piece eat: detach the parts flagged `linger` so they hang at the rim
// and sink slower than the body. Stock food is all single-piece, so this is a
// dormant hook — it only fires for an item that opts in via the manifest.
const _wp = new THREE.Vector3(), _wq = new THREE.Quaternion(), _ws = new THREE.Vector3();
function onEaten(p) {
    if (p.eat !== "multi-piece" || !Array.isArray(p.parts)) return;
    for (const part of p.parts) {
        if (!part || !part.linger) continue;
        const child = p.mesh.getObjectByName(part.name);
        if (!child) continue;
        child.updateWorldMatrix(true, false);
        child.matrixWorld.decompose(_wp, _wq, _ws);
        child.parent.remove(child);
        child.position.copy(_wp);
        child.quaternion.copy(_wq);
        child.scale.copy(_ws);
        scene.add(child);
        lingerers.push({ obj: child, t: 0, dur: part.lingerDur ?? 1.2, y0: _wp.y });
    }
}

function runScatter(recipe, fieldR) {
    for (const row of recipe) {
        const pool = itemsByWeight(row.weight);
        if (!pool.length) continue;
        const target = WEIGHT_FOOTPRINT[row.weight] ?? 1.2;
        for (let i = 0; i < row.count; i++) {
            const id = pool[(Math.random() * pool.length) | 0];
            let x, z, d;
            do { x = (Math.random() * 2 - 1) * fieldR; z = (Math.random() * 2 - 1) * fieldR; d = Math.hypot(x, z); }
            while (d < R0 + target);
            spawn(id, x, z);
        }
    }
}

// ---- Levels ----------------------------------------------------
let currentLevel = DEFAULT_LEVEL;

function loadLevel(level) {
    currentLevel = level || DEFAULT_LEVEL;
    clearProps();
    R = R0; eaten = 0;
    H.set(0, 0, 0);
    rebuild(R);
    const fieldR = currentLevel.field ?? FIELD;
    if (Array.isArray(currentLevel.items))
        for (const it of currentLevel.items) spawn(it.id, it.x, it.z, { rot: it.rot, scale: it.scale });
    if (Array.isArray(currentLevel.scatter)) runScatter(currentLevel.scatter, fieldR);
    camera.position.set(0, 6 + R * 4, 5 + R * 3.2);
    hideHint(true);
}

async function fetchLevel(id) {
    try {
        const res = await fetch(`assets/levels/${id}.json?v=` + VERSION);
        if (!res.ok) return null;
        return await res.json();
    } catch (_) { return null; }
}

function reset() { loadLevel(currentLevel); }

// ---- Steering: 1:1 ground tracking (hole stays under the finger) -
// Each move, raycast the PREVIOUS and CURRENT cursor positions to the ground
// with the live camera and shift the hole by that exact ground delta. Both
// rays use the same camera, so the camera-follow can't feed back into the
// drag (no runaway drift), and a still finger gives a zero delta (instant
// halt). STEER multiplies it: 1.0 keeps the grabbed point under your finger.
let dragId = null, px = 0, py = 0;
let camHeight = 6 + R0 * 4;
const steerRay = new THREE.Raycaster();
const steerNDC = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _gA = new THREE.Vector3(), _gB = new THREE.Vector3();
function groundAtScreen(cx, cy, out) {
    steerNDC.x = (cx / window.innerWidth) * 2 - 1;
    steerNDC.y = -(cy / window.innerHeight) * 2 + 1;
    steerRay.setFromCamera(steerNDC, camera);
    return steerRay.ray.intersectPlane(groundPlane, out) ? out : null;
}
if (!EDITOR) {
    canvas.addEventListener("pointerdown", e => {
        if (dragId !== null) return;
        dragId = e.pointerId; px = e.clientX; py = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        hideHint();
    });
    canvas.addEventListener("pointermove", e => {
        if (e.pointerId !== dragId) return;
        const a = groundAtScreen(px, py, _gA);
        const b = groundAtScreen(e.clientX, e.clientY, _gB);
        if (a && b) {
            H.x += (b.x - a.x) * dev.STEER;
            H.z += (b.z - a.z) * dev.STEER;
            const d = Math.hypot(H.x, H.z);
            if (d > HMAX) { H.x *= HMAX / d; H.z *= HMAX / d; }
        }
        px = e.clientX; py = e.clientY;
    });
    const endDrag = e => { if (e.pointerId === dragId) dragId = null; };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
}

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
if (params.has("dev")) {
    const panel = document.getElementById("devPanel");
    const rows = document.getElementById("devRows");
    const fmt = v => (Math.round(v * 1000) / 1000).toString();
    for (const t of DEV_TUNABLES) {
        const row = document.createElement("div"); row.className = "dev-row";
        const out = document.createElement("span"); out.textContent = fmt(dev[t.key]);
        const label = document.createElement("label"); label.textContent = t.label + " "; label.appendChild(out);
        const input = document.createElement("input");
        input.type = "range"; input.min = t.min; input.max = t.max; input.step = t.step; input.value = dev[t.key];
        input.addEventListener("input", e => { dev[t.key] = parseFloat(e.target.value); out.textContent = fmt(dev[t.key]); });
        row.append(label, input);
        rows.appendChild(row);
    }
    panel.hidden = false;
    const msg = document.getElementById("devCopyMsg");
    document.getElementById("devCopy").addEventListener("click", async () => {
        const txt = DEV_TUNABLES.map(t => `${t.key}=${dev[t.key]}`).join(", ");
        try { await navigator.clipboard.writeText(txt); msg.textContent = "copied"; } catch (_) { msg.textContent = txt; }
        setTimeout(() => { msg.textContent = ""; }, 2500);
    });
}

// ---- Loop ------------------------------------------------------
function moveHole() { floorBody.position.set(H.x, 0, H.z); holeGroup.position.set(H.x, 0, H.z); }

const _suck = new CANNON.Vec3();
function frame(dt) {
    moveHole();
    world.gravity.y = -dev.GRAVITY;

    // Wake nearby props + apply suction. Suction is a CONSTANT force toward
    // the hole, so it's mass-responsive for free: friction is proportional to
    // mass, so light food slides in while heavy food barely budges until the
    // hole grows enough to physically reach it.
    const wakeR = R + 5;
    const reach = R * dev.REACH;
    for (const p of props) {
        const dx = H.x - p.body.position.x, dz = H.z - p.body.position.z;
        const d = Math.hypot(dx, dz);
        if (d < wakeR) p.body.wakeUp();
        if (dev.SUCTION > 0 && d > 1e-3 && d < reach) {
            const f = dev.SUCTION * (1 - d / reach);   // falloff: strong near centre
            _suck.set((dx / d) * f, 0, (dz / d) * f);
            p.body.applyForce(_suck);
            p.body.wakeUp();
        }
    }

    world.step(1 / 60, dt, 3);

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
            onEaten(p);
        }
        if (p.body.position.y < -(PIT + 5)) { scene.remove(p.mesh); world.removeBody(p.body); props.splice(i, 1); }
    }
    if (grew && R - Rbuilt > 0.08) rebuild(R);

    for (let i = lingerers.length - 1; i >= 0; i--) {
        const L = lingerers[i];
        L.t += dt;
        const k = Math.min(1, L.t / L.dur);
        L.obj.position.y = L.y0 - k * (PIT + 2);
        L.obj.rotation.z += dt * 1.5;
        if (k >= 1) { scene.remove(L.obj); lingerers.splice(i, 1); }
    }

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
    if (EDITOR) renderer.render(scene, camera);   // editor owns the camera + scene; no physics
    else frame(dt);
    requestAnimationFrame(loop);
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Boot ------------------------------------------------------
rebuild(R);
camera.position.set(0, 6 + R * 4, 5 + R * 3.2);
requestAnimationFrame(loop);

(async () => {
    try {
        await loadManifest();
    } catch (e) {
        console.error("[hole-up] could not load manifest.json", e);
        hintEl.textContent = "Could not load the food list.";
        return;
    }
    await loadModels();

    if (EDITOR) {
        const { initEditor } = await import("./editor.js?v=" + VERSION);
        initEditor(editorCtx());
    } else {
        const level = await fetchLevel(LEVEL_ID);
        loadLevel(level || DEFAULT_LEVEL);
        hintEl.innerHTML = "Drag to move the hole. Swallow food to grow &mdash; then you can eat bigger food!";
    }
})();

// ---- Editor context (passed to editor.js) ----------------------
// A visual-only place helper: clones + scales a model and rests it on the
// ground, NO physics body. The editor only ever moves these around.
function placeVisual(itemId, { x = 0, z = 0, rot = 0, scale = 1 } = {}) {
    const item = ITEMS[itemId];
    if (!item) return null;
    const proto = protoByPath[item.modelPath];
    if (!proto) return null;
    const target = footprintFor(item, scale);
    const modelFootprint = Math.max(proto.half.x, proto.half.z) * 2;
    const s = target / modelFootprint;
    const hy = proto.half.y * s;
    const mesh = proto.obj.clone(true);
    mesh.scale.setScalar(s);
    mesh.position.set(x, hy + 0.02, z);
    mesh.rotation.y = rot;
    scene.add(mesh);
    return { mesh, restY: hy + 0.02, footprint: target };
}

function editorCtx() {
    return {
        THREE, scene, camera, canvas, renderer, sun,
        items: MANIFEST.items,
        ITEMS,
        placeVisual,
        footprintFor,
        FIELD,
        version: VERSION,
    };
}

// ---- Debug handle (numeric verification) -----------------------
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function tiltOf(b) { _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w); _up.set(0, 1, 0).applyQuaternion(_q); return _up.angleTo(UP); }
const handle = {
    get size() { return R; },
    set size(r) { R = Math.min(RMAX, r); rebuild(R); },
    get eaten() { return eaten; },
    get remaining() { return props.length; },
    get loaded() { return Object.keys(protoByPath).length; },
    get items() { return MANIFEST.items.map(i => i.id); },
    get manifest() { return MANIFEST; },
    get level() { return currentLevel; },
    get hole() { return { x: +H.x.toFixed(2), z: +H.z.toFixed(2), r: +R.toFixed(2) }; },
    get cam() { return { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) }; },
    setHole(x, z) { H.set(x, 0, z); const d = Math.hypot(H.x, H.z); if (d > HMAX) { H.x *= HMAX / d; H.z *= HMAX / d; } },
    nearest(maxSize) { let best = null, bd = 1e9; for (const p of props) { if (maxSize && p.size > maxSize) continue; const d = Math.hypot(p.body.position.x - H.x, p.body.position.z - H.z); if (d < bd) { bd = d; best = p; } } return best ? { x: +best.body.position.x.toFixed(2), z: +best.body.position.z.toFixed(2), size: best.size, id: best.itemId, y: +best.body.position.y.toFixed(2) } : null; },
    step(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); },
    tiltOf,
    spawn, clearProps, runScatter, loadLevel, reset, dev,
    props, world, scene, camera, THREE, CANNON,
};
window.__holeup = handle;
window.__hole = handle;   // alias for older verification habits
