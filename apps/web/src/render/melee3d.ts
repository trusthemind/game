import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gearMat } from './gear3d';

/**
 * Procedural melee weapons. In metres, with one convention so the hand can hold any of them:
 *  - origin = the centre of the grip (where the fist closes),
 *  - +Z runs from the hand towards the blade tip / head,
 *  - +Y is the striking side (cutting edge, axe bit, hammer face), -Y the spine / poll,
 *  - X is the flat of the blade.
 * The same models feed the inventory pictures and the weapon in a character's hand.
 */

// ── Materials ────────────────────────────────────────────────────────────────

const STEEL = () => gearMat(0xa7adb1, 0.32, 0.85);
const EDGE = () => gearMat(0xd4d9dc, 0.22, 0.9);
const BLACK_STEEL = () => gearMat(0x2c2f31, 0.45, 0.6);
const WOOD = () => gearMat(0x6e4a2a, 0.62);
const DARK_WOOD = () => gearMat(0x3f2a1a, 0.6);
const RUBBER = () => gearMat(0x1b1c1d, 0.88);
const OLIVE = () => gearMat(0x4c5338, 0.7, 0.2);
const BRASS = () => gearMat(0xb88a3c, 0.35, 0.85);
const RED = () => gearMat(0xa4231b, 0.45, 0.2);
const TAPE = () => gearMat(0x55585a, 0.8);
const CORD = () => gearMat(0x2f3a2a, 0.9);

// ── Geometry helpers ─────────────────────────────────────────────────────────

type V3 = [number, number, number];

function part(g: THREE.BufferGeometry, m: THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.3) =>
  new RoundedBoxGeometry(w, h, d, 4, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
/** Cylinder along Z. */
const rod = (r0: number, r1: number, len: number, seg = 24) =>
  new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(Math.PI / 2);

/**
 * A blade outline drawn as (z, y) points (z along the weapon, y towards the edge), extruded `t` thick in X
 * and ground: thickness tapers to a fine edge on the +Y side (or both sides for daggers).
 */
function blade(
  outline: [number, number][],
  t: number,
  grind: 'edge' | 'both' | 'none' = 'edge',
  grindFrom = 0.45,
): THREE.BufferGeometry {
  const s = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(s, {
    depth: t,
    bevelEnabled: true,
    bevelThickness: t * 0.2,
    bevelSize: Math.min(t * 0.5, 0.0015),
    bevelSegments: 2,
    curveSegments: 24,
    steps: 1,
  });
  // Shape x → +Z, extrusion → X, centred.
  g.rotateY(-Math.PI / 2);
  g.translate(t / 2, 0, 0);
  if (grind !== 'none') {
    // Per-slice extents along Z, then pinch X towards the edge.
    const p = g.attributes.position!;
    const bins = 80;
    const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
    const z0 = box.min.z;
    const dz = (box.max.z - z0) / bins || 1;
    const lo = new Array(bins + 1).fill(Infinity);
    const hi = new Array(bins + 1).fill(-Infinity);
    for (let i = 0; i < p.count; i++) {
      const b = Math.round((p.getZ(i) - z0) / dz);
      lo[b] = Math.min(lo[b], p.getY(i));
      hi[b] = Math.max(hi[b], p.getY(i));
    }
    for (let i = 0; i < p.count; i++) {
      const b = Math.round((p.getZ(i) - z0) / dz);
      const span = hi[b] - lo[b] || 1;
      const k = (p.getY(i) - lo[b]) / span; // 0 spine … 1 edge
      const e = grind === 'both' ? Math.abs(k - 0.5) * 2 : k;
      const from = grind === 'both' ? 0.2 : grindFrom;
      const pinch = THREE.MathUtils.smoothstep(e, from, 1);
      p.setX(i, p.getX(i) * (1 - pinch * 0.88));
    }
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-5);
    g.computeVertexNormals();
  }
  return g;
}

/** Rounded handle along Z with a slight swell (lathe), `len` long centred on z = c. */
function handle(len: number, r: number, c = 0, swell = 0.12): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rr = r * (1 + swell * Math.sin(Math.PI * t)) * (t < 0.06 ? 0.75 + t * 4 : t > 0.94 ? 0.75 + (1 - t) * 4 : 1);
    pts.push(new THREE.Vector2(rr, -len / 2 + t * len));
  }
  pts.unshift(new THREE.Vector2(0, -len / 2));
  pts.push(new THREE.Vector2(0, len / 2));
  return new THREE.LatheGeometry(pts, 24).rotateX(Math.PI / 2).translate(0, 0, c);
}

/** Flat-sided (scaled) handle: knife scales are oval, not round. */
function scales(len: number, h: number, t: number, c: number): THREE.BufferGeometry {
  return handle(len, h / 2, c, 0.1).scale(t / h, 1, 1);
}

/** Wrap rings along Z (paracord, tape, grip ridges). */
function rings(
  g: THREE.Group,
  from: number,
  to: number,
  step: number,
  r: number,
  tube: number,
  m: THREE.Material,
  sx = 1,
): void {
  for (let z = from; z <= to + 1e-6; z += step) {
    const ring = part(new THREE.TorusGeometry(r, tube, 6, 20), m, [0, 0, z]);
    ring.scale.x = sx;
    g.add(ring);
  }
}

function rivet(g: THREE.Group, z: number, t: number, m = BRASS()): void {
  for (const sx of [-1, 1])
    g.add(
      part(
        new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 12),
        m,
        [sx * (t / 2 + 0.0005), 0, z],
        [0, 0, Math.PI / 2],
      ),
    );
}

// ── Models ───────────────────────────────────────────────────────────────────

function kitchenKnife(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(scales(0.11, 0.024, 0.016, 0), DARK_WOOD()));
  for (const z of [-0.035, 0, 0.035]) rivet(g, z, 0.016, STEEL());
  g.add(part(rbox(0.017, 0.026, 0.012, 0.004), STEEL(), [0, 0.002, 0.058]));
  g.add(
    part(
      blade(
        [
          [0.062, -0.011],
          [0.17, -0.011],
          [0.255, -0.004],
          [0.27, 0.0],
          [0.22, 0.016],
          [0.12, 0.024],
          [0.062, 0.024],
        ],
        0.0022,
      ),
      STEEL(),
    ),
  );
  return g;
}

function bayonet(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(scales(0.12, 0.028, 0.022, 0), RUBBER()));
  rings(g, -0.045, 0.045, 0.012, 0.0125, 0.0018, RUBBER(), 0.8);
  g.add(part(rbox(0.022, 0.03, 0.02, 0.005), BLACK_STEEL(), [0, 0, -0.065]));
  // Crossguard with the muzzle ring on the spine side.
  g.add(part(rbox(0.012, 0.058, 0.01, 0.003), BLACK_STEEL(), [0, -0.006, 0.065]));
  g.add(part(new THREE.TorusGeometry(0.0095, 0.003, 8, 20), BLACK_STEEL(), [0, -0.032, 0.065]));
  g.add(
    part(
      blade(
        [
          [0.07, -0.012],
          [0.12, -0.012],
          [0.165, -0.014],
          [0.2, -0.006],
          [0.215, 0.002],
          [0.19, 0.012],
          [0.07, 0.014],
        ],
        0.004,
      ),
      BLACK_STEEL(),
    ),
  );
  // Saw back.
  for (let z = 0.08; z < 0.15; z += 0.008)
    g.add(part(new THREE.ConeGeometry(0.0022, 0.005, 4), BLACK_STEEL(), [0, -0.0135, z], [Math.PI, 0, 0]));
  return g;
}

function karambit(): THREE.Group {
  const g = new THREE.Group();
  // Reverse grip: blade curls out under the little finger, finger ring at the other end.
  g.add(part(scales(0.09, 0.026, 0.016, 0), CORD()));
  rings(g, -0.035, 0.035, 0.007, 0.012, 0.0022, CORD(), 0.7);
  g.add(part(new THREE.TorusGeometry(0.017, 0.004, 10, 28), BLACK_STEEL(), [0, -0.004, -0.066], [0, Math.PI / 2, 0]));
  const pts: [number, number][] = [];
  // Outer (spine) curve then inner (edge) curve, a hooked claw bending towards +Y.
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * 1.25;
    pts.push([0.045 + Math.sin(a) * 0.07, -0.01 + (1 - Math.cos(a)) * 0.07]);
  }
  for (let i = 12; i >= 0; i--) {
    const a = (i / 12) * 1.15;
    pts.push([0.045 + Math.sin(a) * 0.05, 0.008 + (1 - Math.cos(a)) * 0.05 + (i === 12 ? 0.012 : 0)]);
  }
  g.add(part(blade(pts, 0.0035, 'edge', 0.5), BLACK_STEEL()));
  return g;
}

function cleaver(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(scales(0.12, 0.026, 0.018, 0), WOOD()));
  for (const z of [-0.035, 0.0, 0.035]) rivet(g, z, 0.018, STEEL());
  g.add(part(rbox(0.01, 0.022, 0.025, 0.004), STEEL(), [0, -0.002, 0.07]));
  const b = blade(
    [
      [0.075, -0.012],
      [0.255, -0.012],
      [0.26, -0.008],
      [0.26, 0.085],
      [0.25, 0.09],
      [0.075, 0.09],
    ],
    0.004,
    'edge',
    0.75,
  );
  g.add(part(b, STEEL()));
  // The hanging hole.
  g.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 20), RUBBER(), [0, 0.004, 0.235], [0, 0, Math.PI / 2]));
  return g;
}

function machete(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(scales(0.13, 0.03, 0.022, 0), RUBBER()));
  // Finger ridges on the edge side, a hooked pommel.
  for (const z of [-0.03, 0, 0.03]) g.add(part(new THREE.SphereGeometry(0.006, 10, 8), RUBBER(), [0, 0.016, z]));
  g.add(part(rbox(0.024, 0.04, 0.02, 0.008), RUBBER(), [0, 0.006, -0.07]));
  g.add(part(rbox(0.012, 0.036, 0.012, 0.004), BLACK_STEEL(), [0, 0, 0.068]));
  g.add(
    part(
      blade(
        [
          [0.072, -0.014],
          [0.3, -0.016],
          [0.48, -0.02],
          [0.53, -0.012],
          [0.545, 0.008],
          [0.5, 0.034],
          [0.3, 0.03],
          [0.072, 0.02],
        ],
        0.003,
      ),
      BLACK_STEEL(),
    ),
  );
  g.add(
    part(
      blade(
        [
          [0.075, 0.012],
          [0.3, 0.022],
          [0.49, 0.026],
          [0.53, 0.0],
          [0.5, 0.034],
          [0.3, 0.03],
          [0.075, 0.02],
        ],
        0.0034,
        'none',
      ),
      EDGE(),
      [0.0, 0.0, 0],
    ),
  );
  return g;
}

function kukri(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(handle(0.12, 0.014, 0, 0.18).scale(0.85, 1, 1), DARK_WOOD()));
  for (const z of [-0.025, 0.0, 0.025]) g.add(part(new THREE.TorusGeometry(0.0145, 0.0016, 6, 20), BRASS(), [0, 0, z]));
  g.add(part(rbox(0.016, 0.04, 0.012, 0.005), BRASS(), [0, 0, 0.066]));
  g.add(part(new THREE.SphereGeometry(0.014, 16, 12), BRASS(), [0, 0, -0.064]));
  // Bent forward: the belly drops towards the edge side, wide near the tip.
  g.add(
    part(
      blade(
        [
          [0.072, -0.012],
          [0.16, -0.022],
          [0.25, -0.012],
          [0.32, 0.015],
          [0.345, 0.04],
          [0.32, 0.072],
          [0.25, 0.07],
          [0.17, 0.045],
          [0.072, 0.014],
        ],
        0.006,
        'edge',
        0.4,
      ),
      STEEL(),
    ),
  );
  return g;
}

/** Axe / hatchet / tomahawk on a straight haft. `head` is placed at `z` along the haft. */
function axeHead(
  len: number,
  bit: number,
  poll: 'flat' | 'spike' | 'pick',
  m: THREE.Material,
  edge: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const w = len;
  // Eye block round the haft.
  g.add(part(rbox(0.032, 0.05, 0.05, 0.008), m, [0, -0.005, 0]));
  // The bit: flares from the eye to a curved edge on +Y.
  const pts: [number, number][] = [
    [-w * 0.18, 0.02],
    [w * 0.18, 0.02],
    [w * 0.45, bit * 0.7],
    [w * 0.5, bit],
    [0, bit * 1.04],
    [-w * 0.5, bit],
    [-w * 0.45, bit * 0.7],
  ];
  const b = blade(pts, 0.018, 'edge', 0.35);
  g.add(part(b, m));
  g.add(
    part(
      blade(
        [
          [-w * 0.5, bit * 0.9],
          [w * 0.5, bit * 0.9],
          [w * 0.5, bit],
          [0, bit * 1.04],
          [-w * 0.5, bit],
        ],
        0.003,
        'none',
      ),
      edge,
    ),
  );
  if (poll === 'flat') g.add(part(rbox(0.03, 0.03, 0.045, 0.006), m, [0, -0.038, 0]));
  if (poll === 'spike') g.add(part(new THREE.ConeGeometry(0.012, 0.07, 4).rotateX(Math.PI), m, [0, -0.065, 0]));
  if (poll === 'pick') g.add(part(new THREE.ConeGeometry(0.014, 0.13, 6).rotateX(Math.PI), m, [0, -0.09, 0]));
  return g;
}

function hatchet(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(handle(0.36, 0.0135, 0.12, 0.08).scale(0.8, 1, 1), WOOD()));
  g.add(part(rbox(0.024, 0.032, 0.028, 0.008), WOOD(), [0, 0.004, -0.058]));
  const h = axeHead(0.08, 0.085, 'flat', STEEL(), EDGE());
  h.position.z = 0.27;
  g.add(h);
  return g;
}

function tomahawk(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(handle(0.36, 0.013, 0.12, 0.06).scale(0.75, 1, 1), RUBBER()));
  rings(g, -0.04, 0.08, 0.008, 0.0125, 0.0022, CORD(), 0.75);
  const h = axeHead(0.065, 0.075, 'spike', BLACK_STEEL(), BLACK_STEEL());
  h.position.z = 0.28;
  g.add(h);
  return g;
}

function fireAxe(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(handle(0.86, 0.016, 0.33, 0.05).scale(0.8, 1, 1), WOOD()));
  g.add(part(rbox(0.028, 0.038, 0.03, 0.008), WOOD(), [0, 0.004, -0.095]));
  const h = axeHead(0.11, 0.13, 'pick', RED(), STEEL());
  h.position.z = 0.71;
  g.add(h);
  return g;
}

function sledge(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(handle(0.88, 0.017, 0.33, 0.05).scale(0.8, 1, 1), WOOD()));
  g.add(part(new THREE.CylinderGeometry(0.019, 0.019, 0.12, 20).rotateX(Math.PI / 2), RUBBER(), [0, 0, -0.03]));
  // Head along Y (striking face on +Y), chamfered octagonal block.
  const head = new THREE.CylinderGeometry(0.042, 0.042, 0.2, 8);
  g.add(part(head, BLACK_STEEL(), [0, 0, 0.74], [0, Math.PI / 8, 0]));
  for (const s of [-1, 1])
    g.add(
      part(
        new THREE.CylinderGeometry(0.036, 0.042, 0.012, 8),
        STEEL(),
        [0, s * 0.105, 0.74],
        [s < 0 ? Math.PI : 0, Math.PI / 8, 0],
      ),
    );
  return g;
}

function crowbar(): THREE.Group {
  const g = new THREE.Group();
  const curve = new THREE.CurvePath<THREE.Vector3>();
  curve.add(new THREE.LineCurve3(new THREE.Vector3(0, 0, -0.12), new THREE.Vector3(0, 0, 0.56)));
  curve.add(
    new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, 0, 0.56),
      new THREE.Vector3(0, 0, 0.66),
      new THREE.Vector3(0, 0.06, 0.64),
    ),
  );
  curve.add(new THREE.LineCurve3(new THREE.Vector3(0, 0.06, 0.64), new THREE.Vector3(0, 0.075, 0.6)));
  const bar = new THREE.TubeGeometry(curve, 60, 0.012, 6, false);
  g.add(part(bar, RED()));
  // Claw at the hook, chisel at the bottom.
  g.add(part(rbox(0.026, 0.012, 0.034, 0.003), BLACK_STEEL(), [0, 0.078, 0.592], [-0.5, 0, 0]));
  g.add(part(rbox(0.026, 0.008, 0.04, 0.003), BLACK_STEEL(), [0, 0.004, -0.13], [0.2, 0, 0]));
  return g;
}

function bat(): THREE.Group {
  const g = new THREE.Group();
  const prof: [number, number][] = [
    [0, -0.12],
    [0.022, -0.12],
    [0.024, -0.11],
    [0.015, -0.1],
    [0.014, 0.1],
    [0.018, 0.3],
    [0.03, 0.5],
    [0.034, 0.62],
    [0.033, 0.69],
    [0.02, 0.705],
    [0, 0.705],
  ];
  const lathe = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    28,
  ).rotateX(Math.PI / 2);
  g.add(part(lathe, WOOD()));
  rings(g, -0.08, 0.08, 0.016, 0.0155, 0.0028, TAPE());
  // Nails driven through the barrel.
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4;
    const z = 0.45 + (i % 7) * 0.035;
    const n = part(new THREE.CylinderGeometry(0.0018, 0.0018, 0.05, 6), STEEL(), [
      Math.cos(a) * 0.04,
      Math.sin(a) * 0.04,
      z,
    ]);
    n.lookAt(new THREE.Vector3(Math.cos(a) * 0.1, Math.sin(a) * 0.1, z));
    n.rotateX(Math.PI / 2);
    g.add(n);
  }
  return g;
}

function shovel(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(handle(0.36, 0.016, 0.12, 0.05).scale(0.85, 1, 1), WOOD()));
  g.add(part(new THREE.CylinderGeometry(0.019, 0.017, 0.07, 18).rotateX(Math.PI / 2), OLIVE(), [0, 0, 0.32]));
  // Spade: a dished plate, pointed tip, the sharpened side faces +Y.
  const spade = blade(
    [
      [0.34, -0.075],
      [0.47, -0.078],
      [0.52, 0.0],
      [0.47, 0.078],
      [0.34, 0.075],
    ],
    0.003,
    'none',
  );
  const pos = spade.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + pos.getY(i) * pos.getY(i) * 3.0);
  spade.computeVertexNormals();
  g.add(part(spade, OLIVE()));
  return g;
}

function rebar(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(rod(0.009, 0.009, 0.82, 10), gearMat(0x6b4a36, 0.75, 0.5), [0, 0, 0.29]));
  // Ribs and a taped grip.
  rings(g, 0.12, 0.68, 0.02, 0.0095, 0.0018, gearMat(0x5d4030, 0.8, 0.5));
  g.add(part(handle(0.16, 0.0145, -0.02, 0.02), TAPE()));
  rings(g, -0.09, 0.05, 0.02, 0.0148, 0.0012, gearMat(0x44474a, 0.8));
  // A lump of concrete still stuck to the end.
  const lump = new THREE.IcosahedronGeometry(0.04, 1);
  const p = lump.attributes.position!;
  for (let i = 0; i < p.count; i++)
    p.setXYZ(i, p.getX(i) * (0.85 + ((i * 37) % 7) / 25), p.getY(i) * (0.8 + ((i * 13) % 5) / 18), p.getZ(i) * 1.1);
  lump.computeVertexNormals();
  g.add(part(lump, gearMat(0x8a8780, 0.95), [0, 0.008, 0.66]));
  return g;
}

const BUILDERS: Record<string, () => THREE.Group> = {
  knife: kitchenKnife,
  bayonet,
  karambit,
  cleaver,
  machete,
  kukri,
  hatchet,
  tomahawk,
  axe: fireAxe,
  sledge,
  crowbar,
  bat,
  shovel,
  rebar,
};

/** Held upside down (blade out of the little-finger side of the fist). */
export const REVERSE_GRIP = new Set(['karambit']);
/** Two-handed swings. */
export const HEAVY_MELEE = new Set(['axe', 'sledge', 'bat', 'crowbar', 'rebar', 'shovel']);

const cache = new Map<string, THREE.Group>();
export function meleeModel(id: string): THREE.Group | null {
  const b = BUILDERS[id];
  if (!b) return null;
  let m = cache.get(id);
  if (!m) cache.set(id, (m = b()));
  return m.clone();
}
