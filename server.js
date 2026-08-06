import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import multer from 'multer';

const execFileAsync = promisify(execFile);
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

// Build lock: prevents multiple overlapping build processes from racing
let _buildRunning = false;
let _buildQueued = false;
function triggerBuild() {
  if (_buildRunning) { _buildQueued = true; return; }
  _buildRunning = true;
  execFileAsync('node', ['build.mjs'], { cwd: __dirname })
    .catch(err => console.error('Build error after translation update:', err.message))
    .finally(() => {
      _buildRunning = false;
      if (_buildQueued) { _buildQueued = false; triggerBuild(); }
    });
}

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

app.options('/api/lyhennin/create', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.status(204).send();
});

app.all('/api/lyhennin/create', async (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });

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
app.post('/api/paste', async (req, res) => {
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

app.post('/api/upload', uploadShare.single('file'), async (req, res) => {
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

app.post('/api/admin/elements', requireAuth, async (req, res) => {
  try {
    const target_section = String(req.body?.target_section || '').trim();
    const element_type = String(req.body?.element_type || '').trim();
    const url = String(req.body?.url || '').trim();
    const content_fi = stripHtml(String(req.body?.content_fi || '').trim());
    const content_en = stripHtml(String(req.body?.content_en || '').trim());

    if (!target_section) return res.status(400).json({ error: 'target_section on pakollinen.' });
    if (!['button', 'text'].includes(element_type)) return res.status(400).json({ error: 'element_type täytyy olla button tai text.' });
    if (!content_fi) return res.status(400).json({ error: 'content_fi on pakollinen.' });
    if (!content_en) return res.status(400).json({ error: 'content_en on pakollinen.' });
    if (element_type === 'button' && !url) return res.status(400).json({ error: 'url on pakollinen button-tyypille.' });
    if (element_type === 'button' && url && !validateUrl(url)) return res.status(400).json({ error: 'URL on virheellinen. Hyväksytään http://, https:// sekä suhteelliset polut kuten /ohjeet/.' });

    const maxOrderResult = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM custom_elements WHERE target_section = $1', [target_section]);
    const nextOrder = (maxOrderResult.rows[0]?.max_order ?? -1) + 1;

    const result = await db.query(
      'INSERT INTO custom_elements (target_section, element_type, url, content_fi, content_en, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
      [target_section, element_type, url || null, content_fi, content_en, nextOrder]
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/elements/:id', requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID puuttuu.' });
    const result = await db.query('DELETE FROM custom_elements WHERE id = $1', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Elementtiä ei löydy.' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/elements/reorder', requireAuth, async (req, res) => {
  const conn = db.connect();
  try {
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      conn.release();
      return res.status(400).json({ error: 'orderedIds-taulukko on pakollinen.' });
    }
    const parsed = [];
    for (let i = 0; i < orderedIds.length; i++) {
      const id = Number.parseInt(orderedIds[i], 10);
      if (!Number.isFinite(id)) {
        conn.release();
        return res.status(400).json({ error: 'Virheellinen ID.' });
      }
      parsed.push(id);
    }
    conn.query('BEGIN');
    for (let i = 0; i < parsed.length; i++) {
      conn.query('UPDATE custom_elements SET sort_order = $1 WHERE id = $2', [i, parsed[i]]);
    }
    conn.query('COMMIT');
    conn.release();
    res.json({ success: true });
  } catch (error) {
    try { conn.query('ROLLBACK'); } catch { /* ignore */ }
    conn.release();
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/translations', requireAuth, async (_req, res) => {
  try {
    const fiPath = path.join(__dirname, 'src', 'i18n', 'fi.json');
    const enPath = path.join(__dirname, 'src', 'i18n', 'en.json');
    let fi, en;
    try {
      fi = JSON.parse(await fs.readFile(fiPath, 'utf8'));
      en = JSON.parse(await fs.readFile(enPath, 'utf8'));
    } catch {
      return res.status(500).json({ error: 'Käännöstiedostoa ei voitu lukea.' });
    }
    const keys = [...new Set([...Object.keys(fi), ...Object.keys(en)])].sort();
    const translations = keys.map(key => ({ key, fi: fi[key] ?? '', en: en[key] ?? '' }));
    res.json({ translations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/translations', requireAuth, async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim();
    const valueFi = stripHtml(String(req.body?.fi || '').trim());
    const valueEn = stripHtml(String(req.body?.en || '').trim());

    if (!key) return res.status(400).json({ error: 'key on pakollinen.' });
    if (/^__/.test(key) || key === 'constructor' || key === 'prototype') {
      return res.status(400).json({ error: 'Virheellinen avain.' });
    }

    const fiPath = path.join(__dirname, 'src', 'i18n', 'fi.json');
    const enPath = path.join(__dirname, 'src', 'i18n', 'en.json');
    let fi, en;
    try {
      fi = JSON.parse(await fs.readFile(fiPath, 'utf8'));
      en = JSON.parse(await fs.readFile(enPath, 'utf8'));
    } catch {
      return res.status(500).json({ error: 'Käännöstiedostoa ei voitu lukea.' });
    }
    if (Object.hasOwn(fi, key) || Object.hasOwn(en, key)) {
      return res.status(409).json({ error: 'Käännösavain on jo olemassa. Käytä PUT päivittämiseen.' });
    }

    fi[key] = valueFi;
    en[key] = valueEn;
    await fs.writeFile(fiPath, JSON.stringify(fi, null, 2) + '\n', 'utf8');
    await fs.writeFile(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');

    triggerBuild();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/translations', requireAuth, async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim();
    const lang = String(req.body?.lang || 'fi').trim();
    const value = stripHtml(String(req.body?.value || '').trim());

    if (!key) return res.status(400).json({ error: 'key on pakollinen.' });
    if (!['fi', 'en'].includes(lang)) return res.status(400).json({ error: 'Virheellinen kieli.' });
    if (/^__/.test(key) || key === 'constructor' || key === 'prototype') {
      return res.status(400).json({ error: 'Virheellinen avain.' });
    }

    const jsonPath = path.join(__dirname, 'src', 'i18n', `${lang}.json`);
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    } catch {
      return res.status(500).json({ error: 'Käännöstiedostoa ei voitu lukea.' });
    }
    if (!Object.hasOwn(existing, key)) return res.status(404).json({ error: 'Käännösavainta ei löydy.' });

    existing[key] = value;
    await fs.writeFile(jsonPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

    // Trigger build to regenerate dist/ HTML files (serialized via lock)
    triggerBuild();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/translations', requireAuth, async (req, res) => {
  try {
    const key = String(req.query?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key on pakollinen.' });
    if (/^__/.test(key) || key === 'constructor' || key === 'prototype') {
      return res.status(400).json({ error: 'Virheellinen avain.' });
    }

    const fiPath = path.join(__dirname, 'src', 'i18n', 'fi.json');
    const enPath = path.join(__dirname, 'src', 'i18n', 'en.json');
    let fi, en;
    try {
      fi = JSON.parse(await fs.readFile(fiPath, 'utf8'));
      en = JSON.parse(await fs.readFile(enPath, 'utf8'));
    } catch {
      return res.status(500).json({ error: 'Käännöstiedostoa ei voitu lukea.' });
    }
    if (!Object.hasOwn(fi, key) && !Object.hasOwn(en, key)) {
      return res.status(404).json({ error: 'Käännösavainta ei löydy.' });
    }

    delete fi[key];
    delete en[key];
    await fs.writeFile(fiPath, JSON.stringify(fi, null, 2) + '\n', 'utf8');
    await fs.writeFile(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');

    triggerBuild();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const ROUTES_JSON_PATH = path.join(__dirname, 'src', 'i18n', 'routes.json');

async function readRoutesJson() {
  return JSON.parse(await fs.readFile(ROUTES_JSON_PATH, 'utf8'));
}

async function writeRoutesJson(data) {
  await fs.writeFile(ROUTES_JSON_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

app.get('/api/admin/routes', requireAuth, async (_req, res) => {
  try {
    const routes = await readRoutesJson();
    const list = Object.entries(routes).map(([fi, en]) => ({ fi, en }));
    res.json({ routes: list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/routes', requireAuth, async (req, res) => {
  try {
    const fiSeg = String(req.body?.fi || '').trim().toLowerCase();
    const enSeg = String(req.body?.en || '').trim().toLowerCase();
    if (!fiSeg || !enSeg) return res.status(400).json({ error: 'fi ja en ovat pakollisia.' });
    if (!/^[a-z0-9-]+$/.test(fiSeg) || !/^[a-z0-9-]+$/.test(enSeg)) {
      return res.status(400).json({ error: 'Polun segmentti saa sisältää vain pieniä kirjaimia, numeroita ja tavuviivoja.' });
    }

    const routes = await readRoutesJson();
    if (Object.hasOwn(routes, fiSeg)) {
      return res.status(409).json({ error: 'Suomenkielinen polku on jo olemassa.' });
    }

    routes[fiSeg] = enSeg;
    await writeRoutesJson(routes);
    triggerBuild();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/routes', requireAuth, async (req, res) => {
  try {
    const fiSeg = String(req.body?.fi || '').trim().toLowerCase();
    const enSeg = String(req.body?.en || '').trim().toLowerCase();
    if (!fiSeg || !enSeg) return res.status(400).json({ error: 'fi ja en ovat pakollisia.' });
    if (!/^[a-z0-9-]+$/.test(fiSeg) || !/^[a-z0-9-]+$/.test(enSeg)) {
      return res.status(400).json({ error: 'Polun segmentti saa sisältää vain pieniä kirjaimia, numeroita ja tavuviivoja.' });
    }

    const routes = await readRoutesJson();
    if (!Object.hasOwn(routes, fiSeg)) {
      return res.status(404).json({ error: 'Suomenkielistä polkua ei löydy.' });
    }

    routes[fiSeg] = enSeg;
    await writeRoutesJson(routes);
    triggerBuild();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/routes', requireAuth, async (req, res) => {
  try {
    const fiSeg = String(req.query?.fi || '').trim().toLowerCase();
    if (!fiSeg) return res.status(400).json({ error: 'fi on pakollinen.' });

    const routes = await readRoutesJson();
    if (!Object.hasOwn(routes, fiSeg)) {
      return res.status(404).json({ error: 'Suomenkielistä polkua ei löydy.' });
    }

    delete routes[fiSeg];
    await writeRoutesJson(routes);
    triggerBuild();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/changelog', requireAuth, async (req, res) => {
  try {
    const dateStr = String(req.body?.date_str || '').trim();
    const titleFi = stripHtml(String(req.body?.title_fi || '').trim());
    const titleEn = stripHtml(String(req.body?.title_en || '').trim());
    const contentFi = stripHtml(String(req.body?.content_fi || '').trim());
    const contentEn = stripHtml(String(req.body?.content_en || '').trim());

    if (!dateStr || !titleFi || !titleEn || !contentFi || !contentEn) {
      return res.status(400).json({ error: 'Kaikki kentät ovat pakollisia.' });
    }

    const result = await db.query(
      'INSERT INTO changelog (date_str, title_fi, title_en, content_fi, content_en) VALUES ($1, $2, $3, $4, $5)',
      [dateStr, titleFi, titleEn, contentFi, contentEn]
    );

    return res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/changelog/:id', requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID puuttuu.' });
    const result = await db.query('DELETE FROM changelog WHERE id = $1', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Muutoslokimerkintää ei löydy.' });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validateUrl(url) {
  const value = String(url || '').trim();
  if (!value || /[\u0000-\u001F\u007F\s]/.test(value)) return false;
  if (value.startsWith('//')) return false;
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return value.startsWith('/');
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function stripHtml(str) {
  const s = String(str).slice(0, 10000);
  // Remove HTML tags by scanning character by character to avoid ReDoS
  let result = '';
  let inTag = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<') {
      inTag = true;
    } else if (s[i] === '>' && inTag) {
      inTag = false;
    } else if (!inTag) {
      result += s[i];
    }
  }
  return result.trim();
}

function injectCustomElements(html, elements, lang) {
  if (!elements || elements.length === 0) return html;

  const bySection = {};
  for (const el of elements) {
    if (!bySection[el.target_section]) bySection[el.target_section] = [];
    bySection[el.target_section].push(el);
  }

  let result = html;
  for (const [section, items] of Object.entries(bySection)) {
    const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ulRegex = new RegExp(`(<ul[^>]*\\bid="${escapedSection}"[^>]*>)(.*?)(</ul>)`, 's');
    const ulInjected = result.replace(ulRegex, (_match, open, inner, close) => {
      const injected = items.map(el => {
        const content = lang === 'en' ? el.content_en : el.content_fi;
        if (el.element_type === 'button') {
          return `\n                        <li data-custom-element-id="${el.id}"><a href="${escapeHtml(el.url)}" class="nappula1">${escapeHtml(content)}</a></li>`;
        }
        return `\n                        <li data-custom-element-id="${el.id}">${escapeHtml(content)}</li>`;
      }).join('');
      return `${open}${inner}${injected}\n                    ${close}`;
    });
    if (ulInjected !== result) {
      result = ulInjected;
      continue;
    }

    const navRegex = new RegExp(`(<nav[^>]*\\bid="${escapedSection}"[^>]*>)(.*?)(</nav>)`, 's');
    result = result.replace(navRegex, (_match, open, inner, close) => {
      const injectClassMatch = open.match(/data-inject-class="([^"]*)"/);
      const injectClass = injectClassMatch ? injectClassMatch[1] : 'nappula1';
      const injected = items.map(el => {
        const content = lang === 'en' ? el.content_en : el.content_fi;
        if (el.element_type === 'button') {
          if (injectClass === 'tietosuoja-linkki') {
            return `\n                    <a href="${escapeHtml(el.url)}" class="tietosuoja-linkki" data-custom-element-id="${el.id}"><span>${escapeHtml(content)}</span><span class="nuoli">→</span></a>`;
          }
          return `\n                    <a href="${escapeHtml(el.url)}" class="${injectClass}" data-custom-element-id="${el.id}">${escapeHtml(content)}</a>`;
        }
        return `\n                    <div data-custom-element-id="${el.id}">${escapeHtml(content)}</div>`;
      }).join('');
      return `${open}${inner}${injected}\n                ${close}`;
    });
  }
  return result;
}

function renderChangelogEntries(entries, lang, includeDeleteButtons = false) {
  if (!entries || entries.length === 0) return '';
  return entries.map((entry) => {
    const title = lang === 'en' ? entry.title_en : entry.title_fi;
    const content = lang === 'en' ? entry.content_en : entry.content_fi;
    const deleteButton = includeDeleteButtons
      ? '<button class="poista-changelog-btn" type="button" title="Poista merkintä">🗑</button>'
      : '';
    const bullets = content.split('\n').filter(line => line.trim());
    const liItems = bullets.map(line => `<li>${escapeHtml(line.trim())}</li>`).join('');
    return `
            <div class="osion-tausta" data-changelog-id="${entry.id}">
                <div class="muutos-pvm">${escapeHtml(entry.date_str)} - ${escapeHtml(title)}${deleteButton}</div>
                <ul class="muutos-lista">${liItems}</ul>
            </div>`;
  }).join('');
}

function injectChangelogEntries(html, entriesHtml) {
  if (!entriesHtml) return html;
  const mainRegex = /(<main[^>]*id="paaosio"[^>]*>)/i;
  if (!mainRegex.test(html)) return html;
  return html.replace(mainRegex, `$1${entriesHtml}\n`);
}

// Kaikki muut reitit ohjataan oikeisiin .html tiedostoihin tai index.html:ään
app.get('*', pageLimiter, async (req, res) => {
  const staticHtmlPath = await resolveStaticHtmlPath(req.path);
  const htmlFilePath = staticHtmlPath || path.join(distPath, 'index.html');

  try {
    const lang = req.path.startsWith('/en') ? 'en' : 'fi';
    const normalizedPath = req.path.replace(/\/+$/, '') || '/';
    const isChangelogPage = normalizedPath === '/muutokset' || normalizedPath === '/en/changes';
    const html = await fs.readFile(htmlFilePath, 'utf8');

    const [elementsResult, changelogResult, authedUser] = await Promise.all([
      db.query('SELECT id, target_section, element_type, url, content_fi, content_en FROM custom_elements ORDER BY sort_order ASC, id ASC'),
      isChangelogPage
        ? db.query('SELECT id, date_str, title_fi, title_en, content_fi, content_en, created_at FROM changelog ORDER BY id DESC')
        : Promise.resolve({ rows: [] }),
      isChangelogPage ? haeKayttaja(req).catch(() => null) : Promise.resolve(null)
    ]);

    let injected = html;
    if (elementsResult.rows.length > 0) {
      injected = injectCustomElements(injected, elementsResult.rows, lang);
    }

    if (changelogResult.rows.length > 0) {
      const changelogHtml = renderChangelogEntries(changelogResult.rows, lang, Boolean(authedUser));
      injected = injectChangelogEntries(injected, changelogHtml);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(injected);
  } catch {
    // Jatketaan normaalilla tiedoston lähetyksellä virhetilanteessa
  }

  return res.sendFile(htmlFilePath);
});

const port = Number.parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
