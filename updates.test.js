// Remote page updates: signing (tools/page-update.js), what the app accepts, and the server route. Run:  node updates.test.js
'use strict';
const { spawn, execFileSync } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert'), crypto = require('crypto');
const pu = require('./tools/page-update');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-updates-'));
const out = path.join(tmp, 'updates', 'ios'), keyFile = path.join(tmp, 'key.pem');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const pub = pu.keyToRaw(publicKey);
const other = pu.keyToRaw(crypto.generateKeyPairSync('ed25519').publicKey);
const pageFile = path.join(tmp, 'page.html');
fs.writeFileSync(pageFile, "<script>Native.send({type:'booted'});</script>");
const read = () => [JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')), fs.existsSync(path.join(out, 'page.html')) ? fs.readFileSync(path.join(out, 'page.html')) : null];

/* ---------- the game page can be published ---------- */
const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(index.slice(-400), /Native\.send\(\{type:'booted'\}\);\n\}\)\(\);\n<\/script>/, "index.html's script ends by telling the app it booted");

/* ---------- the app signs and checks the same text ---------- */
const swift = fs.readFileSync(path.join(__dirname, 'ios', 'Mitosis', 'PageUpdates.swift'), 'utf8');
const block = swift.match(/var message: String \{([\s\S]*?)\.joined\(separator: "\\n"\)/)[1];
const sample = { v: 7, minBuild: 11, maxBuild: 12, sha256: 'ab'.repeat(32), size: 123 };
const swiftText = [...block.matchAll(/"([^"]*)"/g)].map(m => m[1].replace(/\\\((?:PageUpdates\.)?(\w+)\)/g, (_, k) => k === 'platform' ? 'ios' : sample[k])).join('\n');
assert.equal(swiftText, pu.message(sample), 'PageUpdates.swift signs-checks exactly the text the tool signs');
assert.match(swift, /static let publicKey = "[A-Za-z0-9+\/=]{44}"/, 'the app has a 32-byte public key built in');

/* ---------- publishing ---------- */
let m = pu.publish({ out, pagePath: pageFile, keyFile, min: 11, max: 12 });
let [onDisk, page] = read();
assert.equal(m.v, 1, 'the first update is version 1');
assert.deepEqual([onDisk.minBuild, onDisk.maxBuild, onDisk.size], [11, 12, page.length]);
assert.deepEqual(pu.verify(onDisk, page, pub), [], 'a fresh update verifies');
assert.ok(crypto.verify(null, Buffer.from(pu.message(onDisk)), publicKey, Buffer.from(onDisk.sig, 'base64')), 'the signature is plain Ed25519 over the message');

assert.ok(pu.verify(onDisk, page, other).some(e => /signature/.test(e)), 'another key is refused');
assert.ok(pu.verify({ ...onDisk, v: 99 }, page, pub).some(e => /signature/.test(e)), 'a changed version breaks the signature');
assert.ok(pu.verify({ ...onDisk, maxBuild: 99 }, page, pub).some(e => /signature/.test(e)), 'a widened build range breaks the signature');
assert.ok(pu.verify(onDisk, Buffer.concat([page, Buffer.from(' ')]), pub).length >= 2, 'a changed page fails size and hash');
assert.ok(pu.verify(onDisk, Buffer.from(page.toString().replace('booted', 'b00ted')), pub).some(e => /sha256/.test(e)), 'same size, other bytes: hash fails');
assert.ok(pu.verify({ ...onDisk, sig: '' }, page, pub).length, 'no signature is refused');
assert.ok(pu.verify(onDisk, page, '').some(e => /no public key/.test(e)), 'an app without a key takes nothing');

m = pu.publish({ out, pagePath: pageFile, keyFile, min: 11, max: 11 });
assert.equal(m.v, 2, 'each publish counts up, so apps never go back to an older one');
assert.deepEqual(pu.verify(...read(), pub), []);

m = pu.publish({ out, keyFile, min: 11, max: 11, off: true });
[onDisk, page] = read();
assert.deepEqual([onDisk.v, onDisk.sha256, onDisk.size, page], [3, '', 0, null], '"off" is a signed update with no page');
assert.deepEqual(pu.verify(onDisk, null, pub), []);

const bad = path.join(tmp, 'bad.html'); fs.writeFileSync(bad, '<p>no script</p>');
assert.throws(() => pu.publish({ out, pagePath: bad, keyFile, max: 11 }), /booted/, 'a page that never boots is refused before it ships');
assert.throws(() => pu.publish({ out, pagePath: pageFile, keyFile, min: 12, max: 11 }), /build range/);
assert.throws(() => pu.publish({ out, pagePath: pageFile, keyFile: path.join(tmp, 'nokey.pem'), max: 11 }), /keygen/);
assert.equal(read()[0].v, 3, 'refused publishes leave the last update alone');

/* ---------- Android: the same key, its own signed text ---------- */
const androidOut = path.join(tmp, 'android-out');
const am = pu.publish({ platform: 'android', out: androidOut, pagePath: pageFile, keyFile, min: 10, max: 10 });
const androidPage = fs.readFileSync(path.join(androidOut, 'page.html'));
assert.match(pu.message(am, 'android'), /^mitosis-page-update\/1\nplatform=android\nv=1\n/, 'Android updates count from 1 in their own folder');
assert.deepEqual(pu.verify(am, androidPage, pub, 'android'), [], 'an Android update verifies as Android');
assert.ok(pu.verify(am, androidPage, pub, 'ios').some(e => /signature/.test(e)), 'an Android update is no good to the iOS app');
assert.ok(pu.verify(onDisk, null, pub, 'android').some(e => /signature/.test(e)), 'and an iOS one is no good to Android');
assert.equal(pu.PLATFORMS.android.first, 10, 'Android page updates start with versionCode 10 (2.3.0)');
const kt = fs.existsSync(pu.PLATFORMS.android.app) ? fs.readFileSync(pu.PLATFORMS.android.app, 'utf8') : null;
if (kt) { // PageUpdates.kt is in this checkout: it must sign-check the same text and trust the same key as the iOS app
  const ktBlock = kt.match(/listOf\(("mitosis-page-update\/1"[\s\S]*?)\)\.joinToString\("\\n"\)/)[1];
  const ktText = [...ktBlock.matchAll(/"([^"]*)"/g)].map(m => m[1].replace(/\$(\w+)/g, (_, k) => k === 'PLATFORM' ? 'android' : sample[k])).join('\n');
  assert.equal(ktText, pu.message(sample, 'android'), 'PageUpdates.kt checks exactly the text the tool signs');
  assert.equal(pu.appKey('android'), pu.appKey('ios'), 'both apps trust the same key');
  assert.match(kt, /const val PLATFORM = "android"/);
}

/* ---------- rollback: the page that was out before, or index.html at a commit ---------- */
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-rollback-')), ro = path.join(repo, 'updates', 'ios'), repoPage = path.join(repo, 'index.html');
const g = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
g('init', '-q'); g('config', 'user.email', 'test@example.com'); g('config', 'user.name', 'test'); g('config', 'commit.gpgsign', 'false');
const commitPage = (tag, publishToo) => {
  fs.writeFileSync(repoPage, `<script>/*${tag}*/Native.send({type:'booted'});</script>`); g('add', '-A'); g('commit', '-qm', tag);
  if (publishToo) { pu.publish({ out: ro, pagePath: repoPage, keyFile, min: 11, max: 11 }); g('add', '-A'); g('commit', '-qm', 'publish ' + tag); }
  return g('rev-parse', '--short', 'HEAD');
};
const revA = commitPage('A', true);
assert.throws(() => pu.previousPage('ios', undefined, repo, ro), /No earlier iOS page/, 'one page out: nothing to roll back to');
commitPage('B', true);
commitPage('C', false); // committed, never published
assert.match(pu.previousPage('ios', undefined, repo, ro).page.toString(), /\/\*A\*\//, 'rollback goes back to the page out before this one');
pu.publish({ out: ro, keyFile, min: 11, max: 11, off: true }); g('add', '-A'); g('commit', '-qm', 'off');
assert.match(pu.previousPage('ios', undefined, repo, ro).page.toString(), /\/\*B\*\//, 'after "off", rollback brings back the last page that was out');
const toA = pu.previousPage('ios', revA, repo, ro);
assert.match(toA.page.toString(), /\/\*A\*\//, '--to <commit> takes index.html as it was then');
assert.equal(toA.from, revA);
const again = pu.publish({ out: ro, pagePath: (fs.writeFileSync(path.join(tmp, 'rb.html'), toA.page), path.join(tmp, 'rb.html')), keyFile, min: 11, max: 11, commit: toA.from });
assert.equal(again.v, 4, 'a rollback is a new, higher version, so apps that took B still move');
assert.equal(again.commit, revA, 'and it says where the page came from');
assert.throws(() => pu.previousPage('ios', 'no-such-rev', repo, ro), /No index.html at no-such-rev/);
assert.throws(() => pu.previousPage('ios', 'x; touch pwned', repo, ro), /--to takes/, 'only plain revision names reach git');
fs.rmSync(repo, { recursive: true, force: true });

/* ---------- the server hands out the files ---------- */
pu.publish({ out, pagePath: pageFile, keyFile, min: 11, max: 11 });
const PORT = 3600 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-updates-data-'));
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dataDir, UPDATES_DIR: path.join(tmp, 'updates') }, stdio: ['ignore', 'ignore', 'inherit'] });
(async () => {
  for (let i = 0; ; i++) { // up to 30 s: start-up is slow while the Mac is busy building
    if (child.exitCode != null) throw new Error('server exited at start-up (port ' + PORT + ' in use?)');
    try { if ((await fetch(base + '/health')).ok) break; } catch (e) { if (i > 300) throw e; }
    await new Promise(r => setTimeout(r, 100));
  }
  let r = await fetch(base + '/updates/ios/manifest.json');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  const served = await r.json();
  assert.equal(served.v, 4);
  r = await fetch(base + '/updates/ios/page.html');
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(pu.verify(served, body, pub), [], 'what the server sends verifies');
  for (const p of ['/updates/android/manifest.json', '/updates/ios/other.json', '/updates/ios/%2e%2e/%2e%2e/server.js', '/updates/web/manifest.json', '/updates/']) {
    assert.equal((await fetch(base + p)).status, 404, p + ' is not served');
  }
  fs.rmSync(path.join(out, 'manifest.json'));
  assert.equal((await fetch(base + '/updates/ios/manifest.json')).status, 404, 'nothing published: 404, and the app keeps its page');
  console.log('page updates: all checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dataDir, { recursive: true, force: true }); });
