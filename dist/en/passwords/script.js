document.addEventListener('DOMContentLoaded', () => {
    // HAETAAN ELEMENTIT (KORJATTU HTML-TUNNISTEIDEN MUKAAN)
    const pituusSlider = document.getElementById('pituus-slider');
    const pituusArvo = document.getElementById('pituus-arvo');
    const valmisSalasana = document.getElementById('valmis-salasana');
    const chkPienet = document.getElementById('pienet-kirjaimet');
    const chkIsot = document.getElementById('isot-kirjaimet');
    const chkNumerot = document.getElementById('numerot');
    const chkErikois = document.getElementById('erikoismerkit');
    const luoBtn = document.getElementById('luo-btn');
    const kopioiBtn = document.getElementById('kopioi-btn');

    // PÄIVITETÄÄN LIUKUSÄÄTIMEN ARVO NÄKYVIIN
    pituusSlider.addEventListener('input', (e) => {
        pituusArvo.textContent = e.target.value;
        luoSalasana(); // Luodaan samalla uusi salasana kun liukusäädintä liikutetaan
    });

    // SALASANAN LUONTILOGIIKKA
    function luoSalasana() {
        const pituus = parseInt(pituusSlider.value);
        
        // Määritellään käytettävissä olevat merkit
        const pienetMerkit = "abcdefghijklmnopqrstuvwxyz";
        const isotMerkit = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const numeroMerkit = "0123456789";
        const erikoisMerkit = "!@#$%^&*()_+~`|}{[]:;?><,./-=";
        
        // Kootaan kaikki sallitut merkit valintojen mukaan
        let sallitut = "";
        if (chkPienet && chkPienet.checked) sallitut += pienetMerkit;
        if (chkIsot && chkIsot.checked) sallitut += isotMerkit;
        if (chkNumerot && chkNumerot.checked) sallitut += numeroMerkit;
        if (chkErikois && chkErikois.checked) sallitut += erikoisMerkit;

        // Jos mitään boksia ei ole valittu, laitetaan oletuksena pienet kirjaimet
        if (sallitut.length === 0) {
            sallitut = pienetMerkit;
            if (chkPienet) chkPienet.checked = true;
        }

        // Arvotaan salasana
        let salasana = "";
        for (let i = 0; i < pituus; i++) {
            const randomIndeksi = Math.floor(Math.random() * sallitut.length);
            salasana += sallitut[randomIndeksi];
        }
        
        valmisSalasana.value = salasana;
    }

    // KUN NAPPEJA TAI RUKSEJA PAINETAAN
    if (luoBtn) luoBtn.addEventListener('click', luoSalasana);
    if (chkPienet) chkPienet.addEventListener('change', luoSalasana);
    if (chkIsot) chkIsot.addEventListener('change', luoSalasana);
    if (chkNumerot) chkNumerot.addEventListener('change', luoSalasana);
    if (chkErikois) chkErikois.addEventListener('change', luoSalasana);

    // KOPIOINTILOGIIKKA
    if (kopioiBtn) {
        kopioiBtn.addEventListener('click', () => {
            if (!valmisSalasana.value || valmisSalasana.value === "Press the Generate button") return;
            
            valmisSalasana.select();
            valmisSalasana.setSelectionRange(0, 99999); // Mobiiliyhteensopivuus
            navigator.clipboard.writeText(valmisSalasana.value);
            
            // Muutetaan napin teksti hetkeksi palautteeksi
            const alkuperainenTeksti = kopioiBtn.textContent;
            kopioiBtn.textContent = "✅ Copied!";
            kopioiBtn.style.backgroundColor = "#2ed573";
            
            setTimeout(() => {
                kopioiBtn.textContent = alkuperainenTeksti;
                kopioiBtn.style.backgroundColor = ""; // Palauttaa CSS-teeman värin
            }, 2000);
        });
    }

    // Luodaan automaattisesti ensimmäinen salasana valmiiksi, kun sivu latautuu
    luoSalasana();
});