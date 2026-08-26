import { initTheme } from './theme.js';
import { deriveAccessKey, randomSalt } from './crypto.js';

initTheme();

const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const dropHint = document.getElementById('dropHint');
const localPreview = document.getElementById('localPreview');
const ttlInput = document.getElementById('ttlHours');
const passwordInput = document.getElementById('password');
const allowDownloadInput = document.getElementById('allowDownload');
const status = document.getElementById('status');
const stashButton = document.getElementById('stashButton');
const resultCard = document.getElementById('resultCard');
const shareUrlInput = document.getElementById('shareUrl');
const expiryText = document.getElementById('expiryText');
const shareButton = document.getElementById('shareButton');
const copyButton = document.getElementById('copyButton');
const openButton = document.getElementById('openButton');
const limitText = document.getElementById('limitText');

let previewUrl = null;
let config = { maxFileMb: 100, maxTtlHours: 168, defaultTtlHours: 24 };
const desktopDragQuery = matchMedia('(min-width: 621px) and (hover: hover) and (pointer: fine)');

loadConfig();
fileInput.addEventListener('change', () => renderLocalPreview(fileInput.files[0]));
configureDragAndDrop();
desktopDragQuery.addEventListener?.('change', configureDragAndDrop);
document.querySelectorAll('.number-steppers .stepper').forEach((button) => {
  button.addEventListener('click', () => stepTtl(Number(button.dataset.dir)));
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('');
  resultCard.hidden = true;
  const file = fileInput.files[0];
  if (!file) return setStatus('Choose a media file first.', true);
  if (file.size > config.maxFileMb * 1024 * 1024) return setStatus(`That file is over the ${config.maxFileMb} MB limit.`, true);

  const ttlHours = Number(ttlInput.value);
  if (!Number.isFinite(ttlHours) || ttlHours < 0.25 || ttlHours > config.maxTtlHours) {
    return setStatus(`Choose an expiration between 0.25 and ${config.maxTtlHours} hours.`, true);
  }

  const password = passwordInput.value;
  if (password && password.length < 8) return setStatus('Use at least 8 characters for the password.', true);

  stashButton.disabled = true;
  stashButton.textContent = 'Stashing…';
  try {
    let accessKey = '';
    let linkSalt = '';
    if (password) {
      linkSalt = randomSalt();
      accessKey = await deriveAccessKey(password, linkSalt);
    }

    const data = new FormData();
    data.append('file', file);
    data.append('ttlHours', String(ttlHours));
    data.append('allowDownload', allowDownloadInput.checked ? '1' : '0');
    if (accessKey) {
      data.append('accessKey', accessKey);
      data.append('linkSalt', linkSalt);
    }

    const response = await fetch('api/shares', { method: 'POST', body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Upload failed.');

    const shareUrl = new URL(`s/${payload.id}`, location.href);
    if (accessKey) shareUrl.hash = `k=${encodeURIComponent(accessKey)}`;
    shareUrlInput.value = shareUrl.href;
    openButton.href = shareUrl.href;
    expiryText.textContent = `Available until ${new Date(payload.expiresAt).toLocaleString()}.`;
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setStatus('');
  } catch (error) {
    setStatus(error.message || 'Upload failed.', true);
  } finally {
    stashButton.disabled = false;
    stashButton.textContent = 'Stash it';
  }
});

copyButton.addEventListener('click', async () => {
  await copyText(shareUrlInput.value);
  const old = copyButton.textContent;
  copyButton.textContent = 'Copied';
  setTimeout(() => { copyButton.textContent = old; }, 1200);
});

shareButton.addEventListener('click', async () => {
  const url = shareUrlInput.value;
  if (navigator.share) {
    try { await navigator.share({ title: 'MuStash share', url }); } catch (error) { if (error.name !== 'AbortError') setStatus('Could not open the share sheet.', true); }
  } else {
    await copyText(url);
    setStatus('Share URL copied to your clipboard.');
  }
});

function configureDragAndDrop() {
  const enabled = desktopDragQuery.matches;
  dropzone.dataset.dragEnabled = String(enabled);
  dropHint.hidden = !enabled;

  for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    dropzone.removeEventListener(eventName, handleDragEvent);
  }
  dropzone.removeEventListener('drop', handleDrop);

  if (!enabled) {
    dropzone.classList.remove('dragging');
    return;
  }

  for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    dropzone.addEventListener(eventName, handleDragEvent);
  }
  dropzone.addEventListener('drop', handleDrop);
}

function handleDragEvent(event) {
  event.preventDefault();
  if (event.type === 'dragenter' || event.type === 'dragover') dropzone.classList.add('dragging');
  else dropzone.classList.remove('dragging');
}

function handleDrop(event) {
  const [file] = event.dataTransfer?.files || [];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  renderLocalPreview(file);
}

async function loadConfig() {
  try {
    const response = await fetch('api/config');
    if (!response.ok) return;
    config = await response.json();
    ttlInput.max = String(config.maxTtlHours);
    ttlInput.value = String(config.defaultTtlHours);
    limitText.textContent = `Images, audio, or video · up to ${config.maxFileMb} MB`;
  } catch {}
}

function stepTtl(direction) {
  const step = Number(ttlInput.step) || 0.25;
  const min = Number(ttlInput.min) || 0.25;
  const max = Number(ttlInput.max) || config.maxTtlHours;
  const current = Number(ttlInput.value);
  const base = Number.isFinite(current) ? current : config.defaultTtlHours;
  const next = Math.min(max, Math.max(min, Math.round((base + direction * step) * 100) / 100));
  ttlInput.value = String(next);
  ttlInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderLocalPreview(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  localPreview.replaceChildren();
  if (!file) return (localPreview.hidden = true);
  previewUrl = URL.createObjectURL(file);
  const media = mediaElement(file.type, previewUrl);
  const details = document.createElement('div');
  details.className = 'preview-meta';
  const name = document.createElement('strong');
  name.textContent = file.name;
  const size = document.createElement('span');
  size.textContent = formatBytes(file.size);
  details.append(name, size);
  if (media) localPreview.append(media);
  localPreview.append(details);
  localPreview.hidden = false;
}

function mediaElement(type, src) {
  let element;
  if (type.startsWith('image/')) {
    element = document.createElement('img');
    element.alt = 'Selected media preview';
  } else if (type.startsWith('video/')) {
    element = document.createElement('video');
    element.controls = true;
    element.preload = 'metadata';
  } else if (type.startsWith('audio/')) {
    element = document.createElement('audio');
    element.controls = true;
  } else return null;
  element.src = src;
  return element;
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  shareUrlInput.select();
  document.execCommand('copy');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i++) { value /= 1024; unit = units[i]; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
