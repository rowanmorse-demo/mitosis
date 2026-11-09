// The rank ladder: the steps, the old six tiers older apps still get, and the one-time reset. Run:  node ladder.test.js
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert'), crypto = require('crypto');
const economy = require('./economy'), { LADDER, RANKS, rankOf, tierOf, ladderReset, RATING } = economy;

/* ---------- the ladder ---------- */
assert.deepEqual(LADDER.map(s => s.name), ['Amoeba', 'Colony', 'Interphase', 'Prophase', 'Metaphase', 'Anaphase', 'Telophase', 'Cytokinesis', 'Mitosis'], 'nine steps, Amoeba first, Mitosis last');
assert.equal(RANKS.length, 25, '25 ranks: eight steps of three divisions, then Mitosis');
assert.equal(RANKS[0].at, 0); assert.equal(RANKS[0].name, 'Amoeba I'); assert.equal(RANKS[24].name, 'Mitosis'); assert.equal(RANKS[24].div, 0);
for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].at > RANKS[i - 1].at, 'each rank starts higher than the last: ' + RANKS[i].name);
assert.equal(RATING.start, 0, 'everyone starts at the bottom');
for (const [r, want] of [[0, 'Amoeba I'], [24, 'Amoeba I'], [25, 'Amoeba II'], [74, 'Amoeba III'], [75, 'Colony I'], [999, 'Metaphase I'], [1000, 'Metaphase II'], [3499, 'Cytokinesis III'], [3500, 'Mitosis'], [99999, 'Mitosis'], [-5, 'Amoeba I']])
  assert.equal(rankOf(r).name, want, r + ' is ' + want);
// older apps: the six metal tiers, each the start of a step, so every rank sits inside one tier
assert.deepEqual([0, 75, 200, 425, 800, 1400, 3500].map(tierOf), ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legend', 'Legend']);
for (let i = 0; i + 1 < RANKS.length; i++) assert.equal(tierOf(RANKS[i].at), tierOf(RANKS[i + 1].at - 1), 'a rank never straddles two old tiers: ' + RANKS[i].name);
for (const s of LADDER) assert.equal(new Set(s.at.map(tierOf)).size, 1, s.name + ' sits inside one old tier');
const cat = JSON.parse(JSON.stringify(economy.catalog(null))); // as the apps receive it
assert.equal(cat.tiers.length, 6, 'older apps still get exactly six tiers'); assert.equal(cat.tierAt.length, 6); assert.equal(cat.tierAt[5], null, 'the top tier has no end (Infinity is sent as null)');
assert.deepEqual(cat.ranks.map(r => r.name), RANKS.map(r => r.name), 'new apps get the whole ladder'); assert.equal(cat.steps.length, 9);

/* ---------- the reset: once per database, old ratings kept ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-ladder-'));
let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
const { SqliteStore, JsonStore } = require('./store');
for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
  const k = s => kind + ': ' + s, dir = fs.mkdtempSync(path.join(tmp, kind + '-'));
  const st = kind === 'json' ? new JsonStore(path.join(dir, 'm.json')) : new SqliteStore(sqlite, path.join(dir, 'm.sqlite'));
  st.createPlayer('a', 'ha', 1); st.createPlayer('b', 'hb', 1);
  assert.deepEqual([Number(st.player('a').rating), Number(st.player('a').ai_rating)], [0, 0], k('a new player starts at 0 on both ratings'));
  st.setRating('a', 1234, 'Ann'); st.setAiRating('a', 1500, 'Ann'); st.setRating('b', 980, null);
  st.addStats('a', { played: 3, rounds: 2, wins: 1, podiums: 2, alive: 400, eaten: 20 }); st.setPeak('a', 1234); st.addTrophies('a', ['amoeba', 'colony'], 5);
  assert.equal(ladderReset(st), true, k('the first start-up resets'));
  const a = st.player('a'), b = st.player('b');
  assert.deepEqual([a.rating, a.ai_rating, b.rating, b.ai_rating].map(Number), [0, 0, 0, 0], k('everyone starts again'));
  assert.deepEqual([a.rating_v1, a.ai_rating_v1, b.rating_v1].map(Number), [1234, 1500, 980], k('the old ratings are kept'));
  assert.deepEqual([Number(a.runs), a.name], [1, 'Ann'], k('lives played and names stay'));
  assert.deepEqual([a.peak, st.trophies('a'), Number(a.played), Number(a.alive)], [null, [], 3, 400], k('the peak and the rank trophies start again too; lifetime stats stay'));
  st.setRating('a', 60, 'Ann');
  assert.equal(ladderReset(st), false, k('later start-ups leave ratings alone')); assert.equal(Number(st.player('a').rating), 60);
  if (kind === 'sqlite') st.db.close();
}

/* ---------- through the server: a database from before the ladder ---------- */
const dataDir = fs.mkdtempSync(path.join(tmp, 'server-')), secret = 'laddersecret' + 'x'.repeat(20), sha = s => crypto.createHash('sha256').update(s).digest('hex');
if (sqlite) { const st = new SqliteStore(sqlite, path.join(dataDir, 'mitosis.sqlite')); st.createPlayer('old', sha(secret), 1); st.setRating('old', 1312, 'Veteran'); st.setAiRating('old', 1100, 'Veteran'); st.db.close(); }
else { const st = new JsonStore(path.join(dataDir, 'mitosis.json')); st.createPlayer('old', sha(secret), 1); st.setRating('old', 1312, 'Veteran'); st.setAiRating('old', 1100, 'Veteran'); }
const PORT = 4200 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${PORT}`;
const start = () => spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'inherit'] });
async function up(child) { for (let i = 0; i < 150; i++) { if (child.exitCode != null) throw new Error('server exited (port ' + PORT + ' in use?)'); try { if ((await fetch(base + '/health')).ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100)); } throw new Error('server did not start'); }
const session = async () => (await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) })).json();
(async () => {
  if (!sqlite) await new Promise(r => setTimeout(r, 400)); // let the JSON store write
  let child = start(); await up(child);
  let w = await session();
  assert.deepEqual([w.rating, w.rank, w.tier, w.aiRating, w.aiRank, w.runs], [0, 'Amoeba I', 'Bronze', 0, 'Amoeba I', 1], 'a veteran from before starts again at Amoeba I');
  assert.equal(w.catalog.ranks.length, 25); assert.equal(w.catalog.tiers.length, 6);
  const fresh = await (await fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'newcomer' + 'n'.repeat(24) }) })).json();
  assert.deepEqual([fresh.rating, fresh.rank, fresh.aiRating], [0, 'Amoeba I', 0], 'a newcomer starts there too');
  child.kill(); await new Promise(r => child.on('exit', r));
  // a second start-up must not reset again
  if (sqlite) { const db = new sqlite.DatabaseSync(path.join(dataDir, 'mitosis.sqlite')); db.prepare("UPDATE players SET rating = 450 WHERE id = 'old'").run(); db.close(); }
  child = start(); await up(child); w = await session();
  if (sqlite) assert.deepEqual([w.rating, w.rank, w.tier], [450, 'Prophase I', 'Platinum'], 'ratings earned after the reset stay through restarts');
  else assert.equal(w.rating, 0);
  child.kill();
  console.log('rank ladder tests passed');
})().catch(e => { console.error(e); process.exit(1); });
