/* ============================================================
   Let's CRAYte! Pootery — main script
   ============================================================
   Single IIFE. Chunk 1 covers the title screen + screen-switching
   scaffold. Chunks 2-3 (shape + decorate) bolt onto SCREENS via
   registerScreen() and the SCREENS map. Chunks 5-6 add KILN +
   GALLERY the same way.
   ============================================================ */

(function () {
    "use strict";

    /* ---------- 1. SCREEN ROUTER ----------
       Screens are <main class="screen" id="screen-{id}">. Showing
       one hides the others. Each screen optionally registers an
       onEnter / onLeave hook via registerScreen(). The body's
       class swaps in lockstep so screen-specific CSS can hook.   */

    const SCREENS = Object.create(null);

    function registerScreen(id, hooks) {
        SCREENS[id] = Object.assign(
            { onEnter: null, onLeave: null },
            hooks || {}
        );
    }

    let currentScreen = "title";

    function showScreen(id) {
        const target = document.getElementById("screen-" + id);
        if (!target) {
            console.warn("[CRAYte] no screen:", id);
            return;
        }

        const prev = SCREENS[currentScreen];
        if (prev && typeof prev.onLeave === "function") {
            try { prev.onLeave(); }
            catch (e) { console.error("[CRAYte] onLeave " + currentScreen, e); }
        }

        document.querySelectorAll("main.screen").forEach(function (el) {
            el.hidden = true;
        });
        target.hidden = false;

        document.body.classList.remove("screen-" + currentScreen);
        document.body.classList.add("screen-" + id);
        currentScreen = id;

        const next = SCREENS[id];
        if (next && typeof next.onEnter === "function") {
            try { next.onEnter(); }
            catch (e) { console.error("[CRAYte] onEnter " + id, e); }
        }

        window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    }

    /* ---------- 2. TITLE SCREEN ---------- */

    registerScreen("title", {
        onEnter: function () { startClock(); },
        onLeave: function () { stopClock(); }
    });

    function initTitle() {
        const btnStart    = document.getElementById("btnStart");
        const btnGallery  = document.getElementById("btnGallery");
        const btnSettings = document.getElementById("btnSettings");

        if (btnStart) {
            btnStart.addEventListener("click", function () {
                /* Chunk 2 mounts #screen-shape and showScreen("shape")
                   becomes the real handoff. For chunk 1, give the user
                   honest, in-character feedback that this is coming. */
                if (SCREENS["shape"]) {
                    showScreen("shape");
                } else {
                    flashStub(btnStart, "WHEEL BOOTING...");
                }
            });
        }

        if (btnGallery) {
            btnGallery.addEventListener("click", function () {
                if (SCREENS["gallery"]) {
                    showScreen("gallery");
                } else {
                    flashStub(btnGallery, "NO POTS YET");
                }
            });
        }

        if (btnSettings) {
            btnSettings.addEventListener("click", function () {
                if (SCREENS["settings"]) {
                    showScreen("settings");
                } else {
                    flashStub(btnSettings, "COMING SOON");
                }
            });
        }

        wireSpecsPanel();
    }

    /* Temporary "feature not built yet" feedback. Swaps the button
       label for a beat. Removed once chunks 2-3 wire real screens. */
    function flashStub(btn, msg) {
        const label = btn.querySelector(".btn-label");
        if (!label) return;
        if (btn._stubT) clearTimeout(btn._stubT);
        const original = label.dataset.orig || label.textContent;
        label.dataset.orig = original;
        label.textContent = msg;
        btn.classList.add("is-stub");
        btn._stubT = setTimeout(function () {
            label.textContent = original;
            btn.classList.remove("is-stub");
        }, 1100);
    }

    /* ---------- 3. SPECS PANEL ----------
       Easter-egg payload (chunk 8) lives here. The opener is the
       small [?] in the corner. Chunk 1 ships the panel itself so
       there's already something to find; chunk 8 layers Konami /
       overheat / PINGAS on top.                                  */

    function wireSpecsPanel() {
        const hook  = document.getElementById("specsHook");
        const panel = document.getElementById("specsPanel");
        const close = document.getElementById("specsClose");
        if (!hook || !panel || !close) return;

        function open() {
            panel.hidden = false;
            document.body.classList.add("specs-open");
            close.focus({ preventScroll: true });
        }
        function shut() {
            panel.hidden = true;
            document.body.classList.remove("specs-open");
            hook.focus({ preventScroll: true });
        }

        hook.addEventListener("click", open);
        close.addEventListener("click", shut);

        panel.addEventListener("click", function (e) {
            if (e.target === panel) shut();
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !panel.hidden) shut();
        });
    }

    /* ---------- 4. CRT CLOCK ----------
       The HH:MM:SS in the top bar. Only ticks while a screen that
       requests it is mounted. Title screen does; in-game screens
       in later chunks may want to suppress it.                   */

    let clockTimer = null;

    function tickClock() {
        const el = document.getElementById("crtClock");
        if (!el) return;
        const d = new Date();
        const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
        el.textContent =
            pad(d.getHours()) + ":" +
            pad(d.getMinutes()) + ":" +
            pad(d.getSeconds());
    }

    function startClock() {
        tickClock();
        if (clockTimer) return;
        clockTimer = setInterval(tickClock, 1000);
    }

    function stopClock() {
        if (!clockTimer) return;
        clearInterval(clockTimer);
        clockTimer = null;
    }

    /* ---------- 5. INIT ---------- */

    function init() {
        initTitle();
        showScreen("title");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    /* ---------- 6. EXPORT ----------
       A tiny window namespace so chunks 2+ can register screens
       without rewriting this file. Strictly internal.            */
    window.CRAYte = {
        registerScreen: registerScreen,
        showScreen: function (id) { showScreen(id); },
        get currentScreen() { return currentScreen; }
    };

})();
