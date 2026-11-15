"""Skin texture set for the MPFB base bodies (exec'd by build_base.py inside Blender; bpy + numpy only).

Cycles bakes on the decimated body (the full-res mesh, subdivided once, as the high poly):
  tangent normal (high -> low), AO, pointiness (high -> low), object-space position + normal (for 3D region masks).
Then numpy composites, all 2048:
  albedo  tone-neutral: a flat base at the game's TEX_SKIN (#a67350, what humanBodyMaterial tints relative to) times the
          CC0 MakeHuman skin photo's local detail (photo / its blur: pores, lips, nipples, navel), with the painted scalp
          stubble removed, plus procedural layers: blotchy hue variation, freckles/blemishes, faint veins, lip / nail
          colour, cheeks / nose / ears / knees / elbows / knuckles / toes redness, a male stubble hint, cavity + soft AO.
  normal  baked tangent normal + tiled procedural pore / micro-crease detail (UDN blend).
  orm     R = baked AO, G = roughness (skin 0.5, T-zone lower, lips 0.34, nails 0.3, joints higher), B = 0.
Eyes: the CC0 iris texture with an off-white sclera and a socket falloff; brows / lashes darkened, alpha thickened.
"""
import bpy, numpy as np, os
from mathutils import Vector

TEXN = 2048
TEX_SKIN_SRGB = np.array([0xa6, 0x73, 0x50], np.float32) / 255.0


def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


TEX_SKIN = s2l(TEX_SKIN_SRGB)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def box(a, r):
    """Box blur (radius r px) along both image axes, edge-clamped; 3 passes ~ gaussian."""
    if r < 1:
        return a
    for ax in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[ax] = (r + 1, r)
        p = np.pad(a, pad, mode="edge")
        c = np.cumsum(p, axis=ax, dtype=np.float64)
        n = a.shape[ax]
        a = ((np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, np.arange(0, n), axis=ax)) / (2 * r + 1)).astype(np.float32)
    return a


def blur(a, r):
    for _ in range(3):
        a = box(a, max(1, int(r / 1.7)))
    return a


def _hash(ix, iy, iz):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFF).astype(np.float32) / 65535.0


def vnoise(P, f):
    """Trilinear value noise at points P (N,3) metres, frequency f (1/m), in [0,1]."""
    q = P * f
    i = np.floor(q).astype(np.int64)
    t = q - i
    t = t * t * (3 - 2 * t)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)
    return out


def fbm(P, f, oct=3):
    s, a, tot = 0, 1.0, 0
    for k in range(oct):
        s = s + a * vnoise(P + k * 17.3, f * 2 ** k)
        tot += a
        a *= 0.5
    return s / tot


def img_np(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def save_png(arr, path, name, non_color=False, alpha=False):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :arr.shape[2]] = arr
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def _cycles():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.render.threads_mode = "AUTO"
    sc.render.bake.margin = 24
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bake_world")
    sc.world.light_settings.distance = 0.25
    return sc


def _bake_mat(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs[0])
    build(nt, em)
    return m


def _target(obj, img):
    m = obj.active_material
    nt = m.node_tree
    t = nt.nodes.get("bake_target") or nt.nodes.new("ShaderNodeTexImage")
    t.name = "bake_target"
    t.image = img
    nt.nodes.active = t


def _bake(sc, kind, body, img, high=None, samples=1):
    sc.cycles.samples = samples
    _target(body, img)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    if high:
        high.select_set(True)
    bpy.context.view_layer.objects.active = body
    kw = dict(type=kind, margin=24, use_clear=True)
    if high:
        kw.update(use_selected_to_active=True, cage_extrusion=0.004 if "brow" not in img.name else 0.03,
                  max_ray_distance=0.01 if "brow" not in img.name else 0.05)
    if kind == "NORMAL":
        kw.update(normal_space="TANGENT")
    print("BAKE start", kind, img.name, flush=True)
    bpy.ops.object.bake(**kw)
    print("BAKE done", kind, img.name, flush=True)


def bake_skin(sex, body, ref, rig, others, out_dir):
    """Returns paths {albedo, normal, orm, eye(optional)} of the 2048 skin set."""
    os.makedirs(out_dir, exist_ok=True)
    sc = _cycles()
    keep_mats = list(body.data.materials)
    hidden = []
    for o in others:
        n = o.name.lower()
        if not ("eye" in n or "low-poly" in n) or "brow" in n or "lash" in n:
            hidden.append((o, o.hide_render))
            o.hide_render = True
    # High poly: the full-res body, subdivided once.
    high = ref

    def new_img(n, f=True):
        im = bpy.data.images.new(n, TEXN, TEXN, float_buffer=f, alpha=True)
        im.colorspace_settings.name = "Non-Color"
        im.generated_color = (0, 0, 0, 0)
        return im

    def set_mat(o, m):
        o.data.materials.clear()
        o.data.materials.append(m)

    # ASHFALL_BAKE_CACHE=<dir>: the raw Cycles bakes are saved there (<sex>.npz); with ASHFALL_REUSE_BAKE=1 they are
    # loaded from it instead (iterate on the compositing below in seconds, not minutes; same mesh only).
    cache_dir = os.environ.get("ASHFALL_BAKE_CACHE")
    cache = os.path.join(cache_dir, f"{sex}.npz") if cache_dir else None
    if cache and os.environ.get("ASHFALL_REUSE_BAKE") == "1" and os.path.exists(cache):
        print("BAKE reuse", cache, flush=True)
        for o, h in hidden:
            o.hide_render = h
        return _composite(sex, body, rig, others, out_dir, {k: v.astype(np.float32) for k, v in np.load(cache).items()})
    # 1. position (object space) and normal of the low mesh -> 3D region masks.
    def pos_nodes(nt, em):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(tc.outputs["Object"], em.inputs["Color"])
    def nrm_nodes(nt, em):
        g = nt.nodes.new("ShaderNodeNewGeometry")
        vm = nt.nodes.new("ShaderNodeVectorMath")
        vm.operation = "MULTIPLY_ADD"
        vm.inputs[1].default_value = (0.5, 0.5, 0.5)
        vm.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(g.outputs["Normal"], vm.inputs[0])
        nt.links.new(vm.outputs[0], em.inputs["Color"])
    def point_nodes(nt, em):
        g = nt.nodes.new("ShaderNodeNewGeometry")
        nt.links.new(g.outputs["Pointiness"], em.inputs["Color"])
    imgs = {}
    # Object coordinates may be negative: offset into [0, 1) via +2 / 4 (body is within +-2 m).
    def pos_off(nt, em):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        vm = nt.nodes.new("ShaderNodeVectorMath")
        vm.operation = "MULTIPLY_ADD"
        vm.inputs[1].default_value = (0.25, 0.25, 0.25)
        vm.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(tc.outputs["Object"], vm.inputs[0])
        nt.links.new(vm.outputs[0], em.inputs["Color"])
    set_mat(body, _bake_mat("bake_pos", pos_off))
    imgs["pos"] = new_img("b_pos")
    _bake(sc, "EMIT", body, imgs["pos"])
    set_mat(body, _bake_mat("bake_nrm", nrm_nodes))
    imgs["nrm"] = new_img("b_nrm")
    _bake(sc, "EMIT", body, imgs["nrm"])
    # 2. AO of the low mesh in place (eyes in, garments out).
    set_mat(body, _bake_mat("bake_ao", lambda nt, em: None))
    imgs["ao"] = new_img("b_ao")
    hr = high.hide_render
    high.hide_render = True
    _bake(sc, "AO", body, imgs["ao"], samples=128)
    high.hide_render = hr
    # 3. high -> low: tangent normal, pointiness.
    set_mat(high, _bake_mat("bake_point", point_nodes))
    imgs["nmap"] = new_img("b_nmap")
    _bake(sc, "NORMAL", body, imgs["nmap"], high=high, samples=4)
    imgs["point"] = new_img("b_point")
    _bake(sc, "EMIT", body, imgs["point"], high=high)
    # Brow cards -> painted brows in the albedo too (the thin cards alone barely read at game distance).
    brows = [o for o in others if "brow" in o.name.lower()]
    if brows:
        bm_ = _bake_mat("bake_brow", lambda nt, em: None)
        nt = bm_.node_tree
        em = [n for n in nt.nodes if n.type == "EMISSION"][0]
        src_img = bpy.data.images.load(bpy.context.scene["ashfall_brow_png"], check_existing=True)
        tx = nt.nodes.new("ShaderNodeTexImage")
        tx.image = src_img
        nt.links.new(tx.outputs["Alpha"], em.inputs["Color"])
        keep_b = list(brows[0].data.materials)
        brows[0].data.materials.clear()
        brows[0].data.materials.append(bm_)
        hb = brows[0].hide_render
        brows[0].hide_render = False
        imgs["brow"] = new_img("b_brow")
        sc.render.bake.max_ray_distance = 0.03
        _bake(sc, "EMIT", body, imgs["brow"], high=brows[0])
        brows[0].hide_render = hb
        brows[0].data.materials.clear()
        for m in keep_b:
            brows[0].data.materials.append(m)
    for o, h in hidden:
        o.hide_render = h
    body.data.materials.clear()
    for m in keep_mats:
        body.data.materials.append(m)

    A = {k: img_np(v) for k, v in imgs.items()}
    for im in imgs.values():
        bpy.data.images.remove(im)
    if cache:
        os.makedirs(cache_dir, exist_ok=True)
        np.savez(cache, **{k: (v if k == "pos" else v.astype(np.float16)) for k, v in A.items()})
    return _composite(sex, body, rig, others, out_dir, A)


def _composite(sex, body, rig, others, out_dir, A):
    valid = A["pos"][..., 3] > 0.5
    P = (A["pos"][..., :3] - 0.5) * 4.0
    N = A["nrm"][..., :3] * 2 - 1
    N /= np.linalg.norm(N, axis=-1, keepdims=True) + 1e-6
    ao = np.where(valid, A["ao"][..., 0], 1.0)
    point = A["point"][..., 0]
    H, W = valid.shape
    Pf = P.reshape(-1, 3)

    # ── landmarks (MPFB rest, Blender Z-up, the body faces -Y) ──
    mw = rig.matrix_world
    bone = lambda n: np.array(mw @ rig.data.bones[n].head_local)
    tail = lambda n: np.array(mw @ rig.data.bones[n].tail_local)
    V = np.array([body.matrix_world @ v.co for v in body.data.vertices])
    head = bone("head")
    top = V[:, 2].max()
    hv = V[V[:, 2] > head[2] - 0.08]
    eyes = [o for o in others if ("eye" in o.name.lower() or "low-poly" in o.name.lower()) and "brow" not in o.name.lower() and "lash" not in o.name.lower()]
    ev = np.array([o.matrix_world @ v.co for o in eyes for v in o.data.vertices])
    eye_z = ev[:, 2].mean()
    eye_x = np.abs(ev[:, 0]).mean()
    eye_y = ev[:, 1].min()
    mid = hv[(np.abs(hv[:, 0]) < 0.006) & (hv[:, 2] < eye_z - 0.01) & (hv[:, 2] > eye_z - 0.07)]
    nose = mid[np.argmin(mid[:, 1])]
    side = hv[(hv[:, 2] > eye_z - 0.04) & (hv[:, 2] < eye_z + 0.01)]
    ear = side[np.argmax(np.abs(side[:, 0]))]
    ear_x, ear_y, ear_z = abs(ear[0]), ear[1], ear[2]
    mouth = np.array([0, nose[1] + 0.012, nose[2] - 0.03])
    # The lips' seam: down the midline profile below the nose, the most recessed point between the two lips' fronts.
    prof = hv[(np.abs(hv[:, 0]) < 0.004) & (hv[:, 2] < nose[2] - 0.01) & (hv[:, 2] > nose[2] - 0.055) & (hv[:, 1] < nose[1] + 0.04)]
    seam_z = mouth[2]
    if len(prof) > 8:
        zs = np.arange(nose[2] - 0.052, nose[2] - 0.012, 0.0015)
        fy = np.array([prof[np.abs(prof[:, 2] - zz) < 0.0015][:, 1].min() if np.any(np.abs(prof[:, 2] - zz) < 0.0015) else np.nan for zz in zs])
        ok = ~np.isnan(fy)
        zs, fy = zs[ok], fy[ok]
        if len(zs) > 6:
            iu = np.argmin(np.where(zs > nose[2] - 0.034, fy, 9))   # upper lip's front
            il = np.argmin(np.where(zs < nose[2] - 0.026, fy, 9))   # lower lip's front
            lo_, hi_ = sorted((iu, il))
            if hi_ - lo_ >= 2:
                seam_z = zs[lo_ + np.argmax(fy[lo_:hi_ + 1])]
    if abs(seam_z - mouth[2]) > 0.015:
        seam_z = mouth[2]
    mouth[2] = seam_z
    chin_z = nose[2] - 0.07
    print("BAKE landmarks", sex, dict(top=round(top, 3), nose=np.round(nose, 3).tolist(), eye_z=round(eye_z, 3),
          eye_x=round(eye_x, 3), eye_y=round(eye_y, 3), seam_z=round(float(seam_z), 4), ear=np.round(ear, 3).tolist(), head=np.round(head, 3).tolist()), flush=True)

    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    ax = np.abs(x)
    ny = N[..., 1]
    inhead = smooth(chin_z - 0.03, chin_z + 0.0, z)
    front = smooth(-0.1, -0.5, ny) * (y < ear_y + 0.0)

    def sph(c, r, sym=True):
        cx = np.abs(c[0]) if sym else c[0]
        d = np.sqrt(((ax if sym else x) - cx) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2)
        return smooth(r, r * 0.25, d)

    def near(c, r, sym=True):
        return sph(c, r, sym)

    def joint(n, r, at_tail=False):
        p = tail(n) if at_tail else bone(n)
        return sph(p, r)

    # Scalp: the head above a hairline that runs from the forehead (front) down to the nape (back).
    hair_z = np.where(y < ear_y - 0.02, eye_z + 0.055, ear_z - 0.035 + 0.09 * smooth(ear_y + 0.03, ear_y - 0.03, y))
    scalp = inhead * smooth(hair_z - 0.004, hair_z + 0.02, z)
    # Lips: an ellipse round the seam with a fairly crisp vermilion border (the upper lip thinner than the lower),
    # narrowing to the corners.
    lz = z - mouth[2]
    lips_d = np.sqrt((ax / 0.024) ** 2 + (lz / np.where(lz > 0, 0.0072, 0.0098)) ** 2)
    lips_m = smooth(1.0, 0.72, lips_d) * front * smooth(chin_z - 0.03, chin_z + 0.0, z)
    # The seam itself (the shadow between the lips) and the corners.
    lip_line = np.exp(-(lz / 0.0011) ** 2) * smooth(0.025, 0.012, ax) * front
    lip_corner = np.exp(-(((ax - 0.023) / 0.004) ** 2 + (lz / 0.0025) ** 2)) * front
    # The eyes: the lids / socket round each eyeball, and the band under it.
    eye_c = (eye_x, eye_y + 0.006, eye_z)
    socket = sph(eye_c, 0.026) * front
    under_eye = np.exp(-(((ax - eye_x) / 0.016) ** 2 + ((z - (eye_z - 0.014)) / 0.0055) ** 2)) * front * (y < eye_y + 0.02)
    cheeks = near((eye_x + 0.012, nose[1] + 0.035, eye_z - 0.035), 0.035) * front
    nose_m = near((0, nose[1], nose[2] + 0.005), 0.022, sym=False) * front
    ears_m = near((ear_x, ear_y, ear_z), 0.035) * inhead
    elbows = joint("lowerarm_l", 0.045)
    knees = joint("calf_l", 0.06)
    hands = joint("hand_l", 0.11, at_tail=True)
    knuck = sph(bone("middle_01_l"), 0.035) if "middle_01_l" in rig.data.bones else 0
    feet = smooth(bone("foot_l")[2] + 0.03, bone("foot_l")[2] - 0.03, z)
    toes = sph(bone("ball_l"), 0.06) if "ball_l" in rig.data.bones else feet
    nails = 0
    for f in ["thumb", "index", "middle", "ring", "pinky"]:
        n3 = f"{f}_03_l"
        if n3 in rig.data.bones:
            nails = np.maximum(nails, sph(tail(n3) + (tail(n3) - bone(n3)) * 0.1, 0.009) * (N[..., 2] * 0 + 1))
    # Nails sit on the back of the finger tip: top-facing in the A/T rest pose.
    nails = nails * smooth(0.1, 0.6, N[..., 2])
    toe_nails = sph(bone("ball_l") + np.array([0, -0.045, 0.012]) if "ball_l" in rig.data.bones else head * 0 + 9, 0.03) * smooth(0.2, 0.7, N[..., 2])
    def seg(a, b, r):
        a = np.array([abs(a[0]), a[1], a[2]]); b = np.array([abs(b[0]), b[1], b[2]])
        Q = np.stack([ax, y, z], -1)
        ab = b - a
        t = np.clip(((Q - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(Q - (a + t[..., None] * ab), axis=-1)
        return smooth(r, r * 0.6, d), t
    fa, ft = seg(bone("lowerarm_l"), bone("hand_l"), 0.06)
    forearm = fa * smooth(0.2, 0.55, ft)
    stubble = 0
    if sex == "m":
        jaw = smooth(nose[2] - 0.004, nose[2] - 0.016, z) * smooth(chin_z - 0.035, chin_z - 0.005, z) * inhead
        jaw *= smooth(ear_y + 0.005, ear_y - 0.025, y)                 # forward of the ear
        jaw *= 1 - np.clip(lips_m * 1.4, 0, 1)
        neckb = smooth(chin_z - 0.035, chin_z - 0.06, z) * smooth(head[2] - 0.05, head[2] - 0.01, z) * smooth(-0.2, -0.6, ny)
        upper = smooth(nose[2] - 0.006, nose[2] - 0.014, z) * smooth(mouth[2] + 0.006, mouth[2] + 0.01, z) * (ax < 0.03) * front
        stubble = np.clip(jaw + upper + neckb * 0.5, 0, 1) * valid

    # ── albedo ──
    photo_path = bpy.context.scene.get("ashfall_skin_photo")
    ph = img_np(bpy.data.images.load(photo_path, check_existing=True))[..., :3]
    if ph.shape[0] != H:
        raise RuntimeError("skin photo must be %d" % H)
    ph = s2l(ph)
    lo = blur(ph, 28)
    det = np.clip(ph / (lo + 1e-4), 0.55, 1.6)
    # Painted scalp stubble out, keep only mild pore detail there.
    # ... and the painted pubic hair (a dark smudge under the underwear toggle).
    th = bone("thigh_l")
    pubic = sph((0, th[1] - 0.08, th[2] - 0.04), 0.13, sym=False) * smooth(-0.1, -0.5, ny)
    # ... and the photo's eye makeup / lid shadow (read as dark, sunken eyes on the women).
    det = det ** (1 - np.clip(0.85 * scalp + pubic + 0.65 * socket, 0, 1)[..., None])
    det = det ** 0.85
    base = np.broadcast_to(TEX_SKIN, (H, W, 3)).copy()
    Pv = Pf
    hue = fbm(Pv, 9.0).reshape(H, W) - 0.5
    blot = fbm(Pv + 3.1, 28.0).reshape(H, W) - 0.5
    alb = base * det
    # Blotchy hue/value variation: redder / yellower patches.
    # (Gentler on the face, the women's most: there the blotches read as bruises under the cheekbones.)
    face = front * inhead
    bk = 0.07 * (1 - face * (0.65 if sex == "f" else 0.4))
    alb *= 1 + np.stack([0.10, 0.02, -0.06]) * hue[..., None] * 1.4 + (bk * blot)[..., None]
    red = np.array([1.12, 0.86, 0.84])
    def tint(mask, col, k=1.0):
        nonlocal alb
        m = np.clip(mask * k, 0, 1)[..., None]
        alb = alb * (1 - m + m * np.array(col))
    tint(cheeks, red, 0.55)
    tint(nose_m, red, 0.5)
    tint(ears_m, red, 0.45)
    tint(elbows, red, 0.35)
    tint(knees, red, 0.45)
    tint(hands, [1.07, 0.92, 0.9], 0.6)
    tint(knuck if np.ndim(knuck) else np.zeros_like(z), red, 0.45)
    tint(toes, red, 0.45)
    tint(lips_m, [1.22, 0.74, 0.76], 0.8 if sex == "f" else 0.55)
    tint(lip_line, [0.55, 0.42, 0.42], 0.6)
    tint(lip_corner, [0.8, 0.68, 0.68], 0.45)
    # Under the eyes: a faint cool shadow (tired, lived-in, not bruised).
    tint(under_eye, [0.95, 0.9, 0.95], 0.45 if sex == "m" else 0.3)
    # Pores: tiny darker dots over the face (the nose and cheeks most), a texel or two each.
    pn = vnoise(Pv + 4.4, 1100.0).reshape(H, W)
    pores = smooth(0.62, 0.8, pn) * face * (0.6 + 0.4 * np.clip(nose_m + cheeks, 0, 1)) * (1 - lips_m)
    tint(pores, [0.93, 0.91, 0.91], 0.7)
    tint(nails, [1.25, 1.1, 1.1], 0.9)
    tint(toe_nails, [1.2, 1.08, 1.08], 0.7)
    # Freckles / blemishes: sparse small spots, mostly face / shoulders / forearms.
    spots = smooth(0.72, 0.8, vnoise(Pv + 7.7, 420.0).reshape(H, W)) * smooth(0.5, 0.75, fbm(Pv + 1.3, 6.0).reshape(H, W))
    tint(spots * (0.5 + 0.5 * front + 0.6 * forearm), [0.86, 0.8, 0.78], 0.6)
    # Veins: thin ridged noise on the forearms / backs of the hands / feet.
    rv = 1 - np.abs(fbm(Pv + 5.5, 38.0, 2).reshape(H, W) - 0.5) * 2
    veins = smooth(0.9, 0.97, rv) * np.clip(forearm + hands * 0.8 + feet * 0.6, 0, 1)
    tint(veins, [0.9, 0.94, 1.04], 0.55)
    if sex == "m":
        # Stubble shadow: a cool grey-blue cast over the jaw / lip / throat, with dark hair-tip dots in it.
        speck = vnoise(Pv + 9.1, 1500.0).reshape(H, W)
        dots = smooth(0.5, 0.78, vnoise(Pv + 3.3, 2600.0).reshape(H, W))
        tint(stubble, [0.86, 0.87, 0.9], 0.8)
        tint(stubble * (0.35 * speck + 0.65 * dots), [0.72, 0.73, 0.77], 0.7)
    if "brow" in A:
        bw = np.clip(blur(A["brow"][..., 0], 2) * 1.6, 0, 1) * inhead * front
        # Only a neutral shade under the brow cards (which take the hair colour in game): a painted dark brow stayed
        # dark on blondes and redheads.
        alb = alb * (1 - 0.4 * bw[..., None])
    # Cavity (pointiness from the high poly) and a little AO into the base colour.
    pv = point[valid]
    pm, ps = np.median(pv), pv.std() + 1e-6
    cav = np.clip((point - pm) / ps, -3, 3)
    cav = blur(cav, 2)
    cavd = np.clip(1 + 0.05 * np.minimum(cav, 0.6), 0.8, 1.03)
    # (Less AO round the eyes: the ORM occlusion darkens the sockets again in game.)
    aok = 0.38 * (1 - 0.55 * socket)
    alb *= (cavd * (1 - aok + aok * ao ** 1.3))[..., None]
    # Muscle separation / form shading from the baked normal map's curvature (valleys darker, crests a hair lighter),
    # the painted-in definition stylised-realistic bodies carry.
    nmb = A["nmap"][..., :3] * 2 - 1
    nxb, nyb = blur(nmb[..., 0], 3), blur(nmb[..., 1], 3)
    div = (np.roll(nxb, -3, 1) - np.roll(nxb, 3, 1)) + (np.roll(nyb, -3, 0) - np.roll(nyb, 3, 0))
    div = blur(np.where(valid, div, 0), 4)
    dv = div[valid]
    div = np.clip(div / (dv.std() * 2.5 + 1e-6), -1, 1) * (1 - inhead)  # body only: on the face it read as blotches
    alb *= (1 + 0.22 * np.minimum(div, 0) + 0.05 * np.maximum(div, 0))[..., None]
    # Renormalise so the mean of plain skin is TEX_SKIN (the game tints relative to it).
    plain = valid & (lips_m < 0.1) & (nails < 0.1) & (stubble < 0.1 if np.ndim(stubble) else True)
    mean = alb[plain].mean(axis=0)
    alb *= (TEX_SKIN / mean)[None, None, :]
    print("BAKE albedo mean before renorm (sRGB)", np.round(l2s(mean) * 255).tolist(), flush=True)
    alb = np.where(valid[..., None], alb, TEX_SKIN)
    albedo = save_png(l2s(alb), os.path.join(out_dir, "albedo.png"), f"{sex}_albedo")

    # ── normal: baked + pores / micro-creases ──
    nm = A["nmap"][..., :3] * 2 - 1
    nm[~valid] = (0, 0, 1)
    rng = np.random.default_rng(7 if sex == "m" else 8)
    pore = blur(rng.random((H, W)).astype(np.float32), 1) - 0.5
    pore2 = blur(rng.random((H, W)).astype(np.float32), 3) - 0.5
    hmap = pore * 0.7 + pore2 * 0.25
    s = (0.55 + 0.85 * front * inhead + 0.35 * nose_m + 0.25 * cheeks) * (1 - 0.8 * lips_m) * (1 - nails) * valid
    hmap *= s
    gx = (np.roll(hmap, -1, 1) - np.roll(hmap, 1, 1)) * 0.35
    gy = (np.roll(hmap, -1, 0) - np.roll(hmap, 1, 0)) * 0.35
    nx = nm[..., 0] - gx
    nyy = nm[..., 1] - gy
    nz = nm[..., 2]
    L = np.sqrt(nx * nx + nyy * nyy + nz * nz) + 1e-6
    nmo = np.stack([nx / L, nyy / L, nz / L], -1) * 0.5 + 0.5
    normal = save_png(nmo, os.path.join(out_dir, "normal.png"), f"{sex}_normal", non_color=True)

    # ── ORM ──
    rough = np.full((H, W), 0.53, np.float32)
    tzone = (near((0, nose[1] + 0.02, eye_z + 0.04), 0.035, sym=False) + nose_m) * front
    rough -= 0.08 * np.clip(tzone, 0, 1)
    rough += 0.07 * np.clip(elbows + knees + toes * 0.5, 0, 1) + 0.04 * hands
    rough = rough * (1 - lips_m) + 0.32 * lips_m
    rough = rough * (1 - nails) + 0.28 * nails
    rough += 0.04 * (fbm(Pv + 2.2, 60.0, 2).reshape(H, W) - 0.5) + 0.02 * np.maximum(-cav, 0) * 0.3
    rough += 0.04 * scalp
    occ = np.clip(0.25 + 0.75 * ao, 0, 1)
    occ = occ + (1 - occ) * 0.5 * socket
    orm = np.stack([occ, np.clip(rough, 0.2, 0.8), np.zeros_like(occ)], -1)
    orm = save_png(orm, os.path.join(out_dir, "orm.png"), f"{sex}_orm", non_color=True)
    return dict(albedo=albedo, normal=normal, orm=orm)


def eye_texture(src_png, out_path):
    img = bpy.data.images.load(src_png, check_existing=True)
    a = img_np(img)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h  # v from the bottom (Blender pixel order)
    rgb = s2l(a[..., :3])
    lum = rgb.mean(-1)
    out = rgb.copy()
    for cu, cv in ((0.707, 1 - 0.297), (0.29, 1 - 0.71)):
        d = np.sqrt((u - cu) ** 2 + (v - cv) ** 2)
        iris = smooth(0.125, 0.105, d)
        sclera = (1 - iris) * (d < 0.3)
        # A clean off-white, slightly warm sclera (the photo's is greyish), shading only a little towards the corners
        # (more read as dark, sunken eyes in game).
        sc_col = np.array([0.80, 0.76, 0.72])
        out = out * (1 - sclera[..., None] * 0.6) + sc_col * (sclera * 0.6)[..., None]
        out *= (1 - 0.14 * smooth(0.14, 0.28, d) * (d < 0.3))[..., None]
        # Iris: more contrast in its fibres, a lighter ring round the pupil, a dark limbal ring.
        im_ = iris[..., None]
        loc = blur(out, 6)
        out = out * (1 - im_) + np.clip(loc + (out - loc) * 1.6, 0, 1) * im_
        # ... a little lighter and less red (the brown iris read near-black, the eyes as dark holes).
        il = out.mean(-1, keepdims=True)
        out = out * (1 - im_) + np.clip((out * 0.8 + il * 0.2) * 1.3, 0, 1) * im_
        out *= (1 + 0.35 * np.exp(-((d - 0.06) / 0.018) ** 2) * iris)[..., None]
        out *= (1 - 0.55 * np.exp(-((d - 0.118) / 0.007) ** 2))[..., None]
        # A painted catchlight (the wet highlight; the game's lights rarely put one there): up and to one side.
        hl = np.exp(-(((u - (cu - 0.03)) ** 2 + (v - (cv + 0.035)) ** 2) / 0.012 ** 2))
        out = out * (1 - 0.7 * hl[..., None]) + 0.9 * 0.7 * hl[..., None]
    a[..., :3] = l2s(out)
    im = bpy.data.images.new("eye_tex", w, h, alpha=True)
    im.pixels.foreach_set(a.ravel())
    im.filepath_raw = out_path
    im.file_format = "PNG"
    im.save()
    return im


def hair_card_texture(src_png, out_path, col, alpha_pow=0.6, dilate=0):
    """Brows / lashes: dark hair colour, alpha thickened so they read at game distance."""
    img = bpy.data.images.load(src_png, check_existing=True)
    a = img_np(img)
    lum = a[..., :3].mean(-1, keepdims=True)
    a[..., :3] = np.array(col) * (0.6 + 0.8 * lum)
    a[..., 3] = np.clip(a[..., 3], 0, 1) ** alpha_pow
    if dilate:
        # Fuller brows: the strands' coverage spread a few texels (the game multiplies alpha up; this fills the gaps
        # between strands into a brow shape instead of a few thin hairs).
        al = a[..., 3]
        a[..., 3] = np.maximum(al, np.clip(blur(al, dilate) * 2.2, 0, 1) * 0.85)
    im = bpy.data.images.new(os.path.basename(out_path), a.shape[1], a.shape[0], alpha=True)
    im.pixels.foreach_set(a.ravel())
    im.filepath_raw = out_path
    im.file_format = "PNG"
    im.save()
    return im


def skin_material(name, tex):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    def tnode(img, nc):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        if nc:
            img.colorspace_settings.name = "Non-Color"
        return t
    ta = tnode(tex["albedo"], False)
    nt.links.new(ta.outputs["Color"], b.inputs["Base Color"])
    tn = tnode(tex["normal"], True)
    nmn = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nmn.inputs["Color"])
    nt.links.new(nmn.outputs["Normal"], b.inputs["Normal"])
    to = tnode(tex["orm"], True)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = 0.0
    # Faux subsurface: a warm, soft sheen lobe (KHR_materials_sheen) -> reddish soft rim at grazing angles.
    b.inputs["Sheen Weight"].default_value = 1.0
    b.inputs["Sheen Tint"].default_value = (0.55, 0.22, 0.16, 1)
    b.inputs["Sheen Roughness"].default_value = 0.55
    b.inputs["IOR"].default_value = 1.5
    # glTF occlusion: the exporter reads the "glTF Material Output" group's Occlusion socket.
    grp = bpy.data.node_groups.get("glTF Material Output")
    if grp is None:
        grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = grp
    nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])
    return m


def eye_material(img):
    m = bpy.data.materials.new("eyes_wet")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.25
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.03
    return m


def card_material(name, img, rough=0.75):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = rough
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    return m
