// In-app purchase verification — Apple App Store and Google Play, no dependencies.
//
// Apple:  works out of the box. StoreKit 2 hands the app a transaction signed by
//         Apple (a JWS whose x5c chain ends at Apple Root CA G3, embedded below);
//         the server checks the chain, the signature and the payload offline.
//         APPLE_BUNDLE_ID defaults to com.mitosisgame.app. Optionally set
//         APPLE_ISSUER_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (an App Store Server
//         API key) and the server also looks the transaction up at Apple.
// Google: set GOOGLE_PACKAGE_NAME and GOOGLE_SERVICE_ACCOUNT (the service-account
//         JSON, raw or base64). The server checks the purchase token with the
//         Google Play Developer API.
// Dev:    IAP_UNVERIFIED=1 trusts whatever the client sends. Only for local testing
//         with Xcode's StoreKit configuration or Play's test purchases. Never in prod.
'use strict';
const crypto = require('crypto');
const fs = require('fs');

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
// Apple Root CA - G3 (public; also in every macOS/iOS trust store). Tests can point
// APPLE_ROOT_CERT at a different root to verify chains they generated themselves.
const APPLE_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;
const appleRoot = new crypto.X509Certificate(process.env.APPLE_ROOT_CERT ? fs.readFileSync(process.env.APPLE_ROOT_CERT) : APPLE_ROOT_PEM);
// Extension OIDs Apple puts on App Store receipt-signing certificates (leaf 1.2.840.113635.100.6.11.1, intermediate 1.2.840.113635.100.6.2.1), DER encoded.
const OID_LEAF = Buffer.from('060a2a864886f76364060b01', 'hex'), OID_INTER = Buffer.from('060a2a864886f76364060201', 'hex');
const apple = {
  issuer: process.env.APPLE_ISSUER_ID, keyId: process.env.APPLE_KEY_ID,
  key: (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), bundleId: process.env.APPLE_BUNDLE_ID || 'com.mitosisgame.app',
};
apple.online = !!(apple.issuer && apple.keyId && apple.key);
apple.configured = true;

// Verifies a StoreKit 2 signed transaction without talking to Apple: certificate chain
// to Apple's root, Apple's receipt-signing OIDs, validity dates, then the ES256 signature.
// Returns the decoded payload. Throws on anything wrong.
function verifyAppleJws(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) throw new Error('malformed JWS');
  const header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
  if (header.alg !== 'ES256') throw new Error('unexpected JWS algorithm');
  const chain = (Array.isArray(header.x5c) ? header.x5c : []).map(c => new crypto.X509Certificate(Buffer.from(String(c), 'base64')));
  if (chain.length < 2 || chain.length > 3) throw new Error('unexpected certificate chain');
  const [leaf, inter] = chain, root = chain[2] || appleRoot, now = Date.now();
  if (!root.raw.equals(appleRoot.raw)) throw new Error('certificate chain does not end at Apple Root CA G3');
  for (const c of chain) if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) throw new Error('certificate is not currently valid');
  if (!inter.checkIssued(root) || !inter.verify(root.publicKey)) throw new Error('intermediate certificate is not signed by Apple');
  if (!leaf.checkIssued(inter) || !leaf.verify(inter.publicKey)) throw new Error('signing certificate is not signed by Apple');
  if (!leaf.raw.includes(OID_LEAF) || !inter.raw.includes(OID_INTER)) throw new Error('not an App Store signing certificate');
  const ok = crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, fromB64url(parts[2]));
  if (!ok) throw new Error('bad JWS signature');
  return JSON.parse(fromB64url(parts[1]).toString('utf8'));
}

function appleJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: apple.keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: apple.issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1', bid: apple.bundleId }));
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + payload), { key: apple.key, dsaEncoding: 'ieee-p1363' });
  return header + '.' + payload + '.' + b64url(sig);
}

// Returns { productId, transactionId, environment }. Throws on anything suspicious.
async function verifyApple({ transactionId, jws }) {
  let t;
  try { t = verifyAppleJws(jws); }
  catch (e) {
    // Xcode's local StoreKit configuration signs with its own certificate: only accepted in dev.
    if (!UNVERIFIED) throw e;
    const p = decodeJwsPayload(jws);
    return { productId: String(p.productId || ''), transactionId: String(p.transactionId || transactionId || ''), environment: 'Unverified' };
  }
  if (t.bundleId !== apple.bundleId) throw new Error('transaction belongs to another app');
  if (!t.transactionId || (transactionId && String(t.transactionId) !== String(transactionId))) throw new Error('transaction id mismatch');
  if (t.revocationDate) throw new Error('transaction was refunded');
  if (t.type && t.type !== 'Consumable') throw new Error('not a consumable');
  if (t.environment && t.environment !== 'Production' && t.environment !== 'Sandbox') throw new Error('unexpected environment ' + t.environment);
  if (apple.online) { // second opinion straight from Apple
    const id = encodeURIComponent(String(t.transactionId)), headers = { Authorization: 'Bearer ' + appleJwt() };
    let res = await getJson('https://api.storekit.itunes.apple.com/inApps/v1/transactions/' + id, headers);
    if (res.status === 404) res = await getJson('https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/' + id, headers);
    if (res.status !== 200 || !res.body || !res.body.signedTransactionInfo) throw new Error('App Store lookup failed (' + res.status + ')');
    const a = decodeJwsPayload(res.body.signedTransactionInfo);
    if (a.bundleId !== apple.bundleId || String(a.productId) !== String(t.productId) || a.revocationDate) throw new Error('App Store does not confirm this transaction');
  }
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

module.exports = { verifyApple, verifyGoogle, verifyAppleJws, status: () => ({ apple: apple.configured, appleOnline: apple.online, google: google.configured, unverified: UNVERIFIED }) };
