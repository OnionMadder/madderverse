/* ============================================================
   SOLDER SANITY — a calm soldering bench.
   Madderverse. Flat game shape: index.html + game.js + style.css.

   One gesture runs the whole game: press and HOLD a pad.
     - the iron comes down, the pad heats (dull red -> orange)
     - past FLOW_TEMP the solder feeds and the fillet grows
     - let go; it cools and sets. How full it was at release
       decides the joint: cold / good / perfect / blobby.
   Nothing fails. Anything can be reheated (hold again to add
   more) or wiped back to bare copper with the wick. There is no
   timer anywhere in this file, deliberately.

   Everything is drawn to one canvas in BOARD UNITS (240x160) and
   scaled to fit; all sound is synthesised, so there are no
   audio assets to ship.
   ============================================================ */

(function () {
    "use strict";

    /* ---------------- tuning ---------------- */

    var BOARD_W = 240, BOARD_H = 160;   // board-space units
    var PAD_R   = 6;                    // copper pad radius
    var HIT_R   = 14;                   // finger target radius
    var LIFT_R  = 30;                   // slide this far off and the iron lifts

    var HEAT_RATE   = 2.0;              // heat climbs toward 1.0
    var COOL_RATE   = 1.35;
    var FLOW_TEMP   = 0.42;             // solder starts to flow
    var FLOW_RATE   = 0.44;             // fill per second once flowing
    var FREEZE_TEMP = 0.14;             // below this the joint sets
    var MAX_FILL    = 1.15;
    var SWEET_LO    = 0.42, SWEET_HI = 0.78;   // the green band on the gauge

    var GRADES = {
        perfect: { label: "Perfect", color: "#7fd39a", metal: "#e4ebf1" },
        good:    { label: "Good",    color: "#d8a24a", metal: "#ccd4da" },
        cold:    { label: "Cold",    color: "#9aa3a8", metal: "#a9b1b6" },
        blob:    { label: "Blobby",  color: "#e0a06a", metal: "#d6dde3" }
    };

    var TIPS = [
        "A good joint looks like a tiny shiny volcano — solder hugging the pad, not sitting on it like a ball.",
        "Heat the pad, not the solder. Warm copper pulls the solder in all by itself.",
        "A dull grey lump usually means the pad was still cold. Hold a beat longer next time.",
        "Too much solder can bridge two pads together. That is what the wick is for.",
        "Real solder smells like pine, because the flux inside it is tree rosin.",
        "Shiny is not just pretty — a shiny joint means the solder melted properly and flowed.",
        "There is no rush here. Nothing on this bench is on a timer."
    ];

    /* ---------------- parts ----------------
       Each part lists its pad offsets in board units, relative to
       the part's own centre, before rotation. */

    var PARTS = {
        battery:  { pads: [[-20, 0], [20, 0]],  draw: drawBattery,  ref: "BT" },
        resistor: { pads: [[-16, 0], [16, 0]],  draw: drawResistor, ref: "R" },
        led:      { pads: [[-9, 15], [9, 15]],  draw: drawLed,      ref: "D" },
        cap:      { pads: [[-8, 16], [8, 16]],  draw: drawCap,      ref: "C" },
        buzzer:   { pads: [[-9, 18], [9, 18]],  draw: drawBuzzer,   ref: "SP" },
        button:   { pads: [[-14, -14], [14, -14], [-14, 14], [14, 14]], draw: drawButton, ref: "SW" },
        chip:     { pads: [[-20, -24], [-20, -8], [-20, 8], [-20, 24],
                           [20, -24], [20, -8], [20, 8], [20, 24]],     draw: drawChip,   ref: "IC" }
    };

    /* ---------------- boards ---------------- */

    var BOARDS = [
        {
            id: "first-light",
            name: "First Light",
            sub: "A battery, a resistor, one happy LED.",
            power: "steady",
            parts: [
                { t: "battery",  x: 52,  y: 84 },
                { t: "resistor", x: 126, y: 44 },
                { t: "led",      x: 196, y: 82, color: "#ff5f5f" }
            ],
            nets: [[[0, 1], [1, 0]], [[1, 1], [2, 0]], [[2, 1], [0, 0]]]
        },
        {
            id: "twin-blink",
            name: "Twin Blink",
            sub: "Two lights taking turns.",
            power: "alternate",
            parts: [
                { t: "battery",  x: 44,  y: 84 },
                { t: "resistor", x: 116, y: 42 },
                { t: "resistor", x: 116, y: 124 },
                { t: "led",      x: 190, y: 40,  color: "#ffd24a" },
                { t: "led",      x: 190, y: 122, color: "#5ad1ff" }
            ],
            nets: [
                [[0, 1], [1, 0]], [[1, 1], [3, 0]], [[3, 1], [0, 0]],
                [[0, 1], [2, 0]], [[2, 1], [4, 0]], [[4, 1], [0, 0]]
            ]
        },
        {
            id: "little-beeper",
            name: "Little Beeper",
            sub: "A chip, a button and a very small song.",
            power: "blink",
            tune: [523, 659, 784, 1046],
            parts: [
                { t: "battery", x: 38,  y: 82 },
                { t: "chip",    x: 120, y: 82 },
                { t: "buzzer",  x: 200, y: 40 },
                { t: "button",  x: 200, y: 122 }
            ],
            nets: [
                [[0, 1], [1, 0]], [[1, 4], [2, 0]], [[2, 1], [1, 5]],
                [[1, 6], [3, 0]], [[3, 3], [1, 7]], [[1, 3], [0, 0]]
            ]
        },
        {
            id: "night-light",
            name: "Night Light",
            sub: "Three warm bulbs that come on in a row.",
            power: "chase",
            parts: [
                { t: "battery", x: 38,  y: 82 },
                { t: "chip",    x: 104, y: 82 },
                { t: "cap",     x: 160, y: 34 },
                { t: "led",     x: 208, y: 34,  color: "#ffcf8f" },
                { t: "led",     x: 208, y: 82,  color: "#ffcf8f" },
                { t: "led",     x: 208, y: 122, color: "#ffcf8f" }
            ],
            nets: [
                [[0, 1], [1, 0]], [[1, 1], [2, 0]], [[2, 1], [3, 0]],
                [[1, 4], [4, 0]], [[1, 5], [5, 0]],
                [[3, 1], [0, 0]], [[4, 1], [0, 0]], [[5, 1], [0, 0]]
            ]
        },
        {
            id: "robot-face",
            name: "Robot Face",
            sub: "Give it eyes and it will look right back.",
            power: "face",
            tune: [392, 523, 659],
            parts: [
                { t: "chip",    x: 120, y: 82 },
                { t: "led",     x: 78,  y: 34,  color: "#5ad1ff" },
                { t: "led",     x: 162, y: 34,  color: "#5ad1ff" },
                { t: "led",     x: 86,  y: 122, color: "#ff8ad1" },
                { t: "led",     x: 120, y: 130, color: "#ff8ad1" },
                { t: "led",     x: 154, y: 122, color: "#ff8ad1" },
                { t: "battery", x: 38,  y: 82 }
            ],
            nets: [
                [[6, 1], [0, 0]], [[0, 1], [1, 0]], [[0, 4], [2, 0]],
                [[0, 2], [3, 0]], [[0, 3], [4, 0]], [[0, 5], [5, 0]],
                [[1, 1], [6, 0]], [[2, 1], [6, 0]]
            ]
        },
        {
            id: "practice",
            name: "Practice Bench",
            sub: "A fresh handful of joints, forever.",
            power: "sparkle",
            endless: true
        }
    ];

    /* ---------------- state ---------------- */

    var state = {
        boardIndex: 0,
        board: null,        // built board: {def, parts[], joints[], nets[]}
        active: null,       // joint currently under the iron
        tool: "iron",
        t: 0,               // seconds since load
        powerT: -1,         // >=0 once the board is lit
        completed: false,
        smoke: [],
        sparks: [],
        labels: [],
        muted: false,
        reported: false,       // the report only interrupts once per board
        wickOffered: false
    };

    var cv, ctx, bench, dpr = 1;
    var view = { scale: 1, ox: 0, oy: 0, portrait: false };
    var reduceQuery = null;
    var els = {};

    /* ---------------- tiny helpers ---------------- */

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    /* How big the solder sits. Starved reads as a dot inside the pad,
       a good joint about covers it, a blob overhangs. */
    function jointRadius(j) { return PAD_R * (0.70 + 0.70 * Math.min(j.fill, MAX_FILL)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function rnd(a, b) { return a + Math.random() * (b - a); }

    function hex2rgb(h) {
        h = h.replace("#", "");
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function mix(a, b, t) {
        var A = hex2rgb(a), B = hex2rgb(b);
        return "rgb(" + Math.round(lerp(A[0], B[0], t)) + "," +
                        Math.round(lerp(A[1], B[1], t)) + "," +
                        Math.round(lerp(A[2], B[2], t)) + ")";
    }
    function reduceMotion() { return !!(reduceQuery && reduceQuery.matches); }
    function buzz(ms) {
        if (state.muted) return;
        try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
    }

    function lsGet(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
    }
    function lsSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }

    /* ---------------- audio (all synthesised) ---------------- */

    var audio = (function () {
        var ac = null, master = null, sizzleGain = null, humGain = null, ready = false;

        function noiseBuffer(seconds) {
            var len = Math.floor(ac.sampleRate * seconds);
            var buf = ac.createBuffer(1, len, ac.sampleRate);
            var d = buf.getChannelData(0);
            for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            return buf;
        }

        function ensure() {
            if (ready) { if (ac.state === "suspended") ac.resume(); return true; }
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            ac = new AC();
            master = ac.createGain();
            master.gain.value = state.muted ? 0 : 0.9;
            master.connect(ac.destination);

            // Room tone: two detuned low sines. Barely there, but the
            // silence without it feels colder than the bench should.
            humGain = ac.createGain();
            humGain.gain.value = 0.016;
            humGain.connect(master);
            [54, 55.4].forEach(function (f) {
                var o = ac.createOscillator();
                o.type = "sine"; o.frequency.value = f;
                o.connect(humGain); o.start();
            });

            // Continuous solder sizzle, gated open while the iron flows.
            var src = ac.createBufferSource();
            src.buffer = noiseBuffer(2);
            src.loop = true;
            var bp = ac.createBiquadFilter();
            bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.8;
            sizzleGain = ac.createGain();
            sizzleGain.gain.value = 0;
            src.connect(bp); bp.connect(sizzleGain); sizzleGain.connect(master);
            src.start();

            ready = true;
            return true;
        }

        function ping(freq, dur, type, vol, delay) {
            if (!ensure()) return;
            var t0 = ac.currentTime + (delay || 0);
            var o = ac.createOscillator(), g = ac.createGain();
            o.type = type || "sine";
            o.frequency.setValueAtTime(freq, t0);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.3));
            o.connect(g); g.connect(master);
            o.start(t0); o.stop(t0 + (dur || 0.3) + 0.05);
        }

        function burst(freq, q, dur, vol, sweepTo) {
            if (!ensure()) return;
            var t0 = ac.currentTime;
            var src = ac.createBufferSource();
            src.buffer = noiseBuffer(Math.max(0.2, dur));
            var bp = ac.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.setValueAtTime(freq, t0);
            if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
            bp.Q.value = q;
            var g = ac.createGain();
            g.gain.setValueAtTime(vol, t0);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            src.connect(bp); bp.connect(g); g.connect(master);
            src.start(t0); src.stop(t0 + dur + 0.05);
        }

        return {
            unlock: ensure,
            setMuted: function (m) {
                state.muted = m;
                if (ready) master.gain.value = m ? 0 : 0.9;
            },
            /* iron touches copper */
            contact: function () { burst(3200, 1.2, 0.16, 0.28, 1400); },
            /* solder flowing, called every frame with 0..1 */
            sizzle: function (amount) {
                if (!ready) { if (amount <= 0) return; if (!ensure()) return; }
                var target = amount * 0.09;
                sizzleGain.gain.setTargetAtTime(target, ac.currentTime, 0.06);
            },
            /* the joint sets */
            set: function (grade) {
                if (grade === "perfect") { ping(880, 0.4, "sine", 0.14); ping(1318, 0.45, "sine", 0.09, 0.07); }
                else if (grade === "good") ping(740, 0.32, "sine", 0.12);
                else if (grade === "blob") ping(300, 0.3, "triangle", 0.09);
                else ping(392, 0.3, "sine", 0.08);
            },
            wick: function () { burst(1800, 0.7, 0.42, 0.22, 260); },
            chime: function (notes) {
                var seq = notes || [523, 659, 784, 1046];
                seq.forEach(function (f, i) { ping(f, 0.55, "sine", 0.13, i * 0.13); });
            },
            blip: function () { ping(620, 0.09, "square", 0.05); }
        };
    })();

    /* ---------------- board building ---------------- */

    function rot(px, py, deg) {
        if (!deg) return { x: px, y: py };
        var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        return { x: px * c - py * s, y: px * s + py * c };
    }

    function buildBoard(def) {
        var parts = [], joints = [], refCount = {};
        (def.parts || []).forEach(function (p, pi) {
            var spec = PARTS[p.t];
            refCount[spec.ref] = (refCount[spec.ref] || 0) + 1;
            var part = {
                t: p.t, x: p.x, y: p.y, r: p.r || 0,
                color: p.color || "#ff5f5f",
                label: spec.ref + refCount[spec.ref],
                spec: spec, lit: 0, first: joints.length, index: pi
            };
            spec.pads.forEach(function (off) {
                var o = rot(off[0], off[1], part.r);
                joints.push({
                    x: part.x + o.x, y: part.y + o.y,
                    heat: 0, fill: 0, grade: null, contact: 0,
                    seed: Math.random() * 6.28, pop: 0
                });
            });
            parts.push(part);
        });

        var nets = (def.nets || []).map(function (n) {
            var a = joints[parts[n[0][0]].first + n[0][1]];
            var b = joints[parts[n[1][0]].first + n[1][1]];
            return route(a, b);
        });

        return { def: def, parts: parts, joints: joints, nets: nets, leds: parts.filter(function (p) { return p.t === "led"; }) };
    }

    /* A trace runs straight then breaks at 45 degrees, the way a
       hand-routed board does. */
    function route(a, b) {
        var dx = b.x - a.x, dy = b.y - a.y;
        var ax = Math.abs(dx), ay = Math.abs(dy);
        var sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
        var A = { x: a.x, y: a.y }, B = { x: b.x, y: b.y };
        if (ax > ay) return [A, { x: a.x + sx * (ax - ay), y: a.y }, B];
        if (ay > ax) return [A, { x: a.x, y: a.y + sy * (ay - ax) }, B];
        return [A, B];
    }

    /* The endless bench: a fresh scatter of parts each time. */
    function makePracticeDef() {
        var slots = [
            { x: 58,  y: 44,  pool: ["resistor", "led", "cap"] },
            { x: 58,  y: 118, pool: ["resistor", "led", "buzzer"] },
            { x: 130, y: 40,  pool: ["led", "cap", "resistor"] },
            { x: 130, y: 120, pool: ["button", "led", "resistor"] },
            { x: 204, y: 82,  pool: ["led", "battery", "resistor"] }
        ];
        var colors = ["#ff5f5f", "#ffd24a", "#5ad1ff", "#ff8ad1", "#8fe08f"];
        var parts = slots.map(function (s) {
            return {
                t: s.pool[Math.floor(Math.random() * s.pool.length)],
                x: s.x, y: s.y,
                color: colors[Math.floor(Math.random() * colors.length)]
            };
        });
        var nets = [];
        for (var i = 0; i < parts.length - 1; i++) nets.push([[i, 1], [i + 1, 0]]);
        return {
            id: "practice", name: "Practice Bench",
            sub: "A fresh handful of joints, forever.",
            power: "sparkle", endless: true, parts: parts, nets: nets
        };
    }

    function loadBoard(index) {
        state.boardIndex = index;
        var def = BOARDS[index];
        if (def.endless) def = makePracticeDef();
        state.board = buildBoard(def);
        state.active = null;
        state.completed = false;
        state.reported = false;
        state.powerT = -1;
        state.smoke.length = 0;
        state.sparks.length = 0;
        state.labels.length = 0;
        audio.sizzle(0);
        updateHud();
        renderBoardList();
    }

    /* ---------------- progress ---------------- */

    var PROGRESS_KEY = "solder-sanity-progress";
    var progress = lsGet(PROGRESS_KEY, { done: {}, unlocked: 1 });
    if (!progress || typeof progress !== "object") progress = { done: {}, unlocked: 1 };
    if (!progress.done || typeof progress.done !== "object") progress.done = {};
    if (typeof progress.unlocked !== "number") progress.unlocked = 1;

    function isUnlocked(i) {
        return BOARDS[i].endless || i < progress.unlocked;
    }

    /* ---------------- input ---------------- */

    /* On a portrait screen the board is turned a quarter turn, the way
       you would turn a real board on the bench, so it uses the long
       dimension of the phone. Everything drawn ON the board goes through
       boardTransform(); everything held OVER it — iron, gauge, smoke —
       is drawn in screen space so it never comes in sideways. */
    function boardTransform() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(view.ox, view.oy);
        ctx.scale(view.scale, view.scale);
        if (view.portrait) { ctx.translate(0, BOARD_W); ctx.rotate(-Math.PI / 2); }
    }

    function toScreen(x, y) {
        if (view.portrait) {
            return { x: view.ox + y * view.scale, y: view.oy + (BOARD_W - x) * view.scale };
        }
        return { x: view.ox + x * view.scale, y: view.oy + y * view.scale };
    }

    function toBoard(ev) {
        var r = cv.getBoundingClientRect();
        var sx = ev.clientX - r.left, sy = ev.clientY - r.top;
        if (view.portrait) {
            return { x: BOARD_W - (sy - view.oy) / view.scale, y: (sx - view.ox) / view.scale };
        }
        return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale };
    }

    function jointAt(p) {
        var best = null, bestD = HIT_R * HIT_R;
        state.board.joints.forEach(function (j) {
            var dx = j.x - p.x, dy = j.y - p.y, d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = j; }
        });
        return best;
    }

    function onDown(ev) {
        if (ev.button !== undefined && ev.button !== 0) return;
        audio.unlock();
        var p = toBoard(ev);
        var j = jointAt(p);
        if (!j) return;
        ev.preventDefault();

        if (state.tool === "wick") {
            if (j.fill > 0.02) {
                j.fill = 0; j.grade = null; j.heat = Math.max(j.heat, 0.25); j.pop = 1;
                audio.wick(); buzz(12);
                float(j, "Clean", "#cfd6dc");
                reopenBoard();
                updateHud();
                dismissCoach();
            }
            return;
        }

        state.active = j;
        j.contact = 1;
        j.grade = null;          // reflowing an existing joint re-opens it
        reopenBoard();
        updateHud();
        audio.contact();
        buzz(8);
        for (var i = 0; i < 6; i++) spark(j);
        dismissCoach();
        try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    }

    function onMove(ev) {
        if (!state.active) return;
        var p = toBoard(ev);
        var dx = state.active.x - p.x, dy = state.active.y - p.y;
        if (dx * dx + dy * dy > LIFT_R * LIFT_R) lift();
    }

    /* Touching a joint on a board that is already lit takes the board
       back apart — it stays powered otherwise, cheerfully running on a
       joint that is no longer there. */
    function reopenBoard() {
        if (!state.completed) return;
        state.completed = false;
        state.powerT = -1;
        state.board.leds.forEach(function (l) { l.lit = 0; });
    }

    function lift() {
        if (!state.active) return;
        state.active.contact = 0;
        state.active = null;
        audio.sizzle(0);
    }

    function float(j, text, color) {
        var p = toScreen(j.x, j.y), k = view.scale;
        state.labels.push({ x: p.x, y: p.y - (PAD_R + 6) * k, text: text, color: color, life: 1 });
    }

    function spark(j) {
        var p = toScreen(j.x, j.y), k = view.scale;
        state.sparks.push({
            x: p.x, y: p.y,
            vx: rnd(-26, 26) * k, vy: rnd(-34, -6) * k,
            life: 1, ttl: rnd(0.25, 0.5)
        });
    }

    /* ---------------- update ---------------- */

    function update(dt) {
        state.t += dt;
        var board = state.board;
        var flowing = 0;

        board.joints.forEach(function (j) {
            if (j.contact) {
                j.heat += (1 - j.heat) * HEAT_RATE * dt;
                if (j.heat > FLOW_TEMP) {
                    var rate = FLOW_RATE * clamp((j.heat - FLOW_TEMP) / 0.2, 0.25, 1);
                    j.fill = Math.min(MAX_FILL, j.fill + rate * dt);
                    flowing = Math.max(flowing, clamp((j.heat - FLOW_TEMP) / 0.4, 0, 1));
                    if (Math.random() < dt * 5) spark(j);
                }
            } else {
                j.heat = Math.max(0, j.heat - COOL_RATE * dt * (0.4 + j.heat));
                if (j.grade === null && j.fill > 0.02 && j.heat < FREEZE_TEMP) {
                    j.grade = gradeFill(j.fill);
                    j.pop = 1;
                    audio.set(j.grade);
                    float(j, GRADES[j.grade].label, GRADES[j.grade].color);
                    if (j.grade === "blob") offerWick();
                    updateHud();
                    checkComplete();
                }
            }
            if (j.pop > 0) j.pop = Math.max(0, j.pop - dt * 2.4);

            // rosin smoke off anything hot
            if (j.heat > 0.45 && Math.random() < dt * (reduceMotion() ? 6 : 16)) {
                var sp = toScreen(j.x, j.y), k = view.scale;
                state.smoke.push({
                    x: sp.x + rnd(-2, 2) * k, y: sp.y - 2 * k,
                    vx: rnd(-5, 5) * k, vy: rnd(-16, -9) * k,
                    r: rnd(2, 4) * k, life: 1, ttl: rnd(1.1, 2.0)
                });
            }
        });

        audio.sizzle(flowing);

        step(state.smoke, dt, function (s) {
            s.x += s.vx * dt; s.y += s.vy * dt;
            s.vx += rnd(-8, 8) * view.scale * dt; s.vy *= 0.995;
            s.r += dt * 5 * view.scale;
        });
        step(state.sparks, dt, function (s) {
            s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 60 * view.scale * dt;
        });
        step(state.labels, dt * 0.75, function (l) { l.y -= dt * 12 * view.scale; });

        if (state.powerT >= 0) {
            state.powerT += dt;
            updateLeds(state.powerT);
            if (state.board.def.endless && state.powerT > 2.6) loadBoard(state.boardIndex);
        }
    }

    function step(arr, dt, fn) {
        for (var i = arr.length - 1; i >= 0; i--) {
            var p = arr[i];
            p.life -= dt / (p.ttl || 1);
            if (p.life <= 0) { arr.splice(i, 1); continue; }
            fn(p);
        }
    }

    function gradeFill(f) {
        if (f < 0.20) return "cold";
        if (f < SWEET_LO) return "good";
        if (f <= SWEET_HI) return "perfect";
        if (f <= 0.95) return "good";
        return "blob";
    }

    function tally() {
        var t = { perfect: 0, good: 0, cold: 0, blob: 0, done: 0, total: state.board.joints.length };
        state.board.joints.forEach(function (j) {
            if (j.grade) { t[j.grade]++; t.done++; }
        });
        return t;
    }

    function checkComplete() {
        if (state.completed) return;
        var t = tally();
        if (t.done < t.total) return;
        state.completed = true;
        state.powerT = 0;
        audio.chime(state.board.def.tune);
        buzz([10, 60, 18]);

        if (!state.board.def.endless) {
            var id = state.board.def.id;
            var prev = progress.done[id];
            if (!prev || t.perfect > prev.perfect) progress.done[id] = { perfect: t.perfect, total: t.total };
            if (state.boardIndex + 2 > progress.unlocked) progress.unlocked = state.boardIndex + 2;
            lsSet(PROGRESS_KEY, progress);
            if (!state.reported) { state.reported = true; setTimeout(showReport, 1700); }
        } else {
            float({ x: BOARD_W / 2, y: 26 }, "Nice bench.", "#7fd39a");
        }
        renderBoardList();
    }

    /* LED brightness while the board is powered. */
    function updateLeds(t) {
        var mode = state.board.def.power || "steady";
        var fade = clamp(t / 0.8, 0, 1);
        state.board.leds.forEach(function (led, i) {
            var v = 1;
            if (mode === "blink")      v = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 5));
            else if (mode === "alternate") v = (Math.floor(t * 1.6) + i) % 2 ? 0.12 : 1;
            else if (mode === "chase") v = 0.15 + 0.85 * Math.max(0, Math.cos((t * 2.2 - i * 0.7) % 6.28));
            else if (mode === "sparkle") v = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 3 + i * 1.7));
            else if (mode === "face") {
                if (i < 2) { var b = Math.sin(t * 0.9 + 1.2); v = b > 0.93 ? 0.08 : 1; }
                else v = 0.2 + 0.8 * Math.max(0, Math.cos((t * 3 - (i - 2) * 0.9) % 6.28));
            }
            led.lit = fade * v;
        });
    }

    /* ---------------- render ---------------- */

    function render() {
        var w = cv.width / dpr, h = cv.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        boardTransform();
        drawPcb();
        drawTraces();
        state.board.parts.forEach(function (p) { p.spec.draw(p); });
        state.board.joints.forEach(drawJoint);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (state.active) drawIron(state.active);
        drawSmoke();
        drawSparks();
        if (state.active) drawGauge(state.active);
        drawLabels();
    }

    function drawPcb() {
        var r = 8;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 22;
        ctx.shadowOffsetY = 10;
        roundRect(0, 0, BOARD_W, BOARD_H, r);
        var g = ctx.createLinearGradient(0, 0, 0, BOARD_H);
        g.addColorStop(0, "#2c7f5c");
        g.addColorStop(0.5, "#236a4c");
        g.addColorStop(1, "#1b543c");
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();

        // soldermask mottling, so it is not a flat slab of green
        ctx.save();
        roundRect(0, 0, BOARD_W, BOARD_H, r);
        ctx.clip();
        ctx.globalAlpha = 0.05;
        for (var i = 0; i < 16; i++) {
            var s = (i * 7919) % 997;
            ctx.fillStyle = i % 2 ? "#ffffff" : "#000000";
            ctx.beginPath();
            ctx.ellipse((s % BOARD_W), ((s * 3) % BOARD_H), 26 + (s % 22), 16 + (s % 14), s, 0, 6.283);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        // silkscreen border + mounting holes + a little studio mark
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 0.8;
        roundRect(5, 5, BOARD_W - 10, BOARD_H - 10, 5);
        ctx.stroke();

        [[11, 11], [BOARD_W - 11, 11], [11, BOARD_H - 11], [BOARD_W - 11, BOARD_H - 11]].forEach(function (h) {
            ctx.beginPath(); ctx.arc(h[0], h[1], 3.6, 0, 6.283);
            ctx.fillStyle = "#c9cfd4"; ctx.fill();
            ctx.beginPath(); ctx.arc(h[0], h[1], 2.1, 0, 6.283);
            ctx.fillStyle = "#12281f"; ctx.fill();
        });

        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = "600 5px 'Inter', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("MADDERVERSE  ·  " + state.board.def.name.toUpperCase(), 12, BOARD_H - 7);
        ctx.textAlign = "center";
    }

    function drawTraces() {
        var powered = state.powerT >= 0;
        state.board.nets.forEach(function (pts, i) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "rgba(0,0,0,0.22)";
            ctx.lineWidth = 3.6;
            ctx.stroke();
            ctx.strokeStyle = "rgba(150,235,195,0.42)";
            ctx.lineWidth = 2.4;
            ctx.stroke();

            if (powered) {
                ctx.save();
                ctx.strokeStyle = "rgba(190,255,225,0.85)";
                ctx.lineWidth = 1.4;
                ctx.setLineDash([4, 7]);
                ctx.lineDashOffset = reduceMotion() ? 0 : -(state.powerT * 26 + i * 3);
                ctx.shadowColor = "rgba(140,255,210,0.8)";
                ctx.shadowBlur = 6;
                ctx.stroke();
                ctx.restore();
            }
        });
        ctx.setLineDash([]);
    }

    function drawJoint(j) {
        var hot = j.heat;
        var r = jointRadius(j);

        // heat bloom on the board around the pad
        if (hot > 0.02) {
            var bloom = ctx.createRadialGradient(j.x, j.y, 0, j.x, j.y, r * 3.4);
            bloom.addColorStop(0, "rgba(255,150,50," + (hot * 0.4).toFixed(3) + ")");
            bloom.addColorStop(1, "rgba(255,120,30,0)");
            ctx.fillStyle = bloom;
            ctx.beginPath(); ctx.arc(j.x, j.y, r * 3.4, 0, 6.283); ctx.fill();
        }

        // bare copper pad (annular ring + drilled hole)
        ctx.beginPath(); ctx.arc(j.x, j.y, PAD_R, 0, 6.283);
        ctx.fillStyle = "#c8b184"; ctx.fill();
        ctx.beginPath(); ctx.arc(j.x, j.y, PAD_R * 0.52, 0, 6.283);
        ctx.fillStyle = "#13291f"; ctx.fill();

        // the component lead poking through
        ctx.beginPath(); ctx.arc(j.x, j.y, PAD_R * 0.3, 0, 6.283);
        ctx.fillStyle = "#8d979e"; ctx.fill();

        if (j.fill > 0.02) {
            var grade = j.grade ? GRADES[j.grade] : null;
            var base = grade ? grade.metal : "#d3dae0";
            var molten = clamp(hot * 1.3, 0, 1);
            var body = molten > 0.02 ? mix(base, "#ff9b30", molten * 0.85) : base;
            var lift = 1 + j.pop * 0.12;
            var rr = r * lift;

            ctx.save();
            if (molten > 0.05) {
                ctx.shadowColor = "rgba(255,150,60,0.9)";
                ctx.shadowBlur = 10 * molten;
            }
            var g = ctx.createRadialGradient(
                j.x - rr * 0.34, j.y - rr * 0.36, rr * 0.1,
                j.x, j.y, rr
            );
            var shine = (j.grade === "cold") ? 0.35 : 1;
            g.addColorStop(0, molten > 0.4 ? "#fff2c9" : "rgba(255,255,255," + (0.85 * shine) + ")");
            g.addColorStop(0.42, body);
            g.addColorStop(1, molten > 0.4 ? mix("#b45c15", "#ff9b30", molten) : mix(body, "#4a5157", 0.55));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(j.x, j.y, rr, 0, 6.283); ctx.fill();
            ctx.restore();

            if (j.grade === "cold") {
                // grainy, dull, sitting on top rather than wetted in
                ctx.globalAlpha = 0.22;
                ctx.fillStyle = "#5c646a";
                for (var i = 0; i < 5; i++) {
                    var a = j.seed + i * 1.25;
                    ctx.beginPath();
                    ctx.arc(j.x + Math.cos(a) * rr * 0.4, j.y + Math.sin(a) * rr * 0.4, rr * 0.22, 0, 6.283);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }
            if (j.grade === "perfect") {
                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.arc(j.x, j.y, rr * 0.72, Math.PI * 1.05, Math.PI * 1.62);
                ctx.stroke();
            }
        }
    }

    /* The arc gauge: a track, the green sweet band, and where you are. */
    function drawGauge(j) {
        var k = view.scale, p = toScreen(j.x, j.y);
        var r = (jointRadius(j) + 8) * k;
        var a0 = Math.PI * 0.72, a1 = Math.PI * 1.89;   // stops short of the iron
        var span = a1 - a0;

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineWidth = 2.2 * k;
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath(); ctx.arc(p.x, p.y, r, a0, a1); ctx.stroke();

        ctx.strokeStyle = "rgba(127,211,154,0.75)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, a0 + span * SWEET_LO, a0 + span * SWEET_HI);
        ctx.stroke();

        var f = clamp(j.fill, 0, 1);
        ctx.strokeStyle = j.heat > FLOW_TEMP ? "#ffd6a0" : "rgba(255,255,255,0.45)";
        ctx.lineWidth = 3 * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, a0, a0 + span * f); ctx.stroke();

        // heat pip: shows the pad warming before any solder moves
        if (j.fill < 0.02) {
            ctx.fillStyle = mix("#6b7378", "#ff9b30", clamp(j.heat / FLOW_TEMP, 0, 1));
            ctx.beginPath(); ctx.arc(p.x, p.y - r - 4 * k, 1.8 * k, 0, 6.283); ctx.fill();
        }
        ctx.restore();
    }

    function drawIron(j) {
        var wob = reduceMotion() ? 0 : Math.sin(state.t * 9) * 0.006 + Math.sin(state.t * 3.3) * 0.004;
        var a = 0.62 + wob;                    // handle sits down and to the right
        var p = toScreen(j.x, j.y);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(view.scale, view.scale);
        ctx.rotate(a);

        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;

        // tip: chisel taper, glowing at the very end when hot
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(8, -2.3);
        ctx.lineTo(15, -2.7);
        ctx.lineTo(15, 2.7);
        ctx.lineTo(8, 2.3);
        ctx.closePath();
        ctx.fillStyle = mix("#9d6a35", "#ffb04a", clamp(j.heat, 0, 1) * 0.7);
        ctx.fill();

        // ferrule
        roundRect(15, -3.7, 10, 7.4, 1.4);
        ctx.fillStyle = "#aeb6bb"; ctx.fill();

        // barrel
        roundRect(25, -4.9, 38, 9.8, 3.5);
        var g = ctx.createLinearGradient(0, -4.9, 0, 4.9);
        g.addColorStop(0, "#565c60");
        g.addColorStop(0.45, "#33383b");
        g.addColorStop(1, "#222628");
        ctx.fillStyle = g; ctx.fill();

        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        roundRect(29, -4.9, 2.8, 9.8, 1);
        ctx.fillStyle = "#d8a24a"; ctx.fill();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#000";
        for (var i = 0; i < 5; i++) { roundRect(39 + i * 4.4, -4.6, 1.8, 9.2, 1); ctx.fill(); }
        ctx.globalAlpha = 1;
        ctx.restore();

        // solder wire feeding in from the lower left while it flows
        if (j.heat > FLOW_TEMP * 0.8 && j.fill < MAX_FILL) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(view.scale, view.scale);
            ctx.strokeStyle = "#c3cad0";
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-3, 2);
            ctx.quadraticCurveTo(-26, 16, -40, 34);
            ctx.stroke();
            ctx.shadowColor = "rgba(255,170,70,0.9)";
            ctx.shadowBlur = 7;
            ctx.fillStyle = "#ffd9a0";
            ctx.beginPath(); ctx.arc(-3, 2, 1.7, 0, 6.283); ctx.fill();
            ctx.restore();
        }
    }

    function drawSmoke() {
        ctx.save();
        state.smoke.forEach(function (s) {
            var a = s.life * 0.16;
            var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
            g.addColorStop(0, "rgba(232,226,214," + a.toFixed(3) + ")");
            g.addColorStop(1, "rgba(232,226,214,0)");
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
        });
        ctx.restore();
    }

    function drawSparks() {
        ctx.save();
        ctx.shadowColor = "rgba(255,180,80,0.9)";
        ctx.shadowBlur = 5 * view.scale;
        state.sparks.forEach(function (s) {
            ctx.fillStyle = "rgba(255," + Math.round(190 + 60 * s.life) + ",140," + s.life.toFixed(2) + ")";
            ctx.beginPath(); ctx.arc(s.x, s.y, 0.9 * view.scale, 0, 6.283); ctx.fill();
        });
        ctx.restore();
    }

    function drawLabels() {
        ctx.save();
        ctx.font = "700 " + (7 * view.scale).toFixed(1) + "px 'Inter', sans-serif";
        ctx.textAlign = "center";
        state.labels.forEach(function (l) {
            ctx.globalAlpha = clamp(l.life * 1.4, 0, 1);
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillText(l.text, l.x, l.y + 0.6 * view.scale);
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, l.x, l.y);
        });
        ctx.restore();
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /* ---------------- part art ---------------- */

    function partFrame(p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.r) ctx.rotate(p.r * Math.PI / 180);
    }

    function legs(p) {
        // silver leads from the body down to each pad
        ctx.strokeStyle = "#9aa4ab";
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        p.spec.pads.forEach(function (off) {
            ctx.beginPath();
            ctx.moveTo(off[0] * 0.45, off[1] * 0.45);
            ctx.lineTo(off[0], off[1]);
            ctx.stroke();
        });
    }

    function silk(p, text, y) {
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.font = "600 4.6px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(text, 0, y);
    }

    function drawResistor(p) {
        partFrame(p);
        legs(p);
        ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
        roundRect(-13, -6, 26, 12, 5);
        var g = ctx.createLinearGradient(0, -6, 0, 6);
        g.addColorStop(0, "#e2d3ac"); g.addColorStop(1, "#bda87d");
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ["#7a4a20", "#111", "#c0392b", "#d4af37"].forEach(function (c, i) {
            ctx.fillStyle = c;
            ctx.fillRect(-8 + i * 4.6, -6, 2.1, 12);
        });
        silk(p, p.label, -9);
        ctx.restore();
    }

    function drawLed(p) {
        partFrame(p);
        legs(p);
        var lit = p.lit || 0;
        if (lit > 0.02) {
            var bloom = ctx.createRadialGradient(0, -1, 0, 0, -1, 32);
            bloom.addColorStop(0, "rgba(255,255,255," + (0.5 * lit).toFixed(3) + ")");
            bloom.addColorStop(0.25, hexA(p.color, 0.5 * lit));
            bloom.addColorStop(1, hexA(p.color, 0));
            ctx.fillStyle = bloom;
            ctx.beginPath(); ctx.arc(0, -1, 32, 0, 6.283); ctx.fill();
        }
        ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.arc(0, -2, 10.5, Math.PI, 0);
        ctx.lineTo(10.5, 5);
        ctx.lineTo(-10.5, 5);
        ctx.closePath();
        var g = ctx.createRadialGradient(-4, -7, 1, 0, -2, 13);
        g.addColorStop(0, mix("#ffffff", p.color, 1 - 0.55 * (0.3 + lit * 0.7)));
        g.addColorStop(1, mix(p.color, "#20140f", 0.35 - lit * 0.3));
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.ellipse(-4, -6, 2.8, 1.8, -0.5, 0, 6.283); ctx.fill();
        silk(p, p.label, -15);
        ctx.restore();
    }

    function drawCap(p) {
        partFrame(p);
        legs(p);
        ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, 6.283);
        var g = ctx.createLinearGradient(-11, -11, 11, 11);
        g.addColorStop(0, "#4a6fa8"); g.addColorStop(1, "#20365c");
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = "rgba(220,232,255,0.75)";
        ctx.beginPath(); ctx.moveTo(-11, -4); ctx.lineTo(-5, -10); ctx.lineTo(-5, 10); ctx.lineTo(-11, 4); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(2, 3); ctx.moveTo(-1, 0); ctx.lineTo(5, 0); ctx.stroke();
        silk(p, p.label, -14);
        ctx.restore();
    }

    function drawBattery(p) {
        partFrame(p);
        ctx.strokeStyle = "#9aa4ab"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-20, 0); ctx.moveTo(16, 0); ctx.lineTo(20, 0); ctx.stroke();
        ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, 6.283);
        var g = ctx.createLinearGradient(-16, -16, 16, 16);
        g.addColorStop(0, "#e9edf0"); g.addColorStop(0.5, "#b9c1c7"); g.addColorStop(1, "#8e979e");
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, 6.283);
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.fillStyle = "#4c5459";
        ctx.font = "700 6px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("3V", 0, 2.6);
        silk(p, p.label, -19);
        ctx.restore();
    }

    function drawBuzzer(p) {
        partFrame(p);
        legs(p);
        ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, 6.283);
        var g = ctx.createLinearGradient(0, -13, 0, 13);
        g.addColorStop(0, "#3a3f44"); g.addColorStop(1, "#1a1d20");
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, 6.283);
        ctx.fillStyle = "#0a0b0c"; ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "700 5px 'Inter', sans-serif";
        ctx.fillText("+", -7, -5);
        silk(p, p.label, -16);
        ctx.restore();
    }

    function drawButton(p) {
        partFrame(p);
        legs(p);
        ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
        roundRect(-11, -11, 22, 22, 3.5);
        var g = ctx.createLinearGradient(-11, -11, 11, 11);
        g.addColorStop(0, "#dfe4e8"); g.addColorStop(1, "#a7b0b6");
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.beginPath(); ctx.arc(0, 0, 6.4, 0, 6.283);
        ctx.fillStyle = "#2a2e31"; ctx.fill();
        ctx.beginPath(); ctx.arc(-1.4, -1.6, 1.6, 0, 6.283);
        ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fill();
        silk(p, p.label, -15);
        ctx.restore();
    }

    function drawChip(p) {
        partFrame(p);
        ctx.strokeStyle = "#a8b1b7"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
        p.spec.pads.forEach(function (off) {
            ctx.beginPath();
            ctx.moveTo(off[0] * 0.5, off[1]);
            ctx.lineTo(off[0], off[1]);
            ctx.stroke();
        });
        ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
        roundRect(-11, -31, 22, 62, 3);
        var g = ctx.createLinearGradient(-11, -31, 11, 31);
        g.addColorStop(0, "#33383c"); g.addColorStop(0.5, "#212528"); g.addColorStop(1, "#15181a");
        ctx.fillStyle = g; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.beginPath(); ctx.arc(0, -25, 2.4, 0, Math.PI);
        ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.beginPath(); ctx.arc(-8, 25, 1.3, 0, 6.283);
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "600 4.4px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.save();
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(p.label + "  MV-808", 0, 1.6);
        ctx.restore();
        ctx.restore();
    }

    function hexA(h, a) {
        var c = hex2rgb(h);
        return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")";
    }

    /* ---------------- HUD + modals ---------------- */

    function updateHud() {
        var t = tally();
        els.boardName.textContent = state.board.def.name;
        els.progFill.style.width = (t.total ? (t.done / t.total) * 100 : 0) + "%";
        els.boardSub.textContent = t.done + " of " + t.total + " joints";
    }

    function showReport() {
        var t = tally();
        var rough = t.cold + t.blob;
        els.reportTally.innerHTML =
            '<div class="cell perfect"><b>' + t.perfect + '</b><small>Perfect</small></div>' +
            '<div class="cell good"><b>' + t.good + '</b><small>Good</small></div>' +
            '<div class="cell rough"><b>' + rough + '</b><small>Rough</small></div>';

        var ratio = t.total ? t.perfect / t.total : 0;
        els.reportStamp.textContent =
            ratio >= 0.85 ? "Steady hands" :
            ratio >= 0.5  ? "Good bench"   : "It works";
        els.reportTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];

        var last = state.boardIndex >= BOARDS.length - 2;   // last real board
        els.nextBtn.textContent = last ? "Practice bench" : "Next board";
        els.report.hidden = false;
    }

    function renderBoardList() {
        var html = "";
        BOARDS.forEach(function (b, i) {
            var open = isUnlocked(i);
            var done = progress.done[b.id];
            html += '<button class="board-card' + (i === state.boardIndex ? " is-current" : "") + '"' +
                    (open ? "" : " disabled") + ' data-i="' + i + '" type="button">' +
                    '<span class="n">' + (b.endless ? "∞" : (i + 1)) + '</span>' +
                    '<span class="t"><b>' + (open ? b.name : "Locked") + '</b><small>' +
                    (open ? b.sub : "Finish the board before it") + '</small></span>' +
                    (done ? '<span class="done">' + done.perfect + "/" + done.total + '</span>' : "") +
                    '</button>';
        });
        els.boardList.innerHTML = html;
        Array.prototype.forEach.call(els.boardList.querySelectorAll(".board-card"), function (card) {
            card.addEventListener("click", function () {
                var i = parseInt(card.getAttribute("data-i"), 10);
                if (!isUnlocked(i)) return;
                loadBoard(i);
                els.boards.hidden = true;
                els.report.hidden = true;
            });
        });
    }

    /* A blob is the one mistake with a tool behind it, and nothing on
       screen says so. Offer the wick the first time one sets. */
    function offerWick() {
        if (state.wickOffered || lsGet("solder-sanity-wick-offered", 0)) return;
        state.wickOffered = true;
        lsSet("solder-sanity-wick-offered", 1);
        els.coach.innerHTML = "<b>Too much solder?</b> Tap <em>Wick</em>, " +
            "then tap the joint to wipe it back to bare copper. It costs nothing.";
        els.coach.hidden = false;
        var wick = document.querySelector('.tool[data-tool="wick"]');
        if (wick) wick.classList.add("is-new");
    }

    function dismissCoach() {
        if (els.coach.hidden) return;
        els.coach.hidden = true;
        lsSet("solder-sanity-coached", 1);
    }

    /* ---------------- layout ---------------- */

    function resize() {
        var w = bench.clientWidth, h = bench.clientHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.width = w + "px";
        cv.style.height = h + "px";

        var padX = 22, padTop = 78, padBottom = 92;
        var availW = Math.max(60, w - padX * 2);
        var availH = Math.max(60, h - padTop - padBottom);

        // Turn the board only when the screen is clearly taller than wide;
        // laid flat it would leave the pads too small to hit with a thumb.
        view.portrait = availH > availW * 1.2;
        var bw = view.portrait ? BOARD_H : BOARD_W;
        var bh = view.portrait ? BOARD_W : BOARD_H;

        view.scale = Math.min(availW / bw, availH / bh);
        view.ox = (w - bw * view.scale) / 2;
        view.oy = padTop + (availH - bh * view.scale) / 2;
    }

    /* ---------------- loop ---------------- */

    var last = 0;
    function frame(ts) {
        var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
        last = ts;
        update(dt);
        render();
        requestAnimationFrame(frame);
    }

    /* ---------------- init ---------------- */

    function init() {
        bench = document.getElementById("bench");
        cv = document.getElementById("scene");
        ctx = cv.getContext("2d");

        els = {
            boardName: document.getElementById("boardName"),
            boardSub: document.getElementById("boardSub"),
            progFill: document.getElementById("progFill"),
            coach: document.getElementById("coach"),
            report: document.getElementById("report"),
            reportTally: document.getElementById("reportTally"),
            reportStamp: document.getElementById("reportStamp"),
            reportTip: document.getElementById("reportTip"),
            nextBtn: document.getElementById("nextBtn"),
            boards: document.getElementById("boards"),
            boardList: document.getElementById("boardList"),
            muteBtn: document.getElementById("muteBtn")
        };

        reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
        state.muted = !!lsGet("solder-sanity-muted", false);
        els.muteBtn.classList.toggle("is-off", state.muted);
        els.muteBtn.innerHTML = state.muted ? "&#128263;" : "&#128266;";

        loadBoard(clamp(progress.unlocked - 1, 0, BOARDS.length - 2));
        resize();

        window.addEventListener("resize", resize);
        window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

        cv.addEventListener("pointerdown", onDown);
        cv.addEventListener("pointermove", onMove);
        cv.addEventListener("pointerup", lift);
        cv.addEventListener("pointercancel", lift);
        cv.addEventListener("pointerleave", lift);
        document.addEventListener("visibilitychange", function () { if (document.hidden) lift(); });

        Array.prototype.forEach.call(document.querySelectorAll(".tool"), function (btn) {
            btn.addEventListener("click", function () {
                state.tool = btn.getAttribute("data-tool");
                btn.classList.remove("is-new");
                Array.prototype.forEach.call(document.querySelectorAll(".tool"), function (b) {
                    var on = b === btn;
                    b.classList.toggle("is-on", on);
                    b.setAttribute("aria-pressed", on ? "true" : "false");
                });
                audio.unlock(); audio.blip();
            });
        });

        els.muteBtn.addEventListener("click", function () {
            audio.setMuted(!state.muted);
            lsSet("solder-sanity-muted", state.muted);
            els.muteBtn.classList.toggle("is-off", state.muted);
            els.muteBtn.innerHTML = state.muted ? "&#128263;" : "&#128266;";
            if (!state.muted) { audio.unlock(); audio.blip(); }
        });

        document.getElementById("boardsBtn").addEventListener("click", function () {
            renderBoardList();
            els.boards.hidden = false;
        });
        document.getElementById("closeBoards").addEventListener("click", function () { els.boards.hidden = true; });
        document.getElementById("closeReport").addEventListener("click", function () { els.report.hidden = true; });
        document.getElementById("redoBtn").addEventListener("click", function () {
            els.report.hidden = true;
            loadBoard(state.boardIndex);
        });
        els.nextBtn.addEventListener("click", function () {
            els.report.hidden = true;
            var next = state.boardIndex + 1;
            loadBoard(next < BOARDS.length ? next : BOARDS.length - 1);
        });

        [els.report, els.boards].forEach(function (m) {
            m.addEventListener("click", function (e) { if (e.target === m) m.hidden = true; });
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") { els.report.hidden = true; els.boards.hidden = true; }
        });

        if (!lsGet("solder-sanity-coached", 0)) els.coach.hidden = false;

        window.__solder = {
            state: state, BOARDS: BOARDS, load: loadBoard, tally: tally, view: view,
            /* Drive the sim by hand. The preview pane pauses rAF, so
               tests step time explicitly instead of waiting on frames. */
            tick: function (dt, times) {
                for (var i = 0; i < (times || 1); i++) { update(dt || 0.016); render(); }
            },
            /* screen position of a joint, for driving the canvas in tests */
            screenOf: function (i) {
                var j = state.board.joints[i], r = cv.getBoundingClientRect(), p = toScreen(j.x, j.y);
                return { x: r.left + p.x, y: r.top + p.y };
            },
            fillAll: function (f) {
                state.board.joints.forEach(function (j) { j.fill = f === undefined ? 0.6 : f; j.grade = gradeFill(j.fill); });
                updateHud(); checkComplete();
            }
        };

        requestAnimationFrame(frame);
    }

    /* Boot from the bottom of the file on purpose: everything above
       is declared by the time this runs, so init() can reach any of
       it without tripping a temporal dead zone. */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { boot(); });
    } else {
        boot();
    }

    function boot() {
        try { init(); } catch (err) {
            console.error("[Solder Sanity] startup failed:", err);
            throw err;
        }
    }
})();
