// The page the capture loads: index.html exactly as shipped, plus capture-only edits made on a scratch copy
// (index.html itself is never changed):
//  1. the debug handle (?debug=1 → window.__mt) also gets x(code), a direct eval inside the game's closure, so a
//     take can read the world and stage a moment (masses, positions, events, the round clock);
//  2. the canvas may use the full device scale factor instead of at most 2×, so gameplay is as sharp as the HUD in
//     a 2560×1440 capture;
//  3. the Google Fonts stylesheet is the local copy from fonts.js (same fonts, no network needed).
// If a later change to index.html moves one of these, this throws and says which, instead of filming the wrong thing.
'use strict';
const fs = require('fs'), path = require('path');
const { CSS_URL } = require('./fonts');
const ROOT = path.join(__dirname, '..', '..');
const EDITS = [
  ['window.__mt={', 'window.__mt={x:s=>eval(s),', 'the ?debug=1 handle (window.__mt={…})'],
  ['DPR=Math.min(2,window.devicePixelRatio||1)', 'DPR=Math.min(4,window.devicePixelRatio||1)', 'the canvas DPR cap in resize()'],
  [`href="${CSS_URL}"`, 'href="fonts.css"', 'the Google Fonts stylesheet link'],
];
// outFile must sit next to fonts.css (see fonts.js)
function buildGamePage(outFile) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const [from, to, what] of EDITS) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`promo/lib/game.js: expected exactly one "${from.slice(0, 80)}" (${what}) in index.html, found ${n}. Update EDITS.`);
    html = html.replace(from, to);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  return outFile;
}
module.exports = { buildGamePage, ROOT };
