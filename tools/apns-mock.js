#!/usr/bin/env node
// A stand-in for Apple's push service (APNs), for testing push notifications without Apple's key or network.
// It speaks APNs' HTTP/2 API (unencrypted h2c), checks each request the way Apple does (the ES256 provider token against
// the key's public half, its Key ID and Team ID, the topic, the push type, the payload size) and answers like Apple.
// With --simulator it hands every accepted notification to an iOS Simulator (`xcrun simctl push`), so the whole path
// (page → app token → server → "APNs" → phone) can be watched end to end.
//
//   node tools/apns-mock.js --port 2197 --key /path/test-key.p8 --key-id ABC123DEFG --team 4M7HR323EA [--simulator booted]
//   then run the server with  APNS_HOST=http://localhost:2197 APNS_KEY_FILE=/path/test-key.p8 APNS_KEY_ID=ABC123DEFG APNS_TEAM_ID=4M7HR323EA
//
// Device tokens starting with "dead" answer 410 Unregistered, "bad" 400 BadDeviceToken, "busy" 503. GET /sent (curl
// --http2-prior-knowledge) lists what arrived. Use a key made for testing (`node tools/apns-mock.js --make-key out.p8`),
// never the real APNs key.
'use strict';
const http2 = require('http2'), crypto = require('crypto'), fs = require('fs'), { execFile } = require('child_process');

const fromB64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function start({ port = 0, publicKey = null, keyId = null, teamId = null, topic = 'com.mitosisgame.app', simulator = null, badPrefix = 'bad', log = () => {} } = {}) {
  const sent = [];
  const pub = !publicKey ? null : publicKey instanceof crypto.KeyObject && publicKey.type === 'public' ? publicKey : crypto.createPublicKey(publicKey); // a public key, or the private .p8 (its public half)
  function check(h, body) {
    const m = /^\/3\/device\/([^/]+)$/.exec(h[':path'] || '');
    if (h[':method'] !== 'POST' || !m) return [404, 'BadPath'];
    const auth = /^bearer (.+)$/.exec(h.authorization || '');
    if (!auth) return [403, 'MissingProviderToken'];
    const [hd, pl, sig] = auth[1].split('.');
    let head, claims; try { head = JSON.parse(fromB64url(hd)); claims = JSON.parse(fromB64url(pl)); } catch (e) { return [403, 'InvalidProviderToken']; }
    if (head.alg !== 'ES256' || (keyId && head.kid !== keyId) || (teamId && claims.iss !== teamId)) return [403, 'InvalidProviderToken'];
    if (pub && !crypto.verify('sha256', Buffer.from(hd + '.' + pl), { key: pub, dsaEncoding: 'ieee-p1363' }, fromB64url(sig || ''))) return [403, 'InvalidProviderToken'];
    if (Date.now() / 1000 - claims.iat > 3600) return [403, 'ExpiredProviderToken'];
    if (h['apns-topic'] !== topic) return [400, 'DeviceTokenNotForTopic'];
    if (!['alert', 'background'].includes(h['apns-push-type'])) return [400, 'InvalidPushType'];
    if (body.length > 4096) return [413, 'PayloadTooLarge'];
    let payload; try { payload = JSON.parse(body); } catch (e) { return [400, 'PayloadEmpty']; }
    const token = m[1];
    if (token.startsWith('dead')) return [410, 'Unregistered'];
    if ([].concat(badPrefix).some(p => token.startsWith(p))) return [400, 'BadDeviceToken'];
    if (token.startsWith('busy')) return [503, 'ServiceUnavailable'];
    return [200, null, { token, payload, headers: h, kid: head.kid, iss: claims.iss, iat: claims.iat }];
  }
  const server = http2.createServer();
  server.on('stream', (st, h) => {
    if (h[':method'] === 'GET' && h[':path'] === '/sent') { st.respond({ ':status': 200, 'content-type': 'application/json' }); st.end(JSON.stringify(sent.map(r => ({ token: r.token, payload: r.payload, at: r.at })), null, 1)); return; }
    let body = ''; st.setEncoding('utf8'); st.on('data', c => { body += c; });
    st.on('end', () => {
      const [status, reason, ok] = check(h, body), id = crypto.randomUUID();
      const rec = { status, reason, at: new Date().toISOString(), ...(ok || { token: (h[':path'] || '').split('/').pop() }) };
      if (ok) sent.push(rec);
      log(`${rec.at}  ${status}${reason ? ' ' + reason : ''}  token ${String(rec.token).slice(0, 12)}…${ok ? '  ' + JSON.stringify(ok.payload.aps && ok.payload.aps.alert) + ' link=' + ok.payload.link : ''}`);
      st.respond({ ':status': status, 'apns-id': id, ...(reason ? { 'content-type': 'application/json' } : {}) });
      st.end(reason ? JSON.stringify({ reason }) : '');
      if (ok && simulator) {
        const p = execFile('xcrun', ['simctl', 'push', simulator, topic, '-'], (err, so, se) => log(err ? '  simctl push failed: ' + (se || err.message).trim() : '  → handed to the simulator'));
        p.stdin.end(JSON.stringify(ok.payload));
      }
    });
  });
  return new Promise(res => server.listen(port, '127.0.0.1', () => res({ port: server.address().port, sent, close: () => new Promise(r => server.close(r)), server })));
}

if (require.main === module) {
  const a = process.argv.slice(2), arg = (k, d = null) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  if (arg('--make-key')) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    fs.writeFileSync(arg('--make-key'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.log('made a test key (not an Apple key): ' + arg('--make-key'));
    process.exit(0);
  }
  const keyFile = arg('--key');
  start({ port: Number(arg('--port', 2197)), publicKey: keyFile ? crypto.createPublicKey(fs.readFileSync(keyFile)) : null, keyId: arg('--key-id'), teamId: arg('--team'),
    topic: arg('--topic', 'com.mitosisgame.app'), simulator: arg('--simulator'), log: s => console.log(s) })
    .then(m => console.log(`APNs stand-in on http://localhost:${m.port}${keyFile ? ' (checking tokens against ' + keyFile + ')' : ' (not checking signatures)'}${arg('--simulator') ? ', forwarding to simulator ' + arg('--simulator') : ''}`));
}

module.exports = { start };
