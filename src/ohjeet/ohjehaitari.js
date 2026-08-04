'use strict';

/**
 * Sorolan ohjesivujen avattavat ja suljettavat ohjepalstat.
 *
 * HTML-rakenne:
 *   <div class="osion-tausta ohje-palsta">
 *     <h2>...<button class="ohje-toggle" ...></button></h2>
 *     <div class="ohje-sisalto">...</div>
 *   </div>
 */
document.addEventListener('DOMContentLoaded', () => {
    const palstat = document.querySelectorAll('.ohje-palsta');

    palstat.forEach((palsta, index) => {
        const painike = palsta.querySelector('.ohje-toggle');
        const sisalto = palsta.querySelector('.ohje-sisalto');

        if (!painike || !sisalto) return;

        if (!sisalto.id) {
            sisalto.id = `ohje-sisalto-${index + 1}`;
        }

        painike.setAttribute('aria-controls', sisalto.id);

        const asetaTila = (auki) => {
            sisalto.hidden = !auki;
            painike.setAttribute('aria-expanded', String(auki));
            painike.textContent = auki ? '−' : '+';
            painike.setAttribute(
                'aria-label',
                auki ? 'Sulje ohje' : 'Avaa ohje'
            );
            palsta.classList.toggle('auki', auki);
        };

        asetaTila(painike.getAttribute('aria-expanded') === 'true');

        painike.addEventListener('click', () => {
            const auki = painike.getAttribute('aria-expanded') === 'true';
            asetaTila(!auki);
        });
    });
});
