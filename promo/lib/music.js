// A small, original beat for the trailer, synthesised with Web Audio in an OfflineAudioContext (no samples, no
// copyrighted material). It follows the cut: the edit hands it a score (tempo, bars, what each section does and
// where the hits land). E minor pentatonic over Em–C–G–D, which sits with the game's own G-major pentatonic bells.
// Exported as the source of a function that runs inside the page: music(score) → Promise<AudioBuffer>.
'use strict';
module.exports = String.raw`
async function music(score, sr) {
  const spb = 60 / score.bpm, bar = spb * 4, dur = score.dur;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // ---- buses: drums and music into a glue compressor and a soft ceiling
  const out = ctx.createGain(); out.gain.value = .9;
  const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -14; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = .01; glue.release.value = .12;
  const ceil = ctx.createDynamicsCompressor(); ceil.threshold.value = -3; ceil.knee.value = 0; ceil.ratio.value = 20; ceil.attack.value = .001; ceil.release.value = .08;
  out.connect(glue); glue.connect(ceil); ceil.connect(ctx.destination);
  const drums = ctx.createGain(); drums.gain.value = 1; drums.connect(out);
  const inst = ctx.createGain(); inst.gain.value = .8; inst.connect(out);
  // sidechain: the instruments duck under every kick
  const duck = ctx.createGain(); duck.connect(inst);
  // a short stereo room for claps and stabs, and a dotted-eighth ping-pong for the arp
  const n = Math.round(sr * 1.1), ir = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) { const b = ir.getChannelData(ch); for (let i = 0; i < n; i++) b[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, 4); }
  const room = ctx.createConvolver(); room.buffer = ir; const roomG = ctx.createGain(); roomG.gain.value = .22; room.connect(roomG); roomG.connect(out);
  const dl = ctx.createDelay(2), dr = ctx.createDelay(2), fb = ctx.createGain(), dlp = ctx.createBiquadFilter(), merge = ctx.createChannelMerger(2), dG = ctx.createGain();
  dl.delayTime.value = spb * .75; dr.delayTime.value = spb * .75; fb.gain.value = .32; dlp.type = 'lowpass'; dlp.frequency.value = 3200; dG.gain.value = .3;
  dl.connect(dlp); dlp.connect(dr); dr.connect(fb); fb.connect(dl); dl.connect(merge, 0, 0); dr.connect(merge, 0, 1); merge.connect(dG); dG.connect(duck);
  const noise = ctx.createBuffer(1, sr * 2, sr); { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const env = (g, t, a, peak, d, end = .0001) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(end, t + a + d); };
  const nsrc = (t, len, off = 0) => { const s = ctx.createBufferSource(); s.buffer = noise; s.start(t, off % 1.5); s.stop(t + len); return s; };
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  // ---- drums
  function kick(t, v = 1) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(52, t + .07); o.frequency.exponentialRampToValueAtTime(43, t + .3);
    env(g, t, .002, .95 * v, .38); o.connect(g); g.connect(drums); o.start(t); o.stop(t + .45);
    const c = nsrc(t, .02, t), hp = ctx.createBiquadFilter(), cg = ctx.createGain(); hp.type = 'highpass'; hp.frequency.value = 2500; env(cg, t, .001, .22 * v, .012);
    c.connect(hp); hp.connect(cg); cg.connect(drums);
    // pump the instruments
    duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(.22, t + .004); duck.gain.linearRampToValueAtTime(1, t + spb * .62);
  }
  function clap(t, v = 1) {
    const bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 1350; bp.Q.value = .9; bp.connect(g); g.connect(drums); g.connect(room);
    for (let i = 0; i < 3; i++) { const s = nsrc(t + i * .011, .03, t * 3 + i), gi = ctx.createGain(); env(gi, t + i * .011, .001, .5 * v, .02); s.connect(gi); gi.connect(bp); }
    const tail = nsrc(t + .033, .25, t * 5), tg = ctx.createGain(); env(tg, t + .033, .002, .32 * v, .17); tail.connect(tg); tg.connect(bp); g.gain.value = 1;
  }
  function hat(t, v = 1, open = false) {
    const s = nsrc(t, open ? .3 : .06, t * 7), hp = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createStereoPanner();
    hp.type = 'highpass'; hp.frequency.value = 7600; pan.pan.value = .25; env(g, t, .001, .16 * v, open ? .22 : .035);
    s.connect(hp); hp.connect(g); g.connect(pan); pan.connect(drums);
  }
  function boom(t, v = 1) { // the trailer impact: a sub drop with a dark noise burst
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.1);
    env(g, t, .004, .9 * v, 1.4); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.5);
    const s = nsrc(t, .9, t), lp = ctx.createBiquadFilter(), ng = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(140, t + .7);
    env(ng, t, .002, .38 * v, .75); s.connect(lp); lp.connect(ng); ng.connect(out); ng.connect(room);
  }
  function riser(t0, t1, v = 1) { // filtered noise and a rising tone, into a hit
    const s = nsrc(t0, t1 - t0 + .05, t0), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(350, t0); bp.frequency.exponentialRampToValueAtTime(7000, t1); g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.3 * v, t1 - .02); g.gain.linearRampToValueAtTime(0, t1 + .02);
    s.connect(bp); bp.connect(g); g.connect(out);
    const o = ctx.createOscillator(), og = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 1800;
    o.frequency.setValueAtTime(hz(52), t0); o.frequency.exponentialRampToValueAtTime(hz(76), t1); og.gain.setValueAtTime(.0001, t0); og.gain.exponentialRampToValueAtTime(.05 * v, t1 - .02); og.gain.linearRampToValueAtTime(0, t1 + .02);
    o.connect(lp); lp.connect(og); og.connect(out); o.start(t0); o.stop(t1 + .05);
  }
  function whoosh(t, v = 1) { // a short reversed swell into a cut
    const s = nsrc(t - .28, .3, t), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = .8; bp.frequency.setValueAtTime(600, t - .28); bp.frequency.exponentialRampToValueAtTime(4200, t);
    g.gain.setValueAtTime(.0001, t - .28); g.gain.exponentialRampToValueAtTime(.22 * v, t - .01); g.gain.linearRampToValueAtTime(0, t + .01); s.connect(bp); bp.connect(g); g.connect(out);
  }

  // ---- harmony: Em – C – G – D
  const CH = [[52, 55, 59, 64], [48, 52, 55, 60], [55, 59, 62, 67], [50, 54, 57, 62]], ROOT = [40, 36, 43, 38];
  function sub(t, len, m, v = 1) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = hz(m); o2.frequency.value = hz(m + 12);
    lp.type = 'lowpass'; lp.frequency.value = 420; const g2 = ctx.createGain(); g2.gain.value = .18;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.42 * v, t + .012); g.gain.setValueAtTime(.42 * v, t + len - .04); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(g); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(duck); o.start(t); o2.start(t); o.stop(t + len + .02); o2.stop(t + len + .02);
  }
  function stab(t, notes, len, v = 1, cutoff = 2600) { // detuned saws through an enveloped low-pass
    const lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(cutoff * 1.8, t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, cutoff * .45), t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.075 * v, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + len);
    lp.connect(g); g.connect(duck); g.connect(room);
    for (const m of notes) for (const det of [-9, 0, 9]) { const o = ctx.createOscillator(), p = ctx.createStereoPanner(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det; p.pan.value = det / 14; o.connect(p); p.connect(lp); o.start(t); o.stop(t + len + .02); }
  }
  function pad(t, notes, len, v = 1, cutoff = 1400) {
    const lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = .5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.04 * v, t + .25); g.gain.setValueAtTime(.04 * v, t + len - .3); g.gain.linearRampToValueAtTime(0, t + len);
    lp.connect(g); g.connect(duck);
    for (const m of notes) for (const det of [-12, 7]) { const o = ctx.createOscillator(), p = ctx.createStereoPanner(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det; p.pan.value = det > 0 ? .4 : -.4; o.connect(p); p.connect(lp); o.start(t); o.stop(t + len + .02); }
  }
  function pluck(t, m, v = 1) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o2.type = 'sine'; o.frequency.value = hz(m); o2.frequency.value = hz(m + 12);
    lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(420, t + .14); env(g, t, .003, .045 * v, .22);
    const g2 = ctx.createGain(); g2.gain.value = .5; o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(duck); g.connect(dl); o.start(t); o2.start(t); o.stop(t + .28); o2.stop(t + .28);
  }

  // ---- the arrangement, beat by beat, from the score: sections are [from, to) in beats; chords change every bar
  const kindAt = b => { for (const s of score.sections) if (b >= s.from && b < s.to) return s.kind; return 'rest'; };
  const beats = Math.ceil(dur / spb);
  for (let b = 0; b < beats; b++) {
    const t = b * spb, k = kindAt(b), ci = Math.floor(b / 4 + (score.chordShift || 0)) % 4, beat = b % 4;
    if (k === 'rest') continue;
    const on = k === 'drop' || k === 'drop2', soft = k === 'intro' || k === 'break', build = k === 'build';
    if (on || build || k === 'hook') kick(t, beat === 0 ? 1 : .9);
    else if (soft && beat % 2 === 0) kick(t, .7);
    if ((on || k === 'hook') && (beat === 1 || beat === 3)) clap(t, k === 'hook' ? .8 : 1);
    if (build && (beat === 1 || beat === 3)) clap(t, .7);
    if (build && b % 4 === 3) for (let i = 0; i < 4; i++) clap(t + i * spb / 4, .25 + i * .12); // a snare roll into the next bar
    for (let s16 = 0; s16 < 4; s16++) {
      const th = t + s16 * spb / 4;
      if (on) { if (s16 === 2) hat(th, 1, beat === 3 && k === 'drop2'); else if (s16 % 2 === 1) hat(th, .45 + rnd() * .2); }
      else if ((k === 'hook' || build) && s16 === 2) hat(th, .8);
      else if (soft && s16 === 2) hat(th, .5);
      if (on && (s16 === 2 || (s16 === 3 && beat % 2 === 1) || (s16 === 1 && beat === 2))) pluck(th, CH[ci][(beat * 3 + s16) % 4] + 12, .5 + .3 * (s16 === 2)); // a sparse arp, not a wall of sixteenths
    }
    if (on || build || k === 'hook') sub(t + (on ? spb * .5 : 0), spb * .5, ROOT[ci], on ? 1 : .8);
    if (on) stab(t + spb * .5, CH[ci], spb * .45, .8, 2400);
    // pads: one per bar (or from where the section starts), held to the bar line or the section's end
    if ((soft || build || on) && (beat === 0 || kindAt(b - 1) !== k)) {
      let len = 4 - beat; for (let j = 1; j < 4 - beat; j++) if (kindAt(b + j) !== k) { len = j; break; }
      pad(t, CH[ci], len * spb, soft ? 1 : on ? .7 : .8, soft ? 900 : on ? 1800 : 1600);
    }
  }
  for (const h of score.hits || []) {
    const t = h.beat * spb, v = h.v || 1;
    if (h.kind === 'boom') { boom(t, v); kick(t, 1); }
    else if (h.kind === 'hit') { kick(t, v); clap(t, v); stab(t, CH[h.chord || 0], spb * .9, .9 * v, 2600); }
    else if (h.kind === 'clap') clap(t, v); else if (h.kind === 'whoosh') whoosh(t, v);
    else if (h.kind === 'stab') stab(t, CH[h.chord || 0], h.len || spb * 2, v, h.cut || 2200);
  }
  for (const r of score.risers || []) riser(r.from * spb, r.to * spb, r.v || 1);
  if (score.endRing) { // the logo: the tonic chord rings out and fades, no drone
    const t = score.endRing * spb, len = dur - t, lp = ctx.createBiquadFilter(), gg = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(500, t + len);
    gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(.05, t + .02); gg.gain.exponentialRampToValueAtTime(.0005, t + len); lp.connect(gg); gg.connect(out); gg.connect(room);
    for (const m of CH[0].concat([71, 76])) for (const det of [-10, 0, 10]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + len); }
  }
  return ctx.startRendering();
}`;
