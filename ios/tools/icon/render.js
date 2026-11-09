// Renders the Mitosis app icon (king.html) into every place the app and site use it:
//   iOS     ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png  (opaque RGB; Xcode makes the other sizes)
//   Android android/app/src/main/res/mipmap-*/ic_launcher_{background,foreground}.png  (adaptive icon layers, 108 dp)
//           android/app/src/main/ic_launcher-playstore.png  (512, for the Play listing)
//   Site    site/assets/icon-192.png, icon-512.png
// Run from anywhere:  node ios/tools/icon/render.js
// Needs Google Chrome (headless, over the DevTools protocol) and Node 22+ (built-in fetch and WebSocket).
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- PNG encoder: colour type 2 (RGB, no alpha channel, as App Store icons must be) or 6 (RGBA) ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4), t = Buffer.from(type), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
function png(rgba, n, alpha) {
  const ch = alpha ? 4 : 3, raw = Buffer.alloc((n * ch + 1) * n);
  for (let y = 0; y < n; y++) { raw[y * (n * ch + 1)] = 0; for (let x = 0; x < n; x++) { const i = (y * n + x) * 4, o = y * (n * ch + 1) + 1 + x * ch; raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; if (alpha) raw[o + 3] = rgba[i + 3]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Android adaptive icon: 108 dp layers; everything that matters sits inside the 66 dp safe circle, so the foreground is scaled down.
const ANDROID = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }, FG_SCALE = .68;
const JOBS = [
  { out: 'ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png', part: 'full', n: 1024 },
  { out: 'android/app/src/main/ic_launcher-playstore.png', part: 'full', n: 512 },
  { out: 'site/assets/icon-512.png', part: 'full', n: 512 },
  { out: 'site/assets/icon-192.png', part: 'full', n: 192 },
  ...Object.entries(ANDROID).flatMap(([d, k]) => [
    { out: `android/app/src/main/res/mipmap-${d}/ic_launcher_background.png`, part: 'bg', n: 108 * k },
    { out: `android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, part: 'fg', n: 108 * k, alpha: true, opt: { fgScale: FG_SCALE } },
  ]),
];

(async () => {
  const PORT = 9500 + Math.floor(Math.random() * 100), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-icon-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });
  try {
    let v = null; for (let i = 0; i < 60 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch (e) { await sleep(200); } }
    if (!v) throw new Error('Chrome did not start (set CHROME to its path)');
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const wait = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { const { res, rej } = wait.get(m.id); wait.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; wait.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await send('Page.enable'); await send('Page.navigate', { url: 'file://' + path.join(__dirname, 'king.html') }); await sleep(1000);
    for (const j of JOBS) {
      const rgba = Buffer.from(await evaluate(`pixels(${JSON.stringify(j.part)}, ${j.n}, ${JSON.stringify(j.opt || {})})`), 'base64');
      const file = path.join(ROOT, j.out); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, png(rgba, j.n, !!j.alpha));
      console.log(`${j.out}  ${j.n}px ${j.alpha ? 'RGBA' : 'RGB'}`);
    }
    ws.close();
  } finally { chrome.kill('SIGKILL'); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300); }
})().catch(e => { console.error('icon render failed:', e.message); process.exit(1); });
