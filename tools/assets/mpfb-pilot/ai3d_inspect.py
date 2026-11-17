"""Inspect an image-to-3D head GLB (refs/ai/3d, local only): stats + front / three-quarter / profile renders
(textured, and clay with wireframe).   Blender --background --python ai3d_inspect.py -- <in.glb> <out_prefix>"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo = Vector((1e9,) * 3)
hi = Vector((-1e9,) * 3)
for o in meshes:
    me = o.data
    print("OBJ", o.name, "verts", len(me.vertices), "faces", len(me.polygons), "mats", [m.name for m in me.materials if m], "uv", [u.name for u in me.uv_layers])
    for v in o.bound_box:
        w = o.matrix_world @ Vector(v)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
for im in bpy.data.images:
    print("IMG", im.name, tuple(im.size))
for m in bpy.data.materials:
    if m.node_tree:
        print("MAT", m.name, [(n.type, n.image.name if getattr(n, "image", None) else "") for n in m.node_tree.nodes if n.type in ("TEX_IMAGE", "BSDF_PRINCIPLED", "NORMAL_MAP")])
print("BBOX", tuple(round(x, 4) for x in lo), tuple(round(x, 4) for x in hi))
c = (lo + hi) / 2
size = max(hi - lo)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = 768
world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = size * 1.05
for name, yaw in (("front", 0), ("q34", 35), ("side", 90)):
    a = math.radians(yaw)
    # glTF front (+Z) imports as Blender -Y
    d = Vector((math.sin(a), -math.cos(a), 0))
    cam.location = c + d * size * 3
    cam.rotation_euler = (d * -1).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{OUT}_{name}.png"
    bpy.ops.render.render(write_still=True)
# clay + wire (workbench)
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "SINGLE"
sc.display.shading.show_cavity = True
for o in meshes:
    m = o.modifiers.new("w", "WIREFRAME")
    m.thickness = size * 0.0008
    m.use_replace = False
for name, yaw in (("front", 0), ("side", 90)):
    a = math.radians(yaw)
    d = Vector((math.sin(a), -math.cos(a), 0))
    cam.location = c + d * size * 3
    cam.rotation_euler = (d * -1).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = size * 0.45
    cam.location.z = c.z + size * 0.12
    sc.render.filepath = f"{OUT}_wire_{name}.png"
    bpy.ops.render.render(write_still=True)
