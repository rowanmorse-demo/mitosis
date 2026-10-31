// Two "phones" in one headless Chrome: each page gets a stand-in for the iOS bridge that passes Nearby messages to the
// other page over a BroadcastChannel, the way Nearby.swift does over MultipeerConnectivity. Drives the lobby and checks it.
// Usage: node tools/nearby-test.js            (about 3 minutes: it plays a whole 3-minute match)
//        QUICK=1 node tools/nearby-test.js    (stops once the match has started)   SHOTS=1 also saves screenshots to OUT (default: the temp dir)
// Run it on a quiet machine: a window that stalls for 3 s looks like a phone that went away, and the other phone takes over as host.
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = path.join(__dirname, '..'), OUT = process.env.OUT || os.tmpdir(), PORT = 3300 + Math.floor(Math.random() * 300), DPORT = 9500 + Math.floor(Math.random() * 300);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const STUB = `(()=>{const ch=new BroadcastChannel('mitosis-nearby');let me=null,on=false;const peers=new Set();
  const deliver=m=>{try{window.MitosisBridge&&window.MitosisBridge.onNative(m);}catch(e){}};
  const join=id=>{if(!peers.has(id)){peers.add(id);deliver({type:'nearby',ev:'join',id});}};
  ch.onmessage=e=>{const d=e.data;if(!on||d.from===me)return;
    if(d.kind==='hello'){const fresh=!peers.has(d.from);join(d.from);if(fresh)ch.postMessage({kind:'hello',from:me});}
    else if(d.kind==='p'){join(d.from);deliver({type:'nearby',ev:'p',id:d.from,data:d.data});}
    else if(d.kind==='bye'){if(peers.delete(d.from))deliver({type:'nearby',ev:'bye',id:d.from});}};
  window.webkit={messageHandlers:{mitosis:{postMessage(m){if(!m||m.type!=='nearby')return;
    if(m.cmd==='start'){me=m.id;on=true;ch.postMessage({kind:'hello',from:me});}
    else if(m.cmd==='send'&&on)ch.postMessage({kind:'p',from:me,data:m.data});
    else if(m.cmd==='stop'){on=false;ch.postMessage({kind:'bye',from:me});peers.clear();}}}}};
  try{localStorage.setItem('mitosis.intro','1');}catch(e){}})();`;
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.w = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; log('PAGE EXCEPTION:', ((d.exception && d.exception.description) || d.text || '').split('\n')[0]); }
    if (m.id && this.w.has(m.id)) { const { res, rej } = this.w.get(m.id); this.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.w.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; }
}
const STATE = `(()=>{const $=id=>document.getElementById(id),on=b=>[...document.querySelectorAll('#nearSheet [data-set="'+b+'"] button')].filter(x=>x.getAttribute('aria-checked')==='true').map(x=>x.dataset.v).join();
  return{who:$('nearWho').textContent,sum:$('nearSum').textContent,go:$('go').textContent,playing:document.body.classList.contains('playing'),clock:($('roundClock')&&!$('roundClock').hidden)?$('roundClock').textContent.trim().slice(0,5):'',
    set:{k:on('k'),b:on('b'),len:on('len'),lives:on('lives')},locked:!!document.querySelector('#nearSheet [data-set] button:disabled'),cards:[...document.querySelectorAll('.card')].filter(c=>!c.hidden).map(c=>c.id).join(),sheet:$('nearSheet').hidden,toast:[...document.querySelectorAll('#toasts > *')].map(t=>t.textContent.trim().replace(/\\s+/g,' ')).slice(-2).join(' | ')};})()`;
let failures = 0; const check = (ok, what, got) => { log(ok ? 'PASS' : 'FAIL', what, ok ? '' : JSON.stringify(got)); if (!ok) failures++; };
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'near-'));
  const server = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT, DATA_DIR: data }, stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'near-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${DPORT}`, `--user-data-dir=${profile}`, '--window-size=430,900'], { stdio: 'ignore' });
  try {
    let v = null; for (let i = 0; i < 150 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${DPORT}/json/version`)).json(); } catch (e) { await sleep(200); } }
    if (!v) throw new Error('Chrome did not start');
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch (e) {} await sleep(200); }
    const browser = new CDP(new WebSocket(v.webSocketDebuggerUrl)); await new Promise(r => browser.ws.onopen = r);
    const phones = [];
    for (const name of ['A', 'B']) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
      const t = (await (await fetch(`http://127.0.0.1:${DPORT}/json/list`)).json()).find(x => x.id === targetId);
      const c = new CDP(new WebSocket(t.webSocketDebuggerUrl)); await new Promise(r => c.ws.onopen = r);
      await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // both windows draw frames like two phones in hand
      await c.send('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
      await c.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
      await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?nearby=1` }); phones.push({ name, c });
    }
    const st = p => p.c.eval(STATE);
    const until = async (what, fn, ms = 20000) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last && last.ok) return last; await sleep(500); } return last; };
    // 1. both phones find each other and agree on a host
    let r = await until('lobby', async () => { const [a, b] = await Promise.all(phones.map(st)); return { ok: /2 phones/.test(a.who) && /2 phones/.test(b.who), a, b }; }, 40000);
    check(r && r.ok, 'both phones see each other in the lobby', r);
    r = await until('host', async () => { const [a, b] = await Promise.all(phones.map(st)); return { ok: /you host/.test(a.who) !== /you host/.test(b.who) && /hosts/.test(a.who + b.who), a, b }; }, 15000);
    check(r && r.ok, 'the phones settle on one host, named on the other phone', r && [r.a.who, r.b.who]);
    const [a0, b0] = await Promise.all(phones.map(st));
    const hostI = /you host/.test(a0.who) ? 0 : /you host/.test(b0.who) ? 1 : -1;
    check(hostI >= 0 && !/you host/.test([a0, b0][1 - hostI].who), 'exactly one phone hosts', [a0.who, b0.who]);
    if(hostI<0){await sleep(3000);}
    const hostJ = hostI>=0?hostI:/you host/.test((await st(phones[0])).who)?0:1;
    const host = phones[hostJ], guest = phones[1 - hostJ];
    let h = await st(host), g = await st(guest);
    check(h.go === 'Start match' && g.go === 'Waiting…', 'Play reads Start match on the host, Waiting… on the guest', [h.go, g.go]);
    // 2. the guest can't start; the host picks Hard bots, none of them, 3 minutes, 1 life
    await guest.c.eval(`document.getElementById('go').click()`); await sleep(300); g = await st(guest);
    check(!g.playing && /Waiting for the host/.test(g.toast), 'the guest pressing Play waits for the host', g);
    await host.c.eval(`document.getElementById('nearSetBtn').click()`); await sleep(300);
    for (const [set, v] of [['k', 'hard'], ['b', 'none'], ['len', '180'], ['lives', '1']]) await host.c.eval(`document.querySelector('#nearSheet [data-set="${set}"] [data-v="${v}"]').click()`);
    await guest.c.eval(`document.getElementById('nearSetBtn').click()`);
    r = await until('settings', async () => { const x = await st(guest); return { ok: x.set.k === 'hard' && x.set.b === 'none' && x.set.len === '180' && x.set.lives === '1', x }; });
    check(r && r.ok, 'the guest sees the host\'s settings', r && r.x.set);
    check(r && r.x.locked, 'the guest\'s settings are read-only', r && r.x);
    check(/Hard bots|No bots/.test(r.x.sum) && /3 min · 1 life/.test(r.x.sum), 'the lobby summary on the guest', r && r.x.sum);
    const shot = async (p, n) => { if (!process.env.SHOTS) return; const x = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n), Buffer.from(x.data, 'base64')); };
    await shot(host, 'near-sheet-host.png'); await shot(guest, 'near-sheet-guest.png');
    await host.c.eval(`document.getElementById('nearClose').click()`); await guest.c.eval(`document.getElementById('nearClose').click()`);
    await sleep(400); await shot(host, 'near-lobby-host.png'); await shot(guest, 'near-lobby-guest.png');
    // 3. the host starts: both phones are in the match, on a 3-minute clock
    await host.c.eval(`document.getElementById('go').click()`);
    r = await until('match', async () => { const [x, y] = await Promise.all([st(host), st(guest)]); return { ok: x.playing && y.playing, x, y }; }, 15000);
    check(r && r.ok, 'Start match puts both phones in the game', r);
    await sleep(2500); h = await st(host); g = await st(guest);
    check(/^2:5\d/.test(h.clock) && /^2:5\d/.test(g.clock), 'both round clocks run the 3-minute match', [h.clock, g.clock]);
    if (process.env.QUICK) return;
    // 4. when the round ends, both are back in the lobby and the host can start the next match
    log('waiting for the 3-minute match to end…');
    r = await until('end', async () => { const [x, y] = await Promise.all([st(host), st(guest)]); return { ok: !/Match on/.test(x.sum) && !/Match on/.test(y.sum) && [x.go, y.go].sort().join() === 'Start match,Waiting…', x, y }; }, 240000);
    check(r && r.ok, 'after the round both phones are back in the lobby', r);
    // 5. a phone that leaves drops out of the other's lobby
    await guest.c.eval(`document.querySelector('.lb-mpick[data-m=ranked]')&&document.querySelector('.lb-mpick[data-m=ranked]').click()`);
    r = await until('leave', async () => { const x = await st(host); return { ok: !/2 phones/.test(x.who), x }; }, 15000);
    check(r && r.ok, 'the guest leaving Nearby drops out of the host\'s lobby', r && r.x.who);
  } finally { chrome.kill('SIGKILL'); server.kill(); }
  log(failures ? `${failures} check(s) failed` : 'all Nearby lobby checks passed'); process.exit(failures ? 1 : 0);
})().catch(e => { log('test failed:', e.message); process.exit(1); });
