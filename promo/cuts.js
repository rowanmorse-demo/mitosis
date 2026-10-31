// The edits, as data. Time is in beats at BPM (128: a beat is 0.469 s, a bar 1.875 s; 64 beats = 30 s).
// shots: [from, to) beats, each showing a take. `anchor`/`at`: the take's marked frame lands on beat `at` of the shot
// (marks come from takes.js: split1, shot, pop, final…), so cuts stay on the moments when a take is re-filmed.
//   rate     playback speed, or [[beat, rate], …] steps (the slow motion itself is filmed in the take)
//   zoom     [[beat, z], …] punch-in (1 = full frame), eased between keys; punch: [[beat, amount]] a quick bump
//   focus    what zooms and the vertical crop follow: 'hero' | 'interest' (what the hero is going for) | 'mid' |
//            'mix' (hero→interest by `mix`, a number or [[beat, 0..1]]) | 'pan' (`pan` keys, x in CSS px) | [x, y]
//            in the game's 768×432 CSS px. The hero always stays in shot (`keep`, default .36 of the crop);
//            `offset` [dx, dy] shifts the frame (room for a title)
//   shake    [[beat, px]] a hit that decays; dim: darken the picture under a title; blur: px (end card)
// overlays: titles in the game's fonts, [from, to) in beats of the whole cut:
//   slam (one huge word), stack (a few big lines), caption (kicker + line), endcard
// sfx: extra game sounds on cut beats ([beat, kind, amount]); music: the score for lib/music.js.
'use strict';
const BPM = 128;
const HOOK = { take: 'chain', anchor: 'boost', at: .2, rate: [[0, 1], [1.5, 1.4], [3, 1]], focus: 'mix', mix: .3, keep: .26 };

const trailer30 = {
  name: 'mitosis-trailer-30s-16x9', w: 1920, h: 1080, beats: 64,
  shots: [
    { from: 0, to: 8, ...HOOK, zoom: [[0, 1.12], [2.6, 1.12], [3.4, 1.28], [8, 1.42]], punch: [[1.1, .05], [3.15, .07]], shake: [[1.1, 6], [3.2, 9]] },
    { from: 8, to: 9, take: 'climb', anchor: 'split1', at: -.35, focus: 'hero', zoom: [[0, 1.3], [1, 1.38]], dim: .5 },
    { from: 9, to: 10, take: 'virus', anchor: 'split', at: .25, focus: 'hero', zoom: [[0, 1.3], [1, 1.4]], dim: .5 },
    { from: 10, to: 12, take: 'finale', anchor: 'final', at: 6.8, focus: 'hero', zoom: [[0, 1.0], [2, 1.12]], dim: .5 },
    { from: 12, to: 20, take: 'escape', anchor: 'close', at: 2.2, focus: 'mid', zoom: [[0, 1.12], [2, 1.2], [3.2, 1.42], [6, 1.42], [8, 1.2]], shake: [[1.0, 5]] },
    { from: 20, to: 28, take: 'virus', anchor: 'feed', at: 1, focus: 'interest', zoom: [[0, 1.15], [3, 1.22], [3.7, 1.32], [6, 1.32], [8, 1.18]], punch: [[3.63, .06]], shake: [[3.63, 10]] },
    { from: 28, to: 36, take: 'leviathan', anchor: 'pop', at: 4, rate: [[0, 1.25], [4, 1], [6, 1.25]], focus: 'mid', zoom: [[0, 1.0], [3.6, 1.12], [4.2, 1.3], [8, 1.2]], punch: [[4, .07]], shake: [[0.3, 6], [4, 12]] },
    // Halloween skins: the four heroes, one beat each, close up
    { from: 36, to: 37, take: 'chain', anchor: 'boost', at: 1.4, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    { from: 37, to: 38, take: 'escape', anchor: 'bigsplit', at: 2.2, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    { from: 38, to: 39, take: 'virus', anchor: 'feed', at: 1.2, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    { from: 39, to: 40, take: 'leviathan', anchor: 'event', at: .6, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    { from: 40, to: 44, take: 'climb', anchor: 'split1', at: 1.1, focus: [668, 70], zoom: [[0, 1.0], [1.7, 1.0], [2.3, 1.85], [4, 1.95]] },
    { from: 44, to: 50, take: 'finale', anchor: 'final', at: 4.6, focus: 'mid', zoom: [[0, 1.0], [4, 1.1], [4.7, 1.32], [6, 1.38]], punch: [[4.7, .05]], shake: [[5.3, 8]] },
    { from: 50, to: 52, take: 'finale', anchor: 'final', at: -.9, rate: .5, focus: 'hero', zoom: [[0, 1.3], [2, 1.36]], dim: .55, shake: [[0, 14]] },
    { from: 52, to: 56, take: 'finale', anchor: 'final', at: -1.6, rate: 1.35, focus: [384, 216], zoom: [[0, 1.0]] },
    { from: 56, to: 64, take: 'finale', anchor: 'final', at: 10, rate: .35, focus: 'hero', zoom: [[0, 1.2], [8, 1.3]], blur: 14, dim: .6 },
  ],
  overlays: [
    { from: 8, to: 9, style: 'slam', text: 'Eat.' },
    { from: 9, to: 10, style: 'slam', text: 'Split.' },
    { from: 10, to: 12, style: 'slam', text: 'Survive.' },
    { from: 12.4, to: 16.2, style: 'caption', kicker: 'Boost', text: 'Outrun the giants.' },
    { from: 20.3, to: 23.4, style: 'caption', kicker: 'Phages', text: 'Feed the phage.' },
    { from: 23.63, to: 27.4, style: 'caption', kicker: 'Phages', text: 'Pop the giant.' },
    { from: 28.4, to: 31.8, style: 'caption', kicker: 'World event', text: 'The Leviathan surfaces.' },
    { from: 36, to: 40, style: 'caption', kicker: 'Halloween', text: 'Limited-time skins.' },
    { from: 40.2, to: 41.9, style: 'caption', kicker: 'Ranked', text: 'Climb to #1.' },
    { from: 44.3, to: 48, style: 'caption', kicker: '10-minute rounds', text: 'The arena closes in.' },
    { from: 50, to: 52, style: 'stack', lines: ['Last cell', 'standing.'] },
    { from: 56, to: 64, style: 'endcard' },
  ],
  sfx: [[8, 'eat', 80], [9, 'split'], [10, 'dash'], [50, 'lysis'], [56.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 8, kind: 'hook' }, { from: 12, to: 28, kind: 'drop' }, { from: 28, to: 32, kind: 'break' }, { from: 32, to: 44, kind: 'drop2' },
      { from: 44, to: 50, kind: 'build' }, { from: 52, to: 56, kind: 'drop' }],
    hits: [{ beat: 8, kind: 'hit' }, { beat: 9, kind: 'hit', chord: 1 }, { beat: 10, kind: 'boom' }, { beat: 32, kind: 'boom' }, { beat: 50, kind: 'boom' }, { beat: 56, kind: 'boom' },
      { beat: 8, kind: 'whoosh' }, { beat: 9, kind: 'whoosh' }, { beat: 10, kind: 'whoosh' }, { beat: 36, kind: 'whoosh', v: .7 }, { beat: 37, kind: 'whoosh', v: .5 }, { beat: 38, kind: 'whoosh', v: .5 }, { beat: 39, kind: 'whoosh', v: .5 }],
    risers: [{ from: 6, to: 8 }, { from: 10, to: 12 }, { from: 30, to: 32, v: .8 }, { from: 47, to: 50 }],
    endRing: 56,
  },
};

const trailer15 = {
  name: 'mitosis-trailer-15s-9x16', w: 1080, h: 1920, beats: 32,
  shots: [
    { from: 0, to: 6, ...HOOK, zoom: [[0, 1.0], [2.6, 1.0], [3.4, 1.1], [6, 1.18]], punch: [[1.1, .05], [3.15, .07]], shake: [[1.1, 6], [3.2, 9]] },
    { from: 6, to: 7, take: 'climb', anchor: 'split1', at: -.35, focus: 'hero', zoom: [[0, 1.1], [1, 1.16]], dim: .5 },
    { from: 7, to: 8, take: 'virus', anchor: 'split', at: .25, focus: 'hero', zoom: [[0, 1.1], [1, 1.16]], dim: .5 },
    { from: 8, to: 10, take: 'finale', anchor: 'final', at: 6.8, focus: 'hero', zoom: [[0, 1.0], [2, 1.08]], dim: .5 },
    { from: 10, to: 16, take: 'virus', anchor: 'feed', at: .2, focus: 'mix', keep: .9, mix: [[0, .12], [1.3, .12], [2.4, .9], [6, .7]], zoom: [[0, 1.0], [2.8, 1.06], [3.0, 1.14], [6, 1.06]], punch: [[2.83, .06]], shake: [[2.83, 10]] },
    { from: 16, to: 20, take: 'escape', anchor: 'close', at: 1.0, focus: 'mid', zoom: [[0, 1.0], [1.5, 1.12], [4, 1.12]], shake: [[0, 4]] },
    { from: 20, to: 23, take: 'finale', anchor: 'final', at: 1.5, focus: 'mid', zoom: [[0, 1.0], [1.5, 1.1]], punch: [[1.5, .05]], shake: [[2.2, 8]] },
    { from: 23, to: 25, take: 'finale', anchor: 'final', at: -.9, rate: .5, focus: 'hero', zoom: [[0, 1.1], [2, 1.15]], dim: .55, shake: [[0, 14]] },
    { from: 25, to: 28, take: 'finale', anchor: 'final', at: -1.9, rate: 1.6, focus: 'pan', pan: [[0, 165], [1.3, 165], [2.3, 505]], zoom: [[0, 1.0]] },
    { from: 28, to: 32, take: 'finale', anchor: 'final', at: 8, rate: .35, focus: 'hero', zoom: [[0, 1.0], [4, 1.06]], blur: 14, dim: .6 },
  ],
  overlays: [
    { from: 6, to: 7, style: 'slam', text: 'Eat.' },
    { from: 7, to: 8, style: 'slam', text: 'Split.' },
    { from: 8, to: 10, style: 'slam', text: 'Survive.' },
    { from: 10.3, to: 12.7, style: 'caption', kicker: 'Phages', text: 'Feed the phage.' },
    { from: 12.83, to: 15.8, style: 'caption', kicker: 'Phages', text: 'Pop the giant.' },
    { from: 16.2, to: 19.8, style: 'caption', kicker: 'Boost', text: 'Outrun the giants.' },
    { from: 23, to: 25, style: 'stack', lines: ['Last cell', 'standing.'] },
    { from: 28, to: 32, style: 'endcard' },
  ],
  sfx: [[6, 'eat', 80], [7, 'split'], [8, 'dash'], [23, 'lysis'], [28.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 6, kind: 'hook' }, { from: 10, to: 20, kind: 'drop' }, { from: 20, to: 23, kind: 'build' }, { from: 25, to: 28, kind: 'drop' }],
    hits: [{ beat: 6, kind: 'hit' }, { beat: 7, kind: 'hit', chord: 1 }, { beat: 8, kind: 'boom' }, { beat: 23, kind: 'boom' }, { beat: 28, kind: 'boom' },
      { beat: 6, kind: 'whoosh' }, { beat: 7, kind: 'whoosh' }, { beat: 8, kind: 'whoosh' }],
    risers: [{ from: 4, to: 6 }, { from: 8, to: 10 }, { from: 21, to: 23 }],
    endRing: 28,
  },
};

module.exports = { BPM, cuts: [trailer30, trailer15] };
