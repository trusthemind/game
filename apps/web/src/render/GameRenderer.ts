import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  BlendFunction,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { Interactable, Raid, RaidEvent } from '@ashfall/engine';
import { ActorView, disposeActorCaches } from './actors';
import { Effects } from './effects';
import { QUALITY, type QualityLevel, type QualityPreset } from './quality';
import { addContainerInstance, buildWorld, markContainerSearched, type WorldMeshes } from './world';
import type { WorldUniforms } from './patches';
import { disposeTextures } from './textures';

interface Lighting {
  bg: number;
  fog: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunColor: number;
  sunDir: [number, number, number];
  flashlight: number;
}

const LIGHTING: Record<Raid['timeOfDay'], Lighting> = {
  day: { bg: 0x0a0c0b, fog: 0x9aa7ad, fogDensity: 0.01, hemiSky: 0xd8e4ea, hemiGround: 0x4a4636, hemi: 1.5, sun: 2.6, sunColor: 0xfff1d8, sunDir: [-0.5, 1, 0.35], flashlight: 0 },
  dusk: { bg: 0x050506, fog: 0x3a2c30, fogDensity: 0.018, hemiSky: 0xd9906a, hemiGround: 0x2a2228, hemi: 0.75, sun: 1.5, sunColor: 0xff9a5a, sunDir: [-1, 0.45, 0.2], flashlight: 60 },
  night: { bg: 0x030405, fog: 0x070a10, fogDensity: 0.03, hemiSky: 0x40507a, hemiGround: 0x0a0a10, hemi: 0.16, sun: 0.35, sunColor: 0x8fa6ff, sunDir: [0.4, 1, -0.3], flashlight: 120 },
};

export interface RendererStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/** Owns the three.js scene for one raid. Reads sim state; never mutates it. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private hue: HueSaturationEffect | null = null;
  private vignette: VignetteEffect | null = null;
  private world: WorldMeshes;
  private effects: Effects;
  private views = new Map<number, ActorView>();
  private uniforms: WorldUniforms;
  private fowTex: THREE.DataTexture;
  private fowCur: Float32Array;
  private fowVersion = -1;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private flashlight: THREE.SpotLight;
  private playerGlow: THREE.PointLight;
  private highlight: THREE.Mesh;
  private camTarget = new THREE.Vector3();
  private shake = 0;
  private zoom = 1;
  private preset: QualityPreset;
  private scale = 1;
  private searched = new Set<number>();
  private containerCount = 0;
  private frameNo = 0;
  private time = 0;
  private labels = new Map<number, HTMLDivElement>();
  private raycaster = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);

  constructor(
    readonly canvas: HTMLCanvasElement,
    private raid: Raid,
    quality: QualityLevel,
    private labelLayer: HTMLElement | null,
  ) {
    this.preset = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.preset.post, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.preset.pixelRatio));
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.preset.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // Post-processing renders several passes per frame; count them all.
    this.renderer.info.autoReset = false;

    const L = LIGHTING[raid.timeOfDay];
    this.scene.background = new THREE.Color(L.bg);
    this.scene.fog = new THREE.FogExp2(L.fog, L.fogDensity);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 220);

    // Fog-of-war texture: R = currently visible (smoothed), G = explored.
    const { width: W, height: H } = raid.map;
    this.fowTex = new THREE.DataTexture(new Uint8Array(W * H * 4), W, H, THREE.RGBAFormat);
    this.fowTex.magFilter = this.fowTex.minFilter = THREE.LinearFilter;
    this.fowTex.needsUpdate = true;
    this.fowCur = new Float32Array(W * H);
    this.uniforms = {
      uFow: { value: this.fowTex },
      uMapSize: { value: new THREE.Vector2(W, H) },
      uPlayer: { value: new THREE.Vector3() },
      uFowOn: { value: 1 },
    };

    this.hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi);
    this.sun = new THREE.DirectionalLight(L.sunColor, L.sun);
    this.sun.castShadow = this.preset.shadows;
    this.sun.shadow.mapSize.set(this.preset.shadowSize, this.preset.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.flashlight = new THREE.SpotLight(0xfff0d8, L.flashlight, 24, 0.5, 0.55, 1.6);
    this.flashlight.castShadow = this.preset.flashlightShadow;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.bias = -0.0008;
    this.scene.add(this.flashlight, this.flashlight.target);
    this.playerGlow = new THREE.PointLight(0xffe6c0, raid.timeOfDay === 'day' ? 0 : 2.2, 5, 1.5);
    this.scene.add(this.playerGlow);

    this.world = buildWorld(raid.map, this.uniforms, this.preset.shadows);
    this.scene.add(this.world.group);
    this.containerCount = raid.map.containers.length;
    this.effects = new Effects(this.preset.muzzleLights);
    this.effects.enableRain(raid.rain);
    this.scene.add(this.effects.group);

    this.highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf0c46a, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    if (this.preset.post) this.setupPost();
    this.resize();
    this.snapCamera();
  }

  private setupPost(): void {
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new BloomEffect({ mipmapBlur: true, intensity: 1.15, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, radius: 0.7 });
    this.vignette = new VignetteEffect({ darkness: 0.62, offset: 0.28 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    noise.blendMode.opacity.value = 0.12;
    this.hue = new HueSaturationEffect({ saturation: -0.08 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const effects = [bloom, this.hue, this.vignette, noise, tone];
    if (this.preset.smaa) effects.unshift(new SMAAEffect({ preset: SMAAPreset.HIGH }) as never);
    this.composer.addPass(new EffectPass(this.camera, ...effects));
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.preset.pixelRatio) * this.scale);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Dynamic resolution: called by the perf monitor when frame time drifts outside budget. */
  setResolutionScale(s: number): void {
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    this.resize();
  }

  get resolutionScale(): number {
    return this.scale;
  }

  setZoom(z: number): void {
    this.zoom = Math.min(1.5, Math.max(0.65, z));
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  /** Mouse (NDC) → world point on the aim plane at gun height. */
  screenToWorld(ndcX: number, ndcY: number): { x: number; y: number } {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, p)) return { x: this.raid.player.pos.x, y: this.raid.player.pos.y };
    return { x: p.x, y: p.z };
  }

  worldToScreen(x: number, y: number, h = 1.6): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  handleEvents(events: RaidEvent[]): void {
    const pid = this.raid.player.id;
    for (const e of events) {
      switch (e.t) {
        case 'shot': {
          this.effects.tracer(e.fx, e.fy, e.tx, e.ty, e.hit);
          this.effects.muzzleFlash(e.fx, e.fy);
          this.views.get(e.actor)?.fired();
          if (e.actor === pid) this.shake = Math.min(0.35, this.shake + 0.08);
          break;
        }
        case 'swing': {
          this.views.get(e.actor)?.swung();
          if (e.actor === pid || this.raid.isVisibleToPlayer(e.x, e.y)) this.effects.swing(e.x, e.y, e.facing, e.weapon === 'claws' ? 0x9adf7a : 0xffffff);
          break;
        }
        case 'hit': {
          this.effects.burst(e.x, e.y, e.penetrated ? 14 : 8, e.penetrated || e.melee ? 'blood' : 'spark');
          if (e.penetrated || e.melee) this.effects.blood(e.x, e.y, Math.min(1.6, e.damage / 30));
          if (e.target === pid) this.shake = Math.min(0.6, this.shake + 0.25);
          break;
        }
        case 'impact':
          this.effects.burst(e.x, e.y, 6, 'spark');
          this.effects.burst(e.x, e.y, 4, 'dust');
          break;
        case 'death': {
          const corpse = this.raid.corpses.find((c) => c.actorId === e.actor);
          const view = this.views.get(e.actor);
          if (corpse && view) {
            view.toCorpse(corpse);
            this.effects.blood(corpse.pos.x, corpse.pos.y, 2.4);
          }
          this.removeLabel(e.actor);
          break;
        }
        default:
          break;
      }
    }
  }

  render(dt: number, interact: Interactable | null): RendererStats {
    this.time += dt;
    this.frameNo++;
    const raid = this.raid;
    const p = raid.player;

    this.updateFog(dt);

    // Actors.
    for (const a of raid.actors) {
      let v = this.views.get(a.id);
      if (!v) {
        v = new ActorView(a.id, a, this.preset.shadows);
        this.views.set(a.id, v);
        this.scene.add(v.root);
      }
      if (v.dead) {
        v.root.visible = raid.explored[raid.map.idx(Math.floor(v.root.position.x), Math.floor(v.root.position.z))] === 1;
        continue;
      }
      v.update(a, dt);
      v.root.visible = a === p || !!a.companion || raid.isVisibleToPlayer(a.pos.x, a.pos.y);
      if (a.npcId && a.alive) this.updateLabel(a.id, a.name, a.pos.x, a.pos.y, v.root.visible, a.companion ? 'comp' : 'npc');
    }

    // Containers: new ground piles + searched tint (scanned a few times per second).
    if (raid.map.containers.length !== this.containerCount) {
      for (const c of raid.map.containers) addContainerInstance(this.world.containers, this.world.containerIndex, raid.map, c);
      this.containerCount = raid.map.containers.length;
    }
    if (this.frameNo % 20 === 0)
      for (const c of raid.map.containers)
        if (c.searched && c.generated && !this.searched.has(c.id) && c.kind !== 'ground') {
          this.searched.add(c.id);
          markContainerSearched(this.world.containers, this.world.containerIndex, c);
        }

    // Interaction highlight.
    if (interact && interact.kind !== 'extract') {
      this.highlight.visible = true;
      this.highlight.position.set(interact.x, 0.03, interact.y);
      (this.highlight.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(this.time * 6) * 0.3;
    } else this.highlight.visible = false;

    for (const b of this.world.extractionBeams) (b.material as THREE.MeshBasicMaterial).opacity = 0.09 + Math.sin(this.time * 2) * 0.03;

    // Camera: follow the player, lead towards the aim point (peek), with shake.
    const aimX = p.intent.aimX;
    const aimY = p.intent.aimY;
    const leadX = Math.max(-5, Math.min(5, (aimX - p.pos.x) * 0.3));
    const leadY = Math.max(-4, Math.min(4, (aimY - p.pos.y) * 0.3));
    const k = 1 - Math.exp(-dt * 6);
    this.camTarget.x += (p.pos.x + leadX - this.camTarget.x) * k;
    this.camTarget.z += (p.pos.y + leadY - this.camTarget.z) * k;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sx = (Math.random() - 0.5) * this.shake * 0.4;
    const sz = (Math.random() - 0.5) * this.shake * 0.4;
    this.camera.position.set(this.camTarget.x + sx, 19 * this.zoom, this.camTarget.z + 11.5 * this.zoom + sz);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z + sz);

    // Lights follow the player.
    const L = LIGHTING[raid.timeOfDay];
    const sd = new THREE.Vector3(...L.sunDir).normalize().multiplyScalar(40);
    // Snap the shadow frustum to texels so shadows don't shimmer while moving.
    const texel = 52 / this.preset.shadowSize;
    const cx = Math.round(p.pos.x / texel) * texel;
    const cz = Math.round(p.pos.y / texel) * texel;
    this.sun.position.set(cx + sd.x, sd.y, cz + sd.z);
    this.sun.target.position.set(cx, 0, cz);
    const fx = Math.cos(p.facing);
    const fz = Math.sin(p.facing);
    this.flashlight.visible = p.flashlight && p.alive;
    this.flashlight.position.set(p.pos.x + fx * 0.3, 1.25, p.pos.y + fz * 0.3);
    this.flashlight.target.position.set(p.pos.x + fx * 8, 0, p.pos.y + fz * 8);
    this.playerGlow.position.set(p.pos.x, 1.6, p.pos.y);
    this.uniforms.uPlayer.value.set(p.pos.x, 1, p.pos.y);

    // Hurt feedback through the grade: desaturate as HP drops.
    if (this.hue) this.hue.saturation = -0.08 - (1 - p.hp / p.maxHp) * 0.7;
    if (this.vignette) this.vignette.darkness = 0.62 + (1 - p.hp / p.maxHp) * 0.3;

    this.effects.update(dt, this.camTarget);

    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    const info = this.renderer.info;
    return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
  }

  /** Smoothly blend the fog-of-war texture towards the sim's current FOV. */
  private updateFog(dt: number): void {
    const raid = this.raid;
    const data = this.fowTex.image.data as Uint8Array;
    const vis = raid.playerFov;
    const exp = raid.explored;
    const n = vis.length;
    const k = Math.min(1, dt * 9);
    const changed = raid.fovVersion !== this.fowVersion;
    this.fowVersion = raid.fovVersion;
    let moving = changed;
    for (let i = 0; i < n; i++) {
      const target = vis[i]!;
      const cur = this.fowCur[i]!;
      if (cur === target && !changed) continue;
      const next = Math.abs(target - cur) < 0.02 ? target : cur + (target - cur) * k;
      if (next !== cur) moving = true;
      this.fowCur[i] = next;
      data[i * 4] = next * 255;
      data[i * 4 + 1] = exp[i]! * 255;
    }
    if (moving) this.fowTex.needsUpdate = true;
  }

  snapCamera(): void {
    const p = this.raid.player.pos;
    this.camTarget.set(p.x, 0, p.y);
    const data = this.fowTex.image.data as Uint8Array;
    for (let i = 0; i < this.fowCur.length; i++) {
      this.fowCur[i] = this.raid.playerFov[i]!;
      data[i * 4] = this.fowCur[i]! * 255;
      data[i * 4 + 1] = this.raid.explored[i]! * 255;
    }
    this.fowTex.needsUpdate = true;
  }

  private updateLabel(id: number, text: string, x: number, y: number, visible: boolean, kind: string): void {
    if (!this.labelLayer) return;
    let el = this.labels.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = `world-label ${kind}`;
      el.textContent = text;
      this.labelLayer.appendChild(el);
      this.labels.set(id, el);
    }
    const s = this.worldToScreen(x, y, 2.1);
    el.style.display = visible && s.visible ? 'block' : 'none';
    el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  }

  private removeLabel(id: number): void {
    this.labels.get(id)?.remove();
    this.labels.delete(id);
  }

  dispose(): void {
    for (const el of this.labels.values()) el.remove();
    this.world.dispose();
    this.effects.dispose();
    this.composer?.dispose();
    this.fowTex.dispose();
    disposeActorCaches();
    disposeTextures();
    this.renderer.dispose();
  }
}
