document.addEventListener('DOMContentLoaded', async () => {
            // Irrotetaan ID pomminvarmasti poistamalla ensin ylimääräinen / lopusta
            const rawPath = window.location.pathname.replace(/\/+$/, '');
            const pasteId = rawPath.split('/').pop();
            const koodiAlue = document.getElementById('koodi-alue');

            try {
                const res = await fetch(`/api/paste/${pasteId}`);
                if (!res.ok) throw new Error('Tekstiä ei löytynyt');
                
                const data = await res.json();
                koodiAlue.textContent = data.content;
                Prism.highlightElement(koodiAlue);
            } catch (err) {
                koodiAlue.textContent = "Virhe: Etsimääsi tekstiä ei löytynyt tai se on poistettu.";
            }

            document.getElementById('kopioi-sisalto').addEventListener('click', (e) => {
                const text = koodiAlue.textContent;
                navigator.clipboard.writeText(text);
                const btn = e.target;
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
        });
