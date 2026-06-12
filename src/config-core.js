'use strict';

// Pure, dependency-free config logic. No Electron, no fs here, so it can be
// unit-tested directly (see test/config-core.test.js). main.js handles the
// actual file I/O and calls into these functions.

function serverObjectToArray(mcpServers) {
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) return [];
  return Object.keys(mcpServers).map((name) => {
    const obj = mcpServers[name] || {};
    const { command, args, env, ...extra } = obj;
    return {
      name,
      command: typeof command === 'string' ? command : '',
      args: Array.isArray(args) ? args.slice() : [],
      env: env && typeof env === 'object' && !Array.isArray(env) ? { ...env } : {},
      extra,
      enabled: true, // everything already in mcpServers is active
    };
  });
}

function arrayToServerObject(serverArray) {
  const out = {};
  for (const m of serverArray) {
    const name = (m.name || '').trim();
    if (!name) continue;
    // A server toggled OFF is excluded from what we write — Claude Desktop has
    // no native "disabled" flag, so the only way to stop it loading is to leave
    // it out of mcpServers.
    if (m.enabled === false) continue;
    const entry = {};
    if (typeof m.command === 'string' && m.command.trim() !== '') {
      entry.command = m.command;
    }
    if (Array.isArray(m.args) && m.args.length > 0) {
      entry.args = m.args;
    }
    if (m.env && typeof m.env === 'object' && Object.keys(m.env).length > 0) {
      entry.env = m.env;
    }
    if (m.extra && typeof m.extra === 'object') {
      for (const [k, v] of Object.entries(m.extra)) {
        if (!(k in entry)) entry[k] = v;
      }
    }
    out[name] = entry;
  }
  return out;
}

// Parse the on-disk text. Returns { root, parseError }.
function parseRoot(text) {
  if (!text || !text.trim()) return { root: {}, parseError: null };
  try {
    const root = JSON.parse(text);
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return { root: null, parseError: 'Config root is not a JSON object.' };
    }
    return { root, parseError: null };
  } catch (err) {
    return { root: null, parseError: err.message };
  }
}

// Replace ONLY mcpServers on the given root, leaving every other key intact.
function mergeServers(root, serverArray) {
  const finalRoot = root && typeof root === 'object' ? root : {};
  finalRoot.mcpServers = arrayToServerObject(serverArray);
  return finalRoot;
}

function serialize(root) {
  return JSON.stringify(root, null, 2) + '\n';
}

// Reconcile the app's saved library (full list incl. disabled) with what's
// actually on disk in Claude's config (the active/enabled set). Rules:
//   - On disk            -> active (enabled), using the on-disk config (Claude
//                           is the source of truth for active servers).
//   - In library, OFF, not on disk  -> kept as disabled (lives only in the app).
//   - In library, ON, but missing from disk -> removed externally -> dropped.
//   - On disk, not in library        -> added externally -> appended as enabled.
// Library order is preserved; external additions are appended.
function reconcileServers(diskServers, library) {
  const disk = Array.isArray(diskServers) ? diskServers : [];
  const lib = Array.isArray(library) ? library : [];
  const diskByName = new Map(disk.map((s) => [s.name, s]));
  const libNames = new Set(lib.map((s) => s.name));
  const result = [];
  const used = new Set();

  for (const entry of lib) {
    const onDisk = diskByName.get(entry.name);
    if (onDisk) {
      result.push({ ...onDisk, enabled: true });
      used.add(entry.name);
    } else if (entry.enabled === false) {
      result.push({ ...entry, enabled: false });
    }
    // else: was enabled but no longer on disk -> removed externally -> drop.
  }
  for (const d of disk) {
    if (!libNames.has(d.name) && !used.has(d.name)) {
      result.push({ ...d, enabled: true });
      used.add(d.name);
    }
  }
  return result;
}

module.exports = {
  serverObjectToArray,
  arrayToServerObject,
  parseRoot,
  mergeServers,
  serialize,
  reconcileServers,
};
