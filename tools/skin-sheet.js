// Contact sheet of premium skins, for judging skin art without a phone: each skin large (shop size), as a Skins tile,
// and at in-game sizes, on the game's background. Uses tools/snap.js (headless Chrome), so run one at a time.
// node tools/skin-sheet.js OUT.png [--ids=5,6,7] [--html=index.html] [--cols=3] [--big=260]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const [out, ...rest] = process.argv.slice(2);
if (!out) { console.error('usage: node tools/skin-sheet.js OUT.png [--ids=5,6,7] [--html=index.html] [--cols=3] [--big=260]'); process.exit(2); }
const opt = Object.fromEntries(rest.map(a => { const m = a.match(/^--(\w+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const src = path.resolve(opt.html || path.join(__dirname, '..', 'index.html'));
let html = fs.readFileSync(src, 'utf8');
const hook = 'if(/[?&]debug=1/.test(location.search))window.__mt={';
if (html.split(hook).length !== 2) { console.error('skin-sheet: debug hook not found in ' + src); process.exit(1); }
html = html.replace(hook, 'window.__skins={get PREMIUM(){return PREMIUM;},drawPreview};' + hook);
const tmp = path.join(path.dirname(src), `.skin-sheet-${process.pid}.html`); // next to the original, so relative assets resolve
fs.writeFileSync(tmp, html);
const ids = opt.ids ? String(opt.ids).split(',').map(Number) : null, cols = +(opt.cols || 3), big = +(opt.big || 260);
const cellW = big + 40, rows = Math.ceil((ids ? ids.length : 27) / cols), W = cols * cellW + 20, H = rows * (big + 190) + 20;
const js = `(async()=>{const S=window.__skins;if(!S)return 'no hook';const ids=${JSON.stringify(ids)};
  const list=S.PREMIUM.filter(s=>!ids||ids.includes(s.id));
  const o=document.createElement('div');o.style.cssText='position:fixed;inset:0;z-index:99999;overflow:hidden;background:radial-gradient(120% 90% at 50% 0%,#14262a,#060b0d);display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:0;padding:10px;font:600 15px system-ui;color:#cfe';
  document.body.appendChild(o);
  for(const s of list){const d=document.createElement('div');d.style.cssText='display:grid;justify-items:center;gap:6px;padding:8px 0 14px';
    d.innerHTML='<div>'+s.id+' '+s.name+'</div>';const mk=px=>{const c=document.createElement('canvas');c.style.cssText='width:'+px+'px;height:'+px+'px';return c;};
    const b=mk(${big});d.appendChild(b);const row=document.createElement('div');row.style.cssText='display:flex;gap:14px;align-items:center';
    const sm=[88,48,28,16].map(mk);sm.forEach(c=>row.appendChild(c));d.appendChild(row);o.appendChild(d);
    await new Promise(r=>requestAnimationFrame(r));[b,...sm].forEach(c=>S.drawPreview(c,s));}
  return list.length;})()`;
try {
  execFileSync('node', [path.join(__dirname, 'snap.js'), 'file://' + tmp + '?server=http://127.0.0.1:9', path.resolve(out), `--w=${W}`, `--h=${H}`, '--dpr=2', '--wait=2500', '--js=' + js, '--after=800'], { stdio: 'inherit' });
} finally { fs.rmSync(tmp, { force: true }); }
