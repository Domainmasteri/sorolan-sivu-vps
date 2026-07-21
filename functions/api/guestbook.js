// functions/api/guestbook.js

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
        const result = await env.DB.prepare(
            "SELECT id FROM users WHERE username = ? AND password_hash = ?"
        ).bind(username, passHash).first();
        return !!result;
    } catch (e) { return false; }
}

async function varmistaTaulu(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS guestbook (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_admin INTEGER NOT NULL DEFAULT 0,
            admin_reply TEXT
        )
    `).run();
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env["GB-DB"];

    if (!db) {
        return json({ error: 'Tietokantasidosta ei löydy (GB-DB).' }, 500);
    }

    try {
        // GET - Julkinen: hae kaikki viestit
        if (request.method === "GET") {
            await varmistaTaulu(db);
            const result = await db.prepare(
                "SELECT id, name, message, created_at, is_admin, admin_reply FROM guestbook ORDER BY created_at DESC"
            ).all();
            return json({ messages: result.results });
        }

        // POST - Julkinen: lähetä uusi viesti (bottisuoja tarkistetaan)
        if (request.method === "POST") {
            const body = await request.json();
            const { name, message, captcha_a, captcha_b, captcha_op, captcha_answer } = body;

            if (!name || !name.trim()) return json({ error: 'Nimi on pakollinen.' }, 400);
            if (!message || !message.trim()) return json({ error: 'Viesti on pakollinen.' }, 400);
            if (name.trim().length > 100) return json({ error: 'Nimi on liian pitkä (max 100 merkkiä).' }, 400);
            if (message.trim().length > 2000) return json({ error: 'Viesti on liian pitkä (max 2000 merkkiä).' }, 400);

            // Tarkista bottisuoja
            const a = parseInt(captcha_a);
            const b = parseInt(captcha_b);
            const answer = parseInt(captcha_answer);

            if (isNaN(a) || isNaN(b) || isNaN(answer)) {
                return json({ error: 'Bottisuojan tiedot puuttuvat tai ovat virheelliset.' }, 400);
            }

            let expected;
            if (captcha_op === '+') expected = a + b;
            else if (captcha_op === '-') expected = a - b;
            else if (captcha_op === '*') expected = a * b;
            else return json({ error: 'Virheellinen laskutoimituksen tyyppi.' }, 400);

            if (answer !== expected) {
                return json({ error: 'Bottisuojausta ei läpäisty. Tarkista laskutoimituksen tulos.' }, 400);
            }

            await varmistaTaulu(db);
            await db.prepare(
                "INSERT INTO guestbook (name, message, is_admin) VALUES (?, ?, 0)"
            ).bind(name.trim(), message.trim()).run();

            return json({ success: true });
        }

        // Hallinnolliset toiminnot vaativat kirjautumisen
        if (!(await tarkistaValtuutus(request, env))) {
            return json({ error: 'Ei valtuuksia. Kirjaudu uudelleen.' }, 401);
        }

        // PATCH - Lisää vastaus tai ylläpidon oma viesti
        if (request.method === "PATCH") {
            const body = await request.json();
            const { action } = body;

            if (action === 'reply') {
                const { id, reply } = body;
                if (!id) return json({ error: 'Viestin ID puuttuu.' }, 400);
                if (!reply || !reply.trim()) return json({ error: 'Vastaus on pakollinen.' }, 400);
                if (reply.trim().length > 2000) return json({ error: 'Vastaus on liian pitkä (max 2000 merkkiä).' }, 400);
                await db.prepare(
                    "UPDATE guestbook SET admin_reply = ? WHERE id = ?"
                ).bind(reply.trim(), id).run();
                return json({ success: true });
            }

            if (action === 'admin_message') {
                const { name, message } = body;
                if (!name || !name.trim()) return json({ error: 'Nimi on pakollinen.' }, 400);
                if (!message || !message.trim()) return json({ error: 'Viesti on pakollinen.' }, 400);
                if (name.trim().length > 100) return json({ error: 'Nimi on liian pitkä (max 100 merkkiä).' }, 400);
                if (message.trim().length > 2000) return json({ error: 'Viesti on liian pitkä (max 2000 merkkiä).' }, 400);
                await varmistaTaulu(db);
                await db.prepare(
                    "INSERT INTO guestbook (name, message, is_admin) VALUES (?, ?, 1)"
                ).bind(name.trim(), message.trim()).run();
                return json({ success: true });
            }

            return json({ error: 'Tuntematon toiminto.' }, 400);
        }

        // DELETE - Poista viesti
        if (request.method === "DELETE") {
            const url = new URL(request.url);
            const id = url.searchParams.get('id');
            if (!id) return json({ error: 'Viestin ID puuttuu.' }, 400);
            await db.prepare("DELETE FROM guestbook WHERE id = ?").bind(id).run();
            return json({ success: true });
        }

        return new Response("Tuntematon metodi.", { status: 405 });

    } catch (err) {
        return json({ error: 'Palvelinvirhe.' }, 500);
    }
}
