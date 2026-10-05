// Composes the App Store artwork: compose.html (branded background, headline, tilted device with a raw
// capture inside) rendered by headless Chrome at Apple's exact sizes.
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const DIR = __dirname, RAW = process.env.RAW_DIR ? path.resolve(process.env.RAW_DIR) : path.join(DIR, 'raw'), OUT = path.join(DIR, 'final'), PORT = 9334;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SLIDES = [
  { n: 1, shot: '1-arena', side: 'right', eyebrow: 'Live arena', h1: 'Absorb everything smaller.|*Divide to strike.*', sub: 'Ten-minute rounds in a closing arena, against players and bots.', chips: 'Live rounds|Closing arena|Placement' },
  { n: 2, shot: '6-results', side: 'left', eyebrow: 'Ranked play', h1: 'Place every round.|*Climb to Legend.*', sub: 'Survive longer and place higher to raise your rating. Two lives a round. Dying fast costs you.', chips: 'Silver → Legend|Win bonus|Two lives' },
  { n: 3, shot: '3-shop', side: 'right', eyebrow: 'Skins & ATP', h1: 'Twelve skins.|*Earn or buy them.*', sub: 'ATP comes from surviving and absorbing. Packs are there when you want a shortcut.', chips: 'Nebula|Black Hole|One Cell to Rule Them All' },
  { n: 4, shot: '4-profile', side: 'left', eyebrow: 'Your account', h1: 'Your rating|*follows you.*', sub: 'Sign in with Apple and keep ATP, skins and rank on any phone.', chips: 'Sign in with Apple|Profile|Stats' },
  { n: 5, shot: '5-events', side: 'right', eyebrow: 'A living world', h1: 'Phages, blooms, tides|*and the Leviathan.*', sub: 'Evolve six times a life. Dodge hunters. Take the leader’s bounty.', chips: 'Evolve|World events|Bounties' },
];
const SIZES = { iphone69: { w: 2868, h: 1320, kind: 'phone', raw: 'iphone69' }, ipad13: { w: 2752, h: 2064, kind: 'tablet', raw: 'ipad13' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(url, opts) { const r = await fetch(url, opts); return r.json(); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waits = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && this.waits.has(m.id)) { const { res, rej } = this.waits.get(m.id); this.waits.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.waits.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(DIR, 'chrome-compose'); fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,1100'], { stdio: 'ignore' });
  try {
    let version = null;
    for (let i = 0; i < 50 && !version; i++) { try { version = await json(`http://127.0.0.1:${PORT}/json/version`); } catch (e) { await sleep(200); } }
    if (!version) throw new Error('Chrome did not start');
    for (const [sizeName, s] of Object.entries(SIZES)) {
      for (const sl of SLIDES) {
        const img = path.join(RAW, `${s.raw}-${sl.shot}.png`);
        if (!fs.existsSync(img)) { console.log('missing raw capture', img); continue; }
        const target = await json(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const cdp = new CDP(ws);
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
        const params = new URLSearchParams({ w: s.w, h: s.h, kind: s.kind, side: sl.side, eyebrow: sl.eyebrow, h1: sl.h1, sub: sl.sub, chips: sl.chips, img: 'file://' + img });
        await cdp.send('Page.navigate', { url: 'file://' + path.join(DIR, 'compose.html') + '?' + params.toString() });
        await sleep(800);
        await cdp.eval('window.__ready');
        await sleep(300);
        const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = path.join(OUT, `${sizeName}-${sl.n}.png`);
        fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
        console.log('wrote', path.basename(file));
        ws.close(); await json(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
      }
    }
  } finally { chrome.kill('SIGKILL'); }
})().catch(e => { console.error('compose failed:', e.message); process.exit(1); });
