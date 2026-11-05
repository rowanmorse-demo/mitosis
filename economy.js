// Mitosis economy — ATP (the in-game currency), skins, run payouts and purchases.
// Everything that touches a wallet happens here, on the server, so the client
// can only ask; it can't give itself ATP.
'use strict';
const crypto = require('crypto');
const iap = require('./iap');
const signin = require('./auth');

// Keep SKINS and PACKS in sync with PREMIUM and ATP_PACKS in index.html.
const SKINS = [
  { id: 5, key: 'nebula', name: 'Nebula', price: 400 },
  { id: 6, key: 'magma', name: 'Magma', price: 500 },
  { id: 7, key: 'honeycomb', name: 'Honeycomb', price: 350 },
  { id: 8, key: 'circuit', name: 'Circuit', price: 450 },
  { id: 9, key: 'leopard', name: 'Leopard', price: 300 },
  { id: 10, key: 'glacier', name: 'Glacier', price: 350 },
  { id: 11, key: 'toxic', name: 'Toxic', price: 400 },
  { id: 12, key: 'eyeball', name: 'Eyeball', price: 600 },
  { id: 13, key: 'galaxy', name: 'Galaxy', price: 700 },
  { id: 14, key: 'gilded', name: 'Gilded', price: 800 },
  { id: 15, key: 'blackhole', name: 'Black Hole', price: 10000 },
  { id: 16, key: 'onering', name: 'One Cell to Rule Them All', price: 12000000 }, // eighty $99.99 Biosphere packs
  { id: 17, key: 'aurora', name: 'Aurora', price: 900 },
  { id: 18, key: 'koi', name: 'Koi', price: 500 },
  { id: 19, key: 'plasma', name: 'Plasma', price: 1200 },
  { id: 20, key: 'geode', name: 'Geode', price: 2500 },
  { id: 21, key: 'sakura', name: 'Sakura', price: 450 },
  { id: 22, key: 'supernova', name: 'Supernova', price: 6000 },
  { id: 23, key: 'glitch', name: 'Glitch', price: 1500 },
  // seasonal: on sale only during their holiday each year (SEASONS), kept for good once bought
  { id: 24, key: 'ghost', name: 'Ghost', price: 1500, season: 'halloween' },
  { id: 25, key: 'widow', name: 'Widow', price: 2000, season: 'halloween' },
  { id: 26, key: 'jackolantern', name: "Jack-o'-Lantern", price: 3000, season: 'halloween' },
  { id: 27, key: 'witching', name: 'Witching Hour', price: 7500, season: 'halloween' },
  // battle pass rewards (PASS_SEASONS): never sold, only claimed from the pass
  { id: 28, key: 'diatom', name: 'Diatom', price: 0, pass: 's1' },
  { id: 29, key: 'seasparkle', name: 'Sea Sparkle', price: 0, pass: 's1' },
  { id: 30, key: 'radiolarian', name: 'Radiolarian', price: 0, pass: 's1' },
  { id: 31, key: 'bloom', name: 'Bloom', price: 0, pass: 's1' },
  // the November additions, shown in the shop by category (SKIN_CATS in index.html)
  { id: 32, key: 'lunar', name: 'Lunar', price: 400 },
  { id: 33, key: 'terra', name: 'Terra', price: 900 },
  { id: 34, key: 'storm', name: 'Tempest', price: 1200 },
  { id: 35, key: 'morpho', name: 'Morpho', price: 700 },
  { id: 36, key: 'watermelon', name: 'Watermelon', price: 300 },
  { id: 37, key: 'peppermint', name: 'Peppermint', price: 350 },
  { id: 38, key: 'sprinkles', name: 'Sprinkles', price: 450 },
  { id: 39, key: 'clockwork', name: 'Clockwork', price: 2500 },
  { id: 40, key: 'disco', name: 'Disco', price: 1100 },
  { id: 41, key: 'lavalamp', name: 'Lava Lamp', price: 800 },
  { id: 42, key: 'stainedglass', name: 'Stained Glass', price: 1500 },
  { id: 43, key: 'opal', name: 'Opal', price: 900 },
  { id: 44, key: 'dragon', name: 'Dragon', price: 5000 },
  { id: 45, key: 'phoenix', name: 'Phoenix', price: 9000 },
];
// The generated collections (GEN in index.html): id, key, name and price; test.js checks they match the game.
const GEN_SKINS = [
  // treasures
  [46, 'diamond', 'Diamond', 4000],
  [47, 'ruby', 'Ruby', 1200],
  [48, 'sapphire', 'Sapphire', 1200],
  [49, 'emerald', 'Emerald', 1500],
  [50, 'amethyst', 'Amethyst', 500],
  [51, 'bluetopaz', 'Blue Topaz', 450],
  [52, 'citrine', 'Citrine', 400],
  [53, 'aquamarine', 'Aquamarine', 500],
  [54, 'peridot', 'Peridot', 400],
  [55, 'garnet', 'Garnet', 350],
  [56, 'tanzanite', 'Tanzanite', 900],
  [57, 'rubellite', 'Rubellite', 600],
  [58, 'morganite', 'Morganite', 500],
  [59, 'imperialtopaz', 'Imperial Topaz', 700],
  [60, 'paraiba', 'Paraíba', 1500],
  [61, 'blackdiamond', 'Black Diamond', 2500],
  [62, 'canary', 'Canary Diamond', 3000],
  [63, 'alexandrite', 'Alexandrite', 2500],
  [64, 'starsapphire', 'Star Sapphire', 2000],
  [65, 'catseye', 'Cat’s Eye', 1200],
  [66, 'moonstone', 'Moonstone', 800],
  [67, 'lapis', 'Lapis Lazuli', 450],
  [68, 'turquoise', 'Turquoise', 400],
  [69, 'jade', 'Jade', 500],
  [70, 'rosequartz', 'Rose Quartz', 350],
  [71, 'amber', 'Amber', 600],
  [72, 'obsidian', 'Snowflake Obsidian', 500],
  [73, 'malachite', 'Malachite', 450],
  [74, 'tigerseye', 'Tiger’s Eye', 450],
  [75, 'agate', 'Blue Lace Agate', 400],
  [76, 'rhodochrosite', 'Rhodochrosite', 600],
  [77, 'gold', 'Solid Gold', 2500],
  [78, 'sterling', 'Sterling', 800],
  [79, 'rosegold', 'Rose Gold', 1200],
  [80, 'copper', 'Hammered Copper', 500],
  [81, 'wateredsteel', 'Watered Steel', 1500],
  [82, 'doubloon', 'Doubloon', 2000],
  // space
  [83, 'jupiter', 'Jupiter', 900],
  [84, 'saturn', 'Saturn', 2500],
  [85, 'neptune', 'Neptune', 800],
  [86, 'icegiant', 'Ice Giant', 450],
  [87, 'hotjupiter', 'Hot Jupiter', 1200],
  [88, 'amethystgiant', 'Amethyst Giant', 1000],
  [89, 'pinkgiant', 'Pink Giant', 450],
  [90, 'mars', 'Red Planet', 700],
  [91, 'mercury', 'Mercury', 400],
  [92, 'io', 'Io', 500],
  [93, 'europa', 'Europa', 500],
  [94, 'pluto', 'Pluto', 900],
  [95, 'asteroid', 'Asteroid', 350],
  [96, 'sun', 'The Sun', 1200],
  [97, 'reddwarf', 'Red Dwarf', 450],
  [98, 'bluegiant', 'Blue Giant', 2500],
  [99, 'whitedwarf', 'White Dwarf', 800],
  [100, 'orion', 'Orion', 400],
  [101, 'bigdipper', 'Big Dipper', 350],
  [102, 'cassiopeia', 'Cassiopeia', 350],
  [103, 'southerncross', 'Southern Cross', 350],
  [104, 'scorpius', 'Scorpius', 400],
  [105, 'eclipse', 'Total Eclipse', 3000],
  [106, 'pulsar', 'Pulsar', 4000],
  [107, 'wormhole', 'Wormhole', 8000],
  // sports
  [108, 'football', 'Football', 400],
  [109, 'goldenball', 'Golden Ball', 2500],
  [110, 'streetball', 'Street Ball', 500],
  [111, 'basketball', 'Basketball', 400],
  [112, 'tennisball', 'Tennis Ball', 350],
  [113, 'baseball', 'Baseball', 350],
  [114, 'softball', 'Softball', 350],
  [115, 'cricketball', 'Cricket Ball', 450],
  [116, 'volleyball', 'Volleyball', 400],
  [117, 'beachball', 'Beach Ball', 350],
  [118, 'poolparty', 'Pool Party', 350],
  [119, 'bowlingball', 'Bowling Ball', 500],
  [120, 'cosmicstrike', 'Cosmic Strike', 1200],
  [121, 'golfball', 'Golf Ball', 350],
  [122, 'cueball', 'Cue Ball', 400],
  [123, 'oneball', 'One Ball', 350],
  [124, 'threeball', 'Three Ball', 350],
  [125, 'sixball', 'Six Ball', 350],
  [126, 'eightball', 'Eight Ball', 800],
  [127, 'nineball', 'Nine Ball', 400],
  [128, 'twelveball', 'Twelve Ball', 400],
  [129, 'dartboard', 'Dartboard', 600],
  [130, 'bullseye', 'Bullseye', 450],
  [131, 'goldmedal', 'Gold Medal', 3000],
  [132, 'silvermedal', 'Silver Medal', 1200],
  [133, 'bronzemedal', 'Bronze Medal', 600],
  [134, 'chequered', 'Chequered Flag', 450],
  // fruit
  [135, 'orange', 'Orange', 300],
  [136, 'lemon', 'Lemon', 300],
  [137, 'lime', 'Lime', 300],
  [138, 'grapefruit', 'Pink Grapefruit', 350],
  [139, 'bloodorange', 'Blood Orange', 700],
  [140, 'kiwi', 'Kiwi', 350],
  [141, 'goldenkiwi', 'Golden Kiwi', 750],
  [142, 'dragonfruit', 'Dragon Fruit', 800],
  [143, 'redpitaya', 'Red Pitaya', 900],
  [144, 'passionfruit', 'Passion Fruit', 700],
  [145, 'fig', 'Fig', 450],
  [146, 'papaya', 'Papaya', 400],
  [147, 'cantaloupe', 'Cantaloupe', 350],
  [148, 'tomato', 'Tomato', 300],
  [149, 'cucumber', 'Cucumber', 300],
  [150, 'apple', 'Apple', 300],
  [151, 'avocado', 'Avocado', 450],
  [152, 'coconut', 'Coconut', 400],
  [153, 'pomegranate', 'Pomegranate', 900],
  [154, 'banana', 'Banana', 250],
  [155, 'strawberry', 'Strawberry', 350],
  [156, 'blueberry', 'Blueberry', 350],
  [157, 'peach', 'Peach', 350],
  [158, 'lychee', 'Lychee', 450],
];
for (const [id, key, name, price] of GEN_SKINS) SKINS.push({ id, key, name, price });
const PACKS = [
  { id: 'atp_500', atp: 500 },
  { id: 'atp_1500', atp: 1500 },
  { id: 'atp_5000', atp: 5000 },
  { id: 'atp_12000', atp: 12000 },
  { id: 'atp_150000', atp: 150000 },   // the $99.99 pack: 25% more ATP per dollar than the Bioreactor
];
// Payout for one run, by where the player placed in the round (last one standing is 1st; dying
// with 6 others still alive is 7th): 1st pays 10, top 3 pays 6, top 10 pays 3, top 20 pays 1,
// anything else 0, and a run shorter than minSec pays nothing. No hourly cap: it is deliberately
// small per game so the 10,000 ATP Black Hole is a very long grind and the packs are the realistic
// shortcut. Older clients that only report their best mass rank are paid by that instead.
const RULES = { byRank: [[1, 25], [2, 20], [3, 16], [4, 13], [5, 11], [6, 9], [7, 8], [8, 7], [9, 6], [10, 5], [15, 3], [20, 2], [30, 1]], minSec: 20, maxRunSec: 3 * 3600 }; // 25 ATP for the win, tapering with placement
const HOUR = 3600 * 1000;
// Rating (Elo-like): survival, kills and a high placing raise it, dying quickly lowers it. Gains
// shrink and losses grow as the rating climbs, so it settles instead of inflating forever.
// Everyone starts at 1000.
// winBonus: finishing 1st of 4+; lifePenalty: each respawn already used this round trims the gain (dying less pays more).
const RATING = { base: 1000, perTenSec: .5, survCap: 25, perKill: 2, killCap: 30, placeBonus: 8, winBonus: 10, lifePenalty: .25, quickDeathSec: 60, quickPenalty: 10, scale: 2000 };
// Who a life was against decides which rating it moves and what a win pays. The server decides it (runKind), never the
// game: 'comp' only when the relay saw another player alive in the same arena room during the life (server.js metSince);
// 'ai' is ranked rules against bots only (nobody found in the search, ping over Max ping, or alone in the arena); 'casual'
// is Casual. Apps from before this (no mode in run/start) are rated as they always were, on the competitive rating.
// The AI rating works like the competitive one, from its own 1000, and bots can never move the competitive one. Its
// gains (not its losses) scale with the bots' skill, so beating Easy bots climbs slowly.
const RATING_AI = { skill: { easy: .5, normal: 1, hard: 1.2, expert: 1.35, master: 1.5 } };
// Wins: on top of the placement payout (none in Casual), 1st place pays win[0] and 2nd or 3rd pays win[1], by kind.
// Only a placing of minOf or more cells counts, and only a life of minSec or more on the server's clock, so a quit
// (no placing), an early death or an abandoned life (never ended) pays nothing. Each day (UTC) bonuses stop at the cap:
// bots (ai and casual together) and comp (friends could trade wins) each have their own.
const WINS = { comp: [50, 15], ai: [25, 5], casual: [20, 5], minSec: 120, minOf: 8, cap: { bots: 200, comp: 400 } };
const WIN_POOLS = { bots: ['ai', 'casual'], comp: ['comp'] }, winPool = kind => (kind === 'comp' ? 'comp' : 'bots');
function winBonus({ kind, survived, place, of }) {
  const t = Array.isArray(WINS[kind]) ? WINS[kind] : null; if (!t) return 0;
  const n = Math.floor(+of || 0), pl = Math.floor(+place || 0);
  if ((+survived || 0) < WINS.minSec || n < WINS.minOf || pl < 1 || pl > 3 || pl > n) return 0;
  return pl === 1 ? t[0] : t[1];
}
const RUN_MODES = ['arena', 'bots', 'casual'];
// mode: what the game said at run/start; metSince(t): whether the relay saw another player alive beside this one since t
function runKind(run, metSince) {
  if (!run.mode) return 'legacy';
  if (run.mode === 'casual') return 'casual';
  return run.mode === 'arena' && typeof metSince === 'function' && metSince(Number(run.started)) ? 'comp' : 'ai';
}
// XP and profile levels: every ranked life earns XP for the time it lasted plus a bonus for where it placed, and XP
// only ever adds up. Time uses the same server-capped survival as ATP and rating, and counts up to one round (10 min).
// Placing: 1st of N earns the full bonus, last earns none, and winning adds more; like the rating it needs 4+ in the
// round, and like ATP a life shorter than minSec places for nothing. Levels: going from level L to L+1 takes
// first + step * (L - 1) XP (100, 150, 200, ...), so each level needs more than the last.
const XP = { perTenSec: 2, timeCapSec: 600, place: 60, win: 40, minOf: 4, minSec: RULES.minSec, first: 100, step: 50 };
function xpFor({ survived, place, of }) {
  const sec = Math.max(0, Math.min(XP.timeCapSec, +survived || 0));
  const n = Math.floor(+of || 0), pl = Math.floor(+place || 0), placed = sec >= XP.minSec && n >= XP.minOf && pl >= 1 && pl <= n;
  const time = Math.floor(sec / 10) * XP.perTenSec;
  const placing = placed ? Math.round(XP.place * (n - pl) / (n - 1)) : 0, won = placed && pl === 1 ? XP.win : 0;
  return { time, place: placing, win: won, total: time + placing + won };
}
const xpToNext = level => XP.first + XP.step * (Math.max(1, level) - 1);   // XP from `level` to the next
const xpAtLevel = level => { const k = Math.max(1, level) - 1; return k * XP.first + XP.step * k * (k - 1) / 2; }; // total XP that reaches `level`
function levelOf(xp) {
  xp = Math.max(0, Math.floor(+xp || 0));
  // invert xpAtLevel (a quadratic in the level), then step past any rounding at the edges
  const a = XP.step / 2, b = XP.first - XP.step / 2;
  let level = 1 + Math.max(0, Math.floor((-b + Math.sqrt(b * b + 4 * a * xp)) / (2 * a)));
  while (level > 1 && xpAtLevel(level) > xp) level--;
  while (xpAtLevel(level + 1) <= xp) level++;
  return { xp, level, levelXp: xp - xpAtLevel(level), levelNeed: xpToNext(level) };
}
const TIERS = [[900, 'Bronze'], [1100, 'Silver'], [1400, 'Gold'], [1800, 'Platinum'], [2300, 'Diamond'], [Infinity, 'Legend']];
const tierOf = r => TIERS.find(t => r < t[0])[1];
function ratingDelta(rating, survived, eaten, place, of, life = 0, mult = 1) { // mult scales the gain only (RATING_AI.skill)
  // placing: 1st of N earns the full bonus, last earns none; needs at least 4 in the round to count. Winning adds more.
  const n = Math.max(0, of | 0), pl = Math.max(1, place | 0), placing = n >= 4 && pl <= n ? RATING.placeBonus * (1 - (pl - 1) / (n - 1)) : 0;
  const won = n >= 4 && pl === 1 ? RATING.winBonus : 0;
  const careful = Math.max(.4, 1 - RATING.lifePenalty * Math.max(0, Math.min(2, life | 0)));   // 2nd life earns 75%, 3rd 50%
  const gain = (Math.min(RATING.survCap, Math.floor(survived / 10) * RATING.perTenSec) + Math.min(RATING.killCap, Math.max(0, eaten | 0) * RATING.perKill) + placing + won) * careful * mult;
  const quick = survived < RATING.quickDeathSec ? (RATING.quickDeathSec - survived) / RATING.quickDeathSec * RATING.quickPenalty : 0;
  const k = Math.max(0, rating - RATING.base) / RATING.scale;
  return Math.round(gain * Math.max(.35, 1 - k) - quick * (1 + k));
}
// Names are shown to every player (keep in step with the copy in index.html), so slurs and obvious profanity are refused. Long words match anywhere once spacing,
// l33t spellings and stretched letters are undone; short ones only as whole words; ALLOW keeps innocent words that contain them.
const NAME_BAD_ANY = ['fuck', 'fuk', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'penis', 'vagina', 'porn', 'rapist', 'hitler', 'nazi', 'kike', 'tranny', 'paedo', 'pedophile', 'molest', 'jizz', 'dildo', 'blowjob', 'wank', 'twat', 'motherf', 'cocksuck', 'dickhead', 'asshole', 'bastard', 'killyourself'];
const NAME_BAD_WORD = ['ass', 'fag', 'cum', 'dick', 'cock', 'rape', 'anal', 'sex', 'tit', 'tits', 'spic', 'chink', 'nig', 'coon', 'gook', 'homo', 'hoe', 'pedo', 'kys', 'nazis'];
const NAME_ALLOW = ['niger', 'nigeria', 'snigger', 'scunthorpe', 'penistone', 'therapist', 'torpedo', 'cockatoo', 'peacock', 'hancock', 'shiitake', 'shitake', 'dickens', 'grape', 'drape', 'analysis', 'canal', 'cucumber', 'essex', 'sussex', 'pedometer', 'skunk', 'assassin', 'bass', 'class', 'grass', 'glass', 'pass', 'mass', 'cockpit', 'woodcock', 'bitcoin'];
const NAME_LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't' };
const squashName = s => s.replace(/(.)\1+/g, '$1');
function nameBlocked(s) {
  let low = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[0-9@$!|+]/g, c => NAME_LEET[c] || c);
  for (const w of NAME_ALLOW) low = low.split(w).join(' ');
  const flat = low.replace(/[^a-z]/g, ''), squash = squashName(flat);
  if (NAME_BAD_ANY.some(w => flat.includes(w) || squash.includes(squashName(w))) || NAME_BAD_WORD.includes(flat) || NAME_BAD_WORD.includes(squash)) return true;
  return low.split(/[^a-z]+/).some(w => w && (NAME_BAD_WORD.includes(w) || NAME_BAD_WORD.includes(squashName(w))));
}
const cleanName = s => { const n = String(s || '').replace(/[^\p{L}\p{N} _.\-'!?]/gu, '').trim().slice(0, 16); return n && !nameBlocked(n) ? n : null; };

const skinById = id => SKINS.find(s => s.id === id);
// Seasons repeat every year: [month, day] to [month, day], the same dates the game shows. The server allows a day either
// side so every time zone gets the whole holiday. MITOSIS_DATE pins "now" for tests.
const SEASONS = { halloween: { name: 'Halloween', from: [10, 24], to: [11, 3] } };
const now = () => (process.env.MITOSIS_DATE ? Date.parse(process.env.MITOSIS_DATE) : Date.now());
function seasonOpen(key, t = now()) {
  const s = SEASONS[key]; if (!s) return false;
  const y = new Date(t).getUTCFullYear(), day = 864e5;
  return [y - 1, y].some(yy => { const a = Date.UTC(yy, s.from[0] - 1, s.from[1]) - day, b = Date.UTC(yy, s.to[0] - 1, s.to[1]) + 2 * day; return t >= a && t < b; });
}
// Battle pass, set up like Fortnite's: everyone has the free pass, and the Battle Pass (premium) is bought once per season
// with ATP, so real money goes through the App Store and Google Play ATP packs. Ranked lives fill it with the same XP that
// counts for profile levels (xpFor, added here in runEnd and never claimed by the client). Every levelXp is a level, and
// each level gives Battle Stars. Rewards sit on pages: spend stars on any reward on an open page, in any order, each once.
// Free rewards are for everyone; the rest need the Battle Pass. Page 1 is open from the start, and a page opens when you
// reach its level or claim `need` rewards on the page before it. The last page is the Bonus page, for after the rest.
// The Battle Pass pays back its price in ATP on pages 1-5, plus more on the Bonus page. A shop skin you already own is
// paid out at its shop price in ATP instead. The Battle Bundle is the Battle Pass plus bundleLevels levels.
// Seasons run between fixed UTC dates (from inclusive, to exclusive), and the pass also has a switch (/admin/pass, kept
// in the store) so it stays hidden until it is launched. While it is off, or between seasons, the pass is in neither the
// catalogue nor the wallet, and lives add nothing to it. Rewards are known by their place ('2c' is page 2's third), so
// never reorder a season that has started.
const PASS = { levelXp: 300, stars: 5, need: 4, premium: 2500, bundle: 4500, bundleLevels: 10 };
const A = atp => ({ atp }), K = skin => ({ skin }), F = (stars, r) => ({ stars, free: true, ...r }), P = (stars, r) => ({ stars, ...r });
const PASS_SEASONS = [
  { key: 's1', n: 1, name: 'Bloom', from: '2026-11-16', to: '2026-12-28', pages: [
    { rewards: [P(0, K(29)), F(4, A(100)), P(4, A(150)), P(5, K(18)), P(5, A(150)), F(4, A(50))] },             // Sea Sparkle as soon as you buy, Koi
    { level: 6, rewards: [P(5, A(150)), P(6, K(21)), F(5, A(100)), P(5, A(150)), P(7, K(17)), F(5, A(50))] },   // Sakura, Aurora
    { level: 12, rewards: [P(8, K(30)), P(6, A(150)), F(6, A(100)), P(6, A(200)), P(7, K(19)), P(6, A(150))] }, // Radiolarian, Plasma
    { level: 18, rewards: [F(8, K(28)), P(7, A(200)), P(8, K(23)), P(7, A(200)), F(7, A(100)), P(7, A(200))] }, // Diatom (free), Glitch
    { level: 24, rewards: [P(10, K(31)), P(8, A(250)), F(8, A(100)), P(8, A(300)), P(9, K(20)), P(8, A(250))] }, // Bloom, Geode
    { level: 40, need: 6, bonus: true, rewards: [P(10, A(250)), P(10, A(250)), P(10, A(250)), P(10, A(250))] },
  ] },
];
for (const s of PASS_SEASONS) s.pages.forEach((pg, i) => pg.rewards.forEach((r, j) => { r.id = (i + 1) + 'abcdefgh'[j]; r.page = i; }));
const passSeason = (t = now()) => PASS_SEASONS.find(s => t >= Date.parse(s.from) && t < Date.parse(s.to)) || null;
// Testers (picked on /admin/pass) see the pass before it is launched: while it is off, and before its season starts
// (they get the next one). Their progress and rewards are real and carry on into the season.
const PASS_TESTERS_MAX = 20;
const passTesters = store => { try { const a = JSON.parse(store.flag('passTesters') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
// The season player p sees (null: none). Without a player, the one everybody sees.
function passLive(store, t = now(), p = null) {
  if (!store) return null;
  const s = passSeason(t);
  if (s && store.flag('pass') === 'on') return s;
  if (!p || !passTesters(store).includes(p.id)) return null;
  return s || PASS_SEASONS.find(x => Date.parse(x.from) > t) || null;
}
// Adds or removes a tester; a merge moves the tester to the account it joined (to), and deletion (to null) removes it.
function passTesterSet(store, id, on) {
  const a = passTesters(store).filter(x => x !== id);
  if (on) { if (!store.player(id)) throw new ApiError(404, 'no such player'); if (a.length >= PASS_TESTERS_MAX) throw new ApiError(400, 'too many testers'); a.push(id); }
  store.setFlag('passTesters', JSON.stringify(a));
}
function passTesterMove(store, from, to) {
  const a = passTesters(store); if (!a.includes(from)) return;
  store.setFlag('passTesters', JSON.stringify([...new Set(a.map(x => (x === from ? to : x)).filter(Boolean))]));
}
const passLevelAt = xp => 1 + Math.floor(Math.max(0, xp) / PASS.levelXp);
const passReward = (s, id) => s.pages.flatMap(pg => pg.rewards).find(r => r.id === id) || null;
const passCatalog = s => s && { key: s.key, n: s.n, name: s.name, starts: Date.parse(s.from), ends: Date.parse(s.to), levelXp: PASS.levelXp, stars: PASS.stars, premium: PASS.premium, bundle: PASS.bundle, bundleLevels: PASS.bundleLevels,
  pages: s.pages.map(pg => ({ level: pg.level || 1, need: pg.need || PASS.need, bonus: !!pg.bonus, rewards: pg.rewards })) };
// A player's pass this season: XP and level, Battle Stars left to spend, whether they have the Battle Pass, the rewards
// they claimed, how many pages are open (always the first ones), and how many rewards they could claim right now.
function passOf(store, p, s = passLive(store, now(), p)) {
  if (!s) return null;
  const row = store.passRow(p.id, s.key), xp = Number(row && row.xp) || 0, premium = !!Number(row && row.premium), level = passLevelAt(xp), claimed = store.passClaims(p.id, s.key);
  const stars = Math.max(0, level * PASS.stars - claimed.reduce((n, id) => n + ((passReward(s, id) || {}).stars || 0), 0));
  let pages = 1;
  while (pages < s.pages.length) { const pg = s.pages[pages], got = s.pages[pages - 1].rewards.filter(r => claimed.includes(r.id)).length;
    if (level >= (pg.level || 1) || got >= (pg.need || PASS.need)) pages++; else break; }
  const claimable = s.pages.slice(0, pages).flatMap(pg => pg.rewards).filter(r => !claimed.includes(r.id) && (r.free || premium) && r.stars <= stars).length;
  return { season: s.key, xp, level, stars, premium, claimed, pages, claimable };
}
// runEnd: a ranked life's XP also fills the pass; returns how many levels it gained.
function passAddXp(store, p, n) {
  const s = passLive(store, now(), p); if (!s || !(n > 0)) return 0;
  const before = Number((store.passRow(p.id, s.key) || {}).xp) || 0;
  store.passAddXp(p.id, s.key, n, Date.now());
  return passLevelAt(before + n) - passLevelAt(before);
}
// Quests, Fortnite style: daily and weekly goals that pay bonus pass XP (not profile XP). Everyone gets the same ones:
// each slot picks one of its variants from the day (UTC) or the ISO week (from Monday 00:00 UTC), so a new set
// arrives at midnight and on Mondays. They count only in runEnd, from the same server-capped survival and placing as
// XP, and only while the pass is live. A finished quest pays its XP to the pass at once (no claim, so apps from
// before quests earn it too), once. Like ATP, a life counts (as a life, for its time or its placing) only from minSec,
// so an instant start and end adds nothing; placings also need XP.minOf in the round, like XP's.
// Quests are kept by id ('top-10-2'), so a variant's id must not change in a period that has started.
const QUESTS = { xp: { day: 100, week: 300 }, minSec: RULES.minSec };
const QL = goal => ({ kind: 'lives', goal }), QT = min => ({ kind: 'time', goal: min * 60 }), QS = sec => ({ kind: 'life', sec, goal: 1 }),
  QO = (sec, goal) => ({ kind: 'lasts', sec, goal }), QP = (top, goal) => ({ kind: 'top', top, goal }), QW = goal => ({ kind: 'win', goal });
const QUEST_SLOTS = {
  day: [[QL(3), QL(4), QL(5)], [QT(5), QT(8), QT(10)], [QS(120), QS(180), QS(240)], [QP(10, 2), QP(5, 1), QP(3, 1)]],
  week: [[QL(20), QL(25), QL(30)], [QT(45), QT(60), QT(75)], [QS(300), QS(360), QS(420)], [QO(120, 8), QO(120, 10), QO(120, 12)],
    [QP(10, 8), QP(10, 10), QP(10, 12)], [QP(3, 3), QP(3, 4), QP(3, 5)], [QW(1), QW(2), QW(3)]],
};
const times = n => (n === 1 ? '' : n === 2 ? ' twice' : ` in ${n} lives`);
function questText(q) {
  const m = q.sec / 60;
  if (q.kind === 'lives') return `Play ${q.goal} ranked lives`;
  if (q.kind === 'time') return `Stay alive ${q.goal / 60} minutes in total`;
  if (q.kind === 'life') return `Survive ${m} minutes in one life`;
  if (q.kind === 'lasts') return `Last ${m} minutes in ${q.goal} lives`;
  if (q.kind === 'win') return q.goal === 1 ? 'Win a round' : `Win ${q.goal} rounds`;
  return `Finish in the top ${q.top}${times(q.goal)}`;
}
const DAY = 864e5;
const dayOf = t => { const a = Math.floor(t / DAY) * DAY; return { key: new Date(a).toISOString().slice(0, 10), starts: a, ends: a + DAY }; };
function isoWeekOf(t) { // ISO 8601: weeks start on Monday, and week 1 is the one with the year's first Thursday
  const a = Math.floor(t / DAY) * DAY, mon = a - ((new Date(a).getUTCDay() + 6) % 7) * DAY, y = new Date(mon + 3 * DAY).getUTCFullYear();
  const jan4 = Date.UTC(y, 0, 4), w1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return { key: `${y}-W${String(1 + Math.round((mon - w1) / (7 * DAY))).padStart(2, '0')}`, starts: mon, ends: mon + 7 * DAY };
}
// The quests of the day or week holding t: one per slot, picked by a hash of the period, so everyone has the same set.
function questsAt(kind, t = now()) {
  const per = kind === 'day' ? dayOf(t) : isoWeekOf(t);
  const list = QUEST_SLOTS[kind].map((vs, i) => {
    const q = vs[parseInt(hash(`${kind}:${per.key}:${i}`).slice(0, 8), 16) % vs.length];
    return { ...q, id: [q.kind, q.top || q.sec, q.goal].filter(x => x != null).join('-'), xp: QUESTS.xp[kind], text: questText(q) };
  });
  return { ...per, period: kind[0] + per.key, list };
}
// What one life adds to a quest. `life` has the server-capped seconds and the placing.
function questStep(q, life) {
  const sec = Math.max(0, Math.min(XP.timeCapSec, +life.survived || 0)), counts = sec >= QUESTS.minSec;
  const n = Math.floor(+life.of || 0), pl = Math.floor(+life.place || 0), placed = counts && n >= XP.minOf && pl >= 1 && pl <= n;
  if (q.kind === 'lives') return counts ? 1 : 0;
  if (q.kind === 'time') return counts ? Math.floor(sec) : 0;
  if (q.kind === 'life' || q.kind === 'lasts') return sec >= q.sec ? 1 : 0;
  return placed && pl <= (q.kind === 'win' ? 1 : q.top) ? 1 : 0;
}
// A player's quests today and this week, or null while the pass is not live. Daily ones end at midnight UTC, weekly
// ones on Monday, and neither outlasts the season.
function questsOf(store, p, t = now(), s = passLive(store, t, p)) {
  if (!s) return null;
  const view = kind => {
    const Q = questsAt(kind, t), rows = new Map(store.questRows(p.id, Q.period).map(r => [r.quest, r]));
    return { key: Q.key, ends: Math.min(Q.ends, Date.parse(s.to)), quests: Q.list.map(q => { const r = rows.get(q.id);
      return { id: q.id, kind: q.kind, text: q.text, goal: q.goal, progress: Math.min(q.goal, Number(r && r.progress) || 0), xp: q.xp, done: !!(r && r.done != null) }; }) };
  };
  return { daily: view('day'), weekly: view('week') };
}
// runEnd (with the life) and after a merge (without one): moves the quests on and pays the pass for each one finished
// now. Returns the XP paid and the quests it was for.
function questsTick(store, p, life, t = now()) {
  const s = passLive(store, t, p), out = { xp: 0, done: [] }; if (!s) return out;
  const at = Date.now();
  for (const kind of ['day', 'week']) {
    const Q = questsAt(kind, t), rows = new Map(store.questRows(p.id, Q.period).map(r => [r.quest, r]));
    for (const q of Q.list) {
      const r = rows.get(q.id); if (r && r.done != null) continue;
      const had = Number(r && r.progress) || 0, step = life ? questStep(q, life) : 0, prog = Math.min(q.goal, had + step);
      if (step > 0) store.questSave(p.id, Q.period, q.id, prog, at);
      if (prog >= q.goal && store.questDone(p.id, Q.period, q.id, at)) { store.passAddXp(p.id, s.key, q.xp, at); out.xp += q.xp; out.done.push({ id: q.id, text: q.text, xp: q.xp, kind }); }
    }
  }
  return out;
}
const packById = id => PACKS.find(p => p.id === id);
const catalog = (store, p = null) => ({ skins: SKINS, seasons: Object.fromEntries(Object.entries(SEASONS).map(([k, s]) => [k, { ...s, open: seasonOpen(k) }])), pass: passCatalog(passLive(store, now(), p)), packs: PACKS, rules: RULES, rating: RATING, ratingAi: RATING_AI, wins: WINS, xp: XP, tiers: TIERS.map(t => t[1]), tierAt: TIERS.map(t => t[0]), iap: iap.status(), auth: signin.status() });

function payoutFor({ survived, bestRank, place }) {
  const sec = Math.max(0, Math.min(RULES.maxRunSec, +survived || 0));
  if (sec < RULES.minSec) return 0;
  const rank = Math.max(1, Math.floor(+place || +bestRank || 0));
  const tier = RULES.byRank.find(([r]) => rank <= r);
  return tier ? tier[1] : 0;
}

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
// The sign-in a wallet belongs to (Apple or Google), or null for a device-only wallet.
const accountOf = (store, p) => { const i = store.identities(p.id)[0]; return i ? { provider: i.provider, email: i.email || null, since: Number(i.at) } : null; };
const wallet = (store, p) => ({ playerId: p.id, balance: Number(p.balance), earned: Number(p.earned), skins: store.skins(p.id), rating: Number(p.rating ?? RATING.base), tier: tierOf(Number(p.rating ?? RATING.base)), runs: Number(p.runs || 0),
  aiRating: Number(p.ai_rating ?? RATING.base), aiTier: tierOf(Number(p.ai_rating ?? RATING.base)), aiRuns: Number(p.ai_runs || 0), ...levelOf(p.xp), pass: passOf(store, p), quests: questsOf(store, p), account: accountOf(store, p) });

/* ---------- handlers: each gets (store, body, player?) and returns a JSON-able object ---------- */
function session(store, body) {
  const secret = String(body.secret || '');
  if (!/^[a-z0-9]{24,64}$/.test(secret)) throw new ApiError(400, 'secret must be 24-64 lowercase letters/digits');
  const h = hash(secret), now = Date.now();
  let p = store.playerBySecret(h);
  if (!p) p = store.createPlayer(crypto.randomBytes(8).toString('hex'), h, now);
  else store.touch(p.id, now);
  return { ...wallet(store, p), catalog: catalog(store, p) };
}
function auth(store, headers) {
  const m = /^Bearer\s+([a-z0-9]{24,64})$/.exec(headers.authorization || '');
  if (!m) throw new ApiError(401, 'sign in first');
  const h = hash(m[1]), p = store.playerBySecret(h);
  if (!p) throw new ApiError(401, 'unknown player');
  p.deviceHash = h;   // which device secret this request came from (not stored)
  return p;
}

/* ---------- sign-in: Apple / Google identities, so a wallet follows the player ---------- */
// A device that signs in to an account it did not create joins that account: its own wallet
// (ATP, skins, history) is folded into the account's and its secret now opens the account.
async function signInWith(verify, store, body, p) {
  let ident;
  try { ident = await verify(body); }
  catch (e) { throw new ApiError(e.status || 401, e.message); }
  const now = Date.now(), existing = store.identity(ident.provider, ident.subject);
  let player = p, merged = false;
  if (existing && existing.player !== p.id && store.player(existing.player)) {
    store.mergePlayers(p.id, existing.player); player = store.player(existing.player); merged = true;
    passTesterMove(store, p.id, player.id);
    questsTick(store, player, null);   // progress from both devices may finish a quest together
  } else if (!existing) {
    store.linkIdentity(ident.provider, ident.subject, p.id, ident.email, now);
  }
  console.log(`+ ${ident.provider} sign-in${merged ? ' (joined existing account)' : ''}`);
  return { ...wallet(store, player), merged };
}
const signInApple = (store, body, p) => signInWith(signin.verifyApple, store, body, p);
const signInGoogle = (store, body, p) => signInWith(signin.verifyGoogle, store, body, p);
// Sign out only detaches this device; the account and its wallet stay for the next sign-in.
// The device then starts a fresh wallet with a new secret (the page does that).
// Account deletion (App Store guideline 5.1.1(v)): removes the player and everything linked to them. Needs an explicit confirmation.
function deleteAccount(store, body, p) {
  if (!body || body.confirm !== 'DELETE') throw new ApiError(400, 'confirm deletion');
  const linked = store.identities(p.id).map(i => i.provider);
  store.deletePlayer(p.id); passTesterMove(store, p.id, null);
  console.log(`- account deleted${linked.length ? ' (' + linked.join(', ') + ' sign-in)' : ''}`);
  return { ok: true, deleted: true };
}
function signOut(store, body, p) {
  if (p.deviceHash && p.deviceHash !== p.secret) store.forgetDevice(p.deviceHash);
  return { ok: true };
}
function runStart(store, body, p) {
  const now = Date.now();
  if (store.openRuns(p.id, now - HOUR) > 20) throw new ApiError(429, 'too many open runs');
  const id = crypto.randomBytes(8).toString('hex');
  store.createRun(id, p.id, now, RUN_MODES.includes(body.mode) ? body.mode : null);   // mode: the game's word for where it is played, checked at run/end
  return { runId: id };
}
// ctx (from server.js): metSince(t), whether the relay saw this game alive beside another player since t
function runEnd(store, body, p, ctx = {}) {
  const now = Date.now();
  const run = store.run(String(body.runId || ''), p.id);
  if (!run) throw new ApiError(404, 'unknown run');
  if (run.ended) return { payout: Number(run.payout) || 0, winBonus: Number(run.bonus) || 0, kind: run.kind || 'legacy', xpGained: Number(run.xp) || 0, ...wallet(store, p), duplicate: true };
  // The client can't claim more survival time than actually elapsed on the server.
  const elapsed = (now - Number(run.started)) / 1000 + 15;
  const survived = Math.min(+body.survived || 0, elapsed);
  // Casual pays only for a win or a top-3 finish, and earns no XP (it has endless lives)
  const kind = runKind(run, ctx.metSince), casual = kind === 'casual', life = { survived, place: body.place, of: body.of };
  let bonus = winBonus({ kind, ...life }), capped = false;
  if (bonus) {
    const pool = winPool(kind), day = dayOf(now).starts, used = WIN_POOLS[pool].reduce((n, k) => n + store.bonusSince(p.id, day, k), 0);
    const left = Math.max(0, WINS.cap[pool] - used); if (bonus > left) { bonus = left; capped = true; }
  }
  const payout = (casual ? 0 : payoutFor({ survived, bestRank: body.bestRank, place: body.place })) + bonus;
  const xp = casual ? { time: 0, place: 0, win: 0, total: 0 } : xpFor(life), level = levelOf(p.xp).level;
  const w = { balance: Number(p.balance) + payout, earned: Number(p.earned) + payout, hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) };
  store.setWallet(p.id, w); store.addXp(p.id, xp.total); store.endRun(run.id, now, payout, xp.total, kind, bonus);
  // the same XP fills the battle pass while a season is on, and the life moves the quests on, which pay the pass only
  const passUp = passAddXp(store, p, xp.total), passMid = passOf(store, p), q = casual ? { xp: 0, done: [] } : questsTick(store, p, life);
  Object.assign(p, w); p.xp = Number(p.xp || 0) + xp.total;
  // rating: bots move only the AI rating. Ranked bot games always have Normal bots; Casual says which it had.
  const name = cleanName(body.name) || p.name || null, vsBots = kind === 'ai' || casual;
  const before = Number((vsBots ? p.ai_rating : p.rating) ?? RATING.base), mult = casual ? RATING_AI.skill[body.skill] || 1 : 1;
  const delta = ratingDelta(before, survived, body.eaten, body.place, body.of, body.life, mult), rating = Math.max(0, before + delta);
  if (vsBots) { store.setAiRating(p.id, rating, name); p.ai_rating = rating; p.ai_runs = Number(p.ai_runs || 0) + 1; }
  else { store.setRating(p.id, rating, name); p.rating = rating; p.runs = Number(p.runs || 0) + 1; }
  p.name = name;
  // kind: who the life was against (comp, ai, casual; legacy for apps that don't say); ratingDelta and aiDelta: how each
  // rating moved (one is 0); winBonus: the part of payout a win or top 3 paid; winCapped: the day's cap cut it;
  // xpParts: where the XP came from (time alive, placing, the win); levelUp: how many levels this life gained;
  // passUp: pass levels from the life and its quests; questXp and questsDone: the quests it finished
  const out = wallet(store, p);
  return { payout, kind, winBonus: bonus, winCapped: capped, ratingDelta: vsBots ? 0 : delta, aiDelta: vsBots ? delta : 0, xpGained: xp.total, xpParts: { time: xp.time, place: xp.place, win: xp.win }, levelUp: out.level - level,
    passUp: passUp + (passMid && out.pass ? out.pass.level - passMid.level : 0), questXp: q.xp, questsDone: q.done, ...out };
}
function buySkin(store, body, p) {
  const skin = skinById(body.skinId | 0);
  if (!skin) throw new ApiError(404, 'no such skin');
  if (skin.pass) throw new ApiError(403, `${skin.name} comes only from the battle pass`);
  if (skin.season && !seasonOpen(skin.season) && !store.skins(p.id).includes(skin.id)) throw new ApiError(403, `${skin.name} is only in the shop during ${SEASONS[skin.season].name}`);
  if (store.skins(p.id).includes(skin.id)) return { ...wallet(store, p), already: true };
  if (Number(p.balance) < skin.price) throw new ApiError(402, `need ${skin.price - Number(p.balance)} more ATP`);
  const w = { balance: Number(p.balance) - skin.price, earned: Number(p.earned), hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) };
  store.setWallet(p.id, w); store.addSkin(p.id, skin.id, Date.now()); Object.assign(p, w);
  return { ...wallet(store, p), bought: skin.id };
}
async function credit(store, p, platform, verified, idForDedupe) {
  const pack = packById(verified.productId);
  if (!pack) throw new ApiError(400, 'unknown product ' + verified.productId);
  const pid = platform + ':' + idForDedupe;
  if (store.purchase(pid)) return { ...wallet(store, p), credited: 0, duplicate: true };
  const w = { balance: Number(p.balance) + pack.atp, earned: Number(p.earned), hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) };
  store.setWallet(p.id, w); store.addPurchase(pid, p.id, pack.id, pack.atp, platform + '/' + verified.environment, Date.now()); Object.assign(p, w);
  console.log(`$ ${platform} purchase ${pack.id} (+${pack.atp} ATP, ${verified.environment})`);
  return { ...wallet(store, p), credited: pack.atp };
}
async function iapApple(store, body, p) {
  let v; try { v = await iap.verifyApple({ transactionId: body.transactionId, jws: body.jws }); }
  catch (e) { throw new ApiError(e.status || 400, 'Apple: ' + e.message); }
  return credit(store, p, 'apple', v, v.transactionId);
}
async function iapGoogle(store, body, p) {
  let v; try { v = await iap.verifyGoogle({ purchaseToken: body.purchaseToken, productId: body.productId, orderId: body.orderId }); }
  catch (e) { throw new ApiError(e.status || 400, 'Google: ' + e.message); }
  return credit(store, p, 'google', v, v.orderId);
}

/* ---------- battle pass ---------- */
const passNeeded = (store, p) => { const s = passLive(store, now(), p); if (!s) throw new ApiError(404, 'the battle pass is not on'); return s; };
// The pass page asks for the latest state when it opens (the session has it too).
function passView(store, body, p) { return { ...wallet(store, p), catalog: catalog(store, p) }; }
// Buy the Battle Pass (premium) for this season, or the Battle Bundle (the pass plus bundleLevels levels). Once per season.
function passPremium(store, body, p) {
  const s = passNeeded(store, p), bundle = !!body.bundle, price = bundle ? PASS.bundle : PASS.premium;
  if (passOf(store, p, s).premium) return { ...wallet(store, p), already: true };
  if (Number(p.balance) < price) throw new ApiError(402, `need ${price - Number(p.balance)} more ATP`);
  const w = { balance: Number(p.balance) - price, earned: Number(p.earned), hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) }, now = Date.now();
  store.setWallet(p.id, w); store.passSetPremium(p.id, s.key, now); if (bundle) store.passAddXp(p.id, s.key, PASS.bundleLevels * PASS.levelXp, now);
  Object.assign(p, w); console.log(`$ battle pass ${s.key}${bundle ? ' bundle' : ''} (-${price} ATP)`);
  return { ...wallet(store, p), unlocked: true, bundle };
}
// Claim one reward with Battle Stars: it must be on an open page, free or covered by the Battle Pass, affordable, and not claimed yet.
function passClaim(store, body, p) {
  const s = passNeeded(store, p), r = passReward(s, String(body.reward || ''));
  if (!r) throw new ApiError(404, 'no such reward');
  const st = passOf(store, p, s);
  if (st.claimed.includes(r.id)) return { ...wallet(store, p), already: true };
  if (r.page >= st.pages) throw new ApiError(403, `page ${r.page + 1} is still locked`);
  if (!r.free && !st.premium) throw new ApiError(403, 'that reward needs the Battle Pass');
  if (st.stars < r.stars) throw new ApiError(402, `need ${r.stars - st.stars} more Battle Stars`);
  const now = Date.now();
  if (!store.passClaim(p.id, s.key, r.id, now)) return { ...wallet(store, p), already: true };
  let atp = r.atp || 0, skin = r.skin || null, refund = 0;
  if (skin && store.skins(p.id).includes(skin)) { refund = (skinById(skin) || {}).price || 0; atp += refund; skin = null; } // owned already: its shop price instead
  if (skin) store.addSkin(p.id, skin, now);
  if (atp) { const w = { balance: Number(p.balance) + atp, earned: Number(p.earned) + atp, hour_at: Number(p.hour_at), hour_sum: Number(p.hour_sum) }; store.setWallet(p.id, w); Object.assign(p, w); }
  return { ...wallet(store, p), claimed: { reward: r.id, atp, skin, refund } };
}
// /admin/pass: the switch, the season and how many are playing it; the testers, and who opened the game lately (to pick them)
const adminPlayer = (store, r) => ({ id: r.id, name: (r.name && !nameBlocked(r.name) && r.name) || 'Unnamed cell', seen: Number(r.seen) || 0, runs: Number(r.runs || 0), level: levelOf(r.xp).level, account: (store.identities(r.id)[0] || {}).provider || null });
function passAdmin(store, on, tester) {
  if (on != null) { store.setFlag('pass', on ? 'on' : 'off'); console.log(`battle pass switched ${on ? 'on' : 'off'}`); }
  if (tester) { passTesterSet(store, String(tester.id || ''), !!tester.on); console.log(`battle pass tester ${tester.on ? 'added' : 'removed'}`); }
  const testers = passTesters(store).map(id => store.player(id)).filter(Boolean).map(r => adminPlayer(store, r));
  const recent = store.recentPlayers(Date.now() - 30 * 60 * 1000, 12).map(r => adminPlayer(store, r));
  const s = passSeason(), next = PASS_SEASONS.find(x => Date.parse(x.from) > now());
  const quests = s && { today: store.questStats(questsAt('day').period), week: store.questStats(questsAt('week').period) };
  return { on: store.flag('pass') === 'on', live: !!passLive(store), season: passCatalog(s), next: next ? { key: next.key, name: next.name, starts: Date.parse(next.from) } : null, stats: s ? { ...store.passStats(s.key), quests } : null, testers, recent };
}

function leaderboard(store) { return { top: store.top(10).map((r, i) => ({ rank: i + 1, name: (r.name && !nameBlocked(r.name) && r.name) || 'Unnamed cell', rating: r.rating, tier: tierOf(r.rating), runs: r.runs })) }; }

module.exports = { SKINS, PACKS, RULES, RATING, RATING_AI, WINS, winBonus, runKind, XP, SEASONS, seasonOpen, PASS, PASS_SEASONS, passSeason, passLive, passAdmin, QUESTS, QUEST_SLOTS, questsAt, questsOf, questsTick, isoWeekOf, catalog, payoutFor, ratingDelta, xpFor, levelOf, xpAtLevel, xpToNext, tierOf, nameBlocked, ApiError, auth, handlers: { deleteAccount, session, runStart, runEnd, buySkin, iapApple, iapGoogle, leaderboard, signInApple, signInGoogle, signOut, passView, passPremium, passClaim } };
