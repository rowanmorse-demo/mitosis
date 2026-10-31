// Headless Chrome over the DevTools protocol, talking through --remote-debugging-pipe (no port to collide on).
// One browser at a time: launch() refuses a second. Chrome dies with this process however it ends: on exit, on
// SIGINT/SIGTERM/SIGHUP, on an uncaught error, and (because it runs in its own process group and reads from our
// pipe) even on SIGKILL, when the closed pipe makes Chrome shut itself down.
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let current = null;
function killCurrent() {
  if (!current) return;
  const { proc, profile } = current; current = null;
  try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) {}
  try { proc.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
let hooked = false;
function hookExit() {
  if (hooked) return; hooked = true;
  process.on('exit', killCurrent);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killCurrent(); process.exit(130); });
  process.on('uncaughtException', e => { console.error(e); killCurrent(); process.exit(1); });
  process.on('unhandledRejection', e => { console.error(e); killCurrent(); process.exit(1); });
}

class Session {
  constructor(browser, sessionId) { this.b = browser; this.id = sessionId; this.listeners = new Map(); }
  send(method, params = {}) { return this.b.send(method, params, this.id); }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(fn); }
  async eval(expr, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('page error: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }
}

class Browser {
  constructor(proc) {
    this.proc = proc; this.seq = 0; this.wait = new Map(); this.sessions = new Map(); this.buf = '';
    this.out = proc.stdio[3]; const inp = proc.stdio[4];
    inp.on('data', d => {
      this.buf += d.toString('utf8'); let i;
      while ((i = this.buf.indexOf('\0')) >= 0) { const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (s) this.dispatch(JSON.parse(s)); }
    });
    inp.on('error', () => {}); this.out.on('error', () => {});
  }
  dispatch(m) {
    if (m.id && this.wait.has(m.id)) {
      const { res, rej, method } = this.wait.get(m.id); this.wait.delete(m.id);
      m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result); return;
    }
    if (!m.method) return;
    const s = m.sessionId && this.sessions.get(m.sessionId);
    if (s) { for (const fn of s.listeners.get(m.method) || []) fn(m.params); }
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq, msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => { this.wait.set(id, { res, rej, method }); this.out.write(JSON.stringify(msg) + '\0'); });
  }
  // a page in its own browser context, so storage never leaks from one take into the next
  async newPage() {
    const { browserContextId } = await this.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const s = new Session(this, sessionId); this.sessions.set(sessionId, s);
    s.close = async () => { try { await this.send('Target.closeTarget', { targetId }); } catch (e) {} try { await this.send('Target.disposeBrowserContext', { browserContextId }); } catch (e) {} };
    let errs = 0;
    s.on('Runtime.consoleAPICalled', p => { if (p.type === 'error' && errs++ < 12) console.log('  page console.error:', p.args.map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ').split('\n').slice(0, 4).join(' | ')); });
    s.on('Runtime.exceptionThrown', p => { const d = p.exceptionDetails; console.log('  page exception:', ((d.exception && d.exception.description) || d.text || '').split('\n').slice(0, 3).join(' | ')); });
    return s;
  }
  close() { killCurrent(); }
}

async function launch({ args = [], gpu = false } = {}) {
  if (current) throw new Error('a Chrome is already running: one at a time');
  hookExit();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-promo-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-extensions', '--disable-sync', '--disable-component-update', '--metrics-recording-only', '--no-pings',
    ...(gpu ? [] : ['--disable-gpu']), ...args, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true });
  current = { proc, profile };
  proc.on('exit', () => { if (current && current.proc === proc) current = null; });
  const b = new Browser(proc);
  // the Mac this runs on is shared and can be very busy: give Chrome a long time to come up
  const t0 = Date.now();
  for (;;) {
    try { await Promise.race([b.send('Browser.getVersion'), new Promise((_, r) => setTimeout(() => r(new Error('slow')), 5000))]); break; }
    catch (e) { if (Date.now() - t0 > 180000) { killCurrent(); throw new Error('Chrome did not start'); } }
  }
  return b;
}
module.exports = { launch, killCurrent };
