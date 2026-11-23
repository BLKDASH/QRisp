const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const getURL = file => `chrome-extension://${extensionId}/${file}`;
const menuId = 'selection-qr';

function mockEvent() {
  let listener;
  return {
    addListener(handler) { listener = handler; },
    fire(...args) { return listener?.(...args); }
  };
}

function loadWorker(incognito = false) {
  const menus = [];
  const windows = [];
  const timers = new Map();
  let timerId = 0;
  let rejectWindow = false;
  const onInstalled = mockEvent();
  const install = mockEvent();
  const onClicked = mockEvent();
  const onMessage = mockEvent();
  const chrome = {
    extension: { inIncognitoContext: incognito },
    runtime: { id: extensionId, getURL, onInstalled, onMessage },
    contextMenus: { onClicked, create: options => menus.push(options) },
    windows: {
      async create(options) {
        windows.push(options);
        if (rejectWindow) throw new Error('Window creation failed');
        return { id: windows.length };
      }
    }
  };
  function load(file) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  const context = vm.createContext({
    chrome, crypto: { randomUUID }, URL, TextEncoder, importScripts: load,
    self: { addEventListener(type, callback) {
      assert.equal(type, 'install');
      install.addListener(callback);
    } },
    setTimeout(callback, delay) {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: id => timers.delete(id)
  });
  load('background.js');

  return {
    menus, windows, install, onInstalled,
    click(text, { id = menuId, incognito = false } = {}) {
      return onClicked.fire({ menuItemId: id, selectionText: text }, { id: 1, windowId: 1, incognito });
    },
    take(url, message = 'take-selection', id = extensionId) {
      let reply;
      onMessage.fire(message, { id, url }, value => { reply = value; });
      return reply;
    },
    failWindow() { rejectWindow = true; },
    expireHandoffs() {
      assert.ok(timers.size > 0, 'The original text must expire if the preview never opens');
      for (const { callback, delay } of [...timers.values()]) {
        assert.ok(Number.isFinite(delay) && delay > 0);
        callback();
      }
      timers.clear();
    }
  };
}

test('installs a selection-only menu and opens a preview without text in the URL', async () => {
  const worker = loadWorker();
  assert.equal(worker.menus.length, 0);
  await worker.install.fire();
  await worker.onInstalled.fire({ reason: 'install' });
  await worker.onInstalled.fire({ reason: 'chrome_update' });
  assert.equal(worker.menus.length, 1);
  const [menu] = worker.menus;
  assert.equal(menu.id, menuId);
  assert.deepEqual(Array.from(menu.contexts), ['selection']);
  assert.equal(menu.title, '使用QRisp生成二维码');
  assert.ok(!menu.title.includes('%s'));

  const text = '选中的私密文字?secret=#42 🦊';
  await worker.click(text, { id: 'another-menu' });
  await worker.click(undefined);
  assert.equal(worker.windows.length, 0);
  await worker.click(text);
  const [preview] = worker.windows;
  assert.equal(preview.type, 'popup');
  assert.equal(preview.incognito, false);
  const url = new URL(preview.url);
  const token = url.searchParams.get('selection');
  assert.match(token, /^[0-9a-f-]{36}$/i);
  assert.equal(preview.url, getURL('popup.html') + '?selection=' + token);
  assert.ok(!JSON.stringify(preview).includes(text));
  assert.equal(worker.take(preview.url).text, text);
});

test('a fresh split incognito session registers the menu without an extension update', async () => {
  const worker = loadWorker(true);
  assert.equal(worker.menus.length, 0);
  await worker.install.fire();
  assert.equal(worker.menus.length, 1);
  assert.equal(worker.menus[0].id, menuId);
  await worker.click('无痕窗口内的选区', { incognito: true });
  const [preview] = worker.windows;
  assert.equal(preview.incognito, true);
  assert.equal(worker.take(preview.url).text, '无痕窗口内的选区');
});

test('independent clicks hand off exact text once, even when previews open in reverse order', async () => {
  const worker = loadWorker();
  const first = '  第一行\n第二行 😀  ';
  const second = 'https://example.test/?token=<>&秘密';
  const opening = Promise.all([worker.click(first), worker.click(second)]);
  const [a, b] = worker.windows;
  assert.notEqual(a.url, b.url);
  assert.equal(a.incognito, false);
  assert.equal(worker.take(b.url).text, second);
  assert.equal(worker.take(b.url)?.text, undefined);
  assert.equal(worker.take(a.url).text, first);
  assert.equal(worker.take(a.url)?.text, undefined);
  await opening;
});

test('other senders, pages and message types cannot claim or consume the selection', async () => {
  const worker = loadWorker();
  await worker.click('仅限于对应预览');
  const { url } = worker.windows[0];
  assert.equal(worker.take(url, 'other-message')?.text, undefined);
  assert.equal(worker.take(url, 'take-selection', 'other-extension')?.text, undefined);
  assert.equal(worker.take(url.replace(getURL(''), 'https://example.test/'))?.text, undefined);
  assert.equal(worker.take(url.replace('popup.html', 'other.html'))?.text, undefined);
  assert.equal(worker.take(url + '&extra=1')?.text, undefined);
  assert.equal(worker.take(url).text, '仅限于对应预览');
});

test('failed and expired previews discard the pending selection', async () => {
  const failed = loadWorker();
  failed.failWindow();
  await failed.click('创建失败时清理');
  assert.equal(failed.take(failed.windows[0].url)?.text, undefined);

  const expired = loadWorker();
  await expired.click('超时即清理');
  expired.expireHandoffs();
  assert.equal(expired.take(expired.windows[0].url)?.text, undefined);
});

test('over-capacity selections deliver an error without returning any original text', async () => {
  const worker = loadWorker();
  for (const text of ['a'.repeat(100_000), '中'.repeat(777)]) {
    await worker.click(text);
    const reply = worker.take(worker.windows.at(-1).url);
    assert.equal(typeof reply.error, 'string');
    assert.ok(reply.error.length > 0);
    assert.equal(reply.text, undefined);
    assert.ok(!JSON.stringify(reply).includes(text));
  }
});
