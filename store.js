// Mitosis data store — wallets, skins, runs and purchases.
// Uses the SQLite that ships inside Node (node:sqlite, Node 22.13+). On older
// Node versions it falls back to a JSON file so nothing crashes. Both keep their
// data under DATA_DIR (default ./data).
'use strict';
const fs = require('fs'), path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

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
      CREATE INDEX IF NOT EXISTS devices_player ON devices(player);`);
    for (const sql of ['ALTER TABLE players ADD COLUMN rating INTEGER NOT NULL DEFAULT 1000', 'ALTER TABLE players ADD COLUMN name TEXT', 'ALTER TABLE players ADD COLUMN runs INTEGER NOT NULL DEFAULT 0'])
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
      endRun: p('UPDATE runs SET ended = ?, payout = ? WHERE id = ?'),
      openRuns: p('SELECT COUNT(*) AS n FROM runs WHERE player = ? AND ended IS NULL AND started > ?'),
      purchase: p('SELECT * FROM purchases WHERE id = ?'),
      insPurchase: p('INSERT INTO purchases(id, player, product, amount, platform, at) VALUES(?, ?, ?, ?, ?, ?)'),
      count: p('SELECT COUNT(*) AS n FROM players'),
      setRating: p('UPDATE players SET rating = ?, name = ?, runs = runs + 1 WHERE id = ?'),
      top: p('SELECT name, rating, runs FROM players WHERE runs > 0 ORDER BY rating DESC, runs DESC LIMIT ?'),
      device: p('SELECT player FROM devices WHERE secret = ?'),
      insDevice: p('INSERT OR REPLACE INTO devices(secret, player, created, seen) VALUES(?, ?, ?, ?)'),
      delDevice: p('DELETE FROM devices WHERE secret = ?'),
      identity: p('SELECT * FROM identities WHERE provider = ? AND subject = ?'),
      identities: p('SELECT provider, subject, email, at FROM identities WHERE player = ? ORDER BY at'),
      insIdentity: p('INSERT OR IGNORE INTO identities(provider, subject, player, email, at) VALUES(?, ?, ?, ?, ?)'),
      // merging one player into another (a device signing in to an account it did not create)
      mergeWallet: p('UPDATE players SET balance = balance + ?, earned = earned + ?, runs = runs + ?, rating = MAX(rating, ?), name = COALESCE(name, ?) WHERE id = ?'),
      moveSkins: p('INSERT OR IGNORE INTO skins(player, skin, at) SELECT ?, skin, at FROM skins WHERE player = ?'),
      delSkins: p('DELETE FROM skins WHERE player = ?'),
      moveRuns: p('UPDATE runs SET player = ? WHERE player = ?'),
      movePurchases: p('UPDATE purchases SET player = ? WHERE player = ?'),
      moveIdentities: p('UPDATE OR IGNORE identities SET player = ? WHERE player = ?'),
      delIdentities: p('DELETE FROM identities WHERE player = ?'),
      moveDevices: p('UPDATE OR REPLACE devices SET player = ? WHERE player = ?'),
      delPlayer: p('DELETE FROM players WHERE id = ?'),
    };
  }
  playerBySecret(h) { const p = this.q.bySecret.get(h); if (p) return p; const d = this.q.device.get(h); return d ? this.player(d.player) : null; }
  identity(provider, subject) { return this.q.identity.get(provider, subject) || null; }
  identities(player) { return this.q.identities.all(player); }
  linkIdentity(provider, subject, player, email, now) { this.q.insIdentity.run(provider, subject, player, email, now); }
  addDevice(h, player, now) { this.q.insDevice.run(h, player, now, now); }
  forgetDevice(h) { this.q.delDevice.run(h); }
  /** Folds player `from` into `to`: wallet, skins, history, sign-ins and device secrets all move; `from` is deleted. */
  mergePlayers(from, to) {
    const a = this.player(from), b = this.player(to); if (!a || !b || from === to) return;
    this.db.exec('BEGIN');
    try {
      this.q.mergeWallet.run(Number(a.balance), Number(a.earned), Number(a.runs || 0), Number(a.rating ?? 1000), a.name || null, to);
      this.q.moveSkins.run(to, from); this.q.delSkins.run(from);
      this.q.moveRuns.run(to, from); this.q.movePurchases.run(to, from);
      this.q.moveIdentities.run(to, from); this.q.delIdentities.run(from);
      this.q.moveDevices.run(to, from);
      this.q.delPlayer.run(from);                       // frees a.secret, which becomes a device of `to`
      this.q.insDevice.run(a.secret, to, Number(a.created) || Date.now(), Date.now());
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  player(id) { return this.q.byId.get(id) || null; }
  createPlayer(id, h, now) { this.q.insPlayer.run(id, h, now, now); return this.player(id); }
  touch(id, now) { this.q.touch.run(now, id); }
  setWallet(id, w) { this.q.setWallet.run(w.balance, w.earned, w.hour_at, w.hour_sum, id); }
  skins(id) { return this.q.skins.all(id).map(r => Number(r.skin)); }
  addSkin(id, skin, now) { this.q.addSkin.run(id, skin, now); }
  createRun(id, player, now) { this.q.insRun.run(id, player, now); }
  run(id, player) { return this.q.run.get(id, player) || null; }
  endRun(id, now, payout) { this.q.endRun.run(now, payout, id); }
  openRuns(player, since) { return Number(this.q.openRuns.get(player, since).n); }
  purchase(id) { return this.q.purchase.get(id) || null; }
  addPurchase(id, player, product, amount, platform, now) { this.q.insPurchase.run(id, player, product, amount, platform, now); }
  playerCount() { return Number(this.q.count.get().n); }
  setRating(id, rating, name) { this.q.setRating.run(rating, name, id); }
  top(n) { return this.q.top.all(n).map(r => ({ name: r.name, rating: Number(r.rating), runs: Number(r.runs) })); }
}

/* ---------- JSON file (fallback) ---------- */
class JsonStore {
  constructor(file) {
    this.kind = 'json'; this.file = file; this.timer = null;
    this.d = { players: {}, secrets: {}, skins: {}, runs: {}, purchases: {}, identities: {}, devices: {} };
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
    b.balance += a.balance; b.earned += a.earned; b.runs = (b.runs || 0) + (a.runs || 0); b.rating = Math.max(b.rating ?? 1000, a.rating ?? 1000); b.name = b.name || a.name || null;
    const s = this.d.skins[to] || (this.d.skins[to] = []); for (const k of this.d.skins[from] || []) if (!s.includes(k)) s.push(k); delete this.d.skins[from];
    for (const r of Object.values(this.d.runs)) if (r.player === from) r.player = to;
    for (const p of Object.values(this.d.purchases)) if (p.player === from) p.player = to;
    for (const i of Object.values(this.d.identities)) if (i.player === from) i.player = to;
    for (const d of Object.values(this.d.devices)) if (d.player === from) d.player = to;
    delete this.d.secrets[a.secret]; delete this.d.players[from];
    this.d.devices[a.secret] = { player: to, created: a.created, seen: Date.now() };
    this.save();
  }
  createPlayer(id, h, now) {
    this.d.players[id] = { id, secret: h, created: now, seen: now, balance: 0, earned: 0, hour_at: 0, hour_sum: 0, rating: 1000, name: null, runs: 0 };
    this.d.secrets[h] = id; this.save(); return this.player(id);
  }
  touch(id, now) { const p = this.d.players[id]; if (p) { p.seen = now; this.save(); } }
  setWallet(id, w) { const p = this.d.players[id]; if (p) { Object.assign(p, { balance: w.balance, earned: w.earned, hour_at: w.hour_at, hour_sum: w.hour_sum }); this.save(); } }
  skins(id) { return (this.d.skins[id] || []).slice().sort((a, b) => a - b); }
  addSkin(id, skin, now) { const s = this.d.skins[id] || (this.d.skins[id] = []); if (!s.includes(skin)) { s.push(skin); this.save(); } }
  createRun(id, player, now) { this.d.runs[id] = { id, player, started: now, ended: null, payout: null }; this.prune(); this.save(); }
  run(id, player) { const r = this.d.runs[id]; return r && r.player === player ? { ...r } : null; }
  endRun(id, now, payout) { const r = this.d.runs[id]; if (r) { r.ended = now; r.payout = payout; this.save(); } }
  openRuns(player, since) { let n = 0; for (const r of Object.values(this.d.runs)) if (r.player === player && r.ended == null && r.started > since) n++; return n; }
  purchase(id) { const p = this.d.purchases[id]; return p ? { ...p } : null; }
  addPurchase(id, player, product, amount, platform, now) { this.d.purchases[id] = { id, player, product, amount, platform, at: now }; this.save(); }
  playerCount() { return Object.keys(this.d.players).length; }
  setRating(id, rating, name) { const p = this.d.players[id]; if (p) { p.rating = rating; p.name = name; p.runs = (p.runs || 0) + 1; this.save(); } }
  top(n) { return Object.values(this.d.players).filter(p => p.runs > 0).sort((a, b) => (b.rating - a.rating) || (b.runs - a.runs)).slice(0, n).map(p => ({ name: p.name, rating: p.rating, runs: p.runs })); }
  prune() { // keep the run log small
    const ids = Object.keys(this.d.runs); if (ids.length < 5000) return;
    ids.sort((a, b) => this.d.runs[a].started - this.d.runs[b].started);
    for (const id of ids.slice(0, ids.length - 4000)) delete this.d.runs[id];
  }
}

module.exports = { openStore, DATA_DIR };
