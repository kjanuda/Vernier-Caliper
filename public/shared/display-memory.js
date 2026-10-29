/* ============================================================================
   display-memory.js — remember the visitor's Display Controls choices per tool.

   The complaint this fixes: turn "Grid" off, reload, and the grid is back.
   Every panel toggle resets to its markup default on every visit.

   Companion to unit-memory.js, but a deliberately different mechanism.
   unit-memory has to CLICK the control because the 88 unit toggles hold their
   state in seven different variable names behind six markup patterns, so there
   is no shared thing to set. The Display Controls panel is the opposite: it is
   one canonical component (`details.canvas-toggles`) rolled out site-wide, so
   the controls are addressable and their handlers are uniformly bound to
   'change'. Setting the value and firing input+change is therefore enough —
   and it is the same mechanism share-params.js already uses on 108 tools to
   restore a shared setup, so it is proven against these exact controls.

   Three properties worth knowing about:

   1. ONLY DEVIATIONS ARE STORED. The baseline is whatever the panel reads as
      once the tool has finished initialising; storage holds just the controls
      that differ from it. So an untouched tool stores nothing, "Reset display"
      empties the record on its own, and if a tool's default later changes the
      new default reaches returning visitors instead of being masked forever.

   2. THE TOOL'S OWN HANDLER DOES THE WORK. Nothing here knows what "Grid"
      means. It restores the control and fires the events the tool is already
      listening for, so every repaint the tool would normally do happens for
      free — and a tool that ignores the restore simply keeps its default
      rather than drawing something inconsistent with its own checkbox.

   3. A SHARED LINK OUTRANKS A REMEMBERED PREFERENCE. '#c=' is somebody else's
      setup, deliberately sent; it must not be quietly overwritten by yours.

   Drop-in, zero config, one line per tool — place AFTER the tool's app.js:
     <script src="../../shared/display-memory.js?v=1" defer></script>
   ========================================================================= */
(function() {
    'use strict';

    /* Panels: the canonical component, plus an opt-in hook for the handful of
       tools whose display options live in a bespoke container. */
    var PANEL_SEL = 'details.canvas-toggles, [data-display-memory]';
    var FIELD_SEL = 'input[type="checkbox"], input[type="range"], input[type="number"], select';

    function slug() {
        var m = location.pathname.match(/\/tools\/([a-z0-9-]+)\//);
        return m ? m[1] : location.pathname;
    }
    var KEY = 'ms_disp_' + slug();

    /* ── storage, tolerant of private mode / disabled storage ──────────────── */
    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return null;
            var o = JSON.parse(raw);
            return (o && typeof o === 'object' && !(o instanceof Array)) ? o : null;
        } catch (e) {
            return null;
        }
    }

    function store(o) {
        try {
            var n = 0,
                k;
            for (k in o)
                if (Object.prototype.hasOwnProperty.call(o, k)) n++;
            if (n) localStorage.setItem(KEY, JSON.stringify(o));
            else localStorage.removeItem(KEY); /* back to default = no record */
        } catch (e) { /* ignore */ }
    }

    /* ── enumerating the panel ─────────────────────────────────────────────── */
    function panels() {
        return document.querySelectorAll(PANEL_SEL);
    }

    /* stress-strain's nine toggles carry data-k instead of an id; everything
       else on the site is id'd. Anything with neither is not addressable across
       a reload, so it is skipped rather than guessed at by position. */
    function fieldKey(el) {
        if (el.id) return 'i:' + el.id;
        if (el.getAttribute('data-k')) return 'k:' + el.getAttribute('data-k');
        return null;
    }

    function fields() {
        var out = [],
            ps = panels(),
            p, i, els, el, k;
        for (p = 0; p < ps.length; p++) {
            els = ps[p].querySelectorAll(FIELD_SEL);
            for (i = 0; i < els.length; i++) {
                el = els[i];
                k = fieldKey(el);
                if (!k) continue;
                out.push({
                    k: k,
                    el: el,
                    bool: el.type === 'checkbox'
                });
            }
        }
        return out;
    }

    /* Segmented button groups (rankine-cycle's T–s / P–v, simple-pendulum's
       Energy / Waveform, thermocouple's playback speed).

       The guard that makes this safe is "exactly one button is marked active
       right now". Action buttons that also live in these panels — Reset display,
       belt-drive's layer presets, tolerance-fits' PNG/CSV export — never carry an
       active marker, so they are never recorded and therefore never clicked on a
       later visit. A group must also have an id: that is its storage key, and a
       stable one beats an invented positional one. */
    var ACTIVE_CLS = /(^|\s)(active|on|selected)(\s|$)/;

    function isOn(b) {
        return ACTIVE_CLS.test(b.className || '') ||
            b.getAttribute('aria-pressed') === 'true' ||
            b.getAttribute('aria-checked') === 'true';
    }
    /* Identify a button by something meaningful, so re-ordering the markup does
       not silently restore the neighbouring view. Index is the last resort. */
    function btnSig(b, i) {
        if (b.id) return '#' + b.id;
        var d = b.attributes,
            ks = [],
            j, n;
        for (j = 0; j < d.length; j++) {
            n = d[j].name;
            if (n.indexOf('data-') === 0) ks.push(n + '=' + d[j].value);
        }
        ks.sort();
        return ks.length ? ks.join(';') : '@' + i;
    }

    function groups() {
        var cand = [],
            ps = panels(),
            p, h, hosts, host, bs, i, on;
        for (p = 0; p < ps.length; p++) {
            hosts = ps[p].querySelectorAll('[id]');
            for (h = 0; h < hosts.length; h++) {
                host = hosts[h];
                bs = host.querySelectorAll('button');
                if (bs.length < 2) continue;
                on = 0;
                for (i = 0; i < bs.length; i++)
                    if (isOn(bs[i])) on++;
                if (on !== 1) continue; /* not a segmented control */
                cand.push({
                    k: 'g:' + host.id,
                    host: host,
                    btns: bs
                });
            }
        }
        /* Keep the innermost host only — a panel that itself carries an id would
           otherwise be recorded as a duplicate of the group nested inside it. */
        var out = [],
            a, b, nested;
        for (a = 0; a < cand.length; a++) {
            nested = false;
            for (b = 0; b < cand.length; b++) {
                if (a !== b && cand[a].host !== cand[b].host && cand[a].host.contains(cand[b].host)) {
                    nested = true;
                    break;
                }
            }
            if (!nested) out.push(cand[a]);
        }
        return out;
    }

    /* ── reading / applying ────────────────────────────────────────────────── */
    function readAll() {
        var m = {},
            fs = fields(),
            gs = groups(),
            i, g, b;
        for (i = 0; i < fs.length; i++) {
            m[fs[i].k] = fs[i].bool ? (fs[i].el.checked ? 1 : 0) : String(fs[i].el.value);
        }
        for (g = 0; g < gs.length; g++) {
            for (b = 0; b < gs[g].btns.length; b++) {
                if (isOn(gs[g].btns[b])) {
                    m[gs[g].k] = btnSig(gs[g].btns[b], b);
                    break;
                }
            }
        }
        return m;
    }

    function fire(el) {
        try {
            el.dispatchEvent(new Event('input', {
                bubbles: true
            }));
        } catch (e) {}
        try {
            el.dispatchEvent(new Event('change', {
                bubbles: true
            }));
        } catch (e) {}
    }

    /* Returns true when the control now reads as asked — the caller uses that to
       decide whether a later pass should try again. */
    function applyField(f, v) {
        var want;
        if (f.bool) {
            want = !!(+v);
            if (f.el.checked === want) return true;
            f.el.checked = want;
            fire(f.el);
            return f.el.checked === want;
        }
        if (String(f.el.value) === String(v)) return true;
        f.el.value = String(v);
        if (String(f.el.value) !== String(v)) return true; /* no such option — give up quietly */
        fire(f.el);
        return true;
    }

    function applyGroup(G, sig) {
        var i;
        for (i = 0; i < G.btns.length; i++) {
            if (btnSig(G.btns[i], i) !== sig) continue;
            if (isOn(G.btns[i])) return true;
            try {
                G.btns[i].click();
            } catch (e) {}
            return isOn(G.btns[i]);
        }
        return true; /* signature gone from the markup */
    }

    /* ── state ─────────────────────────────────────────────────────────────── */
    var baseline = null; /* the tool's own defaults, read once after init */
    var target = null; /* the FULL state being restored to, or null */

    function has(o, k) {
        return Object.prototype.hasOwnProperty.call(o, k);
    }

    function snapshot() {
        if (target) return; /* mid-restore: the record is already correct */
        if (!baseline) return;
        var now = readAll(),
            diff = {},
            k;
        for (k in now) {
            if (!has(now, k)) continue;
            if (!has(baseline, k) || String(now[k]) !== String(baseline[k])) diff[k] = now[k];
        }
        store(diff);
    }

    /* Everything that does not currently read as `target` says it should. */
    function mismatches() {
        var fs = fields(),
            gs = groups(),
            byKey = {},
            out = [],
            i, k, t, want, cur, b;
        for (i = 0; i < fs.length; i++) byKey[fs[i].k] = fs[i];
        for (i = 0; i < gs.length; i++) byKey[gs[i].k] = gs[i];
        for (k in target) {
            if (!has(target, k)) continue;
            t = byKey[k];
            if (!t) continue; /* control no longer exists */
            want = target[k];
            if (k.charAt(0) === 'g') {
                cur = null;
                for (b = 0; b < t.btns.length; b++)
                    if (isOn(t.btns[b])) {
                        cur = btnSig(t.btns[b], b);
                        break;
                    }
            } else {
                cur = t.bool ? (t.el.checked ? 1 : 0) : String(t.el.value);
            }
            if (String(cur) !== String(want)) out.push({
                k: k,
                t: t,
                want: want
            });
        }
        return out;
    }

    /* Restore the WHOLE state, not just the stored deviations, and iterate until
       it settles.

       Both halves of that matter. utm-testing has an "All Labels" master whose
       handler switches its four sub-options with it; restoring only the stored
       deviations set the master, let it sweep three sub-options the visitor had
       never touched, and never put them back — because those three matched the
       default and so were absent from the record. Applying the full state fixes
       what the cascade knocked over; iterating is what lets the second round see
       the damage the first round caused. Six rounds is a stop, not a budget: the
       real cases settle in two. */
    function tryRestore() {
        if (!target) return;
        var r, ms, i;
        for (r = 0; r < 6; r++) {
            ms = mismatches();
            if (!ms.length) return; /* settled for now */
            for (i = 0; i < ms.length; i++) {
                if (ms[i].k.charAt(0) === 'g') applyGroup(ms[i].t, ms[i].want);
                else applyField(ms[i].t, ms[i].want);
            }
        }
    }

    /* ── wiring ────────────────────────────────────────────────────────────── */
    function debounce(fn, ms) {
        var t = null;
        return function() {
            clearTimeout(t);
            t = setTimeout(fn, ms);
        };
    }

    function inPanel(node) {
        if (!node || !node.closest) return false;
        try {
            return !!node.closest(PANEL_SEL);
        } catch (e) {
            return false;
        }
    }

    function wire() {
        /* A toggle the visitor flips. Capture phase so it fires whichever of
           change / input the tool itself is listening for. */
        var soon = debounce(snapshot, 60);

        function onEdit(ev) {
            if (inPanel(ev.target)) soon();
        }
        document.addEventListener('change', onEdit, true);
        document.addEventListener('input', onEdit, true);

        /* "Reset display" and belt-drive's layer presets rewrite the checkboxes
           programmatically, which fires no change event — so re-read after any
           click inside the panel, once the tool's own handler has run. */
        document.addEventListener('click', onEdit, true);

        /* Several tools also toggle display state from keyboard shortcuts and set
           .checked directly (belt-drive g, boyles-law, gear-trains, gyroscope,
           phase-change). Same problem, same fix. */
        var later = debounce(snapshot, 300);
        document.addEventListener('keyup', later, true);

        /* Last word on the way out — catches anything the listeners above missed.
           visibilitychange is the one that fires reliably on mobile. */
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) snapshot();
        });
        window.addEventListener('pagehide', snapshot);
    }

    /* ── go ────────────────────────────────────────────────────────────────── */
    function init() {
        if (!panels().length) return; /* tool has no display panel */

        /* Read the defaults BEFORE restoring anything: this is the only moment the
           panel is guaranteed to show the tool's own idea of a fresh page. */
        baseline = readAll();
        wire();

        /* An explicit shared link is someone's deliberate setup — leave it alone.
           share-params.js already carries these toggles inside '#c='. */
        if ((location.hash || '').indexOf('#c=') === 0) return;

        var want = load();
        if (!want) return;

        /* The stored record holds only deviations; the state being restored to is
           the tool's own defaults with those deviations laid over the top. */
        target = {};
        var k;
        for (k in baseline)
            if (has(baseline, k)) target[k] = baseline[k];
        for (k in want)
            if (has(want, k)) target[k] = want[k];

        /* Converge rather than fire-and-forget. A tool that wires its panel late
           (inside window.load, or behind a rAF) would miss the first pass, and one
           that re-syncs its checkboxes late would undo it. So `target` deliberately
           stays armed across all three passes rather than being cleared the moment
           it first agrees — each pass only touches controls that still disagree, so
           repeating costs nothing and a late clobber gets put back. */
        tryRestore();
        setTimeout(tryRestore, 200);

        /* Give up eventually, so ordinary saving resumes. The deadline follows the
           load event rather than being a flat 1.6 s: on a page whose images and ad
           slots take longer than that, a tool that wires its panel in `load` would
           otherwise be handed an already-disarmed restore. */
        function giveUp() {
            target = null;
        }
        var deadline = setTimeout(giveUp, 1600);
        if (document.readyState !== 'complete') {
            window.addEventListener('load', function() {
                setTimeout(tryRestore, 0);
                clearTimeout(deadline);
                deadline = setTimeout(giveUp, 400);
            });
        }

        /* If the visitor reaches for a control first, they win immediately. */
        function yieldToUser() {
            target = null;
        }
        document.addEventListener('pointerdown', yieldToUser, {
            capture: true,
            once: true
        });
        document.addEventListener('touchstart', yieldToUser, {
            capture: true,
            once: true
        });
        document.addEventListener('keydown', yieldToUser, {
            capture: true,
            once: true
        });
    }

    /* Deferred scripts run before DOMContentLoaded, so a setTimeout(0) here is
       what puts init after the tool's own DOMContentLoaded wiring. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 0);
        });
    } else {
        setTimeout(init, 0);
    }

    /* Small surface for tools that want to clear the record explicitly. */
    window.msDisplayMemory = {
        save: function() {
            target = null;
            snapshot();
        },
        clear: function() {
            try {
                localStorage.removeItem(KEY);
            } catch (e) {}
        },
        key: KEY
    };
})();