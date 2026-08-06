import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { create as contentDisposition } from 'content-disposition';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';

import { db } from './db.js';
import { s3, bucketName, ensureBucketExists } from './storage.js';

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');
const stylesDir = process.env.STYLES_DIR || '/opt/sorola/styles';
const shortenerHomeUrl = process.env.SHORTENER_HOME_URL || 'https://sorola.fi/lyhennin';
const shortenerErrorUrl = process.env.SHORTENER_ERROR_URL || 'https://sorola.fi/lyhennin/error';

// 1 GB maksimikoko (1024 * 1024 * 1024 tavua)
const MAX_SHARE_FILE_SIZE_BYTES = 1 * 1024 * 1024 * 1024;
const uploadDir = path.join(__dirname, 'uploads');

// Varmistetaan, että uploads-kansio on olemassa
fs.mkdir(uploadDir, { recursive: true }).catch(err => console.error('Uploads-kansion luonti epäonnistui:', err));

function validateUploadFilePath(filePath) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(resolvedUploadDir + path.sep)) {
    throw new Error('Virheellinen tiedostopolku.');
  }
  return resolvedFilePath;
}

const uploadShare = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_SHARE_FILE_SIZE_BYTES }
});

const uploadAdmin = multer({ dest: uploadDir });

// Nopeudet & Rajoitukset (Rate limits)
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const pageLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 1200, standardHeaders: true, legacyHeaders: false });

async function resolveStaticHtmlPath(requestPath) {
  if (typeof requestPath !== 'string') return null;
  const trimmedPath = requestPath.replace(/^\/+|\/+$/g, '');
  if (!trimmedPath || path.extname(trimmedPath)) return null;

  const candidatePath = path.resolve(distPath, `${trimmedPath}.html`);
  const relativePath = path.relative(distPath, candidatePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;

  try {
    const stats = await fs.stat(candidatePath);
    return stats.isFile() ? candidatePath : null;
  } catch {
    return null;
  }
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rajoittimet reiteille
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/upload', uploadLimiter);
app.use(['/api/lyhennin', '/api/paste', '/api/upload'], (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
  });

  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }

  return next();
});

// URL-LYHENTIMEN OHITUS
app.use(async (req, res, next) => {
  try {
    const hostname = (req.hostname || '').replace(/^www\./, '').toLowerCase();
    const pathname = req.path.replace(/^\/+/, '');
    const table = resolveTableByDomain(hostname);

    if (!table) return next();
    if (!pathname) return res.redirect(302, shortenerHomeUrl);

    const reservedPrefixes = [
      'api', 'p', 's', 'd', 'jako', 'en', 'pastebin', 'tyylit', 'styles',
      'admin', 'ohjeet', 'ansioluettelot', 'qr', 'salasanat',
      'privacy', 'vieraskirja', 'makelink', 'json', 'base64', 'base64'
    ];
    const firstSegment = pathname.split('/')[0];

    if (reservedPrefixes.includes(firstSegment) || pathname.includes('.')) {
      return next();
    }

    const linkResult = await fetchLinkByPath(table, pathname);
    const match = linkResult.rows[0];

    if (!match?.original_url) {
      return res.redirect(302, shortenerErrorUrl);
    }

    void incrementLinkClicks(table, pathname).catch(() => {});
    return res.redirect(302, match.original_url);
  } catch {
    return res.redirect(302, shortenerErrorUrl);
  }
});

app.use('/styles', pageLimiter, express.static(stylesDir));
app.use(pageLimiter, express.static(distPath));

function luoSatunnainenPolku(pituus = 5) {
  const merkit = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let pathValue = '';
  for (let i = 0; i < pituus; i += 1) {
    pathValue += merkit[crypto.randomInt(0, merkit.length)];
  }
  return pathValue;
}

function hashPassword(password) {
  const iterations = 210000;
  const keyLength = 32;
  const digest = 'sha512';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest).toString('hex');
  return `pbkdf2$${iterations}$${digest}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number.parseInt(parts[1], 10);
  const digest = parts[2];
  const salt = parts[3];
  const expected = parts[4];

  if (!iterations || !digest || !salt || !expected) return false;

  const derived = crypto.pbkdf2Sync(password, salt, iterations, expected.length / 2, digest).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expected, 'hex'));
}

function parseBasicBearer(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = Buffer.from(authHeader.slice(7), 'base64').toString('utf8');
    const [username, password] = decoded.split(':');
    if (!username || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

function resolveTableByDomain(domainOrHost) {
  switch (domainOrHost) {
    case 'soro.la': return 'links';
    case 'srla.fi': return 'srla_links';
    case 'srl.la': return 'srl_links';
    default: return null;
  }
}

async function fetchLinkByPath(table, shortPath) {
  return db.query(`SELECT original_url FROM ${table} WHERE short_path = $1 LIMIT 1`, [shortPath]);
}

async function incrementLinkClicks(table, shortPath) {
  return db.query(`UPDATE ${table} SET clicks = clicks + 1 WHERE short_path = $1`, [shortPath]);
}

async function insertShortLink(table, shortPath, originalUrl) {
  return db.query(`INSERT INTO ${table} (short_path, original_url, clicks) VALUES ($1, $2, 0)`, [shortPath, originalUrl]);
}

async function updateShortLink(table, shortPath, originalUrl) {
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw new Error('Invalid input');
  }
  return db.query(`UPDATE ${table} SET original_url = $1 WHERE short_path = $2`, [originalUrl, shortPath]);
}

async function deleteShortLink(table, shortPath) {
  return db.query(`DELETE FROM ${table} WHERE short_path = $1`, [shortPath]);
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateOriginalUrl(originalUrl) {
  try {
    const parsed = new URL(String(originalUrl || ''));
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeShortPath(pathValue) {
  const value = String(pathValue || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return value || luoSatunnainenPolku();
}

function resolveShortLinkTarget(domain) {
  const normalizedDomain = String(domain || 'srla.fi').trim().toLowerCase();
  const table = resolveTableByDomain(normalizedDomain);
  if (!table) {
    throw createHttpError(400, 'Virheellinen domain.');
  }

  let baseUrl = 'https://srla.fi';
  if (normalizedDomain === 'srl.la') baseUrl = 'https://srl.la';
  if (normalizedDomain === 'soro.la') baseUrl = 'https://soro.la';

  return { domain: normalizedDomain, table, baseUrl };
}

async function createShortLinkEntry({ originalUrl, domain, pathValue }) {
  if (!originalUrl) {
    throw createHttpError(400, 'Kohdeosoite puuttuu.');
  }
  if (!validateOriginalUrl(originalUrl)) {
    throw createHttpError(400, 'URL:n tulee alkaa http:// tai https://');
  }

  const { domain: normalizedDomain, table, baseUrl } = resolveShortLinkTarget(domain);
  const shortPath = sanitizeShortPath(pathValue);

  if (!shortPath) {
    throw createHttpError(400, 'Virheellinen lyhenne.');
  }

  try {
    await insertShortLink(table, shortPath, originalUrl);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(400, 'Tämä lyhenne on jo käytössä!');
    }
    throw error;
  }

  return { domain: normalizedDomain, path: shortPath, shortUrl: `${baseUrl}/${shortPath}` };
}

function isUniqueConstraintError(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '').toLowerCase();
  return code === '23505'
    || code === 'SQLITE_CONSTRAINT_UNIQUE'
    || code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    || message.includes('unique constraint failed');
}

async function haeKayttaja(req) {
  const parsed = parseBasicBearer(req);
  if (!parsed) return null;

  const result = await db.query('SELECT id, username, password_hash FROM users WHERE username = $1 LIMIT 1', [parsed.username]);
  const user = result.rows[0];
  if (!user || !verifyPassword(parsed.password, user.password_hash)) {
    return null;
  }

  return { id: user.id, username: user.username };
}

async function requireAuth(req, res, next) {
  try {
    const user = await haeKayttaja(req);
    if (!user) return res.status(401).json({ error: 'Ei valtuuksia. Kirjaudu uudelleen.' });
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Palvelinvirhe.', details: error.message });
  }
}

async function resolveToolApiKey(toolName) {
  const result = await db.query('SELECT api_key FROM tool_api_keys WHERE tool_name = $1 LIMIT 1', [toolName]);
  return String(result.rows[0]?.api_key || '').trim();
}

async function requireApiKey(req, res, next) {
  try {
    const apiKey = String(req.headers['x-api-key'] || req.query?.api_key || '').trim();
    if (!apiKey) return res.status(401).json({ error: 'API-avain puuttuu.' });

    const result = await db.query('SELECT id, owner_name FROM api_keys WHERE api_key = $1 AND is_active = 1 LIMIT 1', [apiKey]);
    const key = result.rows[0];
    if (!key) return res.status(403).json({ error: 'Virheellinen API-avain.' });

    req.apiKey = key;
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe.' });
  }
}

function requireWebTool(toolName) {
  return async (req, res, next) => {
    try {
      const configuredKey = await resolveToolApiKey(toolName);
      if (!configuredKey) {
        return res.status(503).json({ error: 'Työkalun API-avainta ei ole asetettu.' });
      }

      const origin = String(req.headers.origin || '').trim();
      const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
      const hasBrowserContextHeaders = Boolean(origin || secFetchSite);
      const isSameOriginRequest = Boolean(origin) && origin === `${req.protocol}://${req.get('host')}`;
      const isBrowserSameSite = ['same-origin', 'same-site', 'none'].includes(secFetchSite);

      if (!hasBrowserContextHeaders || !isSameOriginRequest || !isBrowserSameSite) {
        return requireApiKey(req, res, next);
      }

      req.apiKey = { id: null, owner_name: toolName, tool_name: toolName, is_web_tool: true };
      return next();
    } catch {
      return res.status(500).json({ error: 'Palvelinvirhe.' });
    }
  };
}

async function trackApiKeyUsage(apiKeyId) {
  await db.query('INSERT INTO api_key_usage (api_key_id) VALUES ($1)', [apiKeyId]);
}

const TOOL_KEY_NAMES = ['shortener', 'pastebin', 'share', 'mobile_app'];
function isValidToolName(toolName) {
  return TOOL_KEY_NAMES.includes(String(toolName || '').trim());
}

function normalizeToolName(toolName) {
  return String(toolName || '').trim();
}

async function getToolApiKeys(toolNames = TOOL_KEY_NAMES) {
  const placeholders = toolNames.map((_, index) => `$${index + 1}`).join(', ');
  const result = await db.query(
    `SELECT tool_name, api_key, updated_at FROM tool_api_keys WHERE tool_name IN (${placeholders}) ORDER BY tool_name ASC`,
    toolNames
  );

  const rowsByName = new Map(result.rows.map((row) => [row.tool_name, row]));
  return toolNames.map((toolName) => ({
    tool_name: toolName,
    api_key: rowsByName.get(toolName)?.api_key || '',
    updated_at: rowsByName.get(toolName)?.updated_at || null
  }));
}

async function upsertToolApiKey(toolName, apiKey) {
  await db.query(
    `INSERT INTO tool_api_keys (tool_name, api_key, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT(tool_name)
     DO UPDATE SET api_key = excluded.api_key, updated_at = CURRENT_TIMESTAMP`,
    [toolName, apiKey]
  );
}


function apiKeyUsageMiddleware(req, res, next) {
  res.on('finish', () => {
    if (req.apiKey?.id != null && res.statusCode < 400) {
      void trackApiKeyUsage(req.apiKey.id).catch(() => {});
    }
  });
  next();
}

function prefersEnglish(req) {
  const header = req.headers['accept-language'];
  if (!header) return false;
  const first = header.split(',')[0]?.trim().toLowerCase() || '';
  return first.startsWith('en');
}

async function streamS3BodyToResponse(body, res) {
  if (!body) return res.status(404).send('Tiedostoa ei löydy.');
  if (typeof body.pipe === 'function') {
    body.on('error', () => res.destroy());
    body.pipe(res);
    return;
  }
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    res.send(Buffer.from(bytes));
    return;
  }
  res.status(500).send('Tiedoston luku epäonnistui.');
}

app.post('/api/auth', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.action === 'login') {
      const { username, password } = body;
      if (!username || !password) return res.status(400).json({ error: 'Tunnus ja salasana vaaditaan.' });

      const result = await db.query('SELECT password_hash FROM users WHERE username = $1 LIMIT 1', [username]);
      const user = result.rows[0];
      if (user && verifyPassword(password, user.password_hash)) {
        return res.json({ success: true });
      }
      return res.status(401).json({ error: 'Väärä käyttäjätunnus tai salasana.' });
    }

    if (body.action === 'register') {
      const { inviteCode, username, password } = body;
      if (!inviteCode || !username || !password) return res.status(400).json({ error: 'Kaikki kentät vaaditaan.' });
      if (username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Tunnuksen minimipituus 3, salasanan 6 merkkiä.' });

      const inviteResult = await db.query('SELECT id FROM invites WHERE code_hash = $1 AND is_used = 0 LIMIT 1', [inviteCode]);
      if (!inviteResult.rows[0]) return res.status(400).json({ error: 'Kutsukoodi on virheellinen tai jo käytetty.' });

      const userCheck = await db.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
      if (userCheck.rows[0]) return res.status(400).json({ error: 'Käyttäjätunnus on jo varattu.' });

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hashPassword(password)]);
        await client.query('UPDATE invites SET is_used = 1 WHERE id = $1', [inviteResult.rows[0].id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      return res.json({ success: true, message: 'Käyttäjä luotu.' });
    }

    if (body.action === 'change_password') {
      const { username, oldPassword, newPassword } = body;
      if (!username || !oldPassword || !newPassword) return res.status(400).json({ error: 'Kaikki kentät vaaditaan.' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'Uuden salasanan minimipituus on 6 merkkiä.' });

      const result = await db.query('SELECT id, password_hash FROM users WHERE username = $1 LIMIT 1', [username]);
      const user = result.rows[0];
      if (!user || !verifyPassword(oldPassword, user.password_hash)) {
        return res.status(401).json({ error: 'Nykyinen salasana on väärin.' });
      }

      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), user.id]);
      return res.json({ success: true, message: 'Salasana vaihdettu.' });
    }

    return res.status(400).json({ error: 'Tuntematon pyyntö.' });
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe.' });
  }
});


app.get('/api/admin/tool-keys', requireAuth, async (_req, res) => {
  try {
    const toolKeys = await getToolApiKeys();
    return res.json({ toolKeys });
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe.', details: error.message });
  }
});

app.put('/api/admin/tool-keys', requireAuth, async (req, res) => {
  try {
    const toolName = normalizeToolName(req.body?.tool_name);
    const apiKey = String(req.body?.api_key || '').trim();

    if (!isValidToolName(toolName)) {
      return res.status(400).json({ error: 'Virheellinen työkalun nimi.' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'API-avain puuttuu.' });
    }

    await upsertToolApiKey(toolName, apiKey);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Palvelinvirhe.', details: error.message });
  }
});

app.get('/api/users', requireAuth, async (_req, res) => {
  try {
    const result = await db.query('SELECT id, username, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users', requireAuth, async (req, res) => {
  try {
    const idToRemove = Number.parseInt(req.query.id, 10);
    if (!idToRemove) return res.status(400).json({ error: 'ID puuttuu.' });
    if (idToRemove === req.user.id) return res.status(400).json({ error: 'Et voi poistaa omaa tunnustasi!' });

    await db.query('DELETE FROM users WHERE id = $1', [idToRemove]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/api-keys', requireAuth, async (_req, res) => {
  try {
    const keys = await db.query(`
      SELECT
        k.id,
        k.api_key,
        k.owner_name,
        k.is_active,
        k.created_at,
        COUNT(u.id) AS usage_count,
        MAX(u.used_at) AS last_used_at
      FROM api_keys k
      LEFT JOIN api_key_usage u ON u.api_key_id = k.id
      GROUP BY k.id, k.api_key, k.owner_name, k.is_active, k.created_at
      ORDER BY k.created_at DESC
    `);
    return res.json({ apiKeys: keys.rows });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/api-keys', requireAuth, async (req, res) => {
  try {
    const ownerName = String(req.body?.ownerName || '').trim();
    if (!ownerName) return res.status(400).json({ error: 'Omistajan nimi puuttuu.' });
    if (ownerName.length > 100) return res.status(400).json({ error: 'Omistajan nimi on liian pitkä.' });

    let apiKey;
    do {
      apiKey = crypto.randomBytes(24).toString('hex');
    } while ((await db.query('SELECT id FROM api_keys WHERE api_key = $1 LIMIT 1', [apiKey])).rows[0]);

    await db.query('INSERT INTO api_keys (api_key, owner_name) VALUES ($1, $2)', [apiKey, ownerName]);
    return res.json({ success: true, apiKey: { api_key: apiKey, owner_name: ownerName, is_active: 1 } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/api-keys', requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(req.body?.id, 10);
    const isActive = Number.parseInt(req.body?.isActive, 10);
    if (!id) return res.status(400).json({ error: 'API-avaimen ID puuttuu.' });
    if (![0, 1].includes(isActive)) return res.status(400).json({ error: 'Virheellinen tila.' });

    await db.query('UPDATE api_keys SET is_active = $1 WHERE id = $2', [isActive, id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/api-keys', requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: 'API-avaimen ID puuttuu.' });
    await db.query('DELETE FROM api_keys WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/invites', requireAuth, async (_req, res) => {
  try {
    const result = await db.query('SELECT id, code_hash AS code, is_used, created_at FROM invites ORDER BY created_at DESC');
    res.json({ invites: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/invites', requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code || '');
    if (!code || code.length < 3) {
      return res.status(400).json({ error: 'Koodin tulee olla vähintään 3 merkkiä.' });
    }
    try {
      await db.query('INSERT INTO invites (code_hash) VALUES ($1)', [code]);
      return res.json({ success: true });
    } catch {
      return res.status(400).json({ error: 'Tämä kutsukoodi on jo olemassa!' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/invites', requireAuth, async (req, res) => {
  try {
    const idToRemove = Number.parseInt(req.query.id, 10);
    if (!idToRemove) return res.status(400).json({ error: 'ID puuttuu.' });
    await db.query('DELETE FROM invites WHERE id = $1', [idToRemove]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/guestbook', async (_req, res) => {
  try {
    const result = await db.query('SELECT id, name, message, created_at, is_admin, admin_reply FROM guestbook ORDER BY created_at DESC');
    res.json({ messages: result.rows });
  } catch {
    res.status(500).json({ error: 'Palvelinvirhe.' });
  }
});

app.post('/api/guestbook', async (req, res) => {
  try {
    const { name, message, captcha_a, captcha_b, captcha_op, captcha_answer } = req.body || {};

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nimi on pakollinen.' });
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Viesti on pakollinen.' });
    if (String(name).trim().length > 100) return res.status(400).json({ error: 'Nimi on liian pitkä (max 100 merkkiä).' });
    if (String(message).trim().length > 2000) return res.status(400).json({ error: 'Viesti on liian pitkä (max 2000 merkkiä).' });

    const a = Number.parseInt(captcha_a, 10);
    const b = Number.parseInt(captcha_b, 10);
    const answer = Number.parseInt(captcha_answer, 10);

    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(answer)) {
      return res.status(400).json({ error: 'Bottisuojan tiedot puuttuvat tai ovat virheelliset.' });
    }

    let expected;
    if (captcha_op === '+') expected = a + b;
    else if (captcha_op === '-') expected = a - b;
    else if (captcha_op === '*') expected = a * b;
    else return res.status(400).json({ error: 'Virheellinen laskutoimituksen tyyppi.' });

    if (answer !== expected) {
      return res.status(400).json({ error: 'Bottisuojausta ei läpäisty. Tarkista laskutoimituksen tulos.' });
    }

    await db.query('INSERT INTO guestbook (name, message, is_admin) VALUES ($1, $2, 0)', [String(name).trim(), String(message).trim()]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Palvelinvirhe.' });
  }
});

app.patch('/api/guestbook', requireAuth, async (req, res) => {
  try {
    const { action } = req.body || {};

    if (action === 'reply') {
      const id = Number.parseInt(req.body?.id, 10);
      const reply = String(req.body?.reply || '');
      if (!id) return res.status(400).json({ error: 'Viestin ID puuttuu.' });
      if (!reply.trim()) return res.status(400).json({ error: 'Vastaus on pakollinen.' });
      if (reply.trim().length > 2000) return res.status(400).json({ error: 'Vastaus on liian pitkä (max 2000 merkkiä).' });
      await db.query('UPDATE guestbook SET admin_reply = $1 WHERE id = $2', [reply.trim(), id]);
      return res.json({ success: true });
    }

    if (action === 'admin_message') {
      const adminName = String(req.body?.name || '');
      const adminMessage = String(req.body?.message || '');
      if (!adminName.trim()) return res.status(400).json({ error: 'Nimi on pakollinen.' });
      if (!adminMessage.trim()) return res.status(400).json({ error: 'Viesti on pakollinen.' });
      if (adminName.trim().length > 100) return res.status(400).json({ error: 'Nimi on liian pitkä (max 100 merkkiä).' });
      if (adminMessage.trim().length > 2000) return res.status(400).json({ error: 'Viesti on liian pitkä (max 2000 merkkiä).' });
      await db.query('INSERT INTO guestbook (name, message, is_admin) VALUES ($1, $2, 1)', [adminName.trim(), adminMessage.trim()]);
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Tuntematon toiminto.' });
  } catch {
    return res.status(500).json({ error: 'Palvelinvirhe.' });
  }
});

app.delete('/api/guestbook', requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: 'Viestin ID puuttuu.' });
    await db.query('DELETE FROM guestbook WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Palvelinvirhe.' });
  }
});

app.get('/api/links', requireAuth, async (_req, res) => {
  try {
    const [sorola, srla, srl] = await Promise.all([
      db.query('SELECT * FROM links ORDER BY created_at DESC'),
      db.query('SELECT * FROM srla_links ORDER BY created_at DESC'),
      db.query('SELECT * FROM srl_links ORDER BY created_at DESC')
    ]);

    res.json({ sorola: sorola.rows, srla: srla.rows, srl: srl.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/links', requireAuth, async (req, res) => {
  try {
    const { originalURL, domain, path: pathValue } = req.body || {};
    const created = await createShortLinkEntry({ originalUrl: originalURL, domain, pathValue });
    return res.json({ success: true, path: created.path, domain: created.domain, shortUrl: created.shortUrl });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/links', requireAuth, async (req, res) => {
  try {
    const { domain, path: pathValue, newOriginalURL } = req.body || {};
    if (!newOriginalURL) return res.status(400).json({ error: 'Uusi kohdeosoite puuttuu.' });

    const table = resolveTableByDomain(domain);
    if (!table) return res.status(400).json({ error: 'Virheellinen domain.' });

    await updateShortLink(table, pathValue, newOriginalURL);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/links', requireAuth, async (req, res) => {
  try {
    const pathToRemove = String(req.query.path || '');
    const domainToRemove = String(req.query.domain || '');

    if (!pathToRemove || !domainToRemove) {
      return res.status(400).json({ error: 'Tiedot puuttuvat' });
    }

    const table = resolveTableByDomain(domainToRemove);
    if (!table) return res.status(400).json({ error: 'Virheellinen domain.' });

    await deleteShortLink(table, pathToRemove);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.all('/api/lyhennin/create', requireWebTool('shortener'), apiKeyUsageMiddleware, async (req, res) => {
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: 'Tuntematon metodi.' });
    }

    const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const created = await createShortLinkEntry({
      originalUrl: source.url || source.originalURL,
      domain: source.domain,
      pathValue: source.code || source.path
    });
    return res.json({ success: true, shortUrl: created.shortUrl, path: created.path, domain: created.domain });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  }
});


// --- PASTEBIN REITIT ---
app.post('/api/paste', requireWebTool('pastebin'), apiKeyUsageMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Teksti on pakollinen.' });
    const shortPath = luoSatunnainenPolku(6);
    await db.query('INSERT INTO pastes (short_path, content) VALUES ($1, $2)', [shortPath, content.trim()]);
    return res.json({ success: true, path: shortPath });
  } catch {
    return res.status(500).json({ error: 'Palvelinvirhe tallennuksessa.' });
  }
});

app.get('/api/paste/:path', async (req, res) => {
  try {
    const { path: pastePath } = req.params;
    const result = await db.query('SELECT content FROM pastes WHERE short_path = $1 LIMIT 1', [pastePath]);
    const match = result.rows[0];
    if (!match) return res.status(404).json({ error: 'Tekstiä ei löytynyt.' });
    return res.json({ content: match.content });
  } catch {
    return res.status(500).json({ error: 'Palvelinvirhe.' });
  }
});

app.get('/api/pastes', requireAuth, async (_req, res) => {
  try {
    const result = await db.query('SELECT id, short_path, content, created_at FROM pastes ORDER BY created_at DESC');
    res.json({ pastes: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/pastes', requireAuth, async (req, res) => {
  try {
    const idToRemove = Number.parseInt(req.query.id, 10);
    if (!idToRemove) return res.status(400).json({ error: 'ID puuttuu.' });
    await db.query('DELETE FROM pastes WHERE id = $1', [idToRemove]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- TIEDOSTOLATAUS JA S3 ---
let uploadBucketReadyPromise = null;

async function ensureUploadBucketReady() {
  if (!uploadBucketReadyPromise) {
    uploadBucketReadyPromise = ensureBucketExists()
      .catch((error) => {
        uploadBucketReadyPromise = null;
        throw error;
      });
  }
  await uploadBucketReadyPromise;
}

void ensureUploadBucketReady().catch((error) => {
  console.error(`Bucketin varmistus epäonnistui käynnistyksessä: ${error.message}`);
});

app.post('/api/upload', requireWebTool('share'), apiKeyUsageMiddleware, uploadShare.single('file'), async (req, res) => {
  const file = req.file;
  const expiryDays = Math.min(Number.parseInt(req.body?.expiryDays || '7', 10), 7);
  const maxDownloads = Number.parseInt(req.body?.maxDownloads || '0', 10) || 0;

  if (!file) return res.status(400).json({ error: 'Ei tiedostoa.' });

  let safeFilePath = null;
  try {
    await ensureUploadBucketReady();
    safeFilePath = validateUploadFilePath(file.path);
    const expiresAt = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);
    const id = crypto.randomUUID().split('-')[0];
    const extension = (file.originalname.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '');
    const fileName = `${id}.${extension || 'bin'}`;

    const fileStream = createReadStream(safeFilePath);

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: fileStream,
      ContentType: file.mimetype || 'application/octet-stream',
      Metadata: {
        originalname: file.originalname,
        expiresat: String(expiresAt),
        maxdownloads: String(maxDownloads),
        downloads: '0'
      }
    }));

    const siteUrl = process.env.SITE_URL
      ? process.env.SITE_URL.replace(/\/$/, '')
      : `${req.protocol}://${req.hostname}`;

    return res.json({ url: `${siteUrl}/api/download?file=${encodeURIComponent(fileName)}`, id: fileName });
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  } finally {
    if (safeFilePath) {
      await fs.unlink(safeFilePath).catch(err => console.error("Temp file cleanup error:", err));
    }
  }
});

app.get(['/d/:file', '/en/share/d/:file'], async (req, res) => {
  const fileId = String(req.params.file || '');
  if (!fileId) {
    const errorPath = prefersEnglish(req) ? '/en/share/error' : '/jako/error';
    return res.redirect(302, errorPath);
  }

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: fileId }));
    const metadata = object.Metadata || {};

    const expiresAt = Number.parseInt(metadata.expiresat || '0', 10);
    if (expiresAt && Date.now() > expiresAt) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileId })).catch(() => {});
      const errorPath = prefersEnglish(req) ? '/en/share/error' : '/jako/error';
      return res.redirect(302, errorPath);
    }

    const maxDownloads = Number.parseInt(metadata.maxdownloads || '0', 10);
    const downloads = Number.parseInt(metadata.downloads || '0', 10);

    if (maxDownloads > 0) {
      const currentDownloads = downloads + 1;
      if (currentDownloads >= maxDownloads) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileId })).catch(() => {});
      } else {
        await s3.send(new CopyObjectCommand({
          Bucket: bucketName,
          Key: fileId,
          CopySource: `${bucketName}/${fileId}`,
          MetadataDirective: 'REPLACE',
          ContentType: object.ContentType || 'application/octet-stream',
          Metadata: {
            ...metadata,
            downloads: String(currentDownloads)
          }
        }));
      }
    }

    res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
    const rawName = metadata.originalname || fileId;
    const originalName = rawName.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '').trim() || 'download';
    res.setHeader('Content-Disposition', contentDisposition(originalName));
    if (object.ETag) res.setHeader('ETag', object.ETag);

    await streamS3BodyToResponse(object.Body, res);
  } catch (error) {
    console.error('S3 Latausvirhe:', error);
    const errorPath = prefersEnglish(req) ? '/en/share/error' : '/jako/error';
    return res.redirect(302, errorPath);
  }
});

app.get('/api/download', async (req, res) => {
  const fileId = String(req.query.file || '');
  res.redirect(`/d/${encodeURIComponent(fileId)}`);
});

app.get('/p/:path', async (req, res) => {
  const isEn = prefersEnglish(req);
  const filePath = isEn
    ? path.join(distPath, 'en', 'pastebin', 'view.html')
    : path.join(distPath, 'pastebin', 'lue.html');
  try {
    await fs.access(filePath);
    return res.sendFile(filePath);
  } catch {
    const fallbackPath = path.join(distPath, 'pastebin', 'lue.html');
    try {
      await fs.access(fallbackPath);
      return res.sendFile(fallbackPath);
    } catch {
      return res.sendFile(path.join(distPath, 'index.html'));
    }
  }
});

app.get(['/s/:file', '/en/share/s/:file'], async (req, res) => {
  const fileId = String(req.params.file || '');
  const isEnPath = req.path.startsWith('/en/');
  const isEn = isEnPath || prefersEnglish(req);
  const errorPath = isEn ? '/en/share/error' : '/jako/error';

  if (!fileId) return res.redirect(302, errorPath);

  try {
    const object = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: fileId }));
    const metadata = object.Metadata || {};

    const expiresAt = Number.parseInt(metadata.expiresat || '0', 10);
    if (expiresAt && Date.now() > expiresAt) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileId })).catch(() => {});
      return res.redirect(302, errorPath);
    }

    const maxDownloads = Number.parseInt(metadata.maxdownloads || '0', 10);
    const downloads = Number.parseInt(metadata.downloads || '0', 10);
    if (maxDownloads > 0 && downloads >= maxDownloads) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileId })).catch(() => {});
      return res.redirect(302, errorPath);
    }

    const filePath = isEn
      ? path.join(distPath, 'en', 'share', 'download.html')
      : path.join(distPath, 'jako', 'lataus.html');

    try {
      await fs.access(filePath);
      return res.sendFile(filePath);
    } catch {
      return res.sendFile(path.join(distPath, 'jako', 'lataus.html'));
    }
  } catch {
    return res.redirect(302, errorPath);
  }
});

// --- YLLÄPITÄJÄN TIEDOSTOLATAUS ---
app.post('/api/admin/upload', requireAuth, uploadAdmin.single('file'), async (req, res) => {
  const file = req.file;
  const expiryDays = Number.parseInt(req.body?.expiryDays || '0', 10);
  const maxDownloads = Number.parseInt(req.body?.maxDownloads || '0', 10) || 0;

  if (!file) return res.status(400).json({ error: 'Ei tiedostoa.' });

  let safeFilePath = null;
  try {
    await ensureUploadBucketReady();
    safeFilePath = validateUploadFilePath(file.path);
    const expiresAt = expiryDays > 0 ? Date.now() + (expiryDays * 24 * 60 * 60 * 1000) : 0;
    const id = crypto.randomUUID().split('-')[0];
    const extension = (file.originalname.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '');
    const fileName = `${id}.${extension || 'bin'}`;

    const fileStream = createReadStream(safeFilePath);

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: fileStream,
      ContentType: file.mimetype || 'application/octet-stream',
      Metadata: {
        originalname: file.originalname,
        expiresat: String(expiresAt),
        maxdownloads: String(maxDownloads),
        downloads: '0',
        isadmin: 'true'
      }
    }));

    await db.query(
      'INSERT INTO admin_files (s3_key, original_name, file_size, mime_type, expires_at, max_downloads, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [fileName, file.originalname, file.size, file.mimetype || 'application/octet-stream', expiresAt || null, maxDownloads, req.user.username]
    );

    const siteUrl = process.env.SITE_URL
      ? process.env.SITE_URL.replace(/\/$/, '')
      : `${req.protocol}://${req.hostname}`;

    return res.json({
      success: true,
      shareUrl: `${siteUrl}/s/${encodeURIComponent(fileName)}`,
      downloadUrl: `${siteUrl}/d/${encodeURIComponent(fileName)}`,
      id: fileName
    });
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  } finally {
    if (safeFilePath) {
      await fs.unlink(safeFilePath).catch(err => console.error("Temp file cleanup error:", err));
    }
  }
});

app.get('/api/admin/files', requireAuth, async (_req, res) => {
  try {
    const result = await db.query('SELECT id, s3_key, original_name, file_size, mime_type, expires_at, max_downloads, created_by, created_at FROM admin_files ORDER BY created_at DESC');
    res.json({ files: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/files', requireAuth, async (req, res) => {
  try {
    const idToRemove = Number.parseInt(req.query.id, 10);
    if (!idToRemove) return res.status(400).json({ error: 'ID puuttuu.' });

    const result = await db.query('SELECT s3_key FROM admin_files WHERE id = $1 LIMIT 1', [idToRemove]);
    const file = result.rows[0];
    if (!file) return res.status(404).json({ error: 'Tiedostoa ei löydy.' });

    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: file.s3_key })).catch(() => {});
    await db.query('DELETE FROM admin_files WHERE id = $1', [idToRemove]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/qr-proxy', async (req, res) => {
  try {
    const data = String(req.query.data || '').trim();
    const requestedColor = String(req.query.color || '000000').trim().replace(/^#/, '');
    const color = /^[0-9a-fA-F]{6}$/.test(requestedColor) ? requestedColor : '000000';

    if (!data) return res.status(400).json({ error: 'QR-data puuttuu.' });

    const upstreamUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data)}&color=${color}`;
    const upstream = await fetch(upstreamUrl);

    if (!upstream.ok) {
      return res.status(502).json({ error: 'QR-koodipalvelu ei vastaa.' });
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(body);
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  }
});

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Tiedosto ylittää sallitun kokorajan.' });
    }
    return res.status(400).json({ error: `Lähetysvirhe: ${error.message}` });
  }
  if (error) {
    return res.status(500).json({ error: 'Palvelinvirhe.' });
  }
  return next();
});

// Kaikki muut reitit ohjataan oikeisiin .html tiedostoihin tai index.html:ään
app.get('*', pageLimiter, async (req, res) => {
  const staticHtmlPath = await resolveStaticHtmlPath(req.path);
  if (staticHtmlPath) {
    return res.sendFile(staticHtmlPath);
  }
  return res.sendFile(path.join(distPath, 'index.html'));
});

const port = Number.parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
