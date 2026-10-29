import * as THREE from 'three';
import { RingPool } from '@ashfall/engine';

/**
 * All transient effects use fixed-size pools and pre-allocated GPU buffers:
 * firing 800 rpm never allocates a single object.
 */
export class Effects {
  readonly group = new THREE.Group();
  private tracerGeo: THREE.BufferGeometry;
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;
  private tracerLife: Float32Array;
  private tracerCursor = 0;
  private readonly MAX_TRACERS = 96;

  private flashes: RingPool<{ light: THREE.PointLight; sprite: THREE.Sprite; life: number }>;

  private particles: THREE.Points;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private pCol: Float32Array;
  private pLife: Float32Array;
  private pCursor = 0;
  private readonly MAX_P = 600;

  private decals: THREE.InstancedMesh;
  private decalCursor = 0;
  private readonly MAX_DECALS = 220;

  private swings: RingPool<{ mesh: THREE.Mesh; life: number }>;

  private rain: THREE.LineSegments | null = null;
  private rainPos: Float32Array | null = null;
  private readonly RAIN = 2200;

  constructor(lights: boolean) {
    // Tracers: one LineSegments draw call for all bullets in flight.
    this.tracerPos = new Float32Array(this.MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(this.MAX_TRACERS * 6);
    this.tracerLife = new Float32Array(this.MAX_TRACERS);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const tracers = new THREE.LineSegments(
      this.tracerGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    tracers.frustumCulled = false;
    this.group.add(tracers);

    // Muzzle flashes: pooled point lights (only a few, they're expensive in forward rendering).
    const flashTex = radialTexture('#fff3c4', 'rgba(255,170,60,0)');
    this.flashes = new RingPool(4, () => {
      const light = new THREE.PointLight(0xffc070, 0, 9, 2);
      light.visible = lights;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd28a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      sprite.scale.setScalar(0.55);
      sprite.visible = false;
      this.group.add(light, sprite);
      return { light, sprite, life: 0 };
    });

    // Particles: blood mist & sparks.
    this.pPos = new Float32Array(this.MAX_P * 3).fill(-999);
    this.pVel = new Float32Array(this.MAX_P * 3);
    this.pCol = new Float32Array(this.MAX_P * 3);
    this.pLife = new Float32Array(this.MAX_P);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.particles = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, map: radialTexture('#ffffff', 'rgba(255,255,255,0)'), alphaTest: 0.05 }),
    );
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    // Blood decals on the floor (ring buffer).
    const dm = new THREE.MeshStandardMaterial({ color: 0x4a0b08, roughness: 0.4, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2), dm, this.MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.group.add(this.decals);

    // Melee swing arcs.
    const arcGeo = new THREE.RingGeometry(0.55, 0.95, 18, 1, -0.9, 1.8).rotateX(-Math.PI / 2);
    this.swings = new RingPool(6, () => {
      const mesh = new THREE.Mesh(arcGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      mesh.visible = false;
      this.group.add(mesh);
      return { mesh, life: 0 };
    });
  }

  enableRain(on: boolean): void {
    if (!on || this.rain) return;
    this.rainPos = new Float32Array(this.RAIN * 6);
    for (let i = 0; i < this.RAIN; i++) this.resetDrop(i, Math.random() * 12, 0, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.16, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  private resetDrop(i: number, y: number, cx: number, cz: number): void {
    const p = this.rainPos!;
    const x = cx + (Math.random() - 0.5) * 44;
    const z = cz + (Math.random() - 0.5) * 34;
    p.set([x, y, z, x - 0.03, y - 0.38, z + 0.05], i * 6);
  }

  tracer(fx: number, fz: number, tx: number, tz: number, hit: boolean, fy = 0.95): void {
    const i = this.tracerCursor;
    this.tracerCursor = (i + 1) % this.MAX_TRACERS;
    this.tracerPos.set([fx, fy, fz, tx, hit ? 1.1 : 0.9, tz], i * 6);
    const c = hit ? [1.6, 0.9, 0.5] : [1.4, 1.1, 0.6];
    this.tracerCol.set([...c, ...c], i * 6);
    this.tracerLife[i] = 0.07;
  }

  muzzleFlash(x: number, z: number, y = 0.95): void {
    const f = this.flashes.next();
    f.life = 0.06;
    f.light.position.set(x, y + 0.15, z);
    f.light.intensity = 25;
    f.sprite.position.set(x, y, z);
    f.sprite.visible = true;
    f.sprite.material.rotation = Math.random() * Math.PI;
  }

  burst(x: number, z: number, n: number, kind: 'blood' | 'spark' | 'dust'): void {
    const color = kind === 'blood' ? [0.45, 0.02, 0.02] : kind === 'spark' ? [2.2, 1.5, 0.6] : [0.5, 0.48, 0.42];
    for (let k = 0; k < n; k++) {
      const i = this.pCursor;
      this.pCursor = (i + 1) % this.MAX_P;
      this.pPos.set([x, 0.9, z], i * 3);
      const sp = kind === 'spark' ? 5 : 2;
      this.pVel.set([(Math.random() - 0.5) * sp, Math.random() * sp * 0.8, (Math.random() - 0.5) * sp], i * 3);
      this.pCol.set(color, i * 3);
      this.pLife[i] = kind === 'spark' ? 0.25 : 0.6;
    }
  }

  blood(x: number, z: number, scale = 1): void {
    const i = this.decalCursor;
    this.decalCursor = (i + 1) % this.MAX_DECALS;
    this.decals.count = Math.max(this.decals.count, i + 1);
    const m = new THREE.Matrix4().makeRotationY(Math.random() * Math.PI * 2);
    const s = (0.25 + Math.random() * 0.45) * scale;
    m.scale(new THREE.Vector3(s, 1, s * (0.6 + Math.random() * 0.6)));
    m.setPosition(x + (Math.random() - 0.5) * 0.4, 0.012 + i * 0.00002, z + (Math.random() - 0.5) * 0.4);
    this.decals.setMatrixAt(i, m);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  swing(x: number, z: number, facing: number, color = 0xffffff): void {
    const s = this.swings.next();
    s.life = 0.18;
    s.mesh.visible = true;
    s.mesh.position.set(x, 0.85, z);
    s.mesh.rotation.y = -facing;
    (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  update(dt: number, camTarget: THREE.Vector3): void {
    // Tracers fade by collapsing colour.
    let dirty = false;
    for (let i = 0; i < this.MAX_TRACERS; i++) {
      if (this.tracerLife[i]! <= 0) continue;
      this.tracerLife[i]! -= dt;
      dirty = true;
      if (this.tracerLife[i]! <= 0) this.tracerCol.fill(0, i * 6, i * 6 + 6);
    }
    if (dirty) {
      this.tracerGeo.attributes.position!.needsUpdate = true;
      this.tracerGeo.attributes.color!.needsUpdate = true;
    }

    this.flashes.forEach((f) => {
      if (f.life <= 0) return;
      f.life -= dt;
      f.light.intensity = Math.max(0, f.life / 0.06) * 25;
      if (f.life <= 0) {
        f.sprite.visible = false;
        f.light.intensity = 0;
      }
    });

    let pDirty = false;
    for (let i = 0; i < this.MAX_P; i++) {
      if (this.pLife[i]! <= 0) continue;
      pDirty = true;
      this.pLife[i]! -= dt;
      const o = i * 3;
      this.pVel[o + 1]! -= 9 * dt;
      this.pPos[o]! += this.pVel[o]! * dt;
      this.pPos[o + 1] = Math.max(0.02, this.pPos[o + 1]! + this.pVel[o + 1]! * dt);
      this.pPos[o + 2]! += this.pVel[o + 2]! * dt;
      if (this.pLife[i]! <= 0) this.pPos[o + 1] = -999;
    }
    if (pDirty) {
      this.particles.geometry.attributes.position!.needsUpdate = true;
      this.particles.geometry.attributes.color!.needsUpdate = true;
    }

    this.swings.forEach((s) => {
      if (s.life <= 0) return;
      s.life -= dt;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life / 0.18) * 0.55;
      if (s.life <= 0) s.mesh.visible = false;
    });

    if (this.rain && this.rainPos) {
      const p = this.rainPos;
      for (let i = 0; i < this.RAIN; i++) {
        const o = i * 6;
        p[o + 1]! -= 22 * dt;
        p[o + 4]! -= 22 * dt;
        p[o]! -= 0.8 * dt;
        p[o + 3]! -= 0.8 * dt;
        if (p[o + 4]! < 0) this.resetDrop(i, 9 + Math.random() * 4, camTarget.x, camTarget.z);
      }
      this.rain.geometry.attributes.position!.needsUpdate = true;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

const texCache = new Map<string, THREE.Texture>();
function radialTexture(inner: string, outer: string): THREE.Texture {
  const key = inner + outer;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  texCache.set(key, t);
  return t;
}
