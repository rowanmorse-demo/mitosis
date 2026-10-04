// node iap.test.js — checks the offline verification of Apple-signed StoreKit transactions
// against a certificate chain generated here with openssl (root -> intermediate -> leaf).
'use strict';
const { execSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-iap-'));
const sh = c => execSync(c, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
const w = (f, t) => fs.writeFileSync(path.join(dir, f), t);
sh('openssl ecparam -name prime256v1 -genkey -noout -out root.key');
sh('openssl req -new -x509 -key root.key -days 2 -subj "/CN=Test Root/O=Test" -out root.pem');
sh('openssl ecparam -name prime256v1 -genkey -noout -out other.key');
sh('openssl req -new -x509 -key other.key -days 2 -subj "/CN=Other Root/O=Test" -out other.pem');
sh('openssl ecparam -name prime256v1 -genkey -noout -out inter.key');
sh('openssl req -new -key inter.key -subj "/CN=Test Intermediate/O=Test" -out inter.csr');
w('inter.ext', 'basicConstraints=CA:TRUE\n1.2.840.113635.100.6.2.1=DER:05:00\n');
sh('openssl x509 -req -in inter.csr -CA root.pem -CAkey root.key -CAcreateserial -days 2 -extfile inter.ext -out inter.pem');
sh('openssl ecparam -name prime256v1 -genkey -noout -out leaf.key');
sh('openssl req -new -key leaf.key -subj "/CN=Test Leaf/O=Test" -out leaf.csr');
w('leaf.ext', 'basicConstraints=CA:FALSE\n1.2.840.113635.100.6.11.1=DER:05:00\n');
sh('openssl x509 -req -in leaf.csr -CA inter.pem -CAkey inter.key -CAcreateserial -days 2 -extfile leaf.ext -out leaf.pem');

process.env.APPLE_ROOT_CERT = path.join(dir, 'root.pem');
delete process.env.IAP_UNVERIFIED;
const iap = require('./iap.js');
const der = f => new crypto.X509Certificate(fs.readFileSync(path.join(dir, f))).raw.toString('base64');
const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function sign(payload, chain = ['leaf.pem', 'inter.pem', 'root.pem'], key = 'leaf.key') {
  const h = b64url(JSON.stringify({ alg: 'ES256', x5c: chain.map(der) })), p = b64url(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: fs.readFileSync(path.join(dir, key)), dsaEncoding: 'ieee-p1363' });
  return h + '.' + p + '.' + b64url(sig);
}
const good = { bundleId: 'com.mitosisgame.app', productId: 'atp_500', transactionId: '2000000123456789', type: 'Consumable', environment: 'Sandbox' };
async function rejects(p, re) { try { await p; } catch (e) { assert.match(String(e.message), re); return; } assert.fail('expected rejection ' + re); }
(async () => {
  const ok = await iap.verifyApple({ jws: sign(good), transactionId: good.transactionId });
  assert.deepStrictEqual(ok, { productId: 'atp_500', transactionId: '2000000123456789', environment: 'Sandbox' });
  const ok2 = await iap.verifyApple({ jws: sign(good, ['leaf.pem', 'inter.pem']) }); // root omitted from x5c: ours is used
  assert.strictEqual(ok2.productId, 'atp_500');
  await rejects(iap.verifyApple({ jws: sign({ ...good, bundleId: 'com.other.app' }) }), /another app/);
  await rejects(iap.verifyApple({ jws: sign({ ...good, revocationDate: 1700000000000 }) }), /refunded/);
  await rejects(iap.verifyApple({ jws: sign({ ...good, type: 'Auto-Renewable Subscription' }) }), /consumable/);
  await rejects(iap.verifyApple({ jws: sign(good), transactionId: '1' }), /mismatch/);
  const [h, , s] = sign(good).split('.'); // payload swapped after signing
  await rejects(iap.verifyApple({ jws: h + '.' + b64url(JSON.stringify({ ...good, productId: 'atp_12000' })) + '.' + s }), /signature/);
  await rejects(iap.verifyApple({ jws: sign(good, ['inter.pem', 'root.pem'], 'inter.key') }), /signing certificate/); // no leaf OID
  await rejects(iap.verifyApple({ jws: sign(good, ['leaf.pem', 'inter.pem', 'other.pem']) }), /Apple Root/);
  await rejects(iap.verifyApple({ jws: sign(good, ['leaf.pem', 'other.pem']) }), /not signed by Apple/);
  await rejects(iap.verifyApple({ jws: 'nope' }), /malformed/);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('iap.test.js: Apple JWS verification OK (11 checks)');
})().catch(e => { console.error(e); process.exit(1); });
