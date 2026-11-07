// An original track for the trailers, synthesised with Web Audio in an OfflineAudioContext (no samples, no copyrighted
// material). It follows the cut: the edit hands it a score (tempo, sections, where the hits land) and it plays a
// 128 BPM electro-pop arrangement in E minor over Em–C–G–D, which sits with the game's own G-major pentatonic bells:
//   hook   the cold open: kick, clap, hats, an off-beat bass, the hook melody on a pluck, light off-beat chord stabs
//   drop   the full groove: rolling bass locked to the kick, pumping wide chords, the lead hook on a gliding synth,
//          crashes on phrase starts, a snare fill at the end of each four bars
//   drop2  the same, lifted: off-beat open hats, the lead doubled an octave down and up, a 16th arp, a bouncier bass
//   build  an accelerating snare roll (quarters, eighths, sixteenths, thirty-seconds), gated chords through an opening
//          low-pass, kick dropping out for the last beat, a riser if the score has none there
//   break / intro  a soft pad, a sub, a half-time pulse; in a break the hook comes back on a bell
// A section that runs into a drop, a hook, or a boom/hit ends in a half-beat gap with a reversed cymbal swelling
// into the downbeat (every build does). Chords run from the start of drops and hooks, and line up with the end of
// builds and breaks so those always finish on D, leading back to Em.
// The score: { bpm, dur, sections: [{ from, to, kind, gap?, lead? }] (beats; kinds hook|intro|break|build|drop|drop2,
//   anything else is silence), hits: [{ beat, kind, chord?, v? }] (boom|hit|clap|whoosh|stab|swell|crash|kick;
//   a swell is a reversed cymbal ending on the beat, `beats` long, default 1), risers: [{ from, to, v? }],
//   endRing: beat (the end card: the tonic chord and the hook's first three notes ring out),
//   gap? (beats, default .5), chordShift? (whole bars) }.  A section's `gap` overrides the default, `lead: false` mutes its melody.
// Exported as the source of a function that runs inside the page: music(score, sr) → Promise<AudioBuffer>.
'use strict';
module.exports = String.raw`
async function music(score, sr) {
  const spb = 60 / score.bpm, s16 = spb / 4, dur = score.dur;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const hz = m => 440 * Math.pow(2, (m - 69) / 12), T = x => Math.max(0, x);
  const gain = (v, ...to) => { const g = ctx.createGain(); g.gain.value = v; for (const n of to) g.connect(n); return g; };
  // low/high-pass Q is in dB in Web Audio (0 = a gentle corner); band-pass and peaking Q are plain ratios
  const filt = (type, f, q = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const osc = (type, f, det = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; return o; };
  const pan = (v, to) => { const p = ctx.createStereoPanner(); p.pan.value = v; p.connect(to); return p; };

  // ---------- one-shots drawn sample by sample: cheap to replay hundreds of times, and identical on every render
  const buf = (secs, ch = 1) => ctx.createBuffer(ch, Math.max(1, Math.ceil(secs * sr)), sr);
  const white = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rnd() * 2 - 1; return a; };
  function biq(x, type, f, q = .707, db = 0) { // RBJ biquad, in place (Q here is a plain ratio)
    const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), A = Math.pow(10, db / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const x0 = x[i], y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0; }
    return x;
  }
  function norm(b, pk) {
    let m = 1e-9; for (let c = 0; c < b.numberOfChannels; c++) for (const v of b.getChannelData(c)) m = Math.max(m, Math.abs(v));
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= pk / m; }
    return b;
  }
  const fadeOut = (d, ms) => { const n = Math.min(d.length, Math.round(ms * sr / 1000)); for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n; };
  function metal(n, mul) { // six detuned square waves: the classic metallic source for hats and cymbals
    const a = new Float32Array(n), fr = [205.3, 304.4, 369.6, 522.7, 540, 800], ph = fr.map(() => rnd());
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 6; k++) s += ((ph[k] + i * fr[k] * mul / sr) % 1) < .5 ? 1 : -1; a[i] = s / 6; }
    return a;
  }
  // kick: a sine falling 220 → 47 Hz, held then decaying, driven into tanh for harmonics a phone speaker can play,
  // with a noise click and a short 1.7 kHz tick on top
  const KICK = (() => {
    const b = buf(.45), d = b.getChannelData(0), n = d.length, nz = biq(white(n), 'hp', 2500); let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; ph += 2 * Math.PI * (47 + 155 * Math.exp(-t / .024) + 18 * Math.exp(-t / .14)) / sr;
      const amp = t < .03 ? 1 : Math.exp(-(t - .03) / .12);
      d[i] = Math.tanh(2 * Math.sin(ph) * amp) / Math.tanh(2) * .92 + nz[i] * Math.exp(-t / .0022) * .6 + Math.sin(2 * Math.PI * 1700 * t) * Math.exp(-t / .0035) * .22;
    }
    fadeOut(d, 20); return norm(b, .95);
  })();
  // snare/clap: a tuned body (182 Hz, pitched down from 250), a noise snare and three clap bursts with a short tail,
  // different noise left and right so it is wide
  const SNARE = (() => {
    const b = buf(.45, 2), n = b.length, body = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += 2 * Math.PI * (182 + 70 * Math.exp(-t / .012)) / sr; body[i] = (Math.sin(ph) + .3 * Math.sin(ph * 2.1)) * Math.exp(-t / .05); }
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c), sn = biq(biq(white(n), 'hp', 1200), 'lp', 10000), cl = biq(white(n), 'bp', 1400, 1.1);
      for (let i = 0; i < n; i++) {
        const t = i / sr; let ce = 0; for (const o of [0, .0095, .0195]) if (t >= o) ce = Math.max(ce, Math.exp(-(t - o) / .0042));
        const tail = t >= .027 ? Math.exp(-(t - .027) / .09) : 0;
        d[i] = body[i] * .5 + sn[i] * Math.exp(-t / .12) * .45 + cl[i] * (ce * 2.2 + tail * 1.6);
      }
      fadeOut(d, 30);
    }
    return norm(b, .9);
  })();
  function cymbal(secs, ch, mul, hp, tau, attackMs) {
    const b = buf(secs, ch), n = b.length;
    for (let c = 0; c < ch; c++) {
      const d = b.getChannelData(c), m = metal(n, mul * (1 + c * .013)), nz = white(n);
      for (let i = 0; i < n; i++) d[i] = m[i] * .65 + nz[i] * .55;
      biq(d, 'hp', hp); biq(d, 'hp', hp); biq(d, 'pk', hp * 1.45, 1.2, 3); biq(d, 'lp', 14000);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] *= Math.min(1, t * 1000 / attackMs) * Math.exp(-t / tau); }
      fadeOut(d, Math.min(30, secs * 300));
    }
    return norm(b, .9);
  }
  const HAT = cymbal(.09, 1, 1.6, 7200, .017, .5), OHAT = cymbal(.42, 1, 1.6, 6800, .11, 1), CRASH = cymbal(2.4, 2, 2.9, 4200, .55, 1);
  const REV = (() => { const b = buf(CRASH.duration, 2); for (let c = 0; c < 2; c++) { const s = CRASH.getChannelData(c), d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = s[s.length - 1 - i]; } return b; })();
  const SHAKER = (() => { const b = buf(.12), d = b.getChannelData(0); d.set(white(d.length)); biq(d, 'bp', 6500, .8); biq(d, 'hp', 3000);
    for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] *= Math.min(1, t / .006) * Math.exp(-Math.max(0, t - .006) / .028); } fadeOut(d, 10); return norm(b, .9); })();
  // the impact's sub: 92 → 30 Hz over a second, saturated so it is felt on small speakers too
  const SUB = (() => { const b = buf(2.2), d = b.getChannelData(0); let ph = 0;
    for (let i = 0; i < d.length; i++) { const t = i / sr; ph += 2 * Math.PI * (30 + 62 * Math.exp(-t / .35)) / sr; d[i] = Math.tanh(2.2 * Math.sin(ph)) * Math.min(1, t / .002) * Math.exp(-t / .7); }
    fadeOut(d, 60); return norm(b, .95); })();
  const NOISE = (() => { const b = buf(2, 2); for (let c = 0; c < 2; c++) b.getChannelData(c).set(white(b.length)); return b; })();
  // reverbs: decorrelated noise tails that darken as they decay
  function ir(secs, tau, f0, f1, pre) {
    const b = buf(secs, 2);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c), p0 = Math.round(pre * sr); let y = 0;
      for (let i = p0; i < d.length; i++) { const t = (i - p0) / sr, a = Math.exp(-2 * Math.PI * f0 * Math.pow(f1 / f0, t / secs) / sr); y = (1 - a) * (rnd() * 2 - 1) + a * y; d[i] = y * Math.exp(-t / tau) * Math.min(1, t / .004); }
      fadeOut(d, 60);
    }
    return b;
  }

  // ---------- the mix: groups into a glue compressor, a trim and a soft ceiling that never lets a sample reach full scale
  const master = gain(1), lowcut = filt('highpass', 26, -3), air = filt('highshelf', 5000), comp = ctx.createDynamicsCompressor(), trim = gain(.55), ceiling = ctx.createWaveShaper();
  comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 2; comp.attack.value = .012; comp.release.value = .16;
  { const c = new Float32Array(4097), k = .8; for (let i = 0; i < c.length; i++) { const x = i / 2048 - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a < k ? a : k + (.985 - k) * Math.tanh((a - k) / (.985 - k))); } ceiling.curve = c; ceiling.oversample = '2x'; }
  air.gain.value = 2; master.connect(lowcut); lowcut.connect(air); air.connect(comp); comp.connect(trim); trim.connect(ceiling); ceiling.connect(ctx.destination);
  const room = ctx.createConvolver(); room.buffer = ir(.9, .13, 9000, 3000, .008); const roomIn = gain(1, room), roomOut = gain(.5, master); room.connect(roomOut);
  const hall = ctx.createConvolver(); hall.buffer = ir(3, .45, 10000, 2200, .022); const hallIn = gain(1, hall), hallHp = filt('highpass', 280, -3), hallOut = gain(.55, master); hall.connect(hallHp); hallHp.connect(hallOut);
  // sidechain: three ducks driven by every kick (deep on the bass, a pump on the chords, a touch on the lead)
  const duckBass = gain(1, master), duckSynth = gain(1, master), duckLead = gain(1, master);
  // a dotted-eighth ping-pong for the lead and bells
  const dlyIn = gain(1), dl = ctx.createDelay(2), dr = ctx.createDelay(2), dlp = filt('lowpass', 3600, -3), dhp = filt('highpass', 400, -3), fb = gain(.34), merge = ctx.createChannelMerger(2), dlyOut = gain(.32, duckLead);
  dl.delayTime.value = spb * .75; dr.delayTime.value = spb * .75;
  dlyIn.connect(dhp); dhp.connect(dl); dl.connect(dlp); dlp.connect(dr); dr.connect(fb); fb.connect(dl); dl.connect(merge, 0, 0); dr.connect(merge, 0, 1); merge.connect(dlyOut);
  const drumBus = gain(1, master), kickBus = gain(.88, drumBus), snareBus = gain(1.1, drumBus), hatBus = gain(.78, drumBus), cymBus = gain(.28, drumBus);
  snareBus.connect(gain(.32, roomIn)); snareBus.connect(gain(.05, hallIn)); hatBus.connect(gain(.08, roomIn)); cymBus.connect(gain(.12, hallIn));
  const bassLp = filt('lowpass', 2600, -3), bassBus = gain(.34, bassLp); bassLp.connect(duckBass);
  const synthHp = filt('highpass', 170, -3), synthBus = gain(1, synthHp); synthHp.connect(duckSynth); synthHp.connect(gain(.12, hallIn));
  const leadHp = filt('highpass', 260, -3), presence = filt('peaking', 2400, .8), leadBus = gain(1, leadHp);
  presence.gain.value = 2.5; leadHp.connect(presence); presence.connect(duckLead); presence.connect(gain(.24, dlyIn)); presence.connect(gain(.14, hallIn));
  const fxBus = gain(.9, master); fxBus.connect(gain(.22, hallIn));

  // ---------- players
  const kicks = [];
  function play(b, t, v, dest, rate = 1, p = 0, off = 0) {
    const s = ctx.createBufferSource(), g = gain(v); s.buffer = b; s.playbackRate.value = rate; s.connect(g);
    g.connect(p ? pan(p, dest) : dest); s.start(T(t), off); return g;
  }
  let open = null; // an open hat is choked by the next closed one, like a real pair of hats
  const kick = (t, v = 1) => { play(KICK, t, v, kickBus); kicks.push([t, v]); };
  const snare = (t, v = 1, rate = 1) => play(SNARE, t, v, snareBus, rate);
  const hat = (t, v) => { if (open && open[0] < t) { open[1].gain.setTargetAtTime(0, t, .006); open = null; } play(HAT, t, v, hatBus, 1, .18); };
  const ohat = (t, v) => { open = [t, play(OHAT, t, v, hatBus, 1, -.15)]; };
  const shaker = (t, v) => play(SHAKER, t, v, hatBus, 1, -.3);
  const crash = (t, v = 1) => play(CRASH, t, v, cymBus);
  function swell(t, len, v = .7) { // the crash backwards, ending on t
    const st = T(t - Math.min(len, REV.duration - .01)), g = play(REV, st, v, cymBus, 1, 0, REV.duration - (t - st));
    g.gain.setValueAtTime(.001, st); g.gain.exponentialRampToValueAtTime(v, T(t - .004)); g.gain.linearRampToValueAtTime(0, t + .004);
  }
  function noiseSrc(t, len) { const s = ctx.createBufferSource(); s.buffer = NOISE; s.loop = true; s.start(T(t), rnd() * 1.5); s.stop(t + len); return s; }

  function bassNote(t, d, m, v, cut) { // sine for weight, saw + square through an enveloped low-pass for definition
    const f = hz(m), g = ctx.createGain(), lp = filt('lowpass', cut, 3), s = osc('sine', f), a = osc('sawtooth', f, -6), q = osc('square', f, 6), sg = gain(.6, g), ag = gain(.3, lp);
    lp.frequency.setValueAtTime(cut, t); lp.frequency.setTargetAtTime(cut * .28, t + .004, Math.max(.03, d * .45));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .004); g.gain.setValueAtTime(v, t + d - .018); g.gain.linearRampToValueAtTime(0, t + d);
    s.connect(sg); a.connect(ag); q.connect(ag); lp.connect(g); g.connect(bassBus);
    for (const o of [s, a, q]) { o.start(t); o.stop(t + d + .01); }
  }
  function subNote(t, d, m, v) { // a held sine for the soft sections
    const s = osc('sine', hz(m)), tri = osc('triangle', hz(m)), g = ctx.createGain(); s.connect(g); tri.connect(gain(.15, g)); g.connect(bassBus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .06); g.gain.setValueAtTime(v, T(t + d - .12)); g.gain.linearRampToValueAtTime(0, t + d);
    s.start(t); tri.start(t); s.stop(t + d + .01); tri.stop(t + d + .01);
  }
  function chordPad(t, d, notes, o) { // detuned saws spread across the stereo field
    const lp = filt('lowpass', o.cut, -1), g = gain(0), n = notes.length * o.voices, lvl = o.lvl / Math.sqrt(n);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + o.att); g.gain.setValueAtTime(lvl, Math.max(t + o.att, t + d - o.rel)); g.gain.linearRampToValueAtTime(0, t + d);
    if (o.sweep) { lp.frequency.setValueAtTime(o.cut * .5, t); lp.frequency.exponentialRampToValueAtTime(o.cut, t + d); }
    lp.connect(g); g.connect(o.dest || synthBus);
    for (const m of notes) for (let k = 0; k < o.voices; k++) {
      const x = o.voices === 1 ? 0 : k / (o.voices - 1) * 2 - 1, os = osc('sawtooth', hz(m), x * o.det + (rnd() - .5) * 4);
      os.connect(pan(x * o.wide, lp)); os.start(T(t - rnd() * .02)); os.stop(t + d + .02);
    }
  }
  function stab(t, notes, len, v, cut, dest = synthBus) { // a bright chord hit with a falling filter
    const lp = filt('lowpass', cut, 3), g = ctx.createGain(), lvl = .2 * v / Math.sqrt(notes.length * 3);
    lp.frequency.setValueAtTime(cut * 1.6, t); lp.frequency.setTargetAtTime(cut * .3, t + .01, len * .4);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + .004); g.gain.setTargetAtTime(0, t + .02, len * .35);
    lp.connect(g); g.connect(dest);
    for (const m of notes) for (const det of [-12, 0, 12]) { const o = osc('sawtooth', hz(m), det + (rnd() - .5) * 3); o.connect(pan(det / 18, lp)); o.start(T(t)); o.stop(t + len * 2 + .05); }
  }
  function pluck(t, m, v, o) {
    const a = osc('sawtooth', hz(m)), q = osc('square', hz(m), 7), lp = filt('lowpass', o.cut, 4), g = ctx.createGain();
    lp.frequency.setValueAtTime(o.cut, t); lp.frequency.setTargetAtTime(o.cut * .14, t + .003, o.dec * .5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .003); g.gain.setTargetAtTime(0, t + .008, o.dec);
    a.connect(lp); q.connect(gain(.45, lp)); lp.connect(g); g.connect(pan(o.pan || 0, o.dest));
    a.start(t); q.start(t); a.stop(t + o.dec * 6 + .02); q.stop(t + o.dec * 6 + .02);
  }
  function bell(t, m, v, dec, dest) { // two-operator FM: bright on the strike, a pure tone as it rings
    const f = hz(m), c = osc('sine', f), md = osc('sine', f * 3.002), mg = ctx.createGain(), c2 = osc('sine', f * 2), g = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.4, t); mg.gain.setTargetAtTime(f * .12, t, .12); md.connect(mg); mg.connect(c.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .003); g.gain.setTargetAtTime(0, t + .006, dec / 3);
    c.connect(g); c2.connect(gain(.1, g)); g.connect(dest);
    for (const o of [c, md, c2]) { o.start(t); o.stop(t + dec * 2.5); }
  }
  // the lead: one monophonic voice per section, so legato notes glide into each other and long ones get vibrato
  function leadVoice(notes, o) {
    if (!notes.length) return;
    const t0 = notes[0].t, last = notes[notes.length - 1], t1 = last.t + last.d;
    const env = ctx.createGain(), lp = filt('lowpass', o.cut, 4), vib = osc('sine', 5.3), vibG = gain(0); env.gain.value = 0; vib.connect(vibG);
    const oscs = o.layers.map(([type, det, lvl, p, ratio]) => { const os = osc(type, 440, det); os.ratio = ratio; vibG.connect(os.detune); os.connect(gain(lvl, pan(p, lp))); return os; });
    lp.connect(env); env.connect(o.dest);
    notes.forEach((n, i) => {
      const prev = notes[i - 1], next = notes[i + 1], end = n.t + n.d, pk = o.level * n.v;
      const legato = prev && n.t - (prev.t + prev.d) < .005;
      for (const os of oscs) { const f = hz(n.m) * os.ratio; if (legato) os.frequency.setTargetAtTime(f, n.t, o.glide); else os.frequency.setValueAtTime(f, n.t); }
      env.gain.setTargetAtTime(pk, n.t, .003); env.gain.setTargetAtTime(pk * .72, n.t + .03, .16);
      lp.frequency.setTargetAtTime(o.cut * 2.1, n.t, .002); lp.frequency.setTargetAtTime(o.cut, n.t + .012, .09);
      if (next && next.t - end < .005) env.gain.setTargetAtTime(pk * .3, end - .022, .007);
      else env.gain.setTargetAtTime(0, end - .015, .02);
      if (n.d > .4) { vibG.gain.setValueAtTime(0, n.t + .12); vibG.gain.linearRampToValueAtTime(o.vib, n.t + Math.min(n.d * .6, .42)); vibG.gain.setValueAtTime(o.vib, end - .03); vibG.gain.linearRampToValueAtTime(0, end); }
    });
    for (const os of oscs) { os.start(T(t0 - .02)); os.stop(t1 + .3); } vib.start(T(t0 - .02)); vib.stop(t1 + .3);
  }
  const LEAD1 = { cut: 2700, level: .54, glide: .014, vib: 16, layers: [['sawtooth', -9, .5, -.3, 1], ['sawtooth', 9, .5, .3, 1], ['square', 0, .32, 0, .5]] };
  const LEAD2 = { ...LEAD1, cut: 3000, layers: LEAD1.layers.concat([['triangle', 0, .3, 0, 2]]) };
  const LEADLOW = { cut: 1500, level: .22, glide: .014, vib: 10, layers: [['square', -5, .5, -.5, .5], ['sawtooth', 5, .5, .5, .5]] };

  // ---------- impacts and transitions
  function boom(t, v = 1) { // kick, crash, a falling sub, a noise blast going dark, and a low saw "braam"
    kick(t, v); crash(t, .9 * v); play(SUB, t, .8 * v, fxBus);
    const lp = filt('lowpass', 6000, -1), g = ctx.createGain(), ns = noiseSrc(t, 2);
    lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(110, t + 1.3);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.4 * v, t + .003); g.gain.setTargetAtTime(0, t + .015, .3);
    ns.connect(lp); lp.connect(g); g.connect(fxBus);
    const bl = filt('lowpass', 1100, 2), bg = ctx.createGain(); bl.frequency.setValueAtTime(1200, t); bl.frequency.exponentialRampToValueAtTime(130, t + 1.4);
    bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(.1 * v, t + .012); bg.gain.setTargetAtTime(0, t + .05, .4); bl.connect(bg); bg.connect(fxBus);
    for (const m of [28, 40, 47]) for (const det of [-11, 11]) { const o = osc('sawtooth', hz(m), det); o.connect(bl); o.start(t); o.stop(t + 2.2); }
  }
  function hit(t, v, ci) { // a title slam: kick, clap, crash, a short sub and a bright chord
    kick(t, v); snare(t, .9 * v); crash(t, .7 * v); play(SUB, t, .5 * v, fxBus, 1.4);
    stab(t, CH[ci].concat([CH[ci][1] + 12]), .5, 1.3 * v, 5000, fxBus);
  }
  function whoosh(t, v = 1) { // a short reversed swell sweeping left to right into a cut
    const L = .32, bp = filt('bandpass', 600, 1.2), g = ctx.createGain(), p = ctx.createStereoPanner(), ns = noiseSrc(t - L, L + .03);
    bp.frequency.setValueAtTime(500, T(t - L)); bp.frequency.exponentialRampToValueAtTime(5200, t);
    p.pan.setValueAtTime(-.6, T(t - L)); p.pan.linearRampToValueAtTime(.6, t);
    g.gain.setValueAtTime(.0001, T(t - L)); g.gain.exponentialRampToValueAtTime(.3 * v, t - .008); g.gain.linearRampToValueAtTime(0, t + .02);
    ns.connect(bp); bp.connect(g); g.connect(p); p.connect(fxBus);
  }
  function riser(t0, t1, v = 1) { // noise through a climbing resonant high-pass, and saws rising two octaves under an accelerating gate
    const ns = noiseSrc(t0, t1 - t0 + .05), hp = filt('highpass', 250, 6), g = ctx.createGain();
    hp.frequency.setValueAtTime(250, t0); hp.frequency.exponentialRampToValueAtTime(5500, t1);
    g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.3 * v, t1 - .01); g.gain.linearRampToValueAtTime(0, t1 + .015);
    ns.connect(hp); hp.connect(g); g.connect(fxBus);
    const pl = filt('lowpass', 700, 3), pg = ctx.createGain(), gate = gain(.5), lfo = osc('sine', 2 / spb), lg = gain(.5);
    pl.frequency.setValueAtTime(700, t0); pl.frequency.exponentialRampToValueAtTime(7000, t1);
    lfo.frequency.setValueAtTime(2 / spb, t0); lfo.frequency.exponentialRampToValueAtTime(8 / spb, t1); lfo.connect(lg); lg.connect(gate.gain);
    pg.gain.setValueAtTime(.0001, t0); pg.gain.exponentialRampToValueAtTime(.07 * v, t1 - .01); pg.gain.linearRampToValueAtTime(0, t1 + .015);
    pl.connect(gate); gate.connect(pg); pg.connect(fxBus);
    for (const [det, p] of [[-14, -.7], [0, 0], [14, .7]]) {
      const o = osc('sawtooth', hz(52), det); o.frequency.setValueAtTime(hz(52), t0); o.frequency.exponentialRampToValueAtTime(hz(76), t1);
      o.connect(pan(p, pl)); o.start(t0); o.stop(t1 + .05);
    }
    lfo.start(t0); lfo.stop(t1 + .05);
  }

  // ---------- the harmony and the hook
  const CH = [[52, 55, 59, 64], [48, 52, 55, 60], [55, 59, 62, 67], [50, 54, 57, 62]], ROOT = [40, 36, 43, 38];
  const VOX = [[55, 59, 64, 67], [55, 60, 64, 67], [55, 59, 62, 67], [54, 57, 62, 66]]; // close voicings, G3–G4, for pads and chords
  // the hook, eight bars of [16th, length in 16ths, note]: a two-bar call (Em, C) and its answer (G, D), played twice,
  // the second time rising into the repeat. Bar n always sits on chord n % 4.
  const A1 = [[0, 3, 76], [3, 3, 79], [6, 2, 83], [8, 2, 79], [10, 2, 81], [12, 4, 78]], A2 = [[0, 6, 76], [6, 2, 74], [8, 4, 76], [12, 4, 79]];
  const B1 = [[0, 3, 74], [3, 3, 79], [6, 2, 83], [8, 2, 81], [10, 2, 79], [12, 4, 81]];
  const LEAD = [A1, A2, B1, [[0, 6, 78], [6, 2, 76], [8, 8, 74]], A1, A2, B1, [[0, 3, 78], [3, 3, 79], [6, 2, 81], [8, 8, 83]]];
  const shift = Math.round(score.chordShift || 0); // whole bars: rotates the progression

  // ---------- the arrangement
  const KINDS = { hook: 1, intro: 1, break: 1, build: 1, drop: 1, drop2: 1 };
  const secs = (score.sections || []).filter(s => KINDS[s.kind] && s.to > s.from).map(s => ({ ...s })).sort((a, b) => a.from - b.from);
  const hits = score.hits || [], risers = score.risers || [];
  const impactAt = b => hits.some(h => Math.abs(h.beat - b) < .01 && (h.kind === 'boom' || h.kind === 'hit'));
  for (const s of secs) {
    const next = secs.find(o => o !== s && Math.abs(o.from - s.to) < .01);
    const into = (next && /^(drop|drop2|hook)$/.test(next.kind)) || impactAt(s.to);
    s.gap = s.gap != null ? s.gap : (s.kind === 'build' || into) ? (score.gap != null ? score.gap : .5) : 0;
    s.end = s.to - s.gap; // the groove stops here; risers and the reversed swell carry on to s.to
  }
  function barsOf(s) { // bars of 4 beats from the section's start, or (builds and breaks) back from its end
    const back = s.kind === 'build' || s.kind === 'break', out = [];
    if (back) for (let k = 0; s.to - 4 * k > s.from + 1e-6; k++) out.unshift({ start: s.to - 4 * (k + 1), c: 3 - (k % 4) });
    else for (let k = 0; s.from + 4 * k < s.to - 1e-6; k++) out.push({ start: s.from + 4 * k, c: k % 4 });
    out.forEach((B, i) => { B.i = i; B.last = i === out.length - 1; B.ci = ((B.c + shift) % 4 + 4) % 4; B.mel = LEAD[B.ci + 4 * (Math.floor(i / 4) % 2)]; });
    return out;
  }
  const swing = s16 * .07;
  for (const s of secs) {
    const K = s.kind, on = K === 'drop' || K === 'drop2', D2 = K === 'drop2', soft = K === 'break' || K === 'intro';
    const span = Math.max(.001, s.end - s.from), lead = [];
    if (K === 'build') { // gated chords through a low-pass that opens across the build
      const lp = filt('lowpass', 380, 6), g = gain(.35); lp.frequency.setValueAtTime(380, s.from * spb); lp.frequency.exponentialRampToValueAtTime(6500, s.end * spb);
      g.gain.setValueAtTime(.35, s.from * spb); g.gain.linearRampToValueAtTime(1, s.end * spb); lp.connect(g); g.connect(synthBus);
      s.buildLp = lp;
      if (!risers.some(r => r.to > s.from && r.from < s.to)) riser(Math.max(s.from, s.to - 4) * spb, s.to * spb, .7);
    }
    for (const B of barsOf(s)) {
      const a = Math.max(B.start, s.from), e = Math.min(B.start + 4, s.end); if (e <= a + 1e-6) continue;
      const ci = B.ci, root = ROOT[ci], vox = VOX[ci];
      if (on) chordPad(a * spb, (e - a) * spb, vox.concat([vox[2] + 12]), { lvl: D2 ? .38 : .34, cut: D2 ? 4200 : 3300, voices: 3, det: 16, wide: .85, att: .006, rel: .04 });
      if (soft) { chordPad(a * spb, (e - a) * spb, vox, { lvl: .22, cut: 1500, voices: 2, det: 11, wide: .7, att: .3, rel: .25, sweep: true }); subNote(a * spb, (e - a) * spb, root, .26); }
      for (let q = 0; q < 16; q++) {
        const beat = B.start + q / 4; if (beat < s.from - 1e-6 || beat >= s.end - 1e-6) continue;
        const t = beat * spb, bt = q >> 2, sub = q & 3, imp = impactAt(beat), sw = sub & 1 ? swing : 0;
        if (on || K === 'hook') {
          if (sub === 0 && !imp) kick(t, bt === 0 ? 1 : .92);
          if (sub === 0 && (bt === 1 || bt === 3)) snare(t, K === 'hook' ? .85 : 1);
          if (q === 0 && B.i % 4 === 0 && !imp) crash(t, B.i === 0 ? .85 : .5);
          if ((B.i % 4 === 3 || B.last) && !(B.last && s.gap > 0) && q >= 13) snare(t, .32 + (q - 13) * .17, 1 + (q - 13) * .04); // fill
          const oh = D2 ? sub === 2 : q === 14 && (B.i % 2 === 1 || K === 'drop');
          if (oh) ohat(t, D2 ? .62 : .75); else hat(t + sw, (sub === 2 ? .9 : sub === 0 ? .38 : sub === 1 ? .48 : .6) * (.92 + rnd() * .16) * (K === 'hook' ? .85 : 1));
          if (K === 'hook') {
            if (sub === 2) { bassNote(t, s16 * 1.75, root, .85, 1100); stab(t, vox, s16 * 1.4, 2.2, 2300); }
          } else if (sub > 0) {
            const up = D2 ? sub === 2 && bt % 2 === 1 : sub === 3 && bt === 3;
            bassNote(t, s16 * .84, root + (up ? 12 : 0), sub === 1 ? .9 : .78, D2 ? 1700 : 1350);
            if (D2) pluck(t, vox[[0, 1, 2, 3, 2, 1][(q - Math.floor(q / 4)) % 6]] + 12, .1, { cut: 2600, dec: .08, pan: q & 1 ? .5 : -.5, dest: synthBus });
          }
        } else if (K === 'build') {
          const rem = s.end - beat, prog = (beat - s.from) / span, step = rem > 4 ? 4 : rem > 2 ? 2 : 1;
          if (sub === 0 && rem > 1 + 1e-6 && !imp) kick(t, .95);
          if (q % step === 0) { const v = .26 + .62 * prog, r = 1 + .22 * prog; snare(t, v, r); if (rem <= 1 + 1e-6) snare(t + s16 / 2, v, r); }
          if (sub === 2) { hat(t, .35 + .5 * prog); if (rem > 1 + 1e-6) bassNote(t, s16 * 1.6, root, .6, 500 + 1600 * prog); }
          if (sub % (rem > 2 ? 2 : 1) === 0) chordPad(t, s16 * (rem > 2 ? 1.4 : .75), vox, { lvl: .5, cut: 20000, voices: 2, det: 12, wide: .7, att: .003, rel: .02, dest: s.buildLp });
        } else if (soft) {
          if (q === 0 && !imp) kick(t, .62); if (q === 10 && K === 'break' && !imp) kick(t, .4);
          if (q === 8 && K === 'break') snare(t, .3);
          if (sub === 2) shaker(t + sw, .55); else if (sub & 1) shaker(t + sw, .22);
          if (K === 'intro' && sub === 2) pluck(t, vox[(q >> 1) % 4] + 12, .12, { cut: 1500, dec: .16, pan: q & 4 ? .35 : -.35, dest: synthBus });
        }
      }
      // the hook: a gliding lead in drops, a pluck in the cold open, a bell in the break
      if (s.lead !== false && (on || K === 'hook' || K === 'break')) for (const [p, l, m] of B.mel) {
        const nb = B.start + p / 4; if (nb < s.from - 1e-6 || nb >= s.end - 1e-6) continue;
        const n = { t: nb * spb, d: (Math.min(nb + l / 4, s.end) - nb) * spb, m, v: p % 8 === 0 ? 1 : .86 };
        if (on) lead.push(n);
        else if (K === 'hook') { pluck(n.t, m, .38 * n.v, { cut: 3400, dec: Math.min(.3, n.d * .7), dest: leadBus }); pluck(n.t, m - 12, .13, { cut: 1800, dec: .12, dest: leadBus }); }
        else bell(n.t, m, .16 * n.v, 1.2, leadBus);
      }
    }
    if (lead.length) { leadVoice(lead, { ...(D2 ? LEAD2 : LEAD1), dest: leadBus }); if (D2) leadVoice(lead, { ...LEADLOW, dest: leadBus }); }
    if (s.gap > 0) swell(s.to * spb, Math.max(1, s.gap) * spb, .6);
  }

  for (const h of hits) {
    const t = h.beat * spb, v = h.v || 1, ci = ((h.chord || 0) % 4 + 4) % 4;
    if (h.kind === 'boom') boom(t, v);
    else if (h.kind === 'hit') hit(t, v, ci);
    else if (h.kind === 'clap') snare(t, v);
    else if (h.kind === 'whoosh') whoosh(t, v);
    else if (h.kind === 'stab') stab(t, CH[ci], h.len || spb * 2, v, h.cut || 2200);
    else if (h.kind === 'swell') swell(t, (h.beats || 1) * spb, .7 * v);
    else if (h.kind === 'crash') crash(t, v);
    else if (h.kind === 'kick') kick(t, v);
  }
  for (const r of risers) riser(r.from * spb, r.to * spb, r.v || 1);
  if (score.endRing != null && dur - score.endRing * spb > .05) { // the end card: the tonic chord rings out under the hook's first notes
    const t = score.endRing * spb, len = dur - t, lp = filt('lowpass', 3200, -1), g = ctx.createGain();
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(380, t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.045, t + .02); g.gain.exponentialRampToValueAtTime(.0004, t + len); lp.connect(g); g.connect(fxBus);
    for (const m of [52, 59, 64, 67, 71, 78]) for (const det of [-11, 0, 11]) { const o = osc('sawtooth', hz(m), det); o.connect(pan(det / 16, lp)); o.start(t); o.stop(t + len); }
    for (const [b, m] of [[0, 76], [.75, 79], [1.5, 83]]) if (t + b * spb < dur) bell(t + b * spb, m, .22, 2.4, leadBus);
  }

  // the sidechain, once every kick is known (velocity sets the depth)
  kicks.sort((a, b) => a[0] - b[0]);
  for (const [g, depth, rel] of [[duckBass, .08, .05], [duckSynth, .28, .11], [duckLead, .72, .07]]) {
    g.gain.setValueAtTime(1, 0); let last = -1;
    for (const [t, v] of kicks) { if (t - last < .03) continue; last = t; g.gain.setTargetAtTime(1 - (1 - depth) * Math.min(1, v), t, .002); g.gain.setTargetAtTime(1, t + .012, rel); }
  }
  return ctx.startRendering();
}`;
