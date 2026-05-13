// ── Sprite-sheet data (precise coords from JSON, used by applySprite) ──
const SHEETS = {
    before: { url: 'assets/img/cookies-before.png', w: 4325, h: 2434 },
    after:  { url: 'assets/img/cookies-after.png',  w: 4325, h: 2908 },
    veg:    { url: 'assets/img/veg.png',            w: 1318, h: 879  },
};

const FRAMES = {
    before: {
        'cookie-one':    { x: 1,    y: 1,    w: 1080, h: 810 },
        'cookie-two':    { x: 1082, y: 1,    w: 1080, h: 810 },
        'cookie-three':  { x: 2163, y: 1,    w: 1080, h: 810 },
        'cookie-four':   { x: 3244, y: 1,    w: 1080, h: 810 },
        'cookie-five':   { x: 1,    y: 812,  w: 1080, h: 810 },
        'cookie-six':    { x: 1082, y: 812,  w: 1080, h: 810 },
        'cookie-seven':  { x: 2163, y: 812,  w: 1080, h: 810 },
        'cookie-eight':  { x: 3244, y: 812,  w: 1080, h: 810 },
        'cookie-nine':   { x: 1,    y: 1623, w: 1080, h: 810 },
        'cookie-ten':    { x: 1082, y: 1623, w: 1080, h: 810 },
        'cookie-eleven': { x: 2163, y: 1623, w: 1080, h: 810 },
        'cookie-twelve': { x: 3244, y: 1623, w: 1080, h: 810 },
    },
    after: {
        'eaten-one':     { x: 1,    y: 1,    w: 1080, h: 968 },
        'eaten-two':     { x: 1082, y: 1,    w: 1080, h: 968 },
        'eaten-three':   { x: 2163, y: 1,    w: 1080, h: 968 },
        'eaten-four':    { x: 3244, y: 1,    w: 1080, h: 968 },
        'eaten-five':    { x: 1,    y: 970,  w: 1080, h: 968 },
        'eaten-six':     { x: 1082, y: 970,  w: 1080, h: 968 },
        'eaten-seven':   { x: 2163, y: 970,  w: 1080, h: 968 },
        'eaten-eight':   { x: 3244, y: 970,  w: 1080, h: 968 },
        'eaten-nine':    { x: 1,    y: 1939, w: 1080, h: 968 },
        'eaten-ten':     { x: 1082, y: 1939, w: 1080, h: 968 },
        'eaten-eleven':  { x: 2163, y: 1939, w: 1080, h: 968 },
        'eaten-twelve':  { x: 3244, y: 1939, w: 1080, h: 968 },
    },
    veg: {
        'veg-two':   { x: 1,   y: 1,   w: 438, h: 438 },
        'veg-three': { x: 440, y: 1,   w: 438, h: 438 },
        'veg-four':  { x: 879, y: 1,   w: 438, h: 438 },
        'veg-one':   { x: 1,   y: 440, w: 438, h: 438 },
        'veg-six':   { x: 440, y: 440, w: 438, h: 438 },
        'veg-five':  { x: 879, y: 440, w: 438, h: 438 },
    },
};

function applySprite(el, sheetKey, frameKey, w, h) {
    const sheet = SHEETS[sheetKey];
    const frame = FRAMES[sheetKey][frameKey];
    const sx = w / frame.w;
    const sy = h / frame.h;
    el.style.backgroundImage    = `url('${sheet.url}')`;
    el.style.backgroundSize     = `${sheet.w * sx}px ${sheet.h * sy}px`;
    el.style.backgroundPosition = `${-frame.x * sx}px ${-frame.y * sy}px`;
}

const COOKIE_NAMES = [
    'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];
const COOKIES = COOKIE_NAMES.map(n => ({
    before: { sheet: 'before', frame: 'cookie-' + n },
    after:  { sheet: 'after',  frame: 'eaten-'  + n },
}));

const VEGGIES = [
    { sheet: 'veg', frame: 'veg-one'   },
    { sheet: 'veg', frame: 'veg-two'   },
    { sheet: 'veg', frame: 'veg-three' },
    { sheet: 'veg', frame: 'veg-four'  },
    { sheet: 'veg', frame: 'veg-five'  },
    { sheet: 'veg', frame: 'veg-six'   },
];

const EATER_FRAMES = ['frame-one','frame-two','frame-three','frame-four','frame-five','frame-six'];
const WALK_CYCLE = ['frame-one','frame-two','frame-three','frame-five','frame-six'];

// ── Streak / speed tuning ─────────────────────────────────────────
// Streak is persistent across cookie spawns. Each catch increments it.
// It breaks only on miss (cookie flies offscreen) or veggie tap — empty
// screens between spawns do NOT break it. Per-cookie speed scales as
// STREAK_SPEED_BASE ** min(streak, STREAK_SPEED_CAP), so the streak
// counter can keep climbing past 50 but the speed contribution is capped.
const STREAK_SPEED_BASE = 1.04;   // each streak step multiplies cookie speed by this
const STREAK_SPEED_CAP  = 50;     // streak count beyond which speed stops growing

// ── Round difficulty tuning ───────────────────────────────────────
// Over the round, two curves stack on top of the streak multiplier:
//   1. Spawn interval shrinks from SPAWN_INTERVAL_START ms → SPAWN_INTERVAL_END ms
//   2. Base cookie speed grows from BASE_SPEED_START → BASE_SPEED_END
// Both follow an ease-in curve (Math.pow(p, ROUND_DIFFICULTY_EXP)) so the
// first ~third of the round is gentle and the last third gets brutal.
// Raise the exponent for a flatter ramp; lower it to compress the difficulty.
const SPAWN_INTERVAL_START = 800;  // ms between spawns at round start
const SPAWN_INTERVAL_END   = 250;  // ms between spawns at round end
const BASE_SPEED_START     = 1.0;  // baseline cookie-speed multiplier at start
const BASE_SPEED_END       = 1.5;  // baseline cookie-speed multiplier at end
const SPAWN_JITTER         = 0.25; // ± fraction applied to the mean spawn interval
const ROUND_DIFFICULTY_EXP = 1.6;  // ease-in exponent (gentle start, steeper end)

function roundEase(p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return Math.pow(p, ROUND_DIFFICULTY_EXP);
}

const CFG = {
    duration:        30,
    gravity:         900,
    minHorizSpeed:   180,
    maxHorizSpeed:   320,
    minPeakRatio:    0.10,
    maxPeakRatio:    0.55,
    feastChompMs:    260,
    feastMinDelay:   60,
    points:          10,       // base points per cookie catch (multiplied by streak tier)
    veggieRatio:     0.18,     // ~18% of spawns are veggies
    vegPenalty:      20,       // points lost per veggie tap
    // Streak multiplier tiers — score earned per catch = points * mult.
    // Capped at x5 so values stay readable; streak count itself keeps climbing.
    comboTiers: [
        { hits: 50, mult: 5, label: 'INSANE!' },
        { hits: 25, mult: 3, label: 'FIRE!'   },
        { hits: 10, mult: 2, label: 'COMBO!'  },
    ],
};

function comboTier(streak) {
    for (const t of CFG.comboTiers) {
        if (streak >= t.hits) return t;
    }
    return { mult: 1, label: null };
}

function streakSpeedMult(streak) {
    return Math.pow(STREAK_SPEED_BASE, Math.min(streak, STREAK_SPEED_CAP));
}

// ── Lore booklet content ──────────────────────────────────────────
// Each entry is one page in the 90s-manual modal opened from the start
// screen. Edit copy here; layout lives in style.css and the modal markup
// lives in index.html. Apostrophes inside template literals are literal,
// no escaping needed.
const LORE_TUB_IMG = `<div class="lore-tub-img" aria-hidden="true"></div>`;

const LORE_PAGES = [
    {
        title: 'Page 1 — Meet Tub Butter',
        html: LORE_TUB_IMG +
            `<p>Meet <strong>Tub Butter</strong> — a fuzzy orange data-eater who lives inside your computer.</p>
             <p>Tub's home is called <em>The Cache</em>. It's a cozy warehouse where bits of the internet pile up: logins, settings, save points, high scores. Tub calls them <strong>cookies</strong>. They're his favorite food.</p>
             <p>But these aren't the kind you bake. These are <strong>DATA cookies</strong> — and without them, Tub starves.</p>`,
    },
    {
        title: 'Page 2 — What Even Is a Data Cookie?',
        html:
            `<p>Every time you visit a website, the site can drop a little crumb in Tub's Cache. A short note. Like:</p>
             <div class="lore-quotes">
                <p>"This kid likes the dark theme."</p>
                <p>"This kid is logged in."</p>
                <p>"This kid was watching a video — show them where they left off."</p>
             </div>
             <p>Those notes are <strong>data cookies</strong>. Most are friendly. They're how websites remember you instead of asking who you are on every single visit.</p>`,
    },
    {
        title: 'Page 3 — Tub Butter\'s Job',
        html:
            `<p>Tub keeps his Cache tidy by eating cookies as they fly in. That's his whole job. 🍪</p>
             <p>But Tub is <strong>PICKY</strong>. Sometimes random junk drifts into the Cache too — old veggies 🥦, trackers from sites he's never visited, leftover gunk. If Tub bites into one of those, he wails <strong>"YUCK!"</strong> and your streak crashes to the floor.</p>
             <p>Help Tub grab the <em>right</em> cookies before they fly out the other side. Build a streak. Keep him happy. Keep the Cache fresh.</p>`,
    },
    {
        title: 'Page 4 — Why This Matters',
        html:
            `<p>The real internet works almost exactly like Tub's Cache. Every time you tap or click around online, websites can drop their own data cookies onto your phone or computer — to remember your logins, your scores, your settings.</p>
             <p>Most are friendly. A few are sneaky — they try to follow you from site to site, watching where you go. That's the kind grown-ups argue about when they say <em>"cookies"</em> and <em>"privacy."</em></p>
             <p>Now you know what data cookies actually are. <strong>The grown-up internet doesn't have to be confusing.</strong></p>
             <p class="lore-final">Tap <strong>START</strong>. Tub is HUNGRY.</p>`,
    },
];

const SCREENS = {
    menu:  document.getElementById('screen-menu'),
    game:  document.getElementById('screen-game'),
    feast: document.getElementById('screen-feast'),
};

const els = {
    btnStart:    document.getElementById('btn-start'),
    btnReplay:   document.getElementById('btn-replay'),
    btnMute:     document.getElementById('btn-mute'),
    btnReturn:   document.getElementById('btn-return'),
    menuMascot:  document.getElementById('menu-mascot'),
    loreModal:   document.getElementById('lore-modal'),
    loreBackdrop:document.getElementById('lore-backdrop'),
    loreClose:   document.getElementById('lore-close'),
    loreContent: document.getElementById('lore-page-content'),
    lorePrev:    document.getElementById('lore-prev'),
    loreNext:    document.getElementById('lore-next'),
    lorePageNum: document.getElementById('lore-page-num'),
    stage:       document.getElementById('game-stage'),
    tub:         document.getElementById('tub-butter'),
    pileZone:    document.getElementById('pile-zone'),
    countdown:   document.getElementById('countdown'),
    hudScore:    document.getElementById('hud-score'),
    hudTime:     document.getElementById('hud-time'),
    hudPile:     document.getElementById('hud-pile'),
    hudStreak:   document.getElementById('hud-streak'),
    hudMult:     document.getElementById('hud-mult'),
    hudStreakBlock: document.getElementById('hud-streak-block'),
    feastTub:    document.getElementById('feast-tub'),
    feastPile:   document.getElementById('feast-pile'),
    feastTitle:  document.getElementById('feast-title'),
    endScore:    document.getElementById('end-score'),
    endRank:     document.getElementById('end-rank'),
};

// ── Audio ──────────────────────────────────────────────────────────
const AUDIO_BASE = 'assets/audio/';
const SFX_VARIANTS = {
    catch: [
        'catching/cookie-one', 'catching/cookie-two', 'catching/cookie-three',
        'catching/cookie-four', 'catching/cookie-five', 'catching/cookie-six',
    ],
    veg: [
        'catching/veg-one', 'catching/veg-two', 'catching/veg-three', 'catching/veg-four',
    ],
    chomp: [
        'eating/chomp-one', 'eating/chomp-two', 'eating/chomp-three',
        'eating/chomp-four', 'eating/chomp-five',
    ],
    lick: [
        'eating/lick-one', 'eating/lick-two', 'eating/lick-three',
        'eating/lick-four', 'eating/lick-five',
    ],
};

const SFX_POOL = { catch: [], veg: [], chomp: [], lick: [] };
const SFX_START       = document.getElementById('snd-start');
const SFX_BURP        = document.getElementById('snd-burp');
const SFX_LEVEL_MUSIC = document.getElementById('snd-level-music');

const audio = {
    muted:         false,
    sfxVol:        0.85,
    startVol:      0.9,
    burpVol:       0.85,
    levelMusicVol: 0.55,   // sits under SFX so cookie/veg taps stay punchy
    activeCount:   0,
    maxConcurrent: 5,
};

function loadSfxPools() {
    for (const key of Object.keys(SFX_VARIANTS)) {
        SFX_POOL[key] = SFX_VARIANTS[key].map(name => {
            const a = new Audio(AUDIO_BASE + name + '.mp3');
            a.preload = 'auto';
            return a;
        });
    }
}

function playSfx(category, vol) {
    if (audio.muted) return;
    // Throttle: drop sounds if too many already playing — don't queue
    if (audio.activeCount >= audio.maxConcurrent) return;
    const list = SFX_POOL[category];
    if (!list || !list.length) return;
    const src = list[Math.floor(Math.random() * list.length)];
    try {
        const node = src.cloneNode(true);
        node.volume = vol != null ? vol : audio.sfxVol;
        audio.activeCount++;
        const release = () => { audio.activeCount = Math.max(0, audio.activeCount - 1); };
        node.addEventListener('ended', release, { once: true });
        node.addEventListener('error', release, { once: true });
        const p = node.play();
        if (p && typeof p.then === 'function') p.catch(release);
    } catch (_) {
        audio.activeCount = Math.max(0, audio.activeCount - 1);
    }
}

function playStartSfx() {
    if (audio.muted || !SFX_START) return;
    try {
        SFX_START.currentTime = 0;
        SFX_START.volume = audio.startVol;
        SFX_START.play().catch(() => {});
    } catch (_) {}
}

function stopStartSfx() {
    if (!SFX_START) return;
    try { SFX_START.pause(); SFX_START.currentTime = 0; } catch (_) {}
}

function playBurpSfx() {
    if (audio.muted || !SFX_BURP) return;
    try {
        SFX_BURP.currentTime = 0;
        SFX_BURP.volume = audio.burpVol;
        SFX_BURP.play().catch(() => {});
    } catch (_) {}
}

// Level background music — started when the gameplay loop begins (after
// the countdown's "GO!"), stopped at round end or abort. CFG.duration is
// set to match the clip length so it plays through once per round.
function playLevelMusic() {
    if (audio.muted || !SFX_LEVEL_MUSIC) return;
    try {
        SFX_LEVEL_MUSIC.currentTime = 0;
        SFX_LEVEL_MUSIC.volume = audio.levelMusicVol;
        SFX_LEVEL_MUSIC.play().catch(() => {});
    } catch (_) {}
}

function stopLevelMusic() {
    if (!SFX_LEVEL_MUSIC) return;
    try {
        SFX_LEVEL_MUSIC.pause();
        SFX_LEVEL_MUSIC.currentTime = 0;
    } catch (_) {}
}

// Synthesized "streak break" — quick descending sawtooth, ~300ms.
// Uses a single shared AudioContext so we don't churn on every break.
let _streakBreakCtx = null;
function playStreakBreakSfx() {
    if (audio.muted) return;
    try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        if (!_streakBreakCtx) _streakBreakCtx = new Ctor();
        const ctx = _streakBreakCtx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const now = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(520, now);
        o.frequency.exponentialRampToValueAtTime(90, now + 0.28);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(now);
        o.stop(now + 0.32);
    } catch (_) {}
}

function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.muted) {
        stopStartSfx();
        stopLevelMusic();
    } else if (state.running) {
        // Unmuting mid-round — pick the level music back up so the player
        // doesn't have to wait for the next round to hear it.
        playLevelMusic();
    }
    if (els.btnMute) {
        els.btnMute.classList.toggle('muted', audio.muted);
        els.btnMute.textContent = audio.muted ? '🔇' : '🔊';
    }
}

const state = {
    running:      false,
    cookies:      [],
    score:        0,
    pile:         0,
    timeLeftMs:   CFG.duration * 1000,
    spawnInMs:    600,
    rafId:        null,
    lastTs:       0,
    stageW:       0,
    stageH:       0,
    chompResetTo: 0,
    glitchTimer:  0,
};

function showScreen(name) {
    Object.values(SCREENS).forEach(s => s.classList.remove('active'));
    SCREENS[name].classList.add('active');
    // Return button visible on menu + feast; hidden during gameplay.
    if (els.btnReturn) els.btnReturn.classList.toggle('hidden', name === 'game');
}

// ── Fullscreen ────────────────────────────────────────────────────
// On startRound the game requests fullscreen so desktop play fills the
// whole viewport — much better hit-target real estate. iOS Safari quietly
// refuses (no fullscreen API on iframes/sub-frames there); the game still
// works fine in windowed mode. The browser's native Esc-to-exit-fullscreen
// is what implements "Esc to exit" on desktop; a fullscreenchange listener
// also aborts the round when the user bails out mid-play, so they return
// to the menu instead of being stuck in a half-state.
function requestGameFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen
             || el.webkitRequestFullscreen
             || el.msRequestFullscreen;
    if (!req) return;
    try {
        const p = req.call(el);
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
}

function exitGameFullscreen() {
    const fsEl = document.fullscreenElement
              || document.webkitFullscreenElement
              || document.msFullscreenElement;
    if (!fsEl) return;
    const exit = document.exitFullscreen
              || document.webkitExitFullscreen
              || document.msExitFullscreen;
    if (!exit) return;
    try {
        const p = exit.call(document);
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
}

// Tear down a round without playing the feast — used by Esc / fullscreen
// exit mid-play. Mirrors endRound() but routes back to the menu and skips
// the feast sequence.
function abortRound() {
    if (!state.running) return;
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    state.cookies.forEach(c => c.el && c.el.remove());
    state.cookies = [];
    stopStartSfx();
    stopLevelMusic();
    stopGlitches();
    exitGameFullscreen();
    showScreen('menu');
}

const rand   = (min, max) => min + Math.random() * (max - min);
const randI  = (min, max) => Math.floor(rand(min, max + 1));
const choice = arr => arr[randI(0, arr.length - 1)];
const lerp   = (a, b, t) => a + (b - a) * t;

function bumpHud(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 200);
}

function preload() {
    const sheets = [
        'assets/img/cookies-before.png',
        'assets/img/cookies-after.png',
        'assets/img/eater.png',
        'assets/img/veg.png',
    ];
    sheets.forEach(src => {
        const i = new Image();
        i.src = src;
    });
}

function setEaterFrame(el, frameName) {
    for (const f of EATER_FRAMES) el.classList.remove('eater-' + f);
    el.classList.add('eater-' + frameName);
}

function measureStage() {
    const r = els.stage.getBoundingClientRect();
    state.stageW = r.width;
    state.stageH = r.height;
}

// ── Hacker-terminal background layers ─────────────────────────────
// CSS handles scanlines (::before) and the corner vignette (::after).
// JS generates the code-rain columns once at init and schedules rare
// glitch bars while a round is running.
const CODE_RAIN_CHARS = '0123456789ABCDEFabcdef!@#$%^&*<>{}[]|/?:;~+=';

function initCodeRain() {
    if (!els.stage || els.stage.querySelector('.code-rain-layer')) return;
    const layer = document.createElement('div');
    layer.className = 'code-rain-layer';

    const N = 26;
    for (let i = 0; i < N; i++) {
        const col = document.createElement('div');
        col.className = 'code-rain-col';
        let block = '';
        for (let k = 0; k < 32; k++) {
            block += CODE_RAIN_CHARS[Math.floor(Math.random() * CODE_RAIN_CHARS.length)] + '\n';
        }
        // Double the block so the linear translateY loop is seamless.
        col.textContent = block + block;
        col.style.left = ((i + 0.5) / N * 100) + '%';
        const dur = rand(6, 16);
        col.style.animationDuration = dur + 's';
        col.style.animationDelay    = (-rand(0, dur)) + 's';
        layer.appendChild(col);
    }
    els.stage.appendChild(layer);
}

function spawnGlitchBar() {
    if (!state.running || state.stageH < 50) return;
    const bar = document.createElement('div');
    bar.className = 'code-glitch-bar';
    bar.style.top = rand(20, state.stageH - 30) + 'px';
    els.stage.appendChild(bar);
    bar.addEventListener('animationend', () => bar.remove(), { once: true });
    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 600);
}

function scheduleNextGlitch() {
    clearTimeout(state.glitchTimer);
    state.glitchTimer = setTimeout(() => {
        if (!state.running) return;
        spawnGlitchBar();
        scheduleNextGlitch();
    }, rand(8000, 14000));
}

function stopGlitches() {
    clearTimeout(state.glitchTimer);
    state.glitchTimer = 0;
}

function spawnCookie() {
    const W = state.stageW;
    const H = state.stageH;
    if (W < 50 || H < 50) return;

    const fromLeft = Math.random() < 0.5;
    const size     = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const cookieD  = Math.min(Math.max(W * 0.14, 54), 90); 
    const startX = fromLeft ? -cookieD : W + cookieD;
    const startY = rand(H * 0.55, H * 0.85);
    const flightTime = rand(1.6, 2.4); 
    const targetX    = fromLeft ? W + cookieD : -cookieD;
    const vx = (targetX - startX) / flightTime;
    const peakY = rand(H * CFG.minPeakRatio, H * CFG.maxPeakRatio);
    const dy = Math.max(20, startY - peakY);
    const vy = -Math.sqrt(2 * CFG.gravity * dy);

    const isVeggie = Math.random() < CFG.veggieRatio;
    const entry    = choice(isVeggie ? VEGGIES : COOKIES);
    // Veggies have a single sprite; cookies have a before/after pair.
    const sprite      = isVeggie ? entry : entry.before;
    const eatenSprite = isVeggie ? null  : entry.after;

    const el = document.createElement('div');
    el.className = isVeggie ? 'flying-veggie' : 'flying-cookie';
    el.style.left = '0px';
    el.style.top  = '0px';
    applySprite(el, sprite.sheet, sprite.frame, cookieD, cookieD);

    // Lock in the speed multiplier at spawn time. Streak speedup AND the
    // round's base-speed curve both multiply in — so cookies already in
    // flight keep their pace even as the streak or round progress changes.
    const progress    = 1 - (state.timeLeftMs / (CFG.duration * 1000));
    const baseSpeed   = lerp(BASE_SPEED_START, BASE_SPEED_END, roundEase(progress));
    const timeMult    = streakSpeedMult(state.streakHits) * baseSpeed;

    const cookie = {
        el,
        x:     startX,
        y:     startY,
        vx,
        vy,
        rot:   rand(0, 360),
        vrot:  rand(-220, 220),
        w:     cookieD,
        h:     cookieD,
        alive: true,
        popped: false,
        isVeggie,
        sprite,
        eatenSprite,
        timeMult,
    };

    const onTap = (e) => {
        e.preventDefault();
        if (!cookie.alive || cookie.popped) return;
        if (cookie.isVeggie) hitVeggie(cookie);
        else                 catchCookie(cookie);
    };
    el.addEventListener('pointerdown', onTap, { passive: false });

    els.stage.appendChild(el);
    state.cookies.push(cookie);
    placeCookieEl(cookie);
}

function placeCookieEl(c) {
    c.el.style.left = (c.x - c.w / 2) + 'px';
    c.el.style.top  = (c.y - c.h / 2) + 'px';
    c.el.style.transform = `rotate(${c.rot}deg)`;
}

// ── Catch ──────────────────────────────────────────────────────────
// Cookie-dough golds and crumbs plus two darker chocolate-chip browns.
const CRUMB_COLORS  = ['#e8b86d', '#c08a4a', '#fff3b0', '#a86a2c', '#d4a373', '#3b2410', '#5a3820'];
const SPARK_COLORS  = ['#00ffcc', '#7dffe6', '#ffffff', '#ff00ff'];
const CONFETTI_COLORS = ['#00ffcc', '#ff00ff', '#74b9ff', '#a29bfe', '#7dffe6', '#ffffff'];
const SCORE_LABELS  = ['YUM!', 'POP!', 'NOM!', 'CRUNCH!', 'TASTY!', 'CHOMP!', 'GULP!'];

state.streakHits = 0;
state.lastHitAt  = 0;

function updateStreakHud() {
    if (!els.hudStreak) return;
    els.hudStreak.textContent = String(state.streakHits);
    const tier = comboTier(state.streakHits);
    if (els.hudMult) {
        els.hudMult.textContent = tier.mult > 1 ? ('×' + tier.mult) : '';
    }
    if (els.hudStreakBlock) {
        els.hudStreakBlock.classList.toggle('dim', state.streakHits === 0);
    }
}

// Drop the streak to zero and play the red-flash + descending sound.
// No-ops if already zero, so multiple offscreen exits in one frame only
// trigger the feedback once.
function breakStreak() {
    if (state.streakHits === 0) return;
    state.streakHits = 0;
    updateStreakHud();
    playStreakBreakSfx();
    const v = els.hudStreakBlock && els.hudStreakBlock.querySelector('.hud-streak-value');
    if (v) {
        v.classList.remove('streak-break');
        void v.offsetWidth;
        v.classList.add('streak-break');
        setTimeout(() => v.classList.remove('streak-break'), 620);
    }
}

function catchCookie(c) {
    c.popped = true;
    c.alive  = false; // freeze in place — punch then fly-to-tub takes over
    c.el.classList.add('popped');

    // Swap to the eaten/crumb sprite the moment the player taps.
    if (c.eatenSprite) {
        applySprite(c.el, c.eatenSprite.sheet, c.eatenSprite.frame, c.w, c.h);
    }

    // Streak persists across spawns — only misses or veggies break it. Empty
    // screens between cookies do NOT reset.
    const prevStreak = state.streakHits;
    state.streakHits += 1;
    state.lastHitAt   = performance.now();
    const tier   = comboTier(state.streakHits);
    const earned = CFG.points * tier.mult;
    updateStreakHud();

    // Crossing a tier threshold (10, 25, 50) triggers a centered banner.
    for (const t of CFG.comboTiers) {
        if (prevStreak < t.hits && state.streakHits >= t.hits) {
            flashMilestoneBanner('STREAK ×' + t.mult + '!');
            break;
        }
    }

    state.score += earned;
    state.pile  += 1;
    els.hudScore.textContent = state.score;
    els.hudPile.textContent  = state.pile;
    bumpHud(els.hudScore);
    bumpHud(els.hudPile);

    // Combo tiers always pop big with the tier label; outside of combo,
    // ~18% of catches still get a fun random label for flavor.
    const flavorBig = Math.random() < 0.18;
    const big = tier.mult > 1 || flavorBig;
    let popText;
    if (tier.mult > 1)      popText = `${tier.label} +${earned}`;
    else if (flavorBig)     popText = `${choice(SCORE_LABELS)} +${earned}`;
    else                    popText = `+${earned}`;

    const pop = document.createElement('div');
    pop.className   = 'score-pop' + (big ? ' big' : '');
    pop.textContent = popText;
    pop.style.left  = c.x + 'px';
    pop.style.top   = c.y + 'px';
    els.stage.appendChild(pop);
    pop.addEventListener('animationend', () => pop.remove(), { once: true });

    spawnTapRing(c.x, c.y);
    spawnTapFlash(c.x, c.y);
    spawnStageFlash(c.x, c.y, 'rgba(0,255,204,0.6)');
    spawnCrumbs(c.x, c.y);
    spawnSparks(c.x, c.y);
    spawnChunks(c.x, c.y);
    spawnConfetti(c.x, c.y, big ? 18 : 10);
    cookiePunch(c);

    addPileThumb(c.eatenSprite || c.sprite);
    flashTubChomp();
    playSfx('catch');

    const targetX = (els.tub.offsetLeft || 0) + (els.tub.offsetWidth || 0) * 0.6;
    const targetY = (els.tub.offsetTop || 0)  + (els.tub.offsetHeight || 0) * 0.45;
    // brief delay so the punch reads before the cookie shoots off
    setTimeout(() => flyToTub(c, targetX, targetY), 60);
}

const VEG_SPLATTER_COLORS = ['#ff6b6b', '#c0392b', '#2ed573', '#27ae60', '#a29bfe', '#74b9ff', '#ffaa00'];
const VEG_LABELS = ['YUCK!', 'EWWW!', 'GROSS!', 'BARF!', 'NOPE!'];

function hitVeggie(v) {
    v.popped = true;
    v.alive  = false;
    v.el.classList.add('zapped', 'popped');

    const before = state.score;
    state.score = Math.max(0, state.score - CFG.vegPenalty);
    const lost  = before - state.score;
    if (lost > 0) {
        els.hudScore.textContent = state.score;
        bumpHud(els.hudScore);
    }
    breakStreak();

    const pop = document.createElement('div');
    pop.className   = 'score-pop big yuck-wobble';
    pop.textContent = `${choice(VEG_LABELS)} -${lost}`;
    pop.style.left  = v.x + 'px';
    pop.style.top   = v.y + 'px';
    pop.style.color = '#ff6b6b';
    pop.style.textShadow = '0 0 18px rgba(255,107,107,0.85), 0 3px 8px rgba(0,0,0,0.9)';
    els.stage.appendChild(pop);
    pop.addEventListener('animationend', () => pop.remove(), { once: true });

    spawnZapRing(v.x, v.y);
    spawnStageFlash(v.x, v.y, 'rgba(255,107,107,0.6)');
    spawnVegSplatter(v.x, v.y);
    spawnVegVignette();
    playSfx('veg');

    els.stage.classList.add('veg-shake');
    setTimeout(() => els.stage.classList.remove('veg-shake'), 380);

    setTimeout(() => v.el.remove(), 560);
}

function flashMilestoneBanner(text) {
    const b = document.createElement('div');
    b.className = 'milestone-banner';
    b.textContent = text;
    els.stage.appendChild(b);
    b.addEventListener('animationend', () => b.remove(), { once: true });
    setTimeout(() => { if (b.parentNode) b.remove(); }, 1200); // safety net
}

// Inset red glow flashing from the edges inward — only one at a time so
// rapid veggie taps don't stack costly box-shadow layers.
let _activeVegVignette = null;
function spawnVegVignette() {
    if (_activeVegVignette) return;
    const v = document.createElement('div');
    v.className = 'veg-vignette';
    els.stage.appendChild(v);
    _activeVegVignette = v;
    const release = () => {
        v.remove();
        if (_activeVegVignette === v) _activeVegVignette = null;
    };
    v.addEventListener('animationend', release, { once: true });
    setTimeout(release, 500); // safety net
}

// Faint red glow at the screen edge a cookie exited from.
function spawnMissTrail(edge, along) {
    const t = document.createElement('div');
    t.className = 'miss-trail miss-trail-' + edge;
    if (edge === 'bottom') {
        t.style.left = Math.max(0, along - 60) + 'px';
    } else {
        t.style.top = Math.max(0, along - 60) + 'px';
    }
    els.stage.appendChild(t);
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => { if (t.parentNode) t.remove(); }, 1000);
}

function spawnZapRing(cx, cy) {
    const ring = document.createElement('div');
    ring.className = 'zap-ring';
    ring.style.left = cx + 'px';
    ring.style.top  = cy + 'px';
    els.stage.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
}

function spawnVegSplatter(cx, cy) {
    const N = 22;
    for (let k = 0; k < N; k++) {
        const s = document.createElement('div');
        s.className = 'crumb';
        const angle = rand(-Math.PI, Math.PI);
        const dist  = rand(35, 110);
        const size  = rand(7, 14);
        s.style.cssText = `
            left: ${cx - size/2}px;
            top:  ${cy - size/2}px;
            width: ${size}px;
            height: ${size}px;
            --crumb-end: translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist - 22}px);
            --crumb-rot: ${rand(-360, 360)}deg;
            --crumb-color: ${choice(VEG_SPLATTER_COLORS)};
            animation-delay: ${k * 9}ms;
        `;
        els.stage.appendChild(s);
        s.addEventListener('animationend', () => s.remove(), { once: true });
    }
}

function cookiePunch(c) {
    c.el.style.transition = 'transform 0.09s ease-out';
    c.el.style.transform = `rotate(${c.rot}deg) scale(1.7)`;
    setTimeout(() => {
        c.el.style.transition = '';
    }, 100);
}

function spawnTapRing(cx, cy, outer) {
    const ring = document.createElement('div');
    ring.className = outer ? 'tap-ring outer' : 'tap-ring';
    ring.style.left = cx + 'px';
    ring.style.top  = cy + 'px';
    els.stage.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
}

// Singleton stage-flash: skip if one is already animating. Stacking these
// (full-stage radial-gradients) crushes mobile GPUs.
let _activeStageFlash = null;
function spawnStageFlash(cx, cy, color) {
    if (_activeStageFlash) return;
    const stageR = els.stage.getBoundingClientRect();
    const xPct = stageR.width  ? (cx / stageR.width)  * 100 : 50;
    const yPct = stageR.height ? (cy / stageR.height) * 100 : 50;
    const flash = document.createElement('div');
    flash.className = 'stage-flash';
    flash.style.setProperty('--burst-x', xPct + '%');
    flash.style.setProperty('--burst-y', yPct + '%');
    flash.style.setProperty('--burst-color', color);
    els.stage.appendChild(flash);
    _activeStageFlash = flash;
    const release = () => {
        flash.remove();
        if (_activeStageFlash === flash) _activeStageFlash = null;
    };
    flash.addEventListener('animationend', release, { once: true });
    // safety net in case animationend doesn't fire (tab backgrounded, etc.)
    setTimeout(release, 700);
}

function spawnChunks(cx, cy) {
    const N = 9;
    for (let k = 0; k < N; k++) {
        const ch = document.createElement('div');
        ch.className = 'chunk';
        const angle = (k / N) * Math.PI * 2 + rand(-0.4, 0.4);
        const dist  = rand(55, 120);
        ch.style.cssText = `
            left: ${cx - 8}px;
            top:  ${cy - 8}px;
            --chunk-end: translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist - 30}px);
            --chunk-rot: ${rand(-360, 360)}deg;
            --chunk-color: ${choice(CRUMB_COLORS)};
            animation-delay: ${k * 12}ms;
        `;
        els.stage.appendChild(ch);
        ch.addEventListener('animationend', () => ch.remove(), { once: true });
    }
}

function spawnTapFlash(cx, cy) {
    const flash = document.createElement('div');
    flash.className = 'tap-flash';
    flash.style.left = cx + 'px';
    flash.style.top  = cy + 'px';
    els.stage.appendChild(flash);
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
}

function spawnCrumbs(cx, cy) {
    const N = 18;
    for (let k = 0; k < N; k++) {
        const crumb = document.createElement('div');
        crumb.className = 'crumb';
        const angle = rand(-Math.PI, Math.PI);
        const dist  = rand(28, 100);
        const size  = rand(5, 12);
        crumb.style.cssText = `
            left: ${cx - size/2}px;
            top:  ${cy - size/2}px;
            width: ${size}px;
            height: ${size}px;
            --crumb-end: translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist - 18}px);
            --crumb-rot: ${rand(-220, 220)}deg;
            --crumb-color: ${choice(CRUMB_COLORS)};
            animation-delay: ${k * 12}ms;
        `;
        els.stage.appendChild(crumb);
        crumb.addEventListener('animationend', () => crumb.remove(), { once: true });
    }
}

function spawnSparks(cx, cy) {
    const N = 10;
    for (let k = 0; k < N; k++) {
        const s = document.createElement('div');
        s.className = 'spark';
        const angle = (k / N) * Math.PI * 2 + rand(-0.3, 0.3);
        const dist  = rand(40, 80);
        s.style.cssText = `
            left: ${cx - 5}px;
            top:  ${cy - 5}px;
            --spark-end: translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist}px);
            --spark-color: ${choice(SPARK_COLORS)};
            animation-delay: ${k * 8}ms;
        `;
        els.stage.appendChild(s);
        s.addEventListener('animationend', () => s.remove(), { once: true });
    }
}

function spawnConfetti(cx, cy, count) {
    const N = count != null ? count : 12;
    for (let k = 0; k < N; k++) {
        const c = document.createElement('div');
        c.className = 'confetti';
        const angle = rand(-Math.PI, 0) - 0.15;
        const dist  = rand(60, 110);
        c.style.cssText = `
            left: ${cx - 3}px;
            top:  ${cy - 5}px;
            --confetti-end: translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist + 50}px);
            --confetti-rot: ${rand(-540, 540)}deg;
            --confetti-color: ${choice(CONFETTI_COLORS)};
            animation-delay: ${k * 14}ms;
        `;
        els.stage.appendChild(c);
        c.addEventListener('animationend', () => c.remove(), { once: true });
    }
}

function flashTubChomp() {
    els.tub.classList.add('chomp');
    state.chompResetTo = performance.now() + 280;
}

function flyToTub(c, targetX, targetY) {
    c.alive = false;
    const startX = c.x, startY = c.y;
    const startTime = performance.now();
    const DURATION = 280;

    const tick = (now) => {
        const t = Math.min((now - startTime) / DURATION, 1);
        const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;
        const x = lerp(startX, targetX, ease);
        const y = lerp(startY, targetY, ease) - Math.sin(Math.PI * ease) * 30;
        const scale = lerp(1, 0.18, ease);
        c.el.style.left = (x - c.w / 2) + 'px';
        c.el.style.top  = (y - c.h / 2) + 'px';
        c.el.style.transform = `scale(${scale}) rotate(${c.rot + ease * 360}deg)`;
        c.el.style.opacity = ease > 0.85 ? lerp(1, 0, (ease - 0.85) / 0.15) : 1;
        if (t < 1) requestAnimationFrame(tick);
        else c.el.remove();
    };
    requestAnimationFrame(tick);
}

function addPileThumb(sprite) {
    const MAX_THUMBS = 10;
    const existing = els.pileZone.children;
    if (existing.length >= MAX_THUMBS) {
        existing[0].remove();
    }
    const el = document.createElement('div');
    el.className = 'pile-cookie';
    const zoneR = els.pileZone.getBoundingClientRect();
    const thumbW = Math.min(Math.max(zoneR.width * 0.45, 28), 44);
    applySprite(el, sprite.sheet, sprite.frame, thumbW, thumbW);
    el.style.width = thumbW + 'px';
    el.style.height = thumbW + 'px';
    const x = rand(0, Math.max(0, zoneR.width  - thumbW));
    const y = rand(0, Math.max(0, zoneR.height - thumbW));
    el.style.left = x + 'px';
    el.style.bottom = y + 'px';
    el.style.transform = `rotate(${rand(-25, 25)}deg)`;
    els.pileZone.appendChild(el);
}

function loop(ts) {
    if (!state.running) return;
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min((ts - state.lastTs) / 1000, 0.05); 
    state.lastTs = ts;

    if (state.chompResetTo && ts >= state.chompResetTo) {
        els.tub.classList.remove('chomp');
        state.chompResetTo = 0;
    }

    const W = state.stageW, H = state.stageH;
    for (const c of state.cookies) {
        if (!c.alive) continue;
        // Per-cookie time scaling: same parabolic arc, compressed in time.
        // Streak-driven speedup is baked in at spawn via c.timeMult.
        const cdt = dt * (c.timeMult || 1);
        c.vy += CFG.gravity * cdt;
        c.x  += c.vx * cdt;
        c.y  += c.vy * cdt;
        c.rot += c.vrot * cdt;
        placeCookieEl(c);

        if (c.y - c.h / 2 > H + 60 ||
            c.x < -c.w * 2 || c.x > W + c.w * 2) {
            // A real cookie that flew off uncaught is a "miss" — break the
            // streak (no point loss; this is a kids' game). Veggies escaping
            // are good news for the player, so leave the streak alone.
            if (!c.popped && !c.isVeggie) {
                const edge = (c.y - c.h / 2 > H + 60) ? 'bottom'
                           : (c.x < -c.w * 2)         ? 'left'
                           :                            'right';
                const along = edge === 'bottom' ? c.x : c.y;
                spawnMissTrail(edge, along);
                breakStreak();
            }
            c.alive = false;
            c.el.remove();
        }
    }
    // Only keep cookies still in physics. Popped cookies are handed off to
    // flyToTub which holds its own reference; leaving them in this array would
    // make it grow unbounded over a round.
    state.cookies = state.cookies.filter(c => c.alive);

    state.spawnInMs -= dt * 1000;
    if (state.spawnInMs <= 0) {
        spawnCookie();
        const progress = 1 - (state.timeLeftMs / (CFG.duration * 1000));
        const mean = lerp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, roundEase(progress));
        state.spawnInMs = mean * (1 + rand(-SPAWN_JITTER, SPAWN_JITTER));
    }

    state.timeLeftMs -= dt * 1000;
    const secs = Math.max(0, Math.ceil(state.timeLeftMs / 1000));
    if (els.hudTime.textContent !== String(secs)) {
        els.hudTime.textContent = secs;
        if (secs <= 10 && secs > 0) bumpHud(els.hudTime);
    }

    if (state.timeLeftMs <= 0) {
        endRound();
        return;
    }

    state.rafId = requestAnimationFrame(loop);
}

function resetState() {
    state.running     = false;
    state.score       = 0;
    state.pile        = 0;
    state.timeLeftMs  = CFG.duration * 1000;
    state.spawnInMs   = SPAWN_INTERVAL_START * (1 + rand(-SPAWN_JITTER, SPAWN_JITTER));
    state.lastTs      = 0;
    state.chompResetTo = 0;
    state.streakHits  = 0;
    state.lastHitAt   = 0;

    state.cookies.forEach(c => c.el && c.el.remove());
    state.cookies = [];
    els.pileZone.innerHTML = '';
    els.feastPile.innerHTML = '';
    els.tub.classList.remove('chomp');

    els.hudScore.textContent = '0';
    els.hudTime.textContent  = String(CFG.duration);
    els.hudPile.textContent  = '0';
    updateStreakHud();
}

function startRound() {
    playStartSfx();
    requestGameFullscreen();
    showScreen('game');
    requestAnimationFrame(() => {
        resetState();
        measureStage();
        runCountdown(['3', '2', '1', 'GO!'], 600).then(() => {
            state.running = true;
            state.lastTs  = 0;
            state.rafId   = requestAnimationFrame(loop);
            scheduleNextGlitch();
            // Hand off from the countdown jingle to the level music so the
            // two don't overlap, then start the round soundtrack.
            stopStartSfx();
            playLevelMusic();
        });
    });
}

function runCountdown(steps, perStepMs) {
    return new Promise(resolve => {
        let i = 0;
        const tick = () => {
            if (i >= steps.length) { resolve(); return; }
            els.countdown.textContent = steps[i];
            els.countdown.classList.remove('show');
            void els.countdown.offsetWidth;
            els.countdown.classList.add('show');
            i++;
            setTimeout(tick, perStepMs);
        };
        tick();
    });
}

function endRound() {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
    state.cookies.forEach(c => c.el && c.el.remove());
    state.cookies = [];
    stopStartSfx();
    stopLevelMusic();
    stopGlitches();
    // Note: fullscreen is kept through the feast screen so PLAY AGAIN
    // feels seamless. Esc or abortRound() exits fullscreen when needed.
    setTimeout(showFeast, 400);
}

function showFeast() {
    els.endScore.textContent = String(state.score);
    els.endRank.textContent  = rankFor(state.score);
    showScreen('feast');

    requestAnimationFrame(() => {
        const stage = document.getElementById('feast-stage');
        const stageR = stage.getBoundingClientRect();
        els.feastPile.innerHTML = '';

        const pileImgs = buildFeastPile(stageR);
        chompPile(pileImgs);
    });
}

function rankFor(score) {
    if (score >= 600) return 'Tub Butter says: LEGENDARY FEAST! 🤤';
    if (score >= 400) return 'Tub Butter says: BIG belly day!';
    if (score >= 200) return 'Tub Butter says: very tasty!';
    if (score >=  75) return 'Tub Butter says: a respectable snack.';
    if (score >    0) return 'Tub Butter says: hmm... still hungry.';
    return 'Tub Butter says: ...crumbs only?';
}

function buildFeastPile(stageR) {
    const VISIBLE_MAX = 28;
    const count = Math.max(0, Math.min(state.pile, VISIBLE_MAX));
    if (count === 0) return [];

    const pileR = els.feastPile.getBoundingClientRect();
    const pileW = pileR.width;
    const pileH = pileR.height;
    const cookieD = Math.min(Math.max(pileW * 0.22, 38), 70);

    const imgs = [];
    for (let i = 0; i < count; i++) {
        // End-game pile shows the eaten/crumb state of each cookie.
        const sprite = COOKIES[i % COOKIES.length].after;
        const el = document.createElement('div');
        el.className = 'feast-cookie';
        applySprite(el, sprite.sheet, sprite.frame, cookieD, cookieD);
        el.style.width  = cookieD + 'px';
        el.style.height = cookieD + 'px';

        const rowSize = Math.ceil(Math.sqrt(count) * 1.4);
        const row     = Math.floor(i / rowSize);
        const col     = i % rowSize;
        const rowOffset = row * cookieD * 0.55;

        const x = pileW - cookieD * (rowSize + 1) * 0.45 + col * cookieD * 0.6 + rand(-4, 4);
        const y = rowOffset + rand(-3, 3);

        el.style.right  = (x) + 'px';
        el.style.bottom = (y) + 'px';
        el.style.transform = `rotate(${rand(-30, 30)}deg)`;
        el.style.opacity = '0';
        els.feastPile.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '1';
        }, i * 35);
        imgs.push(el);
    }
    return imgs;
}

function chompPile(imgs) {
    setEaterFrame(els.feastTub, 'frame-one');

    if (!imgs.length) {
        els.feastTitle.textContent = 'NOTHING TO EAT...';
        return;
    }
    const inDelay = imgs.length * 35 + 320;

    setTimeout(() => {
        let i = imgs.length - 1;
        let bites = 0;
        const stepMs = Math.max(CFG.feastMinDelay, CFG.feastChompMs - imgs.length * 3);
        const closeMs = Math.min(180, Math.max(90, stepMs - 50));

        const eatNext = () => {
            if (i < 0) {
                // Final close + a satisfied lick, then a happy burp
                setEaterFrame(els.feastTub, 'frame-one');
                els.feastTub.style.animation = 'tub-breathe 2.4s ease-in-out infinite';
                els.feastTitle.textContent = 'YUM!';
                playSfx('lick');
                setTimeout(playBurpSfx, 380);
                return;
            }
            // Mouth opens — frame-four is the open-mouth chomp pose
            setEaterFrame(els.feastTub, 'frame-four');
            els.feastTub.style.animation = 'none';
            void els.feastTub.offsetWidth;
            els.feastTub.style.animation = 'tub-chomp 0.32s ease-out';

            // Sound aligned to the action: chomp on bite, occasional lick
            // between bites. Throttle prevents pile-up at fast pacing.
            const useLick = bites > 0 && bites % 4 === 0;
            playSfx(useLick ? 'lick' : 'chomp');

            // Mouth closes onto a walking-sequence pose before the next bite
            const walkFrame = WALK_CYCLE[bites % WALK_CYCLE.length];
            setTimeout(() => {
                setEaterFrame(els.feastTub, walkFrame);
            }, closeMs);

            const target = imgs[i];
            target.classList.add('gone');
            setTimeout(() => target.remove(), 350);
            i--;
            bites++;
            setTimeout(eatNext, stepMs);
        };
        eatNext();
    }, inDelay);
}

// ── Lore booklet modal ────────────────────────────────────────────
state.lorePage = 0;
state.loreOpen = false;

function loreRender() {
    const idx  = state.lorePage;
    const page = LORE_PAGES[idx];
    if (!els.loreContent) return;
    els.loreContent.innerHTML =
        `<h2 id="lore-page-title">${page.title}</h2>${page.html}`;
    els.loreContent.scrollTop = 0;
    els.lorePageNum.textContent = (idx + 1) + ' / ' + LORE_PAGES.length;
    els.lorePrev.disabled = idx === 0;
    els.loreNext.disabled = idx === LORE_PAGES.length - 1;
}

function loreSetPage(idx) {
    state.lorePage = Math.max(0, Math.min(LORE_PAGES.length - 1, idx));
    loreRender();
}

function loreOpen() {
    if (state.loreOpen) return;
    state.loreOpen = true;
    state.lorePage = 0;
    loreRender();
    els.loreModal.classList.add('open');
    els.loreModal.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', loreKeyHandler);
    // Tab-focuses the close button per spec.
    setTimeout(() => els.loreClose && els.loreClose.focus(), 60);
}

function loreCloseModal() {
    if (!state.loreOpen) return;
    state.loreOpen = false;
    els.loreModal.classList.remove('open');
    els.loreModal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', loreKeyHandler);
    // Return focus to the trigger so keyboard users don't lose their place.
    if (els.menuMascot) els.menuMascot.focus();
}

function loreKeyHandler(e) {
    if (!state.loreOpen) return;
    switch (e.key) {
        case 'Escape':
            e.preventDefault();
            loreCloseModal();
            break;
        case 'ArrowRight':
        case 'PageDown':
            e.preventDefault();
            loreSetPage(state.lorePage + 1);
            break;
        case 'ArrowLeft':
        case 'PageUp':
            e.preventDefault();
            loreSetPage(state.lorePage - 1);
            break;
    }
}

function init() {
    preload();
    loadSfxPools();
    initCodeRain();
    els.btnStart.addEventListener('click',  startRound);
    els.btnReplay.addEventListener('click', startRound);
    if (els.btnMute) els.btnMute.addEventListener('click', toggleMute);

    if (els.menuMascot)   els.menuMascot.addEventListener('click', loreOpen);
    if (els.loreClose)    els.loreClose.addEventListener('click', loreCloseModal);
    if (els.loreBackdrop) els.loreBackdrop.addEventListener('click', loreCloseModal);
    if (els.lorePrev)     els.lorePrev.addEventListener('click', () => loreSetPage(state.lorePage - 1));
    if (els.loreNext)     els.loreNext.addEventListener('click', () => loreSetPage(state.lorePage + 1));

    window.addEventListener('resize', () => {
        if (state.running) measureStage();
    });

    els.stage.addEventListener('contextmenu', e => e.preventDefault());
    els.stage.addEventListener('dragstart',   e => e.preventDefault());

    // Esc during a round: abort + back to menu. The lore modal has its
    // own Esc handler that's only attached while it's open, and lore can
    // only open from the menu (where state.running is false), so the two
    // handlers never both fire on the same Esc keypress.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.running && !state.loreOpen) {
            e.preventDefault();
            abortRound();
        }
    });

    // If the user exits fullscreen mid-play (Esc, F11, browser UI),
    // abort the round so they're not stuck with the game still ticking
    // behind a returned-to-windowed view.
    const onFsChange = () => {
        const fs = document.fullscreenElement
                || document.webkitFullscreenElement
                || document.msFullscreenElement;
        if (!fs && state.running) abortRound();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
}

document.addEventListener('DOMContentLoaded', init);
