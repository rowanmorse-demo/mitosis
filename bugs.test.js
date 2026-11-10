// Bug reports (bugs.js): cleaning and size caps, rate limits per player and per address, statuses, keeping and forgetting
// on both stores; then the API, the escaped admin page and its JSON on a throwaway server.  Run:  node bugs.test.js
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const bugReports = require('./bugs');
const { SqliteStore, JsonStore } = require('./store');

const HOUR = 3600e3, DAY = 24 * HOUR;
const EVIL = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';

function cleanTests() {
  const c = bugReports.clean;
  assert.throws(() => c({}), e => e.status === 400, 'no description');
  assert.throws(() => c({ text: '  \n ' }), e => e.status === 400, 'blank description');
  assert.throws(() => c({ text: 'It froze', email: 'not an email' }), e => e.status === 400, 'a bad email');
  assert.throws(() => c({ text: 'It froze', email: 'a@b.c<script>' }), e => e.status === 400, 'an email with markup');
  const r = c({ text: 'x'.repeat(5000), email: 'me@example.com', platform: 'ios', app: 'ios-2.3.0-p3<b>', os: 'iOS 18.7', device: 'iPhone', screen: '844x390@3', mode: 'ranked', ping: '83.4', fps: 59.6,
    log: Array.from({ length: 100 }, (_, i) => 'error ' + i), secret: 'abc', playerId: 'spoof' });
  assert.equal(r.text.length, bugReports.TEXT_MAX, 'the description is cut to 1,000 characters');
  assert.equal(r.app, 'ios-2.3.0-p3b', 'the version keeps only version characters');
  assert.deepEqual([r.platform, r.screen, r.ping, r.fps, r.email], ['ios', '844x390@3', 83, 60, 'me@example.com'], 'details kept');
  assert.equal(r.log.split('\n').length, 40, 'the last 40 log lines');
  assert.ok(r.log.startsWith('error 60'), 'the newest ones');
  assert.ok(!('secret' in r) && !('playerId' in r), 'nothing else from the body is kept');
  const odd = c({ text: 'a\u0000b‮c\r\nd\n\n\n\ne', platform: 'symbian', screen: '100x100; drop', ping: -5, fps: 9999, log: 'x'.repeat(9000) });
  assert.equal(odd.text, 'a bc\nd\n\ne', 'control characters and bidi overrides go, new lines stay (at most one blank line)');
  assert.deepEqual([odd.platform, odd.screen, odd.ping, odd.fps, odd.app], ['web', '', null, null, 'unknown'], 'bad details are dropped');
  assert.equal(odd.log.length, 4000, 'a log string is capped');
}

async function moduleTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-bugs-'));
  let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
  for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
    const k = s => kind + ': ' + s;
    const store = kind === 'json' ? new JsonStore(path.join(dir, 'm.json')) : new SqliteStore(sqlite, path.join(dir, 'm.sqlite'));
    let clock = Date.parse('2026-11-20T15:00:00Z');
    const bugs = bugReports.create({ store, now: () => clock, log: () => {} });
    const R = (body, player, ip = '1.1.1.1') => bugs.handlers.report(store, { text: 'The shop froze', ...body }, player, { ip });
    const A = { id: 'alice' }, B = { id: 'bob' };

    const r1 = R({ cid: 'abcdefgh-1', app: 'ios-2.3.0' }, A);
    assert.ok(r1.ok && r1.saved && /^[0-9a-f]{10}$/.test(r1.id), k('kept'));
    const dup = R({ cid: 'abcdefgh-1' }, A);
    assert.ok(dup.ok && !dup.saved, k('the same cid again: ok, not kept twice'));
    assert.equal(store.bugs().length, 1, k('a queued report sent twice is kept once'));
    const b = store.bug(r1.id);
    assert.deepEqual([b.player, b.status, b.data.app, b.data.text], ['alice', 'new', 'ios-2.3.0', 'The shop froze'], k('stored with the player id, status new'));
    assert.ok(!JSON.stringify(b).includes('secret'), k('no secret stored'));
    R({ text: 'anonymous one' }, null, '2.2.2.2');
    assert.equal(store.bugs().find(x => x.data.text === 'anonymous one').player, null, k('a report without sign-in has no player'));

    // limits: 5 an hour and 20 a day per player; 10 an hour and 40 a day per address
    for (let i = 0; i < 3; i++) R({}, A, '3.3.3.' + i); // alice is at 5 this hour (the duplicate counted)
    assert.throws(() => R({}, A, '9.9.9.9'), e => e.status === 429, k('a player\'s sixth report in an hour is refused'));
    R({}, B, '9.9.9.9');
    clock += HOUR + 1;
    R({}, A, '4.4.4.4');
    assert.ok(store.bugs().length >= 7, k('the next hour alice can report again'));
    for (let i = 0; i < 10; i++) R({}, null, '5.5.5.5');
    assert.throws(() => R({}, null, '5.5.5.5'), e => e.status === 429, k('an address\'s eleventh report in an hour is refused'));
    assert.throws(() => R({}, { id: 'carol' }, '5.5.5.5'), e => e.status === 429, k('...whoever is signed in'));
    let day = 0; for (let h = 0; h < 30 && day < 40; h++) { clock += HOUR + 1; for (let i = 0; i < 10 && day < 40; i++) { try { R({}, null, '6.6.6.6'); day++; } catch (e) { break; } } }
    assert.throws(() => R({}, null, '6.6.6.6'), e => e.status === 429, k('40 a day per address'));

    clock += DAY + 1; let all = 0; for (let i = 0; i < 400; i++) { try { R({}, null, '10.9.' + i); all++; } catch (e) { assert.equal(e.status, 429, k('refused, not failed')); } }
    assert.equal(all, 300, k('at most 300 an hour in all, whatever the addresses'));

    // statuses, notes and the fixing commit
    assert.throws(() => bugs.update(r1.id, { status: 'done' }), e => e.status === 400, k('only known statuses'));
    assert.throws(() => bugs.update('nope', { status: 'seen' }), e => e.status === 404, k('no such report'));
    const u = bugs.update(r1.id, { status: 'fixed', fixed: 'abc1234', notes: 'Shop list was empty\u0000 on first open' });
    assert.deepEqual([u.status, u.fixed, u.notes], ['fixed', 'abc1234', 'Shop list was empty  on first open'], k('marked fixed with its commit'));
    assert.equal(bugs.update(r1.id, { notes: 'still fixed' }).status, 'fixed', k('fields left out stay'));
    const l = bugs.list({ status: 'open' });
    assert.ok(l.bugs.every(x => x.status === 'new') && l.counts.fixed === 1, k('open lists new and seen'));
    assert.deepEqual(bugs.list({ app: 'ios-2.3.0' }).bugs.map(x => x.id), [r1.id], k('filtered by version'));

    // keeping: 180 days, and none once the account is deleted
    bugs.forget('alice');
    assert.ok(!store.bugs().some(x => x.player === 'alice'), k('deleting an account deletes its reports'));
    const n = store.bugs().length; clock += 181 * DAY; bugs.prune();
    assert.equal(store.bugs().length, 0, k(`reports older than ${bugReports.KEEP_DAYS} days go (${n} were kept)`));
    if (store.db) store.db.close();
  }
}

async function serverTests() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-bugs-srv-'));
  const PORT = 4900 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`, TOKEN = 'test-admin-token-123';
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, ADMIN_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'inherit'] });
  const post = async (p, body, auth, headers = {}) => { const r = await fetch(base + '/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    for (let i = 0; i < 150; i++) { if (child.exitCode != null) throw new Error('server exited (port ' + PORT + ' in use?)'); try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
    const secret = 'bugtest' + require('crypto').randomBytes(12).toString('hex'), s = await post('session', { secret }), me = s.j.playerId;
    assert.ok(secret && me, 'a player');
    let r = await post('bug', { text: EVIL, email: 'me@example.com', app: 'ios-2.3.0-p3', platform: 'ios', os: 'iOS 18.7', screen: '844x390@3', mode: 'ranked', ping: 80, fps: 60, log: ['error x @1:2', EVIL], cid: 'cid-0000001' }, secret);
    assert.equal(r.status, 200, 'a signed-in report is kept'); assert.ok(r.j.saved);
    r = await post('bug', { text: 'No sign-in' }, null, { 'X-Forwarded-For': '10.0.0.7' });
    assert.ok(r.status === 200 && r.j.saved, 'a report without sign-in is kept too');
    r = await post('bug', { text: 'Bad secret' }, 'not-a-real-secret', { 'X-Forwarded-For': '10.0.0.8' });
    assert.ok(r.status === 200 && r.j.saved, 'a stale secret still files the report, without a player');
    r = await post('bug', { text: '' }, secret); assert.equal(r.status, 400, 'an empty report is refused');
    r = await post('bug', JSON.stringify({ text: 'x'.repeat(20000) }), secret).catch(() => ({ status: 413 })); // the server answers 413 or just drops the upload
    assert.equal(r.status, 413, 'a body over 16 KB is refused');
    for (let i = 0; i < 4; i++) await post('bug', { text: 'again ' + i }, secret, { 'X-Forwarded-For': '10.1.0.' + i });
    r = await post('bug', { text: 'one too many' }, secret, { 'X-Forwarded-For': '10.2.0.1' });
    assert.equal(r.status, 429, 'the per-player limit holds over the API');

    // the admin page: token, escaping, filters, JSON, updates
    assert.equal((await fetch(base + '/admin/bugs')).status, 403, 'no token: forbidden');
    assert.equal((await fetch(base + '/admin/bugs?token=wrong-token-of-same-len')).status, 403, 'a wrong token: forbidden');
    const pg = await fetch(base + '/admin/bugs?token=' + TOKEN), html = await pg.text();
    assert.equal(pg.status, 200, 'the page');
    assert.match(pg.headers.get('content-security-policy') || '', /default-src 'none'/, 'a strict CSP');
    assert.ok(!html.includes('<script>') && !html.includes('<img src=x'), 'no player markup reaches the page');
    assert.ok(html.includes('&#60;script&#62;alert(1)&#60;/script&#62;'), 'the report text shows escaped');
    assert.ok(!/<[a-z][^>]*\son\w+=/i.test(html), 'no inline event handlers at all');
    const j = await (await fetch(base + '/admin/bugs?format=json&status=open&token=' + TOKEN)).json();
    assert.equal(j.bugs.length, 7, 'seven open reports'); assert.equal(j.counts.new, 7);
    const mine = j.bugs.find(b => b.data.email === 'me@example.com');
    assert.equal(mine.player, me, 'the report carries the player id from the signature');
    assert.ok(!JSON.stringify(j).includes(secret), 'the secret is nowhere in the reports');
    assert.deepEqual(j.apps.map(a => a.app).sort(), ['ios-2.3.0-p3', 'unknown'], 'versions to filter by');
    const up = await fetch(base + '/admin/bugs?format=json&token=' + TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: mine.id, status: 'fixed', fixed: 'deadbee', notes: 'escaped <b>' }) });
    assert.equal(up.status, 200, 'marked fixed (JSON)');
    const form = await fetch(base + '/admin/bugs?status=open&token=' + TOKEN, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: j.bugs[1].id, status: 'wontfix', notes: '', fixed: '' }) });
    assert.equal(form.status, 303, 'the form redirects back'); assert.match(form.headers.get('location'), /status=open/, '...to the same filter');
    const j2 = await (await fetch(base + '/admin/bugs?format=json&token=' + TOKEN)).json();
    assert.deepEqual([j2.counts.fixed, j2.counts.wontfix, j2.counts.new], [1, 1, 5], 'statuses counted');
    assert.ok((await (await fetch(base + '/admin/bugs?token=' + TOKEN)).text()).includes('escaped &#60;b&#62;'), 'notes show escaped too');
    const bad = await fetch(base + '/admin/bugs?format=json&token=' + TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: mine.id, status: 'gone' }) });
    assert.equal(bad.status, 400, 'an unknown status is refused');

    // deleting the account deletes its reports
    assert.equal((await post('account/delete', { confirm: 'DELETE' }, secret)).status, 200, 'account deleted');
    const j3 = await (await fetch(base + '/admin/bugs?format=json&token=' + TOKEN)).json();
    assert.ok(!j3.bugs.some(b => b.player === me), 'the deleted player\'s reports are gone');
  } finally { child.kill(); }
}

(async () => {
  cleanTests(); console.log('bugs: cleaning ok');
  await moduleTests(); console.log('bugs: module ok');
  await serverTests(); console.log('bugs: API and admin page ok');
})().catch(e => { console.error(e); process.exit(1); });
