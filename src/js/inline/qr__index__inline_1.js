(function () {
  const tyyppiValitsin = document.getElementById('qr-tyyppi');
          const ryhmat = document.querySelectorAll('.kentta-ryhma');

          tyyppiValitsin.addEventListener('change', (e) => {
              ryhmat.forEach(r => r.classList.remove('aktiivinen'));
              document.getElementById('kentat-' + e.target.value).classList.add('aktiivinen');
          });

          document.getElementById('luo-btn').addEventListener('click', () => {
              let dataString = "";
              const tyyppi = tyyppiValitsin.value;

              if (tyyppi === 'url') {
                  dataString = document.getElementById('val-url').value || "https://soro.la";
              } else if (tyyppi === 'text') {
                  dataString = document.getElementById('val-text').value || "Moi!";
              } else if (tyyppi === 'wifi') {
                  const ssid = document.getElementById('val-wifi-ssid').value;
                  const pass = document.getElementById('val-wifi-pass').value;
                  const sec = document.getElementById('val-wifi-type').value;
                  dataString = `WIFI:T:${sec};S:${ssid};P:${pass};;`;
              } else if (tyyppi === 'email') {
                  const mail = document.getElementById('val-email-osoite').value;
                  const sub = document.getElementById('val-email-otsikko').value;
                  dataString = `mailto:${mail}?subject=${encodeURIComponent(sub)}`;
              } else if (tyyppi === 'phone') {
                  const puhelin = document.getElementById('val-phone').value;
                  dataString = `tel:${puhelin}`;
              } else if (tyyppi === 'sms') {
                  const nro = document.getElementById('val-sms-numero').value;
                  const msg = document.getElementById('val-sms-viesti').value;
                  dataString = `smsto:${nro}:${msg}`;
              }

              const variHex = document.getElementById('qr-vari').value.replace('#', '');
              const uusiUrl = `/api/qr-proxy?data=${encodeURIComponent(dataString)}&color=${encodeURIComponent(variHex)}`;
              document.getElementById('qr-kuva').src = uusiUrl;
          });

          document.getElementById('lataa-btn').addEventListener('click', async () => {
              const kuvaUrl = document.getElementById('qr-kuva').src;
              try {
                  const response = await fetch(kuvaUrl);
                  const blob = await response.blob();
                  const latausLinkki = document.createElement('a');
                  latausLinkki.href = URL.createObjectURL(blob);
                  latausLinkki.download = 'sorola-qr.png';
                  document.body.appendChild(latausLinkki);
                  latausLinkki.click();
                  document.body.removeChild(latausLinkki);
              } catch (error) {
                  alert("Lataus epäonnistui. Voit myös painaa kuvaa hiiren oikealla ja valita 'Tallenna kuva nimellä'.");
              }
          });
})();
