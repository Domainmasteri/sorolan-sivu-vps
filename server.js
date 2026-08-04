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
import dnsRouter from './api/dns.js';

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);
app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');
const stylesDir = process.env.STYLES_DIR || '/opt/sorola/styles';
const shortenerHomeUrl = process.env.SHORTENER_HOME_URL || 'https://sorola.fi/lyhennin';
const shortenerErrorUrl = process.env.SHORTENER_ERROR_URL || 'https://sorola.fi/lyhennin/error';

const shortenerAllowedOrigins = (process.env.SHORTENER_ALLOWED_ORIGINS || 'https://sorola.fi,https://soro.la,https://srla.fi,https://srl.la')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

function setCorsForShortener(req, res) {
  const origin = req.headers.origin || '';
  if (shortenerAllowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

const MAX_SHARE_FILE_SIZE_BYTES = 1 * 1024 * 1024 * 1024;
const uploadDir = path.join(__dirname, 'uploads');

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

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/upload', uploadLimiter);

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
      'privacy', 'vieraskirja', 'makelink', 'json', 'base64'
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

// Palautettu suora ja varma Basic/Bearer -varmistus
async function parseBasicBearer(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const b64 = authHeader.slice(7).trim();
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return null;
    const username = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);
    if (!username || !password) return null;

    const result = await db.query('SELECT id, username, password_hash FROM users WHERE username = $1 LIMIT 1', [username]);
    const user = result.rows[0];
    if (user && verifyPassword(password, user.password_hash)) {
      return { id: user.id, username: user.username };
    }
  } catch {
    return null;
  }
  return null;
}

async function requireAuth(req, res, next) {
  const user = await parseBasicBearer(req);
  if (!user) return res.status(401).json({ error: 'Ei valtuuksia. Kirjaudu uudelleen.' });
  req.user = user;
  next();
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
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Invalid input');
  return db.query(`SELECT original_url FROM ${table} WHERE short_path = $1 LIMIT 1`, [shortPath]);
}

async function incrementLinkClicks(table, shortPath) {
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Invalid input');
  return db.query(`UPDATE ${table} SET clicks = clicks + 1 WHERE short_path = $1`, [shortPath]);
}

async function insertShortLink(table, shortPath, originalUrl) {
  return db.query(`INSERT INTO ${table} (short_path, original_url, clicks) VALUES ($1, $2, 0)`, [shortPath, originalUrl]);
}

async function updateShortLink(table, shortPath, originalUrl) {
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error('Invalid input');
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
  if (!table) throw createHttpError(400, 'Virheellinen domain.');

  let baseUrl = 'https://srla.fi';
  if (normalizedDomain === 'srl.la') baseUrl = 'https://srl.la';
  if (normalizedDomain === 'soro.la') baseUrl = 'https://soro.la';

  return { domain: normalizedDomain, table, baseUrl };
}

async function createShortLinkEntry({ originalUrl, domain, pathValue }) {
  if (!originalUrl) throw createHttpError(400, 'Kohdeosoite puuttuu.');
  if (!validateOriginalUrl(originalUrl)) throw createHttpError(400, 'URL:n tulee alkaa http:// tai https://');

  const { domain: normalizedDomain, table, baseUrl } = resolveShortLinkTarget(domain);
  const shortPath = sanitizeShortPath(pathValue);

  if (!shortPath) throw createHttpError(400, 'Virheellinen lyhenne.');

  try {
    await insertShortLink(table, shortPath, originalUrl);
  } catch (error) {
    if (String(error.code || '').toUpperCase() === '23505' || String(error.message || '').includes('unique constraint')) {
      throw createHttpError(400, 'Tämä lyhenne on jo käytössä!');
    }
    throw error;
  }

  return { domain: normalizedDomain, path: shortPath, shortUrl: `${baseUrl}/${shortPath}` };
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

// Autentikointireitit ilman JWT:tä
app.post('/api/auth', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.action === 'login') {
      const { username, password } = body;
      if (!username || !password) return res.status(400).json({ error: 'Tunnus ja salasana vaaditaan.' });

      const result = await db.query('SELECT id, password_hash FROM users WHERE username = $1 LIMIT 1', [username]);
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
      const user = await parseBasicBearer(req);
      if (!user) return res.status(401).json({ error: 'Ei valtuuksia.' });

      const { oldPassword, newPassword } = body;
      if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Kaikki kentät vaaditaan.' });
      if (newPassword.length < 6) return res.status(400).json({ error: 'Uuden salasanan minimipituus on 6 merkkiä.' });

      const result = await db.query('SELECT password_hash FROM users WHERE id = $1 LIMIT 1', [user.id]);
      const dbUser = result.rows[0];
      if (!dbUser || !verifyPassword(oldPassword, dbUser.password_hash)) {
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
    if (!code || code.length < 3) return res.status(400).json({ error: 'Koodin tulee olla vähintään 3 merkkiä.' });
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

    const a = Number.parseInt(captcha_a, 10);
    const b = Number.parseInt(captcha_b, 10);
    const answer = Number.parseInt(captcha_answer, 10);

    let expected;
    if (captcha_op === '+') expected = a + b;
    else if (captcha_op === '-') expected = a - b;
    else if (captcha_op === '*') expected = a * b;
    else return res.status(400).json({ error: 'Virheellinen laskutoimitus.' });

    if (answer !== expected) return res.status(400).json({ error: 'Bottisuojausta ei läpäisty.' });

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
      if (!id || !reply.trim()) return res.status(400).json({ error: 'Tiedot puuttuvat.' });
      await db.query('UPDATE guestbook SET admin_reply = $1 WHERE id = $2', [reply.trim(), id]);
      return res.json({ success: true });
    }
    if (action === 'admin_message') {
      const adminName = String(req.body?.name || '');
      const adminMessage = String(req.body?.message || '');
      if (!adminName.trim() || !adminMessage.trim()) return res.status(400).json({ error: 'Tiedot puuttuvat.' });
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
    if (!id) return res.status(400).json({ error: 'ID puuttuu.' });
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
    if (!pathToRemove || !domainToRemove) return res.status(400).json({ error: 'Tiedot puuttuvat' });
    const table = resolveTableByDomain(domainToRemove);
    if (!table) return res.status(400).json({ error: 'Virheellinen domain.' });
    await deleteShortLink(table, pathToRemove);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.options('/api/lyhennin/create', (req, res) => {
  setCorsForShortener(req, res);
  res.status(204).send();
});

app.all('/api/lyhennin/create', async (req, res) => {
  setCorsForShortener(req, res);
  try {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Tuntematon metodi.' });
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

app.use('/api/dns', requireAuth, dnsRouter);

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

let uploadBucketReadyPromise = null;
async function ensureUploadBucketReady() {
  if (!uploadBucketReadyPromise) {
    uploadBucketReadyPromise = ensureBucketExists().catch((error) => {
      uploadBucketReadyPromise = null;
      throw error;
    });
  }
  await uploadBucketReadyPromise;
}

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
      Metadata: { originalname: file.originalname, expiresat: String(expiresAt), maxdownloads: String(maxDownloads), downloads: '0' }
    }));

    const siteUrl = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, '') : `${req.protocol}://${req.hostname}`;
    return res.json({ url: `${siteUrl}/api/download?file=${encodeURIComponent(fileName)}`, id: fileName });
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  } finally {
    if (safeFilePath) await fs.unlink(safeFilePath).catch(() => {});
  }
});

app.get(['/d/:file', '/en/share/d/:file'], async (req, res) => {
  const fileId = String(req.params.file || '');
  if (!fileId) return res.redirect(302, prefersEnglish(req) ? '/en/share/error' : '/jako/error');

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: fileId }));
    const metadata = object.Metadata || {};
    const expiresAt = Number.parseInt(metadata.expiresat || '0', 10);
    if (expiresAt && Date.now() > expiresAt) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: fileId })).catch(() => {});
      return res.redirect(302, prefersEnglish(req) ? '/en/share/error' : '/jako/error');
    }

    res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
    const originalName = (metadata.originalname || fileId).replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '').trim() || 'download';
    res.setHeader('Content-Disposition', contentDisposition(originalName));
    await streamS3BodyToResponse(object.Body, res);
  } catch {
    return res.redirect(302, prefersEnglish(req) ? '/en/share/error' : '/jako/error');
  }
});

app.get('/api/download', async (req, res) => {
  res.redirect(`/d/${encodeURIComponent(String(req.query.file || ''))}`);
});

app.get('/api/admin/upload', requireAuth, uploadAdmin.single('file'), async (req, res) => {
  // admin upload reitti
});

app.get('*', pageLimiter, async (req, res) => {
  const staticHtmlPath = await resolveStaticHtmlPath(req.path);
  if (staticHtmlPath) return res.sendFile(staticHtmlPath);
  return res.sendFile(path.join(distPath, 'index.html'));
});

const port = Number.parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});