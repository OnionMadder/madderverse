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

    /* The 6 shapes that form the silhouette. Must stay in sync with the
       <clipPath id="bodyClip">, <g class="silhouette-fill">, and
       <g class="silhouette-outline"> blocks in index.html — same numbers,
       same transforms. Used by buildBodyPath() to clip the canvas so the
       kid literally cannot paint outside the body. */
    const BODY_SHAPES = [
        { type: 'circle', cx: 200, cy: 100, r: 58 },
        { type: 'rect',   x: 155,  y: 148,   w: 90, h: 232, r: 42 },
        { type: 'rect',   x: -18,  y: -160,  w: 36, h: 172, r: 18, tx: 165, ty: 180, rot: -52 },
        { type: 'rect',   x: -18,  y: -160,  w: 36, h: 172, r: 18, tx: 235, ty: 180, rot:  52 },
        { type: 'rect',   x: -17,  y: 0,     w: 34, h: 208, r: 17, tx: 180, ty: 370, rot:  -8 },
        { type: 'rect',   x: -17,  y: 0,     w: 34, h: 208, r: 17, tx: 220, ty: 370, rot:   8 }
    ];

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
            longestDanceSec: 0
        },
        hats: {
            owned: ['no-hat'],
            equipped: 'no-hat'
        }
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
          check: () => state.counters.hasUsedSurprise }
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
        openModal(hatShopModalEl);
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
    function addRoundRect(path, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        path.moveTo(x + r, y);
        path.lineTo(x + w - r, y);
        path.arcTo(x + w, y, x + w, y + r, r);
        path.lineTo(x + w, y + h - r);
        path.arcTo(x + w, y + h, x + w - r, y + h, r);
        path.lineTo(x + r, y + h);
        path.arcTo(x, y + h, x, y + h - r, r);
        path.lineTo(x, y + r);
        path.arcTo(x, y, x + r, y, r);
        path.closePath();
    }

    /* Build the union-of-shapes silhouette as one Path2D, in the canvas's
       logical 400x600 coordinate system. Each shape's transform mirrors
       the SVG: SVG "translate(tx ty) rotate(rot)" means rotate-about-origin
       first, THEN translate — which is exactly the matrix you get by
       calling translateSelf followed by rotateSelf on an identity DOMMatrix
       (post-multiplication: M = T * R, applied as M*p = T*(R*p)). */
    function buildBodyPath() {
        const path = new Path2D();
        for (let i = 0; i < BODY_SHAPES.length; i++) {
            const s = BODY_SHAPES[i];
            const sub = new Path2D();
            if (s.type === 'circle') {
                sub.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
            } else if (s.type === 'rect') {
                addRoundRect(sub, s.x, s.y, s.w, s.h, s.r || 0);
            }
            if (s.tx != null || s.ty != null || s.rot != null) {
                const m = new DOMMatrix();
                if (s.tx || s.ty) m.translateSelf(s.tx || 0, s.ty || 0);
                if (s.rot) m.rotateSelf(s.rot);
                path.addPath(sub, m);
            } else {
                path.addPath(sub);
            }
        }
        return path;
    }

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
        // the body are never painted to the bitmap (not just visually masked
        // by CSS clip-path). This is the source of truth for "the drawable
        // area" — drawing a wide brush near the edge gets cleanly cropped,
        // dragging outside the body simply paints nothing, and the eraser
        // can only ever act on pixels that are actually visible.
        ctx.clip(buildBodyPath());
        attachDrawing();
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
               drags get captured for strokes. */
            if (isPlaying) return;
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
        trackSurpriseUsed();
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
        /* Pressing DANCE finishes the current drawing (commits it as a
           groodle). drawingsFinished and First/Five Groodle hinge on this
           — it's the only moment in the game with a clear "I'm done"
           signal from the kid. */
        trackDrawingFinished();
        trackBeatExperienced(BEATS[currentBeatIdx]);
        ensureAudio();
        const begin = () => {
            isPlaying = true;
            danceSessionStart = Date.now();
            /* body.dancing handles all the visibility toggling now:
                 * tool-dock → hidden
                 * dance-dock → shown
                 * title-overlay → faded
                 * currency-pill → faded
                 * draw-canvas → pointer-events: none
               (CSS rules in style.css under each element.) */
            document.body.classList.add('dancing');
            /* If a drawer was open when DANCE was tapped, close it so
               the dance composition is clean. The Beat drawer is still
               reachable mid-dance via the dance-dock. */
            closeDrawer();
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

        /* Motion magnitudes roughly doubled vs the prior compact-stage
           values. The full-viewport figure is ~50% larger in absolute
           px on a phone, so the old 14 px bounce was reading as ~2 %
           of figure height. Pumping these up plus dropping the CSS
           transition smoother gives motion that's actually visible at
           an arm's-length viewing distance. */
        if (move === 'BOUNCE') {
            ty = -bouncePulse * 32;
            sy = 1 - bouncePulse * 0.12;
            sx = 1 + bouncePulse * 0.12;
        } else if (move === 'TWIST') {
            rot = Math.sin(halfPhase) * 14;
            ty = -bouncePulse * 18;
            sy = 1 - bouncePulse * 0.08;
        } else if (move === 'DISCO') {
            const swing = Math.sin(beatPhase);
            rot = swing * 18;
            ty = -bouncePulse * 26;
            sy = 1 - bouncePulse * 0.14;
            sx = 1 + bouncePulse * 0.14;
            tx = swing * 10;
        } else if (move === 'PARTY') {
            const swing = Math.sin(beatPhase);
            const flap = Math.sin(beatPhase * 2);
            rot = swing * 22 + flap * 8;
            ty = -bouncePulse * 44;
            sy = 1 - bouncePulse * 0.22;
            sx = 1 + bouncePulse * 0.22;
            tx = swing * 18;
        }

        const parts = [];
        if (tx) parts.push('translateX(' + tx.toFixed(2) + 'px)');
        if (ty) parts.push('translateY(' + ty.toFixed(2) + 'px)');
        if (rot) parts.push('rotate(' + rot.toFixed(2) + 'deg)');
        if (sx !== 1 || sy !== 1) parts.push('scale(' + sx.toFixed(3) + ', ' + sy.toFixed(3) + ')');
        creature.style.transform = parts.join(' ');

        if (floorEl) {
            const sc = 1 - bouncePulse * 0.18;
            floorEl.style.transform = 'translateX(-50%) scaleX(' + sc + ')';
            floorEl.style.opacity = String(0.55 + bouncePulse * 0.35);
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

        document.getElementById('playBtn').addEventListener('click', startDance);
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
        drawerHostEl = document.getElementById('drawerHost');
        if (achievementsModalEl) attachModalDismissers(achievementsModalEl);
        if (hatShopModalEl) attachModalDismissers(hatShopModalEl);
        attachDrawerHostDismissers();
        attachDockButtons();
        renderCurrency();
        renderEquippedHat();
        trackVisit();

        buildCanvas();
        buildPalette();
        buildSizes();
        attachBgPicker();
        attachHandlers();
        updateMoveBeatLabels();
        floorEl = document.getElementById('stageFloor');
        bubbleEl = document.getElementById('beatBubble');

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
})();
