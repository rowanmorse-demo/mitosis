"""Turn recorded Mitosis takes into edited vertical Shorts.

python3 edit.py raw/takeC raw/takeD --out clips --max 8
For each take it reads <take>.jsonl (per-frame stats) and <take>.mp4 (1080x1920 master),
finds highlight windows (deaths, crowns, feeding streaks), and renders each as an MP4 with:
hook title, event captions, zoom punches on big eats, an original soundtrack with
eat/death SFX, and an end card. Also writes <clip>.json with an upload title/description.
"""
import argparse, json, math, os, random, subprocess, tempfile
import numpy as np
import scipy.io.wavfile as wf
from PIL import Image, ImageDraw, ImageFont
import audio

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
W, H = 1080, 1920
ACCENT = (124, 255, 178)      # mitosis green
GOLD = (255, 204, 77)
RED = (255, 92, 92)
END = 2.4                     # end card seconds (appended after the gameplay)
MIN_DEATH_PEAK = 400          # death clips need a cell that got at least this big
MIN_FEAST_PEAK = 1200         # feeding clips need a big cell


# ---------------------------------------------------------------- text art
def font(size, weight=800, width=100):
    f = ImageFont.truetype(os.path.join(HERE, 'fonts', 'Bricolage.ttf'), size)
    try:
        f.set_variation_by_axes([min(96, max(12, size // 2)), weight, width])
    except Exception:
        pass
    return f


def text_png(path, lines, size=104, stroke=12, gap=14, pad=40, box=False):
    """lines: list of [(text, rgb), ...] runs. White text with a heavy dark outline (Shorts style)."""
    f = font(size)
    d0 = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
    widths = [sum(d0.textlength(t, font=f) for t, _ in ln) for ln in lines]
    asc, desc = f.getmetrics()
    lh = asc + desc
    w = int(max(widths) + pad * 2 + stroke * 2)
    h = int(len(lines) * lh + (len(lines) - 1) * gap + pad * 2)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if box:
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=44, fill=(8, 14, 20, 200))
    y = pad
    for ln, lw in zip(lines, widths):
        x = (w - lw) / 2
        for t, c in ln:
            d.text((x + 4, y + 7), t, font=f, fill=(0, 0, 0, 150), stroke_width=stroke, stroke_fill=(0, 0, 0, 150))
            d.text((x, y), t, font=f, fill=c + (255,), stroke_width=stroke, stroke_fill=(6, 10, 14, 255))
            x += d.textlength(t, font=f)
        y += lh + gap
    im.save(path)
    return w, h


def endcard_png(path):
    im = Image.new('RGBA', (W, H), (4, 9, 14, 240))
    d = ImageDraw.Draw(im)
    # a soft cell
    cx, cy, r = W // 2, 700, 200
    for k in range(40, 0, -1):
        a = int(5 + 3 * (40 - k))
        d.ellipse([cx - r - k * 4, cy - r - k * 4, cx + r + k * 4, cy + r + k * 4], fill=(60, 200, 150, max(0, 60 - k)))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(40, 170, 125, 255), outline=(150, 255, 205, 255), width=10)
    d.ellipse([cx - 70 + 40, cy - 70 - 30, cx + 70 + 40, cy + 70 - 30], fill=(20, 110, 85, 255))
    d.ellipse([cx - 120, cy + 40, cx - 60, cy + 100], fill=(120, 240, 190, 160))
    f1, f2, f3 = font(190), font(66, 600), font(56, 500)
    for txt, f, y, c in [('MITOSIS', f1, 1060, (255, 255, 255)), ('Free cell arena', f2, 1290, ACCENT),
                         ('Play in your browser', f3, 1390, (200, 215, 225))]:
        tw = d.textlength(txt, font=f)
        d.text(((W - tw) / 2, y), txt, font=f, fill=c + (255,), stroke_width=4 if f is f1 else 0, stroke_fill=(0, 0, 0, 255))
    im.save(path)


# ---------------------------------------------------------------- analysis
def load(take):
    return [json.loads(l) for l in open(take + '.jsonl')]


def events(G):
    ev, last_eat = [], -99
    for i in range(1, len(G)):
        a, b = G[i - 1], G[i]
        if a['life'] != b['life']:
            continue
        if a['alive'] and not b['alive']:
            pk = max(G[x]['mass'] for x in range(max(0, i - 8 * FPS), i) if G[x]['life'] == a['life'])
            ev.append((i, 'death', max(1, pk / 300), pk, b.get('killer', '')))   # peak mass in the 8 s before dying
        if b.get('over') and not a.get('over'):
            ev.append((i, 'end', 1.0, a['mass'] if a['alive'] else 0, (b.get('place', 0), b.get('of', 0), bool(a['alive']))))
        if b.get('over'):
            continue                      # nothing after the round ends counts as a highlight
        if b['alive'] and b['leader'] and not a['leader']:
            ev.append((i, 'crown', 1.0, b['mass']))
        if b['alive'] and b['evo'] > a['evo']:
            ev.append((i, 'evolve', 0.6, b['mass']))
        j = i - 4
        if j >= 0 and G[j]['alive'] and b['alive'] and G[j]['life'] == b['life']:
            dm = b['mass'] - G[j]['mass']
            if dm >= max(10, 0.035 * G[j]['mass']) and i - last_eat > 15:
                ev.append((i, 'eat', float(np.clip(dm / 45, 0.3, 3.0)), dm))
                last_eat = i
    return ev


def death_cause(evs, i):
    for e in evs:
        if e[0] == i and e[1] == 'death' and len(e) > 4:
            return e[4]
    return ''


def candidates(G, ev, L=27.0):
    n, out = len(G), []
    Lf = int(L * FPS)
    # deaths: the build-up and the moment it goes wrong
    for (i, k, s, m, *_) in ev:
        if k == 'death' and m >= MIN_DEATH_PEAK:
            a, b = max(0, i - int(23.5 * FPS)), min(n, i + int(3.5 * FPS))
            if G[a]['life'] != G[i - 1]['life']:
                a = next(x for x in range(a, i) if G[x]['life'] == G[i - 1]['life'] and G[x]['alive'])
            if (b - a) / FPS >= 14:
                out.append(dict(kind='death', a=a, b=b, peak=m))
        if k == 'end' and _[0][2] and _[0][0] > 0:      # survived to the bell
            a, b = max(0, i - int(23.5 * FPS)), min(n, i + int(5.5 * FPS))
            if G[a]['life'] == G[i - 1]['life'] and (b - a) / FPS >= 16:
                out.append(dict(kind='endgame', a=a, b=b, peak=max(G[x]['mass'] for x in range(a, i)), place=_[0][0], of=_[0][1]))
        if k == 'crown':
            a, b = max(0, i - int(17 * FPS)), min(n, i + int(9 * FPS))
            if all(G[x]['life'] == G[i]['life'] for x in (a, b - 1)):
                out.append(dict(kind='crown', a=a, b=b, peak=max(G[x]['mass'] for x in range(a, b))))
    # feeding windows inside one life
    for a in range(0, max(1, n - Lf), 15):
        b = a + Lf
        if b > n or G[a]['life'] != G[b - 1]['life'] or not all(G[x]['alive'] for x in (a, (a + b) // 2, b - 1)):
            continue
        if any(not G[x]['alive'] or G[x].get('over') for x in range(a, b, 5)):
            continue
        pk = max(G[x]['mass'] for x in range(a, b, 3))
        m0, m_end = G[a]['mass'], G[b - 1]['mass']
        # a feeding clip must show real growth and finish near its peak (not a cell that shrank)
        if pk >= MIN_FEAST_PEAK and pk >= 1.25 * max(m0, 1) and m_end >= 0.85 * pk:
            out.append(dict(kind='feast', a=a, b=b, peak=pk))
    for c in out:
        inside = [e for e in ev if c['a'] <= e[0] < c['b']]
        eats = [e for e in inside if e[1] == 'eat']
        m0, m1 = G[c['a']]['mass'], max(1, G[min(c['b'], len(G)) - 1]['mass'])
        c['eats'] = len(eats)
        c['m0'], c['m1'] = m0, (c['peak'] if c['kind'] in ('death', 'endgame') else m1)
        c['score'] = sum(e[2] for e in eats) + 0.6 * math.log(max(1, c['peak']) / max(20, m0) + 1) \
            + (4 + c['peak'] / 250 if c['kind'] == 'death' else 0) + (5 if c['kind'] == 'crown' else 0) \
            + ((9 + (6 if c.get('place') == 1 else max(0, 4 - c.get('place', 9) / 3))) if c['kind'] == 'endgame' else 0) \
            + c['peak'] / 1500
        c['events'] = inside
    return out


def pick(cands, k):
    chosen = []
    for c in sorted(cands, key=lambda c: -c['score']):
        if any(min(c['b'], o['b']) - max(c['a'], o['a']) > 0.25 * (c['b'] - c['a']) for o in chosen):
            continue
        chosen.append(c)
        if len(chosen) >= k:
            break
    return sorted(chosen, key=lambda c: c['a'])


# ---------------------------------------------------------------- copy
HOOKS = {
    'death': [[[('He got ', None), ('TOO greedy', RED)]],
              [[('One mistake.', None)], [("That's all it takes", RED)]],
              [[('From hunter', None)], [('to ', None), ('lunch', RED)]],
              [[('Never get ', None), ('cocky', RED)], [('in Mitosis', None)]],
              [[('Wait for it...', None)]],
              [[('The bigger', None)], [('they are...', RED)]],
              [[('He thought', None)], [('he was ', None), ('safe', RED)]],
              [[('Rise and', None)], [('FALL', RED)]]],
    'crown': [[[('From nothing', None)], [('to ', None), ('#1', GOLD)]],
              [[('Taking the ', None), ('crown', GOLD)]],
              [[('Nobody', None)], [('could stop this', GOLD)]],
              [[('New ', None), ('#1', GOLD), (' in the dish', None)]]],
    'feast': [[[('This cell would', None)], [('NOT stop eating', ACCENT)]],
              [[('Feeding ', None), ('time', ACCENT)]],
              [[('POV: you are', None)], [('the food chain', ACCENT)]],
              [[('Absolute ', None), ('buffet', ACCENT)]],
              [[('Everything', None)], [('is food', ACCENT)]],
              [[('Getting ', None), ('BIGGER', ACCENT)]],
              [[('Nothing is', None)], [('safe from this', ACCENT)]]],
    'endgame': [[[('The final', None)], [('30 seconds', GOLD)]],
                [[('The dish is', None)], [('closing', GOLD)]],
                [[('Last cell', None)], [('standing?', GOLD)]],
                [[('Survive the', None)], [('collapse', GOLD)]],
                [[('10 minutes', None)], [('for this moment', GOLD)]],
                [[('Who survives', None)], [('the final ring?', GOLD)]]],
}
TITLES = {
    'death': ['He got too greedy 💀 #mitosis', 'One mistake in Mitosis 😬', 'From hunter to lunch 💀', 'Never get cocky in Mitosis',
              'Wait for it... 💀 #mitosis', 'The bigger they are... 💀', 'He thought he was safe 😬 #mitosis', 'Rise and FALL in Mitosis 💀'],
    'crown': ['From nothing to #1 👑 #mitosis', 'Taking the crown in Mitosis 👑', 'Nobody could stop this cell', 'New #1 in the dish 👑'],
    'feast': ['This cell would NOT stop eating 🦠', 'Feeding time in Mitosis 🦠', 'POV: you are the food chain',
              'Absolute buffet 🍽️ #mitosis', 'Everything is food 🦠', 'Getting BIGGER in Mitosis 🦠', 'Nothing is safe from this cell 🦠'],
    'endgame': ['The final 30 seconds of Mitosis ⏳', 'The dish is closing ⏳ #mitosis', 'Last cell standing? 👀 #mitosis',
                'Survive the collapse ⏳ #mitosis', '10 minutes for this moment 👀', 'Who survives the final ring? ⏳'],
}


DISSOLVE_HOOK = [[('Stay inside', None)], [('the ring', RED)]]
DISSOLVE_TITLE = 'Stay inside the ring 😬 #mitosis'
_used = {}


def next_hook(kind, rng):
    """cycle through a kind's hooks in a shuffled order so a batch doesn't repeat itself"""
    q = _used.get(kind)
    if not q:
        q = list(range(len(HOOKS[kind])))
        rng.shuffle(q)
        _used[kind] = q
    return q.pop()


def fill(lines):
    return [[(t, c or (255, 255, 255)) for t, c in ln] for ln in lines]


# ---------------------------------------------------------------- render
def zoom_expr(evs, a):
    """sum of short gaussian punches at the biggest eats/deaths, as an ffmpeg expression of t."""
    big = sorted([e for e in evs if e[1] in ('eat', 'death', 'crown', 'end')], key=lambda e: -e[2])[:8]
    terms = []
    for (i, k, s, m, *_) in big:
        t = (i - a) / FPS
        amp = 0.07 if k in ('death', 'crown', 'end') else 0.03 + 0.02 * min(s, 2)
        terms.append(f'{amp:.3f}*exp(-pow((t-{t:.3f})/0.14\\,2))')
    return '1+' + '+'.join(terms) if terms else '1'


def render(take, c, idx, outdir, rng):
    a, b = c['a'], c['b']
    dur = (b - a) / FPS
    tmp = tempfile.mkdtemp(dir=outdir)
    hi = next_hook(c['kind'], rng)
    if c['kind'] == 'death' and death_cause(c['events'], next((e[0] for e in c['events'] if e[1] == 'death'), -1)) == 'the collapse':
        hook, title = DISSOLVE_HOOK, DISSOLVE_TITLE
    else:
        hook, title = HOOKS[c['kind']][hi], TITLES[c['kind']][hi]
    hook_lines = fill(hook)
    if c['kind'] == 'endgame':
        sub = f"final ring · {c['m1']:,} mass"
    elif c['kind'] == 'death':
        sub = f"peaked at {c['m1']:,} mass"
    else:
        sub = f"{c['m0']:,} → {c['m1']:,} mass"
    text_png(f'{tmp}/hook.png', hook_lines, size=104)
    text_png(f'{tmp}/sub.png', [[(sub, (220, 232, 240))]], size=52, stroke=8, pad=24)
    endcard_png(f'{tmp}/end.png')
    overlays = [(f'{tmp}/hook.png', 0.15, 3.2, 300), (f'{tmp}/sub.png', 0.45, 3.2, None)]
    # event captions
    capn = 0
    eats_t = [(e[0] - a) / FPS for e in c['events'] if e[1] == 'eat']
    for (i, k, s, m, *_) in c['events']:
        t = (i - a) / FPS
        if k == 'death':
            word = 'DISSOLVED' if death_cause(c['events'], i) == 'the collapse' else 'EATEN'
            text_png(f'{tmp}/cap{capn}.png', [[(word, RED)]], size=150 if word == 'EATEN' else 130, stroke=16)
            overlays.append((f'{tmp}/cap{capn}.png', t + 0.05, min(dur, t + 3.3) - 0.05, 120)); capn += 1  # above the game's death card
        elif k == 'end' and c['kind'] == 'endgame':
            pl, of = c.get('place', 0), c.get('of', 0)
            word, colr = ('VICTORY', GOLD) if pl == 1 else (f'#{pl} OF {of}', ACCENT)
            text_png(f'{tmp}/cap{capn}.png', [[(word, colr)]], size=140, stroke=16)
            overlays.append((f'{tmp}/cap{capn}.png', t + 0.1, dur - 0.05, 120)); capn += 1
        elif k == 'crown':
            text_png(f'{tmp}/cap{capn}.png', [[('#1 IN THE DISH', GOLD)]], size=100, stroke=14)
            overlays.append((f'{tmp}/cap{capn}.png', t, min(dur, t + 2.6), 1180)); capn += 1
        elif k == 'eat' and m >= 25 and t > 3.4 and t < dur - 1 and not any(e[1] in ('death', 'end') and 0 <= e[0] - i < 2 * FPS for e in c['events']):
            streak = sum(1 for x in eats_t if t - 4 <= x <= t)
            label = f'COMBO x{streak}' if streak >= 3 else f'+{int(m)}'
            text_png(f'{tmp}/cap{capn}.png', [[(label, ACCENT if streak < 3 else GOLD)]], size=88 if streak < 3 else 96, stroke=12)
            overlays.append((f'{tmp}/cap{capn}.png', t, min(dur, t + 1.1), 1220)); capn += 1
    # audio
    aev = [((i - a) / FPS, 'crown' if k == 'end' else k, s) for (i, k, s, m, *_) in c['events'] if k in ('eat', 'death', 'crown', 'evolve', 'end')]
    track = audio.make_track(dur + END, aev, seed=idx * 7 + 3)
    wf.write(f'{tmp}/a.wav', audio.SR, track)
    # filter graph
    z = zoom_expr(c['events'], a)
    inputs = ['-ss', f'{a / FPS:.3f}', '-t', f'{dur:.3f}', '-i', take + '.mp4', '-i', f'{tmp}/a.wav']
    fg = [f"[0:v]scale=w='trunc({W}*({z})/2)*2':h='trunc({H}*({z})/2)*2':eval=frame,crop={W}:{H},setsar=1,fps={FPS},"
          f"tpad=stop_mode=clone:stop_duration={END}[v0]"]
    cur = 'v0'
    for n, (png, t0, t1, y) in enumerate(overlays):
        inputs += ['-loop', '1', '-t', f'{dur + END:.3f}', '-i', png]
        src = 2 + n
        fd = 0.18
        fg.append(f"[{src}:v]format=rgba,fade=t=in:st={t0:.3f}:d={fd}:alpha=1,fade=t=out:st={max(t0, t1 - fd):.3f}:d={fd}:alpha=1[o{n}]")
        if y is None:   # subtitle sits under the hook
            yexpr = '300+%d' % (Image.open(overlays[0][0]).size[1] - 6)
        else:
            yexpr = str(y)
        # hook slides down a little as it appears
        if n == 0:
            yexpr = f"{y}-40*max(0\\,1-(t-{t0:.3f})/0.25)"
        fg.append(f"[{cur}][o{n}]overlay=x=(W-w)/2:y={yexpr}:enable='between(t,{t0:.3f},{t1:.3f})'[v{n + 1}]")
        cur = f'v{n + 1}'
    # end card
    inputs += ['-loop', '1', '-t', f'{dur + END:.3f}', '-i', f'{tmp}/end.png']
    src = 2 + len(overlays)
    fg.append(f"[{src}:v]format=rgba,fade=t=in:st={dur:.3f}:d=0.35:alpha=1[oe]")
    fg.append(f"[{cur}][oe]overlay=0:0:enable='gte(t,{dur:.3f})',format=yuv420p[vout]")
    name = f"mitosis_{os.path.basename(take)}_{idx:02d}_{c['kind']}"
    out = os.path.join(outdir, name + '.mp4')
    cmd = ['ffmpeg', '-y', '-loglevel', 'error'] + inputs + [
        '-filter_complex', ';'.join(fg), '-map', '[vout]', '-map', '1:a',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-profile:v', 'high', '-r', str(FPS),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]
    subprocess.run(cmd, check=True)
    meta = dict(file=name + '.mp4', kind=c['kind'], seconds=round(dur + END, 1), title=title,
                description=("Gameplay from Mitosis practice mode (the player cell is driven by the game's AI). "
                             "Mitosis is a free multiplayer cell-eating arena: "
                             "absorb anything smaller, divide to strike, and survive the closing dish.\n\n#mitosis #gaming #shorts"),
                tags=['mitosis', 'cell game', 'agar', 'io games', 'gaming', 'shorts'],
                source=os.path.basename(take), start_s=round(a / FPS, 2), end_s=round(b / FPS, 2),
                mass_start=c['m0'], mass_peak=c['m1'], eats=c['eats'])
    json.dump(meta, open(os.path.join(outdir, name + '.json'), 'w'), indent=2, ensure_ascii=False)
    subprocess.run(['rm', '-rf', tmp])
    return out, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('takes', nargs='+')
    ap.add_argument('--out', default='clips')
    ap.add_argument('--max', type=int, default=8)
    ap.add_argument('--per-take', type=int, default=4)
    ap.add_argument('--seed', type=int, default=5)
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--min-score', type=float, default=0)   # skip weak moments
    ap.add_argument('--hook-seed', type=int, default=None)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    rng = random.Random(args.seed)
    plan = []
    for t in args.takes:
        G = load(t)
        ev = events(G)
        kinds = {}
        for e in ev:
            kinds[e[1]] = kinds.get(e[1], 0) + 1
        ch = pick([c for c in candidates(G, ev) if c['score'] >= args.min_score], args.per_take)
        print(f'{t}: {len(G) / FPS:.0f}s, events {kinds}, picked ' +
              ', '.join(f"{c['kind']}@{c['a'] / FPS:.0f}s({c['score']:.1f})" for c in ch))
        plan += [(t, c) for c in ch]
    plan = sorted(plan, key=lambda x: -x[1]['score'])[:args.max]
    if args.dry:
        return
    for idx, (t, c) in enumerate(plan, 1):
        out, meta = render(t, c, idx, args.out, rng)
        print('rendered', out, meta['seconds'], 's |', meta['title'])


if __name__ == '__main__':
    main()
