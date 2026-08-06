let decryptedBlob = null;
        let originalFilename = "tiedosto.enc";

        async function puraTiedosto() {
            // Etsitään ID varmasti
            let fileId = window.location.pathname.replace(/\/+$/, '').split('/').pop();
            if (fileId.includes('.html') || fileId === 's' || !fileId) {
                const urlParams = new URLSearchParams(window.location.search);
                fileId = urlParams.get('file');
            }
            const hashKey = window.location.hash.substring(1).replace('key=', '');

            const teksti = document.getElementById('teksti');
            const lataaNappi = document.getElementById('lataaNappi');

            if (!fileId || !hashKey) {
                teksti.textContent = "Virhe: Puuttuva tiedosto-ID tai salausavain.";
                teksti.style.color = "#ef4444";
                return;
            }

            try {
                // Haetaan raaka salattu tiedosto. 
                const res = await fetch(`/d/${fileId}`);
                if (!res.ok) throw new Error('Tiedostoa ei löytynyt tai se on vanhentunut.');
                const encryptedArrayBuffer = await res.arrayBuffer();

                // Korjataan base64 padding! Selaimen atob kaatuu, jos täytemerkit puuttuvat
                let b64 = hashKey.replace(/-/g, '+').replace(/_/g, '/');
                const pad = b64.length % 4;
                if (pad) {
                    b64 += '='.repeat(4 - pad);
                }

                // Nyt atob ei enää kaadu
                const binStr = atob(b64);
                const bytes = new Uint8Array(binStr.length);
                for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

                const cryptoKey = await window.crypto.subtle.importKey(
                    "raw", bytes.buffer, { name: "AES-GCM" }, false, ["decrypt"]
                );

                const iv = encryptedArrayBuffer.slice(0, 12);
                const data = encryptedArrayBuffer.slice(12);

                const decryptedContent = await window.crypto.subtle.decrypt(
                    { name: "AES-GCM", iv: new Uint8Array(iv) }, cryptoKey, data
                );

                decryptedBlob = new Blob([decryptedContent]);

                const contentDisp = res.headers.get('Content-Disposition');
                if (contentDisp && contentDisp.includes('filename=')) {
                    const matches = contentDisp.match(/filename="?([^"]+)"?/);
                    if (matches && matches[1]) originalFilename = matches[1];
                } else {
                    originalFilename = fileId;
                }

                teksti.textContent = "Tiedosto purettu onnistuneesti! Voit ladata sen koneellesi.";
                teksti.style.color = "#4ade80";
                lataaNappi.style.display = 'block';

            } catch (err) {
                console.error(err);
                teksti.textContent = "Purku epäonnistui. Väärä avain tai tiedosto on vioittunut.";
                teksti.style.color = "#ef4444";
            }
        }

        document.getElementById('lataaNappi').addEventListener('click', () => {
            if (!decryptedBlob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(decryptedBlob);
            a.download = originalFilename.replace('.enc', '');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });

        window.addEventListener('DOMContentLoaded', puraTiedosto);
