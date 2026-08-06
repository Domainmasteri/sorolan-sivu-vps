(function () {
  const API_GUESTBOOK = '/api/guestbook';

          let captchaA = 0, captchaB = 0, captchaOp = '+';

          function uusiCaptcha() {
              const luvut = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
              const operaattorit = ['+', '-', '*'];
              const op = operaattorit[Math.floor(Math.random() * operaattorit.length)];
              let a = luvut[Math.floor(Math.random() * luvut.length)];
              let b = luvut[Math.floor(Math.random() * luvut.length)];

              // Vältetään negatiiviset tulokset vähennyslaskussa
              if (op === '-' && b > a) [a, b] = [b, a];
              // Pidetään kertolasku kohtuullisena
              if (op === '*') { a = Math.floor(Math.random() * 9) + 1; b = Math.floor(Math.random() * 9) + 1; }

              captchaA = a;
              captchaB = b;
              captchaOp = op;

              const opMerkki = op === '*' ? '×' : op;
              document.getElementById('captcha-kysymys').textContent = `Paljonko on ${a} ${opMerkki} ${b}?`;
              document.getElementById('captcha-vastaus').value = '';
          }

          function naytaLomakeIlmoitus(viesti, tyyppi = 'virhe') {
              const el = document.getElementById('lomake-ilmoitus');
              el.textContent = viesti;
              el.className = `ilmoitus ${tyyppi}`;
              el.classList.remove('piilotettu');
              if (tyyppi === 'onnistui') {
                  setTimeout(() => el.classList.add('piilotettu'), 6000);
              }
          }

          async function lahetaViesti() {
              const nimi = document.getElementById('gb-nimi').value.trim();
              const viesti = document.getElementById('gb-viesti').value.trim();
              const vastaus = document.getElementById('captcha-vastaus').value.trim();

              if (!nimi) return naytaLomakeIlmoitus('Nimi on pakollinen.');
              if (!viesti) return naytaLomakeIlmoitus('Viesti on pakollinen.');
              if (!vastaus) return naytaLomakeIlmoitus('Syötä laskutoimituksen vastaus.');

              const btn = document.getElementById('btn-laheta');
              btn.disabled = true;
              btn.textContent = 'Lähetetään...';

              try {
                  const res = await fetch(API_GUESTBOOK, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                          name: nimi,
                          message: viesti,
                          captcha_a: captchaA,
                          captcha_b: captchaB,
                          captcha_op: captchaOp,
                          captcha_answer: vastaus
                      })
                  });
                  const data = await res.json();
                  if (res.ok) {
                      naytaLomakeIlmoitus('Viestisi on lähetetty! Kiitos! 🎉', 'onnistui');
                      document.getElementById('gb-nimi').value = '';
                      document.getElementById('gb-viesti').value = '';
                      uusiCaptcha();
                      await lataaViestit();
                  } else {
                      naytaLomakeIlmoitus(data.error || 'Virhe viestin lähetyksessä.');
                  }
              } catch (e) {
                  naytaLomakeIlmoitus('Palvelinvirhe. Yritä uudelleen.');
              } finally {
                  btn.disabled = false;
                  btn.textContent = 'Lähetä viesti';
              }
          }

          function muotoilePvm(isoString) {
              const d = new Date(isoString);
              return d.toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          }

          function renderViestit(viestit) {
              const osio = document.getElementById('viestit-osio');
              if (!viestit || viestit.length === 0) {
                  osio.innerHTML = '<div class="osion-tausta"><p style="margin:0; text-align:center; color:#718096;" data-i18n="vieraskirja.ei_vielä_viestejä_ole_ensimmäinen">Ei vielä viestejä. Ole ensimmäinen!</p></div>';
                  return;
              }
              osio.innerHTML = viestit.map(v => {
                  const onYllapito = v.is_admin === 1 || v.is_admin === true;
                  const korttiLuokka = onYllapito ? 'viestikortti yllapito-viesti' : 'viestikortti';
                  const merkki = onYllapito ? '<span class="yllapito-merkki">⚡ Ylläpito</span>' : '';
                  const vastausHtml = v.admin_reply
                      ? `<div class="admin-vastaus">
                          <div class="admin-vastaus-otsikko">⚡ Ylläpidon vastaus:</div>
                          <div class="admin-vastaus-teksti">${escapeHtml(v.admin_reply)}</div>
                         </div>`
                      : '';
                  return `<div class="${korttiLuokka}">
                      <div class="viestikortti-otsikko">
                          <span class="viestikortti-nimi">${escapeHtml(v.name)}</span>
                          ${merkki}
                          <span class="viestikortti-aika">${muotoilePvm(v.created_at)}</span>
                      </div>
                      <div class="viestikortti-teksti">${escapeHtml(v.message)}</div>
                      ${vastausHtml}
                  </div>`;
              }).join('');
          }

          function escapeHtml(str) {
              return String(str)
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
          }

          async function lataaViestit() {
              try {
                  const res = await fetch(API_GUESTBOOK);
                  if (res.ok) {
                      const data = await res.json();
                      renderViestit(data.messages || []);
                  } else {
                      document.getElementById('viestit-osio').innerHTML =
                          '<div class="osion-tausta"><p style="margin:0;text-align:center;color:#ef4444;" data-i18n="vieraskirja.viestejä_ei_voitu_ladata">Viestejä ei voitu ladata.</p></div>';
                  }
              } catch (e) {
                  document.getElementById('viestit-osio').innerHTML =
                      '<div class="osion-tausta"><p style="margin:0;text-align:center;color:#ef4444;" data-i18n="vieraskirja.palvelinvirhe_viestejä_ladattaessa">Palvelinvirhe viestejä ladattaessa.</p></div>';
              }
          }

          // Alustus
          window.uusiCaptcha = uusiCaptcha;
          window.lahetaViesti = lahetaViesti;
          uusiCaptcha();
          lataaViestit();
})();
