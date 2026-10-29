# Escape from Duckov: what to take from it

Escape from Duckov (Team Soda, Oct 2025, Windows/macOS) is a single-player, top-down Tarkov-like game.
It sold 3M copies in three weeks and has a Metacritic score of 77. It is the closest reference for Ashfall:
same camera, same loop, single player, browser/Mac friendly. Its characters are ducks; ours are people.

Sources:
- [Wikipedia](https://en.wikipedia.org/wiki/Escape_from_Duckov)
- [Kotaku: 12 tips](https://kotaku.com/escape-from-duckov-guide-tips-weapon-mods-storm-2000639589)
- [KeenGamer: 30 tips](https://www.keengamer.com/articles/guides/escape-from-duckov-30-beginner-and-advanced-tips-to-help-you-get-started/)
- [DualShockers review](https://www.dualshockers.com/escape-from-duckov-review/)
- [GameGrin review](https://www.gamegrin.com/reviews/escape-from-duckov-review/)
- [Fandom wiki](https://escape-from-duckov.fandom.com/wiki/Escape_From_Duckov_Wiki)
- [base upgrades guide](https://www.playerauctions.com/guide/other/single-player-games/all-escape-from-duckov-base-upgrades/)

## Their core loop

1. Leave the bunker and pick a map: Warehouse District, Farmstead, Detention Site, Zone Zero, Storm Zone…
2. Loot and fight.
3. Extract at a green-smoke exit.
4. Spend the loot on base stations, quests, crafting and weapon mods.
5. Go deeper: later maps have better-geared enemies in groups and bosses with guaranteed exclusive drops.

## Feature map

✅ = Ashfall has it · 🟡 = partial · ❌ = missing.
**MUST** = needed for the game to feel complete · **NICE** = well-to-have.

| Duckov feature | Ashfall | Priority |
|---|---|---|
| Vision cone aimed by the **mouse**; the near surroundings are always visible | ✅ (fixed: the cone follows the cursor again) | MUST |
| Sound tells you where enemies are; a "duck quack" when an enemy spots you | 🟡 positional CC0 audio; no "spotted" cue | MUST: add a spotted cue plus a directional HUD hint |
| Two firearms + one melee | ✅ | MUST |
| **Weapon mods**: scope, muzzle/barrel, grip, magazine; click a weapon → mod slots, drag mods in | ❌ | MUST |
| 50+ weapons, multiple ammo types | 🟡 10 guns + 7 melee; ammo types exist | MUST: add more guns |
| **Pet dog = secure storage** (1→6 slots, kept on death) | ❌ | MUST: secure container (Alpha→Gamma, upgradable); a dog companion is NICE |
| **Bunker base building**: stations unlock crafting, vendors, teleports, bitcoin farm; built from raid materials + quests | 🟡 hideout with trader/NPCs, no stations | MUST: hideout stations (med station, workbench, stash upgrades, generator) |
| Crafting: ammo, repairs; **blueprints** found in raids, researched at base | ❌ | NICE→MUST later |
| Quests from base NPCs (Jeff) drive early progression and XP | 🟡 NPC dialogue quests (Mykola), no task board | MUST: task board with kill / find-in-raid / extract tasks |
| Hunger + hydration, bleeding, bandages | ✅ (plus Tarkov limb health) | MUST |
| **Death = gear stays at a grave; one recovery attempt** (normal difficulty); hard = lose all | ❌ (lose all) | MUST: a difficulty option for this |
| **Difficulty settings**: enemy HP, damage, reaction time; customisable | ❌ | MUST |
| Day/night: stronger enemies at night; sleep to skip | 🟡 time-of-day picker | NICE: night-only threats |
| Periodic **storm** that kills in seconds; special gear needed | ❌ | NICE: map event |
| Enemy factions fight each other (third-party the fight) | ✅ scav/raider/infected hostility | MUST |
| Bosses with exclusive weapon/armor/backpack drops | 🟡 one boss + guards | MUST: boss squads + exclusive loot |
| Tools: shovel (dig caches), screwdriver/keys (locked crates, doors) | ❌ | NICE: keys + locked rooms |
| Totems (2 slots): perception / stamina / armor / weapon perks | ❌ | NICE: trinkets / skills |
| Vending machine with refresh timer; black market with fluctuating prices | 🟡 static trader | NICE |
| Teleporters, fishing, Steam Workshop | ❌ | NICE / skip |
| Hidden routes: vents, manholes, climbable walls | ❌ | MUST: window vaulting; NICE: manholes |
| Rebindable keys | ❌ | NICE |
| Autosave backups | 🟡 local + server sync | ok |

## What critics complained about (things to avoid)

- The loop gets repetitive and most runs bring back little. Our answer: tasks, boss drops, airdrops/heli
  crashes, and base stations that turn materials into progress.
- No gamepad. Ours is a browser game; gamepad is NICE.
- Systems aren't explained, e.g. mods are applied from the inventory after crafting. Our answer: a
  first-raid tutorial plus tooltips.
- AI is either trivial or instantly lethal. Our answer: a difficulty preset, plus reaction time and
  accuracy that scale with distance (now tuned).

## Plan (ordered)

1. **Playability** (this pass)
   - quick-heal fix
   - clear ammo HUD
   - bots don't swarm you on gunfire
   - mouse-driven vision
   - stamina fix
   - real sounds
2. **Animation and character pass**: new skeleton (UAL1+UAL2, 87 clips), female body, unarmed/idle stance,
   vaulting, looting/consume anims, zombie locomotion.
3. **Weapon mods + more guns + item images** in a redesigned inventory.
4. **Secure container + difficulty settings** (death grave on Normal).
5. **Task board (quests) + onboarding tips.**
6. **Hideout stations** (med station, workbench, generator, stash upgrades).
7. **Boss squads + map events** (airdrop, heli crash).
8. **RMB context menu**, furniture, visual upgrade of gear/clothing.
