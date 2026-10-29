/* ══════════════════════════════════════════════════════════════════
   shared/press-repeat.js  —  hold a stepper button to keep stepping
   ──────────────────────────────────────────────────────────────────
   A +/- stepper that only fires once per click makes the user click
   forty times to cross a slider's range. Holding it should keep going,
   the way holding a key on a keyboard does.

   TIMING — the keyboard auto-repeat model, because that is the one
   every user already has in their fingers:

     hold threshold   500 ms   Windows' default keyboard repeat delay,
                               the middle of the macOS range, and the
                               Android/iOS long-press threshold. Short
                               enough not to feel stuck, long enough
                               that an ordinary click never repeats by
                               accident — below ~300 ms they start to.
     repeat interval  140 ms   easing to 40 ms over about a second

   The ramp matters: a flat fast rate is unusable for fine adjustment,
   a flat slow one never crosses a wide range. Starting slow lets you
   nudge by one or two, then it accelerates once you have clearly
   committed to holding. 40 ms (25 steps/s) is near the fastest a
   keyboard will repeat.

   HOW IT DRIVES THE TOOL: each repeat dispatches a real `click` on the
   button, so whatever handler the tool already has runs unchanged.
   Nothing here knows what a step means. A tap is left completely
   alone — the native click does its usual single step, and repeat only
   begins after the threshold.

   Opt a button out with data-no-repeat; opt one in with data-repeat.
   ══════════════════════════════════════════════════════════════════ */
(function() {
    'use strict';

    var HOLD_MS = 500; /* tap vs hold */
    var RAMP = [140, 140, 140, 90, 90, 60, 60, 40]; /* then 40 forever */
    var MAX_MS = 20000; /* hard stop if a pointerup is ever missed */

    var timer = null,
        btn = null,
        fired = 0,
        startedAt = 0;
    var swallowUntil = 0; /* the trailing click after a hold, and only that one */

    /* ── which buttons are steppers ──────────────────────────────────
       Tight on purpose. A "+" is not always a stepper: it adds a shape in
       area-calculator, inserts an operator on the maths keyboard, and
       zooms a graph in five circuit tools. Repeating any of those would
       be worse than not repeating at all. So a match needs the glyph AND
       a spinner-shaped context: an input the button sits beside, or a
       container that says it is a stepper. */
    function isStep(el) {
        if (!el || el.tagName !== 'BUTTON' || el.disabled) return false;
        if (el.hasAttribute('data-no-repeat')) return false;
        if (el.hasAttribute('data-repeat')) return true;
        var t = (el.textContent || '').trim();
        var lab = ((el.getAttribute('aria-label') || '') + ' ' + (el.title || '')).toLowerCase();
        if (!/^[+\-−–—▲▼△▽↑↓]$/.test(t) &&
            !/\b(increase|decrease|increment|decrement|step up|step down)\b/.test(lab)) return false;
        var p = el.parentElement;
        if (!p) return false;
        if (p.querySelector('input')) return true;
        if (/stepper|spinner|numstep|opt-ze/i.test(String(p.className))) return true;
        var gp = p.parentElement;
        return !!(gp && /stepper|spinner|numstep/i.test(String(gp.className)));
    }

    function stop() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        btn = null;
    }

    function tick() {
        if (!btn || !btn.isConnected || btn.disabled) {
            stop();
            return;
        }
        if (Date.now() - startedAt > MAX_MS) {
            stop();
            return;
        }
        btn.click();
        fired++;
        var gap = RAMP[Math.min(fired, RAMP.length - 1)];
        timer = setTimeout(tick, gap);
    }

    function onDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        var el = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!isStep(el)) return;
        stop();
        btn = el;
        fired = 0;
        startedAt = Date.now();
        /* stop a long press from selecting the glyph or raising the iOS
           callout, and keep the 300 ms tap delay off it */
        el.style.touchAction = 'manipulation';
        el.style.webkitUserSelect = el.style.userSelect = 'none';
        timer = setTimeout(tick, HOLD_MS);
    }

    /* The browser fires its own click on release. If we already stepped
       while held, that trailing click would be one step too many. */
    function onUp() {
        if (!btn) return;
        /* A release outside the button produces no click at all, so this is
           time-boxed: it must never be left armed to eat a later, real one. */
        if (fired > 0) swallowUntil = Date.now() + 400;
        stop();
    }

    document.addEventListener('click', function(e) {
        if (Date.now() > swallowUntil) return;
        swallowUntil = 0;
        var el = e.target && e.target.closest ? e.target.closest('button') : null;
        if (el && isStep(el)) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    /* finger or cursor slides off the button mid-hold */
    document.addEventListener('pointerleave', function(e) {
        if (btn && e.target === btn) onUp();
    }, true);
    document.addEventListener('contextmenu', function(e) {
        var el = e.target && e.target.closest ? e.target.closest('button') : null;
        if (isStep(el)) e.preventDefault();
    }, true);
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') stop();
    }, true);
    window.addEventListener('blur', stop);

    window.PressRepeat = {
        isStep: isStep,
        stop: stop,
        HOLD_MS: HOLD_MS
    };
})();