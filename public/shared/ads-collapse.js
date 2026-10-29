/* ═══════════════════════════════════════════════════════════════════
   shared/ads-collapse.js  —  fallback collapse for all manual ad slots
   After 3.5 s, any <ins> inside an .ad-card / .ad-in-article / .ad-slot
   wrapper that still has no data-ad-status (e.g. AdSense JS hasn't
   reached it, or there's nothing to serve) gets marked as "unfilled"
   so the CSS rule collapses the empty wrapper instead of leaving a
   blank tile or gap in the page.
   ═══════════════════════════════════════════════════════════════════ */
(function() {
    'use strict';

    function sweep() {
        var ads = document.querySelectorAll(
            '.ad-card > ins.adsbygoogle:not([data-ad-status]),' +
            '.ad-in-article > ins.adsbygoogle:not([data-ad-status]),' +
            '.ad-slot ins.adsbygoogle:not([data-ad-status])'
        );
        for (var i = 0; i < ads.length; i++) {
            ads[i].setAttribute('data-ad-status', 'unfilled');
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(sweep, 3500);
        });
    } else {
        setTimeout(sweep, 3500);
    }
})();