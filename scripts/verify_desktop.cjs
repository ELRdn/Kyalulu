/* Build first: pnpm --filter desktop build. Then: node scripts/verify_desktop.cjs
   Uses a hidden Electron window, an owned API on a dedicated port, and isolated data. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.artifacts', 'roadmap-20260926-cyan', 'desktop');

if (!process.versions.electron) {
  const ts = require(path.join(root, 'apps/desktop/node_modules/typescript'));
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['api', 'protocol']) {
    const source = fs.readFileSync(path.join(root, `apps/desktop/src/main/${name}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    fs.writeFileSync(path.join(output, `${name}.js`), compiled.outputText);
  }
  const electron = require(path.join(root, 'apps/desktop/node_modules/electron'));
  const { spawn } = require('node:child_process');
  const env = { ...process.env, KYALULU_API_BASE: 'http://127.0.0.1:8018', KYALULU_DATA_DIR: path.join(output, 'data'),
    KYALULU_EXPERIMENTS_DIR: path.join(output, 'experiments'), KYALULU_REPO_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.KYALULU_API_COMMAND;
  const child = spawn(electron, [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, ipcMain } = require('electron');
  app.setPath('userData', path.join(output, 'profile'));
  const api = require(path.join(output, 'api.js'));
  const { installProtocol } = require(path.join(output, 'protocol.js'));
  let window;
  const errors = [];
  const result = {};
  const deadline = setTimeout(() => { console.error('Desktop smoke timed out'); void finish(1); }, 90000);
  async function finish(code) {
    clearTimeout(deadline);
    if (window && !window.isDestroyed()) window.destroy();
    await api.stopAPI();
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...result, errors, exit_code: code }, null, 2));
    app.exit(code);
  }
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    assert.equal(await api.apiHealthy(500), false, 'Dedicated test port must be unused');
    const cancelledStart = api.startAPI({ searchFrom: root });
    await api.stopAPI();
    assert.equal(await cancelledStart, 'exited');
    assert.equal(await api.apiHealthy(500), false);
    result.stop_during_start = true;
    assert.deepEqual(await Promise.all([api.startAPI({ searchFrom: root }), api.startAPI({ searchFrom: root })]), ['owned', 'owned']);
    assert.equal(await api.startAPI({ searchFrom: root }), 'owned', 'Repeated start must keep ownership');
    result.owned_start = true;
    const base = api.API_BASE;
    const memory = await fetch(`${base}/api/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'desktop-smoke', type: 'semantic', content: '再起動しても保存される記憶' }) }).then(r => r.json());
    await api.stopAPI();
    assert.equal(await api.apiHealthy(500), false);
    assert.equal(await api.startAPI({ searchFrom: root }), 'owned');
    const restored = await fetch(`${base}/api/memory/${memory.id}`).then(r => r.json());
    assert.equal(restored.content, memory.content);
    result.restart_restoration = true;
    installProtocol(path.join(root, 'apps/desktop/out/renderer'));
    let bridgeResolve;
    const bridgeCalled = new Promise(resolve => { bridgeResolve = resolve; });
    ipcMain.handle('get-supervision', async () => {
      bridgeResolve();
      return { api: await api.apiStatus(), le: { state: 'disabled', healthy: false } };
    });
    ipcMain.handle('get-api-base', () => base);
    window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: {
      preload: path.join(root, 'apps/desktop/out/preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false
    } });
    window.webContents.on('preload-error', (_event, _file, error) => errors.push(error.message));
    const titleReady = new Promise(resolve => window.webContents.on('page-title-updated', (_event, title) => {
      if (title.startsWith('Status |')) resolve();
    }));
    await window.loadURL('app://kyalulu/index.html#/status');
    await bridgeCalled;
    await titleReady;
    assert.match(window.webContents.getTitle(), /Status/);
    assert.deepEqual(errors, []);
    result.built_renderer_and_preload = true;
    result.url = window.webContents.getURL();
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, 'status.png'), screenshot.toPNG());
    const { net } = require('electron');
    const health = await net.fetch('app://kyalulu/api/health').then(r => r.json());
    assert.equal(health.status, 'ok');
    result.protocol_api_proxy = true;
    const stream = await net.fetch('app://kyalulu/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: 'mock-echo', session_id: 'desktop-smoke', messages: [{ role: 'user', content: 'hello' }] }) }).then(r => r.text());
    assert.match(stream, /event: done/);
    result.protocol_sse = true;
    await api.stopAPI();
    assert.equal(await api.apiHealthy(500), false);
    result.owned_stop = true;
    const external = require('node:http').createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', runtime: 'test-external' }));
    });
    await new Promise(resolve => external.listen(8018, '127.0.0.1', resolve));
    try {
      assert.equal(await api.startAPI({ searchFrom: root }), 'external');
      await api.stopAPI();
      assert.equal(await api.apiHealthy(500), true, 'An external API must remain alive');
      result.external_preserved = true;
    } finally { await new Promise(resolve => external.close(resolve)); }
    console.log(JSON.stringify(result));
    await finish(0);
  }).catch(error => { errors.push(error.stack); console.error(error); void finish(1); });
}
