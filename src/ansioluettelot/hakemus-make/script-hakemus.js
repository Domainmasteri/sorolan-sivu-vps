// Asetetaan nykyinen päivämäärä automaattisesti sivun latautuessa
document.addEventListener('DOMContentLoaded', () => {
    const dateElement = document.getElementById('current-date');
    if (dateElement) {
        const d = new Date();
        dateElement.innerText = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
    }
});

// PDF:n generointifunktio, joka ottaa vastaan halutun tiedostonimen
function generatePDF(tiedostonimi = 'Markus_Sorola_Tyohakemus.pdf') {
    const element = document.getElementById('hakemus');
    const btn = document.querySelector('.btn-download');
    const languageOverlay = document.querySelector('.language-overlay');
    const previousLanguageOverlayDisplay = languageOverlay ? getComputedStyle(languageOverlay).display : null;
    const restoreStyles = () => {
        btn.style.display = 'block';
        if (languageOverlay) {
            languageOverlay.style.display = previousLanguageOverlayDisplay;
        }
        element.style.margin = '2rem auto';
        element.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
    };
    
    // Piilotetaan painike tulostuksen ajaksi
    btn.style.display = 'none';
    if (languageOverlay) {
        languageOverlay.style.display = 'none';
    }
    
    // Poistetaan marginaalit ja varjot juuri ennen PDF-muunnosta
    element.style.margin = '0';
    element.style.boxShadow = 'none';

    // PDF-asetukset
    const opt = {
        margin:       0,
        filename:     tiedostonimi, 
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  {
            scale: 2,
            useCORS: true,
            scrollY: 0,
            ignoreElements: (node) => node.classList?.contains('language-overlay') || node.classList?.contains('btn-download')
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    requestAnimationFrame(() => {
        // Luodaan PDF ja palautetaan tyylit ennalleen
        html2pdf()
            .set(opt)
            .from(element)
            .save()
            .catch((error) => {
                console.error('Työhakemuksen PDF:n luonti epäonnistui:', error);
            })
            .finally(restoreStyles);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('download') !== '1') return;

    const pathname = window.location.pathname.toLowerCase();
    let tiedostonimi = 'Markus_Sorola_Avoin_Hakemus.pdf';

    if (pathname.includes('hakemus-it') || pathname.includes('it-application')) {
        tiedostonimi = 'Markus_Sorola_Avoin_Hakemus_IT.pdf';
    } else if (pathname.includes('hakemus-jakelu') || pathname.includes('delivery-application')) {
        tiedostonimi = 'Markus_Sorola_Avoin_Hakemus_Logistiikka.pdf';
    } else {
        console.info('Automaattinen PDF-lataus käytti oletusnimeä tuntemattomalla hakemusreitillä:', pathname);
    }

    generatePDF(tiedostonimi);
});