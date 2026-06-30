/* ============================================================
   Spoiler Alert — clean out the fridge.
   Drag each item to a bin: Compost / Keep / Trash.
   Tap an item to inspect it (pop mystery lids, magnify smudged dates).

   No build system — plain vanilla JS, ships as-is.
   Placeholder art is emoji + CSS decay overlays (real art at launch).
   ============================================================ */
(function () {
    "use strict";

    /* ---------------- Catalog ----------------
       badBin = where an item goes when it's spoiled.
         produce / bakery / leftovers -> compost (organic scraps)
         dairy / meat / drink / condiment -> trash (packaging)
       modes = which inspection styles fit this item.
         visual  : you can tell on sight (mold, fuzz, bulge)
         date    : printed date you compare to "today"
         mystery : sealed container, pop the lid to reveal       */
    var CATALOG = [
        { e: "🍎", n: "Apple",        bin: "compost", modes: ["visual", "date"] },
        { e: "🍌", n: "Banana",       bin: "compost", modes: ["visual"] },
        { e: "🍓", n: "Strawberries", bin: "compost", modes: ["visual", "date"] },
        { e: "🍅", n: "Tomato",       bin: "compost", modes: ["visual"] },
        { e: "🥕", n: "Carrot",       bin: "compost", modes: ["visual"] },
        { e: "🥬", n: "Lettuce",      bin: "compost", modes: ["visual", "date"] },
        { e: "🥦", n: "Broccoli",     bin: "compost", modes: ["visual"] },
        { e: "🫑", n: "Pepper",       bin: "compost", modes: ["visual"] },
        { e: "🍇", n: "Grapes",       bin: "compost", modes: ["visual", "date"] },
        { e: "🍞", n: "Bread",        bin: "compost", modes: ["visual", "date"] },
        { e: "🥐", n: "Croissant",    bin: "compost", modes: ["visual"] },
        { e: "🥛", n: "Milk",         bin: "trash",   modes: ["date", "visual"] },
        { e: "🧀", n: "Cheese",       bin: "trash",   modes: ["visual", "date"] },
        { e: "🧈", n: "Butter",       bin: "trash",   modes: ["date"] },
        { e: "🥚", n: "Eggs",         bin: "trash",   modes: ["date"] },
        { e: "🍗", n: "Chicken",      bin: "trash",   modes: ["date", "visual"] },
        { e: "🥩", n: "Steak",        bin: "trash",   modes: ["date", "visual"] },
        { e: "🐟", n: "Fish",         bin: "trash",   modes: ["visual", "date"] },
        { e: "🧃", n: "Juice Box",    bin: "trash",   modes: ["date"] },
        { e: "🥤", n: "Soda",         bin: "trash",   modes: ["date"] },
        { e: "🍯", n: "Honey",        bin: "trash",   modes: ["date"] },
        { e: "🫙", n: "Jam",          bin: "trash",   modes: ["date", "visual"] },
        { e: "🥫", n: "Sauce Can",    bin: "trash",   modes: ["date", "visual"], canBulge: true },
        { e: "🥡", n: "Leftovers",    bin: "compost", modes: ["mystery"] },
        { e: "🍱", n: "Bento",        bin: "compost", modes: ["mystery"] },
        { e: "📦", n: "Mystery Tub",  bin: "compost", modes: ["mystery"] }
    ];
    var CONTAINER_GLYPH = { "🥡": "🥡", "🍱": "🍱", "📦": "📦" };

    /* ---------------- DOM refs ---------------- */
    var D = document;
    var shelvesEl = D.getElementById("shelves");
    var binsEl = D.getElementById("bins");
    var grimeEl = D.getElementById("grime");
    var bubblesEl = D.getElementById("bubbles");
    var fridgeEl = D.getElementById("fridge");
    var overlayEl = D.getElementById("overlay");
    var overlayCard = D.getElementById("overlayCard");
    var hintEl = D.getElementById("hint");
    var muteBtn = D.getElementById("muteBtn");
    var hud = {
        lvl: D.getElementById("hLvl"),
        today: D.getElementById("hToday"),
        time: D.getElementById("hTime"),
        timeWrap: D.getElementById("hTimeWrap"),
        score: D.getElementById("hScore"),
        combo: D.getElementById("hCombo"),
        comboWrap: D.getElementById("hComboWrap")
    };
    var bins = Array.prototype.slice.call(binsEl.querySelectorAll(".bin"));

    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    /* ---------------- State ---------------- */
    var S = {
        level: 1,
        score: 0,
        combo: 0,         // consecutive correct (multiplier = combo, min 1)
        bestCombo: 0,
        items: [],        // live items on shelves
        correct: 0,
        wrong: 0,
        total: 0,
        timeLeft: 0,
        running: false,
        spoiledTotal: 1,
        today: new Date()
    };
    var timerId = null;
    var idSeq = 0;

    /* ---------------- Audio (WebAudio, no files) ---------------- */
    var AC = null, muted = false;
    function actx() {
        if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
        if (AC && AC.state === "suspended") AC.resume();
        return AC;
    }
    function tone(freq, dur, type, vol, slideTo) {
        if (muted) return;
        var c = actx(); if (!c) return;
        var t = c.currentTime;
        var o = c.createOscillator(), g = c.createGain();
        o.type = type || "sine";
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol) {
        if (muted) return;
        var c = actx(); if (!c) return;
        var n = Math.floor(c.sampleRate * dur);
        var buf = c.createBuffer(1, n, c.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        var src = c.createBufferSource(); src.buffer = buf;
        var g = c.createGain(); g.gain.value = vol || 0.12;
        var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
        src.connect(f); f.connect(g); g.connect(c.destination);
        src.start();
    }
    var SFX = {
        good: function () { tone(660, 0.12, "triangle", 0.2); setTimeout(function () { tone(990, 0.14, "triangle", 0.18); }, 70); },
        bad:  function () { tone(180, 0.25, "sawtooth", 0.16, 90); },
        squelch: function () { noise(0.3, 0.16); tone(120, 0.28, "sine", 0.1, 70); },
        pop:  function () { tone(520, 0.08, "square", 0.14, 760); },
        lift: function () { tone(440, 0.06, "sine", 0.08); },
        sparkle: function () { [880, 1175, 1568, 2093].forEach(function (f, i) { setTimeout(function () { tone(f, 0.16, "triangle", 0.14); }, i * 90); }); },
        tick: function () { tone(880, 0.04, "square", 0.06); }
    };

    /* ---------------- Helpers ---------------- */
    function rand(a, b) { return a + Math.random() * (b - a); }
    function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
    function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
    function chance(p) { return Math.random() < p; }
    function fmtDate(d) { return MONTHS[d.getMonth()] + " " + d.getDate(); }

    /* ---------------- Difficulty curve ---------------- */
    function levelConfig(lvl) {
        return {
            count: Math.min(7 + (lvl - 1) * 2, 18),
            spoiledRatio: 0.5,
            // weights for choosing inspect mode (visual easiest)
            wVisual: Math.max(0.25, 0.7 - lvl * 0.06),
            wDate: Math.min(0.55, 0.2 + lvl * 0.05),
            wMystery: Math.min(0.3, 0.1 + lvl * 0.035),
            smudge: Math.min(0.6, 0.1 + lvl * 0.07),     // chance a date is hard to read
            bulge: Math.min(0.5, 0.15 + lvl * 0.05),     // chance spoiled cans bulge
            time: Math.max(28, 70 - (lvl - 1) * 4)       // seconds
        };
    }

    /* ---------------- Item generation ---------------- */
    function makeItem(cfg) {
        var base = pick(CATALOG);
        var spoiled = chance(cfg.spoiledRatio);

        // choose an inspect mode this item supports, weighted
        var mode = chooseMode(base.modes, cfg);

        var it = {
            id: ++idSeq,
            base: base,
            spoiled: spoiled,
            mode: mode,
            correctBin: spoiled ? base.bin : "keep",
            opened: mode !== "mystery",   // non-mystery are "open" already
            date: null,
            dateStr: "",
            smudged: false,
            bulge: false,
            el: null
        };

        if (mode === "date") {
            var off = spoiled ? -randInt(1, 30) : randInt(2, 40);
            var d = new Date(S.today.getTime());
            d.setDate(d.getDate() + off);
            it.date = d;
            it.dateStr = "USE BY " + fmtDate(d);
            it.smudged = chance(cfg.smudge);
        }
        if (mode === "visual" && spoiled && base.canBulge && chance(cfg.bulge)) {
            it.bulge = true;
        }
        return it;
    }

    function chooseMode(modes, cfg) {
        var w = { visual: cfg.wVisual, date: cfg.wDate, mystery: cfg.wMystery };
        var pool = [];
        modes.forEach(function (m) { pool.push({ m: m, w: w[m] || 0.1 }); });
        var sum = pool.reduce(function (a, p) { return a + p.w; }, 0);
        var r = Math.random() * sum;
        for (var i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) return pool[i].m; }
        return pool[0].m;
    }

    /* ---------------- Rendering ---------------- */
    function buildTile(it) {
        var el = D.createElement("button");
        el.type = "button";
        el.className = "tile";
        el.dataset.id = it.id;

        var showSpoiledVisual = it.spoiled && (it.mode === "visual" || (it.mode === "mystery" && it.opened));
        if (showSpoiledVisual) el.classList.add("spoiled");
        if (it.bulge) el.classList.add("bulge");

        var glyph = it.base.e;
        if (it.mode === "mystery" && !it.opened) glyph = CONTAINER_GLYPH[it.base.e] || "📦";

        var html = '<span class="glyph">' + glyph + "</span>";
        if (it.mode === "date") {
            html += '<span class="datelabel' + (it.smudged ? " smudge" : "") + '">' + it.dateStr + "</span>";
        }
        if (it.mode === "mystery" && !it.opened) {
            html += '<span class="mystery-badge">?</span>';
        }
        el.innerHTML = html;
        it.el = el;
        attachDrag(el, it);
        return el;
    }

    function layout() {
        shelvesEl.innerHTML = "";
        // distribute items across 3-4 shelves
        var shelfCount = S.items.length > 12 ? 4 : 3;
        var shelves = [];
        for (var i = 0; i < shelfCount; i++) {
            var sh = D.createElement("div");
            sh.className = "shelf";
            shelvesEl.appendChild(sh);
            shelves.push(sh);
        }
        S.items.forEach(function (it, i) {
            shelves[i % shelfCount].appendChild(buildTile(it));
        });
    }

    /* ---------------- Inspect (tap) ---------------- */
    var bubbleEl = null;
    function clearBubble() { if (bubbleEl) { bubbleEl.remove(); bubbleEl = null; } }

    function inspect(it) {
        actx();
        if (it.mode === "mystery" && !it.opened) {
            openMystery(it);
            return;
        }
        // date / visual -> magnify a hint bubble
        clearBubble();
        var r = it.el.getBoundingClientRect();
        var b = D.createElement("div");
        b.className = "bubble";
        if (it.mode === "date") {
            b.innerHTML = '<span class="lbl">Label reads</span><span class="big">' + it.dateStr.replace("USE BY ", "") + '</span><span class="lbl">Today: ' + fmtDate(S.today) + "</span>";
        } else {
            var word = it.spoiled ? "🤢 Smells off…" : "👍 Looks fresh";
            b.innerHTML = '<span class="big">' + it.base.e + '</span><span class="lbl">' + word + "</span>";
        }
        b.style.left = (r.left + r.width / 2) + "px";
        b.style.top = (r.top - 8) + "px";
        D.body.appendChild(b);
        bubbleEl = b;
        SFX.lift();
        clearTimeout(inspect._t);
        inspect._t = setTimeout(clearBubble, 1600);
    }

    function openMystery(it) {
        it.opened = true;
        var el = it.el;
        el.classList.add("opened");
        var badge = el.querySelector(".mystery-badge");
        if (badge) badge.remove();
        var glyph = el.querySelector(".glyph");
        glyph.textContent = it.base.e;
        SFX.pop();
        if (it.spoiled) {
            el.classList.add("spoiled");
            SFX.squelch();
            var r = el.getBoundingClientRect();
            var fr = fridgeEl.getBoundingClientRect();
            spawnFx("💨", r.left + r.width / 2 - fr.left, r.top - fr.top, "puff");
        }
    }

    /* ---------------- Drag to bin ---------------- */
    function attachDrag(el, it) {
        var startX = 0, startY = 0, dragging = false, clone = null, offX = 0, offY = 0, moved = false;

        function onDown(ev) {
            if (!S.running || it.resolved) return;
            actx();
            var p = point(ev);
            startX = p.x; startY = p.y; moved = false; dragging = false;
            // attach listeners FIRST so a thrown setPointerCapture can't abort the drag
            el.addEventListener("pointermove", onMove);
            el.addEventListener("pointerup", onUp);
            el.addEventListener("pointercancel", onUp);
            try { el.setPointerCapture(ev.pointerId); } catch (e) { /* non-fatal */ }
        }
        function onMove(ev) {
            var p = point(ev);
            var dx = p.x - startX, dy = p.y - startY;
            if (!dragging) {
                if (Math.abs(dx) + Math.abs(dy) < 9) return;
                dragging = true; moved = true;
                clearBubble();
                startClone(p);
            }
            clone.style.left = (p.x - offX) + "px";
            clone.style.top = (p.y - offY) + "px";
            highlightBin(binUnder(p));
        }
        function onUp(ev) {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.removeEventListener("pointercancel", onUp);
            if (!dragging) { if (!moved) inspect(it); return; }
            var p = point(ev);
            var target = binUnder(p);
            highlightBin(null);
            if (target) {
                resolve(it, target.dataset.bin, clone);
            } else {
                cancelDrag(clone, el);
            }
            clone = null;
            D.body.classList.remove("dragging");
        }
        function startClone(p) {
            var r = el.getBoundingClientRect();
            offX = p.x - r.left; offY = p.y - r.top;
            clone = el.cloneNode(true);
            clone.classList.add("drag-clone");
            clone.style.width = r.width + "px";
            clone.style.height = r.height + "px";
            clone.style.left = r.left + "px";
            clone.style.top = r.top + "px";
            D.body.appendChild(clone);
            el.classList.add("lifting");
            D.body.classList.add("dragging");
            SFX.lift();
        }
        el.addEventListener("pointerdown", onDown);
    }

    function point(ev) {
        return { x: ev.clientX, y: ev.clientY };
    }
    function binUnder(p) {
        for (var i = 0; i < bins.length; i++) {
            var r = bins[i].getBoundingClientRect();
            if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return bins[i];
        }
        return null;
    }
    function highlightBin(b) {
        bins.forEach(function (x) { x.classList.toggle("hot", x === b); });
    }
    function cancelDrag(clone, el) {
        var r = el.getBoundingClientRect();
        clone.style.transition = "left .18s ease, top .18s ease, transform .18s ease";
        requestAnimationFrame(function () {
            clone.style.left = r.left + "px";
            clone.style.top = r.top + "px";
            clone.style.transform = "scale(1)";
        });
        setTimeout(function () { clone.remove(); el.classList.remove("lifting"); }, 200);
    }

    /* ---------------- Resolve a sort ---------------- */
    function resolve(it, bin, clone) {
        if (it.resolved) return;
        it.resolved = true;
        var binEl = bins.filter(function (b) { return b.dataset.bin === bin; })[0];

        // fly the clone into the bin
        var br = binEl.getBoundingClientRect();
        clone.style.transition = "left .2s ease, top .2s ease, transform .2s ease, opacity .2s ease";
        requestAnimationFrame(function () {
            clone.style.left = (br.left + br.width / 2 - clone.offsetWidth / 2) + "px";
            clone.style.top = (br.top + br.height / 2 - clone.offsetHeight / 2) + "px";
            clone.style.transform = "scale(0.3)";
            clone.style.opacity = "0";
        });
        setTimeout(function () { clone.remove(); }, 220);

        var ok = bin === it.correctBin;
        var fr = fridgeEl.getBoundingClientRect();
        var ir = it.el.getBoundingClientRect();
        var fx = ir.left + ir.width / 2 - fr.left;
        var fy = ir.top + ir.height / 2 - fr.top;

        if (ok) {
            S.combo += 1;
            S.bestCombo = Math.max(S.bestCombo, S.combo);
            var pts = 100 * S.combo;
            S.score += pts;
            S.correct += 1;
            binEl.classList.remove("good-flash"); void binEl.offsetWidth; binEl.classList.add("good-flash");
            SFX.good();
            spawnFx("+" + pts, fx, fy, "plus");
            sparkleBurst(br.left + br.width / 2 - fr.left, br.top - fr.top);
            bumpCombo(true);
        } else {
            S.combo = 0;
            S.score = Math.max(0, S.score - 40);
            S.wrong += 1;
            binEl.classList.remove("bad-flash"); void binEl.offsetWidth; binEl.classList.add("bad-flash");
            SFX.bad();
            // explain the mistake briefly
            var why = mistakeMsg(it, bin);
            spawnFx("✖", fx, fy, "minus");
            flashHint(why);
            bumpCombo(false);
        }

        it.el.remove();
        S.items = S.items.filter(function (x) { return x !== it; });
        updateHud();
        updateGrime();
        if (S.items.length === 0) setTimeout(endLevel, 350);
    }

    function mistakeMsg(it, bin) {
        if (bin === "keep" && it.spoiled) return "Yikes — that " + it.base.n + " was spoiled!";
        if (bin !== "keep" && !it.spoiled) return "That " + it.base.n + " was still good!";
        // bad food, wrong waste bin
        return it.base.n + " spoiled — that goes in " + (it.correctBin === "compost" ? "Compost" : "Trash") + ".";
    }

    /* ---------------- FX ---------------- */
    function spawnFx(txt, x, y, cls) {
        var f = D.createElement("div");
        f.className = "fx " + cls;
        f.textContent = txt;
        f.style.left = x + "px";
        f.style.top = y + "px";
        bubblesEl.appendChild(f);
        setTimeout(function () { f.remove(); }, 950);
    }
    function sparkleBurst(x, y) {
        for (var i = 0; i < 4; i++) {
            (function (i) {
                var s = D.createElement("div");
                s.className = "sparkle";
                s.textContent = "✨";
                s.style.left = (x + rand(-22, 22)) + "px";
                s.style.top = (y + rand(-10, 20)) + "px";
                s.style.animationDelay = (i * 0.05) + "s";
                bubblesEl.appendChild(s);
                setTimeout(function () { s.remove(); }, 800);
            })(i);
        }
    }
    function bumpCombo(good) {
        hud.comboWrap.classList.remove("bump");
        void hud.comboWrap.offsetWidth;
        hud.comboWrap.classList.add("bump");
        hud.comboWrap.classList.toggle("hot", good && S.combo >= 4);
    }

    /* ---------------- HUD / grime ---------------- */
    function updateHud() {
        hud.lvl.textContent = S.level;
        hud.score.textContent = S.score;
        hud.combo.textContent = "x" + Math.max(1, S.combo);
        hud.today.textContent = fmtDate(S.today);
    }
    function updateGrime() {
        var spoiledLeft = S.items.filter(function (x) { return x.spoiled; }).length;
        grimeEl.style.opacity = String((spoiledLeft / S.spoiledTotal) * 0.9);
    }
    function flashHint(msg) {
        hintEl.textContent = msg;
        clearTimeout(flashHint._t);
        flashHint._t = setTimeout(function () {
            hintEl.textContent = "Drag each item to a bin · tap to take a closer look";
        }, 2200);
    }

    /* ---------------- Timer ---------------- */
    function startTimer() {
        stopTimer();
        timerId = setInterval(function () {
            S.timeLeft -= 1;
            if (S.timeLeft <= 10) { hud.timeWrap.classList.add("low"); if (S.timeLeft > 0) SFX.tick(); }
            if (S.timeLeft <= 0) { S.timeLeft = 0; renderTime(); endLevel(); return; }
            renderTime();
        }, 1000);
    }
    function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
    function renderTime() { hud.time.textContent = S.timeLeft; }

    /* ---------------- Level flow ---------------- */
    function startLevel(lvl) {
        S.level = lvl;
        S.today = new Date();
        var cfg = levelConfig(lvl);
        S.items = [];
        for (var i = 0; i < cfg.count; i++) S.items.push(makeItem(cfg));
        // guarantee at least one spoiled and one good so it's never trivial
        ensureMix();
        S.spoiledTotal = Math.max(1, S.items.filter(function (x) { return x.spoiled; }).length);
        S.correct = 0; S.wrong = 0; S.total = S.items.length; S.combo = 0; S.bestCombo = 0;
        S.timeLeft = cfg.time;
        S.running = true;

        hud.timeWrap.classList.remove("low");
        layout();
        updateHud();
        updateGrime();
        renderTime();
        startTimer();
        hideOverlay();
        flashHint("Level " + lvl + " — sort it out!");
    }

    function ensureMix() {
        var spoiled = S.items.filter(function (x) { return x.spoiled; });
        var good = S.items.filter(function (x) { return !x.spoiled; });
        if (spoiled.length === 0 && S.items[0]) { S.items[0].spoiled = true; S.items[0].correctBin = S.items[0].base.bin; }
        if (good.length === 0 && S.items[1]) { S.items[1].spoiled = false; S.items[1].correctBin = "keep"; }
    }

    function endLevel() {
        if (!S.running) return;
        S.running = false;
        stopTimer();
        clearBubble();
        var timeBonus = S.timeLeft * 10;
        S.score += timeBonus;
        var sorted = S.correct + S.wrong;
        var acc = sorted ? Math.round((S.correct / sorted) * 100) : 0;
        // leftover (un-sorted, ran out of time) items count against accuracy display only
        var grade = acc >= 95 ? "🌟" : acc >= 80 ? "✨" : acc >= 60 ? "🙂" : "🧽";
        var clean = S.items.length === 0;
        updateHud();
        showSummary(acc, timeBonus, grade, clean);
        SFX.sparkle();
    }

    /* ---------------- Overlays ---------------- */
    function hideOverlay() { overlayEl.classList.add("hidden"); }
    function showOverlay(html) {
        overlayCard.innerHTML = html;
        overlayEl.classList.remove("hidden");
    }

    function showTitle() {
        S.running = false;
        stopTimer();
        showOverlay(
            '<h1>Spoiler Alert</h1>' +
            '<p class="tag">Clean out the fridge</p>' +
            '<p>Drag every item into a bin. <b>Toss</b> the spoiled stuff, ' +
            '<b>compost</b> the food scraps, and <b>keep</b> the good food. ' +
            'Tap an item to read a smudged date or pop a mystery tub.</p>' +
            '<div class="legend">' +
            '<span><span class="e">🌱</span>Compost<br>scraps</span>' +
            '<span><span class="e">✅</span>Keep<br>good food</span>' +
            '<span><span class="e">🗑️</span>Trash<br>packaging</span>' +
            '</div>' +
            '<button class="btn" id="startBtn">Start cleaning</button>'
        );
        D.getElementById("startBtn").addEventListener("click", function () {
            actx();
            S.score = 0;
            startLevel(1);
        });
    }

    function showSummary(acc, timeBonus, grade, clean) {
        showOverlay(
            '<div class="grade">' + grade + '</div>' +
            '<h2>' + (clean ? "Fridge cleaned!" : "Time's up!") + '</h2>' +
            '<p class="tag">Level ' + S.level + (clean ? " complete" : "") + '</p>' +
            '<div class="stats">' +
            '<div><b>' + acc + '%</b><small>Accuracy</small></div>' +
            '<div><b>x' + Math.max(1, S.bestCombo) + '</b><small>Best combo</small></div>' +
            '<div><b>+' + timeBonus + '</b><small>Time bonus</small></div>' +
            '<div><b>' + S.score + '</b><small>Total score</small></div>' +
            '</div>' +
            '<button class="btn" id="nextBtn">' + (clean ? "Next fridge →" : "Try level " + S.level + " again") + '</button>' +
            '<button class="btn ghost" id="menuBtn">Main menu</button>'
        );
        D.getElementById("nextBtn").addEventListener("click", function () {
            startLevel(clean ? S.level + 1 : S.level);
        });
        D.getElementById("menuBtn").addEventListener("click", function () {
            S.score = 0; showTitle();
        });
    }

    /* ---------------- Mute ---------------- */
    muteBtn.addEventListener("click", function () {
        muted = !muted;
        muteBtn.classList.toggle("muted", muted);
        muteBtn.textContent = muted ? "🔇" : "🔊";
        if (!muted) actx();
    });

    /* bins also resolve a tap-drop fallback isn't needed; keep dead-simple */

    /* clear inspect bubble on any outside tap */
    D.addEventListener("pointerdown", function (ev) {
        if (bubbleEl && !ev.target.closest(".tile")) clearBubble();
    });

    /* ---------------- Boot ---------------- */
    showTitle();
    window.__spoiler = S; // debug handle
})();
