// AI body build, step 0: the AI 3D body targets (refs/ai/bodies, git-ignored, never shipped) as raw arrays for
// ai_body_fit.py: positions (glTF Y-up, the file's own frame and scale), triangles, UVs and the base-colour texture.
//   node ai_body_target.mjs   -> ai/fit/<sex>/target_{pos,idx,uv}.bin, target_albedo.<ext>, target.json
//   (+ the SAM 3D Body pair: ai/fit/<sex>/sam_{pos,idx}.bin, person_00 = man, person_01 = woman)
// (Thin wrapper: `node ai3d.mjs fit <id>` runs it as the `target` stage from the subject's config; code in ai3d/lib/glb.mjs.)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dumpTarget, dumpSam } from './ai3d/lib/glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'refs', 'ai', 'bodies');
const root = process.env.AI3D_FIT_ROOT ? path.resolve(process.env.AI3D_FIT_ROOT) : path.join(here, 'ai', 'fit');
for (const [sex, file] of [['m', 'man_tripo.glb'], ['f', 'woman_tripo.glb']]) console.log(sex, JSON.stringify(await dumpTarget(path.join(SRC, file), path.join(root, sex))));
for (const [sex, node] of [['m', 'person_00'], ['f', 'person_01']]) console.log('sam', JSON.stringify(await dumpSam(path.join(SRC, 'pair_sam3dbody.glb'), node, path.join(root, sex))));
