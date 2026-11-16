"""Overlaid front + side silhouettes of meshes that already share one space (fit_scan.py debug OBJs: the scan and the
MPFB body posed into the scan's stance, before / after the fit), with ANSUR II landmark lines (refs/body_targets.json).
First mesh = filled grey (the reference), the others = coloured outlines.
Blender --background --python sil_overlay.py -- <out.png> <sex m|f> <ref.obj> <a.obj> [<b.obj>]
"""
import bpy, sys, os, math, json
import numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
out, sex, files = a[0], a[1], a[2:]
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, "refs", "body_targets.json")))[sex]
COLS = [(0.62, 0.62, 0.62), (0.15, 0.4, 1.0), (1.0, 0.45, 0.05)]
RES = 900


def render_mask(obj_path, side, box):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    bpy.ops.wm.obj_import(filepath=obj_path, forward_axis="Y", up_axis="Z")
    o = bpy.context.selected_objects[0]
    if side:
        o.rotation_euler = (0, 0, -math.pi / 2)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cx, z0, z1 = box
    cam.data.ortho_scale = (z1 - z0) * 1.06
    cam.location = (cx, -10, (z0 + z1) / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.camera = cam
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "SINGLE"
    sc.display.shading.single_color = (1, 1, 1)
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0, 0, 0)
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.film_transparent = True
    p = os.path.join(bpy.app.tempdir, "m.png")
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(p)
    A = np.array(img.pixels[:]).reshape(RES, RES, 4)[::-1, :, 3] > 0.5
    return A


# stature box from the reference
V = np.array([[float(x) for x in l.split()[1:4]] for l in open(files[0]) if l.startswith("v ")])
z0, z1 = V[:, 2].min(), V[:, 2].max()
box = (0.0, z0, z1)
panels = []
for side in (0, 1):
    masks = [render_mask(f, side, box) for f in files]
    img = np.ones((RES, RES, 3))
    img[masks[0]] = (0.82, 0.82, 0.82)
    for m, c in zip(masks[1:], COLS[1:]):
        er = m.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
            er &= np.roll(np.roll(m, dy, 0), dx, 1)
        img[m & ~er] = c
    # ANSUR lines (stature fractions)
    span = (z1 - z0) * 1.06
    for h in [1 - T["head_h"], T["acromial_h"], T["chest_h"], T["waist_h"], T["crotch_h"], T["knee_h"]]:
        zz = z0 + h * (z1 - z0)
        row = int(RES / 2 - (zz - (z0 + z1) / 2) / span * RES)
        img[row, ::6] = (0.9, 0.15, 0.1)
        img[row, 1::6] = (0.9, 0.15, 0.1)
    panels.append(img)
sheet = np.concatenate(panels, 1)
bpy.ops.wm.read_factory_settings(use_empty=True)
im = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0])
rgba = np.concatenate([sheet, np.ones(sheet.shape[:2] + (1,))], 2)[::-1]
im.pixels[:] = rgba.ravel()
im.filepath_raw = out
im.file_format = "PNG"
im.save()
print("wrote", out)
