const syoteEl = document.getElementById('json-syote');
        const tulosEl = document.getElementById('json-tulos');
        const tilaEl = document.getElementById('tila-viesti');
        const kopiointiBtn = document.getElementById('kopioi-btn');

        function naytaTila(viesti, tyyppi) {
            tilaEl.textContent = viesti;
            tilaEl.className = tyyppi;
        }

        function poistaTila() {
            tilaEl.className = '';
            tilaEl.textContent = '';
        }

        document.getElementById('muotoile-btn').addEventListener('click', () => {
            const syote = syoteEl.value.trim();
            if (!syote) {
                naytaTila('⚠️ Syötekenttä on tyhjä.', 'virhe');
                return;
            }
            try {
                const parsittu = JSON.parse(syote);
                const muotoiltu = JSON.stringify(parsittu, null, 2);
                tulosEl.value = muotoiltu;
                tulosEl.className = 'syote';
                naytaTila('✅ JSON on kelvollinen ja muotoiltu onnistuneesti.', 'ok');
            } catch (e) {
                tulosEl.value = '';
                tulosEl.className = 'syote virhe';
                naytaTila('❌ Virheellinen JSON: ' + e.message, 'virhe');
            }
        });

        document.getElementById('pakkaa-btn').addEventListener('click', () => {
            const syote = syoteEl.value.trim();
            if (!syote) {
                naytaTila('⚠️ Syötekenttä on tyhjä.', 'virhe');
                return;
            }
            try {
                const parsittu = JSON.parse(syote);
                tulosEl.value = JSON.stringify(parsittu);
                tulosEl.className = 'syote';
                naytaTila('✅ JSON pakattu onnistuneesti.', 'ok');
            } catch (e) {
                tulosEl.value = '';
                tulosEl.className = 'syote virhe';
                naytaTila('❌ Virheellinen JSON: ' + e.message, 'virhe');
            }
        });

        document.getElementById('tyhjenna-btn').addEventListener('click', () => {
            syoteEl.value = '';
            tulosEl.value = '';
            tulosEl.className = 'syote';
            poistaTila();
        });

        kopiointiBtn.addEventListener('click', async () => {
            const teksti = tulosEl.value;
            if (!teksti) {
                naytaTila('⚠️ Ei kopioitavaa – muotoile ensin JSON.', 'virhe');
                return;
            }
            try {
                await navigator.clipboard.writeText(teksti);
            } catch {
                tulosEl.select();
                document.execCommand('copy');
            }
            const alkuperainen = kopiointiBtn.textContent;
            const alkuperainenVari = kopiointiBtn.style.backgroundColor;
            kopiointiBtn.textContent = '✅ Kopioitu!';
            kopiointiBtn.style.backgroundColor = '#166534';
            setTimeout(() => {
                kopiointiBtn.textContent = alkuperainen;
                kopiointiBtn.style.backgroundColor = alkuperainenVari;
            }, 2000);
        });
