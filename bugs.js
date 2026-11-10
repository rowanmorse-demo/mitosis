// Bug reports from the game (Settings › Game › Report a bug, and the pause menu). POST /api/bug keeps a report; the operator
// reads them at /admin/bugs?token=… (or with tools/bugs.js) and marks each seen, fixed (with the commit) or won't fix.
// See docs/BUGS.md. A report is plain text from a player: it is stored as text and shown escaped, never as HTML.
// Reports are kept KEEP_DAYS (PRIVACY.md says so), at most MAX_KEPT, and go when the player deletes their account.
'use strict';
const crypto = require('crypto');

const TEXT_MAX = 1000, EMAIL_MAX = 120, LOG_MAX = 4000, NOTES_MAX = 2000, FIXED_MAX = 80;
const KEEP_DAYS = 180, MAX_KEPT = 5000, HOUR = 3600e3, DAY = 24 * HOUR;
// reports allowed per player, per address and in all: [window, count]. The address comes from X-Forwarded-For when there
// is one, which a client talking to the server directly can make up, so the total is the backstop against a flood.
const LIMITS = { player: [[HOUR, 5], [DAY, 20]], ip: [[HOUR, 10], [DAY, 40]], all: [[HOUR, 300]] };
const STATUSES = ['new', 'seen', 'fixed', 'wontfix'], STATUS_NAME = { new: 'New', seen: 'Seen', fixed: 'Fixed', wontfix: 'Won\'t fix' };

const fail = (status, message) => Object.assign(new Error(message), { status });
/** Plain text: no control characters (new lines kept when lines is set) and no bidi overrides, which could disguise text. */
const plain = (v, max, lines = false) => String(v == null ? '' : v).replace(/\r\n?/g, '\n')
  .replace(lines ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[‎‏‪-‮⁦-⁩]/g, '').slice(0, max).trim();
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const EMAIL = /^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,100}\.[^\s@<>"'`.]{2,24}$/;
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

/** What the game sent, cut down to the fields and sizes kept. Throws a 400 when there is no description or the email is off. */
function clean(body) {
  const text = plain(body.text, TEXT_MAX, true).replace(/\n{3,}/g, '\n\n');
  if (text.replace(/\s/g, '').length < 3) throw fail(400, 'Say what happened');
  const email = plain(body.email, EMAIL_MAX);
  if (email && !EMAIL.test(email)) throw fail(400, 'That email doesn\'t look right');
  const lines = Array.isArray(body.log) ? body.log.slice(-40).map(l => plain(l, 300)).filter(Boolean).join('\n') : plain(body.log, LOG_MAX, true);
  const screen = String(body.screen || '');
  return {
    text, email,
    platform: ['ios', 'android', 'web'].includes(body.platform) ? body.platform : 'web',
    app: plain(body.app, 40).replace(/[^\w.\-]/g, '') || 'unknown',
    os: plain(body.os, 60), device: plain(body.device, 60),
    screen: /^\d{2,5}x\d{2,5}(@\d(\.\d{1,2})?)?$/.test(screen) ? screen : '',
    mode: plain(body.mode, 24), ping: int(body.ping, 0, 60000), fps: int(body.fps, 0, 500),
    log: lines.slice(-LOG_MAX),
  };
}

function create({ store, now = Date.now, log = () => {} }) {
  const hits = { player: new Map(), ip: new Map(), all: new Map() };
  /** True (and nothing counted) when key has used up a limit; else counts this report. */
  function limited(kind, key, t) {
    if (!key) return false;
    const m = hits[kind], longest = Math.max(...LIMITS[kind].map(l => l[0]));
    const a = (m.get(key) || []).filter(x => t - x < longest);
    if (LIMITS[kind].some(([win, n]) => a.filter(x => t - x < win).length >= n)) { m.set(key, a); return true; }
    a.push(t); m.set(key, a);
    if (m.size > 5000) for (const [k, v] of m) if (!v.some(x => t - x < longest)) m.delete(k);
    return false;
  }
  const prune = () => store.pruneBugs(now() - KEEP_DAYS * DAY, MAX_KEPT);
  prune();

  /** POST /api/bug. The player is whoever signed the request (optional); their secret never goes into a report. */
  function report(store, body, player, ctx = {}) {
    const t = now(), data = clean(body || {});
    const cid = /^[\w-]{8,40}$/.test(String(body.cid || '')) ? String(body.cid) : null;
    if (limited('ip', ctx.ip, t) || (player && limited('player', player.id, t)) || limited('all', '*', t)) throw fail(429, 'Too many reports for now. Try again later');
    const id = crypto.randomBytes(5).toString('hex');
    const saved = store.addBug({ id, cid, at: t, player: player ? player.id : null, status: 'new', data }); // false: a queued report sent again (same cid)
    if (Math.random() < .05) prune();
    if (saved) log(`bug ${id} (${data.platform} ${data.app}): ${data.text.replace(/\s+/g, ' ').slice(0, 120)}`);
    return { ok: true, saved, id };
  }

  /** Reports for the admin page and tools/bugs.js: status is one of STATUSES, 'open' (new and seen) or all; app a version. */
  function list({ status = '', app = '' } = {}) {
    const all = store.bugs(MAX_KEPT), counts = Object.fromEntries(STATUSES.map(s => [s, 0])), apps = new Map();
    for (const b of all) { counts[b.status] = (counts[b.status] || 0) + 1; apps.set(b.data.app, (apps.get(b.data.app) || 0) + 1); }
    const bugs = all.filter(b => (!status || status === 'all' || (status === 'open' ? b.status === 'new' || b.status === 'seen' : b.status === status)) && (!app || b.data.app === app));
    return { counts, total: all.length, apps: [...apps].sort((a, b) => b[0].localeCompare(a[0], 'en', { numeric: true })).map(([v, n]) => ({ app: v, n })), bugs };
  }
  /** Sets a report's status, notes and fixing commit; anything left out stays as it was. */
  function update(id, f) {
    const b = store.bug(id); if (!b) throw fail(404, 'No such report');
    const status = f.status == null ? b.status : String(f.status);
    if (!STATUSES.includes(status)) throw fail(400, 'Status is one of ' + STATUSES.join(', '));
    const next = { status, notes: f.notes == null ? b.notes : plain(f.notes, NOTES_MAX, true), fixed: f.fixed == null ? b.fixed : plain(f.fixed, FIXED_MAX) };
    store.setBug(id, next, now());
    return store.bug(id);
  }

  /** /admin/bugs: GET lists (&status=, &app=, &format=json); POST id + status / notes / fixed updates one (form or JSON). */
  async function admin(req, res, adminOk) {
    if (!adminOk(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams, json = q.get('format') === 'json';
    const sendJ = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o) + '\n'); };
    if (req.method === 'POST') {
      let body = ''; for await (const d of req) { body += d; if (body.length > 16 * 1024) return sendJ(413, { error: 'too large' }); }
      let f; try { f = /json/.test(req.headers['content-type'] || '') ? JSON.parse(body || '{}') : Object.fromEntries(new URLSearchParams(body)); } catch (e) { return sendJ(400, { error: 'invalid JSON' }); }
      try {
        const b = update(String(f.id || ''), f);
        log(`bug ${b.id} marked ${b.status}${b.fixed ? ' (' + b.fixed + ')' : ''}`);
        if (json) return sendJ(200, { ok: true, bug: b });
        const back = new URLSearchParams({ token: q.get('token') }); for (const k of ['status', 'app']) if (q.get(k)) back.set(k, q.get(k));
        res.writeHead(303, { Location: '/admin/bugs?' + back + '#b' + b.id }); return res.end();
      } catch (e) { return json ? sendJ(e.status || 400, { error: e.message }) : (res.writeHead(e.status || 400, { 'Content-Type': 'text/plain' }), res.end(e.message)); }
    }
    const status = q.get('status') || '', app = q.get('app') || '', l = list({ status, app });
    if (json) return sendJ(200, { status: status || 'all', app: app || null, counts: l.counts, total: l.total, apps: l.apps, bugs: l.bugs.slice(0, 500) });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      // every piece of a report is escaped; this is a second guard should one ever slip through
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(page(l, { token: q.get('token'), status, app }));
  }

  return { handlers: { report }, list, update, admin, forget: id => store.forgetBugs(id), prune };
}

const ago = (t, n = Date.now()) => { const m = Math.round((n - t) / 60000); return m < 1 ? 'just now' : m < 120 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
function page(l, { token, status, app }) {
  const url = o => '/admin/bugs?' + new URLSearchParams(Object.entries({ token, status, app, ...o }).filter(([, v]) => v));
  const chip = (s, label, n) => `<a class="chip${(status || '') === s ? ' on' : ''}" href="${esc(url({ status: s }))}">${esc(label)}${n == null ? '' : ' <b>' + n + '</b>'}</a>`;
  const open = l.counts.new + l.counts.seen, shown = l.bugs.slice(0, 300);
  const row = b => { const d = b.data;
    const facts = [['App', d.app], ['Platform', d.platform], ['System', d.os], ['Device', d.device], ['Screen', d.screen], ['Mode', d.mode],
      ['Ping', d.ping == null ? '' : d.ping + ' ms'], ['Frame rate', d.fps == null ? '' : d.fps + ' fps'], ['Player', b.player ? b.player.slice(0, 8) : 'not signed'], ['Contact', d.email]].filter(f => f[1]);
    return `<li class="bug" id="b${esc(b.id)}"><header><span class="st s-${esc(b.status)}">${esc(STATUS_NAME[b.status] || b.status)}</span><b>${esc(d.app)}</b><small>${esc(b.id)} · ${new Date(b.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${ago(b.at)}</small></header>
<p class="tx">${esc(d.text)}</p><dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${d.log ? `<details><summary>Recent errors and hitches (${d.log.split('\n').length})</summary><pre>${esc(d.log)}</pre></details>` : ''}
<form method="post" action="${esc(url({}))}"><input type="hidden" name="id" value="${esc(b.id)}"><select name="status" aria-label="Status">${STATUSES.map(s => `<option value="${s}"${s === b.status ? ' selected' : ''}>${STATUS_NAME[s]}</option>`).join('')}</select>
<input name="fixed" value="${esc(b.fixed)}" placeholder="Fixed in (commit)" aria-label="Fixed in commit" maxlength="${FIXED_MAX}"><textarea name="notes" rows="2" placeholder="Notes" aria-label="Notes" maxlength="${NOTES_MAX}">${esc(b.notes)}</textarea><button>Save</button></form></li>`; };
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mitosis bug reports</title>
<style>body{margin:0;padding:24px 16px;background:#020809;color:#dcefe9;font:16px/1.5 system-ui,sans-serif}main{max-width:820px;margin:auto}h1{font-size:24px;margin:0 0 6px}p{color:#8aaea9;margin:0 0 14px}
nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 18px}.chip{color:#dcefe9;text-decoration:none;padding:6px 12px;border-radius:99px;background:#0b1a1c;font-size:14px}.chip.on{background:#1f6f4f}.chip b{color:#8aaea9;font-weight:600;margin-left:2px}.chip.on b{color:#dcefe9}
nav form{margin:0 0 0 auto;display:flex;gap:6px}.go{font:700 13px system-ui;padding:7px 14px;border-radius:99px;border:0;cursor:pointer;background:#2a3a3c;color:#dcefe9}select,input,textarea{font:14px system-ui;padding:7px 10px;border-radius:10px;border:1px solid #2a3a3c;background:#020809;color:#dcefe9;min-width:0;box-sizing:border-box}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}.bug{padding:14px 16px;border-radius:16px;background:#0b1a1c;display:grid;gap:10px;min-width:0}.bug header{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}.bug header small{color:#8aaea9;font-size:13px}
.st{font-size:12px;font-weight:700;padding:2px 10px;border-radius:99px;background:#2a3a3c}.s-new{background:#ff5c8a;color:#fff}.s-seen{background:#3c5a8a}.s-fixed{background:#1f6f4f}
.tx{margin:0;color:#eef8f5;white-space:pre-wrap;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px 16px;margin:0;font-size:13px}dt{color:#8aaea9}dd{margin:0 0 4px;overflow-wrap:anywhere}
details summary{cursor:pointer;color:#8aaea9;font-size:13px}pre{margin:8px 0 0;padding:10px;border-radius:10px;background:#020809;font-size:12px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}
.bug form{display:grid;grid-template-columns:auto 1fr auto;gap:8px;margin:0}.bug textarea{grid-column:1/-1;resize:vertical}.bug button{grid-row:1;grid-column:3;font:700 14px system-ui;padding:8px 18px;border-radius:99px;border:0;cursor:pointer;background:#ff5c8a;color:#fff}</style>
<main><h1>Bug reports</h1><p>${open} open · ${l.total} kept (${KEEP_DAYS} days) · newest first${shown.length < l.bugs.length ? ` · showing ${shown.length} of ${l.bugs.length}` : ''}</p>
<nav>${chip('', 'All', l.total)}${chip('open', 'Open', open)}${STATUSES.map(s => chip(s, STATUS_NAME[s], l.counts[s])).join('')}
<form method="get"><input type="hidden" name="token" value="${esc(token)}">${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ''}<select name="app" aria-label="Version"><option value="">Every version</option>${l.apps.map(a => `<option value="${esc(a.app)}"${a.app === app ? ' selected' : ''}>${esc(a.app)} (${a.n})</option>`).join('')}</select><button class="go">Show</button></form></nav>
${shown.length ? `<ul>${shown.map(row).join('')}</ul>` : '<p>No reports here.</p>'}</main>`;
}

module.exports = { create, clean, page, esc, LIMITS, KEEP_DAYS, MAX_KEPT, TEXT_MAX, STATUSES };
