import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminPublicDir = path.join(__dirname, 'public', 'admin');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const metaDir = path.join(dataDir, 'meta');

const ADMIN_PASSWORD = String(process.env.MUSTASH_ADMIN_PASSWORD || '');
const ADMIN_ENABLED = ADMIN_PASSWORD.length >= 12;
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const MAX_TTL_HOURS = clampNumber(process.env.MAX_TTL_HOURS, 168, 1, 24 * 365);
const production = process.env.NODE_ENV === 'production';

if (ADMIN_PASSWORD && !ADMIN_ENABLED) {
  console.warn('MUSTASH_ADMIN_PASSWORD is set but shorter than 12 characters; admin portal is disabled.');
}

export async function createAdminApp() {
  await Promise.all([
    fs.mkdir(uploadsDir, { recursive: true }),
    fs.mkdir(metaDir, { recursive: true })
  ]);

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(helmet({
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
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"]
      }
    },
    referrerPolicy: { policy: 'no-referrer' }
  }));

  app.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    if (!ADMIN_ENABLED) return res.status(404).send('Not found.');
    next();
  });
  app.use(express.json({ limit: '8kb' }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many admin login attempts. Try again later.' }
  });

  app.get('/api/admin/session', (req, res) => {
    res.json({ authenticated: requestHasValidAdminSession(req) });
  });

  app.post('/api/admin/login', sameOriginOnly, loginLimiter, (req, res) => {
    const candidate = String(req.body?.password || '');
    if (!safePasswordEqual(candidate, ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Incorrect admin password.' });
    }

    const expiresAt = Date.now() + ADMIN_SESSION_SECONDS * 1000;
    const token = signAdminToken(expiresAt);
    res.setHeader('Set-Cookie', adminCookie(req, token, ADMIN_SESSION_SECONDS));
    res.status(204).end();
  });

  app.post('/api/admin/logout', sameOriginOnly, (req, res) => {
    res.setHeader('Set-Cookie', clearAdminCookie(req));
    res.status(204).end();
  });

  app.get('/api/admin/stashes', requireAdmin, async (req, res, next) => {
    try {
      const stashes = await listActiveStashes();
      const mapped = stashes.map((meta) => adminPublicMeta(meta, req));
      res.json({
        stashes: mapped,
        summary: {
          count: mapped.length,
          totalSize: mapped.reduce((sum, stash) => sum + stash.totalSize, 0),
          protectedCount: mapped.filter((stash) => stash.protected).length,
          previewOnlyCount: mapped.filter((stash) => !stash.allowDownload).length
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/admin/stashes/:id', requireAdmin, sameOriginOnly, async (req, res, next) => {
    try {
      const result = await readActiveStash(req.params.id);
      if (result.status === 'missing' || result.status === 'invalid') return res.status(404).json({ error: 'Stash not found.' });
      if (result.status === 'expired') return res.status(410).json({ error: 'Stash has expired.' });

      const meta = result.meta;
      let changed = false;

      if (Object.hasOwn(req.body || {}, 'name')) {
        const cleaned = safeStashName(req.body.name);
        meta.name = cleaned || defaultStashName(meta.files);
        changed = true;
      }

      if (Object.hasOwn(req.body || {}, 'allowDownload')) {
        if (typeof req.body.allowDownload !== 'boolean') {
          return res.status(400).json({ error: 'allowDownload must be true or false.' });
        }
        meta.allowDownload = req.body.allowDownload;
        changed = true;
      }

      if (Object.hasOwn(req.body || {}, 'expiresAt')) {
        const expiresAt = Date.parse(String(req.body.expiresAt || ''));
        const now = Date.now();
        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
          return res.status(400).json({ error: 'Expiry must be a future date and time.' });
        }
        if (expiresAt > now + MAX_TTL_HOURS * 60 * 60 * 1000) {
          return res.status(400).json({ error: `Expiry cannot be more than ${MAX_TTL_HOURS} hours from now.` });
        }
        meta.expiresAt = new Date(expiresAt).toISOString();
        changed = true;
      }

      if (!changed) return res.status(400).json({ error: 'No supported changes were provided.' });

      await writeMeta(meta);
      res.json(adminPublicMeta(meta, req));
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/admin/stashes/:id', requireAdmin, sameOriginOnly, async (req, res, next) => {
    try {
      const result = await readActiveStash(req.params.id, { deleteExpired: false });
      if (result.status === 'missing' || result.status === 'invalid') return res.status(404).json({ error: 'Stash not found.' });
      await deleteStash(result.meta);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get('/admin', (req, res) => {
    const base = String(req.baseUrl || '').replace(/\/+$/, '');
    res.redirect(301, `${base}/admin/` || '/admin/');
  });

  app.use('/admin', express.static(adminPublicDir, {
    index: 'index.html',
    etag: true,
    maxAge: production ? '1h' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    }
  }));

  app.use((error, _req, res, _next) => {
    console.error('MuStash admin error:', error);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Admin operation failed.' });
  });

  return app;
}

function requireAdmin(req, res, next) {
  if (!requestHasValidAdminSession(req)) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

function safePasswordEqual(candidate, expected) {
  const left = crypto.createHash('sha256').update(candidate).digest();
  const right = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(left, right);
}

function signAdminToken(expiresAtMs) {
  const payload = Buffer.from(JSON.stringify({ scope: 'admin', exp: expiresAtMs })).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function requestHasValidAdminSession(req) {
  const cookieHeader = req.get('cookie') || '';
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('mustash_admin='));
  if (!match) return false;

  const [payload, signature] = match.slice('mustash_admin='.length).split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.scope === 'admin' && Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

function adminCookie(req, token, maxAgeSeconds) {
  const parts = [
    `mustash_admin=${token}`,
    `Path=${adminCookiePath(req)}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (production) parts.push('Secure');
  return parts.join('; ');
}

function clearAdminCookie(req) {
  const parts = [
    'mustash_admin=',
    `Path=${adminCookiePath(req)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (production) parts.push('Secure');
  return parts.join('; ');
}

function adminCookiePath(req) {
  const base = String(req.baseUrl || '').replace(/\/+$/, '');
  return base ? `${base}/` : '/';
}

async function listActiveStashes() {
  const entries = await fs.readdir(metaDir, { withFileTypes: true });
  const stashes = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(metaDir, entry.name);
    try {
      const meta = normalizeMeta(JSON.parse(await fs.readFile(filePath, 'utf8')));
      if (Date.parse(meta.expiresAt) <= Date.now()) {
        await deleteStash(meta);
        continue;
      }
      stashes.push(meta);
    } catch (error) {
      console.warn(`Admin skipped ${entry.name}: ${error.message}`);
    }
  }

  stashes.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return stashes;
}

async function readActiveStash(id, { deleteExpired = true } = {}) {
  if (!validId(id)) return { status: 'invalid' };
  try {
    const raw = await fs.readFile(path.join(metaDir, `${id}.json`), 'utf8');
    const meta = normalizeMeta(JSON.parse(raw));
    if (Date.parse(meta.expiresAt) <= Date.now()) {
      if (deleteExpired) await deleteStash(meta);
      return { status: 'expired', meta };
    }
    return { status: 'active', meta };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
}

async function writeMeta(meta) {
  const target = path.join(metaDir, `${meta.id}.json`);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(meta), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, target);
}

async function deleteStash(meta) {
  const storageNames = [...new Set((meta.files || []).map((file) => file.storageName).filter(Boolean))];
  await Promise.all([
    fs.rm(path.join(metaDir, `${meta.id}.json`), { force: true }),
    ...storageNames.map((storageName) => fs.rm(path.join(uploadsDir, storageName), { force: true }))
  ]);
}

function normalizeMeta(meta) {
  if (Array.isArray(meta.files) && meta.files.length > 0) {
    const files = meta.files.map((file, index) => ({
      id: String(file.id || `legacy-${index}`),
      originalName: safeDisplayName(file.originalName),
      mime: String(file.mime || 'application/octet-stream'),
      ext: String(file.ext || ''),
      size: Number(file.size || 0),
      storageName: String(file.storageName || '')
    }));
    return {
      ...meta,
      name: safeStashName(meta.name) || defaultStashName(files),
      files,
      totalSize: Number.isFinite(Number(meta.totalSize))
        ? Number(meta.totalSize)
        : files.reduce((sum, file) => sum + file.size, 0),
      allowDownload: meta.allowDownload !== false,
      protected: Boolean(meta.protected)
    };
  }

  if (meta.storageName) {
    const legacyFile = {
      id: 'legacy',
      originalName: safeDisplayName(meta.originalName),
      mime: String(meta.mime || 'application/octet-stream'),
      ext: String(meta.ext || ''),
      size: Number(meta.size || 0),
      storageName: String(meta.storageName)
    };
    return {
      ...meta,
      name: safeStashName(meta.name) || legacyFile.originalName,
      files: [legacyFile],
      totalSize: legacyFile.size,
      allowDownload: meta.allowDownload !== false,
      protected: Boolean(meta.protected)
    };
  }

  return {
    ...meta,
    name: safeStashName(meta.name) || 'Stash',
    files: [],
    totalSize: 0,
    allowDownload: meta.allowDownload !== false,
    protected: Boolean(meta.protected)
  };
}

function adminPublicMeta(meta, req) {
  const base = String(req.baseUrl || '').replace(/\/+$/, '');
  return {
    id: meta.id,
    name: meta.name,
    fileCount: meta.files.length,
    totalSize: meta.totalSize,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    protected: meta.protected,
    allowDownload: meta.allowDownload !== false,
    previewUrl: `${base}/s/${encodeURIComponent(meta.id)}`,
    files: meta.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      mime: file.mime,
      size: file.size
    }))
  };
}

function safeDisplayName(name) {
  const base = path.basename(String(name || 'file'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim();
  return (base || 'file').slice(0, 120);
}

function safeStashName(name) {
  return String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function defaultStashName(files) {
  if (files.length === 1) return files[0].originalName;
  return `${files.length} files`;
}

function validId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
}

function clampNumber(raw, fallback, min, max) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
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
