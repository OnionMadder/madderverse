/* groodle-app prebuild
 *
 * The web game in ../groodle is the single source of truth. This
 * snapshots it into ./www as a SELF-CONTAINED, offline-safe bundle
 * for Capacitor to wrap:
 *
 *   1. copy ../groodle/* into www/ (skip dev-only docs)
 *   2. pull in the parent-dir assets the game references
 *      (../assets/css/site-footer.css + ../assets/favi/*) so the
 *      app has no out-of-bundle dependencies
 *   3. rewrite the loaded resource paths that only resolve on
 *      madderverse.org — `../assets/...` and the absolute
 *      `https://madderverse.org/assets/...` favicon/manifest refs —
 *      down to bundle-relative `assets/...`
 *
 * SEO/OG <meta> URLs (canonical, og:url, og:image, twitter:*) are
 * left absolute on purpose: they're never fetched by the running
 * app, and external scrapers/PWA installers still want them pointed
 * at the live site.
 *
 * Network resources (Google Fonts, the Supabase CDN + API,
 * GoatCounter) are left as-is — they degrade gracefully offline
 * (the font falls back to the chunky stack; the gallery shows its
 * "not set up / offline" state; analytics simply no-ops). */

import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');           // groodle-app/
const repoRoot = resolve(appRoot, '..');       // madderverse/
const gameSrc = join(repoRoot, 'groodle');
const assetsSrc = join(repoRoot, 'assets');
const www = join(appRoot, 'www');

/* Files in groodle/ that are dev-only — never ship them in the APK. */
const SKIP = new Set([
    'CLAUDE.md', 'PLAY_STORE_PLAN.md', 'SUPABASE_SETUP.md', 'cover.jpg'
]);

function reset() {
    if (existsSync(www)) rmSync(www, { recursive: true, force: true });
    mkdirSync(www, { recursive: true });
}

function copyGame() {
    cpSync(gameSrc, www, {
        recursive: true,
        filter: (src) => {
            if (src === gameSrc) return true;
            const rel = src.slice(gameSrc.length + 1);
            const top = rel.split(/[\\/]/)[0];
            /* Never ship dotfiles/dirs (.claude has a nested git
               worktree mirroring the WHOLE repo — that must not end up
               in the APK), node_modules, dev docs, or editor backups. */
            if (top.startsWith('.')) return false;
            if (top === 'node_modules') return false;
            if (SKIP.has(top)) return false;
            if (top.startsWith('game.js.bak')) return false;
            return true;
        }
    });
}

function copyParentAssets() {
    /* Only the parent assets the game actually loads. */
    const cssSrc = join(assetsSrc, 'css', 'site-footer.css');
    const faviSrc = join(assetsSrc, 'favi');
    mkdirSync(join(www, 'assets', 'css'), { recursive: true });
    if (existsSync(cssSrc)) {
        cpSync(cssSrc, join(www, 'assets', 'css', 'site-footer.css'));
    }
    if (existsSync(faviSrc)) {
        cpSync(faviSrc, join(www, 'assets', 'favi'), { recursive: true });
    }
}

function rewrite(file) {
    const p = join(www, file);
    if (!existsSync(p)) return false;
    let s = readFileSync(p, 'utf8');
    const before = s;
    /* Absolute site-asset URLs the running app would otherwise fetch
       over the network → bundle-relative. */
    s = s.replaceAll('https://madderverse.org/assets/', 'assets/');
    /* Parent-dir refs (../assets/...) → bundle-relative. www/ is the
       bundle root, with assets/ copied in beside index.html. */
    s = s.replaceAll('../assets/', 'assets/');
    if (s !== before) {
        writeFileSync(p, s);
        return true;
    }
    return false;
}

reset();
copyGame();
copyParentAssets();
const rewritten = ['index.html', 'sw.js', 'manifest.webmanifest']
    .filter(rewrite);

/* Fail loud if any madderverse.org asset URL or ../assets ref slipped
   through into a loaded file — that would 404 inside the APK. */
const idx = readFileSync(join(www, 'index.html'), 'utf8');
const leaks = [];
if (/href="\.\.\/assets\//.test(idx) || /src="\.\.\/assets\//.test(idx)) leaks.push('../assets in index.html');
if (idx.includes('https://madderverse.org/assets/favi/')) leaks.push('absolute favi URL in index.html');

console.log('[prebuild] www/ rebuilt from ../groodle');
console.log('[prebuild] rewrote paths in: ' + (rewritten.join(', ') || '(none)'));
if (leaks.length) {
    console.error('[prebuild] LEAK — these would 404 in the APK: ' + leaks.join('; '));
    process.exit(1);
}
console.log('[prebuild] OK — www/ is self-contained');
