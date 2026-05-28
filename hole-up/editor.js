/* ============================================================
   Hole-Up — level designer (dev-only, behind ?editor=1)
   ------------------------------------------------------------
   Loaded dynamically by main.js only when ?editor=1 is present,
   so it costs nothing in normal play. Purely visual: placed food
   are scaled model clones resting on the ground — NO physics. The
   level JSON it produces (items: [{ id, x, z, rot, scale }]) is the
   same shape main.js reads from assets/levels/<id>.json.

   Flow: tap a food in the palette to arm it -> tap the field to drop
   it. Tap a placed item to select; drag to move; use the toolbar to
   rotate / scale / delete. The JSON panel updates live; Save Level
   downloads it, Load Level reads a file or pasted JSON.

   It's a dev tool — functional over polished.
   ============================================================ */

export function initEditor(ctx) {
    const { THREE, scene, camera, canvas, sun, items, ITEMS, placeVisual, footprintFor } = ctx;

    // ---- Take over the view from the game chrome ----------------
    for (const sel of [".hud", "#hint", "#resetBtn", "#devPanel", ".footer"]) {
        const el = document.querySelector(sel);
        if (el) el.style.display = "none";
    }
    // Overhead, slightly tilted camera that frames the whole field.
    camera.position.set(0, 60, 42);
    camera.lookAt(0, 0, 0);
    sun.position.set(20, 60, 14);
    sun.target.position.set(0, 0, 0);

    injectStyles();

    // ---- State --------------------------------------------------
    let armed = null;        // itemId currently "picked up" from the palette
    const placed = [];       // [{ id, x, z, rot, scale, mesh, restY }]
    let selected = null;     // a placed record
    let dragging = null;     // record being dragged
    let dragMoved = false;
    const meta = { id: "field", name: "Open Field" };

    // ---- Raycasting against the ground plane + placed meshes ----
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();

    function setRay(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
        ray.setFromCamera(ndc, camera);
    }
    function groundAt(clientX, clientY) {
        setRay(clientX, clientY);
        return ray.ray.intersectPlane(groundPlane, hitPt) ? hitPt.clone() : null;
    }
    function pickPlaced(clientX, clientY) {
        setRay(clientX, clientY);
        const hits = ray.intersectObjects(placed.map(p => p.mesh), true);
        if (!hits.length) return null;
        let o = hits[0].object;
        while (o && !o.userData.record) o = o.parent;
        return o ? o.userData.record : null;
    }

    // ---- Selection ring -----------------------------------------
    let ring = null;
    function showSelection(rec) {
        selected = rec;
        if (ring) { scene.remove(ring); ring.geometry.dispose(); ring = null; }
        toolbar.hidden = !rec;
        if (!rec) { syncFields(); return; }
        const fp = footprintFor(ITEMS[rec.id], rec.scale);
        const rr = fp * 0.6 + 0.4;
        ring = new THREE.Mesh(
            new THREE.RingGeometry(rr, rr + 0.25, 48),
            new THREE.MeshBasicMaterial({ color: 0xffe14d, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 999;
        ring.position.set(rec.x, 0.05, rec.z);
        scene.add(ring);
        syncFields();
    }
    function moveRing() { if (ring && selected) ring.position.set(selected.x, 0.05, selected.z); }

    // ---- Placed-item lifecycle ----------------------------------
    function tagMesh(rec) {
        rec.mesh.userData.record = rec;
        rec.mesh.traverse(o => { o.userData.record = rec; });
    }
    function addItem(id, x, z, rot = 0, scale = 1) {
        const v = placeVisual(id, { x, z, rot, scale });
        if (!v) return null;
        const rec = { id, x, z, rot, scale, mesh: v.mesh, restY: v.restY };
        tagMesh(rec);
        placed.push(rec);
        updateJSON();
        return rec;
    }
    function rebuildMesh(rec) {
        scene.remove(rec.mesh);
        const v = placeVisual(rec.id, { x: rec.x, z: rec.z, rot: rec.rot, scale: rec.scale });
        rec.mesh = v.mesh;
        rec.restY = v.restY;
        tagMesh(rec);
    }
    function deleteItem(rec) {
        const i = placed.indexOf(rec);
        if (i < 0) return;
        scene.remove(rec.mesh);
        placed.splice(i, 1);
        if (selected === rec) showSelection(null);
        updateJSON();
    }
    function clearAll() {
        for (const rec of placed) scene.remove(rec.mesh);
        placed.length = 0;
        showSelection(null);
        updateJSON();
    }

    // ---- Pointer: place / select / drag -------------------------
    canvas.addEventListener("pointerdown", e => {
        const rec = pickPlaced(e.clientX, e.clientY);
        if (rec) {
            showSelection(rec);
            dragging = rec; dragMoved = false;
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            return;
        }
        if (armed) {
            const g = groundAt(e.clientX, e.clientY);
            if (g) showSelection(addItem(armed, round(g.x), round(g.z)));
        } else {
            showSelection(null);
        }
    });
    canvas.addEventListener("pointermove", e => {
        if (!dragging) return;
        const g = groundAt(e.clientX, e.clientY);
        if (!g) return;
        dragMoved = true;
        dragging.x = round(g.x);
        dragging.z = round(g.z);
        dragging.mesh.position.x = dragging.x;
        dragging.mesh.position.z = dragging.z;
        moveRing();
        updateJSON();
    });
    const endDrag = e => { if (dragging) { dragging = null; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} } };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    // ---- DOM: palette / toolbar / JSON panel --------------------
    const palette = el("div", "hu-ed hu-palette");
    palette.appendChild(el("div", "hu-ed-title", "FOOD — tap to place"));
    const palWrap = el("div", "hu-pal-wrap");
    const palBtns = {};
    for (const it of items) {
        const b = el("button", "hu-pal-btn");
        b.type = "button";
        const lock = it.unlock != null ? " 🔒" : "";
        b.innerHTML = `<span class="hu-pal-name">${esc(it.displayName)}${lock}</span><span class="hu-pal-w">${esc(it.weight)}</span>`;
        b.addEventListener("click", () => {
            armed = (armed === it.id) ? null : it.id;
            for (const id in palBtns) palBtns[id].classList.toggle("is-armed", id === armed);
        });
        palBtns[it.id] = b;
        palWrap.appendChild(b);
    }
    palette.appendChild(palWrap);
    document.body.appendChild(palette);

    // Selection toolbar (rotate / scale / delete).
    const toolbar = el("div", "hu-ed hu-toolbar");
    toolbar.hidden = true;
    toolbar.appendChild(tbBtn("⟲", "rotate left", () => { if (!selected) return; selected.rot -= Math.PI / 12; selected.mesh.rotation.y = selected.rot; updateJSON(); }));
    toolbar.appendChild(tbBtn("⟳", "rotate right", () => { if (!selected) return; selected.rot += Math.PI / 12; selected.mesh.rotation.y = selected.rot; updateJSON(); }));
    toolbar.appendChild(tbBtn("−", "smaller", () => { if (!selected) return; selected.scale = clamp(selected.scale - 0.1, 0.25, 4); rebuildMesh(selected); showSelection(selected); updateJSON(); }));
    toolbar.appendChild(tbBtn("+", "bigger", () => { if (!selected) return; selected.scale = clamp(selected.scale + 0.1, 0.25, 4); rebuildMesh(selected); showSelection(selected); updateJSON(); }));
    toolbar.appendChild(tbBtn("🗑", "delete", () => { if (selected) deleteItem(selected); }));
    document.body.appendChild(toolbar);

    // JSON panel.
    const panel = el("div", "hu-ed hu-json");
    panel.appendChild(el("div", "hu-ed-title", "LEVEL JSON"));
    const metaRow = el("div", "hu-meta-row");
    const idIn = el("input", "hu-meta-in"); idIn.value = meta.id; idIn.placeholder = "id";
    const nameIn = el("input", "hu-meta-in"); nameIn.value = meta.name; nameIn.placeholder = "name";
    idIn.addEventListener("input", () => { meta.id = idIn.value.trim() || "level"; updateJSON(); });
    nameIn.addEventListener("input", () => { meta.name = nameIn.value; updateJSON(); });
    metaRow.append(idIn, nameIn);
    panel.appendChild(metaRow);

    const ta = el("textarea", "hu-json-ta");
    ta.spellcheck = false;
    panel.appendChild(ta);

    const count = el("div", "hu-count", "0 items");
    panel.appendChild(count);

    const btnRow = el("div", "hu-btn-row");
    btnRow.appendChild(actBtn("Save Level", saveLevel));
    const loadBtn = actBtn("Load File", () => fileIn.click());
    btnRow.appendChild(loadBtn);
    btnRow.appendChild(actBtn("Apply JSON", applyPasted));
    btnRow.appendChild(actBtn("Clear", () => { if (placed.length && confirm("Remove all placed food?")) clearAll(); }));
    panel.appendChild(btnRow);

    const fileIn = el("input"); fileIn.type = "file"; fileIn.accept = "application/json,.json"; fileIn.style.display = "none";
    fileIn.addEventListener("change", () => {
        const f = fileIn.files && fileIn.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => { loadFromText(reader.result); fileIn.value = ""; };
        reader.readAsText(f);
    });
    panel.appendChild(fileIn);
    document.body.appendChild(panel);

    // ---- Serialize / load ---------------------------------------
    function serialize() {
        return {
            id: meta.id,
            name: meta.name,
            items: placed.map(p => ({ id: p.id, x: p.x, z: p.z, rot: round3(p.rot), scale: round3(p.scale) })),
        };
    }
    function updateJSON() {
        ta.value = JSON.stringify(serialize(), null, 2);
        count.textContent = placed.length + (placed.length === 1 ? " item" : " items");
    }
    function syncFields() { idIn.value = meta.id; nameIn.value = meta.name; }

    function loadLevelObj(obj) {
        clearAll();
        meta.id = obj.id || "level";
        meta.name = obj.name || meta.id;
        syncFields();
        if (Array.isArray(obj.items))
            for (const it of obj.items) {
                if (!ITEMS[it.id]) { console.warn("[hole-up editor] unknown item id:", it.id); continue; }
                addItem(it.id, num(it.x), num(it.z), num(it.rot), it.scale != null ? num(it.scale) : 1);
            }
        // A scatter recipe isn't editable item-by-item; warn if present.
        if (Array.isArray(obj.scatter) && obj.scatter.length)
            console.warn("[hole-up editor] this level uses procedural 'scatter' — those items aren't shown; only hand-placed 'items' load into the editor.");
        updateJSON();
    }
    function loadFromText(text) {
        let obj;
        try { obj = JSON.parse(text); } catch (e) { alert("That isn't valid JSON:\n" + e.message); return; }
        loadLevelObj(obj);
    }
    function applyPasted() { loadFromText(ta.value); }
    function saveLevel() {
        const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = (meta.id || "level") + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    updateJSON();

    // Optionally seed the editor with a level via ?level=<id> (hand-placed items only).
    const startId = new URLSearchParams(location.search).get("level");
    if (startId) {
        fetch(`assets/levels/${startId}.json?v=` + (ctx.version || "1"))
            .then(r => r.ok ? r.json() : null)
            .then(obj => { if (obj) loadLevelObj(obj); })
            .catch(() => {});
    }

    // Expose for scripted verification.
    window.__holeupEditor = { serialize, loadLevelObj, addItem, placed, get selected() { return selected; } };

    // ---- helpers ------------------------------------------------
    function tbBtn(label, title, fn) { const b = el("button", "hu-tb-btn", label); b.type = "button"; b.title = title; b.addEventListener("click", fn); return b; }
    function actBtn(label, fn) { const b = el("button", "hu-act-btn", label); b.type = "button"; b.addEventListener("click", fn); return b; }
}

// ---- tiny DOM + math helpers ----------------------------------
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function round(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
function num(n) { const v = +n; return Number.isFinite(v) ? v : 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function injectStyles() {
    if (document.getElementById("hu-ed-style")) return;
    const s = document.createElement("style");
    s.id = "hu-ed-style";
    s.textContent = `
.hu-ed { position: fixed; z-index: 20; color: #fff; font: 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: rgba(16,19,26,0.82); border-radius: 12px; backdrop-filter: blur(4px); box-shadow: 0 6px 24px rgba(0,0,0,0.35); }
.hu-ed-title { font-size: 11px; letter-spacing: 0.08em; opacity: 0.7; padding: 8px 12px 4px; }
.hu-palette { top: 12px; left: 12px; width: 188px; max-height: 84vh; display: flex; flex-direction: column; }
.hu-pal-wrap { overflow-y: auto; padding: 4px 8px 10px; display: flex; flex-direction: column; gap: 5px; }
.hu-pal-btn { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%;
    padding: 8px 10px; font: inherit; color: #fff; text-align: left; cursor: pointer;
    background: rgba(255,255,255,0.08); border: 1px solid transparent; border-radius: 8px; }
.hu-pal-btn:hover { background: rgba(255,255,255,0.16); }
.hu-pal-btn.is-armed { background: #ffe14d; color: #10131a; border-color: #fff; font-weight: 600; }
.hu-pal-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hu-pal-w { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; opacity: 0.6; }
.hu-pal-btn.is-armed .hu-pal-w { opacity: 0.85; }
.hu-toolbar { top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; padding: 8px; }
.hu-tb-btn { width: 40px; height: 40px; font-size: 18px; color: #fff; cursor: pointer;
    background: rgba(255,255,255,0.12); border: none; border-radius: 9px; }
.hu-tb-btn:hover { background: rgba(255,255,255,0.22); }
.hu-tb-btn:active { transform: scale(0.94); }
.hu-json { right: 12px; bottom: 12px; width: 300px; max-width: 90vw; display: flex; flex-direction: column; padding-bottom: 10px; }
.hu-meta-row { display: flex; gap: 6px; padding: 4px 10px 6px; }
.hu-meta-in { flex: 1; min-width: 0; padding: 6px 8px; font: inherit; color: #fff;
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 7px; }
.hu-json-ta { margin: 0 10px; height: 210px; resize: vertical; padding: 8px; color: #cfe; font: 12px ui-monospace, Menlo, Consolas, monospace;
    background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; white-space: pre; }
.hu-count { padding: 6px 12px 2px; font-size: 11px; opacity: 0.7; }
.hu-btn-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px 0; }
.hu-act-btn { flex: 1; min-width: 64px; padding: 8px 6px; font: inherit; font-size: 12px; color: #fff; cursor: pointer;
    background: rgba(255,255,255,0.14); border: none; border-radius: 8px; }
.hu-act-btn:hover { background: rgba(255,255,255,0.24); }
.hu-act-btn:active { transform: scale(0.97); }
`;
    document.head.appendChild(s);
}
