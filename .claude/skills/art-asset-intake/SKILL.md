---
name: art-asset-intake
description: Intake checklist for any new 3D model, texture, icon, sound or hair/clothing asset in Ashfall (licence, provenance, budgets, nudity default, no real likeness). Use before adding or replacing files in apps/web/public or tools/assets.
---

# Art asset intake

Run before an asset enters the repo. Refuse and tell the user if a hard rule fails.

## Hard rules
- **Licence**: only CC0 or CC-BY (CC-BY 3.0/4.0). Not CC-BY-NC, -ND, -SA, "editorial", "personal use", ripped game assets, or unclear licences. No licence stated = reject.
- **No real-person likeness**: no celebrity or identifiable real person, no scans of named people; face data stays generated (`render/identityData.ts`, `faceIdentity.ts`).
- **Nudity**: default setting is `nevernude` (`apps/web/src/render/nudity.ts`; profile `settings.nudity`). Anatomy stays an optional toggleable mesh group, matter-of-fact and non-sexualised, never default (see `docs/art/anatomy-manifest.json`). No sexualised content.
- Never downloaded from unknown sources by script without the user's OK; state filename, source and size when asking.

## Provenance (every asset)
1. Add an entry to `apps/web/public/models/CREDITS.txt` (models), `apps/web/public/sfx/CREDITS.txt` (sound) or `tools/assets/sketchfab-credits.txt` (Sketchfab pulls), matching the existing format: title, author, licence, source URL, and what was modified (decimated, parts removed, retextured).
2. Record the exact licence text/URL seen on the source page. CC-BY requires attribution: credit must be user-visible somewhere (credits screen/file shipped).
3. If the asset is produced by a script in `tools/assets/` (`build.mjs`, `weapons.mjs`, `vehicles.mjs`, `textures.mjs`), keep the script the source of truth; do not hand-edit generated GLBs.

## Budgets (check, report the real numbers)
- Triangles: props <= 5k, weapons <= 15k, character body + clothing <= 30k per character on screen, vehicles <= 20k. Merge meshes, keep material count low.
- Textures: colour <= 1024, other maps <= 512, WebP/KTX2; no 4k textures.
- Files: meshopt-compressed GLB; any single GLB <= 2 MB, new bundle total delta noted. Check with `ls -l apps/web/public/models` and the `apps/web` build size.
- Skeleton: must rebind to the game skeleton (`render/rebind.ts`); animations from the existing library.

## Verify in game
- Loads with no console errors, correct scale/orientation/pivot (`render/cleanModel.ts`), no z-fighting, fps unchanged on low tier.

## Rules
Report as a table: item | licence | provenance | tris | tex | size | verdict (ACCEPT/REJECT/NEEDS-INFO). No commit/push without explicit OK; do not edit CLAUDE.md or settings.
