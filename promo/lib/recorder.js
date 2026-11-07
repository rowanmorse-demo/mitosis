// Runs in the page record.js opens, before any of the game's scripts. A person plays; this records what they play:
//  - the game's own canvas (the world, without the cursor, the browser or the HUD) at a phone's resolution, whatever
//    size the window is: devicePixelRatio is raised so the canvas is drawn at the target size and shown scaled down;
//  - the game's own sound, as a log of every sound it plays (edit.js renders it again, in sync);
//  - R starts and stops a take; each take streams to record.js, which writes promo/rec/<name>.mp4.
// Offline (the default) the live room fails at once, so the game fills the room with its own bots on this Mac (no
// network lag on ship Wi-Fi), and the economy API answers from a wallet that owns every skin on sale.
'use strict';
module.exports = ({ port, target, api, settings }) => `(() => {
  const PORT = ${port}, TARGET = ${JSON.stringify(target)}, API = ${JSON.stringify(api)};
  // ---- the canvas at the target size: a higher devicePixelRatio, chosen from the window's size
  const dpr = () => Math.max(TARGET.w / Math.max(1, innerWidth), TARGET.h / Math.max(1, innerHeight));
  Object.defineProperty(window, 'devicePixelRatio', { get: dpr, configurable: true });
  // ---- who is playing: a name and a skin, the intro and tips already seen
  try {
    const o = ${JSON.stringify(settings)};
    for (const k in o) localStorage.setItem(k, o[k]);
  } catch (e) {}
  // ---- offline: the live room fails, the economy API answers from the wallet
  if (API) {
    class DeadSocket {
      constructor(url) { this.url = url; this.readyState = 0; setTimeout(() => { this.readyState = 3; try { this.onerror && this.onerror({}); } catch (e) {} try { this.onclose && this.onclose({ code: 1006 }); } catch (e) {} }, 8); }
      send() {} close() { this.readyState = 3; } addEventListener() {} removeEventListener() {}
    }
    DeadSocket.CONNECTING = 0; DeadSocket.OPEN = 1; DeadSocket.CLOSING = 2; DeadSocket.CLOSED = 3;
    window.WebSocket = DeadSocket;
    const realFetch = window.fetch.bind(window);
    let wallet = API.session;
    window.fetch = (u, o) => {
      const url = String(u && u.url || u);
      if (url.startsWith('http://127.0.0.1:' + PORT)) return realFetch(u, o);
      const m = /\\/api\\/([\\w\\/-]+)/.exec(url);
      if (!m) return Promise.reject(new TypeError('offline (recording)'));
      let body = null;
      if (m[1] === 'session') body = wallet;
      else if (m[1] === 'run/start') body = { runId: 'rec-' + Date.now() };
      else if (m[1] === 'run/end') { // a win moves the rating the way ranked does; anything else, a little
        let place = 9; try { place = JSON.parse(o && o.body || '{}').place || 9; } catch (e) {}
        const d = place === 1 ? 24 : place <= 3 ? 9 : -6, pay = place === 1 ? 25 : place <= 3 ? 10 : 0;
        wallet = { ...wallet, rating: wallet.rating + d, balance: wallet.balance + pay, earned: wallet.earned + pay, runs: wallet.runs + 1 };
        body = { ...wallet, payout: pay, ratingDelta: d };
      }
      else body = API[m[1]] || null;
      return new Promise((res, rej) => setTimeout(() => body ? res({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) }) : rej(new TypeError('offline (recording)')), 40));
    };
    try { navigator.sendBeacon = () => true; } catch (e) {}
  }

  // ---- the recorder
  let rec = null, t0 = 0, badge = null;
  // smoothness: every frame the page draws while recording, and how many came late (a hitch the video would show)
  let frames = 0, late = 0, last = 0;
  (function tick(t) { if (rec) { if (last && t - last > 26) late++; frames++; } last = t; requestAnimationFrame(tick); })(0);
  function ui() {
    if (badge) return badge;
    badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;font:600 12px/1.2 system-ui;color:#fff;background:rgba(0,0,0,.55);padding:6px 9px;border-radius:999px;pointer-events:none;letter-spacing:.02em';
    document.body.appendChild(badge); return badge;
  }
  function show() {
    const b = ui();
    if (rec) { const s = Math.floor((performance.now() - t0) / 1000); b.innerHTML = '<span style="color:#ff4d6d">\\u25cf</span> REC ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' \\u00b7 R to stop'; }
    else { let ready = false; try { ready = !!(window.__mt && window.__mt.x('actx')); } catch (e) {} b.textContent = ready ? 'R to record' : 'Start a match, then R to record'; }
  }
  setInterval(show, 250);
  // the game's sound, as a log: every sfx(kind, amount) the game plays during a take, with its time. edit.js renders
  // it again with the game's own sound code, in sync and clean (live audio capture can stall the recorder, and a
  // paused AudioContext would leave a take silent)
  let sfxLog = [], hooked = false;
  function hookSfx() {
    if (hooked || !window.__mt) return; hooked = true;
    window.__recSfx = (k, a) => { if (rec) sfxLog.push({ t: +((performance.now() - t0) / 1000).toFixed(4), k, a: +a || 0 }); };
    window.__mt.x('sfx=(function(o){return function(k,a){try{window.__recSfx&&window.__recSfx(k,a)}catch(e){}return o.apply(this,arguments)}})(sfx)');
  }
  const post = (what, q, body) => fetch('http://127.0.0.1:' + PORT + '/' + what + '?' + q, { method: 'POST', body });
  const log = msg => post('log', '', String(msg)).catch(() => {});
  const TYPES = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  async function start() {
    try {
      const cv = document.getElementById('game'); if (!cv) return;
      hookSfx();
      const stream = cv.captureStream(60), type = TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
      const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await post('start', 'id=' + id + '&type=' + encodeURIComponent(type) + '&w=' + cv.width + '&h=' + cv.height);
      const r = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 48e6 }), sent = []; let n = 0;
      r.ondataavailable = e => { if (e.data && e.data.size) { const k = n++; sent.push(e.data.arrayBuffer().then(b => post('chunk', 'id=' + id + '&n=' + k, b))); } };
      r.onerror = e => log('recorder error: ' + (e.error && e.error.message || e.type));
      r.onstop = () => setTimeout(() => Promise.allSettled(sent).then(() => post('sfx', 'id=' + id, JSON.stringify(r.sfx)))
        .then(() => post('stop', 'id=' + id + '&frames=' + r.frames + '&late=' + r.late)), 100);
      sfxLog = []; frames = 0; late = 0; t0 = performance.now(); rec = r; r.start(1000); show();
    } catch (e) { rec = null; log('could not start a take: ' + (e && e.message || e)); }
  }
  function stop() { if (!rec) return; const r = rec; r.sfx = sfxLog; r.frames = frames; r.late = late; rec = null; r.stop(); show(); }
  addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) { e.preventDefault(); rec ? stop() : start(); } }, true);
  addEventListener('beforeunload', stop);
  { const m = /[?&]autorec=(\\d+)/.exec(location.search); if (m) setTimeout(() => { try { window.__mt.x("startLocal('practice')"); } catch (e) {} setTimeout(() => { start(); setTimeout(() => { try { window.__mt.x("sfx('split')"); } catch (e) {} }, 1000); setTimeout(stop, +m[1] * 1000); }, 1500); }, 2500); } // record.js --selftest: a practice match, then a take
})();`;
