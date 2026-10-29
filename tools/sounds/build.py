"""Cut CC0 source recordings into game-ready one-shots + loops (mono mp3) and write a manifest.

Usage: SND_SRC=<dir with extracted packs> python3 tools/sounds/build.py
Sources (all CC0, see apps/web/public/sfx/CREDITS.txt):
  - The Free Firearm Sound Library (Prepared)     guns/Prepared SFX Library/...
  - OpenGameArt CC0 packs: footsteps, reloads, ambiences, impacts, zombie moans
"""
import json, os, subprocess, sys, glob
import numpy as np

SRC = os.environ.get('SND_SRC') or sys.exit('set SND_SRC')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'web', 'public', 'sfx')
os.makedirs(OUT, exist_ok=True)
SR = 44100
manifest: dict[str, list[str]] = {}


def load(path: str) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def save(name: str, x: np.ndarray, kbps=96) -> str:
    peak = float(np.max(np.abs(x))) or 1.0
    x = (x / peak * 0.89).astype(np.float32)
    fn = f'{name}.mp3'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', os.path.join(OUT, fn)],
                   input=x.tobytes(), check=True)
    return fn


def envelope(x: np.ndarray, win=0.004) -> np.ndarray:
    n = max(1, int(SR * win))
    return np.sqrt(np.convolve(x * x, np.ones(n) / n, mode='same'))


def onsets(x: np.ndarray, rise_db=24, min_gap=0.25) -> list[int]:
    """Sample indices where the level jumps sharply above the recent floor (gunshots, footsteps)."""
    env = envelope(x)
    db = 20 * np.log10(env + 1e-9)
    peak = db.max()
    floor_win = int(SR * 0.06)
    out, last = [], -10**9
    i = floor_win
    step = int(SR * 0.002)
    while i < len(db):
        if db[i] > peak - 14 and db[i] - db[i - floor_win:i - floor_win // 2].mean() > rise_db and i - last > SR * min_gap:
            # walk back to the true start of the transient
            j = i
            while j > i - floor_win and db[j] > db[i] - 18:
                j -= 1
            out.append(j)
            last = i
            i += int(SR * min_gap)
        i += step
    return out


def cut(x: np.ndarray, start: int, length: float, fade=0.35, pre=0.004) -> np.ndarray:
    a = max(0, start - int(SR * pre))
    seg = x[a:a + int(SR * length)].copy()
    n = len(seg)
    f = int(n * fade)
    if f > 0:
        seg[-f:] *= np.linspace(1, 0, f) ** 2
    seg[: int(SR * 0.002)] *= np.linspace(0, 1, int(SR * 0.002))
    return seg


def shots(key: str, files: list[str], length: float, count=3, rise_db=24):
    picked = []
    for f in files:
        x = load(f)
        for o in onsets(x, rise_db):
            seg = cut(x, o, length)
            # Reject cuts that contain a second shot (too much energy late in the tail).
            e = envelope(seg)
            head = e[: int(SR * 0.05)].max()
            tail = e[int(SR * 0.12):].max() if len(e) > SR * 0.12 else 0
            if tail < head * 0.5:
                picked.append(seg)
            if len(picked) >= count:
                break
        if len(picked) >= count:
            break
    manifest[key] = [save(f'{key}_{i}', s) for i, s in enumerate(picked)]
    print(key, len(picked))


def steps(key: str, files: list[str], count=6, length=0.32):
    picked = []
    for f in files:
        x = load(f)
        os_ = onsets(x, rise_db=12, min_gap=0.2)
        if not os_:
            os_ = [int(np.argmax(envelope(x))) - int(SR * 0.01)]
        for o in os_:
            seg = cut(x, max(0, o), length, fade=0.5, pre=0.01)
            if len(seg) > SR * 0.1:
                picked.append(seg)
            if len(picked) >= count:
                break
        if len(picked) >= count:
            break
    manifest[key] = [save(f'{key}_{i}', s, 64) for i, s in enumerate(picked)]
    print(key, len(picked))


def whole(key: str, files: list[str], max_len=None, kbps=80, fade=0.1):
    out = []
    for i, f in enumerate(files):
        x = load(f)
        if max_len:
            x = x[: int(SR * max_len)]
        # trim leading silence
        env = envelope(x)
        nz = np.nonzero(env > env.max() * 0.02)[0]
        if len(nz):
            x = x[max(0, nz[0] - int(SR * 0.005)): nz[-1] + int(SR * 0.05)]
        out.append(save(f'{key}_{i}', cut(x, 0, len(x) / SR, fade=fade, pre=0), kbps))
    manifest[key] = out
    print(key, len(out))


def loop(key: str, f: str, seconds: float, kbps=64):
    x = load(f)[: int(SR * (seconds + 1.5))]
    # Equal-power crossfade of the tail into the head so the loop is seamless.
    xf = int(SR * 1.5)
    body = x[: len(x) - xf].copy()
    t = np.linspace(0, np.pi / 2, xf)
    body[:xf] = body[:xf] * np.sin(t) + x[len(x) - xf:] * np.cos(t)
    manifest[key] = [save(key, body, kbps)]
    print(key, 'loop', len(body) / SR)


G = os.path.join(SRC, 'guns', 'Prepared SFX Library')
g = lambda d: sorted(glob.glob(os.path.join(G, d, '*.wav')))
shots('shot_pistol', g('Walther PPQ') + g('1911'), 0.9)
shots('shot_pistol_heavy', g('1911'), 1.0)
shots('shot_rifle', g('AK-47'), 1.3)
shots('shot_carbine', g('AR-15'), 1.2)
shots('shot_smg', g('PPSh'), 0.8)
shots('shot_semi', g('SKS'), 1.4)
shots('shot_shotgun', g('Mossberg'), 1.5)
shots('shot_sniper', g('Mosin Nagant'), 2.0)

D = os.path.join(SRC, 'different-steps-on-wood-stone-leaves-gravel-and-mud')
F = os.path.join(SRC, 'fantozzis-footsteps-grasssand-stone', 'Fantozzi-footsteps', 'ogg')
S = os.path.join(SRC, '42-snow-and-gravel-footsteps', 'Corsica_S-Walking_in_Snow')
L = os.path.join(SRC, 'footsteps-leather-cloth-armor', 'footsteps')
X = os.path.join(SRC, '100-cc0-sfx-2')
steps('step_grass', sorted(glob.glob(os.path.join(F, '*Sand*.ogg'))) + [os.path.join(D, 'leaves01.ogg')])
steps('step_leaves', [os.path.join(D, 'leaves01.ogg'), os.path.join(D, 'leaves02.ogg')])
steps('step_stone', sorted(glob.glob(os.path.join(F, '*Stone*.ogg'))) + [os.path.join(D, 'stone01.ogg')])
steps('step_wood', [os.path.join(D, f'wood0{i}.ogg') for i in (1, 2, 3)] + sorted(glob.glob(os.path.join(X, '*footstep_wood*'))))
steps('step_gravel', [os.path.join(D, 'gravel.ogg')] + sorted(glob.glob(os.path.join(S, '*gravel_0*.flac')))[:3])
steps('step_mud', [os.path.join(D, 'mud02.ogg')] + sorted(glob.glob(os.path.join(X, '*footstep_wet*'))))
whole('cloth', sorted(glob.glob(os.path.join(L, 'step_cloth*.ogg'))), kbps=64)
whole('gear', sorted(glob.glob(os.path.join(L, 'step_lth*.ogg'))), kbps=64)

R = os.path.join(SRC, '..', 'dl')
whole('reload_rifle', [os.path.join(R, 'gun-reload-sounds', 'assaultriflereload1_0.wav')] + sorted(glob.glob(os.path.join(SRC, '2-gun-reloads', '*.ogg'))))
whole('reload_pistol', [os.path.join(R, 'gun-reload-sounds', 'gunreload1.wav'), os.path.join(R, 'handgun-reload-sound-effect', 'reload.wav')])
whole('pump', [os.path.join(R, 'gun-reload-sounds', 'shotguncock_0.wav')])
whole('shell_insert', sorted(glob.glob(os.path.join(SRC, 'shotgun-reload-sound-effects', '**', '*.wav'), recursive=True))[:2])
whole('click', [os.path.join(R, 'equipment-clicks-ii', 'equipmentclicks.wav')], max_len=1.2)
whole('impact_hit', sorted(glob.glob(os.path.join(X, '*_hit_0*.ogg'))))
whole('impact_metal', sorted(glob.glob(os.path.join(X, '*metal_hit*.ogg'))) + sorted(glob.glob(os.path.join(X, '*metal_0*.ogg')))[:2])
whole('impact_wood', sorted(glob.glob(os.path.join(X, '*wood_hit*.ogg'))) + sorted(glob.glob(os.path.join(X, '*wood_0*.ogg')))[:2])
whole('glass', sorted(glob.glob(os.path.join(X, '*glass_0*.ogg'))))
whole('door', sorted(glob.glob(os.path.join(X, '*door_0*.ogg'))))
whole('items', sorted(glob.glob(os.path.join(X, '*items_0*.ogg'))))
whole('zipper', sorted(glob.glob(os.path.join(X, '*misc_0[1-4].ogg'))))
whole('thunder', sorted(glob.glob(os.path.join(X, '*thunder*.ogg'))), kbps=64)
moans = load(os.path.join(R, 'zombie-moans', 'darsycho__zombie-moans_0.ogg'))
segs, i = [], 0
for o in onsets(moans, rise_db=10, min_gap=1.2):
    s = cut(moans, o, 1.6, fade=0.4, pre=0.02)
    if np.max(np.abs(s)) > 0.05:
        segs.append(s)
manifest['moan'] = [save(f'moan_{k}', s, 64) for k, s in enumerate(segs[:6])]
print('moan', len(manifest['moan']))
loop('amb_birds', os.path.join(R, 'park-ambiences', 'park_ambience_birds.wav'), 40)
loop('amb_wind', os.path.join(R, 'mild-wind-background-noise', 'wind background noise 2.wav'), 30)
loop('amb_rain', os.path.join(R, 'amb-rain-loop-1', 'amb_rain_loop_1.wav'), 30)
loop('amb_river', os.path.join(R, 'park-ambiences', 'park_ambience_river.wav'), 30)

with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
    json.dump(manifest, fh, indent=1)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print('total KB', total // 1024)
