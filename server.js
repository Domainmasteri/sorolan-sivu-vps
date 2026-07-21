import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import multer from 'multer';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} from '@aws-sdk/client-s3';

import { db } from './db.js';
import { s3, shareBucketName, humorBucketName } from './storage.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');
const shortenerHomeUrl = process.env.SHORTENER_HOME_URL || 'https://sorola.fi/lyhennin';
const shortenerErrorUrl = process.env.SHORTENER_ERROR_URL || 'https://sorola.fi/lyhennin/error';

await fs.mkdir('/tmp/uploads', { recursive: true });

const uploadShare = multer({
  dest: '/tmp/uploads',
  limits: { fileSize: 5120 * 1024 * 1024 }
});

const uploadHumor = multer({
  dest: '/tmp/uploads',
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

function luoHash(teksti) {
  return crypto.createHash('sha256').update(teksti).digest('hex');
}

function luoSatunnainenPolku(pituus = 5) {
  const merkit = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = crypto.randomBytes(pituus);
  return Array.from(randomValues).map((v) => merkit[v % merkit.length]).join('');
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

async function haeKayttaja(req) {
  const parsed = parseBasicBearer(req);
  if (!parsed) return null;
  const passHash = luoHash(parsed.password);
  const result = await db.query(
    'SELECT id, username FROM users WHERE username = $1 AND password_hash = $2',
    [parsed.username, passHash]
  );
  return result.rows[0] || null;
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

async function listAllObjects(bucketName) {
  const objects = [];
  let continuationToken;

  do {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken
    }));

    if (response.Contents) {
      objects.push(...response.Contents);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

app.use(async (req, res, next) => {
  try {
    const hostname = (req.hostname || '').replace(/^www\./, '').toLowerCase();
    const pathname = req.path.replace(/^\/+/, '');

    const domains = {
      'soro.la': 'links',
      'srla.fi': 'srla_links',
      'srl.la': 'srl_links'
    };

    const table = domains[hostname];
    if (!table) return next();

    if (!pathname) {
      return res.redirect(302, shortenerHomeUrl);
    }

    if (pathname.startsWith('api/')) {
      return next();
    }

    const linkResult = await db.query(
      `SELECT original_url FROM ${table} WHERE short_path = $1 LIMIT 1`,
      [pathname]
    );

    const match = linkResult.rows[0];
    if (!match?.original_url) {
      return res.redirect(302, shortenerErrorUrl);
    }

    db.query(`UPDATE ${table} SET clicks = clicks + 1 WHERE short_path = $1`, [pathname]).catch(() => {});
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

      const result = await db.query(
        'SELECT id FROM users WHERE username = $1 AND password_hash = $2',
        [username, luoHash(password)]
      );

      if (result.rows[0]) return res.json({ success: true });
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

      const inviteResult = await db.query(
        'SELECT id FROM invites WHERE code_hash = $1 AND is_used = FALSE LIMIT 1',
        [inviteCode]
      );
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
        await client.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, luoHash(password)]);
        await client.query('UPDATE invites SET is_used = TRUE WHERE id = $1', [inviteResult.rows[0].id]);
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

      const userCheck = await db.query(
        'SELECT id FROM users WHERE username = $1 AND password_hash = $2 LIMIT 1',
        [username, luoHash(oldPassword)]
      );

      if (!userCheck.rows[0]) {
        return res.status(401).json({ error: 'Nykyinen salasana on väärin.' });
      }

      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [luoHash(newPassword), userCheck.rows[0].id]);
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
    const result = await db.query(
      'SELECT id, name, message, created_at, is_admin, admin_reply FROM guestbook ORDER BY created_at DESC'
    );
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

    await db.query('INSERT INTO guestbook (name, message, is_admin) VALUES ($1, $2, FALSE)', [String(name).trim(), String(message).trim()]);
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
      const name = String(req.body?.name || '');
      const message = String(req.body?.message || '');
      if (!name.trim()) return res.status(400).json({ error: 'Nimi on pakollinen.' });
      if (!message.trim()) return res.status(400).json({ error: 'Viesti on pakollinen.' });
      if (name.trim().length > 100) return res.status(400).json({ error: 'Nimi on liian pitkä (max 100 merkkiä).' });
      if (message.trim().length > 2000) return res.status(400).json({ error: 'Viesti on liian pitkä (max 2000 merkkiä).' });
      await db.query('INSERT INTO guestbook (name, message, is_admin) VALUES ($1, $2, TRUE)', [name.trim(), message.trim()]);
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

    res.json({
      sorola: sorola.rows,
      srla: srla.rows,
      srl: srl.rows
    });
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

    const domainTable = {
      'soro.la': 'links',
      'srla.fi': 'srla_links',
      'srl.la': 'srl_links'
    }[domain];

    if (!domainTable) return res.status(400).json({ error: 'Virheellinen domain.' });

    try {
      await db.query(
        `INSERT INTO ${domainTable} (short_path, original_url, clicks) VALUES ($1, $2, 0)`,
        [pathValue, originalURL]
      );
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

    const domainTable = {
      'soro.la': 'links',
      'srla.fi': 'srla_links',
      'srl.la': 'srl_links'
    }[domain];

    if (!domainTable) return res.status(400).json({ error: 'Virheellinen domain.' });

    await db.query(`UPDATE ${domainTable} SET original_url = $1 WHERE short_path = $2`, [newOriginalURL, pathValue]);
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

    const domainTable = {
      'soro.la': 'links',
      'srla.fi': 'srla_links',
      'srl.la': 'srl_links'
    }[domainToRemove];

    if (!domainTable) return res.status(400).json({ error: 'Virheellinen domain.' });

    await db.query(`DELETE FROM ${domainTable} WHERE short_path = $1`, [pathToRemove]);
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

    const domainConfig = {
      'srla.fi': { table: 'srla_links', baseUrl: 'https://srla.fi' },
      'srl.la': { table: 'srl_links', baseUrl: 'https://srl.la' }
    }[domain];

    if (!kohdeUrl) {
      return res.status(400).json({ error: 'URL puuttuu' });
    }

    if (!domainConfig) {
      return res.status(400).json({ error: 'Virheellinen domain.' });
    }

    if (!koodi || String(koodi).trim() === '') koodi = luoSatunnainenPolku();
    else koodi = String(koodi).trim().replace(/[^a-zA-Z0-9_-]/g, '');

    try {
      await db.query(
        `INSERT INTO ${domainConfig.table} (short_path, original_url, clicks) VALUES ($1, $2, 0)`,
        [koodi, kohdeUrl]
      );
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Tämä lyhenne on jo käytössä!' });
      }
      throw error;
    }

    return res.json({ success: true, shortUrl: `${domainConfig.baseUrl}/${koodi}` });
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

    const body = await fs.readFile(file.path);

    await s3.send(new PutObjectCommand({
      Bucket: shareBucketName,
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

    const downloadUrl = `${req.protocol}://${req.get('host')}/api/download?file=${encodeURIComponent(fileName)}`;
    return res.json({ url: downloadUrl, id: fileName });
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  } finally {
    if (file?.path) {
      await fs.unlink(file.path).catch(() => {});
    }
  }
});

app.get('/api/download', async (req, res) => {
  const fileId = String(req.query.file || '');
  if (!fileId) {
    const errorPath = prefersEnglish(req) ? '/en/share/error' : '/jako/error';
    return res.redirect(302, errorPath);
  }

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: shareBucketName, Key: fileId }));
    const metadata = object.Metadata || {};

    const expiresAt = Number.parseInt(metadata.expiresat || '0', 10);
    if (expiresAt && Date.now() > expiresAt) {
      await s3.send(new DeleteObjectCommand({ Bucket: shareBucketName, Key: fileId })).catch(() => {});
      const errorPath = prefersEnglish(req) ? '/en/share/error' : '/jako/error';
      return res.redirect(302, errorPath);
    }

    const maxDownloads = Number.parseInt(metadata.maxdownloads || '0', 10);
    const downloads = Number.parseInt(metadata.downloads || '0', 10);

    if (maxDownloads > 0) {
      const currentDownloads = downloads + 1;

      if (currentDownloads >= maxDownloads) {
        await s3.send(new DeleteObjectCommand({ Bucket: shareBucketName, Key: fileId })).catch(() => {});
      } else {
        await s3.send(new CopyObjectCommand({
          Bucket: shareBucketName,
          Key: fileId,
          CopySource: `${shareBucketName}/${fileId}`,
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
    const originalName = metadata.originalname || fileId;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
    res.setHeader('ETag', object.ETag || '');

    if (!object.Body) {
      return res.status(404).send('Tiedostoa ei löydy.');
    }

    object.Body.on('error', () => res.destroy());
    object.Body.pipe(res);
  } catch {
    const errorPath = prefersEnglish(req) ? '/en/share/error' : '/jako/error';
    return res.redirect(302, errorPath);
  }
});

app.get('/api/humor/images', async (_req, res) => {
  try {
    const objects = await listAllObjects(humorBucketName);

    const images = await Promise.all(objects.map(async (obj) => {
      const head = await s3.send(new HeadObjectCommand({
        Bucket: humorBucketName,
        Key: obj.Key
      }));

      return {
        key: obj.Key,
        size: obj.Size,
        uploaded: obj.LastModified ? obj.LastModified.toISOString() : null,
        title: head.Metadata?.title || '',
        originalName: head.Metadata?.originalname || obj.Key
      };
    }));

    res.json({ images });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/humor/images', requireAuth, async (req, res) => {
  const key = String(req.query.key || '');
  if (!key) return res.status(400).json({ error: 'Parametri ?key puuttuu.' });

  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: humorBucketName,
      Key: key
    }));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/humor/upload', requireAuth, uploadHumor.single('file'), async (req, res) => {
  const file = req.file;
  const title = String(req.body?.title || '').trim();

  if (!file) return res.status(400).json({ error: 'Ei tiedostoa.' });
  if (!String(file.mimetype || '').startsWith('image/')) {
    await fs.unlink(file.path).catch(() => {});
    return res.status(400).json({ error: 'Vain kuvatiedostot (image/*) ovat sallittuja.' });
  }

  try {
    const id = crypto.randomUUID();
    const rawExt = (file.originalname.split('.').pop() || '').toLowerCase();
    const safeExt = /^[a-z0-9]{1,10}$/.test(rawExt) ? rawExt : 'jpg';
    const key = `${id}.${safeExt}`;
    const body = await fs.readFile(file.path);

    await s3.send(new PutObjectCommand({
      Bucket: humorBucketName,
      Key: key,
      Body: body,
      ContentType: file.mimetype || 'application/octet-stream',
      Metadata: {
        title,
        originalname: file.originalname,
        uploadedat: new Date().toISOString()
      }
    }));

    return res.json({ success: true, key });
  } catch (error) {
    return res.status(500).json({ error: `Palvelinvirhe: ${error.message}` });
  } finally {
    if (file?.path) {
      await fs.unlink(file.path).catch(() => {});
    }
  }
});

app.get('/api/humor/image', async (req, res) => {
  const key = String(req.query.key || '');

  if (!key) return res.status(400).send('Parametri ?key puuttuu.');
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,10}$/.test(key)) return res.status(400).send('Virheellinen avain.');

  try {
    const object = await s3.send(new GetObjectCommand({
      Bucket: humorBucketName,
      Key: key
    }));

    if (!object?.Body) {
      return res.status(404).send('Kuvaa ei löydy.');
    }

    res.setHeader('Content-Type', object.ContentType || 'application/octet-stream');
    res.setHeader('ETag', object.ETag || '');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    object.Body.on('error', () => res.destroy());
    object.Body.pipe(res);
  } catch {
    return res.status(404).send('Kuvaa ei löydy.');
  }
});

app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const port = Number.parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
