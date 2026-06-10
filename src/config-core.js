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
    };
  });
}

function arrayToServerObject(serverArray) {
  const out = {};
  for (const m of serverArray) {
    const name = (m.name || '').trim();
    if (!name) continue;
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

module.exports = {
  serverObjectToArray,
  arrayToServerObject,
  parseRoot,
  mergeServers,
  serialize,
};
