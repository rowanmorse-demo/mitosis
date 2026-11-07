#!/usr/bin/env node
// Remote page updates: ship a new game page (index.html) to the iOS app without an App Store release.
// It plays the part Microsoft CodePush did for React Native apps (CodePush shut down in March 2025).
//
//   node tools/page-update.js keygen        make the signing key (once per Mac) and put its public half in the app
//   node tools/page-update.js publish       sign index.html into updates/ios/ for builds 11 … the build in ios/project.yml
//        [--min N] [--max N]                 limit it to app builds N … (a page that needs new native code: --min that build)
//   node tools/page-update.js off           send every app back to the page built into it
//   node tools/page-update.js check         verify updates/ios against the key built into the app
//
// Then commit updates/ and deploy the server as usual. An app checks when it opens (and at most every 30 minutes
// when it comes back to the foreground), downloads the page, checks its signature and SHA-256, and shows it on its
// next launch. A page that doesn't start (no {type:'booted'} within 15 s) is dropped and the built-in page used again.
// See ios/Mitosis/PageUpdates.swift for the app side. Only the page can change this way: native code (StoreKit,
// sign-in, Nearby, haptics) still needs an App Store build, and Apple's rules allow downloaded web code only while
// it doesn't change what the app is for.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os'), { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FIRST_BUILD = 11;  // the first iOS build that takes page updates
const PLATFORM = 'ios';
const KEY_FILE = process.env.MITOSIS_UPDATE_KEY_FILE || path.join(os.homedir(), '.mitosis', 'page-update-key.pem');
const SWIFT = path.join(ROOT, 'ios', 'Mitosis', 'PageUpdates.swift');
const PROJECT = path.join(ROOT, 'ios', 'project.yml');
const OUT = path.join(ROOT, 'updates', PLATFORM);
const KEY_RE = /(static let publicKey = ")([A-Za-z0-9+/=]*)(")/;

/** The exact text that is signed; PageUpdates.swift builds the same from the manifest's fields. */
function message(m, platform = PLATFORM) {
  return ['mitosis-page-update/1', 'platform=' + platform, 'v=' + m.v, 'minBuild=' + m.minBuild, 'maxBuild=' + m.maxBuild,
    'sha256=' + m.sha256, 'size=' + m.size].join('\n');
}
const rawToKey = raw => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw, 'base64').toString('base64url') }, format: 'jwk' });
const keyToRaw = pub => Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const appKey = () => { const m = fs.readFileSync(SWIFT, 'utf8').match(KEY_RE); return m ? m[2] : ''; };
const appBuild = () => Number((fs.readFileSync(PROJECT, 'utf8').match(/CURRENT_PROJECT_VERSION:\s*"?(\d+)/) || [])[1]);

/** Problems with a manifest (and its page, unless it is an "off" manifest), checked against a raw public key. */
function verify(manifest, page, publicKeyRaw) {
  const errs = [], m = manifest;
  for (const k of ['v', 'minBuild', 'maxBuild', 'size']) if (!Number.isInteger(m[k]) || m[k] < 0) errs.push(k + ' is not a whole number');
  if (m.minBuild > m.maxBuild) errs.push('minBuild is above maxBuild');
  if (!/^([0-9a-f]{64})?$/.test(m.sha256 || '')) errs.push('sha256 is not 64 hex digits');
  if (!publicKeyRaw) errs.push('the app has no public key (run keygen)');
  else {
    let ok = false;
    try { ok = crypto.verify(null, Buffer.from(message(m)), rawToKey(publicKeyRaw), Buffer.from(m.sig || '', 'base64')); } catch (e) { /* bad key or signature */ }
    if (!ok) errs.push('the signature does not match the key built into the app');
  }
  if (m.sha256) {
    if (!page) errs.push('page.html is missing');
    else {
      if (page.length !== m.size) errs.push(`page.html is ${page.length} bytes, the manifest says ${m.size}`);
      if (crypto.createHash('sha256').update(page).digest('hex') !== m.sha256) errs.push('page.html does not match the manifest\'s sha256');
    }
  }
  return errs;
}

/** Signs a page (or "off") into out/manifest.json + out/page.html. Returns the manifest. */
function publish({ out = OUT, pagePath = path.join(ROOT, 'index.html'), keyFile = KEY_FILE, min = FIRST_BUILD, max, off = false } = {}) {
  if (!fs.existsSync(keyFile)) throw new Error(`No signing key at ${keyFile}. Run: node tools/page-update.js keygen`);
  const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
  if (max === undefined) max = appBuild();
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new Error(`Bad build range ${min} … ${max}`);
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')); } catch (e) { /* first one */ }
  const m = { v: (prev && Number.isInteger(prev.v) ? prev.v : 0) + 1, minBuild: min, maxBuild: max, sha256: '', size: 0 };
  let page = null;
  if (!off) {
    page = fs.readFileSync(pagePath);
    // the app drops a page that never says it started, so refuse one that can't
    if (!page.includes("type:'booted'")) throw new Error(pagePath + " never sends {type:'booted'}, so the app would drop it");
    m.sha256 = crypto.createHash('sha256').update(page).digest('hex');
    m.size = page.length;
  }
  m.sig = crypto.sign(null, Buffer.from(message(m)), key).toString('base64');
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: path.dirname(pagePath), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* not a checkout */ }
  const manifest = { ...m, published: new Date().toISOString(), commit }; // the last two are notes for people; they aren't signed
  fs.mkdirSync(out, { recursive: true });
  const pageFile = path.join(out, 'page.html');
  if (page) fs.writeFileSync(pageFile, page); else fs.rmSync(pageFile, { force: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); // last, so a half-done publish isn't announced
  return manifest;
}

function keygen() {
  if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} already exists. Apps trust its public half; delete it only if you mean to replace the key in a new App Store build.`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = keyToRaw(publicKey);
  const swift = fs.readFileSync(SWIFT, 'utf8');
  fs.writeFileSync(SWIFT, swift.replace(KEY_RE, `$1${raw}$3`));
  return raw;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = name => { const i = rest.indexOf('--' + name); return i >= 0 ? Number(rest[i + 1]) : undefined; };
  if (cmd === 'keygen') {
    const raw = keygen();
    console.log(`Signing key: ${KEY_FILE} (keep a copy somewhere safe: without it no page update can be published until an App Store build with a new key)`);
    console.log(`Public key ${raw} written into ${path.relative(ROOT, SWIFT)}. It takes effect in the next App Store build.`);
  } else if (cmd === 'publish' || cmd === 'off') {
    const m = publish({ off: cmd === 'off', min: opt('min') ?? FIRST_BUILD, max: opt('max') });
    const errs = verify(m, m.sha256 ? fs.readFileSync(path.join(OUT, 'page.html')) : null, appKey());
    if (errs.length) { console.error('Published, but it would be refused by the app:\n  ' + errs.join('\n  ')); process.exit(1); }
    console.log(m.sha256 ? `Page update ${m.v} (${(m.size / 1024).toFixed(0)} KB, ${m.commit || 'no commit'}) for iOS builds ${m.minBuild}–${m.maxBuild} is in updates/${PLATFORM}/.`
      : `Update ${m.v} sends iOS builds ${m.minBuild}–${m.maxBuild} back to the page built into the app.`);
    console.log('Commit updates/ and deploy the server. Apps download it when they next open and show it on the launch after.');
  } else if (cmd === 'check') {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')); } catch (e) { console.log('No page update published (updates/ios/manifest.json is missing).'); return; }
    const page = fs.existsSync(path.join(OUT, 'page.html')) ? fs.readFileSync(path.join(OUT, 'page.html')) : null;
    const errs = verify(m, page, appKey());
    if (errs.length) { console.error(`Update ${m.v} would be refused:\n  ` + errs.join('\n  ')); process.exit(1); }
    console.log(`Update ${m.v} is valid: ${m.sha256 ? 'a page of ' + m.size + ' bytes' : 'back to the built-in page'} for builds ${m.minBuild}–${m.maxBuild}, published ${m.published || '?'} from ${m.commit || '?'}.`);
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 1 : 0);
  }
}

module.exports = { message, verify, publish, rawToKey, keyToRaw, FIRST_BUILD };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
