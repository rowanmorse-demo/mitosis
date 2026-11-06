// A believable account for the menu takes, made by the game's own server code (economy.js, store.js) on a throwaway
// database: a player with a few weeks of play (wins, XP, a pass in progress, owned skins, ATP), ranked rivals for the
// leaderboard, and the Battle Pass switched on as it will be at launch. The capture's fake API answers with these.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

module.exports = function world(ROOT, { secret, name = 'Juno', skins = [], balance = 4850 } = {}) {
  const econ = require(path.join(ROOT, 'economy.js')), { JsonStore } = require(path.join(ROOT, 'store.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-world-'));
  const store = new JsonStore(path.join(dir, 'world.json'));store.save = () => {}; // in memory only
  const date0 = process.env.MITOSIS_DATE; process.env.MITOSIS_DATE = '2026-11-20T18:00:00Z'; // inside the pass's first season (it opens Nov 16)
  const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
  try {
    econ.passAdmin(store, true); // the pass as players will see it from launch day
    econ.handlers.session(store, { secret });
    const me = () => store.playerBySecret(hash(secret));
    // a few weeks of ranked play: lives that last, placings near the top (backdated so the server credits the time)
    const places = [1, 3, 1, 2, 5, 1, 4, 2, 1, 3, 6, 2];
    for (const pl of places) {
      const { runId } = econ.handlers.runStart(store, {}, me());
      const r = store.d.runs[runId]; if (r) r.started -= 9 * 60e3;
      try { econ.handlers.runEnd(store, { runId, survived: 470 + pl * 7, bestRank: pl, place: pl, of: 28, eaten: 40 - pl * 3 }, me(), { metSince: () => true }); } catch (e) {}
    }
    const p = me(), now = Date.now();
    store.setWallet(p.id, { balance, earned: 31200, hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) });
    for (const k of skins) store.addSkin(p.id, k, now);
    store.setRating(p.id, 1388, name);
    // rivals for the leaderboard
    const rivals = [['Nova', 2410], ['kai.exe', 2265], ['Mitochondria', 2120], ['Pip', 1980], ['Lumen', 1874], ['blobfather', 1760], ['Sora', 1655], ['Ash', 1520], ['Marigold', 1449]];
    rivals.forEach(([n, r], i) => { const id = 'rival' + i; store.createPlayer(id, hash('rival' + i), now); store.setRating(id, r, n); });
    const session = econ.handlers.session(store, { secret });
    return {
      session, pass: econ.handlers.passView(store, {}, me()), leaderboard: econ.handlers.leaderboard(store),
      'social/me': socialMe(name),
    };
  } finally { if (date0 === undefined) delete process.env.MITOSIS_DATE; else process.env.MITOSIS_DATE = date0; fs.rmSync(dir, { recursive: true, force: true }); }
};

// the Friends page: a party of two and a few friends in different states (the shape /api/social/me answers with)
function socialMe(name) {
  return {
    code: 'K7Q2XM', name,
    friends: [{ code: 'ABC234', name: 'Ti', status: 'menu', inParty: true }, { code: 'ZZT9PQ', name: 'Mara', status: 'arena' },
      { code: 'LM34NB', name: 'Kenji', status: 'menu' }, { code: 'P8R4WN', name: 'Jules', status: 'practice' }, { code: 'QW3RTY', name: 'Ines', status: 'offline' }],
    incoming: [{ code: 'HJK345', name: 'Nova' }], outgoing: [], invites: [],
    party: { id: 'promo-party', members: [{ code: 'K7Q2XM', name, status: 'menu' }, { code: 'ABC234', name: 'Ti', status: 'menu' }], invited: [], go: 0 },
  };
}
