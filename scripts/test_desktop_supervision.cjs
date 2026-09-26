/* Contract tests for LE process ownership; does not launch or modify a real LE. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'apps/desktop/node_modules/typescript'));
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/desktop/src/main/le.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function harness({ external = false, neverReady = false, spawnError = false } = {}) {
  const exports = {};
  const children = [];
  let shutdowns = 0;
  const timers = new Set();
  const terminate = proc => { proc.alive = false; queueMicrotask(() => proc.emit('exit', 0)); };
  const spawn = () => {
    const proc = new EventEmitter();
    Object.assign(proc, { alive: true, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => terminate(proc) });
    children.push(proc);
    if (spawnError) queueMicrotask(() => proc.emit('error', new Error('test spawn failure')));
    return proc;
  };
  vm.runInNewContext(code, {
    exports, require: name => name === 'child_process' ? { spawn } : require(name),
    process: { env: { LE_API_TOKEN: 'test-only-token', KYALULU_LE_BINARY: 'test-only-binary' }, platform: process.platform, stderr: { write() {} } },
    fetch: async (url, options) => {
      if (options.method === 'POST') { shutdowns++; children.filter(p => p.alive).forEach(terminate); }
      return { ok: external || (!neverReady && children.some(p => p.alive)) };
    },
    AbortSignal, URL, setTimeout: (fn, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, Math.min(ms, 20));
      timers.add(timer);
      return timer;
    }
  });
  return { api: exports, children, shutdowns: () => shutdowns, dispose: () => timers.forEach(clearTimeout) };
}

test('concurrent LE starts preserve ownership and stop only the owned child', async () => {
  const h = harness();
  try {
    assert.deepEqual(await Promise.all([h.api.startLE(), h.api.startLE()]), ['owned', 'owned']);
    assert.equal(await h.api.startLE(), 'owned');
    assert.equal(h.children.length, 1);
    await h.api.stopLE();
    assert.equal(h.children[0].alive, false);
    assert.equal(h.shutdowns(), 1);
  } finally { h.dispose(); }
});

test('LE quit while startup is pending leaves no process', async () => {
  const h = harness({ neverReady: true });
  try {
    const starting = h.api.startLE();
    await new Promise(resolve => setImmediate(resolve));
    await h.api.stopLE();
    await starting;
    assert.equal(h.children.length, 1);
    assert.equal(h.children[0].alive, false);
    assert.equal((await h.api.leStatus()).state, 'exited');
  } finally { h.dispose(); }
});

test('an external LE survives Desktop quit', async () => {
  const h = harness({ external: true });
  try {
    assert.equal(await h.api.startLE(), 'external');
    await h.api.stopLE();
    assert.equal(h.shutdowns(), 0);
    assert.equal(h.children.length, 0);
  } finally { h.dispose(); }
});

test('an LE spawn error is reported without waiting for startup timeout', async () => {
  const h = harness({ spawnError: true, neverReady: true });
  try {
    assert.equal(await h.api.startLE(), 'unavailable');
    assert.match((await h.api.leStatus()).error, /test spawn failure/);
  } finally { h.dispose(); }
});
