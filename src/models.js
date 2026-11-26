import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { seasonal } from './seasons.js';

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
// snow settles on roofs, walls' tops, stone and wood (but never on glowing windows)
for (const [k, m] of Object.entries(MAT)) if (!['window', 'glow', 'water'].includes(k)) seasonal(m, { grass: k === 'leaf' });

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
  bakerHat: (() => { const g = prep(new THREE.CylinderGeometry(0.085, 0.06, 0.1, 12)); g.translate(0, 0.04, 0); const t = prep(new THREE.IcosahedronGeometry(0.08, 1)); t.scale(1, 0.6, 1); t.translate(0, 0.1, 0); return mergeGeometries([g, t]); })(),
  pail: mergeGeometries([(() => { const c = prep(new THREE.CylinderGeometry(0.045, 0.035, 0.07, 10)); return c; })(), (() => { const t = prep(new THREE.TorusGeometry(0.04, 0.005, 4, 10, Math.PI)); t.translate(0, 0.035, 0); return t; })()]),
  wool: mergeGeometries([[0, 0, 0, 0.05], [0.04, 0.01, 0.01, 0.035], [-0.04, 0.012, -0.01, 0.035], [0.0, 0.035, 0.0, 0.035]].map(([x, y, z, r]) => { const g = prep(new THREE.IcosahedronGeometry(r, 1)); g.translate(x, y, z); return g; })),
  hood: (() => { const g = prep(new THREE.ConeGeometry(0.085, 0.16, 10)); g.translate(0, 0.07, -0.01); return g; })(),
  beanie: (() => { const g = prep(new THREE.SphereGeometry(0.076, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)); return g; })(),
  log: (() => { const g = prep(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 8)); g.rotateZ(Math.PI / 2); return g; })(),
  basket: mergeGeometries([prep(new THREE.CylinderGeometry(0.07, 0.055, 0.07, 10)), (() => { const s = prep(new THREE.IcosahedronGeometry(0.055, 1)); s.scale(1, 0.6, 1); s.translate(0, 0.04, 0); return s; })()]),
  fish: (() => { const g = prep(new THREE.IcosahedronGeometry(0.05, 1)); g.scale(1.8, 0.7, 0.6); return g; })(),
  axe: mergeGeometries([(() => { const c = prep(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5)); c.translate(0, -0.1, 0); return c; })(), (() => { const c = prep(new THREE.BoxGeometry(0.06, 0.05, 0.012)); c.translate(0.03, -0.18, 0); return c; })()]),
  rod: (() => { const c = prep(new THREE.CylinderGeometry(0.005, 0.009, 0.6, 4)); c.translate(0, 0.3, 0); return c; })(),
  hoe: mergeGeometries([(() => { const c = prep(new THREE.CylinderGeometry(0.009, 0.009, 0.28, 5)); c.translate(0, -0.12, 0); return c; })(), (() => { const c = prep(new THREE.BoxGeometry(0.05, 0.012, 0.04)); c.translate(0, -0.26, 0.02); return c; })()]),
};

// ---- newer buildings ---------------------------------------------------------------
export function bakeryModel(rng) {
  const b = new ModelBuilder();
  const W = 1.2, D = 0.95, H = 0.74;
  foundation(b, W + 0.16, D + 0.16);
  b.add(G.box(W, H, D, 0.05), MAT.plasterWarm, 0, 0.22 + H / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(0.07, H, 0.07, 0.02), MAT.timber, sx * (W / 2 - 0.02), 0.22 + H / 2, sz * (D / 2 - 0.02));
  b.add(G.box(W + 0.02, 0.06, D + 0.02, 0.02), MAT.timber, 0, 0.22 + H - 0.03, 0);
  b.add(G.roof(D + 0.34, 0.66, W + 0.3, 0.06), MAT.roofTerracotta, 0, 0.22 + H - 0.02, 0, { ry: Math.PI / 2 });
  b.add(G.roof(D - 0.04, 0.55, W - 0.02, 0.03), MAT.plasterWarm, 0, 0.22 + H, 0, { ry: Math.PI / 2 });
  // big round bread oven on the side, with its own chimney
  const ox = W / 2 + 0.26;
  b.add(G.cyl(0.32, 0.34, 0.24, 14), MAT.stone, ox, 0.12, -0.05);
  b.add(G.sphere(0.32, 2), MAT.stone, ox, 0.26, -0.05, { sy: 0.8 });
  b.add(G.box(0.16, 0.14, 0.08, 0.04), MAT.glow, ox + 0.18, 0.3, 0.2, { ry: 0.6 });
  b.add(G.cyl(0.07, 0.08, 0.5, 8), MAT.stoneDark, ox - 0.05, 0.6, -0.12);
  // door, windows, sign with a loaf
  b.add(G.box(0.26, 0.42, 0.06, 0.04), MAT.door, -0.2, 0.22 + 0.21, D / 2 + 0.01);
  b.add(G.box(0.36, 0.06, 0.16, 0.02), MAT.stone, -0.2, 0.2, D / 2 + 0.1);
  windowAt(b, 0.28, 0.22 + 0.42, D / 2 + 0.01, 0, 0.3, 0.24);
  windowAt(b, -0.3, 0.22 + 0.45, -D / 2 - 0.01, Math.PI);
  windowAt(b, 0.3, 0.22 + 0.45, -D / 2 - 0.01, Math.PI);
  flowerBox(b, 0.28, 0.22 + 0.26, D / 2 + 0.07, 0, 0.34, rng);
  b.add(G.box(0.03, 0.03, 0.26, 0.01), MAT.timber, -0.5, 0.22 + 0.66, D / 2 + 0.12);
  b.add(G.box(0.2, 0.16, 0.03, 0.02), MAT.woodLight, -0.5, 0.22 + 0.55, D / 2 + 0.24);
  b.add(G.sphere(0.055, 1), MAT.hay, -0.5, 0.22 + 0.55, D / 2 + 0.26, { sx: 1.5, sz: 0.6 });
  // flour sacks & a wood pile for the oven
  b.add(G.sphere(0.1, 1), MAT.net, -W / 2 - 0.1, 0.1, 0.25, { sy: 1.2 });
  b.add(G.sphere(0.09, 1), MAT.net, -W / 2 - 0.12, 0.09, 0.05, { sy: 1.1 });
  logPile(b, ox + 0.05, 0.02, 0.42, 0);
  return { builder: b, chimney: new THREE.Vector3(ox - 0.05, 0.9, -0.12) };
}

export function marketModel(rng) {
  const b = new ModelBuilder();
  // flagstone square
  b.add(G.box(2.86, 0.12, 2.86, 0.06), MAT.stone, 0, 0.0, 0);
  for (let n = 0; n < 20; n++) {
    const x = (rng() - 0.5) * 2.5, z = (rng() - 0.5) * 2.5;
    b.add(G.box(0.3 + rng() * 0.2, 0.03, 0.25 + rng() * 0.2, 0.02), rng() < 0.5 ? MAT.stoneDark : MAT.plasterWarm, x, 0.065, z, { ry: rng() });
  }
  const awnings = [MAT.cloth, MAT.clothBlue, MAT.roofMoss];
  const produce = [MAT.cloth, MAT.leaf, MAT.roofTerracotta, MAT.yellow, MAT.hay];
  const stall = (x, z, ry, aw) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    // counter
    let [px, pz] = P(0, 0.1);
    b.add(G.box(0.9, 0.3, 0.36, 0.03), MAT.woodLight, px, 0.22, pz, { ry });
    // posts
    for (const [lx, lz] of [[-0.42, -0.1], [0.42, -0.1], [-0.42, 0.32], [0.42, 0.32]]) {
      [px, pz] = P(lx, lz);
      b.add(G.box(0.05, lz < 0 ? 0.92 : 0.75, 0.05, 0.015), MAT.timber, px, lz < 0 ? 0.52 : 0.44, pz);
    }
    // striped awning sloping toward the customers
    for (let k = 0; k < 4; k++) {
      [px, pz] = P(-0.36 + k * 0.24, 0.12);
      b.add(G.box(0.24, 0.04, 0.6, 0.015), k % 2 ? MAT.white : aw, px, 0.9, pz, { ry, rx: 0 }, );
    }
    [px, pz] = P(0, 0.42);
    b.add(G.box(0.98, 0.1, 0.03, 0.01), aw, px, 0.84, pz, { ry });
    // produce
    for (let k = 0; k < 6; k++) {
      [px, pz] = P(-0.33 + k * 0.13, 0.12 + (k % 2) * 0.08);
      b.add(G.sphere(0.055, 1), produce[Math.floor(rng() * produce.length)], px, 0.42, pz);
    }
  };
  stall(-0.7, -0.75, 0, awnings[0]);
  stall(0.75, -0.6, -Math.PI / 2 + 0.3, awnings[1]);
  stall(-0.85, 0.65, Math.PI / 2 - 0.2, awnings[2]);
  // crates, barrels, a pumpkin pile
  crate(b, 0.9, 0.06, 0.85, 0.3, 0.2);
  crate(b, 1.1, 0.06, 0.7, -0.2, 0.17);
  barrel(b, 0.6, 0.06, 1.05);
  for (let k = 0; k < 4; k++) b.add(G.sphere(0.09, 1), MAT.roofTerracotta, 0.2 + k * 0.12, 0.13, 1.1 - (k % 2) * 0.1, { sy: 0.75 });
  // bunting between two poles
  b.add(G.cyl(0.025, 0.03, 1.2, 6), MAT.woodDark, -1.3, 0.6, -1.3);
  b.add(G.cyl(0.025, 0.03, 1.2, 6), MAT.woodDark, 1.3, 0.6, 1.3);
  const flags = [MAT.cloth, MAT.yellow, MAT.clothBlue, MAT.pink, MAT.leaf];
  for (let k = 1; k < 12; k++) {
    const t = k / 12;
    const x = -1.3 + 2.6 * t, z = -1.3 + 2.6 * t, y = 1.12 - Math.sin(t * Math.PI) * 0.22;
    b.add(G.cone(0.05, 0.1, 3), flags[k % flags.length], x, y, z, { rx: Math.PI, ry: Math.PI / 4 });
  }
  return { builder: b };
}

export function chapelModel(rng) {
  const b = new ModelBuilder();
  const W = 0.95, D = 1.4, H = 0.9;
  foundation(b, W + 0.18, D + 0.18, 0.2);
  // nave (ridge runs front to back)
  b.add(G.box(W, H, D, 0.05), MAT.stone, 0, 0.2 + H / 2, 0);
  b.add(G.roof(W + 0.3, 0.75, D + 0.24, 0.06), MAT.roofSlate, 0, 0.2 + H - 0.02, 0);
  // bell tower at the front
  const tz = D / 2 - 0.1;
  b.add(G.box(0.5, 1.6, 0.5, 0.04), MAT.stone, 0, 0.2 + 0.8, tz);
  b.add(G.box(0.54, 0.06, 0.54, 0.02), MAT.stoneDark, 0, 0.2 + 1.6, tz);
  // open belfry with a little bell
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(0.07, 0.34, 0.07, 0.02), MAT.stone, sx * 0.2, 0.2 + 1.8, tz + sz * 0.2);
  b.add(G.cone(0.08, 0.12, 10), MAT.yellow, 0, 0.2 + 1.78, tz);
  b.add(G.box(0.52, 0.06, 0.52, 0.02), MAT.stoneDark, 0, 0.2 + 1.98, tz);
  b.add(G.pyramid(0.42, 0.62), MAT.roofSlate, 0, 0.2 + 2.0, tz);
  b.add(G.cyl(0.012, 0.012, 0.18, 4), MAT.metal, 0, 0.2 + 2.7, tz);
  b.add(G.box(0.1, 0.012, 0.012, 0.004), MAT.metal, 0, 0.2 + 2.74, tz);
  // arched door & round window
  b.add(G.box(0.24, 0.34, 0.06, 0.03), MAT.door, 0, 0.2 + 0.17, tz + 0.25);
  b.add(G.cyl(0.12, 0.12, 0.06, 12), MAT.door, 0, 0.2 + 0.34, tz + 0.25, { rx: Math.PI / 2 });
  b.add(G.box(0.36, 0.05, 0.16, 0.02), MAT.stone, 0, 0.18, tz + 0.34);
  b.add(G.cyl(0.11, 0.11, 0.05, 14), MAT.timber, 0, 0.2 + 1.1, tz + 0.25, { rx: Math.PI / 2 });
  b.add(G.cyl(0.085, 0.085, 0.05, 14), MAT.window, 0, 0.2 + 1.1, tz + 0.26, { rx: Math.PI / 2 });
  // tall side windows
  for (const sx of [-1, 1]) for (const z of [-0.35, 0.05]) windowAt(b, sx * (W / 2 + 0.01), 0.2 + 0.5, z, sx * Math.PI / 2, 0.14, 0.34);
  // little graveyard-free garden: two shrubs and a bench
  b.add(G.sphere(0.13, 1), MAT.leaf, W / 2 + 0.2, 0.12, D / 2 - 0.05);
  b.add(G.sphere(0.11, 1), MAT.leaf, -W / 2 - 0.18, 0.11, D / 2 - 0.1);
  b.add(G.box(0.34, 0.04, 0.1, 0.01), MAT.woodLight, -W / 2 - 0.2, 0.14, -0.3, { ry: Math.PI / 2 });
  return { builder: b };
}

// one tile of a wooden footbridge; rails on the sides that face up/down stream
export function bridgeModel({ railW = true, railE = true } = {}) {
  const b = new ModelBuilder();
  b.add(G.box(1.0, 0.07, 0.94, 0.02), MAT.woodLight, 0, 0, 0);
  for (let k = 0; k < 5; k++) b.add(G.box(0.98, 0.075, 0.012, 0.004), MAT.woodDark, 0, 0.002, -0.4 + k * 0.2);
  for (const sx of [-0.3, 0.3]) b.add(G.cyl(0.05, 0.05, 1.02, 8), MAT.log, sx, -0.07, 0, { rx: Math.PI / 2 });
  for (const [on, sx] of [[railW, -1], [railE, 1]]) {
    if (!on) continue;
    for (const sz of [-0.42, 0.42]) b.add(G.box(0.05, 0.3, 0.05, 0.015), MAT.timber, sx * 0.46, 0.15, sz);
    b.add(G.box(0.04, 0.04, 0.96, 0.012), MAT.timber, sx * 0.46, 0.29, 0);
    b.add(G.box(0.03, 0.03, 0.9, 0.01), MAT.timber, sx * 0.46, 0.17, 0);
  }
  return b;
}

// ---- animal homes --------------------------------------------------------------------
function picketFence(b, half, gateWidth = 0.5) {
  // low wooden fence around a square, with a gate gap at the front (+z)
  const post = (x, z) => b.add(G.box(0.05, 0.3, 0.05, 0.015), MAT.woodLight, x, 0.15, z);
  const n = Math.round(half * 2 / 0.5);
  for (let k = 0; k <= n; k++) {
    const t = -half + (k / n) * half * 2;
    post(t, -half); post(-half, t); post(half, t);
    if (Math.abs(t) > gateWidth / 2 + 0.05) post(t, half);
  }
  for (const y of [0.13, 0.25]) {
    b.add(G.box(half * 2 + 0.05, 0.035, 0.03, 0.01), MAT.woodLight, 0, y, -half);
    b.add(G.box(0.03, 0.035, half * 2 + 0.05, 0.01), MAT.woodLight, -half, y, 0);
    b.add(G.box(0.03, 0.035, half * 2 + 0.05, 0.01), MAT.woodLight, half, y, 0);
    const seg = half - gateWidth / 2;
    b.add(G.box(seg, 0.035, 0.03, 0.01), MAT.woodLight, -half + seg / 2, y, half);
    b.add(G.box(seg, 0.035, 0.03, 0.01), MAT.woodLight, half - seg / 2, y, half);
  }
}

export function coopModel(rng) {
  const b = new ModelBuilder();
  b.add(G.box(1.86, 0.06, 1.86, 0.03), MAT.soil, 0, 0.0, 0);
  // scattered straw
  for (let n = 0; n < 14; n++) b.add(G.box(0.12, 0.012, 0.02, 0.005), MAT.hay, (rng() - 0.5) * 1.5, 0.035, (rng() - 0.5) * 1.5, { ry: rng() * 3 });
  // the hen house on little legs, back-left corner
  const hx = -0.42, hz = -0.42;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.cyl(0.025, 0.025, 0.22, 5), MAT.woodDark, hx + sx * 0.28, 0.11, hz + sz * 0.2);
  b.add(G.box(0.7, 0.42, 0.52, 0.03), MAT.woodLight, hx, 0.42, hz);
  for (let r = 0; r < 3; r++) b.add(G.box(0.71, 0.012, 0.53, 0.004), MAT.woodDark, hx, 0.3 + r * 0.12, hz);
  b.add(G.roof(0.66, 0.3, 0.84, 0.04), MAT.roofRed, hx, 0.62, hz, { ry: Math.PI / 2 });
  b.add(G.box(0.14, 0.16, 0.03, 0.02), MAT.door, hx + 0.1, 0.33, hz + 0.27);
  b.add(G.box(0.12, 0.03, 0.5, 0.01), MAT.woodLight, hx + 0.1, 0.13, hz + 0.5, { rx: 0.42 });
  windowAt(b, hx - 0.18, 0.47, hz + 0.27, 0, 0.12, 0.1);
  // feed trough & water dish
  b.add(G.box(0.42, 0.08, 0.12, 0.03), MAT.woodDark, 0.45, 0.06, -0.55);
  b.add(G.box(0.36, 0.03, 0.08, 0.01), MAT.hay, 0.45, 0.1, -0.55);
  b.add(G.cyl(0.1, 0.08, 0.05, 10), MAT.metal, 0.55, 0.04, 0.35);
  b.add(G.cyl(0.085, 0.085, 0.01, 10), MAT.water, 0.55, 0.065, 0.35);
  picketFence(b, 0.94, 0.45);
  return { builder: b, keepClear: [{ x: hx, z: hz + 0.05, r: 0.5 }], house: { x: hx + 0.1, z: hz + 0.45 } };
}

export function pastureModel(kind) {
  return (rng) => {
    const b = new ModelBuilder();
    const half = 1.45;
    picketFence(b, half, 0.55);
    // a little shelter in the back-left corner
    const sx = -0.95, sz = -0.95;
    const roofMat = kind === 'cow' ? MAT.roofRed : MAT.roofMoss;
    b.add(G.box(0.06, 0.5, 0.06, 0.02), MAT.timber, sx - 0.36, 0.25, sz + 0.3);
    b.add(G.box(0.06, 0.5, 0.06, 0.02), MAT.timber, sx + 0.36, 0.25, sz + 0.3);
    b.add(G.box(0.78, 0.46, 0.05, 0.02), MAT.woodLight, sx, 0.25, sz - 0.3);
    b.add(G.box(0.05, 0.46, 0.62, 0.02), MAT.woodLight, sx - 0.38, 0.25, sz);
    b.add(G.box(0.9, 0.05, 0.78, 0.02), roofMat, sx, 0.53, sz, { rx: -0.18 });
    // hay and a water trough
    b.add(G.cyl(0.14, 0.14, 0.22, 10), MAT.hay, 0.9, 0.14, -1.0, { rz: Math.PI / 2 });
    if (kind === 'cow') b.add(G.cyl(0.14, 0.14, 0.22, 10), MAT.hay, 0.62, 0.14, -1.05, { rz: Math.PI / 2, ry: 0.4 });
    b.add(G.box(0.55, 0.14, 0.18, 0.04), MAT.woodDark, 0.85, 0.07, 0.75);
    b.add(G.box(0.48, 0.02, 0.12, 0.01), MAT.water, 0.85, 0.14, 0.75);
    // a few wildflowers in the field
    const fl = [MAT.yellow, MAT.whiteFlower, MAT.lilac];
    for (let n = 0; n < 8; n++) b.add(G.sphere(0.03, 1), fl[n % 3], (rng() - 0.5) * 2.4, 0.07, (rng() - 0.5) * 2.4);
    return { builder: b, keepClear: [{ x: sx, z: sz, r: 0.6 }, { x: 0.85, z: 0.75, r: 0.35 }, { x: 0.8, z: -1.0, r: 0.3 }] };
  };
}
