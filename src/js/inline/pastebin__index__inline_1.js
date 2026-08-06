(function () {
  document.getElementById('tallenna-btn').addEventListener('click', async () => {
              const content = document.getElementById('paste-content').value;
              if (!content.trim()) return alert('Tekstikenttä on tyhjä!');

              const btn = document.getElementById('tallenna-btn');
              btn.disabled = true;
              btn.textContent = 'Tallennetaan...';

              try {
                  const res = await fetch('/api/paste', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ content })
                  });
                  const data = await res.json();

                  if (res.ok) {
                      document.getElementById('syotto-alue').style.display = 'none';
                      document.getElementById('tulos-alue').style.display = 'block';
                      document.getElementById('paste-linkki').value = window.location.origin + '/p/' + data.path;
                  } else {
                      alert(data.error || 'Virhe tallennuksessa');
                  }
              } catch (e) {
                  alert('Palvelinvirhe yhteydessä.');
              } finally {
                  btn.disabled = false;
                  btn.textContent = 'Tallenna ja luo linkki';
              }
          });

          document.getElementById('kopioi-btn').addEventListener('click', () => {
              const linkki = document.getElementById('paste-linkki');
              linkki.select();
              linkki.setSelectionRange(0, 99999);
              document.execCommand('copy');

              const btn = document.getElementById('kopioi-btn');
              const alkuperainen = btn.textContent;
              btn.textContent = 'Kopioitu!';
              btn.style.backgroundColor = '#218838';
              btn.style.color = 'white';
              setTimeout(() => {
                  btn.textContent = alkuperainen;
                  btn.style.backgroundColor = '';
                  btn.style.color = '';
              }, 2000);
          });

          document.getElementById('uusi-btn').addEventListener('click', () => {
              document.getElementById('paste-content').value = '';
              document.getElementById('tulos-alue').style.display = 'none';
              document.getElementById('syotto-alue').style.display = 'block';
          });
})();
