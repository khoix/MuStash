import { initTheme } from './theme.js';
import { deriveAccessKey } from './crypto.js';

initTheme();

const ZIP_CACHE_NAME = 'mustash-zips-v1';
const ZIP_CACHE_TTL_MS = 30 * 60 * 1000;
const mobileZipCacheQuery = matchMedia('(hover: none) and (pointer: coarse)');

const id = location.pathname.split('/').filter(Boolean).at(-1);
const loadingState = document.getElementById('loadingState');
const expiredState = document.getElementById('expiredState');
const unlockForm = document.getElementById('unlockForm');
const unlockPassword = document.getElementById('unlockPassword');
const unlockStatus = document.getElementById('unlockStatus');
const mediaState = document.getElementById('mediaState');
const mediaFrame = document.getElementById('mediaFrame');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const expiryLine = document.getElementById('expiryLine');
const stashFileList = document.getElementById('stashFileList');
const protectedPill = document.getElementById('protectedPill');
const previewOnlyPill = document.getElementById('previewOnlyPill');
const shareButton = document.getElementById('shareButton');
const downloadButton = document.getElementById('downloadButton');
const downloadPanel = document.getElementById('downloadPanel');
const downloadFileList = document.getElementById('downloadFileList');
const downloadStatus = document.getElementById('downloadStatus');
const downloadSelectAll = document.getElementById('downloadSelectAll');
const downloadCancel = document.getElementById('downloadCancel');
const downloadSelected = document.getElementById('downloadSelected');

let meta;
let activeFileId = null;
init();

unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  unlockStatus.textContent = '';
  const password = unlockPassword.value;
  if (password.length < 8) return (unlockStatus.textContent = 'Use the full password.');
  try {
    const key = await deriveAccessKey(password, meta.linkSalt);
    await unlock(key);
    await showMedia();
  } catch (error) {
    unlockStatus.textContent = error.message || 'Could not unlock this stash.';
  }
});

shareButton.addEventListener('click', async () => {
  const url = location.href;
  if (navigator.share) {
    try { await navigator.share({ title: meta?.name || meta?.originalName || 'MuStash share', url }); } catch (error) { if (error.name !== 'AbortError') console.warn(error); }
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    shareButton.textContent = 'Copied';
    setTimeout(() => { shareButton.textContent = 'Share'; }, 1200);
  }
});

downloadButton.addEventListener('click', (event) => {
  if (!meta || meta.allowDownload === false || shareFiles().length <= 1) return;
  event.preventDefault();
  downloadPanel.hidden = false;
  downloadStatus.textContent = '';
  downloadPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

downloadCancel.addEventListener('click', () => {
  downloadPanel.hidden = true;
  downloadStatus.textContent = '';
});

downloadSelectAll.addEventListener('click', () => {
  const inputs = Array.from(downloadFileList.querySelectorAll('input[type="checkbox"]'));
  const shouldSelect = inputs.some((input) => !input.checked);
  for (const input of inputs) input.checked = shouldSelect;
  syncDownloadControls();
});

downloadFileList.addEventListener('change', syncDownloadControls);

downloadSelected.addEventListener('click', async () => {
  const selectedIds = Array.from(downloadFileList.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
  downloadStatus.textContent = '';
  if (selectedIds.length === 0) {
    downloadStatus.textContent = 'Select at least one file.';
    return;
  }

  if (selectedIds.length === 1) {
    const file = shareFiles().find((candidate) => candidate.id === selectedIds[0]);
    if (file) triggerFileDownload(file);
    downloadPanel.hidden = true;
    return;
  }

  const oldText = downloadSelected.textContent;
  downloadSelected.disabled = true;
  downloadSelected.textContent = 'Preparing…';
  try {
    const response = await getZipResponse(selectedIds);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Could not prepare the ZIP.');
    }
    const filename = response.headers.get('X-MuStash-Zip-Filename') || localZipName(new Date());
    const blob = await response.blob();
    triggerBlobDownload(blob, filename);
    downloadPanel.hidden = true;
  } catch (error) {
    downloadStatus.textContent = error.message || 'Could not prepare the ZIP.';
  } finally {
    downloadSelected.disabled = false;
    downloadSelected.textContent = oldText;
  }
});

async function init() {
  void purgeExpiredZipCache();
  try {
    const response = await fetch(`../api/shares/${encodeURIComponent(id)}`);
    if (!response.ok) return showExpired();
    meta = normalizePublicMeta(await response.json());
    document.title = `${meta.name} · MuStash`;

    if (!meta.protected) return showMedia();
    protectedPill.hidden = false;

    const key = new URLSearchParams(location.hash.slice(1)).get('k');
    if (key) {
      try {
        await unlock(key);
        return showMedia();
      } catch {
        history.replaceState(null, '', location.pathname);
      }
    }

    loadingState.hidden = true;
    unlockForm.hidden = false;
    unlockPassword.focus();
  } catch {
    showExpired();
  }
}

function normalizePublicMeta(payload) {
  const files = Array.isArray(payload.files) && payload.files.length > 0
    ? payload.files
    : [{
        id: 'legacy',
        originalName: payload.originalName,
        mime: payload.mime,
        size: payload.size,
        contentUrl: payload.contentUrl
      }];
  return {
    ...payload,
    name: payload.name || payload.originalName || (files.length === 1 ? files[0].originalName : `${files.length} files`),
    files,
    totalSize: Number(payload.totalSize ?? files.reduce((sum, file) => sum + Number(file.size || 0), 0))
  };
}

async function unlock(accessKey) {
  const response = await fetch(`../api/shares/${encodeURIComponent(id)}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessKey })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Unlock failed.');
  }
}

async function showMedia() {
  const files = shareFiles();
  const allowDownload = meta.allowDownload !== false;
  loadingState.hidden = true;
  unlockForm.hidden = true;
  mediaState.hidden = false;
  fileName.textContent = meta.name;
  fileSize.textContent = files.length === 1
    ? formatBytes(files[0].size)
    : `${files.length} files · ${formatBytes(meta.totalSize)}`;
  expiryLine.textContent = `Expiry: ${formatExpiry(meta.expiresAt)}`;
  previewOnlyPill.hidden = allowDownload;
  downloadButton.hidden = !allowDownload;
  mediaFrame.classList.toggle('preview-only', !allowDownload);

  renderFileList(files);
  renderDownloadList(files);
  await selectFile(files[0]);

  if (allowDownload && files.length === 1) {
    downloadButton.href = `${files[0].contentUrl}?download=1`;
  } else {
    downloadButton.href = '#download';
  }
}

function shareFiles() {
  return meta?.files || [];
}

function renderFileList(files) {
  stashFileList.replaceChildren();
  if (files.length <= 1) {
    stashFileList.hidden = true;
    return;
  }

  for (const file of files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stash-file-row';
    button.dataset.fileId = file.id;
    button.dataset.testid = 'stash-file-row';

    const name = document.createElement('span');
    name.className = 'stash-file-name';
    name.textContent = file.originalName;
    const size = document.createElement('span');
    size.className = 'stash-file-size';
    size.textContent = formatBytes(file.size);
    button.append(name, size);
    button.addEventListener('click', () => selectFile(file));
    stashFileList.append(button);
  }
  stashFileList.hidden = false;
}

function renderDownloadList(files) {
  downloadFileList.replaceChildren();
  if (files.length <= 1) {
    downloadPanel.hidden = true;
    return;
  }

  for (const file of files) {
    const label = document.createElement('label');
    label.className = 'download-file-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = file.id;
    input.checked = true;
    input.dataset.testid = 'download-file-checkbox';
    const name = document.createElement('span');
    name.className = 'download-file-name';
    name.textContent = file.originalName;
    const size = document.createElement('span');
    size.className = 'download-file-size';
    size.textContent = formatBytes(file.size);
    label.append(input, name, size);
    downloadFileList.append(label);
  }
  syncDownloadControls();
}

function syncDownloadControls() {
  const inputs = Array.from(downloadFileList.querySelectorAll('input[type="checkbox"]'));
  const selected = inputs.filter((input) => input.checked);
  downloadSelected.disabled = selected.length === 0;
  downloadSelectAll.textContent = selected.length === inputs.length ? 'Clear all' : 'Select all';
  if (selected.length > 0) {
    downloadSelected.textContent = selected.length === 1 ? 'Download file' : `Download ${selected.length} files`;
  } else {
    downloadSelected.textContent = 'Download selected';
  }
}

async function selectFile(file) {
  if (!file) return;
  activeFileId = file.id;
  for (const row of stashFileList.querySelectorAll('.stash-file-row')) {
    row.classList.toggle('active', row.dataset.fileId === activeFileId);
    row.setAttribute('aria-current', row.dataset.fileId === activeFileId ? 'true' : 'false');
  }
  mediaFrame.replaceChildren(await createPreview(file, meta.allowDownload !== false));
}

async function createPreview(file, allowDownload) {
  const mime = String(file.mime || '').toLowerCase();
  const src = file.contentUrl;
  let element;

  if (mime.startsWith('image/')) {
    element = document.createElement('img');
    element.alt = file.originalName;
  } else if (mime.startsWith('video/')) {
    element = document.createElement('video');
    element.controls = true;
    element.preload = 'metadata';
    element.playsInline = true;
  } else if (mime.startsWith('audio/')) {
    element = document.createElement('audio');
    element.controls = true;
    element.preload = 'metadata';
  } else if (isBrowserPreviewableDocument(mime)) {
    element = document.createElement('iframe');
    element.title = `${file.originalName} preview`;
    element.style.width = '100%';
    element.style.height = 'min(70vh, 760px)';
    element.style.minHeight = '360px';
    element.style.border = '0';
    element.style.background = '#fff';
    element.loading = 'eager';
    element.src = mime.startsWith('application/pdf') && !allowDownload
      ? `${src}#toolbar=0&navpanes=0`
      : src;
  } else {
    return createDocumentPlaceholder(allowDownload);
  }

  if (!element.src) element.src = src;
  element.dataset.testid = 'media-preview';
  if (!allowDownload) applyPreviewOnlyProtections(element);
  return element;
}

function isBrowserPreviewableDocument(mime) {
  return mime.startsWith('application/pdf')
    || mime.startsWith('text/')
    || mime.startsWith('application/json');
}

function createDocumentPlaceholder(allowDownload) {
  const wrapper = document.createElement('div');
  wrapper.className = 'center-state';
  wrapper.style.minHeight = '260px';
  wrapper.dataset.testid = 'document-placeholder';

  const mark = document.createElement('div');
  mark.className = 'big-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '≡';

  const heading = document.createElement('h2');
  heading.textContent = 'Document ready';

  const copy = document.createElement('p');
  copy.textContent = allowDownload
    ? 'This file type does not have a browser-native preview. Use Download to open it in a compatible app.'
    : 'This file type does not have a browser-native preview, and downloads are disabled for this stash.';

  wrapper.append(mark, heading, copy);
  return wrapper;
}

function applyPreviewOnlyProtections(element) {
  element.draggable = false;
  element.addEventListener('dragstart', preventDefault);
  element.addEventListener('contextmenu', preventDefault);

  if (element instanceof HTMLMediaElement) {
    element.setAttribute('controlslist', 'nodownload noremoteplayback');
    if ('disableRemotePlayback' in element) element.disableRemotePlayback = true;
    if ('disablePictureInPicture' in element) element.disablePictureInPicture = true;
  }
}

function triggerFileDownload(file) {
  const anchor = document.createElement('a');
  anchor.href = `${file.contentUrl}?download=1`;
  anchor.download = file.originalName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function getZipResponse(fileIds) {
  const cacheKey = await buildZipCacheKey(fileIds);
  if (cacheKey) {
    const cached = await readZipCache(cacheKey);
    if (cached) return cached;
  }

  const response = await fetch(`../api/shares/${encodeURIComponent(id)}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds })
  });

  if (response.ok && cacheKey) {
    const expiresAt = Math.min(Date.now() + ZIP_CACHE_TTL_MS, Date.parse(meta.expiresAt));
    if (expiresAt > Date.now()) void writeZipCache(cacheKey, response.clone(), expiresAt);
  }
  return response;
}

async function buildZipCacheKey(fileIds) {
  if (!canUseZipCache() || !crypto.subtle) return null;
  const canonical = `${id}:${[...fileIds].sort().join(',')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request(new URL(`../__mustash_zip_cache__/${encodeURIComponent(id)}/${hex}`, location.href), { method: 'GET' });
}

function canUseZipCache() {
  return mobileZipCacheQuery.matches && window.isSecureContext && 'caches' in window;
}

async function readZipCache(cacheKey) {
  try {
    const cache = await caches.open(ZIP_CACHE_NAME);
    const response = await cache.match(cacheKey);
    if (!response) return null;
    const expiresAt = Number(response.headers.get('X-MuStash-Cache-Expires'));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || Date.parse(meta.expiresAt) <= Date.now()) {
      await cache.delete(cacheKey);
      return null;
    }
    return response;
  } catch {
    return null;
  }
}

async function writeZipCache(cacheKey, response, expiresAt) {
  try {
    const headers = new Headers(response.headers);
    headers.set('X-MuStash-Cache-Expires', String(expiresAt));
    const cacheable = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    const cache = await caches.open(ZIP_CACHE_NAME);
    await cache.put(cacheKey, cacheable);
  } catch {
    // CacheStorage is an opportunistic mobile optimization. Quota/eviction
    // failures should never block a requested download.
  }
}

async function purgeExpiredZipCache() {
  if (!canUseZipCache()) return;
  try {
    const cache = await caches.open(ZIP_CACHE_NAME);
    const keys = await cache.keys();
    await Promise.all(keys.map(async (request) => {
      const response = await cache.match(request);
      const expiresAt = Number(response?.headers.get('X-MuStash-Cache-Expires'));
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) await cache.delete(request);
    }));
  } catch {}
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function localZipName(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `mustash-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}.zip`;
}

function preventDefault(event) {
  event.preventDefault();
}

function showExpired() {
  loadingState.hidden = true;
  unlockForm.hidden = true;
  mediaState.hidden = true;
  expiredState.hidden = false;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i += 1) { value /= 1024; unit = units[i]; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatExpiry(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = pad(date.getMinutes());
  const period = hours24 >= 12 ? 'p' : 'a';
  return `${year}-${month}-${day}, ${hours12}:${minutes}${period}`;
}
