/* groodle â€” scribble inside the silhouette, watch it come alive */
(function () {
    'use strict';

    /* ============ CONFIG ============ */

    const STAGE_W = 400;
    const STAGE_H = 600;

    const COLORS = [
        '#000000', '#e63946', '#f4a261', '#fcbf49',
        '#43aa8b', '#1d3557', '#7209b7', '#ff6ec7',
        '#6f4e37', '#ffffff'
    ];
    const SIZES = [4, 12, 22];

    const TEMPO = 112;
    const STEPS_PER_BAR = 16;
    const BARS_PER_LOOP = 4;
    const SECONDS_PER_STEP = (60 / TEMPO) / 4;

    const MOVES = ['BOUNCE', 'TWIST', 'DISCO', 'PARTY'];
    const BEATS = ['BOOM', 'FUNKY', 'SHUFFLE', 'WILD'];

    /* ============ STATE ============ */

    let currentColor = '#000000';
    let currentSize = 12;
    let isErasing = false;
    let isDrawing = false;
    let lastX = 0, lastY = 0;

    let canvas = null;
    let ctx = null;
    let creature = null;

    let isPlaying = false;
    let currentMoveIdx = 0;
    let currentBeatIdx = 0;
    let danceStartTime = 0;

    /* ============ AUDIO ============ */

    let audioCtx = null;
    let masterGain = null;
    let schedTimer = null;
    let nextNoteTime = 0;
    let currentStep = 0;
    let currentBar = 0;

    const SCHEDULE_AHEAD = 0.1;
    const LOOKAHEAD_MS = 25;

    function ensureAudio() {
        if (audioCtx) return;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctor();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.7;
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
        masterGain.connect(comp);
        comp.connect(audioCtx.destination);
    }

    function startAudio() {
        ensureAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        currentStep = 0;
        currentBar = 0;
        nextNoteTime = audioCtx.currentTime + 0.06;
        if (schedTimer) clearInterval(schedTimer);
        schedTimer = setInterval(scheduler, LOOKAHEAD_MS);
    }

    function stopAudio() {
        if (schedTimer) {
            clearInterval(schedTimer);
            schedTimer = null;
        }
    }

    function scheduler() {
        while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
            scheduleStep(currentStep, currentBar, nextNoteTime);
            nextNoteTime += SECONDS_PER_STEP;
            currentStep++;
            if (currentStep >= STEPS_PER_BAR) {
                currentStep = 0;
                currentBar = (currentBar + 1) % BARS_PER_LOOP;
            }
        }
    }

    function scheduleStep(step, bar, when) {
        const beat = BEATS[currentBeatIdx];
        const move = MOVES[currentMoveIdx];

        if (beat === 'BOOM') {
            if (step % 4 === 0) kick(when);
            if (step === 4 || step === 12) snare(when);
            if (step % 2 === 0) hat(when, 0.28);
        } else if (beat === 'FUNKY') {
            if (step === 0 || step === 6 || step === 10) kick(when);
            if (step === 4 || step === 12) snare(when);
            if (step % 2 === 1) hat(when, 0.32);
            if (step === 14) hat(when, 0.5);
        } else if (beat === 'SHUFFLE') {
            if (step % 4 === 0) kick(when, 0.7);
            if (step === 4 || step === 12) snare(when);
            if ([0, 3, 4, 7, 8, 11, 12, 15].indexOf(step) !== -1) hat(when, 0.25);
        } else if (beat === 'WILD') {
            if (step === 0 || step === 5 || step === 10 || step === 14) kick(when);
            if (step === 7 || step === 12) snare(when);
            if (step % 2 === 0) hat(when, 0.28);
            if (step === 3 || step === 11) hat(when, 0.55);
        }

        if (move !== 'BOUNCE' && step % 4 === 0) {
            const root = [60, 65, 67, 60][bar % 4];
            const note = (step === 8) ? root + 7 : root;
            bass(when, midiToFreq(note - 24));
        }

        if (move === 'DISCO' || move === 'PARTY') {
            if ((bar === 1 || bar === 3) && step === 0) {
                const root = [60, 65, 67, 60][bar % 4];
                const phrase = [root, root + 4, root + 7, root + 12];
                phrase.forEach((n, i) => lead(when + i * SECONDS_PER_STEP * 2, midiToFreq(n)));
            }
        }
        if (move === 'PARTY' && step === 8) {
            const root = [60, 65, 67, 60][bar % 4];
            lead(when, midiToFreq(root + 12), 0.14);
        }

        if (step % 4 === 0) scheduleBubblePulse(when);
    }

    function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    function kick(when, vol) {
        if (vol == null) vol = 0.9;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.setValueAtTime(130, when);
        o.frequency.exponentialRampToValueAtTime(40, when + 0.13);
        g.gain.setValueAtTime(vol, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        o.connect(g); g.connect(masterGain);
        o.start(when); o.stop(when + 0.22);
    }

    function snare(when) {
        const dur = 0.16;
        const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const bp = audioCtx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.5, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        src.connect(bp); bp.connect(g); g.connect(masterGain);
        src.start(when); src.stop(when + dur);
        const o = audioCtx.createOscillator();
        const og = audioCtx.createGain();
        o.frequency.value = 220;
        og.gain.setValueAtTime(0.32, when);
        og.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
        o.connect(og); og.connect(masterGain);
        o.start(when); o.stop(when + 0.08);
    }

    function hat(when, vol) {
        if (vol == null) vol = 0.3;
        const dur = 0.04;
        const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 8000;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(vol, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        src.connect(hp); hp.connect(g); g.connect(masterGain);
        src.start(when); src.stop(when + dur);
    }

    function bass(when, freq) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const lp = audioCtx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = freq;
        lp.type = 'lowpass'; lp.frequency.value = 700;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.4, when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.4);
        o.connect(lp); lp.connect(g); g.connect(masterGain);
        o.start(when); o.stop(when + 0.45);
    }

    function lead(when, freq, vol) {
        if (vol == null) vol = 0.18;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'square'; o.frequency.value = freq;
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2400;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(vol, when + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        o.connect(lp); lp.connect(g); g.connect(masterGain);
        o.start(when); o.stop(when + 0.22);
    }

    /* ============ CANVAS BUILD ============ */

    function buildCanvas() {
        canvas = document.getElementById('drawCanvas');
        creature = document.getElementById('creature');
        // The canvas is sized in logical units (400x600) but we render at
        // higher pixel density for crisp strokes on retina screens.
        const dpr = Math.max(2, window.devicePixelRatio || 1);
        canvas.width = STAGE_W * dpr;
        canvas.height = STAGE_H * dpr;
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        attachDrawing();
    }

    /* Convert pointer event coords to logical canvas coords (0..400, 0..600). */
    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (STAGE_W / rect.width),
            y: (e.clientY - rect.top) * (STAGE_H / rect.height)
        };
    }

    function attachDrawing() {
        canvas.addEventListener('pointerdown', (e) => {
            if (isPlaying) return;
            try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
            isDrawing = true;
            const p = getPos(e);
            lastX = p.x; lastY = p.y;
            if (isErasing) {
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = '#000';
                ctx.beginPath();
                ctx.arc(p.x, p.y, currentSize / 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else {
                ctx.fillStyle = currentColor;
                ctx.beginPath();
                ctx.arc(p.x, p.y, currentSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            e.preventDefault();
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!isDrawing || isPlaying) return;
            const p = getPos(e);
            if (isErasing) {
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = currentSize;
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                ctx.restore();
            } else {
                ctx.strokeStyle = currentColor;
                ctx.lineWidth = currentSize;
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
            lastX = p.x; lastY = p.y;
        });

        const endStroke = (e) => {
            isDrawing = false;
            try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        };
        canvas.addEventListener('pointerup', endStroke);
        canvas.addEventListener('pointercancel', endStroke);
        canvas.addEventListener('pointerleave', () => { isDrawing = false; });
    }

    function clearCanvas() {
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    }

    /* ============ TOOLS UI ============ */

    function buildPalette() {
        const pal = document.getElementById('palette');
        COLORS.forEach(c => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'swatch';
            sw.style.background = c;
            sw.dataset.color = c;
            sw.setAttribute('aria-label', 'Color ' + c);
            if (c === currentColor) sw.classList.add('active');
            sw.addEventListener('click', () => {
                currentColor = c;
                isErasing = false;
                document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
                sw.classList.add('active');
                document.getElementById('eraserBtn').classList.remove('active');
            });
            pal.appendChild(sw);
        });
    }

    function buildSizes() {
        const wrap = document.getElementById('sizes');
        SIZES.forEach(s => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'size-btn';
            b.setAttribute('aria-label', 'Brush size ' + s);
            if (s === currentSize) b.classList.add('active');
            const dot = document.createElement('span');
            dot.className = 'dot';
            const px = Math.max(6, Math.min(28, s));
            dot.style.width = px + 'px';
            dot.style.height = px + 'px';
            b.appendChild(dot);
            b.addEventListener('click', () => {
                currentSize = s;
                document.querySelectorAll('.size-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
            });
            wrap.appendChild(b);
        });
    }

    function attachBgPicker() {
        const bgLayer = document.getElementById('bgLayer');
        document.querySelectorAll('.bg-thumb').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.bg;
                document.querySelectorAll('.bg-thumb').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                bgLayer.className = 'bg-layer bg-' + name;
            });
        });
    }

    /* ============ SURPRISE ============ */

    /* A goofy default character so kids can press DANCE immediately. The
       silhouette clip-path takes care of trimming any overflow. */
    function drawSurprise() {
        clearCanvas();

        // Skin tone fill across the whole body silhouette
        ctx.fillStyle = '#fcbf49';
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);

        // Shirt: green band over the torso
        ctx.fillStyle = '#43aa8b';
        ctx.fillRect(0, 175, STAGE_W, 175);

        // Pants
        ctx.fillStyle = '#1d3557';
        ctx.fillRect(0, 350, STAGE_W, 220);

        // Shirt logo: white badge with red star on chest
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(200, 240, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e63946';
        ctx.font = 'bold 32px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('â˜…', 200, 242);

        // Eyes
        ctx.fillStyle = '#1a0f33';
        ctx.beginPath(); ctx.arc(180, 95, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(220, 95, 7, 0, Math.PI * 2); ctx.fill();

        // Smile
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#1a0f33';
        ctx.beginPath();
        ctx.arc(200, 113, 18, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();

        // Cheeks
        ctx.fillStyle = 'rgba(230, 57, 70, 0.55)';
        ctx.beginPath(); ctx.arc(168, 118, 8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(232, 118, 8, 0, Math.PI * 2); ctx.fill();

        // Hair tufts on top of head
        ctx.fillStyle = '#7209b7';
        for (let i = 0; i < 5; i++) {
            const x = 162 + i * 19;
            ctx.beginPath();
            ctx.moveTo(x, 60);
            ctx.lineTo(x + 8, 38);
            ctx.lineTo(x + 16, 60);
            ctx.closePath();
            ctx.fill();
        }
    }

    /* ============ DANCE ============ */

    function startDance() {
        if (isPlaying) return;
        ensureAudio();
        const begin = () => {
            isPlaying = true;
            document.body.classList.add('dancing');
            document.getElementById('drawPanel').hidden = true;
            document.getElementById('dancePanel').hidden = false;
            updateMoveBeatLabels();
            startAudio();
            danceStartTime = audioCtx.currentTime;
            requestAnimationFrame(danceFrame);
        };
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(begin, begin);
        } else {
            begin();
        }
    }

    function stopDance() {
        if (!isPlaying) return;
        isPlaying = false;
        stopAudio();
        document.body.classList.remove('dancing');
        document.getElementById('drawPanel').hidden = false;
        document.getElementById('dancePanel').hidden = true;
        creature.style.transform = '';
        const floor = document.getElementById('stageFloor');
        if (floor) {
            floor.style.transform = 'translateX(-50%)';
            floor.style.opacity = '';
        }
        const bubble = document.getElementById('beatBubble');
        if (bubble) {
            bubble.style.opacity = '0';
            bubble.style.transform = '';
            bubble._pulseStart = null;
        }
    }

    function danceFrame() {
        if (!isPlaying) return;
        const t = audioCtx.currentTime - danceStartTime;
        const beats = t * (TEMPO / 60);
        applyMove(MOVES[currentMoveIdx], beats);
        requestAnimationFrame(danceFrame);
    }

    /* The whole creature transforms as a single sprite â€” translate /
       squash / sway. transform-origin is the floor (50% 92%) so the
       feet stay planted while the body bobs above. */
    function applyMove(move, beats) {
        const beatPhase = (beats % 1) * Math.PI * 2;
        const halfPhase = ((beats / 2) % 1) * Math.PI * 2;
        const bouncePulse = Math.abs(Math.sin(beatPhase));

        let ty = 0, rot = 0, sx = 1, sy = 1, tx = 0;

        if (move === 'BOUNCE') {
            ty = -bouncePulse * 14;
            sy = 1 - bouncePulse * 0.06;
            sx = 1 + bouncePulse * 0.06;
        } else if (move === 'TWIST') {
            rot = Math.sin(halfPhase) * 6;
            ty = -bouncePulse * 8;
            sy = 1 - bouncePulse * 0.04;
        } else if (move === 'DISCO') {
            const swing = Math.sin(beatPhase);
            rot = swing * 9;
            ty = -bouncePulse * 12;
            sy = 1 - bouncePulse * 0.08;
            sx = 1 + bouncePulse * 0.08;
            tx = swing * 4;
        } else if (move === 'PARTY') {
            const swing = Math.sin(beatPhase);
            const flap = Math.sin(beatPhase * 2);
            rot = swing * 12 + flap * 4;
            ty = -bouncePulse * 22;
            sy = 1 - bouncePulse * 0.12;
            sx = 1 + bouncePulse * 0.12;
            tx = swing * 8;
        }

        const parts = [];
        if (tx) parts.push('translateX(' + tx.toFixed(2) + 'px)');
        if (ty) parts.push('translateY(' + ty.toFixed(2) + 'px)');
        if (rot) parts.push('rotate(' + rot.toFixed(2) + 'deg)');
        if (sx !== 1 || sy !== 1) parts.push('scale(' + sx.toFixed(3) + ', ' + sy.toFixed(3) + ')');
        creature.style.transform = parts.join(' ');

        const floor = document.getElementById('stageFloor');
        if (floor) {
            const sc = 1 - bouncePulse * 0.18;
            floor.style.transform = 'translateX(-50%) scaleX(' + sc + ')';
            floor.style.opacity = String(0.55 + bouncePulse * 0.35);
        }

        const bubble = document.getElementById('beatBubble');
        if (bubble && bubble._pulseStart != null) {
            const elapsed = (audioCtx.currentTime - bubble._pulseStart);
            const k = Math.max(0, 1 - elapsed / 0.18);
            bubble.style.opacity = String(k);
            bubble.style.transform = 'scale(' + (1 + (1 - k) * 0.6) + ')';
        }
    }

    function scheduleBubblePulse(when) {
        const delay = Math.max(0, (when - audioCtx.currentTime) * 1000);
        setTimeout(() => {
            const bubble = document.getElementById('beatBubble');
            if (!bubble || !isPlaying) return;
            bubble._pulseStart = audioCtx.currentTime;
            bubble.style.opacity = '1';
            bubble.style.transform = 'scale(1)';
        }, delay);
    }

    /* ============ HANDLERS / INIT ============ */

    function updateMoveBeatLabels() {
        const ml = document.getElementById('moveLabel');
        const bl = document.getElementById('beatLabel');
        if (ml) ml.textContent = MOVES[currentMoveIdx];
        if (bl) bl.textContent = BEATS[currentBeatIdx];
    }

    function attachHandlers() {
        document.getElementById('clearBtn').addEventListener('click', clearCanvas);
        document.getElementById('randomBtn').addEventListener('click', drawSurprise);

        document.getElementById('eraserBtn').addEventListener('click', () => {
            isErasing = !isErasing;
            const btn = document.getElementById('eraserBtn');
            btn.classList.toggle('active', isErasing);
            if (isErasing) {
                document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            } else {
                const sw = document.querySelector('.swatch[data-color="' + currentColor + '"]');
                if (sw) sw.classList.add('active');
            }
        });

        document.getElementById('playBtn').addEventListener('click', startDance);
        document.getElementById('stopBtn').addEventListener('click', stopDance);

        document.getElementById('moveBtn').addEventListener('click', () => {
            currentMoveIdx = (currentMoveIdx + 1) % MOVES.length;
            updateMoveBeatLabels();
        });
        document.getElementById('beatBtn').addEventListener('click', () => {
            currentBeatIdx = (currentBeatIdx + 1) % BEATS.length;
            updateMoveBeatLabels();
        });
    }

    function init() {
        buildCanvas();
        buildPalette();
        buildSizes();
        attachBgPicker();
        attachHandlers();
        updateMoveBeatLabels();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
