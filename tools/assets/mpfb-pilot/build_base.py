"""MPFB2 base bodies (m_average_0 / f_average_0 of gen_cast.py) for the game: T-posed to our skeleton's bone directions,
with separate toggleable mesh groups body / anatomy / underwear / eyes / brows (brows + lashes).

Blender --background --python build_base.py -- <out_dir> [m|f|all]
then: node fix_skeleton.mjs <out_dir>   (our joint names, rest rotations, leaf bones, height; see there)

Licensed sources only (see report): body, eyes, brows, lashes, skins, rig weights and the male `helper-genital`
fallback geometry are MakeHuman system assets / hm08 base mesh (CC0). Underwear: wolgade_female_panties_01 +
wolgade_female_top_01 (underwear01 pack, CC0), mindfront_male_swimming_trunks_01 (pants03 pack, CC BY 4.0, Mindfront).
Optional `anatomy` group (nude toggle): CC0 community assets from files.makehumancommunity.org, licence- and
derivation-checked in anatomy/PROVENANCE.json -- male 'man genital' (nid 3223), female genital patch cut from 'Female
generic with simplified genitals (fixed)' (nid 3396). Without those sources: male hm08 helper-genital, female none.
"""
import bpy, bmesh, os, sys, json, math
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else os.path.join(HERE, "base"))
BASE_SEXES = ["m", "f"] if (len(argv) < 2 or argv[1] == "all") else [argv[1]]
TRI_BUDGET = 22000
SRC = os.path.expanduser("~/.cache/ashfall-src/mpfb")
UNDERWEAR = {
    "m": [os.path.join(SRC, "x-p03/clothes/mindfront_male_swimming_trunks_01/mindfront_male_swimming_trunks_01.mhclo")],
    "f": [os.path.join(SRC, "x-uw01/clothes/wolgade_female_panties_01/wolgade_female_panties_01.mhclo"),
          os.path.join(SRC, "x-uw01/clothes/wolgade_female_top_01/wolgade_female_top_01.mhclo")],
}
UW_COLOR = {"m": (0.10, 0.11, 0.12, 1), "f": (0.13, 0.13, 0.14, 1)}
GENITAL = range(15128, 15328)  # hm08 'helper-genital' vertex indices (basemesh_vertex_groups.json)
# Optional nude anatomy (CC0 community assets; provenance + licence check in anatomy/PROVENANCE.json). Male: the
# standalone 'man genital' mhclo (nid 3223); female: the genital patch cut out of the 'Female generic with simplified
# genitals (fixed)' full-body proxy (nid 3396). Missing source -> male falls back to hm08 helper-genital, female none.
ANAT_SRC = os.path.expanduser("~/.cache/ashfall-src/anatomy")
ANATOMY = {"m": os.path.join(ANAT_SRC, "m3223/man_genital.mhclo"),
           "f": os.path.join(ANAT_SRC, "f3396/female_generic_with_simplified_genitals_fixed.proxy")}
ANAT_OFFSET = 0.0012  # m outward, so the patch never z-fights the body under it
os.makedirs(OUT, exist_ok=True)
# Athletic survivor build (macros + measure / muscle targets) and a deliberate face per sex, instead of the pilot's
# 'average' macros + seeded face noise (read as a smooth, bland mannequin).
BUILD = {
    "m": dict(macro=dict(weight=0.5, muscle=0.7, height=0.5, proportions=0.9),
              targets=[("torso-vshape-incr", 0.3), ("torso-muscle-pectoral-incr", 0.35),
                       ("torso-muscle-dorsi-incr", 0.3), ("stomach-pregnant-decr", 0.25),
                       ("measure-neck-circ-incr", 0.35), ("buttocks-volume-incr", 0.1)]
              + [(f"{s}-{t}", v) for s in "lr" for t, v in [("upperarm-muscle-incr", 0.45), ("upperarm-shoulder-muscle-incr", 0.4),
                 ("lowerarm-muscle-incr", 0.35), ("upperleg-muscle-incr", 0.5), ("lowerleg-muscle-incr", 0.0)]],
              # Face tuned to the London Face Set's male medians (refs/face_targets.json, measure_face.mjs): the stock head's
              # nose / upper lip were long and the chin short (mouth low in the face), the eyes narrow slits.
              face=[("head-square", 0.45), ("chin-prominent-incr", 0.3), ("chin-width-incr", 0.3), ("chin-jaw-drop-incr", 0.1),
                    ("head-fat-decr", 0.3), ("nose-scale-horiz-incr", 0.35), ("nose-point-width-decr", 0.1), ("mouth-scale-horiz-decr", 0.15), ("chin-height-decr", 0.4),
                    ("nose-scale-vert-decr", 0.6), ("nose-trans-up", 0.3), ("mouth-trans-up", 1.0), ("forehead-temple-decr", 0.2)]
                   + [(f"{s}-{t}", v) for s in "lr" for t, v in [("cheek-bones-incr", 0.35), ("cheek-volume-decr", 0.3),
                      ("eye-height2-incr", 0.7), ("eye-scale-incr", 0.1), ("eye-trans-down", 0.6)]],
              skin="young_caucasian_male", eyes="brownlight", brow="eyebrow011", lashes="eyelashes02"),
    "f": dict(macro=dict(weight=0.52, muscle=0.55, height=0.5, proportions=0.9, cupsize=0.7, firmness=1.0),
              targets=[("torso-vshape-incr", 0.1), ("stomach-pregnant-decr", 0.15), ("buttocks-volume-incr", 0.3),
                       ("measure-shoulder-dist-incr", 0.35), ("breast-trans-up", 0.3), ("breast-point-decr", 0.2), ("measure-thigh-circ-incr", 0.35),
                       ("measure-neck-circ-incr", 0.3), ("l-leg-valgus-decr", 0.4), ("r-leg-valgus-decr", 0.4)]
              + [(f"{s}-{t}", v) for s in "lr" for t, v in [("upperarm-muscle-incr", 0.25), ("upperarm-shoulder-muscle-incr", 0.45),
                 ("lowerarm-muscle-incr", 0.2), ("upperleg-muscle-incr", 0.3), ("lowerleg-muscle-incr", 0.35)]],
              # (Hollow cheeks under high cheekbones read as dark blotches there in game; bigger eyes as dark ones.)
              # Face tuned to the London Face Set's female medians (refs/face_targets.json, measure_face.mjs): the stock head
              # was wide and short for its eyes, with narrow eyes, a long nose, a small mouth and low-set brows.
              face=[("head-oval", 0.5), ("chin-width-decr", 0.1), ("chin-prominent-incr", 0.1), ("head-fat-decr", 0.15),
                    ("head-scale-horiz-decr", 0.25), ("chin-height-incr", 0.15), ("mouth-trans-down", 0.3), ("nose-point-width-decr", 0.1),
                    ("nose-scale-vert-decr", 0.6), ("mouth-scale-horiz-incr", 0.25), ("eyebrows-trans-up", 0.3),
                    ("mouth-upperlip-volume-incr", 0.1), ("mouth-lowerlip-volume-incr", 0.45)]
                   + [(f"{s}-{t}", v) for s in "lr" for t, v in [("cheek-bones-incr", 0.25), ("cheek-volume-incr", 0.1), ("eye-scale-incr", 0.35),
                      ("eye-trans-down", 0.4), ("eye-trans-out", 0.4)]],
              skin="young_caucasian_female", eyes="brownlight", brow="eyebrow010", lashes="eyelashes04"),
}
TEX_DIR = os.path.join(HERE, "base", "tex")

# Reuse the pilot's macro / face definitions (everything above its export loop).
src = open(os.path.join(HERE, "gen_cast.py"), encoding="utf-8").read()
sys.argv = [sys.argv[0], "--", OUT]
exec(compile(src.split("\nreport = []")[0], "gen_cast.py", "exec"))

# Our skeleton (apps/web/public/models/human_*.glb, glTF Y-up) for the T-pose bone directions.
OURS = json.load(open(os.path.join(HERE, "ours.json")))
AIM = {"pelvis": "spine_01", "spine_01": "spine_02", "spine_02": "spine_03", "spine_03": "neck_01", "neck_01": "Head"}
for s in "lr":
    AIM.update({f"clavicle_{s}": f"upperarm_{s}", f"upperarm_{s}": f"lowerarm_{s}", f"lowerarm_{s}": f"hand_{s}",
                f"hand_{s}": f"middle_01_{s}", f"thigh_{s}": f"calf_{s}", f"calf_{s}": f"foot_{s}", f"foot_{s}": f"ball_{s}",
                f"ball_{s}": f"ball_leaf_{s}"})
    for f in ["thumb", "index", "middle", "ring", "pinky"]:
        AIM[f"{f}_01_{s}"] = f"{f}_02_{s}"
        AIM[f"{f}_02_{s}"] = f"{f}_03_{s}"
        AIM[f"{f}_03_{s}"] = f"{f}_04_leaf_{s}"
TO_MPFB = {"Head": "head", "root": "Root"}
# The spine, neck and clavicles keep MPFB's own (natural, upright) rest directions: swinging them to the old body's
# bone directions bent the torso into a deep sway-back with the head pushed forward and the shoulders pulled back.
# Our clips are rotation-only on fixed rest rotations (fix_skeleton.mjs), so they play the same on either spine shape;
# only the limbs (A-pose -> T-pose) need the swing.
# deg about the lateral axis, + = flexion (forward); see the T-pose loop. "" -> off.
POSTURE = {k: float(v) for k, v in (kv.split(":") for kv in os.environ.get("ASHFALL_POSTURE", "spine_02:-3,spine_03:-8,neck_01:-16").split(",") if kv)}
CLAV_BACK = float(os.environ.get("ASHFALL_CLAV_BACK", "10"))  # deg, see the T-pose loop
NO_AIM = {"pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "clavicle_l", "clavicle_r"}
def export(rig, path):
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for c in rig.children:
        c.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_skins=True,
                              export_morph=False, export_animations=False, export_image_format="WEBP", export_image_quality=88,
                              export_tangents=True, export_yup=True)


exec(compile(open(os.path.join(HERE, "skin_bake.py"), encoding="utf-8").read(), "skin_bake.py", "exec"))
# Body shape fitted to the averaged real scans (fit_scan.py; ASHFALL_FIT_SCAN=0 -> the plain MPFB macro body).
exec(compile(open(os.path.join(HERE, "fit_scan.py"), encoding="utf-8").read(), "fit_scan.py", "exec"))
FIT_SCAN = os.environ.get("ASHFALL_FIT_SCAN", "1") == "1"
FIT_DEBUG = os.environ.get("ASHFALL_FIT_DEBUG")  # dir for scan / posed-body OBJs (silhouette overlays)


def ours_dir(sex, a, b):
    p = OURS[f"../../apps/web/public/models/human_{sex}.glb"]["pos"]
    d = Vector(p[b]) - Vector(p[a])
    return Vector((d.x, -d.z, d.y)).normalized()  # glTF Y-up -> Blender Z-up


def solid(name, rgba, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Roughness"].default_value = rough
    return m


def keep_only(obj, idx):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in idx], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def apply_mod(obj, name):
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=name)


def finish_anatomy(sex, obj, body, crotch):
    """Fitted + weighted anatomy asset -> the `anatomy` group: (female) only the genital patch of the full-body proxy,
    body UVs transferred so the same skin material / tint matches, pushed a hair outward off the skin."""
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons([v.co for v in body.data.vertices], [p.vertices for p in body.data.polygons])
    lo = Vector((min(c.x for c in crotch), min(c.y for c in crotch), min(c.z for c in crotch)))
    hi = Vector((max(c.x for c in crotch), max(c.y for c in crotch), max(c.z for c in crotch)))
    print("ANAT crotch box", sex, tuple(round(x, 3) for x in lo), tuple(round(x, 3) for x in hi), flush=True)
    if sex == "f":
        # The proxy is a whole body; keep the part that leaves the body surface around the pubic area (the simplified
        # labia) plus two rings of faces, whose outer edge lies on the skin -> seamless patch.
        cx = (lo.x + hi.x) / 2
        def in_box(co, m):
            return abs(co.x - cx) < 0.05 + m and lo.z - 0.04 - m < co.z < hi.z - 0.02 + m and co.y < hi.y + 0.06 + m
        me = obj.data
        dev = [(bvh.find_nearest(v.co)[3] or 0.0) for v in me.vertices]
        keep = {v.index for v in me.vertices if dev[v.index] > 0.0015 and in_box(v.co, 0.0)}
        print("ANAT seed verts", len(keep), "max dev", round(max(dev[i] for i in keep), 4) if keep else 0, flush=True)
        adj = {}
        for e in me.edges:
            a, b = e.vertices
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
        for _ in range(2):
            keep |= {n for i in keep for n in adj.get(i, ()) if in_box(me.vertices[n].co, 0.03)}
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(v.index in keep for v in f.verts)], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(me)
        bm.free()
    for p in obj.data.polygons:
        p.use_smooth = True
    dt = obj.modifiers.new("uv_from_body", "DATA_TRANSFER")
    dt.object = body
    dt.use_loop_data = True
    dt.data_types_loops = {"UV"}
    dt.loop_mapping = "POLYINTERP_NEAREST"
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_move_to_index(modifier="uv_from_body", index=0)
    apply_mod(obj, "uv_from_body")
    obj.data.update()
    for v in obj.data.vertices:
        v.co += v.normal * ANAT_OFFSET
    if sex == "m":
        # The asset's pubic flange was fitted to a slimmer crotch and stands off our skin as a jagged band: sink every
        # vertex that sits within 6 mm (40 mm at the sides) of the skin to just under it, so only the protruding part shows.
        n_sunk = 0
        for v in obj.data.vertices:
            co, nrm, _, d = bvh.find_nearest(v.co)
            s = (v.co - co).dot(nrm)
            lim = 0.04 if abs(v.co.x) > 0.026 else 0.006  # lateral flange corners stand off further
            if -0.001 < s < lim:
                v.co = co - nrm * 0.001
                n_sunk += 1
        # Faces now wholly under the skin only add tris (and poke through the thighs in motion): drop them.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        under = lambda v: (v.co - bvh.find_nearest(v.co)[0]).dot(bvh.find_nearest(v.co)[1]) < 0
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(under(v) for v in f.verts)], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        print("ANAT m sunk", n_sunk, flush=True)
    obj.name = "anatomy"
    print("ANAT", sex, "verts", len(obj.data.vertices), "tris", tri_count(obj), flush=True)
    return obj


def definition_normals(info, settings, weight=0.0):
    """Vertex normals of the same human at max muscle / min weight (helpers removed, as the body), or None."""
    import copy
    i2 = copy.deepcopy(info)
    i2["phenotype"].update(muscle=1.0, weight=weight)
    i2["name"] = "def_tmp"
    before = set(bpy.data.objects)
    bm = HumanService.deserialize_from_dict(i2, settings)
    bpy.context.view_layer.objects.active = bm
    TargetService.bake_targets(bm)
    for mod in list(bm.modifiers):
        if mod.type == "MASK":
            apply_mod(bm, mod.name)
    bm.data.update()
    out = [v.normal.copy() for v in bm.data.vertices]
    for o in [o for o in bpy.data.objects if o not in before]:
        bpy.data.objects.remove(o, do_unlink=True)
    return out


def build(sex):
    face = FACES[0]
    cfg = BUILD[sex]
    pheno = TargetService.get_default_macro_info_dict()
    pheno.update(BODIES["average"])
    pheno.update(gender=1.0 if sex == "m" else 0.0, age=0.5, cupsize=0.5, firmness=0.5)
    pheno.update(cfg["macro"])
    pheno["race"] = {"african": 0.15, "caucasian": 0.7, "asian": 0.15}
    info = HumanService._create_default_human_info_dict()
    info.update(phenotype=pheno, rig="game_engine", eyes="low-poly.mhclo", eyebrows=cfg["brow"] + ".mhclo", eyelashes=cfg["lashes"] + ".mhclo",
                targets=[{"target": t, "value": v} for t, v in cfg["targets"] + cfg["face"]], skin_mhmat="", skin_material_type="NONE",
                eyes_material_type="NONE", name=f"{sex}_base")
    settings = HumanService.get_default_deserialization_settings()
    settings.update(subdiv_levels=0, load_clothes=False)
    def_normals = definition_normals(info, settings, 0.0 if sex == "m" else 0.3)
    basemesh = HumanService.deserialize_from_dict(info, settings)
    rig = basemesh.parent
    bpy.context.view_layer.objects.active = basemesh
    for p in UNDERWEAR[sex]:
        HumanService.add_mhclo_asset(p, basemesh, asset_type="Clothes", subdiv_levels=0, material_type="NONE")
    anat_src = None
    if os.path.exists(ANATOMY[sex]):
        anat_src = HumanService.add_mhclo_asset(ANATOMY[sex], basemesh, asset_type="Clothes", subdiv_levels=0, material_type="NONE")
    TargetService.bake_targets(basemesh)
    crotch = [basemesh.data.vertices[i].co.copy() for i in GENITAL]
    # Underwear must not cut the body away (it's a toggle): drop the clothes' delete masks, keep the helper mask.
    for mod in list(basemesh.modifiers):
        if mod.type == "MASK" and mod.vertex_group.startswith("Delete."):
            basemesh.modifiers.remove(mod)
    anatomy = None
    if sex == "m" and anat_src is None:
        anatomy = basemesh.copy()
        anatomy.data = basemesh.data.copy()
        bpy.context.collection.objects.link(anatomy)
        for mod in list(anatomy.modifiers):
            if mod.type == "MASK":
                anatomy.modifiers.remove(mod)
        keep_only(anatomy, set(GENITAL))
        anatomy.name = "anatomy"
    for mod in list(basemesh.modifiers):
        if mod.type == "MASK":
            apply_mod(basemesh, mod.name)
    body = basemesh
    if anat_src is not None:
        anatomy = finish_anatomy(sex, anat_src, body, crotch)
    others = [o for o in rig.children if o.type == "MESH" and o is not body]
    if anatomy and anatomy not in others:
        others.append(anatomy)
    pre_fit_normals = fit_to_scan(sex, body, rig, others, FIT_DEBUG, info, settings) if FIT_SCAN else None
    if os.environ.get("ASHFALL_VARIANTS"):  # dir: fitted body + MPFB weight / muscle macro deltas, for measuring
        export_variants(sex, body, info, settings, os.environ["ASHFALL_VARIANTS"])
    if os.environ.get("ASHFALL_FIT_ONLY") == "1":
        raise SystemExit(0)

    # Decimate the body to the budget, UV-seam vertices protected, then copy the full mesh's normals back so the
    # collapse leaves no shading creases (shoulders / neck).
    budget = TRI_BUDGET - 60 - sum(tri_count(o) for o in others if "trunks" not in o.name.lower() and "panties" not in o.name.lower() and "top" not in o.name.lower())
    ref = body.copy()
    ref.data = body.data.copy()
    bpy.context.collection.objects.link(ref)
    # High poly for the normal bake: this mesh, shaded with the normals of the max-muscle / min-fat version of the same
    # human pushed further (muscle separation, abs, serratus, ...), so the definition lands in the normal map without
    # changing the silhouette.
    if def_normals is not None and len(def_normals) == len(ref.data.vertices):
        for p in ref.data.polygons:
            p.use_smooth = True
        cur = [v.normal.copy() for v in ref.data.vertices]
        # (3.0 / 1.5 painted dark valleys round the pecs and shoulders -- dirt, not muscle; the muscle is in the mesh now.)
        DEF_K = 1.2 if sex == "m" else 0.7
        neck_z = (rig.matrix_world @ rig.data.bones["neck_01"].head_local).z
        ws = [DEF_K * min(1.0, max(0.0, (neck_z - v.co.z) / 0.06)) for v in ref.data.vertices]  # not on the face
        # Nor on the front of the chest: the max-muscle pecs' steep undersides tilted the normals there straight down
        # -> a black crescent under his pecs / her breasts in game light (it stayed with shadows and AO off).
        def chest_w(v, n):
            dz = neck_z - v.co.z
            band = min(1.0, max(0.0, (dz - 0.02) / 0.05)) * min(1.0, max(0.0, (0.36 - dz) / 0.06))
            return band * min(1.0, max(0.0, (-n.y - 0.1) / 0.3))
        ws = [w * (1 - chest_w(v, c)) for w, v, c in zip(ws, ref.data.vertices, cur)]
        # After the scan fit the definition is the max-muscle normals' offset from the pre-fit MPFB normals, carried
        # onto the fitted surface (not MPFB's own normals, which would paint the old silhouette back into the map).
        pre = pre_fit_normals if pre_fit_normals is not None and len(pre_fit_normals) == len(cur) else cur
        ref.data.normals_split_custom_set_from_vertices([(c + (d - p) * w).normalized() for c, d, p, w in zip(cur, def_normals, pre, ws)])
        print("DEF normals applied", len(cur), flush=True)
    else:
        print("DEF normals skipped", None if def_normals is None else len(def_normals), len(ref.data.vertices), flush=True)
    ratio = min(1.0, budget / tri_count(body))
    if ratio < 1.0:
        dec = body.modifiers.new("decimate", "DECIMATE")
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        uv = body.data.uv_layers.active.data
        seen = {}
        for loop in body.data.loops:
            seen.setdefault(loop.vertex_index, set()).add((round(uv[loop.index].uv[0], 4), round(uv[loop.index].uv[1], 4)))
        vg = body.vertex_groups.new(name="decimate_keep")
        vg.add([v for v, st in seen.items() if len(st) == 1], 1.0, "REPLACE")
        dec.vertex_group = vg.name
        dec.vertex_group_factor = 1000.0
        with bpy.context.temp_override(object=body, active_object=body):
            bpy.ops.object.modifier_move_to_index(modifier="decimate", index=0)
        apply_mod(body, "decimate")
        body.vertex_groups.remove(body.vertex_groups["decimate_keep"])
        for m in (body, ref):
            for p in m.data.polygons:
                p.use_smooth = True
        dt = body.modifiers.new("normals", "DATA_TRANSFER")
        dt.object = ref
        dt.use_loop_data = True
        dt.data_types_loops = {"CUSTOM_NORMAL"}
        dt.loop_mapping = "POLYINTERP_NEAREST"
        with bpy.context.temp_override(object=body, active_object=body):
            bpy.ops.object.modifier_move_to_index(modifier="normals", index=0)
        apply_mod(body, "normals")
    skin_path = AssetService.find_asset_absolute_path(cfg["skin"] + ".mhmat", "skins")
    bpy.context.scene["ashfall_skin_photo"] = mhmat_texture(skin_path)
    # An older skin of the same sex (same UV layout): its creases, for the folds at the joints (skin_bake.py).
    try:
        bpy.context.scene["ashfall_skin_photo_old"] = mhmat_texture(AssetService.find_asset_absolute_path(("old_caucasian_male" if sex == "m" else "old_caucasian_female") + ".mhmat", "skins"))
    except Exception as e:  # noqa: BLE001
        print("no old skin photo", e)
    bpy.context.scene["ashfall_brow_png"] = mhmat_texture(AssetService.find_asset_absolute_path(cfg["brow"] + ".mhmat", "eyebrows"))
    hair_col = (0.045, 0.03, 0.02) if sex == "m" else (0.06, 0.035, 0.022)
    bpy.context.scene["ashfall_hair_col"] = [float(c) for c in hair_col]
    tex = bake_skin(sex, body, ref, rig, others, os.path.join(TEX_DIR, sex))
    bpy.data.objects.remove(ref, do_unlink=True)

    # Materials: skin (body + anatomy share it), eyes, brows / lashes, solid fabric underwear.
    skin = skin_material("skin", tex)
    uwm = solid("underwear_fabric", UW_COLOR[sex])
    groups = {"body": [body], "anatomy": [anatomy] if anatomy else [], "underwear": [], "eyes": [], "brows": []}
    for o in [body] + others:
        n = o.name.lower()
        o.data.materials.clear()
        if o is body or o is anatomy:
            o.data.materials.append(skin)
        elif "lash" in n:
            p = mhmat_texture(AssetService.find_asset_absolute_path(cfg["lashes"] + ".mhmat", "eyelashes"))
            o.data.materials.append(card_material("lashes", hair_card_texture(p, os.path.join(TEX_DIR, sex, "lashes.png"), (0.045, 0.032, 0.024), 1.25 if sex == "m" else 1.7)))
            groups["brows"].append(o)
        elif "brow" in n:
            p = mhmat_texture(AssetService.find_asset_absolute_path(cfg["brow"] + ".mhmat", "eyebrows"))
            o.data.materials.append(card_material("brows", hair_card_texture(p, os.path.join(TEX_DIR, sex, "brows.png"), hair_col, 0.55 if sex == "m" else 0.75)))
            # A little off the skin: the decimated brow ridge swallowed parts of the cards (the men's brows read faint).
            for v in o.data.vertices:
                v.co += v.normal * 0.0012
            groups["brows"].insert(0, o)
        elif "eye" in n or "low-poly" in n:
            p = mhmat_texture(os.path.join(MPFB_USER, "eyes", "materials", cfg["eyes"] + ".mhmat"))
            o.data.materials.append(eye_material(eye_texture(p, os.path.join(TEX_DIR, sex, "eyes.png"))))
            groups["eyes"].append(o)
        else:
            o.data.materials.append(uwm)
            groups["underwear"].append(o)
            # A few mm off the skin: the decimated body is a little coarser than what the garment was fitted to.
            for v in o.data.vertices:
                v.co += v.normal * 0.004
    if anatomy and anatomy.parent is not rig:
        anatomy.parent = rig
    for o in [body] + others:
        if not any(m.type == "ARMATURE" for m in o.modifiers):
            am = o.modifiers.new("Armature", "ARMATURE")
            am.object = rig

    # T-pose: swing every bone (parents first) to point where ours points, then make that the rest pose.
    bpy.context.view_layer.update()
    pbs = rig.pose.bones
    order = []
    def walk(b):
        order.append(b.name)
        for ch in b.children:
            walk(ch)
    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    for name in order:
        ours_name = {"head": "Head", "Root": "root"}.get(name, name)
        child = AIM.get(ours_name)
        if name in POSTURE or (name == "head" and POSTURE):
            # Upright stance: MPFB's rest has the head forward of the shoulders and a rounded upper back (UBC: chest
            # up, neck over the shoulders); our clips add their own curl on top -> hunched in game. Extend the
            # thoracic spine and the neck about their joints (lateral axis), the head turned back by the sum so the
            # face still looks level.
            pb = pbs[name]
            bpy.context.view_layer.update()
            head = pb.head.copy()
            ang = POSTURE[name] if name in POSTURE else -sum(POSTURE.values())
            R = Matrix.Rotation(math.radians(ang), 4, "X")
            pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ pb.matrix
            bpy.context.view_layer.update()
            print("POSTURE", name, ang, "tail z/y", round(pb.tail.z, 3), round(pb.tail.y, 3), flush=True)
            continue
        if ours_name in ("clavicle_l", "clavicle_r") and CLAV_BACK:
            # Shoulders drawn back (retracted) round the clavicle's inner end: MPFB's rest shoulders sit ~8 cm ahead
            # of the hips (ours ~3.5); with our Idle that read as round-shouldered / hunched.
            pb = pbs[name]
            bpy.context.view_layer.update()
            head = pb.head.copy()
            R = Matrix.Rotation(math.radians(CLAV_BACK if name.endswith("_l") else -CLAV_BACK), 4, "Z")
            pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ pb.matrix
            continue
        if not child or ours_name in NO_AIM:
            continue
        child_m = TO_MPFB.get(child, child)
        pb = pbs[name]
        bpy.context.view_layer.update()
        head = pb.head.copy()
        tip = pbs[child_m].head.copy() if child_m in pbs else pb.tail.copy()
        v = tip - head
        if v.length < 1e-6:
            continue
        q = v.normalized().rotation_difference(ours_dir(sex, ours_name, child))
        pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()
    for o in [body] + others:
        for m in list(o.modifiers):
            if m.type == "ARMATURE":
                apply_mod(o, m.name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    # Leaf bones at the finger / toe tips (ours has *_04_leaf_* and ball_leaf_*; no weights).
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    for s_ in "lr":
        for f in ["thumb", "index", "middle", "ring", "pinky"]:
            p = eb[f"{f}_03_{s_}"]
            leaf = eb.new(f"{f}_04_leaf_{s_}")
            leaf.head = p.tail
            leaf.tail = p.tail + (p.tail - p.head) * 0.5
            leaf.parent = p
        p = eb[f"ball_{s_}"]
        leaf = eb.new(f"ball_leaf_{s_}")
        leaf.head = p.tail
        leaf.tail = p.tail + (p.tail - p.head) * 0.5
        leaf.parent = p
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in [body] + others:
        am = o.modifiers.new("Armature", "ARMATURE")
        am.object = rig
        o.parent = rig

    # One object per group, named as the game expects.
    for g, objs in groups.items():
        objs = [o for o in objs if o]
        if not objs:
            continue
        if len(objs) > 1:
            with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
                bpy.ops.object.join()
        objs[0].name = g
        objs[0].data.name = g
    rig.name = f"human_{sex}_mpfb"
    tris = {o.name: tri_count(o) for o in rig.children if o.type == "MESH"}
    return rig, tris


report = {}
for sex in BASE_SEXES:
    clear_scene()
    rig, tris = build(sex)
    path = os.path.join(OUT, f"human_{sex}_mpfb.glb")
    export(rig, path)
    report[sex] = dict(tris=tris, total_without_underwear=sum(v for k, v in tris.items() if k != "underwear"), bones=len(rig.data.bones))
    print("BASE", sex, json.dumps(report[sex]), flush=True)
json.dump(report, open(os.path.join(OUT, f"report_{'_'.join(BASE_SEXES)}.json"), "w"), indent=1)
