// functions/api/humor/upload.js
// POST /api/humor/upload – upload a new image to HUMOR-BUCKET (auth required)

async function luoHash(teksti) {
    const msgBuffer = new TextEncoder().encode(teksti);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function tarkistaValtuutus(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    try {
        const base64Token = authHeader.split(' ')[1];
        const purettu = atob(base64Token);
        const [username, password] = purettu.split(':');
        if (!username || !password) return false;
        const passHash = await luoHash(password);
        const result = await env.DB.prepare(
            'SELECT id FROM users WHERE username = ? AND password_hash = ?'
        ).bind(username, passHash).first();
        return !!result;
    } catch (e) { return false; }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const bucket = env['HUMOR-BUCKET'];

    if (!(await tarkistaValtuutus(request, env))) {
        return new Response(
            JSON.stringify({ error: 'Ei valtuuksia. Kirjaudu uudelleen.' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
    }

    if (!bucket) {
        return new Response(
            JSON.stringify({ error: 'HUMOR-BUCKET-sidos puuttuu Pages-asetuksista!' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file');
        const title = (formData.get('title') || '').trim();

        if (!file) {
            return new Response(
                JSON.stringify({ error: 'Ei tiedostoa.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (!file.type.startsWith('image/')) {
            return new Response(
                JSON.stringify({ error: 'Vain kuvatiedostot (image/*) ovat sallittuja.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
        if (file.size > MAX_SIZE) {
            return new Response(
                JSON.stringify({ error: 'Kuva saa olla enintään 20 MB.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const id = crypto.randomUUID();
        const rawExt = file.name.split('.').pop().toLowerCase();
        const safeExt = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : 'jpg';
        const key = `${id}.${safeExt}`;

        await bucket.put(key, file.stream(), {
            httpMetadata: { contentType: file.type },
            customMetadata: {
                title,
                originalName: file.name,
                uploadedAt: new Date().toISOString(),
            },
        });

        return new Response(JSON.stringify({ success: true, key }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: `Palvelinvirhe: ${err.message}` }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }
}
