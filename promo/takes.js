// The takes: each one sets up a real moment in the arena and plays it through the touch controls.
// setup(G, P, S) runs once when the game has started; brain(G, P, S, dt) runs every frame and steers through P
// (P.aimAt / P.chase / P.away / P.wander set where the left thumb wants to go; P.tap / P.hold press buttons with
// the right thumb). Both are serialised and run inside the page, so they can only use their arguments.
// P.mark(name) records the frame of a moment for the edit; P.slowmo() slows the whole page down for a beat.
// The hero's skin and name come from the take (skin ids: 24 Ghost, 25 Widow, 26 Jack-o'-Lantern, 27 Witching Hour).
'use strict';
module.exports = [
  // ---- boost, split, split again: a chain through a group of small cells ----
  {
    id: 'chain', seed: 101, name: 'Juno', skin: 26, preroll: 10, frames: 360,
    setup: (G, P, S) => {
      const hx = -1800, hy = 900; P.data.home = { x: hx, y: hy };
      S.hero({ x: hx, y: hy, mass: 1000 });
      S.clear(hx + 700, hy, 1900);
      P.data.first = S.bot({ x: hx + 760, y: hy + 30, mass: 92, think: 2.6, aggr: .3 });
      P.data.pack = [[1290, -110, 84], [1360, 70, 78], [1450, -40, 90], [1520, 130, 70], [1560, -170, 74], [1650, 20, 66]].map(([dx, dy, m], i) =>
        S.bot({ x: hx + dx, y: hy + dy, mass: m, think: 3.5 + i * .08, aggr: .3 }));
      for (const v of [P.data.first, ...P.data.pack]) v.target = { x: v.cells[0].x + P.rr(-60, 260), y: v.cells[0].y + P.rr(-200, 200) };
      S.bot({ x: hx - 650, y: hy - 520, mass: 300 }); S.bot({ x: hx + 200, y: hy + 720, mass: 150 }); S.bot({ x: hx - 380, y: hy + 560, mass: 52 });
      S.bot({ x: hx + 900, y: hy - 650, mass: 210 });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me();
      if (P.phase === 'start') {
        const c = P.alive(d.first) ? d.first.cells[0] : null; if (!c) { P.go('one'); return; }
        P.interest(c.x, c.y); P.chase(c, .2);
        const gap = P.edgeGap(c);
        if (gap < 470 && P.thumbFree && !d.boosted && P.cellAligned(s.big, c.x, c.y, 10)) { P.tap('boost'); d.boosted = P.t; P.mark('boost'); }
        if (d.boosted && P.t - d.boosted > .16 && gap < 360 && P.cellAligned(s.big, c.x, c.y, 6)) { P.tap('split'); P.mark('split1'); P.go('one'); }
      } else if (P.phase === 'one') {
        const T = P.targets(d.pack); const c = T[0]; if (!c) { P.go('cruise'); return; }
        // line the front piece up on the middle of the pack, then split it in
        let cx = 0, cy = 0; for (const k of T.slice(0, 3)) { cx += k.x; cy += k.y; } cx /= Math.min(3, T.length); cy /= Math.min(3, T.length);
        P.interest(cx, cy); P.aimAt(cx, cy);
        const f = P.front(cx, cy);
        if (P.phaseT > .3 && G.human.cells.length <= 2 && f.mass >= 72 && P.cellAligned(f, cx, cy, 7) && P.hyp(f.x - cx, f.y - cy) - f.r < 560) {
          P.tap('split'); P.mark('split2'); P.slowmo({ to: .28, in: .05, hold: .6, out: .35 }); P.go('two');
        }
      } else if (P.phase === 'two') { // and once more, into what is left of the pack
        const T = P.targets(d.pack); const c = T[0]; if (!c) { P.go('cruise'); return; }
        P.interest(c.x, c.y); P.chase(c, .25);
        const f = P.front(c.x, c.y);
        if (!d.s3 && P.phaseT > .3 && G.human.cells.length <= 4 && P.canEat(f, c) && P.edgeGap(c) < P.splitGap(f, c) * .65 && P.cellAligned(f, c.x, c.y, 7)) { P.tap('split'); d.s3 = 1; P.mark('split3'); }
        if (P.phaseT > 2.2) P.go('cruise');
      } else { P.wander(); P.interest(null); }
    },
  },

  // ---- the close escape: a giant splits at you, you boost out of reach ----
  {
    id: 'escape', seed: 202, name: 'Juno', skin: 27, preroll: 20, frames: 330,
    setup: (G, P, S) => {
      const hx = 2300, hy = -1400;
      S.hero({ x: hx, y: hy, mass: 360 });
      S.clear(hx - 600, hy, 2000);
      const big = S.bot({ x: hx - 1250, y: hy + 160, mass: 1650, name: 'nightshade', skin: 15, think: 1e6 });
      P.data.big = big;
      for (let i = 0; i < 4; i++) S.bot({ x: hx + P.rr(-900, 700), y: hy + P.rr(-650, 650) * (i % 2 ? 1 : -1), mass: P.rr(30, 120) });
      P.steer(Math.PI * .95, .9);
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me(), big = d.big, b = big.cells.reduce((a, c) => (!a || c.mass > a.mass) ? c : a, null);
      // the giant drifts in on the hero (it is a person too: it leads its target a little)
      if (!d.split) big.target = { x: s.x + (G.human.cells[0].svx || 0) * .35, y: s.y + (G.human.cells[0].svy || 0) * .35 };
      const gap = P.hyp(b.x - s.x, b.y - s.y) - b.r - s.r;
      P.interest((b.x + s.x) / 2, (b.y + s.y) / 2);
      if (P.phase === 'start') { // farming toward the left, not looking
        P.wander(); if (P.intent) P.steer(Math.PI * .97 + Math.sin(P.t * 1.3) * .25, .9);
        if (gap < 610) { P.go('notice'); }
      } else if (P.phase === 'notice') { // sees it: swings away (the thumb catches up after a reaction)
        { const n = P.targets([big])[0] || b; P.away(n.x, n.y, -.15); }
        // the giant commits when it sees the hero turn to run; the hero boosts only once the stick points away
        const awayA = Math.atan2(s.y - b.y, s.x - b.x), turned = Math.abs(P.wrap(P.heading() - awayA)) < .8;
        if (!d.split && gap < 600 && turned && d.lastGap != null && gap > d.lastGap) { big.target = { x: s.x + (G.human.cells[0].svx || 0) * .25, y: s.y + (G.human.cells[0].svy || 0) * .25 }; G.split(big); P.sfx('split'); d.split = P.t; P.mark('bigsplit'); }
        if (d.split && !d.boost && P.t - d.split > .08 && Math.abs(P.wrap(P.heading() - awayA)) < .45) { P.tap('boost', .09); d.boost = 1; P.mark('boost'); }
        // slow motion as the half closes in, through the moment it slides past
        if (d.split && !d.slow) { const n = P.targets([big])[0]; if (n && P.edgeGap(n) < 130) { d.slow = 1; P.mark('close'); P.slowmo({ to: .3, in: .06, hold: 1.0, out: .4 }); } }
        if (d.split && P.t - d.split > 1.4) P.go('away');
      } else { const n = P.targets([big])[0] || b; P.away(n.x, n.y, .15); }
      d.lastGap = gap;
    },
  },

  // ---- feed a phage until it fires into a giant, then sweep up the pieces ----
  {
    id: 'virus', seed: 303, name: 'Juno', skin: 24, preroll: 20, frames: 360,
    setup: (G, P, S) => {
      const hx = -700, hy = -2300;
      S.hero({ x: hx, y: hy, mass: 560 });
      S.clear(hx + 500, hy, 1800);
      const v = S.moveVirus(S.virusNear(hx + 500, hy), hx + 470, hy - 40);
      const ang = Math.atan2(v.y - hy, v.x - hx);
      const big = S.bot({ x: v.x + Math.cos(ang) * 505, y: v.y + Math.sin(ang) * 505, mass: 1500, name: 'Kai', skin: 22, think: 1e6 });
      big.target = { x: big.cells[0].x + 20, y: big.cells[0].y - 80 };
      P.data = { v, big, ang };
      S.bot({ x: hx - 500, y: hy + 520, mass: 80 }); S.bot({ x: hx + 200, y: hy - 650, mass: 140 }); S.bot({ x: hx + 1100, y: hy + 600, mass: 260 });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me(), v = d.v;
      if (d.fv != null && !d.shot && G.freeV.length > d.fv) { d.shot = P.t; P.mark('shot'); P.slowmo({ to: .3, in: .03, hold: .7, out: .35 }); }
      if (d.shot && !d.hit && d.big.cells.length > 1) { d.hit = 1; P.mark('hit'); P.sfx('pop'); } // the game plays its pop only for your own cells
      if (P.phase === 'start') { // ease in to shooting range, nose on the phage
        P.interest((v.x + d.big.cells[0].x) / 2, (v.y + d.big.cells[0].y) / 2);
        const dist = P.hyp(v.x - s.x, v.y - s.y);
        P.aimAt(v.x, v.y, .95);
        if (P.recT > .5 && dist < 384 && P.aligned(v.x, v.y, 3)) { d.fv = G.freeV.length; P.hold('shoot', .43); P.mark('feed'); P.go('feed'); }
      } else if (P.phase === 'feed') {
        // hold Shoot with the nose on the phage, then peel off to the side so as not to drift into it
        if (!d.off) { P.aimAt(v.x, v.y, .95); if (P.thumbFree && P.phaseT > .45) d.off = P.t; }
        else P.steer(Math.atan2(v.y - s.y, v.x - s.x) - 1.75, .9);
        if (d.shot && P.t - d.shot > .5) P.go('sweep');
      } else if (P.phase === 'sweep') { // go for the pieces, split onto a pair of them
        const T = P.targets([d.big]).filter(c => c.mass * 1.15 < s.big.mass);
        const c = T[0]; if (!c) { P.wander(); return; }
        P.interest(c.x, c.y); P.chase(c, .25);
        if (!d.split && P.phaseT > .5 && P.edgeGap(c) < P.splitGap(s.big, c) * .55 && P.canEat(s.big, c) && P.cellAligned(s.big, c.x, c.y, 7)) { P.tap('split'); d.split = 1; P.mark('split'); }
      }
    },
  },

  // ---- up the leaderboard to #1 ----
  {
    id: 'climb', seed: 404, name: 'Juno', skin: 13, board: true, preroll: 20, frames: 330,
    setup: (G, P, S) => {
      const hx = 900, hy = 2600;
      S.hero({ x: hx, y: hy, mass: 1640 });
      S.clear(hx, hy, 2100);
      S.bot({ x: -3500, y: -1800, mass: 2190, name: 'zara', skin: 21 });
      S.bot({ x: 3600, y: -900, mass: 1960, name: 'Kenji', skin: 10 });
      S.bot({ x: -2200, y: 3000, mass: 1250, name: 'mochi' });
      S.bot({ x: 2800, y: 1700, mass: 1130, name: 'Elif', skin: 25 });
      // one big catch takes the hero from #3 straight to #1
      P.data.a = S.bot({ x: hx + 960, y: hy - 120, mass: 690, think: 1.9, aggr: .2, skin: 18, name: 'Ravi' });
      P.data.b = S.bot({ x: hx + 1500, y: hy + 520, mass: 150, think: 2.2, aggr: .2 });
      S.bot({ x: hx - 800, y: hy + 600, mass: 120 }); S.bot({ x: hx + 200, y: hy - 800, mass: 60 });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me();
      const list = [d.a, d.b].filter(P.alive); const T = P.targets(list); const c = T[0];
      if (!c) { P.wander(); P.interest(null); return; }
      P.interest(c.x, c.y); P.chase(c, .3);
      const f = P.front(c.x, c.y);
      if (P.phaseT > .6 && P.thumbFree && P.canEat(f, c) && P.edgeGap(c) < P.splitGap(f, c) * .75 && P.cellAligned(f, c.x, c.y, 6) && G.human.cells.length < 4) {
        P.tap('split'); P.mark('split' + (d.n = (d.n || 0) + 1)); P.go('start');
      }
    },
  },

  // ---- the Leviathan surfaces, chases, and is lured onto a phage ----
  {
    id: 'leviathan', seed: 505, name: 'Juno', skin: 25, preroll: 30, frames: 420,
    setup: (G, P, S) => {
      const hx = -2600, hy = -800;
      S.hero({ x: hx, y: hy, mass: 620 });
      S.clear(hx + 500, hy, 2100);
      P.data.v = S.moveVirus(S.virusNear(hx + 400, hy), hx + 420, hy + 20);
      S.bot({ x: hx - 300, y: hy - 650, mass: 70 }); S.bot({ x: hx - 500, y: hy + 600, mass: 160 }); S.bot({ x: hx + 300, y: hy + 700, mass: 40 });
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me(), v = d.v;
      if (!d.lev) { // farming toward the right; half a second in the event starts: banner, boss sound, and it surfaces ahead
        P.wander(); if (P.intent) P.steer(Math.sin(P.t * .9) * .3, .85);
        if (P.recT < .45) return;
        G.startEvent(4); const lev = G.players.find(p => p.boss);
        const a = Math.atan2(v.y - s.y, v.x - s.x);
        S.place(lev, v.x + Math.cos(a) * 470, v.y + Math.sin(a) * 470 + 30, 2600); lev.cells[0].dr = 3; lev.fx.shield = 0; lev.pk = G.PBIT.flagella; d.lev = lev; P.mark('event'); P.go('start'); return;
      }
      const lev = d.lev, L = lev.cells.reduce((a, c) => (!a || c.mass > a.mass) ? c : a, null);
      if (!L) { P.wander(); return; }
      if (lev.cells.length > 2 && !d.popped) { d.popped = P.t; P.mark('pop'); P.sfx('pop'); P.slowmo({ to: .32, in: .04, hold: .6, out: .35 }); P.go('feast'); }
      if (P.phase === 'start') { // a beat to take it in, still drifting
        P.interest((L.x + s.x) / 2, (L.y + s.y) / 2); P.steer(Math.sin(P.t * .9) * .3, .7);
        if (P.phaseT > .3) P.go('run');
      } else if (P.phase === 'run') { // back off, keeping the phage between us so it ploughs straight into it
        P.interest((L.x + s.x) / 2, (L.y + s.y) / 2);
        P.away(v.x, v.y, Math.sin(P.t * 1.7) * .12);
        if (P.phaseT > 7) P.go('feast');
      } else { // turn round and take a piece
        const T = P.targets([lev]).filter(c => c.mass * 1.15 < s.big.mass);
        const c = T[0]; if (!c || P.edgeGap(L) < 260) { P.away(L.x, L.y); return; } // never into the body that is left
        P.interest(c.x, c.y); P.chase(c, .25);
      }
    },
  },

  // ---- the arena closes; the last rival goes; Victory ----
  {
    id: 'finale', seed: 606, name: 'Juno', skin: 26, preroll: 20, frames: 540, result: { payout: 25, rating: 1412, ratingDelta: 24 },
    setup: (G, P, S) => {
      S.roundAt(553);
      const ar = G.arenaR(); P.data.ar = ar;
      // everyone but one rival and two stragglers caught outside the wall has gone
      for (const p of G.players.slice()) if (p.bot) { for (const c of p.cells) c.dead = true; p.cells = []; p.alive = false; p.respawnAt = 1e9; }
      G.round.n = 47;
      S.hero({ x: -ar * .3, y: ar * .05, mass: 1850, aliveFor: 452, eaten: 31 });
      P.data.rival = S.bot({ x: ar * .55, y: -ar * .1, mass: 600, name: 'nadia', skin: 24, think: .5 });
      const out = (a, m, name, skin) => S.bot({ x: Math.cos(a) * ar * 1.06, y: Math.sin(a) * ar * 1.06, mass: m, name, skin, think: 1e6 });
      P.data.out = [out(Math.PI * .985, 72, 'Kenji'), out(.62, 64, 'tofu', 6)];
      for (const p of P.data.out) { p.respawnAt = 1e9; const c = p.cells[0]; p.target = { x: c.x * 1.02, y: c.y * 1.02 }; }
      P.data.rival.respawnAt = 1e9;
    },
    brain: (G, P, S, dt) => {
      const d = P.data, s = P.me(), r = d.rival;
      if (!P.alive(r)) { if (!d.won) { d.won = 1; P.mark('win'); } P.wander(); return; }
      const c = P.targets([r])[0]; P.interest(c.x, c.y);
      const f = P.front(c.x, c.y);
      // the rival loses its nerve and makes a dash along the wall, past the hero
      if (P.recT > 2.4 && !d.dash) { d.dash = 1; r.ai.t = G.T + 1e6; const a = Math.atan2(c.y, c.x) + 1.9, rr = G.arenaR() * .78; r.target = { x: Math.cos(a) * rr, y: Math.sin(a) * rr }; }
      // press it toward the wall: aim a little inside of it, then straight at it
      if (P.recT < 1.5) P.aimAt(c.x * .85, c.y * .85); else P.chase(c, .35);
      if (P.recT > 2.6 && !d.split && P.canEat(f, c) && P.edgeGap(c) < P.splitGap(f, c) * .62 && P.cellAligned(f, c.x, c.y, 6)) {
        P.tap('split'); d.split = 1; P.mark('final'); P.slowmo({ to: .3, in: .04, hold: .5, out: .5 });
      }
    },
  },
];
