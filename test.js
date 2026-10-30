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

const child = spawn(process.execPath, [path.join(__dirname, 'server.js')],
  { env: { ...process.env, PORT, DATA_DIR: dataDir, IAP_UNVERIFIED: '1', AUTH_APPLE_JWKS: `http://127.0.0.1:${KEY_PORT}/apple`, AUTH_GOOGLE_JWKS: `http://127.0.0.1:${KEY_PORT}/google`, GOOGLE_CLIENT_IDS: 'test-google-client' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://127.0.0.1:${PORT}`;

async function waitUp() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
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
  const premium = [...fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').matchAll(/\{id:(\d+),key:'(\w+)',name:'([^']+)',price:(\d+)/g)].map(m => ({ id: +m[1], key: m[2], name: m[3], price: +m[4] }));
  assert.deepEqual(r.body.catalog.skins.map(s => ({ id: s.id, key: s.key, name: s.name, price: s.price })), premium, 'the server sells exactly the skins the game draws');
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
