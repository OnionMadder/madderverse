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
            /* Closed spikes, one rotate group each. These were bare
               <line>s: a sun with eight rays no kid could colour in.
               Kept detached from the disc by a ~20px gap so the body
               stays a single cell. */
            '<g transform="rotate(0 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
            '<g transform="rotate(45 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
            '<g transform="rotate(90 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
            '<g transform="rotate(135 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
            '<g transform="rotate(180 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
            '<g transform="rotate(225 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
            '<g transform="rotate(270 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
            '<g transform="rotate(315 400 400)"><path d="M378 182 L422 182 L400 112 Z"/></g>' +
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
            '<path d="M379 250 Q400 180 458 240 Z"/>' +
            /* bottom fin */
            '<path d="M361 546 Q400 620 437 558 Z"/>' +
            /* side fin */
            '<path d="M380 400 Q360 470 440 480 Z"/>' +
            /* gill arc */
            '<path d="M260 303 Q240 400 260 499"/>' +
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
    },
    {
        id: "happy-dog",
        name: "HAPPY DOG",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* head */
            '<ellipse cx="400" cy="430" rx="210" ry="180"/>' +
            /* floppy left ear */
            '<path d="M240 290 L160 470 Q170 520 220 510 L270 410 Z"/>' +
            /* floppy right ear */
            '<path d="M560 290 L640 470 Q630 520 580 510 L530 410 Z"/>' +
            /* eyes */
            '<circle cx="320" cy="380" r="20" fill="currentColor"/>' +
            '<circle cx="480" cy="380" r="20" fill="currentColor"/>' +
            /* nose */
            '<ellipse cx="400" cy="460" rx="38" ry="28" fill="currentColor"/>' +
            /* under nose */
            '<line x1="400" y1="488" x2="400" y2="520"/>' +
            /* smile */
            '<path d="M400 520 Q370 555 340 540"/>' +
            '<path d="M400 520 Q430 555 460 540"/>' +
            /* tongue */
            '<path d="M385 540 Q400 590 415 540 Z"/>' +
            /* eyebrow tufts */
            '<path d="M290 330 Q310 320 330 340"/>' +
            '<path d="M510 330 Q490 320 470 340"/>' +
        '</svg>'
    },
    {
        id: "bear",
        name: "BEAR",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* head */
            '<circle cx="400" cy="440" r="230"/>' +
            /* ears */
            '<circle cx="225" cy="240" r="80"/>' +
            '<circle cx="575" cy="240" r="80"/>' +
            '<circle cx="225" cy="240" r="40"/>' +
            '<circle cx="575" cy="240" r="40"/>' +
            /* snout */
            '<ellipse cx="400" cy="510" rx="125" ry="90"/>' +
            /* eyes */
            '<circle cx="345" cy="400" r="16" fill="currentColor"/>' +
            '<circle cx="455" cy="400" r="16" fill="currentColor"/>' +
            /* nose */
            '<ellipse cx="400" cy="475" rx="24" ry="18" fill="currentColor"/>' +
            /* mouth */
            '<line x1="400" y1="493" x2="400" y2="525"/>' +
            '<path d="M400 525 Q378 545 360 535"/>' +
            '<path d="M400 525 Q422 545 440 535"/>' +
            /* cheek dots */
            '<circle cx="295" cy="500" r="14"/>' +
            '<circle cx="505" cy="500" r="14"/>' +
        '</svg>'
    },
    {
        id: "butterfly",
        name: "BUTTERFLY",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* body */
            '<ellipse cx="400" cy="440" rx="22" ry="130"/>' +
            /* head */
            '<circle cx="400" cy="285" r="30"/>' +
            /* antennae */
            '<path d="M388 265 Q360 215 340 200"/>' +
            '<path d="M412 265 Q440 215 460 200"/>' +
            '<circle cx="340" cy="200" r="9" fill="currentColor"/>' +
            '<circle cx="460" cy="200" r="9" fill="currentColor"/>' +
            /* upper-left wing */
            '<path d="M380 340 Q200 190 120 360 Q150 490 380 440 Z"/>' +
            /* upper-right wing */
            '<path d="M420 340 Q600 190 680 360 Q650 490 420 440 Z"/>' +
            /* lower-left wing */
            '<path d="M380 460 Q220 510 170 630 Q290 690 390 540 Z"/>' +
            /* lower-right wing */
            '<path d="M420 460 Q580 510 630 630 Q510 690 410 540 Z"/>' +
            /* wing decoration: circles */
            '<circle cx="210" cy="340" r="22"/>' +
            '<circle cx="590" cy="340" r="22"/>' +
            '<circle cx="240" cy="590" r="16"/>' +
            '<circle cx="560" cy="590" r="16"/>' +
            /* body segment lines */
            '<line x1="378" y1="380" x2="422" y2="380"/>' +
            '<line x1="378" y1="420" x2="422" y2="420"/>' +
            '<line x1="378" y1="460" x2="422" y2="460"/>' +
            '<line x1="380" y1="500" x2="420" y2="500"/>' +
        '</svg>'
    },
    {
        id: "little-bird",
        name: "LITTLE BIRD",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* body */
            '<ellipse cx="420" cy="440" rx="210" ry="170"/>' +
            /* head */
            '<circle cx="290" cy="290" r="105"/>' +
            /* beak */
            '<path d="M200 295 L120 315 L200 345 Z"/>' +
            /* eye */
            '<circle cx="270" cy="270" r="14" fill="currentColor"/>' +
            /* head/body tuft */
            '<path d="M295 195 Q310 160 285 145 Q280 175 250 165 Q260 195 275 200"/>' +
            /* wing */
            '<path d="M440 380 Q560 460 490 560 Q400 540 380 460 Z"/>' +
            /* wing feather lines */
            '<path d="M440 400 Q480 440 470 490"/>' +
            '<path d="M460 430 Q495 470 485 510"/>' +
            /* tail feathers */
            '<path d="M610 410 L720 360 L700 430 L730 470 L660 480 L690 510 L620 490 Z"/>' +
            /* legs */
            '<line x1="380" y1="600" x2="380" y2="670"/>' +
            '<line x1="450" y1="600" x2="450" y2="670"/>' +
            /* feet (each is 3 toes) */
            '<path d="M380 670 L355 692"/>' +
            '<path d="M380 670 L380 695"/>' +
            '<path d="M380 670 L405 692"/>' +
            '<path d="M450 670 L425 692"/>' +
            '<path d="M450 670 L450 695"/>' +
            '<path d="M450 670 L475 692"/>' +
        '</svg>'
    },
    {
        id: "car",
        name: "CAR",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* body */
            '<path d="M120 510 Q120 380 220 380 L300 380 Q330 280 410 280 L540 280 Q610 280 640 380 L720 380 Q720 510 720 510 L120 510 Z"/>' +
            /* roof window line */
            '<path d="M300 380 L345 320 L530 320 L580 380"/>' +
            /* door divider */
            '<line x1="425" y1="320" x2="425" y2="510"/>' +
            /* door handles */
            '<line x1="370" y1="430" x2="410" y2="430"/>' +
            '<line x1="500" y1="430" x2="540" y2="430"/>' +
            /* front wheel */
            '<circle cx="230" cy="520" r="75"/>' +
            '<circle cx="230" cy="520" r="32"/>' +
            /* rear wheel */
            '<circle cx="610" cy="520" r="75"/>' +
            '<circle cx="610" cy="520" r="32"/>' +
            /* headlight */
            '<ellipse cx="140" cy="405" rx="22" ry="16"/>' +
            /* ground line */
            '<line x1="80" y1="610" x2="720" y2="610"/>' +
        '</svg>'
    },
    {
        id: "airplane",
        name: "AIRPLANE",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* fuselage */
            '<path d="M140 400 Q140 320 270 320 L640 320 Q680 360 680 400 Q680 440 640 480 L270 480 Q140 480 140 400 Z"/>' +
            /* tail fin */
            '<path d="M620 320 L700 200 L720 320 Z"/>' +
            /* elevator */
            '<path d="M650 460 L720 440 L720 470 L650 480 Z"/>' +
            /* main wing */
            '<path d="M340 460 L230 600 L410 600 L460 460 Z"/>' +
            /* nose cone propeller hub */
            '<circle cx="140" cy="400" r="16"/>' +
            /* propeller vertical */
            '<line x1="140" y1="320" x2="140" y2="480"/>' +
            /* propeller horizontal */
            '<line x1="60"  y1="400" x2="230" y2="400"/>' +
            /* cockpit window */
            '<circle cx="245" cy="370" r="22"/>' +
            /* cabin windows */
            '<circle cx="335" cy="400" r="14"/>' +
            '<circle cx="395" cy="400" r="14"/>' +
            '<circle cx="455" cy="400" r="14"/>' +
            '<circle cx="515" cy="400" r="14"/>' +
            '<circle cx="575" cy="400" r="14"/>' +
            /* tiny cloud */
            '<path d="M200 200 Q180 180 200 165 Q210 145 240 155 Q280 145 290 175 Q310 195 280 210 Z"/>' +
        '</svg>'
    },
    {
        id: "big-truck",
        name: "BIG TRUCK",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* trailer box */
            '<rect x="280" y="220" width="430" height="280"/>' +
            /* trailer door divider */
            '<line x1="495" y1="220" x2="495" y2="500"/>' +
            /* trailer door handle plates */
            '<rect x="450" y="320" width="40" height="60"/>' +
            '<rect x="500" y="320" width="40" height="60"/>' +
            /* cab */
            '<path d="M80 360 L80 290 Q80 250 120 250 L240 250 Q280 250 280 290 L280 500 L80 500 Z"/>' +
            /* windshield */
            '<rect x="120" y="290" width="135" height="90"/>' +
            /* wheels */
            '<circle cx="180" cy="510" r="55"/>' +
            '<circle cx="180" cy="510" r="22"/>' +
            '<circle cx="370" cy="510" r="55"/>' +
            '<circle cx="370" cy="510" r="22"/>' +
            '<circle cx="490" cy="510" r="55"/>' +
            '<circle cx="490" cy="510" r="22"/>' +
            '<circle cx="610" cy="510" r="55"/>' +
            '<circle cx="610" cy="510" r="22"/>' +
            /* side mirror */
            '<rect x="45" y="295" width="35" height="35"/>' +
            /* ground line */
            '<line x1="40" y1="590" x2="730" y2="590"/>' +
        '</svg>'
    },
    {
        id: "unicorn",
        name: "UNICORN",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* head + neck */
            '<path d="M280 600 L300 400 Q310 280 420 240 L520 220 Q580 230 605 270 Q625 320 600 365 L585 385 Q565 405 540 415 L520 460 Q500 540 510 600 Z"/>' +
            /* ear */
            '<path d="M510 230 L535 160 L555 230 Z"/>' +
            /* horn */
            '<path d="M460 220 L450 80 L490 80 L470 215 Z"/>' +
            /* horn spirals */
            '<line x1="455" y1="200" x2="485" y2="200"/>' +
            '<line x1="455" y1="170" x2="485" y2="170"/>' +
            '<line x1="458" y1="140" x2="482" y2="140"/>' +
            '<line x1="461" y1="110" x2="478" y2="110"/>' +
            /* eye */
            '<ellipse cx="525" cy="295" rx="14" ry="10" fill="currentColor"/>' +
            /* eyelash */
            '<line x1="540" y1="278" x2="552" y2="270"/>' +
            /* nostril */
            '<ellipse cx="590" cy="345" rx="6" ry="10" fill="currentColor"/>' +
            /* mouth */
            '<path d="M585 385 Q570 400 555 393"/>' +
            /* mane wave 1 */
            '<path d="M400 260 Q330 240 290 280 Q280 320 320 340"/>' +
            /* mane wave 2 */
            '<path d="M380 320 Q280 330 250 380 Q260 420 310 430"/>' +
            /* mane wave 3 */
            '<path d="M340 400 Q240 430 220 500 Q230 540 290 550"/>' +
            /* mane wave 4 */
            '<path d="M310 500 Q240 560 250 620 Q280 640 320 620"/>' +
            /* sparkle stars */
            '<path d="M650 460 L660 480 L680 485 L660 495 L650 515 L640 495 L620 485 L640 480 Z" fill="currentColor"/>' +
            '<path d="M170 320 L177 332 L190 335 L177 338 L170 350 L163 338 L150 335 L163 332 Z" fill="currentColor"/>' +
            '<path d="M690 230 L696 240 L706 242 L696 244 L690 254 L684 244 L674 242 L684 240 Z" fill="currentColor"/>' +
        '</svg>'
    },
    {
        id: "dragon",
        name: "FRIENDLY DRAGON",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* body */
            '<ellipse cx="430" cy="460" rx="240" ry="160"/>' +
            /* head */
            '<circle cx="320" cy="290" r="125"/>' +
            /* snout */
            '<ellipse cx="230" cy="320" rx="65" ry="42"/>' +
            /* nostrils */
            '<circle cx="215" cy="308" r="6" fill="currentColor"/>' +
            '<circle cx="215" cy="336" r="6" fill="currentColor"/>' +
            /* horns */
            '<path d="M275 190 L255 105 L300 160 Z"/>' +
            '<path d="M365 190 L385 105 L340 160 Z"/>' +
            /* eye outer + pupil */
            '<circle cx="310" cy="265" r="24"/>' +
            '<circle cx="310" cy="267" r="11" fill="currentColor"/>' +
            /* smile */
            '<path d="M240 360 Q280 395 320 375"/>' +
            /* back spike row */
            '<path d="M340 320 L370 270 L400 320 L430 270 L460 320 L490 270 L520 320 L550 280 L580 330 L610 320"/>' +
            /* wing 1 */
            '<path d="M440 380 Q510 280 610 285 Q625 325 580 380 Z"/>' +
            /* wing 2 (back) */
            '<path d="M500 360 Q600 240 690 270 Q705 320 650 380 Z"/>' +
            /* tail */
            '<path d="M630 490 Q730 490 730 550 Q710 570 685 555"/>' +
            /* front legs */
            '<path d="M285 590 L265 670 L310 670 L300 605"/>' +
            /* back legs */
            '<path d="M510 600 L495 670 L540 670 L540 610"/>' +
        '</svg>'
    },
    {
        id: "castle",
        name: "CASTLE",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* left tower body */
            '<rect x="120" y="280" width="140" height="320"/>' +
            /* left tower roof */
            '<path d="M120 280 L190 175 L260 280 Z"/>' +
            /* left tower flag pole */
            '<line x1="190" y1="175" x2="190" y2="110"/>' +
            /* left tower flag */
            '<path d="M190 120 L245 138 L190 156 Z"/>' +
            /* left tower window */
            '<path d="M170 360 L210 360 L210 410 Q210 430 190 430 Q170 430 170 410 Z"/>' +
            /* right tower body */
            '<rect x="540" y="280" width="140" height="320"/>' +
            /* right tower roof */
            '<path d="M540 280 L610 175 L680 280 Z"/>' +
            /* right tower flag pole */
            '<line x1="610" y1="175" x2="610" y2="110"/>' +
            /* right tower flag */
            '<path d="M610 120 L665 138 L610 156 Z"/>' +
            /* right tower window */
            '<path d="M590 360 L630 360 L630 410 Q630 430 610 430 Q590 430 590 410 Z"/>' +
            /* main keep */
            '<rect x="260" y="340" width="280" height="260"/>' +
            /* keep crenellations */
            '<path d="M260 340 L260 320 L290 320 L290 340 L320 340 L320 320 L350 320 L350 340 L380 340 L380 320 L420 320 L420 340 L450 340 L450 320 L480 320 L480 340 L510 340 L510 320 L540 320 L540 340"/>' +
            /* arched door */
            '<path d="M360 600 L360 480 Q360 440 400 440 Q440 440 440 480 L440 600 Z"/>' +
            /* door divider */
            '<line x1="400" y1="442" x2="400" y2="600"/>' +
            /* door hinges */
            '<rect x="372" y="500" width="14" height="14"/>' +
            '<rect x="414" y="500" width="14" height="14"/>' +
            /* keep window */
            '<circle cx="400" cy="395" r="18"/>' +
            /* ground line */
            '<line x1="80" y1="600" x2="720" y2="600"/>' +
        '</svg>'
    },
    {
        id: "donut",
        name: "DONUT",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* outer donut */
            '<circle cx="400" cy="400" r="280"/>' +
            /* hole */
            '<circle cx="400" cy="400" r="80"/>' +
            /* frosting edge — wavy inner ring */
            '<path d="M400 160 Q510 140 580 195 Q655 250 660 330 Q680 415 635 480 Q605 565 525 605 Q445 640 360 630 Q280 620 220 555 Q160 495 145 410 Q135 320 185 245 Q235 175 320 150 Q360 140 400 145 Z"/>' +
            /* drizzle ribbons */
            /* Closed ribbons, not open curves. Each is the source
               curve offset +-11 units: the ends move along their own
               tangent normals and the control point is the intersection
               of the two offset tangent lines, which keeps the offset
               curve tangent to the original at both ends so the ribbon
               keeps an even width instead of pinching. Each ribbon is
               now its own fillable cell floating in the frosting. */
            '<path d="M244 254 Q290 288 260 339 L280 351 Q320 282 256 236 Z"/>' +
            '<path d="M521 236 Q550 277 504 311 L516 329 Q580 283 539 224 Z"/>' +
            '<path d="M544 490 Q602 467 591 403 L569 407 Q578 453 536 470 Z"/>' +
            '<path d="M250 475 Q214 548 293 566 L297 544 Q246 532 270 485 Z"/>' +
            /* sprinkles */
            '<ellipse cx="220" cy="350" rx="6" ry="14" transform="rotate(30 220 350)" fill="currentColor"/>' +
            '<ellipse cx="300" cy="210" rx="6" ry="14" transform="rotate(-20 300 210)" fill="currentColor"/>' +
            '<ellipse cx="490" cy="200" rx="6" ry="14" transform="rotate(40 490 200)" fill="currentColor"/>' +
            '<ellipse cx="600" cy="285" rx="6" ry="14" transform="rotate(-15 600 285)" fill="currentColor"/>' +
            '<ellipse cx="595" cy="440" rx="6" ry="14" transform="rotate(60 595 440)" fill="currentColor"/>' +
            '<ellipse cx="510" cy="565" rx="6" ry="14" transform="rotate(-30 510 565)" fill="currentColor"/>' +
            '<ellipse cx="345" cy="605" rx="6" ry="14" transform="rotate(20 345 605)" fill="currentColor"/>' +
            '<ellipse cx="205" cy="455" rx="6" ry="14" transform="rotate(-45 205 455)" fill="currentColor"/>' +
            '<ellipse cx="175" cy="295" rx="6" ry="14" transform="rotate(10 175 295)" fill="currentColor"/>' +
        '</svg>'
    },
    {
        id: "ice-cream",
        name: "ICE CREAM",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* cone */
            '<path d="M260 400 L540 400 L420 700 L380 700 Z"/>' +
            /* waffle horizontals */
            '<line x1="290" y1="450" x2="510" y2="450"/>' +
            '<line x1="310" y1="510" x2="490" y2="510"/>' +
            '<line x1="330" y1="570" x2="470" y2="570"/>' +
            '<line x1="350" y1="630" x2="450" y2="630"/>' +
            /* waffle diagonals (one direction) */
            '<line x1="330" y1="400" x2="370" y2="700"/>' +
            '<line x1="400" y1="400" x2="410" y2="700"/>' +
            '<line x1="470" y1="400" x2="445" y2="700"/>' +
            /* scoop 1 (bottom) */
            '<path d="M240 385 Q260 280 380 270 Q420 265 470 280 Q570 300 560 385 Z"/>' +
            /* scoop 1 drip */
            '<path d="M295 385 Q285 415 305 430 Q320 410 310 385"/>' +
            '<path d="M495 385 Q505 415 485 430 Q470 410 480 385"/>' +
            /* scoop 2 (top) */
            '<path d="M290 270 Q310 175 405 165 Q470 175 510 230 Q535 265 510 280"/>' +
            /* cherry */
            '<circle cx="400" cy="135" r="30"/>' +
            /* stem */
            '<path d="M400 105 Q420 75 442 88"/>' +
            /* leaf */
            '<path d="M442 88 Q458 80 460 60 Q445 65 442 88 Z"/>' +
        '</svg>'
    },
    {
        id: "dinosaur",
        name: "DINOSAUR",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* body */
            '<path d="M180 470 Q180 360 270 350 L470 330 Q540 335 580 370 L660 390 Q700 420 700 470 L640 490 L180 490 Z"/>' +
            /* head */
            '<ellipse cx="200" cy="360" rx="65" ry="58"/>' +
            /* eye */
            '<circle cx="180" cy="345" r="10" fill="currentColor"/>' +
            /* eyebrow */
            '<path d="M155 320 Q175 312 200 322"/>' +
            /* smile */
            '<path d="M145 380 Q170 395 200 385"/>' +
            /* tail */
            '<path d="M700 450 Q765 460 770 490 Q745 510 700 500"/>' +
            /* back plates */
            '<path d="M270 330 L295 240 L325 330 Z"/>' +
            '<path d="M345 320 L385 215 L425 320 Z"/>' +
            '<path d="M445 320 L490 195 L530 320 Z"/>' +
            '<path d="M545 330 L585 220 L625 330 Z"/>' +
            '<path d="M640 350 L680 285 L700 365 Z"/>' +
            /* legs */
            '<path d="M260 490 L255 595 L325 595 L320 490"/>' +
            '<path d="M495 490 L490 595 L560 595 L555 490"/>' +
            /* toes */
            '<path d="M260 595 L250 615"/>' +
            '<path d="M285 595 L285 615"/>' +
            '<path d="M310 595 L320 615"/>' +
            '<path d="M495 595 L485 615"/>' +
            '<path d="M520 595 L520 615"/>' +
            '<path d="M550 595 L560 615"/>' +
            /* ground line */
            '<line x1="120" y1="615" x2="720" y2="615"/>' +
        '</svg>'
    },
    {
        id: "robot",
        name: "ROBOT",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* antenna */
            '<line x1="400" y1="100" x2="400" y2="160"/>' +
            '<circle cx="400" cy="92" r="16"/>' +
            /* head */
            '<rect x="280" y="160" width="240" height="200" rx="22"/>' +
            /* face screen */
            '<rect x="310" y="190" width="180" height="140" rx="8"/>' +
            /* eyes */
            '<circle cx="362" cy="250" r="22"/>' +
            '<circle cx="362" cy="252" r="9" fill="currentColor"/>' +
            '<circle cx="438" cy="250" r="22"/>' +
            '<circle cx="438" cy="252" r="9" fill="currentColor"/>' +
            /* mouth grill */
            '<rect x="350" y="295" width="100" height="18" rx="4"/>' +
            '<line x1="370" y1="295" x2="370" y2="313"/>' +
            '<line x1="390" y1="295" x2="390" y2="313"/>' +
            '<line x1="410" y1="295" x2="410" y2="313"/>' +
            '<line x1="430" y1="295" x2="430" y2="313"/>' +
            /* neck */
            '<rect x="370" y="360" width="60" height="30"/>' +
            /* body */
            '<rect x="220" y="390" width="360" height="240" rx="14"/>' +
            /* chest panel */
            '<rect x="285" y="435" width="230" height="130" rx="6"/>' +
            /* buttons */
            '<circle cx="335" cy="475" r="14"/>' +
            '<circle cx="400" cy="475" r="14"/>' +
            '<circle cx="465" cy="475" r="14"/>' +
            /* readout line */
            '<line x1="305" y1="525" x2="495" y2="525"/>' +
            '<line x1="305" y1="545" x2="455" y2="545"/>' +
            /* arms */
            '<rect x="140" y="410" width="80" height="180" rx="14"/>' +
            '<rect x="580" y="410" width="80" height="180" rx="14"/>' +
            /* hands */
            '<circle cx="180" cy="620" r="30"/>' +
            '<circle cx="620" cy="620" r="30"/>' +
            /* legs */
            '<rect x="270" y="630" width="80" height="100"/>' +
            '<rect x="450" y="630" width="80" height="100"/>' +
            /* feet */
            '<ellipse cx="310" cy="745" rx="60" ry="16"/>' +
            '<ellipse cx="490" cy="745" rx="60" ry="16"/>' +
        '</svg>'
    },
    {
        id: "snowflake",
        name: "SNOWFLAKE",
        /* Every element here is a CLOSED path on purpose. The first
           version drew the arms as bare <line>s with open chevrons
           hanging off them, which looks like a snowflake but has no
           enclosed area at all — so the fill tool had exactly one
           region to work with (the whole page) and tapping anywhere
           flooded the lot.
           Rebuilt as: a flat-top centre hexagon whose top edge the
           arm shafts sit flush on, then per arm a closed shaft, a
           closed tip triangle and four closed leaflets. 37 fillable
           cells. Shaft edges are deliberately VERTICAL (x=380/420) so
           the leaflets can attach at exact coordinates — a tapered
           shaft needs the attachment x recomputed per height, and a
           sub-pixel mismatch there opens a gap the fill escapes
           through. */
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* centre hexagon — flat-top, so each arm base sits on an edge */
            '<path d="M460 400 L430 348 L370 348 L340 400 L370 452 L430 452 Z"/>' +
            '<g transform="rotate(0 400 400)">' +
                /* shaft */
                '<path d="M380 348 L380 170 L420 170 L420 348 Z"/>' +
                /* tip */
                '<path d="M380 170 L420 170 L400 106 Z"/>' +
                /* lower leaflets */
                '<path d="M380 300 L332 266 L346 240 L380 264 Z"/>' +
                '<path d="M420 300 L468 266 L454 240 L420 264 Z"/>' +
                /* upper leaflets */
                '<path d="M380 232 L342 204 L352 180 L380 202 Z"/>' +
                '<path d="M420 232 L458 204 L448 180 L420 202 Z"/>' +
            '</g>' +
            '<g transform="rotate(60 400 400)">' +
                /* shaft */
                '<path d="M380 348 L380 170 L420 170 L420 348 Z"/>' +
                /* tip */
                '<path d="M380 170 L420 170 L400 106 Z"/>' +
                /* lower leaflets */
                '<path d="M380 300 L332 266 L346 240 L380 264 Z"/>' +
                '<path d="M420 300 L468 266 L454 240 L420 264 Z"/>' +
                /* upper leaflets */
                '<path d="M380 232 L342 204 L352 180 L380 202 Z"/>' +
                '<path d="M420 232 L458 204 L448 180 L420 202 Z"/>' +
            '</g>' +
            '<g transform="rotate(120 400 400)">' +
                /* shaft */
                '<path d="M380 348 L380 170 L420 170 L420 348 Z"/>' +
                /* tip */
                '<path d="M380 170 L420 170 L400 106 Z"/>' +
                /* lower leaflets */
                '<path d="M380 300 L332 266 L346 240 L380 264 Z"/>' +
                '<path d="M420 300 L468 266 L454 240 L420 264 Z"/>' +
                /* upper leaflets */
                '<path d="M380 232 L342 204 L352 180 L380 202 Z"/>' +
                '<path d="M420 232 L458 204 L448 180 L420 202 Z"/>' +
            '</g>' +
            '<g transform="rotate(180 400 400)">' +
                /* shaft */
                '<path d="M380 348 L380 170 L420 170 L420 348 Z"/>' +
                /* tip */
                '<path d="M380 170 L420 170 L400 106 Z"/>' +
                /* lower leaflets */
                '<path d="M380 300 L332 266 L346 240 L380 264 Z"/>' +
                '<path d="M420 300 L468 266 L454 240 L420 264 Z"/>' +
                /* upper leaflets */
                '<path d="M380 232 L342 204 L352 180 L380 202 Z"/>' +
                '<path d="M420 232 L458 204 L448 180 L420 202 Z"/>' +
            '</g>' +
            '<g transform="rotate(240 400 400)">' +
                /* shaft */
                '<path d="M380 348 L380 170 L420 170 L420 348 Z"/>' +
                /* tip */
                '<path d="M380 170 L420 170 L400 106 Z"/>' +
                /* lower leaflets */
                '<path d="M380 300 L332 266 L346 240 L380 264 Z"/>' +
                '<path d="M420 300 L468 266 L454 240 L420 264 Z"/>' +
                /* upper leaflets */
                '<path d="M380 232 L342 204 L352 180 L380 202 Z"/>' +
                '<path d="M420 232 L458 204 L448 180 L420 202 Z"/>' +
            '</g>' +
            '<g transform="rotate(300 400 400)">' +
                /* shaft */
                '<path d="M380 348 L380 170 L420 170 L420 348 Z"/>' +
                /* tip */
                '<path d="M380 170 L420 170 L400 106 Z"/>' +
                /* lower leaflets */
                '<path d="M380 300 L332 266 L346 240 L380 264 Z"/>' +
                '<path d="M420 300 L468 266 L454 240 L420 264 Z"/>' +
                /* upper leaflets */
                '<path d="M380 232 L342 204 L352 180 L380 202 Z"/>' +
                '<path d="M420 232 L458 204 L448 180 L420 202 Z"/>' +
            '</g>' +
            /* tiny solid stars — decoration, not fillable */
            '<path d="M120 200 L128 215 L144 218 L128 222 L120 237 L112 222 L96 218 L112 215 Z" fill="currentColor"/>' +
            '<path d="M680 600 L688 615 L704 618 L688 622 L680 637 L672 622 L656 618 L672 615 Z" fill="currentColor"/>' +
            '<path d="M660 190 L667 204 L681 207 L667 210 L660 224 L653 210 L639 207 L653 204 Z" fill="currentColor"/>' +
            '<path d="M140 610 L147 624 L161 627 L147 630 L140 644 L133 630 L119 627 L133 624 Z" fill="currentColor"/>' +
        '</svg>'
    },
    {
        id: "flower",
        name: "BIG FLOWER",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* stem — a closed sliver, not a line, so it can be filled */
            '<path d="M386 430 L386 706 L414 706 L414 430 Z"/>' +
            /* leaves */
            '<path d="M386 552 C 322 492, 244 512, 232 574 C 296 616, 366 606, 386 552 Z"/>' +
            '<path d="M414 622 C 478 562, 556 582, 568 644 C 504 686, 434 676, 414 622 Z"/>' +
            /* six petals around the centre */
            '<ellipse cx="400" cy="182" rx="62" ry="88"/>' +
            '<ellipse cx="400" cy="182" rx="62" ry="88" transform="rotate(60 400 300)"/>' +
            '<ellipse cx="400" cy="182" rx="62" ry="88" transform="rotate(120 400 300)"/>' +
            '<ellipse cx="400" cy="182" rx="62" ry="88" transform="rotate(180 400 300)"/>' +
            '<ellipse cx="400" cy="182" rx="62" ry="88" transform="rotate(240 400 300)"/>' +
            '<ellipse cx="400" cy="182" rx="62" ry="88" transform="rotate(300 400 300)"/>' +
            /* centre */
            '<circle cx="400" cy="300" r="58"/>' +
        '</svg>'
    },
    {
        id: "tree",
        name: "TALL TREE",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* trunk */
            '<path d="M366 700 L366 486 L434 486 L434 700 Z"/>' +
            /* canopy — one closed lumpy blob */
            '<path d="M400 112 C 252 112, 196 244, 258 322 C 192 378, 238 480, 344 480 L 456 480 C 562 480, 608 378, 542 322 C 604 244, 548 112, 400 112 Z"/>' +
            /* a couple of apples */
            '<circle cx="330" cy="270" r="34"/>' +
            '<circle cx="470" cy="230" r="34"/>' +
            '<circle cx="440" cy="370" r="34"/>' +
            /* grass line */
            '<path d="M110 700 L690 700"/>' +
        '</svg>'
    },
    {
        id: "rainbow",
        name: "RAINBOW",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* four closed half-annulus bands — each one fills separately */
            '<path d="M80 600 A 320 320 0 0 1 720 600 L 665 600 A 265 265 0 0 0 135 600 Z"/>' +
            '<path d="M135 600 A 265 265 0 0 1 665 600 L 610 600 A 210 210 0 0 0 190 600 Z"/>' +
            '<path d="M190 600 A 210 210 0 0 1 610 600 L 555 600 A 155 155 0 0 0 245 600 Z"/>' +
            '<path d="M245 600 A 155 155 0 0 1 555 600 L 500 600 A 100 100 0 0 0 300 600 Z"/>' +
            /* a cloud at each foot */
            '<path d="M96 672 C 58 672, 52 622, 96 616 C 102 572, 172 566, 190 604 C 240 592, 266 648, 228 672 Z"/>' +
            '<path d="M704 672 C 742 672, 748 622, 704 616 C 698 572, 628 566, 610 604 C 560 592, 534 648, 572 672 Z"/>' +
        '</svg>'
    },
    {
        id: "cupcake",
        name: "CUPCAKE",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* wrapper */
            '<path d="M266 434 L330 704 L470 704 L534 434 Z"/>' +
            /* pleats — these split the wrapper into separate fill zones */
            '<line x1="332" y1="434" x2="366" y2="704"/>' +
            '<line x1="400" y1="434" x2="400" y2="704"/>' +
            '<line x1="468" y1="434" x2="434" y2="704"/>' +
            /* frosting */
            '<path d="M266 434 C 240 348, 296 300, 340 314 C 352 246, 448 236, 466 302 C 528 292, 562 356, 534 434 Z"/>' +
            /* cherry */
            '<circle cx="400" cy="212" r="44"/>' +
            '<path d="M400 168 C 404 132, 430 116, 456 118"/>' +
        '</svg>'
    },
    {
        id: "hot-air-balloon",
        name: "BALLOON RIDE",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* envelope */
            '<path d="M400 104 C 258 104, 186 228, 228 340 C 258 418, 340 476, 400 508 C 460 476, 542 418, 572 340 C 614 228, 542 104, 400 104 Z"/>' +
            /* two seams — split the envelope into three fillable panels */
            '<path d="M330 122 C 284 248, 300 404, 356 496"/>' +
            '<path d="M470 122 C 516 248, 500 404, 444 496"/>' +
            /* ropes */
            '<line x1="326" y1="474" x2="356" y2="576"/>' +
            '<line x1="474" y1="474" x2="444" y2="576"/>' +
            /* basket */
            '<path d="M350 576 L362 668 L438 668 L450 576 Z"/>' +
            '<line x1="354" y1="614" x2="446" y2="614"/>' +
        '</svg>'
    },
    {
        id: "sailboat",
        name: "SAILBOAT",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* hull */
            '<path d="M172 552 L628 552 L562 664 L238 664 Z"/>' +
            /* mast */
            '<path d="M392 168 L392 552 L408 552 L408 168 Z"/>' +
            /* main sail + jib */
            '<path d="M424 196 L424 516 L610 516 Z"/>' +
            '<path d="M376 244 L376 516 L228 516 Z"/>' +
            /* flag */
            '<path d="M408 168 L470 190 L408 212 Z"/>' +
            /* water */
            '<path d="M110 704 q42 -26 84 0 t84 0 t84 0 t84 0 t84 0 t84 0"/>' +
        '</svg>'
    },
    {
        id: "train",
        name: "TRAIN",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* boiler + cab */
            '<rect x="176" y="384" width="392" height="176" rx="16"/>' +
            '<rect x="430" y="252" width="138" height="132" rx="14"/>' +
            '<rect x="464" y="284" width="70" height="66" rx="8"/>' +
            /* funnel */
            '<path d="M234 384 L234 300 L300 300 L300 384 Z"/>' +
            '<rect x="216" y="262" width="102" height="40" rx="10"/>' +
            /* wheels */
            '<circle cx="252" cy="600" r="54"/>' +
            '<circle cx="252" cy="600" r="18"/>' +
            '<circle cx="400" cy="600" r="54"/>' +
            '<circle cx="400" cy="600" r="18"/>' +
            '<circle cx="548" cy="600" r="54"/>' +
            '<circle cx="548" cy="600" r="18"/>' +
            /* rail */
            '<path d="M110 672 L690 672"/>' +
        '</svg>'
    },
    {
        id: "frog",
        name: "FROG",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* back feet */
            '<ellipse cx="242" cy="618" rx="72" ry="40"/>' +
            '<ellipse cx="558" cy="618" rx="72" ry="40"/>' +
            /* body */
            '<ellipse cx="400" cy="452" rx="212" ry="168"/>' +
            /* eye domes */
            '<circle cx="318" cy="296" r="62"/>' +
            '<circle cx="482" cy="296" r="62"/>' +
            '<circle cx="318" cy="302" r="20" fill="currentColor"/>' +
            '<circle cx="482" cy="302" r="20" fill="currentColor"/>' +
            /* smile — splits the body into two fill zones */
            '<path d="M286 466 Q400 552 514 466"/>' +
            /* tummy */
            '<path d="M400 508 C 336 508, 306 560, 322 606 C 372 632, 428 632, 478 606 C 494 560, 464 508, 400 508 Z"/>' +
        '</svg>'
    },
    {
        id: "owl",
        name: "SLEEPY OWL",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* branch */
            '<path d="M104 682 L696 682 L696 714 L104 714 Z"/>' +
            /* body */
            '<path d="M400 132 C 250 132, 190 288, 202 424 C 214 566, 302 660, 400 660 C 498 660, 586 566, 598 424 C 610 288, 550 132, 400 132 Z"/>' +
            /* ear tufts */
            '<path d="M250 196 L214 118 L302 156 Z"/>' +
            '<path d="M550 196 L586 118 L498 156 Z"/>' +
            /* wings */
            '<path d="M214 376 C 176 464, 198 566, 252 606 C 268 524, 262 434, 240 380 Z"/>' +
            '<path d="M586 376 C 624 464, 602 566, 548 606 C 532 524, 538 434, 560 380 Z"/>' +
            /* eyes */
            '<circle cx="324" cy="322" r="76"/>' +
            '<circle cx="476" cy="322" r="76"/>' +
            '<circle cx="324" cy="322" r="28" fill="currentColor"/>' +
            '<circle cx="476" cy="322" r="28" fill="currentColor"/>' +
            /* beak */
            '<path d="M400 372 L362 428 L438 428 Z"/>' +
            /* tummy */
            '<path d="M400 452 C 334 452, 304 530, 322 606 C 362 642, 438 642, 478 606 C 496 530, 466 452, 400 452 Z"/>' +
            /* feet */
            '<path d="M348 660 L336 682 L392 682 L386 660 Z"/>' +
            '<path d="M452 660 L464 682 L408 682 L414 660 Z"/>' +
        '</svg>'
    },
    {
        id: "turtle",
        name: "TURTLE",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* flippers */
            '<ellipse cx="212" cy="288" rx="74" ry="46" transform="rotate(-28 212 288)"/>' +
            '<ellipse cx="212" cy="512" rx="74" ry="46" transform="rotate(28 212 512)"/>' +
            '<ellipse cx="560" cy="288" rx="74" ry="46" transform="rotate(28 560 288)"/>' +
            '<ellipse cx="560" cy="512" rx="74" ry="46" transform="rotate(-28 560 512)"/>' +
            /* head */
            '<circle cx="646" cy="400" r="64"/>' +
            '<circle cx="668" cy="380" r="13" fill="currentColor"/>' +
            /* shell */
            '<ellipse cx="400" cy="400" rx="224" ry="168"/>' +
            '<ellipse cx="400" cy="400" rx="128" ry="92"/>' +
            /* shell segments — split the outer ring into six fill zones */
            '<line x1="400" y1="232" x2="400" y2="308"/>' +
            '<line x1="400" y1="492" x2="400" y2="568"/>' +
            '<line x1="248" y1="304" x2="304" y2="352"/>' +
            '<line x1="248" y1="496" x2="304" y2="448"/>' +
            '<line x1="552" y1="304" x2="496" y2="352"/>' +
            '<line x1="552" y1="496" x2="496" y2="448"/>' +
        '</svg>'
    },
    {
        id: "ladybug",
        name: "LADYBUG",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* antennae */
            '<path d="M340 244 C 316 190, 288 168, 258 162"/>' +
            '<path d="M460 244 C 484 190, 512 168, 542 162"/>' +
            '<circle cx="252" cy="156" r="20"/>' +
            '<circle cx="548" cy="156" r="20"/>' +
            /* head */
            '<circle cx="400" cy="256" r="92"/>' +
            '<circle cx="366" cy="240" r="14" fill="currentColor"/>' +
            '<circle cx="434" cy="240" r="14" fill="currentColor"/>' +
            /* shell */
            '<circle cx="400" cy="454" r="204"/>' +
            /* wing split */
            '<line x1="400" y1="252" x2="400" y2="658"/>' +
            /* spots — outlined so each one fills on its own */
            '<circle cx="308" cy="378" r="40"/>' +
            '<circle cx="492" cy="378" r="40"/>' +
            '<circle cx="286" cy="512" r="34"/>' +
            '<circle cx="514" cy="512" r="34"/>' +
            '<circle cx="356" cy="592" r="30"/>' +
            '<circle cx="444" cy="592" r="30"/>' +
        '</svg>'
    },
    {
        id: "penguin",
        name: "PENGUIN",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* feet */
            '<path d="M336 664 L296 710 L392 710 L380 664 Z"/>' +
            '<path d="M464 664 L504 710 L408 710 L420 664 Z"/>' +
            /* body */
            '<path d="M400 118 C 282 118, 232 254, 242 400 C 252 560, 312 668, 400 668 C 488 668, 548 560, 558 400 C 568 254, 518 118, 400 118 Z"/>' +
            /* flippers */
            '<path d="M244 322 C 198 396, 202 522, 246 566 C 260 486, 258 384, 244 322 Z"/>' +
            '<path d="M556 322 C 602 396, 598 522, 554 566 C 540 486, 542 384, 556 322 Z"/>' +
            /* tummy */
            '<path d="M400 250 C 334 250, 302 376, 312 480 C 322 590, 360 644, 400 644 C 440 644, 478 590, 488 480 C 498 376, 466 250, 400 250 Z"/>' +
            /* eyes + beak */
            '<circle cx="356" cy="240" r="26"/>' +
            '<circle cx="444" cy="240" r="26"/>' +
            '<circle cx="356" cy="244" r="11" fill="currentColor"/>' +
            '<circle cx="444" cy="244" r="11" fill="currentColor"/>' +
            '<path d="M400 286 L362 322 L400 356 L438 322 Z"/>' +
        '</svg>'
    },
    {
        id: "mushroom",
        name: "MUSHROOM",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* stem */
            '<path d="M322 396 L322 618 C 322 664, 478 664, 478 618 L478 396 Z"/>' +
            /* cap */
            '<path d="M152 400 C 152 232, 648 232, 648 400 Z"/>' +
            /* spots */
            '<circle cx="268" cy="342" r="42"/>' +
            '<circle cx="400" cy="298" r="48"/>' +
            '<circle cx="532" cy="342" r="42"/>' +
            /* face */
            '<circle cx="366" cy="470" r="12" fill="currentColor"/>' +
            '<circle cx="434" cy="470" r="12" fill="currentColor"/>' +
            '<path d="M362 526 Q400 556 438 526"/>' +
            /* grass */
            '<path d="M120 664 L680 664"/>' +
        '</svg>'
    },
    {
        id: "crab",
        name: "CRAB",
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">' +
            /* legs */
            '<path d="M228 480 L138 528"/>' +
            '<path d="M232 528 L150 596"/>' +
            '<path d="M262 566 L206 648"/>' +
            '<path d="M572 480 L662 528"/>' +
            '<path d="M568 528 L650 596"/>' +
            '<path d="M538 566 L594 648"/>' +
            /* claws */
            '<path d="M214 328 C 146 296, 100 350, 146 392 C 104 428, 152 484, 216 444 Z"/>' +
            '<path d="M586 328 C 654 296, 700 350, 654 392 C 696 428, 648 484, 584 444 Z"/>' +
            /* body */
            '<ellipse cx="400" cy="452" rx="204" ry="146"/>' +
            /* eye stalks */
            '<path d="M336 316 L336 380 L352 380 L352 316 Z"/>' +
            '<path d="M448 316 L448 380 L464 380 L464 316 Z"/>' +
            '<circle cx="344" cy="292" r="34"/>' +
            '<circle cx="456" cy="292" r="34"/>' +
            '<circle cx="344" cy="296" r="13" fill="currentColor"/>' +
            '<circle cx="456" cy="296" r="13" fill="currentColor"/>' +
            /* smile */
            '<path d="M330 486 Q400 542 470 486"/>' +
        '</svg>'
    }
];
