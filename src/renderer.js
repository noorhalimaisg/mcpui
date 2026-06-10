'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let servers = [];          // working copy (array of models) shown in the UI
let originalSnapshot = ''; // JSON string of last-loaded/saved state, for dirty check
let preservedKeys = [];    // other top-level keys we will leave untouched
let editIndex = -1;        // -1 = adding new, otherwise editing servers[editIndex]

// ---------------------------------------------------------------------------
// Element shortcuts
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  path: $('config-path'),
  pathStatus: $('path-status'),
  resetPath: $('btn-reset-path'),
  list: $('list'),
  empty: $('empty'),
  count: $('servers-count'),
  preservedNote: $('preserved-note'),
  dirty: $('dirty-indicator'),
  save: $('btn-save'),
  discard: $('btn-discard'),
  modal: $('modal'),
  modalTitle: $('modal-title'),
  modalDelete: $('modal-delete'),
  fName: $('f-name'),
  fCommand: $('f-command'),
  fArgs: $('f-args'),
  fEnv: $('f-env'),
  fExtraNote: $('f-extra-note'),
  modalError: $('modal-error'),
  toast: $('toast'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function snapshot() { return JSON.stringify(servers); }
function isDirty() { return snapshot() !== originalSnapshot; }

function updateDirtyUI() {
  const dirty = isDirty();
  el.save.disabled = !dirty;
  el.discard.disabled = !dirty;
  el.dirty.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
  el.dirty.classList.toggle('dirty', dirty);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(message, kind) {
  el.toast.textContent = message;
  el.toast.className = 'toast ' + (kind || '');
  setTimeout(() => el.toast.classList.add('hidden'), 3200);
}

function argsToText(args) { return (args || []).join('\n'); }
function textToArgs(text) {
  return text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0);
}
function envToText(env) { return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n'); }
function textToEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i === -1) { out[t] = ''; continue; }
    out[t.slice(0, i).trim()] = t.slice(i + 1);
  }
  return out;
}

// Pick a friendly "endpoint" string for the URL pill: the first arg that looks
// like a URL (scheme stripped for readability); otherwise the command + args.
function displayEndpoint(s) {
  const urlArg = (s.args || []).find((a) => /^https?:\/\//i.test(a));
  if (urlArg) return urlArg.replace(/^https?:\/\//i, '');
  if (s.command) return [s.command, ...(s.args || [])].join(' ');
  return '(no command)';
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function switchTab(name) {
  document.body.setAttribute('data-tab', name);
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  document.querySelectorAll('.panel').forEach((p) =>
    p.classList.toggle('hidden', p.id !== `panel-${name}`)
  );
}

// ---------------------------------------------------------------------------
// Rendering server rows
// ---------------------------------------------------------------------------
function render() {
  el.list.innerHTML = '';

  if (servers.length === 0) {
    el.empty.classList.remove('hidden');
    el.count.classList.add('hidden');
  } else {
    el.empty.classList.add('hidden');
    el.count.classList.remove('hidden');
    el.count.textContent = `${servers.length} server${servers.length === 1 ? '' : 's'}`;
  }

  servers.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'server-row';
    row.dataset.edit = String(i);
    row.title = 'Click to edit';

    const argCount = (s.args || []).length;
    row.innerHTML = `
      <span class="dot"></span>
      <span class="server-name">${escapeHtml(s.name)}</span>
      <span class="server-url-pill">${escapeHtml(displayEndpoint(s))}</span>
      <span class="args-tag">${argCount} arg${argCount === 1 ? '' : 's'}</span>
    `;
    el.list.appendChild(row);
  });

  el.list.querySelectorAll('[data-edit]').forEach((r) =>
    r.addEventListener('click', () => openModal(parseInt(r.dataset.edit, 10)))
  );

  updateDirtyUI();
}

// ---------------------------------------------------------------------------
// Modal (add / edit / delete)
// ---------------------------------------------------------------------------
function openModal(index) {
  editIndex = index;
  el.modalError.classList.add('hidden');

  if (index === -1) {
    el.modalTitle.textContent = 'Add server';
    el.fName.value = '';
    el.fCommand.value = '';
    el.fArgs.value = '';
    el.fEnv.value = '';
    el.fExtraNote.classList.add('hidden');
    el.modalDelete.classList.add('hidden');
  } else {
    const s = servers[index];
    el.modalTitle.textContent = 'Edit server';
    el.fName.value = s.name;
    el.fCommand.value = s.command || '';
    el.fArgs.value = argsToText(s.args);
    el.fEnv.value = envToText(s.env);
    el.modalDelete.classList.remove('hidden');
    const extraKeys = s.extra ? Object.keys(s.extra) : [];
    if (extraKeys.length) {
      el.fExtraNote.textContent =
        `This server has ${extraKeys.length} extra field(s) (${extraKeys.join(', ')}) ` +
        `that this editor does not change. They will be preserved on save.`;
      el.fExtraNote.classList.remove('hidden');
    } else {
      el.fExtraNote.classList.add('hidden');
    }
  }

  el.modal.classList.remove('hidden');
  el.fName.focus();
}

function closeModal() {
  el.modal.classList.add('hidden');
  editIndex = -1;
}

function saveModal() {
  const name = el.fName.value.trim();
  const command = el.fCommand.value.trim();
  const args = textToArgs(el.fArgs.value);
  const env = textToEnv(el.fEnv.value);

  if (!name) return showModalError('Server name is required.');
  const clash = servers.some((s, i) => i !== editIndex && s.name === name);
  if (clash) return showModalError(`A server named "${name}" already exists.`);

  if (editIndex === -1) {
    servers.push({ name, command, args, env, extra: {} });
  } else {
    const existing = servers[editIndex];
    servers[editIndex] = { name, command, args, env, extra: existing.extra || {} };
  }
  closeModal();
  render();
}

function showModalError(msg) {
  el.modalError.textContent = msg;
  el.modalError.classList.remove('hidden');
}

function deleteFromModal() {
  if (editIndex < 0) return;
  const s = servers[editIndex];
  if (!confirm(`Delete server "${s.name}"?\n\nThis only takes effect after you click "Save to Claude Desktop".`)) {
    return;
  }
  servers.splice(editIndex, 1);
  closeModal();
  render();
}

// ---------------------------------------------------------------------------
// Load / save against disk
// ---------------------------------------------------------------------------
async function refreshPathBar() {
  const info = await window.api.locate();
  el.path.textContent = info.path;
  el.path.title = info.path;
  if (info.exists) {
    el.pathStatus.textContent = 'found';
    el.pathStatus.className = 'badge exists';
  } else {
    el.pathStatus.textContent = 'not found';
    el.pathStatus.className = 'badge missing';
  }
  el.resetPath.classList.toggle('hidden', info.isDefault);
}

async function loadFromDisk() {
  await refreshPathBar();
  const res = await window.api.read();
  if (!res.ok) {
    showToast(res.error || 'Failed to read config.', 'err');
    servers = [];
    preservedKeys = [];
    originalSnapshot = snapshot();
    render();
    return;
  }
  servers = res.servers;
  preservedKeys = res.preservedKeys || [];
  originalSnapshot = snapshot();

  if (preservedKeys.length) {
    el.preservedNote.innerHTML =
      `<svg viewBox="0 0 24 24" class="ic"><path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z"/></svg>` +
      `<span>${preservedKeys.map((k) => `<strong>${escapeHtml(k)}</strong>`).join(' and ')} ` +
      `${preservedKeys.length === 1 ? 'is' : 'are'} left untouched — this tool only manages <code>mcpServers</code>.</span>`;
    el.preservedNote.classList.remove('hidden');
  } else {
    el.preservedNote.classList.add('hidden');
  }
  render();
}

async function saveToDisk() {
  const res = await window.api.save(servers);
  if (!res.ok) { showToast(res.error || 'Save failed.', 'err'); return; }
  originalSnapshot = snapshot();
  await refreshPathBar();
  updateDirtyUI();
  const backupMsg = res.backupPath ? ' (backup created)' : '';
  showToast(`Saved ${res.count} server(s)${backupMsg}. Restart Claude Desktop to apply.`, 'ok');
}

async function discardChanges() {
  if (isDirty() && !confirm('Discard all unsaved changes and reload from disk?')) return;
  await loadFromDisk();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => switchTab(t.dataset.tab))
);

$('btn-add').addEventListener('click', () => { switchTab('servers'); openModal(-1); });
$('btn-add-empty').addEventListener('click', () => openModal(-1));
$('btn-reload').addEventListener('click', discardChanges);
$('btn-save').addEventListener('click', saveToDisk);
$('btn-discard').addEventListener('click', discardChanges);

$('modal-cancel').addEventListener('click', closeModal);
$('modal-ok').addEventListener('click', saveModal);
$('modal-delete').addEventListener('click', deleteFromModal);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.modal.classList.contains('hidden')) closeModal();
});

$('btn-open-folder').addEventListener('click', async () => {
  const res = await window.api.openFolder();
  if (!res.ok) showToast(res.error || 'Could not open folder.', 'err');
});
$('btn-choose').addEventListener('click', async () => {
  const res = await window.api.chooseFile();
  if (res.ok) { showToast('Config path updated.', 'ok'); await loadFromDisk(); }
});
$('btn-reset-path').addEventListener('click', async () => {
  await window.api.resetPath();
  showToast('Reverted to default config path.', 'ok');
  await loadFromDisk();
});

// FAQ accordion
document.querySelectorAll('.acc-head').forEach((h) =>
  h.addEventListener('click', () => h.parentElement.classList.toggle('open'))
);

// Support external links
document.querySelectorAll('.support-link').forEach((a) =>
  a.addEventListener('click', () => window.api.openExternal(a.dataset.href))
);

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

loadFromDisk();
