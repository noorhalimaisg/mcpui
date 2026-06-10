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
  preservedNote: $('preserved-note'),
  dirty: $('dirty-indicator'),
  save: $('btn-save'),
  discard: $('btn-discard'),
  modal: $('modal'),
  modalTitle: $('modal-title'),
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
function snapshot() {
  return JSON.stringify(servers);
}

function isDirty() {
  return snapshot() !== originalSnapshot;
}

function updateDirtyUI() {
  const dirty = isDirty();
  el.save.disabled = !dirty;
  el.discard.disabled = !dirty;
  el.dirty.textContent = dirty ? '● Unsaved changes' : 'All changes saved';
  el.dirty.classList.toggle('dirty', dirty);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, kind) {
  el.toast.textContent = message;
  el.toast.className = 'toast ' + (kind || '');
  setTimeout(() => el.toast.classList.add('hidden'), 3200);
}

function argsToText(args) {
  return (args || []).join('\n');
}
function textToArgs(text) {
  return text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0);
}
function envToText(env) {
  return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
}
function textToEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) { out[trimmed] = ''; continue; }
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  el.list.innerHTML = '';

  if (servers.length === 0) {
    el.empty.classList.remove('hidden');
  } else {
    el.empty.classList.add('hidden');
  }

  servers.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'server-card';

    const argsPreview = (s.args || []).join(' ');
    const cmdLine = s.command
      ? `<span class="cmd-key">${escapeHtml(s.command)}</span> ${escapeHtml(argsPreview)}`
      : escapeHtml(argsPreview || '(no command)');

    const tags = [];
    if (s.args && s.args.length) tags.push(`${s.args.length} arg${s.args.length > 1 ? 's' : ''}`);
    if (s.env && Object.keys(s.env).length) tags.push(`${Object.keys(s.env).length} env`);
    if (s.extra && Object.keys(s.extra).length) {
      tags.push(`+${Object.keys(s.extra).length} preserved field${Object.keys(s.extra).length > 1 ? 's' : ''}`);
    }

    card.innerHTML = `
      <div class="server-main">
        <div class="server-name">${escapeHtml(s.name)}</div>
        <div class="server-cmd">${cmdLine}</div>
        ${tags.length ? `<div class="server-tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="server-actions">
        <button class="btn tiny ghost" data-edit="${i}">Edit</button>
        <button class="btn tiny danger" data-delete="${i}">Delete</button>
      </div>
    `;
    el.list.appendChild(card);
  });

  // Wire up per-card buttons.
  el.list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openModal(parseInt(b.dataset.edit, 10)))
  );
  el.list.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', () => deleteServer(parseInt(b.dataset.delete, 10)))
  );

  updateDirtyUI();
}

// ---------------------------------------------------------------------------
// Modal (add / edit)
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
  } else {
    const s = servers[index];
    el.modalTitle.textContent = 'Edit server';
    el.fName.value = s.name;
    el.fCommand.value = s.command || '';
    el.fArgs.value = argsToText(s.args);
    el.fEnv.value = envToText(s.env);
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

  if (!name) {
    return showModalError('Server name is required.');
  }
  // Duplicate-name check (ignoring the row we're editing).
  const clash = servers.some((s, i) => i !== editIndex && s.name === name);
  if (clash) {
    return showModalError(`A server named "${name}" already exists.`);
  }

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

function deleteServer(index) {
  const s = servers[index];
  if (!confirm(`Delete server "${s.name}"?\n\nThis only takes effect after you click "Save to Claude Desktop".`)) {
    return;
  }
  servers.splice(index, 1);
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
    el.pathStatus.textContent = 'not found — will be created on save';
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
      `🛡️ ${preservedKeys.length} other top-level setting(s) in your config ` +
      `(<code>${preservedKeys.map(escapeHtml).join('</code>, <code>')}</code>) ` +
      `will be left untouched. This tool only reads and writes <code>mcpServers</code>.`;
    el.preservedNote.classList.remove('hidden');
  } else {
    el.preservedNote.classList.add('hidden');
  }

  render();
}

async function saveToDisk() {
  const res = await window.api.save(servers);
  if (!res.ok) {
    showToast(res.error || 'Save failed.', 'err');
    return;
  }
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
$('btn-add').addEventListener('click', () => openModal(-1));
$('btn-add-empty').addEventListener('click', () => openModal(-1));
$('btn-reload').addEventListener('click', discardChanges);
$('btn-save').addEventListener('click', saveToDisk);
$('btn-discard').addEventListener('click', discardChanges);

$('modal-cancel').addEventListener('click', closeModal);
$('modal-ok').addEventListener('click', saveModal);
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
  if (res.ok) {
    showToast('Config path updated.', 'ok');
    await loadFromDisk();
  }
});

$('btn-reset-path').addEventListener('click', async () => {
  await window.api.resetPath();
  showToast('Reverted to default config path.', 'ok');
  await loadFromDisk();
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// Go.
loadFromDisk();
