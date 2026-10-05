"""Record a Mitosis practice run, one game frame per video frame, with a fake clock.

The game's own bot brain steers the player cell (see the __AI hook in index.html).
Writes <out>.mp4 (1080x1920 master) and <out>.jsonl (per-frame game stats).
"""
import argparse, base64, json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, '..', '..', 'index.html'))   # the repo's game page
ORIGIN = 'http://mitosis.local'


def patched_page(path):
    """Recording-only changes, applied in memory (the game file is never modified):
    the game's own bot brain steers the player, any skin can be worn, no auto low-detail mode,
    and hooks for reading state / starting a practice run."""
    s = open(path, encoding='utf-8').read()
    reps = [
        ("  if(human&&human.alive){\n    if(paused)",
         "  if(human&&human.alive&&window.__AI){if(T>=human.ai.t){think(human);human.ai.t=Math.min(human.ai.t,T+(window.__THINK||.1));}}\n  else if(human&&human.alive){\n    if(paused)"),
        ("if(settings.skin>=SKIN_FREE&&!ownsSkin(settings.skin))settings.skin=0;",
         "if(!window.__REC&&settings.skin>=SKIN_FREE&&!ownsSkin(settings.skin))settings.skin=0;"),
        ("if(!lowFx&&mode==='play'&&!paused){playT+=raw;if(playT>5&&ema>27)lowFx=true;}",
         "if(!window.__REC&&!lowFx&&mode==='play'&&!paused){playT+=raw;if(playT>5&&ema>27)lowFx=true;}"),
        ("if(!BISECT.nocanvas)draw();", "if(!BISECT.nocanvas&&!window.__NODRAW)draw();"),
        ("if(!BISECT.nohud)hud();", "if(!BISECT.nohud&&!window.__NODRAW)hud();"),
    ]
    for a, b in reps:
        if a not in s:
            sys.exit('index.html changed: could not apply recording patch near: ' + a[:60])
        s = s.replace(a, b, 1)
    hook = """window.__G=()=>{let m=0,n=0;if(human)for(const c of human.cells)if(!c.dead){m+=c.mass;n++;}
  let rank=0;if(human&&human.alive){const tot=p=>p.cells.reduce((a,c)=>a+(c.dead?0:c.mass),0);const mm=tot(human);rank=1+players.filter(p=>p!==human&&p.alive&&tot(p)>mm).length;}
  return{mode,T,alive:!!(human&&human.alive),mass:Math.round(m),ncells:n,eaten:human?human.stats.eaten:0,killer:human?human.stats.killer:'',leader:!!(human&&leader===human),evo:human?human.evo:0,rank,ev:ev&&ev.type||0,players:players.filter(p=>p.alive).length,rt:roundT(),over:round.over,place:human?placeOf().place:0,of:human?placeOf().of:0};};
window.__play=o=>{$('nameIn').value=o.name||'';settings.skin=o.skin|0;settings.stain=o.stain|0;settings.diff=o.diff||'standard';
  if(local==='practice')startGame();else startLocal('practice');
  human.ai={t:0,aggr:o.aggr??.9,pers:PERS[o.pers||'hunter'],shotT:0};window.__AI=true;};
"""
    marker = "/* ================= loop ================= */"
    if marker not in s:
        sys.exit('index.html changed: loop marker not found')
    return s.replace(marker, hook + marker, 1)

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--game', default=GAME)                    # path to Mitosis index.html
ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--seconds', type=float, default=60)      # gameplay seconds to film
ap.add_argument('--warmup', type=float, default=3)        # gameplay seconds to run before filming
ap.add_argument('--fps', type=int, default=30)
ap.add_argument('--skin', type=int, default=0)
ap.add_argument('--stain', type=int, default=0)
ap.add_argument('--name', default='Nucleus')
ap.add_argument('--pers', default='hunter')
ap.add_argument('--aggr', type=float, default=0.9)
ap.add_argument('--diff', default='standard')
ap.add_argument('--after-death', type=float, default=5)   # seconds to keep filming after a death
ap.add_argument('--respawn', action='store_true')         # respawn after a death instead of stopping
ap.add_argument('--film-from', type=float, default=None)  # start filming at this round-clock second (fast-forward without drawing)
ap.add_argument('--min-mass', type=float, default=0)      # with --film-from: need at least this mass then, else try the next seed
ap.add_argument('--tries', type=int, default=1)           # seeds to try for --min-mass (seed, seed+1, ...)
ap.add_argument('--until-end', action='store_true')       # stop filming --after-end s after the round ends (results screen)
ap.add_argument('--after-end', type=float, default=6)
args = ap.parse_args()

INIT_TMPL = """
(() => {
  let a = %d >>> 0;
  Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__REC = true;
  window.requestAnimationFrame = cb => { window.__raf = cb; return 1; };   // the recorder pumps frames itself
  window.__pump = () => { const c = window.__raf; window.__raf = null; if (c) c(performance.now()); return window.__G ? window.__G() : null; };
  window.WebSocket = function () { this.readyState = 0; this.send = () => {}; this.close = () => {}; };
  addEventListener('DOMContentLoaded', () => { const st = document.createElement('style');
    st.textContent = '#actions,#pauseBtn,#snd,#board,#joy{display:none!important}'; document.head.appendChild(st); });
  try { localStorage.setItem('mitosis.settings', JSON.stringify({name: %s, stain: %d, diff: %s, skin: %d})); } catch (e) {}
})();
"""

FONT_CSS = ''.join(
    "@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-stretch:75%% 100%%;src:url(https://fonts.gstatic.com/local/%s) format('truetype');}" % f
    for f in [('Bricolage Grotesque', '200 800', 'Bricolage.ttf'), ('IBM Plex Mono', '400', 'IBMPlexMono-Regular.ttf'),
              ('IBM Plex Mono', '500', 'IBMPlexMono-Medium.ttf'), ('IBM Plex Mono', '600', 'IBMPlexMono-SemiBold.ttf')])
SHOT = {'format': 'jpeg', 'quality': 92, 'optimizeForSpeed': True, 'clip': {'x': 0, 'y': 0, 'width': 540, 'height': 960, 'scale': 2}}


def open_game(b, seed):
    ctx = b.new_context(viewport={'width': 540, 'height': 960}, device_scale_factor=2)
    page_html = patched_page(args.game)
    ctx.route(ORIGIN + '/', lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=page_html))
    # practice runs need no server: answer the page's API calls with empty JSON
    ctx.route(ORIGIN + '/api/**', lambda r: r.fulfill(status=404, content_type='application/json', body='{}'))
    if os.path.isdir(os.path.join(HERE, 'fonts')):
        # serve the game's Google fonts from ./fonts (works offline / where fonts.googleapis.com is blocked)
        ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=FONT_CSS))
        ctx.route('https://fonts.gstatic.com/local/*', lambda r: r.fulfill(status=200, content_type='font/ttf',
                  body=open(os.path.join(HERE, 'fonts', r.request.url.rsplit('/', 1)[1]), 'rb').read()))
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.install(time=1_790_000_000_000)
    pg.add_init_script(INIT_TMPL % (seed, json.dumps(args.name), args.stain, json.dumps(args.diff), args.skin))  # after the fake clock
    pg.goto(ORIGIN + '/')
    return ctx, pg, errs


def main():
    opts = dict(name=args.name, skin=args.skin, stain=args.stain, pers=args.pers, aggr=args.aggr, diff=args.diff)
    ms = [round((i + 1) * 1000 / args.fps) - round(i * 1000 / args.fps) for i in range(args.fps)]
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--mute-audio'])
        for attempt in range(max(1, args.tries)):
            seed = args.seed + attempt
            ctx, pg, errs = open_game(b, seed)
            k = 0
            def tick():
                nonlocal k
                pg.clock.run_for(ms[k % args.fps]); k += 1
                return pg.evaluate('window.__pump()')
            for _ in range(45): tick()                      # lobby settles, fonts load
            pg.evaluate('o => window.__play(o)', opts)
            t0 = time.time()
            if args.film_from is not None:
                pg.evaluate('window.__NODRAW = true')      # simulate only: much faster than drawing
                g = tick()
                doomed = False
                while g['rt'] < args.film_from and not g['over']:
                    g = tick()
                    if not g['alive'] and not g['over']:
                        if args.min_mass and g['rt'] > args.film_from - 90 and attempt < args.tries - 1:
                            doomed = True; break             # too late to regrow: try the next seed now
                        pg.evaluate('o => window.__play(o)', opts)
                if doomed:
                    print(f'seed {seed}: died at {g["rt"]:.0f}s, too late to regrow ({time.time()-t0:.0f}s)', flush=True)
                    ctx.close(); continue
                print(f'seed {seed}: at {g["rt"]:.0f}s mass={g["mass"]} rank={g["rank"]} ({time.time()-t0:.0f}s fast-forward)', flush=True)
                if g['mass'] < args.min_mass and attempt < args.tries - 1:
                    ctx.close(); continue
                pg.evaluate('window.__NODRAW = false')
                for _ in range(10): tick()                  # let the camera and HUD catch up before filming
            else:
                for _ in range(int(args.warmup * args.fps)):
                    g = tick()
                    if not g['alive']:
                        print('died during warmup; respawning', file=sys.stderr); pg.evaluate('o => window.__play(o)', opts)
            break
        cdp = ctx.new_cdp_session(pg)
        json.dump(dict(seed=seed, skin=args.skin, name=args.name, pers=args.pers, aggr=args.aggr, diff=args.diff,
                       film_from=args.film_from), open(args.out + '.meta.json', 'w'))
        ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(args.fps),
                               '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
                               args.out + '.mp4'], stdin=subprocess.PIPE)
        log = open(args.out + '.jsonl', 'w')
        n, dead_at, lives, over_at, t1 = 0, None, 1, None, time.time()
        while n < args.seconds * args.fps:
            g = tick()
            ff.stdin.write(base64.b64decode(cdp.send('Page.captureScreenshot', SHOT)['data']))
            g['f'] = n; g['life'] = lives
            log.write(json.dumps(g) + '\n')
            n += 1
            if g['over'] and over_at is None:
                over_at = n
            if args.until_end and over_at is not None and n - over_at > args.after_end * args.fps:
                break
            if not g['alive'] and not g['over']:
                if dead_at is None: dead_at = n
                elif n - dead_at > args.after_death * args.fps:
                    if not args.respawn: break
                    pg.evaluate('o => window.__play(o)', opts); dead_at = None; lives += 1
            if n % (args.fps * 15) == 0:
                print(f'{args.out}: {n/args.fps:.0f}s filmed, {time.time()-t1:.0f}s elapsed, round {g["rt"]:.0f}s, '
                      f'mass={g["mass"]} rank={g["rank"]} life={lives}', flush=True)
        ff.stdin.close(); ff.wait(); log.close()
        print(f'done {args.out}: seed {seed}, {n} frames ({n/args.fps:.0f}s) in {time.time()-t1:.0f}s; errors={errs[:3]}')
        b.close()


main()
