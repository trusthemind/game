"""Tiling skin micro-detail for the game's skin shader (apps/web/src/render/character.ts humanBodyMaterial).

  /Applications/Blender.app/Contents/MacOS/Blender --background --python skin_detail.py

Writes apps/web/public/textures/skin_detail.webp (512 x 512, tiles seamlessly): R, G the detail normal's x / y
(0.5 = flat), B the micro height (0.5 = the mean; low = a pore or crease, which the shader makes a little rougher).
The game repeats it many times over the body's UVs, under the baked maps, so the skin up close has pores, fine
creases and grain the 2048 bake can't hold, and it mips away to nothing at game distance.

Built from:
  * the CC0 MakeHuman skin photos (MPFB system assets, data/skins): high-passed patches of flat skin (thigh, chest,
    back) from several of them, cross-faded into a tile -- the real grain and blotch-scale relief;
  * procedural pores (a jittered grid of small pits, uneven in size and depth) and the rhombic micro-creases of the
    skin's surface (two families of fine grooves at about +-35 degrees, wandering), plus fine grain.
Everything procedural has an integer period over the tile, so the tile wraps without a seam.
"""
import bpy, glob, os, numpy as np

N = 512
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "..", "apps", "web", "public", "textures", "skin_detail.webp"))
rng = np.random.default_rng(1234)


def wrap_blur(a, r):
    """Gaussian-ish blur that wraps round the tile (so the result still tiles)."""
    if r <= 0:
        return a
    k = np.fft.fftfreq(a.shape[0])
    g = np.exp(-0.5 * (2 * np.pi * r) ** 2 * (k[:, None] ** 2 + k[None, :] ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)


def norm(a):
    a = a - a.mean()
    return a / (a.std() + 1e-6)


def load(path):
    img = bpy.data.images.load(path, check_existing=True)
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)[..., :3]


# ── photo grain ──
skins = glob.glob(os.path.expanduser("~/Library/Application Support/Blender/*/extensions/.user/user_default/mpfb/data/skins"))
photo = np.zeros((N, N), np.float32)
used = []
if skins:
    d = sorted(skins)[-1]
    picks = ["young_caucasian_male/young_lightskinned_male_diffuse.png", "young_african_female/young_darkskinned_female_diffuse.png",
             "middleage_caucasian_male/middleage_lightskinned_male_diffuse.png", "young_asian_female/young_lightskinned_female_diffuse3.png"]
    # Flat skin patches, found per photo: windows wholly on skin (none of the flat background colour), with the
    # least broad relief in them (no island edges, nipples, navel, knuckles, the face's features).
    for p in picks:
        f = os.path.join(d, p)
        if not os.path.exists(f):
            continue
        a = load(f).mean(-1)
        bg = a[2, 2]
        from_bg = np.abs(a - bg) < 0.01
        sm = a.copy()
        for _ in range(3):
            sm = (np.roll(sm, 4, 0) + np.roll(sm, -4, 0) + np.roll(sm, 4, 1) + np.roll(sm, -4, 1) + sm) / 5
        edge = np.abs(np.roll(sm, 6, 0) - np.roll(sm, -6, 0)) + np.abs(np.roll(sm, 6, 1) - np.roll(sm, -6, 1))
        best = None
        for _ in range(400):
            x0, y0 = rng.integers(0, a.shape[1] - 256), rng.integers(0, a.shape[0] - 256)
            if from_bg[y0:y0 + 256, x0:x0 + 256].any():
                continue
            e = edge[y0:y0 + 256, x0:x0 + 256].max()
            if best is None or e < best[0]:
                best = (e, x0, y0)
        if best is None:
            continue
        _, x0, y0 = best
        y0, x0 = max(32, min(y0, a.shape[0] - 288)), max(32, min(x0, a.shape[1] - 288))
        big = a[y0 - 32:y0 + 288, x0 - 32:x0 + 288]
        hp = (big - wrap_blur(big, 5))[32:288, 32:288]   # high-pass (with a margin): the grain, not the shading
        hp = np.kron(norm(hp), np.ones((2, 2), np.float32))  # 256 -> 512
        hp = wrap_blur(hp, 0.8)
        photo += np.clip(hp, -3, 3)
        used.append(f"{p}@{x0},{y0}")
    if used:
        photo = norm(photo)
        # Cross-fade with itself shifted half a tile: seamless edges (the shifted copy's middle is at the edges).
        # (one axis at a time: each shifted copy's own seam then lies where its weight is 0)
        u = np.abs(np.arange(N) / (N - 1) - 0.5) * 2
        w = u * u * (3 - 2 * u)
        photo = photo * (1 - w[None, :]) + np.roll(photo, N // 2, 1) * w[None, :]
        photo = photo * (1 - w[:, None]) + np.roll(photo, N // 2, 0) * w[:, None]
        photo = norm(photo)

# ── pores ──
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
pores = np.zeros((N, N), np.float32)
C = 56  # cells across the tile (a pore every ~9 px)
cell = N / C
for cy in range(C):
    for cx in range(C):
        if rng.random() < 0.25:
            continue
        px = (cx + 0.2 + 0.6 * rng.random()) * cell
        py = (cy + 0.2 + 0.6 * rng.random()) * cell
        r = 0.8 + 1.3 * rng.random() ** 2
        dep = 0.4 + 0.6 * rng.random()
        x0, x1 = int(px - 4 * r), int(px + 4 * r) + 1
        y0, y1 = int(py - 4 * r), int(py + 4 * r) + 1
        ys = np.arange(y0, y1)
        xs = np.arange(x0, x1)
        dy = (ys - py)[:, None]
        dx = (xs - px)[None, :]
        pit = -dep * np.exp(-(dx * dx + dy * dy) / (r * r))
        pores[np.ix_(ys % N, xs % N)] += pit
pores = norm(pores)

# ── micro-creases: two families of fine grooves, wandering, at ~ +-35 degrees ──
def grooves(fx, fy, warp_seed, sharp=6.0):
    wn = wrap_blur(np.random.default_rng(warp_seed).standard_normal((N, N)).astype(np.float32), 10)
    wn = norm(wn) * 0.9
    ph = 2 * np.pi * (fx * xx + fy * yy) / N + wn
    return -(1 - np.abs(np.sin(ph))) ** sharp


creases = grooves(19, 27, 5) + grooves(-21, 25, 6) * 0.8 + grooves(41, -9, 7, 10) * 0.35
mod = norm(wrap_blur(rng.standard_normal((N, N)).astype(np.float32), 24)) * 0.35 + 1  # deeper in places
creases = norm(creases * np.clip(mod, 0.3, 1.8))

# ── grain ──
grain = norm(wrap_blur(rng.standard_normal((N, N)).astype(np.float32), 0.7))

h = 0.55 * pores + 0.4 * creases + 0.22 * grain + (0.35 * photo if used else 0)
h = norm(h)

# Normal from the height (wrapping differences); strength so the shader's scale ~1 reads as skin up close.
S = 0.9
gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * S
gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * S
nz = 1 / np.sqrt(1 + gx * gx + gy * gy)
nx, ny = -gx * nz, -gy * nz
rgba = np.ones((N, N, 4), np.float32)
rgba[..., 0] = nx * 0.5 + 0.5
rgba[..., 1] = ny * 0.5 + 0.5
rgba[..., 2] = np.clip(0.5 + h * 0.18, 0, 1)
img = bpy.data.images.new("skin_detail", N, N, alpha=False)
img.colorspace_settings.name = "Non-Color"
img.pixels.foreach_set(rgba.ravel())
img.filepath_raw = OUT
img.file_format = "WEBP"
bpy.context.scene.render.image_settings.quality = 92
img.save()
print("skin_detail ->", OUT, os.path.getsize(OUT), "bytes; photos:", used)
