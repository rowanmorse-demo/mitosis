#!/usr/bin/env node
// Remote page updates: ship a new game page (index.html) to the iOS and Android apps without a store release.
// It plays the part Microsoft CodePush did for React Native apps (CodePush shut down in March 2025).
// The full guide (publishing, rolling back, what Apple and Google allow) is docs/PAGE-UPDATES.md.
//
//   node tools/page-update.js keygen        make the signing key (once per Mac) and put its public half in the apps
//   node tools/page-update.js publish       sign index.html into updates/<platform>/ for every app build that takes page
//        [--min N] [--max N]                 updates up to the one in the project; --min/--max (with --platform) narrow it
//        [--page file]                       (a page that needs new native code: --min that build); --page: another file
//   node tools/page-update.js rollback      publish again the page that was out before the current one
//        [--to <git rev>]                    or index.html as it was at that commit or tag
//   node tools/page-update.js off           send every app back to the page built into it
//   node tools/page-update.js check         verify updates/ against the keys built into the apps
//   Every command takes --platform ios|android|all; the default is every app that has page updates built in.
//   --out <dir> (with one --platform) writes or checks that folder instead of updates/<platform>/: for test releases.
//
// Then commit updates/ and deploy the server as usual. An app checks when it opens (and at most every 30 minutes
// when it comes back to the foreground), downloads the page, checks its signature and SHA-256, and shows it on its
// next launch. A page that doesn't start (it loads but never sends {type:'booted'}, or the app is killed
// twice before it does) is dropped and the built-in page used again.
// The app side is ios/Mitosis/PageUpdates.swift and android/app/src/main/kotlin/.../PageUpdates.kt. Only the page can
// change this way: native code (purchases, sign-in, Nearby, haptics) still needs a store build, and Apple's and
// Google's rules allow downloaded web code only while it doesn't change what the app is for (docs/PAGE-UPDATES.md).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os'), { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const KEY_FILE = process.env.MITOSIS_UPDATE_KEY_FILE || path.join(os.homedir(), '.mitosis', 'page-update-key.pem');
const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
// Each app: its first build with page updates, where its public key and current build number live. Both apps trust the same key.
const PLATFORMS = {
  ios: {
    name: 'iOS', first: 11, unit: 'build',
    app: path.join(ROOT, 'ios', 'Mitosis', 'PageUpdates.swift'), keyRe: /(static let publicKey = ")([A-Za-z0-9+/=]*)(")/,
    project: path.join(ROOT, 'ios', 'project.yml'), buildRe: /CURRENT_PROJECT_VERSION:\s*"?(\d+)/,
  },
  android: {
    name: 'Android', first: 10, unit: 'versionCode',
    app: path.join(ROOT, 'android', 'app', 'src', 'main', 'kotlin', 'com', 'mitosisgame', 'app', 'PageUpdates.kt'), keyRe: /(const val PUBLIC_KEY = ")([A-Za-z0-9+/=]*)(")/,
    project: path.join(ROOT, 'android', 'app', 'build.gradle.kts'), buildRe: /versionCode\s*=\s*(\d+)/,
  },
};
const FIRST_BUILD = PLATFORMS.ios.first;  // the first iOS build that takes page updates
const outDir = platform => path.join(ROOT, 'updates', platform);
const OUT = outDir('ios');
/** The apps that have page updates built in (their PageUpdates source exists in this checkout). */
const enabledPlatforms = () => Object.keys(PLATFORMS).filter(p => fs.existsSync(PLATFORMS[p].app));

/** The exact text that is signed; PageUpdates.swift and PageUpdates.kt build the same from the manifest's fields. */
function message(m, platform = 'ios') {
  return ['mitosis-page-update/1', 'platform=' + platform, 'v=' + m.v, 'minBuild=' + m.minBuild, 'maxBuild=' + m.maxBuild,
    'sha256=' + m.sha256, 'size=' + m.size].join('\n');
}
const rawToKey = raw => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw, 'base64').toString('base64url') }, format: 'jwk' });
const keyToRaw = pub => Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const appKey = (platform = 'ios') => { const m = readText(PLATFORMS[platform].app).match(PLATFORMS[platform].keyRe); return m ? m[2] : ''; };
const appBuild = (platform = 'ios') => Number((readText(PLATFORMS[platform].project).match(PLATFORMS[platform].buildRe) || [])[1]);

/** Problems with a manifest (and its page, unless it is an "off" manifest), checked against a raw public key. */
function verify(manifest, page, publicKeyRaw, platform = 'ios') {
  const errs = [], m = manifest;
  for (const k of ['v', 'minBuild', 'maxBuild', 'size']) if (!Number.isInteger(m[k]) || m[k] < 0) errs.push(k + ' is not a whole number');
  if (m.minBuild > m.maxBuild) errs.push('minBuild is above maxBuild');
  if (!/^([0-9a-f]{64})?$/.test(m.sha256 || '')) errs.push('sha256 is not 64 hex digits');
  if (!publicKeyRaw) errs.push('the app has no public key (run keygen)');
  else {
    let ok = false;
    try { ok = crypto.verify(null, Buffer.from(message(m, platform)), rawToKey(publicKeyRaw), Buffer.from(m.sig || '', 'base64')); } catch (e) { /* bad key or signature */ }
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

/**
 * Signs a page (or "off") for one platform into out/manifest.json + out/page.html. Returns the manifest.
 * commit: the note saying where the page came from (default: this checkout's HEAD).
 */
function publish({ platform = 'ios', out = outDir(platform), pagePath = path.join(ROOT, 'index.html'), keyFile = KEY_FILE,
  min = PLATFORMS[platform].first, max, off = false, commit } = {}) {
  if (!PLATFORMS[platform]) throw new Error('Unknown platform ' + platform);
  if (!fs.existsSync(keyFile)) throw new Error(`No signing key at ${keyFile}. Run: node tools/page-update.js keygen`);
  const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
  if (max === undefined) {
    max = appBuild(platform);
    const P = PLATFORMS[platform];
    if (max < min) throw new Error(`${path.relative(ROOT, P.project)} is at ${P.unit} ${max}, older than the first ${P.name} build with page updates (${P.first}). Give --max.`);
  }
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
  m.sig = crypto.sign(null, Buffer.from(message(m, platform)), key).toString('base64');
  if (commit === undefined) {
    commit = '';
    try { commit = execSync('git rev-parse --short HEAD', { cwd: path.dirname(pagePath), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* not a checkout */ }
  }
  const manifest = { ...m, published: new Date().toISOString(), commit }; // the last two are notes for people; they aren't signed
  fs.mkdirSync(out, { recursive: true });
  const pageFile = path.join(out, 'page.html');
  if (page) fs.writeFileSync(pageFile, page); else fs.rmSync(pageFile, { force: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); // last, so a half-done publish isn't announced
  return manifest;
}

/**
 * The page to publish for a rollback: index.html at a git revision (to), or else the newest page in the history of
 * updates/<platform>/page.html that differs from the one out now (after "off": the last page that was out).
 * Returns { page, from } where from says where it came from, for the manifest's note.
 */
function previousPage(platform, to, root = ROOT, out = outDir(platform)) {
  const git = args => execSync('git ' + args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  if (to) {
    if (!/^[\w./@^~{}-]+$/.test(to)) throw new Error('--to takes a commit, tag or branch name');
    let page;
    try { page = git(`show ${to}:index.html`); } catch (e) { throw new Error(`No index.html at ${to} in this repository`); }
    let short = to;
    try { short = git(`rev-parse --short ${to}^{commit}`).toString().trim(); } catch (e) { /* keep the name */ }
    return { page, from: short };
  }
  const rel = `updates/${platform}/page.html`;
  let now = '';
  try { now = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).sha256 || ''; } catch (e) { /* nothing out */ }
  const commits = git(`log --format=%H -- ${rel}`).toString().split('\n').filter(Boolean);
  for (const c of commits) {
    let page;
    try { page = git(`show ${c}:${rel}`); } catch (e) { continue; } // that commit removed it ("off")
    if (crypto.createHash('sha256').update(page).digest('hex') !== now) return { page, from: 'rollback to ' + c.slice(0, 7) };
  }
  throw new Error(`No earlier ${PLATFORMS[platform].name} page in the history of ${rel}. Use "off" to go back to the page built into the app, or --to <commit>.`);
}

function keygen() {
  if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} already exists. Apps trust its public half; delete it only if you mean to replace the key in new store builds.`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = keyToRaw(publicKey);
  for (const p of enabledPlatforms()) {
    const P = PLATFORMS[p];
    fs.writeFileSync(P.app, fs.readFileSync(P.app, 'utf8').replace(P.keyRe, `$1${raw}$3`));
  }
  return raw;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const str = name => { const i = rest.indexOf('--' + name); if (i < 0) return undefined; if (rest[i + 1] === undefined) throw new Error(`--${name} needs a value`); return rest[i + 1]; };
  const num = name => { const v = str(name); if (v === undefined) return undefined; if (!/^\d+$/.test(v)) throw new Error(`--${name} takes a build number`); return Number(v); };
  const which = str('platform') || 'all';
  const platforms = which === 'all' ? enabledPlatforms() : [which];
  if (!platforms.length) throw new Error('No app has page updates built in (PageUpdates.swift / PageUpdates.kt are missing)');
  for (const p of platforms) {
    if (!PLATFORMS[p]) throw new Error('--platform is ios, android or all');
    if (!fs.existsSync(PLATFORMS[p].app)) throw new Error(`The ${PLATFORMS[p].name} app in this checkout has no page updates (${path.relative(ROOT, PLATFORMS[p].app)} is missing)`);
  }
  const min = num('min'), max = num('max'), outArg = str('out');
  if ((min !== undefined || max !== undefined) && platforms.length > 1) throw new Error('--min and --max are build numbers of one app: add --platform ios or --platform android');
  if (outArg && (platforms.length > 1 || which === 'all')) throw new Error('--out is one app\'s folder: add --platform ios or --platform android');
  const dirOf = p => (outArg ? path.resolve(outArg) : outDir(p));

  if (cmd === 'keygen') {
    const raw = keygen();
    console.log(`Signing key: ${KEY_FILE} (keep a copy somewhere safe: without it no page update can be published until store builds with a new key)`);
    console.log(`Public key ${raw} written into ${enabledPlatforms().map(p => path.relative(ROOT, PLATFORMS[p].app)).join(' and ')}. It takes effect in the next store builds.`);
  } else if (cmd === 'publish' || cmd === 'off' || cmd === 'rollback') {
    const pageArg = str('page'), to = str('to');
    // check everything first, so a refusal leaves every platform as it was
    const jobs = platforms.map(p => {
      const job = { platform: p, off: cmd === 'off', min: min ?? PLATFORMS[p].first, max };
      if (cmd === 'rollback') { const prev = previousPage(p, to, ROOT, dirOf(p)); job.page = prev.page; job.commit = prev.from; }
      else if (pageArg) job.pagePath = path.resolve(pageArg);
      if (job.max === undefined && appBuild(p) < job.min) {
        const P = PLATFORMS[p], below = min !== undefined ? '--min ' + min : `the first ${P.name} ${P.unit} with page updates (${P.first})`;
        throw new Error(`${path.relative(ROOT, P.project)} is at ${P.unit} ${appBuild(p)}, older than ${below}. Give --platform ${p} and --max.`);
      }
      return job;
    });
    for (const job of jobs) {
      const P = PLATFORMS[job.platform], out = dirOf(job.platform);
      let tmp;
      if (job.page) { tmp = path.join(os.tmpdir(), `mitosis-rollback-${process.pid}-${job.platform}.html`); fs.writeFileSync(tmp, job.page); job.pagePath = tmp; }
      let m;
      try { m = publish({ platform: job.platform, out, off: job.off, min: job.min, max: job.max, pagePath: job.pagePath, commit: job.commit }); }
      finally { if (tmp) fs.rmSync(tmp, { force: true }); }
      const errs = verify(m, m.sha256 ? fs.readFileSync(path.join(out, 'page.html')) : null, appKey(job.platform), job.platform);
      if (errs.length) { console.error(`Published for ${P.name}, but it would be refused by the app:\n  ` + errs.join('\n  ')); process.exit(1); }
      console.log(m.sha256 ? `${P.name} page update ${m.v} (${(m.size / 1024).toFixed(0)} KB, ${m.commit || 'no commit'}) for ${P.unit}s ${m.minBuild}–${m.maxBuild} is in ${path.relative(process.cwd(), out) || '.'}/.`
        : `${P.name} update ${m.v} sends ${P.unit}s ${m.minBuild}–${m.maxBuild} back to the page built into the app.`);
    }
    if (!outArg) console.log('Commit updates/ and deploy the server. Apps download it when they next open and show it on the launch after.');
  } else if (cmd === 'check') {
    let bad = 0;
    for (const p of platforms) {
      const P = PLATFORMS[p], out = dirOf(p);
      let m;
      try { m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')); } catch (e) { console.log(`${P.name}: no page update published (updates/${p}/manifest.json is missing).`); continue; }
      const page = fs.existsSync(path.join(out, 'page.html')) ? fs.readFileSync(path.join(out, 'page.html')) : null;
      const errs = verify(m, page, appKey(p), p);
      if (errs.length) { console.error(`${P.name} update ${m.v} would be refused:\n  ` + errs.join('\n  ')); bad++; continue; }
      console.log(`${P.name} update ${m.v} is valid: ${m.sha256 ? 'a page of ' + m.size + ' bytes' : 'back to the built-in page'} for ${P.unit}s ${m.minBuild}–${m.maxBuild}, published ${m.published || '?'} from ${m.commit || '?'}.`);
    }
    if (bad) process.exit(1);
  } else {
    const lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(1);
    console.log(lines.slice(0, lines.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 1 : 0);
  }
}

module.exports = { message, verify, publish, previousPage, rawToKey, keyToRaw, appKey, appBuild, enabledPlatforms, PLATFORMS, FIRST_BUILD };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
