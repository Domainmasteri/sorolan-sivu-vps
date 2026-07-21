// functions/api/invites.js
async function luoHash(teksti) {
    const msgBuffer = new TextEncoder().encode(teksti);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function tarkistaValtuutus(request, env) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
    
    try {
        const base64Token = authHeader.split(" ")[1];
        const [username, password] = atob(base64Token).split(":");
        if (!username || !password) return false;
        
        const passHash = await luoHash(password);
        const result = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND password_hash = ?").bind(username, passHash).first();
        return !!result;
    } catch (e) { return false; }
}

export async function onRequest(context) {
    const { request, env } = context;
    if (!(await tarkistaValtuutus(request, env))) return new Response(JSON.stringify({ error: 'Ei valtuuksia.' }), { status: 401 });

    try {
        if (request.method === "GET") {
            // Haetaan tietokannan code_hash nimellä "code", koska jatkossa tallennamme siihen selkokielistä tekstiä
            const { results } = await env.DB.prepare("SELECT id, code_hash as code, is_used, created_at FROM invites ORDER BY created_at DESC").all();
            return new Response(JSON.stringify({ invites: results }), { status: 200 });
        }

        if (request.method === "POST") {
            const { code } = await request.json();
            if (!code || code.length < 3) return new Response(JSON.stringify({ error: 'Koodin tulee olla vähintään 3 merkkiä.' }), { status: 400 });

            try {
                // TALLENNETAAN SELKOKIELISENÄ
                await env.DB.prepare("INSERT INTO invites (code_hash) VALUES (?)").bind(code).run();
                return new Response(JSON.stringify({ success: true }), { status: 200 });
            } catch (dbError) {
                return new Response(JSON.stringify({ error: "Tämä kutsukoodi on jo olemassa!" }), { status: 400 });
            }
        }

        if (request.method === "DELETE") {
            const idToRemove = new URL(request.url).searchParams.get('id');
            await env.DB.prepare("DELETE FROM invites WHERE id = ?").bind(idToRemove).run();
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        return new Response("Tuntematon metodi.", { status: 405 });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}