// Connection quality reports: each game sends, every few minutes, how long its pings to the server took, how many
// never came back and how smoothly it drew frames, with a coarse region from the device's time zone. Nothing that
// identifies a player is kept (no player id, no IP). The summary groups the reports by region and platform and
// says what is most likely wrong: the server is far away, the player's own connection, or the phone.
'use strict';

const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const word = (v, max) => String(v || '').replace(/[^\w/+.\-]/g, '').slice(0, max);

/** A report from the game, checked and trimmed; null when it is not usable. */
function clean(b, now) {
  if (!b || typeof b !== 'object') return null;
  const n = num(b.n, 0, 10000), med = num(b.med, 0, 60000);
  if (!n || n < 3 || med == null) return null;
  return {
    at: now, platform: word(b.platform, 12) || 'web', app: word(b.app, 16), tz: word(b.tz, 40) || 'unknown', conn: word(b.conn, 12),
    n, lost: num(b.lost, 0, 10000) || 0, min: num(b.min, 0, 60000) ?? med, med, p90: num(b.p90, 0, 60000) ?? med, jit: num(b.jit, 0, 60000) || 0,
    fps: num(b.fps, 0, 240), slow: num(b.slow, 0, 100),
  };
}

// Time zones to the area a server would serve; anything else falls back to its continent.
const AREAS = {
  'US & Canada East': ['America/New_York', 'America/Detroit', 'America/Toronto', 'America/Montreal', 'America/Indiana', 'America/Kentucky', 'America/Halifax', 'America/Nassau'],
  'US & Canada Central': ['America/Chicago', 'America/Winnipeg', 'America/Mexico_City', 'America/Monterrey', 'America/Regina', 'America/Matamoros'],
  'US & Canada Mountain': ['America/Denver', 'America/Phoenix', 'America/Edmonton', 'America/Boise', 'America/Chihuahua'],
  'US & Canada West': ['America/Los_Angeles', 'America/Vancouver', 'America/Tijuana', 'America/Anchorage', 'Pacific/Honolulu'],
};
function areaOf(tz) {
  for (const [area, list] of Object.entries(AREAS)) if (list.some(p => tz === p || tz.startsWith(p + '/'))) return area;
  const c = tz.split('/')[0];
  if (c === 'America') return 'Latin America & other Americas';
  return { Europe: 'Europe', Asia: 'Asia', Australia: 'Oceania', Pacific: 'Oceania', Africa: 'Africa', Atlantic: 'Europe', Indian: 'Asia' }[c] || 'Unknown';
}

const pct = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

function group(rows, place = true) {
  const meds = rows.map(r => r.med), fps = rows.map(r => r.fps).filter(f => f != null);
  const sent = rows.reduce((s, r) => s + r.n + r.lost, 0), lost = rows.reduce((s, r) => s + r.lost, 0);
  const g = {
    reports: rows.length, ping: pct(meds, .5), ping90: pct(meds, .9), jitter: pct(rows.map(r => r.jit), .5),
    loss: sent ? Math.round(lost / sent * 1000) / 10 : 0, highPing: Math.round(rows.filter(r => r.med > 150).length / rows.length * 100),
    fps: pct(fps, .5), lowFps: fps.length ? Math.round(fps.filter(f => f < 40).length / fps.length * 100) : null,
  };
  g.verdict = verdict(g, place);
  return g;
}
// What most likely makes play feel laggy for a group of reports.
function verdict(g, place = true) { // place: the group is an area or time zone, so distance advice applies
  if (g.reports < 3) return 'Not enough reports yet';
  const out = [];
  if (g.ping > 150) out.push(place ? 'Far from the server: most pings here are slow, so a server closer to this area would help' : 'Most pings are slow: see the areas above for where they come from');
  else if (g.highPing >= 20 || g.loss > 2 || g.jitter > 60) out.push('Server distance is fine, but some players have poor connections (slow or unsteady pings, lost packets)');
  if (g.fps != null && (g.fps < 45 || g.lowFps >= 25)) out.push('Phones struggle to draw the game smoothly: lighter effects would help');
  return out.length ? out.join('. ') : 'Good: low ping and smooth frames';
}

/** Reports since `since`, grouped overall, by area, by time zone and by platform. */
function summary(rows) {
  const by = (key, place) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m].map(([name, list]) => ({ name, ...group(list, place) })).sort((a, b) => b.reports - a.reports); };
  return { reports: rows.length, overall: rows.length ? group(rows, false) : null, areas: by(r => areaOf(r.tz), true), zones: by(r => r.tz, true), platforms: by(r => r.platform, false), connections: by(r => r.conn || 'unknown', false) };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** A self-contained report page. */
function page(sum, days) {
  const cell = (v, bad, warn, unit = '') => v == null ? '<td class="n">—</td>' : `<td class="n ${v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok'}">${v}${unit}</td>`;
  const fpsCell = v => v == null ? '<td class="n">—</td>' : `<td class="n ${v < 40 ? 'bad' : v < 50 ? 'warn' : 'ok'}">${v}</td>`;
  const table = (title, list) => `<h2>${esc(title)}</h2><table><tr><th></th><th>Reports</th><th>Ping</th><th>Ping (worst 10%)</th><th>Jitter</th><th>Lost</th><th>Slow pings</th><th>FPS</th><th>What it means</th></tr>${list.map(g =>
    `<tr><td>${esc(g.name)}</td><td class="n">${g.reports}</td>${cell(g.ping, 150, 90, ' ms')}${cell(g.ping90, 250, 150, ' ms')}${cell(g.jitter, 60, 30, ' ms')}${cell(g.loss, 2, .5, '%')}${cell(g.highPing, 20, 10, '%')}${fpsCell(g.fps)}<td class="v">${esc(g.verdict)}</td></tr>`).join('')}</table>`;
  const o = sum.overall;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mitosis connection report</title><style>
:root{--bg:#06100f;--ink:#dcefe9;--mut:#8fb3aa;--line:#1d3330;--ok:#5fe0a8;--warn:#f2b134;--bad:#ff6b6b}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif;padding:24px max(16px,calc(50% - 560px))}
h1{font-size:26px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em}
p{color:var(--mut);margin:0 0 6px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.v{color:var(--mut);min-width:220px}.big{display:flex;gap:28px;flex-wrap:wrap;margin:16px 0}.big b{display:block;font-size:28px}
@media (max-width:700px){table{display:block;overflow-x:auto}}</style></head><body>
<h1>Connection report</h1><p>Last ${days} day${days === 1 ? '' : 's'} · ${sum.reports} report${sum.reports === 1 ? '' : 's'} from games connected to this server. Ping is the round trip to this server; each report covers a few minutes of one game.</p>
${o ? `<div class="big"><div><b class="${o.ping > 150 ? 'bad' : o.ping > 90 ? 'warn' : 'ok'}">${o.ping} ms</b>typical ping</div><div><b>${o.ping90} ms</b>worst 10%</div><div><b>${o.loss}%</b>pings lost</div><div><b>${o.fps ?? '—'}</b>typical FPS</div></div><p><b>${esc(o.verdict)}</b></p>` : '<p>No reports yet. Games send one every few minutes once the new version is out.</p>'}
${sum.areas.length ? table('By area (where a server would go)', sum.areas) : ''}${sum.zones.length ? table('By time zone', sum.zones.slice(0, 40)) : ''}${sum.platforms.length ? table('By platform', sum.platforms) : ''}${sum.connections.length ? table('By connection type (Android and web only)', sum.connections) : ''}
<p style="margin-top:24px">Slow pings: share of reports whose typical ping was over 150 ms. JSON: add <code>&amp;format=json</code>.</p></body></html>`;
}

module.exports = { clean, summary, page, areaOf, verdict };
