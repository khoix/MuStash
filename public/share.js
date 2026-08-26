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
const metaLine = document.getElementById('metaLine');
const protectedPill = document.getElementById('protectedPill');
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
  loadingState.hidden = true;
  unlockForm.hidden = true;
  mediaState.hidden = false;
  fileName.textContent = meta.originalName;
  metaLine.textContent = `${formatBytes(meta.size)} · expires ${new Date(meta.expiresAt).toLocaleString()}`;
  downloadButton.href = `${meta.contentUrl}?download=1`;
  mediaFrame.replaceChildren(createMedia(meta.mime, meta.contentUrl));
}

function createMedia(type, src) {
  let element;
  if (type.startsWith('image/')) {
    element = document.createElement('img');
    element.alt = meta.originalName;
  } else if (type.startsWith('video/')) {
    element = document.createElement('video');
    element.controls = true;
    element.preload = 'metadata';
    element.playsInline = true;
  } else {
    element = document.createElement('audio');
    element.controls = true;
    element.preload = 'metadata';
  }
  element.src = src;
  element.dataset.testid = 'media-preview';
  return element;
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
