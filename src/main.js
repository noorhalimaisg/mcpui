'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const core = require('./config-core');

// The "Browse MCP" catalog has two sources that are MERGED:
//   1. A small bundled list (src/mcp-catalog.json) — always available offline.
//      Currently just the AI Singapore Shortener.
//   2. An online catalog served by the AISG WordPress "MCP Catalog" plugin
//      (GET /wp-json/mcp-catalog/v1/catalog), which holds everything else and
//      can be updated without shipping a new app version.
// The AISG MCP Catalog WordPress endpoint. The api_key is intentionally baked
// in (decision: the catalog holds no secrets, only {token} placeholders, so a
// readable key is acceptable). Override per-machine via the "catalogUrl" key in
// the app's mcpui-settings.json. NOTE: this key is therefore public in the repo
// — rotate it in wp-admin (MCP Catalog → API Access) if it must ever be private.
const DEFAULT_CATALOG_URL = 'https://support.aisingapore.org/wp-json/mcp-catalog/v1/catalog?api_key=mcpcat_F9Z76ecPQZb6QOrFPJ3dpZD9zsOzvOZMBS54F331';

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

// Read an arbitrary string setting from our settings file (returns null if unset).
function readOverrideSetting(key) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (parsed && typeof parsed[key] === 'string' && parsed[key].trim()) {
      return parsed[key];
    }
  } catch (_) {
    /* no settings yet */
  }
  return null;
}

// Write (or clear, when value is empty/null) an arbitrary string setting.
function writeSetting(key, value) {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {};
  } catch (_) {
    current = {};
  }
  if (value === null || value === undefined || value === '') {
    delete current[key];
  } else {
    current[key] = value;
  }
  fs.writeFileSync(settingsPath(), JSON.stringify(current, null, 2), 'utf8');
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

// ---------------------------------------------------------------------------
// Browse MCP catalog
//
// Returns a list of ready-to-add MCP templates. Each entry has command/args
// where {token} is substituted with the user's token in the renderer. We ship
// a bundled catalog and, if reachable, prefer a remote one so the list can be
// updated without a new app release.
// ---------------------------------------------------------------------------

function readBundledCatalog() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'mcp-catalog.json'), 'utf8');
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch (_) {
    return [];
  }
}

function fetchRemoteCatalog(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    const req = https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return done(null); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
      res.on('end', () => {
        try {
          const items = JSON.parse(data);
          done(Array.isArray(items) ? items : null);
        } catch (_) { done(null); }
      });
    });
    req.on('error', () => done(null));
    req.on('timeout', () => { req.destroy(); done(null); });
  });
}

function handleCatalogGetConfig() {
  const override = readOverrideSetting('catalogUrl');
  return {
    ok: true,
    override: override || '',
    default: DEFAULT_CATALOG_URL,
    effective: override || DEFAULT_CATALOG_URL,
  };
}

function handleCatalogSetUrl(_e, url) {
  writeSetting('catalogUrl', typeof url === 'string' ? url.trim() : '');
  return { ok: true };
}

// --- Virtual pet persistence (stored in our settings file) -----------------
function handlePetLoad() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ok: true, pet: s && s.pet ? s.pet : null };
  } catch (_) {
    return { ok: true, pet: null };
  }
}

function handlePetSave(_e, pet) {
  writeSetting('pet', pet && typeof pet === 'object' ? pet : null);
  return { ok: true };
}

async function handleBrowseCatalog() {
  const bundled = readBundledCatalog();
  const url = readOverrideSetting('catalogUrl') || DEFAULT_CATALOG_URL;

  let remote = [];
  let remoteTried = false;
  let remoteOk = false;
  if (url) {
    remoteTried = true;
    const fetched = await fetchRemoteCatalog(url);
    if (Array.isArray(fetched)) { remote = fetched; remoteOk = true; }
  }

  // Merge: bundled entries first (canonical, offline), then any online entries
  // whose name isn't already present.
  const items = [...bundled];
  const have = new Set(bundled.map((e) => e && e.name));
  for (const e of remote) {
    if (e && e.name && !have.has(e.name)) { items.push(e); have.add(e.name); }
  }

  let source = 'bundled';
  if (remoteTried) source = remoteOk ? 'online + bundled' : 'bundled (online unreachable)';
  return { ok: true, source, items, bundledCount: bundled.length, onlineCount: remote.length };
}

// ---------------------------------------------------------------------------
// Update check
//
// No server needed: we ask GitHub's public Releases API for the latest release
// and compare its tag to our own version. Any failure (offline, rate-limited)
// is swallowed so it never nags the user.
// ---------------------------------------------------------------------------

const RELEASES_API = 'https://api.github.com/repos/noorhalimaisg/mcpui/releases/latest';

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function fetchLatestRelease() {
  return new Promise((resolve) => {
    // GitHub requires a User-Agent header or it rejects the request.
    const opts = {
      headers: { 'User-Agent': 'mcpui', Accept: 'application/vnd.github+json' },
      timeout: 8000,
    };
    const req = https.get(RELEASES_API, opts, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function handleCheckUpdate() {
  const current = app.getVersion();
  const rel = await fetchLatestRelease();
  if (!rel || !rel.tag_name) {
    // Couldn't reach GitHub (offline / rate-limited) — distinct from "up to date".
    return { ok: true, reachable: false, updateAvailable: false, current };
  }
  const latest = String(rel.tag_name).replace(/^v/i, '');
  return {
    ok: true,
    reachable: true,
    updateAvailable: compareVersions(latest, current) > 0,
    current,
    latest,
    url: rel.html_url,
    name: rel.name || rel.tag_name,
  };
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
// Catalog management (OTP login + CRUD against the WordPress plugin)
//
// All network happens here in the main process. The session token from a
// successful OTP verification is held in memory only (never persisted) and
// cleared on logout / app quit.
// ---------------------------------------------------------------------------

let manageToken = null;
let manageEmail = null;

// Minimal JSON HTTP helper supporting any method + bearer/body.
function httpJson(method, urlStr, opts = {}) {
  const { headers = {}, body = null } = opts;
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (_) { return resolve({ status: 0, error: 'Bad URL' }); }
    const lib = u.protocol === 'http:' ? require('http') : https;
    const payload = body == null ? null : JSON.stringify(body);
    const reqOpts = {
      method,
      timeout: 15000,
      headers: {
        'User-Agent': 'mcpui',
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };
    const req = lib.request(u, reqOpts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 4_000_000) req.destroy(); });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (_) { /* non-JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Derive the plugin's REST base (".../mcp-catalog/v1") from the catalog URL.
function manageBase() {
  const catalogUrl = readOverrideSetting('catalogUrl') || DEFAULT_CATALOG_URL;
  if (!catalogUrl) return null;
  const noQuery = catalogUrl.split('?')[0].replace(/\/+$/, '');
  return noQuery.replace(/\/catalog$/i, '');
}

function authHeaders() {
  return manageToken ? { Authorization: `Bearer ${manageToken}` } : {};
}

async function handleManageRequestOtp(_e, email) {
  const base = manageBase();
  if (!base) return { ok: false, error: 'No catalog endpoint is configured.' };
  const r = await httpJson('POST', `${base}/auth/request-otp`, { body: { email } });
  if (r.status === 429) return { ok: false, error: 'Too many attempts. Please wait a few minutes.' };
  if (r.status !== 200 || !r.json) return { ok: false, error: r.error || `Request failed (${r.status}).` };
  return { ok: true, allowed: !!r.json.allowed, sent: !!r.json.sent };
}

async function handleManageVerifyOtp(_e, email, otp) {
  const base = manageBase();
  if (!base) return { ok: false, error: 'No catalog endpoint is configured.' };
  const r = await httpJson('POST', `${base}/auth/verify-otp`, { body: { email, otp } });
  if (r.status === 200 && r.json && r.json.ok && r.json.token) {
    manageToken = r.json.token;
    manageEmail = r.json.email || email;
    return { ok: true, email: manageEmail };
  }
  return { ok: false, error: (r.json && r.json.error) || 'Invalid or expired code.' };
}

function handleManageStatus() {
  return { ok: true, loggedIn: !!manageToken, email: manageEmail };
}

async function handleManageLogout() {
  const base = manageBase();
  if (manageToken && base) {
    await httpJson('POST', `${base}/auth/logout`, { headers: authHeaders() });
  }
  manageToken = null;
  manageEmail = null;
  return { ok: true };
}

// Wrap a manage call: handles "not logged in" and 401 session-expiry uniformly.
async function manageRequest(method, pathSuffix, body) {
  if (!manageToken) return { ok: false, error: 'Not signed in.' };
  const base = manageBase();
  if (!base) return { ok: false, error: 'No catalog endpoint is configured.' };
  const r = await httpJson(method, `${base}${pathSuffix}`, { headers: authHeaders(), body });
  if (r.status === 401) {
    manageToken = null;
    manageEmail = null;
    return { ok: false, expired: true, error: 'Your session expired. Please sign in again.' };
  }
  if ((r.status === 200 || r.status === 201) && r.json && r.json.ok) return r.json;
  return { ok: false, error: (r.json && r.json.error) || `Request failed (${r.status}).` };
}

function handleManageList() {
  return manageRequest('GET', '/manage/catalog');
}
function handleManageCreate(_e, entry) {
  return manageRequest('POST', '/manage/catalog', entry);
}
function handleManageUpdate(_e, id, entry) {
  return manageRequest('PUT', `/manage/catalog/${encodeURIComponent(id)}`, entry);
}
function handleManageDelete(_e, id) {
  return manageRequest('DELETE', `/manage/catalog/${encodeURIComponent(id)}`);
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
  ipcMain.handle('catalog:browse', handleBrowseCatalog);
  ipcMain.handle('catalog:getConfig', handleCatalogGetConfig);
  ipcMain.handle('catalog:setUrl', handleCatalogSetUrl);
  ipcMain.handle('pet:load', handlePetLoad);
  ipcMain.handle('pet:save', handlePetSave);
  ipcMain.handle('update:check', handleCheckUpdate);
  ipcMain.handle('app:version', () => ({ ok: true, version: app.getVersion() }));
  ipcMain.handle('shell:openExternal', handleOpenExternal);
  ipcMain.handle('manage:requestOtp', handleManageRequestOtp);
  ipcMain.handle('manage:verifyOtp', handleManageVerifyOtp);
  ipcMain.handle('manage:status', handleManageStatus);
  ipcMain.handle('manage:logout', handleManageLogout);
  ipcMain.handle('manage:list', handleManageList);
  ipcMain.handle('manage:create', handleManageCreate);
  ipcMain.handle('manage:update', handleManageUpdate);
  ipcMain.handle('manage:delete', handleManageDelete);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
