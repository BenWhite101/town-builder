import * as THREE from 'three';
import {
  cottageModel, storehouseModel, farmModel, woodcutterModel, fisheryModel, wellModel, gardenModel, lanternModel,
  bakeryModel, marketModel, chapelModel, cropGeometry, MAT,
} from './models.js';
import { GRID, HALF, cellIndex, inBounds, cellCenter, terrainHeight, WATER_LEVEL } from './terrain.js';
import { mulberry32, easeOutBack, smoothstep } from './noise.js';
import { seasonal } from './seasons.js';

export const DEFS = {
  path:       { name: 'Path', icon: '👣', size: 1, cost: 0, key: '1', desc: 'Soft dirt paths. Villagers walk faster on them. Click & drag to paint. Paint across the brook to build a little bridge (2 🪵 each).' },
  cottage:    { name: 'Cottage', icon: '🏡', size: 2, cost: 10, key: '2', capacity: 3, model: cottageModel, desc: 'A snug home for up to 3 villagers. New families move in over time.' },
  farm:       { name: 'Wheat Farm', icon: '🌾', size: 3, cost: 8, key: '3', workers: 2, walkable: true, model: farmModel, desc: 'Two farmers grow wheat. It becomes food at the storehouse – or much more food at a bakery.' },
  woodcutter: { name: 'Woodcutter', icon: '🪓', size: 2, cost: 5, key: '4', workers: 1, model: woodcutterModel, desc: 'Fells nearby trees for wood. Stumps slowly grow back.' },
  fishery:    { name: 'Fishing Hut', icon: '🎣', size: 2, cost: 8, key: '5', workers: 1, needsWater: true, model: fisheryModel, desc: 'A fisher casts a line from the shore. Build it beside the lake or the brook.' },
  bakery:     { name: 'Bakery', icon: '🥖', size: 2, cost: 12, key: '6', workers: 1, cosy: 3, model: bakeryModel, desc: 'Farmers bring their wheat here and the baker turns every 5 wheat into 9 bread.' },
  market:     { name: 'Market', icon: '🧺', size: 3, cost: 14, key: '7', workers: 1, walkable: true, cosy: 4, cosyStaffed: 10, model: marketModel, desc: 'Villagers love a browse. The stallholder trades spare food with passing merchants for wood.' },
  chapel:     { name: 'Chapel', icon: '🔔', size: 2, cost: 16, key: '8', cosy: 14, model: chapelModel, desc: 'Its bell rings at dawn and dusk, and villagers gather there in the evening. Very cosy.' },
  well:       { name: 'Well', icon: '🪣', size: 1, cost: 4, key: '9', cosy: 8, model: wellModel, desc: 'Villagers love to gather here. Adds cosiness.' },
  garden:     { name: 'Flower Bed', icon: '🌷', size: 1, cost: 1, key: '0', cosy: 3, model: gardenModel, desc: 'A little patch of flowers. Adds cosiness.' },
  lantern:    { name: 'Lantern', icon: '🏮', size: 1, cost: 2, key: 'l', cosy: 2, model: lanternModel, desc: 'Glows warmly through the night. Adds cosiness.' },
  storehouse: { name: 'Storehouse', icon: '🏠', size: 3, cost: 0, capacity: 3, model: storehouseModel, desc: 'The heart of the village. Goods are brought here.', fixed: true },
};
export const TOOL_ORDER = ['path', 'cottage', 'farm', 'woodcutter', 'fishery', 'bakery', 'market', 'chapel', 'well', 'garden', 'lantern'];

let nextId = 1;

export class Buildings {
  constructor(scene, grid, terrain, nature, particles, audio) {
    this.scene = scene; this.grid = grid; this.terrain = terrain; this.nature = nature;
    this.particles = particles; this.audio = audio;
    this.list = [];
    this.byId = new Map();
    this.cropGeo = cropGeometry();
    this.cropMat = seasonal(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), { snow: 0.7 });
    this.ghostMat = new THREE.MeshStandardMaterial({ color: '#bff0a8', transparent: true, opacity: 0.55, roughness: 0.6, emissive: '#7fd36b', emissiveIntensity: 0.25, depthWrite: false });
    this.ghostBad = new THREE.Color('#ff9a8a');
    this.ghostGood = new THREE.Color('#bff0a8');
    this.ghostCache = new Map();
    this.flagGeo = new THREE.PlaneGeometry(0.42, 0.26, 8, 1);
    this.flagGeo.translate(0.21, 0, 0);
    this.flagMat = new THREE.MeshStandardMaterial({ color: '#d9574a', side: THREE.DoubleSide, roughness: 0.8 });
    this.lanternGlow = [];
  }

  footprint(type, i, j) {
    // i,j is the cell under the cursor; footprint is centred on it
    const s = DEFS[type].size;
    const o = Math.floor((s - 1) / 2);
    const cells = [];
    for (let dj = 0; dj < s; dj++) for (let di = 0; di < s; di++) cells.push([i - o + di, j - o + dj]);
    return cells;
  }

  footprintCenter(type, i, j) {
    const s = DEFS[type].size;
    const o = Math.floor((s - 1) / 2);
    return { x: i - o - HALF + s / 2, z: j - o - HALF + s / 2 };
  }

  canPlace(type, i, j) {
    const def = DEFS[type];
    const cells = this.footprint(type, i, j);
    let mn = Infinity, mx = -Infinity;
    for (const [ci, cj] of cells) {
      if (!inBounds(ci, cj)) return { ok: false, why: 'Out of bounds' };
      const k = cellIndex(ci, cj);
      if (this.grid.water[k]) return { ok: false, why: 'Too wet here' };
      if (this.grid.occ[k] !== -1) return { ok: false, why: 'Something is already here' };
      mn = Math.min(mn, this.grid.h[k]); mx = Math.max(mx, this.grid.h[k]);
      if (this.grid.slope[k] > 0.6) return { ok: false, why: 'Too steep' };
    }
    if (mx - mn > 0.75) return { ok: false, why: 'Too steep' };
    if (def.needsWater) {
      const s = def.size; const o = Math.floor((s - 1) / 2);
      let near = false;
      for (let dj = -2; dj < s + 2 && !near; dj++) for (let di = -2; di < s + 2; di++) {
        const ci = i - o + di, cj = j - o + dj;
        if (inBounds(ci, cj) && this.grid.water[cellIndex(ci, cj)]) { near = true; break; }
      }
      if (!near) return { ok: false, why: 'Must be next to the lake' };
    }
    return { ok: true };
  }

  getGhost(type) {
    if (!this.ghostCache.has(type)) {
      const def = DEFS[type];
      const { builder } = def.model(mulberry32(7));
      const mesh = builder.buildGhost(this.ghostMat);
      const g = new THREE.Group();
      g.add(mesh);
      // footprint plate
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(def.size - 0.06, def.size - 0.06), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false }));
      plate.rotation.x = -Math.PI / 2; plate.position.y = 0.06; plate.renderOrder = 4;
      g.add(plate);
      g.userData.plate = plate;
      this.ghostCache.set(type, g);
    }
    return this.ghostCache.get(type);
  }

  baseHeight(cells) {
    let sum = 0, mx = -Infinity;
    for (const [ci, cj] of cells) {
      const c = cellCenter(ci, cj);
      for (const [ox, oz] of [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
        const h = terrainHeight(c.x + ox, c.z + oz);
        sum += h; mx = Math.max(mx, h);
      }
    }
    const avg = sum / (cells.length * 5);
    return Math.max(WATER_LEVEL + 0.1, avg * 0.6 + mx * 0.4 - 0.02);
  }

  place(type, i, j, rot = 0, { instant = false, seed } = {}) {
    const def = DEFS[type];
    const cells = this.footprint(type, i, j);
    const id = nextId++;
    const rng = mulberry32(seed ?? Math.floor(Math.random() * 1e9));
    const made = def.model(rng);
    const group = made.builder.build();
    const c = this.footprintCenter(type, i, j);
    const y = this.baseHeight(cells);
    const root = new THREE.Group();
    root.position.set(c.x, y, c.z);
    root.rotation.y = rot * Math.PI / 2;
    root.add(group);
    this.scene.add(root);

    const b = {
      id, type, def, i, j, rot, cells, root, model: group, x: c.x, z: c.z, y,
      workers: [], residents: [], anim: instant ? 1 : 0, removing: -1, seed: seed ?? 0,
      smokeT: Math.random() * 2,
    };
    if (made.chimney) b.chimney = made.chimney;
    if (made.flag) {
      const flag = new THREE.Mesh(this.flagGeo.clone(), this.flagMat);
      flag.position.copy(made.flag);
      flag.castShadow = true;
      group.add(flag);
      b.flag = flag;
      b.flagBase = this.flagGeo.attributes.position.array.slice();
    }
    if (made.light) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffc77a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.copy(made.light);
      group.add(glow);
      b.glow = glow;
    }
    if (type === 'farm') this._setupFarm(b);
    if (type === 'bakery') b.stock = 0;
    let wood = 0;
    for (const [ci, cj] of cells) {
      const k = cellIndex(ci, cj);
      this.grid.occ[k] = id;
      if (this.grid.path[k]) { this.grid.path[k] = 0; this.terrain.setPath(ci, cj, false); }
      wood += this.nature.clearCell(ci, cj);
    }
    b.entrance = this._entrance(b);
    if (type === 'fishery') b.shore = this._shoreSpot(b);
    this.list.push(b);
    this.byId.set(id, b);
    if (!instant) {
      this.audio?.pop(c.x, c.z, def.size);
      this._dust(c.x, y, c.z, def.size);
    }
    root.scale.setScalar(instant ? 1 : 0.001);
    return { b, wood };
  }

  _setupFarm(b) {
    const rows = 5, cols = 7;
    const mesh = new THREE.InstancedMesh(this.cropGeo, this.cropMat, rows * cols);
    mesh.castShadow = true; mesh.receiveShadow = true;
    b.model.add(mesh);
    b.crops = { mesh, rows, cols, growth: 0.15, shown: -1, rng: mulberry32(b.id * 99) };
    b.crops.jitter = Array.from({ length: rows * cols }, () => [(b.crops.rng() - 0.5) * 0.12, (b.crops.rng() - 0.5) * 0.08, 0.8 + b.crops.rng() * 0.4, b.crops.rng() * 6]);
    this._updateCrops(b, true);
  }

  _updateCrops(b, force) {
    const c = b.crops;
    const g = Math.round(c.growth * 60) / 60;
    if (!force && g === c.shown) return;
    c.shown = g;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const green = new THREE.Color('#7fb54e'), gold = new THREE.Color('#efc357');
    let n = 0;
    for (let r = 0; r < c.rows; r++) for (let k = 0; k < c.cols; k++) {
      const [jx, jz, js, jr] = c.jitter[n];
      const x = -1.15 + k * (2.3 / (c.cols - 1)) + jx;
      const z = -1.0 + r * 0.5 + jz;
      const s = (0.25 + g * 0.85) * js;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, jr);
      m.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(s, s, s));
      c.mesh.setMatrixAt(n, m);
      col.copy(green).lerp(gold, smoothstep(0.45, 0.95, g));
      c.mesh.setColorAt(n, col);
      n++;
    }
    c.mesh.instanceMatrix.needsUpdate = true;
    if (c.mesh.instanceColor) c.mesh.instanceColor.needsUpdate = true;
  }

  // the walkable cell just outside the door
  _entrance(b) {
    const s = b.def.size, o = Math.floor((s - 1) / 2);
    const i0 = b.i - o, j0 = b.j - o;
    const mid = Math.floor((s - 1) / 2);
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // rot 0 => +z, rot 1 => +x (rotation.y = +90° turns +z to +x)
    const [di, dj] = dirs[b.rot % 4];
    let ci, cj;
    if (dj === 1) { ci = i0 + mid + (s % 2 === 0 ? 0 : 0); cj = j0 + s; }
    else if (dj === -1) { ci = i0 + (s - 1 - mid); cj = j0 - 1; }
    else if (di === 1) { ci = i0 + s; cj = j0 + (s - 1 - mid); }
    else { ci = i0 - 1; cj = j0 + mid; }
    if (inBounds(ci, cj) && !this.grid.water[cellIndex(ci, cj)] && this.grid.occ[cellIndex(ci, cj)] === -1) return { i: ci, j: cj };
    return this.nearestFree(b);
  }

  nearestFree(b) {
    const s = b.def.size, o = Math.floor((s - 1) / 2);
    let best = null, bd = Infinity;
    for (let r = 1; r < 4 && !best; r++) {
      for (let dj = -r; dj < s + r; dj++) for (let di = -r; di < s + r; di++) {
        const ci = b.i - o + di, cj = b.j - o + dj;
        if (!inBounds(ci, cj)) continue;
        const k = cellIndex(ci, cj);
        if (this.grid.water[k] || this.grid.occ[k] !== -1) continue;
        const c = cellCenter(ci, cj);
        const d = (c.x - b.x) ** 2 + (c.z - b.z) ** 2;
        if (d < bd) { bd = d; best = { i: ci, j: cj }; }
      }
    }
    return best || { i: b.i, j: b.j };
  }

  _shoreSpot(b) {
    let best = null, bd = Infinity;
    for (let dj = -5; dj <= 5; dj++) for (let di = -5; di <= 5; di++) {
      const ci = b.i + di, cj = b.j + dj;
      if (!inBounds(ci, cj)) continue;
      const k = cellIndex(ci, cj);
      if (this.grid.water[k] || this.grid.occ[k] !== -1) continue;
      // must touch water
      let w = null;
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inBounds(ci + a, cj + c) && this.grid.water[cellIndex(ci + a, cj + c)]) { w = [a, c]; break; }
      if (!w) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = { i: ci, j: cj, wx: w[0], wz: w[1] }; }
    }
    return best;
  }

  refreshEntrances() {
    for (const b of this.list) {
      const e = b.entrance;
      if (!e || this.grid.occ[cellIndex(e.i, e.j)] !== -1) b.entrance = this._entrance(b);
      if (b.type === 'fishery') {
        const s = b.shore;
        if (!s || this.grid.occ[cellIndex(s.i, s.j)] !== -1) b.shore = this._shoreSpot(b);
      }
    }
  }

  remove(b) {
    if (b.removing >= 0) return;
    b.removing = 0;
    for (const [ci, cj] of b.cells) {
      this.grid.occ[cellIndex(ci, cj)] = -1;
      this.nature.restoreCell(ci, cj);
    }
    this.list = this.list.filter((x) => x !== b);
    this.byId.delete(b.id);
    (this.dying ||= []).push(b);
    this._dust(b.x, b.y, b.z, b.def.size);
    this.audio?.poof(b.x, b.z);
    this.refreshEntrances();
  }

  _dust(x, y, z, size) {
    const col = new THREE.Color('#f1e6d2');
    const n = 10 + size * 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = size * 0.55;
      this.particles.spawn({
        x: x + Math.cos(a) * r, y: y + 0.1, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * (1 + Math.random()), vy: 0.4 + Math.random() * 0.6, vz: Math.sin(a) * (1 + Math.random()),
        life: 0.9 + Math.random() * 0.5, size: 0.35 + Math.random() * 0.3, grow: 0.5, color: col, alpha: 0.7, drag: 3,
      });
    }
  }

  cosyOf(b) { return b.def.cosyStaffed && b.workers.length ? b.def.cosyStaffed : (b.def.cosy || 0); }

  get cosy() {
    let c = 0;
    for (const b of this.list) c += this.cosyOf(b);
    return c;
  }

  update(dt, time, night) {
    if (this.dying?.length) {
      this.dying = this.dying.filter((b) => {
        b.removing += dt / 0.35;
        const k = Math.min(1, b.removing);
        const s = 1 - k * k;
        b.root.scale.set(s * (1 + k * 0.2), Math.max(0.001, s), s * (1 + k * 0.2));
        if (k >= 1) {
          this.scene.remove(b.root);
          b.root.traverse((o) => { if (o.isMesh && o.geometry !== this.cropGeo) o.geometry.dispose(); });
          return false;
        }
        return true;
      });
    }
    for (const b of this.list) {
      if (b.anim < 1) {
        b.anim = Math.min(1, b.anim + dt / 0.65);
        const s = easeOutBack(b.anim);
        b.root.scale.set(s, Math.max(0.001, s * (1 + Math.sin(b.anim * Math.PI) * 0.12)), s);
      }
      if (b.crops) this._updateCrops(b);
      if (b.flag) {
        const p = b.flag.geometry.attributes.position;
        for (let v = 0; v < p.count; v++) {
          const bx = b.flagBase[v * 3];
          p.setZ(v, Math.sin(bx * 12 - time * 4) * 0.04 * bx * 2.4);
        }
        p.needsUpdate = true;
      }
      if (b.glow) b.glow.material.opacity = night * (0.35 + Math.sin(time * 3 + b.id) * 0.04);
      if (b.chimney && b.anim >= 1) {
        b.smokeT -= dt;
        const active = b.type === 'cottage' ? (b.residents.length > 0 ? 1 : 0.15) : (b.workers.length ? 0.6 : 0);
        if (b.smokeT <= 0 && active > 0) {
          b.smokeT = (0.55 + Math.random() * 0.5) / active;
          const wp = b.chimney.clone().applyMatrix4(b.root.matrixWorld);
          const g = 0.85 + Math.random() * 0.1;
          this.particles.spawn({
            x: wp.x, y: wp.y, z: wp.z, vx: 0.12, vy: 0.45 + Math.random() * 0.15, vz: 0.05,
            life: 4 + Math.random() * 2, size: 0.18, grow: 0.22, color: new THREE.Color(g, g, g * 0.98), alpha: 0.42, drag: 0.15, wobble: 0.15,
          });
        }
      }
    }
  }

  // Scale the ghost colour/visibility; called from main each frame
  windowGlow(night) {
    MAT.window.emissiveIntensity = night * 2.6;
    MAT.glow.emissiveIntensity = 0.2 + night * 4;
  }
}

export { GRID };
