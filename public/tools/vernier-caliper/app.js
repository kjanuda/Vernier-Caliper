(function() {
    'use strict';
    /* =========================================================
       Vernier Caliper Simulator  –  app.js  v16
       v14: true-position vernier (no floating window); aligned division physically
            coincides with a real main-scale line.
       v15: single FIXED px/mm for every precision — instrument is the same physical
            size whichever LC is selected; main scale fills the beam identically.
       v16: realistic geometry — 100 mm metric / 4″ imperial capacity, beam drawn to
            ~150 mm, ONE fixed-size sliding head (standard graduations fill its left
            end like a real caliper), precision-aware Zoom for the dense fine scale.
       v17: density-aware vernier labels (fixes overlapping numerals on the 0.1 mm
            scale at the fixed instrument size).
       v18: head enlarged to fully contain the 0.02 mm vernier (px/mm 5.2 so it fits
            at full travel); main scale numbered only to capacity (100 mm / 4″) with a
            plain graduated run-out past it for the vernier to coincide against.
       v19: extended (long-form) verniers so coarse scales fill the same head —
            0.02/0.1 → 49 mm, 0.05 → 39 mm, imperial → ~47 mm; coincidence at MSR+m·VSR.
       v20: engraved mechsimulator.com watermark on the beam run-out (past capacity).
       v21: default least count on load is 0.02 mm.
       v22: imperial fixes — main scale numbered at whole inches (bold) + tenths 1–9
            (was a meaningless 0.3″ interval); imperial vernier reverted to the
            authentic 25-div / 0.600″ short form (LC 0.001″).
       v23: imperial sliding head proportioned to its 0.6″ vernier (not the metric head).
       v24: optional "Coincidence" toggle (gold line on/off) beside Zoom, on by default.
       v25: practice-mode Enter key guarded until a target exists (was scoring against
            0.00 before Play→Pause); removed unused fmtLabel dead code.
       Dual-mode: SI (metric mm) + Imperial (inch) caliper
       Uses real PNG sprites; ticks drawn programmatically
       ========================================================= */

    // ── Sprite coordinate constants ───────────────────────────────────
    const S = {
        scaleOriginX: 67,
        scaleOriginY0: 105,
        scaleOriginY: 162,
        offsetOriginX: 12,
        vernierOriginX: 55,
        vernierOriginY: 161,
        rulerWidthPx: 915,
        bladeWidthPx: 716,
        bladeHeightPx: 20,
        majorTickH: 22,
        minorTickH: 13,
        vMajorTickH: 10,
        vMinorTickH: 8,
        CW: 923,
        CH: 357,
        // The sprite's inside-jaw tips reach y = 2, i.e. the very top of the artwork.
        // A ring being measured has to sit ABOVE them with the knife edges rising into
        // its bore, so the output canvas carries a strip of headroom and the whole
        // instrument is drawn translated down into it.
        PAD_TOP: 22,
    };
    S.CH_OUT = S.CH + S.PAD_TOP;

    /* [VC-DATA-BEGIN] — sliced out by deploy/verify-vernier-imperial.js */
    // ── SI scale parameters ───────────────────────────────────────────
    const SI = {
        totalDivs: 100, // 100 mm measuring capacity
        totalRange: 100, // mm
        majorEvery: 5, // major tick every 5 divisions
        vernierSets: {
            '0.05': 20,
            '0.02': 50,
            '0.1': 10
        },
    };

    // ── Imperial scale parameters ─────────────────────────────────────
    // TWO real inch instruments share one 0-4 inch beam. Which one is engraved is
    // chosen by state.impPrec:
    //   '0.001'  decimal-inch - beam in 40ths (0.025"), 25-division vernier over
    //                           24 main divisions (0.600"). LC = 0.025/25 = 0.001".
    //   '1/128'  fractional   - beam in 16ths (1/16"), 8-division vernier over
    //                           7 main divisions (7/16"). LC = 1/16 - 7/128 = 1/128".
    // The fractional caliper is still examined in fitting / fabrication syllabi and
    // is read in FRACTIONS, never decimals - hence `fractional`, which switches
    // every readout to a reduced mixed number.
    const IMP_MODES = {
        '0.001': {
            key: '0.001',
            label: '0.001\u2033',
            fractional: false,
            divsPerInch: 40,
            msd: 0.025, // inches per main scale division
            vernierDivs: 25,
            lc: 0.001, // least count in inches
            lcMm: 0.0254, // least count in mm
            span: '0.600\u2033'
        },
        '1/128': {
            key: '1/128',
            label: '1/128\u2033',
            fractional: true,
            divsPerInch: 16,
            msd: 1 / 16,
            vernierDivs: 8,
            lc: 1 / 128,
            lcMm: 25.4 / 128,
            span: '7/16\u2033'
        }
    };
    const IMP = {
        totalRange: 101.6, // mm (4 inches in mm) - same beam either way
        totalInches: 4,
    };

    const ANIM_SPEED = 15; // mm/s
    const QUIZ_TOTAL = 5;
    const MM_TO_IN = 1 / 25.4;
    /* [VC-DATA-END] */

    // ── Sprites ───────────────────────────────────────────────────────
    const imgVernier1 = new Image();
    imgVernier1.src = 'assets/vernier1.png';
    const imgVernier2 = new Image();
    imgVernier2.src = 'assets/vernier2.png';
    const imgVernier3 = new Image();
    imgVernier3.src = 'assets/vernier3.png';
    const imgBase = new Image();
    imgBase.src = 'assets/vernier_base.png';
    const imgBlade = new Image();
    imgBlade.src = 'assets/blade.png';

    // ── Satin stainless-steel shading ─────────────────────────────────
    // Each flat-grey sprite is re-shaded ONCE into an offscreen canvas with a
    // top-lit metallic gradient + sheen + fine brushed texture, composited onto the
    // sprite's own silhouette (source-atop) so only the metal is touched. Cached, so
    // dragging stays 60fps. The scale/coincidence geometry is drawn later, untouched.
    const shaded = {};

    // A `dy`-thick band lying just INSIDE the silhouette, along the edge that faces
    // −dy. Built from the sprite's own alpha (keep what is opaque here but NOT
    // opaque `dy` away), so it follows every jaw taper, every internal cut-out and
    // every hole without a single hand-authored coordinate — the profile is the
    // sprite's, untouched, which is the standing rule for this instrument.
    function edgeLip(img, dx, dy, colour) {
        const w = img.width,
            h = img.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(img, dx, dy);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = colour;
        g.fillRect(0, 0, w, h);
        return c;
    }

    // `addLips` is FALSE for the three sliding-head slices: v1/v2/v3 are cut pieces
    // of one part, so a lip derived from a slice would trace its own cut edge and
    // paint a bright line down the middle of the head. The head gets its lips once,
    // on the composite (see getHeadComposite).
    function shadeSprite(img, addLips) {
        const w = img.width,
            h = img.height;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const o = off.getContext('2d');
        o.drawImage(img, 0, 0);
        o.globalCompositeOperation = 'source-atop';

        // Top-lit satin-steel gradient, one key light high and slightly left.
        // The stops deliberately span a WIDE tonal range: the old ramp put the whole
        // instrument between luma 210 and 245 — the top 14 % of the scale — so the
        // beam read as blown-out white paper rather than steel. Real satin stainless
        // under one lamp runs roughly 90–245: a dark turning rim at the top chamfer,
        // one bright specular band, a mid body that falls away, a bounce highlight
        // low down, and a genuinely dark underside.
        const g = o.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0.00, 'rgba(104,114,127,0.66)'); // top chamfer turning away
        g.addColorStop(0.12, 'rgba(176,187,198,0.52)');
        g.addColorStop(0.26, 'rgba(238,245,251,0.62)'); // primary specular band
        g.addColorStop(0.36, 'rgba(196,206,217,0.46)');
        g.addColorStop(0.50, 'rgba(122,132,145,0.52)'); // mid body falls off
        g.addColorStop(0.63, 'rgba(178,189,200,0.40)'); // bounce from the bench
        g.addColorStop(0.78, 'rgba(108,117,130,0.50)');
        g.addColorStop(1.00, 'rgba(62,70,80,0.72)'); // underside in shadow
        o.fillStyle = g;
        o.globalAlpha = 1;
        o.fillRect(0, 0, w, h);

        // Anisotropic satin brushing. A rigid 1-in-3 stripe measured out at ±4 luma
        // — invisible. Real brushing is irregular, so the row alpha comes from a
        // seeded LCG: deterministic (the texture is identical on every rebuild) but
        // with no repeating period the eye can lock onto.
        let seed = 20260910;
        const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let y = 0; y < h; y++) {
            const r = rnd();
            if (r < 0.38) continue;
            o.globalAlpha = 0.035 + r * 0.075;
            o.fillStyle = (r > 0.74) ? '#ffffff' : '#48505a';
            o.fillRect(0, y, w, 1);
        }
        // The two specular streaks that sit along the beam band.
        o.globalAlpha = 0.30;
        o.fillStyle = '#ffffff';
        o.fillRect(0, Math.round(h * 0.255), w, 1.6);
        o.globalAlpha = 0.14;
        o.fillRect(0, Math.round(h * 0.40), w, 1);

        // Machined edges. A lit lip along every up-facing edge and a dark one along
        // every down-facing edge is what separates the sliding head from the beam and
        // gives the jaw tapers a hard, machined arris — previously nothing but the
        // drop shadow told the two parts apart.
        o.globalCompositeOperation = 'source-over';
        if (addLips) applyEdgeLips(o, img);

        o.globalAlpha = 1;
        o.globalCompositeOperation = 'source-over';
        return off;
    }

    // `src` may be the sprite or an already-composited body; the lips are read off
    // whatever silhouette it has.
    function applyEdgeLips(o, src) {
        o.globalCompositeOperation = 'source-over';
        o.globalAlpha = 0.62;
        o.drawImage(edgeLip(src, 0, 2, 'rgba(255,255,255,1)'), 0, 0);
        o.globalAlpha = 0.46;
        o.drawImage(edgeLip(src, 0, -2, 'rgba(6,10,15,1)'), 0, 0);
        o.globalAlpha = 0.24;
        o.drawImage(edgeLip(src, 2, 0, 'rgba(255,255,255,1)'), 0, 0);
        o.globalAlpha = 0.22;
        o.drawImage(edgeLip(src, -2, 0, 'rgba(10,14,20,1)'), 0, 0);
        o.globalAlpha = 1;
    }

    function buildShadedSprites() {
        shaded.base = shadeSprite(imgBase, true);
        shaded.blade = shadeSprite(imgBlade, true);
        shaded.v1 = shadeSprite(imgVernier1, false);
        shaded.v2 = shadeSprite(imgVernier2, false);
        shaded.v3 = shadeSprite(imgVernier3, false);
        headCache.w = -1; // invalidate: the slices it composites have been rebuilt
    }

    // ── Flattened sliding head  (graphics-upgrade B16) ────────────────
    // The head is three sprite pieces. Drawn one after another inside a single
    // shadowed save(), EACH piece casts its own shadow onto the piece already
    // drawn — which painted two dark vertical bands down the slider face, measured
    // at 224 → 185 luma at both seams and travelling with the head. Composite the
    // three into one offscreen with NO shadow, add the machined lips to that single
    // silhouette, and draw it once. Cached by strip width, so a drag allocates
    // nothing. (Predicted for this tool by the dial-caliper pass; same defect.)
    const headCache = {
        w: -1,
        cv: null
    };

    function getHeadComposite(stripPx) {
        const w = Math.max(1, Math.round(stripPx));
        if (headCache.cv && headCache.w === w) return headCache.cv;
        const h = imgVernier1.height || S.CH;
        const cv = headCache.cv || (headCache.cv = document.createElement('canvas'));
        cv.width = w;
        cv.height = h;
        const o = cv.getContext('2d');
        o.clearRect(0, 0, w, h);
        const v1 = shaded.v1 || imgVernier1,
            v2 = shaded.v2 || imgVernier2,
            v3 = shaded.v3 || imgVernier3;
        o.drawImage(v1, 0, 0);
        const midW = w - imgVernier1.width - imgVernier3.width;
        if (midW > 0) {
            o.drawImage(v2, 0, 0, midW, h, imgVernier1.width, 0, midW, h);
        }
        o.drawImage(v3, imgVernier1.width + Math.max(0, midW), 0);
        applyEdgeLips(o, cv);
        headCache.w = w;
        return cv;
    }

    let imagesLoaded = 0;
    [imgVernier1, imgVernier2, imgVernier3, imgBase, imgBlade].forEach(img => {
        img.onload = () => {
            imagesLoaded++;
            if (imagesLoaded === 5) {
                buildShadedSprites();
                render();
            }
        };
        img.onerror = () => {
            imagesLoaded++;
            if (imagesLoaded === 5) {
                buildShadedSprites();
                render();
            }
        };
    });

    // ── State ─────────────────────────────────────────────────────────
    const state = {
        mm: 23.46,
        prec: '0.02',
        impPrec: '0.001',
        mode: 'free',
        unit: 'si',
        dragging: false,
        dragRefX: 0,
        dragRefMm: 0,
        quizTarget: 0,
        answered: false,
        score: 0,
        attempts: 0,
        playing: false,
        animDir: 1,
        animLast: 0,
        animRaf: null,
        zoomOpen: false,
        hinted: false,
        showAlign: true,
        // Locking screw. An instrument state, not a display preference: it is NOT
        // persisted, because reloading into a caliper whose jaws refuse to move
        // reads as a broken tool rather than as a remembered setting.
        locked: false,
        lockHover: false,
        lockFlash: 0,
        // Fine-adjustment thumb roller: hover, which half the pointer is over, and
        // whether the current drag began on it (which is what selects the fine gain).
        wheelHover: false,
        wheelActiveDir: 0,
        wheelDir: 1,
        dragFine: false,
        dragMoved: false,
        // Which numerals the SI beam carries. Both engravings are in circulation on
        // real 150 mm calipers — some number every 10 mm line in millimetres
        // (10 20 30 …), some in centimetres (1 2 3 …) — and they mark the SAME lines,
        // so this is display only and never touches a reading. 'mm' is the default
        // because it is what this tool has always drawn.
        beamUnit: 'mm',
        quizQuestions: [],
        quizCurrent: 0,
        quizAnswers: [],
        quizAnswered: false,
        exploreCat: 0,
        exploreIdx: 0,
        partIdx: 0,
        partPin: 0,
        wp: null,
        wpRaf: null,
        pickerOpen: false,
        audioCtx: null,
        zeOn: false,
        zeLc: 0, // Zero Error: off by default; zeLc is signed integer count of LC divisions (±5)
    };

    // ── DOM ───────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const cEl = $('caliper');
    if (!cEl) throw new Error('Canvas element #caliper not found');
    const ctx = cEl.getContext('2d');

    // ── Hi-DPI crisp canvas ───────────────────────────────────────────
    // Backing store = logical size × devicePixelRatio so the steel renders razor
    // sharp on Retina/4K instead of an upscaled 923-px bitmap. We draw everything in
    // logical (S.CW × S.CH) units; pointer math must therefore map with the LOGICAL
    // width (see getCanvasX) — the two move together (graphics-upgrade B1).
    let DPR = 1;

    function setupHiDPI() {
        DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2)); // clamp: 3× rarely worth it
        cEl.width = Math.round(S.CW * DPR);
        cEl.height = Math.round(S.CH_OUT * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    // Black granite surface plate, at device resolution. Deterministic grain (a
    // seeded generator), so a resize rebuilds the SAME plate rather than a new one.
    let plateCache = null;

    function getPlate() {
        const W = cEl.width,
            H = cEl.height;
        if (plateCache && plateCache.width === W && plateCache.height === H) return plateCache;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        let seed = 0x5eed1234;
        const rnd = function() { // mulberry32
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        g.fillStyle = '#15191e';
        g.fillRect(0, 0, W, H);
        // Grain: a gabbro "black granite" is an interlock of small angular crystals,
        // near-black pyroxene with scattered pale feldspar. Drawn as tiny irregular
        // quads — round dots read as bubbles, not stone — kept faint so the plate
        // never competes with the engraving on the steel lying on it.
        function grain(n, sizeLo, sizeHi, colour) {
            g.fillStyle = colour;
            for (let i = 0; i < n; i++) {
                const x = rnd() * W,
                    y = rnd() * H;
                const sz = (sizeLo + rnd() * (sizeHi - sizeLo)) * DPR;
                const k = rnd() * Math.PI;
                g.beginPath();
                for (let v = 0; v < 4; v++) {
                    const ang = k + v * Math.PI / 2 + (rnd() - 0.5) * 0.9;
                    const rr = sz * (0.55 + rnd() * 0.6);
                    g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
                }
                g.fill();
            }
        }
        grain(W * H / 700, 1.0, 2.6, 'rgba(0,0,0,0.30)');
        grain(W * H / 1400, 0.8, 2.0, 'rgba(96,106,118,0.10)');
        grain(W * H / 2600, 0.5, 1.3, 'rgba(176,186,198,0.20)');
        // Fine speckle over the lot.
        for (let i = 0; i < W * H / 260; i++) {
            const x = rnd() * W,
                y = rnd() * H,
                v = rnd();
            g.fillStyle = 'rgba(170,180,192,' + (0.03 + v * 0.07).toFixed(3) + ')';
            g.fillRect(x, y, 0.7 * DPR, 0.7 * DPR);
        }
        // A lapped plate reflects the room: one broad, soft sheen from the key light
        // over the reading end, falling off to the corners.
        const sheen = g.createRadialGradient(W * 0.34, H * 0.12, 20 * DPR, W * 0.34, H * 0.12, W * 0.7);
        sheen.addColorStop(0, 'rgba(160,190,215,0.13)');
        sheen.addColorStop(1, 'rgba(160,190,215,0)');
        g.fillStyle = sheen;
        g.fillRect(0, 0, W, H);
        const vig = g.createRadialGradient(W * 0.42, H * 0.45, H * 0.35, W * 0.42, H * 0.45, W * 0.68);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,0,0,0.42)');
        g.fillStyle = vig;
        g.fillRect(0, 0, W, H);
        plateCache = c;
        return c;
    }
    setupHiDPI();
    window.addEventListener('resize', () => {
        setupHiDPI();
        render();
    });

    /* [VC-ENGINE-BEGIN] — sliced out by deploy/verify-vernier-imperial.js */
    // ── Scale helpers (abstract SI vs Imperial) ───────────────────────
    function isImperial() {
        return state.unit === 'imperial';
    }
    // Active imperial profile (see IMP_MODES).
    function IM() {
        return IMP_MODES[state.impPrec] || IMP_MODES['0.001'];
    }

    function impFractional() {
        return isImperial() && IM().fractional;
    }

    // ── Fraction formatting (binary denominators only) ────────────────
    // Reduces by halving, which is exact for 128ths and 16ths, and returns the
    // mixed number a fitter actually writes: "1 43/128", "3/16", "2".
    function fracStr(inches, denom) {
        const neg = inches < -1e-12;
        const total = Math.round(Math.abs(inches) * denom);
        const whole = Math.floor(total / denom);
        let num = total - whole * denom;
        let den = denom;
        while (num && num % 2 === 0) {
            num /= 2;
            den /= 2;
        }
        let out;
        if (!num) out = String(whole);
        else if (!whole) out = num + '/' + den;
        // US shop and catalogue usage hyphenates a mixed number — 2-9/16, not
        // "2 9/16", which in running text reads as two separate numbers. The parser
        // below already accepts either, so the round trip is unaffected.
        else out = whole + '-' + num + '/' + den;
        return (neg ? '−' : '') + out;
    }

    // The EXACT decimal equivalent of a fractional-inch reading. Every US shop has
    // this chart on the wall (Machinery's Handbook prints it) because a fractional
    // measurement constantly has to be compared against a decimal drawing.
    //
    // Shown ALONGSIDE the fraction, never instead of it. A 1/128" caliper is read in
    // fractions — that is the whole point of the mode — and a toggle that replaced
    // the reading with 2.6015625" would be showing a number its scale cannot
    // express. Binary denominators terminate, so 7 places is exact rather than
    // rounded: 1/128 is 0.0078125 and nothing is being hidden.
    function fracDecimalEquiv(v) {
        const exact = Math.round(v * 128) / 128;
        return exact.toFixed(7).replace(/0+$/, '').replace(/\.$/, '') + '\u2033';
    }

    function getMaxMm() {
        return isImperial() ? IMP.totalRange : SI.totalRange;
    }

    function getMainDivs() {
        return isImperial() ? IMP.totalInches * IM().divsPerInch : SI.totalDivs;
    }

    // One main-scale division, in mm (1 mm for SI, 0.635 mm for imperial).
    function getMsdMm() {
        return getMaxMm() / getMainDivs();
    }

    // ONE fixed scale for every precision AND both unit systems, so the instrument is
    // always the same physical size — a real caliper body does not change when you
    // switch graduation or jaw position. Sized so that at full 100 mm travel the
    // ENTIRE sliding head (which holds the 49 mm vernier) stays on the 923 px canvas:
    // head right ≈ 149·p + 129 ≤ 923  ⇒  p ≤ 5.33. We use 5.2 for a safe margin.
    // The fine 0.02 mm scale is necessarily dense at this size, exactly like a real
    // 100 mm caliper — use the Zoom button (precision-aware) to read it.
    const FIXED_PX_PER_MM = 5.2; // px per mm, identical for all scales
    function getPxPerMm() {
        return FIXED_PX_PER_MM;
    }

    function getMsdPx() {
        return FIXED_PX_PER_MM * getMsdMm();
    }

    // Fill the whole beam with main-scale divisions so the scale looks identical for
    // every precision (the draw loop trims to the canvas edge). The beam reaches
    // ~150 mm — the 100 mm measuring range plus the headroom the 49 mm vernier needs
    // to coincide against when the jaw is near full travel (as on a real 150 mm beam).
    function getMainDivsToDraw() {
        const maxLocalX = S.CW - (S.scaleOriginX + S.offsetOriginX);
        return Math.ceil(maxLocalX / getMsdPx()) + 1;
    }

    function getVsdCount() {
        return isImperial() ? IM().vernierDivs : SI.vernierSets[state.prec];
    }

    // Least count in mm (internal unit)
    function getLcMm() {
        return isImperial() ? IM().lcMm : parseFloat(state.prec);
    }

    // Least count in display unit
    // One main-scale division in DISPLAY units (1 mm, 0.025 in, or 1/16 in).
    function getMsdDisplay() {
        return isImperial() ? IM().msd : getMsdMm();
    }

    function getLcDisplay() {
        return isImperial() ? IM().lc : parseFloat(state.prec);
    }

    function getShiftPx() {
        return getDisplayMm() * getPxPerMm();
    }

    // ── Zero-error helpers ────────────────────────────────────────────
    // MODEL (per NCERT / industrial convention):
    //   state.mm     = TRUE measurement (physical jaw gap, ≥ 0)
    //   displayMm    = state.mm + ZE_signed  = OBSERVED reading shown on canvas
    //   Corrected    = state.mm  =  Observed − ZE_signed
    const ZE_MAX_LC = 5;

    function getZeOffsetMm() {
        return state.zeOn ? state.zeLc * getLcMm() : 0;
    }

    function getDisplayMm() {
        return state.mm + getZeOffsetMm();
    }

    function clampZeLc(n) {
        return Math.max(-ZE_MAX_LC, Math.min(ZE_MAX_LC, n | 0));
    }

    function fmtZeSigned() {
        if (state.zeLc === 0) return impFractional() ? '0' : (0).toFixed(isImperial() ? 3 : 2);
        const dispVal = Math.abs(state.zeLc * getLcDisplay());
        const sign = state.zeLc > 0 ? '+' : '−';
        return sign + (impFractional() ? fracStr(dispVal, 128) :
            dispVal.toFixed(isImperial() ? 3 : 2));
    }

    function parseNumericInput(raw) {
        // A comma decimal ("23,45", the keyboard in many locales) and a bare point
        // (".5", "23.") are the same numbers a visitor means.
        const s = (raw || '').trim().replace(',', '.');
        if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
        return parseFloat(s);
    }

    // On the fractional inch caliper the ANSWER is a fraction, so the box has to
    // take one: "1 43/128", "1-43/128", "43/128" and a plain decimal are all
    // accepted (a student who works in decimals is not wrong, only unconventional).
    function parseFractionInput(raw) {
        let t = (raw || '').trim()
            .replace(/[\u2212\u2013\u2014]/g, '-')
            .replace(/[\u2033\u201d"']/g, '')
            .replace(/\bin\b\.?$/i, '')
            .trim();
        if (!t) return NaN;
        let m = t.match(/^(-?\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/); // 1 43/128 · 1-43/128
        if (m) {
            const den = +m[3];
            if (!den) return NaN;
            const w = +m[1];
            return (w < 0 ? -1 : 1) * (Math.abs(w) + (+m[2]) / den);
        }
        m = t.match(/^(-?\d+)\s*\/\s*(\d+)$/); // 43/128
        if (m) {
            const den = +m[2];
            return den ? (+m[1]) / den : NaN;
        }
        return parseNumericInput(t);
    }

    // The parser this instrument's answer box should use right now.
    function parseAnswerInput(raw) {
        return impFractional() ? parseFractionInput(raw) : parseNumericInput(raw);
    }

    // Vernier "form" multiplier m: the scale spans (m·n − 1) main divisions. This
    // gives the SAME least count (MSD / n) but a longer physical scale, so the coarse
    // metric graduations spread out and fill (nearly) the same head as the 0.02 mm
    // scale — a real "extended" / long-form vernier. Spans at 1 mm MSD:
    //   0.02 → 49 mm (m1) · 0.1 → 49 mm (m5) · 0.05 → 39 mm (m2)
    // (A 20-division 0.05 mm scale is geometrically limited to 19/39/59 mm — 39 mm is
    //  the closest it can come to the 49 mm head.) Imperial keeps the AUTHENTIC,
    // textbook short vernier: m1 → 25 div over 24 main divisions = 0.600″, LC 0.001″,
    // occupying part of the head with plain metal beyond, exactly like a real inch
    // caliper. The reading method is unchanged: the coincident division a reads
    // VSR = a and the gold tick lands on main line MSR + m·a (verified to coincide).
    function getVernierMult() {
        if (isImperial()) return 1; // standard 0.600″ inch vernier (24-div span)
        return {
            '0.02': 1,
            '0.05': 2,
            '0.1': 5
        }[state.prec] || 1;
    }

    // VSD pixel width for the (m·n − 1)/n long-form scale.
    function getVsdPx() {
        const n = getVsdCount();
        return getMsdPx() * (getVernierMult() * n - 1) / n;
    }

    // [VC-VLABEL-BEGIN] — vernier numbering. Asserted by deploy/verify-vernier-labels.js
    //
    // SI: a real metric vernier is numbered in TENTHS OF A MILLIMETRE, running
    // 0 1 2 … 9 0 — the last numeral closing back on zero because the whole
    // vernier spans exactly 1 mm. So the printed numeral is the VALUE (j × LC,
    // in units of 0.1 mm), never the division index, and the label gap is
    // whatever makes each numeral a whole tenth:
    //     0.02 mm (50 div) → every 5th   0.05 mm (20 div) → every 2nd
    //     0.1  mm (10 div) → every division
    // This tool used to engrave the index (0 10 20 30 40 50 on the 0.02 mm
    // scale), which no metric caliper carries; the arithmetic was right but the
    // student met a scale they had never seen at the bench.
    //
    // IMPERIAL is genuinely numbered by division — 0 5 10 15 20 25 on the 0.001″
    // scale, where the numeral and the index coincide — so that path is unchanged
    // and verify-vernier-imperial.js must stay green without modification.
    //
    // The gap must DIVIDE vsdCount either way, or the last line (the one that
    // proves the span, and in SI the one that closes back on 0) loses its number.
    function getVernierLabelRule(imperial, vsdCount, vsdPx, lcMm) {
        let vLabelGap, vLabelVal;
        if (imperial) {
            vLabelGap = (vsdCount >= 40) ? 10 : (vsdCount % 5 === 0 ? 5 : 2);
            // 13 px, not 15: the labels are single digits on the coarse scales, and at 15
            // the 8-division fractional vernier (14.5 px pitch) fell back to 0/4/8, which
            // makes the student count unlabelled lines to find the coincidence.
            while (vsdPx * vLabelGap < 13 && vLabelGap < vsdCount) vLabelGap *= 2;
            vLabelVal = j => j;
        } else {
            // Divisions per 0.1 mm — 5, 2 and 1 for the three metric scales.
            const tenth = Math.round(0.1 / lcMm);
            vLabelGap = tenth;
            // All three metric scales clear 13 px at the base gap (25.5 / 20.3 / 25.5 px
            // at FIXED_PX_PER_MM = 5.2), so this never fires today. It is here so that a
            // future change to the drawing scale degrades to a legible SUBSET of the real
            // numbering — widening only in whole tenths, and only to a gap that still
            // divides vsdCount so the closing "0" survives.
            while (vsdPx * vLabelGap < 13 &&
                vLabelGap + tenth <= vsdCount &&
                vsdCount % (vLabelGap + tenth) === 0) vLabelGap += tenth;
            // % 10 closes the run back on "0" rather than printing "10": the vernier
            // spans exactly 1 mm, the numeral field is one digit, and a real scale
            // therefore reads 0 1 2 … 9 0. That final 0 is the instrument's signature.
            vLabelVal = j => (j / tenth) % 10;
        }
        return {
            gap: vLabelGap,
            val: vLabelVal
        };
    }
    // [VC-VLABEL-END]

    // [VC-BRIDGE-BEGIN] — asserted by deploy/verify-vernier-labels.js
    // The numerals are counting aids, so the coinciding line is usually NOT the one
    // carrying the VSR: on the 0.05 mm scale, VSR 9 is one division past the numeral
    // 4. That gap is the real reading skill, and it used to be hidden because the
    // tool engraved the division index. This states it — in the READOUT TILE only.
    // Nothing is drawn on the instrument: a real caliper carries no such annotation,
    // and the whole point of the relabel was to stop the picture lying about the
    // hardware. Reads the SAME rule the canvas paints from, so the two cannot drift.
    function getVernierBridge() {
        const n = getVsdCount();
        const rule = getVernierLabelRule(isImperial(), n, getVsdPx(), getLcMm());
        const idx = getAlignedIdx(); // always 0 … n−1
        const base = Math.floor(idx / rule.gap) * rule.gap;
        return {
            numeral: rule.val(base),
            rem: idx - base,
            gap: rule.gap
        };
    }
    // [VC-BRIDGE-END]

    // The observed reading QUANTIZED to the least count. A workpiece can hold the
    // jaws off the LC grid (a 15.88 mm ball on a 0.05 mm vernier), so MSR, VSR and TR
    // must all be derived from one rounded value — otherwise a fraction that rounds
    // up to a full main division (0.99 → 50/50) would drop a whole millimetre.
    function getQuantMm() {
        const lc = getLcMm();
        return Math.round(getDisplayMm() / lc) * lc;
    }

    // Which vernier tick aligns with a main-scale mark (based on the OBSERVED reading)
    function getAlignedIdx() {
        const n = getVsdCount();
        const mm = getQuantMm();
        if (isImperial()) {
            const M = IM();
            const inches = mm * MM_TO_IN;
            const msrInches = Math.floor(inches / M.msd + 1e-9) * M.msd;
            const idx = Math.round((inches - msrInches) / M.lc);
            return ((idx % n) + n) % n; // modular for negative ZE near closed
        } else {
            const pf = parseFloat(state.prec);
            const idx = Math.round((mm - Math.floor(mm + 1e-9)) / pf);
            return ((idx % n) + n) % n;
        }
    }

    // The sliding head is ONE fixed physical size for every precision (a real caliper
    // body doesn't change with the graduation). It is wide enough to hold the longest
    // vernier — the 0.02 mm, 50-division scale spanning 49 mm — plus a little plain
    // metal. Coarser verniers (0.05 mm/19 mm, 0.1 mm/9 mm) engrave only the left part
    // of this same head, exactly like a real instrument's vernier window.
    // The fixed head must CONTAIN the longest vernier (0.02 mm = 50 div ≈ 49 mm). The
    // vernier zero sits HEAD_ZERO_OFFSET_PX in from the head's left edge (the jaw side
    // of the head); past the last vernier line we leave a metal margin for the right
    // cap. Same width for every precision — coarse verniers just fill less of it.
    const HEAD_VERNIER_MM = 49; // longest metric vernier span (0.02 mm, 50 div)
    const HEAD_RIGHT_MARGIN_PX = 50; // plain metal + right cap past the last line
    function getVernierStripPx() {
        const headZeroOffsetPx = 2 * S.offsetOriginX + S.vernierOriginX; // 79 px
        // Metric: a FIXED 49 mm region so 0.02/0.05/0.1 share ONE head size. Imperial:
        // size to the actual 0.6" inch vernier so it sits in a proportionate inch-caliper
        // head instead of a tight cluster floating on the larger metric head.
        let regionMm;
        if (isImperial()) {
            const n = getVsdCount(),
                m = getVernierMult();
            regionMm = (m * n - 1) * getMsdMm(); // 24 × 0.635" = 15.24 mm (0.6")
        } else {
            regionMm = HEAD_VERNIER_MM;
        }
        const w = headZeroOffsetPx + regionMm * getPxPerMm() + HEAD_RIGHT_MARGIN_PX;
        return Math.max(imgVernier1.width + imgVernier3.width, w);
    }

    // ── Display formatting ────────────────────────────────────────────
    function uLabel() {
        return isImperial() ? 'in' : 'mm';
    }
    // uLabel() is the standalone caption under a cell, where a word reads better
    // than a lone double-prime. A dimension written INLINE takes the mark instead,
    // set tight against the number the way a shop writes it: 2-77/128″, never
    // "2-77/128 in" with a gap. Millimetres keep the space, as SI requires.
    function escHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[c]);
    }

    function withUnit(v) {
        return isImperial() ? v + '\u2033' : v + ' mm';
    }

    // A value already in DISPLAY units, rendered the way this instrument is read.
    function fmtDispValue(v) {
        if (isImperial()) return IM().fractional ? fracStr(v, 128) : v.toFixed(3);
        return v.toFixed(2);
    }

    function fmtReading(mm) {
        if (isImperial()) return fmtDispValue(mm * MM_TO_IN);
        return mm.toFixed(2);
    }

    // The reading a perfect operator would write down for a given jaw gap: the
    // value quantised onto MSR + n·LC. Numeric, so answers can be compared without
    // going through a string.
    function dispValueOf(mmVal) {
        if (isImperial()) {
            const M = IM();
            const inches = mmVal * MM_TO_IN;
            const msr = Math.floor(inches / M.msd + 1e-9) * M.msd;
            const alignIdx = Math.min(Math.round((inches - msr) / M.lc), M.vernierDivs);
            return msr + alignIdx * M.lc;
        }
        // Metric: quantise onto the LEAST COUNT, exactly as the imperial branch above
        // and as getQuantMm() — the value the canvas draws and the reading cells
        // print — already do. Rounding to two decimals instead produced a graded
        // answer the instrument cannot show: a 1.825 mm part on the 0.05 mm vernier
        // draws its coincidence at 1.85 and prints "1 + 17 × 0.05", while the grader
        // compared against 1.82 and marked the correct reading wrong.
        const lc = getLcMm();
        return parseFloat((Math.round(mmVal / lc) * lc).toFixed(4));
    }

    // The answer a perfect operator hands in for a TRUE jaw gap: read the OBSERVED
    // scales — which is what getQuantMm() quantises and what the canvas draws — and
    // take the zero error off. Quantising the true value instead is a different
    // number whenever a part sits half a division from a graduation: with a +2 LC
    // zero error a 1.17 mm part draws its coincidence at 1.20 (corrected 1.16)
    // while round(1.17/LC) lands on 1.18, so the reading printed on the scales was
    // marked wrong. Everything graded goes through here.
    function gradedValueOf(trueMm) {
        const zeMm = getZeOffsetMm();
        const lc = getLcMm();
        const obsQ = Math.round((trueMm + zeMm) / lc) * lc; // what the scales show
        return dispValueOf(obsQ - zeMm); // corrected, in display units
    }

    // MSR written out from a DIVISION COUNT. Split out of fmtMsr so the guided
    // reading can show a partial MSR as its line grows without owning a second copy
    // of how this instrument writes one — the fractional beam is engraved in 16ths,
    // the decimal beam in thousandths, and neither is obvious.
    function fmtMsrDivs(divs) {
        const d = Math.max(0, divs);
        if (isImperial()) {
            const M = IM();
            const msr = d * M.msd;
            return M.fractional ? fracStr(msr, 16) : msr.toFixed(3);
        }
        return String(d);
    }

    function fmtMsr() {
        // MSR reflects the OBSERVED reading on the canvas. For negative-ZE near closed,
        // displayMm can be slightly < 0; the main scale physically still shows 0 there,
        // which is why the division count is clamped at zero.
        const mm = getQuantMm();
        if (isImperial()) {
            const M = IM();
            return fmtMsrDivs(Math.max(0, Math.floor(mm * MM_TO_IN / M.msd + 1e-9)));
        }
        return fmtMsrDivs(Math.max(0, Math.floor(mm + 1e-9)));
    }

    function fmtLc() {
        if (isImperial()) return IM().fractional ? '1/128' : IM().lc.toFixed(3);
        return parseFloat(state.prec).toFixed(2);
    }

    function fmtPart() {
        const alignIdx = getAlignedIdx();
        const lcVal = getLcDisplay();
        if (impFractional()) return fracStr(alignIdx * lcVal, 128);
        return (alignIdx * lcVal).toFixed(isImperial() ? 3 : 2);
    }

    function fmtTr() {
        // TR is the literal arithmetic on the displayed cells (clamped MSR + VSR × LC).
        // For positive ZE / no-ZE this equals fmtReading(displayMm). For negative-ZE
        // near-closed (rare), this shows the raw formula sum; the signed observed value
        // appears in the ZE box (matches the NCERT negative-ZE convention).
        const mm = getQuantMm();
        const alignIdx = getAlignedIdx();
        if (isImperial()) {
            const M = IM();
            const inches = mm * MM_TO_IN;
            const msr = Math.max(0, Math.floor(inches / M.msd + 1e-9) * M.msd);
            return fmtDispValue(msr + alignIdx * M.lc);
        }
        const mainMm = Math.max(0, Math.floor(mm + 1e-9));
        const pf = parseFloat(state.prec);
        return (mainMm + alignIdx * pf).toFixed(2);
    }

    // Snap to least count in mm
    function snapToLc(mm) {
        const lc = getLcMm();
        return Math.round(mm / lc) * lc;
    }
    /* [VC-ENGINE-END] */

    // ── Sound helpers ─────────────────────────────────────────────────
    function getAudioCtx() {
        if (!state.audioCtx) {
            state.audioCtx = new(window.AudioContext || window.webkitAudioContext)();
        }
        return state.audioCtx;
    }

    function playTone(freq, dur, type, vol) {
        try {
            const ac = getAudioCtx();
            const osc = ac.createOscillator();
            const g = ac.createGain();
            osc.type = type || 'sine';
            osc.frequency.value = freq;
            g.gain.value = vol || 0.08;
            g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
            osc.connect(g);
            g.connect(ac.destination);
            osc.start(ac.currentTime);
            osc.stop(ac.currentTime + dur);
        } catch (e) { /* audio not available */ }
    }

    function playClick() {
        playTone(800, 0.05, 'square', 0.04);
    }

    function playTick() {
        playTone(1200, 0.02, 'sine', 0.03);
    }

    function playSuccess() {
        playTone(880, 0.12, 'sine', 0.1);
        setTimeout(() => playTone(1100, 0.15, 'sine', 0.1), 120);
    }

    function playError() {
        playTone(300, 0.2, 'sawtooth', 0.06);
    }
    // Jaw-on-metal: a short damped knock, distinct from the graduation tick.
    function playContact() {
        playTone(260, 0.07, 'triangle', 0.09);
        setTimeout(function() {
            playTone(180, 0.05, 'sine', 0.05);
        }, 55);
    }

    // ── Helpers ───────────────────────────────────────────────────────
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // ── Workpieces (measure a real object) ────────────────────────────
    // The outside jaws close along x. Measured face geometry, in canvas px:
    //   fixed jaw measuring face  →  WP_FACE_X
    //   sliding jaw measuring face →  WP_FACE_X + getShiftPx()
    // so the throat opening is exactly getDisplayMm() × px/mm. A workpiece rests
    // against the FIXED jaw (as you would hold it), its silhouette is exactly its
    // true size wide, and state.mm is clamped so the sliding jaw can never travel
    // past it — the jaws stop on the part, they do not pass through it.
    // Internal measurement rides the upper knife edges. Both inside-jaw measuring
    // faces sit at x = 32 (fixed jaw's LEFT face; sliding jaw's RIGHT face, offset by
    // the head travel) and stay parallel down to y = 46, where the sliding jaw meets
    // the head body. So the inside jaws read exactly what the outside jaws read, and
    // the bore's widest points — which is where the jaws touch — must sit at y ≤ 46.
    const WP_IN_FACE_X = 32;
    // The bush is drawn in HALF-SECTION, the same convention as the depth block: the
    // caliper is seen square-on, and a bore measured on the upper jaws has its axis
    // PARALLEL to the jaws, i.e. vertical in this view. Seen from the side a ring is
    // two walls with a hole between them — the old tilted 3-D ellipse mixed an
    // oblique view of the ring with a square-on view of the instrument.
    const WP_IN_Y1 = 40; // lower end of the bush — above y = 46, so every point
    // of the bore wall the nibs can touch is in the band
    // where the knife edges are parallel
    const WP_IN_WALL = 14; // radial wall, px (2.7 mm)

    const WP_FACE_X = 67; // fixed outside-jaw face, canvas px
    const WP_TOP_Y = 180; // top of the usable throat band, just under the beam
    const WP_MAX_Y = 314; // bottom of the usable band (leaves room for the dim line)
    const WP_MID_Y = (WP_TOP_Y + WP_MAX_Y) / 2; // parts sit CENTRED in the jaw throat
    const WP_DIM_Y = 326; // dimension line sits at a fixed offset, drawing-style

    // ── Depth measurement: the broken-beam layout ─────────────────────
    // A depth reading needs the rod OUT of the tail end, and vernier_base.png is
    // 923 px wide on a 923 px canvas — the beam runs to the literal right edge, so
    // there is ZERO runway. Depth parts therefore draw the beam BROKEN: a span of
    // blank run-out is removed and the tail piece slid left, which is the standard
    // drafting device for a long member. The graduated capacity, the vernier and
    // the sliding head are untouched at TRUE scale; only the part that never
    // varies is compressed. (Never compress the quantity the user is changing —
    // that is how a drawn rod goes constant while every number stays right.)
    // [VC-DEPTH-CONST-BEGIN] — sliced by deploy/verify-vernier-depth.js
    // The seam clears the "100" numeral, not just the 100 mm tick: the label is
    // centred on the capacity line at 599 px and is ~19 px wide, so a break at 610
    // drew its zigzag straight through the last digit.
    const DEPTH_BREAK_X = 622; // seam, clear of the numeral at the 100 mm capacity end
    const DEPTH_GAP = 190; // px of run-out removed == px of rod runway gained
    const DEPTH_MAX_MM = 25; // deepest part in either catalogue
    // The beam end — the reference face the part is stood against — after the slide.
    // Measured off the sprite, not assumed: vernier_base.png paints out to x = 915
    // (S.rulerWidthPx) and its beam occupies y = 97..171 at every column of the
    // run-out, which is what the break symbol is sized to.
    const DEPTH_FACE_X = 915 - DEPTH_GAP; // 725
    const DEPTH_BEAM_Y0 = 97;
    const DEPTH_BEAM_Y1 = 171;
    // Guard the geometry rather than trusting the three numbers to stay in step:
    // the deepest rod must still land inside the canvas with wall left to draw.
    if (DEPTH_GAP < DEPTH_MAX_MM * FIXED_PX_PER_MM + 40) {
        console.error('vernier-caliper: DEPTH_GAP too small for DEPTH_MAX_MM');
    }
    // [VC-DEPTH-CONST-END]

    // Vertical placement: a part is centred in the throat rather than hung from the
    // top, so a short bar and a tall cylinder both sit on the jaws' centreline —
    // which is also where you would hold real work, clear of the jaw tips.
    function wpBandY(h) {
        return WP_MID_Y - h / 2;
    }

    // True sizes are realistic, not tidy: a 5/8" ball is 15.88 mm and an M12 nut
    // measures under its 18.00 mm nominal. Where a size is finer than the selected
    // least count the instrument genuinely cannot resolve it — that mismatch is the
    // lesson, and the object bar spells it out.
    const WORKPIECES = [{
            id: 'bar',
            short: 'Bar',
            name: 'Rectangular bar',
            what: 'across the width',
            mm: 24.60,
            hMm: 13.0,
            shape: 'bar',
            note: 'Flat mild-steel bar, nominal 25 mm &times; 13 mm. Bar stock is rolled undersize, so it will not read a round 25.00 mm.'
        },
        {
            id: 'cylv',
            short: 'Cylinder ↕',
            name: 'Cylinder — standing',
            what: 'across the diameter',
            mm: 18.40,
            hMm: 25.0,
            shape: 'cylV',
            note: 'Stand a cylinder on end and the jaws close on its <strong>diameter</strong>. Rock the caliper and take the <strong>smallest</strong> reading &mdash; tilting the jaws spans a diagonal, which reads large.'
        },
        {
            id: 'cylh',
            short: 'Cylinder ↔',
            name: 'Cylinder — lying down',
            what: 'along the length',
            mm: 30.00,
            hMm: 18.4,
            shape: 'cylH',
            note: 'The same cylinder laid down. Now the jaws span its <strong>length</strong>, not its diameter &mdash; orientation decides which dimension you get.'
        },
        {
            id: 'ball',
            short: 'Ball',
            name: 'Ball bearing',
            what: 'across the diameter',
            mm: 15.88,
            hMm: 15.88,
            shape: 'ball',
            note: 'A 5/8&Prime; bearing ball = 15.875 mm. Flat jaws tangent to a sphere are always a diameter apart, so angle cannot mislead you here &mdash; squeeze can. Close with the thumb roller until the ball will just still roll.'
        },
        {
            id: 'cube',
            short: 'Cube',
            name: 'Cube block',
            what: 'across one face',
            mm: 20.00,
            hMm: 20.0,
            shape: 'cube',
            note: 'A ground cube. Measure all three axes &mdash; a cube that reads the same on every pair of faces is square within your least count.'
        },
        {
            id: 'nut',
            short: 'Hex nut',
            name: 'M12 hex nut',
            what: 'across the flats',
            mm: 17.86,
            hMm: 20.62,
            shape: 'nut',
            note: 'ISO 4032 gives M12 a nominal 18.00 mm across flats, made to a minus tolerance. Measure across <em>flats</em>, never across corners.'
        },
        {
            id: 'drill',
            short: 'Drill',
            name: 'Ø10 drill shank',
            what: 'across the diameter',
            mm: 9.90,
            hMm: 25.0,
            shape: 'drill',
            note: 'Drill shanks are ground a few hundredths under nominal so they enter the chuck. Measure the plain shank, never across the flutes.'
        },
        {
            id: 'plate',
            short: 'Plate',
            name: 'Gauge plate',
            what: 'across the thickness',
            mm: 6.35,
            hMm: 24.0,
            shape: 'plate',
            note: '1/4&Prime; ground plate = 6.35 mm. Thin work is easy to over-squeeze &mdash; close with the thumb roller until the jaws just drag.'
        },
        // minMm: the inside jaws sit INSIDE the hole, so they cannot retract through
        // the wall. At 4.70 mm the sliding nib's outer edge (head travel + its 8 px
        // half-width) has just cleared the bore wall at x = 32 — closed as far as the
        // pair physically goes while both nibs stay in the bore.
        {
            id: 'ring',
            short: 'Ring',
            name: 'Ring / bush (bore)',
            what: 'the internal diameter',
            mm: 19.96,
            minMm: 4.70,
            shape: 'ring',
            kind: 'internal',
            note: 'A bush reamed for a nominal 20 mm shaft. Internal diameters are taken on the <strong>upper knife edges</strong>: start with them closed inside the bore and open until both nibs touch the wall. Because the nibs carry a tip radius they cannot quite reach the true diameter, so a caliper reads a bore a few hundredths <em>small</em> &mdash; use a bore gauge or internal micrometer when that matters.'
        },
        // Depth parts. The rod extends out of the tail end by exactly the jaw
        // opening, so a depth reads on the SAME main + vernier scales as everything
        // else — there is no second scale to learn. What is different is the
        // reference surface: the END OF THE BEAM, not a jaw face.
        {
            id: 'hole',
            short: 'Blind hole',
            name: 'Blind hole in a block',
            what: 'the depth of the hole',
            mm: 12.70,
            shape: 'depth',
            kind: 'depth',
            boreMm: 10.0,
            note: 'A &frac12;&Prime; deep blind hole. Stand the <strong>end of the beam</strong> flat across the mouth of the hole and wind the rod down until it just touches the bottom. The beam end is the reference surface, so it must bridge the hole squarely &mdash; tip the caliper and you read short.'
        },
        {
            id: 'cbore',
            short: 'C\u2019bore',
            name: 'Counterbore depth',
            what: 'the counterbore depth',
            mm: 8.25,
            shape: 'depth',
            kind: 'depth',
            boreMm: 16.0,
            note: 'A counterbore for a cap screw head. The rod is narrower than the bore, so it can wander off the flat &mdash; take the <strong>smallest</strong> reading, which is the one taken square to the floor of the bore.'
        },
        {
            id: 'slot',
            short: 'Slot',
            name: 'Milled slot',
            what: 'the slot depth',
            mm: 21.50,
            shape: 'depth',
            kind: 'depth',
            boreMm: 22.0,
            note: 'A milled slot. A caliper depth rod is the least accurate feature on the instrument &mdash; it is thin, it is unsupported and the beam end is a short reference. For anything tighter than about &plusmn;0.05 mm use a depth micrometer or a depth gauge.'
        }
    ];

    // Practice and Quiz draw from a SEPARATE catalogue. A student who has worked
    // through Simulate has seen those nine sizes; graded exercises use different
    // parts so the answer still has to be measured rather than recalled.
    //
    // Every size is an even number of hundredths, so all three metric least counts
    // resolve it without landing on a half-LC tie, and the notes deliberately carry
    // no dimensions — the object bar would otherwise print the answer.
    const WP_EXERCISE = [{
            id: 'x1',
            short: 'Bar',
            name: 'Flat bar',
            what: 'across the width',
            mm: 34.16,
            hMm: 13.0,
            shape: 'bar',
            note: 'Hold the bar square to the jaws — cocked stock reads wide.'
        },
        {
            id: 'x2',
            short: 'Bar',
            name: 'Narrow bar',
            what: 'across the width',
            mm: 17.24,
            hMm: 13.0,
            shape: 'bar',
            note: 'Measure well inside the jaw, not on the tips.'
        },
        {
            id: 'x3',
            short: 'Cylinder ↕',
            name: 'Cylinder — standing',
            what: 'across the diameter',
            mm: 22.62,
            hMm: 25.0,
            shape: 'cylV',
            note: 'Rock the caliper and take the <strong>smallest</strong> reading &mdash; on an outside diameter a tilted jaw always reads large.'
        },
        {
            id: 'x4',
            short: 'Cylinder ↕',
            name: 'Pin — standing',
            what: 'across the diameter',
            mm: 12.08,
            hMm: 25.0,
            shape: 'cylV',
            note: 'Small diameters magnify jaw-pressure error; close with the thumb roller.'
        },
        {
            id: 'x5',
            short: 'Cylinder ↔',
            name: 'Cylinder — lying down',
            what: 'along the length',
            mm: 41.30,
            hMm: 18.4,
            shape: 'cylH',
            note: 'Lying down, the jaws span the length — not the diameter.'
        },
        {
            id: 'x6',
            short: 'Cylinder ↔',
            name: 'Roller — lying down',
            what: 'along the length',
            mm: 27.72,
            hMm: 16.0,
            shape: 'cylH',
            note: 'Both end faces must sit flat against the jaws.'
        },
        {
            id: 'x7',
            short: 'Ball',
            name: 'Bearing ball',
            what: 'across the diameter',
            mm: 9.52,
            hMm: 9.52,
            shape: 'ball',
            note: 'A sphere touches at two points only — keep the jaws square or you read a chord.'
        },
        {
            id: 'x8',
            short: 'Ball',
            name: 'Large bearing ball',
            what: 'across the diameter',
            mm: 22.22,
            hMm: 22.22,
            shape: 'ball',
            note: 'Take two readings at right angles; a true ball reads the same both ways.'
        },
        {
            id: 'x9',
            short: 'Cube',
            name: 'Cube block',
            what: 'across one face',
            mm: 14.56,
            hMm: 14.56,
            shape: 'cube',
            note: 'Check all three axes — equal readings mean the block is square.'
        },
        {
            id: 'x10',
            short: 'Cube',
            name: 'Ground cube',
            what: 'across one face',
            mm: 23.40,
            hMm: 23.40,
            shape: 'cube',
            note: 'Wipe the faces first; a burr or chip reads as extra size.'
        },
        {
            id: 'x11',
            short: 'Hex nut',
            name: 'M8 hex nut',
            what: 'across the flats',
            mm: 12.92,
            hMm: 14.92,
            shape: 'nut',
            note: 'Across FLATS, never across corners — corners read about 15% larger.'
        },
        {
            id: 'x12',
            short: 'Hex nut',
            name: 'M14 hex nut',
            what: 'across the flats',
            mm: 21.72,
            hMm: 25.08,
            shape: 'nut',
            note: 'Nuts are made to a minus tolerance, so expect to read under nominal.'
        },
        {
            id: 'x13',
            short: 'Drill',
            name: 'Drill shank',
            what: 'across the diameter',
            mm: 7.94,
            hMm: 25.0,
            shape: 'drill',
            note: 'Measure the plain shank, never across the flutes.'
        },
        {
            id: 'x14',
            short: 'Drill',
            name: 'Large drill shank',
            what: 'across the diameter',
            mm: 13.86,
            hMm: 25.0,
            shape: 'drill',
            note: 'Shanks are ground under nominal so they enter the chuck.'
        },
        {
            id: 'x15',
            short: 'Plate',
            name: 'Thin plate',
            what: 'across the thickness',
            mm: 3.18,
            hMm: 24.0,
            shape: 'plate',
            note: 'Thin work is easy to over-squeeze — close until the jaws just drag.'
        },
        {
            id: 'x16',
            short: 'Plate',
            name: 'Ground plate',
            what: 'across the thickness',
            mm: 9.54,
            hMm: 24.0,
            shape: 'plate',
            note: 'Take the reading near the middle of the jaw face.'
        },
        {
            id: 'x17',
            short: 'Ring',
            name: 'Ring / bush (bore)',
            what: 'the internal diameter',
            mm: 16.34,
            minMm: 4.70,
            wallPx: 13,
            shape: 'ring',
            kind: 'internal',
            note: 'Inside jaws: open them until both nibs just touch the bore wall.'
        },
        {
            id: 'x18',
            short: 'Ring',
            name: 'Small bush (bore)',
            what: 'the internal diameter',
            mm: 10.32,
            minMm: 4.70,
            wallPx: 13,
            shape: 'ring',
            kind: 'internal',
            note: 'Rock the caliper in the bore and take the largest reading.'
        },
        {
            id: 'x19',
            short: 'Blind hole',
            name: 'Blind hole in a block',
            what: 'the depth of the hole',
            mm: 15.46,
            shape: 'depth',
            kind: 'depth',
            boreMm: 11.0,
            note: 'Bridge the mouth of the hole squarely with the end of the beam &mdash; a tipped caliper reads short.'
        },
        {
            id: 'x20',
            short: 'C\u2019bore',
            name: 'Counterbore depth',
            what: 'the counterbore depth',
            mm: 6.88,
            shape: 'depth',
            kind: 'depth',
            boreMm: 18.0,
            note: 'The rod is narrower than the bore; take the smallest reading, square to the floor.'
        },
        {
            id: 'x21',
            short: 'Slot',
            name: 'Milled slot',
            what: 'the slot depth',
            mm: 19.24,
            shape: 'depth',
            kind: 'depth',
            boreMm: 20.0,
            note: 'Sit the beam end on both shoulders of the slot, not on one edge.'
        }
    ];

    function findWp(id) {
        const all = WORKPIECES.concat(WP_EXERCISE);
        for (let i = 0; i < all.length; i++)
            if (all[i].id === id) return all[i];
        return null;
    }

    // Avoid handing out the same part twice in a row (or twice in one quiz).
    function pickExerciseWp(exclude) {
        const pool = WP_EXERCISE.filter(function(w) {
            return !exclude || exclude.indexOf(w.id) < 0;
        });
        const from = pool.length ? pool : WP_EXERCISE;
        return from[Math.floor(Math.random() * from.length)];
    }

    function getWp() {
        return state.wp;
    }

    function wpIsInternal() {
        return !!state.wp && state.wp.kind === 'internal';
    }

    function wpIsDepth() {
        return !!state.wp && state.wp.kind === 'depth';
    }

    // In Simulate the true size is shown on contact as instant feedback. In a graded
    // exercise that would BE the answer, so every reveal — the canvas caption, the
    // object bar's size and its resolution note — waits until the attempt is marked.
    function wpRevealAllowed() {
        if (state.mode === 'practice') return !!state.answered;
        if (state.mode === 'quiz') return !!state.quizAnswered;
        return state.mode === 'free';
    }

    // An external part blocks the jaws from CLOSING past it; a bore blocks them from
    // OPENING past it. Same stop, opposite direction. A blind hole is the bore case
    // again — the rod bottoms out — but it retracts all the way to zero, because
    // nothing is in the way of pulling it back flush with the beam end.
    function wpMinMm() {
        if (!state.wp) return 0;
        if (wpIsDepth()) return 0;
        // A bore does NOT floor the reading: the jaws start shut (vernier zero on main
        // zero, as on a real caliper) and open onto the wall. `minMm` is only the
        // nib clearance that ringGeom() uses to slide the bush out of the way.
        return wpIsInternal() ? 0 : state.wp.mm;
    }

    function wpMaxMm() {
        return (wpIsInternal() || wpIsDepth()) ? state.wp.mm : getMaxMm();
    }

    function wpInContact() {
        if (!state.wp) return false;
        return (wpIsInternal() || wpIsDepth()) ? state.mm >= state.wp.mm - 1e-6 :
            state.mm <= state.wp.mm + 1e-6;
    }

    // Every path that moves the head funnels through here so the workpiece stop is
    // impossible to bypass. Snapping happens first, then the part stops the jaws —
    // which is why a part can rest off the least-count grid, exactly as in reality.
    function setMm(v) {
        if (!isFinite(v)) return; // a stray NaN must never poison the state
        state.mm = clamp(v, wpMinMm(), wpMaxMm());
    }

    function wpSteel(y, h, lo, mid, hi) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0.00, lo || '#79828f');
        g.addColorStop(0.16, '#c2ccd8');
        g.addColorStop(0.32, hi || '#f0f5fa');
        g.addColorStop(0.54, mid || '#a3adbb');
        g.addColorStop(0.80, '#c6cfdb');
        g.addColorStop(1.00, '#5f6774');
        return g;
    }
    // Barrel shading for a round bar: bright specular band offset from centre.
    function wpBarrel(a, b, horiz) {
        const g = horiz ? ctx.createLinearGradient(0, a, 0, b) : ctx.createLinearGradient(a, 0, b, 0);
        g.addColorStop(0.00, '#4e5661');
        g.addColorStop(0.10, '#8b95a3');
        g.addColorStop(0.30, '#eef3f8');
        g.addColorStop(0.42, '#c4ccd8');
        g.addColorStop(0.62, '#98a2b0');
        g.addColorStop(0.86, '#6d7683');
        g.addColorStop(1.00, '#454c56');
        return g;
    }

    function wpRoundRect(x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, rr);
        else {
            ctx.moveTo(x + rr, y);
            ctx.lineTo(x + w - rr, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
            ctx.lineTo(x + w, y + h - rr);
            ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
            ctx.lineTo(x + rr, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
            ctx.lineTo(x, y + rr);
            ctx.quadraticCurveTo(x, y, x + rr, y);
        }
    }

    // Each shape's silhouette is EXACTLY w px wide — w is the true size in pixels,
    // so what the jaws close on is what the drawing shows. Nothing may overhang.
    const WP_SHAPES = {
        bar: function(x, y, w, h) {
            ctx.fillStyle = wpSteel(y, h);
            wpRoundRect(x, y, w, h, 2.5);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.30)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 2, y + 3.5);
            ctx.lineTo(x + w - 2, y + 3.5);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath();
            ctx.moveTo(x + 2, y + h - 3.5);
            ctx.lineTo(x + w - 2, y + h - 3.5);
            ctx.stroke();
        },
        cylV: function(x, y, w, h) {
            const capH = Math.min(w * 0.30, 16);
            ctx.fillStyle = wpBarrel(x, x + w, false);
            ctx.beginPath();
            ctx.rect(x, y + capH / 2, w, h - capH / 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(x + w / 2, y + h - capH / 2, w / 2, capH / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#dfe6ee';
            ctx.beginPath();
            ctx.ellipse(x + w / 2, y + capH / 2, w / 2, capH / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = 'rgba(120,132,148,0.55)';
            ctx.beginPath();
            ctx.ellipse(x + w / 2, y + capH / 2, w / 2 - 3, capH / 2 - 1.6, 0, 0, Math.PI * 2);
            ctx.fill();
        },
        cylH: function(x, y, w, h) {
            const capW = Math.min(h * 0.30, 16);
            ctx.fillStyle = wpBarrel(y, y + h, true);
            ctx.beginPath();
            ctx.rect(x, y, w - capW / 2, h);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(x + capW / 2, y + h / 2, capW / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#dfe6ee';
            ctx.beginPath();
            ctx.ellipse(x + w - capW / 2, y + h / 2, capW / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = 'rgba(120,132,148,0.55)';
            ctx.beginPath();
            ctx.ellipse(x + w - capW / 2, y + h / 2, capW / 2 - 1.6, h / 2 - 3, 0, 0, Math.PI * 2);
            ctx.fill();
        },
        ball: function(x, y, w, h) {
            const r = w / 2,
                cx = x + r,
                cy = y + h / 2;
            const g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.40, r * 0.06, cx, cy, r);
            g.addColorStop(0.00, '#ffffff');
            g.addColorStop(0.16, '#e6edf5');
            g.addColorStop(0.48, '#a9b3c1');
            g.addColorStop(0.80, '#6d7683');
            g.addColorStop(1.00, '#3f464f');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.beginPath();
            ctx.ellipse(cx - r * 0.36, cy - r * 0.44, r * 0.20, r * 0.13, -0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.86, 0.8, 2.1);
            ctx.stroke();
        },
        cube: function(x, y, w, h) {
            ctx.fillStyle = wpSteel(y, h, '#6f7784', '#9aa4b2', '#e8eef5');
            wpRoundRect(x, y, w, h, 2);
            ctx.fill();
            // Bevelled top and left edges, drawn INSIDE the silhouette so the measured
            // width stays exactly w.
            const b = Math.min(w, h) * 0.14;
            ctx.fillStyle = 'rgba(255,255,255,0.26)';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + w, y);
            ctx.lineTo(x + w - b, y + b);
            ctx.lineTo(x + b, y + b);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.beginPath();
            ctx.moveTo(x + w, y);
            ctx.lineTo(x + w, y + h);
            ctx.lineTo(x + w - b, y + h - b);
            ctx.lineTo(x + w - b, y + b);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.30)';
            ctx.lineWidth = 1;
            wpRoundRect(x + 0.5, y + 0.5, w - 1, h - 1, 2);
            ctx.stroke();
        },
        nut: function(x, y, w, h) {
            // Regular hexagon with FLATS vertical: width = across flats (= w, the
            // measured dimension), height = across corners = w × 2/√3.
            const cx = x + w / 2,
                cy = y + h / 2,
                af = w / 2,
                ac = h / 2;
            ctx.fillStyle = wpSteel(y, h, '#5d6572', '#8f99a7', '#dde5ee');
            ctx.beginPath();
            ctx.moveTo(cx - af, cy - ac / 2);
            ctx.lineTo(cx, cy - ac);
            ctx.lineTo(cx + af, cy - ac / 2);
            ctx.lineTo(cx + af, cy + ac / 2);
            ctx.lineTo(cx, cy + ac);
            ctx.lineTo(cx - af, cy + ac / 2);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.38)';
            ctx.lineWidth = 1;
            ctx.stroke();
            const br = af * 0.56;
            ctx.fillStyle = '#2b313a';
            ctx.beginPath();
            ctx.ellipse(cx, cy, br, br, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(190,200,214,0.5)';
            ctx.lineWidth = 1;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(cx - br, cy + i * br * 0.42);
                ctx.lineTo(cx + br, cy + i * br * 0.42 - br * 0.16);
                ctx.stroke();
            }
        },
        drill: function(x, y, w, h) {
            const shankH = h * 0.36;
            ctx.fillStyle = wpBarrel(x, x + w, false);
            ctx.beginPath();
            ctx.rect(x, y, w, h - shankH * 0.1);
            ctx.fill();
            // Helical flutes over the cutting portion (kept inside the silhouette).
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h - shankH);
            ctx.clip();
            ctx.strokeStyle = 'rgba(30,36,44,0.55)';
            ctx.lineWidth = Math.max(1.4, w * 0.16);
            for (let k = -2; k < 8; k++) {
                ctx.beginPath();
                ctx.moveTo(x - w * 0.2, y + k * 18);
                ctx.bezierCurveTo(x + w * 0.5, y + k * 18 + 6, x + w * 0.5, y + k * 18 + 12, x + w * 1.2, y + k * 18 + 18);
                ctx.stroke();
            }
            ctx.restore();
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            ctx.fillRect(x, y + h - shankH, w, 1.5);
            ctx.strokeStyle = 'rgba(0,0,0,0.34)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        },
        plate: function(x, y, w, h) {
            ctx.fillStyle = wpBarrel(x, x + w, false);
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'rgba(0,0,0,0.34)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
            ctx.strokeStyle = 'rgba(255,255,255,0.30)';
            ctx.beginPath();
            ctx.moveTo(x + w / 2, y + 3);
            ctx.lineTo(x + w / 2, y + h - 3);
            ctx.stroke();
        }
    };

    // Bore geometry. The left wall sits exactly on the fixed inside jaw's face and
    // the bore is exactly mm × px/mm wide, so at contact the sliding jaw's face lands
    // precisely on the right wall. The bush runs from just inside the top of the
    // frame down to WP_IN_Y1, so the knife edges (tips at y = 2) stand well inside it.
    function ringGeom() {
        const wp = state.wp;
        const d = wp.mm * getPxPerMm();
        const t = WP_IN_WALL;
        const y0 = 4 - S.PAD_TOP,
            y1 = WP_IN_Y1;
        // The left wall rests on the fixed nib's face only from minMm upward. With the
        // jaws shut tighter than that the sliding nib would stand inside the metal, so
        // the loose bush stands off to the left by exactly the shortfall — the nibs
        // then hang clear inside the hole and touch neither wall.
        const ox = Math.max(0, ((wp.minMm || 0) - state.mm) * getPxPerMm());
        const bl = WP_IN_FACE_X - ox;
        return {
            d: d,
            a: d / 2,
            A: d / 2 + t,
            t: t,
            y0: y0,
            y1: y1,
            bl: bl,
            br: bl + d,
            cx: bl + d / 2,
            cy: (y0 + y1) / 2
        };
    }

    // Far half of the bore — the inside of a cylinder whose axis runs up the page,
    // so it shades ACROSS x (lit where it faces the key light, dark where it turns
    // away). Painted BEHIND the instrument: the knife edges stand in front of it.
    function drawRingBack() {
        if (!wpIsInternal()) return;
        const g = ringGeom();
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;
        ctx.fillStyle = '#2b3139';
        ctx.fillRect(g.bl - g.t, g.y0, g.d + 2 * g.t, g.y1 - g.y0);
        ctx.restore();
        const bore = ctx.createLinearGradient(g.bl, 0, g.br, 0);
        bore.addColorStop(0.00, '#1b2129');
        bore.addColorStop(0.30, '#6a737e');
        bore.addColorStop(0.55, '#8d96a1');
        bore.addColorStop(1.00, '#252b33');
        ctx.fillStyle = bore;
        ctx.fillRect(g.bl, g.y0, g.d, g.y1 - g.y0);
        // Turning marks run round the bore, i.e. ACROSS it in this view.
        ctx.strokeStyle = 'rgba(0,0,0,0.10)';
        ctx.lineWidth = 1;
        for (let y = g.y0 + 3; y < g.y1; y += 3) {
            ctx.beginPath();
            ctx.moveTo(g.bl, y + 0.5);
            ctx.lineTo(g.br, y + 0.5);
            ctx.stroke();
        }
    }

    // The two cut walls, painted AFTER the instrument: the section plane passes
    // through the jaws, so the walls sit level with the knife edges they touch.
    function drawRing() {
        if (!wpIsInternal()) return;
        const g = ringGeom();
        const contact = wpInContact();
        const h = g.y1 - g.y0;
        ctx.save();
        [g.bl - g.t, g.br].forEach(function(x) {
            ctx.fillStyle = wpSteel(g.y0, h);
            ctx.fillRect(x, g.y0, g.t, h);
            // Section hatching, 45 deg, the same pitch and weight as the depth block.
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, g.y0, g.t, h);
            ctx.clip();
            ctx.strokeStyle = 'rgba(24,32,42,0.34)';
            ctx.lineWidth = 1;
            for (let k = -h; k < g.t + h; k += 9) {
                ctx.beginPath();
                ctx.moveTo(x + k, g.y1);
                ctx.lineTo(x + k + h, g.y0);
                ctx.stroke();
            }
            ctx.restore();
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, g.y0 + 0.5, g.t - 1, h - 1);
        });
        // Chamfered mouth: a light arris along the top of each wall.
        ctx.strokeStyle = 'rgba(255,255,255,0.40)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.bl - g.t + 1, g.y0 + 1.5);
        ctx.lineTo(g.bl - 1, g.y0 + 1.5);
        ctx.moveTo(g.br + 1, g.y0 + 1.5);
        ctx.lineTo(g.br + g.t - 1, g.y0 + 1.5);
        ctx.stroke();

        // Contact: the two bore-wall faces the nibs are touching.
        if (contact) {
            ctx.strokeStyle = 'rgba(61,220,132,0.95)';
            ctx.lineWidth = 2.6;
            ctx.shadowColor = 'rgba(61,220,132,0.9)';
            ctx.shadowBlur = 7;
            ctx.beginPath();
            ctx.moveTo(g.bl - 1, 4);
            ctx.lineTo(g.bl - 1, g.y1 - 4);
            ctx.moveTo(g.br + 1, 4);
            ctx.lineTo(g.br + 1, g.y1 - 4);
            ctx.stroke();
        }
        ctx.restore();
    }

    // ── Depth part ────────────────────────────────────────────────────
    // Drawn in SECTION — the block cut through the hole — because a depth is the
    // one caliper measurement you cannot see from outside. The rod is painted
    // afterwards, by the normal blade layer, so it appears down inside the cavity.
    //
    // [VC-DEPTH-GEOM-BEGIN] — sliced by deploy/verify-vernier-depth.js
    function depthGeom() {
        const wp = state.wp;
        if (!wp || wp.kind !== 'depth') return null;
        const ppm = getPxPerMm();
        const cy = (S.scaleOriginY0 + S.scaleOriginY) / 2; // the rod's own axis
        const dPx = wp.mm * ppm; // hole depth, true scale
        const boreH = Math.min((wp.boreMm || 10) * ppm, 150);
        const blkH = Math.min(Math.max(boreH + 64, 132), 240);
        const FLOOR = 38; // metal behind the hole
        return {
            x: DEPTH_FACE_X,
            y: cy - blkH / 2,
            w: dPx + FLOOR,
            h: blkH,
            cy: cy,
            dPx: dPx,
            boreH: boreH,
            floor: FLOOR,
            // The rod tip, from the SAME funnel the blade layer paints it with — so the
            // dimension, the cavity and the metal cannot drift apart.
            tipX: DEPTH_FACE_X + depthRodDrawnPx()
        };
    }
    // The one quantity the whole mode exists to show. Kept as its own funnel so the
    // harness can assert it is strictly monotonic in the reading — a drawn length
    // that goes constant while every number stays right is this file's known trap.
    function depthRodDrawnPx() {
        return getShiftPx();
    }
    // [VC-DEPTH-GEOM-END]

    function drawDepthPart() {
        const g = depthGeom();
        if (!g) return;
        const contact = wpInContact();
        const boreY0 = g.cy - g.boreH / 2,
            boreY1 = g.cy + g.boreH / 2;

        ctx.save();

        // Cast shadow, so the block sits on the same bench as the instrument.
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 5;
        ctx.fillStyle = '#39404b';
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.restore();

        // Body.
        ctx.fillStyle = wpSteel(g.y, g.h);
        ctx.fillRect(g.x, g.y, g.w, g.h);

        // Section hatching at 45 deg, clipped to the body — the drawing convention
        // that says "this is cut", which is what makes the cavity legible as a hole
        // rather than a black rectangle painted on the side of a block.
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.x, g.y, g.w, g.h);
        ctx.clip();
        ctx.strokeStyle = 'rgba(24,32,42,0.30)';
        ctx.lineWidth = 1;
        for (let d = -g.h; d < g.w + g.h; d += 9) {
            ctx.beginPath();
            ctx.moveTo(g.x + d, g.y + g.h);
            ctx.lineTo(g.x + d + g.h, g.y);
            ctx.stroke();
        }
        ctx.restore();

        // The cavity. Cut AFTER the hatching, so no hatch survives inside the hole.
        const cav = ctx.createLinearGradient(0, boreY0, 0, boreY1);
        cav.addColorStop(0.00, '#0a1219');
        cav.addColorStop(0.50, '#16212c');
        cav.addColorStop(1.00, '#080e14');
        ctx.fillStyle = cav;
        ctx.fillRect(g.x - 1, boreY0, g.dPx + 1, g.boreH);

        // Bore floor and mouth lips.
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(g.x + g.dPx, boreY0);
        ctx.lineTo(g.x + g.dPx, boreY1);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x, boreY0 - 0.5);
        ctx.lineTo(g.x + g.dPx, boreY0 - 0.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.moveTo(g.x, boreY1 + 0.5);
        ctx.lineTo(g.x + g.dPx, boreY1 + 0.5);
        ctx.stroke();

        // The reference face. This is the teaching point of the whole mode: the datum
        // is the END OF THE BEAM resting on this surface, not a jaw face, so it is
        // marked whether or not the rod has reached the bottom.
        ctx.strokeStyle = contact ? 'rgba(61,220,132,0.95)' : 'rgba(150,200,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(g.x + 1, g.y + 3);
        ctx.lineTo(g.x + 1, boreY0 - 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(g.x + 1, boreY1 + 2);
        ctx.lineTo(g.x + 1, g.y + g.h - 3);
        ctx.stroke();

        // Contact: the rod is on the floor of the hole.
        if (contact) {
            ctx.strokeStyle = 'rgba(61,220,132,0.95)';
            ctx.lineWidth = 2.6;
            ctx.shadowColor = 'rgba(61,220,132,0.9)';
            ctx.shadowBlur = 7;
            ctx.beginPath();
            ctx.moveTo(g.x + g.dPx - 1, boreY0 + 3);
            ctx.lineTo(g.x + g.dPx - 1, boreY1 - 3);
            ctx.stroke();
        }
        ctx.restore();
    }

    // The broken-beam symbol over the seam, plus the sliver of background the two
    // sprite pieces leave between them.
    function drawBeamBreak() {
        const x = DEPTH_BREAK_X,
            y0 = DEPTH_BEAM_Y0,
            y1 = DEPTH_BEAM_Y1;
        ctx.save();
        ctx.strokeStyle = 'rgba(10,18,25,0.85)';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        [-5, 5].forEach(function(dx) {
            ctx.beginPath();
            let up = true;
            ctx.moveTo(x + dx, y0);
            for (let y = y0 + 8; y <= y1; y += 8) {
                ctx.lineTo(x + dx + (up ? 5 : -5), Math.min(y, y1));
                up = !up;
            }
            ctx.stroke();
        });
        ctx.restore();
    }

    function drawWorkpiece() {
        const wp = state.wp;
        if (!wp || wp.kind === 'internal' || wp.kind === 'depth') return; // drawn in their own layers
        const ppm = getPxPerMm();
        const w = wp.mm * ppm;
        const h = Math.min(wp.hMm * ppm, WP_MAX_Y - WP_TOP_Y);
        const x = WP_FACE_X;
        const y = wpBandY(h);
        const contact = wpInContact();

        // Contact shadow on the throat floor.
        ctx.save();
        const sg = ctx.createRadialGradient(x + w / 2, y + h + 4, 2, x + w / 2, y + h + 4, w * 0.75);
        sg.addColorStop(0, 'rgba(0,0,0,0.42)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h + 5, w * 0.62, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        (WP_SHAPES[wp.shape] || WP_SHAPES.bar)(x, y, w, h);
        ctx.restore();

        // Contact marks — thin bright lines on the two faces the jaws are touching.
        if (contact) {
            ctx.save();
            ctx.strokeStyle = 'rgba(61,220,132,0.95)';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = 'rgba(61,220,132,0.9)';
            ctx.shadowBlur = 7;
            const cy = y + h / 2,
                half = Math.min(h * 0.34, 26);
            ctx.beginPath();
            ctx.moveTo(x + 1, cy - half);
            ctx.lineTo(x + 1, cy + half);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + w - 1, cy - half);
            ctx.lineTo(x + w - 1, cy + half);
            ctx.stroke();
            ctx.restore();
        }

    }

    // Dimension line beneath the part, spanning exactly the measured face-to-face
    // distance — a technical-drawing cue for WHICH dimension the jaws are on. Drawn
    // as a top annotation layer so the fixed jaw cannot clip its label.
    function wpDimText(contact) {
        const wp = state.wp;
        if (!contact) return wp.what;
        if (!wpRevealAllowed()) return 'read the scale';
        return isImperial() ? fmtDispValue(wp.mm * MM_TO_IN) + '″' : wp.mm.toFixed(2) + ' mm';
    }

    // Caption chip, drawn centred on (cx, cy). Returns nothing — purely a stamp.
    function wpDimChip(txt, cx, cy, contact) {
        ctx.font = 'bold 9pt sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(6,12,18,0.78)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx - tw / 2 - 6, cy - 9, tw + 12, 18, 4);
        else ctx.rect(cx - tw / 2 - 6, cy - 9, tw + 12, 18);
        ctx.fill();
        ctx.fillStyle = contact ? '#3ddc84' : 'rgba(190,206,224,0.85)';
        ctx.fillText(txt, cx, cy);
    }

    // Internal dimension: the line lies inside the bore and its arrows point OUTWARD
    // into the two walls — the drawing convention for a hole, and the opposite of
    // the inward arrows used on an external size.
    function drawRingDims() {
        const g = ringGeom();
        const contact = wpInContact();
        const col = contact ? 'rgba(61,220,132,0.9)' : 'rgba(180,196,216,0.6)';
        ctx.save();
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(g.bl + 7, g.cy);
        ctx.lineTo(g.br - 7, g.cy);
        ctx.stroke();
        [
            [g.bl, 1],
            [g.br, -1]
        ].forEach(function(a) {
            ctx.beginPath();
            ctx.moveTo(a[0], g.cy);
            ctx.lineTo(a[0] + 8 * a[1], g.cy - 3.2);
            ctx.lineTo(a[0] + 8 * a[1], g.cy + 3.2);
            ctx.closePath();
            ctx.fill();
        });
        // Leader out to a caption parked clear of the ring and both knife edges.
        const chipY = g.cy - 4,
            chipX = g.cx + g.A + 66;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(g.br + 2, g.cy);
        ctx.lineTo(chipX - 46, chipY);
        ctx.stroke();
        ctx.setLineDash([]);
        wpDimChip('I.D.  ' + wpDimText(contact), chipX, chipY, contact);
        ctx.restore();
    }

    // Depth dimension: measured FROM the reference face (the beam end) INTO the
    // material, with the arrows pointing outward into the two surfaces it spans —
    // the same convention drawRingDims uses for a bore, turned through 90 degrees.
    function drawDepthDims() {
        const g = depthGeom();
        if (!g) return;
        const contact = wpInContact();
        const col = contact ? 'rgba(61,220,132,0.9)' : 'rgba(180,196,216,0.6)';
        const dy = g.y + g.h + 20;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1.1;

        // Witness lines: one down the reference face, one down the bore floor.
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(g.x, g.y + g.h + 3);
        ctx.lineTo(g.x, dy + 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(g.x + g.dPx, g.y + g.h + 3);
        ctx.lineTo(g.x + g.dPx, dy + 5);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.moveTo(g.x, dy);
        ctx.lineTo(g.x + g.dPx, dy);
        ctx.stroke();
        [
            [g.x, 1],
            [g.x + g.dPx, -1]
        ].forEach(function(a) {
            ctx.beginPath();
            ctx.moveTo(a[0], dy);
            ctx.lineTo(a[0] + 7 * a[1], dy - 3);
            ctx.lineTo(a[0] + 7 * a[1], dy + 3);
            ctx.closePath();
            ctx.fill();
        });

        ctx.font = 'bold 9pt sans-serif';
        const txt = 'DEPTH  ' + wpDimText(contact);
        const tw = ctx.measureText(txt).width;
        wpDimChip(txt, clamp(g.x + g.dPx / 2, tw / 2 + 6, S.CW - tw / 2 - 10), dy + 16, contact);

        // Name the datum. Which surface the reading is taken from is the single thing
        // a student gets wrong on a depth, so it is labelled rather than implied.
        // Parked BELOW the beam band, not above it: the canvas toolbar (Coincidence,
        // Zoom) floats over the top-right of the card and swallowed the label there
        // at phone widths.
        ctx.font = '8pt sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(170,190,212,0.85)';
        ctx.fillText('beam end = datum', g.x - 8, Math.max(g.y + g.h - 9, DEPTH_BEAM_Y1 + 14));
        ctx.restore();
    }

    function drawWorkpieceDims() {
        const wp = state.wp;
        if (!wp) return;
        if (wp.kind === 'internal') {
            drawRingDims();
            return;
        }
        if (wp.kind === 'depth') {
            drawDepthDims();
            return;
        }
        const ppm = getPxPerMm();
        const w = wp.mm * ppm;
        const h = Math.min(wp.hMm * ppm, WP_MAX_Y - WP_TOP_Y);
        const x = WP_FACE_X;
        const contact = wpInContact();

        // Held a constant gap under the part, but never low enough to clip the label.
        const partBottom = wpBandY(h) + h;
        const dy = Math.min(partBottom + 18, WP_DIM_Y);
        ctx.save();
        ctx.strokeStyle = contact ? 'rgba(61,220,132,0.9)' : 'rgba(180,196,216,0.55)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1.1;
        // Witness lines run down from the part's measured faces to the dimension line.
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, partBottom + 3);
        ctx.lineTo(x, dy + 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + w, partBottom + 3);
        ctx.lineTo(x + w, dy + 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x, dy);
        ctx.lineTo(x + w, dy);
        ctx.stroke();
        [
            [x, 1],
            [x + w, -1]
        ].forEach(function(a) {
            ctx.beginPath();
            ctx.moveTo(a[0], dy);
            ctx.lineTo(a[0] + 7 * a[1], dy - 3);
            ctx.lineTo(a[0] + 7 * a[1], dy + 3);
            ctx.closePath();
            ctx.fill();
        });
        ctx.font = 'bold 9pt sans-serif';
        const dimTxt = wpDimText(contact);
        const tw = ctx.measureText(dimTxt).width;
        // Keep the caption clear of the fixed jaw on the left and the canvas edge.
        wpDimChip(dimTxt, clamp(x + w / 2, WP_FACE_X + tw / 2 + 8, S.CW - tw / 2 - 10), dy + 15, contact);
        ctx.restore();
    }

    // ── "Show me How?" guided reading ─────────────────────────────────
    // [VC-TEACH-BEGIN] — asserted by deploy/verify-vernier-teach.js
    //
    // A position-aware walkthrough of the reading CURRENTLY on the instrument.
    // It teaches nothing of its own: every number it shows is pulled from the same
    // funnels the readout tiles use (getAlignedIdx, getVernierLabelRule, fmtMsr,
    // fmtLc, fmtPart, fmtTr), so it cannot drift from what the tool reports, and it
    // works unchanged in SI, decimal inch and fractional inch.
    //
    // Everything renders INSIDE the existing canvas and lights the existing tiles.
    // There is no new panel: a caliper reading is a thing you do ON the instrument,
    // and a side panel would move the student's eye off it at the exact moment the
    // eye is the skill being trained.
    //
    // draw() stays pure — teachOn() is false when idle and every branch below is
    // skipped, so a static frame is byte-identical to what it was before this
    // existed. That is asserted rather than assumed.
    const TEACH_SPEED = 0.5; // classroom pace: 1x reads as rushed (skill §10)
    const TEACH_BAND_H = 62; // caption band height, output coords
    const TEACH_BAND_PAD = 12; // its inset from the canvas edge

    const teach = {
        on: false,
        playing: true,
        t: 0,
        total: 0,
        raf: null,
        last: 0,
        stages: [],
        stepT: [],
        lit: null,
        reduced: false,
        zoom: null,
        prevAlign: null
    };

    function teachAllowed() {
        if (state.mode === 'quiz') return false; // it would BE the answer
        if (state.mode === 'practice') return !!state.answered;
        return true;
    }

    // Per-step time for the VSR count. The first few steps must be felt; a count to
    // 23 at that pace is 10 s of tedium, so the step time decays to a floor. Total
    // comes out ~1.1 s for a count of 3 and ~3.3 s for a count of 23.
    function teachStepTimes(n) {
        const out = [];
        for (let k = 0; k < n; k++) out.push(Math.max(0.09, 0.45 * Math.pow(0.82, k)));
        return out;
    }

    function teachBuild() {
        const n = getAlignedIdx();
        teach.stepT = teachStepTimes(n);
        const countT = teach.stepT.reduce((a, b) => a + b, 0);
        teach.stages = [{
                key: 'msr',
                w: 3.2,
                tile: 'rcell-msr'
            },
            {
                key: 'coin',
                w: 3.0,
                tile: null
            },
            {
                key: 'vsr',
                w: Math.max(1.0, countT) + 0.5,
                tile: 'rcell-vsr'
            },
            {
                key: 'tr',
                w: 2.4,
                tile: 'rcell-lc'
            }
        ];
        // Only when there IS an error. Zero Error 'On' starts at zero until the user
        // bumps it, and a step that says "subtract 0.00" teaches nothing.
        if (state.zeOn && state.zeLc !== 0) teach.stages.push({
            key: 'ze',
            w: 2.6,
            tile: null
        });
        teach.total = teach.stages.reduce((a, s) => a + s.w, 0);
        teach.zoom = teachSolveView();
    }

    // The main-scale division the walkthrough claims as the MSR.
    //
    // max(0, …) exactly as fmtMsr does, and for its reason: with the jaws closed and
    // a NEGATIVE zero error the observed reading sits just below zero, and the main
    // scale physically still shows 0 there. An unclamped floor() returns −1, which
    // points the arrow at a graduation left of the beam's own zero — one that does
    // not exist — while the label beside it still reads "MSR = 0".
    //
    // It lives here, in one place, because the framing and the drawing both need it
    // and they must never disagree about where the arrow goes.
    function teachEase(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function teachMsrDivs() {
        return Math.max(0, Math.floor(getQuantMm() / getMsdMm() + 1e-9));
    }

    // How far along the vernier the stage-2 scan has reached.
    //
    // It deliberately runs ONE division past the coincidence, so the match ends up
    // with a rejection on both sides of it. That is what shows the match is unique
    // rather than merely the first one tried, and uniqueness is the whole claim a
    // vernier makes. Extracted so the gate can assert the far-side rejection is
    // reached — verifying it by watching the animation means racing a timer.
    // The last few divisions before the match get most of the scan's time. A linear
    // sweep covers forty-nine divisions and the one that matters at the same rate,
    // so the moment of finding it goes past before it registers — and slowing the
    // WHOLE scan just makes the early part tedious. The approach decelerates; the
    // search does not.
    const TEACH_SCAN_SLOW_DIVS = 5; // how many divisions get the slow approach
    const TEACH_SCAN_FAST_SHARE = 0.45; // share of the scan spent getting there

    function teachScanExtent(ph, alignedIdx, vsdCount) {
        const last = Math.min(alignedIdx + 1, vsdCount);
        if (last <= 0) return 0;
        const slowFrom = Math.max(0, last - TEACH_SCAN_SLOW_DIVS);
        // A short scan is all approach; there is nothing to hurry through.
        if (slowFrom === 0) return Math.min(Math.round(ph * last), last);
        if (ph <= TEACH_SCAN_FAST_SHARE) {
            return Math.min(Math.round((ph / TEACH_SCAN_FAST_SHARE) * slowFrom), slowFrom);
        }
        const p = (ph - TEACH_SCAN_FAST_SHARE) / (1 - TEACH_SCAN_FAST_SHARE);
        return Math.min(slowFrom + Math.round(p * (last - slowFrom)), last);
    }

    // How far the stage-1 measuring line has grown, 0..1. One expression, because
    // the drawn line and the MSR tile must count up together — a tile that reaches
    // 23 before the line does is telling the student the answer early, which is the
    // whole thing this walkthrough exists to avoid.
    function teachGrowFrac(at) {
        if (!at || at.key !== 'msr') return 1;
        return clamp(teachEase(clamp(at.phase / TEACH_GROW_TO, 0, 1)), 0, 1);
    }

    // What the readout tiles should show RIGHT NOW, or null when idle.
    //
    // Pressing "Show me How?" empties MSR and VSR and lets the walkthrough fill them
    // in as it derives them. Leaving the finished answer on the tiles while the
    // animation works towards it is the pedagogical equivalent of printing the
    // solution above the worked example.
    function teachLive() {
        if (!teachOn()) return null;
        const at = teachAt();
        const full = teachMsrDivs();
        if (at.key === 'msr') {
            // The last graduation the growing line has actually passed.
            const reached = getMsdPx() > 0 ?
                Math.floor((getShiftPx() * teachGrowFrac(at)) / getMsdPx() + 1e-9) : 0;
            return {
                msrDivs: clamp(reached, 0, full),
                vsr: 0,
                counting: true
            };
        }
        if (at.key === 'coin') return {
            msrDivs: full,
            vsr: 0,
            counting: true
        };
        return {
            msrDivs: full,
            vsr: teachCounted(),
            counting: at.key === 'vsr'
        };
    }

    // Where the walkthrough is now: which stage, and how far through it.
    function teachAt() {
        let t = teach.t,
            i = 0;
        // >= AND an epsilon, for the same reason twice over. Next sets teach.t to the
        // exact SUM of the preceding stage widths, so it lands on a boundary — a
        // strict compare leaves it in the previous stage at phase 1 and the
        // walkthrough looks frozen on that step however many times you press Next.
        //
        // A bare >= is not enough either, because that sum is not exact in binary.
        // With a division count of 4 the stage widths are 3.2, 3.0, 2.09… and 2.4;
        // 3.2 + 3.0 + 2.09… minus 3.2 minus 3.0 comes out a hair UNDER the third
        // width, and Next to step 4 landed on step 3 — for that count and no other.
        // Measured: 102 of the count/zero-error combinations this tool can produce
        // wedged on some step. The tolerance is far below one frame at 0.5x speed, so
        // it can never swallow a real step.
        const EPS = 1e-9;
        while (i < teach.stages.length - 1 && t >= teach.stages[i].w - EPS) {
            t -= teach.stages[i].w;
            i++;
        }
        const s = teach.stages[i];
        return {
            i: i,
            key: s.key,
            phase: clamp(t / s.w, 0, 1),
            stage: s
        };
    }

    function teachOn() {
        return teach.on && teach.stages.length > 0;
    }

    // How many divisions have been counted so far in the VSR stage.
    function teachCounted() {
        const at = teachAt();
        const n = getAlignedIdx();
        if (!teachOn() || at.key === 'msr' || at.key === 'coin') return 0;
        if (at.key !== 'vsr') return n;
        const countT = teach.stepT.reduce((a, b) => a + b, 0) || 1;
        let t = at.phase * teach.stages[at.i].w,
            k = 0;
        while (k < n && t >= teach.stepT[k]) {
            t -= teach.stepT[k];
            k++;
        }
        return k;
    }
    // [VC-TEACH-END]

    // [VC-TEACHVIEW-BEGIN]
    // The walkthrough's OWN view, and deliberately not the Zoom button's.
    //
    // Zoom centres on the coincidence at a fixed factor per precision, because that
    // is what a student hunting for the coinciding line needs. The walkthrough needs
    // something else: from stage 2 on it must hold BOTH ends of the reading on
    // screen at once — the main-scale graduation claimed as the MSR and the vernier
    // line that coincides — because the whole point is that the two are read
    // together. On a 50-division scale those can be 49 mm apart, so the factor has
    // to be solved from the reading rather than chosen in advance.
    //
    // It is a pure function of teach.t: no per-frame easing state. That matters for
    // step-through — a teacher pressing Next while paused gets the settled view for
    // that stage, not a transition frozen half way.
    // Stage 1 is four beats, not one: grow, point, move the camera, answer.
    // Grow, point, ANSWER, then move the camera — in that order, with a beat
    // between each. The answer used to land at 88 %, after the zoom had already
    // started, so the two competed; and the camera moving before the MSR was read
    // made the step feel like it had been cut short.
    const TEACH_GROW_TO = 0.46; // the measuring line lands
    const TEACH_MSR_VALUE_AT = 0.62; // "read it here" becomes "MSR = 23 mm"
    const TEACH_ZOOM_AT = 0.78; // camera starts, once the answer has been seen
    const TEACH_ZOOM_OVER = 0.18; // and eases rather than snapping

    // Where the pointer starts. The MSR label sits just under this point, in the
    // open space beside the jaws, so the arrow reads as coming OUT of the label and
    // landing on the graduation it names.
    const ARROW_TAIL_DX = -46;
    const ARROW_TAIL_DY = 40;

    // Where the stage-2 scan ends and the dwell on the match begins.
    const TEACH_SCAN_TO = 0.58;

    const TEACH_ZOOM_MAX = 3.2; // past this the beam numerals start to crop
    const TEACH_ZOOM_PAD = 42; // breathing room each side of the span

    function teachSolveView() {
        const ox = S.scaleOriginX + S.offsetOriginX;
        const msdPx = getMsdPx();
        const msrDivs = teachMsrDivs();
        const msrX = ox + msrDivs * msdPx;
        const coincX = ox + getShiftPx() + getAlignedIdx() * getVsdPx();

        const x0 = Math.min(msrX, coincX) - TEACH_ZOOM_PAD;
        const x1 = Math.max(msrX, coincX) + TEACH_ZOOM_PAD;
        // Vertically: the beam numerals down to the MSR label, which is the lowest
        // thing the guided layer draws. Crop either and the framing defeats itself.
        const y0 = S.PAD_TOP + S.scaleOriginY - S.majorTickH - 20;
        const y1 = S.PAD_TOP + S.scaleOriginY + 74 + 14; // down to the measuring line

        // The caption band is permanent furniture while the walkthrough runs, so the
        // usable height is what is ABOVE it. Framing into the whole canvas put the
        // MSR label underneath the band — the zoom would have hidden one of the two
        // things it exists to show.
        const DEST_TOP = 8;
        const DEST_BOT = S.CH_OUT - TEACH_BAND_H - TEACH_BAND_PAD - 8;
        const k = Math.min(S.CW / (x1 - x0), (DEST_BOT - DEST_TOP) / (y1 - y0), TEACH_ZOOM_MAX);
        const srcW = S.CW / k;
        return {
            k: k,
            srcX: clamp((x0 + x1) / 2 - srcW / 2, 0, S.CW - srcW),
            // Anchor the TOP of the region at DEST_TOP rather than centring in the
            // canvas: centring is what let the bottom of it slide under the band.
            srcY: y0 - DEST_TOP / k
        };
    }

    // 0 before the zoom, 1 after. The move happens in the LAST quarter of stage 1 —
    // after the MSR line has landed (it completes at 78 %) and before stage 2 needs
    // it — so stepping to stage 2 lands on the settled, zoomed view.
    function teachZoomBlend() {
        if (!teachOn() || !teach.zoom) return 0;
        const w1 = teach.stages[0].w;
        if (teach.t >= w1) return 1;
        // Starts after the landing, not with it: the landing needs a beat to register
        // before the camera moves, or the two read as one event and neither is seen.
        return clamp((teach.t - w1 * TEACH_ZOOM_AT) / (w1 * TEACH_ZOOM_OVER), 0, 1);
    }

    function teachScaleNow() {
        const b = teachZoomBlend();
        return b <= 0 ? 1 : 1 + (teach.zoom.k - 1) * b;
    }

    function drawCaliperTeachZoom() {
        const b = teachZoomBlend();
        const k = teachScaleNow();
        ctx.save();
        ctx.scale(k, k);
        ctx.translate(-teach.zoom.srcX * b, -teach.zoom.srcY * b);
        drawCaliper();
        ctx.restore();
    }
    // [VC-TEACHVIEW-END]

    // [VC-TEACHDRAW-BEGIN] — the guided layer, drawn INSIDE the instrument's own
    // coordinate space so the Zoom button magnifies it along with the scales.
    // Called as the last layer of drawCaliper(); returns immediately when idle.
    function drawTeachLayer(shift, msdPx, vsdPx, vsdCount, alignedIdx, vRule) {
        if (!teachOn()) return;
        const at = teachAt();
        const ph = teach.reduced ? 1 : teachEase(at.phase);

        // Vertical bands, in the instrument's own coordinates. They are declared in
        // one place because they MUST NOT overlap: a chip is an opaque box ~18 px
        // tall, and the stage-2 chip at y = 40 was painting over the stage-1 line at
        // y = 46. As the scan advanced, the chip slid right and re-revealed the line
        // behind it — so the MSR line appeared to creep toward the vernier zero
        // instead of already being there. The line was never short.
        const BAND_TICK = 26; // tick overlays live at y = 2 … 26
        const BAND_CNT = 36; // UPPER box — how many divisions
        const BAND_VAL = 54; // LOWER box — what they are worth
        const BAND_LINE = 74; // the MSR measuring line
        const BAND_MSR = 92; // its label

        const ox = S.scaleOriginX + S.offsetOriginX; // beam zero, local x = 0
        const msrDivs = teachMsrDivs();
        const msrX = msrDivs * msdPx;
        const zeroX = shift; // the vernier's own zero line

        ctx.save();
        ctx.translate(ox, S.scaleOriginY);

        // ── Stage 1 — the main scale reading ────────────────────────────
        // A measuring line grows along the beam from 0 to the vernier zero, then the
        // LAST graduation it passed is claimed as the MSR. Drawn below the beam in
        // the clear band, dimension-line style, so it never fights the graduations.
        if (at.key === 'msr' || at.i > 0) {
            // The line must LAND on the vernier zero and be seen to land. Two things
            // were stopping that, and both were invisible except as "it doesn't quite
            // reach zero":
            //
            //   * the growth was spread over the whole stage, so the last frame drawn
            //     before the stage advanced was still a few percent short — the line
            //     never occupied the zero line on any frame the eye got to rest on;
            //   * easing with pow() means the final approach is the slowest part, so
            //     those missing few percent were also the most visible ones.
            //
            // It now completes at 78% of the stage and DWELLS at full length for the
            // rest, so there is always a run of frames showing it exactly on zero.
            const done = at.key !== 'msr';
            const grow = done ? zeroX : zeroX * teachGrowFrac(at);
            const y = BAND_LINE;
            ctx.strokeStyle = '#4fc3f7';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(grow, y);
            ctx.stroke();
            // witness lines at each end, as on a drawing
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y + 6);
            ctx.lineTo(0, 0);
            ctx.stroke();
            // Only once the measuring line has actually arrived. Drawing it at the pen's
            // travelling edge made the INDEX look like it was moving, when the index is
            // the one thing on a caliper that never moves relative to the vernier.
            const landed = done || grow >= zeroX - 0.01;
            if (landed) {
                // THE INDEX LINE — a thin red line standing on the vernier zero and
                // carried up THROUGH the main scale. This is how the reading is actually
                // taken: you look at where the vernier zero falls and read the last main
                // graduation it has passed. Marking the claimed graduation alone left the
                // student no way to see WHY it was claimed, and put a blue marker on the
                // beam that looked like it was failing to line up with the vernier zero.
                // Red, because it is a pointer, not a measurement — the measuring line
                // and its label stay in the MSR tile's blue.
                ctx.save();
                ctx.strokeStyle = 'rgba(255,85,85,0.95)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(zeroX, BAND_LINE + 6);
                ctx.lineTo(zeroX, -S.majorTickH - 13);
                ctx.stroke();
                ctx.restore();
            }
            if (!done) { // the pen at the leading edge
                ctx.fillStyle = '#4fc3f7';
                ctx.shadowColor = 'rgba(79,195,247,0.9)';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(grow, y, 3.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
            // The claimed graduation: an arrowhead standing directly under the main-scale
            // line the index line has just passed, so "which one is the MSR" is answered
            // by a shape pointing at it rather than by a bar the eye has to align.
            if (done || grow >= msrX) {
                // A sketched arrow, not a CAD one: this is someone pointing at the scale
                // and saying "here", which is a different act from the instrument's own
                // precise marks. Keeping the two visually distinct is what stops a
                // pointer being read as a measurement.
                teachSketchArrow(msrX, 1);
                ctx.save();
                ctx.restore();
                // The label hangs off the TAIL of the index line, not off the arrow. The
                // arrow is a gesture at a graduation; the index line is the thing whose
                // position decides the answer, so the answer belongs at the end of it.
                // That also removes the dashed leader — nothing left to connect.
                //
                // Ask before answering: the instruction comes first and the value only
                // once the student has had a moment to look where it points. A label that
                // appears with its own answer gets read instead of the scale.
                const told = done || at.phase >= TEACH_MSR_VALUE_AT;
                teachChip(msrX + ARROW_TAIL_DX - 16, ARROW_TAIL_DY + 16,
                    told ? ('MSR = ' + fmtMsr() + ' ' + uLabel()) : 'read the main scale here',
                    told ? '#4fc3f7' : '#8b9dc3');
            }
        }

        // ── Stage 2 — why ONE line coincides ────────────────────────────
        // The scan walks the vernier and reports, for each division, how far it MISSES
        // the nearest main line. Those misses step down by exactly one least count and
        // reach zero once — that IS the vernier principle, and the tool never said it.
        //
        // The miss is stated as a NUMBER, not drawn as a gap. At 5.2 px/mm one least
        // count is 0.104 px: drawn to scale it is invisible even at 4.5x zoom (which
        // is precisely why reading a vernier is a skill), and drawing it larger than
        // it is would put a lie on the one instrument we just made honest.
        if (at.key === 'coin') {
            // The scan runs one division PAST the coincidence, so the match is seen with
            // a rejection on BOTH sides of it. That is what makes it unique rather than
            // merely first — and uniqueness is the entire claim of a vernier.
            // The scan finishes at 58 % and the rest of the stage DWELLS on the match.
            // Finding the line is the hard part of reading a vernier, and an animation
            // that moves straight on the instant it lands gives the student nothing to
            // recognise — they see that something was found, not WHAT.
            const scanPh = clamp(ph / TEACH_SCAN_TO, 0, 1);
            const settled = ph >= TEACH_SCAN_TO;
            const upto = teachScanExtent(scanPh, alignedIdx, vsdCount);
            // Marks scale with the division pitch, so the dense 0.02 mm scale gets small
            // crosses instead of a smear and the coarse 0.1 mm scale gets legible ones.
            const mk = clamp(vsdPx * 0.34, 2.2, 5.5);

            // TWO PASSES. Drawing in division order painted the far-side rejection AFTER
            // the match, and the tick is deliberately oversized, so on the 0.02 mm scale
            // — 5 px between divisions — the next X landed on top of the very tick the
            // step exists to celebrate. It read as "found it… no it isn't".
            for (let j = 0; j <= upto; j++) {
                const vx = zeroX + j * vsdPx;
                const hit = (j === alignedIdx);
                ctx.strokeStyle = hit ? '#FFD700' : 'rgba(255,255,255,0.40)';
                ctx.lineWidth = hit ? 2.4 : 1;
                ctx.beginPath();
                ctx.moveTo(vx, 12);
                ctx.lineTo(vx, 26);
                ctx.stroke();
                if (!hit) teachSketchX(vx, BAND_CNT, mk, j === upto ? 0.95 : 0.42);
            }
            if (upto >= alignedIdx) {
                // Cleared to the background first, so neighbouring rejections cannot
                // crowd it however tight the division pitch gets.
                const cx = zeroX + alignedIdx * vsdPx;
                ctx.save();
                ctx.fillStyle = 'rgba(10,22,29,0.92)';
                ctx.beginPath();
                ctx.arc(cx, BAND_CNT, mk * 2.1, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                teachSketchTick(cx, BAND_CNT, mk * 1.9);
            }
            if (upto >= alignedIdx) teachPulse(zeroX + alignedIdx * vsdPx);

            // THE COLLINEAR PAIR. Two lines meeting is not something the eye picks out
            // of forty near-misses on its own, so during the dwell they are drawn as one
            // continuous stroke running from the top of the main-scale graduation to the
            // bottom of the vernier one. There is nothing to align by eye any more: it
            // is visibly a single line crossing both scales, which is exactly what
            // coincidence MEANS and what the whole instrument turns on.
            if (settled) {
                const cx = zeroX + alignedIdx * vsdPx;
                ctx.save();
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 2.2;
                ctx.shadowColor = 'rgba(255,215,0,0.75)';
                ctx.shadowBlur = 7;
                ctx.beginPath();
                ctx.moveTo(cx, -S.majorTickH);
                ctx.lineTo(cx, 26);
                ctx.stroke();
                ctx.restore();
                // A head pointing at the junction itself, in from the right so it never
                // crosses the trail of rejections coming from the left.
                teachSketchHead(cx, 2);
            }

            // How far the division under test misses by. Division j sits one least count
            // further from the main grid than j+1 does, so the raw gap is exactly
            // (alignedIdx − j) x LC — FOLDED into +-half a main division, because past
            // half a division the nearest main line is the one AHEAD and reporting the
            // raw figure would be measuring to a line the eye would never pick.
            //
            // No count here. Counting is step 3's whole job, and a running index in this
            // step invites the student to start counting before they have found the line
            // to count TO.
            const vx = zeroX + upto * vsdPx;
            const msd = getMsdMm() * (isImperial() ? MM_TO_IN : 1);
            let miss = (alignedIdx - upto) * getLcDisplay();
            miss -= Math.round(miss / msd) * msd;
            // During the dwell the message belongs to the MATCH, not to whichever
            // division the scan stopped on. Leaving it on the far-side rejection put
            // "no — off by 0.10 mm" beside the very line the stage had just found.
            if (settled) {
                teachChip(zeroX + alignedIdx * vsdPx, BAND_VAL, 'this one lines up', '#FFD700');
            } else {
                teachChip(vx, BAND_VAL,
                    upto === alignedIdx ? 'this one lines up' :
                    'no — off by ' + fmtDispValue(Math.abs(miss)) + ' ' + uLabel(),
                    upto === alignedIdx ? '#FFD700' : '#ff8f8f');
            }
        }

        // ── Stage 3 — count the divisions ───────────────────────────────
        if (at.key === 'vsr' || at.i > 2) {
            const k = teachCounted();
            const kx = zeroX + k * vsdPx;
            // every counted division stays lit, so the count is visible as a run
            ctx.strokeStyle = 'rgba(129,199,132,0.85)';
            ctx.lineWidth = 1.4;
            for (let j = 1; j <= k; j++) {
                const vx = zeroX + j * vsdPx;
                ctx.beginPath();
                ctx.moveTo(vx, 12);
                ctx.lineTo(vx, 22);
                ctx.stroke();
            }
            // the marker that walks
            ctx.fillStyle = '#FFD700';
            ctx.shadowColor = 'rgba(255,215,0,0.9)';
            ctx.shadowBlur = 9;
            ctx.beginPath();
            ctx.moveTo(kx, 10);
            ctx.lineTo(kx - 4.5, 2);
            ctx.lineTo(kx + 4.5, 2);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
            // The count above, and what it is WORTH below, accumulating one least count
            // at a time: 0.02, 0.04, 0.06 … This is the whole of VSR x LC, shown as the
            // repeated addition it actually is, and it lands on the same number the TR
            // row is about to print.
            teachChip(kx, BAND_CNT, k + (k === 1 ? ' division' : ' divisions'), '#FFD700');
            teachChip(kx, BAND_VAL, fmtDispValue(k * getLcDisplay()) + ' ' + uLabel(), '#81c784');
        }

        // ── Stage 4/5 — the arithmetic lives in the tiles, not on the metal ──
        if (at.key === 'tr' || at.key === 'ze') teachPulse(zeroX + alignedIdx * vsdPx);

        ctx.restore();
    }

    // Ticks SHOULD magnify with the scales — that is the point of drawing the guided
    // layer inside the instrument's space. Labels should NOT: at 4.5x a 9pt chip
    // becomes 40pt and swallows the caption band. Everything textual therefore draws
    // at an inverse scale about its own anchor, so it stays pinned to the feature it
    // names while keeping one size on screen at every zoom factor.
    function teachLabelScale() {
        const k = teachZoomBlend() > 0 ? teachScaleNow() :
            (state.zoomOpen ? getZoomFactor() : 1);
        return 1 / k;
    }

    // A pointer drawn the way a hand draws one — a curved shaft into the tick with
    // a two-stroke head, inked twice with a small offset so the strokes do not sit
    // perfectly on each other. Deliberately imprecise: the instrument's own marks
    // are the precise things on this canvas, and a pointer that looks equally
    // precise competes with them.
    //
    // The wobble is derived from the anchor, never from Math.random: a per-frame
    // random would make the arrow crawl, and this function runs every frame.
    function teachSketchArrow(x, yTip) {
        // Drawn in the INSTRUMENT's coordinates, unlike the chips. A pointer is tied
        // to a place on the metal, so it should grow with the metal; the chips carry
        // text, which must not. At 1/k it stayed pen-sized while the scales grew
        // around it and read as timid.
        const j = (n) => { // deterministic +-1 wobble
            const v = Math.sin((x + n * 37.7) * 12.9898) * 43758.5453;
            return (v - Math.floor(v)) * 2 - 1;
        };
        ctx.save();
        ctx.translate(x, yTip);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
            const dx = pass * 0.8,
                dy = pass * 0.6;
            ctx.strokeStyle = pass ? 'rgba(255,193,7,0.40)' : 'rgba(255,208,70,1)';
            ctx.lineWidth = pass ? 1.6 : 2.4;
            // Shaft from the label's corner up into the tick. Everything stays LEFT of
            // the tip and rises steeply into it, so the stroke never crosses the
            // vernier's own zero numeral just to the right of the graduation.
            ctx.beginPath();
            ctx.moveTo(ARROW_TAIL_DX + dx + j(pass), ARROW_TAIL_DY + dy + j(pass + 1));
            ctx.quadraticCurveTo(ARROW_TAIL_DX + 12 + dx, ARROW_TAIL_DY * 0.42 + dy, -2 + dx + j(pass + 2), 5 + dy);
            ctx.stroke();
            // head: two separate strokes, as a hand would draw it
            ctx.beginPath();
            ctx.moveTo(dx, 2 + dy);
            ctx.lineTo(-10 + dx + j(pass + 3), 6 + dy);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(dx, 2 + dy);
            ctx.lineTo(-4 + dx, 15 + dy + j(pass + 4));
            ctx.stroke();
        }
        ctx.restore();
    }

    // Rejections and the match, drawn in the same hand as the pointer: this is
    // someone working down the scale ruling lines out, not the instrument's own
    // engraving. Jitter comes from the anchor so the marks never crawl.
    function teachInk(x, n) {
        const v = Math.sin((x + n * 61.3) * 12.9898) * 43758.5453;
        return (v - Math.floor(v)) * 2 - 1;
    }
    // An arrowhead that lands EXACTLY on (x, y), approached from the lower right so
    // it never crosses the rejections coming from the left. Drawn as a hand draws
    // one — a short flick of a shaft and two separate head strokes — but its tip is
    // placed precisely, because the whole point is which line it is naming.
    function teachSketchHead(x, y) {
        const j = (n) => {
            const v = Math.sin((x + n * 23.1) * 12.9898) * 43758.5453;
            return (v - Math.floor(v)) * 2 - 1;
        };
        ctx.save();
        ctx.translate(x, y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
            const dx = pass * 0.7,
                dy = pass * 0.5;
            ctx.strokeStyle = pass ? 'rgba(255,193,7,0.40)' : 'rgba(255,208,70,1)';
            ctx.lineWidth = pass ? 1.5 : 2.3;
            ctx.beginPath();
            ctx.moveTo(26 + dx + j(pass), 30 + dy + j(pass + 1));
            ctx.quadraticCurveTo(17 + dx, 16 + dy, 3 + dx, 4 + dy);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(1 + dx, 1 + dy);
            ctx.lineTo(13 + dx + j(pass + 2), 5 + dy);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(1 + dx, 1 + dy);
            ctx.lineTo(5 + dx, 14 + dy + j(pass + 3));
            ctx.stroke();
        }
        ctx.restore();
    }

    function teachSketchX(x, y, r, alpha) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,120,120,' + alpha + ')';
        ctx.lineWidth = Math.max(1, r * 0.34);
        ctx.lineCap = 'round';
        const w = teachInk(x, 1) * 0.6,
            v = teachInk(x, 2) * 0.6;
        ctx.beginPath();
        ctx.moveTo(x - r + w, y - r);
        ctx.lineTo(x + r, y + r + v);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + r, y - r + v);
        ctx.lineTo(x - r + w, y + r);
        ctx.stroke();
        ctx.restore();
    }

    function teachSketchTick(x, y, r) {
        ctx.save();
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = Math.max(1.6, r * 0.30);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(255,215,0,0.85)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(x - r, y);
        ctx.lineTo(x - r * 0.25 + teachInk(x, 3) * 0.4, y + r * 0.75);
        ctx.lineTo(x + r, y - r * 0.85 + teachInk(x, 4) * 0.4);
        ctx.stroke();
        ctx.restore();
    }

    // A small rounded label, centred on x.
    function teachChip(x, y, txt, colour) {
        const k = teachLabelScale();
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(k, k);
        ctx.font = 'bold 9pt sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(txt).width + 14;
        // Only clamp at 1x: when zoomed, the canvas edge is not where S.CW says it is.
        const cx = (state.zoomOpen || teachZoomBlend() > 0) ? 0 :
            clamp(x, w / 2 + 2 - S.scaleOriginX, S.CW - S.scaleOriginX - w / 2 - 2) - x;
        ctx.fillStyle = 'rgba(8,12,18,0.9)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx - w / 2, -9, w, 18, 5);
        else ctx.rect(cx - w / 2, -9, w, 18);
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = colour;
        ctx.fillText(txt, cx, 0);
        ctx.restore();
    }

    function teachPulse(x) {
        const k = teachLabelScale();
        const r = 5 + 3 * Math.sin(teach.t * 6);
        ctx.save();
        ctx.translate(x, 18);
        ctx.scale(k, k);
        ctx.strokeStyle = 'rgba(255,215,0,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    // [VC-TEACHDRAW-END]

    // ── Draw caliper ──────────────────────────────────────────────────
    function drawCaliper() {
        const shift = getShiftPx();
        const msdPx = getMsdPx();
        const vsdPx = getVsdPx();
        const vsdCount = getVsdCount();
        const alignedIdx = getAlignedIdx();
        const stripPx = getVernierStripPx();
        const mainDivsDraw = getMainDivsToDraw();
        const imperial = isImperial();
        // Depth parts redraw the beam BROKEN so the rod has somewhere to go. Nothing
        // else in this function changes; with any other part (or none) every pixel is
        // identical to what it was before depth mode existed.
        const depthMode = wpIsDepth();

        // 1. The surface the instrument lies on — a black granite surface plate, the
        //    bench every caliper in a metrology room is laid on. Built once per
        //    backing-store size and blitted at IDENTITY, so neither Zoom nor the
        //    walkthrough's camera magnifies the grain into blobs.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(getPlate(), 0, 0);
        ctx.restore();

        if (imagesLoaded < 5) return; // sprites carry the original profile; wait for them

        // Everything from here down is authored in SPRITE coordinates; the headroom
        // strip is applied once, here, so no existing geometry had to move.
        ctx.save();
        ctx.translate(0, S.PAD_TOP);

        // 1c. Workpiece in the jaw throat — drawn BEFORE the beam and the sliding head
        //     so both jaws overlap its edges and it reads as gripped, not floating.
        drawWorkpiece();

        // 1d. Depth part, in section. Painted BEFORE the blade so the rod lands
        //     inside the cavity, and before the base so the beam covers its shank.
        if (depthMode) drawDepthPart();
        drawRingBack();

        // 2. Blade (behind base) — original depth-rod sprite, re-shaded. Its tip sits
        //    exactly `shift` past the beam end, which is what makes the protrusion the
        //    reading itself rather than a decoration.
        const bladeX = depthMode ?
            DEPTH_FACE_X + depthRodDrawnPx() - S.bladeWidthPx :
            S.rulerWidthPx + shift - S.bladeWidthPx;
        const bladeY = (S.scaleOriginY0 + S.scaleOriginY) / 2 - S.bladeHeightPx / 2;
        ctx.drawImage(shaded.blade || imgBlade, bladeX, bladeY);

        // 3. Fixed base (beam + fixed jaws) — original sprite, re-shaded, with relief shadow.
        ctx.save();
        // blur 9 / offset 5 spilled 4 px of shadow back OVER the beam's own top edge,
        // widening its silhouette ramp to 7 device px. Pushing the offset past half
        // the blur keeps the cast shadow soft while leaving the top arris clean.
        ctx.shadowColor = 'rgba(0,0,0,0.46)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 8;
        const baseImg = shaded.base || imgBase;
        if (depthMode) {
            // Two pieces of ONE sprite: everything up to the seam, then the tail end
            // slid left by the removed run-out. Source spans, so the graduated region
            // and the tail profile both stay at true scale.
            const tailW = S.rulerWidthPx - (DEPTH_BREAK_X + DEPTH_GAP);
            ctx.drawImage(baseImg, 0, 0, DEPTH_BREAK_X, S.CH, 0, 0, DEPTH_BREAK_X, S.CH);
            ctx.drawImage(baseImg, DEPTH_BREAK_X + DEPTH_GAP, 0, tailW, S.CH,
                DEPTH_BREAK_X, 0, tailW, S.CH);
        } else {
            ctx.drawImage(baseImg, 0, 0);
        }
        ctx.restore();
        if (depthMode) drawBeamBreak();

        // 4. Main scale ticks — SI or Imperial
        ctx.save();
        ctx.translate(S.scaleOriginX + S.offsetOriginX, S.scaleOriginY);
        ctx.strokeStyle = 'black';
        ctx.fillStyle = 'black';

        if (imperial && IM().fractional) {
            // Fractional beam: 16 graduations per inch. The tick height steps down
            // 1" > 1/2" > 1/4" > 1/8" > 1/16" exactly as a rule is graduated, so the
            // eye can count sixteenths without reading a single number. Whole inches
            // are numbered; the quarter points carry a small ¼ ½ ¾ glyph.
            const QUARTER = ['', '\u00BC', '\u00BD', '\u00BE'];
            const maxLocalX = (depthMode ? DEPTH_BREAK_X : S.CW) - (S.scaleOriginX + S.offsetOriginX);
            const capDivs = getMainDivs(); // number only within the 4" measuring range
            for (let i = 0; i <= mainDivsDraw; i++) {
                const x = i * msdPx;
                if (x > maxLocalX) break;
                const isInchMark = (i % 16 === 0);
                const h = isInchMark ? S.majorTickH :
                    (i % 8 === 0) ? S.majorTickH - 3 :
                    (i % 4 === 0) ? S.majorTickH - 6 :
                    (i % 2 === 0) ? S.majorTickH - 9 :
                    S.majorTickH - 12;
                ctx.lineWidth = isInchMark ? 1.8 : (i % 4 === 0 ? 1.2 : 0.7);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, -h);
                ctx.stroke();

                if (i <= capDivs) {
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    if (isInchMark) {
                        ctx.font = 'bold 11pt sans-serif';
                        ctx.fillText(String(i / 16), x, -S.majorTickH - 2); // whole inch
                    } else if (i % 4 === 0) {
                        ctx.font = '7pt sans-serif';
                        ctx.fillText(QUARTER[(i % 16) / 4], x, -S.majorTickH - 2);
                    }
                }
            }
        } else if (imperial) {
            // Imperial main scale: 40 graduations per inch (0.025"). Whole inches get a
            // tall, bold number; the 0.1" lines (every 4th div) get a small 1–9 sub-number
            // within each inch, and the 0.025" lines are short minor ticks — exactly how a
            // real inch caliper beam is engraved.
            const maxLocalX = (depthMode ? DEPTH_BREAK_X : S.CW) - (S.scaleOriginX + S.offsetOriginX);
            const capDivs = getMainDivs(); // number only within the 4" measuring range
            for (let i = 0; i <= mainDivsDraw; i++) {
                const x = i * msdPx;
                if (x > maxLocalX) break;
                const isInchMark = (i % 40 === 0);
                const isTenth = (i % 4 === 0);
                const h = isInchMark ? S.majorTickH : (isTenth ? S.majorTickH - 5 : S.minorTickH);
                ctx.lineWidth = isInchMark ? 1.8 : (isTenth ? 1.2 : 0.7);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, -h);
                ctx.stroke();

                if (i <= capDivs) {
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    if (isInchMark) {
                        ctx.font = 'bold 11pt sans-serif';
                        ctx.fillText(String(i / 40), x, -S.majorTickH - 2); // whole inch
                    } else if (isTenth) {
                        ctx.font = '6.5pt sans-serif';
                        ctx.fillText(String((i % 40) / 4), x, -S.majorTickH - 2); // tenth 1–9
                    }
                }
            }
        } else {
            // [VC-BEAMLABEL-BEGIN] — asserted by deploy/verify-vernier-labels.js
            // SI: 50 divs (1 mm each), major every 5. The numerals sit on every 10th
            // line either way; state.beamUnit only decides whether that line is called
            // 10 (mm) or 1 (cm). Stepping in TENS, not fives, is what keeps the cm
            // numbering whole — a 15-division gap would engrave "1.5" on a caliper.
            let labelGap = 0;
            while (msdPx * labelGap < 50) labelGap += 10;
            const beamCm = (state.beamUnit === 'cm');
            // [VC-BEAMLABEL-END]

            const maxLocalX = (depthMode ? DEPTH_BREAK_X : S.CW) - (S.scaleOriginX + S.offsetOriginX);
            const capDivs = getMainDivs(); // number only within the measuring range
            for (let i = 0; i <= mainDivsDraw; i++) {
                const x = i * msdPx;
                if (x > maxLocalX) break;
                const h = (i % 5 === 0) ? S.majorTickH : S.minorTickH;
                ctx.lineWidth = (i % 5 === 0) ? 1.4 : 0.8;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, -h);
                ctx.stroke();
                // Number only up to the 100 mm capacity; ticks continue as a plain
                // graduated run-out so the vernier always has a line to coincide with.
                if (i % labelGap === 0 && i <= capDivs) {
                    ctx.font = '9pt sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(beamCm ? i / 10 : i, x, -S.majorTickH - 2);
                }
            }
        }
        ctx.restore();

        // 4b. Engraved branding watermark on the beam's run-out (past the capacity).
        //     Drawn BEFORE the sliding head so the head covers it like a real engraving.
        if (!depthMode) {
            const capEndX = S.scaleOriginX + S.offsetOriginX + getMaxMm() * getPxPerMm();
            const wmX = (capEndX + S.CW) / 2; // centred in the run-out, clear of numbers
            const wmY = 122;
            ctx.save();
            ctx.font = 'italic 700 13px Georgia, "Times New Roman", serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; // light bevel highlight (etched edge)
            ctx.fillText('JK Design', wmX, wmY + 1);
            ctx.fillStyle = 'rgba(70,82,96,0.50)'; // recessed dark engrave on top
            ctx.fillText('JK Design', wmX, wmY);
            ctx.restore();
        }

        // 5. Sliding head — original sprite (left cap + stretched middle + right cap),
        //    re-shaded, with a drop shadow so it reads as a separate part over the beam.
        const vernierImgX = S.scaleOriginX - S.offsetOriginX + shift - S.vernierOriginX;
        const vernierImgY = S.scaleOriginY - S.vernierOriginY;
        ctx.save();
        // One shadowed draw of one flattened body — never three (graphics-upgrade B16).
        // offsetY > blur/2 so the shadow does not spill back over the head's own top
        // edge and soften the arris the lips just cut.
        ctx.shadowColor = 'rgba(0,0,0,0.42)';
        ctx.shadowBlur = 9;
        ctx.shadowOffsetY = 6;
        ctx.drawImage(getHeadComposite(stripPx), vernierImgX, vernierImgY);
        ctx.restore();

        // 5b. Fine-adjustment thumb roller on the skirt, at the head's right cap.
        drawThumbwheel();

        // 5c. Locking screw state, painted over the nut it belongs to.
        drawLockNut();

        // 6. Vernier ticks — FULL SCALE at true physical positions.
        // Division j sits at (vernier zero) + j × VSD, exactly as on a real caliper,
        // so the aligned division genuinely coincides with a main-scale line.
        const vTickStartX = S.scaleOriginX + S.offsetOriginX + shift;
        const vTickBaseY = S.vernierOriginY - 1;

        // ONE funnel: the canvas and the VSR tile must never disagree about what
        // numeral a division carries, so both read getVernierLabelRule().
        const vRule = getVernierLabelRule(imperial, vsdCount, vsdPx, getLcMm());
        const vLabelGap = vRule.gap;
        const vLabelVal = vRule.val;

        for (let j = 0; j <= vsdCount; j++) {
            const x = vTickStartX + j * vsdPx;
            if (x > S.CW) break;
            const isLabeled = (j % vLabelGap === 0);
            const isAligned = state.showAlign && (j === alignedIdx);
            const h = isLabeled ? S.vMajorTickH : S.vMinorTickH;

            if (isAligned) {
                ctx.save();
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 2.5;
                ctx.shadowColor = 'rgba(255,215,0,0.85)';
                ctx.shadowBlur = 8;
            } else {
                ctx.strokeStyle = 'black';
                ctx.lineWidth = isLabeled ? 1.2 : 0.7;
                ctx.shadowBlur = 0;
            }
            ctx.beginPath();
            ctx.moveTo(x, vTickBaseY);
            ctx.lineTo(x, vTickBaseY + h);
            ctx.stroke();
            if (isAligned) ctx.restore();

            if (isLabeled) {
                ctx.fillStyle = isAligned ? '#FFD700' : 'black';
                ctx.font = '8pt sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.shadowBlur = 0;
                ctx.fillText(vLabelVal(j), x, vTickBaseY + S.vMajorTickH + 2);
            }
        }

        // 7. LC badge
        {
            const lcTxt = `LC = ${withUnit(fmtLc())}`;
            const lcAnnotX = Math.min(
                vernierImgX + stripPx - 50, // tucked just inside the head's right cap
                S.CW - 68
            );
            const lcAnnotY = 97;

            ctx.save();
            ctx.font = 'bold 8.5pt sans-serif';
            const tw = ctx.measureText(lcTxt).width;
            const bx = lcAnnotX - tw / 2 - 6;
            const by = lcAnnotY - 11;
            const bw = tw + 12;
            const bh = 18;
            ctx.fillStyle = 'rgba(0,0,0,0.58)';
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(bx, by, bw, bh, 4);
            } else {
                ctx.rect(bx, by, bw, bh);
            }
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,183,77,0.55)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.fillStyle = '#ffb74d';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(lcTxt, lcAnnotX, lcAnnotY - 2);
            ctx.restore();
        }

        // 8. Remask base jaw area so the vernier ticks never bleed over the fixed jaw.
        ctx.drawImage(shaded.base || imgBase, 0, 0, 64, 102, 0, 0, 64, 102);

        // 9. A bore sits in FRONT of the instrument (the caliper reaches into it), then
        //    the dimension annotation on top of everything.
        drawRing();
        drawWorkpieceDims();

        // Guided reading, last so it sits over everything — and INSIDE the headroom
        // translate, so drawCaliperZoomed's transform magnifies it with the scales.
        drawTeachLayer(shift, msdPx, vsdPx, vsdCount, alignedIdx, vRule);

        ctx.restore(); // undo the headroom translate
    }

    // Stronger zoom for the dense fine scales so coincident lines are separable.
    function getZoomFactor() {
        if (isImperial()) return IM().fractional ? 2.6 : 3.5; // 25-div imperial is dense too
        if (state.prec === '0.02') return 4.5; // 50-div fine scale needs the most
        if (state.prec === '0.05') return 3.8;
        return 3.0; // 0.1 mm coarse scale
    }

    // ── Zoomed render ─────────────────────────────────────────────────
    function drawCaliperZoomed() {
        const ZF = getZoomFactor();
        const srcW = S.CW / ZF;
        const srcH = S.CH_OUT / ZF;
        // Auto-centre on the COINCIDENCE point — the aligned vernier division where the
        // vernier line meets a main-scale line. This is what the user must see, and it
        // can sit far from the vernier zero on the dense 0.02 mm scale (up to ~49 mm).
        const coincX = S.scaleOriginX + S.offsetOriginX + getShiftPx() + getAlignedIdx() * getVsdPx();
        // drawCaliper shifts the instrument down by the headroom strip, so the centring
        // target must be in OUTPUT coordinates too.
        const coincY = S.vernierOriginY + S.PAD_TOP; // the main↔vernier reading boundary
        const srcX = Math.max(0, Math.min(S.CW - srcW, coincX - srcW * 0.5));
        const srcY = Math.max(0, Math.min(S.CH_OUT - srcH, coincY - srcH * 0.46));

        ctx.save();
        ctx.scale(ZF, ZF);
        ctx.translate(-srcX, -srcY);
        drawCaliper();
        ctx.restore();
    }

    // [VC-TEACHBANNER-BEGIN]
    // The caption band. Drawn at IDENTITY, after the caliper, so the Zoom transform
    // does not magnify it — and pinned to the canvas's bottom edge rather than
    // floating over the middle, because a centred card would cover the instrument
    // the caption is describing (skill §10, rankine-cycle).
    function teachCaption() {
        const at = teachAt(),
            n = getAlignedIdx(),
            u = uLabel();
        switch (at.key) {
            case 'msr':
                return ['Step 1 — Main Scale Reading',
                    'The RED line is the vernier zero. The ARROW is the last main-scale line it has passed — that is the MSR. They are deliberately not level: the gap between them is the fraction the vernier is about to measure.'
                ];
            case 'coin':
                {
                    const lc = fmtLc();
                    return ['Step 2 — Find the coinciding line',
                        'Work along the vernier ruling lines out. Each one misses the main scale by one more least count (' + lc + ' ' + u + ') than its neighbour, until exactly one lands dead on. Do not count yet — just find it.'
                    ];
                }
            case 'vsr':
                {
                    const br = getVernierBridge();
                    const via = br.gap === 1 ? '' : ' (numeral ' + br.numeral + (br.rem ? ' + ' + br.rem : '') + ')';
                    return ['Step 3 — Count the divisions',
                        'Count from the vernier zero to that line: ' + n + ' division' + (n === 1 ? '' : 's') + via + '. The lower box adds one least count per division — that running total IS VSR x LC.'
                    ];
                }
            case 'tr':
                return ['Step 4 — Total Reading',
                    'TR = MSR + (VSR × LC) = ' + fmtMsr() + ' + (' + n + ' × ' + fmtLc() + ') = ' + fmtTr() + ' ' + u + '.'
                ];
            case 'ze':
                return ['Step 5 — Correct the zero error',
                    'This caliper has a zero error of ' + fmtZeSigned() + ' ' + u + '. Subtract it from what you read: the corrected size is ' + fmtReading(state.mm) + ' ' + u + '.'
                ];
        }
        return ['', ''];
    }

    function drawTeachBanner() {
        if (!teachOn()) return;
        const at = teachAt();
        const [title, body] = teachCaption();
        const PAD = TEACH_BAND_PAD,
            H = TEACH_BAND_H;
        const x = PAD,
            y = S.CH_OUT - H - PAD,
            w = S.CW - PAD - 14 - 138 - 10; // stop clear of .teach-bar

        ctx.save();
        ctx.fillStyle = 'rgba(8,12,18,0.92)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, H, 9);
        else ctx.rect(x, y, w, H);
        ctx.fill();
        ctx.strokeStyle = 'rgba(79,142,247,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // progress along the whole walkthrough, not just this stage
        ctx.fillStyle = 'rgba(79,142,247,0.85)';
        ctx.fillRect(x, y + H - 3, w * clamp(teach.t / teach.total, 0, 1), 3);

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#4f8ef7';
        ctx.font = 'bold 9.5pt sans-serif';
        ctx.fillText(title, x + 12, y + 15);
        ctx.fillStyle = '#9fb0cc';
        ctx.font = '8.5pt sans-serif';
        const lines = teachWrap(body, w - 24, 2);
        for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x + 12, y + 33 + i * 14);

        ctx.fillStyle = '#6b7a99';
        ctx.font = '8pt sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText((at.i + 1) + ' / ' + teach.stages.length, x + w - 12, y + 15);
        ctx.restore();
    }

    // Wrap to at most `max` lines, ellipsing the last. The band is a FIXED height:
    // it may not grow, or the caption would start pushing the instrument around.
    function teachWrap(txt, maxW, max) {
        const words = txt.split(' ');
        const lines = [];
        let line = '',
            i = 0;
        while (i < words.length) {
            const test = line ? line + ' ' + words[i] : words[i];
            if (ctx.measureText(test).width <= maxW) {
                line = test;
                i++;
                continue;
            }
            if (!line) {
                line = words[i];
                i++;
            } // a single word wider than the box
            lines.push(line);
            line = '';
            if (lines.length === max) break;
        }
        if (lines.length < max && line) {
            lines.push(line);
            line = '';
            i = words.length;
        }
        if (i < words.length && lines.length) {
            lines[lines.length - 1] = teachFit(lines[lines.length - 1] + ' ' + words.slice(i).join(' '), maxW);
        }
        return lines;
    }

    // One line, trimmed to fit.
    function teachFit(txt, maxW) {
        if (ctx.measureText(txt).width <= maxW) return txt;
        let lo = 0,
            hi = txt.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(txt.slice(0, mid) + '…').width <= maxW) lo = mid;
            else hi = mid - 1;
        }
        return txt.slice(0, lo).replace(/[\s,.]+$/, '') + '…';
    }
    // [VC-TEACHBANNER-END]

    // [VC-TEACHRUN-BEGIN]
    function teachStart() {
        if (!teachAllowed()) return;
        setLocked(false, true);
        stopAnim(); // the jaw sweep and the walkthrough cannot share the instrument
        cancelGlide();
        state.dragging = false;
        // Borrow the Coincidence highlight and switch it off. It marks the coinciding
        // line in gold permanently, which is precisely what step 2 exists to have the
        // student find — leaving it on gives the answer away before the search starts.
        // The visitor's own setting is handed back untouched when the walkthrough ends.
        if (teach.prevAlign === null) teach.prevAlign = state.showAlign;
        state.showAlign = false;
        teachSyncAlignBtn();

        teach.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        teachBuild();
        teach.on = true;
        teach.playing = !teach.reduced;
        teach.t = 0;
        teach.last = 0;
        teachSyncUi();
        if (teach.playing) teach.raf = requestAnimationFrame(teachTick);
        render();
    }

    function teachStop() {
        if (teach.raf) cancelAnimationFrame(teach.raf);
        teach.raf = null;
        teach.on = false;
        teach.playing = false;
        // Give the highlight back exactly as it was found, once — teachStop is also
        // reached from setMode and the exit button, and a second restore would
        // overwrite a choice the visitor made after the walkthrough closed.
        if (teach.prevAlign !== null) {
            state.showAlign = teach.prevAlign;
            teach.prevAlign = null;
            teachSyncAlignBtn();
        }
        teachLight(null);
        teachSyncUi();
        render();
    }

    function teachTick(ts) {
        if (!teach.on || !teach.playing) return;
        if (teach.last) {
            // Never backwards: an early frame would rewind stages already narrated.
            teach.t += (Math.max(0, ts - teach.last) / 1000) * TEACH_SPEED;
            if (teach.t >= teach.total) {
                teach.t = teach.total;
                teach.playing = false;
            }
        }
        teach.last = ts;
        teachSyncUi();
        render();
        if (teach.playing) teach.raf = requestAnimationFrame(teachTick);
    }

    function teachPlayPause() {
        if (!teach.on) return;
        if (teach.t >= teach.total) {
            teach.t = 0;
            teach.playing = true;
        } else teach.playing = !teach.playing;
        teach.last = 0;
        if (teach.playing) teach.raf = requestAnimationFrame(teachTick);
        teachSyncUi();
        render();
    }
    // Step to the START of the next/previous stage — a teacher holding a step wants
    // the stage boundary, not an arbitrary slice of tween.
    function teachStep(dir) {
        if (!teach.on) return;
        const at = teachAt();
        let i = at.i + (dir > 0 ? 1 : (at.phase > 0.06 ? 0 : -1));
        i = clamp(i, 0, teach.stages.length - 1);
        let t = 0;
        for (let k = 0; k < i; k++) t += teach.stages[k].w;
        teach.t = (dir > 0 && i === at.i) ? teach.total : t;
        teach.playing = false;
        teach.last = 0;
        teachSyncUi();
        render();
    }

    // Stage 4 is the arithmetic, so the arithmetic is what animates: the TR box's
    // own rows are held back and revealed one at a time, in the order a student
    // would write them. The rows are the EXISTING markup — no second copy of the
    // sum is created, so it cannot disagree with the tile it lives in.
    const TR_ROWS = ['tr-step1', 'tr-step2', null]; // null = the .tr-result line
    function teachRows(at) {
        const box = $('tr-formula');
        if (!box) return;
        const els = TR_ROWS.map(id => id ? $(id) : box.querySelector('.tr-result'));
        if (!teach.on || at.i < teach.stages.findIndex(s => s.key === 'tr')) {
            // Before the arithmetic stage — and whenever idle — the box is untouched.
            els.forEach(el => el && el.classList.remove('teach-hold', 'teach-pop'));
            box.classList.toggle('teach-lit', false);
            return;
        }
        const on = at.key === 'tr';
        box.classList.toggle('teach-lit', on);
        const shown = on ? Math.min(els.length, Math.floor(at.phase * els.length) + 1) : els.length;
        els.forEach((el, i) => {
            if (!el) return;
            el.classList.toggle('teach-hold', i >= shown);
            el.classList.toggle('teach-pop', on && i === shown - 1);
        });
    }

    // The Coincidence chip, kept in step with state.showAlign. Shared with the
    // walkthrough, which borrows the setting and gives it back.
    function teachSyncAlignBtn() {
        const b = $('btn-align');
        if (!b) return;
        b.classList.toggle('active', state.showAlign);
        b.setAttribute('aria-pressed', state.showAlign ? 'true' : 'false');
    }

    // Light the tile that belongs to the current stage. The Practice blur must
    // survive this: lighting a tile may not reveal a value the student owes.
    function teachLight(cls) {
        if (teach.lit === cls) return;
        document.querySelectorAll('.rcell.teach-lit, .tr-formula.teach-lit')
            .forEach(el => el.classList.remove('teach-lit'));
        if (cls) {
            const el = document.querySelector('.' + cls);
            if (el) el.classList.add('teach-lit');
        }
        teach.lit = cls;
    }
    // [VC-TEACHRUN-END]

    // ── Reading panel + badge update ──────────────────────────────────
    function updateReadingPanel() {
        const u = uLabel();
        const lcStr = fmtLc();

        // While the guided reading runs, the tiles show what it has DERIVED so far
        // rather than the finished answer: MSR and VSR start at zero and fill in as
        // the line grows and the count walks, so the measurement tile adds up live.
        // Every value still comes from the tool's own formatters — this decides WHICH
        // numbers to hand them, never how to write one.
        const live = teachLive();
        const alignIdx = live ? live.vsr : getAlignedIdx();
        const msrStr = live ? fmtMsrDivs(live.msrDivs) : fmtMsr();
        const partStr = live ? fmtDispValue(alignIdx * getLcDisplay()) : fmtPart();
        const trStr = live ? fmtDispValue(live.msrDivs * getMsdDisplay() +
            alignIdx * getLcDisplay()) : fmtTr();
        const readStr = live ? trStr : fmtReading(state.mm);

        // Digital readout — a mixed fraction ("3 15/16") is wider than "100.00", so
        // the LCD and the MSR cell step down a size in fractional mode.
        const frac = impFractional();
        $('readout-display').textContent = readStr;
        $('readout-display').classList.toggle('frac', frac);
        $('practice-input').classList.toggle('frac', frac);

        // Reading cells
        $('msr-val').textContent = msrStr;
        $('msr-val').classList.toggle('frac', frac);
        $('lc-val').classList.toggle('frac', frac);
        $('vsr-val').textContent = alignIdx;
        $('lc-val').textContent = lcStr;

        // The trigger is hidden in Quiz, and in Practice until the attempt is marked:
        // a step-by-step reading of the instrument IS the answer the student owes.
        // updateReadingPanel runs on every render, which is the only place that sees
        // every path into a mode change, a new question and a marked answer.
        {
            const how = $('btn-how');
            if (how) how.hidden = !teachAllowed();
        }

        // Bridge: the coinciding line is rarely the one carrying the VSR, because the
        // numerals count in tenths. Say where the division count came from. Always
        // rendered (never toggled) so the tile cannot change height as the jaw moves.
        {
            const br = getVernierBridge();
            const el = $('vsr-bridge');
            // Blank while the count is still running: it names the FINAL division, so
            // showing it mid-count hands over the answer the count is working towards.
            if (el && live && live.vsr !== getAlignedIdx()) {
                el.textContent = '';
            } else if (el) {
                el.textContent = br.gap === 1 ?
                    '' // every division numbered — nothing to bridge
                    :
                    (br.rem === 0 ?
                        `= numeral ${br.numeral}` :
                        `= numeral ${br.numeral} + ${br.rem} div`);
            }
        }

        // Unit labels in cells
        document.querySelectorAll('.rcell-msr .rcell-unit, .rcell-lc .rcell-unit').forEach(el => el.textContent = u);
        document.querySelector('.dr-unit').textContent = u;

        // Formula
        $('f-msr').textContent = msrStr;
        $('f-vsr').textContent = alignIdx;
        $('f-lc').textContent = lcStr;
        $('f-msr2').textContent = msrStr;
        $('f-part').textContent = partStr;
        $('f-tr').textContent = trStr;
        document.querySelector('.tr-unit').textContent = u;

        // ── Zero error readout (visible when state.zeOn, hidden until reveal in practice/quiz) ──
        var zeBox = $('ze-readout');
        var hideUnanswered = (state.mode === 'practice' && !state.answered) ||
            (state.mode === 'quiz' && !state.quizAnswered);

        // The task line. While the attempt is still open, a zero error is the whole
        // difference between what the scales SAY and the answer the tool wants — and
        // the Corrected = Observed − Zero Error panel below is hidden until the
        // attempt is marked, so up to now the only instruction on screen was "read
        // the scale as usual". A student who read 2.050 off a beam carrying a +0.005
        // error typed 2.050, was told Wrong, and had read the instrument perfectly.
        // Ask for the correction before the attempt, not after it.
        syncTaskHint(hideUnanswered);
        var zeVisible = state.zeOn && state.mode !== 'explore' && !hideUnanswered;
        if (zeBox) zeBox.style.display = zeVisible ? '' : 'none';
        if (zeVisible) {
            var obs = $('ze-observed');
            if (obs) obs.textContent = fmtReading(getDisplayMm());
            var ze = $('ze-error');
            if (ze) ze.textContent = fmtZeSigned();
            var cor = $('ze-corrected');
            if (cor) cor.textContent = fmtReading(state.mm);
            document.querySelectorAll('#ze-readout .ze-cell-unit').forEach(function(el) {
                el.textContent = u;
            });
        }
        // Exact decimal equivalent — fractional-inch instrument only, and only when
        // the reading is already on screen. In Practice and Quiz the readout is
        // replaced by the answer box, and printing the equivalent there would hand
        // the student the value they are being asked to read.
        var eq = impFractional() && $('readout-display').style.display !== 'none' ?
            fracDecimalEquiv(dispValueOf(state.mm)) : '';
        var drEq = $('dr-equiv');
        if (drEq) {
            drEq.textContent = eq ? '= ' + eq : '';
            drEq.style.display = eq ? '' : 'none';
        }
        var trEq = $('tr-equiv');
        if (trEq) {
            var trShow = eq && !$('tr-formula').classList.contains('formula-hidden');
            trEq.textContent = trShow ? '= ' + eq + '  exact decimal equivalent' : '';
            trEq.style.display = trShow ? '' : 'none';
        }

        var zeVal = $('ze-val');
        if (zeVal) zeVal.textContent = withUnit(fmtZeSigned());
        var zeStep = $('ze-stepper');
        if (zeStep) zeStep.style.display = state.zeOn ? '' : 'none';
    }

    // What the open attempt is asking for, over and above reading the scale. Empty
    // whenever there is nothing extra to say, so the span collapses (.pbar-hint:empty).
    function zeTaskHtml() {
        if (!state.zeOn || state.zeLc === 0) return ''; // a zero zero-error asks for nothing
        return 'Zero error <strong>' + withUnit(fmtZeSigned()) + '</strong> is set \u2014 ' +
            'answer with the CORRECTED reading (Observed \u2212 Zero Error).';
    }

    // The quiz bar's hint is per QUESTION ("close the jaws onto the part"), so the
    // zero-error clause is appended to it rather than replacing it. Practice has no
    // standing hint of its own and gets the clause alone.
    var quizHintBase = 'Read the caliper &middot; type your answer above&nbsp;&uarr;';
    var taskHintSig = null;

    function syncTaskHint(open) {
        var ze = open ? zeTaskHtml() : '';
        var sig = state.mode + '|' + open + '|' + ze + '|' + quizHintBase;
        if (sig === taskHintSig) return; // written every frame otherwise
        taskHintSig = sig;
        var ph = $('practice-hint');
        if (ph) ph.innerHTML = state.mode === 'practice' ? ze : '';
        var qh = $('quiz-hint');
        if (qh) qh.innerHTML = quizHintBase + (state.mode === 'quiz' && ze ? ' &middot; ' + ze : '');
    }

    // ── Render ────────────────────────────────────────────────────────
    function render() {
        updateReadingPanel();
        updateObjBar();
        syncExerciseUi();
        // The 3D view draws the same state; the panels above have already been brought up to date.
        v3dSync();
        if (v3dOn()) {
            if (v3d.eng) v3d.eng.frame();
            return;
        }
        // Clear the whole backing store at identity, then draw in DPR-scaled logical space.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cEl.width, cEl.height);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        if (teachZoomBlend() > 0) drawCaliperTeachZoom(); // the walkthrough's own framing
        else if (state.zoomOpen) drawCaliperZoomed();
        else drawCaliper();
        // The caption band is a HUD: drawn after the zoom transform has been undone,
        // so it stays legible at every zoom factor instead of being magnified off-screen.
        drawTeachBanner();
    }

    // ── Animation ─────────────────────────────────────────────────────
    function animStep(ts) {
        if (!state.playing) return;
        if (state.animLast) {
            const dt = Math.max(0, ts - state.animLast) / 1000; // never backwards
            let next = state.mm + state.animDir * ANIM_SPEED * dt;
            const maxMm = wpMaxMm();
            const minMm = wpMinMm();
            if (next >= maxMm) {
                next = maxMm;
                state.animDir = -1;
            }
            if (next <= minMm) {
                next = minMm;
                state.animDir = 1;
            }
            setMm(snapToLc(next));
        }
        state.animLast = ts;
        render();
        state.animRaf = requestAnimationFrame(animStep);
    }

    function startAnim() {
        setLocked(false, true); // the Play sweep is the tool moving the head, not the visitor
        if (state.animRaf) cancelAnimationFrame(state.animRaf);
        state.playing = true;
        state.animLast = 0;
        state.animDir = Math.random() < 0.5 ? 1 : -1;
        $('btn-play').innerHTML = '&#9646;&#9646;&nbsp; Pause';
        $('btn-play').classList.add('playing');
        $('btn-check').disabled = true;
        $('practice-input').value = '';
        $('feedback').textContent = '';
        $('feedback').className = 'feedback';
        state.animRaf = requestAnimationFrame(animStep);
    }

    function stopAnim() {
        state.playing = false;
        if (state.animRaf) {
            cancelAnimationFrame(state.animRaf);
            state.animRaf = null;
        }
        state.animLast = 0;
        state.quizTarget = state.mm;
        state.answered = false;
        $('btn-play').innerHTML = '&#9654;&nbsp; Play';
        $('btn-play').classList.remove('playing');
        $('btn-check').disabled = false;
        $('practice-input').value = '';
        $('practice-input').focus();
        playClick();
    }

    function randomZeLc() {
        const mag = 1 + Math.floor(Math.random() * ZE_MAX_LC);
        return (Math.random() < 0.5 ? -1 : 1) * mag;
    }

    // ── Practice mode ─────────────────────────────────────────────────
    // Two drills share the bar and never overlap: Play/Pause freezes the jaws at a
    // random opening, and Measure-an-object clamps a real part in them. Starting
    // either one ends the other, so there is only ever a single target.
    function practiceResetUi() {
        $('practice-input').value = '';
        $('feedback').textContent = '';
        $('feedback').className = 'feedback';
        $('reading-cells').classList.add('cells-hidden');
        $('tr-formula').classList.add('formula-hidden');
        $('readout-display').style.display = 'none';
        $('practice-input').style.display = 'block';
        $('dr-label').textContent = 'Your Answer';
    }

    function practiceMeasureObject() {
        if (state.playing) stopAnim();
        if (state.zeOn) state.zeLc = randomZeLc();
        const wp = pickExerciseWp(state.wp ? [state.wp.id] : null);
        state.answered = false;
        state.quizTarget = wp.mm; // the part IS the target
        practiceResetUi();
        $('btn-check').disabled = true; // until the jaws are on the part
        $('btn-play').disabled = true; // Play would fight the clamp
        $('btn-play').innerHTML = '&#9654;&nbsp; Play';
        $('btn-play').classList.remove('playing');
        $('caliper-card').style.cursor = 'grab';
        loadWorkpieceObj(wp);
    }

    function newQuiz() {
        if (state.playing) stopAnim();
        if (state.wp) clearWorkpiece();
        $('btn-play').disabled = false;
        $('caliper-card').style.cursor = 'default';
        const maxMm = getMaxMm();
        const lcMm = getLcMm();
        if (state.zeOn) {
            state.zeLc = randomZeLc();
            const zeM = state.zeLc * lcMm;
            const lo = Math.max(lcMm * 10, -zeM + lcMm);
            const hi = Math.min(maxMm - lcMm * 10, maxMm - zeM - lcMm);
            state.mm = snapToLc(lo + Math.random() * Math.max(lcMm, hi - lo));
        } else {
            state.mm = clamp(snapToLc(lcMm * 10 + Math.random() * (maxMm - lcMm * 20)), lcMm, maxMm);
        }
        state.quizTarget = 0;
        state.answered = false;

        $('practice-input').value = '';
        $('feedback').textContent = '';
        $('feedback').className = 'feedback';
        $('btn-check').disabled = true;
        $('btn-play').innerHTML = '&#9654;&nbsp; Play';
        $('btn-play').classList.remove('playing');

        $('reading-cells').classList.add('cells-hidden');
        $('tr-formula').classList.add('formula-hidden');
        $('readout-display').style.display = 'none';
        $('practice-input').style.display = 'block';
        $('dr-label').textContent = 'Your Answer';
        v3dNewQuestion();
        render();
    }

    function getTargetDisplay() {
        return fmtDispValue(gradedValueOf(state.quizTarget));
    }

    function checkAnswer() {
        if (state.answered || state.playing) return;
        if ($('btn-check').disabled) return; // no target yet (Play → Pause first)
        const raw = ($('practice-input').value || '').trim();
        const input = parseAnswerInput(raw);
        if (isNaN(input)) {
            $('feedback').textContent = answerHint();
            $('feedback').className = 'feedback warn'; // not a verdict on the reading
            return;
        }
        state.attempts++;

        const targetStr = getTargetDisplay();
        const targetVal = gradedValueOf(state.quizTarget);
        const tolerance = getLcDisplay() / 2 + 1e-6;
        // Two answers that PRINT the same are the same reading: the tool grades to
        // the instrument's own precision, so a typed value that renders as the very
        // string quoted back as the answer can never be marked wrong.
        const ok = Math.abs(input - targetVal) <= tolerance || fmtDispValue(input) === targetStr;

        $('readout-display').textContent = fmtReading(state.quizTarget);
        $('readout-display').style.display = 'block';
        $('practice-input').style.display = 'none';
        $('dr-label').textContent = 'Measurement';
        $('reading-cells').classList.remove('cells-hidden');
        $('tr-formula').classList.remove('formula-hidden');

        if (ok) {
            state.score++;
            $('feedback').innerHTML = `&#10003; Correct! &nbsp;<strong>${withUnit(targetStr)}</strong>`;
            $('feedback').className = 'feedback ok';
            playSuccess();
        } else {
            // Echo what was GRADED. The box is hidden on Check, so without this a
            // value changed after typing (a scroll notch over a focused number input
            // steps it by one least count) reads as "I typed the answer and it said
            // wrong" — the user report this line exists for.
            $('feedback').innerHTML = `&#10007; Wrong &nbsp;|&nbsp; You entered: <strong>${withUnit(escHtml(raw))}</strong> &nbsp;|&nbsp; Answer: <strong>${withUnit(targetStr)}</strong>`;
            $('feedback').className = 'feedback err';
            playError();
        }
        state.answered = true;
        $('score').textContent = state.score;
        $('attempts').textContent = state.attempts;
        $('btn-check').disabled = true;
        render(); // refresh ZE readout box now that answered = true
    }

    // ── Quiz mode ─────────────────────────────────────────────────────
    const QUIZ_OBJ_MIN = 2; // at least this many of the five are real parts

    function startQuiz() {
        if (state.wp) clearWorkpiece();
        const maxMm = getMaxMm();
        const lcMm = getLcMm();
        // Self-contained questions — robust to mid-quiz toggle changes.
        //   kind 'scale'  → { trueMm, zeLc }: the jaws are preset, just read them.
        //   kind 'object' → { wp, trueMm, zeLc }: close the jaws on a part first.
        // Two or three of the five are always objects, placed at random positions.
        const objCount = QUIZ_OBJ_MIN + (Math.random() < 0.5 ? 0 : 1);
        const slots = [];
        for (let i = 0; i < QUIZ_TOTAL; i++) slots.push(i < objCount ? 'object' : 'scale');
        for (let i = slots.length - 1; i > 0; i--) { // Fisher–Yates
            const j = Math.floor(Math.random() * (i + 1));
            const t = slots[i];
            slots[i] = slots[j];
            slots[j] = t;
        }

        state.quizQuestions = [];
        const used = new Set();
        const usedWp = [];
        slots.forEach(function(kind) {
            let z = state.zeOn ? randomZeLc() : 0;
            if (kind === 'object') {
                const wp = pickExerciseWp(usedWp);
                usedWp.push(wp.id);
                state.quizQuestions.push({
                    kind: 'object',
                    wp: wp,
                    trueMm: wp.mm,
                    zeLc: z
                });
                return;
            }
            const zeM = z * lcMm;
            const lo = Math.max(lcMm * 10, -zeM + lcMm);
            const hi = Math.min(maxMm - lcMm * 10, maxMm - zeM - lcMm);
            if (hi <= lo) {
                z = 0;
            }
            let trueMm, key, guard = 0;
            do {
                trueMm = clamp(snapToLc(lo + Math.random() * Math.max(lcMm, hi - lo)), 0, maxMm);
                key = trueMm.toFixed(4) + '_' + z;
            } while (used.has(key) && ++guard < 50);
            used.add(key);
            state.quizQuestions.push({
                kind: 'scale',
                trueMm: trueMm,
                zeLc: z
            });
        });

        state.quizCurrent = 0;
        state.quizAnswers = [];
        state.quizAnswered = false;

        $('quiz-result').style.display = 'none';
        $('quiz-bar').style.display = '';
        $('quiz-q-total').textContent = QUIZ_TOTAL;
        showQuizQuestion(0);
    }

    function showQuizQuestion(idx) {
        const q = state.quizQuestions[idx];
        state.zeLc = q.zeLc;
        state.quizAnswered = false;

        const isObj = q.kind === 'object';
        if (isObj) {
            // The part is the question: the jaws arrive open and the student has to
            // close onto it before the scale means anything.
            state.mm = getMaxMm();
            loadWorkpieceObj(q.wp, true);
            $('caliper-card').style.cursor = 'grab';
            quizHintBase = 'Close the jaws onto the part &middot; then read the scale&nbsp;&uarr;';
        } else {
            if (state.wp) clearWorkpiece();
            state.mm = q.trueMm;
            $('caliper-card').style.cursor = 'default';
            quizHintBase = 'Read the caliper &middot; type your answer above&nbsp;&uarr;';
        }

        $('quiz-q-num').textContent = idx + 1;
        $('quiz-feedback').textContent = '';
        $('quiz-feedback').className = 'quiz-feedback';
        $('btn-quiz-submit').style.display = '';
        $('btn-quiz-submit').disabled = isObj; // enabled by syncExerciseUi on contact
        $('btn-quiz-next').style.display = 'none';

        $('reading-cells').classList.add('cells-hidden');
        $('tr-formula').classList.add('formula-hidden');
        $('readout-display').style.display = 'none';
        $('practice-input').style.display = 'block';
        $('practice-input').value = '';
        $('dr-label').textContent = 'Your Reading';

        setTimeout(() => $('practice-input').focus(), 50);
        v3dNewQuestion();
        render();
    }

    function getCorrectDisplay(mmVal) {
        return fmtDispValue(gradedValueOf(mmVal));
    }

    function submitQuizAnswer() {
        if (state.quizAnswered) return;
        if ($('btn-quiz-submit').disabled) return; // object question: not on the part yet
        const raw = ($('practice-input').value || '').trim();
        const input = parseAnswerInput(raw);
        if (isNaN(input)) {
            $('quiz-feedback').textContent = answerHint();
            $('quiz-feedback').className = 'quiz-feedback warn'; // not a verdict on the reading
            return;
        }

        const correctMm = state.quizQuestions[state.quizCurrent].trueMm;
        const correctStr = getCorrectDisplay(correctMm);
        const correctVal = gradedValueOf(correctMm);
        const tolerance = getLcDisplay() / 2 + 1e-6;
        const ok = Math.abs(input - correctVal) <= tolerance || fmtDispValue(input) === correctStr;

        // Keep the answer AS TYPED — a fraction must not come back as 1.3359375.
        state.quizAnswers.push({
            given: raw || String(input),
            correctMm,
            correctStr,
            ok
        });
        state.quizAnswered = true;

        $('readout-display').textContent = fmtReading(correctMm);
        $('readout-display').style.display = 'block';
        $('practice-input').style.display = 'none';
        $('dr-label').textContent = 'Measurement';
        $('reading-cells').classList.remove('cells-hidden');
        $('tr-formula').classList.remove('formula-hidden');

        $('btn-quiz-submit').style.display = 'none';

        if (ok) {
            $('quiz-feedback').innerHTML = '&#10003; Correct!';
            $('quiz-feedback').className = 'quiz-feedback ok';
            playSuccess();
        } else {
            $('quiz-feedback').innerHTML =
                `&#10007; Incorrect &nbsp;|&nbsp; You entered: <strong>${withUnit(escHtml(raw))}</strong> &nbsp;|&nbsp; Answer: <strong>${withUnit(correctStr)}</strong>`;
            $('quiz-feedback').className = 'quiz-feedback err';
            playError();
        }

        const isLast = state.quizCurrent + 1 >= QUIZ_TOTAL;
        $('btn-quiz-next').innerHTML = isLast ? '&#128202;&nbsp;Results' : 'Next &rarr;';
        $('btn-quiz-next').style.display = '';
        render(); // refresh ZE readout box now that quizAnswered = true
    }

    function nextQuizQuestion() {
        state.quizCurrent++;
        if (state.quizCurrent >= QUIZ_TOTAL) showQuizResult();
        else showQuizQuestion(state.quizCurrent);
    }

    function showQuizResult() {
        if (state.wp) clearWorkpiece();
        $('caliper-card').style.cursor = 'default';
        $('quiz-bar').style.display = 'none';
        $('quiz-result').style.display = '';

        const u = uLabel();
        const score = state.quizAnswers.filter(a => a.ok).length;
        const scoreEl = $('qr-score');
        const starsEl = $('qr-stars');
        const verdictEl = $('qr-verdict');

        scoreEl.textContent = `${score} / ${QUIZ_TOTAL}`;
        const starFull = '\u2605';
        const starEmpty = '\u2606';
        const filled = n => starFull.repeat(n) + starEmpty.repeat(QUIZ_TOTAL - n);

        if (score === QUIZ_TOTAL) {
            scoreEl.className = 'qr-score perfect';
            starsEl.textContent = filled(QUIZ_TOTAL);
            starsEl.style.color = 'var(--gold)';
            verdictEl.textContent = 'Perfect score! \uD83C\uDFAF';
        } else if (score >= Math.ceil(QUIZ_TOTAL * 0.8)) {
            scoreEl.className = 'qr-score good';
            starsEl.textContent = filled(score);
            starsEl.style.color = 'var(--green)';
            verdictEl.textContent = 'Great job! \uD83D\uDC4D';
        } else if (score >= Math.ceil(QUIZ_TOTAL * 0.6)) {
            scoreEl.className = 'qr-score good';
            starsEl.textContent = filled(score);
            starsEl.style.color = 'var(--green)';
            verdictEl.textContent = 'Good effort! \uD83D\uDCAA';
        } else if (score >= 1) {
            scoreEl.className = 'qr-score poor';
            starsEl.textContent = filled(score);
            starsEl.style.color = '#ffb74d';
            verdictEl.textContent = 'Keep practising! \uD83D\uDCAA';
        } else {
            scoreEl.className = 'qr-score poor';
            starsEl.textContent = filled(0);
            starsEl.style.color = 'var(--red)';
            verdictEl.textContent = 'Try again! \uD83D\uDCAA';
        }

        const rowsEl = $('qr-rows');
        rowsEl.innerHTML = '';
        state.quizAnswers.forEach((ans, i) => {
            const row = document.createElement('div');
            row.className = `qr-row ${ans.ok ? 'ok' : 'err'}`;
            row.innerHTML = `
      <span class="qr-qnum">Q${i + 1}</span>
      <span class="qr-correct">Correct: <strong>${ans.correctStr} ${u}</strong></span>
      <span class="qr-given">Your answer: <strong>${ans.given} ${u}</strong></span>
      <span class="qr-mark">${ans.ok ? '&#10003;' : '&#10007;'}</span>`;
            rowsEl.appendChild(row);
        });

        $('readout-display').textContent = fmtReading(state.mm);
        $('readout-display').style.display = 'block';
        $('reading-cells').classList.remove('cells-hidden');
        $('tr-formula').classList.remove('formula-hidden');
        $('dr-label').textContent = 'Measurement';
    }

    // ── Parts & Components explorer ───────────────────────────────────
    // A labelled, hoverable anatomy diagram drawn as inline SVG. Geometry is in a
    // single 20 20 900 380 viewBox; the instrument shares one linear scale so the
    // drawing is dimensionally honest: main-scale zero sits on the fixed jaw's
    // measuring face and the vernier zero lands exactly on 36 mm.
    const P = {
        x0: 156.8, // main-scale zero (= fixed outside-jaw measuring face)
        ppm: 6.2, // px per mm
        beamT: 158,
        beamB: 212,
        beamL: 110,
        beamR: 810,
        headL: 380,
        headR: 528,
        headT: 136,
        headB: 242,
        tickEndX: 804
    };

    const PARTS_DATA = [{
            z: 2,
            name: 'Fixed Jaw (Main Frame)',
            sub: 'Reference body of the caliper',
            hl: '<path {A} d="M110 158 H156 V322 H128 L110 292 Z"/>',
            b: [56, 262],
            lead: ['M56 262 L112 262'],
            dots: [
                [112, 262]
            ],
            info: '<span class="pi-tag">Structure</span><h3>Fixed Jaw (Main Frame)</h3>' +
                '<p>The fixed jaw is forged in one piece with the <strong>main scale beam</strong>. It never moves, so its measuring face defines the <strong>zero reference</strong> for every reading you take.</p>' +
                '<ul><li>Carries both the lower outside jaw and the upper inside jaw</li><li>Hardened and lapped measuring faces (58–62 HRC typical)</li><li>Because it is integral with the beam, a dropped caliper usually loses accuracy here first</li></ul>' +
                '<div class="pi-tip"><strong>Workshop tip:</strong> Always seat the workpiece firmly against the <em>fixed</em> jaw and bring the sliding jaw up to it — never the other way round. This keeps the part square to the beam.</div>'
        },
        {
            z: 3,
            name: 'Sliding Jaw (Vernier Head)',
            sub: 'Carries the vernier scale',
            hl: '<rect {A} x="380" y="136" width="148" height="106" rx="7"/>',
            b: [566, 46],
            lead: ['M566 46 L524 140'],
            dots: [
                [524, 140]
            ],
            info: '<span class="pi-tag">Structure</span><h3>Sliding Jaw (Vernier Head)</h3>' +
                '<p>The movable assembly that slides along the beam. It carries the <strong>vernier scale</strong>, the outside and inside jaws, the depth rod, the thumb roller and the locking screw — everything that moves, moves together.</p>' +
                '<ul><li>Slides in a precision-ground groove; a leaf spring inside keeps it from rocking</li><li>Its left face is exactly in line with the vernier zero line</li><li>Excess play here (jaw "rock") is the most common cause of scatter in readings</li></ul>' +
                '<div class="pi-tip"><strong>Check it:</strong> Hold the caliper up to a light with the jaws closed. If light passes between the faces, the head is worn or the jaws are sprung.</div>'
        },
        {
            z: 6,
            name: 'Outside (External) Jaws',
            sub: 'Shafts, rods, thicknesses',
            hl: '<path {A} d="M146 212 H156 V322 H130 L146 300 Z M380 242 H396 V322 H380 Z"/>',
            b: [268, 362],
            lead: ['M268 362 L154 314', 'M268 362 L386 320'],
            dots: [
                [154, 314],
                [386, 320]
            ],
            info: '<span class="pi-tag">Measuring</span><h3>Outside (External) Jaws</h3>' +
                '<p>The large lower jaws. Their <strong>inner faces</strong> close onto the workpiece to measure external dimensions — shaft diameters, plate thickness, block widths.</p>' +
                '<dl class="pi-spec"><dt>Faces used</dt><dd>Inner (facing each other)</dd><dt>Reads</dt><dd>Directly on the scale</dd><dt>Typical use</dt><dd>Shaft Ø, thickness, width</dd></dl>' +
                '<div class="pi-tip"><strong>Watch out:</strong> Measure across the <em>full flat</em> of the jaw, close to the beam. Measuring on the jaw tips lets the jaws spring open and reads large.</div>'
        },
        {
            z: 5,
            name: 'Inside (Internal) Jaws',
            sub: 'Bores, slots, grooves',
            hl: '<path {A} d="M132 158 V106 L139 86 H149 L156 110 V158 Z M380 136 V106 L387 86 H397 L404 110 V136 Z"/>',
            b: [176, 44],
            lead: ['M176 44 L146 92', 'M176 44 L392 92'],
            dots: [
                [146, 92],
                [392, 92]
            ],
            info: '<span class="pi-tag">Measuring</span><h3>Inside (Internal) Jaws</h3>' +
                '<p>The small knife-edged jaws above the beam. Their <strong>outer faces</strong> press outwards against a bore or slot, so the caliper reads internal dimensions.</p>' +
                '<dl class="pi-spec"><dt>Faces used</dt><dd>Outer (facing away)</dd><dt>Reads</dt><dd>Directly on modern calipers</dd><dt>Typical use</dt><dd>Hole Ø, slot width, groove</dd></dl>' +
                '<div class="pi-tip"><strong>Older calipers:</strong> On some designs the jaw thickness (often stamped on the blade, e.g. 10 mm) must be <em>added</em> to the scale reading. Modern nib-style jaws read directly — check your instrument before assuming.</div>'
        },
        {
            z: 1,
            name: 'Main Scale (Beam)',
            sub: 'The fixed graduated blade',
            hl: '<rect {A} x="110" y="158" width="700" height="54" rx="4"/>',
            b: [762, 104],
            lead: ['M762 104 L744 162'],
            dots: [
                [744, 162]
            ],
            info: '<span class="pi-tag">Scale</span><h3>Main Scale (Beam)</h3>' +
                '<p>The long, rigid steel blade that everything else rides on. It carries the <strong>metric graduations on one edge</strong> and the <strong>inch graduations on the other</strong>, and its stiffness is what holds the two jaws parallel.</p>' +
                '<ul><li>Common capacities: 0–150 mm, 0–200 mm, 0–300 mm</li><li>Hardened stainless steel, satin-chrome finished to kill glare</li><li>A groove machined along its underside houses the depth rod</li></ul>' +
                '<div class="pi-tip"><strong>Remember:</strong> The beam is the <em>datum</em>. Any bend in it puts an error into every measurement, so never use a caliper as a scriber, pry bar or clamp.</div>'
        },
        {
            z: 4,
            name: 'Metric Main Graduations',
            sub: '1 mm divisions (1 MSD)',
            hl: '<path {A} d="M160 186 H378 V212 H160 Z M530 186 H806 V212 H530 Z"/>',
            b: [240, 266],
            lead: ['M240 266 L240 214'],
            dots: [
                [240, 214]
            ],
            info: '<span class="pi-tag">Scale</span><h3>Metric Main Scale Graduations</h3>' +
                '<p>The millimetre scale along the lower edge. One division = <strong>1 mm</strong>, and this is what the abbreviation <strong>1 MSD</strong> (Main Scale Division) means in every least-count formula.</p>' +
                '<div class="formula-box">1 MSD = 1 mm &nbsp;&middot;&nbsp; numbered every 10th line</div>' +
                '<p>To read it, look at where the <strong>vernier zero line</strong> falls and take the <em>last main-scale line it has passed</em> — never the one ahead of it. In the diagram above the vernier zero sits on 36, so MSR = 36 mm.</p>' +
                '<div class="pi-tip"><strong>Exam favourite:</strong> Rounding the MSR up because the vernier zero is "nearly" at the next line loses the mark. The MSR is always rounded <em>down</em>; the fraction comes from the vernier.</div>'
        },
        {
            z: 4,
            name: 'Inch (Imperial) Scale',
            sub: '1/40" = 0.025" divisions',
            hl: '<path {A} d="M160 158 H378 V184 H160 Z M530 158 H806 V184 H530 Z"/>',
            b: [616, 104],
            lead: ['M616 104 L616 160'],
            dots: [
                [616, 160]
            ],
            info: '<span class="pi-tag">Scale</span><h3>Inch (Imperial) Main Scale</h3>' +
                '<p>The upper edge of the beam is divided into <strong>fortieths of an inch</strong>. Each small division is 0.025&Prime;, with every fourth line (0.100&Prime;) taller and each whole inch numbered. On the fractional caliper the same edge carries <strong>sixteenths</strong>, stepped 1&Prime; &gt; 1/2&Prime; &gt; 1/4&Prime; &gt; 1/8&Prime; &gt; 1/16&Prime; in tick height so sixteenths can be counted without reading a number.</p>' +
                '<div class="formula-box">1 MSD = 1/40&Prime; = <strong>0.025&Prime;</strong></div>' +
                '<p>Paired with a 25-division vernier this gives the standard imperial least count of <strong>0.001&Prime;</strong>. Switch to the fractional caliper and the same beam is re-engraved in <strong>sixteenths</strong>, read against an 8-division vernier for <strong>1/128&Prime;</strong>. The inch and metric sides are two independent instruments sharing one beam — read one or the other, never a mixture.</p>' +
                '<div class="pi-tip"><strong>Conversion:</strong> 1&Prime; = 25.4 mm exactly. A 0.001&Prime; caliper resolves 0.0254 mm — slightly finer than a 0.02 mm metric vernier.</div>'
        },
        {
            z: 7,
            name: 'Vernier Scale',
            sub: 'The fractional (sliding) scale',
            hl: '<path {A} d="M380 212 H502 V240 H380 Z M380 138 H478 V158 H380 Z"/>',
            b: [556, 302],
            lead: ['M556 302 L500 240'],
            dots: [
                [500, 240]
            ],
            info: '<span class="pi-tag">Scale</span><h3>Vernier Scale</h3>' +
                '<p>The short auxiliary scale engraved on the sliding head — metric below the beam, inch above it. Its divisions are deliberately made <em>slightly smaller</em> than the main-scale divisions, and that tiny difference is the instrument’s <strong>least count</strong>.</p>' +
                '<div class="formula-box">LC = 1 MSD − 1 VSD = 1 MSD / n</div>' +
                '<dl class="pi-spec"><dt>10 divisions</dt><dd>LC = 0.1 mm</dd><dt>20 divisions</dt><dd>LC = 0.05 mm</dd><dt>50 divisions</dt><dd>LC = 0.02 mm</dd><dt>25 divisions (inch)</dt><dd>LC = 0.001&Prime;</dd><dt>8 divisions (fractional inch)</dt><dd>LC = 1/128&Prime;</dd></dl>' +
                '<p>Only <strong>one</strong> vernier line can line up perfectly with a main-scale line. Its number, multiplied by the least count, is the fraction you add to the MSR.</p>'
        },
        {
            z: 9,
            name: 'Vernier Zero Line',
            sub: 'The pointer / index line',
            hl: '<rect {A} x="375" y="138" width="10" height="104" rx="2"/>',
            b: [330, 306],
            lead: ['M330 306 L379 244'],
            dots: [
                [379, 244]
            ],
            info: '<span class="pi-tag">Reading</span><h3>Vernier Zero Line (Index)</h3>' +
                '<p>The single most important line on the instrument. It is machined <strong>exactly in line with the sliding jaw’s measuring face</strong>, so it acts as the pointer that reads the main scale.</p>' +
                '<ul><li>Its position gives the <strong>main scale reading (MSR)</strong></li><li>With the jaws closed it must sit on main-scale zero — if not, the caliper has a <strong>zero error</strong></li><li>Vernier division counting always starts from this line, counted as 0</li></ul>' +
                '<div class="pi-tip"><strong>Zero check first, every time:</strong> Close the jaws gently and look at this line. Zero error found here is added to or subtracted from every reading in the batch.</div>'
        },
        {
            z: 8,
            name: 'Depth Measuring Rod',
            sub: 'Holes, slots, step heights',
            hl: '<rect {A} x="804" y="174" width="76" height="24" rx="4"/>',
            b: [848, 286],
            lead: ['M848 286 L858 200'],
            dots: [
                [858, 200]
            ],
            info: '<span class="pi-tag">Measuring</span><h3>Depth Measuring Rod (Depth Bar)</h3>' +
                '<p>A thin blade that runs in a groove under the beam and extends out of the far end as the head slides. Stand the <strong>end of the beam</strong> flat across the mouth of a hole and the rod drops to the bottom — the scale reads the depth directly.</p>' +
                '<ul><li>Used for blind-hole depths, slot depths and counterbore depths</li><li>The beam end is the reference surface, so it must bridge the hole squarely</li><li>Slender and easily bent — never push the rod against the work</li></ul>' +
                '<div class="pi-tip"><strong>Accuracy note:</strong> A caliper depth rod is the least accurate feature on the tool. For anything tighter than about ±0.05 mm, use a proper depth micrometer or depth gauge.</div>' +
                '<div class="pi-tip"><strong>Try it:</strong> close this panel, choose <em>Measure an object</em> and pick the <strong>blind hole</strong>, <strong>counterbore</strong> or <strong>slot</strong>. The block is drawn in section so you can watch the rod go down.</div>'
        },
        {
            z: 8,
            name: 'Thumb Roller (Fine Adjustment)',
            sub: 'Controls jaw pressure',
            hl: '<rect {A} x="436" y="240" width="70" height="26" rx="5"/>',
            b: [630, 264],
            lead: ['M630 264 L508 258'],
            dots: [
                [508, 258]
            ],
            info: '<span class="pi-tag">Control</span><h3>Thumb Roller / Thumb Screw</h3>' +
                '<p>The knurled wheel under the sliding head. Driving the head with your thumb here — instead of shoving the frame — gives you fine, <strong>repeatable contact pressure</strong> on the workpiece.</p>' +
                '<ul><li>Close until the jaws just "kiss" the part and it can still be drawn out with light drag</li><li>Consistent feel matters more than force: it is what makes two readings agree</li><li>Over-tightening springs the jaws and compresses soft materials — both read wrong</li></ul>' +
                '<div class="pi-tip"><strong>Why it matters:</strong> Jaw over-pressure is one of the largest error sources in caliper work, often several times the least count. The roller exists purely to control it.</div>'
        },
        {
            z: 9,
            name: 'Locking Screw',
            sub: 'Freezes the reading',
            hl: '<circle {A} cx="500" cy="147" r="13"/>',
            b: [452, 44],
            lead: ['M452 44 L494 138'],
            dots: [
                [494, 138]
            ],
            info: '<span class="pi-tag">Control</span><h3>Locking Screw (Clamp Screw)</h3>' +
                '<p>A small thumbscrew on top of the sliding head that clamps it to the beam so the setting cannot drift while you read it or lift the caliper away from the work.</p>' +
                '<ul><li>Lock <em>after</em> setting, then withdraw the caliper and read it in good light</li><li>Also used to hold a set size for transferring or scribing</li><li>Tighten gently — a hard nip can distort the head and shift the reading</li></ul>' +
                '<div class="pi-tip"><strong>Habit to build:</strong> Lock → remove → read at eye level, straight down onto the scale. This kills both jaw-pressure drift and parallax error in one move.</div>'
        }
    ];

    // Build the instrument artwork (static layer) as an SVG string.
    function partsInstrumentSvg() {
        const x0 = P.x0,
            ppm = P.ppm;
        let g = '';

        // Jaws (integral with beam) — drawn first so ticks/head land on top.
        g += '<path class="vc-metal" fill="url(#vcSteel)" d="M110 158 H156 V322 H128 L110 292 Z"/>';
        g += '<path class="vc-metal" fill="url(#vcSteel)" d="M132 158 V106 L139 86 H149 L156 110 V158 Z"/>';
        g += '<path class="vc-metal" fill="url(#vcSteel)" d="M380 242 H426 V292 L408 322 H380 Z"/>';
        g += '<path class="vc-metal" fill="url(#vcSteel)" d="M380 136 V106 L387 86 H397 L404 110 V136 Z"/>';

        // Depth rod out of the beam end.
        g += '<rect class="vc-metal" fill="url(#vcSteel)" x="806" y="179" width="72" height="13" rx="2"/>';

        // Beam.
        g += '<rect class="vc-metal" fill="url(#vcSteel)" x="110" y="158" width="700" height="54" rx="3"/>';

        // Metric graduations along the lower edge (ticks point up into the beam).
        let mm = '';
        for (let i = 0;; i++) {
            const x = +(x0 + i * ppm).toFixed(2);
            if (x > P.tickEndX) break;
            const h = (i % 10 === 0) ? 13 : (i % 5 === 0) ? 9 : 5;
            mm += '<line class="' + (i % 10 === 0 ? 'vc-tick-b' : 'vc-tick') + '" x1="' + x + '" y1="212" x2="' + x + '" y2="' + (212 - h) + '"/>';
            if (i % 10 === 0 && i > 0) {
                mm += '<text class="vc-num" font-size="8.5" text-anchor="middle" x="' + x + '" y="195">' + i + '</text>';
            }
        }
        g += mm;

        // Imperial graduations along the upper edge (1/40" divisions).
        const inPx = 25.4 * ppm;
        let ins = '';
        for (let i = 0;; i++) {
            const x = +(x0 + i * inPx / 40).toFixed(2);
            if (x > P.tickEndX) break;
            const h = (i % 40 === 0) ? 13 : (i % 4 === 0) ? 9 : 5;
            ins += '<line class="' + (i % 40 === 0 ? 'vc-tick-b' : 'vc-tick') + '" x1="' + x + '" y1="158" x2="' + x + '" y2="' + (158 + h) + '"/>';
            if (i % 40 === 0) {
                ins += '<text class="vc-num" font-size="8.5" text-anchor="middle" x="' + x + '" y="181">' + (i / 40) + '</text>';
            }
        }
        g += ins;

        // Sliding head over the beam.
        g += '<rect class="vc-metal" fill="url(#vcHead)" x="380" y="136" width="148" height="106" rx="7"/>';
        g += '<line class="vc-etch" x1="380" y1="158" x2="528" y2="158"/>';
        g += '<line class="vc-etch" x1="380" y1="212" x2="528" y2="212"/>';

        // Metric vernier: 20 divisions spanning 19 mm (LC 0.05 mm).
        const vStep = 19 * ppm / 20;
        for (let i = 0; i <= 20; i++) {
            const x = +(P.headL + i * vStep).toFixed(2);
            const h = (i % 5 === 0) ? 13 : 8;
            g += '<line class="' + (i % 5 === 0 ? 'vc-tick-b' : 'vc-tick') + '" x1="' + x + '" y1="212" x2="' + x + '" y2="' + (212 + h) + '"/>';
            if (i % 5 === 0) g += '<text class="vc-num" font-size="8" text-anchor="middle" x="' + x + '" y="236">' + i + '</text>';
        }

        // Imperial vernier: 25 divisions spanning 0.600" (LC 0.001").
        const viStep = 0.6 * inPx / 25;
        for (let i = 0; i <= 25; i++) {
            const x = +(P.headL + i * viStep).toFixed(2);
            const h = (i % 5 === 0) ? 10 : 6;
            g += '<line class="' + (i % 5 === 0 ? 'vc-tick-b' : 'vc-tick') + '" x1="' + x + '" y1="158" x2="' + x + '" y2="' + (158 - h) + '"/>';
            if (i % 5 === 0) g += '<text class="vc-num" font-size="7" text-anchor="middle" x="' + x + '" y="145">' + i + '</text>';
        }

        // Thumb roller (knurled) + locking screw.
        g += '<rect class="vc-metal" fill="url(#vcHead)" x="436" y="240" width="70" height="26" rx="5"/>';
        for (let x = 442; x < 504; x += 5) {
            g += '<line class="vc-etch" x1="' + x + '" y1="243" x2="' + x + '" y2="263"/>';
        }
        g += '<circle class="vc-metal" fill="url(#vcHead)" cx="500" cy="147" r="11"/>';
        g += '<line class="vc-tick-b" x1="493" y1="147" x2="507" y2="147"/>';

        return g;
    }

    function partOverlaySvg(p, num) {
        let s = '<g class="vc-part" data-num="' + num + '" tabindex="0" role="button" aria-label="' + p.name + '">';
        s += p.hl.replace(/\{A\}/g, 'class="vc-hl"');
        s += p.hl.replace(/\{A\}/g, 'class="vc-out"');
        p.lead.forEach(function(d) {
            s += '<path class="vc-lead" d="' + d + '"/>';
        });
        p.dots.forEach(function(pt) {
            s += '<circle class="vc-dot" cx="' + pt[0] + '" cy="' + pt[1] + '" r="3.2"/>';
        });
        s += '<circle class="vc-badge-bg" cx="' + p.b[0] + '" cy="' + p.b[1] + '" r="14"/>';
        s += '<text class="vc-badge-tx" x="' + p.b[0] + '" y="' + p.b[1] + '">' + num + '</text>';
        s += '</g>';
        return s;
    }

    let partsBuilt = false;

    function buildPartsPanel() {
        const svgHost = $('parts-svg');
        const listEl = $('parts-list');

        if (!partsBuilt) {
            // Overlay groups are painted largest-first (by z) so a small hotspot such as
            // the vernier zero line always wins the pointer over the beam beneath it.
            const order = PARTS_DATA.map(function(p, i) {
                    return {
                        p: p,
                        i: i
                    };
                })
                .sort(function(a, b) {
                    return a.p.z - b.p.z || a.i - b.i;
                });

            let svg = '<svg viewBox="20 20 900 380" role="img" ' +
                'aria-label="Labelled diagram of a vernier caliper showing its twelve main parts" ' +
                'xmlns="http://www.w3.org/2000/svg">';
            svg += '<defs>' +
                '<linearGradient id="vcSteel" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0" stop-color="#8d95a3"/><stop offset="0.26" stop-color="#c3cbd6"/>' +
                '<stop offset="0.36" stop-color="#eef2f6"/><stop offset="0.56" stop-color="#aeb7c3"/>' +
                '<stop offset="0.80" stop-color="#cad2dc"/><stop offset="1" stop-color="#6d7583"/>' +
                '</linearGradient>' +
                '<linearGradient id="vcHead" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0" stop-color="#7c8492"/><stop offset="0.3" stop-color="#c8d0da"/>' +
                '<stop offset="0.55" stop-color="#9aa3b1"/><stop offset="1" stop-color="#626a77"/>' +
                '</linearGradient>' +
                '</defs>';
            svg += '<g>' + partsInstrumentSvg() + '</g>';
            svg += '<g>';
            order.forEach(function(o) {
                svg += partOverlaySvg(o.p, o.i + 1);
            });
            svg += '</g></svg>';
            svgHost.innerHTML = svg;

            listEl.innerHTML = '';
            PARTS_DATA.forEach(function(p, i) {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'part-row';
                row.setAttribute('role', 'listitem');
                row.innerHTML = '<span class="part-num">' + (i + 1) + '</span>' +
                    '<span class="part-txt"><span class="part-name">' + p.name + '</span>' +
                    '<span class="part-sub">' + p.sub + '</span></span>';
                row.addEventListener('click', function() {
                    selectPart(i, true);
                });
                row.addEventListener('mouseenter', function() {
                    selectPart(i, false);
                });
                listEl.appendChild(row);
            });
            listEl.addEventListener('mouseleave', function() {
                selectPart(state.partPin, false);
            });

            // Hover previews the part; click (and tap) pins it.
            svgHost.addEventListener('mouseover', function(e) {
                const g = e.target.closest ? e.target.closest('.vc-part') : null;
                if (g) selectPart(+g.getAttribute('data-num') - 1, false);
            });
            svgHost.addEventListener('mouseleave', function() {
                selectPart(state.partPin, false);
            });
            svgHost.addEventListener('click', function(e) {
                const g = e.target.closest ? e.target.closest('.vc-part') : null;
                if (g) {
                    selectPart(+g.getAttribute('data-num') - 1, true);
                    playClick();
                }
            });
            svgHost.addEventListener('keydown', function(e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                const g = e.target.closest ? e.target.closest('.vc-part') : null;
                if (g) {
                    e.preventDefault();
                    selectPart(+g.getAttribute('data-num') - 1, true);
                }
            });

            partsBuilt = true;
        }

        selectPart(state.partPin, true);
    }

    function selectPart(idx, pin) {
        if (idx == null || idx < 0 || idx >= PARTS_DATA.length) idx = 0;
        if (pin) state.partPin = idx;
        state.partIdx = idx;

        const groups = $('parts-svg').querySelectorAll('.vc-part');
        groups.forEach(function(g) {
            g.classList.toggle('on', +g.getAttribute('data-num') - 1 === idx);
        });
        const rows = $('parts-list').querySelectorAll('.part-row');
        rows.forEach(function(r, i) {
            r.classList.toggle('active', i === idx);
        });

        $('parts-info').innerHTML = PARTS_DATA[idx].info;
    }

    // ── Explore mode ──────────────────────────────────────────────────
    const EXPLORE_DATA = [{
            cat: 'Parts & Components',
            parts: true,
            items: []
        },
        {
            cat: 'Vernier Types',
            items: [{
                    icon: '\uD83D\uDCCF',
                    label: 'Standard Vernier',
                    sub: '0\u2013100 mm range',
                    info: '<h3>Standard Vernier Caliper</h3><p>The most common type used in workshops and laboratories. Features <strong>outside jaws</strong> for external measurements, <strong>inside jaws</strong> for bores and slots, and a <strong>depth rod</strong> for step heights.</p><ul><li>Range: 0\u2013150 mm (typical) or 0\u2013300 mm</li><li>Least count: 0.02 mm (50 divisions) or 0.05 mm (20 divisions)</li><li>Made of hardened stainless steel</li><li>Used in general-purpose dimensional inspection</li></ul>'
                },
                {
                    icon: '\uD83D\uDD27',
                    label: 'Dial Vernier',
                    sub: 'Dial gauge readout',
                    info: '<h3>Dial Vernier Caliper</h3><p>Replaces the vernier scale with a <strong>dial indicator</strong> for easier reading. The dial displays the fractional millimetre directly, eliminating the need to find coincident lines.</p><ul><li>Resolution: 0.02 mm or 0.05 mm</li><li>Faster reading \u2014 reduces human error</li><li>More fragile due to internal gear mechanism</li><li>Popular in production inspection</li></ul>'
                },
                {
                    icon: '\uD83D\uDCDF',
                    label: 'Digital Vernier',
                    sub: 'LCD display',
                    info: '<h3>Digital Vernier Caliper</h3><p>Uses an electronic <strong>linear encoder</strong> and <strong>LCD display</strong> to show the measurement directly. Supports mm/inch switching and zero-set at any position.</p><ul><li>Resolution: 0.01 mm (higher than mechanical)</li><li>Features: mm/inch toggle, zero reset, data output port</li><li>Battery-powered (CR2032)</li><li>Most convenient but requires careful handling</li></ul>'
                },
                {
                    icon: '\u2195\uFE0F',
                    label: 'Depth Vernier',
                    sub: 'Depth measurement',
                    info: '<h3>Depth Vernier Caliper</h3><p>Specialised caliper designed primarily for measuring <strong>depths of holes, slots, and steps</strong>. The base sits flat on the reference surface while the rod extends into the cavity.</p><ul><li>Range: 0\u2013150 mm or 0\u2013200 mm</li><li>Base width: 100 mm (provides stable reference)</li><li>Interchangeable rods for different depth ranges</li><li>Critical in machining stepped features</li></ul>'
                }
            ]
        },
        {
            cat: 'Least Count',
            items: [{
                    icon: '50',
                    label: '0.02 mm LC',
                    sub: '50-division scale',
                    info: '<h3>0.02 mm Least Count (50 Divisions)</h3><p>The most precise mechanical vernier caliper. The vernier scale has <strong>50 divisions</strong> spanning 49 mm on the main scale.</p><div class="formula-box">LC = 1 MSD \u2212 1 VSD = 1 mm \u2212 49/50 mm = 1/50 mm = <strong>0.02 mm</strong></div><p><strong>Example:</strong> MSR = 25 mm, VSR = 17th division coincides.<br>TR = 25 + (17 \u00D7 0.02) = 25 + 0.34 = <strong>25.34 mm</strong></p>'
                },
                {
                    icon: '20',
                    label: '0.05 mm LC',
                    sub: '20-division scale',
                    info: '<h3>0.05 mm Least Count (20 Divisions)</h3><p>A common precision level where 20 vernier divisions span 19 mm on the main scale.</p><div class="formula-box">LC = 1 MSD \u2212 1 VSD = 1 mm \u2212 19/20 mm = 1/20 mm = <strong>0.05 mm</strong></div><p><strong>Example:</strong> MSR = 32 mm, VSR = 9th division coincides.<br>TR = 32 + (9 \u00D7 0.05) = 32 + 0.45 = <strong>32.45 mm</strong></p>'
                },
                {
                    icon: '10',
                    label: '0.1 mm LC',
                    sub: '10-division scale',
                    info: '<h3>0.1 mm Least Count (10 Divisions)</h3><p>The simplest vernier scale where 10 divisions span 9 mm on the main scale.</p><div class="formula-box">LC = 1 MSD \u2212 1 VSD = 1 mm \u2212 9/10 mm = 1/10 mm = <strong>0.1 mm</strong></div><p><strong>Example:</strong> MSR = 18 mm, VSR = 7th division coincides.<br>TR = 18 + (7 \u00D7 0.1) = 18 + 0.7 = <strong>18.7 mm</strong></p>'
                },
                {
                    icon: '25',
                    label: '0.001\u2033 LC',
                    sub: 'Imperial 25-division',
                    info: '<h3>0.001\u2033 Least Count (Imperial, 25 Divisions)</h3><p>The standard imperial vernier caliper. The main scale is divided into <strong>40ths of an inch</strong> (0.025\u2033 per division). The vernier has <strong>25 divisions</strong> spanning 24 main divisions.</p><div class="formula-box">LC = 1 MSD \u2212 1 VSD = 0.025\u2033 \u2212 24/25 \u00D7 0.025\u2033 = 0.025\u2033/25 = <strong>0.001\u2033</strong></div><p><strong>Example:</strong> MSR = 1.350\u2033, VSR = 14th division coincides.<br>TR = 1.350 + (14 \u00D7 0.001) = <strong>1.364\u2033</strong></p>'
                },
                {
                    icon: '8',
                    label: '1/128\u2033 LC',
                    sub: 'Fractional 8-division',
                    info: '<h3>1/128\u2033 Least Count (Fractional, 8 Divisions)</h3><p>The fractional-inch caliper, still standard in fitting, sheet-metal and fabrication work where drawings are dimensioned in halves, quarters, eighths and sixteenths. The beam is divided into <strong>sixteenths of an inch</strong>, and the vernier has <strong>8 divisions</strong> spanning 7 main divisions (7/16\u2033).</p><div class=\'formula-box\'>LC = 1 MSD \u2212 1 VSD = 1/16\u2033 \u2212 7/8 \u00D7 1/16\u2033 = 1/16\u2033 \u00F7 8 = <strong>1/128\u2033</strong></div><p><strong>Example:</strong> MSR = 1 5/16\u2033, VSR = 3rd division coincides.<br>TR = 1 5/16 + 3/128 = 1 40/128 + 3/128 = <strong>1 43/128\u2033</strong></p><p>Read it as a fraction, never as a decimal \u2014 that is the whole point of the scale.</p>'
                }
            ]
        },
        {
            cat: 'Zero Error',
            items: [{
                    icon: '\u2705',
                    label: 'No Zero Error',
                    sub: 'Zeros align perfectly',
                    info: '<h3>No Zero Error</h3><p>When the jaws are fully closed, the <strong>zero mark of the vernier scale aligns exactly</strong> with the zero mark of the main scale. This is the ideal condition.</p><ul><li>Close the jaws gently with no object</li><li>Check: vernier 0 should align with main scale 0</li><li>Also check: the last vernier division should align with a main scale mark</li></ul>'
                },
                {
                    icon: '\u2795',
                    label: 'Positive Error',
                    sub: 'Vernier zero to the right',
                    info: '<h3>Positive Zero Error</h3><p>When jaws are closed, the vernier zero is <strong>to the right</strong> of the main scale zero. The caliper reads <em>more</em> than the actual dimension.</p><div class="formula-box">Corrected Reading = Observed Reading \u2212 Zero Error</div><p><strong>Example:</strong> 3rd division coincides, LC = 0.02 mm.<br>Zero Error = +0.06 mm. If observed = 25.40 mm, corrected = <strong>25.34 mm</strong>.</p>'
                },
                {
                    icon: '\u2796',
                    label: 'Negative Error',
                    sub: 'Vernier zero to the left',
                    info: '<h3>Negative Zero Error</h3><p>When jaws are closed, the vernier zero is <strong>to the left</strong> of the main scale zero. The caliper reads <em>less</em> than the actual dimension.</p><div class="formula-box">Corrected Reading = Observed Reading + |Zero Error|</div><p><strong>Example:</strong> 47th division coincides (50-div scale), LC = 0.02 mm.<br>Zero Error = \u2212(50 \u2212 47) \u00D7 0.02 = \u22120.06 mm. If observed = 25.28 mm, corrected = <strong>25.34 mm</strong>.</p>'
                },
                {
                    icon: '\uD83D\uDD04',
                    label: 'Zero Correction',
                    sub: 'How to correct',
                    info: '<h3>Zero Error Correction</h3><ol><li>Close jaws gently without any object.</li><li>Check if vernier zero aligns with main scale zero.</li><li>If not, note which vernier division coincides with a main scale line.</li><li>Calculate:<ul><li>Vernier zero to the <em>right</em>: ZE = +(coincident div \u00D7 LC)</li><li>Vernier zero to the <em>left</em>: ZE = \u2212(n \u2212 coincident div) \u00D7 LC</li></ul></li><li>Corrected = Observed \u2212 Zero Error</li></ol>'
                }
            ]
        },
        {
            cat: 'Reading Method',
            items: [{
                    icon: '1\uFE0F\u20E3',
                    label: 'Step 1: MSR',
                    sub: 'Main Scale Reading',
                    info: '<h3>Step 1 \u2014 Main Scale Reading (MSR)</h3><p>Look at the <strong>zero line</strong> of the vernier scale. Read the main scale graduation <strong>immediately to the left</strong> of this zero line. This gives the whole-millimetre (SI) or 0.025\u2033 (imperial) reading.</p><p><strong>SI:</strong> MSR is in whole mm.<br><strong>Imperial:</strong> MSR is in multiples of 0.025\u2033.</p>'
                },
                {
                    icon: '2\uFE0F\u20E3',
                    label: 'Step 2: VSR',
                    sub: 'Vernier Scale Reading',
                    info: '<h3>Step 2 \u2014 Vernier Scale Reading (VSR)</h3><p>Find the <strong>one division</strong> on the vernier scale that aligns perfectly with <em>any</em> main scale graduation. The golden-highlighted tick in this simulator shows it.</p>' +
                        '<p><strong>Read the numerals carefully.</strong> A metric vernier is numbered in <strong>tenths of a millimetre</strong> \u2014 0 1 2 \u2026 9 0 \u2014 and the last numeral closes back on <strong>0</strong> because the whole vernier spans exactly 1 mm. Those numerals are <em>counting aids</em>, not the VSR.</p>' +
                        '<div class="formula-box">VSR = the number of DIVISIONS from the vernier zero</div>' +
                        '<p>So on a 0.02 mm scale, a line three divisions past the numeral <strong>4</strong> is division <strong>23</strong> (4 \u00d7 5 + 3), giving 23 \u00d7 0.02 = 0.46 mm. Count divisions, never numerals.</p>' +
                        '<p><strong>Tip:</strong> Use the Zoom feature to magnify the scale. In a 50-division vernier, adjacent ticks are very close.</p>'
                },
                {
                    icon: '3\uFE0F\u20E3',
                    label: 'Step 3: Calculate',
                    sub: 'TR = MSR + VSR \u00D7 LC',
                    info: '<h3>Step 3 \u2014 Calculate Total Reading</h3><div class="formula-box">TR = MSR + (VSR \u00D7 LC)</div><p><strong>SI Example (0.02 mm LC):</strong><br>MSR = 25 mm, VSR = 17 \u2192 TR = 25 + 0.34 = <strong>25.34 mm</strong></p><p><strong>Imperial Example (0.001\u2033 LC):</strong><br>MSR = 1.350\u2033, VSR = 14 \u2192 TR = 1.350 + 0.014 = <strong>1.364\u2033</strong></p>'
                },
                {
                    icon: '\u26A0\uFE0F',
                    label: 'Common Errors',
                    sub: 'Mistakes to avoid',
                    info: '<h3>Common Reading Errors</h3><ul><li><strong>Parallax error:</strong> Reading at an angle instead of straight down.</li><li><strong>Wrong MSR:</strong> Reading the mark to the <em>right</em> of vernier zero instead of left.</li><li><strong>Forcing alignment:</strong> Squeezing jaws too hard, deforming soft materials.</li><li><strong>Ignoring zero error:</strong> Not checking zero alignment before measuring.</li><li><strong>Estimating between divisions:</strong> Never interpolate \u2014 the reading is determined only by the coincident line.</li></ul>'
                }
            ]
        }
    ];

    function buildExplorePanel() {
        const catEl = $('explore-cats');
        const gridEl = $('explore-grid');
        const infoEl = $('explore-info');
        catEl.innerHTML = '';

        EXPLORE_DATA.forEach((cat, ci) => {
            const btn = document.createElement('button');
            btn.className = 'pill' + (ci === state.exploreCat ? ' active' : '');
            btn.textContent = cat.cat;
            btn.addEventListener('click', () => {
                state.exploreCat = ci;
                state.exploreIdx = 0;
                buildExplorePanel();
            });
            catEl.appendChild(btn);
        });

        // The "Parts & Components" category swaps the icon grid for the interactive
        // anatomy diagram.
        const cat = EXPLORE_DATA[state.exploreCat];
        const wrap = $('parts-wrap');
        if (cat.parts) {
            gridEl.style.display = 'none';
            infoEl.style.display = 'none';
            wrap.style.display = '';
            buildPartsPanel();
            return;
        }
        wrap.style.display = 'none';
        gridEl.style.display = '';
        infoEl.style.display = '';

        const items = cat.items;
        gridEl.innerHTML = '';
        items.forEach((item, ii) => {
            const btn = document.createElement('button');
            btn.className = 'is-btn' + (ii === state.exploreIdx ? ' active' : '');
            btn.innerHTML = `<span class="is-btn-icon">${item.icon}</span>
      <span class="is-btn-label">${item.label}</span>
      <span class="is-btn-sub">${item.sub}</span>`;
            btn.addEventListener('click', () => {
                state.exploreIdx = ii;
                buildExplorePanel();
            });
            gridEl.appendChild(btn);
        });

        infoEl.innerHTML = items[state.exploreIdx].info;
    }

    // ── Workpiece picker UI ───────────────────────────────────────────
    const WP_THUMBS = {
        bar: '<rect x="4" y="12" width="32" height="12" rx="2"/>',
        cylV: '<rect x="13" y="8" width="14" height="22" rx="1"/><ellipse cx="20" cy="8" rx="7" ry="2.6" opacity=".55"/>',
        cylH: '<rect x="5" y="13" width="30" height="12" rx="1"/><ellipse cx="35" cy="19" rx="2.6" ry="6" opacity=".55"/>',
        ball: '<circle cx="20" cy="19" r="10"/><circle cx="16" cy="15" r="2.6" fill="#0d1117" opacity=".45"/>',
        cube: '<rect x="9" y="8" width="22" height="22" rx="1.5"/><path d="M9 8h22l-4 4H13z" opacity=".45"/>',
        nut: '<path d="M20 6l10 6.5v13L20 32l-10-6.5v-13z"/><circle cx="20" cy="19" r="5" fill="#0d1117"/>',
        drill: '<rect x="16" y="6" width="8" height="24" rx="1"/><path d="M16 30h8l-4 4z"/>',
        plate: '<rect x="17" y="6" width="6" height="26" rx="1"/>',
        ring: '<path fill-rule="evenodd" d="M20 4a15 15 0 1 0 0 30 15 15 0 1 0 0-30zm0 8a7 7 0 1 1 0 14 7 7 0 1 1 0-14z"/>',
        // A sectioned block with the rod down the hole — the mode in one glyph.
        depth: '<path fill-rule="evenodd" d="M8 9h24v20H8zm4 5h13v10H12z"/>' +
            '<rect x="12" y="17.2" width="9" height="3.6" rx="1" fill="#0d1117"/>' +
            '<rect x="2" y="17.2" width="11" height="3.6" rx="1"/>'
    };

    function buildPicker() {
        const grid = $('obj-grid');
        if (!grid || grid.childElementCount) return;
        WORKPIECES.forEach(function(wp) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'obj-tile';
            b.setAttribute('data-id', wp.id);
            // The tile stays small enough to sit inside the canvas card (and shrinks to
            // the icon alone on phones), so the full description lives on the tooltip
            // and, once chosen, in the object bar underneath.
            const full = wp.name + ' — measure ' + wp.what +
                (wp.kind === 'internal' ? ' (inside jaws)' :
                    wp.kind === 'depth' ? ' (depth rod)' : '');
            b.title = full;
            b.setAttribute('aria-label', full);
            b.innerHTML =
                '<svg viewBox="0 0 40 38" aria-hidden="true" fill="#aab6c8">' + WP_THUMBS[wp.shape] + '</svg>' +
                '<span class="obj-tile-name">' + wp.short + '</span>' +
                (wp.kind === 'internal' || wp.kind === 'depth' ?
                    '<span class="obj-tile-dot" aria-hidden="true"></span>' : '');
            b.addEventListener('click', function() {
                loadWorkpiece(wp.id);
            });
            grid.appendChild(b);
        });
    }

    function togglePicker(open) {
        const pop = $('obj-picker');
        const fab = $('obj-fab');
        if (!pop) return;
        state.pickerOpen = (open === undefined) ? !state.pickerOpen : !!open;
        if (state.pickerOpen) buildPicker();
        pop.style.display = state.pickerOpen ? '' : 'none';
        fab.classList.toggle('active', state.pickerOpen);
        fab.setAttribute('aria-expanded', String(state.pickerOpen));
        syncPickerSelection();
    }

    function syncPickerSelection() {
        const grid = $('obj-grid');
        if (!grid) return;
        grid.querySelectorAll('.obj-tile').forEach(function(t) {
            t.classList.toggle('active', !!state.wp && t.getAttribute('data-id') === state.wp.id);
        });
    }

    // Ease the head to a target opening. Used to throw the jaws wide open when a
    // part is dropped in, and to close them onto it from the object bar.
    // Any hands-on input wins over an in-flight glide — otherwise grabbing the jaws
    // while a part is still being loaded would fight the animation.
    function cancelGlide() {
        if (state.wpRaf) {
            cancelAnimationFrame(state.wpRaf);
            state.wpRaf = null;
        }
    }

    function glideJawsTo(target, onDone) {
        // A programmatic move is the tool driving the instrument, not the visitor's
        // hand. Blocking it would deadlock loading a part; release the screw instead.
        setLocked(false, true);
        cancelGlide();
        const from = state.mm;
        const dist = Math.abs(target - from);
        // A hidden tab suspends requestAnimationFrame, which would leave the head
        // parked mid-glide; jump straight to the target instead.
        if (dist < 1e-6 || document.hidden) {
            setMm(target);
            render();
            if (onDone) onDone();
            return;
        }
        const dur = clamp(220 + dist * 9, 260, 900);
        const t0 = performance.now();
        (function step(t) {
            // Clamped BELOW as well as above. A rAF timestamp is the frame's start
            // time, which can precede the performance.now() taken in the handler that
            // started the glide; a negative k through the cubic ease throws the head
            // PAST its starting point, beyond full scale, for a frame.
            const k = Math.max(0, Math.min(1, (t - t0) / dur));
            const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
            state.mm = from + (target - from) * e;
            render();
            if (k < 1) state.wpRaf = requestAnimationFrame(step);
            else {
                state.wpRaf = null;
                setMm(target);
                render();
                if (onDone) onDone();
            }
        })(t0);
    }

    function loadWorkpieceObj(wp, silent) {
        if (!wp) return;
        state.wp = wp;
        // The part has to be in shot to be closed onto. The zoomed view is framed on
        // the coincidence line and a press never starts a drag while zoomed, so a
        // zoom carried over from a Quiz scale question left the next object question
        // with jaws that could not be moved and a Submit that never enabled.
        closeZoom();
        // Bring the head inside the new part's legal range at once. Without this a bore
        // loaded while the jaws are wider than it would sit — and report contact —
        // outside the range the clamp is meant to guarantee.
        setMm(state.mm);
        if (!silent) playClick();
        $('drag-hint').classList.add('hidden');
        state.hinted = true;
        objBarSig = '';
        updateObjBar();
        syncPickerSelection();
        // Start where the real sequence starts: an external part goes in with the jaws
        // thrown fully open and you close onto it; a bore starts with the inside jaws
        // shut and you open them until they touch the wall.
        glideJawsTo((wp.kind === 'internal' || wp.kind === 'depth') ? wpMinMm() : getMaxMm(),
            updateObjBar);
        v3dNewQuestion();
    }

    function loadWorkpiece(id) {
        const wp = findWp(id);
        if (!wp) return;
        togglePicker(false);
        loadWorkpieceObj(wp);
    }

    // The jaws are draggable in Simulate, and in a graded mode whenever a part is
    // loaded — otherwise the student could not close onto it.
    // The walkthrough describes ONE reading. Let the jaws move under it and every
    // stage it has already drawn becomes a lie, so the instrument is frozen.
    function canDragJaws() {
        return !teach.on && !state.locked && (state.mode === 'free' || !!state.wp);
    }

    // Called every frame: a graded answer may only be submitted once the jaws are
    // actually on the part, so the button follows the contact state.
    function syncExerciseUi() {
        if (!state.wp) return;
        const contact = wpInContact();
        if (state.mode === 'practice' && !state.answered) {
            const btn = $('btn-check');
            if (btn && btn.disabled === contact) btn.disabled = !contact;
        } else if (state.mode === 'quiz' && !state.quizAnswered) {
            const btn = $('btn-quiz-submit');
            if (btn && btn.disabled === contact) btn.disabled = !contact;
        }
    }

    function clearWorkpiece() {
        cancelGlide();
        state.wp = null;
        objBarSig = '';
        // Taking the part out hands Practice back to the Play/Pause drill.
        if (state.mode === 'practice') {
            $('btn-play').disabled = false;
            $('caliper-card').style.cursor = 'default';
        }
        updateObjBar();
        syncPickerSelection();
        v3dNewQuestion();
        render();
    }

    function snapToContact() {
        if (!state.wp) return;
        glideJawsTo(state.wp.mm, function() {
            playContact();
            updateObjBar();
        });
    }

    let objBarSig = '';

    function updateObjBar() {
        const bar = $('obj-bar');
        if (!bar) return;
        const wp = state.wp;
        const fab = $('obj-fab');
        if (fab) fab.classList.toggle('loaded', !!wp);
        if (!wp || state.mode === 'explore') {
            bar.style.display = 'none';
            objBarSig = '';
            return;
        }
        bar.style.display = '';

        const contact = wpInContact();
        const reveal = wpRevealAllowed();
        // The bar is rebuilt from innerHTML, so skip it unless something it shows has
        // actually changed — otherwise a drag would re-render it at 60 fps.
        const sig = [wp.id, contact, reveal, state.mode, state.prec, state.impPrec, state.unit,
            state.zeOn, state.zeLc, (contact && reveal) ? fmtTr() : ''
        ].join('|');
        if (sig === objBarSig) return;
        objBarSig = sig;

        const u = uLabel();
        // The TRUE size stays decimal on the fractional caliper: a real part is not a
        // tidy fraction, and printing it as one would hide the very gap the
        // "cannot resolve" note is there to teach.
        const trueDisp = isImperial() ?
            (wp.mm * MM_TO_IN).toFixed(impFractional() ? 4 : 3) :
            wp.mm.toFixed(2);
        const readDisp = fmtTr();
        // What the instrument can actually resolve: the true size rounded to the LC.
        const resolvable = Math.round(wp.mm / getLcMm()) * getLcMm();
        const resDisp = isImperial() ? fmtDispValue(resolvable * MM_TO_IN) : resolvable.toFixed(2);
        const unresolved = Math.abs(resolvable - wp.mm) > 1e-9;

        const internal = wpIsInternal();
        const depth = wpIsDepth();
        let status;
        if (!contact) {
            status = '<span class="ob-state ob-open">' +
                (depth ? 'Rod above the hole' : internal ? 'Jaws inside the bore' : 'Jaws open') + '</span>' +
                '<span class="ob-msg">' + (depth ?
                    'Sit the <strong>end of the beam</strong> across the mouth of the hole, then drag the sliding jaw <strong>right</strong> to wind the rod down until it touches the bottom.' :
                    internal ?
                    'Drag the sliding jaw <strong>right</strong> to open the inside jaws until both nibs touch the bore wall.' :
                    'Drag the sliding jaw left until it stops on the part.') + '</span>';
        } else if (!reveal) {
            // Graded attempt: confirm contact, but the reading itself is the answer.
            status = '<span class="ob-state ob-contact">&#10003; ' +
                (depth ? 'Rod on the bottom' : 'Jaws in contact') + '</span>' +
                '<span class="ob-msg">Now read the scale and type your answer' +
                (state.zeOn ? ', applying the zero-error correction.' : '.') + '</span>';
        } else {
            status = '<span class="ob-state ob-contact">&#10003; ' +
                (depth ? 'Rod on the bottom' : 'Jaws in contact') + '</span>' +
                '<span class="ob-msg">Read the scale: <strong>' + readDisp + ' ' + u + '</strong>' +
                (state.zeOn ? ' &mdash; then apply the zero-error correction.' : '.') + '</span>';
        }

        let lesson = '';
        if (!reveal) {
            lesson = '';
        } else if (contact && unresolved) {
            lesson = '<div class="ob-lesson"><strong>Resolution limit:</strong> the part is truly ' +
                trueDisp + ' ' + u + ', but a ' + fmtLc() + ' ' + u +
                ' vernier can only resolve it to <strong>' + resDisp + ' ' + u +
                '</strong>. Switch to a finer least count to close the gap.</div>';
        } else if (contact && state.zeOn) {
            lesson = '<div class="ob-lesson"><strong>Zero error is on:</strong> the scale shows ' + readDisp +
                ' ' + u + '. Subtract the zero error and you are back to the true ' + trueDisp + ' ' + u + '.</div>';
        }

        bar.innerHTML =
            '<div class="ob-head">' +
            '<svg class="ob-thumb" viewBox="0 0 40 38" aria-hidden="true" fill="#aab6c8">' + WP_THUMBS[wp.shape] + '</svg>' +
            '<div class="ob-id"><span class="ob-name">' + wp.name + '</span>' +
            '<span class="ob-what">Measuring ' + wp.what + '</span></div>' +
            '<div class="ob-status">' + status + '</div>' +
            '<div class="ob-actions">' +
            '<button type="button" class="ob-btn" id="ob-snap"' + (contact ? ' disabled' : '') + '>' +
            (depth ? '&#8681; Wind rod to the bottom' :
                internal ? '&#8676;&#8677; Open onto bore' :
                '&#8677; Close onto part') + '</button>' +
            // In Quiz the question owns the part, so it cannot be taken out.
            (state.mode === 'quiz' ? '' :
                '<button type="button" class="ob-btn ob-btn-x" id="ob-clear">Remove</button>') +
            '</div>' +
            '</div>' +
            '<div class="ob-note">' + wp.note + '</div>' + lesson;

        var s = $('ob-snap');
        if (s) s.addEventListener('click', snapToContact);
        var c = $('ob-clear');
        if (c) c.addEventListener('click', clearWorkpiece);
    }

    // ── Mode / precision / unit ──────────────────────────────────────
    function setMode(mode) {
        // A walkthrough belongs to ONE reading in ONE mode. Leaving it running across
        // a mode change is how it would end up narrating the answer to a quiz item.
        if (teach.on) teachStop();
        state.mode = mode;
        $('practice-bar').style.display = 'none';
        $('quiz-bar').style.display = 'none';
        $('quiz-result').style.display = 'none';
        $('sec-explore').style.display = 'none';

        const showCanvas = (mode !== 'explore');
        $('caliper-card').style.display = showCanvas ? '' : 'none';
        document.querySelector('.info-row').style.display = showCanvas ? '' : 'none';

        // The picker FAB is Simulate-only: Practice loads parts from its own button
        // and Quiz assigns them per question, so neither needs a free-choice picker.
        togglePicker(false);
        $('obj-fab').style.display = (mode === 'free') ? '' : 'none';
        if (mode !== 'free' && state.wp) clearWorkpiece();
        updateObjBar();

        if (mode === 'explore') {
            buildExplorePanel();
            $('sec-explore').style.display = '';
        } else if (mode === 'practice') {
            $('practice-bar').style.display = '';
            $('caliper-card').style.cursor = 'default';
            state.dragging = false;
            newQuiz();
        } else if (mode === 'quiz') {
            $('caliper-card').style.cursor = 'default';
            state.dragging = false;
            startQuiz();
        } else {
            if (state.playing) stopAnim();
            $('caliper-card').style.cursor = 'grab';
            $('readout-display').style.display = 'block';
            $('practice-input').style.display = 'none';
            $('dr-label').textContent = 'Measurement';
            $('reading-cells').classList.remove('cells-hidden');
            $('tr-formula').classList.remove('formula-hidden');
            render();
        }
        /* An answer box typed into in Practice or the quiz keeps the caret. A tab
           that does not take focus itself (Safari does not focus a clicked button)
           left it there, inside a panel that is now hidden — and the shortcut
           handler ignores keys typed into an input, so the Show me How? keys (Space,
           ← / →, Esc) did nothing until something else was clicked. */
        var fe = document.activeElement;
        /* getClientRects, not offsetParent: a position:fixed box (fullscreen) has no offsetParent either */
        if (fe && fe !== document.body && !fe.getClientRects().length && typeof fe.blur === 'function') fe.blur();
    }

    function setPrecision(prec) {
        if (isImperial()) state.impPrec = prec;
        else state.prec = prec;
        state.zeLc = clampZeLc(state.zeLc);
        setMm(snapToLc(state.mm));
        syncAnswerInput();
        if (state.mode === 'practice') newQuiz();
        else if (state.mode === 'quiz') startQuiz();
        else render();
    }

    function setUnit(unit) {
        if (teach.on) teachStop(); // the stages were built for the old instrument
        state.unit = unit;
        setMm(snapToLc(state.mm));
        state.zeLc = clampZeLc(state.zeLc);
        updatePrecisionUI();
        syncAnswerInput();
        syncBeamUnitUi(); // the mm|cm pair is SI-only
        if (state.mode === 'practice') newQuiz();
        else if (state.mode === 'quiz') startQuiz();
        else render();
    }

    function setZeroError(on) {
        state.zeOn = !!on;
        if (!state.zeOn) state.zeLc = 0;
        document.querySelectorAll('#ze-toggle .pill').forEach(function(b) {
            b.classList.toggle('active', b.dataset.value === (state.zeOn ? 'on' : 'off'));
        });
        if (state.mode === 'practice') newQuiz();
        else if (state.mode === 'quiz') startQuiz();
        else render();
    }

    function bumpZe(delta) {
        if (!state.zeOn) return;
        state.zeLc = clampZeLc(state.zeLc + delta);
        if (state.mode === 'practice') newQuiz();
        else if (state.mode === 'quiz') startQuiz();
        else render();
    }

    // Each unit system has its own set of least counts, and BOTH are real
    // instruments — three metric verniers, two inch verniers. The pill row is
    // rebuilt on every unit switch rather than hidden.
    const PREC_SETS = {
        si: [
            ['0.05', '0.05 mm'],
            ['0.02', '0.02 mm'],
            ['0.1', '0.1 mm']
        ],
        imperial: [
            ['0.001', '0.001\u2033'],
            ['1/128', '1/128\u2033']
        ]
    };

    function updatePrecisionUI() {
        const tabs = $('precision-tabs');
        if (!tabs) return;
        const precGroup = tabs.closest('.ctrl-group');
        if (precGroup) precGroup.style.display = '';

        const set = PREC_SETS[isImperial() ? 'imperial' : 'si'];
        const cur = isImperial() ? state.impPrec : state.prec;
        tabs.innerHTML = '';
        set.forEach(function(p) {
            const b = document.createElement('button');
            b.className = 'pill' + (p[0] === cur ? ' active' : '');
            b.dataset.value = p[0];
            b.textContent = p[1];
            tabs.appendChild(b);
        });
    }

    // What the answer box must accept, and what it should say when it doesn't.
    function syncAnswerInput() {
        const el = $('practice-input');
        if (!el) return;
        const frac = impFractional();
        // Always a text box: <input type=number> silently refuses a typed "." (reads
        // back "") under comma-decimal locales and some mobile keyboards, so a visitor
        // could not enter 12.34 at all. The decimal keypad is kept via inputmode.
        el.type = 'text';
        if (frac) {
            el.removeAttribute('step');
            el.removeAttribute('max');
            el.removeAttribute('min');
            el.setAttribute('inputmode', 'text');
            el.placeholder = '1 3/16';
        } else {
            el.setAttribute('inputmode', 'decimal');
            el.removeAttribute('step');
            el.removeAttribute('max');
            el.removeAttribute('min');
            el.placeholder = isImperial() ? '?.???' : '??.??';
        }
    }

    function answerHint() {
        if (impFractional()) return 'Enter a fraction, e.g. 1 3/16 or 27/128.';
        if (isImperial()) return 'Enter a valid number (e.g. 1.364).';
        return 'Enter a valid number (e.g. 23.45).';
    }

    // ── Drag ──────────────────────────────────────────────────────────
    function getCanvasX(e) {
        const rect = cEl.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        // Map to LOGICAL canvas units (S.CW), not the DPR-scaled backing-store width —
        // we draw in logical space via setTransform(DPR). (graphics-upgrade B1 lockstep)
        return (clientX - rect.left) * (S.CW / rect.width);
    }

    // A first-run tip is in the way the moment the visitor has started, however
    // they started. This used to fire only from the pointer path, so anyone driving
    // the instrument from the keyboard read the tip for the whole session.
    function dismissHint() {
        if (state.hinted) return;
        state.hinted = true;
        var h = $('drag-hint');
        if (h) h.classList.add('hidden');
    }

    /* [VC-LOCK-BEGIN] ── The locking screw, as a real control ──────────
       ONE geometry funnel and ONE state funnel.

       The nut is PIXELS in assets/vernier1.png — knurled body at x 102-137,
       y 48-68 in head-composite local coordinates, with its stem down to y 74 —
       so its screen position is derived from the very same vernierImgX / vernierImgY
       the head composite is drawn at. Never a second copy of those offsets: the
       head slides with the reading, and a hand-placed rectangle would drift off
       the nut the moment the jaws opened.

       Everything below works in SPRITE space, i.e. before the one PAD_TOP
       translate the draw pass applies. hitLockNut() subtracts it once. */
    const LOCK_HIT = {
        x: 98,
        y: 43,
        w: 44,
        h: 33
    }; // padded to the site's 44px tap floor
    const LOCK_BODY = {
        x: 102,
        y: 48,
        w: 36,
        h: 21
    }; // the knurled head itself
    const LOCK_FLASH_MS = 900;

    function lockNutRect() {
        const vx = S.scaleOriginX - S.offsetOriginX + getShiftPx() - S.vernierOriginX;
        const vy = S.scaleOriginY - S.vernierOriginY;
        return {
            x: vx + LOCK_HIT.x,
            y: vy + LOCK_HIT.y,
            w: LOCK_HIT.w,
            h: LOCK_HIT.h,
            bx: vx + LOCK_BODY.x,
            by: vy + LOCK_BODY.y,
            bw: LOCK_BODY.w,
            bh: LOCK_BODY.h
        };
    }

    // The nut is a control only at 1x and outside the walkthrough — the same states
    // the jaws themselves are draggable in. Zoomed, the canvas edge is not where
    // S.CW says it is and the sprite rect would point at the wrong pixels.
    function lockNutLive() {
        return !teach.on && !state.zoomOpen && teachZoomBlend() === 0 && imagesLoaded >= 5;
    }

    function getCanvasY(e) {
        const rect = cEl.getBoundingClientRect();
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return (clientY - rect.top) * (S.CH_OUT / rect.height);
    }

    function hitLockNut(e) {
        if (!lockNutLive()) return false;
        const r = lockNutRect();
        const x = getCanvasX(e),
            y = getCanvasY(e) - S.PAD_TOP;
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    // The ONLY writer of state.locked. Both entry points — the nut on the canvas
    // and the toolbar button — come through here, so the two can never disagree
    // about which way the screw is turned.
    function setLocked(v, silent) {
        v = !!v;
        if (state.locked === v) {
            syncLockUi();
            return;
        }
        state.locked = v;
        state.dragging = false;
        state.lockFlash = 0;
        if (!silent) {
            playClick();
            announceLock(v ? 'Jaws locked.' : 'Jaws released.');
        }
        syncLockUi();
        render();
    }

    function announceLock(msg) {
        const live = $('teach-live');
        if (live) live.textContent = msg;
    }

    function syncLockUi() {
        const btn = $('btn-lock');
        if (btn) {
            btn.classList.toggle('active', state.locked);
            btn.setAttribute('aria-pressed', state.locked ? 'true' : 'false');
            btn.title = state.locked ?
                'Release the locking screw so the jaws can move' :
                'Tighten the locking screw to freeze the reading';
            btn.setAttribute('aria-label', state.locked ? 'Unlock jaws' : 'Lock jaws');
            btn.innerHTML = (state.locked ? '&#128274;' : '&#128275;') +
                '<span class="zt-lbl">&nbsp;' + (state.locked ? 'Locked' : 'Lock') + '</span>';
        }
        syncCursor();
    }

    // The card's cursor has three claimants — the lock nut, a draggable jaw and
    // everything else — so it is resolved in one place rather than by whichever
    // handler fired last.
    function syncCursor() {
        const card = $('caliper-card');
        if (!card) return;
        if (state.lockHover) card.style.cursor = 'pointer';
        // 'ew-resize': the roller's click halves are LEFT and RIGHT and its drag is
        // horizontal, so a vertical cursor would promise a gesture that does nothing.
        else if (state.wheelHover) card.style.cursor = 'ew-resize';
        else if (state.locked) card.style.cursor = 'not-allowed';
        else if (canDragJaws()) card.style.cursor = state.dragging ? 'grabbing' : 'grab';
        else card.style.cursor = 'default';
    }

    // A silent refusal is the confusion this feature exists to remove: every
    // blocked attempt says so, on the canvas AND to a screen reader.
    let lockFlashRaf = null;

    function nudgeLocked() {
        state.lockFlash = performance.now();
        announceLock('The jaws are locked. Release the locking screw to move them.');
        if (lockFlashRaf) return;
        (function step() {
            const k = (performance.now() - state.lockFlash) / LOCK_FLASH_MS;
            if (k >= 1) {
                lockFlashRaf = null;
                state.lockFlash = 0;
                render();
                return;
            }
            render();
            lockFlashRaf = requestAnimationFrame(step);
        })();
    }

    function lockFlashK() {
        if (!state.lockFlash) return 0;
        return Math.max(0, 1 - (performance.now() - state.lockFlash) / LOCK_FLASH_MS);
    }

    // Painted in sprite space, immediately after the head composite it belongs to.
    function drawLockNut() {
        if (!lockNutLive()) return;
        const r = lockNutRect();
        const flash = lockFlashK();
        const cx = r.bx + r.bw / 2,
            cy = r.by + r.bh / 2;

        // A locked screw is a TIGHTENED screw: the nut seats 1px down onto the head.
        const seat = state.locked ? 1 : 0;

        if (state.locked || state.lockHover || flash > 0) {
            const warn = flash > 0;
            // Pulse only while refusing; a steady ring otherwise, so "locked" is
            // readable at a glance without anything moving on the page.
            const a = warn ? 0.35 + 0.65 * Math.abs(Math.sin(performance.now() / 110)) :
                (state.locked ? 0.92 : 0.65);
            ctx.save();
            ctx.strokeStyle = warn ? 'rgba(255,107,107,' + a + ')' :
                state.locked ? 'rgba(255,193,7,' + a + ')' :
                'rgba(79,142,247,' + a + ')';
            ctx.lineWidth = warn ? 2.6 : 2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(r.bx - 3, r.by - 3 + seat, r.bw + 6, r.bh + 6, 4);
            else ctx.rect(r.bx - 3, r.by - 3 + seat, r.bw + 6, r.bh + 6);
            ctx.stroke();
            ctx.restore();
        }

        // Padlock glyph on the nut itself while locked — the state survives the
        // pointer leaving the canvas, and reads on a phone where there is no hover.
        if (state.locked) {
            ctx.save();
            ctx.translate(cx, cy + seat);
            ctx.fillStyle = 'rgba(12,16,22,0.72)';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-8, -8, 16, 16, 4);
            else ctx.rect(-8, -8, 16, 16);
            ctx.fill();
            ctx.strokeStyle = '#ffd970';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(0, -2.2, 3.1, Math.PI, 0);
            ctx.stroke(); // shackle
            ctx.fillStyle = '#ffd970';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(-4.4, -2.2, 8.8, 7, 1.4);
            else ctx.rect(-4.4, -2.2, 8.8, 7);
            ctx.fill();
            ctx.restore();
        }

        // Chip above the nut: what a click will do, or why the jaws did not move.
        let chip = null,
            tone = '#8ab4ff';
        if (flash > 0) {
            chip = 'Jaws locked — click to release';
            tone = '#ff6b6b';
        } else if (state.lockHover) {
            chip = state.locked ? 'Click to unlock' : 'Click to lock';
            tone = state.locked ? '#ffd970' : '#8ab4ff';
        }
        if (!chip) return;

        ctx.save();
        ctx.font = 'bold 9pt sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(chip).width + 16;
        // The nut travels the whole beam, so the chip must be held inside the canvas
        // or it runs off the right-hand edge at full opening.
        const tx = clamp(cx, w / 2 + 4, S.CW - w / 2 - 4);
        const ty = r.by - 16;
        ctx.fillStyle = 'rgba(8,12,18,0.92)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tx - w / 2, ty - 10, w, 20, 6);
        else ctx.rect(tx - w / 2, ty - 10, w, 20);
        ctx.fill();
        ctx.strokeStyle = tone;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = tone;
        ctx.fillText(chip, tx, ty);
        ctx.restore();
    }

    // Hover. Only re-renders when the hover state actually CHANGES — otherwise a
    // pointer moving across the canvas would repaint the instrument at 60fps.
    function onLockHover(e) {
        if (state.dragging) return;
        // Same order as the press, or the cursor promises what the click will not do.
        const overLock = hitLockNut(e);
        const overWheel = !overLock && hitWheel(e);
        const dir = overWheel ? wheelDir(e) : 0;
        if (overLock === state.lockHover && overWheel === state.wheelHover &&
            dir === state.wheelActiveDir) return;
        state.lockHover = overLock;
        state.wheelHover = overWheel;
        state.wheelActiveDir = dir;
        if (overWheel) wheelBlinkStart();
        else wheelBlinkStop();
        syncCursor();
        render();
    }
    /* [VC-LOCK-END] */

    /* [VC-WHEEL-BEGIN] ── Fine adjustment thumb roller ────────────────
       The tool has documented this part since it shipped — the parts explorer
       carries "Thumb Roller (Fine Adjustment)" as part 8, with a panel on jaw
       pressure, and three workpiece notes tell the student to "close with the
       thumb roller" — while the canvas has never drawn one. This builds the part
       the tool already teaches.

       It is also the fix for the drag resolution. getPxPerMm() is 5.2, so one
       LOGICAL canvas pixel is 0.192 mm, and once the canvas is scaled to fit a
       card that is roughly double per CSS pixel:

         0.02 mm    19.4 divisions per CSS px     0.001in   15.3
         0.05 mm     7.8                          1/128in    2.0  (already fine)
         0.1 mm      3.9

       On the two fine instruments the jaws could not be placed on a chosen
       division by hand at all. On the bench you close the last little bit with
       this roller, so that is what it does here. */
    const WHEEL_R = 16;
    const WHEEL_TEETH = 34; // straight knurl round the rim, ~3 px pitch
    // CSS px of drag per least count when the drag STARTS on the roller. Measured
    // in CSS px, not logical px, so the feel is identical whether the canvas
    // renders at its full 923 px or squeezed onto a phone.
    const WHEEL_PX_PER_LC = 3;

    const WHEEL_HOLD_MS = 500; // tap vs hold
    const WHEEL_RAMP = [140, 140, 140, 90, 90, 60, 60, 40]; // then 40 forever
    const WHEEL_MAX_HOLD_MS = 20000; // hard stop if a pointerup is missed

    const COARSE_POINTER = !!(window.matchMedia &&
        window.matchMedia('(pointer: coarse)').matches);

    // ANCHORED TO THE HEAD'S RIGHT CAP, not to the index line. getVernierStripPx()
    // sizes the head to the vernier it carries — about 334 px in metric but only
    // ~158 px in imperial — so a fixed offset from the index would put the roller
    // off the casting on one of the two. The LC badge already anchors this way.
    // The left of the skirt is spoken for in any case: this tool prints the vernier
    // NUMERALS at y 172, right across the band the roller would otherwise sit in.
    function wheelPos() {
        const vx = S.scaleOriginX - S.offsetOriginX + getShiftPx() - S.vernierOriginX;
        return {
            cx: vx + getVernierStripPx() - 30,
            cy: 184,
            r: WHEEL_R
        };
    }

    // Hit test, padded to the site's 44px tap floor in CSS px. Touches the DOM, so
    // it is never called from draw(). The floor is for FINGERTIPS: applying it to a
    // mouse turns a 16px roller into a 44px target whose halves are mostly bare
    // skirt, so a press meant as a coarse drag steps the jaws instead.
    function wheelRect() {
        const w = wheelPos();
        const perCss = S.CW / Math.max(1, cEl.getBoundingClientRect().width);
        const half = COARSE_POINTER ? Math.max(WHEEL_R + 4, 22 * perCss) : WHEEL_R + 5;
        return {
            cx: w.cx,
            cy: w.cy,
            r: w.r,
            x: w.cx - half,
            y: w.cy - half,
            w: half * 2,
            h: half * 2
        };
    }

    function wheelLive() {
        return !teach.on && !state.zoomOpen && teachZoomBlend() === 0 && imagesLoaded >= 5;
    }

    function hitWheel(e) {
        if (!wheelLive() || state.locked) return false;
        const r = wheelRect();
        const x = getCanvasX(e),
            y = getCanvasY(e) - S.PAD_TOP;
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    // LEFT closes, RIGHT opens — the same sense as dragging the slider and as the
    // arrow keys. The jaws travel horizontally, so a top/bottom split on a
    // horizontal motion would make half of every click a surprise.
    function wheelDir(e) {
        return getCanvasX(e) < wheelRect().cx ? -1 : 1;
    }

    // The roller RIDES the beam's lower edge: its top touches the beam (cy - r =
    // 168, the beam's bottom land), so its angle is a pure FUNCTION of where the
    // head is drawn and draw() stays pure. No slip at the contact point means the
    // point touching the beam is momentarily still while the centre moves with the
    // head, so opening the jaws (+x) turns the roller ANTICLOCKWISE — the opposite
    // of a wheel rolling along a floor — at one radian per radius of travel. It
    // used to turn clockwise at 4 mm per turn, which is five times its own
    // circumference: a roller skidding backwards along the beam.
    function wheelAngle() {
        return -getShiftPx() / WHEEL_R;
    }

    // One least count per click, exactly — the whole point of the control.
    function wheelStep(dir) {
        cancelGlide();
        dismissHint();
        const wasContact = wpInContact();
        const before = state.mm;
        setMm(snapToLc(state.mm + dir * getLcMm()));
        if (state.mm !== before) playTick();
        if (!wasContact && wpInContact()) playContact();
        render();
    }

    // Hold to keep feeding. Clicking forty times to cross forty divisions is the
    // defect shared/press-repeat.js exists to fix on the DOM steppers, so this uses
    // that module's EXACT timing rather than inventing a second feel. The module
    // itself cannot be reused: it finds BUTTONS in the DOM, and this is canvas.
    let wheelHold = {
        timer: null,
        dir: 0,
        fired: 0,
        startedAt: 0
    };

    function wheelHoldStop() {
        if (wheelHold.timer) {
            clearTimeout(wheelHold.timer);
            wheelHold.timer = null;
        }
        wheelHold.dir = 0;
    }

    function wheelHoldStart(dir) {
        wheelHoldStop();
        wheelHold.dir = dir;
        wheelHold.fired = 0;
        wheelHold.startedAt = performance.now();
        wheelHold.timer = setTimeout(function tick() {
            // Stop at the end of the travel rather than spinning against the stop: once
            // the reading cannot change, every further tick is a lie about the
            // instrument moving. Also covers a workpiece holding the jaws.
            const before = state.mm;
            wheelStep(wheelHold.dir);
            if (state.mm === before) {
                wheelHoldStop();
                return;
            }
            wheelHold.fired++;
            if (performance.now() - wheelHold.startedAt > WHEEL_MAX_HOLD_MS) {
                wheelHoldStop();
                return;
            }
            const i = Math.min(wheelHold.fired, WHEEL_RAMP.length - 1);
            wheelHold.timer = setTimeout(tick, WHEEL_RAMP[i]);
        }, WHEEL_HOLD_MS);
    }

    // mm of jaw travel per LOGICAL canvas pixel of drag. A drag off the roller
    // keeps the 1:1 traverse, which is right for crossing the beam; a drag FROM it
    // gets the fine feed, whose gain is fixed in CSS px so it feels the same at
    // 923 px and at 458.
    function dragMmPerPx() {
        if (!state.dragFine) return 1 / getPxPerMm();
        const rect = cEl.getBoundingClientRect();
        const cssPerLogical = rect.width > 0 ? rect.width / S.CW : 1;
        return getLcMm() * cssPerLogical / WHEEL_PX_PER_LC;
    }

    // Satin steel, matching the re-shaded sprites the roller sits against.
    function wheelMetal(y0, y1) {
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, '#8e97a1');
        g.addColorStop(0.28, '#dbe2ea');
        g.addColorStop(0.58, '#9aa3ad');
        g.addColorStop(1, '#5b626b');
        return g;
    }

    function drawThumbwheel() {
        if (imagesLoaded < 5) return;
        const w = wheelPos(),
            cx = w.cx,
            cy = w.cy,
            r = w.r;
        const hot = state.wheelHover && wheelLive() && !state.locked;
        const TAU = Math.PI * 2;
        const a0 = wheelAngle();

        // Seen FACE ON: a straight-knurled rim shows as a serrated edge, and the teeth
        // are the only part that visibly turns. The face is flat and the axle rivet
        // is fixed to the head, so neither carries the rotation.
        function rimPath() {
            ctx.beginPath();
            for (let i = 0; i < WHEEL_TEETH; i++) {
                const t0 = a0 + i * TAU / WHEEL_TEETH,
                    p = TAU / WHEEL_TEETH;
                ctx.lineTo(cx + Math.cos(t0) * (r - 1.2), cy + Math.sin(t0) * (r - 1.2));
                ctx.lineTo(cx + Math.cos(t0 + p * 0.22) * r, cy + Math.sin(t0 + p * 0.22) * r);
                ctx.lineTo(cx + Math.cos(t0 + p * 0.55) * r, cy + Math.sin(t0 + p * 0.55) * r);
                ctx.lineTo(cx + Math.cos(t0 + p * 0.77) * (r - 1.2), cy + Math.sin(t0 + p * 0.77) * (r - 1.2));
            }
            ctx.closePath();
        }

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 3;
        rimPath();
        ctx.fillStyle = wheelMetal(cy - r, cy + r);
        ctx.fill();
        ctx.restore();
        rimPath();
        ctx.strokeStyle = 'rgba(20,26,34,0.55)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Flat turned face inside the knurl, with a fine chamfer ring at its edge.
        const fr = r - 3.2;
        const face = ctx.createLinearGradient(cx - fr, cy - fr, cx + fr, cy + fr);
        face.addColorStop(0, '#d9e0e8');
        face.addColorStop(0.55, '#a3acb6');
        face.addColorStop(1, '#6d757f');
        ctx.fillStyle = face;
        ctx.beginPath();
        ctx.arc(cx, cy, fr, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(cx, cy, fr - 0.5, Math.PI * 0.75, Math.PI * 1.75);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.40)';
        ctx.beginPath();
        ctx.arc(cx, cy, fr - 0.5, Math.PI * 1.75, Math.PI * 2.75);
        ctx.stroke();

        // Axle rivet: a small dome, lit from the upper left like everything else.
        const rr = r * 0.3;
        const dome = ctx.createRadialGradient(cx - rr * 0.35, cy - rr * 0.4, 0.5, cx, cy, rr);
        dome.addColorStop(0, '#f2f5f8');
        dome.addColorStop(0.6, '#9aa3ad');
        dome.addColorStop(1, '#4e555e');
        ctx.fillStyle = dome;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        if (hot) {
            ctx.strokeStyle = 'rgba(79,142,247,0.95)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r + 1.5, 0, TAU);
            ctx.stroke();
        }

        if (!hot) return;
        // The arrow under the pointer — the one a click would drive — blinks amber,
        // so "which way is this about to go" is answered on the control itself.
        const active = state.wheelActiveDir;
        const blink = 0.45 + 0.55 * Math.abs(Math.sin(performance.now() / 190));
        ctx.save();
        [-1, 1].forEach(function(sgn) {
            ctx.fillStyle = (sgn === active) ?
                'rgba(255,217,112,' + blink.toFixed(3) + ')' :
                'rgba(138,180,255,0.55)';
            const x = cx + sgn * (r + 9);
            ctx.beginPath();
            ctx.moveTo(x + sgn * 5, cy);
            ctx.lineTo(x - sgn * 3, cy - 5);
            ctx.lineTo(x - sgn * 3, cy + 5);
            ctx.closePath();
            ctx.fill();
        });
        ctx.restore();
        wheelChip(cx, cy - r - 20, 'Click: 1 division  ·  hold: repeat  ·  drag: fine');
    }

    function wheelChip(cx, cy, txt) {
        ctx.save();
        ctx.font = 'bold 9pt sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(txt).width + 16;
        // The roller travels the whole beam, so the chip is held inside the canvas or
        // it runs off the right-hand edge at full opening.
        const tx = Math.max(w / 2 + 4, Math.min(S.CW - w / 2 - 4, cx));
        const ty = Math.max(-S.PAD_TOP + 12, cy);
        ctx.fillStyle = 'rgba(8,12,18,0.92)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(tx - w / 2, ty - 10, w, 20, 6);
        else ctx.rect(tx - w / 2, ty - 10, w, 20);
        ctx.fill();
        ctx.strokeStyle = '#8ab4ff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#8ab4ff';
        ctx.fillText(txt, tx, ty);
        ctx.restore();
    }

    // The blink needs frames of its own: draw() is pure and only runs when
    // something asks it to. Runs ONLY while the pointer is on the roller.
    let wheelBlinkRaf = null;

    function wheelBlinkStart() {
        if (wheelBlinkRaf) return;
        wheelBlinkRaf = requestAnimationFrame(function step() {
            if (!state.wheelHover) {
                wheelBlinkRaf = null;
                return;
            }
            render();
            wheelBlinkRaf = requestAnimationFrame(step);
        });
    }

    function wheelBlinkStop() {
        if (wheelBlinkRaf) {
            cancelAnimationFrame(wheelBlinkRaf);
            wheelBlinkRaf = null;
        }
    }
    /* [VC-WHEEL-END] */

    function onDragStart(e) {
        // Zoomed, a press on the canvas never started a drag, so it must not start a
        // refusal either — an explanation for something that was not attempted is
        // just noise. This stays the first word, exactly as it was.
        if (state.zoomOpen) return;
        // The nut is ON the sliding head, so it has to claim the press BEFORE the
        // drag does — otherwise clicking it would grab the jaws instead of the screw.
        if (hitLockNut(e)) {
            setLocked(!state.locked);
            e.preventDefault();
            return;
        }
        // Refusing in silence is what confuses people; say why nothing moved.
        if (state.locked) {
            nudgeLocked();
            e.preventDefault();
            return;
        }
        if (!canDragJaws()) return;
        // The roller claims the press: a CLICK on it steps exactly one least count,
        // a HOLD repeats, and a DRAG from it feeds fine. Which of the three it was is
        // settled on release by whether the pointer moved and whether a repeat fired.
        state.dragFine = hitWheel(e);
        if (state.dragFine) {
            state.wheelDir = wheelDir(e);
            wheelHoldStart(state.wheelDir);
        }
        cancelGlide();
        state.dragging = true;
        state.dragRefX = getCanvasX(e);
        state.dragRefMm = state.mm;
        state.dragMoved = false;
        dismissHint();
        playClick();
        e.preventDefault();
    }

    function onDragMove(e) {
        if (!state.dragging) return;
        const oldMm = state.mm;
        const wasContact = wpInContact();
        const dx = getCanvasX(e) - state.dragRefX;
        if (state.dragFine && Math.abs(dx) > 0) {
            // The pointer moved, so this press is a DRAG, not a hold. Cancelling here
            // is what stops a slow fine drag also being charged a stream of repeats.
            state.dragMoved = true;
            wheelHoldStop();
        }
        // Snap to the least count first, THEN let the workpiece stop the jaws — so the
        // part can hold them at a value that is not on the graduation grid.
        setMm(snapToLc(state.dragRefMm + dx * dragMmPerPx()));
        if (state.mm !== oldMm) playTick();
        if (!wasContact && wpInContact()) playContact();
        render();
        e.preventDefault();
    }

    function onDragEnd() {
        // A press that neither moved nor repeated is a plain click, worth exactly one
        // least count. Once the hold has fired it has already stepped, so charging a
        // click on release too would add a division nobody asked for.
        if (state.dragging && state.dragFine && !state.dragMoved && wheelHold.fired === 0) {
            wheelStep(state.wheelDir || 1);
        }
        wheelHoldStop();
        state.dragging = false;
        state.dragFine = false;
        state.dragMoved = false;
        syncCursor();
    }

    window.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        // Same refusal on the keyboard path as on the pointer path — a lock the
        // arrow keys walk straight through is not a lock.
        if (state.locked && !teach.on) {
            nudgeLocked();
            e.preventDefault();
            return;
        }
        if (!canDragJaws()) return;
        dismissHint();
        cancelGlide();
        const lcMm = getLcMm();
        const wasContact = wpInContact();
        setMm(snapToLc(state.mm + (e.key === 'ArrowRight' ? lcMm : -lcMm)));
        playTick();
        if (!wasContact && wpInContact()) playContact();
        render();
        e.preventDefault();
    });

    // ── Workpiece picker wiring ───────────────────────────────────────
    var objFab = $('obj-fab');
    if (objFab) {
        objFab.addEventListener('click', function(e) {
            e.stopPropagation();
            togglePicker();
        });
    }
    var objClose = $('obj-picker-close');
    if (objClose) objClose.addEventListener('click', function() {
        togglePicker(false);
    });
    var objNone = $('obj-none');
    if (objNone) objNone.addEventListener('click', function() {
        clearWorkpiece();
        togglePicker(false);
    });
    var objPop = $('obj-picker');
    if (objPop) objPop.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    document.addEventListener('click', function() {
        if (state.pickerOpen) togglePicker(false);
    });
    window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && state.pickerOpen) togglePicker(false);
    });

    // ── Event wiring ──────────────────────────────────────────────────
    // A hold must never outlive the press. mouseup/touchend already land on
    // onDragEnd, but a pointer released outside the window, a tab switch or a
    // cancelled touch would otherwise leave the roller feeding on its own.
    window.addEventListener('blur', wheelHoldStop);
    window.addEventListener('touchcancel', onDragEnd);
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) wheelHoldStop();
    });

    cEl.addEventListener('wheel', function(e) {
        // A mouse wheel over the instrument turns the roller — one division a notch,
        // the same quantum the click gives.
        if (!wheelLive()) return;
        if (state.locked) {
            nudgeLocked();
            e.preventDefault();
            return;
        }
        if (!canDragJaws()) return;
        wheelStep(e.deltaY > 0 ? -1 : 1);
        e.preventDefault();
    }, {
        passive: false
    });

    cEl.addEventListener('mousemove', onLockHover);
    cEl.addEventListener('mouseleave', function() {
        if (!state.lockHover && !state.wheelHover) return;
        state.lockHover = false;
        state.wheelHover = false;
        state.wheelActiveDir = 0;
        wheelBlinkStop();
        syncCursor();
        render();
    });
    cEl.addEventListener('mousedown', onDragStart);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    cEl.addEventListener('touchstart', onDragStart, {
        passive: false
    });
    window.addEventListener('touchmove', onDragMove, {
        passive: false
    });
    window.addEventListener('touchend', onDragEnd);

    document.querySelectorAll('#mode-tabs .pill').forEach(btn =>
        btn.addEventListener('click', () => {
            document.querySelectorAll('#mode-tabs .pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setMode(btn.dataset.value);
        })
    );

    // Delegated: updatePrecisionUI() replaces these nodes on every unit switch, so
    // a per-node listener would be attached to buttons that no longer exist.
    $('precision-tabs').addEventListener('click', function(e) {
        const btn = e.target.closest('.pill');
        if (!btn || !btn.dataset.value) return;
        document.querySelectorAll('#precision-tabs .pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setPrecision(btn.dataset.value);
    });

    document.querySelectorAll('#unit-toggle .pill').forEach(btn =>
        btn.addEventListener('click', () => {
            document.querySelectorAll('#unit-toggle .pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setUnit(btn.dataset.value);
        })
    );

    // The ONLY writer of state.zoomOpen, so the button can never disagree with
    // the view about whether it is zoomed.
    function setZoom(open) {
        state.zoomOpen = !!open;
        const btn = $('btn-zoom');
        // Keep the label in its own span \u2014 phones hide it and show the glyph alone.
        btn.innerHTML = state.zoomOpen ?
            '\u2715<span class="zt-lbl">&nbsp;Close</span>' :
            '\uD83D\uDD0D<span class="zt-lbl">&nbsp;Zoom</span>';
        btn.setAttribute('aria-label', state.zoomOpen ? 'Close zoom' : 'Zoom');
        btn.classList.toggle('active', state.zoomOpen);
        render();
    }

    function closeZoom() {
        if (state.zoomOpen) setZoom(false);
    }

    $('btn-zoom').addEventListener('click', () => {
        if (teach.on) return; // the walkthrough owns the view while it runs
        setZoom(!state.zoomOpen);
    });

    // Coincidence highlight toggle \u2014 let students find the coinciding line themselves.
    var btnAlign = $('btn-align');
    if (btnAlign) btnAlign.addEventListener('click', function() {
        if (teach.on) return; // the walkthrough owns the highlight while it runs
        state.showAlign = !state.showAlign;
        teachSyncAlignBtn();
        render();
    });

    // Beam numbering (mm | cm). Display only — it renames the numerals on the SAME
    // lines, so no reading, grading or quiz answer can move. The pair is hidden in
    // Imperial, where the beam is graduated in inches and neither option applies.
    var beamUnitBtns = document.querySelectorAll('#beam-unit [data-beam-unit]');

    function syncBeamUnitUi() {
        var wrap = document.querySelector('.beam-unit-wrap');
        if (wrap) wrap.hidden = isImperial();
        // setUnit() can reach this before the querySelectorAll below has run; the
        // function declaration hoists but the var does not.
        if (!beamUnitBtns) return;
        for (var i = 0; i < beamUnitBtns.length; i++) {
            var on = beamUnitBtns[i].getAttribute('data-beam-unit') === state.beamUnit;
            beamUnitBtns[i].classList.toggle('active', on);
            beamUnitBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }
    Array.prototype.forEach.call(beamUnitBtns, function(b) {
        b.addEventListener('click', function() {
            var u = b.getAttribute('data-beam-unit');
            if (u === state.beamUnit) return;
            state.beamUnit = u;
            syncBeamUnitUi();
            render();
        });
    });
    syncBeamUnitUi();

    // [VC-TEACHUI-BEGIN]
    // Keeps the DOM in step with the walkthrough. Called from every tick, so it is
    // guarded against redundant writes: a textContent write per frame on the live
    // region would make a screen reader announce the same line sixty times a second.
    let _teachLive = '';

    function teachSyncUi() {
        const bar = $('teach-bar'),
            how = $('btn-how');
        const live = $('teach-live'),
            play = $('btn-teach-play');
        if (bar) bar.hidden = !teach.on;
        if (how) {
            how.hidden = !teachAllowed();
            how.classList.toggle('running', teach.on);
        }
        // The instrument is frozen while the walkthrough runs; the hint and the
        // object FAB would both sit under the caption band, so they stand down.
        const card = $('caliper-card');
        if (card) card.classList.toggle('teach-running', teach.on);

        if (!teach.on) {
            teachLight(null);
            teachRows({
                i: -1,
                key: ''
            });
            if (live && _teachLive) {
                live.textContent = '';
                _teachLive = '';
            }
            return;
        }

        const at = teachAt();
        teachLight(at.stage.tile);
        teachRows(at);
        if (play) {
            const done = teach.t >= teach.total;
            play.textContent = done ? '↻' : (teach.playing ? '⏸' : '▶');
            play.setAttribute('aria-label', done ? 'Replay' : (teach.playing ? 'Pause' : 'Play'));
        }
        if (live) {
            const [t, b] = teachCaption();
            const say = t + '. ' + b;
            if (say !== _teachLive) {
                live.textContent = say;
                _teachLive = say;
            }
        }
    }

    var btnHow = $('btn-how');
    if (btnHow) btnHow.addEventListener('click', function() {
        if (teach.on) teachStop();
        else teachStart();
    });
    var _tb;
    if ((_tb = $('btn-teach-play'))) _tb.addEventListener('click', teachPlayPause);
    if ((_tb = $('btn-teach-next'))) _tb.addEventListener('click', function() {
        teachStep(1);
    });
    if ((_tb = $('btn-teach-prev'))) _tb.addEventListener('click', function() {
        teachStep(-1);
    });
    if ((_tb = $('btn-teach-exit'))) _tb.addEventListener('click', teachStop);

    document.addEventListener('keydown', function(e) {
        if (!teach.on) return;
        // Never swallow a key the user meant for a field.
        const t = e.target,
            tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'Escape') {
            teachStop();
            e.preventDefault();
        } else if (e.key === ' ') {
            teachPlayPause();
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            teachStep(1);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            teachStep(-1);
            e.preventDefault();
        }
    });
    teachSyncUi();
    // [VC-TEACHUI-END]

    $('btn-play').addEventListener('click', () => {
        // Belt-and-braces: the button is disabled while a part is clamped, but if one
        // is somehow loaded, take it out rather than animate against the stop.
        if (state.wp) {
            clearWorkpiece();
            newQuiz();
            return;
        }
        if (state.playing) stopAnim();
        else startAnim();
    });
    $('btn-check').addEventListener('click', checkAnswer);
    $('btn-new').addEventListener('click', newQuiz);
    var btnObj = $('btn-obj');
    if (btnObj) btnObj.addEventListener('click', practiceMeasureObject);
    $('practice-input').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        if (state.mode === 'practice') checkAnswer();
        else if (state.mode === 'quiz') submitQuizAnswer();
    });

    $('btn-quiz-submit').addEventListener('click', submitQuizAnswer);
    $('btn-quiz-next').addEventListener('click', nextQuizQuestion);
    $('btn-quiz-retry').addEventListener('click', () => {
        $('quiz-result').style.display = 'none';
        $('quiz-bar').style.display = '';
        startQuiz();
    });

    // ── Zero Error controls ───────────────────────────────────────────
    document.querySelectorAll('#ze-toggle .pill').forEach(function(btn) {
        btn.addEventListener('click', function() {
            setZeroError(btn.dataset.value === 'on');
        });
    });
    var zeDec = $('ze-dec');
    if (zeDec) zeDec.addEventListener('click', function() {
        bumpZe(-1);
    });
    var zeInc = $('ze-inc');
    if (zeInc) zeInc.addEventListener('click', function() {
        bumpZe(+1);
    });

    // ── Locking screw ─────────────────────────────────────────────────
    var btnLock = $('btn-lock');
    if (btnLock) btnLock.addEventListener('click', function() {
        setLocked(!state.locked);
    });


    // [VC-3DHOST-BEGIN]
    // The operable 3D view (vernier3d.js, loaded on first use). It holds no reading of its own: it draws
    // this file's state through the functions lent below, and moves the jaws ONLY through moveJawsTo(),
    // which applies the 2D drag's guards in the 2D drag's order. Spec and record: docs/vernier-caliper-3d.md
    var VC3D_VER = 15;
    // `var`, not const: render() reads it, and a render() reached before this block runs must see "no 3D".
    // vis: the card is on screen (IntersectionObserver). failed: WebGL could not start at all (permanent).
    var v3d = {
        on: false,
        eng: null,
        loading: false,
        shown: false,
        failed: false,
        vis: true
    };

    function v3dOn() {
        return !!v3d && v3d.on && state.mode !== 'explore' && !v3d.failed;
    }

    // The one way the 3D view moves the jaws. Same refusals as the pointer and keyboard paths: a lock says
    // so (and flashes), a graded mode or a running walkthrough leaves the instrument where it is, and the
    // part still stops the jaws because the write goes through setMm(snapToLc()).
    function moveJawsTo(nextMm, opts) {
        if (state.locked) {
            if (!teach.on) nudgeLocked();
            return {
                moved: false,
                clamped: false,
                contact: wpInContact(),
                refused: 'locked'
            };
        }
        if (!canDragJaws()) return {
            moved: false,
            clamped: false,
            contact: wpInContact(),
            refused: 'mode'
        };
        cancelGlide();
        dismissHint();
        const old = state.mm,
            wasContact = wpInContact();
        const want = snapToLc(nextMm);
        setMm(want);
        const moved = state.mm !== old;
        const sound = !opts || opts.sound !== false;
        if (sound && moved) playTick();
        if (sound && !wasContact && wpInContact()) playContact();
        render();
        return {
            moved: moved,
            clamped: Math.abs(want - state.mm) > 1e-9,
            contact: wpInContact(),
            refused: null
        };
    }

    function v3dHost() {
        return {
            st: state,
            teach: teach,
            getZeOffsetMm: getZeOffsetMm,
            getDisplayMm: getDisplayMm,
            getQuantMm: getQuantMm,
            snapToLc: snapToLc,
            getMaxMm: getMaxMm,
            getMainDivs: getMainDivs,
            getMsdMm: getMsdMm,
            getMsdPx: getMsdPx,
            getPxPerMm: getPxPerMm,
            getVsdCount: getVsdCount,
            getVsdPx: getVsdPx,
            getVernierMult: getVernierMult,
            getVernierLabelRule: getVernierLabelRule,
            getLcMm: getLcMm,
            getLcDisplay: getLcDisplay,
            getMsdDisplay: getMsdDisplay,
            getAlignedIdx: getAlignedIdx,
            isImperial: isImperial,
            impFractional: impFractional,
            fmtReading: fmtReading,
            fmtMsr: fmtMsr,
            fmtLc: fmtLc,
            fmtTr: fmtTr,
            fmtZeSigned: fmtZeSigned,
            fmtDispValue: fmtDispValue,
            uLabel: uLabel,
            wpIsInternal: wpIsInternal,
            wpIsDepth: wpIsDepth,
            wpInContact: wpInContact,
            wpMaxMm: wpMaxMm,
            revealAllowed: wpRevealAllowed,
            teachOn: teachOn,
            teachAt: teachAt,
            teachEase: teachEase,
            teachGrowFrac: teachGrowFrac,
            teachScanExtent: teachScanExtent,
            teachMsrDivs: teachMsrDivs,
            teachCounted: teachCounted,
            teachCaption: teachCaption,
            TEACH: {
                SCAN_TO: TEACH_SCAN_TO,
                MSR_VALUE_AT: TEACH_MSR_VALUE_AT
            },
            moveJawsTo: moveJawsTo,
            setLocked: setLocked,
            canDragJaws: canDragJaws,
            render: render,
            backTo2d: function() {
                setView('2d');
            }
        };
    }

    function v3dSync() {
        if (!v3d) return;
        const want = v3dOn();
        if (want !== v3d.shown) {
            v3d.shown = want;
            const stage = $('vc3d-stage'),
                card = $('caliper-card');
            cEl.style.display = want ? 'none' : '';
            if (stage) stage.hidden = !want;
            if (card) card.classList.toggle('view-3d', want);
            // the 2D zoom has no meaning in 3D (the camera owns the view); leaving it set would reopen zoomed
            if (want) closeZoom();
        }
        // every sync, not only on a change of view: the engine is on only while 3D is wanted AND on screen
        if (v3d.eng) v3d.eng.setOn(want && v3d.vis);
    }

    function v3dLoad() {
        if (v3d.eng || v3d.loading) return;
        if (window.VC3D) {
            v3dStart();
            return;
        }
        v3d.loading = true;

        function add(src, next) {
            const s = document.createElement('script');
            s.src = src;
            s.onload = next;
            s.onerror = function() {
                v3d.loading = false;
                const stage = $('vc3d-stage');
                if (stage) stage.innerHTML = '<div class="vc3d-msg">The 3D view could not be loaded. <button type="button" class="vc3d-back">Back to 2D</button></div>';
                const b = stage && stage.querySelector('.vc3d-back');
                if (b) b.addEventListener('click', function() {
                    setView('2d');
                });
            };
            document.head.appendChild(s);
        }

        function mod() {
            add('vernier3d.js?v=' + VC3D_VER, function() {
                v3d.loading = false;
                v3dStart();
            });
        }
        if (window.GL3D) mod();
        else add('../../shared/gl3d.js?v=3', mod);
    }

    function v3dStart() {
        if (v3d.eng || !window.VC3D) return;
        const stage = $('vc3d-stage');
        if (stage) stage.querySelectorAll('.vc3d-msg').forEach(function(m) {
            m.remove();
        }); // a retry clears the load error
        v3d.eng = window.VC3D.create(v3dHost());
        window.__vc3d = v3d.eng; // browser harnesses only
        if (v3d.eng.mount(stage)) {
            if (v3d.on) v3dRemember('3d'); // remembered only once 3D has actually started
            v3d.eng.resetCamera();
        } else {
            // No WebGL: permanent. Fall back to 2D now, never remember 3D, and say why on the pill.
            v3d.failed = true;
            v3d.on = false;
            v3dRemember('2d');
            const b = document.querySelector('.vc-view-strip [data-view="3d"]');
            if (b) {
                b.disabled = true;
                b.title = '3D needs WebGL, which this browser could not start';
            }
            syncViewStrip();
        }
        render();
    }

    function v3dRemember(v) {
        try {
            localStorage.setItem('vc-view', v);
        } catch (e) { /* storage blocked: fine */ }
    }

    function v3dRecall() {
        try {
            return localStorage.getItem('vc-view');
        } catch (e) {
            return null;
        }
    }

    function v3dInitialView() {
        let q = null;
        try {
            q = new URLSearchParams(location.search).get('view');
        } catch (e) {
            q = null;
        }
        if (q === '3d' || q === '2d') return q;
        return v3dRecall() === '3d' ? '3d' : '2d';
    }

    function syncViewStrip() {
        document.querySelectorAll('.vc-view-strip [data-view]').forEach(function(b) {
            b.setAttribute('aria-pressed', String((b.dataset.view === '3d') === v3d.on));
        });
    }
    // Switching views never ends a walkthrough or a question: both continue in the other view.
    // [V3D-HINT-BEGIN] On a phone or tablet (no fine, hovering pointer, or a window under 760 px) a switch
    // into 3D says once that 3D is at its best on a desktop, and how to look around here. It closes itself
    // after V3D_HINT_MS, or on its x; a second switch replaces it rather than stacking a second notice.
    const V3D_HINT_MS = 6000;

    function v3dWantsDesktopHint(win) {
        const fine = !!(win.matchMedia && win.matchMedia('(hover: hover) and (pointer: fine)').matches);
        return !(fine && (win.innerWidth || 0) >= 760);
    }

    function v3dDesktopHint() {
        const stage = document.getElementById('vc3d-stage');
        if (!stage || !v3dWantsDesktopHint(window)) return;
        stage.querySelectorAll('.v3d-hint').forEach(function(o) {
            if (o._close) o._close();
            else o.remove();
        });
        const el = document.createElement('div');
        el.className = 'v3d-hint';
        el.setAttribute('role', 'status');
        el.innerHTML = '<span class="v3d-hint-t">3D works best on a desktop. Here, drag the background to look around and pinch to zoom.</span>' +
            '<button type="button" class="v3d-hint-x" aria-label="Close">\u00D7</button>';
        stage.appendChild(el);
        const t = setTimeout(function() {
            el._close();
        }, V3D_HINT_MS);
        el._close = function() {
            clearTimeout(t);
            if (el.parentNode) el.parentNode.removeChild(el);
        };
        el.querySelector('.v3d-hint-x').addEventListener('click', function() {
            el._close();
        });
    }
    // [V3D-HINT-END]
    function setView(view) {
        const on = view === '3d';
        if (on === v3d.on) return;
        if (on && v3d.failed) return;
        v3d.on = on;
        if (!on || (v3d.eng && !v3d.failed)) v3dRemember(on ? '3d' : '2d');
        syncViewStrip();
        if (on) v3dLoad();
        if (on) {
            v3dNewQuestion();
            v3dDesktopHint();
        } // every switch to 3D opens on the whole instrument
        render();
    }
    // A new graded question, or a part loaded or taken out, starts the camera afresh.
    function v3dNewQuestion() {
        if (v3d && v3d.eng) v3d.eng.resetCamera();
    }
    document.querySelectorAll('.vc-view-strip [data-view]').forEach(function(b) {
        b.addEventListener('click', function() {
            setView(b.dataset.view);
        });
    });
    // Desktop: the switch is the toolbar's first group. Phone: the toolbar already spans the 2D drawing's
    // top edge, so the switch takes a row of its own above the canvas instead of covering the jaws.
    function placeViewStrip() {
        const strip = document.querySelector('.vc-view-strip'),
            bar = document.querySelector('#caliper-card .canvas-toolbar'),
            card = $('caliper-card');
        if (!strip || !bar || !card) return;
        const narrow = !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches);
        if (narrow && strip.parentNode !== card) card.insertBefore(strip, card.firstChild);
        else if (!narrow && strip.parentNode !== bar) bar.insertBefore(strip, bar.firstChild);
        strip.classList.toggle('vc-view-row', narrow);
    }
    placeViewStrip();
    if (window.matchMedia) {
        const mq = window.matchMedia('(max-width: 720px)');
        if (mq.addEventListener) mq.addEventListener('change', placeViewStrip);
        else if (mq.addListener) mq.addListener(placeViewStrip);
    }
    if ('IntersectionObserver' in window && $('caliper-card')) {
        new IntersectionObserver(function(es) {
            v3d.vis = es[0].isIntersecting;
            if (v3d.vis && v3dOn()) render();
            else if (v3d.eng) v3d.eng.setOn(false);
        }).observe($('caliper-card'));
    }
    if (v3dInitialView() === '3d') setView('3d');
    // [VC-3DHOST-END]

    // ── Boot ──────────────────────────────────────────────────────────
    syncLockUi();
    updatePrecisionUI();
    syncAnswerInput();
    render();
})();