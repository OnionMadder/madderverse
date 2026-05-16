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

    /* Poses drive the silhouette. Humanoid poses carry a `skeleton`
       (a handful of joint coordinates) that groodleBodyPath() turns
       into ONE smooth closed outline — no primitive union, so there
       are no concave hip/shoulder seams: the figure reads as a single
       intentional gingerbread-person shape. Non-humanoid poses
       (ghost, animal) carry a hand-authored `path` d-string instead.

       posePathD(pose) resolves either form to a single SVG path
       string in the logical 400x600 space; the canvas clip
       (buildBodyPath) and the three SVG groups (clipPath / fill /
       outline) both consume that one string, so the visible body and
       the paintable area can never drift apart.

       Adding a humanoid pose = one skeleton entry. The dance is a
       transform on the .creature wrapper and is independent of how
       the body is built (rigid-body only; true limb articulation is
       a post-launch v2 — see PLAY_STORE_PLAN.md). */

    const SK = {
        /* Shared body proportions so every humanoid pose stays on-model.
           hw = half-width at that joint line; armW/legW = limb radius. */
        head:  { x: 200, y: 92, r: 58 },
        shoulderY: 188, shoulderHW: 56,
        hipY: 392, hipHW: 44,
        armW: 22, legW: 24
    };

    function hum(handL, handR, footL, footR, extra) {
        /* Build a humanoid skeleton from just the 4 limb tips; the
           torso/head proportions come from SK so poses stay consistent. */
        const s = {
            head: SK.head,
            shoulderY: SK.shoulderY, shoulderHW: SK.shoulderHW,
            hipY: SK.hipY, hipHW: SK.hipHW,
            armW: SK.armW, legW: SK.legW,
            handL: handL, handR: handR, footL: footL, footR: footR
        };
        if (extra) for (const k in extra) s[k] = extra[k];
        return s;
    }

    const POSES = {
        standing: { name: 'Standing', icon: '🧍', origin: '50% 92%',
            /* Hands hang close to the body (just outside the torso, ~hip
               level) so the arms read as relaxed at the sides — far-out
               low hands made the whole figure a bottom-heavy pear. */
            skeleton: hum({ x: 152, y: 346 }, { x: 248, y: 346 },
                          { x: 164, y: 566 }, { x: 236, y: 566 }) },
        cheer: { name: 'Cheering', icon: '🙌', origin: '50% 92%',
            skeleton: hum({ x: 122, y: 70 }, { x: 278, y: 70 },
                          { x: 176, y: 566 }, { x: 224, y: 566 }) },
        star: { name: 'Star', icon: '⭐', origin: '50% 90%',
            skeleton: hum({ x: 92, y: 150 }, { x: 308, y: 150 },
                          { x: 138, y: 556 }, { x: 262, y: 556 }) },
        groovy: { name: 'Groovy', icon: '💃', origin: '50% 92%',
            skeleton: hum({ x: 120, y: 78 }, { x: 286, y: 330 },
                          { x: 168, y: 566 }, { x: 232, y: 560 }) },
        tpose: { name: 'T-Pose', icon: '✋', origin: '50% 92%',
            skeleton: hum({ x: 86, y: 196 }, { x: 314, y: 196 },
                          { x: 182, y: 566 }, { x: 218, y: 566 }) },
        wave: { name: 'Waving', icon: '👋', origin: '50% 92%',
            skeleton: hum({ x: 120, y: 372 }, { x: 286, y: 70 },
                          { x: 176, y: 566 }, { x: 224, y: 566 }) },
        ghost: { name: 'Ghost', icon: '👻', origin: '50% 88%',
            /* Bell-shaped body with a 3-bump wavy hem + two stubby
               drifting arms. One closed path, hand-authored. */
            path: 'M 200 38 C 132 38 110 96 110 168 L 110 470 ' +
                  'C 110 470 96 452 78 460 C 70 388 70 320 78 268 ' +
                  'C 60 286 60 360 64 470 ' +
                  'L 64 506 C 64 506 96 486 116 506 ' +
                  'C 140 530 162 530 186 506 C 200 492 200 492 214 506 ' +
                  'C 238 530 260 530 284 506 C 304 486 336 506 336 506 ' +
                  'L 336 470 C 340 360 340 286 322 268 ' +
                  'C 330 320 330 388 322 460 C 304 452 290 470 290 470 ' +
                  'L 290 168 C 290 96 268 38 200 38 Z' },
        animal: { name: 'Animal', icon: '🐾', origin: '50% 92%',
            /* Horizontal critter: round head left, loaf body, perky
               tail, 4 stubby legs. One closed path, hand-authored. */
            path: 'M 96 250 C 70 250 60 282 66 306 ' +
                  'C 50 318 48 348 64 360 C 58 392 70 430 92 430 ' +
                  'L 108 430 C 122 430 128 408 128 392 ' +
                  'C 150 398 176 398 196 392 L 196 432 ' +
                  'C 196 446 220 446 220 432 L 220 386 ' +
                  'C 250 392 286 392 312 380 L 312 430 ' +
                  'C 312 444 336 444 336 430 L 336 366 ' +
                  'C 356 356 372 332 372 300 ' +
                  'C 392 290 398 268 392 256 C 404 240 396 214 380 212 ' +
                  'C 360 184 300 176 250 192 ' +
                  'C 210 178 150 196 122 226 ' +
                  'C 110 232 102 240 96 250 Z' }
    };

    function getCurrentPose() {
        return POSES[(state && state.pose) || 'standing'] || POSES.standing;
    }

    /* ---- Single-path body generator ----

       The body is a COMPOUND path: a head circle + a fat torso
       capsule + four limb capsules, concatenated into one `d` string.
       Each sub-part is wound the same way, so nonzero-fill unions them
       into one solid shape — overlapping parts have no internal seam
       (the limb capsule roots sit UP INSIDE the torso, so there's no
       hip/shoulder notch) and the space between the legs is simply
       outside every sub-part, so two distinct legs always read. This
       is robust where a single Catmull-Rom perimeter was not: a spline
       can't carve the concave crotch without overshooting and fusing
       the legs. The SVG outline filter rasterises the union's alpha
       into one ring, so the compound path still outlines as one body. */

    /* A circle as four cubic béziers (kappa method). Zero arc-flag
       ambiguity and no diameter-degeneracy — deterministic in every
       renderer, which hand-rolled SVG `A` arcs were not. */
    const KAPPA = 0.5522847498307936;
    function circleBezier(cx, cy, r) {
        const k = r * KAPPA, f = (n) => n.toFixed(2);
        return 'M ' + f(cx + r) + ' ' + f(cy) +
               ' C ' + f(cx + r) + ' ' + f(cy + k) + ' ' + f(cx + k) + ' ' + f(cy + r) + ' ' + f(cx) + ' ' + f(cy + r) +
               ' C ' + f(cx - k) + ' ' + f(cy + r) + ' ' + f(cx - r) + ' ' + f(cy + k) + ' ' + f(cx - r) + ' ' + f(cy) +
               ' C ' + f(cx - r) + ' ' + f(cy - k) + ' ' + f(cx - k) + ' ' + f(cy - r) + ' ' + f(cx) + ' ' + f(cy - r) +
               ' C ' + f(cx + k) + ' ' + f(cy - r) + ' ' + f(cx + r) + ' ' + f(cy - k) + ' ' + f(cx + r) + ' ' + f(cy) +
               ' Z';
    }

    /* A "blob limb": a chain of overlapping circles from (ax,ay) to
       (bx,by), radius ar→br (tapered if they differ). Union of the
       circles is a smooth tube with rounded ends — no arc flags
       anywhere. Spacing ≤ ~0.6·r keeps the union scallop-free. */
    function blobLimb(ax, ay, bx, by, ar, br) {
        if (br == null) br = ar;
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(2, Math.ceil(len / (Math.min(ar, br) * 0.6)));
        let d = '';
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            d += circleBezier(ax + (bx - ax) * t, ay + (by - ay) * t, ar + (br - ar) * t) + ' ';
        }
        return d;
    }

    function groodleBodyPath(sk) {
        const h = sk.head, cx = h.x;
        const shY = sk.shoulderY, shHW = sk.shoulderHW;
        const hipY = sk.hipY, hipHW = sk.hipHW;
        const aw = sk.armW, lw = sk.legW;

        /* Head — one circle. */
        const head = circleBezier(h.x, h.y, h.r);

        /* Torso — a tapered circle column from just under the head to
           the hip line; slightly wider at the chest than the hips so
           it reads as a body, not a tube. The top circles overlap the
           head (no neck seam); the bottom overlaps the leg roots. */
        const torso = blobLimb(cx, shY - 6, cx, hipY + 6, shHW * 0.92, hipHW * 1.04);

        /* Arms root inside the torso so the shoulder is a seamless
           blend, then taper slightly out to the hands. */
        const armR = blobLimb(cx + shHW * 0.42, shY + 8, sk.handR.x, sk.handR.y, aw * 1.05, aw * 0.82);
        const armL = blobLimb(cx - shHW * 0.42, shY + 8, sk.handL.x, sk.handL.y, aw * 1.05, aw * 0.82);

        /* Legs root up inside the torso (above the hip line, no hip
           seam); they spread to the feet so below the torso the two
           chains separate into distinct legs with real daylight
           between them. */
        const legR = blobLimb(cx + hipHW * 0.4, hipY - 30, sk.footR.x, sk.footR.y, lw * 1.05, lw * 0.9);
        const legL = blobLimb(cx - hipHW * 0.4, hipY - 30, sk.footL.x, sk.footL.y, lw * 1.05, lw * 0.9);

        return head + ' ' + torso + armR + armL + legR + legL;
    }

    function posePathD(pose) {
        if (pose.path) return pose.path;
        if (pose.skeleton) return groodleBodyPath(pose.skeleton);
        return '';
    }

    const TEMPO = 112;
    const STEPS_PER_BAR = 16;
    const BARS_PER_LOOP = 4;
    const SECONDS_PER_STEP = (60 / TEMPO) / 4;

    const MOVES = ['BOUNCE', 'TWIST', 'DISCO', 'PARTY'];
    const BEATS = ['BOOM', 'FUNKY', 'SHUFFLE', 'WILD'];

    /* ============ PERSISTENCE ============

       Single versioned localStorage key holds the whole progression
       snapshot: currency, counters, achievement unlocks, hat inventory.
       Schema bumps go via a new STATE_KEY (groodle.state.v2 etc.) so old
       saves never silently overwrite with the wrong shape; mergeDefaults
       fills in any new top-level fields added between schema-compatible
       v1 saves without nuking the user's accumulated state. */

    const STATE_KEY = 'groodle.state.v1';

    const DEFAULT_STATE = {
        doodles: 0,
        achievements: {},
        counters: {
            strokes: 0,
            drawingsFinished: 0,
            colorsUsedThisDrawing: [],
            colorsUsedEver: [],
            beatsExperienced: [],
            hasUsedEraser: false,
            hasUsedSurprise: false,
            lastVisitDate: null,
            longestDanceSec: 0,
            pagesCompleted: []
        },
        hats: {
            owned: ['no-hat'],
            equipped: 'no-hat'
        },
        accessories: {
            owned: ['no-accessory'],
            equipped: 'no-accessory'
        },
        pose: 'standing'
    };

    let state = null;
    let danceSessionStart = 0;
    /* True for the current session only when trackVisit detected a real
       calendar-day rollover (last visit non-null AND != today). The
       Bedhead predicate reads this flag — it's deliberately not in
       state.counters because the achievement should unlock for *this*
       returning visit, not stay perpetually true. */
    let bedheadEligible = false;

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    function mergeDefaults(saved, defaults) {
        /* Recursive deep merge: pull missing keys from defaults so a new
           field added in a later schema-compatible release shows up for
           returning users; preserve any extra keys the user already has. */
        if (defaults === null || typeof defaults !== 'object') return saved;
        if (Array.isArray(defaults)) {
            return Array.isArray(saved) ? saved : defaults.slice();
        }
        if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
            return clone(defaults);
        }
        const out = {};
        for (const key in defaults) {
            out[key] = (key in saved)
                ? mergeDefaults(saved[key], defaults[key])
                : clone(defaults[key]);
        }
        for (const key in saved) {
            if (!(key in out)) out[key] = saved[key];
        }
        return out;
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            if (!raw) return clone(DEFAULT_STATE);
            return mergeDefaults(JSON.parse(raw), DEFAULT_STATE);
        } catch (e) {
            /* localStorage disabled, full quota, or corrupt JSON — fall
               back to defaults so the game still works (in-memory only). */
            return clone(DEFAULT_STATE);
        }
    }

    function saveState() {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
        catch (e) { /* quota / private mode — fail silent, in-memory only */ }
    }

    function todayKey() {
        const d = new Date();
        return d.getFullYear()
            + '-' + String(d.getMonth() + 1).padStart(2, '0')
            + '-' + String(d.getDate()).padStart(2, '0');
    }

    /* ============ COUNTERS ============

       Thin wrappers around state.counters mutations. Each writes through
       to localStorage immediately — saves are sub-millisecond on modern
       devices and there's no realistic frequency at which a kid can
       cause contention. Future commits add achievement-unlock checks
       inside these functions; for now they only update the snapshot. */

    function trackStroke() {
        state.counters.strokes += 1;
        saveState();
        checkAchievements();
    }
    function trackColorUsed(color) {
        const c = state.counters;
        let dirty = false;
        if (c.colorsUsedThisDrawing.indexOf(color) === -1) {
            c.colorsUsedThisDrawing.push(color);
            dirty = true;
        }
        if (c.colorsUsedEver.indexOf(color) === -1) {
            c.colorsUsedEver.push(color);
            dirty = true;
        }
        if (dirty) {
            saveState();
            checkAchievements();
        }
    }
    function trackEraserUsed() {
        if (state.counters.hasUsedEraser) return;
        state.counters.hasUsedEraser = true;
        saveState();
        checkAchievements();
    }
    function trackSurpriseUsed() {
        if (state.counters.hasUsedSurprise) return;
        state.counters.hasUsedSurprise = true;
        saveState();
        checkAchievements();
    }
    function trackDrawingFinished() {
        state.counters.drawingsFinished += 1;
        state.counters.colorsUsedThisDrawing = [];
        saveState();
        checkAchievements();
    }
    function trackClearDrawing() {
        state.counters.colorsUsedThisDrawing = [];
        saveState();
        /* No achievement check here — clearing only removes progress
           toward Rainbow Day; it can't unlock anything. */
    }
    function trackBeatExperienced(beat) {
        if (state.counters.beatsExperienced.indexOf(beat) !== -1) return;
        state.counters.beatsExperienced.push(beat);
        saveState();
        checkAchievements();
    }
    function trackDanceSession(seconds) {
        if (seconds > state.counters.longestDanceSec) {
            state.counters.longestDanceSec = seconds;
            saveState();
            checkAchievements();
        }
    }
    function trackVisit() {
        const today = todayKey();
        const last = state.counters.lastVisitDate;
        if (last !== today) {
            if (last !== null) bedheadEligible = true;
            state.counters.lastVisitDate = today;
            saveState();
        }
    }

    /* ============ CURRENCY ============ */

    let currencyValueEl = null;
    let currencyPillEl = null;

    function renderCurrency() {
        if (currencyValueEl) currencyValueEl.textContent = String(state.doodles);
    }

    function addDoodles(n) {
        if (!n) return;
        state.doodles = Math.max(0, state.doodles + n);
        saveState();
        renderCurrency();
        if (currencyPillEl && n > 0) {
            currencyPillEl.classList.remove('bump');
            /* force reflow so the animation restarts even if it fires
               twice in quick succession (e.g. two achievements unlocking
               back-to-back). */
            void currencyPillEl.offsetWidth;
            currencyPillEl.classList.add('bump');
        }
    }

    /* ============ ACHIEVEMENTS ============

       Static catalog: each entry has an id (used as the storage key
       inside state.achievements), a display title + one-line desc, the
       Doodles reward, an emoji icon, and a `check` predicate that's a
       pure function of state + the bedheadEligible session flag.

       The unlock engine just iterates the catalog after every counter
       mutation; predicates that are already-unlocked are skipped, and
       newly-true ones fire the toast + addDoodles. */

    const FULL_LOOP_SEC = BARS_PER_LOOP * STEPS_PER_BAR * SECONDS_PER_STEP;

    const ACHIEVEMENTS = [
        { id: 'first-groodle',    title: 'First Groodle',    desc: 'Finish your first drawing.',         reward: 10, icon: '🎨',
          check: () => state.counters.drawingsFinished >= 1 },
        { id: 'five-groodles',    title: 'Five Groodles',    desc: 'Finish five drawings.',              reward: 25, icon: '🖼️',
          check: () => state.counters.drawingsFinished >= 5 },
        { id: 'rainbow-day',      title: 'Rainbow Day',      desc: 'Use every color in one drawing.',    reward: 30, icon: '🌈',
          check: () => state.counters.colorsUsedThisDrawing.length >= COLORS.length },
        { id: 'eraser-apprentice',title: 'Eraser Apprentice',desc: 'Use the eraser tool.',                reward:  5, icon: '🧽',
          check: () => state.counters.hasUsedEraser },
        { id: 'beat-boom',        title: 'Beat BOOM',        desc: 'Dance to the BOOM beat.',             reward: 10, icon: '🥁',
          check: () => state.counters.beatsExperienced.indexOf('BOOM') !== -1 },
        { id: 'beat-funky',       title: 'Beat FUNKY',       desc: 'Dance to the FUNKY beat.',            reward: 10, icon: '🎷',
          check: () => state.counters.beatsExperienced.indexOf('FUNKY') !== -1 },
        { id: 'beat-shuffle',     title: 'Beat SHUFFLE',     desc: 'Dance to the SHUFFLE beat.',          reward: 10, icon: '🪩',
          check: () => state.counters.beatsExperienced.indexOf('SHUFFLE') !== -1 },
        { id: 'beat-wild',        title: 'Beat WILD',        desc: 'Dance to the WILD beat.',             reward: 10, icon: '🎸',
          check: () => state.counters.beatsExperienced.indexOf('WILD') !== -1 },
        { id: 'all-beat-champion',title: 'All-Beat Champion',desc: 'Dance to all four beats.',            reward: 25, icon: '🏆',
          check: () => state.counters.beatsExperienced.length >= BEATS.length },
        { id: 'dance-floor',      title: 'Dance Floor',      desc: 'Dance for a full song without stopping.', reward: 20, icon: '🕺',
          check: () => state.counters.longestDanceSec >= FULL_LOOP_SEC },
        { id: 'bedhead',          title: 'Bedhead',          desc: 'Come back the next day.',             reward: 30, icon: '😴',
          check: () => bedheadEligible },
        { id: 'doodler',          title: 'Doodler',          desc: 'Make 100 brush strokes.',              reward: 25, icon: '✏️',
          check: () => state.counters.strokes >= 100 },
        { id: 'big-doodler',      title: 'Big Doodler',      desc: 'Make 500 brush strokes.',              reward: 50, icon: '🖌️',
          check: () => state.counters.strokes >= 500 },
        { id: 'color-curator',    title: 'Color Curator',    desc: 'Try 8 different colors across your drawings.', reward: 20, icon: '🎭',
          check: () => state.counters.colorsUsedEver.length >= 8 },
        { id: 'surprise-hat',     title: 'Surprise Hat',     desc: 'Discover the SURPRISE button.',        reward: 15, icon: '🎲',
          check: () => state.counters.hasUsedSurprise },
        /* Coloring-book page completions. Each unlocks the FIRST time the
           kid hits DANCE while that page template is on the canvas; the
           predicate reads from state.counters.pagesCompleted which is
           appended to inside startDance(). */
        { id: 'page-robot',       title: 'Robo-Doodler',     desc: 'Color the Robot page.',                reward: 15, icon: '🤖',
          check: () => state.counters.pagesCompleted.indexOf('robot') !== -1 },
        { id: 'page-princess',    title: 'Royal Crayon',     desc: 'Color the Princess page.',             reward: 15, icon: '👑',
          check: () => state.counters.pagesCompleted.indexOf('princess') !== -1 },
        { id: 'page-astronaut',   title: 'Space Doodler',    desc: 'Color the Astronaut page.',            reward: 15, icon: '🚀',
          check: () => state.counters.pagesCompleted.indexOf('astronaut') !== -1 },
        { id: 'page-clown',       title: 'Big-Top Star',     desc: 'Color the Clown page.',                reward: 15, icon: '🤡',
          check: () => state.counters.pagesCompleted.indexOf('clown') !== -1 },
        { id: 'page-pirate',      title: 'Yarrr-tist',       desc: 'Color the Pirate page.',               reward: 15, icon: '🏴‍☠️',
          check: () => state.counters.pagesCompleted.indexOf('pirate') !== -1 },
        { id: 'page-superhero',   title: 'Caped Coloring',   desc: 'Color the Superhero page.',            reward: 15, icon: '🦸',
          check: () => state.counters.pagesCompleted.indexOf('superhero') !== -1 },
        { id: 'page-master',      title: 'Coloring Master',  desc: 'Finish every coloring-book page.',     reward: 50, icon: '📖',
          check: () => state.counters.pagesCompleted.length >= 6 }
    ];

    const ACHIEVEMENT_BY_ID = {};
    ACHIEVEMENTS.forEach(a => { ACHIEVEMENT_BY_ID[a.id] = a; });

    function isUnlocked(id) {
        const rec = state.achievements[id];
        return !!(rec && rec.unlocked);
    }

    function unlockAchievement(ach) {
        if (isUnlocked(ach.id)) return;
        state.achievements[ach.id] = { unlocked: true, ts: Date.now() };
        saveState();
        addDoodles(ach.reward);
        showAchievementToast(ach);
        /* If the board is currently open, refresh it so the user sees the
           card flip from locked to unlocked while looking at it. */
        if (achievementsModalEl && !achievementsModalEl.hidden) {
            renderAchievementBoard();
        }
    }

    function checkAchievements() {
        if (!state) return;
        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            if (isUnlocked(a.id)) continue;
            try {
                if (a.check()) unlockAchievement(a);
            } catch (e) { /* defensive: a malformed predicate can't take
                             down the whole engine */ }
        }
    }

    /* ============ TOAST ============

       Single-file queue: only one toast on screen at a time so they
       don't overlap visually. Subsequent unlocks wait their turn. */

    let toastContainerEl = null;
    const toastQueue = [];
    let toastBusy = false;

    function showAchievementToast(ach) {
        toastQueue.push(ach);
        if (!toastBusy) drainToastQueue();
    }

    function drainToastQueue() {
        if (toastQueue.length === 0) { toastBusy = false; return; }
        toastBusy = true;
        const ach = toastQueue.shift();
        const el = document.createElement('div');
        el.className = 'achievement-toast';
        el.setAttribute('role', 'status');
        el.innerHTML =
            '<div class="toast-icon" aria-hidden="true"></div>' +
            '<div class="toast-body">' +
                '<div class="toast-meta">Achievement unlocked</div>' +
                '<div class="toast-title"></div>' +
                '<div class="toast-reward"></div>' +
            '</div>';
        /* textContent assignment instead of building the string with the
           ach values directly — keeps user-visible strings safe even if a
           future achievement title contains characters HTML cares about. */
        el.querySelector('.toast-icon').textContent = ach.icon;
        el.querySelector('.toast-title').textContent = ach.title;
        el.querySelector('.toast-reward').textContent = '+' + ach.reward + ' 🪙';
        toastContainerEl.appendChild(el);
        /* next frame: let the browser paint the start state then add
           .show so the transition runs. */
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('show'));
        });
        setTimeout(() => {
            el.classList.remove('show');
            el.classList.add('hide');
            setTimeout(() => {
                el.remove();
                drainToastQueue();
            }, 400);
        }, 2800);
    }

    /* ============ MODAL ============

       Generic open/close used by the achievements board and (next
       commit) the hat shop. Click outside the sheet (anything tagged
       data-close="1") dismisses. Escape closes. Body scroll is locked
       while open. */

    let openModalEl = null;

    function openModal(el) {
        if (!el || openModalEl === el) return;
        if (openModalEl) closeModal();
        openModalEl = el;
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        document.documentElement.classList.add('modal-open');
        /* Two RAFs so the browser commits hidden=false + initial
           transforms before we trigger the .open transition. */
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('open'));
        });
    }

    function closeModal() {
        if (!openModalEl) return;
        const el = openModalEl;
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        document.documentElement.classList.remove('modal-open');
        openModalEl = null;
        /* Wait out the slide-down transition before hiding so the sheet
           animates away rather than snapping. Matches .modal-sheet's
           transition duration with a small buffer. */
        setTimeout(() => { if (!openModalEl) el.hidden = true; }, 360);
    }

    function attachModalDismissers(el) {
        el.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('[data-close="1"]')) closeModal();
        });
    }

    /* ============ DRAWER ============

       Slide-up bottom-sheet panels for the floating tool dock. Only
       one drawer is open at a time; openDrawer() switches between
       them. Closes on:
         * tap of [data-drawer-close="1"] (the X or the dim backdrop),
         * tap of a different dock button (handled by openDrawer
           switching to that drawer),
         * tap of the same dock button again (toggle off),
         * Escape key (global handler in init),
         * entering dance mode (startDance calls closeDrawer). */

    let drawerHostEl = null;
    let openDrawerEl = null;
    let activeDockBtn = null;

    function openDrawer(id) {
        const el = id ? document.getElementById('drawer' + id.charAt(0).toUpperCase() + id.slice(1)) : null;
        if (!el) return;
        if (openDrawerEl === el) { closeDrawer(); return; }
        if (openDrawerEl) closeDrawer({ instant: true });
        openDrawerEl = el;
        if (drawerHostEl) {
            drawerHostEl.hidden = false;
            drawerHostEl.setAttribute('aria-hidden', 'false');
            drawerHostEl.classList.add('open');
        }
        el.hidden = false;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('open'));
        });
        /* Mark whichever dock button has data-drawer=id as active so
           the user has visual feedback on which drawer is open. */
        const btn = document.querySelector('.dock-btn[data-drawer="' + id + '"]');
        if (activeDockBtn) activeDockBtn.classList.remove('active');
        activeDockBtn = btn;
        if (btn) btn.classList.add('active');
    }

    function closeDrawer(opts) {
        if (!openDrawerEl) return;
        const el = openDrawerEl;
        el.classList.remove('open');
        openDrawerEl = null;
        if (activeDockBtn) { activeDockBtn.classList.remove('active'); activeDockBtn = null; }
        const finishHide = () => {
            if (!openDrawerEl) {
                el.hidden = true;
                if (drawerHostEl) {
                    drawerHostEl.classList.remove('open');
                    drawerHostEl.hidden = true;
                    drawerHostEl.setAttribute('aria-hidden', 'true');
                }
            }
        };
        if (opts && opts.instant) finishHide();
        else setTimeout(finishHide, 320);
    }

    function attachDrawerHostDismissers() {
        if (!drawerHostEl) return;
        drawerHostEl.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('[data-drawer-close="1"]')) closeDrawer();
        });
    }

    function attachDockButtons() {
        document.querySelectorAll('.dock-btn[data-drawer]').forEach((btn) => {
            btn.addEventListener('click', () => openDrawer(btn.getAttribute('data-drawer')));
        });
    }

    /* The dock is icon-only. Desktop gets the label tooltip via CSS
       :hover; touch devices have no hover, so a long-press (~450 ms
       hold without moving) reveals the label by toggling .show-tip.
       The tooltip clears on release / cancel / drag so it never
       lingers. The button's click still fires on release — holding to
       peek at the label and then triggering the action is acceptable
       (and discoverable) for a kids' app; gating the click would add
       a surprising "nothing happened" failure mode. */
    function attachDockTooltips() {
        const HOLD_MS = 450;
        document.querySelectorAll('.dock-btn').forEach((btn) => {
            let timer = null;
            let startX = 0, startY = 0;
            const clear = () => {
                if (timer) { clearTimeout(timer); timer = null; }
                btn.classList.remove('show-tip');
            };
            btn.addEventListener('pointerdown', (e) => {
                startX = e.clientX;
                startY = e.clientY;
                timer = setTimeout(() => {
                    btn.classList.add('show-tip');
                }, HOLD_MS);
            });
            btn.addEventListener('pointermove', (e) => {
                /* A real long-press holds still. If the finger travels
                   more than a few px it's a scroll / drag — cancel so
                   the tooltip doesn't pop mid-gesture. */
                if (Math.abs(e.clientX - startX) > 8 ||
                    Math.abs(e.clientY - startY) > 8) {
                    clear();
                }
            });
            btn.addEventListener('pointerup', clear);
            btn.addEventListener('pointercancel', clear);
            btn.addEventListener('pointerleave', clear);
        });
    }

    /* ============ ACHIEVEMENT BOARD ============ */

    let achievementsModalEl = null;
    let achievementsListEl = null;
    let achievementsStatsEl = null;

    function renderAchievementBoard() {
        if (!achievementsListEl) return;
        const unlockedCount = ACHIEVEMENTS.filter(a => isUnlocked(a.id)).length;
        achievementsStatsEl.textContent =
            unlockedCount + ' / ' + ACHIEVEMENTS.length + ' unlocked';
        achievementsListEl.innerHTML = '';
        /* Unlocked first, then locked in catalog order. Within unlocked,
           sort by unlock timestamp descending so the most recent appears
           at the top — kids like seeing what they just earned. */
        const sorted = ACHIEVEMENTS.slice().sort((a, b) => {
            const au = isUnlocked(a.id), bu = isUnlocked(b.id);
            if (au !== bu) return au ? -1 : 1;
            if (au && bu) {
                return (state.achievements[b.id].ts || 0) - (state.achievements[a.id].ts || 0);
            }
            return ACHIEVEMENTS.indexOf(a) - ACHIEVEMENTS.indexOf(b);
        });
        for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            const unlocked = isUnlocked(a.id);
            const card = document.createElement('div');
            card.className = 'ach-card ' + (unlocked ? 'unlocked' : 'locked');
            card.innerHTML =
                '<div class="ach-icon" aria-hidden="true"></div>' +
                '<div class="ach-body">' +
                    '<div class="ach-title"></div>' +
                    '<div class="ach-desc"></div>' +
                '</div>' +
                '<div class="ach-reward"></div>';
            card.querySelector('.ach-icon').textContent = unlocked ? a.icon : '🔒';
            card.querySelector('.ach-title').textContent = a.title;
            card.querySelector('.ach-desc').textContent = a.desc;
            card.querySelector('.ach-reward').textContent = '+' + a.reward + ' 🪙';
            achievementsListEl.appendChild(card);
        }
    }

    function openAchievements() {
        renderAchievementBoard();
        openModal(achievementsModalEl);
    }

    /* ============ HATS ============

       Catalog of 16 purchasable hats + a free 'no-hat' default. All
       artwork lives in a single PNG spritesheet at
       assets/sprites/hats.png with per-frame coordinates inlined in
       HAT_FRAMES below (mirrors assets/sprites/hats.json — regenerate
       this block when the sheet changes).

       Positioning convention (renderEquippedHat applies via
       hatImageMarkup):
         * Sprite's bottom-center is the anchor reference point.
         * That point lands at the head crown (canvas 200, 42) shifted
           by anchor.x / anchor.y.
         * scale multiplies each frame's natural pixel dimensions.

       Rendering uses a nested <svg> with its own viewBox = the frame
       sub-rect of the sheet. The inner <image> draws the full sheet at
       0,0, and the inner viewBox windows the visible region down to
       the desired frame — same trick the other Madderverse games use
       for spritesheets. No <pattern>, no clip-path.

       The hat-layer SVG isn't clipped, so hat content is allowed to
       extend outside the body silhouette. Hats follow the dance
       transforms because the SVG element is a child of .creature. */

    const HEAD_CROWN_X = 200;
    const HEAD_CROWN_Y = 42;

    const HAT_SHEET_URL = 'assets/sprites/hats.png';
    const HAT_SHEET_W = 874;
    const HAT_SHEET_H = 963;

    /* Frame coordinates inlined from assets/sprites/hats.json. If the
       sheet is re-exported with shifted frames, regenerate this object. */
    const HAT_FRAMES = {
        'gelatinous-cube': { x:   2, y:   2, w: 216, h: 223 },
        'giggle-boot':     { x: 220, y:   2, w: 216, h: 201 },
        'graph-paper':     { x: 438, y:   2, w: 216, h: 138 },
        'gross-out':       { x: 656, y:   2, w: 216, h: 171 },
        'haunted-house':   { x:   2, y: 227, w: 216, h: 212 },
        'metal-gears':     { x: 220, y: 227, w: 216, h: 158 },
        'rocket-ship':     { x: 438, y: 227, w: 216, h: 283 },
        'scanner-chic':    { x: 656, y: 227, w: 216, h: 220 },
        'slime-rancher':   { x:   2, y: 512, w: 216, h: 137 },
        'the-worminal':    { x: 220, y: 512, w: 216, h: 120 },
        'tower-defense':   { x: 438, y: 512, w: 216, h: 170 },
        'candy-bowl':      { x: 656, y: 512, w: 216, h: 225 },
        'circuit-board':   { x:   2, y: 739, w: 216, h: 222 },
        'cool-kids':       { x: 220, y: 739, w: 216, h: 160 },
        'friend-picker':   { x: 438, y: 739, w: 216, h: 139 },
        'funky-fresh':     { x: 656, y: 739, w: 216, h: 196 }
    };

    /* Prices ramp from 20 → 130 roughly with visual complexity. anchor.y
       values are calibrated for the sheet shipped at assets/sprites/
       hats.json, which is trimmed: false — each frame carries built-in
       transparent bottom padding (where the wearer's head sits in the
       source artwork). Bottom-center anchoring would otherwise float
       the visible hat content well above the head crown, so anchor.y
       values are generous (≈80-100) to push the sprite far enough down
       that the visible artwork lands on the head. Outliers:
         - rocket-ship / giggle-boot: tall narrow standing sprites,
           smaller anchor pulls them up so the rocket / boot rests on
           the crown rather than going off the top.
         - gelatinous-cube: meant to engulf the head, anchored deeper.
         - cool-kids: cap + sunglasses, anchored deeper so the lenses
           land at the eye line. */
    const HATS = [
        { id: 'no-hat',          name: 'No Hat',          price:   0, sprite: null,              anchor: { x: 0, y:   0 }, scale: 1.00 },
        { id: 'funky-fresh',     name: 'Funky Fresh',     price:  20, sprite: 'funky-fresh',     anchor: { x: 0, y:  80 }, scale: 0.65 },
        { id: 'graph-paper',     name: 'Graph Paper',     price:  25, sprite: 'graph-paper',     anchor: { x: 0, y:  65 }, scale: 0.65 },
        { id: 'friend-picker',   name: 'Friend Picker',   price:  30, sprite: 'friend-picker',   anchor: { x: 0, y:  55 }, scale: 0.70 },
        { id: 'cool-kids',       name: 'Cool Kids',       price:  35, sprite: 'cool-kids',       anchor: { x: 5, y:  80 }, scale: 0.65 },
        { id: 'slime-rancher',   name: 'Slime Rancher',   price:  45, sprite: 'slime-rancher',   anchor: { x: 0, y:  80 }, scale: 0.70 },
        { id: 'giggle-boot',     name: 'Giggle Boot',     price:  50, sprite: 'giggle-boot',     anchor: { x: 0, y:  45 }, scale: 0.55 },
        { id: 'candy-bowl',      name: 'Candy Bowl',      price:  55, sprite: 'candy-bowl',      anchor: { x: 0, y:  65 }, scale: 0.65 },
        { id: 'metal-gears',     name: 'Metal Gears',     price:  60, sprite: 'metal-gears',     anchor: { x: 0, y:  55 }, scale: 0.70 },
        { id: 'the-worminal',    name: 'The Worminal',    price:  65, sprite: 'the-worminal',    anchor: { x: 0, y:  50 }, scale: 0.70 },
        { id: 'rocket-ship',     name: 'Rocket Ship',     price:  75, sprite: 'rocket-ship',     anchor: { x: 0, y:  65 }, scale: 0.50 },
        { id: 'gross-out',       name: 'Gross-Out',       price:  80, sprite: 'gross-out',       anchor: { x: 0, y:  85 }, scale: 0.70 },
        { id: 'gelatinous-cube', name: 'Gelatinous Cube', price:  90, sprite: 'gelatinous-cube', anchor: { x: 0, y: 120 }, scale: 0.65 },
        { id: 'haunted-house',   name: 'Haunted House',   price:  95, sprite: 'haunted-house',   anchor: { x: 0, y:  60 }, scale: 0.60 },
        { id: 'scanner-chic',    name: 'Scanner Chic',    price: 105, sprite: 'scanner-chic',    anchor: { x: 0, y:  75 }, scale: 0.65 },
        { id: 'circuit-board',   name: 'Circuit Board',   price: 115, sprite: 'circuit-board',   anchor: { x: 0, y: 120 }, scale: 0.65 },
        { id: 'tower-defense',   name: 'Tower Defense',   price: 130, sprite: 'tower-defense',   anchor: { x: 0, y: 120 }, scale: 0.70 }
    ];

    const HAT_BY_ID = {};
    HATS.forEach(h => { HAT_BY_ID[h.id] = h; });

    /* Build the SVG markup that places a hat from the sheet at the
       correct canvas-coordinate rect. Used for both the in-stage hat
       layer and the hat-shop preview cards (which crop their outer
       viewBox to a smaller window but share this coordinate space).
       Returns '' for no-hat or any frame missing from HAT_FRAMES so
       the caller can no-op. */
    function hatImageMarkup(hat) {
        if (!hat || !hat.sprite) return '';
        const frame = HAT_FRAMES[hat.sprite];
        if (!frame) return '';
        const w = frame.w * hat.scale;
        const h = frame.h * hat.scale;
        const x = HEAD_CROWN_X + hat.anchor.x - w / 2;
        const y = HEAD_CROWN_Y + hat.anchor.y - h;
        return '<svg' +
            ' x="' + x.toFixed(2) + '"' +
            ' y="' + y.toFixed(2) + '"' +
            ' width="' + w.toFixed(2) + '"' +
            ' height="' + h.toFixed(2) + '"' +
            ' viewBox="' + frame.x + ' ' + frame.y + ' ' + frame.w + ' ' + frame.h + '"' +
            ' preserveAspectRatio="xMidYMid meet"' +
            '>' +
            '<image href="' + HAT_SHEET_URL + '"' +
                ' x="0" y="0" width="' + HAT_SHEET_W + '" height="' + HAT_SHEET_H + '"' +
            '/>' +
            '</svg>';
    }

    /* In-game (.creature) hat layer. Updated on equip / load / surprise.
       Surprise repaints the canvas but never touches the hat layer, so
       a kid's hat survives across SURPRISE / CLEAR / DANCE transitions. */
    let hatLayerInnerEl = null;

    function renderEquippedHat() {
        if (!hatLayerInnerEl) return;
        const hat = HAT_BY_ID[state.hats.equipped] || HAT_BY_ID['no-hat'];
        hatLayerInnerEl.innerHTML = hatImageMarkup(hat);
    }

    function buyHat(id) {
        const hat = HAT_BY_ID[id];
        if (!hat) return;
        const alreadyOwned = state.hats.owned.indexOf(id) !== -1;
        if (alreadyOwned) { equipHat(id); return; }
        if (hat.price > 0 && state.doodles < hat.price) return;
        state.doodles -= hat.price;
        state.hats.owned.push(id);
        state.hats.equipped = id;
        saveState();
        renderCurrency();
        renderEquippedHat();
        buildHatShopGrid();
    }

    function equipHat(id) {
        if (state.hats.owned.indexOf(id) === -1) return;
        state.hats.equipped = id;
        saveState();
        renderEquippedHat();
        buildHatShopGrid();
    }

    /* ============ HAT SHOP UI ============ */

    let hatShopModalEl = null;
    let hatShopGridEl = null;
    let hatShopBalanceEl = null;

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function buildHatShopGrid() {
        if (!hatShopGridEl) return;
        if (hatShopBalanceEl) {
            hatShopBalanceEl.textContent = '🪙 ' + state.doodles + ' Doodles';
        }
        hatShopGridEl.innerHTML = '';
        for (let i = 0; i < HATS.length; i++) {
            const hat = HATS[i];
            const owned = state.hats.owned.indexOf(hat.id) !== -1;
            const equipped = state.hats.equipped === hat.id;
            const affordable = state.doodles >= hat.price;

            const card = document.createElement('div');
            card.className = 'hat-card';
            if (equipped) card.classList.add('equipped');
            else if (owned) card.classList.add('owned');
            else if (!affordable && hat.price > 0) card.classList.add('locked');

            /* The preview is a mini-Groodle: same wash circle for the
               head as the in-stage figure, then the hat <image> sprite
               on top. viewBox crops to the upper body so the hat
               dominates the card. */
            const previewSvg =
                '<svg class="hat-preview" viewBox="60 -90 280 280" aria-hidden="true">' +
                    '<circle cx="200" cy="100" r="58" fill="rgba(232, 232, 244, 0.94)" stroke="#1a0f33" stroke-width="3"/>' +
                    hatImageMarkup(hat) +
                '</svg>';

            let actionHtml;
            if (equipped) {
                actionHtml = '<button class="hat-action equipped-tag" type="button" disabled>✓ Equipped</button>';
            } else if (owned) {
                actionHtml = '<button class="hat-action own" type="button" data-action="equip">Wear</button>';
            } else if (hat.price === 0) {
                /* No-Hat row when not currently equipped — treat as a
                   free equip (price 0). */
                actionHtml = '<button class="hat-action own" type="button" data-action="buy">Wear</button>';
            } else if (affordable) {
                actionHtml = '<button class="hat-action buy" type="button" data-action="buy">Buy &nbsp;' + hat.price + ' 🪙</button>';
            } else {
                actionHtml = '<button class="hat-action locked-tag" type="button" disabled>🔒 ' + hat.price + ' 🪙</button>';
            }

            card.innerHTML = previewSvg +
                '<div class="hat-name">' + escapeHtml(hat.name) + '</div>' +
                actionHtml;

            const btn = card.querySelector('button[data-action]');
            if (btn) {
                btn.addEventListener('click', () => {
                    if (btn.dataset.action === 'equip') equipHat(hat.id);
                    else buyHat(hat.id);
                });
            }

            hatShopGridEl.appendChild(card);
        }
    }

    function openHatShop() {
        buildHatShopGrid();
        buildAccessoryShopGrid();
        openModal(hatShopModalEl);
    }

    /* ============ ACCESSORIES ============

       Second wardrobe layer above hats — glasses, mustaches, capes,
       bow ties, etc. Same buy-with-Doodles + equip flow as hats; same
       SVG-overlay rendering pattern except each accessory is INLINE
       SVG (no shared sprite atlas to ship). The accessory's local
       coordinate space is centered on (0,0); render code translates
       to the named anchor point on the figure and applies the
       accessory's scale.

       Anchors are absolute coordinates that line up with the standard
       humanoid silhouette (standing / cheer / star / groovy / t-pose /
       wave). For non-humanoid poses (ghost, animal) the accessory
       still renders at the anchor coordinate but may not land on a
       meaningful body part — accept that as v1 and revisit if it
       comes up. */

    const ACCESSORY_ANCHORS = {
        eyes:      { x: 200, y:  92 },
        mouth:     { x: 200, y: 122 },
        chin:      { x: 200, y: 150 },
        shoulders: { x: 200, y: 175 },
        chest:     { x: 200, y: 250 }
    };

    const ACCESSORIES = [
        { id: 'no-accessory', name: 'Nothing',          price:   0, emoji: '🚫', anchor: 'eyes',      scale: 1, svg: '' },
        {
            id: 'round-specs', name: 'Round Specs',     price:  20, emoji: '🤓', anchor: 'eyes',      scale: 1,
            svg: '<g stroke="#1a0f33" stroke-width="3" fill="none">' +
                 '<circle cx="-18" cy="0" r="13"/>' +
                 '<circle cx="18" cy="0" r="13"/>' +
                 '<line x1="-5" y1="0" x2="5" y2="0"/>' +
                 '</g>'
        },
        {
            id: 'star-shades', name: 'Star Shades',     price:  40, emoji: '⭐', anchor: 'eyes',      scale: 1,
            svg: '<g fill="#ffd23f" stroke="#1a0f33" stroke-width="2.5">' +
                 '<polygon points="-18,-12 -14,-3 -4,-3 -12,4 -8,13 -18,7 -28,13 -24,4 -32,-3 -22,-3"/>' +
                 '<polygon points="18,-12 22,-3 32,-3 24,4 28,13 18,7 8,13 12,4 4,-3 14,-3"/>' +
                 '<line x1="-5" y1="0" x2="5" y2="0"/>' +
                 '</g>'
        },
        {
            id: 'heart-shades', name: 'Heart Shades',   price:  40, emoji: '💖', anchor: 'eyes',      scale: 1,
            svg: '<g fill="#ff6ec7" stroke="#1a0f33" stroke-width="2.5">' +
                 '<path d="M -18,-6 C -22,-12 -32,-10 -32,-2 C -32,5 -18,12 -18,12 C -18,12 -4,5 -4,-2 C -4,-10 -14,-12 -18,-6 Z"/>' +
                 '<path d="M 18,-6 C 14,-12 4,-10 4,-2 C 4,5 18,12 18,12 C 18,12 32,5 32,-2 C 32,-10 22,-12 18,-6 Z"/>' +
                 '</g>'
        },
        {
            id: 'mustache', name: 'Mustache',           price:  25, emoji: '🥸', anchor: 'mouth',     scale: 1,
            svg: '<path d="M 0,0 C -8,-6 -22,-4 -28,2 C -22,8 -10,6 -4,3 L 0,3 C -4,3 -10,6 -22,8 ' +
                 'M 0,0 C 8,-6 22,-4 28,2 C 22,8 10,6 4,3 L 0,3 C 4,3 10,6 22,8" ' +
                 'fill="#3b1f6b" stroke="#1a0f33" stroke-width="2"/>'
        },
        {
            id: 'bow-tie', name: 'Bow Tie',             price:  25, emoji: '🎀', anchor: 'chin',      scale: 1,
            svg: '<g fill="#e63946" stroke="#1a0f33" stroke-width="2.5">' +
                 '<polygon points="0,0 -24,-12 -24,12"/>' +
                 '<polygon points="0,0 24,-12 24,12"/>' +
                 '<rect x="-5" y="-7" width="10" height="14" rx="2"/>' +
                 '</g>'
        },
        {
            id: 'long-beard', name: 'Long Beard',       price:  35, emoji: '🧔', anchor: 'chin',      scale: 1,
            svg: '<g fill="#6f4e37" stroke="#1a0f33" stroke-width="2.5">' +
                 '<path d="M -28,-8 C -28,18 -16,40 0,42 C 16,40 28,18 28,-8 C 16,-2 -16,-2 -28,-8 Z"/>' +
                 '</g>'
        },
        {
            id: 'superhero-cape', name: 'Hero Cape',    price:  60, emoji: '🦸', anchor: 'shoulders', scale: 1,
            svg: '<g fill="#e63946" stroke="#1a0f33" stroke-width="2.5" stroke-linejoin="round">' +
                 '<path d="M -55,-10 L -85,200 L 0,170 L 85,200 L 55,-10 L 25,0 L 0,8 L -25,0 Z"/>' +
                 '</g>'
        },
        {
            id: 'fairy-wings', name: 'Fairy Wings',     price:  70, emoji: '🧚', anchor: 'shoulders', scale: 1,
            svg: '<g fill="rgba(255, 110, 199, 0.55)" stroke="#ff6ec7" stroke-width="2.5">' +
                 '<ellipse cx="-50" cy="0" rx="40" ry="55" transform="rotate(-25 -50 0)"/>' +
                 '<ellipse cx="50" cy="0" rx="40" ry="55" transform="rotate(25 50 0)"/>' +
                 '<ellipse cx="-45" cy="60" rx="32" ry="40" transform="rotate(-15 -45 60)"/>' +
                 '<ellipse cx="45" cy="60" rx="32" ry="40" transform="rotate(15 45 60)"/>' +
                 '</g>'
        },
        {
            id: 'sheriff-badge', name: 'Sheriff Badge', price:  45, emoji: '🌟', anchor: 'chest',     scale: 1,
            svg: '<g fill="#ffd23f" stroke="#1a0f33" stroke-width="2.5">' +
                 '<polygon points="0,-22 5,-7 22,-7 9,3 14,18 0,9 -14,18 -9,3 -22,-7 -5,-7"/>' +
                 '<circle cx="0" cy="0" r="4" fill="#1a0f33"/>' +
                 '</g>'
        }
    ];

    const ACCESSORY_BY_ID = {};
    ACCESSORIES.forEach(a => { ACCESSORY_BY_ID[a.id] = a; });

    let accessoryLayerInnerEl = null;
    let accessoryShopGridEl = null;

    function accessoryMarkup(acc) {
        if (!acc || !acc.svg || acc.id === 'no-accessory') return '';
        const anchor = ACCESSORY_ANCHORS[acc.anchor] || ACCESSORY_ANCHORS.eyes;
        const s = acc.scale || 1;
        return '<g transform="translate(' + anchor.x + ',' + anchor.y + ') scale(' + s + ')">' +
               acc.svg +
               '</g>';
    }

    function renderEquippedAccessory() {
        if (!accessoryLayerInnerEl) return;
        const acc = ACCESSORY_BY_ID[state.accessories.equipped] || ACCESSORY_BY_ID['no-accessory'];
        accessoryLayerInnerEl.innerHTML = accessoryMarkup(acc);
    }

    function buyAccessory(id) {
        const acc = ACCESSORY_BY_ID[id];
        if (!acc) return;
        const alreadyOwned = state.accessories.owned.indexOf(id) !== -1;
        if (alreadyOwned) { equipAccessory(id); return; }
        if (acc.price > 0 && state.doodles < acc.price) return;
        state.doodles -= acc.price;
        state.accessories.owned.push(id);
        state.accessories.equipped = id;
        saveState();
        renderCurrency();
        renderEquippedAccessory();
        buildAccessoryShopGrid();
        buildHatShopGrid();
    }

    function equipAccessory(id) {
        if (state.accessories.owned.indexOf(id) === -1) return;
        state.accessories.equipped = id;
        saveState();
        renderEquippedAccessory();
        buildAccessoryShopGrid();
    }

    function buildAccessoryShopGrid() {
        if (!accessoryShopGridEl) return;
        if (hatShopBalanceEl) {
            hatShopBalanceEl.textContent = '🪙 ' + state.doodles + ' Doodles';
        }
        accessoryShopGridEl.innerHTML = '';
        for (let i = 0; i < ACCESSORIES.length; i++) {
            const acc = ACCESSORIES[i];
            const owned = state.accessories.owned.indexOf(acc.id) !== -1;
            const equipped = state.accessories.equipped === acc.id;
            const affordable = state.doodles >= acc.price;

            const card = document.createElement('div');
            card.className = 'hat-card';
            if (equipped) card.classList.add('equipped');
            else if (owned) card.classList.add('owned');
            else if (!affordable && acc.price > 0) card.classList.add('locked');

            /* Preview: mini-Groodle head + the accessory rendered at its
               configured anchor. Same viewBox / wash as the hat shop so
               the two tabs feel uniform. */
            const previewSvg =
                '<svg class="hat-preview" viewBox="60 -10 280 280" aria-hidden="true">' +
                    '<circle cx="200" cy="100" r="58" fill="rgba(232, 232, 244, 0.94)" stroke="#1a0f33" stroke-width="3"/>' +
                    accessoryMarkup(acc) +
                '</svg>';

            let actionHtml;
            if (equipped) {
                actionHtml = '<button class="hat-action equipped-tag" type="button" disabled>✓ Equipped</button>';
            } else if (owned) {
                actionHtml = '<button class="hat-action own" type="button" data-action="equip">Wear</button>';
            } else if (acc.price === 0) {
                actionHtml = '<button class="hat-action own" type="button" data-action="buy">Wear</button>';
            } else if (affordable) {
                actionHtml = '<button class="hat-action buy" type="button" data-action="buy">Buy &nbsp;' + acc.price + ' 🪙</button>';
            } else {
                actionHtml = '<button class="hat-action locked-tag" type="button" disabled>🔒 ' + acc.price + ' 🪙</button>';
            }

            card.innerHTML = previewSvg +
                '<div class="hat-name">' + escapeHtml(acc.name) + '</div>' +
                actionHtml;

            const btn = card.querySelector('button[data-action]');
            if (btn) {
                btn.addEventListener('click', () => {
                    if (btn.dataset.action === 'equip') equipAccessory(acc.id);
                    else buyAccessory(acc.id);
                });
            }

            accessoryShopGridEl.appendChild(card);
        }
    }

    /* ============ WARDROBE TABS ============ */

    function attachWardrobeTabs() {
        const tabs = document.querySelectorAll('.wardrobe-tab');
        if (!tabs.length || !hatShopGridEl || !accessoryShopGridEl) return;
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                tabs.forEach((t) => {
                    const active = t.dataset.tab === target;
                    t.classList.toggle('active', active);
                    t.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                hatShopGridEl.hidden = (target !== 'hats');
                accessoryShopGridEl.hidden = (target !== 'accessories');
            });
        });
    }

    /* ============ COLORING-BOOK PAGES ============

       "Freedom inside a fence": the silhouette is the outer fence, and
       each page draws a pre-made line-art template inside it (eyes,
       smile, costume hints) for the kid to color in. The kid still has
       full color/brush/eraser freedom — the template just gives them a
       starting structure to work with.

       Each page's `draw(c)` paints onto the same clipped 2D context that
       free-drawing uses, so any strokes extending past the silhouette
       (an oversize crown, cape edges, etc.) get cleanly trimmed by the
       canvas clip without needing per-page coordinate fixing. Style
       conventions: navy ink (#1a0f33), 4px lineWidth, round caps. */

    const PAGES = [
        {
            id: 'robot',
            label: 'Robot',
            emoji: '🤖',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Antenna stub (the bulb sits above the head and is
                   trimmed by the clip — only the in-body part shows). */
                c.beginPath(); c.moveTo(cx, BODY.headTop + 16); c.lineTo(cx, BODY.headTop + 6); c.stroke();
                c.beginPath(); c.arc(cx, BODY.headTop + 1, 5, 0, Math.PI * 2); c.stroke();
                /* Square eyes with tiny pupils. */
                c.strokeRect(cx - edx - 9, ey - 9, 18, 18);
                c.strokeRect(cx + edx - 9, ey - 9, 18, 18);
                c.beginPath(); c.arc(cx - edx, ey, 2, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + edx, ey, 2, 0, Math.PI * 2); c.fill();
                /* Mouth + teeth. */
                c.strokeRect(cx - 20, my + 4, 40, 14);
                c.beginPath(); c.moveTo(cx - 7, my + 4); c.lineTo(cx - 7, my + 18); c.stroke();
                c.beginPath(); c.moveTo(cx + 7, my + 4); c.lineTo(cx + 7, my + 18); c.stroke();
                /* Control panel with 3 buttons, centred on the chest. */
                c.strokeRect(cx - 32, BODY.chestY - 30, 64, 60);
                c.beginPath(); c.arc(cx - 16, BODY.chestY - 15, 5, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx, BODY.chestY - 15, 5, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + 16, BODY.chestY - 15, 5, 0, Math.PI * 2); c.stroke();
                /* Speaker grill. */
                for (let i = 0; i < 3; i++) {
                    const gy = BODY.chestY + 8 + i * 8;
                    c.beginPath(); c.moveTo(cx - 20, gy); c.lineTo(cx + 20, gy); c.stroke();
                }
                c.restore();
            }
        },
        {
            id: 'princess',
            label: 'Princess',
            emoji: '👑',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Tiara zigzag on the forehead with a base band. */
                const tB = BODY.headTop + 30, tT = BODY.headTop + 12;
                c.beginPath();
                c.moveTo(cx - 34, tB); c.lineTo(cx - 22, tT);
                c.lineTo(cx - 10, tB); c.lineTo(cx, tT - 4);
                c.lineTo(cx + 10, tB); c.lineTo(cx + 22, tT);
                c.lineTo(cx + 34, tB);
                c.stroke();
                c.beginPath(); c.moveTo(cx - 34, tB); c.lineTo(cx + 34, tB); c.stroke();
                /* Almond eyes. */
                c.beginPath(); c.ellipse(cx - edx, ey, 7, 5, 0, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.ellipse(cx + edx, ey, 7, 5, 0, 0, Math.PI * 2); c.stroke();
                /* Eyelashes. */
                c.beginPath(); c.moveTo(cx - edx - 6, ey - 4); c.lineTo(cx - edx - 10, ey - 7); c.stroke();
                c.beginPath(); c.moveTo(cx - edx, ey - 6); c.lineTo(cx - edx, ey - 10); c.stroke();
                c.beginPath(); c.moveTo(cx - edx + 6, ey - 4); c.lineTo(cx - edx + 10, ey - 7); c.stroke();
                c.beginPath(); c.moveTo(cx + edx - 6, ey - 4); c.lineTo(cx + edx - 10, ey - 7); c.stroke();
                c.beginPath(); c.moveTo(cx + edx, ey - 6); c.lineTo(cx + edx, ey - 10); c.stroke();
                c.beginPath(); c.moveTo(cx + edx + 6, ey - 4); c.lineTo(cx + edx + 10, ey - 7); c.stroke();
                /* Heart-shaped lips. */
                c.beginPath();
                c.moveTo(cx - 8, my - 2);
                c.bezierCurveTo(cx - 8, my - 9, cx - 1, my - 9, cx, my - 5);
                c.bezierCurveTo(cx + 1, my - 9, cx + 8, my - 9, cx + 8, my - 2);
                c.bezierCurveTo(cx + 8, my + 5, cx, my + 10, cx, my + 10);
                c.bezierCurveTo(cx, my + 10, cx - 8, my + 5, cx - 8, my - 2);
                c.stroke();
                /* Rosy cheek circles. */
                c.beginPath(); c.arc(cx - BODY.cheekDX, BODY.cheekY, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + BODY.cheekDX, BODY.cheekY, 6, 0, Math.PI * 2); c.stroke();
                /* Dress neckline V + bow. */
                const nT = BODY.shirtTop;
                c.beginPath();
                c.moveTo(cx - 30, nT); c.lineTo(cx, nT + 50); c.lineTo(cx + 30, nT);
                c.stroke();
                c.beginPath(); c.ellipse(cx - 7, nT + 50, 8, 5, -0.4, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.ellipse(cx + 7, nT + 50, 8, 5,  0.4, 0, Math.PI * 2); c.stroke();
                /* Dress flare lines (mostly clipped, hint at the skirt). */
                c.beginPath(); c.moveTo(cx - 35, BODY.chestY + 40);
                c.bezierCurveTo(cx - 45, BODY.waistY - 30, cx - 55, BODY.waistY + 20, cx - 60, BODY.pantsTop + 30);
                c.stroke();
                c.beginPath(); c.moveTo(cx + 35, BODY.chestY + 40);
                c.bezierCurveTo(cx + 45, BODY.waistY - 30, cx + 55, BODY.waistY + 20, cx + 60, BODY.pantsTop + 30);
                c.stroke();
                c.restore();
            }
        },
        {
            id: 'astronaut',
            label: 'Astronaut',
            emoji: '🚀',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, my = BODY.mouthY;
                /* Visor sweep across the upper face. */
                c.beginPath();
                c.moveTo(150, ey + 2);
                c.bezierCurveTo(170, BODY.browY, 230, BODY.browY, 250, ey + 2);
                c.stroke();
                /* Helmet chin curve. */
                c.beginPath();
                c.moveTo(150, my + 20);
                c.bezierCurveTo(175, my + 36, 225, my + 36, 250, my + 20);
                c.stroke();
                /* Eyes through the visor. */
                c.beginPath(); c.arc(cx - 15, ey + 6, 4, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + 15, ey + 6, 4, 0, Math.PI * 2); c.fill();
                /* Suit zipper with teeth ticks. */
                c.beginPath(); c.moveTo(cx, BODY.shirtTop); c.lineTo(cx, BODY.waistY); c.stroke();
                for (let y = BODY.shirtTop + 12; y <= BODY.waistY - 8; y += 18) {
                    c.beginPath(); c.moveTo(cx - 4, y); c.lineTo(cx + 4, y); c.stroke();
                }
                /* Mission patch + tiny star inside, on the chest. */
                const pX = cx - 30, pY = BODY.chestY - 14;
                c.strokeRect(pX, pY, 28, 28);
                c.beginPath();
                c.moveTo(pX + 14, pY + 5);
                c.lineTo(pX + 17, pY + 13); c.lineTo(pX + 25, pY + 13);
                c.lineTo(pX + 19, pY + 18); c.lineTo(pX + 21, pY + 26);
                c.lineTo(pX + 14, pY + 21); c.lineTo(pX + 7, pY + 26);
                c.lineTo(pX + 9, pY + 18); c.lineTo(pX + 3, pY + 13);
                c.lineTo(pX + 11, pY + 13);
                c.closePath(); c.stroke();
                /* Utility belt. */
                c.beginPath(); c.moveTo(cx - 45, BODY.waistY); c.lineTo(cx + 45, BODY.waistY); c.stroke();
                c.restore();
            }
        },
        {
            id: 'clown',
            label: 'Clown',
            emoji: '🤡',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Big round nose. */
                c.beginPath(); c.arc(cx, my - 4, 16, 0, Math.PI * 2); c.stroke();
                /* Eye dots + surprised eyebrows. */
                c.beginPath(); c.arc(cx - edx - 2, ey - 1, 5, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + edx + 2, ey - 1, 5, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx - edx - 2, ey - 14, 10, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
                c.beginPath(); c.arc(cx + edx + 2, ey - 14, 10, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
                /* Big smile + upturned ends. */
                c.beginPath(); c.arc(cx, my + 14, 26, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
                c.beginPath(); c.moveTo(cx - 23, my + 27); c.lineTo(cx - 26, my + 23); c.stroke();
                c.beginPath(); c.moveTo(cx + 23, my + 27); c.lineTo(cx + 26, my + 23); c.stroke();
                /* Curly hair tufts hugging the head edges. */
                c.beginPath(); c.arc(cx - 46, BODY.headCy + 2, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx - 40, BODY.headCy + 16, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + 46, BODY.headCy + 2, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + 40, BODY.headCy + 16, 6, 0, Math.PI * 2); c.stroke();
                /* Bow tie just below the chin. */
                const bY = BODY.neckY + 8;
                c.beginPath();
                c.moveTo(cx, bY);
                c.lineTo(cx - 30, bY - 10); c.lineTo(cx - 30, bY + 15);
                c.lineTo(cx, bY + 5);
                c.lineTo(cx + 30, bY + 15); c.lineTo(cx + 30, bY - 10);
                c.closePath(); c.stroke();
                c.strokeRect(cx - 4, bY - 3, 8, 12);
                /* Polka dots scattered on the shirt. */
                for (let i = 0; i < 7; i++) {
                    const dy = BODY.shirtTop + 30 + i * 22;
                    const dx = cx + (i % 2 === 0 ? -22 : 22) + (i % 3 - 1) * 8;
                    c.beginPath(); c.arc(dx, dy, 7, 0, Math.PI * 2); c.stroke();
                }
                c.restore();
            }
        },
        {
            id: 'pirate',
            label: 'Pirate',
            emoji: '🏴‍☠️',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Bandana arc across the head + base line. */
                const bY = BODY.headTop + 36;
                c.beginPath();
                c.moveTo(cx - 45, bY);
                c.bezierCurveTo(cx - 25, bY - 20, cx + 25, bY - 20, cx + 45, bY);
                c.stroke();
                c.beginPath(); c.moveTo(cx - 45, bY); c.lineTo(cx + 45, bY); c.stroke();
                /* Bandana knot + trailing tails on the left. */
                c.beginPath(); c.arc(cx - 50, bY + 7, 7, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.moveTo(cx - 57, bY + 7); c.lineTo(cx - 70, bY + 20); c.stroke();
                c.beginPath(); c.moveTo(cx - 55, bY + 13); c.lineTo(cx - 68, bY + 27); c.stroke();
                /* Filled eyepatch over the right eye + strap. */
                c.fillRect(cx + edx - 10, ey - 9, 22, 18);
                c.beginPath(); c.moveTo(cx + edx - 10, ey - 5); c.lineTo(cx - edx, ey - 8); c.stroke();
                c.beginPath(); c.moveTo(cx + edx + 12, ey); c.lineTo(cx + 44, ey - 7); c.stroke();
                /* Visible eye on the other side. */
                c.beginPath(); c.arc(cx - edx, ey, 4, 0, Math.PI * 2); c.fill();
                /* Curly mustache. */
                c.beginPath();
                c.moveTo(cx - 20, my);
                c.bezierCurveTo(cx - 15, my - 3, cx - 5, my + 2, cx, my + 5);
                c.bezierCurveTo(cx + 5, my + 2, cx + 15, my - 3, cx + 20, my);
                c.stroke();
                /* Beard outline. */
                c.beginPath();
                c.moveTo(cx - 22, my + 2);
                c.bezierCurveTo(cx - 30, my + 15, cx - 25, my + 25, cx - 5, my + 30);
                c.lineTo(cx + 5, my + 30);
                c.bezierCurveTo(cx + 25, my + 25, cx + 30, my + 15, cx + 22, my + 2);
                c.stroke();
                /* Diagonal sash across the torso. */
                c.beginPath(); c.moveTo(cx - 40, BODY.shirtTop); c.lineTo(cx + 40, BODY.chestY + 20); c.stroke();
                c.beginPath(); c.moveTo(cx - 40, BODY.shirtTop + 20); c.lineTo(cx + 40, BODY.chestY + 40); c.stroke();
                /* Belt + buckle. */
                c.strokeRect(cx - 45, BODY.waistY - 8, 90, 16);
                c.strokeRect(cx - 7, BODY.waistY - 6, 14, 12);
                /* X marks the spot on the chest. */
                c.beginPath(); c.moveTo(cx - 22, BODY.chestY - 12); c.lineTo(cx + 2, BODY.chestY + 12); c.stroke();
                c.beginPath(); c.moveTo(cx + 2, BODY.chestY - 12); c.lineTo(cx - 22, BODY.chestY + 12); c.stroke();
                c.restore();
            }
        },
        {
            id: 'superhero',
            label: 'Superhero',
            emoji: '🦸',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Bandit-style mask outline across the eyes. */
                c.beginPath();
                c.moveTo(cx - 50, ey - 8);
                c.bezierCurveTo(cx - 30, ey - 16, cx + 30, ey - 16, cx + 50, ey - 8);
                c.bezierCurveTo(cx + 48, ey + 14, cx + 30, ey + 22, cx, ey + 19);
                c.bezierCurveTo(cx - 30, ey + 22, cx - 48, ey + 14, cx - 50, ey - 8);
                c.closePath(); c.stroke();
                /* Mask eye holes (white inset = a target for the kid). */
                c.fillStyle = '#fff';
                c.beginPath(); c.ellipse(cx - edx, ey + 4, 10, 7, 0, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.ellipse(cx + edx, ey + 4, 10, 7, 0, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.arc(cx - edx + 2, ey + 4, 3, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + edx - 2, ey + 4, 3, 0, Math.PI * 2); c.fill();
                /* Heroic grin. */
                c.beginPath();
                c.arc(cx, my + 6, 14, 0.15 * Math.PI, 0.85 * Math.PI);
                c.stroke();
                /* Big 5-point star emblem on the chest. */
                const cy = BODY.chestY, r1 = 28, r2 = 12;
                c.beginPath();
                for (let i = 0; i < 10; i++) {
                    const a = i * Math.PI / 5 - Math.PI / 2;
                    const rr = i % 2 === 0 ? r1 : r2;
                    const x = cx + Math.cos(a) * rr;
                    const y = cy + Math.sin(a) * rr;
                    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
                }
                c.closePath(); c.stroke();
                /* Cape edge curves (mostly clipped, hint at the cape). */
                c.beginPath();
                c.moveTo(cx - 45, BODY.shirtTop);
                c.bezierCurveTo(cx - 65, BODY.chestY, cx - 70, BODY.waistY + 40, cx - 60, BODY.pantsTop + 30);
                c.stroke();
                c.beginPath();
                c.moveTo(cx + 45, BODY.shirtTop);
                c.bezierCurveTo(cx + 65, BODY.chestY, cx + 70, BODY.waistY + 40, cx + 60, BODY.pantsTop + 30);
                c.stroke();
                /* Belt + buckle X. */
                c.strokeRect(cx - 45, BODY.waistY - 8, 90, 14);
                c.strokeRect(cx - 8, BODY.waistY - 7, 16, 12);
                c.beginPath();
                c.moveTo(cx - 8, BODY.waistY - 7); c.lineTo(cx + 8, BODY.waistY + 5);
                c.moveTo(cx + 8, BODY.waistY - 7); c.lineTo(cx - 8, BODY.waistY + 5);
                c.stroke();
                c.restore();
            }
        }
    ];

    const PAGE_BY_ID = {};
    PAGES.forEach(p => { PAGE_BY_ID[p.id] = p; });

    /* In-memory only — when a kid refreshes, the page state resets to
       blank. The persistent piece is state.counters.pagesCompleted, which
       drives the per-page achievement unlocks. */
    let currentPageId = null;
    let pagesModalEl = null;
    let pagesGridEl = null;

    function applyPage(pageId) {
        const page = PAGE_BY_ID[pageId];
        if (!page || !ctx) return;
        /* A page swap is a "new drawing" — wipe the canvas and reset the
           per-drawing color tally (so Rainbow Day starts over on the new
           page) before stamping in the template. */
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
        if (state) trackClearDrawing();
        page.draw(ctx);
        currentPageId = pageId;
    }

    function clearPageTemplate() {
        currentPageId = null;
        if (!ctx) return;
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
        if (state) trackClearDrawing();
    }

    function trackPageCompleted(pageId) {
        if (!pageId) return;
        if (state.counters.pagesCompleted.indexOf(pageId) !== -1) return;
        state.counters.pagesCompleted.push(pageId);
        saveState();
        checkAchievements();
    }

    function buildPagesGrid() {
        if (!pagesGridEl) return;
        pagesGridEl.innerHTML = '';
        /* "Blank" card first — untemplate the canvas and return to the
           free-drawing surface. Then one card per page, with a done tag
           when its achievement is already earned. */
        const blank = document.createElement('button');
        blank.type = 'button';
        blank.className = 'page-card page-card-blank';
        blank.innerHTML =
            '<div class="page-emoji" aria-hidden="true">✏️</div>' +
            '<div class="page-name">Blank</div>' +
            '<div class="page-action">Start fresh</div>';
        blank.addEventListener('click', () => {
            clearPageTemplate();
            closeModal();
        });
        pagesGridEl.appendChild(blank);

        for (let i = 0; i < PAGES.length; i++) {
            const page = PAGES[i];
            const done = state.counters.pagesCompleted.indexOf(page.id) !== -1;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'page-card' + (done ? ' done' : '');
            card.innerHTML =
                '<div class="page-emoji" aria-hidden="true">' + page.emoji + '</div>' +
                '<div class="page-name">' + escapeHtml(page.label) + '</div>' +
                '<div class="page-action">' + (done ? '✓ Done' : 'Color it') + '</div>';
            card.addEventListener('click', () => {
                applyPage(page.id);
                closeModal();
            });
            pagesGridEl.appendChild(card);
        }
    }

    function openPagesPicker() {
        buildPagesGrid();
        openModal(pagesModalEl);
    }

    /* ============ DEFAULT GROODLES (starter library) ============

       Pre-made character templates the kid can pick as a starting
       point. Same idiom as drawSurprise() but instead of one goofy
       random output, this is a curated library of identifiable
       characters with matching pose + background + hat.

       Each entry:
         id     stable string, used in achievements + analytics later
         label  display name
         emoji  for the starter card thumbnail
         pose   POSES key — applied before painting so the canvas clip
                matches the new silhouette
         bg     bg-* class suffix (studio, disco, outdoors, …)
         hat    HATS id — equipped via equipHat()
         color  first-pick palette color the kid lands on after the
                starter applies (so they're already holding a
                character-appropriate pen)
         draw(c) paints the body / face / outfit onto the canvas
                context (already cleared + clipped by the time it's
                called). Coords are logical 400×600; lines outside the
                silhouette are trimmed by the ctx.clip in buildCanvas. */

    /* Shared body landmarks for the prefab artwork (DEFAULT_GROODLES +
       drawSurprise). The figure outline is generated from SK + the
       standing skeleton; these anchors describe WHERE on that outline
       faces / costumes should land so the prefabs track the frame
       instead of hard-coding coordinates tuned to an older shape.
       If the frame changes again, retune here once — not in every
       prefab. (Costume bands are full-width fillRects; the canvas clip
       trims them to whatever pose silhouette is active, so only their
       vertical extents matter.) */
    const BODY = {
        cx: 200,
        headCy: 92, headR: 58, headTop: 34,
        eyeY: 86, eyeDX: 18,          // eyes at cx ± eyeDX
        browY: 68,
        mouthY: 110,
        cheekY: 114, cheekDX: 30,
        hairTipY: 28, hairBaseY: 56,  // crown tuft band
        neckY: 150,
        shirtTop: 158, shirtBot: 392, // torso band
        chestY: 234,                  // logo / badge / button cluster
        waistY: 384,
        pantsTop: 374, pantsBot: 600, // legs band
        bootY: 532,
        handY: 344                    // standing hand height
    };

    const DEFAULT_GROODLES = [
        {
            id: 'astronaut-bo',
            label: 'Astronaut Bo',
            emoji: '🚀',
            pose: 'standing',
            bg: 'stadium',
            hat: 'rocket-ship',
            color: '#1d3557',
            draw: (c) => {
                /* White suit base. */
                c.fillStyle = '#ececf4';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Navy chest panel. */
                c.fillStyle = '#1d3557';
                c.fillRect(0, BODY.shirtTop + 40, STAGE_W, 80);
                /* Visor: rounded teal band across the eyes. */
                c.fillStyle = '#43aa8b';
                c.beginPath();
                const vy = BODY.eyeY - 18;
                c.roundRect ? c.roundRect(150, vy, 100, 40, 16) :
                    (c.fillRect(150, vy, 100, 40));
                c.fill();
                /* Visor reflection highlight. */
                c.fillStyle = 'rgba(255, 255, 255, 0.45)';
                c.beginPath(); c.roundRect ? c.roundRect(158, vy + 6, 18, 8, 4) :
                    c.fillRect(158, vy + 6, 18, 8); c.fill();
                /* Smile just under the visor. */
                c.strokeStyle = '#1a0f33';
                c.lineWidth = 4;
                c.lineCap = 'round';
                c.beginPath();
                c.arc(BODY.cx, BODY.mouthY + 6, 13, 0.15 * Math.PI, 0.85 * Math.PI);
                c.stroke();
                /* Mission patch — red circle with white star on chest. */
                c.fillStyle = '#e63946';
                c.beginPath(); c.arc(BODY.cx, BODY.chestY, 18, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#fff';
                c.font = 'bold 22px monospace';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('★', BODY.cx, BODY.chestY + 2);
                /* Glove cuffs at the hands (standing arms hang ~hip level). */
                c.fillStyle = '#e63946';
                c.fillRect(132, BODY.handY - 6, 34, 15);
                c.fillRect(234, BODY.handY - 6, 34, 15);
                /* Boot tops at the feet. */
                c.fillRect(146, BODY.bootY, 46, 18);
                c.fillRect(208, BODY.bootY, 46, 18);
            }
        },
        {
            id: 'rockstar-daisy',
            label: 'Rockstar Daisy',
            emoji: '🎸',
            pose: 'groovy',
            bg: 'stadium',
            hat: 'funky-fresh',
            color: '#e63946',
            draw: (c) => {
                /* Skin tone fill across the silhouette. */
                c.fillStyle = '#f4a261';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Leather jacket — black across the torso. */
                c.fillStyle = '#1a0f33';
                c.fillRect(0, BODY.shirtTop, STAGE_W, BODY.waistY - BODY.shirtTop);
                /* Hot-pink jeans. */
                c.fillStyle = '#ff6ec7';
                c.fillRect(0, BODY.waistY - 8, STAGE_W, BODY.pantsBot);
                /* Tank top peek — magenta V neckline. */
                c.fillStyle = '#e63946';
                c.beginPath();
                c.moveTo(BODY.cx - 25, BODY.shirtTop);
                c.lineTo(BODY.cx, BODY.shirtTop + 64);
                c.lineTo(BODY.cx + 25, BODY.shirtTop);
                c.closePath();
                c.fill();
                /* Star sunglasses over the eyes. */
                c.fillStyle = '#1a0f33';
                for (let i = 0; i < 2; i++) {
                    const cx = BODY.cx + (i === 0 ? -BODY.eyeDX : BODY.eyeDX);
                    c.beginPath();
                    for (let k = 0; k < 10; k++) {
                        const a = k * Math.PI / 5 - Math.PI / 2;
                        const rr = k % 2 === 0 ? 11 : 5;
                        const x = cx + Math.cos(a) * rr;
                        const y = BODY.eyeY + Math.sin(a) * rr;
                        if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
                    }
                    c.closePath();
                    c.fill();
                }
                /* Open-mouth singing 'O'. */
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.arc(BODY.cx, BODY.mouthY, 8, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#e63946';
                c.beginPath(); c.arc(BODY.cx, BODY.mouthY, 5, 0, Math.PI * 2); c.fill();
            }
        },
        {
            id: 'disco-king',
            label: 'Disco King',
            emoji: '🪩',
            pose: 'groovy',
            bg: 'disco',
            hat: 'cool-kids',
            color: '#ffd23f',
            draw: (c) => {
                /* Sparkly gold suit. */
                c.fillStyle = '#ffd23f';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* White lapels — diagonal triangles from the neck. */
                c.fillStyle = '#fff';
                const lT = BODY.shirtTop + 6, lB = lT + 120;
                c.beginPath();
                c.moveTo(BODY.cx - 25, lT);
                c.lineTo(BODY.cx - 45, lB);
                c.lineTo(BODY.cx, lT + 56);
                c.closePath();
                c.fill();
                c.beginPath();
                c.moveTo(BODY.cx + 25, lT);
                c.lineTo(BODY.cx + 45, lB);
                c.lineTo(BODY.cx, lT + 56);
                c.closePath();
                c.fill();
                /* Disco-ball sequins scattered down the suit. */
                c.fillStyle = '#fff';
                for (let i = 0; i < 14; i++) {
                    const sy = BODY.shirtTop + 30 + i * 34;
                    const sx = BODY.cx + (i % 2 === 0 ? -22 : 22) + (i % 3 - 1) * 6;
                    c.beginPath();
                    c.arc(sx, sy, 4, 0, Math.PI * 2);
                    c.fill();
                }
                /* Confident half-smile. */
                c.strokeStyle = '#1a0f33';
                c.lineWidth = 4;
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(BODY.cx - 20, BODY.mouthY);
                c.bezierCurveTo(BODY.cx - 5, BODY.mouthY + 10,
                                BODY.cx + 15, BODY.mouthY + 10,
                                BODY.cx + 25, BODY.mouthY - 5);
                c.stroke();
                /* Skin patch behind the cool-kids sunglasses (eyes are
                   hidden under the hat + shades). */
                c.fillStyle = '#f4a261';
                c.fillRect(BODY.cx - 40, BODY.eyeY - 14, 80, 26);
            }
        },
        {
            id: 'pirate-pip',
            label: 'Pirate Pip',
            emoji: '🏴‍☠️',
            pose: 'standing',
            bg: 'underwater',
            hat: 'no-hat',
            color: '#6f4e37',
            draw: (c) => {
                /* Skin tone across the figure. */
                c.fillStyle = '#fcbf49';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Red-and-white horizontal-stripe shirt across the torso. */
                const stripeH = (BODY.waistY - BODY.shirtTop) / 6;
                for (let i = 0; i < 6; i++) {
                    c.fillStyle = (i % 2 === 0) ? '#e63946' : '#fff';
                    c.fillRect(0, BODY.shirtTop + i * stripeH, STAGE_W, stripeH + 1);
                }
                /* Brown pants. */
                c.fillStyle = '#6f4e37';
                c.fillRect(0, BODY.waistY, STAGE_W, BODY.pantsBot);
                /* Belt + buckle. */
                c.fillStyle = '#1a0f33';
                c.fillRect(0, BODY.waistY - 6, STAGE_W, 18);
                c.fillStyle = '#ffd23f';
                c.fillRect(BODY.cx - 10, BODY.waistY - 3, 20, 12);
                /* Red bandana across the head crown. */
                c.fillStyle = '#e63946';
                c.fillRect(142, BODY.headTop + 12, 116, 26);
                /* Eyepatch over the right eye + strap. */
                c.fillStyle = '#1a0f33';
                c.fillRect(BODY.cx + 8, BODY.eyeY - 9, 24, 19);
                c.lineWidth = 3;
                c.strokeStyle = '#1a0f33';
                c.beginPath();
                c.moveTo(BODY.cx + 8, BODY.eyeY - 3); c.lineTo(165, BODY.eyeY - 12); c.stroke();
                c.beginPath();
                c.moveTo(BODY.cx + 32, BODY.eyeY); c.lineTo(258, BODY.eyeY - 10); c.stroke();
                /* Left eye + tiny grin. */
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.arc(BODY.cx - BODY.eyeDX, BODY.eyeY, 5, 0, Math.PI * 2); c.fill();
                c.beginPath();
                c.arc(BODY.cx, BODY.mouthY + 4, 12, 0.2 * Math.PI, 0.8 * Math.PI);
                c.lineWidth = 4;
                c.stroke();
            }
        },
        {
            id: 'princess-lily',
            label: 'Princess Lily',
            emoji: '👑',
            pose: 'star',
            bg: 'candy',
            hat: 'candy-bowl',
            color: '#ff6ec7',
            draw: (c) => {
                /* Soft skin fill. */
                c.fillStyle = '#fcbf49';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Pink ball gown across torso + legs. */
                c.fillStyle = '#ff6ec7';
                c.fillRect(0, BODY.shirtTop, STAGE_W, BODY.pantsBot);
                /* Lighter pink dress overlay band at the waist. */
                c.fillStyle = '#ffc1e3';
                c.fillRect(0, BODY.chestY + 30, STAGE_W, 64);
                /* Gold trim at the dress neckline. */
                c.fillStyle = '#ffd23f';
                const nT = BODY.shirtTop;
                c.beginPath();
                c.moveTo(BODY.cx - 30, nT);
                c.lineTo(BODY.cx, nT + 36);
                c.lineTo(BODY.cx + 30, nT);
                c.lineTo(BODY.cx + 30, nT + 10);
                c.lineTo(BODY.cx, nT + 46);
                c.lineTo(BODY.cx - 30, nT + 10);
                c.closePath();
                c.fill();
                /* Almond eyes with eyelashes. */
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.ellipse(BODY.cx - BODY.eyeDX, BODY.eyeY, 7, 5, 0, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.ellipse(BODY.cx + BODY.eyeDX, BODY.eyeY, 7, 5, 0, 0, Math.PI * 2); c.fill();
                c.lineWidth = 2;
                c.strokeStyle = '#1a0f33';
                c.beginPath(); c.moveTo(BODY.cx - BODY.eyeDX - 6, BODY.eyeY - 5); c.lineTo(BODY.cx - BODY.eyeDX - 10, BODY.eyeY - 10); c.stroke();
                c.beginPath(); c.moveTo(BODY.cx + BODY.eyeDX + 6, BODY.eyeY - 5); c.lineTo(BODY.cx + BODY.eyeDX + 10, BODY.eyeY - 10); c.stroke();
                /* Heart-shaped lips. */
                c.fillStyle = '#e63946';
                const my = BODY.mouthY;
                c.beginPath();
                c.moveTo(BODY.cx, my);
                c.bezierCurveTo(BODY.cx - 8, my - 12, BODY.cx - 12, my, BODY.cx, my + 10);
                c.bezierCurveTo(BODY.cx + 12, my, BODY.cx + 8, my - 12, BODY.cx, my);
                c.fill();
                /* Rosy cheeks. */
                c.fillStyle = 'rgba(230, 57, 70, 0.45)';
                c.beginPath(); c.arc(BODY.cx - BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(BODY.cx + BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); c.fill();
            }
        },
        {
            id: 'robo-9000',
            label: 'Robo-9000',
            emoji: '🤖',
            pose: 'standing',
            bg: 'outdoors',
            hat: 'circuit-board',
            color: '#43aa8b',
            draw: (c) => {
                /* Metallic gray body. */
                c.fillStyle = '#c0c5d0';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Darker chest panel. */
                c.fillStyle = '#5a6478';
                c.fillRect(0, BODY.shirtTop + 10, STAGE_W, 150);
                /* Waist belt. No center leg-seam any more — the legs are
                   two separate shapes now, so a center bar would float
                   in the gap between them. */
                c.fillStyle = '#1a0f33';
                c.fillRect(0, BODY.waistY - 4, STAGE_W, 12);
                /* Square LED eyes — teal. */
                c.fillStyle = '#43aa8b';
                c.fillRect(BODY.cx - BODY.eyeDX - 9, BODY.eyeY - 9, 18, 18);
                c.fillRect(BODY.cx + BODY.eyeDX - 9, BODY.eyeY - 9, 18, 18);
                /* Eye glow squares (inner). */
                c.fillStyle = '#ffffff';
                c.fillRect(BODY.cx - BODY.eyeDX - 3, BODY.eyeY - 3, 6, 6);
                c.fillRect(BODY.cx + BODY.eyeDX - 3, BODY.eyeY - 3, 6, 6);
                /* Speaker grill / mouth — 3 horizontal lines. */
                c.strokeStyle = '#1a0f33';
                c.lineWidth = 3;
                for (let i = 0; i < 3; i++) {
                    const gy = BODY.mouthY + i * 8;
                    c.beginPath(); c.moveTo(BODY.cx - 20, gy); c.lineTo(BODY.cx + 20, gy); c.stroke();
                }
                /* Three control-panel buttons on the chest. */
                const btns = [['#e63946', -16], ['#ffd23f', 0], ['#43aa8b', 16]];
                for (let i = 0; i < btns.length; i++) {
                    c.fillStyle = btns[i][0];
                    c.beginPath();
                    c.arc(BODY.cx + btns[i][1], BODY.chestY - 14, 7, 0, Math.PI * 2);
                    c.fill();
                }
                /* Chest readout — small LCD rectangle. */
                c.fillStyle = '#1a0f33';
                c.fillRect(BODY.cx - 30, BODY.chestY + 6, 60, 24);
                c.fillStyle = '#43aa8b';
                c.font = 'bold 14px monospace';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('OK', BODY.cx, BODY.chestY + 19);
            }
        }
    ];

    const DEFAULT_GROODLE_BY_ID = {};
    DEFAULT_GROODLES.forEach(d => { DEFAULT_GROODLE_BY_ID[d.id] = d; });

    let starterGridEl = null;

    function applyDefaultGroodle(id) {
        const seed = DEFAULT_GROODLE_BY_ID[id];
        if (!seed) return;
        /* Picking a starter is a "new drawing" — kill any active page
           template and wipe the per-drawing color tally before laying
           the new artwork in. clearCanvas() handles trackClearDrawing. */
        currentPageId = null;
        /* Pose change has to happen FIRST: applyPose rebuilds the
           silhouette + canvas clip, which would clear anything painted
           before it. After applyPose, the canvas is blank and clipped
           to the new pose. */
        if (seed.pose && state && state.pose !== seed.pose) {
            applyPose(seed.pose);
        } else {
            /* Same pose: wipe the canvas explicitly so the starter
               paints onto a clean surface. */
            clearCanvas();
        }
        /* Background — replicates what attachBgPicker's click handler does
           so the swap is identical to the kid tapping the bg thumb. */
        if (seed.bg) {
            const bgLayer = document.getElementById('bgLayer');
            if (bgLayer) bgLayer.className = 'bg-layer bg-' + seed.bg;
            document.querySelectorAll('.bg-thumb').forEach((b) => {
                b.classList.toggle('active', b.dataset.bg === seed.bg);
            });
        }
        /* Hat — equipHat updates state.hats.equipped + renders. Wrapped
           in a try because some hats may not be owned yet (kid hasn't
           bought them); equipHat already no-ops in that case. */
        if (seed.hat && state.hats.owned.indexOf(seed.hat) !== -1) {
            equipHat(seed.hat);
        }
        /* Paint the starter onto the canvas. */
        seed.draw(ctx);
        /* Land the kid on a character-appropriate palette color so the
           first stroke of their own already matches the starter. */
        if (seed.color) {
            currentColor = seed.color;
            isErasing = false;
            const sw = document.querySelector('.swatch[data-color="' + seed.color + '"]');
            document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
            if (sw) sw.classList.add('active');
            const eraser = document.getElementById('eraserBtn');
            if (eraser) eraser.classList.remove('active');
        }
    }

    function buildStarterGrid() {
        if (!starterGridEl) starterGridEl = document.getElementById('starterGrid');
        if (!starterGridEl) return;
        starterGridEl.innerHTML = '';
        for (let i = 0; i < DEFAULT_GROODLES.length; i++) {
            const seed = DEFAULT_GROODLES[i];
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'starter-card';
            card.setAttribute('aria-label', 'Start with ' + seed.label);
            card.innerHTML =
                '<div class="starter-emoji" aria-hidden="true">' + seed.emoji + '</div>' +
                '<div class="starter-name">' + escapeHtml(seed.label) + '</div>' +
                '<div class="starter-action">Use this</div>';
            card.addEventListener('click', () => {
                applyDefaultGroodle(seed.id);
                /* Close the New drawer so the kid lands back on the
                   stage and can immediately tweak the starter. */
                closeDrawer();
            });
            starterGridEl.appendChild(card);
        }
    }

    /* ============ PUBLIC GALLERY (Supabase) ============

       Optional feature: kids can SAVE their finished Groodle to a shared
       public gallery hosted on Supabase. The credentials below are
       placeholders; see groodle/SUPABASE_SETUP.md for the SQL schema +
       Row Level Security policies that must be in place before this
       works end-to-end. While the placeholders are unchanged, the SAVE
       button shows a "not configured" toast and the GALLERY modal shows
       an empty state — the rest of the game keeps working unaffected.

       Compose strategy: the offscreen export canvas is painted from the
       same primitives the game uses on screen — buildBodyPath + the
       in-stage draw canvas + a stroked outline ring — instead of
       serializing SVG with embedded sprite refs. This sidesteps the
       cross-origin / blob-relative-path issues SVG serialization runs
       into and keeps the export tiny. */

    const SUPABASE_URL = 'YOUR_SUPABASE_URL';
    const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
    const GROODLE_BUCKET = 'groodle-art';
    const GROODLE_TABLE = 'groodles';

    let _supabaseClient = null;
    function getSupabaseClient() {
        if (_supabaseClient) return _supabaseClient;
        if (typeof window.supabase === 'undefined') return null;
        if (SUPABASE_URL === 'YOUR_SUPABASE_URL' ||
            SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') return null;
        _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return _supabaseClient;
    }

    /* ---- Kid-safe random display-name generator + profanity check ---- */

    const NAME_ADJ = ['Purple', 'Sparkly', 'Mighty', 'Brave', 'Silly', 'Wiggly',
        'Zoomy', 'Cosmic', 'Bouncy', 'Sneaky', 'Fancy', 'Rad', 'Funky', 'Loud',
        'Tiny', 'Giant', 'Magic', 'Speedy', 'Glowing', 'Wild'];
    const NAME_NOUN = ['Tiger', 'Otter', 'Panda', 'Dragon', 'Owl', 'Fox',
        'Robot', 'Comet', 'Pickle', 'Noodle', 'Banana', 'Squid', 'Wizard',
        'Ninja', 'Astronaut', 'Yeti', 'Goblin', 'Frog', 'Penguin', 'Llama'];

    function randomDisplayName() {
        const a = NAME_ADJ[Math.floor(Math.random() * NAME_ADJ.length)];
        const n = NAME_NOUN[Math.floor(Math.random() * NAME_NOUN.length)];
        const num = Math.floor(Math.random() * 99) + 1;
        return a + n + num;
    }

    /* Minimal client-side filter. Server-side validation in the RLS
       insert policy is the real safety net — this only stops the most
       obvious slips before they ever reach the database. The list is
       intentionally short + ASCII; Supabase-side enforcement should
       cover the variations. */
    const BAD_WORDS = [
        'fuck','shit','bitch','cunt','nigger','faggot','slut','whore',
        'asshole','dick','penis','vagina','sex','porn','nazi','kill',
        'rape','retard'
    ];
    function isNameClean(name) {
        if (!name) return false;
        const lower = name.toLowerCase();
        for (let i = 0; i < BAD_WORDS.length; i++) {
            if (lower.indexOf(BAD_WORDS[i]) !== -1) return false;
        }
        return true;
    }

    /* Render the whole creature to an offscreen 800×1200 (DPR-2) PNG.
       Background is left transparent — the gallery card frames each
       Groodle on its own neutral surface so background presets don't
       compete with one another in the grid. */
    function composeGroodleBlob() {
        if (!ctx) return Promise.resolve(null);
        return new Promise((resolve) => {
            const out = document.createElement('canvas');
            out.width = STAGE_W * 2;
            out.height = STAGE_H * 2;
            const c = out.getContext('2d');
            c.scale(2, 2);
            c.lineCap = 'round'; c.lineJoin = 'round';
            const body = buildBodyPath();
            /* Pale interior wash (matches .silhouette-fill rgba). */
            c.save();
            c.fillStyle = 'rgba(232, 232, 244, 0.94)';
            c.fill(body);
            c.restore();
            /* The kid's strokes (the live canvas is already clipped to
               the silhouette, so this drawImage doesn't paint outside). */
            c.drawImage(canvas, 0, 0, STAGE_W, STAGE_H);
            /* Inner outline ring — stroked along the body path. Slightly
               wider than the on-screen filter-derived ring; close enough
               to read as "the body outline" in a thumbnail. */
            c.save();
            c.strokeStyle = '#1a0f33';
            c.lineWidth = 5;
            c.stroke(body);
            c.restore();
            out.toBlob(resolve, 'image/png');
        });
    }

    let saveModalEl = null;
    let saveModalInputEl = null;
    let saveModalSubmitEl = null;
    let saveModalStatusEl = null;
    let galleryModalEl = null;
    let galleryGridEl = null;

    function openSaveDialog() {
        if (!saveModalEl) return;
        const client = getSupabaseClient();
        if (saveModalInputEl) saveModalInputEl.value = randomDisplayName();
        if (saveModalStatusEl) {
            saveModalStatusEl.textContent = client
                ? 'Sign your Groodle, then tap Save.'
                : 'Gallery is not set up yet — see SUPABASE_SETUP.md.';
        }
        if (saveModalSubmitEl) saveModalSubmitEl.disabled = !client;
        openModal(saveModalEl);
    }

    async function submitGroodle() {
        const client = getSupabaseClient();
        if (!client) return;
        const rawName = (saveModalInputEl && saveModalInputEl.value || '').trim();
        const name = rawName.slice(0, 24);
        if (!name || !isNameClean(name)) {
            saveModalStatusEl.textContent = 'Pick a different name, please.';
            return;
        }
        saveModalSubmitEl.disabled = true;
        saveModalStatusEl.textContent = 'Saving…';
        try {
            const blob = await composeGroodleBlob();
            if (!blob) throw new Error('Could not capture drawing');
            const filename = 'groodle-' + Date.now() + '-' +
                Math.random().toString(36).slice(2, 8) + '.png';
            const up = await client.storage
                .from(GROODLE_BUCKET)
                .upload(filename, blob, { contentType: 'image/png' });
            if (up.error) throw up.error;
            const pub = client.storage.from(GROODLE_BUCKET).getPublicUrl(filename);
            const ins = await client.from(GROODLE_TABLE).insert({
                name: name,
                image_url: pub.data.publicUrl,
                page_id: currentPageId
            });
            if (ins.error) throw ins.error;
            saveModalStatusEl.textContent = 'Saved! Find it in the Gallery.';
            setTimeout(closeModal, 1100);
        } catch (e) {
            saveModalStatusEl.textContent = 'Save failed — try again later.';
            saveModalSubmitEl.disabled = false;
        }
    }

    async function loadRecentGroodles() {
        const client = getSupabaseClient();
        if (!client) return null;
        const { data, error } = await client
            .from(GROODLE_TABLE)
            .select('id, name, image_url, page_id, created_at')
            .order('created_at', { ascending: false })
            .limit(48);
        if (error) return null;
        return data;
    }

    async function openGallery() {
        if (!galleryModalEl) return;
        openModal(galleryModalEl);
        if (galleryGridEl) {
            galleryGridEl.innerHTML = '<div class="gallery-empty">Loading…</div>';
        }
        const client = getSupabaseClient();
        if (!client) {
            galleryGridEl.innerHTML =
                '<div class="gallery-empty">Gallery is not set up yet.<br>' +
                'See <code>SUPABASE_SETUP.md</code> for instructions.</div>';
            return;
        }
        const rows = await loadRecentGroodles();
        if (!rows) {
            galleryGridEl.innerHTML = '<div class="gallery-empty">Could not load gallery.</div>';
            return;
        }
        if (rows.length === 0) {
            galleryGridEl.innerHTML = '<div class="gallery-empty">Be the first to share a Groodle!</div>';
            return;
        }
        galleryGridEl.innerHTML = '';
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const card = document.createElement('div');
            card.className = 'gallery-card';
            card.innerHTML =
                '<img class="gallery-img" src="' + row.image_url + '" alt="Groodle by ' + escapeHtml(row.name) + '" loading="lazy"/>' +
                '<div class="gallery-name">' + escapeHtml(row.name) + '</div>';
            galleryGridEl.appendChild(card);
        }
    }

    /* ============ STATE ============ */

    let currentColor = '#000000';
    let currentSize = 12;
    let isErasing = false;
    let isDrawing = false;
    let lastX = 0, lastY = 0;

    let canvas = null;
    let ctx = null;
    let creature = null;
    /* DOM elements touched on every dance frame are looked up once at init.
       Repeating getElementById per RAF is two extra DOM tree walks per
       frame and shows up under DevTools profiling on slower phones. */
    let floorEl = null;
    let bubbleEl = null;
    /* The dance dock (the floating bottom bar with the STOP button) ships
       with the `hidden` attribute on its HTML so it doesn't flash on
       first paint. CSS `[hidden] { display: none !important }` keeps it
       hidden — startDance/stopDance toggle this flag so the dock can
       appear during dance. Looked up once at init to avoid an extra DOM
       query each time the kid taps Dance. */
    let danceDockEl = null;
    /* Canvas bounding rect is cached for the duration of a stroke. Reading
       getBoundingClientRect on every pointermove forces a layout pass; the
       rect can only change on scroll/resize/zoom, and a pointer capture
       guarantees those don't happen mid-stroke. */
    let cachedRect = null;

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

    /* Add a rounded rectangle subpath. Equivalent to SVG <rect rx="r"> and
       to CanvasRenderingContext2D.roundRect, but hand-rolled so we don't
       depend on roundRect (still missing in some older mobile Safaris). */
    /* Build the silhouette as ONE Path2D for the canvas clip, in the
       logical 400x600 coordinate system. posePathD resolves the
       current pose to a single SVG path d-string (generated from a
       skeleton for humanoid poses, hand-authored for ghost/animal);
       Path2D(d) parses it directly. A pose change re-clips the canvas
       to the new outline. Same string feeds the SVG groups below, so
       the paintable area and the visible body are guaranteed identical. */
    function buildBodyPath() {
        return new Path2D(posePathD(getCurrentPose()));
    }

    /* SVG version of the same single path — drops into the three
       <g> / <clipPath> groups inside the silhouette layers on init
       and on every pose change. */
    function renderPoseSvg(pose) {
        return '<path d="' + posePathD(pose) + '"/>';
    }

    /* Updates the three silhouette groups (clipPath / fill / outline)
       AND the creature's transform-origin to match the pose's anchor
       (default 50% 92% so feet stay planted, some poses tweak this).
       Caller is responsible for re-clipping the canvas and saving
       state. */
    function renderPoseDom(pose) {
        const svg = renderPoseSvg(pose);
        const clip = document.querySelector('#bodyClip');
        const fill = document.querySelector('.silhouette-fill');
        const outline = document.querySelector('.silhouette-outline');
        if (clip) clip.innerHTML = svg;
        if (fill) fill.innerHTML = svg;
        if (outline) outline.innerHTML = svg;
        if (creature && pose.origin) {
            creature.style.transformOrigin = pose.origin;
        }
    }

    /* Tracks whether the context has a save() pushed for the current
       clip. applyCanvasClip uses this to restore the previous clip
       state before installing a new one — so pose changes don't pile
       up clips on the state stack. */
    let canvasClipSaved = false;

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
        // Hard-clip the drawing surface to the silhouette so strokes outside
        // the body are never painted to the bitmap. Wrapped in save() so
        // applyCanvasClip can later restore() to pop this clip and install
        // a different one for a new pose.
        applyCanvasClip();
        attachDrawing();
    }

    /* Reset the canvas to a clean state (no drawings) and clip to the
       currently-selected pose's silhouette. Called once from buildCanvas
       and again whenever the user picks a new pose. The pre-existing
       drawing gets wiped — different pose, fresh canvas. */
    function applyCanvasClip() {
        if (canvasClipSaved) {
            // Pop the previous clip + scale state so we start from a
            // clean stack.
            ctx.restore();
            canvasClipSaved = false;
        }
        // The setTransform(1,0,0,1,0,0) + clearRect-in-pixel-space combo
        // wipes every pixel regardless of any leftover clip / transform.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Re-establish the dpr scale + line caps.
        const dpr = Math.max(2, window.devicePixelRatio || 1);
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // save() before clip() so the next applyCanvasClip can restore()
        // back to this clean state.
        ctx.save();
        ctx.clip(buildBodyPath());
        canvasClipSaved = true;
    }

    /* Public entry point for pose switching. Updates state, re-renders
       the silhouette SVG groups, and re-clips the canvas. Marking the
       chosen pose-btn active is left to the caller (attachPosePicker
       handles it). */
    function applyPose(poseId) {
        if (!POSES[poseId]) return;
        state.pose = poseId;
        saveState();
        /* trackClearDrawing — switching pose clears the drawing surface,
           so the per-drawing color tally needs to reset along with it
           (matches the same reset that clearCanvas does). */
        trackClearDrawing();
        renderPoseDom(POSES[poseId]);
        applyCanvasClip();
        /* Keep the pose picker's active button in sync so programmatic
           callers (default-Groodle starters, future scripted demos)
           don't leave the UI showing the wrong pose. The picker's own
           click handler still flips the active class redundantly, which
           is harmless. */
        document.querySelectorAll('.pose-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.pose === poseId);
        });
    }

    /* Convert pointer event coords to logical canvas coords (0..400, 0..600).
       Uses cachedRect when available (during an active stroke) so
       pointermove doesn't force a layout each event; falls back to a fresh
       read for one-off uses. */
    function getPos(e) {
        const rect = cachedRect || canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (STAGE_W / rect.width),
            y: (e.clientY - rect.top) * (STAGE_H / rect.height)
        };
    }

    function attachDrawing() {
        canvas.addEventListener('pointerdown', (e) => {
            /* Drawing is always on (no explicit "draw mode" gate). The
               canvas's touch-action: pan-y means the browser routes
               mostly-vertical drags to page scroll instead of firing
               pointer events here, so a thumb passing through the
               silhouette to scroll still works. Horizontal / diagonal
               drags get captured for strokes. Drawing remains active
               during dance — the kid can keep editing while the
               creature grooves. */
            try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
            /* Cache the rect once per stroke so subsequent pointermove
               events skip the getBoundingClientRect layout read. */
            cachedRect = canvas.getBoundingClientRect();
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
                /* Only the kid's actively-selected colors count toward
                   Rainbow Day / Color Curator — SURPRISE-painted regions
                   don't, which is why this lives on pointer events rather
                   than at the fill site of drawSurprise. */
                trackColorUsed(currentColor);
            }
            /* Only preventDefault when we're actually capturing the stroke.
               Calling it unconditionally on every touch would suppress the
               browser's gesture inference (and isn't needed: touch-action
               already gates scroll/zoom). */
            e.preventDefault();
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!isDrawing) return;
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
            if (isDrawing) trackStroke();
            isDrawing = false;
            cachedRect = null;
            try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        };
        canvas.addEventListener('pointerup', endStroke);
        canvas.addEventListener('pointercancel', endStroke);
        canvas.addEventListener('pointerleave', () => {
            if (isDrawing) trackStroke();
            isDrawing = false;
            cachedRect = null;
        });
    }

    function clearCanvas() {
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
        /* Wipe the per-drawing color tally so Rainbow Day resets cleanly
           when the kid starts over. trackClearDrawing is a no-op for
           any other counters. */
        if (state) trackClearDrawing();
        /* If a coloring-book page is loaded, re-stamp its template so
           CLEAR resets to "freshly outlined" instead of fully blank. */
        if (currentPageId) {
            const page = PAGE_BY_ID[currentPageId];
            if (page) page.draw(ctx);
        }
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

    /* Pose picker — generated from POSES so adding a new entry to the
       dictionary above grows the UI automatically. Each tap calls
       applyPose() which wipes the canvas + re-renders the silhouette
       + re-clips. */
    function buildPosePicker() {
        const root = document.getElementById('posePicker');
        if (!root) return;
        root.innerHTML = '';
        const currentId = (state && state.pose) || 'standing';
        Object.keys(POSES).forEach((id) => {
            const pose = POSES[id];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pose-btn' + (id === currentId ? ' active' : '');
            btn.dataset.pose = id;
            btn.setAttribute('aria-label', pose.name + ' pose');
            btn.innerHTML =
                '<span class="pose-icon" aria-hidden="true">' + pose.icon + '</span>' +
                '<span class="pose-name"></span>';
            btn.querySelector('.pose-name').textContent = pose.name;
            btn.addEventListener('click', () => {
                applyPose(id);
                root.querySelectorAll('.pose-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            root.appendChild(btn);
        });
    }

    /* ============ SURPRISE ============ */

    /* A goofy default character so kids can press DANCE immediately. The
       silhouette clip-path takes care of trimming any overflow. */
    function drawSurprise() {
        trackSurpriseUsed();
        /* SURPRISE explicitly nulls the active page so clearCanvas's
           page re-stamp doesn't fight with the new artwork. */
        currentPageId = null;
        clearCanvas();

        // Skin tone fill across the whole body silhouette
        ctx.fillStyle = '#fcbf49';
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);

        // Shirt: green band over the torso
        ctx.fillStyle = '#43aa8b';
        ctx.fillRect(0, BODY.shirtTop, STAGE_W, BODY.shirtBot - BODY.shirtTop);

        // Pants
        ctx.fillStyle = '#1d3557';
        ctx.fillRect(0, BODY.waistY, STAGE_W, BODY.pantsBot);

        // Shirt logo: white badge with red star on chest
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(BODY.cx, BODY.chestY, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e63946';
        ctx.font = 'bold 32px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', BODY.cx, BODY.chestY + 2);

        // Eyes
        ctx.fillStyle = '#1a0f33';
        ctx.beginPath(); ctx.arc(BODY.cx - BODY.eyeDX, BODY.eyeY, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(BODY.cx + BODY.eyeDX, BODY.eyeY, 7, 0, Math.PI * 2); ctx.fill();

        // Smile
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#1a0f33';
        ctx.beginPath();
        ctx.arc(BODY.cx, BODY.mouthY, 18, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();

        // Cheeks
        ctx.fillStyle = 'rgba(230, 57, 70, 0.55)';
        ctx.beginPath(); ctx.arc(BODY.cx - BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(BODY.cx + BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); ctx.fill();

        // Hair tufts on top of head
        ctx.fillStyle = '#7209b7';
        for (let i = 0; i < 5; i++) {
            const x = BODY.cx - 38 + i * 19;
            ctx.beginPath();
            ctx.moveTo(x, BODY.hairBaseY);
            ctx.lineTo(x + 8, BODY.hairTipY);
            ctx.lineTo(x + 16, BODY.hairBaseY);
            ctx.closePath();
            ctx.fill();
        }
    }

    /* ============ DANCE ============ */

    /* Updates the playBtn so it reads as ▶ DANCE when idle and ■ STOP
       when playing. The current dock layout uses inner spans on the
       button, so this function updates the `.dock-label` text rather
       than the button's textContent (which would wipe the spans). The
       button also carries `is-stop` + `aria-pressed` for state-aware
       CSS / a11y. */
    function setPlayBtnState(playing) {
        const playBtn = document.getElementById('playBtn');
        if (!playBtn) return;
        playBtn.classList.toggle('is-stop', playing);
        playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
        const labelEl = playBtn.querySelector('.dock-label');
        if (labelEl) {
            labelEl.textContent = playing ? 'Stop' : 'Dance';
        } else {
            playBtn.textContent = playing ? '■ STOP' : '▶ DANCE';
        }
    }

    function startDance() {
        if (isPlaying) return;
        /* Pressing DANCE finishes the current drawing (commits it as a
           groodle). drawingsFinished and First/Five Groodle hinge on this
           — it's the only moment in the game with a clear "I'm done"
           signal from the kid. */
        trackDrawingFinished();
        trackBeatExperienced(BEATS[currentBeatIdx]);
        /* Pressing DANCE while a coloring-book page is active also counts
           as finishing that page — unlocks its per-page achievement (and
           the Coloring Master master achievement at the 6th completion). */
        if (currentPageId) trackPageCompleted(currentPageId);
        ensureAudio();
        const begin = () => {
            isPlaying = true;
            danceSessionStart = Date.now();
            /* body.dancing handles all the visibility toggling now:
                 * tool-dock → hidden
                 * dance-dock → shown
                 * title-overlay → faded
                 * currency-pill → faded
               Drawing stays enabled during dance — the kid can keep
               editing while the creature grooves. */
            document.body.classList.add('dancing');
            /* The dance dock carries the `hidden` attribute so it doesn't
               flash on first paint; flip it off here so the STOP button
               is reachable. stopDance restores the flag. */
            if (danceDockEl) danceDockEl.hidden = false;
            /* If a drawer was open when DANCE was tapped, close it so
               the dance composition is clean. The Beat drawer is still
               reachable mid-dance via the dance-dock. */
            closeDrawer();
            setPlayBtnState(true);
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
        if (danceSessionStart) {
            trackDanceSession((Date.now() - danceSessionStart) / 1000);
            danceSessionStart = 0;
        }
        stopAudio();
        document.body.classList.remove('dancing');
        if (danceDockEl) danceDockEl.hidden = true;
        setPlayBtnState(false);
        creature.style.transform = '';
        if (floorEl) {
            floorEl.style.transform = 'translateX(-50%)';
            floorEl.style.opacity = '';
        }
        if (bubbleEl) {
            bubbleEl.style.opacity = '0';
            bubbleEl.style.transform = '';
            bubbleEl._pulseStart = null;
        }
    }

    function togglePlay() {
        if (isPlaying) stopDance(); else startDance();
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
    /* Rigid-body dance (the whole creature — silhouette + the kid's
       drawing + hat — transforms as one sprite; transform-origin is
       the feet so squash/spin pivot off the floor). True per-limb
       articulation is a post-launch v2 — see PLAY_STORE_PLAN.md.

       The juice comes from three classic animation principles applied
       to the wrapper transform:
         * a snappy hop ARC (sin, not |sin|, so the figure spends real
           time airborne instead of vibrating),
         * ANTICIPATION — a crouch + widen just before each launch,
         * SQUASH & STRETCH — stretch tall at the apex, splat wide on
           the landing/anticipation, roughly volume-preserving so it
           reads as weight, not scaling. */
    function applyMove(move, beats) {
        const ph = beats - Math.floor(beats);          // 0..1 within the beat
        const barBeat = Math.floor(beats) % 4;          // which beat of 4
        const hop = Math.sin(Math.PI * ph);             // 0→1→0 jump arc
        /* anticipation: ramp 0→1 over the last 18% of the beat */
        const antic = ph > 0.82 ? (ph - 0.82) / 0.18 : 0;
        /* landing impact: strong spike right at ground contact */
        const land = Math.pow(Math.max(0, 1 - ph * 6), 2);
        /* combined ground-squash amount (0 mid-air, 1 splatted) */
        const gsq = Math.max(antic * 0.75, land);

        let ty = 0, rot = 0, sx = 1, sy = 1, tx = 0;

        if (move === 'BOUNCE') {
            ty = -hop * 58 + antic * 12;
            sy = 1 + hop * 0.13 - gsq * 0.22;
            sx = 1 - hop * 0.09 + gsq * 0.22;
            rot = Math.sin(beats * Math.PI) * 2;
        } else if (move === 'TWIST') {
            const swiv = Math.sin(beats * Math.PI);     // hip swivel, 2-beat period
            rot = swiv * 16;
            tx = swiv * 8;
            ty = -hop * 22;
            sy = 1 + hop * 0.06 - gsq * 0.12;
            sx = 1 - hop * 0.04 + gsq * 0.12;
        } else if (move === 'DISCO') {
            const step = Math.sin(beats * Math.PI / 2); // slow 4-beat side-step
            tx = step * 30;
            rot = step * 11;
            ty = -hop * 34;
            sy = 1 + hop * 0.11 - gsq * 0.17;
            sx = 1 - hop * 0.08 + gsq * 0.17;
            /* every 4th beat: a quick scaleX flip-and-back reads as a
               spin/turn (figure goes edge-on at mid-beat then back). */
            if (barBeat === 3) sx *= Math.cos(ph * Math.PI * 2);
        } else if (move === 'PARTY') {
            ty = -hop * 72;
            sy = 1 + hop * 0.17 - gsq * 0.28;
            sx = 1 - hop * 0.13 + gsq * 0.28;
            rot = Math.sin(beats * Math.PI * 2) * 11;
            tx = Math.sin(beats * Math.PI) * 16;
            /* every 4th beat: a full cartwheel spin around the feet */
            if (barBeat === 3) rot += ph * 360;
        }

        const parts = [];
        if (tx) parts.push('translateX(' + tx.toFixed(2) + 'px)');
        if (ty) parts.push('translateY(' + ty.toFixed(2) + 'px)');
        if (rot) parts.push('rotate(' + rot.toFixed(2) + 'deg)');
        if (sx !== 1 || sy !== 1) parts.push('scale(' + sx.toFixed(3) + ', ' + sy.toFixed(3) + ')');
        creature.style.transform = parts.join(' ');

        if (floorEl) {
            /* Shadow shrinks + fades as the figure leaves the ground,
               darkens + spreads on the squashed landing. */
            const sc = 1 - hop * 0.34 + gsq * 0.10;
            floorEl.style.transform = 'translateX(-50%) scaleX(' + sc.toFixed(3) + ')';
            floorEl.style.opacity = (0.34 + (1 - hop) * 0.5).toFixed(3);
        }

        if (bubbleEl && bubbleEl._pulseStart != null) {
            const elapsed = (audioCtx.currentTime - bubbleEl._pulseStart);
            const k = Math.max(0, 1 - elapsed / 0.18);
            bubbleEl.style.opacity = String(k);
            bubbleEl.style.transform = 'scale(' + (1 + (1 - k) * 0.6) + ')';
        }
    }

    function scheduleBubblePulse(when) {
        const delay = Math.max(0, (when - audioCtx.currentTime) * 1000);
        setTimeout(() => {
            if (!bubbleEl || !isPlaying) return;
            bubbleEl._pulseStart = audioCtx.currentTime;
            bubbleEl.style.opacity = '1';
            bubbleEl.style.transform = 'scale(1)';
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

        document.getElementById('openAchievementsBtn').addEventListener('click', openAchievements);
        document.getElementById('openHatShopBtn').addEventListener('click', openHatShop);
        const pagesBtn = document.getElementById('openPagesBtn');
        if (pagesBtn) pagesBtn.addEventListener('click', openPagesPicker);
        const galleryBtn = document.getElementById('openGalleryBtn');
        if (galleryBtn) galleryBtn.addEventListener('click', openGallery);
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) saveBtn.addEventListener('click', openSaveDialog);
        if (saveModalSubmitEl) {
            saveModalSubmitEl.addEventListener('click', submitGroodle);
        }
        if (saveModalInputEl) {
            saveModalInputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitGroodle();
            });
        }

        document.getElementById('eraserBtn').addEventListener('click', () => {
            isErasing = !isErasing;
            const btn = document.getElementById('eraserBtn');
            btn.classList.toggle('active', isErasing);
            if (isErasing) {
                trackEraserUsed();
                document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            } else {
                const sw = document.querySelector('.swatch[data-color="' + currentColor + '"]');
                if (sw) sw.classList.add('active');
            }
        });

        /* playBtn is a toggle: ▶ DANCE → ■ STOP. The dance-dock still
           carries a redundant ■ STOP exit so kids who already learned that
           path keep working. */
        document.getElementById('playBtn').addEventListener('click', togglePlay);
        document.getElementById('stopBtn').addEventListener('click', stopDance);

        document.getElementById('moveBtn').addEventListener('click', () => {
            currentMoveIdx = (currentMoveIdx + 1) % MOVES.length;
            updateMoveBeatLabels();
        });
        document.getElementById('beatBtn').addEventListener('click', () => {
            currentBeatIdx = (currentBeatIdx + 1) % BEATS.length;
            trackBeatExperienced(BEATS[currentBeatIdx]);
            updateMoveBeatLabels();
        });
    }

    function init() {
        /* Persistence first: every other init step may want to read or
           write state (the palette wiring tracks color usage, etc.).
           loadState falls back to defaults if storage is unavailable, so
           this never throws. */
        state = loadState();
        currencyPillEl = document.getElementById('currencyPill');
        currencyValueEl = document.getElementById('currencyValue');
        toastContainerEl = document.getElementById('toastContainer');
        achievementsModalEl = document.getElementById('achievementsModal');
        achievementsListEl = document.getElementById('achievementsList');
        achievementsStatsEl = document.getElementById('achievementStats');
        hatShopModalEl = document.getElementById('hatShopModal');
        hatShopGridEl = document.getElementById('hatShopGrid');
        hatShopBalanceEl = document.getElementById('hatShopBalance');
        hatLayerInnerEl = document.getElementById('hatLayerInner');
        accessoryLayerInnerEl = document.getElementById('accessoryLayerInner');
        accessoryShopGridEl = document.getElementById('accessoryShopGrid');
        pagesModalEl = document.getElementById('pagesModal');
        pagesGridEl = document.getElementById('pagesGrid');
        saveModalEl = document.getElementById('saveModal');
        saveModalInputEl = document.getElementById('saveNameInput');
        saveModalSubmitEl = document.getElementById('saveSubmitBtn');
        saveModalStatusEl = document.getElementById('saveModalStatus');
        galleryModalEl = document.getElementById('galleryModal');
        galleryGridEl = document.getElementById('galleryGrid');
        drawerHostEl = document.getElementById('drawerHost');
        if (achievementsModalEl) attachModalDismissers(achievementsModalEl);
        if (hatShopModalEl) attachModalDismissers(hatShopModalEl);
        if (pagesModalEl) attachModalDismissers(pagesModalEl);
        if (saveModalEl) attachModalDismissers(saveModalEl);
        if (galleryModalEl) attachModalDismissers(galleryModalEl);
        attachDrawerHostDismissers();
        attachDockButtons();
        attachDockTooltips();
        renderCurrency();
        renderEquippedHat();
        renderEquippedAccessory();
        attachWardrobeTabs();
        trackVisit();

        /* Render the silhouette SVG for the saved pose BEFORE buildCanvas
           runs — buildCanvas reads posePathD(getCurrentPose()) for its
           clip, so the canvas-level drawable area lines up with what the
           kid sees onscreen. */
        renderPoseDom(getCurrentPose());
        buildCanvas();
        buildPalette();
        buildSizes();
        attachBgPicker();
        buildPosePicker();
        buildStarterGrid();
        attachHandlers();
        updateMoveBeatLabels();
        floorEl = document.getElementById('stageFloor');
        bubbleEl = document.getElementById('beatBubble');
        danceDockEl = document.getElementById('danceDock');

        /* Defensive: if a returning user is on a release where the
           achievement catalog grew, retroactively unlock anything their
           historic counters already satisfy. Also fires Bedhead when
           bedheadEligible is true from the trackVisit above. */
        checkAchievements();

        /* Global Escape closes whatever modal / drawer is open. */
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (openModalEl) closeModal();
            else if (openDrawerEl) closeDrawer();
        });

        /* Stop the dance when the tab/app goes to the background. RAF
           naturally pauses on hidden tabs, but the audio scheduler's
           setInterval continues to fire and the Web Audio context can keep
           emitting whatever was already queued. Calling stopDance is the
           predictable choice: when the kid comes back, they tap DANCE
           again and the loop restarts at step 0 instead of resuming from
           some indeterminate phase. */
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isPlaying) stopDance();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* Service worker registration — purely a progressive enhancement.
       The game runs fine without it; with it, the shell is cached so
       reopens are instant and offline-capable. Registered after the
       load event so it doesn't compete with first-paint asset fetches
       for bandwidth on slow connections.

       Skipped on file:// (no SW context) and on protocols that don't
       support secure origins. Failures are swallowed silently — a
       registration error must not break the game. */
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => {
                /* swallow — SW is optional */
            });
        });
    }
})();
