import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  terrainHeight, LAKE, WATER_LEVEL, streamZ, streamSurface, streamWidth,
} from './terrain.js';
import { damp } from './noise.js';

// ---- vertex-coloured part builder: every animal body part is one mesh -----------------
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
const col = new THREE.Color();

function part(geo, color, x = 0, y = 0, z = 0, { sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0 } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  ));
  col.set(color);
  const c = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const sph = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const box = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 2, r);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);

const meshOf = (parts) => {
  const m = new THREE.Mesh(mergeGeometries(parts), MAT);
  m.castShadow = true;
  return m;
};

// Each builder returns { body, head, legsF, legsB, ... } meshes plus pivot heights.
// Forward is +z. Geometry is cached per variant.
const cache = new Map();
function cached(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); }

function sheepParts(wool) {
  return cached(`sheep${wool}`, () => {
    const dark = '#4a4040';
    const body = [];
    for (const [x, y, z, r] of [[0, 0.23, 0, 0.12], [0.06, 0.25, 0.08, 0.09], [-0.06, 0.25, 0.08, 0.09], [0.06, 0.24, -0.08, 0.09], [-0.06, 0.24, -0.08, 0.09], [0, 0.3, 0, 0.09], [0, 0.22, 0.12, 0.08], [0, 0.22, -0.13, 0.08]]) {
      body.push(part(sph(r, 1), wool, x, y, z));
    }
    body.push(part(sph(0.03, 1), wool, 0, 0.26, -0.21));
    const head = [
      part(sph(0.06, 1), dark, 0, 0, 0.04, { sy: 0.85, sz: 1.25 }),
      part(sph(0.045, 1), wool, 0, 0.045, 0.0),
      part(sph(0.025, 1), dark, 0.06, 0.01, 0.0, { sx: 1.6, sy: 0.6 }),
      part(sph(0.025, 1), dark, -0.06, 0.01, 0.0, { sx: 1.6, sy: 0.6 }),
      part(sph(0.01, 0), '#111111', 0.03, 0.02, 0.09),
      part(sph(0.01, 0), '#111111', -0.03, 0.02, 0.09),
    ];
    const leg = (x, z) => part(cyl(0.018, 0.016, 0.15), dark, x, -0.075, z);
    return {
      body: mergeGeometries(body), head: mergeGeometries(head),
      legsF: mergeGeometries([leg(0.05, 0), leg(-0.05, 0)]), legsB: mergeGeometries([leg(0.05, 0), leg(-0.05, 0)]),
      headAt: [0, 0.28, 0.18], legF: [0, 0.16, 0.08], legB: [0, 0.16, -0.09], legLen: 0.15,
    };
  });
}

function cowParts(coat, spots) {
  return cached(`cow${coat}${spots}`, () => {
    const body = [part(box(0.24, 0.22, 0.46, 0.08), coat, 0, 0.36, 0)];
    for (const [x, y, z, r] of [[0.12, 0.38, 0.05, 0.07], [-0.12, 0.34, -0.1, 0.06], [0.06, 0.47, -0.12, 0.06], [-0.1, 0.42, 0.12, 0.05]]) {
      body.push(part(sph(r, 1), spots, x, y, z, { sx: 0.35, sy: 0.9, sz: 1.2 }));
    }
    body.push(part(sph(0.05, 1), '#f2a7a7', 0, 0.25, -0.12, { sy: 0.7 }));
    body.push(part(cyl(0.008, 0.008, 0.22, 4), coat, 0, 0.33, -0.25, { rx: 0.3 }));
    body.push(part(sph(0.022, 0), spots, 0, 0.23, -0.29));
    const head = [
      part(box(0.13, 0.13, 0.17, 0.05), coat, 0, 0, 0.04),
      part(box(0.11, 0.07, 0.06, 0.03), '#f2b8b0', 0, -0.03, 0.13),
      part(cone(0.015, 0.06, 5), '#efe6cf', 0.055, 0.08, 0.0, { rz: -0.5 }),
      part(cone(0.015, 0.06, 5), '#efe6cf', -0.055, 0.08, 0.0, { rz: 0.5 }),
      part(sph(0.03, 1), coat, 0.085, 0.035, -0.01, { sx: 1.5, sy: 0.6 }),
      part(sph(0.03, 1), coat, -0.085, 0.035, -0.01, { sx: 1.5, sy: 0.6 }),
      part(sph(0.012, 0), '#111111', 0.045, 0.03, 0.1),
      part(sph(0.012, 0), '#111111', -0.045, 0.03, 0.1),
    ];
    const leg = (x) => part(cyl(0.028, 0.025, 0.25), coat, x, -0.125, 0);
    const hoof = (x) => part(cyl(0.028, 0.03, 0.03), '#3a302a', x, -0.24, 0);
    return {
      body: mergeGeometries(body), head: mergeGeometries(head),
      legsF: mergeGeometries([leg(0.08), leg(-0.08), hoof(0.08), hoof(-0.08)]), legsB: mergeGeometries([leg(0.08), leg(-0.08), hoof(0.08), hoof(-0.08)]),
      headAt: [0, 0.43, 0.26], legF: [0, 0.25, 0.15], legB: [0, 0.25, -0.15], legLen: 0.25,
    };
  });
}

function chickenParts(feather) {
  return cached(`chicken${feather}`, () => {
    const body = [
      part(sph(0.055, 1), feather, 0, 0.085, 0, { sx: 0.9, sy: 0.9, sz: 1.15 }),
      part(sph(0.035, 1), feather, 0, 0.12, -0.055, { sx: 0.6, sy: 1.1, sz: 0.8, rx: -0.5 }),
      part(sph(0.03, 1), feather, 0.045, 0.09, 0, { sx: 0.4, sz: 1.3 }),
      part(sph(0.03, 1), feather, -0.045, 0.09, 0, { sx: 0.4, sz: 1.3 }),
      part(cyl(0.006, 0.006, 0.05, 4), '#e8a33c', 0.02, 0.025, 0),
      part(cyl(0.006, 0.006, 0.05, 4), '#e8a33c', -0.02, 0.025, 0),
    ];
    const head = [
      part(sph(0.03, 1), feather, 0, 0, 0),
      part(sph(0.014, 0), '#d8443a', 0, 0.03, 0.0, { sz: 1.6 }),
      part(cone(0.012, 0.03, 4), '#f0b23c', 0, -0.003, 0.035, { rx: Math.PI / 2 }),
      part(sph(0.009, 0), '#d8443a', 0, -0.025, 0.02),
      part(sph(0.006, 0), '#111111', 0.022, 0.008, 0.016),
      part(sph(0.006, 0), '#111111', -0.022, 0.008, 0.016),
    ];
    return { body: mergeGeometries(body), head: mergeGeometries(head), headAt: [0, 0.145, 0.05] };
  });
}

function duckParts(variant) {
  return cached(`duck${variant}`, () => {
    if (variant === 'duckling') {
      return {
        body: mergeGeometries([part(sph(0.035, 1), '#f7d860', 0, 0.02, 0, { sz: 1.2 }), part(sph(0.012, 0), '#f7d860', 0, 0.035, -0.04)]),
        head: mergeGeometries([part(sph(0.022, 1), '#f7d860', 0, 0, 0), part(box(0.02, 0.008, 0.02, 0.003), '#f0a03c', 0, -0.002, 0.024), part(sph(0.005, 0), '#111111', 0.015, 0.006, 0.012), part(sph(0.005, 0), '#111111', -0.015, 0.006, 0.012)]),
        headAt: [0, 0.055, 0.035],
      };
    }
    const male = variant === 'drake';
    const bodyCol = male ? '#a89a88' : '#9b7b5a';
    return {
      body: mergeGeometries([
        part(sph(0.07, 1), bodyCol, 0, 0.03, 0, { sy: 0.7, sz: 1.5 }),
        part(sph(0.05, 1), male ? '#6b4a36' : bodyCol, 0, 0.06, 0.06, { sz: 1.1 }),
        part(cone(0.03, 0.06, 5), male ? '#3a3a3a' : bodyCol, 0, 0.06, -0.11, { rx: -2.2 }),
        part(sph(0.04, 1), male ? '#5f5a52' : '#806247', 0.045, 0.045, -0.01, { sx: 0.4, sz: 1.5 }),
        part(sph(0.04, 1), male ? '#5f5a52' : '#806247', -0.045, 0.045, -0.01, { sx: 0.4, sz: 1.5 }),
      ]),
      head: mergeGeometries([
        part(sph(0.038, 1), male ? '#2f7a4a' : '#8a6a4a', 0, 0, 0),
        ...(male ? [part(cyl(0.03, 0.03, 0.01, 10), '#ffffff', 0, -0.035, 0)] : []),
        part(box(0.03, 0.012, 0.045, 0.005), '#f0b23c', 0, -0.008, 0.045),
        part(sph(0.007, 0), '#111111', 0.028, 0.01, 0.018),
        part(sph(0.007, 0), '#111111', -0.028, 0.01, 0.018),
      ]),
      headAt: [0, 0.11, 0.1],
    };
  });
}

function makeAnimal(kind, variant) {
  let P;
  if (kind === 'sheep') P = sheepParts(variant);
  else if (kind === 'cow') P = cowParts(...variant);
  else if (kind === 'chicken') P = chickenParts(variant);
  else P = duckParts(variant);
  const group = new THREE.Group();
  const bodyPivot = new THREE.Group();
  const body = new THREE.Mesh(P.body, MAT); body.castShadow = true;
  const head = new THREE.Mesh(P.head, MAT); head.castShadow = true;
  head.position.set(...P.headAt);
  bodyPivot.add(body, head);
  group.add(bodyPivot);
  const a = { kind, group, bodyPivot, head, P };
  if (P.legsF) {
    a.legsF = new THREE.Mesh(P.legsF, MAT); a.legsF.position.set(...P.legF); a.legsF.castShadow = true;
    a.legsB = new THREE.Mesh(P.legsB, MAT); a.legsB.position.set(...P.legB); a.legsB.castShadow = true;
    bodyPivot.add(a.legsF, a.legsB);
  }
  return a;
}

const SPEED = { sheep: 0.22, cow: 0.17, chicken: 0.32, duck: 0.2 };

export class Animals {
  constructor(game) {
    this.game = game;
    this.list = [];
    this._soundT = 3;
    this._spawnDucks();
  }

  get scene() { return this.game.scene; }

  // pasture/coop animals --------------------------------------------------------------
  herd(b) {
    const spec = b.def.animals;
    if (!spec) return;
    b.animals = [];
    for (let n = 0; n < spec.n; n++) {
      let variant;
      if (spec.kind === 'sheep') variant = Math.random() < 0.15 ? '#5a4a42' : Math.random() < 0.5 ? '#f6f1e6' : '#ece3d2';
      else if (spec.kind === 'cow') variant = Math.random() < 0.5 ? ['#f5f1ea', '#3d3530'] : ['#b5784e', '#f2e8dc'];
      else variant = ['#f4efe6', '#b5703d', '#d9a066', '#3d3532'][Math.floor(Math.random() * 4)];
      const a = makeAnimal(spec.kind, variant);
      const p = this._randomIn(b);
      Object.assign(a, {
        home: b, x: p.x, z: p.z, y: terrainHeight(p.x, p.z), heading: Math.random() * 6.28, target: null,
        state: 'idle', t: Math.random() * 3, ph: Math.random() * 10, scale: 0.85 + Math.random() * 0.3, lie: 0, peck: 0, show: 0,
      });
      a.group.scale.setScalar(0.001);
      this.scene.add(a.group);
      this.list.push(a);
      b.animals.push(a);
    }
  }

  release(b) {
    for (const a of b.animals || []) { a.leaving = true; }
    b.animals = [];
  }

  _toWorld(b, lx, lz) {
    const r = b.rot * Math.PI / 2, c = Math.cos(r), s = Math.sin(r);
    return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
  }

  _randomIn(b) {
    const half = b.def.size / 2 - 0.3;
    for (let k = 0; k < 20; k++) {
      const lx = (Math.random() * 2 - 1) * half, lz = (Math.random() * 2 - 1) * half;
      if ((b.keepClear || []).some((c) => (lx - c.x) ** 2 + (lz - c.z) ** 2 < c.r * c.r)) continue;
      return this._toWorld(b, lx, lz);
    }
    return { x: b.x, z: b.z };
  }

  // a spot beside an animal where a villager can stand to look after it
  besideAnimal(b) {
    const a = (b.animals || [])[Math.floor(Math.random() * (b.animals?.length || 1))];
    if (!a) return null;
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = a.kind === 'cow' ? 0.32 : a.kind === 'sheep' ? 0.25 : 0.2;
    return { animal: a, x: a.x + Math.cos(a.heading) * off * side, z: a.z - Math.sin(a.heading) * off * side };
  }

  // ducks ---------------------------------------------------------------------------
  _spawnDucks() {
    const lakeSpot = () => {
      for (let k = 0; k < 200; k++) {
        const x = LAKE.x + (Math.random() - 0.5) * LAKE.rx * 1.6, z = LAKE.z + (Math.random() - 0.5) * LAKE.rz * 1.6;
        if (-terrainHeight(x, z) > 0.45) return { x, z };
      }
      return { x: LAKE.x, z: LAKE.z };
    };
    const addDuck = (variant, p, water, leader = null, idx = 0) => {
      const a = makeAnimal('duck', variant);
      Object.assign(a, { x: p.x + idx * 0.1, z: p.z, y: 0, heading: Math.random() * 6.28, target: null, state: 'swim', t: Math.random() * 4, ph: Math.random() * 10, water, leader, idx, dip: 0, scale: 1, show: 1, wakeT: Math.random() });
      a.group.scale.setScalar(1);
      this.scene.add(a.group);
      this.list.push(a);
      return a;
    };
    for (let f = 0; f < 2; f++) {
      const p = lakeSpot();
      const mum = addDuck('hen', p, 'lake');
      for (let d = 0; d < 3 + f; d++) addDuck('duckling', p, 'lake', mum, d + 1);
    }
    for (let n = 0; n < 4; n++) addDuck(n % 2 ? 'drake' : 'hen', lakeSpot(), 'lake');
    // a pair paddling up and down the brook
    for (let n = 0; n < 2; n++) {
      const x = -18 + n * 0.5;
      const a = addDuck(n ? 'hen' : 'drake', { x, z: streamZ(x) }, 'brook');
      a.dir = 1; a.lane = (n - 0.5) * 0.25;
    }
  }

  _updateDuck(a, dt, time) {
    if (a.water === 'brook') {
      // drift downstream, paddle back up; never leave the water
      a.t -= dt;
      const sp = a.dir > 0 ? 0.22 : 0.12;
      a.x += a.dir * sp * dt;
      if (a.x > -3 || a.x < -26 || a.t < -20 - Math.random() * 20) { a.dir *= -1; a.t = 0; }
      a.z = streamZ(a.x) + a.lane * streamWidth(a.x);
      a.y = streamSurface(a.x);
      const dx = 0.1, tz = streamZ(a.x + dx) - streamZ(a.x - dx);
      const want = Math.atan2(a.dir * 2 * dx, a.dir * tz);
      a.heading = this._turn(a.heading, want, dt, 3);
    } else {
      if (a.leader) {
        // ducklings bob along in a line behind mum
        const L = a.leader;
        const tx = L.x - Math.sin(L.heading) * 0.16 * a.idx, tz = L.z - Math.cos(L.heading) * 0.16 * a.idx;
        const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.04) {
          const sp = Math.min(d * 2.2, 0.5);
          a.x += (dx / d) * sp * dt; a.z += (dz / d) * sp * dt;
          a.heading = this._turn(a.heading, Math.atan2(dx, dz), dt, 6);
        }
      } else {
        a.t -= dt;
        if (!a.target || a.t <= 0 || Math.hypot(a.target.x - a.x, a.target.z - a.z) < 0.2) {
          for (let k = 0; k < 20; k++) {
            const x = a.x + (Math.random() - 0.5) * 7, z = a.z + (Math.random() - 0.5) * 7;
            if (-terrainHeight(x, z) > 0.35 && this._lakeClear(a.x, a.z, x, z)) { a.target = { x, z }; break; }
          }
          a.t = 6 + Math.random() * 10;
          if (Math.random() < 0.25) a.dip = 1.4; // bottoms up!
        }
        if (a.target) {
          const dx = a.target.x - a.x, dz = a.target.z - a.z, d = Math.hypot(dx, dz);
          if (d > 0.05) {
            a.heading = this._turn(a.heading, Math.atan2(dx, dz), dt, 1.6);
            const sp = SPEED.duck * Math.min(1, d);
            a.x += Math.sin(a.heading) * sp * dt; a.z += Math.cos(a.heading) * sp * dt;
            if (-terrainHeight(a.x, a.z) < 0.15) { a.x -= Math.sin(a.heading) * sp * dt * 2; a.z -= Math.cos(a.heading) * sp * dt * 2; a.target = null; }
          }
        }
      }
      a.y = WATER_LEVEL;
      a.wakeT -= dt;
      if (a.wakeT <= 0 && !a.leader) { a.wakeT = 1.4 + Math.random(); this.game.ripples.spawn(a.x - Math.sin(a.heading) * 0.08, a.z - Math.cos(a.heading) * 0.08, 0.25, 1.4); }
    }
    a.dip = Math.max(0, a.dip - dt);
    const dip = a.dip > 0 ? Math.sin(Math.min(1, (1.4 - a.dip) / 1.4) * Math.PI) : 0;
    a.group.position.set(a.x, a.y - 0.005 + Math.sin(time * 2 + a.ph) * 0.004, a.z);
    a.group.rotation.set(0, a.heading, 0);
    a.bodyPivot.rotation.x = dip * 1.3;
    a.head.rotation.y = Math.sin(time * 0.7 + a.ph) * 0.4;
  }

  _lakeClear(x0, z0, x1, z1) {
    for (let s = 1; s <= 6; s++) { const t = s / 6; if (-terrainHeight(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) < 0.25) return false; }
    return true;
  }

  _turn(h, want, dt, rate) {
    let d = want - h; d = Math.atan2(Math.sin(d), Math.cos(d));
    return h + d * (1 - Math.exp(-dt * rate));
  }

  // land animals --------------------------------------------------------------------
  _updateLand(a, dt, time, dayT, night) {
    const b = a.home;
    const sleepy = dayT < 0.24 || dayT > 0.8;
    a.show = damp(a.show, a.leaving ? 0 : 1, 6, dt);
    if (a.held) { a.state = 'idle'; }
    else if (sleepy && a.kind !== 'chicken') a.state = 'rest';
    else if (a.state === 'rest') { a.state = 'idle'; a.t = Math.random() * 2; }
    a.t -= dt;
    if (a.state !== 'rest' && !a.held && a.t <= 0) {
      const r = Math.random();
      if (a.state === 'walk' || r < 0.45) {
        a.state = a.kind === 'chicken' && Math.random() < 0.6 ? 'peck' : 'graze';
        a.t = a.kind === 'chicken' ? 1 + Math.random() * 2 : 3 + Math.random() * 6;
      } else if (r < 0.85) {
        a.state = 'walk';
        a.target = this._randomIn(b);
        a.t = 12;
      } else { a.state = 'idle'; a.t = 2 + Math.random() * 3; }
    }
    // chickens tuck themselves into the hen house at night
    if (a.kind === 'chicken') {
      const inside = sleepy && b.house;
      if (inside) { const h = this._toWorld(b, b.house.x, b.house.z); a.state = 'walk'; a.target = h; }
      const nearHouse = inside && Math.hypot(a.target.x - a.x, a.target.z - a.z) < 0.15;
      a.show = damp(a.show, nearHouse || a.leaving ? 0 : 1, 5, dt);
    }
    let moving = false;
    if (a.state === 'walk' && a.target) {
      const dx = a.target.x - a.x, dz = a.target.z - a.z, d = Math.hypot(dx, dz);
      if (d < 0.06) { a.state = 'idle'; a.t = 0.5 + Math.random() * 2; }
      else {
        a.heading = this._turn(a.heading, Math.atan2(dx, dz), dt, 3);
        const sp = SPEED[a.kind] * Math.min(1, d * 3);
        a.x += Math.sin(a.heading) * sp * dt; a.z += Math.cos(a.heading) * sp * dt;
        moving = true;
      }
    }
    // keep a little personal space within the herd
    for (const o of b.animals || []) {
      if (o === a) continue;
      const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), min = a.kind === 'cow' ? 0.45 : a.kind === 'sheep' ? 0.3 : 0.14;
      if (d > 0.001 && d < min) { a.x += (dx / d) * (min - d) * dt * 3; a.z += (dz / d) * (min - d) * dt * 3; }
    }
    a.y = damp(a.y, terrainHeight(a.x, a.z), 10, dt);
    a.ph += dt * (moving ? 9 : 1.5);
    a.lie = damp(a.lie, a.state === 'rest' ? 1 : 0, 3, dt);
    const s = a.scale * Math.max(0.001, a.show);
    a.group.scale.setScalar(s);
    a.group.position.set(a.x, a.y + (moving && a.kind === 'chicken' ? Math.abs(Math.sin(a.ph)) * 0.02 : 0), a.z);
    a.group.rotation.y = a.heading;
    if (a.legsF) {
      const sw = moving ? Math.sin(a.ph) * 0.5 : 0;
      a.legsF.rotation.x = sw; a.legsB.rotation.x = -sw;
      a.legsF.visible = a.legsB.visible = a.lie < 0.7;
      a.bodyPivot.position.y = -a.lie * a.P.legLen * 0.9 + (moving ? Math.abs(Math.sin(a.ph)) * 0.01 : 0);
    }
    // head: down to graze/peck, up otherwise; a slow look-about when idle
    let headX = 0, bodyX = 0;
    if (a.state === 'graze') headX = 0.9 + Math.sin(time * 3 + a.ph) * 0.08;
    if (a.state === 'peck') { const k = Math.max(0, Math.sin(time * 9 + a.ph)); bodyX = k * 0.5; headX = k * 0.6; }
    if (a.state === 'rest') headX = 0.25;
    a.head.rotation.x = damp(a.head.rotation.x, headX, 8, dt);
    a.head.rotation.y = a.state === 'idle' ? Math.sin(time * 0.6 + a.ph) * 0.5 : damp(a.head.rotation.y, 0, 4, dt);
    a.bodyPivot.rotation.x = damp(a.bodyPivot.rotation.x, bodyX, 12, dt);
    if (a.leaving && a.show < 0.02) { this.scene.remove(a.group); a.dead = true; }
  }

  update(dt, time, dayT, night) {
    for (const a of this.list) {
      if (a.kind === 'duck') this._updateDuck(a, dt, time);
      else this._updateLand(a, dt, time, dayT, night);
    }
    if (this.list.some((a) => a.dead)) this.list = this.list.filter((a) => !a.dead);
    // the odd baa, moo, cluck or quack from whatever is near the camera
    this._soundT -= dt;
    if (this._soundT <= 0) {
      this._soundT = 3 + Math.random() * 6;
      const t = this.game.rig.target;
      const near = this.list.filter((a) => !a.leaving && (a.x - t.x) ** 2 + (a.z - t.z) ** 2 < 120 && (a.kind === 'duck' || a.state !== 'rest'));
      const a = near[Math.floor(Math.random() * near.length)];
      if (a) this.game.audio.animal(a.kind === 'duck' && a.leader ? 'duckling' : a.kind, a.x, a.z);
    }
  }

  serialize() { return null; } // animals are recreated with their buildings
}
