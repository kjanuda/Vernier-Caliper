/* ══════════════════════════════════════════════════════════════════
   shared/number-input-guard.js  —  a typed number must stay typed
   ──────────────────────────────────────────────────────────────────
   User report, vernier-caliper, 2026-09-26: "Answer was 2.050 inch. I
   wrote down 2.050 and it said it was wrong."

   Nothing in the grader was wrong (700 browser attempts, and a 16.9 M-
   assertion gate, agree that typing the quoted answer always passes).
   The number was changed AFTER it was typed. A focused
   <input type="number"> steps its own value when the mouse wheel turns
   over it, and when ↑/↓ is pressed — by one `step`. On an instrument the
   answer box's step IS the least count, so one scroll notch while
   reading the caliper just above turns a right answer into one division
   wrong: 2.050 became 2.049, the box was hidden on Check, and the
   student saw only "Wrong | Answer: 2.050".

   Two rules:
     WHEEL — on ANY focused number input, the wheel blurs it instead.
             The value is kept and the page scrolls as the visitor meant.
             Nobody scrolls over a box to change a number on purpose.
     ARROWS — ↑/↓ are refused on an ANSWER box only. An answer is read
             off the instrument and typed; stepping it is never intended.
             On a PARAMETER box (a load, a speed) arrow-stepping is a
             legitimate keyboard control and is left alone.

   An ANSWER box is one marked `data-answer`, or whose id names it as
   one (practice-input, *answer*, *quiz*). Delegated on document, so a
   box created or retyped later (text ↔ number) is covered too.
   ══════════════════════════════════════════════════════════════════ */
(function() {
    'use strict';

    function isNumberInput(el) {
        return !!el && el.tagName === 'INPUT' && el.type === 'number';
    }

    function isAnswerBox(el) {
        if (!isNumberInput(el)) return false;
        if (el.hasAttribute('data-answer')) return true;
        return /practice-input|answer|quiz/i.test(el.id || '');
    }

    document.addEventListener('wheel', function(e) {
        var el = e.target;
        if (isNumberInput(el) && document.activeElement === el) el.blur();
    }, {
        capture: true,
        passive: true
    });

    document.addEventListener('keydown', function(e) {
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isAnswerBox(e.target)) {
            e.preventDefault();
        }
    }, true);
})();