// App Store screenshots: drives headless Chrome over the DevTools protocol, loads the real game from
// the local server, puts it in each state, adds a caption band and captures at Apple's exact sizes.
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const DIR = __dirname, RAW = process.env.RAW === '1', OUT = path.join(DIR, RAW ? 'raw' : 'shots'), PORT = 9333;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:3000/';
const SIZES = {
  iphone69: { w: 956, h: 440, dpr: 3, cap: 30, sub: 13, pad: '14px 30px 16px', overlayPad: 92 },   // 2868×1320
  ipad13: { w: 1376, h: 1032, dpr: 2, cap: 44, sub: 19, pad: '22px 44px 26px', overlayPad: 130 }, // 2752×2064
};
const SHOTS_ALL = [
  { id: '1-arena', url: '?autopilot=1&big=1&tag=shot', wait: 16000, cap: 'Absorb everything smaller. Divide to strike.', sub: 'Live ten-minute rounds in a closing arena, against players and bots' },
  { id: '2-menu', url: '?tag=shot', wait: 3500, fix: `(()=>{document.getElementById('rankVal').textContent='1480';document.getElementById('rankTier').textContent='Gold';document.getElementById('nameIn').value='Volvox';const n=document.querySelector('#netLine span');if(n)n.textContent='Live · 6 others here';return 'ok'})()`, cap: 'Into a live arena in seconds', sub: 'Placement every round and a rating that climbs from Silver to Legend', card: true },
  { id: '3-shop', url: '?tag=shot', wait: 3500, click: 'shopBtn', fix: `(()=>{const prices={atp_500:'$0.99',atp_1500:'$1.99',atp_5000:'$4.99',atp_12000:'$9.99'};document.querySelectorAll('.pack').forEach(b=>{b.disabled=false;const pr=b.querySelector('.pr');if(pr)pr.textContent=prices[b.dataset.id]||'';});const h=document.getElementById('storeHint');if(h)h.textContent='Purchases go through the App Store.';document.getElementById('storeBal').textContent='2,350';return 'ok'})()`, cap: 'Eleven skins to unlock with ATP', sub: 'Earn ATP by surviving and absorbing, or pick up a pack', card: true },
  { id: '4-profile', url: '?tag=shot', wait: 3500, click: 'profBtn', fix: `(()=>{document.getElementById('profName').textContent='Volvox';document.getElementById('pRating').textContent='1480';document.getElementById('pTier').textContent='Gold';document.getElementById('pAtp').textContent='2,350';document.getElementById('pEarned').textContent='4,120';document.getElementById('pRuns').textContent='38';document.getElementById('pSkins').textContent='3';document.getElementById('acctHint').hidden=true;document.getElementById('appleBtn').hidden=false;document.getElementById('acctWho').textContent='Not signed in. Sign in so your ATP, skins and rating follow you to any phone.';return 'ok'})()`, cap: 'Your rating follows you', sub: 'Sign in with Apple and keep ATP, skins and rank on any phone', card: true },
  { id: '5-events', url: '?autopilot=1&tag=shot', wait: 30000, cap: 'Phages, blooms, tides and the Leviathan', sub: 'Evolve six times a life, dodge hunters and take the leader\'s bounty' },
  { id: '6-results', url: '?autopilot=1&tag=shot', wait: 6000, until: "!document.getElementById('deathCard').hidden", fix: `(()=>{const g=id=>document.getElementById(id);g('deathWhy').textContent='Absorbed by Bacillus after 6:12.';g('dPlace').textContent='3rd of 61';g('dPlace').hidden=false;g('dPeak').textContent='2,806';g('dEaten').textContent='27';g('dTime').textContent='6:12';g('dBest').textContent='2,806';g('dEarn').hidden=false;g('dEarn').textContent='+6 ATP — top 3';g('dRank').hidden=false;g('dRank').innerHTML='Rating <b>+24</b> → <b>1504</b> · Gold';const a=g('dAch');a.hidden=false;a.textContent='Unlocked: Apex predator';return 'ok'})()`, cap: 'Placement every round', sub: 'Climb from Silver to Legend', card: true },
];
const SHOTS = process.env.ONLY ? SHOTS_ALL.filter(x => process.env.ONLY.split(',').includes(x.id)) : SHOTS_ALL;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function json(url, opts) { const r = await fetch(url, opts); return r.json(); }

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waits = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && this.waits.has(m.id)) { const { res, rej } = this.waits.get(m.id); this.waits.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.waits.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

const captionJs = (cap, sub, s, card) => `(() => {
  const d = document.createElement('div'); d.id = 'shotcap';
  d.innerHTML = '<b></b><span></span>'; d.querySelector('b').textContent = ${JSON.stringify(cap)}; d.querySelector('span').textContent = ${JSON.stringify(sub)};
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999;padding:${s.pad};background:linear-gradient(rgba(2,8,9,0),rgba(2,8,9,.94) 45%);display:grid;gap:5px;pointer-events:none';
  d.querySelector('b').style.cssText = "font:800 ${s.cap}px/1.05 'Bricolage Grotesque',system-ui,sans-serif;color:#dcefe9;letter-spacing:-.03em";
  d.querySelector('span').style.cssText = "font:500 ${s.sub}px/1.3 'IBM Plex Mono',ui-monospace,monospace;color:#9fc6bd";
  document.body.appendChild(d);
  const st = document.createElement('style'); st.textContent = '#toasts{display:none!important}' + (${card ? 'true' : 'false'} ? '#overlay{padding-bottom:${s.overlayPad}px!important}' : ''); document.head.appendChild(st);
  return 'ok';
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(DIR, 'chrome-shots'); fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,1100'], { stdio: 'ignore' });
  try {
    let version = null;
    for (let i = 0; i < 50 && !version; i++) { try { version = await json(`http://127.0.0.1:${PORT}/json/version`); } catch (e) { await sleep(200); } }
    if (!version) throw new Error('Chrome did not start');
    for (const [sizeName, s] of Object.entries(SIZES)) {
      for (const shot of SHOTS) {
        const target = await json(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        const cdp = new CDP(ws);
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: s.dpr, mobile: true });
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
        await cdp.send('Page.navigate', { url: BASE + shot.url });
        await sleep(shot.wait);
        if (shot.until) { const t0 = Date.now(); while (Date.now() - t0 < 110000 && !(await cdp.eval(shot.until))) await sleep(250); }
        if (shot.click) { await cdp.eval(`document.getElementById(${JSON.stringify(shot.click)}).click(); 'ok'`); await sleep(900); }
        if (shot.fix) { await cdp.eval(shot.fix); await sleep(300); }
        if (RAW) await cdp.eval("(()=>{const st=document.createElement('style');st.textContent='#toasts{display:none!important}';document.head.appendChild(st);return 'ok'})()");
        else await cdp.eval(captionJs(shot.cap, shot.sub, s, !!shot.card));
        await sleep(RAW ? 150 : 400);
        const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const file = path.join(OUT, `${sizeName}-${shot.id}.png`);
        fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
        const state = await cdp.eval(`JSON.stringify({playing:document.body.classList.contains('playing'),net:document.getElementById('netLine').textContent,w:innerWidth,h:innerHeight})`);
        console.log(file.split('/').pop(), state);
        ws.close();
        await json(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
      }
    }
  } finally { chrome.kill('SIGKILL'); }
})().catch(e => { console.error('shots failed:', e.message); process.exit(1); });
