"""Front (and profile) close-ups of GLB heads with measure_face.mjs landmarks drawn on them (red balls), side by side.
Blender --background --python face_marks.py -- <out.png> <glb> <marks.json> [<glb> <marks.json> ...]
marks.json: {"name": [x, y, z] (glTF, Y-up), ...}; "-" for no marks. Body + eyes + brows only.
"""
import bpy, sys, os, math, json
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
out, pairs = a[0], list(zip(a[1::2], a[2::2]))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
SKIP = ("underwear", "anatomy", "hair")
CW = 0.24
for i, (f, mf) in enumerate(pairs):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == "MESH" and ((o.parent is None and not o.modifiers) or any(k in o.name.lower() for k in SKIP))]:
        bpy.data.objects.remove(o, do_unlink=True)
    new = [o for o in bpy.data.objects if o not in before]
    marks = json.load(open(mf)) if mf != "-" else {}
    E = marks.get("E")
    head = Vector((E[0], -E[2], E[1])) if E else Vector((0, 0, 1.6))
    for side in (0,):
        objs = new
        if side:
            dup = {}
            for o in new:
                c = o.copy()
                sc.collection.objects.link(c)
                dup[o] = c
            for o, c in dup.items():
                if o.parent in dup:
                    c.parent = dup[o.parent]
                for m in c.modifiers:
                    if m.type == "ARMATURE" and m.object in dup:
                        m.object = dup[m.object]
            objs = list(dup.values())
        off = Vector(((i + side) * CW, 0, 0))
        R = Matrix.Translation(off) @ Matrix.Rotation(-math.pi / 2 if side else 0, 4, "Z") @ Matrix.Translation(-head)
        for o in objs:
            if o.parent is None or o.parent not in objs:
                o.matrix_world = R @ o.matrix_world
        for k, p in marks.items():
            if not isinstance(p, list) or len(p) != 3:
                continue
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0012, location=R @ Vector((p[0], -p[2], p[1])), segments=8, ring_count=6)
            s = bpy.context.object
            s.color = (1, 0.1, 0.05, 1)
            s.location.y -= 0.05  # in front, always visible
    for o in new:
        if o.type == "MESH":
            o.color = (0.8, 0.66, 0.56, 1)
    bpy.ops.object.text_add(location=(i * CW - 0.1, -1, -0.15))
    t = bpy.context.object
    t.data.body = os.path.basename(os.path.dirname(f)) + "/" + os.path.basename(f)
    t.data.size = 0.012
    t.rotation_euler = (math.pi / 2, 0, 0)
W = len(pairs) * 2 * CW - CW
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = len(pairs) * CW
cam.location = (len(pairs) * CW / 2 - CW / 2, -10, -0.01)
cam.rotation_euler = (math.pi / 2, 0, 0)
sc.camera = cam
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "OBJECT"
sc.render.resolution_x = int(600 * len(pairs))
sc.render.resolution_y = int(600 * 0.36 / CW)
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("wrote", out)
