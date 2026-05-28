"use strict";

/* Glass Gallery — prototype
   Drag a marble back from the slingshot, release to lob it in an arc, and when
   it hits a glass trinket the trinket fractures into Voronoi shards that fly,
   tumble and pile on the floor. Everything is procedural so it runs offline;
   the real rawpixel PNGs drop in by swapping ONE function (see makeTarget). */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hintEl = document.getElementById("hint");

let W = 0, H = 0, DPR = 1;
let anchor, shelfY, groundY;

const GRAV = 0.42;        // marble gravity (px / frame^2)
const SHARD_GRAV = 0.34;  // shards fall a touch slower — reads as light "glass"
const MAX_PULL = 145;     // how far back you can stretch the sling
const LAUNCH_K = 0.205;   // pull distance -> launch speed

let target = null;        // the current glass trinket (an offscreen canvas)
let shards = [];          // flying + settled shards (the settled ones are the pile)
let ball = null;
let aiming = false;
let launched = false;
let pointer = { x: 0, y: 0 };
let respawnAt = 0;

/* ---------- canvas sizing ---------- */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  layout();
}
function layout() {
  anchor = { x: Math.max(95, W * 0.13), y: H - 155 };
  shelfY = H * 0.42;
  groundY = H - 54;
  if (ball && !ball.flying) { ball.x = anchor.x; ball.y = anchor.y; }
}
window.addEventListener("resize", resize);

/* ---------- math helpers ---------- */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }
function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---------- Voronoi by half-plane clipping ----------
   A Voronoi cell = every point closer to its seed than to any other seed.
   So start each cell as the whole bounding box, then for every OTHER seed
   slice away the half that's closer to that seed (clip by the perpendicular
   bisector). What's left is the cell. n points toward the other seed, so the
   side we keep is (p - midpoint)·n <= 0. */
function rectPoly(b) {
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
}
function clipHalf(poly, mx, my, nx, ny) {
  const out = [];
  const L = poly.length;
  for (let i = 0; i < L; i++) {
    const A = poly[i], B = poly[(i + 1) % L];
    const da = (A[0] - mx) * nx + (A[1] - my) * ny;
    const db = (B[0] - mx) * nx + (B[1] - my) * ny;
    const Ain = da <= 0, Bin = db <= 0;
    if (Ain) out.push(A);
    if (Ain !== Bin) {
      const t = da / (da - db);  // where segment AB crosses the bisector
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
    }
  }
  return out;
}
function voronoiCells(seeds, b) {
  return seeds.map(s => {
    let poly = rectPoly(b);
    for (const t of seeds) {
      if (t === s) continue;
      poly = clipHalf(poly, (s[0] + t[0]) / 2, (s[1] + t[1]) / 2, t[0] - s[0], t[1] - s[1]);
      if (poly.length < 3) break;
    }
    return poly;
  });
}

/* ---------- the glass trinket (procedural placeholder art) ---------- */
const SHAPES = ["heart", "star", "gem", "flower"];

function shapePath(shape, cx, cy, R) {
  const p = new Path2D();
  if (shape === "gem") {
    p.arc(cx, cy, R, 0, Math.PI * 2);
  } else if (shape === "heart") {
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(a), 3);
      const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      const px = cx + x * (R / 17), py = cy - y * (R / 17);
      i ? p.lineTo(px, py) : p.moveTo(px, py);
    }
    p.closePath();
  } else if (shape === "star") {
    const pts = 5;
    for (let i = 0; i < pts * 2; i++) {
      const r = i % 2 ? R * 0.46 : R;
      const a = -Math.PI / 2 + i * Math.PI / pts;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      i ? p.lineTo(px, py) : p.moveTo(px, py);
    }
    p.closePath();
  } else { // flower
    for (let i = 0; i <= 120; i++) {
      const a = i / 120 * Math.PI * 2;
      const r = R * (0.55 + 0.45 * Math.abs(Math.cos(3 * a)));
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      i ? p.lineTo(px, py) : p.moveTo(px, py);
    }
    p.closePath();
  }
  return p;
}

function drawGlass(g, shape, w, h) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 14;
  const hue = Math.floor(Math.random() * 360);
  g.clearRect(0, 0, w, h);
  const path = shapePath(shape, cx, cy, R);

  g.save();
  g.clip(path);
  // translucent body
  const body = g.createLinearGradient(0, cy - R, 0, cy + R);
  body.addColorStop(0, `hsla(${hue},90%,82%,0.92)`);
  body.addColorStop(0.55, `hsla(${hue},85%,63%,0.9)`);
  body.addColorStop(1, `hsla(${hue + 18},80%,52%,0.94)`);
  g.fillStyle = body;
  g.fillRect(0, 0, w, h);
  // depth toward the bottom
  const glow = g.createRadialGradient(cx, cy + R * 0.25, R * 0.1, cx, cy + R * 0.2, R * 1.15);
  glow.addColorStop(0, `hsla(${hue + 30},95%,70%,0)`);
  glow.addColorStop(1, `hsla(${hue - 20},80%,38%,0.38)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  // specular highlights
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.ellipse(cx - R * 0.32, cy - R * 0.42, R * 0.27, R * 0.16, -0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.3)";
  g.beginPath();
  g.ellipse(cx + R * 0.22, cy + R * 0.32, R * 0.12, R * 0.07, 0.4, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // bright rim
  g.lineWidth = 3;
  g.strokeStyle = `hsla(${hue},90%,92%,0.7)`;
  g.stroke(path);
}

/* ---------- real-image roster (rawpixel sheets, auto-detected) ----------
   Drop transparent-background PNG sheets into glass-gallery/assets/img/ and
   list their filenames in SHEET_FILES. We load each, flood-fill the alpha
   channel to find every separated opaque blob, and use those as the roster
   of random trinkets. Image-agnostic: each item just becomes a source-rect
   crop drawn into the same offscreen as the procedural placeholders. */
const SHEET_FILES = ["assets/trinkets/vacation.png"];
const MIN_ITEM_AREA = 400;       // discard noise-blobs smaller than this
const ALPHA_THRESHOLD = 20;      // pixels below this alpha count as transparent

let ROSTER = [];                 // [{ img, sx, sy, sw, sh }, ...]
let assetsReady = false;

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("image failed: " + src));
    img.src = src;
  });
}

function extractItems(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const oct = oc.getContext("2d", { willReadFrequently: true });
  oct.drawImage(img, 0, 0);
  const data = oct.getImageData(0, 0, w, h).data;
  const seen = new Uint8Array(w * h);
  const items = [];

  // 4-connected flood-fill: every opaque pixel walked once, tracking the
  // bounding box and area of each connected blob. Iterative (no recursion)
  // so huge sheets don't blow the call stack.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i]) continue;
      if (data[i * 4 + 3] < ALPHA_THRESHOLD) { seen[i] = 1; continue; }
      const comp = [i];          // this blob's pixel indices
      seen[i] = 1;
      let head = 0, minX = x, maxX = x, minY = y, maxY = y;
      while (head < comp.length) {
        const idx = comp[head++];
        const px = idx % w, py = (idx / w) | 0;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const push = (nx, ny) => {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
          const ni = ny * w + nx;
          if (seen[ni]) return;
          seen[ni] = 1;
          if (data[ni * 4 + 3] >= ALPHA_THRESHOLD) comp.push(ni);
        };
        push(px + 1, py); push(px - 1, py); push(px, py + 1); push(px, py - 1);
      }
      if (comp.length < MIN_ITEM_AREA) continue;
      // Copy ONLY this blob's pixels into a tight canvas. Drawing the whole
      // bounding rectangle would catch disconnected bits of a neighbouring
      // item that happen to overlap the rect — that was the "bleed".
      const cw = maxX - minX + 1, ch = maxY - minY + 1;
      const sprite = document.createElement("canvas");
      sprite.width = cw; sprite.height = ch;
      const sctx = sprite.getContext("2d");
      const out = sctx.createImageData(cw, ch);
      for (const idx of comp) {
        const s = idx * 4;
        const d = (((idx / w | 0) - minY) * cw + (idx % w - minX)) * 4;
        out.data[d] = data[s];
        out.data[d + 1] = data[s + 1];
        out.data[d + 2] = data[s + 2];
        out.data[d + 3] = data[s + 3];
      }
      sctx.putImageData(out, 0, 0);
      items.push({ img: sprite, sw: cw, sh: ch });
    }
  }
  return items;
}

async function loadAssets() {
  for (const path of SHEET_FILES) {
    try {
      const img = await loadImage(path);
      const items = extractItems(img);
      for (const it of items) ROSTER.push(it);
      console.log("glass-gallery:", path, "→", items.length, "items");
    } catch (e) {
      console.warn("glass-gallery: skipping", path + " —", e.message);
    }
  }
  assetsReady = ROSTER.length > 0;
  if (assetsReady && target) spawnTarget();   // upgrade the on-screen trinket
}

let bgImage = null;
async function loadBackground() {
  try { bgImage = await loadImage("assets/backgrounds/carnival-booth.jpg"); }
  catch (e) { console.warn("glass-gallery: no background —", e.message); }
}

let marbleImg = null;
async function loadMarble() {
  try { marbleImg = await loadImage("assets/trinkets/shooter.png"); }
  catch (e) { console.warn("glass-gallery: no marble sprite —", e.message); }
}

function makeTarget() {
  // displaySide sets a consistent visual AREA per item (scaled below), so a wide
  // horse and a round flower read as similar-sized rather than fit-to-box.
  const displaySide = clamp(Math.min(W, H) * 0.15, 50, 150);
  const pad = Math.round(displaySide * 0.14);   // breathing room for the shatter box

  let dw, dh, paint;
  if (assetsReady && ROSTER.length) {
    const it = ROSTER[(Math.random() * ROSTER.length) | 0];
    const scale = Math.sqrt((displaySide * displaySide) / (it.sw * it.sh));
    dw = Math.round(it.sw * scale);
    dh = Math.round(it.sh * scale);
    paint = octx => octx.drawImage(it.img, pad, pad, dw, dh);
  } else {
    // procedural fallback — keeps the prototype playable until the sheet PNG lands
    dw = dh = Math.round(displaySide);
    paint = (octx, ow, oh) => drawGlass(octx, SHAPES[(Math.random() * SHAPES.length) | 0], ow, oh);
  }

  const ow = dw + pad * 2, oh = dh + pad * 2;
  const oc = document.createElement("canvas");
  oc.width = ow; oc.height = oh;
  const octx = oc.getContext("2d", { willReadFrequently: true });
  paint(octx, ow, oh);

  return {
    img: oc,
    octx,
    w: ow,
    h: oh,
    x: clamp(W * 0.52 - ow / 2 + (Math.random() - 0.5) * W * 0.3, W * 0.12, W - ow - 18),
    y: Math.round(shelfY - oh + pad + 3),   // item's bottom edge sits on the shelf
    data: octx.getImageData(0, 0, ow, oh).data,   // cached alpha for hit-test + cull
    born: performance.now()
  };
}
function spawnTarget() { target = makeTarget(); }

/* alpha at an offscreen pixel (0..255) */
function alphaAt(t, lx, ly) {
  if (lx < 0 || ly < 0 || lx >= t.w || ly >= t.h) return 0;
  return t.data[((ly | 0) * t.w + (lx | 0)) * 4 + 3];
}

/* ---------- the smash ---------- */
function shatter(ix, iy) {
  const t = target;
  if (!t) return;
  const lix = ix - t.x, liy = iy - t.y;

  // seeds: a sparse spread across the trinket + a dense cluster at the impact,
  // so you get tight shards where it was hit and big lazy pieces at the edges.
  const seeds = [];
  for (let i = 0; i < 10; i++) seeds.push([Math.random() * t.w, Math.random() * t.h]);
  for (let i = 0; i < 13; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * t.w * 0.18;
    seeds.push([clamp(lix + Math.cos(a) * rr, 0, t.w), clamp(liy + Math.sin(a) * rr, 0, t.h)]);
  }

  const cells = voronoiCells(seeds, { x0: 0, y0: 0, x1: t.w, y1: t.h });
  const R = t.w * 0.6;

  for (const cell of cells) {
    if (!cell || cell.length < 3) continue;
    const c = centroid(cell);
    if (alphaAt(t, c[0], c[1]) < 25) continue;   // skip empty shards outside the shape

    // store polygon RELATIVE to its centroid so we can spin it about its middle;
    // the trinket image is then drawn offset by -centroid so the slice lines up.
    const rel = cell.map(p => [p[0] - c[0], p[1] - c[1]]);
    const wx = t.x + c[0], wy = t.y + c[1];
    const dx = wx - ix, dy = wy - iy;
    const d = Math.hypot(dx, dy) || 1;
    const burst = 1 - Math.min(d / R, 1);          // closer to impact = faster
    const sp = 2 + burst * 7 + Math.random() * 2;

    shards.push({
      x: wx, y: wy,
      vx: (dx / d) * sp + (ball ? ball.vx * 0.12 : 0) + (Math.random() - 0.5) * 1.5,
      vy: (dy / d) * sp + (ball ? ball.vy * 0.12 : 0) - 2 - Math.random() * 2,
      ang: 0,
      va: (Math.random() - 0.5) * 0.26,
      rel, cx: c[0], cy: c[1], img: t.img,
      rest: groundY - Math.random() * 26 - 4,
      settled: false
    });
  }

  if (shards.length > 170) shards.splice(0, shards.length - 170);  // cap the pile
  playShatter();
  target = null;
  respawnAt = performance.now() + 850;
}

/* ---------- per-frame updates ---------- */
function updateBall() {
  if (!ball || !ball.flying) return;
  const STEPS = 3;   // substep so a fast marble can't tunnel through a thin trinket
  for (let k = 0; k < STEPS; k++) {
    ball.vy += GRAV / STEPS;
    ball.x += ball.vx / STEPS;
    ball.y += ball.vy / STEPS;
    if (target) {
      const lx = ball.x - target.x, ly = ball.y - target.y;
      if (alphaAt(target, lx, ly) > 40) { shatter(ball.x, ball.y); resetBall(); return; }
    }
  }
  if (ball.x < -50 || ball.x > W + 50 || ball.y > H + 60) resetBall();
}
function updateShards() {
  for (const s of shards) {
    if (s.settled) continue;
    s.vy += SHARD_GRAV;
    s.vx *= 0.992;
    s.x += s.vx; s.y += s.vy; s.ang += s.va;
    if (s.y >= s.rest) {
      s.y = s.rest;
      if (s.vy > 1.2) { s.vy *= -0.34; s.vx *= 0.6; s.va *= 0.5; }   // small bounce
      else { s.settled = true; s.vy = 0; s.vx = 0; s.va = 0; }       // come to rest
    }
  }
}

/* ---------- rendering ---------- */
function drawShards() {
  for (const s of shards) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.ang);
    ctx.beginPath();
    ctx.moveTo(s.rel[0][0], s.rel[0][1]);
    for (let i = 1; i < s.rel.length; i++) ctx.lineTo(s.rel[i][0], s.rel[i][1]);
    ctx.closePath();
    ctx.clip();
    // The shard's shape comes from the image's own alpha, NOT a stroked cell
    // outline — stroking the polygon would draw a "glass pane" border into the
    // transparent area where the cell extends past the trinket's silhouette.
    ctx.drawImage(s.img, -s.cx, -s.cy);
    ctx.restore();
  }
}
function drawTarget() {
  const t = target;
  const age = (performance.now() - t.born) / 260;
  const s = age < 1 ? 0.6 + 0.4 * easeOut(age) : 1;   // little pop-in
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  ctx.save();
  ctx.globalAlpha = age < 1 ? easeOut(age) : 1;
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 10;
  ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
  ctx.drawImage(t.img, t.x, t.y);
  ctx.restore();
}
function drawShelf() {
  const x = W * 0.1, w = W * 0.8, y = shelfY, h = 18;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#b07a44");
  g.addColorStop(1, "#6e431f");
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 6); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  roundRect(ctx, x, y, w, 5, 3); ctx.fill();
}
function drawSling() {
  ctx.strokeStyle = "#3a2a1a";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y + 78); ctx.lineTo(anchor.x, anchor.y + 6);
  ctx.moveTo(anchor.x, anchor.y + 6); ctx.lineTo(anchor.x - 15, anchor.y - 15);
  ctx.moveTo(anchor.x, anchor.y + 6); ctx.lineTo(anchor.x + 15, anchor.y - 15);
  ctx.stroke();
  if (ball && !ball.flying && !aiming) {
    ctx.strokeStyle = "rgba(90,55,30,0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(anchor.x - 15, anchor.y - 15); ctx.lineTo(ball.x, ball.y);
    ctx.moveTo(anchor.x + 15, anchor.y - 15); ctx.lineTo(ball.x, ball.y);
    ctx.stroke();
  }
}
function drawBall() {
  if (marbleImg) {
    const d = ball.r * 2.6;                       // a touch wider than the hit point
    const dh = d * marbleImg.naturalHeight / marbleImg.naturalWidth;
    ctx.drawImage(marbleImg, ball.x - d / 2, ball.y - dh / 2, d, dh);
  } else {
    const g = ctx.createRadialGradient(ball.x - 4, ball.y - 4, 2, ball.x, ball.y, ball.r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#cfe3ff");
    g.addColorStop(1, "#5a7bd6");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawAim() {
  const dx = anchor.x - ball.x, dy = anchor.y - ball.y;
  if (Math.hypot(dx, dy) < 8) return;
  // stretched bands
  ctx.strokeStyle = "rgba(120,75,40,0.95)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(anchor.x - 15, anchor.y - 15); ctx.lineTo(ball.x, ball.y);
  ctx.moveTo(anchor.x + 15, anchor.y - 15); ctx.lineTo(ball.x, ball.y);
  ctx.stroke();
  // dotted trajectory preview — the thing that makes aiming feel easy
  let sx = ball.x, sy = ball.y, vx = dx * LAUNCH_K, vy = dy * LAUNCH_K;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < 36; i++) {
    vy += GRAV; sx += vx; sy += vy;
    if (sy > H || sx < 0 || sx > W) break;
    if (i % 2 === 0) {
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, 3.4 - i * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function drawCover(img) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function render() {
  if (bgImage) {
    drawCover(bgImage);
    // scrim: mute the busy sunburst a touch + darken the floor so glass reads
    const scrim = ctx.createLinearGradient(0, 0, 0, H);
    scrim.addColorStop(0, "rgba(18,10,38,0.30)");
    scrim.addColorStop(0.45, "rgba(18,10,38,0.06)");
    scrim.addColorStop(1, "rgba(8,4,20,0.58)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#2a1f52");
    bg.addColorStop(0.6, "#3a2566");
    bg.addColorStop(1, "#1a1430");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  drawShelf();
  drawShards();
  if (target) drawTarget();
  drawSling();
  if (ball) drawBall();
  if (aiming) drawAim();
}

/* ---------- input ---------- */
function resetBall() { ball = { x: anchor.x, y: anchor.y, vx: 0, vy: 0, flying: false, r: 13 }; }
function eventPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function dragBall() {
  let dx = pointer.x - anchor.x, dy = pointer.y - anchor.y;
  const d = Math.hypot(dx, dy);
  if (d > MAX_PULL) { dx *= MAX_PULL / d; dy *= MAX_PULL / d; }
  ball.x = anchor.x + dx; ball.y = anchor.y + dy;
}
function launch() {
  const dx = anchor.x - ball.x, dy = anchor.y - ball.y;
  if (Math.hypot(dx, dy) < 8) { resetBall(); return; }
  ball.vx = dx * LAUNCH_K;
  ball.vy = dy * LAUNCH_K;
  ball.flying = true;
  playThwip();
  if (!launched) { launched = true; hintEl.style.opacity = "0"; }
}
canvas.addEventListener("pointerdown", e => {
  e.preventDefault();
  resumeAudio();
  if (!ball || ball.flying) return;
  aiming = true;
  pointer = eventPos(e);
  dragBall();
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", e => {
  if (!aiming) return;
  pointer = eventPos(e);
  dragBall();
});
function endAim() { if (aiming) { aiming = false; launch(); } }
canvas.addEventListener("pointerup", endAim);
canvas.addEventListener("pointercancel", endAim);

/* ---------- audio (synthesized, no asset files) ---------- */
let actx = null;
function resumeAudio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") actx.resume();
}
function playShatter() {
  if (!actx) return;
  const a = actx, t = a.currentTime;
  // noise burst = the crash
  const len = (a.sampleRate * 0.3) | 0;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const noise = a.createBufferSource(); noise.buffer = buf;
  const hp = a.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2200;
  const ng = a.createGain(); ng.gain.value = 0.32;
  noise.connect(hp); hp.connect(ng); ng.connect(a.destination);
  noise.start(t);
  // a few glassy pings = the tinkle
  for (let i = 0; i < 4; i++) {
    const o = a.createOscillator(); o.type = "triangle";
    o.frequency.value = 900 + Math.random() * 1800;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + Math.random() * 0.15);
    o.connect(g); g.connect(a.destination);
    o.start(t + i * 0.004); o.stop(t + 0.5);
  }
}
function playThwip() {
  if (!actx) return;
  const a = actx, t = a.currentTime;
  const o = a.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(420, t);
  o.frequency.exponentialRampToValueAtTime(120, t + 0.12);
  const g = a.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + 0.16);
}

/* ---------- loop ---------- */
function tick(now) {
  if (!target && respawnAt && now >= respawnAt) { spawnTarget(); respawnAt = 0; }
  updateBall();
  updateShards();
  render();
  requestAnimationFrame(tick);
}

resize();
resetBall();
spawnTarget();
requestAnimationFrame(tick);
loadAssets();   // async; when the sheet lands, ROSTER fills and the next spawn uses it
loadBackground();
loadMarble();

// poke from the console: __glass.shatter(x, y), __glass.shards, __glass.target
window.__glass = {
  get target() { return target; },
  get shards() { return shards; },
  shatter
};
