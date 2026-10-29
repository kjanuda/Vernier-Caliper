/* ============================================================================
   unit-memory.js — remember the visitor's SI / Imperial choice across tools,
   and report unit switches to GA4 so the "should we auto-switch for US
   visitors?" question can be answered from data instead of guessed.

   Why it clicks the control instead of setting a flag:
   the 84 tools that have a unit toggle hold their state in seven different
   variable names (unitSys, unitSystem, imperial, unitMode, useImperial,
   displayMetric, plus state.units / state.unit object forms) behind about six
   different markup patterns. There is no shared flag to set. Activating the
   tool's own control is the only approach that works uniformly, and it also
   means every downstream repaint the tool already does happens for free.

   Deliberately NOT doing geolocation. See the notes at the bottom.
   ========================================================================= */
(function() {
    'use strict';

    var KEY = 'ms_units'; /* 'si' | 'imp' — shared across all tools */

    /* ── storage, tolerant of private mode / disabled storage ──────────────── */
    function load() {
        try {
            var v = localStorage.getItem(KEY);
            return (v === 'si' || v === 'imp') ? v : null;
        } catch (e) {
            return null;
        }
    }

    function save(v) {
        try {
            localStorage.setItem(KEY, v);
        } catch (e) { /* ignore */ }
    }

    /* ── vocabulary ────────────────────────────────────────────────────────── */
    var IMP_TXT = /^(imperial|imp|us|usc|us customary|ip|in|inch|inches|ft|lbf|psi|°f|f)$/i;
    var SI_TXT = /^(si|metric|mm|cm|m|°c|c|k|n|kn|n·m|nm|pa|kpa|mpa|gpa|bar|kg|j|kj|w|kw|l\/min|l\/s|m\/s)$/i;

    /* System-level attributes first — a tool can have both a system switch and
       per-unit pills (area-calculator has data-system plus data-unit="mm|in").
       The trailing " i" makes the attribute VALUE match case-insensitively:
       the site uses si/SI, imp/IMP/Imperial and ip/IP interchangeably, and CSS
       attribute values are case-sensitive by default. */
    var IMP_SEL = ['[data-system="imp" i]', '[data-system="imperial" i]',
        '[data-unit="imp" i]', '[data-unit="imperial" i]', '[data-unit="ip" i]',
        '[data-units="imp" i]', '[data-units="imperial" i]', '[data-units="ip" i]',
        '[data-value="imp" i]', '[data-value="imperial" i]',
        '[data-u="imp" i]', '[data-u="imperial" i]',
        '#unit-imp', '#btn-imp',
        '[data-unit="in" i]', '[data-unit="inch" i]', '[data-unit="lbf" i]',
        '[data-unit="ft" i]', '[data-unit="psi" i]'
    ];
    var SI_SEL = ['[data-system="si" i]', '[data-system="metric" i]',
        '[data-unit="si" i]', '[data-unit="metric" i]',
        '[data-units="si" i]', '[data-units="metric" i]',
        '[data-value="si" i]', '[data-value="metric" i]',
        '[data-u="si" i]', '[data-u="metric" i]',
        '#unit-si', '#btn-si',
        '[data-unit="mm" i]', '[data-unit="n" i]'
    ];

    function txt(el) {
        return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function first(sels) {
        for (var i = 0; i < sels.length; i++) {
            var e = null;
            try {
                e = document.querySelector(sels[i]);
            } catch (err) { /* unsupported selector */ }
            if (e) return e;
        }
        return null;
    }

    function isActive(el) {
        return !!el && (el.classList.contains('active') ||
            el.getAttribute('aria-pressed') === 'true' ||
            el.getAttribute('aria-checked') === 'true' ||
            el.classList.contains('selected'));
    }

    /* ── locate the control(s) ─────────────────────────────────────────────── */
    function findControls() {
        /* 1. a matched SI / Imperial pair (the common segmented case) */
        var imp = first(IMP_SEL),
            si = first(SI_SEL);
        if (imp && si && imp !== si) return {
            kind: 'pair',
            si: si,
            imp: imp
        };

        /* 2. a labelled pair inside a units container */
        var boxes = document.querySelectorAll(
            '#unit-tabs,#units-tabs,#unit-toggle,#btn-units,#unit-system-tabs,' +
            '.unit-toggle,.unit-tabs,.cvs-unit-seg');
        for (var b = 0; b < boxes.length; b++) {
            var kids = boxes[b].querySelectorAll('button,.pill,label,[role="radio"]');
            var sHit = null,
                iHit = null;
            for (var k = 0; k < kids.length; k++) {
                var t = txt(kids[k]);
                if (!iHit && IMP_TXT.test(t)) iHit = kids[k];
                if (!sHit && SI_TXT.test(t)) sHit = kids[k];
            }
            if (sHit && iHit) return {
                kind: 'pair',
                si: sHit,
                imp: iHit
            };

            /* 3. one button whose own label reports the CURRENT system and flips on
                  click (fluid-flow shows "SI", cnc-gcode shows "MM"). */
            if (!kids.length && (boxes[b].tagName === 'BUTTON' || boxes[b].tagName === 'A')) {
                return {
                    kind: 'flip',
                    el: boxes[b]
                };
            }
            if (kids.length === 1) return {
                kind: 'flip',
                el: kids[0]
            };
        }
        return null;
    }

    /* Which system is showing right now. */
    function currentSystem(c) {
        if (c.kind === 'pair') {
            if (isActive(c.imp)) return 'imp';
            if (isActive(c.si)) return 'si';
            return 'si'; /* markup default */
        }
        /* flip button: its label names the system currently in effect */
        return IMP_TXT.test(txt(c.el)) ? 'imp' : 'si';
    }

    /* A real activation sequence. Several tools bind pointerdown rather than
       click, so a bare .click() is not enough — and firing both a synthetic
       click AND .click() would toggle a flip button straight back. */
    function activate(el) {
        var o = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        };
        var P = window.PointerEvent || window.MouseEvent,
            M = window.MouseEvent;
        try {
            el.dispatchEvent(new P('pointerdown', o));
        } catch (e) {}
        try {
            el.dispatchEvent(new M('mousedown', o));
        } catch (e) {}
        try {
            el.dispatchEvent(new M('mouseup', o));
        } catch (e) {}
        try {
            el.dispatchEvent(new M('click', o));
        } catch (e) {}
    }

    /* ── GA4 ───────────────────────────────────────────────────────────────── */
    function slug() {
        var m = location.pathname.match(/\/tools\/([a-z0-9-]+)\//);
        return m ? m[1] : location.pathname;
    }

    /* US IANA zones, as an explicit allowlist. An 'America/' prefix test would
       sweep in Toronto, Mexico City and Sao Paulo, all of which are metric.
       NOTHING BRANCHES ON THIS — no auto-switching happens anywhere in this file.
       It is recorded so the "should we switch on the clock?" question can be
       answered later using the SAME signal such a switch would use. GA4's own
       country dimension is IP-derived and disagrees with the device clock more
       often than people expect (VPNs, travel, expatriate laptops), so measuring
       country alone would not actually test the proposal. */
    var US_TZ = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Juneau|Sitka|Nome|Adak|Yakutat|Metlakatla|Menominee|Indiana\/|Kentucky\/|North_Dakota\/)|Pacific\/Honolulu)/;

    function tzRegion() {
        try {
            var z = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            return US_TZ.test(z) ? 'us' : 'other';
        } catch (e) {
            return 'unknown';
        }
    }

    /* 'restore' fires on every page load that re-applies a saved choice, so it
       scales with pageviews and would swamp the deliberate clicks that actually
       answer the question. Report it once per SESSION instead, which keeps the
       ratio "sessions that chose" vs "sessions that inherited" readable. */
    function restoreReported() {
        try {
            return sessionStorage.getItem(KEY + '_r') === '1';
        } catch (e) {
            return false;
        }
    }

    function markRestoreReported() {
        try {
            sessionStorage.setItem(KEY + '_r', '1');
        } catch (e) { /* ignore */ }
    }

    /* GA4 does not report on an event PARAMETER until it is registered as a
       custom dimension in property admin, and that registration is NOT
       retroactive. A parameter-only design therefore collects nothing usable
       until someone remembers to click through the console, and loses every day
       before they do. So the two facts that decide the auto-switch question —
       which system, and whether the visitor chose it — are encoded in the EVENT
       NAME, which is queryable immediately with no admin access at all.
       The parameters are still sent: registering them later adds detail without
       needing another edit here. tool_slug needs no registration either, since
       it is already carried by the standard `pagePath` dimension. */
    function report(to, trigger) {
        if (typeof window.gtag !== 'function') return;
        if (trigger === 'restore') {
            if (restoreReported()) return;
            markRestoreReported();
        }
        var sys = (to === 'imp') ? 'imp' : 'si';
        try {
            /* unit_imp_click | unit_si_click | unit_imp_restore | unit_si_restore */
            window.gtag('event', 'unit_' + sys + '_' + trigger, {
                to_system: (to === 'imp') ? 'imperial' : 'si',
                tool_slug: slug(),
                trigger: trigger,
                tz_region: tzRegion()
            });
        } catch (e) { /* never let analytics break the tool */ }
    }

    /* ── wire up ───────────────────────────────────────────────────────────── */
    function init() {
        var c = findControls();
        if (!c) return; /* tool has no toggle */

        /* Record every deliberate switch. Capture phase on document so it fires
           whichever event type the tool itself listens for. */
        var targets = (c.kind === 'pair') ? [c.si, c.imp] : [c.el];
        document.addEventListener('click', function(ev) {
            for (var i = 0; i < targets.length; i++) {
                if (targets[i] === ev.target || targets[i].contains(ev.target)) {
                    /* let the tool's own handler run first, then read the result */
                    setTimeout(function() {
                        var now = currentSystem(c);
                        save(now);
                        report(now, 'click');
                    }, 0);
                    return;
                }
            }
        }, true);

        /* Re-apply a previous choice. Runs after the tool has wired its handlers
           (this script is deferred and placed after app.js).
           An explicit shared link wins over a remembered preference: share-params
           encodes the sender's setup — including units on the tools that snapshot
           them — in location.hash as '#c=', so leave that alone. */
        if ((location.hash || '').indexOf('#c=') === 0) return;
        var want = load();
        if (!want) return;
        if (want === currentSystem(c)) return; /* already correct */
        var target = (c.kind === 'pair') ? (want === 'imp' ? c.imp : c.si) : c.el;
        if (!target) return;
        activate(target);
        /* Verify — if the tool ignored the synthetic event, don't claim success. */
        setTimeout(function() {
            if (currentSystem(c) === want) report(want, 'restore');
        }, 60);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 0);
        });
    } else {
        setTimeout(init, 0);
    }

    /* ── Why there is no geolocation, and no clock-based switching, here ──────
       Auto-switching US visitors to Imperial was considered and rejected twice.
       The timezone SIGNAL is fine — Intl.DateTimeFormat().resolvedOptions()
       .timeZone is free, synchronous, needs no geo-IP service, and is the only
       approach compatible with edge-cached static HTML (a server-side decision
       would need a Worker or a Vary header and would fragment the CDN cache).
       navigator.language is NOT fine: it reports 'en-US' on plenty of machines
       outside the US, verified on a Dubai laptop that reports en-US / Asia/Dubai.
       Intl.Locale measurementSystem does not exist in shipping browsers yet.

       The blocker is the CONTENT, not the signal. All 90 tools that load this
       file also carry Practice / Quiz / Explore modes whose problems are stated
       in SI and do NOT follow the toggle — verified live on belt-drive (Imperial
       active, freshly generated question still reads "T1 = 800 N … 0.4 kg/m …
       belt speed (m/s)") and on bolted-joint ("kb = 515 kN/mm"). Auto-switching
       would hand a US visitor a self-contradicting page: sliders in inches, the
       question beneath them in kN/mm. A visitor who picks Imperial has opted
       into that and understands it; one who touched nothing just sees a bug.
       Making auto-switch safe means unit-aware practice generators across 90
       tools first. That is the real cost — the detection is the trivial part.

       Also, on measuring instruments (vernier-caliper, screw-gauge, steel-ruler,
       dial-gauge) reading the metric scale IS the lesson, and bolted-joint,
       tolerance-fits and thread-nomenclature are metric-standard tools that only
       convert their outputs.

       The events above are what make the decision testable: compare
       unit_imp_click against unit_si_click, segmented by GA4's country
       dimension, and read tz_region once it is registered. If US visitors do
       switch in numbers, fix the practice generators and then add a DISMISSIBLE
       one-time nudge — never a silent override.
       ---------------------------------------------------------------------- */
})();