// api/dns.js - OVHcloud DNS API route
import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();
const OVH_API_BASE = 'https://eu.api.ovh.com/1.0';

// Tarkistetaan, että tarvittavat API-avaimet löytyvät .env-tiedostosta
function checkApiKey(res) {
  const appKey = process.env.OVH_APPLICATION_KEY || process.env.OVH_APP_KEY;
  const appSecret = process.env.OVH_APPLICATION_SECRET || process.env.OVH_APP_SECRET;
  const consumerKey = process.env.OVH_CONSUMER_KEY;

  if (!appKey || !appSecret || !consumerKey) {
    res.status(500).json({ error: 'OVH API-avaimia (APPLICATION_KEY, APPLICATION_SECRET, CONSUMER_KEY) ei ole asetettu .env-tiedostoon.' });
    return false;
  }
  return true;
}

// Luodaan OVH:n vaatima SHA1-allekirjoitettu autentikointiotsikko
function getOvhHeaders(method, url, body = '') {
  const appKey = (process.env.OVH_APPLICATION_KEY || process.env.OVH_APP_KEY || '').trim();
  const appSecret = (process.env.OVH_APPLICATION_SECRET || process.env.OVH_APP_SECRET || '').trim();
  const consumerKey = (process.env.OVH_CONSUMER_KEY || '').trim();

  const timestamp = Math.floor(Date.now() / 1000);
  const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';

  // Kaava: "$1$" + SHA1_HEX(AS + "+" + CK + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TIMESTAMP)
  const toSign = `${appSecret}+${consumerKey}+${method.toUpperCase()}+${url}+${bodyStr}+${timestamp}`;
  const signature = '$1$' + crypto.createHash('sha1').update(toSign).digest('hex');

  return {
    'X-Ovh-Application': appKey,
    'X-Ovh-Timestamp': String(timestamp),
    'X-Ovh-Signature': signature,
    'X-Ovh-Consumer': consumerKey,
    'Content-Type': 'application/json'
  };
}

// Estetään OVH:n 401/403-virheiden valuminen frontendille, ettei hallintapaneeli heitä käyttäjää ulos[span_0](start_span)[span_0](end_span)
function getSafeStatus(status) {
  if (status === 401 || status === 403) return 502; // 502 Bad Gateway
  return status;
}

// Apufunktio: OVH vaatii vyöhykkeen "päivityksen" (refresh), jotta DNS-muutokset astuvat voimaan
async function refreshZone(zoneName) {
  const url = `${OVH_API_BASE}/domain/zone/${encodeURIComponent(zoneName)}/refresh`;
  await fetch(url, {
    method: 'POST',
    headers: getOvhHeaders('POST', url)
  }).catch(() => {});
}

// GET /zones - Listaa kaikki DNS-vyöhykkeet (esim. sorola.fi, srla.fi)
router.get('/zones', async (_req, res) => {
  if (!checkApiKey(res)) return;
  const url = `${OVH_API_BASE}/domain/zone`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getOvhHeaders('GET', url)
    });
    const data = await response.json().catch(() => ([]));

    if (!response.ok) {
      return res.status(getSafeStatus(response.status)).json({
        error: data.message || 'OVH API hylkäsi pyynnön. Tarkista API-avaimet.'
      });
    }

    // Muotoillaan lista frontendille sopivaan muotoon [{ id: "sorola.fi", name: "sorola.fi" }]
    const zones = (Array.isArray(data) ? data : []).map(zoneName => ({
      id: zoneName,
      name: zoneName
    }));

    return res.status(200).json({ zones });
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-vyöhykkeiden haussa.', details: error.message });
  }
});

// GET / - Hae valitun vyöhykkeen kaikki DNS-tietueet
router.get('/', async (req, res) => {
  if (!checkApiKey(res)) return;
  const zoneId = req.query.zone_id;
  if (!zoneId) {
    return res.status(400).json({ error: 'zone_id on pakollinen query-parametri.' });
  }

  const listUrl = `${OVH_API_BASE}/domain/zone/${encodeURIComponent(zoneId)}/record`;

  try {
    // 1. Haetaan kaikkien tietueiden ID-lista
    const response = await fetch(listUrl, {
      method: 'GET',
      headers: getOvhHeaders('GET', listUrl)
    });
    const ids = await response.json().catch(() => ([]));

    if (!response.ok) {
      return res.status(getSafeStatus(response.status)).json({ error: ids.message || 'Virhe tietueiden haussa.' });
    }

    // 2. Haetaan tietueiden yksityiskohdat rinnakkain (Promise.all)
    const recordsPromises = (Array.isArray(ids) ? ids : []).map(async (id) => {
      const detailUrl = `${OVH_API_BASE}/domain/zone/${encodeURIComponent(zoneId)}/record/${id}`;
      const resDetail = await fetch(detailUrl, {
        method: 'GET',
        headers: getOvhHeaders('GET', detailUrl)
      });
      if (!resDetail.ok) return null;
      return resDetail.json();
    });

    const rawRecords = (await Promise.all(recordsPromises)).filter(Boolean);

    // 3. Mapataan OVH:n data vastaamaan käyttöliittymän odottamaa muotoa
    const mappedRecords = rawRecords.map(rec => ({
      id: String(rec.id),
      name: rec.subDomain || '@',
      type: rec.fieldType,
      ttl: rec.ttl || 3600,
      value: rec.target
    }));

    return res.status(200).json({ records: mappedRecords });
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueiden haussa.', details: error.message });
  }
});

// POST / - Luo uusi DNS-tietue
router.post('/', async (req, res) => {
  if (!checkApiKey(res)) return;
  try {
    const { zone_id, type, name, value, ttl } = req.body || {};

    if (!zone_id) return res.status(400).json({ error: 'zone_id on pakollinen.' });
    if (!type || name === undefined || !value) return res.status(400).json({ error: 'Tyyppi, nimi ja arvo ovat pakollisia.' });

    let safeName = String(name).trim();
    // OVH käyttää juuriverkkotunnukselle tyhjää merkkijonoa "" eikä "@"
    if (safeName === '@') safeName = '';
    const safeType = String(type).toUpperCase();
    const safeValue = String(value).trim();
    const safeTtl = Number.parseInt(ttl, 10) || 3600;

    const url = `${OVH_API_BASE}/domain/zone/${encodeURIComponent(zone_id)}/record`;
    const payload = JSON.stringify({
      fieldType: safeType,
      subDomain: safeName,
      target: safeValue,
      ttl: safeTtl
    });

    const createRes = await fetch(url, {
      method: 'POST',
      headers: getOvhHeaders('POST', url, payload),
      body: payload
    });
    const createData = await createRes.json().catch(() => ({}));

    if (createRes.ok) {
      // Aktivoidaan muutos OVH:n nimipalvelimille
      await refreshZone(zone_id);
    }

    return res.status(getSafeStatus(createRes.status)).json(createData);
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen luonnissa.', details: error.message });
  }
});

// PUT /:id - Päivitä olemassa oleva DNS-tietue
router.put('/:id', async (req, res) => {
  if (!checkApiKey(res)) return;
  try {
    const recordId = req.params.id;
    const { zone_id, name, value, ttl } = req.body || {};

    if (!zone_id) return res.status(400).json({ error: 'zone_id on pakollinen.' });
    if (!recordId) return res.status(400).json({ error: 'Tietueen ID puuttuu.' });

    let safeName = String(name || '').trim();
    if (safeName === '@') safeName = '';
    const safeValue = String(value || '').trim();
    const safeTtl = Number.parseInt(ttl, 10) || 3600;

    const url = `${OVH_API_BASE}/domain/zone/${encodeURIComponent(zone_id)}/record/${encodeURIComponent(recordId)}`;
    const payload = JSON.stringify({
      subDomain: safeName,
      target: safeValue,
      ttl: safeTtl
    });

    const updateRes = await fetch(url, {
      method: 'PUT',
      headers: getOvhHeaders('PUT', url, payload),
      body: payload
    });

    const updateData = await updateRes.json().catch(() => ({}));

    if (updateRes.ok) {
      await refreshZone(zone_id);
      return res.status(200).json({ success: true, ...updateData });
    }

    return res.status(getSafeStatus(updateRes.status)).json(updateData);
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen päivityksessä.', details: error.message });
  }
});

// DELETE /:id - Poista DNS-tietue
router.delete('/:id', async (req, res) => {
  if (!checkApiKey(res)) return;
  try {
    const zone_id = req.query.zone_id;
    const recordId = req.params.id;

    if (!zone_id) return res.status(400).json({ error: 'zone_id on pakollinen query-parametri poistossa.' });
    if (!recordId) return res.status(400).json({ error: 'Tietueen ID puuttuu.' });

    const url = `${OVH_API_BASE}/domain/zone/${encodeURIComponent(zone_id)}/record/${encodeURIComponent(recordId)}`;

    const delRes = await fetch(url, {
      method: 'DELETE',
      headers: getOvhHeaders('DELETE', url)
    });

    if (delRes.ok || delRes.status === 404) {
      await refreshZone(zone_id);
      return res.json({ success: true });
    }

    const errorData = await delRes.json().catch(() => ({}));
    return res.status(getSafeStatus(delRes.status)).json(errorData);
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen poistossa.', details: error.message });
  }
});

export default router;
