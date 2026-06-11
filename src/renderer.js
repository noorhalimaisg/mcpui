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
  backupsList: $('backups-list'),
  backupsEmpty: $('backups-empty'),
  browseModal: $('browse-modal'),
  browseList: $('browse-list'),
  browseSource: $('browse-source'),
  browseForm: $('browse-form'),
  browseFoot: $('browse-foot'),
  browsePickName: $('browse-pick-name'),
  browsePickDesc: $('browse-pick-desc'),
  browseName: $('browse-name'),
  browseToken: $('browse-token'),
  browseTokenField: $('browse-token-field'),
  browseTokenHint: $('browse-token-hint'),
  browseEndpoint: $('browse-endpoint'),
  browseError: $('browse-error'),
};

let pickedEntry = null; // catalog entry currently selected in the browse form

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

// Produce a name not already used by any row (e.g. "foo" -> "foo-copy" -> "foo-copy-2").
function uniqueName(base) {
  const taken = new Set(servers.map((s) => s.name));
  if (!taken.has(base)) return base;
  let n = 2;
  let candidate = `${base}-copy`;
  if (!taken.has(candidate)) return candidate;
  while (taken.has(`${base}-copy-${n}`)) n++;
  return `${base}-copy-${n}`;
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
  if (name === 'backups') loadBackups();
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------
function formatWhen(ms) {
  if (!ms) return 'Unknown time';
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch (_) { return 'Unknown time'; }
}

async function loadBackups() {
  const res = await window.api.listBackups();
  const items = (res && res.items) || [];
  el.backupsList.innerHTML = '';

  if (items.length === 0) {
    el.backupsEmpty.classList.remove('hidden');
    return;
  }
  el.backupsEmpty.classList.add('hidden');

  items.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'backup-row';
    const count = b.serverCount == null ? '—' : b.serverCount;
    const names = (b.serverNames || []).slice(0, 4).join(', ')
      + ((b.serverNames || []).length > 4 ? ', …' : '');
    row.innerHTML = `
      <div class="backup-icon">
        <svg viewBox="0 0 24 24" class="ic"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>
      </div>
      <div class="backup-main">
        <div class="backup-when">${escapeHtml(formatWhen(b.mtimeMs))}${i === 0 ? '<span class="backup-latest">Most recent</span>' : ''}</div>
        <div class="backup-sub">${count} server${count === 1 ? '' : 's'}${names ? ' · <code>' + escapeHtml(names) + '</code>' : ''}</div>
      </div>
      <button class="btn tiny ghost" data-restore="${escapeHtml(b.id)}">Restore</button>
    `;
    el.backupsList.appendChild(row);
  });

  el.backupsList.querySelectorAll('[data-restore]').forEach((btn) =>
    btn.addEventListener('click', () => restoreBackup(btn.dataset.restore))
  );
}

async function restoreBackup(id) {
  if (!confirm('Restore this backup?\n\nYour current servers will be replaced with this version (a backup of the current state is saved first, so this is also undoable). Restart Claude Desktop afterwards to apply.')) {
    return;
  }
  const res = await window.api.restoreBackup(id);
  if (!res.ok) { showToast(res.error || 'Restore failed.', 'err'); return; }
  await loadFromDisk();      // refresh the Servers view from the restored file
  await loadBackups();       // the restore added a new snapshot
  switchTab('servers');
  showToast(`Restored ${res.count} server(s). Restart Claude Desktop to apply.`, 'ok');
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
    row.className = 'server-row' + (s.enabled === false ? ' disabled' : '');

    const argCount = (s.args || []).length;
    row.innerHTML = `
      <label class="toggle" title="${s.enabled === false ? 'Off — will not be saved' : 'On'}">
        <input type="checkbox" data-toggle="${i}" ${s.enabled === false ? '' : 'checked'} />
        <span class="track"></span><span class="thumb"></span>
      </label>
      <div class="server-clickable" data-edit="${i}" title="Click to edit">
        <span class="server-name">${escapeHtml(s.name)}</span>
        <span class="server-url-pill">${escapeHtml(displayEndpoint(s))}</span>
        <span class="args-tag">${argCount} arg${argCount === 1 ? '' : 's'}</span>
      </div>
      <button class="icon-action" data-duplicate="${i}" title="Duplicate">
        <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
      </button>
    `;
    el.list.appendChild(row);
  });

  el.list.querySelectorAll('[data-edit]').forEach((r) =>
    r.addEventListener('click', () => openModal(parseInt(r.dataset.edit, 10)))
  );
  el.list.querySelectorAll('[data-toggle]').forEach((c) =>
    c.addEventListener('change', () => {
      servers[parseInt(c.dataset.toggle, 10)].enabled = c.checked;
      render();
    })
  );
  el.list.querySelectorAll('[data-duplicate]').forEach((b) =>
    b.addEventListener('click', () => duplicateServer(parseInt(b.dataset.duplicate, 10)))
  );

  updateDirtyUI();
}

function duplicateServer(index) {
  const s = servers[index];
  const copy = {
    name: uniqueName(s.name),
    command: s.command,
    args: (s.args || []).slice(),
    env: { ...(s.env || {}) },
    extra: { ...(s.extra || {}) },
    enabled: s.enabled !== false,
  };
  servers.splice(index + 1, 0, copy);
  render();
  showToast(`Duplicated as "${copy.name}" — rename it before saving if needed.`, 'ok');
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
    servers.push({ name, command, args, env, extra: {}, enabled: true });
  } else {
    const existing = servers[editIndex];
    servers[editIndex] = {
      name, command, args, env,
      extra: existing.extra || {},
      enabled: existing.enabled !== false,
    };
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
  // Disallow duplicate names across ALL rows (the main process also enforces this).
  const names = servers.map((s) => (s.name || '').trim());
  if (names.some((n) => !n)) { showToast('Every server must have a name.', 'err'); return; }
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) { showToast(`Duplicate server name: "${dup}". Names must be unique.`, 'err'); return; }

  // Warn before dropping servers that are switched OFF.
  const off = servers.filter((s) => s.enabled === false);
  if (off.length) {
    const list = off.map((s) => `• ${s.name}`).join('\n');
    if (!confirm(`${off.length} server(s) are turned OFF and will be removed from your config when you save:\n\n${list}\n\nContinue? (Backups let you restore them later.)`)) {
      return;
    }
  }

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
// Browse MCP catalog
// ---------------------------------------------------------------------------
function entryUrl(entry) {
  return (entry.args || []).find((a) => /^https?:\/\//i.test(a)) || '';
}

async function openBrowse() {
  pickedEntry = null;
  el.browseForm.classList.add('hidden');
  el.browseList.classList.remove('hidden');
  el.browseFoot.classList.remove('hidden');
  el.browseList.innerHTML = '<div class="browse-loading">Loading catalog…</div>';
  el.browseSource.textContent = '';
  el.browseModal.classList.remove('hidden');

  const res = await window.api.browseCatalog();
  const items = (res && res.items) || [];
  el.browseSource.textContent = res && res.source === 'remote' ? 'online' : 'bundled';

  if (!items.length) {
    el.browseList.innerHTML = '<div class="browse-loading">No catalog entries available.</div>';
    return;
  }
  el.browseList.innerHTML = '';
  items.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'browse-entry';
    div.dataset.pick = String(i);
    div.innerHTML = `
      <div class="browse-entry-main">
        <div class="browse-entry-name">${escapeHtml(entry.name || 'mcp-server')}</div>
        ${entry.description ? `<div class="browse-entry-desc">${escapeHtml(entry.description)}</div>` : ''}
        <div class="browse-entry-url">${escapeHtml(entryUrl(entry).replace(/^https?:\/\//i, ''))}</div>
      </div>
      <span class="add-pill">Add</span>
    `;
    el.browseList.appendChild(div);
  });
  el.browseList.querySelectorAll('[data-pick]').forEach((d) =>
    d.addEventListener('click', () => pickEntry(items[parseInt(d.dataset.pick, 10)]))
  );
}

function pickEntry(entry) {
  pickedEntry = entry;
  el.browseError.classList.add('hidden');
  el.browsePickName.textContent = entry.name || 'mcp-server';
  el.browsePickDesc.textContent = entry.description || '';
  el.browseName.value = uniqueName(entry.name || 'mcp-server');
  el.browseEndpoint.textContent = entryUrl(entry) || '(no URL)';

  const needsToken = entry.requiresToken !== false && (entry.args || []).some((a) => a.includes('{token}'));
  el.browseTokenField.classList.toggle('hidden', !needsToken);
  el.browseToken.value = '';
  el.browseTokenHint.textContent = entry.tokenHint ? `(${entry.tokenHint})` : '';

  el.browseList.classList.add('hidden');
  el.browseFoot.classList.add('hidden');
  el.browseForm.classList.remove('hidden');
  el.browseName.focus();
}

function backToBrowseList() {
  el.browseForm.classList.add('hidden');
  el.browseList.classList.remove('hidden');
  el.browseFoot.classList.remove('hidden');
}

function closeBrowse() { el.browseModal.classList.add('hidden'); pickedEntry = null; }

function confirmBrowseAdd() {
  if (!pickedEntry) return;
  const name = el.browseName.value.trim();
  if (!name) { browseError('A name is required.'); return; }
  if (servers.some((s) => s.name === name)) { browseError(`A server named "${name}" already exists.`); return; }

  const needsToken = pickedEntry.requiresToken !== false && (pickedEntry.args || []).some((a) => a.includes('{token}'));
  const token = el.browseToken.value.trim();
  if (needsToken && !token) { browseError('This server needs a token.'); return; }

  const args = (pickedEntry.args || []).map((a) => a.split('{token}').join(token));
  servers.push({
    name,
    command: pickedEntry.command || 'npx',
    args,
    env: {},
    extra: {},
    enabled: true,
  });
  closeBrowse();
  render();
  switchTab('servers');
  showToast(`Added "${name}". Review and Save to Claude Desktop.`, 'ok');
}

function browseError(msg) {
  el.browseError.textContent = msg;
  el.browseError.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => switchTab(t.dataset.tab))
);

$('btn-add').addEventListener('click', () => { switchTab('servers'); openModal(-1); });
$('btn-add-empty').addEventListener('click', () => openModal(-1));
$('btn-browse').addEventListener('click', openBrowse);
$('browse-close').addEventListener('click', closeBrowse);
$('browse-cancel').addEventListener('click', closeBrowse);
$('browse-back').addEventListener('click', backToBrowseList);
$('browse-confirm').addEventListener('click', confirmBrowseAdd);
el.browseModal.addEventListener('click', (e) => { if (e.target === el.browseModal) closeBrowse(); });
$('btn-reload').addEventListener('click', discardChanges);
$('btn-save').addEventListener('click', saveToDisk);
$('btn-discard').addEventListener('click', discardChanges);

$('modal-cancel').addEventListener('click', closeModal);
$('modal-ok').addEventListener('click', saveModal);
$('modal-delete').addEventListener('click', deleteFromModal);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.modal.classList.contains('hidden')) closeModal();
  else if (!el.browseModal.classList.contains('hidden')) closeBrowse();
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

// ---------------------------------------------------------------------------
// Update check (non-blocking, silent on failure)
// ---------------------------------------------------------------------------
async function checkForUpdate() {
  let res;
  try { res = await window.api.checkUpdate(); } catch (_) { return; }
  if (!res || !res.updateAvailable) return;

  $('update-text').innerHTML =
    `A new version <strong>v${escapeHtml(res.latest)}</strong> is available ` +
    `(you have v${escapeHtml(res.current)}).`;
  const dl = $('update-download');
  dl.onclick = () => window.api.openExternal(res.url);
  $('update-dismiss').onclick = () => $('update-banner').classList.add('hidden');
  $('update-banner').classList.remove('hidden');
}

loadFromDisk();
checkForUpdate();
