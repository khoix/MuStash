import crypto from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { fileTypeFromFile } from 'file-type';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const tempDir = path.join(dataDir, 'tmp');
const uploadsDir = path.join(dataDir, 'uploads');
const metaDir = path.join(dataDir, 'meta');
const secretFile = path.join(dataDir, '.mustash-secret');

const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_MB = clampNumber(process.env.MAX_FILE_MB, 100, 1, 2048);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_TTL_HOURS = clampNumber(process.env.MAX_TTL_HOURS, 168, 1, 24 * 365);
const DEFAULT_TTL_HOURS = Math.min(24, MAX_TTL_HOURS);
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const COOKIE_TTL_SECONDS = 15 * 60;
const production = process.env.NODE_ENV === 'production';
/** @type {string} */
let secret;
const scryptAsync = promisify(crypto.scrypt);

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/flac', 'flac']
]);

export async function createApp() {
  await Promise.all([
    fs.mkdir(tempDir, { recursive: true }),
    fs.mkdir(uploadsDir, { recursive: true }),
    fs.mkdir(metaDir, { recursive: true })
  ]);
  secret = await resolveServerSecret();

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(helmet({
    // Main-server is often reached over plain HTTP on LAN; do not force HTTPS upgrades.
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' }
  }));

  // When mounted (e.g. /mustash), redirect /mustash → /mustash/ so relative CSS/JS resolve under the prefix.
  app.use((req, res, next) => {
    if (!req.baseUrl) return next();
    const pathOnly = req.originalUrl.split('?')[0];
    if (req.path === '/' && !pathOnly.endsWith('/')) {
      const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      return res.redirect(301, `${req.baseUrl}/${qs}`);
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many uploads from this address. Try again later.' }
  });

  const unlockLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many unlock attempts. Try again later.' }
  });

  const upload = multer({
    dest: tempDir,
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 1,
      fields: 8,
      fieldNameSize: 64,
      fieldSize: 2048
    }
  });

  app.get('/health', (_req, res) => res.json({ status: 'OK', service: 'MuStash', ok: true }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/api/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      maxFileMb: MAX_FILE_MB,
      maxTtlHours: MAX_TTL_HOURS,
      defaultTtlHours: DEFAULT_TTL_HOURS
    });
  });

  app.post('/api/shares', sameOriginOnly, uploadLimiter, upload.single('file'), async (req, res, next) => {
    let tempPath = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose one media file to upload.' });

      const detected = await fileTypeFromFile(req.file.path);
      if (!detected || !allowedTypes.has(detected.mime)) {
        return res.status(415).json({ error: 'Unsupported media type. Use a common image, audio, or video format.' });
      }

      const ttlHours = parseTtl(req.body.ttlHours);
      if (ttlHours === null) {
        return res.status(400).json({ error: `Expiration must be between 0.25 and ${MAX_TTL_HOURS} hours.` });
      }

      const accessKey = String(req.body.accessKey || '');
      const linkSalt = String(req.body.linkSalt || '');
      const protectedShare = accessKey.length > 0 || linkSalt.length > 0;
      if (protectedShare && (!isAccessKey(accessKey) || !isLinkSalt(linkSalt))) {
        return res.status(400).json({ error: 'Invalid password-protection parameters.' });
      }

      const id = crypto.randomUUID();
      const ext = allowedTypes.get(detected.mime);
      const storageName = `${id}.${ext}`;
      const finalPath = path.join(uploadsDir, storageName);
      await fs.rename(req.file.path, finalPath);
      tempPath = null;

      let auth = null;
      if (protectedShare) auth = await hashAccessKey(accessKey);

      const now = Date.now();
      const meta = {
        id,
        originalName: safeDisplayName(req.file.originalname),
        mime: detected.mime,
        ext,
        size: req.file.size,
        storageName,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlHours * 60 * 60 * 1000).toISOString(),
        protected: protectedShare,
        linkSalt: protectedShare ? linkSalt : null,
        auth
      };

      await writeMeta(meta);
      res.status(201).json(publicMeta(meta, req));
    } catch (error) {
      next(error);
    } finally {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  });

  app.get('/api/shares/:id', async (req, res, next) => {
    try {
      const result = await getActiveShare(req.params.id);
      if (result.status === 'invalid' || result.status === 'missing') return res.status(404).json({ error: 'Share not found.' });
      if (result.status === 'expired') return res.status(410).json({ error: 'This stash has expired.' });
      res.set('Cache-Control', 'no-store');
      res.json(publicMeta(result.meta, req));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/shares/:id/unlock', sameOriginOnly, unlockLimiter, async (req, res, next) => {
    try {
      const result = await getActiveShare(req.params.id);
      if (result.status === 'invalid' || result.status === 'missing') return res.status(404).json({ error: 'Share not found.' });
      if (result.status === 'expired') return res.status(410).json({ error: 'This stash has expired.' });
      const meta = result.meta;
      if (!meta.protected) return res.status(204).end();

      const accessKey = String(req.body?.accessKey || '');
      if (!isAccessKey(accessKey) || !(await verifyAccessKey(accessKey, meta.auth))) {
        return res.status(401).json({ error: 'Incorrect password or link key.' });
      }

      const token = signAuthToken(meta.id, Math.min(Date.now() + COOKIE_TTL_SECONDS * 1000, Date.parse(meta.expiresAt)));
      const cookiePath = `${req.baseUrl || ''}/api/shares/${meta.id}`;
      const cookie = [
        `mustash_auth=${token}`,
        `Path=${cookiePath}`,
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${COOKIE_TTL_SECONDS}`
      ];
      if (production) cookie.push('Secure');
      res.setHeader('Set-Cookie', cookie.join('; '));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/shares/:id/content', async (req, res, next) => {
    try {
      const result = await getActiveShare(req.params.id);
      if (result.status === 'invalid' || result.status === 'missing') return res.status(404).send('Share not found.');
      if (result.status === 'expired') return res.status(410).send('This stash has expired.');
      const meta = result.meta;

      if (meta.protected && !requestHasValidAuth(req, meta.id)) {
        return res.status(401).send('Unlock required.');
      }

      const download = req.query.download === '1';
      res.set({
        'Content-Type': meta.mime,
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeRFC5987(meta.originalName)}`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      });
      res.sendFile(meta.storageName, { root: uploadsDir }, (error) => {
        if (error) next(error);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/s/:id', (_req, res) => res.sendFile(path.join(publicDir, 'share.html')));
  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  app.use(express.static(publicDir, {
    etag: true,
    maxAge: production ? '1h' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
      if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    }
  }));

  app.use((error, _req, res, next) => {
    console.error(error);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is too large. Maximum size is ${MAX_FILE_MB} MB.` });
      return res.status(400).json({ error: 'Upload rejected.' });
    }
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  const cleanupTimer = setInterval(() => cleanupExpired().catch(console.error), CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
  cleanupExpired().catch(console.error);

  return app;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.join(__dirname, 'server.mjs');
if (isDirectRun) {
  const app = await createApp();
  const server = app.listen(PORT, () => {
    console.log(`MuStash listening on http://localhost:${PORT}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

function clampNumber(raw, fallback, min, max) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

async function resolveServerSecret() {
  if (process.env.MUSTASH_SECRET && process.env.MUSTASH_SECRET.length >= 32) {
    return process.env.MUSTASH_SECRET;
  }

  try {
    const existing = (await fs.readFile(secretFile, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generated = crypto.randomBytes(32).toString('base64url');
  await fs.writeFile(secretFile, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
  console.warn(`MUSTASH_SECRET unset; persisted a server secret to ${secretFile}`);
  return generated;
}

function parseTtl(raw) {
  if (raw === undefined || raw === '') return DEFAULT_TTL_HOURS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0.25 || value > MAX_TTL_HOURS) return null;
  return value;
}

function safeDisplayName(name) {
  const base = path.basename(String(name || 'media'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim();
  return (base || 'media').slice(0, 120);
}

function validId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function isAccessKey(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isLinkSalt(value) {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

async function hashAccessKey(accessKey) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(accessKey, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt: salt.toString('base64url'), hash: Buffer.from(hash).toString('base64url') };
}

async function verifyAccessKey(accessKey, auth) {
  if (!auth?.salt || !auth?.hash) return false;
  const expected = Buffer.from(auth.hash, 'base64url');
  const actual = Buffer.from(await scryptAsync(accessKey, Buffer.from(auth.salt, 'base64url'), expected.length, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
  }));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function writeMeta(meta) {
  const target = path.join(metaDir, `${meta.id}.json`);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(meta), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, target);
}

async function getActiveShare(id) {
  if (!validId(id)) return { status: 'invalid' };
  try {
    const raw = await fs.readFile(path.join(metaDir, `${id}.json`), 'utf8');
    const meta = JSON.parse(raw);
    if (Date.parse(meta.expiresAt) <= Date.now()) {
      await deleteShare(meta);
      return { status: 'expired' };
    }
    return { status: 'active', meta };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
}

async function deleteShare(meta) {
  await Promise.all([
    fs.rm(path.join(metaDir, `${meta.id}.json`), { force: true }),
    fs.rm(path.join(uploadsDir, meta.storageName), { force: true })
  ]);
}

async function cleanupExpired() {
  const files = await fs.readdir(metaDir);
  await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
    try {
      const raw = await fs.readFile(path.join(metaDir, file), 'utf8');
      const meta = JSON.parse(raw);
      if (Date.parse(meta.expiresAt) <= Date.now()) await deleteShare(meta);
    } catch (error) {
      console.warn(`Cleanup skipped ${file}: ${error.message}`);
    }
  }));
}

function publicMeta(meta, req) {
  const base = req.baseUrl || '';
  return {
    id: meta.id,
    originalName: meta.originalName,
    mime: meta.mime,
    size: meta.size,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    protected: meta.protected,
    linkSalt: meta.protected ? meta.linkSalt : null,
    contentUrl: `${base}/api/shares/${meta.id}/content`
  };
}

function sameOriginOnly(req, res, next) {
  if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site request blocked.' });
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked.' });
    return next();
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
}

function signAuthToken(id, expiresAtMs) {
  const payload = Buffer.from(JSON.stringify({ id, exp: expiresAtMs })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function requestHasValidAuth(req, id) {
  const cookieHeader = req.get('cookie') || '';
  const match = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith('mustash_auth='));
  if (!match) return false;
  const token = match.slice('mustash_auth='.length);
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.id === id && Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

function encodeRFC5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
