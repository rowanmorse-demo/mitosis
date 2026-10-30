// The wallet the App Store captures play as: creates it on the local server and gives it representative numbers
// (Gold 1480, 8,350 ATP, four skins, a run history), so the lobby, shop and profile show real, consistent state.
//   DATA_DIR=<the local server's data dir> node seed-wallet.js      (with `npm run dev` running; SQLite store only)
'use strict';
const path = require('path');
const SECRET = 'storeshotwallet' + 'v1'.padEnd(17, '0');   // [a-z0-9]{24,64}, like the game's own secrets
module.exports = { SECRET };

if (require.main === module) (async () => {
  const r = await fetch('http://localhost:3000/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
  const { playerId } = await r.json();
  if (!playerId) throw new Error('no player from the local server');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.DATA_DIR || path.join(__dirname, '../../data'), 'mitosis.sqlite'));
  db.prepare('UPDATE players SET balance = 8350, earned = 4120, rating = 1480, runs = 38, name = ? WHERE id = ?').run('Volvox', playerId);
  for (const skin of [9, 13, 16, 20]) db.prepare('INSERT OR IGNORE INTO skins(player, skin, at) VALUES(?, ?, ?)').run(playerId, skin, Date.now());
  console.log('seeded', playerId);
})().catch(e => { console.error('seed failed:', e.message); process.exit(1); });
