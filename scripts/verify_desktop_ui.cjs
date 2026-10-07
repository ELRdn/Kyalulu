/* pnpm build:desktop && node scripts/verify_desktop_ui.cjs
   Real Electron UI, isolated data/profile, no inference. Uses the existing Python Playwright installation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const playwright = execFileSync(python, ['-c', 'import pathlib, playwright; print(pathlib.Path(playwright.__file__).parent / "driver" / "package")'], { encoding: 'utf8' }).trim();
const { _electron } = require(playwright);
fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
const output = fs.mkdtempSync(path.join(root, '.artifacts', 'desktop-ui-'));
const checks = [], errors = [];
let desktop, page;

async function screenshot(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await desktop.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return image.toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(output, name), Buffer.from(png, 'base64'));
}

async function main() {
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bootstrap = path.join(output, 'bootstrap.mjs');
  fs.writeFileSync(bootstrap, `
import { app, BrowserWindow, session } from 'electron';
app.setPath('userData', ${JSON.stringify(path.join(output, 'profile'))});
BrowserWindow.prototype.show = function () {};
app.on('browser-window-created', (_, window) => window.webContents.setBackgroundThrottling(false));
globalThis.uiBlockedRequests = [];
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (request, callback) => {
  const url = new URL(request.url);
  const blocked = request.method === 'POST' && (/^\\/api\\/chat(?:$|\\/(?:stream|suggest)$)/.test(url.pathname) || /^\\/api\\/(?:benchmarks|experiments|commands)(?:\\/|$)/.test(url.pathname));
  if (blocked) globalThis.uiBlockedRequests.push(request.url);
  callback({ cancel: blocked });
}));
await import(${JSON.stringify(pathToFileURL(path.join(root, 'apps/desktop/out/main/index.js')).href)});
`);
  const env = { ...process.env, KYALULU_API_BASE: `http://127.0.0.1:${port}`, KYALULU_REPO_ROOT: root,
    KYALULU_DATA_DIR: path.join(output, 'data'), KYALULU_EXPERIMENTS_DIR: path.join(output, 'experiments'),
    KYALULU_LE_BINARY: '', LE_API_TOKEN: '', LE_TOKEN_FILE: path.join(output, 'unused-le-token') };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'KYALULU_API_COMMAND']) delete env[key];
  desktop = await _electron.launch({ executablePath: require(path.join(root, 'apps/desktop/node_modules/electron')), args: [bootstrap], env, timeout: 45000 });
  page = await desktop.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(String(e)));
  const nav = name => page.getByRole('navigation', { name: 'メインナビゲーション' }).getByRole('link', { name, exact: true });
  const search = page.getByRole('combobox', { name: '検索', exact: true });
  const ime = { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true };
  const check = name => { checks.push(name); console.log(`PASS ${name}`); };

  await page.getByRole('link', { name: /灯（あかり）/ }).first().waitFor();
  await page.waitForFunction(() => Array.from(document.images).every(img => img.complete));
  assert.deepEqual(await page.locator('img').evaluateAll(images => images.filter(img => !img.naturalWidth).map(img => img.src)), []);
  await screenshot('home-light.png');
  check('Desktop public images');

  const mascot = async (selector, file) => {
    const art = page.locator(selector).first();
    await art.waitFor();
    await art.evaluate(img => img.decode());
    assert.equal(await art.evaluate(img => new URL(img.src).pathname), `/mascot/v1.2/${file}.png`);
    assert.deepEqual(await art.evaluate(img => {
      const style = getComputedStyle(img);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
      return { fit: style.objectFit, blend: style.mixBlendMode, mask: style.maskImage, alpha: context.getImageData(0, 0, 1, 1).data[3] };
    }), { fit: 'contain', blend: 'normal', mask: 'none', alpha: 0 });
  };
  for (const width of [1440, 900]) {
    await desktop.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width);
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme)
        await page.getByRole('button', { name: theme === 'dark' ? 'ダークモードに切替' : 'ライトモードに切替', exact: true }).click();
      await mascot('.k-hero__mascot', 'sit');
      await mascot('.k-shell__logo-mark', 'face-default');
      if (width === 1440) await mascot('.k-shell__companion-art', 'nap');
      assert.equal(await page.locator('.k-hero__mascot').evaluate(img => {
        const a = img.getBoundingClientRect(), b = img.closest('.k-hero').getBoundingClientRect();
        return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
      }), true);
      await screenshot(`mascot-${theme}-${width}.png`);
    }
  }
  await nav('チャット').click();
  await mascot('.k-empty__mascot', 'guide');
  await nav('クリエイト').click();
  await mascot('.k-empty__mascot', 'face-wink');
  await nav('ディスカバー').click();
  await page.getByRole('textbox', { name: 'キャラクターを検索' }).fill('no-such-mascot-character');
  await mascot('.k-empty__mascot', 'face-curious');
  await screenshot('mascot-empty-dark.png');
  await page.goto('app://kyalulu/index.html#/chats/mascot-ui');
  await mascot('.k-avatar--mascot img', 'face-default');
  await nav('ホーム').click();
  await page.getByRole('button', { name: 'ライトモードに切替', exact: true }).click();
  check('All six transparent mascot assets, uncropped at wide/narrow sizes in both themes');

  await page.getByRole('button', { name: 'キャラクターやワールドを検索', exact: true }).click();
  await search.fill('灯');
  const before = page.url();
  await search.dispatchEvent('keydown', ime);
  assert.equal(page.url(), before);
  assert.equal(await search.inputValue(), '灯');
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true);
  }
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'キャラクターやワールドを検索');
  check('Search IME, Tab containment, Escape and focus return');

  await nav('ディスカバー').click();
  const query = page.getByRole('textbox', { name: 'キャラクターを検索' });
  await query.fill('灯');
  await page.getByRole('button', { name: '日常', exact: true }).click();
  assert.equal(await query.inputValue(), '灯');
  await page.reload();
  await query.waitFor();
  assert.equal(await query.inputValue(), '灯');
  await page.getByRole('link', { name: /灯（あかり）/ }).first().waitFor();
  check('Search survives mood filtering and reload');

  await nav('プロフィール').click();
  const name = page.getByRole('textbox', { name: '表示名', exact: true });
  await name.fill('UI確認の旅人');
  await name.dispatchEvent('keydown', ime);
  assert.equal(await name.evaluate(el => document.activeElement === el), true);
  assert.notEqual(await page.locator('.k-shell__profile-name').innerText(), 'UI確認の旅人');
  await page.keyboard.press('Tab');
  await page.getByRole('radio', { name: 'ダーク', exact: true }).click();
  await page.reload();
  await name.waitFor();
  assert.equal(await name.inputValue(), 'UI確認の旅人');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  check('Profile IME and saved name/theme');

  for (const width of [900, 1440]) {
    await desktop.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width);
    for (const label of ['ホーム', 'ディスカバー', 'チャット', 'クリエイト', 'プロフィール', 'スタジオ']) {
      assert.equal(await nav(label).getAttribute('title'), label);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  check('Narrow/wide navigation labels and page width');

  await nav('ディスカバー').click();
  await page.getByRole('link', { name: /灯（あかり）/ }).first().click();
  await page.getByRole('button', { name: '会話をはじめる', exact: true }).click();
  await page.locator('.k-composer__input:not([disabled])').waitFor();
  const composer = page.getByRole('textbox', { name: 'メッセージ', exact: true });
  await composer.fill('送信しない下書き');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('second line');
  const draft = await composer.inputValue();
  assert.match(draft, /\nsecond line$/);
  await page.reload();
  await page.locator('.k-composer__input:not([disabled])').waitFor();
  assert.equal(await composer.inputValue(), draft);
  check('Chat draft newline and reload without sending');

  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
  await page.getByRole('button', { name: 'キャラ・プリセット', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="会話モデル"]')?.options.length > 3);
  const sheet = page.locator('.k-sheet[aria-modal=true]');
  assert.deepEqual(await sheet.evaluate(el => Array.from(el.querySelectorAll('fieldset, select, .k-chat-model-choice > div')).filter(x => x.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map(x => x.tagName)), []);
  await page.keyboard.press('Control+k');
  await search.waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true);
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await sheet.count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await sheet.count(), 0);
  check('Settings width and only the top modal closes');

  await page.getByRole('button', { name: '削除', exact: true }).first().click();
  await page.locator('dialog[open]').waitFor();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true);
  }
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '削除', exact: true }).count(), 1);
  assert.deepEqual(await desktop.evaluate(() => globalThis.uiBlockedRequests), []);
  assert.deepEqual(errors, []);
  check('Confirmation cancellation preserves the greeting; zero inference attempts');
  await screenshot('chat-dark-900.png');
}

main().catch(async error => {
  errors.push(error.stack);
  console.error(error.message);
  process.exitCode = 1;
  if (page) await screenshot('failure.png').catch(() => {});
}).finally(async () => {
  if (desktop) await desktop.close();
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ checks, errors, exit_code: process.exitCode ?? 0 }, null, 2));
  console.log(`Evidence: ${output}`);
});
