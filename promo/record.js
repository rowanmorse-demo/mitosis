// Record real play for the promos: the game in its own window on this Mac; you play, R starts and stops a take.
//   node promo/record.js                      landscape 2340×1080, an iPhone's own shape (the game is landscape-only),
//                                             offline, wearing Black Hole. One take makes both a 1920×1080 ad (cropped,
//                                             pixel for pixel) and a 1920×886 App Store preview (the whole frame, scaled)
//   node promo/record.js --shape=portrait     1080×1920 instead
//   node promo/record.js --skin=22 --name=Rowan
//   node promo/record.js --online             the live server instead of a room of the game's own bots (laggy on ship Wi-Fi)
//   node promo/record.js --selftest=4         headless: records 4 s of the lobby by itself and quits (checks the plumbing)
// Controls are the desktop ones: the mouse steers, Space splits, W shoots, Shift boosts, P pauses, M mutes.
// Each take is the game's canvas (no cursor, browser or HUD; you still see the HUD), written to promo/rec/<date-time>.mp4
// as 60 fps H.264, with <date-time>.json: every game sound it played and when (edit.js renders the sound from it). The window can be any size: the canvas is drawn at the take's resolution.
// Skin ids: 5 Nebula, 6 Magma, 10 Glacier, 11 Toxic, 12 Eyeball, 13 Galaxy, 14 Gilded, 15 Black Hole, 17 Aurora, 18 Koi,
// 19 Plasma, 20 Geode, 21 Sakura, 22 Supernova, 23 Glitch, 44 Dragon, 45 Phoenix, 53 Total Eclipse, 56 Wormhole, 63 Imperial Egg
// (all on sale today are owned, so any can be worn from the lobby too).
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), { spawn, execFileSync } = require('child_process');
const { buildGamePage, ROOT } = require('./lib/game'), { ensureFonts } = require('./lib/fonts'), recorder = require('./lib/recorder');
const econ = require(path.join(ROOT, 'economy.js'));

const arg = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--(\w+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const PORT = +arg.port || 3917; // not 3000: another session's test server lives there
const WORK = path.join(__dirname, '.work'), OUT = path.join(__dirname, 'rec');
const LAND = arg.shape !== 'portrait';
const TARGET = LAND ? { w: 2340, h: 1080 } : { w: 1080, h: 1920 };
const WIN = LAND ? { w: 1280, h: 591 + 28 } : { w: 405, h: 720 + 28 }; // the window, in points (28: its title bar)
// every skin on sale today (not the Halloween or battle-pass ones: the pass is not launched, keep it out of ads)
const ON_SALE = econ.catalog().skins.filter(k => k.price > 0 && !k.pass && !k.season && !k.sale).map(k => k.id);
const SKIN = +(arg.skin || 15);

function api() {
  if (arg.online) return null;
  const catalog = JSON.parse(JSON.stringify(econ.catalog()));
  return { session: { playerId: 'rec00000000000000', balance: 4850, earned: 31200, skins: ON_SALE, rating: 1388, tier: 'Gold', runs: 214, account: null, catalog } };
}
const settings = {
  'mitosis.intro': '1', 'mitosis.tipRuns': '99', 'mitosis.muted': '0', 'mitosis.tips': JSON.stringify(['move', 'split', 'merge', 'virus', 'arena', 'pause']),
  'mitosis.settings': JSON.stringify({ name: String(arg.name || 'Juno'), stain: 0, diff: 'standard', skin: SKIN, lowFx: false, boardMin: false, botSkill: 'normal', hudStatsMini: false, hudClockMini: false }),
};

// ---- the takes, streamed in chunks and put together when R stops them
const takes = new Map();
function finish(id, frames, late) {
  const t = takes.get(id); if (!t) return; takes.delete(id);
  const ext = /mp4/.test(t.type) ? 'mp4' : 'webm', raw = path.join(t.dir, 'raw.' + ext);
  const parts = fs.readdirSync(t.dir).filter(f => /^\d+$/.test(f)).sort().map(f => fs.readFileSync(path.join(t.dir, f)));
  fs.writeFileSync(raw, Buffer.concat(parts));
  // a constant 60 fps H.264 file at the take's size (the recorder's own is variable-rate), sound as AAC
  const out = path.join(OUT, id + '.mp4');
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-i', raw, '-vf', `fps=60,scale=${TARGET.w}:${TARGET.h}:force_original_aspect_ratio=increase,crop=${TARGET.w}:${TARGET.h},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-an', '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'inherit'] });
    fs.writeFileSync(path.join(OUT, id + '.json'), JSON.stringify({ fps: 60, w: TARGET.w, h: TARGET.h, sfx: t.sfx ? JSON.parse(t.sfx) : [] }));
    if (!arg.keepraw) fs.rmSync(t.dir, { recursive: true, force: true });
    const secs = +execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString();
    const smooth = frames ? `, ${late ? late + ' of ' + frames + ' frames late' + (late / frames > .01 ? ': a hitch shows, close other apps and retake' : '') : 'every frame on time'}` : '';
    const nsfx = t.sfx ? JSON.parse(t.sfx).length : 0;
    console.log(`  saved ${path.relative(ROOT, out)} (${secs.toFixed(1)} s${smooth}, ${nsfx} game sounds logged)`);
  } catch (e) { console.error('  could not convert ' + raw + ': ' + e.message + ' (the raw recording is kept)'); }
}
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Private-Network', 'true'); // the page is a file://
  if (req.method === 'OPTIONS') { res.end(); return; }
  const u = new URL(req.url, 'http://x'), id = (u.searchParams.get('id') || '').replace(/[^\w-]/g, '');
  const body = []; req.on('data', d => body.push(d));
  req.on('end', () => {
    if (u.pathname === '/start' && id) {
      const dir = path.join(WORK, 'rec-' + id); fs.mkdirSync(dir, { recursive: true });
      takes.set(id, { dir, type: u.searchParams.get('type') || '', started: Date.now() });
      console.log(`  recording ${id} at ${u.searchParams.get('w')}×${u.searchParams.get('h')} (${u.searchParams.get('type') || 'default format'})`);
    } else if (u.pathname === '/log') console.log('  [game] ' + Buffer.concat(body).toString().slice(0, 300));
    else if (u.pathname === '/sfx' && takes.has(id)) takes.get(id).sfx = Buffer.concat(body).toString();
    else if (u.pathname === '/chunk' && takes.has(id)) {
      fs.writeFileSync(path.join(takes.get(id).dir, String(+u.searchParams.get('n')).padStart(6, '0')), Buffer.concat(body));
    } else if (u.pathname === '/stop') { finish(id, +u.searchParams.get('frames'), +u.searchParams.get('late')); if (arg.selftest) setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100); }
    res.end('ok');
  });
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await ensureFonts(WORK);
  const page = path.join(WORK, 'record.html');
  buildGamePage(page);
  let html = fs.readFileSync(page, 'utf8');
  const inject = `<script>${recorder({ port: PORT, target: TARGET, api: api(), settings })}</script>`;
  html = html.replace(/<head([^>]*)>/i, m => m + inject); fs.writeFileSync(page, html);
  await new Promise((res, rej) => server.listen(PORT, '127.0.0.1', res).on('error', rej));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mitosis-rec-'));
  const url = 'file://' + page + '?debug=1' + (arg.online ? '' : '&server=http://127.0.0.1:9') + (arg.selftest ? '&autorec=' + (+arg.selftest || 4) : '');
  const chrome = spawn(CHROME, [...(arg.selftest ? ['--headless=new'] : []), `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--app=${url}`, `--window-size=${WIN.w},${WIN.h}`,
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], { stdio: 'ignore' });
  console.log(`Mitosis is open in its own window (${LAND ? 'landscape' : 'portrait'}, ${arg.online ? 'online' : 'offline: bots on this Mac'}).`);
  console.log('Play a few rounds. Press R to start a take and R again to stop it. Close the window when you are done.');
  console.log(`Takes go to ${path.relative(ROOT, OUT)}/ at ${TARGET.w}×${TARGET.h}, 60 fps.`);
  const quit = () => { try { chrome.kill(); } catch (e) {} server.close(); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {} };
  chrome.on('exit', () => { setTimeout(() => { for (const [id] of [...takes]) finish(id); quit(); process.exit(0); }, 1500); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { quit(); process.exit(130); });
})().catch(e => { console.error('record failed:', e.stack || e.message); process.exit(1); });
