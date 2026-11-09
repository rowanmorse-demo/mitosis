// The takes for the high-end cuts (hd/cuts.js). Same tools as ../takes.js (setup, brain, P, S: see there), plus:
//   hud     'clean' films the world alone (no stick, buttons or HUD; the thumbs still press them), 'board' keeps the
//           leaderboard; leave it out for the full HUD
//   cam     a directed camera (P.cam in pilot.js): the game renders the close-ups itself, so they are sharp
//   epoch   the date the game thinks it is: after Halloween and before the Battle Pass launches (Nov 16)
//   skins   the premium skins the crowd wears; skinMap swaps a look a reused setup asks for
// Each take is written for either frame: S.at(x, y, ahead, side) and S.ang(a) put "ahead" to the right in the landscape
// set (h) and up the screen in the portrait set (v), so the action runs along the long side of the frame.
// Skin ids: 5 Nebula, 6 Magma, 7 Honeycomb, 8 Circuit, 9 Leopard, 10 Glacier, 11 Toxic, 12 Eyeball, 13 Galaxy, 14 Gilded,
// 15 Black Hole, 16 One Cell, 17 Aurora, 18 Koi, 19 Plasma, 20 Geode, 21 Sakura, 22 Supernova, 23 Glitch. Halloween
// (24-27) is out of season and the pass skins (28-31) stay unseen until the pass launches.
'use strict';
const OLD = require('../takes'), old = id => OLD.find(t => t.id === id);
const ON_SALE = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23];
const BASE = { epoch: '2026-11-10T19:30:00', hud: 'clean', skins: ON_SALE, owned: ON_SALE.concat([16]), premiumShare: 45, skinMap: { 24: 23, 25: 17, 26: 13, 27: 22 } };

module.exports = [
  // ---- the hook: a giant splits twice into a crowd and swallows it ----
  {
    ...BASE, id: 'feast', seed: 711, name: 'Juno', skin: 15, preroll: 12, frames: 230,
    cam: { span: 1500, mix: .2, ease: 3, zease: 2 },
    setup: (G, P, S) => {
      const hx = 1400, hy = 2600, d = P.data;
      S.hero({ x: hx, y: hy, mass: 4200 });
      const [cx, cy] = S.at(hx, hy, 860, 0); d.c = [cx, cy];
      S.clear(cx, cy, 2000);
      // a crowd farming a rich patch, right in the path: thirty players packed in a long oval, drifting, not looking
      const R = P.rr; d.crowd = [];
      for (let i = 0; i < 30; i++) {
        const a = i * 2.39996, rad = Math.sqrt((i + .5) / 30), [x, y] = S.at(cx, cy, Math.cos(a) * rad * 430, Math.sin(a) * rad * 400);
        const p = S.bot({ x, y, mass: R(50, 170) * (i % 6 === 0 ? 1.3 : 1), think: 9, aggr: .1 });
        p.target = { x: x + R(-120, 120), y: y + R(-120, 120) }; d.crowd.push(p);
      }
      P.interest(cx, cy);
      P.cam({ lead: S.port ? [0, .3] : [-.55, 0], snap: true });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me(), [cx, cy] = d.c;
      if (P.phase === 'start') {
        P.interest(cx, cy); P.aimAt(cx, cy);
        if (P.recT > .22 && P.thumbFree && P.aligned(cx, cy, 6)) { P.tap('split', .06); P.mark('split1'); d.s1 = P.t; P.go('two'); }
      } else if (P.phase === 'two') {
        P.aimAt(cx, cy);
        if (!d.s2 && P.t - d.s1 > .1 && P.thumbFree) { P.tap('split', .06); d.s2 = P.t; P.mark('split2'); }
        if (d.s2 && P.t - d.s2 > .1 && !d.slow) { d.slow = 1; P.mark('gulp'); P.slowmo({ to: .5, in: .06, hold: .45, out: .3 }); }
        if (d.s2 && P.t - d.s2 > .5) P.go('sweep');
      } else { // sweep up what is left: each piece goes for the nearest crowd cell
        const T = P.targets(d.crowd); const c = T[0];
        if (c) { P.interest(c.x, c.y); P.chase(c, .2); } else { P.wander(); }
      }
      P.cam({ mix: P.phase === 'sweep' ? .3 : .2 });
    },
  },

  // ---- split-and-swallow: one big rival, swallowed by a half in slow motion ----
  {
    ...BASE, id: 'swallow', seed: 712, name: 'Juno', skin: 22, preroll: 12, frames: { v: 150, h: 220 },
    cam: { span: 1400, mix: .5, ease: 3.5 },
    setup: (G, P, S) => {
      const hx = -2200, hy = 1800, d = P.data;
      S.hero({ x: hx, y: hy, mass: 3000 });
      const [rx, ry] = S.at(hx, hy, 800, 140);
      S.clear(rx, ry, 1900);
      d.rival = S.bot({ x: rx, y: ry, mass: 1240, name: 'zara', skin: 13, think: 1e6 });
      const [tx, ty] = S.at(rx, ry, 120, -900); d.rival.target = { x: tx, y: ty }; // crossing in front, not looking
      for (let i = 0; i < 5; i++) { const [x, y] = S.at(hx, hy, P.rr(-300, 1400), P.rr(-700, 700)); S.bot({ x, y, mass: P.rr(30, 90) }); }
      P.cam({ lead: S.port ? [0, .18] : [-.12, 0], snap: true });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, r = d.rival;
      if (!P.alive(r)) { if (!d.ate) { d.ate = 1; P.mark('gulp'); } P.wander(); P.interest(null); return; }
      const c = P.targets([r])[0]; P.interest(c.x, c.y);
      const f = P.front(c.x, c.y);
      P.chase(c, .3);
      if (!d.split && P.recT > .3 && P.canEat(f, c) && P.edgeGap(c) < P.splitGap(f, c) * .7 && P.cellAligned(f, c.x, c.y, 6)) {
        P.tap('split'); d.split = 1; P.mark('split'); P.slowmo({ to: .3, in: .08, hold: .7, out: .4 });
      }
    },
  },

  // ---- the phage: fed until it fires into a giant, which bursts; then the pieces are swept up ----
  {
    ...BASE, id: 'phage', seed: 713, name: 'Juno', skin: 11, preroll: 20, frames: { v: 200, h: 300 }, skip: { v: 90 },
    cam: { span: 1300, mix: .55, ease: 3 },
    setup: (G, P, S) => {
      const hx = -700, hy = -2300;
      S.hero({ x: hx, y: hy, mass: 560 });
      const [ax, ay] = S.at(hx, hy, 500, 0); S.clear(ax, ay, 1800);
      const [vx, vy] = S.at(hx, hy, 470, -40), v = S.moveVirus(S.virusNear(ax, ay), vx, vy);
      const ang = Math.atan2(v.y - hy, v.x - hx);
      const big = S.bot({ x: v.x + Math.cos(ang) * 505, y: v.y + Math.sin(ang) * 505, mass: 1500, name: 'Kai', skin: 6, think: 1e6 });
      const [bx, by] = S.at(big.cells[0].x, big.cells[0].y, 20, -80); big.target = { x: bx, y: by };
      P.data = { v, big, ang };
      for (const [dx, dy, m] of [[-500, 520, 80], [200, -650, 140], [1100, 600, 260]]) { const [x, y] = S.at(hx, hy, dx, dy); S.bot({ x, y, mass: m }); }
      P.cam({ lead: S.port ? [0, -.1] : [-.08, 0], snap: true }); // portrait: the action high, the words under it
    },
    brain: old('virus').brain,
  },

  // ---- the other side: small, a giant splits at you, you boost clear ----
  {
    ...old('escape'), ...BASE, id: 'escape', seed: 714, skin: 17, frames: { v: 200, h: 330 }, skip: { v: 50 },
    cam: { span: 1450, mix: .5, ease: 4 },
    setup: (G, P, S) => {
      const hx = 2300, hy = -1400;
      S.hero({ x: hx, y: hy, mass: 360 });
      const [ax, ay] = S.at(hx, hy, -600, 0); S.clear(ax, ay, 2000);
      const [bx, by] = S.at(hx, hy, -1250, 160);
      P.data.big = S.bot({ x: bx, y: by, mass: 1650, name: 'nightshade', skin: 15, think: 1e6 });
      for (let i = 0; i < 4; i++) { const [x, y] = S.at(hx, hy, P.rr(-900, 700), P.rr(-650, 650) * (i % 2 ? 1 : -1)); S.bot({ x, y, mass: P.rr(30, 120) }); }
      P.steer(S.ang(Math.PI * .95), .9);
      P.cam({ lead: S.port ? [0, -.05] : [0, 0], snap: true });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me(), big = d.big, b = big.cells.reduce((a, c) => (!a || c.mass > a.mass) ? c : a, null);
      if (!d.split) big.target = { x: s.x + (G.human.cells[0].svx || 0) * .35, y: s.y + (G.human.cells[0].svy || 0) * .35 };
      const gap = P.hyp(b.x - s.x, b.y - s.y) - b.r - s.r;
      P.interest((b.x + s.x) / 2, (b.y + s.y) / 2);
      if (P.phase === 'start') {
        P.wander(); if (P.intent) P.steer(S.ang(Math.PI * .97 + Math.sin(P.t * 1.3) * .25), .9);
        if (gap < 610) P.go('notice');
      } else if (P.phase === 'notice') {
        { const n = P.targets([big])[0] || b; P.away(n.x, n.y, -.15); }
        const awayA = Math.atan2(s.y - b.y, s.x - b.x), turned = Math.abs(P.wrap(P.heading() - awayA)) < .8;
        if (!d.split && gap < 600 && turned && d.lastGap != null && gap > d.lastGap) { big.target = { x: s.x + (G.human.cells[0].svx || 0) * .25, y: s.y + (G.human.cells[0].svy || 0) * .25 }; G.split(big); P.sfx('split'); d.split = P.t; P.mark('bigsplit'); }
        if (d.split && !d.boost && P.t - d.split > .08 && Math.abs(P.wrap(P.heading() - awayA)) < .45) { P.tap('boost', .09); d.boost = 1; P.mark('boost'); }
        if (d.split && !d.slow) { const n = P.targets([big])[0]; if (n && P.edgeGap(n) < 130) { d.slow = 1; P.mark('close'); P.slowmo({ to: .3, in: .06, hold: 1.0, out: .4 }); } }
        if (d.split && P.t - d.split > 1.4) P.go('away');
      } else { const n = P.targets([big])[0] || b; P.away(n.x, n.y, .15); }
      d.lastGap = gap;
    },
  },

  // ---- the skins, close up: the hero changes look on every beat while it farms ----
  {
    ...BASE, id: 'skins', seed: 715, name: 'Juno', skin: 15, preroll: 20, frames: { v: 200, h: 200 },
    cam: { span: 620, mix: 0, ease: 6 },
    setup: (G, P, S) => {
      const hx = 3000, hy = 1200;
      S.hero({ x: hx, y: hy, mass: 950 });
      S.clear(hx, hy, 1500);
      for (let i = 0; i < 6; i++) { const [x, y] = S.at(hx, hy, P.rr(500, 1400), P.rr(-800, 800)); S.bot({ x, y, mass: P.rr(25, 70) }); }
      P.data.order = [15, 22, 13, 5, 19, 17, 23, 6, 18, 20, 14, 12, 21, 10];
      P.data.every = 60 * 60 / 128; // one look a beat at 128 BPM
      P.cam({ lead: [0, S.port ? -.02 : 0], snap: true });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, i = Math.floor((P.frame + .5) / d.every);
      if (P.recT >= 0 && d.shown !== i && i < d.order.length) { d.shown = i; S.skin(G.human, d.order[i]); P.mark('skin' + i); }
      P.wander(); if (P.intent) P.steer(S.ang(-.25 + Math.sin(P.t * .5) * .35), .55);
    },
  },

  // ---- the arena closes, the last rival goes, Victory (full HUD for the results) ----
  {
    ...old('finale'), ...BASE, id: 'finale', skin: 13, hud: 'clean', frames: 470, skip: { v: 230 }, dsf: { v: 3.6, h: 3 },
    cam: { span: 2300, mix: .45, ease: 3 },
  },

  // ---- landscape-only extras for the App Store preview ----
  { ...old('leviathan'), ...BASE, id: 'leviathan', skin: 5, cam: { span: 1700, mix: .5, ease: 3 } },
  { ...old('climb'), ...BASE, id: 'climb', skin: 20, hud: 'board', frames: 200, dsf: { v: 3.6 }, cam: { span: 1500, mix: .45, ease: 3 } },
];
