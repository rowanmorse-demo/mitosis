// Runs in the page before any of its scripts (Page.addScriptToEvaluateOnNewDocument). It makes the page fully
// deterministic so a take renders the same, frame for frame, however slow the machine is:
//  - a virtual clock: performance.now, Date, setTimeout/setInterval and requestAnimationFrame all follow it, and it
//    only moves when the capture calls __vt.step(ms), one fixed 1/60 s frame at a time;
//  - CSS animations and transitions are paused and seeked to the virtual clock every frame;
//  - Math.random is a seeded generator;
//  - the network is replaced, on the virtual clock: the live-room WebSocket fails at once (so the game plays bots on
//    the device, the same frame every time), and the economy API answers from window.__promoApi (a wallet, a run's
//    payout and rating change), so the lobby and the results screen show real-looking numbers through the game's
//    own code; anything else fails. The AudioContext is removed (the sound is rendered offline from the sfx log).
'use strict';
module.exports = ({ seed = 1, epoch, api = {} }) => `(() => {
  window.__promoApi = ${JSON.stringify(api)};
  let vt = 0;
  const EPOCH = ${Number(epoch)};
  // seeded random (mulberry32)
  let s = ${seed >>> 0} || 1;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // clock
  const RD = Date;
  function D(...a) { if (!new.target) return new RD(EPOCH + vt).toString(); return a.length ? new RD(...a) : new RD(EPOCH + vt); }
  D.prototype = RD.prototype; D.now = () => EPOCH + vt; D.parse = RD.parse; D.UTC = RD.UTC;
  window.Date = D;
  performance.now = () => vt;
  // timers
  let tid = 1; const timers = new Map();
  window.setTimeout = (fn, ms = 0, ...args) => { const id = tid++; timers.set(id, { id, at: vt + Math.max(0, +ms || 0), fn, args, iv: 0 }); return id; };
  window.setInterval = (fn, ms = 0, ...args) => { const id = tid++, iv = Math.max(1, +ms || 0); timers.set(id, { id, at: vt + iv, fn, args, iv }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  let rid = 1; let rafs = new Map();
  window.requestAnimationFrame = fn => { const id = rid++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = id => { rafs.delete(id); };
  window.requestIdleCallback = fn => window.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 8 }), 1);
  window.cancelIdleCallback = id => window.clearTimeout(id);
  // CSS animations and transitions follow the virtual clock
  const born = new WeakMap();
  function seek() {
    for (const a of document.getAnimations()) {
      let b = born.get(a);
      if (b === undefined) { b = vt; born.set(a, b); try { a.pause(); } catch (e) {} }
      try { a.currentTime = vt - b; } catch (e) {}
    }
  }
  const run = (fn, args) => { try { typeof fn === 'function' ? fn(...args) : (0, eval)(String(fn)); } catch (e) { console.error('timer error', e && e.stack || e); } };
  window.__vt = {
    get now() { return vt; },
    pending() { return timers.size; },
    async step(ms) {
      const target = vt + ms;
      for (let guard = 0; guard < 5000; guard++) {
        let next = null;
        for (const t of timers.values()) if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        if (!next) break;
        vt = Math.max(vt, next.at);
        if (next.iv) next.at += next.iv; else timers.delete(next.id);
        run(next.fn, next.args);
        await 0;
      }
      vt = target;
      const due = rafs; rafs = new Map();
      for (const fn of due.values()) run(fn, [vt]);
      await 0;
      seek();
      return vt;
    },
    seek,
  };
  // network: fail fast, on the virtual clock
  class DeadSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.onopen = this.onclose = this.onerror = this.onmessage = null;
      window.setTimeout(() => { this.readyState = 3; try { this.onerror && this.onerror({}); } catch (e) {} try { this.onclose && this.onclose({ code: 1006 }); } catch (e) {} }, 8); }
    send() {} close() { this.readyState = 3; } addEventListener() {} removeEventListener() {}
  }
  DeadSocket.CONNECTING = 0; DeadSocket.OPEN = 1; DeadSocket.CLOSING = 2; DeadSocket.CLOSED = 3;
  window.WebSocket = DeadSocket;
  const realFetch = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const url = String(u && u.url || u);
    if (/^https:\\/\\/fonts\\.(googleapis|gstatic)\\.com\\//.test(url)) return realFetch(u, o);
    const m = /\\/api\\/([\\w\\/-]+)/.exec(url), body = m && window.__promoApi[m[1]];
    return new Promise((res, rej) => window.setTimeout(() => body
      ? res({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) })
      : rej(new TypeError('offline (promo capture)')), 40));
  };
  try { navigator.sendBeacon = () => true; } catch (e) {}
  try { delete window.AudioContext; delete window.webkitAudioContext; } catch (e) {}
  window.AudioContext = undefined; window.webkitAudioContext = undefined;
})();`;
