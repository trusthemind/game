import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  ALL_ITEMS,
  createEquipment,
  createItem,
  getDef,
  installMod,
  modFits,
  modSlotsFor,
  type Actor,
} from '@ashfall/engine';
import { loadAssets } from '../render/assets';
import { buildGun } from '../render/gunsmith';
import { attachSkinned, cloneHuman } from '../render/human';
import { CharacterView, lookFor, renderPortrait, type Appearance } from '../render/character';
import type { WorldUniforms } from '../render/patches';

/** Dev-only lineup of characters/outfits/weapons (open /#charlab). Used for visual checks and screenshots. */
export function CharLab() {
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
    loadAssets().then((lib) => {
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
            if (modded)
              for (const ms of modSlotsFor(id)) {
                const fit = ALL_ITEMS.find((d) => d.mod?.slot === ms && modFits(d.id, id));
                if (fit) installMod(it, createItem(fit.id));
              }
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
      cast.forEach((c, i) => {
        const eq = createEquipment();
        for (const e of c.eq) {
          const [def, slot] = e.split(':') as [string, keyof typeof eq.slots];
          eq.slots[slot] = createItem(def);
          const it = eq.slots[slot]!;
          if (c.modded && getDef(def).weapon)
            for (const ms of modSlotsFor(def)) {
              const fit = ALL_ITEMS.find((d) => d.mod?.slot === ms && modFits(d.id, def));
              if (fit) installMod(it, createItem(fit.id));
            }
        }
        const v = new CharacterView(lib, c.look, u, true);
        const a = {
          pos: {
            x:
              (i - (cast.length - 1) / 2) *
              (view === 'guns' || view === 'gear' || view.startsWith('melee') || view === 'hats'
                ? view === 'hats'
                  ? 0.55
                  : view.startsWith('melee')
                    ? 0.85
                    : 1.05
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
                  : Math.PI / 2,
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
      view === 'treat'
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
