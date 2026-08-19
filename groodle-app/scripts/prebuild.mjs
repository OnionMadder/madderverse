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
 * The bundle must make NO network request at all. That is not just an
 * offline nicety: the Play listing declares no data collected under the
 * Families policy, so an analytics beacon or a third-party font fetch
 * would each make that a false statement. Hence:
 *   - the public gallery is gone (on-device IndexedDB since 2026-08-18)
 *   - Caveat is self-hosted in groodle/assets/fonts, not Google Fonts
 *   - the GoatCounter beacon is stripped here
 *   - site chrome (home link, footer) is cut: the home link 404s in a
 *     WebView and the footer carries an external link, which Families
 *     wants behind a parental gate
 * assertOffline() at the bottom fails the build if any of that returns. */

import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');           // groodle-app/
const repoRoot = resolve(appRoot, '..');       // madderverse/
const gameSrc = join(repoRoot, 'groodle');
const assetsSrc = join(repoRoot, 'assets');
const www = join(appRoot, 'www');

/* Files in groodle/ that are dev-only — never ship them in the APK.
   `tools` and `art-src` are the paper-doll rig's build inputs: the tracer,
   the fitter and the source drawings. They are tracked so the rig stays
   regenerable, but they are ~80KB of things the game never loads. */
/* Newline as a value, not an escape: this file is edited by tooling often
   enough that a literal backslash-n in a string is a liability. */
const NL = String.fromCharCode(10);

const SKIP = new Set([
    'CLAUDE.md', 'PLAY_STORE_PLAN.md', 'cover.jpg', 'tools', 'art-src',
    'pose-template.svg'
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
    /* Analytics never ships in the app -- see the header note. Dropped by a
       line scan rather than a regex, so the pattern cannot rot silently if
       the tag is ever reformatted. */
    s = s.split(NL).filter((l) => !l.includes('goatcounter')).join(NL);
    if (s !== before) {
        writeFileSync(p, s);
        return true;
    }
    return false;
}

/* Site chrome is web-only and must not ship in the APK:
     .madder-home       links to ../ , which 404s inside a WebView
     .site-footer-slim  carries an external link to madsundar.com, and Play's
                        Families policy wants external links behind a parental
                        gate -- easier to have none than to build a gate

   Cut from the markup, not merely hidden: display:none still leaves a live
   external link in the DOM, which is a weak thing to hand a reviewer. The
   CSS rule below is belt-and-braces in case the markup is restructured. */
function stripSiteChrome() {
    const p = join(www, 'index.html');
    const lines = readFileSync(p, 'utf8').split(NL);
    const out = [];
    let inFooter = false, removedHome = false, removedFooter = false;
    for (const line of lines) {
        if (line.includes('<footer class="site-footer-slim"')) {
            inFooter = true; removedFooter = true; continue;
        }
        if (inFooter) {
            if (line.includes('</footer>')) inFooter = false;
            continue;
        }
        if (line.includes('class="madder-home"')) { removedHome = true; continue; }
        out.push(line);
    }
    writeFileSync(p, out.join(NL));
    if (!removedHome || !removedFooter) {
        console.error('[prebuild] site chrome not found — did index.html change?');
        process.exit(1);
    }
}

function hideSiteChrome() {
    const p = join(www, 'style.css');
    if (!existsSync(p)) return;
    const note = [
        '',
        '/* --- appended by groodle-app/scripts/prebuild.mjs (APP BUILD ONLY) --- */',
        '/* Web-only chrome: a home link that 404s in a WebView, and a footer',
        '   with an external link. Not present in the site stylesheet. */',
        '.madder-home, .site-footer-slim { display: none !important; }',
        '',
    ].join(NL);
    writeFileSync(p, readFileSync(p, 'utf8') + note);
}

reset();
copyGame();
copyParentAssets();
stripSiteChrome();
hideSiteChrome();
const rewritten = ['index.html', 'sw.js', 'manifest.webmanifest']
    .filter(rewrite);

/* Fail loud if any madderverse.org asset URL or ../assets ref slipped
   through into a loaded file — that would 404 inside the APK. */
const idx = readFileSync(join(www, 'index.html'), 'utf8');
const leaks = [];
if (/href="\.\.\/assets\//.test(idx) || /src="\.\.\/assets\//.test(idx)) leaks.push('../assets in index.html');
if (idx.includes('https://madderverse.org/assets/favi/')) leaks.push('absolute favi URL in index.html');

/* Nothing in a LOADED file may reference an outside host. SEO/OG <meta>
   URLs are exempt: they are never fetched by the running app, and external
   scrapers still want them pointing at the live site. */
function assertOffline() {
    const bad = [];
    for (const f of ['index.html', 'game.js', 'style.css', 'sw.js']) {
        const p = join(www, f);
        if (!existsSync(p)) continue;
        const text = readFileSync(p, 'utf8');
        for (const line of text.split(NL)) {
            if (/<meta|<link rel="canonical"/i.test(line)) continue;
            const m = line.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi);
            if (!m) continue;
            for (const u of m) {
                if (/madderverse\.org|schema\.org|w3\.org|creativecommons/i.test(u)) continue;
                bad.push(f + ': ' + u);
            }
        }
    }
    return bad;
}
leaks.push(...assertOffline().map(x => 'external host — ' + x));

console.log('[prebuild] www/ rebuilt from ../groodle');
console.log('[prebuild] rewrote paths in: ' + (rewritten.join(', ') || '(none)'));
if (leaks.length) {
    console.error('[prebuild] LEAK — these would 404 in the APK: ' + leaks.join('; '));
    process.exit(1);
}
console.log('[prebuild] OK — www/ is self-contained');
