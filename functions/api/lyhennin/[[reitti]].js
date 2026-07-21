// functions/api/[[reitti]].js

function luoSatunnainenPolku(pituus = 5) {
  const merkit = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint8Array(pituus);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues).map(v => merkit[v % merkit.length]).join('');
}

const DOMAIN_CONFIG = {
  "srla.fi": { baseUrl: "https://srla.fi" },
  "srl.la": { baseUrl: "https://srl.la" }
};

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
  const url = new URL(request.url);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Tunnistetaan selainlaajennuksen tekemä kutsu
  if (url.pathname.includes("/create")) {
    const kohdeUrl = url.searchParams.get("url");
    let koodi = url.searchParams.get("code");
    const domain = (url.searchParams.get("domain") || "srla.fi").toLowerCase();
    const domainConfig = DOMAIN_CONFIG[domain];
    // Selainlaajennuksen lähettämä "secret" (salasana) otetaan vastaan, 
    // mutta sitä ei tällä hetkellä tallenneta tietokantaan, koska uusi 
    // tietokantataulumme ei tue vielä salasanasuojattuja linkkejä.
    
    if (!kohdeUrl) {
      return new Response(JSON.stringify({ error: "URL puuttuu" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!domainConfig) {
      return new Response(JSON.stringify({ error: "Virheellinen domain." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (domain === "srl.la") {
      await varmistaSrlTaulu(env);
    }

    // Jos koodia ei ole annettu, luodaan satunnainen
    let path = koodi;
    if (!path || path.trim() === "") {
        path = luoSatunnainenPolku();
    } else {
        path = path.trim().replace(/[^a-zA-Z0-9_-]/g, ""); // Poistaa erikoismerkit turvallisuussyistä
    }

    try {
      // Tallennetaan valitun domainin tauluun
      if (domain === "srl.la") {
        await env.DB.prepare(
          "INSERT INTO srl_links (short_path, original_url) VALUES (?, ?)"
        ).bind(path, kohdeUrl).run();
      } else {
        await env.DB.prepare(
          "INSERT INTO srla_links (short_path, original_url) VALUES (?, ?)"
        ).bind(path, kohdeUrl).run();
      }
      
      // Laajennus odottaa vastausta muodossa: { success: true, shortUrl: "osoite" }
      const shortUrl = `${domainConfig.baseUrl}/${path}`;

      return new Response(JSON.stringify({ success: true, shortUrl: shortUrl }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });

    } catch (dbError) {
      // Jos tietokanta antaa UNIQUE-virheen, koodi on jo varattu
      if (dbError.message.includes('UNIQUE')) {
          return new Response(JSON.stringify({ error: "Tämä lyhenne on jo käytössä!" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Palvelinvirhe: " + dbError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
