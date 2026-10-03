// In-app purchase verification — Apple App Store and Google Play, no dependencies.
//
// Apple:  set APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 contents,
//         "\n" allowed for newlines) and APPLE_BUNDLE_ID. The server asks the App
//         Store Server API for the transaction and checks it belongs to this app.
// Google: set GOOGLE_PACKAGE_NAME and GOOGLE_SERVICE_ACCOUNT (the service-account
//         JSON, raw or base64). The server checks the purchase token with the
//         Google Play Developer API.
// Dev:    IAP_UNVERIFIED=1 trusts whatever the client sends. Only for local testing
//         with Xcode's StoreKit configuration or Play's test purchases. Never in prod.
'use strict';
const crypto = require('crypto');

const UNVERIFIED = process.env.IAP_UNVERIFIED === '1';
const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function decodeJwsPayload(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) throw new Error('malformed JWS');
  return JSON.parse(fromB64url(parts[1]).toString('utf8'));
}
async function getJson(url, headers) {
  const r = await fetch(url, { headers });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch (e) {}
  return { status: r.status, body, text };
}

/* ---------- Apple ---------- */
const apple = {
  issuer: process.env.APPLE_ISSUER_ID, keyId: process.env.APPLE_KEY_ID,
  key: (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), bundleId: process.env.APPLE_BUNDLE_ID,
};
apple.configured = !!(apple.issuer && apple.keyId && apple.key && apple.bundleId);

function appleJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: apple.keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: apple.issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1', bid: apple.bundleId }));
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + payload), { key: apple.key, dsaEncoding: 'ieee-p1363' });
  return header + '.' + payload + '.' + b64url(sig);
}

// Returns { productId, transactionId, environment }. Throws on anything suspicious.
async function verifyApple({ transactionId, jws }) {
  if (!apple.configured) {
    if (!UNVERIFIED) { const e = new Error('Apple verification is not configured on this server'); e.status = 503; throw e; }
    const p = decodeJwsPayload(jws);
    return { productId: String(p.productId || ''), transactionId: String(p.transactionId || transactionId || ''), environment: 'Unverified' };
  }
  const id = encodeURIComponent(String(transactionId || decodeJwsPayload(jws).transactionId || ''));
  if (!id) throw new Error('missing transactionId');
  const headers = { Authorization: 'Bearer ' + appleJwt() };
  let res = await getJson('https://api.storekit.itunes.apple.com/inApps/v1/transactions/' + id, headers);
  if (res.status === 404) res = await getJson('https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/' + id, headers);
  if (res.status !== 200 || !res.body || !res.body.signedTransactionInfo) throw new Error('App Store lookup failed (' + res.status + ')');
  const t = decodeJwsPayload(res.body.signedTransactionInfo); // came straight from Apple over TLS
  if (t.bundleId !== apple.bundleId) throw new Error('transaction belongs to another app');
  if (t.revocationDate) throw new Error('transaction was refunded');
  if (t.type && t.type !== 'Consumable') throw new Error('not a consumable');
  return { productId: String(t.productId), transactionId: String(t.transactionId), environment: t.environment || 'Production' };
}

/* ---------- Google ---------- */
const google = { pkg: process.env.GOOGLE_PACKAGE_NAME, sa: null, token: null, tokenExp: 0 };
try {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT || '';
  if (raw) google.sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
} catch (e) { console.error('GOOGLE_SERVICE_ACCOUNT is not valid JSON'); }
google.configured = !!(google.pkg && google.sa && google.sa.client_email && google.sa.private_key);

async function googleToken() {
  const now = Math.floor(Date.now() / 1000);
  if (google.token && now < google.tokenExp - 60) return google.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: google.sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + payload), google.sa.private_key);
  const assertion = header + '.' + payload + '.' + b64url(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + assertion });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google token request failed');
  google.token = j.access_token; google.tokenExp = now + (j.expires_in || 3600);
  return google.token;
}

// Returns { productId, orderId, purchaseToken }. Throws on anything suspicious.
async function verifyGoogle({ purchaseToken, productId, orderId }) {
  if (!purchaseToken || !productId) throw new Error('missing purchaseToken or productId');
  if (!google.configured) {
    if (!UNVERIFIED) { const e = new Error('Google Play verification is not configured on this server'); e.status = 503; throw e; }
    return { productId: String(productId), orderId: String(orderId || purchaseToken), purchaseToken, environment: 'Unverified' };
  }
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(google.pkg)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await getJson(url, { Authorization: 'Bearer ' + await googleToken() });
  if (res.status !== 200 || !res.body) throw new Error('Google Play lookup failed (' + res.status + ')');
  const p = res.body;
  if (p.purchaseState !== 0) throw new Error('purchase is not completed');
  if (p.consumptionState === 1) throw new Error('purchase was already consumed');
  return { productId: String(productId), orderId: String(p.orderId || purchaseToken), purchaseToken, environment: p.purchaseType === 0 ? 'Test' : 'Production' };
}

module.exports = { verifyApple, verifyGoogle, status: () => ({ apple: apple.configured, google: google.configured, unverified: UNVERIFIED }) };
