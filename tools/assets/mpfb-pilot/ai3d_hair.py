"""The `ai_f2` identity's own hair: the short afro cut out of the image-to-3D head (ai3d_prep.py / ai3d_fit.py: its
hair label, our frame), cleaned (small islands out, the crown's lit curls in), decimated to <= 12k triangles, skirted
down to our fitted scalp (no gap under its edge), UV-unwrapped and its colour baked from the AI texture (512 px; the
game turns it into grey curls tinted by the hair colour, add_identities.mjs). Written like build_identities' hair:
ident/hair/f_ai_f2_afro_{pos,idx,uv}.bin + .json, the positions in the BASE head's space (the game moves asset hair
with the identity's field, faceIdentity.ts IdentityField: undone here, so it lands on the fitted head).

Blender --background --python ai3d_hair.py -- <ai_dir>
"""
import bpy, bmesh, os, sys, json, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
AI_DIR = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
NAME = "ai_f2_afro"
SEX = "f"
MAX_TRIS = 11500
TEX = 512
NB = 13380
GAME_SCALE = 1.0543  # add_identities.mjs: the shipped female body is the Blender human x 1.054 (its field's fades)

A = np.load(os.path.join(AI_DIR, "mesh.npz"))
F = np.load(os.path.join(AI_DIR, "fit.npz"))
s, R, t = float(F["s"]), F["R"], F["t"]
VA = A["V"].astype(np.float64) @ (s * R).T + t
TA = A["T"]
FUV = A["FUV"]
lab = F["lab"].copy()
Xf, V0, hw, tris = F["Xf"], F["V0"], F["hw"], F["tris"]
meta = json.load(open(os.path.join(HERE, "ident", SEX, "meta.json")))
lm = meta["landmarks"]
ez = lm["eye_z"]
# the crown: hair whatever its colour (its lit curls read as skin by colour alone)
VC = A["VC"]
lab[(((VA[:, 2] > ez + 0.07) & (VA[:, 1] > -0.09)) | (VA[:, 2] > ez + 0.09)) & (lab != 3)] = 1
# (the nape: no lower than the ear lobes -- below that the AI's dark neck shadow, not hair)
ht = ((lab[TA] == 1).sum(1) >= 2) & (VA[TA].min(1)[:, 2] > ez - 0.04)
H_T = TA[ht]
H_UV = FUV[ht]
print("HAIR hi-res tris", len(H_T), flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# hi-res hair (for the bake), and its BVH
bvh_hi = BVHTree.FromPolygons([tuple(v) for v in VA], [tuple(x) for x in H_T], all_triangles=True)

# the low-res hair mesh
used = np.unique(H_T)
remap = -np.ones(len(VA), np.int64)
remap[used] = np.arange(len(used))
bm = bmesh.new()
vs = [bm.verts.new(tuple(VA[i])) for i in used]
bm.verts.ensure_lookup_table()
for a, b, c in remap[H_T]:
    try:
        bm.faces.new((vs[a], vs[b], vs[c]))
    except ValueError:
        pass
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
# islands: keep the big ones
bm.faces.ensure_lookup_table()
seen = set()
islands = []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, isl = [f], []
    seen.add(f.index)
    while stack:
        x = stack.pop()
        isl.append(x)
        for e in x.edges:
            for y in e.link_faces:
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
    islands.append(isl)
big = max(len(i) for i in islands)
drop = [f for isl in islands if len(isl) < 0.02 * big for f in isl]
bmesh.ops.delete(bm, geom=drop, context="FACES")
# holes (a curl's highlight left out): filled -- every boundary loop but the longest (the hairline, skirted below)
def loops_of(bm):
    left = set(e for e in bm.edges if e.is_boundary)
    out = []
    while left:
        e0 = left.pop()
        loop, stack = {e0}, [e0]
        while stack:
            e = stack.pop()
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2 in left:
                        left.discard(e2)
                        loop.add(e2)
                        stack.append(e2)
        out.append(loop)
    return out
lps = sorted(loops_of(bm), key=len)
print("HAIR boundary loops", [len(l) for l in lps][-6:], flush=True)
for l in lps[:-1]:
    bmesh.ops.holes_fill(bm, edges=list(l), sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
me = bpy.data.meshes.new(NAME)
bm.to_mesh(me)
bm.free()
me.materials.append(bpy.data.materials.new("hair"))
me.materials.append(bpy.data.materials.new("skirt"))
ob = bpy.data.objects.new(NAME, me)
sc.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
print("HAIR cut", len(me.vertices), "verts", len(me.polygons), "tris", "islands", len(islands), "dropped", len(drop), flush=True)
# decimate (the skirt adds a ring of quads: leave room for it)
dec = ob.modifiers.new("dec", "DECIMATE")
dec.ratio = (MAX_TRIS - 700) / max(1, len(me.polygons))
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
# room for the skirt (two triangles per boundary edge)
for _ in range(3):
    bmc = bmesh.new()
    bmc.from_mesh(me)
    nbnd = sum(1 for e in bmc.edges if e.is_boundary)
    bmc.free()
    target = MAX_TRIS - 2 * nbnd - 50
    if len(me.polygons) <= target:
        break
    dec = ob.modifiers.new("dec", "DECIMATE")
    dec.ratio = target / len(me.polygons)
    dec.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
    print("HAIR decimate again: boundary", nbnd, "->", len(me.polygons), flush=True)
# a little smoothing of the boundary only (the cut's staircase)
bm = bmesh.new()
bm.from_mesh(me)
bnd = [v for v in bm.verts if v.is_boundary]
for _ in range(4):
    newp = {}
    for v in bnd:
        nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        if len(nb) == 2:
            newp[v] = (v.co * 2 + nb[0].co + nb[1].co) / 4
    for v, p in newp.items():
        v.co = p
# skirt: the boundary ring carried in to our fitted scalp (1.5 mm under), quads between
tb = tris[(tris < NB).all(1)]
head_t = tb[(V0[tb][:, :, 2].min(1) > ez - 0.1)]
bvh_head = BVHTree.FromPolygons([tuple(v) for v in Xf[:NB]], [tuple(x) for x in head_t], all_triangles=True)
bm.edges.ensure_lookup_table()
bnd_e = [e for e in bm.edges if e.is_boundary]
inner = {}
for e in bnd_e:
    for v in e.verts:
        if v in inner:
            continue
        h = bvh_head.find_nearest(v.co)
        p = h[0] - h[1] * 0.0015 if h[0] is not None else v.co
        inner[v] = bm.verts.new(p)
for e in bnd_e:
    a, b = e.verts
    f0 = e.link_faces[0]
    # (winding as the face's: the skirt faces outward with the hair)
    loop = [l for l in f0.loops if l.edge == e][0]
    a, b = (loop.vert, loop.link_loop_next.vert)
    try:
        f = bm.faces.new((b, a, inner[a], inner[b]))
        f.material_index = 1  # (the skirt: painted the hair's dark base, below)
    except ValueError:
        pass
bmesh.ops.triangulate(bm, faces=bm.faces)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
me.update()
print("HAIR low", len(me.vertices), "verts", len(me.polygons), "tris", flush=True)
# UVs
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")
# bake: each texel's point on the low mesh -> the hi-res hair's nearest point -> the AI texture
cimg = bpy.data.images.load(os.path.join(AI_DIR, "color.png"))
CA = np.empty(cimg.size[0] * cimg.size[1] * 4, np.float32)
cimg.pixels.foreach_get(CA)
CA = CA.reshape(cimg.size[1], cimg.size[0], 4)[..., :3]  # rows bottom-up (v up), sRGB values
V = np.array([tuple(v.co) for v in me.vertices])
uvl = me.uv_layers.active.data
img = np.zeros((TEX, TEX, 3), np.float32)
cov = np.zeros((TEX, TEX), bool)


def sample(uv):
    x = int(min(max((uv[0] % 1) * cimg.size[0], 0), cimg.size[0] - 1))
    y = int(min(max((uv[1] % 1) * cimg.size[1], 0), cimg.size[1] - 1))
    return CA[y, x]


tri_list = []
for p in me.polygons:
    li = list(p.loop_indices)
    tri_list.append(([p.vertices[0], p.vertices[1], p.vertices[2]], [tuple(uvl[k].uv) for k in li[:3]], p.material_index))
hc = A["VC"][used]
dark = np.percentile(hc, 30, axis=0).astype(np.float32)  # the curls' shadowed base, for the skirt
for vi, uv3, mi in tri_list:
    tx = np.array([u[0] for u in uv3]) * TEX
    ty = np.array([u[1] for u in uv3]) * TEX
    x0, x1 = int(max(0, math.floor(tx.min()) - 1)), int(min(TEX - 1, math.ceil(tx.max()) + 1))
    y0, y1 = int(max(0, math.floor(ty.min()) - 1)), int(min(TEX - 1, math.ceil(ty.max()) + 1))
    d = (ty[1] - ty[2]) * (tx[0] - tx[2]) + (tx[2] - tx[1]) * (ty[0] - ty[2])
    if abs(d) < 1e-12:
        continue
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px, py = x + 0.5, y + 0.5
            a = ((ty[1] - ty[2]) * (px - tx[2]) + (tx[2] - tx[1]) * (py - ty[2])) / d
            b = ((ty[2] - ty[0]) * (px - tx[2]) + (tx[0] - tx[2]) * (py - ty[2])) / d
            c = 1 - a - b
            if min(a, b, c) < -0.08 or cov[y, x]:
                continue
            if mi == 1:
                img[y, x] = dark
                cov[y, x] = True
                continue
            P = a * V[vi[0]] + b * V[vi[1]] + c * V[vi[2]]
            h = bvh_hi.find_nearest(Vector(P), 0.05)
            if h[0] is None:
                continue
            fi = h[2]
            A_, B_, C_ = VA[H_T[fi]]
            q = np.array(h[0])
            v0_, v1_, v2_ = B_ - A_, C_ - A_, q - A_
            d00, d01, d11, d20, d21 = v0_ @ v0_, v0_ @ v1_, v1_ @ v1_, v2_ @ v0_, v2_ @ v1_
            den = d00 * d11 - d01 * d01
            bv = (d11 * d20 - d01 * d21) / den if den else 0
            bw = (d00 * d21 - d01 * d20) / den if den else 0
            uv = (1 - bv - bw) * H_UV[fi, 0] + bv * H_UV[fi, 1] + bw * H_UV[fi, 2]
            img[y, x] = sample(uv)
            cov[y, x] = True
# dilate the islands' edges (mip bleeding)
for _ in range(6):
    m = cov.astype(np.float32)
    acc = np.zeros_like(img)
    cnt = np.zeros_like(m)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        acc += np.roll(np.roll(img * m[..., None], dy, 0), dx, 1)
        cnt += np.roll(np.roll(m, dy, 0), dx, 1)
    grow = (~cov) & (cnt > 0)
    img[grow] = acc[grow] / cnt[grow][:, None]
    cov |= grow
img[~cov] = img[cov].mean(0)
hd = os.path.join(HERE, "ident", "hair")
tex_path = os.path.join(hd, f"{SEX}_{NAME}.png")
pimg = bpy.data.images.new(NAME, TEX, TEX, alpha=True)
rgba = np.ones((TEX, TEX, 4), np.float32)
rgba[..., :3] = img
pimg.pixels.foreach_set(rgba.ravel())
pimg.filepath_raw = tex_path
pimg.file_format = "PNG"
pimg.save()
print("HAIR texture", tex_path, "coverage", round(float(cov.mean()), 3), flush=True)

# into the base head's space: the game adds the identity's field (IdentityField: the 6 nearest moved skin points'
# displacement, inverse-distance weighted, fading from 4 to 7.5 cm, in the shipped body's metres)
Dskin = (Xf - V0)[:NB]
sk = (hw[:NB] > 0)
Ps, Ds = V0[:NB][sk], Dskin[sk]


def field(P):
    out = np.zeros_like(P)
    for a in range(0, len(P), 256):
        q = P[a:a + 256]
        d2 = ((q[:, None] - Ps[None]) ** 2).sum(-1)
        idx = np.argpartition(d2, 6, axis=1)[:, :6]
        dd = np.take_along_axis(d2, idx, 1)
        d0 = np.sqrt(dd.min(1)) * GAME_SCALE
        tt = np.clip((d0 - 0.04) / 0.035, 0, 1)
        fade = 1 - tt * tt * (3 - 2 * tt)
        w = 1 / (dd * GAME_SCALE ** 2 + 1e-6)
        out[a:a + 256] = (Ds[idx] * w[..., None]).sum(1) / w.sum(1, keepdims=True) * fade[:, None]
    return out


Pb = V.copy()
for it in range(6):
    Pb = V - field(Pb)
err = np.abs(Pb + field(Pb) - V).max()
print("HAIR inverse field max err mm", round(float(err) * 1000, 3), flush=True)
pos, idx, uvs = Pb.astype(np.float32), [], []
for p in me.polygons:
    for k, li in zip(range(3), p.loop_indices):
        idx.append(p.vertices[k])
        uvs.append(tuple(uvl[li].uv))
pos.tofile(os.path.join(hd, f"{SEX}_{NAME}_pos.bin"))
np.savez_compressed(os.path.join(AI_DIR, "hair_fitted.npz"), V=V, T=np.array(idx, np.int32).reshape(-1, 3), skirt=np.array([p.material_index for p in me.polygons]))
np.array(idx, np.uint32).tofile(os.path.join(hd, f"{SEX}_{NAME}_idx.bin"))
np.array(uvs, np.float32).tofile(os.path.join(hd, f"{SEX}_{NAME}_uv.bin"))
json.dump(dict(name=NAME, verts=len(pos), corners=len(idx), texture=tex_path, opaque=True,
               licence="derived from an image-to-3D model (Higgsfield / Tripo H3.1, 2026-11-17) of an invented character; Higgsfield ToS 4.4 commercial use"),
          open(os.path.join(hd, f"{SEX}_{NAME}.json"), "w"))
# the fitted scalp under the hair: along each crown vertex's normal, from outside, the hair must come first
bvh_low = BVHTree.FromPolygons([tuple(v) for v in V], [tuple(p.vertices) for p in me.polygons], all_triangles=True)
NX = np.zeros_like(Xf[:NB])
fn = np.cross(Xf[head_t[:, 1]] - Xf[head_t[:, 0]], Xf[head_t[:, 2]] - Xf[head_t[:, 0]])
for k in range(3):
    np.add.at(NX, head_t[:, k], fn)
NX /= np.linalg.norm(NX, axis=1, keepdims=True) + 1e-12
pokes, gaps, bald = 0, [], 0
crown = np.flatnonzero((Xf[:NB, 2] > ez + 0.05) & (V0[:NB, 1] > -0.07) & (hw[:NB] > 0.9))
for i in crown:
    o = Xf[i] + NX[i] * 0.1
    h = bvh_low.ray_cast(Vector(o), Vector(-NX[i]), 0.2)
    if h[0] is None:
        bald += 1
        continue
    if h[3] > 0.1:
        pokes += 1
    gaps.append(0.1 - h[3])
print("HAIR crown verts", len(crown), "poking through", pokes, "no hair over", bald, "median hair height mm", round(float(np.median(gaps)) * 1000, 1), "tris", len(idx) // 3, flush=True)
