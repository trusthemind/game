# mpfb-pilot

MPFB2 bodies/heads for the game, built headless in Blender. AI 3D fitting (Tripo / SAM 3D / ...) goes through ONE tool.

## Quickstart: fit to an AI 3D target
Needs `blender` on PATH, Node 20+. Run from this folder. Docs: `docs/art/AI3D_PIPELINE_AUDIT.md`, skill `.claude/skills/ai3d-fit`.

```
node ai3d.mjs list                                   # subjects + stage cache state
node ai3d.mjs init my_f --kind face --sex f --glb refs/ai/3d/x.glb --tone 6b4430   # creates ai3d/subjects/my_f.json, prints facing/scale
node ai3d.mjs fit my_f                               # whole chain, cached per stage (--force, --from fit, --only bake, --dry)
node ai3d.mjs build                                  # build.mjs ONLY=mpfb (ASSET_SRC defaulted) -> apps/web/public/models
node ai3d.mjs check my_f                             # gates: PASS/WARN/FAIL (--skip, --only, --full = + tsc/npm test)
node ai3d.mjs report my_f                            # ai/report/my_f/report.jpg + report.md (clothed frames)
node ai3d.mjs verify ai_body_m --out /tmp/v          # fit into a scratch dir and diff against the current outputs
```
Existing subjects: `ai_body_m`, `ai_body_f` (athletic build), `ai_f2` (Nia face). Config per subject: `ai3d/subjects/<id>.json`
(source GLB, orientation, scale rule, underwear rule, posture, keep, budgets, provenance). Code: `ai3d/lib/` (`py/common.py`, `glb.mjs`,
`stages.mjs`, `gates.mjs`, `browser.mjs`, `report.mjs`). The old scripts (`ai_body_*.py/mjs`, `ai3d_*.py`) still work and are the stages' workers;
`ai_body_dump.mjs` / `ai_body_target.mjs` are thin wrappers over `ai3d/lib/glb.mjs`.
Env overrides (set by `--out`): `AI3D_FIT_ROOT`, `AI3D_IDENT_DIR`, `AI3D_SHIP_OUT`, `AI3D_MODELS_OUT`, `AI3D_BASE_DIR`; `BLENDER`, `AI3D_PORT`.
Nothing here commits or pushes. `ai/`, `ident/`, `refs/ai/` are git-ignored.
