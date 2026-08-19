/* groodle â€” scribble inside the silhouette, watch it come alive */
(function () {
    'use strict';

    /* ============ CONFIG ============ */

    const STAGE_W = 400;
    const STAGE_H = 600;

    const COLORS = [
        '#000000', '#e63946', '#f4a261', '#fcbf49',
        '#43aa8b', '#1d3557', '#7209b7', '#ff6ec7',
        '#6f4e37', '#ffffff'
    ];
    const SIZES = [4, 12, 22];

    /* Poses drive the silhouette. Humanoid poses carry a `skeleton`
       (a handful of joint coordinates) that groodleBodyPath() turns
       into ONE smooth closed outline — no primitive union, so there
       are no concave hip/shoulder seams: the figure reads as a single
       intentional gingerbread-person shape. Non-humanoid poses
       (ghost, animal) carry a hand-authored `path` d-string instead.

       posePathD(pose) resolves either form to a single SVG path
       string in the logical 400x600 space; the canvas clip
       (buildBodyPath) and the three SVG groups (clipPath / fill /
       outline) both consume that one string, so the visible body and
       the paintable area can never drift apart.

       Adding a humanoid pose = one skeleton entry. The dance is a
       transform on the .creature wrapper and is independent of how
       the body is built (rigid-body only; true limb articulation is
       a post-launch v2 — see PLAY_STORE_PLAN.md). */

    const SK = {
        /* Shared body proportions so every humanoid pose stays on-model.
           hw = half-width at that joint line; armW/legW = limb radius. */
        head:  { x: 200, y: 92, r: 58 },
        shoulderY: 188, shoulderHW: 56,
        hipY: 392, hipHW: 44,
        armW: 22, legW: 24
    };

    function hum(handL, handR, footL, footR, extra) {
        /* Build a humanoid skeleton from just the 4 limb tips; the
           torso/head proportions come from SK so poses stay consistent. */
        const s = {
            head: SK.head,
            shoulderY: SK.shoulderY, shoulderHW: SK.shoulderHW,
            hipY: SK.hipY, hipHW: SK.hipHW,
            armW: SK.armW, legW: SK.legW,
            handL: handL, handR: handR, footL: footL, footR: footR
        };
        if (extra) for (const k in extra) s[k] = extra[k];
        return s;
    }

    const POSES = {
        /* Standing IS Onion's original full-figure drawing -- tools/
           fit_standing.py matches the assembled doll to it at IoU 0.977.
           Do not nudge it off {}.

           The other five stay inside the FREE angle budget: up to ~18 deg
           costs nothing because the frame already has room, while bigger
           static poses shrink the whole doll and the colorable area with
           it (a flat T-pose costs 41% of the coloring surface). The dance
           is what provides real motion -- see tools/README.md. */
        standing: { id: 'standing', name: 'Standing', icon: '\uD83E\uDDCD', origin: '50% 95%',
            rig: {} },
        cheer: { id: 'cheer', name: 'Cheering', icon: '\uD83D\uDE4C', origin: '50% 95%',
            rig: { armL: 18, armR: 18, legL: 4, legR: 4 } },
        star: { id: 'star', name: 'Star', icon: '\u2B50', origin: '50% 95%',
            rig: { armL: 18, armR: 18, legL: 9, legR: 9 } },
        groovy: { id: 'groovy', name: 'Groovy', icon: '\uD83D\uDC83', origin: '50% 95%',
            rig: { armL: 16, armR: -11, legL: -5, legR: 8 } },
        tpose: { id: 'tpose', name: 'T-Pose', icon: '\u270B', origin: '50% 95%',
            rig: { armL: 18, armR: 18 } },
        wave: { id: 'wave', name: 'Waving', icon: '\uD83D\uDC4B', origin: '50% 95%',
            rig: { armR: 18, armL: -6 } },
        ghost: { name: 'Ghost', icon: '👻', origin: '50% 88%',
            /* Bell-shaped body with a 3-bump wavy hem + two stubby
               drifting arms. One closed path, hand-authored. */
            path: 'M 200 38 C 132 38 110 96 110 168 L 110 470 ' +
                  'C 110 470 96 452 78 460 C 70 388 70 320 78 268 ' +
                  'C 60 286 60 360 64 470 ' +
                  'L 64 506 C 64 506 96 486 116 506 ' +
                  'C 140 530 162 530 186 506 C 200 492 200 492 214 506 ' +
                  'C 238 530 260 530 284 506 C 304 486 336 506 336 506 ' +
                  'L 336 470 C 340 360 340 286 322 268 ' +
                  'C 330 320 330 388 322 460 C 304 452 290 470 290 470 ' +
                  'L 290 168 C 290 96 268 38 200 38 Z' },
        animal: { name: 'Animal', icon: '🐾', origin: '50% 92%',
            /* Horizontal critter: round head left, loaf body, perky
               tail, 4 stubby legs. One closed path, hand-authored. */
            path: 'M 96 250 C 70 250 60 282 66 306 ' +
                  'C 50 318 48 348 64 360 C 58 392 70 430 92 430 ' +
                  'L 108 430 C 122 430 128 408 128 392 ' +
                  'C 150 398 176 398 196 392 L 196 432 ' +
                  'C 196 446 220 446 220 432 L 220 386 ' +
                  'C 250 392 286 392 312 380 L 312 430 ' +
                  'C 312 444 336 444 336 430 L 336 366 ' +
                  'C 356 356 372 332 372 300 ' +
                  'C 392 290 398 268 392 256 C 404 240 396 214 380 212 ' +
                  'C 360 184 300 176 250 192 ' +
                  'C 210 178 150 196 122 226 ' +
                  'C 110 232 102 240 96 250 Z' }
    };

    function getCurrentPose() {
        return POSES[(state && state.pose) || 'standing'] || POSES.standing;
    }

    /* ---- Single-path body generator ----

       The body is a COMPOUND path: a head circle + a fat torso
       capsule + four limb capsules, concatenated into one `d` string.
       Each sub-part is wound the same way, so nonzero-fill unions them
       into one solid shape — overlapping parts have no internal seam
       (the limb capsule roots sit UP INSIDE the torso, so there's no
       hip/shoulder notch) and the space between the legs is simply
       outside every sub-part, so two distinct legs always read. This
       is robust where a single Catmull-Rom perimeter was not: a spline
       can't carve the concave crotch without overshooting and fusing
       the legs. The SVG outline filter rasterises the union's alpha
       into one ring, so the compound path still outlines as one body. */

    /* A circle as four cubic béziers (kappa method). Zero arc-flag
       ambiguity and no diameter-degeneracy — deterministic in every
       renderer, which hand-rolled SVG `A` arcs were not. */
    const KAPPA = 0.5522847498307936;
    function circleBezier(cx, cy, r) {
        const k = r * KAPPA, f = (n) => n.toFixed(2);
        return 'M ' + f(cx + r) + ' ' + f(cy) +
               ' C ' + f(cx + r) + ' ' + f(cy + k) + ' ' + f(cx + k) + ' ' + f(cy + r) + ' ' + f(cx) + ' ' + f(cy + r) +
               ' C ' + f(cx - k) + ' ' + f(cy + r) + ' ' + f(cx - r) + ' ' + f(cy + k) + ' ' + f(cx - r) + ' ' + f(cy) +
               ' C ' + f(cx - r) + ' ' + f(cy - k) + ' ' + f(cx - k) + ' ' + f(cy - r) + ' ' + f(cx) + ' ' + f(cy - r) +
               ' C ' + f(cx + k) + ' ' + f(cy - r) + ' ' + f(cx + r) + ' ' + f(cy - k) + ' ' + f(cx + r) + ' ' + f(cy) +
               ' Z';
    }

    /* A circular arc as a chain of ≤90° cubic béziers, from angle a0 to
       a1 (radians, signed — negative sweeps go the other way). No SVG
       `A` command, so it parses identically in Path2D and every SVG
       renderer. Caller has already emitted the path point at a0. */
    function arcBezier(cx, cy, r, a0, a1) {
        const f = (n) => n.toFixed(2);
        const total = a1 - a0;
        const n = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
        const step = total / n;
        const h = r * (4 / 3) * Math.tan(step / 4);   // signed handle length
        let out = '';
        for (let i = 0; i < n; i++) {
            const aA = a0 + step * i, aB = a0 + step * (i + 1);
            const x0 = cx + r * Math.cos(aA), y0 = cy + r * Math.sin(aA);
            const x1 = cx + r * Math.cos(aB), y1 = cy + r * Math.sin(aB);
            const c1x = x0 - h * Math.sin(aA), c1y = y0 + h * Math.cos(aA);
            const c2x = x1 + h * Math.sin(aB), c2y = y1 - h * Math.cos(aB);
            out += 'C ' + f(c1x) + ' ' + f(c1y) + ' ' + f(c2x) + ' ' + f(c2y) +
                   ' ' + f(x1) + ' ' + f(y1) + ' ';
        }
        return out;
    }

    /* Pick the end angle so the DIRECTED sweep s→e' (e' = e ± 2π)
       actually passes through angle m — the direction the rounded cap
       must bulge. Of the two arcs from s to e (the forward/CCW one and
       the backward/CW one), return whichever contains m. Robust for
       every axis orientation (the old version only tested one side and
       silently inverted caps on vertical capsules). */
    function sweepThrough(s, e, m) {
        const TAU = 2 * Math.PI;
        const norm = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
        const fwd = norm(e - s);            // forward sweep amount [0,2π)
        const mOff = norm(m - s);           // where m sits from s, forward
        return (mOff <= fwd) ? (s + fwd) : (s + fwd - TAU);
    }

    /* A smooth tapered CAPSULE: the exact convex hull of a circle of
       radius `ra` at A and `rb` at B — two straight outer-tangent
       lines + a rounded cap arc at each end. Unlike the old circle-
       chain "blob" this has a perfectly clean edge (no scallops) and
       genuine rounded hand/foot tips. Wound clockwise to match
       circleBezier so a nonzero-fill union of these pieces is one
       seamless solid (overlaps melt; gaps — e.g. between the legs —
       stay open). */
    function capsule(ax, ay, bx, by, ra, rb) {
        if (rb == null) rb = ra;
        const dx = bx - ax, dy = by - ay;
        const d = Math.hypot(dx, dy) || 1e-6;
        const ux = dx / d, uy = dy / d;            // axis A→B
        let mu = (rb - ra) / d;
        if (mu > 0.999) mu = 0.999; else if (mu < -0.999) mu = -0.999;
        const mp = Math.sqrt(1 - mu * mu);
        const nx = -uy, ny = ux;                   // unit normal (left of axis)
        // outward normals to the two tangent lines (sides R and L)
        const gRx = mu * ux - mp * nx, gRy = mu * uy - mp * ny;
        const gLx = mu * ux + mp * nx, gLy = mu * uy + mp * ny;
        const f = (n) => n.toFixed(2);
        // tangent contact points
        const ARx = ax + ra * gRx, ARy = ay + ra * gRy;
        const BRx = bx + rb * gRx, BRy = by + rb * gRy;
        const BLx = bx + rb * gLx, BLy = by + rb * gLy;
        const ALx = ax + ra * gLx, ALy = ay + ra * gLy;
        const aR = Math.atan2(gRy, gRx), aL = Math.atan2(gLy, gLx);
        const tip = Math.atan2(uy, ux);            // B-cap bulges this way
        const root = tip + Math.PI;                // A-cap bulges this way
        return 'M ' + f(ARx) + ' ' + f(ARy) + ' ' +
               'L ' + f(BRx) + ' ' + f(BRy) + ' ' +
               arcBezier(bx, by, rb, aR, sweepThrough(aR, aL, tip)) +
               'L ' + f(ALx) + ' ' + f(ALy) + ' ' +
               arcBezier(ax, ay, ra, aL, sweepThrough(aL, aR, root)) +
               'Z ';
    }

    function groodleBodyPath(sk) {
        const h = sk.head, cx = h.x;
        const shY = sk.shoulderY, shHW = sk.shoulderHW;
        const hipY = sk.hipY, hipHW = sk.hipHW;
        const aw = sk.armW, lw = sk.legW;

        /* Head — one circle. */
        const head = circleBezier(h.x, h.y, h.r);

        /* Neck — a short capsule bridging the chin to the shoulder line
           so the head reads as attached, not a ball balanced on a tube.
           Roots up inside the head and down inside the torso. */
        const neck = capsule(h.x, h.y + h.r * 0.52, cx, shY + 6,
                             h.r * 0.46, shHW * 0.60);

        /* Torso — two stacked capsules through a slightly pinched waist
           so the body has a shape (rounded shoulders → waist → rounded
           hips) instead of being a straight tube. */
        const waistY = (shY + hipY) / 2;
        const waistHW = Math.min(shHW, hipHW) * 0.86;
        const torsoTop = capsule(cx, shY - 4, cx, waistY, shHW * 0.96, waistHW);
        const torsoBot = capsule(cx, waistY, cx, hipY + 4, waistHW, hipHW * 1.02);

        /* Arms root inside the torso so the shoulder is a seamless
           blend, then taper to a rounded hand. */
        const armR = capsule(cx + shHW * 0.40, shY + 10, sk.handR.x, sk.handR.y, aw * 1.14, aw * 0.80);
        const armL = capsule(cx - shHW * 0.40, shY + 10, sk.handL.x, sk.handL.y, aw * 1.14, aw * 0.80);

        /* Legs root up inside the torso (above the hip line, no hip
           seam); they spread to the feet so below the torso the two
           capsules separate into distinct legs with real daylight
           between them. */
        const legR = capsule(cx + hipHW * 0.38, hipY - 28, sk.footR.x, sk.footR.y, lw * 1.12, lw * 0.92);
        const legL = capsule(cx - hipHW * 0.38, hipY - 28, sk.footL.x, sk.footL.y, lw * 1.12, lw * 0.92);

        return head + ' ' + neck + torsoTop + torsoBot + armR + armL + legR + legL;
    }

    const RIG = {"parts":{"torso":{"solid":[[2.1,0.0,-7.3,0.2,-15.2,1.4,-21.1,3.0,-26.0,4.6,-33.8,8.5,-40.8,13.2,-44.1,16.1,-47.8,19.9,-52.2,25.8,-55.6,32.5,-57.1,37.2,-58.3,43.4,-58.3,52.5,-57.7,56.5,-56.6,60.7,-53.8,67.5,-48.1,76.3,-44.1,84.3,-41.4,89.1,-36.9,94.6,-31.0,99.8,-30.1,105.9,-30.1,116.6,-31.1,118.5,-34.1,120.9,-41.7,125.2,-54.4,131.4,-58.1,134.7,-61.9,140.7,-64.6,148.3,-66.4,155.5,-67.1,160.7,-67.3,164.9,-67.1,172.5,-66.0,180.2,-65.4,181.6,-64.7,185.0,-63.2,189.1,-62.9,190.4,-63.1,194.0,-62.6,198.4,-61.6,200.2,-59.8,209.0,-57.2,218.8,-55.7,228.1,-55.1,235.3,-55.1,244.4,-56.0,254.7,-55.3,258.6,-55.0,259.5,-54.2,259.7,-52.9,266.5,-49.8,275.9,-47.1,281.7,-43.5,287.4,-41.3,290.2,-37.1,296.6,-27.8,307.9,-22.2,312.9,-17.6,316.1,-13.5,317.5,-9.6,317.7,-7.6,318.2,-0.8,318.0,3.3,316.6,5.1,315.6,8.3,313.3,10.7,311.2,16.0,305.7,18.8,302.4,28.6,287.4,34.5,277.5,38.6,268.7,41.0,262.4,42.9,255.5,42.8,253.2,42.2,251.2,41.6,240.0,42.2,228.5,43.9,218.4,46.5,208.4,48.2,199.7,48.9,197.7,49.0,195.9,49.6,193.7,49.5,190.4,49.8,188.6,51.4,184.5,52.9,177.3,53.5,173.0,53.7,168.4,53.4,159.9,53.1,157.4,50.0,146.3,48.7,143.7,46.5,138.4,43.8,134.0,42.0,132.0,40.3,130.9,34.0,128.0,24.2,123.0,20.7,120.9,17.3,118.3,16.7,117.4,16.6,109.0,17.0,108.4,24.8,105.5,29.6,102.8,33.9,99.6,37.8,95.6,40.0,92.9,44.2,85.9,45.9,82.5,49.2,74.3,54.7,64.1,55.7,61.6,56.9,56.9,57.6,49.9,57.5,43.8,56.9,39.4,55.2,33.7,53.5,29.7,50.8,24.9,48.2,21.2,45.4,18.1,41.4,14.3,38.1,11.7,32.8,8.3,25.2,4.6,20.4,3.0,14.4,1.4,6.8,0.2],[-25.8,285.0,-26.1,280.3,-27.0,275.9,-28.6,271.9,-30.6,268.6,-33.1,266.1,-35.9,264.5,-38.8,264.0,-41.6,264.5,-44.4,266.1,-46.9,268.6,-48.9,271.9,-50.5,275.9,-51.4,280.3,-51.8,285.0,-51.4,289.7,-50.5,294.1,-48.9,298.1,-46.9,301.4,-44.4,303.9,-41.6,305.5,-38.8,306.0,-35.9,305.5,-33.1,303.9,-30.6,301.4,-28.6,298.1,-27.0,294.1,-26.1,289.7],[38.2,285.0,37.9,280.3,37.0,275.9,35.4,271.9,33.4,268.6,30.9,266.1,28.1,264.5,25.2,264.0,22.4,264.5,19.6,266.1,17.1,268.6,15.1,271.9,13.5,275.9,12.6,280.3,12.2,285.0,12.6,289.7,13.5,294.1,15.1,298.1,17.1,301.4,19.6,303.9,22.4,305.5,25.2,306.0,28.1,305.5,30.9,303.9,33.4,301.4,35.4,298.1,37.0,294.1,37.9,289.7]],"ink":[[38.3,139.5,12.1,141.7,5.5,143.9,2.1,146.8,9.9,143.7,16.6,142.7,26.9,142.1],[-51.7,139.6,-41.0,142.0,-23.3,143.7,-15.5,146.8,-18.9,143.9,-25.7,141.7],[13.8,71.2,12.6,70.4,7.4,73.6,2.9,74.6,-3.3,73.6,-8.4,70.5,-9.7,70.9,-9.8,71.8,-4.2,75.5,2.7,76.7,9.5,75.0,12.8,72.9],[24.8,48.8,27.3,49.1,29.0,50.0,30.8,51.9,31.6,54.3,30.8,58.8,28.6,61.0,25.9,61.9,23.5,61.7,21.4,60.5,19.5,58.1,18.9,56.2,18.9,54.3,20.4,51.1,22.0,49.7],[-22.1,48.8,-19.4,49.1,-17.3,50.3,-15.4,52.9,-14.9,54.7,-15.3,57.4,-16.5,59.5,-19.1,61.6,-20.9,61.9,-23.0,61.7,-25.1,60.6,-26.9,58.7,-27.8,56.0,-27.5,53.0,-26.3,51.0,-24.5,49.5],[24.4,46.7,21.1,47.6,18.0,50.5,16.9,53.1,16.7,56.9,18.0,60.0,20.4,62.5,22.9,63.7,26.1,64.1,29.5,63.0,32.3,60.4,33.5,58.0,33.9,54.2,32.8,51.1,30.5,48.4,28.2,47.0],[-22.0,46.6,-25.5,47.6,-27.8,49.5,-29.4,52.0,-30.0,56.0,-28.8,59.8,-26.9,62.0,-24.2,63.6,-20.9,64.1,-17.2,63.0,-14.7,60.9,-13.3,58.2,-12.8,54.2,-13.9,51.0,-15.9,48.6,-18.3,47.2],[-0.1,21.2,4.6,21.3,7.1,22.5,9.6,24.9,11.3,28.2,11.5,31.4,10.7,34.8,8.4,37.8,4.8,39.9,1.3,40.3,-2.4,39.2,-5.2,36.9,-7.3,33.2,-7.7,29.7,-6.1,25.4,-3.6,22.9],[1.8,18.9,-2.8,19.9,-7.2,23.2,-9.2,26.9,-9.8,30.8,-8.8,35.4,-5.5,39.7,-1.6,41.8,2.7,42.4,7.0,41.3,10.1,39.2,12.7,35.5,13.8,30.4,12.8,26.1,9.3,21.6,5.1,19.3],[-16.6,3.9,-6.3,2.3,5.9,2.3,16.0,3.9,25.5,7.1,33.2,11.1,41.6,17.4,48.3,25.0,53.2,34.5,55.3,43.5,55.4,50.9,54.7,56.7,52.1,64.7,46.7,74.7,41.7,86.0,37.5,92.5,32.9,97.5,25.2,102.9,19.0,105.6,8.9,107.9,-5.5,107.9,-15.1,105.6,-25.5,100.8,-34.2,94.2,-38.8,89.1,-46.5,74.7,-51.9,66.5,-54.0,61.7,-56.2,52.0,-56.2,43.8,-54.0,34.7,-49.6,25.8,-42.5,17.5,-34.7,11.6,-27.7,7.7],[38.5,14.1,27.1,7.3,15.9,3.5,4.8,1.8,-8.5,2.0,-20.5,4.5,-30.3,8.5,-39.8,14.5,-48.3,23.1,-52.9,30.7,-56.0,39.8,-56.7,47.8,-56.0,56.3,-52.9,65.5,-46.5,75.7,-41.0,86.5,-36.5,92.5,-29.5,99.2,-28.4,105.9,-28.4,116.6,-29.8,119.5,-33.5,122.4,-52.9,132.4,-55.7,134.6,-36.1,124.6,-31.1,121.4,-30.4,121.7,-31.1,127.0,-30.8,128.3,-29.1,124.0,-28.0,117.7,-28.2,101.7,-19.7,106.1,-9.6,109.3,4.7,110.4,14.1,109.1,14.6,109.7,15.2,122.0,17.4,128.6,17.0,121.2,42.1,134.6,39.8,132.6,20.1,122.4,15.8,119.0,14.9,116.5,14.9,109.0,15.4,107.7,24.2,104.0,30.3,100.3,36.0,95.2,39.8,90.2,52.6,64.8,55.2,56.8,55.9,49.9,55.7,42.4,53.2,33.0,51.0,28.5,46.9,22.2]]},"arm":{"solid":[[18.2,-13.2,10.2,-10.2,1.7,-7.8,-5.0,-4.6,-8.3,-2.3,-12.6,1.4,-15.8,5.2,-18.4,9.2,-20.7,13.7,-23.0,20.1,-24.0,24.4,-25.1,31.0,-25.8,40.5,-29.5,49.8,-32.4,59.2,-32.7,59.7,-34.9,67.3,-38.2,81.7,-46.9,99.2,-48.6,103.4,-50.2,108.6,-52.4,119.6,-54.7,140.8,-56.4,153.6,-56.7,154.7,-57.4,161.8,-59.6,172.6,-61.6,180.6,-63.3,189.6,-63.6,197.4,-63.3,202.6,-62.2,207.5,-61.1,210.4,-59.5,213.1,-52.4,222.9,-50.8,224.8,-48.4,226.4,-46.6,226.6,-45.0,226.3,-43.2,224.7,-41.3,224.6,-40.0,224.0,-38.5,222.2,-38.0,220.2,-38.0,217.9,-38.5,215.6,-41.1,209.1,-41.7,206.0,-41.6,201.2,-41.1,197.3,-39.9,194.0,-39.5,193.7,-38.8,193.9,-36.7,201.1,-35.5,203.3,-33.3,205.6,-31.4,206.6,-28.8,206.6,-27.6,206.1,-26.9,205.4,-25.8,203.5,-25.9,199.3,-28.1,191.5,-28.2,184.6,-28.7,181.5,-29.8,178.5,-31.4,175.4,-36.0,168.9,-36.1,166.4,-35.6,163.7,-33.5,156.9,-30.8,150.4,-26.9,142.1,-21.1,131.5,-17.8,124.7,-15.7,119.2,-13.4,110.6,-12.3,103.3,-12.2,99.8,-11.0,95.7,-1.4,80.0,5.1,67.9,7.8,61.6,11.2,52.2,11.5,49.0,12.2,46.8,12.3,45.5,9.6,38.9,8.2,33.6,7.1,25.6,7.1,16.6,8.2,9.5,9.8,3.4,11.9,-2.5,13.7,-5.8,16.6,-10.1]],"ink":[[-52.3,194.6,-52.8,194.9,-52.4,205.0,-51.4,211.6,-48.0,219.2,-45.4,223.4,-43.2,222.2,-46.0,218.9,-49.8,210.3,-51.0,199.5],[-58.4,194.6,-58.9,201.0,-58.0,210.6,-52.9,217.9,-55.9,210.4,-57.6,196.5],[-41.3,188.2,-40.5,190.7,-41.5,192.1,-39.5,191.2,-37.3,192.0,-39.5,188.9]]},"leg":{"solid":[[-0.9,-15.2,-6.1,12.3,-7.8,19.1,-10.8,28.7,-14.1,40.6,-14.7,44.1,-16.2,50.1,-16.3,51.9,-16.8,53.3,-18.3,62.1,-20.0,75.7,-20.5,82.2,-20.6,98.9,-20.0,107.2,-20.1,113.3,-21.6,121.9,-25.3,134.2,-26.9,141.2,-29.0,154.2,-29.6,162.6,-29.7,194.4,-30.8,206.9,-31.9,212.1,-33.0,215.3,-35.2,218.8,-44.9,229.1,-49.3,233.2,-56.1,238.6,-59.6,240.7,-65.0,243.1,-67.4,244.6,-68.8,246.3,-69.5,247.8,-69.5,251.0,-68.9,252.3,-63.4,256.3,-61.7,256.4,-58.4,258.4,-54.6,258.5,-51.5,260.0,-47.0,259.8,-44.9,261.0,-42.3,261.7,-39.0,261.7,-36.7,261.1,-32.0,258.5,-28.6,257.8,-25.7,256.8,-22.8,255.1,-19.4,252.0,-17.6,251.0,-8.3,248.7,-5.9,247.6,-3.6,246.0,-2.6,245.0,-1.4,243.1,-0.8,241.1,-0.6,237.6,-0.9,233.7,-2.4,227.2,-2.8,223.5,-2.9,216.3,-2.4,210.1,-1.3,204.8,0.2,199.6,2.4,194.1,13.1,170.7,15.8,162.8,17.4,155.6,18.3,147.6,18.5,130.6,19.2,124.3,20.7,119.5,24.9,110.6,27.6,104.0,33.5,87.4,40.0,65.3,44.2,47.7,43.7,47.1,42.1,47.0,38.6,45.8,36.4,44.6,32.6,41.8,24.3,34.3,18.1,26.6,14.0,20.4,12.3,18.4,8.9,13.0,6.6,8.3,3.2,-1.7,1.1,-11.6]],"ink":[[-38.1,246.9,-45.0,250.1,-47.4,252.1,-48.4,255.0,-48.1,257.2,-45.5,257.6,-46.2,255.0,-45.4,252.7,-39.2,248.7],[-46.7,245.8,-52.0,249.0,-54.4,251.2,-55.5,253.1,-55.7,255.8,-53.4,256.1,-53.6,253.9,-52.9,252.1,-47.0,247.0],[-15.9,245.7,-17.2,246.3,-20.2,249.4,-17.5,248.1],[-53.0,245.3,-53.9,245.3,-59.6,249.1,-61.3,251.7,-61.6,253.8,-59.7,254.4,-58.8,250.9,-54.8,247.7],[-58.3,244.9,-60.2,245.2,-64.0,247.3,-65.1,248.5,-66.1,251.1,-64.2,252.1,-62.7,248.5,-58.9,245.9],[-5.5,222.0,-6.1,225.6,-9.2,231.9,-5.1,227.2],[-6.5,211.8,-6.6,215.8,-5.6,221.3,-5.4,214.6],[-18.1,117.5,-20.0,125.7,-17.0,134.9,-18.1,125.7]]}},"anchor":{"armL":[136.1,177.8],"armR":[263.9,177.8],"legL":[152.1,305.7],"legR":[247.9,305.7]},"torsoAt":[206.8,34.8],"rest":{"armL":0.8,"armR":-0.8,"legL":0.2,"legR":-0.2},"sign":{"armL":1,"armR":-1,"legL":1,"legR":-1},"mirror":["armR","legR"],"srcOf":{"armL":"arm","armR":"arm","legL":"leg","legR":"leg"},"poses":{"standing":{},"star":{"armL":18,"armR":18,"legL":9,"legR":9},"cheer":{"armL":18,"armR":18,"legL":4,"legR":4},"groovy":{"armL":16,"armR":-11,"legL":-5,"legR":8},"tpose":{"armL":18,"armR":18},"wave":{"armR":18,"armL":-6}}};


    /* ---- Dance articulation --------------------------------------------
       The creature used to bounce as one rigid block. Now each pinned limb
       swings on the beat, paper-doll style.

       Two things have to move together or it falls apart: the SILHOUETTE
       (SVG <g> per part, rotated by transform) and the kid's PAINT (one
       bitmap in rest-pose space). The paint is re-composited each frame by
       drawing that same bitmap once per part, through the part's rotation
       and clipped to the part -- so color rides its own arm instead of
       sliding off it.

       DANCE_SWING is capped at what the frame can hold without shrinking
       the doll; tools/trace_rig.py folds the same number into its scale
       solve, so the two must be changed together. */
    const DANCE_SWING = 18;
    let rigGroupEls = null;      // every .rig-part <g>, across all 3 layers
    let rigClip = null;          // Path2D per part, rest-pose space
    let danceCanvas = null, danceCtx = null;

    function cacheRigEls() {
        rigGroupEls = Array.prototype.slice.call(
            document.querySelectorAll('.creature .rig-part'));
        rigClip = {};
        const pose = getCurrentPose();
        if (!pose.rig) return;
        const parts = rigPartsD(pose, 'solid');
        for (let i = 0; i < parts.length; i++) {
            rigClip[parts[i].key] = { path: new Path2D(parts[i].d), pivot: parts[i].pivot };
        }
    }

    /* Per-limb angle for this instant of the groove. Legs counter the arms
       so he reads as shifting weight rather than flapping. */
    function limbAngles(phase, move) {
        const sw = DANCE_SWING * (move === 'BOUNCE' ? 0.55
                                : move === 'TWIST' ? 0.8 : 1);
        const a = Math.sin(phase * Math.PI * 2);
        /* The torso deliberately does NOT rotate. Limb pivots are absolute
           points in the frame, not children of the torso, so swaying the
           torso would slide it out from under its own shoulders and hips.
           Whole-body motion is applyMove's job (it transforms .creature);
           this function only ever moves limbs. */
        return {
            armL: sw * a,
            armR: sw * (move === 'TWIST' ? -a : a),
            legL: sw * 0.45 * -a,
            legR: sw * 0.45 * (move === 'TWIST' ? a : -a)
        };
    }

    let _lastLimbAngles = null;

    function applyLimbAngles(ang) {
        _lastLimbAngles = ang;
        if (!rigGroupEls) return;
        for (let i = 0; i < rigGroupEls.length; i++) {
            const el = rigGroupEls[i], k = el.getAttribute('data-part');
            const c = rigClip[k];
            if (!c) continue;
            const a = ang ? (ang[k] || 0) : 0;
            if (a) el.setAttribute('transform',
                'rotate(' + a.toFixed(2) + ' ' + c.pivot[0] + ' ' + c.pivot[1] + ')');
            else el.removeAttribute('transform');
        }
        paintDanceCanvas(ang);
    }

    /* Re-composite the kid's artwork under the current limb angles. One
       clipped drawImage per part; the source is always the untouched paint
       bitmap, so this never accumulates error. */
    function paintDanceCanvas(ang) {
        if (!danceCtx || !canvas) return;
        const dpr = danceCanvas.width / STAGE_W;
        danceCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        danceCtx.clearRect(0, 0, STAGE_W, STAGE_H);
        if (!ang) return;
        for (const k in rigClip) {
            const c = rigClip[k], a = ang[k] || 0;
            danceCtx.save();
            if (a) {
                danceCtx.translate(c.pivot[0], c.pivot[1]);
                danceCtx.rotate(a * Math.PI / 180);
                danceCtx.translate(-c.pivot[0], -c.pivot[1]);
            }
            danceCtx.clip(c.path);
            danceCtx.drawImage(canvas, 0, 0, STAGE_W, STAGE_H);
            danceCtx.restore();
        }
    }

    /* Pointer -> rest-pose coords while a limb is rotated: find the part
       under the finger (topmost first) and undo just that part's rotation,
       so painting on a swinging arm still lands where the kid aimed. */
    function unposePoint(x, y, ang) {
        if (!ang || !rigClip || !danceCtx) return { x: x, y: y };
        const keys = Object.keys(rigClip).reverse();
        for (let i = 0; i < keys.length; i++) {
            const c = rigClip[keys[i]], a = (ang[keys[i]] || 0) * Math.PI / 180;
            const co = Math.cos(-a), si = Math.sin(-a);
            const dx = x - c.pivot[0], dy = y - c.pivot[1];
            const rx = c.pivot[0] + dx * co - dy * si;
            const ry = c.pivot[1] + dx * si + dy * co;
            if (danceCtx.isPointInPath(c.path, rx, ry)) return { x: rx, y: ry };
        }
        return { x: x, y: y };
    }

    /* ---- Paper-doll rig ------------------------------------------------
       Groodle's body is five hand-drawn parts -- torso+head, two arms, two
       legs -- pinned at the joints like a brass-fastener paper doll. A pose
       is just four joint angles; rigPathD() rotates each part about its pin
       and concatenates the results into ONE nonzero-fill path, so overlaps
       at the joints melt into a single silhouette and every downstream
       consumer (canvas clip, silhouette fill/outline, pattern window, PNG
       export) still receives a single `d` string and needs no change.

       Parts are stored ONCE as point rings rather than baked per pose: six
       baked poses would be ~285KB of path data, this is ~10KB, and it is
       the same machinery live limb animation would drive. */
    const RIG_LIMBS = ['legL', 'legR', 'armL', 'armR'];
    const _rigCache = {};

    function rigRingsD(rings, a, deg, mir) {
        const t = deg * Math.PI / 180, co = Math.cos(t), si = Math.sin(t);
        let d = '';
        for (let r = 0; r < rings.length; r++) {
            const f = rings[r], n = f.length / 2;
            if (n < 3) continue;
            const px = new Array(n), py = new Array(n);
            for (let i = 0; i < n; i++) {
                const x = mir ? -f[i * 2] : f[i * 2], y = f[i * 2 + 1];
                px[i] = a[0] + x * co - y * si;
                py[i] = a[1] + x * si + y * co;
            }
            d += 'M' + px[0].toFixed(1) + ' ' + py[0].toFixed(1);
            for (let i = 0; i < n; i++) {
                const i0 = (i + n - 1) % n, i2 = (i + 1) % n, i3 = (i + 2) % n;
                d += 'C' + (px[i] + (px[i2] - px[i0]) / 6).toFixed(1) + ' '
                   + (py[i] + (py[i2] - py[i0]) / 6).toFixed(1) + ' '
                   + (px[i2] - (px[i3] - px[i]) / 6).toFixed(1) + ' '
                   + (py[i2] - (py[i3] - py[i]) / 6).toFixed(1) + ' '
                   + px[i2].toFixed(1) + ' ' + py[i2].toFixed(1);
            }
            d += 'Z';
        }
        return d;
    }

    /* One entry per part, in paint order (limbs first, torso on top). Each
       carries the pivot it rotates about, which is what the dance drives. */
    function rigPartsD(pose, which) {
        const key = (pose.id || '') + '|' + which;
        if (_rigCache[key]) return _rigCache[key];
        const ang = pose.rig || {};
        const out = [];
        for (let i = 0; i < RIG_LIMBS.length; i++) {
            const k = RIG_LIMBS[i], a = RIG.anchor[k];
            out.push({ key: k, pivot: a,
                       d: rigRingsD(RIG.parts[RIG.srcOf[k]][which], a,
                                    RIG.rest[k] + RIG.sign[k] * (ang[k] || 0),
                                    RIG.mirror.indexOf(k) !== -1) });
        }
        out.push({ key: 'torso', pivot: RIG.torsoAt,
                   d: rigRingsD(RIG.parts.torso[which], RIG.torsoAt, 0, false) });
        _rigCache[key] = out;
        return out;
    }

    function rigPathD(pose, which) {
        const parts = rigPartsD(pose, which);
        let d = '';
        for (let i = 0; i < parts.length; i++) d += parts[i].d;
        return d;
    }

    /* Interior linework (face circles, smile, collarbone, knees, toes) plus
       the brass pins, as markup for the doll-ink layer. The ink rides the
       same per-part transforms as the silhouette, so a rotated arm carries
       its own knuckle lines with it. */
    function rigInkMarkup(pose) {
        if (!pose.rig) return '';
        const ink = rigPartsD(pose, 'ink');
        const solid = rigPartsD(pose, 'solid');
        let torsoSolid = '';
        for (let i = 0; i < solid.length; i++) {
            if (solid[i].key === 'torso') torsoSolid = solid[i].d;
        }
        /* The torso paints over the limbs, so limb ink must be cut where the
           torso covers it -- otherwise an arm's inner contour draws across
           the chest. One mask does it: the torso is the only part on top. */
        let s = '<defs><mask id="dollInkMask" maskUnits="userSpaceOnUse"' +
                ' x="0" y="0" width="' + STAGE_W + '" height="' + STAGE_H + '">' +
                '<rect x="0" y="0" width="' + STAGE_W + '" height="' + STAGE_H +
                '" fill="#fff"/><path d="' + torsoSolid + '" fill="#000"/></mask></defs>';
        for (let i = 0; i < ink.length; i++) {
            const p = ink[i];
            if (!p.d) continue;
            const masked = p.key !== 'torso' ? ' mask="url(#dollInkMask)"' : '';
            s += '<g class="rig-part" data-part="' + p.key + '"' + masked +
                 '><path class="doll-ink-line" d="' + p.d + '"/></g>';
        }
        return s;
    }

    function posePathD(pose) {
        if (pose.rig) return rigPathD(pose, 'solid');
        if (pose.path) return pose.path;
        if (pose.skeleton) return groodleBodyPath(pose.skeleton);
        return '';
    }

    const TEMPO = 112;
    const STEPS_PER_BAR = 16;
    const BARS_PER_LOOP = 4;
    const SECONDS_PER_STEP = (60 / TEMPO) / 4;

    const MOVES = ['BOUNCE', 'TWIST', 'DISCO', 'PARTY'];
    const BEATS = ['BOOM', 'FUNKY', 'SHUFFLE', 'WILD'];

    /* ============ PERSISTENCE ============

       Single versioned localStorage key holds the whole progression
       snapshot: currency, counters, achievement unlocks, hat inventory.
       Schema bumps go via a new STATE_KEY (groodle.state.v2 etc.) so old
       saves never silently overwrite with the wrong shape; mergeDefaults
       fills in any new top-level fields added between schema-compatible
       v1 saves without nuking the user's accumulated state. */

    const STATE_KEY = 'groodle.state.v1';

    const DEFAULT_STATE = {
        doodles: 0,
        achievements: {},
        counters: {
            strokes: 0,
            drawingsFinished: 0,
            colorsUsedThisDrawing: [],
            colorsUsedEver: [],
            beatsExperienced: [],
            hasUsedEraser: false,
            hasUsedSurprise: false,
            lastVisitDate: null,
            longestDanceSec: 0,
            pagesCompleted: []
        },
        hats: {
            owned: ['no-hat'],
            equipped: 'no-hat'
        },
        accessories: {
            owned: ['no-accessory'],
            equipped: 'no-accessory'
        },
        /* Face-parts bank — the "I can't draw" safety net. Each category
           is an object (NOT null) so mergeDefaults deep-merges old saves
           cleanly. id '' = none; dx/dy = the kid's drag-nudge from the
           anchor in logical 400x600 units. */
        face: {
            hair:  { id: '', dx: 0, dy: 0 },
            brows: { id: '', dx: 0, dy: 0 },
            eyes:  { id: '', dx: 0, dy: 0 },
            nose:  { id: '', dx: 0, dy: 0 },
            mouth: { id: '', dx: 0, dy: 0 }
        },
        pose: 'standing'
    };

    let state = null;
    let danceSessionStart = 0;
    /* True for the current session only when trackVisit detected a real
       calendar-day rollover (last visit non-null AND != today). The
       Bedhead predicate reads this flag — it's deliberately not in
       state.counters because the achievement should unlock for *this*
       returning visit, not stay perpetually true. */
    let bedheadEligible = false;

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    function mergeDefaults(saved, defaults) {
        /* Recursive deep merge: pull missing keys from defaults so a new
           field added in a later schema-compatible release shows up for
           returning users; preserve any extra keys the user already has. */
        if (defaults === null || typeof defaults !== 'object') return saved;
        if (Array.isArray(defaults)) {
            return Array.isArray(saved) ? saved : defaults.slice();
        }
        if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
            return clone(defaults);
        }
        const out = {};
        for (const key in defaults) {
            out[key] = (key in saved)
                ? mergeDefaults(saved[key], defaults[key])
                : clone(defaults[key]);
        }
        for (const key in saved) {
            if (!(key in out)) out[key] = saved[key];
        }
        return out;
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            if (!raw) return clone(DEFAULT_STATE);
            return mergeDefaults(JSON.parse(raw), DEFAULT_STATE);
        } catch (e) {
            /* localStorage disabled, full quota, or corrupt JSON — fall
               back to defaults so the game still works (in-memory only). */
            return clone(DEFAULT_STATE);
        }
    }

    function saveState() {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
        catch (e) { /* quota / private mode — fail silent, in-memory only */ }
    }

    function todayKey() {
        const d = new Date();
        return d.getFullYear()
            + '-' + String(d.getMonth() + 1).padStart(2, '0')
            + '-' + String(d.getDate()).padStart(2, '0');
    }

    /* ============ COUNTERS ============

       Thin wrappers around state.counters mutations. Each writes through
       to localStorage immediately — saves are sub-millisecond on modern
       devices and there's no realistic frequency at which a kid can
       cause contention. Future commits add achievement-unlock checks
       inside these functions; for now they only update the snapshot. */

    function trackStroke() {
        state.counters.strokes += 1;
        saveState();
        checkAchievements();
    }
    function trackColorUsed(color) {
        const c = state.counters;
        let dirty = false;
        if (c.colorsUsedThisDrawing.indexOf(color) === -1) {
            c.colorsUsedThisDrawing.push(color);
            dirty = true;
        }
        if (c.colorsUsedEver.indexOf(color) === -1) {
            c.colorsUsedEver.push(color);
            dirty = true;
        }
        if (dirty) {
            saveState();
            checkAchievements();
        }
    }
    function trackEraserUsed() {
        if (state.counters.hasUsedEraser) return;
        state.counters.hasUsedEraser = true;
        saveState();
        checkAchievements();
    }
    function trackSurpriseUsed() {
        if (state.counters.hasUsedSurprise) return;
        state.counters.hasUsedSurprise = true;
        saveState();
        checkAchievements();
    }
    function trackDrawingFinished() {
        state.counters.drawingsFinished += 1;
        state.counters.colorsUsedThisDrawing = [];
        saveState();
        checkAchievements();
    }
    function trackClearDrawing() {
        state.counters.colorsUsedThisDrawing = [];
        saveState();
        /* No achievement check here — clearing only removes progress
           toward Rainbow Day; it can't unlock anything. */
    }
    function trackBeatExperienced(beat) {
        if (state.counters.beatsExperienced.indexOf(beat) !== -1) return;
        state.counters.beatsExperienced.push(beat);
        saveState();
        checkAchievements();
    }
    function trackDanceSession(seconds) {
        if (seconds > state.counters.longestDanceSec) {
            state.counters.longestDanceSec = seconds;
            saveState();
            checkAchievements();
        }
    }
    function trackVisit() {
        const today = todayKey();
        const last = state.counters.lastVisitDate;
        if (last !== today) {
            if (last !== null) bedheadEligible = true;
            state.counters.lastVisitDate = today;
            saveState();
        }
    }

    /* ============ CURRENCY ============ */

    let currencyValueEl = null;
    let currencyPillEl = null;

    function renderCurrency() {
        if (currencyValueEl) currencyValueEl.textContent = String(state.doodles);
    }

    function addDoodles(n) {
        if (!n) return;
        state.doodles = Math.max(0, state.doodles + n);
        saveState();
        renderCurrency();
        if (currencyPillEl && n > 0) {
            currencyPillEl.classList.remove('bump');
            /* force reflow so the animation restarts even if it fires
               twice in quick succession (e.g. two achievements unlocking
               back-to-back). */
            void currencyPillEl.offsetWidth;
            currencyPillEl.classList.add('bump');
        }
    }

    /* ============ ACHIEVEMENTS ============

       Static catalog: each entry has an id (used as the storage key
       inside state.achievements), a display title + one-line desc, the
       Doodles reward, an emoji icon, and a `check` predicate that's a
       pure function of state + the bedheadEligible session flag.

       The unlock engine just iterates the catalog after every counter
       mutation; predicates that are already-unlocked are skipped, and
       newly-true ones fire the toast + addDoodles. */

    const FULL_LOOP_SEC = BARS_PER_LOOP * STEPS_PER_BAR * SECONDS_PER_STEP;

    const ACHIEVEMENTS = [
        { id: 'first-groodle',    title: 'First Groodle',    desc: 'Finish your first drawing.',         reward: 10, icon: '🎨',
          check: () => state.counters.drawingsFinished >= 1 },
        { id: 'five-groodles',    title: 'Five Groodles',    desc: 'Finish five drawings.',              reward: 25, icon: '🖼️',
          check: () => state.counters.drawingsFinished >= 5 },
        { id: 'rainbow-day',      title: 'Rainbow Day',      desc: 'Use every color in one drawing.',    reward: 30, icon: '🌈',
          check: () => state.counters.colorsUsedThisDrawing.length >= COLORS.length },
        { id: 'eraser-apprentice',title: 'Eraser Apprentice',desc: 'Use the eraser tool.',                reward:  5, icon: '🧽',
          check: () => state.counters.hasUsedEraser },
        { id: 'beat-boom',        title: 'Beat BOOM',        desc: 'Dance to the BOOM beat.',             reward: 10, icon: '🥁',
          check: () => state.counters.beatsExperienced.indexOf('BOOM') !== -1 },
        { id: 'beat-funky',       title: 'Beat FUNKY',       desc: 'Dance to the FUNKY beat.',            reward: 10, icon: '🎷',
          check: () => state.counters.beatsExperienced.indexOf('FUNKY') !== -1 },
        { id: 'beat-shuffle',     title: 'Beat SHUFFLE',     desc: 'Dance to the SHUFFLE beat.',          reward: 10, icon: '🪩',
          check: () => state.counters.beatsExperienced.indexOf('SHUFFLE') !== -1 },
        { id: 'beat-wild',        title: 'Beat WILD',        desc: 'Dance to the WILD beat.',             reward: 10, icon: '🎸',
          check: () => state.counters.beatsExperienced.indexOf('WILD') !== -1 },
        { id: 'all-beat-champion',title: 'All-Beat Champion',desc: 'Dance to all four beats.',            reward: 25, icon: '🏆',
          check: () => state.counters.beatsExperienced.length >= BEATS.length },
        { id: 'dance-floor',      title: 'Dance Floor',      desc: 'Dance for a full song without stopping.', reward: 20, icon: '🕺',
          check: () => state.counters.longestDanceSec >= FULL_LOOP_SEC },
        { id: 'bedhead',          title: 'Bedhead',          desc: 'Come back the next day.',             reward: 30, icon: '😴',
          check: () => bedheadEligible },
        { id: 'doodler',          title: 'Doodler',          desc: 'Make 100 brush strokes.',              reward: 25, icon: '✏️',
          check: () => state.counters.strokes >= 100 },
        { id: 'big-doodler',      title: 'Big Doodler',      desc: 'Make 500 brush strokes.',              reward: 50, icon: '🖌️',
          check: () => state.counters.strokes >= 500 },
        { id: 'color-curator',    title: 'Color Curator',    desc: 'Try 8 different colors across your drawings.', reward: 20, icon: '🎭',
          check: () => state.counters.colorsUsedEver.length >= 8 },
        { id: 'surprise-hat',     title: 'Surprise Hat',     desc: 'Discover the SURPRISE button.',        reward: 15, icon: '🎲',
          check: () => state.counters.hasUsedSurprise },
        /* Coloring-book page completions. Each unlocks the FIRST time the
           kid hits DANCE while that page template is on the canvas; the
           predicate reads from state.counters.pagesCompleted which is
           appended to inside startDance(). */
        { id: 'page-robot',       title: 'Robo-Doodler',     desc: 'Color the Robot page.',                reward: 15, icon: '🤖',
          check: () => state.counters.pagesCompleted.indexOf('robot') !== -1 },
        { id: 'page-princess',    title: 'Royal Crayon',     desc: 'Color the Princess page.',             reward: 15, icon: '👑',
          check: () => state.counters.pagesCompleted.indexOf('princess') !== -1 },
        { id: 'page-astronaut',   title: 'Space Doodler',    desc: 'Color the Astronaut page.',            reward: 15, icon: '🚀',
          check: () => state.counters.pagesCompleted.indexOf('astronaut') !== -1 },
        { id: 'page-clown',       title: 'Big-Top Star',     desc: 'Color the Clown page.',                reward: 15, icon: '🤡',
          check: () => state.counters.pagesCompleted.indexOf('clown') !== -1 },
        { id: 'page-pirate',      title: 'Yarrr-tist',       desc: 'Color the Pirate page.',               reward: 15, icon: '🏴‍☠️',
          check: () => state.counters.pagesCompleted.indexOf('pirate') !== -1 },
        { id: 'page-superhero',   title: 'Caped Coloring',   desc: 'Color the Superhero page.',            reward: 15, icon: '🦸',
          check: () => state.counters.pagesCompleted.indexOf('superhero') !== -1 },
        { id: 'page-master',      title: 'Coloring Master',  desc: 'Finish every coloring-book page.',     reward: 50, icon: '📖',
          check: () => state.counters.pagesCompleted.length >= 6 }
    ];

    const ACHIEVEMENT_BY_ID = {};
    ACHIEVEMENTS.forEach(a => { ACHIEVEMENT_BY_ID[a.id] = a; });

    function isUnlocked(id) {
        const rec = state.achievements[id];
        return !!(rec && rec.unlocked);
    }

    function unlockAchievement(ach) {
        if (isUnlocked(ach.id)) return;
        state.achievements[ach.id] = { unlocked: true, ts: Date.now() };
        saveState();
        addDoodles(ach.reward);
        showAchievementToast(ach);
        /* If the board is currently open, refresh it so the user sees the
           card flip from locked to unlocked while looking at it. */
        if (achievementsModalEl && !achievementsModalEl.hidden) {
            renderAchievementBoard();
        }
    }

    function checkAchievements() {
        if (!state) return;
        for (let i = 0; i < ACHIEVEMENTS.length; i++) {
            const a = ACHIEVEMENTS[i];
            if (isUnlocked(a.id)) continue;
            try {
                if (a.check()) unlockAchievement(a);
            } catch (e) { /* defensive: a malformed predicate can't take
                             down the whole engine */ }
        }
    }

    /* ============ TOAST ============

       Single-file queue: only one toast on screen at a time so they
       don't overlap visually. Subsequent unlocks wait their turn. */

    let toastContainerEl = null;
    const toastQueue = [];
    let toastBusy = false;

    function showAchievementToast(ach) {
        toastQueue.push(ach);
        if (!toastBusy) drainToastQueue();
    }

    function drainToastQueue() {
        if (toastQueue.length === 0) { toastBusy = false; return; }
        toastBusy = true;
        const ach = toastQueue.shift();
        const el = document.createElement('div');
        el.className = 'achievement-toast';
        el.setAttribute('role', 'status');
        el.innerHTML =
            '<div class="toast-icon" aria-hidden="true"></div>' +
            '<div class="toast-body">' +
                '<div class="toast-meta">Achievement unlocked</div>' +
                '<div class="toast-title"></div>' +
                '<div class="toast-reward"></div>' +
            '</div>';
        /* textContent assignment instead of building the string with the
           ach values directly — keeps user-visible strings safe even if a
           future achievement title contains characters HTML cares about. */
        el.querySelector('.toast-icon').textContent = ach.icon;
        el.querySelector('.toast-title').textContent = ach.title;
        el.querySelector('.toast-reward').textContent = '+' + ach.reward + ' 🪙';
        toastContainerEl.appendChild(el);
        /* next frame: let the browser paint the start state then add
           .show so the transition runs. */
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('show'));
        });
        setTimeout(() => {
            el.classList.remove('show');
            el.classList.add('hide');
            setTimeout(() => {
                el.remove();
                drainToastQueue();
            }, 400);
        }, 2800);
    }

    /* ============ MODAL ============

       Generic open/close used by the achievements board and (next
       commit) the hat shop. Click outside the sheet (anything tagged
       data-close="1") dismisses. Escape closes. Body scroll is locked
       while open. */

    let openModalEl = null;

    function openModal(el) {
        if (!el || openModalEl === el) return;
        if (openModalEl) closeModal();
        openModalEl = el;
        el.hidden = false;
        el.setAttribute('aria-hidden', 'false');
        document.documentElement.classList.add('modal-open');
        /* Two RAFs so the browser commits hidden=false + initial
           transforms before we trigger the .open transition. */
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('open'));
        });
    }

    function closeModal() {
        if (!openModalEl) return;
        const el = openModalEl;
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        document.documentElement.classList.remove('modal-open');
        openModalEl = null;
        /* Wait out the slide-down transition before hiding so the sheet
           animates away rather than snapping. Matches .modal-sheet's
           transition duration with a small buffer. */
        setTimeout(() => { if (!openModalEl) el.hidden = true; }, 360);
    }

    function attachModalDismissers(el) {
        el.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('[data-close="1"]')) closeModal();
        });
    }

    /* ============ DRAWER ============

       Slide-up bottom-sheet panels for the floating tool dock. Only
       one drawer is open at a time; openDrawer() switches between
       them. Closes on:
         * tap of [data-drawer-close="1"] (the X or the dim backdrop),
         * tap of a different dock button (handled by openDrawer
           switching to that drawer),
         * tap of the same dock button again (toggle off),
         * Escape key (global handler in init),
         * entering dance mode (startDance calls closeDrawer). */

    let drawerHostEl = null;
    let openDrawerEl = null;
    let activeDockBtn = null;

    function openDrawer(id) {
        const el = id ? document.getElementById('drawer' + id.charAt(0).toUpperCase() + id.slice(1)) : null;
        if (!el) return;
        if (openDrawerEl === el) { closeDrawer(); return; }
        if (openDrawerEl) closeDrawer({ instant: true });
        openDrawerEl = el;
        if (drawerHostEl) {
            drawerHostEl.hidden = false;
            drawerHostEl.setAttribute('aria-hidden', 'false');
            drawerHostEl.classList.add('open');
        }
        el.hidden = false;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('open'));
        });
        /* Mark whichever dock button has data-drawer=id as active so
           the user has visual feedback on which drawer is open. */
        const btn = document.querySelector('.dock-btn[data-drawer="' + id + '"]');
        if (activeDockBtn) activeDockBtn.classList.remove('active');
        activeDockBtn = btn;
        if (btn) btn.classList.add('active');
    }

    function closeDrawer(opts) {
        if (!openDrawerEl) return;
        const el = openDrawerEl;
        el.classList.remove('open');
        openDrawerEl = null;
        if (activeDockBtn) { activeDockBtn.classList.remove('active'); activeDockBtn = null; }
        const finishHide = () => {
            if (!openDrawerEl) {
                el.hidden = true;
                if (drawerHostEl) {
                    drawerHostEl.classList.remove('open');
                    drawerHostEl.hidden = true;
                    drawerHostEl.setAttribute('aria-hidden', 'true');
                }
            }
        };
        if (opts && opts.instant) finishHide();
        else setTimeout(finishHide, 320);
    }

    function attachDrawerHostDismissers() {
        if (!drawerHostEl) return;
        drawerHostEl.addEventListener('click', (e) => {
            const t = e.target;
            if (t && t.closest && t.closest('[data-drawer-close="1"]')) closeDrawer();
        });
    }

    function attachDockButtons() {
        document.querySelectorAll('.dock-btn[data-drawer]').forEach((btn) => {
            btn.addEventListener('click', () => openDrawer(btn.getAttribute('data-drawer')));
        });
    }

    /* The dock is icon-only. Desktop gets the label tooltip via CSS
       :hover; touch devices have no hover, so a long-press (~450 ms
       hold without moving) reveals the label by toggling .show-tip.
       The tooltip clears on release / cancel / drag so it never
       lingers. The button's click still fires on release — holding to
       peek at the label and then triggering the action is acceptable
       (and discoverable) for a kids' app; gating the click would add
       a surprising "nothing happened" failure mode. */
    function attachDockTooltips() {
        const HOLD_MS = 450;
        document.querySelectorAll('.dock-btn').forEach((btn) => {
            let timer = null;
            let startX = 0, startY = 0;
            const clear = () => {
                if (timer) { clearTimeout(timer); timer = null; }
                btn.classList.remove('show-tip');
            };
            btn.addEventListener('pointerdown', (e) => {
                startX = e.clientX;
                startY = e.clientY;
                timer = setTimeout(() => {
                    btn.classList.add('show-tip');
                }, HOLD_MS);
            });
            btn.addEventListener('pointermove', (e) => {
                /* A real long-press holds still. If the finger travels
                   more than a few px it's a scroll / drag — cancel so
                   the tooltip doesn't pop mid-gesture. */
                if (Math.abs(e.clientX - startX) > 8 ||
                    Math.abs(e.clientY - startY) > 8) {
                    clear();
                }
            });
            btn.addEventListener('pointerup', clear);
            btn.addEventListener('pointercancel', clear);
            btn.addEventListener('pointerleave', clear);
        });
    }

    /* ============ ACHIEVEMENT BOARD ============ */

    let achievementsModalEl = null;
    let achievementsListEl = null;
    let achievementsStatsEl = null;

    function renderAchievementBoard() {
        if (!achievementsListEl) return;
        const unlockedCount = ACHIEVEMENTS.filter(a => isUnlocked(a.id)).length;
        achievementsStatsEl.textContent =
            unlockedCount + ' / ' + ACHIEVEMENTS.length + ' unlocked';
        achievementsListEl.innerHTML = '';
        /* Unlocked first, then locked in catalog order. Within unlocked,
           sort by unlock timestamp descending so the most recent appears
           at the top — kids like seeing what they just earned. */
        const sorted = ACHIEVEMENTS.slice().sort((a, b) => {
            const au = isUnlocked(a.id), bu = isUnlocked(b.id);
            if (au !== bu) return au ? -1 : 1;
            if (au && bu) {
                return (state.achievements[b.id].ts || 0) - (state.achievements[a.id].ts || 0);
            }
            return ACHIEVEMENTS.indexOf(a) - ACHIEVEMENTS.indexOf(b);
        });
        for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            const unlocked = isUnlocked(a.id);
            const card = document.createElement('div');
            card.className = 'ach-card ' + (unlocked ? 'unlocked' : 'locked');
            card.innerHTML =
                '<div class="ach-icon" aria-hidden="true"></div>' +
                '<div class="ach-body">' +
                    '<div class="ach-title"></div>' +
                    '<div class="ach-desc"></div>' +
                '</div>' +
                '<div class="ach-reward"></div>';
            card.querySelector('.ach-icon').textContent = unlocked ? a.icon : '🔒';
            card.querySelector('.ach-title').textContent = a.title;
            card.querySelector('.ach-desc').textContent = a.desc;
            card.querySelector('.ach-reward').textContent = '+' + a.reward + ' 🪙';
            achievementsListEl.appendChild(card);
        }
    }

    function openAchievements() {
        renderAchievementBoard();
        openModal(achievementsModalEl);
    }

    /* ============ HATS ============

       Catalog of 16 purchasable hats + a free 'no-hat' default. All
       artwork lives in a single PNG spritesheet at
       assets/sprites/hats.png with per-frame coordinates inlined in
       HAT_FRAMES below (mirrors assets/sprites/hats.json — regenerate
       this block when the sheet changes).

       Positioning convention (renderEquippedHat applies via
       hatImageMarkup):
         * Sprite's bottom-center is the anchor reference point.
         * That point lands at the head crown (canvas 200, 42) shifted
           by anchor.x / anchor.y.
         * scale multiplies each frame's natural pixel dimensions.

       Rendering uses a nested <svg> with its own viewBox = the frame
       sub-rect of the sheet. The inner <image> draws the full sheet at
       0,0, and the inner viewBox windows the visible region down to
       the desired frame — same trick the other Madderverse games use
       for spritesheets. No <pattern>, no clip-path.

       The hat-layer SVG isn't clipped, so hat content is allowed to
       extend outside the body silhouette. Hats follow the dance
       transforms because the SVG element is a child of .creature. */

    const HEAD_CROWN_X = 207;
    const HEAD_CROWN_Y = 43;

    const HAT_SHEET_URL = 'assets/sprites/hats.png';
    const HAT_SHEET_W = 874;
    const HAT_SHEET_H = 963;

    /* Frame coordinates inlined from assets/sprites/hats.json. If the
       sheet is re-exported with shifted frames, regenerate this object. */
    const HAT_FRAMES = {
        'gelatinous-cube': { x:   2, y:   2, w: 216, h: 223 },
        'giggle-boot':     { x: 220, y:   2, w: 216, h: 201 },
        'graph-paper':     { x: 438, y:   2, w: 216, h: 138 },
        'gross-out':       { x: 656, y:   2, w: 216, h: 171 },
        'haunted-house':   { x:   2, y: 227, w: 216, h: 212 },
        'metal-gears':     { x: 220, y: 227, w: 216, h: 158 },
        'rocket-ship':     { x: 438, y: 227, w: 216, h: 283 },
        'scanner-chic':    { x: 656, y: 227, w: 216, h: 220 },
        'slime-rancher':   { x:   2, y: 512, w: 216, h: 137 },
        'the-worminal':    { x: 220, y: 512, w: 216, h: 120 },
        'tower-defense':   { x: 438, y: 512, w: 216, h: 170 },
        'candy-bowl':      { x: 656, y: 512, w: 216, h: 225 },
        'circuit-board':   { x:   2, y: 739, w: 216, h: 222 },
        'cool-kids':       { x: 220, y: 739, w: 216, h: 160 },
        'friend-picker':   { x: 438, y: 739, w: 216, h: 139 },
        'funky-fresh':     { x: 656, y: 739, w: 216, h: 196 }
    };

    /* Prices ramp from 20 → 130 roughly with visual complexity. anchor.y
       values are calibrated for the sheet shipped at assets/sprites/
       hats.json, which is trimmed: false — each frame carries built-in
       transparent bottom padding (where the wearer's head sits in the
       source artwork). Bottom-center anchoring would otherwise float
       the visible hat content well above the head crown, so anchor.y
       values are generous (≈80-100) to push the sprite far enough down
       that the visible artwork lands on the head. Outliers:
         - rocket-ship / giggle-boot: tall narrow standing sprites,
           smaller anchor pulls them up so the rocket / boot rests on
           the crown rather than going off the top.
         - gelatinous-cube: meant to engulf the head, anchored deeper.
         - cool-kids: cap + sunglasses, anchored deeper so the lenses
           land at the eye line. */
    const HATS = [
        { id: 'no-hat',          name: 'No Hat',          price:   0, sprite: null,              anchor: { x: 0, y:   0 }, scale: 1.00 },
        { id: 'funky-fresh',     name: 'Funky Fresh',     price:  20, sprite: 'funky-fresh',     anchor: { x: 0, y:  80 }, scale: 0.65 },
        { id: 'graph-paper',     name: 'Graph Paper',     price:  25, sprite: 'graph-paper',     anchor: { x: 0, y:  65 }, scale: 0.65 },
        { id: 'friend-picker',   name: 'Friend Picker',   price:  30, sprite: 'friend-picker',   anchor: { x: 0, y:  55 }, scale: 0.70 },
        { id: 'cool-kids',       name: 'Cool Kids',       price:  35, sprite: 'cool-kids',       anchor: { x: 5, y:  80 }, scale: 0.65 },
        { id: 'slime-rancher',   name: 'Slime Rancher',   price:  45, sprite: 'slime-rancher',   anchor: { x: 0, y:  80 }, scale: 0.70 },
        { id: 'giggle-boot',     name: 'Giggle Boot',     price:  50, sprite: 'giggle-boot',     anchor: { x: 0, y:  45 }, scale: 0.55 },
        { id: 'candy-bowl',      name: 'Candy Bowl',      price:  55, sprite: 'candy-bowl',      anchor: { x: 0, y:  65 }, scale: 0.65 },
        { id: 'metal-gears',     name: 'Metal Gears',     price:  60, sprite: 'metal-gears',     anchor: { x: 0, y:  55 }, scale: 0.70 },
        { id: 'the-worminal',    name: 'The Worminal',    price:  65, sprite: 'the-worminal',    anchor: { x: 0, y:  50 }, scale: 0.70 },
        { id: 'rocket-ship',     name: 'Rocket Ship',     price:  75, sprite: 'rocket-ship',     anchor: { x: 0, y:  65 }, scale: 0.50 },
        { id: 'gross-out',       name: 'Gross-Out',       price:  80, sprite: 'gross-out',       anchor: { x: 0, y:  85 }, scale: 0.70 },
        { id: 'gelatinous-cube', name: 'Gelatinous Cube', price:  90, sprite: 'gelatinous-cube', anchor: { x: 0, y: 120 }, scale: 0.65 },
        { id: 'haunted-house',   name: 'Haunted House',   price:  95, sprite: 'haunted-house',   anchor: { x: 0, y:  60 }, scale: 0.60 },
        { id: 'scanner-chic',    name: 'Scanner Chic',    price: 105, sprite: 'scanner-chic',    anchor: { x: 0, y:  75 }, scale: 0.65 },
        { id: 'circuit-board',   name: 'Circuit Board',   price: 115, sprite: 'circuit-board',   anchor: { x: 0, y: 120 }, scale: 0.65 },
        { id: 'tower-defense',   name: 'Tower Defense',   price: 130, sprite: 'tower-defense',   anchor: { x: 0, y: 120 }, scale: 0.70 }
    ];

    const HAT_BY_ID = {};
    HATS.forEach(h => { HAT_BY_ID[h.id] = h; });

    /* Build the SVG markup that places a hat from the sheet at the
       correct canvas-coordinate rect. Used for both the in-stage hat
       layer and the hat-shop preview cards (which crop their outer
       viewBox to a smaller window but share this coordinate space).
       Returns '' for no-hat or any frame missing from HAT_FRAMES so
       the caller can no-op. */
    function hatImageMarkup(hat) {
        if (!hat || !hat.sprite) return '';
        const frame = HAT_FRAMES[hat.sprite];
        if (!frame) return '';
        const w = frame.w * hat.scale;
        const h = frame.h * hat.scale;
        const x = HEAD_CROWN_X + hat.anchor.x - w / 2;
        const y = HEAD_CROWN_Y + hat.anchor.y - h;
        return '<svg' +
            ' x="' + x.toFixed(2) + '"' +
            ' y="' + y.toFixed(2) + '"' +
            ' width="' + w.toFixed(2) + '"' +
            ' height="' + h.toFixed(2) + '"' +
            ' viewBox="' + frame.x + ' ' + frame.y + ' ' + frame.w + ' ' + frame.h + '"' +
            ' preserveAspectRatio="xMidYMid meet"' +
            '>' +
            '<image href="' + HAT_SHEET_URL + '"' +
                ' x="0" y="0" width="' + HAT_SHEET_W + '" height="' + HAT_SHEET_H + '"' +
            '/>' +
            '</svg>';
    }

    /* In-game (.creature) hat layer. Updated on equip / load / surprise.
       Surprise repaints the canvas but never touches the hat layer, so
       a kid's hat survives across SURPRISE / CLEAR / DANCE transitions. */
    let hatLayerInnerEl = null;

    function renderEquippedHat() {
        if (!hatLayerInnerEl) return;
        const hat = HAT_BY_ID[state.hats.equipped] || HAT_BY_ID['no-hat'];
        hatLayerInnerEl.innerHTML = hatImageMarkup(hat);
    }

    function buyHat(id) {
        const hat = HAT_BY_ID[id];
        if (!hat) return;
        const alreadyOwned = state.hats.owned.indexOf(id) !== -1;
        if (alreadyOwned) { equipHat(id); return; }
        if (hat.price > 0 && state.doodles < hat.price) return;
        state.doodles -= hat.price;
        state.hats.owned.push(id);
        state.hats.equipped = id;
        saveState();
        renderCurrency();
        renderEquippedHat();
        buildHatShopGrid();
    }

    function equipHat(id) {
        if (state.hats.owned.indexOf(id) === -1) return;
        state.hats.equipped = id;
        saveState();
        renderEquippedHat();
        buildHatShopGrid();
    }

    /* ============ HAT SHOP UI ============ */

    let hatShopModalEl = null;
    let hatShopGridEl = null;
    let hatShopBalanceEl = null;

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function buildHatShopGrid() {
        if (!hatShopGridEl) return;
        if (hatShopBalanceEl) {
            hatShopBalanceEl.textContent = '🪙 ' + state.doodles + ' Doodles';
        }
        hatShopGridEl.innerHTML = '';
        for (let i = 0; i < HATS.length; i++) {
            const hat = HATS[i];
            const owned = state.hats.owned.indexOf(hat.id) !== -1;
            const equipped = state.hats.equipped === hat.id;
            const affordable = state.doodles >= hat.price;

            const card = document.createElement('div');
            card.className = 'hat-card';
            if (equipped) card.classList.add('equipped');
            else if (owned) card.classList.add('owned');
            else if (!affordable && hat.price > 0) card.classList.add('locked');

            /* The preview is a mini-Groodle: same wash circle for the
               head as the in-stage figure, then the hat <image> sprite
               on top. viewBox crops to the upper body so the hat
               dominates the card. */
            const previewSvg =
                '<svg class="hat-preview" viewBox="60 -90 280 280" aria-hidden="true">' +
                    '<circle cx="200" cy="100" r="58" fill="rgba(232, 232, 244, 0.94)" stroke="#1a0f33" stroke-width="3"/>' +
                    hatImageMarkup(hat) +
                '</svg>';

            let actionHtml;
            if (equipped) {
                actionHtml = '<button class="hat-action equipped-tag" type="button" disabled>✓ Equipped</button>';
            } else if (owned) {
                actionHtml = '<button class="hat-action own" type="button" data-action="equip">Wear</button>';
            } else if (hat.price === 0) {
                /* No-Hat row when not currently equipped — treat as a
                   free equip (price 0). */
                actionHtml = '<button class="hat-action own" type="button" data-action="buy">Wear</button>';
            } else if (affordable) {
                actionHtml = '<button class="hat-action buy" type="button" data-action="buy">Buy &nbsp;' + hat.price + ' 🪙</button>';
            } else {
                actionHtml = '<button class="hat-action locked-tag" type="button" disabled>🔒 ' + hat.price + ' 🪙</button>';
            }

            card.innerHTML = previewSvg +
                '<div class="hat-name">' + escapeHtml(hat.name) + '</div>' +
                actionHtml;

            const btn = card.querySelector('button[data-action]');
            if (btn) {
                btn.addEventListener('click', () => {
                    if (btn.dataset.action === 'equip') equipHat(hat.id);
                    else buyHat(hat.id);
                });
            }

            hatShopGridEl.appendChild(card);
        }
    }

    function openHatShop() {
        buildHatShopGrid();
        buildAccessoryShopGrid();
        openModal(hatShopModalEl);
    }

    /* ============ ACCESSORIES ============

       Second wardrobe layer above hats — glasses, mustaches, capes,
       bow ties, etc. Same buy-with-Doodles + equip flow as hats; same
       SVG-overlay rendering pattern except each accessory is INLINE
       SVG (no shared sprite atlas to ship). The accessory's local
       coordinate space is centered on (0,0); render code translates
       to the named anchor point on the figure and applies the
       accessory's scale.

       Anchors are absolute coordinates that line up with the standard
       humanoid silhouette (standing / cheer / star / groovy / t-pose /
       wave). For non-humanoid poses (ghost, animal) the accessory
       still renders at the anchor coordinate but may not land on a
       meaningful body part — accept that as v1 and revisit if it
       comes up. */

    const ACCESSORY_ANCHORS = {
        eyes:      { x: 200, y:  92 },
        mouth:     { x: 200, y: 122 },
        chin:      { x: 200, y: 150 },
        shoulders: { x: 200, y: 175 },
        chest:     { x: 200, y: 250 }
    };

    const ACCESSORIES = [
        { id: 'no-accessory', name: 'Nothing',          price:   0, emoji: '🚫', anchor: 'eyes',      scale: 1, svg: '' },
        {
            id: 'round-specs', name: 'Round Specs',     price:  20, emoji: '🤓', anchor: 'eyes',      scale: 1,
            svg: '<g stroke="#1a0f33" stroke-width="3" fill="none">' +
                 '<circle cx="-18" cy="0" r="13"/>' +
                 '<circle cx="18" cy="0" r="13"/>' +
                 '<line x1="-5" y1="0" x2="5" y2="0"/>' +
                 '</g>'
        },
        {
            id: 'star-shades', name: 'Star Shades',     price:  40, emoji: '⭐', anchor: 'eyes',      scale: 1,
            svg: '<g fill="#ffd23f" stroke="#1a0f33" stroke-width="2.5">' +
                 '<polygon points="-18,-12 -14,-3 -4,-3 -12,4 -8,13 -18,7 -28,13 -24,4 -32,-3 -22,-3"/>' +
                 '<polygon points="18,-12 22,-3 32,-3 24,4 28,13 18,7 8,13 12,4 4,-3 14,-3"/>' +
                 '<line x1="-5" y1="0" x2="5" y2="0"/>' +
                 '</g>'
        },
        {
            id: 'heart-shades', name: 'Heart Shades',   price:  40, emoji: '💖', anchor: 'eyes',      scale: 1,
            svg: '<g fill="#ff6ec7" stroke="#1a0f33" stroke-width="2.5">' +
                 '<path d="M -18,-6 C -22,-12 -32,-10 -32,-2 C -32,5 -18,12 -18,12 C -18,12 -4,5 -4,-2 C -4,-10 -14,-12 -18,-6 Z"/>' +
                 '<path d="M 18,-6 C 14,-12 4,-10 4,-2 C 4,5 18,12 18,12 C 18,12 32,5 32,-2 C 32,-10 22,-12 18,-6 Z"/>' +
                 '</g>'
        },
        {
            id: 'mustache', name: 'Mustache',           price:  25, emoji: '🥸', anchor: 'mouth',     scale: 1,
            svg: '<path d="M 0,0 C -8,-6 -22,-4 -28,2 C -22,8 -10,6 -4,3 L 0,3 C -4,3 -10,6 -22,8 ' +
                 'M 0,0 C 8,-6 22,-4 28,2 C 22,8 10,6 4,3 L 0,3 C 4,3 10,6 22,8" ' +
                 'fill="#3b1f6b" stroke="#1a0f33" stroke-width="2"/>'
        },
        {
            id: 'bow-tie', name: 'Bow Tie',             price:  25, emoji: '🎀', anchor: 'chin',      scale: 1,
            svg: '<g fill="#e63946" stroke="#1a0f33" stroke-width="2.5">' +
                 '<polygon points="0,0 -24,-12 -24,12"/>' +
                 '<polygon points="0,0 24,-12 24,12"/>' +
                 '<rect x="-5" y="-7" width="10" height="14" rx="2"/>' +
                 '</g>'
        },
        {
            id: 'long-beard', name: 'Long Beard',       price:  35, emoji: '🧔', anchor: 'chin',      scale: 1,
            svg: '<g fill="#6f4e37" stroke="#1a0f33" stroke-width="2.5">' +
                 '<path d="M -28,-8 C -28,18 -16,40 0,42 C 16,40 28,18 28,-8 C 16,-2 -16,-2 -28,-8 Z"/>' +
                 '</g>'
        },
        {
            id: 'superhero-cape', name: 'Hero Cape',    price:  60, emoji: '🦸', anchor: 'shoulders', scale: 1,
            svg: '<g fill="#e63946" stroke="#1a0f33" stroke-width="2.5" stroke-linejoin="round">' +
                 '<path d="M -55,-10 L -85,200 L 0,170 L 85,200 L 55,-10 L 25,0 L 0,8 L -25,0 Z"/>' +
                 '</g>'
        },
        {
            id: 'fairy-wings', name: 'Fairy Wings',     price:  70, emoji: '🧚', anchor: 'shoulders', scale: 1,
            svg: '<g fill="rgba(255, 110, 199, 0.55)" stroke="#ff6ec7" stroke-width="2.5">' +
                 '<ellipse cx="-50" cy="0" rx="40" ry="55" transform="rotate(-25 -50 0)"/>' +
                 '<ellipse cx="50" cy="0" rx="40" ry="55" transform="rotate(25 50 0)"/>' +
                 '<ellipse cx="-45" cy="60" rx="32" ry="40" transform="rotate(-15 -45 60)"/>' +
                 '<ellipse cx="45" cy="60" rx="32" ry="40" transform="rotate(15 45 60)"/>' +
                 '</g>'
        },
        {
            id: 'sheriff-badge', name: 'Sheriff Badge', price:  45, emoji: '🌟', anchor: 'chest',     scale: 1,
            svg: '<g fill="#ffd23f" stroke="#1a0f33" stroke-width="2.5">' +
                 '<polygon points="0,-22 5,-7 22,-7 9,3 14,18 0,9 -14,18 -9,3 -22,-7 -5,-7"/>' +
                 '<circle cx="0" cy="0" r="4" fill="#1a0f33"/>' +
                 '</g>'
        }
    ];

    const ACCESSORY_BY_ID = {};
    ACCESSORIES.forEach(a => { ACCESSORY_BY_ID[a.id] = a; });

    let accessoryLayerInnerEl = null;
    let accessoryShopGridEl = null;

    function accessoryMarkup(acc) {
        if (!acc || !acc.svg || acc.id === 'no-accessory') return '';
        const anchor = ACCESSORY_ANCHORS[acc.anchor] || ACCESSORY_ANCHORS.eyes;
        const s = acc.scale || 1;
        return '<g transform="translate(' + anchor.x + ',' + anchor.y + ') scale(' + s + ')">' +
               acc.svg +
               '</g>';
    }

    function renderEquippedAccessory() {
        if (!accessoryLayerInnerEl) return;
        const acc = ACCESSORY_BY_ID[state.accessories.equipped] || ACCESSORY_BY_ID['no-accessory'];
        accessoryLayerInnerEl.innerHTML = accessoryMarkup(acc);
    }

    function buyAccessory(id) {
        const acc = ACCESSORY_BY_ID[id];
        if (!acc) return;
        const alreadyOwned = state.accessories.owned.indexOf(id) !== -1;
        if (alreadyOwned) { equipAccessory(id); return; }
        if (acc.price > 0 && state.doodles < acc.price) return;
        state.doodles -= acc.price;
        state.accessories.owned.push(id);
        state.accessories.equipped = id;
        saveState();
        renderCurrency();
        renderEquippedAccessory();
        buildAccessoryShopGrid();
        buildHatShopGrid();
    }

    function equipAccessory(id) {
        if (state.accessories.owned.indexOf(id) === -1) return;
        state.accessories.equipped = id;
        saveState();
        renderEquippedAccessory();
        buildAccessoryShopGrid();
    }

    function buildAccessoryShopGrid() {
        if (!accessoryShopGridEl) return;
        if (hatShopBalanceEl) {
            hatShopBalanceEl.textContent = '🪙 ' + state.doodles + ' Doodles';
        }
        accessoryShopGridEl.innerHTML = '';
        for (let i = 0; i < ACCESSORIES.length; i++) {
            const acc = ACCESSORIES[i];
            const owned = state.accessories.owned.indexOf(acc.id) !== -1;
            const equipped = state.accessories.equipped === acc.id;
            const affordable = state.doodles >= acc.price;

            const card = document.createElement('div');
            card.className = 'hat-card';
            if (equipped) card.classList.add('equipped');
            else if (owned) card.classList.add('owned');
            else if (!affordable && acc.price > 0) card.classList.add('locked');

            /* Preview: mini-Groodle head + the accessory rendered at its
               configured anchor. Same viewBox / wash as the hat shop so
               the two tabs feel uniform. */
            const previewSvg =
                '<svg class="hat-preview" viewBox="60 -10 280 280" aria-hidden="true">' +
                    '<circle cx="200" cy="100" r="58" fill="rgba(232, 232, 244, 0.94)" stroke="#1a0f33" stroke-width="3"/>' +
                    accessoryMarkup(acc) +
                '</svg>';

            let actionHtml;
            if (equipped) {
                actionHtml = '<button class="hat-action equipped-tag" type="button" disabled>✓ Equipped</button>';
            } else if (owned) {
                actionHtml = '<button class="hat-action own" type="button" data-action="equip">Wear</button>';
            } else if (acc.price === 0) {
                actionHtml = '<button class="hat-action own" type="button" data-action="buy">Wear</button>';
            } else if (affordable) {
                actionHtml = '<button class="hat-action buy" type="button" data-action="buy">Buy &nbsp;' + acc.price + ' 🪙</button>';
            } else {
                actionHtml = '<button class="hat-action locked-tag" type="button" disabled>🔒 ' + acc.price + ' 🪙</button>';
            }

            card.innerHTML = previewSvg +
                '<div class="hat-name">' + escapeHtml(acc.name) + '</div>' +
                actionHtml;

            const btn = card.querySelector('button[data-action]');
            if (btn) {
                btn.addEventListener('click', () => {
                    if (btn.dataset.action === 'equip') equipAccessory(acc.id);
                    else buyAccessory(acc.id);
                });
            }

            accessoryShopGridEl.appendChild(card);
        }
    }

    /* ============ WARDROBE TABS ============ */

    function attachWardrobeTabs() {
        const tabs = document.querySelectorAll('.wardrobe-tab');
        if (!tabs.length || !hatShopGridEl || !accessoryShopGridEl) return;
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                tabs.forEach((t) => {
                    const active = t.dataset.tab === target;
                    t.classList.toggle('active', active);
                    t.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                hatShopGridEl.hidden = (target !== 'hats');
                accessoryShopGridEl.hidden = (target !== 'accessories');
            });
        });
    }

    /* ============ COLORING-BOOK PAGES ============

       "Freedom inside a fence": the silhouette is the outer fence, and
       each page draws a pre-made line-art template inside it (eyes,
       smile, costume hints) for the kid to color in. The kid still has
       full color/brush/eraser freedom — the template just gives them a
       starting structure to work with.

       Each page's `draw(c)` paints onto the same clipped 2D context that
       free-drawing uses, so any strokes extending past the silhouette
       (an oversize crown, cape edges, etc.) get cleanly trimmed by the
       canvas clip without needing per-page coordinate fixing. Style
       conventions: navy ink (#1a0f33), 4px lineWidth, round caps. */

    const PAGES = [
        {
            id: 'robot',
            label: 'Robot',
            emoji: '🤖',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Antenna stub (the bulb sits above the head and is
                   trimmed by the clip — only the in-body part shows). */
                c.beginPath(); c.moveTo(cx, BODY.headTop + 16); c.lineTo(cx, BODY.headTop + 6); c.stroke();
                c.beginPath(); c.arc(cx, BODY.headTop + 1, 5, 0, Math.PI * 2); c.stroke();
                /* Square eyes with tiny pupils. */
                c.strokeRect(cx - edx - 9, ey - 9, 18, 18);
                c.strokeRect(cx + edx - 9, ey - 9, 18, 18);
                c.beginPath(); c.arc(cx - edx, ey, 2, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + edx, ey, 2, 0, Math.PI * 2); c.fill();
                /* Mouth + teeth. */
                c.strokeRect(cx - 20, my + 4, 40, 14);
                c.beginPath(); c.moveTo(cx - 7, my + 4); c.lineTo(cx - 7, my + 18); c.stroke();
                c.beginPath(); c.moveTo(cx + 7, my + 4); c.lineTo(cx + 7, my + 18); c.stroke();
                /* Control panel with 3 buttons, centered on the chest. */
                c.strokeRect(cx - 32, BODY.chestY - 30, 64, 60);
                c.beginPath(); c.arc(cx - 16, BODY.chestY - 15, 5, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx, BODY.chestY - 15, 5, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + 16, BODY.chestY - 15, 5, 0, Math.PI * 2); c.stroke();
                /* Speaker grill. */
                for (let i = 0; i < 3; i++) {
                    const gy = BODY.chestY + 8 + i * 8;
                    c.beginPath(); c.moveTo(cx - 20, gy); c.lineTo(cx + 20, gy); c.stroke();
                }
                c.restore();
            }
        },
        {
            id: 'princess',
            label: 'Princess',
            emoji: '👑',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Tiara zigzag on the forehead with a base band. */
                const tB = BODY.headTop + 30, tT = BODY.headTop + 12;
                c.beginPath();
                c.moveTo(cx - 34, tB); c.lineTo(cx - 22, tT);
                c.lineTo(cx - 10, tB); c.lineTo(cx, tT - 4);
                c.lineTo(cx + 10, tB); c.lineTo(cx + 22, tT);
                c.lineTo(cx + 34, tB);
                c.stroke();
                c.beginPath(); c.moveTo(cx - 34, tB); c.lineTo(cx + 34, tB); c.stroke();
                /* Almond eyes. */
                c.beginPath(); c.ellipse(cx - edx, ey, 7, 5, 0, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.ellipse(cx + edx, ey, 7, 5, 0, 0, Math.PI * 2); c.stroke();
                /* Eyelashes. */
                c.beginPath(); c.moveTo(cx - edx - 6, ey - 4); c.lineTo(cx - edx - 10, ey - 7); c.stroke();
                c.beginPath(); c.moveTo(cx - edx, ey - 6); c.lineTo(cx - edx, ey - 10); c.stroke();
                c.beginPath(); c.moveTo(cx - edx + 6, ey - 4); c.lineTo(cx - edx + 10, ey - 7); c.stroke();
                c.beginPath(); c.moveTo(cx + edx - 6, ey - 4); c.lineTo(cx + edx - 10, ey - 7); c.stroke();
                c.beginPath(); c.moveTo(cx + edx, ey - 6); c.lineTo(cx + edx, ey - 10); c.stroke();
                c.beginPath(); c.moveTo(cx + edx + 6, ey - 4); c.lineTo(cx + edx + 10, ey - 7); c.stroke();
                /* Heart-shaped lips. */
                c.beginPath();
                c.moveTo(cx - 8, my - 2);
                c.bezierCurveTo(cx - 8, my - 9, cx - 1, my - 9, cx, my - 5);
                c.bezierCurveTo(cx + 1, my - 9, cx + 8, my - 9, cx + 8, my - 2);
                c.bezierCurveTo(cx + 8, my + 5, cx, my + 10, cx, my + 10);
                c.bezierCurveTo(cx, my + 10, cx - 8, my + 5, cx - 8, my - 2);
                c.stroke();
                /* Rosy cheek circles. */
                c.beginPath(); c.arc(cx - BODY.cheekDX, BODY.cheekY, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + BODY.cheekDX, BODY.cheekY, 6, 0, Math.PI * 2); c.stroke();
                /* Dress neckline V + bow. */
                const nT = BODY.shirtTop;
                c.beginPath();
                c.moveTo(cx - 30, nT); c.lineTo(cx, nT + 50); c.lineTo(cx + 30, nT);
                c.stroke();
                c.beginPath(); c.ellipse(cx - 7, nT + 50, 8, 5, -0.4, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.ellipse(cx + 7, nT + 50, 8, 5,  0.4, 0, Math.PI * 2); c.stroke();
                /* Dress flare lines (mostly clipped, hint at the skirt). */
                c.beginPath(); c.moveTo(cx - 35, BODY.chestY + 40);
                c.bezierCurveTo(cx - 45, BODY.waistY - 30, cx - 55, BODY.waistY + 20, cx - 60, BODY.pantsTop + 30);
                c.stroke();
                c.beginPath(); c.moveTo(cx + 35, BODY.chestY + 40);
                c.bezierCurveTo(cx + 45, BODY.waistY - 30, cx + 55, BODY.waistY + 20, cx + 60, BODY.pantsTop + 30);
                c.stroke();
                c.restore();
            }
        },
        {
            id: 'astronaut',
            label: 'Astronaut',
            emoji: '🚀',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, my = BODY.mouthY;
                /* Visor sweep across the upper face. */
                c.beginPath();
                c.moveTo(150, ey + 2);
                c.bezierCurveTo(170, BODY.browY, 230, BODY.browY, 250, ey + 2);
                c.stroke();
                /* Helmet chin curve. */
                c.beginPath();
                c.moveTo(150, my + 20);
                c.bezierCurveTo(175, my + 36, 225, my + 36, 250, my + 20);
                c.stroke();
                /* Eyes through the visor. */
                c.beginPath(); c.arc(cx - 15, ey + 6, 4, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + 15, ey + 6, 4, 0, Math.PI * 2); c.fill();
                /* Suit zipper with teeth ticks. */
                c.beginPath(); c.moveTo(cx, BODY.shirtTop); c.lineTo(cx, BODY.waistY); c.stroke();
                for (let y = BODY.shirtTop + 12; y <= BODY.waistY - 8; y += 18) {
                    c.beginPath(); c.moveTo(cx - 4, y); c.lineTo(cx + 4, y); c.stroke();
                }
                /* Mission patch + tiny star inside, on the chest. */
                const pX = cx - 30, pY = BODY.chestY - 14;
                c.strokeRect(pX, pY, 28, 28);
                c.beginPath();
                c.moveTo(pX + 14, pY + 5);
                c.lineTo(pX + 17, pY + 13); c.lineTo(pX + 25, pY + 13);
                c.lineTo(pX + 19, pY + 18); c.lineTo(pX + 21, pY + 26);
                c.lineTo(pX + 14, pY + 21); c.lineTo(pX + 7, pY + 26);
                c.lineTo(pX + 9, pY + 18); c.lineTo(pX + 3, pY + 13);
                c.lineTo(pX + 11, pY + 13);
                c.closePath(); c.stroke();
                /* Utility belt. */
                c.beginPath(); c.moveTo(cx - 45, BODY.waistY); c.lineTo(cx + 45, BODY.waistY); c.stroke();
                c.restore();
            }
        },
        {
            id: 'clown',
            label: 'Clown',
            emoji: '🤡',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Big round nose. */
                c.beginPath(); c.arc(cx, my - 4, 16, 0, Math.PI * 2); c.stroke();
                /* Eye dots + surprised eyebrows. */
                c.beginPath(); c.arc(cx - edx - 2, ey - 1, 5, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + edx + 2, ey - 1, 5, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx - edx - 2, ey - 14, 10, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
                c.beginPath(); c.arc(cx + edx + 2, ey - 14, 10, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
                /* Big smile + upturned ends. */
                c.beginPath(); c.arc(cx, my + 14, 26, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
                c.beginPath(); c.moveTo(cx - 23, my + 27); c.lineTo(cx - 26, my + 23); c.stroke();
                c.beginPath(); c.moveTo(cx + 23, my + 27); c.lineTo(cx + 26, my + 23); c.stroke();
                /* Curly hair tufts hugging the head edges. */
                c.beginPath(); c.arc(cx - 46, BODY.headCy + 2, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx - 40, BODY.headCy + 16, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + 46, BODY.headCy + 2, 6, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.arc(cx + 40, BODY.headCy + 16, 6, 0, Math.PI * 2); c.stroke();
                /* Bow tie just below the chin. */
                const bY = BODY.neckY + 8;
                c.beginPath();
                c.moveTo(cx, bY);
                c.lineTo(cx - 30, bY - 10); c.lineTo(cx - 30, bY + 15);
                c.lineTo(cx, bY + 5);
                c.lineTo(cx + 30, bY + 15); c.lineTo(cx + 30, bY - 10);
                c.closePath(); c.stroke();
                c.strokeRect(cx - 4, bY - 3, 8, 12);
                /* Polka dots scattered on the shirt. */
                for (let i = 0; i < 7; i++) {
                    const dy = BODY.shirtTop + 30 + i * 22;
                    const dx = cx + (i % 2 === 0 ? -22 : 22) + (i % 3 - 1) * 8;
                    c.beginPath(); c.arc(dx, dy, 7, 0, Math.PI * 2); c.stroke();
                }
                c.restore();
            }
        },
        {
            id: 'pirate',
            label: 'Pirate',
            emoji: '🏴‍☠️',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Bandana arc across the head + base line. */
                const bY = BODY.headTop + 36;
                c.beginPath();
                c.moveTo(cx - 45, bY);
                c.bezierCurveTo(cx - 25, bY - 20, cx + 25, bY - 20, cx + 45, bY);
                c.stroke();
                c.beginPath(); c.moveTo(cx - 45, bY); c.lineTo(cx + 45, bY); c.stroke();
                /* Bandana knot + trailing tails on the left. */
                c.beginPath(); c.arc(cx - 50, bY + 7, 7, 0, Math.PI * 2); c.stroke();
                c.beginPath(); c.moveTo(cx - 57, bY + 7); c.lineTo(cx - 70, bY + 20); c.stroke();
                c.beginPath(); c.moveTo(cx - 55, bY + 13); c.lineTo(cx - 68, bY + 27); c.stroke();
                /* Filled eyepatch over the right eye + strap. */
                c.fillRect(cx + edx - 10, ey - 9, 22, 18);
                c.beginPath(); c.moveTo(cx + edx - 10, ey - 5); c.lineTo(cx - edx, ey - 8); c.stroke();
                c.beginPath(); c.moveTo(cx + edx + 12, ey); c.lineTo(cx + 44, ey - 7); c.stroke();
                /* Visible eye on the other side. */
                c.beginPath(); c.arc(cx - edx, ey, 4, 0, Math.PI * 2); c.fill();
                /* Curly mustache. */
                c.beginPath();
                c.moveTo(cx - 20, my);
                c.bezierCurveTo(cx - 15, my - 3, cx - 5, my + 2, cx, my + 5);
                c.bezierCurveTo(cx + 5, my + 2, cx + 15, my - 3, cx + 20, my);
                c.stroke();
                /* Beard outline. */
                c.beginPath();
                c.moveTo(cx - 22, my + 2);
                c.bezierCurveTo(cx - 30, my + 15, cx - 25, my + 25, cx - 5, my + 30);
                c.lineTo(cx + 5, my + 30);
                c.bezierCurveTo(cx + 25, my + 25, cx + 30, my + 15, cx + 22, my + 2);
                c.stroke();
                /* Diagonal sash across the torso. */
                c.beginPath(); c.moveTo(cx - 40, BODY.shirtTop); c.lineTo(cx + 40, BODY.chestY + 20); c.stroke();
                c.beginPath(); c.moveTo(cx - 40, BODY.shirtTop + 20); c.lineTo(cx + 40, BODY.chestY + 40); c.stroke();
                /* Belt + buckle. */
                c.strokeRect(cx - 45, BODY.waistY - 8, 90, 16);
                c.strokeRect(cx - 7, BODY.waistY - 6, 14, 12);
                /* X marks the spot on the chest. */
                c.beginPath(); c.moveTo(cx - 22, BODY.chestY - 12); c.lineTo(cx + 2, BODY.chestY + 12); c.stroke();
                c.beginPath(); c.moveTo(cx + 2, BODY.chestY - 12); c.lineTo(cx - 22, BODY.chestY + 12); c.stroke();
                c.restore();
            }
        },
        {
            id: 'superhero',
            label: 'Superhero',
            emoji: '🦸',
            draw: (c) => {
                c.save();
                c.lineCap = 'round'; c.lineJoin = 'round';
                c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
                const cx = BODY.cx, ey = BODY.eyeY, edx = BODY.eyeDX, my = BODY.mouthY;
                /* Bandit-style mask outline across the eyes. */
                c.beginPath();
                c.moveTo(cx - 50, ey - 8);
                c.bezierCurveTo(cx - 30, ey - 16, cx + 30, ey - 16, cx + 50, ey - 8);
                c.bezierCurveTo(cx + 48, ey + 14, cx + 30, ey + 22, cx, ey + 19);
                c.bezierCurveTo(cx - 30, ey + 22, cx - 48, ey + 14, cx - 50, ey - 8);
                c.closePath(); c.stroke();
                /* Mask eye holes (white inset = a target for the kid). */
                c.fillStyle = '#fff';
                c.beginPath(); c.ellipse(cx - edx, ey + 4, 10, 7, 0, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.ellipse(cx + edx, ey + 4, 10, 7, 0, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.arc(cx - edx + 2, ey + 4, 3, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(cx + edx - 2, ey + 4, 3, 0, Math.PI * 2); c.fill();
                /* Heroic grin. */
                c.beginPath();
                c.arc(cx, my + 6, 14, 0.15 * Math.PI, 0.85 * Math.PI);
                c.stroke();
                /* Big 5-point star emblem on the chest. */
                const cy = BODY.chestY, r1 = 28, r2 = 12;
                c.beginPath();
                for (let i = 0; i < 10; i++) {
                    const a = i * Math.PI / 5 - Math.PI / 2;
                    const rr = i % 2 === 0 ? r1 : r2;
                    const x = cx + Math.cos(a) * rr;
                    const y = cy + Math.sin(a) * rr;
                    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
                }
                c.closePath(); c.stroke();
                /* Cape edge curves (mostly clipped, hint at the cape). */
                c.beginPath();
                c.moveTo(cx - 45, BODY.shirtTop);
                c.bezierCurveTo(cx - 65, BODY.chestY, cx - 70, BODY.waistY + 40, cx - 60, BODY.pantsTop + 30);
                c.stroke();
                c.beginPath();
                c.moveTo(cx + 45, BODY.shirtTop);
                c.bezierCurveTo(cx + 65, BODY.chestY, cx + 70, BODY.waistY + 40, cx + 60, BODY.pantsTop + 30);
                c.stroke();
                /* Belt + buckle X. */
                c.strokeRect(cx - 45, BODY.waistY - 8, 90, 14);
                c.strokeRect(cx - 8, BODY.waistY - 7, 16, 12);
                c.beginPath();
                c.moveTo(cx - 8, BODY.waistY - 7); c.lineTo(cx + 8, BODY.waistY + 5);
                c.moveTo(cx + 8, BODY.waistY - 7); c.lineTo(cx - 8, BODY.waistY + 5);
                c.stroke();
                c.restore();
            }
        }
    ];

    const PAGE_BY_ID = {};
    PAGES.forEach(p => { PAGE_BY_ID[p.id] = p; });

    /* In-memory only — resets to blank on refresh. The persistent
       piece is state.counters.pagesCompleted (kept that field name
       for save-compat), which the page-* achievements read. Only the
       6 ids that have a page-* achievement (robot/princess/astronaut/
       clown/pirate/superhero) unlock anything; rockstar/disco track
       harmlessly. restampOutline holds the current character's outline
       fn so CLEAR keeps a "color it yourself" template on screen;
       it's null in colored / blank mode (CLEAR there = blank). */
    let currentCharacterId = null;
    let restampOutline = null;
    let pagesModalEl = null;
    let pagesGridEl = null;

    /* Shared "make it the new drawing" reset — wipe canvas + the
       per-drawing color tally so Rainbow Day starts over. */
    function freshCanvasForCharacter() {
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
        if (state) trackClearDrawing();
    }

    function applyOutline(ch) {
        freshCanvasForCharacter();
        ch.outline(ctx);
        currentCharacterId = ch.id;
        restampOutline = ch.outline;
    }

    /* Colored-for-you: pose/bg/hat/color like the old prefab path,
       then paint the filled art. No restamp (CLEAR = blank). */
    function applyFilled(ch) {
        const seed = ch.filled;
        currentCharacterId = ch.id;
        restampOutline = null;
        if (seed.pose && state && state.pose !== seed.pose) {
            applyPose(seed.pose);
        } else {
            freshCanvasForCharacter();
        }
        if (seed.bg) {
            const bgLayer = document.getElementById('bgLayer');
            if (bgLayer) bgLayer.className = 'bg-layer bg-' + seed.bg;
            document.querySelectorAll('.bg-thumb').forEach((b) => {
                b.classList.toggle('active', b.dataset.bg === seed.bg);
            });
        }
        if (seed.hat && state.hats.owned.indexOf(seed.hat) !== -1) {
            equipHat(seed.hat);
        }
        seed.draw(ctx);
        if (seed.color) {
            currentColor = seed.color;
            isErasing = false;
            document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
            const sw = document.querySelector('.swatch[data-color="' + seed.color + '"]');
            if (sw) sw.classList.add('active');
            const eraser = document.getElementById('eraserBtn');
            if (eraser) eraser.classList.remove('active');
        }
    }

    function applyCharacter(id, colored) {
        const ch = CHARACTER_BY_ID[id];
        if (!ch || !ctx) return;
        /* Prefab characters paint a face onto the canvas — drop any
           stamped SVG face parts so the two don't double up. */
        clearFaceParts();
        if (colored) applyFilled(ch); else applyOutline(ch);
    }

    function clearCharacterTemplate() {
        currentCharacterId = null;
        restampOutline = null;
        if (!ctx) return;
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
        if (state) trackClearDrawing();
    }

    function trackCharacterCompleted(id) {
        if (!id) return;
        if (state.counters.pagesCompleted.indexOf(id) !== -1) return;
        state.counters.pagesCompleted.push(id);
        saveState();
        checkAchievements();
    }

    function buildCharacterGrid() {
        if (!pagesGridEl) return;
        pagesGridEl.innerHTML = '';
        /* Blank card — back to a free-drawing surface. */
        const blank = document.createElement('button');
        blank.type = 'button';
        blank.className = 'page-card page-card-blank';
        blank.innerHTML =
            '<div class="page-emoji" aria-hidden="true">✏️</div>' +
            '<div class="page-name">Blank</div>' +
            '<div class="page-action">Start fresh</div>';
        blank.addEventListener('click', () => {
            clearCharacterTemplate();
            closeModal();
        });
        pagesGridEl.appendChild(blank);

        /* One card per character. Tapping the card = color-it-yourself
           outline; the 🎨 sub-button = color-it-for-me filled. The 🎨
           is a real <button> nested in the card; stopPropagation keeps
           the card's outline handler from also firing. */
        for (let i = 0; i < CHARACTERS.length; i++) {
            const ch = CHARACTERS[i];
            const done = state.counters.pagesCompleted.indexOf(ch.id) !== -1;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'page-card' + (done ? ' done' : '');
            card.setAttribute('aria-label', 'Color in ' + ch.label);
            card.innerHTML =
                '<button class="char-fill-btn" type="button" title="Color it for me" aria-label="Color ' + ch.label + ' for me">🎨</button>' +
                '<div class="page-emoji" aria-hidden="true">' + ch.emoji + '</div>' +
                '<div class="page-name">' + escapeHtml(ch.label) + '</div>' +
                '<div class="page-action">' + (done ? '✓ Done' : 'Color it') + '</div>';
            card.addEventListener('click', () => {
                applyCharacter(ch.id, false);
                closeModal();
            });
            const fillBtn = card.querySelector('.char-fill-btn');
            fillBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                applyCharacter(ch.id, true);
                closeModal();
            });
            pagesGridEl.appendChild(card);
        }
    }

    function openCharacterPicker() {
        buildCharacterGrid();
        openModal(pagesModalEl);
    }

    /* ============ DEFAULT GROODLES (starter library) ============

       Pre-made character templates the kid can pick as a starting
       point. Same idiom as drawSurprise() but instead of one goofy
       random output, this is a curated library of identifiable
       characters with matching pose + background + hat.

       Each entry:
         id     stable string, used in achievements + analytics later
         label  display name
         emoji  for the starter card thumbnail
         pose   POSES key — applied before painting so the canvas clip
                matches the new silhouette
         bg     bg-* class suffix (studio, disco, outdoors, …)
         hat    HATS id — equipped via equipHat()
         color  first-pick palette color the kid lands on after the
                starter applies (so they're already holding a
                character-appropriate pen)
         draw(c) paints the body / face / outfit onto the canvas
                context (already cleared + clipped by the time it's
                called). Coords are logical 400×600; lines outside the
                silhouette are trimmed by the ctx.clip in buildCanvas. */

    /* Shared body landmarks for the prefab artwork (DEFAULT_GROODLES +
       drawSurprise). The figure outline is generated from SK + the
       standing skeleton; these anchors describe WHERE on that outline
       faces / costumes should land so the prefabs track the frame
       instead of hard-coding coordinates tuned to an older shape.
       If the frame changes again, retune here once — not in every
       prefab. (Costume bands are full-width fillRects; the canvas clip
       trims them to whatever pose silhouette is active, so only their
       vertical extents matter.) */
    const BODY = {
        /* Re-derived from the paper-doll rig at scale 1.0 (2026-08-19), which
           is Onion's original drawing at full size. cx stays 200 -- the BODY
           is centered there -- but note the HEAD sits at x=207, because she
           drew it slightly off the body's axis. That is why HEAD_CROWN_X is
           207 and not cx. */
        cx: 200,
        headCy: 83, headR: 58, headTop: 35,
        eyeY: 77, eyeDX: 18,          // eyes at cx +/- eyeDX
        browY: 59,
        mouthY: 101,
        cheekY: 105, cheekDX: 30,
        hairTipY: 29, hairBaseY: 57,  // crown tuft band
        neckY: 149,
        shirtTop: 178, shirtBot: 306, // torso band (shoulder -> hip)
        chestY: 230,
        waistY: 300,
        pantsTop: 300, pantsBot: 600, // legs band
        bootY: 545,
        handY: 400                    // standing hand height
    };

    const DEFAULT_GROODLES = [
        {
            id: 'astronaut-bo',
            label: 'Astronaut Bo',
            emoji: '🚀',
            pose: 'standing',
            bg: 'stadium',
            hat: 'rocket-ship',
            color: '#1d3557',
            draw: (c) => {
                /* White suit base. */
                c.fillStyle = '#ececf4';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Navy chest panel. */
                c.fillStyle = '#1d3557';
                c.fillRect(0, BODY.shirtTop + 40, STAGE_W, 80);
                /* Visor: rounded teal band across the eyes. */
                c.fillStyle = '#43aa8b';
                c.beginPath();
                const vy = BODY.eyeY - 18;
                c.roundRect ? c.roundRect(150, vy, 100, 40, 16) :
                    (c.fillRect(150, vy, 100, 40));
                c.fill();
                /* Visor reflection highlight. */
                c.fillStyle = 'rgba(255, 255, 255, 0.45)';
                c.beginPath(); c.roundRect ? c.roundRect(158, vy + 6, 18, 8, 4) :
                    c.fillRect(158, vy + 6, 18, 8); c.fill();
                /* Smile just under the visor. */
                c.strokeStyle = '#1a0f33';
                c.lineWidth = 4;
                c.lineCap = 'round';
                c.beginPath();
                c.arc(BODY.cx, BODY.mouthY + 6, 13, 0.15 * Math.PI, 0.85 * Math.PI);
                c.stroke();
                /* Mission patch — red circle with white star on chest. */
                c.fillStyle = '#e63946';
                c.beginPath(); c.arc(BODY.cx, BODY.chestY, 18, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#fff';
                c.font = 'bold 22px monospace';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('★', BODY.cx, BODY.chestY + 2);
                /* Glove cuffs at the hands (standing arms hang ~hip level). */
                c.fillStyle = '#e63946';
                c.fillRect(132, BODY.handY - 6, 34, 15);
                c.fillRect(234, BODY.handY - 6, 34, 15);
                /* Boot tops at the feet. */
                c.fillRect(146, BODY.bootY, 46, 18);
                c.fillRect(208, BODY.bootY, 46, 18);
            }
        },
        {
            id: 'rockstar-daisy',
            label: 'Rockstar Daisy',
            emoji: '🎸',
            pose: 'groovy',
            bg: 'stadium',
            hat: 'funky-fresh',
            color: '#e63946',
            draw: (c) => {
                /* Skin tone fill across the silhouette. */
                c.fillStyle = '#f4a261';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Leather jacket — black across the torso. */
                c.fillStyle = '#1a0f33';
                c.fillRect(0, BODY.shirtTop, STAGE_W, BODY.waistY - BODY.shirtTop);
                /* Hot-pink jeans. */
                c.fillStyle = '#ff6ec7';
                c.fillRect(0, BODY.waistY - 8, STAGE_W, BODY.pantsBot);
                /* Tank top peek — magenta V neckline. */
                c.fillStyle = '#e63946';
                c.beginPath();
                c.moveTo(BODY.cx - 25, BODY.shirtTop);
                c.lineTo(BODY.cx, BODY.shirtTop + 64);
                c.lineTo(BODY.cx + 25, BODY.shirtTop);
                c.closePath();
                c.fill();
                /* Star sunglasses over the eyes. */
                c.fillStyle = '#1a0f33';
                for (let i = 0; i < 2; i++) {
                    const cx = BODY.cx + (i === 0 ? -BODY.eyeDX : BODY.eyeDX);
                    c.beginPath();
                    for (let k = 0; k < 10; k++) {
                        const a = k * Math.PI / 5 - Math.PI / 2;
                        const rr = k % 2 === 0 ? 11 : 5;
                        const x = cx + Math.cos(a) * rr;
                        const y = BODY.eyeY + Math.sin(a) * rr;
                        if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
                    }
                    c.closePath();
                    c.fill();
                }
                /* Open-mouth singing 'O'. */
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.arc(BODY.cx, BODY.mouthY, 8, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#e63946';
                c.beginPath(); c.arc(BODY.cx, BODY.mouthY, 5, 0, Math.PI * 2); c.fill();
            }
        },
        {
            id: 'disco-king',
            label: 'Disco King',
            emoji: '🪩',
            pose: 'groovy',
            bg: 'disco',
            hat: 'cool-kids',
            color: '#ffd23f',
            draw: (c) => {
                /* Sparkly gold suit. */
                c.fillStyle = '#ffd23f';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* White lapels — diagonal triangles from the neck. */
                c.fillStyle = '#fff';
                const lT = BODY.shirtTop + 6, lB = lT + 120;
                c.beginPath();
                c.moveTo(BODY.cx - 25, lT);
                c.lineTo(BODY.cx - 45, lB);
                c.lineTo(BODY.cx, lT + 56);
                c.closePath();
                c.fill();
                c.beginPath();
                c.moveTo(BODY.cx + 25, lT);
                c.lineTo(BODY.cx + 45, lB);
                c.lineTo(BODY.cx, lT + 56);
                c.closePath();
                c.fill();
                /* Disco-ball sequins scattered down the suit. */
                c.fillStyle = '#fff';
                for (let i = 0; i < 14; i++) {
                    const sy = BODY.shirtTop + 30 + i * 34;
                    const sx = BODY.cx + (i % 2 === 0 ? -22 : 22) + (i % 3 - 1) * 6;
                    c.beginPath();
                    c.arc(sx, sy, 4, 0, Math.PI * 2);
                    c.fill();
                }
                /* Confident half-smile. */
                c.strokeStyle = '#1a0f33';
                c.lineWidth = 4;
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(BODY.cx - 20, BODY.mouthY);
                c.bezierCurveTo(BODY.cx - 5, BODY.mouthY + 10,
                                BODY.cx + 15, BODY.mouthY + 10,
                                BODY.cx + 25, BODY.mouthY - 5);
                c.stroke();
                /* Skin patch behind the cool-kids sunglasses (eyes are
                   hidden under the hat + shades). */
                c.fillStyle = '#f4a261';
                c.fillRect(BODY.cx - 40, BODY.eyeY - 14, 80, 26);
            }
        },
        {
            id: 'pirate-pip',
            label: 'Pirate Pip',
            emoji: '🏴‍☠️',
            pose: 'standing',
            bg: 'underwater',
            hat: 'no-hat',
            color: '#6f4e37',
            draw: (c) => {
                /* Skin tone across the figure. */
                c.fillStyle = '#fcbf49';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Red-and-white horizontal-stripe shirt across the torso. */
                const stripeH = (BODY.waistY - BODY.shirtTop) / 6;
                for (let i = 0; i < 6; i++) {
                    c.fillStyle = (i % 2 === 0) ? '#e63946' : '#fff';
                    c.fillRect(0, BODY.shirtTop + i * stripeH, STAGE_W, stripeH + 1);
                }
                /* Brown pants. */
                c.fillStyle = '#6f4e37';
                c.fillRect(0, BODY.waistY, STAGE_W, BODY.pantsBot);
                /* Belt + buckle. */
                c.fillStyle = '#1a0f33';
                c.fillRect(0, BODY.waistY - 6, STAGE_W, 18);
                c.fillStyle = '#ffd23f';
                c.fillRect(BODY.cx - 10, BODY.waistY - 3, 20, 12);
                /* Red bandana across the head crown. */
                c.fillStyle = '#e63946';
                c.fillRect(142, BODY.headTop + 12, 116, 26);
                /* Eyepatch over the right eye + strap. */
                c.fillStyle = '#1a0f33';
                c.fillRect(BODY.cx + 8, BODY.eyeY - 9, 24, 19);
                c.lineWidth = 3;
                c.strokeStyle = '#1a0f33';
                c.beginPath();
                c.moveTo(BODY.cx + 8, BODY.eyeY - 3); c.lineTo(165, BODY.eyeY - 12); c.stroke();
                c.beginPath();
                c.moveTo(BODY.cx + 32, BODY.eyeY); c.lineTo(258, BODY.eyeY - 10); c.stroke();
                /* Left eye + tiny grin. */
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.arc(BODY.cx - BODY.eyeDX, BODY.eyeY, 5, 0, Math.PI * 2); c.fill();
                c.beginPath();
                c.arc(BODY.cx, BODY.mouthY + 4, 12, 0.2 * Math.PI, 0.8 * Math.PI);
                c.lineWidth = 4;
                c.stroke();
            }
        },
        {
            id: 'princess-lily',
            label: 'Princess Lily',
            emoji: '👑',
            pose: 'star',
            bg: 'candy',
            hat: 'candy-bowl',
            color: '#ff6ec7',
            draw: (c) => {
                /* Soft skin fill. */
                c.fillStyle = '#fcbf49';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Pink ball gown across torso + legs. */
                c.fillStyle = '#ff6ec7';
                c.fillRect(0, BODY.shirtTop, STAGE_W, BODY.pantsBot);
                /* Lighter pink dress overlay band at the waist. */
                c.fillStyle = '#ffc1e3';
                c.fillRect(0, BODY.chestY + 30, STAGE_W, 64);
                /* Gold trim at the dress neckline. */
                c.fillStyle = '#ffd23f';
                const nT = BODY.shirtTop;
                c.beginPath();
                c.moveTo(BODY.cx - 30, nT);
                c.lineTo(BODY.cx, nT + 36);
                c.lineTo(BODY.cx + 30, nT);
                c.lineTo(BODY.cx + 30, nT + 10);
                c.lineTo(BODY.cx, nT + 46);
                c.lineTo(BODY.cx - 30, nT + 10);
                c.closePath();
                c.fill();
                /* Almond eyes with eyelashes. */
                c.fillStyle = '#1a0f33';
                c.beginPath(); c.ellipse(BODY.cx - BODY.eyeDX, BODY.eyeY, 7, 5, 0, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.ellipse(BODY.cx + BODY.eyeDX, BODY.eyeY, 7, 5, 0, 0, Math.PI * 2); c.fill();
                c.lineWidth = 2;
                c.strokeStyle = '#1a0f33';
                c.beginPath(); c.moveTo(BODY.cx - BODY.eyeDX - 6, BODY.eyeY - 5); c.lineTo(BODY.cx - BODY.eyeDX - 10, BODY.eyeY - 10); c.stroke();
                c.beginPath(); c.moveTo(BODY.cx + BODY.eyeDX + 6, BODY.eyeY - 5); c.lineTo(BODY.cx + BODY.eyeDX + 10, BODY.eyeY - 10); c.stroke();
                /* Heart-shaped lips. */
                c.fillStyle = '#e63946';
                const my = BODY.mouthY;
                c.beginPath();
                c.moveTo(BODY.cx, my);
                c.bezierCurveTo(BODY.cx - 8, my - 12, BODY.cx - 12, my, BODY.cx, my + 10);
                c.bezierCurveTo(BODY.cx + 12, my, BODY.cx + 8, my - 12, BODY.cx, my);
                c.fill();
                /* Rosy cheeks. */
                c.fillStyle = 'rgba(230, 57, 70, 0.45)';
                c.beginPath(); c.arc(BODY.cx - BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.arc(BODY.cx + BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); c.fill();
            }
        },
        {
            id: 'robo-9000',
            label: 'Robo-9000',
            emoji: '🤖',
            pose: 'standing',
            bg: 'outdoors',
            hat: 'circuit-board',
            color: '#43aa8b',
            draw: (c) => {
                /* Metallic gray body. */
                c.fillStyle = '#c0c5d0';
                c.fillRect(0, 0, STAGE_W, STAGE_H);
                /* Darker chest panel. */
                c.fillStyle = '#5a6478';
                c.fillRect(0, BODY.shirtTop + 10, STAGE_W, 150);
                /* Waist belt. No center leg-seam any more — the legs are
                   two separate shapes now, so a center bar would float
                   in the gap between them. */
                c.fillStyle = '#1a0f33';
                c.fillRect(0, BODY.waistY - 4, STAGE_W, 12);
                /* Square LED eyes — teal. */
                c.fillStyle = '#43aa8b';
                c.fillRect(BODY.cx - BODY.eyeDX - 9, BODY.eyeY - 9, 18, 18);
                c.fillRect(BODY.cx + BODY.eyeDX - 9, BODY.eyeY - 9, 18, 18);
                /* Eye glow squares (inner). */
                c.fillStyle = '#ffffff';
                c.fillRect(BODY.cx - BODY.eyeDX - 3, BODY.eyeY - 3, 6, 6);
                c.fillRect(BODY.cx + BODY.eyeDX - 3, BODY.eyeY - 3, 6, 6);
                /* Speaker grill / mouth — 3 horizontal lines. */
                c.strokeStyle = '#1a0f33';
                c.lineWidth = 3;
                for (let i = 0; i < 3; i++) {
                    const gy = BODY.mouthY + i * 8;
                    c.beginPath(); c.moveTo(BODY.cx - 20, gy); c.lineTo(BODY.cx + 20, gy); c.stroke();
                }
                /* Three control-panel buttons on the chest. */
                const btns = [['#e63946', -16], ['#ffd23f', 0], ['#43aa8b', 16]];
                for (let i = 0; i < btns.length; i++) {
                    c.fillStyle = btns[i][0];
                    c.beginPath();
                    c.arc(BODY.cx + btns[i][1], BODY.chestY - 14, 7, 0, Math.PI * 2);
                    c.fill();
                }
                /* Chest readout — small LCD rectangle. */
                c.fillStyle = '#1a0f33';
                c.fillRect(BODY.cx - 30, BODY.chestY + 6, 60, 24);
                c.fillStyle = '#43aa8b';
                c.font = 'bold 14px monospace';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('OK', BODY.cx, BODY.chestY + 19);
            }
        }
    ];

    const DEFAULT_GROODLE_BY_ID = {};
    DEFAULT_GROODLES.forEach(d => { DEFAULT_GROODLE_BY_ID[d.id] = d; });

    /* ============ CHARACTERS (unified tray) ============

       One roster, one picker. Each character has BOTH an `outline`
       (navy line-art the kid colors in — the old "page") and a
       `filled` (pre-colored + pose/bg/hat — the old "prefab
       Groodle"). The picker shows one card per character: tapping it
       loads the color-it-yourself outline; the card's 🎨 button
       loads the done-for-you version. This collapses the old separate
       Pages modal + New-drawer starter grid into a single mental
       model ("pick a character, optionally have it colored for you").

       4 characters reuse the existing page outline + prefab fill
       as-is; clown/superhero gain a compact `filled`, rockstar/disco
       gain a compact `outline`, so every card supports both modes and
       no prior content is lost. Completion (DANCE while a character is
       loaded) still keys off the same ids the page-* achievements
       check, so the achievement catalog is unchanged. */

    const OUTLINE = {};
    PAGES.forEach(p => { OUTLINE[p.id] = p.draw; });

    function strokeKit(c) {
        c.save();
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.fillStyle = '#1a0f33';
        return BODY;
    }

    /* --- compact missing halves --- */

    function clownFilled(c) {
        c.fillStyle = '#fcbf49'; c.fillRect(0, 0, STAGE_W, STAGE_H);
        c.fillStyle = '#43aa8b'; c.fillRect(0, BODY.shirtTop, STAGE_W, BODY.waistY - BODY.shirtTop);
        c.fillStyle = '#ff6ec7'; c.fillRect(0, BODY.waistY - 6, STAGE_W, BODY.pantsBot);
        /* polka dots */
        c.fillStyle = '#fff';
        for (let i = 0; i < 7; i++) {
            const dy = BODY.shirtTop + 28 + i * 22;
            const dx = BODY.cx + (i % 2 ? 22 : -22) + (i % 3 - 1) * 8;
            c.beginPath(); c.arc(dx, dy, 7, 0, Math.PI * 2); c.fill();
        }
        /* red nose, eyes, big smile */
        c.fillStyle = '#e63946';
        c.beginPath(); c.arc(BODY.cx, BODY.mouthY - 4, 14, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1a0f33';
        c.beginPath(); c.arc(BODY.cx - BODY.eyeDX, BODY.eyeY, 5, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(BODY.cx + BODY.eyeDX, BODY.eyeY, 5, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#e63946'; c.lineWidth = 5; c.lineCap = 'round';
        c.beginPath(); c.arc(BODY.cx, BODY.mouthY + 12, 24, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    }

    function superheroFilled(c) {
        c.fillStyle = '#43aa8b'; c.fillRect(0, 0, STAGE_W, STAGE_H);
        c.fillStyle = '#1d3557'; c.fillRect(0, BODY.waistY - 6, STAGE_W, BODY.pantsBot);
        c.fillStyle = '#ffd23f'; c.fillRect(0, BODY.waistY - 8, STAGE_W, 16);
        /* chest star */
        c.fillStyle = '#ffd23f';
        c.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = i * Math.PI / 5 - Math.PI / 2;
            const rr = i % 2 === 0 ? 26 : 11;
            const x = BODY.cx + Math.cos(a) * rr, y = BODY.chestY + Math.sin(a) * rr;
            if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.closePath(); c.fill();
        /* mask + eyes + grin */
        c.fillStyle = '#1a0f33';
        c.fillRect(BODY.cx - 38, BODY.eyeY - 12, 76, 22);
        c.fillStyle = '#fff';
        c.beginPath(); c.ellipse(BODY.cx - BODY.eyeDX, BODY.eyeY, 8, 6, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(BODY.cx + BODY.eyeDX, BODY.eyeY, 8, 6, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#1a0f33'; c.lineWidth = 4; c.lineCap = 'round';
        c.beginPath(); c.arc(BODY.cx, BODY.mouthY + 6, 13, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    }

    function rockstarOutline(c) {
        const B = strokeKit(c);
        /* spiky hair */
        c.beginPath();
        for (let i = 0; i <= 6; i++) {
            const x = B.cx - 36 + i * 12;
            c.moveTo(x, B.headTop + 22); c.lineTo(x + 4, B.headTop + 2);
        }
        c.stroke();
        /* star shades */
        for (let s = 0; s < 2; s++) {
            const sx = B.cx + (s ? B.eyeDX : -B.eyeDX);
            c.beginPath();
            for (let k = 0; k < 10; k++) {
                const a = k * Math.PI / 5 - Math.PI / 2;
                const rr = k % 2 === 0 ? 10 : 4;
                const x = sx + Math.cos(a) * rr, y = B.eyeY + Math.sin(a) * rr;
                if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
            c.closePath(); c.stroke();
        }
        /* open singing mouth + jacket lapels */
        c.beginPath(); c.arc(B.cx, B.mouthY, 7, 0, Math.PI * 2); c.stroke();
        c.beginPath();
        c.moveTo(B.cx - 26, B.shirtTop); c.lineTo(B.cx, B.shirtTop + 56); c.lineTo(B.cx + 26, B.shirtTop);
        c.stroke();
        c.strokeRect(B.cx - 45, B.waistY - 8, 90, 16);
        c.restore();
    }

    function discoOutline(c) {
        const B = strokeKit(c);
        /* lapels + sequin dots */
        c.beginPath();
        c.moveTo(B.cx - 26, B.shirtTop); c.lineTo(B.cx - 44, B.chestY); c.lineTo(B.cx, B.shirtTop + 54);
        c.moveTo(B.cx + 26, B.shirtTop); c.lineTo(B.cx + 44, B.chestY); c.lineTo(B.cx, B.shirtTop + 54);
        c.stroke();
        for (let i = 0; i < 10; i++) {
            const sy = B.shirtTop + 30 + i * 30;
            const sx = B.cx + (i % 2 ? 20 : -20);
            c.beginPath(); c.arc(sx, sy, 4, 0, Math.PI * 2); c.stroke();
        }
        /* shades + half-smile */
        c.fillRect(B.cx - 32, B.eyeY - 8, 64, 16);
        c.beginPath();
        c.moveTo(B.cx - 18, B.mouthY);
        c.bezierCurveTo(B.cx - 4, B.mouthY + 9, B.cx + 14, B.mouthY + 9, B.cx + 22, B.mouthY - 5);
        c.stroke();
        c.restore();
    }

    const CHARACTERS = [
        { id: 'robot',     label: 'Robot',     emoji: '🤖',
          outline: OUTLINE.robot,     filled: DEFAULT_GROODLE_BY_ID['robo-9000'] },
        { id: 'princess',  label: 'Princess',  emoji: '👑',
          outline: OUTLINE.princess,  filled: DEFAULT_GROODLE_BY_ID['princess-lily'] },
        { id: 'astronaut', label: 'Astronaut', emoji: '🚀',
          outline: OUTLINE.astronaut, filled: DEFAULT_GROODLE_BY_ID['astronaut-bo'] },
        { id: 'pirate',    label: 'Pirate',    emoji: '🏴‍☠️',
          outline: OUTLINE.pirate,    filled: DEFAULT_GROODLE_BY_ID['pirate-pip'] },
        { id: 'clown',     label: 'Clown',     emoji: '🤡',
          outline: OUTLINE.clown,
          filled: { draw: clownFilled, pose: 'standing', bg: 'candy', hat: 'no-hat', color: '#e63946' } },
        { id: 'superhero', label: 'Superhero', emoji: '🦸',
          outline: OUTLINE.superhero,
          filled: { draw: superheroFilled, pose: 'cheer', bg: 'stadium', hat: 'no-hat', color: '#ffd23f' } },
        { id: 'rockstar',  label: 'Rockstar',  emoji: '🎸',
          outline: rockstarOutline,
          filled: DEFAULT_GROODLE_BY_ID['rockstar-daisy'] },
        { id: 'disco',     label: 'Disco King', emoji: '🪩',
          outline: discoOutline,
          filled: DEFAULT_GROODLE_BY_ID['disco-king'] }
    ];
    const CHARACTER_BY_ID = {};
    CHARACTERS.forEach(ch => { CHARACTER_BY_ID[ch.id] = ch; });

    /* (The old applyDefaultGroodle / buildStarterGrid lived here. The
       prefab "starter" path is now folded into the unified CHARACTERS
       picker — applyFilled() above does the pose/bg/hat/color+paint;
       DEFAULT_GROODLES is still the art source via CHARACTER.filled.) */

    /* ============ GROODLE EXPORT (shared by the gallery) ============

       Renders the finished creature to a PNG blob. Used by the
       on-device gallery below; kept separate from it so any future
       "save to photos / share sheet" path can reuse the same compose.

       Compose strategy: the offscreen export canvas is painted from the
       same primitives the game uses on screen — buildBodyPath + the
       in-stage draw canvas + a stroked outline ring — instead of
       serializing SVG with embedded sprite refs. This sidesteps the
       cross-origin / blob-relative-path issues SVG serialization runs
       into and keeps the export tiny.

       NOTE: there is deliberately NO network gallery. A public,
       anonymous-upload gallery was removed in favour of a purely
       on-device one — see the LOCAL GALLERY block below for why. */
    /* Render the whole creature to an offscreen 800×1200 (DPR-2) PNG.
       Background is left transparent — the gallery card frames each
       Groodle on its own neutral surface so background presets don't
       compete with one another in the grid. */
    /* Hat sprite, fetched once and cached as a data URL. Inlined into
       the serialised hat layer for export so the sheet is same-origin
       embedded — otherwise the SVG-as-image taints the export canvas
       and toBlob() throws. */
    let _hatSheetDataUrl = null;
    function getHatSheetDataUrl() {
        if (_hatSheetDataUrl) return Promise.resolve(_hatSheetDataUrl);
        return fetch(HAT_SHEET_URL).then(function (r) { return r.blob(); })
            .then(function (b) {
                return new Promise(function (res, rej) {
                    const fr = new FileReader();
                    fr.onload = function () { _hatSheetDataUrl = fr.result; res(_hatSheetDataUrl); };
                    fr.onerror = function () { rej(fr.error); };
                    fr.readAsDataURL(b);
                });
            });
    }

    /* Rasterise one .creature deco layer's inner markup (authored in
       the shared 0..400 / 0..600 space) onto the export context, at the
       same scale as the body. Wrapped in a self-contained SVG (explicit
       xmlns + size) so it loads as an Image. Empty layer / load error
       -> no-op so a save never fails on a missing piece. */
    function rasterizeDecoLayer(innerHTML, c) {
        if (!innerHTML || !innerHTML.trim()) return Promise.resolve();
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"' +
            ' xmlns:xlink="http://www.w3.org/1999/xlink"' +
            ' viewBox="0 0 ' + STAGE_W + ' ' + STAGE_H + '"' +
            ' width="' + STAGE_W + '" height="' + STAGE_H + '">' + innerHTML + '</svg>';
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        return new Promise(function (resolve) {
            const img = new Image();
            img.onload = function () {
                try { c.drawImage(img, 0, 0, STAGE_W, STAGE_H); } catch (e) {}
                URL.revokeObjectURL(url);
                resolve();
            };
            img.onerror = function () { URL.revokeObjectURL(url); resolve(); };
            img.src = url;
        });
    }

    function composeGroodleBlob() {
        if (!ctx) return Promise.resolve(null);
        const out = document.createElement('canvas');
        out.width = STAGE_W * 2;
        out.height = STAGE_H * 2;
        const c = out.getContext('2d');
        c.scale(2, 2);
        c.lineCap = 'round'; c.lineJoin = 'round';
        const body = buildBodyPath();
        /* Pale interior wash — always the base (and the fallback if a
           pattern raster fails). */
        c.save();
        c.fillStyle = 'rgba(232, 232, 244, 0.94)';
        c.fill(body);
        c.restore();
        /* Active fill pattern, over the wash, clipped to the body —
           reuses the live #patternDefs tiles (userSpaceOnUse, so they
           tile identically to the screen) and the current pose's
           silhouette as the window. Async (rasterised like the deco
           layers) so it must resolve BEFORE strokes/outline go on top. */
        const patFill = patternFillEl && patternFillEl.getAttribute('fill');
        const interior = (currentPattern && patFill && patFill !== 'none' && patternDefsEl)
            ? rasterizeDecoLayer(
                '<defs>' + patternDefsEl.innerHTML + '</defs>' +
                '<clipPath id="expPatWin"><path d="' + posePathD(getCurrentPose()) + '"/></clipPath>' +
                '<rect x="0" y="0" width="' + STAGE_W + '" height="' + STAGE_H +
                '" clip-path="url(#expPatWin)" fill="' + patFill + '"/>', c)
            : Promise.resolve();
        return interior
            .then(function () {
                /* The kid's strokes (the live canvas is already clipped
                   to the silhouette, so this doesn't paint outside). */
                c.drawImage(canvas, 0, 0, STAGE_W, STAGE_H);
                /* Inner outline ring — stroked along the body path. */
                c.save();
                c.strokeStyle = '#1a0f33';
                c.lineWidth = 5;
                c.stroke(body);
                c.restore();
            })
            /* Deco layers on top, in the SAME z-order as .creature:
               face-parts (z3) -> hat (z4) -> accessory (z5). Sequenced
               so draw order is preserved; the hat sprite href is swapped
               to an inlined data URL so the export canvas never taints. */
            .then(function () {
                return rasterizeDecoLayer(facePartsInnerEl && facePartsInnerEl.innerHTML, c);
            })
            .then(function () {
                const hm = hatLayerInnerEl && hatLayerInnerEl.innerHTML;
                if (!hm || !hm.trim()) return;
                return getHatSheetDataUrl()
                    .then(function (durl) { return rasterizeDecoLayer(hm.split(HAT_SHEET_URL).join(durl), c); })
                    .catch(function () {});   // hat sprite unavailable -> save the rest
            })
            .then(function () {
                return rasterizeDecoLayer(accessoryLayerInnerEl && accessoryLayerInnerEl.innerHTML, c);
            })
            .then(function () {
                return new Promise(function (resolve) { out.toBlob(resolve, 'image/png'); });
            });
    }

    let galleryModalEl = null;
    let galleryGridEl = null;

    /* ============ ON-DEVICE GALLERY ============

       The ONLY gallery. SAVE composes the PNG and writes it to
       IndexedDB on this device; the Gallery modal reads it back.
       Nothing ever leaves the device — no uploads, no accounts, no
       other users' content, no network call of any kind.

       This is deliberate, and it is the same on web and in the
       Capacitor app:

       - Play Store age rating: any user-content sharing / network
         gallery pushes the app into a higher age band and pulls in
         COPPA scrutiny. An on-device gallery keeps the Data Safety
         form at "no data collected", which is the Madderverse promise
         anyway.
       - A public bucket taking anonymous uploads from a kids' site is
         a moderation burden and an abuse target with no upside.

       Do not reintroduce a network gallery. If sharing is ever wanted,
       the right shape is an explicit parent-driven export (share sheet
       / download), not a shared public feed. */

    const IDB_NAME = 'groodle-gallery';
    const IDB_STORE = 'creations';

    function idbOpen() {
        return new Promise(function (res, rej) {
            let r;
            try { r = indexedDB.open(IDB_NAME, 1); } catch (e) { rej(e); return; }
            r.onupgradeneeded = function () {
                const db = r.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
                }
            };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error); };
        });
    }

    function idbTx(mode, fn) {
        return idbOpen().then(function (db) {
            return new Promise(function (res, rej) {
                const tx = db.transaction(IDB_STORE, mode);
                const store = tx.objectStore(IDB_STORE);
                let out;
                Promise.resolve(fn(store)).then(function (v) { out = v; });
                tx.oncomplete = function () { res(out); };
                tx.onerror = function () { rej(tx.error); };
                tx.onabort = function () { rej(tx.error); };
            });
        });
    }

    function idbSaveGroodle(blob) {
        return idbTx('readwrite', function (store) {
            return new Promise(function (res) {
                const req = store.add({ blob: blob, createdAt: Date.now() });
                req.onsuccess = function () { res(req.result); };
            });
        });
    }

    function idbAllGroodles() {
        return idbTx('readonly', function (store) {
            return new Promise(function (res) {
                const req = store.getAll();
                req.onsuccess = function () {
                    res((req.result || []).sort(function (a, b) { return b.createdAt - a.createdAt; }));
                };
            });
        });
    }

    function idbDeleteGroodle(id) {
        return idbTx('readwrite', function (store) { store.delete(id); });
    }

    /* Tiny transient toast (no public name dialog in app mode — SAVE is
       one tap → confirmation). */
    function flashToast(msg) {
        let t = document.getElementById('groodleToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'groodleToast';
            t.className = 'groodle-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._hideTimer);
        t._hideTimer = setTimeout(function () { t.classList.remove('show'); }, 1600);
    }

    function saveGroodleLocal() {
        composeGroodleBlob().then(function (blob) {
            if (!blob) { flashToast('Could not save — try again.'); return; }
            return idbSaveGroodle(blob).then(function () {
                flashToast('Saved to your gallery! 🎨');
            });
        }).catch(function () { flashToast('Could not save — try again.'); });
    }

    function openLocalGallery() {
        if (!galleryModalEl) return;
        openModal(galleryModalEl);
        /* Private, on-device wording — never "around the world" (that
           implies the very public/social feature we're avoiding for the
           age rating). */
        const gs = document.getElementById('galleryStats');
        if (gs) gs.textContent = 'Your Groodles — saved on this device';
        if (galleryGridEl) galleryGridEl.innerHTML = '<div class="gallery-empty">Loading…</div>';
        idbAllGroodles().then(function (items) {
            if (!galleryGridEl) return;
            if (!items.length) {
                galleryGridEl.innerHTML =
                    '<div class="gallery-empty">No Groodles yet!<br>' +
                    'Make one, then tap 💾 Save.</div>';
                return;
            }
            galleryGridEl.innerHTML = '';
            items.forEach(function (it) {
                const url = URL.createObjectURL(it.blob);
                const card = document.createElement('div');
                card.className = 'gallery-card';
                card.innerHTML =
                    '<img class="gallery-img" src="' + url + '" alt="Your Groodle" loading="lazy"/>' +
                    '<button class="gallery-del" type="button" aria-label="Delete this Groodle">🗑️</button>';
                const del = card.querySelector('.gallery-del');
                del.addEventListener('click', function () {
                    /* Two-tap confirm so a kid can't wipe it by accident. */
                    if (del._armed) {
                        idbDeleteGroodle(it.id).then(function () {
                            URL.revokeObjectURL(url);
                            openLocalGallery();
                        });
                        return;
                    }
                    del._armed = true;
                    del.textContent = 'Delete?';
                    del.classList.add('confirm');
                    setTimeout(function () {
                        if (del._armed) {
                            del._armed = false;
                            del.textContent = '🗑️';
                            del.classList.remove('confirm');
                        }
                    }, 2500);
                });
                galleryGridEl.appendChild(card);
            });
        }).catch(function () {
            if (galleryGridEl) galleryGridEl.innerHTML =
                '<div class="gallery-empty">Could not load your gallery.</div>';
        });
    }

    /* ============ STATE ============ */

    let currentColor = '#000000';
    let currentSize = 12;
    let isErasing = false;
    let isDrawing = false;
    let lastX = 0, lastY = 0;

    let canvas = null;
    let ctx = null;
    let creature = null;
    /* DOM elements touched on every dance frame are looked up once at init.
       Repeating getElementById per RAF is two extra DOM tree walks per
       frame and shows up under DevTools profiling on slower phones. */
    let floorEl = null;
    let bubbleEl = null;
    /* The dance dock (the floating bottom bar with the STOP button) ships
       with the `hidden` attribute on its HTML so it doesn't flash on
       first paint. CSS `[hidden] { display: none !important }` keeps it
       hidden — startDance/stopDance toggle this flag so the dock can
       appear during dance. Looked up once at init to avoid an extra DOM
       query each time the kid taps Dance. */
    let danceDockEl = null;
    /* Face-zoom: a focused "draw the face big" mode. Magnifies #creature
       about the head so little hands can do fine detail; getPos() keys
       off the live canvas rect so the zoom (a uniform translate+scale)
       needs no pointer-math change. Mutually exclusive with dance (both
       drive creature.style.transform). */
    let stageEl = null;
    let faceZoomBtnEl = null;
    let faceZoomed = false;
    const FACE_ZOOM_SCALE = 2.45;
    /* Canvas bounding rect is cached for the duration of a stroke. Reading
       getBoundingClientRect on every pointermove forces a layout pass; the
       rect can only change on scroll/resize/zoom, and a pointer capture
       guarantees those don't happen mid-stroke. */
    let cachedRect = null;

    let isPlaying = false;
    let currentMoveIdx = 0;
    let currentBeatIdx = 0;
    let danceStartTime = 0;

    /* ============ AUDIO ============ */

    let audioCtx = null;
    let masterGain = null;
    let schedTimer = null;
    let nextNoteTime = 0;
    let currentStep = 0;
    let currentBar = 0;

    const SCHEDULE_AHEAD = 0.1;
    const LOOKAHEAD_MS = 25;

    function ensureAudio() {
        if (audioCtx) return;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctor();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.7;
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
        masterGain.connect(comp);
        comp.connect(audioCtx.destination);
    }

    function startAudio() {
        ensureAudio();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        currentStep = 0;
        currentBar = 0;
        nextNoteTime = audioCtx.currentTime + 0.06;
        if (schedTimer) clearInterval(schedTimer);
        schedTimer = setInterval(scheduler, LOOKAHEAD_MS);
    }

    function stopAudio() {
        if (schedTimer) {
            clearInterval(schedTimer);
            schedTimer = null;
        }
    }

    function scheduler() {
        while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
            scheduleStep(currentStep, currentBar, nextNoteTime);
            nextNoteTime += SECONDS_PER_STEP;
            currentStep++;
            if (currentStep >= STEPS_PER_BAR) {
                currentStep = 0;
                currentBar = (currentBar + 1) % BARS_PER_LOOP;
            }
        }
    }

    function scheduleStep(step, bar, when) {
        const beat = BEATS[currentBeatIdx];
        const move = MOVES[currentMoveIdx];

        if (beat === 'BOOM') {
            if (step % 4 === 0) kick(when);
            if (step === 4 || step === 12) snare(when);
            if (step % 2 === 0) hat(when, 0.28);
        } else if (beat === 'FUNKY') {
            if (step === 0 || step === 6 || step === 10) kick(when);
            if (step === 4 || step === 12) snare(when);
            if (step % 2 === 1) hat(when, 0.32);
            if (step === 14) hat(when, 0.5);
        } else if (beat === 'SHUFFLE') {
            if (step % 4 === 0) kick(when, 0.7);
            if (step === 4 || step === 12) snare(when);
            if ([0, 3, 4, 7, 8, 11, 12, 15].indexOf(step) !== -1) hat(when, 0.25);
        } else if (beat === 'WILD') {
            if (step === 0 || step === 5 || step === 10 || step === 14) kick(when);
            if (step === 7 || step === 12) snare(when);
            if (step % 2 === 0) hat(when, 0.28);
            if (step === 3 || step === 11) hat(when, 0.55);
        }

        if (move !== 'BOUNCE' && step % 4 === 0) {
            const root = [60, 65, 67, 60][bar % 4];
            const note = (step === 8) ? root + 7 : root;
            bass(when, midiToFreq(note - 24));
        }

        if (move === 'DISCO' || move === 'PARTY') {
            if ((bar === 1 || bar === 3) && step === 0) {
                const root = [60, 65, 67, 60][bar % 4];
                const phrase = [root, root + 4, root + 7, root + 12];
                phrase.forEach((n, i) => lead(when + i * SECONDS_PER_STEP * 2, midiToFreq(n)));
            }
        }
        if (move === 'PARTY' && step === 8) {
            const root = [60, 65, 67, 60][bar % 4];
            lead(when, midiToFreq(root + 12), 0.14);
        }

        if (step % 4 === 0) scheduleBubblePulse(when);
    }

    function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    function kick(when, vol) {
        if (vol == null) vol = 0.9;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.setValueAtTime(130, when);
        o.frequency.exponentialRampToValueAtTime(40, when + 0.13);
        g.gain.setValueAtTime(vol, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        o.connect(g); g.connect(masterGain);
        o.start(when); o.stop(when + 0.22);
    }

    function snare(when) {
        const dur = 0.16;
        const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const bp = audioCtx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.5, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        src.connect(bp); bp.connect(g); g.connect(masterGain);
        src.start(when); src.stop(when + dur);
        const o = audioCtx.createOscillator();
        const og = audioCtx.createGain();
        o.frequency.value = 220;
        og.gain.setValueAtTime(0.32, when);
        og.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
        o.connect(og); og.connect(masterGain);
        o.start(when); o.stop(when + 0.08);
    }

    function hat(when, vol) {
        if (vol == null) vol = 0.3;
        const dur = 0.04;
        const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 8000;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(vol, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        src.connect(hp); hp.connect(g); g.connect(masterGain);
        src.start(when); src.stop(when + dur);
    }

    function bass(when, freq) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const lp = audioCtx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = freq;
        lp.type = 'lowpass'; lp.frequency.value = 700;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.4, when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.4);
        o.connect(lp); lp.connect(g); g.connect(masterGain);
        o.start(when); o.stop(when + 0.45);
    }

    function lead(when, freq, vol) {
        if (vol == null) vol = 0.18;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'square'; o.frequency.value = freq;
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2400;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(vol, when + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        o.connect(lp); lp.connect(g); g.connect(masterGain);
        o.start(when); o.stop(when + 0.22);
    }

    /* ============ CANVAS BUILD ============ */

    /* Add a rounded rectangle subpath. Equivalent to SVG <rect rx="r"> and
       to CanvasRenderingContext2D.roundRect, but hand-rolled so we don't
       depend on roundRect (still missing in some older mobile Safaris). */
    /* Build the silhouette as ONE Path2D for the canvas clip, in the
       logical 400x600 coordinate system. posePathD resolves the
       current pose to a single SVG path d-string (generated from a
       skeleton for humanoid poses, hand-authored for ghost/animal);
       Path2D(d) parses it directly. A pose change re-clips the canvas
       to the new outline. Same string feeds the SVG groups below, so
       the paintable area and the visible body are guaranteed identical. */
    function buildBodyPath() {
        return new Path2D(posePathD(getCurrentPose()));
    }

    /* SVG version of the same single path — drops into the three
       <g> / <clipPath> groups inside the silhouette layers on init
       and on every pose change. */
    function renderPoseSvg(pose) {
        /* Rig poses render as one <g> per part so the dance can rotate each
           limb independently. The outline filter still sees the union alpha
           of the parent group, so it keeps drawing ONE ring, not five. */
        if (!pose.rig) return '<path d="' + posePathD(pose) + '"/>';
        const parts = rigPartsD(pose, 'solid');
        let s = '';
        for (let i = 0; i < parts.length; i++) {
            s += '<g class="rig-part" data-part="' + parts[i].key + '">' +
                 '<path d="' + parts[i].d + '"/></g>';
        }
        return s;
    }

    /* Updates the three silhouette groups (clipPath / fill / outline)
       AND the creature's transform-origin to match the pose's anchor
       (default 50% 92% so feet stay planted, some poses tweak this).
       Caller is responsible for re-clipping the canvas and saving
       state. */
    function renderPoseDom(pose) {
        const svg = renderPoseSvg(pose);
        const clip = document.querySelector('#bodyClip');
        const fill = document.querySelector('.silhouette-fill');
        const outline = document.querySelector('.silhouette-outline');
        if (clip) clip.innerHTML = svg;
        if (fill) fill.innerHTML = svg;
        if (outline) outline.innerHTML = svg;
        /* Interior linework + brass pins. Empty for the hand-authored
           ghost / animal poses, which carry no rig. */
        const dollInk = document.querySelector('.doll-ink');
        if (dollInk) dollInk.innerHTML = rigInkMarkup(pose);
        /* The <g> list just got replaced -- re-cache it and the clip paths,
           or the dance would drive detached elements. */
        cacheRigEls();
        applyLimbAngles(null);
        if (creature && pose.origin) {
            creature.style.transformOrigin = pose.origin;
        }
        /* Keep the static-pattern window in lockstep with the pose
           (new silhouette + matching transform-origin). */
        syncPatternWindow();
        /* renderPoseDom just reset transform-origin to the pose's
           foot-plant value — if we're face-zoomed, re-assert the zoom
           transform so a pose swap doesn't silently un-zoom. */
        if (faceZoomed) applyFaceZoomTransform();
    }

    /* ============ FILL PATTERNS ============

       "Rocko's Modern Life" static fill: the body shows a repeating
       pattern that stays LOCKED to the stage while the figure dances
       (the form moves, the texture doesn't). Implementation: a
       stage-level <rect> filled with the pattern in user space (so
       the texture never moves), clipped by #patternWinPath — a copy
       of the body silhouette that gets the SAME CSS transform string
       as .creature every dance frame, so the body reads as a moving
       window onto a fixed pattern field. It's an underlay: z below
       .creature, the pale wash goes transparent (body.has-pattern),
       and the kid's freehand strokes paint over it normally. */

    const PATTERNS = [
        { id: 'dots',    label: 'Dots',    size: 30, ground: '#fff7e6', ink: '#1a0f33',
          tile: (s, g, k) => '<circle cx="' + (s/2) + '" cy="' + (s/2) + '" r="' + (s*0.18) + '" fill="' + k + '"/>' },
        { id: 'stripes', label: 'Stripes', size: 26, ground: '#fff7e6', ink: '#ff6ec7',
          tile: (s, g, k) => '<path d="M0 ' + s + ' L' + s + ' 0 M-' + s + ' ' + s + ' L' + s + ' -' + s + ' M0 ' + (2*s) + ' L' + (2*s) + ' 0" stroke="' + k + '" stroke-width="' + (s*0.42) + '"/>' },
        { id: 'check',   label: 'Checker', size: 34, ground: '#fff7e6', ink: '#00b894',
          tile: (s, g, k) => '<rect width="' + (s/2) + '" height="' + (s/2) + '" fill="' + k + '"/><rect x="' + (s/2) + '" y="' + (s/2) + '" width="' + (s/2) + '" height="' + (s/2) + '" fill="' + k + '"/>' },
        { id: 'zigzag',  label: 'Zigzag',  size: 32, ground: '#1a0f33', ink: '#ffd23f',
          tile: (s, g, k) => '<path d="M0 ' + (s*0.7) + ' L' + (s/2) + ' ' + (s*0.3) + ' L' + s + ' ' + (s*0.7) + '" fill="none" stroke="' + k + '" stroke-width="' + (s*0.18) + '" stroke-linejoin="round"/>' },
        { id: 'scales',  label: 'Scales',  size: 30, ground: '#e7d6ff', ink: '#7209b7',
          tile: (s, g, k) => '<path d="M0 ' + s + ' A ' + (s/2) + ' ' + (s/2) + ' 0 0 1 ' + s + ' ' + s + ' M-' + (s/2) + ' ' + s + ' A ' + (s/2) + ' ' + (s/2) + ' 0 0 1 ' + (s/2) + ' ' + s + ' M' + (s/2) + ' ' + s + ' A ' + (s/2) + ' ' + (s/2) + ' 0 0 1 ' + (s*1.5) + ' ' + s + '" fill="none" stroke="' + k + '" stroke-width="' + (s*0.12) + '"/>' },
        { id: 'stars',   label: 'Stars',   size: 36, ground: '#fff7e6', ink: '#1a0f33',
          tile: (s, g, k) => { const cx=s/2, cy=s/2, r1=s*0.32, r2=s*0.14; let p=''; for (let i=0;i<10;i++){ const a=i*Math.PI/5 - Math.PI/2; const rr=i%2===0?r1:r2; p += (i?'L':'M') + (cx+Math.cos(a)*rr).toFixed(1) + ' ' + (cy+Math.sin(a)*rr).toFixed(1) + ' '; } return '<path d="' + p + 'Z" fill="' + k + '"/>'; } },
        { id: 'grid',    label: 'Grid',    size: 28, ground: '#fff7e6', ink: '#1a0f33',
          tile: (s, g, k) => '<path d="M0 0 H' + s + ' M0 0 V' + s + '" stroke="' + k + '" stroke-width="' + (s*0.09) + '"/>' },
        { id: 'waves',   label: 'Waves',   size: 34, ground: '#fff7e6', ink: '#00b894',
          tile: (s, g, k) => '<path d="M0 ' + (s/2) + ' Q ' + (s/4) + ' ' + (s*0.18) + ' ' + (s/2) + ' ' + (s/2) + ' T ' + s + ' ' + (s/2) + '" fill="none" stroke="' + k + '" stroke-width="' + (s*0.14) + '"/>' }
    ];

    let currentPattern = null;
    let patternLayerEl = null, patternDefsEl = null, patternFillEl = null,
        patternWinPathEl = null, patternPickerEl = null;
    let patternDefsBuilt = false;

    function patternMarkup(p) {
        return '<pattern id="pat-' + p.id + '" patternUnits="userSpaceOnUse" ' +
               'width="' + p.size + '" height="' + p.size + '">' +
               '<rect width="' + p.size + '" height="' + p.size + '" fill="' + p.ground + '"/>' +
               p.tile(p.size, p.ground, p.ink) +
               '</pattern>';
    }

    function buildPatternDefs() {
        if (patternDefsBuilt || !patternDefsEl) return;
        patternDefsEl.innerHTML = PATTERNS.map(patternMarkup).join('');
        patternDefsBuilt = true;
    }

    /* Point the window at the current pose's silhouette + mirror its
       transform-origin so the per-frame CSS transform resolves the
       same way it does on .creature. */
    function syncPatternWindow() {
        if (!patternWinPathEl) return;
        patternWinPathEl.setAttribute('d', posePathD(getCurrentPose()));
        const o = (getCurrentPose().origin) || '50% 92%';
        patternWinPathEl.style.transformOrigin = o;
    }

    /* Called every dance frame: the window tracks the body by reusing
       the EXACT transform string applied to .creature (same units,
       same origin via transform-box:view-box) — no matrix math. */
    function syncPatternDanceTransform() {
        if (!currentPattern || !patternWinPathEl || !creature) return;
        patternWinPathEl.style.transform = creature.style.transform;
    }

    function setPattern(id) {
        const p = PATTERNS.find((x) => x.id === id);
        if (!p || !patternLayerEl) return;
        buildPatternDefs();
        syncPatternWindow();
        patternFillEl.setAttribute('fill', 'url(#pat-' + id + ')');
        patternWinPathEl.style.transform = creature ? creature.style.transform : '';
        /* removeAttribute (not .hidden=false): #patternLayer is an SVG
           element, where the `hidden` IDL setter does NOT reflect to
           the content attribute, so [hidden]{display:none} would stay
           and the layer would never show. */
        patternLayerEl.removeAttribute('hidden');
        document.body.classList.add('has-pattern');
        currentPattern = id;
        if (patternPickerEl) {
            patternPickerEl.querySelectorAll('.pattern-swatch').forEach((b) => {
                b.classList.toggle('active', b.dataset.pattern === id);
            });
        }
    }

    function clearPattern() {
        currentPattern = null;
        if (patternLayerEl) patternLayerEl.setAttribute('hidden', '');
        if (patternFillEl) patternFillEl.setAttribute('fill', 'none');
        document.body.classList.remove('has-pattern');
        if (patternPickerEl) {
            patternPickerEl.querySelectorAll('.pattern-swatch').forEach((b) => {
                b.classList.toggle('active', b.dataset.pattern === '');
            });
        }
    }

    /* ============ FACE-PARTS BANK ============

       The "I can't draw" safety net. A bank of pre-made cartoon parts
       (hair / brows / eyes / nose / mouth). Tapping one drops it at the
       correct face anchor (foolproof); each placed part is a draggable
       SVG object the kid can nudge. Rendered into #facePartsInner — an
       SVG layer INSIDE #creature, so parts inherit the pose / dance /
       face-zoom transforms for free, exactly like the hat/accessory
       layers. Anchors key off BODY so they track the figure. Not in the
       gallery PNG yet (consistent: hats/accessories aren't either). */
    let facePartsInnerEl = null;
    let faceBankEl = null;

    const FACE_CATS = ['hair', 'brows', 'eyes', 'nose', 'mouth'];
    const FACE_LABEL = { hair: 'Hair', brows: 'Brows', eyes: 'Eyes', nose: 'Nose', mouth: 'Mouth' };

    /* Per-category grab box (logical units, centered on the part) — kept
       tight so the stacked face anchors don't all grab each other; the
       later-rendered part wins where they still overlap. */
    const FACE_HIT = {
        hair:  { x: -52, y: -32, w: 104, h: 50 },
        brows: { x: -30, y: -12, w: 60, h: 24 },
        eyes:  { x: -32, y: -16, w: 64, h: 32 },
        nose:  { x: -12, y: -12, w: 24, h: 26 },
        mouth: { x: -22, y: -14, w: 44, h: 30 }
    };

    function faceAnchor(cat) {
        const cx = BODY.cx;
        if (cat === 'hair')  return { x: cx, y: BODY.headTop + 4 };
        if (cat === 'brows') return { x: cx, y: BODY.browY };
        if (cat === 'eyes')  return { x: cx, y: BODY.eyeY };
        if (cat === 'nose')  return { x: cx, y: (BODY.eyeY + BODY.mouthY) / 2 };
        if (cat === 'mouth') return { x: cx, y: BODY.mouthY };
        return { x: cx, y: BODY.headCy };
    }

    /* Parts are authored centered on (0,0) in logical units; the wrapper
       <g> translates them to the anchor (+ the kid's drag nudge). */
    const FACE_PARTS = {
        hair: [
            { id: 'tuft',   svg: '<path d="M -42 8 Q -32 -24 -16 4 Q -5 -28 6 4 Q 17 -26 30 4 Q 41 -18 44 10 Z" fill="#5b3a29"/>' },
            { id: 'spikes', svg: '<path d="M -44 10 L -34 -24 L -22 6 L -11 -28 L 2 6 L 14 -25 L 26 6 L 36 -22 L 46 10 Z" fill="#5b3a29"/>' },
            { id: 'curls',  svg: '<g fill="#5b3a29"><circle cx="-36" cy="-2" r="13"/><circle cx="-13" cy="-13" r="15"/><circle cx="13" cy="-13" r="15"/><circle cx="36" cy="-2" r="13"/></g>' },
            { id: 'swoop',  svg: '<path d="M -46 12 Q -54 -28 -8 -24 Q 34 -22 46 8 Q 30 -8 4 -6 Q -22 -4 -46 12 Z" fill="#5b3a29"/>' }
        ],
        brows: [
            { id: 'flat',   svg: '<g stroke="#1a0f33" stroke-width="4" stroke-linecap="round"><line x1="-27" y1="0" x2="-9" y2="0"/><line x1="9" y1="0" x2="27" y2="0"/></g>' },
            { id: 'raised', svg: '<g fill="none" stroke="#1a0f33" stroke-width="4" stroke-linecap="round"><path d="M -27 3 Q -18 -7 -9 3"/><path d="M 9 3 Q 18 -7 27 3"/></g>' },
            { id: 'angry',  svg: '<g stroke="#1a0f33" stroke-width="4" stroke-linecap="round"><line x1="-27" y1="-4" x2="-9" y2="5"/><line x1="9" y1="5" x2="27" y2="-4"/></g>' }
        ],
        eyes: [
            { id: 'dots',   svg: '<g fill="#1a0f33"><circle cx="-18" cy="0" r="6"/><circle cx="18" cy="0" r="6"/></g>' },
            { id: 'big',    svg: '<g><circle cx="-18" cy="0" r="11" fill="#fff" stroke="#1a0f33" stroke-width="2.5"/><circle cx="18" cy="0" r="11" fill="#fff" stroke="#1a0f33" stroke-width="2.5"/><circle cx="-15" cy="2" r="4.5" fill="#1a0f33"/><circle cx="21" cy="2" r="4.5" fill="#1a0f33"/></g>' },
            { id: 'happy',  svg: '<g fill="none" stroke="#1a0f33" stroke-width="3.5" stroke-linecap="round"><path d="M -26 2 Q -18 -8 -10 2"/><path d="M 10 2 Q 18 -8 26 2"/></g>' },
            { id: 'sleepy', svg: '<g fill="none" stroke="#1a0f33" stroke-width="3.5" stroke-linecap="round"><path d="M -26 0 Q -18 6 -10 0"/><path d="M 10 0 Q 18 6 26 0"/></g>' },
            { id: 'wink',   svg: '<g fill="none" stroke="#1a0f33" stroke-width="3.5" stroke-linecap="round"><circle cx="-18" cy="0" r="6" fill="#1a0f33"/><path d="M 10 0 Q 18 6 26 0"/></g>' }
        ],
        nose: [
            { id: 'dot',    svg: '<circle cx="0" cy="0" r="3.6" fill="#1a0f33"/>' },
            { id: 'button', svg: '<ellipse cx="0" cy="0" rx="6" ry="4.6" fill="#1a0f33"/>' },
            { id: 'L',      svg: '<path d="M 0 -8 L 0 6 L 7 6" fill="none" stroke="#1a0f33" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' }
        ],
        mouth: [
            { id: 'smile',   svg: '<path d="M -16 0 Q 0 16 16 0" fill="none" stroke="#1a0f33" stroke-width="4" stroke-linecap="round"/>' },
            { id: 'grin',    svg: '<g><path d="M -18 -3 Q 0 21 18 -3 Z" fill="#1a0f33"/><path d="M -12 1 Q 0 8 12 1" fill="none" stroke="#fff" stroke-width="3"/></g>' },
            { id: 'o',       svg: '<circle cx="0" cy="2" r="9" fill="#1a0f33"/>' },
            { id: 'tongue',  svg: '<g><path d="M -16 -1 Q 0 15 16 -1" fill="none" stroke="#1a0f33" stroke-width="4" stroke-linecap="round"/><ellipse cx="3" cy="9" rx="6" ry="7" fill="#e8607a"/></g>' },
            { id: 'neutral', svg: '<line x1="-14" y1="0" x2="14" y2="0" stroke="#1a0f33" stroke-width="4" stroke-linecap="round"/>' }
        ]
    };

    function facePartGroup(cat) {
        const sel = state && state.face && state.face[cat];
        if (!sel || !sel.id) return '';
        const opt = (FACE_PARTS[cat] || []).filter(function (o) { return o.id === sel.id; })[0];
        if (!opt) return '';
        const a = faceAnchor(cat);
        const tx = (a.x + (sel.dx || 0)).toFixed(1);
        const ty = (a.y + (sel.dy || 0)).toFixed(1);
        const h = FACE_HIT[cat];
        /* fill="transparent" inline (NOT via the CSS rule): still a
           hit-testable paint for drag, but renders invisibly when the
           layer is serialised standalone for the gallery export — a
           CSS-only transparent would rasterise as a black box. */
        return '<g class="face-part" data-cat="' + cat + '" transform="translate(' + tx + ',' + ty + ')">' +
               '<rect class="fp-hit" fill="transparent" x="' + h.x + '" y="' + h.y + '" width="' + h.w + '" height="' + h.h + '"/>' +
               opt.svg + '</g>';
    }

    function renderFaceParts() {
        if (!facePartsInnerEl || !state) return;
        /* Render order = FACE_CATS order; mouth last so it sits topmost
           where the tight grab boxes still overlap. */
        facePartsInnerEl.innerHTML = FACE_CATS.map(facePartGroup).join('');
    }

    function setFacePart(cat, id) {
        if (!state.face[cat]) state.face[cat] = { id: '', dx: 0, dy: 0 };
        state.face[cat].id = id;
        state.face[cat].dx = 0;          // re-pick always re-centers —
        state.face[cat].dy = 0;          // that's the safety net
        saveState();
        renderFaceParts();
        buildFaceBank();
    }

    function clearFaceParts() {
        if (!state || !state.face) return;
        let any = false;
        FACE_CATS.forEach(function (c) {
            if (state.face[c] && state.face[c].id) { state.face[c] = { id: '', dx: 0, dy: 0 }; any = true; }
        });
        if (any) { saveState(); renderFaceParts(); buildFaceBank(); }
    }

    /* Drag-to-nudge. Screen→logical scale comes from the layer's live
       on-screen box (reflects pose/zoom/dance, same trick getPos uses
       for the canvas), so a nudge tracks the finger at any zoom. */
    function attachFaceDrag() {
        if (!facePartsInnerEl) return;
        let cat = null, gEl = null, sx = 0, sy = 0, bx = 0, by = 0, scale = 1;
        facePartsInnerEl.addEventListener('pointerdown', function (e) {
            const g = e.target.closest ? e.target.closest('.face-part') : null;
            if (!g || !state.face) return;
            cat = g.getAttribute('data-cat');
            const sel = state.face[cat];
            if (!sel) { cat = null; return; }
            gEl = g;
            const svg = facePartsInnerEl.ownerSVGElement || facePartsInnerEl.parentNode;
            const r = svg.getBoundingClientRect();
            scale = Math.min(r.width / STAGE_W, r.height / STAGE_H) || 1;
            sx = e.clientX; sy = e.clientY; bx = sel.dx || 0; by = sel.dy || 0;
            try { g.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault(); e.stopPropagation();
        });
        facePartsInnerEl.addEventListener('pointermove', function (e) {
            if (!cat || !gEl) return;
            const sel = state.face[cat];
            sel.dx = bx + (e.clientX - sx) / scale;
            sel.dy = by + (e.clientY - sy) / scale;
            const a = faceAnchor(cat);
            gEl.setAttribute('transform', 'translate(' + (a.x + sel.dx).toFixed(1) + ',' + (a.y + sel.dy).toFixed(1) + ')');
            e.preventDefault();
        });
        const end = function () {
            if (!cat) return;
            cat = null; gEl = null;
            saveState();
        };
        facePartsInnerEl.addEventListener('pointerup', end);
        facePartsInnerEl.addEventListener('pointercancel', end);
    }

    function faceSwatchSvg(svg) {
        return '<svg viewBox="-52 -34 104 68" aria-hidden="true">' + svg + '</svg>';
    }

    function buildFaceBank() {
        if (!faceBankEl || !state) return;
        let html = '';
        FACE_CATS.forEach(function (cat) {
            const sel = state.face[cat] || { id: '' };
            html += '<div class="face-row"><span class="face-row-label">' + FACE_LABEL[cat] + '</span>' +
                    '<div class="face-opts">' +
                    '<button type="button" class="face-opt face-none' + (!sel.id ? ' active' : '') +
                        '" data-cat="' + cat + '" data-id="" aria-label="No ' + FACE_LABEL[cat] + '">∅</button>';
            FACE_PARTS[cat].forEach(function (o) {
                html += '<button type="button" class="face-opt' + (sel.id === o.id ? ' active' : '') +
                        '" data-cat="' + cat + '" data-id="' + o.id + '" aria-label="' + FACE_LABEL[cat] + ' ' + o.id + '">' +
                        faceSwatchSvg(o.svg) + '</button>';
            });
            html += '</div></div>';
        });
        faceBankEl.innerHTML = html;
    }

    function attachFaceBank() {
        if (!faceBankEl) return;
        faceBankEl.addEventListener('click', function (e) {
            const b = e.target.closest ? e.target.closest('.face-opt') : null;
            if (!b) return;
            setFacePart(b.getAttribute('data-cat'), b.getAttribute('data-id'));
        });
    }

    function buildPatternPicker() {
        if (!patternPickerEl) return;
        patternPickerEl.innerHTML = '';
        /* "None" first. */
        const none = document.createElement('button');
        none.type = 'button';
        none.className = 'pattern-swatch pattern-none active';
        none.dataset.pattern = '';
        none.setAttribute('aria-label', 'No fill pattern');
        none.textContent = '∅';
        none.addEventListener('click', clearPattern);
        patternPickerEl.appendChild(none);

        for (let i = 0; i < PATTERNS.length; i++) {
            const p = PATTERNS[i];
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pattern-swatch';
            b.dataset.pattern = p.id;
            b.setAttribute('aria-label', p.label + ' fill pattern');
            b.title = p.label;
            /* Mini preview: a 36px SVG tiled with the same pattern. */
            b.innerHTML =
                '<svg viewBox="0 0 36 36" aria-hidden="true">' +
                    '<defs>' + patternMarkup(p) + '</defs>' +
                    '<rect width="36" height="36" rx="6" fill="url(#pat-' + p.id + ')"/>' +
                '</svg>';
            b.addEventListener('click', () => setPattern(p.id));
            patternPickerEl.appendChild(b);
        }
    }

    /* Tracks whether the context has a save() pushed for the current
       clip. applyCanvasClip uses this to restore the previous clip
       state before installing a new one — so pose changes don't pile
       up clips on the state stack. */
    let canvasClipSaved = false;

    function buildCanvas() {
        canvas = document.getElementById('drawCanvas');
        creature = document.getElementById('creature');
        // The canvas is sized in logical units (400x600) but we render at
        // higher pixel density for crisp strokes on retina screens.
        const dpr = Math.max(2, window.devicePixelRatio || 1);
        canvas.width = STAGE_W * dpr;
        canvas.height = STAGE_H * dpr;
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        /* Sibling canvas that shows the artwork re-composited per limb while
           he dances. The paint canvas itself keeps holding the artwork in
           rest-pose space and keeps receiving the pointer events -- it is
           only made transparent during the dance, never hidden, or drawing
           while dancing would stop working. */
        danceCanvas = document.getElementById('danceCanvas');
        if (danceCanvas) {
            danceCanvas.width = STAGE_W * dpr;
            danceCanvas.height = STAGE_H * dpr;
            danceCtx = danceCanvas.getContext('2d');
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Hard-clip the drawing surface to the silhouette so strokes outside
        // the body are never painted to the bitmap. Wrapped in save() so
        // applyCanvasClip can later restore() to pop this clip and install
        // a different one for a new pose.
        applyCanvasClip();
        attachDrawing();
    }

    /* Reset the canvas to a clean state (no drawings) and clip to the
       currently-selected pose's silhouette. Called once from buildCanvas
       and again whenever the user picks a new pose. The pre-existing
       drawing gets wiped — different pose, fresh canvas. */
    function applyCanvasClip() {
        if (canvasClipSaved) {
            // Pop the previous clip + scale state so we start from a
            // clean stack.
            ctx.restore();
            canvasClipSaved = false;
        }
        // The setTransform(1,0,0,1,0,0) + clearRect-in-pixel-space combo
        // wipes every pixel regardless of any leftover clip / transform.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Re-establish the dpr scale + line caps.
        const dpr = Math.max(2, window.devicePixelRatio || 1);
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // save() before clip() so the next applyCanvasClip can restore()
        // back to this clean state.
        ctx.save();
        ctx.clip(buildBodyPath());
        canvasClipSaved = true;
    }

    /* Public entry point for pose switching. Updates state, re-renders
       the silhouette SVG groups, and re-clips the canvas. Marking the
       chosen pose-btn active is left to the caller (attachPosePicker
       handles it). */
    function applyPose(poseId) {
        if (!POSES[poseId]) return;
        state.pose = poseId;
        saveState();
        /* trackClearDrawing — switching pose clears the drawing surface,
           so the per-drawing color tally needs to reset along with it
           (matches the same reset that clearCanvas does). */
        trackClearDrawing();
        renderPoseDom(POSES[poseId]);
        applyCanvasClip();
        /* Keep the pose picker's active button in sync so programmatic
           callers (default-Groodle starters, future scripted demos)
           don't leave the UI showing the wrong pose. The picker's own
           click handler still flips the active class redundantly, which
           is harmless. */
        document.querySelectorAll('.pose-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.pose === poseId);
        });
    }

    /* Convert pointer event coords to logical canvas coords (0..400, 0..600).
       Uses cachedRect when available (during an active stroke) so
       pointermove doesn't force a layout each event; falls back to a fresh
       read for one-off uses. */
    function getPos(e) {
        const rect = cachedRect || canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (STAGE_W / rect.width);
        const y = (e.clientY - rect.top) * (STAGE_H / rect.height);
        /* While a limb is rotated the kid is aiming at the DANCING body, but
           the bitmap underneath is in rest-pose space -- undo the rotation of
           whichever part is under the finger. */
        if (isPlaying && _lastLimbAngles) {
            return unposePoint(x, y, _lastLimbAngles);
        }
        return { x: x, y: y };
    }

    function attachDrawing() {
        canvas.addEventListener('pointerdown', (e) => {
            /* Drawing is always on (no explicit "draw mode" gate). The
               canvas's touch-action: pan-y means the browser routes
               mostly-vertical drags to page scroll instead of firing
               pointer events here, so a thumb passing through the
               silhouette to scroll still works. Horizontal / diagonal
               drags get captured for strokes. Drawing remains active
               during dance — the kid can keep editing while the
               creature grooves. */
            try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
            /* Cache the rect once per stroke so subsequent pointermove
               events skip the getBoundingClientRect layout read. */
            cachedRect = canvas.getBoundingClientRect();
            isDrawing = true;
            const p = getPos(e);
            lastX = p.x; lastY = p.y;
            if (isErasing) {
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = '#000';
                ctx.beginPath();
                ctx.arc(p.x, p.y, currentSize / 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else {
                ctx.fillStyle = currentColor;
                ctx.beginPath();
                ctx.arc(p.x, p.y, currentSize / 2, 0, Math.PI * 2);
                ctx.fill();
                /* Only the kid's actively-selected colors count toward
                   Rainbow Day / Color Curator — SURPRISE-painted regions
                   don't, which is why this lives on pointer events rather
                   than at the fill site of drawSurprise. */
                trackColorUsed(currentColor);
            }
            /* Only preventDefault when we're actually capturing the stroke.
               Calling it unconditionally on every touch would suppress the
               browser's gesture inference (and isn't needed: touch-action
               already gates scroll/zoom). */
            e.preventDefault();
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!isDrawing) return;
            const p = getPos(e);
            if (isErasing) {
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = currentSize;
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                ctx.restore();
            } else {
                ctx.strokeStyle = currentColor;
                ctx.lineWidth = currentSize;
                ctx.beginPath();
                ctx.moveTo(lastX, lastY);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
            lastX = p.x; lastY = p.y;
        });

        const endStroke = (e) => {
            if (isDrawing) trackStroke();
            isDrawing = false;
            cachedRect = null;
            try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        };
        canvas.addEventListener('pointerup', endStroke);
        canvas.addEventListener('pointercancel', endStroke);
        canvas.addEventListener('pointerleave', () => {
            if (isDrawing) trackStroke();
            isDrawing = false;
            cachedRect = null;
        });
    }

    function clearCanvas() {
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
        /* Wipe the per-drawing color tally so Rainbow Day resets cleanly
           when the kid starts over. trackClearDrawing is a no-op for
           any other counters. */
        if (state) trackClearDrawing();
        /* If a color-it-yourself character outline is loaded, re-stamp
           it so CLEAR resets to "freshly outlined" instead of fully
           blank. (Colored-for-you + blank modes have no restamp.) */
        if (restampOutline) restampOutline(ctx);
    }

    /* ============ TOOLS UI ============ */

    function buildPalette() {
        const pal = document.getElementById('palette');
        COLORS.forEach(c => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'swatch';
            sw.style.background = c;
            sw.dataset.color = c;
            sw.setAttribute('aria-label', 'Color ' + c);
            if (c === currentColor) sw.classList.add('active');
            sw.addEventListener('click', () => {
                currentColor = c;
                isErasing = false;
                document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
                sw.classList.add('active');
                document.getElementById('eraserBtn').classList.remove('active');
            });
            pal.appendChild(sw);
        });
    }

    function buildSizes() {
        const wrap = document.getElementById('sizes');
        SIZES.forEach(s => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'size-btn';
            b.setAttribute('aria-label', 'Brush size ' + s);
            if (s === currentSize) b.classList.add('active');
            const dot = document.createElement('span');
            dot.className = 'dot';
            const px = Math.max(6, Math.min(28, s));
            dot.style.width = px + 'px';
            dot.style.height = px + 'px';
            b.appendChild(dot);
            b.addEventListener('click', () => {
                currentSize = s;
                document.querySelectorAll('.size-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
            });
            wrap.appendChild(b);
        });
    }

    function attachBgPicker() {
        const bgLayer = document.getElementById('bgLayer');
        document.querySelectorAll('.bg-thumb').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.bg;
                document.querySelectorAll('.bg-thumb').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                bgLayer.className = 'bg-layer bg-' + name;
            });
        });
    }

    /* Pose picker — generated from POSES so adding a new entry to the
       dictionary above grows the UI automatically. Each tap calls
       applyPose() which wipes the canvas + re-renders the silhouette
       + re-clips. */
    function buildPosePicker() {
        const root = document.getElementById('posePicker');
        if (!root) return;
        root.innerHTML = '';
        const currentId = (state && state.pose) || 'standing';
        Object.keys(POSES).forEach((id) => {
            const pose = POSES[id];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pose-btn' + (id === currentId ? ' active' : '');
            btn.dataset.pose = id;
            btn.setAttribute('aria-label', pose.name + ' pose');
            btn.innerHTML =
                '<span class="pose-icon" aria-hidden="true">' + pose.icon + '</span>' +
                '<span class="pose-name"></span>';
            btn.querySelector('.pose-name').textContent = pose.name;
            btn.addEventListener('click', () => {
                applyPose(id);
                root.querySelectorAll('.pose-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            root.appendChild(btn);
        });
    }

    /* ============ SURPRISE ============ */

    /* A goofy default character so kids can press DANCE immediately. The
       silhouette clip-path takes care of trimming any overflow. */
    function drawSurprise() {
        trackSurpriseUsed();
        /* SURPRISE explicitly clears the active character so
           clearCanvas's outline re-stamp doesn't fight the new art. */
        currentCharacterId = null;
        restampOutline = null;
        /* SURPRISE paints its own face — clear stamped SVG face parts. */
        clearFaceParts();
        clearCanvas();

        // Skin tone fill across the whole body silhouette
        ctx.fillStyle = '#fcbf49';
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);

        // Shirt: green band over the torso
        ctx.fillStyle = '#43aa8b';
        ctx.fillRect(0, BODY.shirtTop, STAGE_W, BODY.shirtBot - BODY.shirtTop);

        // Pants
        ctx.fillStyle = '#1d3557';
        ctx.fillRect(0, BODY.waistY, STAGE_W, BODY.pantsBot);

        // Shirt logo: white badge with red star on chest
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(BODY.cx, BODY.chestY, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e63946';
        ctx.font = 'bold 32px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', BODY.cx, BODY.chestY + 2);

        // Eyes
        ctx.fillStyle = '#1a0f33';
        ctx.beginPath(); ctx.arc(BODY.cx - BODY.eyeDX, BODY.eyeY, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(BODY.cx + BODY.eyeDX, BODY.eyeY, 7, 0, Math.PI * 2); ctx.fill();

        // Smile
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#1a0f33';
        ctx.beginPath();
        ctx.arc(BODY.cx, BODY.mouthY, 18, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();

        // Cheeks
        ctx.fillStyle = 'rgba(230, 57, 70, 0.55)';
        ctx.beginPath(); ctx.arc(BODY.cx - BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(BODY.cx + BODY.cheekDX, BODY.cheekY, 8, 0, Math.PI * 2); ctx.fill();

        // Hair tufts on top of head
        ctx.fillStyle = '#7209b7';
        for (let i = 0; i < 5; i++) {
            const x = BODY.cx - 38 + i * 19;
            ctx.beginPath();
            ctx.moveTo(x, BODY.hairBaseY);
            ctx.lineTo(x + 8, BODY.hairTipY);
            ctx.lineTo(x + 16, BODY.hairBaseY);
            ctx.closePath();
            ctx.fill();
        }
    }

    /* ============ DANCE ============ */

    /* Updates the playBtn so it reads as ▶ DANCE when idle and ■ STOP
       when playing. The current dock layout uses inner spans on the
       button, so this function updates the `.dock-label` text rather
       than the button's textContent (which would wipe the spans). The
       button also carries `is-stop` + `aria-pressed` for state-aware
       CSS / a11y. */
    function setPlayBtnState(playing) {
        const playBtn = document.getElementById('playBtn');
        if (!playBtn) return;
        playBtn.classList.toggle('is-stop', playing);
        playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
        const labelEl = playBtn.querySelector('.dock-label');
        if (labelEl) {
            labelEl.textContent = playing ? 'Stop' : 'Dance';
        } else {
            playBtn.textContent = playing ? '■ STOP' : '▶ DANCE';
        }
    }

    function startDance() {
        if (isPlaying) return;
        /* Dance and face-zoom both own creature.style.transform — never
           both at once. Pressing DANCE always drops back to full view. */
        exitFaceZoom();
        /* Pressing DANCE finishes the current drawing (commits it as a
           groodle). drawingsFinished and First/Five Groodle hinge on this
           — it's the only moment in the game with a clear "I'm done"
           signal from the kid. */
        trackDrawingFinished();
        trackBeatExperienced(BEATS[currentBeatIdx]);
        /* Pressing DANCE while a character is loaded (outline OR
           colored-for-you) counts as finishing it — unlocks its
           page-* achievement + Coloring Master at the 6th. */
        if (currentCharacterId) trackCharacterCompleted(currentCharacterId);
        ensureAudio();
        const begin = () => {
            isPlaying = true;
            danceSessionStart = Date.now();
            /* body.dancing handles all the visibility toggling now:
                 * tool-dock → hidden
                 * dance-dock → shown
                 * title-overlay → faded
                 * currency-pill → faded
               Drawing stays enabled during dance — the kid can keep
               editing while the creature grooves. */
            document.body.classList.add('dancing');
            /* The dance dock carries the `hidden` attribute so it doesn't
               flash on first paint; flip it off here so the STOP button
               is reachable. stopDance restores the flag. */
            if (danceDockEl) danceDockEl.hidden = false;
            /* If a drawer was open when DANCE was tapped, close it so
               the dance composition is clean. The Beat drawer is still
               reachable mid-dance via the dance-dock. */
            closeDrawer();
            setPlayBtnState(true);
            updateMoveBeatLabels();
            startAudio();
            danceStartTime = audioCtx.currentTime;
            requestAnimationFrame(danceFrame);
        };
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(begin, begin);
        } else {
            begin();
        }
    }

    function stopDance() {
        if (!isPlaying) return;
        isPlaying = false;
        if (danceSessionStart) {
            trackDanceSession((Date.now() - danceSessionStart) / 1000);
            danceSessionStart = 0;
        }
        stopAudio();
        document.body.classList.remove('dancing');
        if (danceDockEl) danceDockEl.hidden = true;
        setPlayBtnState(false);
        creature.style.transform = '';
        applyLimbAngles(null);          // limbs back to the resting pose
        /* Snap the static-pattern window back to the resting body. */
        if (patternWinPathEl) patternWinPathEl.style.transform = '';
        if (floorEl) {
            floorEl.style.transform = 'translateX(-50%)';
            floorEl.style.opacity = '';
        }
        if (bubbleEl) {
            bubbleEl.style.opacity = '0';
            bubbleEl.style.transform = '';
            bubbleEl._pulseStart = null;
        }
    }

    /* ---- Face-zoom mode ----

       Magnify #creature about the head so the kid can draw fine facial
       detail. The maths: measure the *resting* canvas rect (the canvas
       maps logical 0..400 / 0..600 across its box), pin transform-origin
       to the face row, scale by FACE_ZOOM_SCALE, then translateY so the
       face lands at a comfortable spot above the dock. getPos() reads
       the live (post-transform) canvas rect proportionally, so strokes
       still map to the same logical coords — zoom out and the detail is
       exactly where it was drawn on the face. */
    function applyFaceZoomTransform() {
        if (!faceZoomed || !creature || !canvas) return;
        creature.style.transform = '';            // measure resting layout
        const cr = canvas.getBoundingClientRect();
        const host = stageEl || creature.parentElement;
        const st = host.getBoundingClientRect();
        /* Anchor a touch below head center so the whole face + chin sit
           in frame, not just the eyes. */
        const faceFracY = (BODY.headCy + BODY.headR * 0.28) / STAGE_H;
        const faceScreenY = cr.top + faceFracY * cr.height;
        const targetY = st.top + st.height * 0.47; // comfy, clears the dock
        const dy = targetY - faceScreenY;
        const origin = '50% ' + (faceFracY * 100).toFixed(2) + '%';
        const tf = 'translateY(' + dy.toFixed(1) + 'px) scale(' + FACE_ZOOM_SCALE + ')';
        creature.style.transformOrigin = origin;
        creature.style.transform = tf;
        /* Keep an active static-pattern layer pixel-aligned — identical
           box, so the identical transform/origin keeps it registered. */
        if (patternLayerEl && !patternLayerEl.hasAttribute('hidden')) {
            patternLayerEl.style.transformOrigin = origin;
            patternLayerEl.style.transform = tf;
        }
        cachedRect = null;                         // getPos re-measures
    }

    function enterFaceZoom() {
        if (faceZoomed) return;
        if (isPlaying) stopDance();                // never zoom while dancing
        closeDrawer();                             // clean, full-frame face
        faceZoomed = true;
        document.body.classList.add('face-zoomed');
        if (faceZoomBtnEl) {
            faceZoomBtnEl.textContent = '🔙';
            faceZoomBtnEl.setAttribute('aria-label', 'Zoom back out');
            faceZoomBtnEl.classList.add('active');
        }
        applyFaceZoomTransform();
        window.addEventListener('resize', applyFaceZoomTransform);
    }

    function exitFaceZoom() {
        if (!faceZoomed) return;
        faceZoomed = false;
        document.body.classList.remove('face-zoomed');
        window.removeEventListener('resize', applyFaceZoomTransform);
        if (faceZoomBtnEl) {
            faceZoomBtnEl.textContent = '🔍';
            faceZoomBtnEl.setAttribute('aria-label', 'Zoom to face');
            faceZoomBtnEl.classList.remove('active');
        }
        if (creature) {
            creature.style.transform = '';
            const pose = getCurrentPose();
            creature.style.transformOrigin = (pose && pose.origin) || '50% 92%';
        }
        if (patternLayerEl) {
            patternLayerEl.style.transform = '';
            patternLayerEl.style.transformOrigin = '';
        }
        if (patternWinPathEl) patternWinPathEl.style.transform = '';
        cachedRect = null;
    }

    function toggleFaceZoom() {
        if (faceZoomed) exitFaceZoom(); else enterFaceZoom();
    }

    function togglePlay() {
        if (isPlaying) stopDance(); else startDance();
    }

    function danceFrame() {
        if (!isPlaying) return;
        const t = audioCtx.currentTime - danceStartTime;
        const beats = t * (TEMPO / 60);
        applyMove(MOVES[currentMoveIdx], beats);
        /* Limbs swing on a two-beat cycle -- one beat reads as a twitch. */
        applyLimbAngles(limbAngles(beats / 2, MOVES[currentMoveIdx]));
        requestAnimationFrame(danceFrame);
    }

    /* The whole creature transforms as a single sprite â€” translate /
       squash / sway. transform-origin is the floor (50% 92%) so the
       feet stay planted while the body bobs above. */
    /* Rigid-body dance (the whole creature — silhouette + the kid's
       drawing + hat — transforms as one sprite; transform-origin is
       the feet so squash/spin pivot off the floor). True per-limb
       articulation is a post-launch v2 — see PLAY_STORE_PLAN.md.

       The juice comes from three classic animation principles applied
       to the wrapper transform:
         * a snappy hop ARC (sin, not |sin|, so the figure spends real
           time airborne instead of vibrating),
         * ANTICIPATION — a crouch + widen just before each launch,
         * SQUASH & STRETCH — stretch tall at the apex, splat wide on
           the landing/anticipation, roughly volume-preserving so it
           reads as weight, not scaling. */
    function applyMove(move, beats) {
        const ph = beats - Math.floor(beats);          // 0..1 within the beat
        const barBeat = Math.floor(beats) % 4;          // which beat of 4
        const hop = Math.sin(Math.PI * ph);             // 0→1→0 jump arc
        /* anticipation: ramp 0→1 over the last 18% of the beat */
        const antic = ph > 0.82 ? (ph - 0.82) / 0.18 : 0;
        /* landing impact: strong spike right at ground contact */
        const land = Math.pow(Math.max(0, 1 - ph * 6), 2);
        /* combined ground-squash amount (0 mid-air, 1 splatted) */
        const gsq = Math.max(antic * 0.75, land);

        let ty = 0, rot = 0, sx = 1, sy = 1, tx = 0;

        /* Headroom budget: the figure's head art starts only ~5.7% down
           its own viewBox and the .creature box is ~0.85 of the viewport,
           so the dance's UPWARD components must stay small or the head
           clips out the overflow:hidden stage top. The big head-lifter is
           the hop scale-STRETCH (sy>1), magnified ~0.86×boxHeight because
           transform-origin sits near the feet — so the hop stretch is
           trimmed hardest. Rotation, side-step (tx) and the landing
           squash (gsq, which moves the head DOWN) keep full energy so the
           dance still reads big. */
        if (move === 'BOUNCE') {
            ty = -hop * 32 + antic * 8;
            sy = 1 + hop * 0.05 - gsq * 0.22;
            sx = 1 - hop * 0.04 + gsq * 0.22;
            rot = Math.sin(beats * Math.PI) * 2;
        } else if (move === 'TWIST') {
            const swiv = Math.sin(beats * Math.PI);     // hip swivel, 2-beat period
            rot = swiv * 16;
            tx = swiv * 8;
            ty = -hop * 16;
            sy = 1 + hop * 0.03 - gsq * 0.12;
            sx = 1 - hop * 0.02 + gsq * 0.12;
        } else if (move === 'DISCO') {
            const step = Math.sin(beats * Math.PI / 2); // slow 4-beat side-step
            tx = step * 30;
            rot = step * 11;
            ty = -hop * 24;
            sy = 1 + hop * 0.045 - gsq * 0.17;
            sx = 1 - hop * 0.035 + gsq * 0.17;
            /* every 4th beat: a quick scaleX flip-and-back reads as a
               spin/turn (figure goes edge-on at mid-beat then back). */
            if (barBeat === 3) sx *= Math.cos(ph * Math.PI * 2);
        } else if (move === 'PARTY') {
            ty = -hop * 34;
            sy = 1 + hop * 0.05 - gsq * 0.28;
            sx = 1 - hop * 0.05 + gsq * 0.28;
            rot = Math.sin(beats * Math.PI * 2) * 11;
            tx = Math.sin(beats * Math.PI) * 16;
            /* every 4th beat: a full cartwheel spin around the feet */
            if (barBeat === 3) rot += ph * 360;
        }

        const parts = [];
        if (tx) parts.push('translateX(' + tx.toFixed(2) + 'px)');
        if (ty) parts.push('translateY(' + ty.toFixed(2) + 'px)');
        if (rot) parts.push('rotate(' + rot.toFixed(2) + 'deg)');
        if (sx !== 1 || sy !== 1) parts.push('scale(' + sx.toFixed(3) + ', ' + sy.toFixed(3) + ')');
        creature.style.transform = parts.join(' ');
        /* Static-pattern window tracks the body by reusing this exact
           transform string (see syncPatternDanceTransform). */
        syncPatternDanceTransform();

        if (floorEl) {
            /* Shadow shrinks + fades as the figure leaves the ground,
               darkens + spreads on the squashed landing. */
            const sc = 1 - hop * 0.34 + gsq * 0.10;
            floorEl.style.transform = 'translateX(-50%) scaleX(' + sc.toFixed(3) + ')';
            floorEl.style.opacity = (0.34 + (1 - hop) * 0.5).toFixed(3);
        }

        if (bubbleEl && bubbleEl._pulseStart != null) {
            const elapsed = (audioCtx.currentTime - bubbleEl._pulseStart);
            const k = Math.max(0, 1 - elapsed / 0.18);
            bubbleEl.style.opacity = String(k);
            bubbleEl.style.transform = 'scale(' + (1 + (1 - k) * 0.6) + ')';
        }
    }

    function scheduleBubblePulse(when) {
        const delay = Math.max(0, (when - audioCtx.currentTime) * 1000);
        setTimeout(() => {
            if (!bubbleEl || !isPlaying) return;
            bubbleEl._pulseStart = audioCtx.currentTime;
            bubbleEl.style.opacity = '1';
            bubbleEl.style.transform = 'scale(1)';
        }, delay);
    }

    /* ============ HANDLERS / INIT ============ */

    function updateMoveBeatLabels() {
        const ml = document.getElementById('moveLabel');
        const bl = document.getElementById('beatLabel');
        if (ml) ml.textContent = MOVES[currentMoveIdx];
        if (bl) bl.textContent = BEATS[currentBeatIdx];
    }

    function attachHandlers() {
        document.getElementById('clearBtn').addEventListener('click', clearCanvas);
        document.getElementById('randomBtn').addEventListener('click', drawSurprise);

        document.getElementById('openAchievementsBtn').addEventListener('click', openAchievements);
        document.getElementById('openHatShopBtn').addEventListener('click', openHatShop);
        const pagesBtn = document.getElementById('openPagesBtn');
        if (pagesBtn) pagesBtn.addEventListener('click', openCharacterPicker);
        /* Gallery + SAVE are on-device only, on web and in the app
           alike — see the ON-DEVICE GALLERY block in the gallery
           section. No network, no upload, no name prompt. */
        const galleryBtn = document.getElementById('openGalleryBtn');
        if (galleryBtn) galleryBtn.addEventListener('click', openLocalGallery);
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveGroodleLocal);

        document.getElementById('eraserBtn').addEventListener('click', () => {
            isErasing = !isErasing;
            const btn = document.getElementById('eraserBtn');
            btn.classList.toggle('active', isErasing);
            if (isErasing) {
                trackEraserUsed();
                document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            } else {
                const sw = document.querySelector('.swatch[data-color="' + currentColor + '"]');
                if (sw) sw.classList.add('active');
            }
        });

        /* playBtn is a toggle: ▶ DANCE → ■ STOP. The dance-dock still
           carries a redundant ■ STOP exit so kids who already learned that
           path keep working. */
        document.getElementById('playBtn').addEventListener('click', togglePlay);
        document.getElementById('stopBtn').addEventListener('click', stopDance);

        /* Face-zoom toggle (floating magnifier). */
        stageEl = document.getElementById('stage');
        faceZoomBtnEl = document.getElementById('faceZoomBtn');
        if (faceZoomBtnEl) {
            faceZoomBtnEl.addEventListener('click', toggleFaceZoom);
        }

        document.getElementById('moveBtn').addEventListener('click', () => {
            currentMoveIdx = (currentMoveIdx + 1) % MOVES.length;
            updateMoveBeatLabels();
        });
        document.getElementById('beatBtn').addEventListener('click', () => {
            currentBeatIdx = (currentBeatIdx + 1) % BEATS.length;
            trackBeatExperienced(BEATS[currentBeatIdx]);
            updateMoveBeatLabels();
        });
    }

    function init() {
        /* Persistence first: every other init step may want to read or
           write state (the palette wiring tracks color usage, etc.).
           loadState falls back to defaults if storage is unavailable, so
           this never throws. */
        state = loadState();
        currencyPillEl = document.getElementById('currencyPill');
        currencyValueEl = document.getElementById('currencyValue');
        toastContainerEl = document.getElementById('toastContainer');
        achievementsModalEl = document.getElementById('achievementsModal');
        achievementsListEl = document.getElementById('achievementsList');
        achievementsStatsEl = document.getElementById('achievementStats');
        hatShopModalEl = document.getElementById('hatShopModal');
        hatShopGridEl = document.getElementById('hatShopGrid');
        hatShopBalanceEl = document.getElementById('hatShopBalance');
        hatLayerInnerEl = document.getElementById('hatLayerInner');
        accessoryLayerInnerEl = document.getElementById('accessoryLayerInner');
        patternLayerEl = document.getElementById('patternLayer');
        patternDefsEl = document.getElementById('patternDefs');
        patternFillEl = document.getElementById('patternFill');
        patternWinPathEl = document.getElementById('patternWinPath');
        patternPickerEl = document.getElementById('patternPicker');
        facePartsInnerEl = document.getElementById('facePartsInner');
        faceBankEl = document.getElementById('faceBank');
        accessoryShopGridEl = document.getElementById('accessoryShopGrid');
        pagesModalEl = document.getElementById('pagesModal');
        pagesGridEl = document.getElementById('pagesGrid');
        galleryModalEl = document.getElementById('galleryModal');
        galleryGridEl = document.getElementById('galleryGrid');
        drawerHostEl = document.getElementById('drawerHost');
        if (achievementsModalEl) attachModalDismissers(achievementsModalEl);
        if (hatShopModalEl) attachModalDismissers(hatShopModalEl);
        if (pagesModalEl) attachModalDismissers(pagesModalEl);
        if (galleryModalEl) attachModalDismissers(galleryModalEl);
        attachDrawerHostDismissers();
        attachDockButtons();
        attachDockTooltips();
        renderCurrency();
        renderEquippedHat();
        renderEquippedAccessory();
        attachWardrobeTabs();
        trackVisit();

        /* Render the silhouette SVG for the saved pose BEFORE buildCanvas
           runs — buildCanvas reads posePathD(getCurrentPose()) for its
           clip, so the canvas-level drawable area lines up with what the
           kid sees onscreen. */
        renderPoseDom(getCurrentPose());
        buildCanvas();
        buildPalette();
        buildSizes();
        attachBgPicker();
        buildPosePicker();
        buildPatternDefs();
        buildPatternPicker();
        buildFaceBank();
        attachFaceBank();
        renderFaceParts();
        attachFaceDrag();
        attachHandlers();
        updateMoveBeatLabels();
        floorEl = document.getElementById('stageFloor');
        bubbleEl = document.getElementById('beatBubble');
        danceDockEl = document.getElementById('danceDock');

        /* Defensive: if a returning user is on a release where the
           achievement catalog grew, retroactively unlock anything their
           historic counters already satisfy. Also fires Bedhead when
           bedheadEligible is true from the trackVisit above. */
        checkAchievements();

        /* Global Escape closes whatever modal / drawer is open. */
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (openModalEl) closeModal();
            else if (openDrawerEl) closeDrawer();
        });

        /* Stop the dance when the tab/app goes to the background. RAF
           naturally pauses on hidden tabs, but the audio scheduler's
           setInterval continues to fire and the Web Audio context can keep
           emitting whatever was already queued. Calling stopDance is the
           predictable choice: when the kid comes back, they tap DANCE
           again and the loop restarts at step 0 instead of resuming from
           some indeterminate phase. */
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isPlaying) stopDance();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* Service worker registration — purely a progressive enhancement.
       The game runs fine without it; with it, the shell is cached so
       reopens are instant and offline-capable. Registered after the
       load event so it doesn't compete with first-paint asset fetches
       for bandwidth on slow connections.

       Skipped on file:// (no SW context) and on protocols that don't
       support secure origins. Failures are swallowed silently — a
       registration error must not break the game. */
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => {
                /* swallow — SW is optional */
            });
        });
    }
})();
