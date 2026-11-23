'use strict';

const MAX_CHARS = 1000;
const MAX_BYTES = 2330;
const qrTextEncoder = new TextEncoder();

function validateQrText(text, mode = 'custom') {
  // A Unicode code point occupies at most two UTF-16 code units.
  if (mode === 'custom' && text.length > MAX_CHARS &&
      (text.length > 2 * MAX_CHARS || [...text].length > MAX_CHARS)) {
    return '内容过长，请缩短文字或链接。';
  }
  if (text.length > MAX_BYTES || qrTextEncoder.encode(text).length > MAX_BYTES) {
    return '内容超过二维码容量，请缩短文字或链接。';
  }
  return '';
}
