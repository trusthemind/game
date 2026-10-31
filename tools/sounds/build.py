"""Cut CC0 / CC-BY source recordings into game-ready one-shots + loops (mp3) and write a manifest.

Usage: SND_SRC=<dir with extracted packs> python3 tools/sounds/build.py   (needs numpy + ffmpeg)
Every source and its licence is listed in apps/web/public/sfx/CREDITS.txt. Expected layout of SND_SRC
(one folder per downloaded archive, named after the archive):
  Prepared SFX Library/      The Free Firearm Sound Library (Prepared)            CC0
  footsteps_0/               Footsteps on different surfaces (congusbongus)       CC-BY 3.0 / CC0 per folder
  [kdd]DifferentSteps_0/, Fantozzi-footsteps/, corsica_s-walking_in_snow/, footsteps/ (leather, cloth)
  swishes/, qubodupImpact/, qubodupPunch/, independent_nu_ljudbank-wet_squish_slurp_impacts/
  RPGsounds_Kenney/, UI_SFX_Set/, kenney_interfaceSounds/, sfx_100_v2/
  mb/ (Michel Baradari human pain/death, CC-BY 3.0), exewinDeathSoundsPack/, death sound effect/, hurt_0*.mp3
  heartbeat.mp3_.flac, crickets_1.mp3, the reload / ambience / moan files (see the bottom of this script)

Guns are the important part. The Free Firearm library has every gun recorded twice: a "near" pair (left/right,
the crack and the mechanism) and a "mid" pair 50-ish metres down range (the boom and the treeline echo). A game
gunshot is both: we line the two up on the transient, keep stereo, and run a parallel compressor so the body
and the echo tail sit ~12 dB under the crack instead of ~35 dB (the raw recording is a click followed by
near-silence, which is what made the old cut sound like a cap gun). The mid recording on its own, low-passed,
becomes the "far" voice the engine crossfades to for distant gunfire.
"""
import glob, json, os, subprocess, sys
import numpy as np

SRC = os.environ.get('SND_SRC') or sys.exit('set SND_SRC')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'web', 'public', 'sfx')
os.makedirs(OUT, exist_ok=True)
for f in glob.glob(os.path.join(OUT, '*.mp3')):
    os.remove(f)
SR = 44100
manifest: dict[str, list[str]] = {}


def p(*parts: str) -> str:
    return os.path.join(SRC, *parts)


def load(path: str, stereo=False) -> np.ndarray:
    ch = 2 if stereo else 1
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).copy()
    return x.reshape(-1, 2) if stereo else x


def save(name: str, x: np.ndarray, kbps=64, peak_db=-1.0) -> str:
    peak = float(np.max(np.abs(x))) or 1.0
    x = (x / peak * 10 ** (peak_db / 20)).astype(np.float32)
    ch = 2 if x.ndim == 2 else 1
    fn = f'{name}.mp3'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-', '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', os.path.join(OUT, fn)],
                   input=x.tobytes(), check=True)
    return fn


def mono(x: np.ndarray) -> np.ndarray:
    return x.mean(1) if x.ndim == 2 else x


def envelope(x: np.ndarray, win=0.004) -> np.ndarray:
    n = max(1, int(SR * win))
    m = mono(x)
    return np.sqrt(np.convolve(m * m, np.ones(n) / n, mode='same'))


def onsets(x: np.ndarray, floor_db=-30, rise_db=15, gap=0.15) -> list[int]:
    """Sample indices of sharp attacks (gunshots, footsteps): a 5 ms block that jumps well above the last 50 ms."""
    m = np.abs(mono(x))
    n = int(SR * 0.005)
    k = len(m) // n
    blk = m[: k * n].reshape(k, n).max(1)
    db = 20 * np.log10(blk / (blk.max() + 1e-9) + 1e-9)
    out, i = [], 10
    while i < k:
        if db[i] > floor_db and db[i] - db[i - 10:i - 2].max() > rise_db:
            # walk back to where the attack leaves the floor
            j = i * n
            while j > (i - 2) * n and m[j] > blk[i] * 0.05:
                j -= 1
            out.append(j)
            i += int(gap / 0.005)
        else:
            i += 1
    return out


def fade(x: np.ndarray, out_frac=0.3, in_ms=1.5) -> np.ndarray:
    x = x.copy()
    n = len(x)
    f = int(n * out_frac)
    shape = (np.linspace(1, 0, f) ** 2)
    a = int(SR * in_ms / 1000)
    if x.ndim == 2:
        x[-f:] *= shape[:, None]
        x[:a] *= np.linspace(0, 1, a)[:, None]
    else:
        x[-f:] *= shape
        x[:a] *= np.linspace(0, 1, a)
    return x


def cut(x: np.ndarray, start: int, length: float, pre=0.003) -> np.ndarray:
    a = max(0, start - int(SR * pre))
    return x[a:a + int(SR * length)].copy()


def trim(x: np.ndarray, thresh=0.02, tail=0.05) -> np.ndarray:
    env = envelope(x)
    nz = np.nonzero(env > env.max() * thresh)[0]
    if not len(nz):
        return x
    return x[max(0, nz[0] - int(SR * 0.004)): nz[-1] + int(SR * tail)]


def lowpass(x: np.ndarray, hz: float) -> np.ndarray:
    """Two-pole-ish low-pass (two cascaded one-poles), per channel."""
    a = np.exp(-2 * np.pi * hz / SR)
    y = x.astype(np.float64)
    for _ in range(2):
        z = np.empty_like(y)
        acc = np.zeros(y.shape[1:]) if y.ndim == 2 else 0.0
        for i in range(len(y)):
            acc = (1 - a) * y[i] + a * acc
            z[i] = acc
        y = z
    return y.astype(np.float32)


def highpass(x: np.ndarray, hz: float) -> np.ndarray:
    return x - lowpass(x, hz)


def compress(x: np.ndarray, thresh_db=-34, ratio=8.0, attack=0.002, release=0.12) -> np.ndarray:
    """Feed-forward compressor on a smoothed peak envelope (linked stereo)."""
    m = np.abs(mono(x)).astype(np.float64)
    ga, gr = np.exp(-1 / (SR * attack)), np.exp(-1 / (SR * release))
    env = np.empty_like(m)
    e = 0.0
    for i, v in enumerate(m):
        e = ga * e + (1 - ga) * v if v > e else gr * e + (1 - gr) * v
        env[i] = e
    peak = m.max() + 1e-9
    lvl = 20 * np.log10(env / peak + 1e-9)
    over = np.maximum(0, lvl - thresh_db)
    g = 10 ** (-(over * (1 - 1 / ratio)) / 20)
    return (x * (g[:, None] if x.ndim == 2 else g)).astype(np.float32)


def punch(x: np.ndarray, wet=0.9, **kw) -> np.ndarray:
    """New-York (parallel) compression: dry keeps the crack, the squashed copy lifts body and tail."""
    c = compress(x, **kw)
    c *= np.max(np.abs(x)) / (np.max(np.abs(c)) + 1e-9)
    y = x + wet * c
    # Soft-clip the very top of the transient so the whole thing can be louder at the same peak.
    pk = np.max(np.abs(y))
    return (np.tanh(1.6 * y / pk) / np.tanh(1.6)).astype(np.float32)


def loudnorm(x: np.ndarray, target_db=-14.0, win=0.05) -> np.ndarray:
    """Scale so the loudest 50 ms window has the given RMS (dBFS); peak is capped by save()."""
    e = envelope(x, win)
    return x * (10 ** (target_db / 20) / (e.max() + 1e-9))


def single(x: np.ndarray, o: int, echo=0.3) -> bool:
    """True when the shot at sample o is not part of a burst: nothing within 30–300 ms comes near its peak
    (`echo` is how loud a reflection may get; the mid microphones hear the berm almost as loud as the shot)."""
    m = np.abs(mono(x[o:o + int(SR * 0.3)]))
    if len(m) < SR * 0.3:
        return False
    head = m[: int(SR * 0.03)].max()
    return bool(m[int(SR * 0.03):].max() < head * echo)


# ── Guns ────────────────────────────────────────────────────────────────────────────────────────────────────
G = p('Prepared SFX Library', 'Prepared SFX Library')


def gun(key: str, pairs: list[tuple[str, str]], count=3, length=2.2, far_len=2.8, mid_mix=0.8, squash=-38.0):
    """pairs = [(near file, mid file)] in the gun's folder(s). Builds `shot_<key>` (stereo) and `far_<key>`."""
    near_out, far_out = [], []
    mids = []
    for _, mid_f in pairs:
        xm = load(os.path.join(G, mid_f), True)
        mids += [cut(xm, o, max(length, far_len), pre=0.01) for o in onsets(xm) if single(xm, o, 0.65)]
    for near_f, _ in pairs:
        xn = load(os.path.join(G, near_f), True)
        on = [o for o in onsets(xn) if single(xn, o)]
        for k, o in enumerate(on):
            if len(near_out) >= count:
                break
            a = cut(xn, o, length)
            if len(a) < SR * length * 0.9:
                continue
            # Reject cuts that run into the next shot.
            e = envelope(a, 0.01)
            if e[int(SR * 0.25):].max() > e.max() * 0.35:
                continue
            b = mids[len(near_out) % len(mids)][int(SR * 0.007):] if mids else np.zeros_like(a)
            b = np.pad(b, ((0, max(0, len(a) - len(b))), (0, 0)))[: len(a)]
            b *= np.max(np.abs(a)) / (np.max(np.abs(b)) + 1e-9)
            mix = punch(a + mid_mix * b, wet=1.3, thresh_db=squash, ratio=8, release=0.3)
            near_out.append(fade(mix, 0.45))
    for f in mids[:count]:
        f = lowpass(mono(f[: int(SR * far_len)]), 2600)
        far_out.append(fade(punch(f, wet=1.2, thresh_db=-36, ratio=8, release=0.4), 0.5, in_ms=8))
    manifest[f'shot_{key}'] = [save(f'shot_{key}_{i}', s, 112) for i, s in enumerate(near_out)]
    manifest[f'far_{key}'] = [save(f'far_{key}_{i}', s, 48) for i, s in enumerate(far_out)]
    print(key, len(near_out), 'near', len(far_out), 'far')


gun('pistol', [('Walther PPQ/X_39P.wav', 'Walther PPQ/X_31P.wav'), ('Bersa/F_47P.wav', 'Bersa/F_41P.wav')], length=1.7, mid_mix=1.0, squash=-42)
gun('pistol_heavy', [('1911/A_42P.wav', '1911/A_34P.wav'), ('Smith & Wesson 642/V_27P.wav', 'Smith & Wesson 642/V_22P.wav')], length=1.9, mid_mix=1.0, squash=-40)
gun('rifle', [('AK-47/C_28P.wav', 'AK-47/C_31P.wav'), ('AK-47/C_29P.wav', 'AK-47/C_36P.wav')], length=2.0)
gun('carbine', [('AR-15/D_32P.wav', 'AR-15/D_24P.wav'), ('Savage 10 .300 Blackout/T_27P.wav', 'Savage 10 .300 Blackout/T_17P.wav')], length=2.0)
gun('smg', [('PPSh/P_30P.wav', 'PPSh/P_16P.wav'), ('Carl Gustav M45/G_31P.wav', 'Carl Gustav M45/G_20P.wav')], length=1.6, squash=-38)
gun('semi', [('SKS/U_14P.wav', 'SKS/U_19P.wav')], length=2.2)
gun('shotgun', [('Nova/O_21P.wav', 'Nova/O_17P.wav'), ('CD/H_21P.wav', 'CD/H_16P.wav'), ('Model 12/K_22P.wav', 'Model 12/K_17P.wav')], length=2.2)
gun('sniper', [('Mosin Nagant/M_21P.wav', 'Mosin Nagant/M_26P.wav')], length=2.6, far_len=3.2)
gun('bolt', [('Tikka/W_29P.wav', 'Tikka/W_24P.wav'), ('1917/B_24P.wav', '1917/B_16P.wav')], length=2.6, far_len=3.2)


# ── One-shot helpers ───────────────────────────────────────────────────────────────────────────────────────
def oneshots(key: str, files: list[str], kbps=64, target=-14.0, max_len=None, out_frac=0.25, keep=None, tail=0.05):
    out = []
    for f in files[:keep]:
        x = trim(load(f), tail=tail)
        if max_len:
            x = x[: int(SR * max_len)]
        if len(x) < SR * 0.03:
            continue
        out.append(fade(loudnorm(x, target), out_frac))
    manifest[key] = [save(f'{key}_{i}', s, kbps) for i, s in enumerate(out)]
    print(key, len(out))


def steps(key: str, files: list[str], count=8, length=0.32, target=-16.0):
    """Footstep sources are either one step per file or a run of steps; cut each onset into its own one-shot."""
    out = []
    for f in files:
        x = load(f)
        os_ = onsets(x, floor_db=-24, rise_db=10, gap=0.2) or [int(np.argmax(envelope(x)))]
        for o in os_:
            seg = cut(x, o, length, pre=0.008)
            if len(seg) < SR * 0.08:
                continue
            out.append(fade(loudnorm(trim(seg, 0.03, 0.04), target), 0.4))
            if len(out) >= count:
                break
        if len(out) >= count:
            break
    manifest[key] = [save(f'{key}_{i}', s, 64) for i, s in enumerate(out)]
    print(key, len(out))


def loop(key: str, f: str, seconds: float, kbps=64, xfade=1.5):
    x = load(f)[: int(SR * (seconds + xfade))]
    # Equal-power crossfade of the tail into the head so the loop is seamless.
    xf = int(SR * xfade)
    body = x[: len(x) - xf].copy()
    t = np.linspace(0, np.pi / 2, xf)
    body[:xf] = body[:xf] * np.sin(t) + x[len(x) - xf:] * np.cos(t)
    manifest[key] = [save(key, body, kbps, peak_db=-3)]
    print(key, 'loop', round(len(body) / SR, 1))


def g(*pattern: str) -> list[str]:
    return sorted(glob.glob(p(*pattern)))


# ── Footsteps (one-shot per step, loudness-matched so surfaces differ by timbre, not by level) ──────────────
FS = ('footsteps_0', 'footsteps')
steps('step_stone', g(*FS, 'boots', '*.ogg') + g('Fantozzi-footsteps', '*', 'flac', '*Stone*.flac'), count=10, length=0.25)
steps('step_wood', g(*FS, 'wood', '*.ogg') + g('[[]kdd[]]DifferentSteps_0', '*', 'wood0*.ogg'), count=10)
steps('step_grass', g(*FS, 'grass', '*.ogg') + g('Fantozzi-footsteps', '*', 'flac', '*Sand*.flac'), count=10, target=-18)
steps('step_gravel', g(*FS, 'gravel', '*.ogg'), count=10)
steps('step_leaves', g('[[]kdd[]]DifferentSteps_0', '*', 'leaves0*.ogg') + g(*FS, 'grass', '*.ogg')[4:], count=6, length=0.4, target=-18)
steps('step_mud', g(*FS, 'water', '*.ogg') + g('sfx_100_v2', '*footstep_wet*.ogg'), count=8, length=0.35, target=-17)
steps('step_metal', g(*FS, 'metal', '*.ogg'), count=8, length=0.35)
oneshots('cloth', g('footsteps', '*', 'step_cloth*.ogg') + g('RPGsounds_Kenney', 'OGG', 'cloth*.ogg'), target=-20)
oneshots('gear', g('footsteps', '*', 'step_lth*.ogg') + g('RPGsounds_Kenney', 'OGG', 'beltHandle*.ogg'), target=-20)

# ── Melee ──────────────────────────────────────────────────────────────────────────────────────────────────
SW = g('swishes', 'swishes', 'swish-*.wav')
light = [f for f in SW if os.path.basename(f) in ('swish-1.wav', 'swish-2.wav', 'swish-3.wav', 'swish-4.wav')]
oneshots('swing', light + g('RPGsounds_Kenney', 'OGG', 'knifeSlice*.ogg'), target=-16)
oneshots('swing_heavy', [f for f in SW if f not in light], target=-14)
oneshots('punch', g('qubodupPunch', '*', '*.flac') + g('qubodupImpact', '*', '*Meat*.flac'), target=-12)
oneshots('flesh', g('independent_nu_ljudbank-wet_squish_slurp_impacts', '*', '*.flac'), target=-13, max_len=0.6)
oneshots('stab', g('RPGsounds_Kenney', 'OGG', 'knifeSlice*.ogg') + g('RPGsounds_Kenney', 'OGG', 'chop.ogg'), target=-14)
oneshots('draw_blade', g('RPGsounds_Kenney', 'OGG', 'drawKnife*.ogg'), target=-18)

# ── Bullet impacts ─────────────────────────────────────────────────────────────────────────────────────────
X = ('sfx_100_v2',)
oneshots('impact_metal', g(*X, '*metal_hit*.ogg') + g('qubodupImpact', '*', '*Metal.flac') + g(*X, '*metal_0[1-3].ogg'), target=-14, max_len=0.7)
oneshots('impact_wood', g(*X, '*wood_hit*.ogg') + g('qubodupImpact', '*', '*Wood.flac') + g(*X, '*wood_0*.ogg')[:2], target=-15, max_len=0.6)
oneshots('impact_stone', g('qubodupImpact', '*', '*Stone.flac') + g(*X, '*_hit_0*.ogg'), target=-16, max_len=0.5)
oneshots('glass', g(*X, '*glass_0*.ogg'), target=-13)
oneshots('door', g(*X, '*door_0*.ogg') + g('RPGsounds_Kenney', 'OGG', 'doorOpen_*.ogg'), target=-16)
oneshots('items', g(*X, '*items_0*.ogg') + g('RPGsounds_Kenney', 'OGG', 'handleSmallLeather*.ogg'), target=-18)
oneshots('zipper', g(*X, '*misc_0[1-4].ogg'), target=-18)
oneshots('thunder', g(*X, '*thunder*.ogg'), kbps=56, target=-16, out_frac=0.4)

# ── Voices (pain / death). Sorted by measured pitch: < 200 Hz male, > 380 Hz female. ────────────────────────
MB = ('mb', 'player')
oneshots('pain_m', [p(*MB, f'pain{i}.wav') for i in range(1, 7)] + [p(*MB, 'painh.wav'), p(*MB, 'paino.wav')], target=-15)
oneshots('death_m', [p(*MB, 'die1.wav'), p(*MB, 'deathh.wav')] + [p('exewinDeathSoundsPack', 'exewinDeathSoundsPack', f'{i}.ogg') for i in (4, 5, 6, 8, 10)], target=-14)
oneshots('pain_f', [p(f) for f in ('hurt_02.mp3', 'hurt_03.mp3')] + [p('exewinDeathSoundsPack', 'exewinDeathSoundsPack', f'{i}.ogg') for i in (3, 7)], target=-16)
oneshots('death_f', [p('death sound effect', f'{i}.mp3') for i in (4, 5, 14, 18, 19)], target=-15, max_len=1.8, out_frac=0.35)
oneshots('heartbeat', [p('heartbeat.mp3_.flac')], target=-12)

# ── UI (real switches, clicks and leather/canvas handling) ────────────────────────────────────────────────
UI = ('UI_SFX_Set',)
oneshots('ui_click', [p(*UI, f) for f in ('click1.wav', 'click2.wav', 'click3.wav', 'mouseclick1.wav')], target=-22)
oneshots('ui_move', g('RPGsounds_Kenney', 'OGG', 'dropLeather.ogg') + g('RPGsounds_Kenney', 'OGG', 'handleSmallLeather*.ogg') + g('RPGsounds_Kenney', 'OGG', 'cloth[12].ogg'), target=-20)
oneshots('ui_equip', g('RPGsounds_Kenney', 'OGG', 'beltHandle*.ogg') + g('RPGsounds_Kenney', 'OGG', 'metalLatch.ogg') + g('RPGsounds_Kenney', 'OGG', 'clothBelt*.ogg'), target=-18)
oneshots('ui_deny', [p(*UI, f) for f in ('switch20.wav', 'switch21.wav')] + g('RPGsounds_Kenney', 'OGG', 'metalClick.ogg'), target=-20)

# ── Reloads (CC0, see CREDITS) ────────────────────────────────────────────────────────────────────────────
R = p('..', 'dl', 'files2')
oneshots('reload_rifle', [os.path.join(R, 'assaultriflereload1_0.wav')] + g('gun_reload_-_starninjas', '*.ogg'), target=-15)
oneshots('reload_pistol', [os.path.join(R, 'gunreload1.wav'), os.path.join(R, 'reload.wav')], target=-15)
oneshots('pump', [os.path.join(R, 'shotguncock_0.wav')], target=-13)
oneshots('dry', g('RPGsounds_Kenney', 'OGG', 'metalClick.ogg'), target=-16)

# ── Infected and ambience ─────────────────────────────────────────────────────────────────────────────────
moans = load(os.path.join(R, 'darsycho__zombie-moans_0.ogg'))
# The recording is one moan after another with short gaps: split on the gaps.
e = 20 * np.log10(envelope(moans, 0.05) / envelope(moans, 0.05).max() + 1e-9)
loud = e > -34
edges = np.flatnonzero(np.diff(loud.astype(int)))
bounds = list(zip(edges[::2], edges[1::2])) if loud[0] == 0 else []
segs = [fade(loudnorm(moans[a:min(b, a + int(SR * 2.6))], -15), 0.3) for a, b in bounds if b - a > SR * 0.6]
manifest['moan'] = [save(f'moan_{k}', s, 64) for k, s in enumerate(segs[:6])]
print('moan', len(manifest['moan']))
loop('amb_birds', os.path.join(R, 'park_ambience_birds.wav'), 40)
loop('amb_wind', os.path.join(R, 'wind background noise 2.wav'), 30)
loop('amb_rain', os.path.join(R, 'amb_rain_loop_1.wav'), 30)
loop('amb_river', os.path.join(R, 'park_ambience_river.wav'), 30)
loop('amb_crickets', p('crickets_1.mp3'), 10, xfade=0.8)

with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
    json.dump(manifest, fh, indent=1)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print('total KB', total // 1024)
