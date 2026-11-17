---
name: bug-triage
description: Triage and write up Ashfall bugs (severity, repro, owner, regression test). Use when the user reports a bug, pastes an error, or asks to "розібрати баги" or prioritise the backlog.
---

# Bug triage

## Severity (impact, objective) vs priority (urgency, the user decides)
- **S1** crash, data loss (profile/stash wiped), cannot start or extract a raid, security issue.
- **S2** core loop broken for some players: stuck bot/player, items vanish, wrong loot/economy, severe fps collapse.
- **S3** wrong but workable: visual glitch, bad animation, UI misalignment, odd balance.
- **S4** cosmetic or polish.
Priority P1-P4: propose, but the user decides. Never close as "won't fix" without their OK.

## Per bug, fill in
1. **Title**: symptom, not guess.
2. **Build/env**: git short hash, browser, quality tier, map, seed if known (`Rng` seed makes sim bugs reproducible).
3. **Repro steps**: numbered, minimal; "always / sometimes (n of m)".
4. **Expected vs actual**; console errors (`read_console_messages` in the browser pane) as text, not screenshots.
5. **Area/owner** (by package): engine sim (`packages/engine/src/sim|world|items|ai`), profile/save (`profile.ts`, `apps/web/src/state/persistence.ts`), render (`apps/web/src/render`), UI (`apps/web/src/ui`), server (`server/internal`), assets (`tools/assets`, `public/models`).
6. **Regression test**: name the file where it belongs (e.g. `packages/engine/tests/raid.test.ts`) and the failing assertion to write first. Visual-only bugs: a manual check line in raid-qa-plan.
7. **Suspected cause**: from `graphify query`/`graphify path`, labelled as hypothesis.
8. **Duplicates/regressions**: check `plan.md` and `git log --oneline -S"<symbol>"` for the commit that introduced it.

## Output
Table sorted S1 first: id | sev | prio (proposed) | area | one-line | test. Flag clusters in one system and regressions. Keep the log in `plan.md` only if the user asks; do not create tracker files unasked.

## Rules
One task at a time: triage does not start fixing. After the user picks a bug, fix it with the failing test first. No commit or push without explicit OK.
