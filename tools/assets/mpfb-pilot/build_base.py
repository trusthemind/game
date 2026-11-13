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


def build(sex):
    face = FACES[0]
    s = "male" if sex == "m" else "female"
    pheno = TargetService.get_default_macro_info_dict()
    pheno.update(BODIES["average"])
    pheno.update(gender=1.0 if sex == "m" else 0.0, age=face["age"], cupsize=0.5, firmness=0.5)
    a, c, as_ = face["race"]
    pheno["race"] = {"african": a, "caucasian": c, "asian": as_}
    info = HumanService._create_default_human_info_dict()
    info.update(phenotype=pheno, rig="game_engine", eyes="low-poly.mhclo", eyebrows=face["brow"] + ".mhclo", eyelashes="eyelashes01.mhclo",
                targets=face_targets(face["seed"] + (0 if sex == "m" else 100)), skin_mhmat="", skin_material_type="NONE",
                eyes_material_type="NONE", name=f"{sex}_base")
    settings = HumanService.get_default_deserialization_settings()
    settings.update(subdiv_levels=0, load_clothes=False)
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

    # Decimate the body to the budget, UV-seam vertices protected, then copy the full mesh's normals back so the
    # collapse leaves no shading creases (shoulders / neck).
    budget = TRI_BUDGET - 60 - sum(tri_count(o) for o in others if "trunks" not in o.name.lower() and "panties" not in o.name.lower() and "top" not in o.name.lower())
    ref = body.copy()
    ref.data = body.data.copy()
    bpy.context.collection.objects.link(ref)
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
    bpy.data.objects.remove(ref, do_unlink=True)

    # Materials: skin (body + anatomy share it), eyes, brows / lashes, solid fabric underwear.
    skin_path = AssetService.find_asset_absolute_path(face["skin"].format(s=s) + ".mhmat", "skins")
    skin = simple_material("skin_" + face["skin"].format(s=s), mhmat_texture(skin_path), rough=0.55)
    uwm = solid("underwear_fabric", UW_COLOR[sex])
    groups = {"body": [body], "anatomy": [anatomy] if anatomy else [], "underwear": [], "eyes": [], "brows": []}
    for o in [body] + others:
        n = o.name.lower()
        o.data.materials.clear()
        if o is body or o is anatomy:
            o.data.materials.append(skin)
        elif "lash" in n:
            p = AssetService.find_asset_absolute_path("eyelashes01.mhmat", "eyelashes")
            o.data.materials.append(simple_material("lashes", mhmat_texture(p), alpha=True, rough=0.8))
            groups["brows"].append(o)
        elif "brow" in n:
            p = AssetService.find_asset_absolute_path(face["brow"] + ".mhmat", "eyebrows")
            o.data.materials.append(simple_material("brows_" + face["brow"], mhmat_texture(p), alpha=True, rough=0.8))
            groups["brows"].insert(0, o)
        elif "eye" in n or "low-poly" in n:
            p = os.path.join(MPFB_USER, "eyes", "materials", face["eyes"] + ".mhmat")
            o.data.materials.append(simple_material("eyes_" + face["eyes"], mhmat_texture(p), rough=0.2))
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
        if not child:
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
