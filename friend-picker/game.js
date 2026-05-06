document.addEventListener('DOMContentLoaded', () => {

    const container = document.getElementById('game-container');
    const hand = document.getElementById('hand');
    const scoreDisplay = document.getElementById('score');
    const startBtn = document.getElementById('start-btn');
    const resetBtn = document.getElementById('reset-btn');
    const muteBtn = document.getElementById('mute-btn');

    // ----- Friend sprite atlases (two sheets, 6 friends each = 12 total) -----
    const FRIEND_SHEETS = [
        {
            sheetUrl: 'https://fymz.lol/friend-picker/assets/img/friends-one.png',
            atlasUrl: 'https://fymz.lol/friend-picker/assets/img/friends-one.json'
        },
        {
            sheetUrl: 'https://fymz.lol/friend-picker/assets/img/friends-two.png',
            atlasUrl: 'https://fymz.lol/friend-picker/assets/img/friends-two.json'
        }
    ];

    // Gender mapping drives which reaction-sound bank fires when a friend is picked.
    // Best-guess from sprite art + names — confirm/correct any of these.
    const FRIEND_GENDER = {
        // friends-one
        andy: 'male', angel: 'female', carlton: 'male',
        carol: 'female', frank: 'male', moses: 'male',
        // friends-two
        quantrell: 'male', seymour: 'male', skanda: 'male',
        srini: 'female', starla: 'female', zed: 'male'
    };

    function genderOf(name) {
        return FRIEND_GENDER[name] || 'male';
    }

    // Target display height for friends — widths follow each sprite's own aspect.
    // Kept modest so 12 friends + the side HUD don't overcrowd the playfield.
    let HEAD_H = 110;
    // The face/nose sits in the upper portion of each portrait — used for pick centers.
    const NOSE_Y_RATIO = 0.32;

    function computeHeadHeight() {
        const cw = container.clientWidth;
        HEAD_H = Math.round(Math.max(92, Math.min(140, cw * 0.105)));
    }

    // ----- Hand sprite atlas (hardcoded — only 4 frames, no fetch needed) -----
    const HANDS_SHEET_URL = 'https://fymz.lol/friend-picker/assets/img/hands.png';
    const HANDS_SHEET_W = 1003;
    const HANDS_SHEET_H = 753;
    // Frame definitions + fingertip anchor (% of the frame) for each hand pose.
    // Fingertip percentages locate where the pinch-tip lands so we can pin that
    // point to the friend's nose. Tweak if a frame visually disagrees.
    const HAND_FRAMES = {
        'left-one':  { x: 1,   y: 1,   w: 500, h: 375, tipX: 78, tipY: 38 },
        'left-two':  { x: 502, y: 1,   w: 500, h: 375, tipX: 70, tipY: 42 },
        'right-one': { x: 1,   y: 377, w: 500, h: 375, tipX: 22, tipY: 38 },
        'right-two': { x: 502, y: 377, w: 500, h: 375, tipX: 30, tipY: 42 }
    };
    const HAND_DISPLAY_W = 160;  // rendered width of the hand sprite
    const HAND_DISPLAY_H = Math.round(HAND_DISPLAY_W * 375 / 500);

    const PICK_RADIUS = 64;
    const FLEE_RADIUS = 130;
    const MAX_SPEED = 200;
    const PANIC_SPEED = 360;
    const FLEE_FORCE = 480;
    const DAMPING = 0.965;
    const SPEED_CAP_MULT = 1.25;
    // ----- Level / progression rules -----
    const LEVEL_DURATION_MS = 30000;
    const TARGET_FRIEND_COUNT = 12;
    const BOOGER_GOAL = 30;             // hit this and the round ends successfully
    // ~0.7% per pick. Over 30 picks that's ~19% chance per game — about a
    // "1 in 5 games" hit rate, with the occasional lucky double.
    const SPECIAL_CHANCE = 0.007;

    // Generic booger types just drive the CSS color of the pop animation.
    const BOOGER_TYPES = [
        { id: 'classic' },
        { id: 'dark' },
        { id: 'bright' },
        { id: 'goopy' },
        { id: 'crusty' }
    ];

    // Booger friends spritesheet — 4 unique friends.
    const BOOGER_SHEET_URL  = 'https://fymz.lol/friend-picker/assets/img/boogers.png';
    const BOOGER_ATLAS_URL  = 'https://fymz.lol/friend-picker/assets/img/boogers.json';
    let BOOGER_FRAMES = null;       // populated by fetchBoogerAtlas()
    let BOOGER_SHEET_W = 790;
    let BOOGER_SHEET_H = 770;

    // The actual 4 special booger friends.
    const SPECIAL_BOOGER_FRIENDS = [
        {
            id: 'dingus-mctweet',
            name: 'DINGUS MCTWEET',
            color: '#a37b54',
            lore: 'Spends his days posting incoherent missives from a sticky perch. Hat is non-negotiable.'
        },
        {
            id: 'fifi-mcfluff',
            name: 'FIFI MCFLUFF',
            color: '#d8d4cc',
            lore: 'Soft and powdery, with a flair for the dramatic. Writes poetry no one will ever read.'
        },
        {
            id: 'mister-dandy',
            name: 'MISTER DANDY',
            color: '#7fa15d',
            lore: 'A booger of refined taste. Insists on the proper bowtie at all hours of the day.'
        },
        {
            id: 'greasy-gary',
            name: 'GREASY GARY',
            color: '#5fb3b8',
            lore: 'Slick, shiny, and surprisingly chipper. Glides through the world with a wink.'
        }
    ];

    function pickBoogerType() {
        return BOOGER_TYPES[Math.floor(Math.random() * BOOGER_TYPES.length)];
    }

    // Fetch the booger spritesheet atlas once at boot — no need to gate on START.
    fetch(BOOGER_ATLAS_URL)
        .then(r => r.ok ? r.json() : Promise.reject(new Error('Booger atlas HTTP ' + r.status)))
        .then(atlas => {
            BOOGER_FRAMES = {};
            Object.entries(atlas.frames).forEach(([id, data]) => {
                BOOGER_FRAMES[id] = data.frame;
            });
            BOOGER_SHEET_W = atlas.meta.size.w;
            BOOGER_SHEET_H = atlas.meta.size.h;
            console.log(`[friend-picker] Booger atlas loaded: ${Object.keys(BOOGER_FRAMES).length} friends`);
        })
        .catch(err => console.error('[friend-picker] Booger atlas fetch failed:', err));

    // Render the friend's booger frame as a background on `el` at the given square size.
    // Returns true if the sprite was applied (atlas loaded and id known), else false.
    function applyBoogerSprite(el, friendId, sizePx) {
        if (!BOOGER_FRAMES) return false;
        const frame = BOOGER_FRAMES[friendId];
        if (!frame) return false;
        const scale = sizePx / frame.h;
        el.style.backgroundImage = `url('${BOOGER_SHEET_URL}')`;
        el.style.backgroundSize = `${BOOGER_SHEET_W * scale}px ${BOOGER_SHEET_H * scale}px`;
        el.style.backgroundPosition = `${-frame.x * scale}px ${-frame.y * scale}px`;
        el.style.backgroundRepeat = 'no-repeat';
        return true;
    }

    function formatCollectionDate(d) {
        d = d || new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}.${d.getFullYear()}`;
    }

    let score = 0;
    let headsArray = [];
    let gameRunning = false;
    let pointerX = -9999;
    let pointerY = -9999;
    let lastFrame = 0;
    let levelEndAt = 0;
    let levelTimerId = null;
    let levelOver = false;
    const timerDisplay = document.getElementById('timer');
    const revealOverlay = document.getElementById('reveal-overlay');
    const revealTitle = document.getElementById('reveal-title');
    const revealStats = document.getElementById('reveal-stats');
    const revealFriendsGrid = document.getElementById('reveal-friends-grid');
    const playAgainBtn = document.getElementById('play-again');
    const reticle = document.getElementById('reticle');
    const endBtn = document.getElementById('end-btn');
    const revealBackBtn = document.getElementById('reveal-back');
    const friendsCollectedList = document.getElementById('friends-collected-list');
    const collectedFriends = []; // ids of specials collected this round, in pick order

    // ---------- Sound manager ----------
    // Each key maps to one or more files; playSound picks one at random per call.
    // Reaction sounds are split by gender — see FRIEND_GENDER below.
    const SOUND_BASE = 'https://fymz.lol/friend-picker/assets/audio/';
    const SOUND_BANK = {
        start:    ['start.mp3'],
        reset:    ['reset.mp3'],
        teleport: ['teleport.mp3'],
        pick:     ['pick-one.mp3', 'pick-two.mp3', 'pick-three.mp3', 'pick-four.mp3'],
        flyoff:   ['flyoff-one.mp3', 'flyoff-two.mp3', 'flyoff-three.mp3', 'flyoff-four.mp3'],
        miss:     ['miss-one.mp3', 'miss-two.mp3', 'miss-three.mp3'],
        booger:   ['booger-one.mp3', 'booger-two.mp3'],
        'react-male': [
            'male-confusion-one.mp3', 'male-confusion-two.mp3', 'male-crying-one.mp3', 'male-crying-two.mp3',
            'male-crying-three.mp3', 'male-grunt-one.mp3', 'male-grunt-two.mp3', 'male-grunt-three.mp3',
            'male-huh-one.mp3', 'male-huh-two.mp3', 'male-huh-three.mp3',
            'male-disgust-one.mp3', 'male-disgust-two.mp3', 'male-disgust-three.mp3',
            'male-yummy-one.mp3', 'male-yummy-two.mp3'
        ],
        'react-female': [
            'female-confusion-one.mp3', 'female-confusion-two.mp3', 'female-confusion-three.mp3',
            'female-disgust-one.mp3', 'female-laugh-one.mp3','female-laugh-two.mp3', 'female-laugh-three.mp3',
            'female-laugh-four.mp3', 'female-laugh-five.mp3', 'female-shock-one.mp3', 'female-shock-two.mp3',
            'female-shock-one.mp3', 'female-shock-two.mp3', 'female-shock-three.mp3', 'female-shock-four.mp3'
        ]
    };
    const sounds = {};
    let soundsEnabled = true;

    function preloadSounds() {
        Object.entries(SOUND_BANK).forEach(([key, files]) => {
            sounds[key] = files.map(file => {
                const a = new Audio();
                a.src = SOUND_BASE + file;
                a.preload = 'auto';
                a.volume = 0.6;
                a.addEventListener('error', () => { /* file missing — skip silently */ });
                return a;
            });
        });
    }

    function playSound(key) {
        if (!soundsEnabled) return;
        const bank = sounds[key];
        if (!bank || !bank.length) return;
        const src = bank[Math.floor(Math.random() * bank.length)];
        try {
            const clone = src.cloneNode(true);
            clone.volume = src.volume;
            const p = clone.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
    }

    function playReaction(gender) {
        playSound(gender === 'female' ? 'react-female' : 'react-male');
    }

    preloadSounds();

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            soundsEnabled = !soundsEnabled;
            muteBtn.textContent = 'SOUND: ' + (soundsEnabled ? 'ON' : 'OFF');
        });
    }

    // ---------- Trait pool — each friend gets 1-2 random traits ----------
    const TRAITS = [
        {
            name: 'zigzag',
            update(h, dt, ctx) {
                h.zigT = (h.zigT || 0) + dt;
                if (h.zigT > 0.25) {
                    h.zigT = 0;
                    h.vx += (Math.random() - 0.5) * 240;
                    h.vy += (Math.random() - 0.5) * 240;
                }
            }
        },
        {
            name: 'teleport',
            update(h, dt, ctx) {
                h.tpCd = (h.tpCd || 3 + Math.random() * 3) - dt;
                if (h.tpCd <= 0 && ctx.distance < 220) {
                    h.x = Math.random() * (ctx.w - h.w);
                    h.y = Math.random() * (ctx.h - h.h);
                    h.tpCd = 2 + Math.random() * 3;
                    flashTeleport(h);
                    playSound('teleport');
                }
            }
        },
        {
            name: 'spinner',
            update(h, dt) {
                h.rot = (h.rot || 0) + dt * 540;
            }
        },
        {
            name: 'jelly',
            update(h, dt) {
                h.jellyT = (h.jellyT || 0) + dt * 6;
                h.scaleX = 1 + Math.sin(h.jellyT) * 0.25;
                h.scaleY = 1 + Math.cos(h.jellyT * 1.2) * 0.25;
            }
        },
        {
            name: 'panic',
            update(h, dt, ctx) {
                if (ctx.distance < FLEE_RADIUS) {
                    h.vx *= 1.04;
                    h.vy *= 1.04;
                    h.shakeT = (h.shakeT || 0) + dt * 40;
                    h.offsetX = Math.sin(h.shakeT) * 4;
                    h.offsetY = Math.cos(h.shakeT * 1.3) * 4;
                } else {
                    h.offsetX = 0;
                    h.offsetY = 0;
                }
            }
        },
        {
            // Periodic in-character reaction sound + taunt bubble.
            name: 'taunter',
            update(h, dt, ctx) {
                h.tauntCd = (h.tauntCd || 4 + Math.random() * 4) - dt;
                if (h.tauntCd <= 0) {
                    showTaunt(h);
                    h.tauntCd = 5 + Math.random() * 5;
                    playReaction(h.gender);
                }
            }
        },
        {
            name: 'shrinker',
            update(h, dt, ctx) {
                if (ctx.distance < FLEE_RADIUS) {
                    h.shrink = Math.max(0.45, (h.shrink || 1) - dt * 0.6);
                } else {
                    h.shrink = Math.min(1, (h.shrink || 1) + dt * 0.4);
                }
            }
        },
        {
            name: 'sprinter',
            update(h, dt, ctx) {
                h.sprintCd = (h.sprintCd || 2 + Math.random() * 2) - dt;
                if (h.sprintCd <= 0 && ctx.distance < FLEE_RADIUS * 1.4) {
                    const ang = Math.atan2(h.y + h.noseY - ctx.py, h.x + h.w / 2 - ctx.px);
                    h.vx = Math.cos(ang) * PANIC_SPEED;
                    h.vy = Math.sin(ang) * PANIC_SPEED;
                    h.sprintCd = 3 + Math.random() * 3;
                }
            }
        },
        {
            name: 'wobble',
            update(h, dt) {
                h.wobT = (h.wobT || 0) + dt * 8;
                h.rot = Math.sin(h.wobT) * 25;
            }
        },
        {
            name: 'orbiter',
            update(h, dt, ctx) {
                if (ctx.distance < 260 && ctx.distance > 60) {
                    const dx = h.x + h.w / 2 - ctx.px;
                    const dy = h.y + h.noseY - ctx.py;
                    h.vx = -dy * 2.2;
                    h.vy = dx * 2.2;
                }
            }
        },
        {
            name: 'mirror',
            update(h, dt, ctx) {
                h.flip = ctx.px > h.x + h.w / 2 ? -1 : 1;
            }
        },
        {
            name: 'bouncer',
            update(h, dt) {
                h.bounceT = (h.bounceT || 0) + dt * 10;
                h.offsetY = (h.offsetY || 0) + Math.sin(h.bounceT) * 1.5;
            }
        },
        {
            name: 'ghost',
            update(h, dt, ctx) {
                if (ctx.distance < 120) {
                    h.alpha = Math.max(0.25, (h.alpha || 1) - dt * 1.5);
                } else {
                    h.alpha = Math.min(1, (h.alpha || 1) + dt * 0.8);
                }
            }
        },
        {
            name: 'flailer',
            update(h, dt) {
                h.flailT = (h.flailT || 0) + dt;
                if (h.flailT > 0.15) {
                    h.flailT = 0;
                    h.rot = (Math.random() - 0.5) * 90;
                }
            }
        }
    ];

    function pickTraits() {
        // One trait per friend keeps things readable and fair.
        const idx = Math.floor(Math.random() * TRAITS.length);
        return [TRAITS[idx]];
    }

    const TAUNTS = ['NOPE!', 'CAN\'T CATCH ME', 'HA HA', 'TOO SLOW', 'YIKES', 'BYE!', 'MISS', 'WEEEE'];

    function showTaunt(h) {
        const b = document.createElement('div');
        b.className = 'taunt-bubble';
        b.textContent = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
        b.style.left = (h.x + h.w / 2) + 'px';
        b.style.top = h.y + 'px';
        container.appendChild(b);
        setTimeout(() => b.remove(), 1300);
    }

    function flashTeleport(h) {
        h.el.style.transition = 'opacity 0.15s';
        h.el.style.opacity = '0';
        setTimeout(() => {
            h.el.style.opacity = h.alpha != null ? h.alpha : '1';
            setTimeout(() => { h.el.style.transition = ''; }, 160);
        }, 80);
    }

    // ---------- Level / timer ----------
    function clearCollected() {
        collectedFriends.length = 0;
        if (friendsCollectedList) friendsCollectedList.innerHTML = '';
    }

    function startLevel() {
        score = 0;
        levelOver = false;
        scoreDisplay.innerText = score;
        clearCollected();
        hideHand();
        document.querySelectorAll('.explode-bit, .booger').forEach(n => n.remove());
        if (reticle) {
            reticle.classList.remove('locked', 'hidden');
        }
        if (revealOverlay) revealOverlay.hidden = true;
        levelEndAt = performance.now() + LEVEL_DURATION_MS;
        updateTimerDisplay();
        if (levelTimerId) clearInterval(levelTimerId);
        levelTimerId = setInterval(updateTimerDisplay, 100);
    }

    function updateTimerDisplay() {
        const remainingMs = Math.max(0, levelEndAt - performance.now());
        const seconds = Math.ceil(remainingMs / 1000);
        if (timerDisplay) {
            timerDisplay.innerText = `0:${seconds.toString().padStart(2, '0')}`;
            timerDisplay.classList.toggle('warning', seconds <= 10 && seconds > 5);
            timerDisplay.classList.toggle('danger', seconds <= 5);
        }
        if (remainingMs <= 0 && !levelOver) {
            endLevel('time');
        }
    }

    function endLevel(reason) {
        levelOver = true;
        gameRunning = false;
        if (levelTimerId) { clearInterval(levelTimerId); levelTimerId = null; }
        // Hide the reticle so the system cursor is the visible pointer
        // for the reveal modal's PLAY AGAIN / END GAME buttons.
        if (reticle) reticle.classList.add('hidden');
        showReveal(score, reason);
    }

    function showReveal(boogerCount, reason) {
        if (revealTitle) {
            revealTitle.textContent = reason === 'goal'   ? 'FRIEND CREATED!'
                                    : reason === 'manual' ? 'GAME ENDED'
                                    : 'TIME\'S UP!';
        }
        if (revealStats) {
            const goalLine = boogerCount >= BOOGER_GOAL
                ? `Goal reached — a new friend has been forged!`
                : `${boogerCount} / ${BOOGER_GOAL} boogers picked.`;
            revealStats.innerHTML = `${goalLine}<br>${collectedFriends.length} special booger friend${collectedFriends.length === 1 ? '' : 's'} collected`;
        }
        if (revealFriendsGrid) {
            if (collectedFriends.length === 0) {
                revealFriendsGrid.innerHTML = `<p class="reveal-empty">No special booger friends found this round. Keep digging!</p>`;
            } else {
                const today = formatCollectionDate();
                revealFriendsGrid.innerHTML = collectedFriends.map((id, idx) => {
                    const f = SPECIAL_BOOGER_FRIENDS.find(x => x.id === id);
                    if (!f) return '';
                    return `
                        <div class="reveal-friend-card" style="animation-delay:${0.12 + idx * 0.18}s">
                            <div class="card-titlebar">
                                <span class="card-titlebar-icon">&#9733;</span>
                                NEW FRIEND
                                <span class="card-titlebar-icon">&#9733;</span>
                            </div>
                            <div class="card-body">
                                <div class="card-image" data-booger-id="${f.id}" style="--bf-color:${f.color}"></div>
                                <div class="card-name">${f.name}</div>
                                <dl class="card-meta">
                                    <dt>COLLECTED</dt><dd>${today}</dd>
                                    <dt>SPECIES</dt><dd>BOOGER FRIEND</dd>
                                    <dt>RARITY</dt><dd>&#9733;&#9733;&#9733;</dd>
                                </dl>
                                <div class="card-lore">&ldquo;${f.lore}&rdquo;</div>
                            </div>
                        </div>
                    `;
                }).join('');
                // Paint the booger sprite into each card's image slot.
                revealFriendsGrid.querySelectorAll('[data-booger-id]').forEach(el => {
                    applyBoogerSprite(el, el.dataset.boogerId, 110);
                });
            }
        }
        if (revealOverlay) revealOverlay.hidden = false;
    }

    if (playAgainBtn) {
        playAgainBtn.addEventListener('click', () => {
            if (revealOverlay) revealOverlay.hidden = true;
            playSound('start');
            fetchFriends();
            startLevel();
            gameRunning = true;
            lastFrame = performance.now();
            requestAnimationFrame(gameLoop);
        });
    }

    function placeReticleAtContainerCenter() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        pointerX = w / 2;
        pointerY = h / 2;
        if (reticle) {
            reticle.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0) translate(-50%, -50%)`;
        }
    }

    // ---------- In-page expand / collapse (no Fullscreen API) ----------
    // The "small window" landing layout is the default. Adding `.in-game` to
    // <body> tells the CSS to expand the playfield to fill the page; removing
    // it returns to the landing layout with the START button.
    function enterGameMode() {
        document.body.classList.add('in-game');
        // Layout shifted — recenter the reticle after the next paint.
        requestAnimationFrame(() => placeReticleAtContainerCenter());
    }

    function exitGameMode() {
        document.body.classList.remove('in-game');
    }

    // Page-swoosh boot transition — three colored pages whip across, one per
    // swish in start.mp3. Animation length is read from the audio's actual
    // duration so the visual lands exactly with the sound.
    function getStartSoundDuration() {
        const a = sounds.start && sounds.start[0];
        if (a && typeof a.duration === 'number' && isFinite(a.duration) && a.duration > 0.1) {
            return a.duration;
        }
        return 1.2; // fallback if metadata hasn't loaded yet
    }

    function showBootGlitch() {
        if (!container) return;
        const prev = container.querySelector('.boot-glitch');
        if (prev) prev.remove();

        const duration = getStartSoundDuration();
        const el = document.createElement('div');
        el.className = 'boot-glitch';
        el.style.setProperty('--boot-duration', duration + 's');
        el.innerHTML = `
            <div class="boot-panel boot-panel-1"></div>
            <div class="boot-panel boot-panel-2"></div>
            <div class="boot-panel boot-panel-3"></div>
        `;
        container.appendChild(el);
        setTimeout(() => el.remove(), duration * 1000 + 80);
    }

    // Stop the round, drop back to the landing layout, and re-arm START.
    function returnToLanding() {
        gameRunning = false;
        levelOver = true;
        if (levelTimerId) { clearInterval(levelTimerId); levelTimerId = null; }
        if (revealOverlay) revealOverlay.hidden = true;
        hideHand();
        document.querySelectorAll('.head, .explode-bit, .booger, .taunt-bubble').forEach(n => n.remove());
        headsArray = [];
        clearCollected();
        score = 0;
        if (scoreDisplay) scoreDisplay.innerText = score;
        if (timerDisplay) {
            timerDisplay.innerText = '0:30';
            timerDisplay.classList.remove('warning', 'danger');
        }
        if (reticle) reticle.classList.remove('locked');
        exitGameMode();
        if (startBtn) startBtn.style.display = '';
    }

    // ---------- Start / reset / end ----------
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            startBtn.style.display = 'none';
            enterGameMode();
            gameRunning = true;
            playSound('start');
            showBootGlitch();
            placeReticleAtContainerCenter();
            fetchFriends();
            startLevel();
            lastFrame = performance.now();
            requestAnimationFrame(gameLoop);
        });
    }

    if (resetBtn) {
        // Restart the current round — stay in the expanded game layout.
        resetBtn.addEventListener('click', () => {
            if (!document.body.classList.contains('in-game')) return;
            playSound('reset');
            if (revealOverlay) revealOverlay.hidden = true;
            fetchFriends();
            startLevel();
            if (!gameRunning) {
                gameRunning = true;
                lastFrame = performance.now();
                requestAnimationFrame(gameLoop);
            }
        });
    }

    if (endBtn) {
        // End the current round AND drop back to the landing screen.
        endBtn.addEventListener('click', returnToLanding);
    }

    if (revealBackBtn) {
        // Same — go back to landing from the end-of-game card.
        revealBackBtn.addEventListener('click', returnToLanding);
    }

    function fetchFriends() {
        Promise.all(FRIEND_SHEETS.map(s =>
            fetch(s.atlasUrl).then(r => {
                if (!r.ok) throw new Error('Atlas HTTP ' + r.status + ' at ' + s.atlasUrl);
                return r.json().then(atlas => ({ sheetUrl: s.sheetUrl, atlas }));
            })
        ))
        .then(loadedSheets => {
            const total = loadedSheets.reduce((n, s) => n + Object.keys(s.atlas.frames).length, 0);
            console.log(`[friend-picker] Loaded ${loadedSheets.length} atlas(es) with ${total} frames total`);
            setupGame(loadedSheets);
        })
        .catch(err => {
            console.error('[friend-picker] Atlas fetch failed:', err);
        });
    }

    function buildRoster(loadedSheets) {
        // Flatten all available frames into a single list, then trim/pad to TARGET_FRIEND_COUNT.
        const all = [];
        loadedSheets.forEach(({ sheetUrl, atlas }) => {
            const sheetW = atlas.meta.size.w;
            const sheetH = atlas.meta.size.h;
            Object.entries(atlas.frames).forEach(([name, data]) => {
                all.push({ name, frame: data.frame, sheetUrl, sheetW, sheetH });
            });
        });
        if (!all.length) return [];

        const roster = [];
        for (let i = 0; i < TARGET_FRIEND_COUNT; i++) {
            roster.push({ ...all[i % all.length], instanceId: i });
        }
        return roster;
    }

    function setupGame(loadedSheets) {
        document.querySelectorAll('.head, .taunt-bubble, .booger').forEach(n => n.remove());
        headsArray = [];

        computeHeadHeight();
        const w = container.clientWidth;
        const h = container.clientHeight;

        const roster = buildRoster(loadedSheets);

        roster.forEach(friend => {
            const f = friend.frame;
            // Single uniform scale, no integer rounding on dimensions — avoids
            // sub-pixel leaks of neighboring frames into the visible area.
            const scale = HEAD_H / f.h;
            const headW = f.w * scale;
            const headH = f.h * scale;
            const noseY = headH * NOSE_Y_RATIO;

            const bgSizeW = friend.sheetW * scale;
            const bgSizeH = friend.sheetH * scale;
            const bgPosX = -f.x * scale;
            const bgPosY = -f.y * scale;

            const div = document.createElement('div');
            div.className = 'head game-element';
            div.dataset.name = friend.name;
            div.dataset.instance = friend.instanceId;
            div.setAttribute('role', 'img');
            div.setAttribute('aria-label', friend.name);
            div.style.width = headW + 'px';
            div.style.height = headH + 'px';
            div.style.backgroundImage = `url('${friend.sheetUrl}')`;
            div.style.backgroundSize = `${bgSizeW}px ${bgSizeH}px`;
            div.style.backgroundPosition = `${bgPosX}px ${bgPosY}px`;

            const headObj = {
                el: div,
                name: friend.name,
                gender: genderOf(friend.name),
                w: headW,
                h: headH,
                noseY,
                x: Math.random() * Math.max(1, w - headW),
                y: Math.random() * Math.max(1, h - headH),
                vx: (Math.random() - 0.5) * MAX_SPEED * 0.6,
                vy: (Math.random() - 0.5) * MAX_SPEED * 0.6,
                rot: 0,
                scaleX: 1,
                scaleY: 1,
                shrink: 1,
                alpha: 1,
                flip: 1,
                offsetX: 0,
                offsetY: 0,
                traits: pickTraits(),
                alive: true
            };

            container.appendChild(div);
            headsArray.push(headObj);
        });
    }

    // ---------- Reticle / pointer handling ----------
    function updatePointerFromEvent(clientX, clientY) {
        const rect = container.getBoundingClientRect();
        pointerX = clientX - rect.left;
        pointerY = clientY - rect.top;
        if (reticle) {
            reticle.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0) translate(-50%, -50%)`;
        }
    }

    // Pin the hand sprite so its fingertip lines up with (x, y).
    function showHandAt(x, y, frameKey) {
        if (!hand) return;
        const frame = HAND_FRAMES[frameKey];
        if (!frame) return;
        hand.hidden = false;
        const scale = HAND_DISPLAY_W / frame.w;
        hand.style.width = HAND_DISPLAY_W + 'px';
        hand.style.height = HAND_DISPLAY_H + 'px';
        hand.style.backgroundSize = `${HANDS_SHEET_W * scale}px ${HANDS_SHEET_H * scale}px`;
        hand.style.backgroundPosition = `${-frame.x * scale}px ${-frame.y * scale}px`;
        // Translate so (tipX%, tipY%) of the hand image lands at (x, y).
        hand.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-${frame.tipX}%, -${frame.tipY}%)`;
        hand.classList.add('visible');
    }

    function hideHand() {
        if (!hand) return;
        hand.classList.remove('visible', 'pinching');
        hand.hidden = true;
    }

    document.addEventListener('mousemove', e => {
        if (!gameRunning) return;
        updatePointerFromEvent(e.clientX, e.clientY);
    });

    container.addEventListener('touchstart', e => {
        if (!gameRunning) return;
        if (e.touches.length) {
            updatePointerFromEvent(e.touches[0].clientX, e.touches[0].clientY);
            attemptPick();
        }
    }, { passive: true });

    container.addEventListener('touchmove', e => {
        if (!gameRunning) return;
        if (e.touches.length) {
            e.preventDefault();
            updatePointerFromEvent(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: false });

    container.addEventListener('mousedown', () => { if (gameRunning) attemptPick(); });

    // ---------- Pick action ----------
    function attemptPick() {
        if (!gameRunning) return;
        let target = null;
        let bestDist = Infinity;

        headsArray.forEach(head => {
            if (!head.alive) return;
            const cx = head.x + head.w / 2;
            const cy = head.y + head.noseY;
            const dx = pointerX - cx;
            const dy = pointerY - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < PICK_RADIUS && d < bestDist) {
                bestDist = d;
                target = head;
            }
        });

        if (target) {
            pickFriend(target);
        } else {
            playSound('miss');
        }
    }

    // Pick sequence:
    //   1) Hand sprite appears at cursor in pointing pose (left or right side based
    //      on which side of the friend the cursor is on).
    //   2) Hand swaps to pinching pose, friend's head is dragged to the fingertip.
    //   3) Head jitters at the fingertip.
    //   4) Head explodes (scale up + fade + green particles).
    //   5) Booger appears at the fingertip and drops into the physical pile.
    //   6) Hand fades away; friend respawns elsewhere.
    function pickFriend(head) {
        head.alive = false;
        head.locked = true;
        playSound('pick');
        if (reticle) reticle.classList.add('locked');

        const friendCenterX = head.x + head.w / 2;
        const friendCenterY = head.y + head.noseY;

        // Approach direction: cursor on the left of friend → use left hand sprite
        // (body on left, finger pointing right toward target).
        const fromLeft = pointerX <= friendCenterX;
        const pointFrame = fromLeft ? 'left-one' : 'right-one';
        const pinchFrame = fromLeft ? 'left-two' : 'right-two';

        // Stage 1 — pointing hand snaps in at the cursor.
        showHandAt(pointerX, pointerY, pointFrame);

        const boogerType = pickBoogerType();
        // Roll once at the moment of pick — special boogers get the side-HUD treatment.
        const special = rollSpecial();

        // Stage 2 — switch to pinch pose at the friend's nose, drag the head over.
        setTimeout(() => {
            showHandAt(friendCenterX, friendCenterY, pinchFrame);
            hand.classList.add('pinching');

            // Yank the friend's head to the fingertip (which is now at the nose).
            head.el.classList.add('yanking');
            // Position the element so its (w/2, noseY) lands at (friendCenterX, friendCenterY).
            // Since the head element is already drawn at (head.x + offsetX, head.y + offsetY),
            // we just stop physics for it (head.locked) and let CSS handle the animation.
            head.el.style.transform =
                `translate3d(${head.x}px, ${head.y}px, 0) rotate(0deg) scale(1, 1)`;
            playSound('booger');
        }, 140);

        // Stage 3 — jitter, friend cries out (gendered reaction sound)
        setTimeout(() => {
            head.el.classList.remove('yanking');
            head.el.classList.add('jittering');
            playReaction(head.gender);
        }, 320);

        // Stage 4 — explode + booger extracted
        setTimeout(() => {
            head.el.classList.remove('jittering');
            head.el.classList.add('exploding');
            spawnExplodeBits(friendCenterX, friendCenterY);
            playSound('flyoff');

            // Booger appears at fingertip — pops out, or flies to the side HUD if special.
            spawnBoogerPop(friendCenterX, friendCenterY, boogerType, special);
            logPick(head.el.dataset.name);
        }, 560);

        // Stage 5 — hide hand, respawn friend after explode finishes
        setTimeout(() => {
            hideHand();
            if (reticle) reticle.classList.remove('locked');
        }, 820);

        setTimeout(() => {
            head.el.classList.remove('exploding');
            head.el.style.transition = '';
            head.x = Math.random() * Math.max(1, container.clientWidth - head.w);
            head.y = Math.random() * Math.max(1, container.clientHeight - head.h);
            head.vx = (Math.random() - 0.5) * MAX_SPEED;
            head.vy = (Math.random() - 0.5) * MAX_SPEED;
            head.rot = 0;
            head.alpha = 1;
            head.shrink = 1;
            head.scaleX = 1;
            head.scaleY = 1;
            head.flip = 1;
            head.offsetX = 0;
            head.offsetY = 0;
            head.locked = false;
            head.alive = true;
            head.el.style.opacity = '0';
            head.traits = pickTraits();
            requestAnimationFrame(() => {
                head.el.style.transition = 'opacity 0.4s ease-in';
                head.el.style.opacity = '1';
                setTimeout(() => { head.el.style.transition = ''; }, 420);
            });
        }, 1000);
    }

    // ---------- Explode particles ----------
    function spawnExplodeBits(x, y) {
        const count = 8;
        for (let i = 0; i < count; i++) {
            const bit = document.createElement('div');
            bit.className = 'explode-bit';
            const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
            const dist = 50 + Math.random() * 60;
            bit.style.setProperty('--bx', `${Math.cos(ang) * dist}px`);
            bit.style.setProperty('--by', `${Math.sin(ang) * dist - 20}px`);
            bit.style.left = x + 'px';
            bit.style.top = y + 'px';
            container.appendChild(bit);
            setTimeout(() => bit.remove(), 600);
        }
    }

    // ---------- Booger pop / special collection ----------
    // Roll once per pick: most picks are regular (CSS pop + counter),
    // some are a "special booger friend" that flies up to the side HUD.
    function rollSpecial() {
        if (Math.random() >= SPECIAL_CHANCE) return null;
        // Prefer ones not yet collected so each round gives variety.
        const remaining = SPECIAL_BOOGER_FRIENDS.filter(f => !collectedFriends.includes(f.id));
        const pool = remaining.length ? remaining : SPECIAL_BOOGER_FRIENDS;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function bumpScore() {
        score++;
        scoreDisplay.innerText = score;
        scoreDisplay.classList.remove('bump');
        void scoreDisplay.offsetWidth;
        scoreDisplay.classList.add('bump');
        setTimeout(() => scoreDisplay.classList.remove('bump'), 200);

        if (score >= BOOGER_GOAL && !levelOver) {
            // Slight delay so the pop animation is visible before the reveal lands.
            setTimeout(() => endLevel('goal'), 350);
        }
    }

    // Add a special booger friend thumbnail to the side HUD with arrival animation.
    function addToSideHud(special) {
        if (!friendsCollectedList) return;
        const thumb = document.createElement('div');
        thumb.className = 'collected-thumb';
        thumb.title = special.name;
        thumb.style.setProperty('--bf-color', special.color);
        // Prefer the real booger sprite; fall back to the colored CSS blob.
        if (!applyBoogerSprite(thumb, special.id, 44)) {
            // No sprite available — keep the gradient placeholder via CSS class.
        }
        friendsCollectedList.appendChild(thumb);
    }

    // Plucked booger appears at the fingertip; for regulars it pops away,
    // for specials it transforms into a "friend" and flies to the side HUD.
    function spawnBoogerPop(srcX, srcY, boogerType, special) {
        const booger = document.createElement('div');
        booger.className = `booger type-${boogerType.id}`;
        if (special) {
            // Special boogers carry the friend's signature color.
            booger.style.background =
                `radial-gradient(circle at 35% 35%, ${special.color}, ${special.color} 60%, #2d5a0f 100%)`;
            booger.style.boxShadow =
                `inset -3px -3px 6px rgba(0,0,0,0.4), 0 0 14px ${special.color}, 0 0 24px #ff00ff`;
        }
        booger.style.left = srcX + 'px';
        booger.style.top  = srcY + 'px';
        container.appendChild(booger);

        if (special) {
            // Fly to the side HUD slot, then commit it to the collected list.
            const containerRect = container.getBoundingClientRect();
            const hudRect = friendsCollectedList
                ? friendsCollectedList.getBoundingClientRect()
                : container.getBoundingClientRect();
            const targetX = hudRect.left + hudRect.width / 2 - containerRect.left;
            const targetY = hudRect.top + Math.min(hudRect.height - 22, 22 + (collectedFriends.length * 50)) - containerRect.top;

            requestAnimationFrame(() => {
                booger.classList.add('flying-special');
                booger.style.left = targetX + 'px';
                booger.style.top  = targetY + 'px';
                booger.style.transform = 'translate(-50%, -50%) scale(1.4) rotate(180deg)';
                setTimeout(() => {
                    booger.style.opacity = '0';
                    setTimeout(() => booger.remove(), 220);
                    collectedFriends.push(special.id);
                    addToSideHud(special);
                    bumpScore();
                }, 540);
            });
        } else {
            // Regular booger: simple CSS pop, then counter increments.
            requestAnimationFrame(() => {
                booger.classList.add('popping');
                setTimeout(() => booger.remove(), 460);
            });
            bumpScore();
        }
    }

    // ---------- Main loop (deltaTime based) ----------
    function gameLoop(now) {
        if (!gameRunning) return;
        const dt = Math.min(0.05, (now - lastFrame) / 1000) || 0.016;
        lastFrame = now;

        const w = container.clientWidth;
        const h = container.clientHeight;

        headsArray.forEach(head => {
            if (!head.alive) return;
            // While a friend is being plucked the physics & render are frozen —
            // the pick sequence drives the element directly via classes/transform.
            if (head.locked) return;

            const cx = head.x + head.w / 2;
            const cy = head.y + head.noseY;
            const dx = pointerX - cx;
            const dy = pointerY - cy;
            const distance = Math.sqrt(dx * dx + dy * dy);

            const ctx = { px: pointerX, py: pointerY, distance, w, h, dt };

            // Base flee
            if (distance < FLEE_RADIUS && distance > 0.001) {
                const flee = (FLEE_RADIUS - distance) / FLEE_RADIUS;
                head.vx -= (dx / distance) * flee * FLEE_FORCE * dt;
                head.vy -= (dy / distance) * flee * FLEE_FORCE * dt;
            }

            // Trait updates
            head.traits.forEach(t => t.update(head, dt, ctx));

            // Damping (heavier so they don't keep building speed)
            head.vx *= DAMPING;
            head.vy *= DAMPING;

            // Clamp speed
            const speed = Math.hypot(head.vx, head.vy);
            const cap = MAX_SPEED * SPEED_CAP_MULT;
            if (speed > cap) {
                head.vx = (head.vx / speed) * cap;
                head.vy = (head.vy / speed) * cap;
            }

            head.x += head.vx * dt;
            head.y += head.vy * dt;

            // Bounce
            if (head.x <= 0) { head.x = 0; head.vx = Math.abs(head.vx); }
            else if (head.x >= w - head.w) { head.x = w - head.w; head.vx = -Math.abs(head.vx); }
            if (head.y <= 0) { head.y = 0; head.vy = Math.abs(head.vy); }
            else if (head.y >= h - head.h) { head.y = h - head.h; head.vy = -Math.abs(head.vy); }

            // Render
            const sx = (head.scaleX || 1) * (head.shrink || 1) * (head.flip || 1);
            const sy = (head.scaleY || 1) * (head.shrink || 1);
            const ox = head.offsetX || 0;
            const oy = head.offsetY || 0;
            head.el.style.transform = `translate3d(${head.x + ox}px, ${head.y + oy}px, 0) rotate(${head.rot || 0}deg) scale(${sx}, ${sy})`;
            if (head.alpha != null) head.el.style.opacity = head.alpha;
        });

        requestAnimationFrame(gameLoop);
    }

    function logPick(name) {
        if (!name) return;
        fetch('https://onionmadder.rocks/api/friend-picker/index.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ friend_name: name })
        }).catch(err => console.error('POST Error:', err));
    }
});
