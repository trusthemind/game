"""AI body build, skin: the AI body's surface detail and skin colour baked onto OUR body's UVs (ai_body_fit.py first).

Cycles, selected -> active, from the aligned AI mesh (local only) onto our fitted body posed into its stance:
  * normal: tangent-space normal map of the AI surface (its muscle definition, veins, skin folds) -- our mesh only
    carries the volumes;
  * albedo: the AI's base colour, light taken out: divided by its own low-pass (per vertex over the welded mesh, so
    the UV seams don't show: the baked key light, the broad shadow under the pecs / arms), its mid-scale contrast and
    saturation eased (the game's light and the normal map shade the muscles again), as a RATIO over the game's own
    skin (the tone selector keeps working: the ratio's mean is 1, the tone sets the colour).
Where the AI wears underwear, and on the head, neck, hands and feet, nothing of it is taken (ratio 1, the base
normal map): the AI's underwear colours and fabric folds never reach our skin, the nude mode shows our skin there.

Writes ai/fit/<sex>/ai_n.png (RG: normal xy, B: how much of it applies) and ai_c.png (RGB: albedo ratio / 2), both
non-colour, 2048, our body UV layout (glTF v down); ai_body_add.mjs ships them (WebP).

Blender --background --python ai_body_bake.py -- <m|f> [res]
"""
import os, sys, json, math, time
import numpy as np
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SEX = argv[0] if argv else "m"
RES = int(argv[1]) if len(argv) > 1 else 2048
sys.path.insert(0, os.path.join(HERE, "ai3d", "lib", "py"))
import common as _c
from common import skin_weights, posed_skin
D_DIR = os.path.join(_c.fit_root(), SEX)
exec(compile(open(os.path.join(HERE, "skin_bake.py"), encoding="utf-8").read(), "skin_bake.py", "exec"))
T0 = time.time()


def log(*a):
    print("AIBAKE", f"{time.time() - T0:6.1f}s", *a, flush=True)


def rd(name, dt, k):
    return np.fromfile(os.path.join(D_DIR, name), dt).reshape(-1, k)


st = np.load(os.path.join(D_DIR, "fit_state.npz"))
meta = json.load(open(os.path.join(D_DIR, "meta.json")))
NAMES, PAR = meta["joints"], meta["parents"]
NB = len(NAMES)
P0 = rd("body_pos.bin", np.float32, 3).astype(np.float64)
UV = rd("body_uv.bin", np.float32, 2).astype(np.float64)
TRI = rd("body_idx.bin", np.uint32, 3).astype(np.int64)
n = len(P0)
W = skin_weights(rd, n, NB)
JW = rd("joints_world.bin", np.float32, 16).reshape(NB, 4, 4).transpose(0, 2, 1).astype(np.float64)
JP = JW[:, :3, 3]
M = posed_skin(st["rot"], JP, PAR, W)
Dl = rd("ai_body_delta.bin", np.float32, 3).astype(np.float64)
X = np.einsum("nij,nj->ni", M[:, :3, :3], P0 + Dl) + M[:, :3, 3]
TQ = st["TQ"].astype(np.float64)
TT = rd("target_idx.bin", np.uint32, 3).astype(np.int64)
TUV = rd("target_uv.bin", np.float32, 2).astype(np.float64)
tj = json.load(open(os.path.join(D_DIR, "target.json")))

# welded graph (seam-free smoothing)
key = np.round(P0 / 1e-5).astype(np.int64)
_, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
inv = inv.reshape(-1)
nu = len(first)
TRIu = inv[TRI]
E = np.unique(np.sort(np.concatenate([TRIu[:, [0, 1]], TRIu[:, [1, 2]], TRIu[:, [2, 0]]]), 1), axis=0)
E = E[E[:, 0] != E[:, 1]]
ea, eb = E[:, 0], E[:, 1]
deg = np.maximum(np.bincount(ea, minlength=nu) + np.bincount(eb, minlength=nu), 1)


def lap(F, iters, lam=0.5):
    for _ in range(iters):
        acc = np.zeros_like(F)
        np.add.at(acc, ea, F[eb])
        np.add.at(acc, eb, F[ea])
        F = F + lam * ((acc / deg[:, None] if F.ndim == 2 else acc / deg) - F)
    return F


def nfill(F, w, iters):
    """Weighted Laplacian average: values where w > 0 spread into the rest (normalised)."""
    Fw = F * w[:, None]
    ww = w.copy()
    for _ in range(iters):
        a = np.zeros_like(Fw)
        b = np.zeros_like(ww)
        np.add.at(a, ea, Fw[eb]); np.add.at(a, eb, Fw[ea])
        np.add.at(b, ea, ww[eb]); np.add.at(b, eb, ww[ea])
        Fw = 0.5 * Fw + 0.5 * a / deg[:, None]
        ww = 0.5 * ww + 0.5 * b / deg
    return Fw / np.maximum(ww, 1e-9)[:, None]


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = _cycles()


from common import yup2z


def mesh_obj(name, V, F, uv_per_vertex):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.loops.add(len(F) * 3)
    me.polygons.add(len(F))
    me.vertices.foreach_set("co", yup2z(V).astype(np.float32).ravel())
    me.loops.foreach_set("vertex_index", F.astype(np.int32).ravel())
    me.polygons.foreach_set("loop_start", (np.arange(len(F)) * 3).astype(np.int32))
    me.polygons.foreach_set("loop_total", np.full(len(F), 3, np.int32))
    uvl = me.uv_layers.new(name="UVMap")
    luv = uv_per_vertex[F.ravel()].copy()
    luv[:, 1] = 1 - luv[:, 1]  # glTF v down -> Blender v up
    uvl.data.foreach_set("uv", luv.astype(np.float32).ravel())
    me.update()
    me.shade_smooth()
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    return o


body = mesh_obj("body", X, TRI, UV)
tgt = mesh_obj("target", TQ, TT, TUV)
log("objects built")
alb = bpy.data.images.load(os.path.join(D_DIR, tj["albedo"]))
alb.colorspace_settings.name = "Non-Color"
tgt.data.materials.append(_bake_mat("t_emit", lambda nt, em: (lambda t: (setattr(t, "image", alb), nt.links.new(t.outputs[0], em.inputs[0])))(nt.nodes.new("ShaderNodeTexImage"))))
# per-vertex attributes on our body: the AI colour's low-pass (linear) and the mask
vattr = body.data.color_attributes.new("lowpass", "FLOAT_COLOR", "POINT")
mattr = body.data.color_attributes.new("mask", "FLOAT_COLOR", "POINT")


def attr_mat(name, attr):
    def build(nt, em):
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = attr
        nt.links.new(a.outputs[0], em.inputs[0])
    return _bake_mat(name, build)


body.data.materials.append(_bake_mat("b_emit", lambda nt, em: None))


def new_img(name):
    img = bpy.data.images.new(name, RES, RES, float_buffer=True, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    return img


def bake(kind, img, selected):
    body.active_material.node_tree.nodes.active = None
    _target(body, img)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    if selected:
        tgt.select_set(True)
    bpy.context.view_layer.objects.active = body
    kw = dict(type=kind, margin=16, use_clear=True)
    if selected:
        kw.update(use_selected_to_active=True, cage_extrusion=0.025, max_ray_distance=0.05)
    if kind == "NORMAL":
        kw.update(normal_space="TANGENT")
    sc.cycles.samples = 1
    bpy.ops.object.bake(**kw)
    log("baked", kind, img.name)
    return img_np(img)[..., :3]  # rows bottom-up


C = bake("EMIT", new_img("ai_col"), True)
Nn = bake("NORMAL", new_img("ai_nrm"), True)

# ── per-vertex low-pass of the AI colour (linear), sampled from the bake at each vertex's UV ──
def at_uv(img, uv):
    x = np.clip((uv[:, 0] * RES).astype(int), 0, RES - 1)
    y = np.clip(((1 - uv[:, 1]) * RES).astype(int), 0, RES - 1)  # glTF v down -> rows bottom-up: row = (1 - v) * RES
    return img[y, x]


cv = s2l(np.clip(at_uv(C, UV), 0, 1))
cu = np.zeros((nu, 3))
np.add.at(cu, inv, cv)
cu /= np.bincount(inv, minlength=nu)[:, None]
uw = np.zeros(nu)
np.maximum.at(uw, inv, st["uw"].astype(float))
hold = np.zeros(nu)
np.maximum.at(hold, inv, st["hold"])
lum = cu @ [0.2126, 0.7152, 0.0722]
skin = (uw < 0.5) & (hold < 0.5) & (lum > 0.01)
log("skin verts", int(skin.sum()), "of", nu, "median AI skin (sRGB)", np.round(l2s(np.median(cu[skin], 0)) * 255).tolist())
# low-pass: ~ 6-8 cm (the baked key light, the broad shadow under the pecs / arms), the underwear / head / hands filled in
low = nfill(cu, skin.astype(float), 40)
low = lap(low, 6)
# mask: the AI applies on the torso and limbs, not under its underwear, fading out over the neck, wrists and ankles
mask = (1 - smooth(0.15, 0.6, hold)) * (1 - uw)
# (and not on the neck: the targets' necks crane forward, their muscle ridges would draw a stoop on our upright one)
neckw = np.zeros(nu)
np.maximum.at(neckw, inv, W[:, NAMES.index("neck_01")])
neckw = np.clip(lap(neckw, 3), 0, 1)
mask = mask * (1 - smooth(0.15, 0.5, neckw))
mask = np.clip(lap(mask, 4), 0, 1) * (1 - smooth(0.3, 0.6, hold)) * (1 - smooth(0.3, 0.6, neckw))
# the knees half: the AI's straight-leg kneecap folds read as a dark blotch on a bent knee (Walk, Crouch)
for kn in ("calf_l", "calf_r"):
    d2 = np.sum((P0[first] - JP[NAMES.index(kn)]) ** 2, 1)
    mask *= 1 - 0.5 * np.exp(-d2 / (2 * 0.05 ** 2))
vattr.data.foreach_set("color", np.concatenate([low[inv], np.ones((n, 1))], 1).astype(np.float32).ravel())
mattr.data.foreach_set("color", np.concatenate([np.repeat(mask[inv, None], 3, 1), np.ones((n, 1))], 1).astype(np.float32).ravel())
body.data.materials.clear()
body.data.materials.append(attr_mat("lp", "lowpass"))
Lp = bake("EMIT", new_img("ai_low"), False)
body.data.materials.clear()
body.data.materials.append(attr_mat("mk", "mask"))
Mk = bake("EMIT", new_img("ai_mask"), False)[..., 0]
# the islands' own texels (no margin), eroded: along the UV seams the bake's edge texels are unreliable (bright
# rims in the ratio, a crease in the normals) -> there the base skin, a 2-3 texel strip
body.data.materials.clear()
body.data.materials.append(_bake_mat("cov", lambda nt, em: setattr(em.inputs[0], "default_value", (1, 1, 1, 1))))
_target(body, cimg := new_img("ai_cover"))
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
cov = img_np(cimg)[..., 0]
er = max(1, RES // 700)
inner = (box(cov.astype(np.float32), er) > 0.999).astype(np.float32)
Mk = Mk * box(inner, er)
log("seam erosion", er, "px")

# ── albedo ratio ──
Cl = s2l(np.clip(C, 0, 1))
ratio = Cl / np.maximum(Lp, 1e-4)
lr = np.log(np.maximum(ratio, 1e-3))
lL = lr @ [0.2126, 0.7152, 0.0722]
# mid-scale shading (the baked occlusion between the muscles: the normal map and the game's light shade it again)
# eased by 40 %, the fine detail kept; chroma of the ratio halved (the tone sets the hue)
lL_mid = blur(lL.astype(np.float32), max(2, int(RES / 400)))
lL2 = (lL - lL_mid) + 0.35 * lL_mid
chroma = (lr - lL[..., None]) * 0.5
lr2 = np.clip(lL2[..., None] + chroma, math.log(0.65), math.log(1.35))
RATIO_PENDING = lr2
log("ratio median / p5 / p95 (masked)", [np.round(np.percentile(np.exp(lr2)[Mk > 0.9], q, 0), 3).tolist() for q in (50, 5, 95)])
# ── normal: RG xy, B mask ──
nxy = Nn[..., :2]
# where the bake's normal leans far off ours (> ~55 deg: a ray that met the wrong surface, the armpit, between the
# thighs) the AI's detail is not trusted
Mk = Mk * smooth(0.5, 0.75, Nn[..., 2] * 2 - 1) * smooth(0.01, 0.03, C @ [0.2126, 0.7152, 0.0722])  # (and the rays' misses)
ratio2 = np.exp(RATIO_PENDING) ** Mk[..., None]  # mask: towards 1 (the game's own skin)
out_n = np.concatenate([nxy, Mk[..., None]], -1)
os.makedirs(D_DIR, exist_ok=True)
flip = lambda a: a  # img_np rows are bottom-up; save_png writes Blender pixels (bottom-up) -> a normal top-down PNG
save_png(np.clip(out_n, 0, 1).astype(np.float32), os.path.join(D_DIR, "ai_n.png"), "ai_n_out", non_color=True)
save_png(np.clip(ratio2 / 2, 0, 1).astype(np.float32), os.path.join(D_DIR, "ai_c.png"), "ai_c_out", non_color=True)
# previews: the AI's raw bake and its delit colour at the base tone (for the report, local)
save_png(np.clip(C, 0, 1).astype(np.float32), os.path.join(D_DIR, "bake_raw.png"), "raw", non_color=True)
log("written ai_n.png / ai_c.png", RES)
