import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---- shared materials -------------------------------------------------------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
export const MAT = {
  plaster: std('#f4e8d2'),
  plasterWarm: std('#f1dcc0'),
  timber: std('#7d5639'),
  woodLight: std('#b88b5c'),
  woodDark: std('#6a4630'),
  log: std('#9a6c46'),
  logEnd: std('#e0c08e'),
  stone: std('#b9b3a6'),
  stoneDark: std('#958f84'),
  roofRed: std('#cf735a'),
  roofTerracotta: std('#d98b5f'),
  roofBlue: std('#7a93b5'),
  roofSlate: std('#8a8fa3'),
  roofMoss: std('#93a86a'),
  thatch: std('#dcb56d'),
  door: std('#7a4d33'),
  window: std('#4b4a5c', { emissive: new THREE.Color('#ffb25c'), emissiveIntensity: 0 }),
  glow: std('#fff1c9', { emissive: new THREE.Color('#ffbf66'), emissiveIntensity: 0.2 }),
  soil: std('#9a6f4d'),
  soilDark: std('#87603f'),
  leaf: std('#6fa84b'),
  hay: std('#e8c56a'),
  water: std('#5fa8c8', { roughness: 0.2 }),
  white: std('#fffaf0'),
  cloth: std('#d9574a'),
  clothBlue: std('#5c86c4'),
  metal: std('#8b8f96', { roughness: 0.5, metalness: 0.3 }),
  net: std('#d8cfb5'),
  pink: std('#f6a9bd', { emissive: new THREE.Color('#f6a9bd'), emissiveIntensity: 0.05 }),
  yellow: std('#ffe07a', { emissive: new THREE.Color('#ffe07a'), emissiveIntensity: 0.05 }),
  lilac: std('#c4b0ee', { emissive: new THREE.Color('#c4b0ee'), emissiveIntensity: 0.05 }),
  whiteFlower: std('#fffaf2', { emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.05 }),
};
export const ROOFS = [MAT.roofRed, MAT.roofTerracotta, MAT.roofBlue, MAT.roofSlate, MAT.roofMoss];

// ---- geometry helpers -----------------------------------------------------------
const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, prep(make()));
  return cache.get(key);
}
function prep(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
  return ng;
}
export const G = {
  box: (w, h, d, r = 0.04) => cached(`b${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999)),
  cyl: (rt, rb, h, seg = 10) => cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  cone: (r, h, seg = 10) => cached(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  sphere: (r, d = 2) => cached(`s${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  torus: (r, t) => cached(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, 6, 16)),
  // gabled roof: triangular prism, ridge along z, base at y=0
  roof: (w, h, d, bev = 0.05) => cached(`r${w},${h},${d},${bev}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + bev, bev); s.lineTo(w / 2 - bev, bev); s.lineTo(0, h - bev * 1.6); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 1 });
    g.translate(0, 0, -(d - bev * 2) / 2);
    return g;
  }),
  // pyramid/hip roof
  pyramid: (r, h, seg = 4) => cached(`p${r},${h},${seg}`, () => {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.rotateY(Math.PI / 4); g.translate(0, h / 2, 0);
    return g;
  }),
};

export class ModelBuilder {
  constructor() { this.parts = new Map(); this._m = new THREE.Matrix4(); this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); }
  add(geo, mat, x = 0, y = 0, z = 0, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    const g = geo.clone();
    this._e.set(rx, ry, rz);
    this._q.setFromEuler(this._e);
    this._m.compose(new THREE.Vector3(x, y, z), this._q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this._m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  build() {
    const group = new THREE.Group();
    for (const [mat, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
  buildGhost(mat) {
    const all = [];
    for (const geos of this.parts.values()) all.push(...geos);
    const mesh = new THREE.Mesh(mergeGeometries(all), mat);
    mesh.renderOrder = 5;
    return mesh;
  }
}

// ---- reusable little bits --------------------------------------------------------
function foundation(b, w, d, h = 0.22) {
  b.add(G.box(w, 1.2, d, 0.06), MAT.stone, 0, h - 0.6, 0);
}
function windowAt(b, x, y, z, ry = 0, w = 0.2, h = 0.24) {
  const fz = 0.02;
  b.add(G.box(w + 0.07, h + 0.07, 0.05, 0.015), MAT.timber, x, y, z, { ry });
  const ox = Math.sin(ry) * fz, oz = Math.cos(ry) * fz;
  b.add(G.box(w, h, 0.05, 0.01), MAT.window, x + ox, y, z + oz, { ry });
  // cross bar
  b.add(G.box(w, 0.025, 0.03, 0.005), MAT.timber, x + ox * 2, y, z + oz * 2, { ry });
  b.add(G.box(0.025, h, 0.03, 0.005), MAT.timber, x + ox * 2, y, z + oz * 2, { ry });
}
function flowerBox(b, x, y, z, ry, w, rng) {
  b.add(G.box(w, 0.07, 0.09, 0.02), MAT.woodLight, x, y, z, { ry });
  const mats = [MAT.pink, MAT.yellow, MAT.lilac, MAT.whiteFlower];
  const n = Math.round(w / 0.06);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * (w - 0.04);
    const px = x + Math.cos(ry) * t, pz = z - Math.sin(ry) * t;
    b.add(G.sphere(0.028, 1), i % 2 ? MAT.leaf : mats[Math.floor(rng() * mats.length)], px, y + 0.05 + (i % 2) * -0.01, pz);
  }
}
function barrel(b, x, y, z) {
  b.add(G.cyl(0.1, 0.1, 0.24, 10), MAT.woodLight, x, y + 0.12, z);
  b.add(G.cyl(0.103, 0.103, 0.03, 10), MAT.woodDark, x, y + 0.05, z);
  b.add(G.cyl(0.103, 0.103, 0.03, 10), MAT.woodDark, x, y + 0.19, z);
}
function crate(b, x, y, z, ry = 0, s = 0.2) {
  b.add(G.box(s, s, s, 0.02), MAT.woodLight, x, y + s / 2, z, { ry });
}
function logPile(b, x, y, z, ry = 0) {
  const rows = [[3, 0], [2, 1], [1, 2]];
  for (const [n, r] of rows) for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * 0.13;
    const px = x + Math.cos(ry) * t, pz = z - Math.sin(ry) * t;
    b.add(G.cyl(0.065, 0.065, 0.5, 8), MAT.log, px, y + 0.065 + r * 0.11, pz, { rx: Math.PI / 2, ry });
  }
}

// ---- building models (local space, front door faces +z) ---------------------------
export function cottageModel(rng) {
  const b = new ModelBuilder();
  const roof = ROOFS[Math.floor(rng() * ROOFS.length)];
  const wallMat = rng() < 0.5 ? MAT.plaster : MAT.plasterWarm;
  const W = 1.28, D = 1.0, H = 0.78;
  foundation(b, W + 0.16, D + 0.16);
  b.add(G.box(W, H, D, 0.05), wallMat, 0, 0.22 + H / 2, 0);
  // timber framing
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(0.07, H, 0.07, 0.02), MAT.timber, sx * (W / 2 - 0.02), 0.22 + H / 2, sz * (D / 2 - 0.02));
  b.add(G.box(W + 0.02, 0.06, D + 0.02, 0.02), MAT.timber, 0, 0.22 + H - 0.03, 0);
  b.add(G.box(W + 0.02, 0.05, D + 0.02, 0.02), MAT.timber, 0, 0.25, 0);
  // roof (ridge along x)
  b.add(G.roof(D + 0.34, 0.72, W + 0.3, 0.06), roof, 0, 0.22 + H - 0.02, 0, { ry: Math.PI / 2 });
  // gable triangles in plaster
  b.add(G.roof(D - 0.04, 0.6, W - 0.02, 0.03), wallMat, 0, 0.22 + H, 0, { ry: Math.PI / 2 });
  // chimney
  const cx = (rng() < 0.5 ? -1 : 1) * W * 0.28;
  b.add(G.box(0.18, 0.7, 0.18, 0.03), MAT.stone, cx, 0.22 + H + 0.45, -0.15);
  b.add(G.box(0.22, 0.06, 0.22, 0.02), MAT.stoneDark, cx, 0.22 + H + 0.8, -0.15);
  // door + step
  b.add(G.box(0.26, 0.42, 0.06, 0.04), MAT.door, 0, 0.22 + 0.21, D / 2 + 0.01);
  b.add(G.box(0.3, 0.46, 0.04, 0.03), MAT.timber, 0, 0.22 + 0.22, D / 2 - 0.005);
  b.add(G.sphere(0.018, 1), MAT.metal, 0.08, 0.44, D / 2 + 0.05);
  b.add(G.box(0.36, 0.06, 0.16, 0.02), MAT.stone, 0, 0.2, D / 2 + 0.1);
  // windows
  windowAt(b, -0.38, 0.22 + 0.42, D / 2 + 0.01);
  windowAt(b, 0.38, 0.22 + 0.42, D / 2 + 0.01);
  windowAt(b, -0.32, 0.22 + 0.45, -D / 2 - 0.01, Math.PI);
  windowAt(b, 0.32, 0.22 + 0.45, -D / 2 - 0.01, Math.PI);
  windowAt(b, W / 2 + 0.01, 0.22 + 0.45, 0, Math.PI / 2);
  windowAt(b, -W / 2 - 0.01, 0.22 + 0.45, 0, -Math.PI / 2);
  flowerBox(b, -0.38, 0.22 + 0.26, D / 2 + 0.07, 0, 0.28, rng);
  flowerBox(b, 0.38, 0.22 + 0.26, D / 2 + 0.07, 0, 0.28, rng);
  // little extras
  if (rng() < 0.6) barrel(b, W / 2 + 0.12, 0.08, D / 2 - 0.1);
  if (rng() < 0.5) crate(b, -W / 2 - 0.1, 0.06, D / 2 - 0.15, 0.3, 0.16);
  return { builder: b, chimney: new THREE.Vector3(cx, 0.22 + H + 0.85, -0.15) };
}

export function storehouseModel() {
  const b = new ModelBuilder();
  const W = 2.1, D = 1.6, H = 1.0;
  foundation(b, W + 0.2, D + 0.2, 0.25);
  b.add(G.box(W, H, D, 0.05), MAT.plaster, 0, 0.25 + H / 2, 0);
  b.add(G.box(W + 0.04, 0.32, D + 0.04, 0.04), MAT.stone, 0, 0.25 + 0.16, 0);
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) b.add(G.box(0.09, H, 0.09, 0.02), MAT.timber, sx * (W / 2 - 0.03), 0.25 + H / 2, sz * (D / 2 - 0.03));
  b.add(G.box(W + 0.04, 0.08, D + 0.04, 0.02), MAT.timber, 0, 0.25 + H - 0.04, 0);
  b.add(G.roof(D + 0.42, 1.05, W + 0.4, 0.07), MAT.roofRed, 0, 0.25 + H - 0.02, 0, { ry: Math.PI / 2 });
  b.add(G.roof(D - 0.04, 0.9, W - 0.02, 0.03), MAT.plaster, 0, 0.25 + H, 0, { ry: Math.PI / 2 });
  // big barn doors
  b.add(G.box(0.7, 0.62, 0.07, 0.04), MAT.door, 0, 0.25 + 0.31, D / 2 + 0.01);
  b.add(G.box(0.05, 0.62, 0.09, 0.01), MAT.timber, 0, 0.25 + 0.31, D / 2 + 0.02);
  b.add(G.box(0.7, 0.05, 0.09, 0.01), MAT.timber, 0, 0.25 + 0.4, D / 2 + 0.02, { rz: 0.7 });
  b.add(G.box(0.8, 0.07, 0.24, 0.02), MAT.stone, 0, 0.23, D / 2 + 0.14);
  // little dormer window in the roof
  b.add(G.box(0.36, 0.34, 0.4, 0.03), MAT.plaster, 0, 0.25 + H + 0.2, D / 2 - 0.12);
  b.add(G.roof(0.5, 0.26, 0.48, 0.03), MAT.roofRed, 0, 0.25 + H + 0.36, D / 2 - 0.1);
  windowAt(b, 0, 0.25 + H + 0.2, D / 2 + 0.09);
  windowAt(b, -0.72, 0.25 + 0.58, D / 2 + 0.01);
  windowAt(b, 0.72, 0.25 + 0.58, D / 2 + 0.01);
  windowAt(b, -0.55, 0.25 + 0.6, -D / 2 - 0.01, Math.PI);
  windowAt(b, 0.55, 0.25 + 0.6, -D / 2 - 0.01, Math.PI);
  windowAt(b, W / 2 + 0.01, 0.25 + 0.6, 0, Math.PI / 2);
  windowAt(b, -W / 2 - 0.01, 0.25 + 0.6, 0, -Math.PI / 2);
  // goods out front
  barrel(b, -0.95, 0.1, D / 2 + 0.3);
  barrel(b, -0.72, 0.1, D / 2 + 0.38);
  crate(b, 0.8, 0.1, D / 2 + 0.3, 0.2, 0.22);
  crate(b, 1.02, 0.1, D / 2 + 0.25, -0.3, 0.18);
  crate(b, 0.86, 0.32, D / 2 + 0.3, 0.5, 0.16);
  // flag pole (flag itself is animated separately)
  b.add(G.cyl(0.025, 0.03, 1.4, 6), MAT.woodDark, W / 2 + 0.25, 0.25 + 0.7, -D / 2 + 0.1);
  b.add(G.sphere(0.04, 1), MAT.yellow, W / 2 + 0.25, 0.25 + 1.42, -D / 2 + 0.1);
  return { builder: b, flag: new THREE.Vector3(W / 2 + 0.25, 0.25 + 1.3, -D / 2 + 0.1) };
}

export function farmModel(rng) {
  const b = new ModelBuilder();
  const S = 2.86;
  b.add(G.box(S, 0.14, S, 0.06), MAT.soil, 0, 0.02, 0);
  // furrows
  for (let r = 0; r < 5; r++) b.add(G.box(S - 0.4, 0.06, 0.16, 0.03), MAT.soilDark, 0, 0.1, -1.0 + r * 0.5);
  // fence posts & rails around three sides; open at the front
  const fx = S / 2 + 0.05;
  const post = (x, z) => b.add(G.box(0.07, 0.34, 0.07, 0.02), MAT.woodLight, x, 0.17, z);
  for (let t = -fx; t <= fx + 0.01; t += S / 4) { post(t, -fx); post(-fx, t); post(fx, t); }
  b.add(G.box(S + 0.1, 0.04, 0.04, 0.01), MAT.woodLight, 0, 0.26, -fx);
  b.add(G.box(S + 0.1, 0.04, 0.04, 0.01), MAT.woodLight, 0, 0.14, -fx);
  for (const sx of [-1, 1]) {
    b.add(G.box(0.04, 0.04, S + 0.1, 0.01), MAT.woodLight, sx * fx, 0.26, 0);
    b.add(G.box(0.04, 0.04, S + 0.1, 0.01), MAT.woodLight, sx * fx, 0.14, 0);
  }
  // scarecrow
  const sx = S / 2 - 0.35, sz = -S / 2 + 0.35;
  b.add(G.cyl(0.02, 0.02, 0.7, 5), MAT.woodDark, sx, 0.4, sz);
  b.add(G.cyl(0.015, 0.015, 0.42, 5), MAT.woodDark, sx, 0.6, sz, { rz: Math.PI / 2 });
  b.add(G.box(0.16, 0.2, 0.08, 0.04), MAT.clothBlue, sx, 0.56, sz);
  b.add(G.sphere(0.07, 1), MAT.hay, sx, 0.75, sz);
  b.add(G.cone(0.12, 0.1, 8), MAT.thatch, sx, 0.84, sz);
  // hay bales by the gate
  b.add(G.cyl(0.13, 0.13, 0.2, 10), MAT.hay, -S / 2 + 0.3, 0.17, S / 2 - 0.05, { rz: Math.PI / 2 });
  return { builder: b };
}

export function cropGeometry() {
  // a little wheat tuft
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.ConeGeometry(0.035, 0.3, 4);
    c.translate(0, 0.15, 0);
    c.rotateZ((i - 1.5) * 0.18);
    c.rotateY(i * 1.3);
    parts.push(prep(c));
  }
  const head = prep(new THREE.IcosahedronGeometry(0.06, 0));
  head.scale(0.7, 1.4, 0.7); head.translate(0, 0.3, 0);
  parts.push(head);
  return mergeGeometries(parts);
}

export function woodcutterModel(rng) {
  const b = new ModelBuilder();
  const W = 1.0, D = 0.85, H = 0.62;
  foundation(b, W + 0.14, D + 0.14, 0.18);
  // log cabin walls
  for (let r = 0; r < 5; r++) {
    const y = 0.18 + 0.07 + r * 0.125;
    b.add(G.cyl(0.065, 0.065, W + 0.12, 8), MAT.log, 0, y, D / 2, { rz: Math.PI / 2 });
    b.add(G.cyl(0.065, 0.065, W + 0.12, 8), MAT.log, 0, y, -D / 2, { rz: Math.PI / 2 });
    b.add(G.cyl(0.065, 0.065, D + 0.12, 8), MAT.log, W / 2, y + 0.06, 0, { rx: Math.PI / 2 });
    b.add(G.cyl(0.065, 0.065, D + 0.12, 8), MAT.log, -W / 2, y + 0.06, 0, { rx: Math.PI / 2 });
  }
  b.add(G.box(W - 0.05, H, D - 0.05, 0.02), MAT.woodDark, 0, 0.18 + H / 2, 0);
  b.add(G.roof(D + 0.4, 0.6, W + 0.36, 0.05), MAT.roofMoss, 0, 0.18 + H, 0, { ry: Math.PI / 2 });
  b.add(G.roof(D - 0.06, 0.5, W - 0.06, 0.03), MAT.log, 0, 0.18 + H, 0, { ry: Math.PI / 2 });
  b.add(G.box(0.24, 0.38, 0.06, 0.03), MAT.door, 0.15, 0.18 + 0.19, D / 2 + 0.06);
  windowAt(b, -0.24, 0.18 + 0.36, D / 2 + 0.07);
  windowAt(b, W / 2 + 0.07, 0.18 + 0.38, 0, Math.PI / 2);
  // stove pipe
  b.add(G.cyl(0.05, 0.05, 0.4, 8), MAT.metal, -0.25, 0.18 + H + 0.35, -0.12);
  // chopping block with axe + log pile
  b.add(G.cyl(0.13, 0.15, 0.2, 10), MAT.log, 0.62, 0.1, 0.55);
  b.add(G.cyl(0.13, 0.13, 0.01, 10), MAT.logEnd, 0.62, 0.205, 0.55);
  b.add(G.cyl(0.012, 0.012, 0.3, 5), MAT.woodLight, 0.62, 0.33, 0.55, { rz: 0.35 });
  b.add(G.box(0.1, 0.06, 0.02, 0.005), MAT.metal, 0.57, 0.24, 0.55, { rz: 0.35 });
  logPile(b, -0.55, 0.05, 0.6, 0.0);
  logPile(b, -W / 2 - 0.2, 0.05, -0.1, Math.PI / 2);
  return { builder: b, chimney: new THREE.Vector3(-0.25, 0.18 + H + 0.58, -0.12) };
}

export function fisheryModel(rng) {
  const b = new ModelBuilder();
  const W = 1.0, D = 0.85, H = 0.6;
  // on short stilts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.cyl(0.05, 0.05, 1.0, 6), MAT.woodDark, sx * (W / 2), -0.2, sz * (D / 2));
  b.add(G.box(W + 0.3, 0.08, D + 0.3, 0.02), MAT.woodLight, 0, 0.28, 0);
  b.add(G.box(W, H, D, 0.03), MAT.woodLight, 0, 0.32 + H / 2, 0);
  for (let r = 0; r < 4; r++) b.add(G.box(W + 0.01, 0.015, D + 0.01, 0.005), MAT.woodDark, 0, 0.32 + 0.12 + r * 0.14, 0);
  b.add(G.roof(D + 0.34, 0.55, W + 0.32, 0.05), MAT.roofBlue, 0, 0.32 + H, 0, { ry: Math.PI / 2 });
  b.add(G.roof(D - 0.04, 0.45, W - 0.04, 0.03), MAT.woodLight, 0, 0.32 + H, 0, { ry: Math.PI / 2 });
  b.add(G.box(0.24, 0.38, 0.05, 0.03), MAT.door, -0.18, 0.32 + 0.19, D / 2 + 0.02);
  windowAt(b, 0.24, 0.32 + 0.36, D / 2 + 0.01);
  windowAt(b, -W / 2 - 0.01, 0.32 + 0.36, 0, -Math.PI / 2);
  // net drying rack
  const nx = W / 2 + 0.32;
  b.add(G.cyl(0.02, 0.02, 0.6, 5), MAT.woodDark, nx, 0.3, -0.35);
  b.add(G.cyl(0.02, 0.02, 0.6, 5), MAT.woodDark, nx, 0.3, 0.35);
  b.add(G.cyl(0.015, 0.015, 0.74, 5), MAT.woodDark, nx, 0.58, 0, { rx: Math.PI / 2 });
  b.add(G.box(0.02, 0.36, 0.66, 0.005), MAT.net, nx, 0.4, 0);
  // barrels & a fish crate
  barrel(b, -W / 2 - 0.2, 0.0, 0.42);
  crate(b, 0.4, 0.32, D / 2 + 0.05, 0.2, 0.16);
  // little lantern
  b.add(G.box(0.07, 0.09, 0.07, 0.02), MAT.glow, W / 2 + 0.06, 0.32 + 0.5, D / 2 + 0.06);
  // rowboat by the hut
  const bx = 0.2, bz = -D / 2 - 0.35;
  b.add(G.box(0.7, 0.1, 0.28, 0.05), MAT.woodDark, bx, 0.08, bz);
  b.add(G.box(0.66, 0.08, 0.22, 0.04), MAT.woodLight, bx, 0.12, bz);
  return { builder: b };
}

export function wellModel() {
  const b = new ModelBuilder();
  b.add(G.cyl(0.34, 0.37, 0.36, 14), MAT.stone, 0, 0.12, 0);
  b.add(G.cyl(0.36, 0.36, 0.06, 14), MAT.stoneDark, 0, 0.32, 0);
  b.add(G.cyl(0.26, 0.26, 0.02, 14), MAT.water, 0, 0.3, 0);
  for (const sx of [-1, 1]) b.add(G.box(0.06, 0.7, 0.06, 0.02), MAT.timber, sx * 0.3, 0.6, 0);
  b.add(G.cyl(0.03, 0.03, 0.66, 6), MAT.woodDark, 0, 0.78, 0, { rz: Math.PI / 2 });
  b.add(G.roof(0.84, 0.36, 0.6, 0.04), MAT.roofRed, 0, 0.9, 0);
  b.add(G.cyl(0.004, 0.004, 0.34, 3), MAT.net, 0.05, 0.6, 0);
  b.add(G.cyl(0.06, 0.05, 0.08, 8), MAT.woodLight, 0.05, 0.42, 0);
  b.add(G.cyl(0.01, 0.01, 0.2, 4), MAT.woodDark, 0.38, 0.78, 0, { rz: Math.PI / 2 });
  return { builder: b };
}

export function gardenModel(rng) {
  const b = new ModelBuilder();
  b.add(G.box(0.86, 0.1, 0.86, 0.04), MAT.soil, 0, 0.02, 0);
  // low stone border
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add(G.sphere(0.07, 1), MAT.stone, Math.cos(a) * 0.44, 0.05, Math.sin(a) * 0.44, { sy: 0.7 });
  }
  const mats = [MAT.pink, MAT.yellow, MAT.lilac, MAT.whiteFlower];
  for (let n = 0; n < 26; n++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.33;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.08 + rng() * 0.16;
    b.add(G.cyl(0.006, 0.008, h, 3), MAT.leaf, x, 0.08 + h / 2, z);
    b.add(G.sphere(0.035 + rng() * 0.02, 1), mats[Math.floor(rng() * mats.length)], x, 0.08 + h, z);
  }
  for (let n = 0; n < 5; n++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.3;
    b.add(G.sphere(0.07, 1), MAT.leaf, Math.cos(a) * r, 0.1, Math.sin(a) * r, { sy: 0.7 });
  }
  // a tiny bench
  b.add(G.box(0.3, 0.03, 0.1, 0.01), MAT.woodLight, 0, 0.17, 0.3);
  return { builder: b };
}

export function lanternModel() {
  const b = new ModelBuilder();
  b.add(G.cyl(0.08, 0.1, 0.08, 8), MAT.stone, 0, 0.04, 0);
  b.add(G.cyl(0.025, 0.03, 0.9, 6), MAT.woodDark, 0, 0.5, 0);
  b.add(G.box(0.22, 0.03, 0.03, 0.01), MAT.woodDark, 0.08, 0.92, 0);
  b.add(G.cyl(0.006, 0.006, 0.08, 3), MAT.metal, 0.17, 0.87, 0);
  b.add(G.box(0.1, 0.12, 0.1, 0.02), MAT.glow, 0.17, 0.78, 0);
  b.add(G.pyramid(0.09, 0.07), MAT.woodDark, 0.17, 0.84, 0);
  return { builder: b, light: new THREE.Vector3(0.17, 0.78, 0) };
}

// Villager parts (shared geometry, built once)
export const VILLAGER_GEO = {
  body: prep(new THREE.CapsuleGeometry(0.075, 0.12, 3, 10)),
  head: prep(new THREE.IcosahedronGeometry(0.068, 2)),
  leg: (() => { const g = prep(new THREE.CapsuleGeometry(0.026, 0.06, 2, 6)); g.translate(0, -0.05, 0); return g; })(),
  arm: (() => { const g = prep(new THREE.CapsuleGeometry(0.02, 0.07, 2, 6)); g.translate(0, -0.05, 0); return g; })(),
  hair: (() => { const g = prep(new THREE.SphereGeometry(0.073, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)); g.rotateX(-0.25); return g; })(),
  strawHat: mergeGeometries([prep(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 14)), (() => { const c = prep(new THREE.CylinderGeometry(0.05, 0.065, 0.06, 12)); c.translate(0, 0.035, 0); return c; })()]),
  hood: (() => { const g = prep(new THREE.ConeGeometry(0.085, 0.16, 10)); g.translate(0, 0.07, -0.01); return g; })(),
  beanie: (() => { const g = prep(new THREE.SphereGeometry(0.076, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)); return g; })(),
  log: (() => { const g = prep(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 8)); g.rotateZ(Math.PI / 2); return g; })(),
  basket: mergeGeometries([prep(new THREE.CylinderGeometry(0.07, 0.055, 0.07, 10)), (() => { const s = prep(new THREE.IcosahedronGeometry(0.055, 1)); s.scale(1, 0.6, 1); s.translate(0, 0.04, 0); return s; })()]),
  fish: (() => { const g = prep(new THREE.IcosahedronGeometry(0.05, 1)); g.scale(1.8, 0.7, 0.6); return g; })(),
  axe: mergeGeometries([(() => { const c = prep(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5)); c.translate(0, -0.1, 0); return c; })(), (() => { const c = prep(new THREE.BoxGeometry(0.06, 0.05, 0.012)); c.translate(0.03, -0.18, 0); return c; })()]),
  rod: (() => { const c = prep(new THREE.CylinderGeometry(0.005, 0.009, 0.6, 4)); c.translate(0, 0.3, 0); return c; })(),
  hoe: mergeGeometries([(() => { const c = prep(new THREE.CylinderGeometry(0.009, 0.009, 0.28, 5)); c.translate(0, -0.12, 0); return c; })(), (() => { const c = prep(new THREE.BoxGeometry(0.05, 0.012, 0.04)); c.translate(0, -0.26, 0.02); return c; })()]),
};
