---
name: playtest-report
description: Template and analysis for an Ashfall playtest session (what to observe, raid time, deaths, FPS). Use after the user plays a build or pastes play notes, or asks for "плейтест".
---

# Playtest report

Two modes: **blank template** (print, save nothing) or **analyze notes** (user pasted notes/metrics).

## Before the session
- State a hypothesis ("new bunker loot makes raids too short?"). Pick 1-2 focus areas.
- Note build: git short hash (`git rev-parse --short HEAD`), map, body/quality settings, device, browser, sound off.

## Template
1. **Session**: date, build, map, tester, duration.
2. **Hypothesis & focus**.
3. **First 5 minutes**: where did the player hesitate, what was unclear (UI, controls, extract hints)?
4. **Raid metrics** (one row per raid): raid time, loot value brought out, kills (bot/boss), cause of death, extracted y/n, damage taken, heals used.
5. **Performance**: average and 1%-low fps, dips and where (city, vehicles, many bots), load time, memory growth. `PerfMonitor` in `apps/web/src/perf/PerfMonitor.ts` exposes simMs/renderMs.
6. **Flow**: moments of boredom, frustration, confusion, delight.
7. **Bugs**: only crashes, softlocks, data loss, visual glitches; route via bug-triage.
8. **Feature feedback**: what worked, what did not, with the player's words.
9. **Top 3 priorities**.

## Analysis rules
- Compare notes against `docs/research/escape-from-duckov.md` and the spec, if one exists; flag contradictions with design intent.
- Route findings: design change -> feature-spec; numbers -> balance-review; bugs -> bug-triage; polish -> backlog line.
- Separate observation from interpretation; one tester is an anecdote, state the sample size.
- Report ends with a short next-step suggestion; saving to `docs/playtests/<date>.md` only on the user's OK.
- Never commit or push.
