// The trailer's sound, rendered offline in headless Chrome:
//  - sfx: the game's own sound code (initAudio, voice, hiss, sfx… cut straight out of index.html) replayed in an
//    OfflineAudioContext at the times the edit puts each logged sfx(kind, amount) call. The context is wrapped so
//    the game code sees currentTime = the event's time, and its 40-voice limit counts the voices still sounding then.
//  - music: the beat in music.js, following the cut's score.
// Both come back as 16-bit stereo WAV buffers, mixed later by ffmpeg.
'use strict';
const fs = require('fs'), path = require('path');
const { ROOT } = require('./game');
const MUSIC = require('./music');

function gameAudioSource() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf('function initAudio(){'), b = html.indexOf('/* ================= live room');
  if (a < 0 || b < 0 || b < a) throw new Error('promo/lib/audio.js: could not find the sound code in index.html (from "function initAudio(){" to the live-room section)');
  return html.slice(a, b);
}

const PAGE = (gameAudio) => `
window.__wav = function (buf) {
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate, data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
  data.setUint16(22, ch, true); data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  w(36, 'data'); data.setUint32(40, n * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44, peak = 0; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = chans[c][i]; if (Math.abs(v) > peak) peak = Math.abs(v); data.setInt16(o, Math.max(-1, Math.min(1, v)) * 32767, true); o += 2; }
  const bytes = new Uint8Array(data.buffer); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return { b64: btoa(s), peak };
};
window.__sfx = async function (events, dur, sr) {
  let seed = 4242; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  let cur = 0; const ends = [];
  const proxy = new Proxy(off, { get(t, k) {
    if (k === 'currentTime') return cur; if (k === 'state') return 'running'; if (k === 'resume') return () => Promise.resolve();
    const v = Reflect.get(t, k, t);
    if (typeof v === 'function') {
      if (k === 'createOscillator' || k === 'createBufferSource') return (...a) => { const node = v.apply(t, a), st = node.stop.bind(node); node.stop = when => { ends.push(when == null ? cur : when); st(when); }; return node; };
      return v.bind(t);
    }
    return v;
  } });
  window.AudioContext = function () { return proxy; }; window.webkitAudioContext = undefined;
  const game = (function () {
    let actx = null, master = null, noiseBuf = null, muted = false; const rand = (a, b) => a + Math.random() * (b - a);
    ${gameAudio}
    return { initAudio, sfx, setLive(n) { liveNodes = n; } };
  })();
  game.initAudio();
  for (const e of events) { if (e.t < 0 || e.t > dur) continue; cur = e.t; game.setLive(ends.filter(x => x > cur).length); game.sfx(e.k, e.a); }
  return window.__wav(await off.startRendering());
};
${MUSIC}
window.__music = async function (score, sr) { return window.__wav(await music(score, sr)); };
`;

async function renderAudio(browser, { events, dur, score, sr = 48000 }) {
  const s = await browser.newPage();
  try {
    await s.send('Runtime.enable');
    await s.eval(PAGE(gameAudioSource()));
    const fx = await s.eval(`__sfx(${JSON.stringify(events)}, ${dur}, ${sr})`);
    const mu = score ? await s.eval(`__music(${JSON.stringify({ ...score, dur })}, ${sr})`) : null;
    return { sfx: Buffer.from(fx.b64, 'base64'), sfxPeak: fx.peak, music: mu && Buffer.from(mu.b64, 'base64'), musicPeak: mu && mu.peak };
  } finally { await s.close(); }
}
module.exports = { renderAudio };
