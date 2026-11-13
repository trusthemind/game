"""MPFB2 pilot: generate a test cast and export each body to GLB.

Run headless:  Blender --background --python gen_cast.py -- <out_dir> <sex m|f|all> [limit]
Needs MPFB2 (extension, user_default repo) + the makehuman_system_assets pack in MPFB's user data dir.
"""
import bpy, os, sys, json, time, random, math

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "out")
SEXES = ["m", "f"] if (len(argv) < 2 or argv[1] == "all") else [argv[1]]
LIMIT = int(argv[2]) if len(argv) > 2 else 999
TARGET_TRIS = int(os.environ.get("MPFB_TRIS", "20000"))
TEX = 1024
os.makedirs(OUT, exist_ok=True)

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.objectservice import ObjectService

# Body types: macro sliders (0..1). age 0.5 = 25 y, 0.654 = 45 y in MakeHuman's age curve.
BODIES = {
    "slim":     dict(weight=0.05, muscle=0.35, height=0.52, proportions=0.60),
    "average":  dict(weight=0.50, muscle=0.50, height=0.50, proportions=0.50),
    "heavy":    dict(weight=1.00, muscle=0.30, height=0.48, proportions=0.30),
    "muscular": dict(weight=0.65, muscle=1.00, height=0.55, proportions=0.85),
    "tall":     dict(weight=0.45, muscle=0.55, height=0.80, proportions=0.70),
    "short":    dict(weight=0.55, muscle=0.50, height=0.22, proportions=0.40),
}
# Extra body targets on top of the macros (the macro sliders alone read weakly from the front).
BODY_TARGETS = {
    "slim": [("measure-waist-circ-decr", 0.5), ("torso-scale-horiz-decr", 0.2)],
    "heavy": [("stomach-pregnant-incr", 0.45), ("measure-waist-circ-incr", 0.7), ("measure-hips-circ-incr", 0.4), ("torso-scale-depth-incr", 0.4)],
    "muscular": [("torso-vshape-incr", 0.6), ("torso-muscle-pectoral-incr", 0.5), ("measure-shoulder-dist-incr", 0.5), ("torso-muscle-dorsi-incr", 0.5)],
}
# Face variants: ethnicity mix + skin + eyes + brows + age + seeded face-target noise.
FACES = [
    dict(race=(0.05, 0.90, 0.05), skin="young_caucasian_{s}", eyes="blue",      brow="eyebrow001", age=0.52, seed=11),
    dict(race=(0.90, 0.05, 0.05), skin="young_african_{s}",   eyes="brown",     brow="eyebrow006", age=0.56, seed=22),
    dict(race=(0.05, 0.10, 0.85), skin="young_asian_{s}",     eyes="brownlight", brow="eyebrow010", age=0.54, seed=33),
    dict(race=(0.25, 0.60, 0.15), skin="middleage_caucasian_{s}", eyes="green", brow="eyebrow003", age=0.64, seed=44),
]
FACE_TARGETS = [  # (decr/neg, incr/pos) pairs, symmetric ones get l-/r- prefixes
    ("nose-scale-horiz-decr", "nose-scale-horiz-incr"), ("nose-scale-vert-decr", "nose-scale-vert-incr"),
    ("nose-hump-decr", "nose-hump-incr"), ("nose-point-width-decr", "nose-point-width-incr"),
    ("chin-width-decr", "chin-width-incr"), ("chin-prominent-decr", "chin-prominent-incr"),
    ("chin-height-decr", "chin-height-incr"), ("mouth-scale-horiz-decr", "mouth-scale-horiz-incr"),
    ("mouth-lowerlip-volume-decr", "mouth-lowerlip-volume-incr"), ("mouth-upperlip-volume-decr", "mouth-upperlip-volume-incr"),
    ("head-scale-horiz-decr", "head-scale-horiz-incr"), ("head-fat-decr", "head-fat-incr"),
    ("%s-cheek-bones-decr", "%s-cheek-bones-incr"), ("%s-cheek-volume-decr", "%s-cheek-volume-incr"),
    ("%s-eye-scale-decr", "%s-eye-scale-incr"), ("%s-eye-height2-decr", "%s-eye-height2-incr"),
    ("eyebrows-trans-down", "eyebrows-trans-up"), ("eyebrows-angle-down", "eyebrows-angle-up"),
    ("%s-ear-scale-decr", "%s-ear-scale-incr"),
]
HEAD_SHAPES = ["head-oval", "head-square", "head-round", "head-rectangular", "head-diamond", "head-triangular"]

MPFB_USER = os.path.expanduser("~/Library/Application Support/Blender/5.3/extensions/.user/user_default/mpfb/data")


def face_targets(seed):
    rnd = random.Random(seed)
    out = []
    for neg, pos in FACE_TARGETS:
        v = rnd.uniform(-0.7, 0.7)
        name = pos if v > 0 else neg
        sides = ["l", "r"] if "%s" in name else [None]
        for s in sides:
            out.append({"target": name % s if s else name, "value": round(abs(v), 3)})
    out.append({"target": rnd.choice(HEAD_SHAPES), "value": round(rnd.uniform(0.3, 0.8), 3)})
    return out


def mhmat_texture(mhmat_path):
    for line in open(mhmat_path, encoding="utf-8", errors="ignore"):
        if line.startswith("diffuseTexture"):
            return os.path.join(os.path.dirname(mhmat_path), line.split(None, 1)[1].strip())
    return None


def simple_material(name, tex_path, alpha=False, rough=0.6):
    """Plain Principled BSDF + base colour texture (what the glTF exporter maps 1:1)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    if tex_path and os.path.isfile(tex_path):
        img = bpy.data.images.load(tex_path, check_existing=True)
        if max(img.size) > TEX:
            img.scale(TEX, int(TEX * img.size[1] / img.size[0]))
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
            if hasattr(m, "surface_render_method"):
                m.surface_render_method = "BLENDED"
    return m


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def build(sex, body, face_i):
    face = FACES[face_i]
    s = "male" if sex == "m" else "female"
    pheno = TargetService.get_default_macro_info_dict()
    pheno.update(BODIES[body])
    pheno["gender"] = 1.0 if sex == "m" else 0.0
    pheno["age"] = face["age"]
    pheno["cupsize"] = 0.5
    pheno["firmness"] = 0.5
    a, c, as_ = face["race"]
    pheno["race"] = {"african": a, "caucasian": c, "asian": as_}
    info = HumanService._create_default_human_info_dict()
    info.update(phenotype=pheno, rig="game_engine", eyes="low-poly.mhclo", eyebrows=face["brow"] + ".mhclo",
                targets=face_targets(face["seed"] + (0 if sex == "m" else 100)) + [{"target": t, "value": v} for t, v in BODY_TARGETS.get(body, [])],
                skin_mhmat="", skin_material_type="NONE", eyes_material_type="NONE", name=f"{sex}_{body}_{face_i}")
    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 0
    settings["load_clothes"] = False
    basemesh = HumanService.deserialize_from_dict(info, settings)
    rig = basemesh.parent
    # Bake macro + face targets, then drop helper geometry (apply the "Hide helpers" mask).
    bpy.context.view_layer.objects.active = basemesh
    TargetService.bake_targets(basemesh)
    for mod in list(basemesh.modifiers):
        if mod.type == "MASK":
            with bpy.context.temp_override(object=basemesh, active_object=basemesh):
                bpy.ops.object.modifier_apply(modifier=mod.name)
    raw_tris = tri_count(basemesh)
    ratio = min(1.0, TARGET_TRIS / max(1, raw_tris))
    if ratio < 1.0:
        dec = basemesh.modifiers.new("decimate", "DECIMATE")
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        # Keep UV-seam vertices (they carry >1 UV) out of the collapse, or the skin texture smears across seams.
        uv = basemesh.data.uv_layers.active.data
        seen = {}
        for loop in basemesh.data.loops:
            seen.setdefault(loop.vertex_index, set()).add((round(uv[loop.index].uv[0], 4), round(uv[loop.index].uv[1], 4)))
        vg = basemesh.vertex_groups.new(name="decimate_keep")
        vg.add([v for v, s in seen.items() if len(s) == 1], 1.0, "REPLACE")
        dec.vertex_group = vg.name
        dec.vertex_group_factor = 1000.0
        # Decimate must run before the armature modifier.
        with bpy.context.temp_override(object=basemesh, active_object=basemesh):
            bpy.ops.object.modifier_move_to_index(modifier="decimate", index=0)
            bpy.ops.object.modifier_apply(modifier="decimate")
    # Materials: basecolour-only Principled for skin, eyes, brows.
    skin_path = AssetService.find_asset_absolute_path(face["skin"].format(s=s) + ".mhmat", "skins")
    basemesh.data.materials.clear()
    basemesh.data.materials.append(simple_material(f"skin_{face['skin'].format(s=s)}", mhmat_texture(skin_path), rough=0.55))
    for child in rig.children:
        if child is basemesh or child.type != "MESH":
            continue
        child.data.materials.clear()
        n = child.name.lower()
        if ("eye" in n or "low-poly" in n or "high-poly" in n) and "brow" not in n:
            p = os.path.join(MPFB_USER, "eyes", "materials", face["eyes"] + ".mhmat")
            child.data.materials.append(simple_material("eyes_" + face["eyes"], mhmat_texture(p), rough=0.2))
        elif "brow" in n:
            p = AssetService.find_asset_absolute_path(face["brow"] + ".mhmat", "eyebrows")
            child.data.materials.append(simple_material("brow_" + face["brow"], mhmat_texture(p), alpha=True, rough=0.8))
    tris = {o.name: tri_count(o) for o in rig.children if o.type == "MESH"}
    return rig, raw_tris, tris


def export(rig, path):
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for c in rig.children:
        c.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_skins=True, export_morph=False, export_animations=False,
                              export_image_format="WEBP", export_yup=True)


report = []
n = 0
for sex in SEXES:
    for body in BODIES:
        for fi in range(len(FACES)):
            if n >= LIMIT:
                break
            n += 1
            clear_scene()
            t0 = time.time()
            rig, raw, tris = build(sex, body, fi)
            t1 = time.time()
            path = os.path.join(OUT, f"{sex}_{body}_{fi}.glb")
            export(rig, path)
            t2 = time.time()
            h = max((rig.matrix_world @ b.head_local).z for b in rig.data.bones)
            report.append(dict(file=os.path.basename(path), raw_body_tris=raw, tris=tris, build_s=round(t1 - t0, 2),
                               export_s=round(t2 - t1, 2), bones=len(rig.data.bones), size_kb=os.path.getsize(path) // 1024))
            print("PILOT", json.dumps(report[-1]), flush=True)
json.dump(report, open(os.path.join(OUT, f"report_{'_'.join(SEXES)}.json"), "w"), indent=1)
