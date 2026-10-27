/* Madderverse touch guard: shared iPad / iPhone kid-proofing for every game.
 *
 * Load it in <head>, BEFORE the game's own stylesheets and scripts:
 *     <script src="../assets/js/touch-guard.js?v=3"></script>
 *
 * Why this exists: the games felt fine on Android and bad on an iPad.
 * Almost all of the difference is Safari ignoring things Android
 * honours, and a five-year-old finds every one of them in a minute.
 * This generalises Pootery's 2026-10-13 pinch fix (v95) to the site.
 *
 *  1. PAGE PINCH-ZOOM. iOS ignores `user-scalable=no` / `maximum-scale`
 *     (since iOS 10). Cancel Safari's gesture* events and multi-finger
 *     touchmove at the document. Pointer events still fire, so a game's
 *     OWN pinch (Pootery, Tiny Canvas, Slip Studio) keeps working.
 *  2. DOUBLE-TAP ZOOM. `touch-action: manipulation` on the root, plus a
 *     touchend guard for the cases WebKit still zooms on (fast taps on
 *     non-button elements). The guard re-sends the swallowed tap as a
 *     click, so rapid tapping on a button still registers every tap.
 *  3. SELECTION, CALLOUTS, MAGNIFIER. Long-press selects text, opens the
 *     "Save Image / Copy" sheet, or brings up the loupe. Off everywhere
 *     except real text fields and anything marked `.mv-selectable`.
 *  4. RUBBER-BAND + PULL-TO-REFRESH. `overscroll-behavior: none`.
 *  5. VIEWPORT HEIGHT. iPad Safari's `100vh` includes the area under the
 *     toolbar. Games use `100dvh` (with a `100vh` line above it as the
 *     fallback); for pre-15.4 Safari without dvh we also publish
 *     `--mv-vh` (1% of the real inner height) and `--mv-safe-*` insets.
 *  6. STICKY HOVER. A tap leaves `:hover` stuck on until you tap
 *     elsewhere, and a hover that changes layout can swallow the first
 *     tap. Every `:hover` rule in the page's own stylesheets is moved
 *     into an `@media (hover: hover)` block, exactly as if the source
 *     had been written that way: identical on desktop, gone on touch.
 *  7. TAP TARGETS. The shared ⌂ / top-right control buttons get a 44px
 *     minimum on touch screens. In-game controls are each game's job.
 *  8. HOME-SCREEN APP. Adds `mv-standalone` (launched from the home
 *     screen), `mv-native` (Capacitor wrapper) and `mv-app` (either) to
 *     <html>, and hides the ⌂ button + site footer there: they navigate
 *     out of the game, which in an installed app pops Safari over it.
 *     Each game's manifest + icons come from scripts/make-pwa.py.
 *
 * Capacitor: the `../assets/js/` path resolves to `/assets/js/` inside a
 * `www/` bundle (browsers clamp `..` at the root), so a wrapper only has
 * to copy this file to `www/assets/js/touch-guard.js`. No network, no
 * dependencies, safe to load twice.
 */
(function () {
    "use strict";
    if (window.__mvTouchGuard) return;
    window.__mvTouchGuard = 3;

    var doc = document;
    var root = doc.documentElement;

    /* Elements where a kid (or parent) legitimately needs to type or select. */
    function isEditable(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.closest && el.closest(".mv-selectable, [contenteditable=''], [contenteditable='true']")) return true;
        var tag = el.tagName;
        if (tag === "TEXTAREA" || tag === "SELECT") return true;
        if (tag === "INPUT") {
            var t = (el.type || "text").toLowerCase();
            return !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/.test(t);
        }
        return false;
    }

    /* ---- 1. page pinch-zoom ---- */
    var stop = function (e) { e.preventDefault(); };
    doc.addEventListener("gesturestart",  stop, { passive: false });
    doc.addEventListener("gesturechange", stop, { passive: false });
    doc.addEventListener("gestureend",    stop, { passive: false });
    doc.addEventListener("touchmove", function (e) {
        if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    /* ---- 2. double-tap zoom guard ---- */
    var lastEnd = 0, lastX = 0, lastY = 0;
    doc.addEventListener("touchend", function (e) {
        if (e.touches && e.touches.length) return;            /* other fingers still down */
        if (e.defaultPrevented) return;                       /* the game already handled it */
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var now = Date.now();
        var near = Math.abs(t.clientX - lastX) < 40 && Math.abs(t.clientY - lastY) < 40;
        var quick = now - lastEnd < 350;
        lastEnd = now; lastX = t.clientX; lastY = t.clientY;
        if (!quick || !near || isEditable(e.target)) return;
        if (!e.cancelable) return;
        e.preventDefault();                                   /* stops the zoom AND the native click */
        lastEnd = 0;                                          /* a third tap starts fresh */
        var target = e.target;
        if (target && target.nodeType !== 1) target = target.parentElement;
        if (!target || target.disabled) return;
        try {
            target.dispatchEvent(new MouseEvent("click", {
                bubbles: true, cancelable: true, view: window,
                clientX: t.clientX, clientY: t.clientY,
                screenX: t.screenX, screenY: t.screenY
            }));
        } catch (_) { if (target.click) target.click(); }
    }, { passive: false });

    /* ---- 3. selection / long-press callout / loupe ---- */
    doc.addEventListener("selectstart", function (e) {
        if (!isEditable(e.target)) e.preventDefault();
    });
    doc.addEventListener("contextmenu", function (e) {
        /* Long-press on iOS / Android fires contextmenu. Desktop right-
           click is left alone (mouse pointers report a real button). */
        if (e.pointerType === "mouse" || isEditable(e.target)) return;
        if (window.matchMedia && window.matchMedia("(hover: hover)").matches) return;
        e.preventDefault();
    });

    /* ---- 3 + 4 + 5. injected CSS ---- */
    var css =
        ":root{--mv-vh:1vh;" +
        "--mv-safe-top:env(safe-area-inset-top,0px);--mv-safe-right:env(safe-area-inset-right,0px);" +
        "--mv-safe-bottom:env(safe-area-inset-bottom,0px);--mv-safe-left:env(safe-area-inset-left,0px)}" +
        "@supports (height:100dvh){:root{--mv-vh:1dvh}}" +
        "html{touch-action:manipulation;-webkit-text-size-adjust:100%;text-size-adjust:100%;" +
        "overscroll-behavior:none;-webkit-tap-highlight-color:transparent}" +
        "body{overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}" +
        "input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range])," +
        "textarea,select,[contenteditable=''],[contenteditable=true],.mv-selectable,.mv-selectable *" +
        "{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}" +
        "img,canvas,svg,video{-webkit-user-drag:none;-webkit-touch-callout:none}" +
        /* Shared Madderverse chrome: keep the home button clear of the
           notch / status bar when installed to the home screen. */
        ".madder-home{margin-top:var(--mv-safe-top);margin-left:var(--mv-safe-left)}" +
        /* 7. Finger-sized targets on the shared chrome (Apple's 44pt
           minimum). `html` prefix outranks a game's own sizing. */
        "@media (pointer:coarse){html .madder-home{min-width:44px;min-height:44px}" +
        "html .madder-controls button,html .madder-controls .btn{min-width:44px;min-height:44px}}" +
        /* 8. Installed app / native wrapper: the ⌂ button and the site
           footer link OUT of the game, which in a home-screen app opens a
           Safari sheet over it. Hide them, as the Android builds do. */
        "html.mv-app .madder-home,html.mv-app .site-footer-slim,html.mv-app .site-footer{display:none!important}";
    var style = doc.createElement("style");
    style.setAttribute("data-mv-touch-guard", "");
    style.textContent = css;
    (doc.head || root).appendChild(style);

    /* ---- 8. installed-app detection ----
       mv-standalone: launched from the iPad / Android home screen.
       mv-native:     running inside a Capacitor (or similar) wrapper.
       mv-app:        either one. Games can key their own CSS off these. */
    var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
                     window.navigator.standalone === true;
    var cap = window.Capacitor;
    var native = !!(cap && (typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : cap.isNative));
    if (standalone) root.classList.add("mv-standalone");
    if (native) root.classList.add("mv-native");
    if (standalone || native) root.classList.add("mv-app");
    window.__mvApp = { standalone: standalone, native: native };

    /* --mv-vh fallback for Safari < 15.4 (no dvh). */
    if (!(window.CSS && CSS.supports && CSS.supports("height", "100dvh"))) {
        var setVh = function () { root.style.setProperty("--mv-vh", (window.innerHeight * 0.01) + "px"); };
        setVh();
        window.addEventListener("resize", setVh);
        window.addEventListener("orientationchange", setVh);
    }

    /* ---- 6. sticky hover: wrap :hover rules in @media (hover: hover) ---- */
    function splitSelectors(text) {
        var out = [], depth = 0, start = 0;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (ch === "(" || ch === "[") depth++;
            else if (ch === ")" || ch === "]") depth--;
            else if (ch === "," && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
        }
        out.push(text.slice(start));
        return out;
    }
    function insideHoverMedia(owner) {
        for (var r = owner; r; r = r.parentRule) {
            var c = r.conditionText || (r.media && r.media.mediaText) || "";
            if (/hover\s*:\s*hover/.test(c)) return true;
        }
        return false;
    }
    function wrapRules(list, owner) {
        if (insideHoverMedia(owner)) return;
        for (var i = list.length - 1; i >= 0; i--) {
            var rule = list[i];
            if (rule.selectorText && rule.selectorText.indexOf(":hover") !== -1) {
                var parts = splitSelectors(rule.selectorText);
                var hov = parts.filter(function (s) { return s.indexOf(":hover") !== -1; });
                var keep = parts.filter(function (s) { return s.indexOf(":hover") === -1; });
                var body = rule.style.cssText;
                if (keep.length) rule.selectorText = keep.join(",");
                else owner.deleteRule(i);
                if (body) {
                    try {
                        owner.insertRule("@media (hover:hover){" + hov.join(",") + "{" + body + "}}",
                                         keep.length ? i + 1 : i);
                    } catch (_) {}
                }
            } else if (rule.cssRules && rule.insertRule && !rule.selectorText) {
                wrapRules(rule.cssRules, rule);                /* @media / @supports / @layer */
            }
        }
    }
    var done = typeof WeakSet === "function" ? new WeakSet() : null;
    function sweep() {
        var sheets = doc.styleSheets;
        for (var i = 0; i < sheets.length; i++) {
            var sheet = sheets[i];
            if (done && done.has(sheet)) continue;
            var rules;
            try { rules = sheet.cssRules; } catch (_) { continue; } /* cross-origin (fonts) */
            if (!rules) continue;
            try { wrapRules(rules, sheet); } catch (_) {}
            if (done) done.add(sheet);
        }
    }
    window.__mvTouchGuardSweep = sweep;
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", sweep);
    else sweep();
    window.addEventListener("load", sweep);
    setTimeout(sweep, 1500);                                  /* sheets injected after load */
})();
