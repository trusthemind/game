import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Extraction, ExtractKind } from '@ashfall/engine';
import { getTexture, type TexKind } from './textures';
import { patchWorldMaterial, type WorldUniforms } from './patches';

/**
 * Set dressing for extraction points, so each one is the place its name says: a checkpoint has a boom barrier
 * and a guard booth, an outpost sandbags and a watchtower, a gas station a canopy and pumps, a pier water.
 *
 * Built in a local frame where +Z points out of the map (the way you leave), x runs across, and the extraction
 * circle is at the origin; the edge treeline starts at z ≈ 7.5. Solid pieces stand on the footprints in the
 * engine's EXTRACT_SOLIDS (same frame), so you can't walk through a booth or onto water. The lane |x| < 2.5
 * stays clear: the only thing across it — a barrier arm or a gate — opens as the extraction timer runs.
 *
 * Static pieces of each place are merged per material (a handful of draw calls per place) with world-scaled
 * UVs, so textures keep their size on a 20 m deck and a 30 cm post alike.
 */

export interface ExtractProps {
  group: THREE.Group;
  /** Drive the moving part of one extraction (barrier, gate) from its extraction progress 0…1. */
  setProgress(id: number, t: number): void;
  /** Idle motion (a mill wheel turning). */
  update(time: number): void;
  dispose(): void;
}

type Mat = THREE.MeshStandardMaterial;
type P = THREE.Object3D;

/** Children under a node with this flag move at runtime and are kept out of the static merge. */
const DYNAMIC = 'extractDynamic';

export function buildExtractProps(list: Extraction[], u: WorldUniforms, shadows: boolean): ExtractProps {
  const group = new THREE.Group();
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const movers = new Map<number, (t: number) => void>();
  const spinners: { obj: THREE.Object3D; speed: number }[] = [];
  /** World-UV scale per material (repeats per metre); 0 keeps the geometry's own UVs. */
  const uvScale = new Map<THREE.Material, number>();

  const matCache = new Map<string, Mat>();
  /** `over`: something overhead (canopy, deck, roof) that dithers away around the player like a building roof. */
  const mat = (color: number, tex: TexKind | null = null, rough = 0.85, metal = 0, over = false, opts: { scale?: number; double?: boolean; opacity?: number } = {}): Mat => {
    const key = `${color}|${tex}|${rough}|${metal}|${over}|${opts.scale}|${opts.double}|${opts.opacity}`;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        map: tex ? getTexture(tex) : null,
        roughness: rough,
        metalness: metal,
        side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
        transparent: opts.opacity !== undefined,
        opacity: opts.opacity ?? 1,
        depthWrite: opts.opacity === undefined,
      });
      patchWorldMaterial(m, u, over ? { occlude: 'canopy' } : {});
      matCache.set(key, m);
      mats.push(m);
      uvScale.set(m, tex ? (opts.scale ?? 0.45) : 0);
    }
    return m;
  };
  const C = {
    concrete: () => mat(0xb4b0a6, 'concrete', 0.95),
    darkConcrete: () => mat(0x7d7a72, 'concrete', 0.95),
    wetConcrete: () => mat(0x4e4d48, 'concrete', 0.6),
    plaster: () => mat(0xd8d2c4, 'plaster', 0.9),
    brick: () => mat(0x8a4a36, 'plaster', 0.9, 0, false, { scale: 0.8 }),
    metal: () => mat(0x6d7275, 'metal', 0.55, 0.4),
    steel: () => mat(0x5a6466, 'metal', 0.5, 0.5),
    rust: () => mat(0x7a4a2e, 'metal', 0.75, 0.3),
    wood: () => mat(0xb08a62, 'wood', 0.9),
    darkWood: () => mat(0x86684c, 'wood', 0.9),
    bark: () => mat(0xb8a088, 'bark', 0.95, 0, false, { scale: 0.9 }),
    cut: () => mat(0xc6a578, 'wood', 0.9, 0, false, { scale: 1.6 }),
    sand: () => mat(0x8f7e57, null, 1),
    olive: () => mat(0x4b5536, null, 0.9),
    armyGreen: () => mat(0x3f4a33, 'metal', 0.8, 0.2),
    red: () => mat(0xa8352c, null, 0.7),
    white: () => mat(0xdedad0, null, 0.7),
    yellow: () => mat(0xd6a524, null, 0.7),
    blue: () => mat(0x37587e, null, 0.7),
    black: () => mat(0x0b0c0c, null, 1),
    glass: () => mat(0x2a3a44, null, 0.12, 0.3),
    water: () => mat(0x2b4348, null, 0.08, 0.15),
    mud: () => mat(0x8a7a60, 'dirt', 1),
    earth: () => mat(0xc4cbb0, 'grass', 1, 0, false, { scale: 0.25 }),
    asphalt: () => mat(0x3c3d3c, 'asphalt', 0.9, 0, false, { scale: 0.25 }),
    roof: () => mat(0x5a4a3e, 'roof', 0.9, 0, true),
    overConcrete: () => mat(0x8a877f, 'concrete', 0.95, 0, true),
    overWood: () => mat(0x86684c, 'wood', 0.9, 0, true),
    overEarth: () => mat(0xc4cbb0, 'grass', 1, 0, true, { scale: 0.25 }),
    overWhite: () => mat(0xdedad0, null, 0.7, 0, true),
    overYellow: () => mat(0xd4a02a, null, 0.6, 0.3, true),
  };

  const geo = <G extends THREE.BufferGeometry>(g: G) => (geos.push(g), g);
  /** A mesh in the current place's frame; y is the geometry's centre. */
  const put = (parent: P, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo(g), m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz, 'YXZ');
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    return mesh;
  };
  /** Box standing on y (its base). */
  const box = (p: P, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) =>
    put(p, new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.08), m, x, y + h / 2, z, ry);
  /** Sharp box (thin plates, beams). */
  const plate = (p: P, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) =>
    put(p, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, ry, rx, rz);
  const post = (p: P, r: number, h: number, m: THREE.Material, x: number, z: number, y = 0, seg = 10) =>
    put(p, new THREE.CylinderGeometry(r, r, h, seg), m, x, y + h / 2, z);
  /** A beam between two points. */
  const beam = (p: P, a: [number, number, number], b: [number, number, number], t: number, m: THREE.Material) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(t, t, va.distanceTo(vb))), m);
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vb.sub(va).normalize());
    mesh.castShadow = shadows;
    p.add(mesh);
    return mesh;
  };
  /** A flat patch on the ground (water, mud, concrete) from x0,z0 to x1,z1. */
  const ground = (p: P, x0: number, z0: number, x1: number, z1: number, m: THREE.Material, y = 0.02) => {
    const mesh = put(p, new THREE.PlaneGeometry(x1 - x0, z1 - z0), m, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, -Math.PI / 2);
    mesh.castShadow = false;
    return mesh;
  };
  /** A 2D profile (x across, y up) extruded along z, centred on z. */
  const prism = (pts: [number, number][], len: number, holes: THREE.Path[] = []) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    s.holes.push(...holes);
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    return g;
  };
  /** Earth bank across x0…x1 whose cross-section is given as (z, y) points: a hill, a dam face, an embankment. */
  const bank = (p: P, x0: number, x1: number, profile: [number, number][], m: THREE.Material) =>
    put(p, prism(profile, x1 - x0), m, (x0 + x1) / 2, 0, 0, -Math.PI / 2);
  /** Retaining wing wall flaring out from a portal on side `s`: tall at the portal, low at its far end. */
  const wingWall = (s: number, len: number, h: number) =>
    prism([[-s * len / 2, 0], [s * len / 2, 0], [s * len / 2, h * 0.3], [-s * len / 2, h]], 0.45);
  /**
   * Rolling ground from x0 to x1: height follows the (z, y) profile and eases down to nothing over `ease` metres
   * at whichever end is flagged, so a hill runs into the trees instead of ending in a cliff.
   */
  const hill = (p: P, x0: number, x1: number, profile: [number, number][], m: THREE.Material, easeLo: boolean, easeHi: boolean, ease = 4) => {
    const z0 = profile[0]![0];
    const z1 = profile[profile.length - 1]![0];
    const nx = Math.max(2, Math.round((x1 - x0) / 0.8));
    const nz = Math.max(2, Math.round((z1 - z0) / 0.6));
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
    const pos = g.attributes.position!;
    const at = (z: number) => {
      for (let i = 1; i < profile.length; i++) {
        const [za, ya] = profile[i - 1]!;
        const [zb, yb] = profile[i]!;
        if (z <= zb) return ya + ((yb - ya) * (z - za)) / Math.max(1e-6, zb - za);
      }
      return profile[profile.length - 1]![1];
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (x0 + x1) / 2;
      const z = pos.getZ(i) + (z0 + z1) / 2;
      let k = 1;
      if (easeLo) k = Math.min(k, THREE.MathUtils.smoothstep(x, x0, x0 + ease));
      if (easeHi) k = Math.min(k, 1 - THREE.MathUtils.smoothstep(x, x1 - ease, x1));
      // A little unevenness so the slope catches the light in patches.
      const bump = Math.sin(x * 0.9 + z * 0.4) * Math.cos(z * 0.7 - x * 0.3) * 0.18;
      const h = (at(z) + bump) * k;
      pos.setY(i, h > 0.06 ? h : -0.05); // flat rims sink under the ground instead of z-fighting it
    }
    g.computeVertexNormals();
    const mesh = put(p, g, m, (x0 + x1) / 2, 0, (z0 + z1) / 2);
    mesh.castShadow = shadows;
    return mesh;
  };
  /** Pitched roof, ridge along z. */
  const gable = (p: P, w: number, d: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) =>
    put(p, prism([[-w / 2, 0], [w / 2, 0], [0, h]], d), m, x, y, z, ry);

  // ── Reusable pieces ──
  const bagGeo = (() => {
    const g = new THREE.CapsuleGeometry(0.16, 0.4, 3, 8);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 0.62, 1.1);
    return g;
  })();
  geos.push(bagGeo);
  /** A sandbag wall `len` long along local x of its own frame (turn it with ry), `rows` high. */
  const sandbags = (p: P, x: number, z: number, len: number, rows: number, ry = 0) => {
    const g = new THREE.Group();
    const n = Math.max(1, Math.round(len / 0.6));
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < n - (r % 2); i++) {
        const m = new THREE.Mesh(bagGeo, C.sand());
        m.position.set(-len / 2 + (i + 0.5 + (r % 2) * 0.5) * (len / n), 0.1 + r * 0.19, Math.sin(i * 7.3 + r) * 0.03);
        m.rotation.y = Math.sin(i * 12.9 + r * 4.1) * 0.07;
        m.castShadow = shadows;
        g.add(m);
      }
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    p.add(g);
  };
  /** Concrete jersey barrier, 1.2 m long along local x of its frame. */
  const jersey = (p: P, x: number, z: number, ry = 0, len = 1.2) =>
    put(p, prism([[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.12, 0.3], [0.08, 0.8], [-0.08, 0.8], [-0.12, 0.3], [-0.3, 0.08]], len), C.concrete(), x, 0, z, ry + Math.PI / 2);
  const crate = (p: P, x: number, z: number, ry = 0, y = 0) => {
    box(p, 0.9, 0.5, 0.5, C.armyGreen(), x, y, z, ry);
    plate(p, 0.92, 0.04, 0.06, C.black(), x, y + 0.36, z, ry);
  };
  const drum = (p: P, x: number, z: number, m = C.rust(), tilt = 0) => {
    const d = put(p, new THREE.CylinderGeometry(0.29, 0.29, 0.88, 14), m, x, tilt ? 0.29 : 0.44, z, 0, 0, tilt);
    if (!tilt) for (const y of [0.25, 0.62]) post(p, 0.3, 0.03, m, x, z, y);
    return d;
  };
  const striped = (len: number, a = C.red(), b = C.white(), t = 0.1) => {
    const g = new THREE.Group();
    const n = Math.max(2, Math.round(len / 0.5));
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(geo(new THREE.BoxGeometry(len / n, t, t)), i % 2 ? b : a);
      s.position.x = (i + 0.5) * (len / n);
      s.castShadow = shadows;
      g.add(s);
    }
    return g;
  };
  /** A boom barrier across the lane at z, pivoting up from a counterweighted post on the +x side. */
  const barrier = (p: P, id: number, z: number) => {
    box(p, 0.5, 0.25, 0.5, C.concrete(), 2.95, 0, z);
    box(p, 0.32, 1.0, 0.32, C.white(), 2.95, 0.25, z);
    plate(p, 0.34, 0.12, 0.34, C.red(), 2.95, 0.85, z);
    post(p, 0.06, 0.85, C.white(), -2.9, z);
    plate(p, 0.3, 0.06, 0.22, C.metal(), -2.9, 0.85, z);
    const pivot = new THREE.Group();
    pivot.userData[DYNAMIC] = true;
    pivot.position.set(2.95, 1.05, z);
    const arm = striped(5.9);
    arm.rotation.y = Math.PI; // extend towards −x
    pivot.add(arm);
    const weight = new THREE.Mesh(geo(new THREE.BoxGeometry(0.6, 0.22, 0.22)), C.darkConcrete());
    weight.position.x = 0.5;
    pivot.add(weight);
    p.add(pivot);
    movers.set(id, (t) => (pivot.rotation.z = -Math.min(1, t * 1.6) * 1.4));
  };
  const lampPost = (p: P, x: number, z: number, h = 6, armDir = 1) => {
    post(p, 0.07, h, C.steel(), x, z);
    plate(p, 1.0, 0.06, 0.06, C.steel(), x + armDir * 0.45, h - 0.1, z);
    plate(p, 0.45, 0.12, 0.22, C.darkConcrete(), x + armDir * 0.9, h - 0.2, z);
  };
  const flag = (p: P, x: number, z: number, top: number, bottom: number) => {
    post(p, 0.04, 5, C.metal(), x, z);
    const cloth = (color: number, y: number) => {
      const g = new THREE.PlaneGeometry(1.2, 0.38, 6, 1);
      const pos = g.attributes.position!;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 4) * 0.06);
      g.computeVertexNormals();
      put(p, g, mat(color, null, 0.9, 0, false, { double: true }), x + 0.62, y, z);
    };
    cloth(top, 4.73);
    cloth(bottom, 4.35);
  };
  const coilGeo = new THREE.TorusGeometry(0.38, 0.012, 4, 16);
  geos.push(coilGeo);
  /** Concertina wire along local x. */
  const wire = (p: P, x: number, z: number, len: number, ry = 0) => {
    const g = new THREE.Group();
    for (let i = 0; i < len / 0.28; i++) {
      const m = new THREE.Mesh(coilGeo, C.metal());
      m.position.set(-len / 2 + i * 0.28, 0.38, 0);
      m.rotation.y = Math.PI / 2 + 0.3;
      g.add(m);
    }
    for (let i = 0; i <= len / 2.5; i++) {
      const s = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5)), C.darkWood());
      s.position.set(-len / 2 + i * 2.5, 0.5, 0);
      g.add(s);
    }
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    p.add(g);
  };
  /** Czech hedgehog: three crossed steel beams. */
  const hedgehog = (p: P, x: number, z: number, ry = 0) => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 1.7, 0.12)), C.rust());
      b.rotation.set(i === 0 ? 0.95 : 0, (i * Math.PI * 2) / 3, i === 0 ? 0 : 0.95, 'YXZ');
      b.position.y = 0.6;
      b.castShadow = shadows;
      g.add(b);
    }
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    p.add(g);
  };
  /** Soviet concrete panel fence (PO-2) from x0 to x1 at z, with barbed wire on top. */
  const panelFence = (p: P, x0: number, x1: number, z: number) => {
    const n = Math.max(1, Math.round(Math.abs(x1 - x0) / 2.5));
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const cx = x0 + step * (i + 0.5);
      plate(p, Math.abs(step) - 0.08, 2.3, 0.14, C.concrete(), cx, 0, z);
      // The panels' diamond relief reads as a band of darker squares.
      for (let k = -1; k <= 1; k++) plate(p, 0.42, 0.42, 0.02, C.darkConcrete(), cx + k * 0.7, 0.95, z - 0.08, 0, 0, Math.PI / 4);
    }
    for (let i = 0; i <= n; i++) {
      const px = x0 + step * i;
      plate(p, 0.22, 2.55, 0.22, C.darkConcrete(), px, 0, z);
      plate(p, 0.04, 0.5, 0.04, C.steel(), px, 2.5, z - 0.12, 0, -0.5);
    }
    for (const dy of [2.62, 2.78]) plate(p, Math.abs(x1 - x0), 0.015, 0.015, C.steel(), (x0 + x1) / 2, dy, z - 0.18);
  };
  /** Water from z0 out past the map edge, with a muddy bank (or concrete quay) at its near shore. */
  const shore = (p: P, x0: number, x1: number, z0: number, quay = false) => {
    ground(p, x0 - 2.5, z0, x1 + 2.5, 15, C.water(), 0.025);
    if (quay) {
      for (const [a, b] of [[x0, -1.6], [1.6, x1]] as const) plate(p, b - a, 0.32, 0.45, C.darkConcrete(), (a + b) / 2, 0, z0 - 0.15);
      for (let x = x0 + 1.2; x < x1 - 0.5; x += 4.2) if (Math.abs(x) > 2.4) post(p, 0.13, 0.5, C.black(), x, z0 - 0.25, 0.3, 10);
    } else {
      ground(p, x0, z0 - 0.5, x1, z0 + 0.25, C.mud(), 0.03);
      for (let i = 0; i < 14; i++) {
        const x = x0 + ((i * 7.31) % 1) * (x1 - x0);
        if (Math.abs(x) < 2.8) continue;
        reeds(p, x, z0 + 0.15 + (i % 3) * 0.2);
      }
    }
  };
  const reeds = (p: P, x: number, z: number) => {
    for (let k = 0; k < 5; k++) {
      const h = 0.8 + ((k * 0.37) % 0.5);
      put(p, new THREE.ConeGeometry(0.03, h, 4), mat(0x8a8a4a, null, 1), x + Math.sin(k * 2.1) * 0.25, h / 2, z + Math.cos(k * 1.7) * 0.2, 0, Math.sin(k) * 0.15, Math.cos(k * 3) * 0.15);
    }
  };
  /** A log lying along local x (bark, cut ends). */
  const log = (p: P, x: number, y: number, z: number, len: number, r: number, ry = 0) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r * 1.05, len, 10)), C.bark());
    body.rotation.z = Math.PI / 2;
    g.add(body);
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(geo(new THREE.CircleGeometry(r * 0.98, 10)), C.cut());
      end.position.x = (s * len) / 2 + s * 0.003;
      end.rotation.y = (s * Math.PI) / 2;
      g.add(end);
    }
    g.position.set(x, y, z);
    g.rotation.y = ry;
    for (const c of g.children) c.castShadow = shadows;
    p.add(g);
  };
  /** Stack of logs along x: rows of n, n-1, … */
  const logPile = (p: P, x: number, z: number, len: number, n: number, r = 0.24) => {
    for (let row = 0; row < n; row++)
      for (let i = 0; i < n - row; i++) log(p, x + Math.sin(i * 3.1 + row) * 0.12, r + row * r * 1.72, z + (i - (n - row - 1) / 2) * r * 2.02, len, r * (0.9 + ((i * 7 + row) % 3) * 0.05));
  };
  const stump = (p: P, x: number, z: number, r = 0.32) => {
    post(p, r, 0.45, C.bark(), x, z, 0, 9);
    put(p, new THREE.CircleGeometry(r * 0.95, 9), C.cut(), x, 0.455, z, 0, -Math.PI / 2);
  };
  const rocks = (p: P, x: number, z: number, n: number, spread = 0.8, m = C.darkConcrete()) => {
    for (let i = 0; i < n; i++) {
      const r = 0.18 + ((i * 37) % 7) * 0.05;
      put(p, new THREE.DodecahedronGeometry(r, 0), m, x + Math.sin(i * 2.4) * spread, r * 0.5, z + Math.cos(i * 1.9) * spread, i, i * 0.7);
    }
  };
  /** Small building with windows, a door on `doorSide` (±x face) and a flat or pitched roof. */
  const hut = (
    p: P,
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    wall: THREE.Material,
    o: { roof?: 'flat' | 'gable'; roofMat?: THREE.Material; door?: 1 | -1; stripe?: THREE.Material; windowsAll?: boolean } = {},
  ) => {
    box(p, w + 0.15, 0.18, d + 0.15, C.darkConcrete(), x, 0, z);
    box(p, w, h, d, wall, x, 0.18, z);
    if (o.stripe) plate(p, w + 0.02, 0.22, d + 0.02, o.stripe, x, 0.85, z);
    const door = o.door ?? 1;
    plate(p, 0.04, 1.95, 0.85, C.darkWood(), x + door * (w / 2 + 0.01), 0.2, z - d * 0.2);
    // Windows: a band on the long faces (all four with windowsAll: a guard booth sees every way).
    const win = (wx: number, wz: number, ww: number, wd: number) => plate(p, ww, 0.8, wd, C.glass(), wx, 1.15, wz);
    win(x, z + d / 2 + 0.01, w * 0.6, 0.04);
    win(x, z - d / 2 - 0.01, w * 0.6, 0.04);
    if (o.windowsAll) win(x - door * (w / 2 + 0.01), z, 0.04, d * 0.6);
    win(x + door * (w / 2 + 0.01), z + d * 0.22, 0.04, d * 0.3);
    const top = 0.18 + h;
    if (o.roof === 'gable') gable(p, w + 0.6, d + 0.6, Math.min(w, d) * 0.45, o.roofMat ?? C.roof(), x, top, z, w > d ? Math.PI / 2 : 0);
    else {
      box(p, w + 0.5, 0.16, d + 0.5, o.roofMat ?? C.overConcrete(), x, top, z);
    }
  };

  // ── One builder per kind ──
  const BUILD: Record<ExtractKind, (p: THREE.Group, e: Extraction) => void> = {
    checkpoint: (p, e) => {
      barrier(p, e.id, 1.0);
      // Guard booth [-5.8…-3.4, -0.8…2.0]: windows every way, blue band, door onto the lane.
      hut(p, -4.6, 0.6, 2.1, 2.5, 2.3, C.plaster(), { stripe: C.blue(), windowsAll: true });
      post(p, 0.02, 1.4, C.steel(), -5.3, 0.0, 2.6);
      plate(p, 0.5, 0.25, 0.3, C.darkConcrete(), -4.0, 2.64, 1.4); // floodlight on the roof
      // Jersey barriers funnel traffic out to the edge [±(2.9…3.5), 2.6…7.4].
      for (const s of [-1, 1]) for (let z = 3.2; z < 7.4; z += 1.25) jersey(p, s * 3.2, z, Math.PI / 2);
      // Chicane on the way in.
      jersey(p, 3.95, -4.1, 0, 2.4);
      jersey(p, -3.95, -6.1, 0, 2.4);
      // Speed bump and stop line.
      const bump = striped(4.8, C.yellow(), C.black(), 0.12);
      bump.position.set(-2.4, 0.03, -2.4);
      p.add(bump);
      plate(p, 4.8, 0.01, 0.3, C.white(), 0, 0.02, -0.6);
      // STOP sign facing in.
      post(p, 0.04, 2.2, C.steel(), 2.95, -2.6);
      put(p, new THREE.CylinderGeometry(0.36, 0.36, 0.04, 8), C.red(), 2.95, 2.0, -2.62, Math.PI / 8, Math.PI / 2);
      put(p, new THREE.CylinderGeometry(0.3, 0.3, 0.045, 8), C.white(), 2.95, 2.0, -2.63, Math.PI / 8, Math.PI / 2);
      put(p, new THREE.CylinderGeometry(0.27, 0.27, 0.05, 8), C.red(), 2.95, 2.0, -2.64, Math.PI / 8, Math.PI / 2);
      // Sandbag nest on the far side [4.4…6.6, -1.4…1.6].
      sandbags(p, 4.6, 0.1, 3.0, 3, Math.PI / 2);
      sandbags(p, 5.6, -1.25, 2.0, 3);
      sandbags(p, 5.6, 1.45, 2.0, 3);
      crate(p, 5.7, 0.3, 0.2);
      lampPost(p, -3.2, 2.4, 6, 1);
      drum(p, -3.1, -1.2, C.blue());
    },
    outpost: (p, e) => {
      barrier(p, e.id, 1.0);
      watchtower(p, -5.2, 2.2, 4.4);
      // Sandbag L around the firing position [3.1…3.7, -0.6…3.6] + [3.1…6.8, 3.6…4.2], camo net overhead.
      sandbags(p, 3.4, 1.5, 4.2, 4, Math.PI / 2);
      sandbags(p, 5.0, 3.9, 3.6, 4);
      for (const [x, z] of [[3.5, -0.4], [6.6, -0.4], [3.5, 3.5], [6.6, 3.5]] as const) post(p, 0.04, 2.2, C.darkWood(), x, z);
      const net = new THREE.PlaneGeometry(3.6, 4.4, 6, 6);
      const np = net.attributes.position!;
      for (let i = 0; i < np.count; i++) np.setZ(i, -Math.abs(Math.sin(np.getX(i) * 1.9) * Math.cos(np.getY(i) * 1.4)) * 0.3);
      net.computeVertexNormals();
      put(p, net, mat(0x4f5a38, null, 1, 0, true, { double: true, opacity: 0.82 }), 5.05, 2.2, 1.55, 0, -Math.PI / 2);
      crate(p, 5.2, 2.6, 0.1);
      crate(p, 5.4, 2.0, -0.2);
      sandbags(p, -3.4, -1.1, 3.0, 3, Math.PI / 2);
      // Dugout [3.8…7.2, -6.0…-2.6]: log walls, earth roof, a way down at the lane side.
      for (const y of [0.2, 0.58]) {
        log(p, 6.95, y, -4.3, 3.3, 0.2, Math.PI / 2);
        log(p, 5.5, y, -5.8, 3.0, 0.2);
      }
      bank(p, 4.2, 7.2, [[-6.0, 0], [-5.6, 0.9], [-3.2, 0.9], [-2.6, 0]], C.earth());
      plate(p, 1.0, 0.9, 0.08, C.black(), 3.95, 0, -4.2, Math.PI / 2);
      // Wire and hedgehogs along the edge [±(2.8…8.5), 6.0…6.8].
      wire(p, 5.6, 6.4, 5.6);
      wire(p, -5.6, 6.4, 5.6);
      hedgehog(p, 4.0, 5.2, 0.4);
      hedgehog(p, -4.2, 5.0, 1.1);
      flag(p, -3.3, 0.9, 0x4b5536, 0xdedad0);
      drum(p, -3.3, -3.4, C.armyGreen());
    },
    gate: (p, e) => {
      // Concrete panel fence along the edge [±(3.0…8.5), 2.2…2.6], pillars either side of the lane.
      panelFence(p, 3.0, 8.5, 2.4);
      panelFence(p, -3.0, -8.5, 2.4);
      for (const s of [-1, 1]) {
        box(p, 0.55, 3.0, 0.55, C.darkConcrete(), s * 2.75, 0, 2.4);
        plate(p, 0.6, 0.1, 0.6, C.red(), s * 2.75, 2.7, 2.4);
      }
      // Sliding gate: green steel frame with bars, rolls behind the fence towards −x.
      const leaf = new THREE.Group();
      leaf.userData[DYNAMIC] = true;
      const green = mat(0x34503a, 'metal', 0.6, 0.4);
      plate(leaf, 5.4, 0.12, 0.08, green, 0, 0.15, 0);
      plate(leaf, 5.4, 0.12, 0.08, green, 0, 2.2, 0);
      for (let i = 0; i <= 12; i++) plate(leaf, 0.05, 2.1, 0.05, green, -2.7 + i * 0.45, 0.2, 0);
      const brace = new THREE.Mesh(geo(new THREE.BoxGeometry(5.6, 0.08, 0.06)), green);
      brace.position.set(0, 1.25, 0.02);
      brace.rotation.z = 0.36;
      leaf.add(brace);
      for (const s of [-1, 1]) {
        const wheel = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10)), C.black());
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(s * 2.2, 0.12, 0);
        leaf.add(wheel);
      }
      leaf.position.set(0, 0, 1.95);
      p.add(leaf);
      movers.set(e.id, (t) => (leaf.position.x = -Math.min(1, t * 1.4) * 5.6));
      // Gatehouse inside [4.0…7.2, -2.8…0.6], window onto the lane.
      hut(p, 5.6, -1.1, 2.9, 3.1, 2.5, C.brick(), { roof: 'flat', door: -1 });
      plate(p, 1.2, 0.5, 0.05, C.white(), 5.6, 2.3, 0.53);
      lampPost(p, -3.4, 1.2, 6.5, 1);
      plate(p, 4.8, 0.01, 0.3, C.white(), 0, 0.02, 0.6);
      jersey(p, -3.6, -2.6, Math.PI / 2);
      drum(p, 3.6, -3.4);
    },
    bridge: (p, e) => {
      const rail = /rail/i.test(e.name);
      // River across the way [±(2.4…9.5), 2.6…] with the near bank; the deck spans it out past the edge.
      shore(p, -9.5, 9.5, 2.9);
      for (const s of [-1, 1]) {
        box(p, 1.4, 0.7, 1.4, C.darkConcrete(), s * 2.4, 0, 2.6); // abutment
        box(p, 1.2, 0.9, 1.2, C.darkConcrete(), s * 2.4, -0.5, 8.6); // pier in the water
      }
      plate(p, 4.4, 0.12, 15, C.darkConcrete(), 0, -0.07, 8.0);
      const steel = rail ? mat(0x4c5a52, 'metal', 0.6, 0.45) : C.rust();
      const overSteel = rail ? mat(0x4c5a52, 'metal', 0.6, 0.45, true) : mat(0x7a4a2e, 'metal', 0.75, 0.3, true);
      for (const s of [-1, 1]) {
        const x = s * 2.3;
        plate(p, 0.22, 0.4, 15, steel, x, 0, 8.0); // bottom chord
        plate(p, 0.22, 0.25, 12.6, overSteel, x, 3.2, 8.4); // top chord
        for (let i = 0; i < 6; i++) {
          const z0 = 1.6 + i * 2.2;
          beam(p, [x, 0.4, z0], [x, 3.3, z0 + 1.1], 0.14, steel);
          beam(p, [x, 3.3, z0 + 1.1], [x, 0.4, z0 + 2.2], 0.14, steel);
          plate(p, 0.12, 3.0, 0.12, steel, x, 0.3, z0);
        }
      }
      for (let z = 2.7; z < 15; z += 2.2) plate(p, 4.8, 0.18, 0.18, overSteel, 0, 3.3, z); // portal bracing overhead
      if (rail) {
        for (let z = -6; z < 15; z += 0.6) plate(p, 2.4, 0.08, 0.24, C.darkWood(), 0, 0.02, z);
        for (const dx of [-0.75, 0.75]) plate(p, 0.08, 0.1, 21, C.steel(), dx, 0.08, 4.5);
      } else {
        for (let z = 2.6; z < 15; z += 0.5) plate(p, 4.2, 0.05, 0.46, C.darkWood(), 0, 0.02, z);
      }
      plate(p, 0.9, 0.6, 0.06, C.white(), 3.4, 1.4, 1.3); // weight-limit sign
      post(p, 0.04, 1.4, C.steel(), 3.4, 1.35);
    },
    tunnel: (p) => {
      // A hill the road runs into [±(2.6…9.5), 3.0…]: portal face, wing walls, the bore over the lane.
      const ridge: [number, number][] = [[3.0, 0], [3.4, 2.4], [4.2, 4.1], [5.5, 4.75], [7.5, 5.0], [9.5, 5.1], [12, 4.7], [14.5, 3.4], [16.5, 1.6], [17.5, 0]];
      hill(p, -14, -2.6, ridge, C.earth(), true, false);
      hill(p, 2.6, 14, ridge, C.earth(), false, true);
      bank(p, -2.6, 2.6, [[3.6, 4.4], [3.6, 4.6], [5.5, 4.75], [7.5, 5.0], [9.5, 5.1], [12, 4.7], [14.5, 4.4]], C.overEarth());
      for (const s of [-1, 1]) plate(p, 0.4, 4.4, 12, C.wetConcrete(), s * 2.45, 0, 9.4);
      ground(p, -2.3, 3.2, 2.3, 15.5, C.black(), 4.3);
      ground(p, -2.3, 3.2, 2.3, 15.5, C.black(), 0.025);
      // Portal: concrete face with an arched bore, its crown broken off on one side.
      const arch = new THREE.Shape();
      arch.moveTo(-4.8, 0);
      arch.lineTo(-2.3, 0);
      arch.lineTo(-2.3, 2.6);
      arch.absarc(0, 2.6, 2.3, Math.PI, 0, true);
      arch.lineTo(2.3, 0);
      arch.lineTo(4.8, 0);
      arch.lineTo(4.8, 5.6);
      arch.lineTo(1.4, 5.6);
      arch.lineTo(0.9, 5.15);
      arch.lineTo(0.2, 5.4);
      arch.lineTo(-0.5, 5.05);
      arch.lineTo(-4.8, 5.6);
      const face = new THREE.ExtrudeGeometry(arch, { depth: 1.0, bevelEnabled: false });
      put(p, face, C.concrete(), 0, 0, 2.7);
      // Broken crown: the cap beam survives either side of the gap.
      plate(p, 4.2, 0.3, 1.3, C.darkConcrete(), -2.7, 5.55, 3.2);
      plate(p, 3.3, 0.3, 1.3, C.darkConcrete(), 3.15, 5.55, 3.2);
      for (const s of [-1, 1]) put(p, wingWall(s, 3.2, 4.6), C.darkConcrete(), s * 6.3, 0, 2.9, s * 0.35);
      // Collapse: fallen crown chunks and rubble banked against the walls, a fallen lamp; the middle passable.
      rocks(p, -1.6, 4.4, 7, 0.5, C.concrete());
      rocks(p, 1.8, 3.6, 4, 0.4, C.concrete());
      put(p, new RoundedBoxGeometry(1.6, 0.5, 0.7, 2, 0.05), C.darkConcrete(), -1.1, 0.3, 2.1, 0.5, 0, 0.25);
      put(p, new RoundedBoxGeometry(1.1, 0.45, 0.6, 2, 0.05), C.darkConcrete(), 3.4, 0.22, 1.6, -0.3, 0.1, 0);
      for (let i = 0; i < 4; i++) beam(p, [-1.0 + i * 0.2, 0.4, 2.1], [-1.3 + i * 0.35, 1.1 + i * 0.1, 1.8], 0.03, C.rust());
      // Warning: road closed.
      post(p, 0.04, 1.6, C.steel(), -3.2, 0.6);
      plate(p, 0.8, 0.8, 0.04, C.white(), -3.2, 1.25, 0.58, 0, 0, Math.PI / 4);
      plate(p, 0.6, 0.6, 0.05, C.red(), -3.2, 1.35, 0.57, 0, 0, Math.PI / 4);
      jersey(p, 3.4, -0.4, Math.PI / 2);
      jersey(p, -3.5, -2.0, 0.2);
    },
    station: (p) => {
      // Canopy over the lane: steel deck with a red-and-white fascia, one panel fallen out.
      const cw = 9.6;
      const cd = 6.6;
      const cy = 4.3;
      const deck = mat(0xc4c2bb, null, 0.6, 0.2, true);
      plate(p, 3.6, 0.28, cd, deck, -3.0, cy, 0.2);
      plate(p, 6.0, 0.28, 4.2, deck, 1.8, cy, -1.0);
      plate(p, 3.6, 0.28, 2.4, deck, 3.0, cy, 2.3);
      for (const [w, d, x, z] of [[cw, 0.12, 0, 0.2 - cd / 2], [cw, 0.12, 0, 0.2 + cd / 2], [0.12, cd, -cw / 2, 0.2], [0.12, cd, cw / 2, 0.2]] as const) {
        plate(p, w + 0.06, 0.3, d + 0.1, C.overWhite(), x, cy - 0.05, z);
        plate(p, w + 0.06, 0.3, d + 0.1, mat(0xb8302a, null, 0.6, 0, true), x, cy + 0.25, z);
      }
      // The fallen panel leans on an island.
      plate(p, 2.2, 0.08, 1.4, C.overConcrete(), 2.75, 0.5, 2.9, 0.2, 0.55, 0.1);
      for (const s of [-1, 1]) {
        box(p, 1.2, 0.2, 3.6, C.concrete(), s * 3.6, 0, 0.2); // island
        plate(p, 1.22, 0.21, 0.3, C.yellow(), s * 3.6, 0, -1.48);
        plate(p, 1.22, 0.21, 0.3, C.yellow(), s * 3.6, 0, 1.88);
        for (const z of [-1.1, 1.5]) plate(p, 0.32, cy - 0.2, 0.32, C.white(), s * 3.6, 0.2, z); // columns
        // Pump: white body, red crown, display facing the lane, hose and nozzle.
        box(p, 0.55, 1.55, 0.9, C.white(), s * 3.6, 0.2, 0.2);
        plate(p, 0.57, 0.3, 0.92, C.red(), s * 3.6, 1.6, 0.2);
        plate(p, 0.02, 0.3, 0.5, C.black(), s * 3.31, 1.2, 0.2);
        plate(p, 0.02, 0.16, 0.5, mat(0x9fb37a, null, 0.4), s * 3.31, 0.85, 0.2);
        put(p, new THREE.TorusGeometry(0.4, 0.025, 5, 12, Math.PI), C.black(), s * 3.31, 0.75, 0.7, Math.PI / 2, 0, Math.PI);
        plate(p, 0.08, 0.2, 0.06, C.black(), s * 3.29, 0.85, 0.82);
      }
      // Price sign by the road in [5.4…6.2, -5.6…-4.8].
      post(p, 0.12, 4.0, C.steel(), 5.8, -5.2);
      plate(p, 1.6, 2.2, 0.2, C.white(), 5.8, 3.6, -5.2);
      plate(p, 1.62, 0.5, 0.22, C.red(), 5.8, 5.3, -5.2);
      for (let i = 0; i < 3; i++) plate(p, 1.2, 0.36, 0.22, C.black(), 5.8, 3.8 + i * 0.48, -5.2);
      // Kiosk [-8.4…-4.8, -6.0…-2.0]: glass front onto the forecourt, red fascia, AC unit, bins.
      box(p, 3.6, 0.15, 4.0, C.darkConcrete(), -6.6, 0, -4.0);
      box(p, 3.4, 2.8, 3.8, C.plaster(), -6.7, 0.15, -4.0);
      plate(p, 0.05, 1.9, 3.0, C.glass(), -4.98, 0.4, -4.0);
      plate(p, 0.06, 2.0, 0.9, C.darkWood(), -4.97, 0.15, -2.9);
      plate(p, 3.8, 0.3, 4.2, C.overWhite(), -6.6, 2.95, -4.0);
      plate(p, 3.84, 0.2, 4.24, mat(0xa8352c, null, 0.7, 0, true), -6.6, 2.85, -4.0);
      box(p, 0.9, 0.6, 0.7, C.metal(), -7.4, 3.25, -4.8);
      drum(p, -4.5, -6.3);
      drum(p, -4.1, -6.6, C.blue());
      for (let i = 0; i < 4; i++) put(p, new THREE.TorusGeometry(0.33, 0.13, 6, 12), C.black(), 4.4, 0.13 + i * 0.24, -4.4, 0, Math.PI / 2);
      // An abandoned car at the far pump.
      car(p, 5.6, 1.4);
    },
    path: (p, e) => {
      const trail = /trail|hunt/i.test(e.name);
      // Signpost: arrow boards pointing out of the zone.
      post(p, 0.07, 2.1, C.darkWood(), 1.9, -0.8);
      put(p, prism([[-0.45, -0.11], [0.35, -0.11], [0.5, 0], [0.35, 0.11], [-0.45, 0.11]], 0.05), C.wood(), 1.9, 1.75, -0.8, -Math.PI / 2, 0, 0);
      put(p, prism([[-0.45, -0.1], [0.35, -0.1], [0.5, 0], [0.35, 0.1], [-0.45, 0.1]], 0.05), C.wood(), 2.0, 1.45, -0.8, Math.PI, 0, 0);
      // Trail markers: red-white bands on posts.
      for (const [x, z] of [[-1.7, 3.4], [1.6, 6.3], [-1.4, -4.8]] as const) {
        post(p, 0.07, 1.25, C.darkWood(), x, z);
        post(p, 0.075, 0.12, C.white(), x, z, 0.95);
        post(p, 0.075, 0.12, C.red(), x, z, 1.07);
      }
      // Fallen tree [-5.0…-2.4, -1.4…-0.8] with its root plate.
      log(p, -3.7, 0.3, -1.1, 2.6, 0.28);
      put(p, new THREE.CylinderGeometry(0.8, 0.7, 0.3, 9), C.mud(), -5.15, 0.6, -1.1, 0, 0, Math.PI / 2);
      for (let i = 0; i < 3; i++) beam(p, [-4.0 + i * 0.6, 0.45, -1.1], [-3.8 + i * 0.6, 1.0, -1.6 + (i % 2) * 1.0], 0.06, C.bark());
      // A rest spot: fire ring, stump seats, (on a hunters' trail) a raised hide.
      rocks(p, 3.4, -3.6, 8, 0.45, C.darkConcrete());
      put(p, new THREE.CircleGeometry(0.4, 10), C.black(), 3.4, 0.03, -3.6, 0, -Math.PI / 2);
      log(p, 3.4, 0.14, -3.6, 0.6, 0.06, 0.5);
      stump(p, 4.3, -2.8);
      stump(p, 2.5, -4.5, 0.28);
      if (trail) {
        // Hunters' high seat (лабаз) at the trail side.
        for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]] as const) put(p, new THREE.CylinderGeometry(0.06, 0.07, 3.2, 6), C.darkWood(), -4.4 + dx, 1.6, -4.2 + dz, 0, dz * 0.08, dx * 0.08);
        box(p, 1.4, 0.08, 1.4, C.wood(), -4.4, 3.1, -4.2);
        for (const [dx, dz, w, d] of [[0, -0.68, 1.4, 0.05], [0, 0.68, 1.4, 0.05], [-0.68, 0, 0.05, 1.4]] as const) plate(p, w, 0.7, d, C.wood(), -4.4 + dx, 3.18, -4.2 + dz);
        gable(p, 1.7, 1.7, 0.6, C.overWood(), -4.4, 4.2, -4.2);
      } else {
        // Bench by the path.
        stump(p, -3.6, -4.0, 0.2);
        stump(p, -2.4, -4.0, 0.2);
        plate(p, 1.6, 0.06, 0.35, C.wood(), -3.0, 0.45, -4.0);
      }
    },
    pier: (p) => {
      // Water from z 1.6 out [±(1.6…9.5), 1.6…], a concrete quay, the pier walkway straight out.
      shore(p, -9.5, 9.5, 1.8, true);
      plate(p, 3.0, 0.08, 14, C.wood(), 0, -0.02, 7.6);
      for (let z = 1.2; z < 15; z += 0.55) plate(p, 3.0, 0.02, 0.05, C.darkWood(), 0, 0.06, z);
      for (let z = 2.2; z < 15; z += 2.4)
        for (const s of [-1, 1]) {
          post(p, 0.13, 1.1, C.darkWood(), s * 1.55, z, -0.2);
          put(p, new THREE.CylinderGeometry(0.15, 0.15, 0.04, 8), C.cut(), s * 1.55, 0.91, z);
        }
      for (const s of [-1, 1]) plate(p, 0.03, 0.03, 13, mat(0x9a8a6a, null, 1), s * 1.55, 0.78, 8.0);
      // Ticket booth / shelter [-5.6…-3.0, -3.4…-0.8].
      hut(p, -4.3, -2.1, 2.3, 2.3, 2.2, C.wood(), { roof: 'gable', door: 1, roofMat: C.roof() });
      plate(p, 1.4, 0.4, 0.05, C.blue(), -4.3, 2.0, -0.92);
      // Life ring, lamp, a rowboat tied alongside.
      post(p, 0.05, 1.5, C.white(), 1.95, 0.8);
      put(p, new THREE.TorusGeometry(0.3, 0.08, 6, 14), C.red(), 1.95, 1.15, 0.86);
      lampPost(p, -1.9, 0.6, 4.5, 1);
      rowboat(p, 2.9, 5.2, 0.15);
      rocks(p, 5.5, 1.3, 4, 1.2, C.darkConcrete());
      rocks(p, -6.5, 1.3, 4, 1.2, C.darkConcrete());
    },
    boat: (p) => {
      // Water from z 1.2 [±(1.3…9.5), 1.2…], a narrow plank jetty and a motor launch tied alongside.
      shore(p, -9.5, 9.5, 1.3);
      plate(p, 2.2, 0.08, 9.5, C.darkWood(), 0, -0.02, 5.4);
      for (let z = 0.9; z < 10; z += 0.5) plate(p, 2.2, 0.02, 0.05, C.black(), 0, 0.06, z);
      for (let z = 1.6; z < 10; z += 2.6) for (const s of [-1, 1]) post(p, 0.11, 0.9, C.darkWood(), s * 1.15, z, -0.2);
      launch(p, 2.6, 5.0);
      // Contraband on the shore [-4.8…-3.0, -1.8…-0.4], a tarp lean-to [3.2…6.4, -3.8…-1.0].
      crate(p, -4.2, -1.4, 0.2);
      crate(p, -3.6, -0.8, -0.3);
      crate(p, -3.9, -1.1, 0.1, 0.5);
      for (let i = 0; i < 3; i++) box(p, 0.2, 0.42, 0.32, C.red(), -3.2 + i * 0.25, 0, -0.55);
      for (const [x, z] of [[3.4, -3.6], [6.2, -3.6], [3.4, -1.2], [6.2, -1.2]] as const) post(p, 0.04, 1.8, C.darkWood(), x, z);
      gable(p, 3.4, 3.0, 0.7, mat(0x3a5f86, null, 0.8, 0, true, { double: true }), 4.8, 1.75, -2.4, Math.PI / 2);
      crate(p, 4.4, -2.6);
      crate(p, 5.4, -2.4, 0.4);
      drum(p, 5.9, -1.5, C.blue());
      drum(p, 3.9, -1.6, C.rust(), Math.PI / 2);
    },
    tower: (p) => {
      // Fire lookout [-6.6…-3.4, -0.6…2.6]: braced legs, stair, glazed cab.
      watchtower(p, -5.0, 1.0, 7.0, true);
      // Ranger hut [3.4…7.0, -3.4…-0.2], woodpile [3.4…5.8, 0.4…1.3].
      hut(p, 5.2, -1.8, 3.2, 2.8, 2.3, C.darkWood(), { roof: 'gable', door: -1, roofMat: C.roof() });
      plate(p, 0.5, 1.3, 0.5, C.brick(), 6.3, 2.6, -1.4);
      logPile(p, 4.6, 0.85, 2.2, 3, 0.15);
      plate(p, 1.4, 0.6, 0.06, mat(0x3f6a3a, null, 0.8), 2.9, 1.3, -4.0);
      post(p, 0.05, 1.4, C.darkWood(), 2.4, -4.0);
      post(p, 0.05, 1.4, C.darkWood(), 3.4, -4.0);
      stump(p, 2.9, 0.9);
      drum(p, 3.0, -0.6, C.armyGreen());
    },
    camp: (p) => {
      // Log decks [-7.6…-3.2, -1.4…1.4] and [3.2…7.6, 1.4…3.8].
      logPile(p, -5.4, 0, 4.3, 5, 0.26);
      logPile(p, 5.4, 2.6, 4.3, 4, 0.27);
      // Crew trailer [3.4…8.0, -5.0…-2.4]: blue steel box on blocks, steps, windows.
      for (const x of [3.9, 7.5]) for (const z of [-4.7, -2.7]) box(p, 0.4, 0.4, 0.4, C.darkConcrete(), x, 0, z);
      box(p, 4.5, 2.4, 2.5, mat(0x3c5a78, 'metal', 0.7, 0.3), 5.7, 0.4, -3.7);
      box(p, 4.6, 0.12, 2.6, C.overConcrete(), 5.7, 2.8, -3.7);
      plate(p, 0.04, 1.7, 0.8, C.darkWood(), 3.44, 0.5, -3.7);
      box(p, 0.6, 0.4, 0.9, C.metal(), 3.0, 0, -3.7);
      for (const x of [4.6, 6.8]) plate(p, 1.0, 0.6, 0.04, C.glass(), x, 1.4, -2.44);
      // Work area: sawbuck with a log, stumps (one with an axe), fuel barrels, sawdust.
      ground(p, -2.8, -5.6, 2.8, -2.2, mat(0x8a7350, 'dirt', 1), 0.025);
      for (const x of [-0.7, 0.7]) {
        beam(p, [x - 0.35, 0, -4.0], [x + 0.35, 1.0, -4.0], 0.08, C.wood());
        beam(p, [x + 0.35, 0, -4.0], [x - 0.35, 1.0, -4.0], 0.08, C.wood());
      }
      log(p, 0, 0.92, -4.0, 2.6, 0.17);
      stump(p, -3.5, -4.6, 0.4);
      plate(p, 0.06, 0.6, 0.12, C.darkWood(), -3.5, 0.5, -4.6, 0, 0.5);
      stump(p, 2.9, 0.6, 0.34);
      stump(p, -2.9, 3.4, 0.38);
      stump(p, 3.1, 5.6, 0.3);
      drum(p, -3.1, -2.6, C.red());
      drum(p, -2.8, -3.1, C.red());
    },
    mill: (p) => {
      // Millstream across the way [±(1.1…9.5), 2.2…4.4], a plank footbridge over it.
      ground(p, -12, 2.2, 12, 4.4, C.water(), 0.025);
      for (const z of [2.0, 4.6]) ground(p, -12, z - 0.3, 12, z + 0.25, C.mud(), 0.03);
      plate(p, 2.0, 0.1, 3.2, C.wood(), 0, 0, 3.3);
      for (const s of [-1, 1]) {
        for (const z of [1.9, 3.3, 4.7]) post(p, 0.05, 1.0, C.darkWood(), s * 0.95, z, 0.1);
        plate(p, 0.06, 0.06, 3.0, C.darkWood(), s * 0.95, 1.0, 3.3);
      }
      // Mill house [-8.4…-4.0, -2.4…2.2]: stone ground floor, timber upper, steep roof; wheel in the stream.
      box(p, 4.2, 2.4, 4.4, mat(0x8c867a, 'concrete', 1, 0, false, { scale: 0.9 }), -6.2, 0, -0.1);
      box(p, 4.3, 1.6, 4.5, C.darkWood(), -6.2, 2.4, -0.1);
      gable(p, 4.9, 5.1, 2.4, C.roof(), -6.2, 4.0, -0.1, Math.PI / 2);
      plate(p, 0.05, 1.9, 0.9, C.darkWood(), -4.08, 0, -1.2);
      for (const z of [-1.9, 1.4]) plate(p, 0.05, 0.7, 0.6, C.glass(), -4.08, 2.8, z);
      const wheel = new THREE.Group();
      wheel.userData[DYNAMIC] = true;
      for (const dz of [-0.3, 0.3]) {
        const rim = new THREE.Mesh(geo(new THREE.TorusGeometry(1.5, 0.07, 6, 20)), C.darkWood());
        rim.position.z = dz;
        wheel.add(rim);
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const paddle = new THREE.Mesh(geo(new THREE.BoxGeometry(0.06, 0.5, 0.7)), C.wood());
        paddle.position.set(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0);
        paddle.rotation.z = a;
        wheel.add(paddle);
        if (i % 2 === 0) {
          const spoke = new THREE.Mesh(geo(new THREE.BoxGeometry(2.9, 0.06, 0.06)), C.darkWood());
          spoke.rotation.z = a;
          wheel.add(spoke);
        }
      }
      for (const c of wheel.children) c.castShadow = shadows;
      wheel.position.set(-6.0, 1.15, 3.3);
      p.add(wheel);
      spinners.push({ obj: wheel, speed: 0.6 });
      put(p, new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), C.steel(), -6.0, 1.15, 2.7, 0, Math.PI / 2);
      // Millstones and sacks by the door.
      put(p, new THREE.CylinderGeometry(0.55, 0.55, 0.22, 16), C.darkConcrete(), -3.5, 0.55, -3.0, 0, 0, 1.3);
      put(p, new THREE.CylinderGeometry(0.55, 0.55, 0.22, 16), C.darkConcrete(), -3.2, 0.11, -3.6);
      for (let i = 0; i < 4; i++) put(p, new THREE.CapsuleGeometry(0.22, 0.3, 3, 8), mat(0xc2b48e, null, 1), -3.4 + (i % 2) * 0.5, 0.22 + Math.floor(i / 2) * 0.32, -4.4, i, Math.PI / 2);
    },
    dam: (p) => {
      // The road runs along the crest: reservoir on −x [-9.5…-2.6], the drop of the spillway face on +x [2.6…9.5].
      ground(p, -2.6, -7.5, 2.6, 15, C.asphalt(), 0.022);
      for (let z = -7; z < 15; z += 3) plate(p, 0.12, 0.01, 1.4, C.white(), 0, 0.03, z);
      ground(p, -12, -7.5, -3.3, 15, C.water(), 0.025);
      plate(p, 0.7, 0.04, 22.5, C.wetConcrete(), -3.0, 0, 3.75);
      const drop = new THREE.PlaneGeometry(7, 22.5, 6, 1);
      const col = new Float32Array(drop.attributes.position!.count * 3);
      for (let i = 0; i < drop.attributes.position!.count; i++) {
        // Concrete face falling away into the dark: lighter at the crest, black at the foot.
        const k = Math.max(0, 1 - (drop.attributes.position!.getX(i) + 3.5) / 7) ** 1.6;
        col.set([k * 0.75 + 0.03, k * 0.73 + 0.03, k * 0.7 + 0.03], i * 3);
      }
      drop.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const dropMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: getTexture('concrete'), vertexColors: true, roughness: 1 });
      patchWorldMaterial(dropMat, u);
      mats.push(dropMat);
      uvScale.set(dropMat, 0.3);
      const dm = put(p, drop, dropMat, 6.3, 0.02, 3.75, 0, -Math.PI / 2);
      dm.castShadow = false;
      for (let z = -6; z < 15; z += 4.5) plate(p, 7, 0.02, 0.25, C.black(), 6.3, 0.025, z); // expansion joints
      // Parapets with railings, lamps on the downstream side, two sluice-gate hoists.
      for (const s of [-1, 1]) {
        plate(p, 0.4, 0.9, 22.5, C.concrete(), s * 2.8, 0, 3.75);
        for (let z = -7; z < 15; z += 1.8) post(p, 0.03, 0.5, C.steel(), s * 2.8, z, 0.9);
        plate(p, 0.05, 0.05, 22.5, C.steel(), s * 2.8, 1.38, 3.75);
      }
      for (const z of [-5, 1, 7]) lampPost(p, 2.8, z, 5.5, -1);
      for (const z of [-2.2, 4.2]) {
        box(p, 2.2, 3.4, 2.0, C.darkConcrete(), 4.0, 0, z);
        box(p, 2.4, 0.2, 2.2, C.overConcrete(), 4.0, 3.4, z);
        put(p, new THREE.TorusGeometry(0.5, 0.06, 6, 14), C.yellow(), 4.0, 3.9, z, Math.PI / 2);
        plate(p, 1.6, 0.25, 0.1, C.yellow(), 4.0, 2.6, z - 1.05);
      }
    },
    depot: (p) => {
      // Tram depot shed out at the edge [3.0…9.5, 0.4…], tracks into it, a tram on the siding [-5.8…-3.2, -4.8…4.8].
      const shedX = 6.4;
      box(p, 6.4, 5.0, 12, C.brick(), shedX, 0, 6.6);
      gable(p, 7.0, 12.4, 2.0, C.roof(), shedX, 5.0, 6.6);
      plate(p, 1.0, 0.1, 11, C.glass(), shedX, 6.6, 6.6);
      for (const dx of [-1.5, 1.5]) {
        plate(p, 2.4, 3.8, 0.06, C.black(), shedX + dx, 0, 0.58);
        plate(p, 2.6, 0.2, 0.1, C.darkConcrete(), shedX + dx, 3.8, 0.56);
      }
      plate(p, 2.6, 0.5, 0.06, C.white(), shedX, 4.3, 0.56);
      for (const tx of [shedX - 1.5, shedX + 1.5]) tracks(p, tx, -7, 0.6);
      tracks(p, 0, -7.5, 15);
      tracks(p, -4.5, -6, 6);
      tram(p, -4.5, 0);
      // Overhead line: poles both sides of the lane with span wires.
      for (let z = -6; z < 8; z += 6) {
        for (const s of [-1, 1]) post(p, 0.09, 6, C.steel(), s * 2.9, z);
        plate(p, 5.8, 0.02, 0.02, C.black(), 0, 5.6, z);
        plate(p, 0.02, 0.02, 6.2, C.black(), 0, 5.5, z + 3);
      }
      plate(p, 2.0, 1.0, 0.3, C.rust(), -4.5, 0, -6.3); // buffer stop
    },
    outlet: (p) => {
      // Storm-drain outfall: an embankment along the edge [±(1.7…9.5), 3.4…], concrete headwall with a 3 m
      // pipe, a trough leading to it, the grate pried open.
      const bankProfile: [number, number][] = [[3.4, 0], [4.6, 2.2], [5.8, 3.6], [11, 3.9], [14, 2.6], [16, 0]];
      hill(p, -13, -1.7, bankProfile, C.earth(), true, false);
      hill(p, 1.7, 13, bankProfile, C.earth(), false, true);
      bank(p, -1.7, 1.7, [[3.7, 3.1], [3.7, 3.6], [5.8, 3.7], [11, 3.95], [14, 3.0]], C.overEarth());
      const wall = new THREE.Shape();
      wall.moveTo(-4.6, 0);
      wall.lineTo(4.6, 0);
      wall.lineTo(4.6, 3.6);
      wall.lineTo(-4.6, 3.6);
      wall.holes.push(new THREE.Path().absarc(0, 1.55, 1.45, 0, Math.PI * 2, true));
      put(p, new THREE.ExtrudeGeometry(wall, { depth: 0.5, bevelEnabled: false }), C.darkConcrete(), 0, 0, 3.2);
      const pipe = new THREE.CylinderGeometry(1.45, 1.45, 10, 20, 1, true);
      pipe.rotateX(Math.PI / 2);
      const inner = new THREE.MeshStandardMaterial({ color: 0x4a4740, map: getTexture('concrete'), roughness: 1, side: THREE.BackSide });
      patchWorldMaterial(inner, u);
      mats.push(inner);
      uvScale.set(inner, 0.5);
      put(p, pipe, inner, 0, 1.55, 8.6);
      ground(p, -1.4, 3.5, 1.4, 14, C.black(), 0.03);
      for (const s of [-1, 1]) put(p, wingWall(s, 3.0, 3.4), C.darkConcrete(), s * 6.0, 0, 3.0, s * 0.35);
      // Trough: wet concrete, low walls, a trickle down the middle.
      ground(p, -1.5, -7.5, 1.5, 3.3, C.wetConcrete(), 0.025);
      ground(p, -0.35, -7.5, 0.35, 3.3, C.water(), 0.03);
      for (const s of [-1, 1]) plate(p, 0.2, 0.3, 10.8, C.darkConcrete(), s * 1.6, 0, -2.1);
      // Grate across the mouth: bars, three of them bent away so you can squeeze through.
      for (let i = 0; i < 9; i++) {
        const x = -1.2 + i * 0.3;
        if (i >= 3 && i <= 5) beam(p, [x, 0.1, 3.0], [x + (i - 4) * 0.5, 2.2, 2.2], 0.04, C.rust());
        else plate(p, 0.04, 2.9, 0.04, C.rust(), x, 0.1, 3.05);
      }
      plate(p, 2.8, 0.06, 0.06, C.rust(), 0, 2.9, 3.05);
      rocks(p, 2.6, 1.6, 5, 0.6, C.darkConcrete());
      rocks(p, -2.8, 2.0, 4, 0.5, C.darkConcrete());
      for (const [x, z] of [[2.4, -3], [-2.6, -5]] as const) drum(p, x, z, C.rust(), 1.4);
    },
    crane: (p) => {
      // Tower crane [-7.2…-3.8, -1.6…1.6]: lattice mast, jib out over the lane and the stacks.
      const x = -5.5;
      const H = 13;
      const yel = mat(0xd4a02a, null, 0.6, 0.3);
      box(p, 3.2, 0.6, 3.2, C.darkConcrete(), x, 0, 0);
      for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) plate(p, 0.14, H, 0.14, yel, x + dx, 0.6, dz);
      for (let y = 0.6; y < H; y += 1.4) {
        beam(p, [x - 0.7, y, -0.7], [x + 0.7, y + 1.4, -0.7], 0.06, yel);
        beam(p, [x - 0.7, y, 0.7], [x + 0.7, y + 1.4, 0.7], 0.06, yel);
        beam(p, [x - 0.7, y, -0.7], [x - 0.7, y + 1.4, 0.7], 0.06, yel);
        beam(p, [x + 0.7, y, -0.7], [x + 0.7, y + 1.4, 0.7], 0.06, yel);
      }
      box(p, 1.6, 1.6, 1.8, C.overYellow(), x + 1.3, H, 0.4); // cab
      plate(p, 0.05, 0.8, 1.4, C.glass(), x + 2.12, H + 0.6, 0.4);
      plate(p, 16, 0.6, 0.8, C.overYellow(), x + 8, H + 1.6, 0); // jib
      plate(p, 6, 0.6, 0.8, C.overYellow(), x - 3, H + 1.6, 0); // counter-jib
      box(p, 1.8, 1.4, 1.4, mat(0x75726b, 'concrete', 0.95, 0, true), x - 4.8, H + 0.4, 0);
      put(p, new THREE.ConeGeometry(0.7, 3, 4), C.overYellow(), x, H + 3.4, 0, Math.PI / 4);
      plate(p, 0.03, H - 4.6, 0.03, C.black(), x + 7.5, 6.2, 0); // hook cable over the lane
      box(p, 0.5, 0.7, 0.4, C.yellow(), x + 7.5, 5.5, 0);
      // Container stacks [3.2…5.8, -4.2…2.4] and [-8.8…-2.8, 3.6…6.2].
      container(p, 4.5, -0.9, 0x2c4a6a, Math.PI / 2, 0);
      container(p, 4.5, -0.9, 0xa8352c, Math.PI / 2, 2.6);
      container(p, -5.8, 4.9, 0x3d6a3a, 0, 0);
      container(p, -5.8, 4.9, 0x8a6a3a, 0, 2.6);
      // Yard: a forklift-pallet pile and a lamp mast.
      for (let i = 0; i < 3; i++) plate(p, 1.2, 0.14, 1.0, C.wood(), 3.5, i * 0.15, 4.2 + (i % 2) * 0.1);
      lampPost(p, 3.1, -5.6, 8, -1);
      plate(p, 0.15, 0.02, 7, C.yellow(), 2.6, 0.02, -1);
    },
    overpass: (p) => {
      // A motorway crossing overhead along the edge: deck, columns with cap beams, earth ramps at the ends.
      const deckY = 5.3;
      plate(p, 24, 0.9, 6.2, C.overConcrete(), 0, deckY, 1.0);
      for (const s of [-1, 1]) {
        plate(p, 24, 0.8, 0.25, C.overConcrete(), 0, deckY + 0.9, 1.0 + s * 3.0);
        for (let x = -11; x <= 11; x += 2) plate(p, 0.05, 0.4, 0.05, C.steel(), x, deckY + 1.7, 1.0 + s * 2.85);
        plate(p, 24, 0.06, 0.06, C.steel(), 0, deckY + 2.1, 1.0 + s * 2.85);
        // Columns + cap beam [±(3.6…4.8), 0.2…1.8].
        for (const dz of [-0.4, 0.4]) put(p, new THREE.CylinderGeometry(0.42, 0.42, deckY - 0.6, 14), C.concrete(), s * 4.2, (deckY - 0.6) / 2, 1.0 + dz);
        plate(p, 1.0, 0.6, 5.4, C.darkConcrete(), s * 4.2, deckY - 0.6, 1.0);
        // Abutment with an earth ramp behind it [±(8.2…9.5), -2.4…4.4].
        plate(p, 0.6, deckY, 6.6, C.darkConcrete(), s * 8.5, 0, 1.0);
        bank(p, s > 0 ? 8.8 : -12.5, s > 0 ? 12.5 : -8.8, [[-2.4, 0], [-2.4, deckY], [4.4, deckY], [4.4, 0]], C.earth());
      }
      // Underneath: graffiti panels, a dumped burnt car, blocks; puddles on the asphalt.
      plate(p, 0.02, 1.4, 4.2, mat(0x5a8a6a, null, 0.9), -3.68, 0.5, 1.0);
      plate(p, 0.02, 1.0, 3.0, mat(0xa86a3a, null, 0.9), 3.68, 0.9, 1.0);
      jersey(p, 2.9, -2.8, 0, 1.4);
      jersey(p, -3.0, -4.5, 0.3);
      ground(p, -1.4, 1.6, 0.6, 3.2, C.water(), 0.026);
      car(p, -6.2, -1.6, true);
    },
  };

  // ── Bigger reusable set pieces (hoisted: the builders above call them) ──
  function watchtower(p: P, x: number, z: number, h: number, cab = false): void {
    const lean = 0.05;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
      put(p, new THREE.CylinderGeometry(0.09, 0.12, h + 0.2, 8), C.darkWood(), x + dx * (0.95 - lean * 2), h / 2, z + dz * (0.95 - lean * 2), 0, -dz * lean, dx * lean);
    for (let y = 1.2; y < h - 0.5; y += 1.8) {
      beam(p, [x - 1, y, z - 1], [x + 1, y + 1.4, z - 1], 0.07, C.darkWood());
      beam(p, [x - 1, y, z + 1], [x + 1, y + 1.4, z + 1], 0.07, C.darkWood());
      beam(p, [x - 1, y, z - 1], [x - 1, y + 1.4, z + 1], 0.07, C.darkWood());
      beam(p, [x + 1, y, z - 1], [x + 1, y + 1.4, z + 1], 0.07, C.darkWood());
    }
    box(p, 2.6, 0.14, 2.6, C.wood(), x, h, z);
    if (cab) {
      for (const [dx, dz, w, d] of [[0, -1.2, 2.4, 0.06], [0, 1.2, 2.4, 0.06], [-1.2, 0, 0.06, 2.4], [1.2, 0, 0.06, 2.4]] as const) {
        plate(p, w, 0.9, d, C.overWood(), x + dx, h + 0.14, z + dz);
        plate(p, w, 0.8, d, mat(0x2a3a44, null, 0.12, 0.3, true), x + dx, h + 1.04, z + dz);
      }
      put(p, new THREE.ConeGeometry(2.1, 1.0, 4), C.overWood(), x, h + 2.4, z, Math.PI / 4);
    } else {
      for (const [dx, dz, w, d] of [[0, -1.25, 2.6, 0.08], [0, 1.25, 2.6, 0.08], [-1.25, 0, 0.08, 2.6], [1.25, 0, 0.08, 2.6]] as const) plate(p, w, 1.0, d, C.wood(), x + dx, h + 0.1, z + dz);
      sandbags(p, x, z - 1.05, 2.2, 2);
      for (const [dx, dz] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]] as const) post(p, 0.05, 1.8, C.darkWood(), x + dx, z + dz, h);
      put(p, new THREE.ConeGeometry(2.0, 0.9, 4), C.overWood(), x, h + 2.25, z, Math.PI / 4);
    }
    // Ladder up the lane-facing side.
    const lx = x + 1.25;
    for (const dz of [-0.25, 0.25]) beam(p, [lx + 0.6, 0, z + dz], [lx, h, z + dz], 0.06, C.darkWood());
    for (let y = 0.4; y < h; y += 0.4) plate(p, 0.04, 0.04, 0.5, C.darkWood(), lx + 0.6 * (1 - y / h), y, z);
  }

  function car(p: P, x: number, z: number, burnt = false): void {
    const body = burnt ? mat(0x2e2a26, 'metal', 0.95, 0.2) : mat(0x6a7a6a, 'metal', 0.6, 0.3);
    box(p, 1.7, 0.75, 4.1, body, x, 0.28, z);
    box(p, 1.5, 0.55, 2.0, body, x, 1.0, z - 0.2);
    plate(p, 1.52, 0.45, 2.02, burnt ? C.black() : C.glass(), x, 1.02, z - 0.2);
    plate(p, 1.4, 0.06, 1.8, body, x, 1.55, z - 0.2);
    for (const sx of [-0.82, 0.82])
      for (const sz of [-1.3, 1.3]) put(p, new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), C.black(), x + sx, burnt ? 0.18 : 0.3, z + sz, 0, 0, Math.PI / 2);
  }

  function container(p: P, x: number, z: number, color: number, ry: number, y: number): void {
    const m = mat(color, 'metal', 0.7, 0.3);
    box(p, 6.06, 2.59, 2.44, m, x, y, z, ry);
    // Corrugation: ribs on the long sides; doors and lock bars at one end.
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (let i = -14; i <= 14; i++) {
      const along = i * 0.21;
      for (const side of [-1, 1]) plate(p, 0.08, 2.4, 0.04, m, x + c * along + s * side * 1.24, y + 0.1, z - s * along + c * side * 1.24, ry);
    }
    for (const k of [-0.5, -0.2, 0.2, 0.5]) plate(p, 0.04, 2.3, 0.04, C.steel(), x + c * 3.05 + s * k * 2, y + 0.15, z - s * 3.05 + c * k * 2, ry);
  }

  function tracks(p: P, x: number, z0: number, z1: number): void {
    const len = z1 - z0;
    for (let z = z0 + 0.3; z < z1; z += 0.65) plate(p, 2.2, 0.06, 0.22, C.darkWood(), x, 0.0, z);
    for (const dx of [-0.72, 0.72]) plate(p, 0.07, 0.1, len, C.steel(), x + dx, 0.03, z0 + len / 2);
  }

  function tram(p: P, x: number, z: number): void {
    const red = mat(0x9a3a2e, 'metal', 0.6, 0.3);
    const cream = mat(0xd8cba8, 'metal', 0.6, 0.2);
    box(p, 2.4, 1.2, 9.6, red, x, 0.45, z);
    box(p, 2.42, 1.1, 9.5, cream, x, 1.6, z);
    for (let i = -3; i <= 3; i++) for (const s of [-1, 1]) plate(p, 0.04, 0.8, 1.0, C.glass(), x + s * 1.22, 1.75, z + i * 1.25);
    plate(p, 2.0, 0.8, 0.04, C.glass(), x, 1.75, z - 4.8);
    box(p, 2.2, 0.35, 9.0, mat(0x8a8780, 'metal', 0.6, 0.3), x, 2.7, z);
    // Pantograph, folded down.
    beam(p, [x, 3.05, z - 1.0], [x, 3.6, z + 0.6], 0.05, C.black());
    plate(p, 1.4, 0.05, 0.08, C.black(), x, 3.58, z + 0.6);
    for (const dz of [-3.5, 3.5]) box(p, 2.0, 0.5, 1.6, C.black(), x, 0, z + dz);
  }

  function rowboat(p: P, x: number, z: number, ry: number): void {
    const s = new THREE.Shape();
    s.moveTo(-0.6, -1.6);
    s.lineTo(0.6, -1.6);
    s.quadraticCurveTo(0.75, 0.6, 0, 1.8);
    s.quadraticCurveTo(-0.75, 0.6, -0.6, -1.6);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.45, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
    g.rotateX(Math.PI / 2);
    put(p, g, mat(0x3f5f6a, 'wood', 0.8), x, 0.38, z, ry);
    plate(p, 1.1, 0.05, 2.6, C.darkWood(), x, 0.22, z, ry);
    plate(p, 1.2, 0.06, 0.25, C.wood(), x, 0.3, z + 0.2, ry);
  }

  function launch(p: P, x: number, z: number): void {
    const s = new THREE.Shape();
    s.moveTo(-0.95, -2.6);
    s.lineTo(0.95, -2.6);
    s.quadraticCurveTo(1.1, 1.0, 0, 2.8);
    s.quadraticCurveTo(-1.1, 1.0, -0.95, -2.6);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
    g.rotateX(Math.PI / 2);
    put(p, g, mat(0x2e3436, 'metal', 0.7, 0.3), x, 0.55, z);
    plate(p, 1.7, 0.05, 4.6, C.darkWood(), x, 0.25, z - 0.1);
    // Console with a windscreen, tarp over the cargo, outboard motor on the stern (shore end).
    box(p, 0.8, 0.7, 0.6, C.white(), x, 0.3, z + 0.4);
    plate(p, 0.9, 0.4, 0.04, C.glass(), x, 1.0, z + 0.72, 0, -0.4);
    box(p, 1.4, 0.55, 1.6, mat(0x4b5536, null, 0.95), x, 0.3, z - 1.3);
    box(p, 0.45, 0.8, 0.45, C.black(), x, 0.25, z - 2.85);
    plate(p, 0.08, 0.7, 0.12, C.black(), x, -0.4, z - 2.95);
    // Mooring line to the jetty.
    beam(p, [x - 0.8, 0.6, z + 1.6], [x - 1.6, 0.8, z + 2.2], 0.025, mat(0xbfa77a, null, 1));
  }

  for (const e of list) {
    const place = new THREE.Group();
    // Local +Z turns towards (cos dir, sin dir) in world (x, z).
    place.rotation.y = Math.atan2(Math.cos(e.dir), Math.sin(e.dir));
    place.position.set(e.x, 0, e.y);
    BUILD[e.kind]?.(place, e);
    group.add(place);
    mergeStatic(place);
  }

  /**
   * Bake every static mesh of a place into one mesh per material, in world space, with world-scaled UVs
   * (box-projected by the dominant normal axis). Moving parts stay as they are.
   */
  function mergeStatic(place: THREE.Group): void {
    place.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const drop: THREE.Mesh[] = [];
    const walk = (o: THREE.Object3D) => {
      if (o.userData[DYNAMIC]) return;
      if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
        let g = (o.geometry as THREE.BufferGeometry).clone();
        if (g.index) g = g.toNonIndexed();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
        g.applyMatrix4(o.matrixWorld);
        const s = uvScale.get(o.material as THREE.Material) ?? 0;
        if (s > 0) worldUv(g, s);
        const list = byMat.get(o.material as THREE.Material) ?? [];
        list.push(g);
        byMat.set(o.material as THREE.Material, list);
        drop.push(o);
      }
      for (const c of o.children) walk(c);
    };
    walk(place);
    for (const o of drop) o.removeFromParent();
    // Empty groups left behind by sandbags, wire, logs.
    const prune = (o: THREE.Object3D) => {
      for (const c of [...o.children]) prune(c);
      if (o !== place && !o.userData[DYNAMIC] && o.children.length === 0 && !(o instanceof THREE.Mesh)) o.removeFromParent();
    };
    prune(place);
    for (const [m, list] of byMat) {
      const hasColor = list.some((g) => g.attributes.color);
      for (const g of list) if (hasColor && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 3).fill(1), 3));
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      if (!merged) continue;
      geos.push(merged);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      const flat = (m as Mat).transparent || m === C.water() || m === C.mud() || m === C.black();
      mesh.castShadow = shadows && !flat;
      mesh.receiveShadow = shadows;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }

  function worldUv(g: THREE.BufferGeometry, s: number): void {
    const pos = g.attributes.position!;
    const nor = g.attributes.normal!;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nor.getX(i));
      const ay = Math.abs(nor.getY(i));
      const az = Math.abs(nor.getZ(i));
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (ay >= ax && ay >= az) uv.set([x * s, z * s], i * 2);
      else if (ax >= az) uv.set([z * s, y * s], i * 2);
      else uv.set([x * s, y * s], i * 2);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  return {
    group,
    setProgress(id, t) {
      movers.get(id)?.(t);
    },
    update(time) {
      for (const s of spinners) s.obj.rotation.z = -time * s.speed;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
