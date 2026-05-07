// ════════════════════════════════════════════════════════════════════
//  screens.js — Giggle Gears | Screen Management & Customizer
// ════════════════════════════════════════════════════════════════════

import {
    gameState, raceVars, savePoints,
    isUnlocked, unlockItem,
    CAR_BODIES, DRIVERS, UNDERGLOWS, EXTRAS,
    carSpriteName, driverSpriteName,
} from './state.js';
import { spriteHTML } from './sprites.js';
import { startRace }              from './race.js';
import { sfx, unlockAudio, playOverworld, playTrackMusic, stopMusic } from './audio.js';

// ═══════════════════════════════════════════════════════════════════════
//  SCREEN ROUTER
// ═══════════════════════════════════════════════════════════════════════

export function showScreen(screenId) {
    if (screenId !== 'screen-game') {
        cancelAnimationFrame(raceVars.raceAnimation);
        raceVars.raceAnimation = null;
        removeKeyListeners();
    }

    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');

    if (screenId === 'screen-driver') buildDriverGrid();
    if (screenId === 'screen-custom') initCustomizer();
    if (screenId === 'screen-game')   startRace();
    updateHUD();
}

export function selectDriver(file) {
    gameState.driver = file;
    showScreen('screen-custom');
}

export function selectTrack(track) {
    gameState.track = track;
    const loading = document.getElementById('screen-loading');
    if (loading) loading.dataset.track = track;
    showScreen('screen-loading');
    playTrackMusic(track);
    setTimeout(() => showScreen('screen-game'), 1600);
}

export function replayRace() { showScreen('screen-game'); }

// ─── Key listener stubs (race module sets the real handlers) ──────────
let _keyDown = null;
let _keyUp   = null;

export function setKeyHandlers(down, up) {
    _keyDown = down;
    _keyUp   = up;
}

export function addKeyListeners() {
    if (_keyDown) window.addEventListener('keydown', _keyDown);
    if (_keyUp)   window.addEventListener('keyup',   _keyUp);
}

export function removeKeyListeners() {
    if (_keyDown) window.removeEventListener('keydown', _keyDown);
    if (_keyUp)   window.removeEventListener('keyup',   _keyUp);
    raceVars.boostActive = false;
}

// ═══════════════════════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════════════════════

export function updateHUD() {
    const sv = document.getElementById('score-val');
    if (sv) sv.textContent = gameState.points;
}

export function updateTimerHUD(ms) {
    const el = document.getElementById('time-val');
    if (!el) return;
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    el.textContent = `${min}:${String(sec).padStart(2, '0')}`;
    const wrap = document.getElementById('time-display');
    if (wrap) wrap.classList.toggle('low', ms <= 15000);
}

export function setSpeedIndicator(boosting) {
    const el = document.getElementById('speed-indicator');
    if (!el) return;
    if (boosting) { el.textContent = '⚡ Boost!'; el.classList.add('boosting'); }
    else          { el.textContent = 'Cruising'; el.classList.remove('boosting'); }
}

// ═══════════════════════════════════════════════════════════════════════
//  TRICK TOAST
// ═══════════════════════════════════════════════════════════════════════

export function showTrick(msg, positive = true) {
    const t = document.getElementById('trick-toast');
    if (!t) return;
    t.textContent = msg;
    t.className   = positive ? 'trick-toast-show positive' : 'trick-toast-show negative';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = ''; }, 1800);
}

// ═══════════════════════════════════════════════════════════════════════
//  DRIVER GRID
// ═══════════════════════════════════════════════════════════════════════

function buildDriverGrid() {
    const grid = document.getElementById('driver-grid');
    if (!grid) return;
    grid.innerHTML = '';
    DRIVERS.forEach(d => {
        const card = document.createElement('div');
        card.className = 'driver-card' + (gameState.driver === d.file ? ' selected' : '');
        card.innerHTML = `
            ${spriteHTML(driverSpriteName(d.file), { extraClass: 'driver-thumb', attrs: `role="img" aria-label="${d.label}"` })}
            <span class="driver-name">${d.label}</span>
        `;
        card.addEventListener('click', () => {
            unlockAudio();
            selectDriver(d.file);
        });
        grid.appendChild(card);
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  CUSTOMIZER
// ═══════════════════════════════════════════════════════════════════════

function initCustomizer() {
    renderCarBank();
    renderUnderglowBank();
    renderExtraBank();
    updatePreview();
    updateLightToggleBtn();
}

// ── Car bank ──────────────────────────────────────────────────────────
function renderCarBank() {
    const container = document.getElementById('body-bank');
    if (!container) return;
    container.innerHTML = '';

    CAR_BODIES.forEach(car => {
        const btn       = document.createElement('button');
        const owned     = car.cost === 0 || isUnlocked(car.id);
        const canAfford = gameState.points >= car.cost;
        const selected  = gameState.carId === car.id;
        btn.className   = 'bank-btn car-bank-btn' + (selected ? ' selected' : '');

        if (owned) {
            btn.innerHTML = `
                ${spriteHTML(carSpriteName(car.id), { extraClass: 'car-thumb', attrs: `role="img" aria-label="${car.label}"` })}
                <span class="car-name">${car.label}</span>
            `;
            btn.addEventListener('click', () => {
                gameState.carId = car.id;
                renderCarBank();
                updatePreview();
            });
        } else if (canAfford) {
            btn.innerHTML = `
                ${spriteHTML(carSpriteName(car.id), { extraClass: 'car-thumb', attrs: `role="img" aria-label="${car.label}" style="opacity:0.7"` })}
                <span class="car-name">${car.label}</span>
                <span class="lock-label buy-label">BUY ${car.cost}&#11088;</span>
            `;
            btn.classList.add('buyable');
            btn.addEventListener('click', () => {
                gameState.points -= car.cost;
                savePoints();
                unlockItem(car.id);
                gameState.carId = car.id;
                renderCarBank();
                updatePreview();
                updateHUD();
                sfx.buy();
                showTrick(`🚗 Bought ${car.label}!`, true);
            });
        } else {
            btn.disabled  = true;
            btn.innerHTML = `<span style="font-size:1.3rem">🔒</span><span class="lock-label">${car.cost} stars</span>`;
            btn.title     = `Need ${car.cost} stars`;
        }
        container.appendChild(btn);
    });
}

// ── Underglow bank ────────────────────────────────────────────────────
function renderUnderglowBank() {
    const container = document.getElementById('color-bank');
    if (!container) return;
    container.innerHTML = '';

    const offBtn = document.createElement('button');
    offBtn.className = 'bank-btn color-btn' + (gameState.underglowColor === null ? ' selected' : '');
    offBtn.innerHTML = `<span class="color-swatch" style="background:#333;border:2px dashed #888"></span><span class="color-label">Off</span>`;
    offBtn.addEventListener('click', () => {
        gameState.underglowColor = null;
        renderUnderglowBank();
        updatePreview();
    });
    container.appendChild(offBtn);

    UNDERGLOWS.forEach(glow => {
        const btn       = document.createElement('button');
        const owned     = glow.cost === 0 || isUnlocked('glow_' + glow.label);
        const canAfford = gameState.points >= glow.cost;
        const selected  = gameState.underglowColor === glow.color;
        btn.className   = 'bank-btn color-btn' + (selected ? ' selected' : '');

        if (owned) {
            btn.innerHTML = `<span class="color-swatch" style="background:${glow.color};box-shadow:0 0 8px ${glow.color}"></span><span class="color-label">${glow.label}</span>`;
            btn.addEventListener('click', () => {
                gameState.underglowColor = glow.color;
                renderUnderglowBank();
                updatePreview();
            });
        } else if (canAfford) {
            btn.innerHTML = `<span class="color-swatch" style="background:${glow.color};opacity:0.6;box-shadow:0 0 6px ${glow.color}"></span><span class="color-label">${glow.label}<br><span class="buy-label">BUY ${glow.cost}&#11088;</span></span>`;
            btn.classList.add('buyable');
            btn.addEventListener('click', () => {
                gameState.points -= glow.cost;
                savePoints();
                unlockItem('glow_' + glow.label);
                gameState.underglowColor = glow.color;
                renderUnderglowBank();
                updatePreview();
                updateHUD();
                sfx.buy();
                showTrick(`✨ ${glow.label} Underglow!`, true);
            });
        } else {
            btn.disabled  = true;
            btn.innerHTML = `<span class="color-swatch" style="background:#111"></span><span class="color-label">🔒 ${glow.cost}&#11088;</span>`;
        }
        container.appendChild(btn);
    });
}

// ── Extras / upgrades bank ────────────────────────────────────────────
function renderExtraBank() {
    const container = document.getElementById('extra-bank');
    if (!container) return;
    container.innerHTML = '';

    EXTRAS.forEach(item => {
        const btn       = document.createElement('button');
        const owned     = item.cost === 0 || isUnlocked('extra_' + item.label);
        const canAfford = gameState.points >= item.cost;
        let active = false;
        if (item.type === 'spoiler')         active = gameState.accessorySpoiler === item.displayIcon;
        if (item.type === 'dome')            active = gameState.accessoryDome    === item.displayIcon;
        if (item.type in gameState.upgrades) active = gameState.upgrades[item.type];
        btn.className = 'bank-btn' + (active ? ' selected' : '');

        if (owned) {
            btn.textContent = item.label;
            btn.addEventListener('click', () => {
                if (item.type === 'spoiler')              gameState.accessorySpoiler = active ? null : item.displayIcon;
                else if (item.type === 'dome')            gameState.accessoryDome    = active ? null : item.displayIcon;
                else if (item.type in gameState.upgrades) gameState.upgrades[item.type] = !gameState.upgrades[item.type];
                renderExtraBank();
                updatePreview();
            });
        } else if (canAfford) {
            btn.innerHTML = `${item.label}<br><span class="lock-label buy-label">BUY ${item.cost}&#11088;</span>`;
            btn.classList.add('buyable');
            btn.addEventListener('click', () => {
                gameState.points -= item.cost;
                savePoints();
                unlockItem('extra_' + item.label);
                if (item.type === 'spoiler')              gameState.accessorySpoiler = item.displayIcon;
                else if (item.type === 'dome')            gameState.accessoryDome    = item.displayIcon;
                else if (item.type in gameState.upgrades) gameState.upgrades[item.type] = true;
                renderExtraBank();
                updatePreview();
                updateHUD();
                sfx.buy();
                showTrick(`${item.displayIcon} Bought ${item.label}!`, true);
            });
        } else {
            btn.disabled  = true;
            btn.innerHTML = `<span style="font-size:1.2rem">🔒</span><span class="lock-label">${item.cost} stars</span>`;
        }
        container.appendChild(btn);
    });
}

// ── Preview ───────────────────────────────────────────────────────────
export function updatePreview() {
    const wrapper = document.getElementById('car-body-wrapper');
    const carEl   = document.getElementById('car-png');
    if (!wrapper || !carEl) return;

    // #car-png is a sprite wrapper; the inner sheet <img> is static.
    // Just swap the frame class.
    carEl.className = 'sprite sprite-' + carSpriteName(gameState.carId);

    if (gameState.underglowColor) {
        wrapper.style.filter = `drop-shadow(0 12px 18px ${gameState.underglowColor})`;
        wrapper.classList.add('fx-underglow-preview');
    } else {
        wrapper.style.filter = '';
        wrapper.classList.remove('fx-underglow-preview');
    }

    wrapper.classList.toggle('fx-hover',        gameState.upgrades.hoverride);
    wrapper.classList.toggle('fx-boostflame',   gameState.upgrades.boostFlame);
    wrapper.classList.toggle('fx-fancy-lights', gameState.upgrades.fancyLights);
    wrapper.classList.toggle('fx-shield',       gameState.upgrades.deflectShield);
    wrapper.classList.toggle('lights-on',       gameState.lightsOn);

    const driverSlot = document.getElementById('driver-slot');
    if (driverSlot) driverSlot.innerHTML = spriteHTML(driverSpriteName(gameState.driver), { attrs: 'role="img" aria-label="Driver"' });

    const spoilerEl = document.getElementById('anchor-spoiler');
    const domeEl    = document.getElementById('anchor-dome');
    if (spoilerEl) spoilerEl.textContent = gameState.accessorySpoiler || '';
    if (domeEl)    domeEl.textContent    = gameState.accessoryDome    || '';
}

// ── Lights toggle ─────────────────────────────────────────────────────
export function toggleLights() {
    gameState.lightsOn = !gameState.lightsOn;
    updatePreview();
    updateLightToggleBtn();
}

export function updateLightToggleBtn() {
    const btn = document.getElementById('light-toggle-btn');
    if (btn) btn.textContent = `Headlights ${gameState.lightsOn ? 'ON 💡' : 'OFF'}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  RESET CAR — with confirm modal
// ═══════════════════════════════════════════════════════════════════════

export function resetCar() {
    _showResetModal();
}

function _doResetCar() {
    gameState.underglowColor   = null;
    gameState.accessorySpoiler = null;
    gameState.accessoryDome    = null;
    Object.keys(gameState.upgrades).forEach(k => (gameState.upgrades[k] = false));
    gameState.lightsOn = false;
    renderCarBank();
    renderUnderglowBank();
    renderExtraBank();
    updatePreview();
    updateLightToggleBtn();
}

// ── Inline confirm modal (no native confirm(), works on mobile) ───────
const MODAL_ID = 'gg-reset-modal';

function _showResetModal() {
    if (document.getElementById(MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id    = MODAL_ID;
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9999',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.72)',
        'animation:fadeIn 0.2s ease',
    ].join(';');

    overlay.innerHTML = `
        <div style="
            background:#1a1a2e;
            border:2px solid rgba(255,255,255,0.18);
            border-radius:20px;
            padding:clamp(24px,5vw,38px) clamp(28px,7vw,48px);
            display:flex; flex-direction:column; align-items:center;
            gap:18px; max-width:88vw; text-align:center;
            font-family:'WalterTurncoat',cursive; color:white;
        ">
            <div style="font-size:clamp(1.4rem,4vw,2rem);">Reset your car setup?</div>
            <div style="font-size:clamp(0.85rem,2.5vw,1.1rem);color:rgba(255,255,255,0.65);">
                Upglow, add-ons &amp; upgrades will be removed.<br>
                Unlocked items &amp; stars are kept.
            </div>
            <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center;">
                <button id="gg-reset-confirm" style="
                    all:unset; cursor:pointer;
                    font-family:'WalterTurncoat',cursive;
                    font-size:clamp(1rem,3vw,1.35rem);
                    background:#ff6b6b; color:white;
                    padding:10px 28px; border-radius:14px;
                    box-shadow:0 5px 0 #c0392b;
                    transition:transform 0.1s,box-shadow 0.1s;
                ">Yes, Reset</button>
                <button id="gg-reset-cancel" style="
                    all:unset; cursor:pointer;
                    font-family:'WalterTurncoat',cursive;
                    font-size:clamp(1rem,3vw,1.35rem);
                    background:#fdcb6e; color:#1a1a1a;
                    padding:10px 28px; border-radius:14px;
                    box-shadow:0 5px 0 #e17055;
                    transition:transform 0.1s,box-shadow 0.1s;
                ">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('gg-reset-confirm').addEventListener('click', () => {
        _doResetCar();
        _closeResetModal();
    });
    document.getElementById('gg-reset-cancel').addEventListener('click', _closeResetModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) _closeResetModal(); });
}

function _closeResetModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.remove();
}

// ═══════════════════════════════════════════════════════════════════════
//  DOM LISTENER SETUP — called once from main.js
// ═══════════════════════════════════════════════════════════════════════

export function bindScreenListeners() {
    // Menu
    document.getElementById('screen-menu')
        ?.querySelector('button')
        ?.addEventListener('click', () => { unlockAudio(); showScreen('screen-driver'); });

    // Customizer controls
    document.getElementById('light-toggle-btn')
        ?.addEventListener('click', toggleLights);
    document.getElementById('reset-car-btn')
        ?.addEventListener('click', resetCar);

    // Customizer → Drive button
    document.getElementById('screen-custom')
        ?.querySelector('.btn-green')
        ?.addEventListener('click', () => showScreen('screen-tracks'));

    // Track cards
    document.querySelectorAll('.track-card').forEach(card => {
        card.addEventListener('click', () => { unlockAudio(); selectTrack(card.dataset.track); });
    });

    // End screen buttons
    document.getElementById('end-replay-btn')
        ?.addEventListener('click', replayRace);
    document.getElementById('end-new-track-btn')
        ?.addEventListener('click', () => showScreen('screen-tracks'));
    document.getElementById('end-new-driver-btn')
        ?.addEventListener('click', () => showScreen('screen-driver'));
    document.getElementById('end-new-car-btn')
        ?.addEventListener('click', () => showScreen('screen-custom'));

    // HUD exit — endRace is re-exported from race.js
    document.getElementById('exit-btn')
        ?.addEventListener('click', () => {
            import('./race.js').then(m => m.endRace(true));
        });

    // Mobile controls
    document.getElementById('mobile-boost-btn')?.addEventListener('touchstart', e => {
        e.preventDefault();
        unlockAudio();
        import('./race.js').then(m => m.boostStart());
    }, { passive: false });
    document.getElementById('mobile-boost-btn')?.addEventListener('touchend', e => {
        e.preventDefault();
        import('./race.js').then(m => m.boostEnd());
    }, { passive: false });
    document.getElementById('mobile-jump-btn')?.addEventListener('touchstart', e => {
        e.preventDefault();
        unlockAudio();
        import('./race.js').then(m => m.doJump());
    }, { passive: false });
}