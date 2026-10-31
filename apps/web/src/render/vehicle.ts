import * as THREE from 'three';
import { VEHICLE_DEFS, type Raid, type Vehicle, type VehicleDefId } from '@ashfall/engine';
import type { AssetLibrary } from './assets';
import { patchWorldMaterial, type WorldUniforms } from './patches';

/**
 * Vehicles: the drivable ones are a node each (wheels spin and steer, the body leans into turns and dips
 * under braking); roadside wrecks are static, one InstancedMesh per sub-mesh per paint.
 *
 * Models come raw from vehicles.glb (tools/assets/vehicles.mjs). Here each is turned so its nose faces +Z,
 * scaled to the sim's body length and stood on y = 0, centred on the body box.
 */
interface ModelSpec {
  /** Root in vehicles.glb, and the sub-node per paint variant (null = the whole root). */
  root: string;
  variants: (string | null)[];
  /** Turn (radians about +Y) that points the model's nose at +Z. */
  yaw: number;
  /** Model length vs the collision box (a bumper may stick out a little). */
  lengthMul: number;
}

const MODELS: Record<VehicleDefId, ModelSpec> = {
  uaz469: { root: 'uaz469', variants: [null], yaw: 0, lengthMul: 1.03 },
  zhiguli: { root: 'zhiguli', variants: ['zhiguli_gray', 'zhiguli_blue', 'zhiguli_green', 'zhiguli_red'], yaw: 0, lengthMul: 1.02 },
};

interface Template {
  object: THREE.Group;
  /** Wheel pivots by name (so clones can find theirs). */
  wheels: { name: string; front: boolean; radius: number }[];
}

const WHEEL_RE = /^wheel(\.\d+)?$/i;

/** Build (once per raid) a normalised template for a def + variant. */
function makeTemplate(lib: AssetLibrary, def: VehicleDefId, variant: number, u: WorldUniforms, mats: Map<THREE.Material, THREE.Material>): Template | null {
  const spec = MODELS[def];
  const root = lib.vehicles.get(spec.root);
  if (!root) return null;
  const subName = spec.variants[variant % spec.variants.length] ?? null;
  let src: THREE.Object3D | undefined = root;
  if (subName) root.traverse((o) => (o.name === subName ? (src = o) : undefined));
  const model = (src as THREE.Object3D).clone(true);
  // Detach from wherever it sat in the source file (the pack lays its cars side by side).
  model.position.set(0, 0, 0);
  const holder = new THREE.Group();
  const turn = new THREE.Group();
  turn.rotation.y = spec.yaw;
  if (subName) {
    // Keep the pack's own node transforms above the variant (axis conversion), minus its offset.
    const chain: THREE.Object3D[] = [];
    for (let p: THREE.Object3D | null = (src as THREE.Object3D).parent; p && p !== root.parent; p = p.parent) chain.unshift(p);
    const m = new THREE.Matrix4();
    for (const p of chain) m.multiply(p.matrix);
    m.multiply((src as THREE.Object3D).matrix);
    model.matrix.copy(m);
    model.matrix.decompose(model.position, model.quaternion, model.scale);
  }
  turn.add(model);
  holder.add(turn);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const d = VEHICLE_DEFS[def];
  const s = (d.length * spec.lengthMul) / size.z;
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  box.setFromObject(holder);
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -box.min.y, -c.z);
  holder.updateMatrixWorld(true);

  const object = new THREE.Group();
  object.add(holder);
  object.updateMatrixWorld(true);
  // Every material gets the fog of war; shared across clones.
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = list.map((m0) => {
      let m = mats.get(m0);
      if (!m) mats.set(m0, (m = patchWorldMaterial(m0.clone(), u)));
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0]!;
  });
  // Wheels: re-parent each onto a pivot at its own centre so it can spin about the axle and steer.
  const wheels: Template['wheels'] = [];
  const found: THREE.Object3D[] = [];
  object.traverse((o) => {
    if (WHEEL_RE.test(o.name)) found.push(o);
  });
  for (const w of found) {
    const wb = new THREE.Box3().setFromObject(w);
    const wc = wb.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = `pivot:${w.name}`;
    pivot.rotation.order = 'YXZ';
    pivot.position.copy(wc);
    object.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(w);
    wheels.push({ name: pivot.name, front: wc.z > 0, radius: Math.max(0.2, (wb.max.y - wb.min.y) / 2) });
  }
  return { object, wheels };
}

class VehicleView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wheels: { pivot: THREE.Object3D; front: boolean; radius: number }[] = [];
  private spin = 0;
  private lastSpeed = 0;
  private pitch = 0;
  private roll = 0;

  constructor(t: Template) {
    const obj = t.object.clone(true);
    this.body.add(obj);
    this.root.add(this.body);
    for (const w of t.wheels) {
      const pivot = obj.getObjectByName(w.name);
      if (pivot) this.wheels.push({ pivot, front: w.front, radius: w.radius });
    }
  }

  update(v: Vehicle, dt: number): void {
    this.root.position.set(v.pos.x, 0, v.pos.y);
    // rotation.y = θ turns +Z towards (sin θ, cos θ) in (x, z) = world (x, y).
    this.root.rotation.y = Math.atan2(Math.cos(v.heading), Math.sin(v.heading));
    this.spin += (v.speed * dt) / 0.36;
    for (const w of this.wheels) {
      w.pivot.rotation.x = (this.spin * 0.36) / w.radius;
      w.pivot.rotation.y = w.front ? -v.steer : 0;
    }
    // Lean out of turns, nose down under braking (springs, eased).
    const accel = dt > 0 ? (v.speed - this.lastSpeed) / dt : 0;
    this.lastSpeed = v.speed;
    const lat = v.speed * v.angVel;
    const k = 1 - Math.exp(-dt * 6);
    this.roll += (THREE.MathUtils.clamp(lat * 0.008, -0.07, 0.07) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(accel * 0.006, -0.05, 0.05) - this.pitch) * k;
    this.body.rotation.set(-this.pitch, 0, this.roll);
  }
}

/** All the raid's vehicles: views for drivable ones, instanced wrecks for the rest. */
export class VehicleViews {
  readonly group = new THREE.Group();
  private views = new Map<number, VehicleView>();
  private mats = new Map<THREE.Material, THREE.Material>();
  private geometries: THREE.InstancedMesh[] = [];

  constructor(raid: Raid, lib: AssetLibrary, u: WorldUniforms, shadows: boolean) {
    const templates = new Map<string, Template | null>();
    const template = (def: VehicleDefId, variant: number) => {
      const key = `${def}|${variant}`;
      if (!templates.has(key)) templates.set(key, makeTemplate(lib, def, variant, u, this.mats));
      return templates.get(key) ?? null;
    };
    // Wrecks: bucket by template, then one InstancedMesh per sub-mesh. Darkened and dusty.
    const buckets = new Map<string, Vehicle[]>();
    for (const v of raid.vehicles) {
      if (!v.wreck) continue;
      const key = `${v.def}|${v.variant % MODELS[v.def].variants.length}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(v);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const wreckMats = new Map<THREE.Material, THREE.Material>();
    for (const [key, list] of buckets) {
      const [def, variant] = key.split('|') as [VehicleDefId, string];
      const t = template(def, Number(variant));
      if (!t) continue;
      t.object.updateMatrixWorld(true);
      t.object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m0) => {
          let m = wreckMats.get(m0);
          if (!m) {
            m = m0.clone();
            const sm = m as THREE.MeshStandardMaterial;
            if (sm.color) sm.color.multiplyScalar(0.62);
            if ('roughness' in sm) sm.roughness = Math.min(1, sm.roughness + 0.25);
            wreckMats.set(m0, patchWorldMaterial(m, u));
          }
          return wreckMats.get(m0)!;
        });
        const inst = new THREE.InstancedMesh(mesh.geometry, mats.length === 1 ? mats[0]! : mats, list.length);
        list.forEach((v, i) => {
          q.setFromAxisAngle(up, Math.atan2(Math.cos(v.heading), Math.sin(v.heading)));
          inst.setMatrixAt(i, m4.compose(new THREE.Vector3(v.pos.x, 0, v.pos.y), q, one).multiply(mesh.matrixWorld));
        });
        inst.castShadow = shadows;
        inst.receiveShadow = shadows;
        inst.computeBoundingSphere();
        this.geometries.push(inst);
        this.group.add(inst);
      });
    }
    for (const v of raid.vehicles) {
      if (v.wreck) continue;
      const t = template(v.def, v.variant);
      if (!t) continue;
      const view = new VehicleView(t);
      view.update(v, 0);
      this.views.set(v.id, view);
      this.group.add(view.root);
    }
  }

  update(raid: Raid, dt: number): void {
    for (const v of raid.vehicles) this.views.get(v.id)?.update(v, dt);
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    for (const inst of this.geometries) (Array.isArray(inst.material) ? inst.material : [inst.material]).forEach((m) => m.dispose());
  }
}
