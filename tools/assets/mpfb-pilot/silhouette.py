"""Front + side silhouettes of GLB bodies at the same stature, arms lowered (A-pose ~ -65 deg), with ANSUR II landmark
lines (refs/body_targets.json: head, acromion, chest, waist, crotch, knee) -> body proportion check sheet.
Blender --background --python silhouette.py -- <out.png> <sex m|f> <glb> [<glb> ...]
"""
import bpy, sys, os, math, json
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
out, sex, files = a[0], a[1], a[2:]
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, "refs", "body_targets.json")))[sex]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
H = 1.0  # every body scaled to stature 1
CW = 0.62
SKIP = ("eye", "brow", "lash", "underwear", "anatomy", "hair")


def lower_arms(rig):
    if rig is None:
        return
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for s, sg in (("l", 1), ("r", -1)):
        pb = rig.pose.bones.get(f"upperarm_{s}")
        if not pb:
            continue
        bpy.context.view_layer.update()
        # rotate about the world forward axis (Y in Blender after glTF import) around the joint
        head = rig.matrix_world @ pb.head
        ang = math.radians(62 if (rig.matrix_world @ pb.tail).x > head.x else -62)
        R = Matrix.Translation(head) @ Matrix.Rotation(ang, 4, "Y") @ Matrix.Translation(-head)
        pb.matrix = rig.matrix_world.inverted() @ R @ rig.matrix_world @ pb.matrix
    bpy.ops.object.mode_set(mode="OBJECT")


for i, f in enumerate(files):
    before = set(bpy.data.objects)
    if f.endswith('.obj'):
        bpy.ops.wm.obj_import(filepath=f)
        for o in bpy.context.selected_objects:
            if o.type == 'MESH':
                o.data.shade_smooth()  # OBJ has no normals: flat facets would be the importer's, not the mesh's
    else:
        bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == "MESH" and not f.endswith(".obj") and ((o.parent is None and not o.modifiers and "Object_" not in o.name) or any(k in o.name.lower() for k in SKIP))]:
        bpy.data.objects.remove(o, do_unlink=True)
    new = [o for o in bpy.data.objects if o not in before]
    rig = next((o for o in new if o.type == "ARMATURE"), None)
    lower_arms(rig)
    bpy.context.view_layer.update()
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        o.color = (0.78, 0.64, 0.54, 1)
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        e = o.evaluated_get(dg)
        pts += [e.matrix_world @ v.co for v in e.data.vertices]
    z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
    k = H / (z1 - z0)
    # bideltoid (arms lowered): max width in 0.72..0.82 S, stature-relative
    band = [p for p in pts if 0.72 < (p.z - z0) / (z1 - z0) < 0.82]
    print("BIDELTOID", os.path.basename(os.path.dirname(f)), os.path.basename(f), round((max(p.x for p in band) - min(p.x for p in band)) / (z1 - z0), 4), flush=True)
    roots = [o for o in new if o.parent is None or o.parent not in new]
    orig = {o: o.matrix_world.copy() for o in roots}
    for side in (0, 1):
        if side:
            # duplicate for the side view
            dup = {}
            for o in new:
                c = o.copy()
                if o.data:
                    c.data = o.data
                sc.collection.objects.link(c)
                dup[o] = c
            for o, c in dup.items():
                if o.parent in dup:
                    c.parent = dup[o.parent]
                for m in c.modifiers:
                    if m.type == "ARMATURE" and m.object in dup:
                        m.object = dup[m.object]
            group = [(dup[o], orig[o]) for o in roots]
        else:
            group = [(o, orig[o]) for o in roots]
        x = (i * 2 + side) * CW
        for o, m0 in group:
            o.matrix_world = Matrix.Translation((x, 0, -z0 * k)) @ Matrix.Rotation(-math.pi / 2 if side else 0, 4, "Z") @ Matrix.Scale(k, 4) @ m0
    bpy.ops.object.text_add(location=(i * 2 * CW - 0.2, -1, -0.07))
    t = bpy.context.object
    t.data.body = os.path.basename(os.path.dirname(f)) + "/" + os.path.basename(f).replace(".glb", "").replace(".gltf", "")
    t.data.size = 0.035
    t.rotation_euler = (math.pi / 2, 0, 0)

# ANSUR landmark lines
W = len(files) * 2 * CW
mat = bpy.data.materials.new("line")
mat.diffuse_color = (1, 0.3, 0.1, 1)
for name, h in [("head", 1 - T["head_h"]), ("acromion", T["acromial_h"]), ("chest", T["chest_h"]), ("waist", T["waist_h"]),
                ("crotch", T["crotch_h"]), ("knee", T["knee_h"])]:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(W / 2 - CW / 2, 0.5, h))
    c = bpy.context.object
    c.scale = (W + CW, 0.001, 0.0012)
    c.color = (0.9, 0.2, 0.1, 1)
    bpy.ops.object.text_add(location=(-CW * 0.95, -1, h + 0.004))
    t = bpy.context.object
    t.data.body = f"ANSUR {name}"
    t.data.size = 0.022
    t.color = (0.9, 0.2, 0.1, 1)
    t.rotation_euler = (math.pi / 2, 0, 0)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = max(W, 1.12) * 1.0
cam.location = (W / 2 - CW / 2, -10, 0.5)
cam.rotation_euler = (math.pi / 2, 0, 0)
sc.camera = cam
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "OBJECT"
sc.render.resolution_x = int(260 * len(files) * 2)
sc.render.resolution_y = int(260 * len(files) * 2 * 1.12 / max(W, 1.12))
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("wrote", out)
