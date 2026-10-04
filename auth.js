// Mitosis sign-in — verifies the identity tokens that Sign in with Apple and
// Sign in with Google hand the game, so a wallet can follow a player across
// devices and reinstalls. No dependencies: the tokens are RS256 JWTs checked
// against the providers' published keys (JWKS), fetched on demand and cached.
//
// Config (environment):
//   APPLE_BUNDLE_ID      audience of tokens from the iOS app (default com.mitosisgame.app)
//   APPLE_SERVICES_ID    audience of tokens from the website / Android (Sign in with Apple JS); optional
//   GOOGLE_CLIENT_IDS    comma-separated OAuth client ids whose ID tokens are accepted (iOS, Android, web)
//   GOOGLE_WEB_CLIENT_ID the client id the website signs in with (also accepted); optional
//   AUTH_APPLE_JWKS / AUTH_GOOGLE_JWKS   override the key URLs (tests only)
'use strict';
const crypto = require('crypto');

const APPLE = { iss: ['https://appleid.apple.com'], jwks: process.env.AUTH_APPLE_JWKS || 'https://appleid.apple.com/auth/keys' };
const GOOGLE = { iss: ['https://accounts.google.com', 'accounts.google.com'], jwks: process.env.AUTH_GOOGLE_JWKS || 'https://www.googleapis.com/oauth2/v3/certs' };
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const config = {
  apple: { bundleId: process.env.APPLE_BUNDLE_ID || 'com.mitosisgame.app', servicesId: process.env.APPLE_SERVICES_ID || '' },
  google: { clientIds: list(process.env.GOOGLE_CLIENT_IDS), webClientId: process.env.GOOGLE_WEB_CLIENT_ID || '' },
};
config.apple.audiences = [config.apple.bundleId, config.apple.servicesId].filter(Boolean);
config.google.audiences = [...new Set([...config.google.clientIds, config.google.webClientId].filter(Boolean))];

const b64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

// Signing keys per JWKS URL: { at, keys: Map(kid → KeyObject) }. Refreshed hourly, or
// at most once a minute when a token names a kid we have not seen (key rotation).
const jwks = new Map();
async function keyFor(url, kid) {
  let c = jwks.get(url);
  const age = c ? Date.now() - c.at : Infinity;
  if (!c || age > 3600e3 || (!c.keys.has(kid) && age > 60e3)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('could not fetch the signing keys (' + res.status + ')');
    const j = await res.json();
    const keys = new Map();
    for (const k of j.keys || []) { try { keys.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })); } catch (e) {} }
    c = { at: Date.now(), keys }; jwks.set(url, c);
  }
  return c.keys.get(kid) || null;
}

async function verifyJwt(token, { jwksUrl, issuers, audiences, nonce, what }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed ' + what + ' token');
  let header, payload;
  try { header = JSON.parse(b64url(parts[0]).toString('utf8')); payload = JSON.parse(b64url(parts[1]).toString('utf8')); }
  catch (e) { throw new Error('malformed ' + what + ' token'); }
  if (!header || header.alg !== 'RS256' || !payload) throw new Error('unexpected ' + what + ' token format');
  const key = await keyFor(jwksUrl, header.kid);
  if (!key) throw new Error('unknown ' + what + ' signing key');
  if (!crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), key, b64url(parts[2]))) throw new Error('bad ' + what + ' token signature');
  const now = Math.floor(Date.now() / 1000);
  if (!issuers.includes(payload.iss)) throw new Error('unexpected ' + what + ' token issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some(a => audiences.includes(a))) throw new Error(what + ' token was issued for another app');
  if (typeof payload.exp !== 'number' || payload.exp < now - 60) throw new Error(what + ' token has expired');
  // Apple puts the SHA-256 of the nonce the app asked for in the token; Google and the JS SDKs echo it as is.
  if (nonce && payload.nonce !== nonce && payload.nonce !== sha256(nonce)) throw new Error(what + ' token nonce mismatch');
  if (!payload.sub) throw new Error(what + ' token has no subject');
  return payload;
}

/** Sign in with Apple: the `identityToken` from ASAuthorizationAppleIDCredential or the JS SDK. */
async function verifyApple({ identityToken, nonce }) {
  const p = await verifyJwt(identityToken, { jwksUrl: APPLE.jwks, issuers: APPLE.iss, audiences: config.apple.audiences, nonce, what: 'Apple' });
  return { provider: 'apple', subject: String(p.sub), email: p.email ? String(p.email) : null };
}

/** Sign in with Google: an OpenID Connect ID token (Google Identity Services, Credential Manager, or an OAuth code exchange). */
async function verifyGoogle({ idToken, nonce }) {
  if (!config.google.audiences.length) { const e = new Error('Google sign-in is not configured on this server'); e.status = 503; throw e; }
  const p = await verifyJwt(idToken, { jwksUrl: GOOGLE.jwks, issuers: GOOGLE.iss, audiences: config.google.audiences, nonce, what: 'Google' });
  return { provider: 'google', subject: String(p.sub), email: p.email && p.email_verified !== false ? String(p.email) : null, name: p.name ? String(p.name) : null };
}

/** What the website needs to offer sign-in (the apps bring their own client ids). */
const status = () => ({ apple: { web: config.apple.servicesId }, google: { web: config.google.webClientId, configured: config.google.audiences.length > 0 } });

module.exports = { verifyApple, verifyGoogle, status, config, sha256 };
