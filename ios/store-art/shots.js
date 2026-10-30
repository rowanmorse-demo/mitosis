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
  { id: '2-menu', url: '?tag=shot', wait: 3500, cap: 'Into a live arena in seconds', sub: 'Placement every round and a rating that climbs from Silver to Legend', card: true },
  // the shop with Supernova picked: the wallet below is real (seeded on the local server)
  { id: '3-shop', url: '?tag=shot', wait: 3500, click: 'shopBtn', fix: `(()=>{document.querySelector('#skins .skin[data-id="22"]').click();return 'ok'})()`, cap: 'Nineteen skins to unlock with ATP', sub: 'Win a round for 25 ATP, or pick up a pack', card: true },
  { id: '4-profile', url: '?tag=shot', wait: 3500, click: 'profBtn', fix: `(()=>{const g=id=>document.getElementById(id);g('acctHint').hidden=true;g('appleBtn').hidden=false;g('achField').scrollIntoView({block:'end'});return 'ok'})()`, cap: 'Your rating follows you', sub: 'Sign in with Apple and keep ATP, skins and rank on any phone', card: true },
  { id: '5-events', url: '?autopilot=1&big=1&noeject=1&tag=shot', wait: 9000, until: "document.body.classList.contains('playing')&&!document.getElementById('banner').hidden&&!document.getElementById('banner').classList.contains('mini')", cap: 'Phages, blooms, tides and the Leviathan', sub: 'Evolve six times a life, dodge hunters and take the leader\'s bounty' },
  // a real ranked death against the local server: placement, ATP and the rating meter mid-way through its count-up
  { id: '6-results', url: '?autopilot=1&norestart=1&tag=shot', wait: 6000, until: "!document.getElementById('deathCard').hidden", after: 900, cap: 'Placement every round', sub: 'Climb from Silver to Legend', card: true },
  // Nearby is the iPhone app's switch: the page runs in its real Nearby mode with three phones simulated through the same hook the app uses
  { id: '7-nearby', url: '?tag=shot', wait: 3500, fix: `(()=>{const N=window.__mitosisNet,g=id=>document.getElementById(id);N.useNearby(()=>{});
    ['Amoeba','Diatom','Euglena'].forEach((n,i)=>N.onNearby({ev:'p',id:'zz'+i,data:JSON.stringify({v:6,n,s:i+2,a:0,f:0,k:i,q:0})}));
    g('netSeg').hidden=false;[...g('netSeg').children].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.n==='nearby')));document.querySelector('.lb-play').classList.add('nearby');
    g('modeLbl').textContent='Nearby · Bluetooth & Wi-Fi';g('modeSub').textContent='Phones around you · unranked';return 'ok'})()`, after: 1500, cap: 'Friends in the room? No internet needed', sub: 'Phones nearby play over Bluetooth and Wi-Fi', card: true },
];
const SHOTS = process.env.ONLY ? SHOTS_ALL.filter(x => process.env.ONLY.split(',').includes(x.id)) : SHOTS_ALL;

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Storage the game finds on first load. The secret is the shot wallet that seed-wallet.js funds on the local server
// (rating 1480, 8,350 ATP, a few skins, One Cell worn), so the lobby, shop and profile show real numbers.
const SEED = `try{const s=localStorage;s.setItem('mitosis.intro','1');s.setItem('mitosis.secret','${require('./seed-wallet').SECRET}');
  s.setItem('mitosis.settings',JSON.stringify({name:'Volvox',stain:1,diff:'standard',skin:16,boardMin:true}));
  s.setItem('mitosis.ach',JSON.stringify(['first','m500','m2000','rank1','surv5','frenzy5','bounty']));
  s.setItem('mitosis.history',JSON.stringify([{t:Date.now()-900000,place:3,of:61,peak:2806,eaten:27,sec:372,delta:24,rating:1480},{t:Date.now()-600000,place:12,of:58,peak:1240,eaten:9,sec:214,delta:4,rating:1456},{t:Date.now()-300000,place:41,of:60,peak:230,eaten:1,sec:38,delta:-6,rating:1452}]));}catch(e){}`;
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
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
        await cdp.send('Page.navigate', { url: BASE + shot.url });
        await sleep(700);
        await sleep(Math.max(0, shot.wait - 700));
        if (shot.until) { const t0 = Date.now(); while (Date.now() - t0 < 110000 && !(await cdp.eval(shot.until))) await sleep(250); }
        if (shot.click) { await cdp.eval(`document.getElementById(${JSON.stringify(shot.click)}).click(); 'ok'`); await sleep(900); }
        if (shot.fix) { await cdp.eval(shot.fix); await sleep(300); }
        if (shot.after) await sleep(shot.after);
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
