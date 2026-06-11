'use strict';

// Plain Node test (no framework). Run: node test/config-core.test.js
const assert = require('assert');
const core = require('../src/config-core');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A config shaped like a real Claude Desktop file: mcpServers PLUS other
// top-level keys that must survive untouched, plus a server with an unusual
// extra field.
const sample = {
  mcpServers: {
    'remote-a': {
      command: 'npx',
      args: ['mcp-remote', 'https://a.example/mcp', '--header', 'Authorization: Bearer AAA'],
    },
    'with-env-and-extra': {
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'secret' },
      type: 'stdio',      // <- field the UI doesn't expose
      disabled: false,    // <- another preserved field
    },
  },
  coworkUserFilesPath: '/Users/someone/Claude',
  preferences: { sidebarMode: 'chat', nested: { a: 1 } },
};

console.log('config-core safety tests');

test('round-trip preserves other top-level keys exactly', () => {
  const { root } = core.parseRoot(JSON.stringify(sample));
  const servers = core.serverObjectToArray(root.mcpServers);
  core.mergeServers(root, servers); // simulate "save with no changes"

  assert.strictEqual(root.coworkUserFilesPath, '/Users/someone/Claude');
  assert.deepStrictEqual(root.preferences, { sidebarMode: 'chat', nested: { a: 1 } });
});

test('preserves unknown per-server fields (type, disabled)', () => {
  const servers = core.serverObjectToArray(sample.mcpServers);
  const out = core.arrayToServerObject(servers);
  assert.strictEqual(out['with-env-and-extra'].type, 'stdio');
  assert.strictEqual(out['with-env-and-extra'].disabled, false);
  assert.deepStrictEqual(out['with-env-and-extra'].env, { API_KEY: 'secret' });
});

test('preserves command + args content', () => {
  const servers = core.serverObjectToArray(sample.mcpServers);
  const out = core.arrayToServerObject(servers);
  assert.strictEqual(out['remote-a'].command, 'npx');
  assert.deepStrictEqual(out['remote-a'].args, [
    'mcp-remote', 'https://a.example/mcp', '--header', 'Authorization: Bearer AAA',
  ]);
});

test('add a server only touches mcpServers', () => {
  const { root } = core.parseRoot(JSON.stringify(sample));
  const servers = core.serverObjectToArray(root.mcpServers);
  servers.push({ name: 'new-one', command: 'uvx', args: ['foo'], env: {}, extra: {} });
  core.mergeServers(root, servers);

  assert.ok(root.mcpServers['new-one']);
  assert.strictEqual(root.mcpServers['new-one'].command, 'uvx');
  assert.strictEqual(Object.keys(root.mcpServers).length, 3);
  // other keys still intact
  assert.strictEqual(root.coworkUserFilesPath, '/Users/someone/Claude');
});

test('delete a server only touches mcpServers', () => {
  const { root } = core.parseRoot(JSON.stringify(sample));
  let servers = core.serverObjectToArray(root.mcpServers);
  servers = servers.filter((s) => s.name !== 'remote-a');
  core.mergeServers(root, servers);

  assert.strictEqual(root.mcpServers['remote-a'], undefined);
  assert.ok(root.mcpServers['with-env-and-extra']);
  assert.ok(root.preferences); // untouched
});

test('edit a server keeps its preserved extra fields', () => {
  const { root } = core.parseRoot(JSON.stringify(sample));
  const servers = core.serverObjectToArray(root.mcpServers);
  const idx = servers.findIndex((s) => s.name === 'with-env-and-extra');
  servers[idx].args = ['server.js', '--port', '9000']; // user edits args
  core.mergeServers(root, servers);

  assert.deepStrictEqual(root.mcpServers['with-env-and-extra'].args, ['server.js', '--port', '9000']);
  assert.strictEqual(root.mcpServers['with-env-and-extra'].type, 'stdio'); // still preserved
});

test('empty / missing mcpServers yields empty array, not crash', () => {
  assert.deepStrictEqual(core.serverObjectToArray(undefined), []);
  assert.deepStrictEqual(core.serverObjectToArray(null), []);
  const { root } = core.parseRoot('{}');
  assert.deepStrictEqual(core.serverObjectToArray(root.mcpServers), []);
});

test('invalid JSON is reported, not swallowed', () => {
  const { root, parseError } = core.parseRoot('{ this is not json ');
  assert.strictEqual(root, null);
  assert.ok(parseError);
});

test('loaded servers default to enabled:true', () => {
  const servers = core.serverObjectToArray(sample.mcpServers);
  assert.ok(servers.every((s) => s.enabled === true));
});

test('disabled servers are excluded from the written object', () => {
  const servers = core.serverObjectToArray(sample.mcpServers);
  servers[0].enabled = false; // turn the first one OFF
  const out = core.arrayToServerObject(servers);
  assert.ok(!(servers[0].name in out), 'OFF server is not written');
  assert.strictEqual(Object.keys(out).length, servers.length - 1);
});

test('models without an enabled field are treated as enabled', () => {
  const out = core.arrayToServerObject([{ name: 'x', command: 'npx', args: [], env: {}, extra: {} }]);
  assert.ok(out.x);
});

test('a brand-new config (no other keys) still works', () => {
  const root = {};
  core.mergeServers(root, [{ name: 'solo', command: 'npx', args: [], env: {}, extra: {} }]);
  assert.deepStrictEqual(Object.keys(root), ['mcpServers']);
  assert.ok(root.mcpServers.solo);
});

console.log(`\n${passed} tests passed.`);
