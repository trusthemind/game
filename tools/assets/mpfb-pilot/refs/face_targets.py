"""London Face Set (CC BY 4.0; reference only, nothing of it ships) -> facial ratios per face and per taste archetype
(REFERENCES.md section 7). Uses the set's own 189-point FRL templates (*.tem, front neutral), no detector needed.
Each archetype = the median of 4 faces picked by trait scores among the better-rated half of that sex (so no single
person's proportions), written to refs/face_targets.json (numbers only).   python3 -I refs/face_targets.py
"""
import csv, json, math, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data", "london")
TEM = os.path.join(D, "neutral_front", "neutral_front")


def tem(path):
    L = open(path).read().split("\n")
    n = int(L[0])
    return [tuple(map(float, l.split())) for l in L[1:n + 1]]


def ratios(P):
    x = lambda i: P[i][0]
    y = lambda i: P[i][1]
    ipd = math.dist(P[0], P[1])
    py = (y(0) + y(1)) / 2
    menton = y(129)
    face_w = max(abs(x(185) - x(187)), abs(x(110) - x(113)))
    jaw_w = abs(x(126) - x(132))
    eye_w = (abs(x(18) - x(22)) + abs(x(23) - x(27))) / 2
    eye_h = ((y(29) - y(20)) + (y(32) - y(25))) / 2
    # canthal tilt: outer corner above the inner one = +deg (image y grows down)
    tilt = (math.degrees(math.atan2(y(22) - y(18), abs(x(22) - x(18)))) + math.degrees(math.atan2(y(23) - y(27), abs(x(27) - x(23))))) / 2
    nose_w = max(x(i) for i in (66, 67, 68, 69, 70)) - min(x(i) for i in (61, 62, 63, 64, 65))
    mouth_w = abs(x(87) - x(93))
    up = y(96) - y(90)
    lo = y(106) - y(101)
    stom = (y(96) + y(101)) / 2
    brow = ((py - y(84)) + (py - y(85))) / 2
    return dict(
        face_w_ipd=face_w / ipd, jaw_face=jaw_w / face_w, face_h_w=(menton - py) / face_w, eye_w_ipd=eye_w / ipd,
        eye_aspect=eye_h / eye_w, tilt_deg=tilt, intercanthal_ipd=abs(x(22) - x(23)) / ipd, nose_w_ipd=nose_w / ipd,
        nose_len_ipd=(y(55) - py) / ipd, mouth_w_ipd=mouth_w / ipd, lips_mouth=(up + lo) / mouth_w, upper_lower=up / max(lo, 1e-6),
        brow_ipd=brow / ipd, mouth_y_ipd=(stom - py) / ipd, chin_ipd=(menton - stom) / ipd,
        zyg_level=((y(110) + y(113)) / 2 - py) / (menton - py), gon_level=((y(126) + y(132)) / 2 - py) / (menton - py))


info = {r["face_id"]: r for r in csv.DictReader(open(os.path.join(D, "london_faces_info.csv")))}
rat = list(csv.DictReader(open(os.path.join(D, "london_faces_ratings.csv"))))
score = {}
for fid in info:
    col = "X" + fid
    vals = [float(r[col]) for r in rat if r.get(col) not in (None, "", "NA")]
    score[fid] = st.mean(vals) if vals else 0.0
faces = {}
for fid, r in info.items():
    p = os.path.join(TEM, f"{fid}_03.tem")
    if os.path.exists(p):
        faces[fid] = dict(sex=r["face_gender"][0], eth=r["face_eth"], age=int(r["face_age"] or 30), rating=score[fid], **ratios(tem(p)))
KEYS = [k for k in next(iter(faces.values())) if k not in ("sex", "eth", "age", "rating")]


def z(sub, k):
    v = [f[k] for f in sub]
    m, s = st.mean(v), st.pstdev(v) or 1
    return {id(f): (f[k] - m) / s for f in sub}


def pick(sex, eth, traits, n=4):
    pool = [f for f in faces.values() if f["sex"] == sex and f["age"] <= 45]
    med = st.median(f["rating"] for f in pool)
    good = [f for f in pool if f["rating"] >= med] if eth is None else sorted([f for f in pool if f["eth"] == eth], key=lambda f: -f["rating"])[:max(n, 4)]
    if eth is None:
        good = [f for f in good if f["eth"] != "black"]
    zs = {k: z(good, k) for k, _ in traits}
    good.sort(key=lambda f: -sum(w * zs[k][id(f)] for k, w in traits))
    return good[:n]


ARCH = {
    "f_adventurer": ("f", None, [("face_w_ipd", 0.5), ("jaw_face", -1.0), ("lips_mouth", 1.0), ("tilt_deg", 0.7)]),
    "f_glamour":    ("f", None, [("eye_w_ipd", 1.0), ("lips_mouth", 1.0), ("jaw_face", -0.7), ("brow_ipd", 0.6)]),
    "f_statuesque": ("f", "black", [("lips_mouth", 0.5), ("face_w_ipd", 0.5)]),
    "f_elegant":    ("f", None, [("face_h_w", 1.2), ("nose_w_ipd", -0.8), ("jaw_face", -0.4)]),
    "m_hero":       ("m", None, [("jaw_face", 1.2), ("brow_ipd", -0.7), ("face_w_ipd", 0.3)]),
    "m_model":      ("m", None, [("face_h_w", 1.0), ("jaw_face", -0.5), ("nose_w_ipd", -0.6), ("lips_mouth", -0.4)]),
    "m_rugged":     ("m", None, [("face_w_ipd", 1.0), ("nose_w_ipd", 0.8), ("brow_ipd", -0.6)]),
    "m_strong":     ("m", "black", [("jaw_face", 0.5), ("face_w_ipd", 0.3)]),
}
out = {"keys": KEYS, "all": {}, "arch": {}}
for sex in "mf":
    sub = [f for f in faces.values() if f["sex"] == sex]
    out["all"][sex] = dict({k: round(st.median(f[k] for f in sub), 4) for k in KEYS}, n=len(sub))
for name, (sex, eth, traits) in ARCH.items():
    sel = pick(sex, eth, traits)
    out["arch"][name] = dict({k: round(st.median(f[k] for f in sel), 4) for k in KEYS}, n=len(sel), eth=sorted({f["eth"] for f in sel}))
json.dump(out, open(os.path.join(HERE, "face_targets.json"), "w"), indent=1)
cols = ["all_f", "all_m"] + list(ARCH)
rows = dict(all_f=out["all"]["f"], all_m=out["all"]["m"], **out["arch"])
print("key".ljust(18) + "".join(c[:12].rjust(13) for c in cols))
for k in KEYS:
    print(k.ljust(18) + "".join(f"{rows[c][k]:13.3f}" for c in cols))
