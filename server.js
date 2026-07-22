import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { create as contentDisposition } from 'content-disposition';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';

import { db } from './db.js';
import { s3, bucketName } from './storage.js';

const app = express();
app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');
const shortenerHomeUrl = process.env.SHORTENER_HOME_URL || 'https://sorola.fi/lyhennin';
const shortenerErrorUrl = process.env.SHORTENER_ERROR_URL || 'https://sorola.fi/lyhennin/error';
const MAX_SHARE_FILE_SIZE_BYTES = 200 * 1024 * 1024;

const uploadShare = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SHARE_FILE_SIZE_BYTES }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false
});

async function resolveStaticHtmlPath(requestPath) {
  if (typeof requestPath !== 'string') {
    return null;
  }

  const trimmedPath = requestPath.replace(/^\/+|\/+$/g, '');
  if (!trimmedPath) return null;
  if (path.extname(trimmedPath)) return null;

  const candidatePath = path.resolve(distPath, `${trimmedPath}.html`);
  const relativePath = path.relative(distPath, candidatePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

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
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') {
    return false;
  }

  const iterations = Number.parseInt(parts[1], 10);
  const digest = parts[2];
  const salt = parts[3];
  const expected = parts[4];

  if (!iterations || !digest || !salt || !expected) {
    return false;
  }

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

function resolveTableByHostname(hostname) {
  switch (hostname) {
    case 'soro.la': return 'links';
    case 'srla.fi': return 'srla_links';
    case 'srl.la': return 'srl_links';
    default: return null;
  }
}

function resolveTableByDomain(domain) {
  switch (domain) {
    case 'soro.la': return 'links';
    case 'srla.fi': return 'srla_links';
    case 'srl.la': return 'srl_links';
    default: return null;
  }
}

async function fetchLinkByPath(table, shortPath) {
  switch (table) {
    case 'links':
      return db.query('SELECT original_url FROM links WHERE short_path = $1 LIMIT 1', [shortPath]);
    case 'srla_links':
      return db.query('SELECT original_url FROM srla_links WHERE short_path = $1 LIMIT 1', [shortPath]);
    case 'srl_links':
      return db.query('SELECT original_url FROM srl_links WHERE short_path = $1 LIMIT 1', [shortPath]);
    default:
      throw new Error('Virheellinen taulu.');
  }
}

async function incrementLinkClicks(table, shortPath) {
  switch (table) {
    case 'links':
      return db.query('UPDATE links SET clicks = clicks + 1 WHERE short_path = $1', [shortPath]);
    case 'srla_links':
      return db.query('UPDATE srla_links SET clicks = clicks + 1 WHERE short_path = $1', [shortPath]);
    case 'srl_links':
      return db.query('UPDATE srl_links SET clicks = clicks + 1 WHERE short_path = $1', [shortPath]);
    default:
      return Promise.resolve();
  }
}

async function insertShortLink(table, shortPath, originalUrl) {
  switch (table) {
    case 'links':
      return db.query('INSERT INTO links (short_path, original_url, clicks) VALUES ($1, $2, 0)', [shortPath, originalUrl]);
    case 'srla_links':
      return db.query('INSERT INTO srla_links (short_path, original_url, clicks) VALUES ($1, $2, 0)', [shortPath, originalUrl]);
    case 'srl_links':
      return db.query('INSERT INTO srl_links (short_path, original_url, clicks) VALUES ($1, $2, 0)', [shortPath, originalUrl]);
    default:
      throw new Error('Virheellinen taulu.');
  }
}

async function updateShortLink(table, shortPath, originalUrl) {
  switch (table) {
    case 'links':
      return db.query('UPDATE links SET original_url = $1 WHERE short_path = $2', [originalUrl, shortPath]);
    case 'srla_links':
      return db.query('UPDATE srla_links SET original_url = $1 WHERE short_path = $2', [originalUrl, shortPath]);
    case 'srl_links':
      return db.query('UPDATE srl_links SET original_url = $1 WHERE short_path = $2', [originalUrl, shortPath]);
    default:
      throw new Error('Virheellinen taulu.');
  }
}

async function deleteShortLink(table, shortPath) {
  switch (table) {
    case 'links':
      return db.query('DELETE FROM links WHERE short_path = $1', [shortPath]);
    case 'srla_links':
      return db.query('DELETE FROM srla_links WHERE short_path = $1', [shortPath]);
    case 'srl_links':
      return db.query('DELETE FROM srl_links WHERE short_path = $1', [shortPath]);
    default:
      throw new Error('Virheellinen taulu.');
  }
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

app.use(async (req, res, next) => {
  try {
    const hostname = (req.hostname || '').replace(/^www\./, '').toLowerCase();
    const pathname = req.path.replace(/^\/+/, '');
    const table = resolveTableByHostname(hostname);

    if (!table) return next();
    if (!pathname) return res.redirect(302, shortenerHomeUrl);
    if (pathname.startsWith('api/')) return next();

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
      if (!inviteCode || !username || !password) {
        return res.status(400).json({ error: 'Kaikki kentät vaaditaan.' });
      }
      if (username.length < 3 || password.length < 6) {
        return res.status(400).json({ error: 'Tunnuksen minimipituus 3, salasanan 6 merkkiä.' });
      }

      const inviteResult = await db.query('SELECT id FROM invites WHERE code_hash = $1 AND is_used = 0 LIMIT 1', [inviteCode]);
      if (!inviteResult.rows[0]) {
        return res.status(400).json({ error: 'Kutsukoodi on virheellinen tai jo käytetty.' });
      }

      const userCheck = await db.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [username]);
      if (userCheck.rows[0]) {
        return res.status(400).json({ error: 'Käyttäjätunnus on jo varattu.' });
      }

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
      if (!username || !oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Kaikki kentät vaaditaan.' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Uuden salasanan minimipituus on 6 merkkiä.' });
      }

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
    const { originalURL, domain } = req.body || {};
    let pathValue = req.body?.path;

    if (!originalURL) return res.status(400).json({ error: 'Kohdeosoite puuttuu.' });

    if (!pathValue || String(pathValue).trim() === '') pathValue = luoSatunnainenPolku();
    else pathValue = String(pathValue).trim().replace(/[^a-zA-Z0-9_-]/g, '');

    const table = resolveTableByDomain(domain);
    if (!table) return res.status(400).json({ error: 'Virheellinen domain.' });

    try {
      await insertShortLink(table, pathValue, originalURL);
      return res.json({ success: true, path: pathValue, domain });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Tämä lyhenne on jo käytössä!' });
      }
      throw error;
    }
  } catch (error) {
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

    const kohdeUrl = req.query.url;
    let koodi = req.query.code;
    const domain = String(req.query.domain || 'srla.fi').toLowerCase();

    if (!kohdeUrl) {
      return res.status(400).json({ error: 'URL puuttuu' });
    }

    if (!['srla.fi', 'srl.la'].includes(domain)) {
      return res.status(400).json({ error: 'Virheellinen domain.' });
    }

    if (!koodi || String(koodi).trim() === '') koodi = luoSatunnainenPolku();
    else koodi = String(koodi).trim().replace(/[^a-zA-Z0-9_-]/g, '');

    const table = resolveTableByDomain(domain);

    try {
      await insertShortLink(table, koodi, kohdeUrl);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Tämä lyhenne on jo käytössä!' });
      }
      throw error;
    }

    const baseUrl = domain === 'srl.la' ? 'https://srl.la' : 'https://srla.fi';
    return res.json({ success: true, shortUrl: `${baseUrl}/${koodi}` });
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  }
});

app.post('/api/upload', uploadShare.single('file'), async (req, res) => {
  const file = req.file;
  const expiryDays = Math.min(Number.parseInt(req.body?.expiryDays || '7', 10), 7);
  const maxDownloads = Number.parseInt(req.body?.maxDownloads || '0', 10) || 0;

  if (!file) return res.status(400).json({ error: 'Ei tiedostoa.' });

  try {
    const expiresAt = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);
    const id = crypto.randomUUID().split('-')[0];
    const extension = (file.originalname.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '');
    const fileName = `${id}.${extension || 'bin'}`;

    const body = file.buffer;

    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: body,
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
    const downloadUrl = `${siteUrl}/api/download?file=${encodeURIComponent(fileName)}`;
    return res.json({ url: downloadUrl, id: fileName });
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  }
});

app.get('/api/download', async (req, res) => {
  const fileId = String(req.query.file || '');
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
    if (object.ETag) {
      res.setHeader('ETag', object.ETag);
    }

    await streamS3BodyToResponse(object.Body, res);
  } catch (error) {
    console.error('S3 Latausvirhe:', error);
    const errorPath = prefersEnglish(req) ? '/en/share/error' : '/jako/error';
    return res.redirect(302, errorPath);
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

app.use(pageLimiter, express.static(distPath));

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
