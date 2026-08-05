/* Stage the native app payload into www/.
 *
 * Capacitor's config used to say webDir: "." — which packages the ENTIRE
 * project directory into the app: CLAUDE.md, STORE_LISTING.md, cover.jpg,
 * package.json, scripts/, and once you have run a build, node_modules/ and
 * android/ recursively into itself. www/ is an explicit allow-list instead.
 *
 * It also strips the three things that only make sense on the web build:
 *
 *   - ../assets/css/site-footer.css lives OUTSIDE this directory, so in a
 *     WebView it is simply a 404.
 *   - the ⌂ home link and the site footer both point at ../ on
 *     madderverse.org, which does not exist inside the app.
 *
 * Every patch asserts it actually matched. If someone rewrites index.html
 * upstream this fails loudly rather than silently shipping a broken or
 * unstripped payload — same reasoning as Slip Studio's itch strip script.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WWW  = join(ROOT, "www");

const FILES = ["index.html", "game.js", "templates.js", "style.css",
               "manifest.webmanifest"];
const DIRS  = ["assets", "icons", "legal"];

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });

for (const f of FILES) {
    const src = join(ROOT, f);
    if (!existsSync(src)) throw new Error(`missing required file: ${f}`);
    cpSync(src, join(WWW, f));
}
for (const d of DIRS) {
    const src = join(ROOT, d);
    if (!existsSync(src)) throw new Error(`missing required dir: ${d}/`);
    cpSync(src, join(WWW, d), { recursive: true });
}

/* ---- strip web-only chrome from the app's index.html ---- */
let html = readFileSync(join(WWW, "index.html"), "utf8");

function cut(re, label) {
    const before = html;
    html = html.replace(re, "");
    if (html === before) throw new Error(`strip failed (pattern no longer matches): ${label}`);
}

cut(/[ \t]*<link rel="stylesheet" href="\.\.\/assets\/css\/site-footer\.css" \/>\r?\n/,
    "site-footer.css link");
cut(/[ \t]*<a class="madder-home"[\s\S]*?<\/a>\r?\n/,
    "madder-home button");
cut(/[ \t]*<footer class="site-footer-slim"[\s\S]*?<\/footer>\r?\n/,
    "site footer");

/* INSTALL APP is a PWA prompt and is meaningless inside the installed
   app. game.js also refuses to reveal it when isNative(), but that is a
   runtime guard on markup that should not be in the payload at all —
   strip it so the native build cannot show it even if the guard is
   later changed or the WebView behaves unexpectedly. */
cut(/[ \t]*<button class="big-btn install" id="btnInstall"[\s\S]*?<\/button>\r?\n/,
    "INSTALL APP button");

/* Belt and braces: if any of that chrome is reintroduced, keep it hidden
   in the app rather than letting it render a dead link. */
html = html.replace("</head>",
    '    <style>.madder-home,.site-footer-slim{display:none !important}</style>\n</head>');

writeFileSync(join(WWW, "index.html"), html);

/* ---- report ---- */
console.log("www/ staged:");
console.log("  files : " + FILES.join(", "));
console.log("  dirs  : " + DIRS.map(d => d + "/").join(", "));
console.log("  stripped: site-footer.css link, madder-home, site footer");
