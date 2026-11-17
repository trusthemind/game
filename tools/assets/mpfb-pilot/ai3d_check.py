"""Check renders for ai3d_fit.py: the aligned AI head (textured / clay / its skin-hair-eye labels) and our fitted
head (clay, distance heat-map, wire over the AI clay), front / three-quarter / profile.
Blender --background --python ai3d_check.py -- <ai_dir> <out_prefix> [what,...]   what: ai,labels,ours,overlay,heat,base
"""
import bpy, os, sys, json, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
AI_DIR, OUT = os.path.abspath(argv[0]), argv[1]
WHAT = argv[2].split(",") if len(argv) > 2 else ["ai", "labels", "ours", "overlay", "heat"]
A = np.load(os.path.join(AI_DIR, "mesh.npz"))
F = np.load(os.path.join(AI_DIR, "fit.npz"))
s, R, t = float(F["s"]), F["R"], F["t"]
VA = A["V"].astype(np.float64) @ (s * R).T + t
TA = A["T"]
lab = F["lab"]
Xf, V0, tris = F["Xf"], F["V0"], F["tris"]
NB = 13380
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def mesh(name, V, T, uv=None):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set("co", V.astype(np.float32).ravel())
    me.loops.add(len(T) * 3)
    me.loops.foreach_set("vertex_index", T.astype(np.int32).ravel())
    me.polygons.add(len(T))
    me.polygons.foreach_set("loop_start", np.arange(0, len(T) * 3, 3, dtype=np.int32))
    me.polygons.foreach_set("loop_total", np.full(len(T), 3, np.int32))
    if uv is not None:
        ul = me.uv_layers.new(name="UVMap")
        ul.data.foreach_set("uv", uv.astype(np.float32).ravel())
    me.update()
    me.validate()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    return o


eye_z = 1.499
keep = VA[TA].min(1)[:, 2] > 1.33
TAk = TA[keep]
ai = mesh("ai", VA, TAk, A["FUV"][keep].reshape(-1, 2))
tb = tris[(tris < NB).all(1)]
ours = mesh("ours", Xf[:NB], tb[(V0[tb][:, :, 2].min(1) > 1.33)])
eyem = mesh("eyesm", F["eyes_new"], F["eyes_tris"])
HF = np.load(os.path.join(AI_DIR, "hair_fitted.npz")) if os.path.exists(os.path.join(AI_DIR, "hair_fitted.npz")) else None
hairm = mesh("hairm", HF["V"], HF["T"]) if HF is not None else None
if hairm is not None:
    hcol = hairm.data.color_attributes.new("sk", "FLOAT_COLOR", "CORNER")
    cc = np.repeat(np.where(HF["skirt"][:, None] == 1, [[0.9, 0.2, 0.2, 1]], [[0.25, 0.2, 0.18, 1]]), 3, axis=0).astype(np.float32)
    hcol.data.foreach_set("color", cc.ravel())
mat = bpy.data.materials.new("tex")
mat.use_nodes = True
nt = mat.node_tree
im = nt.nodes.new("ShaderNodeTexImage")
im.image = bpy.data.images.load(os.path.join(AI_DIR, "color.png"))
nt.links.new(im.outputs[0], nt.nodes["Principled BSDF"].inputs[0])
ai.data.materials.append(mat)
# labels as vertex colours
ca = ai.data.color_attributes.new("lab", "FLOAT_COLOR", "POINT")
pal = np.array([[0.8, 0.55, 0.45, 1], [0.1, 0.1, 0.5, 1], [1, 1, 0, 1], [0.3, 0.6, 0.3, 1]], np.float32)
ca.data.foreach_set("color", pal[lab].ravel())
# distance heat on ours
bv = BVHTree.FromPolygons([tuple(v) for v in VA], [tuple(x) for x in TAk], all_triangles=True)
dist = np.zeros(NB)
for i in range(NB):
    if Xf[i, 2] < 1.36:
        continue
    h = bv.find_nearest(Vector(Xf[i]), 0.05)
    dist[i] = h[3] if h[0] is not None else 0.05
heat = np.clip(dist / 0.004, 0, 1)
hc = ours.data.color_attributes.new("heat", "FLOAT_COLOR", "POINT")
hcol = np.stack([heat, 1 - np.abs(heat - 0.5) * 2, 1 - heat, np.ones_like(heat)], 1).astype(np.float32)
hc.data.foreach_set("color", hcol.ravel())

world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
sc.render.resolution_x, sc.render.resolution_y = 600, 760
C = Vector((0, -0.09, eye_z - 0.03))
CE = Vector((0, -0.09, eye_z - 0.005))


def shoot(name, yaw, scale=0.30):
    a = math.radians(yaw)
    d = Vector((math.sin(a), -math.cos(a), 0))
    cam.location = (C if scale > 0.2 else CE) + d * 1.0
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = scale
    sc.render.filepath = f"{OUT}_{name}_{yaw}.png"
    bpy.ops.render.render(write_still=True)


def show(objs):
    for o in (ai, ours, eyem, hairm):
        if o is None:
            continue
        o.hide_render = o not in objs


VIEWS = (0, 35, 90)
for w in WHAT:
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.show_cavity = False
    for m in list(ours.modifiers) + list(ai.modifiers):
        (ours if m.id_data == ours else ai).modifiers.remove(m)
    if w == "ai":
        sh.color_type = "TEXTURE"
        show([ai])
    elif w == "labels":
        sh.color_type = "VERTEX"
        show([ai])
    elif w == "aiclay":
        sh.color_type = "SINGLE"
        sh.single_color = (0.8, 0.8, 0.8)
        show([ai])
    elif w == "ours":
        sh.color_type = "SINGLE"
        sh.single_color = (0.8, 0.8, 0.8)
        show([ours])
    elif w == "eyes":
        sh.color_type = "SINGLE"
        sh.single_color = (0.8, 0.8, 0.8)
        show([ours, eyem])
        for y in (0, 35):
            shoot(w, y, 0.11)
        continue
    elif w == "aieyes":
        sh.color_type = "TEXTURE"
        show([ai])
        for y in (0, 35):
            shoot(w, y, 0.11)
        continue
    elif w == "mouth":
        sh.color_type = "SINGLE"
        sh.single_color = (0.8, 0.8, 0.8)
        for objs, tag in (([ours], "us"), ([ai], "ai")):
            show(objs)
            for y in (0, 35, 90):
                a = math.radians(y)
                d = Vector((math.sin(a), -math.cos(a), 0))
                cam.location = Vector((0, -0.12, 1.44)) + d * 1.0
                cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
                cam.data.ortho_scale = 0.09
                sc.render.filepath = f"{OUT}_mouth_{tag}_{y}.png"
                bpy.ops.render.render(write_still=True)
        continue
    elif w == "hairhead":
        sh.color_type = "VERTEX"
        show([ours, hairm, eyem])
        for y, el in ((0, 25), (35, 25), (90, 0), (150, 10)):
            a, e_ = math.radians(y), math.radians(el)
            d = Vector((math.sin(a) * math.cos(e_), -math.cos(a) * math.cos(e_), math.sin(e_)))
            cam.location = Vector((0, -0.02, 1.53)) + d * 1.0
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            cam.data.ortho_scale = 0.32
            sc.render.filepath = f"{OUT}_hairhead_{y}.png"
            bpy.ops.render.render(write_still=True)
        continue
    elif w == "heat":
        sh.color_type = "VERTEX"
        show([ours])
    elif w == "overlay":
        sh.color_type = "SINGLE"
        sh.single_color = (0.8, 0.8, 0.8)
        m = ours.modifiers.new("w", "WIREFRAME")
        m.thickness = 0.00025
        m.use_replace = True
        show([ai, ours])
    for y in VIEWS:
        shoot(w, y)
print("CHECK done", float(np.sqrt((dist[(dist > 0)] ** 2).mean())))
