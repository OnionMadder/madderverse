// ════════════════════════════════════════════════════════════════════
//  main.js — Giggle Gears | Entry Point
//  Load order is handled by the browser's ES module graph —
//  no script ordering in HTML required.
// ════════════════════════════════════════════════════════════════════

import { updateHUD }           from './screens.js';
import { showScreen }          from './screens.js';
import { bindScreenListeners } from './screens.js';
import { playOverworld, unlockAudio } from './audio.js';

window.addEventListener('DOMContentLoaded', () => {
    bindScreenListeners();
    updateHUD();
    showScreen('screen-menu');

    // Start overworld music — will auto-play on first user gesture
    playOverworld();

    // Unlock audio context on very first tap/click anywhere
    const unlock = () => {
        unlockAudio();
        document.removeEventListener('click',      unlock);
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('keydown',    unlock);
    };
    document.addEventListener('click',      unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('keydown',    unlock, { once: true });
});