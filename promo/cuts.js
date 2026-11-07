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
    { from: 36, to: 40, style: 'caption', kicker: 'Skins', text: '27 premium skins.' },
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

// The investor demo: the whole product in 90 s (192 beats). Gameplay first, then the menus filmed from a real account
// (takes m-*): skins, the shop and Battle Pass, friends and ranks. Every caption is a shipped feature or a catalogue price.
const MENU = { focus: [384, 216], zoom: [[0, 1.0]] }; // a menu take: the whole screen, no punch-ins
const investor90 = {
  name: 'mitosis-investor-demo-90s-16x9', w: 1920, h: 1080, beats: 192,
  shots: [
    // hook and title
    { from: 0, to: 8, ...HOOK, zoom: [[0, 1.12], [2.6, 1.12], [3.4, 1.28], [8, 1.42]], punch: [[1.1, .05], [3.15, .07]], shake: [[1.1, 6], [3.2, 9]] },
    { from: 8, to: 16, take: 'm-lobby', anchor: 'open', at: 0, ...MENU, dim: .55 },
    // the core loop
    { from: 16, to: 17, take: 'climb', anchor: 'split1', at: -.35, focus: 'hero', zoom: [[0, 1.3], [1, 1.38]], dim: .5 },
    { from: 17, to: 18, take: 'virus', anchor: 'split', at: .25, focus: 'hero', zoom: [[0, 1.3], [1, 1.4]], dim: .5 },
    { from: 18, to: 20, take: 'finale', anchor: 'final', at: 6.8, focus: 'hero', zoom: [[0, 1.0], [2, 1.12]], dim: .5 },
    { from: 20, to: 28, take: 'escape', anchor: 'close', at: 2.2, focus: 'mid', zoom: [[0, 1.12], [2, 1.2], [3.2, 1.42], [6, 1.42], [8, 1.2]], shake: [[1.0, 5]] },
    { from: 28, to: 36, take: 'virus', anchor: 'feed', at: 1, focus: 'interest', zoom: [[0, 1.15], [3, 1.22], [3.7, 1.32], [6, 1.32], [8, 1.18]], punch: [[3.63, .06]], shake: [[3.63, 10]] },
    { from: 36, to: 44, take: 'leviathan', anchor: 'pop', at: 4, rate: [[0, 1.25], [4, 1], [6, 1.25]], focus: 'mid', zoom: [[0, 1.0], [3.6, 1.12], [4.2, 1.3], [8, 1.2]], punch: [[4, .07]], shake: [[0.1, 6], [4, 12]] },
    { from: 44, to: 48, take: 'climb', anchor: 'split1', at: 1.1, focus: [668, 70], zoom: [[0, 1.0], [1.7, 1.0], [2.3, 1.85], [4, 1.95]] },
    { from: 48, to: 56, take: 'finale', anchor: 'final', at: 4.6, focus: 'mid', zoom: [[0, 1.0], [4, 1.1], [4.7, 1.32], [6, 1.38], [8, 1.3]], punch: [[4.7, .05]], shake: [[5.3, 8]] },
    // skins: the Skins page picking through the collection, then four heroes in play
    { from: 56, to: 80, take: 'm-skins', anchor: 'open', at: .2, ...MENU },
    { from: 80, to: 81, take: 'chain', anchor: 'boost', at: 1.4, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    { from: 81, to: 82, take: 'escape', anchor: 'bigsplit', at: 2.2, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    { from: 82, to: 83, take: 'virus', anchor: 'feed', at: 1.2, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    { from: 83, to: 84, take: 'leviathan', anchor: 'event', at: .6, focus: 'hero', offset: [0, -40], zoom: [[0, 1.8], [1, 1.9]] },
    // the economy: the shop, then the Battle Pass
    { from: 84, to: 106, take: 'm-shop', anchor: 'open', at: .4, ...MENU },
    { from: 106, to: 126, take: 'm-pass', anchor: 'open', at: .5, ...MENU },
    // social and competitive
    { from: 126, to: 138, take: 'm-friends', anchor: 'open', at: .4, ...MENU },
    { from: 138, to: 150, take: 'm-ranks', anchor: 'open', at: .4, ...MENU },
    { from: 150, to: 160, take: 'climb', anchor: 'split1', at: -.4, focus: 'hero', zoom: [[0, 1.05], [10, 1.15]], dim: .35 },
    { from: 160, to: 168, take: 'leviathan', anchor: 'pop', at: -1.67, focus: 'mid', zoom: [[0, 1.0], [8, 1.1]], dim: .35 },
    // finale and end card
    { from: 168, to: 174, take: 'finale', anchor: 'final', at: 4.6, focus: 'mid', zoom: [[0, 1.0], [4, 1.1], [4.7, 1.32], [6, 1.38]], punch: [[4.7, .05]], shake: [[5.3, 8]] },
    { from: 174, to: 176, take: 'finale', anchor: 'final', at: -.9, rate: .5, focus: 'hero', zoom: [[0, 1.3], [2, 1.36]], dim: .55, shake: [[0, 14]] },
    { from: 176, to: 180, take: 'finale', anchor: 'final', at: -1.6, rate: 1.35, focus: [384, 216], zoom: [[0, 1.0]] },
    { from: 180, to: 192, take: 'finale', anchor: 'final', at: 10, rate: .35, focus: 'hero', zoom: [[0, 1.2], [12, 1.32]], blur: 14, dim: .6 },
  ],
  overlays: [
    { from: 9, to: 12.4, style: 'stack', lines: ['Mitosis'] },
    { from: 12.4, to: 15.8, style: 'caption', kicker: 'iPhone · Android · Web', text: 'A multiplayer cell arena.' },
    { from: 16, to: 17, style: 'slam', text: 'Eat.' },
    { from: 17, to: 18, style: 'slam', text: 'Split.' },
    { from: 18, to: 20, style: 'slam', text: 'Survive.' },
    { from: 20.4, to: 24.2, style: 'caption', kicker: 'Boost', text: 'Outrun the giants.' },
    { from: 28.3, to: 31.4, style: 'caption', kicker: 'Phages', text: 'Feed the phage.' },
    { from: 31.63, to: 35.4, style: 'caption', kicker: 'Phages', text: 'Pop the giant.' },
    { from: 36.4, to: 39.8, style: 'caption', kicker: 'World events', text: 'The Leviathan surfaces.' },
    { from: 44.2, to: 47.9, style: 'caption', kicker: 'Live leaderboard', text: 'Climb to #1.' },
    { from: 48.3, to: 52, style: 'caption', kicker: '10-minute rounds', text: 'The arena closes in.' },
    { from: 57, to: 63.5, style: 'caption', kicker: 'Skins', text: '27 premium skins, all animated.', pos: 'foot', scale: .62 },
    { from: 64, to: 71.5, style: 'caption', kicker: 'Common to Legendary', text: 'From 300 to 12,000,000 ATP.', pos: 'foot', scale: .62 },
    { from: 72, to: 79.5, style: 'caption', kicker: 'Seasonal', text: 'Limited drops on a countdown.', pos: 'foot', scale: .62 },
    { from: 80, to: 84, style: 'caption', kicker: 'In the arena', text: 'Worn in every match.' },
    { from: 85, to: 92.5, style: 'caption', kicker: 'Shop', text: 'Skins sell for ATP, the in-game currency.', pos: 'foot', scale: .62 },
    { from: 93, to: 99.5, style: 'caption', kicker: 'Earned and bought', text: 'Win ATP in matches, or buy packs in-app.', pos: 'foot', scale: .62 },
    { from: 100, to: 105.6, style: 'caption', kicker: 'In-app purchases', text: 'ATP packs from 500 to 150,000.', pos: 'foot', scale: .62 },
    { from: 107, to: 113.5, style: 'caption', kicker: 'Battle Pass · Season 1', text: 'Free and premium tiers, every 6 weeks.', pos: 'foot', scale: .62 },
    { from: 114, to: 119.5, style: 'caption', kicker: 'Premium track', text: '2,500 ATP, or 4,500 with 10 tiers.', pos: 'foot', scale: .62 },
    { from: 120, to: 125.6, style: 'caption', kicker: 'Quests', text: 'Daily and weekly goals bring players back.', pos: 'foot', scale: .62 },
    { from: 127, to: 137.5, style: 'caption', kicker: 'Friends & parties', text: 'Queue together. Out of lives? Watch your ally.', pos: 'foot', scale: .62 },
    { from: 139, to: 149.5, style: 'caption', kicker: 'Ranked', text: 'Six tiers, and a separate rating vs AI.', pos: 'foot', scale: .62 },
    { from: 150.5, to: 159.5, style: 'caption', kicker: 'Nearby', text: 'Phone to phone over Bluetooth. No internet needed.' },
    { from: 160.5, to: 167.5, style: 'caption', kicker: 'Built for phones', text: 'Touch controls, haptics, battery saver.' },
    { from: 174, to: 176, style: 'stack', lines: ['Last cell', 'standing.'] },
    { from: 180, to: 192, style: 'endcard' },
  ],
  sfx: [[16, 'eat', 80], [17, 'split'], [18, 'dash'], [174, 'lysis'], [180.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 8, kind: 'hook' }, { from: 8, to: 16, kind: 'break' }, { from: 20, to: 56, kind: 'drop' }, { from: 56, to: 84, kind: 'break' },
      { from: 84, to: 126, kind: 'drop2' }, { from: 126, to: 150, kind: 'break' }, { from: 150, to: 168, kind: 'drop' }, { from: 168, to: 174, kind: 'build' }, { from: 176, to: 180, kind: 'drop' }],
    hits: [{ beat: 8, kind: 'boom' }, { beat: 16, kind: 'hit' }, { beat: 17, kind: 'hit', chord: 1 }, { beat: 18, kind: 'boom' }, { beat: 56, kind: 'boom' }, { beat: 84, kind: 'boom' },
      { beat: 126, kind: 'boom' }, { beat: 150, kind: 'boom' }, { beat: 174, kind: 'boom' }, { beat: 180, kind: 'boom' },
      { beat: 16, kind: 'whoosh' }, { beat: 17, kind: 'whoosh' }, { beat: 18, kind: 'whoosh' }, { beat: 80, kind: 'whoosh', v: .7 }, { beat: 81, kind: 'whoosh', v: .5 }, { beat: 82, kind: 'whoosh', v: .5 }, { beat: 83, kind: 'whoosh', v: .5 },
      { beat: 106, kind: 'whoosh', v: .6 }, { beat: 138, kind: 'whoosh', v: .6 }],
    risers: [{ from: 6, to: 8 }, { from: 14, to: 16 }, { from: 54, to: 56, v: .7 }, { from: 82, to: 84 }, { from: 148, to: 150, v: .8 }, { from: 171, to: 174 }],
    endRing: 180,
  },
};

// The 30-second gameplay cut (64 beats), for investors: no menus, the game itself. A cold open on a small cell popping the
// king on a phage, the title on the next downbeat, the loop in three words, Frenzy, the Leviathan, six skins in play
// (Legendary last), the leaderboard, the round's end, and the Victory screen counting the Elo up to a promotion.
const SKIN = { focus: 'hero', offset: [0, 40], zoom: [[0, 1.7], [1, 1.8]] }; // a hero close-up, framed high over the caption
const gameplay30 = {
  name: 'mitosis-gameplay-30s-16x9', w: 1920, h: 1080, beats: 64,
  shots: [
    // cold open: the phage fires into the king and it bursts on beat 3
    { from: 0, to: 4, take: 'virus', anchor: 'feed', at: .37, focus: 'mix', mix: [[0, .3], [2.6, .6]], zoom: [[0, 1.42], [2.7, 1.3], [3.05, 1.12], [4, 1.06]], punch: [[3, .07]], shake: [[3, 12]] },
    // the title on the downbeat, over the burst still flying, dark and soft
    { from: 4, to: 8, take: 'virus', anchor: 'feed', at: -3.7, focus: 'interest', zoom: [[0, 1.12], [4, 1.2]], dim: .58, blur: 5 },
    // the loop in three words
    { from: 8, to: 9, take: 'chain', anchor: 'boost', at: 3.25, focus: 'hero', zoom: [[0, 1.3], [1, 1.38]], dim: .5 },
    { from: 9, to: 10, take: 'climb', anchor: 'split1', at: .25, focus: 'hero', zoom: [[0, 1.3], [1, 1.4]], dim: .5 },
    { from: 10, to: 12, take: 'escape', anchor: 'close', at: .6, focus: 'mid', zoom: [[0, 1.1], [2, 1.2]], dim: .5 },
    // Frenzy: the Supernova splits through a crowd, twice
    { from: 12, to: 20, take: 'chain', anchor: 'split1', at: .9, focus: 'mix', mix: .35, keep: .3, zoom: [[0, 1.2], [.9, 1.2], [1.4, 1.32], [8, 1.22]], punch: [[.9, .05], [3.8, .04]], shake: [[.9, 6]] },
    // the Leviathan surfaces and pops on a phage on beat 24
    { from: 20, to: 28, take: 'leviathan', anchor: 'pop', at: 4, rate: [[0, 1.25], [4, 1], [6, 1.25]], focus: 'mid', zoom: [[0, 1.0], [3.6, 1.12], [4.2, 1.3], [8, 1.2]], punch: [[4, .07]], shake: [[0.3, 6], [4, 12]] },
    // skins in play, a beat each (Toxic, Galaxy, Black Hole, Supernova, Gilded), then One Cell to Rule Them All held
    { from: 28, to: 29, take: 'virus', anchor: 'feed', at: 1.2, ...SKIN },
    { from: 29, to: 30, take: 'climb', anchor: 'split1', at: -5, ...SKIN },
    { from: 30, to: 31, take: 'escape', anchor: 'bigsplit', at: 2.2, ...SKIN, zoom: [[0, 2.1], [1, 2.2]] },
    { from: 31, to: 32, take: 'chain', anchor: 'boost', at: 1.4, ...SKIN },
    { from: 32, to: 33, take: 'leviathan', anchor: 'pop', at: -6.5, ...SKIN },
    { from: 33, to: 36, take: 'finale', anchor: 'final', at: 7, focus: 'hero', offset: [0, 34], zoom: [[0, 1.5], [3, 1.65]] },
    // the leaderboard: Juno takes #1
    { from: 36, to: 40, take: 'climb', anchor: 'split1', at: 1.1, focus: [668, 70], zoom: [[0, 1.0], [1.7, 1.0], [2.3, 1.85], [4, 1.95]] },
    // the arena closes; the last rival goes (and again in slow motion)
    { from: 40, to: 46, take: 'finale', anchor: 'final', at: 3.6, focus: 'mid', zoom: [[0, 1.0], [3, 1.1], [3.7, 1.32], [6, 1.38]], punch: [[3.7, .05]], shake: [[4.3, 8]] },
    { from: 46, to: 48, take: 'finale', anchor: 'final', at: -.9, rate: .5, focus: 'hero', zoom: [[0, 1.3], [2, 1.36]], dim: .55, shake: [[0, 14]] },
    // Victory: the rating counts 1388 to 1412, past Platinum, and the card says Promoted
    { from: 48, to: 56, take: 'finale', anchor: 'win', at: -1.78, focus: [384, 230], zoom: [[0, 1.04], [8, 1.1]] },
    // the end card over the Victory screen, slowed and blurred
    { from: 56, to: 64, take: 'finale', anchor: 'win', at: -22.7, rate: .35, focus: [384, 216], zoom: [[0, 1.1], [8, 1.18]], blur: 14, dim: .6 },
  ],
  overlays: [
    { from: 4, to: 8, style: 'title', tag: 'The multiplayer cell arena' },
    { from: 8, to: 9, style: 'slam', text: 'Eat.' },
    { from: 9, to: 10, style: 'slam', text: 'Split.' },
    { from: 10, to: 12, style: 'slam', text: 'Survive.' },
    { from: 12.4, to: 19.6, style: 'caption', kicker: 'Frenzy', text: 'Chain kills into a Frenzy.' },
    { from: 20.4, to: 23.8, style: 'caption', kicker: 'World events', text: 'The Leviathan surfaces.' },
    { from: 24, to: 27.7, style: 'caption', kicker: 'Phages', text: 'Pop the giant.' },
    { from: 28, to: 32.9, style: 'caption', kicker: 'Skins', text: '27 skins to collect.' },
    { from: 33, to: 35.9, style: 'caption', kicker: 'Legendary', text: 'One Cell to Rule Them All.' },
    { from: 36.2, to: 39.8, style: 'caption', kicker: 'Live leaderboard', text: 'Climb to #1.' },
    { from: 40.3, to: 43.6, style: 'caption', kicker: '10-minute rounds', text: 'The arena closes in.' },
    { from: 46, to: 48, style: 'stack', lines: ['Last cell', 'standing.'] },
    { from: 49.5, to: 55.8, style: 'caption', kicker: 'Ranked', text: 'Win, gain Elo, get promoted.' },
    { from: 56, to: 64, style: 'endcard' },
  ],
  sfx: [[8, 'eat', 80], [9, 'split'], [10, 'dash'], [46, 'lysis'], [56.5, 'ach']],
  music: {
    sections: [{ from: 0, to: 3, kind: 'hook' }, { from: 4, to: 8, kind: 'break' }, { from: 12, to: 28, kind: 'drop' }, { from: 28, to: 36, kind: 'drop2' },
      { from: 36, to: 40, kind: 'drop' }, { from: 40, to: 46, kind: 'build' }, { from: 48, to: 56, kind: 'break' }],
    hits: [{ beat: 3, kind: 'hit' }, { beat: 4, kind: 'boom' }, { beat: 8, kind: 'hit' }, { beat: 9, kind: 'hit', chord: 1 }, { beat: 10, kind: 'boom' }, { beat: 24, kind: 'boom', v: .8 },
      { beat: 28, kind: 'boom' }, { beat: 46, kind: 'boom' }, { beat: 56, kind: 'boom' },
      { beat: 8, kind: 'whoosh' }, { beat: 9, kind: 'whoosh' }, { beat: 10, kind: 'whoosh' }, { beat: 29, kind: 'whoosh', v: .5 }, { beat: 30, kind: 'whoosh', v: .5 }, { beat: 31, kind: 'whoosh', v: .5 },
      { beat: 32, kind: 'whoosh', v: .5 }, { beat: 33, kind: 'whoosh', v: .7 }, { beat: 36, kind: 'whoosh', v: .6 }, { beat: 48, kind: 'whoosh', v: .6 }],
    risers: [{ from: 1, to: 3 }, { from: 10, to: 12 }, { from: 22, to: 24, v: .7 }, { from: 43, to: 46 }],
    endRing: 56,
  },
};

module.exports = { BPM, cuts: [trailer30, trailer15, investor90, gameplay30] };
