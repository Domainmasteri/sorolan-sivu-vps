// functions/api/humor/image.js
// GET /api/humor/image?key=… – serve an image from HUMOR-BUCKET (public)

export async function onRequestGet(context) {
    const { request, env } = context;
    const bucket = env['HUMOR-BUCKET'];

    if (!bucket) {
        return new Response('HUMOR-BUCKET-sidos puuttuu Pages-asetuksista.', { status: 500 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    if (!key) {
        return new Response('Parametri ?key puuttuu.', { status: 400 });
    }

    // Allow only plain filenames: alphanumeric, hyphens, underscores, single dot before extension
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,10}$/.test(key)) {
        return new Response('Virheellinen avain.', { status: 400 });
    }

    const object = await bucket.get(key);

    if (!object) {
        return new Response('Kuvaa ei löydy.', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return new Response(object.body, { headers });
}
