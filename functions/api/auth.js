// functions/api/auth.js
async function luoHash(teksti) {
    const msgBuffer = new TextEncoder().encode(teksti);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
    const { request, env } = context;
    
    try {
        const body = await request.json();
        
        // 1. KIRJAUTUMINEN
        if (body.action === 'login') {
            const { username, password } = body;
            if (!username || !password) return new Response(JSON.stringify({ error: 'Tunnus ja salasana vaaditaan.' }), { status: 400 });

            const passHash = await luoHash(password);

            const result = await env.DB.prepare(
                "SELECT id FROM users WHERE username = ? AND password_hash = ?"
            ).bind(username, passHash).first();

            if (result) {
                return new Response(JSON.stringify({ success: true }), { status: 200 });
            } else {
                return new Response(JSON.stringify({ error: 'Väärä käyttäjätunnus tai salasana.' }), { status: 401 });
            }
        }
        
        // 2. REKISTERÖINTI
        if (body.action === 'register') {
            const { inviteCode, username, password } = body;
            if (!inviteCode || !username || !password) return new Response(JSON.stringify({ error: 'Kaikki kentät vaaditaan.' }), { status: 400 });

            if (username.length < 3 || password.length < 6) {
                return new Response(JSON.stringify({ error: 'Tunnuksen minimipituus 3, salasanan 6 merkkiä.' }), { status: 400 });
            }

            // TARKISTETAAN KUTSUKOODI SELKOKIELISENÄ
            const inviteResult = await env.DB.prepare(
                "SELECT id FROM invites WHERE code_hash = ? AND is_used = 0"
            ).bind(inviteCode).first();

            if (!inviteResult) {
                return new Response(JSON.stringify({ error: 'Kutsukoodi on virheellinen tai jo käytetty.' }), { status: 400 });
            }

            const userCheck = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
            if (userCheck) {
                return new Response(JSON.stringify({ error: 'Käyttäjätunnus on jo varattu.' }), { status: 400 });
            }

            const passHash = await luoHash(password);
            
            await env.DB.batch([
                env.DB.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").bind(username, passHash),
                env.DB.prepare("UPDATE invites SET is_used = 1 WHERE id = ?").bind(inviteResult.id)
            ]);

            return new Response(JSON.stringify({ success: true, message: 'Käyttäjä luotu.' }), { status: 200 });
        }

        // 3. SALASANAN VAIHTO
        if (body.action === 'change_password') {
            const { username, oldPassword, newPassword } = body;
            if (!username || !oldPassword || !newPassword) return new Response(JSON.stringify({ error: 'Kaikki kentät vaaditaan.' }), { status: 400 });
            if (newPassword.length < 6) return new Response(JSON.stringify({ error: 'Uuden salasanan minimipituus on 6 merkkiä.' }), { status: 400 });

            const oldHash = await luoHash(oldPassword);
            const userCheck = await env.DB.prepare("SELECT id FROM users WHERE username = ? AND password_hash = ?").bind(username, oldHash).first();

            if (!userCheck) {
                return new Response(JSON.stringify({ error: 'Nykyinen salasana on väärin.' }), { status: 401 });
            }

            const newHash = await luoHash(newPassword);
            await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, userCheck.id).run();

            return new Response(JSON.stringify({ success: true, message: 'Salasana vaihdettu.' }), { status: 200 });
        }

        return new Response(JSON.stringify({ error: 'Tuntematon pyyntö.' }), { status: 400 });

    } catch (err) {
        return new Response(JSON.stringify({ error: 'Palvelinvirhe.', details: err.message }), { status: 500 });
    }
}