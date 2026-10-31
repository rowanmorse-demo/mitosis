// The compositor page: one canvas the size of the output. edit.js hands it one frame spec at a time (which take
// frame, the crop, darkening, titles with their local time) and screenshots the result.
// Type is the game's own: Bricolage Grotesque 800 and IBM Plex Mono, in its colours (pink, ink, dark).
'use strict';
module.exports = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fonts.css">
<style>html,body{margin:0;background:#020809;overflow:hidden}canvas{display:block}</style></head><body><canvas id="c"></canvas><script>
const C = { pink: '#ff5c8a', ink: '#dcefe9', dark: '#020809', muted: '#9fc6bd' };
const DISPLAY = '"Bricolage Grotesque", system-ui, sans-serif', MONO = '"IBM Plex Mono", ui-monospace, monospace';
const cv = document.getElementById('c'), g = cv.getContext('2d', { alpha: false });
let W = 0, H = 0;
window.size = (w, h) => { W = cv.width = w; H = cv.height = h; cv.style.width = w + 'px'; cv.style.height = h + 'px'; return 1; };
const imgs = new Map();
function load(url) {
  if (imgs.has(url)) return imgs.get(url);
  const p = new Promise((res, rej) => { const i = new Image(); i.onload = () => i.decode().then(() => res(i), () => res(i)); i.onerror = () => rej(new Error('could not load ' + url)); i.src = url; });
  imgs.set(url, p); while (imgs.size > 6) imgs.delete(imgs.keys().next().value); return p;
}
const cl = (v, a, b) => v < a ? a : v > b ? b : v;
const E = { out3: x => 1 - Math.pow(1 - x, 3), out4: x => 1 - Math.pow(1 - x, 4), back: x => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); } };
const wide = () => W > H;
function shadow(on, size) { g.shadowColor = on ? 'rgba(0,0,0,.5)' : 'transparent'; g.shadowBlur = on ? size * .16 : 0; g.shadowOffsetY = on ? size * .035 : 0; }
// a line in the display face with its full stop in pink, centred on x; returns the width
function dline(text, x, y, size, track = -.03) {
  g.font = '800 ' + size + 'px ' + DISPLAY; g.letterSpacing = (track * size).toFixed(1) + 'px'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const dot = /[.!]$/.test(text) ? text.slice(-1) : '', body = dot ? text.slice(0, -1) : text;
  const bw = g.measureText(body).width, dw = dot ? g.measureText(dot).width : 0, x0 = x - (bw + dw) / 2;
  g.fillStyle = C.ink; g.fillText(body, x0, y); if (dot) { g.fillStyle = C.pink; g.fillText(dot, x0 + bw, y); }
  return bw + dw;
}
function fitSize(text, size, maxW, track = -.03) { g.font = '800 ' + size + 'px ' + DISPLAY; g.letterSpacing = (track * size).toFixed(1) + 'px'; const w = g.measureText(text).width; return w > maxW ? Math.floor(size * maxW / w) : size; }
const draw = {
  // one huge word: lands big and settles in a few frames, then pushes in very slowly
  slam(o) {
    const k = E.out4(cl(o.lt / .12, 0, 1)), s = (1.22 - .22 * k) * (1 + .035 * cl(o.lt / o.dur, 0, 1));
    const size = fitSize(o.text, Math.round(wide() ? H * .25 : W * .27), W * .86);
    g.save(); g.translate(W / 2, H / 2); g.scale(s, s); g.globalAlpha = cl(o.lt / .03, 0, 1); shadow(true, size);
    dline(o.text, 0, size * .34, size); g.restore();
  },
  // two or three big lines, each landing a beat-fraction after the last
  stack(o) {
    const n = o.lines.length, base = Math.round(wide() ? H * .18 : W * .2);
    const size = Math.min(...o.lines.map(l => fitSize(l, base, W * .86))), lh = size * .92, y0 = H / 2 - (n - 1) * lh / 2 + size * .34;
    o.lines.forEach((l, i) => {
      const lt = o.lt - i * .09; if (lt < 0) return; const k = E.out4(cl(lt / .12, 0, 1)), s = (1.2 - .2 * k) * (1 + .03 * cl(o.lt / o.dur, 0, 1));
      g.save(); g.translate(W / 2, y0 + i * lh); g.scale(s, s); g.globalAlpha = cl(lt / .03, 0, 1); shadow(true, size); dline(l, 0, 0, size); g.restore();
    });
  },
  // a mono kicker and a line, near the top (under the game's HUD bar) or the bottom
  caption(o) {
    const inK = E.out3(cl(o.lt / .2, 0, 1)), a = Math.min(cl(o.lt / .08, 0, 1), cl((o.dur - o.lt) / .14, 0, 1));
    const size = fitSize(o.text, wide() ? 94 : 104, W * .86), ks = wide() ? 30 : 36, y = (o.pos === 'bottom' ? (wide() ? .79 : .8) : (wide() ? .235 : .2)) * H;
    g.save(); g.globalAlpha = a * .6; // a soft dark band behind, so the words read on any frame
    const band = g.createLinearGradient(0, y - size * 2.1, 0, y + size * .9);
    band.addColorStop(0, 'rgba(2,8,9,0)'); band.addColorStop(.45, 'rgba(2,8,9,.85)'); band.addColorStop(1, 'rgba(2,8,9,0)');
    g.fillStyle = band; g.fillRect(0, y - size * 2.1, W, size * 3); g.restore();
    g.save(); g.globalAlpha = a; shadow(true, ks);
    if (o.kicker) { g.font = '600 ' + ks + 'px ' + MONO; g.letterSpacing = (ks * .24).toFixed(1) + 'px'; g.textAlign = 'center'; g.fillStyle = C.pink; g.fillText(o.kicker.toUpperCase(), W / 2 + ks * .12, y - size * 1.02 + (1 - inK) * 8); }
    shadow(true, size); dline(o.text, W / 2, y + (1 - inK) * 20, size, -.025); g.restore();
  },
  // the end card: app icon, name, and where to get it
  async endcard(o) {
    const lt = o.lt, icon = await load('icon.png'), w = wide();
    const isz = w ? H * .2 : W * .3, cx = W / 2, iy = w ? H * .29 : H * .33;
    const k = E.back(cl(lt / .38, 0, 1)), ia = cl(lt / .1, 0, 1);
    g.save(); g.globalAlpha = ia; g.translate(cx, iy); g.scale(.7 + .3 * k, .7 + .3 * k);
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = isz * .18; g.shadowOffsetY = isz * .05;
    const r = isz * .225, s = isz / 2; g.beginPath(); g.roundRect(-s, -s, isz, isz, r); g.fillStyle = C.dark; g.fill();
    g.shadowColor = 'transparent'; g.save(); g.clip(); g.drawImage(icon, -s, -s, isz, isz); g.restore(); g.lineWidth = Math.max(2, isz * .012); g.strokeStyle = 'rgba(220,239,233,.22)'; g.stroke(); g.restore();
    const tk = E.out3(cl((lt - .12) / .3, 0, 1)), ts = Math.round(w ? H * .15 : W * .17), ty = iy + isz * .5 + ts * (w ? .98 : 1.02);
    g.save(); g.globalAlpha = tk; shadow(true, ts); dline('Mitosis', cx, ty + (1 - tk) * 24, ts, -.035); g.restore();
    const sk = E.out3(cl((lt - .22) / .3, 0, 1)), ss = Math.round(w ? H * .032 : W * .042);
    g.save(); g.globalAlpha = sk; g.font = '600 ' + ss + 'px ' + MONO; g.letterSpacing = (ss * .34).toFixed(1) + 'px'; g.textAlign = 'center'; g.fillStyle = C.muted;
    g.fillText('CELL ARENA', cx + ss * .17, ty + ss * 2.2 + (1 - sk) * 10); g.restore();
    const pk = cl((lt - .42) / .16, 0, 1); if (pk > 0) {
      const ps = Math.round(w ? H * .052 : W * .064), py = ty + ss * 2.2 + ps * 2.6, sc = 1.12 - .12 * E.out4(pk);
      g.save(); g.globalAlpha = cl(pk * 3, 0, 1); g.translate(cx, py); g.scale(sc, sc);
      g.font = '800 ' + ps + 'px ' + DISPLAY; g.letterSpacing = (-.01 * ps).toFixed(1) + 'px'; const label = 'Free on the App Store', tw = g.measureText(label).width;
      const pw = tw + ps * 1.6, ph = ps * 1.9; g.shadowColor = 'rgba(255,92,138,.35)'; g.shadowBlur = ps * .8;
      g.beginPath(); g.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2); g.fillStyle = C.pink; g.fill(); g.shadowColor = 'transparent';
      g.fillStyle = C.dark; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, ps * .05); g.restore();
    }
  },
};
window.frame = async function (s) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none'; shadow(false, 0);
  g.fillStyle = C.dark; g.fillRect(0, 0, W, H);
  if (s.src) {
    const im = await load(s.src);
    if (s.blur) { g.filter = 'blur(' + s.blur + 'px)'; const m = s.blur * 3; g.drawImage(im, s.sx, s.sy, s.sw, s.sh, -m, -m, W + 2 * m, H + 2 * m); g.filter = 'none'; }
    else g.drawImage(im, s.sx, s.sy, s.sw, s.sh, 0, 0, W, H);
    if (s.dim) { g.fillStyle = 'rgba(2,8,9,' + s.dim + ')'; g.fillRect(0, 0, W, H); }
  }
  for (const o of s.overlays || []) await draw[o.style](o);
  if (s.flash) { g.fillStyle = 'rgba(255,255,255,' + s.flash.toFixed(3) + ')'; g.fillRect(0, 0, W, H); }
  return 1;
};
window.ready = () => Promise.all(['800 40px "Bricolage Grotesque"', '600 20px "IBM Plex Mono"', '500 20px "IBM Plex Mono"'].map(f => document.fonts.load(f))).then(() => load('icon.png')).then(() => document.fonts.check('800 40px "Bricolage Grotesque"'));
</script></body></html>`;
