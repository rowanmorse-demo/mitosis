#!/usr/bin/env node
// Preview the website locally with the same routes as the Caddyfile:  node site-src/preview.js [port]   (default 8080)
// Static pages come from site/; /play, /ws, /api, /updates, /health and /admin go to the game server on
// http://localhost:3000 (start it first with `npm run dev`). Open http://localhost:8080.
'use strict';
const http = require('http'), net = require('net'), fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..', 'site'), PORT = Number(process.argv[2]) || 8080, GAME = { host: '127.0.0.1', port: Number(process.env.GAME_PORT) || 3000 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const isGame = p => p === '/ws' || p === '/health' || p === '/admin' || /^\/(api|updates|admin)\//.test(p);

function proxy(req, res, pathOverride) {
  const up = http.request({ ...GAME, method: req.method, path: pathOverride || req.url, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('The game server is not running on port ' + GAME.port); });
  req.pipe(up);
}
function file(res, p, status = 200) {
  fs.readFile(p, (err, buf) => {
    if (err) return file(res, path.join(SITE, '404.html'), 404);
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(buf);
  });
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
  if (isGame(p)) return proxy(req, res);
  if (p === '/play' || p === '/play/' || p === '/index.html') return proxy(req, res, '/' + u.search); // the web game
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const tries = [path.join(SITE, safe), path.join(SITE, safe + '.html'), path.join(SITE, safe, 'index.html')];
  const hit = tries.find(f => f.startsWith(SITE) && fs.existsSync(f) && fs.statSync(f).isFile());
  file(res, hit || path.join(SITE, '404.html'), hit ? 200 : 404);
});
// WebSocket (/ws): pass the upgraded connection straight through to the game server
server.on('upgrade', (req, sock, head) => {
  const up = net.connect(GAME.port, GAME.host, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    sock.pipe(up).pipe(sock);
  });
  up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
});
server.listen(PORT, () => console.log(`Website preview: http://localhost:${PORT}  (game server: http://localhost:${GAME.port})`));
