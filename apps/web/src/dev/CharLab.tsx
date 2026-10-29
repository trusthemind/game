import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ALL_ITEMS, createEquipment, createItem, getDef, installMod, modFits, modSlotsFor, type Actor } from '@ashfall/engine';
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
    const cast: { look: Appearance; eq: string[]; active: 'primary' | 'secondary' | 'melee'; speed: number; crouch?: boolean; modded?: boolean }[] = [
      { look: lookFor(0, 'npc', 'lena'), eq: ['pm:secondary', 'b_daypack:backpack'], active: 'secondary', speed: 0 },
      { look: lookFor(0, 'npc', 'mykola'), eq: ['mp133:primary'], active: 'primary', speed: 1.4 },
      { look: lookFor(3, 'raider'), eq: ['m4a1:primary', 'trooper:armor', 'zsh:helmet', 'r_alpha:rig', 'b_pilgrim:backpack'], active: 'primary', speed: 0 },
      { look: lookFor(9, 'scav'), eq: ['ak74m:primary', 'paca:armor', 'r_scav:rig'], active: 'primary', speed: 3.2 },
      { look: lookFor(0, 'npc', 'vera'), eq: ['axe:melee'], active: 'melee', speed: 0 },
      { look: lookFor(2, 'boss'), eq: ['pkm:primary', 'slick6:armor', 'altyn:helmet', 'b_attack:backpack'], active: 'primary', speed: 0 },
      { look: lookFor(11, 'scav'), eq: ['svd:primary'], active: 'primary', speed: 0, crouch: true },
      { look: lookFor(5, 'infected'), eq: [], active: 'melee', speed: 1.2 },
      { look: lookFor(14, 'scav'), eq: [], active: 'melee', speed: 0 },
      { look: lookFor(15, 'scav'), eq: [], active: 'melee', speed: 1.4 },
    ];
    if (view === 'guns') {
      const ids = ALL_ITEMS.filter((d) => d.weapon).map((d) => d.id);
      cast.length = 0;
      ids.forEach((id, i) => {
        const sec = getDef(id).weapon!.cls === 'pistol' || id === 'toz';
        cast.push({ look: lookFor(i + 20, 'scav'), eq: [`${id}:${sec ? 'secondary' : 'primary'}`], active: sec ? 'secondary' : 'primary', speed: 0, modded: i % 2 === 1 });
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
          for (const st of sex === 'm' ? ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Beard'] : ['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale']) {
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
          pos: { x: (i - (cast.length - 1) / 2) * (view === 'guns' ? 1.05 : 1.35), y: 0 },
          vel: { x: 0, y: c.speed },
          facing: view === 'guns' ? 0 : Math.PI / 2,
          crouching: !!c.crouch,
          sprinting: false,
          eq,
          active: c.active,
          faction: 'npc',
        } as unknown as Actor;
        scene.add(v.root);
        views.push({ v, a });
      });
      for (const id of view === 'guns' || view === 'rack' ? [] : ['lena', 'mykola', 'vera']) {
        const img = document.createElement('img');
        img.src = renderPortrait(lib, lookFor(0, 'npc', id), 512);
        img.style.cssText = 'position:fixed;top:12px;width:300px;height:300px;border:1px solid #555;left:' + (12 + ['lena', 'mykola', 'vera'].indexOf(id) * 310) + 'px';
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
        v.update(a, dt, true, true);
        a.pos.y = 0;
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
