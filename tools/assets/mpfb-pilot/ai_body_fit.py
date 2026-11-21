"""AI body build ("ai_body" morph target): our shipped MPFB body fitted to an AI 3D body (Tripo; refs/ai/bodies, local,
never shipped). Only OUR mesh's vertex offsets leave this script (topology, UVs, weights, groups untouched).

Inputs: ai_body_dump.mjs (our body, glTF Y-up model space, rest T-pose, vertex order as in the GLB) and
ai_body_target.mjs (the AI mesh + albedo). Output: ai/fit/<sex>/ai_body_delta.bin (float32 n x 3, rest space) + fit.json.

  1. target: turned to face +z, scaled so its floor-to-neck height (narrowest neck section; hair and head size don't
     count, the heads are the identities') equals ours, floor on our floor, torso rigidly registered (ICP on the torso);
  2. pose: our skeleton posed into the target's stance (relaxed A-pose): per bone a two-axis rotation round its joint,
     coarse-to-fine, minimising the distance of the bone's subtree to the target's surface (normal-compatible);
  3. shape: non-rigid ICP in the posed space, solved for the REST displacement (every target point brought back by the
     inverse of the vertex's skin matrix): (W + lam * L) D = W B, a membrane on the welded mesh, stiff to loose;
     head, neck, hands and feet are held at 0 (MPFB's detail; the head is the identities'); where the target's nearest
     surface is its underwear (dark fabric in its albedo) nothing is fitted in front (the bulges / cups are not copied:
     the membrane carries the surrounding skin's offset through, MPFB's own groin / chest ride on it), the tight fabric
     at the sides and back is fitted a fabric's thickness in;
  4. report: RMS per region, joint centring, before/after.

Blender --background --python ai_body_fit.py -- <m|f>
"""
import os, sys, json, time, math
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SEX = argv[0] if argv else "m"
sys.path.insert(0, os.path.join(HERE, "ai3d", "lib", "py"))
from common import fit_root, make_log, reader, smooth, vnormals, umeyama_rigid  # shared with the other ai3d scripts
D_DIR = os.path.join(fit_root(), SEX)  # AI3D_FIT_ROOT (ai3d.mjs --out) or <pilot>/ai/fit
FABRIC = 0.003  # m: tight underwear's thickness over the skin
UW_LUMA = float(os.environ.get("AIB_UW_LUMA", "0.35"))  # target albedo (stored values): fabric = darker than this ...
UW_RB = float(os.environ.get("AIB_UW_RB", "0.06"))  # ... and red - blue under this


log = make_log("AIB")
rd = reader(D_DIR)


# ── our body ──
meta = json.load(open(os.path.join(D_DIR, "meta.json")))
NAMES = meta["joints"]
PAR = meta["parents"]
JI = {n: i for i, n in enumerate(NAMES)}
NB = len(NAMES)
P0 = rd("body_pos.bin", np.float32, 3).astype(np.float64)
N0 = rd("body_nrm.bin", np.float32, 3).astype(np.float64)
TRI = rd("body_idx.bin", np.uint32, 3).astype(np.int64)
JN = rd("body_joints.bin", np.uint16, 4).astype(np.int64)
WT = rd("body_weights.bin", np.float32, 4).astype(np.float64)
n = len(P0)
W = np.zeros((n, NB))
np.add.at(W, (np.repeat(np.arange(n), 4), JN.ravel()), WT.ravel())
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
JW = rd("joints_world.bin", np.float32, 16).reshape(NB, 4, 4).transpose(0, 2, 1).astype(np.float64)
IBM = rd("ibm.bin", np.float32, 16).reshape(NB, 4, 4).transpose(0, 2, 1).astype(np.float64)
S_rest = JW @ IBM
log("rest skin matrices: max |S - I|", float(np.abs(S_rest - np.eye(4)).max()))
JP = JW[:, :3, 3].copy()  # joint rest positions (model space)
# weld (glTF splits vertices at UV / normal seams): the membrane and the fit act on the welded surface
key = np.round(P0 / 1e-5).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
inv = inv.reshape(-1)
nu = len(first)
U = P0[first]
UW = W[first]
TRIu = inv[TRI]
E = np.concatenate([TRIu[:, [0, 1]], TRIu[:, [1, 2]], TRIu[:, [2, 0]]])
E = np.unique(np.sort(E, 1), axis=0)
E = E[E[:, 0] != E[:, 1]]
ea, eb = E[:, 0], E[:, 1]
deg = np.bincount(ea, minlength=nu) + np.bincount(eb, minlength=nu)
log("body verts", n, "welded", nu, "edges", len(E))


def lap_smooth(F, iters, lam=0.5):
    for _ in range(iters):
        acc = np.zeros_like(F)
        np.add.at(acc, ea, F[eb])
        np.add.at(acc, eb, F[ea])
        F = F + lam * (acc / np.maximum(deg, 1)[:, None] - F) if F.ndim == 2 else F + lam * (acc / np.maximum(deg, 1) - F)
    return F


def dilate(mask, rings):
    m = mask.copy()
    for _ in range(rings):
        nm = m.copy()
        nm[ea[m[eb]]] = True
        nm[eb[m[ea]]] = True
        m = nm
    return m


Hmin, Hmax = U[:, 1].min(), U[:, 1].max()
H = Hmax - Hmin

# ── target ──
tj = json.load(open(os.path.join(D_DIR, "target.json")))
TP = rd("target_pos.bin", np.float32, 3).astype(np.float64)
TT = rd("target_idx.bin", np.uint32, 3).astype(np.int64)
TUV = rd("target_uv.bin", np.float32, 2).astype(np.float64)
log("target verts", len(TP), "tris", len(TT))


def neck_height(X, top_frac=0.75):
    """Floor-to-neck: the height of the narrowest left-right section between the shoulders and the head's top."""
    y0, y1 = X[:, 1].min(), X[:, 1].max()
    h = y1 - y0
    best = None
    for f in np.arange(top_frac, 0.95, 0.0025):
        y = y0 + f * h
        s = X[np.abs(X[:, 1] - y) < 0.002 * h]
        s = s[np.abs(s[:, 0] - np.median(s[:, 0])) < 0.12 * h] if len(s) else s
        if len(s) < 10:
            continue
        w = np.percentile(s[:, 0], 98) - np.percentile(s[:, 0], 2)
        if best is None or w < best[0]:
            best = (w, y - y0)
    return best[1], best[0]


# 1a. face +z: the figure's width is along the target's z (ai_body_target.mjs bounds) -> turn about y
def roty(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


ext = TP.max(0) - TP.min(0)
yaw0 = math.pi / 2 if ext[2] > ext[0] else 0.0
if os.environ.get("AIB_YAW"):  # subject config orientation.yawDeg: only this facing (and +180) is tried
    yaw0 = math.radians(float(os.environ["AIB_YAW"]))
k_neck = None
cands = []
for yaw in (yaw0, yaw0 + math.pi):
    Q = TP @ roty(yaw).T
    Q = Q - [0, Q[:, 1].min(), 0]
    nh_t, nw_t = neck_height(Q[::7])
    nh_o, nw_o = neck_height(U)
    k = float(os.environ["AIB_SCALE"]) if os.environ.get("AIB_SCALE") else nh_o / nh_t  # (subject scale.k: fixed)
    Q = Q * k + [0, Hmin, 0]
    cands.append((yaw, k, Q, nh_t, nh_o))
# The toes point forward (+z): the floor-level points' z relative to the ankles' (just above)
def toe_fwd(Q):
    y0 = Q[:, 1].min()
    low = Q[Q[:, 1] < y0 + 0.02]
    ank = Q[(Q[:, 1] > y0 + 0.07) & (Q[:, 1] < y0 + 0.10)]
    return np.percentile(low[:, 2], 95) - np.percentile(ank[:, 2], 95)
scores = [toe_fwd(c[2]) for c in cands]
yaw, k_neck, TQ, nh_t, nh_o = cands[int(np.argmax(scores))]
log("facing: toe-forward scores", np.round(scores, 3).tolist(), "-> yaw", round(math.degrees(yaw)), "scale", round(k_neck, 4),
    "neck height ours", round(nh_o, 3), "target stature (with hair) scaled", round(TQ[:, 1].max() - TQ[:, 1].min(), 3), "ours", round(H, 3))


# 1b. x / z centre on the torso band, then rigid ICP of our torso onto it
def band(X):
    return X[(X[:, 1] > Hmin + 0.45 * H) & (X[:, 1] < Hmin + 0.68 * H) & (np.abs(X[:, 0] - np.median(X[:, 0])) < 0.11)]
bo, bt = band(U), band(TQ[::5])
TQ[:, [0, 2]] += (bo.mean(0) - bt.mean(0))[[0, 2]]

me = bpy.data.meshes.new("target")
me.vertices.add(len(TQ))
me.loops.add(len(TT) * 3)
me.polygons.add(len(TT))
me.vertices.foreach_set("co", TQ.astype(np.float32).ravel())
me.loops.foreach_set("vertex_index", TT.astype(np.int32).ravel())
me.polygons.foreach_set("loop_start", (np.arange(len(TT)) * 3).astype(np.int32))
me.polygons.foreach_set("loop_total", np.full(len(TT), 3, np.int32))
me.update()
tobj = bpy.data.objects.new("target", me)
bpy.context.collection.objects.link(tobj)


def target_bvh():
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(tobj, dg)


bvh = target_bvh()
FN = np.empty(len(TT) * 3)
me.polygons.foreach_get("normal", FN)
FN = FN.reshape(-1, 3)
cen = TQ.mean(0)
out_frac = float(np.mean(np.einsum("ij,ij->i", FN[::50], TQ[TT[::50, 0]] - cen) > 0))
log("target outward-facing triangles", round(out_frac, 3))
if out_frac < 0.5:
    FN = -FN


torso = np.where((UW[:, [JI[b] for b in ("pelvis", "spine_01", "spine_02", "spine_03")]].sum(1) > 0.8)
                 & (U[:, 1] > Hmin + 0.47 * H) & (U[:, 1] < Hmin + 0.72 * H))[0]
Rt_acc, tt_acc = np.eye(3), np.zeros(3)
for it in range(8):
    src, dst = [], []
    for i in torso[::2]:
        h = bvh.find_nearest(Vector(U[i]), 0.06)
        if h[0] is not None and np.dot(FN[h[2]], N0[first[i]]) > 0.3:
            src.append(U[i]); dst.append(np.array(h[0]))
    src, dst = np.array(src), np.array(dst)
    R, t = umeyama_rigid(dst, src)  # move the target onto ours
    TQ = TQ @ R.T + t
    me.vertices.foreach_set("co", TQ.astype(np.float32).ravel())
    me.update()
    bvh = target_bvh()
    me.polygons.foreach_get("normal", FN.ravel())
    if out_frac < 0.5:
        FN = -FN
    Rt_acc, tt_acc = R @ Rt_acc, R @ tt_acc + t
    log(f"torso ICP {it}: {len(src)} pairs, rms {np.sqrt(np.mean(np.sum((src - dst) ** 2, 1))) * 1000:.1f} mm, rot {math.degrees(math.acos(min(1, (np.trace(R) - 1) / 2))):.2f} deg")

# target texture: underwear = dark, desaturated fabric (sRGB values as stored)
img = bpy.data.images.load(os.path.join(D_DIR, tj["albedo"]))
img.colorspace_settings.name = "Non-Color"
TW_, TH_ = img.size
TEX = np.empty(TW_ * TH_ * 4, np.float32)
img.pixels.foreach_get(TEX)
TEX = TEX.reshape(TH_, TW_, 4)[..., :3]  # rows bottom-up (v up, Blender)


def tex_at(fi, loc):
    a, b, c = TQ[TT[fi]]
    p = np.array(loc)
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    bv = (d11 * d20 - d01 * d21) / den if den else 0
    bw = (d00 * d21 - d01 * d20) / den if den else 0
    uv = (1 - bv - bw) * TUV[TT[fi, 0]] + bv * TUV[TT[fi, 1]] + bw * TUV[TT[fi, 2]]
    x = int(np.clip(uv[0] % 1 * TW_, 0, TW_ - 1))
    y = int(np.clip((1 - uv[1] % 1) * TH_, 0, TH_ - 1))  # glTF v down -> Blender rows bottom-up
    return TEX[y, x]


# ── 2. pose ──
FWD = np.array([0.0, 0.0, 1.0])
ROT = {}  # bone -> 3x3 (rest-space rotation about its rest joint)


def rotm(axis, ang):
    axis = axis / np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


def bone_mats():
    A = np.zeros((NB, 4, 4))
    for b in range(NB):
        T = np.eye(4)
        if NAMES[b] in ROT:
            R = ROT[NAMES[b]]
            T[:3, :3] = R
            T[:3, 3] = JP[b] - R @ JP[b]
        A[b] = (A[PAR[b]] @ T) if PAR[b] >= 0 else T
    return A


def skin_mats(A, Wm):
    return (Wm @ A.reshape(NB, 16)).reshape(-1, 4, 4)


def apply(M, X):
    return np.einsum("nij,nj->ni", M[:, :3, :3], X) + M[:, :3, 3]


def subtree(b):
    out = {b}
    for i in range(NB):
        p = PAR[i]
        while p >= 0:
            if p in out:
                out.add(i)
                break
            p = PAR[p]
    return sorted(out)


POSE = [  # bone, range a1 (fwd/back swing), range a2 (side swing), coarse step (deg)
    ("spine_01", 12, 6, 2), ("spine_02", 12, 6, 2), ("spine_03", 14, 6, 2), ("neck_01", 30, 12, 2),
    # (arms first, then the clavicles: searched with the arm still in the T-pose, a clavicle drooped to the search's
    # limit to pull the arm down -- shoulders sunk, arms RMS 12 mm)
    ("upperarm_l", 40, 100, 4), ("upperarm_r", 40, 100, 4),
    ("lowerarm_l", 45, 45, 3), ("lowerarm_r", 45, 45, 3),
    ("clavicle_l", 14, 14, 2), ("clavicle_r", 14, 14, 2),
    ("thigh_l", 25, 25, 2), ("thigh_r", 25, 25, 2),
    ("calf_l", 20, 20, 2), ("calf_r", 20, 20, 2),
]
NEXT = {"spine_01": "spine_02", "spine_02": "spine_03", "spine_03": "neck_01", "neck_01": "Head"}
for s in "lr":
    NEXT.update({f"clavicle_{s}": f"upperarm_{s}", f"upperarm_{s}": f"lowerarm_{s}", f"lowerarm_{s}": f"hand_{s}",
                 f"thigh_{s}": f"calf_{s}", f"calf_{s}": f"foot_{s}"})
EXCL = ("Head", "neck_01")  # the head / neck never decide a pose (their shapes differ: the identities)


def pose_bone(bn, r1, r2, st, bvh, weight_lim=0.7):
    b = JI[bn]
    sub = [i for i in subtree(b) if not NAMES[i].startswith(EXCL)]
    if bn.startswith("spine"):
        sub = [JI[x] for x in ("spine_01", "spine_02", "spine_03") if JI[x] >= b]  # the torso only, not the arms / neck
    if bn == "neck_01":
        sub = [b]  # the neck's own skin (the head is the identities')
    A = bone_mats()
    M = skin_mats(A, UW)
    X = apply(M, U)
    Nn = np.einsum("nij,nj->ni", M[:, :3, :3], N0[first])
    seg = np.where(UW[:, sub].sum(1) > weight_lim)[0]
    seg = seg[:: max(1, len(seg) // 400)]
    # the joint where it stands now (posed), the bone's posed direction
    j = A[b][:3, :3] @ JP[b] + A[b][:3, 3] if PAR[b] < 0 else A[PAR[b]][:3, :3] @ JP[b] + A[PAR[b]][:3, 3]
    c = JI[NEXT[bn]]
    tip = A[b][:3, :3] @ JP[c] + A[b][:3, 3]
    d = (tip - j) / np.linalg.norm(tip - j)
    a1 = np.cross(d, FWD)
    if np.linalg.norm(a1) < 1e-3:
        a1 = np.cross(d, [1.0, 0, 0])
    a1 /= np.linalg.norm(a1)
    a2 = np.cross(d, a1)
    Xs = X[seg] - j
    Ns = Nn[seg]
    cap = 0.05

    def cost(al, be):
        R = rotm(a2, be) @ rotm(a1, al)
        Q = Xs @ R.T + j
        Nq = Ns @ R.T
        tot = 0.0
        for q, nq in zip(Q, Nq):
            h = bvh.find_nearest(Vector(q), cap)
            if h[0] is None or float(np.dot(FN[h[2]], nq)) < 0.0:
                tot += cap * cap
            else:
                tot += h[3] ** 2
        return tot / len(Q)
    c0 = cost(0, 0)
    best = (c0, 0.0, 0.0)
    for step, n1, n2 in ((math.radians(st), int(r1 / st), int(r2 / st)), (math.radians(1), 3, 3), (math.radians(0.25), 3, 3)):
        _, ca, cb = best
        for i in range(-n1, n1 + 1):
            for k in range(-n2, n2 + 1):
                cc = cost(ca + i * step, cb + k * step)
                if cc < best[0]:
                    best = (cc, ca + i * step, cb + k * step)
    _, ba, bb = best
    Rw = rotm(a2, bb) @ rotm(a1, ba)  # in the posed frame, about the posed joint
    # as a rest-space rotation of this bone: R_rest = Ap^-1 Rw Ap (rotation parts; the parent's is rigid)
    Ap = A[PAR[b]][:3, :3] if PAR[b] >= 0 else np.eye(3)
    Rr = Ap.T @ Rw @ Ap
    ROT[bn] = Rr @ ROT.get(bn, np.eye(3))
    log(f"pose {bn:12s} swing {math.degrees(ba):+6.1f} side {math.degrees(bb):+6.1f} deg   rms {math.sqrt(c0) * 1000:5.1f} -> {math.sqrt(best[0]) * 1000:5.1f} mm")


def region_rms(X, sel):
    r = []
    for i in sel:
        h = bvh.find_nearest(Vector(X[i]), 0.2)
        r.append(h[3] if h[0] is not None else 0.2)
    r = np.array(r)
    return float(np.sqrt(np.mean(r ** 2))) if len(r) else float("nan")


for rnd in range(2):
    for bn, r1, r2, st in POSE:
        if rnd == 1:
            r1, r2, st = min(r1, 8), min(r2, 8), 1
        pose_bone(bn, r1, r2, st, bvh)
A = bone_mats()
M = skin_mats(A, UW)
Minv = np.linalg.inv(M)
X_pose = apply(M, U)

# ── 3. masks ──
def wsum(prefixes):
    return UW[:, [i for i, nm in enumerate(NAMES) if nm.startswith(prefixes)]].sum(1)
keep = wsum(("Head", "hand_", "thumb_", "index_", "middle_", "ring_", "pinky_", "foot_", "ball_"))
keep = np.clip(lap_smooth(np.clip(keep, 0, 1), 6), 0, 1)
hold = smooth(0.35, 0.7, keep)  # held at MPFB's shape (prior to D = 0)
# The neck: never fitted (the targets' heads stand forward, their necks thin and long) and not held either: the membrane
# carries the shoulders' / chest's offset smoothly up to the held head, so no step at the neck's root (a steep trapezius
# off a thin neck, a pit above the sternum); thickened below (NECK_K).
neck_w = np.clip(lap_smooth(np.clip(wsum(("neck_01",)), 0, 1), 4), 0, 1)
wfit = (1 - smooth(0.15, 0.5, keep)) * (1 - smooth(0.1, 0.45, neck_w))
REG = {"torso": wsum(("pelvis", "spine_", "clavicle_")), "arms": wsum(("upperarm_", "lowerarm_")), "legs": wsum(("thigh_", "calf_"))}
region = {k: np.where((v > 0.6) & (wfit > 0.99))[0] for k, v in REG.items()}
before = {k: region_rms(X_pose, v[::2]) for k, v in region.items()}
log("RMS before (posed MPFB, mm):", {k: round(v * 1000, 1) for k, v in before.items()})

# underwear exclusion geometry (rest space)
nrm_r = N0[first]
crotch_y = JP[JI["thigh_l"]][1] - 0.06
front = nrm_r[:, 2]


def solve(Wd, B, lam, x0, iters=1200, tol=1e-9):
    def Aop(x):
        nb = np.stack([np.bincount(ea, x[eb, c], nu) + np.bincount(eb, x[ea, c], nu) for c in range(3)], 1)
        return Wd[:, None] * x + lam * (deg[:, None] * x - nb)
    b = Wd[:, None] * B
    x = x0.copy()
    r = b - Aop(x)
    p = r.copy()
    rs = (r * r).sum(0)
    for _ in range(iters):
        Ap = Aop(p)
        a = rs / np.maximum((p * Ap).sum(0), 1e-30)
        x += p * a
        r -= Ap * a
        rn = (r * r).sum(0)
        if rn.max() < tol * tol * len(b):
            break
        p = r + p * (rn / np.maximum(rs, 1e-30))
        rs = rn
    return x


D = np.zeros((nu, 3))
uw_zone = np.zeros(nu, bool)
SCHED = [(40.0, 0.07, 0.3), (12.0, 0.06, 0.35), (4.0, 0.05, 0.4), (4.0, 0.04, 0.45), (1.5, 0.03, 0.5), (1.5, 0.025, 0.5), (0.6, 0.02, 0.55), (0.25, 0.012, 0.6), (0.12, 0.008, 0.6), (0.06, 0.006, 0.6)]
lumas = []
for si, (lam, maxd, ndot) in enumerate(SCHED):
    X = apply(M, U + D)
    Nn = vnormals(X, TRIu)
    Q = np.zeros((nu, 3))
    Wd = np.zeros(nu)
    dark = np.zeros(nu, bool)
    for i in range(nu):
        if wfit[i] <= 0:
            continue
        h = bvh.find_nearest(Vector(X[i]), maxd)
        if h[0] is None or float(np.dot(FN[h[2]], Nn[i])) < ndot:
            continue
        c = tex_at(h[2], h[0])
        L = float(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
        if si == 0:
            lumas.append(L)
        if L < UW_LUMA and (c[0] - c[2]) < UW_RB:  # skin is warm (R > B, also in shadow); the fabric grey / blue-black
            dark[i] = True
        Q[i] = np.array(h[0])
        Wd[i] = wfit[i]
    if si == 0:
        log('hit luminance percentiles 1/5/10/20/30/50:', np.round(np.percentile(lumas, [1, 5, 10, 20, 30, 50]), 3).tolist())
    uw_zone |= dilate(dark, 2)
    # underwear: nothing in front (bulges, cups); a fabric's thickness in at the sides / back
    # (and the inner thighs under the fabric: briefs' legs bridge them, which dragged the crotch ~10 cm down)
    medial = -np.sign(U[:, 0]) * nrm_r[:, 0]
    hard = uw_zone & ((front > 0.25) | ((np.abs(U[:, 0]) < 0.1) & (nrm_r[:, 1] < -0.4) & (nrm_r[:, 2] > -0.2) & (U[:, 1] < crotch_y + 0.08))
                      | ((medial > 0.25) & (U[:, 1] < crotch_y + 0.1)))
    soft = uw_zone & ~hard
    Wd[hard] = 0
    Wd[soft] *= 0.5
    sel = Wd > 0
    # nudge the soft (fabric) targets inward by the fabric's thickness along our normal
    Q[soft & sel] -= Nn[soft & sel] * FABRIC
    B = np.zeros((nu, 3))
    B[sel] = apply(Minv[sel], Q[sel]) - U[sel]
    wp = 3.0 * hold
    W2 = Wd + wp
    B = (B * Wd[:, None]) / np.maximum(W2, 1e-9)[:, None]
    D = solve(W2, B, lam, D)
    Xn = apply(M, U + D)
    dist = np.linalg.norm(Xn[sel] - Q[sel], axis=1)
    log(f"ICP lam {lam:5.2f} maxd {maxd * 1000:3.0f}mm: matched {int(sel.sum())} underwear zone {int(uw_zone.sum())} (hard {int(hard.sum())})  rms {np.sqrt(np.mean(dist ** 2)) * 1000:.2f}mm p95 {np.percentile(dist, 95) * 1000:.2f}mm")

# Posture-neutral: per height, the torso section's mean forward / back shift (the target's lean, sway-back or
# rounded upper back, not its shape) is taken out; its thickness and contour stay. Fades out into the hips / neck.
tw = wsum(("pelvis", "spine_", "clavicle_")) * (1 - hold)
yb = np.round((U[:, 1] - Hmin) / 0.02).astype(int)
nbins = yb.max() + 1
sw = np.bincount(yb, tw, nbins)
mz = np.bincount(yb, tw * D[:, 2], nbins) / np.maximum(sw, 1e-6)
mz = np.where(sw > 1, mz, 0)
k = np.exp(-0.5 * (np.arange(-3, 4) / 1.5) ** 2); k /= k.sum()
mz = np.convolve(mz, k, "same")
pelvis_y, neck_y = JP[JI["pelvis"]][1], JP[JI["neck_01"]][1]
lean = mz[yb] * smooth(pelvis_y - 0.05, pelvis_y + 0.06, U[:, 1])
D[:, 2] -= lean * np.clip(tw + wsum(("upperarm_",)) * 0, 0, 1) ** 0 * smooth(0.05, 0.4, tw)
# An athletic, upright figure (the targets carry a forward belly and, hers, a rounded upper back that read as a
# pot belly / a stoop on our upright stance): the abdomen's forward push and the upper back's backward push eased,
# the jugular notch / base of the neck kept near MPFB's (a thicker neck base read as the neck tipping forward).
s3_y = JP[JI["spine_03"]][1]
torso_w = smooth(0.3, 0.7, wsum(("pelvis", "spine_")))
abd = torso_w * smooth(pelvis_y - 0.02, pelvis_y + 0.06, U[:, 1]) * (1 - smooth(s3_y - 0.12, s3_y - 0.04, U[:, 1])) * smooth(0.1, 0.5, nrm_r[:, 2])
ubk = torso_w * smooth(JP[JI["spine_02"]][1] - 0.04, JP[JI["spine_02"]][1] + 0.04, U[:, 1]) * (1 - smooth(neck_y - 0.12, neck_y - 0.04, U[:, 1])) * smooth(0.1, 0.5, -nrm_r[:, 2])
notch = smooth(neck_y - 0.15, neck_y - 0.06, U[:, 1]) * (1 - smooth(0.09, 0.14, np.abs(U[:, 0])))
ABD_K, UBK_K = float(os.environ.get("AIB_ABD", "0.6")), float(os.environ.get("AIB_UBK", "0.5"))
dz = D[:, 2].copy()
dz = np.where(dz > 0, dz * (1 - ABD_K * abd), dz)
dz = np.where(dz < 0, dz * (1 - UBK_K * ubk), dz)
D[:, 2] = dz
reg = np.clip(abd + ubk + 0.5 * notch, 0, 1)
Ds = lap_smooth(D, 4)
D = D * (1 - reg[:, None]) + Ds * reg[:, None]
# Neck girth up towards ANSUR's median (the MPFB necks measured P13 / P6): radially off the neck's axis (neck joint ->
# head joint), most at mid-neck, nothing at the head (the identities' jaw) and fading into the shoulders' fill.
NECK_K = float(os.environ.get("AIB_NECK", {"m": 0.03, "f": 0.02}[SEX]))  # (the base neck is already fuller: build_base.py NECK_PUSH)
a0, a1 = JP[JI["neck_01"]], JP[JI["Head"]]
ax = (a1 - a0) / np.linalg.norm(a1 - a0)
rel = U - a0
t_ax = rel @ ax / np.linalg.norm(a1 - a0)
radial = rel - np.outer(rel @ ax, ax)
nk_prof = smooth(-0.6, 0.0, t_ax) * (1 - smooth(0.55, 1.0, t_ax)) * smooth(0.3, 0.7, neck_w)
nk_prof *= np.linalg.norm(radial, axis=1) < 0.09
D += radial * (NECK_K * nk_prof)[:, None]
log("neck thickening: verts", int((nk_prof > 0.5).sum()), "t range", np.round(np.percentile(t_ax[nk_prof > 0.5], [5, 95]), 2).tolist() if (nk_prof > 0.5).any() else None, "neck_w>0.5", int((neck_w > 0.5).sum()))
D = D * (1 - 0.5 * nk_prof[:, None]) + lap_smooth(D, 3) * (0.5 * nk_prof[:, None])
log("lean removed (mm, by height):", {round(float(Hmin + i * 0.02), 2): round(float(mz[i]) * 1000, 1) for i in range(0, nbins, 4) if sw[i] > 1})
X_fit = apply(M, U + D)
fit_sel = {k: np.setdiff1d(v, np.where(uw_zone)[0]) for k, v in region.items()}
after = {k: region_rms(X_fit, v[::2]) for k, v in fit_sel.items()}
after_all = {k: region_rms(X_fit, v[::2]) for k, v in region.items()}
log("RMS after (mm, outside underwear):", {k: round(v * 1000, 1) for k, v in after.items()}, " incl. underwear zones:", {k: round(v * 1000, 1) for k, v in after_all.items()})
# joint centring: the mean rest offset of each limb segment's vertices (bones are not moved)
cent = {}
for bn in ("upperarm_l", "lowerarm_l", "thigh_l", "calf_l", "upperarm_r", "thigh_r"):
    s_ = UW[:, JI[bn]] > 0.8
    cent[bn] = np.round(D[s_].mean(0) * 1000, 1).tolist()
log("limb centre shift (mm, rest x/y/z):", cent)
Dfull = D[inv].astype(np.float32)
Dfull.tofile(os.path.join(D_DIR, "ai_body_delta.bin"))
np.savez(os.path.join(D_DIR, "fit_state.npz"), TQ=TQ.astype(np.float32), rot=np.array([ROT.get(nm, np.eye(3)) for nm in NAMES]),
         uw=uw_zone[inv], wfit=wfit[inv], hold=hold[inv], yaw=yaw, k=k_neck, Rt=Rt_acc, tt=tt_acc)
mag = np.linalg.norm(Dfull, axis=1)
json.dump(dict(sex=SEX, scale=k_neck, yaw_deg=math.degrees(yaw), neck_height=nh_o, stature_ours=H,
               target_stature_scaled=float(TQ[:, 1].max() - TQ[:, 1].min()),
               rms_before_mm={k: v * 1000 for k, v in before.items()}, rms_after_mm={k: v * 1000 for k, v in after.items()},
               rms_after_incl_underwear_mm={k: v * 1000 for k, v in after_all.items()}, limb_centre_shift_mm=cent,
               pose_deg={k: float(math.degrees(math.acos(min(1, (np.trace(v) - 1) / 2)))) for k, v in ROT.items()},
               delta_mm=dict(median=float(np.median(mag) * 1000), p95=float(np.percentile(mag, 95) * 1000), max=float(mag.max() * 1000)),
               underwear_luma=UW_LUMA),
          open(os.path.join(D_DIR, "fit.json"), "w"), indent=1)
log("delta |D| median", round(float(np.median(mag)) * 1000, 1), "p95", round(float(np.percentile(mag, 95)) * 1000, 1), "max", round(float(mag.max()) * 1000, 1), "mm")

if os.environ.get("AIB_DEBUG"):
    Xd = apply(M, U)
    Nd = vnormals(Xd, TRIu)
    st = dict(wfit_pos=int((wfit > 0).sum()), none=0, badn=0, ok=0)
    for i in range(nu):
        if wfit[i] <= 0:
            continue
        h = bvh.find_nearest(Vector(Xd[i]), 0.06)
        if h[0] is None:
            st["none"] += 1
        elif float(np.dot(FN[h[2]], Nd[i])) < 0.3:
            st["badn"] += 1
        else:
            st["ok"] += 1
    log("DEBUG", st, "our normals outward frac", float(np.mean(np.einsum("ij,ij->i", Nd, Xd - Xd.mean(0)) > 0)))
    def wobj(path, V, F):
        with open(path, "w") as f:
            f.write("".join(f"v {a:.4f} {b:.4f} {c:.4f}\n" for a, b, c in V))
            f.write("".join(f"f {a+1} {b+1} {c+1}\n" for a, b, c in F))
    wobj(os.path.join(D_DIR, "dbg_posed.obj"), Xd, TRIu)
    wobj(os.path.join(D_DIR, "dbg_fit.obj"), X_fit, TRIu)
    sub = TT[::40]
    wobj(os.path.join(D_DIR, "dbg_target.obj"), TQ, sub)
