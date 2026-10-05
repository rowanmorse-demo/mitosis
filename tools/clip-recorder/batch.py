"""Keep making Mitosis Shorts until told to stop.

python batch.py --clips 30 --jobs 2

Each game gets a fresh seed, a skin, a play style and a filming plan (endgame, or a mid-round
stretch), alternating so the batch has variety. Finished takes are cut with edit.py into their best
moments (weak ones are skipped), the raw footage is deleted, and every clip is appended to
clips/manifest.csv with its title, so the batch can be uploaded or scheduled later.
"""
import argparse, csv, glob, json, os, random, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
SKINS = [16, 15, 13, 6, 5, 14, 12, 11, 10, 9, 8, 7, 3, 1]
NAMES = ['Nucleus', 'Voidcell', 'Blob', 'Mitochondria', 'Ribosome', 'Plasmid', 'Spore', 'Vesicle', 'Cytoplasm', 'Organelle']
PLANS = [  # (label, extra record.py args)
    ('late', ['--film-from', '200', '--min-mass', '700', '--tries', '6', '--seconds', '140', '--then-endgame', '545']),
    ('late', ['--film-from', '280', '--min-mass', '900', '--tries', '6', '--seconds', '140', '--then-endgame', '545']),
    ('mid', ['--film-from', '110', '--min-mass', '300', '--tries', '4', '--seconds', '140', '--then-endgame', '545']),
]
STYLES = [('hunter', 0.95), ('opportunist', 0.9), ('farmer', 0.8), ('hunter', 1.0), ('sniper', 0.9)]


def count_clips(out):
    return len(glob.glob(os.path.join(out, 'mitosis_*.mp4')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--clips', type=int, default=30, help='stop once this many clips exist in --out')
    ap.add_argument('--jobs', type=int, default=2, help='games filmed in parallel (cores / 1)')
    ap.add_argument('--out', default=os.path.join(HERE, 'clips'))
    ap.add_argument('--raw', default=os.path.join(HERE, 'raw'))
    ap.add_argument('--seed', type=int, default=int(time.time()) % 100000)
    ap.add_argument('--per-take', type=int, default=3)
    ap.add_argument('--min-score', type=float, default=5.0)
    ap.add_argument('--diff', default='calm')
    ap.add_argument('--keep-raw', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True); os.makedirs(args.raw, exist_ok=True)
    rng = random.Random(args.seed)
    man_path = os.path.join(args.out, 'manifest.csv')
    new_manifest = not os.path.exists(man_path)
    running, game = {}, 0
    edit_q = []

    def launch():
        nonlocal game
        plan_label, plan = PLANS[game % len(PLANS)]
        pers, aggr = STYLES[game % len(STYLES)]
        skin = SKINS[(game + rng.randrange(len(SKINS))) % len(SKINS)]
        seed = args.seed * 10 + game * 37
        name = f'g{args.seed}_{game:03d}_{plan_label}'
        take = os.path.join(args.raw, name)
        cmd = [sys.executable, os.path.join(HERE, 'record.py'), '--out', take, '--seed', str(seed), '--skin', str(skin),
               '--name', rng.choice(NAMES), '--pers', pers, '--aggr', str(aggr), '--diff', args.diff, '--respawn'] + plan
        log = open(take + '.log', 'w')
        running[subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)] = take
        print(f'[{time.strftime("%H:%M")}] filming {name} (skin {skin}, {pers}, seed {seed})', flush=True)
        game += 1

    while count_clips(args.out) < args.clips:
        while len(running) < args.jobs:
            launch()
        time.sleep(5)
        for proc, take in list(running.items()):
            if proc.poll() is None:
                continue
            del running[proc]
            if proc.returncode != 0 or not os.path.exists(take + '.jsonl'):
                print(f'  {os.path.basename(take)} failed (see {take}.log)', flush=True)
                continue
            before = set(glob.glob(os.path.join(args.out, 'mitosis_*.json')))
            r = subprocess.run([sys.executable, os.path.join(HERE, 'edit.py'), take, '--out', args.out, '--per-take', str(args.per_take),
                                '--max', str(args.per_take), '--min-score', str(args.min_score), '--seed', str(rng.randrange(10**6))],
                               capture_output=True, text=True)
            made = sorted(set(glob.glob(os.path.join(args.out, 'mitosis_*.json'))) - before)
            with open(man_path, 'a', newline='', encoding='utf-8') as f:
                w = csv.writer(f)
                if new_manifest:
                    w.writerow(['file', 'kind', 'seconds', 'title', 'description', 'take_seed', 'skin']); new_manifest = False
                meta_take = json.load(open(take + '.meta.json')) if os.path.exists(take + '.meta.json') else {}
                for m in made:
                    j = json.load(open(m, encoding='utf-8'))
                    w.writerow([j['file'], j['kind'], j['seconds'], j['title'], j['description'], meta_take.get('seed'), meta_take.get('skin')])
            print(f'  {os.path.basename(take)}: {len(made)} clip(s); total {count_clips(args.out)}'
                  + ('' if r.returncode == 0 else f' (edit error: {r.stderr.strip()[-300:]})'), flush=True)
            if not args.keep_raw:
                for ext in ('.mp4', '.jsonl'):
                    try: os.remove(take + ext)
                    except OSError: pass
    for proc in running:
        proc.terminate()
    print(f'done: {count_clips(args.out)} clips in {args.out}')


if __name__ == '__main__':
    main()
