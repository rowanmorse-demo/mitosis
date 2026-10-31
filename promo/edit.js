// Cuts the filmed takes into the trailers described in cuts.js and writes them to promo/out/:
// picture composited frame by frame in headless Chrome (crops, punch-ins, shakes, titles in the game's fonts),
// encoded with ffmpeg; sound = the game's own sfx at the moments they happen on screen, plus (or minus) the beat.
//   node promo/edit.js              all cuts, from promo/.work/takes (run capture.js first)
//   node promo/edit.js --preview    from the 768×432 preview takes (fast, soft: for checking timing)
//   node promo/edit.js --only=mitosis-trailer-15s-9x16
'use strict';
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const { launch } = require('./lib/chrome'), { ensureFonts } = require('./lib/fonts'), { renderAudio } = require('./lib/audio'), { ROOT } = require('./lib/game');
const EDITOR = require('./lib/editor-page');
const { BPM, cuts } = require('./cuts');

const arg = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--(\w+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const FPS = 60, SPB = 60 / BPM, SR = 48000;
const WORK = path.join(__dirname, '.work'), SRC = path.join(WORK, arg.preview ? 'preview' : 'takes'), OUT = path.join(__dirname, 'out');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- takes ----------
const metas = {};
function meta(id) {
  if (metas[id]) return metas[id];
  const file = path.join(SRC, id, 'meta.json');
  if (!fs.existsSync(file)) throw new Error(`no take "${id}" in ${SRC}: run node promo/capture.js${arg.preview ? ' --preview' : ''} first`);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.dir = path.join(SRC, id, 'frames');
  m.markF = name => { const k = m.marks.find(x => x.name === name); if (!k) throw new Error(`take ${id} has no mark "${name}" (marks: ${m.marks.map(x => x.name).join(', ')})`); return k.f; };
  // what the camera should follow, smoothed so the crop glides instead of twitching with every target change
  const n = m.track.length, raw = { hero: [], interest: [], mid: [] };
  for (const t of m.track) {
    const h = [t.hx, t.hy], i = t.ix == null ? h : [t.ix, t.iy];
    const inView = p => p[0] > -60 && p[0] < m.view.w + 60 && p[1] > -60 && p[1] < m.view.h + 60;
    raw.hero.push(h); raw.interest.push(inView(i) ? i : h); raw.mid.push(inView(i) ? [(h[0] + i[0]) / 2, (h[1] + i[1]) / 2] : h);
  }
  m.focus = {};
  for (const k in raw) {
    const R = 18, out = [];
    for (let f = 0; f < n; f++) { let sx = 0, sy = 0, sw = 0; for (let j = -R; j <= R; j++) { const q = raw[k][Math.max(0, Math.min(n - 1, f + j))], w = 1 - Math.abs(j) / (R + 1); sx += q[0] * w; sy += q[1] * w; sw += w; } out.push([sx / sw, sy / sw]); }
    m.focus[k] = out;
  }
  return (metas[id] = m);
}
const frameFile = (m, f) => { const i = Math.max(0, Math.min(m.frames - 1, Math.round(f))); return path.join(m.dir, String(i - (i % (m.every || 1))).padStart(6, '0') + '.jpg'); };

// ---------- curves ----------
const smooth = x => x * x * (3 - 2 * x);
function keyed(keys, b, def) { // eased between keys
  if (keys == null) return def; if (typeof keys === 'number') return keys;
  if (b <= keys[0][0]) return keys[0][1]; const last = keys[keys.length - 1]; if (b >= last[0]) return last[1];
  for (let i = 0; i < keys.length - 1; i++) { const [b0, v0] = keys[i], [b1, v1] = keys[i + 1]; if (b >= b0 && b <= b1) return v0 + (v1 - v0) * smooth((b - b0) / (b1 - b0 || 1)); }
  return def;
}
function rateIntegral(rate, b0, b1) { // ∫ rate over [b0, b1] in beats (rate: number, or [[beat, r]] steps)
  if (rate == null) return b1 - b0; if (typeof rate === 'number') return (b1 - b0) * rate;
  const sign = b1 < b0 ? -1 : 1; let lo = Math.min(b0, b1), hi = Math.max(b0, b1), sum = 0;
  const rAt = b => { let r = rate[0][1]; for (const [k, v] of rate) if (b >= k) r = v; return r; };
  const edges = [lo, ...rate.map(k => k[0]).filter(k => k > lo && k < hi), hi];
  for (let i = 0; i < edges.length - 1; i++) sum += (edges[i + 1] - edges[i]) * rAt((edges[i] + edges[i + 1]) / 2);
  return sign * sum;
}
// the take frame on screen at beat b of a shot (b relative to the shot's start)
const srcFrame = (shot, m, b) => m.markF(shot.anchor) + rateIntegral(shot.rate, shot.at, b) * SPB * FPS;
function hits(list, b) { let v = 0; for (const [b0, a] of list || []) { const dt = (b - b0) * SPB; if (dt >= 0) v += a * Math.exp(-dt / .16) * Math.min(1, dt / .03 + .4); } return v; }
const noise = (t, s) => Math.sin(t * 61.3 + s) * .6 + Math.sin(t * 97.1 + s * 2.3) * .4;

// ---------- one output frame ----------
function frameSpec(cut, i) {
  const t = i / FPS, B = t / SPB, shot = cut.shots.find(s => B >= s.from && B < s.to) || cut.shots[cut.shots.length - 1];
  const b = B - shot.from, m = meta(shot.take), f = srcFrame(shot, m, b), fi = Math.max(0, Math.min(m.frames - 1, Math.round(f)));
  const SW = m.size[0], SH = m.size[1], dsf = m.dsf, aspect = cut.w / cut.h;
  let z = keyed(shot.zoom, b, 1) * (1 + hits(shot.punch, b));
  const sh = hits(shot.shake, b) * (cut.w / 1920); // px of output
  let cw = Math.min(SW, SH * aspect), ch = cw / aspect;
  const margin = Math.abs(sh) * 1.4 * (cw / cut.w); z = Math.max(z, cw / Math.max(1, cw - 2 * margin));
  cw /= z; ch /= z;
  let fx, fy;
  if (shot.focus === 'pan') { fx = keyed(shot.pan, b, m.view.w / 2) * dsf; fy = SH / 2; }
  else if (Array.isArray(shot.focus)) { fx = shot.focus[0] * dsf; fy = shot.focus[1] * dsf; }
  else {
    let p;
    if (shot.focus === 'mix') { const h = m.focus.hero[fi], q = m.focus.interest[fi], k = keyed(shot.mix, b, .5); p = [h[0] + (q[0] - h[0]) * k, h[1] + (q[1] - h[1]) * k]; }
    else p = m.focus[shot.focus || 'hero'][fi];
    fx = p[0] * dsf; fy = p[1] * dsf;
    // whatever the crop follows, the hero stays in the picture (the vertical crop is narrow)
    const h = m.focus.hero[fi], hx = h[0] * dsf, hy = h[1] * dsf, kx = cw * (shot.keep || .36), ky = ch * (shot.keep || .36);
    fx = Math.max(hx - kx, Math.min(hx + kx, fx)); fy = Math.max(hy - ky, Math.min(hy + ky, fy));
  }
  if (shot.offset) { fx += shot.offset[0] * dsf; fy += shot.offset[1] * dsf; } // frame the subject off-centre (room for a title)
  const k = (cut.w / cw); // output px per source px
  fx += noise(t, 1.7) * sh / k; fy += noise(t, 4.1) * sh / k;
  const sx = Math.max(0, Math.min(SW - cw, fx - cw / 2)), sy = Math.max(0, Math.min(SH - ch, fy - ch / 2));
  const overlays = [];
  let flash = 0;
  for (const o of cut.overlays) if (B >= o.from && B < o.to) {
    const lt = (B - o.from) * SPB; overlays.push({ ...o, lt, dur: (o.to - o.from) * SPB });
    if (o.style === 'slam' || o.style === 'stack') flash = Math.max(flash, .32 * Math.max(0, 1 - lt / .1));
  }
  return { src: 'file://' + frameFile(m, f), sx: +sx.toFixed(2), sy: +sy.toFixed(2), sw: +cw.toFixed(2), sh: +ch.toFixed(2), dim: shot.dim || 0, blur: shot.blur || 0, overlays, flash };
}

// ---------- the sound: every logged game sound that plays on screen, at the moment it shows ----------
function soundEvents(cut) {
  const ev = [], total = cut.beats * SPB * FPS;
  for (let i = 0; i < total; i++) {
    const B = i / FPS / SPB, shot = cut.shots.find(s => B >= s.from && B < s.to); if (!shot) continue;
    if (shot.mute) continue; const m = meta(shot.take), b = B - shot.from;
    const f1 = srcFrame(shot, m, b), f0 = (B - 1 / FPS / SPB < shot.from) ? f1 - .51 : srcFrame(shot, m, b - 1 / FPS / SPB);
    if (f1 <= f0) continue;
    for (const s of m.sfx) if (s.f > f0 && s.f <= f1) ev.push({ t: (i - (f1 - s.f) / (f1 - f0)) / FPS, k: s.k, a: s.a });
  }
  for (const [b, k, a = 0] of cut.sfx || []) ev.push({ t: b * SPB, k, a });
  return ev.sort((a, b) => a.t - b.t);
}

function ff(args) { execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] }); }
function loudness(file) {
  const r = require('child_process').spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr, j = s.slice(s.lastIndexOf('{'), s.lastIndexOf('}') + 1); return JSON.parse(j);
}
// bring a WAV to I LUFS: plain gain into a peak limiter (ceiling -1.5 dBFS), measured and corrected once more
function normalize(inp, out, I) {
  let gain = I - +loudness(inp).input_i;
  for (let pass = 0; pass < 2; pass++) {
    ff(['-i', inp, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:attack=2:release=80:level=false`, '-ar', String(SR), '-c:a', 'pcm_s16le', out]);
    const got = +loudness(out).input_i; if (Math.abs(got - I) < .4) break; gain += I - got;
  }
}

async function render(browser, cut) {
  const total = Math.round(cut.beats * SPB * FPS), dur = total / FPS, tmp = path.join(WORK, 'edit', cut.name);
  fs.mkdirSync(tmp, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  for (const s of cut.shots) meta(s.take);
  console.log(`${cut.name}: ${cut.w}×${cut.h}, ${dur.toFixed(2)} s, ${cut.shots.length} shots`);

  // sound first (quick): the sfx bed and the music, then the two mixes
  const events = soundEvents(cut);
  const a = await renderAudio(browser, { events, dur, score: cut.music ? { ...cut.music, bpm: BPM } : null, sr: SR });
  const sfxWav = path.join(tmp, 'sfx.wav'), musWav = path.join(tmp, 'music.wav');
  fs.writeFileSync(sfxWav, a.sfx); if (a.music) fs.writeFileSync(musWav, a.music);
  console.log(`  sound: ${events.length} game sounds (peak ${a.sfxPeak.toFixed(2)})${a.music ? `, music (peak ${a.musicPeak.toFixed(2)})` : ''}`);
  const mixNo = path.join(tmp, 'mix-nomusic.wav'), mixMu = path.join(tmp, 'mix-music.wav');
  normalize(sfxWav, mixNo, -16);
  if (a.music) {
    // the game sounds sit on top of the beat: bring the bed to a level, the beat under it, then normalise the sum
    const sfxN = path.join(tmp, 'sfx-n.wav'), musN = path.join(tmp, 'music-n.wav'), sum = path.join(tmp, 'sum.wav');
    normalize(sfxWav, sfxN, -17); normalize(musWav, musN, -18);
    ff(['-i', sfxN, '-i', musN, '-filter_complex', '[0:a]volume=1.0[s];[1:a]volume=0.82[m];[s][m]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.9:level=false', '-c:a', 'pcm_s16le', sum]);
    normalize(sum, mixMu, -14);
  }

  // picture
  const page = await browser.newPage();
  const video = path.join(tmp, 'video.mp4');
  try {
    await page.send('Page.enable'); await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: cut.w, height: cut.h, deviceScaleFactor: 1, mobile: false });
    const html = path.join(WORK, 'editor.html'); fs.writeFileSync(html, EDITOR);
    fs.copyFileSync(path.join(ROOT, 'ios/Mitosis/Assets.xcassets/AppIcon.appiconset/icon-1024.png'), path.join(WORK, 'icon.png'));
    await page.send('Page.navigate', { url: 'file://' + html });
    for (let i = 0; ; i++) { if (await page.eval('typeof window.frame==="function"&&document.readyState==="complete"').catch(() => false)) break; if (i > 300) throw new Error('editor page did not load'); await sleep(200); }
    if (!await page.eval('ready()')) console.warn('  warning: the game fonts did not load in the editor');
    await page.eval(`size(${cut.w}, ${cut.h})`);
    const enc = spawn(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', arg.preview ? 'veryfast' : 'slow', '-crf', arg.preview ? '22' : '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS), '-movflags', '+faststart', video], { stdio: ['pipe', 'ignore', 'inherit'] });
    const done = new Promise((res, rej) => enc.on('exit', c => c === 0 ? res() : rej(new Error('ffmpeg exited ' + c))));
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      const spec = frameSpec(cut, i);
      await page.eval(`frame(${JSON.stringify(spec)})`);
      const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
      if (!enc.stdin.write(Buffer.from(shot.data, 'base64'))) await new Promise(r => enc.stdin.once('drain', r));
      if (i % 300 === 299) console.log(`  picture: ${i + 1}/${total} frames, ${((Date.now() - t0) / (i + 1)).toFixed(0)} ms/frame`);
    }
    enc.stdin.end(); await done;
  } finally { await page.close(); }

  // the two versions: same picture, with and without the music
  const outs = [];
  const mux = (wav, file) => { ff(['-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', String(SR), '-shortest', '-movflags', '+faststart', file]); outs.push(file); };
  if (a.music) mux(mixMu, path.join(OUT, cut.name + '.mp4'));
  mux(mixNo, path.join(OUT, cut.name + '-nomusic.mp4'));
  for (const o of outs) console.log('  wrote', path.relative(ROOT, o));
}

(async () => {
  const list = cuts.filter(c => !arg.only || String(arg.only).split(',').includes(c.name));
  if (!list.length) throw new Error('no cut named ' + arg.only);
  await ensureFonts(WORK);
  const browser = await launch({ gpu: true });
  try { for (const c of list) await render(browser, c); }
  finally { browser.close(); }
})().catch(e => { console.error('edit failed:', e.stack || e.message); process.exitCode = 1; require('./lib/chrome').killCurrent(); });
