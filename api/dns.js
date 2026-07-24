// api/dns.js - Hetzner Cloud DNS API proxy route
import { Router } from 'express';

const router = Router();
const HETZNER_CLOUD_API = 'https://api.hetzner.cloud/v1';

function getHetznerCloudHeaders() {
  return {
    'Authorization': `Bearer ${String(process.env.HETZNER_API_KEY || '').trim()}`,
    'Content-Type': 'application/json'
  };
}

function checkApiKey(res) {
  if (!process.env.HETZNER_API_KEY) {
    res.status(500).json({ error: 'HETZNER_API_KEY ei ole asetettu palvelimella.' });
    return false;
  }
  return true;
}

// GET /zones - List all DNS zones
router.get('/zones', async (_req, res) => {
  if (!checkApiKey(res)) return;
  try {
    const response = await fetch(`${HETZNER_CLOUD_API}/zones`, {
      headers: getHetznerCloudHeaders()
    });
    const data = await response.json();
    
    if (!response.ok) {
        return res.status(response.status).json({ error: data.error?.message || 'Virhe vyöhykkeiden haussa.' });
    }

    return res.status(200).json({ zones: data.zones || [] });
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-vyöhykkeiden haussa.', details: error.message });
  }
});

// GET - Fetch all DNS records for a zone (zone_id as query param)
router.get('/', async (req, res) => {
  if (!checkApiKey(res)) return;
  const zoneId = req.query.zone_id;
  if (!zoneId) {
    return res.status(400).json({ error: 'zone_id on pakollinen query-parametri.' });
  }
  try {
    const response = await fetch(`${HETZNER_CLOUD_API}/zones/${zoneId}/rrsets`, {
      headers: getHetznerCloudHeaders()
    });
    const data = await response.json();

    if (!response.ok) {
        return res.status(response.status).json({ error: data.error?.message || 'Virhe tietueiden haussa.' });
    }

    // Uudessa Cloud API:ssa tietueet ovat "RRsettejä". Puretaan ne litteäksi listaksi frontendia varten.
    const mappedRecords = [];
    for (const rrset of data.rrsets || []) {
      for (const record of rrset.records || []) {
        mappedRecords.push({
          id: `${rrset.name}/${rrset.type}|${record.value}`, // Yksilöllinen yhdistelmä-ID poistoa ja muokkausta varten
          name: rrset.name,
          type: rrset.type,
          ttl: rrset.ttl,
          value: record.value
        });
      }
    }
    return res.status(200).json({ records: mappedRecords });
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueiden haussa.', details: error.message });
  }
});

// POST - Create a new DNS record
router.post('/', async (req, res) => {
  if (!checkApiKey(res)) return;
  try {
    const { zone_id, type, name, value, ttl } = req.body || {};

    if (!zone_id) return res.status(400).json({ error: 'zone_id on pakollinen.' });
    if (!type || name === undefined || !value) return res.status(400).json({ error: 'Tyyppi, nimi ja arvo ovat pakollisia.' });

    let safeName = String(name).trim();
    if (safeName === '') safeName = '@'; // Cloud API vaatii root-domainille @-merkin
    const safeType = String(type).toUpperCase();
    const safeValue = String(value).trim();
    
    // 1. Tarkista onko kyseinen RRset (nimi + tyyppi) jo olemassa
    const rrsetRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets/${encodeURIComponent(safeName)}/${safeType}`, {
      headers: getHetznerCloudHeaders()
    });

    if (rrsetRes.ok) {
        // RRset on jo olemassa, lisätään uusi arvo muiden joukkoon
        const data = await rrsetRes.json();
        const records = data.rrset.records || [];
        
        if (records.some(r => r.value === safeValue)) {
            return res.status(400).json({ error: 'Tietue on jo olemassa.' });
        }
        
        records.push({ value: safeValue });
        
        const updateRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets/${encodeURIComponent(safeName)}/${safeType}/actions/set_records`, {
            method: 'POST',
            headers: getHetznerCloudHeaders(),
            body: JSON.stringify({ records })
        });
        
        const updateData = await updateRes.json();
        return res.status(updateRes.status).json(updateData);
    } else {
        // 2. RRset ei ole olemassa, luodaan täysin uusi
        const createRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets`, {
            method: 'POST',
            headers: getHetznerCloudHeaders(),
            body: JSON.stringify({
                name: safeName,
                type: safeType,
                ttl: Number.parseInt(ttl, 10) || 300,
                records: [{ value: safeValue }]
            })
        });
        const createData = await createRes.json();
        return res.status(createRes.status).json(createData);
    }
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen luonnissa.', details: error.message });
  }
});

// PUT - Update an existing DNS record
router.put('/:id', async (req, res) => {
  if (!checkApiKey(res)) return;
  try {
    const idParam = req.params.id;
    const { zone_id, type, name, value } = req.body || {};

    if (!zone_id) return res.status(400).json({ error: 'zone_id on pakollinen.' });
    if (!type || name === undefined || !value) return res.status(400).json({ error: 'Tyyppi, nimi ja arvo ovat pakollisia.' });

    const firstPipe = idParam.indexOf('|');
    if (firstPipe === -1) return res.status(400).json({ error: 'Virheellinen ID-formaatti.' });
    const oldValue = idParam.substring(firstPipe + 1);

    let safeName = String(name).trim();
    if (safeName === '') safeName = '@';
    const safeType = String(type).toUpperCase();
    const safeValue = String(value).trim();

    // Hae olemassa oleva RRset
    const rrsetRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets/${encodeURIComponent(safeName)}/${safeType}`, {
      headers: getHetznerCloudHeaders()
    });
    
    if (!rrsetRes.ok) {
        return res.status(rrsetRes.status).json(await rrsetRes.json());
    }

    const data = await rrsetRes.json();
    const records = data.rrset.records || [];

    // Vaihda vanha arvo uuteen
    let found = false;
    for (const r of records) {
        if (r.value === oldValue) {
            r.value = safeValue;
            found = true;
            break;
        }
    }

    if (!found) records.push({ value: safeValue }); // Varatoimenpide

    const updateRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets/${encodeURIComponent(safeName)}/${safeType}/actions/set_records`, {
        method: 'POST',
        headers: getHetznerCloudHeaders(),
        body: JSON.stringify({ records })
    });
    
    return res.status(updateRes.status).json(await updateRes.json());
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen päivityksessä.', details: error.message });
  }
});

// DELETE - Delete a DNS record
router.delete('/:id', async (req, res) => {
  if (!checkApiKey(res)) return;
  try {
    const zone_id = req.query.zone_id;
    if (!zone_id) return res.status(400).json({ error: 'zone_id on pakollinen query-parametri poistossa.' });

    const idParam = req.params.id; // Formaatti: "name/type|value"
    const firstPipe = idParam.indexOf('|');
    if (firstPipe === -1) return res.status(400).json({ error: 'Virheellinen ID-formaatti.' });
    
    const nameType = idParam.substring(0, firstPipe);
    const valueToRemove = idParam.substring(firstPipe + 1);

    const lastSlash = nameType.lastIndexOf('/');
    const safeName = nameType.substring(0, lastSlash);
    const safeType = nameType.substring(lastSlash + 1);

    // Hae RRset nähdäksemme jääkö muita tietueita
    const rrsetRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets/${encodeURIComponent(safeName)}/${safeType}`, {
        headers: getHetznerCloudHeaders()
    });
    
    if (!rrsetRes.ok) {
        return res.status(rrsetRes.status).json(await rrsetRes.json());
    }

    const data = await rrsetRes.json();
    const records = (data.rrset.records || []).filter(r => r.value !== valueToRemove);

    if (records.length === 0) {
        // Poista koko RRset jos muita arvoja ei jäänyt
        const delRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets/${encodeURIComponent(safeName)}/${safeType}`, {
            method: 'DELETE',
            headers: getHetznerCloudHeaders()
        });
        if (delRes.status === 200 || delRes.status === 204) {
            return res.json({ success: true });
        }
        return res.status(delRes.status).json(await delRes.json().catch(() => ({})));
    } else {
        // Päivitä RRset ja poista vain kyseinen arvo listasta
        const updateRes = await fetch(`${HETZNER_CLOUD_API}/zones/${zone_id}/rrsets/${encodeURIComponent(safeName)}/${safeType}/actions/set_records`, {
            method: 'POST',
            headers: getHetznerCloudHeaders(),
            body: JSON.stringify({ records })
        });
        return res.status(updateRes.status).json(await updateRes.json());
    }
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen poistossa.', details: error.message });
  }
});

export default router;
