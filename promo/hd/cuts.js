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
  { from: 4, to: 6, take: 'phage', anchor: 'hit', at: .8, ...C, xin: 'whip', xdir: [0, 1], flash: .18, zoom: [[0, 1.0], [2, 1.06]], punch: [[.8, .06]], shake: [[.8, 11]] },
  { from: 6, to: 8, take: 'escape', anchor: 'close', at: .7, ...C, xin: 'zoom', flash: .2, zoom: [[0, 1.04], [2, 1.12]], shake: [[.2, 4]] },
];
const HOOK_TEXT = [
  { from: 0, to: 2, style: 'hook', lines: ['Eat', 'everyone.'], at: [0, .5], accent: 1, y: .17 },
  { from: 2, to: 4, style: 'hook', lines: ['Split.', 'Swallow.'], at: [0, .75], accent: 1 },
  { from: 4, to: 6, style: 'hook', lines: ['Pop', 'giants.'], at: [0, .5], accent: 1, y: .81 },
  { from: 6, to: 8, style: 'hook', lines: ["Don't get", 'eaten.'], at: [0, .5], accent: 1 },
];
const HOOK_HITS = [{ beat: 0, kind: 'boom' }, { beat: 2, kind: 'hit' }, { beat: 4, kind: 'hit', chord: 1 }, { beat: 6, kind: 'hit', chord: 2 },
  { beat: 2, kind: 'whoosh', v: .7 }, { beat: 4, kind: 'whoosh', v: .7 }, { beat: 6, kind: 'whoosh', v: .7 }];

// the premium skins, close up, one a beat (the order skins/take uses: see hd/takes.js)
const SKINS = [['Black Hole', 'epic'], ['Supernova', 'epic'], ['Galaxy', 'rare'], ['Nebula', 'common'], ['Plasma', 'rare'], ['Aurora', 'rare'], ['Glitch', 'rare'], ['Magma', 'common']];
const skinShots = (from, n) => [{ from, to: from + n, take: 'skins', anchor: 'skin0', at: 0, ...C, xin: 'zoom', flash: .25, zoom: [[0, 1.0], [n, 1.06]] }];
const skinTags = (from, n, y) => SKINS.slice(0, n).map(([name, rarity], i) => ({ from: from + i, to: from + i + 1, style: 'tag', name, rarity, hold: i < n - 1, y }));

// Rowan's 15 s (Nov 7): "super poppy", smooth footage, great skins, climb the leaderboard, the Elo going up, and
// "Download now" at the end. Three hook moments, six skins, the climb to #1, the Victory screen's rating count-up.
const vertical15 = {
  name: 'mitosis-15s-9x16', set: 'v', w: 1080, h: 1920, beats: 32, grade: .38,
  shots: [
    ...HOOK_SHOTS.slice(0, 3),
    ...skinShots(6, 6),
    // the leaderboard fills the frame as Juno takes #1
    { from: 12, to: 18, take: 'climb', anchor: 'split1', at: .6, focus: [300, 200], xin: 'whip', xdir: [0, 1], flash: .2, zoom: [[0, 1.0], [2.9, 1.0], [3.45, 1.5], [6, 1.56]], punch: [[1.63, .03], [3.45, .06]], shake: [[.6, 4], [3.45, 6]] },
    // Victory: #1 lands, then in on the rating card as it counts up to 1412 and turns Platinum, Promoted
    { from: 18, to: 25, take: 'finale', anchor: 'win', at: -.5, focus: [216, 500], xin: 'zoom', flash: .35, zoom: [[0, 1.0], [7, 1.08]], punch: [[.3, .05], [5, .05]] },
    { from: 25, to: 32, take: 'feast', anchor: 'gulp', at: 1.2, rate: .4, ...C, zoom: [[0, 1.05], [7, 1.12]], blur: 16, dim: .6 },
  ],
  overlays: [
    ...HOOK_TEXT.slice(0, 3),
    { from: 6, to: 12, style: 'hook', lines: ['Premium skins.'], at: [0], accent: 0, y: .14, scale: .62 },
    ...skinTags(6, 6, .78),
    { from: 12, to: 18, style: 'hook', lines: ['Climb to', '#1.'], at: [0, 3.45], accent: 1, y: .66, scale: .85 },
    { from: 19.5, to: 23, style: 'hook', lines: ['Gain Elo.'], at: [0], accent: 0, y: .525, scale: .62 },
    { from: 23, to: 25, style: 'hook', lines: ['Promoted.'], at: [0], accent: 0, y: .525, scale: .62 },
    { from: 25, to: 32, style: 'end', cta: 'Download now', store: 'Free on the App Store' },
  ],
  sfx: [[25.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 6, kind: 'drop' }, { from: 6, to: 12, kind: 'drop2' }, { from: 12, to: 18, kind: 'drop' }, { from: 18, to: 23, kind: 'build' }],
    hits: [...HOOK_HITS.filter(h => h.beat < 6), { beat: 6, kind: 'hit', chord: 2 }, { beat: 6, kind: 'whoosh', v: .7 }, ...[7, 8, 9, 10, 11].map(b => ({ beat: b, kind: 'whoosh', v: .45 })),
      { beat: 12, kind: 'hit' }, { beat: 12, kind: 'whoosh', v: .7 }, { beat: 15.45, kind: 'hit', chord: 1 }, { beat: 18, kind: 'boom' }, { beat: 23, kind: 'boom' }, { beat: 25, kind: 'boom' }],
    risers: [{ from: 21, to: 23, v: .8 }],
    endRing: 25,
  },
};

// the 6 s bumper for ads: the hook, then the end card
const hook6 = {
  name: 'mitosis-6s-hook-9x16', set: 'v', w: 1080, h: 1920, beats: 13, secs: 6, grade: .42,
  shots: [...HOOK_SHOTS, { from: 8, to: 13, take: 'feast', anchor: 'gulp', at: .4, rate: .4, ...C, zoom: [[0, 1.05], [5, 1.1]], blur: 16, dim: .62 }],
  overlays: [...HOOK_TEXT, { from: 8, to: 13, style: 'end', cta: 'Download now', store: 'Free on the App Store' }],
  music: { sections: [{ from: 0, to: 8, kind: 'drop' }], hits: [...HOOK_HITS, { beat: 8, kind: 'boom' }], endRing: 8 },
};

// the App Store app preview (iPhone 6.9"/6.5": 1920×886 landscape, the game's orientation). Apple's rules shape it:
// 15-30 s, at most 30 fps, H.264 High 4.0 at 10-12 Mbps; only footage of the app (text over it is fine); no prices
// or "free" (so the end card has no call to action); it autoplays muted, so the words carry it. The touch controls stay
// in shot (capture.js --set=h --hud=controls) so it reads as play on a phone.
const appstore30 = {
  name: 'mitosis-appstore-30s-1920x886', set: 'h', w: 1920, h: 886, fps: 30, enc: 'appstore', beats: 64, secs: 29.9, grade: .3,
  shots: [
    ...HOOK_SHOTS,
    ...skinShots(8, 6),
    { from: 14, to: 22, take: 'leviathan', anchor: 'pop', at: 4.2, rate: [[0, 1.3], [4, 1], [6.5, 1.3]], ...C, xin: 'whip', xdir: [1, 0], zoom: [[0, 1.0], [4.2, 1.06]], punch: [[4.2, .05]], shake: [[4.2, 10]] },
    { from: 22, to: 28, take: 'climb', anchor: 'split1', at: .6, focus: [700, 110], xin: 'zoom', flash: .2, zoom: [[0, 1.0], [2.9, 1.0], [3.45, 1.45], [6, 1.5]], punch: [[3.45, .05]] },
    { from: 28, to: 36, take: 'phage', anchor: 'shot', at: 2.6, ...C, xin: 'whip', xdir: [1, 0], zoom: [[0, 1.0], [8, 1.05]], punch: [[3.9, .05]], shake: [[3.9, 10]] },
    { from: 36, to: 44, take: 'finale', anchor: 'final', at: 6.2, ...C, xin: 'zoom', zoom: [[0, 1.0], [6.2, 1.07]], punch: [[6.2, .05]], shake: [[6.2, 8]] },
    { from: 44, to: 56, take: 'finale', anchor: 'win', at: -.5, focus: 'center', flash: .3, zoom: [[0, 1.0], [12, 1.06]], punch: [[.3, .04], [5, .04]] },
    { from: 56, to: 64, take: 'feast', anchor: 'gulp', at: 1.2, rate: .4, ...C, zoom: [[0, 1.05], [8, 1.1]], blur: 16, dim: .62 },
  ],
  overlays: [
    ...HOOK_TEXT.map(o => ({ ...o, y: undefined })),
    { from: 8, to: 14, style: 'hook', lines: ['Premium skins.'], at: [0], accent: 0, y: .16, scale: .6 },
    ...skinTags(8, 6),
    { from: 14, to: 18, style: 'hook', lines: ['World events.'], at: [0], accent: 0, scale: .62 },
    { from: 18, to: 22, style: 'hook', lines: ['Pop the Leviathan.'], at: [0], accent: 0, scale: .62 },
    { from: 22, to: 28, style: 'hook', lines: ['Climb to #1.'], at: [0], accent: 0, y: .8, scale: .62 },
    { from: 28, to: 31.5, style: 'hook', lines: ['Feed the phage.'], at: [0], accent: 0, scale: .62 },
    { from: 31.5, to: 36, style: 'hook', lines: ['Pop the giant.'], at: [0], accent: 0, scale: .62 },
    { from: 36, to: 42, style: 'hook', lines: ['The arena closes in.'], at: [0], accent: 0, scale: .62 },
    { from: 42, to: 44, style: 'hook', lines: ['Last cell standing.'], at: [0], accent: 0, scale: .62 },
    { from: 46, to: 49, style: 'hook', lines: ['Gain Elo.'], at: [0], accent: 0, y: .12, scale: .5 },
    { from: 49, to: 56, style: 'hook', lines: ['Get promoted.'], at: [0], accent: 0, y: .12, scale: .5 },
    { from: 56, to: 64, style: 'end', cta: false },
  ],
  sfx: [[56.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 8, kind: 'drop' }, { from: 8, to: 14, kind: 'drop2' }, { from: 14, to: 22, kind: 'drop' }, { from: 22, to: 28, kind: 'break' },
      { from: 28, to: 36, kind: 'drop2' }, { from: 36, to: 44, kind: 'build' }, { from: 44, to: 56, kind: 'drop' }],
    hits: [...HOOK_HITS, { beat: 8, kind: 'hit' }, { beat: 8, kind: 'whoosh', v: .7 }, ...[9, 10, 11, 12, 13].map(b => ({ beat: b, kind: 'whoosh', v: .45 })),
      { beat: 14, kind: 'whoosh' }, { beat: 25.45, kind: 'hit', chord: 1 }, { beat: 28, kind: 'whoosh' }, { beat: 44, kind: 'boom' }, { beat: 49, kind: 'boom' }, { beat: 56, kind: 'boom' }],
    risers: [{ from: 26, to: 28, v: .8 }, { from: 41, to: 44 }],
    endRing: 56,
  },
};

module.exports = { BPM, cuts: [vertical15, hook6, appstore30] };
