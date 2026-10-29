import * as THREE from 'three';
import { getDef, type Actor, type Corpse, type Faction } from '@ashfall/engine';

/** Shared geometry + a material cache keyed by colour: 40 actors share ~15 materials. */
const geoCache = {
  body: new THREE.CapsuleGeometry(0.24, 0.62, 4, 10),
  head: new THREE.SphereGeometry(0.16, 14, 10),
  helmet: new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  vest: new THREE.BoxGeometry(0.46, 0.42, 0.36),
  pack: new THREE.BoxGeometry(0.34, 0.42, 0.2),
  gun: new THREE.BoxGeometry(0.07, 0.08, 1),
  blade: new THREE.BoxGeometry(0.04, 0.04, 1),
  arm: new THREE.CapsuleGeometry(0.06, 0.38, 2, 6),
  light: new THREE.ConeGeometry(0.05, 0.08, 6),
};
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = `${color}:${JSON.stringify(extra)}`;
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra })));
  return m;
}

const FACTION_COLOR: Record<Faction | 'companion', number> = {
  player: 0x6b6a4a,
  companion: 0x3f6f78,
  scav: 0x5e5446,
  raider: 0x262b33,
  boss: 0x5a1e1a,
  infected: 0x56664a,
  npc: 0x3f6f78,
};
const ARMOR_COLOR = [0x444444, 0x4a4a40, 0x5a5a48, 0x3a4436, 0x2f3a2c, 0x23282a, 0x1a1d1f];

export class ActorView {
  readonly root = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Mesh;
  private helmet: THREE.Mesh;
  private vest: THREE.Mesh;
  private pack: THREE.Mesh;
  private weapon: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private rig = new THREE.Group();
  private bob = 0;
  private kick = 0;
  private swing = 0;
  private gearKey = '';
  dead = false;

  constructor(
    readonly actorId: number,
    a: Actor,
    shadows: boolean,
  ) {
    const color = a.companion ? FACTION_COLOR.companion : FACTION_COLOR[a.faction];
    this.body = new THREE.Mesh(geoCache.body, mat(color));
    this.body.position.y = 0.55;
    const skin = a.archetype === 'infected' ? 0x7d8a6a : 0xc9a088;
    this.head = new THREE.Mesh(geoCache.head, mat(skin));
    this.head.position.y = 1.12;
    this.helmet = new THREE.Mesh(geoCache.helmet, mat(0x3a4030));
    this.helmet.position.y = 1.14;
    this.vest = new THREE.Mesh(geoCache.vest, mat(0x3a4436));
    this.vest.position.y = 0.72;
    this.pack = new THREE.Mesh(geoCache.pack, mat(0x4a4632));
    this.pack.position.set(0, 0.75, -0.24);
    this.weapon = new THREE.Mesh(geoCache.gun, mat(0x1b1d1c, { metalness: 0.5, roughness: 0.4 }));
    this.weapon.position.set(0.12, 0.8, 0.3);
    this.armL = new THREE.Mesh(geoCache.arm, mat(color));
    this.armR = new THREE.Mesh(geoCache.arm, mat(color));
    this.armL.position.set(-0.27, 0.72, 0.08);
    this.armR.position.set(0.27, 0.72, 0.08);
    if (a.archetype === 'infected') {
      // Zombie pose: arms reaching forward.
      this.armL.rotation.x = this.armR.rotation.x = Math.PI / 2.3;
      this.armL.position.z = this.armR.position.z = 0.25;
      this.armL.position.y = this.armR.position.y = 0.85;
    } else {
      this.armR.rotation.x = Math.PI / 3;
      this.armL.rotation.x = Math.PI / 3.2;
    }
    this.rig.add(this.body, this.head, this.helmet, this.vest, this.pack, this.weapon, this.armL, this.armR);
    this.root.add(this.rig);
    this.rig.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = shadows;
    });
    this.syncGear(a);
  }

  /** Rebuild gear visuals only when equipment changes (cheap string key compare). */
  syncGear(a: Actor | Corpse): void {
    const s = a.eq.slots;
    const active = 'active' in a ? a.active : 'primary';
    const held = active === 'melee' ? s.melee : s[active];
    const key = `${s.helmet?.def}|${s.armor?.def}|${s.backpack?.def}|${held?.def}|${active}`;
    if (key === this.gearKey) return;
    this.gearKey = key;
    this.helmet.visible = !!s.helmet;
    if (s.helmet) this.helmet.material = mat(ARMOR_COLOR[getDef(s.helmet.def).armor!.armorClass] ?? 0x333333);
    this.vest.visible = !!s.armor;
    if (s.armor) this.vest.material = mat(ARMOR_COLOR[getDef(s.armor.def).armor!.armorClass] ?? 0x333333);
    this.pack.visible = !!s.backpack;
    if (s.backpack) {
      const d = getDef(s.backpack.def);
      this.pack.scale.set(0.8 + d.w * 0.12, 0.7 + d.h * 0.12, 1 + d.h * 0.1);
    }
    if (held) {
      const d = getDef(held.def);
      this.weapon.visible = true;
      if (d.melee) {
        this.weapon.geometry = geoCache.blade;
        this.weapon.material = mat(0x8a8f8a, { metalness: 0.7, roughness: 0.3 });
        this.weapon.scale.z = 0.25 + d.h * 0.17;
      } else {
        this.weapon.geometry = geoCache.gun;
        this.weapon.material = mat(0x1b1d1c, { metalness: 0.5, roughness: 0.4 });
        this.weapon.scale.z = 0.25 + d.w * 0.16;
      }
      this.weapon.position.z = 0.22 + this.weapon.scale.z / 2;
    } else this.weapon.visible = false;
  }

  update(a: Actor, dt: number): void {
    this.root.position.set(a.pos.x, 0, a.pos.y);
    // Map facing (atan2 on x/y) → three.js yaw around +Y where +Z is "forward" for the rig.
    this.root.rotation.y = Math.PI / 2 - a.facing;
    const speed = Math.hypot(a.vel.x, a.vel.y);
    this.bob += dt * speed * 3.2;
    const crouch = a.crouching ? 0.78 : 1;
    this.rig.scale.y += (crouch - this.rig.scale.y) * Math.min(1, dt * 12);
    this.rig.position.y = Math.abs(Math.sin(this.bob)) * 0.05 * Math.min(1, speed);
    this.kick = Math.max(0, this.kick - dt * 10);
    this.weapon.position.z = 0.22 + this.weapon.scale.z / 2 - this.kick * 0.12;
    this.swing = Math.max(0, this.swing - dt * 5);
    this.weapon.rotation.y = -Math.sin(this.swing * Math.PI) * 1.4;
    this.armR.rotation.z = -Math.sin(this.swing * Math.PI) * 0.8;
    this.syncGear(a);
  }

  fired(): void {
    this.kick = 1;
  }

  swung(): void {
    this.swing = 1;
  }

  /** Death pose: topple over. */
  toCorpse(c: Corpse): void {
    this.dead = true;
    this.root.position.set(c.pos.x, 0, c.pos.y);
    this.root.rotation.set(0, Math.PI / 2 - c.facing, 0);
    this.rig.rotation.x = -Math.PI / 2;
    this.rig.position.set(0, 0.22, -0.4);
    this.rig.scale.y = 1;
    this.rig.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material = mat(new THREE.Color(o.material.color).multiplyScalar(0.55).getHex());
      }
    });
  }

  get muzzle(): THREE.Vector3 {
    return this.weapon.getWorldPosition(new THREE.Vector3()).add(
      new THREE.Vector3(0, 0, this.weapon.scale.z / 2).applyQuaternion(this.root.quaternion),
    );
  }
}

export function disposeActorCaches(): void {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
}
