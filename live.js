// Live players: how many people are connected to this server right now, what they are doing, whether they came
// from the website or an app, what they do in the arena (splits, ejects, kills...), and a minute-by-minute history
// of the last 24 hours, kept in a small file so restarts and deploys keep it. It is all read from the relay
// connection every game opens when it starts, so it works with the app versions already on phones. Only counts
// are kept: no player ids, no IP addresses.
'use strict';
const fs = require('fs');

const PRESENCE_FRESH = 3000; // a game whose page is drawing sends its presence about 15 times a second
const PING_FRESH = 9500;     // and, while visible, a ping every 4 s, also during a game on the device (2.3.0 and the website)
const RUN_MAX = 12 * 60e3;   // a life can't outlast a 10-minute round, so runs that never end (app closed) drop out
const MIN = 60e3, DAY_MIN = 24 * 60;
// What players do in the shared arena, counted per minute (see observe()). Practice and Nearby games never reach the server.
const ACTS = ['spawn', 'search', 'split', 'eject', 'dash', 'burst', 'mutate', 'power', 'surge', 'pvp', 'pve', 'bot', 'levi'];
const COLS = ['online', 'playing', 'arena', 'solo', 'web', 'ios', 'android', 'other', 'full', ...ACTS];
const COLS_V1 = COLS.slice(0, 9); // history files written before the arena actions were counted
const SUMS = new Set(['full', ...ACTS]); // counts for the minute; the other columns keep the busiest second of it
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; // the game's number encoding (enc() in index.html)
// From index.html, protocol 6 (PROTO): the offset added to positions (R+2000), the infected bit in a cell's mass,
// the Leviathan's key, and a cell's radius for its mass.
const PROTO = 6, OFF = 8800, INF_FLAG = 8388608, LEVIATHAN = 'b4000';
const radius = m => 4 + Math.sqrt(m) * 6;

/** Website or app, from the relay handshake. The apps load the game from a file inside the app, so their
 *  connections carry no web origin; the user agent then tells the iOS app (WKWebView: no "Safari/") from Android's WebView. */
function platformOf(h) {
  const origin = String(h.origin || '').toLowerCase(), ua = String(h['user-agent'] || '');
  if (/^https?:/.test(origin)) return { plat: 'web', mob: /Mobi|Android|iPhone|iPod/.test(ua) };
  if (/Android/.test(ua) && /; wv\)|Version\/\d/.test(ua)) return { plat: 'android', mob: true };
  if (/\b(iPhone|iPad|iPod|Macintosh)\b/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\/|Chrome|CriOS|FxiOS|Firefox/.test(ua)) return { plat: 'ios', mob: true };
  return { plat: 'other', mob: false }; // a page opened from a file in a browser, a test tool, a script
}

/** What a connection is doing. Presence says whether the player's cell is alive in the shared arena (a) or the
 *  player is searching for a round (q). A game on the device (practice, or bots after a search) stops sending
 *  presence but keeps pinging; a page in the background does neither. */
function activityOf(c, now) {
  if (now - (c.pAt || 0) < PRESENCE_FRESH) return c.p && c.p.a === 1 ? 'arena' : c.p && c.p.q === 1 ? 'searching' : 'menus';
  return now - (c.pingAt || 0) < PING_FRESH ? 'solo' : 'away';
}

function tally(conns, now) {
  const s = { online: 0, playing: 0, arena: 0, searching: 0, solo: 0, menus: 0, away: 0, web: 0, webPhone: 0, ios: 0, android: 0, other: 0 };
  for (const c of conns) { s.online++; s[activityOf(c, now)]++; s[c.plat] = (s[c.plat] || 0) + 1; if (c.plat === 'web' && c.mob) s.webPhone++; }
  s.playing = s.arena + s.solo;
  return s;
}

const DEC = new Int8Array(128).fill(-1); for (let i = 0; i < 64; i++) DEC[B64.charCodeAt(i)] = i;
/** w characters of s from o, as the game encodes numbers (dec() in index.html); NaN if they are not that. */
function num(s, o, w) { let n = 0; for (let i = 0; i < w; i++) { const c = s.charCodeAt(o + i), d = c < 128 ? DEC[c] : -1; if (d < 0) return NaN; n = n * 64 + d; } return n; }
const dec = s => { const n = num(s, 0, s.length); return Number.isNaN(n) ? null : n; };
/** Seconds into the shared arena's round, from the host's presence (rd: round id, then tenths of a second). */
function roundClock(conns, now) {
  for (const c of conns) if (c.p && c.p.h === 1 && typeof c.p.rd === 'string' && c.p.rd.length === 5 && now - c.pAt < PRESENCE_FRESH) {
    const t = dec(c.p.rd.slice(2)); if (t != null) return t / 10;
  }
  return null;
}

/* ---------- what players do: read from the presence each game in the arena sends about 15 times a second ---------- */
/** The player's own cells (cl): cell id -> position, mass and whether it is infected. */
function cellsOf(p) {
  const out = new Map(), s = p.cl; if (typeof s !== 'string') return out;
  for (let o = 0; o + 12 <= s.length && out.size < 16; o += 12) {
    const id = num(s, o, 2), x = num(s, o + 2, 3) - OFF, y = num(s, o + 5, 3) - OFF; let m = num(s, o + 8, 4);
    if (Number.isNaN(id + x + y + m)) break;
    const inf = m >= INF_FLAG; if (inf) m -= INF_FLAG;
    out.set(id, { x, y, m, inf });
  }
  return out;
}
/** The ejected blobs the game is simulating (ej), oldest first. The host's list includes its microbes' blobs. */
function blobsOf(p) {
  const out = [], s = p.ej; if (typeof s !== 'string') return out;
  for (let o = 0; o + 6 <= s.length && out.length < 20; o += 6) { const x = num(s, o, 3) - OFF, y = num(s, o + 3, 3) - OFF; if (Number.isNaN(x + y)) break; out.push({ x, y }); }
  return out;
}
/** The blobs in `cur` that were not in `prev`. The game only adds blobs at the end of its list and drops them anywhere,
 *  and a blob glides at most 172 units in its life (860 a second, slowing 5 times a second), so the old ones are found
 *  in order near where they were; whatever comes after the last old one is new. */
function freshBlobs(prev, cur, dt) {
  const d = 25 + 172 * (1 - Math.exp(-5 * Math.max(dt, 0.1))), d2 = d * d;
  let i = 0, last = -1;
  for (let j = 0; j < cur.length; j++) {
    let k = i; while (k < prev.length && (prev[k].x - cur[j].x) ** 2 + (prev[k].y - cur[j].y) ** 2 > d2) k++;
    if (k < prev.length) { i = k + 1; last = j; }
  }
  return cur.slice(last + 1);
}
/** A blob just ejected starts at the edge of one of the player's cells. */
function besideCells(b, cells) {
  for (const c of cells.values()) { const r = radius(c.m) + 160; if ((b.x - c.x) ** 2 + (b.y - c.y) ** 2 < r * r) return true; }
  return false;
}
/** A phage burst sprays two or more equal pieces out of one cell, which keeps as much as all of them together (pop() in
 *  index.html). A split halves cells instead, so its new cells match old ones, however many splits fell in one moment. */
function burstLike(fresh, kept) {
  if (fresh.length < 2) return false;
  const each = fresh[0].m, sum = fresh.reduce((n, c) => n + c.m, 0), near = (a, b, tol) => Math.abs(a - b) <= Math.max(3, b * .04) * tol;
  return fresh.every(c => near(c.m, each, 1)) && kept.some(c => near(c.m, sum, fresh.length));
}
/** A dash costs every cell 4% of its mass at once (never below 10): 1 for a newborn cell of 25. */
function dashLike(prev, cur) {
  let big = null;
  for (const [id, c] of cur) {
    const o = prev.get(id); if (!o) return false;
    const want = Math.max(10, o.m * .96); if (c.m < want - 1 - o.m * .004 || c.m > want + 3 + o.m * .01) return false; // pellets eaten meanwhile only add
    if (!big || o.m > big.o.m) big = { o, c };
  }
  return !!big && big.o.m >= 20 && big.o.m - big.c.m >= Math.max(1, big.o.m * .025);
}
const popcount = n => { let k = 0; for (; n; n &= n - 1) k++; return k; };
const isBot = k => /^b\d+$/.test(k), isPlayer = k => typeof k === 'string' && k !== '?' && k !== 'me' && !isBot(k);

/** Counts what one game's new presence shows it did since its last one (protocol 6; the game's own state lives in
 *  c.ix). Each kill is recorded once, by the game that owns the cell that died: [seq, 'k', killer, name, victim, name],
 *  repeated in its presence for 3 s, so records are taken once by their sequence number. Splits, phage bursts, ejected
 *  mass and dashes are seen in the player's own cells (cl) and blobs (ej); mutations and power-ups in the effect bits (f). */
function observe(c, p, now, count) {
  if (!p || p.v !== PROTO) return;
  const s = c.ix || (c.ix = { seq: 0, a: false, q: 0, fx: 0, pk: 0, cells: null, ej: [], ejAt: 0, sink: 0, dashAt: -1e9, at: now });
  const dt = (now - s.at) / 1000; s.at = now;
  let pops = 0;
  if (Array.isArray(p.r)) {
    let mx = s.seq;
    for (const r of p.r.slice(-24)) {
      if (!Array.isArray(r) || r.length < 2) continue; const q = r[0] | 0; if (q <= s.seq) continue; if (q > mx) mx = q;
      if (r[1] === 'v' || r[1] === 'w') pops++; // this game's cell burst on a phage (only games that aren't hosting send these)
      else if (r[1] === 'k') {
        const killer = r[2], victim = r[4];
        if (victim === LEVIATHAN) count('levi');
        else if (isPlayer(killer)) count(isPlayer(victim) ? 'pvp' : 'pve');
        else if (isBot(killer) && isPlayer(victim)) count('bot');
      }
    }
    s.seq = mx;
  }
  if (p.q === 1 && s.q !== 1) count('search');
  s.q = p.q;
  const cells = p.a === 1 ? cellsOf(p) : new Map(), alive = cells.size > 0, f = p.f | 0, fx = f & 7, pk = (f >> 3) & 1023;
  // blobs: the list goes on while the player is dead; a presence too big to send drops it for a moment, so keep the last one a while
  const ej = blobsOf(p);
  const fresh = ej.length || now - s.ejAt > 1000 ? freshBlobs(s.ej, ej, dt) : [];
  if (ej.length || now - s.ejAt > 1000) { s.ej = ej; s.ejAt = now; }
  if (alive && !s.a) { count('spawn'); s.sink = 0; if (pk) count('mutate', popcount(pk)); } // a new life: its first cells and spawn shield are not actions
  else if (alive) {
    const prev = s.cells, kept = [], made = [];
    for (const [id, cell] of cells) (prev.has(id) ? kept : made).push(cell);
    const lysis = [...cells].some(([id, cell]) => prev.has(id) && prev.get(id).inf && !cell.inf); // an infection ruptured a cell
    if (made.length && !lysis) count(pops || burstLike(made, kept) ? 'burst' : 'split');
    // each ejecting cell sends one blob and loses 16 mass; the blob list holds only the newest 16, so when blobs were
    // seen leaving, the cells that lost 16 (or 32: two presses in one moment) say how many
    let ejected = fresh.filter(b => besideCells(b, cells)).length;
    if (ejected && !made.length) {
      let byMass = 0;
      for (const [id, cell] of cells) { const o = prev.get(id); if (!o || o.m < 35) continue; const d = o.m - cell.m; byMass += d >= 9 && d <= 17.5 ? 1 : d >= 25 && d <= 33.5 ? 2 : 0; }
      ejected = Math.max(ejected, byMass);
    }
    if (ejected) count('eject', ejected);
    let big = null; for (const [id, cell] of cells) { const o = prev.get(id); if (o && (!big || o.m > big.m)) big = { m: o.m, d: o.m - cell.m }; }
    if (!made.length && !lysis && !ejected && s.sink < .02 && now - s.dashAt > 1800 && dashLike(prev, cells)) { count('dash'); s.dashAt = now; }
    s.sink = big && big.m > 0 ? big.d / big.m : 0; // a cell losing mass every moment (outside the closing arena) is not dashing
    if (pk & ~s.pk) count('mutate', popcount(pk & ~s.pk));
    if (fx & ~s.fx & 3) count('power', popcount(fx & ~s.fx & 3)); // Phase (shield) and Magnet
    if (fx & ~s.fx & 4) count('surge'); // the Surge power-up, or a frenzy of three cells eaten in 3 s
  }
  s.a = alive; s.cells = cells; s.fx = fx; s.pk = pk;
}

/** The tracker for one server. conns() lists the relay connections that have joined. */
function create({ file, conns, cap }) {
  const runs = new Map(), streams = new Set();
  let rows = [], best = null, last = '', wrote = 0;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    // rows are stored with the columns they were written with; columns added since start at 0
    const had = Array.isArray(d.cols) && d.cols.every(k => typeof k === 'string') ? d.cols : COLS_V1, from = COLS.map(k => had.indexOf(k) + 1);
    if (Array.isArray(d.rows)) rows = d.rows.filter(r => Array.isArray(r) && r.length === had.length + 1 && r.every(Number.isFinite)).map(r => [r[0], ...from.map(i => i ? r[i] : 0)]);
    if (d.best && d.best.n > 0) best = { n: +d.best.n, at: +d.best.at };
  } catch (e) {}
  const save = () => { const tmp = file + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify({ cols: COLS, rows, best })); fs.renameSync(tmp, file); } catch (e) {} };

  // one row a minute: [minute since 1970, then the busiest second of that minute for each of COLS ('full' and the actions are counts)]
  function bucket(now) {
    const m = Math.floor(now / MIN); let r = rows[rows.length - 1];
    if (r && r[0] >= m) return r;
    if (r) save(); // the previous minute is complete
    r = [m, ...COLS.map(() => 0)]; rows.push(r);
    while (rows[0][0] <= m - DAY_MIN) rows.shift();
    return r;
  }
  // arena actions in each of the last 60 seconds, for the live "last minute" numbers
  const recent = Array.from({ length: 60 }, () => ({ sec: -1, n: {} })), at = Object.fromEntries(COLS.map((k, i) => [k, i + 1]));
  function count(k, n = 1) {
    const now = Date.now(), sec = Math.floor(now / 1000), slot = recent[sec % 60];
    bucket(now)[at[k]] += n;
    if (slot.sec !== sec) { slot.sec = sec; slot.n = {}; }
    slot.n[k] = (slot.n[k] || 0) + n;
  }
  function lastMinute(now) {
    const sec = Math.floor(now / 1000), out = Object.fromEntries(ACTS.map(k => [k, 0]));
    for (const slot of recent) if (slot.sec > sec - 60) for (const k in slot.n) if (k in out) out[k] += slot.n[k];
    return out;
  }
  function runsOpen(now) { for (const [id, at] of runs) if (now - at > RUN_MAX) runs.delete(id); return runs.size; }
  function snapshot(now = Date.now()) {
    const list = [...conns()], s = tally(list, now);
    // a ranked life needs a game still connected and playing; this drops lives whose app was closed mid-game at once
    return { at: now, ...s, ranked: Math.min(runsOpen(now), s.arena + s.solo + s.away), cap, round: roundClock(list, now), best, acts: lastMinute(now) };
  }
  function send(text) {
    wrote = Date.now();
    for (const res of streams) { if (res.writableLength > 1 << 20) { res.destroy(); streams.delete(res); } else res.write(text); }
  }
  function tick() {
    const now = Date.now(), s = snapshot(now), r = bucket(now);
    COLS.forEach((k, i) => { if (!SUMS.has(k)) r[i + 1] = Math.max(r[i + 1], s[k]); });
    if (s.online > 0 && (!best || s.online > best.n)) s.best = best = { n: s.online, at: now };
    const msg = JSON.stringify({ ...s, cur: r }), key = msg.replace(/^\{"at":\d+/, '');
    if (key !== last) { last = key; if (streams.size) send(`event: now\ndata: ${msg}\n\n`); }
    else if (streams.size && now - wrote > 20000) send(': still here\n\n');
  }
  setInterval(tick, 1000).unref();
  /** Everything the dashboard shows, with the 24-hour history. */
  function json(now = Date.now()) { bucket(now); return { ...snapshot(now), cols: COLS, rows }; }

  return {
    tick, snapshot, json,
    /** Server-sent events: the whole picture once, then each change (joins and leaves at once, the rest within a second). */
    stream(req, res) {
      if (streams.size >= 20) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('Too many dashboards open'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\n\nevent: all\ndata: ${JSON.stringify(json())}\n\n`);
      streams.add(res);
      const drop = () => streams.delete(res); req.on('close', drop); res.on('error', drop);
    },
    turnedAway() { count('full'); },
    /** A game's presence, before the relay passes it on: counts the arena actions it shows (see observe()). */
    presence(c, p) { try { observe(c, p, Date.now(), count); } catch (e) {} },
    runStarted(id) { if (typeof id === 'string') { runs.set(id, Date.now()); if (runs.size > 5000) runsOpen(Date.now()); } },
    runEnded(id) { runs.delete(String(id)); },
    page,
  };
}

/** The dashboard: a self-contained page that listens to /admin/live/stream with the same token. */
function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mitosis live players</title><style>
:root{--bg:#06100f;--card:#0b1a18;--ink:#dcefe9;--mut:#8fb3aa;--line:#1d3330;--ok:#5fe0a8;--warn:#f2b134;--bad:#ff6b6b;--s1:#3987e5;--s2:#d95926}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif;padding:24px max(16px,calc(50% - 560px))}
h1{font-size:26px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em}
p{color:var(--mut);margin:0 0 6px}a{color:var(--ink)}.n{font-variant-numeric:tabular-nums}
.st{display:inline-flex;align-items:center;gap:6px}.dot{width:8px;height:8px;border-radius:50%;background:var(--mut)}.live .dot{background:var(--ok)}.down .dot{background:var(--warn)}
.hero{display:flex;gap:36px;flex-wrap:wrap;align-items:flex-end;margin:18px 0 4px}.hero .big b{display:block;font-size:64px;line-height:1;font-weight:650}
.hero .big span,.hs span{color:var(--mut)}.hs{display:flex;gap:28px;flex-wrap:wrap}.hs b{display:block;font-size:28px;font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:26px;font-weight:600}
.tile .l{color:var(--ink);font-weight:600}.tile .d{color:var(--mut);font-size:12px;margin-top:2px}
.meter{height:6px;border-radius:3px;background:var(--line);margin-top:8px;overflow:hidden}.meter i{display:block;height:100%;background:var(--ok);border-radius:3px}.meter.warn i{background:var(--warn)}.meter.bad i{background:var(--bad)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;position:relative}
.legend{display:flex;gap:18px;color:var(--mut);font-size:12px;margin-bottom:6px}.legend i{display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:6px;border-radius:1px}
#chart svg{display:block;width:100%;outline:none}#chart text{fill:var(--mut);font-size:11px}#chart .ax{stroke:var(--line);stroke-width:1}#chart .mid{stroke:#2f514c}
.tip{position:absolute;pointer-events:none;background:#020807;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;min-width:150px;box-shadow:0 6px 20px #0008}
.tip .h{color:var(--mut);margin-bottom:4px}.tip div{display:flex;align-items:center;gap:8px;white-space:nowrap}.tip b{min-width:22px;text-align:right}.tip i{width:12px;height:2px;display:inline-block}.tip .sub{color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right}td:first-child,th:first-child{text-align:left}
th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em}summary{cursor:pointer;color:var(--mut);margin-top:14px}
.foot{margin-top:22px;font-size:12px}.foot b{color:var(--ink);font-weight:600}
.scroll{overflow-x:auto}#acts{min-width:760px}
</style></head><body>
<h1>Live players</h1><p><span id="st" class="st"><span class="dot"></span><span id="stt">Connecting…</span></span> · <a id="netLink" href="#">Connection report</a> · <a id="jsonLink" href="#">JSON</a></p>
<div class="hero"><div class="big"><b id="online">–</b><span>online now</span></div>
<div class="hs"><div><b id="playing">–</b><span>playing now</span></div><div><b id="peak">–</b><span id="peakAt">peak today</span></div><div><b id="best">–</b><span id="bestAt">most at once</span></div></div></div>
<h2>What they are doing</h2><div class="tiles" id="doing"></div>
<h2>Moves in the arena · last 60 s</h2><div class="tiles" id="moves"></div>
<h2>Absorptions · last 60 s</h2><div class="tiles" id="kills"></div>
<h2>Where from</h2><div class="tiles" id="from"></div>
<h2>Rooms</h2><div class="tiles" id="rooms"></div>
<h2>Last 24 hours</h2>
<div class="card"><div class="legend"><span><i style="background:var(--s1)"></i>Online</span><span><i style="background:var(--s2)"></i>Playing</span></div><div id="chart"></div><div id="tip" class="tip" hidden></div></div>
<details><summary>Table: the busiest minute of each hour</summary><div class="scroll"><table id="tbl"></table></div></details>
<details><summary>Table: arena moves and absorptions per hour</summary><div class="scroll"><table id="acts"></table></div></details>
<p class="foot"><b>Online</b> is every game connected to this server: the website and the iPhone and Android apps open the connection when they start, menus included. <b>Playing</b> is players in the live arena plus solo games. <b>Solo games</b> (practice, or bots after a search) are seen from games that keep pinging the server without sending arena moves: the website and app 2.3.0 or later; older apps in a solo game count as <b>Away</b>, like a page left in the background. Nearby (Bluetooth) games and offline play never reach the server. Each point on the chart is the busiest second of that minute; gaps are times the server was off. <b>Moves and absorptions</b> are what players do in the live arena, read from the moves their games already send to each other, so every app version counts; practice, bot games after a search and Nearby games stay on the device and are not counted. Splits, ejected mass and dashes are worked out from each player's own cells: checked against real games they caught nearly every split, about 9 in 10 ejects and 5 in 6 dashes, and two within the same fifteenth of a second count once. Times are in this device's time zone. Nothing that identifies a player is kept.</p>
<script>
(()=>{
const $=id=>document.getElementById(id),tok=new URLSearchParams(location.search).get('token')||'',T='?token='+encodeURIComponent(tok);
$('netLink').href='/admin/net'+T;$('jsonLink').href='/admin/live'+T+'&format=json';
let cols=[],rows=[],cur=null,hover=null;
const ACT=[['spawn','Lives started','joined the live arena','Lives'],['search','Searches','tapped Play while the arena was closed','Searches'],['split','Splits','a cell split in two','Splits'],
  ['eject','Mass ejected','blobs shot out','Ejected'],['dash','Dashes','a burst of speed for 4% of mass','Dashes'],['burst','Phage bursts','a cell burst on a phage','Bursts'],
  ['mutate','Mutations','gained at each mass milestone','Mutations'],['power','Power-ups','Phase or Magnet picked up','Power-ups'],['surge','Surges','the Surge power-up, or 3 cells eaten in 3 s','Surges']];
const KILL=[['pvp','Players absorbed','by another player','By players'],['pve','Microbes absorbed','AI cells absorbed by players','Microbes'],
  ['bot','Absorbed by microbes','players absorbed by an AI cell','By microbes'],['levi','Leviathan slain','the boss microbe','Leviathan']];
const col=k=>cols.indexOf(k)+1,MIN=60000;
const fmtT=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const fmtD=t=>new Date(t).toLocaleDateString([],{month:'short',day:'numeric'})+', '+fmtT(t);
const pct=(a,b)=>b?Math.round(a/b*100)+'%':'–';
function tiles(id,list){const el=$(id);el.textContent='';for(const t of list){const d=document.createElement('div');d.className='tile';
  const b=document.createElement('b');b.textContent=t.v;const l=document.createElement('div');l.className='l';l.textContent=t.l;const s=document.createElement('div');s.className='d';s.textContent=t.d;
  d.append(b,l,s);if(t.m!=null){const m=document.createElement('div');m.className='meter'+(t.m>=1?' bad':t.m>=.75?' warn':'');const i=document.createElement('i');i.style.width=Math.min(100,t.m*100)+'%';m.append(i);d.append(m);}el.append(d);}}
function upsert(r){const l=rows[rows.length-1];if(l&&l[0]===r[0])rows[rows.length-1]=r;else if(!l||r[0]>l[0])rows.push(r);while(rows.length&&rows[0][0]<=r[0]-1440)rows.shift();}
function midnight(){const d=new Date();d.setHours(0,0,0,0);return d.getTime();}
function render(){
  if(!cur)return;const s=cur,on=s.online;
  $('online').textContent=on;$('playing').textContent=s.playing;
  const m0=midnight()/MIN,today=rows.filter(r=>r[0]>=m0);let pk=null;for(const r of today)if(!pk||r[col('online')]>pk[col('online')])pk=r;
  $('peak').textContent=pk?pk[col('online')]:'–';$('peakAt').textContent=pk&&pk[col('online')]?'peak today, '+fmtT(pk[0]*MIN):'peak today';
  $('best').textContent=s.best?s.best.n:'–';$('bestAt').textContent=s.best?'most at once, '+fmtD(s.best.at):'most at once';
  tiles('doing',[
    {v:s.arena,l:'In the live arena',d:'cell alive in the shared multiplayer round'},
    {v:s.searching,l:'Searching',d:'waiting for the next round to open'},
    {v:s.solo,l:'Solo game',d:'practice, or bots after a search'},
    {v:s.menus,l:'In the menus',d:'start page, shop, between lives'},
    {v:s.away,l:'Away',d:'in the background (or a solo game on an older app)'}]);
  const tot=k=>today.reduce((n,r)=>n+(r[col(k)]||0),0),a=s.acts||{},actTiles=list=>list.map(([k,l,d])=>({v:a[k]||0,l,d:tot(k)+' today · '+d}));
  tiles('moves',actTiles(ACT));tiles('kills',actTiles(KILL));
  tiles('from',[
    {v:s.web,l:'Website',d:s.web?s.webPhone+' on phones or tablets, '+(s.web-s.webPhone)+' on computers':'in a browser'},
    {v:s.ios,l:'iPhone & iPad app',d:pct(s.ios,on)+' of online'},
    {v:s.android,l:'Android app',d:pct(s.android,on)+' of online'},
    {v:s.other,l:'Other',d:'a copy of the game opened from a file, test tools'}]);
  const fullToday=today.reduce((n,r)=>n+r[col('full')],0),rc=s.round==null?null:Math.floor(s.round/60)+':'+String(Math.floor(s.round%60)).padStart(2,'0');
  const arenaUsed=s.arena+s.searching>0?1:0;
  tiles('rooms',[
    {v:arenaUsed+s.solo,l:'Rooms in use',d:(arenaUsed?'the shared arena':'arena empty')+' + '+s.solo+' solo game'+(s.solo===1?'':'s')+' (each runs on its own device)'},
    {v:on+' / '+s.cap,l:'Shared arena slots',d:'one arena for the whole server; every connected game holds a slot, menus included',m:on/s.cap},
    {v:rc||'–',l:'Round clock',d:rc?'into the 10-minute round (from the host game)':'no game is hosting a round'},
    {v:s.ranked,l:'Ranked lives in progress',d:'arena and bot games that pay ATP; practice is not ranked'},
    {v:fullToday,l:'Turned away today',d:'arena full: those players can only practise offline'}]);
  chart();table();actsTable();
}
const svgNS='http://www.w3.org/2000/svg',el=(n,a,p)=>{const e=document.createElementNS(svgNS,n);for(const k in a)e.setAttribute(k,a[k]);if(p)p.append(e);return e;};
function nice(v){for(const s of [1,2,5,10,20,50,100,200,500,1000])if(v/s<=4)return s;return 2000;}
function chart(){
  const box=$('chart'),W=Math.max(280,box.clientWidth),H=W<500?180:220,L=30,R=12,Tp=10,B=22,pw=W-L-R,ph=H-Tp-B;
  const end=cur.cur[0],start=end-1439,io=col('online'),ip=col('playing');
  const mx=Math.max(4,...rows.map(r=>r[io])),step=nice(mx),top=Math.ceil(mx/step)*step;
  const X=m=>L+(m-start)/1439*pw,Y=v=>Tp+ph-v/top*ph;
  box.textContent='';const svg=el('svg',{viewBox:'0 0 '+W+' '+H,height:H,tabindex:0,role:'img','aria-label':'Players online and playing over the last 24 hours'},box);
  for(let v=0;v<=top;v+=step){el('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),class:'ax'},svg);const t=el('text',{x:L-6,y:Y(v)+4,'text-anchor':'end'},svg);t.textContent=v;}
  const d0=new Date(start*MIN);d0.setMinutes(0,0,0);
  const every=pw<480?6:3; // hours between time labels: fewer on phones so they don't collide
  for(let t=d0.getTime()+3600e3;t<=end*MIN;t+=3600e3){const h=new Date(t).getHours();if(h%every)continue;const x=X(t/MIN);
    if(h===0)el('line',{x1:x,x2:x,y1:Tp,y2:Tp+ph,class:'ax mid'},svg);
    if(x>L+14&&x<W-R-14){const tx=el('text',{x,y:H-6,'text-anchor':'middle'},svg);tx.textContent=h===0?'midnight':new Date(t).toLocaleTimeString([],{hour:'numeric'});}}
  // runs of consecutive minutes; a gap means the server was off
  const segs=[];let sg=null;for(const r of rows){if(r[0]<start)continue;if(!sg||r[0]-sg[sg.length-1][0]>1){sg=[];segs.push(sg);}sg.push(r);}
  const line=(s,i)=>s.map((r,k)=>(k?'L':'M')+X(r[0]).toFixed(1)+' '+Y(r[i]).toFixed(1)).join('');
  for(const s of segs){const a=line(s,io)+'L'+X(s[s.length-1][0]).toFixed(1)+' '+Y(0)+'L'+X(s[0][0]).toFixed(1)+' '+Y(0)+'Z';
    el('path',{d:a,fill:'var(--s1)','fill-opacity':.1},svg);}
  for(const [i,c] of [[io,'var(--s1)'],[ip,'var(--s2)']])for(const s of segs)el('path',{d:line(s,i),fill:'none',stroke:c,'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
  const lr=rows[rows.length-1];if(lr)for(const [i,c] of [[io,'var(--s1)'],[ip,'var(--s2)']])el('circle',{cx:X(lr[0]),cy:Y(lr[i]),r:4,fill:c,stroke:'var(--card)','stroke-width':2},svg);
  const cross=el('line',{y1:Tp,y2:Tp+ph,stroke:'var(--mut)','stroke-width':1,visibility:'hidden'},svg);
  const hit=el('rect',{x:L,y:Tp,width:pw,height:ph,fill:'transparent'},svg);
  const show=m=>{hover=m;const r=rows.find(q=>q[0]===m);const tip=$('tip');if(m==null){cross.setAttribute('visibility','hidden');tip.hidden=true;return;}
    const x=X(m);cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.setAttribute('visibility','visible');
    tip.textContent='';const h=document.createElement('div');h.className='h';h.textContent=fmtT(m*MIN)+(r?'':' · server off');tip.append(h);
    if(r){const add=(v,l,c,sub)=>{const d=document.createElement('div');if(sub)d.className='sub';const k=document.createElement('i');k.style.background=c||'transparent';const b=document.createElement('b');b.textContent=v;const s=document.createElement('span');s.textContent=l;d.append(k,b,s);tip.append(d);};
      add(r[io],'online','var(--s1)');add(r[ip],'playing','var(--s2)');add(r[col('arena')],'in the arena',0,1);add(r[col('solo')],'solo',0,1);
      add(r[col('web')],'website',0,1);add(r[col('ios')],'iOS app',0,1);add(r[col('android')],'Android app',0,1);if(r[col('full')])add(r[col('full')],'turned away',0,1);
      for(const [k,,,h] of ACT.concat(KILL))if(r[col(k)])add(r[col(k)],h.toLowerCase(),0,1);}
    tip.hidden=false;const bw=box.getBoundingClientRect(),tw=tip.offsetWidth;let left=x+14;if(left+tw>bw.width)left=x-tw-14;tip.style.left=(left+14)+'px';tip.style.top='40px';};
  const at=e=>{const b=svg.getBoundingClientRect(),x=(e.clientX-b.left)*W/b.width;return Math.max(start,Math.min(end,Math.round(start+(x-L)/pw*1439)));};
  hit.addEventListener('pointermove',e=>show(at(e)));hit.addEventListener('pointerleave',()=>show(null));hit.addEventListener('pointerdown',e=>show(at(e)));
  svg.addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();show(Math.max(start,Math.min(end,(hover??end)+(e.key==='ArrowLeft'?-10:10))));});
  svg.addEventListener('blur',()=>show(null));
  if(hover!=null)show(Math.max(start,Math.min(end,hover)));
}
function table(){
  const t=$('tbl'),by=new Map();for(const r of rows){const h=Math.floor(r[0]/60);const o=by.get(h);if(!o||r[col('online')]>o[col('online')])by.set(h,r);}
  t.textContent='';const head=t.insertRow();for(const h of ['Hour','Online','Playing','Arena','Solo','Website','iOS','Android'])head.append(Object.assign(document.createElement('th'),{textContent:h}));
  for(const [h,r] of [...by].sort((a,b)=>b[0]-a[0])){const tr=t.insertRow();const d=new Date(h*3600e3);
    tr.insertCell().textContent=d.toLocaleDateString([],{weekday:'short'})+' '+d.toLocaleTimeString([],{hour:'numeric'});
    for(const k of ['online','playing','arena','solo','web','ios','android']){const c=tr.insertCell();c.className='n';c.textContent=r[col(k)];}}
}
function actsTable(){
  const t=$('acts'),by=new Map(),all=ACT.concat(KILL);for(const r of rows){const h=Math.floor(r[0]/60);const o=by.get(h)||all.map(()=>0);all.forEach(([k],i)=>o[i]+=r[col(k)]||0);by.set(h,o);}
  t.textContent='';const head=t.insertRow();for(const h of ['Hour'].concat(all.map(x=>x[3])))head.append(Object.assign(document.createElement('th'),{textContent:h}));
  for(const [h,o] of [...by].sort((a,b)=>b[0]-a[0])){const tr=t.insertRow();const d=new Date(h*3600e3);
    tr.insertCell().textContent=d.toLocaleDateString([],{weekday:'short'})+' '+d.toLocaleTimeString([],{hour:'numeric'});
    for(const v of o){const c=tr.insertCell();c.className='n';c.textContent=v;}}
}
function status(ok,text){$('st').className='st '+(ok?'live':'down');$('stt').textContent=text;}
const es=new EventSource('/admin/live/stream'+T);
es.addEventListener('all',e=>{const d=JSON.parse(e.data);cols=d.cols;rows=d.rows;cur={...d,cur:rows[rows.length-1]};status(true,'Live');render();});
es.addEventListener('now',e=>{if(!cols.length)return;cur=JSON.parse(e.data);upsert(cur.cur);status(true,'Live · '+fmtT(cur.at));render();});
es.onerror=()=>status(false,'Reconnecting…');
let rz=0;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>cur&&chart(),120);});
})();
</script></body></html>`;
}

module.exports = { create, platformOf, activityOf, tally, roundClock, observe, COLS, ACTS };
