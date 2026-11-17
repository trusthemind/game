---
name: feature-spec
description: Write a one-page design spec (mini-GDD) for an Ashfall feature before coding. Use when the user proposes a new mechanic, item class, map event or UI flow, or says "спека", "design doc", "розпиши фічу".
---

# Feature spec (one-pager)

Goal: a short, testable spec tied to our packages. No code is written here.

## Steps
1. Run `graphify query "<feature>"` first; read raw files only for lines the graph points to.
2. Read `plan.md` (git-excluded) so the feature does not collide with the queue. Rule: one task at a time. If another task is in progress, say so and stop.
3. Classify: tuning (numbers only) / tweak (change an existing rule) / addition / new system. New system over ~1 week: split it.
4. Draft the spec below, show it in chat, and write it to `docs/specs/<feature>.md` only after the user says OK.

## Template
- **Intent**: one sentence, player-facing. What decision does the player get to make?
- **Rules**: numbered, each verifiable. Cite the current rule being changed (file:line).
- **Where it lives**: engine (`packages/engine/src/sim`, `items`, `world`, `economy.ts`, `profile.ts`) vs client-only (`apps/web/src/render`, `ui`, `game`) vs server (`server/internal/api`). Sim rules go in the engine so they stay deterministic and testable.
- **Data**: new fields in `Profile`? Then a `PROFILE_VERSION` bump plus a migration step in `packages/engine/src/profile.ts` (see release-checklist).
- **Randomness**: which `Rng` stream (`core/rng.ts`) it uses; never `Math.random` in sim.
- **Tuning knobs**: table of name / default / safe range / where defined.
- **Edge cases**: death mid-action, extract during action, disconnect/reload, full inventory, bots, multiplayer-free single raid.
- **Acceptance criteria**: each maps to a vitest test (`packages/engine/tests/*.test.ts`) or a manual check in raid-qa-plan.
- **Assets needed**: list, and note they must pass art-asset-intake (CC0/CC-BY only).
- **Out of scope**: explicit.

## Rules
- Do not edit CLAUDE.md or plan.md unless asked.
- Never commit or push; the user gives the explicit OK.
- Reply to the user in Ukrainian, concise.
