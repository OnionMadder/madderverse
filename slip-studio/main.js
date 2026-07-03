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

// --- View (dolly-zoom toward the pot + manual spin) -------------
const CAM_BASE    = new THREE.Vector3(0, 1.15, 4.1); // camera at zoom = 1
const CAM_TARGET  = new THREE.Vector3(0, 0.66, 0);
// Pulled-back framing for the assembled set view (lid on pot).
const CAM_ASSEMBLED_BASE   = new THREE.Vector3(0, 1.85, 5.6);
const CAM_ASSEMBLED_TARGET = new THREE.Vector3(0, 1.35, 0);
const ZOOM_MIN    = 1, ZOOM_MAX = 3.2;
const ROTATE_SENS = 0.009;    // radians of pot spin per px of drag

// --- Pot surface resolution + bounds ----------------------------
const ROWS = 160;   // height segments (vertical)
const COLS = 128;   // radial segments (around)
const TOP  = 1.40;  // pot height in world units; foot sits at y=0

// --- Sculpt feel ------------------------------------------------
// Pot height range — how far the user can pull the rim up or push
// it down via the Taller / Shorter buttons. Applied as a Group
// scale on potGroup, so it's purely visual — sculpt math stays in
// the unchanged profile coordinate system. Declared up here (with
// the other shape-knob constants) so the toolbar's first init-time
// updateToolbar call doesn't hit a temporal-dead-zone reference.
const MIN_HEIGHT_SCALE = 0.70;
const MAX_HEIGHT_SCALE = 1.70;
const HEIGHT_STEP      = 0.08;

const MIN_R    = 0.06; // clay can't pinch to nothing
const MAX_R    = 0.95; // belly may bulge this wide (wider than the wheel)
const GRAB_TOL = 0.26; // must start the drag this close to the surface
const STRENGTH = 0.08; // soft lerp toward the finger; clay LAGS, not snaps

// World-units-per-second caps on how fast the silhouette may move
// under a sustained drag. The lerp above is the "how much the clay
// wants to follow"; this cap is the "how fast clay actually can move"
// — so a big finger jump still pulls clay toward it but smears over
// many frames instead of teleporting. Real wet stoneware has the same
// finger-leads-the-clay feel on a wheel. Trim is firmer because its
// loop tool bites into leather-hard with more conviction.
const SCULPT_RATE_MAX = 0.30;
const TRIM_RATE_MAX   = 0.42;
let lastSculptT = 0, lastTrimT = 0;

// Clay-feel modifiers layered on the rate cap.
//   PULL_PENALTY: stretching the wall outward is harder than compressing
//     it inward — the wheel does work for you on a push and against
//     you on a pull. 0.55 = pulls run a touch over half push speed.
//   THIN_BAND / THIN_FLOOR: as the local wall approaches MIN_R, the
//     allowed rate fades toward THIN_FLOOR so a thin wall resists
//     further movement (you can still squeeze it, but it tears
//     slowly instead of snapping). THIN_BAND is the width of clay
//     over which the penalty fades in.
//   SMOOTH_ALPHA: how aggressively the rotation "polishes" each
//     sculpted band per sample. Subtle by design — intentional rim /
//     foot features survive, but jagged finger micro-jitter settles.
const PULL_PENALTY = 0.55;
const THIN_BAND    = 0.10;
const THIN_FLOOR   = 0.05;
const SMOOTH_ALPHA = 0.04;

// Selectable brush sizes (vertical softness of the pull, world units).
// A fine brush lets you shape small features like a foot or a crisp
// rim; a broad one sweeps the whole belly.
const BRUSHES = [
    { label: "Fine",   sigma: 0.045 },
    { label: "Medium", sigma: 0.090 },
    { label: "Broad",  sigma: 0.160 },
];
const DEFAULT_BRUSH = 1;

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
// The clay progresses wet → bone-dry (decorate) → fired. You can only
// throw (sculpt) wet clay; you decorate (pick a glaze) bone-dry.
// Colours here are tunable placeholders. clearcoat is kept slightly
// > 0 in every state so the shader define never toggles mid-tween (no
// recompile hitch).
// Bare-clay "looks" per phase. `bump` scales the procedural relief:
// wet reads smoother (water fills the tooth), bone-dry shows the most
// grain. `fired` is the bare (unglazed) fired earthenware look.
const CLAY_STATES = {
    wet:     { label: "Wet clay", color: 0xa3674a, roughness: 0.48, clearcoat: 0.40, clearcoatRoughness: 0.45, envMapIntensity: 0.85, bump: 0.03 },
    leather: { label: "Decorate", color: 0xb38566, roughness: 0.78, clearcoat: 0.18, clearcoatRoughness: 0.70, envMapIntensity: 0.55, bump: 0.05 },
    fired:   { label: "Fired",    color: 0xbf6a45, roughness: 0.60, clearcoat: 0.15, clearcoatRoughness: 0.70, envMapIntensity: 0.62, bump: 0.04 },
};
const INITIAL_STATE = "wet";

// Three-step arc: shape it wet → decorate the leather-hard clay
// (pick a glaze, paint, trim the foot in passing) → fire it. The
// previous bone-dry phase was just a transition with no unique role;
// it's been folded into leather so decorating + trim share a stage.
const PHASES = ["wet", "leather", "fired"];
const ADVANCE_LABEL = { wet: "Dry", leather: "Fire", fired: "New pot" };
const BACK_LABEL    = { leather: "&larr; Re-wet" };

// Glazes. `raw` is the chalky matte coat before firing; `fired` is the
// glossy vitrified result. Shared surface params, per-glaze colours.
// Optional 4th arg to glaze() overrides fired params (used for the
// metallics: gold / copper / platinum get high metalness; pearl gets
// extra clearcoat). The reveal is raw → fired on the glaze fire.
const GLAZE_RAW   = { roughness: 0.92, clearcoat: 0.03, clearcoatRoughness: 0.95, envMapIntensity: 0.32, bump: 0.012, metalness: 0.00 };
const GLAZE_FIRED = { roughness: 0.30, clearcoat: 0.72, clearcoatRoughness: 0.14, envMapIntensity: 0.85, bump: 0.004, metalness: 0.00 };
function glaze(name, rawHex, firedHex, firedOver) {
    return {
        name,
        raw:   { ...GLAZE_RAW,   color: rawHex },
        fired: { ...GLAZE_FIRED, color: firedHex, ...(firedOver || {}) },
    };
}
const GLAZES = {
    celadon:  glaze("Celadon",  0xb9c3b3, 0x7d9b7e),
    cobalt:   glaze("Cobalt",   0x9aa3b6, 0x37507e),
    oatmeal:  glaze("Oatmeal",  0xd8d2c4, 0xe7ddca),
    honey:    glaze("Honey",    0xc2a274, 0xb27a33),
    tenmoku:  glaze("Tenmoku",  0x6e6258, 0x2c2320),
    blush:    glaze("Blush",    0xd9c2c0, 0xc98a86),
    forest:   glaze("Forest",   0x9fb0a0, 0x3f5e4a),
    slate:    glaze("Slate",    0xb0b6bd, 0x4a5a68),
    plum:     glaze("Plum",     0xbcaebe, 0x6e4a6b),
    sand:     glaze("Sand",     0xd8cbb0, 0xc2a35e),
    gold:     glaze("Gold",     0xc9a575, 0xd9aa3f, { metalness: 0.72, roughness: 0.22, envMapIntensity: 1.20 }),
    copper:   glaze("Copper",   0xb2895c, 0xb35030, { metalness: 0.58, roughness: 0.30, envMapIntensity: 1.10 }),
    platinum: glaze("Platinum", 0xbcbcbc, 0xd5d5dc, { metalness: 0.75, roughness: 0.20, envMapIntensity: 1.25 }),
    ironred:  glaze("Iron red", 0xb87055, 0xa53a1f, { roughness: 0.42, envMapIntensity: 0.92 }),
    mint:     glaze("Mint",     0xc5ddcd, 0x84b899),
    pearl:    glaze("Pearl",    0xe8dfd2, 0xf2ead8, { clearcoat: 0.88, clearcoatRoughness: 0.08, envMapIntensity: 1.00 }),
};
const GLAZE_IDS = [
    "celadon", "cobalt", "oatmeal", "honey", "tenmoku",
    "blush", "forest", "slate", "plum", "sand",
    "gold", "copper", "platinum", "ironred", "mint", "pearl",
];

// Swappable glaze packs — each pack curates 8 glazes that read well
// together. The picker shows the active pack's eight; switching packs
// rebuilds the swatch row. All glazes still exist in GLAZES (above),
// so loaded gallery pots can render any glaze even if it's not in the
// current pack — loadPot auto-switches the pack to match.
const GLAZE_PACKS = {
    studio: {
        label: "Studio",
        ids: ["celadon", "cobalt", "oatmeal", "honey", "tenmoku", "blush", "forest", "slate"],
    },
    modern: {
        label: "Modern",
        ids: ["plum", "sand", "gold", "copper", "platinum", "ironred", "mint", "pearl"],
    },
};
const DEFAULT_GLAZE_PACK = "studio";
function currentPackIds() {
    return (GLAZE_PACKS[state.glazePack] || GLAZE_PACKS[DEFAULT_GLAZE_PACK]).ids;
}
function packContaining(glazeId) {
    if (!glazeId) return null;
    for (const [pid, p] of Object.entries(GLAZE_PACKS)) {
        if (p.ids.includes(glazeId)) return pid;
    }
    return null;
}

// --- Decoration -------------------------------------------------
// Painted onto the surface (over the glaze) by dragging on the pot.
// One unwrapped RGBA canvas wraps the pot via UVs; a shader overlays
// it on the clay. Brush = soft dab; splatter = scattered droplets.
const DECO_COLORS = [0xf4efe6, 0x2b2622, 0x37507e, 0x7d9b7e, 0xc98a3c, 0xc97f86, 0x6e4a6b, 0x4a5a68];
const DECO_W = 2048, DECO_H = 1024; // unwrapped surface (≈ circumference:height)
// Bump canvas. The procedural clay grain is rendered into it once at
// pot reset; the texture stays static for v2 (earlier prototypes of
// texture-stamp + carve tools were pulled — see the section comment
// where carving used to live). Same wrap as the deco layer; smaller
// because relief reads softer than colour.
const BUMP_W = 1024, BUMP_H = 512;
// Brush radii in canvas px (at zoom 1). The effective radius is divided
// by the zoom, so the brush keeps a constant on-screen size — zoom in
// for finer detail.
const DECO_SIZES = [{ label: "S", px: 30 }, { label: "M", px: 62 }, { label: "L", px: 108 }];
const DEFAULT_DECO_SIZE = 1;
const SPLATTER_DROPS = 9;

// Stamp shapes (tap/drag to place) and overlay patterns (one tap fills
// the whole surface). Both reuse the paint layer + current colour/size.
const STAMP_SHAPES = [
    { id: "dot",      glyph: "●" },
    { id: "ring",     glyph: "◯" },
    { id: "star",     glyph: "★" },
    { id: "spark",    glyph: "✦" },
    { id: "heart",    glyph: "♥" },
    { id: "flower",   glyph: "✿" },
    { id: "cross",    glyph: "✚" },
    { id: "triangle", glyph: "▲" },
    { id: "diamond",  glyph: "◆" },
    { id: "square",   glyph: "■" },
];
const OVERLAY_PATTERNS = [
    { id: "dots",     label: "Dots" },
    { id: "rings",    label: "Rings" },
    { id: "stripes",  label: "Stripes" },
    { id: "grid",     label: "Grid" },
    { id: "scatter",  label: "Scatter" },
    { id: "checker",  label: "Checker" },
    { id: "waves",    label: "Waves" },
    { id: "diagonal", label: "Diagonal" },
];


// --- Ambiance: backdrops + music --------------------------------
// Backdrops are CSS images behind the (transparent) canvas; chosen on
// the title screen and remembered. Music is one looping ambient track.
// Backdrops are tagged with a category so the title-screen picker can
// group them. Adding a new image = one entry here (drop the file at
// assets/backgrounds/<id>.jpg). The picker renders categories in the
// order they appear in BG_CATEGORIES.
// Each entry's `folder` is a subdir of assets/backgrounds/. The
// Studio category points at assets/backgrounds/preload/ (the only
// folder the app build needs to bundle); the rest are fetched on
// demand by the browser the first time the user picks one.
const BG_CATEGORIES = ["Studio", "Art", "Botanical", "Digital", "Paper", "Motion"];
const BACKGROUNDS = [
    { id: "cherrytree",     label: "Cherry tree",   category: "Studio",    folder: "preload" },
    { id: "paintswatch",    label: "Paint swatch",  category: "Studio",    folder: "preload" },
    { id: "papercut",       label: "Papercut",      category: "Studio",    folder: "preload" },
    { id: "abstract",       label: "Abstract",      category: "Art",       folder: "art" },
    { id: "oil",            label: "Oil",           category: "Art",       folder: "art" },
    { id: "watercolor",     label: "Watercolor",    category: "Art",       folder: "art" },
    { id: "dried-flowers",  label: "Dried flowers", category: "Botanical", folder: "botanical" },
    { id: "floral",         label: "Floral",        category: "Botanical", folder: "botanical" },
    { id: "shadow-flowers", label: "Shadow",        category: "Botanical", folder: "botanical" },
    { id: "clay-tunnel",    label: "Clay tunnel",   category: "Digital",   folder: "digital" },
    { id: "vapor",          label: "Vapor",         category: "Digital",   folder: "digital" },
    { id: "wireframe",      label: "Wireframe",     category: "Digital",   folder: "digital" },
    { id: "books",          label: "Books",         category: "Paper",     folder: "paper" },
    { id: "cardboard",      label: "Cardboard",     category: "Paper",     folder: "paper" },
    { id: "waves",          label: "Waves",         category: "Paper",     folder: "paper" },
    { id: "balloons",       label: "Balloons",      category: "Motion",    folder: "motion", type: "video", ext: "mp4" },
    { id: "birds",          label: "Birds",         category: "Motion",    folder: "motion", type: "video", ext: "mp4" },
    { id: "hearts",         label: "Hearts",        category: "Motion",    folder: "motion", type: "video", ext: "mp4" },
];
// The Capacitor wrap bundles only the preload backgrounds to keep the
// AAB small (the other folders are ~28MB combined, mostly motion videos).
// The other categories are installable on demand — see "Pack downloads"
// below — and once installed live in the app's Data dir, resolved at
// load time via Capacitor.convertFileSrc(). Cache populated by
// primeBgUrls() at startup; the bare key is bg.id.
const STUDIO_FOLDER = "preload";
const bgUrlCache = new Map();
function bgAssetUrl(bg) {
    const cached = bgUrlCache.get(bg.id);
    if (cached) return cached;
    return `assets/backgrounds/${bg.folder}/${bg.id}.${bg.ext || "jpg"}`;
}
// Backgrounds the picker should show. Web build → everything. Capacitor
// → the preload pack (always bundled) plus whatever installable packs
// the user has fetched. The category tabs themselves still render for
// every category in Capacitor — see buildBgPicker — so the user has a
// surface to install from; this filter governs which swatches appear.
function visibleBackgrounds() {
    if (!window.Capacitor) return BACKGROUNDS;
    const installed = installedPacks();
    return BACKGROUNDS.filter((b) =>
        b.folder === STUDIO_FOLDER || installed.has(b.category)
    );
}
const DEFAULT_BG = "paintswatch"; // one of the preload-bundled starters

// --- Pack downloads (Capacitor only) ----------------------------
// A "pack" = one bg-category folder. The web app sees every backdrop
// directly from the site; the Android wrap ships only the Studio pack
// (preload) and downloads other categories on demand. PACKS lists the
// installable ones — Studio isn't here because it's always present.
// `bytes` is the approximate uncompressed pack size, used for the
// "About 1 MB" prompt; it doesn't need to be exact.
const PACKS = {
    Art:       { folder: "art",       bytes:   960 * 1024 },
    Botanical: { folder: "botanical", bytes:   860 * 1024 },
    Digital:   { folder: "digital",   bytes:  1040 * 1024 },
    Paper:     { folder: "paper",     bytes:   900 * 1024 },
    Motion:    { folder: "motion",    bytes:    23 * 1024 * 1024 },
};
const REMOTE_BG_BASE = "https://madderverse.org/slip-studio/assets/backgrounds";
const FS_BG_BASE     = "slip-studio/backgrounds"; // under Directory.Data
const PACK_INSTALLED_KEY = "slip-packs-installed";
const PACK_DIRECTORY = "DATA"; // matches Filesystem plugin's Directory.Data
const PRELOAD_PACK_BYTES = 1.7 * 1024 * 1024; // for the manage sheet

function packBgs(category) {
    return BACKGROUNDS.filter((b) => b.category === category);
}
function installedPacks() {
    try {
        const raw = localStorage.getItem(PACK_INSTALLED_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) { return new Set(); }
}
function setInstalledPacks(set) {
    try { localStorage.setItem(PACK_INSTALLED_KEY, JSON.stringify([...set])); }
    catch (_) {}
}
function isPackInstalled(category) {
    if (!window.Capacitor) return true; // web has every pack inline
    if (category === "Studio") return true; // bundled with the AAB
    return installedPacks().has(category);
}
function fmtBytes(b) {
    if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
    const mb = b / (1024 * 1024);
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
function fsPlugin() {
    return window.Capacitor && window.Capacitor.Plugins
        ? window.Capacitor.Plugins.Filesystem
        : null;
}
function bgFileName(bg) {
    return `${bg.id}.${bg.ext || "jpg"}`;
}
function bgFsPath(bg) {
    return `${FS_BG_BASE}/${bg.folder}/${bgFileName(bg)}`;
}

// On startup, resolve a webview-loadable URL for every installed-pack
// background. The picker + setBackground both read from bgUrlCache, so
// once this resolves the rest of the app uses local URIs transparently.
// Missing files silently demote the bg to "not installed" so a torn
// download doesn't wedge the picker.
async function primeBgUrls() {
    bgUrlCache.clear();
    if (!window.Capacitor) return;
    const fs = fsPlugin();
    if (!fs) return;
    const installed = installedPacks();
    const recovered = new Set();
    for (const bg of BACKGROUNDS) {
        if (bg.folder === STUDIO_FOLDER) continue;
        if (!installed.has(bg.category)) continue;
        try {
            const { uri } = await fs.getUri({
                path: bgFsPath(bg),
                directory: PACK_DIRECTORY,
            });
            bgUrlCache.set(bg.id, window.Capacitor.convertFileSrc(uri));
            recovered.add(bg.category);
        } catch (_) { /* file missing — treat as gone */ }
    }
    // If a previously-installed pack lost all its files (e.g. user
    // cleared app storage from Android Settings), forget the entry so
    // the picker offers a fresh install instead of broken swatches.
    let changed = false;
    for (const cat of [...installed]) {
        if (!recovered.has(cat)) {
            installed.delete(cat);
            changed = true;
        }
    }
    if (changed) setInstalledPacks(installed);
}

// Fetch a remote URL into a base64 string suitable for Filesystem.writeFile.
async function fetchAsBase64(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onloadend = () => {
            const s = fr.result;
            const i = (typeof s === "string") ? s.indexOf(",") : -1;
            resolve(i >= 0 ? s.slice(i + 1) : "");
        };
        fr.onerror = () => reject(fr.error || new Error("Read failed"));
        fr.readAsDataURL(blob);
    });
}

// Download every file in a pack into Filesystem. onProgress(done, total)
// fires after each file. On any error we clean up partial writes so a
// retried install starts clean (no half-decoded JPG sitting on disk).
async function downloadPack(category, onProgress) {
    const fs = fsPlugin();
    if (!fs) throw new Error("Filesystem unavailable");
    const pack = PACKS[category];
    if (!pack) throw new Error(`Unknown pack: ${category}`);
    const bgs = packBgs(category);
    if (!bgs.length) throw new Error("Empty pack");

    const written = [];
    try {
        for (let i = 0; i < bgs.length; i++) {
            const bg = bgs[i];
            const remote = `${REMOTE_BG_BASE}/${pack.folder}/${bgFileName(bg)}`;
            const data = await fetchAsBase64(remote);
            await fs.writeFile({
                path: bgFsPath(bg),
                data,
                directory: PACK_DIRECTORY,
                recursive: true,
            });
            written.push(bgFsPath(bg));
            onProgress?.(i + 1, bgs.length);
        }
    } catch (e) {
        for (const p of written) {
            try { await fs.deleteFile({ path: p, directory: PACK_DIRECTORY }); }
            catch (_) {}
        }
        throw e;
    }
    const installed = installedPacks();
    installed.add(category);
    setInstalledPacks(installed);
}

async function uninstallPack(category) {
    const fs = fsPlugin();
    const pack = PACKS[category];
    if (!fs || !pack) return;
    try {
        await fs.rmdir({
            path: `${FS_BG_BASE}/${pack.folder}`,
            directory: PACK_DIRECTORY,
            recursive: true,
        });
    } catch (_) { /* nothing on disk, fine */ }
    const installed = installedPacks();
    installed.delete(category);
    setInstalledPacks(installed);
    for (const bg of packBgs(category)) bgUrlCache.delete(bg.id);
}
// Multiple ambient tracks — initMusic picks one per session so it
// doesn't get repetitive across launches. Missing files fail silently
// (the Audio element errors and the rest of the app keeps working).
const MUSIC_TRACKS = [
    { src: "assets/audio/New Plan - Out To The World.mp3", label: "Out to the World" },
    { src: "assets/audio/ambient-2.mp3",                   label: "Track 2" },
    { src: "assets/audio/ambient-3.mp3",                   label: "Track 3" },
];

// --- Sound effects ----------------------------------------------
// Lazy-loaded ambient + one-shot clips. The wheel hum is looping and
// fades with the auto-spin; the rest are one-shots cloned per play so
// overlapping triggers don't restart the source. All paths are local
// — the user supplies the audio files (drop into assets/sfx/). A
// missing file fails silently; the rest of the app still works.
const SFX_SOURCES = {
    wheel:   { src: "assets/sfx/wheel-hum.mp3",    loop: true,  vol: 0.22 },
    squelch: { src: "assets/sfx/clay-squelch.mp3", loop: false, vol: 0.40, pitchVar: 0.18 },
    drip:    { src: "assets/sfx/water-drip.mp3",   loop: false, vol: 0.45, pitchVar: 0.10 },
    pour:    { src: "assets/sfx/glaze-pour.mp3",   loop: false, vol: 0.42 },
    kiln:    { src: "assets/sfx/kiln-fire.mp3",    loop: false, vol: 0.55 },
};

// --- Starter silhouettes ----------------------------------------
// Spline control points for the seed profile: (radius, height) in
// world units. All shapes terminate at y=TOP (1.40) so they fill the
// vertex grid without leaving degenerate rings above. The picker on
// the title screen exposes vase / bowl / cup / bottle; `lid` is used
// internally by the matched-set flow when you make a partner piece.
const SHAPES = {
    vase: {
        label: "Vase",
        controls: [
            [0.00, 0.00], [0.30, 0.00], [0.33, 0.06], [0.27, 0.16],
            [0.41, 0.34], [0.54, 0.58], [0.53, 0.74], [0.42, 0.92],
            [0.31, 1.08], [0.30, 1.20], [0.35, 1.32], [0.33, 1.40],
        ],
    },
    bowl: {
        label: "Bowl",
        controls: [
            [0.00, 0.00], [0.40, 0.00], [0.46, 0.06], [0.52, 0.18],
            [0.66, 0.40], [0.78, 0.70], [0.86, 1.00], [0.90, 1.25],
            [0.88, 1.40],
        ],
    },
    cup: {
        label: "Cup",
        controls: [
            [0.00, 0.00], [0.32, 0.00], [0.35, 0.08], [0.38, 0.30],
            [0.42, 0.60], [0.45, 0.90], [0.47, 1.15], [0.50, 1.32],
            [0.52, 1.40],
        ],
    },
    bottle: {
        label: "Bottle",
        controls: [
            [0.00, 0.00], [0.28, 0.00], [0.32, 0.08], [0.40, 0.20],
            [0.52, 0.40], [0.55, 0.55], [0.45, 0.72], [0.28, 0.85],
            [0.22, 1.00], [0.20, 1.18], [0.22, 1.32], [0.20, 1.40],
        ],
    },
};

// Lid silhouettes — keyed by style. Each entry generates control
// points scaled to a given rim radius. Lives up here (above init())
// so the picker can wire up at startup without TDZ errors.
// Each style now ENDS at a different y so the lid genuinely varies
// in height. Above the silhouette's end, the profile collapses to
// radius 0 — the rings stack at the axis and produce no visible
// geometry, so the lid actually looks short, medium, or tall.
const LID_STYLES = {
    // Flat: a wide low lid with a small knob — most of the visible
    // height holds at the rim radius, then a quick dome with a tiny
    // finial. ~16% of pot height total.
    flat: (k) => [
        [0.00,     0.00],
        [k,        0.00],
        [k,        0.05],   // wide flat lip
        [k,        0.07],   // hold the rim shape
        [k * 0.80, 0.10],   // start of small dome
        [k * 0.40, 0.13],   // dome top
        [k * 0.20, 0.15],   // base of knob
        [k * 0.22, 0.17],   // knob bulb
        [k * 0.10, 0.20],   // knob taper
        [0.00,     0.22],
        [0.00,     1.40],   // unused — collapsed to axis
    ],
    // Domed: a graceful onion-dome with a knob bulb at the top.
    // ~36% of pot height — half the old "domed".
    domed: (k) => [
        [0.00,     0.00],
        [k,        0.00],
        [k,        0.04],
        [k * 0.96, 0.07],
        [k * 0.88, 0.11],
        [k * 0.72, 0.17],
        [k * 0.50, 0.24],
        [k * 0.28, 0.30],
        [k * 0.16, 0.36],
        [k * 0.28, 0.42],   // knob bulb
        [k * 0.14, 0.47],
        [0.00,     0.50],
        [0.00,     1.40],
    ],
    // Tall: a slimmer profile with a prominent finial bulb near the
    // top. ~50% of pot height — half the old "tall".
    tall: (k) => [
        [0.00,     0.00],
        [k,        0.00],
        [k,        0.04],
        [k * 0.90, 0.07],
        [k * 0.62, 0.14],
        [k * 0.30, 0.22],
        [k * 0.16, 0.31],
        [k * 0.12, 0.40],
        [k * 0.12, 0.50],
        [k * 0.30, 0.56],   // knob base
        [k * 0.36, 0.62],   // knob bulb
        [k * 0.20, 0.67],
        [0.00,     0.70],
        [0.00,     1.40],
    ],
};
const LID_STYLE_IDS = ["flat", "domed", "tall"];

// Lids are now generated parametrically from the source pot's rim
// (see seedLidForRim) — no preset silhouette needed.
const SHAPE_IDS = ["vase", "bowl", "cup", "bottle"]; // picker order; lid is set-only
const DEFAULT_SHAPE = "vase";

const state = {
    renderer: null,
    scene: null,
    camera: null,
    canvas: null,
    turntable: null,
    pot: null,
    clayMaterial: null,
    clayState: INITIAL_STATE,   // a key of PHASES
    clayTarget: null,           // material params currently tweening toward
    glaze: null,                // chosen glaze id (once glazing), else null
    brushIndex: DEFAULT_BRUSH,  // index into BRUSHES
    spin: SPIN_SPEED,           // current angular speed (eases to 0 while busy)
    decoTool: "brush",          // brush | splatter | stamp | overlay
    decoColor: null,            // paint colour (hex), or null = painting off
    decoSizeIndex: DEFAULT_DECO_SIZE,
    stampShape: "dot",
    painting: false,
    decoCanvas: null, decoCtx: null, decoTex: null,
    // Sgraffito mask layer: a paintable greyscale (alpha-only canvas)
    // that the shader uses to subtract glaze + decoration and reveal
    // the bare-clay state colour underneath. Real sgraffito is a
    // scratch through a slip layer.
    sgraffitoCanvas: null, sgraffitoCtx: null, sgraffitoTex: null,
    partnerSgraffitoCanvas: null, partnerSgraffitoCtx: null, partnerSgraffitoTex: null,
    // The current bare-clay base colour as a THREE.Color — tweened in
    // tickMaterial alongside the glaze so carved areas pass through the
    // kiln smoothly (leather brown -> fired terracotta). The shader
    // reads this as a uniform; the same Color instance is reused so
    // we never reassign the uniform's value reference.
    clayBaseColor: new THREE.Color(CLAY_STATES.wet.color),
    partnerClayBaseColor: new THREE.Color(CLAY_STATES.wet.color),
    // Optional secondary glaze for a vertical gradient (bottom-up).
    // glazeGradient = id of the secondary glaze (or null = no gradient).
    // gradientColor + gradientMix are the shader-side tween values:
    // colour tracks GLAZES[glazeGradient].raw|fired with clayState;
    // mix fades 0 → 1 when gradient is on, 1 → 0 when off, so the
    // transition into / out of the gradient look is smooth.
    glazeGradient: null,
    gradientColor: new THREE.Color(0xffffff),
    gradientMix: 0,
    partnerGradientColor: new THREE.Color(0xffffff),
    partnerGradientMix: 0,
    // Editable bump layer: painted into by wet-clay texture stamps
    // (positive relief) and leather-hard carving (negative grooves).
    // Mixed additively with the procedural clay grain in the shader.
    bumpCanvas: null, bumpCtx: null, bumpTex: null,
    // Handle: twin amphora-style ears on opposite sides of the pot.
    // Lives on the pot only — when state.isLid is true both meshes
    // hide. Geometry is rebuilt from the current profile whenever it
    // changes (so the handles reattach as the user sculpts). Material
    // is separate from the clay shader patch (handles use plain glaze
    // colour, no deco / sgraffito overlay). Right mesh holds the
    // canonical geometry; left mirrors it with scale.x = -1.
    handle: {
        mesh: null, mirrorMesh: null, material: null, on: false,
        // User-applied modifiers from drag-to-reshape. bulgeOffset
        // widens / tightens the ear's outward arc; heightOffset shifts
        // both attach points up / down along the body together. Both
        // start at zero (= the auto-derived attach + bulge); persist
        // across sculpts so the reshape sticks until the user changes
        // it or resets.
        bulgeOffset: 0,
        heightOffset: 0,
        // Tube-radius preset id (key into HANDLE_THICKNESSES). Mirrors
        // the lid-style picker — small chip row at handle-on + wet.
        thickness: "medium",
    },
    pendingSetId: null,                   // carried across save → reset for lid pairs
    // Has the user done anything that isn't reflected in the gallery?
    // Set true on any sculpt / decorate / glaze / advance / lid-create;
    // cleared on resetPot, loadPot, and a successful savePot. The title
    // button reads this to decide whether to prompt before discarding.
    dirty: false,
    isLid: false,                         // current piece is a lid (relaxes the foot envelope)
    savedPot: null,                       // paused pot state while user shapes a lid
    savedLid: null,                       // paused lid state while user edits the pot
    lidStyle: "domed",                    // flat | domed | tall — picked while shaping a lid
    lidMaxY: null,                        // y where the lid silhouette caps (set in seedLidForRim)
    partnerMesh: null,                    // second mesh, used for the fired-set assembly view
    partnerMaterial: null,
    partnerTarget: null,                  // material look the partner is tweening toward
    partnerDecoCanvas: null, partnerDecoCtx: null, partnerDecoTex: null,
    partnerBumpCanvas: null, partnerBumpCtx: null, partnerBumpTex: null,
    assemblyShown: false,                 // true while the fired set view is on
    firing: false,                        // true during the 1.2s firing sequence
    firingStart: 0,                       // performance.now() when firing began
    wetSheenBoost: 0,                     // 0..1 — reactive sheen on wet clay; fast attack, slow decay
    galleryView: (() => {
        try { return localStorage.getItem("slip-gallery-view") || "shelf"; }
        catch (_) { return "shelf"; }
    })(),
    // Per-piece vertical stretch. 1.0 = the default TOP-tall silhouette;
    // > 1 pulls the rim higher (pot grows taller), < 1 squashes it down.
    // Implemented as a Group transform on potGroup so the geometry data
    // (the profile array of per-row radii) stays the same — sculpt
    // math still works in profile-space, the pointer-to-profile raycast
    // divides world-Y by this scale to read the right row. Handle
    // meshes live inside potGroup too so they stretch with the pot.
    heightScale: 1.0,
    glazePack: (() => {
        try {
            const saved = localStorage.getItem("slip-glaze-pack");
            return (saved && GLAZE_PACKS[saved]) ? saved : DEFAULT_GLAZE_PACK;
        } catch (_) { return DEFAULT_GLAZE_PACK; }
    })(),
    photoStyle: "studio",                // studio | sunlit | museum
    photoAspect: "square",               // square | portrait
    bgCategory: null,                    // resolved by buildBgPicker
    zoom: 1,                    // 1 = default framing; up to ZOOM_MAX
    userRotating: false,        // manually spinning the pot
    background: DEFAULT_BG,
    musicOn: true,
    sfxOn: true,
    shape: (() => {
        try { const s = localStorage.getItem("slip-shape"); return s && SHAPES[s] ? s : DEFAULT_SHAPE; }
        catch (_) { return DEFAULT_SHAPE; }
    })(),
    clock: new THREE.Clock(),
};
let lastPaintUV = null;         // for continuous paint strokes
let music = null;               // looping ambient track

// First-launch control hints: shown once, after a short idle beat in the
// studio on a fresh install; suppressed forever once the user interacts.
const FIRST_RUN_KEY = "slip-seen-first-run";
let firstRunTimer = null;

// Wheel-hum ramp: the hum fades in from silence after Begin rather than
// popping to full volume the first frame (see tick()).
let wheelStarted = false;
let wheelGain = 0;

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
// Handle drag-to-reshape: when the user grabs a handle ear at wet
// and drags, this carries the grab-time snapshot so each pointermove
// can compute the offset from there. null when not dragging.
let handleDrag = null;

// Hoisted from the handle constants section further down — UI build
// in init() reads HANDLE_THICKNESS_IDS for the picker chips, and
// top-down evaluation hadn't reached the original spot yet (TDZ).
const HANDLE_THICKNESSES = { thin: 0.022, medium: 0.032, thick: 0.048 };
const HANDLE_THICKNESS_IDS = ["thin", "medium", "thick"];
const DEFAULT_HANDLE_THICKNESS = "medium";
function handleTubeRadius() {
    return HANDLE_THICKNESSES[state.handle.thickness] || HANDLE_THICKNESSES[DEFAULT_HANDLE_THICKNESS];
}

init();

function init() {
    const canvas = document.getElementById("scene");
    state.canvas = canvas;

    // --- Renderer -------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true, // transparent canvas — the CSS backdrop shows behind
        powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearAlpha(0);
    state.renderer = renderer;

    // --- Scene ----------------------------------------------------
    // No scene.background — the pot + wheel render over a transparent
    // canvas, with the chosen backdrop image behind it (CSS).
    const scene = new THREE.Scene();
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
    state.camera = camera;
    applyCamera(); // position from zoom + target

    buildLights(scene);

    // --- Turntable (pot + wheel spin together) --------------------
    const turntable = new THREE.Group();
    turntable.add(buildWheel());
    // potGroup wraps the pot mesh + (eventually) the handle meshes
    // so a single scale.y on the group stretches the whole piece
    // vertically without touching the wheel. Per-piece heightScale
    // is the user's "pull the clay up" knob; default 1.0 = original.
    state.potGroup = new THREE.Group();
    state.pot = buildPot();
    state.potGroup.add(state.pot);
    state.potGroup.scale.y = state.heightScale;
    turntable.add(state.potGroup);
    scene.add(turntable);
    state.turntable = turntable;

    resize();
    window.addEventListener("resize", resize, { passive: true });
    bindSculpt(canvas);

    const advanceBtn = document.getElementById("advanceBtn");
    if (advanceBtn) advanceBtn.addEventListener("click", advanceStage);
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", stepBack);
    document.querySelectorAll(".brush-btn").forEach((b, idx) =>
        b.addEventListener("click", () => setBrush(idx)));
    setBrush(DEFAULT_BRUSH);
    buildGlazePackTabs();
    buildGlazeBar();
    buildDecoBar();
    document.getElementById("toolBrush")?.addEventListener("click", () => setDecoTool("brush"));
    document.getElementById("toolSplatter")?.addEventListener("click", () => setDecoTool("splatter"));
    document.getElementById("toolStamp")?.addEventListener("click", () => setDecoTool("stamp"));
    document.getElementById("toolOverlay")?.addEventListener("click", () => setDecoTool("overlay"));
    document.getElementById("toolCarve")?.addEventListener("click", () => setDecoTool("carve"));
    document.getElementById("decoClear")?.addEventListener("click", clearDeco);
    document.getElementById("tabGlaze")?.addEventListener("click", () => setDecoTab("glaze"));
    document.getElementById("tabDecorate")?.addEventListener("click", () => setDecoTab("decorate"));
    document.getElementById("saveBtn")?.addEventListener("click", () => savePot());
    document.getElementById("photoBtn")?.addEventListener("click", () => openPhotoModal());
    document.getElementById("photoClose")?.addEventListener("click", closePhotoModal);
    document.getElementById("photoSave")?.addEventListener("click", finalizePhoto);
    document.querySelectorAll("#photoStyles .photo-chip").forEach((el) =>
        el.addEventListener("click", () => setPhotoStyle(el.dataset.style)));
    document.querySelectorAll("#photoAspects .photo-chip").forEach((el) =>
        el.addEventListener("click", () => setPhotoAspect(el.dataset.aspect)));
    // Lid button is dual-purpose now: creates a lid partner if you
    // don't have one, swaps to the existing lid if you do. The pot
    // icon (swapBtn) only ever swaps in one direction — back to the
    // pot from the lid — so the Lid button owns the "go to lid" path
    // whether the lid needs to be born first.
    document.getElementById("makeLidBtn")?.addEventListener("click", () => {
        if (state.savedLid) swapActivePiece();
        else                makeLidPartner();
        updateToolbar();
    });
    document.getElementById("swapBtn")?.addEventListener("click", () => {
        swapActivePiece();
        updateToolbar();
    });
    document.getElementById("matchRimBtn")?.addEventListener("click", () => {
        matchLidRim();
        updateToolbar();
    });
    document.getElementById("handleBtn")?.addEventListener("click", () => {
        setHandleOn(!state.handle.on);
    });
    document.getElementById("refitHandleBtn")?.addEventListener("click", () => {
        refitHandle();
    });
    document.getElementById("tallerBtn")?.addEventListener("click", () => nudgeHeight(+HEIGHT_STEP));
    document.getElementById("shorterBtn")?.addEventListener("click", () => nudgeHeight(-HEIGHT_STEP));
    document.getElementById("galleryBtn")?.addEventListener("click", () => openGallery());
    document.getElementById("galleryClose")?.addEventListener("click", closeGallery);
    document.getElementById("galleryViewToggle")?.addEventListener("click", () => {
        setGalleryView(state.galleryView === "shelf" ? "compact" : "shelf");
    });
    document.querySelectorAll(".deco-size").forEach((b, idx) =>
        b.addEventListener("click", () => setDecoSize(idx)));
    setDecoTool("brush");
    setDecoSize(DEFAULT_DECO_SIZE);
    setPhase(INITIAL_STATE); // sets the tween target + toolbar

    // First frame, then reveal the scene and start the loop.
    renderer.render(scene, camera);
    hideLoader();
    renderer.setAnimationLoop(tick);

    // Ambiance: backdrop + music. Restore saved choices.
    initMusic();
    buildShapePicker();
    buildBgPicker();
    buildLidStylePicker();
    buildHandleStylePicker();
    let savedBg = DEFAULT_BG, savedMusic = true, savedSfx = true;
    try { savedBg = localStorage.getItem("slip-bg") || DEFAULT_BG; } catch (_) {}
    try { savedMusic = localStorage.getItem("slip-music") !== "0"; } catch (_) {}
    try { savedSfx = localStorage.getItem("slip-sfx") !== "0"; } catch (_) {}
    // Restore a backdrop immediately. In Capacitor a non-preload saved
    // bg can't load until primeBgUrls() resolves the Data-dir URI, so
    // we show DEFAULT_BG (always bundled) as a placeholder, then swap
    // to the saved choice once the cache is primed. The web build has
    // every bg inline and can restore synchronously.
    const savedIsPreload = (() => {
        const b = BACKGROUNDS.find((x) => x.id === savedBg);
        return b && b.folder === STUDIO_FOLDER;
    })();
    if (window.Capacitor && !savedIsPreload) {
        setBackground(DEFAULT_BG);
        primeBgUrls().then(() => {
            buildBgPicker();
            if (visibleBackgrounds().some((b) => b.id === savedBg)) {
                setBackground(savedBg);
            }
        });
    } else {
        setBackground(visibleBackgrounds().some((b) => b.id === savedBg) ? savedBg : DEFAULT_BG);
    }
    state.musicOn = savedMusic;
    state.sfxOn = savedSfx;
    updateMusicToggle();
    updateSfxToggle();
    document.getElementById("musicToggle")?.addEventListener("click", () => setMusic(!state.musicOn));
    document.getElementById("sfxToggle")?.addEventListener("click", () => setSfx(!state.sfxOn));
    document.getElementById("titleBtn")?.addEventListener("click", returnToTitle);

    // Light haptic tick on any control tap (Android only; a silent no-op
    // elsewhere). Capture phase so it fires even for buttons whose own
    // handler stops propagation; Save + Fire add their own firmer buzz.
    document.addEventListener("click", (e) => {
        if (e.target.closest(".tool-btn, .deco-tool, .deco-tab, .brush-btn," +
            " .shape-swatch, .glaze-btn, .photo-chip, .landing-btn")) haptic(8);
    }, true);

    // First-visit landing caption ("Pick a starter shape").
    updateShapeHint();

    // Title screen sits over the (already-spinning) studio until "Begin".
    const landing = document.getElementById("landing");
    if (landing) landing.hidden = false;
    document.getElementById("beginBtn")?.addEventListener("click", dismissLanding);
    document.getElementById("landingGallery")?.addEventListener("click", () => {
        dismissLanding();
        openGallery();
    });
    // The Get-the-app link is for the web build only — hide it inside
    // the Capacitor Android wrap (Capacitor injects window.Capacitor).
    if (window.Capacitor) {
        const appLink = document.getElementById("landingAppLink");
        if (appLink) appLink.hidden = true;
    }

    // Dev handle (inert unless the URL carries ?dev) — used to drive
    // and inspect the sculpt during testing across the build.
    if (location.search.includes("dev")) {
        window.__slip = {
            state, profile, radiusAt, sculptToward, trimToward, maxRadiusAt,
            setPhase, advanceStage, stepBack, setBrush, setGlaze, setShape, setLidStyle,
            startFiringMoment, endFiringMoment,
            bumpDab, resetBumpLayer,
            playSfx, stopSfx,
            setDecoColor, setDecoTool, setDecoSize, paintAt, clearDeco,
            setStampShape, stampAt, applyOverlay,
            scratchAt, scratchStroke, clearSgraffito,
            setGradientGlaze, setHandleOn,
            setZoom, zoomBy, rotateBy,
            savePot, openPhotoModal, closePhotoModal, finalizePhoto,
            setPhotoStyle, setPhotoAspect,
            makeLidPartner, swapActivePiece, matchLidRim, capturePieceState, restorePieceState,
            loadPot, openGallery, closeGallery,
            dbAll, dbDelete, dismissLanding,
            // Pack-download surface: drive install/uninstall from the
            // console (or a future debug sheet) without going through
            // the picker. installedPacks() returns a Set of category names.
            PACKS, installedPacks, isPackInstalled,
            runInstall, downloadPack, uninstallPack,
            primeBgUrls, openPackManager, closePackManager,
            buildBgPicker, setBgCategory, setBackground,
            bgUrlCache,
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

// --- Procedural clay surface ------------------------------------
// A bump texture generated in code (no image asset): fine clay grain
// (wrapping value noise) plus gentle spiral throwing lines. Because it
// has angular variation, it also makes the wheel's rotation visible —
// the grain and lines sweep past the light as the pot turns. The
// canvas is editable (see paintProceduralClayGrain), so texture-stamps
// and carved grooves are drawn straight into this same surface.
function randGrid(n) {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return a;
}
function valueNoise(g, n, u, v) {
    const x = u * n, y = v * n;
    const x0 = Math.floor(x) % n, y0 = Math.floor(y) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * n + x0], b = g[y0 * n + x1];
    const c = g[y1 * n + x0], d = g[y1 * n + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function paintProceduralClayGrain(ctx) {
    const img = ctx.createImageData(BUMP_W, BUMP_H);
    const data = img.data;
    const g1 = randGrid(128), g2 = randGrid(48), g3 = randGrid(32);
    for (let y = 0; y < BUMP_H; y++) {
        const v = y / BUMP_H;
        for (let x = 0; x < BUMP_W; x++) {
            const u = x / BUMP_W;
            const grain = valueNoise(g1, 128, u, v) * 0.6 +
                          valueNoise(g2, 48, u, v) * 0.4 - 0.5;
            // Throwing lines: 22 rings up the pot, a 2-turn helical tilt
            // so they spiral subtly (as a real wheel would leave). A
            // smooth low-freq noise wobble shifts each ring's height
            // slightly with circumferential position — hands aren't
            // metronomes, so the rings sway instead of stamping out as
            // a perfect grid. Amplitude is high enough to actually read
            // as "this pot was thrown on a wheel".
            const wobble = (valueNoise(g3, 32, u * 0.4, v * 3) - 0.5);
            const lines  = Math.sin((v * 22 + u * 2 + wobble * 0.45) * Math.PI * 2);
            const h = 0.5 + grain * 0.5 + lines * 0.24;
            const c = Math.max(0, Math.min(255, h * 255)) | 0;
            const i = (y * BUMP_W + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = c;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

// --- Decoration layer -------------------------------------------
// A transparent RGBA canvas that wraps the pot (u around, v height).
// Painting draws into it; a shader overlays it on the clay diffuse.
function makeDecoLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = DECO_W;
    canvas.height = DECO_H;
    state.decoCanvas = canvas;
    state.decoCtx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;        // wraps around the pot
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    state.decoTex = tex;
    return tex;
}

// --- Sgraffito layer --------------------------------------------
// Carved-through scribble pattern. White-painted alpha = "scratched".
// The shader uses this to subtract any glaze + deco contribution and
// blend the bare-clay state colour through, simulating a slip-trail
// carved with a needle. Same UV grid as the deco layer.
function makeSgraffitoLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = DECO_W;
    canvas.height = DECO_H;
    state.sgraffitoCanvas = canvas;
    state.sgraffitoCtx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace; // mask data, not colour
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    state.sgraffitoTex = tex;
    return tex;
}

// --- Editable bump layer ----------------------------------------
// A paintable grayscale canvas that ADDS to the procedural clay
// grain in the bump shader. Neutral grey (0.5) = no change; brighter
// = raised relief (the wet-clay texture stamps press patterns INTO
// the soft clay); darker = carved groove (the leather-hard carve
// tool incises lines). Persists through firing.
// (Dimensions live up top with DECO_W so they're declared before init().)

// The bump canvas is BOTH the procedural clay grain (a fresh paint at
// the start of every pot) AND the surface that wet-clay stamps + carve
// grooves draw onto. There is only one bump texture; stamps/carves
// composite directly on top of the grain. That avoids juggling a
// separate paint layer with custom shader uniforms.
function makeBumpLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = BUMP_W;
    canvas.height = BUMP_H;
    state.bumpCanvas = canvas;
    state.bumpCtx = canvas.getContext("2d");
    resetBumpLayer(); // fill with the procedural clay grain
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;     // height data, not colour
    tex.wrapS = THREE.RepeatWrapping;        // wraps around the pot
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    state.bumpTex = tex;
    return tex;
}

function resetBumpLayer() {
    if (!state.bumpCtx) return;
    paintProceduralClayGrain(state.bumpCtx);
    if (state.bumpTex) state.bumpTex.needsUpdate = true;
}

// One circular dab into the bump layer. positive=true raises the
// surface (a pressed stamp); positive=false carves a groove. The dab
// is mostly flat-toned with a thin feathered edge — the sharp edge
// produces the strong screen-space derivative the bump shader needs
// to read as relief.
function bumpDab(cx, cy, positive, radius, alpha) {
    const ctx = state.bumpCtx;
    const tone = positive ? 255 : 0;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0,    `rgba(${tone},${tone},${tone},${alpha})`);
    g.addColorStop(0.78, `rgba(${tone},${tone},${tone},${alpha * 0.92})`);
    g.addColorStop(1,    `rgba(${tone},${tone},${tone},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
}

// Bump dab, mirrored across the u=0/1 seam so strokes wrap cleanly.
function bumpDabWrap(cx, cy, positive, radius, alpha) {
    bumpDab(cx, cy, positive, radius, alpha);
    if (cx < radius) bumpDab(cx + BUMP_W, cy, positive, radius, alpha);
    else if (cx > BUMP_W - radius) bumpDab(cx - BUMP_W, cy, positive, radius, alpha);
}

// (Carve tool removed 2026-06-10 — marks read as drawn stamps, not
// carved grooves. Leather-hard is Trim-only now.)

function rgba(hex, a) {
    return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
}

// One soft dab (radial falloff).
function dab(cx, cy, hex, radius, alpha) {
    const ctx = state.decoCtx;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, rgba(hex, alpha));
    g.addColorStop(0.55, rgba(hex, alpha * 0.9));
    g.addColorStop(1, rgba(hex, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
}

// Dab, mirrored across the u=0/1 seam so strokes wrap cleanly.
function dabWrap(cx, cy, hex, radius, alpha) {
    dab(cx, cy, hex, radius, alpha);
    if (cx < radius) dab(cx + DECO_W, cy, hex, radius, alpha);
    else if (cx > DECO_W - radius) dab(cx - DECO_W, cy, hex, radius, alpha);
}

// Effective brush radius (canvas px): base size shrunk by the zoom so
// the brush stays a constant size on screen — zoom in for fine detail.
function decoRadius() {
    return Math.max(3, DECO_SIZES[state.decoSizeIndex].px / state.zoom);
}

// Paint the current tool at a UV coordinate.
function paintAt(u, v) {
    if (state.decoColor == null) return;
    state.dirty = true;
    const cx = u * DECO_W;
    const cy = (1 - v) * DECO_H; // v=0 (foot) → canvas bottom
    const size = decoRadius();
    if (state.decoTool === "splatter") {
        const spread = size * 2.2;
        for (let i = 0; i < SPLATTER_DROPS; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.random() * spread;
            const r = Math.max(2, size * (0.18 + Math.random() * 0.42));
            dabWrap(cx + Math.cos(a) * d, cy + Math.sin(a) * d, state.decoColor, r, 0.85);
        }
    } else {
        dabWrap(cx, cy, state.decoColor, size, 0.9);
    }
    state.decoTex.needsUpdate = true;
}

// A continuous stroke between two UVs (skip if it crossed the seam).
function paintStroke(au, av, bu, bv) {
    if (Math.abs(bu - au) > 0.5) { paintAt(bu, bv); return; }
    const dist = Math.hypot((bu - au) * DECO_W, (bv - av) * DECO_H);
    const steps = Math.max(1, Math.floor(dist / (decoRadius() * 0.4)));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        paintAt(au + (bu - au) * t, av + (bv - av) * t);
    }
}

function clearDeco() {
    if (!state.decoCtx) return;
    state.decoCtx.clearRect(0, 0, DECO_W, DECO_H);
    state.decoTex.needsUpdate = true;
    // Clear wipes both paint AND sgraffito carving — one button, full
    // reset of the decorate surface. (The glaze itself is separate and
    // is cleared by tapping the active glaze swatch again.)
    clearSgraffito();
}

// Sgraffito carving: a needle scribed across wet slip. NOT a paint
// brush. The stroke is a crisp thin line drawn with canvas's stroke()
// API (no radial fade) so the cut has sharp edges; widths are way
// narrower than the deco-paint brushes — a real scribe leaves a 1–3
// mm groove, not a 30 mm sponge mark. The same path is also painted
// into the bump canvas as a DARK line, which the bump shader reads as
// recessed depth (a small surface shadow), so each scratch shows real
// groove relief instead of a flat colour swap. Bump grooves are
// permanent — same as the existing decoration stamps, and same as a
// real needle scratch on wet clay (Clear wipes the colour mask, the
// gouge stays).
const SGRAFFITO_WIDTHS = [3, 6, 12]; // S = needle, M = wood tool, L = gouge

function sgraffitoLineWidthDeco() {
    return Math.max(1.5, SGRAFFITO_WIDTHS[state.decoSizeIndex] / Math.max(0.5, state.zoom));
}

// First tap on pointerdown: a degenerate stroke renders as a tiny
// round dot — same width as a continuous-drag segment so the stroke
// reads as starting cleanly instead of with a blob.
function scratchAt(u, v) {
    scratchStroke(u, v, u, v);
}

function scratchStroke(au, av, bu, bv) {
    const sgCtx = state.sgraffitoCtx;
    const bpCtx = state.bumpCtx;
    if (!sgCtx || !bpCtx) return;
    state.dirty = true;
    // Skip seam-crossing line segments — drop a dot at the destination
    // and resume from there next sample.
    if (Math.abs(bu - au) > 0.5) { scratchStroke(bu, bv, bu, bv); return; }
    const wDeco = sgraffitoLineWidthDeco();
    const wBump = wDeco * (BUMP_W / DECO_W); // bump canvas is half-res, keep on-pot width consistent
    const decoAx = au * DECO_W, decoAy = (1 - av) * DECO_H;
    const decoBx = bu * DECO_W, decoBy = (1 - bv) * DECO_H;
    const bumpAx = au * BUMP_W, bumpAy = (1 - av) * BUMP_H;
    const bumpBx = bu * BUMP_W, bumpBy = (1 - bv) * BUMP_H;

    drawSgraffitoMaskSegment(sgCtx, decoAx, decoAy, decoBx, decoBy, wDeco);
    drawSgraffitoBumpSegment(bpCtx, bumpAx, bumpAy, bumpBx, bumpBy, wBump);
    // Seam wrap: a stroke near u≈0 or u≈1 also paints a copy at the
    // wrapped position so the line doesn't visually clip on the back
    // of the pot.
    if (decoAx < wDeco || decoBx < wDeco) {
        drawSgraffitoMaskSegment(sgCtx, decoAx + DECO_W, decoAy, decoBx + DECO_W, decoBy, wDeco);
        drawSgraffitoBumpSegment(bpCtx, bumpAx + BUMP_W, bumpAy, bumpBx + BUMP_W, bumpBy, wBump);
    } else if (decoAx > DECO_W - wDeco || decoBx > DECO_W - wDeco) {
        drawSgraffitoMaskSegment(sgCtx, decoAx - DECO_W, decoAy, decoBx - DECO_W, decoBy, wDeco);
        drawSgraffitoBumpSegment(bpCtx, bumpAx - BUMP_W, bumpAy, bumpBx - BUMP_W, bumpBy, wBump);
    }

    state.sgraffitoTex.needsUpdate = true;
    state.bumpTex.needsUpdate = true;
}

function drawSgraffitoMaskSegment(ctx, ax, ay, bx, by, w) {
    ctx.save();
    ctx.lineWidth   = w;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    if (ax === bx && ay === by) {
        // Degenerate (single tap): tiny filled disc, same width as a
        // segment so the first tap doesn't read as a different tool.
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.arc(ax, ay, w / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
    }
    ctx.restore();
}

function drawSgraffitoBumpSegment(ctx, ax, ay, bx, by, w) {
    ctx.save();
    // Dark line = recessed (the bump shader reads brightness as
    // height; baseline is the procedural mid-grey ~128, dark here
    // reads as a clear groove). Drawn slightly narrower than the
    // mask so the depth sits inside the visible colour cut.
    const wB = w * 0.85;
    ctx.lineWidth   = wB;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.strokeStyle = "rgba(28,28,28,0.92)";
    if (ax === bx && ay === by) {
        ctx.fillStyle = "rgba(28,28,28,0.92)";
        ctx.beginPath();
        ctx.arc(ax, ay, wB / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
    }
    ctx.restore();
}

function clearSgraffito() {
    if (!state.sgraffitoCtx) return;
    state.sgraffitoCtx.clearRect(0, 0, DECO_W, DECO_H);
    if (state.sgraffitoTex) state.sgraffitoTex.needsUpdate = true;
    // Bump grooves from previous sgraffito strokes are NOT wiped —
    // they're permanent surface impressions, same model as the bump
    // stamps. Re-throwing or starting a new pot is the way to get a
    // clean bump.
}

// --- Stamps -----------------------------------------------------
function starPath(ctx, r, points = 5) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const fn = i === 0 ? "moveTo" : "lineTo";
        ctx[fn](Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
}
function heartPath(ctx, r) {
    const s = r / 16;
    ctx.beginPath();
    ctx.moveTo(0, 6 * s);
    ctx.bezierCurveTo(0, 1 * s, -8 * s, -6 * s, -13 * s, -1 * s);
    ctx.bezierCurveTo(-18 * s, 5 * s, -8 * s, 12 * s, 0, 17 * s);
    ctx.bezierCurveTo(8 * s, 12 * s, 18 * s, 5 * s, 13 * s, -1 * s);
    ctx.bezierCurveTo(8 * s, -6 * s, 0, 1 * s, 0, 6 * s);
    ctx.closePath();
}
function drawStamp(cx, cy, r, shape, hex) {
    const ctx = state.decoCtx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = rgba(hex, 0.95);
    ctx.strokeStyle = rgba(hex, 0.95);
    if (shape === "dot") {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    } else if (shape === "ring") {
        ctx.lineWidth = r * 0.34; ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.stroke();
    } else if (shape === "star") {
        starPath(ctx, r); ctx.fill();
    } else if (shape === "spark") {
        starPath(ctx, r, 4); ctx.fill();
    } else if (shape === "triangle") {
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.92, r * 0.7);
        ctx.lineTo(-r * 0.92, r * 0.7);
        ctx.closePath(); ctx.fill();
    } else if (shape === "diamond") {
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0);
        ctx.closePath(); ctx.fill();
    } else if (shape === "square") {
        ctx.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
    } else if (shape === "heart") {
        heartPath(ctx, r); ctx.fill();
    } else if (shape === "flower") {
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
    } else if (shape === "cross") {
        const w = r * 0.5, l = r * 1.7;
        ctx.fillRect(-w / 2, -l / 2, w, l);
        ctx.fillRect(-l / 2, -w / 2, l, w);
    }
    ctx.restore();
}
function stampAt(u, v) {
    if (state.decoColor == null) return;
    state.dirty = true;
    const r = decoRadius() * 1.25;
    const cx = u * DECO_W, cy = (1 - v) * DECO_H;
    drawStamp(cx, cy, r, state.stampShape, state.decoColor);
    if (cx < r * 2) drawStamp(cx + DECO_W, cy, r, state.stampShape, state.decoColor);
    else if (cx > DECO_W - r * 2) drawStamp(cx - DECO_W, cy, r, state.stampShape, state.decoColor);
    state.decoTex.needsUpdate = true;
}

// --- Overlays (one tap fills the whole surface) -----------------
function applyOverlay(id) {
    if (state.decoColor == null) return;
    state.dirty = true;
    const ctx = state.decoCtx, hex = state.decoColor;
    const cell = DECO_SIZES[state.decoSizeIndex].px * 2.4;
    ctx.save();
    ctx.fillStyle = rgba(hex, 0.85);
    if (id === "dots") {
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols;
        const rows = Math.max(3, Math.round(DECO_H / cw)), rh = DECO_H / rows, dr = cw * 0.22;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            let x = c * cw + cw * 0.5 + (r % 2 ? cw * 0.5 : 0);
            if (x > DECO_W) x -= DECO_W;
            const y = r * rh + rh * 0.5;
            ctx.beginPath(); ctx.arc(x, y, dr, 0, Math.PI * 2); ctx.fill();
            if (x < dr * 2) { ctx.beginPath(); ctx.arc(x + DECO_W, y, dr, 0, Math.PI * 2); ctx.fill(); }
        }
    } else if (id === "rings") {
        const rows = Math.max(3, Math.round(DECO_H / cell)), rh = DECO_H / rows, sh = rh * 0.32;
        for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rh + (rh - sh) / 2, DECO_W, sh);
    } else if (id === "stripes") {
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols, sw = cw * 0.4;
        for (let c = 0; c < cols; c++) ctx.fillRect(c * cw, 0, sw, DECO_H);
    } else if (id === "grid") {
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols, lw = Math.max(2, cw * 0.08);
        const rows = Math.max(3, Math.round(DECO_H / cw)), rh = DECO_H / rows;
        for (let c = 0; c < cols; c++) ctx.fillRect(c * cw, 0, lw, DECO_H);
        for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rh, DECO_W, lw);
    } else if (id === "scatter") {
        const n = Math.round((DECO_W * DECO_H) / (cell * cell * 1.4));
        for (let i = 0; i < n; i++) {
            const x = Math.random() * DECO_W, y = Math.random() * DECO_H;
            const dr = DECO_SIZES[state.decoSizeIndex].px * (0.12 + Math.random() * 0.28);
            ctx.beginPath(); ctx.arc(x, y, dr, 0, Math.PI * 2); ctx.fill();
        }
    } else if (id === "checker") {
        let cols = Math.max(4, Math.round(DECO_W / cell));
        if (cols % 2) cols++; // even cols → parity wraps seamlessly at the u-seam
        const cw = DECO_W / cols;
        const rows = Math.max(4, Math.round(DECO_H / cw)), rh = DECO_H / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            if ((r + c) % 2 === 0) ctx.fillRect(c * cw, r * rh, cw + 1, rh + 1);
        }
    } else if (id === "waves") {
        const rows = Math.max(3, Math.round(DECO_H / cell)), rh = DECO_H / rows;
        const amp = rh * 0.28, lw = Math.max(3, rh * 0.12);
        const N = 256; // even segments; last point lands exactly on DECO_W
        ctx.strokeStyle = rgba(hex, 0.85);
        ctx.lineWidth = lw;
        for (let r = 0; r < rows; r++) {
            const y = r * rh + rh * 0.5;
            ctx.beginPath();
            for (let i = 0; i <= N; i++) {
                const x = (i / N) * DECO_W;
                // 8 full cycles across the width → value matches at x=0 and x=DECO_W
                const yy = y + Math.sin((x / DECO_W) * Math.PI * 8) * amp;
                i === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
            }
            ctx.stroke();
        }
    } else if (id === "diagonal") {
        // Sheared vertical stripes: integer columns wrap in u, and the
        // per-row x-shift (with wrap) makes it read diagonal but seamless.
        const cols = Math.max(3, Math.round(DECO_W / cell)), cw = DECO_W / cols, sw = cw * 0.45;
        const slice = 3;
        for (let y = 0; y < DECO_H; y += slice) {
            const shift = y % DECO_W; // 45°: 1px of x per 1px of y
            for (let c = 0; c < cols; c++) {
                const x = (c * cw + shift) % DECO_W;
                ctx.fillRect(x, y, sw, slice + 1);
                if (x > DECO_W - sw) ctx.fillRect(x - DECO_W, y, sw, slice + 1); // wrap overflow
            }
        }
    }
    ctx.restore();
    state.decoTex.needsUpdate = true;
}

// Dispatch a pot-touch to the active decorate tool.
function decoApplyAt(u, v) {
    if (state.decoTool === "stamp")     stampAt(u, v);
    else if (state.decoTool === "carve") scratchAt(u, v);
    else                                 paintAt(u, v); // brush / splatter
    state.dirty = true;
}

// Raycast a pointer onto the pot and return the surface UV (or null).
function pointerToUV(ev) {
    const rect = state.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, state.camera);
    const hits = raycaster.intersectObject(state.pot, false);
    return hits.length && hits[0].uv ? hits[0].uv : null;
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
    // The bump canvas is shared: procedural clay grain + texture
    // stamps + carve grooves are all painted into the SAME canvas, so
    // we don't have to wrangle a custom sampler uniform.
    const s0 = CLAY_STATES[INITIAL_STATE];
    const bumpTex = makeBumpLayer();
    const mat = new THREE.MeshPhysicalMaterial({
        color: s0.color,
        roughness: s0.roughness,
        metalness: 0.0,
        clearcoat: s0.clearcoat,
        clearcoatRoughness: s0.clearcoatRoughness,
        envMapIntensity: s0.envMapIntensity,
        bumpMap: bumpTex,               // clay grain + throwing lines + edits
        bumpScale: s0.bump,
        side: THREE.DoubleSide,         // open vase — render the inner wall too
    });
    state.clayMaterial = mat;

    // Overlay the painted decoration layer + sgraffito carving on the
    // clay diffuse colour. (sRGB → linear via pow(2.2) before mixing
    // into linear space.) Sgraffito is sampled FIRST so the scratched
    // regions also strip any decoration on top — a carved line cuts
    // through both glaze and paint, not just through the base coat.
    const decoTex = makeDecoLayer();
    const sgraffitoTex = makeSgraffitoLayer();
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.decoMap        = { value: decoTex };
        shader.uniforms.sgraffitoMap   = { value: sgraffitoTex };
        shader.uniforms.uClayColor     = { value: state.clayBaseColor };
        shader.uniforms.uGradientColor = { value: state.gradientColor };
        shader.uniforms.uGradientMix   = { value: state.gradientMix };
        // Stash the uniform map on the material so tickMaterial can
        // poke the scalar uGradientMix each frame without re-running
        // onBeforeCompile. The Color uniforms hold a reference to the
        // same THREE.Color instance, so mutating state.gradientColor
        // in-place propagates automatically.
        mat.userData.shaderUniforms = shader.uniforms;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "varying vec2 vDecoUv;\n#include <common>")
            .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vDecoUv = uv;");
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                "uniform sampler2D decoMap;\nuniform sampler2D sgraffitoMap;\nuniform vec3 uClayColor;\nuniform vec3 uGradientColor;\nuniform float uGradientMix;\nvarying vec2 vDecoUv;\n#include <common>",
            )
            .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
                 // Gradient glaze: mix the diffuse toward a secondary
                 // glaze colour at the bottom of the pot. Smoothstep
                 // along vDecoUv.y (0 = foot, 1 = rim) so the
                 // transition is soft. uGradientMix is the on/off fade.
                 float _gradT = smoothstep(0.15, 0.85, 1.0 - vDecoUv.y) * uGradientMix;
                 diffuseColor.rgb = mix(diffuseColor.rgb, uGradientColor, _gradT);
                 float _scratch = texture2D( sgraffitoMap, vDecoUv ).a;
                 vec4 _deco = texture2D( decoMap, vDecoUv );
                 diffuseColor.rgb = mix( diffuseColor.rgb, pow( _deco.rgb, vec3( 2.2 ) ), _deco.a * (1.0 - _scratch) );
                 // Inside a sgraffito cut, the wall is recessed — small
                 // shadow from the surrounding surface. Mixing toward a
                 // darkened clay tone gives the cut visible depth on
                 // top of the bump-shader's normal perturbation.
                 vec3 _carveColor = uClayColor * 0.78;
                 diffuseColor.rgb = mix( diffuseColor.rgb, _carveColor, _scratch );`,
            );
    };
    mat.customProgramCacheKey = () => "clay-gradient-sgraffito-v3";

    const pot = new THREE.Mesh(geo, mat);
    pot.castShadow = true;
    pot.receiveShadow = true;
    writeProfileToGeometry(pot.geometry);
    return pot;
}

// Seed `profile` from one of the starter silhouettes (see SHAPES).
// Control points are run through a spline (C1-continuous) so the
// surface reads smooth, not faceted, then resampled to one radius per
// evenly-spaced height row.
function seedProfile(shapeId) {
    const id = SHAPES[shapeId] ? shapeId : (SHAPES[state.shape] ? state.shape : DEFAULT_SHAPE);
    applyControlsToProfile(SHAPES[id].controls);
}

// Resample a [x, y] control-points array through a spline into the
// per-row profile array. Shared by seedProfile (preset silhouettes)
// and seedLidForRim (parametric lid generation).
function applyControlsToProfile(controls) {
    const ctrl = controls.map(([x, y]) => new THREE.Vector2(x, y));
    const curve = new THREE.SplineCurve(ctrl).getPoints(600);
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
    clampProfile(); // seed must obey the (possibly relaxed) envelope
}

// Generate a lid silhouette whose base radius matches the source
// pot's rim exactly, so the two pieces visibly fit together. Style
// picks the dome + knob proportions — Flat is a shallow disc-like
// lid, Domed is a graceful default, Tall is steep with a prominent
// finial. Picked from state.lidStyle when not passed explicitly.
function seedLidForRim(rimR, style) {
    rimR = Math.max(MIN_R, Math.min(MAX_R, rimR));
    const id = (LID_STYLES[style] ? style : state.lidStyle) || "domed";
    const controls = LID_STYLES[id](rimR);
    state.lidMaxY = lidCapY(controls);
    applyControlsToProfile(controls);
    smoothLidApex();
}

// Round off the lid's apex so it doesn't render as a pinprick. The
// raw spline closes to zero over one or two rows — fine on paper,
// but the last sliver of geometry between a tiny non-zero radius and
// the pole vertex shows up as a sharp point at the top of the lid.
// Replace the last few rows before the cap with a quarter-circle
// (hemisphere) profile so the silhouette curves to zero like a dome.
function smoothLidApex() {
    if (!state.isLid) return;
    const EPS = 0.001;
    // Find the apex row = the first row at radius 0, walking down
    // from the top until we hit a non-zero radius.
    let apexRow = -1;
    for (let r = ROWS; r >= 0; r--) {
        if (profile[r] >= EPS) { apexRow = r + 1; break; }
    }
    if (apexRow <= 0 || apexRow > ROWS) return;
    const BLEND = 6;
    const startRow = apexRow - BLEND;
    if (startRow < 1) return;
    const startR = profile[startRow];
    if (startR < EPS * 2) return;
    const startY = (startRow / ROWS) * TOP;
    const apexY  = (apexRow  / ROWS) * TOP;
    const dy = apexY - startY;
    if (dy <= 0) return;
    for (let r = startRow; r <= apexRow; r++) {
        const y = (r / ROWS) * TOP;
        const tNorm = THREE.MathUtils.clamp((y - startY) / dy, 0, 1);
        // r(θ) = startR·cos(θ),  y(θ) = startY + dy·sin(θ).
        // Given a row's y, recover θ via asin so the profile sits on
        // a true quarter-circle (a flat half-dome cap), not a
        // misaligned ellipse.
        profile[r] = startR * Math.sqrt(1 - tNorm * tNorm);
    }
    profile[apexRow] = 0; // ensure the apex sits exactly at the axis
}

// Find the y at which the lid's silhouette first closes to the axis
// (the first control point with x≈0 after a non-zero one). Above this
// y, the lid is just collapsed rings -- sculpting there would regrow
// the silhouette, which is what we want to prevent.
function lidCapY(controls) {
    let lastX = 0;
    for (const [x, y] of controls) {
        if (lastX > 0.001 && x < 0.001) return y;
        lastX = x;
    }
    return TOP; // never closes — use full height
}

// Same cap, recovered from a sampled profile array — used when a lid
// is restored from a swap snapshot or a saved gallery entry, where the
// original control points are long gone but the collapse rings at the
// top of the silhouette still encode the cap height.
function lidCapFromProfile(prof) {
    const EPS = 0.001;
    for (let r = ROWS; r >= 0; r--) if (prof[r] >= EPS) return (r + 1) * (TOP / ROWS);
    return TOP;
}

// --- Handle (pot-side ear) --------------------------------------
// A separate mesh built as a tube along a C-curve attached at two
// y-points on the pot's current profile. NOT a surface of revolution,
// so it sits outside the lathe pipeline — its own geometry, its own
// material (no deco / sgraffito uniforms), but tweens the same
// colour / roughness / clearcoat as the clay so it reads as one piece
// through wet / leather / fired. Only meaningful on the pot — when
// state.isLid is true the handle hides.
function setHeightScale(scale) {
    scale = Math.max(MIN_HEIGHT_SCALE, Math.min(MAX_HEIGHT_SCALE, scale));
    if (Math.abs(state.heightScale - scale) < 1e-4) return;
    state.heightScale = scale;
    if (state.potGroup) state.potGroup.scale.y = scale;
    state.dirty = true;
    // Re-place the partner lid on top of the now-taller / shorter pot
    // if the assembled view is showing.
    if (state.assemblyShown) showAssemblyView();
    updateToolbar(); // refresh button disabled state at extremes
}
function nudgeHeight(delta) {
    if (state.clayState !== "wet") return; // height locks at leather+
    setHeightScale(state.heightScale + delta);
}

const HANDLE_BULGE     = 0.22;   // outward arc — modest amphora ear, not a giant wing
// HANDLE_THICKNESSES / HANDLE_THICKNESS_IDS / DEFAULT_HANDLE_THICKNESS
// + handleTubeRadius() are hoisted earlier in the file (before init())
// because buildHandleStylePicker reads HANDLE_THICKNESS_IDS during
// initial UI build, and the rest of the file's top-down evaluation
// hadn't reached this point yet — TDZ error otherwise.
const HANDLE_SHOULDER_RATIO = 0.70; // upper attach: row where r ≤ this × belly_r counts as shoulder

// Find the widest row in the pot body (skip the foot zone where the
// wheel constraint can artificially be the max). That's where the
// lower handle attach lands — on the belly, where you'd grip a real
// vessel.
function findBellyY() {
    const startRow = Math.floor((FOOT_TOP + FOOT_BLEND) / TOP * ROWS);
    const endRow   = Math.floor(0.80 * ROWS);
    let maxR = 0, maxRow = -1;
    for (let r = startRow; r <= endRow; r++) {
        if (profile[r] > maxR) { maxR = profile[r]; maxRow = r; }
    }
    if (maxRow < 0) return { y: 0.50 * TOP, r: 0.30 };
    return { y: (maxRow / ROWS) * TOP, r: maxR, row: maxRow };
}

// Find the shoulder y — walking up from the belly, the row where the
// profile drops below SHOULDER_RATIO × belly radius. That's where a
// real amphora handle's upper attach lands (right at the narrowing
// where body meets neck). If the pot has no narrowing (cylinder,
// open bowl), cap at the rim minus a small margin.
function findShoulderY(bellyRow, bellyR) {
    const limitY = TOP - 0.08;
    for (let r = bellyRow + 1; r <= ROWS; r++) {
        const y = (r / ROWS) * TOP;
        if (y >= limitY) return limitY;
        if (profile[r] < bellyR * HANDLE_SHOULDER_RATIO) return y;
    }
    return limitY;
}

function buildHandleCurve() {
    const belly = findBellyY();
    const baseYBot = belly.y;
    const baseYTop = findShoulderY(belly.row != null ? belly.row : Math.floor(baseYBot / TOP * ROWS), belly.r);
    // User-applied vertical shift (drag-to-reshape). Clamp so the
    // handle stays above the foot zone and below the rim.
    const limitMin = FOOT_TOP + FOOT_BLEND + 0.05;
    const limitMax = TOP - 0.08;
    const shift = state.handle.heightOffset || 0;
    const yBot = Math.max(limitMin, Math.min(limitMax - 0.10, baseYBot + shift));
    const yTop = Math.max(yBot + 0.10, Math.min(limitMax, baseYTop + shift));
    const rBot  = radiusAt(yBot);
    const rTop  = radiusAt(yTop);
    const span  = Math.max(0.05, yTop - yBot);
    const yMid  = (yTop + yBot) / 2;
    // Bulge clamps to the actual span so a short ear-tab stays small
    // (a tight ear is rounder than a stretched one). Cap at 0.30 so
    // even tall spans don't fly outward like a mug handle. The user's
    // drag bulgeOffset adds on top, allowed to range much wider.
    const baseBulge = Math.min(0.30, Math.max(HANDLE_BULGE * 0.5, span * 0.75));
    const bulge = Math.max(0.05, Math.min(0.80, baseBulge + (state.handle.bulgeOffset || 0)));
    // INSET the endpoints into the pot wall so the tube's open cap
    // is occluded by the opaque pot surface — without this you see
    // straight into the hollow tube end where it meets the wall and
    // the joint looks broken. ~2× the tube radius is enough depth
    // for the cross-section to clear the wall at typical viewing
    // angles without sinking so far the curve loses its shape.
    const inset = handleTubeRadius() * 2.2;
    // Tight amphora arc: short rise outward, peak at midspan, back in.
    // The peak X uses max(rTop, rBot) so the ear clears whichever wall
    // is wider rather than scooping into the pot.
    return new THREE.CatmullRomCurve3([
        new THREE.Vector3(rBot - inset,        yBot,             0),
        new THREE.Vector3(rBot + bulge * 0.50, yBot + span * 0.18, 0),
        new THREE.Vector3(Math.max(rTop, rBot) + bulge, yMid, 0),
        new THREE.Vector3(rTop + bulge * 0.50, yTop - span * 0.18, 0),
        new THREE.Vector3(rTop - inset,        yTop,             0),
    ]);
}

function buildHandleGeometry() {
    const curve = buildHandleCurve();
    return new THREE.TubeGeometry(curve, 40, handleTubeRadius(), 10, false);
}

function ensureHandleMesh() {
    if (state.handle.mesh) return state.handle.mesh;
    const initial = currentLook();
    const mat = new THREE.MeshPhysicalMaterial({
        color: initial.color,
        roughness: initial.roughness,
        clearcoat: initial.clearcoat,
        clearcoatRoughness: initial.clearcoatRoughness,
        envMapIntensity: initial.envMapIntensity,
        metalness: initial.metalness != null ? initial.metalness : 0,
    });
    state.handle.material = mat;
    const geo = buildHandleGeometry();
    // Right ear (canonical geometry).
    const right = new THREE.Mesh(geo, mat);
    right.castShadow = true;
    right.receiveShadow = true;
    // Add to potGroup (not turntable) so the handle stretches with
    // the pot when the user grows heightScale — keeps the ear glued
    // to the belly + shoulder it was attached to in profile-space.
    state.potGroup.add(right);
    state.handle.mesh = right;
    // Left ear: same geometry + material, mirrored across the y axis
    // so it sits on the opposite side. scale.x = -1 flips winding —
    // material.side is THREE.DoubleSide-equivalent on FrontSide tubes
    // via the negative scale, so we'd see backface culling artifacts;
    // setting side to DoubleSide on the shared material is safest.
    mat.side = THREE.DoubleSide;
    const left = new THREE.Mesh(geo, mat);
    left.castShadow = true;
    left.receiveShadow = true;
    left.scale.x = -1;
    state.potGroup.add(left);
    state.handle.mirrorMesh = left;
    return right;
}

function rebuildHandleGeometry() {
    if (!state.handle.mesh) return;
    const old = state.handle.mesh.geometry;
    const fresh = buildHandleGeometry();
    state.handle.mesh.geometry = fresh;
    if (state.handle.mirrorMesh) state.handle.mirrorMesh.geometry = fresh;
    if (old) old.dispose();
}

function setHandleOn(on) {
    state.handle.on = !!on;
    // Toggling off clears the reshape — turning the handle back on
    // gives the user a fresh default-shaped ear rather than restoring
    // a stale drag from a previous session.
    if (!state.handle.on) {
        state.handle.bulgeOffset = 0;
        state.handle.heightOffset = 0;
    }
    if (state.handle.on) {
        ensureHandleMesh();
        rebuildHandleGeometry();
    }
    updateHandleVisibility();
    updateHandleStylePicker();
    state.dirty = true;
    updateToolbar();
}

function updateHandleVisibility() {
    const visible = state.handle.on && !state.isLid;
    if (state.handle.mesh)       state.handle.mesh.visible       = visible;
    if (state.handle.mirrorMesh) state.handle.mirrorMesh.visible = visible;
}

// Tube-radius preset swap. New geometry uses the new thickness; the
// inset compensation in buildHandleCurve also reads handleTubeRadius
// so the endpoint burial stays correct as the tube grows / shrinks.
function setHandleThickness(id) {
    if (!HANDLE_THICKNESSES[id]) return;
    state.handle.thickness = id;
    if (state.handle.on) rebuildHandleGeometry();
    updateHandleStylePicker();
    state.dirty = true;
}

// Reset the drag-reshape offsets so the handle re-snaps to the
// auto-derived belly + shoulder attach points. Mirrors the
// matchLidRim pattern — "refit to the current pot shape".
function refitHandle() {
    if (!state.handle.on || state.isLid) return;
    state.handle.bulgeOffset = 0;
    state.handle.heightOffset = 0;
    rebuildHandleGeometry();
    state.dirty = true;
    updateToolbar();
}

// Thickness picker chips (mirrors the lid-style picker structure).
function buildHandleStylePicker() {
    const wrap = document.getElementById("handleStylePicker");
    if (!wrap) return;
    wrap.innerHTML = "";
    HANDLE_THICKNESS_IDS.forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lid-style-btn"; // reuses the lid-style chip look
        b.dataset.thickness = id;
        b.textContent = id[0].toUpperCase() + id.slice(1);
        b.addEventListener("click", () => setHandleThickness(id));
        wrap.appendChild(b);
    });
    updateHandleStylePicker();
}
function updateHandleStylePicker() {
    document.querySelectorAll("#handleStylePicker .lid-style-btn").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.thickness === state.handle.thickness);
    });
}

// Rewrite vertex positions + normals from the current profile.
// Normals are ANALYTIC (derived from the profile slope) rather than
// face-averaged: a surface of revolution has an exact normal, which
// is smooth around each ring (no radial facet banding) and identical
// at angle 0 and 2π (no lighting seam where the lathe wraps). Cheap
// enough to call on every sculpting frame.
function writeProfileToGeometry(geo) {
    writeProfileArrayToGeometry(geo, profile);
}
function writeProfileArrayToGeometry(geo, prof) {
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const dyStep = TOP / ROWS;
    // Find the highest contiguous tail of zero-radius rings at the top
    // of the profile (lid silhouettes collapse to the axis above the
    // dome). All those rings will share the cap row's y so the
    // triangles between them have zero area in every dimension —
    // otherwise they'd render as a thin needle along the y axis.
    const EPS = 0.001;
    let firstCollapse = ROWS + 1;
    for (let r = ROWS; r >= 0; r--) {
        if (prof[r] < EPS) firstCollapse = r; else break;
    }
    const capY = firstCollapse <= ROWS ? firstCollapse * dyStep : ROWS * dyStep;
    for (let r = 0; r <= ROWS; r++) {
        const y = (r < firstCollapse) ? r * dyStep : capY;
        const rad = prof[r] < EPS ? 0 : prof[r];

        // 2D outward normal in the (radius, height) plane, from the
        // local profile slope. Central difference inside, one-sided
        // at the ends.
        let dr, dy;
        if (r === 0)         { dr = prof[1] - prof[0];           dy = dyStep; }
        else if (r === ROWS) { dr = prof[ROWS] - prof[ROWS - 1]; dy = dyStep; }
        else                 { dr = prof[r + 1] - prof[r - 1];   dy = 2 * dyStep; }
        let n2x = dy;
        let n2y = -dr;
        const len = Math.hypot(n2x, n2y) || 1;
        n2x /= len;
        n2y /= len;
        const bottomCap = r === 0;              // degenerate ring at the foot pole → faces down
        const topCap    = r >= firstCollapse;   // degenerate rings at the lid apex → face up

        for (let c = 0; c <= COLS; c++) {
            const theta = (c / COLS) * Math.PI * 2;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const i = (r * (COLS + 1) + c) * 3;
            pos[i]     = rad * cos;
            pos[i + 1] = y;
            pos[i + 2] = rad * sin;
            if (bottomCap) {
                nor[i] = 0; nor[i + 1] = -1; nor[i + 2] = 0;
            } else if (topCap) {
                // Apex pole gets a fully-upward normal so the lighting
                // reads it as a dome top instead of a horizontal ring —
                // pairs with the quarter-circle apex smoothing so the
                // slope-derived normals on rows below blend cleanly up.
                nor[i] = 0; nor[i + 1] = 1; nor[i + 2] = 0;
            } else {
                nor[i] = n2x * cos; nor[i + 1] = n2y; nor[i + 2] = n2x * sin;
            }
        }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
    // If a handle is attached AND this is the live pot mesh (not a
    // partner mesh write), rebuild its geometry so the attach points
    // follow the sculpted rim/belly. writeProfileArrayToGeometry runs
    // for both the live pot and the partner mesh; we only want the
    // handle update on the live one.
    if (geo === state.pot?.geometry && state.handle.on && !state.isLid) {
        rebuildHandleGeometry();
    }
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
    // Above a lid's cap, the silhouette is supposed to be the axis —
    // any radius leaking up there (from a Gaussian sculpt) gets
    // clamped back to 0 via clampProfile.
    if (state.isLid && state.lidMaxY != null && y > state.lidMaxY) return 0;
    // A lid sits on the pot, not on the wheel — the foot can be as
    // wide as MAX_R. A regular pot's foot is capped to the wheel head
    // so the contact base can't overhang.
    const baseMax = state.isLid ? MAX_R : BASE_MAX;
    if (y <= FOOT_TOP) return baseMax;
    const t = THREE.MathUtils.clamp((y - FOOT_TOP) / FOOT_BLEND, 0, 1);
    return THREE.MathUtils.lerp(baseMax, MAX_R, t);
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

// Leather-hard trimming: a finer sculpt that ONLY affects the foot
// zone, and ONLY cuts inward (you can't bulge a leather-hard foot).
// Real potters trim with a loop tool to clean up the foot ring — this
// is the digital equivalent.
const TRIM_MAX_Y    = FOOT_TOP * 1.9;  // trim only acts below this height
const TRIM_STRENGTH = 0.28;            // a touch firmer than wet sculpting
function trimToward(y, targetR) {
    if (y > TRIM_MAX_Y) return;
    const currentR = radiusAt(y);
    if (targetR >= currentR) return;   // trim only carves inward
    targetR = THREE.MathUtils.clamp(targetR, MIN_R, MAX_R);
    const centerRow = (y / TOP) * ROWS;
    const sigma = BRUSHES[state.brushIndex].sigma * 0.55; // narrower than throw
    const sigmaRows = (sigma / TOP) * ROWS;
    const reach = Math.ceil(sigmaRows * 3);
    const lo = Math.max(1, Math.floor(centerRow - reach));
    const hi = Math.min(ROWS, Math.ceil(centerRow + reach));
    // Single pass: max desired delta (drives the cap) + thinnest core
    // row (drives the thinness penalty — already-trimmed foot resists
    // further removal, so the loop tool can't run away into MIN_R).
    let maxAbs = 0;
    let minRInCore = currentR;
    for (let r = lo; r <= hi; r++) {
        const rowY = (r / ROWS) * TOP;
        if (rowY > TRIM_MAX_Y) continue;
        const d = (r - centerRow) / sigmaRows;
        const wbase = Math.exp(-0.5 * d * d);
        const w = wbase * TRIM_STRENGTH;
        const abs = Math.abs((targetR - profile[r]) * w);
        if (abs > maxAbs) maxAbs = abs;
        if (wbase > 0.4 && profile[r] < minRInCore) minRInCore = profile[r];
    }
    // Convert per-second cap to per-call cap using actual elapsed time.
    // Clamp dt so a paused finger doesn't bank up a single huge step on
    // the next sample, and bound the cap floor for cold-start / 60 Hz.
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const dt = lastTrimT ? Math.min(0.05, Math.max(0.005, (now - lastTrimT) / 1000)) : 1 / 60;
    lastTrimT = now;
    const thinness = THREE.MathUtils.clamp((minRInCore - MIN_R) / THIN_BAND, THIN_FLOOR, 1);
    const cap = TRIM_RATE_MAX * dt * thinness;
    // Scale the whole Gaussian uniformly so the loop tool's shape
    // doesn't flatten under the cap — it just slows down as a whole.
    const scale = (maxAbs > cap && maxAbs > 0) ? cap / maxAbs : 1;
    for (let r = lo; r <= hi; r++) {
        const rowY = (r / ROWS) * TOP;
        if (rowY > TRIM_MAX_Y) continue;
        const d = (r - centerRow) / sigmaRows;
        const w = Math.exp(-0.5 * d * d) * TRIM_STRENGTH;
        profile[r] = profile[r] + (targetR - profile[r]) * w * scale;
    }
    clampProfile();
    profileDirty = true;
    state.dirty = true;
}

// Pull the silhouette toward `targetR` around height `y`, with a
// Gaussian vertical falloff so the clay bulges instead of stepping.
function sculptToward(y, targetR) {
    // For lids, refuse sculpting above the cap — neither the touch
    // point nor the falloff loop should touch collapsed rings.
    if (state.isLid && state.lidMaxY != null && y > state.lidMaxY) return;
    targetR = THREE.MathUtils.clamp(targetR, MIN_R, MAX_R);
    const centerRow = (y / TOP) * ROWS;
    const cRowIdx   = Math.max(0, Math.min(ROWS, Math.round(centerRow)));
    const sigmaRows = (BRUSHES[state.brushIndex].sigma / TOP) * ROWS;
    const reach = Math.ceil(sigmaRows * 3);
    const lo = Math.max(1, Math.floor(centerRow - reach));
    const hi = Math.min(ROWS, Math.ceil(centerRow + reach));
    // Single pass: collect the strongest desired delta (drives the cap
    // scale) and the thinnest wall inside the brush's core (drives the
    // thinness penalty). The "core" is rows where the bare Gaussian
    // weight > 0.4 — the inner ~40% of the brush; fringe rows don't
    // count because they barely register the move.
    let maxAbs = 0;
    let minRInCore = profile[cRowIdx];
    for (let r = lo; r <= hi; r++) {
        if (state.isLid && state.lidMaxY != null && (r / ROWS) * TOP > state.lidMaxY) continue;
        const d = (r - centerRow) / sigmaRows;
        const wbase = Math.exp(-0.5 * d * d);
        const w = wbase * STRENGTH;
        const abs = Math.abs((targetR - profile[r]) * w);
        if (abs > maxAbs) maxAbs = abs;
        if (wbase > 0.4 && profile[r] < minRInCore) minRInCore = profile[r];
    }
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const dt = lastSculptT ? Math.min(0.05, Math.max(0.005, (now - lastSculptT) / 1000)) : 1 / 60;
    lastSculptT = now;
    // Asymmetric clay feel. Thinness ALWAYS applies (stretching thin
    // clay tears just like pinching it does); pull penalty stacks on
    // top for outward moves.
    //
    // Lids are tiny structures by design — the silhouette is narrow
    // everywhere, so the same THIN_BAND that protects a pot wall from
    // pinch-to-zero makes the lid's apex effectively unworkable. Lift
    // the floor and narrow the band on lids so only walls genuinely
    // at MIN_R slow down; everything wider sculpts at near-full speed.
    const isPull = targetR > profile[cRowIdx];
    const thinFloor = state.isLid ? 0.35 : THIN_FLOOR;
    const thinBand  = state.isLid ? 0.04 : THIN_BAND;
    const thinness = THREE.MathUtils.clamp((minRInCore - MIN_R) / thinBand, thinFloor, 1);
    const capMod = thinness * (isPull ? PULL_PENALTY : 1);
    // Brush-inverse rate scaling: a fine brush moves fewer rows per
    // sample (narrower Gaussian) so the cap-divided absolute movement
    // per second is naturally small. Boost the cap inversely to the
    // brush sigma so fine-detail work stays responsive while broad
    // sweeps still lag like real wet clay. Reference brush is medium.
    const brushBoost = BRUSHES[1].sigma / BRUSHES[state.brushIndex].sigma;
    const cap = SCULPT_RATE_MAX * dt * capMod * brushBoost;
    const scale = (maxAbs > cap && maxAbs > 0) ? cap / maxAbs : 1;
    for (let r = lo; r <= hi; r++) {
        if (state.isLid && state.lidMaxY != null && (r / ROWS) * TOP > state.lidMaxY) continue;
        const d = (r - centerRow) / sigmaRows;
        const w = Math.exp(-0.5 * d * d) * STRENGTH;
        profile[r] = profile[r] + (targetR - profile[r]) * w * scale;
    }
    // Local smoothing pass — what the wheel's rotation does for a real
    // thrower: it slides clay across the hand many times per second,
    // averaging out micro-bumps under the contact. Scoped to the brush
    // core so a fine brush keeps crisper edges than a broad one, and
    // never touches the lid cap zone (where rings are pinched to zero
    // and must stay that way).
    const sLo = Math.max(2, Math.floor(centerRow - sigmaRows * 0.6));
    const sHi = Math.min(ROWS - 1, Math.ceil(centerRow + sigmaRows * 0.6));
    for (let r = sLo; r <= sHi; r++) {
        if (state.isLid && state.lidMaxY != null && (r / ROWS) * TOP > state.lidMaxY) continue;
        const avg = (profile[r - 1] + 2 * profile[r] + profile[r + 1]) / 4;
        profile[r] = profile[r] + (avg - profile[r]) * SMOOTH_ALPHA;
    }
    clampProfile(); // the foot can't pull wider than the wheel
    profileDirty = true;
    state.dirty = true;
}

// --- Material states (wet → bone-dry/decorate → fired) ----------

// The material look for the current phase. A chosen glaze shows as a
// matte raw coat at the leather-hard / decorate stage, then glossy
// once fired; with no glaze it's bare clay (and plain fired
// earthenware).
function currentLook() {
    const cs = state.clayState;
    if (cs === "fired")   return state.glaze ? GLAZES[state.glaze].fired : CLAY_STATES.fired;
    if (cs === "leather") return state.glaze ? GLAZES[state.glaze].raw   : CLAY_STATES.leather;
    return CLAY_STATES.wet;
}

// Look for the secondary (gradient) glaze at the current clay state.
// Returns null when there's no gradient — caller fades the mix to 0
// so the shader smoothly drops back to the primary-only look.
function currentGradientLook() {
    if (!state.glazeGradient) return null;
    const g = GLAZES[state.glazeGradient];
    if (!g) return null;
    const cs = state.clayState;
    if (cs === "fired")   return g.fired;
    if (cs === "leather") return g.raw;
    return null; // wet — gradient invisible (no glaze layer rendered yet)
}

// Enter a phase: point the material tween at its look, refresh the UI.
function setPhase(name) {
    state.clayState = name;
    state.clayTarget = currentLook();
    // Show or hide the assembled lid-on-pot view: only at Fired, only
    // when a partner is paused in memory.
    const hasPartner = !!(state.savedPot || state.savedLid);
    if (name === "fired" && hasPartner) {
        showAssemblyView();
    } else if (state.assemblyShown) {
        hideAssemblyView();
    }
    updateToolbar();
}

// The forward control: dry → fire → new pot.
function advanceStage() {
    dismissFirstRunHint(); // progressing the arc counts as engaged
    switch (state.clayState) {
        case "wet":
            setPhase("leather"); // firms to leather-hard, ready to decorate
            // Tandem shaping: if the user made a partner at wet, advance
            // it alongside so both pieces ride the clay arc together
            // instead of having to be dried independently. We only
            // promote a partner that's still at wet — a partner that's
            // already been dried (the original leather-flow scenario,
            // where the pot is frozen at leather while the lid is fresh)
            // stays where it is.
            if (state.savedPot && state.savedPot.clayState === "wet") state.savedPot.clayState = "leather";
            if (state.savedLid && state.savedLid.clayState === "wet") state.savedLid.clayState = "leather";
            state.dirty = true;
            break;
        case "leather":
            setPhase("fired");
            playSfx("kiln");
            haptic(30); // a firmer rumble for the commitment to fire
            startFiringMoment();
            // The partner's clayState stays "leather" through the kiln
            // animation so it enters the view at its raw-glaze look
            // and tweens to fired alongside the active piece;
            // endFiringMoment flips it to "fired" when the sequence
            // wraps up.
            state.dirty = true;
            break;
        case "fired":   resetPot();          break;
    }
}

// The cinematic kiln sequence: ~4.5 s of close → fire → cool → open.
// The kiln-vignette overlay (dark edge + warm inner glow) takes over
// the frame; the backdrop fades to near-black; the auto-spin stops
// (state.firing in the busy flag); the material tween slows so the
// glaze visibly melts raw → fired; the music ducks; the kiln SFX
// plays alongside. Tick() drives the per-frame interpolation.
const FIRING_DURATION = 4.5;
const FIRING_MUSIC_DUCK = 0.38; // multiplier on saved music volume during firing

function startFiringMoment() {
    state.firing = true;
    state.firingStart = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const v = document.getElementById("kilnVignette");
    if (v) {
        v.style.opacity = "0";   // tick() will ramp it up
        const edge = v.querySelector(".kiln-edge");
        const glow = v.querySelector(".kiln-inner-glow");
        if (edge) edge.style.opacity = "0";
        if (glow) glow.style.opacity = "0";
    }
    // Save current music volume so we can restore on exit.
    if (music && !music.paused) {
        state._musicSavedVol = music.volume;
    } else {
        state._musicSavedVol = null;
    }
}

function endFiringMoment() {
    state.firing = false;
    const v = document.getElementById("kilnVignette");
    if (v) {
        v.style.opacity = "0";
        const glow = v.querySelector(".kiln-inner-glow");
        if (glow) glow.style.opacity = "0";
    }
    const bd = document.getElementById("backdrop");
    if (bd) bd.style.opacity = "1";
    if (music && state._musicSavedVol != null) music.volume = state._musicSavedVol;
    state._musicSavedVol = null;
    // The partner finished firing alongside the active piece — keep
    // its saved clayState consistent so later swap/save logic works.
    if (state.savedPot) state.savedPot.clayState = "fired";
    if (state.savedLid) state.savedLid.clayState = "fired";
    // Save + Photo were gated on !state.firing — bring them back now.
    updateToolbar();
}

// 0..1 ease for smooth-in/out transitions inside the firing phases.
function smoothstep(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
}

// Decorate: pick a glaze on the bone-dry pot (tap the active one again
// to clear it and fire bare).
function setGlaze(id) {
    if (!GLAZES[id]) return;
    const wasActive = state.glaze === id;
    state.glaze = wasActive ? null : id;
    // Clearing the primary clears the gradient too — gradient can't
    // exist without a primary glaze underneath.
    if (!state.glaze) state.glazeGradient = null;
    // Don't allow primary == gradient (would render a flat colour).
    if (state.glaze && state.glaze === state.glazeGradient) state.glazeGradient = null;
    state.dirty = true;
    if (!wasActive) playSfx("pour"); // soft pour when a glaze is selected
    if (state.clayState === "leather") setPhase("leather"); // refresh the raw look
    updateGlazeBar();
}

function setGradientGlaze(id) {
    if (!GLAZES[id]) return;
    if (!state.glaze) return; // gradient requires a primary
    if (id === state.glaze) return; // gradient must differ from primary
    const wasActive = state.glazeGradient === id;
    state.glazeGradient = wasActive ? null : id;
    state.dirty = true;
    if (!wasActive) playSfx("pour");
    if (state.clayState === "leather") setPhase("leather");
    updateGlazeBar();
}

// Step back one phase to keep editing. The ends are commitments: wet
// (start) and fired. The glaze choice is kept across a re-wet.
function stepBack() {
    const cs = state.clayState;
    if (cs === "wet" || cs === "fired") return;
    const next = PHASES[PHASES.indexOf(cs) - 1];
    setPhase(next);
    if (next === "wet") playSfx("drip");
    updateGlazeBar();
}

// Start a fresh wet pot.
function resetPot() {
    state.isLid = false; // back to regular pot rules — wheel constrains the foot
    state.lidMaxY = null;
    state.savedPot = null;
    state.savedLid = null;
    seedProfile();
    profileDirty = true;
    state.glaze = null;
    state.glazeGradient = null;
    clearDeco();
    resetBumpLayer();
    // Clear the handle on reset — a fresh pot starts handle-less.
    state.handle.on = false;
    state.handle.bulgeOffset = 0;
    state.handle.heightOffset = 0;
    state.handle.thickness = DEFAULT_HANDLE_THICKNESS;
    updateHandleVisibility();
    updateHandleStylePicker();
    // Reset the per-piece vertical stretch — fresh pot, default height.
    setHeightScale(1.0);
    setPhase(INITIAL_STATE);
    state.dirty = false;
    updateGlazeBar();
}

// Choose which silhouette new pots seed from. Persists to localStorage.
// Resets the live pot too, so the choice is immediately visible.
function setShape(id) {
    if (!SHAPES[id]) return;
    state.shape = id;
    try { localStorage.setItem("slip-shape", id); } catch (_) {}
    updateShapePicker();
    resetPot();
}

function updateShapePicker() {
    const wrap = document.getElementById("shapePicker");
    if (!wrap) return;
    Array.from(wrap.children).forEach((el, i) => {
        el.classList.toggle("is-active", SHAPE_IDS[i] === state.shape);
    });
}

// Build a tiny SVG silhouette of a shape from its spline control points,
// so the picker icon matches exactly what the seeded pot will look like.
function shapeIconSVG(shapeId) {
    const sh = SHAPES[shapeId];
    if (!sh) return "";
    const pts = sh.controls;
    const VW = 60, VH = 70, CX = 30, SY = 48, SX = 28, MY = 4;
    const left  = pts.map(([r, y]) => `${(CX - r * SX).toFixed(1)},${(VH - MY - y * SY).toFixed(1)}`);
    const right = [...pts].reverse().map(([r, y]) => `${(CX + r * SX).toFixed(1)},${(VH - MY - y * SY).toFixed(1)}`);
    const d = `M${left.join(" L")} L${right.join(" L")} Z`;
    return `<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="currentColor"/></svg>`;
}

function buildShapePicker() {
    const wrap = document.getElementById("shapePicker");
    if (!wrap) return;
    wrap.innerHTML = "";
    SHAPE_IDS.forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "shape-swatch";
        b.innerHTML = shapeIconSVG(id) + `<span>${SHAPES[id].label}</span>`;
        b.setAttribute("aria-label", SHAPES[id].label + " starter shape");
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => setShape(id));
        wrap.appendChild(b);
    });
    updateShapePicker();
}

// Choose a brush size; reflect the active one in the brush bar.
function setBrush(i) {
    state.brushIndex = THREE.MathUtils.clamp(i, 0, BRUSHES.length - 1);
    document.querySelectorAll(".brush-btn").forEach((b, idx) => {
        const on = idx === state.brushIndex;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

// Ease the material toward the current state's look each frame, so
// stage changes read as a calm transition rather than a hard cut.
// During the firing sequence the time constant slows ~7x so the user
// actually watches the glaze melt raw → fired instead of snapping.
const _scratchTargetColor = new THREE.Color();
const _gradientTargetColor = new THREE.Color();
function tickMaterial(dt) {
    const m = state.clayMaterial;
    const t = state.clayTarget;
    if (!m || !t) return;
    const rate = state.firing ? 0.8 : 5; // tau = 1/rate seconds
    const k = 1 - Math.exp(-dt * rate);
    targetColor.setHex(t.color);
    m.color.lerp(targetColor, k);
    m.roughness          += (t.roughness          - m.roughness)          * k;
    m.clearcoat          += (t.clearcoat          - m.clearcoat)          * k;
    m.clearcoatRoughness += (t.clearcoatRoughness - m.clearcoatRoughness) * k;
    m.envMapIntensity    += (t.envMapIntensity    - m.envMapIntensity)    * k;
    m.bumpScale          += (t.bump               - m.bumpScale)          * k;
    m.metalness          += ((t.metalness != null ? t.metalness : 0) - m.metalness) * k;
    // Bare-clay base colour for the sgraffito carve uniform. Always
    // tracks the CURRENT CLAY STATE'S colour (NOT the glaze), so
    // carved-through regions show the right tone — leather brown at
    // decorate, fired terracotta after the kiln. Same Color instance
    // is mutated so the shader uniform's value reference stays stable.
    _scratchTargetColor.setHex(CLAY_STATES[state.clayState].color);
    state.clayBaseColor.lerp(_scratchTargetColor, k);
    // Gradient (secondary) glaze: tween the secondary colour toward
    // the right raw/fired look, and tween the mix scalar 0 ↔ 1.
    // When there's no secondary glaze, just fade mix back to 0 — the
    // shader becomes a no-op without us having to swap programs.
    const gLook = currentGradientLook();
    if (gLook) {
        _gradientTargetColor.setHex(gLook.color);
        state.gradientColor.lerp(_gradientTargetColor, k);
    }
    const wantMix = gLook ? 1 : 0;
    state.gradientMix += (wantMix - state.gradientMix) * k;
    const u = state.clayMaterial.userData.shaderUniforms;
    if (u && u.uGradientMix) u.uGradientMix.value = state.gradientMix;
    // Handle (if attached) tweens the same look as the clay so it
    // melts raw → fired alongside the pot through the kiln. No deco
    // / sgraffito on the handle in v1 — just glaze colour.
    if (state.handle.material && state.handle.on) {
        const hm = state.handle.material;
        hm.color.lerp(targetColor, k);
        hm.roughness          += (t.roughness          - hm.roughness)          * k;
        hm.clearcoat          += (t.clearcoat          - hm.clearcoat)          * k;
        hm.clearcoatRoughness += (t.clearcoatRoughness - hm.clearcoatRoughness) * k;
        hm.envMapIntensity    += (t.envMapIntensity    - hm.envMapIntensity)    * k;
        hm.metalness          += ((t.metalness != null ? t.metalness : 0) - hm.metalness) * k;
    }
}

// The stage label, including the glaze name once chosen.
function stageLabelText() {
    const cs = state.clayState;
    if (cs === "fired")   return state.glaze ? GLAZES[state.glaze].name + " glaze" : "Fired";
    if (cs === "leather") return state.glaze ? GLAZES[state.glaze].name : CLAY_STATES.leather.label;
    return CLAY_STATES.wet.label;
}

// Reflect the current phase in the UI: stage label, advance button,
// back button (hidden at the ends), the brush bar (wet sculpting +
// leather-hard trimming), and the glaze palette (only while bone-dry
// / decorating).
function updateToolbar() {
    const cs = state.clayState;
    const label = document.getElementById("stageLabel");
    const advance = document.getElementById("advanceBtn");
    const back = document.getElementById("backBtn");
    const brushBar = document.getElementById("brushBar");
    const decoStack = document.getElementById("decoStack");
    if (label) label.textContent = stageLabelText();
    if (advance) advance.textContent = ADVANCE_LABEL[cs];
    if (back) {
        back.hidden = cs === "wet" || cs === "fired";
        if (!back.hidden) back.innerHTML = BACK_LABEL[cs] || "&larr; Back";
    }
    const saveBtn    = document.getElementById("saveBtn");
    const photoBtn   = document.getElementById("photoBtn");
    const makeLidBtn = document.getElementById("makeLidBtn");
    const swapBtn    = document.getElementById("swapBtn");
    const hasPartner = !!(state.savedPot || state.savedLid);
    const lidStylePicker = document.getElementById("lidStylePicker");
    // The brush bar is for wet sculpting only. Trim at leather reuses
    // whatever brush size you set in wet — no UI here so the
    // decorate panel doesn't get crowded with controls.
    if (brushBar) brushBar.hidden = cs !== "wet";
    if (decoStack) decoStack.hidden = cs !== "leather";
    if (lidStylePicker) lidStylePicker.hidden = !(state.isLid && cs === "wet");
    const handleStylePicker = document.getElementById("handleStylePicker");
    if (handleStylePicker) handleStylePicker.hidden = !(state.handle.on && !state.isLid && cs === "wet");
    // Hide Save + Photo while the kiln animation is still running —
    // cs flips to "fired" the instant advanceStage commits, so without
    // this guard both buttons appear during the 4.5 s firing sequence
    // and a mid-tween tap snaps the material + captures a half-melt.
    const firedAndCool = cs === "fired" && !state.firing;
    if (saveBtn) {
        saveBtn.hidden = !firedAndCool;
        // Icon-only: aria-label flips so screen readers + the title
        // attribute say "Save set" vs "Save" at the right moment.
        saveBtn.setAttribute("aria-label", hasPartner ? "Save set" : "Save");
        saveBtn.setAttribute("title",       hasPartner ? "Save set" : "Save");
    }
    if (photoBtn) photoBtn.hidden = !firedAndCool;
    // Lid button (dual-purpose): visible while you're on the pot at
    // any pre-fired stage. Creates a lid partner the first time you
    // tap it; on subsequent taps (a lid already exists) it swaps you
    // to the lid. Hidden when you're already shaping the lid — the
    // pot button (swapBtn) carries the reverse trip.
    if (makeLidBtn) {
        makeLidBtn.hidden = !(!state.isLid && cs !== "fired");
        const lidLabel = state.savedLid ? "Switch to lid" : "Add lid";
        makeLidBtn.setAttribute("aria-label", lidLabel);
        makeLidBtn.setAttribute("title",       lidLabel);
    }
    // Pot button (the renamed swapBtn): only visible while you're
    // shaping the lid AND a pot partner is paused in memory. Single
    // purpose now — swap back to pot.
    if (swapBtn) {
        swapBtn.hidden = !(state.isLid && !!state.savedPot && cs !== "fired");
        swapBtn.setAttribute("aria-label", "Switch to pot");
        swapBtn.setAttribute("title",       "Switch to pot");
    }
    // Match rim: only useful when the user is on the LID at WET and a
    // pot partner exists — that's when the lid's base can be re-fit to
    // the pot's current rim. (Always-visible would clutter the bar; an
    // unneeded tap from elsewhere wouldn't break anything anyway —
    // matchLidRim self-guards — but the chip-rich toolbar reads
    // cleaner when buttons appear only when they apply.)
    const matchRimBtn = document.getElementById("matchRimBtn");
    if (matchRimBtn) {
        const canMatch = state.isLid && cs === "wet" && !!state.savedPot;
        matchRimBtn.hidden = !canMatch;
    }
    // Handle toggle: only on the pot, only at wet (handles aren't
    // edited after the clay firms). Label flips between add and
    // remove so a single button covers both directions.
    const handleBtn = document.getElementById("handleBtn");
    if (handleBtn) {
        const canHandle = !state.isLid && cs === "wet";
        handleBtn.hidden = !canHandle;
        // Icon-only: the .is-active ring shows the on-state; aria-label
        // + title flip between Add/Remove so screen readers + hover
        // tooltips read the right intent.
        handleBtn.classList.toggle("is-active", state.handle.on);
        const label = state.handle.on ? "Remove handle" : "Add handle";
        handleBtn.setAttribute("aria-label", label);
        handleBtn.setAttribute("title",       label);
    }
    // Refit handle: mirrors matchRimBtn for the lid — visible while
    // a handle is attached at wet. Resets the user's drag offsets so
    // the ear re-snaps to the auto-derived belly + shoulder of the
    // current pot shape.
    const refitHandleBtn = document.getElementById("refitHandleBtn");
    if (refitHandleBtn) {
        refitHandleBtn.hidden = !(state.handle.on && !state.isLid && cs === "wet");
    }
    // Height nudgers: only at wet (clay can be stretched while wet
    // but locks once it firms). Disable at extremes so taps stop
    // mattering when you've already pushed the cap.
    const tallerBtn  = document.getElementById("tallerBtn");
    const shorterBtn = document.getElementById("shorterBtn");
    const canHeight = cs === "wet";
    if (tallerBtn) {
        tallerBtn.hidden = !canHeight;
        tallerBtn.disabled = state.heightScale >= MAX_HEIGHT_SCALE - 1e-3;
    }
    if (shorterBtn) {
        shorterBtn.hidden = !canHeight;
        shorterBtn.disabled = state.heightScale <= MIN_HEIGHT_SCALE + 1e-3;
    }
    if (cs === "leather") updateDecoSub();   // contextual sub-palette
}

// Build the glaze palette once (swatches coloured by each glaze's
// fired result — what you'll get).
function buildGlazeBar() {
    const bar = document.getElementById("glazeBar");
    if (!bar) return;
    bar.innerHTML = "";
    currentPackIds().forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "glaze-btn";
        b.dataset.glaze = id;
        b.style.background = "#" + new THREE.Color(GLAZES[id].fired.color).getHexString();
        b.setAttribute("aria-label", GLAZES[id].name + " glaze");
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => setGlaze(id));
        bar.appendChild(b);
    });
    buildGradientBar();
    updateGlazeBar();
}

// Optional second row for a gradient (bottom-half tint). Hidden until
// a primary glaze is picked; each swatch toggles the gradient pick.
function buildGradientBar() {
    const bar = document.getElementById("gradientBar");
    if (!bar) return;
    bar.innerHTML = "";
    currentPackIds().forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "glaze-btn glaze-btn-gradient";
        b.dataset.glaze = id;
        b.style.background = "#" + new THREE.Color(GLAZES[id].fired.color).getHexString();
        b.setAttribute("aria-label", GLAZES[id].name + " bottom gradient");
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => setGradientGlaze(id));
        bar.appendChild(b);
    });
}

// Pack tabs — small chip row above the glaze swatches. Same visual
// pattern as the backdrop category tabs so the picker pattern reads
// as one design. Click to switch the active pack; persists to
// localStorage so the user's preference sticks across sessions.
function buildGlazePackTabs() {
    const wrap = document.getElementById("glazePackTabs");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const [id, pack] of Object.entries(GLAZE_PACKS)) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "glaze-pack-tab";
        tab.dataset.pack = id;
        tab.textContent = pack.label;
        tab.addEventListener("click", () => setGlazePack(id));
        wrap.appendChild(tab);
    }
    syncGlazePackTabs();
}
function syncGlazePackTabs() {
    document.querySelectorAll(".glaze-pack-tab").forEach((t) => {
        t.classList.toggle("is-active", t.dataset.pack === state.glazePack);
    });
}
function setGlazePack(id) {
    if (!GLAZE_PACKS[id]) return;
    if (state.glazePack === id) return;
    state.glazePack = id;
    try { localStorage.setItem("slip-glaze-pack", id); } catch (_) {}
    syncGlazePackTabs();
    buildGlazeBar(); // rebuilds gradient bar + updates active marks too
}

// Mark the active glaze swatch + sync the gradient row visibility +
// disabled state of the matching primary swatch in the gradient row.
function updateGlazeBar() {
    const bar = document.getElementById("glazeBar");
    if (bar) {
        Array.from(bar.children).forEach((b) => {
            const on = b.dataset.glaze === state.glaze;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }
    const gradWrap = document.getElementById("gradientWrap");
    const gradBar  = document.getElementById("gradientBar");
    const hasPrimary = !!state.glaze;
    if (gradWrap) gradWrap.hidden = !hasPrimary;
    if (gradBar) {
        Array.from(gradBar.children).forEach((b) => {
            const id = b.dataset.glaze;
            const isPrimary = id === state.glaze;
            // The primary swatch can't also be the gradient — dim it.
            b.classList.toggle("is-disabled", isPrimary);
            b.disabled = isPrimary;
            const on = id === state.glazeGradient;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }
}

// --- Decoration UI ----------------------------------------------
function setDecoTool(name) {
    state.decoTool = name;
    [["toolBrush", "brush"], ["toolSplatter", "splatter"],
     ["toolStamp", "stamp"], ["toolOverlay", "overlay"],
     ["toolCarve", "carve"]].forEach(([id, t]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const on = name === t;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    updateDecoSub();
}

// Switch the tray between the Glaze and Decorate panels.
function setDecoTab(name) {
    const glaze = name === "glaze";
    const pG = document.getElementById("panelGlaze");
    const pD = document.getElementById("panelDecorate");
    const tG = document.getElementById("tabGlaze");
    const tD = document.getElementById("tabDecorate");
    if (pG) pG.hidden = !glaze;
    if (pD) pD.hidden = glaze;
    if (tG) { tG.classList.toggle("is-active", glaze); tG.setAttribute("aria-selected", glaze ? "true" : "false"); }
    if (tD) { tD.classList.toggle("is-active", !glaze); tD.setAttribute("aria-selected", !glaze ? "true" : "false"); }
}

// Pick which stamp shape to place.
function setStampShape(id) {
    state.stampShape = id;
    updateDecoSub();
}

// Build the contextual sub-palette: stamp shapes, or overlay patterns,
// or nothing (brush/splatter).
function updateDecoSub() {
    const sub = document.getElementById("decoSub");
    if (!sub) return;
    if (state.decoTool === "stamp") {
        sub.hidden = false;
        sub.innerHTML = "";
        STAMP_SHAPES.forEach((sh) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "deco-sub-btn";
            b.textContent = sh.glyph;
            b.setAttribute("aria-label", sh.id + " stamp");
            b.classList.toggle("is-active", sh.id === state.stampShape);
            b.addEventListener("click", () => setStampShape(sh.id));
            sub.appendChild(b);
        });
    } else if (state.decoTool === "overlay") {
        sub.hidden = false;
        sub.innerHTML = "";
        OVERLAY_PATTERNS.forEach((p) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "deco-sub-btn deco-sub-text";
            b.textContent = p.label;
            b.setAttribute("aria-label", p.label + " overlay");
            b.addEventListener("click", () => applyOverlay(p.id));
            sub.appendChild(b);
        });
    } else {
        sub.hidden = true;
        sub.innerHTML = "";
    }
}

// Pick a brush size (S/M/L).
function setDecoSize(i) {
    state.decoSizeIndex = THREE.MathUtils.clamp(i, 0, DECO_SIZES.length - 1);
    document.querySelectorAll(".deco-size").forEach((b, idx) => {
        const on = idx === state.decoSizeIndex;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

// Pick a paint colour (tap the active one again to stop painting).
function setDecoColor(hex) {
    state.decoColor = state.decoColor === hex ? null : hex;
    updateDecoSwatches();
}

function buildDecoBar() {
    const wrap = document.getElementById("decoColors");
    if (!wrap) return;
    DECO_COLORS.forEach((hex) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "deco-swatch";
        b.style.background = "#" + hex.toString(16).padStart(6, "0");
        b.setAttribute("aria-label", "Paint colour");
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => setDecoColor(hex));
        wrap.appendChild(b);
    });
}

function updateDecoSwatches() {
    const wrap = document.getElementById("decoColors");
    if (!wrap) return;
    Array.from(wrap.children).forEach((b, i) => {
        const on = DECO_COLORS[i] === state.decoColor;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
}

// --- Pointer: tools + view gestures -----------------------------
// One finger = the active tool (sculpt wet / paint bone-dry), or a
// drag-to-spin when there's no tool (fired). Two fingers = view
// control: pinch to zoom, drag to spin. Any zoom pauses the auto-spin.
const pointers = new Map(); // active pointerId -> {x, y}
let pinchPrevDist = 0;      // last two-finger distance (px)
let viewPrevX = 0;          // last drag x for manual spin (px)

function bindSculpt(canvas) {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
}

// --- View control -----------------------------------------------
function applyCamera() {
    const base   = state.assemblyShown ? CAM_ASSEMBLED_BASE   : CAM_BASE;
    const target = state.assemblyShown ? CAM_ASSEMBLED_TARGET : CAM_TARGET;
    const f = 1 / state.zoom; // higher zoom → camera closer to the target
    state.camera.position.set(
        target.x + (base.x - target.x) * f,
        target.y + (base.y - target.y) * f,
        target.z + (base.z - target.z) * f,
    );
    state.camera.lookAt(target);
}
function setZoom(z) {
    state.zoom = THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX);
    applyCamera();
}
function zoomBy(factor) { setZoom(state.zoom * factor); }
function rotateBy(rad) { state.turntable.rotation.y += rad; }

function onWheel(ev) {
    ev.preventDefault();
    zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
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
    // The pot's geometry is in profile-space (y in [0, TOP]) but the
    // potGroup stretches it vertically by state.heightScale to render
    // in world. Divide the raycast hit Y by the scale so sculpt /
    // trim / handle-drag all see the row the user actually touched,
    // not a row offset by the visual stretch.
    return { y: hitPoint.y / state.heightScale, r: Math.abs(hitPoint.x) };
}

// Raycast against the handle meshes. Returns the side ("right" /
// "left") of the ear that was hit, or null if the pointer missed.
// Cheap: only the two thin tubes are checked, not the full pot.
function raycastHandleMeshes(ev) {
    const rect = state.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, state.camera);
    const meshes = [];
    if (state.handle.mesh && state.handle.mesh.visible)       meshes.push(state.handle.mesh);
    if (state.handle.mirrorMesh && state.handle.mirrorMesh.visible) meshes.push(state.handle.mirrorMesh);
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes);
    if (!hits.length) return null;
    return { side: hits[0].object === state.handle.mesh ? "right" : "left" };
}

// Project pointer onto the handle's local X-Y plane (the plane the
// CatmullRom curve lives in, before the turntable's spin rotates it).
// Used by the drag-reshape gesture so per-frame motion converts to
// stable bulge / height offsets in the same coordinate system the
// curve is defined in. Lives in `_handlePlanePoint` to avoid per-call
// allocations.
const _handlePlane      = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _handlePlanePoint = new THREE.Vector3();
const _handleNormal     = new THREE.Vector3();
function pointerToHandleLocal(ev) {
    const rect = state.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, state.camera);
    // Reorient the handle's z=0 normal into world space using the
    // turntable's current rotation, so we intersect against the same
    // plane regardless of how the pot has been spun.
    _handleNormal.set(0, 0, 1).applyQuaternion(state.turntable.quaternion).normalize();
    _handlePlane.normal.copy(_handleNormal);
    _handlePlane.constant = 0;
    if (!raycaster.ray.intersectPlane(_handlePlane, _handlePlanePoint)) return null;
    state.turntable.worldToLocal(_handlePlanePoint);
    return { x: _handlePlanePoint.x, y: _handlePlanePoint.y };
}

function onPointerDown(ev) {
    // Any touch on the studio dismisses the first-run hints for good.
    dismissFirstRunHint();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size >= 2) {
        // Two fingers → view gesture; abandon any in-progress stroke
        // (sculpt, paint, OR handle-reshape) so the pinch/spin pair
        // takes over cleanly.
        sculpting = false;
        handleDrag = null;
        state.painting = false;
        lastPaintUV = null;
        state.userRotating = true;
        const [a, b] = [...pointers.values()];
        pinchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
        viewPrevX = (a.x + b.x) / 2;
        ev.preventDefault();
        return;
    }

    if (state.clayState === "wet") {
        // Handle reshape: grabbing an ear at wet starts a drag that
        // updates the handle's bulge / height offsets. Check this
        // BEFORE the sculpt grab so a pointer on the handle goes to
        // reshape, not to the pot wall hidden behind it.
        //
        // While a handle IS attached, pot sculpting is suppressed
        // entirely — a touch outside the handle just spins the pot.
        // Without this, a near-miss on the thin handle tube falls
        // through to the sculpt grab and quietly reshapes the wall
        // when the user was trying to drag the ear. To sculpt the
        // pot, remove the handle (one tap) and re-add it after
        // (auto-attaches to the new belly + shoulder).
        if (state.handle.on && !state.isLid) {
            const hit = raycastHandleMeshes(ev);
            if (hit) {
                const local = pointerToHandleLocal(ev);
                if (local) {
                    handleDrag = {
                        side: hit.side,
                        grabX: local.x,
                        grabY: local.y,
                        bulgeStart: state.handle.bulgeOffset || 0,
                        heightStart: state.handle.heightOffset || 0,
                    };
                    ev.preventDefault();
                    return;
                }
            }
            // Missed the handle → spin the pot, don't sculpt.
            state.userRotating = true;
            viewPrevX = ev.clientX;
            ev.preventDefault();
            return;
        }
        const p = pointerToProfile(ev);
        if (!p) return;
        if (p.y < -0.05 || p.y > TOP + 0.15) return;
        if (Math.abs(p.r - radiusAt(p.y)) > GRAB_TOL) return;
        sculpting = true;
        sculptToward(p.y, p.r);
        maybeSquelch();
        ev.preventDefault();
    } else if (state.clayState === "leather") {
        // Two actions live here. A silhouette grab in the foot zone
        // is a trim (constrained inward sculpt). Anything else, when
        // a paint colour is selected, is a brush/splatter/stamp tap.
        const p = pointerToProfile(ev);
        const inFoot = p && p.y >= -0.05 && p.y <= TRIM_MAX_Y
                    && Math.abs(p.r - radiusAt(p.y)) <= GRAB_TOL;
        if (inFoot) {
            sculpting = true;
            trimToward(p.y, p.r);
            maybeSquelch();
            ev.preventDefault();
            return;
        }
        // The Carve (sgraffito) tool doesn't need a paint colour — it
        // scratches into a separate mask layer. Brush / Splatter / Stamp
        // still gate on decoColor (no colour, no paint). Overlay is its
        // own one-tap action.
        const carveActive = state.decoTool === "carve";
        const paintActive = state.decoColor != null && state.decoTool !== "overlay" && state.decoTool !== "carve";
        if (carveActive || paintActive) {
            state.painting = true;
            const uv = pointerToUV(ev);
            if (uv) { decoApplyAt(uv.x, uv.y); lastPaintUV = { x: uv.x, y: uv.y }; }
            else lastPaintUV = null;
            ev.preventDefault();
            return;
        }
        // No tool engaged — fall through to spin.
        state.userRotating = true;
        viewPrevX = ev.clientX;
        ev.preventDefault();
    } else {
        // No tool here (e.g. fired) → drag to spin and inspect.
        state.userRotating = true;
        viewPrevX = ev.clientX;
        ev.preventDefault();
    }
}

function onPointerMove(ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size >= 2) {
        // Pinch → zoom, centroid drift → manual spin.
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchPrevDist > 0) zoomBy(dist / pinchPrevDist);
        pinchPrevDist = dist;
        const cx = (a.x + b.x) / 2;
        rotateBy((cx - viewPrevX) * ROTATE_SENS);
        viewPrevX = cx;
        ev.preventDefault();
        return;
    }

    if (handleDrag) {
        const local = pointerToHandleLocal(ev);
        if (local) {
            // Mirror on the left ear flips outward to -X; abs() unifies
            // the math so dragging either ear outward widens the bulge.
            const dx = Math.abs(local.x) - Math.abs(handleDrag.grabX);
            const dy = local.y - handleDrag.grabY;
            state.handle.bulgeOffset  = handleDrag.bulgeStart  + dx;
            state.handle.heightOffset = handleDrag.heightStart + dy;
            rebuildHandleGeometry();
            state.dirty = true;
        }
        ev.preventDefault();
        return;
    }
    if (sculpting) {
        const p = pointerToProfile(ev);
        if (p) {
            if (state.clayState === "leather") trimToward(p.y, p.r);
            else sculptToward(p.y, p.r);
            maybeSquelch();
        }
        ev.preventDefault();
    } else if (state.painting) {
        const uv = pointerToUV(ev);
        if (uv) {
            if (state.decoTool === "stamp") {
                // Place spaced stamps along the drag.
                const moved = !lastPaintUV ? Infinity : Math.hypot(
                    (uv.x - lastPaintUV.x) * DECO_W, (uv.y - lastPaintUV.y) * DECO_H);
                if (moved > decoRadius() * 1.8) { stampAt(uv.x, uv.y); lastPaintUV = { x: uv.x, y: uv.y }; }
            } else if (state.decoTool === "carve") {
                if (lastPaintUV) scratchStroke(lastPaintUV.x, lastPaintUV.y, uv.x, uv.y);
                else scratchAt(uv.x, uv.y);
                lastPaintUV = { x: uv.x, y: uv.y };
            } else {
                if (lastPaintUV) paintStroke(lastPaintUV.x, lastPaintUV.y, uv.x, uv.y);
                else paintAt(uv.x, uv.y);
                lastPaintUV = { x: uv.x, y: uv.y };
            }
        } else {
            lastPaintUV = null;
        }
        ev.preventDefault();
    } else if (state.userRotating) {
        rotateBy((ev.clientX - viewPrevX) * ROTATE_SENS);
        viewPrevX = ev.clientX;
        ev.preventDefault();
    }
}

function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchPrevDist = 0;
    if (pointers.size === 0) {
        sculpting = false;
        handleDrag = null;
        // Reset rate-cap timers so the next stroke's first sample uses
        // the 1/60 fallback instead of a multi-second gap that would
        // otherwise let a single first sample exhaust the per-call cap.
        lastSculptT = 0;
        lastTrimT = 0;
        state.painting = false;
        state.userRotating = false;
        lastPaintUV = null;
    } else {
        // Dropped from two fingers to one — stop spinning to avoid a jump.
        state.userRotating = false;
    }
}

// --- Persistence + gallery (local, IndexedDB) -------------------
const DB_NAME = "slip-studio", DB_STORE = "pots";

function openDB() {
    return new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE, { keyPath: "id" });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function dbPut(entry) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(entry);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}
async function dbAll() {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const rq = tx.objectStore(DB_STORE).getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
    });
}
async function dbDelete(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

// A square thumbnail of the pot. Rendered into an offscreen render
// target and read back with readRenderTargetPixels — reliable on every
// device (unlike toDataURL on the live canvas, which returns blank on
// some mobile GPUs). Framed square at the default (zoom-1) view.
function captureThumb(size = 320) {
    tickMaterial(10); // snap the glaze to its final look (skip the tween)
    const cam = state.camera;
    const prevAspect = cam.aspect;
    const prevPos = cam.position.clone();
    // Each saved entry is one piece — frame the active mesh alone
    // even if the live view is the assembled set.
    const prevPartnerVisible = state.partnerMesh && state.partnerMesh.visible;
    if (prevPartnerVisible) state.partnerMesh.visible = false;
    const prevPotY = state.pot.position.y;
    state.pot.position.y = 0;
    cam.aspect = 1;
    cam.position.copy(CAM_BASE);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(size, size);
    state.renderer.setRenderTarget(rt);
    state.renderer.setClearColor(BG_COLOR, 1); // opaque warm bg for the thumb
    state.renderer.clear();
    state.renderer.render(state.scene, cam);
    const buf = new Uint8Array(size * size * 4);
    state.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    state.renderer.setRenderTarget(null);
    state.renderer.setClearAlpha(0); // back to transparent for the live canvas
    rt.dispose();

    // restore everything
    cam.aspect = prevAspect;
    cam.position.copy(prevPos);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();
    state.pot.position.y = prevPotY;
    if (prevPartnerVisible) state.partnerMesh.visible = true;
    // (rest of the function returns the thumb data URL below)

    // GL pixels are bottom-up; flip into a 2D canvas, then encode.
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.85);
}

// Capture the assembled lid-on-pot view as a square thumbnail. Used
// once at save time so the gallery's set tile can show a single
// "set complete" image rather than two stacked halves. Only valid
// when state.assemblyShown is true (both meshes are positioned).
function captureAssemblyThumb(size = 360) {
    if (!state.assemblyShown) return null;
    tickMaterial(10);
    const cam = state.camera;
    const prevAspect = cam.aspect;
    const prevPos = cam.position.clone();
    cam.aspect = 1;
    cam.position.copy(CAM_ASSEMBLED_BASE);
    cam.lookAt(CAM_ASSEMBLED_TARGET);
    cam.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(size, size);
    state.renderer.setRenderTarget(rt);
    state.renderer.setClearColor(BG_COLOR, 1);
    state.renderer.clear();
    state.renderer.render(state.scene, cam);
    const buf = new Uint8Array(size * size * 4);
    state.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    state.renderer.setRenderTarget(null);
    state.renderer.setClearAlpha(0);
    rt.dispose();

    cam.aspect = prevAspect;
    cam.position.copy(prevPos);
    cam.lookAt(CAM_TARGET);
    cam.updateProjectionMatrix();

    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.86);
}

// --- Photo modal ------------------------------------------------
// The Photo button opens a modal with a live preview, 3 framing
// styles (Studio shelf / Sunlit window / Museum plinth), and a 1:1 /
// 9:16 aspect toggle. The pot is rendered once via the GL pipeline on
// modal open; toggling style/aspect just re-composites the 2D layer
// over that cached pot, so the preview updates instantly.

// Render the fired pot to a 1024×1024 transparent canvas (no backdrop).
// Reused for both preview and final save.
function captureScenePot(size) {
    size = size || 1024;
    tickMaterial(10); // snap the glaze to its fired look
    const cam = state.camera;
    const prevAspect = cam.aspect;
    const prevPos = cam.position.clone();
    // In set mode, frame the assembly (lid on pot); otherwise just the piece.
    const base   = state.assemblyShown ? CAM_ASSEMBLED_BASE   : CAM_BASE;
    const target = state.assemblyShown ? CAM_ASSEMBLED_TARGET : CAM_TARGET;
    cam.aspect = 1;
    cam.position.copy(base);
    cam.lookAt(target);
    cam.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(size, size);
    state.renderer.setRenderTarget(rt);
    state.renderer.setClearAlpha(0);
    state.renderer.clear();
    state.renderer.render(state.scene, cam);
    const buf = new Uint8Array(size * size * 4);
    state.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    state.renderer.setRenderTarget(null);
    rt.dispose();

    cam.aspect = prevAspect;
    cam.position.copy(prevPos);
    cam.lookAt(target);
    cam.updateProjectionMatrix();

    // GL pixels are bottom-up — flip into a 2D canvas.
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

async function loadBackdropImage() {
    return new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        const bg = BACKGROUNDS.find((b) => b.id === state.background);
        // Photo composite only handles still backdrops — video bgs
        // fall through to a transparent backdrop in the composer.
        img.src = bg && bg.type !== "video" ? bgAssetUrl(bg) : "";
    });
}

// Export-canvas height per aspect (width is always 1024).
//   square 1:1, feed 4:5 (Instagram feed), portrait 9:16 (stories).
function photoHeightFor(aspect) {
    if (aspect === "portrait") return 1820;
    if (aspect === "feed")     return 1280;
    return 1024;
}

// Compose the chosen style + aspect into target canvas.
function composeStyledPhoto(potCanvas, bgImage, style, aspect, target) {
    // Any non-square aspect uses the taller-frame layout (shelf lower,
    // pot nudged down, plinth + caption sized up).
    const isPortrait = aspect !== "square";
    const W = 1024;
    const H = photoHeightFor(aspect);
    target.width = W;
    target.height = H;
    const ctx = target.getContext("2d");

    // 1) Backdrop, cover-fit
    if (bgImage) {
        const r = Math.max(W / bgImage.width, H / bgImage.height);
        const w = bgImage.width * r, h = bgImage.height * r;
        const x = (W - w) / 2, y = (H - h) / 2;
        ctx.drawImage(bgImage, x, y, w, h);
    } else {
        ctx.fillStyle = "#1b1815";
        ctx.fillRect(0, 0, W, H);
    }

    // 2) Style decorations (under the pot)
    const baseY = isPortrait ? H * 0.62 : H * 0.66;
    if (style === "studio") {
        // Subtle shelf line + soft cast shadow
        ctx.fillStyle = "rgba(60, 40, 30, 0.20)";
        ctx.fillRect(0, baseY + 8, W, 4);
        const sh = ctx.createRadialGradient(W / 2, baseY + 30, 40, W / 2, baseY + 30, W * 0.42);
        sh.addColorStop(0, "rgba(0,0,0,0.42)");
        sh.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(0, baseY - 30, W, 130);
    } else if (style === "sunlit") {
        // Warm sun gradient from upper-right
        const sun = ctx.createRadialGradient(W * 0.82, H * 0.18, 0, W * 0.82, H * 0.18, W * 0.95);
        sun.addColorStop(0,    "rgba(255, 196, 110, 0.45)");
        sun.addColorStop(0.45, "rgba(255, 156,  80, 0.18)");
        sun.addColorStop(1,    "rgba(255, 156,  80, 0.00)");
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, W, H);
        // Long lower-left shadow
        const sh = ctx.createRadialGradient(W * 0.42, baseY + 30, 30, W * 0.42, baseY + 30, W * 0.5);
        sh.addColorStop(0, "rgba(0,0,0,0.50)");
        sh.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(0, baseY - 20, W, 130);
    } else if (style === "museum") {
        // Muted backdrop tint
        ctx.fillStyle = "rgba(20, 18, 16, 0.34)";
        ctx.fillRect(0, 0, W, H);
        // Plinth beneath the pot
        const plinthY = baseY + 60;
        const plinthH = isPortrait ? 220 : 180;
        const grad = ctx.createLinearGradient(0, plinthY, 0, plinthY + plinthH);
        grad.addColorStop(0, "rgba(34, 28, 22, 0.92)");
        grad.addColorStop(1, "rgba(14, 11,  9, 0.94)");
        ctx.fillStyle = grad;
        ctx.fillRect(W * 0.22, plinthY, W * 0.56, plinthH);
        // Caption strip
        const stripH = isPortrait ? 120 : 90;
        const stripY = H - stripH;
        ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
        ctx.fillRect(0, stripY, W, stripH);
        ctx.fillStyle = "rgba(243, 237, 230, 0.85)";
        // Museum-plinth caption uses the display face (Fraunces) for
        // gallery-catalog feel, with serif fallback if the woff2 isn't
        // yet on disk. The face was Quicksand pre-font-swap; updated
        // when the type system switched to Inter + Fraunces.
        ctx.font = `${isPortrait ? 26 : 20}px Fraunces, Georgia, "Times New Roman", serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const glaze = (state.glaze && GLAZES[state.glaze])
            ? GLAZES[state.glaze].name : "Bare clay";
        ctx.fillText(`SLIP STUDIO · ${glaze.toUpperCase()}`, W / 2, stripY + stripH / 2);
    }

    // 3) Pot render — square pot fills full width, vertically anchored.
    const potY = isPortrait ? Math.floor((H - W) * 0.42) : 0;
    ctx.drawImage(potCanvas, 0, potY, W, W);

    return target;
}

let photoPotCache = null;
let photoBgCache = null;

async function openPhotoModal() {
    photoPotCache = captureScenePot(1024);
    photoBgCache = await loadBackdropImage();
    syncPhotoChips();
    renderPhotoPreview();
    document.getElementById("photoModal").hidden = false;
}

function closePhotoModal() {
    document.getElementById("photoModal").hidden = true;
    photoPotCache = null;
    photoBgCache = null;
}

function renderPhotoPreview() {
    const preview = document.getElementById("photoPreview");
    if (!preview || !photoPotCache) return;
    composeStyledPhoto(photoPotCache, photoBgCache, state.photoStyle, state.photoAspect, preview);
}

function setPhotoStyle(name) {
    if (!["studio", "sunlit", "museum"].includes(name)) return;
    state.photoStyle = name;
    syncPhotoChips();
    renderPhotoPreview();
}

function setPhotoAspect(name) {
    state.photoAspect = ["portrait", "feed", "square"].includes(name) ? name : "square";
    syncPhotoChips();
    renderPhotoPreview();
}

// A descriptive, brand-forward filename for the exported photo so every
// shared image reads like a considered artifact: e.g.
// slip-studio-vase-cobalt-2026-07-02.png. Kebab-cased ASCII only.
function kebabCase(s) {
    return String(s).toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "x";
}
function photoFilename() {
    const shape = state.isLid ? "lid" : (state.shape || "pot");
    const glazeName = (state.glaze && GLAZES[state.glaze]) ? GLAZES[state.glaze].name : "bare-clay";
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const date = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    return `slip-studio-${kebabCase(shape)}-${kebabCase(glazeName)}-${date}.png`;
}

function syncPhotoChips() {
    document.querySelectorAll("#photoStyles .photo-chip").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.style === state.photoStyle);
    });
    document.querySelectorAll("#photoAspects .photo-chip").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.aspect === state.photoAspect);
    });
}

async function finalizePhoto() {
    if (!photoPotCache) return;
    const out = document.createElement("canvas");
    composeStyledPhoto(photoPotCache, photoBgCache, state.photoStyle, state.photoAspect, out);
    const filename = photoFilename();
    const blob = await new Promise((res) => out.toBlob(res, "image/png"));
    try {
        if (blob && navigator.canShare) {
            const file = new File([blob], filename, { type: "image/png" });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: "Slip Studio pot" });
                flashPhotoSave();
                return;
            }
        }
    } catch (_) { /* user cancelled or share blocked — fall through to download */ }
    const url = blob ? URL.createObjectURL(blob) : out.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    try { a.remove(); } catch (_) {}
    if (blob) setTimeout(() => URL.revokeObjectURL(url), 5000);
    flashPhotoSave();
}

function flashPhotoSave() {
    const b = document.getElementById("photoSave");
    if (!b) return;
    const prev = b.textContent;
    b.textContent = "Saved ✓";
    setTimeout(() => { b.textContent = prev; }, 1300);
}

// A gentle default name so the shelf view has content from the moment a
// piece is saved (e.g. "Vase in Cobalt", "Bare-clay bowl", "Lid in Sand").
// The user can still tap the title in the gallery to rename it.
function defaultPotTitle() {
    const base = state.isLid ? "Lid" : (SHAPES[state.shape]?.label || "Pot");
    const glazeName = (state.glaze && GLAZES[state.glaze]) ? GLAZES[state.glaze].name : null;
    return glazeName ? `${base} in ${glazeName}` : `Bare-clay ${base.toLowerCase()}`;
}

async function savePot() {
    // If a partner is paused in memory, generate a shared set id so
    // both pieces save together. The active piece is written first
    // using the live canvases; the partner is restored briefly so its
    // thumb captures the right look, then the active piece is put back.
    const partner = state.savedPot || state.savedLid;
    let setId = state.pendingSetId || null;
    if (partner && !setId) {
        setId = "set-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    }
    // For sets, capture the assembled lid-on-pot thumb FIRST while
    // both meshes are still in their assembly positions. Both saved
    // entries share this thumb so the gallery shows the set together.
    const assemblyThumb = partner ? captureAssemblyThumb() : null;
    const entry = {
        id: Date.now().toString(36),
        ts: Date.now(),
        profile: Array.from(profile, (x) => +x.toFixed(4)),
        glaze: state.glaze,
        glazeGradient: state.glazeGradient,
        deco: state.decoCanvas.toDataURL("image/png"),
        bump: state.bumpCanvas.toDataURL("image/png"),
        sgraffito: state.sgraffitoCanvas.toDataURL("image/png"),
        thumb: captureThumb(),
        setId,
        title: defaultPotTitle(), // pre-named; user can rename in the gallery
        isLid: state.isLid,
        handle: !state.isLid && state.handle.on, // lids never carry a handle in v1
        handleBulge:  !state.isLid && state.handle.on ? state.handle.bulgeOffset  : 0,
        handleHeight: !state.isLid && state.handle.on ? state.handle.heightOffset : 0,
        handleThickness: !state.isLid && state.handle.on ? state.handle.thickness : DEFAULT_HANDLE_THICKNESS,
        heightScale:  state.heightScale,
        assemblyThumb,
    };
    try {
        await dbPut(entry);
        flashSaved();
        state.pendingSetId = null;
        state.dirty = false; // the gallery now reflects everything in view

        if (partner) {
            // Swap in the partner, save it under the same set id, then
            // swap back to the original so the view doesn't lurch.
            const active = capturePieceState();
            restorePieceState(partner);
            // Flush the partner's profile to the pot's GPU buffers
            // before captureThumb renders — otherwise the thumb keeps
            // the active piece's silhouette under the partner's glaze.
            writeProfileToGeometry(state.pot.geometry);
            profileDirty = false;
            // Force material to settle into the fired look before thumb.
            tickMaterial(10);
            const partnerEntry = {
                id: (Date.now() + 1).toString(36),
                ts: Date.now() + 1,
                profile: Array.from(profile, (x) => +x.toFixed(4)),
                glaze: state.glaze,
                deco: state.decoCanvas.toDataURL("image/png"),
                bump: state.bumpCanvas.toDataURL("image/png"),
                sgraffito: state.sgraffitoCanvas.toDataURL("image/png"),
                thumb: captureThumb(),
                setId,
                title: defaultPotTitle(),
                isLid: state.isLid,
                handle: !state.isLid && state.handle.on,
                handleBulge:  !state.isLid && state.handle.on ? state.handle.bulgeOffset  : 0,
                handleHeight: !state.isLid && state.handle.on ? state.handle.heightOffset : 0,
                assemblyThumb, // same shared shot
            };
            await dbPut(partnerEntry);
            restorePieceState(active);
            tickMaterial(10);
            state.savedPot = null;
            state.savedLid = null;
        }
    } catch (e) {
        console.warn("save failed", e);
    }
}

// "Make a lid" — save the current fired pot under a fresh set id, then
// reset to a new lid-shaped wet pot that will carry the same set id on
// its eventual save. Saved pots that share a set id render as a pair
// in the gallery.
// Snapshot the live piece's full editable state (profile, glaze, deco
// canvas, bump canvas, lid flag, current phase) into a plain object
// so we can swap it in/out of memory while the user shapes a partner.
function capturePieceState() {
    const decoCopy = document.createElement("canvas");
    decoCopy.width = DECO_W;
    decoCopy.height = DECO_H;
    decoCopy.getContext("2d").drawImage(state.decoCanvas, 0, 0);
    const bumpCopy = document.createElement("canvas");
    bumpCopy.width = BUMP_W;
    bumpCopy.height = BUMP_H;
    bumpCopy.getContext("2d").drawImage(state.bumpCanvas, 0, 0);
    const sgraffitoCopy = document.createElement("canvas");
    sgraffitoCopy.width = DECO_W;
    sgraffitoCopy.height = DECO_H;
    sgraffitoCopy.getContext("2d").drawImage(state.sgraffitoCanvas, 0, 0);
    return {
        profile: Float32Array.from(profile),
        glaze: state.glaze,
        glazeGradient: state.glazeGradient,
        decoCanvas: decoCopy,
        bumpCanvas: bumpCopy,
        sgraffitoCanvas: sgraffitoCopy,
        isLid: state.isLid,
        clayState: state.clayState,
        heightScale: state.heightScale,
    };
}

// Inverse of capturePieceState — write a paused piece back into the
// live editable state. Phase is set last so the toolbar refreshes
// against the fully-restored state.
function restorePieceState(saved) {
    for (let i = 0; i < saved.profile.length; i++) profile[i] = saved.profile[i];
    profileDirty = true;
    state.glaze = saved.glaze;
    state.glazeGradient = saved.glazeGradient || null;
    state.isLid = saved.isLid;
    // Rebuild the lid's sculpt cap from the restored silhouette —
    // capturePieceState doesn't carry lidMaxY, and without this the
    // cap check at sculptToward is a no-op and the lid can regrow
    // above its collapsed rings.
    state.lidMaxY = state.isLid ? lidCapFromProfile(profile) : null;
    state.decoCtx.clearRect(0, 0, DECO_W, DECO_H);
    state.decoCtx.drawImage(saved.decoCanvas, 0, 0);
    state.decoTex.needsUpdate = true;
    state.bumpCtx.clearRect(0, 0, BUMP_W, BUMP_H);
    state.bumpCtx.drawImage(saved.bumpCanvas, 0, 0);
    state.bumpTex.needsUpdate = true;
    // Sgraffito: older captured states may pre-date this field — guard
    // so a captured-pre-v2.2 partner doesn't blow up the swap path.
    state.sgraffitoCtx.clearRect(0, 0, DECO_W, DECO_H);
    if (saved.sgraffitoCanvas) state.sgraffitoCtx.drawImage(saved.sgraffitoCanvas, 0, 0);
    state.sgraffitoTex.needsUpdate = true;
    // Restore the snapshot's vertical stretch — older snapshots that
    // pre-date heightScale default to 1.0 (the pre-stretch original).
    setHeightScale(saved.heightScale != null ? saved.heightScale : 1.0);
    setPhase(saved.clayState);
    updateGlazeBar();
    // Handle visibility tracks isLid which may have flipped during
    // restore (e.g., swapping pot ↔ lid). The mesh geometry doesn't
    // need rebuilding here — it already reflects the live profile if
    // visible, and we don't render it on lids.
    updateHandleVisibility();
    if (state.handle.on && !state.isLid) rebuildHandleGeometry();
}

// --- Partner mesh (used for the fired-set assembly view) -------
// A second pot mesh that shares the geometry topology of state.pot
// but has its own deco / bump canvases + material. Built lazily on
// first set-fire; reused thereafter.
function buildPartnerMesh() {
    if (state.partnerMesh) return state.partnerMesh;

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
    geo.setAttribute("normal",   new THREE.BufferAttribute(normals,   3));
    geo.setAttribute("uv",       new THREE.BufferAttribute(uvs,       2));
    geo.setIndex(indices);

    // Partner's own deco canvas + texture (syncPartnerMesh copies the
    // saved piece's deco/bump into these on each show).
    const pdc = document.createElement("canvas");
    pdc.width  = DECO_W;
    pdc.height = DECO_H;
    state.partnerDecoCanvas = pdc;
    state.partnerDecoCtx    = pdc.getContext("2d");
    const pdt = new THREE.CanvasTexture(pdc);
    pdt.colorSpace = THREE.SRGBColorSpace;
    pdt.wrapS = THREE.RepeatWrapping;
    pdt.wrapT = THREE.ClampToEdgeWrapping;
    pdt.anisotropy = 4;
    state.partnerDecoTex = pdt;

    // Partner's own bump canvas + texture.
    const pbc = document.createElement("canvas");
    pbc.width  = BUMP_W;
    pbc.height = BUMP_H;
    state.partnerBumpCanvas = pbc;
    state.partnerBumpCtx    = pbc.getContext("2d");
    const pbt = new THREE.CanvasTexture(pbc);
    pbt.colorSpace = THREE.NoColorSpace;
    pbt.wrapS = THREE.RepeatWrapping;
    pbt.wrapT = THREE.ClampToEdgeWrapping;
    pbt.anisotropy = 4;
    state.partnerBumpTex = pbt;

    // Partner's own sgraffito mask canvas + texture (mirrors the
    // active mesh's setup so lid + pot sets keep their carving).
    const psc = document.createElement("canvas");
    psc.width  = DECO_W;
    psc.height = DECO_H;
    state.partnerSgraffitoCanvas = psc;
    state.partnerSgraffitoCtx    = psc.getContext("2d");
    const pst = new THREE.CanvasTexture(psc);
    pst.colorSpace = THREE.NoColorSpace;
    pst.wrapS = THREE.RepeatWrapping;
    pst.wrapT = THREE.ClampToEdgeWrapping;
    pst.anisotropy = 4;
    state.partnerSgraffitoTex = pst;

    const mat = new THREE.MeshPhysicalMaterial({
        color: CLAY_STATES.fired.color,
        roughness: CLAY_STATES.fired.roughness,
        metalness: 0.0,
        clearcoat: CLAY_STATES.fired.clearcoat,
        clearcoatRoughness: CLAY_STATES.fired.clearcoatRoughness,
        envMapIntensity: CLAY_STATES.fired.envMapIntensity,
        bumpMap: pbt,
        bumpScale: CLAY_STATES.fired.bump,
        side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.decoMap        = { value: pdt };
        shader.uniforms.sgraffitoMap   = { value: pst };
        shader.uniforms.uClayColor     = { value: state.partnerClayBaseColor };
        shader.uniforms.uGradientColor = { value: state.partnerGradientColor };
        shader.uniforms.uGradientMix   = { value: state.partnerGradientMix };
        mat.userData.shaderUniforms = shader.uniforms;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "varying vec2 vDecoUv;\n#include <common>")
            .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vDecoUv = uv;");
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                "uniform sampler2D decoMap;\nuniform sampler2D sgraffitoMap;\nuniform vec3 uClayColor;\nuniform vec3 uGradientColor;\nuniform float uGradientMix;\nvarying vec2 vDecoUv;\n#include <common>",
            )
            .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
                 float _gradT = smoothstep(0.15, 0.85, 1.0 - vDecoUv.y) * uGradientMix;
                 diffuseColor.rgb = mix(diffuseColor.rgb, uGradientColor, _gradT);
                 float _scratch = texture2D( sgraffitoMap, vDecoUv ).a;
                 vec4 _deco = texture2D( decoMap, vDecoUv );
                 diffuseColor.rgb = mix( diffuseColor.rgb, pow( _deco.rgb, vec3( 2.2 ) ), _deco.a * (1.0 - _scratch) );
                 vec3 _carveColor = uClayColor * 0.78;
                 diffuseColor.rgb = mix( diffuseColor.rgb, _carveColor, _scratch );`,
            );
    };
    mat.customProgramCacheKey = () => "clay-gradient-sgraffito-v3-partner";
    state.partnerMaterial = mat;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    state.turntable.add(mesh);
    state.partnerMesh = mesh;
    return mesh;
}

// Populate the partner mesh from a saved piece (profile + deco +
// bump + glaze). The material is set to the saved piece's CURRENT
// look (so a leather-stage piece enters the kiln as raw glaze), and
// state.partnerTarget is set to the fired look so tickPartnerMaterial
// can tween the partner alongside the active piece during firing.
function syncPartnerMesh(saved) {
    if (!state.partnerMesh) buildPartnerMesh();
    writeProfileArrayToGeometry(state.partnerMesh.geometry, saved.profile);
    state.partnerDecoCtx.clearRect(0, 0, DECO_W, DECO_H);
    state.partnerDecoCtx.drawImage(saved.decoCanvas, 0, 0);
    state.partnerDecoTex.needsUpdate = true;
    state.partnerBumpCtx.clearRect(0, 0, BUMP_W, BUMP_H);
    state.partnerBumpCtx.drawImage(saved.bumpCanvas, 0, 0);
    state.partnerBumpTex.needsUpdate = true;
    // Partner sgraffito mask. Older captures might not carry it.
    state.partnerSgraffitoCtx.clearRect(0, 0, DECO_W, DECO_H);
    if (saved.sgraffitoCanvas) state.partnerSgraffitoCtx.drawImage(saved.sgraffitoCanvas, 0, 0);
    state.partnerSgraffitoTex.needsUpdate = true;
    state.partnerClayBaseColor.setHex(CLAY_STATES[saved.clayState || "fired"].color);
    const initial = lookForPiece(saved);
    const target  = saved.glaze ? GLAZES[saved.glaze].fired : CLAY_STATES.fired;
    const mat = state.partnerMaterial;
    mat.color.setHex(initial.color);
    mat.roughness          = initial.roughness;
    mat.clearcoat          = initial.clearcoat;
    mat.clearcoatRoughness = initial.clearcoatRoughness;
    mat.envMapIntensity    = initial.envMapIntensity;
    mat.bumpScale          = initial.bump;
    mat.metalness          = initial.metalness != null ? initial.metalness : 0;
    state.partnerTarget = target;
    // Partner gradient: snap colour + mix to the saved piece's
    // secondary glaze (or to the fired colour with mix=0 if there
    // isn't one). Wet captures default to mix=0; leather/fired with
    // a gradient render with mix=1.
    const pgId = saved.glazeGradient || null;
    if (pgId && GLAZES[pgId]) {
        const pg = (saved.clayState === "fired") ? GLAZES[pgId].fired : GLAZES[pgId].raw;
        state.partnerGradientColor.setHex(pg.color);
        state.partnerGradientMix = 1;
    } else {
        state.partnerGradientMix = 0;
    }
    const u = mat.userData.shaderUniforms;
    if (u && u.uGradientMix) u.uGradientMix.value = state.partnerGradientMix;
}

// Same shape as currentLook() but reads from a snapshot rather than
// the live state. Used for the partner mesh which lives in memory.
function lookForPiece(piece) {
    const cs = piece.clayState;
    if (cs === "fired")   return piece.glaze ? GLAZES[piece.glaze].fired : CLAY_STATES.fired;
    if (cs === "leather") return piece.glaze ? GLAZES[piece.glaze].raw   : CLAY_STATES.leather;
    return CLAY_STATES.wet;
}

// Tween the partner material toward state.partnerTarget. Runs from
// tick() once per frame using the same rate constants as
// tickMaterial — slower during firing so the glaze melts visibly.
const partnerTweenColor = new THREE.Color();
const _partnerScratchTarget  = new THREE.Color();
const _partnerGradientTarget = new THREE.Color();
function tickPartnerMaterial(dt) {
    const m = state.partnerMaterial;
    const t = state.partnerTarget;
    if (!m || !t || !state.partnerMesh || !state.partnerMesh.visible) return;
    const rate = state.firing ? 0.8 : 5;
    const k = 1 - Math.exp(-dt * rate);
    partnerTweenColor.setHex(t.color);
    m.color.lerp(partnerTweenColor, k);
    m.roughness          += (t.roughness          - m.roughness)          * k;
    m.clearcoat          += (t.clearcoat          - m.clearcoat)          * k;
    m.clearcoatRoughness += (t.clearcoatRoughness - m.clearcoatRoughness) * k;
    m.envMapIntensity    += (t.envMapIntensity    - m.envMapIntensity)    * k;
    m.bumpScale          += (t.bump               - m.bumpScale)          * k;
    m.metalness          += ((t.metalness != null ? t.metalness : 0) - m.metalness) * k;
    // Partner sgraffito base colour tracks the saved partner's CURRENT
    // clay state (set in syncPartnerMesh) and the live clay state at
    // firing time. We read the active state during firing so both
    // pieces transition together; otherwise the partner snapshot's
    // value is steady.
    const psCs = state.firing ? state.clayState : (state.savedPot?.clayState || state.savedLid?.clayState || "fired");
    _partnerScratchTarget.setHex(CLAY_STATES[psCs].color);
    state.partnerClayBaseColor.lerp(_partnerScratchTarget, k);
    // Partner gradient (secondary glaze) tween — mirror tickMaterial.
    // syncPartnerMesh snaps the colour at first show; this melts it
    // raw → fired alongside the primary during the kiln animation, so
    // a set with a gradient on the partner doesn't freeze chalky.
    const partnerSaved = state.isLid ? state.savedPot : state.savedLid;
    const pgId = partnerSaved && partnerSaved.glazeGradient;
    let pgLook = null;
    if (pgId && GLAZES[pgId]) {
        const targetCs = state.firing ? "fired" : (partnerSaved.clayState || "fired");
        pgLook = (targetCs === "fired") ? GLAZES[pgId].fired
               : (targetCs === "leather") ? GLAZES[pgId].raw
               : null;
    }
    if (pgLook) {
        _partnerGradientTarget.setHex(pgLook.color);
        state.partnerGradientColor.lerp(_partnerGradientTarget, k);
    }
    const wantPMix = pgLook ? 1 : 0;
    state.partnerGradientMix += (wantPMix - state.partnerGradientMix) * k;
    const pu = state.partnerMaterial.userData.shaderUniforms;
    if (pu && pu.uGradientMix) pu.uGradientMix.value = state.partnerGradientMix;
}

// Show both pieces in their natural assembled positions. The pot
// always sits on the wheel (y=0); the lid always sits on top of the
// pot (y=TOP). Whichever piece is the live editable one gets moved
// to the right y; the other is rendered from the saved snapshot.
function showAssemblyView() {
    const partnerSaved = state.isLid ? state.savedPot : state.savedLid;
    if (!partnerSaved) return;
    syncPartnerMesh(partnerSaved);
    const partnerHeight = partnerSaved.heightScale != null ? partnerSaved.heightScale : 1.0;
    state.partnerMesh.scale.y = partnerHeight;
    if (state.isLid) {
        // Active is the LID → goes on top. Partner is the pot at y=0.
        // The lid lives inside potGroup, so shift the whole group up
        // to where the partner pot's (height-scaled) top sits.
        state.potGroup.position.y = TOP * partnerHeight;
        state.pot.position.y = 0;
        state.partnerMesh.position.y = 0;
    } else {
        // Active is the POT → stays on the wheel. Partner is the lid
        // on top, positioned at the live pot's height-scaled top.
        state.potGroup.position.y = 0;
        state.pot.position.y = 0;
        state.partnerMesh.position.y = TOP * state.heightScale;
    }
    state.partnerMesh.visible = true;
    state.assemblyShown = true;
    applyCamera();
}

function hideAssemblyView() {
    if (state.partnerMesh) {
        state.partnerMesh.visible = false;
        state.partnerMesh.scale.y = 1;
    }
    state.potGroup.position.y = 0;
    state.pot.position.y = 0;
    state.assemblyShown = false;
    applyCamera();
}

// "+ Make lid" at the decorate stage. Pauses the pot in memory (NOT
// to the gallery) and seeds a fresh wet lid whose base matches this
// pot's rim. The two pieces share a set id at save time.
function makeLidPartner() {
    // Tandem shaping: allow lid creation from either wet or leather.
    // Wet → both pieces are being shaped at the same time, advance
    // and fire move them together. Leather → the original "decorate-
    // stage lid" flow, where the pot stays frozen at leather while
    // the lid is freshly thrown.
    if (state.clayState !== "leather" && state.clayState !== "wet") return;
    if (state.isLid) return;          // already a lid
    if (state.savedPot) return;       // a partner already exists
    const rimR = profile[ROWS];
    state.savedPot = capturePieceState();
    state.isLid = true;
    seedLidForRim(rimR, state.lidStyle);
    profileDirty = true;
    state.glaze = null;
    clearDeco();
    resetBumpLayer();
    setPhase(INITIAL_STATE);
    state.dirty = true;
    updateHandleVisibility(); // hide handle while shaping the lid
    updateGlazeBar();
    updateLidStylePicker();
}

// Mid-shaping style swap. Reseeds the lid using the source pot's rim
// (or the lid's own current rim if no source — fallback for testing).
function setLidStyle(style) {
    if (!LID_STYLES[style]) return;
    state.lidStyle = style;
    if (state.isLid && state.clayState === "wet") {
        const rimR = (state.savedPot && state.savedPot.profile) ? state.savedPot.profile[ROWS] : profile[ROWS];
        seedLidForRim(rimR, style);
        profileDirty = true;
        clearDeco();
        resetBumpLayer();
        state.dirty = true;
    }
    updateLidStylePicker();
}

function buildLidStylePicker() {
    const wrap = document.getElementById("lidStylePicker");
    if (!wrap) return;
    wrap.innerHTML = "";
    LID_STYLE_IDS.forEach((id) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lid-style-btn";
        b.dataset.style = id;
        b.textContent = id[0].toUpperCase() + id.slice(1);
        b.addEventListener("click", () => setLidStyle(id));
        wrap.appendChild(b);
    });
    updateLidStylePicker();
}

function updateLidStylePicker() {
    const wrap = document.getElementById("lidStylePicker");
    if (!wrap) return;
    wrap.querySelectorAll(".lid-style-btn").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.style === state.lidStyle);
    });
}

// Toggle which piece is live for editing/viewing. The currently-live
// piece is captured into the OTHER slot; the paused piece is restored
// into the live state. Available whenever exactly one piece is paused.
// Refit the active lid's silhouette to the partner pot's CURRENT rim
// without throwing away the user's sculpt work. Every row's radius
// scales by (new pot rim / current lid base), so the proportions of
// the lid (knob shape, neck width, dome curvature) are preserved
// while the base lands exactly on the pot's rim. Only meaningful
// when the user has been sculpting the pot AFTER seeding the lid —
// otherwise the rims already match and this is a no-op.
function matchLidRim() {
    if (!state.isLid || !state.savedPot) return;
    if (state.clayState !== "wet") return;
    // The pot's rim lives at profile[ROWS] (rim row, top of the pot).
    // The lid's base lives at profile[1] (row 0 is the axis sentinel
    // always pinned to 0; row 1 is the first real radius of the lid
    // and corresponds to the "sits on pot" contact ring). profile[ROWS]
    // for the lid is the APEX (= 0), not the base.
    const newRim = state.savedPot.profile ? state.savedPot.profile[ROWS] : 0;
    const oldBase = profile[1];
    if (newRim <= MIN_R || oldBase <= MIN_R) return;
    if (Math.abs(newRim - oldBase) < 1e-4) return;
    const ratio = newRim / oldBase;
    for (let r = 0; r <= ROWS; r++) profile[r] *= ratio;
    clampProfile();
    state.lidMaxY = lidCapFromProfile(profile);
    profileDirty = true;
    state.dirty = true;
}

function swapActivePiece() {
    const wasLid = state.isLid;
    const other = wasLid ? state.savedPot : state.savedLid;
    if (!other) return;
    const current = capturePieceState();
    restorePieceState(other);
    if (wasLid) {
        state.savedLid = current;
        state.savedPot = null;
    } else {
        state.savedPot = current;
        state.savedLid = null;
    }
}

function flashSaved() {
    // The save button is icon-only — swap its glyph to a checkmark and
    // glow it accent for a beat (a wax seal on the piece), then restore.
    const b = document.getElementById("saveBtn");
    if (b) {
        const use = b.querySelector("use");
        if (use) use.setAttribute("href", "#icon-check");
        b.classList.add("is-saved");
        setTimeout(() => {
            if (use) use.setAttribute("href", "#icon-save");
            b.classList.remove("is-saved");
        }, 1300);
    }
    pulseSaveFlash();   // soft flashbulb bloom over the pot
    haptic(15);         // tactile confirm on Android
}

// One-shot white bloom over the pot canvas on save. Retrigger-safe:
// remove the class + force a reflow so a rapid re-save replays it.
function pulseSaveFlash() {
    const el = document.getElementById("saveFlash");
    if (!el) return;
    el.classList.remove("is-pulsing");
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add("is-pulsing");
}

// Restore a saved pot into the scene as a finished (fired) piece.
async function loadPot(entry) {
    // Reset set state first; populated below if the loaded entry pairs.
    state.savedPot = null;
    state.savedLid = null;
    state.dirty = false; // loaded piece reflects the gallery snapshot

    for (let i = 0; i < profile.length; i++) profile[i] = entry.profile?.[i] ?? 0;
    profileDirty = true;
    state.glaze = entry.glaze || null;
    state.glazeGradient = entry.glazeGradient || null;
    // Per-piece vertical stretch (older entries default to 1.0).
    setHeightScale(entry.heightScale != null ? entry.heightScale : 1.0);
    // Auto-switch glaze pack if the loaded pot uses a glaze that's
    // not in the currently-displayed pack — otherwise the picker
    // wouldn't show the active swatch and the user would have to
    // hunt for which pack it lives in. Primary takes precedence
    // over gradient if they're in different packs.
    const targetPack = packContaining(state.glaze) || packContaining(state.glazeGradient);
    if (targetPack && targetPack !== state.glazePack) setGlazePack(targetPack);
    state.isLid = lookupIsLid(entry);
    state.lidMaxY = state.isLid ? lidCapFromProfile(profile) : null;
    // Old gallery saves predate the apex-smoothing pass — re-apply so
    // loaded lids don't render with the sharp pinprick they were
    // saved with.
    smoothLidApex();
    await loadImageOntoCanvas(entry.deco, state.decoCtx, DECO_W, DECO_H, clearDeco);
    state.decoTex.needsUpdate = true;
    await loadImageOntoCanvas(entry.bump, state.bumpCtx, BUMP_W, BUMP_H, resetBumpLayer);
    state.bumpTex.needsUpdate = true;
    // Sgraffito mask. Older entries don't carry it; treat as empty.
    await loadImageOntoCanvas(entry.sgraffito, state.sgraffitoCtx, DECO_W, DECO_H, clearSgraffito);
    state.sgraffitoTex.needsUpdate = true;
    // Handle: only meaningful for pot entries. If loading the lid side
    // of a set, the pot's handle stays in the partner's saved data but
    // isn't rendered in the v1 assembled view (state.handle attaches
    // to state.pot only).
    state.handle.on = !state.isLid && !!entry.handle;
    state.handle.bulgeOffset  = state.handle.on ? (entry.handleBulge  || 0) : 0;
    state.handle.heightOffset = state.handle.on ? (entry.handleHeight || 0) : 0;
    state.handle.thickness    = (state.handle.on && HANDLE_THICKNESSES[entry.handleThickness])
        ? entry.handleThickness : DEFAULT_HANDLE_THICKNESS;
    if (state.handle.on) {
        ensureHandleMesh();
        rebuildHandleGeometry();
    }
    updateHandleVisibility();

    // If this entry is part of a set, also load the partner so the
    // assembly view auto-triggers at setPhase("fired") below.
    if (entry.setId) {
        try {
            const all = await dbAll();
            const partnerEntry = all.find((p) => p.setId === entry.setId && p.id !== entry.id);
            if (partnerEntry) {
                const partnerSaved = await loadAsCapturedState(partnerEntry);
                if (state.isLid) state.savedPot = partnerSaved;
                else            state.savedLid = partnerSaved;
            }
        } catch (_) { /* gallery read failed — fall back to solo view */ }
    }

    setPhase("fired");
    updateGlazeBar();
    // Force an immediate frame so the piece shows right away.
    writeProfileToGeometry(state.pot.geometry);
    profileDirty = false;
    tickMaterial(10); // snap material to the fired look
    state.renderer.render(state.scene, state.camera);
}

// Read isLid off a saved entry; fall back to a profile-shape heuristic
// for legacy entries that didn't persist the flag (lids have a narrow
// top "knob" radius while pots have a wider rim).
function lookupIsLid(entry) {
    if (entry && typeof entry.isLid === "boolean") return entry.isLid;
    const top = entry?.profile?.[ROWS];
    return typeof top === "number" && top < 0.12;
}

// Tiny helper to draw a data-URL onto an existing 2D context.
async function loadImageOntoCanvas(src, ctx, w, h, onFail) {
    return new Promise((res) => {
        if (!src) { if (onFail) onFail(); res(); return; }
        const img = new Image();
        img.onload = () => { ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); res(); };
        img.onerror = () => { if (onFail) onFail(); res(); };
        img.src = src;
    });
}

// Convert a saved gallery entry into a capturePieceState-shape object
// so it can be slotted into state.savedPot / state.savedLid and feed
// the assembly view + swap logic.
async function loadAsCapturedState(entry) {
    const decoCanvas = document.createElement("canvas");
    decoCanvas.width  = DECO_W;
    decoCanvas.height = DECO_H;
    await loadImageOntoCanvas(entry.deco, decoCanvas.getContext("2d"), DECO_W, DECO_H);
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width  = BUMP_W;
    bumpCanvas.height = BUMP_H;
    const bctx = bumpCanvas.getContext("2d");
    // Default to the neutral grey baseline if the entry has no bump.
    bctx.fillStyle = "rgb(128,128,128)";
    bctx.fillRect(0, 0, BUMP_W, BUMP_H);
    await loadImageOntoCanvas(entry.bump, bctx, BUMP_W, BUMP_H);
    const sgraffitoCanvas = document.createElement("canvas");
    sgraffitoCanvas.width  = DECO_W;
    sgraffitoCanvas.height = DECO_H;
    if (entry.sgraffito) {
        await loadImageOntoCanvas(entry.sgraffito, sgraffitoCanvas.getContext("2d"), DECO_W, DECO_H);
    }
    return {
        profile: Float32Array.from(entry.profile || []),
        glaze: entry.glaze || null,
        glazeGradient: entry.glazeGradient || null,
        decoCanvas,
        bumpCanvas,
        sgraffitoCanvas,
        isLid: lookupIsLid(entry),
        clayState: "fired",
    };
}

async function openGallery() {
    const grid = document.getElementById("galleryGrid");
    const empty = document.getElementById("galleryEmpty");
    if (!grid) return;
    grid.innerHTML = "";
    grid.classList.toggle("shelf",   state.galleryView === "shelf");
    grid.classList.toggle("compact", state.galleryView !== "shelf");
    let pots = [];
    try { pots = await dbAll(); } catch (_) {}
    pots.sort((a, b) => b.ts - a.ts);
    if (empty) empty.hidden = pots.length > 0;

    // Group set-mates together; each setId yields a single paired tile.
    const seen = new Set();
    pots.forEach((p) => {
        if (p.setId) {
            if (seen.has(p.setId)) return;
            seen.add(p.setId);
            const members = pots.filter((q) => q.setId === p.setId);
            renderGalleryTile(grid, members);
        } else {
            renderGalleryTile(grid, [p]);
        }
    });
    syncGalleryViewToggle();
    document.getElementById("gallery").hidden = false;
}

function renderGalleryTile(grid, members) {
    const isShelf = state.galleryView === "shelf";
    const isSet = members.length > 1;
    // For sets where we captured an assembly shot at save time, show
    // that single composite thumb instead of two stacked halves.
    const assemblyThumb = isSet && members[0].assemblyThumb;
    const item = document.createElement("div");
    item.className = "gallery-item" + (isSet ? " gallery-set" : "") + (isShelf ? " is-shelf" : "")
                   + (assemblyThumb ? " has-assembly" : "");

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "pot-thumb-wrap";
    if (assemblyThumb) {
        // Single combined image — clicking it loads either piece (the
        // assembly view restores both anyway).
        const half = document.createElement("div");
        half.className = "pot-thumb";
        const img = document.createElement("img");
        img.src = assemblyThumb;
        img.alt = (members[0].title || "Saved set");
        img.loading = "lazy";
        img.addEventListener("click", async () => { await loadPot(members[0]); closeGallery(); });
        half.appendChild(img);
        thumbWrap.appendChild(half);
    } else {
        // Solo pot, or a legacy set without an assembly thumb.
        members.forEach((p) => {
            const half = document.createElement("div");
            half.className = isSet ? "gallery-half" : "pot-thumb";
            const img = document.createElement("img");
            img.src = p.thumb;
            img.alt = p.title || "Saved pot";
            img.loading = "lazy";
            img.addEventListener("click", async () => { await loadPot(p); closeGallery(); });
            half.appendChild(img);
            thumbWrap.appendChild(half);
        });
    }
    item.appendChild(thumbWrap);

    // Shelf view: a 1px inset hairline tinted to the pot's fired glaze
    // colour, so the shelf reads as a curated portfolio rather than a
    // plain thumbnail grid. Rendered as an overlay so it sits above the
    // thumbnail image (an inset box-shadow would hide behind it).
    if (isShelf) {
        const gid = members[0].glaze;
        if (gid && GLAZES[gid]) {
            const ring = document.createElement("div");
            ring.className = "thumb-glaze-ring";
            ring.style.boxShadow = `inset 0 0 0 1px ${hexToRgba(GLAZES[gid].fired.color, 0.5)}`;
            thumbWrap.appendChild(ring);
        }
    }

    // Metadata column (shelf view only): title (tap to rename) + glaze
    // name + saved-on date. Title acts as the portfolio caption.
    if (isShelf) {
        const meta = document.createElement("div");
        meta.className = "pot-meta";
        const titleBtn = document.createElement("button");
        titleBtn.type = "button";
        const hasTitle = !!(members[0].title && members[0].title.length);
        titleBtn.className = "pot-title" + (hasTitle ? "" : " is-empty");
        titleBtn.textContent = hasTitle ? members[0].title : "Tap to name";
        titleBtn.title = "Rename this pot";
        titleBtn.addEventListener("click", (e) => { e.stopPropagation(); renameTile(members[0]); });
        meta.appendChild(titleBtn);
        const sub = document.createElement("div");
        sub.className = "pot-sub";
        const dateStr = formatPotDate(members[0].ts);
        const glaze = glazeNameFor(members[0]);
        sub.textContent = isSet ? `Lid set · ${glaze} · ${dateStr}` : `${glaze} · ${dateStr}`;
        meta.appendChild(sub);
        item.appendChild(meta);
    }

    const del = document.createElement("button");
    del.className = "gallery-del";
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", isSet ? "Delete set" : "Delete pot");
    del.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(
            isSet ? "Delete this set? This can't be undone."
                  : "Delete this pot? This can't be undone.",
            { confirmLabel: "Delete", cancelLabel: "Keep" }
        );
        if (!ok) return;
        await Promise.all(members.map((m) => dbDelete(m.id)));
        openGallery();
    });
    item.appendChild(del);
    grid.appendChild(item);
}

function renameTile(p) {
    const cur = p.title || "";
    // prompt() is enough for a casual name-edit; the title is stored
    // verbatim (no markup) and rendered with textContent.
    const next = window.prompt("Name this pot", cur);
    if (next == null) return;
    p.title = next.trim() ? next.trim().slice(0, 60) : null;
    dbPut(p).then(() => openGallery()).catch(() => {});
}

function glazeNameFor(p) {
    if (!p.glaze || !GLAZES[p.glaze]) return "Bare clay";
    return GLAZES[p.glaze].name;
}

// 0xRRGGBB integer → "rgba(r, g, b, a)" string.
function hexToRgba(hex, a) {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function formatPotDate(ts) {
    const d = new Date(ts);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
}

function setGalleryView(name) {
    state.galleryView = name === "compact" ? "compact" : "shelf";
    try { localStorage.setItem("slip-gallery-view", state.galleryView); } catch (_) {}
    syncGalleryViewToggle();
    openGallery();
}

function syncGalleryViewToggle() {
    const btn = document.getElementById("galleryViewToggle");
    if (!btn) return;
    btn.textContent = state.galleryView === "shelf" ? "Grid" : "Shelf";
}
function closeGallery() {
    const g = document.getElementById("gallery");
    if (g) g.hidden = true;
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
    // The auto-spin eases to a stop while you work (throwing/trimming/
    // painting), while you manually spin, and whenever zoomed in —
    // then drifts back up once you're idle at the default framing.
    const zoomed = state.zoom > 1.02;
    const busy = sculpting || state.painting || state.userRotating || zoomed || state.firing || !!handleDrag;
    const targetSpin = busy ? 0 : SPIN_SPEED;
    state.spin += (targetSpin - state.spin) * (1 - Math.exp(-dt * 4));
    state.turntable.rotation.y += state.spin * dt;
    // Wheel hum tracks the spin: as the auto-spin eases out while the
    // user works, the hum quiets to near-silent; restored when idle.
    if (state.sfxOn) {
        const ratio = Math.max(0, state.spin / SPIN_SPEED);
        // Ease the hum in from silence after Begin (time constant ~0.3s)
        // so it doesn't pop to full volume the first frame on some devices.
        const targetGain = wheelStarted ? 1 : 0;
        wheelGain += (targetGain - wheelGain) * (1 - Math.exp(-dt * 3));
        // Pitch dips to ~0.65x at full-stop and recovers to 1.0x at
        // full spin — the hum sounds heavier as the wheel slows down,
        // which is what real motors do.
        playSfx("wheel", {
            volume: ratio * SFX_SOURCES.wheel.vol * wheelGain,
            rate: 0.65 + 0.35 * ratio,
        });
    } else {
        stopSfx("wheel");
    }
    // The kiln sequence drives the dark-edge vignette opacity, the
    // warm inner glow, the backdrop fade and the music ducking each
    // frame. The slowed material tween (see tickMaterial) lets the
    // glaze melt visibly through the firing phase.
    if (state.firing) {
        const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const elapsed = (now - state.firingStart) / 1000;
        if (elapsed >= FIRING_DURATION) {
            endFiringMoment();
        } else {
            const phaseT = elapsed / FIRING_DURATION;
            // Phase fractions of the total: close 11%, fire 44%, cool 11%, open 33%.
            const closeEnd = 0.11, fireEnd = 0.55, coolEnd = 0.66;
            let edge = 0, glow = 0, bd = 1, ducked = 1;
            if (phaseT < closeEnd) {
                const t = smoothstep(phaseT / closeEnd);
                edge = t;            // dark walls fade in
                glow = t * 0.4;      // warm light starts
                bd = 1 - 0.88 * t;   // studio darkens
                ducked = 1 - (1 - FIRING_MUSIC_DUCK) * t;
            } else if (phaseT < fireEnd) {
                const t = (phaseT - closeEnd) / (fireEnd - closeEnd);
                edge = 1;
                glow = 0.4 + 0.6 * smoothstep(t); // glow builds toward peak
                bd = 0.12;
                ducked = FIRING_MUSIC_DUCK;
            } else if (phaseT < coolEnd) {
                const t = (phaseT - fireEnd) / (coolEnd - fireEnd);
                edge = 1;
                glow = 1 - 0.4 * smoothstep(t);   // glow softens
                bd = 0.12;
                ducked = FIRING_MUSIC_DUCK;
            } else {
                const t = smoothstep((phaseT - coolEnd) / (1 - coolEnd));
                edge = 1 - t;            // walls fade out
                glow = 0.6 * (1 - t);    // last embers
                bd = 0.12 + 0.88 * t;    // studio brightens back
                ducked = FIRING_MUSIC_DUCK + (1 - FIRING_MUSIC_DUCK) * t;
            }
            const vignette = document.getElementById("kilnVignette");
            if (vignette) {
                vignette.style.opacity = "1";
                const edgeEl = vignette.querySelector(".kiln-edge");
                const glowEl = vignette.querySelector(".kiln-inner-glow");
                if (edgeEl) edgeEl.style.opacity = edge.toFixed(3);
                if (glowEl) glowEl.style.opacity = glow.toFixed(3);
            }
            const backdrop = document.getElementById("backdrop");
            if (backdrop) backdrop.style.opacity = bd.toFixed(3);
            if (music && state._musicSavedVol != null) {
                music.volume = state._musicSavedVol * ducked;
            }
        }
    }
    if (profileDirty) {
        writeProfileToGeometry(state.pot.geometry);
        profileDirty = false;
    }
    tickMaterial(dt);
    tickPartnerMaterial(dt);
    // Wet-clay reactive sheen: water on the surface catches the room
    // light when the finger is sliding across it. Fast attack so the
    // glint pops, slow decay so it settles. Applied as a temporary
    // multiplier on envMapIntensity around the render so the material
    // tween's tracked value stays untouched next frame.
    const m = state.clayMaterial;
    let sheenLift = 0;
    if (m) {
        const wantSheen = (state.clayState === "wet" && sculpting) ? 1 : 0;
        const att = wantSheen > state.wetSheenBoost ? 0.22 : 0.025;
        state.wetSheenBoost += (wantSheen - state.wetSheenBoost) * att;
        if (state.clayState === "wet" && state.wetSheenBoost > 0.002) {
            sheenLift = m.envMapIntensity * (0.50 * state.wetSheenBoost);
            m.envMapIntensity += sheenLift;
        } else if (state.clayState !== "wet" && state.wetSheenBoost > 0) {
            state.wetSheenBoost = 0;
        }
    }
    state.renderer.render(state.scene, state.camera);
    if (sheenLift > 0) m.envMapIntensity -= sheenLift;
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) loader.classList.add("is-hidden");
}

function dismissLanding() {
    const l = document.getElementById("landing");
    if (l) l.classList.add("is-gone");
    // The Begin tap is a user gesture — safe to start audio here.
    if (state.musicOn && music) music.play().catch(() => {});
    // Ramp the wheel hum in from silence instead of popping to full.
    wheelStarted = true;
    // First install: offer the control hints after a short idle beat.
    scheduleFirstRunHint();
    // Same window for the video backdrop: iOS Safari + Low-Power Mode
    // can block muted autoplay on load; retry now that we have a gesture.
    const bg = BACKGROUNDS.find((b) => b.id === state.background);
    if (bg && bg.type === "video") {
        const vid = document.getElementById("backdropVideo");
        if (vid && vid.paused) vid.play().catch(() => {});
    }
}

// Return to the title screen (re-show the landing over the studio).
function showLanding() {
    const l = document.getElementById("landing");
    if (l) { l.hidden = false; l.classList.remove("is-gone"); }
    // Clear any pending / visible first-run hint without marking it seen —
    // the user hasn't touched the clay yet, so it can re-offer next Begin.
    if (firstRunTimer) { clearTimeout(firstRunTimer); firstRunTimer = null; }
    hideFirstRunHintEl();
    updateShapeHint();
}

// --- First-launch control hints ---------------------------------
function hasSeenFirstRun() {
    try { return localStorage.getItem(FIRST_RUN_KEY) === "1"; }
    catch (_) { return true; } // storage blocked → never nag
}
function markFirstRunSeen() {
    try { localStorage.setItem(FIRST_RUN_KEY, "1"); } catch (_) {}
}
// After Begin on a fresh install, wait out a short idle beat before
// surfacing the hints — an eager user who starts sculpting immediately
// never sees them; a hesitant one gets a gentle nudge.
function scheduleFirstRunHint() {
    if (hasSeenFirstRun()) return;
    if (firstRunTimer) clearTimeout(firstRunTimer);
    firstRunTimer = setTimeout(showFirstRunHint, 2600);
}
function showFirstRunHint() {
    firstRunTimer = null;
    if (hasSeenFirstRun()) return;
    // Don't surface over the gallery, photo modal, or the title screen.
    const gallery = document.getElementById("gallery");
    const photo   = document.getElementById("photoModal");
    const landing = document.getElementById("landing");
    if ((gallery && !gallery.hidden) || (photo && !photo.hidden) ||
        (landing && !landing.hidden && !landing.classList.contains("is-gone"))) return;
    const el = document.getElementById("firstRunHint");
    if (!el) return;
    el.hidden = false;
    // Next tick (not rAF — rAF is throttled when the tab is backgrounded)
    // so the browser paints the hidden→shown initial state before the
    // opacity transition kicks in.
    setTimeout(() => el.classList.add("is-visible"), 20);
}
// The user engaged — fade the hints out and never show them again.
function dismissFirstRunHint() {
    if (firstRunTimer) { clearTimeout(firstRunTimer); firstRunTimer = null; }
    if (hasSeenFirstRun()) return;
    markFirstRunSeen();
    hideFirstRunHintEl();
    updateShapeHint();
}
// Fade + hide the overlay element without touching the seen flag.
function hideFirstRunHintEl() {
    const el = document.getElementById("firstRunHint");
    if (!el || el.hidden) return;
    el.classList.remove("is-visible");
    setTimeout(() => { el.hidden = true; }, 600);
}
// The landing's "Pick a starter shape" caption shows only until the
// first pot is made (same flag as the in-studio hints).
function updateShapeHint() {
    const h = document.getElementById("shapeHint");
    if (h) h.hidden = hasSeenFirstRun();
}

// Light haptic tick on Android; silent no-op on desktop / iOS Safari.
function haptic(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
}

// Generic confirm dialog — a centered card over a dimmed backdrop,
// styled to match the calm palette (instead of native confirm()'s
// system harshness). Returns a promise; Esc / backdrop tap = cancel,
// Enter = confirm. Falls back to window.confirm if the modal markup
// isn't on the page (degrades safely).
function showConfirm(message, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
        const modal = document.getElementById("confirmModal");
        const msg   = document.getElementById("confirmModalMessage");
        const ok    = document.getElementById("confirmModalConfirm");
        const cancel= document.getElementById("confirmModalCancel");
        if (!modal || !msg || !ok || !cancel) { resolve(window.confirm(message)); return; }
        msg.textContent = message;
        ok.textContent = o.confirmLabel || "Discard";
        cancel.textContent = o.cancelLabel || "Keep editing";
        const close = (result) => {
            modal.classList.remove("is-open");
            setTimeout(() => { modal.hidden = true; }, 200);
            ok.removeEventListener("click", onOk);
            cancel.removeEventListener("click", onCancel);
            modal.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKey);
            resolve(result);
        };
        const onOk       = () => close(true);
        const onCancel   = () => close(false);
        const onBackdrop = (e) => { if (e.target === modal) close(false); };
        const onKey      = (e) => {
            if (e.key === "Escape") close(false);
            else if (e.key === "Enter") close(true);
        };
        ok.addEventListener("click", onOk);
        cancel.addEventListener("click", onCancel);
        modal.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKey);
        modal.hidden = false;
        requestAnimationFrame(() => modal.classList.add("is-open"));
        cancel.focus(); // safer default for keyboard
    });
}

// Title-button tap: always end up at the landing screen with a fresh
// wet pot in the studio behind it. If the user has unsaved work, ask
// before discarding it; if they've saved (or done nothing yet), just
// reset and return without interrupting.
async function returnToTitle() {
    if (state.dirty) {
        const proceed = await showConfirm("Discard this pot and start over? Your work isn't saved.");
        if (!proceed) return;
    }
    resetPot();
    showLanding();
}

// --- Ambiance: backdrops + music --------------------------------
function setBackground(id) {
    const bg = BACKGROUNDS.find((b) => b.id === id);
    if (!bg) return;
    state.background = id;
    const bd = document.getElementById("backdrop");
    const vid = document.getElementById("backdropVideo");
    const src = bgAssetUrl(bg);
    if (bg.type === "video") {
        if (bd) bd.classList.add("is-hidden");
        if (vid) {
            // Only swap the src if it changed — avoids reloading the
            // file when the same motion bg is reselected. iOS Safari
            // needs an explicit load() after src change or play() can
            // no-op silently against a stale-or-empty buffer.
            const want = new URL(src, location.href).href;
            if (vid.src !== want) { vid.src = src; vid.load(); }
            vid.classList.add("is-active");
            vid.play().catch(() => {}); // user gesture or muted autoplay
        }
    } else {
        if (vid) {
            vid.classList.remove("is-active");
            vid.pause();
        }
        if (bd) {
            bd.classList.remove("is-hidden");
            bd.style.backgroundImage = `url("${src}")`;
        }
    }
    try { localStorage.setItem("slip-bg", id); } catch (_) {}
    updateBgPicker();
}
// Background picker: a row of category tabs above a single row of
// swatches. Only the active category's swatches show — keeps the
// title screen compact, scales to many backdrops without a scrollbar.
// In the Capacitor wrap every category tab renders (not just installed
// ones) so the user has an inline surface for installing more packs;
// uninstalled categories show an "Install" prompt in the swatch row
// in place of swatches.
function buildBgPicker() {
    const wrap = document.getElementById("bgPicker");
    if (!wrap) return;
    wrap.innerHTML = "";

    // Pick the initial category: whichever one the saved background
    // lives in (if it's still installed); else Studio so we don't open
    // on an install prompt.
    const visible = visibleBackgrounds();
    const current = visible.find((b) => b.id === state.background);
    if (current) {
        state.bgCategory = current.category;
    } else if (!state.bgCategory || !categoryAvailable(state.bgCategory)) {
        state.bgCategory = "Studio";
    }

    const tabs = document.createElement("div");
    tabs.className = "bg-tabs";
    BG_CATEGORIES.forEach((cat) => {
        if (!categoryAvailable(cat)) return;
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "bg-tab";
        tab.dataset.category = cat;
        tab.textContent = cat;
        if (window.Capacitor && !isPackInstalled(cat)) {
            tab.classList.add("is-pack-locked");
            // Dot lives in CSS so the label isn't pushed around.
        }
        tab.addEventListener("click", () => setBgCategory(cat));
        tabs.appendChild(tab);
    });
    if (window.Capacitor) {
        const manage = document.createElement("button");
        manage.type = "button";
        manage.className = "bg-tab bg-manage";
        manage.textContent = "Packs";
        manage.setAttribute("aria-label", "Manage backdrop packs");
        manage.addEventListener("click", openPackManager);
        tabs.appendChild(manage);
    }
    wrap.appendChild(tabs);

    const row = document.createElement("div");
    row.className = "bg-row";
    row.id = "bgRow";
    wrap.appendChild(row);

    renderBgRow();
}

// Should we render a tab for this category? Yes if any bg lives in it
// (true for every category here, but kept so adding an empty category
// definition doesn't break the picker).
function categoryAvailable(cat) {
    return BACKGROUNDS.some((b) => b.category === cat);
}

function setBgCategory(cat) {
    if (!BG_CATEGORIES.includes(cat)) return;
    state.bgCategory = cat;
    renderBgRow();
}

function renderBgRow() {
    const row = document.getElementById("bgRow");
    if (!row) return;
    row.innerHTML = "";
    row.classList.remove("bg-row-install");
    if (window.Capacitor && !isPackInstalled(state.bgCategory)) {
        renderInstallPrompt(row, state.bgCategory);
        syncBgTabs();
        return;
    }
    visibleBackgrounds().filter((b) => b.category === state.bgCategory).forEach((b) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "bg-swatch" + (b.type === "video" ? " is-video" : "");
        el.dataset.id = b.id;
        // Video swatches use a chip-coloured tile + play glyph (CSS).
        // Static swatches show their JPG as the swatch background;
        // since it's the same URL the backdrop will use, the browser
        // caches the bytes once for both purposes.
        if (b.type !== "video") {
            el.style.backgroundImage = `url("${bgAssetUrl(b)}")`;
        }
        el.setAttribute("aria-label", b.label + " background");
        el.addEventListener("click", () => setBackground(b.id));
        row.appendChild(el);
    });
    syncBgTabs();
    updateBgPicker();
}

function syncBgTabs() {
    document.querySelectorAll(".bg-tab").forEach((el) => {
        const cat = el.dataset.category;
        if (!cat) return; // skip the Packs button
        el.classList.toggle("is-active", cat === state.bgCategory);
        el.classList.toggle("is-pack-locked",
            !!window.Capacitor && !isPackInstalled(cat));
    });
}

// --- Pack install UI -------------------------------------------
// Inline prompt that takes the swatch row's place for an uninstalled
// category. The button kicks off downloadPack; progress and error
// states re-render inside the same row.
let installInFlight = null; // category currently downloading, or null

function renderInstallPrompt(row, category) {
    row.classList.add("bg-row-install");
    const pack = PACKS[category];
    if (!pack) return;
    const wrap = document.createElement("div");
    wrap.className = "bg-install";
    const label = document.createElement("span");
    label.className = "bg-install-label";
    label.textContent = `${category} backdrops · ${fmtBytes(pack.bytes)}`;
    wrap.appendChild(label);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bg-install-btn";
    btn.textContent = installInFlight === category ? "Downloading…" : "Install";
    btn.disabled = installInFlight === category;
    btn.addEventListener("click", () => runInstall(category));
    wrap.appendChild(btn);
    row.appendChild(wrap);
}

function renderInstallProgress(row, category, pct) {
    row.classList.add("bg-row-install");
    row.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "bg-install bg-install-progress";
    const label = document.createElement("span");
    label.className = "bg-install-label";
    label.textContent = `Downloading ${category}…`;
    wrap.appendChild(label);
    const meter = document.createElement("span");
    meter.className = "bg-install-pct";
    meter.textContent = `${pct}%`;
    meter.id = "bgInstallPct";
    wrap.appendChild(meter);
    row.appendChild(wrap);
}

function renderInstallError(row, category, message) {
    row.classList.add("bg-row-install");
    row.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "bg-install bg-install-error";
    const label = document.createElement("span");
    label.className = "bg-install-label";
    label.textContent = message;
    wrap.appendChild(label);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bg-install-btn";
    btn.textContent = "Try again";
    btn.addEventListener("click", () => runInstall(category));
    wrap.appendChild(btn);
    row.appendChild(wrap);
}

async function runInstall(category) {
    if (installInFlight) return;
    if (isPackInstalled(category)) { buildBgPicker(); return; }
    const fs = fsPlugin();
    if (!fs) {
        const row = document.getElementById("bgRow");
        if (row) renderInstallError(row, category, "Downloader unavailable.");
        return;
    }
    installInFlight = category;
    const row = document.getElementById("bgRow");
    if (row) renderInstallProgress(row, category, 0);
    try {
        await downloadPack(category, (done, total) => {
            const meter = document.getElementById("bgInstallPct");
            if (meter) meter.textContent = `${Math.round((done / total) * 100)}%`;
        });
        await primeBgUrls();
        installInFlight = null;
        // Stay on the just-installed category — the user came here to
        // pick one of these. Re-rendering the row in place (rather than
        // rebuilding the whole picker) keeps state.bgCategory fixed at
        // `category`; the tab lock indicator falls off via syncBgTabs.
        state.bgCategory = category;
        renderBgRow();
        renderPackList(); // if the manage sheet is open
    } catch (e) {
        installInFlight = null;
        const r = document.getElementById("bgRow");
        const msg = /HTTP|network|Failed|fetch/i.test(String(e && e.message))
            ? "Download failed. Check your connection."
            : "Download failed.";
        if (r) renderInstallError(r, category, msg);
    }
}

// --- Pack manager sheet ----------------------------------------
function openPackManager() {
    let sheet = document.getElementById("packSheet");
    if (!sheet) {
        sheet = document.createElement("div");
        sheet.id = "packSheet";
        sheet.className = "pack-sheet";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-label", "Backdrop packs");
        sheet.innerHTML = `
            <div class="pack-sheet-bar">
                <span class="gallery-title">Backdrop packs</span>
                <button class="tool-btn" id="packSheetClose" type="button">Close</button>
            </div>
            <div class="pack-list" id="packList"></div>
            <p class="pack-note">Backdrops live on your device — uninstall any pack any time to free space.</p>
        `;
        document.body.appendChild(sheet);
        sheet.querySelector("#packSheetClose")
            .addEventListener("click", closePackManager);
    }
    renderPackList();
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add("is-open"));
}

function closePackManager() {
    const sheet = document.getElementById("packSheet");
    if (!sheet) return;
    sheet.classList.remove("is-open");
    setTimeout(() => { sheet.hidden = true; }, 220);
}

function renderPackList() {
    const list = document.getElementById("packList");
    if (!list) return;
    list.innerHTML = "";
    const installed = installedPacks();
    const rows = [
        { cat: "Studio", bytes: PRELOAD_PACK_BYTES, isBundled: true, isInstalled: true },
        ...Object.entries(PACKS).map(([cat, p]) => ({
            cat, bytes: p.bytes, isBundled: false, isInstalled: installed.has(cat),
        })),
    ];
    rows.forEach(({ cat, bytes, isBundled, isInstalled }) => {
        const item = document.createElement("div");
        item.className = "pack-item";
        const info = document.createElement("div");
        info.className = "pack-item-info";
        const name = document.createElement("span");
        name.className = "pack-item-name";
        name.textContent = cat;
        const size = document.createElement("span");
        size.className = "pack-item-size";
        size.textContent = fmtBytes(bytes);
        info.appendChild(name);
        info.appendChild(size);
        item.appendChild(info);

        const action = document.createElement("div");
        action.className = "pack-item-action";
        if (isBundled) {
            const tag = document.createElement("span");
            tag.className = "pack-item-tag";
            tag.textContent = "Built in";
            action.appendChild(tag);
        } else if (installInFlight === cat) {
            const tag = document.createElement("span");
            tag.className = "pack-item-tag is-busy";
            tag.textContent = "Installing…";
            action.appendChild(tag);
        } else if (isInstalled) {
            const u = document.createElement("button");
            u.type = "button";
            u.className = "tool-btn";
            u.textContent = "Uninstall";
            u.addEventListener("click", () => doUninstall(cat));
            action.appendChild(u);
        } else {
            const i = document.createElement("button");
            i.type = "button";
            i.className = "tool-btn tool-btn-primary";
            i.textContent = "Install";
            i.addEventListener("click", () => {
                closePackManager();
                state.bgCategory = cat;
                buildBgPicker();
                runInstall(cat);
            });
            action.appendChild(i);
        }
        item.appendChild(action);
        list.appendChild(item);
    });
}

async function doUninstall(category) {
    await uninstallPack(category);
    // If the current backdrop disappeared with the pack, snap back to
    // the bundled default so the studio doesn't end up on a 404.
    const bg = BACKGROUNDS.find((b) => b.id === state.background);
    if (bg && bg.category === category) {
        setBackground(DEFAULT_BG);
        state.bgCategory = "Studio";
    }
    renderPackList();
    // Re-render the row + tab lock state without rebuilding the picker,
    // so an unrelated uninstall doesn't bounce the user off whichever
    // category tab they were viewing.
    renderBgRow();
}

function updateBgPicker() {
    const wrap = document.getElementById("bgPicker");
    if (!wrap) return;
    wrap.querySelectorAll(".bg-swatch").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.id === state.background);
    });
}

function initMusic() {
    // Pick a random track per session for variety. If the file is
    // missing the Audio element will error; we fall back to track 0
    // so a typo in the listing doesn't silence the whole studio.
    let idx = 0;
    if (MUSIC_TRACKS.length > 1) idx = Math.floor(Math.random() * MUSIC_TRACKS.length);
    music = new Audio(MUSIC_TRACKS[idx].src);
    music.loop = true;
    music.volume = 0.45;
    music.addEventListener("error", () => {
        if (idx === 0) return;
        music = new Audio(MUSIC_TRACKS[0].src);
        music.loop = true;
        music.volume = 0.45;
        if (state.musicOn) music.play().catch(() => {});
    }, { once: true });
}

// --- SFX manager -----------------------------------------------
const sfxCache = {};       // id -> { audio, def } (lazy-instantiated)
const sfxFailed = new Set(); // ids whose file errored — don't retry

function loadSfx(id) {
    if (sfxCache[id]) return sfxCache[id];
    if (sfxFailed.has(id)) return null;
    const def = SFX_SOURCES[id];
    if (!def) return null;
    const a = new Audio(def.src);
    a.preload = "auto";
    a.loop = !!def.loop;
    a.addEventListener("error", () => { sfxFailed.add(id); }, { once: true });
    sfxCache[id] = { audio: a, def };
    return sfxCache[id];
}

// Play a sound. For looping ambient (wheel) the same audio element is
// reused and the volume is set in-place; for one-shots we clone the
// node so a fast burst of triggers can overlap without restarting.
function playSfx(id, opts) {
    if (!state.sfxOn) return;
    const s = loadSfx(id);
    if (!s) return;
    const vol = (opts && opts.volume != null) ? opts.volume : s.def.vol;
    if (s.def.loop) {
        s.audio.volume = Math.max(0, Math.min(1, vol));
        // Looping sources (wheel hum) can pitch-shift in-place via
        // playbackRate — slower spin = deeper hum. Clamp so the file
        // can't blow up audibly even if a caller passes nonsense.
        if (opts && opts.rate != null) {
            s.audio.playbackRate = Math.max(0.25, Math.min(2, opts.rate));
        }
        if (s.audio.paused && vol > 0.005) s.audio.play().catch(() => {});
        return;
    }
    const clone = s.audio.cloneNode(true);
    clone.loop = false;
    clone.volume = Math.max(0, Math.min(1, vol));
    if (s.def.pitchVar) clone.playbackRate = 1 + (Math.random() - 0.5) * s.def.pitchVar;
    clone.play().catch(() => {});
}

function stopSfx(id) {
    const s = sfxCache[id];
    if (!s) return;
    s.audio.pause();
    if (!s.def.loop) s.audio.currentTime = 0;
}

// Squelch trigger gets called from every sculpt move — throttle so
// it sounds like soft pressure, not a buzzing machine gun.
let lastSquelch = 0;
function maybeSquelch() {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (now - lastSquelch < 220) return;
    lastSquelch = now;
    playSfx("squelch");
}
function setMusic(on) {
    state.musicOn = on;
    try { localStorage.setItem("slip-music", on ? "1" : "0"); } catch (_) {}
    if (music) {
        if (on) music.play().catch(() => {});
        else music.pause();
    }
    updateMusicToggle();
}
function updateMusicToggle() {
    const btn = document.getElementById("musicToggle");
    if (!btn) return;
    btn.classList.toggle("is-on", state.musicOn);
    btn.setAttribute("aria-pressed", state.musicOn ? "true" : "false");
    btn.textContent = state.musicOn ? "♪ Music on" : "♪ Music off";
}

function setSfx(on) {
    state.sfxOn = on;
    try { localStorage.setItem("slip-sfx", on ? "1" : "0"); } catch (_) {}
    if (!on) stopSfx("wheel"); // hum restarts from the tick loop next frame when re-enabled
    updateSfxToggle();
}
function updateSfxToggle() {
    const btn = document.getElementById("sfxToggle");
    if (!btn) return;
    btn.classList.toggle("is-on", state.sfxOn);
    btn.setAttribute("aria-pressed", state.sfxOn ? "true" : "false");
    btn.textContent = state.sfxOn ? "♫ SFX on" : "♫ SFX off";
}
