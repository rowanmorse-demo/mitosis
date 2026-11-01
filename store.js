// Mitosis data store — wallets, skins, runs and purchases.
// Uses the SQLite that ships inside Node (node:sqlite, Node 22.13+). On older
// Node versions it falls back to a JSON file so nothing crashes. Both keep their
// data under DATA_DIR (default ./data).
'use strict';
const fs = require('fs'), path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const QUEST_KEEP = 15 * 864e5;   // quest progress is kept this long after its last change (a week's quests last 7 days)

function openStore() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  let sqlite = null;
  try { sqlite = require('node:sqlite'); } catch (e) {}
  if (sqlite && sqlite.DatabaseSync) {
    try { return new SqliteStore(sqlite, path.join(DATA_DIR, 'mitosis.sqlite')); }
    catch (e) { console.error('SQLite unavailable (' + e.message + '), using JSON store'); }
  }
  return new JsonStore(path.join(DATA_DIR, 'mitosis.json'));
}

/* ---------- SQLite ---------- */
class SqliteStore {
  constructor(sqlite, file) {
    this.kind = 'sqlite'; this.file = file;
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, secret TEXT UNIQUE NOT NULL, created INTEGER, seen INTEGER,
        balance INTEGER NOT NULL DEFAULT 0, earned INTEGER NOT NULL DEFAULT 0, hour_at INTEGER NOT NULL DEFAULT 0, hour_sum INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS skins(player TEXT, skin INTEGER, at INTEGER, PRIMARY KEY(player, skin));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, player TEXT, started INTEGER, ended INTEGER, payout INTEGER);
      CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY, player TEXT, product TEXT, amount INTEGER, platform TEXT, at INTEGER);
      CREATE INDEX IF NOT EXISTS runs_player ON runs(player, started);
      -- sign-in: which Apple / Google account a player is, and the extra device secrets that map to a player
      CREATE TABLE IF NOT EXISTS identities(provider TEXT, subject TEXT, player TEXT, email TEXT, at INTEGER, PRIMARY KEY(provider, subject));
      CREATE INDEX IF NOT EXISTS identities_player ON identities(player);
      CREATE TABLE IF NOT EXISTS devices(secret TEXT PRIMARY KEY, player TEXT, created INTEGER, seen INTEGER);
      CREATE INDEX IF NOT EXISTS devices_player ON devices(player);
      -- connection quality reports (netstats.js): anonymous, no player id
      CREATE TABLE IF NOT EXISTS netstats(at INTEGER, platform TEXT, app TEXT, tz TEXT, conn TEXT, n INTEGER, lost INTEGER, min INTEGER, med INTEGER, p90 INTEGER, jit INTEGER, fps INTEGER, slow INTEGER);
      CREATE INDEX IF NOT EXISTS netstats_at ON netstats(at);
      -- battle pass (economy.js PASS): each player's XP and premium per season, the rewards they claimed, and the on/off switch
      CREATE TABLE IF NOT EXISTS pass(player TEXT, season TEXT, xp INTEGER NOT NULL DEFAULT 0, premium INTEGER NOT NULL DEFAULT 0, at INTEGER, PRIMARY KEY(player, season));
      CREATE TABLE IF NOT EXISTS pass_claims(player TEXT, season TEXT, reward TEXT, at INTEGER, PRIMARY KEY(player, season, reward));
      CREATE TABLE IF NOT EXISTS flags(name TEXT PRIMARY KEY, value TEXT);
      -- quests (economy.js QUESTS): progress per player, period ('d2026-11-20' or 'w2026-W47') and quest; done is when it paid
      -- rank trophies: one row per tier a player has reached, with when
      CREATE TABLE IF NOT EXISTS trophies(player TEXT, tier TEXT, at INTEGER, PRIMARY KEY(player, tier));
      CREATE TABLE IF NOT EXISTS quests(player TEXT, period TEXT, quest TEXT, progress INTEGER NOT NULL DEFAULT 0, done INTEGER, at INTEGER, PRIMARY KEY(player, period, quest));
      CREATE INDEX IF NOT EXISTS quests_at ON quests(at);`);
    for (const sql of ['ALTER TABLE players ADD COLUMN rating INTEGER NOT NULL DEFAULT 1000', 'ALTER TABLE players ADD COLUMN name TEXT', 'ALTER TABLE players ADD COLUMN runs INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE players ADD COLUMN xp INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE runs ADD COLUMN xp INTEGER',
      // lifetime stats: lives counted, wins and top-3 finishes, seconds alive, cells absorbed, and the best rating reached (null: never recorded)
      'ALTER TABLE players ADD COLUMN played INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE players ADD COLUMN wins INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE players ADD COLUMN podiums INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE players ADD COLUMN alive INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE players ADD COLUMN eaten INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE players ADD COLUMN peak INTEGER'])
      try { this.db.exec(sql); } catch (e) {} // already migrated
    const p = s => this.db.prepare(s);
    this.q = {
      bySecret: p('SELECT * FROM players WHERE secret = ?'),
      byId: p('SELECT * FROM players WHERE id = ?'),
      insPlayer: p('INSERT INTO players(id, secret, created, seen) VALUES(?, ?, ?, ?)'),
      touch: p('UPDATE players SET seen = ? WHERE id = ?'),
      setWallet: p('UPDATE players SET balance = ?, earned = ?, hour_at = ?, hour_sum = ? WHERE id = ?'),
      skins: p('SELECT skin FROM skins WHERE player = ? ORDER BY skin'),
      addSkin: p('INSERT OR IGNORE INTO skins(player, skin, at) VALUES(?, ?, ?)'),
      insRun: p('INSERT INTO runs(id, player, started) VALUES(?, ?, ?)'),
      run: p('SELECT * FROM runs WHERE id = ? AND player = ?'),
      endRun: p('UPDATE runs SET ended = ?, payout = ?, xp = ? WHERE id = ?'),
      openRuns: p('SELECT COUNT(*) AS n FROM runs WHERE player = ? AND ended IS NULL AND started > ?'),
      purchase: p('SELECT * FROM purchases WHERE id = ?'),
      insPurchase: p('INSERT INTO purchases(id, player, product, amount, platform, at) VALUES(?, ?, ?, ?, ?, ?)'),
      count: p('SELECT COUNT(*) AS n FROM players'),
      setRating: p('UPDATE players SET rating = ?, name = ?, runs = runs + 1 WHERE id = ?'),
      addXp: p('UPDATE players SET xp = xp + ? WHERE id = ?'),
      addStats: p('UPDATE players SET played = played + ?, wins = wins + ?, podiums = podiums + ?, alive = alive + ?, eaten = eaten + ?, peak = MAX(COALESCE(peak, 0), ?) WHERE id = ?'),
      trophies: p('SELECT tier, at FROM trophies WHERE player = ?'),
      insTrophy: p('INSERT OR IGNORE INTO trophies(player, tier, at) VALUES(?, ?, ?)'),
      moveTrophies: p('INSERT INTO trophies(player, tier, at) SELECT ?, tier, at FROM trophies WHERE player = ? ON CONFLICT(player, tier) DO UPDATE SET at = MIN(at, excluded.at)'),
      delTrophies: p('DELETE FROM trophies WHERE player = ?'),
      top: p('SELECT name, rating, runs FROM players WHERE runs > 0 ORDER BY rating DESC, runs DESC LIMIT ?'),
      recent: p('SELECT id, name, seen, runs, xp FROM players WHERE seen > ? ORDER BY seen DESC LIMIT ?'),
      device: p('SELECT player FROM devices WHERE secret = ?'),
      insDevice: p('INSERT OR REPLACE INTO devices(secret, player, created, seen) VALUES(?, ?, ?, ?)'),
      delDevice: p('DELETE FROM devices WHERE secret = ?'),
      identity: p('SELECT * FROM identities WHERE provider = ? AND subject = ?'),
      identities: p('SELECT provider, subject, email, at FROM identities WHERE player = ? ORDER BY at'),
      insIdentity: p('INSERT OR IGNORE INTO identities(provider, subject, player, email, at) VALUES(?, ?, ?, ?, ?)'),
      // merging one player into another (a device signing in to an account it did not create)
      mergeWallet: p('UPDATE players SET balance = balance + ?, earned = earned + ?, runs = runs + ?, xp = xp + ?, played = played + ?, wins = wins + ?, podiums = podiums + ?, alive = alive + ?, eaten = eaten + ?, peak = MAX(COALESCE(peak, 0), ?), rating = MAX(rating, ?), name = COALESCE(name, ?) WHERE id = ?'),
      moveSkins: p('INSERT OR IGNORE INTO skins(player, skin, at) SELECT ?, skin, at FROM skins WHERE player = ?'),
      delSkins: p('DELETE FROM skins WHERE player = ?'),
      moveRuns: p('UPDATE runs SET player = ? WHERE player = ?'),
      movePurchases: p('UPDATE purchases SET player = ? WHERE player = ?'),
      moveIdentities: p('UPDATE OR IGNORE identities SET player = ? WHERE player = ?'),
      delIdentities: p('DELETE FROM identities WHERE player = ?'),
      moveDevices: p('UPDATE OR REPLACE devices SET player = ? WHERE player = ?'),
      delPlayer: p('DELETE FROM players WHERE id = ?'),
      // account deletion: everything about the player goes; purchase receipts stay as anonymous records so a replayed receipt cannot credit twice
      delRuns: p('DELETE FROM runs WHERE player = ?'),
      delDevicesOf: p('DELETE FROM devices WHERE player = ?'),
      anonPurchases: p('UPDATE purchases SET player = NULL WHERE player = ?'),
      passRow: p('SELECT xp, premium FROM pass WHERE player = ? AND season = ?'),
      passXp: p('INSERT INTO pass(player, season, xp, at) VALUES(?, ?, ?, ?) ON CONFLICT(player, season) DO UPDATE SET xp = xp + excluded.xp'),
      passPremium: p('INSERT INTO pass(player, season, premium, at) VALUES(?, ?, 1, ?) ON CONFLICT(player, season) DO UPDATE SET premium = 1'),
      passClaims: p('SELECT reward FROM pass_claims WHERE player = ? AND season = ? ORDER BY at, reward'),
      passClaim: p('INSERT OR IGNORE INTO pass_claims(player, season, reward, at) VALUES(?, ?, ?, ?)'),
      passStats: p('SELECT COUNT(*) AS players, COALESCE(SUM(premium), 0) AS premium, COALESCE(SUM(xp), 0) AS xp FROM pass WHERE season = ?'),
      passClaimCount: p('SELECT COUNT(*) AS n FROM pass_claims WHERE season = ?'),
      movePass: p('INSERT INTO pass(player, season, xp, premium, at) SELECT ?, season, xp, premium, at FROM pass WHERE player = ? ON CONFLICT(player, season) DO UPDATE SET xp = xp + excluded.xp, premium = MAX(premium, excluded.premium)'),
      delPass: p('DELETE FROM pass WHERE player = ?'),
      movePassClaims: p('INSERT OR IGNORE INTO pass_claims(player, season, reward, at) SELECT ?, season, reward, at FROM pass_claims WHERE player = ?'),
      delPassClaims: p('DELETE FROM pass_claims WHERE player = ?'),
      questRows: p('SELECT quest, progress, done FROM quests WHERE player = ? AND period = ?'),
      questSave: p('INSERT INTO quests(player, period, quest, progress, at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(player, period, quest) DO UPDATE SET progress = excluded.progress, at = excluded.at'),
      questDone: p('INSERT INTO quests(player, period, quest, progress, done, at) VALUES(?, ?, ?, 0, ?, ?) ON CONFLICT(player, period, quest) DO UPDATE SET done = excluded.done, at = excluded.at WHERE done IS NULL'),
      questStats: p('SELECT COUNT(*) AS n FROM quests WHERE period = ? AND done IS NOT NULL'),
      pruneQuests: p('DELETE FROM quests WHERE at < ?'),
      // a merge adds the progress up and keeps the quest done if either side finished it (the earlier time)
      moveQuests: p('INSERT INTO quests(player, period, quest, progress, done, at) SELECT ?, period, quest, progress, done, at FROM quests WHERE player = ? ON CONFLICT(player, period, quest) DO UPDATE SET progress = progress + excluded.progress, done = COALESCE(MIN(done, excluded.done), done, excluded.done), at = MAX(at, excluded.at)'),
      delQuests: p('DELETE FROM quests WHERE player = ?'),
      flag: p('SELECT value FROM flags WHERE name = ?'),
      setFlag: p('INSERT OR REPLACE INTO flags(name, value) VALUES(?, ?)'),
      insNet: p('INSERT INTO netstats(at, platform, app, tz, conn, n, lost, min, med, p90, jit, fps, slow) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      netSince: p('SELECT * FROM netstats WHERE at > ? ORDER BY at DESC LIMIT 50000'),
      pruneNet: p('DELETE FROM netstats WHERE at < ?'),
    };
  }
  playerBySecret(h) { const p = this.q.bySecret.get(h); if (p) return p; const d = this.q.device.get(h); return d ? this.player(d.player) : null; }
  identity(provider, subject) { return this.q.identity.get(provider, subject) || null; }
  identities(player) { return this.q.identities.all(player); }
  linkIdentity(provider, subject, player, email, now) { this.q.insIdentity.run(provider, subject, player, email, now); }
  addDevice(h, player, now) { this.q.insDevice.run(h, player, now, now); }
  forgetDevice(h) { this.q.delDevice.run(h); }
  /** Folds player `from` into `to`: wallet, XP, lifetime stats, rank trophies (the earlier date wins), skins, battle pass (XP adds up, claims join), quests (progress adds up), history, sign-ins and device secrets all move; `from` is deleted. */
  mergePlayers(from, to) {
    const a = this.player(from), b = this.player(to); if (!a || !b || from === to) return;
    this.db.exec('BEGIN');
    try {
      this.q.mergeWallet.run(Number(a.balance), Number(a.earned), Number(a.runs || 0), Number(a.xp || 0), Number(a.played || 0), Number(a.wins || 0), Number(a.podiums || 0), Number(a.alive || 0), Number(a.eaten || 0), Math.max(Number(a.peak || 0), Number(a.rating ?? 1000)), Number(a.rating ?? 1000), a.name || null, to);
      this.q.moveTrophies.run(to, from); this.q.delTrophies.run(from);
      this.q.moveSkins.run(to, from); this.q.delSkins.run(from);
      this.q.moveRuns.run(to, from); this.q.movePurchases.run(to, from);
      this.q.moveIdentities.run(to, from); this.q.delIdentities.run(from);
      this.q.moveDevices.run(to, from);
      this.q.movePass.run(to, from); this.q.delPass.run(from); this.q.movePassClaims.run(to, from); this.q.delPassClaims.run(from);
      this.q.moveQuests.run(to, from); this.q.delQuests.run(from);
      this.q.delPlayer.run(from);                       // frees a.secret, which becomes a device of `to`
      this.q.insDevice.run(a.secret, to, Number(a.created) || Date.now(), Date.now());
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** Deletes a player and everything linked to them (skins, trophies, runs, battle pass, quests, sign-ins, devices); purchase receipts are kept without the player. */
  deletePlayer(id) {
    this.db.exec('BEGIN');
    try { this.q.delSkins.run(id); this.q.delRuns.run(id); this.q.delIdentities.run(id); this.q.delDevicesOf.run(id); this.q.anonPurchases.run(id); this.q.delPass.run(id); this.q.delPassClaims.run(id); this.q.delQuests.run(id); this.q.delTrophies.run(id); this.q.delPlayer.run(id); this.db.exec('COMMIT'); }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  player(id) { return this.q.byId.get(id) || null; }
  createPlayer(id, h, now) { this.q.insPlayer.run(id, h, now, now); return this.player(id); }
  touch(id, now) { this.q.touch.run(now, id); }
  setWallet(id, w) { this.q.setWallet.run(w.balance, w.earned, w.hour_at, w.hour_sum, id); }
  skins(id) { return this.q.skins.all(id).map(r => Number(r.skin)); }
  addSkin(id, skin, now) { this.q.addSkin.run(id, skin, now); }
  createRun(id, player, now) { this.q.insRun.run(id, player, now); }
  run(id, player) { return this.q.run.get(id, player) || null; }
  endRun(id, now, payout, xp = 0) { this.q.endRun.run(now, payout, xp, id); }
  openRuns(player, since) { return Number(this.q.openRuns.get(player, since).n); }
  purchase(id) { return this.q.purchase.get(id) || null; }
  addPurchase(id, player, product, amount, platform, now) { this.q.insPurchase.run(id, player, product, amount, platform, now); }
  playerCount() { return Number(this.q.count.get().n); }
  setRating(id, rating, name) { this.q.setRating.run(rating, name, id); }
  addXp(id, n) { this.q.addXp.run(n, id); }
  addStats(id, s, peak) { this.q.addStats.run(s.played, s.wins, s.podiums, s.alive, s.eaten, peak, id); }
  trophies(id) { return this.q.trophies.all(id).map(r => ({ tier: r.tier, at: Number(r.at) })); }
  addTrophies(id, tiers, at) { for (const k of tiers) this.q.insTrophy.run(id, k, at); }
  top(n) { return this.q.top.all(n).map(r => ({ name: r.name, rating: Number(r.rating), runs: Number(r.runs) })); }
  /** Players who opened the game since `since`, latest first (for picking battle pass testers). */
  recentPlayers(since, n) { return this.q.recent.all(since, n).map(r => ({ id: r.id, name: r.name, seen: Number(r.seen), runs: Number(r.runs), xp: Number(r.xp || 0) })); }
  passRow(player, season) { return this.q.passRow.get(player, season) || null; }
  passAddXp(player, season, n, now) { this.q.passXp.run(player, season, n, now); }
  passSetPremium(player, season, now) { this.q.passPremium.run(player, season, now); }
  passClaims(player, season) { return this.q.passClaims.all(player, season).map(r => r.reward); }
  /** Records a claimed reward; false if it was claimed already, so each reward is paid once. */
  passClaim(player, season, reward, now) { return Number(this.q.passClaim.run(player, season, reward, now).changes) > 0; }
  passStats(season) { const r = this.q.passStats.get(season); return { players: Number(r.players), premium: Number(r.premium), xp: Number(r.xp), claims: Number(this.q.passClaimCount.get(season).n) }; }
  questRows(player, period) { return this.q.questRows.all(player, period).map(r => ({ quest: r.quest, progress: Number(r.progress), done: r.done == null ? null : Number(r.done) })); }
  /** Keeps a quest's progress; now and then drops quests from periods long over. */
  questSave(player, period, quest, progress, now) { this.q.questSave.run(player, period, quest, progress, now); if (Math.random() < .01) this.q.pruneQuests.run(now - QUEST_KEEP); }
  /** Marks a quest done; false if it was done already, so each quest pays once. */
  questDone(player, period, quest, now) { return Number(this.q.questDone.run(player, period, quest, now, now).changes) > 0; }
  questStats(period) { return Number(this.q.questStats.get(period).n); }
  flag(name) { const r = this.q.flag.get(name); return r ? r.value : null; }
  setFlag(name, value) { this.q.setFlag.run(name, value); }
  addNet(r) { this.q.insNet.run(r.at, r.platform, r.app, r.tz, r.conn, r.n, r.lost, r.min, r.med, r.p90, r.jit, r.fps, r.slow); if (Math.random() < .01) this.q.pruneNet.run(r.at - 90 * 864e5); }
  netSince(t) { return this.q.netSince.all(t).map(r => ({ ...r, fps: r.fps == null ? null : Number(r.fps) })); }
}

/* ---------- JSON file (fallback) ---------- */
class JsonStore {
  constructor(file) {
    this.kind = 'json'; this.file = file; this.timer = null;
    this.d = { players: {}, secrets: {}, skins: {}, runs: {}, purchases: {}, identities: {}, devices: {}, net: [], pass: {}, flags: {}, quests: {}, trophies: {} };
    try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (raw && raw.players) this.d = Object.assign(this.d, raw); } catch (e) {}
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const tmp = this.file + '.tmp';
      try { fs.writeFileSync(tmp, JSON.stringify(this.d)); fs.renameSync(tmp, this.file); } catch (e) { console.error('store save failed: ' + e.message); }
    }, 250);
  }
  playerBySecret(h) { const id = this.d.secrets[h] || (this.d.devices[h] && this.d.devices[h].player); return id ? this.player(id) : null; }
  player(id) { const p = this.d.players[id]; return p ? { ...p } : null; }
  identity(provider, subject) { const i = this.d.identities[provider + ':' + subject]; return i ? { ...i } : null; }
  identities(player) { return Object.values(this.d.identities).filter(i => i.player === player).sort((a, b) => a.at - b.at).map(({ provider, subject, email, at }) => ({ provider, subject, email, at })); }
  linkIdentity(provider, subject, player, email, now) { const k = provider + ':' + subject; if (!this.d.identities[k]) { this.d.identities[k] = { provider, subject, player, email, at: now }; this.save(); } }
  addDevice(h, player, now) { this.d.devices[h] = { player, created: now, seen: now }; this.save(); }
  forgetDevice(h) { delete this.d.devices[h]; this.save(); }
  mergePlayers(from, to) {
    const a = this.d.players[from], b = this.d.players[to]; if (!a || !b || from === to) return;
    b.balance += a.balance; b.earned += a.earned; b.runs = (b.runs || 0) + (a.runs || 0); b.xp = (b.xp || 0) + (a.xp || 0);
    for (const k of ['played', 'wins', 'podiums', 'alive', 'eaten']) b[k] = (b[k] || 0) + (a[k] || 0);
    b.peak = Math.max(b.peak || 0, a.peak || 0, a.rating ?? 1000); b.rating = Math.max(b.rating ?? 1000, a.rating ?? 1000);
    const tr = this.d.trophies[to] || (this.d.trophies[to] = {}); for (const [k, at] of Object.entries(this.d.trophies[from] || {})) tr[k] = tr[k] == null ? at : Math.min(tr[k], at); delete this.d.trophies[from]; b.name = b.name || a.name || null;
    const s = this.d.skins[to] || (this.d.skins[to] = []); for (const k of this.d.skins[from] || []) if (!s.includes(k)) s.push(k); delete this.d.skins[from];
    for (const r of Object.values(this.d.runs)) if (r.player === from) r.player = to;
    for (const p of Object.values(this.d.purchases)) if (p.player === from) p.player = to;
    for (const i of Object.values(this.d.identities)) if (i.player === from) i.player = to;
    for (const d of Object.values(this.d.devices)) if (d.player === from) d.player = to;
    const ps = this.d.pass[to] || (this.d.pass[to] = {});
    for (const [season, r] of Object.entries(this.d.pass[from] || {})) { const t = ps[season]; if (!t) { ps[season] = r; continue; } t.xp += r.xp; t.premium = t.premium || r.premium; for (const c of r.claims) if (!t.claims.includes(c)) t.claims.push(c); }
    delete this.d.pass[from];
    const qs = this.d.quests[to] || (this.d.quests[to] = {});
    for (const [period, m] of Object.entries(this.d.quests[from] || {})) { const t = qs[period] || (qs[period] = {});
      for (const [quest, r] of Object.entries(m)) { const o = t[quest]; if (!o) { t[quest] = r; continue; } o.progress += r.progress; o.done = o.done == null ? r.done : r.done == null ? o.done : Math.min(o.done, r.done); o.at = Math.max(o.at, r.at); } }
    delete this.d.quests[from];
    delete this.d.secrets[a.secret]; delete this.d.players[from];
    this.d.devices[a.secret] = { player: to, created: a.created, seen: Date.now() };
    this.save();
  }
  deletePlayer(id) {
    const a = this.d.players[id]; if (!a) return;
    delete this.d.skins[id]; delete this.d.pass[id]; delete this.d.quests[id]; delete this.d.trophies[id]; delete this.d.secrets[a.secret]; delete this.d.players[id];
    for (const [k, r] of Object.entries(this.d.runs)) if (r.player === id) delete this.d.runs[k];
    for (const [k, i] of Object.entries(this.d.identities)) if (i.player === id) delete this.d.identities[k];
    for (const [k, d] of Object.entries(this.d.devices)) if (d.player === id) delete this.d.devices[k];
    for (const p of Object.values(this.d.purchases)) if (p.player === id) p.player = null;
    this.save();
  }
  createPlayer(id, h, now) {
    this.d.players[id] = { id, secret: h, created: now, seen: now, balance: 0, earned: 0, hour_at: 0, hour_sum: 0, rating: 1000, name: null, runs: 0, xp: 0, played: 0, wins: 0, podiums: 0, alive: 0, eaten: 0, peak: null };
    this.d.secrets[h] = id; this.save(); return this.player(id);
  }
  touch(id, now) { const p = this.d.players[id]; if (p) { p.seen = now; this.save(); } }
  setWallet(id, w) { const p = this.d.players[id]; if (p) { Object.assign(p, { balance: w.balance, earned: w.earned, hour_at: w.hour_at, hour_sum: w.hour_sum }); this.save(); } }
  skins(id) { return (this.d.skins[id] || []).slice().sort((a, b) => a - b); }
  addSkin(id, skin, now) { const s = this.d.skins[id] || (this.d.skins[id] = []); if (!s.includes(skin)) { s.push(skin); this.save(); } }
  createRun(id, player, now) { this.d.runs[id] = { id, player, started: now, ended: null, payout: null, xp: null }; this.prune(); this.save(); }
  run(id, player) { const r = this.d.runs[id]; return r && r.player === player ? { ...r } : null; }
  endRun(id, now, payout, xp = 0) { const r = this.d.runs[id]; if (r) { r.ended = now; r.payout = payout; r.xp = xp; this.save(); } }
  openRuns(player, since) { let n = 0; for (const r of Object.values(this.d.runs)) if (r.player === player && r.ended == null && r.started > since) n++; return n; }
  purchase(id) { const p = this.d.purchases[id]; return p ? { ...p } : null; }
  addPurchase(id, player, product, amount, platform, now) { this.d.purchases[id] = { id, player, product, amount, platform, at: now }; this.save(); }
  playerCount() { return Object.keys(this.d.players).length; }
  setRating(id, rating, name) { const p = this.d.players[id]; if (p) { p.rating = rating; p.name = name; p.runs = (p.runs || 0) + 1; this.save(); } }
  addXp(id, n) { const p = this.d.players[id]; if (p) { p.xp = (p.xp || 0) + n; this.save(); } }
  addStats(id, s, peak) { const p = this.d.players[id]; if (!p) return; for (const k of ['played', 'wins', 'podiums', 'alive', 'eaten']) p[k] = (p[k] || 0) + s[k]; p.peak = Math.max(p.peak || 0, peak); this.save(); }
  trophies(id) { return Object.entries((this.d.trophies || {})[id] || {}).map(([tier, at]) => ({ tier, at })); }
  addTrophies(id, tiers, at) { const m = this.d.trophies || (this.d.trophies = {}), t = m[id] || (m[id] = {}); let n = 0; for (const k of tiers) if (t[k] == null) { t[k] = at; n++; } if (n) this.save(); }
  recentPlayers(since, n) { return Object.values(this.d.players).filter(p => p.seen > since).sort((a, b) => b.seen - a.seen).slice(0, n).map(p => ({ id: p.id, name: p.name, seen: p.seen, runs: p.runs || 0, xp: p.xp || 0 })); }
  top(n) { return Object.values(this.d.players).filter(p => p.runs > 0).sort((a, b) => (b.rating - a.rating) || (b.runs - a.runs)).slice(0, n).map(p => ({ name: p.name, rating: p.rating, runs: p.runs })); }
  passEntry(player, season, now) { const m = this.d.pass[player] || (this.d.pass[player] = {}); return m[season] || (m[season] = { xp: 0, premium: 0, at: now, claims: [] }); }
  passRow(player, season) { const r = (this.d.pass[player] || {})[season]; return r ? { xp: r.xp, premium: r.premium } : null; }
  passAddXp(player, season, n, now) { this.passEntry(player, season, now).xp += n; this.save(); }
  passSetPremium(player, season, now) { this.passEntry(player, season, now).premium = 1; this.save(); }
  passClaims(player, season) { const r = (this.d.pass[player] || {})[season]; return r ? r.claims.slice() : []; }
  passClaim(player, season, reward, now) { const r = this.passEntry(player, season, now); if (r.claims.includes(reward)) return false; r.claims.push(reward); this.save(); return true; }
  passStats(season) { const o = { players: 0, premium: 0, xp: 0, claims: 0 }; for (const m of Object.values(this.d.pass)) { const r = m[season]; if (r) { o.players++; o.premium += r.premium ? 1 : 0; o.xp += r.xp; o.claims += r.claims.length; } } return o; }
  questRows(player, period) { return Object.entries(((this.d.quests[player] || {})[period]) || {}).map(([quest, r]) => ({ quest, progress: r.progress, done: r.done ?? null })); }
  questEntry(player, period, quest, now) { const m = this.d.quests[player] || (this.d.quests[player] = {}), pm = m[period] || (m[period] = {}); return pm[quest] || (pm[quest] = { progress: 0, done: null, at: now }); }
  questSave(player, period, quest, progress, now) {
    const r = this.questEntry(player, period, quest, now); r.progress = progress; r.at = now;
    const m = this.d.quests[player]; for (const [k, pm] of Object.entries(m)) if (Object.values(pm).every(x => x.at < now - QUEST_KEEP)) delete m[k]; // periods long over
    this.save();
  }
  questDone(player, period, quest, now) { const r = this.questEntry(player, period, quest, now); if (r.done != null) return false; r.done = now; r.at = now; this.save(); return true; }
  questStats(period) { let n = 0; for (const m of Object.values(this.d.quests)) for (const r of Object.values(m[period] || {})) if (r.done != null) n++; return n; }
  flag(name) { return this.d.flags[name] ?? null; }
  setFlag(name, value) { this.d.flags[name] = value; this.save(); }
  addNet(r) { const a = this.d.net || (this.d.net = []); a.push(r); if (a.length > 20000) a.splice(0, a.length - 20000); this.save(); }
  netSince(t) { return (this.d.net || []).filter(r => r.at > t); }
  prune() { // keep the run log small
    const ids = Object.keys(this.d.runs); if (ids.length < 5000) return;
    ids.sort((a, b) => this.d.runs[a].started - this.d.runs[b].started);
    for (const id of ids.slice(0, ids.length - 4000)) delete this.d.runs[id];
  }
}

module.exports = { openStore, DATA_DIR, SqliteStore, JsonStore };
