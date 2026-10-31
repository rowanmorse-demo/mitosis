// Films the takes in takes.js: real gameplay, played by the pilot through the touch controls, rendered
// deterministically in headless Chrome one 1/60 s frame at a time (so it is smooth however busy the machine is).
//   node promo/capture.js                 every take at 2560×1440 into promo/.work/takes/<id>/
//   node promo/capture.js --only=chain    just those takes (comma-separated)
//   node promo/capture.js --preview       768×432, quick, into promo/.work/preview/<id>/ (same gameplay, frame for frame)
//   --every=N   keep every Nth frame only (fast checks)      --frames=N   stop after N recorded frames
// Each take folder gets frames/000000.jpg… and meta.json: per-frame track (where the hero is on screen, speed),
// marks the take set (split1, kill…), and the log of every sfx(kind, amount) the game played, by frame.
'use strict';
const fs = require('fs'), path = require('path');
const { launch } = require('./lib/chrome'), clock = require('./lib/clock'), { buildGamePage, ROOT } = require('./lib/game'), { ensureFonts } = require('./lib/fonts');
const econ = require(path.join(ROOT, 'economy.js'));
const TAKES = require('./takes');

const arg = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--(\w+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const PREVIEW = !!arg.preview, EVERY = +arg.every || 1, MAXF = +arg.frames || Infinity;
const VIEW = { w: 768, h: 432 }, DSF = PREVIEW ? 1 : 10 / 3; // 768×432 CSS px (a phone in landscape) → 2560×1440
const WORK = path.join(__dirname, '.work'), OUT = path.join(WORK, PREVIEW ? 'preview' : 'takes');
const EPOCH = Date.parse('2026-10-30T19:30:00'); // inside the Halloween season, so its skins and banner are live
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PILOT = fs.readFileSync(path.join(__dirname, 'pilot.js'), 'utf8');

// what the economy API answers (the server's own catalog, a wallet that owns the skins on show)
function fakeApi(tk) {
  const catalog = JSON.parse(JSON.stringify(econ.catalog()));
  for (const k in catalog.seasons) catalog.seasons[k].open = true;
  const w = { playerId: 'promo0000000000', balance: 4850, earned: 31200, skins: [13, 15, 17, 18, 21, 22, 23, 24, 25, 26, 27], rating: 1388, tier: 'Gold', runs: 214, account: null };
  const end = tk.result || { payout: 25, rating: 1412, ratingDelta: 24 };
  return {
    session: { ...w, catalog },
    'run/start': { runId: 'promo-run' },
    'run/end': { ...w, balance: w.balance + end.payout, earned: w.earned + end.payout, rating: end.rating, tier: econ.tierOf(end.rating), runs: w.runs + 1, payout: end.payout, ratingDelta: end.ratingDelta },
  };
}
function storage(tk) {
  const settings = { name: tk.name || 'Juno', stain: tk.stain || 0, diff: 'standard', skin: tk.skin || 0, lowFx: false, boardMin: !tk.board, botSkill: 'normal', hudStatsMini: false, hudClockMini: false };
  const ls = {
    'mitosis.intro': '1', 'mitosis.settings': JSON.stringify(settings), 'mitosis.tipRuns': '99', 'mitosis.muted': '0',
    'mitosis.tips': JSON.stringify(['move', 'split', 'merge', 'virus', 'arena', 'pause']),
    'mitosis.ach': JSON.stringify(['first', 'm500', 'm2000', 'rank1', 'surv5', 'frenzy5', 'hunter', 'lysis', 'bounty', 'levi', 'evolve', 'bloom']),
    'mitosis.secret': 'promo0capture0secret0000000000', 'mitosis.best': '6120',
  };
  return `try{localStorage.clear();const o=${JSON.stringify(ls)};for(const k in o)localStorage.setItem(k,o[k]);}catch(e){}`;
}
const fnSrc = f => f ? '(' + f.toString() + ')' : 'null';

async function film(browser, tk) {
  const dir = path.join(OUT, tk.id), fdir = path.join(dir, 'frames');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(fdir, { recursive: true });
  const s = await browser.newPage();
  try {
    await s.send('Page.enable'); await s.send('Runtime.enable');
    await s.send('Emulation.setDeviceMetricsOverride', { width: VIEW.w, height: VIEW.h, deviceScaleFactor: DSF, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: clock({ seed: tk.seed, epoch: EPOCH, api: fakeApi(tk) }) });
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: storage(tk) });
    await s.send('Page.navigate', { url: 'file://' + GAME + '?server=http://127.0.0.1:9&debug=1' });
    for (let i = 0; ; i++) {
      if (await s.eval("document.readyState==='complete'&&!!window.__mt&&!!window.__vt").catch(() => false)) break;
      if (i > 600) throw new Error('page did not load'); await sleep(200);
    }
    const fonts = await s.eval(`Promise.all(['400 16px "Bricolage Grotesque"','600 16px "Bricolage Grotesque"','800 16px "Bricolage Grotesque"','700 16px "Bricolage Grotesque"',
      '400 12px "IBM Plex Mono"','500 12px "IBM Plex Mono"','600 12px "IBM Plex Mono"'].map(f=>document.fonts.load(f).catch(()=>[]))).then(()=>document.fonts.check('800 16px "Bricolage Grotesque"')&&document.fonts.check('500 12px "IBM Plex Mono"'))`);
    if (!fonts) console.warn('  warning: the game fonts did not load (no network?)');
    await s.eval(PILOT);
    await s.eval(`__promo.setTake({id:${JSON.stringify(tk.id)},brain:${fnSrc(tk.brain)}})`);
    for (let i = 0; i < 90; i++) { // lobby: wait until the live room has given up (offline) and the wallet has loaded
      await s.eval('__promo.frame()');
      if (i > 5 && await s.eval("__mitosisNet.state==='offline'&&__promo.G.wallet.online")) break;
    }
    await s.eval(`(()=>{const {G,P,S}=__promo;G.startLocal('auto');S.calm();S.dressBots(${tk.seed | 0});S.clearToasts();S.clearFeed();${fnSrc(tk.setup)}(G,P,S);return 1})()`);
    for (let i = 0; i < (tk.preroll || 0); i++) await s.eval('__promo.frame()');
    await s.eval('__promo.resetLog()');
    const track = [], total = Math.min(tk.frames, MAXF), writes = [];
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      const m = await s.eval('__promo.frame(true)'); track.push(m);
      if (i % EVERY === 0) {
        const shot = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: PREVIEW ? 82 : 93, optimizeForSpeed: true });
        writes.push(fs.promises.writeFile(path.join(fdir, String(i).padStart(6, '0') + '.jpg'), Buffer.from(shot.data, 'base64')));
        if (writes.length > 24) await Promise.all(writes.splice(0));
      }
      if (arg.log && i % (+arg.logEvery || 10) === 0) console.log('   ', i, JSON.stringify(await s.eval(`(()=>{const {G,P,S}=__promo;return (${arg.log})})()`)));
      if (i % 120 === 119) { const el = (Date.now() - t0) / 1000; process.stdout.write(`  ${tk.id}: ${i + 1}/${total} frames, ${(el / (i + 1) * 1000).toFixed(0)} ms/frame, mass ${m.m}, mode ${m.mode}\n`); }
      if (tk.stopWhen && m.stop) break;
    }
    await Promise.all(writes);
    const sfx = await s.eval('__promo.sfx()'), marks = await s.eval('__promo.marks()');
    const meta = { id: tk.id, fps: 60, view: VIEW, dsf: DSF, size: [Math.round(VIEW.w * DSF), Math.round(VIEW.h * DSF)], every: EVERY, frames: track.length, marks, sfx, track };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    console.log(`  ${tk.id}: ${track.length} frames, ${sfx.length} sounds, marks ${marks.map(m => m.name + '@' + m.f).join(' ') || '-'}`);
  } finally { await s.close(); }
}

let GAME;
(async () => {
  const only = arg.only ? String(arg.only).split(',') : null;
  const list = TAKES.filter(t => !only || only.includes(t.id));
  if (!list.length) throw new Error('no takes match ' + arg.only);
  await ensureFonts(WORK);
  GAME = buildGamePage(path.join(WORK, 'game.html'));
  console.log(`capture: ${list.map(t => t.id).join(', ')} at ${Math.round(VIEW.w * DSF)}×${Math.round(VIEW.h * DSF)}${PREVIEW ? ' (preview)' : ''}`);
  const browser = await launch({ gpu: true });
  try { for (const tk of list) { const t0 = Date.now(); await film(browser, tk); console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`); } }
  finally { browser.close(); }
})().catch(e => { console.error('capture failed:', e.stack || e.message); process.exitCode = 1; require('./lib/chrome').killCurrent(); });
