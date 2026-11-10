// Mitosis server — serves the game, relays live play between players over
// WebSockets, and runs the ATP economy API (wallets, skins, purchases).
// No dependencies: needs only Node.js 20+ (https://nodejs.org). Run:  node server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const { openStore, DATA_DIR } = require('./store');
const economy = require('./economy');
const netstats = require('./netstats');
const live = require('./live');
const social = require('./social');
const pushes = require('./push');
const pushTriggersMod = require('./push-triggers');
const bugReports = require('./bugs');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_SIZE = 16;                // games per arena room: each room has its own host, bots and round
const MAX_ROOMS = Math.max(1, Number(process.env.MAX_ROOMS) || 8); // past ROOM_SIZE × MAX_ROOMS games, new ones are turned away
const MAX_MSG = 16 * 1024;          // bytes per message
const MAX_RATE = 90;                // messages per second per player
const MAX_BODY = 64 * 1024;         // bytes per API request
const API_RATE = 120;               // API requests per minute per IP
const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const UPDATES_DIR = process.env.UPDATES_DIR || path.join(__dirname, 'updates'); // signed page updates for the apps (tools/page-update.js)
const store = openStore();
if (economy.ladderReset(store)) console.log('rank ladder: every rating starts again at ' + economy.RATING.start); // once per database (economy.js)
let pushTriggers = null; // what sends notifications (push-triggers.js): friend requests and party invites as they happen, the rest on a timer
const friends = social.create({ file: path.join(DATA_DIR, 'social.json'), nameBlocked: economy.nameBlocked, onEvent: e => { if (pushTriggers) pushTriggers.onSocial(e).catch(err => console.error('push: ' + err.message)); } });
const pushLog = s => console.log(new Date().toLocaleTimeString() + '  ' + s);
const push = pushes.create({ store, dataDir: DATA_DIR, log: pushLog }); // push notifications (push.js): device tokens, switches, APNs / FCM
const bugs = bugReports.create({ store, log: pushLog }); // bug reports from the game (bugs.js), read at /admin/bugs
pushTriggers = pushTriggersMod.create({ store, push, economy, social: friends, log: pushLog });
pushTriggers.start();
// signing in can fold this device's player into an existing account: its friends move along
const signIn = fn => async (store, body, p) => {
  const r = await fn(store, body, p);
  if (r && r.merged) { const to = store.playerBySecret(p.deviceHash); if (to && to.id !== p.id) { friends.merge(p.id, to.id); push.merge(p.id, to.id); } }
  return r;
};

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(`http://${a.address}:${PORT}`);
  return out;
}

/* ---------- HTTP: game page, health, economy API ---------- */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };
const ROUTES = {
  'POST /api/session': { fn: economy.handlers.session, auth: false },
  'POST /api/run/start': { fn: (store, body, p) => { const r = economy.handlers.runStart(store, body, p); players.runStarted(r.runId); runRelay(r.runId, body.relay); return r; }, auth: true },
  'POST /api/run/end': { fn: (store, body, p) => { const r = economy.handlers.runEnd(store, body, p, { metSince: t => metSince(body.runId, body.relay, t) }); players.runEnded(body.runId); runConns.delete(String(body.runId)); return r; }, auth: true },
  'POST /api/run/life': { fn: economy.handlers.buyLife, auth: true },   // an extra life for ATP (economy.js EXTRA_LIFE)
  'POST /api/skins/buy': { fn: economy.handlers.buySkin, auth: true },
  'POST /api/iap/apple': { fn: economy.handlers.iapApple, auth: true },
  'POST /api/iap/google': { fn: economy.handlers.iapGoogle, auth: true },
  'POST /api/auth/apple': { fn: signIn(economy.handlers.signInApple), auth: true },
  'POST /api/auth/google': { fn: signIn(economy.handlers.signInGoogle), auth: true },
  'POST /api/auth/signout': { fn: economy.handlers.signOut, auth: true },
  'POST /api/font': { fn: economy.handlers.setFont, auth: true },          // the font your name is shown in (economy.js FONT_LOCKS)
  'POST /api/font/buy': { fn: economy.handlers.buyFont, auth: true },
  'POST /api/account/delete': { fn: (store, body, p) => { const r = economy.handlers.deleteAccount(store, body, p); friends.forget(p.id); return r; }, auth: true },
  'POST /api/pass': { fn: economy.handlers.passView, auth: true },
  'POST /api/pass/premium': { fn: economy.handlers.passPremium, auth: true },
  'POST /api/pass/claim': { fn: economy.handlers.passClaim, auth: true },
  'POST /api/quests/claim': { fn: economy.handlers.questClaim, auth: true },
  // friends and parties (social.js): each answers with the caller's friends, requests, party and invites
  'POST /api/social/me': { fn: friends.handlers.me, auth: true },
  'POST /api/social/add': { fn: friends.handlers.add, auth: true },
  'POST /api/social/accept': { fn: friends.handlers.accept, auth: true },
  'POST /api/social/remove': { fn: friends.handlers.remove, auth: true },
  'POST /api/social/party/invite': { fn: friends.handlers.partyInvite, auth: true },
  'POST /api/social/party/join': { fn: friends.handlers.partyJoin, auth: true },
  'POST /api/social/party/decline': { fn: friends.handlers.partyDecline, auth: true },
  'POST /api/social/party/leave': { fn: friends.handlers.partyLeave, auth: true },
  'POST /api/social/party/go': { fn: friends.handlers.partyGo, auth: true },
  // push notifications (push.js): the page registers the app's device token and sets which kinds to send
  'POST /api/push/register': { fn: push.handlers.register, auth: true },
  'POST /api/push/unregister': { fn: push.handlers.unregister, auth: true },
  'POST /api/push/prefs': { fn: push.handlers.prefs, auth: true },
  'GET /api/catalog': { fn: store => economy.catalog(store), auth: false },
  'GET /api/leaderboard': { fn: store => economy.handlers.leaderboard(store), auth: false },
  // clients report long frames here so stalls on phones can be read from the server log
  'POST /api/log': { fn: (store, body) => { log('[client ' + String(body.who || '?').slice(0, 24) + '] ' + String(body.text || '').slice(0, 300)); return { ok: true }; }, auth: false },
  // the apps send crash and hang reports here (see ios/Mitosis/CrashReporter.swift, android/.../CrashReporter.kt)
  'POST /api/crash': { fn: crashReport, auth: false, body: 512 * 1024 },
  // connection quality from the games (ping, lost pings, frame rate, time-zone region); read it at /admin/net
  'POST /api/net': { fn: (store, body) => { const r = netstats.clean(body, Date.now()); if (r) store.addNet(r); return { ok: true }; }, auth: false },
  // a player's bug report (Settings › Report a bug): signed in or not, limited per player and per address
  'POST /api/bug': { fn: bugs.handlers.report, auth: 'optional', body: 16 * 1024 },
};
// deleting an account deletes its push devices and switches too
{ const route = ROUTES['POST /api/account/delete'], del = route.fn; route.fn = (store, body, p) => { const r = del(store, body, p); push.forget(p.id); bugs.forget(p.id); return r; }; }
// The admin pages are for the operator: /admin/net?token=… (connection report), /admin/live?token=… (live players), /admin/pass?token=… (the battle pass switch)
// and /admin/bugs?token=… (bug reports).
// The token is ADMIN_TOKEN, or one made on first start and kept in the data dir.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (() => {
  const f = path.join(DATA_DIR, 'admin-token');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) {}
  const t = crypto.randomBytes(18).toString('hex');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, t + '\n', { mode: 0o600 }); } catch (e) {}
  return t;
})();
function adminOk(req, res) {
  const t = new URL(req.url, 'http://x').searchParams.get('token') || '';
  const ok = t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN));
  if (!ok) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden'); }
  return ok;
}
function netReport(req, res) {
  if (!adminOk(req, res)) return;
  const q = new URL(req.url, 'http://x').searchParams;
  const days = Math.min(90, Math.max(1, Number(q.get('days')) || 7)), sum = netstats.summary(store.netSince(Date.now() - days * 864e5));
  if (q.get('format') === 'json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ days, ...sum })); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(netstats.page(sum, days));
}
// The battle pass switch: GET shows it (&format=json for numbers), POST on=1 / on=0 flips it, and POST tester=<player id>&add=1 / add=0
// adds or removes a tester (who sees the pass before it is launched). Both are kept in the store, so they survive deploys.
async function passPage(req, res) {
  if (!adminOk(req, res)) return;
  const q = new URL(req.url, 'http://x').searchParams;
  if (req.method === 'POST') {
    let body = ''; for await (const d of req) { body += d; if (body.length > 1024) break; }
    const f = new URLSearchParams(body);
    if (f.has('tester')) { try { economy.passAdmin(store, null, { id: f.get('tester'), on: f.get('add') === '1' }); } catch (e) {} } // a player who is gone, or too many testers: nothing changes
    else if (f.has('quests')) economy.questsSwitch(store, f.get('quests') === '1');
    else economy.passAdmin(store, f.get('on') === '1');
    res.writeHead(303, { Location: '/admin/pass?token=' + encodeURIComponent(q.get('token')) }); return res.end();
  }
  const a = economy.passAdmin(store);
  if (q.get('format') === 'json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(a)); }
  const day = t => new Date(t).toISOString().slice(0, 10), s = a.season, st = a.stats, esc = v => String(v).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m + ' min ago'; }, isTester = new Set(a.testers.map(r => r.id));
  const row = (r, add) => `<li><span><b>${esc(r.name)}</b><small>${esc(r.id.slice(0, 8))} · level ${r.level} · ${r.runs} lives${r.account ? ' · ' + esc(r.account) : ''}${add ? ' · ' + ago(r.seen) : ''}</small></span>`
    + `<form method="post"><input type="hidden" name="tester" value="${esc(r.id)}"><input type="hidden" name="add" value="${add ? 1 : 0}"><button class="${add ? 'add' : 'rm'}">${add ? 'Make tester' : 'Remove'}</button></form></li>`;
  const recent = a.recent.filter(r => !isTester.has(r.id));
  const where = s ? `Season ${s.n}: ${s.name}, ${day(s.starts)} to ${day(s.ends)} (${Math.max(0, Math.ceil((s.ends - Date.now()) / 864e5))} days left)` : `No season runs today.${a.next ? ` Next: ${a.next.name}, from ${day(a.next.starts)}.` : ' Add one to PASS_SEASONS in economy.js.'}`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mitosis battle pass</title>
<style>body{margin:0;padding:24px 16px;background:#020809;color:#dcefe9;font:16px/1.5 system-ui,sans-serif}main{max-width:520px;margin:auto}h1{font-size:24px;margin:0 0 16px}
.st{display:inline-block;padding:4px 12px;border-radius:99px;font-weight:700;background:${a.live ? '#1f6f4f' : '#5b2330'}}p{color:#8aaea9}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px}dt{color:#8aaea9}dd{margin:0;font-weight:600}
button{font:700 16px system-ui;padding:12px 22px;border-radius:99px;border:0;cursor:pointer;background:${a.on ? '#e5484d' : '#ff5c8a'};color:#fff}
h2{font-size:19px;margin:32px 0 4px}h3{font-size:15px;margin:20px 0 8px;color:#dcefe9}ul.pl{list-style:none;margin:0;padding:0;display:grid;gap:8px}.pl li{display:flex;align-items:center;gap:12px;padding:10px 10px 10px 14px;border-radius:14px;background:#0b1a1c}
.pl span{flex:1;display:grid;gap:2px;min-width:0}.pl small{color:#8aaea9;font-size:13px}.pl form{margin:0}.pl button{font-size:14px;padding:9px 16px}.pl .add{background:#1f6f4f}.pl .rm{background:#2a3a3c}</style>
<main><h1>Battle pass</h1><p><span class="st">${a.live ? 'Live' : a.on ? 'On, but no season today' : 'Off (hidden)'}</span>${!a.live && a.testers.length ? ` · ${a.testers.length} tester${a.testers.length > 1 ? 's' : ''} can see it` : ''}</p><p>${where}</p>
${st ? `<dl><dt>Players with progress</dt><dd>${st.players}</dd><dt>Bought the Battle Pass</dt><dd>${st.premium}</dd><dt>Rewards claimed</dt><dd>${st.claims}</dd><dt>XP earned</dt><dd>${st.xp.toLocaleString()}</dd><dt>Quests done today</dt><dd>${st.quests.today}</dd><dt>Quests done this week</dt><dd>${st.quests.week}</dd></dl>` : ''}
<form method="post"><input type="hidden" name="on" value="${a.on ? 0 : 1}"><button>${a.on ? 'Turn off (hide it)' : 'Turn on'}</button></form>
<p>Players see the pass only while it is on and a season is running. Turning it off hides it; progress and rewards stay.</p>
<h2>Quests</h2><p><span class="st" style="background:${a.quests.on ? '#1f6f4f' : '#5b2330'}">${a.quests.on ? 'On' : 'Off (hidden)'}</span> · ${a.quests.today} done today · ${a.quests.week} this week</p>
<p>Daily, weekly and permanent quests for ranked lives. They don't need the battle pass: they pay ATP when claimed, and pass XP too while the pass is live. Turning them off hides them; lifetime totals keep counting and unclaimed rewards wait.</p>
<form method="post"><input type="hidden" name="quests" value="${a.quests.on ? 0 : 1}"><button>${a.quests.on ? 'Turn quests off' : 'Turn quests on'}</button></form>
<h2>Testers</h2><p>Testers see the pass now: while it is off, and before its season starts. What they earn and claim is real and carries into the season. To add a phone, open the game on it, reload this page and press Make tester beside it.</p>
${a.testers.length ? `<ul class="pl">${a.testers.map(r => row(r, false)).join('')}</ul>` : '<p>No testers yet.</p>'}
<h3>Opened the game in the last 30 minutes</h3>${recent.length ? `<ul class="pl">${recent.map(r => row(r, true)).join('')}</ul>` : '<p>Nobody else.</p>'}</main>`);
}
// Push notifications for the operator: GET shows whether Apple / Google sending is set up, the devices, what went out today
// and the players with notifications; POST player=<id> sends that player a test (title, body and link optional), e.g.
//   curl -d player=<id> -d link=friends 'http://localhost:3000/admin/push?token=…'
async function pushPage(req, res) {
  if (!adminOk(req, res)) return;
  const q = new URL(req.url, 'http://x').searchParams, esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  if (req.method === 'POST') {
    let body = ''; for await (const d of req) { body += d; if (body.length > 4096) break; }
    const f = new URLSearchParams(body), id = f.get('player') || '', who = store.player(id);
    const r = who ? await push.notify(id, 'test', { title: f.get('title') || 'Mitosis', body: f.get('body') || 'Test notification. Tap to open ' + (f.get('link') || 'the game') + '.', link: f.get('link') || 'home' })
      : { sent: 0, dead: 0, errors: [], skipped: 'no such player' };
    const said = r.sent ? `Sent to ${r.sent} device${r.sent > 1 ? 's' : ''}` : r.skipped ? 'Not sent: ' + r.skipped : 'Not sent';
    const msg = said + (r.dead ? `, dropped ${r.dead} dead token${r.dead > 1 ? 's' : ''}` : '') + (r.errors.length ? ' (' + r.errors.join('; ') + ')' : '');
    log('push test to ' + id.slice(0, 8) + ': ' + msg);
    if (q.get('format') === 'json' || /json|curl/i.test((req.headers.accept || '') + (req.headers['user-agent'] || ''))) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r) + '\n'); }
    res.writeHead(303, { Location: '/admin/push?token=' + encodeURIComponent(q.get('token')) + '&said=' + encodeURIComponent(msg) }); return res.end();
  }
  const st = push.stats(), recent = push.recent(30).map(r => ({ ...r, name: (store.player(r.player) || {}).name || 'Unnamed cell' }));
  if (q.get('format') === 'json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ ...st, recent })); }
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 120 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
  const links = ['home', 'friends', 'quests', 'pass', 'shop'], kinds = push.KINDS.filter(k => !k.hidden);
  const offCount = k => st.off.filter(a => a.includes(k) || a.includes('all')).length;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mitosis notifications</title>
<style>body{margin:0;padding:24px 16px;background:#020809;color:#dcefe9;font:16px/1.5 system-ui,sans-serif}main{max-width:560px;margin:auto}h1{font-size:24px;margin:0 0 16px}h2{font-size:19px;margin:28px 0 8px}
p{color:#8aaea9}.st{display:inline-block;padding:4px 12px;border-radius:99px;font-weight:700;margin-right:6px}.on{background:#1f6f4f}.off{background:#5b2330}.said{background:#0b1a1c;padding:10px 14px;border-radius:12px;color:#dcefe9}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px}dt{color:#8aaea9}dd{margin:0;font-weight:600}ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}li{padding:10px 14px;border-radius:14px;background:#0b1a1c;display:grid;gap:8px}
li small{color:#8aaea9;font-size:13px}form{display:flex;gap:8px;flex-wrap:wrap;margin:0}select,input{font:15px system-ui;padding:8px 10px;border-radius:10px;border:1px solid #2a3a3c;background:#020809;color:#dcefe9;min-width:0}input{flex:1}
button{font:700 15px system-ui;padding:9px 18px;border-radius:99px;border:0;cursor:pointer;background:#ff5c8a;color:#fff}code{font-size:13px;color:#8aaea9;word-break:break-all}</style>
<main><h1>Notifications</h1>
<p><span class="st ${st.ready.ios ? 'on' : 'off'}">Apple ${st.ready.ios ? 'ready' : 'not set up'}</span><span class="st ${st.ready.android ? 'on' : 'off'}">Google ${st.ready.android ? 'ready' : 'not set up'}</span></p>
${st.apns ? `<p>APNs key ${esc(st.apns.keyId)}, team ${esc(st.apns.teamId)}, app ${esc(st.apns.topic)}${st.apns.host ? ' · sending to <b>' + esc(st.apns.host) + '</b> (a stand-in, not Apple)' : ''}</p>` : '<p>Apple sending needs APNS_KEY, APNS_KEY_ID and APNS_TEAM_ID (see docs/PUSH.md).</p>'}
${st.problems.map(p => '<p class="said">' + esc(p) + '</p>').join('')}
${q.get('said') ? '<p class="said">' + esc(q.get('said')) + '</p>' : ''}
<h2>Devices</h2>${st.devices.length ? '<dl>' + st.devices.map(d => `<dt>${d.platform === 'ios' ? 'iPhone / iPad' : 'Android'}${d.env ? ' (' + d.env + ')' : ''}</dt><dd>${d.n} device${d.n === 1 ? '' : 's'}, ${d.players} player${d.players === 1 ? '' : 's'}</dd>`).join('') + '</dl>' : '<p>No device has registered yet. The app registers once a player allows notifications.</p>'}
<h2>Last 24 hours</h2><dl>${kinds.map(k => `<dt>${esc(k.name)}</dt><dd>${st.sent[k.id] || 0} sent · ${offCount(k.id)} switched off</dd>`).join('')}<dt>Tests</dt><dd>${st.sent.test || 0}</dd></dl>
<h2>Send a test</h2><p>Goes to every device of that player, even with their notifications switched off in the game (not if iOS has them off). Tapping it opens the screen you pick.</p>
${recent.length ? '<ul>' + recent.map(r => `<li><span><b>${esc(r.name)}</b> <small>${esc(r.player.slice(0, 8))} · ${r.n} device${r.n === 1 ? '' : 's'} (${esc(r.platforms.join(', '))}${r.app ? ', ' + esc(r.app) : ''}) · ${ago(r.seen)}</small></span>
<form method="post"><input type="hidden" name="player" value="${esc(r.player)}"><select name="link" aria-label="Opens">${links.map(l => `<option>${l}</option>`).join('')}</select><input name="body" placeholder="Message (optional)" aria-label="Message"><button>Send test</button></form></li>`).join('') + '</ul>' : '<p>Nobody yet.</p>'}
</main>`);
}
const crashDir = path.join(DATA_DIR, 'crashes');
function crashReport(store, body) {
  const platform = String(body.platform || '?').replace(/[^\w-]/g, '').slice(0, 16) || 'unknown', kind = String(body.kind || 'crash').replace(/[^\w-]/g, '').slice(0, 32) || 'crash';
  const report = String(body.report || '').slice(0, 400 * 1024);
  const meta = { platform, kind, app: String(body.app || '').slice(0, 40), os: String(body.os || '').slice(0, 40), device: String(body.device || '').slice(0, 40), at: new Date().toISOString() };
  const name = `${meta.at.replace(/[:.]/g, '-')}-${platform}-${kind}.txt`;
  try { fs.mkdirSync(crashDir, { recursive: true }); fs.writeFileSync(path.join(crashDir, name), JSON.stringify(meta) + '\n\n' + report); }
  catch (e) { log('crash report not saved: ' + e.message); }
  log(`!! ${platform} ${kind} — ${meta.app} on ${meta.os} ${meta.device} → crashes/${name} :: ${report.replace(/\s+/g, ' ').slice(0, 240)}`);
  return { ok: true, saved: name };
}
const ipHits = new Map();
function rateLimited(ip) {
  const now = Date.now(); let h = ipHits.get(ip);
  if (!h || now - h.at > 60000) { h = { at: now, n: 0 }; ipHits.set(ip, h); }
  if (ipHits.size > 5000) for (const [k, v] of ipHits) if (now - v.at > 60000) ipHits.delete(k);
  return ++h.n > API_RATE;
}
function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => { size += d.length; if (size > max) { reject(new economy.ApiError(413, 'request too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' ? j : {}); } catch (e) { reject(new economy.ApiError(400, 'invalid JSON')); } });
    req.on('error', reject);
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
  res.end(JSON.stringify(obj));
}
async function api(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'slow down' });
  const route = ROUTES[req.method + ' ' + url];
  if (!route) return sendJson(res, 404, { error: 'no such endpoint' });
  try {
    const body = req.method === 'POST' ? await readJson(req, route.body || MAX_BODY) : {};
    const player = route.auth === 'optional' ? (() => { try { return economy.auth(store, req.headers); } catch (e) { return null; } })() : route.auth ? economy.auth(store, req.headers) : null;
    sendJson(res, 200, await route.fn(store, body, player, { ip }));
  } catch (e) {
    if (e instanceof economy.ApiError || e.status) sendJson(res, e.status || 400, { error: e.message });
    else { console.error('API error on ' + url + ': ' + (e.stack || e)); sendJson(res, 500, { error: 'server error' }); }
  }
}

// The website (site/, built by site-src/build.js) for requests addressed to mitosisgame.com, which reach this server
// through a reverse proxy that handles HTTPS (see README › Website). Its home page is at /, the game at /play, and the
// game's own paths (/ws, /api, /updates, /health, /admin) work as on any address. Requests to the server's IP address
// (the apps, and http://<server>:3000) are unchanged: the game at /.
const SITE_DIR = path.join(__dirname, 'site');
const SITE_HOSTS = new Set((process.env.SITE_HOSTS || 'mitosisgame.com,www.mitosisgame.com').split(',').map(h => h.trim().toLowerCase()).filter(Boolean));
const SITE_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const isGamePath = url => url === '/ws' || url === '/health' || url === '/admin' || /^\/(api|updates|admin)\//.test(url);
/** Answers a request for the website and returns true, or returns false to let the game's routes handle it. */
function sendSite(req, res, url) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!SITE_HOSTS.has(host) || isGamePath(url)) return false;
  if (host.startsWith('www.')) { res.writeHead(301, { Location: 'https://' + host.slice(4) + (req.url || '/') }); res.end(); return true; }
  if (url === '/play' || url === '/play/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(page); return true; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
  let rel; try { rel = decodeURIComponent(url); } catch (e) { rel = '/'; }
  const base = path.normalize(path.join(SITE_DIR, rel));
  const file = base.startsWith(SITE_DIR) && [base, base + '.html', path.join(base, 'index.html')].find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });
  const out = file || path.join(SITE_DIR, '404.html');
  fs.readFile(out, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(file ? 200 : 404, { 'Content-Type': SITE_TYPES[path.extname(out)] || 'application/octet-stream', 'Cache-Control': /[/\\]assets[/\\]/.test(out) ? 'public, max-age=86400' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
  return true;
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/api/')) { api(req, res, url); return; }
  if (sendSite(req, res, url)) return;
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  } else if (url === '/admin/net') {
    netReport(req, res);
  } else if (url === '/admin/live') {
    if (!adminOk(req, res)) return;
    if (new URL(req.url, 'http://x').searchParams.get('format') === 'json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(players.json())); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(players.page());
  } else if (url === '/admin/pass') {
    passPage(req, res).catch(e => { console.error(e); res.end(); });
  } else if (url === '/admin/bugs') {
    bugs.admin(req, res, adminOk).catch(e => { console.error(e); res.end(); });
  } else if (url === '/admin/push') {
    pushPage(req, res).catch(e => { console.error(e); res.end(); });
  } else if (url === '/admin/live/stream') {
    if (adminOk(req, res)) players.stream(req, res);
  } else if (/^\/updates\/(ios|android)\/(manifest\.json|page\.html)$/.test(url)) {
    sendUpdate(res, url);
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ players: clients.size, rooms: rooms.length, accounts: store.playerCount(), store: store.kind, iap: economy.catalog().iap }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// Remote page updates (tools/page-update.js): the apps read a signed manifest and download the page it describes. The files
// are read on every request, so a git pull publishes one without a restart. Plain HTTP is fine: the apps check the signature.
function sendUpdate(res, url) {
  fs.readFile(path.join(UPDATES_DIR, url.slice('/updates/'.length)), (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': url.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

/* ---------- minimal WebSocket (RFC 6455) ---------- */
const clients = new Set(), rooms = []; // every game that said hello; the arena rooms they are in (see the relay below)
// Who a ranked life was against (economy.js runKind): each game gets a secret key in its welcome and sends it with run/start
// and run/end (older apps don't, and are rated as before). A game's metAt is the last time it was alive in the arena
// while another game in its room was too, so a life met another player if metAt is after its start. runConns keeps the game
// a life started in, also after it disconnects, and run/end's key covers a game that reconnected mid-life.
const byKey = new Map(), runConns = new Map(), MEET_EVERY = 500;
function runRelay(runId, key) { const c = byKey.get(String(key || '')); if (c) runConns.set(runId, { c, at: Date.now() }); }
function metSince(runId, key, t) { const a = runConns.get(String(runId || '')), b = byKey.get(String(key || '')); return [a && a.c, b].some(c => c && c.metAt >= t); }
function meet(c, now) { // c just said it is alive in the arena
  if (now - (c.meetAt || 0) < MEET_EVERY) return; c.meetAt = now;
  for (const o of c.room) if (o !== c && live.activityOf(o, now) === 'arena') c.metAt = o.metAt = now;
}
// who is online and what they are doing, for /admin/live
const players = live.create({ file: path.join(DATA_DIR, 'live-history.json'), conns: () => clients, rooms: () => rooms, roomSize: ROOM_SIZE, cap: ROOM_SIZE * MAX_ROOMS });
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!(req.url || '').startsWith('/ws') || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { sock, id: null, p: null, pAt: 0, pingAt: 0, ...live.platformOf(req.headers), buf: Buffer.alloc(0), frag: [], alive: true, count: 0, window: Date.now(), dead: false };
  sock.on('data', d => { try { onData(c, d); } catch (e) { kill(c); } });
  sock.on('close', () => kill(c));
  sock.on('error', () => kill(c));
});

function frame(op, payload) {
  const len = payload.length; let h;
  if (len < 126) h = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
  return Buffer.concat([h, payload]);
}
function sendRaw(c, buf) {
  if (c.dead) return;
  if (c.sock.writableLength > 2 * 1024 * 1024) { kill(c); return; } // too far behind
  try { c.sock.write(buf); } catch (e) { kill(c); }
}
const send = (c, obj) => sendRaw(c, frame(1, Buffer.from(JSON.stringify(obj))));

function onData(c, d) {
  c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
  for (;;) {
    if (c.buf.length < 2) return;
    const b0 = c.buf[0], b1 = c.buf[1], fin = b0 & 0x80, op = b0 & 0x0f;
    if (!(b1 & 0x80)) return kill(c); // client frames must be masked
    let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; if (c.buf.readUInt32BE(2)) return kill(c); len = c.buf.readUInt32BE(6); off = 10; }
    if (len > MAX_MSG) return kill(c);
    if (c.buf.length < off + 4 + len) return;
    const mask = c.buf.subarray(off, off + 4), data = Buffer.from(c.buf.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    c.buf = c.buf.subarray(off + 4 + len);
    if (op === 8) { sendRaw(c, frame(8, Buffer.alloc(0))); return kill(c); }
    if (op === 9) { sendRaw(c, frame(10, data)); continue; }
    if (op === 10) { c.alive = true; continue; }
    if (op === 1 || op === 0) {
      c.frag.push(data);
      if (fin) { const msg = Buffer.concat(c.frag); c.frag = []; if (msg.length <= MAX_MSG) onMessage(c, msg.toString('utf8')); }
    }
  }
}

/* ---------- relay ---------- */
// Games are relayed in arena rooms of up to ROOM_SIZE. A room is a world of its own: its games only hear each other,
// so they pick their host (the lowest id that claims it) and follow that host's round as if they were alone on the
// server. That needs nothing from the game, so app versions already on phones work as they are. A new game joins the
// room with the most players in the arena (or searching for a round), then the fullest, so newcomers find company and
// overflow rooms empty out as their players leave. A room opens when every other is full and closes when it empties.
// A game in a party (hello.party, see social.js) joins the room its party already plays in, while that room has space.
// Rooms are per mode (hello.mode): Classic games only meet Classic games, and every game that names no mode (all apps
// before Classic) plays Battle Royale, so those never land in a Classic room.
function roomFor(now, party, mode = 'br') {
  if (party) for (const r of rooms) if (r.mode === mode && r.size < ROOM_SIZE && [...r].some(o => o.party === party)) return r;
  let best = null, score = -1;
  for (const r of rooms) {
    if (r.mode !== mode || r.size >= ROOM_SIZE) continue;
    let active = 0; for (const o of r) { const a = live.activityOf(o, now); if (a === 'arena' || a === 'searching') active++; }
    const sc = active * (ROOM_SIZE + 1) + r.size; // most in the arena first, then the fullest; ties go to the oldest room
    if (sc > score) { best = r; score = sc; }
  }
  if (!best && rooms.length < MAX_ROOMS) { best = new Set(); best.mode = mode; rooms.push(best); }
  return best;
}
const roomNo = c => rooms.indexOf(c.room) + 1;
function broadcast(from, obj) {
  const buf = frame(1, Buffer.from(JSON.stringify(obj)));
  for (const o of from.room) if (o !== from && o.id) sendRaw(o, buf);
}
function onMessage(c, text) {
  const now = Date.now();
  if (now - c.window > 1000) { c.window = now; c.count = 0; }
  if (++c.count > MAX_RATE) return;
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ping') { c.pingAt = now; send(c, { t: 'pong', c: typeof m.c === 'number' ? m.c : 0 }); return; } // the game measures its round trip with these
  if (m.t === 'hello' && !c.id) {
    c.party = typeof m.party === 'string' && /^[a-z0-9]{6,16}$/.test(m.party) ? m.party : null;
    c.mode = m.mode === 'classic' ? 'classic' : 'br';
    const room = roomFor(now, c.party, c.mode);
    if (!room) { players.turnedAway(); send(c, { t: 'full' }); setTimeout(() => kill(c), 200); return; }
    let id = typeof m.id === 'string' && /^[a-z0-9]{6,20}$/.test(m.id) ? m.id : crypto.randomBytes(6).toString('hex');
    while ([...clients].some(o => o.id === id)) id += Math.floor(Math.random() * 10);
    c.id = id; c.pAt = c.pingAt = now; c.room = room; room.add(c); clients.add(c); players.tick();
    c.key = crypto.randomBytes(12).toString('hex'); byKey.set(c.key, c);
    send(c, { t: 'welcome', id, key: c.key, mode: room.mode, peers: [...room].filter(o => o !== c && o.p).map(o => ({ id: o.id, p: o.p })), lan: lanUrls() });
    log(`+ player joined ${room.mode} room ${roomNo(c)} (${room.size} there, ${clients.size} online in ${rooms.length} room${rooms.length === 1 ? '' : 's'})`);
  } else if (m.t === 'p' && c.id && m.p && typeof m.p === 'object' && !Array.isArray(m.p)) {
    c.p = m.p; c.pAt = now;
    if (m.p.a === 1) meet(c, now);
    broadcast(c, { t: 'p', id: c.id, p: m.p });
  }
}
function kill(c) {
  if (c.dead) return; c.dead = true;
  try { c.sock.destroy(); } catch (e) {}
  if (!clients.delete(c)) return;
  byKey.delete(c.key);
  const n = roomNo(c); c.room.delete(c); if (!c.room.size) rooms.splice(n - 1, 1);
  players.tick(); broadcast(c, { t: 'bye', id: c.id }); log(`- player left room ${n} (${c.room.size} there, ${clients.size} online)`);
}
setInterval(() => {
  const old = Date.now() - 3600e3; for (const [id, r] of runConns) if (r.at < old) runConns.delete(id); // lives never ended
  for (const c of clients) {
    if (!c.alive) { kill(c); continue; }
    c.alive = false; sendRaw(c, frame(9, Buffer.alloc(0)));
  }
}, 7000);

const log = s => console.log(new Date().toLocaleTimeString() + '  ' + s);

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Close the other program, or run with another port, e.g.  set PORT=3001 && node server.js\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  const lan = lanUrls(), iap = economy.catalog().iap;
  console.log('\n  Mitosis server is running.\n');
  console.log(`  Play on this computer:   http://localhost:${PORT}`);
  if (lan.length) console.log(`  Send to friends on your Wi-Fi / network:\n` + lan.map(u => '      ' + u).join('\n'));
  console.log(`\n  Wallets and skins:  ${store.kind} store in ${DATA_DIR}`);
  console.log(`  Connection report:  http://localhost:${PORT}/admin/net?token=${ADMIN_TOKEN}`);
  console.log(`  Live players:       http://localhost:${PORT}/admin/live?token=${ADMIN_TOKEN}`);
  { const ps = push.stats(); console.log(`  Notifications:      http://localhost:${PORT}/admin/push?token=${ADMIN_TOKEN}  (Apple ${ps.ready.ios ? (ps.apns.host ? 'to ' + ps.apns.host : 'ready') : 'not set up'} · Google ${ps.ready.android ? 'ready' : 'not set up'})`); }
  console.log(`  Battle pass switch: http://localhost:${PORT}/admin/pass?token=${ADMIN_TOKEN}  (${economy.passAdmin(store).on ? 'on' : 'off'})`);
  console.log(`  Purchases:          Apple ${iap.apple ? 'verified' : 'not configured'} · Google Play ${iap.google ? 'verified' : 'not configured'}${iap.unverified ? '  (IAP_UNVERIFIED=1: trusting clients — dev only!)' : ''}`);
  const auth = economy.catalog().auth;
  console.log(`  Sign-in:            Apple ready for the app${auth.apple.web ? ' and the website' : ''} · Google ${auth.google.configured ? 'ready' : 'not configured (set GOOGLE_CLIENT_IDS)'}`);
  console.log(`\n  Friends somewhere else? Keep this window open, then run share-online.bat`);
  console.log(`  and send them the https://....trycloudflare.com link it prints.\n`);
  console.log('  If Windows asks about network access, choose Allow (Private networks).');
  console.log('  Close this window to stop the server.\n');
});
