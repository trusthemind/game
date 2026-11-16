"""ANSUR II -> body proportion targets (fractions of stature), athletic-average adults: age 20-35, BMI 21-26 (m) /
20-25 (f). Medians. Writes refs/body_targets.json (numbers only).  python3 refs/ansur_targets.py"""
import csv, json, os, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "data", "ansur")
out = {}
for sex, fn, bmi in [("m", "male.csv", (21, 26)), ("f", "female.csv", (20, 25))]:
    rows = list(csv.DictReader(open(os.path.join(D, fn), encoding="latin-1")))
    sel = []
    for r in rows:
        h = float(r["stature"]) / 1000; w = float(r["weightkg"]) / 10
        if 20 <= int(r["Age"]) <= 35 and bmi[0] <= w / h / h <= bmi[1]:
            sel.append(r)
    med = lambda k: st.median(float(r[k]) for r in sel)
    S = med("stature")
    # head height (vertex-menton) is not measured: tragion-top + sellion-menton - ~15 mm (tragion sits below sellion).
    head_h = st.median(float(r["tragiontopofhead"]) + float(r["mentonsellionlength"]) - 15 for r in sel)
    t = dict(n=len(sel), stature_mm=S,
             head_h=head_h / S, head_breadth=med("headbreadth") / S, head_circ=med("headcircumference") / S,
             face_h_sellion_menton=med("mentonsellionlength") / S, bizygomatic=med("bizygomaticbreadth") / S,
             neck_circ=med("neckcircumference") / S,
             acromial_h=med("acromialheight") / S, biacromial=med("biacromialbreadth") / S, bideltoid=med("bideltoidbreadth") / S,
             chest_circ=med("chestcircumference") / S, chest_breadth=med("chestbreadth") / S, chest_depth=med("chestdepth") / S,
             chest_h=med("chestheight") / S,
             waist_circ=med("waistcircumference") / S, waist_breadth=med("waistbreadth") / S, waist_h=med("waistheightomphalion") / S,
             hip_breadth=med("hipbreadth") / S, buttock_circ=med("buttockcircumference") / S,
             crotch_h=med("crotchheight") / S, knee_h=med("kneeheightmidpatella") / S,
             thigh_circ=med("thighcircumference") / S, calf_circ=med("calfcircumference") / S,
             upperarm_len=med("acromionradialelength") / S, forearm_len=med("radialestylionlength") / S,
             biceps_circ=med("bicepscircumferenceflexed") / S, span=med("span") / S,
             gh_spacing_est=(med("biacromialbreadth") - 40) / S)
    out[sex] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in t.items()}
# Population spread (all adults 18-50, any BMI): 5th / 50th / 95th percentile of each ratio, for the game's range of builds.
def pct(v, q):
    v = sorted(v)
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]
for sex, fn in [("m", "male.csv"), ("f", "female.csv")]:
    rows = [r for r in csv.DictReader(open(os.path.join(D, fn), encoding="latin-1")) if 18 <= int(r["Age"]) <= 50]
    sp = {}
    for key, col in [("chest_circ", "chestcircumference"), ("waist_circ", "waistcircumference"), ("buttock_circ", "buttockcircumference"),
                     ("hip_breadth", "hipbreadth"), ("thigh_circ", "thighcircumference"), ("calf_circ", "calfcircumference"),
                     ("neck_circ", "neckcircumference"), ("chest_breadth", "chestbreadth"), ("crotch_h", "crotchheight"),
                     ("biacromial", "biacromialbreadth"), ("waist_breadth", "waistbreadth")]:
        v = [float(r[col]) / float(r["stature"]) for r in rows]
        sp[key] = [round(pct(v, q), 4) for q in (0.05, 0.5, 0.95)]
    out[sex]["spread"] = sp
json.dump(out, open(os.path.join(HERE, "body_targets.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
