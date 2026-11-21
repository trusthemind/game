// AI body build, step 1: dump the game's MPFB body (base/human_{m,f}_mpfb_id.glb, the input of build.mjs ONLY=mpfb) as
// raw arrays for ai_body_fit.py (Blender python): rest positions / normals / UVs / indices / skin of body, underwear
// and anatomy (glTF Y-up model space, vertex order as in the GLB), the joints' rest world matrices and parents.
//   node ai_body_dump.mjs [m|f]   -> ai/fit/<sex>/*.bin + meta.json
// (Thin wrapper: `node ai3d.mjs fit <id>` runs it as the `dump` stage; the code is ai3d/lib/glb.mjs dumpBody.)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dumpBody } from './ai3d/lib/glb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.AI3D_FIT_ROOT ? path.resolve(process.env.AI3D_FIT_ROOT) : path.join(here, 'ai', 'fit');
for (const sex of process.argv[2] ? [process.argv[2]] : ['m', 'f']) {
  const { meta, joints } = await dumpBody(path.join(here, 'base', `human_${sex}_mpfb_id.glb`), path.join(root, sex));
  console.log(sex, JSON.stringify(meta.meshes), 'joints', joints);
}
