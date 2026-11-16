"""Face identities for the MPFB base bodies: each identity (identities.json) is a whole MPFB2 human -- the sex's base
build (build_base.py BUILD) with its own face targets, race / age macros and brow asset -- built headless, and
written out raw for add_identities.mjs, which turns them into head-only morph targets on the game's bodies:

  ident/<sex>/meta.json          identities, groups, landmarks, the face's UV rect
  ident/<sex>/<group>_base.bin   float32 xyz of the base human's vertices (Blender world, Z-up): body / eyes / brows / lashes
  ident/<sex>/<group>_<id>.bin   float32 xyz deltas (identity - base), body masked to the head + neck
  ident/<sex>/skin_<id>.bin      uint8 RGBA tile (TILE x TILE, rows top = glTF v0): RGB face detail ratio / 2, A roughness
  ident/<sex>/eyes_<id>.png      iris texture (skin_bake.eye_texture)
  ident/<sex>/brow_<id>.png      brow card texture (in the identity brow asset's own UVs) + brow_<id>_uv.json
  ident/hair/<name>.bin + .json  MakeHuman CC0 hair meshes fitted to the base human (one per asset)

Blender --background --python build_identities.py -- [m|f|all] [nohair]
Everything is MakeHuman / MPFB2 system assets (CC0): targets, skins, eyes, brows, hair.
"""
import bpy, os, sys, json, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ID_SEXES = ["m", "f"] if (not argv or argv[0] in ("all", "nohair")) else [argv[0]]
DO_HAIR = "nohair" not in argv
OUTD = os.path.join(HERE, "ident")
TW, TH = 320, 640  # the face tile (the island is ~1:2, upright in the texture... rotated: see rect)
NBODY = 13380  # hm08 skin vertices; the helpers (tongue, teeth, joints...) follow
HAIR_SRC = os.path.expanduser("~/.cache/ashfall-src/mpfb/x-sys/hair")
HAIRS = ["bob01", "bob02", "long01", "ponytail01", "braid01", "short01", "short02", "short03", "short04", "afro01"]
# MakeHuman community hair (refs/HAIR_ASSETS.md, licences in refs/hair-assets/ATTRIBUTION.txt): women's styles,
# fitted to the female base only.
COMMUNITY = os.path.join(HERE, "refs", "hair-assets")
HAIRS_F = {n: os.path.join(COMMUNITY, pack, "extracted", "hair", n, n + ".mhclo") for pack, n in [
    ("makehuman-hair01-cc0", "toigo_blunt_bob"), ("makehuman-hair01-cc0", "toigo_curled_under_bob_with_bangs"),
    ("makehuman-hair02-ccby", "elvs_wavy_bob"), ("makehuman-hair02-ccby", "elvs_hazel_hair"),
    ("makehuman-hair02-ccby", "elvs_50s_updo"), ("makehuman-hair02-ccby", "elvs_katherine_hair")]}

# build_base.py's definitions (BUILD, gen_cast's services / helpers), without running its build.
_src = open(os.path.join(HERE, "build_base.py"), encoding="utf-8").read()
_saved = list(sys.argv)
exec(compile(_src.split('exec(compile(open(os.path.join(HERE, "skin_bake.py")')[0], "build_base.py", "exec"))
sys.argv = _saved
exec(compile(open(os.path.join(HERE, "skin_bake.py"), encoding="utf-8").read(), "skin_bake.py", "exec"))
IDS = json.load(open(os.path.join(HERE, "identities.json")))
ALL_TARGETS = set()
_tdirs = [os.path.expanduser("~/Library/Application Support/Blender/5.3/extensions/user_default/mpfb/data/targets")]
for d in _tdirs:
    for r, _, fs in os.walk(d):
        for f in fs:
            if f.endswith(".target.gz"):
                ALL_TARGETS.add(f[:-10])


def expand(targets):
    out = {}
    for k, v in targets.items():
        for n in ([f"l-{k[3:]}", f"r-{k[3:]}"] if k.startswith("lr-") else [k]):
            out[n] = v
    return out


def human(sex, ident):
    cfg = BUILD[sex]
    pheno = TargetService.get_default_macro_info_dict()
    pheno.update(BODIES["average"])
    pheno.update(gender=1.0 if sex == "m" else 0.0, age=0.5, cupsize=0.5, firmness=0.5)
    pheno.update(cfg["macro"])
    pheno["race"] = {"african": 0.15, "caucasian": 0.7, "asian": 0.15}
    tg = dict(cfg["targets"] + cfg["face"])
    brow = cfg["brow"]
    if ident:
        r = ident["race"]
        pheno["race"] = {"african": r[0], "caucasian": r[1], "asian": r[2]}
        pheno["age"] = ident["age"]
        for k, v in expand(ident["targets"]).items():
            if k not in ALL_TARGETS:
                print("IDENT unknown target", ident["id"], k, flush=True)
                continue
            tg[k] = v
        brow = ident["brow"]
    tg = {k: v for k, v in tg.items() if v > 1e-4}
    info = HumanService._create_default_human_info_dict()
    info.update(phenotype=pheno, rig="game_engine", eyes="low-poly.mhclo", eyebrows=brow + ".mhclo", eyelashes=cfg["lashes"] + ".mhclo",
                targets=[{"target": t, "value": v} for t, v in tg.items()], skin_mhmat="", skin_material_type="NONE",
                eyes_material_type="NONE", name=f"{sex}_{ident['id'] if ident else 'base'}")
    settings = HumanService.get_default_deserialization_settings()
    settings.update(subdiv_levels=0, load_clothes=False)
    bm = HumanService.deserialize_from_dict(info, settings)
    bpy.context.view_layer.objects.active = bm
    return bm, brow


def groups_of(bm):
    rig = bm.parent
    out = {}
    for o in rig.children:
        if o.type != "MESH" or o is bm:
            continue
        n = o.name.lower()
        g = "lashes" if "lash" in n else "brows" if "brow" in n else "eyes" if ("eye" in n or "low-poly" in n) else None
        if g:
            out[g] = o
    return out


def coords(o):
    mw = o.matrix_world
    return np.array([tuple(mw @ v.co) for v in o.data.vertices], np.float32)


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def head_weights(bm):
    n = len(bm.data.vertices)
    w = np.zeros(n, np.float32)
    gi = {g.index: g.name for g in bm.vertex_groups}
    for v in bm.data.vertices:
        for g in v.groups:
            nm = gi.get(g.group)
            if nm == "head":
                w[v.index] += g.weight
            elif nm == "neck_01":
                w[v.index] += 0.5 * g.weight
    return np.clip(w, 0, 1)


def raster(bm, rect, keep_face):
    """Object-space position and normal of the head's skin per tile texel (rows top = glTF v0), and coverage."""
    u0, v0, u1, v1 = rect  # Blender UV (v up)
    P = np.zeros((TH, TW, 3), np.float32)
    N = np.zeros((TH, TW, 3), np.float32)
    M = np.zeros((TH, TW), np.float32)
    uv = bm.data.uv_layers.active.data
    V = coords(bm)
    Nv = np.array([tuple(v.normal) for v in bm.data.vertices], np.float32)
    for poly in bm.data.polygons:
        if not keep_face[poly.index]:
            continue
        li = list(poly.loop_indices)
        vi = list(poly.vertices)
        for t in range(1, len(li) - 1):
            ids = [0, t, t + 1]
            tx = np.array([(uv[li[k]].uv[0] - u0) / (u1 - u0) * TW for k in ids])
            ty = np.array([(v1 - uv[li[k]].uv[1]) / (v1 - v0) * TH for k in ids])  # top = high v (glTF v0)
            x0, x1 = int(max(0, math.floor(tx.min()))), int(min(TW - 1, math.ceil(tx.max())))
            y0, y1 = int(max(0, math.floor(ty.min()))), int(min(TH - 1, math.ceil(ty.max())))
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (ty[1] - ty[2]) * (tx[0] - tx[2]) + (tx[2] - tx[1]) * (ty[0] - ty[2])
            if abs(d) < 1e-9:
                continue
            a = ((ty[1] - ty[2]) * (gx - tx[2]) + (tx[2] - tx[1]) * (gy - ty[2])) / d
            b = ((ty[2] - ty[0]) * (gx - tx[2]) + (tx[0] - tx[2]) * (gy - ty[2])) / d
            c = 1 - a - b
            ins = (a >= -0.02) & (b >= -0.02) & (c >= -0.02)
            if not ins.any():
                continue
            pa, pb, pc = (V[vi[k]] for k in ids)
            na, nb, nc = (Nv[vi[k]] for k in ids)
            sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
            P[sl][ins] = (a[..., None] * pa + b[..., None] * pb + c[..., None] * pc)[ins]
            N[sl][ins] = (a[..., None] * na + b[..., None] * nb + c[..., None] * nc)[ins]
            M[sl][ins] = 1
    return P, N, M


def crop(photo_path, rect):
    """The photo's texels in the rect, resampled to TILE (rows top = glTF v0), linear RGB."""
    img = bpy.data.images.load(photo_path, check_existing=True)
    a = s2l(img_np(img)[..., :3])  # rows bottom-up (Blender)
    H, W = a.shape[:2]
    u0, v0, u1, v1 = rect
    xs = ((u0 + (np.arange(TW) + 0.5) / TW * (u1 - u0)) * W).astype(int).clip(0, W - 1)
    ys = ((v1 - (np.arange(TH) + 0.5) / TH * (v1 - v0)) * H).astype(int).clip(0, H - 1)
    return a[ys][:, xs]


def skin_tile(sex, ident, base_photo, rect, P, N, M, lm):
    """RGB: (identity photo's local detail / the base photo's) x the identity's mid-scale colour (lids, lips, cheeks,
    beard shadow), chroma halved (tone-neutral: the game tints the skin); freckles; /2 for 8 bits. A: roughness."""
    idp = mhmat_texture(AssetService.find_asset_absolute_path(ident["skin"] + ".mhmat", "skins"))
    pi, pb = crop(idp, rect), crop(base_photo, rect)
    x, y, z = P[..., 0] - lm["mid"][0], P[..., 1] - lm["mid"][1], P[..., 2] - lm["mid"][2]
    ax = np.abs(x)
    front = smooth(-0.1, -0.5, N[..., 1]) * M
    # fine detail only (pores, creases, freckles: ~1/3 of skin_bake's radius); the photos' painted mid-scale light (a lit nose,
    # pale lips on a dark photo) read as patches on another tone
    r = max(2, int(round(28 * TW / (2048 * (rect[2] - rect[0])) / 3)))
    def det(p):
        lo = blur(p, r)
        return np.clip(p / (lo + 1e-4), 0.55, 1.6), lo
    di, li = det(pi)
    li = blur(pi, r * 3)  # the identity's mid-scale colour (below, a little)
    db, lb = det(pb)
    scalp = smooth(lm["eye_z"] + 0.05, lm["eye_z"] + 0.08, P[..., 2]) * M
    socket = np.exp(-(((ax - lm["eye_x"]) / 0.02) ** 2 + (z / 0.016) ** 2)) * front
    face = M * (1 - scalp)
    msk = (face > 0.5) & (socket < 0.3)
    mean_i = li[msk].mean(0) if msk.any() else li.reshape(-1, 3).mean(0)
    # The identity's own mid-scale colour, a little (redder cheeks, darker lids); its fine detail (pores, creases,
    # blemishes) in place of the base photo's. In log space, clamped: a dark photo's relative contrasts (lips lighter
    # than the skin) would read as pale patches on a light tone.
    lr = np.log(np.clip(di / db, 0.4, 2.5)) + 0.12 * np.log(np.clip(li / mean_i, 0.4, 2.5))
    lz = z - lm["mouth_dz"]
    lips = smooth(1.0, 0.7, np.sqrt((ax / 0.024) ** 2 + (lz / np.where(lz > 0, 0.0075, 0.010)) ** 2)) * front
    # Out of it: the photo's painted eye make-up, scalp stubble, its lips (the base albedo has its own), and the
    # tile's edge (feathered: no seam where the island goes on under the hair or down the neck).
    feather = smooth(0.55, 0.95, blur(M, 6))
    # ... and the hair painted into the photos (temples, sideburns, a low hairline): texels much darker than the face.
    def hairish(p, lo):
        lum = p.mean(-1)
        med = np.median(lum[msk]) if msk.any() else lum.mean()
        return np.clip(blur(smooth(0.72, 0.5, lum / med), 3) * 1.6, 0, 1)
    hair_m = np.maximum(hairish(pi, li), hairish(pb, lb))
    k = np.clip(0.85 * scalp + 0.6 * socket + 0.8 * lips + hair_m, 0, 1)[..., None]
    lr = lr * (1 - k) * feather[..., None]
    L = lr.mean(-1, keepdims=True)
    lr = L + (lr - L) * 0.35
    ratio = np.exp(np.clip(lr, -0.3, 0.1))
    fr = float(ident.get("freckles", 0))
    rough = np.full((TH, TW), 0.5, np.float32)
    if fr > 0:
        seed = sum(ord(c) * (i + 1) for i, c in enumerate(ident["id"]))
        n = vnoise(P.reshape(-1, 3) + seed * 0.013, 900.0).reshape(TH, TW)
        n2 = fbm(P.reshape(-1, 3) + 3.3, 40.0).reshape(TH, TW)
        zone = np.exp(-((x / 0.06) ** 2 + ((z + 0.025) / 0.032) ** 2)) * front  # nose bridge + cheeks
        spots = smooth(0.58, 0.7, n) * smooth(0.3, 0.6, n2) * zone * fr * feather
        ratio *= (1 - spots[..., None] * np.array([0.25, 0.36, 0.45]))
    # Age: the older photos' creases are in di already; drier, rougher skin.
    age = float(ident["age"])
    rough += 0.12 * smooth(0.6, 0.8, age)
    # Lips wetter / glossier (vermilion from the landmarks), the lids' rims a touch too.
    rim = np.exp(-(((ax - lm["eye_x"]) / 0.014) ** 2 + (z / 0.006) ** 2)) * front
    rough = 0.5 + (rough - 0.22 * lips - 0.12 * rim - 0.5) * feather
    rgb = np.clip(ratio / 2.0, 0, 1)
    rgb = np.where(M[..., None] > 0, rgb, 0.5)
    out = np.concatenate([rgb, np.clip(rough, 0, 1)[..., None]], -1)
    return (out * 255 + 0.5).astype(np.uint8)


def landmarks(bm, groups):
    V = coords(bm)
    ev = coords(groups["eyes"])
    eye_z = float(ev[:, 2].mean())
    eye_x = float(np.abs(ev[:, 0]).mean())
    mid = np.array([0.0, float(ev[:, 1].min()), eye_z], np.float32)
    hv = V[(np.abs(V[:, 0]) < 0.005) & (V[:, 2] < eye_z - 0.01) & (V[:, 2] > eye_z - 0.07)]
    nose = hv[np.argmin(hv[:, 1])]
    return dict(mid=mid.tolist(), eye_z=eye_z, eye_x=eye_x, nose=nose.tolist(), mouth_dz=float(nose[2] - 0.03 - eye_z))


def build(sex):
    od = os.path.join(OUTD, sex)
    os.makedirs(od, exist_ok=True)
    clear()
    bm, base_brow = human(sex, None)
    g = groups_of(bm)
    hair_out = []
    if not DO_HAIR:  # (nohair: keep what an earlier run fitted)
        hd0 = os.path.join(OUTD, "hair")
        hair_out = sorted(f[len(sex) + 1:-5] for f in os.listdir(hd0) if f.startswith(sex + "_") and f.endswith(".json")) if os.path.isdir(hd0) else []
    if DO_HAIR:
        hd = os.path.join(OUTD, "hair")
        os.makedirs(hd, exist_ok=True)
        paths = {h: os.path.join(HAIR_SRC, h, h + ".mhclo") for h in HAIRS}
        if sex == "f":
            paths.update(HAIRS_F)
        for h, p in paths.items():
            if not os.path.exists(p):
                print("HAIR missing", p, flush=True)
                continue
            before = set(bpy.data.objects)
            ho = HumanService.add_mhclo_asset(p, bm, asset_type="Hair", subdiv_levels=0, material_type="NONE")
            bpy.context.view_layer.update()
            me = ho.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
            mw = ho.matrix_world
            pos = np.array([tuple(mw @ v.co) for v in me.vertices], np.float32)
            uvl = me.uv_layers.active.data
            tris, uvs = [], []
            for poly in me.polygons:
                li = list(poly.loop_indices)
                for t in range(1, len(li) - 1):
                    for k in (0, t, t + 1):
                        tris.append(me.loops[li[k]].vertex_index)
                        uvs.append(tuple(uvl[li[k]].uv))
            np.array(pos, np.float32).tofile(os.path.join(hd, f"{sex}_{h}_pos.bin"))
            np.array(tris, np.uint32).tofile(os.path.join(hd, f"{sex}_{h}_idx.bin"))
            np.array(uvs, np.float32).tofile(os.path.join(hd, f"{sex}_{h}_uv.bin"))
            mm = [os.path.join(os.path.dirname(p), f) for f in os.listdir(os.path.dirname(p)) if f.endswith(".mhmat")]
            tex = mhmat_texture(mm[0]) if mm else None
            json.dump(dict(name=h, verts=len(pos), corners=len(tris), texture=tex, licence="CC0 (MakeHuman system assets)"), open(os.path.join(hd, f"{sex}_{h}.json"), "w"))
            hair_out.append(h)
            for o in [o for o in bpy.data.objects if o not in before]:
                bpy.data.objects.remove(o, do_unlink=True)
            print("HAIR", h, len(pos), len(tris) // 3, flush=True)
    TargetService.bake_targets(bm)
    hw = head_weights(bm)
    hj0 = np.array(tuple(bm.parent.matrix_world @ bm.parent.data.bones["head"].head_local), np.float32)
    base = {"body": coords(bm), **{k: coords(o) for k, o in g.items()}}
    for k, a in base.items():
        a.tofile(os.path.join(od, f"{k}_base.bin"))
    hw.tofile(os.path.join(od, "body_headw.bin"))
    # Body triangles (for the nearest-surface mapping onto the decimated game body).
    tri = []
    for poly in bm.data.polygons:
        vs = list(poly.vertices)
        for t in range(1, len(vs) - 1):
            tri += [vs[0], vs[t], vs[t + 1]]
    np.array(tri, np.uint32).tofile(os.path.join(od, "body_tris.bin"))
    lm = landmarks(bm, g)
    VB = base["body"]
    hv = VB[(VB[:, 2] > lm["eye_z"] - 0.04) & (VB[:, 2] < lm["eye_z"] + 0.01)]
    ear_y = float(hv[np.argmax(np.abs(hv[:, 0]))][1])
    lm["ear_y"] = ear_y
    # The face's UV rect: faces wholly on the head (by weight), the scalp's island included.
    uv = bm.data.uv_layers.active.data
    keep = np.zeros(len(bm.data.polygons), bool)
    us, vs_ = [], []
    for poly in bm.data.polygons:
        # the face: the head island's front, below the hairline (the scalp and nape are under hair; the ears are
        # islands of their own elsewhere in the texture)
        if max(poly.vertices) < NBODY and min(hw[v] for v in poly.vertices) > 0.9 and all(VB[v][1] < ear_y and VB[v][2] < lm["eye_z"] + 0.075 for v in poly.vertices) and min(uv[li].uv[0] for li in poly.loop_indices) > 0.55 and min(uv[li].uv[1] for li in poly.loop_indices) > 0.15:
            keep[poly.index] = True
            for li in poly.loop_indices:
                us.append(uv[li].uv[0])
                vs_.append(uv[li].uv[1])
    rect = (float(min(us)), float(min(vs_)), float(max(us)), float(max(vs_)))
    print("IDENT face UV rect", sex, np.round(rect, 4).tolist(), flush=True)
    P, N, M = raster(bm, rect, keep)
    base_photo = mhmat_texture(AssetService.find_asset_absolute_path(BUILD[sex]["skin"] + ".mhmat", "skins"))
    bpy.context.scene["ashfall_hair_col"] = [0.05, 0.035, 0.025]
    brow_info = {}
    def brow_uv(o):
        u = o.data.uv_layers.active.data
        faces = [list(p.vertices) for p in o.data.polygons]
        luv = [[tuple(u[li].uv) for li in p.loop_indices] for p in o.data.polygons]
        return dict(faces=faces, uv=luv)
    brow_info["base"] = dict(asset=base_brow, **brow_uv(g["brows"]))
    meta = dict(sex=sex, tile=[TW, TH], rect_blender=rect, rect_gltf=[rect[0], 1 - rect[3], rect[2], 1 - rect[1]], landmarks=lm,
                counts={k: int(len(a)) for k, a in base.items()}, identities=[], hair=hair_out)
    for ident in IDS[sex]:
        clear()
        bm2, brow = human(sex, ident)
        g2 = groups_of(bm2)
        TargetService.bake_targets(bm2)
        # Race / age macros change the body's proportions: the head rides up or down the neck by centimetres. Only
        # the face counts -- deltas relative to the head joint (where the head sits on the neck stays the base's).
        hj = lambda b: np.array(tuple(b.parent.matrix_world @ b.parent.data.bones["head"].head_local), np.float32)
        shift = hj(bm2) - hj0
        cur = {"body": coords(bm2), **{k: coords(o) for k, o in g2.items()}}
        stats = {}
        for k, a in cur.items():
            if len(a) != len(base[k]):
                print("IDENT count mismatch", ident["id"], k, len(a), len(base[k]), flush=True)
                continue
            d = a - base[k] - shift
            if k == "body":
                d *= hw[:, None]
            d.astype(np.float32).tofile(os.path.join(od, f"{k}_{ident['id']}.bin"))
            stats[k] = float(np.abs(d).max())
        tile = skin_tile(sex, ident, base_photo, rect, P, N, M, lm)
        tile.tofile(os.path.join(od, f"skin_{ident['id']}.bin"))
        ep = mhmat_texture(os.path.join(MPFB_USER, "eyes", "materials", ident["eyes"] + ".mhmat"))
        eye_texture(ep, os.path.join(od, f"eyes_{ident['id']}.png"))
        bp = mhmat_texture(AssetService.find_asset_absolute_path(brow + ".mhmat", "eyebrows"))
        hair_card_texture(bp, os.path.join(od, f"brow_{ident['id']}.png"), (0.05, 0.035, 0.025), 0.55 if sex == "m" else 0.75)
        brow_info[ident["id"]] = dict(asset=brow, **brow_uv(g2["brows"]))
        meta["identities"].append(dict(ident, maxDelta=stats, shift=shift.tolist()))
        print("IDENT", sex, ident["id"], json.dumps(stats), flush=True)
    json.dump(brow_info, open(os.path.join(od, "brow_uv.json"), "w"))
    json.dump(meta, open(os.path.join(od, "meta.json"), "w"), indent=1)


for s in ID_SEXES:
    build(s)
print("IDENT done", flush=True)
