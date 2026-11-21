// The stage chains of `ai3d fit` (and the render stage the gates use), per subject kind. Each stage lists its inputs,
// scripts, params and outputs for the cache (core.runStages); `run` calls the same scripts the hand workflow did.
import path from 'node:path';
import fs from 'node:fs';
import { PILOT, ROOT, abs, blender, node, grep } from './core.mjs';
import { dumpBody, dumpTarget, dumpSam } from './glb.mjs';

const py = (f) => path.join(PILOT, f);
const COMMON = path.join(PILOT, 'ai3d/lib/py/common.py');
const GLB = path.join(PILOT, 'ai3d/lib/glb.mjs');
const num = (v, d) => (v === undefined || v === null ? d : v);

export function bodyDirs(ctx) {
  const { S } = ctx;
  const d = ctx.workDir;
  return {
    d,
    baseGlb: path.join(PILOT, 'base', `human_${S.sex}_mpfb_id.glb`),
    aiGlb: path.join(ctx.baseDir, `human_${S.sex}_mpfb_ai.glb`),
    texN: path.join(ctx.texDir, 'ai_body', `n_${S.sex}.webp`),
    texC: path.join(ctx.texDir, 'ai_body', `c_${S.sex}.webp`),
  };
}

export function bodyStages(ctx) {
  const { S } = ctx;
  const D = bodyDirs(ctx);
  const f = (n) => path.join(D.d, n);
  const uw = S.underwear ?? {};
  const po = S.posture ?? {};
  const env = {
    ...(uw.luma !== undefined ? { AIB_UW_LUMA: String(uw.luma) } : {}),
    ...(uw.rb !== undefined ? { AIB_UW_RB: String(uw.rb) } : {}),
    ...(po.abdomenEase !== undefined ? { AIB_ABD: String(po.abdomenEase) } : {}),
    ...(po.upperBackEase !== undefined ? { AIB_UBK: String(po.upperBackEase) } : {}),
    ...(po.neckGirth !== undefined ? { AIB_NECK: String(po.neckGirth) } : {}),
    ...(S.orientation?.yawDeg !== undefined && S.orientation?.yawDeg !== null ? { AIB_YAW: String(S.orientation.yawDeg) } : {}),
  };
  const src = abs(S.source.glb);
  return [
    {
      name: 'dump', scripts: [GLB], inputs: [D.baseGlb], outputs: [f('meta.json'), f('body_pos.bin'), f('joints_world.bin')],
      run: async () => { const r = await dumpBody(D.baseGlb, D.d); return `our body ${r.meta.meshes.body.verts} verts, ${r.joints} joints`; },
    },
    {
      name: 'target', scripts: [GLB], inputs: [src, S.source.sam ? abs(S.source.sam.glb) : null], outputs: [f('target_pos.bin'), f('target.json')],
      run: async () => {
        const t = await dumpTarget(src, D.d);
        if (S.source.sam) await dumpSam(abs(S.source.sam.glb), S.source.sam.node, D.d);
        return `target ${(t.verts / 1000).toFixed(0)}k verts, albedo ${t.size.join('x')}`;
      },
    },
    {
      name: 'fit', scripts: [py('ai_body_fit.py'), COMMON], params: env, outputs: [f('ai_body_delta.bin'), f('fit.json'), f('fit_state.npz')],
      run: async (c) => {
        const lines = await blender(c, 'fit', py('ai_body_fit.py'), [S.sex], env);
        const j = JSON.parse(fs.readFileSync(f('fit.json'), 'utf8'));
        const r = j.rms_after_mm;
        return `yaw ${j.yaw_deg.toFixed(0)} scale ${j.scale.toFixed(3)}  RMS mm torso ${r.torso.toFixed(1)} arms ${r.arms.toFixed(1)} legs ${r.legs.toFixed(1)}`;
      },
    },
    {
      name: 'bake', scripts: [py('ai_body_bake.py'), py('skin_bake.py'), COMMON], params: { res: num(S.build?.bakeRes, 2048) }, outputs: [f('ai_n.png'), f('ai_c.png')],
      run: async (c) => { await blender(c, 'bake', py('ai_body_bake.py'), [S.sex, String(num(S.build?.bakeRes, 2048))]); return 'normal + albedo-ratio baked on our UVs'; },
    },
    {
      name: 'add', scripts: [py('ai_body_add.mjs')], inputs: [D.baseGlb], params: { tex: num(S.build?.texSize, 1024) }, outputs: [D.aiGlb, D.texN, D.texC],
      run: async (c) => {
        const l = node(c, 'add', py('ai_body_add.mjs'), [S.sex, String(num(S.build?.texSize, 1024))]);
        return grep(l, /max \|d\|/).join(' ');
      },
    },
  ];
}

/** Check-only stage: silhouette masks / heat renders of the fitted body over the target (Blender workbench, fast). */
export function bodyRenderStage(ctx) {
  const d = ctx.workDir;
  return {
    name: 'render', scripts: [py('ai_body_render.py'), COMMON], outputs: ['s_fit_front_ours', 's_fit_side_ours', 's_fit_front_target', 's_fit_side_target', 'r_fit_front_heat'].map((n) => path.join(d, n + '.png')).concat(path.join(d, 'dist_fit.npy')),
    run: async (c) => { await blender(c, 'render', py('ai_body_render.py'), [c.S.sex, 'fit']); return 'front/side/back renders + heat'; },
  };
}

export function faceDirs(ctx) {
  const { S } = ctx;
  const sd = path.join(ctx.identDir, S.sex);
  return { w: ctx.workDir, sd, hair: path.join(ctx.identDir, 'hair') };
}

export function faceStages(ctx) {
  const { S } = ctx;
  const D = faceDirs(ctx);
  const src = abs(S.source.glb);
  const yaw = num(S.orientation?.yawDeg, 0);
  const baseSkin = S.source.baseSkin ? abs(S.source.baseSkin) : null;
  const w = (n) => path.join(D.w, n);
  const env = { AI3D_IDENT: S.id, AI3D_SEX: S.sex };
  const idf = (g, ext = 'bin') => path.join(D.sd, `${g}_${S.id}.${ext}`);
  const stages = [
    {
      name: 'prep', scripts: [py('ai3d_prep.py')], inputs: [src, baseSkin], params: { yaw }, outputs: [w('mesh.npz'), w('color.png'), w('orm.png'), w(`base_skin_${S.sex}.png`)],
      run: async (c) => {
        fs.mkdirSync(D.w, { recursive: true });
        const l = await blender(c, 'prep', py('ai3d_prep.py'), [src, D.w, String(yaw)]);
        if (baseSkin && path.resolve(baseSkin) !== path.resolve(w(`base_skin_${S.sex}.png`))) fs.copyFileSync(baseSkin, w(`base_skin_${S.sex}.png`));
        return grep(l, /^PREP \d+ verts/).join(' ');
      },
    },
    {
      name: 'base', scripts: [py('build_identities.py'), py('build_base.py'), py('skin_bake.py'), py('ai_skin.py'), py('gen_cast.py'), COMMON], inputs: [py('identities.json')],
      outputs: [path.join(ctx.identDir, 'm', 'meta.json'), path.join(D.sd, 'meta.json'), path.join(D.sd, 'body_base.bin')],
      run: async (c) => { await blender(c, 'base', py('build_identities.py'), []); return 'all MPFB identities + hair assets (both sexes)'; },
    },
    {
      name: 'fit', scripts: [py('ai3d_fit.py'), COMMON], inputs: [w('mesh.npz'), w('color.png'), w('orm.png')], params: { tone: S.tone ?? '6b4430', ...env },
      outputs: [idf('body'), idf('skin'), idf('eyes', 'png'), idf('brow', 'png'), w('fit.npz')],
      run: async (c) => {
        const l = await blender(c, 'fit', py('ai3d_fit.py'), [D.w, S.tone ?? '6b4430'], env);
        const m = JSON.parse(fs.readFileSync(path.join(D.sd, 'meta.json'), 'utf8')).identities.find((e) => e.id === S.id)?.ai3d ?? {};
        return `RMS ours->AI ${m.ours_to_ai_rms_mm?.toFixed(2)} mm (p95 ${m.ours_to_ai_p95_mm?.toFixed(1)}), AI->ours ${m.ai_to_ours_rms_mm?.toFixed(2)}`;
      },
    },
  ];
  const hair = S.parts?.hair;
  if (hair) {
    const hp = (e) => path.join(D.hair, `${S.sex}_${hair.name}${e}`);
    stages.push({
      name: 'hair', scripts: [py('ai3d_hair.py'), COMMON], inputs: [w('fit.npz')], params: { name: hair.name }, outputs: [hp('_pos.bin'), hp('_idx.bin'), hp('_uv.bin'), hp('.json')],
      run: async (c) => { await blender(c, 'hair', py('ai3d_hair.py'), [D.w], { ...env, AI3D_HAIR_NAME: hair.name }); return `hair ${hair.name}`; },
    });
  }
  stages.push({
    name: 'add', scripts: [py('add_identities.mjs')], inputs: [D.sd, D.hair, path.join(PILOT, 'base', `human_${S.sex}_mpfb.glb`), py('identities.json')],
    outputs: [path.join(ctx.baseDir, `human_${S.sex}_mpfb_id.glb`), path.join(ctx.texDir, 'ident', `face_${S.sex}.webp`)],
    run: async (c) => { const l = node(c, 'add', py('add_identities.mjs'), []); return grep(l, /^\w+ body targets/).join(' ') || 'morph targets + atlases + identityData.ts'; },
  });
  return stages;
}

export function faceRenderStage(ctx) {
  const D = faceDirs(ctx);
  const pre = path.join(D.w, 'chk');
  return {
    name: 'render', scripts: [py('ai3d_check.py')], inputs: [path.join(D.w, 'fit.npz')], outputs: ['ours_0', 'ours_35', 'ours_90', 'heat_0', 'heat_90', 'overlay_35', 'ai_0', 'ai_35', 'ai_90'].map((n) => `${pre}_${n.replace(/_(\d+)$/, '_$1')}.png`),
    run: async (c) => {
      const l = await blender(c, 'render', py('ai3d_check.py'), [D.w, pre, 'ai,ours,heat,overlay']);
      const m = grep(l, /^CHECK done/)[0]?.split(' ')[2];
      if (m) fs.writeFileSync(`${pre}_rms.json`, JSON.stringify({ rms_m: Number(m) }));
      return 'ai / ours / heat / overlay x front,3/4,profile';
    },
  };
}

export const stagesFor = (ctx) => (ctx.S.kind === 'face' ? faceStages(ctx) : bodyStages(ctx));
export const renderStageFor = (ctx) => (ctx.S.kind === 'face' ? faceRenderStage(ctx) : bodyRenderStage(ctx));
export { ROOT };
