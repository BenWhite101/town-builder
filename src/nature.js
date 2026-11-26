import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, createNoise2D, smoothstep } from './noise.js';
import { seasonal } from './seasons.js';
import {
  terrainHeight, GRID, HALF, WORLD_SIZE, cellIndex, worldToCell, inBounds, LAKE, ISLAND, lakeDistance,
  streamInfo, streamZ, streamWidth, STREAM,
} from './terrain.js';

const rng = mulberry32(2024);
const forestNoise = createNoise2D(rng);
const flowerNoise = createNoise2D(rng);

export const START = { x: -4, z: 5 }; // village square, kept clear of trees

// how far (x,z) is from the brook's water edge (large when nowhere near)
function brookGap(x, z) {
  const st = streamInfo(x, z);
  return st ? st.d - st.w : 99;
}

function prep(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
  return ng;
}

function swayMaterial(timeU, params) {
  const mat = new THREE.MeshStandardMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeU;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #else
        vec4 ip = vec4(0.0);
      #endif
      float sw = sin(uTime * 1.3 + ip.x * 0.4 + ip.z * 0.3) + 0.4 * sin(uTime * 2.3 + ip.z * 0.7);
      transformed.x += sw * 0.025 * max(position.y - 0.4, 0.0);
      transformed.z += sw * 0.015 * max(position.y - 0.4, 0.0);
    `);
  };
  return mat;
}

function oakGeometries() {
  const trunk = new THREE.CylinderGeometry(0.06, 0.1, 0.75, 7);
  trunk.translate(0, 0.375, 0);
  const blobs = [
    [0, 1.0, 0, 0.46], [0.26, 0.86, 0.08, 0.32], [-0.24, 0.9, -0.08, 0.34],
    [0.05, 1.3, -0.05, 0.32], [0.04, 0.85, 0.27, 0.28], [-0.05, 0.88, -0.28, 0.27],
  ].map(([x, y, z, r]) => { const s = new THREE.IcosahedronGeometry(r, 2); s.translate(x, y, z); return prep(s); });
  return { trunk: prep(trunk), canopy: mergeGeometries(blobs) };
}

function pineGeometries() {
  const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6);
  trunk.translate(0, 0.25, 0);
  const cones = [[0.48, 0.62, 0.55], [0.38, 0.55, 0.88], [0.27, 0.48, 1.18]].map(([r, h, y]) => {
    const c = new THREE.ConeGeometry(r, h, 9); c.translate(0, y, 0); return prep(c);
  });
  return { trunk: prep(trunk), canopy: mergeGeometries(cones) };
}

export class Nature {
  constructor(scene, grid, timeU) {
    this.scene = scene;
    this.grid = grid;
    this.timeU = timeU;
    this.trees = [];
    this.animating = new Set();
    this.cellTrees = new Map();
    this.cellFlowers = new Map();
    this.cellGrass = new Map();
    this.cellRocks = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._buildTrees();
    this._buildRocks();
    this._buildFlowers();
    this._buildGrass();
    this._buildReedsAndLilies();
  }

  _canPlantAt(x, z, inPlay) {
    const h = terrainHeight(x, z);
    if (h < 0.25) return false;
    if (brookGap(x, z) < 0.9) return false;
    if (inPlay && Math.hypot(x - START.x, z - START.z) < 7.5) return false;
    return true;
  }

  _buildTrees() {
    const types = [
      { name: 'oak', geo: oakGeometries(), leaf: ['#79b04f', '#86bd57', '#6aa448', '#93c45f', '#d7b04d', '#e09a4f'] },
      { name: 'pine', geo: pineGeometries(), leaf: ['#4f8f5c', '#5b9a62', '#467f52'] },
    ];
    const spots = [];
    // forest clumps inside the valley
    for (let n = 0; n < 2600 && spots.length < 230; n++) {
      const x = (rng() - 0.5) * (GRID - 2), z = (rng() - 0.5) * (GRID - 2);
      const f = forestNoise(x * 0.06, z * 0.06) * 0.5 + 0.5;
      if (f < 0.6 || rng() > (f - 0.5) * 1.6) continue;
      if (!this._canPlantAt(x, z, true)) continue;
      if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 0.9)) continue;
      spots.push({ x, z, play: true });
    }
    // scattered lone trees
    for (let n = 0; n < 40; n++) {
      const x = (rng() - 0.5) * (GRID - 4), z = (rng() - 0.5) * (GRID - 4);
      if (this._canPlantAt(x, z, true) && lakeDistance(x, z) > 1.2) spots.push({ x, z, play: true });
    }
    // tree on the island
    spots.push({ x: ISLAND.x + 0.2, z: ISLAND.z - 0.1, play: true, force: 'oak' });
    // dense forest on the hills around the valley
    const lim = WORLD_SIZE / 2 - 4;
    for (let n = 0; n < 9000 && spots.length < 1150; n++) {
      const x = (rng() - 0.5) * 2 * lim, z = (rng() - 0.5) * 2 * lim;
      const r = Math.max(Math.abs(x), Math.abs(z));
      if (r < HALF + 1) continue;
      if (rng() > smoothstep(HALF, HALF + 9, r) * 0.95) continue;
      if (brookGap(x, z) < 1.2) continue;
      spots.push({ x, z, play: false });
    }

    const counts = [0, 0];
    for (const s of spots) {
      const pine = s.force ? 0 : (s.play ? rng() < 0.3 : rng() < 0.6) ? 1 : 0;
      s.type = pine;
      counts[pine]++;
    }
    this.treeMeshes = types.map((t, ti) => {
      const trunkMat = seasonal(new THREE.MeshStandardMaterial({ color: '#8a6243', roughness: 1 }), { snow: 0.6 });
      const leafMat = seasonal(swayMaterial(this.timeU, { color: '#ffffff', roughness: 0.9 }), { foliage: ti === 0 });
      const trunk = new THREE.InstancedMesh(t.geo.trunk, trunkMat, counts[ti]);
      const canopy = new THREE.InstancedMesh(t.geo.canopy, leafMat, counts[ti]);
      for (const m of [trunk, canopy]) {
        m.castShadow = true; m.receiveShadow = true;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(m);
      }
      return { trunk, canopy, palette: t.leaf.map((c) => new THREE.Color(c)), n: 0 };
    });
    const col = new THREE.Color();
    for (const s of spots) {
      const tm = this.treeMeshes[s.type];
      const idx = tm.n++;
      const pal = tm.palette;
      // autumn accents are rarer
      let ci = Math.floor(rng() * pal.length);
      if (s.type === 0 && ci >= 4 && rng() < 0.6) ci = Math.floor(rng() * 4);
      col.copy(pal[ci]).offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.06);
      tm.canopy.setColorAt(idx, col);
      const tree = {
        type: s.type, idx, x: s.x, z: s.z, y: terrainHeight(s.x, s.z) - 0.03,
        rot: rng() * Math.PI * 2, s: (s.play ? 0.85 : 1.0) + rng() * 0.55,
        state: 'grown', growth: 1, t: 0, shake: 0, fallDir: 0, reserved: false, timer: 0,
        play: s.play,
      };
      this.trees.push(tree);
      this._writeTree(tree);
      if (s.play) {
        const { i, j } = worldToCell(s.x, s.z);
        if (inBounds(i, j)) {
          const k = cellIndex(i, j);
          if (!this.cellTrees.has(k)) this.cellTrees.set(k, []);
          this.cellTrees.get(k).push(tree);
        }
      }
    }
    for (const tm of this.treeMeshes) tm.canopy.instanceColor.needsUpdate = true;
  }

  _writeTree(tree) {
    const tm = this.treeMeshes[tree.type];
    const m = this._m, q = this._q, v = this._v, s = this._s;
    let sc = tree.s * tree.growth;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, tree.rot);
    v.set(tree.x, tree.y, tree.z);
    if (tree.shake > 0) {
      const a = Math.sin(tree.t * 40) * 0.05 * tree.shake;
      this._axis.set(Math.cos(tree.fallDir), 0, Math.sin(tree.fallDir));
      this._q2.setFromAxisAngle(this._axis, a);
      q.premultiply(this._q2);
    }
    if (tree.state === 'falling') {
      const k = Math.min(1, tree.t / 1.3);
      const ang = k * k * Math.PI * 0.48;
      this._axis.set(Math.cos(tree.fallDir), 0, Math.sin(tree.fallDir));
      this._q2.setFromAxisAngle(this._axis, ang);
      q.premultiply(this._q2);
      const fade = smoothstep(1.4, 2.2, tree.t);
      sc *= 1 - fade;
    }
    if (tree.state === 'stump' || tree.state === 'gone') {
      // canopy hidden, trunk is a short stump (or nothing)
      s.set(0, 0, 0);
      m.compose(v, q, s);
      tm.canopy.setMatrixAt(tree.idx, m);
      const st = tree.state === 'stump' ? tree.s : 0;
      s.set(st * 1.2, st * 0.18, st * 1.2);
      m.compose(v, q, s);
      tm.trunk.setMatrixAt(tree.idx, m);
    } else {
      s.set(sc, sc, sc);
      m.compose(v, q, s);
      tm.canopy.setMatrixAt(tree.idx, m);
      tm.trunk.setMatrixAt(tree.idx, m);
    }
    tm.canopy.instanceMatrix.needsUpdate = true;
    tm.trunk.instanceMatrix.needsUpdate = true;
  }

  findTree(x, z, maxR) {
    let best = null, bd = maxR * maxR;
    for (const t of this.trees) {
      if (!t.play || t.state !== 'grown' || t.reserved || t.growth < 1) continue;
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  shakeTree(tree, amount = 1) { tree.shake = Math.max(tree.shake, amount); this.animating.add(tree); }

  fellTree(tree, dir) {
    tree.state = 'falling'; tree.t = 0; tree.fallDir = dir; tree.shake = 0;
    this.animating.add(tree);
  }

  update(dt) {
    for (const tree of this.animating) {
      tree.t += dt;
      if (tree.shake > 0) tree.shake = Math.max(0, tree.shake - dt * 2.5);
      if (tree.state === 'falling' && tree.t > 2.2) {
        tree.state = 'stump'; tree.timer = 50 + Math.random() * 50; tree.reserved = false;
      } else if (tree.state === 'growing') {
        tree.growth = Math.min(1, tree.growth + dt / 45);
        if (tree.growth >= 1) { tree.state = 'grown'; }
      }
      this._writeTree(tree);
      if ((tree.state === 'grown' && tree.shake <= 0) || tree.state === 'gone') this.animating.delete(tree);
      if (tree.state === 'stump') this.animating.delete(tree);
    }
    // regrow stumps into saplings
    this._regrowTimer = (this._regrowTimer || 0) - dt;
    if (this._regrowTimer <= 0) {
      this._regrowTimer = 1;
      for (const t of this.trees) {
        if (t.state === 'stump') {
          t.timer -= 1;
          if (t.timer <= 0) { t.state = 'growing'; t.growth = 0.12; t.t = 0; this.animating.add(t); }
        }
      }
    }
  }

  _buildRocks() {
    const geo = prep(new THREE.DodecahedronGeometry(0.3, 1));
    const spots = [];
    for (let n = 0; n < 500 && spots.length < 150; n++) {
      const lim = WORLD_SIZE / 2 - 6;
      const x = (rng() - 0.5) * 2 * lim, z = (rng() - 0.5) * 2 * lim;
      const h = terrainHeight(x, z);
      const play = Math.abs(x) < HALF && Math.abs(z) < HALF;
      if (play && (Math.hypot(x - START.x, z - START.z) < 7 || rng() < 0.5)) continue;
      if (h < 0.05 && lakeDistance(x, z) < 0.85) continue;
      if (brookGap(x, z) < 0.6) continue;
      const cluster = 1 + Math.floor(rng() * 3);
      for (let c = 0; c < cluster; c++) {
        spots.push({ x: x + (rng() - 0.5) * 0.8, z: z + (rng() - 0.5) * 0.8, s: (0.4 + rng() * 0.9) * (c ? 0.6 : 1), play });
      }
    }
    // smooth pebbles along the brook banks
    for (let x = -44; x < STREAM.x1 - 2; x += 0.9) {
      if (rng() < 0.45) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const z = streamZ(x) + side * (streamWidth(x) + 0.15 + rng() * 0.5);
      spots.push({ x, z, s: 0.25 + rng() * 0.3, play: Math.abs(x) < HALF && Math.abs(z) < HALF });
    }
    const mat = seasonal(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: false }));
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const col = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    this.rockMatrices = [];
    spots.forEach((s, i) => {
      e.set(rng() * 0.4, rng() * 6.28, rng() * 0.4);
      q.setFromEuler(e);
      (this.rockOff ||= [])[i] = 0.05 * s.s;
      m.compose(new THREE.Vector3(s.x, terrainHeight(s.x, s.z) - 0.05 * s.s, s.z), q, new THREE.Vector3(s.s, s.s * 0.6, s.s * 0.9));
      mesh.setMatrixAt(i, m);
      this.rockMatrices.push(m.clone());
      col.setHSL(0.09 + rng() * 0.04, 0.08, 0.6 + rng() * 0.12);
      mesh.setColorAt(i, col);
      if (s.play) this._addCell(this.cellRocks, s.x, s.z, i);
    });
    this.rocks = mesh;
    this.scene.add(mesh);
  }

  _addCell(map, x, z, idx) {
    const { i, j } = worldToCell(x, z);
    if (!inBounds(i, j)) return;
    const k = cellIndex(i, j);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(idx);
  }

  _buildFlowers() {
    const head = prep(new THREE.IcosahedronGeometry(0.045, 1));
    head.translate(0, 0.16, 0);
    const stem = prep(new THREE.CylinderGeometry(0.006, 0.008, 0.16, 3));
    stem.translate(0, 0.08, 0);
    const palette = ['#fff7ef', '#ffd6e0', '#f7a8b8', '#ffe27a', '#c9b6f2', '#9fc5ff', '#ffb36b'].map((c) => new THREE.Color(c));
    const spots = [];
    for (let n = 0; n < 4000 && spots.length < 1400; n++) {
      const lim = HALF + 6;
      const x = (rng() - 0.5) * 2 * lim, z = (rng() - 0.5) * 2 * lim;
      const f = flowerNoise(x * 0.09, z * 0.09);
      if (f < 0.25) continue;
      if (terrainHeight(x, z) < 0.3 || brookGap(x, z) < 0.5) continue;
      const pc = palette[Math.floor((flowerNoise(x * 0.03 + 50, z * 0.03) * 0.5 + 0.5) * palette.length) % palette.length];
      const k = 2 + Math.floor(rng() * 5);
      for (let c = 0; c < k; c++) spots.push({ x: x + (rng() - 0.5) * 0.7, z: z + (rng() - 0.5) * 0.7, c: rng() < 0.85 ? pc : palette[Math.floor(rng() * palette.length)] });
    }
    const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, emissive: '#ffffff', emissiveIntensity: 0.06 });
    const stemMat = seasonal(new THREE.MeshStandardMaterial({ color: '#5f9a45', roughness: 1 }), { grass: true });
    const heads = new THREE.InstancedMesh(head, headMat, spots.length);
    const stems = new THREE.InstancedMesh(stem, stemMat, spots.length);
    const m = new THREE.Matrix4();
    this.flowerMatrices = new Float32Array(spots.length * 16);
    spots.forEach((s, i) => {
      const sc = 0.7 + rng() * 0.6;
      m.makeScale(sc, sc, sc).setPosition(s.x, terrainHeight(s.x, s.z) - 0.01, s.z);
      heads.setMatrixAt(i, m); stems.setMatrixAt(i, m);
      m.toArray(this.flowerMatrices, i * 16);
      heads.setColorAt(i, s.c);
      this._addCell(this.cellFlowers, s.x, s.z, i);
    });
    heads.castShadow = false;
    this.flowerHeads = heads; this.flowerStems = stems;
    this.scene.add(heads, stems);
  }

  _buildGrass() {
    // one blade: 5 verts, tapered, vertex-colour gradient from root to tip, normals point up
    const w = 0.045, h = 1;
    const pos = [-w, 0, 0, w, 0, 0, -w * 0.62, h * 0.5, 0, w * 0.62, h * 0.5, 0, 0, h, 0];
    const idx = [0, 1, 2, 1, 3, 2, 2, 3, 4];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([0.62, 0.7, 0.55, 0.62, 0.7, 0.55, 0.86, 0.9, 0.8, 0.86, 0.9, 0.8, 1.05, 1.08, 0.95], 3));
    g.setIndex(idx);

    const blades = [];
    const lim = HALF + 10;
    const pushCell = (cx, cz, n, play) => {
      for (let b = 0; b < n; b++) {
        const x = cx + rng() - 0.5, z = cz + rng() - 0.5;
        const ht = terrainHeight(x, z);
        if (ht < 0.22 || brookGap(x, z) < 0.25) continue;
        if (Math.max(Math.abs(x), Math.abs(z)) > HALF + 3 && ht > 2.6) continue;
        blades.push({ x, z, y: ht, play });
      }
    };
    for (let j = -lim; j < lim; j++) for (let i = -lim; i < lim; i++) {
      const cx = i + 0.5, cz = j + 0.5;
      const play = Math.abs(cx) < HALF && Math.abs(cz) < HALF;
      const dense = flowerNoise(cx * 0.05 + 20, cz * 0.05) * 0.5 + 0.5;
      pushCell(cx, cz, play ? Math.floor(8 + dense * 10) : 5, play);
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeU;
      shader.vertexShader = 'uniform float uTime;\nuniform float uSnow;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        transformed.y *= 1.0 - uSnow * 0.55; // grass hunkers down under the snow
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sw = sin(uTime * 1.7 + ip.x * 0.45 + ip.z * 0.3) * 0.6 + sin(uTime * 3.1 + ip.x * 1.3 - ip.z * 0.8) * 0.25;
        float bend = position.y * position.y;
        transformed.x += sw * 0.22 * bend;
        transformed.z += sw * 0.12 * bend;
      `);
      // light both sides of the blade like the ground beneath it (no dark back faces)
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
    };
    seasonal(mat, { grass: true });
    const mesh = new THREE.InstancedMesh(g, mat, blades.length);
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const base = new THREE.Color('#8fc35e'), alt = new THREE.Color('#b5d36a'), dk = new THREE.Color('#6fa84e');
    blades.forEach((b, i) => {
      const hgt = 0.18 + rng() * 0.22;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI);
      const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rng() - 0.5) * 0.5);
      q.multiply(lean);
      m.compose(new THREE.Vector3(b.x, b.y - 0.02, b.z), q, new THREE.Vector3(1 + rng() * 0.5, hgt, 1));
      mesh.setMatrixAt(i, m);
      col.copy(base).lerp(alt, rng() * 0.7).lerp(dk, rng() * 0.4);
      mesh.setColorAt(i, col);
      if (b.play) this._addCell(this.cellGrass, b.x, b.z, i);
    });
    this.grassOrig = new Float32Array(mesh.instanceMatrix.array);
    this.grass = mesh;
    this.scene.add(mesh);
  }

  _buildReedsAndLilies() {
    // reeds around the shore
    const reed = prep(new THREE.CylinderGeometry(0.012, 0.02, 1, 4));
    reed.translate(0, 0.5, 0);
    const cat = prep(new THREE.CapsuleGeometry(0.025, 0.08, 2, 6));
    cat.translate(0, 1.0, 0);
    const spots = [];
    for (let n = 0; n < 4000 && spots.length < 260; n++) {
      const a = rng() * Math.PI * 2, r = 0.7 + rng() * 0.5;
      const x = LAKE.x + Math.cos(a) * LAKE.rx * r, z = LAKE.z + Math.sin(a) * LAKE.rz * r;
      const h = terrainHeight(x, z);
      if (h > -0.18 && h < 0.12) {
        const k = 3 + Math.floor(rng() * 4);
        for (let c = 0; c < k; c++) spots.push({ x: x + (rng() - 0.5) * 0.4, z: z + (rng() - 0.5) * 0.4 });
      }
    }
    for (let x = -46; x < STREAM.x1 - 1; x += 0.35) {
      if (rng() > 0.4) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const z = streamZ(x) + side * (streamWidth(x) + 0.1 + rng() * 0.35);
      const k = 2 + Math.floor(rng() * 4);
      for (let c = 0; c < k; c++) spots.push({ x: x + (rng() - 0.5) * 0.4, z: z + (rng() - 0.5) * 0.25 });
    }
        const reedMat = seasonal(swayMaterial(this.timeU, { color: '#7aa457', roughness: 1 }), { grass: true, snow: 0.6 });
    const catMat = new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 1 });
    const reeds = new THREE.InstancedMesh(reed, reedMat, spots.length);
    const cats = new THREE.InstancedMesh(cat, catMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach((s, i) => {
      const hh = 0.45 + rng() * 0.4;
      e.set((rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25); q.setFromEuler(e);
      m.compose(new THREE.Vector3(s.x, terrainHeight(s.x, s.z), s.z), q, new THREE.Vector3(1, hh, 1));
      reeds.setMatrixAt(i, m);
      if (rng() < 0.45) cats.setMatrixAt(i, m); else cats.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    });
    reeds.castShadow = true;
    this.scene.add(reeds, cats);

    // lily pads
    const pad = new THREE.CircleGeometry(0.22, 14, 0.25, Math.PI * 2 - 0.5);
    pad.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({ color: '#6ea94f', roughness: 0.7, side: THREE.DoubleSide });
    const flower = prep(new THREE.ConeGeometry(0.07, 0.08, 6));
    flower.translate(0, 0.04, 0);
    const flowerMat = new THREE.MeshStandardMaterial({ color: '#ffd4e4', roughness: 0.6, emissive: '#ffb0c8', emissiveIntensity: 0.1 });
    const lilies = [];
    for (let n = 0; n < 2000 && lilies.length < 34; n++) {
      const x = LAKE.x + (rng() - 0.5) * LAKE.rx * 1.8, z = LAKE.z + (rng() - 0.5) * LAKE.rz * 1.8;
      const h = terrainHeight(x, z);
      if (h < -0.35 && h > -1.2 && flowerNoise(x * 0.25, z * 0.25) > 0.0) lilies.push({ x, z });
    }
    const pads = new THREE.InstancedMesh(pad, padMat, lilies.length);
    const flowers = new THREE.InstancedMesh(flower, flowerMat, lilies.length);
    this.lilies = lilies.map((l, i) => {
      const s = 0.7 + rng() * 0.6, r = rng() * 6.28;
      return { ...l, s, r, i, f: rng() < 0.35, ph: rng() * 10 };
    });
    this.pads = pads; this.lilyFlowers = flowers;
    pads.receiveShadow = true;
    this.scene.add(pads, flowers);
    this.updateLilies(0);
  }

  // the ground moved (a building settled): keep grass, flowers, rocks and trees sitting on it
  resettle(x0, z0, x1, z1) {
    const ga = this.grass.instanceMatrix.array, go = this.grassOrig;
    const fh = this.flowerHeads.instanceMatrix.array, fs = this.flowerStems.instanceMatrix.array, fm = this.flowerMatrices;
    const ra = this.rocks.instanceMatrix.array;
    for (let j = Math.max(0, Math.floor(z0 + HALF)); j <= Math.min(GRID - 1, Math.floor(z1 + HALF)); j++) {
      for (let i = Math.max(0, Math.floor(x0 + HALF)); i <= Math.min(GRID - 1, Math.floor(x1 + HALF)); i++) {
        const k = cellIndex(i, j);
        for (const g of this.cellGrass.get(k) || []) {
          const o = g * 16, y = terrainHeight(go[o + 12], go[o + 14]) - 0.02;
          go[o + 13] = y;
          if (ga[o + 15] !== 0) ga[o + 13] = y;
        }
        for (const f of this.cellFlowers.get(k) || []) {
          const o = f * 16, y = terrainHeight(fm[o + 12], fm[o + 14]) - 0.01;
          fm[o + 13] = y;
          if (fh[o + 15] !== 0) { fh[o + 13] = y; fs[o + 13] = y; }
        }
        for (const r of this.cellRocks.get(k) || []) {
          const m = this.rockMatrices[r].elements;
          m[13] = terrainHeight(m[12], m[14]) - this.rockOff[r];
          if (ra[r * 16 + 15] !== 0) ra[r * 16 + 13] = m[13];
        }
        for (const t of this.cellTrees.get(k) || []) { t.y = terrainHeight(t.x, t.z) - 0.03; this._writeTree(t); }
      }
    }
    this.grass.instanceMatrix.needsUpdate = true;
    this.flowerHeads.instanceMatrix.needsUpdate = this.flowerStems.instanceMatrix.needsUpdate = true;
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  setSeason(st) {
    this.flowerHeads.visible = this.flowerStems.visible = st.flowers > 0.3;
    this.pads.visible = this.lilyFlowers.visible = st.ice < 0.5;
    this.lilyFlowers.visible = this.lilyFlowers.visible && st.flowers > 0.3;
  }

  randomTreeNear(x, z, r) {
    for (let k = 0; k < 6; k++) {
      const t = this.trees[Math.floor(Math.random() * this.trees.length)];
      if (t.type === 0 && t.state === 'grown' && (t.x - x) ** 2 + (t.z - z) ** 2 < r * r) return t;
    }
    return null;
  }

  updateLilies(time) {
    const m = this._m, q = this._q, v = this._v, s = this._s;
    for (const l of this.lilies) {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, l.r + Math.sin(time * 0.2 + l.ph) * 0.15);
      v.set(l.x + Math.sin(time * 0.13 + l.ph) * 0.06, 0.015 + Math.sin(time * 1.2 + l.ph) * 0.006, l.z);
      s.set(l.s, 1, l.s);
      m.compose(v, q, s);
      this.pads.setMatrixAt(l.i, m);
      if (l.f) { v.y += 0.01; s.set(l.s, l.s, l.s); m.compose(v, q, s); } else m.makeScale(0, 0, 0);
      this.lilyFlowers.setMatrixAt(l.i, m);
    }
    this.pads.instanceMatrix.needsUpdate = true;
    this.lilyFlowers.instanceMatrix.needsUpdate = true;
  }

  // Building or path placed: hide decoration on a cell. Returns wood from cleared trees.
  clearCell(i, j, { keepGrass = false } = {}) {
    const k = cellIndex(i, j);
    let wood = 0;
    for (const t of this.cellTrees.get(k) || []) {
      if (t.state !== 'gone') { if (t.state === 'grown') wood += 1; t.state = 'gone'; t.reserved = false; this._writeTree(t); }
    }
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const f of this.cellFlowers.get(k) || []) { this.flowerHeads.setMatrixAt(f, z); this.flowerStems.setMatrixAt(f, z); }
    this.flowerHeads.instanceMatrix.needsUpdate = this.flowerStems.instanceMatrix.needsUpdate = true;
    for (const r of this.cellRocks.get(k) || []) this.rocks.setMatrixAt(r, z);
    this.rocks.instanceMatrix.needsUpdate = true;
    if (!keepGrass) this.setGrass(i, j, false);
    return wood;
  }

  setGrass(i, j, on) {
    const arr = this.grass.instanceMatrix.array;
    for (const g of this.cellGrass.get(cellIndex(i, j)) || []) {
      for (let c = 0; c < 16; c++) arr[g * 16 + c] = on ? this.grassOrig[g * 16 + c] : 0;
    }
    this.grass.instanceMatrix.needsUpdate = true;
  }

  // when demolished, let flowers & grass come back (trees regrow naturally from saplings)
  restoreCell(i, j) {
    const k = cellIndex(i, j);
    const m = new THREE.Matrix4();
    for (const f of this.cellFlowers.get(k) || []) {
      m.fromArray(this.flowerMatrices, f * 16);
      this.flowerHeads.setMatrixAt(f, m); this.flowerStems.setMatrixAt(f, m);
    }
    this.flowerHeads.instanceMatrix.needsUpdate = this.flowerStems.instanceMatrix.needsUpdate = true;
    for (const r of this.cellRocks.get(k) || []) this.rocks.setMatrixAt(r, this.rockMatrices[r]);
    this.rocks.instanceMatrix.needsUpdate = true;
    for (const t of this.cellTrees.get(k) || []) {
      if (t.state === 'gone') { t.state = 'stump'; t.timer = 30 + Math.random() * 40; this._writeTree(t); }
    }
    this.setGrass(i, j, true);
  }
}

