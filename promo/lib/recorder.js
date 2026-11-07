// Runs in the page record.js opens, before any of the game's scripts. A person plays; this records what they play:
//  - the game's own canvas (the world, without the cursor, the browser or the HUD) at a phone's resolution, whatever
//    size the window is: devicePixelRatio is raised so the canvas is drawn at the target size and shown scaled down;
//  - the game's own sound, tapped from its master bus;
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
  let rec = null, chunks = 0, t0 = 0, badge = null, audioDest = null;
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
  // the game's sound: its master gain, also into a stream (once the game has made its AudioContext, on the first input)
  function soundTrack() {
    try {
      const actx = window.__mt && window.__mt.x('actx'), master = window.__mt && window.__mt.x('master');
      if (!actx || !master) return null;
      if (!audioDest) { audioDest = actx.createMediaStreamDestination(); master.connect(audioDest); }
      return audioDest.stream.getAudioTracks()[0] || null;
    } catch (e) { return null; }
  }
  const TYPES = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  async function start() {
    const cv = document.getElementById('game'); if (!cv) return;
    const stream = cv.captureStream(60), a = soundTrack(); if (a) stream.addTrack(a);
    const type = TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await fetch('http://127.0.0.1:' + PORT + '/start?id=' + id + '&type=' + encodeURIComponent(type) + '&w=' + cv.width + '&h=' + cv.height + '&sound=' + (a ? 1 : 0), { method: 'POST' });
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 48e6, audioBitsPerSecond: 256e3 }); rec.id = id; chunks = 0; t0 = performance.now();
    const sent = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) { const n = chunks++; sent.push(e.data.arrayBuffer().then(b => fetch('http://127.0.0.1:' + PORT + '/chunk?id=' + id + '&n=' + n, { method: 'POST', body: b }))); } };
    rec.onstop = () => setTimeout(() => Promise.allSettled(sent).then(() => fetch('http://127.0.0.1:' + PORT + '/stop?id=' + id + '&n=' + chunks + '&frames=' + frames + '&late=' + late, { method: 'POST' })), 100);
    frames = 0; late = 0; rec.start(1000); show();
  }
  function stop() { if (!rec) return; const r = rec; rec = null; r.stop(); show(); }
  addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) { e.preventDefault(); rec ? stop() : start(); } }, true);
  addEventListener('beforeunload', stop);
  { const m = /[?&]autorec=(\\d+)/.exec(location.search); if (m) setTimeout(() => { start(); setTimeout(stop, +m[1] * 1000); }, 2500); } // record.js --selftest
})();`;
