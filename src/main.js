'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./config-core');

// ---------------------------------------------------------------------------
// Config location
//
// app.getPath('appData') resolves to the correct per-user config root on every
// OS, so we never hard-code platform paths:
//   macOS   -> ~/Library/Application Support
//   Windows -> %APPDATA% (Roaming)
//   Linux   -> ~/.config
// The Claude Desktop config file always lives in a "Claude" subfolder.
// ---------------------------------------------------------------------------

function defaultConfigPath() {
  return path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json');
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
  return {
    path: configPath,
    isDefault: !readOverridePath(),
    defaultPath: defaultConfigPath(),
    exists: fs.existsSync(configPath),
    platform: process.platform,
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

  // Backup the existing file (if any) before touching it.
  let backupPath = null;
  if (fs.existsSync(configPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${configPath}.backup-${stamp}`;
    fs.copyFileSync(configPath, backupPath);
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
