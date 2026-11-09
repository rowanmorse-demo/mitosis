// Extra lives for ATP (economy.js EXTRA_LIFE, buyLife): 10 ATP doubling to 1,280, 8 a game at most, short ATP, double taps, and
// runs that are wrong or over. Both stores, then through the server. Run:  node extralife.test.js
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert'), crypto = require('crypto');
const economy = require('./economy'), { EXTRA_LIFE, lifePrice } = economy, buyLife = economy.handlers.buyLife;
const { SqliteStore, JsonStore } = require('./store');

/* ---------- the rules ---------- */
assert.deepEqual([EXTRA_LIFE.base, EXTRA_LIFE.factor, EXTRA_LIFE.max, EXTRA_LIFE.window], [10, 2, 8, 5], 'Rowan: 10-20-40-80-160-320-640-1280, 5 seconds');
assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(lifePrice), [10, 20, 40, 80, 160, 320, 640, 1280], 'each life costs double the last, 1,280 the last one');
assert.ok(JSON.parse(JSON.stringify(economy.catalog(null))).extraLife.modes.includes('arena'), 'the apps get the rules in the catalogue');
assert.ok(!EXTRA_LIFE.modes.includes('classic'), 'Classic has no lives limit, so no extra lives');

const fails = (fn, status, what) => { try { fn(); } catch (e) { assert.equal(e.status, status, what + ': ' + e.message); return e; } assert.fail(what + ': expected ' + status); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-life-'));
let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
  const k = s => kind + ': ' + s, dir = fs.mkdtempSync(path.join(tmp, kind + '-'));
  const st = kind === 'json' ? new JsonStore(path.join(dir, 'm.json')) : new SqliteStore(sqlite, path.join(dir, 'm.sqlite'));
  const give = (id, atp) => { const q = st.player(id); st.setWallet(id, { balance: atp, earned: Number(q.earned), hour_at: Number(q.hour_at), hour_sum: Number(q.hour_sum) }); };
  const me = id => st.player(id);
  st.createPlayer('a', 'ha', 1); st.createPlayer('b', 'hb', 1);
  give('a', 3000); st.createRun('r1', 'a', Date.now(), 'arena', null);

  // doubling, all the way to the cap
  let spent = 0;
  for (let n = 0; n < 8; n++) { const w = buyLife(st, { runId: 'r1', n }, me('a')); spent += lifePrice(n);
    assert.deepEqual([w.lives, w.price, w.balance], [n + 1, lifePrice(n), 3000 - spent], k('life ' + (n + 1) + ' costs ' + lifePrice(n)));
    assert.equal(w.next, n + 1 < 8 ? lifePrice(n + 1) : null, k('and says the next price (none after the 8th)')); }
  assert.equal(spent, 2550, k('8 lives: 10 + 20 + … + 1,280'));
  assert.equal(Number(st.run('r1', 'a').lives), 8, k('the run counts them'));
  fails(() => buyLife(st, { runId: 'r1', n: 8 }, me('a')), 403, k('a 9th is refused: 1,280 was the last'));
  assert.equal(Number(me('a').balance), 3000 - spent, k('and costs nothing'));

  // a double tap: the same n again is told it has it, and pays once
  st.createRun('r2', 'a', Date.now(), 'bots', null); give('a', 100);
  let w = buyLife(st, { runId: 'r2', n: 0 }, me('a')); assert.deepEqual([w.lives, w.balance, !!w.duplicate], [1, 90, false]);
  w = buyLife(st, { runId: 'r2', n: 0 }, me('a')); assert.deepEqual([w.lives, w.balance, w.duplicate], [1, 90, true], k('the same tap twice pays once'));
  fails(() => buyLife(st, { runId: 'r2', n: 3 }, me('a')), 409, k('a count ahead of the run is out of step'));
  fails(() => buyLife(st, { runId: 'r2', n: -1 }, me('a')), 400, k('a negative count is refused'));
  w = buyLife(st, { runId: 'r2', n: 1 }, me('a')); assert.deepEqual([w.lives, w.price, w.balance], [2, 20, 70], k('then the next costs 20'));
  // a tap that raced: the run moved on between reading it and paying
  assert.equal(st.buyLife('r2', 'a', 1, 40), false, k('the store refuses a stale count'));
  assert.equal(Number(me('a').balance), 70, k('and takes nothing'));

  // not enough ATP: refused with how much more, nothing taken, the count unchanged
  st.createRun('r3', 'a', Date.now(), 'casual', null); give('a', 6);
  const e = fails(() => buyLife(st, { runId: 'r3', n: 0 }, me('a')), 402, k('6 ATP cannot buy a 10 ATP life'));
  assert.match(e.message, /4 more/, k('the message says how much more'));
  assert.deepEqual([Number(me('a').balance), Number(st.run('r3', 'a').lives)], [6, 0], k('and nothing changed'));

  // wrong or finished runs, and modes without extra lives
  fails(() => buyLife(st, { runId: 'nope', n: 0 }, me('a')), 404, k('an unknown run'));
  fails(() => buyLife(st, { runId: 'r1', n: 0 }, me('b')), 404, k('someone else\'s run'));
  st.createRun('r4', 'a', Date.now(), 'arena', null); st.endRun('r4', Date.now(), 0); give('a', 1000);
  fails(() => buyLife(st, { runId: 'r4', n: 0 }, me('a')), 409, k('a finished run'));
  st.createRun('r5', 'a', Date.now(), 'classic', null); fails(() => buyLife(st, { runId: 'r5', n: 0 }, me('a')), 403, k('Classic has no extra lives'));
  st.createRun('r6', 'a', Date.now(), null, null); fails(() => buyLife(st, { runId: 'r6', n: 0 }, me('a')), 403, k('nor a run from an app that never said its mode'));
  assert.equal(Number(me('a').balance), 1000, k('none of those took ATP'));
  if (kind === 'sqlite') st.db.close();
}

/* ---------- through the server: buy two lives, then the run ends and is rated once ---------- */
const dataDir = fs.mkdtempSync(path.join(tmp, 'server-')), secret = 'extralife' + 'x'.repeat(24);
const PORT = 4600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'inherit'] });
const post = async (p, body, auth) => { const r = await fetch(base + '/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
(async () => {
  try {
    for (let i = 0; i < 150; i++) { if (child.exitCode != null) throw new Error('server exited (port ' + PORT + ' in use?)'); try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
    let r = await post('session', { secret });
    assert.deepEqual([r.body.catalog.extraLife.base, r.body.catalog.extraLife.max], [10, 8], 'the session sends the extra-life rules');
    const db = sqlite ? new sqlite.DatabaseSync(path.join(dataDir, 'mitosis.sqlite')) : null;
    if (db) db.prepare('UPDATE players SET balance = 100').run(); else return console.log('extra life tests passed (json store; no server section)');
    const id = (await post('run/start', { mode: 'bots' }, secret)).body.runId;
    r = await post('run/life', { runId: id, n: 0 }, secret); assert.deepEqual([r.status, r.body.lives, r.body.price, r.body.balance, r.body.next], [200, 1, 10, 90, 20], 'the first extra life: 10 ATP');
    const [a, b] = await Promise.all([post('run/life', { runId: id, n: 1 }, secret), post('run/life', { runId: id, n: 1 }, secret)]);
    assert.deepEqual([a.status, b.status], [200, 200], 'two taps at once both answer');
    assert.equal(Math.min(a.body.balance, b.body.balance), 70, 'but only one paid for the second life (20)');
    assert.equal(Number(db.prepare('SELECT balance FROM players WHERE balance > 0').get().balance), 70);
    const other = 'someone' + 'y'.repeat(24); await post('session', { secret: other });
    r = await post('run/life', { runId: id, n: 2 }, other); assert.equal(r.status, 404, 'another player cannot buy on this run');
    db.prepare('UPDATE runs SET started = started - 200000 WHERE id = ?').run(id);
    r = await post('run/end', { runId: id, survived: 150, place: 3, of: 12 }, secret);
    assert.equal(r.status, 200); assert.equal(r.body.livesBought, 2, 'the run ends once, saying it had 2 bought lives');
    r = await post('run/life', { runId: id, n: 2 }, secret); assert.equal(r.status, 409, 'no extra life once the run has ended');
    db.close();
    console.log(`extra life tests passed (${sqlite ? 'sqlite and json stores' : 'json store'})`);
  } finally { child.kill(); }
})().catch(e => { console.error(e); child.kill(); process.exit(1); });
