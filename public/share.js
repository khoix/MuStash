import { initTheme } from './theme.js';
import { deriveAccessKey } from './crypto.js';

initTheme();

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
const protectedPill = document.getElementById('protectedPill');
const previewOnlyPill = document.getElementById('previewOnlyPill');
const shareButton = document.getElementById('shareButton');
const downloadButton = document.getElementById('downloadButton');

let meta;
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
    try { await navigator.share({ title: meta?.originalName || 'MuStash share', url }); } catch (error) { if (error.name !== 'AbortError') console.warn(error); }
  } else if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    shareButton.textContent = 'Copied';
    setTimeout(() => { shareButton.textContent = 'Share'; }, 1200);
  }
});

async function init() {
  try {
    const response = await fetch(`../api/shares/${encodeURIComponent(id)}`);
    if (!response.ok) return showExpired();
    meta = await response.json();
    document.title = `${meta.originalName} · MuStash`;

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
  const allowDownload = meta.allowDownload !== false;
  loadingState.hidden = true;
  unlockForm.hidden = true;
  mediaState.hidden = false;
  fileName.textContent = meta.originalName;
  fileSize.textContent = formatBytes(meta.size);
  expiryLine.textContent = `Expiry: ${formatExpiry(meta.expiresAt)}`;
  previewOnlyPill.hidden = allowDownload;
  downloadButton.hidden = !allowDownload;
  if (allowDownload) downloadButton.href = `${meta.contentUrl}?download=1`;
  else downloadButton.removeAttribute('href');
  mediaFrame.classList.toggle('preview-only', !allowDownload);
  mediaFrame.replaceChildren(await createPreview(meta.mime, meta.contentUrl, allowDownload));
}

async function createPreview(type, src, allowDownload) {
  const mime = String(type || '').toLowerCase();
  let element;

  if (mime.startsWith('image/')) {
    element = document.createElement('img');
    element.alt = meta.originalName;
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
    element.title = `${meta.originalName} preview`;
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
  for (let i = 1; value >= 1024 && i < units.length; i++) { value /= 1024; unit = units[i]; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatExpiry(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours24 = date.getHours();
  const hours12 = pad(hours24 % 12 || 12);
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const period = hours24 >= 12 ? 'p' : 'a';
  return `${year}-${month}-${day}, ${hours12}:${minutes}:${seconds} ${period}`;
}
