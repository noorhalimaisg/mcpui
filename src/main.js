'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./config-core');

// ---------------------------------------------------------------------------
// Config location
//
// There is no single fixed path, because Claude Desktop stores its config
// differently depending on how it was installed:
//
//   macOS                  -> ~/Library/Application Support/Claude/
//   Linux                  -> ~/.config/Claude/
//   Windows (.exe installer) -> %APPDATA%\Claude\
//   Windows (Microsoft Store / MSIX) -> the package container virtualizes
//        %APPDATA%, so the file lives at
//        %LOCALAPPDATA%\Packages\Claude_<publisherHash>\LocalCache\Roaming\Claude\
//
// So instead of hard-coding one path we build a list of CANDIDATES per OS and
// pick the first that exists (falling back to the most likely creation target).
// The Store path's <publisherHash> is globbed (Claude_*) so we don't depend on
// the exact hash.
// ---------------------------------------------------------------------------

const CONFIG_FILE = 'claude_desktop_config.json';

function configCandidates() {
  const home = app.getPath('home');
  const plt = process.platform;

  if (plt === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'Claude', CONFIG_FILE)];
  }
  if (plt === 'linux') {
    return [path.join(home, '.config', 'Claude', CONFIG_FILE)];
  }

  // Windows.
  const candidates = [];
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  // 1) Standard .exe installer.
  candidates.push(path.join(appData, 'Claude', CONFIG_FILE));

  // 2) Microsoft Store / MSIX packaged install (any publisher hash).
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const packagesDir = path.join(localAppData, 'Packages');
  try {
    for (const entry of fs.readdirSync(packagesDir)) {
      if (entry.toLowerCase().startsWith('claude')) {
        candidates.push(
          path.join(packagesDir, entry, 'LocalCache', 'Roaming', 'Claude', CONFIG_FILE)
        );
      }
    }
  } catch (_) {
    /* Packages dir not present/readable — fine */
  }
  return candidates;
}

// The path we use when there is no manual override: an existing config wins;
// otherwise the first candidate whose parent "Claude" folder already exists
// (so a Store-only machine creates the file in the right place); else the very
// first candidate.
function defaultConfigPath() {
  const candidates = configCandidates();
  let creationFallback = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
    if (!creationFallback && fs.existsSync(path.dirname(c))) creationFallback = c;
  }
  return creationFallback || candidates[0];
}

// A tiny settings file (in our OWN userData dir, never Claude's) so a manually
// chosen config path survives restarts.
function settingsPath() {
  return path.join(app.getPath('userData'), 'mcpui-settings.json');
}

function readOverridePath() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.configPathOverride === 'string' && parsed.configPathOverride.trim()) {
      return parsed.configPathOverride;
    }
  } catch (_) {
    /* no settings yet */
  }
  return null;
}

function writeOverridePath(p) {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {};
  } catch (_) {
    current = {};
  }
  current.configPathOverride = p || null;
  fs.writeFileSync(settingsPath(), JSON.stringify(current, null, 2), 'utf8');
}

function activeConfigPath() {
  return readOverridePath() || defaultConfigPath();
}

// ---------------------------------------------------------------------------
// Disk operations
//
// The pure conversion/merge logic lives in config-core.js (so it can be unit
// tested without Electron). Crucially, the merge preserves every top-level key
// other than mcpServers, and preserves unknown per-server fields.
// ---------------------------------------------------------------------------

function readRoot(configPath) {
  // Returns { root, existed, parseError }
  if (!fs.existsSync(configPath)) {
    return { root: {}, existed: false, parseError: null };
  }
  const text = fs.readFileSync(configPath, 'utf8');
  const { root, parseError } = core.parseRoot(text);
  return { root, existed: true, parseError };
}

function handleLocate() {
  const configPath = activeConfigPath();
  // Report which candidate locations were detected, so the user can see whether
  // a Store vs standard install was found (and pick another via "Choose file").
  const candidates = configCandidates().map((p) => ({ path: p, exists: fs.existsSync(p) }));
  return {
    path: configPath,
    isDefault: !readOverridePath(),
    defaultPath: defaultConfigPath(),
    exists: fs.existsSync(configPath),
    platform: process.platform,
    candidates,
  };
}

function handleRead() {
  const configPath = activeConfigPath();
  const { root, existed, parseError } = readRoot(configPath);

  if (parseError) {
    return { ok: false, path: configPath, error: `Could not parse config: ${parseError}` };
  }

  const servers = core.serverObjectToArray(root.mcpServers);
  // Names of the other top-level keys we will preserve untouched.
  const preservedKeys = Object.keys(root).filter((k) => k !== 'mcpServers');

  return {
    ok: true,
    path: configPath,
    existed,
    servers,
    preservedKeys,
  };
}

// ---------------------------------------------------------------------------
// In-app backup store
//
// Every save (and every restore) snapshots the FULL config file as it was just
// before the change, into our own userData dir. We keep only the newest
// MAX_BACKUPS and purge the oldest, so the user always has a short rollback
// history without cluttering Claude's folder or growing unbounded.
// Filenames are ISO timestamps (": ." replaced with "-") so they sort
// chronologically as plain strings.
// ---------------------------------------------------------------------------

const MAX_BACKUPS = 10;

function backupsDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function listBackupFiles() {
  try {
    return fs
      .readdirSync(backupsDir())
      .filter((f) => /^backup-.*\.json$/.test(f))
      .sort(); // oldest first (lexicographic == chronological)
  } catch (_) {
    return [];
  }
}

function pruneBackups() {
  const files = listBackupFiles();
  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift();
    try {
      fs.unlinkSync(path.join(backupsDir(), oldest));
    } catch (_) {
      /* ignore */
    }
  }
}

// Store the given raw config text as a new backup, then prune to MAX_BACKUPS.
function storeBackup(rawText) {
  fs.mkdirSync(backupsDir(), { recursive: true });
  let stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let file = path.join(backupsDir(), `backup-${stamp}.json`);
  // Guard against same-millisecond collisions.
  let n = 1;
  while (fs.existsSync(file)) {
    file = path.join(backupsDir(), `backup-${stamp}-${n++}.json`);
  }
  fs.writeFileSync(file, rawText, 'utf8');
  pruneBackups();
  return file;
}

// Snapshot the current on-disk config (if any) before we overwrite it.
function snapshotCurrent(configPath) {
  if (!fs.existsSync(configPath)) return null;
  return storeBackup(fs.readFileSync(configPath, 'utf8'));
}

function handleListBackups() {
  const files = listBackupFiles().reverse(); // newest first
  const items = files.map((f) => {
    const full = path.join(backupsDir(), f);
    let serverCount = null;
    let serverNames = [];
    try {
      const root = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (root && root.mcpServers && typeof root.mcpServers === 'object') {
        serverNames = Object.keys(root.mcpServers);
        serverCount = serverNames.length;
      } else {
        serverCount = 0;
      }
    } catch (_) {
      /* unreadable/corrupt backup — still listable */
    }
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(full).mtimeMs;
    } catch (_) {
      /* ignore */
    }
    return { id: f, mtimeMs, serverCount, serverNames };
  });
  return { ok: true, max: MAX_BACKUPS, items };
}

function handleRestoreBackup(_event, id) {
  // Validate the id is a plain backup filename (no path traversal).
  if (typeof id !== 'string' || !/^backup-[A-Za-z0-9._-]+\.json$/.test(id) || id.includes('..')) {
    return { ok: false, error: 'Invalid backup id.' };
  }
  const full = path.join(backupsDir(), id);
  if (!fs.existsSync(full)) {
    return { ok: false, error: 'That backup no longer exists.' };
  }

  // Parse the backup and the CURRENT file.
  const { root: backupRoot, parseError: backupErr } = core.parseRoot(fs.readFileSync(full, 'utf8'));
  if (backupErr || !backupRoot) {
    return { ok: false, error: `Backup is not valid JSON (${backupErr}).` };
  }

  const configPath = activeConfigPath();
  const { root: curRoot, parseError: curErr } = readRoot(configPath);
  if (curErr) {
    return {
      ok: false,
      error: `Refusing to restore: current config is not valid JSON (${curErr}).`,
    };
  }

  // Snapshot the current state first, so a restore is itself undoable.
  snapshotCurrent(configPath);
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  // Consistent with the rest of the app: replace ONLY mcpServers, keeping every
  // other current top-level key untouched.
  const finalRoot = curRoot || {};
  finalRoot.mcpServers = backupRoot.mcpServers && typeof backupRoot.mcpServers === 'object'
    ? backupRoot.mcpServers
    : {};

  const tmpPath = `${configPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, core.serialize(finalRoot), 'utf8');
  fs.renameSync(tmpPath, configPath);

  return {
    ok: true,
    count: Object.keys(finalRoot.mcpServers).length,
  };
}

function handleSave(_event, serverArray) {
  const configPath = activeConfigPath();

  if (!Array.isArray(serverArray)) {
    return { ok: false, error: 'Invalid payload: expected an array of servers.' };
  }

  // Validate names: non-empty and unique.
  const seen = new Set();
  for (const m of serverArray) {
    const name = (m.name || '').trim();
    if (!name) return { ok: false, error: 'Every server must have a name.' };
    if (seen.has(name)) return { ok: false, error: `Duplicate server name: "${name}".` };
    seen.add(name);
  }

  // Re-read the file FRESH right before writing, so we merge into whatever is
  // currently on disk (it may have changed since the UI loaded it). Refuse to
  // write over a file we cannot parse — better to error than to clobber.
  const { root, parseError } = readRoot(configPath);
  if (parseError) {
    return {
      ok: false,
      error: `Refusing to save: existing config is not valid JSON (${parseError}). ` +
        `Fix or remove the file first to avoid losing data.`,
    };
  }

  const finalRoot = root || {};

  // Snapshot the existing file (if any) into the in-app backup store before we
  // overwrite it. This is the rollback history surfaced in the Backups tab.
  let backupPath = null;
  if (fs.existsSync(configPath)) {
    backupPath = snapshotCurrent(configPath);
  } else {
    // Ensure the Claude folder exists if we're creating the file for the first time.
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
  }

  // Replace ONLY the mcpServers key. Every other top-level key
  // (coworkUserFilesPath, preferences, and anything else) is left exactly as is.
  core.mergeServers(finalRoot, serverArray);

  // Atomic write: write to a temp file, then rename over the real one.
  const tmpPath = `${configPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, core.serialize(finalRoot), 'utf8');
  fs.renameSync(tmpPath, configPath);

  return {
    ok: true,
    path: configPath,
    backupPath,
    count: serverArray.length,
    preservedKeys: Object.keys(finalRoot).filter((k) => k !== 'mcpServers'),
  };
}

async function handleChoose() {
  const result = await dialog.showOpenDialog({
    title: 'Select claude_desktop_config.json',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }
  const chosen = result.filePaths[0];
  writeOverridePath(chosen);
  return { ok: true, path: chosen };
}

function handleResetPath() {
  writeOverridePath(null);
  return { ok: true, path: defaultConfigPath() };
}

function handleOpenFolder() {
  const configPath = activeConfigPath();
  const dir = path.dirname(configPath);
  if (fs.existsSync(configPath)) {
    shell.showItemInFolder(configPath);
  } else if (fs.existsSync(dir)) {
    shell.openPath(dir);
  } else {
    return { ok: false, error: 'Config folder does not exist yet.' };
  }
  return { ok: true };
}

// Open an external link in the user's default browser. Only http/https is
// allowed, so the renderer can never use this to launch arbitrary protocols.
function handleOpenExternal(_event, url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Only http/https links can be opened.' };
  }
  shell.openExternal(url);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Window + app lifecycle
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'MCP Manager for Claude Desktop',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('config:locate', handleLocate);
  ipcMain.handle('config:read', handleRead);
  ipcMain.handle('config:save', handleSave);
  ipcMain.handle('config:choose', handleChoose);
  ipcMain.handle('config:resetPath', handleResetPath);
  ipcMain.handle('config:openFolder', handleOpenFolder);
  ipcMain.handle('backups:list', handleListBackups);
  ipcMain.handle('backups:restore', handleRestoreBackup);
  ipcMain.handle('shell:openExternal', handleOpenExternal);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
