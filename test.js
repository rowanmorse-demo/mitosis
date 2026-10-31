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
  { env: { ...process.env, PORT, DATA_DIR: dataDir, MAX_ROOMS: '3', IAP_UNVERIFIED: '1', AUTH_APPLE_JWKS: `http://127.0.0.1:${KEY_PORT}/apple`, AUTH_GOOGLE_JWKS: `http://127.0.0.1:${KEY_PORT}/google`, GOOGLE_CLIENT_IDS: 'test-google-client' }, stdio: ['ignore', 'ignore', 'inherit'] });
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
  // rating: that run (15 s on the server clock, 10 kills) is a quick death: +0.5 survival +20 kills -7.5 penalty = +13
  assert.equal(r.body.ratingDelta, 13); assert.equal(r.body.rating, 1013); assert.equal(r.body.tier, 'Silver');
  r = await post('/api/run/end', { runId, survived: 9999, eaten: 10, peak: 800 }, secret);
  assert.equal(r.body.duplicate, true); assert.equal(r.body.balance, 0, 'ending a run twice pays once');
  r = await post('/api/run/end', { runId: 'nope' }, secret); assert.equal(r.status, 404);
  // an instant death with no kills loses rating
  r = await post('/api/run/start', {}, secret); const run2 = r.body.runId;
  r = await post('/api/run/end', { runId: run2, survived: 0, eaten: 0, peak: 25, name: 'Tester' }, secret); assert.equal(r.body.ratingDelta, -10); assert.equal(r.body.rating, 1003);
  const lb = await (await fetch(base + '/api/leaderboard')).json(); assert.equal(lb.top[0].name, 'Tester'); assert.equal(lb.top[0].rating, 1003);
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
    const open = () => new Promise((res, rej) => { const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { headers: { Origin: base } }), g = { ws, heard: new Set() };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello' }));
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
    inArena.add(33);
    await until('the player in room 3 is counted', async () => (await now()).rooms[2].arena === 1);
    const late2 = await open(); assert.ok(late2.peers.includes(games[33].id) && late2.peers.length === 8, 'the newcomer joins room 3, where a player is in the arena');
    // fill every room: 48 games are in, and only the 49th is turned away (and counted)
    const fill = []; for (let i = 0; i < 9; i++) fill.push(await open());
    assert.ok(!fill.includes('full'), 'the server takes games until every room is full');
    s = await expect('three full rooms', { online: 48 }); assert.deepEqual(s.rooms.map(r => r.games), [16, 16, 16]);
    assert.equal(await open(), 'full', 'the 49th game is turned away');
    s = await now(); assert.equal(s.rows.filter(r => r[0] >= minuteNow).reduce((n, r) => n + r[s.cols.indexOf('full') + 1], 0), 1, 'the turned-away game is in the history');
    // a room that empties closes, and the rooms after it move up
    for (const g of [...games.slice(0, 16), late]) g.ws.close();
    s = await expect('room 1 closed', { online: 32 }); assert.deepEqual(s.rooms.map(r => r.games), [16, 16]);
    clearInterval(talk); for (const g of [...games, late2, ...fill]) g.ws.close();
    await expect('everyone left', { online: 0, rooms: [] });
    assert.equal((await (await fetch(base + '/health')).json()).rooms, 0);
    ctl.abort();
    const html = await (await fetch(base + '/admin/live' + tq)).text(); assert.match(html, /<title>Mitosis live players<\/title>/); assert.match(html, /EventSource/);
  }
  // a refused name never reaches the leaderboard: the player keeps their last good one
  r = await post('/api/run/start', {}, secret); r = await post('/api/run/end', { runId: r.body.runId, survived: 30, eaten: 0, peak: 25, name: 'sh1t head' }, secret); assert.equal(r.status, 200);
  { const lb2 = await (await fetch(base + '/api/leaderboard')).json(); assert.equal(lb2.top[0].name, 'Tester', 'blocked names are not stored'); }

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

  // A second device signs in with the same Apple account: it joins the account and brings its own ATP along
  const secret2 = 'secondsecret' + 'b'.repeat(20);
  r = await post('/api/session', { secret: secret2 }); assert.equal(r.body.balance, 0); assert.equal(r.body.account, null);
  r = await post('/api/iap/google', { purchaseToken: 'tok3', productId: 'atp_500', orderId: 'GPA.3' }, secret2); assert.equal(r.body.balance, 500);
  r = await post('/api/auth/apple', { identityToken: apple(), nonce: 'n1' }, secret2);
  assert.equal(r.status, 200); assert.equal(r.body.merged, true); assert.equal(r.body.balance, 2200, 'the two wallets merge'); assert.deepEqual(r.body.skins, [9]); assert.equal(r.body.account.provider, 'apple');
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
  r = await post('/api/iap/apple', { transactionId: 't1', jws }, secret3); assert.equal(r.body.duplicate, true, 'an old receipt cannot be credited again after deletion'); assert.equal(r.body.balance, 0);
  r = await post('/api/auth/apple', { identityToken: apple(), nonce: 'n1' }, secret3); assert.equal(r.status, 200); assert.equal(r.body.merged, false, 'the Apple ID no longer leads to the deleted account'); assert.equal(r.body.balance, 0);
  { const lb = await (await fetch(base + '/api/leaderboard')).json(); assert.ok(Array.isArray(lb.top) && lb.top.every(t => t.runs !== undefined), 'leaderboard still answers'); assert.equal(lb.top.length, 0, 'the deleted player is gone from the leaderboard'); }

  const h = await (await fetch(base + '/health')).json(); assert.equal(h.accounts, 2, 'the signed-out device and the fresh one that signed in after the deletion');
  console.log(`all economy API tests passed (${h.store} store)`);
})().then(() => { child.kill(); keyServer.close(); process.exit(0); }).catch(e => { console.error(e); child.kill(); keyServer.close(); process.exit(1); });
