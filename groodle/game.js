/* =====================================================================
 * Groodle — draw a figure, then make it dance to a beat.
 * Scaffold version: free-form drawing canvas + placeholder
 * squash/stretch dance animation + Web Audio metronome.
 * ===================================================================== */

(() => {
  // ---------- DOM ----------
  const canvas      = document.getElementById('canvas');
  const ctx         = canvas.getContext('2d');
  const stage       = document.getElementById('stage');
  const hint        = document.getElementById('hint');
  const drawTools   = document.getElementById('draw-tools');
  const danceTools  = document.getElementById('dance-tools');
  const palette     = document.getElementById('palette');
  const sizesEl     = document.getElementById('brush-sizes');
  const clearBtn    = document.getElementById('clear');
  const danceBtn    = document.getElementById('dance');
  const editBtn     = document.getElementById('back-to-draw');
  const stopBtn     = document.getElementById('stop-dance');
  const bpmInput    = document.getElementById('bpm');
  const bpmVal      = document.getElementById('bpm-val');

  // ---------- state ----------
  const COLORS = ['#1a1a1a', '#ff3344', '#ff8c1a', '#ffd166', '#7cf99c', '#00ffcc', '#3aa1ff', '#ff5cf0', '#ffffff'];
  let color    = COLORS[0];
  let brush    = 14;
  let drawing  = false;
  let dancing  = false;
  let lastX = 0, lastY = 0;
  let snapshot = null;       // offscreen canvas of the drawing when dance starts
  let rafId    = null;

  // ---------- canvas sizing ----------
  // Resize + repaint paper. Preserves any existing drawing by copying it
  // through an offscreen canvas before resize.
  function fitCanvas() {
    const rect = stage.getBoundingClientRect();
    const W = Math.max(200, Math.floor(rect.width  - 16));
    const H = Math.max(200, Math.floor(rect.height - 16));
    const dpr = window.devicePixelRatio || 1;

    let prev = null;
    if (canvas.width && canvas.height) {
      prev = document.createElement('canvas');
      prev.width  = canvas.width;
      prev.height = canvas.height;
      prev.getContext('2d').drawImage(canvas, 0, 0);
    }

    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    canvas.width  = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';

    // paint paper background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    if (prev) {
      // re-fit prior drawing into new logical box (stretch — simple for now)
      ctx.drawImage(prev, 0, 0, prev.width / dpr, prev.height / dpr, 0, 0, W, H);
    }
  }
  window.addEventListener('resize', fitCanvas);

  // ---------- palette ----------
  function buildPalette() {
    palette.innerHTML = '';
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' active' : '');
      b.style.background = c;
      b.dataset.color = c;
      b.setAttribute('aria-label', 'Color ' + c);
      b.addEventListener('click', () => {
        color = c;
        palette.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        b.classList.add('active');
      });
      palette.appendChild(b);
    });
  }

  sizesEl.addEventListener('click', e => {
    const btn = e.target.closest('.size-btn');
    if (!btn) return;
    brush = parseInt(btn.dataset.size, 10);
    sizesEl.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // ---------- drawing ----------
  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', e => {
    if (dancing) return;
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const p = getPos(e);
    lastX = p.x; lastY = p.y;
    // dot for taps
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    fadeHint();
  });

  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = getPos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth   = brush;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  });

  function endStroke(e) {
    if (!drawing) return;
    drawing = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  canvas.addEventListener('pointerup',     endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave',  endStroke);

  function fadeHint() {
    if (hint && !hint.classList.contains('faded')) hint.classList.add('faded');
  }

  // ---------- clear ----------
  clearBtn.addEventListener('click', () => {
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    if (hint) hint.classList.remove('faded');
  });

  // ---------- audio: metronome ----------
  // Tight scheduling: every 25 ms, schedule any beats due in the next 100 ms.
  let audioCtx = null;
  let beatStart = 0;
  let beatInterval = 0.5;
  let nextBeatTime = 0;
  let schedTimer = null;

  function startMetronome(bpm) {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    beatInterval = 60.0 / bpm;
    beatStart    = audioCtx.currentTime;
    nextBeatTime = beatStart;
    schedule();
  }

  function schedule() {
    if (!audioCtx) return;
    while (nextBeatTime < audioCtx.currentTime + 0.1) {
      scheduleClick(nextBeatTime);
      nextBeatTime += beatInterval;
    }
    schedTimer = setTimeout(schedule, 25);
  }

  function scheduleClick(t) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.setValueAtTime(880, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.start(t);
    o.stop(t + 0.1);
  }

  function stopMetronome() {
    if (schedTimer) clearTimeout(schedTimer);
    schedTimer = null;
  }

  function setBpm(bpm) {
    bpmVal.textContent = bpm;
    if (!dancing || !audioCtx) return;
    // restart with phase-preserving reset for simplicity
    stopMetronome();
    startMetronome(bpm);
  }

  bpmInput.addEventListener('input', () => setBpm(parseInt(bpmInput.value, 10)));

  // ---------- dance ----------
  // Snapshot the canvas, then render it back transformed each frame.
  function startDance() {
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);

    snapshot = document.createElement('canvas');
    snapshot.width  = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext('2d').drawImage(canvas, 0, 0);

    dancing = true;
    drawTools.classList.add('hidden');
    danceTools.classList.remove('hidden');
    if (hint) hint.classList.add('faded');

    startMetronome(parseInt(bpmInput.value, 10));
    renderDance(W, H);
  }

  function renderDance(W, H) {
    if (!dancing) return;

    const phase = beatPhase();
    const beatPulse = Math.max(0, 1 - phase * 4);
    const sx = 1 - 0.12 * beatPulse;
    const sy = 1 + 0.18 * beatPulse;
    const ty = -16 * beatPulse;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2 + ty);
    ctx.scale(sx, sy);
    const dpr = window.devicePixelRatio || 1;
    ctx.drawImage(snapshot, -W / 2, -H / 2, W, H);
    ctx.restore();

    rafId = requestAnimationFrame(() => renderDance(W, H));
  }

  function beatPhase() {
    if (!audioCtx) return 0;
    const t = audioCtx.currentTime - beatStart;
    return ((t / beatInterval) % 1 + 1) % 1;
  }

  function stopDance() {
    dancing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    stopMetronome();

    // restore the original drawing
    if (snapshot) {
      const W = canvas.width / (window.devicePixelRatio || 1);
      const H = canvas.height / (window.devicePixelRatio || 1);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(snapshot, 0, 0, W, H);
    }

    drawTools.classList.remove('hidden');
    danceTools.classList.add('hidden');
  }

  danceBtn.addEventListener('click', startDance);
  editBtn.addEventListener('click',  stopDance);
  stopBtn.addEventListener('click',  stopDance);

  // ---------- init ----------
  buildPalette();
  fitCanvas();
})();
