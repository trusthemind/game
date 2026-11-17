"""Image-to-3D head (refs/ai/3d/*.glb, local only) -> a compact npz for ai3d_fit.py: the mesh turned into our frame
(Blender Z-up, metres-ish, face towards -Y, as build_identities' humans), triangles, per-corner UVs, per-vertex
albedo, and its PBR textures unpacked as PNGs next to the npz.

Blender --background --python ai3d_prep.py -- <in.glb> <out_dir> [yaw_deg]
(yaw: the turn about Z that brings the model's face to -Y; Tripo's faces +X: -90.)
"""
import bpy, os, sys, math
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], os.path.abspath(argv[1])
YAW = float(argv[2]) if len(argv) > 2 else 0.0
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
o = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
me = o.data
me.calc_loop_triangles()
n = len(me.vertices)
V = np.zeros(n * 3, np.float32)
me.vertices.foreach_get("co", V)
V = V.reshape(-1, 3)
mw = np.array(o.matrix_world, np.float64)
V = (V @ mw[:3, :3].T + mw[:3, 3]).astype(np.float32)
a = math.radians(YAW)
R = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]], np.float32)
V = V @ R.T
nt = len(me.loop_triangles)
T = np.zeros(nt * 3, np.int32)
me.loop_triangles.foreach_get("vertices", T)
L = np.zeros(nt * 3, np.int32)
me.loop_triangles.foreach_get("loops", L)
uvd = me.uv_layers.active.data
UV = np.zeros(len(me.loops) * 2, np.float32)
uvd.foreach_get("uv", UV)
UV = UV.reshape(-1, 2)
FUV = UV[L].reshape(-1, 3, 2)
T = T.reshape(-1, 3)
imgs = {}
for im in bpy.data.images:
    nm = im.name.lower()
    k = "normal" if "normal" in nm else "orm" if ("orm" in nm or "rough" in nm or "metal" in nm) else "color"
    p = os.path.join(OUT, f"{k}.png")
    im.filepath_raw = p
    im.file_format = "PNG"
    im.save()
    imgs[k] = im
    print("PREP image", k, im.name, tuple(im.size), flush=True)
# per-vertex albedo (one corner's UV per vertex)
ci = imgs["color"]
W, H = ci.size
px = np.zeros(W * H * 4, np.float32)
ci.pixels.foreach_get(px)
px = px.reshape(H, W, 4)
vuv = np.zeros((n, 2), np.float32)
vuv[T.reshape(-1)] = FUV.reshape(-1, 2)
xs = np.clip((vuv[:, 0] % 1) * W, 0, W - 1).astype(int)
ys = np.clip((vuv[:, 1] % 1) * H, 0, H - 1).astype(int)
VC = px[ys, xs, :3]
np.savez(os.path.join(OUT, "mesh.npz"), V=V, T=T, FUV=FUV, VC=VC)
print("PREP", n, "verts", len(T), "tris", "bbox", V.min(0), V.max(0), flush=True)
