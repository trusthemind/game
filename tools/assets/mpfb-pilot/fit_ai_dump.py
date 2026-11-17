"""AI-sheet identities (refs/ai, fit_ai.py): dump what the fit needs from Blender, per sheet.

For each sheet's sex + race / age macros (refs/ai/ai_fit.json "macros"), the MPFB human with the sex's base face
(build_base.py BUILD[sex].face) is built headless as build_identities.py does, and written to
<out>/<sheet>.npz: body vertices (Blender world, Z-up, metres; hm08 skin + helpers), the eyes proxy's vertices,
the head weights, per-vertex UVs, and the deltas of every candidate face target (from the MPFB target files,
checked against one Blender build).

Blender --background --python fit_ai_dump.py -- <out_dir> [sheet,...]
"""
import bpy, os, sys, json, gzip
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DUMP = os.path.abspath(_argv[0])
ONLY = _argv[1].split(",") if len(_argv) > 1 else None
os.makedirs(DUMP, exist_ok=True)
sys.argv = [sys.argv[0], "--", "nohair"]
_src = open(os.path.join(HERE, "build_identities.py"), encoding="utf-8").read().split("\nfor s in ID_SEXES:")[0]
exec(compile(_src, "build_identities.py", "exec"))

CFG = json.load(open(os.path.join(HERE, "refs", "ai", "ai_fit.json")))
TDIR = _tdirs[0]
TPATH = {}
for r, _, fs in os.walk(TDIR):
    for f in fs:
        if f.endswith(".target.gz"):
            TPATH[f[:-10]] = os.path.join(r, f)


def target_delta(name, n):
    """A MakeHuman target file as Blender-world deltas (x, -z, y) / 10."""
    d = np.zeros((n, 3), np.float32)
    with gzip.open(TPATH[name], "rt") as fh:
        for ln in fh:
            p = ln.split()
            if len(p) != 4 or p[0].startswith("#"):
                continue
            i = int(p[0])
            if i < n:
                x, y, z = float(p[1]), float(p[2]), float(p[3])
                d[i] = (x * 0.1, -z * 0.1, y * 0.1)
    return d


names = sorted({n for pair in CFG["vars"] for n in pair if n} | {n for n in CFG.get("one_sided", [])})
exp = []
for n in names:
    exp += [f"l-{n[3:]}", f"r-{n[3:]}"] if n.startswith("lr-") else [n]
for sheet, spec in CFG["macros"].items():
    if ONLY and sheet not in ONLY:
        continue
    sex = spec["sex"]
    ident = dict(id="ai_probe", race=spec["race"], age=spec["age"], targets={}, brow=BUILD[sex]["brow"])
    clear()
    bm, _ = human(sex, ident)
    g = groups_of(bm)
    TargetService.bake_targets(bm)
    V = coords(bm)
    ev = coords(g["eyes"])
    hw = head_weights(bm)
    uv = bm.data.uv_layers.active.data
    vuv = np.zeros((len(V), 2), np.float32)
    for poly in bm.data.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            vuv[vi] = uv[li].uv
    vgs = {}
    for gname in ("helper-l-eye", "helper-r-eye"):
        gi = bm.vertex_groups.get(gname)
        if gi is not None:
            vgs[gname] = [v.index for v in bm.data.vertices if any(x.group == gi.index for x in v.groups)]
    tris = []
    for poly in bm.data.polygons:
        vs = list(poly.vertices)
        for t in range(1, len(vs) - 1):
            tris.append((vs[0], vs[t], vs[t + 1]))
    brows = coords(g["brows"])
    # Check the file deltas against Blender once: one target at 1.0.
    mw = bm.matrix_world
    D = {n: target_delta(n, len(V)) for n in exp}
    if sheet == next(iter(CFG["macros"])):
        clear()
        t = "nose-trans-up"
        ident2 = dict(ident, targets={t: 1.0})
        bm2, _ = human(sex, ident2)
        TargetService.bake_targets(bm2)
        V2 = coords(bm2)
        base_v = dict(BUILD[sex]["face"]).get(t, 0.0)
        pred = V + D[t] * (1.0 - base_v)
        err = np.abs(V2 - pred)[:13380].max()
        print("FIT check", t, "max err mm", round(float(err) * 1000, 3), "max delta mm", round(float(np.abs(D[t]).max()) * 1000, 2), flush=True)
    np.savez_compressed(os.path.join(DUMP, f"{sheet}.npz"), V=V, eyes=ev, hw=hw, uv=vuv,
                        dnames=np.array(exp), D=np.stack([D[n] for n in exp]),
                        leye=np.array(vgs.get("helper-l-eye", []), np.int32), reye=np.array(vgs.get("helper-r-eye", []), np.int32), tris=np.array(tris, np.int32), brows=brows,
                        base_face=json.dumps(dict(BUILD[sex]["face"])))
    print("FIT dumped", sheet, len(V), len(exp), "targets", flush=True)
print("FIT done", flush=True)
