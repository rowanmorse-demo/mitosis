// The high-end cuts (November 2026), as data: same shape as ../cuts.js (shots on a 128 BPM grid anchored to the takes'
// marks; overlays; sfx; music), with what edit.js added for them:
//   set     the filmed set the takes come from (v: 9:16 portrait, h: App Store landscape; see capture.js SETS)
//   fps     30 for App Store previews (their maximum), else 60;  enc: 'appstore' for Apple's H.264 limits
//   secs    an exact length (App Store previews: 15 to 30 s)
//   grade   vignette strength;  per shot: xin 'zoom' | 'whip' (xdir [dx, dy]) a transition in, flash a white pop
//   focus 'center' for takes framed by their own directed camera (hd/takes.js cam)
// overlays: hook (huge capitals, one line per beat: lines, at, accent, y), tag (a skin's name and rarity), end (the
// end card: cta false on the App Store, which allows no prices or calls to buy), and the October styles.
// The rule for every cut: the first second is the best moment in the game, with words on it, and there is no logo
// until the end. The hook is the first 8 beats (3.75 s): four moments, one every two beats.
'use strict';
const BPM = 128;
const C = { focus: 'center' };

// the hook, shared by the 15 s and the 6 s: a giant swallows a crowd, a split-and-swallow, a phage blast, an escape
const HOOK_SHOTS = [
  { from: 0, to: 2, take: 'feast', anchor: 'split1', at: .3, ...C, zoom: [[0, 1.0], [2, 1.07]], punch: [[.3, .04], [.55, .05]], shake: [[.3, 6], [.55, 9]] },
  { from: 2, to: 4, take: 'swallow', anchor: 'split', at: .35, ...C, xin: 'zoom', flash: .22, zoom: [[0, 1.02], [2, 1.1]], punch: [[.35, .04]], shake: [[.35, 5]] },
  { from: 4, to: 6, take: 'phage', anchor: 'shot', at: .55, ...C, xin: 'whip', xdir: [0, 1], flash: .18, zoom: [[0, 1.0], [2, 1.06]], punch: [[.75, .06]], shake: [[.75, 11]] },
  { from: 6, to: 8, take: 'escape', anchor: 'close', at: .7, ...C, xin: 'zoom', flash: .2, zoom: [[0, 1.04], [2, 1.12]], shake: [[.2, 4]] },
];
const HOOK_TEXT = [
  { from: 0, to: 2, style: 'hook', lines: ['Eat', 'everyone.'], at: [0, .5], accent: 1, y: .17 },
  { from: 2, to: 4, style: 'hook', lines: ['Split.', 'Swallow.'], at: [0, .75], accent: 1 },
  { from: 4, to: 6, style: 'hook', lines: ['Pop', 'giants.'], at: [0, .5], accent: 1 },
  { from: 6, to: 8, style: 'hook', lines: ["Don't get", 'eaten.'], at: [0, .5], accent: 1 },
];
const HOOK_HITS = [{ beat: 0, kind: 'boom' }, { beat: 2, kind: 'hit' }, { beat: 4, kind: 'hit', chord: 1 }, { beat: 6, kind: 'hit', chord: 2 },
  { beat: 2, kind: 'whoosh', v: .7 }, { beat: 4, kind: 'whoosh', v: .7 }, { beat: 6, kind: 'whoosh', v: .7 }];

// the premium skins, close up, one a beat (the order skins/take uses: see hd/takes.js)
const SKINS = [['Black Hole', 'epic'], ['Supernova', 'epic'], ['Galaxy', 'rare'], ['Nebula', 'common'], ['Plasma', 'rare'], ['Aurora', 'rare'], ['Glitch', 'rare'], ['Magma', 'common']];
const skinShots = (from, n) => [{ from, to: from + n, take: 'skins', anchor: 'skin0', at: 0, ...C, xin: 'zoom', flash: .25, zoom: [[0, 1.0], [n, 1.06]] }];
const skinTags = (from, n) => SKINS.slice(0, n).map(([name, rarity], i) => ({ from: from + i, to: from + i + 1, style: 'tag', name, rarity, hold: i < n - 1 }));

const vertical15 = {
  name: 'mitosis-15s-9x16', set: 'v', w: 1080, h: 1920, beats: 32, grade: .42,
  shots: [
    ...HOOK_SHOTS,
    { from: 8, to: 10, take: 'finale', anchor: 'win', at: 1.6, ...C, xin: 'zoom', flash: .3, zoom: [[0, 1.0], [2, 1.05]] },
    ...skinShots(10, 6),
    { from: 16, to: 21, take: 'finale', anchor: 'final', at: 4.4, ...C, xin: 'whip', xdir: [0, -1], zoom: [[0, 1.0], [4.4, 1.08]], punch: [[4.4, .05]], shake: [[4.4, 8]] },
    { from: 21, to: 26, take: 'feast', anchor: 'gulp', at: -.6, ...C, xin: 'zoom', flash: .2, zoom: [[0, 1.0], [5, 1.05]] },
    { from: 26, to: 32, take: 'finale', anchor: 'win', at: 3, rate: .4, ...C, zoom: [[0, 1.05], [6, 1.12]], blur: 16, dim: .62 },
  ],
  overlays: [
    ...HOOK_TEXT,
    { from: 10, to: 16, style: 'hook', lines: ['Premium', 'skins.'], at: [0, .3], accent: 1, y: .16, scale: .62 },
    ...skinTags(10, 6),
    { from: 16, to: 20.4, style: 'hook', lines: ['The arena', 'closes in.'], at: [0, .5], accent: 1, scale: .8 },
    { from: 20.4, to: 21, style: 'hook', lines: ['Last cell', 'standing.'], at: [0, 0], accent: 1, scale: .8 },
    { from: 21, to: 26, style: 'hook', lines: ['Start small.', 'Grow huge.'], at: [0, 1], accent: 1, scale: .8 },
    { from: 26, to: 32, style: 'end', cta: 'Play free', store: 'on the App Store' },
  ],
  sfx: [[26.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 8, kind: 'drop' }, { from: 8, to: 10, kind: 'build' }, { from: 10, to: 16, kind: 'drop2' }, { from: 16, to: 21, kind: 'build' }, { from: 21, to: 26, kind: 'drop' }],
    hits: [...HOOK_HITS, { beat: 8, kind: 'boom' }, { beat: 10, kind: 'hit' }, ...[11, 12, 13, 14, 15].map(b => ({ beat: b, kind: 'whoosh', v: .45 })),
      { beat: 16, kind: 'whoosh' }, { beat: 21, kind: 'boom' }, { beat: 26, kind: 'boom' }],
    risers: [{ from: 18.5, to: 21 }],
    endRing: 26,
  },
};

// the 6 s bumper for ads: the hook, then the end card
const hook6 = {
  name: 'mitosis-6s-hook-9x16', set: 'v', w: 1080, h: 1920, beats: 13, secs: 6, grade: .42,
  shots: [...HOOK_SHOTS, { from: 8, to: 13, take: 'feast', anchor: 'gulp', at: .4, rate: .4, ...C, zoom: [[0, 1.05], [5, 1.1]], blur: 16, dim: .62 }],
  overlays: [...HOOK_TEXT, { from: 8, to: 13, style: 'end', cta: 'Play free', store: 'on the App Store' }],
  music: { sections: [{ from: 0, to: 8, kind: 'drop' }], hits: [...HOOK_HITS, { beat: 8, kind: 'boom' }], endRing: 8 },
};

// the App Store app preview (iPhone 6.9"/6.5": 1920×886 landscape, the game's orientation). Apple's rules shape it:
// 15-30 s, at most 30 fps, H.264 High 4.0 at 10-12 Mbps; only footage of the app (text over it is fine); no prices
// or "free" (so the end card has no call to action); it autoplays muted, so the words carry it. The touch controls stay
// in shot (capture.js --set=h --hud=controls) so it reads as play on a phone.
const appstore30 = {
  name: 'mitosis-appstore-30s-1920x886', set: 'h', w: 1920, h: 886, fps: 30, enc: 'appstore', beats: 64, secs: 29.9, grade: .32,
  shots: [
    ...HOOK_SHOTS,
    { from: 8, to: 10, take: 'finale', anchor: 'win', at: 1.6, ...C, xin: 'zoom', flash: .3, zoom: [[0, 1.0], [2, 1.04]] },
    ...skinShots(10, 6),
    { from: 16, to: 24, take: 'leviathan', anchor: 'pop', at: 4.2, rate: [[0, 1.3], [4, 1], [6.5, 1.3]], ...C, xin: 'whip', xdir: [1, 0], zoom: [[0, 1.0], [4.2, 1.06]], punch: [[4.2, .05]], shake: [[4.2, 10]] },
    { from: 24, to: 30, take: 'climb', anchor: 'split1', at: 1.4, focus: 'hero', xin: 'zoom', zoom: [[0, 1.0]] },
    { from: 30, to: 38, take: 'phage', anchor: 'shot', at: 2.6, ...C, xin: 'whip', xdir: [1, 0], zoom: [[0, 1.0], [8, 1.05]], punch: [[2.9, .05]], shake: [[2.9, 10]] },
    { from: 38, to: 46, take: 'finale', anchor: 'final', at: 6.2, ...C, xin: 'zoom', zoom: [[0, 1.0], [6.2, 1.07]], punch: [[6.2, .05]], shake: [[6.2, 8]] },
    { from: 46, to: 56, take: 'finale', anchor: 'win', at: .6, ...C, flash: .25, zoom: [[0, 1.0], [10, 1.04]] },
    { from: 56, to: 64, take: 'feast', anchor: 'gulp', at: 2, rate: .4, ...C, zoom: [[0, 1.05], [8, 1.1]], blur: 16, dim: .62 },
  ],
  overlays: [
    ...HOOK_TEXT,
    { from: 10, to: 16, style: 'hook', lines: ['Premium skins.'], at: [0], accent: 0, y: .16, scale: .6 },
    ...skinTags(10, 6),
    { from: 16, to: 20, style: 'hook', lines: ['World events.'], at: [0], accent: 0, scale: .7 },
    { from: 20, to: 24, style: 'hook', lines: ['Pop the Leviathan.'], at: [0], accent: 0, scale: .7 },
    { from: 24, to: 30, style: 'hook', lines: ['Climb to #1.'], at: [0], accent: 0, scale: .7 },
    { from: 30, to: 34, style: 'hook', lines: ['Feed the phage.'], at: [0], accent: 0, scale: .7 },
    { from: 34, to: 38, style: 'hook', lines: ['Pop the giant.'], at: [0], accent: 0, scale: .7 },
    { from: 38, to: 44, style: 'hook', lines: ['The arena closes in.'], at: [0], accent: 0, scale: .7 },
    { from: 44, to: 46, style: 'hook', lines: ['Last cell standing.'], at: [0], accent: 0, scale: .7 },
    { from: 56, to: 64, style: 'end', cta: false },
  ],
  sfx: [[56.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 8, kind: 'drop' }, { from: 8, to: 10, kind: 'build' }, { from: 10, to: 16, kind: 'drop2' }, { from: 16, to: 24, kind: 'drop' },
      { from: 24, to: 30, kind: 'break' }, { from: 30, to: 38, kind: 'drop2' }, { from: 38, to: 46, kind: 'build' }, { from: 46, to: 56, kind: 'drop' }],
    hits: [...HOOK_HITS, { beat: 8, kind: 'boom' }, { beat: 10, kind: 'hit' }, ...[11, 12, 13, 14, 15].map(b => ({ beat: b, kind: 'whoosh', v: .45 })),
      { beat: 16, kind: 'whoosh' }, { beat: 30, kind: 'whoosh' }, { beat: 32, kind: 'boom' }, { beat: 46, kind: 'boom' }, { beat: 56, kind: 'boom' }],
    risers: [{ from: 28, to: 30, v: .8 }, { from: 43, to: 46 }],
    endRing: 56,
  },
};

module.exports = { BPM, cuts: [vertical15, hook6, appstore30] };
