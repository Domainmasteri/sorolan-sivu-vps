// functions/api/humor/images.js
// GET  /api/humor/images – list all images (public)
// DELETE /api/humor/images?key=… – delete an image (auth required)

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

export async function onRequest(context) {
    const { request, env } = context;
    const bucket = env['HUMOR-BUCKET'];

    if (!bucket) {
        return new Response(
            JSON.stringify({ error: 'HUMOR-BUCKET-sidos puuttuu Pages-asetuksista!' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // GET – list all images (public, no auth)
    if (request.method === 'GET') {
        try {
            const listed = await bucket.list({ include: ['customMetadata'] });
            const images = listed.objects.map(obj => ({
                key: obj.key,
                size: obj.size,
                uploaded: obj.uploaded ? obj.uploaded.toISOString() : null,
                title: (obj.customMetadata && obj.customMetadata.title) || '',
                originalName: (obj.customMetadata && obj.customMetadata.originalName) || obj.key,
            }));
            return new Response(JSON.stringify({ images }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500, headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // DELETE – remove an image (auth required)
    if (request.method === 'DELETE') {
        if (!(await tarkistaValtuutus(request, env))) {
            return new Response(
                JSON.stringify({ error: 'Ei valtuuksia. Kirjaudu uudelleen.' }),
                { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
        }
        const url = new URL(request.url);
        const key = url.searchParams.get('key');
        if (!key) {
            return new Response(
                JSON.stringify({ error: 'Parametri ?key puuttuu.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
        try {
            await bucket.delete(key);
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500, headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    return new Response('Tuntematon metodi.', { status: 405 });
}
