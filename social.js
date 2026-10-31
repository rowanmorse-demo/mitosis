// Friends and parties.
// Friends: every player gets a 6-character friend code. Adding a code sends a request; when the other player
// accepts (or had already asked you), you are friends. Parties: a player invites a friend, the friend joins, and
// whenever either of them presses Play the other's game follows within a few seconds. Party members send the party id
// in their relay hello so they land in the same arena, and in their presence (`pt`) so their games treat each other
// as allies. Online status comes from the games calling /api/social/me (every few seconds in the menus, every
// half-minute in a game), so the relay itself knows nothing about accounts.
// Friend lists live in DATA_DIR/social.json. Parties and online status are memory only: a restart clears them.
'use strict';
const fs = require('fs'), crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const MAX_FRIENDS = 100, MAX_REQUESTS = 50, PARTY_MAX = 2;
const ONLINE_MS = 45e3, INVITE_MS = 5 * 60e3, GO_MS = 60e3;
const STATUSES = new Set(['menu', 'arena', 'practice', 'nearby', 'spectating']);

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

function create({ file, nameBlocked = () => false, now = () => Date.now() }) {
  // players: id -> { code, name, friends: [id], incoming: [id], outgoing: [id] }; codes: code -> id
  let d = { players: {}, codes: {} };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.players && j.codes) d = j; } catch (e) {}
  let dirty = false;
  const save = () => { dirty = true; };
  function flush() {
    if (!dirty) return; dirty = false;
    try { fs.writeFileSync(file + '.tmp', JSON.stringify(d)); fs.renameSync(file + '.tmp', file); }
    catch (e) { console.error('social: friend lists not saved: ' + e.message); }
  }
  setInterval(flush, 2000).unref();
  process.on('exit', flush);

  const seen = new Map();     // player id -> { at, status }
  const parties = new Map();  // party id -> { id, leader, members: [id], invites: Map(id -> at), go: 0, goBy: null }
  const partyOf = new Map();  // player id -> party id

  function rec(p) {
    let r = d.players[p.id];
    if (!r) {
      let code; do { code = Array.from(crypto.randomBytes(6), b => CODE_CHARS[b % CODE_CHARS.length]).join(''); } while (d.codes[code]);
      r = d.players[p.id] = { code, name: null, friends: [], incoming: [], outgoing: [] }; d.codes[code] = p.id; save();
    }
    return r;
  }
  function byCode(code) {
    const id = d.codes[cleanCode(code)];
    if (!id || !d.players[id]) throw fail(404, 'no player has that friend code');
    return id;
  }
  const without = (list, id) => { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); return i >= 0; };
  function online(id) { const s = seen.get(id); return s && now() - s.at < ONLINE_MS ? s.status : null; }
  function card(id) { const r = d.players[id]; return { code: r.code, name: r.name || 'Player ' + r.code.slice(0, 3) }; }

  function setName(p, r, body) {
    // the account's name (checked when a run ends) wins; otherwise the name the game sends, if it passes the same filter
    let name = p.name || String(body.name || '').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16) || null;
    if (name && nameBlocked(name)) name = null;
    if (name && name !== r.name) { r.name = name; save(); }
  }
  function view(id) {
    const r = d.players[id], t = now(), pid = partyOf.get(id), party = pid && parties.get(pid);
    const invites = [];
    for (const q of parties.values()) {
      const at = q.invites.get(id);
      if (at && t - at < INVITE_MS && q.members.length < PARTY_MAX && q.id !== pid) invites.push({ party: q.id, from: card(q.leader) });
    }
    return {
      ...card(id),
      friends: r.friends.filter(f => d.players[f]).map(f => ({ ...card(f), status: online(f) || 'offline', inParty: !!pid && partyOf.get(f) === pid }))
        .sort((a, b) => (a.status === 'offline') - (b.status === 'offline') || a.name.localeCompare(b.name)),
      incoming: r.incoming.filter(f => d.players[f]).map(card),
      outgoing: r.outgoing.filter(f => d.players[f]).map(card),
      party: party ? { id: party.id, leader: card(party.leader).code, members: party.members.map(m => ({ ...card(m), status: online(m) || 'offline' })),
        invited: [...party.invites].filter(([, at]) => t - at < INVITE_MS).map(([m]) => card(m).code),
        go: t - party.go < GO_MS ? party.go : 0, goBy: t - party.go < GO_MS && party.goBy ? card(party.goBy).code : null } : null,
      invites,
    };
  }

  function leaveParty(id) {
    const pid = partyOf.get(id), q = pid && parties.get(pid); partyOf.delete(id);
    if (!q) return;
    without(q.members, id);
    if (q.members.length < 2) { for (const m of q.members) partyOf.delete(m); parties.delete(pid); } // a party of one is no party
    else if (q.leader === id) q.leader = q.members[0];
  }
  function unfriend(a, b) {
    const ra = d.players[a], rb = d.players[b]; let changed = false;
    if (ra) changed = without(ra.friends, b) + without(ra.incoming, b) + without(ra.outgoing, b) > 0 || changed;
    if (rb) changed = without(rb.friends, a) + without(rb.incoming, a) + without(rb.outgoing, a) > 0 || changed;
    for (const q of parties.values()) { if (q.members.includes(a)) q.invites.delete(b); if (q.members.includes(b)) q.invites.delete(a); }
    if (changed) save();
  }
  function befriend(a, b) {
    const ra = d.players[a], rb = d.players[b];
    if (ra.friends.length >= MAX_FRIENDS || rb.friends.length >= MAX_FRIENDS) throw fail(409, `friend lists hold ${MAX_FRIENDS} players`);
    without(ra.incoming, b); without(ra.outgoing, b); without(rb.incoming, a); without(rb.outgoing, a);
    if (!ra.friends.includes(b)) ra.friends.push(b);
    if (!rb.friends.includes(a)) rb.friends.push(a);
    save();
  }

  // API handlers: (store, body, player) like economy.handlers; every one answers with the caller's full view
  const handlers = {
    me(store, body, p) {
      const r = rec(p); setName(p, r, body);
      seen.set(p.id, { at: now(), status: STATUSES.has(body.status) ? body.status : 'menu' });
      return view(p.id);
    },
    add(store, body, p) {
      const r = rec(p), id = byCode(body.code);
      if (id === p.id) throw fail(400, "that's your own friend code");
      if (r.friends.includes(id)) return view(p.id);
      if (r.incoming.includes(id)) { befriend(p.id, id); return view(p.id); } // they had already asked: accept
      const t = d.players[id];
      if (t.incoming.length >= MAX_REQUESTS || r.outgoing.length >= MAX_REQUESTS) throw fail(409, 'too many open friend requests');
      if (!t.incoming.includes(p.id)) t.incoming.push(p.id);
      if (!r.outgoing.includes(id)) r.outgoing.push(id);
      save(); return view(p.id);
    },
    accept(store, body, p) {
      const r = rec(p), id = byCode(body.code);
      if (!r.incoming.includes(id)) throw fail(404, 'no friend request from that player');
      befriend(p.id, id); return view(p.id);
    },
    // unfriends, declines a request, or cancels one you sent
    remove(store, body, p) {
      rec(p); const id = byCode(body.code);
      unfriend(p.id, id);
      if (partyOf.get(p.id) && partyOf.get(p.id) === partyOf.get(id)) leaveParty(p.id);
      return view(p.id);
    },
    partyInvite(store, body, p) {
      const r = rec(p), id = byCode(body.code);
      if (!r.friends.includes(id)) throw fail(403, 'you can only invite friends');
      let pid = partyOf.get(p.id), q = pid && parties.get(pid);
      if (q && q.members.includes(id)) return view(p.id);
      if (q && q.members.length >= PARTY_MAX) throw fail(409, `parties hold ${PARTY_MAX} players`);
      if (!q) {
        pid = crypto.randomBytes(5).toString('hex');
        q = { id: pid, leader: p.id, members: [p.id], invites: new Map(), go: 0, goBy: null };
        parties.set(pid, q); partyOf.set(p.id, pid);
      }
      q.invites.set(id, now());
      return view(p.id);
    },
    partyJoin(store, body, p) {
      rec(p); const q = parties.get(String(body.party || ''));
      if (!q) throw fail(404, 'that party has ended');
      const at = q.invites.get(p.id);
      if (!at || now() - at >= INVITE_MS) throw fail(403, 'that invite has expired');
      if (q.members.length >= PARTY_MAX) throw fail(409, 'that party is full');
      if (partyOf.get(p.id) !== q.id) leaveParty(p.id);
      q.invites.delete(p.id); q.members.push(p.id); partyOf.set(p.id, q.id);
      return view(p.id);
    },
    partyDecline(store, body, p) {
      rec(p); const q = parties.get(String(body.party || ''));
      if (q) q.invites.delete(p.id);
      return view(p.id);
    },
    partyLeave(store, body, p) { rec(p); leaveParty(p.id); return view(p.id); },
    // a member pressed Play: the other members' games join the same arena when they next check in
    partyGo(store, body, p) {
      rec(p); const q = parties.get(partyOf.get(p.id));
      if (!q) throw fail(404, 'not in a party');
      q.go = now(); q.goBy = p.id; return view(p.id);
    },
  };

  return {
    handlers,
    // account deletion: the player disappears from every friend list and party
    forget(id) {
      const r = d.players[id]; leaveParty(id); seen.delete(id);
      for (const q of parties.values()) q.invites.delete(id);
      if (!r) return;
      for (const f of [...r.friends, ...r.incoming, ...r.outgoing]) unfriend(id, f);
      delete d.codes[r.code]; delete d.players[id]; save();
    },
    // sign-in folded a device's player into an account: its friends and requests move to the account
    merge(from, to) {
      const a = d.players[from];
      if (!a || from === to) return;
      const b = d.players[to] || (d.players[to] = { code: null, name: a.name, friends: [], incoming: [], outgoing: [] });
      if (!b.code) { b.code = a.code; d.codes[a.code] = to; } else delete d.codes[a.code];
      for (const key of ['friends', 'incoming', 'outgoing']) for (const f of a[key]) {
        if (f === to || !d.players[f]) continue;
        const o = d.players[f];
        for (const k of ['friends', 'incoming', 'outgoing']) { const i = o[k].indexOf(from); if (i >= 0) { if (o[k].includes(to)) o[k].splice(i, 1); else o[k][i] = to; } }
        if (!b[key].includes(f) && !b.friends.includes(f)) b[key].push(f);
      }
      leaveParty(from); seen.delete(from); delete d.players[from]; save();
    },
    flush,
  };
}

module.exports = { create, PARTY_MAX };
