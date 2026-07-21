// functions/api/links.js
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
        const purettu = atob(base64Token);
        const [username, password] = purettu.split(":");
        if (!username || !password) return false;
        
        const passHash = await luoHash(password);
        const result = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND password_hash = ?").bind(username, passHash).first();
        return !!result;
    } catch (e) { return false; }
}

function luoSatunnainenPolku(pituus = 5) {
    const merkit = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const randomValues = new Uint8Array(pituus);
    crypto.getRandomValues(randomValues);
    return Array.from(randomValues).map(v => merkit[v % merkit.length]).join('');
}

async function varmistaSrlTaulu(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS srl_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_path TEXT NOT NULL UNIQUE,
            original_url TEXT NOT NULL,
            clicks INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

export async function onRequest(context) {
    const { request, env } = context;
    
    if (!(await tarkistaValtuutus(request, env))) {
        return new Response(JSON.stringify({ error: 'Ei valtuuksia. Kirjaudu uudelleen.' }), { status: 401 });
    }

    try {
        const url = new URL(request.url);
        await varmistaSrlTaulu(env);

        // GET - Ladataan molempien domainien linkit erikseen
        if (request.method === "GET") {
            const sorola = await env.DB.prepare("SELECT * FROM links ORDER BY created_at DESC").all();
            const srla = await env.DB.prepare("SELECT * FROM srla_links ORDER BY created_at DESC").all();
            const srl = await env.DB.prepare("SELECT * FROM srl_links ORDER BY created_at DESC").all();
            
            return new Response(JSON.stringify({ 
                sorola: sorola.results, 
                srla: srla.results,
                srl: srl.results
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // POST - Luodaan uusi linkki
        if (request.method === "POST") {
            const body = await request.json();
            const { originalURL, domain } = body;
            let path = body.path;

            if (!originalURL) return new Response(JSON.stringify({ error: "Kohdeosoite puuttuu." }), { status: 400 });

            if (!path || path.trim() === "") path = luoSatunnainenPolku();
            else path = path.trim().replace(/[^a-zA-Z0-9_-]/g, "");

            try {
                // Varmistetaan, että clicks on 0 luodessa
                if (domain === 'soro.la') {
                    await env.DB.prepare("INSERT INTO links (short_path, original_url, clicks) VALUES (?, ?, 0)").bind(path, originalURL).run();
                } else if (domain === 'srla.fi') {
                    await env.DB.prepare("INSERT INTO srla_links (short_path, original_url, clicks) VALUES (?, ?, 0)").bind(path, originalURL).run();
                } else if (domain === 'srl.la') {
                    await env.DB.prepare("INSERT INTO srl_links (short_path, original_url, clicks) VALUES (?, ?, 0)").bind(path, originalURL).run();
                } else {
                    return new Response(JSON.stringify({ error: "Virheellinen domain." }), { status: 400 });
                }
                return new Response(JSON.stringify({ success: true, path: path, domain: domain }), { status: 200 });
            } catch (dbError) {
                if (dbError.message.includes('UNIQUE')) return new Response(JSON.stringify({ error: "Tämä lyhenne on jo käytössä!" }), { status: 400 });
                throw dbError;
            }
        }

        // PUT - Muokataan olemassa olevaa linkkiä
        if (request.method === "PUT") {
            const body = await request.json();
            const { domain, path, newOriginalURL } = body;

            if (!newOriginalURL) return new Response(JSON.stringify({ error: "Uusi kohdeosoite puuttuu." }), { status: 400 });
            
            if (domain === 'soro.la') {
                await env.DB.prepare("UPDATE links SET original_url = ? WHERE short_path = ?").bind(newOriginalURL, path).run();
            } else if (domain === 'srla.fi') {
                await env.DB.prepare("UPDATE srla_links SET original_url = ? WHERE short_path = ?").bind(newOriginalURL, path).run();
            } else if (domain === 'srl.la') {
                await env.DB.prepare("UPDATE srl_links SET original_url = ? WHERE short_path = ?").bind(newOriginalURL, path).run();
            } else {
                return new Response(JSON.stringify({ error: "Virheellinen domain." }), { status: 400 });
            }
            
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        // DELETE - Poistetaan linkki
        if (request.method === "DELETE") {
            const pathToRemove = url.searchParams.get('path');
            const domainToRemove = url.searchParams.get('domain');
            
            if (!pathToRemove || !domainToRemove) return new Response(JSON.stringify({ error: 'Tiedot puuttuvat' }), { status: 400 });

            if (domainToRemove === 'soro.la') {
                await env.DB.prepare("DELETE FROM links WHERE short_path = ?").bind(pathToRemove).run();
            } else if (domainToRemove === 'srla.fi') {
                await env.DB.prepare("DELETE FROM srla_links WHERE short_path = ?").bind(pathToRemove).run();
            } else if (domainToRemove === 'srl.la') {
                await env.DB.prepare("DELETE FROM srl_links WHERE short_path = ?").bind(pathToRemove).run();
            } else {
                return new Response(JSON.stringify({ error: "Virheellinen domain." }), { status: 400 });
            }
            
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        return new Response("Tuntematon metodi.", { status: 405 });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}