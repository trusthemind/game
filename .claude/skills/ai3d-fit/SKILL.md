---
name: ai3d-fit
description: Fit our MPFB face/body to an AI 3D target (Higgsfield Tripo / SAM 3D / Meshy / Hunyuan) with one command chain (ai3d init/fit/check/report). Use when the user gives an AI/3D target, says "підігнати до 3D", or wants a new face/body from Higgsfield.
---

# AI 3D fit

The AI mesh is only a FIT TARGET. Our MPFB base keeps skeleton, UVs, weights, clothing fit, hands, feet, head (body) / neck and below (face). Only our vertex offsets (a morph target) and baked skin ratio/normal maps ship. Tool: `tools/assets/mpfb-pilot/ai3d.mjs` (docs: `docs/art/AI3D_PIPELINE_AUDIT.md`). Needs `blender` on PATH, Node 20+.

## Workflow (run from tools/assets/mpfb-pilot)
1. Rules first: invented adult only, ToS/licence, no explicit imagery (see Legal). Check `balance`, run `generate_3d {get_cost:true}` before every generation (skill `higgsfield-assets`).
2. 2D sheet (front, clean grey bg, neutral pose, A-pose for bodies; ~2 cr) -> 3D GLB -> `refs/ai/...` (git-ignored). Never more than 4 jobs in parallel.
3. `node ai3d.mjs init <id> --kind face|body --sex m|f --glb <file> [--tone hex] [--hair name]` prints the facing (face: from eye whites), scale rule, tone; fill the `provenance` TODOs; for faces add the identity (with an `ai` block) to `identities.json`.
4. `node ai3d.mjs fit <id>` (cached per stage; body ~1 min, `--force`, `--from fit`, `--only bake`), then `node ai3d.mjs build`.
5. `node ai3d.mjs check <id>`: PASS/WARN/FAIL per gate (`--skip`, `--only`, `--full` adds tsc + npm test).
6. `node ai3d.mjs report <id>` -> `ai/report/<id>/report.jpg` + `report.md`. Show the JPG and the gate table to the user, ask. Commit only on their OK (they commit; we never push).
Iterate: change the subject JSON (underwear/posture/orientation/budgets), rerun fit; only changed stages rerun.

## Which 3D model
| Model | Use | Cost (Starter) | Licence |
|---|---|---|---|
| Tripo H3.1 detailed PBR | default, faces and bodies | ~18 cr | via Higgsfield ToS 4.4, commercial OK |
| SAM 3D Body | proportion cross-check only (no texture) | ~1 cr | check |
| Meshy ultra | only if Tripo fails | ~44 cr | via Higgsfield ToS |
| Hunyuan3D | avoid | cheap | excludes EU/UK/KR: do not ship |
Costs change: always `get_cost` first.

## Pitfalls we hit (the gates cover most)
- Target posture (head forward, rounded back, belly) must not enter the shape: bones stay MPFB, neck from MPFB, belly/back eased (`posture`), neck girth to ANSUR (neck >= P25 m / P40 f).
- Underwear must not be copied: fabric = dark + desaturated in the target albedo (`underwear.luma/rb`), inpaint the skin. Gate `underwear`.
- AI textures carry baked light: skin = ratio over the game skin, delit; mean ratio ~1 so the tone selector keeps working. Gate `tone`.
- Hands/feet/head(body), body below neck(face) from MPFB (gate `keep`).
- Budgets: GLB ~0.9 MB, textures per subject `budgets` (gate `sizes`).
- Facing is auto (body toe test, face eye whites); on `confidence low` set `orientation.yawDeg` and look at the mesh (`ai3d_inspect.py`).
- Dev views show the SHIPPED GLB: `build` before browser gates.
- Face fit needs `base_skin_<sex>.png` (game skin albedo) in the work dir.

## Legal / safety
- Invented adults only, no real-person likeness; record provider/model/date/ToS/licence in `provenance` (gate `provenance` fails otherwise) and in `apps/web/public/models/CREDITS.txt`.
- Default nudity stays `nevernude`; no nude or explicit frames in anything shown or shared (`report` is clothed; `--heat` shows an unclothed mannequin: ask first).
- Never bypass Higgsfield limits or filters; the account is the user's.

## What to show the user
report.jpg, the gate table (counts + every WARN/FAIL), cost spent / balance left, and what still needs eyes: likeness, hair/eyes in game light, game-distance read, motion. Not automated: aesthetics, identity read.
