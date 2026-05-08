/* =====================================================================
 * Bala Draws — doodle on a blank page, then watch it bounce to a beat
 * with stackable CSS effects. Uses Web Audio for synthesized drums and
 * Web Animations API on the .paper wrapper for the bounce, so neither
 * fights the .fx-layer's filter pipeline.
 * ===================================================================== */

(() => {
  // ---------- DOM ----------
  const canvas    = document.getElementById('canvas');
  const ctx       = canvas.getContext('2d');
  const stage     = document.getElementById('stage');
  const paper     = document.getElementById('paper');
  const fxLayer   = document.getElementById('fx-layer');
  const palette   = document.getElementById('palette');
  const sizesEl   = document.getElementById('brush-sizes');
  const eraserBtn = document.getElementById('eraser');
  const clearBtn  = document.getElementById('clear');
  const playBtn   = document.getElementById('play');
  const playIco   = document.getElementById('play-ico');
  const playLbl   = document.getElementById('play-lbl');
  const cycleBtn  = document.getElementById('cycle');
  const beatName  = document.getElementById('beat-name');
  const effectsEl = document.getElementById('effects');

  // ---------- color palette ----------
  const COLORS = [
    '#1a1a1a', '#ffffff', '#ef4444', '#fb923c',
    '#fbbf24', '#a3e635', '#22c55e', '#06b6d4',
    '#3b82f6', '#a855f7', '#ec4899', '#92400e'
  ];

  // ---------- state ----------
  let color    = COLORS[0];
  let brush    = 10;
  let tool     = 'pencil';   // 'pencil' | 'eraser'
  let drawing  = false;
  let lastX = 0, lastY = 0;

  // ---------- canvas sizing ----------
  function fitCanvas() {
    const rect = stage.getBoundingClientRect();
    const W = Math.max(200, Math.floor(rect.width  - 24));
    const H = Math.max(200, Math.floor(rect.height - 24));
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
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (prev) {
      ctx.drawImage(prev, 0, 0, prev.width / dpr, prev.height / dpr, 0, 0, W, H);
    }
  }
  window.addEventListener('resize', fitCanvas);

  // ---------- palette UI ----------
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
        tool  = 'pencil';
        eraserBtn.classList.remove('active');
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

  eraserBtn.addEventListener('click', () => {
    tool = (tool === 'eraser') ? 'pencil' : 'eraser';
    eraserBtn.classList.toggle('active', tool === 'eraser');
  });

  clearBtn.addEventListener('click', () => {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  });

  // ---------- drawing ----------
  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.clientWidth  / r.width),
      y: (e.clientY - r.top)  * (canvas.clientHeight / r.height)
    };
  }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    const p = getPos(e);
    lastX = p.x; lastY = p.y;
    ctx.fillStyle = (tool === 'eraser') ? '#ffffff' : color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = getPos(e);
    ctx.strokeStyle = (tool === 'eraser') ? '#ffffff' : color;
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

  // ---------- beat patterns (16 16th-notes per bar) ----------
  const PATTERNS = [
    { name: 'Boom Bap',
      kick:  [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0] },
    { name: 'Four/Floor',
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0] },
    { name: 'Disco',
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1] },
    { name: 'Stompy',
      kick:  [1,0,0,1, 0,0,1,0, 1,0,0,0, 1,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1] },
    { name: 'Trap',
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,1, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [1,0,1,1, 1,0,1,0, 1,1,1,0, 1,0,1,1] }
  ];
  const BPM = 110;
  let patternIdx = 0;
  beatName.textContent = PATTERNS[0].name;

  cycleBtn.addEventListener('click', () => {
    patternIdx = (patternIdx + 1) % PATTERNS.length;
    beatName.textContent = PATTERNS[patternIdx].name;
  });

  // ---------- audio ----------
  let audioCtx = null;
  let master   = null;
  let noiseBuf = null;
  let stepIdx  = 0;
  let nextStepTime = 0;
  let schedTimer = null;
  let playing = false;

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master = audioCtx.createGain();
    master.gain.value = 0.7;
    master.connect(audioCtx.destination);

    const seconds = 1;
    noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * seconds, audioCtx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }

  function playKick(t) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.25);
  }

  function playSnare(t) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'highpass'; bp.frequency.value = 1500;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.2);

    // body thump for snare body
    const o = audioCtx.createOscillator();
    const og = audioCtx.createGain();
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.4, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og); og.connect(master);
    o.start(t); o.stop(t + 0.13);
  }

  function playHat(t) {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.06);
  }

  // ---------- bounce on .paper (Web Animations API; independent of fx-layer) ----------
  function bouncePaper(kind) {
    if (drawing) return;
    const frames = (kind === 'kick')
      ? [{ transform: 'scale(1, 1)' },
         { transform: 'scale(1.05, 0.92)', offset: 0.3 },
         { transform: 'scale(1, 1)' }]
      : [{ transform: 'scale(1, 1)' },
         { transform: 'scale(0.97, 1.04)', offset: 0.3 },
         { transform: 'scale(1, 1)' }];
    paper.getAnimations().forEach(a => a.cancel());
    const anim = paper.animate(frames, {
      duration: kind === 'kick' ? 200 : 140,
      easing: 'ease-out'
    });
    anim.onfinish = () => anim.cancel();
  }

  function scheduleBounce(time, kind) {
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => bouncePaper(kind), delayMs);
  }

  // ---------- scheduler ----------
  function scheduleStep(idx, t) {
    const p = PATTERNS[patternIdx];
    if (p.kick[idx])  { playKick(t);  scheduleBounce(t, 'kick');  }
    if (p.snare[idx]) { playSnare(t); scheduleBounce(t, 'snare'); }
    if (p.hat[idx])   { playHat(t); }
  }

  function tick() {
    if (!playing) return;
    const stepDur = 60 / BPM / 4;          // 16th-note duration
    while (nextStepTime < audioCtx.currentTime + 0.1) {
      scheduleStep(stepIdx, nextStepTime);
      nextStepTime += stepDur;
      stepIdx = (stepIdx + 1) % 16;
    }
    schedTimer = setTimeout(tick, 25);
  }

  function startPlay() {
    ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playing = true;
    stepIdx = 0;
    nextStepTime = audioCtx.currentTime + 0.05;
    playIco.textContent = '⏸';
    playLbl.textContent = 'Pause';
    tick();
  }

  function stopPlay() {
    playing = false;
    if (schedTimer) clearTimeout(schedTimer);
    schedTimer = null;
    playIco.textContent = '▶';
    playLbl.textContent = 'Play';
  }

  playBtn.addEventListener('click', () => {
    if (playing) stopPlay(); else startPlay();
  });

  // ---------- effects bank (stackable CSS classes on .fx-layer) ----------
  const EFFECTS = [
    { key: 'rainbow', icon: '🌈', label: 'Rainbow' },
    { key: 'glow',    icon: '✨', label: 'Glow'    },
    { key: 'vivid',   icon: '🍭', label: 'Vivid'   },
    { key: 'blur',    icon: '🌫', label: 'Blur'    },
    { key: 'invert',  icon: '🌓', label: 'Invert'  },
    { key: 'sepia',   icon: '🟤', label: 'Sepia'   }
  ];

  function buildEffects() {
    effectsEl.innerHTML = '';
    EFFECTS.forEach(fx => {
      const b = document.createElement('button');
      b.className = 'fx-btn';
      b.dataset.fx = fx.key;
      b.setAttribute('aria-label', fx.label);
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span class="ico">${fx.icon}</span><span>${fx.label}</span>`;
      b.addEventListener('click', () => {
        const on = fxLayer.classList.toggle('fx-' + fx.key);
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      effectsEl.appendChild(b);
    });
  }

  // ---------- init ----------
  buildPalette();
  buildEffects();
  fitCanvas();
})();
