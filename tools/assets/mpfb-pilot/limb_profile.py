"""Limb girth profiles (tape-measure = convex-hull perimeter of a cut perpendicular to the bone) of meshes that share
the scan's stance (fit_scan.py debug OBJs + joints in fit_<sex>.npz): upper arm, forearm, thigh, calf at 10..90 % of
each segment, in cm at the body's stature. Shows taper: a tube arm has a flat profile.
Blender --background --python limb_profile.py -- <fit_sex.npz> <name=file.obj> [...]
"""
import sys, math
import numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
J = np.load(a[0])
SEGS = [("upperarm", "J_upperarm_l", "J_lowerarm_l", 0.08), ("forearm", "J_lowerarm_l", "J_hand_l", 0.07),
        ("thigh", "J_thigh_l", "J_calf_l", 0.12), ("calf", "J_calf_l", "J_foot_l", 0.09)]
TS = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]


def load(path):
    V, F = [], []
    for l in open(path):
        if l.startswith("v "):
            V.append([float(x) for x in l.split()[1:4]])
        elif l.startswith("f "):
            idx = [int(x.split("/")[0]) - 1 for x in l.split()[1:]]
            F += [[idx[0], idx[i], idx[i + 1]] for i in range(1, len(idx) - 1)]
    return np.array(V), np.array(F)


def hull_perim(P2):
    P = sorted(map(tuple, P2))
    if len(P) < 3:
        return 0.0
    def cross(o, a_, b):
        return (a_[0] - o[0]) * (b[1] - o[1]) - (a_[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    h = lo[:-1] + hi[:-1]
    return sum(math.dist(h[i], h[(i + 1) % len(h)]) for i in range(len(h)))


rows = []
for spec in a[1:]:
    name, path = spec.split("=")
    V, F = load(path)
    S = V[:, 2].max() - V[:, 2].min()
    k = 1.0  # all share the fitted MPFB stature already
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    out = []
    for seg, ja, jb, rad in SEGS:
        A, B = J[ja], J[jb]
        d = (B - A) / np.linalg.norm(B - A)
        u = np.cross(d, [0, 0, 1.0]); u = u / np.linalg.norm(u) if np.linalg.norm(u) > 1e-6 else np.cross(d, [1.0, 0, 0])
        w = np.cross(d, u)
        prof = []
        for t in TS:
            C = A + (B - A) * t
            s = (V - C) @ d
            e = E[(s[E[:, 0]] * s[E[:, 1]]) < 0]
            if not len(e):
                prof.append(0); continue
            f = s[e[:, 0]] / (s[e[:, 0]] - s[e[:, 1]])
            X = V[e[:, 0]] + (V[e[:, 1]] - V[e[:, 0]]) * f[:, None] - C
            X = X[np.linalg.norm(X, axis=1) < rad]
            prof.append(hull_perim(np.stack([X @ u, X @ w], 1)) * 100 if len(X) > 2 else 0)
        out.append((seg, prof))
    rows.append((name, out))
print("LIMB girth cm at", TS)
for seg, *_ in SEGS:
    for name, out in rows:
        p = dict(out)[seg]
        print(f"LIMB {seg:9s} {name:10s} " + " ".join(f"{x:5.1f}" for x in p))
