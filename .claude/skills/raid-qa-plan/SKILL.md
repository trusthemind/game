---
name: raid-qa-plan
description: Build a QA test plan and exploratory checklist for an extraction-raid feature (spawns, loot, extract, bots, saves). Use when a feature is done and needs verifying, or the user says "тест-план", "перевір фічу", "QA".
---

# Raid QA plan

Output is a plan plus a pass/fail checklist; it does not fix bugs (use bug-triage).

## Steps
1. `graphify query "<feature>"` to find touched code. List changed files with `git diff --stat` (read-only).
2. Classify each change: Logic (engine) / Integration / Visual / UI / Data.
3. Automated layer, name concrete files:
   - Engine: `packages/engine/tests/` (raid, extracts, loot via inventory/mods, stealth, health, profile, world, perf). Prefer a seeded `Rng` so the test is reproducible.
   - Web unit: `apps/web/tests/unit`; e2e smoke: `apps/web/tests/e2e/smoke.spec.ts`.
   - Gate: `npm run check` (typecheck + lint + test + build). Web types: `cd apps/web && npx tsc -b`, because `tsc -p .` checks nothing.
   - Server: `cd server && go test ./...`.
4. Manual layer, tick each (run the game without sound: no `?sound=1`):
   - **Spawn**: player spot valid, no spawn inside walls or props, bot count and placement by seed.
   - **Loot**: tables roll per container type, no empty maps, no duplicate unique items, rarity spread plausible over 20 seeds.
   - **Extract**: every exit reachable, timer starts and cancels correctly, extract during reload/heal/vehicle, items kept vs lost on death.
   - **Bots**: patrol, notice, chase, give up, heal (`botheal`), no stuck-in-geometry, no shooting through walls.
   - **Health/combat**: bleed, fracture, armor, ammo types, melee, mods.
   - **Saves/profile**: finish raid, reload page, stash/equipment intact; load an older-version profile; offline vs server CAS save conflict (`PUT /api/v1/profile`).
   - **Performance**: 60 fps target, `PerfMonitor` (`apps/web/src/perf`) adaptive resolution, no growth in draw calls or memory after 3 raids.
   - **Visual**: body default `nevernude`; no white/black flashes, no lost WebGL context.
5. Exploratory charters (15 min each): "break the inventory", "extract in the worst moment", "play with the worst-case low quality setting", "rapid restart x10".
6. Verdict: PASS / PASS-WITH-ISSUES / FAIL / NOT ASSESSED. Never mark a row passed that was not actually run; unrun rows stay NOT ASSESSED.

## Rules
- Show the plan in chat; write to `docs/qa/<feature>.md` only on request.
- Screenshots sparingly (token economy); prefer text reads and console logs.
- No commits or pushes without explicit OK.
