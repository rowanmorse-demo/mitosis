// Stress test for the relay: how many players one Mitosis server can carry.
// Starts a throwaway copy of the server on a spare port with its own data folder (it never touches a running server),
// then simulated games join it and behave like real ones: presence 15 times a second (about 450 bytes; the hosting
// game about 3.6 KB with its microbes and the world), a ping every 4 s. Each step adds players and holds, then
// reports the server's CPU (share of one core: the relay runs on one thread), its memory, the relay's delay and the
// bandwidth it sends. On a machine busy with other work, loop busy and the delays include waiting for a CPU; the
// CPU column does not, so the capacity estimate uses it.
//   node tools/stress.js                                        4, 8, 12, 16 players: today's arena limit
//   node tools/stress.js --cap=128 --steps=16,32,48,64,96,128   lifts MAX_PLAYERS in the copy to see where one arena breaks
// Options: --hold=15 (seconds measured per step) --rate=15 (presences a second) --size=450 --host-size=3600 (bytes)
//          --workers=N (processes simulating the games) --dir=PATH (the server to test; default this repository)
'use strict';
const { fork, execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let POOL = ''; for (let i = 0; i < 1 << 16; i++) POOL += B64[Math.random() * 64 | 0];
const junk = n => { const o = Math.random() * (POOL.length - n) | 0; return POOL.slice(o, o + n); }; // game-like characters, cheaply

/* ---------- a worker process: runs a share of the simulated games ---------- */
if (process.argv[2] === '--worker') {
  const { performance } = require('perf_hooks');
  const games = [];
  let stats = null; const fresh = () => ({ msgs: 0, bytes: 0, sent: 0, delays: [], rtts: [], full: 0, dropped: 0 });
  stats = fresh();
  const sample = (a, v) => { if (a.length < 4000) a.push(v); else a[Math.random() * a.length | 0] = v; };
  // what a game sends: its own cells, the pellets it just ate, now and then blobs and event records (see send() in index.html)
  function presence(g) {
    const p = { st: Date.now(), v: 6, h: g.host ? 1 : 0, n: g.name, s: 2, a: 1, f: 0, k: 0, ks: 0, q: 0, em: null, ev: null, rd: null, cl: null, ej: null, r: null, pe: null, b: null, vs: null, vw: null, pu: null, hv: null };
    const target = g.host ? g.hostSize : g.size;
    p.cl = junk(12 * (1 + (Math.random() * 6 | 0)));
    if (Math.random() < .2) p.ej = junk(6 * (1 + (Math.random() * 6 | 0)));
    if (Math.random() < .1) p.r = [[++g.seq, 'k', g.id, g.name, 'b' + (Math.random() * 30 | 0), 'Microbe']];
    if (g.host) { p.vs = junk(280); p.vw = junk(128); p.pu = junk(216); p.ev = ''; p.rd = junk(5); p.hv = junk(40); }
    const base = JSON.stringify(p).length, room = target - base - (g.host ? 10 : 8);
    if (room > 0) { if (g.host) p.b = junk(room); else p.pe = junk(Math.floor(room / 6) * 6); }
    return JSON.stringify({ t: 'p', p });
  }
  function join(url, o) {
    const g = { id: o.id, name: o.name, host: o.host, size: o.size, hostSize: o.hostSize, seq: 0, ws: null, timers: [], closing: false };
    g.ws = new WebSocket(url);
    g.ws.onopen = () => g.ws.send(JSON.stringify({ t: 'hello', id: g.id }));
    g.ws.onmessage = e => {
      const d = e.data; stats.msgs++; stats.bytes += d.length;
      if (d.startsWith('{"t":"p"')) { const i = d.indexOf('"st":'); if (i > 0) sample(stats.delays, Date.now() - parseInt(d.slice(i + 5, i + 20), 10)); return; }
      let m; try { m = JSON.parse(d); } catch (err) { return; }
      if (m.t === 'welcome') {
        const every = 1000 / o.rate;
        g.timers.push(setTimeout(() => g.timers.push(setInterval(() => { if (g.ws.readyState === 1) { g.ws.send(presence(g)); stats.sent++; } }, every)), Math.random() * every));
        g.timers.push(setInterval(() => { if (g.ws.readyState === 1) g.ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); }, 4000));
      } else if (m.t === 'pong') sample(stats.rtts, performance.now() - m.c);
      else if (m.t === 'full') { stats.full++; g.closing = true; }
    };
    g.ws.onclose = () => { g.timers.forEach(t => { clearInterval(t); clearTimeout(t); }); if (!g.closing) stats.dropped++; };
    g.ws.onerror = () => {};
    games.push(g);
  }
  let cpu = process.cpuUsage(), at = performance.now();
  process.on('message', async m => {
    if (m.cmd === 'add') for (const o of m.games) { join(m.url, o); await sleep(5); }
    else if (m.cmd === 'stats') { const c = process.cpuUsage(cpu), now = performance.now(); process.send({ ...stats, open: games.filter(g => g.ws.readyState === 1).length, busy: (c.user + c.system) / 1000 / (now - at) }); cpu = process.cpuUsage(); at = now; stats = fresh(); }
    else if (m.cmd === 'stop') { for (const g of games) { g.closing = true; try { g.ws.close(); } catch (e) {} } setTimeout(() => process.exit(0), 300); }
  });
  return;
}

/* ---------- the parent: the server copy, the steps, the report ---------- */
const opt = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([\w-]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const cap = opt.cap ? +opt.cap : null, hold = +(opt.hold || 15), rate = +(opt.rate || 15), size = +(opt.size || 450), hostSize = +(opt['host-size'] || 3600);
const steps = String(opt.steps || (cap ? [16, 32, 48, 64].filter(n => n <= cap).join(',') : '4,8,12,16')).split(',').map(Number).filter(n => n > 0);
const nWorkers = +(opt.workers || Math.max(2, Math.min(6, os.cpus().length - 2)));
const dir = path.resolve(opt.dir || path.join(__dirname, '..'));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-stress-')), app = path.join(work, 'app'), data = path.join(work, 'data');
fs.mkdirSync(app); fs.mkdirSync(data);
for (const f of fs.readdirSync(dir)) if (/\.(js|json|html)$/.test(f)) fs.copyFileSync(path.join(dir, f), path.join(app, f));
if (cap) {
  const src = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
  if (!/const MAX_PLAYERS = \d+;/.test(src)) { console.error('This server has no `const MAX_PLAYERS = N;` to lift; run without --cap.'); process.exit(2); }
  fs.writeFileSync(path.join(app, 'server.js'), src.replace(/const MAX_PLAYERS = \d+;/, `const MAX_PLAYERS = ${cap};`));
}
// the server runs inside this small host, which reports its CPU, memory and event loop when asked
fs.writeFileSync(path.join(app, 'stress-host.js'), `'use strict';
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
let elu = performance.eventLoopUtilization(), cpu = process.cpuUsage(), at = performance.now();
process.on('message', () => {
  const e = performance.eventLoopUtilization(elu), c = process.cpuUsage(cpu), now = performance.now();
  process.send({ busy: e.utilization, cpu: (c.user + c.system) / 1000 / (now - at), rss: process.memoryUsage().rss, lag99: lag.percentile(99) / 1e6, lagMax: lag.max / 1e6 });
  elu = performance.eventLoopUtilization(); cpu = process.cpuUsage(); at = now; lag.reset();
});
require('./server.js');
`);
const PORT = 20000 + Math.floor(Math.random() * 20000), base = `http://127.0.0.1:${PORT}`, url = base.replace(/^http/, 'ws') + '/ws';
const server = fork(path.join(app, 'stress-host.js'), [], { env: { ...process.env, PORT, DATA_DIR: data, ADMIN_TOKEN: 'stress' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
const workers = Array.from({ length: nWorkers }, () => fork(__filename, ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
const ask = (proc, msg) => new Promise(res => { proc.once('message', res); proc.send(msg); });
let stopped = false;
function stop(code) {
  if (stopped) return; stopped = true;
  for (const w of workers) try { w.send({ cmd: 'stop' }); } catch (e) {}
  setTimeout(() => { try { server.kill(); } catch (e) {} for (const w of workers) try { w.kill(); } catch (e) {} fs.rmSync(work, { recursive: true, force: true }); process.exit(code); }, 600);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(1));
server.on('exit', c => { if (!stopped) { console.error('the server stopped (exit ' + c + ')'); stop(1); } });

const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const f0 = v => Number.isFinite(v) ? String(Math.round(v)) : '–', f1 = v => Number.isFinite(v) ? v.toFixed(1) : '–';
async function measure(secs) {
  await Promise.all([ask(server, 'reset'), ...workers.map(w => ask(w, { cmd: 'stats' }))]); // start the window clean
  const t0 = Date.now(); await sleep(secs * 1000);
  const [srv, ...ws] = await Promise.all([ask(server, 'stats'), ...workers.map(w => ask(w, { cmd: 'stats' }))]);
  const dt = (Date.now() - t0) / 1000, sum = k => ws.reduce((n, w) => n + w[k], 0), all = k => ws.flatMap(w => w[k]);
  return { srv, open: sum('open'), full: sum('full'), dropped: sum('dropped'), inPerSec: sum('sent') / dt, outPerSec: sum('msgs') / dt, outMB: sum('bytes') / dt / 1e6,
    delay50: pct(all('delays'), 50), delay99: pct(all('delays'), 99), rtt50: pct(all('rtts'), 50), rtt99: pct(all('rtts'), 99), genBusy: Math.max(...ws.map(w => w.busy)) };
}

(async () => {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch (e) {} await sleep(100); }
  const machine = `${os.cpus()[0].model.trim()}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB, Node ${process.version}`;
  console.log(`Mitosis relay stress test: ${dir}${cap ? ` (MAX_PLAYERS lifted to ${cap})` : ''}\n${machine}; ${nWorkers} worker processes; each game sends ${rate}/s, ${size} B (host ${hostSize} B); ${hold} s per step\n`);
  console.log('players  joined  server CPU  loop busy  loop p99   relay p50/p99   ping p50/p99   out msg/s   out Mbit/s  memory  dropped');
  const rows = []; let n = 0;
  for (const want of steps) {
    const add = []; for (; n < want; n++) add.push({ id: 'stress' + String(n).padStart(4, '0'), name: 'Stress ' + n, host: n === 0, size, hostSize, rate });
    add.forEach((g, i) => workers[i % nWorkers].send({ cmd: 'add', url, games: [g] }));
    await sleep(2500 + add.length * 15);
    const m = await measure(hold); m.flow = m.outPerSec / Math.max(1, rate * m.open * (m.open - 1) + m.open / 4); rows.push({ want, ...m }); // presences to every other game, plus pongs
    console.log(`${String(want).padStart(7)}  ${String(m.open).padStart(6)}  ${(f0(m.srv.cpu * 100) + '%').padStart(10)}  ${(f0(m.srv.busy * 100) + '%').padStart(9)}  ${(f1(m.srv.lag99) + ' ms').padStart(8)}   ${(f0(m.delay50) + '/' + f0(m.delay99) + ' ms').padStart(13)}   ${(f0(m.rtt50) + '/' + f0(m.rtt99) + ' ms').padStart(12)}   ${f0(m.outPerSec).padStart(9)}   ${f1(m.outMB * 8).padStart(10)}  ${(f0(m.srv.rss / 2 ** 20) + ' MB').padStart(6)}  ${String(m.dropped).padStart(7)}${m.full ? `   (${m.full} turned away: arena full)` : ''}${m.genBusy > .85 ? '   (!) the simulated games are saturated: this row understates the load' : ''}${m.flow < .9 ? `   (!) only ${f0(m.flow * 100)}% of the expected messages flowed: this machine is too busy for a clean reading` : ''}`);
    if (m.srv.cpu > .95 || m.dropped > want / 4) { console.log('\nThe server is saturated; stopping here.'); break; }
  }
  // the relay passes every presence to every other game in the arena, so one arena's work grows with players squared
  const per16 = rows.find(r => r.want === 16 && r.open >= 16 && r.dropped === 0);
  if (per16) {
    const cpu = per16.srv.cpu / Math.min(1, per16.flow), mbit = per16.outMB * 8 / Math.min(1, per16.flow), rooms = Math.floor(.7 / cpu); // scaled to the full message rate
    if (per16.flow < .9) console.log(`\nOnly ${f0(per16.flow * 100)}% of the messages flowed at 16 players, so the figures below are scaled up to the full rate; rerun on a quiet machine to confirm.`);
    console.log(`\nOne full arena of 16 uses ${f0(cpu * 100)}% of one core and sends ${f1(mbit)} Mbit/s.`);
    console.log(`If the relay ran several arenas of 16, this machine's CPU could carry about ${rooms} of them (${rooms * 16} players) at 70% of one core; they would send about ${f0(rooms * mbit)} Mbit/s, so check the server's bandwidth too.`);
  }
  stop(0);
})().catch(e => { console.error(e); stop(1); });
