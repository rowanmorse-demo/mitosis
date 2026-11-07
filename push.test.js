// Push notifications (push.js): storage, switches and rate limits on both stores; the APNs sender against a stand-in
// for Apple (tools/apns-mock.js) that checks the provider token like Apple does; the FCM sender against a fake Google;
// then the API and the admin page on a throwaway server.  Run:  node push.test.js
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto'), assert = require('assert');
const pushes = require('./push'), mock = require('./tools/apns-mock');
const { SqliteStore, JsonStore } = require('./store');

const HOUR = 3600e3, DAY = 24 * HOUR;
const hex = n => crypto.randomBytes(32).toString('hex').replace(/^./, String(n % 10)); // a 64-character iOS token
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); // a test key, not an Apple one
const KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

/* ---------- the module on both stores, with a recording sender ---------- */
async function moduleTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-push-'));
  let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
  for (const kind of sqlite ? ['sqlite', 'json'] : ['json']) {
    const k = s => kind + ': ' + s;
    const store = kind === 'json' ? new JsonStore(path.join(dir, 'm.json')) : new SqliteStore(sqlite, path.join(dir, 'm.sqlite'));
    let clock = Date.parse('2026-11-20T15:00:00Z');
    const got = [], dead = new Set();
    const fake = { send: async (t, note) => { got.push({ token: t.token, env: t.env, note }); return dead.has(t.token) ? { dead: 'Unregistered' } : { ok: true }; } };
    const push = pushes.create({ store, dataDir: dir, config: { apns: null, fcm: null }, senders: { ios: fake, android: fake }, now: () => clock, log: () => {} });
    const P = id => ({ id }), A = P('alice'), B = P('bob');
    const r0 = push.handlers.prefs(store, {}, A);
    assert.deepEqual(r0.kinds.map(x => x.id), ['party', 'friends', 'quests', 'pass', 'shop'], k('the kinds a player can switch, test hidden'));
    assert.deepEqual([r0.off, r0.devices], [[], 0], k('everything on, no device'));
    assert.deepEqual(await push.notify('alice', 'party', { title: 'x', body: 'y' }), { sent: 0, dead: 0, errors: [], skipped: 'no device' }, k('no device: nothing to send'));

    // registering
    for (const bad of [{ platform: 'ios', token: 'zz' }, { platform: 'ios', token: 'g'.repeat(64) }, { platform: 'web', token: 'a'.repeat(64) }, { platform: 'android', token: 'short' }])
      assert.throws(() => push.handlers.register(store, bad, A), e => e.status === 400, k('rejects ' + JSON.stringify(bad)));
    const tA = hex(1), tA2 = 'f' + 'A'.repeat(63);
    let v = push.handlers.register(store, { platform: 'ios', token: tA, env: 'sandbox', app: 'ios-2.3.0', tz: 'Australia/Sydney' }, A);
    assert.equal(v.devices, 1, k('registered'));
    push.handlers.register(store, { platform: 'ios', token: tA, env: 'sandbox', app: 'ios-2.3.0', tz: 'Australia/Sydney' }, A);
    assert.equal(push.handlers.prefs(store, {}, A).devices, 1, k('the same token again is still one device'));
    push.handlers.register(store, { platform: 'ios', token: tA2, env: 'nonsense', tz: 'Not/AZone' }, A);
    const fcm = 'cTok3n:APA91b' + 'x'.repeat(140);
    push.handlers.register(store, { platform: 'android', token: fcm, app: 'android-2.3.0' }, A);
    assert.equal(push.handlers.prefs(store, {}, A).devices, 3, k('two iPhones and an Android'));

    // sending
    let r = await push.notify('alice', 'party', { title: 'Ti invited you', body: 'Join their party', link: 'friends' });
    assert.deepEqual([r.sent, r.dead, r.errors, r.skipped], [3, 0, [], undefined], k('sent to every device'));
    const byTok = Object.fromEntries(got.map(g => [g.token, g]));
    assert.equal(byTok[tA].env, 'sandbox', k('the token keeps its environment'));
    assert.equal(byTok[tA2.toLowerCase()].env, 'production', k('iOS tokens are kept lower case; an unknown environment is production'));
    assert.equal(byTok[fcm].env, null, k('Android tokens have no environment'));
    assert.deepEqual(byTok[tA].note, { kind: 'party', title: 'Ti invited you', body: 'Join their party', link: 'friends', collapse: null, data: null, urgent: true, ttl: 300 }, k('what a sender is given'));
    got.length = 0;
    r = await push.notify('alice', 'party', { title: 'again', body: '', link: 'javascript:alert(1)' });
    assert.equal(r.skipped, 'limit', k('a second party invite within 2 minutes waits'));
    clock += 3 * 60e3;
    r = await push.notify('alice', 'party', { title: 'again', body: '', link: 'javascript:alert(1)' });
    assert.equal(r.sent, 3, k('after the gap it goes'));
    assert.equal(got[0].note.link, 'friends', k('an unknown link falls back to the kind\'s screen'));

    // switches
    v = push.handlers.prefs(store, { off: ['party', 'test', 'bogus', 'party'] }, A);
    assert.deepEqual(v.off, ['party'], k('only real, visible kinds can be switched off, once each'));
    clock += 10 * 60e3;
    assert.equal((await push.notify('alice', 'party', { title: 'x', body: 'y' })).skipped, 'off', k('a kind switched off is not sent'));
    assert.equal((await push.notify('alice', 'test', { title: 'x', body: 'y' })).sent, 3, k('the admin test ignores the switches'));
    push.handlers.prefs(store, { off: ['all'] }, A);
    assert.equal((await push.notify('alice', 'friends', { title: 'x', body: 'y' })).skipped, 'off', k('all off: nothing'));
    push.handlers.prefs(store, { off: [] }, A);

    // the daily cap across kinds, and quiet hours where the player is
    const bobTok = hex(2); push.handlers.register(store, { platform: 'ios', token: bobTok, tz: 'Europe/London' }, B);
    clock = Date.parse('2026-11-21T12:00:00Z');                                          // noon in London
    for (const kind of ['quests', 'pass', 'shop', 'friends']) assert.equal((await push.notify('bob', kind, { title: kind, body: '' })).sent, 1, k(kind + ' goes'));
    clock += 11 * 60e3;
    assert.equal((await push.notify('bob', 'party', { title: 'p', body: '' })).skipped, 'limit', k(`no more than ${pushes.DAILY_MAX} a day in all`));
    assert.equal((await push.notify('bob', 'test', { title: 't', body: '' })).sent, 1, k('tests are not counted'));
    clock += DAY;
    assert.equal((await push.notify('bob', 'quests', { title: 'q', body: '' })).sent, 1, k('the next day the quests go again'));
    clock = Date.parse('2026-11-23T23:30:00Z');                                          // 23:30 in London
    assert.equal((await push.notify('bob', 'shop', { title: 's', body: '' })).skipped, 'quiet', k('no shop news at night'));
    assert.equal((await push.notify('bob', 'party', { title: 'p', body: '' })).sent, 1, k('a friend inviting you now is not held back'));
    assert.equal((await push.notify('bob', 'shop', { title: 's', body: '' }, { force: true })).sent, 1, k('force skips the limits'));
    assert.ok(pushes.quietAt('Asia/Tokyo', Date.parse('2026-11-23T14:00:00Z')) && !pushes.quietAt('Asia/Tokyo', Date.parse('2026-11-23T03:00:00Z')) && !pushes.quietAt(null, 0), k('quiet hours by time zone'));

    // dead tokens go
    dead.add(tA); clock += HOUR;
    r = await push.notify('alice', 'test', { title: 'x', body: 'y' });
    assert.deepEqual([r.sent, r.dead], [2, 1], k('a dead token is reported'));
    assert.equal(push.handlers.prefs(store, {}, A).devices, 2, k('and dropped'));
    push.handlers.unregister(store, { token: tA2 }, A);
    assert.equal(push.handlers.prefs(store, {}, A).devices, 1, k('unregister drops this device'));
    push.handlers.unregister(store, { token: bobTok }, A);
    assert.equal(push.handlers.prefs(store, {}, B).devices, 1, k('but not someone else\'s'));

    // a device that changes hands (sign out, new wallet) belongs to whoever registered it last
    push.handlers.register(store, { platform: 'ios', token: bobTok }, A);
    assert.deepEqual([push.handlers.prefs(store, {}, A).devices, push.handlers.prefs(store, {}, B).devices], [2, 0], k('the token moved to alice'));
    for (let i = 0; i < 12; i++) { clock += 1000; push.handlers.register(store, { platform: 'ios', token: hex(i + 3) }, A); }
    assert.equal(push.handlers.prefs(store, {}, A).devices, 10, k('at most 10 devices a player'));

    // sign-in merges, and account deletion
    const cTok = hex(9); push.handlers.register(store, { platform: 'ios', token: cTok }, P('carol')); push.handlers.prefs(store, { off: ['shop'] }, P('carol'));
    push.handlers.prefs(store, { off: ['quests'] }, P('dave'));
    push.merge('carol', 'dave');
    assert.deepEqual([push.handlers.prefs(store, {}, P('dave')).devices, push.handlers.prefs(store, {}, P('dave')).off], [1, ['quests']], k('the device joins the account, which keeps its own switches'));
    assert.deepEqual(push.handlers.prefs(store, {}, P('carol')).off, [], k('the folded player has no switches left'));
    push.forget('dave');
    assert.deepEqual([push.handlers.prefs(store, {}, P('dave')).devices, push.handlers.prefs(store, {}, P('dave')).off], [0, []], k('deleting the account deletes its devices and switches'));

    const st = push.stats(clock);
    assert.ok(st.devices.some(d => d.platform === 'ios' && d.n >= 10), k('stats count devices'));
    assert.ok(push.recent(5)[0].player === 'alice', k('recent lists players by last registration'));
    if (kind === 'json') { await sleep(400); const again = pushes.create({ store: new JsonStore(path.join(dir, 'm2.json')), dataDir: dir, config: {}, log: () => {} }); assert.equal(again.handlers.prefs(null, {}, A).devices, 10, k('push.json survives a restart')); }
    else store.db.close();
  }
}

/* ---------- the triggers (push-triggers.js), through a simulated calendar ---------- */
async function triggerTests() {
  let sqlite = null; try { sqlite = require('node:sqlite'); } catch (e) {}
  if (!sqlite) { console.log('(no node:sqlite: trigger tests skipped)'); return; }
  const economy = require('./economy'), social = require('./social'), triggers = require('./push-triggers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-triggers-')), store = new SqliteStore(sqlite, path.join(dir, 't.sqlite'));
  let clock = Date.parse('2026-10-24T12:00:00Z');
  const at = iso => { clock = Date.parse(iso); process.env.MITOSIS_DATE = iso; }; // economy's "now" too (the pass view)
  const got = [];
  const fake = { send: async (t, note) => { got.push({ to: t.player || t.token, token: t.token, note }); return { ok: true }; } };
  const push = pushes.create({ store, dataDir: dir, config: { apns: null, fcm: null }, senders: { ios: fake }, now: () => clock, log: () => {} });
  const events = [], soc = social.create({ file: path.join(dir, 'social.json'), now: () => clock, onEvent: e => events.push(e) });
  const tr = triggers.create({ store, push, economy, social: soc, now: () => clock });
  const toks = {};
  const player = (id, tz, seenDaysAgo = 1) => { const p = store.createPlayer(id, 'h' + id, clock); store.touch(id, clock - seenDaysAgo * DAY); toks[id] = hex(id.length + id.charCodeAt(0));
    push.handlers.register(store, { platform: 'ios', token: toks[id], tz }, p); return store.player(id); };
  const sentTo = (id, kind) => got.filter(g => g.token === toks[id] && (!kind || g.note.kind === kind));
  const flush = () => new Promise(r => setImmediate(r));

  // Halloween opens: one shop push to each recent player, once
  const londoner = player('london', 'Europe/London'), sydney = player('sydney', 'Australia/Sydney'), gone = player('gone', 'Europe/London', 45), shy = player('shy', 'Europe/London');
  push.handlers.prefs(store, { off: ['shop'] }, shy);
  let r = await tr.tick();
  assert.deepEqual(tr.openEvents(clock).map(e => [e.id, e.skins, e.until]), [['halloween-2026', 4, 'Nov 3']], 'Halloween is open with its 4 skins');
  assert.equal(sentTo('london', 'shop').length, 1, 'a recent player hears Halloween is back');
  assert.deepEqual([sentTo('london', 'shop')[0].note.title, sentTo('london', 'shop')[0].note.body, sentTo('london', 'shop')[0].note.link], ['Halloween is back', '4 limited Halloween skins are in the Shop until Nov 3.', 'shop']);
  assert.equal(sentTo('sydney', 'shop').length, 0, 'not at 23:00 in Sydney');
  assert.equal(sentTo('gone', 'shop').length, 0, 'not to a player away for 45 days');
  assert.equal(sentTo('shy', 'shop').length, 0, 'not to a player with Shop switched off');
  assert.ok(r.held >= 1, 'the night one is held for later');
  at('2026-10-25T00:30:00Z'); await tr.tick();                                    // 11:30 in Sydney
  assert.equal(sentTo('sydney', 'shop').length, 1, 'Sydney gets it in the morning');
  await tr.tick(); assert.equal(got.filter(g => g.note.kind === 'shop').length, 2, 'nobody gets it twice');
  at('2026-11-01T12:00:00Z'); player('late', 'Europe/London'); await tr.tick();
  assert.equal(sentTo('late', 'shop').length, 0, 'a week into the event, nobody new is told');

  // friends and parties, as they happen
  const A = { id: 'london' }, B = { id: 'sydney' };
  soc.handlers.me(store, { name: 'Rowan' }, A); soc.handlers.me(store, { name: 'Ti' }, B);
  at('2026-11-02T09:00:00Z');                                                     // both apps closed for a while
  const codeA = soc.handlers.add(store, { code: soc.handlers.me(store, {}, B).code }, A).code; at('2026-11-02T09:05:00Z');
  await flush(); assert.deepEqual(events.map(e => [e.type, e.from, e.to, e.name]), [['request', 'london', 'sydney', 'Rowan']], 'a friend request is an event');
  for (const e of events.splice(0)) await tr.onSocial(e);
  let n = sentTo('sydney', 'friends').at(-1).note;
  assert.deepEqual([n.title, n.link, n.collapse], ['Rowan wants to be friends', 'friends', 'fr-london'], 'B hears about the request');
  soc.handlers.accept(store, { code: codeA }, B); await flush();
  assert.equal(events[0].type, 'accepted', 'accepting is an event');
  at('2026-11-02T09:20:00Z'); for (const e of events.splice(0)) await tr.onSocial(e);
  assert.equal(sentTo('london', 'friends').at(-1).note.title, 'Ti accepted your friend request', 'A hears B said yes');
  soc.handlers.partyInvite(store, { code: soc.handlers.me(store, {}, B).code }, A); await flush();
  at('2026-11-02T10:00:00Z'); const inv = events.splice(0)[0]; await tr.onSocial(inv);
  n = sentTo('sydney', 'party').at(-1).note;
  assert.deepEqual([inv.type, n.title, n.link, n.urgent, n.ttl, n.collapse], ['invite', 'Rowan invited you to a party', 'friends', true, 300, 'party-' + inv.party], 'B hears about the party invite');
  soc.handlers.me(store, {}, B); soc.handlers.partyInvite(store, { code: soc.handlers.me(store, {}, B).code }, A); await flush();
  at('2026-11-02T10:00:20Z'); assert.equal(await tr.onSocial(events.splice(0)[0]), null, 'not while their game is open (it checked in 20 s ago)');

  // the season starts: everyone recent hears once, the night owls later
  store.setFlag('pass', 'on');
  at('2026-11-16T10:00:00Z');
  player('la', 'America/Los_Angeles');                                             // 02:00 there
  await tr.tick();
  n = sentTo('london', 'pass').at(-1).note;
  assert.deepEqual([n.title, n.link], ['Season 1: Bloom has started', 'pass'], 'the season start');
  assert.equal(sentTo('la', 'pass').length, 0, 'held at night in Los Angeles');
  at('2026-11-16T18:00:00Z'); await tr.tick();
  assert.equal(sentTo('la', 'pass').length, 1, '10:00 in Los Angeles: sent');
  assert.equal(sentTo('london', 'pass').length, 1, 'still once each');
  at('2026-11-20T10:00:00Z'); player('newbie', 'Europe/London'); await tr.tick();
  assert.equal(sentTo('newbie', 'pass').length, 0, 'four days in, it is old news');

  // today's quests, in each player's evening, unless they've opened the game today
  at('2026-11-20T08:00:00Z'); store.touch('london', clock - DAY); await tr.tick();
  assert.equal(sentTo('london', 'quests').length, 0, 'not in the morning');
  store.touch('newbie', Date.parse('2026-11-20T09:00:00Z'));                      // opened the game this morning
  at('2026-11-20T18:00:00Z'); await tr.tick();
  const day = economy.questsAt('day', clock);
  n = sentTo('london', 'quests').at(-1).note;
  assert.deepEqual([n.title, n.link], ["Today's quests are waiting", 'quests']);
  assert.ok(n.body.startsWith(day.list[0].text + ', ') && /and 2 more\. 100 Battle Pass XP each\.$/.test(n.body), 'the body names two quests: ' + n.body);
  await tr.tick(); assert.equal(sentTo('london', 'quests').length, 1, 'once a day');
  assert.equal(sentTo('newbie', 'quests').length, 0, 'not to a player who opened the game today');
  assert.equal(sentTo('gone', 'quests').length, 0, 'not to a player away for weeks');
  at('2026-11-21T07:00:00Z'); store.touch('sydney', clock - DAY); await tr.tick();  // 18:00 in Sydney
  assert.equal(sentTo('sydney', 'quests').length, 1, 'Sydney gets them in its evening');
  store.setFlag('pass', 'off'); at('2026-11-21T18:30:00Z'); store.touch('london', clock - DAY); await tr.tick(); store.setFlag('pass', 'on');
  assert.equal(sentTo('london', 'quests').length, 1, 'no quests while the pass is off');

  // the season's last days: only players with rewards they can claim
  at('2026-12-26T20:00:00Z'); store.touch('london', clock - DAY); store.touch('la', clock - DAY); // 20:00 in London, 12:00 in Los Angeles
  store.passAddXp('london', 's1', 900, clock);                                     // level 4: rewards to claim
  economy.handlers.passClaim(store, { reward: '1b' }, store.player('la'));          // la claimed the one free reward they could
  assert.deepEqual([economy.handlers.passView(store, {}, store.player('la')).pass.claimable, economy.handlers.passView(store, {}, store.player('london')).pass.claimable > 0], [0, true], 'la has nothing to claim, london has');
  await tr.tick();
  n = sentTo('london', 'pass').at(-1).note;
  assert.ok(n.title === 'Bloom ends in 1 day' && /^You have \d+ rewards? ready to claim/.test(n.body), 'the season end: ' + n.title + ' / ' + n.body);
  assert.equal(sentTo('la', 'pass').length, 1, 'nothing to claim: no reminder (still just the start)');
  await tr.tick(); assert.equal(sentTo('london', 'pass').length, 2, 'the reminder goes once');

  // one-off keys follow a sign-in merge and go with the account
  push.merge('london', 'mergedInto');
  assert.equal((await push.notifyOnce('mergedInto', 'pass-end:s1', 'pass', { title: 'x', body: 'y' })).skipped, 'sent before', 'the once-keys moved with the merge');
  push.forget('mergedInto');
  assert.equal(push.players().some(r => r.player === 'mergedInto'), false, 'deleted with the account');
  delete process.env.MITOSIS_DATE;
  store.db.close();
}

/* ---------- the APNs sender against the stand-in ---------- */
async function apnsTests() {
  const prod = await mock.start({ publicKey, keyId: 'KEY1234567', teamId: '4M7HR323EA', badPrefix: ['bad', 'both'] });
  const sbx = await mock.start({ publicKey, keyId: 'KEY1234567', teamId: '4M7HR323EA', badPrefix: ['nope', 'both'] });
  const hosts = { production: `http://127.0.0.1:${prod.port}`, sandbox: `http://127.0.0.1:${sbx.port}` };
  let calls = 0;
  const s = pushes.apnsSender({ keyId: 'KEY1234567', teamId: '4M7HR323EA', key: KEY, topic: 'com.mitosisgame.app', hosts, now: () => (calls++ === 0 ? Date.now() - 2 * HOUR : Date.now()) });
  const note = { kind: 'friends', title: 'Ti wants to be friends', body: 'Tap to say yes', link: 'friends', urgent: false, ttl: 0, collapse: 'fr-ti' };
  // the first provider token is two hours old: Apple says ExpiredProviderToken and a fresh one goes
  let r = await s.send({ token: 'a1'.repeat(32), env: 'production' }, note);
  assert.equal(r.ok, true, 'an expired provider token is renewed and the push goes: ' + JSON.stringify(r));
  const got = prod.sent[0];
  assert.deepEqual(got.payload, { aps: { alert: { title: 'Ti wants to be friends', body: 'Tap to say yes' }, sound: 'default', 'thread-id': 'friends' }, link: 'friends', kind: 'friends' }, 'the APNs payload');
  assert.deepEqual([got.headers['apns-topic'], got.headers['apns-push-type'], got.headers['apns-priority'], got.headers['apns-collapse-id'], got.headers['apns-expiration']], ['com.mitosisgame.app', 'alert', '5', 'fr-ti', undefined], 'the APNs headers');
  assert.deepEqual([got.kid, got.iss], ['KEY1234567', '4M7HR323EA'], 'signed with the key id, for the team');
  const jwt = s.bearer();
  r = await s.send({ token: 'a2'.repeat(32), env: 'production' }, { ...note, urgent: true, ttl: 300 });
  assert.ok(r.ok && s.bearer() === jwt, 'the provider token is reused');
  const h2 = prod.sent[1].headers;
  assert.ok(h2['apns-priority'] === '10' && Math.abs(Number(h2['apns-expiration']) - (Date.now() / 1000 + 300)) < 5, 'urgent: priority 10, expires with the invite');
  // dead tokens, the wrong environment, a busy Apple
  assert.deepEqual(await s.send({ token: 'dead' + '0'.repeat(60), env: 'production' }, note), { dead: 'Unregistered' }, '410 Unregistered: dead');
  r = await s.send({ token: 'bad' + '0'.repeat(61), env: 'production' }, note);
  assert.deepEqual([r.ok, r.env], [true, 'sandbox'], 'BadDeviceToken on production: a development build\'s token, sent to the sandbox');
  assert.equal(sbx.sent.length, 1);
  r = await s.send({ token: 'both' + '0'.repeat(60), env: 'sandbox' }, note);
  assert.ok(r.dead === 'BadDeviceToken', 'bad on both hosts: dead ' + JSON.stringify(r));
  assert.ok(/^503/.test((await s.send({ token: 'busy' + '0'.repeat(60), env: 'production' }, note)).error), 'Apple busy: an error, the token stays');
  assert.equal((await s.send({ token: 'a3'.repeat(32), env: 'production' }, { ...note, body: 'x'.repeat(5000) })).error, 'payload over 4 KB', 'too big is not sent');
  // a key Apple doesn't know
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const s2 = pushes.apnsSender({ keyId: 'KEY1234567', teamId: '4M7HR323EA', key: other, topic: 'com.mitosisgame.app', hosts });
  assert.equal((await s2.send({ token: 'a4'.repeat(32), env: 'production' }, note)).error, '403 InvalidProviderToken', 'a wrong key is refused');
  const s3 = pushes.apnsSender({ keyId: 'KEY1234567', teamId: '4M7HR323EA', key: KEY, topic: 'com.example.other', hosts });
  assert.equal((await s3.send({ token: 'a5'.repeat(32), env: 'production' }, note)).dead, 'DeviceTokenNotForTopic', 'another app\'s topic');
  // Apple down: an error, quickly
  const s4 = pushes.apnsSender({ keyId: 'K', teamId: 'T', key: KEY, topic: 't', host: 'http://127.0.0.1:1', timeoutMs: 2000 });
  assert.ok((await s4.send({ token: 'a6'.repeat(32) }, note)).error, 'no answer: an error');
  for (const x of [s, s2, s3, s4]) x.close();
  await prod.close(); await sbx.close();
}

/* ---------- the FCM sender against a fake Google ---------- */
async function fcmTests() {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { project_id: 'mitosis-test', client_email: 'push@mitosis-test.iam.gserviceaccount.com', private_key: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const calls = [];
  const fetchFn = async (url, o) => {
    calls.push({ url, o });
    if (url.endsWith('/token')) {
      const assertion = new URLSearchParams(o.body).get('assertion').split('.');
      assert.ok(crypto.verify('sha256', Buffer.from(assertion[0] + '.' + assertion[1]), rsa.publicKey, Buffer.from(assertion[2], 'base64url')), 'the OAuth assertion is signed by the service account');
      assert.equal(JSON.parse(Buffer.from(assertion[1], 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging');
      return { ok: true, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
    }
    const m = JSON.parse(o.body).message;
    if (m.token === 'gone') return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) };
    return { ok: true, status: 200, json: async () => ({ name: 'projects/mitosis-test/messages/1' }) };
  };
  const f = pushes.fcmSender({ account, fetchFn });
  const note = { kind: 'party', title: 'Ti invited you', body: 'Join', link: 'friends', urgent: true, ttl: 300, collapse: 'party' };
  assert.deepEqual(await f.send({ token: 'tok1' }, note), { ok: true, id: 'projects/mitosis-test/messages/1' }, 'FCM sends');
  const sent = calls[1];
  assert.equal(sent.url, 'https://fcm.googleapis.com/v1/projects/mitosis-test/messages:send');
  assert.equal(sent.o.headers.Authorization, 'Bearer ya29.test');
  assert.deepEqual(JSON.parse(sent.o.body).message, { token: 'tok1', notification: { title: 'Ti invited you', body: 'Join' }, data: { link: 'friends', kind: 'party' },
    android: { priority: 'high', ttl: '300s', collapse_key: 'party', notification: { channel_id: 'party', tag: 'party' } } }, 'the FCM message');
  assert.deepEqual(await f.send({ token: 'gone' }, note), { dead: 'UNREGISTERED' }, 'an unregistered token is dead');
  assert.equal(calls.filter(c => c.url.endsWith('/token')).length, 1, 'the OAuth token is reused');
  const env = pushes.fromEnv({ FCM_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(account)).toString('base64'), APNS_KEY: KEY.replace(/\n/g, '\\n'), APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' });
  assert.ok(env.fcm && env.apns && !env.problems.length && env.apns.topic === 'com.mitosisgame.app', 'configured from the environment (base64 account, \\n in the key)');
  assert.deepEqual(pushes.fromEnv({ APNS_KEY_ID: 'K' }).problems, ['APNs needs APNS_KEY (or APNS_KEY_FILE), APNS_KEY_ID and APNS_TEAM_ID'], 'half a configuration is reported');
  assert.ok(/not a valid/.test(pushes.fromEnv({ APNS_KEY: 'nonsense', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' }).problems[0]), 'a broken key is reported');
}

/* ---------- the API and the admin page on a real server ---------- */
async function apiTests() {
  const apple = await mock.start({ publicKey, keyId: 'KEY1234567', teamId: '4M7HR323EA' });
  const PORT = 4100 + Math.floor(Math.random() * 400), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-push-api-')), keyFile = path.join(dataDir, 'test.p8');
  fs.writeFileSync(keyFile, KEY);
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, ADMIN_TOKEN: 'admintest', APNS_HOST: `http://127.0.0.1:${apple.port}`, APNS_KEY_FILE: keyFile, APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: '4M7HR323EA' }, stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    for (let i = 0; ; i++) { if (child.exitCode != null) throw new Error('server exited at start-up'); try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} if (i > 150) throw new Error('server did not start'); await sleep(100); }
    const post = async (url, body, secret) => { const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: 'Bearer ' + secret } : {}) }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json() }; };
    const secret = 'pushsecret' + 'a'.repeat(24), me = (await post('/api/session', { secret })).body.playerId;
    assert.equal((await post('/api/push/prefs', {})).status, 401, 'needs a player');
    let r = await post('/api/push/prefs', {}, secret);
    assert.deepEqual([r.status, r.body.devices, r.body.ready], [200, 0, { ios: true, android: false }], 'the view says Apple sending is ready');
    const tok = hex(5);
    r = await post('/api/push/register', { platform: 'ios', token: tok, env: 'production', app: 'ios-2.3.0', tz: 'Pacific/Fiji' }, secret);
    assert.equal(r.body.devices, 1, 'the page registers the token');
    r = await post('/api/push/prefs', { off: ['shop'] }, secret);
    assert.deepEqual(r.body.off, ['shop'], 'and switches a kind off');
    // the admin page: refused without the token, then lists the player and sends a test
    assert.equal((await fetch(base + '/admin/push')).status, 403, 'admin only');
    const page = await (await fetch(base + '/admin/push?token=admintest')).text();
    assert.ok(page.includes('Apple ready') && page.includes(me) && page.includes('a stand-in, not Apple'), 'the admin page shows Apple ready, the stand-in and the player');
    const send = async (player, link) => (await fetch(base + '/admin/push?token=admintest&format=json', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ player, link, body: 'Hello from the test' }) })).json();
    r = await send(me, 'quests');
    assert.deepEqual([r.sent, r.dead], [1, 0], 'the admin test went: ' + JSON.stringify(r));
    const got = apple.sent.at(-1);
    assert.deepEqual([got.token, got.payload.link, got.payload.aps.alert.body, got.headers['apns-priority']], [tok, 'quests', 'Hello from the test', '10'], 'Apple got the test, linking to quests');
    const form = await fetch(base + '/admin/push?token=admintest', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'player=' + me });
    assert.ok(form.status === 303 && /said=Sent/.test(form.headers.get('location')), 'the page form redirects with the result');
    assert.equal((await send('nobody', 'home')).skipped, 'no such player');
    // a dead token is dropped on the next send
    await post('/api/push/register', { platform: 'ios', token: 'dead' + '0'.repeat(60) }, secret);
    r = await send(me, 'home');
    assert.deepEqual([r.sent, r.dead], [1, 1], 'one went, one was dead');
    assert.equal((await post('/api/push/prefs', {}, secret)).body.devices, 1, 'the dead one is gone');
    const json = await (await fetch(base + '/admin/push?token=admintest&format=json')).json();
    assert.ok(json.sent.test >= 2 && json.recent[0].player === me, 'the JSON report counts the tests');
    // a friend accepting your request reaches your phone (server.js → social.js → push-triggers.js → "Apple")
    const friend = 'pushfriend' + 'b'.repeat(24); await post('/api/session', { secret: friend });
    const friendCode = (await post('/api/social/me', { name: 'Ti' }, friend)).body.code;
    const myCode = (await post('/api/social/add', { code: friendCode }, secret)).body.code;
    const before = apple.sent.length; await post('/api/social/accept', { code: myCode }, friend);
    for (let i = 0; i < 50 && apple.sent.length === before; i++) await sleep(100);
    const acc = apple.sent.at(-1);
    assert.deepEqual([acc.token, acc.payload.aps.alert.title, acc.payload.link, acc.payload.kind], [tok, 'Ti accepted your friend request', 'friends', 'friends'], 'the accept reached Apple for my phone');
    // deleting the account deletes the devices
    await post('/api/account/delete', { confirm: 'DELETE' }, secret);
    const after = await (await fetch(base + '/admin/push?token=admintest&format=json')).json();
    assert.ok(!after.recent.some(x => x.player === me), 'no devices left after account deletion');
  } finally { child.kill(); await apple.close(); }
}

(async () => {
  await moduleTests(); console.log('push: storage, switches, limits ok');
  await triggerTests(); console.log('push: triggers ok (Halloween, friends, parties, season start, quests, season end)');
  await apnsTests(); console.log('push: APNs sender ok');
  await fcmTests(); console.log('push: FCM sender ok');
  await apiTests(); console.log('push: API and admin page ok');
  console.log('push tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
