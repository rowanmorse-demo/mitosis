// Purchases that overlap: the store's receipt check is a network wait, so a second pack, a skin bought or the same
// receipt sent again can land while one is being verified. None of them may lose or invent ATP.
// node economy.test.js
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-economy-'));
process.env.IAP_UNVERIFIED = '1';
const iap = require('./iap');
const verify = iap.verifyGoogle;
iap.verifyGoogle = async b => { await new Promise(r => setTimeout(r, 60)); return verify(b); }; // Google Play's round trip
const economy = require('./economy'), { openStore } = require('./store');
const store = openStore(), h = economy.handlers;
// as server.js does it: auth() reads the player, then the handler is awaited
const call = (fn, secret, body) => fn(store, body, economy.auth(store, { authorization: 'Bearer ' + secret }));
const player = () => { const s = 'econtest' + Math.random().toString(36).slice(2).padEnd(24, 'x'); h.session(store, { secret: s }); return s; };
const balance = s => h.session(store, { secret: s }).balance;
const pack = (s, id, order) => call(h.iapGoogle, s, { purchaseToken: 'tok-' + order, productId: id, orderId: order });

(async () => {
  const a = player();
  await Promise.all([pack(a, 'atp_500', 'A1'), pack(a, 'atp_1500', 'A2')]);
  assert.equal(balance(a), 2000, 'two packs redeemed at once both count');

  const b = player();
  await pack(b, 'atp_1500', 'B1');
  const pending = pack(b, 'atp_500', 'B2');
  await new Promise(r => setTimeout(r, 15));
  assert.equal(call(h.buySkin, b, { skinId: 17 }).balance, 600, 'Aurora (900) bought while a pack verifies');
  await pending;
  assert.equal(balance(b), 1100, 'the pack credit keeps the skin purchase: 1500 - 900 + 500');

  const c = player();
  const [first, again] = await Promise.all([pack(c, 'atp_500', 'C1'), pack(c, 'atp_500', 'C1')]);
  assert.equal(balance(c), 500, 'one receipt sent twice at once credits once');
  assert.equal(first.balance, 500);
  assert.equal(again.duplicate, true);
  assert.equal(again.balance, 500, "the duplicate's reply carries the current balance, not the one before the credit");

  console.log('economy: overlapping purchases ok');
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
