const API = '../api/admin';

const loginPanel = document.getElementById('loginPanel');
const loginForm = document.getElementById('loginForm');
const adminPassword = document.getElementById('adminPassword');
const loginStatus = document.getElementById('loginStatus');
const dashboard = document.getElementById('dashboard');
const refreshButton = document.getElementById('refreshButton');
const logoutButton = document.getElementById('logoutButton');
const searchInput = document.getElementById('searchInput');
const stashList = document.getElementById('stashList');
const emptyState = document.getElementById('emptyState');
const adminStatus = document.getElementById('adminStatus');
const stashCount = document.getElementById('stashCount');
const totalSize = document.getElementById('totalSize');
const protectedCount = document.getElementById('protectedCount');
const previewOnlyCount = document.getElementById('previewOnlyCount');
const visibleCount = document.getElementById('visibleCount');

let stashes = [];
let summary = { count: 0, totalSize: 0, protectedCount: 0, previewOnlyCount: 0 };

init();

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoginStatus('');
  try {
    const response = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword.value })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Admin login failed.');
    }
    adminPassword.value = '';
    showDashboard();
    await loadStashes();
  } catch (error) {
    setLoginStatus(error.message || 'Admin login failed.', true);
  }
});

refreshButton.addEventListener('click', loadStashes);
searchInput.addEventListener('input', renderStashes);
logoutButton.addEventListener('click', async () => {
  await fetch(`${API}/logout`, { method: 'POST' }).catch(() => {});
  stashes = [];
  renderStashes();
  showLogin();
});

async function init() {
  try {
    const response = await fetch(`${API}/session`);
    if (response.status === 404) {
      document.body.replaceChildren(disabledMessage());
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (payload.authenticated) {
      showDashboard();
      await loadStashes();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
    setLoginStatus('Could not reach the admin service.', true);
  }
}

function disabledMessage() {
  const main = document.createElement('main');
  main.className = 'admin-shell';
  const card = document.createElement('section');
  card.className = 'card admin-login';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Administration';
  const heading = document.createElement('h1');
  heading.textContent = 'Admin portal unavailable.';
  const copy = document.createElement('p');
  copy.className = 'admin-muted';
  copy.textContent = 'Configure MUSTASH_ADMIN_PASSWORD with at least 12 characters to enable it.';
  card.append(eyebrow, heading, copy);
  main.append(card);
  return main;
}

function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
  adminPassword.focus();
}

function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  setAdminStatus('');
}

async function loadStashes() {
  refreshButton.disabled = true;
  setAdminStatus('Refreshing…');
  try {
    const response = await fetch(`${API}/stashes`);
    if (response.status === 401) {
      showLogin();
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not load stashes.');
    stashes = Array.isArray(payload.stashes) ? payload.stashes : [];
    summary = payload.summary || summary;
    updateSummary();
    renderStashes();
    setAdminStatus('');
  } catch (error) {
    setAdminStatus(error.message || 'Could not load stashes.', true);
  } finally {
    refreshButton.disabled = false;
  }
}

function updateSummary() {
  stashCount.textContent = String(summary.count || 0);
  totalSize.textContent = formatBytes(summary.totalSize || 0);
  protectedCount.textContent = String(summary.protectedCount || 0);
  previewOnlyCount.textContent = String(summary.previewOnlyCount || 0);
}

function renderStashes() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = stashes.filter((stash) => {
    if (!query) return true;
    return stash.name.toLowerCase().includes(query)
      || stash.id.toLowerCase().includes(query)
      || stash.files.some((file) => file.originalName.toLowerCase().includes(query));
  });

  stashList.replaceChildren(...filtered.map(renderStashCard));
  emptyState.hidden = filtered.length !== 0;
  visibleCount.textContent = query ? `${filtered.length} of ${stashes.length}` : `${stashes.length} total`;
}

function renderStashCard(stash) {
  const card = document.createElement('article');
  card.className = 'stash-card';
  card.dataset.stashId = stash.id;
  card.dataset.testid = 'admin-stash-card';

  const head = document.createElement('div');
  head.className = 'stash-head';
  const headCopy = document.createElement('div');
  headCopy.className = 'stash-head-copy';
  const title = document.createElement('h2');
  title.className = 'stash-title';
  title.textContent = stash.name;
  const idLine = document.createElement('p');
  idLine.className = 'stash-id';
  idLine.textContent = stash.id;
  headCopy.append(title, idLine);

  const pills = document.createElement('div');
  pills.className = 'admin-pill-row';
  if (stash.protected) pills.append(makePill('Protected', 'protected'));
  pills.append(makePill(stash.allowDownload ? 'Downloads on' : 'Preview only', stash.allowDownload ? '' : 'preview'));
  head.append(headCopy, pills);

  const meta = document.createElement('div');
  meta.className = 'stash-meta';
  meta.append(
    metaSpan(`${stash.fileCount} ${stash.fileCount === 1 ? 'file' : 'files'}`),
    metaSpan(formatBytes(stash.totalSize)),
    metaSpan(`Created ${formatDate(stash.createdAt)}`),
    metaSpan(`Expiry ${formatDate(stash.expiresAt)}`)
  );

  const edit = document.createElement('div');
  edit.className = 'stash-edit';
  const nameField = makeField('Name');
  nameField.input.value = stash.name;
  nameField.input.maxLength = 80;
  nameField.input.dataset.testid = 'admin-stash-name';
  const expiryField = makeField('Expiry');
  expiryField.input.type = 'datetime-local';
  expiryField.input.value = toLocalInput(stash.expiresAt);
  expiryField.input.dataset.testid = 'admin-stash-expiry';
  const downloadLabel = document.createElement('label');
  downloadLabel.className = 'admin-check';
  const downloadCheck = document.createElement('input');
  downloadCheck.type = 'checkbox';
  downloadCheck.checked = stash.allowDownload;
  downloadCheck.dataset.testid = 'admin-allow-download';
  const downloadText = document.createElement('span');
  downloadText.textContent = 'Allow downloads';
  downloadLabel.append(downloadCheck, downloadText);
  edit.append(nameField.label, expiryField.label, downloadLabel);

  const actions = document.createElement('div');
  actions.className = 'stash-actions';
  const save = button('Save', 'primary-button');
  save.dataset.testid = 'admin-save-stash';
  save.addEventListener('click', () => saveStash(stash, nameField.input, expiryField.input, downloadCheck, save));
  const open = document.createElement('a');
  open.className = 'secondary-button link-button';
  open.href = stash.previewUrl;
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'Open preview';
  const remove = button('Delete', 'secondary-button danger-button');
  remove.dataset.testid = 'admin-delete-stash';
  remove.addEventListener('click', () => deleteStash(stash));
  actions.append(save, open, remove);

  const details = document.createElement('details');
  details.className = 'file-details';
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = 'Files';
  const fileList = document.createElement('div');
  fileList.className = 'file-list';
  for (const file of stash.files) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const filename = document.createElement('strong');
    filename.textContent = file.originalName;
    const fileMeta = document.createElement('span');
    fileMeta.textContent = `${formatBytes(file.size)} · ${file.mime}`;
    row.append(filename, fileMeta);
    fileList.append(row);
  }
  details.append(detailsSummary, fileList);

  card.append(head, meta, edit, actions, details);
  return card;
}

async function saveStash(stash, nameInput, expiryInput, downloadCheck, saveButton) {
  saveButton.disabled = true;
  setAdminStatus('Saving…');
  try {
    const expiry = new Date(expiryInput.value);
    if (!expiryInput.value || Number.isNaN(expiry.getTime())) throw new Error('Choose a valid future expiry.');
    const response = await fetch(`${API}/stashes/${encodeURIComponent(stash.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameInput.value,
        expiresAt: expiry.toISOString(),
        allowDownload: downloadCheck.checked
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not update stash.');
    const index = stashes.findIndex((candidate) => candidate.id === stash.id);
    if (index !== -1) stashes[index] = payload;
    await loadStashes();
    setAdminStatus('Saved.');
  } catch (error) {
    setAdminStatus(error.message || 'Could not update stash.', true);
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteStash(stash) {
  if (!window.confirm(`Delete “${stash.name}” and all of its files now?`)) return;
  setAdminStatus('Deleting…');
  try {
    const response = await fetch(`${API}/stashes/${encodeURIComponent(stash.id)}`, { method: 'DELETE' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Could not delete stash.');
    }
    await loadStashes();
    setAdminStatus('Deleted.');
  } catch (error) {
    setAdminStatus(error.message || 'Could not delete stash.', true);
  }
}

function makePill(text, extraClass) {
  const pill = document.createElement('span');
  pill.className = `admin-pill${extraClass ? ` ${extraClass}` : ''}`;
  pill.textContent = text;
  return pill;
}

function metaSpan(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function makeField(text) {
  const label = document.createElement('label');
  label.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = text;
  const input = document.createElement('input');
  input.type = 'text';
  label.append(caption, input);
  return { label, input };
}

function button(text, className) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  return element;
}

function setLoginStatus(message, error = false) {
  loginStatus.textContent = message;
  loginStatus.classList.toggle('error', error);
}

function setAdminStatus(message, error = false) {
  adminStatus.textContent = message;
  adminStatus.classList.toggle('error', error);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function toLocalInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
