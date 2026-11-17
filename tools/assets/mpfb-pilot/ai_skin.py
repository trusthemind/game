"""Face skin, irises and brows of the AI-sheet identities (refs/ai; identities.json entries with an "ai" block),
exec'd by build_identities.py (needs skin_bake.py's helpers and its raster / crop).

Skin: the sheet's painted face projected onto our fitted head's face tile. Each texel's 3D point (the identity's
own mesh) goes to the sheet through thin-plate splines fitted on the landmark pairs of fit_ai.py (front view: x/z,
profile: y/z); the front is sampled at the point and its mirror and averaged (the sheets' one-sided key light out),
the profile covers the sides (cheeks, jaw, temples: by the normal), exposure-matched to the front where both see.
Then: hair, brows, eyes, a grey moustache (anything far from the face's skin colour) are filled from the skin
round them; the painting's light is taken out -- the luminance's broad gradient divided away, its mid-scale shading
(nose / socket shadows) compressed, the colour (warm cheeks, nose, ears, lips, under-eye, stubble / beard shadow)
kept -- and it becomes a ratio over the face's mean colour, divided by the base photo's own mid-scale pattern: the
game multiplies it onto whatever skin tone the look has, so the identity keeps its painting and the tone stays the
player's choice. Same encoding as skin_tile (RGB ratio / 2, A roughness).
"""


def _tps_fit(src, dst, lam=1e-6):
    src = np.asarray(src, np.float64)
    dst = np.asarray(dst, np.float64)
    n = len(src)
    d = np.linalg.norm(src[:, None] - src[None], axis=-1)
    K = np.where(d > 0, d * d * np.log(d + 1e-12), 0.0)
    P_ = np.hstack([np.ones((n, 1)), src])
    A = np.zeros((n + 3, n + 3))
    A[:n, :n] = K + lam * np.eye(n)
    A[:n, n:] = P_
    A[n:, :n] = P_.T
    b = np.zeros((n + 3, dst.shape[1]))
    b[:n] = dst
    w = np.linalg.solve(A, b)
    return src, w


def _tps_apply(T, q):
    src, w = T
    q = np.asarray(q, np.float64)
    d = np.linalg.norm(q[:, None] - src[None], axis=-1)
    K = np.where(d > 0, d * d * np.log(d + 1e-12), 0.0)
    return K @ w[:len(src)] + w[len(src)] + q @ w[len(src) + 1:]


def _sample(img, xy):
    """Bilinear sample of img (rows top-down, H x W x C) at pixel coords xy (N x 2); NaN outside."""
    H, W = img.shape[:2]
    x, y = xy[:, 0] - 0.5, xy[:, 1] - 0.5
    ok = (x >= 0) & (y >= 0) & (x < W - 1) & (y < H - 1)
    x0 = np.clip(np.floor(x).astype(int), 0, W - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, H - 2)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    v = (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)
    v[~ok] = np.nan
    return v


def _nblur(a, m, r):
    """Normalised blur: mean of a over the mask m (weights) within radius r."""
    num = blur(a * m[..., None], r)
    den = blur(m, r)[..., None]
    return num / np.maximum(den, 1e-5), den[..., 0]


def _fill(a, valid, radii=(2, 4, 8, 16, 32, 64)):
    """Masked texels from the valid ones round them (normalised convolution, finest scale that reaches)."""
    out = a.copy()
    todo = ~valid
    for r in radii:
        if not todo.any():
            break
        f, den = _nblur(a, valid.astype(np.float32), r)
        ok = todo & (den > 0.02)
        out[ok] = f[ok]
        todo &= ~ok
    if todo.any():
        out[todo] = a[valid].mean(0)
    return out


def ai_sheet(sid):
    img = bpy.data.images.load(os.path.join(HERE, "refs", "ai", f"sheet_{sid}_nb.png"), check_existing=True)
    a = img_np(img)[::-1, :, :3]  # rows top-down, as the sheet's pixel coords
    return s2l(np.ascontiguousarray(a))


def ai_skin_tile(sex, ident, base_photo, rect, P, N, M, lm):
    ai = ident["ai"]
    fit = AI_FIT[ai["sheet"]]
    C = fit["corr"]
    sheet = ai_sheet(ai["sheet"])
    TH_, TW_ = M.shape
    flat = P.reshape(-1, 3).astype(np.float64)
    nrm = N.reshape(-1, 3)
    nl = np.linalg.norm(nrm, axis=1) + 1e-9
    nrm = nrm / nl[:, None]
    Tf = _tps_fit([c[:2] for c in C["front"]], [c[2:] for c in C["front"]], 1e-7)
    Ts = _tps_fit([c[:2] for c in C["side"]], [c[2:] for c in C["side"]], 1e-7)
    # front: at the point and its mirror (averaged: the key light's side out)
    f1 = _sample(sheet, _tps_apply(Tf, flat[:, [0, 2]]))
    f2 = _sample(sheet, _tps_apply(Tf, np.stack([-flat[:, 0], flat[:, 2]], 1)))
    fr = np.where(np.isnan(f1), f2, np.where(np.isnan(f2), f1, (f1 + f2) / 2))
    sd = _sample(sheet, _tps_apply(Ts, flat[:, [1, 2]]))
    wf = smooth(0.2, 0.6, -nrm[:, 1])
    ws = smooth(0.3, 0.75, np.abs(nrm[:, 0])) * (1 - 0.6 * wf)
    ws = np.where(np.isnan(sd).any(1), 0, ws)
    wf = np.where(np.isnan(fr).any(1), 0, np.maximum(wf, 1e-3 * (ws == 0)))
    # the profile exposed to the front where both see
    def lch(c):
        l_ = np.log(np.maximum(c, 1e-4))
        return l_ - l_.mean(-1, keepdims=True), l_.mean(-1)
    cf, lf = lch(np.nan_to_num(fr, nan=1e-4))
    core = (wf > 0.8) & np.isfinite(fr).all(1) & (M.reshape(-1) > 0)
    ref_c, ref_l = np.median(cf[core], 0), np.median(lf[core])
    def skinlike(c):
        cc, ll = lch(np.nan_to_num(c, nan=1e-4))
        return (np.linalg.norm(cc - ref_c, axis=1) < 0.3) & (np.abs(ll - ref_l) < 1.6)
    both = (wf > 0.3) & (ws > 0.3) & (M.reshape(-1) > 0) & skinlike(fr) & skinlike(sd)
    if both.sum() > 50:
        g = np.nanmedian(fr[both], 0) / np.maximum(np.nanmedian(sd[both], 0), 1e-4)
        sd = sd * g
    print("AISKIN", ident["id"], "profile gain", np.round(g, 3) if both.sum() > 50 else None, "overlap", int(both.sum()), flush=True)
    col = (np.nan_to_num(fr) * wf[:, None] + np.nan_to_num(sd) * ws[:, None]) / np.maximum(wf + ws, 1e-6)[:, None]
    seen = ((wf + ws) > 1e-3).reshape(TH_, TW_) & (M > 0)
    col = col.reshape(TH_, TW_, 3).astype(np.float32)
    x, y, z = P[..., 0] - lm["mid"][0], P[..., 1] - lm["mid"][1], P[..., 2] - lm["mid"][2]
    ax = np.abs(x)
    front = smooth(-0.1, -0.5, N[..., 1] / (np.linalg.norm(N, axis=-1) + 1e-9)) * M
    # skin statistics: the cheeks under the eyes (always skin on these sheets)
    cheek = seen & (ax > 0.022) & (ax < 0.048) & (z < -0.018) & (z > -0.045) & (front > 0.3)
    lc = np.log(np.maximum(col, 1e-4))
    # reference: the front view's core (the cheeks alone sit in a socket's shadow on some sheets)
    core2 = seen & (wf.reshape(TH_, TW_) > 0.8) & (front > 0.5)
    mu = np.median(lc[core2 if core2.sum() > 200 else cheek], 0)
    sdv = np.maximum(lc[cheek].std(0), 0.05)
    chroma = lc - lc.mean(-1, keepdims=True)
    mu_c = mu - mu.mean()
    dch = np.linalg.norm((chroma - mu_c), axis=-1)
    dl = lc.mean(-1) - mu.mean()
    mouth_z = lm["mouth_dz"]
    beard = smooth(0.0, 0.012, -(z - (mouth_z + 0.03))) * (ai.get("beard", 0) > 0)
    # off-skin: hue / saturation far from the cheeks' (hair, a grey moustache, eye whites, irises); or much darker
    # (hair, brows) -- inside a beard's zone dark is beard shadow, kept (clamped below).
    # local darkness (thin dark strokes: brows, lashes, stray hair) -- the views' exposures differ, so not global
    Lr = lc.mean(-1)
    Lloc, _ = _nblur(Lr[..., None], seen.astype(np.float32), 6)
    dloc = Lr - Lloc[..., 0]
    tol = ai.get("chroma_tol", 0.4)
    off = (dch > tol) | ((dloc < -0.45) & (beard < 0.5)) | ((dl < -2.3) & (beard < 0.5)) | (dl > 2.0)
    socket = np.exp(-(((ax - lm["eye_x"]) / 0.019) ** 2 + (z / 0.014) ** 2)) * front
    browz = np.exp(-(((ax - lm["eye_x"]) / 0.03) ** 2 + ((z - 0.022) / 0.012) ** 2)) * front
    off |= (socket > 0.45) | ((browz > 0.35) & (dloc < -0.15))
    valid = seen & ~off
    # the face's own median chroma (the cheeks alone are its reddest part): a second pass against it
    mu_c = np.median(chroma[valid & (front > 0.3)], 0)
    dch = np.linalg.norm((chroma - mu_c), axis=-1)
    off = (dch > tol) | ((dloc < -0.45) & (beard < 0.5)) | ((dl < -2.3) & (beard < 0.5)) | (dl > 2.0) | (socket > 0.45) | ((browz > 0.35) & (dloc < -0.15))
    valid = seen & ~off
    v2 = np.zeros_like(valid)
    v2[1:-1, 1:-1] = valid[1:-1, 1:-1] & valid[:-2, 1:-1] & valid[2:, 1:-1] & valid[1:-1, :-2] & valid[1:-1, 2:]
    valid = v2
    if os.environ.get("AI_DEBUG"):
        np.savez_compressed(os.path.join(os.environ["AI_DEBUG"], f"{ident['id']}_dbg.npz"), col=col, seen=seen, valid=valid, off=off, cheek=cheek, dch=dch, dl=dl, wf=wf.reshape(TH_, TW_), ws=ws.reshape(TH_, TW_), P=P, N=N, M=M)
    lc0 = lc.copy()
    lc = _fill(lc, valid)
    # light out: luminance's broad gradient divided away, its mid-scale shading compressed; chroma kept
    L = lc.mean(-1, keepdims=True)
    ch = lc - L
    face = (M > 0).astype(np.float32)
    Lb, _ = _nblur(L, face, 40)
    Lm, _ = _nblur(L, face, 7)
    lum = (Lm - Lb) * ai.get("mid", 0.55) + (L - Lm) * 0.9
    ref = valid & (front > 0.3)
    lum = lum - np.median(lum[ref])
    ch = ch - np.median(ch[ref], 0)
    if ai.get("beard", 0) > 0:
        floor = np.where(beard[..., None] > 0.2, np.log(1 - 0.45 * ai["beard"]), -np.inf)
        lum = np.maximum(lum, floor)
    # painted highlights (a lit nose bridge, cheekbones) out: the game lights it
    lum = np.minimum(lum, 0.12) + 0.25 * np.maximum(lum - 0.12, 0)
    out = lum + np.clip(ch, -0.25, 0.3) * ai.get("chroma", 0.85)
    # the base photo's own mid-scale pattern divided out (the albedo the game tints carries it)
    pb = np.log(np.maximum(blur(crop(base_photo, rect), 6), 1e-4))
    pb = pb - np.median(pb[ref], 0)
    pbL = pb.mean(-1, keepdims=True)
    out = out - pbL * 0.4
    out = out - np.median(out[ref], 0)  # the face's median: ratio 1 (the look's own tone)
    # where the sheet shows no skin (hair over the temples / ears, filled holes): the base skin (ratio 1), feathered
    wv = smooth(0.35, 0.85, blur(valid.astype(np.float32), 5))
    small = blur(valid.astype(np.float32), 14) > 0.6  # holes inside the face (brows, nostrils): keep the fill
    wv = np.maximum(wv, small * 0.85)
    out = np.clip(out, -0.8, 0.5) * wv[..., None]
    # out: scalp, eye sockets (the eye mesh), tile edge (feathered)
    scalp = smooth(lm["eye_z"] + 0.05, lm["eye_z"] + 0.08, P[..., 2]) * M
    feather = smooth(0.55, 0.95, blur(M, 6))
    k = np.clip(0.9 * scalp + 0.8 * smooth(0.3, 0.7, socket), 0, 1)[..., None]
    out = out * (1 - k) * feather[..., None]
    # hue towards the sheet's at its suggested tone (identities.json ai.tone): the sheet's face chroma minus the
    # tone's, luminance untouched -- other tones get the same hue shift (documented: the identity keeps its hue).
    if ai.get("tone"):
        tl = s2l(np.array([int(ai["tone"][i:i + 2], 16) for i in (0, 2, 4)], np.float64) / 255.0)
        tch = np.log(tl) - np.log(tl).mean()
        sc = np.median(lc0[ref], 0)
        sch = sc - sc.mean()
        tsh = ((sch - tch) * ai.get("tone_k", 0.7))[None, None, :] * feather[..., None]
    else:
        tsh = 0.0
    # symmetric (the sheets' one-sided light, the braid / hair over one cheek): each texel and its mirror averaged,
    # matched by the 3D point (|x|, y, z) on a 1.5 mm grid; the profile-only zone toned down (one view, its own light)
    sideonly = (ws.reshape(TH_, TW_) > 0.5) & (wf.reshape(TH_, TW_) < 0.2)
    out = out * (1 - 0.4 * blur(sideonly.astype(np.float32), 4))[..., None]
    q = np.round(np.stack([np.abs(P[..., 0]), P[..., 1], P[..., 2]], -1).reshape(-1, 3) / 0.0015).astype(np.int64)
    inm = (M.reshape(-1) > 0)
    _, inv = np.unique(q[inm], axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    o2 = out.reshape(-1, 3)
    acc = np.zeros((inv.max() + 1, 3))
    cnt = np.zeros(inv.max() + 1)
    np.add.at(acc, inv, o2[inm])
    np.add.at(cnt, inv, 1)
    o2 = o2.copy()
    o2[inm] = acc[inv] / cnt[inv][:, None]
    out = blur(o2.reshape(TH_, TW_, 3).astype(np.float32), 1) + tsh
    ratio = np.exp(np.clip(out, np.log(0.45), np.log(1.7)))
    fr_ = float(ident.get("freckles", 0))
    rough = np.full((TH_, TW_), 0.5, np.float32)
    if fr_ > 0:
        seed = sum(ord(c) * (i + 1) for i, c in enumerate(ident["id"]))
        n = vnoise(P.reshape(-1, 3) + seed * 0.013, 900.0).reshape(TH_, TW_)
        n2 = fbm(P.reshape(-1, 3) + 3.3, 40.0).reshape(TH_, TW_)
        zone = np.exp(-((x / 0.06) ** 2 + ((z + 0.025) / 0.032) ** 2)) * front
        spots = smooth(0.58, 0.7, n) * smooth(0.3, 0.6, n2) * zone * fr_ * feather
        ratio *= (1 - spots[..., None] * np.array([0.25, 0.36, 0.45]))
    rough += 0.12 * smooth(0.6, 0.8, float(ident["age"]))
    lips = smooth(1.0, 0.7, np.sqrt((ax / 0.024) ** 2 + ((z - lm["mouth_dz"]) / np.where(z - lm["mouth_dz"] > 0, 0.0075, 0.010)) ** 2)) * front
    rim = np.exp(-(((ax - lm["eye_x"]) / 0.014) ** 2 + (z / 0.006) ** 2)) * front
    rough = 0.5 + (rough - 0.22 * lips - 0.12 * rim - 0.5) * feather
    rgb = np.clip(ratio / 2.0, 0, 1)
    rgb = np.where(M[..., None] > 0, rgb, 0.5)
    tile = np.concatenate([rgb, np.clip(rough, 0, 1)[..., None]], -1)
    # debug: the projected colour (sRGB) for the comparison sheets
    dbg = np.where(M[..., None] > 0, l2s(np.exp(lc)), 0.3)
    save_png(np.concatenate([dbg[::-1], np.ones_like(dbg[::-1, ..., :1])], -1), os.path.join(OUTD, sex, f"aiproj_{ident['id']}.png"), f"aiproj_{ident['id']}")
    return (tile * 255 + 0.5).astype(np.uint8)


def ai_iris(sid):
    """The iris colour on the sheet's front view (linear RGB): a ring round each pupil, highlight and pupil out."""
    sheet = ai_sheet(sid)
    F = json.load(open(os.path.join(HERE, "refs", "ai", "ai_fit.json")))["front"][sid]
    ipd = abs(F["pupil_r"][0] - F["pupil_l"][0])
    px = []
    for k in ("pupil_l", "pupil_r"):
        cx, cy = F[k]
        yy, xx = np.mgrid[int(cy - ipd * 0.12):int(cy + ipd * 0.12), int(cx - ipd * 0.12):int(cx + ipd * 0.12)]
        d = np.hypot(xx - cx, yy - cy) / ipd
        ring = (d > 0.03) & (d < 0.07)
        px.append(sheet[yy[ring], xx[ring]])
    p = np.concatenate(px)
    l = p.mean(-1)
    keep = (l > np.percentile(l, 25)) & (l < np.percentile(l, 85))
    return np.median(p[keep], 0)


def ai_eye_texture(src_png, out_path, iris_lin):
    """eye_texture, then its irises recoloured to the sheet's (fibre luminance kept)."""
    eye_texture(src_png, out_path)
    img = bpy.data.images.load(out_path, check_existing=False)
    a = img_np(img)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    rgb = s2l(a[..., :3])
    for cu, cv in ((0.707, 1 - 0.297), (0.29, 1 - 0.71)):
        d = np.sqrt((u - cu) ** 2 + (v - cv) ** 2)
        iris = smooth(0.125, 0.105, d) * smooth(0.035, 0.05, d)
        lum = rgb.mean(-1, keepdims=True)
        ml = lum[iris > 0.5].mean()
        tgt = np.clip(np.asarray(iris_lin) * 1.25, 0, 1) * (lum / max(ml, 1e-4))
        rgb = rgb * (1 - iris[..., None]) + np.clip(tgt, 0, 1) * iris[..., None]
    a[..., :3] = l2s(rgb)
    im = bpy.data.images.new("ai_eye", w, h, alpha=True)
    im.pixels.foreach_set(a.ravel())
    im.filepath_raw = out_path
    im.file_format = "PNG"
    im.save()
    return im


_afp = os.path.join(HERE, "refs", "ai", "ai_fit_result.json")
AI_FIT = json.load(open(_afp)) if os.path.exists(_afp) else {}
