import { initTheme } from './theme.js';
import { deriveAccessKey, randomSalt } from './crypto.js';

initTheme();

const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const stashNameInput = document.getElementById('stashName');
const stashNameField = document.getElementById('stashNameField');
const dropzone = document.getElementById('dropzone');
const dropHint = document.getElementById('dropHint');
const localPreview = document.getElementById('localPreview');
const ttlInput = document.getElementById('ttlHours');
const passwordInput = document.getElementById('password');
const allowDownloadInput = document.getElementById('allowDownload');
const status = document.getElementById('status');
const stashButton = document.getElementById('stashButton');
const resultOverlay = document.getElementById('resultOverlay');
const resultClose = document.getElementById('resultClose');
const resultBackdrop = document.getElementById('resultBackdrop');
const shareUrlInput = document.getElementById('stashLink');
const expiryText = document.getElementById('expiryText');
const shareButton = document.getElementById('sendButton');
const copyButton = document.getElementById('copyButton');
const shareUrlHint = document.getElementById('stashLinkHint');
let copyButtonTimer = null;
let copyHintTimer = null;
const openButton = document.getElementById('openButton');
const limitText = document.getElementById('limitText');
let resultReturnFocus = null;

let selectedFiles = [];
let previewUrls = [];
let config = {
  maxFileMb: 100,
  maxStashMb: 100,
  maxFiles: 25,
  maxTtlHours: 168,
  defaultTtlHours: 24
};
const desktopDragQuery = matchMedia('(min-width: 621px) and (hover: hover) and (pointer: fine)');

loadConfig();
fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files || []));
  // The FileList cannot be safely rewritten after per-file removals. The app's
  // selectedFiles state is authoritative, so clear the native input after capture.
  fileInput.value = '';
});
configureDragAndDrop();
desktopDragQuery.addEventListener?.('change', configureDragAndDrop);
document.querySelectorAll('.number-steppers .stepper').forEach((button) => {
  button.addEventListener('click', () => stepTtl(Number(button.dataset.dir)));
});
ttlInput.addEventListener('focus', () => ttlInput.select());
ttlInput.addEventListener('mouseup', (event) => event.preventDefault());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('');
  closeResultOverlay();
  if (selectedFiles.length === 0) return setStatus('Choose a file first.', true);

  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const maxStashBytes = config.maxStashMb * 1024 * 1024;
  if (totalSize > maxStashBytes) {
    return setStatus(`This stash is over the ${config.maxStashMb} MB total limit.`, true);
  }
  if (selectedFiles.length > config.maxFiles) {
    return setStatus(`Choose no more than ${config.maxFiles} files.`, true);
  }
  const oversized = selectedFiles.find((file) => file.size > config.maxFileMb * 1024 * 1024);
  if (oversized) return setStatus(`${oversized.name} is over the ${config.maxFileMb} MB per-file limit.`, true);

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
    for (const file of selectedFiles) data.append('file', file, file.name);
    const stashName = stashNameInput.value.trim();
    if (stashName) data.append('stashName', stashName);
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
    openResultOverlay();
    setStatus('');
  } catch (error) {
    setStatus(error.message || 'Upload failed.', true);
  } finally {
    stashButton.disabled = false;
    stashButton.textContent = 'Stash it';
  }
});

resultClose.addEventListener('click', closeResultOverlay);
resultBackdrop.addEventListener('click', closeResultOverlay);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !resultOverlay.hidden) {
    event.preventDefault();
    closeResultOverlay();
  }
});

copyButton.addEventListener('click', copyShareUrl);
shareUrlInput.addEventListener('click', copyShareUrl);
shareUrlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    copyShareUrl();
  }
});

shareButton.addEventListener('click', async () => {
  const url = shareUrlInput.value;
  const title = stashNameInput.value.trim() || 'MuStash share';
  if (navigator.share) {
    try { await navigator.share({ title, url }); } catch (error) { if (error.name !== 'AbortError') showCopyFeedback('Could not open the share sheet.', true); }
  } else {
    await copyShareUrl();
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
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length === 0) return;
  addFiles(files);
}

function addFiles(files) {
  if (files.length === 0) return;
  const known = new Set(selectedFiles.map(fileIdentity));
  const additions = files.filter((file) => !known.has(fileIdentity(file)));
  if (selectedFiles.length + additions.length > config.maxFiles) {
    return setStatus(`Choose no more than ${config.maxFiles} files.`, true);
  }
  selectedFiles = [...selectedFiles, ...additions];
  renderLocalPreview();
  updateSelectionStatus();
}

function fileIdentity(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function removeSelectedFile(index) {
  selectedFiles.splice(index, 1);
  renderLocalPreview();
  updateSelectionStatus();
}

function clearPreviewUrls() {
  for (const url of previewUrls) URL.revokeObjectURL(url);
  previewUrls = [];
}

function renderLocalPreview() {
  clearPreviewUrls();
  localPreview.replaceChildren();
  if (selectedFiles.length === 0) {
    localPreview.hidden = true;
    return;
  }

  const list = document.createElement('div');
  list.className = 'selected-file-list';
  selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'selected-file-item';
    item.dataset.testid = 'selected-file-item';

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = 'Selected media preview';
      image.className = 'selected-file-thumb';
      item.append(image);
    } else {
      const mark = document.createElement('div');
      mark.className = 'selected-file-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = file.type.startsWith('video/') ? '▶' : file.type.startsWith('audio/') ? '♪' : '≡';
      item.append(mark);
    }

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'preview-remove';
    removeButton.dataset.testid = 'remove-selected-file';
    removeButton.setAttribute('aria-label', `Remove ${file.name}`);
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => removeSelectedFile(index));

    const details = document.createElement('div');
    details.className = 'preview-meta';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const size = document.createElement('span');
    size.textContent = formatBytes(file.size);
    details.append(name, size);

    item.append(removeButton, details);
    list.append(item);
  });

  const summary = document.createElement('div');
  summary.className = 'selection-summary';
  summary.dataset.testid = 'selection-summary';
  summary.textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'} · ${formatBytes(selectedFiles.reduce((sum, file) => sum + file.size, 0))}`;

  localPreview.append(list, summary);
  localPreview.hidden = false;
}

function updateSelectionStatus() {
  const showStashName = selectedFiles.length > 1;
  stashNameField.hidden = !showStashName;
  if (!showStashName) stashNameInput.value = '';

  if (selectedFiles.length === 0) {
    setStatus('');
    stashButton.disabled = false;
    return;
  }
  const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const tooLarge = total > config.maxStashMb * 1024 * 1024;
  const oversized = selectedFiles.find((file) => file.size > config.maxFileMb * 1024 * 1024);
  if (tooLarge) setStatus(`This stash is over the ${config.maxStashMb} MB total limit.`, true);
  else if (oversized) setStatus(`${oversized.name} is over the ${config.maxFileMb} MB per-file limit.`, true);
  else setStatus('');
  stashButton.disabled = tooLarge || Boolean(oversized);
}

async function loadConfig() {
  try {
    const response = await fetch('api/config');
    if (!response.ok) return;
    config = { ...config, ...(await response.json()) };
    ttlInput.max = String(config.maxTtlHours);
    ttlInput.value = String(config.defaultTtlHours);
    limitText.textContent = `Up to ${config.maxFiles} files · ${config.maxStashMb} MB total`;
    updateSelectionStatus();
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

function openResultOverlay() {
  resultReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : stashButton;
  resetCopyFeedback();
  copyButton.textContent = 'Copy';
  resultOverlay.hidden = false;
  document.body.classList.add('result-open');
  requestAnimationFrame(() => {
    shareUrlInput.focus();
    shareUrlInput.select();
  });
}

function closeResultOverlay() {
  if (resultOverlay.hidden) return;
  resultOverlay.hidden = true;
  document.body.classList.remove('result-open');
  const restore = resultReturnFocus;
  resultReturnFocus = null;
  if (restore?.isConnected) restore.focus();
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

async function copyShareUrl() {
  shareUrlInput.select();
  shareUrlInput.setSelectionRange(0, shareUrlInput.value.length);
  const copied = await copyText(shareUrlInput.value);
  if (!copied) {
    showCopyFeedback('Copy failed — the link is selected, copy it manually.', true);
    return;
  }
  showCopyFeedback('Link copied to clipboard');
  copyButton.textContent = 'Copied';
  clearTimeout(copyButtonTimer);
  copyButtonTimer = setTimeout(() => { copyButton.textContent = 'Copy'; }, 1600);
}

function showCopyFeedback(message, error = false) {
  shareUrlHint.textContent = message;
  shareUrlHint.classList.toggle('error', error);
  shareUrlHint.classList.toggle('copied', !error);
  clearTimeout(copyHintTimer);
  copyHintTimer = setTimeout(resetCopyFeedback, 2400);
}

function resetCopyFeedback() {
  shareUrlHint.textContent = 'Tap the link to copy it';
  shareUrlHint.classList.remove('error', 'copied');
}

async function copyText(value) {
  // navigator.clipboard is unavailable on plain-HTTP LAN origins; fall back to execCommand.
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
  }
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; value >= 1024 && i < units.length; i += 1) { value /= 1024; unit = units[i]; }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
