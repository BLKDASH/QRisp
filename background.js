'use strict';

importScripts('qr-input.js');

const MENU_ID = 'selection-qr';
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

function forgetSelection(url) {
  clearTimeout(pendingSelections.get(url)?.timer);
  pendingSelections.delete(url);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || typeof info.selectionText !== 'string') return;

  const text = info.selectionText;
  const error = validateQrText(text);
  const url = chrome.runtime.getURL('popup.html') + '?selection=' + crypto.randomUUID();
  // A preview can load before windows.create settles, or close before it claims the text.
  pendingSelections.set(url, {
    payload: error ? { error } : { text },
    timer: setTimeout(() => forgetSelection(url), 30_000)
  });

  try {
    await chrome.windows.create({
      url, type: 'popup', width: 400, height: 530, incognito: tab?.incognito
    });
  } catch {
    forgetSelection(url);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message !== 'take-selection' || sender.id !== chrome.runtime.id) return;
  const entry = pendingSelections.get(sender.url);
  if (!entry) return;
  forgetSelection(sender.url);
  sendResponse(entry.payload);
});
