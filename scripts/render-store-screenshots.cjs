'use strict';

// Re-render the store screenshots from the current popup source, using demo data.
// Run: node scripts/render-store-screenshots.cjs [--out-dir PATH] [--browser PATH]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return args[index + 1];
}
const output = path.resolve(option('--out-dir', path.join(root, 'store-listing')));
const browser = option('--browser', process.env.QRISP_BROWSER_PATH) || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(candidate => fs.existsSync(candidate));
if (!browser) throw new Error('Pass the Chrome or Edge executable with --browser PATH.');

const asset = name => pathToFileURL(path.join(root, name)).href;
const demo = '周六 10:00\n在书店门口见';
const shots = [
  {
    name: 'screenshot-01-page.png', mode: 'page', label: '当前页面',
    title: '电脑上的网页，<br>手机扫码打开',
    description: '打开 QRisp，自动为当前网址生成二维码。',
  },
  {
    name: 'screenshot-02-custom.png', mode: 'custom', label: '自定义内容',
    title: '输入文字，<br>实时生成二维码',
    description: '支持网址、中文、Emoji 和换行。<br>生成后可复制二维码图片。',
  },
  {
    name: 'screenshot-03-formats.png', mode: 'formats', label: '图片下载',
    title: '按需保存，<br>三种图片格式',
    description: '默认下载 PNG，也可选择 JPG 或 SVG。',
  },
];

const popupSource = fs.readFileSync(path.join(root, 'popup.html'), 'utf8')
  .replace('href="popup.css"', `href="${asset('popup.css')}"`)
  .replace('src="vendor/qr.js"', `src="${asset('vendor/qr.js')}"`)
  .replace('src="qr-input.js"', `src="${asset('qr-input.js')}"`)
  .replace('src="popup.js"', `src="${asset('popup.js')}"`);
if (/<header\b/i.test(popupSource)) {
  throw new Error('The popup still has a header; check the screenshot layout before exporting.');
}

function popupHtml(shot) {
  // This fixture only exists in the temporary rendering document, never the extension.
  const fixture = `<script>
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
      tabs: { async query() { return [{ url: 'https://example.com/', title: '示例网页' }]; } }
    }});
  </script>`;
  const setup = `<script>
    addEventListener('load', async () => {
      await document.fonts.ready;
      if (${JSON.stringify(shot.mode)} !== 'page') {
        document.getElementById('custom-tab').click();
        const input = document.getElementById('content');
        input.value = ${JSON.stringify(demo)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
      }
      if (${JSON.stringify(shot.mode)} === 'formats') {
        document.getElementById('download-format').click();
      }
      document.documentElement.dataset.screenshotReady = 'true';
    });
  </script>`;
  return popupSource.replace('<head>', `<head>${fixture}`).replace('</body>', `${setup}</body>`);
}

function documentHtml(shot, index) {
  const frame = JSON.stringify(popupHtml(shot)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QRisp 商店截图 ${index + 1}</title>
  <style>
    @font-face { font-family: StoreUI; src: url("${asset('assets/noto-ui-regular.woff')}"); font-weight: 400; }
    @font-face { font-family: StoreUI; src: url("${asset('assets/noto-ui-bold.woff')}"); font-weight: 700; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
    body {
      position: relative; color: #132b50;
      background: linear-gradient(105deg, #f5f7ff 0%, #edf4ff 49%, #dfeeff 100%);
      font: 400 26px/40px StoreUI, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .brand { position: absolute; left: 88px; top: 76px; display: flex; align-items: center; gap: 13px; }
    .brand img { display: block; width: 52px; height: 52px; }
    .brand span { font-size: 34px; line-height: 52px; font-weight: 700; }
    .divider { position: absolute; left: 88px; top: 164px; width: 530px; height: 1px; background: #d0e1fc; }
    .label { position: absolute; left: 88px; top: 238px; margin: 0; color: #0b57d0; font-size: 24px; line-height: 36px; font-weight: 700; }
    h1 { position: absolute; left: 88px; top: 285px; margin: 0; font-size: 60px; line-height: 76px; font-weight: 700; letter-spacing: -1px; }
    .description { position: absolute; left: 88px; top: 486px; margin: 0; color: #496589; }
    .pagination { position: absolute; left: 89px; top: 704px; display: flex; gap: 10px; }
    .pagination span { width: 26px; height: 5px; border-radius: 8px; background: #c7d9f3; }
    .pagination .active { background: #2b6de8; }
    .counter { position: absolute; left: 204px; top: 694px; color: #496589; font: 14px/24px Consolas, monospace; }
    .dots { position: absolute; left: 696px; top: 8px; width: 584px; height: 780px; background: radial-gradient(circle, #b9d4f5 0.8px, transparent 0.9px) 0 0 / 28px 28px; }
    .ring { position: absolute; border: 1px solid #bbd4fa; }
    .ring.one { left: 683px; top: 44px; width: 554px; height: 712px; border-radius: 70px; }
    .ring.two { left: 708px; top: 69px; width: 504px; height: 662px; border-radius: 64px; }
    .ring.three { left: 733px; top: 94px; width: 454px; height: 612px; border-radius: 58px; }
    .accent { position: absolute; width: 14px; height: 14px; border-radius: 4px; }
    .accent.one { left: 680px; top: 215px; background: #79a7f6; }
    .accent.two { left: 1205px; top: 630px; background: #9ab9ef; }
    .accent.three { left: 693px; top: 687px; background: #c4dafa; }
    .popup { position: absolute; left: 753px; top: 120px; width: 422px; height: 562px; overflow: hidden; border: 1px solid #a8c7fa; border-radius: 26px; background: white; box-shadow: 0 24px 50px #244a7940; }
    iframe { display: block; width: 360px; height: 480px; border: 0; transform: scale(calc(7 / 6)); transform-origin: top left; }
  </style>
</head>
<body>
  <div class="brand"><img src="${asset('assets/logo.svg')}" alt=""><span>QRisp</span></div>
  <div class="divider"></div>
  <p class="label">${shot.label}</p>
  <h1>${shot.title}</h1>
  <p class="description">${shot.description}</p>
  <div class="pagination">${shots.map((_, i) => `<span class="${i === index ? 'active' : ''}"></span>`).join('')}</div>
  <span class="counter">0${index + 1} / 03</span>
  <div class="dots"></div>
  <div class="ring one"></div><div class="ring two"></div><div class="ring three"></div>
  <div class="accent one"></div><div class="accent two"></div><div class="accent three"></div>
  <div class="popup"><iframe title="当前扩展弹窗" scrolling="no"></iframe></div>
  <script>document.querySelector('iframe').srcdoc = ${frame};</script>
</body>
</html>`;
}

fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qrisp-store-'));
try {
  for (const [index, shot] of shots.entries()) {
    const htmlPath = path.join(scratch, `screenshot-${index + 1}.html`);
    const pngPath = path.join(scratch, shot.name);
    fs.writeFileSync(htmlPath, documentHtml(shot, index));
    const result = spawnSync(browser, [
      '--headless=new', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--allow-file-access-from-files', '--hide-scrollbars',
      '--force-device-scale-factor=1', '--window-size=1280,800',
      '--virtual-time-budget=2500', '--run-all-compositor-stages-before-draw',
      `--user-data-dir=${path.join(scratch, `profile-${index + 1}`)}`,
      `--screenshot=${pngPath}`, pathToFileURL(htmlPath).href,
    ], { windowsHide: true, timeout: 30000, encoding: 'utf8' });
    if (result.error || result.status !== 0 || !fs.existsSync(pngPath)) {
      throw new Error(`Rendering ${shot.name} failed: ${result.error?.message || result.stderr}`);
    }
    const png = fs.readFileSync(pngPath);
    if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
        png.readUInt32BE(16) !== 1280 || png.readUInt32BE(20) !== 800) {
      throw new Error(`Unexpected image format or dimensions: ${shot.name}`);
    }
    fs.copyFileSync(pngPath, path.join(output, shot.name));
    console.log(`Rendered ${shot.name} (1280 x 800)`);
  }
} finally {
  // Chromium may briefly hold profile files after its headless process exits.
  const resolvedScratch = fs.realpathSync(scratch);
  if (path.dirname(resolvedScratch) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(resolvedScratch).startsWith('qrisp-store-')) {
    throw new Error('Refusing to remove a directory outside the screenshot scratch folder.');
  }
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
