// Live players: how many people are connected to this server right now, what they are doing, whether they came
// from the website or an app, and a minute-by-minute history of the last 24 hours, kept in a small file so
// restarts and deploys keep it. It is all read from the relay connection every game opens when it starts, so it
// works with the app versions already on phones. Only counts are kept: no player ids, no IP addresses.
'use strict';
const fs = require('fs');

const PRESENCE_FRESH = 3000; // a game whose page is drawing sends its presence about 15 times a second
const PING_FRESH = 9500;     // and, while visible, a ping every 4 s, also during a game on the device (2.3.0 and the website)
const RUN_MAX = 12 * 60e3;   // a life can't outlast a 10-minute round, so runs that never end (app closed) drop out
const MIN = 60e3, DAY_MIN = 24 * 60;
const COLS = ['online', 'playing', 'arena', 'solo', 'web', 'ios', 'android', 'other', 'full'];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; // the game's number encoding (enc() in index.html)

/** Website or app, from the relay handshake. The apps load the game from a file inside the app, so their
 *  connections carry no web origin; the user agent then tells the iOS app (WKWebView: no "Safari/") from Android's WebView. */
function platformOf(h) {
  const origin = String(h.origin || '').toLowerCase(), ua = String(h['user-agent'] || '');
  if (/^https?:/.test(origin)) return { plat: 'web', mob: /Mobi|Android|iPhone|iPod/.test(ua) };
  if (/Android/.test(ua) && /; wv\)|Version\/\d/.test(ua)) return { plat: 'android', mob: true };
  if (/\b(iPhone|iPad|iPod|Macintosh)\b/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\/|Chrome|CriOS|FxiOS|Firefox/.test(ua)) return { plat: 'ios', mob: true };
  return { plat: 'other', mob: false }; // a page opened from a file in a browser, a test tool, a script
}

/** What a connection is doing. Presence says whether the player's cell is alive in the shared arena (a) or the
 *  player is searching for a round (q). A game on the device (practice, or bots after a search) stops sending
 *  presence but keeps pinging; a page in the background does neither. */
function activityOf(c, now) {
  if (now - (c.pAt || 0) < PRESENCE_FRESH) return c.p && c.p.a === 1 ? 'arena' : c.p && c.p.q === 1 ? 'searching' : 'menus';
  return now - (c.pingAt || 0) < PING_FRESH ? 'solo' : 'away';
}

function tally(conns, now) {
  const s = { online: 0, playing: 0, arena: 0, searching: 0, solo: 0, menus: 0, away: 0, web: 0, webPhone: 0, ios: 0, android: 0, other: 0 };
  for (const c of conns) { s.online++; s[activityOf(c, now)]++; s[c.plat] = (s[c.plat] || 0) + 1; if (c.plat === 'web' && c.mob) s.webPhone++; }
  s.playing = s.arena + s.solo;
  return s;
}

const dec = s => { let n = 0; for (const ch of s) { const i = B64.indexOf(ch); if (i < 0) return null; n = n * 64 + i; } return n; };
/** Seconds into an arena room's round, from its host's presence (rd: round id, then tenths of a second). */
function roundClock(conns, now) {
  for (const c of conns) if (c.p && c.p.h === 1 && typeof c.p.rd === 'string' && c.p.rd.length === 5 && now - c.pAt < PRESENCE_FRESH) {
    const t = dec(c.p.rd.slice(2)); if (t != null) return t / 10;
  }
  return null;
}

/** The tracker for one server. conns() lists the relay connections that have joined, rooms() the arena rooms they
 *  are in (each a set of connections, up to roomSize), and cap is how many games the server takes in all. */
function create({ file, conns, rooms = () => [], roomSize, cap }) {
  const runs = new Map(), streams = new Set();
  let rows = [], best = null, last = '', wrote = 0;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(d.rows)) rows = d.rows.filter(r => Array.isArray(r) && r.length === COLS.length + 1 && r.every(Number.isFinite));
    if (d.best && d.best.n > 0) best = { n: +d.best.n, at: +d.best.at };
  } catch (e) {}
  const save = () => { const tmp = file + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify({ cols: COLS, rows, best })); fs.renameSync(tmp, file); } catch (e) {} };

  // one row a minute: [minute since 1970, then the busiest second of that minute for each of COLS ('full' is a count)]
  function bucket(now) {
    const m = Math.floor(now / MIN); let r = rows[rows.length - 1];
    if (r && r[0] >= m) return r;
    if (r) save(); // the previous minute is complete
    r = [m, ...COLS.map(() => 0)]; rows.push(r);
    while (rows[0][0] <= m - DAY_MIN) rows.shift();
    return r;
  }
  function runsOpen(now) { for (const [id, at] of runs) if (now - at > RUN_MAX) runs.delete(id); return runs.size; }
  function snapshot(now = Date.now()) {
    const list = [...conns()], s = tally(list, now);
    // each arena room in order: its games, how many play in it, and its own round clock
    const rs = [...rooms()].map(r => { const l = [...r], t = tally(l, now); return { games: l.length, arena: t.arena, searching: t.searching, round: roundClock(l, now) }; });
    const busy = rs.filter(r => r.round != null).sort((a, b) => b.arena + b.searching - a.arena - a.searching || b.games - a.games)[0];
    // a ranked life needs a game still connected and playing; this drops lives whose app was closed mid-game at once
    return { at: now, ...s, ranked: Math.min(runsOpen(now), s.arena + s.solo + s.away), cap, roomSize, rooms: rs, round: busy ? busy.round : null, best };
  }
  function send(text) {
    wrote = Date.now();
    for (const res of streams) { if (res.writableLength > 1 << 20) { res.destroy(); streams.delete(res); } else res.write(text); }
  }
  function tick() {
    const now = Date.now(), s = snapshot(now), r = bucket(now);
    COLS.forEach((k, i) => { if (k !== 'full') r[i + 1] = Math.max(r[i + 1], s[k]); });
    if (s.online > 0 && (!best || s.online > best.n)) s.best = best = { n: s.online, at: now };
    const msg = JSON.stringify({ ...s, cur: r }), key = msg.replace(/^\{"at":\d+/, '');
    if (key !== last) { last = key; if (streams.size) send(`event: now\ndata: ${msg}\n\n`); }
    else if (streams.size && now - wrote > 20000) send(': still here\n\n');
  }
  setInterval(tick, 1000).unref();
  /** Everything the dashboard shows, with the 24-hour history. */
  function json(now = Date.now()) { bucket(now); return { ...snapshot(now), cols: COLS, rows }; }

  return {
    tick, snapshot, json,
    /** Server-sent events: the whole picture once, then each change (joins and leaves at once, the rest within a second). */
    stream(req, res) {
      if (streams.size >= 20) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('Too many dashboards open'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\n\nevent: all\ndata: ${JSON.stringify(json())}\n\n`);
      streams.add(res);
      const drop = () => streams.delete(res); req.on('close', drop); res.on('error', drop);
    },
    turnedAway() { bucket(Date.now())[COLS.indexOf('full') + 1]++; },
    runStarted(id) { if (typeof id === 'string') { runs.set(id, Date.now()); if (runs.size > 5000) runsOpen(Date.now()); } },
    runEnded(id) { runs.delete(String(id)); },
    page,
  };
}

/** The dashboard: a self-contained page that listens to /admin/live/stream with the same token. */
function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mitosis live players</title><style>
:root{--bg:#06100f;--card:#0b1a18;--ink:#dcefe9;--mut:#8fb3aa;--line:#1d3330;--ok:#5fe0a8;--warn:#f2b134;--bad:#ff6b6b;--s1:#3987e5;--s2:#d95926}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif;padding:24px max(16px,calc(50% - 560px))}
h1{font-size:26px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em}
p{color:var(--mut);margin:0 0 6px}a{color:var(--ink)}.n{font-variant-numeric:tabular-nums}
.st{display:inline-flex;align-items:center;gap:6px}.dot{width:8px;height:8px;border-radius:50%;background:var(--mut)}.live .dot{background:var(--ok)}.down .dot{background:var(--warn)}
.hero{display:flex;gap:36px;flex-wrap:wrap;align-items:flex-end;margin:18px 0 4px}.hero .big b{display:block;font-size:64px;line-height:1;font-weight:650}
.hero .big span,.hs span{color:var(--mut)}.hs{display:flex;gap:28px;flex-wrap:wrap}.hs b{display:block;font-size:28px;font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:26px;font-weight:600}
.tile .l{color:var(--ink);font-weight:600}.tile .d{color:var(--mut);font-size:12px;margin-top:2px}
.meter{height:6px;border-radius:3px;background:var(--line);margin-top:8px;overflow:hidden}.meter i{display:block;height:100%;background:var(--ok);border-radius:3px}.meter.warn i{background:var(--warn)}.meter.bad i{background:var(--bad)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;position:relative}
.legend{display:flex;gap:18px;color:var(--mut);font-size:12px;margin-bottom:6px}.legend i{display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:6px;border-radius:1px}
#chart svg{display:block;width:100%;outline:none}#chart text{fill:var(--mut);font-size:11px}#chart .ax{stroke:var(--line);stroke-width:1}#chart .mid{stroke:#2f514c}
.tip{position:absolute;pointer-events:none;background:#020807;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;min-width:150px;box-shadow:0 6px 20px #0008}
.tip .h{color:var(--mut);margin-bottom:4px}.tip div{display:flex;align-items:center;gap:8px;white-space:nowrap}.tip b{min-width:22px;text-align:right}.tip i{width:12px;height:2px;display:inline-block}.tip .sub{color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right}td:first-child,th:first-child{text-align:left}
th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em}summary{cursor:pointer;color:var(--mut);margin-top:14px}
.foot{margin-top:22px;font-size:12px}.foot b{color:var(--ink);font-weight:600}
</style></head><body>
<h1>Live players</h1><p><span id="st" class="st"><span class="dot"></span><span id="stt">Connecting…</span></span> · <a id="netLink" href="#">Connection report</a> · <a id="jsonLink" href="#">JSON</a></p>
<div class="hero"><div class="big"><b id="online">–</b><span>online now</span></div>
<div class="hs"><div><b id="playing">–</b><span>playing now</span></div><div><b id="peak">–</b><span id="peakAt">peak today</span></div><div><b id="best">–</b><span id="bestAt">most at once</span></div></div></div>
<h2>What they are doing</h2><div class="tiles" id="doing"></div>
<h2>Where from</h2><div class="tiles" id="from"></div>
<h2>Rooms</h2><div class="tiles" id="rooms"></div>
<h2>Last 24 hours</h2>
<div class="card"><div class="legend"><span><i style="background:var(--s1)"></i>Online</span><span><i style="background:var(--s2)"></i>Playing</span></div><div id="chart"></div><div id="tip" class="tip" hidden></div></div>
<details><summary>Table: the busiest minute of each hour</summary><table id="tbl"></table></details>
<p class="foot"><b>Online</b> is every game connected to this server: the website and the iPhone and Android apps open the connection when they start, menus included. <b>Playing</b> is players in the live arena plus solo games. <b>Solo games</b> (practice, or bots after a search) are seen from games that keep pinging the server without sending arena moves: the website and app 2.3.0 or later; older apps in a solo game count as <b>Away</b>, like a page left in the background. Nearby (Bluetooth) games and offline play never reach the server. Each point on the chart is the busiest second of that minute; gaps are times the server was off. Times are in this device's time zone. Nothing that identifies a player is kept.</p>
<script>
(()=>{
const $=id=>document.getElementById(id),tok=new URLSearchParams(location.search).get('token')||'',T='?token='+encodeURIComponent(tok);
$('netLink').href='/admin/net'+T;$('jsonLink').href='/admin/live'+T+'&format=json';
let cols=[],rows=[],cur=null,hover=null;
const col=k=>cols.indexOf(k)+1,MIN=60000;
const fmtT=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const fmtD=t=>new Date(t).toLocaleDateString([],{month:'short',day:'numeric'})+', '+fmtT(t);
const pct=(a,b)=>b?Math.round(a/b*100)+'%':'–';
function tiles(id,list){const el=$(id);el.textContent='';for(const t of list){const d=document.createElement('div');d.className='tile';
  const b=document.createElement('b');b.textContent=t.v;const l=document.createElement('div');l.className='l';l.textContent=t.l;const s=document.createElement('div');s.className='d';s.textContent=t.d;
  d.append(b,l,s);if(t.m!=null){const m=document.createElement('div');m.className='meter'+(t.m>=1?' bad':t.m>=.75?' warn':'');const i=document.createElement('i');i.style.width=Math.min(100,t.m*100)+'%';m.append(i);d.append(m);}el.append(d);}}
function upsert(r){const l=rows[rows.length-1];if(l&&l[0]===r[0])rows[rows.length-1]=r;else if(!l||r[0]>l[0])rows.push(r);while(rows.length&&rows[0][0]<=r[0]-1440)rows.shift();}
function midnight(){const d=new Date();d.setHours(0,0,0,0);return d.getTime();}
function render(){
  if(!cur)return;const s=cur,on=s.online;
  $('online').textContent=on;$('playing').textContent=s.playing;
  const m0=midnight()/MIN,today=rows.filter(r=>r[0]>=m0);let pk=null;for(const r of today)if(!pk||r[col('online')]>pk[col('online')])pk=r;
  $('peak').textContent=pk?pk[col('online')]:'–';$('peakAt').textContent=pk&&pk[col('online')]?'peak today, '+fmtT(pk[0]*MIN):'peak today';
  $('best').textContent=s.best?s.best.n:'–';$('bestAt').textContent=s.best?'most at once, '+fmtD(s.best.at):'most at once';
  tiles('doing',[
    {v:s.arena,l:'In the live arena',d:'cell alive in the shared multiplayer round'},
    {v:s.searching,l:'Searching',d:'waiting for the next round to open'},
    {v:s.solo,l:'Solo game',d:'practice, or bots after a search'},
    {v:s.menus,l:'In the menus',d:'start page, shop, between lives'},
    {v:s.away,l:'Away',d:'in the background (or a solo game on an older app)'}]);
  tiles('from',[
    {v:s.web,l:'Website',d:s.web?s.webPhone+' on phones or tablets, '+(s.web-s.webPhone)+' on computers':'in a browser'},
    {v:s.ios,l:'iPhone & iPad app',d:pct(s.ios,on)+' of online'},
    {v:s.android,l:'Android app',d:pct(s.android,on)+' of online'},
    {v:s.other,l:'Other',d:'a copy of the game opened from a file, test tools'}]);
  const clock=t=>t==null?null:Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
  const fullToday=today.reduce((n,r)=>n+r[col('full')],0),rc=clock(s.round),rs=s.rooms||[],plural=(n,w)=>n+' '+w+(n===1?'':'s');
  const arenaUsed=rs.filter(r=>r.arena+r.searching>0).length;
  tiles('rooms',[
    {v:arenaUsed+s.solo,l:'Rooms in use',d:(arenaUsed?plural(arenaUsed,'arena room'):'arena empty')+' + '+plural(s.solo,'solo game')+' (each runs on its own device)'},
    {v:on+' / '+s.cap,l:'Arena slots',d:(rs.length>1?plural(rs.length,'room')+' open ('+rs.map(r=>r.games).join(' · ')+' games)':'one room open')+', up to '+s.roomSize+' games each; every connected game holds a slot, menus included',m:on/s.cap},
    {v:rc||'–',l:'Round clock',d:rs.length>1?'busiest room; each room has its own round: '+rs.map(r=>clock(r.round)||'–').join(' · '):rc?'into the 10-minute round (from the host game)':'no game is hosting a round'},
    {v:s.ranked,l:'Ranked lives in progress',d:'arena and bot games that pay ATP; practice is not ranked'},
    {v:fullToday,l:'Turned away today',d:'every arena room full: those players can only practise offline'}]);
  chart();table();
}
const svgNS='http://www.w3.org/2000/svg',el=(n,a,p)=>{const e=document.createElementNS(svgNS,n);for(const k in a)e.setAttribute(k,a[k]);if(p)p.append(e);return e;};
function nice(v){for(const s of [1,2,5,10,20,50,100,200,500,1000])if(v/s<=4)return s;return 2000;}
function chart(){
  const box=$('chart'),W=Math.max(280,box.clientWidth),H=W<500?180:220,L=30,R=12,Tp=10,B=22,pw=W-L-R,ph=H-Tp-B;
  const end=cur.cur[0],start=end-1439,io=col('online'),ip=col('playing');
  const mx=Math.max(4,...rows.map(r=>r[io])),step=nice(mx),top=Math.ceil(mx/step)*step;
  const X=m=>L+(m-start)/1439*pw,Y=v=>Tp+ph-v/top*ph;
  box.textContent='';const svg=el('svg',{viewBox:'0 0 '+W+' '+H,height:H,tabindex:0,role:'img','aria-label':'Players online and playing over the last 24 hours'},box);
  for(let v=0;v<=top;v+=step){el('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),class:'ax'},svg);const t=el('text',{x:L-6,y:Y(v)+4,'text-anchor':'end'},svg);t.textContent=v;}
  const d0=new Date(start*MIN);d0.setMinutes(0,0,0);
  const every=pw<480?6:3; // hours between time labels: fewer on phones so they don't collide
  for(let t=d0.getTime()+3600e3;t<=end*MIN;t+=3600e3){const h=new Date(t).getHours();if(h%every)continue;const x=X(t/MIN);
    if(h===0)el('line',{x1:x,x2:x,y1:Tp,y2:Tp+ph,class:'ax mid'},svg);
    if(x>L+14&&x<W-R-14){const tx=el('text',{x,y:H-6,'text-anchor':'middle'},svg);tx.textContent=h===0?'midnight':new Date(t).toLocaleTimeString([],{hour:'numeric'});}}
  // runs of consecutive minutes; a gap means the server was off
  const segs=[];let sg=null;for(const r of rows){if(r[0]<start)continue;if(!sg||r[0]-sg[sg.length-1][0]>1){sg=[];segs.push(sg);}sg.push(r);}
  const line=(s,i)=>s.map((r,k)=>(k?'L':'M')+X(r[0]).toFixed(1)+' '+Y(r[i]).toFixed(1)).join('');
  for(const s of segs){const a=line(s,io)+'L'+X(s[s.length-1][0]).toFixed(1)+' '+Y(0)+'L'+X(s[0][0]).toFixed(1)+' '+Y(0)+'Z';
    el('path',{d:a,fill:'var(--s1)','fill-opacity':.1},svg);}
  for(const [i,c] of [[io,'var(--s1)'],[ip,'var(--s2)']])for(const s of segs)el('path',{d:line(s,i),fill:'none',stroke:c,'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
  const lr=rows[rows.length-1];if(lr)for(const [i,c] of [[io,'var(--s1)'],[ip,'var(--s2)']])el('circle',{cx:X(lr[0]),cy:Y(lr[i]),r:4,fill:c,stroke:'var(--card)','stroke-width':2},svg);
  const cross=el('line',{y1:Tp,y2:Tp+ph,stroke:'var(--mut)','stroke-width':1,visibility:'hidden'},svg);
  const hit=el('rect',{x:L,y:Tp,width:pw,height:ph,fill:'transparent'},svg);
  const show=m=>{hover=m;const r=rows.find(q=>q[0]===m);const tip=$('tip');if(m==null){cross.setAttribute('visibility','hidden');tip.hidden=true;return;}
    const x=X(m);cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.setAttribute('visibility','visible');
    tip.textContent='';const h=document.createElement('div');h.className='h';h.textContent=fmtT(m*MIN)+(r?'':' · server off');tip.append(h);
    if(r){const add=(v,l,c,sub)=>{const d=document.createElement('div');if(sub)d.className='sub';const k=document.createElement('i');k.style.background=c||'transparent';const b=document.createElement('b');b.textContent=v;const s=document.createElement('span');s.textContent=l;d.append(k,b,s);tip.append(d);};
      add(r[io],'online','var(--s1)');add(r[ip],'playing','var(--s2)');add(r[col('arena')],'in the arena',0,1);add(r[col('solo')],'solo',0,1);
      add(r[col('web')],'website',0,1);add(r[col('ios')],'iOS app',0,1);add(r[col('android')],'Android app',0,1);if(r[col('full')])add(r[col('full')],'turned away',0,1);}
    tip.hidden=false;const bw=box.getBoundingClientRect(),tw=tip.offsetWidth;let left=x+14;if(left+tw>bw.width)left=x-tw-14;tip.style.left=(left+14)+'px';tip.style.top='40px';};
  const at=e=>{const b=svg.getBoundingClientRect(),x=(e.clientX-b.left)*W/b.width;return Math.max(start,Math.min(end,Math.round(start+(x-L)/pw*1439)));};
  hit.addEventListener('pointermove',e=>show(at(e)));hit.addEventListener('pointerleave',()=>show(null));hit.addEventListener('pointerdown',e=>show(at(e)));
  svg.addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();show(Math.max(start,Math.min(end,(hover??end)+(e.key==='ArrowLeft'?-10:10))));});
  svg.addEventListener('blur',()=>show(null));
  if(hover!=null)show(Math.max(start,Math.min(end,hover)));
}
function table(){
  const t=$('tbl'),by=new Map();for(const r of rows){const h=Math.floor(r[0]/60);const o=by.get(h);if(!o||r[col('online')]>o[col('online')])by.set(h,r);}
  t.textContent='';const head=t.insertRow();for(const h of ['Hour','Online','Playing','Arena','Solo','Website','iOS','Android'])head.append(Object.assign(document.createElement('th'),{textContent:h}));
  for(const [h,r] of [...by].sort((a,b)=>b[0]-a[0])){const tr=t.insertRow();const d=new Date(h*3600e3);
    tr.insertCell().textContent=d.toLocaleDateString([],{weekday:'short'})+' '+d.toLocaleTimeString([],{hour:'numeric'});
    for(const k of ['online','playing','arena','solo','web','ios','android']){const c=tr.insertCell();c.className='n';c.textContent=r[col(k)];}}
}
function status(ok,text){$('st').className='st '+(ok?'live':'down');$('stt').textContent=text;}
const es=new EventSource('/admin/live/stream'+T);
es.addEventListener('all',e=>{const d=JSON.parse(e.data);cols=d.cols;rows=d.rows;cur={...d,cur:rows[rows.length-1]};status(true,'Live');render();});
es.addEventListener('now',e=>{if(!cols.length)return;cur=JSON.parse(e.data);upsert(cur.cur);status(true,'Live · '+fmtT(cur.at));render();});
es.onerror=()=>status(false,'Reconnecting…');
let rz=0;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>cur&&chart(),120);});
})();
</script></body></html>`;
}

module.exports = { create, platformOf, activityOf, tally, roundClock, COLS };
