import * as THREE from 'three';
import { AIRDROP_FALL, type MapEvent, type Raid } from '@ashfall/engine';
import { radialTexture } from './effects';
import { patchWorldMaterial, type WorldUniforms } from './patches';

/**
 * Visuals for world events: a burning helicopter wreck and airdrop crates that come down under a
 * parachute and pop green marker smoke. Smoke/fire are pooled camera-facing sprites.
 */
interface Puff {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  grow: number;
}

interface Emitter {
  x: number;
  z: number;
  y: number;
  kind: 'smoke' | 'green' | 'fire';
  rate: number;
  acc: number;
  until: number;
}

export class MapEventView {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private cursor = 0;
  private emitters: Emitter[] = [];
  private built = new Set<number>();
  private drops = new Map<number, { crate: THREE.Group; chute: THREE.Mesh }>();
  private fireLights: THREE.PointLight[] = [];
  private time = 0;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private smokeMat = new THREE.SpriteMaterial({ map: radialTexture('rgba(255,255,255,0.55)', 'rgba(255,255,255,0)'), depthWrite: false, transparent: true });

  constructor(private u: WorldUniforms) {
    for (let i = 0; i < 160; i++) {
      const s = new THREE.Sprite(this.smokeMat.clone());
      s.visible = false;
      this.group.add(s);
      this.puffs.push({ sprite: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1 });
    }
  }

  private mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = patchWorldMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }), this.u);
    this.mats.push(m);
    return m;
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    this.geos.push(g);
    return g;
  }

  update(raid: Raid, dt: number): void {
    this.time += dt;
    for (const ev of raid.mapEvents) {
      if (!this.built.has(ev.id)) {
        this.built.add(ev.id);
        if (ev.kind === 'heli') this.buildWreck(ev);
        else this.buildDrop(ev);
      }
      if (ev.kind === 'airdrop') this.updateDrop(raid, ev);
    }
    // Emitters.
    for (const e of this.emitters) {
      if (this.time > e.until) continue;
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.spawn(e);
      }
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const s = p.sprite;
      if (p.life <= 0) {
        s.visible = false;
        continue;
      }
      const t = 1 - p.life / p.max;
      s.position.x += p.vx * dt;
      s.position.y += p.vy * dt;
      s.position.z += p.vz * dt;
      const sc = (0.6 + t * p.grow) * 1.2;
      s.scale.set(sc, sc, 1);
      (s.material as THREE.SpriteMaterial).opacity = Math.sin(Math.min(1, t * 3) * Math.PI * 0.5) * (1 - t) * (p.grow > 3 ? 1 : 0.85);
    }
    for (const l of this.fireLights) l.intensity = 9 + Math.sin(this.time * 23 + l.id) * 2.5 + Math.random() * 2;
  }

  private spawn(e: Emitter): void {
    const p = this.puffs[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.puffs.length;
    const s = p.sprite;
    const m = s.material as THREE.SpriteMaterial;
    if (e.kind === 'fire') {
      m.color.setRGB(2.4, 1.1 + Math.random() * 0.4, 0.3);
      m.blending = THREE.AdditiveBlending;
      p.max = p.life = 0.5 + Math.random() * 0.4;
      p.vy = 1.6;
      p.grow = 0.4;
    } else {
      const green = e.kind === 'green';
      if (green) m.color.setRGB(0.5, 1.6, 0.6);
      else m.color.setRGB(0.16, 0.15, 0.14);
      m.blending = THREE.NormalBlending;
      p.max = p.life = (green ? 6 : 4) + Math.random() * 2.5;
      p.vy = (green ? 1.6 : 1.1) + Math.random() * 0.5;
      p.grow = green ? 3.4 : 2.6;
    }
    // Wind drift.
    p.vx = 0.35 + (Math.random() - 0.5) * 0.3;
    p.vz = 0.15 + (Math.random() - 0.5) * 0.3;
    s.position.set(e.x + (Math.random() - 0.5) * 0.6, e.y, e.z + (Math.random() - 0.5) * 0.6);
    s.visible = true;
  }

  private buildWreck(ev: MapEvent): void {
    const g = new THREE.Group();
    const hull = this.mat(0x3d4a36, { roughness: 0.7, metalness: 0.2 });
    const dark = this.mat(0x1a1c1a, { roughness: 0.9 });
    const glass = this.mat(0x1d2a30, { roughness: 0.15, metalness: 0.5 });
    const scorch = new THREE.MeshBasicMaterial({ color: 0x0a0a08, transparent: true, opacity: 0.75, depthWrite: false });
    this.mats.push(scorch);
    // Fuselage lying on its side, nose cone, cockpit glass, tail boom, fin and broken rotor blades.
    const body = new THREE.Mesh(this.box(4.2, 1.7, 1.9), hull);
    body.position.set(0, 0.85, 0);
    body.rotation.z = 0.12;
    const nose = new THREE.Mesh(this.box(1.1, 1.2, 1.6), hull);
    nose.position.set(2.5, 0.65, 0);
    const cockpit = new THREE.Mesh(this.box(0.9, 0.7, 1.5), glass);
    cockpit.position.set(2.6, 1.15, 0);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 4.4, 8), hull);
    this.geos.push(boom.geometry);
    boom.rotation.z = Math.PI / 2 + 0.08;
    boom.position.set(-4.0, 0.9, 0.25);
    const fin = new THREE.Mesh(this.box(0.9, 1.3, 0.12), hull);
    fin.position.set(-6.1, 1.4, 0.3);
    fin.rotation.z = 0.3;
    g.add(body, nose, cockpit, boom, fin);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(this.box(4.2, 0.06, 0.28), dark);
      const a = i * 2.1 + 0.4;
      blade.position.set(Math.cos(a) * 2.2 - 0.3, 0.12 + i * 0.05, Math.sin(a) * 2.2);
      blade.rotation.set(0.05 * i, -a, 0.12 * (i - 1));
      g.add(blade);
    }
    const crater = new THREE.Mesh(new THREE.CircleGeometry(4.5, 28), scorch);
    this.geos.push(crater.geometry);
    crater.rotation.x = -Math.PI / 2;
    crater.position.y = 0.02;
    g.add(crater);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== crater) (o as THREE.Mesh).castShadow = true;
    });
    g.position.set(ev.x, 0, ev.y);
    g.rotation.y = -ev.angle;
    this.group.add(g);
    this.emitters.push({ x: ev.x + 0.4, z: ev.y, y: 1.6, kind: 'fire', rate: 22, acc: 0, until: Infinity });
    this.emitters.push({ x: ev.x + 0.4, z: ev.y, y: 2.2, kind: 'smoke', rate: 6, acc: 0, until: Infinity });
    const light = new THREE.PointLight(0xff8a3a, 10, 9, 1.6);
    light.position.set(ev.x, 2, ev.y);
    this.group.add(light);
    this.fireLights.push(light);
  }

  private buildDrop(ev: MapEvent): void {
    const crate = new THREE.Group();
    const wood = this.mat(0x4c5a3a, { roughness: 0.85 });
    const band = this.mat(0xd8d2c0, { roughness: 0.7 });
    const box = new THREE.Mesh(this.box(1.3, 0.9, 1.0), wood);
    box.position.y = 0.45;
    const strap1 = new THREE.Mesh(this.box(1.32, 0.92, 0.12), band);
    strap1.position.y = 0.45;
    const strap2 = new THREE.Mesh(this.box(0.12, 0.92, 1.02), band);
    strap2.position.y = 0.45;
    crate.add(box, strap1, strap2);
    crate.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    const chuteGeo = new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6);
    this.geos.push(chuteGeo);
    const chute = new THREE.Mesh(chuteGeo, this.mat(0xc9d3c0, { side: THREE.DoubleSide, roughness: 0.9 }));
    this.group.add(crate, chute);
    this.drops.set(ev.id, { crate, chute });
  }

  private updateDrop(raid: Raid, ev: MapEvent): void {
    const d = this.drops.get(ev.id);
    if (!d) return;
    const t = Math.min(1, (raid.time - ev.at) / AIRDROP_FALL);
    const h = (1 - t) * 34;
    const sway = Math.sin(raid.time * 1.3) * (1 - t) * 1.5;
    d.crate.position.set(ev.x + sway, h, ev.y);
    d.crate.rotation.y = raid.time * 0.2 * (1 - t);
    d.chute.position.set(ev.x + sway, h + 3.2, ev.y);
    d.chute.visible = !ev.landed;
    if (ev.landed && !d.crate.userData.smoking) {
      d.crate.userData.smoking = true;
      d.crate.position.y = 0;
      this.emitters.push({ x: ev.x, z: ev.y, y: 0.9, kind: 'green', rate: 11, acc: 0, until: this.time + 150 });
    }
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    for (const p of this.puffs) p.sprite.material.dispose();
    this.smokeMat.dispose();
  }
}
