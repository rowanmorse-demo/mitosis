// Headless checks for Facet Studio (studio/index.html): the subdivision kernel, edit-mode operations, keyboard
// transforms, sculpting with undo, project round-trips and every export format.
// Usage: node tools/studio-test.js            (needs Playwright: npm i -g playwright, about 1 minute)
//        STUDIO_LIBS=/path/to/node_modules node tools/studio-test.js
//          serves three, three-mesh-bvh and three-gpu-pathtracer from a local install instead of cdn.jsdelivr.net
//          (npm i --no-save three@0.186.1 three-mesh-bvh@0.9.16 three-gpu-pathtracer@0.0.27 --legacy-peer-deps)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright is needed: npm i -g playwright (or run with NODE_PATH pointing at it)'); process.exit(2); }
const PAGE = 'file://' + path.join(__dirname, '..', 'studio', 'index.html');
const LIBS = process.env.STUDIO_LIBS;
const MAP = [['three@0.186.1/', 'three/'], ['three-mesh-bvh@0.9.16/', 'three-mesh-bvh/'], ['three-gpu-pathtracer@0.0.27/', 'three-gpu-pathtracer/']];
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (LIBS) await page.route('https://cdn.jsdelivr.net/npm/**', route => {
    const rest = route.request().url().split('/npm/')[1];
    for (const [pre, dir] of MAP) if (rest.startsWith(pre)) {
      const f = path.join(LIBS, dir, rest.slice(pre.length).split('?')[0]);
      if (fs.existsSync(f)) return route.fulfill({ body: fs.readFileSync(f), contentType: 'application/javascript' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__facetReady === true, null, { timeout: 60000 });
  ok(true, 'Studio starts');

  const k = await page.evaluate(() => {
    const F = window.__facet, out = {};
    const closed = m => { const d = new Set(); let dup = 0; for (const f of m.f) for (let i = 0; i < f.length; i++) { const e = f[i] + '>' + f[(i + 1) % f.length]; if (d.has(e)) dup++; d.add(e); } let open = 0; for (const e of d) { const [a, b] = e.split('>'); if (!d.has(b + '>' + a)) open++; } return dup + open === 0; };
    let M = F.catmullClark(F.toFlat(F.Prims.cube({ size: 2 })));
    out.l1 = [M.nv, M.nf]; out.corner = M.v[18]; out.l1closed = closed(F.flatToCage(M));
    const c = F.Prims.cube({ size: 2 }); for (const key of F.cageEdges(c).keys()) c.cr.set(key, 1);
    const C = F.catmullClark(F.catmullClark(F.toFlat(c))); let mx = 0; for (const x of C.v) mx = Math.max(mx, Math.abs(x));
    out.creasedMax = mx;
    out.prims = Object.keys(F.PRIM_DEFS).filter(t => !['plane', 'grid', 'backdrop'].includes(t)).filter(t => !closed(F.PRIM_DEFS[t].make({ ...F.PRIM_DEFS[t].params })));
    return out;
  });
  ok(k.l1[0] === 26 && k.l1[1] === 24 && k.l1closed, 'Catmull-Clark: cube → 26 verts, 24 faces, closed');
  ok(Math.abs(k.corner - 5 / 9) < 1e-12, 'Catmull-Clark corner rule (5/9)');
  ok(Math.abs(k.creasedMax - 1) < 1e-12, 'Fully creased edges keep the cube exact');
  ok(k.prims.length === 0, 'Every closed primitive is watertight with consistent winding ' + (k.prims.join() || ''));

  const e = await page.evaluate(() => {
    const F = window.__facet, out = {};
    F.run('add.cube'); const o = F.sel.obj, m = () => o.userData.cage;
    F.setMode('edit'); F.setSelectMode('face');
    F.edit.sf = new Set([m().f.findIndex(f => f.every(i => m().v[i * 3 + 1] > 0))]);
    F.run('mesh.extrude'); out.extrude = [m().v.length / 3, m().f.length];
    F.run('mesh.inset'); out.inset = [m().v.length / 3, m().f.length];
    F.History.undo(); F.History.undo(); out.undo = [m().v.length / 3, m().f.length];
    const [a, b] = [...F.cageEdges(m()).values()][0]; F.cutRing(m(), F.edgeRing(m(), a, b)); out.cut = m().f.length;
    F.setMode('object');
    return out;
  });
  ok(e.extrude.join() === '12,10', 'Extrude a face (' + e.extrude + ')');
  ok(e.inset.join() === '16,14', 'Inset a face (' + e.inset + ')');
  ok(e.undo.join() === '8,6', 'Undo restores the cube (' + e.undo + ')');
  ok(e.cut === 10, 'Loop cut around a cube adds 4 faces');

  await page.evaluate(() => window.__facet.run('add.uvsphere'));
  const x0 = await page.evaluate(() => window.__facet.sel.obj.position.x);
  await page.mouse.move(700, 400); await page.mouse.move(706, 404);
  await page.keyboard.press('g'); await page.mouse.move(760, 420); await page.keyboard.press('x'); await page.keyboard.type('2'); await page.keyboard.press('Enter');
  ok(Math.abs(await page.evaluate(() => window.__facet.sel.obj.position.x) - x0 - 2) < 1e-9, 'G X 2 Enter moves exactly 2 units');

  await page.evaluate(() => { const F = window.__facet; F.scene.children.forEach(c => { if (c.userData.kind === 'mesh') c.visible = false; }); F.run('add.sculptball'); F.frameObjects([F.sel.obj]); });
  await page.waitForTimeout(700);
  await page.keyboard.press('Shift+Tab');
  const before = await page.evaluate(() => Array.from(window.__facet.sel.obj.userData.cage.v));
  const r = await page.evaluate(() => { const b = document.querySelector('#c').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(r.x - 60, r.y); await page.mouse.down();
  for (let i = 0; i <= 12; i++) await page.mouse.move(r.x - 60 + i * 10, r.y + Math.sin(i / 2) * 20);
  await page.mouse.up(); await page.waitForTimeout(200);
  const after = await page.evaluate(() => Array.from(window.__facet.sel.obj.userData.cage.v));
  ok(after.some((v, i) => Math.abs(v - before[i]) > 1e-6), 'A sculpt stroke moves vertices');
  await page.keyboard.press('Control+z');
  const undone = await page.evaluate(() => Array.from(window.__facet.sel.obj.userData.cage.v));
  ok(undone.every((v, i) => Math.abs(v - before[i]) < 1e-5), 'Undo restores the sculpt');
  await page.keyboard.press('Shift+Tab');

  const rt = await page.evaluate(async () => { const F = window.__facet, a = F.serializeProject(); await F.loadProject(JSON.parse(JSON.stringify(a))); return JSON.stringify(a.objects) === JSON.stringify(F.serializeProject().objects); });
  ok(rt, 'Project save → open round-trips exactly');
  const quads = (await page.evaluate(() => window.__facet.exportOBJ())).split('\n').filter(l => /^f( \d+){4}$/.test(l)).length;
  ok(quads > 100, 'OBJ export keeps quads (' + quads + ')');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-'));
  for (const [id, ext] of [['export.glb', '.glb'], ['export.obj', '.obj'], ['export.stl', '.stl'], ['export.usdz', '.usdz'], ['export.ply', '.ply'], ['file.save', '.facet.json']]) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }).catch(() => null), page.evaluate(i => window.__facet.run(i), id)]);
    if (!dl) { ok(false, id + ' downloads a file'); continue; }
    const p = path.join(tmp, 'out' + ext); await dl.saveAs(p);
    ok(dl.suggestedFilename().endsWith(ext) && fs.statSync(p).size > 1000, `${id} → ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
  }
  ok(errors.length === 0, 'No page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
