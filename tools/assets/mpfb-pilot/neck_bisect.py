"""Neck / head bisect: the stock MPFB2 human vs every stage of our build, rendered with one camera and measured.

Stages per sex (all at the MPFB rest A-pose, Blender Z-up, metres):
  stock  -- MPFB defaults (gender only; average macros, no targets)
  macro  -- our build macros (BUILD[sex]["macro"]), no targets
  build  -- + our body targets and face targets (build_base.py BUILD)
  fit    -- + the scan fit (fit_scan.py)
  neck   -- + build_base.py neck_girth (the neck push)
  game   -- the shipped base GLB (base/human_<sex>_mpfb.glb: T-posed, posture, fix_skeleton)
Writes ai/neck/<sex>_<stage>_{profile,q34,front}.png + measures.json (head depth / height / breadth, neck depth /
width at mid-neck, bigonial width, chin-to-notch neck length, where the nape meets the skull).

Blender --background --python neck_bisect.py -- [m|f|all]
"""
import os, sys, json, math
import numpy as np
import bpy
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SEXES = ["m", "f"] if not argv or argv[0] == "all" else [argv[0]]
OUTD = os.path.join(HERE, "ai", "neck")
os.makedirs(OUTD, exist_ok=True)
# build_base.py's definitions (everything above its build loop), with its main loop cut off
_src = open(os.path.join(HERE, "build_base.py"), encoding="utf-8").read().split("\nreport = {}\nfor sex in BASE_SEXES:")[0]
sys.argv = [sys.argv[0], "--", os.path.join(OUTD, "_unused"), "m"]
exec(compile(_src, "build_base.py", "exec"))


def coords(o):
    a = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get("co", a)
    return (np.array(o.matrix_world)[:3, :3] @ a.reshape(-1, 3).T).T + np.array(o.matrix_world)[:3, 3]


def human(sex, stage):
    clear_scene()
    cfg = BUILD[sex]
    pheno = TargetService.get_default_macro_info_dict()
    pheno.update(gender=1.0 if sex == "m" else 0.0)
    targets = []
    if stage != "stock":
        pheno.update(BODIES["average"])
        pheno.update(gender=1.0 if sex == "m" else 0.0, age=0.5, cupsize=0.5, firmness=0.5)
        pheno.update(cfg["macro"])
        pheno["race"] = {"african": 0.15, "caucasian": 0.7, "asian": 0.15}
    if stage in ("build", "fit", "neck"):
        targets = cfg["targets"] + cfg["face"]
    info = HumanService._create_default_human_info_dict()
    info.update(phenotype=pheno, rig="game_engine", targets=[{"target": t, "value": v} for t, v in targets],
                skin_mhmat="", skin_material_type="NONE", name=f"{sex}_{stage}")
    settings = HumanService.get_default_deserialization_settings()
    settings.update(subdiv_levels=0, load_clothes=False)
    bm = HumanService.deserialize_from_dict(info, settings)
    rig = bm.parent
    bpy.context.view_layer.objects.active = bm
    TargetService.bake_targets(bm)
    for mod in list(bm.modifiers):
        if mod.type == "MASK":
            apply_mod(bm, mod.name)
    if stage in ("fit", "neck"):
        fit_to_scan(sex, bm, rig, [], None, info, settings)
    if stage == "neck":
        posture_for(sex)
        neck_girth(sex, bm, rig)
    if bm.data.shape_keys:  # the basis carries the shape: drop the keys so co is what we see
        bpy.context.view_layer.objects.active = bm
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    J = {b.name: np.array(rig.matrix_world @ b.head_local) for b in rig.data.bones}
    return coords(bm), [list(p.vertices) for p in bm.data.polygons], J


def game(sex):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "base", f"human_{sex}_mpfb.glb"))
    body = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.name.startswith("body"))
    rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    J = {b.name.replace("Head", "head"): np.array(rig.matrix_world @ b.head_local) for b in rig.data.bones}
    return coords(body), [list(p.vertices) for p in body.data.polygons], J


def measure(P, J):
    """Head / neck landmarks on a Z-up mesh facing -Y (MPFB) at its rest pose."""
    z_head = J["head"][2]
    z_neck = J["neck_01"][2]
    mid = np.abs(P[:, 0]) < 0.01
    def front_at(z):  # most-forward (min y) midline point at height z
        s = mid & (np.abs(P[:, 2] - z) < 0.004)
        return P[s, 1].min() if s.any() else np.nan
    def back_at(z):
        s = mid & (np.abs(P[:, 2] - z) < 0.004)
        return P[s, 1].max() if s.any() else np.nan
    top = P[:, 2].max()
    zs = np.arange(z_neck - 0.12, top, 0.003)
    fr = np.array([front_at(z) for z in zs])
    bk = np.array([back_at(z) for z in zs])
    # head: max sagittal depth above the head joint (glabella .. opisthocranion)
    hs = zs > z_head + 0.03
    head_depth = np.nanmax(bk[hs] - fr[hs])
    # chin (menton): the lowest point of the face's front where the profile jumps forward going up from the throat
    jump = np.nan_to_num(np.diff(-fr), nan=0)
    i_m = int(np.argmax(np.where((zs[1:] > z_neck - 0.02) & (zs[1:] < z_head + 0.03), jump, -1)))
    menton = zs[i_m]
    head_h = top - menton
    # sternal notch: the most-backward point of the front profile below the neck joint
    ln = (zs < z_neck) & (zs > z_neck - 0.12)
    notch = zs[ln][np.nanargmax(fr[ln])] if ln.any() else np.nan
    # neck at mid (between notch and menton): sagittal depth, breadth
    zm = (menton + notch) / 2
    s = (np.abs(P[:, 2] - zm) < 0.004) & (np.abs(P[:, 0]) < 0.09)
    neck_depth = P[s, 1].max() - P[s, 1].min() if s.any() else np.nan
    neck_w = P[s, 0].max() - P[s, 0].min() if s.any() else np.nan
    # bigonial: jaw breadth 2-4 cm above the menton, front half of the head only (the ears are behind)
    s = (P[:, 2] > menton + 0.02) & (P[:, 2] < menton + 0.04) & (P[:, 1] < J["head"][1] - 0.01)
    bigonial = P[s, 0].max() - P[s, 0].min() if s.any() else np.nan
    head_breadth = np.nanmax([np.ptp(P[(np.abs(P[:, 2] - z) < 0.004), 0]) for z in np.arange(z_head + 0.06, top - 0.02, 0.01)])
    # the nape: where the back profile, going up, turns out into the skull (occiput) -- its height above the menton
    bs = (zs > notch) & (zs < top)
    d = np.gradient(np.nan_to_num(bk, nan=0))
    occ = zs[bs][np.argmax(d[bs] > 0.004)] if bs.any() else np.nan
    return dict(head_depth=head_depth, head_h=head_h, head_breadth=head_breadth, neck_depth=neck_depth, neck_w=neck_w,
                bigonial=bigonial, neck_len_chin_notch=menton - notch, nape_turn_above_menton=occ - menton,
                neck_to_head_depth=neck_depth / head_depth, head_joint_above_menton=z_head - menton)


def render(P, F, J, tag):
    clear_scene()
    me = bpy.data.meshes.new(tag)
    me.from_pydata([tuple(p) for p in P], [], F)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(tag, me)
    bpy.context.collection.objects.link(o)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "SINGLE"
    sc.display.shading.single_color = (0.8, 0.62, 0.5)
    sc.render.resolution_x = sc.render.resolution_y = 420
    if sc.world is None:
        sc.world = bpy.data.worlds.new("w")
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 0.42
    c = Vector(J["neck_01"]) + Vector((0, 0, 0.06))
    for view, ang in (("profile", 90), ("q34", 45), ("front", 0)):
        a = math.radians(ang)
        d = Vector((-math.sin(a), -math.cos(a), 0))  # MPFB faces -y; profile from the figure's left
        cam.location = c + d * 3
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(OUTD, f"{tag}_{view}.png")
        bpy.ops.render.render(write_still=True)


res = {}
for sex in SEXES:
    for stage in ("stock", "macro", "build", "fit", "neck", "game"):
        P, F, J = game(sex) if stage == "game" else human(sex, stage)
        if stage == "game":  # glTF import: Z-up, but the figure faces -Y already (the importer converts)
            pass
        m = measure(P, J)
        res[f"{sex}_{stage}"] = {k: round(float(v) * (1000 if k not in ("neck_to_head_depth",) else 1), 1 if k != "neck_to_head_depth" else 3) for k, v in m.items()}
        print("NECKB", sex, stage, json.dumps(res[f"{sex}_{stage}"]), flush=True)
        render(P, F, J, f"{sex}_{stage}")
json.dump(res, open(os.path.join(OUTD, "measures.json"), "w"), indent=1)
