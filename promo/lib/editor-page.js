// The compositor page: one canvas the size of the output. edit.js hands it one frame spec at a time (which take
// frame, the crop, darkening, titles with their local time) and screenshots the result.
// Type is the game's own display face, Bricolage Grotesque, and only that, in the game's colours (pink, ink, dark).
'use strict';
module.exports = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fonts.css">
<style>html,body{margin:0;background:#020809;overflow:hidden}canvas{display:block}</style></head><body><canvas id="c"></canvas><script>
const C = { pink: '#ff5c8a', ink: '#dcefe9', dark: '#020809', muted: '#9fc6bd' };
const DISPLAY = '"Bricolage Grotesque", system-ui, sans-serif';
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
function shadow(on, size) { g.shadowColor = on ? 'rgba(0,0,0,.42)' : 'transparent'; g.shadowBlur = on ? size * .2 : 0; g.shadowOffsetY = on ? size * .02 : 0; }
// Every word on screen is one face, Bricolage Grotesque: 800 for lines and titles, 600 spaced capitals for kickers.
// TRACK is the one letter-spacing for lines: tight enough to read as a title, loose enough that letters never touch.
const TRACK = -.012;
// a kicker: small spaced capitals (pink over a line, muted under the logo), centred on x
function kick(text, x, y, size, colour) {
  g.font = '600 ' + size + 'px ' + DISPLAY; g.letterSpacing = (size * .2).toFixed(1) + 'px'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = colour; g.fillText(text.toUpperCase(), x + size * .1, y); // spacing trails the last letter, so nudge right by half of it
}
// a line in the display face with its full stop in pink, centred on x; returns the width
function dline(text, x, y, size, track = TRACK) {
  g.font = '800 ' + size + 'px ' + DISPLAY; g.letterSpacing = (track * size).toFixed(1) + 'px'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const dot = /[.!]$/.test(text) ? text.slice(-1) : '', body = dot ? text.slice(0, -1) : text;
  const bw = g.measureText(body).width, dw = dot ? g.measureText(dot).width : 0, x0 = x - (bw + dw) / 2;
  g.fillStyle = C.ink; g.fillText(body, x0, y); if (dot) { g.fillStyle = C.pink; g.fillText(dot, x0 + bw, y); }
  return bw + dw;
}
function fitSize(text, size, maxW, track = TRACK) { g.font = '800 ' + size + 'px ' + DISPLAY; g.letterSpacing = (track * size).toFixed(1) + 'px'; const w = g.measureText(text).width; return w > maxW ? Math.floor(size * maxW / w) : size; }
// a line in capitals with a dark outline (reads on any frame, at phone size, sound off), centred on x
function oline(text, x, y, size, fill, track = -.02) {
  g.font = '800 ' + size + 'px ' + DISPLAY; g.letterSpacing = (track * size).toFixed(1) + 'px'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.lineJoin = 'round'; g.miterLimit = 2; g.lineWidth = size * .16; g.strokeStyle = 'rgba(2,8,9,.92)';
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = size * .3; g.shadowOffsetY = size * .06; g.strokeText(text, x, y);
  g.shadowColor = 'transparent'; g.fillStyle = fill; g.fillText(text, x, y);
}
const RC = { common: '143,216,198', rare: '154,140,255', epic: '242,177,52', legendary: '255,110,70' };
const draw = {
  // the hook: one to three lines in huge capitals, each landing on its own beat (at: beats after the overlay starts)
  hook(o) {
    const lines = o.lines.map(l => l.toUpperCase()), n = lines.length, base = Math.round((wide() ? H * .19 : W * .2) * (o.scale || 1));
    const sizes = lines.map(l => { g.font = '800 ' + base + 'px ' + DISPLAY; g.letterSpacing = (-.02 * base).toFixed(1) + 'px'; const w = g.measureText(l).width; return w > W * .9 ? Math.floor(base * W * .9 / w) : base; });
    const lh = Math.max(...sizes) * .98, y0 = (o.y == null ? (wide() ? .3 : .22) : o.y) * H - (n - 1) * lh / 2 + sizes[0] * .36;
    lines.forEach((l, i) => {
      const lt = o.lt - (o.at ? o.at[i] || 0 : i * .5) * o.spb; if (lt < 0) return;
      const k = cl(lt / .14, 0, 1), s = (1 + .22 * (1 - E.back(k))) * (1 + .025 * cl(o.lt / o.dur, 0, 1));
      g.save(); g.translate(W / 2, y0 + i * lh); g.scale(s, s); g.globalAlpha = cl(lt / .035, 0, 1);
      oline(l, 0, 0, sizes[i], (o.accent === i || (Array.isArray(o.accent) && o.accent.includes(i))) ? C.pink : '#ffffff'); g.restore();
    });
  },
  // a skin's name and rarity, low in the frame, sliding up as the look changes
  tag(o) {
    const k = E.out3(cl(o.lt / .18, 0, 1)), a = Math.min(cl(o.lt / .06, 0, 1), o.hold ? 1 : cl((o.dur - o.lt) / .08, 0, 1)), rc = RC[o.rarity] || RC.common;
    const size = Math.round(wide() ? H * .085 : W * .105), y = (o.y || (wide() ? .84 : .7)) * H + (1 - k) * size * .5;
    g.save(); g.globalAlpha = a;
    const ks = Math.round(size * .3); g.font = '600 ' + ks + 'px ' + DISPLAY; g.letterSpacing = (ks * .2).toFixed(1) + 'px';
    const label = (o.rarity || 'common').toUpperCase(), lw = g.measureText(label).width + ks * 1.3, lhh = ks * 1.75, ly = y - size * 1.12;
    g.beginPath(); g.roundRect(W / 2 - lw / 2, ly - lhh / 2, lw, lhh, lhh / 2); g.fillStyle = 'rgba(' + rc + ',.22)'; g.fill(); g.lineWidth = Math.max(2, ks * .09); g.strokeStyle = 'rgba(' + rc + ',.9)'; g.stroke();
    g.fillStyle = 'rgb(' + rc + ')'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, W / 2 + ks * .11, ly + ks * .05);
    g.textBaseline = 'alphabetic'; oline(o.name, W / 2, y, size, '#ffffff', -.025); g.restore();
  },
  // the end card: icon, name, and (for ads) the call to action; cta: false for the App Store, which shows no prices
  async end(o) {
    const lt = o.lt, icon = await load('icon.png'), w = wide();
    const isz = w ? H * .3 : W * .36, cx = W / 2, iy = w ? H * .3 : H * .34;
    const k = E.back(cl(lt / .4, 0, 1)), ia = cl(lt / .08, 0, 1);
    g.save(); g.globalAlpha = ia * .55; const glow = g.createRadialGradient(cx, iy, isz * .2, cx, iy, isz * 1.25); glow.addColorStop(0, 'rgba(255,92,138,.55)'); glow.addColorStop(1, 'rgba(255,92,138,0)'); g.fillStyle = glow; g.fillRect(cx - isz * 1.3, iy - isz * 1.3, isz * 2.6, isz * 2.6); g.restore();
    g.save(); g.globalAlpha = ia; g.translate(cx, iy); g.scale(.6 + .4 * k, .6 + .4 * k);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = isz * .2; g.shadowOffsetY = isz * .05;
    const r = isz * .225, s = isz / 2; g.beginPath(); g.roundRect(-s, -s, isz, isz, r); g.fillStyle = C.dark; g.fill();
    g.shadowColor = 'transparent'; g.save(); g.clip(); g.drawImage(icon, -s, -s, isz, isz); g.restore(); g.lineWidth = Math.max(2, isz * .012); g.strokeStyle = 'rgba(220,239,233,.25)'; g.stroke(); g.restore();
    const tk = E.out3(cl((lt - .1) / .3, 0, 1)), ts = Math.round(w ? H * .16 : W * .2), ty = iy + isz * .5 + ts * 1.02;
    g.save(); g.globalAlpha = tk; shadow(true, ts); dline('Mitosis', cx, ty + (1 - tk) * 30, ts, -.035); g.restore();
    const sk = E.out3(cl((lt - .2) / .3, 0, 1)), ss = Math.round(w ? H * .036 : W * .045);
    g.save(); g.globalAlpha = sk; shadow(true, ss); kick(o.sub || 'Cell arena', cx, ty + ss * 2.1 + (1 - sk) * 10, ss, C.muted); g.restore();
    if (o.cta === false) return;
    const pk = cl((lt - .35) / .18, 0, 1); if (pk <= 0) return;
    const ps = Math.round(w ? H * .062 : W * .075), py = ty + ss * 2.1 + ps * 2.5, pulse = 1 + .03 * Math.sin(Math.max(0, lt - .6) * Math.PI * 2 / (o.spb * 2)), sc = (1.15 - .15 * E.out4(pk)) * pulse;
    g.save(); g.globalAlpha = cl(pk * 3, 0, 1); g.translate(cx, py); g.scale(sc, sc);
    g.font = '800 ' + ps + 'px ' + DISPLAY; g.letterSpacing = (-.01 * ps).toFixed(1) + 'px'; const label = o.cta || 'Play free', tw = g.measureText(label).width;
    const pw = tw + ps * 2, ph = ps * 2; g.shadowColor = 'rgba(255,92,138,.45)'; g.shadowBlur = ps * .9;
    g.beginPath(); g.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2); g.fillStyle = C.pink; g.fill(); g.shadowColor = 'transparent';
    g.fillStyle = C.dark; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, ps * .05); g.restore();
    if (o.store) { const qs = Math.round(ps * .42); g.save(); g.globalAlpha = cl((lt - .5) / .2, 0, 1); shadow(true, qs); kick(o.store, cx, py + ps * 1.95, qs, C.ink); g.restore(); }
  },

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
  // a kicker and a line, always in the same place (the lower third) at the same size, over a soft shade from the bottom
  caption(o) {
    const inK = E.out3(cl(o.lt / .22, 0, 1)), a = Math.min(cl(o.lt / .08, 0, 1), cl((o.dur - o.lt) / .14, 0, 1)), w = wide();
    const size = fitSize(o.text, w ? 80 : 92, W * .84), ks = w ? 30 : 34, y = (w ? .875 : .8) * H;
    g.save(); g.globalAlpha = a; const top = y - size * 2.7, shade = g.createLinearGradient(0, top, 0, H);
    shade.addColorStop(0, 'rgba(2,8,9,0)'); shade.addColorStop(.5, 'rgba(2,8,9,.7)'); shade.addColorStop(1, 'rgba(2,8,9,.85)');
    g.fillStyle = shade; g.fillRect(0, top, W, H - top); g.restore();
    g.save(); g.globalAlpha = a;
    if (o.kicker) { shadow(true, ks); kick(o.kicker, W / 2, y - size * 1.08 + (1 - inK) * 8, ks, C.pink); }
    shadow(true, size); dline(o.text, W / 2, y + (1 - inK) * 16, size); g.restore();
  },
  // the title after the cold open: the end card's logo and name without the store button, with a tagline
  title(o) { return draw.endcard({ ...o, pill: false }); },
  // the end card: app icon, name, and where to get it
  async endcard(o) {
    const lt = o.lt, icon = await load('icon.png'), w = wide();
    const big = o.pill === false ? 1.3 : 1, isz = (w ? H * .2 : W * .3) * big, cx = W / 2, iy = (w ? H * .29 : H * .33) + (big > 1 ? H * .02 : 0); // the title is the end card's lockup, larger
    const k = E.back(cl(lt / .38, 0, 1)), ia = cl(lt / .1, 0, 1);
    g.save(); g.globalAlpha = ia; g.translate(cx, iy); g.scale(.7 + .3 * k, .7 + .3 * k);
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = isz * .18; g.shadowOffsetY = isz * .05;
    const r = isz * .225, s = isz / 2; g.beginPath(); g.roundRect(-s, -s, isz, isz, r); g.fillStyle = C.dark; g.fill();
    g.shadowColor = 'transparent'; g.save(); g.clip(); g.drawImage(icon, -s, -s, isz, isz); g.restore(); g.lineWidth = Math.max(2, isz * .012); g.strokeStyle = 'rgba(220,239,233,.22)'; g.stroke(); g.restore();
    const tk = E.out3(cl((lt - .12) / .3, 0, 1)), ts = Math.round((w ? H * .15 : W * .17) * big), ty = iy + isz * .5 + ts * (w ? .98 : 1.02);
    g.save(); g.globalAlpha = tk; shadow(true, ts); dline('Mitosis', cx, ty + (1 - tk) * 24, ts); g.restore();
    const sk = E.out3(cl((lt - .22) / .3, 0, 1)), ss = Math.round((w ? H * .03 : W * .04) * Math.sqrt(big));
    g.save(); g.globalAlpha = sk; shadow(true, ss); kick(o.tag || 'Cell arena', cx, ty + ss * 2.3 + (1 - sk) * 10, ss, C.muted); g.restore();
    const pk = o.pill === false ? 0 : cl((lt - .42) / .16, 0, 1); if (pk > 0) {
      const ps = Math.round(w ? H * .052 : W * .064), py = ty + ss * 2.2 + ps * 2.6, sc = 1.12 - .12 * E.out4(pk);
      g.save(); g.globalAlpha = cl(pk * 3, 0, 1); g.translate(cx, py); g.scale(sc, sc);
      g.font = '800 ' + ps + 'px ' + DISPLAY; g.letterSpacing = (-.01 * ps).toFixed(1) + 'px'; const label = 'Free on the App Store', tw = g.measureText(label).width;
      const pw = tw + ps * 1.6, ph = ps * 1.9; g.shadowColor = 'rgba(255,92,138,.35)'; g.shadowBlur = ps * .8;
      g.beginPath(); g.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2); g.fillStyle = C.pink; g.fill(); g.shadowColor = 'transparent';
      g.fillStyle = C.dark; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, ps * .05); g.restore();
    }
  },
};
// into a shot: 'zoom' rushes in from a little too close, 'whip' smears in along dir; both settle in a few frames
function xfade(im, s) {
  const u = 1 - E.out3(s.xin.k), n = 5;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1); g.globalAlpha = i === 0 ? 1 : .32 * (1 - f * .5);
    if (s.xin.kind === 'zoom') { const z = 1 + u * (.32 - .2 * f); g.drawImage(im, s.sx, s.sy, s.sw, s.sh, W / 2 - W * z / 2, H / 2 - H * z / 2, W * z, H * z); }
    else { const d = u * (wide() ? W : H) * .16 * f, [dx, dy] = s.xin.dir; g.drawImage(im, s.sx, s.sy, s.sw, s.sh, -dx * d, -dy * d, W, H); }
  }
  g.globalAlpha = 1;
}
let vig = null;
function vignette(a) {
  if (!vig || vig.a !== a || vig.w !== W) { const r = Math.hypot(W, H) / 2, gr = g.createRadialGradient(W / 2, H / 2, r * .45, W / 2, H / 2, r); gr.addColorStop(0, 'rgba(2,8,9,0)'); gr.addColorStop(1, 'rgba(2,8,9,' + a + ')'); vig = { a, w: W, gr }; }
  g.fillStyle = vig.gr; g.fillRect(0, 0, W, H);
}
window.frame = async function (s) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none'; shadow(false, 0);
  g.fillStyle = C.dark; g.fillRect(0, 0, W, H);
  if (s.src) {
    const im = await load(s.src);
    if (s.blur) { g.filter = 'blur(' + s.blur + 'px)'; const m = s.blur * 3; g.drawImage(im, s.sx, s.sy, s.sw, s.sh, -m, -m, W + 2 * m, H + 2 * m); g.filter = 'none'; }
    else if (s.xin) xfade(im, s);
    else g.drawImage(im, s.sx, s.sy, s.sw, s.sh, 0, 0, W, H);
    if (s.grade) vignette(s.grade);
    if (s.dim) { g.fillStyle = 'rgba(2,8,9,' + s.dim + ')'; g.fillRect(0, 0, W, H); }
  }
  for (const o of s.overlays || []) await draw[o.style]({ ...o, spb: s.spb || .46875 });
  if (s.flash) { g.fillStyle = 'rgba(255,255,255,' + s.flash.toFixed(3) + ')'; g.fillRect(0, 0, W, H); }
  return 1;
};
window.ready = () => Promise.all(['800 40px "Bricolage Grotesque"', '600 40px "Bricolage Grotesque"'].map(f => document.fonts.load(f))).then(() => load('icon.png')).then(() => document.fonts.check('800 40px "Bricolage Grotesque"'));
</script></body></html>`;
