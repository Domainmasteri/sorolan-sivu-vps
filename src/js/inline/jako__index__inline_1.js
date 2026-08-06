lucide.createIcons();
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');
        const dropzoneContent = document.getElementById('dropzone-content');
        const loading = document.getElementById('loading');
        const loadingText = document.getElementById('loading-text');
        const result = document.getElementById('result');
        const shareLink = document.getElementById('shareLink');
        const copyBtn = document.getElementById('copyBtn');
        const encryptCheckbox = document.getElementById('encryptCheckbox');

        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
        dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', function() {
            if (this.files.length) handleUpload(this.files[0]);
        });

        async function handleUpload(file) {
            const MAX_SIZE_MB = 1024;
            if (file.size > MAX_SIZE_MB * 1024 * 1024) {
                alert(`Tiedosto on liian suuri! Sallittu maksimikoko on ${MAX_SIZE_MB} MB.`);
                return;
            }

            dropzoneContent.style.display = 'none';
            loading.style.display = 'flex';
            result.style.display = 'none';
            dropzone.style.pointerEvents = 'none';

            const expiryDays = document.getElementById('expiryDays').value;
            const maxDownloads = document.getElementById('maxDownloads').value;
            const isEncrypted = encryptCheckbox.checked;

            let uploadBlob = file;
            let finalFilename = file.name;
            let encryptionKeyHash = '';

            try {
                if (isEncrypted) {
                    loadingText.textContent = 'Salataan selaimessa...';
                    const cryptoKey = await window.crypto.subtle.generateKey(
                        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
                    );
                    const iv = window.crypto.getRandomValues(new Uint8Array(12));
                    const fileBuffer = await file.arrayBuffer();
                    const encryptedContent = await window.crypto.subtle.encrypt(
                        { name: "AES-GCM", iv: iv }, cryptoKey, fileBuffer
                    );

                    const rawKey = await window.crypto.subtle.exportKey("raw", cryptoKey);
                    encryptionKeyHash = btoa(String.fromCharCode(...new Uint8Array(rawKey)))
                        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                    uploadBlob = new Blob([iv, encryptedContent]);
                    finalFilename = file.name + '.enc';
                }

                loadingText.textContent = 'Ladataan pilveen...';
                const formData = new FormData();
                formData.append('file', uploadBlob, finalFilename);
                formData.append('expiryDays', expiryDays);
                formData.append('maxDownloads', maxDownloads);

                const response = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Lataus epäonnistui.');

                // Tunnistetaan kieli ja ohjataan lyhyisiin reitteihin oikealla kielellä!
                const isEn = window.location.pathname.includes('/en/');

                if (isEncrypted) {
                    const prefix = isEn ? '/en/share/s/' : '/s/';
                    shareLink.value = window.location.origin + prefix + data.id + '#key=' + encryptionKeyHash;
                } else {
                    const prefix = isEn ? '/en/share/d/' : '/d/';
                    shareLink.value = window.location.origin + prefix + data.id;
                }

                result.style.display = 'block';
            } catch (error) {
                alert('Virhe: ' + error.message);
            } finally {
                loading.style.display = 'none';
                dropzoneContent.style.display = 'block';
                dropzone.style.pointerEvents = 'auto';
                fileInput.value = '';
            }
        }

        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            shareLink.select();
            shareLink.setSelectionRange(0, 99999);
            document.execCommand('copy');
            const alkuperainen = copyBtn.innerText;
            copyBtn.innerText = "Kopioitu!";
            copyBtn.style.backgroundColor = "#218838";
            copyBtn.style.color = "white";
            setTimeout(() => {
                copyBtn.innerText = alkuperainen;
                copyBtn.style.backgroundColor = "";
                copyBtn.style.color = "";
            }, 2500);
        });
