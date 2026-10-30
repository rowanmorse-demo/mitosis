// Headless screenshot of a page in Chrome, for checking UI changes without a phone.
// node tools/snap.js URL OUT.png [--w=430 --h=860 --dpr=2 --mobile --wait=3000 --until='js expr' --untilMax=ms --js='js before capture' --after=ms --intro --ls=json]
// --mobile emulates a touch phone; --intro keeps the first-launch welcome card; --ls='{"key":"value"}' presets localStorage. Page exceptions are printed.
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node tools/snap.js URL OUT.png [options]'); process.exit(2); }
const opt = Object.fromEntries(rest.map(a => { const m = a.match(/^--(\w+)(?:=([\s\S]*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const W = +(opt.w || 430), H = +(opt.h || 860), DPR = +(opt.dpr || 2), PORT = 9340 + Math.floor(Math.random() * 50);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(u, o) { const r = await fetch(u, o); return r.json(); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.w = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; console.log('PAGE EXCEPTION:', ((d.exception && d.exception.description) || d.text || '').split('\n').slice(0, 4).join(' | ')); }
    if (m.id && this.w.has(m.id)) { const { res, rej } = this.w.get(m.id); this.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.w.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page error: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; }
}
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,1100'], { stdio: 'ignore' });
  try {
    let v = null; for (let i = 0; i < 50 && !v; i++) { try { v = await json(`http://127.0.0.1:${PORT}/json/version`); } catch (e) { await sleep(200); } }
    if (!v) throw new Error('Chrome did not start');
    const t = await json(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: !!opt.mobile });
    if (opt.mobile) { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] }); }
    if (!opt.intro) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('mitosis.intro','1')}catch(e){}" });
    if (opt.ls) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{const o=${opt.ls};for(const k in o)localStorage.setItem(k,o[k])}catch(e){}` });
    await cdp.send('Page.navigate', { url }); await sleep(+(opt.wait || 3000));
    if (opt.until) { const t0 = Date.now(); while (Date.now() - t0 < +(opt.untilMax || 120000) && !(await cdp.eval(opt.until))) await sleep(300); }
    if (opt.js) { const r = await cdp.eval(opt.js); console.log('js:', JSON.stringify(r)); await sleep(+(opt.after || 500)); }
    const png = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(out, Buffer.from(png.data, 'base64')); console.log('wrote', path.basename(out));
    ws.close(); await json(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
  } finally { chrome.kill('SIGKILL'); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300); }
})().catch(e => { console.error('snap failed:', e.message); process.exit(1); });
