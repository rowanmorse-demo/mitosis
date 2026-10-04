// Mitosis server — serves the game, relays live play between players over
// WebSockets, and runs the ATP economy API (wallets, skins, purchases).
// No dependencies: needs only Node.js 20+ (https://nodejs.org). Run:  node server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const { openStore, DATA_DIR } = require('./store');
const economy = require('./economy');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 16;
const MAX_MSG = 16 * 1024;          // bytes per message
const MAX_RATE = 90;                // messages per second per player
const MAX_BODY = 64 * 1024;         // bytes per API request
const API_RATE = 120;               // API requests per minute per IP
const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const store = openStore();

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
  'POST /api/run/start': { fn: economy.handlers.runStart, auth: true },
  'POST /api/run/end': { fn: economy.handlers.runEnd, auth: true },
  'POST /api/skins/buy': { fn: economy.handlers.buySkin, auth: true },
  'POST /api/iap/apple': { fn: economy.handlers.iapApple, auth: true },
  'POST /api/iap/google': { fn: economy.handlers.iapGoogle, auth: true },
  'GET /api/catalog': { fn: () => economy.catalog(), auth: false },
  'GET /api/leaderboard': { fn: store => economy.handlers.leaderboard(store), auth: false },
};
const ipHits = new Map();
function rateLimited(ip) {
  const now = Date.now(); let h = ipHits.get(ip);
  if (!h || now - h.at > 60000) { h = { at: now, n: 0 }; ipHits.set(ip, h); }
  if (ipHits.size > 5000) for (const [k, v] of ipHits) if (now - v.at > 60000) ipHits.delete(k);
  return ++h.n > API_RATE;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => { size += d.length; if (size > MAX_BODY) { reject(new economy.ApiError(413, 'request too large')); req.destroy(); } else chunks.push(d); });
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
    const body = req.method === 'POST' ? await readJson(req) : {};
    const player = route.auth ? economy.auth(store, req.headers) : null;
    sendJson(res, 200, await route.fn(store, body, player));
  } catch (e) {
    if (e instanceof economy.ApiError || e.status) sendJson(res, e.status || 400, { error: e.message });
    else { console.error('API error on ' + url + ': ' + (e.stack || e)); sendJson(res, 500, { error: 'server error' }); }
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url.startsWith('/api/')) { api(req, res, url); return; }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ players: clients.size, accounts: store.playerCount(), store: store.kind, iap: economy.catalog().iap }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

/* ---------- minimal WebSocket (RFC 6455) ---------- */
const clients = new Set();
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!(req.url || '').startsWith('/ws') || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { sock, id: null, p: null, buf: Buffer.alloc(0), frag: [], alive: true, count: 0, window: Date.now(), dead: false };
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
function broadcast(from, obj) {
  const buf = frame(1, Buffer.from(JSON.stringify(obj)));
  for (const o of clients) if (o !== from && o.id) sendRaw(o, buf);
}
function onMessage(c, text) {
  const now = Date.now();
  if (now - c.window > 1000) { c.window = now; c.count = 0; }
  if (++c.count > MAX_RATE) return;
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello' && !c.id) {
    if (clients.size >= MAX_PLAYERS) { send(c, { t: 'full' }); setTimeout(() => kill(c), 200); return; }
    let id = typeof m.id === 'string' && /^[a-z0-9]{6,20}$/.test(m.id) ? m.id : crypto.randomBytes(6).toString('hex');
    while ([...clients].some(o => o.id === id)) id += Math.floor(Math.random() * 10);
    c.id = id; clients.add(c);
    send(c, { t: 'welcome', id, peers: [...clients].filter(o => o !== c && o.p).map(o => ({ id: o.id, p: o.p })), lan: lanUrls() });
    log(`+ player joined (${clients.size} in the well)`);
  } else if (m.t === 'p' && c.id && m.p && typeof m.p === 'object' && !Array.isArray(m.p)) {
    c.p = m.p;
    broadcast(c, { t: 'p', id: c.id, p: m.p });
  }
}
function kill(c) {
  if (c.dead) return; c.dead = true;
  try { c.sock.destroy(); } catch (e) {}
  if (clients.delete(c)) { broadcast(c, { t: 'bye', id: c.id }); log(`- player left (${clients.size} in the well)`); }
}
setInterval(() => {
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
  console.log(`  Purchases:          Apple ${iap.apple ? 'verified' : 'not configured'} · Google Play ${iap.google ? 'verified' : 'not configured'}${iap.unverified ? '  (IAP_UNVERIFIED=1: trusting clients — dev only!)' : ''}`);
  console.log(`\n  Friends somewhere else? Keep this window open, then run share-online.bat`);
  console.log(`  and send them the https://....trycloudflare.com link it prints.\n`);
  console.log('  If Windows asks about network access, choose Allow (Private networks).');
  console.log('  Close this window to stop the server.\n');
});
