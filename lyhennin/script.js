document.addEventListener('DOMContentLoaded', () => {
    const lomake = document.getElementById('lyhennin-lomake');
    const urlInput = lomake.querySelector('input[name="url"]');
    const domainInput = lomake.querySelector('select[name="domain"]');
    const tulosAlue = document.getElementById('tulos-alue');
    const lyhennettyUrl = document.getElementById('lyhennetty-url');
    const kopioiBtn = document.getElementById('kopioi-btn');
    const lahetaBtn = lomake.querySelector('button[type="submit"]');

    // OMA WORKER-OSOITTEESI
    const WORKER_URL = '/api/lyhennin/create';

    // Spämmieston muuttuja
    let voiLahettaa = true;

    lomake.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Jos ollaan jäähyllä, ei tehdä mitään
        if (!voiLahettaa) return;

        const alkuperainenUrl = urlInput.value.trim();
        const domain = (domainInput?.value || 'srla.fi').trim();

        // Laitetaan lukkoon käsittelyn ajaksi
        voiLahettaa = false;
        lahetaBtn.disabled = true;
        lahetaBtn.innerText = "Käsitellään...";
        
        try {
            // Rakennetaan URL (vain kohde-osoite riittää)
            const fetchUrl = `${WORKER_URL}?url=${encodeURIComponent(alkuperainenUrl)}&domain=${encodeURIComponent(domain)}`;
            
            // Tehdään pyyntö Workerille
            const response = await fetch(fetchUrl);
            const data = await response.json();

            if (data.success && data.shortUrl) {
                tulosAlue.style.display = 'block';
                lyhennettyUrl.value = data.shortUrl;
                
                // Tyhjennetään kenttä onnistumisen jälkeen
                urlInput.value = '';
            } else {
                alert("Virhe: " + (data.error || "Linkin luonti epäonnistui"));
            }
        } catch (err) {
            console.error("Worker-virhe:", err);
            alert("Virhe yhteydessä palvelimeen. Yritä myöhemmin uudelleen.");
        } finally {
            // 5 SEKUNNIN SPÄMMIESTO JA AJASTIN
            let sekuntejaJaljella = 5;
            lahetaBtn.innerText = `Odottele ${sekuntejaJaljella}s...`;
            
            const ajastin = setInterval(() => {
                sekuntejaJaljella--;
                if (sekuntejaJaljella > 0) {
                    lahetaBtn.innerText = `Odottele ${sekuntejaJaljella}s...`;
                } else {
                    clearInterval(ajastin); // Lopetetaan ajastin
                    lahetaBtn.disabled = false;
                    lahetaBtn.innerText = "Lyhennä linkki";
                    voiLahettaa = true; // Avataan lukko
                }
            }, 1000); // Päivitetään sekunnin välein
        }
    });

    // Kopiointitoiminnallisuus
    if (kopioiBtn) {
        kopioiBtn.addEventListener('click', () => {
            lyhennettyUrl.select();
            lyhennettyUrl.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(lyhennettyUrl.value);
            
            const alkuperainenTeksti = kopioiBtn.innerText;
            kopioiBtn.innerText = "Kopioitu!";
            setTimeout(() => {
                kopioiBtn.innerText = alkuperainenTeksti;
            }, 2000);
        });
    }
});