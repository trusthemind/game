import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedural 3D models for everything the CC0 packs don't cover: helmets, body armour, plate carriers,
 * rigs, ammunition, medical supplies, electronics, valuables and junk. All in metres, standing on y=0,
 * centred on X/Z, front facing +Z (a wearer's chest faces +Z).
 *
 * The same builders feed the inventory pictures (thumbnails.ts) and the gear worn by characters
 * (character.ts), so what you see in your stash is what your survivor wears.
 */

// ── Materials ────────────────────────────────────────────────────────────────

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function gearMat(color: number, rough = 0.8, metal = 0, emissive = 0): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}|${metal}|${emissive}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: emissive ? 1 : 0 });
    matCache.set(k, m);
  }
  return m;
}

const FABRIC = 0.92;
const BRASS = 0xb88a3c;
const STEEL = 0x8a8f92;

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
const rbox = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.18) => new RoundedBoxGeometry(w, h, d, 4, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
/** Even 'boxes' get a slight bevel: hard 90° edges are what makes small props read as blocks. */
const box = (w: number, h: number, d: number) => rbox(w, h, d, Math.min(w, h, d) * 0.12);
const cyl = (rt: number, rb: number, h: number, seg = 32) => new THREE.CylinderGeometry(rt, rb, h, seg);
/** Surface of revolution; the profile is reordered bottom-to-top so faces point outwards. */
const lathe = (pts: [number, number][], seg = 40, phiStart = 0, phiLen = Math.PI * 2) =>
  new THREE.LatheGeometry(
    (pts[0]![1] > pts[pts.length - 1]![1] ? [...pts].reverse() : pts).map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
    phiStart,
    phiLen,
  );

/** A flat panel with rounded corners and an optional neck scoop, extruded `t` thick (front faces +Z). */
function panel(w: number, h: number, t: number, opts: { radius?: number; scoop?: number; scoopW?: number } = {}): THREE.BufferGeometry {
  const r = opts.radius ?? Math.min(w, h) * 0.12;
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = 0;
  const x1 = w / 2;
  const y1 = h;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  if (opts.scoop) {
    const sw = (opts.scoopW ?? 0.5) * w;
    s.lineTo(sw / 2, y1);
    s.quadraticCurveTo(0, y1 - opts.scoop * 1.6, -sw / 2, y1);
  }
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.25, bevelSize: Math.min(0.008, t * 0.4), bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -t / 2);
  return g;
}

/** A pouch: body with a flap on top. */
function pouch(w: number, h: number, d: number, color: number, flapColor = color): THREE.Group {
  const g = new THREE.Group();
  g.add(part(rbox(w, h, d, 0.008), gearMat(color, FABRIC), [0, h / 2, 0]));
  g.add(part(rbox(w * 1.04, h * 0.28, d * 1.08, 0.006), gearMat(flapColor, FABRIC), [0, h * 0.88, d * 0.02]));
  // Webbing strip.
  g.add(part(box(w * 0.14, h * 0.7, 0.004), gearMat(shade(color, 0.7), FABRIC), [0, h * 0.45, d / 2 + 0.002]));
  return g;
}

export function shade(color: number, k: number): number {
  const c = new THREE.Color(color).multiplyScalar(k);
  return c.getHex();
}

/** MOLLE: horizontal webbing rows across a panel face. */
function molle(w: number, rows: number, y0: number, z: number, color: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < rows; i++) g.add(part(box(w, 0.012, 0.004), gearMat(shade(color, 0.72), FABRIC), [0, y0 + i * 0.032, z]));
  return g;
}

/** A flat strap arching low over the shoulder (half an ellipse, `rise` above its ends). */
function shoulderStrap(halfSpan: number, width: number, rise: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(halfSpan, 0.006, 12, 40, Math.PI);
  g.scale(1, (rise + 0.04) / halfSpan, width / 0.012);
  return g;
}

// ── Helmets ──────────────────────────────────────────────────────────────────

/** Fits a head about 0.2 m wide; the dome's centre is at the origin's (0, 0.1, 0). */
export function helmetModel(id: string): THREE.Group {
  const g = new THREE.Group();
  if (id === 'ssh68') {
    // Soviet steel pot: deep dome, flared rim at the back.
    const m = gearMat(0x56603f, 0.6, 0.35);
    g.add((g.userData.shell = part(lathe([[0, 0.205], [0.06, 0.2], [0.1, 0.18], [0.125, 0.14], [0.135, 0.09], [0.14, 0.05], [0.152, 0.025], [0.158, 0.02]], 48), m)));
    g.add(part(new THREE.TorusGeometry(0.155, 0.006, 12, 48), gearMat(0x4a5236, 0.6, 0.4), [0, 0.022, 0], [Math.PI / 2, 0, 0]));
    g.add(part(new THREE.TorusGeometry(0.11, 0.004, 12, 40, Math.PI), gearMat(0x2a2620, FABRIC), [0, 0.02, 0.0], [0, 0, Math.PI]));
  } else if (id === 'zsh') {
    // ZSh-1-2M: rounded composite shell, ear cut-outs and a raised clear visor.
    const shell = gearMat(0x3e4636, 0.55, 0.1);
    g.add((g.userData.shell = part(lathe([[0, 0.2], [0.07, 0.195], [0.11, 0.17], [0.13, 0.13], [0.138, 0.08], [0.14, 0.03]], 48), shell)));
    for (const sx of [-1, 1]) g.add(part(rbox(0.03, 0.08, 0.1, 0.012), shell, [sx * 0.135, 0.02, -0.01]));
    const visor = new THREE.MeshStandardMaterial({ color: 0x9fb8c0, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.45 });
    g.add(part(lathe([[0.146, 0.0], [0.15, 0.04], [0.148, 0.08]], 20, -0.9, 1.8), visor, [0, 0.11, 0.0], [-0.5, 0, 0]));
    g.add(part(box(0.18, 0.012, 0.03), gearMat(0x1a1c1c, 0.4, 0.3), [0, 0.19, 0.1]));
  } else if (id === 'altyn') {
    // Altyn: titanium bowl + heavy faceplate with a vision slit.
    const shell = gearMat(0x4d563a, 0.5, 0.4);
    g.add((g.userData.shell = part(lathe([[0, 0.21], [0.07, 0.205], [0.115, 0.175], [0.138, 0.13], [0.145, 0.07], [0.148, 0.01]], 48), shell)));
    const plate = new THREE.Group();
    plate.add(part(new THREE.CylinderGeometry(0.155, 0.155, 0.17, 24, 1, true, -0.85, 1.7), gearMat(0x454d34, 0.45, 0.45), [0, 0, 0]));
    plate.add(part(box(0.15, 0.016, 0.02), gearMat(0x0e0f0f, 0.3, 0.2), [0, 0.03, 0.15]));
    plate.position.set(0, 0.06, 0.0);
    g.add(plate);
    for (const sx of [-1, 1]) g.add(part(cyl(0.012, 0.012, 0.012, 32), gearMat(0x1a1a1a, 0.4, 0.6), [sx * 0.14, 0.13, 0.04], [0, 0, Math.PI / 2]));
  } else {
    g.add((g.userData.shell = part(lathe([[0, 0.2], [0.1, 0.18], [0.14, 0.1], [0.145, 0.02]], 48), gearMat(0x4a4a40, 0.6, 0.2))));
  }
  return g;
}

// ── Body armour & plate carriers ─────────────────────────────────────────────

const ARMOR_LOOK: Record<string, { color: number; kind: 'soft' | 'vest' | 'carrier' | 'slick'; collar?: boolean; groin?: boolean; pouches?: number }> = {
  paca: { color: 0x3e4a56, kind: 'soft' },
  '6b23': { color: 0x5f6448, kind: 'vest', collar: true, groin: true },
  gzhel: { color: 0x4c5640, kind: 'vest', collar: true, groin: true, pouches: 2 },
  trooper: { color: 0x8a7552, kind: 'carrier', pouches: 3 },
  slick6: { color: 0x3a3e40, kind: 'slick' },
};

/** Torso armour sized for a chest ~0.36 m wide, 0.24 m deep, 0.5 m tall (y from 0 at the waist). */
export function armorModel(id: string): THREE.Group {
  const look = ARMOR_LOOK[id] ?? { color: 0x444a40, kind: 'vest' as const };
  const g = new THREE.Group();
  const c = look.color;
  const fabric = gearMat(c, FABRIC);
  const W = 0.38;
  const H = look.kind === 'slick' ? 0.34 : look.kind === 'carrier' ? 0.38 : 0.48;
  const D = 0.26;
  const t = look.kind === 'soft' ? 0.022 : look.kind === 'vest' ? 0.04 : 0.032;
  const y0 = look.kind === 'slick' || look.kind === 'carrier' ? 0.1 : 0.0;
  // Front and back panels.
  g.add(part(panel(W, H, t, { scoop: look.kind === 'soft' || look.kind === 'vest' ? 0.06 : 0.035, scoopW: 0.5 }), fabric, [0, y0, D / 2]));
  g.add(part(panel(W, H * 0.98, t, { scoop: 0.025, scoopW: 0.45 }), fabric, [0, y0, -D / 2]));
  // Sides (cummerbund) wrap round the ribs.
  for (const sx of [-1, 1]) g.add(part(rbox(0.03, H * (look.kind === 'slick' ? 0.25 : 0.45), D * 0.9, 0.01), gearMat(shade(c, 0.85), FABRIC), [sx * (W / 2 - 0.005), y0 + H * 0.28, 0]));
  // Shoulder straps.
  for (const sx of [-1, 1]) g.add(part(shoulderStrap(D / 2, 0.03, 0.012), gearMat(shade(c, 0.9), FABRIC), [sx * W * 0.28, y0 + H - 0.02, 0], [0, Math.PI / 2, 0]));
  if (look.kind === 'carrier' || look.kind === 'slick') {
    // Plates visible as stiff raised panels.
    g.add(part(panel(W * 0.82, H * 0.8, 0.018, { radius: 0.04 }), gearMat(shade(c, 1.08), 0.75), [0, y0 + H * 0.12, D / 2 + t * 0.7]));
    g.add(molle(W * 0.78, 3, y0 + H * 0.2, D / 2 + t * 0.7 + 0.012, c));
  }
  if (look.collar) {
    g.add(part(new THREE.TorusGeometry(0.11, 0.025, 12, 40, Math.PI * 1.25), gearMat(shade(c, 0.9), FABRIC), [0, y0 + H + 0.01, -0.01], [Math.PI / 2, 0, Math.PI * -0.125 + Math.PI]));
  }
  if (look.groin) g.add(part(panel(W * 0.42, 0.12, 0.02, { radius: 0.04 }), fabric, [0, y0 - 0.1, D / 2 + 0.005]));
  const n = look.pouches ?? 0;
  for (let i = 0; i < n; i++) {
    const p = pouch(0.075, 0.13, 0.05, shade(c, 0.95), shade(c, 0.8));
    p.position.set((i - (n - 1) / 2) * 0.088, y0 + 0.04, D / 2 + t + 0.03);
    g.add(p);
  }
  if (look.kind === 'carrier') {
    // Admin pouch + radio pouch.
    g.add(part(rbox(0.12, 0.08, 0.025, 0.008), gearMat(shade(c, 0.9), FABRIC), [0, y0 + H * 0.66, D / 2 + t + 0.02]));
    const radio = pouch(0.06, 0.15, 0.05, shade(c, 0.9));
    radio.position.set(-W / 2 - 0.02, y0 + 0.05, 0.02);
    g.add(radio);
  }
  return g;
}

// ── Rigs ─────────────────────────────────────────────────────────────────────

const RIG_LOOK: Record<string, { color: number; pouches: number; kind: 'vest' | 'harness' | 'belt' }> = {
  r_scav: { color: 0x6a5a3e, pouches: 4, kind: 'vest' },
  r_mbss: { color: 0x4a4f38, pouches: 3, kind: 'belt' },
  r_bank: { color: 0x3e4634, pouches: 4, kind: 'harness' },
  r_alpha: { color: 0x55604a, pouches: 4, kind: 'harness' },
};

export function rigModel(id: string): THREE.Group {
  const look = RIG_LOOK[id] ?? { color: 0x4a4f38, pouches: 3, kind: 'harness' as const };
  const g = new THREE.Group();
  const c = look.color;
  const D = 0.27;
  if (look.kind === 'vest') {
    // Fishing-style vest: open front with pockets.
    for (const sx of [-1, 1]) {
      g.add(part(panel(0.16, 0.44, 0.012, { radius: 0.03 }), gearMat(c, FABRIC), [sx * 0.1, 0, D / 2]));
      for (let r = 0; r < 2; r++) {
        const p = pouch(0.11, 0.09, 0.03, shade(c, 0.9));
        p.position.set(sx * 0.1, 0.06 + r * 0.14, D / 2 + 0.02);
        g.add(p);
      }
    }
    g.add(part(panel(0.36, 0.46, 0.012, { radius: 0.04, scoop: 0.03 }), gearMat(c, FABRIC), [0, 0, -D / 2]));
    return g;
  }
  // Harness straps crossing over the shoulders.
  for (const sx of [-1, 1]) {
    g.add(part(box(0.04, 0.42, 0.008), gearMat(shade(c, 0.85), FABRIC), [sx * 0.09, 0.26, D / 2 + 0.01], [0, 0, sx * 0.08]));
    g.add(part(shoulderStrap(D / 2, 0.035, 0.01), gearMat(shade(c, 0.85), FABRIC), [sx * 0.09, 0.45, 0], [0, Math.PI / 2, 0]));
  }
  const y = look.kind === 'belt' ? -0.04 : 0.1;
  // Chest/belt panel with a row of mag pouches.
  g.add(part(rbox(0.34, look.kind === 'belt' ? 0.06 : 0.14, 0.03, 0.01), gearMat(c, FABRIC), [0, y + 0.06, D / 2 + 0.02]));
  for (let i = 0; i < look.pouches; i++) {
    const p = pouch(0.07, 0.15, 0.045, c, shade(c, 0.85));
    p.position.set((i - (look.pouches - 1) / 2) * 0.08, y, D / 2 + 0.05);
    g.add(p);
  }
  if (look.kind === 'belt') {
    const belt = new THREE.TorusGeometry(0.17, 0.022, 12, 40);
    belt.scale(1, 0.72, 1.6);
    g.add(part(belt, gearMat(shade(c, 0.9), FABRIC), [0, -0.02, 0], [Math.PI / 2, 0, 0]));
  }
  return g;
}

// ── Backpacks (procedural fallback; the Survival Pack backpack is tinted for the big ones) ─────────

export function slingModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(rbox(0.26, 0.18, 0.09, 0.04), gearMat(0x4a4e3c, FABRIC), [0, 0.09, 0]));
  g.add(part(rbox(0.22, 0.06, 0.1, 0.02), gearMat(0x3c4030, FABRIC), [0, 0.16, 0.005]));
  g.add(part(new THREE.TorusGeometry(0.2, 0.012, 12, 40, Math.PI), gearMat(0x2c2e24, FABRIC), [0, 0.17, 0], [0, 0, 0.6]));
  return g;
}

export const BACKPACK_TINT: Record<string, number> = { b_daypack: 0x4b5a6a, b_pilgrim: 0x6a6040, b_attack: 0x55603f };

// ── Ammunition ───────────────────────────────────────────────────────────────

interface Round {
  len: number;
  case: number;
  neck: number;
  bullet: number;
  caseColor: number;
  tip?: number;
  shell?: number;
}
const ROUNDS: Record<string, Round> = {
  '9x18': { len: 0.025, case: 0.0099, neck: 0.0093, bullet: 0.008, caseColor: 0x8a8f5a },
  '9x19': { len: 0.0295, case: 0.0099, neck: 0.0096, bullet: 0.0108, caseColor: BRASS },
  '5.45': { len: 0.057, case: 0.01, neck: 0.0062, bullet: 0.025, caseColor: 0x6e7656 },
  '5.56': { len: 0.057, case: 0.0096, neck: 0.0063, bullet: 0.023, caseColor: BRASS },
  '7.62x39': { len: 0.056, case: 0.0113, neck: 0.0086, bullet: 0.026, caseColor: 0x6e7656 },
  '7.62x54': { len: 0.077, case: 0.0122, neck: 0.0085, bullet: 0.032, caseColor: BRASS },
  '12g': { len: 0.07, case: 0.0185, neck: 0.0185, bullet: 0, caseColor: BRASS, shell: 0xa2382c },
};
const AMMO_TIP: Record<string, number> = { a_545bs: 0x111111, a_762bp: 0xb02a20, a_556m995: 0x111111, a_9x19ap: 0x2a2a2a, a_54r7n1: 0xd6d6d6, a_12slug: 0x3a6a3a };

function cartridge(r: Round, tip?: number): THREE.Group {
  const g = new THREE.Group();
  if (r.shell) {
    // Shotgun shell: plastic hull on a brass head.
    g.add(part(cyl(r.case / 2, r.case / 2, r.len * 0.78, 32), gearMat(tip ?? r.shell, 0.55), [0, r.len * 0.22 + r.len * 0.39, 0]));
    g.add(part(cyl(r.case / 2 * 1.06, r.case / 2 * 1.06, r.len * 0.22, 32), gearMat(BRASS, 0.3, 0.9), [0, r.len * 0.11, 0]));
    return g;
  }
  const caseLen = r.len - r.bullet * 0.75;
  const R = r.case / 2;
  const N = r.neck / 2;
  const caseG = lathe([[0, 0], [R * 1.02, 0], [R * 1.02, 0.0012], [R * 0.86, 0.0018], [R * 0.86, 0.0028], [R, 0.0034], [R * 0.97, caseLen * 0.78], [N, caseLen * 0.88], [N, caseLen]], 32);
  g.add(part(caseG, gearMat(r.caseColor, 0.32, 0.85)));
  const bl = r.bullet;
  // Tangent ogive: straight bearing surface, then a smooth curve to the point.
  const ogive: [number, number][] = [[N * 0.98, 0], [N * 0.98, bl * 0.42]];
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    ogive.push([N * 0.98 * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - t * 0.08), bl * (0.42 + 0.58 * t)]);
  }
  const bulletG = lathe(ogive, 32);
  g.add(part(bulletG, gearMat(0xa86a3a, 0.35, 0.8), [0, caseLen - bl * 0.25, 0]));
  if (tip) g.add(part(lathe([[N * 0.45, 0], [N * 0.38, bl * 0.06], [0, bl * 0.12]], 24), gearMat(tip, 0.5, 0.2), [0, caseLen - bl * 0.25 + bl * 0.88, 0]));
  return g;
}

/** A small fan of rounds lying on their side (inventory picture). */
export function ammoModel(id: string, caliber: string): THREE.Group {
  const r = ROUNDS[caliber] ?? ROUNDS['9x19']!;
  const tip = AMMO_TIP[id];
  const g = new THREE.Group();
  const n = r.shell ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const c = cartridge(r, r.shell && id === 'a_12slug' ? 0x2f5a32 : tip);
    c.rotation.z = -Math.PI / 2 + (i - (n - 1) / 2) * 0.12;
    c.position.set(-r.len / 2 + i * 0.002, i * r.case * 1.05, (i - (n - 1) / 2) * 0.004);
    g.add(c);
  }
  return g;
}

// ── Meds ─────────────────────────────────────────────────────────────────────

function cross(size: number, color: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part(box(size, size * 0.32, 0.002), gearMat(color, 0.6), [0, 0, z]));
  g.add(part(box(size * 0.32, size, 0.002), gearMat(color, 0.6), [0, 0, z]));
  return g;
}

function syringe(body: number, cap: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.008, 0.008, 0.1, 32), gearMat(body, 0.35, 0.2), [0, 0.05, 0]));
  g.add(part(cyl(0.0085, 0.0085, 0.02, 32), gearMat(cap, 0.4), [0, 0.11, 0]));
  g.add(part(cyl(0.006, 0.006, 0.012, 32), gearMat(0xd8d8d0, 0.5), [0, -0.006, 0]));
  return g;
}

export function medModel(id: string): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'ai2': {
      g.add(part(rbox(0.09, 0.12, 0.03, 0.008), gearMat(0xd8661e, 0.5), [0, 0.06, 0]));
      g.add(cross(0.035, 0xf2f0e8, 0.016).translateY(0.065));
      break;
    }
    case 'ifak': {
      g.add(part(rbox(0.16, 0.12, 0.07, 0.02), gearMat(0x55603f, FABRIC), [0, 0.06, 0]));
      g.add(part(rbox(0.165, 0.035, 0.075, 0.01), gearMat(0x4a5236, FABRIC), [0, 0.11, 0]));
      g.add(cross(0.045, 0xb02a20, 0.037).translateY(0.06));
      break;
    }
    case 'salewa': {
      g.add(part(rbox(0.18, 0.13, 0.07, 0.025), gearMat(0xb0302a, FABRIC), [0, 0.065, 0]));
      g.add(cross(0.05, 0xf2f0e8, 0.037).translateY(0.065));
      g.add(part(box(0.17, 0.006, 0.072), gearMat(0x1a1a1a, 0.6), [0, 0.12, 0]));
      break;
    }
    case 'grizzly': {
      g.add(part(rbox(0.26, 0.18, 0.1, 0.03), gearMat(0x5a4632, FABRIC), [0, 0.09, 0]));
      g.add(part(rbox(0.12, 0.08, 0.03, 0.01), gearMat(0x4a3a28, FABRIC), [0.05, 0.08, 0.06]));
      g.add(cross(0.05, 0xb02a20, 0.051).translateX(-0.07).translateY(0.1));
      break;
    }
    case 'cms':
    case 'surv12': {
      const c = id === 'cms' ? 0x6a7050 : 0x2d3a4a;
      g.add(part(cyl(0.05, 0.05, 0.2, 32), gearMat(c, FABRIC), [0, 0.05, 0], [0, 0, Math.PI / 2]));
      for (const x of [-0.06, 0.06]) g.add(part(cyl(0.052, 0.052, 0.012, 32), gearMat(shade(c, 0.7), FABRIC), [x, 0.05, 0], [0, 0, Math.PI / 2]));
      g.add(cross(0.04, 0xf2f0e8, 0.0505).translateY(0.05));
      break;
    }
    case 'esmarch': {
      g.add(part(new THREE.TorusGeometry(0.035, 0.018, 12, 40), gearMat(0xa83a2a, 0.55), [0, 0.04, 0]));
      g.add(part(box(0.1, 0.012, 0.03), gearMat(0x8a2a1e, 0.55), [0.05, 0.01, 0]));
      break;
    }
    case 'splint': {
      for (const x of [-0.025, 0.025]) g.add(part(rbox(0.03, 0.26, 0.012, 0.004), gearMat(0xd6c9a0, 0.7), [x, 0.13, 0]));
      for (const y of [0.06, 0.18]) g.add(part(box(0.09, 0.025, 0.02), gearMat(0xe8e8e0, 0.8), [0, y, 0]));
      break;
    }
    case 'analgin': {
      g.add(part(rbox(0.1, 0.05, 0.006, 0.002), gearMat(0xc8ccd0, 0.3, 0.6), [0, 0.025, 0]));
      for (let i = 0; i < 5; i++) for (const y of [0.014, 0.036]) g.add(part(new THREE.SphereGeometry(0.0055, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), gearMat(0xf0f0ea, 0.4), [-0.036 + i * 0.018, y, 0.003], [Math.PI / 2, 0, 0]));
      break;
    }
    case 'morphine':
      g.add(syringe(0x8a8f92, 0xb03a2a));
      break;
    case 'stim':
      g.add(syringe(0x4a8a5a, 0xe0c040));
      break;
    default:
      g.add(part(rbox(0.1, 0.08, 0.05, 0.01), gearMat(0xd8d8d0, 0.6), [0, 0.04, 0]));
      g.add(cross(0.035, 0xb02a20, 0.026).translateY(0.04));
  }
  return g;
}

// ── Food & drink (fallbacks; most come from the Survival / Food packs) ─────────

export function foodModel(id: string): THREE.Group {
  const g = new THREE.Group();
  if (id === 'mre') {
    g.add(part(rbox(0.16, 0.24, 0.04, 0.012), gearMat(0x6b5a3e, 0.85), [0, 0.12, 0]));
    g.add(part(box(0.12, 0.05, 0.002), gearMat(0x2a2620, 0.8), [0, 0.17, 0.021]));
  } else if (id === 'crackers') {
    g.add(part(rbox(0.12, 0.08, 0.03, 0.006), gearMat(0xc9a86a, 0.7), [0, 0.04, 0]));
    g.add(part(box(0.122, 0.022, 0.032), gearMat(0x3a5a2e, 0.7), [0, 0.06, 0]));
  } else if (id === 'juice') {
    g.add(part(rbox(0.07, 0.17, 0.07, 0.006), gearMat(0xe8e0c8, 0.6), [0, 0.085, 0]));
    g.add(part(box(0.072, 0.07, 0.072), gearMat(0x6a9a2a, 0.6), [0, 0.08, 0]));
    g.add(part(cyl(0.008, 0.008, 0.012, 32), gearMat(0x2a6a2a, 0.5), [0.015, 0.176, 0.015]));
  } else {
    g.add(part(cyl(0.04, 0.04, 0.08, 32), gearMat(0x9aa0a4, 0.35, 0.8), [0, 0.04, 0]));
  }
  return g;
}

// ── Junk, valuables, containers ──────────────────────────────────────────────

function nut(r: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, r * 0.8, 6, 1);
  return g;
}

export function miscModel(id: string): THREE.Group | null {
  const g = new THREE.Group();
  switch (id) {
    case 'bolts': {
      const m = gearMat(STEEL, 0.4, 0.85);
      for (let i = 0; i < 4; i++) g.add(part(nut(0.012), m, [-0.03 + i * 0.022, 0.005, (i % 2) * 0.02], [0, i, 0]));
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Group();
        b.add(part(cyl(0.005, 0.005, 0.06, 32), m, [0, 0.03, 0]));
        b.add(part(nut(0.01), m, [0, 0.062, 0]));
        b.position.set(-0.02 + i * 0.03, 0.006, -0.02);
        b.rotation.set(Math.PI / 2, 0, 0.3 * i);
        g.add(b);
      }
      g.add(part(rbox(0.12, 0.004, 0.08, 0.002), gearMat(0x8a6a3a, 0.9), [0, 0.002, 0]));
      return g;
    }
    case 'wires': {
      for (let i = 0; i < 3; i++) g.add(part(new THREE.TorusGeometry(0.05 - i * 0.004, 0.006, 12, 40), gearMat([0xb03020, 0x2a5aa0, 0xd8a020][i]!, 0.5), [i * 0.006, 0.006 + i * 0.008, 0], [Math.PI / 2, 0, 0]));
      g.add(part(cyl(0.002, 0.002, 0.05, 6), gearMat(0xd88a4a, 0.3, 0.9), [0.06, 0.01, 0], [0, 0, Math.PI / 2]));
      return g;
    }
    case 'tools': {
      g.add(part(rbox(0.3, 0.12, 0.14, 0.01), gearMat(0xa83224, 0.5, 0.3), [0, 0.06, 0]));
      g.add(part(box(0.302, 0.012, 0.142), gearMat(0x6a1a14, 0.5, 0.3), [0, 0.09, 0]));
      g.add(part(new THREE.TorusGeometry(0.05, 0.008, 12, 40, Math.PI), gearMat(0x1a1a1a, 0.5), [0, 0.12, 0]));
      for (const x of [-0.13, 0.13]) g.add(part(box(0.02, 0.02, 0.02), gearMat(STEEL, 0.4, 0.8), [x, 0.09, 0.072]));
      return g;
    }
    case 'cpu': {
      g.add(part(rbox(0.05, 0.004, 0.05, 0.001), gearMat(0x2a6a3a, 0.5), [0, 0.002, 0]));
      g.add(part(rbox(0.034, 0.004, 0.034, 0.002), gearMat(0xb8bcc0, 0.25, 0.9), [0, 0.006, 0]));
      return g;
    }
    case 'gpu': {
      g.add(part(box(0.26, 0.004, 0.11), gearMat(0x1e5a32, 0.5), [0, 0.002, 0]));
      g.add(part(rbox(0.25, 0.03, 0.1, 0.006), gearMat(0x1c1e20, 0.4, 0.5), [0, 0.02, 0]));
      for (const x of [-0.06, 0.06]) {
        g.add(part(cyl(0.04, 0.04, 0.004, 32), gearMat(0x0e0e10, 0.6), [x, 0.036, 0]));
        for (let b = 0; b < 7; b++) g.add(part(box(0.034, 0.002, 0.008), gearMat(0x2a2a2e, 0.5), [x, 0.039, 0], [0, (b / 7) * Math.PI * 2, 0.3]));
      }
      g.add(part(box(0.08, 0.008, 0.004), gearMat(BRASS, 0.3, 0.9), [0.02, 0.0, 0.057]));
      return g;
    }
    case 'flash': {
      g.add(part(rbox(0.06, 0.012, 0.02, 0.004), gearMat(0x1e2226, 0.4, 0.2), [0, 0.006, 0]));
      g.add(part(box(0.016, 0.006, 0.014), gearMat(STEEL, 0.3, 0.9), [0.037, 0.006, 0]));
      g.add(part(box(0.008, 0.002, 0.008), gearMat(0x40c060, 0.4, 0, 0x208030), [-0.015, 0.0125, 0]));
      return g;
    }
    case 'intel': {
      g.add(part(rbox(0.22, 0.012, 0.3, 0.003), gearMat(0x8a6a3a, 0.85), [0, 0.006, 0]));
      g.add(part(box(0.2, 0.004, 0.28), gearMat(0xe8e2d0, 0.9), [0.006, 0.014, 0.004]));
      g.add(part(box(0.08, 0.002, 0.02), gearMat(0xa02020, 0.7), [-0.04, 0.017, -0.1]));
      return g;
    }
    case 'chain': {
      const m = gearMat(0xd8a830, 0.25, 1);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        g.add(part(new THREE.TorusGeometry(0.009, 0.0025, 12, 40), m, [Math.cos(a) * 0.05, 0.004, Math.sin(a) * 0.04], [Math.PI / 2 + (i % 2) * Math.PI / 2, 0, a]));
      }
      return g;
    }
    case 'bitcoin': {
      g.add(part(cyl(0.02, 0.02, 0.004, 32), gearMat(0xe0a830, 0.25, 1), [0, 0.002, 0]));
      g.add(part(new THREE.TorusGeometry(0.018, 0.0012, 12, 40), gearMat(0xb07a18, 0.3, 1), [0, 0.0045, 0], [Math.PI / 2, 0, 0]));
      g.add(part(box(0.004, 0.0015, 0.018), gearMat(0xb07a18, 0.3, 1), [-0.003, 0.0045, 0]));
      g.add(part(new THREE.TorusGeometry(0.0045, 0.0015, 12, 40, Math.PI), gearMat(0xb07a18, 0.3, 1), [0.0, 0.0045, -0.004], [Math.PI / 2, 0, -Math.PI / 2]));
      g.add(part(new THREE.TorusGeometry(0.005, 0.0015, 12, 40, Math.PI), gearMat(0xb07a18, 0.3, 1), [0.0, 0.0045, 0.0045], [Math.PI / 2, 0, -Math.PI / 2]));
      return g;
    }
    case 'rolex': {
      g.add(part(cyl(0.019, 0.019, 0.01, 28), gearMat(0xd8b040, 0.2, 1), [0, 0.012, 0]));
      g.add(part(cyl(0.016, 0.016, 0.002, 28), gearMat(0x1a2a4a, 0.2, 0.4), [0, 0.018, 0]));
      for (const z of [-1, 1]) g.add(part(rbox(0.022, 0.006, 0.05, 0.002), gearMat(0xc8a040, 0.25, 1), [0, 0.008, z * 0.04], [z * 0.3, 0, 0]));
      g.add(part(box(0.002, 0.001, 0.012), gearMat(0xf0f0f0, 0.3), [0.0, 0.0195, 0.004]));
      return g;
    }
    case 'ledx': {
      g.add(part(rbox(0.12, 0.03, 0.08, 0.01), gearMat(0xd8dcd8, 0.4, 0.1), [0, 0.015, 0]));
      g.add(part(box(0.07, 0.002, 0.05), gearMat(0x1a3a4a, 0.1, 0.2, 0x0a2a3a), [-0.015, 0.031, 0]));
      g.add(part(cyl(0.012, 0.016, 0.03, 32), gearMat(0x2a2e30, 0.4, 0.4), [0.05, 0.03, 0]));
      return g;
    }
    case 'lion': {
      const m = gearMat(0x8a5a2a, 0.35, 0.85);
      g.add(part(rbox(0.16, 0.025, 0.08, 0.006), gearMat(0x3a2a20, 0.6), [0, 0.0125, 0]));
      g.add(part(new THREE.CapsuleGeometry(0.03, 0.08, 8, 20), m, [0, 0.07, 0], [0, 0, Math.PI / 2]));
      g.add(part(new THREE.SphereGeometry(0.038, 24, 16), m, [0.06, 0.1, 0]));
      g.add(part(new THREE.SphereGeometry(0.022, 24, 16), m, [0.085, 0.1, 0]));
      for (const [x, z] of [[-0.04, -0.02], [-0.04, 0.02], [0.04, -0.02], [0.04, 0.02]]) g.add(part(cyl(0.01, 0.012, 0.045, 32), m, [x!, 0.045, z!]));
      g.add(part(new THREE.TorusGeometry(0.03, 0.005, 12, 40, Math.PI), m, [-0.07, 0.09, 0], [0, 0, Math.PI / 2]));
      return g;
    }
    case 'bohdan_claw': {
      g.add(part(new THREE.TorusGeometry(0.06, 0.0025, 12, 40), gearMat(0x3a2a1a, 0.9), [0, 0.003, 0], [Math.PI / 2, 0, 0]));
      for (let i = -1; i <= 1; i++) g.add(part(new THREE.ConeGeometry(0.008, 0.045, 20), gearMat(0xe0d8c0, 0.5), [i * 0.018, 0.006, 0.07], [Math.PI / 2 + 0.2, 0, i * 0.3]));
      return g;
    }
    case 'kostia_ring': {
      g.add(part(new THREE.TorusGeometry(0.012, 0.004, 12, 40), gearMat(0xd8a830, 0.2, 1), [0, 0.012, 0]));
      g.add(part(rbox(0.016, 0.008, 0.012, 0.003), gearMat(0xd8a830, 0.2, 1), [0, 0.026, 0]));
      g.add(part(box(0.01, 0.002, 0.008), gearMat(0x6a1010, 0.2, 0.3), [0, 0.031, 0]));
      return g;
    }
    case 'rina_ledger': {
      g.add(part(rbox(0.16, 0.03, 0.22, 0.006), gearMat(0x3a2418, 0.7), [0, 0.015, 0]));
      g.add(part(box(0.15, 0.026, 0.205), gearMat(0xe0d6bc, 0.9), [0.006, 0.015, 0]));
      g.add(part(box(0.012, 0.032, 0.22), gearMat(0x2a1a10, 0.7), [-0.075, 0.015, 0]));
      g.add(part(box(0.02, 0.002, 0.16), gearMat(0xa02020, 0.6), [0.04, 0.0315, 0]));
      return g;
    }
    case 'roubles': {
      for (let i = 0; i < 6; i++) g.add(part(box(0.15, 0.002, 0.07), gearMat(i % 2 ? 0x6a8a5a : 0x5a7a4a, 0.85), [i * 0.002, 0.001 + i * 0.002, i * 0.001], [0, i * 0.04, 0]));
      g.add(part(box(0.02, 0.016, 0.072), gearMat(0xd8c890, 0.8), [0, 0.008, 0]));
      return g;
    }
    case 'sc_alpha':
    case 'sc_beta':
    case 'sc_gamma': {
      const c = id === 'sc_alpha' ? 0x5a5e60 : id === 'sc_beta' ? 0x4a5638 : 0x8a7650;
      g.add(part(rbox(0.3, 0.1, 0.22, 0.02), gearMat(c, 0.45, 0.3), [0, 0.05, 0]));
      for (const x of [-0.1, 0, 0.1]) g.add(part(box(0.012, 0.102, 0.222), gearMat(shade(c, 0.8), 0.45, 0.3), [x, 0.05, 0]));
      g.add(part(new THREE.TorusGeometry(0.04, 0.008, 12, 40, Math.PI), gearMat(0x1a1a1a, 0.5), [0, 0.05, 0.12], [Math.PI / 2, 0, 0]));
      for (const x of [-0.1, 0.1]) g.add(part(box(0.03, 0.03, 0.01), gearMat(STEEL, 0.3, 0.9), [x, 0.07, 0.112]));
      return g;
    }
    case 'battery': {
      g.add(part(rbox(0.26, 0.17, 0.17, 0.01), gearMat(0x1e1e22, 0.6), [0, 0.085, 0]));
      g.add(part(box(0.262, 0.03, 0.172), gearMat(0x2a5aa0, 0.5), [0, 0.15, 0]));
      g.add(part(cyl(0.012, 0.012, 0.02, 32), gearMat(0xb03020, 0.4, 0.6), [-0.09, 0.18, 0.04]));
      g.add(part(cyl(0.012, 0.012, 0.02, 32), gearMat(0x1a1a1a, 0.4, 0.6), [0.09, 0.18, 0.04]));
      return g;
    }
    default:
      return null;
  }
}

/** Magazines and drums (mods that the attachment pack doesn't model). */
export function magModel(id: string): THREE.Group | null {
  if (!id.startsWith('mag_')) return null;
  const g = new THREE.Group();
  if (id === 'mag_rpk95' || id === 'mag_saiga20') {
    g.add(part(cyl(0.07, 0.07, 0.05, 28), gearMat(0x1c1e1e, 0.5, 0.4), [0, 0.07, 0], [Math.PI / 2, 0, 0]));
    g.add(part(rbox(0.04, 0.08, 0.035, 0.006), gearMat(0x1c1e1e, 0.5, 0.4), [-0.02, 0.14, 0]));
    return g;
  }
  const len = id === 'mag_stanag60' ? 0.22 : id === 'mag_ak45' || id === 'mag_akm40' ? 0.25 : id === 'mag_sks20' ? 0.1 : 0.2;
  const color = id === 'mag_ak45' ? 0x6a3a22 : id === 'mag_stanag60' ? 0x2a2c2c : 0x1e2020;
  const curve = id.startsWith('mag_ak') ? 0.6 : 0.15;
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const a = t * curve;
    g.add(part(rbox(0.035, len / segs + 0.004, 0.025, 0.004), gearMat(color, 0.5, 0.3), [Math.sin(a) * len * 0.3, (t + 0.5 / segs) * len, 0], [0, 0, -a]));
  }
  return g;
}
