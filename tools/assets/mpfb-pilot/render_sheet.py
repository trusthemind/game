"""Front-view contact sheet of GLBs in a grid.
Blender --background --python render_sheet.py -- <out.png> <cols> <cell_w> <cell_h> <glb> [<glb> ...]
"""
import bpy, sys, os, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
out, cols, cw, ch, files = a[0], int(a[1]), float(a[2]), float(a[3]), a[4:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
rows = math.ceil(len(files) / cols)
for i, f in enumerate(files):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == "MESH" and o.parent is None]:  # glTF importer's bone-shape icosphere
        bpy.data.objects.remove(o, do_unlink=True)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    # Normalise: feet on the ground (min z of meshes) and centred in its cell.
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == "MESH" for c in o.bound_box]
    minz = min(p.z for p in pts)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    c, r = i % cols, i // cols
    for o in roots:
        o.location += Vector(((c - (cols - 1) / 2) * cw - cx, 0, (rows - 1 - r) * ch - minz))
    bpy.ops.object.text_add(location=((c - (cols - 1) / 2) * cw - cw * 0.45, -0.3, (rows - 1 - r) * ch - 0.12))
    t = bpy.context.object
    t.data.body = os.path.basename(f).replace(".glb", "")
    t.data.size = 0.09
    t.rotation_euler = (math.pi / 2, 0, 0)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
cam.data.type = "ORTHO"
W, H = cols * cw, rows * ch
cam.data.ortho_scale = max(W, H) * 1.02
cam.location = (0, -20, H / 2 - 0.15)
cam.rotation_euler = (math.pi / 2, 0, 0)
sc.camera = cam
px = 400
sc.render.resolution_x = int(W / ch * px * 2)
sc.render.resolution_y = int(rows * px * 2)
for name, rot, e in (("key", (math.radians(60), 0, math.radians(-30)), 3.0), ("fill", (math.radians(70), 0, math.radians(40)), 1.2)):
    l = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
    l.data.energy = e
    l.rotation_euler = rot
    sc.collection.objects.link(l)
w = bpy.data.worlds.new("w"); sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.57, 0.6, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sc.render.engine = "BLENDER_EEVEE"
sc.view_settings.view_transform = "Standard"
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RENDERED", out, sc.render.resolution_x, sc.render.resolution_y)
