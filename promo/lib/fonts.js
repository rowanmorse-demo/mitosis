// The game's two typefaces (Bricolage Grotesque, IBM Plex Mono) come from Google Fonts. The capture and the edit
// use a local copy (promo/.work/fonts.css + fonts/*.woff2), fetched once, so a flaky connection can't leave a
// frame in a fallback font.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i >= tries) throw new Error(`could not fetch ${url}: ${e.message}`); await new Promise(r => setTimeout(r, 1500 * i)); }
  }
}
// returns the path of fonts.css inside dir (dir/fonts.css, with dir/fonts/*.woff2)
async function ensureFonts(dir) {
  const cssFile = path.join(dir, 'fonts.css');
  if (fs.existsSync(cssFile)) return cssFile;
  fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
  let css = (await get(CSS_URL)).toString('utf8');
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
  for (const u of urls) {
    const name = crypto.createHash('sha1').update(u).digest('hex').slice(0, 16) + '.woff2';
    const f = path.join(dir, 'fonts', name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, await get(u));
    css = css.split(u).join('fonts/' + name);
  }
  fs.writeFileSync(cssFile, css);
  return cssFile;
}
module.exports = { ensureFonts, CSS_URL };
