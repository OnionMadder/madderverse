(function () {
    'use strict';

    const COLORS = [
        '#e74c3c', '#f39c12', '#f1c40f', '#2ecc71',
        '#00ffcc', '#3498db', '#9b59b6', '#ff00ff',
        '#8b4513', '#1a1a1a'
    ];

    const TEMPLATES = {
        blank: { name: 'Blank', svg: '' },
        cat: {
            name: 'Cat',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="400" cy="270" r="150"/>
                <path d="M 285 185 L 265 80 L 365 165 Z"/>
                <path d="M 515 185 L 535 80 L 435 165 Z"/>
                <path d="M 295 175 L 290 110 L 340 160"/>
                <path d="M 505 175 L 510 110 L 460 160"/>
                <circle cx="345" cy="255" r="22"/>
                <circle cx="455" cy="255" r="22"/>
                <circle cx="345" cy="255" r="9" fill="#1a1a1a"/>
                <circle cx="455" cy="255" r="9" fill="#1a1a1a"/>
                <path d="M 385 305 L 415 305 L 400 325 Z"/>
                <path d="M 400 325 L 400 340"/>
                <path d="M 400 340 Q 380 358 365 345"/>
                <path d="M 400 340 Q 420 358 435 345"/>
                <path d="M 320 315 L 240 305"/>
                <path d="M 320 330 L 240 335"/>
                <path d="M 320 345 L 240 365"/>
                <path d="M 480 315 L 560 305"/>
                <path d="M 480 330 L 560 335"/>
                <path d="M 480 345 L 560 365"/>
                <path d="M 290 390 Q 280 490 320 545 L 480 545 Q 520 490 510 390"/>
                <path d="M 320 545 L 320 568 Q 340 578 360 568 L 360 545"/>
                <path d="M 440 545 L 440 568 Q 460 578 480 568 L 480 545"/>
                <path d="M 510 445 Q 605 425 625 365 Q 630 320 590 320"/>
            </g>`
        },
        dog: {
            name: 'Dog',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="400" cy="240" rx="135" ry="120"/>
                <path d="M 290 215 Q 245 270 265 360 Q 285 380 325 350 L 325 280 Z"/>
                <path d="M 510 215 Q 555 270 535 360 Q 515 380 475 350 L 475 280 Z"/>
                <circle cx="355" cy="225" r="14"/>
                <circle cx="355" cy="225" r="6" fill="#1a1a1a"/>
                <circle cx="445" cy="225" r="14"/>
                <circle cx="445" cy="225" r="6" fill="#1a1a1a"/>
                <ellipse cx="400" cy="290" rx="22" ry="14" fill="#1a1a1a"/>
                <path d="M 400 304 L 400 330"/>
                <path d="M 400 330 Q 380 348 360 338"/>
                <path d="M 400 330 Q 420 348 440 338"/>
                <ellipse cx="400" cy="455" rx="160" ry="58"/>
                <path d="M 280 510 L 275 560 L 260 565 L 260 575 L 320 575 L 320 540"/>
                <path d="M 360 510 L 355 565 L 340 570 L 340 580 L 395 580 L 395 540"/>
                <path d="M 410 510 L 415 565 L 430 570 L 430 580 L 475 580 L 475 540"/>
                <path d="M 490 510 L 495 560 L 510 565 L 510 575 L 555 575 L 555 540"/>
                <path d="M 555 430 Q 615 400 615 350 Q 615 320 590 320"/>
                <ellipse cx="345" cy="475" rx="14" ry="8" fill="#1a1a1a"/>
            </g>`
        },
        fish: {
            name: 'Fish',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M 200 300 Q 250 175 450 175 Q 605 175 625 300 Q 605 425 450 425 Q 250 425 200 300 Z"/>
                <path d="M 200 300 L 95 215 L 130 300 L 95 385 Z"/>
                <path d="M 380 188 Q 425 120 475 195"/>
                <path d="M 380 412 Q 425 480 475 405"/>
                <path d="M 270 225 Q 290 300 270 375"/>
                <circle cx="540" cy="260" r="24"/>
                <circle cx="540" cy="260" r="10" fill="#1a1a1a"/>
                <path d="M 605 320 Q 590 335 610 348"/>
                <path d="M 320 250 Q 345 275 320 300"/>
                <path d="M 380 250 Q 405 275 380 300"/>
                <path d="M 440 250 Q 465 275 440 300"/>
                <path d="M 350 315 Q 375 340 350 365"/>
                <path d="M 410 315 Q 435 340 410 365"/>
                <path d="M 470 315 Q 495 340 470 365"/>
                <circle cx="660" cy="180" r="14"/>
                <circle cx="700" cy="135" r="10"/>
                <circle cx="685" cy="95" r="6"/>
            </g>`
        },
        dino: {
            name: 'Dino',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M 250 380 Q 200 300 280 240 Q 380 200 480 230 Q 540 250 540 320 L 540 410 Q 530 480 470 480 L 290 480 Q 230 470 250 380 Z"/>
                <path d="M 540 350 Q 660 310 730 360 Q 700 385 660 380"/>
                <path d="M 280 240 Q 220 235 175 270 L 165 305 Q 200 320 245 305"/>
                <circle cx="220" cy="270" r="6" fill="#1a1a1a"/>
                <path d="M 175 310 L 195 314 L 205 308 L 215 314 L 225 308 L 235 314"/>
                <path d="M 320 380 L 312 420 L 305 442"/>
                <path d="M 348 388 L 342 425 L 335 445"/>
                <path d="M 320 480 L 308 560 L 285 568 L 285 580 L 345 580 L 345 540"/>
                <path d="M 440 480 L 428 560 L 405 568 L 405 580 L 465 580 L 465 540"/>
                <path d="M 295 245 L 290 220 L 278 235 Z"/>
                <path d="M 350 218 L 345 195 L 333 210 Z"/>
                <path d="M 410 213 L 405 188 L 393 203 Z"/>
                <path d="M 470 224 L 465 200 L 453 215 Z"/>
                <path d="M 525 265 L 535 285 L 520 285 L 530 305"/>
            </g>`
        },
        butterfly: {
            name: 'Butterfly',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="400" cy="310" rx="14" ry="100"/>
                <circle cx="400" cy="195" r="22"/>
                <path d="M 388 178 Q 360 150 348 125"/>
                <path d="M 412 178 Q 440 150 452 125"/>
                <circle cx="348" cy="123" r="6"/>
                <circle cx="452" cy="123" r="6"/>
                <path d="M 386 245 Q 280 195 220 240 Q 175 295 245 320 Q 320 330 386 295 Z"/>
                <path d="M 386 330 Q 305 355 250 390 Q 230 425 285 430 Q 350 415 386 380 Z"/>
                <path d="M 414 245 Q 520 195 580 240 Q 625 295 555 320 Q 480 330 414 295 Z"/>
                <path d="M 414 330 Q 495 355 550 390 Q 570 425 515 430 Q 450 415 414 380 Z"/>
                <circle cx="290" cy="270" r="14"/>
                <circle cx="510" cy="270" r="14"/>
                <circle cx="320" cy="395" r="10"/>
                <circle cx="480" cy="395" r="10"/>
                <path d="M 400 350 L 400 408"/>
                <path d="M 400 408 L 400 416"/>
            </g>`
        },
        car: {
            name: 'Car',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M 130 420 L 130 380 Q 140 350 175 350 L 245 350 Q 280 285 350 275 L 510 275 Q 575 285 605 350 L 670 350 Q 700 360 700 400 L 700 420 Z"/>
                <path d="M 380 275 L 380 350"/>
                <path d="M 280 348 Q 305 295 350 285 L 380 285 L 380 348 Z"/>
                <path d="M 400 285 L 510 285 Q 555 295 580 348 L 400 348 Z"/>
                <circle cx="225" cy="430" r="50"/>
                <circle cx="225" cy="430" r="22"/>
                <circle cx="225" cy="430" r="6" fill="#1a1a1a"/>
                <circle cx="600" cy="430" r="50"/>
                <circle cx="600" cy="430" r="22"/>
                <circle cx="600" cy="430" r="6" fill="#1a1a1a"/>
                <path d="M 470 395 L 510 395"/>
                <ellipse cx="670" cy="385" rx="14" ry="8"/>
                <ellipse cx="160" cy="385" rx="10" ry="6"/>
            </g>`
        },
        rocket: {
            name: 'Rocket',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M 360 100 Q 400 50 440 100 L 440 380 L 360 380 Z"/>
                <circle cx="400" cy="180" r="32"/>
                <circle cx="400" cy="180" r="20"/>
                <path d="M 360 250 L 440 250"/>
                <path d="M 360 320 L 440 320"/>
                <path d="M 360 320 L 290 405 L 360 380 Z"/>
                <path d="M 440 320 L 510 405 L 440 380 Z"/>
                <path d="M 360 380 L 360 410 L 440 410 L 440 380"/>
                <path d="M 365 410 Q 380 460 360 510 Q 380 480 380 510 Q 395 460 400 525 Q 405 460 420 510 Q 420 480 440 510 Q 420 460 435 410"/>
                <path d="M 200 150 L 215 165 L 200 180 L 185 165 Z"/>
                <path d="M 600 150 L 615 165 L 600 180 L 585 165 Z"/>
                <path d="M 170 290 L 178 298 L 170 306 L 162 298 Z"/>
                <path d="M 630 280 L 638 290 L 630 300 L 622 290 Z"/>
                <path d="M 540 100 L 548 110 L 540 120 L 532 110 Z"/>
            </g>`
        },
        flower: {
            name: 'Flower',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="400" cy="240" r="48"/>
                <ellipse cx="400" cy="140" rx="38" ry="58"/>
                <ellipse cx="470" cy="170" rx="38" ry="58" transform="rotate(45 400 240)"/>
                <ellipse cx="500" cy="240" rx="58" ry="38"/>
                <ellipse cx="470" cy="310" rx="38" ry="58" transform="rotate(135 400 240)"/>
                <ellipse cx="400" cy="340" rx="38" ry="58"/>
                <ellipse cx="330" cy="310" rx="38" ry="58" transform="rotate(225 400 240)"/>
                <ellipse cx="300" cy="240" rx="58" ry="38"/>
                <ellipse cx="330" cy="170" rx="38" ry="58" transform="rotate(315 400 240)"/>
                <circle cx="400" cy="240" r="20"/>
                <circle cx="400" cy="240" r="8"/>
                <path d="M 400 340 Q 405 440 400 540"/>
                <path d="M 400 400 Q 320 380 290 420 Q 320 444 400 425"/>
                <path d="M 400 470 Q 480 450 510 490 Q 480 514 400 495"/>
                <path d="M 360 540 L 440 540"/>
            </g>`
        },
        sun: {
            name: 'Sun',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="400" cy="300" r="120"/>
                <path d="M 400 130 L 400 75"/>
                <path d="M 400 470 L 400 525"/>
                <path d="M 230 300 L 175 300"/>
                <path d="M 570 300 L 625 300"/>
                <path d="M 280 180 L 240 140"/>
                <path d="M 520 180 L 560 140"/>
                <path d="M 280 420 L 240 460"/>
                <path d="M 520 420 L 560 460"/>
                <circle cx="362" cy="282" r="12"/>
                <circle cx="362" cy="282" r="5" fill="#1a1a1a"/>
                <circle cx="438" cy="282" r="12"/>
                <circle cx="438" cy="282" r="5" fill="#1a1a1a"/>
                <path d="M 350 340 Q 400 385 450 340"/>
                <path d="M 350 340 L 360 350 L 380 348 L 400 358 L 420 348 L 440 350 L 450 340"/>
                <circle cx="320" cy="335" r="11"/>
                <circle cx="480" cy="335" r="11"/>
            </g>`
        },
        balloon: {
            name: 'Balloon',
            svg: `<g fill="none" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="400" cy="220" rx="125" ry="155"/>
                <path d="M 388 372 L 400 395 L 412 372 Z"/>
                <path d="M 400 395 Q 380 450 410 495 Q 390 545 400 580"/>
                <ellipse cx="358" cy="170" rx="18" ry="32"/>
                <ellipse cx="170" cy="380" rx="58" ry="68"/>
                <path d="M 170 446 L 165 458 L 175 458 Z"/>
                <path d="M 170 458 Q 165 510 175 545"/>
                <ellipse cx="148" cy="345" rx="10" ry="18"/>
                <ellipse cx="630" cy="380" rx="58" ry="68"/>
                <path d="M 630 446 L 625 458 L 635 458 Z"/>
                <path d="M 630 458 Q 625 510 635 545"/>
                <ellipse cx="608" cy="345" rx="10" ry="18"/>
            </g>`
        }
    };

    const TEMPLATE_KEYS = ['blank', 'cat', 'dog', 'fish', 'dino', 'butterfly', 'car', 'rocket', 'flower', 'sun', 'balloon'];

    const FRAMES = [
        { key: 'none',         name: 'None' },
        { key: 'rainbow',      name: 'Rainbow' },
        { key: 'dots',         name: 'Dots' },
        { key: 'stars',        name: 'Stars' },
        { key: 'construction', name: 'Paper' },
        { key: 'gold',         name: 'Gold' },
        { key: 'scallops',     name: 'Scallops' },
        { key: 'clouds',       name: 'Clouds' },
        { key: 'confetti',     name: 'Confetti' },
        { key: 'layers',       name: 'Layers' },
        { key: 'spotlight',    name: 'Spotlight' }
    ];

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const tplSvg = document.getElementById('template-svg');
    const paper = document.getElementById('paper');
    const paperFrame = document.getElementById('paper-frame');
    const eraserBtn = document.getElementById('eraser');

    const state = {
        color: COLORS[0],
        size: 14,
        erasing: false,
        page: 'blank',
        frame: 'none',
        orientation: 'landscape',
        flipping: false,
        drawing: false,
        last: null
    };

    /* === Palette === */
    const paletteEl = document.getElementById('palette');
    COLORS.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'swatch' + (i === 0 ? ' active' : '');
        b.style.setProperty('--c', c);
        b.dataset.color = c;
        b.setAttribute('aria-label', 'Color ' + c);
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            b.classList.add('active');
            state.color = c;
            state.erasing = false;
            eraserBtn.classList.remove('active');
        });
        paletteEl.appendChild(b);
    });

    /* === Brush sizes === */
    document.querySelectorAll('#brush-sizes .size-btn').forEach(btn => {
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            document.querySelectorAll('#brush-sizes .size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.size = parseInt(btn.dataset.size, 10);
        });
    });

    /* === Eraser === */
    eraserBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        state.erasing = !state.erasing;
        eraserBtn.classList.toggle('active', state.erasing);
    });

    /* === Clear === */
    document.getElementById('clear').addEventListener('pointerdown', (e) => {
        e.preventDefault();
        clearDrawing();
    });

    /* === New Page (animated) === */
    document.getElementById('new-page').addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (state.flipping) return;
        flipPage(() => clearDrawing());
    });

    function flipPage(midCb) {
        state.flipping = true;
        state.drawing = false;
        state.last = null;
        canvas.classList.add('flipping');
        setTimeout(() => {
            if (midCb) midCb();
            paper.classList.add('pulse');
        }, 305);
        setTimeout(() => {
            canvas.classList.remove('flipping');
            paper.classList.remove('pulse');
            state.flipping = false;
        }, 620);
    }

    function clearDrawing() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    /* === Save === */
    document.getElementById('save').addEventListener('pointerdown', async (e) => {
        e.preventDefault();
        const out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = canvas.height;
        const octx = out.getContext('2d');
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, out.width, out.height);
        if (state.page !== 'blank') {
            await drawTemplateTo(octx, out.width, out.height, state.page);
        }
        octx.drawImage(canvas, 0, 0);
        const a = document.createElement('a');
        a.download = 'bala-draws-' + Date.now() + '.png';
        a.href = out.toDataURL('image/png');
        a.click();
    });

    function drawTemplateTo(targetCtx, w, h, key) {
        return new Promise((res) => {
            const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="' +
                w + '" height="' + h + '" preserveAspectRatio="xMidYMid meet">' + TEMPLATES[key].svg + '</svg>';
            const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { targetCtx.drawImage(img, 0, 0); URL.revokeObjectURL(url); res(); };
            img.onerror = () => { URL.revokeObjectURL(url); res(); };
            img.src = url;
        });
    }

    /* === Tab switching === */
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
        });
    });

    /* === Page picker === */
    const pageThumbsEl = document.getElementById('page-thumbs');
    TEMPLATE_KEYS.forEach(key => {
        const t = TEMPLATES[key];
        const b = document.createElement('button');
        b.className = 'page-thumb' + (key === state.page ? ' active' : '') + (key === 'blank' ? ' empty' : '');
        b.dataset.page = key;
        b.setAttribute('aria-label', 'Page: ' + t.name);
        if (key === 'blank') {
            b.textContent = 'BLANK';
        } else {
            b.innerHTML = '<svg viewBox="0 0 800 600">' + t.svg + '</svg>';
        }
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (state.flipping || state.page === key) return;
            document.querySelectorAll('.page-thumb').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            flipPage(() => {
                state.page = key;
                tplSvg.innerHTML = TEMPLATES[key].svg;
                clearDrawing();
            });
        });
        pageThumbsEl.appendChild(b);
    });

    /* === Frame picker === */
    const frameThumbsEl = document.getElementById('frame-thumbs');
    FRAMES.forEach(f => {
        const b = document.createElement('button');
        b.className = 'frame-thumb' + (f.key === state.frame ? ' active' : '');
        b.dataset.frame = f.key;
        b.setAttribute('aria-label', 'Frame: ' + f.name);
        b.innerHTML = '<div class="frame-thumb-inner frame-' + f.key + '"><div class="frame-thumb-paper"></div></div>';
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            document.querySelectorAll('.frame-thumb').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            state.frame = f.key;
            FRAMES.forEach(x => paperFrame.classList.remove('frame-' + x.key));
            paperFrame.classList.add('frame-' + f.key);
        });
        frameThumbsEl.appendChild(b);
    });

    /* === Orientation toggle === */
    document.getElementById('rotate').addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (state.flipping) return;
        const btn = document.getElementById('rotate');
        btn.classList.add('spin');
        setTimeout(() => btn.classList.remove('spin'), 450);
        flipPage(() => {
            state.orientation = state.orientation === 'landscape' ? 'portrait' : 'landscape';
            paper.classList.toggle('landscape');
            paper.classList.toggle('portrait');
            clearDrawing();
        });
    });

    /* === Resize === */
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = paper.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const tmp = document.createElement('canvas');
        tmp.width = canvas.width;
        tmp.height = canvas.height;
        if (canvas.width > 0 && canvas.height > 0) {
            tmp.getContext('2d').drawImage(canvas, 0, 0);
        }
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (tmp.width > 0 && tmp.height > 0) {
            ctx.drawImage(tmp, 0, 0, rect.width, rect.height);
        }
    }

    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(resize).observe(paper);
    } else {
        window.addEventListener('resize', resize);
    }
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    requestAnimationFrame(resize);

    /* === Drawing handlers === */
    function pos(e) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        state.drawing = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        state.last = pos(e);
        ctx.globalCompositeOperation = state.erasing ? 'destination-out' : 'source-over';
        ctx.fillStyle = state.color;
        ctx.beginPath();
        ctx.arc(state.last.x, state.last.y, state.size / 2, 0, Math.PI * 2);
        ctx.fill();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!state.drawing) return;
        e.preventDefault();
        const p = pos(e);
        ctx.globalCompositeOperation = state.erasing ? 'destination-out' : 'source-over';
        ctx.strokeStyle = state.color;
        ctx.lineWidth = state.size;
        ctx.beginPath();
        ctx.moveTo(state.last.x, state.last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        state.last = p;
    });

    function endStroke() { state.drawing = false; state.last = null; }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', endStroke);

    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => {
        if (e.target === canvas) e.preventDefault();
    });
})();
