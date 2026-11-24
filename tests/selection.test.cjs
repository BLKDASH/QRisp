const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const getURL = file => `chrome-extension://${extensionId}/${file}`;
const popupUrl = getURL('popup.html');
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
  const popups = [];
  const windows = [];
  const timers = new Map();
  let timerId = 0;
  let rejectPopup = false;
  let rejectWindow = false;
  const onInstalled = mockEvent();
  const install = mockEvent();
  const onClicked = mockEvent();
  const onMessage = mockEvent();
  const chrome = {
    extension: { inIncognitoContext: incognito },
    runtime: { id: extensionId, getURL, onInstalled, onMessage },
    contextMenus: { onClicked, create: options => menus.push(options) },
    action: {
      async openPopup(options) {
        popups.push({ ...options });
        if (rejectPopup) throw new Error('Toolbar popup unavailable');
      }
    },
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
    menus, popups, windows, timers, install, onInstalled,
    click(text, { id = menuId, windowId = 1, incognito = false } = {}) {
      return onClicked.fire({ menuItemId: id, selectionText: text }, { id: 1, windowId, incognito });
    },
    takePopup(windowId = 1, { url = popupUrl, message = { type: 'take-selection', windowId }, id = extensionId } = {}) {
      let reply;
      onMessage.fire(message, { id, url }, value => { reply = value; });
      return reply;
    },
    takeWindow(url, message = 'take-selection', id = extensionId) {
      let reply;
      onMessage.fire(message, { id, url }, value => { reply = value; });
      return reply;
    },
    failPopup() { rejectPopup = true; },
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

test('installs a selection-only menu and opens the toolbar popup first', async () => {
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
  assert.equal(worker.popups.length, 0);
  assert.equal(worker.windows.length, 0);

  await worker.click(text, { windowId: 7 });
  assert.deepEqual(worker.popups, [{ windowId: 7 }]);
  assert.equal(worker.windows.length, 0);
  assert.ok(!JSON.stringify(worker.popups).includes(text));
  assert.equal(worker.takePopup(7).text, text);
  assert.equal(worker.takePopup(7)?.text, undefined);
});

test('a fresh split incognito session registers the menu and targets the incognito window popup', async () => {
  const worker = loadWorker(true);
  assert.equal(worker.menus.length, 0);
  await worker.install.fire();
  assert.equal(worker.menus.length, 1);
  assert.equal(worker.menus[0].id, menuId);
  await worker.click('无痕窗口内的选区', { windowId: 9, incognito: true });
  assert.deepEqual(worker.popups, [{ windowId: 9 }]);
  assert.equal(worker.windows.length, 0);
  assert.equal(worker.takePopup(9).text, '无痕窗口内的选区');
});

test('independent window clicks hand off exact text once, and repeated clicks in one window replace stale text', async () => {
  const worker = loadWorker();
  const first = '  第一行\n第二行 😀  ';
  const second = 'https://example.test/?token=<>&秘密';
  const opening = Promise.all([
    worker.click(first, { windowId: 1 }),
    worker.click(second, { windowId: 2 })
  ]);
  assert.deepEqual(worker.popups, [{ windowId: 1 }, { windowId: 2 }]);
  assert.equal(worker.takePopup(2).text, second);
  assert.equal(worker.takePopup(2)?.text, undefined);
  assert.equal(worker.takePopup(1).text, first);
  assert.equal(worker.takePopup(1)?.text, undefined);
  await opening;

  await worker.click('旧选区', { windowId: 3 });
  await worker.click('新选区', { windowId: 3 });
  assert.equal(worker.timers.size, 1);
  assert.equal(worker.takePopup(3).text, '新选区');
  assert.equal(worker.timers.size, 0);
});

test('other senders, pages, windows and message types cannot claim or consume the selection', async () => {
  const worker = loadWorker();
  await worker.click('仅限于对应窗口弹窗', { windowId: 4 });
  assert.equal(worker.takePopup(4, { message: 'other-message' })?.text, undefined);
  assert.equal(worker.takePopup(4, { message: 'take-selection' })?.text, undefined);
  assert.equal(worker.takePopup(4, { id: 'other-extension' })?.text, undefined);
  assert.equal(worker.takePopup(4, { url: 'https://example.test/popup.html' })?.text, undefined);
  assert.equal(worker.takePopup(4, { url: getURL('other.html') })?.text, undefined);
  assert.equal(worker.takePopup(4, { url: popupUrl + '?selection=fake' })?.text, undefined);
  assert.equal(worker.takePopup(5)?.text, undefined);
  assert.equal(worker.takePopup(-1)?.text, undefined);
  assert.equal(worker.takeWindow('window:4')?.text, undefined);
  assert.equal(worker.takePopup(4).text, '仅限于对应窗口弹窗');
});

test('falls back to a standalone popup window when toolbar openPopup fails or windowId is unavailable', async () => {
  const worker = loadWorker();
  worker.failPopup();
  const text = 'PWA 无工具栏窗口内的选区';
  await worker.click(text, { windowId: 2, incognito: true });
  assert.deepEqual(worker.popups, [{ windowId: 2 }]);
  assert.equal(worker.takePopup(2)?.text, undefined);

  assert.equal(worker.windows.length, 1);
  const [preview] = worker.windows;
  assert.equal(preview.type, 'popup');
  assert.equal(preview.incognito, true);
  const url = new URL(preview.url);
  const token = url.searchParams.get('selection');
  assert.match(token, /^[0-9a-f-]{36}$/i);
  assert.equal(preview.url, popupUrl + '?selection=' + token);
  assert.ok(!JSON.stringify(preview).includes(text));
  assert.equal(worker.takeWindow(preview.url + '&extra=1')?.text, undefined);
  assert.equal(worker.takeWindow(preview.url).text, text);
  assert.equal(worker.takeWindow(preview.url)?.text, undefined);

  await worker.click('缺少窗口编号时回退', { windowId: -1 });
  assert.equal(worker.windows.length, 2);
  assert.equal(worker.takeWindow(worker.windows[1].url).text, '缺少窗口编号时回退');
});

test('failed fallback windows and expired handoffs discard the pending selection', async () => {
  const failed = loadWorker();
  failed.failPopup();
  failed.failWindow();
  await failed.click('创建失败时清理');
  assert.equal(failed.timers.size, 0);
  assert.equal(failed.takePopup(1)?.text, undefined);
  assert.equal(failed.takeWindow(failed.windows[0].url)?.text, undefined);

  const expiredPopup = loadWorker();
  await expiredPopup.click('气泡超时即清理');
  expiredPopup.expireHandoffs();
  assert.equal(expiredPopup.takePopup(1)?.text, undefined);

  const expiredWindow = loadWorker();
  expiredWindow.failPopup();
  await expiredWindow.click('小窗超时即清理');
  expiredWindow.expireHandoffs();
  assert.equal(expiredWindow.takeWindow(expiredWindow.windows[0].url)?.text, undefined);
});

test('over-capacity selections deliver an error without returning any original text', async () => {
  const worker = loadWorker();
  for (const text of ['a'.repeat(100_000), '中'.repeat(777)]) {
    await worker.click(text, { windowId: 1 });
    const reply = worker.takePopup(1);
    assert.equal(typeof reply.error, 'string');
    assert.ok(reply.error.length > 0);
    assert.equal(reply.text, undefined);
    assert.ok(!JSON.stringify(reply).includes(text));
  }
});
