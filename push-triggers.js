// What sends push notifications; push.js does the sending, the switches and the limits. The five kinds Rowan approved
// on Nov 8 2026:
//   party    a friend invites you to a party. Sent as it happens, unless your game is open (you see it there).
//   friends  someone sends you a friend request, or accepts yours. Same.
//   quests   today's quests, in your evening (17:00 to 21:00 where your phone is), if you haven't opened the game since
//            they came out (midnight UTC) and the battle pass is on. Players seen in the last week.
//   pass     a season has started (in the first 3 days after the pass is first live), and a season ends within 3 days
//            while you have rewards you can claim. Players seen in the last 30 days.
//   shop     a limited event (SEASONS in economy.js, with skins in the shop) has opened: in its first 2 days, while 2 or
//            more days remain. Players seen in the last 30 days.
// The timed ones go once per player and event (push.notifyOnce), so the tick every 10 minutes can retry what the quiet
// hours or the daily limits held back, and never sends the same thing twice.
'use strict';
const { localHour } = require('./push');

const DAY = 864e5, HOUR = 3600e3, MIN = 60e3;
const ACTIVE = { quests: 7, pass: 30, shop: 30 };   // days since the player last opened the game
const QUEST_HOURS = [17, 21];                       // the quests reminder, local time
const PASS_START_DAYS = 3, PASS_END_DAYS = 3, SHOP_DAYS = 2;
const PER_TICK = 400;                               // sends per tick at most; the rest go on the next one
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function create({ store, push, economy, social = null, now = () => Date.now(), log = () => {} }) {
  const seenWithin = (p, t, days) => Number(p.seen) > t - days * DAY;
  // the first time this server saw something (a season live, an event open), kept in the store's flags
  const firstSeen = (key, t) => { const v = Number(store.flag(key)); if (v) return v; store.setFlag(key, String(t)); return t; };

  /* ---------- as it happens (social.js events) ---------- */
  async function onSocial(e) {
    if (!e || !e.to || (social && social.online(e.to))) return null; // their game is open: the Friends badge says it
    const name = String(e.name || 'A friend').slice(0, 24);
    if (e.type === 'invite') return push.notify(e.to, 'party', { title: `${name} invited you to a party`, body: 'Tap to join them. The invite lasts 5 minutes.', link: 'friends', collapse: 'party-' + e.party });
    if (e.type === 'request') return push.notify(e.to, 'friends', { title: `${name} wants to be friends`, body: 'Tap to accept, then play in the same arena.', link: 'friends', collapse: 'fr-' + e.from });
    if (e.type === 'accepted') return push.notify(e.to, 'friends', { title: `${name} accepted your friend request`, body: 'Invite them to a party and play together.', link: 'friends', collapse: 'fr-' + e.from });
    return null;
  }

  /* ---------- on a timer ---------- */
  // limited events open now: { id: 'halloween-2026', name, skins, closes }
  function openEvents(t) {
    const y = new Date(t).getUTCFullYear(), out = [];
    for (const [key, ev] of Object.entries(economy.SEASONS)) {
      if (!economy.seasonOpen(key, t)) continue;
      const skins = economy.SKINS.filter(s => s.season === key).length; if (!skins) continue;
      const from = yr => Date.UTC(yr, ev.from[0] - 1, ev.from[1]), opened = from(y) - DAY <= t ? y : y - 1;
      const closeYear = ev.to[0] < ev.from[0] ? opened + 1 : opened, closes = Date.UTC(closeYear, ev.to[0] - 1, ev.to[1]);
      out.push({ id: `${key}-${opened}`, name: ev.name, skins, closes, until: `${MONTHS[ev.to[0] - 1]} ${ev.to[1]}` });
    }
    return out;
  }
  function questsMessage(day) {
    const [a, b] = day.list.map(q => q.text), more = day.list.length - 2, lower = s => s[0].toLowerCase() + s.slice(1);
    return { title: "Today's quests are waiting", body: `${a}, ${lower(b)}${more > 0 ? ` and ${more} more` : ''}. ${day.list[0].xp} Battle Pass XP each.`, link: 'quests', collapse: 'quests' };
  }

  let busy = false;
  async function tick() {
    if (busy) return null;
    busy = true;
    const t = now(), out = { quests: 0, pass: 0, shop: 0, held: 0 };
    try {
      const list = push.players(); if (!list.length) return out;
      const season = economy.passLive(store, t); // the season everybody sees (on, and running)
      const starting = season && t - firstSeen('push:pass-live:' + season.key, t) < PASS_START_DAYS * DAY;
      const ends = season && Date.parse(season.to), ending = season && !starting && ends - t <= PASS_END_DAYS * DAY && ends - t > 6 * HOUR;
      const events = openEvents(t).filter(ev => t - firstSeen('push:event-open:' + ev.id, t) < SHOP_DAYS * DAY && ev.closes - t > SHOP_DAYS * DAY);
      const day = economy.questsAt('day', t);
      let budget = PER_TICK;
      for (const { player, tz } of list) {
        if (budget <= 0) break;
        const p = store.player(player); if (!p) continue;
        const send = async (key, kind, msg) => {
          const r = await push.notifyOnce(player, key, kind, msg);
          if (r.skipped !== 'sent before') budget--;
          if (r.sent) out[kind]++; else if (r.skipped === 'quiet' || r.skipped === 'limit') out.held++;
        };
        if (seenWithin(p, t, ACTIVE.quests) && Number(p.seen) < day.starts && economy.passLive(store, t, p)) {
          const h = localHour(tz || 'UTC', t);
          if (h >= QUEST_HOURS[0] && h < QUEST_HOURS[1]) await send('quests:' + day.key, 'quests', questsMessage(day));
        }
        if (season && seenWithin(p, t, ACTIVE.pass)) {
          if (starting) await send('pass-start:' + season.key, 'pass', { title: `Season ${season.n}: ${season.name} has started`, body: 'A new Battle Pass with skins and ATP to earn. Every ranked life fills it.', link: 'pass', collapse: 'pass' });
          else if (ending) {
            const P = economy.handlers.passView(store, {}, p).pass;
            const left = ends - t, when = left < DAY ? `${Math.round(left / HOUR)} hours` : `${Math.floor(left / DAY)} day${left >= 2 * DAY ? 's' : ''}`;
            if (P && P.claimable > 0) await send('pass-end:' + season.key, 'pass', { title: `${season.name} ends in ${when}`, body: `You have ${P.claimable} reward${P.claimable > 1 ? 's' : ''} ready to claim on the Battle Pass before it's gone.`, link: 'pass', collapse: 'pass' });
          }
        }
        if (seenWithin(p, t, ACTIVE.shop)) for (const ev of events)
          await send('shop:' + ev.id, 'shop', { title: `${ev.name} is back`, body: `${ev.skins} limited ${ev.name} skins are in the Shop until ${ev.until}.`, link: 'shop', collapse: 'shop-' + ev.id });
      }
      if (out.quests || out.pass || out.shop) log(`push: sent ${out.quests} quests, ${out.pass} pass, ${out.shop} shop${out.held ? `, ${out.held} held for later` : ''}`);
      return out;
    } finally { busy = false; }
  }

  function start(every = 10 * MIN) {
    const run = () => tick().catch(e => log('push triggers: ' + (e.stack || e.message)));
    setTimeout(run, MIN).unref();
    setInterval(run, every).unref();
  }

  return { onSocial, tick, start, openEvents };
}

module.exports = { create, ACTIVE, QUEST_HOURS };
