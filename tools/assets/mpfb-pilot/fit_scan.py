"""Fit the MPFB base body to a real averaged body scan (exec'd by build_base.py; needs bpy, numpy).

Source scans (reference only, git-ignored, NEVER shipped): refs/data/sketchfab/generic_{man,woman} -- "Generic Man" /
"Generic Woman" by Scanlab Photogrammetry Inc., CC BY 4.0. Only the resulting vertex positions of OUR mesh ship (our
topology, UVs, skeleton, weights, textures); no scan geometry or texture is copied.

Method (fit_to_scan):
 1. scan -> uniform scale to the MPFB body's stature, feet on the floor, centred, facing chosen by best overlap;
 2. pose the MPFB rig into the scan's stance (neck, upper / lower arms, thighs, calves): per bone a small rotation
    search around its joint minimising the segment's distance to the scan surface;
 3. per vertex, the scan surface along the (posed) normal (ray both ways, normal-compatible hits only, nearest-point
    fallback) -> displacement; brought back to the rest pose by inverting each vertex's blended skin matrix (LBS);
 4. the displacement FIELD (not the positions) is Laplacian-smoothed and masked: head, hands and feet keep MPFB's
    own detail (fading in over the neck, wrists and ankles), so the scan gives the large-scale shape (arm taper,
    waist, belly, hips, thighs) and MPFB the small-scale anatomy; misses are filled by diffusion;
 5. joints follow the local mean displacement (the bones stay centred in the limbs); underwear / anatomy / eyes /
    brows ride along with the displacement of the nearest body surface.
"""
import os
import numpy as np
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

SCAN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "refs", "data", "sketchfab")
SCAN = {"m": os.path.join(SCAN_DIR, "generic_man", "scene.gltf"), "f": os.path.join(SCAN_DIR, "generic_woman", "scene.gltf")}
KEEP_BONES = ("head", "hand_", "thumb_", "index_", "middle_", "ring_", "pinky_", "foot_", "ball_")
POSE_BONES = ["neck_01"] + [f"{b}_{s}" for s in "lr" for b in ("clavicle", "upperarm", "lowerarm", "thigh", "calf")]
# the segment whose fit decides a bone's rotation (default: the bone's own vertices)
SEG = {"neck_01": ["head"], "clavicle_l": ["clavicle_l", "upperarm_l"], "clavicle_r": ["clavicle_r", "upperarm_r"]}
DMAX = 0.07        # m, farthest surface we accept as "the same skin"
SMOOTH_ITERS = int(os.environ.get("ASHFALL_FIT_SMOOTH", "12"))


def _np_co(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def _world(obj):
    return np.array(obj.matrix_world)


def _xf(M, P):
    return P @ M[:3, :3].T + M[:3, 3]


def load_scan(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    verts, faces = [], []
    for o in meshes:
        P = _xf(_world(o), _np_co(o.data))
        base = sum(len(v) for v in verts)
        verts.append(P)
        faces += [[base + i for i in p.vertices] for p in o.data.polygons]
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    for img in list(bpy.data.images):  # never keep the scan textures around (nothing of the scan is exported)
        if img.users == 0 or "ID15" in img.name:
            bpy.data.images.remove(img)
    P = np.concatenate(verts)
    # merge the per-material split (shared seam verts) so the scan is one closed surface
    key = np.round(P / 1e-5).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    P = P[first]
    faces = [[int(inv[i]) for i in f] for f in faces]
    return P, faces


def _adjacency(me):
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def _smooth(F, edges, iters, lam=0.5, fixed=None):
    n = len(F)
    deg = np.bincount(edges.ravel(), minlength=n).astype(float)
    deg[deg == 0] = 1
    for _ in range(iters):
        acc = np.zeros_like(F)
        np.add.at(acc, edges[:, 0], F[edges[:, 1]])
        np.add.at(acc, edges[:, 1], F[edges[:, 0]])
        avg = acc / deg[:, None] if F.ndim == 2 else acc / deg
        G = F + lam * (avg - F)
        if fixed is not None:
            G[fixed] = F[fixed]
        F = G
    return F


def _fill(F, valid, edges, iters=60):
    """Diffuse known values into the invalid vertices (harmonic fill)."""
    F = F.copy()
    F[~valid] = 0
    n = len(F)
    known = valid.astype(float)
    for _ in range(iters):
        acc = np.zeros_like(F)
        cnt = np.zeros(n)
        np.add.at(acc, edges[:, 0], F[edges[:, 1]] * known[edges[:, 1], None])
        np.add.at(acc, edges[:, 1], F[edges[:, 0]] * known[edges[:, 0], None])
        np.add.at(cnt, edges[:, 0], known[edges[:, 1]])
        np.add.at(cnt, edges[:, 1], known[edges[:, 0]])
        m = (~valid) & (cnt > 0)
        F[m] = acc[m] / cnt[m, None]
        known = np.where(m, 1.0, known)
    return F


def _weights(body, rig):
    names = [b.name for b in rig.data.bones if b.use_deform]
    col = {n: i for i, n in enumerate(names)}
    gidx = {g.index: col.get(g.name) for g in body.vertex_groups}
    W = np.zeros((len(body.data.vertices), len(names)))
    for v in body.data.vertices:
        for g in v.groups:
            c = gidx.get(g.group)
            if c is not None:
                W[v.index, c] += g.weight
    s = W.sum(1)
    s[s == 0] = 1
    return names, W / s[:, None]


def _skin_mats(rig, names):
    R = np.array(rig.matrix_world)
    Ri = np.linalg.inv(R)
    out = []
    for n in names:
        pb = rig.pose.bones[n]
        out.append(R @ np.array(pb.matrix) @ np.linalg.inv(np.array(rig.data.bones[n].matrix_local)) @ Ri)
    return np.stack(out)


def _blend(W, S):
    return (W @ S.reshape(len(S), 16)).reshape(-1, 4, 4)


def _apply(M, P):
    return np.einsum("nij,nj->ni", M[:, :3, :3], P) + M[:, :3, 3]


def _rot(axis, ang):
    return np.array(Matrix.Rotation(ang, 3, Vector(axis)))


def fit_to_scan(sex, body, rig, others, debug_dir=None, info=None, settings=None):
    path = SCAN[sex]
    if not os.path.exists(path):
        print("FIT skipped: no scan", path, flush=True)
        return None
    me = body.data
    me.update()
    Mb = _world(body)
    rest = _xf(Mb, _np_co(me))  # world, rest pose (A-pose)
    nrm_local = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("normal", nrm_local)
    pre_normals = [Vector(n) for n in nrm_local.reshape(-1, 3)]
    rest_n = nrm_local.reshape(-1, 3) @ np.linalg.inv(Mb[:3, :3])  # normals: inverse-transpose
    rest_n /= np.linalg.norm(rest_n, axis=1, keepdims=True)
    edges = _adjacency(me)
    names, W = _weights(body, rig)
    col = {n: i for i, n in enumerate(names)}

    # 1. scan: stature, floor, centre, facing
    SP, SF = load_scan(path)
    z0, z1 = rest[:, 2].min(), rest[:, 2].max()
    k = (z1 - z0) / (SP[:, 2].max() - SP[:, 2].min())
    SP = (SP - [0, 0, SP[:, 2].min()]) * k + [0, 0, z0]
    SP[:, 0] -= (SP[:, 0].max() + SP[:, 0].min()) / 2 - (rest[:, 0].max() + rest[:, 0].min()) / 2
    H = z1 - z0
    def band_y(P):
        b = P[(P[:, 2] > z0 + 0.45 * H) & (P[:, 2] < z0 + 0.7 * H) & (np.abs(P[:, 0]) < 0.12)]
        return b[:, 1].mean()
    sub = rest[::7]
    best = None
    for flip in (False, True):
        Q = SP.copy()
        if flip:
            Q[:, :2] *= -1
        Q[:, 1] += band_y(rest) - band_y(Q)
        bvh = BVHTree.FromPolygons([tuple(p) for p in Q], SF)
        cost = np.mean([min(bvh.find_nearest(Vector(p))[3] or 1, 0.1) for p in sub])
        print("FIT facing flip", flip, "cost", round(cost, 4), flush=True)
        if best is None or cost < best[0]:
            best = (cost, Q, bvh)
    _, SP, bvh = best
    print("FIT scan scale", round(k, 4), "stature", round(H, 3), "verts", len(SP), flush=True)

    # 2. pose the rig into the scan's stance
    def posed():
        bpy.context.view_layer.update()
        M = _blend(W, _skin_mats(rig, names))
        return M, _apply(M, rest)
    Rw = np.array(rig.matrix_world)
    for bn in POSE_BONES:
        pb = rig.pose.bones.get(bn)
        if pb is None:
            continue
        child = {"neck_01": "head"}.get(bn) or (pb.children[0].name if pb.children else None)
        M, P = posed()
        seg = np.where(sum(W[:, col[b]] for b in SEG.get(bn, [bn])) > 0.7)[0]
        if len(seg) < 20:
            continue
        seg = seg[:: max(1, len(seg) // 350)]
        head = _xf(Rw, np.array([pb.head]))[0]
        tip = _xf(Rw, np.array([rig.pose.bones[child].head]))[0] if child else _xf(Rw, np.array([pb.tail]))[0]
        d = (tip - head) / np.linalg.norm(tip - head)
        a1 = np.cross(d, [0, 1, 0]); a1 /= np.linalg.norm(a1)
        a2 = np.cross(d, a1)
        X = P[seg] - head
        def cost(al, be):
            R = _rot(a2, be) @ _rot(a1, al)
            Q = X @ R.T + head
            return np.mean([min(bvh.find_nearest(Vector(q))[3] or 1, 0.05) ** 2 for q in Q])
        c0 = cost(0, 0)
        bestc, ba, bb = c0, 0.0, 0.0
        for step, rng in ((np.radians(4), 8), (np.radians(1), 4), (np.radians(0.25), 4)):
            ca, cb = ba, bb
            for i in range(-rng, rng + 1):
                for j in range(-rng, rng + 1):
                    c = cost(ca + i * step, cb + j * step)
                    if c < bestc:
                        bestc, ba, bb = c, ca + i * step, cb + j * step
        R = _rot(a2, bb) @ _rot(a1, ba)
        Rl = np.linalg.inv(Rw) @ np.block([[R, (head - R @ head)[:, None]], [np.zeros((1, 3)), np.ones((1, 1))]]) @ Rw
        pb.matrix = Matrix(Rl.tolist()) @ pb.matrix
        print(f"FIT pose {bn}: {np.degrees(ba):+.1f} {np.degrees(bb):+.1f} deg  rms {np.sqrt(c0)*1000:.1f} -> {np.sqrt(bestc)*1000:.1f} mm", flush=True)
    M, P0 = posed()
    Minv = np.linalg.inv(M)
    polys = [list(p.vertices) for p in me.polygons]
    tri = np.array([[p[0], p[i], p[i + 1]] for p in polys for i in range(1, len(p) - 1)])

    def vnormals(X):
        fn = np.cross(X[tri[:, 1]] - X[tri[:, 0]], X[tri[:, 2]] - X[tri[:, 0]])
        N = np.zeros_like(X)
        for c in range(3):
            np.add.at(N, tri[:, c], fn)
        return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)

    # 4a. mask: head, hands, feet keep MPFB's detail
    keep = np.zeros(len(rest))
    for n, c in col.items():
        if n.startswith(KEEP_BONES):
            keep += W[:, c]
    if "neck_01" in col:
        keep += 0.35 * W[:, col["neck_01"]]
    # The averaged scans fuse the inner thighs well below the real crotch (and blur the genitals into a blob): the
    # crotch, inner upper thighs and the pubic front keep MPFB's shape (measure_body crotch height: scan 0.44 S, ANSUR 0.48).
    mid = rest[(np.abs(rest[:, 0]) < 0.006) & (rest[:, 2] > z0 + 0.35 * H) & (rest[:, 2] < z0 + 0.6 * H)]
    cz = mid[:, 2].min() if len(mid) else z0 + 0.47 * H
    medial = -np.sign(rest[:, 0]) * rest_n[:, 0]
    zone = (rest[:, 2] > cz - 0.16) & (rest[:, 2] < cz + 0.09) & (np.abs(rest[:, 0]) < 0.11)
    crotch = zone & ((medial > 0.2) | (rest_n[:, 2] < -0.35) | ((np.abs(rest[:, 0]) < 0.07) & (rest[:, 2] < cz + 0.09) & (rest_n[:, 1] < -0.3)))
    keep += crotch * 1.0
    print(f"FIT crotch keep zone: z {cz:.3f}, {int(crotch.sum())} verts", flush=True)
    mask = _smooth(1 - np.clip(keep, 0, 1), edges, 8)
    def sm(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0, 1)
        return t * t * (3 - 2 * t)
    zc = z0 + (0.725 if sex == "m" else 0.715) * H
    # from under the breasts / pecs up to the collarbones (the upper chest is where his went hollow)
    dz = rest[:, 2] - zc
    chest = np.where(dz < 0, sm(0.13, 0.08, -dz), sm(0.19, 0.14, dz)) * sm(0.2, 0.15, np.abs(rest[:, 0])) * sm(-0.05, -0.35, rest_n[:, 1])
    chest = np.clip(_smooth(chest, edges, 10), 0, 1)
    mask = np.clip((mask - 0.15) / 0.7, 0, 1)

    # 3/4. scan surface per vertex -> rest-space displacement field, smoothed; two passes (the second from the fitted
    # surface, smaller search radius: recovers what the smoothing shaved off the extremes)
    D = np.zeros_like(rest)
    for it, (dmax, iters, out_t) in enumerate(((DMAX, SMOOTH_ITERS, 0.012), (0.03, max(4, SMOOTH_ITERS // 2), 0.006))):
        P = _apply(M, rest + D)
        Np = vnormals(P)
        T = P.copy()
        valid = np.zeros(len(P), bool)
        for i in range(len(P)):
            if mask[i] <= 0:
                continue
            p, n = Vector(P[i]), Vector(Np[i])
            hits = []
            for sgn in (1, -1):
                h = bvh.ray_cast(p - n * sgn * 0.002, n * sgn, dmax)
                if h[0] is not None and h[1].dot(n) > 0.4:
                    hits.append(((h[0] - p).length, h[0]))
            if hits:
                T[i] = min(hits, key=lambda t: t[0])[1]
                valid[i] = True
                continue
            h = bvh.find_nearest(p, dmax * 0.6)
            if h[0] is not None and h[1].dot(n) > 0.6:
                T[i] = h[0]
                valid[i] = True
        dD = _apply(Minv, T) - (rest + D)
        dD[~valid] = 0
        r = np.linalg.norm(dD[valid & (mask > 0.9)], axis=1)
        print(f"FIT pass {it}: hits {valid[mask > 0].mean()*100:.1f}%  residual median {np.median(r)*1000:.1f} mm  p90 {np.percentile(r, 90)*1000:.1f} mm", flush=True)
        # outliers (photogrammetry noise, seams): a vertex far off its neighbourhood's field is a miss
        Ds = _smooth(_fill(dD, valid, edges), edges, 6)
        valid &= ~(np.linalg.norm(dD - Ds, axis=1) > out_t)
        # The chest / breasts don't follow the scan: the averaged scans blur the pecs flat and the breasts small
        # (fitted, his chest went hollow under the collarbones, hers flat); there the field is interpolated from the
        # surrounding torso (harmonic fill), so MPFB's own convex chest rides along with the fitted ribcage.
        dD = _fill(dD, valid & (chest < 0.5), edges, 150)
        dD = _smooth(dD, edges, iters) * (1 - chest[:, None]) + _smooth(dD, edges, iters * 4) * chest[:, None]
        D = D + dD * mask[:, None]
    P = _apply(M, rest + D)
    r = []
    for i in np.where(mask > 0.9)[0][::3]:
        h = bvh.find_nearest(Vector(P[i]))
        r.append(h[3] if h[0] is not None else 0)
    print(f"FIT final nearest-surface distance (fitted region): median {np.median(r)*1000:.1f} mm  p90 {np.percentile(r, 90)*1000:.1f} mm", flush=True)
    P = P0
    new = rest + D

    joints_posed = {n: _xf(Rw, np.array([rig.pose.bones[n].head]))[0] for n in
                    ("upperarm_l", "lowerarm_l", "hand_l", "thigh_l", "calf_l", "foot_l") if n in rig.pose.bones}
    # 5. back to rest, joints, attached meshes
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
        faces = [list(p.vertices) for p in me.polygons]
        _obj(os.path.join(debug_dir, f"scan_{sex}.obj"), SP, SF)
        _obj(os.path.join(debug_dir, f"mpfb_posed_{sex}.obj"), P, faces)
        _obj(os.path.join(debug_dir, f"fit_posed_{sex}.obj"), _apply(M, new), faces)
        np.savez(os.path.join(debug_dir, f"fit_{sex}.npz"), rest=rest, new=new, mask=mask, valid=valid,
                 **{"J_" + k: v for k, v in joints_posed.items()})
    # 6. the game's build on top of the scan's average figure (BUILD_DELTA; not on the head: the face is tuned)
    if info is not None and BUILD_DELTA.get(sex):
        bd = BUILD_DELTA[sex]
        Dm = macro_coords(info, settings, bd["pheno"], bd["targets"]) - macro_coords(info, settings, {})
        hk = W[:, col["head"]] + (0.5 * W[:, col["neck_01"]] if "neck_01" in col else 0)
        hk = np.clip(_smooth(np.clip(hk, 0, 1), edges, 6), 0, 1)
        if len(Dm) == len(D):
            D = D + Dm * (1 - hk)[:, None]
            new = rest + D
            print(f"FIT build delta {bd['pheno']}: |d| p95 {np.percentile(np.linalg.norm(Dm, axis=1), 95)*1000:.1f} mm", flush=True)
            midz = lambda X: X[(np.abs(X[:, 0]) < 1e-4) & (X[:, 2] > z0 + 0.3 * H) & (X[:, 2] < z0 + 0.55 * H), 2].min()
            print(f"FIT midline crotch z: rest {midz(rest):.3f}  final {midz(new):.3f}", flush=True)
    body_bvh = BVHTree.FromPolygons([tuple(p) for p in rest], polys)
    for o in others:
        if o is None or o.type != "MESH":
            continue
        Mo = _world(o)
        Po = _xf(Mo, _np_co(o.data))
        Do = np.zeros_like(Po)
        for i, p in enumerate(Po):
            loc, _, fi, dist = body_bvh.find_nearest(Vector(p))
            if fi is None:
                continue
            vs = polys[fi]
            w = 1.0 / (np.linalg.norm(rest[vs] - np.array(loc), axis=1) + 1e-4)
            Do[i] = (D[vs] * w[:, None]).sum(0) / w.sum()
        loc_new = _xf(np.linalg.inv(Mo), Po + Do)
        o.data.vertices.foreach_set("co", loc_new.ravel())
        if o.data.shape_keys:
            for kb in o.data.shape_keys.key_blocks:
                kb.data.foreach_set("co", loc_new.ravel())
        o.data.update()
    # joints: gaussian-weighted mean displacement around each joint
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT" if os.environ.get("ASHFALL_FIT_JOINTS", "1") == "1" else "OBJECT")
    Ri = np.linalg.inv(Rw)
    def shift(pt_local):
        pw = _xf(Rw, np.array([pt_local]))[0]
        g = np.exp(-np.sum((rest - pw) ** 2, axis=1) / (2 * 0.035 ** 2))
        if g.sum() < 1e-6:
            return Vector(pt_local)
        dw = (D * g[:, None]).sum(0) / g.sum()
        return Vector(_xf(Ri, np.array([pw + dw]))[0])
    eb = rig.data.edit_bones if os.environ.get("ASHFALL_FIT_JOINTS", "1") == "1" else []
    heads = {b.name: shift(tuple(b.head)) for b in eb}
    tails = {b.name: shift(tuple(b.tail)) for b in eb}
    # Only the arm chain follows (the shoulders' width changes with the fit / build): moving the hip / leg joints, even
    # by mm, swung the inner thighs across the midline in build_base's A -> T-pose leg swing (crotch -8 cm).
    ARM = ("clavicle_", "upperarm_", "lowerarm_", "hand_", "thumb_", "index_", "middle_", "ring_", "pinky_")
    for b in eb:
        if not b.name.startswith(ARM):
            continue
        if b.name in ("thigh_l", "calf_l", "upperarm_l", "lowerarm_l", "clavicle_l", "pelvis", "spine_03", "neck_01"):
            print("FIT joint", b.name, tuple(round(x * 1000) for x in (heads[b.name] - b.head)), "mm", flush=True)
        b.head, b.tail = heads[b.name], tails[b.name]
    bpy.ops.object.mode_set(mode="OBJECT")
    me.vertices.foreach_set("co", _xf(np.linalg.inv(Mb), new).ravel())
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            kb.data.foreach_set("co", _xf(np.linalg.inv(Mb), new).ravel())
    me.update()
    print(f"FIT done: |D| median {np.median(np.linalg.norm(D,axis=1))*1000:.1f} mm, max {np.linalg.norm(D,axis=1).max()*1000:.1f} mm", flush=True)
    return pre_normals


def _obj(path, V, F):
    with open(path, "w") as f:
        for v in V:
            f.write(f"v {v[0]:.5f} {v[1]:.5f} {v[2]:.5f}\n")
        for p in F:
            f.write("f " + " ".join(str(i + 1) for i in p) + "\n")


# The game's base build on top of the scan's average figure (the reference look: a fit survivor, not the scan's
# average office build): MPFB's own muscle / weight macros + muscle targets as a delta, so the scan keeps the
# proportions, taper and fat distribution and MPFB adds anatomy (pecs, delts, traps, lats, a flatter belly).
BUILD_DELTA = {
    "m": dict(pheno=dict(weight=0.38, muscle=1.0),
              targets=[("torso-muscle-pectoral-incr", 0.3), ("torso-vshape-incr", 0.35), ("measure-shoulder-dist-incr", 0.3),
                       ("torso-muscle-dorsi-incr", 0.25), ("stomach-pregnant-decr", 0.35), ("neck-scale-horiz-incr", 0.15)]
              + [(f"{s}-{t}", v) for s in "lr" for t, v in [("upperarm-shoulder-muscle-incr", 0.45), ("upperarm-muscle-incr", 0.3),
                 ("lowerarm-muscle-incr", 0.3), ("hand-scale-incr", 0.25)]]),
    # Athletic but female (refs/FEMALE.md section C): firmer, a toned stomach and a narrower waist, visible delts and
    # lats, arms tapering from the deltoid, thighs / calves muscled rather than padded; natural breasts (firmness 0.8, not
    # the base's 1.0, which read "glued on"; cup 0.75: at 0.6 they went flat), set closer and pointing a touch more.
    "f": dict(pheno=dict(weight=0.42, muscle=0.72, cupsize=0.75, firmness=0.8),
              targets=[("torso-muscle-dorsi-incr", 0.2), ("torso-muscle-pectoral-incr", 0.1), ("stomach-tone-incr", 0.4),
                       ("stomach-pregnant-decr", 0.25), ("measure-shoulder-dist-incr", 0.12),
                       ("buttocks-volume-incr", 0.15), ("breast-point-incr", 0.15), ("breast-dist-decr", 0.1)]
              + [(f"{s}-{t}", v) for s in "lr" for t, v in [("upperarm-shoulder-muscle-incr", 0.35), ("upperarm-muscle-incr", 0.2),
                 ("upperarm-fat-decr", 0.3), ("lowerarm-muscle-incr", 0.15), ("upperleg-muscle-incr", 0.25),
                 ("lowerleg-muscle-incr", 0.25), ("hand-scale-incr", 0.05)]]),
}


# Realistic variety ON TOP of the fitted body: MPFB's own weight / muscle macros as a per-vertex delta
# (macro variant - the base build's macros, same targets / face), added to the fitted surface.
VARIANTS = {
    "m": {"lean": dict(weight=0.2, muscle=0.6), "athletic": dict(weight=0.4, muscle=0.95), "heavy": dict(weight=0.85, muscle=0.6),
          "soft": dict(weight=0.65, muscle=0.25)},
    "f": {"lean": dict(weight=0.25, muscle=0.5), "athletic": dict(weight=0.4, muscle=0.85), "heavy": dict(weight=0.85, muscle=0.5),
          "soft": dict(weight=0.65, muscle=0.2)},
}


def macro_coords(info, settings, pheno, targets=()):
    """Rest vertex positions (world) of the same human with other macros / extra targets (values added to the build's)
    (helpers / delete masks applied, as the body)."""
    import copy
    i2 = copy.deepcopy(info)
    i2["phenotype"].update(pheno)
    tv = {t["target"]: t["value"] for t in i2["targets"]}
    for t, v in targets:
        tv[t] = tv.get(t, 0.0) + v
    i2["targets"] = [{"target": t, "value": v} for t, v in tv.items()]
    i2["name"] = "var_tmp"
    before = set(bpy.data.objects)
    hm = HumanService.deserialize_from_dict(i2, settings)
    bpy.context.view_layer.objects.active = hm
    TargetService.bake_targets(hm)
    for mod in list(hm.modifiers):
        if mod.type == "MASK":
            with bpy.context.temp_override(object=hm, active_object=hm):
                bpy.ops.object.modifier_apply(modifier=mod.name)
    hm.data.update()
    out = _xf(_world(hm), _np_co(hm.data))
    for o in [o for o in bpy.data.objects if o not in before]:
        bpy.data.objects.remove(o, do_unlink=True)
    return out


def export_variants(sex, body, info, settings, out_dir):
    """Fitted body + macro deltas -> <out_dir>/<sex>_<variant>.glb (body mesh only, rest A-pose; for measure_body.mjs /
    silhouettes; reference, not shipped)."""
    os.makedirs(out_dir, exist_ok=True)
    fitted = _xf(_world(body), _np_co(body.data))
    base = macro_coords(info, settings, {})
    faces = [list(p.vertices) for p in body.data.polygons]
    res = {"fit": fitted}
    for name, ph in VARIANTS[sex].items():
        v = macro_coords(info, settings, ph)
        if len(v) != len(fitted):
            print("VAR skipped", name, len(v), len(fitted), flush=True)
            continue
        res[name] = fitted + (v - base)
    res["mpfb"] = base
    for name, V in res.items():
        me = bpy.data.meshes.new(f"{sex}_{name}")
        me.from_pydata([tuple(p) for p in V], [], faces)
        import bmesh as _bm
        bm = _bm.new()
        bm.from_mesh(me)
        _bm.ops.holes_fill(bm, edges=bm.edges[:], sides=120)  # the male genital helper hole (measure_body's crotch)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new(f"{sex}_{name}", me)
        bpy.context.collection.objects.link(ob)
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, f"{sex}_{name}.glb"), export_format="GLB", use_selection=True,
                                  export_materials="NONE", export_yup=True)
        bpy.data.objects.remove(ob, do_unlink=True)
        _obj(os.path.join(out_dir, f"{sex}_{name}.obj"), V, faces)
    print("VAR exported", sex, list(res), flush=True)
