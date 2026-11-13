import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ALL_ITEMS,
  createEquipment,
  generateLoadout,
  Rng,
  type BotArchetype,
  createItem,
  getDef,
  installPart,
  partFits,
  socketTree,
  type Actor,
  type ItemInstance,
} from '@ashfall/engine';
import { BODY_IDS, CLOTH_SOURCES, loadAssets, loadBodies } from '../render/assets';
import { buildGun } from '../render/gunsmith';
import { GEAR_MODEL, wornGear } from '../render/gearModels';
import { assembleGun, loadWeaponParts } from '../render/weaponAssembly';
import { attachSkinned, cloneHuman } from '../render/human';
import { actorLook, CharacterView, lookFor, renderPortrait, type Appearance } from '../render/character';
import { SHAPE_PRESETS, shapeStats } from '../render/bodyShape';
import { FACE_PRESETS } from '@ashfall/engine';
import type { WorldUniforms } from '../render/patches';
import { RandomLooks, StyleGrid } from './RandomLooks';

/** Dev-only lineup of characters/outfits/weapons (open /#charlab). Used for visual checks and screenshots. */
/** Fill every empty socket with the first part that fits (rails a part brings get filled too). */
function modAll(it: ItemInstance): void {
  for (let i = 0, t = socketTree(it); i < t.length; i++) {
    const r = t[i]!;
    if (r.part) continue;
    const fit = ALL_ITEMS.find((d) => partFits(d.id, r.socket, r.host.def, it.def));
    if (fit && installPart(it, r.path, createItem(fit.id))) t = socketTree(it);
  }
}

export function CharLab() {
  const view = new URLSearchParams(location.hash.split('?')[1] ?? '').get('view');
  return view === 'randoms' ? <RandomLooks /> : view === 'hair' || view === 'beards' ? <StyleGrid /> : <CharLabScene />;
}

function CharLabScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const renderer = new THREE.WebGLRenderer({ canvas: ref.current!, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d1b);
    const cam = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
    const view = new URLSearchParams(location.hash.split('?')[1] ?? '').get('view') ?? 'front';
    if (view === 'top') {
      cam.position.set(0, 13, 7.5);
      cam.lookAt(0, 0, 0);
    } else {
      cam.position.set(0, 2.0, 9.5);
      cam.lookAt(0, 1.1, 0);
    }
    scene.add(new THREE.HemisphereLight(0xd8e4ea, 0x3a3428, 1.2));
    const sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
    sun.position.set(3, 8, 6);
    sun.castShadow = true;
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x3a3f33 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const u: WorldUniforms = {
      uFow: { value: new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1) },
      uMapSize: { value: new THREE.Vector2(1, 1) },
      uPlayer: { value: new THREE.Vector3(0, -100, 0) },
      uFowOn: { value: 0 },
    };
    (u.uFow.value as THREE.DataTexture).needsUpdate = true;
    const cast: {
      look: Appearance;
      eq: string[];
      active: 'primary' | 'secondary' | 'melee';
      speed: number;
      crouch?: boolean;
      modded?: boolean;
      use?: string;
      part?: string;
      reload?: boolean;
    }[] = [
      { look: lookFor(0, 'npc', 'lena'), eq: ['pm:secondary', 'b_daypack:backpack'], active: 'secondary', speed: 0 },
      { look: lookFor(0, 'npc', 'mykola'), eq: ['mp133:primary'], active: 'primary', speed: 1.4 },
      {
        look: lookFor(3, 'raider'),
        eq: ['m4a1:primary', 'trooper:armor', 'zsh:helmet', 'r_alpha:rig', 'b_pilgrim:backpack'],
        active: 'primary',
        speed: 0,
      },
      { look: lookFor(9, 'scav'), eq: ['ak74m:primary', 'paca:armor', 'r_scav:rig'], active: 'primary', speed: 3.2 },
      { look: lookFor(0, 'npc', 'vera'), eq: ['axe:melee'], active: 'melee', speed: 0 },
      {
        look: lookFor(2, 'boss'),
        eq: ['pkm:primary', 'slick6:armor', 'altyn:helmet', 'b_attack:backpack'],
        active: 'primary',
        speed: 0,
      },
      { look: lookFor(11, 'scav'), eq: ['svd:primary'], active: 'primary', speed: 0, crouch: true },
      { look: lookFor(5, 'infected'), eq: [], active: 'melee', speed: 1.2 },
      { look: lookFor(14, 'scav'), eq: [], active: 'melee', speed: 0 },
      { look: lookFor(15, 'scav'), eq: [], active: 'melee', speed: 1.4 },
    ];
    if (view === 'bodies' || view === 'crowd') {
      // Bots as the raid dresses them (generateLoadout: uniforms, armour, helmets, packs) on their seeded looks
      // and body shapes. `&arch=guard` one archetype (default: scav, raider, guard, boss, three each).
      cast.length = 0;
      const only = new URLSearchParams(location.hash.split('?')[1] ?? '').get('arch');
      const archs = (only ? only.split(',') : ['scav', 'raider', 'guard', 'boss']) as BotArchetype[];
      archs.forEach((arch, j) => {
        for (let i = 0; i < (only ? 10 : 3); i++) {
          const seed = j * 100 + i + 7;
          const eq = generateLoadout(arch, new Rng(seed), 2);
          const ids = (Object.entries(eq.slots) as [string, { def: string } | null][]).filter(([sl, it]) => it && sl !== 'secondary' && sl !== 'melee' && sl !== 'secure').map(([sl, it]) => `${it!.def}:${sl}`);
          cast.push({ look: actorLook(lookFor(seed, arch), eq), eq: ids, active: eq.slots.primary ? 'primary' : 'melee', speed: 0 });
        }
      });
      const span = cast.length * 1.35;
      cam.position.set(0, 2.2, Math.max(9.5, span * 1.25));
      cam.lookAt(0, 1.0, 0);
      // Console handle for close-ups: __bodyCam.position.set(…); __bodyCam.lookAt(…).
      (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
    }
    if (view === 'kit') {
      // Each body bare, then in a carrier, helmet and rig. `&ids=m,f` (default: both).
      cast.length = 0;
      // `&kit=gzhel:armor,r_scav:rig` other kit (default: trooper, zsh, r_alpha); `&bare=0` leaves the bare ones out.
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const only = q.get('ids');
      const kit = (q.get('kit') ?? 'trooper:armor,zsh:helmet,r_alpha:rig').split(',').filter(Boolean);
      for (const id of only ? only.split(',') : ['m', 'f']) {
        const look = { ...lookFor(3, 'raider'), sex: id === 'f' ? ('f' as const) : ('m' as const) };
        if (q.get('bare') !== '0') cast.push({ look, eq: ['ak74m:primary'], active: 'primary', speed: 0 });
        cast.push({ look, eq: ['ak74m:primary', ...kit], active: 'primary', speed: 0 });
      }
      cam.position.set(0, 1.75, Math.max(4.5, cast.length * 0.9));
      cam.lookAt(0, 1.3, 0);
      (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
    }
    if (view === 'wear') {
      // Real clothes (clothKit.ts) fitted to our own bodies: outfits from the items, men and women.
      cast.length = 0;
      const outfits: [string, ...string[]][] = [
        ['m', 'c_bomber', 'c_trousers', 'c_shoes'],
        ['m', 'c_knit', 'c_work_pants', 'c_tall_boots', 'c_green_cap'],
        ['m', 'c_acu_shirt', 'c_acu_pants', 'c_combat_boots', 'c_patrol_cap'],
        ['m', 'c_smock', 'c_flora_pants', 'c_kirza', 'c_balaclava'],
        ['m', 'c_kitel', 'c_officer_pants', 'c_officer_boots'],
        ['f', 'c_survivor_top', 'c_kneepad_pants', 'c_survivor_boots'],
        ['f', 'c_police_shirt', 'c_police_pants', 'c_police_shoes'],
        ['m', 'c_knit', 'c_ripped_jeans', 'c_sneakers'],
        ['f', 'c_bomber', 'c_desert_pants', 'c_desert_boots', 'c_balaclava_tan'],
        ['m'],
      ];
      // `&gun=ak74m`: everyone aiming it, to see the clothes with the arms up. `&fits=m:c_a,c_b;f:c_c` other outfits.
      const wq = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const gun = wq.get('gun');
      const fits = wq.get('fits');
      if (fits) outfits.splice(0, outfits.length, ...fits.split(';').map((f) => [f.split(':')[0]!, ...(f.split(':')[1] ?? '').split(',').filter(Boolean)] as [string, ...string[]]));
      outfits.forEach(([sex, ...ids], i) => {
        const base = lookFor(i + 60, 'scav');
        const eq = [...ids.map((id) => `${id}:${getDef(id).clothing!.slot}`), ...(gun ? [`${gun}:primary`] : [])];
        cast.push({ look: { ...base, sex: sex as 'm' | 'f', hair: sex === 'f' ? 'ponytail' : base.hair, hat: null, clothed: true }, eq, active: gun ? 'primary' : 'melee', speed: 0 });
      });
      cam.position.set(0, 1.5, 10);
      cam.lookAt(0, 1.0, 0);
      (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
    }
    if (view === 'headwear') {
      // Hair and beards under headwear: each look bare, in a cap, a helmet and a balaclava.
      // `&looks=m:afro:full,f:wavy:none` (sex:hair:beard).
      cast.length = 0;
      const hq = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const looks = (hq.get('looks') ?? 'm:afro:full,f:wavy:none,f:ponytail:none').split(',').map((l) => l.split(':'));
      const heads = ['', 'c_green_cap:hat', 'zsh:helmet', 'c_balaclava:hat'];
      for (const [sex, hair, beard] of looks)
        for (const h of heads)
          cast.push({
            look: { ...lookFor(61, 'scav'), sex: sex === 'f' ? 'f' : 'm', hair: hair!, beard: beard ?? 'none', hat: null, clothed: true },
            eq: ['c_knit:top', 'c_trousers:pants', 'c_shoes:boots', ...(h ? [h] : [])],
            active: 'melee',
            speed: 0,
          });
      cam.position.set(0, 2.0, 6.5);
      cam.lookAt(0, 1.45, 0);
      (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
    }
    if (view === 'armor') {
      // Every body armour and rig (armorKit.ts) on the same body in the same clothes, so the fit of each piece
      // can be compared: `&ids=trooper,paca` picks some, `&sex=f` a woman, `&top=c_bomber` other clothes,
      // `&gun=ak74m` aiming.
      cast.length = 0;
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const ids = (q.get('ids') ?? 'paca,6b23,trooper,pc_tan,gzhel,slick6,r_scav,r_mbss,r_alpha,r_bank').split(',');
      const sex = q.get('sex') === 'f' ? 'f' : 'm';
      const top = q.get('top') ?? 'c_knit';
      const bottoms = [top, 'c_trousers', 'c_shoes'];
      ids.forEach((id, i) => {
        const base = lookFor(60, 'scav');
        const cat = getDef(id).category;
        const slot = cat === 'helmet' || cat === 'rig' || cat === 'backpack' ? cat : 'armor';
        // `&with=trooper,r_alpha`: more kit on each (armour and a rig under a backpack).
        const more = (q.get('with') ?? '').split(',').filter(Boolean).map((w) => {
          const c = getDef(w).category;
          return `${w}:${c === 'helmet' || c === 'rig' || c === 'backpack' ? c : 'armor'}`;
        });
        // `&gun=ak74m`: aiming it (arms up: shoulder guards and side panels against the arms).
        const gun = q.get('gun');
        const eq = [...bottoms.map((c) => `${c}:${getDef(c).clothing!.slot}`), `${id}:${slot}`, ...more, ...(slot === 'armor' ? ['ssh36:helmet'] : []), ...(gun ? [`${gun}:primary`] : [])];
        cast.push({ look: { ...base, sex, hat: null, clothed: true }, eq, active: gun ? 'primary' : 'melee', speed: 0 });
        void i;
      });
      cam.position.set(0, 1.45, Math.max(3.2, ids.length * 0.7));
      cam.lookAt(0, 1.1, 0);
      (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
    }
    if (view === 'shapes') {
      // Body shapes (bodyShape.ts): the same clothes and armour on every preset, fitted once to the neutral body and
      // displaced with it. `&sex=f`, `&armor=0` without the vest, `&top=c_knit` other clothes, `&gun=ak74m` aiming.
      cast.length = 0;
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const sex: 'm' | 'f' = q.get('sex') === 'f' ? 'f' : 'm';
      const presets = SHAPE_PRESETS[sex];
      const gun = q.get('gun');
      const wear = [q.get('top') ?? 'c_bomber', 'c_trousers', 'c_shoes'].map((c) => `${c}:${getDef(c).clothing!.slot}`);
      // `&eq=b_attack:backpack,ssh68:helmet` more kit (rigid gear rides on the shaped body).
      const kit = [...(q.get('armor') === '0' ? [] : ['trooper:armor']), ...(q.get('eq') ?? '').split(',').filter(Boolean)];
      for (const name of Object.keys(presets)) {
        const base = lookFor(61, 'scav');
        const look = { ...base, sex, hair: sex === 'f' ? ('ponytail' as const) : ('messy' as const), hat: null, clothed: true, shape: presets[name] };
        cast.push({ look, eq: [...wear, ...kit, ...(gun ? [`${gun}:primary`] : [])], active: gun ? 'primary' : 'melee', speed: 0 });
      }
      cam.position.set(0, 1.45, Math.max(3.4, cast.length * 0.8));
      cam.lookAt(0, 1.0, 0);
      (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
      (window as unknown as { __shapeStats: unknown }).__shapeStats = shapeStats;
    }
    if (view === 'faceshapes') {
      // Faces (shape.ts FACE_PRESETS) side by side, bare-headed, close up: `&sex=f`.
      cast.length = 0;
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
      const sex: 'm' | 'f' = q.get('sex') === 'f' ? 'f' : 'm';
      for (const name of Object.keys(FACE_PRESETS)) {
        const look = { ...lookFor(61, 'scav'), sex, hair: sex === 'f' ? ('bob' as const) : ('buzz' as const), beard: 'none', hat: null, clothed: true, shape: SHAPE_PRESETS[sex].average, face: FACE_PRESETS[name] };
        cast.push({ look, eq: ['c_bomber:top', 'c_trousers:pants', 'c_shoes:boots'], active: 'melee', speed: 0 });
      }
      cam.position.set(0, 1.62, 2.6);
      cam.lookAt(0, 1.6, 0);
      (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
    }
    if (view === 'gestures') {
      // Reloads and treatment by hand, looping: AK, pistol, pump gun; dressing an arm, a leg, splint, injector.
      cast.length = 0;
      const base = (i: number) => ({ ...lookFor(i + 3, 'raider'), sex: 'm' as const });
      cast.push({ look: base(0), eq: ['ak74m:primary'], active: 'primary', speed: 0, reload: true });
      cast.push({ look: base(1), eq: ['pm:secondary'], active: 'secondary', speed: 0, reload: true });
      cast.push({ look: base(2), eq: ['mp133:primary'], active: 'primary', speed: 0, reload: true });
      cast.push({ look: base(3), eq: [], active: 'melee', speed: 0, use: 'bandage', part: 'leftArm' });
      cast.push({ look: base(4), eq: [], active: 'melee', speed: 0, use: 'esmarch', part: 'rightLeg' });
      cast.push({ look: base(5), eq: [], active: 'melee', speed: 0, use: 'splint', part: 'leftLeg' });
      cast.push({ look: base(6), eq: [], active: 'melee', speed: 0, use: 'morphine', part: 'thorax' });
      cam.position.set(0, 2.6, 7.5);
      cam.lookAt(0, 1.0, 0);
      // Console handle: __gest.u = 0.4 pins the phase (null runs the loop); __gest.look(i, 'front'|'side'|'top') frames one actor.
      (window as unknown as { __gest: { u: number | null; solo: number | null; [k: string]: unknown } }).__gest = {
        u: null,
        views: () => views,
        solo: null as number | null,
        look(i: number, from: 'front' | 'left' | 'right' | 'top' | 'back' | 'game' | 'gameback' = 'front', dist = 1.6, y = 0.95) {
          this.solo = i;
          const p = views[i]!.v.root.position;
          const [x, z] = [p.x, p.z];
          // The cast faces +z: 'left' / 'right' are the actor's own sides, seen from the front quarter.
          if (from === 'front') cam.position.set(x, y + 0.35, z + dist);
          if (from === 'back') cam.position.set(x, y + 0.45, z - dist);
          if (from === 'left') cam.position.set(x + dist * 0.8, y + 0.3, z + dist * 0.6);
          if (from === 'right') cam.position.set(x - dist * 0.8, y + 0.3, z + dist * 0.6);
          if (from === 'top') cam.position.set(x, y + dist, z + dist * 0.45);
          // The raid camera's pitch (19 up, 11.5 back), facing the actor or from behind.
          if (from === 'game') cam.position.set(x, y + dist * 0.855, z + dist * 0.518);
          if (from === 'gameback') cam.position.set(x, y + dist * 0.855, z - dist * 0.518);
          cam.lookAt(x, y, z);
        },
      };
      const fill = new THREE.DirectionalLight(0xffffff, 1.6);
      fill.position.set(0, 3, 8);
      scene.add(fill);
    }
    if (view === 'gear') {
      // Close-up of worn kit: every helmet / armour / rig / backpack on someone.
      cast.length = 0;
      const kits = [
        ['ak74m:primary', 'paca:armor', 'ssh68:helmet', 'r_scav:rig', 'b_sling:backpack'],
        ['m4a1:primary', 'trooper:armor', 'zsh:helmet', 'r_alpha:rig', 'b_pilgrim:backpack'],
        ['pkm:primary', 'slick6:armor', 'altyn:helmet', 'b_attack:backpack'],
        ['akm:primary', '6b23:armor', 'r_bank:rig', 'b_daypack:backpack'],
        ['svd:primary', 'gzhel:armor', 'r_mbss:rig'],
      ];
      kits.forEach((eq, i) =>
        cast.push({ look: lookFor(i + 3, i % 2 ? 'raider' : 'scav'), eq, active: 'primary', speed: 0 }),
      );
      cam.position.set(0, 1.9, 5.2);
      cam.lookAt(0, 1.2, 0);
    }
    if (view === 'hats') {
      // Headwear and prints up close.
      cast.length = 0;
      const hats: [string, number, string][] = [
        ['beanie', 0x1e1e1e, 'stripes'],
        ['cap', 0x2f3b2a, 'plaid'],
        ['ushanka', 0x3b3f46, 'plain'],
        ['bandana', 0x6a1f1c, 'stripes'],
        ['beanie', 0x5a3a24, 'woodland'],
      ];
      hats.forEach(([hat, hatColor, pat], i) =>
        cast.push({
          look: {
            ...lookFor(i + 80, 'scav'),
            hat: hat as never,
            hatColor,
            topPattern: pat as never,
            ...(pat === 'stripes' ? { top: 0x1d2c5a, accent: 0xe8e8e0 } : {}),
          },
          eq: [],
          active: 'melee',
          speed: 0,
        }),
      );
      cam.position.set(0, 1.6, 2.9);
      cam.lookAt(0, 1.35, 0);
    }
    if (view === 'treat') {
      // Treating wounds: kneeling surgery, wrapping, injecting, drinking, and bandaging on the move.
      cast.length = 0;
      ['surv12', 'ifak', 'splint', 'morphine', 'water', 'bandage'].forEach((id, i) =>
        cast.push({
          look: lookFor(i + 90, 'scav'),
          eq: ['ak74m:primary'],
          active: 'primary',
          speed: i === 5 ? 0.8 : 0,
          use: id,
        }),
      );
      cam.position.set(0, 1.7, 5.2);
      cam.lookAt(0, 0.9, 0);
    }
    if (view === 'melee' || view === 'melee2') {
      // Every melee weapon in a hand, to check the grip.
      cast.length = 0;
      const ids =
        view === 'melee'
          ? ['knife', 'bayonet', 'karambit', 'cleaver', 'machete', 'kukri', 'hatchet']
          : ['tomahawk', 'axe', 'sledge', 'crowbar', 'bat', 'shovel', 'rebar'];
      ids.forEach((id, i) =>
        cast.push({ look: lookFor(i + 60, 'scav'), eq: [`${id}:melee`], active: 'melee', speed: 0 }),
      );
      cam.position.set(0, 1.55, 4.6);
      cam.lookAt(0, 1.1, 0);
    }
    if (view === 'strafe' || view === 'strafetop') {
      // Everyone aims at the camera while walking forward / right / left / back / diagonal.
      cast.length = 0;
      for (let i = 0; i < 5; i++)
        cast.push({ look: lookFor(i + 40, 'scav'), eq: ['ak74m:primary'], active: 'primary', speed: 0 });
      if (view === 'strafetop') cam.position.set(0, 7, 1.2);
      else cam.position.set(0, 2.6, 6.5);
      cam.lookAt(0, 0.9, 0);
    }
    if (view === 'guns') {
      const ids = ALL_ITEMS.filter((d) => d.weapon).map((d) => d.id);
      cast.length = 0;
      ids.forEach((id, i) => {
        const sec = getDef(id).weapon!.cls === 'pistol' || id === 'toz';
        cast.push({
          look: lookFor(i + 20, 'scav'),
          eq: [`${id}:${sec ? 'secondary' : 'primary'}`],
          active: sec ? 'secondary' : 'primary',
          speed: 0,
          modded: i % 2 === 1,
        });
      });
      cam.position.set(0, 1.6, 26);
      cam.lookAt(0, 1.0, 0);
    }
    const views: { v: CharacterView; a: Actor }[] = [];
    const mixers: THREE.AnimationMixer[] = [];
    loadAssets().then(async (lib) => {
      await loadBodies(lib, [...BODY_IDS, ...CLOTH_SOURCES]);
      if (view === 'gearlab') {
        // Raw armour / helmet models from gear.glb, each scaled into a 0.6 m box, as exported (to check which way
        // they face): +X is right, +Z towards the camera. `&ids=altyn,fast` picks some.
        cast.length = 0;
        const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
        const only = q.get('ids');
        // `&items=1`: every item's model as it's worn (turned, one piece of a pack), front should face the camera.
        const items = q.get('items');
        const ids = items && !only ? Object.keys(GEAR_MODEL) : only ? only.split(',') : [...lib.gear.keys()];
        // `&turn=1.57`: all of them turned about Y (radians), to see their sides.
        const spin = Number(q.get('turn') ?? 0);
        (window as unknown as { __gearIds: string[] }).__gearIds = ids;
        ids.forEach((id, i) => {
          const src = items ? wornGear(lib, id) : lib.gear.get(id);
          if (!src) return;
          const o = items ? src : src.clone(true);
          const wrap = new THREE.Group();
          wrap.add(o);
          const b = new THREE.Box3().setFromObject(o);
          const sz = b.getSize(new THREE.Vector3());
          const k = 0.6 / Math.max(sz.x, sz.y, sz.z);
          o.position.sub(b.getCenter(new THREE.Vector3()));
          wrap.scale.setScalar(k);
          wrap.rotation.y = spin;
          wrap.position.set((i - (ids.length - 1) / 2) * 0.8, 0.5, 0);
          scene.add(wrap);
          const ax = new THREE.AxesHelper(0.45);
          ax.position.copy(wrap.position);
          scene.add(ax);
        });
        cam.position.set(0, 1.4, Math.max(3, ids.length * 0.75));
        cam.lookAt(0, 0.5, 0);
        scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        (window as unknown as { __bodyCam: THREE.Camera }).__bodyCam = cam;
      }
      if (view === 'humans') {
        cast.length = 0;
        const styles = [...lib.hair.keys()].filter((k) => k.startsWith('Hair_'));
        let i = 0;
        for (const sex of ['m', 'f'] as const)
          for (const st of styles) {
            const h = cloneHuman(lib, sex);
            if (!h) continue;
            const hair = lib.hair.get(st);
            if (hair) attachSkinned(hair, h.body);
            h.model.position.set(-6 + i * 1.0, 0, 0);
            scene.add(h.model);
            const mixer = new THREE.AnimationMixer(h.model);
            mixer.clipAction(lib.clips.get('Idle_Loop')!).play();
            mixers.push(mixer);
            i++;
          }
        cam.position.set(0, 1.5, 7);
        cam.lookAt(0, 1.2, 0);
      }
      if (view === 'faces') {
        cast.length = 0;
        let i = 0;
        for (const sex of ['m', 'f'] as const)
          for (const st of sex === 'm'
            ? ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Beard']
            : ['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale']) {
            const h = cloneHuman(lib, sex)!;
            attachSkinned(lib.hair.get(st)!, h.body);
            if (st === 'Hair_Beard') attachSkinned(lib.hair.get('Hair_SimpleParted')!, h.body);
            h.model.position.set(-1.25 + i * 0.5, 0, 0);
            scene.add(h.model);
            const mixer = new THREE.AnimationMixer(h.model);
            mixer.clipAction(lib.clips.get('Idle_Loop')!).play();
            mixers.push(mixer);
            i++;
          }
        cam.position.set(0, 1.7, 2.6);
        cam.lookAt(0, 1.55, 0);
        cam.fov = 30;
        cam.updateProjectionMatrix();
      }
      if (view === 'rack') {
        // Gun rack: every firearm side-on, plain (left) and fully modded (right).
        cast.length = 0;
        const ids = ALL_ITEMS.filter((d) => d.weapon).map((d) => d.id);
        ids.forEach((id, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          for (const modded of [false, true]) {
            const it = createItem(id);
            if (modded) modAll(it);
            const g = buildGun(lib, it);
            if (!g) continue;
            g.rotation.y = Math.PI / 2;
            g.position.set(-10.5 + col * 7 + (modded ? 3.2 : 0), 7.2 - row * 1.25, 0);
            g.scale.setScalar(2.2);
            scene.add(g);
          }
        });
        cam.position.set(0, 3.3, 14);
        cam.lookAt(0, 3.3, 0);
        scene.add(new THREE.AmbientLight(0xffffff, 1.4));
        ground.visible = false;
      }
      if (view === 'raw') {
        // A raw download (dev only: copy it under public/_wtmp), side-on and from above, to see what's where.
        cast.length = 0;
        const src = new URLSearchParams(location.hash.split('?')[1] ?? '').get('src') ?? '';
        const g = await new GLTFLoader().loadAsync(src);
        const box = new THREE.Box3().setFromObject(g.scene);
        const size = box.getSize(new THREE.Vector3());
        const k = 1.6 / Math.max(size.x, size.y, size.z);
        g.scene.scale.setScalar(k);
        // The model's +Z to the right; above it the same from the top (+Y towards the camera).
        const side = new THREE.Group().add(g.scene);
        side.rotation.y = Math.PI / 2;
        side.position.set(0, 1.75, 0);
        const top = new THREE.Group().add(g.scene.clone());
        top.rotation.set(Math.PI / 2, Math.PI / 2, 0, 'YXZ');
        top.position.set(0, 0.85, 0);
        scene.add(side, top);
        cam.position.set(0, 1.3, 3.2);
        cam.lookAt(0, 1.3, 0);
        scene.add(new THREE.AmbientLight(0xffffff, 1.6));
        ground.visible = false;
      }
      if (view === 'parts') {
        // Guns built from parts (models/ak.glb…), side-on: the factory gun and two builds, sockets as red dots.
        cast.length = 0;
        const parts = await loadWeaponParts();
        const builds: [string, [string[], string][]][] = [
          ['ak74m', []],
          ['ak74m', [[['pgrip'], 'ak_pg_rk9'], [['gastube'], 'ak_gt_b19'], [['gastube', 'sight'], 'holo'], [['handguard'], 'ak_hg_b10'], [['handguard', 'foregrip'], 'fgrip'], [['stock'], 'ak_st_pt1'], [['muzzle'], 'sup_545']]],
          ['ak74m', [[['pgrip'], 'ak_pg_moe'], [['handguard'], 'ak_hg_fab'], [['handguard', 'tactical'], 'tac_light'], [['stock'], 'ak_st_zhukov'], [['side'], 'pso1'], [['muzzle'], 'sup_dtk1p']]],
          ['aks74u', []],
          ['akm', []],
          ['akm', [[['handguard'], 'ak_hg_b10'], [['handguard', 'foregrip'], 'fgrip'], [['stock'], 'ak_st_zhukov'], [['muzzle'], 'sup_762'], [['side'], 'pso1']]],
          ['m4a1', [[['sight'], 'red_dot']]],
          ['m4a1', [[['handguard'], 'ar_hg_ris'], [['handguard', 'foregrip'], 'fgrip'], [['stock'], 'ar_st_ctr'], [['pgrip'], 'ar_pg_ergo'], [['mag'], 'mag_pmag30'], [['sight'], 'scope_4x'], [['barrel', 'muzzle'], 'sup_556']]],
          ['m4a1', [[['barrel'], 'ar_barrel_20'], [['handguard'], 'ar_hg_m16a4'], [['handguard', 'tactical'], 'tac_light'], [['stock'], 'ar_st_a2'], [['mag'], 'mag_stanag60'], [['sight'], 'holo'], [['barrel', 'muzzle'], 'brake']]],
        ];
        builds.forEach(([id, swaps], i) => {
          const it = createItem(id);
          for (const [p, part] of swaps) if (!installPart(it, p, createItem(part))) console.warn('does not fit', id, p.join('/'), part);
          const g = assembleGun(parts, it);
          if (!g) return;
          const dots: THREE.Object3D[] = [];
          g.traverse((o) => o.name.startsWith('socket_') && dots.push(o));
          for (const o of dots) o.add(new THREE.Mesh(new THREE.SphereGeometry(0.008), new THREE.MeshBasicMaterial({ color: 0xff2020 })));
          g.rotation.y = Math.PI / 2;
          g.position.set(i < 3 ? -1.1 : i < 6 ? 0 : 1.1, 1.75 - (i % 3) * 0.42, 0);
          scene.add(g);
        });
        cam.position.set(0, 1.33, 3.6);
        cam.lookAt(0, 1.33, 0);
        scene.add(new THREE.AmbientLight(0xffffff, 1.6));
        ground.visible = false;
      }
      cast.forEach((c, i) => {
        const eq = createEquipment();
        for (const e of c.eq) {
          const [def, slot] = e.split(':') as [string, keyof typeof eq.slots];
          eq.slots[slot] = createItem(def);
          const it = eq.slots[slot]!;
          if (c.modded && getDef(def).weapon) modAll(it);
        }
        const v = new CharacterView(lib, c.look, u, true);
        const a = {
          pos: {
            x:
              (i - (cast.length - 1) / 2) *
              (view === 'guns' || view === 'gear' || view.startsWith('melee') || view === 'hats' || view === 'headwear'
                ? view === 'hats' || view === 'headwear'
                  ? view === 'hats' ? 0.55 : 0.6
                  : view.startsWith('melee')
                    ? 0.85
                    : 1.05
                : view === 'armor' || view === 'shapes'
                  ? 0.8
                  : 1.35),
            y: 0,
          },
          vel: view.startsWith('strafe')
            ? { x: [0, 2.6, -2.6, 0, 1.9][i]!, y: [2.6, 0, 0, -2.0, 1.9][i]! }
            : { x: 0, y: c.speed },
          facing:
            view === 'guns'
              ? 0
              : view.startsWith('melee')
                ? Math.PI / 2 - 0.9
                : view === 'gear'
                  ? Math.PI / 2 + [-0.7, 0.7, 2.6, -0.4, 3.4][i % 5]!
                  : Math.PI / 2 + Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('face') ?? 0),
          crouching: !!c.crouch,
          sprinting: false,
          eq,
          active: c.active,
          faction: 'npc',
          useT: c.use ? 1e9 : 0,
          useDef: c.use ?? null,
          usePart: c.part ?? null,
          reloadT: 0,
        } as unknown as Actor;
        if (view === 'gestures') (a as unknown as { cycle: 'reload' | 'use' | null }).cycle = c.reload ? 'reload' : c.use ? 'use' : null;
        scene.add(v.root);
        views.push({ v, a });
      });
      for (const id of view === 'guns' ||
      view === 'rack' ||
      view === 'gear' ||
      view.startsWith('strafe') ||
      view.startsWith('melee') ||
      view === 'hats' ||
      view === 'treat' ||
      view === 'parts' ||
      view === 'raw' ||
      view === 'kit' ||
      view === 'clothes' ||
      view === 'wear' ||
      view === 'gearlab' ||
      view === 'armor' ||
      view === 'shapes'
        ? []
        : ['lena', 'mykola', 'vera']) {
        const img = document.createElement('img');
        img.src = renderPortrait(lib, lookFor(0, 'npc', id), 512);
        img.style.cssText =
          'position:fixed;top:12px;width:300px;height:300px;border:1px solid #555;left:' +
          (12 + ['lena', 'mykola', 'vera'].indexOf(id) * 310) +
          'px';
        document.body.appendChild(img);
      }
      (window as unknown as { __labReady?: boolean }).__labReady = true;
      (window as unknown as { __lab: unknown }).__lab = views;
      // Close-ups for checking gear: `__look(i, 'front'|'back'|'side'|'top', dist, y | boneName, dy)` shows only
      // the i-th figure, aimed at a height or at a bone.
      (window as unknown as { __look: unknown }).__look = (i: number, mode: string, dist = 1.5, y: number | string = 1.3, dy = 0) => {
        views.forEach((l, j) => l.v.root.children.forEach((ch) => (ch.visible = j === i)));
        const v = views[i]!.v;
        const at = new THREE.Vector3(v.root.position.x, typeof y === 'number' ? y : 0, v.root.position.z);
        if (typeof y === 'string') {
          const re = new RegExp(`^${y}$`, 'i');
          let bone: THREE.Object3D | undefined;
          v.root.traverse((o) => {
            if (!bone && (o as THREE.Bone).isBone && re.test(o.name)) bone = o;
          });
          bone?.getWorldPosition(at);
        }
        at.y += dy;
        const d = ({ front: [0, 0.1, 1], back: [0, 0.1, -1], side: [1, 0.15, 0.6], top: [0, 1.73, 1], q: [0.7, 0.6, 0.7] } as Record<string, number[]>)[mode] ?? [0, 0, 1];
        const n = new THREE.Vector3(d[0], d[1], d[2]).normalize().multiplyScalar(dist);
        cam.position.copy(at).add(n);
        cam.lookAt(at);
        cam.updateMatrixWorld();
      };
    });
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const { v, a } of views) {
        const cyc = (a as unknown as { cycle?: 'reload' | 'use' | null }).cycle;
        // window.__gest.u pins every gesture at one phase (0..1) for frame-by-frame checks.
        const pin = (window as unknown as { __gest?: { u: number | null } }).__gest?.u;
        if (pin != null && pin !== (a as unknown as { pinned?: number }).pinned) {
          // The view takes the timer's length from its first value: start a fresh gesture at full length.
          (a as unknown as { pinned?: number }).pinned = pin;
          if (cyc === 'reload') a.reloadT = 2.6;
          if (cyc === 'use') a.useT = 4.5;
          v.update(a, 0, true, true);
        }
        if (cyc === 'reload') a.reloadT = pin != null ? Math.max(1e-4, 2.6 * (1 - pin)) : Math.max(0, 2.6 - ((now / 1000) % 3.2));
        if (cyc === 'use') a.useT = pin != null ? Math.max(1e-4, 4.5 * (1 - pin)) : Math.max(0.0001, 4.5 - ((now / 1000) % 5));
        v.update(a, dt, true, true);
        const solo = (window as unknown as { __gest?: { solo: number | null } }).__gest?.solo;
        if (solo != null) v.root.visible = views[solo]!.v === v;
        a.pos.y = 0;
        if (view.startsWith('strafe')) a.pos.x = views.indexOf(views.find((w) => w.a === a)!) * 1.3 - 2.6;
      }
      for (const m of mixers) m.update(dt);
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
    };
  }, []);
  return <canvas ref={ref} style={{ width: '100vw', height: '100vh', display: 'block' }} />;
}
