// The pilot: plays the human cell the way a thumb does, through the game's own touch controls.
// This file is evaluated inside the game page (see capture.js). It defines window.__promo with:
//   G  a live handle on the game's state and functions (through the capture-only __mt.x eval hook)
//   S  staging helpers for setting a moment up (place cells, rename bots, wind the round clock, start events)
//   P  the player: a left thumb on the joystick and a right thumb on Split / Shoot / Boost
// Input is real: PointerEvents dispatched on #joy and the action buttons, so the game's own handlers move the knob,
// light the buttons and steer the cells. The thumb model adds what a person's thumb does and a bot's doesn't:
// a 150–300 ms reaction delay, a spring with a little overshoot, corner-cutting on fast turns, tremor and drift,
// an aiming error that gets corrected, and the occasional lift and re-plant of the thumb.
(function () {
  'use strict';
  const G = window.__mt.x(`({
    get players(){return players}, get cells(){return cells}, get human(){return human}, get viruses(){return viruses},
    get vslots(){return vslots}, get hunters(){return hunters}, get ev(){return ev}, get T(){return T},
    get round(){return round}, set round(v){round=v}, get cam(){return cam}, get W(){return W}, get H(){return H},
    get mode(){return mode}, get leader(){return leader}, get settings(){return settings}, get wallet(){return wallet},
    get slow(){return slow}, set slow(v){slow=v}, get local(){return local}, set local(v){local=v},
    get evNext(){return evNext}, set evNext(v){evNext=v}, get hunterT(){return hunterT}, set hunterT(v){hunterT=v},
    get feed(){return feed}, get powerups(){return powerups}, get joy(){return joy}, get paused(){return paused}, get freeV(){return freeV},
    R, PREMIUM, SKIN_FREE, BOSS_BID, EVT, PERS, PBIT, MAX_CELLS, VIRUS_M, NAMES,
    addCell, spawn, makePlayer, removePlayer, startEvent, endEvent, spawnLeviathan, startLocal, startGame,
    split, eject, dash, radius, speedOf, need, botName, botColor, skinColor, arenaR, safeR, roundT,
    syncBots, pushFeed, toast, showEarn, showRank, renderFeed, hud, rebuildViruses, setVM, kick, bestFood, mdel,
    ex(s){return eval(s)}
  })`);

  // ---------- small maths ----------
  let rs = 0x9e3779b9; // the pilot's own random stream, so its jitter never shifts the game's
  const rnd = () => { rs = (rs + 0x6D2B79F5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rr = (a, b) => a + rnd() * (b - a);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const hyp = Math.hypot, TAU = Math.PI * 2;
  // smooth noise: a few incommensurate sines per channel
  const mkNoise = (f0, f1, n = 4) => { const p = []; for (let i = 0; i < n; i++) p.push([rr(f0, f1) * TAU, rnd() * TAU, rr(.5, 1)]); const s = p.reduce((a, q) => a + q[2], 0); return t => p.reduce((a, [w, ph, k]) => a + k * Math.sin(w * t + ph), 0) / s; };

  // ---------- the world, as the player sees it ----------
  const massOf = p => p.cells.reduce((s, c) => s + (c.dead ? 0 : c.mass), 0);
  function me() {
    const h = G.human; if (!h || !h.alive) return null; let sx = 0, sy = 0, sm = 0, big = null, r2 = 0;
    for (const c of h.cells) { if (c.dead) continue; sx += c.x * c.mass; sy += c.y * c.mass; sm += c.mass; r2 += c.r * c.r; if (!big || c.mass > big.mass) big = c; }
    if (!sm) return null; return { x: sx / sm, y: sy / sm, m: sm, n: h.cells.filter(c => !c.dead).length, big, r: Math.sqrt(r2) };
  }
  const scr = (x, y) => ({ x: (x - G.cam.x) * G.cam.z + G.W / 2, y: (y - G.cam.y) * G.cam.z + G.H / 2 });

  // ---------- input plumbing ----------
  const $ = id => document.getElementById(id);
  const PID_L = 31, PID_R = 32;
  function pev(el, type, id, x, y) {
    el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === PID_L, clientX: x, clientY: y, screenX: x, screenY: y,
      bubbles: true, cancelable: true, composed: true, pressure: type === 'pointerup' ? 0 : .5, width: 34, height: 34, buttons: type === 'pointerup' ? 0 : 1 }));
  }
  const center = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; };
  const BTN = { split: 'splitBtn', shoot: 'ejectBtn', boost: 'dashBtn' };

  // ---------- the left thumb ----------
  const L = {
    down: false, a: 0, av: 0, r: 0, rv: 0, err: 0, lastA: null, delay: .22, hist: [],
    tremX: mkNoise(6, 11), tremY: mkNoise(6, 11), driftX: mkNoise(.15, .5), driftY: mkNoise(.15, .5), push: mkNoise(.08, .25), wob: mkNoise(.2, .7),
    x: 0, y: 0, nextLift: 0,
  };
  let intent = null; // what the brain wants this frame: {a, m} or null (thumb off the stick)
  function leftThumb(t, dt) {
    L.hist.push({ t, v: intent ? { a: intent.a, m: intent.m } : null });
    while (L.hist.length > 2 && L.hist[1].t <= t - L.delay) L.hist.shift();
    const want = L.hist[0].v; // what the brain wanted one reaction time ago
    const el = $('joy'), c = center(el);
    if (!want) {
      if (L.down) { L.down = false; pev(el, 'pointerup', PID_L, c.x + L.x, c.y + L.y); }
      L.r *= Math.exp(-dt * 18); L.rv = 0; return;
    }
    // a new heading (a real turn): a fresh reaction time for what comes next, and an aiming error to correct
    if (L.lastA === null || Math.abs(wrap(want.a - L.lastA)) > .5) { L.delay = rr(.15, .3); L.err = gauss() * .13 + (rnd() < .2 ? (rnd() < .5 ? -1 : 1) * rr(.12, .22) : 0); }
    L.lastA = want.a;
    L.err *= Math.exp(-dt / rr(.35, .55));
    const ta = want.a + L.err + L.wob(t) * .05;
    let tr = clamp(want.m, 0, 1.3) * (52 + 7 * L.push(t));
    if (!L.down) { // thumb lands on the stick: roughly where it means to go
      L.a = ta + gauss() * .12; L.r = tr * rr(.75, .95); L.av = 0; L.rv = 0; L.down = true;
      const x = Math.cos(L.a) * L.r, y = Math.sin(L.a) * L.r; L.x = x; L.y = y; pev(el, 'pointerdown', PID_L, c.x + x, c.y + y); return;
    }
    // angle: an underdamped spring (a little overshoot, then settles); radius: firmer, and it dips on fast swings
    const wa = TAU * 2.3, za = .58, d = wrap(ta - L.a);
    L.av += (wa * wa * d - 2 * za * wa * L.av) * dt; L.av = clamp(L.av, -26, 26); L.a = wrap(L.a + L.av * dt);
    tr *= 1 - .38 * Math.min(1, Math.abs(L.av) / 18);
    const wr = TAU * 3.4, zr = .72; L.rv += (wr * wr * (tr - L.r) - 2 * zr * wr * L.rv) * dt; L.r = Math.max(0, L.r + L.rv * dt);
    const x = Math.cos(L.a) * L.r + L.tremX(t) * 1.1 + L.driftX(t) * 3.4, y = Math.sin(L.a) * L.r + L.tremY(t) * 1.1 + L.driftY(t) * 3.4;
    L.x = x; L.y = y; pev(el, 'pointermove', PID_L, c.x + x, c.y + y);
  }

  // ---------- the right thumb ----------
  const R = { q: [], freeAt: 0, lastBtn: null, down: null, pos: { x: 0, y: 0 } };
  function rightThumb(t) {
    while (R.q.length && R.q[0].at <= t) {
      const e = R.q.shift(), el = $(BTN[e.btn]);
      if (e.type === 'down') { const c = center(el); R.pos = { x: c.x + gauss() * c.w * .1, y: c.y + gauss() * c.w * .1 }; R.down = e.btn; pev(el, 'pointerdown', PID_R, R.pos.x, R.pos.y); }
      else { pev(el, 'pointerup', PID_R, R.pos.x, R.pos.y); R.down = null; }
    }
  }
  function press(btn, hold, t) { // the thumb has to travel between buttons
    const at = Math.max(t, R.freeAt + (R.lastBtn && R.lastBtn !== btn ? rr(.13, .2) : rr(.05, .09)));
    R.q.push({ at, type: 'down', btn }, { at: at + hold, type: 'up', btn }); R.q.sort((a, b) => a.at - b.at);
    R.freeAt = at + hold; R.lastBtn = btn; return at;
  }

  // ---------- speed (slow motion is a smaller virtual step, so everything slows together) ----------
  let speedKeys = null; // {t0, to, inT, hold, outT}
  function speedAt(wall) {
    if (!speedKeys) return 1; const k = speedKeys, u = wall - k.t0, ease = x => x * x * (3 - 2 * x);
    if (u < 0) return 1; if (u < k.inT) return 1 + (k.to - 1) * ease(u / k.inT);
    if (u < k.inT + k.hold) return k.to; if (u < k.inT + k.hold + k.outT) return k.to + (1 - k.to) * ease((u - k.inT - k.hold) / k.outT);
    speedKeys = null; return 1;
  }

  // ---------- P: the player API the takes use ----------
  let t = 0, wall = 0, frameNo = 0, speed = 1, interest = null, recT0 = null;
  const timers = [], marks = [];
  const P = {
    get t() { return t; }, get frame() { return frameNo; }, rnd, rr, gauss, wrap, clamp, hyp, me, massOf, scr,
    get recT() { return recT0 == null ? -1 : t - recT0; }, // time since the recording started (-1 during the preroll)
    phase: 'start', phaseT: 0, data: {},
    go(ph) { this.phase = ph; this.phaseT = 0; },
    steer(a, m = 1) { intent = { a, m }; },
    aimAt(x, y, m = 1) { const s = me(); if (s) intent = { a: Math.atan2(y - s.y, x - s.x), m }; },
    chase(c, lead = .3, m = 1) { if (!c) return; this.aimAt(c.x + (c.svx || 0) * lead, c.y + (c.svy || 0) * lead, m); },
    away(x, y, bias = 0, m = 1) { const s = me(); if (s) intent = { a: Math.atan2(s.y - y, s.x - x) + bias, m }; },
    lift() { intent = null; },
    get intent() { return intent; },
    tap(btn, hold) { return press(btn, hold == null ? rr(.06, .11) : hold, t); },
    hold(btn, sec) { return press(btn, sec, t); },
    get thumbFree() { return t >= R.freeAt; },
    after(sec, fn) { timers.push({ at: t + sec, fn }); },
    mark(name) { marks.push({ name, f: frameNo, t }); },
    // a game sound the game itself only plays for your own cells (a giant bursting on a phage): logged for the mix
    sfx(kind, amt = 0) { sfxLog.push({ f: frameNo, k: kind, a: amt, extra: 1 }); },
    slowmo(o) { speedKeys = { t0: wall, to: o.to == null ? .3 : o.to, inT: o.in == null ? .08 : o.in, hold: o.hold == null ? .5 : o.hold, outT: o.out == null ? .25 : o.out }; },
    interest(x, y) { interest = x == null ? null : { x, y }; },
    // the actual heading the cells are steering along (from the stick, not from the brain's wish)
    heading() { const h = G.human, s = me(); if (!h || !s) return 0; return Math.atan2(h.target.y - s.y, h.target.x - s.x); },
    aligned(x, y, tolDeg = 7, from) { const s = from || me(); if (!s) return false; const a = Math.atan2(y - s.y, x - s.x), h = G.human, b = Math.atan2(h.target.y - s.y, h.target.x - s.x); return Math.abs(wrap(a - b)) < tolDeg * Math.PI / 180; },
    // splits fly from each cell toward the target point: aligned for the cell that matters
    cellAligned(cell, x, y, tolDeg = 7) { const h = G.human, a = Math.atan2(y - cell.y, x - cell.x), b = Math.atan2(h.target.y - cell.y, h.target.x - cell.x); return Math.abs(wrap(a - b)) < tolDeg * Math.PI / 180; },
    // a calm player farming: curves toward the richest food nearby, re-deciding now and then
    wander() {
      const s = me(); if (!s) return; const d = this.data;
      if (!d.wT || t > d.wT) { const f = G.bestFood(s.big); d.wA = f ? Math.atan2(f.y - s.y, f.x - s.x) : (d.wA || 0) + rr(-1, 1); d.wT = t + rr(.6, 1.4); }
      const edge = G.safeR() - hyp(s.x, s.y) - s.r; let a = d.wA;
      if (edge < 500) a = Math.atan2(-s.y, -s.x) + rr(-.4, .4);
      intent = { a, m: rr(.85, 1) };
    },
    nearestBot(filter = () => true) { const s = me(); let b = null, bd = 1e18; for (const p of G.players) { if (p === G.human || !p.alive || !filter(p)) continue; for (const c of p.cells) { if (c.dead) continue; const d = hyp(c.x - s.x, c.y - s.y); if (d < bd) { bd = d; b = c; } } } return b; },
    edgeGap(c) { const s = me(); if (!s) return 1e9; let g = 1e9; for (const k of G.human.cells) if (!k.dead) g = Math.min(g, hyp(c.x - k.x, c.y - k.y) - c.r - k.r); return g; },
    // the hero's cell nearest a point (the one whose split will reach it)
    front(x, y) { let b = null, bd = 1e18; for (const k of G.human.cells) { if (k.dead) continue; const d = hyp(k.x - x, k.y - y); if (d < bd) { bd = d; b = k; } } return b; },
    // living cells of the given players, nearest (by edge gap) first
    targets(players) { const out = []; for (const p of players) { if (!p.alive) continue; for (const c of p.cells) if (!c.dead) out.push(c); } return out.sort((a, b) => this.edgeGap(a) - this.edgeGap(b)); },
    alive(p) { return p && p.alive && p.cells.some(c => !c.dead); },
    // how far (edge to edge) a split from cell f can reach and still swallow c, if c stood still: the half starts
    // 0.4 r ahead and slides about 720 units, and eats once it covers 60% of c's diameter
    splitGap(f, c) { const rh = G.radius(f.mass / 2); return .4 * f.r + 719 + rh + .4 * c.r - f.r - c.r; },
    canEat(f, c, half = true) { return (half ? f.mass / 2 : f.mass) > c.mass * 1.12; },
  };

  // ---------- S: staging ----------
  const HUMAN_NAMES = ['jules', 'Mateo', 'nova', 'Lukas', 'pixelpanda', 'Aiyana', 'zoe.', 'Ravi', 'Ines', 'bubbletea', 'Theo', 'mika', 'Sora', 'leo_92', 'Ana', 'Yuki', 'frankie', 'Nadia', 'ollie', 'cellmate', 'Priya', 'Jonas', 'lil amoeba', 'Marta', 'Kenji', 'dani', 'Hugo', 'Camila', 'sam', 'Emre', 'tofu', 'Freya', 'mo', 'Noah', 'kiki', 'Elif', 'quinn', 'Rafa', 'zara', 'Oskar', 'mochi', 'Lena', 'Diego', 'ash', 'Maya', 'Finn', 'ivy', 'Tomás', 'Hana', 'blob', 'Arjun', 'Chloe', 'wren', 'Malik', 'Sofi', 'gus', 'Amara', 'Nico', 'pip', 'Isla', 'Kai', 'June', 'Vik', 'Lou', 'Remy', 'Bea', 'olive', 'Zain', 'Cleo', 'Milo'];
  const PREMIUM_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
  const S = {
    names: HUMAN_NAMES,
    // every microbe gets a person's name and a look: about a third wear a premium skin, Halloween ones included
    dressN: 0,
    dressBots(seed) {
      if (seed != null) S.dressN = seed;
      for (const p of G.players) {
        if (!p.bot || p.boss || p._dressed) continue; p._dressed = true; const k = S.dressN++;
        p.name = HUMAN_NAMES[(k * 7 + 3) % HUMAN_NAMES.length];
        const roll = ((k * 2654435761) >>> 0) % 100;
        if (roll < 36) { const sk = PREMIUM_IDS[(k * 5 + 1) % PREMIUM_IDS.length]; S.skin(p, sk); }
        else if (roll < 70) { p.skin = 1 + (k % 4); p.stain = k % 6; }
      }
    },
    skin(p, id, stain = 0) { p.skin = id; p.stain = stain; p.color = G.skinColor(stain, id); },
    // put a player's cells in one place: one cell of the given mass (or several, given as [{dx,dy,m}])
    place(p, x, y, mass, parts) {
      for (const c of p.cells) c.dead = true; p.cells = [];
      const list = parts || [{ dx: 0, dy: 0, m: mass }];
      for (const q of list) { const c = G.addCell(p, x + (q.dx || 0), y + (q.dy || 0), q.m); c.dr = c.r; c.mergeAt = q.merge ? G.T + q.merge : 0; }
      p.alive = true; p.target = { x, y }; p.fx.shield = 0; p.stats.peak = Math.max(p.stats.peak, mass || 0); return p.cells[0];
    },
    // the hero mid-run: mutations already taken for its size (so none pops up mid-shot), camera on it
    hero({ x, y, mass, parts, perks = ['flagella', 'enzymes', 'cilia', 'vacuole', 'membrane', 'mitotic'], aliveFor = 140, eaten = 9 }) {
      const h = G.human; S.place(h, x, y, mass, parts); const m = massOf(h); h.stats.peak = Math.max(h.stats.peak, m);
      const EVO = [80, 200, 450, 900, 1600, 2800]; h.evo = EVO.filter(v => v <= m).length; h.pk = 0;
      for (const id of perks.slice(0, h.evo)) h.pk |= G.PBIT[id];
      h.stats.born = G.T - aliveFor; h.stats.eaten = eaten; h.hist = [25, 60, 140, 260, m * .6, m * .8, m];
      // camera already where the game would have it (no zoom settling in the first frames)
      let r2 = 0; for (const c of h.cells) r2 += c.r * c.r;
      G.cam.x = x; G.cam.y = y; G.cam.z = clamp(Math.sqrt(G.W * G.H) / 1100, .45, 1.6) * Math.pow(Math.min(1, 55 / Math.sqrt(r2)), .5); return h;
    },
    // a bot from the pool (the one farthest from x,y, so nothing on screen pops), placed and dressed
    bot({ x, y, mass, name, skin, stain = 0, pers, aggr, think, parts, color }) {
      let best = null, bd = -1;
      for (const p of G.players) { if (!p.bot || p.boss || p._staged || p === G.human) continue; const c = p.cells[0]; const d = c ? hyp(c.x - x, c.y - y) : 1e9; if (d > bd) { bd = d; best = p; } }
      const p = best; p._staged = true; S.place(p, x, y, mass, parts);
      if (name) p.name = name; if (skin != null) S.skin(p, skin, stain); if (color) p.color = color;
      if (pers) p.ai.pers = G.PERS[pers]; if (aggr != null) p.ai.aggr = aggr; if (think != null) p.ai.t = G.T + think;
      p.pk = 0; p.evo = 6; return p;
    },
    // move everything except the given players out of a disc (keeps the shot readable)
    clear(x, y, rad, keep = []) {
      for (const p of G.players) {
        if (p === G.human || keep.includes(p) || p.boss) continue;
        for (const c of p.cells) { if (c.dead) continue; if (hyp(c.x - x, c.y - y) < rad + c.r) { const a = rnd() * TAU, d = rad + 600 + rnd() * 1500; let nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d; const l = hyp(nx, ny), lim = G.safeR() - 300; if (l > lim) { nx *= lim / l; ny *= lim / l; } c.x = c.px = nx; c.y = c.py = ny; } }
      }
      for (const v of G.viruses) if (hyp(v.x - x, v.y - y) < rad * .6) { const a = rnd() * TAU, d = rad + 400; v.x = v.tx = x + Math.cos(a) * d; v.y = v.ty = y + Math.sin(a) * d; }
      for (const u of G.powerups) if (hyp(u.x - x, u.y - y) < rad) u.dead = true;
    },
    virusNear(x, y) { let b = null, bd = 1e18; for (const v of G.vslots) { if (!v.alive) continue; const d = hyp(v.x - x, v.y - y); if (d < bd) { bd = d; b = v; } } return b; },
    moveVirus(v, x, y) { v.x = v.tx = x; v.y = v.ty = y; v.feed = 0; G.setVM(v); G.rebuildViruses(); return v; },
    roundAt(sec) { G.round.start = G.T - sec; },
    calm() { G.evNext = G.T + 1e6; G.hunterT = 1e6; for (const h of G.hunters) h.dead = true; },
    freeze(p, sec) { p.ai.t = G.T + sec; p.target = { x: p.cells[0].x, y: p.cells[0].y }; },
    clearToasts() { const b = $('toasts'); if (b) b.innerHTML = ''; const tip = $('tip'); if (tip) tip.classList.remove('show'); },
    clearFeed() { G.feed.length = 0; G.renderFeed(); },
  };

  // ---------- the frame loop (called by capture.js once per output frame) ----------
  let take = null;
  const sfxLog = [];
  window.__sfxLog = (k, a) => { sfxLog.push({ f: frameNo, k, a: +a || 0 }); };
  G.ex('sfx=(function(o){return function(k,a){try{window.__sfxLog&&window.__sfxLog(k,a)}catch(e){}return o.apply(this,arguments)}})(sfx)');

  window.__promo = {
    G, P, S,
    setTake(tk) { take = tk; },
    async frame(record) {
      if (record && recT0 == null) recT0 = t;
      const sp = speedAt(wall); speed = sp; const dt = sp / 60;
      t += dt; wall += 1 / 60; P.phaseT += dt;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= t) { const fn = timers[i].fn; timers.splice(i, 1); try { fn(); } catch (e) { console.error(e); } }
      if (frameNo % 30 === 0) S.dressBots(); // microbes that joined since get a name and a look too
      if (take && take.brain && G.human && G.human.alive && G.mode === 'play') { try { take.brain(G, P, S, dt); } catch (e) { console.error('brain', e && e.stack || e); } }
      leftThumb(t, dt); rightThumb(t);
      await window.__vt.step(1000 / 60 * sp);
      frameNo++;
      const s = me(), hs = s ? scr(s.x, s.y) : { x: G.W / 2, y: G.H / 2 }, is = interest ? scr(interest.x, interest.y) : null;
      return { f: frameNo - 1, sp: +sp.toFixed(4), hx: +hs.x.toFixed(1), hy: +hs.y.toFixed(1), ix: is ? +is.x.toFixed(1) : null, iy: is ? +is.y.toFixed(1) : null, z: +G.cam.z.toFixed(4), m: s ? Math.round(s.m) : 0, n: s ? s.n : 0, mode: G.mode };
    },
    sfx: () => sfxLog, marks: () => marks,
    resetLog() { sfxLog.length = 0; marks.length = 0; frameNo = 0; },
  };
})();
