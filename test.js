// End-to-end test of the ATP economy API against a throwaway server. Run:  npm test
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');

const PORT = 3100 + Math.floor(Math.random() * 500), KEY_PORT = PORT + 1;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-test-'));

// A stand-in for Apple's and Google's key servers: the sign-in tokens below are signed with this key.
const crypto = require('crypto');
const { publicKey: jwkPub, privateKey: jwkPriv } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...jwkPub.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const keyServer = require('http').createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
keyServer.listen(KEY_PORT, '127.0.0.1');
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function signToken(claims) { const data = b64u({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }) + '.' + b64u(claims); return data + '.' + crypto.sign('sha256', Buffer.from(data), jwkPriv).toString('base64url'); }
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// live players: history from before a restart is kept, except what is older than 24 hours
const minuteNow = Math.floor(Date.now() / 60e3);
fs.writeFileSync(path.join(dataDir, 'live-history.json'), JSON.stringify({ rows: [[minuteNow - 25 * 60, 9, 9, 9, 0, 9, 0, 0, 0, 0], [minuteNow - 30, 5, 4, 3, 1, 2, 2, 1, 0, 0]], best: { n: 40, at: Date.now() - 864e5 * 9 } }));
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')],
  { env: { ...process.env, PORT, DATA_DIR: dataDir, MAX_ROOMS: '3', IAP_UNVERIFIED: '1', MITOSIS_DATE: '2026-11-20T12:00:00Z' /* the server's calendar: inside battle pass season 1 */, AUTH_APPLE_JWKS: `http://127.0.0.1:${KEY_PORT}/apple`, AUTH_GOOGLE_JWKS: `http://127.0.0.1:${KEY_PORT}/google`, GOOGLE_CLIENT_IDS: 'test-google-client' }, stdio: ['ignore', 'ignore', 'inherit'] });
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

(async () => {
  await waitUp();
  const secret = 'testsecret' + 'a'.repeat(20);
  let r = await post('/api/session', { secret });
  assert.equal(r.status, 200); assert.equal(r.body.balance, 0); assert.ok(r.body.catalog.skins.length >= 10, 'catalog has skins');
  assert.equal(r.body.catalog.skins.find(s => s.id === 16).price, 12000000, 'One Cell to Rule Them All costs 12,000,000 ATP');
  const premium = [...fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').matchAll(/\{id:(\d+),key:'(\w+)',name:(?:'([^']+)'|"([^"]+)"),price:(\d+)/g)].map(m => ({ id: +m[1], key: m[2], name: m[3] || m[4], price: +m[5] }));
  assert.deepEqual(r.body.catalog.skins.map(s => ({ id: s.id, key: s.key, name: s.name, price: s.price })), premium, 'the server sells exactly the skins the game draws');
  { // seasonal skins: on sale only in their window (with a day's margin for time zones), every year
    const { seasonOpen } = require('./economy'), at = s => Date.parse(s);
    for (const [d, open] of [['2026-10-30T12:00Z', true], ['2027-10-23T06:00Z', true], ['2026-11-04T20:00Z', true], ['2026-11-06T00:00Z', false], ['2026-07-04T12:00Z', false], ['2026-10-22T00:00Z', false]])
      assert.equal(seasonOpen('halloween', at(d)), open, 'Halloween on ' + d);
    assert.ok(r.body.catalog.seasons.halloween, 'the catalogue lists the seasons');
  }
  { // the name filter in the game and on the server refuse the same names
    const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), src = page.slice(page.indexOf('const NAME_BAD_ANY'), page.indexOf('const cleanName=s=>{'));
    const inGame = new Function(src + '\nreturn nameBlocked;')(), onServer = require('./economy').nameBlocked;
    const bad = ['fuck', 'F u c k', 'fuuuck', 'sh1t', 'b1tch', 'a s s', 'Big Dick', 'kys', 'R@pe', 'Hitler', 'k i l l yourself'], ok = ['Unnamed cell', 'Bass', 'Cucumber', 'Torpedo', 'Dickens', 'Grass cell', 'Nigeria', 'Therapist', 'Peacock', 'Glass', 'Titan', 'Mass 5000'];
    for (const n of bad) { assert.equal(inGame(n), true, 'game blocks ' + n); assert.equal(onServer(n), true, 'server blocks ' + n); }
    for (const n of ok) { assert.equal(inGame(n), false, 'game allows ' + n); assert.equal(onServer(n), false, 'server allows ' + n); }
  }

  r = await post('/api/run/start', {}); assert.equal(r.status, 401, 'auth required');

  r = await post('/api/run/start', {}, secret); assert.equal(r.status, 200); const runId = r.body.runId;
  r = await post('/api/run/end', { runId, survived: 9999, eaten: 10, peak: 800 }, secret); assert.equal(r.status, 200);
  // survival is capped by what elapsed on the server (~0 s + 15 s grace), under the 20 s minimum: nothing
  assert.equal(r.body.payout, 0); assert.equal(r.body.balance, 0);
  const { payoutFor } = require('./economy');
  assert.equal(payoutFor({ survived: 300, bestRank: 1 }), 25, 'a win pays 25'); assert.equal(payoutFor({ survived: 300, bestRank: 2 }), 20); assert.equal(payoutFor({ survived: 300, bestRank: 3 }), 16);
  assert.equal(payoutFor({ survived: 300, bestRank: 7 }), 8); assert.equal(payoutFor({ survived: 300, bestRank: 15 }), 3); assert.equal(payoutFor({ survived: 300, bestRank: 30 }), 1);
  assert.equal(payoutFor({ survived: 300, bestRank: 31 }), 0); assert.equal(payoutFor({ survived: 10, bestRank: 1 }), 0, 'insta-death pays nothing');
  assert.equal(payoutFor({ survived: 300, place: 1, bestRank: 40 }), 25, 'placement wins over mass rank'); assert.equal(payoutFor({ survived: 300, place: 9 }), 6);
  { let last = 99; for (let p = 1; p <= 31; p++) { const v = payoutFor({ survived: 300, place: p }); assert.ok(v <= last, 'payout never rises as placement drops'); last = v; } }
  const { ratingDelta } = require('./economy');
  assert.equal(ratingDelta(1000, 300, 0, 1, 20), ratingDelta(1000, 300, 0) + 8 + 10, '1st of 20 adds the full placing bonus and the win bonus');
  assert.equal(ratingDelta(1000, 300, 0, 2, 20), ratingDelta(1000, 300, 0) + Math.round(8 * 18 / 19), '2nd gets a placing bonus but no win bonus');
  assert.ok(ratingDelta(1000, 300, 5, 5, 20, 1) < ratingDelta(1000, 300, 5, 5, 20, 0), 'a run on the second life gains less');
  assert.equal(ratingDelta(1000, 300, 5, 5, 20, 2), Math.round((15 + 10 + 8 * 15 / 19) * .5), 'the third life gains half');
  assert.equal(ratingDelta(1000, 300, 0, 20, 20), ratingDelta(1000, 300, 0), 'last place adds nothing');
  assert.equal(ratingDelta(1000, 300, 0, 1, 3), ratingDelta(1000, 300, 0), 'placing needs at least 4 in the round');
  { // XP: time alive plus a placing bonus; levels need more XP each time
    const { xpFor, levelOf, xpAtLevel, xpToNext, XP } = require('./economy');
    assert.deepEqual(xpFor({ survived: 300, place: 1, of: 20 }), { time: 60, place: 60, win: 40, total: 160 }, '5 min and a win of 20');
    assert.deepEqual(xpFor({ survived: 300, place: 20, of: 20 }), { time: 60, place: 0, win: 0, total: 60 }, 'last place earns only its time');
    assert.equal(xpFor({ survived: 300, place: 6, of: 11 }).place, 30, '6th of 11 is halfway');
    { let last = -1; for (const sec of [0, 9, 10, 30, 60, 120, 300, 599, 600]) { const v = xpFor({ survived: sec, place: 5, of: 20 }).total; assert.ok(v >= last, 'more time never earns less'); last = v; } }
    assert.ok(xpFor({ survived: 400, place: 5, of: 20 }).total > xpFor({ survived: 200, place: 5, of: 20 }).total, 'surviving longer earns more');
    assert.equal(xpFor({ survived: 9999 }).time, xpFor({ survived: XP.timeCapSec }).time, 'time counts up to one round'); assert.equal(xpFor({ survived: XP.timeCapSec }).time, 120);
    { let last = Infinity; for (let p = 1; p <= 20; p++) { const v = xpFor({ survived: 300, place: p, of: 20 }).total; assert.ok(v < last, 'each better place earns more'); last = v; } }
    assert.equal(xpFor({ survived: 300, place: 1, of: 3 }).total, 60, 'placing needs at least 4 in the round');
    assert.equal(xpFor({ survived: 15, place: 1, of: 20 }).total, 2, 'a life under 20 s places for nothing');
    for (const [place, of] of [[0, 20], [21, 20], [-3, 20], ['x', 20], [1, 'x']]) assert.equal(xpFor({ survived: 300, place, of }).total, 60, `place ${place} of ${of} is not a placing`);
    assert.equal(xpFor({ survived: -50, place: 1, of: 20 }).total, 0); assert.equal(xpFor({}).total, 0);
    assert.deepEqual(levelOf(0), { xp: 0, level: 1, levelXp: 0, levelNeed: 100 }, 'everyone starts at level 1');
    assert.deepEqual(levelOf(99), { xp: 99, level: 1, levelXp: 99, levelNeed: 100 });
    assert.deepEqual(levelOf(100), { xp: 100, level: 2, levelXp: 0, levelNeed: 150 }, 'level 2 at 100 XP');
    assert.deepEqual(levelOf(250), { xp: 250, level: 3, levelXp: 0, levelNeed: 200 }, 'level 3 at 250 XP');
    assert.deepEqual(levelOf(449), { xp: 449, level: 3, levelXp: 199, levelNeed: 200 });
    assert.equal(levelOf(undefined).level, 1, 'players stored before XP existed are level 1'); assert.equal(levelOf(-5).xp, 0);
    for (let L = 1; L < 500; L++) {
      assert.ok(xpToNext(L + 1) > xpToNext(L), 'each level needs more XP than the last');
      assert.equal(xpAtLevel(L + 1) - xpAtLevel(L), xpToNext(L));
      assert.equal(levelOf(xpAtLevel(L)).level, L, 'level ' + L + ' starts at ' + xpAtLevel(L)); assert.equal(levelOf(xpAtLevel(L + 1) - 1).level, L);
    }
    const big = levelOf(1e12); assert.ok(big.levelXp >= 0 && big.levelXp < big.levelNeed && xpAtLevel(big.level) + big.levelXp === 1e12, 'huge XP still lands inside a level');
  }
  { // lifetime stats and rank trophies
    const { lifeStats, stepsUpTo, LADDER, XP, QUESTS } = require('./economy');
    assert.deepEqual(lifeStats({ survived: 300, place: 1, of: 20, eaten: 12 }), { played: 1, rounds: 1, wins: 1, podiums: 1, alive: 300, eaten: 12 }, 'a win is also a top-3 finish');
    assert.deepEqual(lifeStats({ survived: 300, place: 3, of: 20 }), { played: 1, rounds: 1, wins: 0, podiums: 1, alive: 300, eaten: 0 });
    assert.deepEqual(lifeStats({ survived: 300, place: 4, of: 20 }), { played: 1, rounds: 1, wins: 0, podiums: 0, alive: 300, eaten: 0 });
    assert.deepEqual(lifeStats({ survived: 19, place: 1, of: 20, eaten: 5 }), { played: 0, rounds: 0, wins: 0, podiums: 0, alive: 0, eaten: 0 }, 'a life under 20 s counts for nothing');
    assert.equal(lifeStats({ survived: 20 }).played, 1, '20 s counts'); assert.deepEqual(['rounds', 'wins'].map(k => lifeStats({ survived: 300, place: 1, of: 3 })[k]), [0, 0], 'a round of 3 is no round and wins nothing');
    assert.deepEqual([60, 600].map(sec => lifeStats({ survived: sec, eaten: 1e6 }).eaten), [25, 160], 'cells absorbed: at most 10 + 15 a minute of the life');
    assert.equal(lifeStats({ survived: 1e9 }).alive, XP.timeCapSec, 'a ranked life counts up to one round');
    assert.deepEqual(lifeStats({ survived: 1e9, place: 1, of: 20, eaten: 50, mode: 'classic' }), { played: 1, rounds: 0, wins: 0, podiums: 0, alive: QUESTS.classicSec, eaten: 50 }, 'Classic: a life, its time and cells, no placing');
    assert.deepEqual([stepsUpTo(0), stepsUpTo(74), stepsUpTo(75)], [['amoeba'], ['amoeba'], ['amoeba', 'colony']], 'a step trophy comes with its first division');
    assert.deepEqual(stepsUpTo(1400), ['amoeba', 'colony', 'interphase', 'prophase', 'metaphase', 'anaphase']); assert.deepEqual(stepsUpTo(99999), LADDER.map(st => st.key), 'Mitosis brings every trophy');
  }
  // rating: that run (15 s on the server clock, 10 kills) is a quick death: +0.5 survival +20 kills -7.5 penalty = +13
  assert.equal(r.body.ratingDelta, 13); assert.equal(r.body.rating, 13, 'from the start of 0'); assert.equal(r.body.tier, 'Bronze'); assert.equal(r.body.rank, 'Amoeba I');
  assert.deepEqual(r.body.stats, { played: 0, rounds: 0, wins: 0, podiums: 0, alive: 0, eaten: 0, peak: 13 }, 'lifetime stats: a 15 s life counts for nothing, the peak still moves');
  assert.deepEqual(r.body.trophies.map(t => t.step), ['amoeba'], 'a first ranked life wins the Amoeba trophy'); assert.ok(r.body.trophies.every(t => Math.abs(t.at - Date.now()) < 60e3), 'dated');
  // XP is capped the same way: ~15 s of time, so 2 XP however long the client says it lived
  assert.equal(r.body.xpGained, 2); assert.deepEqual(r.body.xpParts, { time: 2, place: 0, win: 0 }); assert.equal(r.body.xp, 2); assert.equal(r.body.level, 1); assert.equal(r.body.levelXp, 2); assert.equal(r.body.levelNeed, 100); assert.equal(r.body.levelUp, 0);
  r = await post('/api/run/end', { runId, survived: 9999, eaten: 10, peak: 800 }, secret);
  assert.equal(r.body.duplicate, true); assert.equal(r.body.balance, 0, 'ending a run twice pays once'); assert.equal(r.body.xp, 2, 'and gives XP once'); assert.equal(r.body.xpGained, 2, 'a repeat still says what the run earned');
  r = await post('/api/run/end', { runId: 'nope' }, secret); assert.equal(r.status, 404);
  // an instant death with no kills loses rating
  r = await post('/api/run/start', {}, secret); const run2 = r.body.runId;
  r = await post('/api/run/end', { runId: run2, survived: 0, eaten: 0, peak: 25, name: 'Tester' }, secret); assert.equal(r.body.ratingDelta, -10); assert.equal(r.body.rating, 3);
  const lb = await (await fetch(base + '/api/leaderboard')).json(); assert.equal(lb.top[0].name, 'Tester'); assert.equal(lb.top[0].rating, 3); assert.equal(lb.top[0].rankName, 'Amoeba I');
  { // connection report: the relay echoes pings, reports are checked and kept anonymously, and only the token opens the report
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws'); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const pong = new Promise(res => { ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'pong') res(m); }; });
    ws.send(JSON.stringify({ t: 'ping', c: 1234.5 })); assert.equal((await pong).c, 1234.5, 'the relay echoes pings'); ws.close();
    for (const b of [
      { platform: 'ios', app: 'ios-2.3.0', tz: 'Europe/London', n: 40, lost: 1, min: 120, med: 180, p90: 240, jit: 25, fps: 58, slow: 4 },
      { platform: 'ios', tz: 'Europe/Berlin', n: 30, lost: 0, min: 150, med: 170, p90: 210, jit: 18, fps: 60, slow: 2 },
      { platform: 'web', tz: 'Europe/Paris', n: 30, lost: 0, min: 140, med: 165, p90: 200, jit: 15, fps: 55, slow: 5 },
      { platform: 'android', tz: 'America/Chicago', n: 25, lost: 0, min: 30, med: 42, p90: 60, jit: 8, fps: 60, slow: 1, conn: '4g' },
      { tz: 'America/Chicago', n: 1, med: 40 }, { n: 'x' }, null,                     // too few samples or nonsense: ignored
    ]) { r = await post('/api/net', b); assert.equal(r.status, 200); }
    const token = fs.readFileSync(path.join(dataDir, 'admin-token'), 'utf8').trim();
    assert.equal((await fetch(base + '/admin/net?token=wrong')).status, 403, 'the report needs the token');
    const rep = await (await fetch(base + '/admin/net?format=json&token=' + token)).json();
    assert.equal(rep.reports, 4, 'only usable reports are kept');
    const eu = rep.areas.find(a => a.name === 'Europe'); assert.equal(eu.reports, 3); assert.equal(eu.ping, 170); assert.match(eu.verdict, /closer to this area/);
    assert.match(rep.areas.find(a => a.name === 'US & Canada Central').verdict, /Not enough reports/);
    const html = await (await fetch(base + '/admin/net?token=' + token)).text(); assert.match(html, /Connection report/); assert.match(html, /Europe/);
  }
  { // live players: each relay connection counts by what it is doing and where it comes from; only the token opens the page
    const { platformOf } = require('./live');
    for (const [origin, ua, plat, mob] of [
      [base, 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', 'web', true],
      [base, 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36', 'web', true],
      ['https://abc.trycloudflare.com', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', 'web', false],
      ['null', 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 'ios', true],
      ['file://', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', 'ios', true],          // iPad app (desktop-class agent)
      [undefined, 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36', 'android', true],
      ['null', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0 Safari/537.36', 'other', false], // tools/snap.js on a file
      [undefined, undefined, 'other', false],
    ]) assert.deepEqual(platformOf({ origin, 'user-agent': ua }), { plat, mob }, `${origin} ${ua}`);

    const token = fs.readFileSync(path.join(dataDir, 'admin-token'), 'utf8').trim(), tq = '?token=' + token;
    assert.equal((await fetch(base + '/admin/live')).status, 403, 'the live page needs the token');
    assert.equal((await fetch(base + '/admin/live/stream?token=wrong')).status, 403, 'and so does its stream');
    const now = async () => (await fetch(base + '/admin/live' + tq + '&format=json')).json();
    const ctl = new AbortController(), events = [], sse = await fetch(base + '/admin/live/stream' + tq, { signal: ctl.signal });
    assert.match(sse.headers.get('content-type'), /text\/event-stream/);
    (async () => { const td = new TextDecoder(); let buf = ''; try { for await (const ch of sse.body) { buf += td.decode(ch, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, i), ev = /^event: (\w+)$/m.exec(b), d = /^data: (.*)$/m.exec(b); buf = buf.slice(i + 2); if (ev && d) events.push({ ev: ev[1], d: JSON.parse(d[1]) }); } } } catch (e) {} })();
    const expect = async (what, want, ms = 3000) => { // waits for the dashboard to show `want`, then checks it
      for (const t0 = Date.now(); ;) { const j = await now(), got = Object.fromEntries(Object.keys(want).map(k => [k, j[k]]));
        if (JSON.stringify(got) === JSON.stringify(want) || Date.now() - t0 > ms) { assert.deepEqual(got, want, what); return j; } await new Promise(r => setTimeout(r, 100)); } };
    const until = async (what, ok, ms = 3000) => { const t0 = Date.now(); for (;;) { const v = await ok(); if (v) return v; if (Date.now() - t0 > ms) assert.fail('timed out waiting for ' + what); await new Promise(r => setTimeout(r, 100)); } };
    const join = headers => new Promise((res, rej) => { const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers });
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello' })); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'welcome') res(ws); if (m.t === 'full') res('full'); }; ws.onerror = rej; });
    const web = await join({ Origin: base, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' });
    const ios = await join({ Origin: 'null', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
    const android = await join({ Origin: 'file://', 'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36' });
    // the website player is alive in the arena and hosts the round (90.5 s in); the iPhone is searching; the Android phone is in the menus
    const pres = () => { web.send(JSON.stringify({ t: 'p', p: { v: 6, a: 1, h: 1, q: 0, rd: 'ABAOJ' } })); ios.send(JSON.stringify({ t: 'p', p: { v: 6, a: 0, h: 0, q: 1 } })); };
    pres(); android.send(JSON.stringify({ t: 'p', p: { v: 6, a: 0, h: 0, q: 0 } }));
    let s = await expect('three players, and the round clock from the host', { online: 3, web: 1, ios: 1, android: 1, other: 0, arena: 1, searching: 1, menus: 1, solo: 0, playing: 1, cap: 48, roomSize: 16, round: 90.5 });
    assert.equal(s.best.n, 40, 'the most at once survives a restart');
    assert.ok(!s.rows.some(r => r[0] <= minuteNow - 24 * 60), 'history older than 24 hours is dropped');
    assert.deepEqual(s.rows.find(r => r[0] === minuteNow - 30), [minuteNow - 30, 5, 4, 3, 1, 2, 2, 1, 0, 0], 'history from before the restart is kept');
    // a ranked life is open from run/start until run/end
    r = await post('/api/run/start', {}, secret); await expect('a ranked life in progress', { ranked: 1 });
    await post('/api/run/end', { runId: r.body.runId, survived: 5, eaten: 0, peak: 25 }, secret); await expect('the life ended', { ranked: 0 });
    // the Android player starts a solo game: no presence for 3 s, but its pings go on
    const more = [], inMenus = w => w !== 'full' && w.readyState === 1 && w.send(JSON.stringify({ t: 'p', p: { v: 6, a: 0, h: 0, q: 0 } }));
    const keep = setInterval(() => { pres(); android.send(JSON.stringify({ t: 'ping', c: 1 })); more.forEach(inMenus); }, 400);
    await expect('a solo game', { online: 3, arena: 1, searching: 1, solo: 1, menus: 0, playing: 2 }, 5000);
    // an arena room holds 16 games (these wait in the menus, sending presence like a real game); the 17th is not turned away but opens a second room
    for (let i = 0; i < 14; i++) { const w = await join({ Origin: base }); inMenus(w); more.push(w); }
    assert.ok(!more.includes('full'), 'the 17th game gets in');
    s = await expect('two arena rooms', { online: 17 });
    assert.deepEqual(s.rooms.map(r => r.games), [16, 1], 'the first room is full and the 17th game has a room of its own');
    assert.equal(s.rooms[0].round, 90.5, 'the first room keeps its round'); assert.equal(s.rooms[1].round, null, 'the new room has no host yet');
    // the history rows since this test began (a minute may have turned meanwhile): each keeps its busiest second
    const peak = (j, k) => Math.max(...j.rows.filter(r => r[0] >= minuteNow).map(r => r[j.cols.indexOf(k) + 1]));
    assert.equal(s.rows.filter(r => r[0] >= minuteNow).reduce((n, r) => n + r[s.cols.indexOf('full') + 1], 0), 0, 'nobody was turned away');
    for (const w of more) w.close();
    web.close();
    s = await expect('the website player left and took the round clock along', { online: 2, web: 0, arena: 0, round: null });
    assert.deepEqual(['online', 'playing', 'arena', 'solo', 'web', 'ios', 'android'].map(k => peak(s, k)), [17, 2, 1, 1, 15, 1, 1], 'the history keeps the busiest moment');
    // the stream sent the whole picture first, then the changes as they happened
    await until('stream updates', () => events.some(e => e.ev === 'now' && e.d.online === 2));
    assert.equal(events[0].ev, 'all'); assert.ok(Array.isArray(events[0].d.rows) && events[0].d.cols.includes('online'));
    assert.ok(events.some(e => e.ev === 'now' && e.d.online === 3 && e.d.solo === 1), 'the stream saw the solo game');
    clearInterval(keep); ios.close(); android.close();
    await expect('everyone left', { online: 0, rooms: [] });

    // More games than one arena holds: nobody is locked out. Every game that opens gets a room of up to 16, and a room
    // is a world of its own: its games only hear each other, so each room has its own host and round. The server turns
    // games away only when all MAX_ROOMS rooms (3 here) are full.
    const open = party => new Promise((res, rej) => { const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { Origin: base } }), g = { ws, heard: new Set() };
      ws.onopen = () => ws.send(JSON.stringify(party ? { t: 'hello', party } : { t: 'hello' }));
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'welcome') { g.id = m.id; g.peers = m.peers.map(q => q.id); res(g); } else if (m.t === 'full') res('full'); else if (m.t === 'p') g.heard.add(m.id); };
      ws.onerror = rej; });
    const games = []; for (let i = 0; i < 40; i++) games.push(await open());
    assert.ok(!games.includes('full'), 'none of 40 games is turned away');
    s = await expect('40 games in three rooms', { online: 40 }); assert.deepEqual(s.rooms.map(r => r.games), [16, 16, 8], 'games fill one room before the next opens');
    const roomOf = i => games.slice(Math.floor(i / 16) * 16, Math.floor(i / 16) * 16 + 16), ids = list => list.map(g => g.id).sort();
    // each game is in the menus; one game in each of the first two rooms hosts a round (room 1 at 90.5 s, room 2 at 4 s)
    const hosts = { 0: 'ABAOJ', 16: 'ACAAo' }, inArena = new Set();
    const say = () => games.forEach((g, i) => g.ws.readyState === 1 && g.ws.send(JSON.stringify({ t: 'p', p: hosts[i] ? { v: 6, a: 0, h: 1, q: 0, rd: hosts[i] } : { v: 6, a: inArena.has(i) ? 1 : 0, h: 0, q: 0 } })));
    say(); const talk = setInterval(say, 400); await until('every game hears its room', () => games.every((g, i) => g.heard.size === roomOf(i).length - 1));
    games.forEach((g, i) => assert.deepEqual([...g.heard, g.id].sort(), ids(roomOf(i)), 'game ' + i + ' hears exactly its own room'));
    s = await expect('a round clock in each hosted room', { online: 40, round: 90.5 });
    assert.deepEqual(s.rooms.map(r => r.round), [90.5, 4, null], 'each room follows its own host');
    // a game leaves the first room: the next one to open takes its place there (the fullest room with space)
    const gone = games[5]; gone.ws.close(); await expect('a place free in room 1', { online: 39 });
    const late = await open(); assert.notEqual(late, 'full');
    assert.deepEqual(late.peers.sort(), ids(roomOf(0).filter(g => g !== gone)), 'the newcomer joins room 1 and is told about the games already there');
    // two leave room 2, and in room 3 a player is alive in the arena: newcomers go where someone is playing
    games[20].ws.close(); games[21].ws.close(); await expect('two places free in room 2', { online: 38 });
    // the first of two friends in a party joins by the usual choice (room 2, the fullest with space) and says where it is
    const duo1 = await open('duo123'); duo1.ws.send(JSON.stringify({ t: 'p', p: { v: 6, a: 0, h: 0, q: 0 } }));
    await until('room 2 hears the first friend', () => games[16].heard.has(duo1.id));
    inArena.add(33);
    await until('the player in room 3 is counted', async () => (await now()).rooms[2].arena === 1);
    const late2 = await open(); assert.ok(late2.peers.includes(games[33].id) && late2.peers.length === 8, 'the newcomer joins room 3, where a player is in the arena');
    // the second friend follows its party into room 2, where a newcomer would not go now; once that room is full, a
    // third game with the same party gets the usual choice
    const duo2 = await open('duo123'); assert.ok(duo2.peers.includes(duo1.id) && duo2.peers.length === 15, 'a party member joins the room its party is in');
    const duo3 = await open('duo123'); assert.ok(!duo3.peers.includes(duo1.id) && duo3.peers.includes(games[33].id), 'a full party room falls back to the usual choice');
    // fill every room: 48 games are in, and only the 49th is turned away (and counted)
    const fill = []; for (let i = 0; i < 6; i++) fill.push(await open());
    assert.ok(!fill.includes('full'), 'the server takes games until every room is full');
    s = await expect('three full rooms', { online: 48 }); assert.deepEqual(s.rooms.map(r => r.games), [16, 16, 16]);
    assert.equal(await open(), 'full', 'the 49th game is turned away');
    s = await now(); assert.equal(s.rows.filter(r => r[0] >= minuteNow).reduce((n, r) => n + r[s.cols.indexOf('full') + 1], 0), 1, 'the turned-away game is in the history');
    // a room that empties closes, and the rooms after it move up
    for (const g of [...games.slice(0, 16), late]) g.ws.close();
    s = await expect('room 1 closed', { online: 32 }); assert.deepEqual(s.rooms.map(r => r.games), [16, 16]);
    clearInterval(talk); for (const g of [...games, late2, duo1, duo2, duo3, ...fill]) g.ws.close();
    await expect('everyone left', { online: 0, rooms: [] });
    assert.equal((await (await fetch(base + '/health')).json()).rooms, 0);
    ctl.abort();
    const html = await (await fetch(base + '/admin/live' + tq)).text(); assert.match(html, /<title>Mitosis live players<\/title>/); assert.match(html, /EventSource/);
  }
  // a refused name never reaches the leaderboard: the player keeps their last good one
  r = await post('/api/run/start', {}, secret); r = await post('/api/run/end', { runId: r.body.runId, survived: 30, eaten: 0, peak: 25, name: 'sh1t head' }, secret); assert.equal(r.status, 200);
  { const lb2 = await (await fetch(base + '/api/leaderboard')).json(); assert.equal(lb2.top[0].name, 'Tester', 'blocked names are not stored'); }
  { // name fonts: the account keeps its font; the leaderboard and friends send it with the name
    r = await post('/api/session', { secret }); assert.deepEqual([r.body.nameFont, r.body.fonts], [0, []], "no font yet: the game's own");
    assert.deepEqual(r.body.catalog.fonts, { max: 255, locks: {} }, 'the catalogue has the rules: every font free for now');
    for (const font of [-1, 256, 2.5, 'big', null]) assert.equal((await post('/api/font', { font }, secret)).status, 400, 'font ' + font + ' is refused');
    assert.equal((await post('/api/font', { font: 1 })).status, 401, 'it needs the player');
    r = await post('/api/font', { font: 200 }, secret); assert.deepEqual([r.status, r.body.nameFont], [200, 200], 'an id with no rule here is kept: newer apps add fonts');
    r = await post('/api/font', { font: 12 }, secret); assert.equal(r.body.nameFont, 12);
    r = await post('/api/session', { secret }); assert.equal(r.body.nameFont, 12, 'the session brings it back');
    const lb3 = await (await fetch(base + '/api/leaderboard')).json(); assert.deepEqual([lb3.top[0].name, lb3.top[0].font], ['Tester', 12], 'the leaderboard sends the font');
    r = await post('/api/social/me', { name: 'Tester', font: 3 }, secret); assert.equal(r.body.font, 12, "friends see the account's font, not one a game claims");
  }
  { // XP over real server time: lives are backdated in the database, as if the time had passed
    const sec4 = 'xpsecret' + 'd'.repeat(24), store = (await (await fetch(base + '/health')).json()).store;
    r = await post('/api/session', { secret: sec4 }); assert.deepEqual([r.body.xp, r.body.level, r.body.levelXp, r.body.levelNeed], [0, 1, 0, 100], 'a new player is level 1 with no XP');
    assert.deepEqual(r.body.catalog.xp, require('./economy').XP, 'the catalogue carries the XP rules');
    assert.deepEqual([r.body.trophies, r.body.stats], [[], { played: 0, rounds: 0, wins: 0, podiums: 0, alive: 0, eaten: 0, peak: 0 }], 'a new player has no trophies yet');
    r = await post('/api/run/start', {}, sec4); r = await post('/api/run/end', { runId: r.body.runId, survived: 9999, place: 1, of: 20, bestRank: 999 }, sec4);
    assert.equal(r.body.xpGained, 2, 'claiming a long winning life right after starting it earns only the time that passed');
    if (store === 'sqlite') {
      const db = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'mitosis.sqlite')), backdate = (id, s) => db.prepare('UPDATE runs SET started = started - ? WHERE id = ?').run(s * 1000, id);
      r = await post('/api/run/start', {}, sec4); backdate(r.body.runId, 400);
      r = await post('/api/run/end', { runId: r.body.runId, survived: 9999, place: 1, of: 20, bestRank: 999 }, sec4);
      assert.deepEqual(r.body.xpParts, { time: 82, place: 60, win: 40 }, '415 s on the server clock (with the grace) and a win of 20');
      assert.deepEqual([r.body.xpGained, r.body.xp, r.body.level, r.body.levelXp, r.body.levelNeed, r.body.levelUp], [182, 184, 2, 84, 150, 1], 'level 2');
      r = await post('/api/run/start', {}, sec4); backdate(r.body.runId, 2000);
      r = await post('/api/run/end', { runId: r.body.runId, survived: 9999, place: 20, of: 20, bestRank: 999 }, sec4);
      assert.deepEqual([r.body.xpGained, r.body.xp, r.body.level, r.body.levelXp, r.body.levelNeed, r.body.levelUp], [120, 304, 3, 54, 200, 1], 'a whole round in last place: 120 XP, level 3');
      r = await post('/api/run/start', {}, sec4); backdate(r.body.runId, 250);
      r = await post('/api/run/end', { runId: r.body.runId, survived: 200, place: 4, of: 7, bestRank: 999 }, sec4);
      assert.deepEqual([r.body.xpGained, r.body.levelUp], [40 + 30, 0], 'the client may claim less than the server saw');
      assert.deepEqual([r.body.stats.played, r.body.stats.rounds, r.body.stats.wins, r.body.stats.podiums, r.body.stats.alive], [3, 3, 1, 1, 415 + 600 + 200], 'the 15 s life is not counted; last and 4th place are not podiums; time alive adds up, a life up to one round (600 s)');
      // trophies come only from lives: a rating raised some other way waits for the next competitive life, which wins every step up to it
      const won = r.body.trophies, h4 = require('crypto').createHash('sha256').update(sec4).digest('hex'); db.prepare('UPDATE players SET rating = 1850 WHERE secret = ?').run(h4);
      r = await post('/api/session', { secret: sec4 }); assert.deepEqual(r.body.trophies, won, 'not at a session');
      r = await post('/api/run/start', {}, sec4); r = await post('/api/run/end', { runId: r.body.runId, survived: 0, bestRank: 999 }, sec4);
      assert.deepEqual(r.body.trophies.map(t => t.step), ['amoeba', 'colony', 'interphase', 'prophase', 'metaphase', 'anaphase'], 'a life from Anaphase III wins every step up to Anaphase, even when it loses rating');
      assert.deepEqual(r.body.trophies.slice(0, won.length), won, 'the ones already won keep their date'); assert.ok(r.body.rating < 1850 && r.body.stats.peak === 1850, 'a loss lowers the rating, not the peak');
      r = await post('/api/run/start', {}, sec4); r = await post('/api/run/end', { runId: r.body.runId, survived: 0, bestRank: 999 }, sec4); assert.equal(r.body.trophies.length, 6, 'nor the trophies');
      db.close();
      r = await post('/api/session', { secret: sec4 }); assert.deepEqual([r.body.xp, r.body.level, r.body.levelXp], [374, 3, 124], 'XP is stored');
    } else console.log('(JSON store: skipping the backdated XP lives)');
    r = await post('/api/account/delete', { confirm: 'DELETE' }, sec4); assert.equal(r.body.deleted, true);
  }

  r = await post('/api/skins/buy', { skinId: 9 }, secret); assert.equal(r.status, 402, 'cannot afford yet');

  // Purchases: with IAP_UNVERIFIED the server trusts the receipt's payload (dev only)
  const jws = 'h.' + Buffer.from(JSON.stringify({ productId: 'atp_500', transactionId: 't1' })).toString('base64url') + '.s';
  r = await post('/api/iap/apple', { transactionId: 't1', jws }, secret); assert.equal(r.status, 200); assert.equal(r.body.credited, 500); assert.equal(r.body.balance, 500);
  r = await post('/api/iap/apple', { transactionId: 't1', jws }, secret); assert.equal(r.body.duplicate, true); assert.equal(r.body.balance, 500, 'same transaction credits once');
  r = await post('/api/iap/google', { purchaseToken: 'tok1', productId: 'atp_1500', orderId: 'GPA.1' }, secret); assert.equal(r.body.credited, 1500); assert.equal(r.body.balance, 2000);
  r = await post('/api/iap/google', { purchaseToken: 'tok2', productId: 'not_a_pack', orderId: 'GPA.2' }, secret); assert.equal(r.status, 400, 'unknown product rejected');

  r = await post('/api/skins/buy', { skinId: 9 }, secret); assert.equal(r.status, 200); assert.deepEqual(r.body.skins, [9]); assert.equal(r.body.balance, 1700);
  r = await post('/api/skins/buy', { skinId: 9 }, secret); assert.equal(r.body.already, true); assert.equal(r.body.balance, 1700, 'owned skins are not sold twice');
  r = await post('/api/skins/buy', { skinId: 99 }, secret); assert.equal(r.status, 404);

  r = await post('/api/session', { secret }); assert.equal(r.body.balance, 1700); assert.deepEqual(r.body.skins, [9], 'wallet persists');
  assert.equal(r.body.account, null, 'device-only wallet has no account');
  r = await post('/api/session', { secret: 'short' }); assert.equal(r.status, 400);

  // Sign in with Apple: the token must be signed by Apple's key, for this app, unexpired, and carry our nonce
  const nowS = Math.floor(Date.now() / 1000);
  const apple = (over = {}) => signToken({ iss: 'https://appleid.apple.com', aud: 'com.mitosisgame.app', sub: 'apple-user-1', email: 'cell@example.com', iat: nowS, exp: nowS + 600, nonce: sha256('n1'), ...over });
  r = await post('/api/auth/apple', { identityToken: apple(), nonce: 'n1' }, secret);
  assert.equal(r.status, 200); assert.equal(r.body.account.provider, 'apple'); assert.equal(r.body.account.email, 'cell@example.com'); assert.equal(r.body.balance, 1700); assert.equal(r.body.merged, false);
  r = await post('/api/auth/apple', { identityToken: apple({ aud: 'com.other.app' }), nonce: 'n1' }, secret); assert.equal(r.status, 401, 'token for another app rejected');
  r = await post('/api/auth/apple', { identityToken: apple({ exp: nowS - 600 }), nonce: 'n1' }, secret); assert.equal(r.status, 401, 'expired token rejected');
  r = await post('/api/auth/apple', { identityToken: apple({ iss: 'https://evil.example' }), nonce: 'n1' }, secret); assert.equal(r.status, 401, 'other issuer rejected');
  r = await post('/api/auth/apple', { identityToken: apple(), nonce: 'wrong' }, secret); assert.equal(r.status, 401, 'nonce mismatch rejected');
  r = await post('/api/auth/apple', { identityToken: apple().slice(0, -6) + 'AAAAAA', nonce: 'n1' }, secret); assert.equal(r.status, 401, 'tampered signature rejected');
  r = await post('/api/auth/apple', { identityToken: 'not.a.token', nonce: 'n1' }, secret); assert.equal(r.status, 401);
  r = await post('/api/session', { secret }); assert.equal(r.body.account.provider, 'apple', 'the account shows on every session');
  const acctXp = r.body.xp, acctStats = r.body.stats, acctTrophies = r.body.trophies; assert.ok(acctXp > 0, 'the account has XP from its runs'); assert.ok(acctTrophies.length > 0);

  // A second device signs in with the same Apple account: it joins the account and brings its own ATP along
  const secret2 = 'secondsecret' + 'b'.repeat(20);
  r = await post('/api/session', { secret: secret2 }); assert.equal(r.body.balance, 0); assert.equal(r.body.account, null);
  r = await post('/api/iap/google', { purchaseToken: 'tok3', productId: 'atp_500', orderId: 'GPA.3' }, secret2); assert.equal(r.body.balance, 500);
  r = await post('/api/run/start', {}, secret2); r = await post('/api/run/end', { runId: r.body.runId, survived: 9999, eaten: 0, peak: 25, bestRank: 999 }, secret2); assert.equal(r.body.xp, 2); const dev2 = r.body;
  r = await post('/api/font', { font: 30 }, secret2); assert.equal(r.body.nameFont, 30);
  r = await post('/api/auth/apple', { identityToken: apple(), nonce: 'n1' }, secret2);
  assert.equal(r.status, 200); assert.equal(r.body.merged, true); assert.equal(r.body.balance, 2200, 'the two wallets merge'); assert.equal(r.body.xp, acctXp + 2, 'and so does their XP');
  assert.deepEqual(r.body.stats, { ...Object.fromEntries(['played', 'rounds', 'wins', 'podiums', 'alive', 'eaten'].map(k => [k, acctStats[k] + dev2.stats[k]])), peak: Math.max(acctStats.peak, dev2.stats.peak, r.body.rating) }, 'and their lifetime stats');
  assert.deepEqual(r.body.trophies, acctTrophies, 'trophies both had keep the earlier date'); assert.ok(dev2.trophies[0].at >= acctTrophies[0].at); assert.deepEqual(r.body.skins, [9]); assert.equal(r.body.account.provider, 'apple');
  r = await post('/api/session', { secret: secret2 }); assert.equal(r.body.balance, 2200, 'the second device now opens the account'); assert.equal(r.body.nameFont, 12, 'the account keeps its own font');
  r = await post('/api/session', { secret }); assert.equal(r.body.balance, 2200, 'and so does the first');
  r = await post('/api/skins/buy', { skinId: 10 }, secret2); assert.equal(r.status, 200); assert.equal(r.body.balance, 1850, 'the joined device can spend');
  r = await post('/api/session', { secret }); assert.deepEqual(r.body.skins, [9, 10], 'both devices see the same skins');

  // Sign in with Google on a device that already belongs to an Apple account: Google is linked to that same wallet
  const google = (over = {}) => signToken({ iss: 'https://accounts.google.com', aud: 'test-google-client', sub: 'google-user-1', email: 'cell@gmail.com', email_verified: true, iat: nowS, exp: nowS + 600, nonce: 'n2', ...over });
  r = await post('/api/auth/google', { idToken: google(), nonce: 'n2' }, secret); assert.equal(r.status, 200); assert.equal(r.body.balance, 1850); assert.equal(r.body.account.provider, 'apple', 'the first sign-in stays the account label');
  r = await post('/api/auth/google', { idToken: google({ aud: 'someone-elses-client' }), nonce: 'n2' }, secret); assert.equal(r.status, 401, 'Google token for another client rejected');
  // ...and a fresh device signing in with that Google account lands in the same wallet
  const secret3 = 'thirdsecret' + 'c'.repeat(21);
  r = await post('/api/session', { secret: secret3 }); assert.equal(r.body.balance, 0);
  r = await post('/api/auth/google', { idToken: google(), nonce: 'n2' }, secret3); assert.equal(r.body.merged, true); assert.equal(r.body.balance, 1850);

  // Signing out detaches the device; the account keeps the wallet
  r = await post('/api/auth/signout', {}, secret2); assert.equal(r.body.ok, true);
  r = await post('/api/session', { secret: secret2 }); assert.equal(r.body.balance, 0, 'a signed-out device starts fresh'); assert.equal(r.body.account, null);
  r = await post('/api/session', { secret }); assert.equal(r.body.balance, 1850, 'the account is untouched');
  r = await post('/api/auth/signout', {}, secret); r = await post('/api/session', { secret }); assert.equal(r.body.balance, 1850, 'the original device secret still opens the account');

  // Crash reports from the apps are logged and kept as files
  r = await post('/api/crash', { platform: 'ios', kind: 'signal', app: '2.2.0 (4)', os: 'iOS 26', device: 'iPhone14,7', report: 'signal 11\n0 Mitosis 0x1 main + 42' });
  assert.equal(r.status, 200); assert.ok(/^.*-ios-signal\.txt$/.test(r.body.saved), 'report file named by platform and kind');
  assert.ok(fs.readFileSync(path.join(dataDir, 'crashes', r.body.saved), 'utf8').includes('main + 42'), 'report body stored');
  r = await post('/api/crash', { platform: '../x', kind: 'a b', report: 'x' }); assert.ok(/^.*-x-ab\.txt$/.test(r.body.saved), 'file name is sanitised');

  // Deleting the account removes it everywhere; receipts survive anonymously so they cannot be replayed
  r = await post('/api/account/delete', {}, secret); assert.equal(r.status, 400, 'deletion needs an explicit confirmation');
  r = await post('/api/account/delete', { confirm: 'DELETE' }); assert.equal(r.status, 401, 'deletion needs the player');
  r = await post('/api/account/delete', { confirm: 'DELETE' }, secret); assert.equal(r.status, 200); assert.equal(r.body.deleted, true);
  r = await post('/api/session', { secret: secret3 }); assert.equal(r.body.balance, 0, 'a device that had joined the account starts fresh'); assert.equal(r.body.account, null); assert.deepEqual(r.body.skins, []);
  assert.deepEqual([r.body.xp, r.body.level], [0, 1], 'the XP went with the account'); assert.deepEqual([r.body.trophies, r.body.stats.alive], [[], 0], 'and so did the trophies and stats');
  r = await post('/api/iap/apple', { transactionId: 't1', jws }, secret3); assert.equal(r.body.duplicate, true, 'an old receipt cannot be credited again after deletion'); assert.equal(r.body.balance, 0);
  r = await post('/api/auth/apple', { identityToken: apple(), nonce: 'n1' }, secret3); assert.equal(r.status, 200); assert.equal(r.body.merged, false, 'the Apple ID no longer leads to the deleted account'); assert.equal(r.body.balance, 0);
  { const lb = await (await fetch(base + '/api/leaderboard')).json(); assert.ok(Array.isArray(lb.top) && lb.top.every(t => t.runs !== undefined), 'leaderboard still answers'); assert.equal(lb.top.length, 0, 'the deleted player is gone from the leaderboard'); }

  { // Battle pass: hidden until switched on; ranked XP fills it on the server; Battle Stars claim each reward once; the Battle Pass (premium) costs ATP
    const { PASS, PASS_SEASONS, passSeason, SKINS } = require('./economy'), s1 = PASS_SEASONS[0], all = s1.pages.flatMap(p => p.rewards), at = Date.parse;
    assert.equal(passSeason(at('2026-11-15T23:59:59Z')), null, 'no season before its first day'); assert.equal(passSeason(at('2026-11-16T00:00:00Z')).key, 's1', 'season 1 from its first day (UTC)');
    assert.equal(passSeason(at('2026-12-27T23:59:59Z')).key, 's1'); assert.equal(passSeason(at('2026-12-28T00:00:00Z')), null, 'and over on its end date');
    assert.equal(new Set(all.map(r => r.id)).size, all.length, 'every reward has its own place'); assert.ok(all.every(r => (r.atp > 0) !== !!r.skin && r.stars >= 0), 'each reward is ATP or a skin');
    for (const r of all.filter(r => r.skin)) assert.ok(SKINS.some(k => k.id === r.skin), 'reward skin ' + r.skin + ' is a real skin');
    assert.deepEqual(SKINS.filter(k => k.pass === 's1').map(k => k.id).sort(), all.map(r => r.skin).filter(id => id && SKINS.find(k => k.id === id).pass).sort(), 'each season 1 skin is on its pass exactly once');
    assert.ok(s1.pages.filter(p => !p.bonus).flatMap(p => p.rewards).filter(r => !r.free).reduce((n, r) => n + (r.atp || 0), 0) >= PASS.premium, 'the Battle Pass pays back its price on pages 1-5');
    assert.ok(all.some(r => r.free && r.skin) && all.some(r => !r.free), 'free and premium rewards, with a skin for free players');

    const token = fs.readFileSync(path.join(dataDir, 'admin-token'), 'utf8').trim(), store = (await (await fetch(base + '/health')).json()).store;
    const flip = async on => (await fetch(base + '/admin/pass?token=' + token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'on=' + (on ? 1 : 0), redirect: 'manual' })).status;
    const admin = async () => (await fetch(base + '/admin/pass?format=json&token=' + token)).json();
    const atp = async (sec, n) => post('/api/iap/google', { purchaseToken: 'bp-' + n, productId: 'atp_5000', orderId: 'GPA.bp.' + n }, sec);
    // this block's requests come from their own address, so the API limit (120 a minute per address) counts them apart from the rest
    const post = async (url, body, secret) => { const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.9' }; if (secret) headers.Authorization = 'Bearer ' + secret;
      const res = await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body || {}) }); return { status: res.status, body: await res.json() }; };
    const sp = 'passsecret' + 'p'.repeat(22), sq = 'passsecret' + 'q'.repeat(22);
    // off: not in the catalogue or the wallet, nothing to claim or buy, and lives add nothing to it
    assert.equal((await fetch(base + '/admin/pass')).status, 403, 'the switch needs the token');
    assert.equal((await fetch(base + '/admin/pass?token=wrong', { method: 'POST', body: 'on=1' })).status, 403, 'and so does flipping it');
    let a = await admin(); assert.deepEqual([a.on, a.live, a.season.key, a.season.premium], [false, false, 's1', PASS.premium], 'the pass starts off, with season 1 on the calendar');
    assert.match(await (await fetch(base + '/admin/pass?token=' + token)).text(), /Off \(hidden\)[\s\S]*Turn on/, 'the switch page says it is off');
    r = await post('/api/session', { secret: sp }); assert.equal(r.body.pass, null, 'no pass in the wallet while off'); assert.equal(r.body.catalog.pass, null, 'nor in the catalogue');
    assert.equal((await (await fetch(base + '/api/catalog')).json()).pass, null);
    for (const [u, b] of [['/api/pass', {}], ['/api/pass/claim', { reward: '1b' }], ['/api/pass/premium', {}]]) if (u !== '/api/pass') assert.equal((await post(u, b, sp)).status, 404, u + ' is closed while off');
    r = await post('/api/run/start', {}, sp); r = await post('/api/run/end', { runId: r.body.runId, survived: 9999 }, sp); assert.deepEqual([r.body.xpGained, r.body.passUp, r.body.pass], [2, 0, null], 'XP while off goes to the profile only');
    // on: everyone has the free pass
    assert.equal(await flip(true), 303); a = await admin(); assert.deepEqual([a.on, a.live], [true, true], 'switched on');
    assert.match(await (await fetch(base + '/admin/pass?token=' + token)).text(), /Live[\s\S]*Turn off/);
    r = await post('/api/session', { secret: sp }); const C = r.body.catalog.pass;
    assert.deepEqual([C.key, C.premium, C.bundle, C.levelXp, C.stars, C.pages.length, C.ends], ['s1', PASS.premium, PASS.bundle, PASS.levelXp, PASS.stars, s1.pages.length, at('2026-12-28')], 'the season and its pages are in the catalogue');
    assert.deepEqual(r.body.pass, { season: 's1', xp: 0, level: 1, stars: 5, premium: false, claimed: [], pages: 1, claimable: 2 }, 'level 1 with 5 stars, page 1 open, its two free rewards in reach');
    // progress: the XP the server counts for a ranked life, never anything the client sends
    r = await post('/api/run/start', {}, sp); r = await post('/api/run/end', { runId: r.body.runId, survived: 9999, place: 1, of: 20, xp: 9000, passXp: 9000, level: 30 }, sp);
    assert.deepEqual([r.body.xpGained, r.body.pass.xp, r.body.passUp], [2, 2, 0], 'the pass gets the same XP as the profile');
    r = await post('/api/pass', { xp: 9000, level: 30, stars: 500, premium: true }, sp); assert.deepEqual([r.body.pass.xp, r.body.pass.stars, r.body.pass.premium], [2, 5, false], 'the client cannot set its own progress');
    r = await post('/api/run/end', { runId: (await post('/api/run/start', {}, sp)).body.runId, survived: 5 }, sp); const rid = r.body;
    if (store === 'sqlite') {
      const db = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'mitosis.sqlite')), backdate = (id, s) => db.prepare('UPDATE runs SET started = started - ? WHERE id = ?').run(s * 1000, id);
      r = await post('/api/run/start', {}, sp); backdate(r.body.runId, 400); r = await post('/api/run/end', { runId: r.body.runId, survived: 9999, place: 1, of: 20 }, sp);
      // (lives this long finish quests too, which add their XP to the pass: the quest block below checks which)
      const lvl = xp => 1 + Math.floor(xp / PASS.levelXp);
      assert.deepEqual([r.body.xpGained, r.body.pass.xp, r.body.passUp], [182, rid.pass.xp + 182 + r.body.questXp, lvl(rid.pass.xp + 182 + r.body.questXp) - lvl(rid.pass.xp)], 'a won life of 400 s');
      const won = r.body.pass, long = (await post('/api/run/start', {}, sp)).body.runId; backdate(long, 2000); r = await post('/api/run/end', { runId: long, survived: 9999, place: 20, of: 20 }, sp);
      assert.deepEqual([r.body.xpGained, r.body.pass.xp, r.body.passUp], [120, won.xp + 120 + r.body.questXp, lvl(won.xp + 120 + r.body.questXp) - won.level], 'a whole round in last place');
      assert.deepEqual([r.body.pass.level, r.body.pass.stars], [won.level + r.body.passUp, (won.level + r.body.passUp) * PASS.stars], 'each level gives 5 more stars');
      const lvLong = r.body.pass.level;
      r = await post('/api/run/end', { runId: long, survived: 9999, place: 1, of: 20 }, sp); assert.equal(r.body.duplicate, true); assert.equal(r.body.pass.level, lvLong, 'a repeated run/end adds nothing');
      db.prepare("UPDATE pass SET xp = 0 WHERE player = ?").run(r.body.playerId); db.close(); // back to level 1 for the claims below
    } else console.log('(JSON store: skipping the backdated pass XP)');
    // claiming: open page, free (or the Battle Pass), enough stars, once
    r = await post('/api/session', { secret: sp }); let bal = r.body.balance;
    r = await post('/api/pass/claim', { reward: '1b' }, sp); assert.deepEqual(r.body.claimed, { reward: '1b', atp: 100, skin: null, refund: 0 }, 'a free reward');
    assert.deepEqual([r.body.balance, r.body.earned >= 100, r.body.pass.stars, r.body.pass.claimed], [bal + 100, true, 1, ['1b']], 'pays its ATP and spends its stars');
    r = await post('/api/pass/claim', { reward: '1b' }, sp); assert.equal(r.body.already, true); assert.equal(r.body.balance, bal + 100, 'a reward pays once');
    r = await post('/api/pass/claim', { reward: '1f' }, sp); assert.equal(r.status, 402, 'not enough stars'); assert.match(r.body.error, /3 more Battle Stars/);
    r = await post('/api/pass/claim', { reward: '1a' }, sp); assert.equal(r.status, 403, 'premium rewards need the Battle Pass'); assert.match(r.body.error, /Battle Pass/);
    r = await post('/api/pass/claim', { reward: '2c' }, sp); assert.equal(r.status, 403, 'page 2 is locked'); assert.match(r.body.error, /page 2/);
    for (const reward of ['zz', '', '9a', undefined]) assert.equal((await post('/api/pass/claim', { reward }, sp)).status, 404, 'no reward ' + reward);
    r = await post('/api/skins/buy', { skinId: 31 }, sp); assert.equal(r.status, 403, 'pass skins are not for sale'); assert.match(r.body.error, /battle pass/);
    // the Battle Pass: ATP, once a season; stars already earned count straight away
    r = await post('/api/pass/premium', {}, sp); assert.equal(r.status, 402, 'the Battle Pass costs ATP');
    await atp(sp, 1); r = await post('/api/session', { secret: sp }); bal = r.body.balance;
    r = await post('/api/pass/premium', {}, sp); assert.deepEqual([r.body.unlocked, r.body.balance, r.body.pass.premium], [true, bal - PASS.premium, true], 'bought for its price');
    r = await post('/api/pass/premium', { bundle: true }, sp); assert.deepEqual([r.body.already, r.body.balance, r.body.pass.level], [true, bal - PASS.premium, 1], 'and only once');
    r = await post('/api/pass/claim', { reward: '1a' }, sp); assert.deepEqual([r.body.claimed.skin, r.body.skins.includes(29), r.body.pass.stars], [29, true, 1], 'Sea Sparkle for 0 stars');
    a = await admin(); assert.deepEqual([a.stats.premium, a.stats.claims], [1, 2], 'the switch page counts buyers and claims');
    // the Battle Bundle: the pass plus 10 levels; pages open by level or by claiming on the page before; a skin you own pays its price
    await post('/api/session', { secret: sq }); await atp(sq, 2); r = await post('/api/skins/buy', { skinId: 18 }, sq); assert.ok(r.body.skins.includes(18), 'owns Koi already');
    r = await post('/api/pass/premium', { bundle: true }, sq); assert.deepEqual([r.body.bundle, r.body.balance, r.body.pass.xp, r.body.pass.level, r.body.pass.stars, r.body.pass.pages], [true, 5000 - 500 - PASS.bundle, PASS.bundleLevels * PASS.levelXp, 11, 55, 2], 'level 11 at once, page 2 open by level');
    const five = await Promise.all([1, 2, 3, 4, 5].map(() => post('/api/pass/claim', { reward: '1c' }, sq)));
    assert.equal(five.filter(x => x.body.claimed).length, 1, 'five claims at once pay once'); r = await post('/api/session', { secret: sq }); assert.deepEqual([r.body.balance, r.body.pass.stars], [150, 51]);
    r = await post('/api/pass/claim', { reward: '1d' }, sq); assert.deepEqual(r.body.claimed, { reward: '1d', atp: 500, skin: null, refund: 500 }, 'Koi, owned already, pays its 500 ATP instead');
    assert.equal(r.body.skins.filter(id => id === 18).length, 1);
    r = await post('/api/pass/claim', { reward: '3a' }, sq); assert.equal(r.status, 403, 'page 3 waits for level 12');
    for (const id of ['2a', '2b', '2c']) { r = await post('/api/pass/claim', { reward: id }, sq); assert.ok(r.body.claimed, id); }
    assert.equal(r.body.pass.pages, 2, 'three claims on page 2 are not enough');
    r = await post('/api/pass/claim', { reward: '2d' }, sq); assert.equal(r.body.pass.pages, 3, 'the fourth opens page 3');
    r = await post('/api/pass/claim', { reward: '3a' }, sq); assert.equal(r.body.claimed.skin, 30, 'Radiolarian');
    assert.equal(r.body.pass.stars, 55 - 4 - 5 - 5 - 6 - 5 - 5 - 8, 'stars are what the levels gave less what was spent');
    r = await post('/api/pass/claim', { reward: '4a' }, sq); assert.equal(r.status, 403, 'page 4 stays shut');
    // off again: hidden and frozen, with progress kept for when it comes back
    assert.equal(await flip(false), 303); r = await post('/api/session', { secret: sq }); assert.equal(r.body.pass, null); assert.equal(r.body.catalog.pass, null);
    assert.equal((await post('/api/pass/claim', { reward: '1e' }, sq)).status, 404, 'no claims while off');
    r = await post('/api/run/start', {}, sq); r = await post('/api/run/end', { runId: r.body.runId, survived: 9999 }, sq); assert.equal(r.body.passUp, 0);
    assert.equal(await flip(true), 303); r = await post('/api/session', { secret: sq }); assert.deepEqual([r.body.pass.xp, r.body.pass.claimed.length, r.body.pass.premium], [3000, 7, true], 'on again: progress kept, nothing added while off');
    // old apps: the fields they read are all still there, and they never see the new ones
    r = await post('/api/run/start', {}, sq); r = await post('/api/run/end', { runId: r.body.runId, survived: 30, eaten: 1, peak: 40, bestRank: 3, place: 5, of: 9, life: 0, show: 1, name: 'Old app' }, sq);
    for (const k of ['payout', 'ratingDelta', 'balance', 'earned', 'skins', 'rating', 'tier', 'runs', 'playerId']) assert.ok(k in r.body, 'run/end still sends ' + k);
    // merging accounts: the pass XP adds up, the claims join, the Battle Pass stays; deleting the account removes it all
    r = await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-pass' }), nonce: 'n1' }, sp); assert.equal(r.body.merged, false);
    const px = (await post('/api/pass', {}, sp)).body.pass;
    r = await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-pass' }), nonce: 'n1' }, sq); assert.equal(r.body.merged, true);
    assert.deepEqual([r.body.pass.xp, r.body.pass.premium, [...r.body.pass.claimed].sort()], [px.xp + 3002, true, [...px.claimed, '1c', '1d', '2a', '2b', '2c', '2d', '3a'].sort()], 'merged: XP added, claims joined');
    assert.ok([29, 30, 18].every(id => r.body.skins.includes(id)), 'and the skins');
    r = await post('/api/pass/claim', { reward: '1b' }, sq); assert.equal(r.body.already, true, 'a reward claimed on either device stays claimed');
    const before = (await admin()).stats.players;
    r = await post('/api/account/delete', { confirm: 'DELETE' }, sp); assert.equal(r.body.deleted, true);
    assert.equal((await admin()).stats.players, before - 1, 'deleting the account deletes its pass');
    r = await post('/api/session', { secret: sq }); assert.deepEqual([r.body.pass.xp, r.body.pass.claimed, r.body.pass.premium], [0, [], false], 'a device of the deleted account starts a fresh pass');
    r = await post('/api/account/delete', { confirm: 'DELETE' }, sq); assert.equal(r.body.deleted, true);
    assert.equal(await flip(false), 303);
  }
  { // Quests: daily, weekly and permanent goals for ranked lives, counted on the server and shown without the battle pass; a finished quest waits to be claimed, then pays its ATP (and pass XP while the pass is live) once
    const { QUESTS, questsAt, PASS, PERMANENT, PERM_ATP } = require('./economy'), at = Date.parse, today = at('2026-11-20T12:00:00Z');
    const token = fs.readFileSync(path.join(dataDir, 'admin-token'), 'utf8').trim(), store = (await (await fetch(base + '/health')).json()).store;
    const form = async body => (await fetch(base + '/admin/pass?token=' + token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' })).status;
    const flip = on => form('on=' + (on ? 1 : 0)), flipQuests = on => form('quests=' + (on ? 1 : 0));
    const admin = async () => (await fetch(base + '/admin/pass?format=json&token=' + token)).json();
    const post = async (url, body, secret) => { const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.8' }; if (secret) headers.Authorization = 'Bearer ' + secret;
      const res = await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body || {}) }); return { status: res.status, body: await res.json() }; };
    const sx = 'questsecret' + 'x'.repeat(21), sy = 'questsecret' + 'y'.repeat(21), D = questsAt('day', today), W = questsAt('week', today);
    const find = (w, id) => [...w.quests.daily.quests, ...w.quests.weekly.quests].find(q => q.id === id), line = (w, id) => w.quests.permanent.find(q => q.line === id);
    const life = async (secret, body, mode) => post('/api/run/end', { runId: (await post('/api/run/start', mode ? { mode } : {}, secret)).body.runId, claims: 1, ...body }, secret); // claims: 1, as pages with the Claim button send
    const claim = (secret, body) => post('/api/quests/claim', body, secret);
    assert.deepEqual([QUESTS.atp, QUESTS.xp, PERM_ATP], [{ day: 30, week: 100 }, { day: 100, week: 300 }, [100, 300, 1000, 3000]], 'Rowan\'s choice: 30 / 100 ATP, 100 / 300 pass XP, permanent tiers 100 to 3,000 ATP');
    // on from the start, with the battle pass off: four for the day, seven for the week, the permanent ladders; the same for everyone
    r = await post('/api/session', { secret: sx }); let Q = r.body.quests;
    assert.deepEqual([r.body.pass, (await admin()).quests.on], [null, true], 'the pass is off, quests are on');
    assert.deepEqual([Q.daily.key, Q.daily.ends, Q.daily.period, Q.weekly.key, Q.weekly.ends, Q.weekly.period], ['2026-11-20', at('2026-11-21'), D.period, '2026-W47', at('2026-11-23'), W.period], 'today (UTC) and this ISO week, with when each ends');
    assert.deepEqual(Q.daily.quests.map(q => [q.id, q.text, q.goal, q.atp, q.xp, q.done, q.claimed]), D.list.map(q => [q.id, q.text, q.goal, 30, 0, false, false]), 'the day\'s quests: 30 ATP each, no pass XP while the pass is off');
    assert.deepEqual(Q.weekly.quests.map(q => [q.id, q.goal, q.atp, q.xp]), W.list.map(q => [q.id, q.goal, 100, 0]), 'the week\'s: 100 ATP each');
    assert.deepEqual(Q.permanent.map(q => [q.id, q.tier, q.tiers, q.progress, q.goal, q.atp, q.done]), PERMANENT.map(L => [L.id + '-1', 1, 4, 0, L.tiers[0], 100, false]), 'each permanent ladder at its first tier');
    assert.deepEqual([Q.earlier, Q.claimable], [[], 0], 'nothing waiting');
    assert.deepEqual((await post('/api/session', { secret: sy })).body.quests.daily.quests.map(q => q.id), Q.daily.quests.map(q => q.id), 'another player has the same quests');
    // the client's claims are not believed: a "long winning life" sent right after starting is 15 s on the server's clock
    const dLives = D.list.find(q => q.kind === 'lives'), wTime = W.list.find(q => q.kind === 'time'), wLives = W.list.find(q => q.kind === 'lives'), wWin = W.list.find(q => q.kind === 'win');
    r = await life(sx, { survived: 9999, place: 1, of: 10, eaten: 50, quests: 99, questXp: 5000 });
    assert.deepEqual([r.body.questXp, find(r.body, dLives.id).progress, find(r.body, wTime.id).progress, line(r.body, 'lives').progress, line(r.body, 'eaten').progress, line(r.body, 'wins').progress], [0, 0, 0, 0, 0, 0],
      'a 15 s life is not a life: no life, time, cells or placing');
    r = await post('/api/pass', { quests: { daily: { quests: [] } }, questXp: 9000 }, sx); assert.equal(find(r.body, dLives.id).progress, 0, 'the client cannot set its quests');
    for (const [b, status, why] of [[{ period: D.period, id: dLives.id }, 409, 'not finished'], [{ period: D.period, id: 'nope-1' }, 404, 'no such quest'], [{ period: 'x', id: dLives.id }, 404, 'no such period'],
      [{ period: 'perm', id: 'lives-1' }, 409, 'a tier not reached'], [{ period: 'perm', id: 'lives-9' }, 404, 'no such tier'], [{}, 404, 'nothing named']]) assert.equal((await claim(sx, b)).status, status, 'claim: ' + why);
    assert.equal((await post('/api/quests/claim', { all: true })).status, 401, 'claiming needs the player');
    // casual lives count for no quests (endless lives)
    r = await life(sx, { survived: 9999 }, 'casual'); assert.deepEqual([find(r.body, dLives.id).progress, line(r.body, 'lives').progress], [0, 0], 'casual counts for nothing');
    if (store === 'sqlite') {
      const db = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'mitosis.sqlite'));
      const lifeFor = async (secret, sec, body = {}) => { const id = (await post('/api/run/start', {}, secret)).body.runId; db.prepare('UPDATE runs SET started = started - ? WHERE id = ?').run(sec * 1000, id);
        return post('/api/run/end', { runId: id, survived: sec, claims: 1, ...body }, secret); };
      // progress: lives of 25 s move the lives and time quests; the one that reaches the goal finishes it, and nothing is paid until it is claimed
      for (let i = 1; i < dLives.goal; i++) { r = await lifeFor(sx, 25); assert.deepEqual([r.body.questsDone, find(r.body, dLives.id).progress, find(r.body, dLives.id).done], [[], i, false], 'life ' + i); }
      assert.equal(find(r.body, wTime.id).progress, 25 * (dLives.goal - 1), 'time adds up across lives');
      const bal0 = r.body.balance, last = (await post('/api/run/start', {}, sx)).body.runId; db.prepare('UPDATE runs SET started = started - 25000 WHERE id = ?').run(last);
      r = await post('/api/run/end', { runId: last, survived: 25, claims: 1 }, sx);
      assert.deepEqual(r.body.questsDone, [{ id: dLives.id, text: dLives.text, atp: 30, xp: 0, kind: 'day', period: D.period }], 'the life that finishes it says so');
      assert.deepEqual([find(r.body, dLives.id).done, find(r.body, dLives.id).claimed, r.body.quests.claimable, r.body.balance - bal0], [true, false, 1, r.body.payout], 'it waits to be claimed: nothing paid but the life\'s own ATP');
      assert.equal(find(r.body, wLives.id).progress, dLives.goal, 'the week counts the same lives');
      r = await post('/api/run/end', { runId: last, survived: 25, claims: 1 }, sx); assert.deepEqual([r.body.duplicate, r.body.quests.claimable], [true, 1], 'a repeated run/end finishes nothing more');
      // claiming: pays its ATP once, even when asked five times at once
      const bal1 = r.body.balance, earned1 = r.body.earned;
      const five = await Promise.all([1, 2, 3, 4, 5].map(() => claim(sx, { period: D.period, id: dLives.id })));
      assert.equal(five.filter(x => x.body.claimed && x.body.claimed.length).length, 1, 'five claims at once pay once');
      r = await post('/api/session', { secret: sx }); assert.deepEqual([r.body.balance, r.body.earned, find(r.body, dLives.id).claimed, r.body.quests.claimable], [bal1 + 30, earned1 + 30, true, 0], '30 ATP, claimed');
      r = await claim(sx, { period: D.period, id: dLives.id }); assert.deepEqual([r.body.already, r.body.balance], [true, bal1 + 30], 'and only once');
      // placings count with 4 or more in the round, like XP; a win moves every top-N quest on, and the lifetime wins and top 3
      r = await lifeFor(sx, 30, { place: 1, of: 3 }); assert.ok(r.body.quests.weekly.quests.filter(q => q.kind === 'top' || q.kind === 'win').every(q => q.progress === 0) && line(r.body, 'wins').progress === 0, 'a win among 3 does not count');
      r = await lifeFor(sx, 30, { place: 1, of: 10, eaten: 9999 }); const tops = [...r.body.quests.daily.quests, ...r.body.quests.weekly.quests].filter(q => q.kind === 'top' || q.kind === 'win');
      assert.ok(tops.length >= 2 && tops.every(q => q.progress === 1 && q.done === (q.goal === 1)), 'a win among 10: one for each top-N and win quest, done where one is enough');
      assert.deepEqual(r.body.questsDone.map(q => q.id).sort(), tops.filter(q => q.goal === 1).map(q => q.id).sort(), 'and says which it finished');
      assert.deepEqual([line(r.body, 'wins').total, line(r.body, 'top3').total, line(r.body, 'eaten').total], [1, 1, 10 + Math.floor(30 / 60 * 15)], 'lifetime: a win, a top 3, and cells capped by the life\'s length');
      assert.ok(r.body.questTiers.some(q => q.id === 'wins-1'), 'the first win reaches the first wins tier');
      // the battle pass on: daily and weekly quests also pay pass XP when claimed
      assert.equal(await flip(true), 303); r = await post('/api/session', { secret: sx }); const pass0 = r.body.pass.xp, bal2 = r.body.balance;
      assert.deepEqual([find(r.body, wWin.id).xp, line(r.body, 'wins').atp], [300, 100], 'pass XP shows while the pass is live');
      assert.equal(wWin.goal, 1, 'this week\'s win quest takes one win');
      r = await claim(sx, { period: W.period, id: wWin.id }); assert.deepEqual([r.body.atp, r.body.xp, r.body.balance, r.body.pass.xp], [100, 300, bal2 + 100, pass0 + 300], 'a weekly quest: 100 ATP and 300 pass XP');
      // claim all: everything ready, permanent tiers too; the ladder moves on to its next tier
      r = await post('/api/session', { secret: sx }); const ready = r.body.quests.claimable, bal3 = r.body.balance;
      assert.ok(ready >= 2 && line(r.body, 'wins').done, 'some daily and permanent rewards are ready');
      r = await claim(sx, { all: true }); assert.equal(r.body.claimed.length, ready, 'claim all takes every one');
      assert.ok(r.body.claimed.some(c => c.period === 'perm' && c.id === 'wins-1' && c.atp === 100), 'including the first wins tier, 100 ATP');
      assert.deepEqual([r.body.balance, r.body.quests.claimable, line(r.body, 'wins').tier, line(r.body, 'wins').goal], [bal3 + r.body.atp, 0, 2, 10], 'paid, and wins moves to tier 2: 10 wins');
      assert.equal((await claim(sx, { period: 'perm', id: 'wins-1' })).body.already, true, 'a tier pays once');
      r = await claim(sx, { all: true }); assert.deepEqual([r.body.claimed, r.body.atp, r.body.already], [[], 0, undefined], 'claim all with nothing ready');
      assert.equal(await flip(false), 303);
      // a reward not claimed by the end of its day waits: it shows under earlier and can still be claimed (an old variant id is left out)
      const old = 'd2026-11-19', oldQ = questsAt('day', at('2026-11-19T12:00:00Z')).list[0];
      db.prepare('INSERT INTO quests(player, period, quest, progress, done, at) VALUES(?, ?, ?, ?, ?, ?)').run(r.body.playerId, old, oldQ.id, oldQ.goal, 5, 5);
      db.prepare('INSERT INTO quests(player, period, quest, progress, done, at) VALUES(?, ?, ?, ?, ?, ?)').run(r.body.playerId, old, 'gone-7', 1, 5, 5);
      r = await post('/api/session', { secret: sx }); assert.deepEqual([r.body.quests.earlier, r.body.quests.claimable], [[{ period: old, id: oldQ.id, kind: oldQ.kind, text: oldQ.text, atp: 30, xp: 0, from: 'day', modes: oldQ.modes }], 1], 'yesterday\'s reward waits');
      const bal4 = r.body.balance; r = await claim(sx, { period: old, id: oldQ.id }); assert.deepEqual([r.body.atp, r.body.balance, r.body.quests.earlier], [30, bal4 + 30, []], 'and is paid when claimed');
      assert.equal((await claim(sx, { period: old, id: 'gone-7' })).status, 404, 'a quest that no longer exists cannot be claimed');
      // the switch page counts quests finished today and this week; the quests switch hides them, lifetime totals keep counting
      let a = await admin(); assert.ok(a.stats.quests.today >= 2 && a.stats.quests.week >= 1 && a.quests.today === a.stats.quests.today, 'the switch page counts finished quests');
      assert.match(await (await fetch(base + '/admin/pass?token=' + token)).text(), /<h2>Quests<\/h2>[\s\S]*Turn quests off/);
      const kept = (await post('/api/pass', {}, sx)).body.quests;
      assert.equal(await flipQuests(false), 303); assert.equal((await admin()).quests.on, false);
      r = await lifeFor(sx, 200, { place: 1, of: 10 }); assert.deepEqual([r.body.quests, r.body.questsDone], [null, []], 'off: hidden, and lives finish no quest');
      assert.equal((await claim(sx, { all: true })).status, 404, 'and nothing can be claimed');
      assert.equal(await flipQuests(true), 303); r = await post('/api/pass', {}, sx);
      assert.deepEqual([r.body.quests.daily, r.body.quests.weekly], [kept.daily, kept.weekly], 'on again: daily and weekly just as they were');
      assert.equal(line(r.body, 'lives').total, line({ quests: kept }, 'lives').total + 1, 'the lifetime totals kept counting');
      assert.match(await (await fetch(base + '/admin/pass?token=' + token)).text(), /Turn quests off/);
      // merging: progress and lifetime totals add up; a quest done or claimed on either side stays so and does not pay twice
      r = await lifeFor(sy, 25); assert.deepEqual([find(r.body, dLives.id).progress, find(r.body, wLives.id).progress], [1, 1]);
      const ax = (await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-quest' }), nonce: 'n1' }, sx)).body;
      for (let left = wTime.goal - find(ax, wTime.id).progress - 25; left > 0; left -= 600) await lifeFor(sy, Math.max(20, Math.min(600, left))); // the other device brings just the rest of the weekly time
      const ay = (await post('/api/pass', {}, sy)).body; assert.equal(find(ay, wTime.id).done, false);
      r = await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-quest' }), nonce: 'n1' }, sy); assert.equal(r.body.merged, true);
      assert.deepEqual([find(r.body, dLives.id).claimed, find(r.body, wLives.id).progress], [true, Math.min(wLives.goal, find(ax, wLives.id).progress + find(ay, wLives.id).progress)], 'merged: weekly lives added up, the claimed daily still claimed');
      assert.deepEqual(PERMANENT.map(L => line(r.body, L.id).total), PERMANENT.map(L => line(ax, L.id).total + line(ay, L.id).total), 'lifetime totals added up');
      assert.ok(find(r.body, wTime.id).done && !find(r.body, wTime.id).claimed, 'the weekly time quest the two finished together is ready to claim');
      assert.equal(r.body.balance, ax.balance + ay.balance, 'nothing paid by the merge itself');
      // deleting the account deletes its quests and lifetime totals
      r = await post('/api/account/delete', { confirm: 'DELETE' }, sy); assert.equal(r.body.deleted, true);
      a = await admin(); assert.deepEqual([a.stats.quests.today, a.stats.quests.week], [0, 0], 'deleting the account deletes its quests');
      r = await post('/api/session', { secret: sy }); assert.ok([...r.body.quests.daily.quests, ...r.body.quests.weekly.quests, ...r.body.quests.permanent].every(q => q.progress === 0 && !q.done), 'a device of the deleted account starts afresh');
      db.close();
    } else console.log('(JSON store: skipping the backdated quest lives)');
    // old apps: run/end sends what they read; the quest fields are extra. Without claims (no Claim button) every ready reward is claimed for them
    await post('/api/session', { secret: sx }); // (a fresh wallet: its account was deleted above)
    r = await post('/api/run/end', { runId: (await post('/api/run/start', {}, sx)).body.runId, survived: 30, eaten: 1, peak: 40, bestRank: 3, place: 5, of: 9, life: 0, show: 1, name: 'Old app' }, sx);
    for (const k of ['payout', 'ratingDelta', 'balance', 'earned', 'skins', 'rating', 'tier', 'runs', 'playerId', 'passUp', 'questXp', 'questsDone']) assert.ok(k in r.body, 'run/end still sends ' + k);
    if (store === 'sqlite') {
      const db = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'mitosis.sqlite')), old = async (sec, body = {}) => { const id = (await post('/api/run/start', {}, sx)).body.runId; db.prepare('UPDATE runs SET started = started - ? WHERE id = ?').run(sec * 1000, id); return post('/api/run/end', { runId: id, survived: sec, ...body }, sx); };
      assert.equal(await flip(true), 303);
      for (let i = 1; i < dLives.goal; i++) await old(25);
      const b0 = (await post('/api/pass', {}, sx)).body; r = await old(25);
      assert.deepEqual([r.body.questsDone.map(q => q.id), r.body.questAtp, r.body.questXp, find(r.body, dLives.id).claimed], [[dLives.id], 30, 100, true], 'an old app\'s finished quest is claimed at once: 30 ATP and 100 pass XP');
      assert.deepEqual([r.body.balance, r.body.pass.xp], [b0.balance + r.body.payout + 30, b0.pass.xp + r.body.xpGained + 100], 'paid into its wallet and pass, as before claiming');
      r = await old(25); assert.deepEqual([r.body.questAtp, r.body.questXp], [0, 0], 'and only once');
      r = await life(sx, { survived: 9999 }); assert.equal(r.body.questAtp, 0, 'a page with claims gets nothing claimed for it');
      db.close(); assert.equal(await flip(false), 303);
    }
    for (const sec of [sx, sy]) await post('/api/account/delete', { confirm: 'DELETE' }, sec);
    assert.equal(await flip(false), 303);
  }
  { // Testers (picked on /admin/pass) see the pass while it is off; nobody else does; a merge carries the tester, deletion drops it
    const token = fs.readFileSync(path.join(dataDir, 'admin-token'), 'utf8').trim(), page = async () => (await fetch(base + '/admin/pass?token=' + token)).text();
    const admin = async () => (await fetch(base + '/admin/pass?format=json&token=' + token)).json();
    const tester = async (id, add) => (await fetch(base + '/admin/pass?token=' + token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'tester=' + encodeURIComponent(id) + '&add=' + (add ? 1 : 0), redirect: 'manual' })).status;
    const post = async (url, body, secret) => { const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.7' }; if (secret) headers.Authorization = 'Bearer ' + secret;
      const res = await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body || {}) }); return { status: res.status, body: await res.json() }; };
    const st = 'testersecret' + 't'.repeat(20), so = 'testersecret' + 'o'.repeat(20);
    r = await post('/api/session', { secret: st }); const tid = r.body.playerId; assert.equal(r.body.pass, null, 'off: no pass');
    const oid = (await post('/api/session', { secret: so })).body.playerId;
    let a = await admin(); assert.deepEqual([a.on, a.testers], [false, []], 'no testers at first');
    assert.ok(a.recent.some(x => x.id === tid) && a.recent.some(x => x.id === oid), 'the switch page lists who opened the game lately');
    assert.equal((await fetch(base + '/admin/pass?token=wrong', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'tester=' + tid + '&add=1' })).status, 403, 'picking testers needs the token');
    assert.match(await page(), /Testers[\s\S]*No testers yet[\s\S]*Make tester/);
    assert.equal(await tester(tid, true), 303); a = await admin(); assert.deepEqual([a.testers.map(x => x.id), a.on, a.live], [[tid], false, false], 'a tester, and the pass still off for everyone');
    assert.match(await page(), /Off \(hidden\)<\/span> · 1 tester can see it[\s\S]*Remove/);
    r = await post('/api/session', { secret: st }); assert.deepEqual([r.body.pass && r.body.pass.season, r.body.catalog.pass && r.body.catalog.pass.key, !!(r.body.quests && r.body.quests.daily)], ['s1', 's1', true], 'the tester sees the pass and its quests');
    r = await post('/api/session', { secret: so }); assert.deepEqual([r.body.pass, r.body.catalog.pass, r.body.quests], [null, null, null], 'nobody else does');
    assert.equal((await (await fetch(base + '/api/catalog')).json()).pass, null, 'nor the public catalogue');
    r = await post('/api/run/end', { runId: (await post('/api/run/start', {}, st)).body.runId, survived: 9999 }, st); assert.equal(r.body.pass.xp, r.body.xpGained, 'a tester\'s lives fill the pass');
    r = await post('/api/pass', {}, st); assert.ok(r.body.catalog.pass, 'the pass page opens for the tester');
    r = await post('/api/pass/claim', { reward: '1b' }, st); assert.equal(r.body.claimed.reward, '1b', 'and claims');
    assert.equal((await post('/api/pass/claim', { reward: '1f' }, so)).status, 404, 'others cannot');
    assert.equal(await tester('nobody', true), 303); assert.deepEqual((await admin()).testers.map(x => x.id), [tid], 'an unknown player is not added');
    // the tester's device signs in to an account someone else made: the account becomes the tester
    await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-tester' }), nonce: 'n1' }, so);
    r = await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-tester' }), nonce: 'n1' }, st); assert.equal(r.body.merged, true);
    assert.deepEqual((await admin()).testers.map(x => x.id), [oid], 'the tester moved to the account it joined');
    r = await post('/api/session', { secret: so }); assert.deepEqual([r.body.pass && r.body.pass.claimed], [['1b']], 'which sees the pass, with the claim');
    assert.equal(await tester(oid, false), 303); r = await post('/api/session', { secret: so }); assert.equal(r.body.pass, null, 'removed: hidden again');
    assert.equal(await tester(oid, true), 303); r = await post('/api/account/delete', { confirm: 'DELETE' }, so); assert.equal(r.body.deleted, true);
    assert.deepEqual((await admin()).testers, [], 'deleting the account removes the tester');
  }
  { // both stores keep the pass: XP adds up per season, premium, each claim once; merges join it, deletion drops it; the switch is kept
    const { SqliteStore, JsonStore } = require('./store'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-pass-'));
    let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
    const open = kind => kind === 'json' ? new JsonStore(path.join(dir, 'p.json')) : new SqliteStore(sqlite, path.join(dir, 'p.sqlite'));
    for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
      let st = open(kind); const k = m => kind + ': ' + m;
      const reopen = async () => { if (kind === 'json') await new Promise(res => setTimeout(res, 400)); else st.db.close(); st = open(kind); };
      assert.equal(st.flag('pass'), null, k('no switch at first')); st.setFlag('pass', 'on');
      st.createPlayer('a', 'ha', 1); st.createPlayer('b', 'hb', 1);
      assert.equal(st.passRow('a', 's1'), null);
      st.passAddXp('a', 's1', 120, 5); st.passAddXp('a', 's1', 30, 6); st.passAddXp('a', 's0', 999, 1); st.passSetPremium('a', 's1', 7);
      assert.equal(st.passClaim('a', 's1', '1a', 8), true); assert.equal(st.passClaim('a', 's1', '1a', 9), false, k('a claim counts once')); assert.equal(st.passClaim('a', 's1', '2c', 9), true);
      st.passAddXp('b', 's1', 40, 5); st.passClaim('b', 's1', '1b', 6); st.passClaim('b', 's1', '2c', 7);
      await reopen();
      assert.equal(st.flag('pass'), 'on', k('the switch is kept'));
      assert.deepEqual([Number(st.passRow('a', 's1').xp), Number(st.passRow('a', 's1').premium), Number(st.passRow('a', 's0').xp)], [150, 1, 999], k('XP adds up per season'));
      assert.deepEqual(st.passClaims('a', 's1'), ['1a', '2c']); assert.deepEqual(st.passClaims('a', 's0'), []);
      assert.deepEqual(st.passStats('s1'), { players: 2, premium: 1, xp: 190, claims: 4 }, k('stats for the switch page'));
      st.mergePlayers('b', 'a');
      assert.deepEqual([Number(st.passRow('a', 's1').xp), Number(st.passRow('a', 's1').premium)], [190, 1], k('a merge adds the XP and keeps the Battle Pass'));
      assert.deepEqual([...st.passClaims('a', 's1')].sort(), ['1a', '1b', '2c'], k('and joins the claims')); assert.equal(st.passRow('b', 's1'), null);
      st.createPlayer('c', 'hc', 1); st.passAddXp('c', 's1', 10, 1); st.passSetPremium('c', 's1', 2); st.mergePlayers('a', 'c');
      assert.deepEqual([Number(st.passRow('c', 's1').xp), Number(st.passRow('c', 's1').premium), Number(st.passRow('c', 's0').xp)], [200, 1, 999], k('merging into a player who has a pass'));
      await reopen(); assert.deepEqual([...st.passClaims('c', 's1')].sort(), ['1a', '1b', '2c'], k('the merge is saved'));
      st.deletePlayer('c'); assert.equal(st.passRow('c', 's1'), null, k('deleting the player deletes its pass')); assert.deepEqual(st.passClaims('c', 's1'), []);
      assert.deepEqual(st.passStats('s1'), { players: 0, premium: 0, xp: 0, claims: 0 });
      st.setFlag('pass', 'off'); await reopen(); assert.equal(st.flag('pass'), 'off', k('switching off is kept'));
      if (kind === 'sqlite') st.db.close();
    }
  }
  { // quests at chosen times, in both stores: the sets, finishing once, claiming once, the daily and weekly resets, rewards that wait, the switch, permanent tiers, merges and deletion
    const E = require('./economy'), { questsAt, questsOf, questsTick, isoWeekOf, questTotals, QUESTS, PASS_SEASONS, PERMANENT, PERM_ATP } = E, claim = E.handlers.questClaim;
    const { SqliteStore, JsonStore } = require('./store'), at = Date.parse, s1 = PASS_SEASONS[0];
    for (const [d, w] of [['2026-11-16', '2026-W47'], ['2026-11-22', '2026-W47'], ['2026-11-23', '2026-W48'], ['2026-12-31', '2026-W53'], ['2027-01-03', '2026-W53'], ['2027-01-04', '2027-W01'], ['2024-12-30', '2025-W01'], ['2021-01-03', '2020-W53']])
      assert.equal(isoWeekOf(at(d + 'T12:00:00Z')).key, w, 'ISO week of ' + d);
    const fri = at('2026-11-20T12:00:00Z'), sets = new Set();
    for (let t = at(s1.from); t < at(s1.to); t += 864e5) for (const kind of ['day', 'week']) {
      const Q = questsAt(kind, t); sets.add(Q.list.map(q => q.id).join());
      assert.equal(Q.list.length, kind === 'day' ? 4 : 7); assert.equal(new Set(Q.list.map(q => q.id)).size, Q.list.length, Q.period + ': no quest twice');
      assert.ok(Q.list.every(q => q.goal >= 1 && q.text && q.xp === QUESTS.xp[kind] && q.atp === QUESTS.atp[kind]), Q.period + ': each has a goal, words, its ATP and XP');
    }
    assert.ok(sets.size > 8, 'the sets change from day to day and week to week');
    assert.deepEqual([questsAt('day', at('2026-11-20T00:00:00Z')), questsAt('day', at('2026-11-20T23:59:59.999Z'))], [questsAt('day', fri), questsAt('day', fri)], 'one set all day (UTC)');
    assert.deepEqual([questsAt('week', at('2026-11-16T00:00:00Z')), questsAt('week', at('2026-11-22T23:59:59.999Z'))], [questsAt('week', fri), questsAt('week', fri)], 'one set all week, Monday to Sunday (UTC)');
    assert.equal(PERM_ATP.length, 4); for (const L of PERMANENT) assert.ok(L.tiers.length === 4 && L.tiers.every((g, i) => !i || g > L.tiers[i - 1]) && L.tiers.every(g => L.text(g)), L.id + ': four rising tiers, each with words');
    assert.deepEqual(PERMANENT.find(L => L.id === 'eaten').tiers.slice(1), [1000, 10000, 100000], 'Rowan\'s example: eat 1,000 / 10,000 / 100,000 cells');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-quests-')); let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
    const open = kind => kind === 'json' ? new JsonStore(path.join(dir, 'q.json')) : new SqliteStore(sqlite, path.join(dir, 'q.sqlite'));
    const L = (survived, place, of, eaten) => ({ survived, place, of, eaten }), T2f = o => questTotals(o, o.player('f')).lives;
    const withClassic = (E.catalog().modes || []).includes('classic'), splitWas = QUESTS.splitKills;
    assert.equal(QUESTS.splitKills, withClassic, 'split-kill quests come on with Classic, whose game reports splitKills');
    QUESTS.splitKills = false; assert.ok([questsAt('day', fri), questsAt('week', fri)].every(Q => Q.list.every(q => q.kind !== 'splitkill')), 'none while they are off');
    QUESTS.splitKills = true; // as once the game sends splitKills (set back below)
    const dayWith = (kind, from) => { for (let t = at(from + 'T12:00:00Z'), i = 0; i < 400; i++, t += 864e5) { const q = questsAt('day', t).list.find(x => x.kind === kind); if (q) return { t, q, period: questsAt('day', t).period }; } throw new Error('no day with ' + kind); };
    assert.equal(questsAt('day', fri).list.filter(q => q.modes.includes('classic')).length >= 2 && questsAt('week', fri).list.filter(q => q.modes.includes('classic')).length, 3, 'every set has quests Classic can do: 2 or more a day, 3 a week');
    for (let t = at(s1.from); t < at(s1.to); t += 864e5) { assert.ok(questsAt('day', t).list.filter(q => q.modes.includes('classic')).length >= 2); assert.equal(questsAt('week', t).list.filter(q => q.modes.includes('classic')).length, 3); }
    for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
      let st = open(kind); const k = m => kind + ': ' + m, reopen = async () => { if (kind === 'json') await new Promise(res => setTimeout(res, 400)); else st.db.close(); st = open(kind); };
      st.createPlayer('a', 'ha', 1); const a = st.player('a'), bal = id => Number(st.player(id).balance), P = id => st.player(id);
      const view = (p, t) => questsOf(st, p, t), get = (v, id) => [...v.daily.quests, ...v.weekly.quests].find(q => q.id === id), line = (v, id) => v.permanent.find(q => q.line === id);
      const D = questsAt('day', fri), lives = D.list.find(q => q.kind === 'lives'), dLife = D.list.find(q => q.kind === 'life'), W = questsAt('week', fri), wLives = W.list.find(q => q.kind === 'lives');
      // on without the battle pass (its switch has never been touched): no pass XP, nothing ready
      let v = view(a, fri); assert.ok(v && v.claimable === 0 && v.daily.quests.every(q => q.xp === 0 && q.atp === 30) && v.weekly.quests.every(q => q.atp === 100), k('quests without the pass'));
      // progress: the life that reaches the goal finishes it, once; nothing is paid until it is claimed
      for (let i = 1; i < lives.goal; i++) assert.deepEqual(questsTick(st, a, L(30), fri).done, [], k('life ' + i));
      assert.deepEqual(questsTick(st, a, L(30), fri).done, [{ id: lives.id, text: lives.text, atp: 30, xp: 0, kind: 'day', period: D.period }], k('the last life finishes it'));
      v = view(a, fri); assert.deepEqual([get(v, lives.id).done, get(v, lives.id).claimed, v.claimable, bal('a')], [true, false, 1, 0], k('finished, waiting, unpaid'));
      assert.deepEqual(questsTick(st, a, L(30), fri).done, [], k('a done quest finishes once'));
      assert.equal(st.questDone('a', D.period, lives.id, 9), false, k('the store marks a quest done once'));
      questsTick(st, a, L(19), fri); assert.equal(get(view(a, fri), wLives.id).progress, lives.goal + 1, k('a life under 20 s is not counted'));
      assert.equal(get(view(a, fri), W.list.find(q => q.kind === 'time').id).progress, 30 * (lives.goal + 1), k('nor is its time'));
      await reopen(); assert.deepEqual([get(view(a, fri), lives.id).done, get(view(a, fri), wLives.id).progress], [true, lives.goal + 1], k('kept'));
      // claiming pays its ATP once; it must be finished, and real
      let r = claim(st, { period: D.period, id: lives.id }, P('a'));
      assert.deepEqual([r.claimed, r.atp, r.balance, r.earned], [[{ period: D.period, id: lives.id, text: lives.text, atp: 30, xp: 0 }], 30, 30, 30], k('claimed: 30 ATP'));
      r = claim(st, { period: D.period, id: lives.id }, P('a')); assert.deepEqual([r.already, r.balance], [true, 30], k('once'));
      assert.equal(st.questClaim('a', D.period, lives.id, 9), false, k('the store pays a quest once'));
      for (const [b, status] of [[{ period: D.period, id: dLife.id }, 409], [{ period: D.period, id: 'nope' }, 404], [{ period: 'q', id: lives.id }, 404], [{ period: 'perm', id: 'lives-1' }, 409], [{ period: 'perm', id: 'x-1' }, 404]])
        assert.throws(() => claim(st, b, P('a')), e => e.status === status, k('claim ' + JSON.stringify(b)));
      // a finished quest no longer in the day's set (the sets changed with an update) waits under earlier at once
      st.createPlayer('o', 'ho', 1); const gone = E.QUEST_SLOTS.day.flat().map(q => [q.kind, q.top || q.sec || q.mass, q.goal].filter(x => x != null).join('-')).find(id => !D.list.some(q => q.id === id));
      st.questSave('o', D.period, gone, 1, 1); st.questDone('o', D.period, gone, 1);
      assert.deepEqual([view(P('o'), fri).earlier.map(e => [e.period, e.id]), view(P('o'), fri).claimable], [[[D.period, gone]], 1], k('a reward from a quest the set no longer has'));
      // a new set at midnight UTC, and Friday's finished but unclaimed quest waits under earlier
      questsTick(st, a, L(dLife.sec), fri); assert.equal(get(view(a, fri), dLife.id).done, true);
      v = view(a, at('2026-11-20T23:59:59.999Z')); assert.deepEqual([v.daily.key, get(v, dLife.id).done, v.earlier], ['2026-11-20', true, []], k('still today at 23:59:59'));
      v = view(a, at('2026-11-21T00:00:00Z')); assert.equal(v.daily.key, '2026-11-21');
      assert.ok(v.daily.quests.every(q => q.progress === 0 && !q.done), k('a fresh day at midnight')); assert.equal(get(v, wLives.id).progress, lives.goal + 2, k('the week goes on'));
      assert.deepEqual([v.earlier.map(e => [e.period, e.id, e.atp, e.from]), v.claimable], [[[D.period, dLife.id, 30, 'day']], 1], k('Friday\'s reward waits'));
      r = claim(st, { period: D.period, id: dLife.id }, P('a')); assert.deepEqual([r.atp, bal('a')], [30, 60], k('and is paid on Saturday'));
      assert.deepEqual(view(a, at('2026-11-21T00:00:00Z')).earlier, [], k('then it is gone'));
      const sat = at('2026-11-21T09:00:00Z'), satLives = questsAt('day', sat).list.find(q => q.kind === 'lives');
      let fin = 0; for (let i = 0; i < satLives.goal; i++) fin += questsTick(st, a, L(30), sat).done.filter(q => q.id === satLives.id).length; assert.equal(fin, 1, k('the new day\'s lives quest finishes again'));
      v = view(a, at('2026-11-22T23:59:59.999Z')); assert.deepEqual([v.weekly.key, get(v, wLives.id).progress], ['2026-W47', lives.goal + 2 + satLives.goal], k('the week counts both days'));
      v = view(a, at('2026-11-23T00:00:00Z')); assert.equal(v.weekly.key, '2026-W48', k('Monday 00:00 UTC'));
      assert.ok([...v.daily.quests, ...v.weekly.quests].every(q => q.progress === 0 && !q.done), k('a fresh week on Monday'));
      // quests don't need a season: they run before, between and after them
      assert.ok(view(a, at('2026-11-01T12:00:00Z')) && view(a, at('2027-03-01T12:00:00Z')), k('no season needed'));
      // the switch: while off there are no quests and lives finish none, but lifetime totals count; back on, it is as it was
      const mon = at('2026-11-23T12:00:00Z'); questsTick(st, a, L(30), mon); const before = view(a, mon), livesBefore = questTotals(st, P('a')).lives;
      st.setFlag('quests', 'off'); assert.equal(view(a, mon), null, k('no quests while off'));
      assert.deepEqual(questsTick(st, a, L(600, 1, 10), mon), { xp: 0, done: [], tiers: [] }, k('lives while off finish nothing'));
      assert.throws(() => claim(st, { all: true }, P('a')), e => e.status === 404, k('and claim nothing'));
      st.setFlag('quests', 'on'); v = view(a, mon); assert.deepEqual([v.daily, v.weekly], [before.daily, before.weekly], k('on again: as it was'));
      assert.equal(questTotals(st, P('a')).lives, livesBefore + 1, k('the lifetime totals kept counting'));
      // permanent quests: lifetime totals in tiers; a life past a tier reaches it once; claiming pays its tier once and moves the ladder on
      st.createPlayer('e', 'he', 1);
      r = questsTick(st, P('e'), L(800, 1, 10, 9999), mon);
      const dl = r.done.filter(q => q.kind === 'day').length; assert.ok(dl >= 2, k('the life finishes some daily quests'));
      assert.deepEqual(questTotals(st, P('e')), { lives: 1, time: 600, eaten: 10 + 600 / 60 * 15, wins: 1, top3: 1, dailies: dl }, k('one long winning life: time capped at 10 min, cells by its length, and the daily quests it finished'));
      assert.deepEqual(r.tiers.map(t => t.id).sort(), ['eaten-1', 'wins-1'], k('it reaches the first cells and wins tiers'));
      assert.deepEqual(questsTick(st, P('e'), L(30, 5, 10, 3), mon).tiers, [], k('each tier is reached once'));
      v = view(P('e'), mon); assert.deepEqual([line(v, 'wins').done, line(v, 'wins').tier, line(v, 'lives').done, line(v, 'lives').progress, line(v, 'lives').goal], [true, 1, false, 2, 10]);
      r = claim(st, { period: 'perm', id: 'wins-1' }, P('e')); assert.deepEqual([r.atp, r.balance], [100, 100], k('the first wins tier pays 100 ATP'));
      v = view(P('e'), mon); assert.deepEqual([line(v, 'wins').tier, line(v, 'wins').goal, line(v, 'wins').progress, line(v, 'wins').done], [2, 10, 1, false], k('then wins asks for 10'));
      assert.equal(claim(st, { period: 'perm', id: 'wins-1' }, P('e')).already, true, k('a tier pays once'));
      assert.throws(() => claim(st, { period: 'perm', id: 'wins-2' }, P('e')), e => e.status === 409, k('not before it is reached'));
      { // the lifetime totals move onto the player's lifetime stats (economy.js questTotals): a store from before them opens with
        // each player's lives counted from the ratings' lives, and the totals the quests kept in the stats table moved over, once
        const file = path.join(dir, 'old-' + kind), old = () => kind === 'json' ? new JsonStore(file + '.json') : new SqliteStore(sqlite, file + '.sqlite');
        let o = old(); o.createPlayer('f', 'hf', 1); for (let i = 0; i < 30; i++) o.setRating('f', 1000, null); for (let i = 0; i < 5; i++) o.setAiRating('f', 1000, null);
        o.createPlayer('f2', 'hf2', 1); for (let i = 0; i < 9; i++) o.setRating('f2', 1000, null); o.statsAdd('f2', { lives: 12, time: 700, eaten: 40, wins: 2, top3: 3, dailies: 4 }, 1);
        if (kind === 'json') { for (const id of ['f', 'f2']) delete o.d.players[id].played; o.save(); await new Promise(res => setTimeout(res, 400)); }
        else { o.db.exec('ALTER TABLE players DROP COLUMN played'); o.db.close(); }
        for (let n = 0; n < 2; n++) {
          o = old(); const T2 = id => questTotals(o, o.player(id));
          assert.deepEqual([T2('f').lives, T2('f').time], [35, 0], k('35 ranked lives before: the lives line starts there'));
          assert.deepEqual(T2('f2'), { dailies: 4, lives: 12, time: 700, eaten: 40, wins: 2, top3: 3 }, k('the totals the quests kept move over' + (n ? ', once' : '')));
          assert.deepEqual(o.stats('f2'), { dailies: 4 }, k('and leave the stats table; dailies stay'));
          if (kind === 'json') await new Promise(res => setTimeout(res, 400)); else o.db.close();
        }
        o = old(); assert.deepEqual([line(questsOf(o, o.player('f'), mon), 'lives').done, line(questsOf(o, o.player('f'), mon), 'lives').total], [true, 35], k('the first lives tier is ready at once'));
        questsTick(o, o.player('f'), L(30), mon); assert.equal(T2f(o), 36, k('kept from the first life on'));
        r = claim(o, { all: true }, o.player('f')); assert.deepEqual([r.claimed.map(c => c.id), r.atp], [['lives-1'], 100], k('claim all'));
        if (kind === 'sqlite') o.db.close();
      }
      // merging: progress and lifetime totals add up; done or claimed on either side stays so; settling finishes (not pays) what they finished together
      const { t: tue, q: tLife } = dayWith('life', '2026-11-24'), T = questsAt('day', tue), tLives = T.list.find(q => q.kind === 'lives');
      st.createPlayer('b', 'hb', 1); st.createPlayer('c', 'hc', 1); const b = P('b'), c = P('c');
      for (let i = 0; i < tLives.goal - 2; i++) questsTick(st, b, L(30), tue);
      assert.ok(questsTick(st, b, L(tLife.sec), tue).done.some(q => q.id === tLife.id), k('b finishes the one-life quest'));
      claim(st, { period: T.period, id: tLife.id }, P('b'));
      questsTick(st, c, L(30), tue);
      const vb = view(b, tue), vc = view(c, tue), sb = questTotals(st, P('b')), sc = questTotals(st, P('c')), mb = bal('b'), mc = bal('c');
      assert.deepEqual([get(vb, tLives.id).progress, get(vc, tLives.id).progress], [tLives.goal - 1, 1], k('neither has finished the lives quest'));
      const together = [...vb.daily.quests, ...vb.weekly.quests].filter(q => !q.done && !get(vc, q.id).done && q.progress + get(vc, q.id).progress >= q.goal);
      assert.ok(together.some(q => q.id === tLives.id), k('but together they have'));
      st.mergePlayers('b', 'c'); await reopen();
      v = view(P('c'), tue); assert.deepEqual([get(v, tLife.id).claimed, get(v, tLives.id).progress, get(v, tLives.id).done], [true, tLives.goal, false], k('merged: claimed kept, progress added'));
      assert.deepEqual(questTotals(st, P('c')), Object.fromEntries(Object.keys({ ...sb, ...sc }).map(x => [x, (sb[x] || 0) + (sc[x] || 0)])), k('lifetime totals added up'));
      const settled = questsTick(st, P('c'), null, tue);
      assert.deepEqual(settled.done.map(q => q.id).sort(), together.map(q => q.id).sort(), k('settling finishes what they finished together'));
      assert.equal(bal('c'), mb + mc, k('without paying: it waits to be claimed'));
      assert.deepEqual(questsTick(st, P('c'), null, tue).done, [], k('once'));
      assert.deepEqual([st.questRows('b', T.period), st.stats('b'), P('b')], [[], {}, null], k('nothing left under the merged player'));
      // Classic lives (the endless arena): lives, time (up to an hour a life), cells, mass and split-kills count; quests that need a round don't
      st.createPlayer('g', 'hg', 1); const C = { survived: 2400, place: 1, of: 10, eaten: 500, peak: 50000, splitKills: 9, mode: 'classic' };
      for (const kind of ['eat', 'mass', 'splitkill', 'life', 'top']) {
        const { t, q, period } = dayWith(kind, '2026-12-01'), before = (st.questRows('g', period).find(r => r.quest === q.id) || {}).progress || 0;
        questsTick(st, P('g'), C, t); const after = Math.min(q.goal, (st.questRows('g', period).find(r => r.quest === q.id) || {}).progress || 0);
        const want = { eat: Math.min(q.goal, before + 500), mass: 1, splitkill: Math.min(q.goal, before + 9), life: 0, top: 0 }[kind];
        assert.equal(after, want, k(`Classic: ${q.text} (${q.modes.join(' + ')})`));
        assert.deepEqual(q.modes, ['life', 'top'].includes(kind) ? ['ranked'] : ['ranked', 'classic'], k(q.kind + ': where it counts'));
      }
      assert.deepEqual([questTotals(st, P('g')).time, questTotals(st, P('g')).wins, questTotals(st, P('g')).top3, P('g').rounds], [5 * 2400, 0, 0, 0], k('a Classic life counts up to an hour of time, and never a win or a top 3'));
      v = view(P('g'), fri); assert.deepEqual([line(v, 'wins').modes, line(v, 'eaten').modes], [['ranked'], ['ranked', 'classic']], k('the permanent lines say where they count'));
      // the client's cells, mass and split-kills are capped by the life's length; split-kills by its cells
      st.createPlayer('h', 'hh', 1); const m = dayWith('mass', '2026-12-01'), sk = dayWith('splitkill', '2026-12-01');
      questsTick(st, P('h'), { survived: 20, peak: 99999, eaten: 2, splitKills: 50 }, m.t); assert.equal((st.questRows('h', m.period).find(r => r.quest === m.q.id) || {}).progress || 0, 300 + Math.floor(20 / 60 * 1500) >= m.q.mass ? 1 : 0, k('a 20 s life cannot claim a huge mass'));
      questsTick(st, P('h'), { survived: 60, eaten: 4, splitKills: 50 }, sk.t); assert.equal((st.questRows('h', sk.period).find(r => r.quest === sk.q.id) || {}).progress, Math.min(sk.q.goal, 4), k('split-kills no more than the cells eaten'));
      // testers: they see the pass while it is off and, before a season starts, the next one; nobody else does
      const { passLive } = E, pre = at('2026-11-01T12:00:00Z'), A = { id: 'a' }, B = { id: 'b' };
      st.setFlag('pass', 'off'); st.setFlag('passTesters', JSON.stringify(['a']));
      assert.deepEqual([passLive(st, pre, A)?.key, passLive(st, pre, B), passLive(st, pre), passLive(st, fri, A)?.key, passLive(st, fri, B)], ['s1', null, null, 's1', null], k('off: only the tester, who gets the next season before it starts'));
      st.setFlag('pass', 'on');
      assert.deepEqual([passLive(st, pre, A)?.key, passLive(st, pre, B), passLive(st, fri, B)?.key], ['s1', null, 's1'], k('on: everyone in the season, only the tester before it'));
      assert.equal(passLive(st, at('2027-06-01T00:00:00Z'), A), null, k('no season left, nothing to test'));
      assert.deepEqual([view(a, pre).daily.quests[0].xp, view(B, pre).daily.quests[0].xp], [100, 0], k('pass XP shows only to whom the pass is live'));
      st.setFlag('passTesters', 'not json'); assert.equal(passLive(st, pre, A), null, k('a broken list is no testers'));
      // deletion
      st.deletePlayer('c'); assert.deepEqual([st.questRows('c', T.period), st.questRows('c', 'perm'), st.stats('c')], [[], [], {}], k('deleting the player deletes its quests and totals')); assert.equal(st.questStats(T.period), 0);
      await reopen(); assert.deepEqual([st.questRows('c', T.period), st.stats('c')], [[], {}], k('and stays deleted'));
      assert.ok(st.questStats(D.period) >= 1, k('quest stats per period'));
      if (kind === 'sqlite') st.db.close();
    }
    QUESTS.splitKills = splitWas;
  }
  { // both stores keep XP, add it up, carry it through a merge and drop it with the player; old databases gain the column
    const { SqliteStore, JsonStore } = require('./store'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-xp-'));
    let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
    const open = kind => kind === 'json' ? new JsonStore(path.join(dir, 'm.json')) : new SqliteStore(sqlite, path.join(dir, 'm.sqlite'));
    if (sqlite) { // a database from before XP: the players and runs tables without the column
      const old = new sqlite.DatabaseSync(path.join(dir, 'm.sqlite'));
      old.exec(`CREATE TABLE players(id TEXT PRIMARY KEY, secret TEXT UNIQUE NOT NULL, created INTEGER, seen INTEGER, balance INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, hour_at INTEGER NOT NULL DEFAULT 0, hour_sum INTEGER NOT NULL DEFAULT 0, rating INTEGER NOT NULL DEFAULT 1000, name TEXT, runs INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE runs(id TEXT PRIMARY KEY, player TEXT, started INTEGER, ended INTEGER, payout INTEGER);
        INSERT INTO players(id, secret, created, seen, balance, runs) VALUES('old', 'hold', 1, 1, 70, 12); INSERT INTO runs(id, player, started, ended, payout) VALUES('r0', 'old', 1, 2, 5);`);
      old.close();
    }
    fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ players: { old: { id: 'old', secret: 'hold', created: 1, seen: 1, balance: 70, earned: 0, hour_at: 0, hour_sum: 0, rating: 1000, name: null, runs: 12 } }, secrets: { hold: 'old' }, runs: { r0: { id: 'r0', player: 'old', started: 1, ended: 2, payout: 5 } } }));
    for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
      let st = open(kind);
      const reopen = async () => { if (kind === 'json') await new Promise(res => setTimeout(res, 400)); else st.db.close(); st = open(kind); }; // what was saved
      assert.equal(Number(st.player('old').xp || 0), 0, kind + ': a player from before XP has none'); assert.equal(Number(st.run('r0', 'old').xp || 0), 0);
      st.createPlayer('a', 'ha', 1); st.createPlayer('b', 'hb', 1);
      st.addXp('old', 40); st.addXp('a', 120); st.addXp('a', 30); st.addXp('b', 500);
      st.createRun('r1', 'a', 1); st.endRun('r1', 2, 5, 42);
      await reopen();
      assert.deepEqual(['old', 'a', 'b'].map(id => Number(st.player(id).xp)), [40, 150, 500], kind + ': XP adds up and is kept');
      assert.equal(Number(st.run('r1', 'a').xp), 42, kind + ': a run keeps the XP it earned');
      st.addStats('a', { played: 5, rounds: 4, wins: 2, podiums: 3, alive: 600, eaten: 9 }); st.setPeak('a', 1500); st.addStats('b', { played: 2, rounds: 2, wins: 1, podiums: 1, alive: 100, eaten: 1 }); st.setPeak('b', 1200); st.setPeak('b', 900);
      st.addTrophies('a', ['amoeba', 'colony', 'interphase', 'prophase'], 50); st.addTrophies('b', ['amoeba', 'colony'], 20); st.addTrophies('b', ['amoeba'], 99);
      await reopen();
      assert.deepEqual(st.trophies('b').sort((x, y) => x.at - y.at || (x.step < y.step ? -1 : 1)), [{ step: 'amoeba', at: 20 }, { step: 'colony', at: 20 }], kind + ': a trophy is won once, with its first date');
      st.mergePlayers('a', 'b'); assert.equal(st.player('a'), null); assert.equal(Number(st.player('b').xp), 650, kind + ': merging adds the XP together');
      assert.deepEqual(['played', 'rounds', 'wins', 'podiums', 'alive', 'eaten', 'peak'].map(k => Number(st.player('b')[k])), [7, 6, 3, 4, 700, 10, 1500], kind + ': merging adds the stats and keeps the best peak');
      assert.deepEqual(Object.fromEntries(st.trophies('b').map(t => [t.step, t.at])), { amoeba: 20, colony: 20, interphase: 50, prophase: 50 }, kind + ': merging joins the trophies, earliest date first');
      assert.deepEqual(st.trophies('a'), [], kind + ': none are left behind');
      assert.equal(Number(st.playerBySecret('ha').xp), 650, kind + ': the merged device opens the summed XP');
      st.deletePlayer('b'); assert.equal(st.player('b'), null, kind + ': deleting removes the player and its XP'); assert.deepEqual(st.trophies('b'), [], kind + ': and its trophies'); assert.equal(st.playerBySecret('ha'), null);
      st.createPlayer('b2', 'hb', 3); assert.equal(Number(st.player('b2').xp), 0, kind + ': a new wallet on the same device starts from 0');
      await reopen(); st.addXp('b2', 7); await reopen(); // the only change in its save, so it must save itself
      assert.equal(Number(st.player('b2').xp), 7, kind + ': adding XP saves it');
      if (kind === 'sqlite') st.db.close();
    }
  }

  { // name fonts with locks (none in the game yet): a level, ATP, the battle pass; both stores keep, merge and drop them, and old databases gain the column
    const E = require('./economy'), H = E.handlers, { SqliteStore, JsonStore } = require('./store'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-fonts-'));
    let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
    if (sqlite) { const old = new sqlite.DatabaseSync(path.join(dir, 'f.sqlite')); old.exec(`CREATE TABLE players(id TEXT PRIMARY KEY, secret TEXT UNIQUE NOT NULL, created INTEGER, seen INTEGER, balance INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, hour_at INTEGER NOT NULL DEFAULT 0, hour_sum INTEGER NOT NULL DEFAULT 0);
      INSERT INTO players(id, secret, created, seen) VALUES('old', 'hold', 1, 1);`); old.close(); }
    const status = f => { try { f(); return 200; } catch (e) { return e.status; } };
    Object.assign(E.FONT_LOCKS, { 40: { lv: 3 }, 41: { price: 300 }, 42: { pass: 's1' } });
    try {
      for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
        const st = kind === 'json' ? new JsonStore(path.join(dir, 'f.json')) : new SqliteStore(sqlite, path.join(dir, 'f.sqlite')), me = () => st.player('fa');
        if (kind === 'sqlite') assert.equal(Number(st.player('old').name_font), 0, 'a database from before name fonts gains the column');
        st.createPlayer('fa', 'hfa', 1);
        assert.deepEqual([H.setFont(st, { font: 7 }, me()).nameFont, Number(me().name_font)], [7, 7], kind + ': a free font is set at once');
        assert.equal(status(() => H.setFont(st, { font: 40 }, me())), 403, kind + ': a level font waits for the level');
        st.addXp('fa', E.xpAtLevel(3)); assert.equal(H.setFont(st, { font: 40 }, me()).nameFont, 40, kind + ': and opens at it');
        assert.equal(status(() => H.setFont(st, { font: 41 }, me())), 403, kind + ': an ATP font must be bought first');
        assert.equal(status(() => H.buyFont(st, { font: 41 }, me())), 402, kind + ': with enough ATP');
        st.setWallet('fa', { balance: 500, earned: 500, hour_at: 0, hour_sum: 0 });
        const w = H.buyFont(st, { font: 41 }, me()); assert.deepEqual([w.balance, w.fonts, w.boughtFont], [200, [41], 41], kind + ': it costs its price');
        assert.equal(H.buyFont(st, { font: 41 }, me()).already, true); assert.equal(Number(me().balance), 200, kind + ': once');
        assert.equal(status(() => H.buyFont(st, { font: 7 }, me())), 404, kind + ': a free font is not for sale');
        assert.equal(H.setFont(st, { font: 41 }, me()).nameFont, 41, kind + ': a bought font can be used');
        assert.equal(status(() => H.setFont(st, { font: 42 }, me())), 403, kind + ': a pass font waits for the pass');
        st.addFont('fa', 42, 2); assert.equal(H.setFont(st, { font: 42 }, me()).nameFont, 42, kind + ': and opens once the pass gave it');
        assert.deepEqual(E.catalog(st).fonts.locks[41], { price: 300 }, kind + ': the catalogue sends the locks');
        st.createPlayer('fb', 'hfb', 1); st.setFont('fb', 9); st.addFont('fb', 44, 1); st.mergePlayers('fb', 'fa');
        assert.deepEqual([Number(me().name_font), st.fonts('fa')], [42, [41, 42, 44]], kind + ': a merge keeps the account\'s font and joins the unlocks');
        st.createPlayer('fc', 'hfc', 1); st.createPlayer('fd', 'hfd', 1); st.setFont('fc', 5); st.mergePlayers('fc', 'fd');
        assert.equal(Number(st.player('fd').name_font), 5, kind + ': an account without a font takes the joining one\'s');
        st.setRating('fa', 1500, 'Fonty'); assert.deepEqual([st.top(1)[0].name, st.top(1)[0].font], ['Fonty', 42], kind + ': top() has the font');
        st.deletePlayer('fa'); assert.deepEqual(st.fonts('fa'), [], kind + ': deleting the player drops its unlocks');
        if (kind === 'sqlite') st.db.close();
      }
    } finally { for (const k of [40, 41, 42]) delete E.FONT_LOCKS[k]; }
  }

  const h = await (await fetch(base + '/health')).json(); assert.equal(h.accounts, 2, 'the signed-out device and the fresh one that signed in after the deletion');
  console.log(`all economy API tests passed (${h.store} store)`);
})().then(() => { child.kill(); keyServer.close(); process.exit(0); }).catch(e => { console.error(e); child.kill(); keyServer.close(); process.exit(1); });
