// Push notifications: the phones' device tokens, each player's opt-outs, rate limits, and sending through Apple (APNs)
// and Google (FCM). No dependencies: APNs is HTTP/2 from Node's own http2 with a token (.p8 key, ES256 JWT), FCM is the
// HTTP v1 API with a service-account token.
//
// The apps hand the page their device token (ios/Mitosis/Push.swift), and the page registers it here with the player's
// secret, so a token belongs to the player who last registered it. A player can switch each kind off in Settings ›
// Notifications; `off: ['all']` is the master switch. Every send is counted per player (push_log), so a kind can't go out
// more often than its `gap` or `perDay`, and no player gets more than DAILY_MAX a day in all. Tokens Apple or Google
// call dead are deleted at once; the apps register again on every launch.
//
// Configure (environment, e.g. /opt/mitosis/.env; see docs/PUSH.md):
//   APNS_KEY_ID      the 10-character Key ID of the APNs key (Apple Developer › Keys)
//   APNS_TEAM_ID     the team (4M7HR323EA)
//   APNS_KEY         the .p8 file's contents (\n may stand in for newlines), or APNS_KEY_FILE: a path to the .p8
//   APNS_TOPIC       the app's bundle id (default APPLE_BUNDLE_ID or com.mitosisgame.app)
//   APNS_HOST        send everything here instead of Apple (tests and tools/apns-mock.js), e.g. http://localhost:2197
//   FCM_SERVICE_ACCOUNT  Firebase service-account JSON (or base64 of it), for the Android app
'use strict';
const http2 = require('http2'), crypto = require('crypto'), fs = require('fs'), path = require('path');

const DAY = 864e5, MIN = 60e3, HOUR = 3600e3;
// What can be sent. `link` is the screen a tap opens (the page's pushRoute). `gap`: the least time between two of a kind
// to one player; `perDay`: at most this many in 24 hours; `quiet`: not between 22:00 and 9:00 where the player is (their
// phone's time zone); `urgent`: sent at once (APNs priority 10) and dropped if it can't be delivered within `ttl` seconds.
// `hidden` kinds have no switch in Settings. Kinds the player switches off are not sent; `test` (the admin page) ignores that.
const KINDS = [
  { id: 'party', name: 'Party invites', text: 'A friend invites you to play', link: 'friends', gap: 2 * MIN, perDay: 6, urgent: true, ttl: 300 },
  { id: 'friends', name: 'Friend requests', text: 'Someone adds you, or accepts your request', link: 'friends', gap: 10 * MIN, perDay: 3 },
  { id: 'quests', name: 'New quests', text: 'Your daily quests are ready', link: 'quests', gap: 20 * HOUR, perDay: 1, quiet: true, ttl: 12 * 3600 },
  { id: 'pass', name: 'Battle pass', text: 'A season starts, or is about to end', link: 'pass', gap: 20 * HOUR, perDay: 1, quiet: true, ttl: DAY / 1000 },
  { id: 'shop', name: 'Shop and events', text: 'A limited skin or event is back', link: 'shop', gap: 20 * HOUR, perDay: 1, quiet: true, ttl: DAY / 1000 },
  { id: 'test', name: 'Test', link: 'home', gap: 0, perDay: 30, urgent: true, hidden: true },
];
const KIND = Object.fromEntries(KINDS.map(k => [k.id, k]));
const DAILY_MAX = 4;                          // pushes per player per 24 hours, all kinds together (test not counted)
const QUIET = [22, 9];                        // local hours: from 22:00 to 9:00
const LINKS = new Set(['home', 'friends', 'pass', 'quests', 'shop', 'ranks', 'profile', 'settings']);
const MAX_TOKENS = 10;                        // devices per player; the longest unseen goes
const TOKEN_KEEP = 90 * DAY;                  // a token no app has registered for this long is dropped
const TOKEN_RE = { ios: /^[0-9a-f]{64,200}$/, android: /^[\w:.-]{32,512}$/ };

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function localHour(tz, t) {
  if (!tz) return null;
  try { return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date(t))); } catch (e) { return null; }
}
const quietAt = (tz, t) => { const h = localHour(tz, t); return h != null && (h >= QUIET[0] || h < QUIET[1]); };

/* ---------- storage: tables in the server's SQLite, or push.json beside the JSON store ---------- */
function sqliteBackend(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_tokens(token TEXT PRIMARY KEY, player TEXT NOT NULL, platform TEXT NOT NULL, env TEXT, app TEXT, tz TEXT, created INTEGER, seen INTEGER);
    CREATE INDEX IF NOT EXISTS push_tokens_player ON push_tokens(player);
    CREATE TABLE IF NOT EXISTS push_prefs(player TEXT PRIMARY KEY, off TEXT NOT NULL DEFAULT '', at INTEGER);
    CREATE TABLE IF NOT EXISTS push_log(player TEXT, kind TEXT, at INTEGER);
    CREATE INDEX IF NOT EXISTS push_log_player ON push_log(player, at);
    CREATE TABLE IF NOT EXISTS push_once(player TEXT, key TEXT, at INTEGER, PRIMARY KEY(player, key));`);
  const p = s => db.prepare(s), q = {
    save: p(`INSERT INTO push_tokens(token, player, platform, env, app, tz, created, seen) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET player = excluded.player, platform = excluded.platform, env = excluded.env, app = excluded.app, tz = excluded.tz, seen = excluded.seen`),
    of: p('SELECT * FROM push_tokens WHERE player = ? ORDER BY seen DESC'),
    drop: p('DELETE FROM push_tokens WHERE token = ?'),
    setEnv: p('UPDATE push_tokens SET env = ? WHERE token = ?'),
    dropOf: p('DELETE FROM push_tokens WHERE player = ?'),
    moveTokens: p('UPDATE push_tokens SET player = ? WHERE player = ?'),
    pruneTokens: p('DELETE FROM push_tokens WHERE seen < ?'),
    prefs: p('SELECT off FROM push_prefs WHERE player = ?'),
    setPrefs: p('INSERT OR REPLACE INTO push_prefs(player, off, at) VALUES(?, ?, ?)'),
    dropPrefs: p('DELETE FROM push_prefs WHERE player = ?'),
    log: p('INSERT INTO push_log(player, kind, at) VALUES(?, ?, ?)'),
    logSince: p('SELECT kind, at FROM push_log WHERE player = ? AND at >= ?'),
    moveLog: p('UPDATE push_log SET player = ? WHERE player = ?'),
    dropLog: p('DELETE FROM push_log WHERE player = ?'),
    pruneLog: p('DELETE FROM push_log WHERE at < ?'),
    devices: p('SELECT platform, env, COUNT(*) AS n, COUNT(DISTINCT player) AS players FROM push_tokens GROUP BY platform, env'),
    recent: p('SELECT player, MAX(seen) AS seen, GROUP_CONCAT(DISTINCT platform) AS platforms, MAX(app) AS app, COUNT(*) AS n FROM push_tokens GROUP BY player ORDER BY seen DESC LIMIT ?'),
    sentSince: p('SELECT kind, COUNT(*) AS n FROM push_log WHERE at >= ? GROUP BY kind'),
    allPrefs: p("SELECT off FROM push_prefs WHERE off != ''"),
    players: p('SELECT player, tz, seen FROM push_tokens ORDER BY seen DESC'),
    onceHas: p('SELECT 1 AS y FROM push_once WHERE player = ? AND key = ?'),
    onceSet: p('INSERT OR IGNORE INTO push_once(player, key, at) VALUES(?, ?, ?)'),
    moveOnce: p('UPDATE OR IGNORE push_once SET player = ? WHERE player = ?'),
    dropOnce: p('DELETE FROM push_once WHERE player = ?'),
    pruneOnce: p('DELETE FROM push_once WHERE at < ?'),
  };
  return {
    save: (t, now) => q.save.run(t.token, t.player, t.platform, t.env || null, t.app || null, t.tz || null, now, now),
    tokensOf: id => q.of.all(id),
    drop: token => q.drop.run(token),
    setEnv: (token, env) => q.setEnv.run(env, token),
    prune: t => q.pruneTokens.run(t),
    prefs: id => { const r = q.prefs.get(id); return r && r.off ? r.off.split(',') : []; },
    setPrefs: (id, off, now) => q.setPrefs.run(id, off.join(','), now),
    log: (id, kind, at) => { q.log.run(id, kind, at); if (Math.random() < .02) q.pruneLog.run(at - 3 * DAY); },
    logSince: (id, t) => q.logSince.all(id, t).map(r => ({ kind: r.kind, at: Number(r.at) })),
    move: (from, to) => { q.moveTokens.run(to, from); q.moveLog.run(to, from); q.dropPrefs.run(from); q.moveOnce.run(to, from); q.dropOnce.run(from); },
    forget: id => { q.dropOf.run(id); q.dropPrefs.run(id); q.dropLog.run(id); q.dropOnce.run(id); },
    players: () => q.players.all().map(r => ({ player: r.player, tz: r.tz, seen: Number(r.seen) })),
    onceHas: (id, key) => !!q.onceHas.get(id, key),
    onceSet: (id, key, at) => { q.onceSet.run(id, key, at); if (Math.random() < .02) q.pruneOnce.run(at - 400 * DAY); },
    stats: since => ({ devices: q.devices.all().map(r => ({ platform: r.platform, env: r.env, n: Number(r.n), players: Number(r.players) })),
      sent: Object.fromEntries(q.sentSince.all(since).map(r => [r.kind, Number(r.n)])), off: q.allPrefs.all().map(r => r.off.split(',')) }),
    recent: n => q.recent.all(n).map(r => ({ player: r.player, seen: Number(r.seen), platforms: String(r.platforms || '').split(','), app: r.app, n: Number(r.n) })),
  };
}
function jsonBackend(file) {
  let d = { tokens: {}, prefs: {}, log: [], once: {} };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.tokens) d = Object.assign(d, j); } catch (e) {}
  let timer = null;
  const save = () => { if (timer) return; timer = setTimeout(() => { timer = null; try { fs.writeFileSync(file + '.tmp', JSON.stringify(d)); fs.renameSync(file + '.tmp', file); } catch (e) { console.error('push: not saved: ' + e.message); } }, 250); if (timer.unref) timer.unref(); };
  const all = () => Object.values(d.tokens);
  return {
    save: (t, now) => { const o = d.tokens[t.token]; d.tokens[t.token] = { token: t.token, player: t.player, platform: t.platform, env: t.env || null, app: t.app || null, tz: t.tz || null, created: o ? o.created : now, seen: now }; save(); },
    tokensOf: id => all().filter(t => t.player === id).sort((a, b) => b.seen - a.seen).map(t => ({ ...t })),
    drop: token => { delete d.tokens[token]; save(); },
    setEnv: (token, env) => { if (d.tokens[token]) { d.tokens[token].env = env; save(); } },
    prune: t => { for (const [k, v] of Object.entries(d.tokens)) if (v.seen < t) delete d.tokens[k]; save(); },
    prefs: id => (d.prefs[id] || []).slice(),
    setPrefs: (id, off) => { if (off.length) d.prefs[id] = off.slice(); else delete d.prefs[id]; save(); },
    log: (id, kind, at) => { d.log.push({ player: id, kind, at }); if (d.log.length > 5000 || Math.random() < .02) d.log = d.log.filter(r => r.at >= at - 3 * DAY); save(); },
    logSince: (id, t) => d.log.filter(r => r.player === id && r.at >= t).map(r => ({ kind: r.kind, at: r.at })),
    move: (from, to) => { for (const v of all()) if (v.player === from) v.player = to; for (const r of d.log) if (r.player === from) r.player = to; delete d.prefs[from];
      for (const [k, at] of Object.entries(d.once)) if (k.startsWith(from + '\n')) { const nk = to + k.slice(from.length); if (!(nk in d.once)) d.once[nk] = at; delete d.once[k]; } save(); },
    forget: id => { for (const [k, v] of Object.entries(d.tokens)) if (v.player === id) delete d.tokens[k]; delete d.prefs[id]; d.log = d.log.filter(r => r.player !== id);
      for (const k of Object.keys(d.once)) if (k.startsWith(id + '\n')) delete d.once[k]; save(); },
    players: () => all().sort((a, b) => b.seen - a.seen).map(t => ({ player: t.player, tz: t.tz, seen: t.seen })),
    onceHas: (id, key) => (id + '\n' + key) in d.once,
    onceSet: (id, key, at) => { d.once[id + '\n' + key] = at; save(); },
    stats: since => {
      const dev = new Map(); for (const t of all()) { const k = t.platform + '|' + t.env, r = dev.get(k) || { platform: t.platform, env: t.env, n: 0, ps: new Set() }; r.n++; r.ps.add(t.player); dev.set(k, r); }
      const sent = {}; for (const r of d.log) if (r.at >= since) sent[r.kind] = (sent[r.kind] || 0) + 1;
      return { devices: [...dev.values()].map(r => ({ platform: r.platform, env: r.env, n: r.n, players: r.ps.size })), sent, off: Object.values(d.prefs).filter(a => a.length) };
    },
    recent: n => { const m = new Map(); for (const t of all()) { const r = m.get(t.player) || { player: t.player, seen: 0, platforms: [], app: null, n: 0 }; r.seen = Math.max(r.seen, t.seen); if (!r.platforms.includes(t.platform)) r.platforms.push(t.platform); r.app = r.app || t.app; r.n++; m.set(t.player, r); } return [...m.values()].sort((a, b) => b.seen - a.seen).slice(0, n); },
  };
}

/* ---------- Apple: APNs over HTTP/2 with a provider token ---------- */
// A provider token is an ES256 JWT signed with the .p8 key. Apple wants it renewed at least hourly and at most every
// 20 minutes, so it is kept for 50. One HTTP/2 connection per environment carries every request; it is opened on demand
// and closed after 10 idle minutes. A token from a development build (Xcode, or the archive's .app installed by hand) only
// works on the sandbox host: the app says which it has, and a BadDeviceToken there is tried once on the other host.
const APNS_HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
const APNS_DEAD = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);
function apnsSender({ keyId, teamId, key, topic, host, hosts = APNS_HOSTS, now = () => Date.now(), timeoutMs = 10e3 }) {
  const priv = crypto.createPrivateKey(key);
  let jwt = null, jwtAt = 0;
  const sessions = {};
  function bearer(fresh) {
    const t = now();
    if (!fresh && jwt && t - jwtAt < 50 * MIN) return jwt;
    const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId })), body = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(t / 1000) }));
    jwt = head + '.' + body + '.' + b64url(crypto.sign('sha256', Buffer.from(head + '.' + body), { key: priv, dsaEncoding: 'ieee-p1363' })); jwtAt = t;
    return jwt;
  }
  function session(env) {
    const url = host || hosts[env];
    let s = sessions[url];
    if (s && !s.closed && !s.destroyed) return s;
    s = http2.connect(url);
    s.on('error', () => {}); s.on('goaway', () => s.close());
    s.on('close', () => { if (sessions[url] === s) delete sessions[url]; });
    s.setTimeout(10 * MIN, () => s.close());
    s.unref();
    return (sessions[url] = s);
  }
  function request(env, token, body, headers) {
    return new Promise(resolve => {
      let st;
      try { st = session(env).request({ ':method': 'POST', ':path': '/3/device/' + token, authorization: 'bearer ' + bearer(), 'content-type': 'application/json', ...headers }); }
      catch (e) { return resolve({ status: 0, reason: e.message }); }
      let status = 0, apnsId = null, data = '';
      st.setEncoding('utf8');
      st.on('response', h => { status = Number(h[':status']); apnsId = h['apns-id'] || null; });
      st.on('data', c => { data += c; });
      st.on('end', () => { let reason = null; try { reason = data ? JSON.parse(data).reason : null; } catch (e) {} resolve({ status, reason, apnsId }); });
      st.on('error', e => resolve({ status: 0, reason: e.message }));
      st.setTimeout(timeoutMs, () => { st.close(http2.constants.NGHTTP2_CANCEL); resolve({ status: 0, reason: 'timeout' }); });
      st.end(body);
    });
  }
  // note: { kind, title, body, link, collapse, ttl, urgent, data }. Returns { ok } (with env if it moved), { dead } or { error }.
  async function send(t, note) {
    const payload = { aps: { alert: { title: note.title, body: note.body }, sound: 'default', 'thread-id': note.kind }, link: note.link, kind: note.kind, ...(note.data || {}) };
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > 4096) return { error: 'payload over 4 KB' };
    const headers = { 'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': note.urgent ? '10' : '5' };
    if (note.ttl) headers['apns-expiration'] = String(Math.floor(now() / 1000) + note.ttl);
    if (note.collapse) headers['apns-collapse-id'] = String(note.collapse).slice(0, 64);
    const env = t.env === 'sandbox' ? 'sandbox' : 'production';
    let r = await request(env, t.token, body, headers);
    if (r.status === 403 && r.reason === 'ExpiredProviderToken') { bearer(true); r = await request(env, t.token, body, headers); }
    if (r.status === 400 && r.reason === 'BadDeviceToken' && !host) { // maybe a token from the other environment
      const other = env === 'sandbox' ? 'production' : 'sandbox', r2 = await request(other, t.token, body, headers);
      if (r2.status === 200) return { ok: true, env: other, id: r2.apnsId };
    }
    if (r.status === 200) return { ok: true, id: r.apnsId };
    if ((r.status === 410 || r.status === 400) && APNS_DEAD.has(r.reason)) return { dead: r.reason };
    return { error: (r.status || 'no answer') + (r.reason ? ' ' + r.reason : '') };
  }
  function close() { for (const s of Object.values(sessions)) try { s.close(); } catch (e) {} }
  return { send, close, bearer };
}

/* ---------- Google: FCM HTTP v1 ---------- */
// The service account signs a JWT (RS256) that buys an OAuth token for the firebase.messaging scope, kept until it expires.
function fcmSender({ account, now = () => Date.now(), fetchFn = (...a) => fetch(...a), base = 'https://fcm.googleapis.com', oauth = 'https://oauth2.googleapis.com/token' }) {
  let token = null, exp = 0;
  async function access() {
    const t = Math.floor(now() / 1000);
    if (token && t < exp - 60) return token;
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), body = b64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: oauth, iat: t, exp: t + 3600 }));
    const assertion = head + '.' + body + '.' + b64url(crypto.sign('sha256', Buffer.from(head + '.' + body), account.private_key));
    const r = await fetchFn(oauth, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + assertion });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error('FCM sign-in failed');
    token = j.access_token; exp = t + (j.expires_in || 3600);
    return token;
  }
  async function send(t, note) {
    const msg = { token: t.token, notification: { title: note.title, body: note.body }, data: { link: String(note.link), kind: String(note.kind) },
      android: { priority: note.urgent ? 'high' : 'normal', ...(note.ttl ? { ttl: note.ttl + 's' } : {}), ...(note.collapse ? { collapse_key: String(note.collapse).slice(0, 64) } : {}),
        notification: { channel_id: note.kind, ...(note.collapse ? { tag: String(note.collapse).slice(0, 64) } : {}) } } };
    try {
      const r = await fetchFn(`${base}/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, { method: 'POST', headers: { Authorization: 'Bearer ' + await access(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
      if (r.ok) return { ok: true, id: (await r.json().catch(() => ({}))).name || null };
      const j = await r.json().catch(() => ({})), e = j.error || {}, code = ((e.details || []).find(x => x.errorCode) || {}).errorCode || e.status || '';
      if (r.status === 401) token = null;
      if (r.status === 404 || code === 'UNREGISTERED' || (r.status === 400 && code === 'INVALID_ARGUMENT' && /token/i.test(e.message || ''))) return { dead: code || 'UNREGISTERED' };
      return { error: r.status + ' ' + code };
    } catch (e) { return { error: e.message }; }
  }
  return { send, close() {} };
}

/* ---------- configuration from the environment ---------- */
function fromEnv(env = process.env) {
  const out = { apns: null, fcm: null, problems: [] };
  let key = (env.APNS_KEY || '').replace(/\\n/g, '\n');
  if (!key && env.APNS_KEY_FILE) { try { key = fs.readFileSync(env.APNS_KEY_FILE, 'utf8'); } catch (e) { out.problems.push('APNS_KEY_FILE unreadable: ' + e.message); } }
  if (key || env.APNS_KEY_ID) {
    if (!key || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) out.problems.push('APNs needs APNS_KEY (or APNS_KEY_FILE), APNS_KEY_ID and APNS_TEAM_ID');
    else {
      try { crypto.createPrivateKey(key); out.apns = { keyId: env.APNS_KEY_ID.trim(), teamId: env.APNS_TEAM_ID.trim(), key, topic: env.APNS_TOPIC || env.APPLE_BUNDLE_ID || 'com.mitosisgame.app', host: env.APNS_HOST || null }; }
      catch (e) { out.problems.push('APNS_KEY is not a valid .p8 key: ' + e.message); }
    }
  }
  if (env.FCM_SERVICE_ACCOUNT) {
    try { const raw = env.FCM_SERVICE_ACCOUNT.trim(), a = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      if (a.client_email && a.private_key && a.project_id) out.fcm = { account: a }; else out.problems.push('FCM_SERVICE_ACCOUNT lacks client_email, private_key or project_id'); }
    catch (e) { out.problems.push('FCM_SERVICE_ACCOUNT is not JSON'); }
  }
  return out;
}

/* ---------- the module ---------- */
// store: the server's store (its SQLite db is used when there is one); dataDir: where push.json goes otherwise.
// config: { apns, fcm } as fromEnv gives; senders: { ios, android } to swap the senders (tests).
function create({ store, dataDir, config = fromEnv(), senders = {}, now = () => Date.now(), log = s => console.log(s) }) {
  const db = store && store.kind === 'sqlite' && store.db ? sqliteBackend(store.db) : jsonBackend(path.join(dataDir || '.', 'push.json'));
  const send = {
    ios: senders.ios || (config.apns ? apnsSender({ ...config.apns, now }) : null),
    android: senders.android || (config.fcm ? fcmSender({ ...config.fcm, now }) : null),
  };
  for (const p of config.problems || []) log('push: ' + p);

  const prefsOf = id => db.prefs(id).filter(k => k === 'all' || KIND[k]);
  const view = id => ({ kinds: KINDS.filter(k => !k.hidden).map(({ id: k, name, text }) => ({ id: k, name, text })), off: prefsOf(id), devices: db.tokensOf(id).length,
    ready: { ios: !!send.ios, android: !!send.android } });

  // Why this player can't get this kind now (a word), or null when it may go.
  function blocked(id, kind, t, tokens) {
    const K = KIND[kind];
    if (kind !== 'test') { const off = prefsOf(id); if (off.includes('all') || off.includes(kind)) return 'off'; }
    const day = db.logSince(id, t - DAY), same = day.filter(r => r.kind === kind);
    if (same.length >= K.perDay) return 'limit';
    if (same.length && t - Math.max(...same.map(r => r.at)) < K.gap) return 'limit';
    if (kind !== 'test' && day.filter(r => r.kind !== 'test').length >= DAILY_MAX) return 'limit';
    if (K.quiet && tokens.length && quietAt(tokens[0].tz, t)) return 'quiet';
    return null;
  }

  // Sends one notification to every device of a player. msg: { title, body, link?, collapse?, data? }.
  // Resolves to { sent, dead, errors, skipped? } — skipped: 'off' | 'limit' | 'quiet' | 'no device' | 'not configured'.
  async function notify(id, kind, msg, opts = {}) {
    const K = KIND[kind]; if (!K) throw new Error('unknown push kind ' + kind);
    const t = now(), tokens = db.tokensOf(id);
    const out = { sent: 0, dead: 0, errors: [] };
    if (!tokens.length) return { ...out, skipped: 'no device' };
    const why = opts.force ? null : blocked(id, kind, t, tokens); if (why) return { ...out, skipped: why };
    const link = LINKS.has(msg.link) ? msg.link : K.link;
    const note = { kind, title: clip(msg.title, 80), body: clip(msg.body, 180), link, collapse: msg.collapse || null, data: msg.data || null, urgent: !!K.urgent, ttl: K.ttl || 0 };
    let reached = false;
    await Promise.all(tokens.map(async tk => {
      const s = send[tk.platform];
      if (!s) { out.errors.push(tk.platform + ' not configured'); return; }
      const r = await s.send(tk, note);
      if (r.ok) { out.sent++; reached = true; if (r.env && r.env !== tk.env) db.setEnv(tk.token, r.env); }
      else if (r.dead) { out.dead++; db.drop(tk.token); log(`push: dropped a dead ${tk.platform} token (${r.dead})`); }
      else out.errors.push(r.error);
    }));
    if (reached) db.log(id, kind, t);
    if (!out.sent && !out.dead && out.errors.length && out.errors.every(e => /not configured/.test(e))) out.skipped = 'not configured';
    return out;
  }

  // notify, but only once per player for `key` (an event: a season starting, an event opening). It counts as done when it
  // reached a device or the player has the kind switched off; at night or over a limit it can be tried again later.
  async function notifyOnce(id, key, kind, msg, opts) {
    if (db.onceHas(id, key)) return { sent: 0, dead: 0, errors: [], skipped: 'sent before' };
    const r = await notify(id, kind, msg, opts);
    if (r.sent || r.skipped === 'off') db.onceSet(id, key, now());
    return r;
  }
  // every player with a device: { player, tz (of their latest device), seen }, latest first
  function players() { const seen = new Set(); return db.players().filter(r => !seen.has(r.player) && seen.add(r.player)); }

  const handlers = {
    // the page hands over this device's token: { token, platform, env?, app?, tz? }
    register(store, body, p) {
      const platform = body.platform === 'android' ? 'android' : body.platform === 'ios' ? 'ios' : null;
      if (!platform) throw fail(400, 'platform must be ios or android');
      const token = String(body.token || '').trim(), tokenOk = platform === 'ios' ? TOKEN_RE.ios.test(token.toLowerCase()) : TOKEN_RE.android.test(token);
      if (!tokenOk) throw fail(400, 'that is not a device token');
      const tz = clip(body.tz, 64), t = now();
      db.save({ token: platform === 'ios' ? token.toLowerCase() : token, player: p.id, platform, env: platform === 'ios' ? (body.env === 'sandbox' ? 'sandbox' : 'production') : null,
        app: clip(body.app, 40) || null, tz: localHour(tz, t) == null ? null : tz }, t);
      const mine = db.tokensOf(p.id); for (const old of mine.slice(MAX_TOKENS)) db.drop(old.token);
      if (Math.random() < .05) db.prune(t - TOKEN_KEEP);
      return view(p.id);
    },
    // the app lost permission, or the player signed out on this device
    unregister(store, body, p) {
      const token = String(body.token || '').trim().toLowerCase();
      for (const t of db.tokensOf(p.id)) if (t.token.toLowerCase() === token) db.drop(t.token);
      return view(p.id);
    },
    // { off: ['quests', ...] } sets the kinds switched off ('all': every kind); without it, just the view
    prefs(store, body, p) {
      if (Array.isArray(body.off)) db.setPrefs(p.id, [...new Set(body.off.map(String).filter(k => k === 'all' || (KIND[k] && !KIND[k].hidden)))], now());
      return view(p.id);
    },
  };

  return {
    KINDS, notify, notifyOnce, players, handlers, view,
    // sign-in folded one player into another: devices and the send log move; the account keeps its own switches
    merge(from, to) { if (from !== to) db.move(from, to); },
    forget(id) { db.forget(id); },
    stats(t = now()) { return { ...db.stats(t - DAY), ready: { ios: !!send.ios, android: !!send.android }, apns: config.apns ? { keyId: config.apns.keyId, teamId: config.apns.teamId, topic: config.apns.topic, host: config.apns.host } : null, problems: config.problems || [] }; },
    recent: n => db.recent(n),
    close() { for (const s of Object.values(send)) if (s && s.close) s.close(); },
  };
}

module.exports = { create, fromEnv, apnsSender, fcmSender, KINDS, DAILY_MAX, quietAt, localHour };
