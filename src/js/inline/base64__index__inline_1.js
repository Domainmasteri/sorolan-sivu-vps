(function () {
  const syoteEl = document.getElementById('b64-syote');
          const tulosEl = document.getElementById('b64-tulos');
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

          document.getElementById('koodaa-btn').addEventListener('click', () => {
              const syote = syoteEl.value;
              if (!syote) {
                  naytaTila('⚠️ Syötekenttä on tyhjä.', 'virhe');
                  return;
              }
              try {
                  const koodattu = btoa(encodeURIComponent(syote).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
                  tulosEl.value = koodattu;
                  tulosEl.className = 'syote';
                  naytaTila('✅ Teksti koodattu onnistuneesti.', 'ok');
              } catch (e) {
                  tulosEl.value = '';
                  tulosEl.className = 'syote virhe';
                  naytaTila('❌ Koodaus epäonnistui: ' + e.message, 'virhe');
              }
          });

          document.getElementById('pura-btn').addEventListener('click', () => {
              const syote = syoteEl.value.trim();
              if (!syote) {
                  naytaTila('⚠️ Syötekenttä on tyhjä.', 'virhe');
                  return;
              }
              try {
                  const purettu = decodeURIComponent(atob(syote).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
                  tulosEl.value = purettu;
                  tulosEl.className = 'syote';
                  naytaTila('✅ Base64 purettu onnistuneesti.', 'ok');
              } catch (e) {
                  tulosEl.value = '';
                  tulosEl.className = 'syote virhe';
                  naytaTila('❌ Purku epäonnistui: Syöte ei ole kelvollista Base64-tekstiä.', 'virhe');
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
                  naytaTila('⚠️ Ei kopioitavaa – koodaa tai pura ensin teksti.', 'virhe');
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
})();
