---
name: balance-review
description: Review Ashfall balance (loot tables, weapon stats, economy, bosses) for outliers and degenerate strategies. Use when numbers change or the user says "баланс", "економіка", "занадто легко/важко".
---

# Balance review

Read-only analysis; changes to numbers are proposals until the user approves.

## Data sources (verify they still exist; missing input = NOT ASSESSED)
- Items and stats: `packages/engine/src/items/defs.ts`, `mods.ts`, `loadouts.ts`, `visor.ts`
- Loot: `packages/engine/src/items/loot.ts`; bosses: `items/bosses.ts`
- Economy: `packages/engine/src/economy.ts`, `hideout.ts`, `tasks.ts`, `companions.ts`
- Combat/health: `packages/engine/src/sim/combat.ts`, `health.ts`
- Targets: the feature spec (`docs/specs/`) or `docs/research/escape-from-duckov.md`. No target = say so; do not invent one.

Start with `graphify query` to locate definitions; read only those ranges.

## Checks
1. **Weapons**: DPS = damage x rate, TTK vs each armor class, effective range, recoil/spread, ammo cost per kill. Flag any weapon > ~25% above or below its tier median.
2. **Armor/health**: hits to kill per armor class; is the top armor a strict upgrade with no trade-off (speed, noise, weight)?
3. **Loot**: per container/map, expected value per search, rarity distribution over a seeded sample (write a throwaway script or vitest using `Rng`; do not use `Math.random`). Check empty-table chance, duplicates, whether high-tier items appear too early.
4. **Economy**: faucets (raid loot, quests, sales) vs sinks (buy prices, repairs, hideout upgrades, kit claims). Time-to-first-upgrade, and money after N raids for a careful vs an aggressive player.
5. **Degenerate strategies**: camp one extract, only-melee, hoard-and-never-spend, vehicle abuse, bot farming.
6. **Progression**: does each quest/hideout tier unlock something at a sensible cost?

## Report
Per domain: verdict (HEALTHY / CONCERNS / CRITICAL / NOT ASSESSED, worst finding wins), outlier table (item | value | median | note), recommended changes as a diff table old -> new. Include the seed and sample size of any simulation. Apply only after the user OKs; then add/adjust a vitest and run `npm test -w @ashfall/engine`. No commit/push without explicit OK.
