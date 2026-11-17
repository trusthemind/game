"""Fit MPFB face targets to the AI character sheets (refs/ai/sheet_<id>_nb.png; inputs in refs/ai/ai_fit.json).

Our head is landmarked on its vertices exactly as the sheet is on its pixels -- front view (orthographic x/z):
pupils (eye helpers' front), eye openings (the skin's lid boundary loops), nose wings, mouth corners, face width at
the sheet's cheekbone / jaw levels (ears out), brow (the brow proxy's lowest point, carried by its nearest skin
vertex); profile (y/z): the midline contour's glabella, nasion, nose tip, subnasale, lips, chin, menton (same rules as
the sheet's silhouette), the eye and the ear's centre. Both become ratios (front / IPD, profile / eye-to-menton
height), and the targets' values (signed pairs, one-sided head shapes) are solved by damped Gauss-Newton on the
relative errors, pulled towards the sex's base face.

Run with numpy (Blender's own python is fine), on fit_ai_dump.py's output:
  python3 fit_ai.py <dump_dir> [sheet,...]   -> refs/ai/ai_fit_result.json (+ overlay data <dump_dir>/<sheet>_ov.json)
"""
import json, os, sys, gzip
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = sys.argv[1]
ONLY = sys.argv[2].split(",") if len(sys.argv) > 2 else None
CFG = json.load(open(os.path.join(HERE, "refs", "ai", "ai_fit.json")))
TDIR = os.path.expanduser("~/Library/Application Support/Blender/5.3/extensions/user_default/mpfb/data/targets")
NB = 13380
MOUTH_L, MOUTH_R = 10398, 3730


def target_idx(name):
    for r, _, fs in os.walk(TDIR):
        if name + ".target.gz" in fs:
            out = []
            with gzip.open(os.path.join(r, name + ".target.gz"), "rt") as fh:
                for ln in fh:
                    p = ln.split()
                    if len(p) == 4 and not p[0].startswith("#") and max(abs(float(q)) for q in p[1:]) > 1e-4:
                        out.append(int(p[0]))
            return np.array(out, np.int32)
    raise KeyError(name)


EAR = np.unique(np.concatenate([target_idx(f"{s}-ear-scale-incr") for s in "lr"]))

# ── the sheet: ratios ────────────────────────────────────────────────────────


def sheet_profile(s):
    """Profile landmarks from the silhouette (as refs/ai prof landmarks): forward coordinate f = dir * x."""
    rows = json.load(open(os.path.join(DUMP, "prof.json")))[s]
    d = CFG["profile"][s]["dir"]
    f = np.array([d * r if r is not None else np.nan for r in rows], float)
    fs = np.convolve(np.nan_to_num(f, nan=-1e9), np.ones(5) / 5, "same")
    fs[fs < -1e8] = np.nan
    return contour_marks(lambda a, b: (a, b), fs, 1.0, 60.0)


def contour_marks(_, fs, unit, drop):
    """Landmarks on a forward-coordinate contour fs[i] (i = downwards, `unit` = one IPD-ish step scale)."""
    def am(a, b, fn):
        a, b = int(max(0, a)), int(min(len(fs), b))
        seg = fs[a:b]
        return a + int(fn(seg))
    U = unit
    prn = am(560 * U, 900 * U, np.nanargmax)
    nas = am(prn - 220 * U, prn - 60 * U, np.nanargmin)
    gla = am(nas - 130 * U, nas, np.nanargmax)
    sn = am(prn + 10 * U, prn + 80 * U, np.nanargmin)
    ls = am(sn + 5 * U, sn + 70 * U, np.nanargmax)
    st = am(ls + 3 * U, ls + 45 * U, np.nanargmin)
    li = am(st + 3 * U, st + 60 * U, np.nanargmax)
    sm = am(li + 5 * U, li + 70 * U, np.nanargmin)
    pg = am(sm + 5 * U, sm + 100 * U, np.nanargmax)
    me = pg
    for y in range(pg, min(len(fs), pg + int(200 * U))):
        if not np.isfinite(fs[y]) or fs[y] < fs[pg] - drop:
            me = y
            break
    return {k: (float(i), float(fs[i])) for k, i in dict(gla=gla, nas=nas, prn=prn, sn=sn, ls=ls, st=st, li=li, sm=sm, pg=pg, me=me).items()}


def ratios_from(F, P):
    """F: front measures (IPD units); P: profile marks {name: (down, fwd)} + eye / ear (down, fwd), any unit."""
    H = P["me"][0] - P["eye"][0]
    fw = lambda k: P[k][1]
    dn = lambda k: P[k][0]
    lip_bot = dn("li") + 0.4 * (dn("sm") - dn("li"))
    r = dict(F)
    r.update(
        p_nose_proj=(fw("prn") - fw("nas")) / H, p_sn_proj=(fw("sn") - fw("nas")) / H, p_lip_proj=(fw("ls") - fw("sn")) / H,
        p_chin_proj=(fw("pg") - fw("nas")) / H, p_gla=(fw("gla") - fw("nas")) / H, p_eye_depth=(fw("nas") - fw("eye")) / H,
        p_nose_len=(dn("sn") - dn("nas")) / H, p_lower=(dn("me") - dn("sn")) / H, p_nas_y=(dn("nas") - dn("eye")) / H,
        p_lips_h=(lip_bot - dn("ls")) / H, p_mouth_y=(dn("st") - dn("eye")) / H,
    )
    if P.get("ear") is not None:
        r["p_ear_depth"] = (fw("eye") - P["ear"][1]) / H
        r["p_ear_y"] = (P["ear"][0] - dn("eye")) / H
    return r


def sheet_ratios(s):
    F = CFG["front"][s]
    ipd = abs(F["pupil_r"][0] - F["pupil_l"][0])
    py = (F["pupil_l"][1] + F["pupil_r"][1]) / 2
    me = F["menton"][1]
    w = lambda a, b: abs(F[b][0] - F[a][0]) / ipd
    front = dict(
        face_w=w("zyg_l", "zyg_r"), jaw_w=w("gon_l", "gon_r"), eye_w=(w("outer_l", "inner_l") + w("inner_r", "outer_r")) / 2,
        icd=w("inner_l", "inner_r"), nose_w=w("alar_l", "alar_r"), mouth_w=w("mouth_l", "mouth_r"),
        nose_len=(F["subnasale"][1] - py) / ipd, mouth_y=(F["stomion"][1] - py) / ipd, chin=(me - F["stomion"][1]) / ipd,
        brow=(py - F["brow"]) / ipd, eye_aspect=F["eye_h"] / ((abs(F["outer_l"][0] - F["inner_l"][0]) + abs(F["outer_r"][0] - F["inner_r"][0])) / 2),
    )
    levels = dict(zyg=(F["zyg_l"][1] - py) / (me - py), gon=(F["gon_l"][1] - py) / (me - py))
    pm = sheet_profile(s)
    pc = CFG["profile"][s]
    d = pc["dir"]
    P = dict(pm)
    P["eye"] = (pc["eye"][1], d * pc["eye"][0])
    P["ear"] = (pc["ear"][1], d * pc["ear"][0]) if pc.get("ear") else None
    return ratios_from(front, P), levels, P


# ── ours ───────────────────────────────────────────────────────────────────


class Head:
    def __init__(self, z):
        self.V0 = z["V"].astype(np.float64)
        hw = z["hw"]
        self.H = np.nonzero(hw[:NB] > 0.5)[0]
        self.Hset = np.zeros(len(self.V0), bool)
        self.Hset[self.H] = True
        self.le, self.re = z["leye"], z["reye"]
        self.dn = [str(n) for n in z["dnames"]]
        self.D = z["D"].astype(np.float64)
        T = z["tris"]
        T = T[(T < NB).all(1)]
        T = T[self.Hset[T].all(1)]
        self.T = T
        e = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), 1)
        u = np.unique(e, axis=0)
        V = self.V0
        pl, pr = V[self.le].mean(0), V[self.re].mean(0)
        # the skin's triangles round each eye (the lids: the opening is where the eyeball is in front of them)
        cen = V[T].mean(1)
        self.lid_l = T[(np.abs(cen[:, 0] - pl[0]) < 0.018) & (np.abs(cen[:, 2] - pl[2]) < 0.012) & (cen[:, 1] < pl[1] + 0.012)]
        self.lid_r = T[(np.abs(cen[:, 0] - pr[0]) < 0.018) & (np.abs(cen[:, 2] - pr[2]) < 0.012) & (cen[:, 1] < pr[1] + 0.012)]
        # midline edges
        mid = np.abs(V[:, 0]) < 1e-4
        self.mid_e = u[mid[u].all(1)]
        self.ear = np.intersect1d(EAR, self.H)
        self.nonear = np.setdiff1d(self.H, self.ear)
        self.ear_l = self.ear[V[self.ear, 0] > 0]
        # brow: lowest brow-proxy point above each pupil -> nearest skin vertex
        B = z["brows"].astype(np.float64)
        bi = []
        for p in (pl, pr):
            c_ = B[(np.abs(B[:, 0] - p[0]) < 0.006) & (B[:, 2] > p[2] + 0.008)]
            q = c_[np.argmin(c_[:, 2])]
            bi.append(self.H[np.argmin(np.linalg.norm(V[self.H] - q, axis=1))])
        self.brow_v = np.array(bi)
        self.idx = np.unique(np.concatenate([self.H, self.le, self.re]))

    def mesh(self, w):
        """Vertices for target weights w (per dumped target name, absolute delta weights)."""
        return self.V0 + np.tensordot(w, self.D, 1)

    def marks(self, V, levels):
        pl = V[self.le][V[self.le][:, 1] < V[self.le][:, 1].min() + 0.0015].mean(0)
        pr = V[self.re][V[self.re][:, 1] < V[self.re][:, 1].min() + 0.0015].mean(0)
        ipd = abs(pl[0] - pr[0])
        pz = (pl[2] + pr[2]) / 2
        # profile contour along the midline edges (front part), as forward = -y per 0.5 mm of z (downwards index)
        E = self.mid_e
        a, b = V[E[:, 0]], V[E[:, 1]]
        t = np.linspace(0, 1, 12)[:, None, None]
        pts = (a[None] * (1 - t) + b[None] * t).reshape(-1, 3)
        pts = pts[pts[:, 1] < pl[1] + 0.03]
        step = 0.0005
        top = pz + 0.1
        n = int(0.3 / step)
        fs = np.full(n, np.nan)
        k = ((top - pts[:, 2]) / step).astype(int)
        ok = (k >= 0) & (k < n)
        fs_ = np.full(n, -np.inf)
        np.maximum.at(fs_, k[ok], -pts[ok, 1])
        fs[np.isfinite(fs_)] = fs_[np.isfinite(fs_)]
        # gaps: linear fill; then a 5-bin mean (as the sheet's)
        idx = np.arange(n)
        good = np.isfinite(fs)
        fs = np.interp(idx, idx[good], fs[good])
        fs = np.convolve(fs, np.ones(5) / 5, "same")
        # the sheet's windows are in pixels with IPD ~240 px and pupils at row ~580: rows here are 0.5 mm from pz+0.1
        U = (ipd / 240) / step
        off = (580 * U) - (0.1 / step)  # sheet row of the pupils, in our rows
        fs2 = np.concatenate([np.full(max(0, int(off)), np.nan), fs])
        def mk(fs_):
            return contour_marks(None, fs_, U, 60 * U)
        try:
            Pm = mk(fs2)
        except ValueError:
            return None
        P = {k_: ((v[0] - int(max(0, off))) * step, v[1]) for k_, v in Pm.items()}  # (down from top, fwd)
        down = lambda zv: top - zv
        P["eye"] = (down(pz), -(pl[1] + pr[1]) / 2)
        el = V[self.ear_l]
        P["ear"] = (down(el[:, 2].mean()), -el[:, 1].mean())
        zz = lambda k_: top - P[k_][0]
        # front
        sn_z, st_z, me_z = zz("sn"), zz("st"), zz("me")
        def corners(lid, eyev, p):
            E_ = V[eyev]
            c0 = E_.mean(0)
            R = np.linalg.norm(E_ - c0, axis=1).mean()
            st = 0.0005
            gx, gz = np.meshgrid(c0[0] + np.arange(-0.017, 0.017, st), c0[2] + np.arange(-0.011, 0.011, st))
            gx, gz = gx.ravel(), gz.ravel()
            r2 = R * R - (gx - c0[0]) ** 2 - (gz - c0[2]) ** 2
            ye = np.where(r2 > 0, c0[1] - np.sqrt(np.maximum(r2, 0)), np.inf)
            A, B, C = V[lid[:, 0]], V[lid[:, 1]], V[lid[:, 2]]
            d = (B[:, 2] - C[:, 2]) * (A[:, 0] - C[:, 0]) + (C[:, 0] - B[:, 0]) * (A[:, 2] - C[:, 2])
            ok = np.abs(d) > 1e-12
            A, B, C, d = A[ok], B[ok], C[ok], d[ok]
            l0 = ((B[:, 2] - C[:, 2])[None] * (gx[:, None] - C[:, 0][None]) + (C[:, 0] - B[:, 0])[None] * (gz[:, None] - C[:, 2][None])) / d[None]
            l1 = ((C[:, 2] - A[:, 2])[None] * (gx[:, None] - C[:, 0][None]) + (A[:, 0] - C[:, 0])[None] * (gz[:, None] - C[:, 2][None])) / d[None]
            l2 = 1 - l0 - l1
            ins = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            ys = np.where(ins, l0 * A[:, 1][None] + l1 * B[:, 1][None] + l2 * C[:, 1][None], np.inf).min(1)
            open_ = np.isfinite(ye) & (ye < ys - 0.0002)
            ox, oz = gx[open_], gz[open_]
            if len(ox) < 5:
                return p, p, 0.0
            cols, cnt = np.unique(np.round(ox / st).astype(int), return_counts=True)
            wide = np.isin(np.round(ox / st).astype(int), cols[cnt >= 3])
            ax = np.abs(ox[wide])
            i_in, i_out = np.argmin(ax), np.argmax(ax)
            inner = np.array([ox[wide][i_in], 0, oz[wide][i_in]])
            outer = np.array([ox[wide][i_out], 0, oz[wide][i_out]])
            cz = oz[np.abs(ox - p[0]) < st]
            return inner, outer, (cz.max() - cz.min() + st) if len(cz) else 0.0
        il, ol, hl = corners(self.lid_l, self.le, pl)
        ir, or_, hr = corners(self.lid_r, self.re, pr)
        eye_w = (abs(ol[0] - il[0]) + abs(or_[0] - ir[0])) / 2
        Hn = V[self.nonear]
        ear_y = V[self.ear, 1].min()
        def width(zv):
            s = Hn[(np.abs(Hn[:, 2] - zv) < 0.003) & (Hn[:, 1] < ear_y)]
            return 2 * np.abs(s[:, 0]).max() if len(s) else np.nan
        fz = lambda t_: pz - t_ * (pz - me_z)
        # nose wings: steepest fall-off of the front contour sideways, 6 mm over the subnasale
        HV = V[self.H]
        sec = HV[(np.abs(HV[:, 2] - (sn_z + 0.006)) < 0.0015) & (HV[:, 1] < pl[1])]
        xs = np.arange(0.006, 0.03, 0.0005)
        dd = np.abs(np.abs(sec[:, 0])[None] - xs[:, None]) < 0.001
        fr = np.where(dd, -sec[:, 1][None], -np.inf).max(1)
        fr[~np.isfinite(fr)] = np.nan
        g = fr[:-3] - fr[3:]
        j = int(np.nanargmax(np.where((xs[:-3] > 0.01) & (xs[:-3] < 0.025), g, -np.inf)))
        alar = 2 * (xs[j] + 0.00075)
        # mouth corners: the hm08 commissure vertices (found once by the lips' back-facing fold on the female base)
        mouth_w = abs(V[MOUTH_L, 0] - V[MOUTH_R, 0])
        brow = V[self.brow_v, 2].mean() - pz
        F = dict(face_w=width(fz(levels["zyg"])) / ipd, jaw_w=width(fz(levels["gon"])) / ipd, eye_w=eye_w / ipd,
                 icd=abs(il[0] - ir[0]) / ipd, nose_w=alar / ipd, mouth_w=mouth_w / ipd, nose_len=(pz - sn_z) / ipd,
                 mouth_y=(pz - st_z) / ipd, chin=(st_z - me_z) / ipd, brow=brow / ipd, eye_aspect=(hl + hr) / 2 / eye_w)
        return ratios_from(F, P), P, dict(pl=pl, pr=pr, top=top, ipd=ipd, pz=pz, il=il, ol=ol, ir=ir, or_=or_, alar=alar, mouth_w=mouth_w, zyg_z=fz(levels['zyg']), gon_z=fz(levels['gon']), face_w=F['face_w'] * ipd, jaw_w=F['jaw_w'] * ipd, brow_z=brow + pz, sn_z=sn_z, st_z=st_z, me_z=me_z)


def overlay(hd, V1, levels, Psheet, path):
    m1 = hd.marks(V1, levels)
    fr = V1[hd.nonear]
    ov = dict(front=fr[fr[:, 1] < m1[2]["pl"][1] + 0.06][:, [0, 2]].tolist(), side=V1[hd.H][:, [1, 2]].tolist(), P=m1[1],
              aux={k_: (v.tolist() if hasattr(v, "tolist") else v) for k_, v in m1[2].items()}, Psheet=Psheet)
    json.dump(ov, open(path, "w"))


W = dict(face_w=1.2, jaw_w=1.2, eye_w=0.8, icd=0.6, nose_w=1.0, mouth_w=1.0, nose_len=1.2, mouth_y=1.0, chin=1.2, brow=0.6, eye_aspect=0.5,
         p_nose_proj=1.0, p_sn_proj=0.5, p_lip_proj=0.4, p_chin_proj=0.8, p_gla=0.4, p_eye_depth=0.6, p_nose_len=1.0, p_lower=1.0,
         p_nas_y=0.4, p_lips_h=0.6, p_mouth_y=0.6, p_ear_depth=0.6, p_ear_y=0.3)
MAIN = ["face_w", "jaw_w", "eye_w", "nose_w", "mouth_w", "nose_len", "mouth_y", "chin", "p_nose_proj", "p_chin_proj", "p_nose_len", "p_lower"]


def fit(s):
    z = np.load(os.path.join(DUMP, f"{s}.npz"))
    hd = Head(z)
    base_face = json.loads(str(z["base_face"]))
    goal, levels, Psheet = sheet_ratios(s)
    if s == "m3":  # the moustache covers the lips; its 'profile' is a ~70 deg view
        for k in ("p_lip_proj", "p_lips_h", "p_ear_depth", "p_ear_y"):
            goal.pop(k, None)
    # variables
    vars_ = []
    for a, b in CFG["vars"]:
        vars_.append(("pair", a, b))
    for n in CFG["one_sided"]:
        vars_.append(("one", n, None))
    def names(n):
        return [f"l-{n[3:]}", f"r-{n[3:]}"] if n.startswith("lr-") else [n]
    def bval(n):
        return base_face.get(names(n)[0], 0.0)
    x0 = np.array([(bval(b) - bval(a)) if k == "pair" else bval(a) for k, a, b in vars_])
    lo = np.array([-1.0 if k == "pair" else 0.0 for k, _, _ in vars_])
    hi = np.ones(len(vars_))
    di = {n: i for i, n in enumerate(hd.dn)}
    def weights(x):
        w = np.zeros(len(hd.dn))
        for (k, a, b), v, v0 in zip(vars_, x, x0):
            if k == "pair":
                for nm, val, val0 in ((b, max(v, 0), max(v0, 0)), (a, max(-v, 0), max(-v0, 0))):
                    for q in names(nm):
                        w[di[q]] += val - val0
            else:
                for q in names(a):
                    w[di[q]] += v - v0
        return w
    Wl = dict(W, **CFG.get("weights", {}).get(s, {}))  # per-sheet emphasis (ai_fit.json "weights")
    keys = [k for k in Wl if k in goal]
    def resid(x):
        try:
            m = hd.marks(hd.mesh(weights(x)), levels)
        except (ValueError, IndexError):
            m = None
        if m is None:
            return None, None
        r = m[0]
        return np.array([Wl[k] * (r[k] - goal[k]) / max(abs(goal[k]), 0.08) for k in keys]), r
    LAM = 0.06
    x = x0.copy()
    r0, ours0 = resid(x)
    best = (np.sum(r0 ** 2), x.copy())
    mu = 1.0
    for it in range(10):
        r, _ = resid(x)
        J = np.zeros((len(r), len(x)))
        h = 0.05
        for i in range(len(x)):
            xp = x.copy()
            xp[i] = x[i] + h if x[i] + h <= hi[i] else x[i] - h
            rp, _ = resid(xp)
            if rp is None:
                continue
            J[:, i] = (rp - r) / (xp[i] - x[i])
        A = J.T @ J + (LAM + mu) * np.eye(len(x))
        g = J.T @ r + LAM * (x - x0)
        step = -np.linalg.solve(A, g)
        xn = np.clip(x + step, lo, hi)
        rn, _ = resid(xn)
        cn = np.sum(rn ** 2) + LAM * np.sum((xn - x0) ** 2) if rn is not None else np.inf
        cc = np.sum(r ** 2) + LAM * np.sum((x - x0) ** 2)
        if cn < cc:
            x = xn
            mu = max(mu * 0.4, 1e-3)
        else:
            mu *= 4
        print(s, "it", it, "cost", round(float(min(cn, cc)), 4), "mu", round(mu, 4), flush=True)
        if mu > 1e4:
            break
    # then coordinate search (robust where the landmarks jump: argmax bins, the menton's drop)
    def cost(x_):
        r_, _ = resid(x_)
        return np.inf if r_ is None else float(np.sum(r_ ** 2) + LAM * np.sum((x_ - x0) ** 2))
    cbest = cost(x)
    for stp in (0.2, 0.1, 0.05):
        for _pass in range(2):
            improved = False
            for i in range(len(x)):
                for sgn in (1, -1):
                    xt = x.copy()
                    xt[i] = np.clip(x[i] + sgn * stp, lo[i], hi[i])
                    if xt[i] == x[i]:
                        continue
                    ct = cost(xt)
                    if ct < cbest - 1e-5:
                        x, cbest, improved = xt, ct, True
                        break
            print(s, "coord", stp, "cost", round(cbest, 4), flush=True)
            if not improved:
                break
    r1, ours1 = resid(x)
    # targets for identities.json: the final value of each pair / one-sided target (base face's own overridden)
    tg = {}
    for (k, a, b), v, v0 in zip(vars_, x, x0):
        v = round(float(v), 2)
        if k == "pair":
            if abs(v) >= 0.02 or abs(v0) >= 0.02:
                tg[b], tg[a] = max(v, 0.0), max(-v, 0.0)
        elif v >= 0.02 or v0 >= 0.02:
            tg[a] = v
    tg = {k_: v for k_, v in tg.items() if v > 0 or k_ in [n for n in base_face] or ("l-" + k_[3:]) in base_face}
    # overlay data: projected head (front x/z, side y/z), sheet-space via the landmarks
    overlay(hd, hd.mesh(weights(x0)), levels, Psheet, os.path.join(DUMP, f"{s}_ov0.json"))
    overlay(hd, hd.mesh(weights(x)), levels, Psheet, os.path.join(DUMP, f"{s}_ov.json"))
    return dict(goal=goal, before=ours0, after=ours1, targets=tg, x=dict(zip([f"{a}|{b}" for _, a, b in vars_], np.round(x, 3).tolist())))


if ONLY == ["merge"]:
    res = {s: json.load(open(os.path.join(DUMP, f"res_{s}.json"))) for s in CFG["macros"] if os.path.exists(os.path.join(DUMP, f"res_{s}.json"))}
    for s, r in res.items():
        # Landmark correspondences for the skin projection (build_identities.py ai_skin): ours (Blender x/z front,
        # y/z side, the fitted head) -> sheet pixels.
        ov = json.load(open(os.path.join(DUMP, f"{s}_ov.json")))
        A, P, PS, F = ov["aux"], ov["P"], ov["Psheet"], CFG["front"][s]
        top = A["top"]
        fr = [(A["pl"][0], A["pl"][2], F["pupil_r"]), (A["pr"][0], A["pr"][2], F["pupil_l"]),
              (A["il"][0], A["il"][2], F["inner_r"]), (A["ol"][0], A["ol"][2], F["outer_r"]), (A["ir"][0], A["ir"][2], F["inner_l"]), (A["or_"][0], A["or_"][2], F["outer_l"]),
              (A["alar"] / 2, A["sn_z"], F["alar_r"]), (-A["alar"] / 2, A["sn_z"], F["alar_l"]), (0.0, A["sn_z"], F["subnasale"]),
              (A["mouth_w"] / 2, A["st_z"], F["mouth_r"]), (-A["mouth_w"] / 2, A["st_z"], F["mouth_l"]), (0.0, A["st_z"], F["stomion"]), (0.0, A["me_z"], F["menton"]),
              (A["face_w"] / 2, A["zyg_z"], F["zyg_r"]), (-A["face_w"] / 2, A["zyg_z"], F["zyg_l"]), (A["jaw_w"] / 2, A["gon_z"], F["gon_r"]), (-A["jaw_w"] / 2, A["gon_z"], F["gon_l"]),
              (A["pl"][0], A["brow_z"], [F["pupil_r"][0], F["brow"]]), (A["pr"][0], A["brow_z"], [F["pupil_l"][0], F["brow"]])]
        d = CFG["profile"][s]["dir"]
        sd = [(-P[k][1], top - P[k][0], [d * PS[k][1], PS[k][0]]) for k in ("gla", "nas", "prn", "sn", "ls", "st", "li", "sm", "pg", "me", "eye", "ear") if P.get(k) and PS.get(k)]
        r["corr"] = dict(front=[[float(a), float(b), float(c[0]), float(c[1])] for a, b, c in fr],
                         side=[[float(a), float(b), float(c[0]), float(c[1])] for a, b, c in sd], dir=d)
    json.dump(res, open(os.path.join(HERE, "refs", "ai", "ai_fit_result.json"), "w"), indent=1)
    # ... and the fitted targets into identities.json (its entries with ai.sheet)
    ip = os.path.join(HERE, "identities.json")
    IDJ = json.load(open(ip))
    for sx in ("m", "f"):
        for e in IDJ[sx]:
            sh = e.get("ai", {}).get("sheet")
            if sh in res:
                e["targets"] = res[sh]["targets"]
    json.dump(IDJ, open(ip, "w"), indent=1)
    print("merged", list(res))
    sys.exit(0)
res = {}
for s in CFG["macros"]:
    if ONLY and s not in ONLY:
        continue
    res[s] = fit(s)
    g, b, a = res[s]["goal"], res[s]["before"], res[s]["after"]
    print(f"{s}: {'ratio':12s} {'sheet':>7s} {'before':>7s} {'after':>7s} {'err0%':>6s} {'err1%':>6s}")
    for k in W:
        if k in g:
            e0 = (b[k] / g[k] - 1) * 100 if abs(g[k]) > 0.08 else (b[k] - g[k]) * 100
            e1 = (a[k] / g[k] - 1) * 100 if abs(g[k]) > 0.08 else (a[k] - g[k]) * 100
            print(f"   {k:12s} {g[k]:7.3f} {b[k]:7.3f} {a[k]:7.3f} {e0:6.1f} {e1:6.1f}{' *' if k in MAIN else ''}")
    json.dump(res[s], open(os.path.join(DUMP, f"res_{s}.json"), "w"), indent=1)
