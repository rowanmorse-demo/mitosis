// Win rewards and the AI rating: the rules, then the API against a throwaway server with real relay games. Run:  node rewards.test.js
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const economy = require('./economy'), { WINS, RATING_AI, winBonus, runKind, ratingDelta } = economy;

/* ---------- the rules ---------- */
const won = (kind, place, extra = {}) => winBonus({ kind, survived: 300, place, of: 20, ...extra });
assert.deepEqual([1, 2, 3, 4].map(p => won('comp', p)), [50, 15, 15, 0], 'against players: 50 for a win, 15 for 2nd or 3rd');
assert.deepEqual([1, 2, 3, 4].map(p => won('ai', p)), [25, 5, 5, 0], 'ranked against bots: 25 and 5');
assert.deepEqual([1, 2, 3, 4].map(p => won('casual', p)), [6, 5, 4, 0], 'Casual with no skill given: Normal, 6, 5 and 4');
for (const [skill, want] of [['easy', [3, 2, 2]], ['normal', [6, 5, 4]], ['hard', [9, 7, 6]], ['expert', [12, 10, 8]], ['master', [15, 12, 10]], ['godlike', [6, 5, 4]]])
  assert.deepEqual([1, 2, 3, 4].map(p => won('casual', p, { skill })), [...want, 0], 'Casual on ' + skill + ' bots');
assert.equal(won('ai', 1, { skill: 'easy' }), 25, 'ranked games of bots pay the same whatever the skill');
assert.equal(won('legacy', 1), 0, 'older apps get the placement payout only, as before');
assert.equal(won('comp', 1, { survived: WINS.minSec - 1 }), 0, 'a life shorter than two minutes wins nothing');
assert.equal(won('comp', 1, { survived: WINS.minSec }), 50);
assert.equal(won('ai', 1, { of: WINS.minOf - 1 }), 0, 'a round of fewer than 8 cells wins nothing');
assert.equal(won('casual', 0), 0, 'a quit has no placing');
assert.equal(won('casual', 3, { of: 2 }), 0, 'a placing below the field is nonsense');
assert.equal(won('casual', 1, { place: '1', of: '20' }), 6, 'numbers sent as strings still count');
assert.equal(won('cap', 1), 0, 'only the three kinds pay');

assert.equal(runKind({ mode: null, started: 1 }), 'legacy', 'no mode: an app from before this change');
assert.equal(runKind({ mode: 'casual', started: 1 }, () => true), 'casual', 'Casual stays Casual, met or not');
assert.equal(runKind({ mode: 'bots', started: 1 }, () => true), 'ai', 'a bot game the game says is a bot game');
assert.equal(runKind({ mode: 'arena', started: 1 }), 'ai', 'the arena without the relay\'s word: bots only');
assert.equal(runKind({ mode: 'arena', started: 1 }, () => false), 'ai', 'the arena with nobody else alive in it');
let asked = null; assert.equal(runKind({ mode: 'arena', started: 1234 }, t => { asked = t; return true; }), 'comp', 'the arena beside another player');
assert.equal(asked, 1234, 'the relay is asked about the time since the life started');

assert.equal(ratingDelta(1000, 300, 5, 1, 20, 0, 1), ratingDelta(1000, 300, 5, 1, 20, 0), 'mult 1 is the competitive rating');
assert.equal(ratingDelta(1000, 300, 5, 1, 20, 0, RATING_AI.skill.easy), Math.round((15 + 10 + 8 + 10) * .5), 'Easy bots: half the gain');
assert.equal(ratingDelta(1000, 300, 5, 1, 20, 0, RATING_AI.skill.master), Math.round((15 + 10 + 8 + 10) * 1.5), 'Master bots: half again');
assert.equal(ratingDelta(1000, 0, 0, 0, 0, 0, .5), ratingDelta(1000, 0, 0, 0, 0, 0), 'a quick death loses the same against any bots');

/* ---------- the stores: the AI rating and the win bonuses, old databases, merges ---------- */
async function storeTests() {
  const { SqliteStore, JsonStore } = require('./store'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-wins-'));
  let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
  if (sqlite) { // a database from before the AI rating
    const old = new sqlite.DatabaseSync(path.join(dir, 'm.sqlite'));
    old.exec(`CREATE TABLE players(id TEXT PRIMARY KEY, secret TEXT UNIQUE NOT NULL, created INTEGER, seen INTEGER, balance INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, hour_at INTEGER NOT NULL DEFAULT 0, hour_sum INTEGER NOT NULL DEFAULT 0, rating INTEGER NOT NULL DEFAULT 1000, name TEXT, runs INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE runs(id TEXT PRIMARY KEY, player TEXT, started INTEGER, ended INTEGER, payout INTEGER, xp INTEGER);
      INSERT INTO players(id, secret, created, seen, balance, rating, runs) VALUES('old', 'hold', 1, 1, 70, 1234, 12); INSERT INTO runs(id, player, started, ended, payout) VALUES('r0', 'old', 1, 2, 5);`);
    old.close();
  }
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ players: { old: { id: 'old', secret: 'hold', created: 1, seen: 1, balance: 70, earned: 0, hour_at: 0, hour_sum: 0, rating: 1234, name: null, runs: 12, xp: 0 } }, secrets: { hold: 'old' }, runs: { r0: { id: 'r0', player: 'old', started: 1, ended: 2, payout: 5 } } }));
  for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
    const k = s => kind + ': ' + s, open = () => kind === 'json' ? new JsonStore(path.join(dir, 'm.json')) : new SqliteStore(sqlite, path.join(dir, 'm.sqlite'));
    let st = open();
    const reopen = async () => { if (kind === 'json') await new Promise(res => setTimeout(res, 400)); else st.db.close(); st = open(); };
    const w = economy.handlers.passView(st, {}, st.player('old'));
    assert.deepEqual([w.rating, w.aiRuns, w.runs], [1234, 0, 12], k('a player from before keeps their numbers in the store (the ladder reset is the server start-up\'s job)'));
    assert.equal(w.aiTier, economy.tierOf(w.aiRating), k('the AI tier follows the AI rating'));
    assert.equal(st.bonusSince('old', 0, 'casual'), 0, k('old runs paid no win bonus'));
    st.createPlayer('a', 'ha', 1); st.createPlayer('b', 'hb', 1);
    st.setAiRating('a', 1180, 'Ann'); st.setAiRating('a', 1200, 'Ann'); st.setAiRating('b', 1100, null); st.setRating('b', 1050, 'Bo');
    const t0 = 5e6;
    st.createRun('r1', 'a', t0, 'casual'); st.endRun('r1', t0 + 1, 20, 0, 'casual', 20);
    st.createRun('r2', 'a', t0 + 2, 'bots'); st.endRun('r2', t0 + 3, 30, 10, 'ai', 5);
    st.createRun('r3', 'a', t0 - 10, 'casual'); st.endRun('r3', t0 - 5, 20, 0, 'casual', 20);   // yesterday, say
    st.createRun('r4', 'a', t0 + 4, 'arena'); st.endRun('r4', t0 + 5, 75, 10, 'comp', 50);
    await reopen();
    assert.deepEqual([Number(st.player('a').ai_rating), Number(st.player('a').ai_runs), Number(st.player('a').runs), Number(st.player('a').rating)], [1200, 2, 0, 0], k('the AI rating moves on its own'));
    assert.equal(st.player('a').name, 'Ann', k('an AI life keeps the name too'));
    assert.deepEqual(['casual', 'ai', 'comp'].map(x => st.bonusSince('a', t0, x)), [20, 5, 50], k('win bonuses add up by kind from a time on'));
    const r2 = st.run('r2', 'a'); assert.deepEqual([r2.mode, r2.kind, Number(r2.bonus)], ['bots', 'ai', 5], k('a run keeps its mode, kind and bonus'));
    st.mergePlayers('a', 'b');
    const b = st.player('b'); assert.deepEqual([Number(b.ai_rating), Number(b.ai_runs), Number(b.rating), Number(b.runs)], [1200, 3, 1050, 1], k('a merge keeps the higher AI rating and adds the lives'));
    assert.equal(st.bonusSince('b', t0, 'casual'), 20, k('and the day\'s win bonuses move along, so the cap still holds'));
    if (kind === 'sqlite') st.db.close();
  }
}

/* ---------- the API, with the relay deciding who a life was against ---------- */
const PORT = 3700 + Math.floor(Math.random() * 400);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-rewards-'));
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, MAX_ROOMS: '2' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://127.0.0.1:${PORT}`;
async function waitUp() { // up to 15 s: start-up is slow while the Mac is busy building
  for (let i = 0; i < 150; i++) {
    if (child.exitCode != null) throw new Error('server exited at start-up (port ' + PORT + ' in use?)');
    try { if ((await fetch(base + '/health')).ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
async function post(url, body, secret) {
  const headers = { 'Content-Type': 'application/json' }; if (secret) headers.Authorization = 'Bearer ' + secret;
  const r = await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json() };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// a game on the relay: its key, and presence as the game sends it (a: alive in the arena)
const game = () => new Promise((res, rej) => { const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello' })); ws.onerror = rej;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'welcome') res({ ws, key: m.key, alive: a => ws.send(JSON.stringify({ t: 'p', p: { v: 6, a: a ? 1 : 0, q: 0 } })) }); }; });

(async () => {
  await storeTests();
  await waitUp();
  const store = (await (await fetch(base + '/health')).json()).store;
  const db = store === 'sqlite' ? new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'mitosis.sqlite')) : null;
  // a life backdated in the database, as if `sec` seconds had passed on the server
  const life = async (secret, sec, start, end = {}) => { const id = (await post('/api/run/start', start, secret)).body.runId;
    if (db && sec) db.prepare('UPDATE runs SET started = started - ? WHERE id = ?').run(sec * 1000, id);
    return { id, r: await post('/api/run/end', { runId: id, survived: sec, eaten: 3, peak: 400, bestRank: 999, life: 0, name: 'Winner', ...end }, secret) }; };

  const s1 = 'winsecret' + 'a'.repeat(24);
  let r = await post('/api/session', { secret: s1 });
  assert.deepEqual([r.body.rating, r.body.rank, r.body.aiRating, r.body.aiTier, r.body.aiRank, r.body.aiRuns], [0, 'Amoeba I', 0, 'Bronze', 'Amoeba I', 0], 'a new player starts at the bottom of both ladders');
  assert.deepEqual(r.body.catalog.wins, WINS, 'the catalogue carries the win rules'); assert.deepEqual(r.body.catalog.ratingAi, RATING_AI);

  if (!db) console.log('(JSON store: skipping the backdated lives)');
  else {
    // an app from before this: no mode, rated on the competitive rating and paid by placement, as always
    let { r } = await life(s1, 300, {}, { place: 1, of: 20 });
    assert.deepEqual([r.body.kind, r.body.payout, r.body.winBonus, r.body.aiDelta, r.body.aiRating], ['legacy', 25, 0, 0, 0], 'an older app: 25 for the win, no bonus, the AI rating untouched');
    assert.ok(r.body.ratingDelta > 0 && r.body.rating === r.body.ratingDelta, 'and its rating moves as before');
    for (const k of ['payout', 'ratingDelta', 'balance', 'earned', 'skins', 'rating', 'tier', 'runs', 'playerId', 'xpGained']) assert.ok(k in r.body, 'run/end still sends ' + k);
    const comp0 = r.body.rating, runs0 = r.body.runs;

    // Casual: a win pays 20, earns no XP, and moves only the AI rating
    ({ r } = await life(s1, 300, { mode: 'casual' }, { place: 1, of: 20, skill: 'normal' }));
    assert.deepEqual([r.body.kind, r.body.payout, r.body.winBonus, r.body.winCapped, r.body.xpGained], ['casual', 6, 6, false, 0], 'a Casual win on Normal bots pays 6 ATP and no XP');
    assert.deepEqual([r.body.ratingDelta, r.body.rating, r.body.runs], [0, comp0, runs0], 'bots never move the competitive rating');
    assert.ok(r.body.aiDelta > 0, 'the AI rating rises'); assert.deepEqual([r.body.aiRating, r.body.aiRuns], [r.body.aiDelta, 1]);
    const easy = (await life(s1, 300, { mode: 'casual' }, { place: 1, of: 20, skill: 'easy' })).r.body.aiDelta;
    assert.ok(easy > 0 && easy < r.body.aiDelta, 'Easy bots raise it less');
    ({ r } = await life(s1, 300, { mode: 'casual' }, { place: 2, of: 20 })); assert.equal(r.body.payout, 5, 'Casual 2nd: 5 ATP and nothing for the placing itself');
    ({ r } = await life(s1, 300, { mode: 'casual' }, { place: 9, of: 20 })); assert.equal(r.body.payout, 0, 'Casual 9th: nothing');
    ({ r } = await life(s1, 60, { mode: 'casual' }, { place: 1, of: 20 })); assert.deepEqual([r.body.payout, r.body.winBonus], [0, 0], 'a win in a one-minute life pays nothing');
    ({ r } = await life(s1, 300, { mode: 'casual' }, { place: 0, of: 0 })); assert.equal(r.body.payout, 0, 'a quit pays nothing');
    ({ r } = await life(s1, 0, { mode: 'casual' }, { survived: 9999, place: 1, of: 20 })); assert.deepEqual([r.body.payout, r.body.winBonus], [0, 0], 'claiming a long life right after starting it pays nothing');
    ({ r } = await life(s1, 0, { mode: 'casual' }, { survived: 4, eaten: 0, place: 0, of: 0 })); assert.ok(r.body.aiDelta < 0, 'a quick death lowers the AI rating');

    // ranked against bots (nobody found, or ping over Max ping): the placement payout as before, plus 25 for the win
    ({ r } = await life(s1, 300, { mode: 'bots', skill: 'master' }, { place: 1, of: 20 }));
    assert.deepEqual([r.body.kind, r.body.payout, r.body.winBonus, r.body.ratingDelta, r.body.rating], ['ai', 50, 25, 0, comp0], 'a ranked bot win: 25 + 25 ATP, competitive rating untouched');
    assert.ok(r.body.xpGained > 0, 'ranked bot games still earn XP');
    assert.equal(r.body.aiDelta, ratingDelta(r.body.aiRating - r.body.aiDelta, 300, 3, 1, 20, 0, RATING_AI.skill.master), 'ranked games of bots have Master bots: Master gains');
    assert.equal(r.body.skill, 'master');
    // the skill given at run/start is the one paid; a claim at run/end can't raise it (older apps send it only then)
    ({ r } = await life(s1, 300, { mode: 'casual', skill: 'easy' }, { place: 1, of: 20, skill: 'master' }));
    assert.deepEqual([r.body.skill, r.body.payout], ['easy', 3], 'started on Easy, paid as Easy');
    ({ r } = await life(s1, 300, { mode: 'casual' }, { place: 1, of: 20, skill: 'hard' }));
    assert.deepEqual([r.body.skill, r.body.payout], ['hard', 9], 'build 12 sends the skill at the end: Hard pays 9');
    ({ r } = await life(s1, 300, { mode: 'casual', skill: 'master' }, { place: 2, of: 20 })); assert.equal(r.body.payout, 12, 'Master 2nd: 12');
    ({ r } = await life(s1, 300, { mode: 'casual', skill: 'master' }, { place: 3, of: 20 })); assert.equal(r.body.payout, 10, 'Master 3rd: 10');

    // the arena: the game's word is not enough, the relay must have seen another player alive in the room
    ({ r } = await life(s1, 300, { mode: 'arena' }, { place: 1, of: 20 }));
    assert.deepEqual([r.body.kind, r.body.ratingDelta, r.body.winBonus], ['ai', 0, 25], 'the arena without a relay key: rated against bots');
    const A = await game(), B = await game(), C = await game();
    assert.match(A.key, /^[0-9a-f]{24}$/, 'each game gets a secret key in its welcome'); assert.notEqual(A.key, B.key);
    ({ r } = await life(s1, 300, { mode: 'arena', relay: 'f'.repeat(24) }, { place: 1, of: 20, relay: 'e'.repeat(24) }));
    assert.equal(r.body.kind, 'ai', 'a made-up key counts for nothing');
    // alone alive in the arena, the others in the menus
    let id = (await post('/api/run/start', { mode: 'arena', relay: A.key }, s1)).body.runId; db.prepare('UPDATE runs SET started = started - 300000 WHERE id = ?').run(id);
    A.alive(true); B.alive(false); C.alive(false); await sleep(700); A.alive(true); await sleep(200);
    r = await post('/api/run/end', { runId: id, survived: 300, place: 1, of: 20, relay: A.key }, s1);
    assert.deepEqual([r.body.kind, r.body.ratingDelta], ['ai', 0], 'alone alive in the arena (the others in the menus): against bots');
    // another player alive in the same room: competitive, and the win pays 25 + 50
    id = (await post('/api/run/start', { mode: 'arena', relay: A.key }, s1)).body.runId; db.prepare('UPDATE runs SET started = started - 300000 WHERE id = ?').run(id);
    await sleep(600); B.alive(true); await sleep(100); A.alive(true); await sleep(200);
    r = await post('/api/run/end', { runId: id, survived: 300, place: 1, of: 20, life: 0 }, s1);
    assert.deepEqual([r.body.kind, r.body.payout, r.body.winBonus, r.body.aiDelta], ['comp', 75, 50, 0], 'beside another player: a competitive win pays 75 ATP');
    assert.ok(r.body.ratingDelta > 0 && r.body.rating === comp0 + r.body.ratingDelta, 'and moves the competitive rating');
    const dup = await post('/api/run/end', { runId: id, survived: 300, place: 1, of: 20 }, s1);
    assert.deepEqual([dup.body.duplicate, dup.body.payout, dup.body.winBonus, dup.body.kind, dup.body.balance], [true, 75, 50, 'comp', r.body.balance], 'ending it twice pays once');
    // meeting someone before the life started does not count
    A.alive(true); B.alive(true); await sleep(600); A.alive(true); B.alive(false); await sleep(100);
    id = (await post('/api/run/start', { mode: 'arena', relay: A.key }, s1)).body.runId; await sleep(20); A.alive(true); await sleep(600); A.alive(true); await sleep(100);
    r = await post('/api/run/end', { runId: id, survived: 5, relay: A.key }, s1);
    assert.equal(r.body.kind, 'ai', 'a player met before the life started is not this life\'s opponent');
    // the game a life started in still counts after it disconnects (the app was closed, or the connection dropped and came back)
    id = (await post('/api/run/start', { mode: 'arena', relay: C.key }, s1)).body.runId; await sleep(20);
    C.alive(true); B.alive(true); await sleep(600); C.alive(true); await sleep(100); C.ws.close(); await sleep(200);
    r = await post('/api/run/end', { runId: id, survived: 5 }, s1); assert.equal(r.body.kind, 'comp', 'met another player, then lost the connection: still competitive');
    const D = await game(); id = (await post('/api/run/start', { mode: 'arena' }, s1)).body.runId; await sleep(20); // no key at the start: it came back only later
    D.alive(true); B.alive(true); await sleep(600); D.alive(true); await sleep(100);
    r = await post('/api/run/end', { runId: id, survived: 5, relay: D.key }, s1); assert.equal(r.body.kind, 'comp', 'run/end\'s key covers a game that reconnected mid-life');
    A.ws.close(); B.ws.close(); D.ws.close();

    // the competitive leaderboard is for the competitive rating: a player who only played bots is not on it
    const s2 = 'botsonly' + 'b'.repeat(24); await post('/api/session', { secret: s2 });
    for (let i = 0; i < 10; i++) ({ r } = await life(s2, 200, { mode: i % 2 ? 'casual' : 'bots', skill: 'master' }, { place: 1, of: 12, name: 'Botter' }));
    const lb = await (await fetch(base + '/api/leaderboard')).json();
    assert.ok(lb.top.some(t => t.name === 'Winner') && !lb.top.some(t => t.name === 'Botter'), 'the leaderboard lists competitive players only');
    r = await post('/api/session', { secret: s2 }); assert.deepEqual([r.body.runs, r.body.rating], [0, 0], 'ten bot wins: no competitive lives, the rating where it started');
    assert.ok(r.body.aiRating > 300, 'the AI rating climbed'); assert.equal(r.body.aiRuns, 10);
    // no daily cap (Rowan, Nov 9): ten bot wins (ranked 25 and Casual-on-Master 15 in turn) make 200, and more keep paying in full
    const paid = db.prepare("SELECT COALESCE(SUM(bonus), 0) AS n FROM runs WHERE player = (SELECT id FROM players WHERE secret = ?) AND kind IN ('ai', 'casual')").get(require('crypto').createHash('sha256').update(s2).digest('hex')).n;
    assert.equal(Number(paid), 200, 'ten bot wins paid their whole bonus');
    ({ r } = await life(s2, 200, { mode: 'bots' }, { place: 1, of: 12 }));
    assert.deepEqual([r.body.payout, r.body.winBonus, r.body.winCapped], [50, 25, false], 'the eleventh ranked bot win still pays its bonus');
    ({ r } = await life(s2, 200, { mode: 'casual', skill: 'master' }, { place: 1, of: 12 })); assert.deepEqual([r.body.payout, r.body.winCapped], [15, false], 'and so does a Casual win on Master');
    // wins against players are uncapped too
    const E = await game(), F = await game();
    id = (await post('/api/run/start', { mode: 'arena', relay: E.key }, s2)).body.runId; db.prepare('UPDATE runs SET started = started - 200000 WHERE id = ?').run(id);
    E.alive(true); F.alive(true); await sleep(600); E.alive(true); await sleep(100);
    r = await post('/api/run/end', { runId: id, survived: 200, place: 1, of: 12 }, s2); assert.deepEqual([r.body.kind, r.body.winBonus], ['comp', 50], 'a win against players pays its bonus');
    for (let i = 0; i < 7; i++) { id = (await post('/api/run/start', { mode: 'arena', relay: E.key }, s2)).body.runId; db.prepare('UPDATE runs SET started = started - 200000 WHERE id = ?').run(id);
      await sleep(550); E.alive(true); F.alive(true); await sleep(80); E.alive(true); r = await post('/api/run/end', { runId: id, survived: 200, place: 1, of: 12 }, s2); }
    assert.deepEqual([r.body.winBonus, r.body.winCapped], [50, false], 'eight competitive wins: 400 ATP');
    id = (await post('/api/run/start', { mode: 'arena', relay: E.key }, s2)).body.runId; db.prepare('UPDATE runs SET started = started - 200000 WHERE id = ?').run(id);
    await sleep(550); E.alive(true); F.alive(true); await sleep(80); E.alive(true);
    r = await post('/api/run/end', { runId: id, survived: 200, place: 1, of: 12 }, s2); assert.deepEqual([r.body.kind, r.body.payout, r.body.winBonus, r.body.winCapped], ['comp', 75, 50, false], 'the ninth pays in full: no daily cap');
    E.ws.close(); F.ws.close();
    db.close();
  }
  console.log(`all win reward and AI rating tests passed (${store} store)`);
})().then(() => { child.kill(); process.exit(0); }).catch(e => { console.error(e); child.kill(); process.exit(1); });
