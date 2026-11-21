"""Renders for the AI body fit (ai_body_fit.py): the aligned AI target next to / over our fitted body, front / side / back
(orthographic, smooth shading, studio light), the silhouette overlap and a distance heat map on our body.
Reads ai/fit/<sex>/fit_state.npz + ai_body_delta.bin (+ the dumps); writes ai/fit/<sex>/render_*.png.

Blender --background --python ai_body_render.py -- <m|f> [variant: fit|posed]
"""
import os, sys, json, math
import numpy as np
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SEX = argv[0] if argv else "m"
VAR = argv[1] if len(argv) > 1 else "fit"
sys.path.insert(0, os.path.join(HERE, "ai3d", "lib", "py"))
from common import fit_root, reader, yup2z, skin_weights, posed_skin
D_DIR = os.path.join(fit_root(), SEX)
OUT = D_DIR


rd = reader(D_DIR)


st = np.load(os.path.join(D_DIR, "fit_state.npz"))
meta = json.load(open(os.path.join(D_DIR, "meta.json")))
NAMES, PAR = meta["joints"], meta["parents"]
NB = len(NAMES)
P0 = rd("body_pos.bin", np.float32, 3).astype(np.float64)
TRI = rd("body_idx.bin", np.uint32, 3).astype(np.int64)
n = len(P0)
W = skin_weights(rd, n, NB)
JW = rd("joints_world.bin", np.float32, 16).reshape(NB, 4, 4).transpose(0, 2, 1).astype(np.float64)
JP = JW[:, :3, 3]
M = posed_skin(st["rot"], JP, PAR, W)
Dl = rd("ai_body_delta.bin", np.float32, 3).astype(np.float64)
X = P0 + (Dl if VAR == "fit" else 0)
X = np.einsum("nij,nj->ni", M[:, :3, :3], X) + M[:, :3, 3]
TQ = st["TQ"].astype(np.float64)
TT = rd("target_idx.bin", np.uint32, 3).astype(np.int64)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def mesh_obj(name, V, F, col):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.loops.add(len(F) * 3)
    me.polygons.add(len(F))
    me.vertices.foreach_set("co", yup2z(V).astype(np.float32).ravel())
    me.loops.foreach_set("vertex_index", F.astype(np.int32).ravel())
    me.polygons.foreach_set("loop_start", (np.arange(len(F)) * 3).astype(np.int32))
    me.polygons.foreach_set("loop_total", np.full(len(F), 3, np.int32))
    me.update()
    me.shade_smooth()
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    o.color = col
    return o


ours = mesh_obj("ours", X, TRI, (0.75, 0.62, 0.52, 1))
tgt = mesh_obj("target", TQ, TT, (0.55, 0.62, 0.72, 1))
# heat map: distance of our (fitted) surface to the target, as vertex colours
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(tgt, dg)
Xb = yup2z(X)
dist = np.array([(bvh.find_nearest(Vector(p), 0.2)[3] or 0.2) for p in Xb])
np.save(os.path.join(OUT, f"dist_{VAR}.npy"), dist)
ca = ours.data.color_attributes.new("heat", "FLOAT_COLOR", "POINT")
t = np.clip(dist / 0.012, 0, 1)  # 0 .. 12 mm (green < 6 mm, red >= 12 mm)
heat = np.stack([np.clip(2 * t, 0, 1), np.clip(2 - 2 * t, 0, 1) * (t > 0.5) + (t <= 0.5), np.clip(1 - 4 * t, 0, 1) * 0.3, np.ones_like(t)], 1)
keep = st["hold"] > 0.5
heat[keep] = [0.6, 0.6, 0.6, 1]
ca.data.foreach_set("color", heat.astype(np.float32).ravel())

sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "OBJECT"
sc.display.shading.show_specular_highlight = False
sc.render.resolution_x, sc.render.resolution_y = 520, 900
sc.render.film_transparent = False
sc.world = bpy.data.worlds.new("w")
sc.display.shading.background_type = "VIEWPORT"
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = 1.95
zc = (Xb[:, 2].max() + Xb[:, 2].min()) / 2


def shoot(view, path, show):
    for o in (ours, tgt):
        o.hide_render = o.name not in show
    ang = {"front": 0, "side": 90, "back": 180}[view]
    a = math.radians(ang)
    cam.location = (5 * math.sin(a), -5 * math.cos(a), zc)
    cam.rotation_euler = (math.radians(90), 0, a)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


for view in ("front", "side", "back"):
    sc.display.shading.color_type = "OBJECT"
    shoot(view, os.path.join(OUT, f"r_{VAR}_{view}_ours.png"), {"ours"})
    shoot(view, os.path.join(OUT, f"r_{VAR}_{view}_target.png"), {"target"})
    sc.display.shading.color_type = "VERTEX"
    shoot(view, os.path.join(OUT, f"r_{VAR}_{view}_heat.png"), {"ours"})
# silhouettes (flat, no light): target and ours as masks for the overlay
sc.display.shading.light = "FLAT"
sc.display.shading.color_type = "SINGLE"
sc.display.shading.single_color = (1, 1, 1)
sc.display.shading.background_color = (0, 0, 0)
for view in ("front", "side"):
    shoot(view, os.path.join(OUT, f"s_{VAR}_{view}_ours.png"), {"ours"})
    shoot(view, os.path.join(OUT, f"s_{VAR}_{view}_target.png"), {"target"})
print("RENDER done", SEX, VAR, "dist median mm", round(float(np.median(dist[~keep])) * 1000, 1), flush=True)
