#!/usr/bin/env node
// The page's side of push notifications, end to end without a phone: a throwaway server (push.js sending to the APNs
// stand-in, tools/apns-mock.js) and the game in headless Chrome with a stand-in for the iOS app's bridge (what
// ios/Mitosis/Push.swift answers). Checks: nothing at launch; Settings › Notifications; "On" asks iOS, then the token is
// registered with the server; switching a kind off reaches the server; making a friend brings up the game's own card
// before iOS's prompt; a test push from /admin/push reaches "Apple"; taps open Friends, Quests and the Shop; a
// notification while the game is open is a toast.
//   node tools/push-page-test.js [--shots <dir>]
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const mock = require('./apns-mock');
const ROOT = path.join(__dirname, '..'), CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SECRET = 'pushpage' + crypto.randomBytes(12).toString('hex');

// the app's half of the bridge, as Push.swift answers it (and empty answers for purchases and sign-in)
const STUB = `window.__sent=[];window.__push={status:'notDetermined',token:''};
window.__reply=o=>window.MitosisBridge&&window.MitosisBridge.onNative(o);
window.webkit={messageHandlers:{mitosis:{postMessage(m){window.__sent.push(JSON.parse(JSON.stringify(m)));setTimeout(()=>{const P=window.__push;
  if(m.type==='push'){
    if(m.cmd==='ask'){P.status='authorized';P.token='ab12'.repeat(16);window.__reply({id:m.id,ok:true,status:'authorized',token:'',env:'sandbox'});setTimeout(()=>window.__reply({type:'push',ev:'token',token:P.token,env:'sandbox'}),60);}
    else if(m.cmd==='settings')window.__reply({id:m.id,ok:true});
    else window.__reply({id:m.id,ok:true,status:P.status,token:P.token,env:'sandbox'});
  }else if(m.id)window.__reply({id:m.id,ok:m.type==='auth',providers:[],products:[]});},15);}}}};
try{localStorage.setItem('mitosis.intro','1');localStorage.setItem('mitosis.secret','${SECRET}');}catch(e){}`;

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.w = new Map(); this.errors = [];
    ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; this.errors.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0]); }
      if (m.id && this.w.has(m.id)) { const { res, rej } = this.w.get(m.id); this.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.w.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; }
  async until(expr, what, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await this.eval(expr)) return; await sleep(200); } throw new Error('timed out waiting for ' + what + ' (' + expr + ')'); }
  async shot(name) { if (!shots) return; const p = await this.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(p.data, 'base64')); }
}

(async () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); // a test key, not Apple's
  const apple = await mock.start({ publicKey: privateKey, keyId: 'TESTKEY123', teamId: '4M7HR323EA' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-pushpage-')), keyFile = path.join(dir, 'k.p8'); fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const PORT = 4600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`, CDPPORT = 9400 + Math.floor(Math.random() * 50);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, ADMIN_TOKEN: 'adm', MITOSIS_DATE: '2026-11-20T12:00:00Z', APNS_HOST: `http://127.0.0.1:${apple.port}`, APNS_KEY_FILE: keyFile, APNS_KEY_ID: 'TESTKEY123', APNS_TEAM_ID: '4M7HR323EA' }, stdio: ['ignore', 'ignore', 'inherit'] });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${CDPPORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { chrome.kill('SIGKILL'); server.kill(); process.exit(1); });
  let ok = false;
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} if (i > 150) throw new Error('server did not start'); await sleep(100); }
    await fetch(base + '/admin/pass?token=adm', { method: 'POST', body: 'on=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); // the pass (and its quests) live
    const post = async (url, body, secret) => (await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: 'Bearer ' + secret } : {}) }, body: JSON.stringify(body || {}) })).json();
    let v = null; for (let i = 0; i < 50 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${CDPPORT}/json/version`)).json(); } catch (e) { await sleep(200); } }
    const t = await (await fetch(`http://127.0.0.1:${CDPPORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const p = new CDP(ws); await p.send('Page.enable'); await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    await p.send('Page.navigate', { url: 'file://' + path.join(ROOT, 'index.html') + '?server=' + encodeURIComponent(base) + '&app=ios-2.3.0' });
    await p.until(`window.__sent.some(m=>m.type==='booted')`, 'the page to boot');
    await p.until(`window.__sent.some(m=>m.type==='ready')`, 'the wallet session');
    const me = await p.eval(`(async()=>{const r=await fetch('${base}/api/social/me',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${SECRET}'},body:'{}'});return (await r.json()).code})()`);

    // 1. nothing at launch: the page reads the state but never asks
    await sleep(1500);
    assert.ok(await p.eval(`window.__sent.some(m=>m.type==='push'&&m.cmd==='state')`), 'the page reads the permission state');
    assert.ok(!(await p.eval(`window.__sent.some(m=>m.type==='push'&&m.cmd==='ask')`)), 'and does not ask at launch');
    assert.ok(await p.eval(`!document.getElementById('pushCard')||document.getElementById('pushCard').hidden`), 'no card at launch');

    // 2. Settings › Notifications, after Sound, master Off; "On" asks iOS, then the token is registered
    await p.eval(`document.getElementById('setBtn').click()`);
    await p.eval(`document.getElementById('stTabAudio')&&document.getElementById('stTabAudio').click()`); // the tabbed Settings keeps it under Audio
    await p.until(`!!document.getElementById('pushSec')&&!document.getElementById('pushSec').hidden`, 'the Notifications section');
    assert.ok(await p.eval(`(()=>{const s=document.getElementById('pushSec'),snd=document.getElementById('sndSeg'),g=snd.closest('.st-grp,.sg,.ds-sec');return s.closest('#settingsCard')&&s.parentElement===g.parentElement&&s.className===g.className&&/Notifications/.test(s.firstElementChild.textContent)&&s.querySelector('.st-list,.sg-list')})()`), 'a Notifications group beside Sound, in its look');
    assert.equal(await p.eval(`document.querySelector('#pushSeg [aria-pressed=true]').dataset.v`), '0', 'master shows Off before permission');
    await p.eval(`document.getElementById('pushSec').scrollIntoView()`); await p.shot('1-settings-before');
    await p.eval(`document.querySelector('#pushSeg [data-v="1"]').click()`);
    await p.until(`window.__sent.some(m=>m.type==='push'&&m.cmd==='ask')`, 'iOS\'s prompt');
    await p.until(`document.querySelectorAll('#pushSec [data-push]:not([hidden])').length===6`, 'the five kinds under the master');
    let st; for (let i = 0; i < 50; i++) { st = await (await fetch(base + '/admin/push?token=adm&format=json')).json(); if (st.devices.length) break; await sleep(200); }
    assert.ok(st.devices.some(d => d.platform === 'ios' && d.env === 'sandbox' && d.n === 1), 'the token reached the server: ' + JSON.stringify(st.devices));
    const pid = st.recent[0].player;
    await p.eval(`document.getElementById('pushSec').scrollIntoView()`); await p.shot('2-settings-on');

    // the redesign's conventions: no data-def (Reset must not touch notifications), its note style, a tap on the row flips it
    assert.ok(await p.eval(`!document.querySelector('#pushSec [data-def]')`), 'no Reset-to-default marks on the push switches');
    assert.ok(await p.eval(`document.getElementById('pushFoot').className===(document.querySelector('#pushSec .st-list')?'st-note':'sg-foot')`), 'the note in the page\'s own style');
    await p.eval(`document.querySelector('[data-push="quests"] .sl').click()`);
    await p.until(`document.querySelector('#pushSeg-quests [aria-pressed=true]').dataset.v==='0'`, 'a tap on the Quests row to switch it off');
    await p.eval(`document.querySelector('[data-push="quests"] .sl').click()`);
    await p.until(`document.querySelector('#pushSeg-quests [aria-pressed=true]').dataset.v==='1'`, 'and on again');
    await sleep(600);

    // 3. switching a kind off reaches the server
    await p.eval(`document.querySelector('#pushSeg-shop [data-v="0"]').click()`);
    await p.until(`document.querySelector('#pushSeg-shop [aria-pressed=true]').dataset.v==='0'`, 'Shop off');
    await sleep(500);
    assert.deepEqual((await post('/api/push/prefs', {}, SECRET)).off, ['shop'], 'the server has Shop off');

    // 4. a test from the admin page goes to "Apple" with the right link; taps open the screens
    const sent = await (await fetch(base + '/admin/push?token=adm&format=json', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `player=${pid}&link=friends&body=Ti+invited+you` })).json();
    assert.equal(sent.sent, 1, 'the admin test went out: ' + JSON.stringify(sent));
    const last = apple.sent.at(-1);
    assert.deepEqual([last.token, last.payload.link, last.headers['apns-topic']], ['ab12'.repeat(16), 'friends', 'com.mitosisgame.app'], 'Apple got it for this phone');
    await p.eval(`document.querySelector('#settingsCard .back').click()`);
    await p.until(`!document.getElementById('startCard').hidden`, 'the lobby');
    const tap = async (link, card) => { await p.eval(`window.__reply({type:'push',ev:'open',link:'${link}',kind:'test'})`); await p.until(`!document.getElementById('${card}').hidden`, link + ' to open ' + card); };
    await tap('friends', 'friendsCard'); await p.shot('3-tap-friends');
    await p.eval(`document.querySelector('#friendsCard .back').click()`);
    await tap('quests', 'passCard');
    await p.until(`document.getElementById('passCard').dataset.mode==='quests'`, 'the Quests half of the pass');
    await p.shot('4-tap-quests');
    await p.eval(`document.getElementById('passBack').click()`);
    await tap('shop', 'storeCard');
    await p.eval(`document.getElementById('storeBack').click()`);

    // 5. while the game is open: a toast, no screen change
    await p.until(`!document.getElementById('startCard').hidden`, 'the lobby again');
    await p.eval(`window.__reply({type:'push',ev:'foreground',title:'Ti invited you',body:'Join their party',link:'friends',kind:'party'})`);
    await p.until(`[...document.querySelectorAll('#toasts .toast')].some(t=>/Ti invited you/.test(t.textContent))`, 'the toast');
    assert.ok(await p.eval(`!document.getElementById('startCard').hidden`), 'still in the lobby');

    // 6. a new player who makes a friend gets the game's own card first; "Not now" leaves iOS's prompt unasked
    await p.eval(`window.__push.status='notDetermined';window.__push.token='';window.__sent.length=0;localStorage.removeItem('mitosis.push')`);
    await p.send('Page.reload'); await p.until(`window.__sent.some(m=>m.type==='ready')`, 'the reload');
    await p.eval(`document.getElementById('friendsBtn').click()`);
    const other = 'pushfriend' + crypto.randomBytes(12).toString('hex'); await post('/api/session', { secret: other });
    const otherCode = (await post('/api/social/me', { name: 'Ti' }, other)).code;
    await post('/api/social/add', { code: me }, other); await sleep(1200); await post('/api/social/add', { code: otherCode }, SECRET);
    await p.until(`!!document.getElementById('pushCard')&&!document.getElementById('pushCard').hidden`, 'the game\'s own card after making a friend', 25000);
    assert.match(await p.eval(`document.getElementById('pushTitle').textContent`), /friends invite you/, 'it is about friends');
    assert.ok(!(await p.eval(`window.__sent.some(m=>m.type==='push'&&m.cmd==='ask')`)), 'iOS has not been asked yet');
    await p.shot('5-ask-card');
    await p.eval(`document.getElementById('pushLater').click()`);
    await p.until(`!document.getElementById('friendsCard').hidden`, 'back to Friends');
    assert.ok(!(await p.eval(`window.__sent.some(m=>m.type==='push'&&m.cmd==='ask')`)), '"Not now" does not ask iOS');
    assert.equal(JSON.parse(await p.eval(`localStorage.getItem('mitosis.push')`)).asked, 1, 'and is remembered (asks again in 3 days at the soonest)');

    assert.deepEqual(p.errors, [], 'no page errors');
    console.log('push page test passed' + (shots ? ' (screenshots in ' + shots + ')' : ''));
    ok = true;
    ws.close();
  } catch (e) { console.error(e); }
  finally { chrome.kill('SIGKILL'); server.kill(); await apple.close(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300); }
  process.exitCode = ok ? 0 : 1;
})();
