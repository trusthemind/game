---
name: sim-code-review
description: Code review focused on Ashfall sim determinism, three.js performance and profile-save migrations. Use for "рев'ю", before the user commits a diff, or when touching packages/engine, apps/web/src/render or profile.ts.
---

# Sim / render / save review

Read-only. Review the diff (`git diff`, `git diff --staged`) and report findings; do not edit unless asked.

Start with `graphify query` on the touched symbols; read raw files only for lines it locates.

## A. Determinism (packages/engine)
- No `Math.random`, `Date.now`, `performance.now` or iteration over unordered sets/maps inside `src/sim`, `src/world`, `src/items`, `src/ai`. Randomness goes through `core/rng.ts` (`Rng`, seeded). Time is passed in (see `canClaimFreeKit(profile, now)`).
- The engine must not import from `apps/web` or DOM/three.js. Sim state must be plain data.
- Same seed, same raid: is there a test in `packages/engine/tests/` (raid, world, extracts, ...)? New rule without a test = finding.
- Fixed-step assumptions: movement/damage scaled by dt, no frame-rate dependent logic.
- Hot paths allocate nothing: use `core/pool.ts`, `spatialHash.ts`, `binaryHeap.ts`; no per-tick arrays/closures in AI (`ai/brain.ts`) or pathfinding.

## B. three.js / render (apps/web/src/render)
- Dispose geometries, materials, textures and render targets when leaving a raid; no leaks across restarts (WebGL context loss caused flashes before).
- No per-frame `new THREE.Vector3/Matrix4/Color`; reuse scratch objects.
- Prefer merged/instanced meshes (`bakeRigid.ts`, `cleanModel.ts`) over many draw calls; check shadow casters, material count, texture sizes (`quality.ts` tiers).
- Skinned meshes: bone count, `rebind.ts` assumptions unchanged.
- Asset loading is cached via `assets.ts`; no duplicate GLB loads.
- Nudity: default stays `nevernude` (`render/nudity.ts`).

## C. Save/profile
- Any change to `Profile` shape in `packages/engine/src/profile.ts` needs: `PROFILE_VERSION` bump, a `if (out.version < N)` migration step, a test in `tests/profile.test.ts` that loads an older fixture, and safe defaults for missing fields (older saves must never crash).
- Server (`server/internal/api`, `store`): CAS revision logic unchanged or tested; JSON field names stay backward compatible.
- `apps/web/src/state/persistence.ts`: localStorage failures are caught.

## Report
Verdict: CHANGES REQUIRED / APPROVED WITH SUGGESTIONS / APPROVED / NOT ASSESSED. List findings as `severity | file:line | issue | fix`. Run (and quote result of) `npm run check` only if the user wants it. Do not commit.
