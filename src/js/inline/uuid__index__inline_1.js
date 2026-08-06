function generateUUIDs() {
            let countInput = document.getElementById('uuid-count');
            let count = parseInt(countInput.value, 10);
            
            if (isNaN(count) || count < 1) count = 1;
            if (count > 50) count = 50;
            countInput.value = count;

            let result = "";
            for (let i = 0; i < count; i++) {
                if (window.crypto && window.crypto.randomUUID) {
                    result += crypto.randomUUID() + "\n";
                } else {
                    result += 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    }) + "\n";
                }
            }
            
            document.getElementById('uuid-tulos').value = result.trim();
        }

        function copyUUIDs() {
            const textArea = document.getElementById('uuid-tulos');
            if (!textArea.value) return;

            textArea.select();
            try {
                document.execCommand('copy');
                const toast = document.getElementById('copy-toast');
                toast.style.display = 'block';
                setTimeout(() => { toast.style.display = 'none'; }, 2500);
            } catch (err) {
                console.error('Kopiointi epäonnistui:', err);
            }
        }

        window.addEventListener('DOMContentLoaded', generateUUIDs);
