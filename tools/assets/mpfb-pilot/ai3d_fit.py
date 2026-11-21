"""The `ai_f2` face from an image-to-3D head (refs/ai/3d, local only; ai3d_prep.py -> <ai_dir>/mesh.npz + color.png /
orm.png) onto the female MPFB base head, written as build_identities.py's identity files (ident/f/*_ai_f2.*), which
add_identities.mjs then turns into the morph target + atlas tiles like every other identity:

  1. landmarks on both heads (eye openings from the AI texture's sclera, the midline profile by rays: nose tip,
     subnasale, stomion, pogonion, menton) -> a similarity (scale, rotation, offset) bringing the AI head onto ours;
  2. shape: non-rigid ICP of our head + face (never the scalp under the hair, the neck fades out by the head weights):
     every vertex's nearest point on the AI's skin (not its hair, eyeballs, or anything facing away), solved as
     W (x + d - q) + lambda * membrane(d) with a stiff-to-loose schedule (conjugate gradients), the eye sockets
     carried with the eyes; eyes moved rigidly onto the AI's eye openings; brows / lashes / helpers by the skin's
     displacement nearby;
  3. skin: the face tile's texels on the fitted head -> nearest point on the AI mesh -> its albedo, light taken out
     (broad gradient), as the ratio over the game's albedo at the identity's tone (skin_tile encoding: RGB ratio / 2,
     A roughness from the AI's ORM); irises from the AI's eyes; brows stay painted in the skin (the brow card off).
Also writes <ai_dir>/fit.npz (alignment, fitted vertices) for ai3d_hair.py / ai3d_check.py.

Blender --background --python ai3d_fit.py -- <ai_dir> [tone_hex]
"""
import bpy, bmesh, os, sys, json, math, time
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
AI_DIR = os.path.abspath(_argv[0])
TONE = _argv[1] if len(_argv) > 1 else "6b4430"
IDENT = os.environ.get("AI3D_IDENT", "ai_f2")  # ai3d.mjs: the subject id / sex (defaults: the Nia pilot)
SEX = os.environ.get("AI3D_SEX", "f")
sys.argv = [sys.argv[0], "--", SEX, "nohair"]
_src = open(os.path.join(HERE, "build_identities.py"), encoding="utf-8").read().split("\nfor s in ID_SEXES:")[0]
exec(compile(_src, "build_identities.py", "exec"))
OUTD = os.environ.get("AI3D_IDENT_DIR") or OUTD  # ai3d.mjs --out: a scratch copy of ident/
T0 = time.time()


def log(*a):
    print("AI3D", f"{time.time() - T0:6.1f}s", *a, flush=True)


# ── our base head ──
clear()
bm, base_brow = human(SEX, None)
g = groups_of(bm)
TargetService.bake_targets(bm)
V0 = coords(bm).astype(np.float64)
NB = NBODY
hw = head_weights(bm)
E0 = {k: coords(o).astype(np.float64) for k, o in g.items()}
od = os.path.join(OUTD, SEX)
chk = np.fromfile(os.path.join(od, "body_base.bin"), np.float32).reshape(-1, 3)
log("base check max diff", float(np.abs(chk - V0).max()) if chk.shape == V0.shape else "shape mismatch")
lm = landmarks(bm, g)
_hv = V0[(V0[:, 2] > lm["eye_z"] - 0.04) & (V0[:, 2] < lm["eye_z"] + 0.01)]
lm["ear_y"] = float(_hv[np.argmax(np.abs(_hv[:, 0]))][1])
ne = len(bm.data.edges)
EDG = np.zeros(ne * 2, np.int32)
bm.data.edges.foreach_get("vertices", EDG)
EDG = EDG.reshape(-1, 2)
TRI = []
for poly in bm.data.polygons:
    vs = list(poly.vertices)
    for t in range(1, len(vs) - 1):
        TRI.append((vs[0], vs[t], vs[t + 1]))
TRI = np.array(TRI, np.int32)


def bvh_of(V, T):
    return BVHTree.FromPolygons([tuple(v) for v in V], [tuple(t) for t in T], all_triangles=True)


def vnormals(V, T):
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    n = np.zeros_like(V)
    for k in range(3):
        np.add.at(n, T[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def profile(bvh, z0, z1, step, y_from, x=0.0):
    """Front profile along the midline: (z, first hit y) of rays from the front (-Y) towards +Y."""
    out = []
    for z in np.arange(z0, z1, -step):
        hit = bvh.ray_cast(Vector((x, y_from, z)), Vector((0, 1, 0)))
        if hit[0] is not None:
            out.append((z, hit[0].y))
    return np.array(out)


def profile_marks(pr, u):
    """Nose tip, subnasale, stomion, pogonion, menton from a front profile (z down), u = the head's unit (eye distance)."""
    z, y = pr[:, 0], pr[:, 1]
    k = max(1, int(round(0.02 * u / abs(z[1] - z[0]))))
    ys = np.convolve(np.pad(y, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
    i_tip = int(np.argmin(ys))
    def next_ext(i, kind):
        for j in range(i + 1, len(ys) - 1):
            if kind == "max" and ys[j] >= ys[j - 1] and ys[j] > ys[j + 1]:
                return j
            if kind == "min" and ys[j] <= ys[j - 1] and ys[j] < ys[j + 1]:
                return j
        return len(ys) - 1
    i_sn = next_ext(i_tip, "max")
    i_ul = next_ext(i_sn, "min")
    i_st = next_ext(i_ul, "max")
    i_ll = next_ext(i_st, "min")
    i_su = next_ext(i_ll, "max")
    i_pg = next_ext(i_su, "min")
    # menton: where the profile leaves the chin (a jump back to the neck)
    i_me = i_pg
    for j in range(i_pg, len(y)):
        if y[j] > y[i_pg] + 0.25 * u:
            break
        i_me = j
    P = lambda i: np.array([0.0, y[i], z[i]])
    return dict(tip=P(i_tip), sn=P(i_sn), ul=P(i_ul), st=P(i_st), ll=P(i_ll), su=P(i_su), pg=P(i_pg), me=P(i_me))


def umeyama(src, dst, w=None):
    src, dst = np.asarray(src, np.float64), np.asarray(dst, np.float64)
    w = np.ones(len(src)) if w is None else np.asarray(w, np.float64)
    w = w / w.sum()
    ms, md = (w[:, None] * src).sum(0), (w[:, None] * dst).sum(0)
    a, b = src - ms, dst - md
    C = (w[:, None, None] * b[:, :, None] * a[:, None, :]).sum(0)
    U, S, Vt = np.linalg.svd(C)
    D = np.eye(3)
    D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    s = np.trace(np.diag(S) @ D) / (w * (a * a).sum(1)).sum()
    return s, R, md - s * R @ ms


# ── the AI head ──
AIM = np.load(os.path.join(AI_DIR, "mesh.npz"))
VA0 = AIM["V"].astype(np.float64)
TA = AIM["T"]
FUV = AIM["FUV"]
VC = np.maximum(AIM["VC"].astype(np.float64), 1e-4)
lum = VC.mean(1)
chroma = (VC.max(1) - VC.min(1)) / VC.max(1)
# eye openings: the sclera (bright, grey) in front, above the nose
sc = (lum > 0.55) & (chroma < 0.25) & (VA0[:, 1] < VA0[:, 1].min() * 0.5)
zc = np.median(VA0[sc, 2])
sc &= np.abs(VA0[:, 2] - zc) < 0.1 * (VA0[:, 2].max() - VA0[:, 2].min())
eyes_ai = {}
for s_ in (-1, 1):
    P = VA0[sc & (np.sign(VA0[:, 0]) == s_)]
    lo, hi = np.percentile(P, 1, 0), np.percentile(P, 99, 0)
    eyes_ai[s_] = dict(c=np.array([(lo[0] + hi[0]) / 2, np.median(P[:, 1]), (lo[2] + hi[2]) / 2]), lo=lo, hi=hi)
u_ai = abs(eyes_ai[1]["c"][0] - eyes_ai[-1]["c"][0])
log("AI eyes", {k: np.round(v["c"], 4).tolist() for k, v in eyes_ai.items()}, "unit", round(u_ai, 4))
keep_ai = VA0[:, 2] > eyes_ai[1]["c"][2] - 2.2 * u_ai  # head + neck (no shoulders / top)
bvh_a0 = bvh_of(VA0[keep_ai], np.searchsorted(np.flatnonzero(keep_ai), TA[keep_ai[TA].all(1)]))
ez = (eyes_ai[1]["c"][2] + eyes_ai[-1]["c"][2]) / 2
pr_ai = profile(bvh_a0, ez - 0.05 * u_ai, ez - 2.0 * u_ai, 0.004 * u_ai, VA0[:, 1].min() - 0.1)
mk_ai = profile_marks(pr_ai, u_ai)
# ours
ours_eyes = {}
for s_ in (-1, 1):
    P = E0["eyes"][np.sign(E0["eyes"][:, 0]) == s_]
    ours_eyes[s_] = dict(center=P.mean(0), front=P[np.argmin(P[:, 1])], r=(P[:, 0].max() - P[:, 0].min()) / 2)
u_us = abs(ours_eyes[1]["front"][0] - ours_eyes[-1]["front"][0])
bvh_u0 = bvh_of(V0[:NB], TRI[(TRI < NB).all(1)])
ezu = ours_eyes[1]["front"][2]
pr_us = profile(bvh_u0, ezu - 0.05 * u_us, ezu - 2.2 * u_us, 0.004 * u_us, V0[:, 1].min() - 0.1)
mk_us = profile_marks(pr_us, u_us)
log("marks ai", {k: np.round(v, 4).tolist() for k, v in mk_ai.items()})
log("marks us", {k: np.round(v, 4).tolist() for k, v in mk_us.items()})
names = ["tip", "sn", "st", "pg", "me"]
src = [eyes_ai[-1]["c"], eyes_ai[1]["c"]] + [mk_ai[n] for n in names]
dst = [ours_eyes[-1]["front"], ours_eyes[1]["front"]] + [mk_us[n] for n in names]
s_al, R_al, t_al = umeyama(src, dst, [1.5, 1.5, 1, 0.7, 1, 1, 1])
VA = VA0 @ (s_al * R_al).T + t_al
res = np.array(src) @ (s_al * R_al).T + t_al - np.array(dst)
log("align scale", round(s_al, 5), "landmark residuals mm", np.round(np.linalg.norm(res, axis=1) * 1000, 1).tolist())
log("AI head in our frame: top z", round(VA[:, 2].max(), 3), "bust bottom z", round(VA[:, 2].min(), 3), "width", round(VA[:, 0].max() - VA[:, 0].min(), 3))

# ── labels on the AI mesh: skin / hair / eye ──
eyes_al = {s_: dict(c=e["c"] @ (s_al * R_al).T + t_al, lo=e["lo"] @ (s_al * R_al).T + t_al, hi=e["hi"] @ (s_al * R_al).T + t_al) for s_, e in eyes_ai.items()}
ymin_face = VA[:, 1].min()
lab = np.zeros(len(VA), np.int8)  # 0 skin, 1 hair, 2 eye, 3 cloth
mezu = mk_us["me"][2]
# hair: dark, and where hair grows -- above the brows (not the brows / forehead in front), behind the ears' fronts
# down to the nape; on the crown even its lit curls. (The baked shadow on one cheek / under the jaw is skin.)
ezl, eyl = lm["eye_z"], lm["ear_y"]
browzone = (VA[:, 1] < -0.085) & (VA[:, 2] < ezl + 0.05) & (np.abs(VA[:, 0]) < 0.058)
grows = ((VA[:, 2] > ezl + 0.025) & ~browzone) | ((VA[:, 1] > eyl + 0.004) & (VA[:, 2] > ezl - 0.06))
lab[(lum < 0.2) & grows] = 1
lab[(lum < 0.3) & (VA[:, 2] > ezl + 0.07) & (VA[:, 1] > -0.09)] = 1
lab[(VA[:, 2] < mezu - 0.02) & (chroma < 0.3)] = 3
for s_, e in eyes_al.items():
    hx = (e["hi"][0] - e["lo"][0]) / 2 * 1.0
    hz = (e["hi"][2] - e["lo"][2]) / 2 * 1.0
    q = ((VA[:, 0] - e["c"][0]) / hx) ** 2 + ((VA[:, 2] - e["c"][2]) / hz) ** 2
    lab[(q < 1) & (VA[:, 1] < e["c"][1] + 0.006)] = 2
# smooth the hair label over the mesh (majority of the neighbourhood, a few rounds): curls' highlights, dark creases
nbr_e = np.concatenate([TA[:, [0, 1]], TA[:, [1, 2]], TA[:, [2, 0]]])
for _ in range(6):
    h = (lab == 1).astype(np.float32)
    acc = np.bincount(nbr_e[:, 0], h[nbr_e[:, 1]], len(VA)) + np.bincount(nbr_e[:, 1], h[nbr_e[:, 0]], len(VA)) + h
    cnt = np.bincount(nbr_e[:, 0], None, len(VA)) + np.bincount(nbr_e[:, 1], None, len(VA)) + 1
    f = acc / cnt
    lab[(lab == 0) & (f > 0.5) & grows] = 1
    lab[(lab == 1) & (f < 0.5)] = 0
log("labels skin/hair/eye/cloth", [int((lab == k).sum()) for k in range(4)])
tlab = np.where((lab[TA] == 1).sum(1) >= 2, 1, np.where((lab[TA] == 2).sum(1) >= 2, 2, np.where((lab[TA] == 3).sum(1) >= 2, 3, 0)))
keepc = VA[TA].min(1)[:, 2] > mezu - 0.12
TAc = TA[keepc]
TLc = tlab[keepc]
FUVc = FUV[keepc]
log("AI tris kept", len(TAc))
bvh_a = BVHTree.FromPolygons([tuple(v) for v in VA], [tuple(t) for t in TAc], all_triangles=True)
log("AI bvh built")
FNA = np.cross(VA[TAc[:, 1]] - VA[TAc[:, 0]], VA[TAc[:, 2]] - VA[TAc[:, 0]])
FNA /= np.linalg.norm(FNA, axis=1, keepdims=True) + 1e-12

# ── shape: non-rigid ICP ──
unk = np.flatnonzero((hw > 0.0) & (np.arange(len(V0)) < NB))
pos_of = -np.ones(len(V0), np.int64)
pos_of[unk] = np.arange(len(unk))
ed = EDG[(EDG < NB).all(1)]
deg_all = np.bincount(ed.ravel(), minlength=len(V0)).astype(np.float64)
eu = ed[(pos_of[ed[:, 0]] >= 0) & (pos_of[ed[:, 1]] >= 0)]
ea, eb = pos_of[eu[:, 0]], pos_of[eu[:, 1]]
deg = deg_all[unk]
nU = len(unk)
wfit = smooth(0.35, 0.85, hw[unk])
# eye sockets (inside the lids, round our eyeballs): carried with the eyes
socket = np.zeros(nU)
eye_shift = {}
for s_ in (-1, 1):
    eo = ours_eyes[s_]
    ea_ = eyes_al[s_]
    eye_shift[s_] = np.array([ea_["c"][0] - eo["front"][0], ea_["c"][1] - eo["front"][1], ea_["c"][2] - eo["front"][2]])
    dd = np.linalg.norm(V0[unk] - eo["center"], axis=1)
    # (inside the eyeball's sphere: the hidden socket; the lids, just outside it, are fitted)
    socket = np.maximum(socket, (dd < eo["r"] * 1.0).astype(float))
log("eye shifts mm", {k: np.round(v * 1000, 1).tolist() for k, v in eye_shift.items()})


def solve(W, B, lam, x0, iters=1500, tol=1e-9):
    """(diag(W) + lam * L) d = W * B by conjugate gradients (3 columns at once); L: membrane, fixed outside unk."""
    def A(x):
        nb = np.stack([np.bincount(ea, x[eb, c], nU) + np.bincount(eb, x[ea, c], nU) for c in range(3)], 1)
        return W[:, None] * x + lam * (deg[:, None] * x - nb)
    b = W[:, None] * B
    x = x0.copy()
    r = b - A(x)
    p = r.copy()
    rs = (r * r).sum(0)
    for it in range(iters):
        Ap = A(p)
        a = rs / np.maximum((p * Ap).sum(0), 1e-30)
        x += p * a
        r -= Ap * a
        rn = (r * r).sum(0)
        if rn.max() < tol * tol * len(b):
            break
        p = r + p * (rn / np.maximum(rs, 1e-30))
        rs = rn
    return x


# ── the eye openings: ours opened towards the AI's (a smooth anisotropic warp round each eye) ──
# The AI's openings are rounder: measured on front close-ups at one scale (ai3d_check.py "eyes"), ours ~28.5 x 8.4 mm,
# the AI's ~32 x 14 mm; opened by 1.05 x 1.3 (more tears the lids; the rest of the difference is the AI's bigger ball).
EYE_SX, EYE_SZ = float(os.environ.get("AI3D_EYE_SX", 1.05)), float(os.environ.get("AI3D_EYE_SZ", 1.3))
def eye_warp(P):
    """The eye openings' warp at points P: displacement, weight (1 in the openings and lids, 0 by 2.6 widths out)."""
    out = np.zeros_like(P)
    wz = np.zeros(len(P))
    for s_ in (-1, 1):
        ce = ours_eyes[s_]["center"]
        cf = ours_eyes[s_]["front"]
        rel = P - cf
        # ellipsoidal distance in the front view, in units of our opening's half width / height
        e = np.sqrt((rel[:, 0] / 0.0143) ** 2 + (rel[:, 2] / 0.0042) ** 2 * 0.35 + (rel[:, 2] / 0.0143) ** 2 * 0.65)
        t_ = np.clip((e - 1.0) / 1.6, 0, 1)
        w_ = (1 - t_ * t_ * (3 - 2 * t_)) * (np.sign(P[:, 0]) == s_) * (P[:, 1] < cf[1] + 0.025)
        dw = np.zeros_like(P)
        dw[:, 0] = rel[:, 0] * (EYE_SX - 1) * w_
        dw[:, 2] = rel[:, 2] * (EYE_SZ - 1) * w_
        dw += eye_shift[s_] * w_[:, None]
        # depth: each point in front of the ball keeps its distance from the ball's centre (the lids hug it as they open)
        ce2 = ce + eye_shift[s_]
        Rv = np.linalg.norm(P - ce, axis=1)
        p2 = P + dw
        dxz = (p2[:, 0] - ce2[0]) ** 2 + (p2[:, 2] - ce2[2]) ** 2
        yb = ce2[1] - np.sqrt(np.maximum(Rv ** 2 - dxz, 0))
        wy = w_ * (P[:, 1] < ce[1])
        dw[:, 1] = dw[:, 1] * (1 - wy) + (yb - P[:, 1]) * wy
        m = w_ > 0
        out[m] = dw[m]
        wz = np.maximum(wz, w_)
    return out, wz


D_warp, eyezone = eye_warp(V0[unk])

# ── the ears: too folded for nearest-surface fitting (it crumples them): each moved as a whole -- a similarity fitted
# by ICP of our outer ear onto the AI's ear -- fading out round it ──
ear_rigid = {}
for s_ in (-1, 1):
    zc = lm["eye_z"] - 0.012
    cand = (np.sign(V0[:NB, 0]) == s_) & (np.abs(V0[:NB, 0]) > 0.068) & (np.abs(V0[:NB, 1] - lm["ear_y"]) < 0.03) & (np.abs(V0[:NB, 2] - zc) < 0.035)
    ec = V0[:NB][cand].mean(0)
    R_ear = np.array([0.03, 0.022, 0.035])
    e_all = np.linalg.norm((V0[:NB] - ec) / R_ear, axis=1) * (np.sign(V0[:NB, 0]) == s_) + (np.sign(V0[:NB, 0]) != s_) * 9
    sel = np.flatnonzero((e_all < 0.85) & (np.abs(V0[:NB, 0]) > abs(ec[0]) - 0.012))
    near_ai = (np.linalg.norm(VA[TAc].mean(1) - ec, axis=1) < 0.05) & (TLc == 0) & (np.sign(VA[TAc].mean(1)[:, 0]) == s_)
    bvh_ear = BVHTree.FromPolygons([tuple(v) for v in VA], [tuple(x) for x in TAc[near_ai]], all_triangles=True)
    P0 = V0[sel]
    # start: the outer ears' boxes matched (their height sets the size)
    def ear_box(P):
        lo, hi = np.percentile(P, 2, 0), np.percentile(P, 98, 0)
        return (lo + hi) / 2, hi - lo
    outer_us = V0[:NB][cand & (np.abs(V0[:NB, 0]) > abs(ec[0]) + 0.002)]
    av = (np.linalg.norm(VA - ec, axis=1) < 0.045) & (lab == 0) & (np.sign(VA[:, 0]) == s_) & (np.abs(VA[:, 0]) > abs(ec[0]) + 0.002) & (np.abs(VA[:, 1] - ec[1]) < 0.035)
    cu_, su_ = ear_box(outer_us)
    ca_, sa_ = ear_box(VA[av])
    sR0 = float(np.clip(sa_[2] / max(su_[2], 1e-4), 0.9, 1.3))
    log("ear", s_, "box ours (mm)", np.round(su_ * 1000).tolist(), "AI", np.round(sa_ * 1000).tolist(), "centre shift", np.round((ca_ - cu_) * 1000, 1).tolist())
    sR, RR, tt = sR0, np.eye(3), ca_ - sR0 * cu_
    for it in range(25):
        Pc = P0 @ (sR * RR).T + tt
        src_, dst_ = [], []
        for k, p in enumerate(Pc):
            h = bvh_ear.find_nearest(Vector(p), 0.02 if it < 8 else 0.008)
            if h[0] is not None:
                src_.append(P0[k])
                dst_.append(tuple(h[0]))
        if len(src_) < 20:
            break
        sR, RR, tt = umeyama(src_, dst_)
        sR = sR0  # (its size from the boxes: the back of the ear pairs with the AI's head, which would shrink it)
        tt = np.mean(np.array(dst_) - np.array(src_) @ (sR * RR).T, 0)
    Pc = P0 @ (sR * RR).T + tt
    res = [bvh_ear.find_nearest(Vector(p), 0.02) for p in Pc]
    rr = np.array([h[3] for h in res if h[0] is not None])
    ear_rigid[s_] = dict(c=ec, R=R_ear, s=sR, Rm=RR, t=tt)
    log("ear", s_, "verts", len(sel), "scale", round(sR, 3), "shift mm", np.round((ec @ (sR * RR).T + tt - ec) * 1000, 1).tolist(), "rms mm", round(float(np.sqrt((rr ** 2).mean())) * 1000, 2) if len(rr) else None)
D_ear = np.zeros((nU, 3))
earzone = np.zeros(nU)
for s_, er in ear_rigid.items():
    Pu = V0[unk]
    e = np.linalg.norm((Pu - er["c"]) / er["R"], axis=1)
    w_ = (1 - smooth(0.85, 1.9, e)) * (np.sign(Pu[:, 0]) == s_)
    d_ = Pu @ (er["s"] * er["Rm"]).T + er["t"] - Pu
    D_ear += d_ * w_[:, None]
    earzone = np.maximum(earzone, w_)
D_warp = D_warp + D_ear  # (one prior: the eyes' warp and the ears' moves are far apart)
D = D_warp.copy()
TRIb = TRI[(TRI < NB).all(1)]
SCHED = [(30.0, 0.030, 0.3), (10.0, 0.020, 0.45), (3.0, 0.012, 0.55), (1.0, 0.008, 0.6), (0.3, 0.006, 0.6), (0.1, 0.005, 0.6), (0.05, 0.004, 0.6)]
for lam, maxd, ndot in SCHED:
    X = V0.copy()
    X[unk] += D
    Nn = vnormals(X[:NB], TRIb)
    Q = np.zeros((nU, 3))
    W = np.zeros(nU)
    for k, i in enumerate(unk):
        if wfit[k] <= 0 or socket[k] > 0 or eyezone[k] > 0.9 or earzone[k] > 0.3:
            continue
        hit = bvh_a.find_nearest(Vector(X[i]), maxd)
        if hit[0] is None:
            continue
        fi = hit[2]
        if TLc[fi] != 0:
            continue
        if float(np.dot(FNA[fi], Nn[i])) < ndot:
            continue
        Q[k] = tuple(hit[0])
        W[k] = wfit[k]
    # sockets: with the eyes
    # the eye openings' warp as a prior round the lids (and all of it in the sockets)
    wp = np.maximum(np.maximum(0.5 * socket, 1.0 * smooth(0.5, 0.95, eyezone)), 2.0 * smooth(0.05, 0.4, earzone))
    W2 = W + wp
    B = (np.where(W[:, None] > 0, Q - V0[unk], 0) * W[:, None] + D_warp * wp[:, None]) / np.maximum(W2, 1e-9)[:, None]
    D = solve(W2, B, lam, D)
    X = V0.copy()
    X[unk] += D
    ok = W > 0
    dist = np.linalg.norm(X[unk][ok] - Q[ok], axis=1)
    icp_last = dict(icp_matched=int(ok.sum()), icp_rms_mm=float(np.sqrt((dist ** 2).mean()) * 1000), icp_p95_mm=float(np.percentile(dist, 95) * 1000))
    log(f"ICP lam {lam:5.2f} maxd {maxd*1000:.0f}mm: matched {int(ok.sum())} rms {np.sqrt((dist ** 2).mean()) * 1000:.2f}mm p95 {np.percentile(dist, 95) * 1000:.2f}mm")
# the scalp under the hair (no AI skin to fit): kept >= 4 mm inside the AI's hair shell, so its own hair, cut out of
# that shell (ai3d_hair.py), never has our scalp poking through; the rest of the face as fitted
hairT = TAc[TLc == 1]
bvh_hair = BVHTree.FromPolygons([tuple(v) for v in VA], [tuple(x) for x in hairT], all_triangles=True)
FNH = FNA[TLc == 1]
for it in range(4):
    X = V0.copy()
    X[unk] += D
    NnS = vnormals(X[:NB], TRIb)
    Wh = np.zeros(nU)
    Qh = np.zeros((nU, 3))
    for k, i in enumerate(unk):
        if W[k] > 0 or socket[k] > 0 or earzone[k] > 0.05 or X[i, 2] < lm["eye_z"] - 0.07:
            continue
        hit = bvh_hair.find_nearest(Vector(X[i]), 0.04)
        if hit[0] is None:
            continue
        n = FNH[hit[2]]
        sd = float((X[i] - np.array(hit[0])) @ n)
        # (only hair over the scalp: the shell facing the way the scalp does; never more than 12 mm of pull)
        if float(n @ NnS[i]) < 0.6:
            continue
        if -0.004 < sd < 0.012:
            Qh[k] = np.array(hit[0]) - n * 0.005
            Wh[k] = 1.0
    W3 = W + Wh + wp
    B3 = (np.where(W[:, None] > 0, Q - V0[unk], 0) * W[:, None] + (Qh - V0[unk]) * Wh[:, None] + D_warp * wp[:, None]) / np.maximum(W3, 1e-9)[:, None]
    B3 = np.where(W3[:, None] > 0, B3, 0)
    D = solve(W3, B3, 0.3, D)
    log("scalp under the hair: pushed in", int(Wh.sum()))
# final: no displacement where the head weight runs out (the neck's base stays the body's)
D *= smooth(0.05, 0.4, hw[unk])[:, None]
Xf = V0.copy()
Xf[unk] += D


def idw(Psrc, Dsrc, Pq, k=6):
    """Inverse-distance mean of the k nearest source displacements (brute force in chunks)."""
    out = np.zeros_like(Pq)
    for a in range(0, len(Pq), 512):
        q = Pq[a:a + 512]
        d2 = ((q[:, None] - Psrc[None]) ** 2).sum(-1)
        idx = np.argpartition(d2, k, axis=1)[:, :k]
        dd = np.take_along_axis(d2, idx, 1)
        w = 1 / (dd + 1e-8)
        out[a:a + 512] = (Dsrc[idx] * w[..., None]).sum(1) / w.sum(1, keepdims=True)
    return out


headm = (hw[:NB] > 0)
HP, HD = V0[:NB][headm], (Xf - V0)[:NB][headm]
# helpers (teeth, tongue, joints...): the skin's displacement nearby
if len(V0) > NB:
    Xf[NB:] = V0[NB:] + idw(HP, HD, V0[NB:]) * hw[NB:, None]
deltas = {"body": (Xf - V0)}
eyes_new = E0["eyes"].copy()
for s_ in (-1, 1):
    m = np.sign(E0["eyes"][:, 0]) == s_
    eyes_new[m] += eye_shift[s_]
deltas["eyes"] = eyes_new - E0["eyes"]
deltas["brows"] = idw(HP, HD, E0["brows"], 4)
# lashes: by the lids' own warp (an IDW of the skin would pull the tips with the crease, the roots with the margin),
# plus what the fit added round them
wl, wlz = eye_warp(E0["lashes"])
deltas["lashes"] = wl + idw(HP, HD - np.concatenate([eye_warp(HP)[0]]), E0["lashes"], 4)
for k, d in deltas.items():
    d.astype(np.float32).tofile(os.path.join(od, f"{k}_{IDENT}.bin"))
    log("delta", k, "max mm", round(float(np.abs(d).max()) * 1000, 1))

# ── fit quality: our face vs the AI surface, and the AI's face vs ours ──
face_us = (hw[:NB] > 0.9) & (V0[:NB, 1] < lm["ear_y"] - 0.02) & (V0[:NB, 2] < lm["eye_z"] + 0.06) & (V0[:NB, 2] > mk_us["me"][2] - 0.005)
sock_ids = set(unk[socket > 0].tolist())
fi_us = np.array([i for i in np.flatnonzero(face_us) if i not in sock_ids])
d_us, ok_us = [], []
Nf = vnormals(Xf[:NB], TRIb)
for i in fi_us:
    hit = bvh_a.find_nearest(Vector(Xf[i]), 0.02)
    if hit[0] is None or TLc[hit[2]] != 0 or float(np.dot(FNA[hit[2]], Nf[i])) < 0.3:
        continue
    d_us.append(hit[3])
d_us = np.array(d_us)
bvh_f = bvh_of(Xf[:NB], TRIb)
fa = np.flatnonzero((lab == 0) & (VA[:, 2] < lm["eye_z"] + 0.06) & (VA[:, 2] > mk_us["me"][2]) & (VA[:, 1] < lm["ear_y"] - 0.01))
fa = fa[:: max(1, len(fa) // 40000)]
d_ai = []
for i in fa:
    hit = bvh_f.find_nearest(Vector(VA[i]), 0.02)
    if hit[0] is not None:
        d_ai.append(hit[3])
d_ai = np.array(d_ai)
stats = dict(ours_to_ai_rms_mm=float(np.sqrt((d_us ** 2).mean()) * 1000), ours_to_ai_p95_mm=float(np.percentile(d_us, 95) * 1000), ours_matched=int(len(d_us)), ours_face=int(len(fi_us)),
             ai_to_ours_rms_mm=float(np.sqrt((d_ai ** 2).mean()) * 1000), ai_to_ours_p95_mm=float(np.percentile(d_ai, 95) * 1000), ai_points=int(len(d_ai)), ai_sampled=int(len(fa)),
             scale=float(s_al), **icp_last, eye_shift_mm={str(k): (v * 1000).round(2).tolist() for k, v in eye_shift.items()})
log("FIT", json.dumps(stats))

# ── skin tile on the fitted head ──
mw_inv = np.array(bm.matrix_world.inverted(), np.float64)
loc = Xf @ mw_inv[:3, :3].T + mw_inv[:3, 3]
bm.data.vertices.foreach_set("co", loc.astype(np.float32).ravel())
bm.data.update()
VB = V0
ear_y = lm["ear_y"]
uv = bm.data.uv_layers.active.data
keep = np.zeros(len(bm.data.polygons), bool)
us_, vs_ = [], []
for poly in bm.data.polygons:
    if max(poly.vertices) < NBODY and min(hw[v] for v in poly.vertices) > 0.9 and all(VB[v][1] < ear_y and VB[v][2] < lm["eye_z"] + 0.075 for v in poly.vertices) and min(uv[li].uv[0] for li in poly.loop_indices) > 0.55 and min(uv[li].uv[1] for li in poly.loop_indices) > 0.15:
        keep[poly.index] = True
        for li in poly.loop_indices:
            us_.append(uv[li].uv[0])
            vs_.append(uv[li].uv[1])
meta = json.load(open(os.path.join(od, "meta.json")))
rect = tuple(meta["rect_blender"])  # (the atlas layout: as build_identities computed it)
log("rect", np.round(rect, 4).tolist(), "meta rect", np.round(meta["rect_blender"], 4).tolist())
P, N, M = raster(bm, rect, keep)
cimg = bpy.data.images.load(os.path.join(AI_DIR, "color.png"))
CA = s2l(img_np(cimg)[..., :3])  # rows bottom-up = v up
oimg = bpy.data.images.load(os.path.join(AI_DIR, "orm.png"))
OA = img_np(oimg)[..., :3]
HCA, WCA = CA.shape[:2]


def bilin(img, uvq):
    H_, W_ = img.shape[:2]
    x = (uvq[:, 0] % 1) * W_ - 0.5
    y = (uvq[:, 1] % 1) * H_ - 0.5
    x0 = np.clip(np.floor(x).astype(int), 0, W_ - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, H_ - 2)
    fx, fy = np.clip(x - x0, 0, 1)[:, None], np.clip(y - y0, 0, 1)[:, None]
    return img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy


TH_, TW_ = M.shape
flat = P.reshape(-1, 3)
mm = M.reshape(-1) > 0
col = np.zeros((len(flat), 3))
rgh = np.full(len(flat), np.nan)
tlab_t = np.full(len(flat), -1)
uvs_t = np.zeros((len(flat), 2))
for k in np.flatnonzero(mm):
    hit = bvh_a.find_nearest(Vector(flat[k]), 0.03)
    if hit[0] is None:
        continue
    fi = hit[2]
    a, b, c = VA[TAc[fi]]
    p = np.array(hit[0])
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    bv = (d11 * d20 - d01 * d21) / den if den else 0
    bw = (d00 * d21 - d01 * d20) / den if den else 0
    bu = 1 - bv - bw
    uvs_t[k] = bu * FUVc[fi, 0] + bv * FUVc[fi, 1] + bw * FUVc[fi, 2]
    tlab_t[k] = TLc[fi]
got = tlab_t >= 0
col[got] = bilin(CA, uvs_t[got])
rgh[got] = bilin(OA, uvs_t[got])[:, 1]
col = col.reshape(TH_, TW_, 3)
rgh = rgh.reshape(TH_, TW_)
got = got.reshape(TH_, TW_) & (M > 0)
tl_ = tlab_t.reshape(TH_, TW_)
log("texels projected", int(got.sum()), "of", int((M > 0).sum()))
# the game's albedo at the identity's tone: base map x tint (character.ts humanBodyMaterial)
bimg = bpy.data.images.load(os.path.join(AI_DIR, f"base_skin_{SEX}.png"))
base = crop(bimg.filepath, rect)  # linear, rows top = glTF v0
tone = s2l(np.array([int(TONE[i:i + 2], 16) for i in (0, 2, 4)], np.float64) / 255.0)
game = base * (tone / TEX_SKIN)
# light out of the AI albedo: its broad luminance gradient (baked key / fill) divided away, against the face median
x_, y_, z_ = P[..., 0] - lm["mid"][0], P[..., 1] - lm["mid"][1], P[..., 2] - lm["mid"][2]
front = smooth(-0.1, -0.5, N[..., 1] / (np.linalg.norm(N, axis=-1) + 1e-9)) * M
skin_t = got & (tl_ == 0)
lc = np.log(np.maximum(col, 1e-4))
L = lc.mean(-1)
Lb, _ = _nblur(L[..., None], (skin_t & (front > 0.2)).astype(np.float32), 60)
Lb = Lb[..., 0]
cheek = skin_t & (np.abs(x_) > 0.02) & (np.abs(x_) < 0.05) & (z_ < -0.015) & (z_ > -0.045) & (front > 0.3)
Lref = np.median(L[cheek])
# the baked key light is one-sided: the broad luminance minus its mirror-symmetric part goes wholly; of the symmetric
# part (top light: brighter brow ridge / nose, darker under the jaw) half
q = np.round(np.stack([np.abs(x_), y_, z_], -1).reshape(-1, 3) / 0.004).astype(np.int64)
inm = (M.reshape(-1) > 0)
_, inv = np.unique(q[inm], axis=0, return_inverse=True)
inv = inv.reshape(-1)
acc = np.bincount(inv, Lb.reshape(-1)[inm])
cnt = np.bincount(inv)
Lsym = Lb.copy().reshape(-1)
Lsym[inm] = (acc / cnt)[inv]
Lsym = blur(Lsym.reshape(TH_, TW_).astype(np.float32), 4)
gradient = (Lb - Lsym) + (Lsym - Lref) * 0.5
# ... and the mid scale (a shadowed cheek, one lit side of the nose): mirrored too, the fine detail as painted
Lm_, _ = _nblur(L[..., None], (skin_t & (front > 0.1)).astype(np.float32), 10)
Lm_ = Lm_[..., 0] - Lb
acc = np.bincount(inv, Lm_.reshape(-1)[inm])
Lms = Lm_.copy().reshape(-1)
Lms[inm] = (acc / cnt)[inv]
Lms = blur(Lms.reshape(TH_, TW_).astype(np.float32), 3)
gradient = gradient + (Lm_ - Lms) * smooth(0.2, 0.5, front)
lc2 = lc - gradient[..., None]
# the painting's mid-scale shading (dark rings round the eyes, under the nose / lips): its darkening 40 % out -- the
# game's light and our sockets shade them again
Lc2 = lc2.mean(-1)
Lmid = blur(Lc2.astype(np.float32), 8) - blur(Lc2.astype(np.float32), 40)
lc2 = lc2 - 0.4 * np.minimum(Lmid, 0)[..., None] * front[..., None]
alb = np.exp(lc2)
ratio = alb / np.maximum(game, 1e-4)
rmed = np.median(ratio[cheek], 0)
log("AI cheek albedo (sRGB)", np.round(l2s(np.median(alb[cheek], 0)) * 255).tolist(), "game at tone", np.round(l2s(np.median(game[cheek], 0)) * 255).tolist(), "ratio median", np.round(rmed, 3).tolist())
# where nothing (or the AI's eyeballs) projected: the skin round it; then the tile's edge feathered to the median
# ratio's luminance (so the face's mean sits on the tone, its hue the AI's)
valid = got & (tl_ == 0)  # (the AI's eyeballs and hair: the skin round them -- the hair mesh / underlay do the hairline)
# ... and its painted short hair at the temples / over the ears (labelled skin, but much darker than the skin there)
templ = (L - Lref < math.log(0.5)) & (z_ > -0.005) & (np.abs(x_) > 0.045)
valid &= ~templ
lr = np.log(np.maximum(ratio, 1e-4))
lr = _fill(lr.astype(np.float32), valid)
feather = smooth(0.55, 0.95, blur(M.astype(np.float32), 6))
# the face's median onto the tone, all channels: the AI's hue against the tone's goes to the whole body instead
# (identityData tint, character.ts: the body's tone x the identity's tint), so face, neck and ears stay one skin
lmed = np.log(rmed)
lr = (lr - lmed[None, None, :]) * feather[..., None]
# the temples and the sides above the ears (the AI's sideburns / hair shadow; under the hair here): the tone itself
side = smooth(0.05, 0.064, np.abs(x_)) * smooth(-0.02, 0.0, z_)
lr = lr * (1 - side[..., None])
TINT = np.exp(lmed - lmed.mean())
log("identity tint (linear, x the tone)", np.round(TINT, 3).tolist())
ratio_o = np.exp(np.clip(lr, np.log(0.02), np.log(1.99)))
rough = np.where(np.isfinite(rgh), rgh, 0.5)
rmed_r = np.median(rough[cheek])
rough = 0.5 + (rough - rmed_r) * 0.8 * feather
rgb = np.clip(ratio_o / 2.0, 0, 1)
rgb = np.where(M[..., None] > 0, rgb, 0.5)
tile = np.concatenate([rgb, np.clip(rough, 0, 1)[..., None]], -1)
(tile * 255 + 0.5).astype(np.uint8).tofile(os.path.join(od, f"skin_{IDENT}.bin"))
dbg = np.where(M[..., None] > 0, l2s(np.minimum(game * TINT * ratio_o, 1)), 0.3)
save_png(np.concatenate([dbg[::-1], np.ones_like(dbg[::-1, ..., :1])], -1), os.path.join(od, f"aiproj_{IDENT}.png"), "aiproj")
log("cheek ratio after", np.round(np.median(ratio_o[cheek], 0), 3).tolist(), "cheek texels", int(cheek.sum()), "hair texels", int((tl_ == 1).sum()), "of", int((M > 0).sum()))
log("ratio range", np.round(np.percentile(ratio_o[M > 0], [1, 50, 99], axis=0), 3).tolist())

# ── irises: the AI's eye colour (dark, saturated texels inside the openings) ──
eyesel = (lab == 2) & (lum < 0.3) & (lum > 0.03) & (chroma > 0.25)
iris_lin = np.median(s2l(VC[eyesel]), 0) if eyesel.sum() > 20 else s2l(np.array([0.23, 0.14, 0.09]))
log("iris (sRGB)", np.round(l2s(iris_lin) * 255).tolist(), "from", int(eyesel.sum()))
ident = [i for i in IDS[SEX] if i["id"] == IDENT][0]
ep = mhmat_texture(os.path.join(MPFB_USER, "eyes", "materials", ident["eyes"] + ".mhmat"))
ai_eye_texture(ep, os.path.join(od, f"eyes_{IDENT}.png"), iris_lin)
# brows: painted in the skin (from the AI texture); the brow card stays in place but transparent
bw_ = np.zeros((64, 64, 4), np.float32)
save_png(bw_, os.path.join(od, f"brow_{IDENT}.png"), "brow_off", alpha=True)
bi = json.load(open(os.path.join(od, "brow_uv.json")))
u = g["brows"].data.uv_layers.active.data
bi[IDENT] = dict(asset=base_brow, faces=[list(p.vertices) for p in g["brows"].data.polygons], uv=[[tuple(u[li].uv) for li in p.loop_indices] for p in g["brows"].data.polygons])
json.dump(bi, open(os.path.join(od, "brow_uv.json"), "w"))
# meta: this identity's entry (keeps its place in the atlas)
for e in meta["identities"]:
    if e["id"] == IDENT:
        e.update(ident, tint=TINT.round(4).tolist(), maxDelta={k: float(np.abs(d).max()) for k, d in deltas.items()}, shift=[0.0, 0.0, 0.0], ai3d=dict(stats, tone=TONE, iris_srgb=(l2s(iris_lin) * 255).round().tolist()))
json.dump(meta, open(os.path.join(od, "meta.json"), "w"), indent=1)
np.savez_compressed(os.path.join(AI_DIR, "fit.npz"), s=s_al, R=R_al, t=t_al, Xf=Xf, V0=V0, hw=hw, lab=lab, eyes_new=eyes_new, eyes0=E0["eyes"], eyes_tris=np.array([list(p.vertices)[:3] for p in g["eyes"].data.polygons] + [[list(p.vertices)[0], list(p.vertices)[2], list(p.vertices)[3]] for p in g["eyes"].data.polygons if len(p.vertices) == 4]), rect=np.array(rect), stats=json.dumps(stats), tris=TRI)
log("done")
