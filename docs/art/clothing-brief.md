# Art direction brief: clothing and armour on characters

Follows the `create-game-assets` skill (gamedev-skills/awesome-gamedev-agent-skills). Manifest: `clothing-manifest.json`.

## Game frame

- Player fantasy: a scavenger in a post-Soviet exclusion zone (Ukraine/Russia), Tarkov / Arena Breakout tone.
- Engine and renderer: three.js r186, WebGL2, PBR (MeshStandardMaterial), ACES tone mapping, fog of war shader patch.
- Camera/view: top-down perspective, ~60° pitch, camera north-looking; characters ~40–60 px tall in raid; ~300 px in
  the hideout preview; 96–160 px item icons.
- Skeleton: our UE-mannequin rig (pelvis, spine_01..03, clavicle, upperarm, lowerarm, hand, thigh, calf, foot, ball).

## Visual system

- Shape language: realistic, practical, worn; real garment silhouettes (collars, hoods, pockets, boots), no stylised
  or toon proportions.
- Silhouette priorities at game scale: top colour/pattern mass, trouser colour, headwear; boots read as a dark base.
- Palette roles: drab military (olive, flora, desert, ACU grey), civilian darks (black, brown leather, denim), police
  navy. No saturated toy colours; bright accents only as small trim (a scarf).
- Materials: textured PBR cloth, leather, rubber; no flat procedural dye.
- Detail density: from source textures (seams, pockets, folds); nothing added that only reads when zoomed in.
- Explicit exclusions: procedurally generated garments, fantasy/medieval pieces, cartoon puffers, ripped game assets,
  anything not CC0 / CC BY.

## Technical contract

- Source: rigged Sketchfab models (CC0/CC BY) with clothes as separate meshes, downloaded by
  `tools/assets/sketchfab.mjs`, built by `tools/assets/build.mjs` (BODIES: body/face/hair dropped, decimated,
  WebP textures, meshopt) into `apps/web/public/models/bodies/`.
- Fitting: `fitToRest` (apps/web/src/render/rebind.ts) carries each source joint onto our rest pose, so pieces from
  different models combine on one body. Our body is hidden under each worn piece (region mask).
- Budget: ≤ 10k triangles per source file after decimation; colour textures 1K, others 512.
- Item ↔ garment mapping: `apps/web/src/render/clothKit.ts` (CLOTH_KIT).

## Visual target

- Approved seed: `#charlab?view=wear` — leather bomber + trousers + shoes ("Just man"), survivor outfit (Alan),
  ACU set, flora smock + balaclava (rus_a). Judged in CharLab close-up and at raid camera.
- Don't: shell clothes cut from the body (rejected 09.11), fantasy ranger pieces (rejected), puffer hoodie (rejected).
- Approval owner/date: Fedir delegated the choice ("мені похуй як, зроби нормально"), decision recorded 09.11.

## Next: armour

Same pipeline for body armour and helmets (plate carriers, soft vests, helmets) from licensed models, rigid parts on
bones where the model isn't rigged; armour zones and plate inserts come after the visuals.
