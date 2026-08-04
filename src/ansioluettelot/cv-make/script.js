function generatePDF() {
    const element = document.getElementById('cv');
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
    
    // TÄMÄ ON SE KIKKA: Poistetaan marginaalit ja varjot juuri ennen PDF-muunnosta
    element.style.margin = '0';
    element.style.boxShadow = 'none';

    // PDF-asetukset
    const opt = {
        margin:       0,
        filename:     'Markus_Sorola_CV.pdf',
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  {
            scale: 2,
            useCORS: true,
            scrollY: 0,
            ignoreElements: (node) => node.classList?.contains('language-overlay') || node.classList?.contains('btn-download')
        }, // scrollY: 0 estää selaimen vierityksen aiheuttamat bugit
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    requestAnimationFrame(() => {
        // Luodaan PDF
        html2pdf()
            .set(opt)
            .from(element)
            .save()
            .catch((error) => {
                console.error('CV PDF:n luonti epäonnistui:', error);
            })
            .finally(restoreStyles);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('download') === '1') {
        generatePDF();
    }
});
