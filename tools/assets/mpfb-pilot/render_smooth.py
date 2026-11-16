"""Smooth-shaded clay renders (OBJ: vertex normals; GLB: its own, i.e. the game's, smooth normals) of OBJ / GLB bodies side by
side, front / side / 3/4 or a chest close-up. Blender --background --python render_smooth.py -- <out.png> <view
full|chest|chest_side|chest34> <file> [<file> ...]   (GLB: body mesh only, rest pose)"""
import bpy, sys, math, os
a = sys.argv[sys.argv.index("--") + 1:]
out, view, files = a[0], a[1], a[2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
SKIP = ("eye", "brow", "lash", "underwear", "anatomy", "hair")
objs = []
for i, f in enumerate(files):
    before = set(bpy.data.objects)
    if f.endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=f, forward_axis="Y", up_axis="Z")
    else:
        bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == "MESH" and any(k in o.name.lower() for k in SKIP):
            bpy.data.objects.remove(o, do_unlink=True)
    new = [o for o in bpy.data.objects if o not in before]
    ms = [o for o in new if o.type == "MESH"]
    for o in ms:
        o.data.materials.clear()
        for p in o.data.polygons:
            p.use_smooth = True
    roots = [o for o in new if o.parent is None]
    dg = bpy.context.evaluated_depsgraph_get()
    zs = [ (o.matrix_world @ v.co).z for o in ms for v in o.evaluated_get(dg).data.vertices]
    H = max(zs) - min(zs)
    for r in roots:
        r.location.x += i * 0.75
        r.location.z -= min(zs)
    objs.append(H)
H = max(objs)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
cam.data.type = "ORTHO"
n = len(files)
cx = (n - 1) * 0.75 / 2
FULL_ANG = {"full": 0, "full34": math.pi / 4, "fullside": math.pi / 2}
if view in FULL_ANG:
    for o in bpy.data.objects:
        if o.type in ("MESH", "ARMATURE", "EMPTY") and o.parent is None:
            o.rotation_mode = "XYZ"
            o.rotation_euler.z += -FULL_ANG[view]
    cam.data.ortho_scale = max(H * 1.05, n * 0.75)
    cam.location = (cx, -10, H / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    k = float(os.environ.get("RES_K", "1"))
    rx, ry = int(380 * n * k), int(380 * n * k * H * 1.05 / max(H * 1.05, n * 0.75))
else:
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    allz = [(o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == "MESH" for v in o.evaluated_get(dg).data.vertices]
    zc = min(allz) + 0.66 * (max(allz) - min(allz))  # navel .. collarbones
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE" and "spine_02" in o.pose.bones]
    if arms:  # skinned GLBs: frame on the skeleton (evaluated skinned vertices don't give world heights here)
        zc = sum((a.matrix_world @ a.pose.bones["spine_02"].head).z for a in arms) / len(arms) + 0.04
    cam.data.ortho_scale = n * 0.75 if view == "chest" else n * 0.75
    ang = {"chest": 0, "chest_side": math.pi / 2, "chest34": math.pi / 4}[view]
    # turn every body instead of the camera (so the row stays a row)
    for o in bpy.data.objects:
        if o.type in ("MESH", "ARMATURE", "EMPTY") and o.parent is None:
            o.rotation_mode = "XYZ"  # (glTF roots come in as quaternions: an Euler edit would do nothing)
            o.rotation_euler.z += -ang
    cam.data.ortho_scale = n * 0.75
    cam.location = (cx, -10, zc)
    rx, ry = int(420 * n), 560
    cam.data.ortho_scale = n * 0.75
    cam.data.ortho_scale = n * 0.75
sc.camera = cam
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.studio_light = "paint.sl" if "paint.sl" in [l.name for l in bpy.context.preferences.studio_lights] else sc.display.shading.studio_light
sc.display.shading.color_type = "SINGLE"
sc.display.shading.single_color = (0.8, 0.66, 0.56)
sc.display.shading.show_cavity = False
sc.render.resolution_x, sc.render.resolution_y = rx, ry
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("wrote", out)
