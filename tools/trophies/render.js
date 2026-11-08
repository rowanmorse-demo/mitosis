// Renders the nine rank trophies (scene.js) in headless Chrome and, with --bake, puts them into index.html.
//   npm install --prefix tools/trophies        (three.js and esbuild, once)
//   node tools/trophies/render.js [--bake] [--size=400x500] [--crest=200] [--q=0.82] [--out=DIR]
// Writes DIR/<step>.png/.webp (trophies), DIR/crest-<step>.png/.webp and DIR/sheet.png (all of them on the Profile's dark, then grey);
// DIR defaults to tools/trophies/out.
// --bake replaces the trophy-art block in index.html with the WebP pictures, where the trophies' orbs are and the crests' gem sockets. TROPHY_NODE_MODULES can point at another three install.
'use strict';
const { spawn, execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const opt = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--(\w+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const [W, H] = String(opt.size || '400x500').split('x').map(Number), Q = +(opt.q || 0.82), CS = +(opt.crest || 200), OUT = path.resolve(opt.out || path.join(__dirname, 'out'));
const NM = process.env.TROPHY_NODE_MODULES || path.join(__dirname, 'node_modules');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9400 + Math.floor(Math.random() * 80);
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.w = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') console.log('PAGE EXCEPTION:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled') console.log('page:', m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.id && this.w.has(m.id)) { const { res, rej } = this.w.get(m.id); this.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.w.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
}
(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trophies-')); fs.mkdirSync(OUT, { recursive: true });
  execFileSync(path.join(NM, '.bin', 'esbuild'), [path.join(__dirname, 'entry.js'), '--bundle', '--minify', '--format=iife', '--log-level=warning', '--outfile=' + path.join(work, 'three.js')], { env: { ...process.env, NODE_PATH: NM }, stdio: 'inherit' });
  fs.copyFileSync(path.join(__dirname, 'scene.js'), path.join(work, 'scene.js'));
  fs.writeFileSync(path.join(work, 'render.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent"><script src="three.js"></script><script src="scene.js"></script>');
  const profile = path.join(work, 'chrome');
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { chrome.kill('SIGKILL'); process.exit(1); });
  try {
    let v = null; for (let i = 0; i < 150 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch (e) { await sleep(200); } }
    if (!v) throw new Error('Chrome did not start');
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws); await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: 'file://' + path.join(work, 'render.html') });
    for (let i = 0; i < 100 && !(await cdp.eval('typeof renderTrophy==="function"').catch(() => false)); i++) await sleep(200);
    const steps = await cdp.eval('TROPHY_STEPS.map(s=>s.key)'), art = {}, orb = {};
    await cdp.eval('window.__shots=[]');
    for (let fi = 0; fi < steps.length; fi++) {
      const t0 = Date.now();
      const r = await cdp.eval(`(()=>{const r=renderTrophy(${fi},${W},${H});__shots.push(r.canvas);return{webp:r.canvas.toDataURL('image/webp',${Q}),png:r.canvas.toDataURL('image/png'),orb:r.orb}})()`);
      const k = steps[fi], webp = Buffer.from(r.webp.split(',')[1], 'base64');
      fs.writeFileSync(path.join(OUT, k + '.webp'), webp); fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
      art[k] = r.webp; orb[k] = r.orb.map(n => +n.toFixed(4)); console.log(k.padEnd(12), (webp.length / 1024).toFixed(1) + ' KB', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    }
    const crest = {}, gems = {}; await cdp.eval('window.__crests=[]');
    for (let fi = 0; fi < steps.length; fi++) {
      const r = await cdp.eval(`(()=>{const r=renderCrest(${fi},${CS});__crests.push(r.canvas);return{webp:r.canvas.toDataURL('image/webp',${Q}),png:r.canvas.toDataURL('image/png'),gems:r.gems,gr:r.gr}})()`);
      const k = steps[fi], webp = Buffer.from(r.webp.split(',')[1], 'base64');
      fs.writeFileSync(path.join(OUT, 'crest-' + k + '.webp'), webp); fs.writeFileSync(path.join(OUT, 'crest-' + k + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
      crest[k] = r.webp; gems[k] = r.gems.length ? [r.gr, ...r.gems] : []; console.log(('crest ' + k).padEnd(18), (webp.length / 1024).toFixed(1) + ' KB');
    }
    // the contact sheet: on the Profile's dark card, then on a light grey to check the edges
    const sheet = await cdp.eval(`(()=>{const W=${W},H=${H},S=${CS},c=document.createElement('canvas');c.width=W*9;c.height=(H+S)*2;const x=c.getContext('2d');
      x.fillStyle='#0c1414';x.fillRect(0,0,c.width,H+S);x.fillStyle='#8b9898';x.fillRect(0,H+S,c.width,H+S);
      __shots.forEach((s,i)=>{x.drawImage(s,i*W,0);x.drawImage(s,i*W,H+S);});__crests.forEach((s,i)=>{x.drawImage(s,i*W+(W-S)/2,H);x.drawImage(s,i*W+(W-S)/2,2*H+S);});return c.toDataURL('image/png')})()`);
    fs.writeFileSync(path.join(OUT, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
    const total = [...Object.values(art), ...Object.values(crest)].reduce((n, s) => n + s.length, 0); console.log('orbs', JSON.stringify(orb), '\ngems', JSON.stringify(gems), '\ndata URLs', (total / 1024).toFixed(0) + ' KB');
    if (opt.bake) {
      const file = path.join(__dirname, '..', '..', 'index.html'), html = fs.readFileSync(file, 'utf8'), a = '/* trophy-art:begin */', b = '/* trophy-art:end */', i = html.indexOf(a), j = html.indexOf(b);
      if (i < 0 || j < i) throw new Error('index.html has no ' + a + ' … ' + b + ' block');
      const block = a + '\nconst TROPHY_ART={' + steps.map(k => `${k}:'${art[k]}'`).join(',\n') + `},TROPHY_ORB=${JSON.stringify(orb)},\nCREST_ART={` + steps.map(k => `${k}:'${crest[k]}'`).join(',\n')
        + `},CREST_GEMS=${JSON.stringify(gems)}; // gems: [socket radius, ...socket centres], as fractions of the picture\n`;
      fs.writeFileSync(file, html.slice(0, i) + block + html.slice(j)); console.log('baked into index.html');
    }
    ws.close();
  } finally { chrome.kill('SIGKILL'); setTimeout(() => fs.rmSync(work, { recursive: true, force: true }), 400); }
})().catch(e => { console.error('render failed:', e.message); process.exit(1); });
