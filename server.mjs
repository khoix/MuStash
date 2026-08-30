import crypto from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDeflateRaw } from 'node:zlib';
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
const MAX_STASH_MB = clampNumber(process.env.MAX_STASH_MB, MAX_FILE_MB, 1, 2048);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_STASH_BYTES = MAX_STASH_MB * 1024 * 1024;
const MAX_FILES_PER_STASH = clampNumber(process.env.MAX_FILES_PER_STASH, 25, 1, 100);
const MAX_MULTIPART_OVERHEAD_BYTES = 128 * 1024 + MAX_FILES_PER_STASH * 16 * 1024;
const MAX_TTL_HOURS = clampNumber(process.env.MAX_TTL_HOURS, 168, 1, 24 * 365);
const DEFAULT_TTL_HOURS = Math.min(24, MAX_TTL_HOURS);
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const COOKIE_TTL_SECONDS = 15 * 60;
const production = process.env.NODE_ENV === 'production';
/** @type {string} */
let secret;
const scryptAsync = promisify(crypto.scrypt);
const CRC32_TABLE = buildCrc32Table();

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
  ['audio/flac', 'flac'],
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.oasis.opendocument.text', 'odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  ['application/vnd.oasis.opendocument.presentation', 'odp']
]);

const allowedTextExtensions = new Map([
  ['.txt', { mime: 'text/plain; charset=utf-8', ext: 'txt' }],
  ['.csv', { mime: 'text/csv; charset=utf-8', ext: 'csv' }],
  ['.md', { mime: 'text/markdown; charset=utf-8', ext: 'md' }],
  ['.markdown', { mime: 'text/markdown; charset=utf-8', ext: 'md' }],
  ['.json', { mime: 'application/json; charset=utf-8', ext: 'json' }]
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
        frameSrc: ["'self'"],
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
      files: MAX_FILES_PER_STASH,
      fields: 10,
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
      maxStashMb: MAX_STASH_MB,
      maxFiles: MAX_FILES_PER_STASH,
      maxTtlHours: MAX_TTL_HOURS,
      defaultTtlHours: DEFAULT_TTL_HOURS
    });
  });

  app.post(
    '/api/shares',
    sameOriginOnly,
    uploadLimiter,
    rejectClearlyOversizedMultipart,
    upload.array('file', MAX_FILES_PER_STASH),
    async (req, res, next) => {
      const incoming = Array.isArray(req.files) ? req.files : [];
      const tempPaths = new Set(incoming.map((file) => file.path));
      const movedPaths = [];
      let committed = false;

      try {
        if (incoming.length === 0) return res.status(400).json({ error: 'Choose a file first.' });

        const totalSize = incoming.reduce((sum, file) => sum + Number(file.size || 0), 0);
        if (totalSize > MAX_STASH_BYTES) {
          return res.status(413).json({ error: `Stash is too large. Maximum total size is ${MAX_STASH_MB} MB.` });
        }

        const detectedTypes = await Promise.all(incoming.map((file) => detectAllowedUpload(file.path, file.originalname)));
        if (detectedTypes.some((detected) => !detected)) {
          return res.status(415).json({ error: 'Unsupported file type. Use a supported image, audio, video, PDF, Office/OpenDocument, or UTF-8 text format.' });
        }

        const ttlHours = parseTtl(req.body.ttlHours);
        if (ttlHours === null) {
          return res.status(400).json({ error: `Expiration must be between 0.25 and ${MAX_TTL_HOURS} hours.` });
        }

        const allowDownload = parseAllowDownload(req.body.allowDownload);
        if (allowDownload === null) {
          return res.status(400).json({ error: 'Invalid download preference.' });
        }

        const accessKey = String(req.body.accessKey || '');
        const linkSalt = String(req.body.linkSalt || '');
        const protectedShare = accessKey.length > 0 || linkSalt.length > 0;
        if (protectedShare && (!isAccessKey(accessKey) || !isLinkSalt(linkSalt))) {
          return res.status(400).json({ error: 'Invalid password-protection parameters.' });
        }

        const id = crypto.randomUUID();
        const files = [];
        for (let index = 0; index < incoming.length; index += 1) {
          const source = incoming[index];
          const detected = detectedTypes[index];
          const fileId = crypto.randomUUID();
          const storageName = `${id}-${fileId}.${detected.ext}`;
          const finalPath = path.join(uploadsDir, storageName);
          await fs.rename(source.path, finalPath);
          tempPaths.delete(source.path);
          movedPaths.push(finalPath);
          files.push({
            id: fileId,
            originalName: safeDisplayName(source.originalname),
            mime: detected.mime,
            ext: detected.ext,
            size: source.size,
            storageName
          });
        }

        let auth = null;
        if (protectedShare) auth = await hashAccessKey(accessKey);

        const requestedName = safeStashName(req.body.stashName);
        const now = Date.now();
        const meta = {
          id,
          name: requestedName || defaultStashName(files),
          files,
          totalSize,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ttlHours * 60 * 60 * 1000).toISOString(),
          protected: protectedShare,
          allowDownload,
          linkSalt: protectedShare ? linkSalt : null,
          auth
        };

        await writeMeta(meta);
        committed = true;
        res.status(201).json(publicMeta(meta, req));
      } catch (error) {
        next(error);
      } finally {
        await Promise.all([...tempPaths].map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
        if (!committed) await Promise.all(movedPaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
      }
    }
  );

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

  // Compatibility route for existing clients and single-file shares.
  app.get('/api/shares/:id/content', async (req, res, next) => {
    try {
      const result = await getActiveShare(req.params.id);
      if (result.status === 'invalid' || result.status === 'missing') return res.status(404).send('Share not found.');
      if (result.status === 'expired') return res.status(410).send('This stash has expired.');
      const file = result.meta.files[0];
      if (!file) return res.status(404).send('File not found.');
      return serveShareFile(req, res, next, result.meta, file);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/shares/:id/files/:fileId/content', async (req, res, next) => {
    try {
      const result = await getActiveShare(req.params.id);
      if (result.status === 'invalid' || result.status === 'missing') return res.status(404).send('Share not found.');
      if (result.status === 'expired') return res.status(410).send('This stash has expired.');
      const file = result.meta.files.find((candidate) => candidate.id === req.params.fileId);
      if (!file) return res.status(404).send('File not found.');
      return serveShareFile(req, res, next, result.meta, file);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/shares/:id/download', sameOriginOnly, async (req, res, next) => {
    try {
      const result = await getActiveShare(req.params.id);
      if (result.status === 'invalid' || result.status === 'missing') return res.status(404).json({ error: 'Share not found.' });
      if (result.status === 'expired') return res.status(410).json({ error: 'This stash has expired.' });
      const meta = result.meta;

      if (meta.protected && !requestHasValidAuth(req, meta.id)) {
        return res.status(401).json({ error: 'Unlock required.' });
      }
      if (meta.allowDownload === false) {
        return res.status(403).json({ error: 'Downloads are disabled for this stash.' });
      }

      const requestedIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map(String) : [];
      const uniqueIds = [...new Set(requestedIds)];
      if (uniqueIds.length < 2 || uniqueIds.length > MAX_FILES_PER_STASH) {
        return res.status(400).json({ error: 'Select at least two valid files for a ZIP download.' });
      }

      const selected = uniqueIds.map((fileId) => meta.files.find((file) => file.id === fileId));
      if (selected.some((file) => !file)) {
        return res.status(400).json({ error: 'One or more selected files are not in this stash.' });
      }

      await streamZip(meta, selected, res);
    } catch (error) {
      if (res.headersSent) return res.destroy(error);
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
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `A file is too large. Maximum per-file size is ${MAX_FILE_MB} MB.` });
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(413).json({ error: `Too many files. Maximum is ${MAX_FILES_PER_STASH} files per stash.` });
      }
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

function rejectClearlyOversizedMultipart(req, res, next) {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_STASH_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
    return res.status(413).json({ error: `Stash is too large. Maximum total size is ${MAX_STASH_MB} MB.` });
  }
  next();
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

async function detectAllowedUpload(filePath, originalName) {
  const detected = await fileTypeFromFile(filePath);
  if (detected) {
    const ext = allowedTypes.get(detected.mime);
    return ext ? { mime: detected.mime, ext } : null;
  }

  const textType = allowedTextExtensions.get(path.extname(String(originalName || '')).toLowerCase());
  if (!textType || !(await isUtf8TextFile(filePath))) return null;
  return textType;
}

async function isUtf8TextFile(filePath) {
  const handle = await fs.open(filePath, 'r');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;

  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const text = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return false;
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

function parseTtl(raw) {
  if (raw === undefined || raw === '') return DEFAULT_TTL_HOURS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0.25 || value > MAX_TTL_HOURS) return null;
  return value;
}

function parseAllowDownload(raw) {
  if (raw === undefined || raw === '') return true;
  const value = String(raw).toLowerCase();
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
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
    const meta = normalizeMeta(JSON.parse(raw));
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

function normalizeMeta(meta) {
  if (Array.isArray(meta.files) && meta.files.length > 0) {
    const files = meta.files.map((file, index) => ({
      id: String(file.id || `legacy-${index}`),
      originalName: safeDisplayName(file.originalName),
      mime: file.mime,
      ext: file.ext,
      size: Number(file.size || 0),
      storageName: file.storageName
    }));
    return {
      ...meta,
      name: safeStashName(meta.name) || defaultStashName(files),
      files,
      totalSize: Number.isFinite(Number(meta.totalSize))
        ? Number(meta.totalSize)
        : files.reduce((sum, file) => sum + file.size, 0)
    };
  }

  if (meta.storageName) {
    const legacyFile = {
      id: 'legacy',
      originalName: safeDisplayName(meta.originalName),
      mime: meta.mime,
      ext: meta.ext,
      size: Number(meta.size || 0),
      storageName: meta.storageName
    };
    return {
      ...meta,
      name: safeStashName(meta.name) || legacyFile.originalName,
      files: [legacyFile],
      totalSize: legacyFile.size
    };
  }

  return { ...meta, files: [], totalSize: 0, name: safeStashName(meta.name) || 'Stash' };
}

async function deleteShare(meta) {
  const storageNames = [...new Set((meta.files || []).map((file) => file.storageName).filter(Boolean))];
  await Promise.all([
    fs.rm(path.join(metaDir, `${meta.id}.json`), { force: true }),
    ...storageNames.map((storageName) => fs.rm(path.join(uploadsDir, storageName), { force: true }))
  ]);
}

async function cleanupExpired() {
  const files = await fs.readdir(metaDir);
  await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
    try {
      const raw = await fs.readFile(path.join(metaDir, file), 'utf8');
      const meta = normalizeMeta(JSON.parse(raw));
      if (Date.parse(meta.expiresAt) <= Date.now()) await deleteShare(meta);
    } catch (error) {
      console.warn(`Cleanup skipped ${file}: ${error.message}`);
    }
  }));
}

function publicMeta(meta, req) {
  const base = req.baseUrl || '';
  const files = meta.files.map((file) => ({
    id: file.id,
    originalName: file.originalName,
    mime: file.mime,
    size: file.size,
    contentUrl: `${base}/api/shares/${meta.id}/files/${encodeURIComponent(file.id)}/content`
  }));
  const first = files[0] || null;

  return {
    id: meta.id,
    name: meta.name,
    files,
    fileCount: files.length,
    totalSize: meta.totalSize,
    // Compatibility aliases for existing single-file clients.
    originalName: first?.originalName || meta.name,
    mime: first?.mime || 'application/octet-stream',
    size: first?.size || 0,
    contentUrl: `${base}/api/shares/${meta.id}/content`,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    protected: meta.protected,
    allowDownload: meta.allowDownload !== false,
    linkSalt: meta.protected ? meta.linkSalt : null
  };
}

function serveShareFile(req, res, next, meta, file) {
  if (meta.protected && !requestHasValidAuth(req, meta.id)) {
    return res.status(401).send('Unlock required.');
  }

  const allowDownload = meta.allowDownload !== false;
  const download = req.query.download === '1';
  if (download && !allowDownload) {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    return res.status(403).send('Downloads are disabled for this stash.');
  }

  res.set({
    'Content-Type': file.mime,
    'Content-Disposition': allowDownload
      ? `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeRFC5987(file.originalName)}`
      : 'inline',
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  res.sendFile(file.storageName, { root: uploadsDir }, (error) => {
    if (error) next(error);
  });
}

async function streamZip(meta, files, res) {
  const zipName = zipDownloadName(new Date());
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${zipName}"`,
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-MuStash-Zip-Filename': zipName,
    'X-MuStash-Expires-At': meta.expiresAt
  });

  let offset = 0;
  const centralEntries = [];
  const usedNames = new Set();
  const stamp = dosDateTime(new Date(meta.createdAt || Date.now()));

  for (const file of files) {
    const entryName = uniqueZipEntryName(file.originalName, usedNames);
    const nameBytes = Buffer.from(entryName, 'utf8');
    const localOffset = offset;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0808, 6); // data descriptor + UTF-8 name
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(stamp.time, 10);
    localHeader.writeUInt16LE(stamp.date, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(0, 18);
    localHeader.writeUInt32LE(0, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    await writeResponseChunk(res, localHeader);
    await writeResponseChunk(res, nameBytes);
    offset += localHeader.length + nameBytes.length;

    let crc = 0xffffffff;
    let uncompressedSize = 0;
    let compressedSize = 0;
    const source = createReadStream(path.join(uploadsDir, file.storageName));
    const deflater = createDeflateRaw({ level: 6 });
    source.on('data', (chunk) => {
      crc = updateCrc32(crc, chunk);
      uncompressedSize += chunk.length;
    });
    source.on('error', (error) => deflater.destroy(error));
    source.pipe(deflater);

    for await (const chunk of deflater) {
      compressedSize += chunk.length;
      await writeResponseChunk(res, chunk);
      offset += chunk.length;
    }

    const finalCrc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(finalCrc, 4);
    descriptor.writeUInt32LE(compressedSize >>> 0, 8);
    descriptor.writeUInt32LE(uncompressedSize >>> 0, 12);
    await writeResponseChunk(res, descriptor);
    offset += descriptor.length;

    centralEntries.push({
      nameBytes,
      crc: finalCrc,
      compressedSize,
      uncompressedSize,
      localOffset,
      time: stamp.time,
      date: stamp.date
    });
  }

  const centralStart = offset;
  for (const entry of centralEntries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0808, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(entry.time, 12);
    header.writeUInt16LE(entry.date, 14);
    header.writeUInt32LE(entry.crc >>> 0, 16);
    header.writeUInt32LE(entry.compressedSize >>> 0, 20);
    header.writeUInt32LE(entry.uncompressedSize >>> 0, 24);
    header.writeUInt16LE(entry.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.localOffset >>> 0, 42);
    await writeResponseChunk(res, header);
    await writeResponseChunk(res, entry.nameBytes);
    offset += header.length + entry.nameBytes.length;
  }

  const centralSize = offset - centralStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralEntries.length, 8);
  end.writeUInt16LE(centralEntries.length, 10);
  end.writeUInt32LE(centralSize >>> 0, 12);
  end.writeUInt32LE(centralStart >>> 0, 16);
  end.writeUInt16LE(0, 20);
  await writeResponseChunk(res, end);
  res.end();
}

async function writeResponseChunk(res, chunk) {
  if (res.destroyed) throw new Error('Download connection closed.');
  if (res.write(chunk)) return;
  await Promise.race([
    once(res, 'drain'),
    once(res, 'close').then(() => { throw new Error('Download connection closed.'); })
  ]);
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function updateCrc32(crc, buffer) {
  let value = crc >>> 0;
  for (const byte of buffer) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function uniqueZipEntryName(originalName, usedNames) {
  const safe = safeDisplayName(originalName);
  let candidate = safe;
  let index = 2;
  const ext = path.extname(safe);
  const base = ext ? safe.slice(0, -ext.length) : safe;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} (${index})${ext}`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const packedDate = (((year - 1980) & 0x7f) << 9)
    | (((date.getMonth() + 1) & 0x0f) << 5)
    | (date.getDate() & 0x1f);
  return { time, date: packedDate };
}

function zipDownloadName(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `mustash-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}.zip`;
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
