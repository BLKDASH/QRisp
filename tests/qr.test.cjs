const assert = require('node:assert/strict');
require('../vendor/qr.js');
for (const text of ['https://example.com/', '你好，世界 🌈', 'Español café / 日本語 / العربية', 'line 1\nline 2', '   ', 'x'.repeat(1800)]) {
  const m = LocalQR.encode(text);
  assert.ok(m.length >= 21 && m.length <= 177);
  assert.equal((m.length - 17) % 4, 0);
  assert.ok(m.every(row => row.length === m.length && row.every(v => typeof v === 'boolean')));
  assert.deepEqual(m, LocalQR.encode(text));
}
assert.notDeepEqual(LocalQR.encode('你好'), LocalQR.encode('世界'));
assert.notDeepEqual(LocalQR.encode('😀'), LocalQR.encode('😁'));
assert.throws(() => LocalQR.encode('x'.repeat(10000)));
console.log('PASS: 6 matrix/determinism cases; Unicode distinction; overflow rejection.');
