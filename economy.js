// Mitosis economy — ATP (the in-game currency), skins, run payouts and purchases.
// Everything that touches a wallet happens here, on the server, so the client
// can only ask; it can't give itself ATP.
'use strict';
const crypto = require('crypto');
const iap = require('./iap');

// Keep SKINS and PACKS in sync with PREMIUM and ATP_PACKS in index.html.
const SKINS = [
  { id: 5, key: 'nebula', name: 'Nebula', price: 400 },
  { id: 6, key: 'magma', name: 'Magma', price: 500 },
  { id: 7, key: 'honeycomb', name: 'Honeycomb', price: 350 },
  { id: 8, key: 'circuit', name: 'Circuit', price: 450 },
  { id: 9, key: 'leopard', name: 'Leopard', price: 300 },
  { id: 10, key: 'glacier', name: 'Glacier', price: 350 },
  { id: 11, key: 'toxic', name: 'Toxic', price: 400 },
  { id: 12, key: 'eyeball', name: 'Eyeball', price: 600 },
  { id: 13, key: 'galaxy', name: 'Galaxy', price: 700 },
  { id: 14, key: 'gilded', name: 'Gilded', price: 800 },
];
const PACKS = [
  { id: 'atp_500', atp: 500 },
  { id: 'atp_1500', atp: 1500 },
  { id: 'atp_5000', atp: 5000 },
  { id: 'atp_12000', atp: 12000 },
];
// Payout for one run. Survival pays steadily; kills and peak mass add a bonus.
const RULES = { perTenSec: 1, perEat: 2, eatCap: 30, peakPer: 50, peakCap: 40, runCap: 120, hourCap: 500, maxRunSec: 3 * 3600 };
const HOUR = 3600 * 1000;
// Rating (Elo-like): survival and kills raise it, dying quickly lowers it. Gains shrink and losses
// grow as the rating climbs, so it settles instead of inflating forever. Everyone starts at 1000.
const RATING = { base: 1000, perTenSec: 1, survCap: 60, perKill: 4, killCap: 60, quickDeathSec: 60, quickPenalty: 20, scale: 2000 };
const TIERS = [[900, 'Bronze'], [1100, 'Silver'], [1400, 'Gold'], [1800, 'Platinum'], [2300, 'Diamond'], [Infinity, 'Legend']];
const tierOf = r => TIERS.find(t => r < t[0])[1];
function ratingDelta(rating, survived, eaten) {
  const gain = Math.min(RATING.survCap, Math.floor(survived / 10) * RATING.perTenSec) + Math.min(RATING.killCap, Math.max(0, eaten | 0) * RATING.perKill);
  const quick = survived < RATING.quickDeathSec ? (RATING.quickDeathSec - survived) / RATING.quickDeathSec * RATING.quickPenalty : 0;
  const k = Math.max(0, rating - RATING.base) / RATING.scale;
  return Math.round(gain * Math.max(.35, 1 - k) - quick * (1 + k));
}
const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} _.\-'!?]/gu, '').trim().slice(0, 16) || null;

const skinById = id => SKINS.find(s => s.id === id);
const packById = id => PACKS.find(p => p.id === id);
const catalog = () => ({ skins: SKINS, packs: PACKS, rules: RULES, rating: RATING, tiers: TIERS.map(t => t[1]), iap: iap.status() });

function payoutFor({ survived, eaten, peak }) {
  const sec = Math.max(0, Math.min(RULES.maxRunSec, +survived || 0));
  const e = Math.max(0, Math.min(RULES.eatCap, Math.floor(+eaten || 0)));
  const p = Math.max(0, Math.min(RULES.peakCap, Math.floor((+peak || 0) / RULES.peakPer)));
  return Math.min(RULES.runCap, Math.floor(sec / 10) * RULES.perTenSec + e * RULES.perEat + p);
}

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const wallet = (store, p) => ({ playerId: p.id, balance: Number(p.balance), earned: Number(p.earned), skins: store.skins(p.id), rating: Number(p.rating ?? RATING.base), tier: tierOf(Number(p.rating ?? RATING.base)), runs: Number(p.runs || 0) });

function hourlyAllowance(p, now) {
  const inWindow = now - Number(p.hour_at) < HOUR;
  return { used: inWindow ? Number(p.hour_sum) : 0, at: inWindow ? Number(p.hour_at) : now };
}

/* ---------- handlers: each gets (store, body, player?) and returns a JSON-able object ---------- */
function session(store, body) {
  const secret = String(body.secret || '');
  if (!/^[a-z0-9]{24,64}$/.test(secret)) throw new ApiError(400, 'secret must be 24-64 lowercase letters/digits');
  const h = hash(secret), now = Date.now();
  let p = store.playerBySecret(h);
  if (!p) p = store.createPlayer(crypto.randomBytes(8).toString('hex'), h, now);
  else store.touch(p.id, now);
  return { ...wallet(store, p), catalog: catalog() };
}
function auth(store, headers) {
  const m = /^Bearer\s+([a-z0-9]{24,64})$/.exec(headers.authorization || '');
  if (!m) throw new ApiError(401, 'sign in first');
  const p = store.playerBySecret(hash(m[1]));
  if (!p) throw new ApiError(401, 'unknown player');
  return p;
}
function runStart(store, body, p) {
  const now = Date.now();
  if (store.openRuns(p.id, now - HOUR) > 20) throw new ApiError(429, 'too many open runs');
  const id = crypto.randomBytes(8).toString('hex');
  store.createRun(id, p.id, now);
  return { runId: id };
}
function runEnd(store, body, p) {
  const now = Date.now();
  const run = store.run(String(body.runId || ''), p.id);
  if (!run) throw new ApiError(404, 'unknown run');
  if (run.ended) return { payout: Number(run.payout) || 0, ...wallet(store, p), duplicate: true };
  // The client can't claim more survival time than actually elapsed on the server.
  const elapsed = (now - Number(run.started)) / 1000 + 15;
  const survived = Math.min(+body.survived || 0, elapsed);
  let payout = payoutFor({ survived, eaten: body.eaten, peak: body.peak });
  const hr = hourlyAllowance(p, now);
  payout = Math.max(0, Math.min(payout, RULES.hourCap - hr.used));
  const w = { balance: Number(p.balance) + payout, earned: Number(p.earned) + payout, hour_at: hr.at, hour_sum: hr.used + payout };
  store.setWallet(p.id, w); store.endRun(run.id, now, payout);
  Object.assign(p, w);
  // rating
  const before = Number(p.rating ?? RATING.base), delta = ratingDelta(before, survived, body.eaten), rating = Math.max(0, before + delta);
  const name = cleanName(body.name) || p.name || null;
  store.setRating(p.id, rating, name); p.rating = rating; p.name = name; p.runs = Number(p.runs || 0) + 1;
  return { payout, capped: hr.used + payout >= RULES.hourCap, ratingDelta: delta, ...wallet(store, p) };
}
function buySkin(store, body, p) {
  const skin = skinById(body.skinId | 0);
  if (!skin) throw new ApiError(404, 'no such skin');
  if (store.skins(p.id).includes(skin.id)) return { ...wallet(store, p), already: true };
  if (Number(p.balance) < skin.price) throw new ApiError(402, `need ${skin.price - Number(p.balance)} more ATP`);
  const w = { balance: Number(p.balance) - skin.price, earned: Number(p.earned), hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) };
  store.setWallet(p.id, w); store.addSkin(p.id, skin.id, Date.now()); Object.assign(p, w);
  return { ...wallet(store, p), bought: skin.id };
}
async function credit(store, p, platform, verified, idForDedupe) {
  const pack = packById(verified.productId);
  if (!pack) throw new ApiError(400, 'unknown product ' + verified.productId);
  const pid = platform + ':' + idForDedupe;
  if (store.purchase(pid)) return { ...wallet(store, p), credited: 0, duplicate: true };
  const w = { balance: Number(p.balance) + pack.atp, earned: Number(p.earned), hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) };
  store.setWallet(p.id, w); store.addPurchase(pid, p.id, pack.id, pack.atp, platform + '/' + verified.environment, Date.now()); Object.assign(p, w);
  console.log(`$ ${platform} purchase ${pack.id} (+${pack.atp} ATP, ${verified.environment})`);
  return { ...wallet(store, p), credited: pack.atp };
}
async function iapApple(store, body, p) {
  let v; try { v = await iap.verifyApple({ transactionId: body.transactionId, jws: body.jws }); }
  catch (e) { throw new ApiError(e.status || 400, 'Apple: ' + e.message); }
  return credit(store, p, 'apple', v, v.transactionId);
}
async function iapGoogle(store, body, p) {
  let v; try { v = await iap.verifyGoogle({ purchaseToken: body.purchaseToken, productId: body.productId, orderId: body.orderId }); }
  catch (e) { throw new ApiError(e.status || 400, 'Google: ' + e.message); }
  return credit(store, p, 'google', v, v.orderId);
}

function leaderboard(store) { return { top: store.top(10).map((r, i) => ({ rank: i + 1, name: r.name || 'Unnamed cell', rating: r.rating, tier: tierOf(r.rating), runs: r.runs })) }; }

module.exports = { SKINS, PACKS, RULES, RATING, catalog, payoutFor, ratingDelta, tierOf, ApiError, auth, handlers: { session, runStart, runEnd, buySkin, iapApple, iapGoogle, leaderboard } };
