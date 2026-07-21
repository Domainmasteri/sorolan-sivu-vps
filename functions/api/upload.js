export async function onRequestPost(context) {
    try {
        const MAX_SIZE_MB = 5120; 
        const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

        const request = context.request;
        const url = new URL(request.url);
        
        if (!context.env.SHARE_BUCKET) {
            return new Response(JSON.stringify({ error: 'R2-bucket sidos puuttuu Pages-asetuksista!' }), { status: 500 });
        }

        const formData = await request.formData();
        const file = formData.get('file');
        
        // Luetaan käyttäjän antamat arvot (varmistetaan max 7 päivää)
        let expiryDays = parseInt(formData.get('expiryDays') || '7');
        if (expiryDays > 7) expiryDays = 7;
        const maxDownloads = parseInt(formData.get('maxDownloads') || '0');

        if (!file) {
            return new Response(JSON.stringify({ error: 'Ei tiedostoa.' }), { status: 400 });
        }

        if (file.size > MAX_SIZE_BYTES) {
            return new Response(JSON.stringify({ error: `Tiedosto ylittää ${MAX_SIZE_MB} MB rajan.` }), { status: 400 });
        }

        // Lasketaan milloin tiedosto vanhenee (historian millisekunnit + päivät)
        const expiresAt = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);

        const id = crypto.randomUUID().split('-')[0];
        const extension = file.name.split('.').pop();
        const fileName = `${id}.${extension}`;

        // Tallennetaan R2:een metadatan kanssa
        await context.env.SHARE_BUCKET.put(fileName, file.stream(), {
            httpMetadata: { contentType: file.type },
            customMetadata: { 
                originalName: file.name,
                expiresAt: expiresAt.toString(),
                maxDownloads: maxDownloads.toString(),
                downloads: '0'
            }
        });

        // UUSI VARMA URL-MUOTO: käyttää query-parametria ?file= tiedostopäätteen sijaan
        const downloadUrl = `${url.origin}/api/download?file=${fileName}`;

        return new Response(JSON.stringify({ url: downloadUrl, id: fileName }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: `Palvelinvirhe: ${error.message}` }), { status: 500 });
    }
}
