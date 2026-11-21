# AI 3D fit pipeline: audit and unification

Scope: fitting our MPFB bodies / heads to AI 3D targets (Tripo / Hunyuan / SAM 3D via Higgsfield). The AI mesh is a fit target only; skeleton, UVs, weights, clothing fit stay MPFB's. Code: `tools/assets/mpfb-pilot`. After this change the entry point is `node ai3d.mjs` (see README there and skill `ai3d-fit`).

## 1. Before: the hand pipelines

### Face (id `ai_f2`, Nia) - 7 build commands, ~9 check commands
| # | Step | Script | In | Out |
|---|---|---|---|---|
| 1 | prep | `ai3d_prep.py <glb> <dir> <yaw>` (yaw by eye: Tripo -90) | AI GLB | `<dir>/mesh.npz` (96 MB), color/orm/normal.png |
| 1b | manual | copy `base_skin_f.png` (game skin albedo) into `<dir>` | - | - |
| 2 | base identities | `build_identities.py` (all sexes + hair) | identities.json | `ident/<sex>/*`, `ident/hair/*` |
| 3 | fit | `ai3d_fit.py <dir> <tone>` (IDENT/SEX hard-coded) | mesh.npz, ident | `ident/f/*_ai_f2.*`, meta.json/brow_uv.json patched in place, `<dir>/fit.npz` |
| 4 | hair | `ai3d_hair.py <dir>` (NAME hard-coded) | fit.npz | `ident/hair/f_ai_f2_afro_*` |
| 5 | ship | `add_identities.mjs` (both sexes) | ident/ | `base/human_*_mpfb_id.glb`, `textures/ident/*.webp`, `models/hair_mh.glb`, `src/render/identityData.ts` |
| 6 | compress | `ASSET_SRC=x ONLY=mpfb node build.mjs` | base/*.glb | `public/models/human_*.glb` |
| manual | identities.json entry with `ai` block (id, label, race, skin, brow) | | | |
Checks: `ai3d_inspect.py` (mesh), `ai3d_check.py` (ai/labels/ours/overlay/heat renders), dev server on a port, `ai3d_shots.mjs`, `ai_compare.mjs` (sheet crops hard-coded per sheet), `ai_overlay.mjs` + `fit_ai.py` json, `measure_face.mjs`, `npm test`, `tsc`.

### Body (ids `ai_athletic` m/f) - 7 stages x 2 sexes, ~15 check commands
`ai_body_target.mjs` (file names `man_tripo.glb`/`woman_tripo.glb`, SAM pair nodes `person_00/01` hard-coded) -> `ai_body_dump.mjs [sex]` -> `ai_body_fit.py <sex>` (facing + scale auto; underwear `AIB_UW_*`, posture `AIB_ABD/UBK`) -> `ai_body_bake.py <sex> [res]` (Cycles) -> `ai_body_add.mjs <sex> [tex]` (texSize arg: shipped = 2048, default 1024!) -> `build.mjs`.
Checks: `ai_body_render.py` (fit + posed), `ai_body_overlay.mjs` (IoU), dev server, `ai_body_shots.mjs`, `ai_body_marks.mjs`, `measure_body.mjs`, `arm_taper.mjs`, `limb_profile.py`, `silhouette.py`, `bench.mjs`, `posecheck.mjs`, `npm test`, `tsc`.

### Earlier, superseded
`fit_scan.py` (Generic scans, exec'd by build_base.py), `fit_ai.py` / `fit_ai_dump.py` / `ai_skin.py` (landmark fit from 2D sheets; `ai_skin.py` still used by build_identities for ai identities). Not touched.

## 2. Duplicated code / parameters
- `rd()` raw reader x3 (fit, bake, render), `log()` with T0 x3, skin-weight matrix build + posed `A/M` x2 (bake, render), `yup2z` x2: now `ai3d/lib/py/common.py`.
- Still duplicated (left, risk > gain): `vnormals`/`umeyama` in `ai3d_fit.py`, `lap_smooth`/`dilate` (fit) vs `lap`/`nfill` (bake), `mesh_obj` x3 (render/bake/check), glTF NodeIO setup x9 mjs, Playwright launch args x7.
- Constants: 13380 (head verts) in `ai3d_hair.py`, `ai3d_check.py`, `build_identities.py`; `GAME_SCALE 1.0543` in `ai3d_hair.py` vs `add_identities.mjs`.
- Hard-coded ids: `ai_f2`, `f`, `ai_f2_afro`, `base_skin_f.png`, body file names, SAM nodes, `ai_compare.mjs` sheet crops. Now parameters of the subject JSON (env `AI3D_IDENT/SEX/HAIR_NAME`, `AIB_*`).
- Ports: 5174 (ai_body_shots, ai_body_marks), 5175 (ai_compare, bench via `PORT`), positional in ai3d_shots. Now one server started on a free port (or `--port`).
- Output locations scattered over `ai/fit`, `ident`, `base`, `public/textures/{ident,ai_body}`, `public/models`, generated `src/render/identityData.ts` (tracked!). Now overridable together by `--out`.

## 3. Manual steps (what a person had to know / type)
Rotation angle (face yaw, by looking at the mesh); tone hex; copying `base_skin_f.png`; which GLB to pick; per-sex repetition; `ASSET_SRC` (required by build.mjs although unused for `ONLY=mpfb`); `ONLY`; `BODY_ONLY`; `PORT`, `QUERY`, `SEXES`, `MODES`, `DIST`, `DY`, `AIM`, `WAIT`, `OV`, `AI3D_EVAL`, `AIB_*`; starting/stopping the dev server; camera framing numbers of `__sheet(...)`; reading RMS lines out of logs; remembering that dev views show the shipped GLB (forgetting `build.mjs` = checking stale assets); texSize argument (silent default mismatch: 1024 vs shipped 2048).

## 4. Repeated visual checks now automated
RMS per region (`fit.json`), p95 distance and silhouette IoU (was: eyeball heat maps and `ai_body_overlay.mjs`), neck/belly/back posture vs MPFB and arm taper, ANSUR percentiles (neck P25 m / P40 f), underwear leakage, tone neutrality, held parts untouched, size budgets, skinning stretch / flips on Idle/Walk/Aim/Crouch, gear smoke test (standard kit in 4 poses, console errors), `__marks`, frame time, tsc + tests.
Still human: likeness / identity read, hair + eyes in game light, game-distance read, natural stance in motion, the AI target itself (artefacts, licence).

## 5. Top time sinks (measured here, M-series, headless Blender 5.3)
1. Hand orchestration: ~15 commands per subject per iteration, per-sex repeats, copy/paste of paths and env.
2. Browser checks: a cold Vite start + 60-240 s `__labReady` waits per shot, repeated for every variant.
3. Re-running everything after a small param change (no cache): body fit 45 s + bake 16 s per sex; face chain see below.
4. Eyeballing: 10-20 screenshots per iteration to find what a number now states.
5. Mistakes from stale state (old shipped GLB, texSize, wrong port).

## 6. Unification result
`ai3d.mjs list | init | fit | build | check | report | verify`, per-subject JSON `ai3d/subjects/<id>.json`, stage cache by content hash (scripts + inputs + params + upstream stages) in `ai/.ai3d/<id>/`, `--out DIR` scratch run that never touches shipped files, gates -> `ai/report/<id>/gates.json`.
Old script names still work (stage workers); `ai_body_dump.mjs` / `ai_body_target.mjs` are thin wrappers of `ai3d/lib/glb.mjs`. Python scripts gained env overrides only (defaults = old behaviour): `AI3D_FIT_ROOT`, `AI3D_IDENT_DIR`, `AI3D_SHIP_OUT`, `AI3D_MODELS_OUT`, `AI3D_BASE_DIR`, `AIB_YAW`, `AIB_NECK`, `AI3D_IDENT`, `AI3D_SEX`, `AI3D_HAIR_NAME`.

### Gate notes
- Posture gates compare the AI rest mesh with the MPFB base (neck centre vs shoulder centre, belly front vs chest front, upper back vs buttock rear): limits are deltas, because the skeleton (head-over-shoulder in `__marks`) is not changed by a morph; `marks` (browser) checks the posed skeleton.
- Skinning gate is relative (AI morph at weight 1 vs 0): the game's clips are retargeted at runtime (`rebind.ts`), so absolute CPU-skinned stretch is meaningless.
- Heat map is an unclothed mannequin: `report` omits it unless `--heat`.
- Current results (m/f): see `ai/report/<id>/gates.json`; m neck is P24 (limit P25) and chest P99: genuine WARNs in the committed build.

## 7. Validation (`ai3d verify <id> --out DIR`, shipped files untouched)
| subject | files compared | identical | float noise | drift | wall time (fit + build) |
|---|---|---|---|---|---|
| ai_body_m | 46 | 45 | 1 (`ai_n.png` +-1/255 on a few px, Cycles threads) | 0 | 62 s |
| ai_body_f | 46 | 45 | 1 (same) | 0 | 62 s |
| ai_f2 | 268 | 256 | 0 | 4 json/glb + 8 new hair files, none from the fit | 69 s |

Compared: all fit dumps, deltas, baked maps, `base/*_mpfb_{id,ai}.glb`, shipped `human_{m,f}.glb` (meshopt output is deterministic), `ai_body/*.webp`, `ident/*.webp`, `identityData.ts`. Face fit outputs (`body_ai_f2.bin`, skin tile, eyes, brow, `fit.npz`, hair bins) are byte-identical.
Face drift is the on-disk `ident/` being older than `build_identities.py`: the script builds hair `braid01` (not in the real `ident/hair`, so `hair_mh.glb` differs) and `meta.json` lists hair in script order, not directory order; `f_ai_f2_afro.json` differs only in an absolute texture path. Stage times (face): prep 5 s, base 27 s, fit 15 s, hair 17 s, add 4 s. Body: fit 45 s, bake 15 s.
Needed config finding: shipped body textures are 2048 px (`ai_body_add.mjs` defaults to 1024): `build.texSize: 2048` in the subjects.
