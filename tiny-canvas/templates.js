/* ============================================================
   Tiny Canvas — coloring-page templates
   ============================================================
   Each template is a thick-stroked SVG that renders on top of the
   kid's canvas. The SVG must:
     - use viewBox="0 0 800 800" so it lines up with the canvas
     - paint as currentColor strokes (no fill) — the kid colors
       UNDER the lines, the lines stay visible
     - use stroke-width 6-10 and stroke-linecap="round" so the
       page feels printed, not vector-thin
     - have NO background — the canvas paper shows through
   The kid's strokes land on the canvas; the SVG sits above with
   pointer-events: none so taps reach the canvas.
   ============================================================ */

window.TINY_CANVAS_TEMPLATES = [
    {
        id: "blank",
        name: "BLANK",
        svg: ""
    },
    {
        id: "smile-sun",
        name: "SMILEY SUN",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* sun body */
            '<circle cx="400" cy="400" r="200"/>' +
            /* rays — eight evenly spaced spokes */
            '<line x1="400" y1="120" x2="400" y2="180"/>' +
            '<line x1="400" y1="620" x2="400" y2="680"/>' +
            '<line x1="120" y1="400" x2="180" y2="400"/>' +
            '<line x1="620" y1="400" x2="680" y2="400"/>' +
            '<line x1="200" y1="200" x2="245" y2="245"/>' +
            '<line x1="555" y1="555" x2="600" y2="600"/>' +
            '<line x1="200" y1="600" x2="245" y2="555"/>' +
            '<line x1="555" y1="245" x2="600" y2="200"/>' +
            /* face — eyes + smile */
            '<circle cx="335" cy="370" r="14" fill="currentColor"/>' +
            '<circle cx="465" cy="370" r="14" fill="currentColor"/>' +
            '<path d="M320 450 Q400 520 480 450"/>' +
            /* rosy cheeks */
            '<circle cx="295" cy="430" r="18"/>' +
            '<circle cx="505" cy="430" r="18"/>' +
        '</svg>'
    },
    {
        id: "friendly-cat",
        name: "FRIENDLY CAT",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* head — big round */
            '<circle cx="400" cy="430" r="220"/>' +
            /* ears — triangles on top */
            '<path d="M230 320 L210 170 L340 280 Z"/>' +
            '<path d="M570 320 L590 170 L460 280 Z"/>' +
            /* inner ears */
            '<path d="M255 290 L240 220 L300 270 Z"/>' +
            '<path d="M545 290 L560 220 L500 270 Z"/>' +
            /* eyes — big oval almond */
            '<ellipse cx="320" cy="400" rx="32" ry="40"/>' +
            '<ellipse cx="480" cy="400" rx="32" ry="40"/>' +
            /* pupils */
            '<ellipse cx="320" cy="405" rx="10" ry="22" fill="currentColor"/>' +
            '<ellipse cx="480" cy="405" rx="10" ry="22" fill="currentColor"/>' +
            /* nose — small triangle */
            '<path d="M380 480 L420 480 L400 502 Z" fill="currentColor"/>' +
            /* mouth — three-arc W */
            '<path d="M400 502 L400 520"/>' +
            '<path d="M400 520 Q375 545 360 530"/>' +
            '<path d="M400 520 Q425 545 440 530"/>' +
            /* whiskers — three per side */
            '<line x1="245" y1="490" x2="335" y2="500"/>' +
            '<line x1="245" y1="520" x2="335" y2="520"/>' +
            '<line x1="245" y1="550" x2="335" y2="540"/>' +
            '<line x1="555" y1="490" x2="465" y2="500"/>' +
            '<line x1="555" y1="520" x2="465" y2="520"/>' +
            '<line x1="555" y1="550" x2="465" y2="540"/>' +
        '</svg>'
    },
    {
        id: "rocket",
        name: "ROCKET",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* body */
            '<path d="M400 100 Q330 200 330 360 L330 540 L470 540 L470 360 Q470 200 400 100 Z"/>' +
            /* nose-cone divider */
            '<path d="M330 280 Q400 240 470 280"/>' +
            /* porthole window */
            '<circle cx="400" cy="340" r="55"/>' +
            '<circle cx="400" cy="340" r="35"/>' +
            /* left fin */
            '<path d="M330 460 L240 580 L240 640 L330 600 Z"/>' +
            /* right fin */
            '<path d="M470 460 L560 580 L560 640 L470 600 Z"/>' +
            /* booster collar */
            '<line x1="330" y1="540" x2="470" y2="540"/>' +
            '<line x1="330" y1="555" x2="470" y2="555"/>' +
            /* flame */
            '<path d="M345 560 Q360 660 400 720 Q440 660 455 560"/>' +
            '<path d="M375 580 Q385 660 400 700 Q415 660 425 580"/>' +
            /* stars around */
            '<path d="M140 220 L150 235 L165 240 L150 245 L140 260 L130 245 L115 240 L130 235 Z" fill="currentColor"/>' +
            '<path d="M650 180 L660 195 L675 200 L660 205 L650 220 L640 205 L625 200 L640 195 Z" fill="currentColor"/>' +
            '<path d="M620 480 L628 492 L640 496 L628 500 L620 512 L612 500 L600 496 L612 492 Z" fill="currentColor"/>' +
        '</svg>'
    },
    {
        id: "fish",
        name: "FISH",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* body */
            '<path d="M180 400 Q260 240 480 240 Q620 240 660 400 Q620 560 480 560 Q260 560 180 400 Z"/>' +
            /* tail */
            '<path d="M180 400 L80 280 L120 400 L80 520 Z"/>' +
            /* top fin */
            '<path d="M380 252 Q400 180 460 230"/>' +
            /* bottom fin */
            '<path d="M380 548 Q400 620 460 570"/>' +
            /* side fin */
            '<path d="M380 400 Q360 470 440 480"/>' +
            /* gill arc */
            '<path d="M260 320 Q240 400 260 480"/>' +
            /* eye */
            '<circle cx="555" cy="370" r="26"/>' +
            '<circle cx="555" cy="370" r="10" fill="currentColor"/>' +
            /* mouth */
            '<path d="M640 410 Q655 430 635 445"/>' +
            /* scales — three small arcs */
            '<path d="M320 380 Q340 400 320 420"/>' +
            '<path d="M390 380 Q410 400 390 420"/>' +
            '<path d="M460 380 Q480 400 460 420"/>' +
            /* bubbles */
            '<circle cx="700" cy="280" r="14"/>' +
            '<circle cx="730" cy="230" r="9"/>' +
            '<circle cx="715" cy="195" r="6"/>' +
        '</svg>'
    },
    {
        id: "house",
        name: "TINY HOUSE",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* roof */
            '<path d="M150 380 L400 200 L650 380 Z"/>' +
            /* body */
            '<path d="M200 380 L200 620 L600 620 L600 380"/>' +
            /* door */
            '<path d="M350 620 L350 480 Q350 460 370 460 L430 460 Q450 460 450 480 L450 620"/>' +
            /* door knob */
            '<circle cx="430" cy="540" r="6" fill="currentColor"/>' +
            /* left window */
            '<rect x="240" y="430" width="80" height="80"/>' +
            '<line x1="280" y1="430" x2="280" y2="510"/>' +
            '<line x1="240" y1="470" x2="320" y2="470"/>' +
            /* right window */
            '<rect x="480" y="430" width="80" height="80"/>' +
            '<line x1="520" y1="430" x2="520" y2="510"/>' +
            '<line x1="480" y1="470" x2="560" y2="470"/>' +
            /* chimney */
            '<path d="M510 290 L510 220 L560 220 L560 330"/>' +
            /* smoke */
            '<path d="M520 200 Q545 180 535 160 Q525 140 545 130"/>' +
            /* sun in corner */
            '<circle cx="700" cy="150" r="40"/>' +
            '<line x1="700" y1="80" x2="700" y2="100"/>' +
            '<line x1="630" y1="150" x2="650" y2="150"/>' +
            '<line x1="655" y1="105" x2="668" y2="118"/>' +
            /* ground line */
            '<line x1="120" y1="620" x2="680" y2="620"/>' +
        '</svg>'
    }
];
