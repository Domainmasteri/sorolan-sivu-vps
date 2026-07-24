// api/dns.js - Hetzner DNS API proxy route
import { Router } from 'express';

const router = Router();
const HETZNER_DNS_API = 'https://dns.hetzner.com/api/v1';

function getHetznerHeaders() {
  return {
    'Auth-API-Token': process.env.HETZNER_API_KEY,
    'Content-Type': 'application/json'
  };
}

function checkConfig(res) {
  if (!process.env.HETZNER_API_KEY) {
    res.status(500).json({ error: 'HETZNER_API_KEY ei ole asetettu palvelimella.' });
    return false;
  }
  if (!process.env.HETZNER_DNS_ZONE_ID) {
    res.status(500).json({ error: 'HETZNER_DNS_ZONE_ID ei ole asetettu palvelimella.' });
    return false;
  }
  return true;
}

// GET - Fetch all DNS records for the configured zone
router.get('/', async (_req, res) => {
  if (!checkConfig(res)) return;
  try {
    const zoneId = process.env.HETZNER_DNS_ZONE_ID;
    const response = await fetch(`${HETZNER_DNS_API}/records?zone_id=${encodeURIComponent(zoneId)}`, {
      headers: getHetznerHeaders()
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueiden haussa.', details: error.message });
  }
});

// POST - Create a new DNS record
router.post('/', async (req, res) => {
  if (!checkConfig(res)) return;
  try {
    const zoneId = process.env.HETZNER_DNS_ZONE_ID;
    const { type, name, value, ttl } = req.body || {};

    if (!type || !name || !value) {
      return res.status(400).json({ error: 'Tyyppi, nimi ja arvo ovat pakollisia.' });
    }

    const body = {
      zone_id: zoneId,
      type: String(type).toUpperCase(),
      name: String(name),
      value: String(value),
      ttl: Number.parseInt(ttl, 10) || 300
    };

    const response = await fetch(`${HETZNER_DNS_API}/records`, {
      method: 'POST',
      headers: getHetznerHeaders(),
      body: JSON.stringify(body)
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen luonnissa.', details: error.message });
  }
});

// PUT - Update an existing DNS record
router.put('/:id', async (req, res) => {
  if (!checkConfig(res)) return;
  try {
    const zoneId = process.env.HETZNER_DNS_ZONE_ID;
    const recordId = req.params.id;
    const { type, name, value, ttl } = req.body || {};

    if (!type || !name || !value) {
      return res.status(400).json({ error: 'Tyyppi, nimi ja arvo ovat pakollisia.' });
    }

    const body = {
      zone_id: zoneId,
      type: String(type).toUpperCase(),
      name: String(name),
      value: String(value),
      ttl: Number.parseInt(ttl, 10) || 300
    };

    const response = await fetch(`${HETZNER_DNS_API}/records/${encodeURIComponent(recordId)}`, {
      method: 'PUT',
      headers: getHetznerHeaders(),
      body: JSON.stringify(body)
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen päivityksessä.', details: error.message });
  }
});

// DELETE - Delete a DNS record
router.delete('/:id', async (req, res) => {
  if (!checkConfig(res)) return;
  try {
    const recordId = req.params.id;
    const response = await fetch(`${HETZNER_DNS_API}/records/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
      headers: getHetznerHeaders()
    });

    if (response.status === 200 || response.status === 204) {
      return res.json({ success: true });
    }

    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe DNS-tietueen poistossa.', details: error.message });
  }
});

export default router;
