// Mitosis economy — ATP (the in-game currency), skins, run payouts and purchases.
// Everything that touches a wallet happens here, on the server, so the client
// can only ask; it can't give itself ATP.
'use strict';
const crypto = require('crypto');
const iap = require('./iap');
const signin = require('./auth');

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
  { id: 15, key: 'blackhole', name: 'Black Hole', price: 10000 },
  { id: 16, key: 'onering', name: 'One Cell to Rule Them All', price: 12000000 }, // what $10,000 of the biggest pack buys
  { id: 17, key: 'aurora', name: 'Aurora', price: 900 },
  { id: 18, key: 'koi', name: 'Koi', price: 500 },
  { id: 19, key: 'plasma', name: 'Plasma', price: 1200 },
  { id: 20, key: 'geode', name: 'Geode', price: 2500 },
  { id: 21, key: 'sakura', name: 'Sakura', price: 450 },
  { id: 22, key: 'supernova', name: 'Supernova', price: 6000 },
  { id: 23, key: 'glitch', name: 'Glitch', price: 1500 },
];
const PACKS = [
  { id: 'atp_500', atp: 500 },
  { id: 'atp_1500', atp: 1500 },
  { id: 'atp_5000', atp: 5000 },
  { id: 'atp_12000', atp: 12000 },
];
// Payout for one run, by where the player placed in the round (last one standing is 1st; dying
// with 6 others still alive is 7th): 1st pays 10, top 3 pays 6, top 10 pays 3, top 20 pays 1,
// anything else 0, and a run shorter than minSec pays nothing. No hourly cap: it is deliberately
// small per game so the 10,000 ATP Black Hole is a very long grind and the packs are the realistic
// shortcut. Older clients that only report their best mass rank are paid by that instead.
const RULES = { byRank: [[1, 25], [2, 20], [3, 16], [4, 13], [5, 11], [6, 9], [7, 8], [8, 7], [9, 6], [10, 5], [15, 3], [20, 2], [30, 1]], minSec: 20, maxRunSec: 3 * 3600 }; // 25 ATP for the win, tapering with placement
const HOUR = 3600 * 1000;
// Rating (Elo-like): survival, kills and a high placing raise it, dying quickly lowers it. Gains
// shrink and losses grow as the rating climbs, so it settles instead of inflating forever.
// Everyone starts at 1000.
// winBonus: finishing 1st of 4+; lifePenalty: each respawn already used this round trims the gain (dying less pays more).
const RATING = { base: 1000, perTenSec: .5, survCap: 25, perKill: 2, killCap: 30, placeBonus: 8, winBonus: 10, lifePenalty: .25, quickDeathSec: 60, quickPenalty: 10, scale: 2000 };
const TIERS = [[900, 'Bronze'], [1100, 'Silver'], [1400, 'Gold'], [1800, 'Platinum'], [2300, 'Diamond'], [Infinity, 'Legend']];
const tierOf = r => TIERS.find(t => r < t[0])[1];
function ratingDelta(rating, survived, eaten, place, of, life = 0) {
  // placing: 1st of N earns the full bonus, last earns none; needs at least 4 in the round to count. Winning adds more.
  const n = Math.max(0, of | 0), pl = Math.max(1, place | 0), placing = n >= 4 && pl <= n ? RATING.placeBonus * (1 - (pl - 1) / (n - 1)) : 0;
  const won = n >= 4 && pl === 1 ? RATING.winBonus : 0;
  const careful = Math.max(.4, 1 - RATING.lifePenalty * Math.max(0, Math.min(2, life | 0)));   // 2nd life earns 75%, 3rd 50%
  const gain = (Math.min(RATING.survCap, Math.floor(survived / 10) * RATING.perTenSec) + Math.min(RATING.killCap, Math.max(0, eaten | 0) * RATING.perKill) + placing + won) * careful;
  const quick = survived < RATING.quickDeathSec ? (RATING.quickDeathSec - survived) / RATING.quickDeathSec * RATING.quickPenalty : 0;
  const k = Math.max(0, rating - RATING.base) / RATING.scale;
  return Math.round(gain * Math.max(.35, 1 - k) - quick * (1 + k));
}
// Names are shown to every player (keep in step with the copy in index.html), so slurs and obvious profanity are refused. Long words match anywhere once spacing,
// l33t spellings and stretched letters are undone; short ones only as whole words; ALLOW keeps innocent words that contain them.
const NAME_BAD_ANY = ['fuck', 'fuk', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'penis', 'vagina', 'porn', 'rapist', 'hitler', 'nazi', 'kike', 'tranny', 'paedo', 'pedophile', 'molest', 'jizz', 'dildo', 'blowjob', 'wank', 'twat', 'motherf', 'cocksuck', 'dickhead', 'asshole', 'bastard', 'killyourself'];
const NAME_BAD_WORD = ['ass', 'fag', 'cum', 'dick', 'cock', 'rape', 'anal', 'sex', 'tit', 'tits', 'spic', 'chink', 'nig', 'coon', 'gook', 'homo', 'hoe', 'pedo', 'kys', 'nazis'];
const NAME_ALLOW = ['niger', 'nigeria', 'snigger', 'scunthorpe', 'penistone', 'therapist', 'torpedo', 'cockatoo', 'peacock', 'hancock', 'shiitake', 'shitake', 'dickens', 'grape', 'drape', 'analysis', 'canal', 'cucumber', 'essex', 'sussex', 'pedometer', 'skunk', 'assassin', 'bass', 'class', 'grass', 'glass', 'pass', 'mass', 'cockpit', 'woodcock', 'bitcoin'];
const NAME_LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };
const squashName = s => s.replace(/(.)\1+/g, '$1');
function nameBlocked(s) {
  let low = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[0-9@$!|+]/g, c => NAME_LEET[c] || c);
  for (const w of NAME_ALLOW) low = low.split(w).join(' ');
  const flat = low.replace(/[^a-z]/g, ''), squash = squashName(flat);
  if (NAME_BAD_ANY.some(w => flat.includes(w) || squash.includes(squashName(w))) || NAME_BAD_WORD.includes(flat) || NAME_BAD_WORD.includes(squash)) return true;
  return low.split(/[^a-z]+/).some(w => w && (NAME_BAD_WORD.includes(w) || NAME_BAD_WORD.includes(squashName(w))));
}
const cleanName = s => { const n = String(s || '').replace(/[^\p{L}\p{N} _.\-'!?]/gu, '').trim().slice(0, 16); return n && !nameBlocked(n) ? n : null; };

const skinById = id => SKINS.find(s => s.id === id);
const packById = id => PACKS.find(p => p.id === id);
const catalog = () => ({ skins: SKINS, packs: PACKS, rules: RULES, rating: RATING, tiers: TIERS.map(t => t[1]), tierAt: TIERS.map(t => t[0]), iap: iap.status(), auth: signin.status() });

function payoutFor({ survived, bestRank, place }) {
  const sec = Math.max(0, Math.min(RULES.maxRunSec, +survived || 0));
  if (sec < RULES.minSec) return 0;
  const rank = Math.max(1, Math.floor(+place || +bestRank || 0));
  const tier = RULES.byRank.find(([r]) => rank <= r);
  return tier ? tier[1] : 0;
}

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
// The sign-in a wallet belongs to (Apple or Google), or null for a device-only wallet.
const accountOf = (store, p) => { const i = store.identities(p.id)[0]; return i ? { provider: i.provider, email: i.email || null, since: Number(i.at) } : null; };
const wallet = (store, p) => ({ playerId: p.id, balance: Number(p.balance), earned: Number(p.earned), skins: store.skins(p.id), rating: Number(p.rating ?? RATING.base), tier: tierOf(Number(p.rating ?? RATING.base)), runs: Number(p.runs || 0), account: accountOf(store, p) });

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
  const h = hash(m[1]), p = store.playerBySecret(h);
  if (!p) throw new ApiError(401, 'unknown player');
  p.deviceHash = h;   // which device secret this request came from (not stored)
  return p;
}

/* ---------- sign-in: Apple / Google identities, so a wallet follows the player ---------- */
// A device that signs in to an account it did not create joins that account: its own wallet
// (ATP, skins, history) is folded into the account's and its secret now opens the account.
async function signInWith(verify, store, body, p) {
  let ident;
  try { ident = await verify(body); }
  catch (e) { throw new ApiError(e.status || 401, e.message); }
  const now = Date.now(), existing = store.identity(ident.provider, ident.subject);
  let player = p, merged = false;
  if (existing && existing.player !== p.id && store.player(existing.player)) {
    store.mergePlayers(p.id, existing.player); player = store.player(existing.player); merged = true;
  } else if (!existing) {
    store.linkIdentity(ident.provider, ident.subject, p.id, ident.email, now);
  }
  console.log(`+ ${ident.provider} sign-in${merged ? ' (joined existing account)' : ''}`);
  return { ...wallet(store, player), merged };
}
const signInApple = (store, body, p) => signInWith(signin.verifyApple, store, body, p);
const signInGoogle = (store, body, p) => signInWith(signin.verifyGoogle, store, body, p);
// Sign out only detaches this device; the account and its wallet stay for the next sign-in.
// The device then starts a fresh wallet with a new secret (the page does that).
// Account deletion (App Store guideline 5.1.1(v)): removes the player and everything linked to them. Needs an explicit confirmation.
function deleteAccount(store, body, p) {
  if (!body || body.confirm !== 'DELETE') throw new ApiError(400, 'confirm deletion');
  const linked = store.identities(p.id).map(i => i.provider);
  store.deletePlayer(p.id);
  console.log(`- account deleted${linked.length ? ' (' + linked.join(', ') + ' sign-in)' : ''}`);
  return { ok: true, deleted: true };
}
function signOut(store, body, p) {
  if (p.deviceHash && p.deviceHash !== p.secret) store.forgetDevice(p.deviceHash);
  return { ok: true };
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
  const payout = payoutFor({ survived, bestRank: body.bestRank, place: body.place });
  const w = { balance: Number(p.balance) + payout, earned: Number(p.earned) + payout, hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) };
  store.setWallet(p.id, w); store.endRun(run.id, now, payout);
  Object.assign(p, w);
  // rating
  const before = Number(p.rating ?? RATING.base), delta = ratingDelta(before, survived, body.eaten, body.place, body.of, body.life), rating = Math.max(0, before + delta);
  const name = cleanName(body.name) || p.name || null;
  store.setRating(p.id, rating, name); p.rating = rating; p.name = name; p.runs = Number(p.runs || 0) + 1;
  return { payout, ratingDelta: delta, ...wallet(store, p) };
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

function leaderboard(store) { return { top: store.top(10).map((r, i) => ({ rank: i + 1, name: (r.name && !nameBlocked(r.name) && r.name) || 'Unnamed cell', rating: r.rating, tier: tierOf(r.rating), runs: r.runs })) }; }

module.exports = { SKINS, PACKS, RULES, RATING, catalog, payoutFor, ratingDelta, tierOf, nameBlocked, ApiError, auth, handlers: { deleteAccount, session, runStart, runEnd, buySkin, iapApple, iapGoogle, leaderboard, signInApple, signInGoogle, signOut } };
