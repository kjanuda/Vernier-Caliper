/* Developer Credit — JKoDe */
(function () {
    'use strict';

    if (document.getElementById('cookie-notice')) return;

    const div = document.createElement('div');
    div.id = 'cookie-notice';

    div.innerHTML = `
        Developed by
        <strong>
            <a href="https://kjanuda.netlify.app/"
               target="_blank"
               rel="noopener noreferrer">
                Januda J Kodithuwakku
            </a>
        </strong>
    `;

    document.body.appendChild(div);
})();