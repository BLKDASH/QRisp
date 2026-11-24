'use strict';

importScripts('qr-input.js');

const MENU_ID = 'selection-qr';
const POPUP_URL = chrome.runtime.getURL('popup.html');
const POPUP_TTL_MS = 5_000;
const WINDOW_TTL_MS = 30_000;
const pendingSelections = new Map();

function createSelectionMenu() {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '使用QRisp生成二维码',
    contexts: ['selection']
  });
}

// Split incognito profiles get a fresh worker and menu store each session.
if (chrome.extension.inIncognitoContext) {
  self.addEventListener('install', createSelectionMenu);
} else {
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install' || reason === 'update') createSelectionMenu();
  });
}

function windowKey(windowId) {
  return `window:${windowId}`;
}

function forgetSelection(key) {
  clearTimeout(pendingSelections.get(key)?.timer);
  pendingSelections.delete(key);
}

function rememberSelection(key, payload, ttl) {
  forgetSelection(key);
  pendingSelections.set(key, {
    payload,
    timer: setTimeout(() => forgetSelection(key), ttl)
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || typeof info.selectionText !== 'string') return;

  const text = info.selectionText;
  const error = validateQrText(text);
  const payload = error ? { error } : { text };
  const windowId = tab?.windowId;

  if (Number.isInteger(windowId) && windowId >= 0 && typeof chrome.action?.openPopup === 'function') {
    const key = windowKey(windowId);
    rememberSelection(key, payload, POPUP_TTL_MS);
    try {
      await chrome.action.openPopup({ windowId });
      return;
    } catch {
      forgetSelection(key);
    }
  }

  const url = POPUP_URL + '?selection=' + crypto.randomUUID();
  // A preview can load before windows.create settles, or close before it claims the text.
  rememberSelection(url, payload, WINDOW_TTL_MS);
  try {
    await chrome.windows.create({
      url, type: 'popup', width: 400, height: 530, incognito: tab?.incognito
    });
  } catch {
    forgetSelection(url);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  let key;
  if (message === 'take-selection' && typeof sender.url === 'string' && sender.url.startsWith(POPUP_URL + '?selection=')) {
    key = sender.url;
  } else if (
    message?.type === 'take-selection' &&
    sender.url === POPUP_URL &&
    Number.isInteger(message.windowId) &&
    message.windowId >= 0
  ) {
    key = windowKey(message.windowId);
  } else {
    return;
  }

  const entry = pendingSelections.get(key);
  if (!entry) return;
  forgetSelection(key);
  sendResponse(entry.payload);
});
