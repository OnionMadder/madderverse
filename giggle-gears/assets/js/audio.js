// ════════════════════════════════════════════════════════════════════
//  audio.js — Giggle Gears | Music & Sound Effects
// ════════════════════════════════════════════════════════════════════

const AUDIO_BASE = 'https://fymz.lol/giggle-gears/assets/audio/';

// ─── Volume levels ────────────────────────────────────────────────────
const MUSIC_VOLUME = 0.42;
const SFX_VOLUME   = 0.72;

// ─── State ────────────────────────────────────────────────────────────
let _bgTrack      = null;   // currently playing HTMLAudioElement
let _bgKey        = null;   // key string of what's currently playing
let _musicEnabled = true;
let _sfxEnabled   = true;
let _unlocked     = false;  // Web Audio requires a user gesture first

// Track → music file mapping
const TRACK_MUSIC = {
    city:       'music/city.wav',
    desert:     'music/desert.wav',
    space:      'music/space.wav',
    icy:        'music/icy.wav',
    rainforest: 'music/rainforest.wav',
    tamil:      'music/tamil.wav',
    block:      'music/block.wav',
    candy:      'music/candy.wav',
};

// Pre-cached SFX elements (one per sound to avoid reload lag)
const _sfxCache = {};

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Call once on the first user interaction (tap/click/keydown).
 * Unlocks Web Audio on iOS/Safari so subsequent plays work.
 */
export function unlockAudio() {
    if (_unlocked) return;
    _unlocked = true;
    // Warm up a silent audio context so iOS grants permission
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume().catch(() => {});
    ctx.close().catch(() => {});
}

/** Play the overworld / menu BGM */
export function playOverworld() {
    _playBg('overworld', 'music/overworld.wav');
}

/** Play the BGM for the given track name */
export function playTrackMusic(trackName) {
    const file = TRACK_MUSIC[trackName];
    if (file) _playBg(trackName, file);
}

/** Fade out and stop whatever is playing */
export function stopMusic(fadeDuration = 600) {
    if (!_bgTrack) return;
    _fadeOut(_bgTrack, fadeDuration);
    _bgTrack = null;
    _bgKey   = null;
}

/** Pause / resume music (e.g. on tab blur) */
export function pauseMusic()  { _bgTrack?.pause(); }
export function resumeMusic() { if (_bgTrack?.paused) _bgTrack.play().catch(() => {}); }

/** Toggle mute for music */
export function toggleMusic() {
    _musicEnabled = !_musicEnabled;
    if (_bgTrack) _bgTrack.volume = _musicEnabled ? MUSIC_VOLUME : 0;
    return _musicEnabled;
}

/** Toggle mute for SFX */
export function toggleSfx() {
    _sfxEnabled = !_sfxEnabled;
    return _sfxEnabled;
}

export function isMusicEnabled() { return _musicEnabled; }
export function isSfxEnabled()   { return _sfxEnabled;   }

// ─── SFX helpers (call these from race.js / tricks.js) ───────────────
export const sfx = {
    boost:   () => _playSfx('sfx/boost.wav',   0.6),
    jump:    () => _playSfx('sfx/jump.wav',     0.55),
    land:    () => _playSfx('sfx/land.wav',     0.45),
    trick:   () => _playSfx('sfx/trick.wav',    0.80),
    dodge:   () => _playSfx('sfx/dodge.wav',    0.50),
    crash:   () => _playSfx('sfx/crash.wav',    0.90),
    deflect: () => _playSfx('sfx/deflect.wav',  0.75),
    buy:     () => _playSfx('sfx/buy.wav',      0.65),
    finish:  () => _playSfx('sfx/finish.wav',   0.80),
};

// ═══════════════════════════════════════════════════════════════════════
//  INTERNALS
// ═══════════════════════════════════════════════════════════════════════

function _playBg(key, file) {
    if (_bgKey === key) return;          // already playing this track
    if (_bgTrack) _fadeOut(_bgTrack, 500);

    const audio        = new Audio(AUDIO_BASE + file);
    audio.loop         = true;
    audio.volume       = _musicEnabled ? 0 : 0;
    audio.preload      = 'auto';

    _bgTrack = audio;
    _bgKey   = key;

    const play = () => {
        audio.play().catch(() => {
            // Autoplay blocked — will play on next user gesture
            const resume = () => { audio.play().catch(() => {}); document.removeEventListener('click', resume); document.removeEventListener('touchstart', resume); };
            document.addEventListener('click',      resume, { once: true });
            document.addEventListener('touchstart', resume, { once: true });
        });
        // Fade in
        if (_musicEnabled) _fadeIn(audio, MUSIC_VOLUME, 800);
    };

    if (_unlocked) play();
    else {
        // Queue for first gesture
        const go = () => { unlockAudio(); play(); document.removeEventListener('click', go); document.removeEventListener('touchstart', go); };
        document.addEventListener('click',      go, { once: true });
        document.addEventListener('touchstart', go, { once: true });
    }
}

function _playSfx(file, vol = SFX_VOLUME) {
    if (!_sfxEnabled) return;
    // Reuse cached element if available & ended, else clone
    let audio = _sfxCache[file];
    if (!audio) {
        audio = new Audio(AUDIO_BASE + file);
        audio.preload = 'auto';
        _sfxCache[file] = audio;
    }
    if (!audio.paused && audio.currentTime > 0) {
        // Overlap-safe: clone for simultaneous plays
        const clone = audio.cloneNode();
        clone.volume = vol;
        clone.play().catch(() => {});
        return;
    }
    audio.currentTime = 0;
    audio.volume      = vol;
    audio.play().catch(() => {});
}

function _fadeIn(audio, targetVol, durationMs) {
    audio.volume = 0;
    const steps    = 30;
    const stepTime = durationMs / steps;
    const stepVol  = targetVol / steps;
    let step = 0;
    const iv = setInterval(() => {
        step++;
        audio.volume = Math.min(targetVol, stepVol * step);
        if (step >= steps) clearInterval(iv);
    }, stepTime);
}

function _fadeOut(audio, durationMs) {
    const startVol = audio.volume;
    const steps    = 20;
    const stepTime = durationMs / steps;
    const stepVol  = startVol / steps;
    let step = 0;
    const iv = setInterval(() => {
        step++;
        audio.volume = Math.max(0, startVol - stepVol * step);
        if (step >= steps) { clearInterval(iv); audio.pause(); }
    }, stepTime);
}

// ─── Visibility-based pause/resume ───────────────────────────────────
document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseMusic();
    else                 resumeMusic();
});