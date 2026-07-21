// functions/api/users.js
async function luoHash(teksti) {
    const msgBuffer = new TextEncoder().encode(teksti);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function tarkistaValtuutus(request, env) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    
    try {
        const base64Token = authHeader.split(" ")[1];
        const [username, password] = atob(base64Token).split(":");
        if (!username || !password) return null;
        
        const passHash = await luoHash(password);
        const result = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND password_hash = ?").bind(username, passHash).first();
        return result ? result.id : null;
    } catch (e) { return null; }
}

export async function onRequest(context) {
    const { request, env } = context;
    const currentUserId = await tarkistaValtuutus(request, env);
    
    if (!currentUserId) return new Response(JSON.stringify({ error: 'Ei valtuuksia.' }), { status: 401 });

    try {
        // Ladataan kaikki käyttäjät
        if (request.method === "GET") {
            const { results } = await env.DB.prepare("SELECT id, username, created_at FROM users ORDER BY created_at DESC").all();
            return new Response(JSON.stringify({ users: results }), { status: 200 });
        }

        // Poistetaan käyttäjä
        if (request.method === "DELETE") {
            const idToRemove = new URL(request.url).searchParams.get('id');
            if (!idToRemove) return new Response(JSON.stringify({ error: 'ID puuttuu.' }), { status: 400 });
            
            if (parseInt(idToRemove) === currentUserId) {
                return new Response(JSON.stringify({ error: 'Et voi poistaa omaa tunnustasi!' }), { status: 400 });
            }

            await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(idToRemove).run();
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        return new Response("Tuntematon metodi.", { status: 405 });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
