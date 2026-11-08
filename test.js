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
    const { lifeStats, stepsUpTo, LADDER, RULES } = require('./economy');
    assert.deepEqual(lifeStats({ survived: 300, place: 1, of: 20, eaten: 12 }), { played: 1, wins: 1, podiums: 1, alive: 300, eaten: 12 }, 'a win is also a top-3 finish');
    assert.deepEqual(lifeStats({ survived: 300, place: 3, of: 20 }), { played: 1, wins: 0, podiums: 1, alive: 300, eaten: 0 });
    assert.deepEqual(lifeStats({ survived: 300, place: 4, of: 20 }), { played: 1, wins: 0, podiums: 0, alive: 300, eaten: 0 });
    assert.deepEqual(lifeStats({ survived: 19, place: 1, of: 20, eaten: 5 }), { played: 0, wins: 0, podiums: 0, alive: 0, eaten: 0 }, 'a life under 20 s counts for nothing');
    assert.equal(lifeStats({ survived: 20 }).played, 1, '20 s counts'); assert.equal(lifeStats({ survived: 300, place: 1, of: 3 }).wins, 0, 'a round of 3 wins nothing');
    assert.deepEqual([60, 600].map(sec => lifeStats({ survived: sec, eaten: 1e6 }).eaten), [25, 160], 'cells absorbed: at most 10 + 15 a minute of the life');
    assert.equal(lifeStats({ survived: 1e9 }).alive, RULES.maxRunSec);
    assert.deepEqual([stepsUpTo(0), stepsUpTo(74), stepsUpTo(75)], [['amoeba'], ['amoeba'], ['amoeba', 'colony']], 'a step trophy comes with its first division');
    assert.deepEqual(stepsUpTo(1400), ['amoeba', 'colony', 'interphase', 'prophase', 'metaphase', 'anaphase']); assert.deepEqual(stepsUpTo(99999), LADDER.map(st => st.key), 'Mitosis brings every trophy');
  }
  // rating: that run (15 s on the server clock, 10 kills) is a quick death: +0.5 survival +20 kills -7.5 penalty = +13
  assert.equal(r.body.ratingDelta, 13); assert.equal(r.body.rating, 13, 'from the start of 0'); assert.equal(r.body.tier, 'Bronze'); assert.equal(r.body.rank, 'Amoeba I');
  assert.deepEqual(r.body.stats, { played: 0, wins: 0, podiums: 0, alive: 0, eaten: 0, peak: 13 }, 'lifetime stats: a 15 s life counts for nothing, the peak still moves');
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
  { // XP over real server time: lives are backdated in the database, as if the time had passed
    const sec4 = 'xpsecret' + 'd'.repeat(24), store = (await (await fetch(base + '/health')).json()).store;
    r = await post('/api/session', { secret: sec4 }); assert.deepEqual([r.body.xp, r.body.level, r.body.levelXp, r.body.levelNeed], [0, 1, 0, 100], 'a new player is level 1 with no XP');
    assert.deepEqual(r.body.catalog.xp, require('./economy').XP, 'the catalogue carries the XP rules');
    assert.deepEqual([r.body.trophies, r.body.stats], [[], { played: 0, wins: 0, podiums: 0, alive: 0, eaten: 0, peak: 0 }], 'a new player has no trophies yet');
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
      assert.deepEqual([r.body.stats.played, r.body.stats.wins, r.body.stats.podiums, r.body.stats.alive], [3, 1, 1, 415 + 2015 + 200], 'the 15 s life is not counted; last and 4th place are not podiums; time alive adds up');
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
  r = await post('/api/auth/apple', { identityToken: apple(), nonce: 'n1' }, secret2);
  assert.equal(r.status, 200); assert.equal(r.body.merged, true); assert.equal(r.body.balance, 2200, 'the two wallets merge'); assert.equal(r.body.xp, acctXp + 2, 'and so does their XP');
  assert.deepEqual(r.body.stats, { ...Object.fromEntries(['played', 'wins', 'podiums', 'alive', 'eaten'].map(k => [k, acctStats[k] + dev2.stats[k]])), peak: Math.max(acctStats.peak, dev2.stats.peak, r.body.rating) }, 'and their lifetime stats');
  assert.deepEqual(r.body.trophies, acctTrophies, 'trophies both had keep the earlier date'); assert.ok(dev2.trophies[0].at >= acctTrophies[0].at); assert.deepEqual(r.body.skins, [9]); assert.equal(r.body.account.provider, 'apple');
  r = await post('/api/session', { secret: secret2 }); assert.equal(r.body.balance, 2200, 'the second device now opens the account');
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
  { // Quests: daily and weekly goals counted from ranked lives on the server while the pass is live; each pays its XP to the pass once
    const { QUESTS, questsAt, PASS } = require('./economy'), at = Date.parse, today = at('2026-11-20T12:00:00Z');
    const token = fs.readFileSync(path.join(dataDir, 'admin-token'), 'utf8').trim(), store = (await (await fetch(base + '/health')).json()).store;
    const flip = async on => (await fetch(base + '/admin/pass?token=' + token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'on=' + (on ? 1 : 0), redirect: 'manual' })).status;
    const admin = async () => (await fetch(base + '/admin/pass?format=json&token=' + token)).json();
    const post = async (url, body, secret) => { const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.8' }; if (secret) headers.Authorization = 'Bearer ' + secret;
      const res = await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body || {}) }); return { status: res.status, body: await res.json() }; };
    const sx = 'questsecret' + 'x'.repeat(21), sy = 'questsecret' + 'y'.repeat(21), D = questsAt('day', today), W = questsAt('week', today);
    const find = (w, id) => [...w.quests.daily.quests, ...w.quests.weekly.quests].find(q => q.id === id);
    const life = async (secret, body) => post('/api/run/end', { runId: (await post('/api/run/start', {}, secret)).body.runId, ...body }, secret);
    // off: no quests in the wallet, and lives move none on
    r = await post('/api/session', { secret: sx }); assert.equal(r.body.quests, null, 'no quests while the pass is off');
    r = await life(sx, { survived: 9999, place: 1, of: 10 }); assert.deepEqual([r.body.questXp, r.body.questsDone, r.body.quests], [0, [], null], 'lives while off finish no quests');
    // on: four for the day, seven for the week, the same for everyone, new at midnight UTC and on Monday
    assert.equal(await flip(true), 303);
    r = await post('/api/session', { secret: sx }); let Q = r.body.quests;
    assert.deepEqual([Q.daily.key, Q.daily.ends, Q.weekly.key, Q.weekly.ends], ['2026-11-20', at('2026-11-21'), '2026-W47', at('2026-11-23')], 'today (UTC) and this ISO week, with when each ends');
    assert.deepEqual([Q.daily.quests.length, Q.weekly.quests.length], [4, 7], 'four daily quests and seven weekly ones');
    assert.deepEqual(Q.daily.quests.map(q => [q.id, q.text, q.goal, q.xp]), D.list.map(q => [q.id, q.text, q.goal, QUESTS.xp.day]), 'the day\'s quests');
    assert.deepEqual(Q.weekly.quests.map(q => [q.id, q.text, q.goal, q.xp]), W.list.map(q => [q.id, q.text, q.goal, QUESTS.xp.week]), 'the week\'s quests');
    assert.ok([...Q.daily.quests, ...Q.weekly.quests].every(q => q.progress === 0 && q.done === false), 'nothing done yet (the life while off did not count)');
    assert.deepEqual((await post('/api/session', { secret: sy })).body.quests.daily.quests.map(q => q.id), Q.daily.quests.map(q => q.id), 'another player has the same quests');
    assert.deepEqual([QUESTS.xp.day, QUESTS.xp.week], [100, 300], 'Rowan\'s choice: 100 XP a daily quest, 300 a weekly one');
    // the client's claims are not believed: a "long winning life" sent right after starting is 15 s on the server's clock
    r = await life(sx, { survived: 9999, place: 1, of: 10, quests: 99, questXp: 5000 });
    const dLives = D.list.find(q => q.kind === 'lives'), dTime = D.list.find(q => q.kind === 'time'), dLife = D.list.find(q => q.kind === 'life'), wLives = W.list.find(q => q.kind === 'lives');
    assert.deepEqual([r.body.questXp, find(r.body, dLives.id).progress, find(r.body, dTime.id).progress, r.body.quests.daily.quests.filter(q => q.kind === 'top').map(q => q.progress)], [0, 0, 0, [0]],
      'a 15 s life is not a life for the quests: no life, no time, no placing');
    r = await post('/api/pass', { quests: { daily: { quests: [] } }, questXp: 9000 }, sx); assert.equal(find(r.body, dLives.id).progress, 0, 'the client cannot set its quests');
    if (store === 'sqlite') {
      const db = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'mitosis.sqlite'));
      const lifeFor = async (secret, sec, body = {}) => { const id = (await post('/api/run/start', {}, secret)).body.runId; db.prepare('UPDATE runs SET started = started - ? WHERE id = ?').run(sec * 1000, id);
        return post('/api/run/end', { runId: id, survived: sec, ...body }, secret); };
      // progress: lives of 25 s move only the lives and time quests; the one that reaches the goal pays 100 XP to the pass, once
      for (let i = 1; i < dLives.goal; i++) { r = await lifeFor(sx, 25); assert.deepEqual([r.body.questXp, find(r.body, dLives.id).progress, find(r.body, dLives.id).done], [0, i, false], 'life ' + i); }
      assert.equal(find(r.body, dTime.id).progress, 25 * (dLives.goal - 1), 'time adds up across lives');
      let pass0 = r.body.pass, xp0 = r.body.xp;
      const last = (await post('/api/run/start', {}, sx)).body.runId; db.prepare('UPDATE runs SET started = started - 25000 WHERE id = ?').run(last);
      r = await post('/api/run/end', { runId: last, survived: 25 }, sx);
      assert.deepEqual([r.body.questXp, r.body.questsDone], [QUESTS.xp.day, [{ id: dLives.id, text: dLives.text, xp: QUESTS.xp.day, kind: 'day' }]], 'the life that finishes it pays its XP');
      assert.deepEqual([find(r.body, dLives.id).progress, find(r.body, dLives.id).done], [dLives.goal, true]);
      assert.equal(r.body.pass.xp, pass0.xp + r.body.xpGained + QUESTS.xp.day, 'to the battle pass');
      assert.equal(r.body.xp, xp0 + r.body.xpGained, 'but not to the profile');
      assert.equal(find(r.body, wLives.id).progress, dLives.goal, 'the week counts the same lives');
      pass0 = r.body.pass;
      r = await post('/api/run/end', { runId: last, survived: 25 }, sx); assert.deepEqual([r.body.duplicate, r.body.pass.xp], [true, pass0.xp], 'a repeated run/end pays nothing more');
      r = await lifeFor(sx, 25); assert.deepEqual([r.body.questXp, find(r.body, dLives.id).progress, r.body.pass.xp], [0, dLives.goal, pass0.xp + r.body.xpGained], 'a finished quest pays once');
      // placings count with 4 or more in the round, like XP; a win moves every top-N quest on
      r = await lifeFor(sx, 30, { place: 1, of: 3 }); assert.ok(r.body.quests.weekly.quests.filter(q => q.kind === 'top' || q.kind === 'win').every(q => q.progress === 0), 'a win among 3 does not count');
      pass0 = r.body.pass;
      r = await lifeFor(sx, 30, { place: 1, of: 10 }); const tops = [...r.body.quests.daily.quests, ...r.body.quests.weekly.quests].filter(q => q.kind === 'top' || q.kind === 'win');
      assert.ok(tops.length >= 2 && tops.every(q => q.progress === 1 && q.done === (q.goal === 1)), 'a win among 10: one for each top-N and win quest, done where one is enough');
      assert.ok(tops.some(q => q.kind === 'win'), 'the week has a win quest');
      assert.equal(r.body.questXp, r.body.questsDone.reduce((n, q) => n + q.xp, 0)); assert.equal(r.body.pass.xp, pass0.xp + r.body.xpGained + r.body.questXp);
      assert.deepEqual(r.body.questsDone.map(q => q.id).sort(), tops.filter(q => q.goal === 1).map(q => q.id).sort(), 'and pays for those');
      assert.equal(r.body.passUp, Math.floor(r.body.pass.xp / PASS.levelXp) - Math.floor(pass0.xp / PASS.levelXp), 'passUp counts the levels the quests gave');
      // survive in one life: a second short of it is not enough
      r = await lifeFor(sx, dLife.sec - 1); assert.equal(find(r.body, dLife.id).done, false, 'a second short');
      r = await lifeFor(sx, dLife.sec); assert.equal(find(r.body, dLife.id).done, true, 'long enough'); assert.ok(r.body.questsDone.some(q => q.id === dLife.id));
      // the switch page counts quests done today and this week
      let a = await admin(); assert.ok(a.stats.quests.today >= 2 && a.stats.quests.week >= 1, 'the switch page counts finished quests');
      assert.match(await (await fetch(base + '/admin/pass?token=' + token)).text(), /Quests done today/);
      // off: frozen, then back with the progress kept
      const kept = (await post('/api/pass', {}, sx)).body.quests;
      assert.equal(await flip(false), 303); r = await lifeFor(sx, 200, { place: 1, of: 10 }); assert.deepEqual([r.body.quests, r.body.questXp], [null, 0], 'lives while off move nothing');
      assert.equal(await flip(true), 303); assert.deepEqual((await post('/api/pass', {}, sx)).body.quests, kept, 'on again: just as it was');
      // merging: progress adds up; a quest done on either device stays done and is not paid again; one the two finish together pays then
      r = await lifeFor(sy, 25); assert.deepEqual([find(r.body, dLives.id).progress, find(r.body, wLives.id).progress], [1, 1]);
      const ax = (await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-quest' }), nonce: 'n1' }, sx)).body, wTime = W.list.find(q => q.kind === 'time');
      for (let left = wTime.goal - find(ax, wTime.id).progress - 25; left > 0; left -= 600) await lifeFor(sy, Math.max(20, Math.min(600, left))); // the other device brings just the rest of the weekly time
      const ay = (await post('/api/pass', {}, sy)).body; assert.equal(find(ay, wTime.id).done, false);
      r = await post('/api/auth/apple', { identityToken: apple({ sub: 'apple-quest' }), nonce: 'n1' }, sy); assert.equal(r.body.merged, true);
      assert.deepEqual([find(r.body, dLives.id).done, find(r.body, wLives.id).progress], [true, Math.min(wLives.goal, find(ax, wLives.id).progress + find(ay, wLives.id).progress)], 'merged: weekly lives added up, the daily one still done');
      const together = [...ax.quests.daily.quests, ...ax.quests.weekly.quests].filter(q => { const y = find(ay, q.id); return !q.done && !y.done && q.progress + y.progress >= q.goal; });
      assert.ok(together.some(q => q.id === wTime.id), 'the weekly time quest is finished by the two together');
      assert.ok(together.every(q => find(r.body, q.id).done), 'and is done after the merge');
      assert.equal(r.body.pass.xp, ax.pass.xp + ay.pass.xp + together.reduce((n, q) => n + q.xp, 0), 'pass XP: both added, plus what the merge finished; nothing paid twice');
      r = await post('/api/pass', {}, sy); assert.equal(r.body.pass.xp, ax.pass.xp + ay.pass.xp + together.reduce((n, q) => n + q.xp, 0), 'and only once');
      // deleting the account deletes its quests
      r = await post('/api/account/delete', { confirm: 'DELETE' }, sy); assert.equal(r.body.deleted, true);
      a = await admin(); assert.deepEqual([a.stats.quests.today, a.stats.quests.week], [0, 0], 'deleting the account deletes its quests');
      r = await post('/api/session', { secret: sy }); assert.ok([...r.body.quests.daily.quests, ...r.body.quests.weekly.quests].every(q => q.progress === 0 && !q.done), 'a device of the deleted account starts afresh');
      db.close();
    } else console.log('(JSON store: skipping the backdated quest lives)');
    // old apps: run/end sends what they read; the quest fields are extra
    await post('/api/session', { secret: sx }); // (a fresh wallet: its account was deleted above)
    r = await life(sx, { survived: 30, eaten: 1, peak: 40, bestRank: 3, place: 5, of: 9, life: 0, show: 1, name: 'Old app' });
    for (const k of ['payout', 'ratingDelta', 'balance', 'earned', 'skins', 'rating', 'tier', 'runs', 'playerId', 'passUp']) assert.ok(k in r.body, 'run/end still sends ' + k);
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
  { // quests at chosen times, in both stores: the sets, progress, paying once, the daily and weekly resets, the switch, the season's end, merges and deletion
    const { questsAt, questsOf, questsTick, isoWeekOf, QUESTS, PASS_SEASONS } = require('./economy'), { SqliteStore, JsonStore } = require('./store'), at = Date.parse, s1 = PASS_SEASONS[0];
    for (const [d, w] of [['2026-11-16', '2026-W47'], ['2026-11-22', '2026-W47'], ['2026-11-23', '2026-W48'], ['2026-12-31', '2026-W53'], ['2027-01-03', '2026-W53'], ['2027-01-04', '2027-W01'], ['2024-12-30', '2025-W01'], ['2021-01-03', '2020-W53']])
      assert.equal(isoWeekOf(at(d + 'T12:00:00Z')).key, w, 'ISO week of ' + d);
    const fri = at('2026-11-20T12:00:00Z'), sets = new Set();
    for (let t = at(s1.from); t < at(s1.to); t += 864e5) for (const kind of ['day', 'week']) {
      const Q = questsAt(kind, t); sets.add(Q.list.map(q => q.id).join());
      assert.equal(Q.list.length, kind === 'day' ? 4 : 7); assert.equal(new Set(Q.list.map(q => q.id)).size, Q.list.length, Q.period + ': no quest twice');
      assert.ok(Q.list.every(q => q.goal >= 1 && q.text && q.xp === QUESTS.xp[kind]), Q.period + ': each has a goal, words and its XP');
    }
    assert.ok(sets.size > 8, 'the sets change from day to day and week to week');
    assert.deepEqual([questsAt('day', at('2026-11-20T00:00:00Z')), questsAt('day', at('2026-11-20T23:59:59.999Z'))], [questsAt('day', fri), questsAt('day', fri)], 'one set all day (UTC)');
    assert.deepEqual([questsAt('week', at('2026-11-16T00:00:00Z')), questsAt('week', at('2026-11-22T23:59:59.999Z'))], [questsAt('week', fri), questsAt('week', fri)], 'one set all week, Monday to Sunday (UTC)');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-quests-')); let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
    const open = kind => kind === 'json' ? new JsonStore(path.join(dir, 'q.json')) : new SqliteStore(sqlite, path.join(dir, 'q.sqlite'));
    const L = (survived, place, of) => ({ survived, place, of });
    for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
      let st = open(kind); const k = m => kind + ': ' + m, reopen = async () => { if (kind === 'json') await new Promise(res => setTimeout(res, 400)); else st.db.close(); st = open(kind); };
      st.setFlag('pass', 'on'); st.createPlayer('a', 'ha', 1); const a = st.player('a'), passXp = id => Number((st.passRow(id, 's1') || {}).xp) || 0;
      const view = (p, t) => questsOf(st, p, t), get = (v, id) => [...v.daily.quests, ...v.weekly.quests].find(q => q.id === id);
      const D = questsAt('day', fri), lives = D.list.find(q => q.kind === 'lives'), W = questsAt('week', fri), wLives = W.list.find(q => q.kind === 'lives');
      // progress, and the life that reaches the goal pays the pass once
      for (let i = 1; i < lives.goal; i++) assert.deepEqual(questsTick(st, a, L(30), fri), { xp: 0, done: [] }, k('life ' + i));
      assert.deepEqual(questsTick(st, a, L(30), fri), { xp: 100, done: [{ id: lives.id, text: lives.text, xp: 100, kind: 'day' }] }, k('the last life finishes it'));
      assert.equal(passXp('a'), 100, k('its XP is in the pass')); assert.equal(Number(st.player('a').xp), 0, k('not in the profile'));
      assert.deepEqual(questsTick(st, a, L(30), fri), { xp: 0, done: [] }, k('a done quest pays once')); assert.equal(passXp('a'), 100);
      assert.equal(st.questDone('a', D.period, lives.id, 9), false, k('the store marks a quest done once'));
      assert.equal(questsTick(st, a, L(19), fri).xp, 0); assert.equal(get(view(a, fri), wLives.id).progress, lives.goal + 1, k('a life under 20 s is not counted'));
      assert.equal(get(view(a, fri), D.list.find(q => q.kind === 'time').id).progress, 30 * (lives.goal + 1), k('nor is its time'));
      await reopen(); assert.deepEqual([get(view(a, fri), lives.id).done, get(view(a, fri), wLives.id).progress], [true, lives.goal + 1], k('kept'));
      // a new set at midnight UTC; the week's progress carries on until Monday
      let v = view(a, at('2026-11-20T23:59:59.999Z')); assert.deepEqual([v.daily.key, get(v, lives.id).done], ['2026-11-20', true], k('still today at 23:59:59'));
      v = view(a, at('2026-11-21T00:00:00Z')); assert.equal(v.daily.key, '2026-11-21');
      assert.ok(v.daily.quests.every(q => q.progress === 0 && !q.done), k('a fresh day at midnight')); assert.equal(get(v, wLives.id).progress, lives.goal + 1, k('the week goes on'));
      const sat = at('2026-11-21T09:00:00Z'), satLives = questsAt('day', sat).list.find(q => q.kind === 'lives');
      let paid = 0; for (let i = 0; i < satLives.goal; i++) paid += questsTick(st, a, L(30), sat).xp; assert.equal(paid, 100, k('the new day\'s lives quest pays again'));
      v = view(a, at('2026-11-22T23:59:59.999Z')); assert.deepEqual([v.weekly.key, get(v, wLives.id).progress], ['2026-W47', lives.goal + 1 + satLives.goal], k('the week counts both days'));
      v = view(a, at('2026-11-23T00:00:00Z')); assert.equal(v.weekly.key, '2026-W48', k('Monday 00:00 UTC'));
      assert.ok([...v.daily.quests, ...v.weekly.quests].every(q => q.progress === 0 && !q.done), k('a fresh week on Monday'));
      // the switch: while off there are no quests and lives move nothing; back on, it is as it was
      const mon = at('2026-11-23T12:00:00Z'); questsTick(st, a, L(30), mon); const before = view(a, mon), xpBefore = passXp('a');
      st.setFlag('pass', 'off'); assert.equal(view(a, mon), null, k('no quests while off'));
      assert.deepEqual(questsTick(st, a, L(600, 1, 10), mon), { xp: 0, done: [] }, k('lives while off do nothing'));
      st.setFlag('pass', 'on'); assert.deepEqual(view(a, mon), before, k('on again: as it was')); assert.equal(passXp('a'), xpBefore);
      // outside the season there are none, and they end with it
      assert.equal(view(a, at('2026-12-28T00:00:00Z')), null, k('none after the season')); assert.equal(view(a, at('2026-11-15T23:00:00Z')), null, k('none before it'));
      assert.deepEqual(questsTick(st, a, L(600, 1, 10), at('2026-12-28T01:00:00Z')), { xp: 0, done: [] });
      v = view(a, at('2026-12-27T12:00:00Z')); assert.deepEqual([v.daily.ends, v.weekly.ends], [at('2026-12-28'), at(s1.to)], k('the last day and week end with the season'));
      // merging: progress adds up; done on either side stays done; what the two finish together pays when the merge is settled, once
      const tue = at('2026-11-24T12:00:00Z'), T = questsAt('day', tue), tLives = T.list.find(q => q.kind === 'lives'), tLife = T.list.find(q => q.kind === 'life');
      st.createPlayer('b', 'hb', 1); st.createPlayer('c', 'hc', 1); const b = st.player('b'), c = st.player('c');
      for (let i = 0; i < tLives.goal - 2; i++) questsTick(st, b, L(30), tue);
      assert.ok(questsTick(st, b, L(tLife.sec), tue).done.some(q => q.id === tLife.id), k('b finishes the one-life quest'));
      questsTick(st, c, L(30), tue);
      const vb = view(b, tue), vc = view(c, tue), xb = passXp('b'), xc = passXp('c');
      assert.deepEqual([get(vb, tLives.id).progress, get(vc, tLives.id).progress], [tLives.goal - 1, 1], k('neither has finished the lives quest'));
      const together = [...vb.daily.quests, ...vb.weekly.quests].filter(q => !q.done && !get(vc, q.id).done && q.progress + get(vc, q.id).progress >= q.goal);
      assert.ok(together.some(q => q.id === tLives.id), k('but together they have'));
      st.mergePlayers('b', 'c'); await reopen();
      v = view(c, tue); assert.deepEqual([get(v, tLife.id).done, get(v, tLives.id).progress, get(v, tLives.id).done], [true, tLives.goal, false], k('merged: done kept, progress added'));
      assert.deepEqual(view(st.player('c'), tue).weekly.quests.map(q => q.progress), vb.weekly.quests.map((q, i) => Math.min(q.goal, q.progress + vc.weekly.quests[i].progress)), k('the week adds up too'));
      const settled = questsTick(st, st.player('c'), null, tue);
      assert.deepEqual(settled.done.map(q => q.id).sort(), together.map(q => q.id).sort(), k('settling pays what they finished together'));
      assert.equal(passXp('c'), xb + xc + settled.xp, k('to the pass, on top of both'));
      assert.deepEqual(questsTick(st, st.player('c'), null, tue), { xp: 0, done: [] }, k('once'));
      assert.deepEqual(st.questRows('b', T.period), [], k('nothing left under the merged player'));
      // testers: they see the pass while it is off and, before a season starts, the next one; nobody else does
      const { passLive } = require('./economy'), pre = at('2026-11-01T12:00:00Z'), A = { id: 'a' }, B = { id: 'b' };
      st.setFlag('pass', 'off'); st.setFlag('passTesters', JSON.stringify(['a']));
      assert.deepEqual([passLive(st, pre, A)?.key, passLive(st, pre, B), passLive(st, pre), passLive(st, fri, A)?.key, passLive(st, fri, B)], ['s1', null, null, 's1', null], k('off: only the tester, who gets the next season before it starts'));
      st.setFlag('pass', 'on');
      assert.deepEqual([passLive(st, pre, A)?.key, passLive(st, pre, B), passLive(st, fri, B)?.key], ['s1', null, 's1'], k('on: everyone in the season, only the tester before it'));
      assert.equal(passLive(st, at('2027-06-01T00:00:00Z'), A), null, k('no season left, nothing to test'));
      v = questsOf(st, a, pre); assert.ok(v && v.daily.quests.length === 4 && v.weekly.ends <= at(s1.to), k('a tester has quests before the season'));
      st.setFlag('passTesters', 'not json'); assert.equal(passLive(st, pre, A), null, k('a broken list is no testers'));
      // deletion
      st.deletePlayer('c'); assert.deepEqual(st.questRows('c', T.period), [], k('deleting the player deletes its quests')); assert.equal(st.questStats(T.period), 0);
      await reopen(); assert.deepEqual(st.questRows('c', T.period), [], k('and stays deleted'));
      assert.ok(st.questStats(D.period) >= 1, k('quest stats per period'));
      if (kind === 'sqlite') st.db.close();
    }
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
      st.addStats('a', { played: 5, wins: 2, podiums: 3, alive: 600, eaten: 9 }, 1500); st.addStats('b', { played: 2, wins: 1, podiums: 1, alive: 100, eaten: 1 }, 1200);
      st.addTrophies('a', ['amoeba', 'colony', 'interphase', 'prophase'], 50); st.addTrophies('b', ['amoeba', 'colony'], 20); st.addTrophies('b', ['amoeba'], 99);
      await reopen();
      assert.deepEqual(st.trophies('b').sort((x, y) => x.at - y.at || (x.step < y.step ? -1 : 1)), [{ step: 'amoeba', at: 20 }, { step: 'colony', at: 20 }], kind + ': a trophy is won once, with its first date');
      st.mergePlayers('a', 'b'); assert.equal(st.player('a'), null); assert.equal(Number(st.player('b').xp), 650, kind + ': merging adds the XP together');
      assert.deepEqual(['played', 'wins', 'podiums', 'alive', 'eaten', 'peak'].map(k => Number(st.player('b')[k])), [7, 3, 4, 700, 10, 1500], kind + ': merging adds the stats and keeps the best peak');
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

  const h = await (await fetch(base + '/health')).json(); assert.equal(h.accounts, 2, 'the signed-out device and the fresh one that signed in after the deletion');
  console.log(`all economy API tests passed (${h.store} store)`);
})().then(() => { child.kill(); keyServer.close(); process.exit(0); }).catch(e => { console.error(e); child.kill(); keyServer.close(); process.exit(1); });
