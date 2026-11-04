// Plays the Android app's page through Chrome DevTools and checks the native bridge, saving screenshots.
//
//   node android/tools/emulator-test.js --adb --out=DIR
//       The debug app running in an emulator or phone (android/tools/emulator-test.sh installs it, starts it and
//       forwards its WebView's DevTools socket to 127.0.0.1:9222). Uses real Android input and system state too:
//       the back key, leaving and returning to the app, battery saver, and a crashed WebView renderer.
//   node android/tools/emulator-test.js --chrome=URL --out=DIR
//       Desktop Chrome on URL (index.html?server=...) with a stand-in for the app's MitosisAndroid bridge, to work
//       on this script without an emulator. CHROME=path picks the browser.
//
// Checks: the page loads as the Android app; Nearby and Record are hidden; a Casual game starts; the back key
// pauses; the menus and the shop open; haptics, billing (products, buy, finish), sign-in, review and power calls
// are answered without a crash. Writes DIR/*.png and DIR/results.json; exits 1 if a required check failed.
'use strict';
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');

const opt = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--(\w+)(?:=([\s\S]*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const OUT = opt.out || 'emulator-out', ADB = !!opt.adb, PKG = 'com.mitosisgame.app', CDP_PORT = +(opt.port || 9222);
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '', required = true) {
  results.push({ name, ok: !!ok, required, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  console.log(`${ok ? 'PASS' : required ? 'FAIL' : 'WARN'}  ${name}${detail !== '' ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  return !!ok;
}
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const pid = () => { try { return adb('shell', 'pidof', PKG); } catch (e) { return ''; } };

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.w = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; console.log('PAGE EXCEPTION:', ((d.exception && d.exception.description) || d.text || '').split('\n')[0]); }
      if (m.id && this.w.has(m.id)) { const { res, rej } = this.w.get(m.id); this.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    ws.onclose = () => { for (const { rej } of this.w.values()) rej(new Error('DevTools connection closed')); this.w.clear(); };
  }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('DevTools connect timed out')), 15000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error('cannot connect to ' + url)); }; });
    const c = new CDP(ws); await c.send('Runtime.enable'); await c.send('Page.enable'); return c;
  }
  // every call gets an answer or an error within `ms`: a stuck page must fail the test, not hang the job
  send(method, params = {}, ms = 40000) { const id = ++this.id; return new Promise((res, rej) => {
    const t = setTimeout(() => { if (this.w.delete(id)) rej(new Error(`DevTools ${method} got no answer in ${ms / 1000} s`)); }, ms);
    this.w.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; }
}
const targets = async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
async function pageTarget(notId) {
  for (let i = 0; i < 60; i++) {
    try { const t = (await targets()).find(t => t.type === 'page' && /index\.html/.test(t.url) && t.id !== notId && t.webSocketDebuggerUrl); if (t) return t; } catch (e) {}
    await sleep(500);
  }
  throw new Error('no page target with index.html on port ' + CDP_PORT);
}

let cdp, chrome;
const ev = expr => cdp.eval(expr);
async function waitFor(expr, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(250); } return false; }
const VIS = `(s=>{const e=typeof s==='string'?document.querySelector(s):s;if(!e||e.hidden)return false;for(let p=e;p;p=p.parentElement)if(p.hidden)return false;const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';})`;
const vis = sel => ev(`${VIS}(${JSON.stringify(sel)})`);
// a click at the element's centre through DevTools input (pointer, mouse and click events, as a real press makes)
async function tap(sel) {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()`);
  if (!r || !r.w || !r.h) { console.log('  (tap: nothing visible at ' + sel + ')'); return false; }
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse' });
  return true;
}
let shotN = 0;
async function shot(name) {
  const file = path.join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  try {
    if (ADB) fs.writeFileSync(file, execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 27 }));
    else { const png = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(png.data, 'base64')); }
    console.log('  shot', path.basename(file));
  } catch (e) { console.log('  shot failed', name, e.message); }
}
// The game's code is private (one closure), so the test reads the page from outside: the DOM, and the bridge.
// Before the page runs, this traps window.MitosisBridge (the one global the page sets for the app) and records
// every native → page message, replies and events, in window.__rx.
const RECORD = `window.__rx=[];(()=>{let B;Object.defineProperty(window,'MitosisBridge',{configurable:true,enumerable:true,get(){return B},
  set(v){if(v&&typeof v.onNative==='function'&&!v.__rec){const o=v.onNative;v.onNative=function(m){try{window.__rx.push(JSON.parse(JSON.stringify(m)))}catch(e){}return o.apply(this,arguments)};v.__rec=true;}B=v;}});})();`;
// The same, hooked into a page that is already running (the app's page: no reload, so nothing about its load changes)
const RECORD_NOW = `(()=>{if(window.__rx)return true;const B=window.MitosisBridge;if(!B||typeof B.onNative!=='function')return false;window.__rx=[];const o=B.onNative;
  B.onNative=function(m){try{window.__rx.push(JSON.parse(JSON.stringify(m)))}catch(e){}return o.apply(this,arguments)};return true;})()`;
// Our own calls go straight to the app's bridge (ids the page never uses, so the page ignores the replies)
let callId = 900000;
const post = msg => ev(`window.MitosisAndroid.post(${JSON.stringify(JSON.stringify(msg))})`);
const call = (msg, ms = 25000) => { const id = ++callId; return ev(`new Promise(res=>{const t0=Date.now();window.MitosisAndroid.post(${JSON.stringify(JSON.stringify({ id, ...msg }))});
  const iv=setInterval(()=>{const r=window.__rx.find(m=>m.id===${id});if(r||Date.now()-t0>${ms}){clearInterval(iv);res(r||{ok:false,error:'no reply in ${ms} ms'});}},100);})`); };
const answered = r => r.ok !== false || !/^no reply/.test(r.error || '');
const alive = async () => { if (ADB && !pid()) return false; try { return (await ev('1+1')) === 2; } catch (e) { return false; } };

// In --chrome mode: what the Android app's bridge does on a device without Google Play
const FAKE_BRIDGE = `window.__sent=[];window.MitosisAndroid={post(j){const m=JSON.parse(j);__sent.push(m);
  const r=o=>setTimeout(()=>window.MitosisBridge.onNative(o),40);
  if(m.type==='auth')r({id:m.id,ok:true,providers:[]});
  else if(m.type==='products'||m.type==='buy')r({id:m.id,ok:false,error:'Google Play is not available'});
  else if(m.type==='record')r({id:m.id,ok:false,error:'Recording is only in the iPhone app'});
  else if(m.type==='ready')r({type:'power',low:false,thermal:'nominal'});}};`;

async function startChrome(url) {
  const exe = process.env.CHROME || '/opt/pw-browsers/chromium', profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-cdp-'));
  chrome = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  cdp = await CDP.open(t.webSocketDebuggerUrl);
  // a landscape phone (Pixel 6 class): 915 x 412 CSS px
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 2.625, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_BRIDGE + RECORD });
  await cdp.send('Page.navigate', { url });
}

// Android's back button on the device; Esc (what the app turns it into) in desktop Chrome
const backKey = () => ADB ? adb('shell', 'input', 'keyevent', 'KEYCODE_BACK') : ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
async function closeCard(card) { // the back key on the device; the page's own back button in desktop Chrome
  if (ADB) { await backKey(); return waitFor(`${VIS}('#startCard')`, 6000); }
  const sel = await ev(`(()=>{const c=document.querySelector(${JSON.stringify(card)});if(!c)return null;const b=[...c.querySelectorAll('button')].find(b=>/^back/i.test(b.getAttribute('aria-label')||'')||b.classList.contains('back'));if(!b)return null;b.id||(b.id='__back'+Math.random().toString(36).slice(2,7));return '#'+b.id;})()`);
  if (sel) await tap(sel); else await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  return waitFor(`${VIS}('#startCard')`, 6000);
}

async function run() {
  if (ADB) cdp = await CDP.open((await pageTarget()).webSocketDebuggerUrl);
  else await startChrome(opt.chrome);
  const pid0 = ADB ? pid() : '';

  // ---- the page loads as the Android app (the web fonts may still be loading: that doesn't hold the game up)
  const loaded = check('page loads', await waitFor(`document.readyState!=='loading'&&!!window.MitosisBridge&&!!document.getElementById('startCard')`, 45000),
    await ev(`JSON.stringify({href:location.href.slice(0,90),readyState:document.readyState,bridge:typeof window.MitosisBridge,app:typeof window.MitosisAndroid})`).catch(e => e.message));
  if (!loaded) throw new Error('the page did not load');
  check('recording native → page messages', await ev(RECORD_NOW));
  check('app bridge present', await ev(`typeof window.MitosisAndroid==='object'&&typeof window.MitosisAndroid.post==='function'`));
  const q = await ev('location.search');
  check('app passes its version and server', /[?&]app=android-2\.3\.0\b/.test(q) && /[?&]server=http/.test(q), q);
  if (await vis('#introCard')) { await shot('welcome'); await tap('#introGo'); }
  check('lobby shows', await waitFor(`${VIS}('#startCard')`, 15000));
  await sleep(2500);
  await shot('lobby');

  // ---- iOS-only features are hidden
  check('Nearby mode card hidden', await ev(`document.querySelector('#modeSeg [data-m=nearby]').hidden===true`));
  check('Nearby lobby strip hidden', !(await vis('#lbNear')));
  check('Record setting hidden', await ev(`document.getElementById('recField').hidden===true`));
  check('not in Nearby mode', await ev(`document.getElementById('lbPlay').dataset.mode!=='nearby'`));

  // ---- mode sheet: Ranked and Casual only; pick Casual
  await tap('#modeBtn');
  check('mode sheet opens', await waitFor(`${VIS}('#modeSheet')`, 5000));
  await sleep(500); await shot('mode-sheet');
  check('mode sheet offers Ranked and Casual only', await ev(`[...document.querySelectorAll('#modeSeg .lb-mcard')].filter(c=>${VIS}(c)).map(c=>c.dataset.m).join()==='ranked,casual'`), await ev(`[...document.querySelectorAll('#modeSeg .lb-mcard')].filter(c=>${VIS}(c)).map(c=>c.dataset.m).join()`));
  await tap('#modeSeg .lb-mpick[data-m=casual]');
  check('Casual selected', await waitFor(`document.getElementById('lbPlay').dataset.mode==='casual'&&document.getElementById('modeSheet').hidden`, 5000));
  await sleep(400); await shot('lobby-casual');

  // ---- battery saver on and off, for real
  if (ADB) {
    adb('shell', 'dumpsys', 'battery', 'unplug');
    adb('shell', 'settings', 'put', 'global', 'low_power', '1');
    check('battery saver on reaches the page', await waitFor(`window.__rx.some(m=>m.type==='power'&&m.low===true&&/^(nominal|fair|serious|critical)$/.test(m.thermal))`, 10000), await ev(`JSON.stringify(window.__rx.filter(m=>m.type==='power'))`));
    adb('shell', 'settings', 'put', 'global', 'low_power', '0');
    check('battery saver off reaches the page', await waitFor(`(()=>{const p=window.__rx.filter(m=>m.type==='power');return p.length&&p[p.length-1].low===false&&p.some(m=>m.low===true);})()`, 10000), await ev(`JSON.stringify(window.__rx.filter(m=>m.type==='power'))`));
    adb('shell', 'dumpsys', 'battery', 'reset');
  }

  // ---- sign-in and the review card answer without a crash
  const auth = await call({ type: 'auth' });
  check('auth answered', auth.ok === true && Array.isArray(auth.providers), auth);
  const rec = await call({ type: 'record', cmd: 'start' }, 8000);
  check('record (iOS-only) refused at once', rec.ok === false && !/^no reply/.test(rec.error), rec);
  await post({ type: 'review' }); await sleep(1500);
  check('review request: no crash', await alive());

  // ---- the shop, with billing calls
  await tap('#shopBtn');
  check('shop opens', await waitFor(`${VIS}('#storeCard')`, 6000));
  await sleep(1500); await shot('shop-skins');
  await tap('#tabAtp');
  check('ATP tab opens', await waitFor(`${VIS}('#packSec')`, 4000));
  check("the app answers the shop's products call", await waitFor(`window.__rx.some(m=>m.id&&m.id<900000&&(Array.isArray(m.products)||m.ok===false))`, 25000), await ev(`JSON.stringify(window.__rx.filter(m=>m.id&&m.id<900000))`));
  await sleep(800);
  check('shop knows it is in the app', await ev(`!/sold in the iPhone and Android app/.test(document.getElementById('storeHint').textContent)`), await ev(`document.getElementById('storeHint').textContent`));
  await shot('shop-atp');
  const prods = await call({ type: 'products', ids: ['atp_500', 'atp_1500', 'atp_5000', 'atp_12000', 'atp_150000'] });
  check('billing answers products', answered(prods), prods);
  const buy = await call({ type: 'buy', productId: 'atp_500' }, 30000);
  check('billing answers buy', answered(buy), buy);
  await sleep(1500);
  if (ADB && buy.ok !== false && !buy.cancelled) { await shot('billing-sheet'); adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1500); }
  await post({ type: 'finish', transactionId: '', purchaseToken: 'not-a-real-token' }); await sleep(1500);
  check('billing calls: no crash', await alive());
  await backKey();
  check(ADB ? 'back key closes the shop' : 'Esc closes the shop', await waitFor(`${VIS}('#startCard')`, 6000));

  // ---- the menus
  for (const [btn, card, name] of [['#setBtn', '#settingsCard', 'settings'], ['#lookBtn', '#lookCard', 'skins'], ['#rankBtn', '#rankCard', 'rank'], ['#friendsBtn', '#friendsCard', 'friends'], ['#navProf', '#profileCard', 'profile']]) {
    await tap(btn);
    const open = check(`${name} opens`, await waitFor(`${VIS}(${JSON.stringify(card)})`, 6000));
    await sleep(900); await shot(name);
    if (open) check(`${name} closes to the lobby${ADB ? ' with the back key' : ''}`, await closeCard(card));
  }

  // ---- a Casual game
  await tap('#practiceBtn');
  check('Casual game starts', await waitFor(`document.body.classList.contains('playing')&&${VIS}('#stats')`, 20000));
  await sleep(3000); await shot('game');
  if (ADB) { // steer with a real finger: drag across the arena
    const sz = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)\s*$/), [w, h] = sz ? [+sz[1], +sz[2]].sort((a, b) => b - a) : [2400, 1080];
    adb('shell', 'input', 'swipe', String(w * 0.55 | 0), String(h * 0.5 | 0), String(w * 0.8 | 0), String(h * 0.3 | 0), '1200');
  }
  await ev(`(()=>{const st=['selection','light','soft','medium','rigid','heavy','success','warning','error'];for(let i=0;i<45;i++)setTimeout(()=>window.MitosisAndroid.post(JSON.stringify({type:'haptic',style:st[i%st.length]})),i*40);})()`);
  await sleep(3000);
  check('haptics burst: no crash', await alive());
  check('still playing after haptics', await ev(`document.body.classList.contains('playing')`));
  await shot('game-later');

  // ---- back pauses; leave to the results and the lobby
  await backKey();
  check(ADB ? 'back key pauses the game' : 'Esc pauses the game', await waitFor(`${VIS}('#pauseCard')`, 5000));
  await sleep(500); await shot('paused');
  await tap('#quit');
  check('Leave shows the results', await waitFor(`${VIS}('#deathCard')`, 6000));
  await sleep(1200); await shot('results');
  await tap('#setup');
  check('results back to the lobby', await waitFor(`${VIS}('#startCard')`, 6000));

  if (ADB) {
    // ---- leaving and returning to the app: the page hears resignActive, background, becomeActive
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(2500);
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); await sleep(3000);
    const apps = await ev(`window.__rx.filter(m=>m.type==='app').map(m=>m.text).join()`);
    check('app events reach the page', /resignActive/.test(apps) && /background/.test(apps) && /becomeActive/.test(apps), apps);
    check('same process after returning', pid() === pid0, `${pid0} → ${pid()}`);
    await shot('returned');

    // ---- a crashed WebView renderer: the app makes a new WebView and reloads the game
    const old = (await pageTarget()).id;
    cdp.send('Page.crash').catch(() => {});
    await sleep(4000);
    let recovered = false;
    try { cdp = await CDP.open((await pageTarget(old)).webSocketDebuggerUrl); recovered = await waitFor(`document.readyState!=='loading'&&!!window.MitosisBridge&&${VIS}('#startCard')`, 45000); } catch (e) { console.log('  ' + e.message); }
    check('renderer crash: game reloads', recovered);
    check('renderer crash: app process survives', pid() === pid0, `${pid0} → ${pid()}`);
    await sleep(2500); await shot('after-renderer-crash');
  }
}

function finish() {
  if (chrome) chrome.kill('SIGKILL');
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter(r => r.required && !r.ok);
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} checks passed${failed.length ? '; FAILED: ' + failed.map(r => r.name).join(', ') : ''}`);
  process.exit(failed.length ? 1 : 0);
}
setTimeout(() => { check('test finished within 12 minutes', false); finish(); }, 12 * 60000).unref();

(async () => {
  try { await run(); } catch (e) { check('test ran to the end', false, e.message); }
  finish();
})();
