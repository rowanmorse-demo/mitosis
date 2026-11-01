// Two "phones" in one headless Chrome: each page gets a stand-in for the iOS bridge that passes Nearby messages to the
// other page over a BroadcastChannel, the way Nearby.swift does over MultipeerConnectivity. Drives the lobby and checks it.
// Usage: node tools/nearby-test.js            (about 3 minutes: a whole 3-minute match, with the host leaving early on)
//        QUICK=1 node tools/nearby-test.js    (stops once the match has started)   MEASURE=1 BOTS=normal: bytes sent per field   SHOTS=1 also saves screenshots to OUT (default: the temp dir)
//        MEASURE=1 BOTS=normal FPS=15 DELAY=60 JIT=80 LOSS=.25 node tools/nearby-test.js
//          phones drawing 15 frames a second over a link that takes 60-140 ms and loses a quarter of the messages (what the
//          phones' log showed on Oct 31): what each phone sends and gets, and how far behind and how jerkily the guest draws the host's bots
// Run it on a quiet machine: a window that stalls for 3 s looks like a phone that went away, and the other phone takes over as host.
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = path.join(__dirname, '..'), OUT = process.env.OUT || os.tmpdir(), PORT = 3300 + Math.floor(Math.random() * 300), DPORT = 9500 + Math.floor(Math.random() * 300);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const E = k => +(process.env[k] || 0), FPS = E('FPS'), DELAY = E('DELAY'), JIT = E('JIT'), LOSS = E('LOSS');
const STUB = `(()=>{const ch=new BroadcastChannel('mitosis-nearby');let me=null,on=false,lastAt=0;const peers=new Set();
  const FPS=${FPS},DELAY=${DELAY},JIT=${JIT},LOSS=${LOSS}; // FPS: frames a second the page may draw; the link's delay (+ up to JIT more) in ms, and its loss
  if(FPS){const raf=window.requestAnimationFrame.bind(window);let q=[],last=0,armed=false;
    const pump=()=>{armed=true;raf(t=>{armed=false;if(t-last<1000/FPS-3){pump();return;}last=t;const cbs=q;q=[];for(const c of cbs){try{c(t);}catch(e){console.error(e);}}if(q.length&&!armed)pump();});};
    window.requestAnimationFrame=cb=>{q.push(cb);if(!armed)pump();return q.length;};window.cancelAnimationFrame=()=>{};}
  const S=window.__smp={on:false,f:[]};requestAnimationFrame(function smp(){ // MEASURE: every bot cell where this page draws it, each frame
    if(S.on&&window.__mt&&window.__mt.players){const M=window.__mt,v=M.cam,o={t:performance.timeOrigin+performance.now()};if(M.human&&M.human.fx)M.human.fx.shield=30; // nobody dies while measuring
    // the host keeps all its bots (the truth); a guest the ones around its cell, which the host sends in every message
    if(M.isHost||(M.human&&M.human.alive))for(const p of M.players)if(p.bot&&p.alive)for(const c of p.cells)if(M.isHost||Math.hypot(c.x-v.x,c.y-v.y)<1200)o[p.bid+':'+c.nid]=[c.x,c.y];S.f.push(o);}requestAnimationFrame(smp);});
  const deliver=m=>{try{window.MitosisBridge&&window.MitosisBridge.onNative(m);}catch(e){}};
  const join=id=>{if(!peers.has(id)){peers.add(id);deliver({type:'nearby',ev:'join',id});}};
  ch.onmessage=e=>{const d=e.data;if(!on||d.from===me)return;
    if(d.kind==='hello'){const fresh=!peers.has(d.from);join(d.from);if(fresh)ch.postMessage({kind:'hello',from:me});}
    else if(d.kind==='p'){join(d.from);const st=window.__ns;if(st)st.rx++;deliver({type:'nearby',ev:'p',id:d.from,data:d.data});}
    else if(d.kind==='bye'){if(peers.delete(d.from))deliver({type:'nearby',ev:'bye',id:d.from});}};
  window.webkit={messageHandlers:{mitosis:{postMessage(m){if(!m||m.type!=='nearby')return;
    if(m.cmd==='start'){me=m.id;on=true;ch.postMessage({kind:'hello',from:me});}
    else if(m.cmd==='send'&&on){const st=window.__ns||(window.__ns={n:0,bytes:0,rx:0,t0:performance.now(),f:{}});st.n++;st.bytes+=m.data.length;try{const o=JSON.parse(m.data);for(const k in o)st.f[k]=(st.f[k]||0)+(o[k]==null?0:JSON.stringify(o[k]).length);}catch(e){}
      const msg={kind:'p',from:me,data:m.data};if(!DELAY&&!JIT&&!LOSS){ch.postMessage(msg);return;}if(Math.random()<LOSS)return;
      const now=performance.now(),at=Math.max(lastAt,now+DELAY+Math.random()*JIT);lastAt=at;setTimeout(()=>ch.postMessage(msg),at-now);}
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
  // a busy Mac can leave a page that never answers: give up instead of waiting forever (the whole match takes about 4 minutes)
  setTimeout(() => { log('test failed: timed out, a page stopped answering (is the machine busy?)'); chrome.kill('SIGKILL'); server.kill(); process.exit(1); }, (process.env.QUICK ? 4 : 10) * 60000).unref();
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
      await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?nearby=1${process.env.MEASURE ? '&debug=1' : ''}` }); phones.push({ name, c, id: targetId });
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
    let host = phones[hostJ], guest = phones[1 - hostJ];
    let h = await st(host), g = await st(guest);
    check(h.go === 'Start match' && g.go === 'Waiting…', 'Play reads Start match on the host, Waiting… on the guest', [h.go, g.go]);
    // 2. the guest can't start; the host picks Hard bots, none of them, 3 minutes, 1 life
    await guest.c.eval(`document.getElementById('go').click()`); await sleep(300); g = await st(guest);
    check(!g.playing && /Waiting for the host/.test(g.toast), 'the guest pressing Play waits for the host', g);
    await host.c.eval(`document.getElementById('nearSetBtn').click()`); await sleep(300);
    for (const [set, v] of [['k', 'hard'], ['b', process.env.BOTS || 'none'], ['len', '180'], ['lives', '1']]) await host.c.eval(`document.querySelector('#nearSheet [data-set="${set}"] [data-v="${v}"]').click()`);
    await guest.c.eval(`document.getElementById('nearSetBtn').click()`);
    r = await until('settings', async () => { const x = await st(guest); return { ok: x.set.k === 'hard' && x.set.b === (process.env.BOTS || 'none') && x.set.len === '180' && x.set.lives === '1', x }; });
    check(r && r.ok, 'the guest sees the host\'s settings', r && r.x.set);
    check(r && r.x.locked, 'the guest\'s settings are read-only', r && r.x);
    check(/Hard bots|No bots/.test(r.x.sum) && /3 min · 1 life/.test(r.x.sum), 'the lobby summary on the guest', r && r.x.sum);
    const shot = async (p, n) => { if (!process.env.SHOTS) return; const x = await p.c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n), Buffer.from(x.data, 'base64')); };
    await shot(host, 'near-sheet-host.png'); await shot(guest, 'near-sheet-guest.png');
    await host.c.eval(`document.getElementById('nearClose').click()`); await guest.c.eval(`document.getElementById('nearClose').click()`);
    await sleep(400); await shot(host, 'near-lobby-host.png'); await shot(guest, 'near-lobby-guest.png');
    // 3. the host starts: both phones are in the match, on a 3-minute clock
    await host.c.eval(`document.getElementById('go').click()`); const t0 = Date.now();
    r = await until('match', async () => { const [x, y] = await Promise.all([st(host), st(guest)]); return { ok: x.playing && y.playing, x, y }; }, 15000);
    check(r && r.ok, 'Start match puts both phones in the game', r);
    await sleep(2500); h = await st(host); g = await st(guest);
    check(/^2:[345]\d/.test(h.clock) && /^2:[345]\d/.test(g.clock), 'both round clocks run the 3-minute match', [h.clock, g.clock]);
    if (process.env.QUICK) return;
    if (process.env.MEASURE) { // what the phones send each second, by field (try BOTS=normal), and how the guest draws the host's bots
      const ih = await Promise.all([host, guest].map(p => p.c.eval('window.__mt.isHost'))); if (!ih[0] && ih[1]) [host, guest] = [guest, host]; // hosting moved (a stall)
      for (const p of [host, guest]) await p.c.eval(`window.__ns={n:0,bytes:0,rx:0,t0:performance.now(),f:{}};window.__mt.pf&&Object.keys(window.__mt.pf).forEach(k=>window.__mt.pf[k]=0);window.__smp.f=[];window.__smp.on=true;'ok'`); await sleep(10000);
      for (const [n, p] of [['host', host], ['guest', guest]]) log(n, JSON.stringify(await p.c.eval(`(()=>{const s=window.__ns,dt=(performance.now()-s.t0)/1000,pf=window.__mt.pf;window.__smp.on=false;return{perSec:+(s.n/dt).toFixed(1),avgBytes:Math.round(s.bytes/s.n),kbPerSec:+(s.bytes/dt/1024).toFixed(1),gotPerSec:+(s.rx/dt).toFixed(1),fps:pf&&pf.gap?Math.round(pf.n/pf.gap*1000):null,fields:Object.fromEntries(Object.entries(s.f).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>[k,Math.round(v/s.n)]))}})()`)));
      // the guest's bots against the host's, on the shared clock: off by (units), behind (ms of the host's path), stutter
      // (how far each drawn frame's step is from the true step, over the true step: 0 is smooth, 1 is a stall or a double step)
      const [HF, GF] = await Promise.all([host, guest].map(p => p.c.eval('window.__smp.f')));
      const at = (k, t) => { let lo = 0, hi = HF.length - 1; if (hi < 1 || t < HF[0].t || t > HF[hi].t) return null;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (HF[m].t <= t) lo = m; else hi = m; }
        const A = HF[lo][k], B = HF[hi][k]; if (!A || !B) return null; const f = HF[hi].t > HF[lo].t ? (t - HF[lo].t) / (HF[hi].t - HF[lo].t) : 0; return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]; };
      const off = [], behind = [], stut = [], q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? Math.round(b[Math.min(b.length - 1, Math.floor(p * b.length))] * 100) / 100 : null; };
      for (let i = 1; i < GF.length; i++) for (const k in GF[i]) { if (k === 't') continue; const g = GF[i][k], h = at(k, GF[i].t), hb = at(k, GF[i].t - 100); if (!h || !hb) continue;
        off.push(Math.hypot(g[0] - h[0], g[1] - h[1])); if (Math.hypot(h[0] - hb[0], h[1] - hb[1]) < 8) continue; // moving at 80 a second or more
        let best = 0, be = 1e9; for (let tt = 0; tt <= 800; tt += 10) { const p = at(k, GF[i].t - tt); if (!p) break; const e = Math.hypot(g[0] - p[0], g[1] - p[1]); if (e < be) { be = e; best = tt; } } behind.push(best);
        const g0 = GF[i - 1][k], h0 = at(k, GF[i - 1].t); if (g0 && h0) { const dh = Math.hypot(h[0] - h0[0], h[1] - h0[1]); if (dh > 2) stut.push(Math.hypot(g[0] - g0[0] - (h[0] - h0[0]), g[1] - g0[1] - (h[1] - h0[1])) / dh); } }
      log('guest draws the host\'s bots', JSON.stringify({ offBy: { median: q(off, .5), p90: q(off, .9) }, behindMs: { median: q(behind, .5), p90: q(behind, .9) }, stutter: { median: q(stut, .5), p90: q(stut, .9) }, samples: off.length }));
      return;
    }
    // 4. the host closes the app mid-match (the page goes to the background and the app leaves the Nearby session):
    //    the other phone takes over hosting and plays on
    await host.c.eval(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));window.webkit.messageHandlers.mitosis.postMessage({type:'nearby',cmd:'stop'});'ok'`);
    await sleep(300); await browser.send('Target.closeTarget', { targetId: host.id });
    const toasts = new Set();
    r = await until('takeover', async () => { const x = await st(guest); toasts.add(x.toast); return { ok: /You host · the others left/.test(x.who) && x.playing && /Match on/.test(x.sum), x }; }, 15000);
    check(r && r.ok, 'when the host closes the app, the other phone takes over and plays on', r && r.x);
    check([...toasts].some(t => /You host the match now/.test(t)), 'and says it hosts the match now', [...toasts]);
    const c1 = (await st(guest)).clock; await sleep(3000); const c2 = (await st(guest)).clock;
    check(c1 && c2 && c1 !== c2, 'its round clock keeps running', [c1, c2]);
    // 5. alone and without bots it plays on to the clock, then is back in the lobby as the host
    log('waiting for the 3-minute match to end…');
    // knocked out alone, the player goes back to the lobby (an arena nobody shares stands still under the results page)
    r = await until('end', async () => { const x = await st(guest); if (!x.playing) await guest.c.eval(`(()=>{const b=document.getElementById('setup');if(b&&b.offsetParent)b.click();})()`); return { ok: !/Match on/.test(x.sum) && x.go === 'Start match', x }; }, 240000);
    check(r && r.ok, 'after the round it is back in the lobby, as the host', r && r.x);
    check((Date.now() - t0) / 1000 > 165, 'the match ran to the clock (no early end when left alone)', Math.round((Date.now() - t0) / 1000) + ' s');
  } finally { chrome.kill('SIGKILL'); server.kill(); }
})().then(() => { // after QUICK and MEASURE return early too
  log(failures ? `${failures} check(s) failed` : 'all Nearby lobby checks passed'); process.exit(failures ? 1 : 0);
}, e => { log('test failed:', e.message); process.exit(1); });
