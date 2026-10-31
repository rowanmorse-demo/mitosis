// Friends and parties: the module with a fake clock, then the API against a throwaway server. Run:  node social.test.js
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const social = require('./social');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-social-'));
let clock = 1e12;
const s = social.create({ file: path.join(dataDir, 'unit.json'), nameBlocked: n => /badword/i.test(n), now: () => clock });
const h = s.handlers, me = (p, b = {}) => h.me(null, b, p);
const A = { id: 'a1', name: 'Ann' }, B = { id: 'b1', name: null }, C = { id: 'c1', name: 'Cy' };
const throws = (fn, status) => assert.throws(fn, e => e.status === status);

// friend codes and names
const a = me(A), b = me(B, { name: '  Bo  badword ' }), c = me(C);
assert.match(a.code, /^[A-HJ-NP-Z2-9]{6}$/);
assert.notStrictEqual(a.code, b.code);
assert.strictEqual(a.name, 'Ann');
assert.strictEqual(b.name, 'Player ' + b.code.slice(0, 3), 'a blocked name is not used');
assert.strictEqual(me(B, { name: 'Bo' }).name, 'Bo');
throws(() => h.add(null, { code: 'ZZZZZZ' }, A), 404);
throws(() => h.add(null, { code: a.code }, A), 400);

// a request, then accepting it
let v = h.add(null, { code: b.code.toLowerCase() }, A);
assert.deepStrictEqual(v.outgoing.map(f => f.code), [b.code]);
assert.deepStrictEqual(me(B).incoming.map(f => f.code), [a.code]);
throws(() => h.accept(null, { code: c.code }, B), 404);
v = h.accept(null, { code: a.code }, B);
assert.deepStrictEqual(v.friends.map(f => f.code), [a.code]);
assert.strictEqual(me(A).friends[0].name, 'Bo');
assert.strictEqual(me(A).outgoing.length, 0);
// both asking each other makes friends at once
h.add(null, { code: c.code }, A); v = h.add(null, { code: a.code }, C);
assert.deepStrictEqual(v.friends.map(f => f.code), [a.code]);

// online status: fresh calls count as online, with what the game is doing
me(B, { status: 'arena' });
assert.strictEqual(me(A).friends.find(f => f.code === b.code).status, 'arena');
clock += 60e3; me(A);
assert.strictEqual(me(A).friends.find(f => f.code === b.code).status, 'offline');

// parties: invite a friend, they join, either one pressing Play sends the other in
throws(() => h.partyInvite(null, { code: b.code }, C), 403); // not friends
v = h.partyInvite(null, { code: b.code }, A);
assert.ok(v.party && v.party.members.length === 1 && v.party.invited[0] === b.code);
const inv = me(B).invites;
assert.strictEqual(inv.length, 1); assert.strictEqual(inv[0].from.code, a.code);
throws(() => h.partyJoin(null, { party: inv[0].party }, C), 403); // C was not invited
v = h.partyJoin(null, { party: inv[0].party }, B);
assert.deepStrictEqual(v.party.members.map(m => m.code).sort(), [a.code, b.code].sort());
assert.strictEqual(v.invites.length, 0);
assert.ok(me(A).friends.find(f => f.code === b.code).inParty);
throws(() => h.partyInvite(null, { code: c.code }, A), 409); // two is a full party
v = h.partyGo(null, {}, B);
assert.strictEqual(me(A).party.go, clock); assert.strictEqual(me(A).party.goBy, b.code);
clock += 61e3; assert.strictEqual(me(A).party.go, 0, 'a Play older than a minute is ignored');
// leaving ends a party of two
v = h.partyLeave(null, {}, B);
assert.strictEqual(v.party, null); assert.strictEqual(me(A).party, null);
// invites expire after five minutes
h.partyInvite(null, { code: c.code }, A);
const pid = me(C).invites[0].party;
clock += 5 * 60e3 + 1;
assert.strictEqual(me(C).invites.length, 0);
throws(() => h.partyJoin(null, { party: pid }, C), 403);
h.partyLeave(null, {}, A);

// unfriending also cancels requests and breaks up a shared party
h.partyInvite(null, { code: b.code }, A); h.partyJoin(null, { party: me(B).invites[0].party }, B);
v = h.remove(null, { code: b.code }, A);
assert.ok(!v.friends.some(f => f.code === b.code)); assert.strictEqual(v.party, null);
assert.ok(!me(B).friends.some(f => f.code === a.code));

// sign-in merge: the device's friends and code move to the account
const D = { id: 'd1', name: 'Dee' }, E = { id: 'e1', name: 'Eve' };
const d = me(D); me(E); h.add(null, { code: d.code }, C); h.accept(null, { code: c.code }, D);
s.merge('d1', 'e1');
assert.ok(me(C).friends.some(f => f.code === me(E).code && f.name === 'Eve'));
assert.ok(!me(C).friends.some(f => f.code === d.code), 'the device player is gone');
// account deletion removes the player from everyone's lists
s.forget('a1');
assert.ok(!me(C).friends.some(f => f.code === a.code));
throws(() => h.add(null, { code: a.code }, C), 404);
// friend lists survive a restart
s.flush();
const s2 = social.create({ file: path.join(dataDir, 'unit.json'), now: () => clock });
assert.ok(s2.handlers.me(null, {}, C).friends.some(f => f.name === 'Eve'));
console.log('social module: ok');

// the API, wired into server.js
const PORT = 3600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'inherit'] });
const kill = () => { try { child.kill('SIGKILL'); } catch (e) {} };
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { kill(); process.exit(1); });
async function post(url, body, secret) {
  const headers = { 'Content-Type': 'application/json' }; if (secret) headers.Authorization = 'Bearer ' + secret;
  const r = await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json() };
}
(async () => {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  const s1 = 'socialone' + 'a'.repeat(20), s2 = 'socialtwo' + 'b'.repeat(20);
  for (const sec of [s1, s2]) assert.strictEqual((await post('/api/session', { secret: sec })).status, 200);
  assert.strictEqual((await post('/api/social/me', {})).status, 401, 'needs a signed-in player');
  const one = (await post('/api/social/me', { name: 'Uno' }, s1)).body, two = (await post('/api/social/me', { name: 'Dos', status: 'arena' }, s2)).body;
  assert.match(one.code, /^[A-Z2-9]{6}$/);
  assert.strictEqual((await post('/api/social/add', { code: two.code }, s1)).status, 200);
  const acc = await post('/api/social/accept', { code: one.code }, s2);
  assert.strictEqual(acc.status, 200); assert.strictEqual(acc.body.friends[0].name, 'Uno');
  const inv = await post('/api/social/party/invite', { code: two.code }, s1);
  assert.strictEqual(inv.body.friends[0].status, 'arena');
  const join = await post('/api/social/party/join', { party: inv.body.party.id }, s2);
  assert.strictEqual(join.status, 200); assert.strictEqual(join.body.party.members.length, 2);
  assert.strictEqual((await post('/api/social/party/go', {}, s2)).status, 200);
  assert.ok((await post('/api/social/me', {}, s1)).body.party.go > 0);
  assert.strictEqual((await post('/api/social/add', { code: 'NOPE22' }, s1)).status, 404);
  // deleting an account takes it out of friend lists
  assert.strictEqual((await post('/api/account/delete', { confirm: 'DELETE' }, s2)).status, 200);
  const after = (await post('/api/social/me', {}, s1)).body;
  assert.strictEqual(after.friends.length, 0); assert.strictEqual(after.party, null);
  console.log('social API: ok');
  kill(); fs.rmSync(dataDir, { recursive: true, force: true });
})().catch(e => { kill(); console.error(e); process.exit(1); });
