"""Original, procedurally generated soundtrack + game-style SFX for a clip.

make_track(duration, events, seed) -> float32 stereo array at SR.
events: list of (time_s, kind, strength) with kind in {'eat','death','crown','evolve'}.
Everything here is synthesized from scratch, so there are no rights issues.
"""
import numpy as np

SR = 48000
rng0 = np.random.default_rng


def env(n, a=0.002, d=0.15, s=0.0, r=0.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / max(d, 1e-4))
    return e * (1 - s) + s


def kick(n=int(0.35 * SR)):
    t = np.arange(n) / SR
    f = 45 + 120 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7.5) * 0.9


def hat(rng, n=int(0.06 * SR)):
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))  # crude high-pass
    return x * np.exp(-np.arange(n) / SR * 70) * 0.12


def clap(rng, n=int(0.25 * SR)):
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))
    t = np.arange(n) / SR
    e = np.exp(-t * 18) + 0.6 * np.exp(-np.maximum(0, t - 0.012) * 40) * (t > 0.012)
    return x * e * 0.18


def saw(f, n, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (-detune, 0, detune):
        out += 2 * ((t * f * (1 + d)) % 1) - 1
    return out / 3


def lowpass(x, cutoff):
    # one-pole lowpass, cutoff may be an array
    a = np.exp(-2 * np.pi * np.asarray(cutoff) / SR) * np.ones_like(x)
    y = np.empty_like(x)
    prev = 0.0
    for i in range(len(x)):
        prev = (1 - a[i]) * x[i] + a[i] * prev
        y[i] = prev
    return y


def note(m):
    return 440 * 2 ** ((m - 69) / 12)


def pop(strength=1.0, rng=None):
    """bubbly 'gulp' for absorbing a cell; bigger meals are lower and longer."""
    s = float(np.clip(strength, 0.2, 3))
    n = int((0.12 + 0.08 * s) * SR)
    t = np.arange(n) / SR
    f0 = 900 / (0.7 + 0.5 * s)
    f = f0 * (1 + 1.8 * np.exp(-t * 30)) * (1 - 0.35 * t / t[-1])
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * (26 / (0.6 + 0.4 * s))) * (0.35 + 0.12 * s)


def splat(rng):
    """wet burst for the player's cell being eaten."""
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    noise = lowpass(rng.standard_normal(n), 1800 * np.exp(-t * 4) + 120)
    f = 160 * np.exp(-t * 3) + 40
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR)
    return (noise * 1.4 + tone * 0.7) * np.exp(-t * 4.5) * 0.6


def chime(rng):
    out = np.zeros(int(1.2 * SR))
    for k, m in enumerate([76, 79, 83, 88]):
        n = len(out) - int(k * 0.07 * SR)
        t = np.arange(n) / SR
        out[-n:] += np.sin(2 * np.pi * note(m) * t) * np.exp(-t * 3.5) * 0.16
    return out


def music(duration, seed=0, bpm=124, key=57):
    """Four-on-the-floor bed: kick, hats, claps, a plucky minor arp and a sub bass."""
    rng = rng0(seed)
    n = int(duration * SR) + SR
    mix = np.zeros(n)
    beat = 60 / bpm
    prog = [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 5], [-2, 2, 5, 9]]  # i - VI - III - VII-ish in minor
    order = rng.permutation(4) if seed % 2 else np.arange(4)
    k, h, c = kick(), hat(rng), clap(rng)
    total_beats = int(duration / beat) + 2

    def add(sig, at, gain=1.0):
        i = int(at * SR)
        if i >= n:
            return
        j = min(n, i + len(sig))
        mix[i:j] += sig[: j - i] * gain

    for b in range(total_beats):
        t = b * beat
        add(k, t, 1.0)
        add(h, t + beat / 2, 1.0)
        if b % 2 == 1:
            add(c, t, 1.0)
        chord = prog[order[(b // 4) % 4]]
        # sub bass on the root, off-beat pump
        bn = int(beat * 0.45 * SR)
        bass = np.sin(2 * np.pi * note(key - 24 + chord[0]) * np.arange(bn) / SR) * env(bn, 0.01, 0.2) * 0.32
        add(bass, t + beat / 2)
        # 16th arp
        for s in range(4):
            m = key + 12 + chord[(b * 4 + s) % 4] + (12 if (b + s) % 7 == 0 else 0)
            an = int(beat / 4 * 0.9 * SR)
            pl = saw(note(m), an, 0.004) * env(an, 0.002, 0.07) * 0.11
            add(pl, t + s * beat / 4)
    # sidechain-ish pump on everything but the kick
    t = np.arange(n) / SR
    pump = 0.55 + 0.45 * np.minimum(1, ((t % beat) / (beat * 0.45)))
    mix = mix * pump
    # gentle fade in/out
    fi = np.minimum(1, t / 0.4)
    fo = np.clip((duration - t) / 1.2, 0, 1)
    return (mix * fi * fo)[: int(duration * SR)]


def make_track(duration, events, seed=0, music_gain=0.55):
    rng = rng0(seed + 1000)
    bed = music(duration, seed) * music_gain
    sfx = np.zeros_like(bed)
    for (at, kind, strength) in events:
        if kind == 'eat':
            s = pop(strength, rng)
        elif kind == 'death':
            s = splat(rng)
            # duck the music after a death
            i = int(at * SR)
            bed[i:] *= np.concatenate([np.linspace(1, 0.35, min(len(bed) - i, SR // 4)), np.full(max(0, len(bed) - i - SR // 4), 0.35)])
        elif kind in ('crown', 'evolve'):
            s = chime(rng)
        else:
            continue
        i = int(at * SR)
        j = min(len(sfx), i + len(s))
        if i < len(sfx):
            sfx[i:j] += s[: j - i]
    out = bed + sfx
    out = np.tanh(out * 1.3) * 0.85  # soft limiter
    # tiny stereo width: delay the right channel 6 ms on the music bed only
    d = int(0.006 * SR)
    right = np.concatenate([np.zeros(d), (bed)[:-d]]) * 0.15 + out * 0.85 + sfx * 0.15
    left = out
    return np.stack([left, np.tanh(right * 1.1)], axis=1).astype(np.float32)


if __name__ == '__main__':
    import sys, scipy.io.wavfile as wf
    tr = make_track(12, [(2, 'eat', 0.5), (4, 'eat', 1.5), (6, 'crown', 1), (9, 'death', 1)], seed=3)
    wf.write(sys.argv[1] if len(sys.argv) > 1 else 'test.wav', SR, tr)
    print('ok', tr.shape, float(np.abs(tr).max()))
