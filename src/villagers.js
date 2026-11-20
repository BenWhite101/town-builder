import * as THREE from 'three';
import { VILLAGER_GEO as VG, MAT } from './models.js';
import { findPath, smoothPath } from './pathfinding.js';
import {
  GRID, cellIndex, inBounds, cellCenter, worldToCell, terrainHeight, WATER_LEVEL,
} from './terrain.js';
import { damp } from './noise.js';

const NAMES = ['Elsie', 'Wren', 'Tobias', 'Maud', 'Hal', 'Ivy', 'Rowan', 'Bram', 'Pip', 'Agnes', 'Fern', 'Odo', 'Rosalind', 'Edmund',
  'Clover', 'Ned', 'Hazel', 'Barnaby', 'Mabel', 'Alder', 'Juniper', 'Gilbert', 'Winnie', 'Tamsin', 'Osric', 'Linnea', 'Basil', 'Poppy',
  'Willa', 'Cedric', 'Marigold', 'Finch', 'Hugo', 'Ada', 'Merry', 'Godwin', 'Bryony', 'Elric', 'Nell', 'Thistle', 'Perry', 'Dot',
  'Jory', 'Sorrel', 'Amos', 'Briar', 'Kit', 'Lark', 'Oswin', 'Primrose'];
const TUNICS = ['#d9705a', '#6e9ccf', '#8cb369', '#e3b85f', '#b78bc4', '#e8a0a8', '#c98d5a', '#5fa8a0', '#d6865b', '#7f9fb8'];
const SKINS = ['#f5d0b0', '#ebbd98', '#d39f78', '#a8714d', '#f2c9a5', '#8a5a3c'];
const HAIRS = ['#5a3b26', '#2f2420', '#c08a4a', '#e2c47e', '#8a3b22', '#a7a29c', '#3d2b1f'];
export const JOB_LABEL = { farm: 'Farmer', woodcutter: 'Woodcutter', fishery: 'Fisher' };

const matCache = new Map();
const mat = (c, extra) => {
  const k = c + (extra ? JSON.stringify(extra) : '');
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...extra }));
  return matCache.get(k);
};
const HAT_MATS = { farm: mat('#e8c56a'), woodcutter: mat('#c4513f'), fishery: mat('#4f79b5') };
const CARRY_MATS = { wood: MAT.log, wheat: mat('#efc357'), fish: mat('#ff9a4d', { emissive: '#ff9a4d', emissiveIntensity: 0.1 }) };

let nameIdx = Math.floor(Math.random() * NAMES.length);
let vid = 1;

const isNightFor = (t, v) => t < 0.235 + v.sched || t > 0.775 + v.sched;

export class Villagers {
  constructor(game) {
    this.game = game;
    this.list = [];
    this._tmp = new THREE.Vector3();
  }

  get scene() { return this.game.scene; }
  get grid() { return this.game.grid; }
  get buildings() { return this.game.buildings; }

  cost = (i, j) => {
    const k = cellIndex(i, j);
    if (this.grid.water[k]) return Infinity;
    const occ = this.grid.occ[k];
    if (occ !== -1) {
      const b = this.buildings.byId.get(occ);
      return b && b.def.walkable ? 1.6 : Infinity;
    }
    return this.grid.path[k] ? 0.5 : 1;
  };

  walkableAt = (x, z) => {
    const { i, j } = worldToCell(x, z);
    if (!inBounds(i, j)) return false;
    return this.cost(i, j) !== Infinity;
  };

  spawn(home, at, opts = {}) {
    const v = {
      id: vid++,
      name: opts.name || NAMES[nameIdx++ % NAMES.length],
      tunic: opts.tunic ?? Math.floor(Math.random() * TUNICS.length),
      skin: opts.skin ?? Math.floor(Math.random() * SKINS.length),
      hairC: opts.hair ?? Math.floor(Math.random() * HAIRS.length),
      home, job: null, tasks: [], task: null, path: null, pi: 0,
      x: at.x, z: at.z, y: terrainHeight(at.x, at.z), heading: Math.random() * 6.28, dirX: 0, dirZ: 1,
      carrying: null, inside: null, phase: Math.random() * 10, anim: 'idle', animT: 0,
      sched: Math.random() * 0.03, appear: 0, speedMul: 0.9 + Math.random() * 0.2, stuck: 0, dustT: 0,
    };
    this._buildMesh(v);
    if (home) home.residents.push(v);
    this.list.push(v);
    return v;
  }

  _buildMesh(v) {
    const g = new THREE.Group();
    const tunic = mat(TUNICS[v.tunic]);
    const skin = mat(SKINS[v.skin]);
    const hair = mat(HAIRS[v.hairC]);
    const trousers = mat('#6b5440');
    const mk = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; return o; };
    const bodyPivot = new THREE.Group();
    const body = mk(VG.body, tunic, 0, 0.235, 0);
    const head = mk(VG.head, skin, 0, 0.425, 0.005);
    const hairM = mk(VG.hair, hair, 0, 0.432, -0.006);
    const legL = mk(VG.leg, trousers, -0.035, 0.12, 0);
    const legR = mk(VG.leg, trousers, 0.035, 0.12, 0);
    const armL = mk(VG.arm, tunic, -0.088, 0.33, 0);
    const armR = mk(VG.arm, tunic, 0.088, 0.33, 0);
    armL.rotation.z = -0.12; armR.rotation.z = 0.12;
    const hat = new THREE.Mesh(VG.strawHat, HAT_MATS.farm); hat.castShadow = true; hat.position.set(0, 0.475, 0); hat.visible = false;
    const carry = new THREE.Mesh(VG.log, MAT.log); carry.castShadow = true; carry.position.set(0, 0.32, 0.11); carry.visible = false;
    const tool = new THREE.Mesh(VG.axe, MAT.metal); tool.castShadow = true; tool.visible = false;
    armR.add(tool); tool.position.set(0, -0.1, 0.01);
    bodyPivot.add(body, head, hairM, armL, armR, hat, carry);
    g.add(bodyPivot, legL, legR);
    v.group = g;
    v.parts = { bodyPivot, body, head, hair: hairM, legL, legR, armL, armR, hat, carry, tool };
    g.scale.setScalar(0.001);
    this.scene.add(g);
    this._dressForJob(v);
  }

  _dressForJob(v) {
    const p = v.parts;
    const t = v.job?.type;
    p.hat.visible = !!t;
    if (t === 'farm') { p.hat.geometry = VG.strawHat; p.hat.position.set(0, 0.478, 0); }
    if (t === 'woodcutter') { p.hat.geometry = VG.hood; p.hat.position.set(0, 0.45, 0); }
    if (t === 'fishery') { p.hat.geometry = VG.beanie; p.hat.position.set(0, 0.44, 0); }
    if (t) p.hat.material = HAT_MATS[t];
    p.hair.visible = t !== 'woodcutter';
  }

  setCarry(v, kind) {
    v.carrying = kind;
    const c = v.parts.carry;
    c.visible = !!kind;
    if (!kind) return;
    c.geometry = kind === 'wood' ? VG.log : kind === 'wheat' ? VG.basket : VG.fish;
    c.material = CARRY_MATS[kind];
    c.position.set(0, kind === 'wood' ? 0.3 : 0.28, 0.1);
  }

  setTool(v, kind) {
    const t = v.parts.tool;
    t.visible = !!kind;
    if (!kind) return;
    t.geometry = kind === 'axe' ? VG.axe : kind === 'rod' ? VG.rod : VG.hoe;
    t.material = kind === 'rod' ? MAT.woodDark : kind === 'axe' ? MAT.metal : MAT.woodLight;
    t.rotation.set(kind === 'rod' ? 0.9 : 0, 0, 0);
  }

  // ---- task helpers -------------------------------------------------------------------
  goto(x, z, opts = {}) { return { type: 'goto', x, z, ...opts }; }
  gotoCell(c, opts) { const p = cellCenter(c.i, c.j); return this.goto(p.x + (Math.random() - 0.5) * 0.3, p.z + (Math.random() - 0.5) * 0.3, opts); }

  _planPath(v, tx, tz) {
    const s = worldToCell(v.x, v.z), t = worldToCell(tx, tz);
    if (!inBounds(t.i, t.j)) return null;
    if (s.i === t.i && s.j === t.j) return [{ x: tx, z: tz }];
    const cells = findPath(s.i, s.j, t.i, t.j, this.cost);
    if (!cells) return null;
    cells[0] = { x: v.x, z: v.z };
    cells[cells.length - 1] = { x: tx, z: tz };
    // keep villagers on paths when they are using them
    const grid = this.grid;
    const onPathPt = (p) => { const c = worldToCell(p.x, p.z); return inBounds(c.i, c.j) && grid.path[cellIndex(c.i, c.j)]; };
    const smoothed = [];
    let seg = [cells[0]];
    for (let k = 1; k < cells.length; k++) {
      seg.push(cells[k]);
      const a = onPathPt(cells[k - 1]), b = onPathPt(cells[k]);
      if (a !== b || k === cells.length - 1) {
        const isPath = a && b;
        const sm = smoothPath(seg, isPath ? (x, z) => this.walkableAt(x, z) && onPathPt({ x, z }) : this.walkableAt);
        smoothed.push(...(smoothed.length ? sm.slice(1) : sm));
        seg = [cells[k]];
      }
    }
    return smoothed.slice(1);
  }

  storehouse() { return this.buildings.list.find((b) => b.type === 'storehouse'); }

  _releaseTasks(v) {
    for (const t of [v.task, ...v.tasks]) if (t?.tree) t.tree.reserved = false;
    if (v.job?.harvester === v) v.job.harvester = null;
    v.tasks = []; v.task = null; v.path = null;
  }

  // ---- brains ---------------------------------------------------------------------
  _think(v, dayT) {
    const night = isNightFor(dayT, v);
    if (v.inside) {
      if (!night) this._exit(v);
      return;
    }
    if (night) {
      const h = v.home && this.buildings.byId.has(v.home.id) ? v.home : this.storehouse();
      if (h) {
        this.setTool(v, null);
        v.tasks.push(this.gotoCell(h.entrance), { type: 'enter', b: h });
        return;
      }
    }
    if (v.carrying) { this._deliverPlan(v); return; }
    if (v.job) { this._jobPlan(v); return; }
    this._idlePlan(v);
  }

  _deliverPlan(v) {
    const s = this.storehouse();
    if (!s) { this.setCarry(v, null); return; }
    v.tasks.push(this.gotoCell(s.entrance, { face: s }), { type: 'deposit' });
  }

  _jobPlan(v) {
    const b = v.job;
    if (b.type === 'woodcutter') {
      const tree = this.game.nature.findTree(b.x, b.z, 15);
      if (!tree) {
        v.tasks.push(this.gotoCell(b.entrance), { type: 'wait', t: 5, anim: 'idle', say: 'no trees nearby' });
        return;
      }
      tree.reserved = true;
      // stand a little to the side of the trunk, on the side nearest the hut
      const a = Math.atan2(b.z - tree.z, b.x - tree.x) + (Math.random() - 0.5) * 1.2;
      let sx = tree.x + Math.cos(a) * 0.42, sz = tree.z + Math.sin(a) * 0.42;
      if (!this.walkableAt(sx, sz)) { sx = tree.x; sz = tree.z + 0.4; }
      v.tasks.push(
        { type: 'tool', kind: 'axe' },
        this.goto(sx, sz, { tree }),
        { type: 'chop', tree, t: 3.6 },
        { type: 'wait', t: 1.8, anim: 'watch' },
        { type: 'tool', kind: null },
        { type: 'carry', kind: 'wood' },
      );
      this._deliverPlan(v);
    } else if (b.type === 'farm') {
      const cell = b.cells[Math.floor(Math.random() * b.cells.length)];
      const c = cellCenter(cell[0], cell[1]);
      const pt = { x: c.x + (Math.random() - 0.5) * 0.6, z: c.z + (Math.random() - 0.5) * 0.6 };
      if (b.crops.growth >= 1 && !b.harvester) {
        b.harvester = v;
        v.tasks.push({ type: 'tool', kind: 'hoe' }, this.goto(pt.x, pt.z), { type: 'harvest', farm: b, t: 2.6 }, { type: 'tool', kind: null }, { type: 'carry', kind: 'wheat' });
        this._deliverPlan(v);
      } else {
        v.tasks.push({ type: 'tool', kind: 'hoe' }, this.goto(pt.x, pt.z), { type: 'tend', farm: b, t: 2.5 + Math.random() * 1.5 });
      }
    } else if (b.type === 'fishery') {
      const s = b.shore;
      if (!s) { v.tasks.push(this.gotoCell(b.entrance), { type: 'wait', t: 5 }); return; }
      const c = cellCenter(s.i, s.j);
      v.tasks.push(
        { type: 'tool', kind: 'rod' },
        this.goto(c.x + s.wx * 0.3, c.z + s.wz * 0.3),
        { type: 'fish', b, t: 6 + Math.random() * 6, wx: c.x + s.wx * 1.2, wz: c.z + s.wz * 1.2 },
      );
    }
  }

  _idlePlan(v) {
    const r = Math.random();
    const wells = this.buildings.list.filter((b) => b.type === 'well');
    if (wells.length && r < 0.45) {
      const w = wells[Math.floor(Math.random() * wells.length)];
      const a = Math.random() * Math.PI * 2;
      const x = w.x + Math.cos(a) * 0.85, z = w.z + Math.sin(a) * 0.85;
      if (this.walkableAt(x, z)) {
        v.tasks.push(this.goto(x, z), { type: 'wait', t: 5 + Math.random() * 6, anim: 'chat', faceX: w.x, faceZ: w.z });
        return;
      }
    }
    const base = v.home && this.buildings.byId.has(v.home.id) ? v.home : this.storehouse();
    const cx = base ? base.x : v.x, cz = base ? base.z : v.z;
    for (let k = 0; k < 8; k++) {
      const x = cx + (Math.random() - 0.5) * 9, z = cz + (Math.random() - 0.5) * 9;
      if (this.walkableAt(x, z)) {
        v.tasks.push(this.goto(x, z), { type: 'wait', t: 2 + Math.random() * 5, anim: Math.random() < 0.3 ? 'look' : 'idle' });
        return;
      }
    }
    v.tasks.push({ type: 'wait', t: 2 });
  }

  _exit(v) {
    const b = v.inside;
    v.inside = null;
    const e = b && this.buildings.byId.has(b.id) ? cellCenter(b.entrance.i, b.entrance.j) : { x: v.x, z: v.z };
    v.x = e.x; v.z = e.z;
    v.group.visible = true;
    v.appear = 0;
    v.heading = b ? b.rot * Math.PI / 2 : v.heading;
  }

  // ---- per frame ------------------------------------------------------------------
  update(dt, dayT, time) {
    for (const v of this.list) {
      if (v.inside) {
        if (v.wakeCheck === undefined || (v.wakeCheck -= dt) <= 0) {
          v.wakeCheck = 0.5 + Math.random();
          this._think(v, dayT);
        }
        continue;
      }
      if (!v.task) {
        v.task = v.tasks.shift() || null;
        if (!v.task) { this._think(v, dayT); v.task = v.tasks.shift() || null; }
        if (v.task) this._startTask(v, v.task);
      }
      if (v.task) this._runTask(v, v.task, dt, time);
      this._animate(v, dt, time);
    }
  }

  _startTask(v, t) {
    t.elapsed = 0;
    if (t.type === 'goto') {
      v.path = this._planPath(v, t.x, t.z);
      v.pi = 0;
      if (!v.path) { // can't get there; give up this plan
        if (t.tree) t.tree.reserved = false;
        this._releaseTasks(v);
        v.tasks.push({ type: 'wait', t: 1.5 + Math.random() * 2 });
      }
    }
  }

  _done(v) { v.task = null; v.anim = 'idle'; }

  _runTask(v, t, dt, time) {
    t.elapsed += dt;
    switch (t.type) {
      case 'goto': {
        if (!v.path) { this._done(v); return; }
        const target = v.path[v.pi];
        const dx = target.x - v.x, dz = target.z - v.z;
        const d = Math.hypot(dx, dz);
        const last = v.pi === v.path.length - 1;
        if (d < (last ? 0.04 : 0.28)) {
          v.pi++;
          if (v.pi >= v.path.length) { v.path = null; this._done(v); }
          return;
        }
        const c = worldToCell(v.x, v.z);
        const onPath = inBounds(c.i, c.j) && this.grid.path[cellIndex(c.i, c.j)];
        const sp = 1.05 * v.speedMul * (onPath ? 1.45 : 1) * (v.carrying ? 0.92 : 1);
        // smooth steering: blend current direction toward target
        const tx = dx / d, tz = dz / d;
        const k = 1 - Math.exp(-dt * (last ? 20 : 9));
        v.dirX += (tx - v.dirX) * k; v.dirZ += (tz - v.dirZ) * k;
        const dl = Math.hypot(v.dirX, v.dirZ) || 1;
        v.dirX /= dl; v.dirZ /= dl;
        const step = Math.min(sp * dt, d);
        v.x += v.dirX * step; v.z += v.dirZ * step;
        v.anim = 'walk';
        v.animSpeed = sp;
        this._faceDir(v, Math.atan2(v.dirX, v.dirZ), dt, 10);
        if (onPath) {
          v.dustT -= dt;
          if (v.dustT <= 0) {
            v.dustT = 0.35 + Math.random() * 0.3;
            this.game.particles.spawn({ x: v.x, y: v.y + 0.03, z: v.z, vy: 0.15, vx: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.2, life: 0.8, size: 0.12, grow: 0.15, color: new THREE.Color('#e7d5b5'), alpha: 0.45, drag: 2 });
          }
        }
        if (t.elapsed > 60) { this._releaseTasks(v); this._done(v); }
        return;
      }
      case 'wait': {
        v.anim = t.anim || 'idle';
        if (t.faceX !== undefined) this._faceDir(v, Math.atan2(t.faceX - v.x, t.faceZ - v.z), dt, 5);
        if (t.anim === 'chat' && Math.random() < dt * 0.25) {
          this.game.particles.spawn({ x: v.x, y: v.y + 0.62, z: v.z, vy: 0.35, life: 1.4, size: 0.1, color: new THREE.Color('#ff8fab'), alpha: 0.9, drag: 1, wobble: 0.2 });
        }
        if (t.elapsed >= t.t) this._done(v);
        return;
      }
      case 'tool': this.setTool(v, t.kind); this._done(v); return;
      case 'carry': this.setCarry(v, t.kind); this._done(v); return;
      case 'chop': {
        const tree = t.tree;
        if (tree.state !== 'grown') { tree.reserved = false; this._releaseTasks(v); this.setTool(v, null); this._done(v); return; }
        this._faceDir(v, Math.atan2(tree.x - v.x, tree.z - v.z), dt, 8);
        v.anim = 'chop';
        const swing = 0.7;
        const prev = Math.floor((t.elapsed - dt) / swing), now = Math.floor(t.elapsed / swing);
        if (now > prev && t.elapsed > 0.3) {
          this.game.nature.shakeTree(tree, 1);
          this.game.audio?.chop(v.x, v.z);
          for (let n = 0; n < 4; n++) {
            this.game.particles.spawn({ x: tree.x, y: tree.y + 0.25, z: tree.z, vx: (Math.random() - 0.5) * 1.5, vy: 1 + Math.random(), vz: (Math.random() - 0.5) * 1.5, life: 0.7, size: 0.06, color: new THREE.Color('#e0c08e'), alpha: 1, gravity: 5, drag: 1, soft: false });
          }
        }
        if (t.elapsed >= t.t) {
          const away = Math.atan2(tree.z - v.z, tree.x - v.x);
          this.game.nature.fellTree(tree, away + Math.PI / 2);
          setTimeout(() => this.game.audio?.thud(tree.x, tree.z), 1100);
          this._done(v);
        }
        return;
      }
      case 'tend': case 'harvest': {
        v.anim = 'tend';
        const f = t.farm;
        if (!this.buildings.byId.has(f.id)) { this._releaseTasks(v); this.setTool(v, null); this._done(v); return; }
        if (t.elapsed >= t.t) {
          if (t.type === 'tend') f.crops.growth = Math.min(1, f.crops.growth + 0.11);
          else {
            f.crops.growth = 0.12; f.harvester = null;
            this.game.audio?.rustle(v.x, v.z);
            for (let n = 0; n < 10; n++) this.game.particles.spawn({ x: v.x + (Math.random() - 0.5) * 0.5, y: v.y + 0.2, z: v.z + (Math.random() - 0.5) * 0.5, vy: 0.6 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 1.2, size: 0.07, color: new THREE.Color('#f3cf6a'), alpha: 1, gravity: 1.5, drag: 1 });
          }
          this._done(v);
        }
        return;
      }
      case 'fish': {
        if (!this.buildings.byId.has(t.b.id)) { this._releaseTasks(v); this.setTool(v, null); this._done(v); return; }
        this._faceDir(v, Math.atan2(t.wx - v.x, t.wz - v.z), dt, 6);
        v.anim = 'fish';
        if (!t.bobber) {
          t.bobber = this.game.makeBobber();
          t.bobber.position.set(t.wx, 0.03, t.wz);
          this.game.ripples.spawn(t.wx, t.wz, 0.35, 1.2);
          this.game.audio?.plip(t.wx, t.wz);
        }
        t.bobber.position.y = 0.03 + Math.sin(time * 3 + v.id) * 0.012 + (t.elapsed > t.t - 0.8 ? -0.03 : 0);
        if (Math.random() < dt * 0.4) this.game.ripples.spawn(t.wx, t.wz, 0.25, 1.2);
        if (t.elapsed >= t.t) {
          this.game.removeBobber(t.bobber);
          const caught = Math.random() < 0.75;
          this.game.ripples.spawn(t.wx, t.wz, 0.5, 1.4);
          this.game.audio?.splash(t.wx, t.wz, 0.4);
          if (caught) {
            this.setTool(v, null);
            this.setCarry(v, 'fish');
            this._deliverPlan(v);
          }
          this._done(v);
        }
        return;
      }
      case 'deposit': {
        const s = this.storehouse();
        if (v.carrying && s) {
          const amount = v.carrying === 'wood' ? 4 : v.carrying === 'wheat' ? 5 : 3;
          const res = v.carrying === 'wood' ? 'wood' : 'food';
          this.game.addResource(res, amount, { x: v.x, y: v.y + 0.7, z: v.z });
        }
        this.setCarry(v, null);
        this._done(v);
        return;
      }
      case 'enter': {
        v.anim = 'idle';
        v.appear -= dt * 4;
        if (v.appear <= 0) {
          v.inside = t.b;
          v.group.visible = false;
          v.appear = 0;
          this._done(v);
          this.setTool(v, null);
        }
        return;
      }
      default: this._done(v);
    }
  }

  _faceDir(v, target, dt, rate) {
    let d = target - v.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.heading += d * (1 - Math.exp(-dt * rate));
  }

  _animate(v, dt, time) {
    const p = v.parts;
    if (v.task?.type !== 'enter') v.appear = Math.min(1, v.appear + dt * 3);
    const s = v.appear < 1 ? 1 - Math.pow(1 - v.appear, 3) * (1 - v.appear * 0.0) : 1;
    v.group.scale.setScalar(Math.max(0.001, s));
    const occ = (() => { const c = worldToCell(v.x, v.z); if (!inBounds(c.i, c.j)) return null; const o = this.grid.occ[cellIndex(c.i, c.j)]; return o !== -1 ? this.buildings.byId.get(o) : null; })();
    const gy = Math.max(terrainHeight(v.x, v.z), WATER_LEVEL) + (occ?.type === 'farm' ? 0.08 : 0);
    v.y = damp(v.y, gy, 18, dt);
    v.group.position.set(v.x, v.y, v.z);
    v.group.rotation.y = v.heading;

    let legA = 0, armA = 0, armB = 0, bob = 0, lean = 0, armRx = 0;
    if (v.anim === 'walk') {
      v.phase += dt * (v.animSpeed || 1) * 11;
      legA = Math.sin(v.phase) * 0.65;
      armA = -Math.sin(v.phase) * 0.5;
      bob = Math.abs(Math.sin(v.phase)) * 0.025;
      lean = 0.06;
    } else {
      v.phase += dt * 2;
      bob = Math.sin(time * 2 + v.id) * 0.004;
    }
    if (v.anim === 'chop') {
      const k = (v.task.elapsed % 0.7) / 0.7;
      const sw = k < 0.6 ? -2.6 * (k / 0.6) : -2.6 + 3.2 * Math.min(1, (k - 0.6) / 0.12);
      armRx = sw; armB = sw * 0.6; lean = k > 0.6 ? 0.18 : -0.05;
    } else if (v.anim === 'tend') {
      const k = Math.sin(time * 6 + v.id);
      lean = 0.35 + k * 0.08; armRx = -0.9 + k * 0.4; armB = -0.7 - k * 0.3; bob = -0.04;
    } else if (v.anim === 'fish') {
      armRx = -1.0 + Math.sin(time * 1.5) * 0.05; armB = -0.4;
    } else if (v.anim === 'chat') {
      bob += Math.max(0, Math.sin(time * 5 + v.id * 2)) * 0.012;
      armA = Math.sin(time * 3 + v.id) * 0.2;
      p.head.rotation.y = Math.sin(time * 0.9 + v.id) * 0.4;
    } else if (v.anim === 'look') {
      p.head.rotation.y = Math.sin(time * 0.8 + v.id) * 0.7;
    } else if (v.anim === 'watch') {
      lean = -0.05;
    }
    if (v.anim !== 'chat' && v.anim !== 'look') p.head.rotation.y *= Math.exp(-dt * 4);
    if (v.carrying) { armA = 0; armRx = armRx || -1.2; armB = armB || -1.2; }
    p.legL.rotation.x = legA; p.legR.rotation.x = -legA;
    p.armL.rotation.x = v.carrying ? -1.2 : (armB || armA);
    p.armR.rotation.x = armRx || -armA;
    p.bodyPivot.position.y = bob;
    p.bodyPivot.rotation.x = damp(p.bodyPivot.rotation.x, lean, 10, dt);
    p.carry.position.y = (v.carrying === 'wood' ? 0.3 : 0.28) + Math.sin(v.phase) * 0.005;
  }

  // ---- management ---------------------------------------------------------------------
  assignJobs() {
    for (const b of this.buildings.list) {
      const need = (b.def.workers || 0) - b.workers.length;
      for (let n = 0; n < need; n++) {
        let best = null, bd = Infinity;
        for (const v of this.list) {
          if (v.job) continue;
          const d = (v.x - b.x) ** 2 + (v.z - b.z) ** 2;
          if (d < bd) { bd = d; best = v; }
        }
        if (!best) return;
        best.job = b;
        b.workers.push(best);
        this._dressForJob(best);
        if (!best.carrying && !best.inside) { this._releaseTasks(best); this.setTool(best, null); }
        this.game.toast(`${best.name} is now a ${JOB_LABEL[b.type].toLowerCase()} ${b.def.icon}`);
      }
    }
  }

  assignHomes() {
    const store = this.storehouse();
    for (const b of this.buildings.list) {
      if (b.type !== 'cottage') continue;
      while (b.residents.length < b.def.capacity) {
        const v = this.list.find((x) => !x.home || x.home === store || !this.buildings.byId.has(x.home.id));
        if (!v) return;
        if (v.home) v.home.residents = v.home.residents.filter((r) => r !== v);
        v.home = b;
        b.residents.push(v);
        this.game.toast(`${v.name} moved into a cottage 🏡`);
      }
    }
  }

  onBuildingRemoved(b) {
    for (const v of this.list) {
      if (v.job === b) {
        v.job = null;
        if (!v.carrying) { this._releaseTasks(v); this.setTool(v, null); }
        this._dressForJob(v);
      }
      if (v.home === b) {
        v.home = this.storehouse();
        v.home?.residents.push(v);
      }
      if (v.inside === b) this._exit(v);
      // anyone standing where the building appeared is nudged out
    }
    b.workers = []; b.residents = [];
  }

  onBuildingPlaced(b) {
    // villagers standing in the footprint step aside; paths get replanned
    for (const v of this.list) {
      if (v.inside) continue;
      const c = worldToCell(v.x, v.z);
      if (b.cells.some(([i, j]) => i === c.i && j === c.j) && !b.def.walkable) {
        const e = cellCenter(b.entrance.i, b.entrance.j);
        v.x = e.x; v.z = e.z; v.appear = 0;
      }
      if (v.task?.type === 'goto') this._startTask(v, v.task);
    }
  }

  pick(camera, mx, my, w, h, radius = 22) {
    let best = null, bd = radius * radius;
    const p = this._tmp;
    for (const v of this.list) {
      if (v.inside) continue;
      p.set(v.x, v.y + 0.3, v.z).project(camera);
      if (p.z > 1) continue;
      const sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  describe(v) {
    const job = v.job ? JOB_LABEL[v.job.type] : 'Villager';
    let doing = 'pottering about';
    const t = v.task?.type;
    if (v.inside) doing = 'sleeping soundly 💤';
    else if (v.carrying === 'wood') doing = 'carrying logs';
    else if (v.carrying) doing = 'bringing food home';
    else if (t === 'chop') doing = 'chopping a tree';
    else if (t === 'tend') doing = 'tending the wheat';
    else if (t === 'harvest') doing = 'harvesting';
    else if (t === 'fish') doing = 'fishing';
    else if (v.task?.anim === 'chat') doing = 'chatting by the well';
    else if (t === 'goto') doing = 'on the way';
    return { title: v.name, sub: `${job} · ${doing}` };
  }

  serialize() {
    return this.list.map((v) => ({ name: v.name, tunic: v.tunic, skin: v.skin, hair: v.hairC, home: v.home?.id ?? null, x: v.x, z: v.z }));
  }
}

export { GRID };
