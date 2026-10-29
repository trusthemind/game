import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createEquipment, createItem, type Actor } from '@ashfall/engine';
import { loadAssets } from '../render/assets';
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
    const cast: { look: Appearance; eq: string[]; active: 'primary' | 'secondary' | 'melee'; speed: number; crouch?: boolean }[] = [
      { look: lookFor(0, 'npc', 'lena'), eq: ['pm:secondary', 'b_daypack:backpack'], active: 'secondary', speed: 0 },
      { look: lookFor(0, 'npc', 'mykola'), eq: ['mp133:primary'], active: 'primary', speed: 1.4 },
      { look: lookFor(3, 'raider'), eq: ['m4a1:primary', 'trooper:armor', 'zsh:helmet', 'r_alpha:rig', 'b_pilgrim:backpack'], active: 'primary', speed: 0 },
      { look: lookFor(9, 'scav'), eq: ['ak74m:primary', 'paca:armor', 'r_scav:rig'], active: 'primary', speed: 3.2 },
      { look: lookFor(0, 'npc', 'vera'), eq: ['axe:melee'], active: 'melee', speed: 0 },
      { look: lookFor(2, 'boss'), eq: ['pkm:primary', 'slick6:armor', 'altyn:helmet', 'b_attack:backpack'], active: 'primary', speed: 0 },
      { look: lookFor(11, 'scav'), eq: ['svd:primary'], active: 'primary', speed: 0, crouch: true },
      { look: lookFor(5, 'infected'), eq: [], active: 'melee', speed: 1.2 },
    ];
    const views: { v: CharacterView; a: Actor }[] = [];
    loadAssets().then((lib) => {
      cast.forEach((c, i) => {
        const eq = createEquipment();
        for (const e of c.eq) {
          const [def, slot] = e.split(':') as [string, keyof typeof eq.slots];
          eq.slots[slot] = createItem(def);
        }
        const v = new CharacterView(lib, c.look, u, true);
        const a = {
          pos: { x: (i - (cast.length - 1) / 2) * 1.35, y: 0 },
          vel: { x: 0, y: c.speed },
          facing: Math.PI / 2,
          crouching: !!c.crouch,
          sprinting: false,
          eq,
          active: c.active,
          faction: 'npc',
        } as unknown as Actor;
        scene.add(v.root);
        views.push({ v, a });
      });
      for (const id of ['lena', 'mykola', 'vera']) {
        const img = document.createElement('img');
        img.src = renderPortrait(lib, lookFor(0, 'npc', id));
        img.style.cssText = 'position:fixed;top:12px;width:128px;height:128px;border:1px solid #555;left:' + (12 + ['lena', 'mykola', 'vera'].indexOf(id) * 140) + 'px';
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
