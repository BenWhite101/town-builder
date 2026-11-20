import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight, LAKE } from './terrain.js';

const prep = (g) => {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
};

const depthAt = (x, z) => -terrainHeight(x, z);

export class Fish {
  constructor(scene, ripples, particles, audio) {
    this.ripples = ripples; this.particles = particles; this.audio = audio;
    const body = prep(new THREE.IcosahedronGeometry(0.1, 1)); body.scale(1.9, 0.75, 0.6);
    const tail = prep(new THREE.ConeGeometry(0.07, 0.12, 4)); tail.rotateZ(Math.PI / 2); tail.translate(-0.24, 0, 0); tail.scale(1, 1, 0.3);
    const fin = prep(new THREE.ConeGeometry(0.035, 0.08, 3)); fin.translate(0, 0.08, 0); fin.scale(1.4, 1, 0.3);
    this.bodyGeo = mergeGeometries([body, fin]);
    this.tailGeo = tail;
    const colors = ['#ff9a4d', '#ffb347', '#f26b4a', '#e9e2d0', '#ffd27a', '#9fb9c9'];
    this.fish = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    let tries = 0;
    while (this.fish.length < 26 && tries++ < 2000) {
      const x = LAKE.x + (Math.random() - 0.5) * LAKE.rx * 1.6;
      const z = LAKE.z + (Math.random() - 0.5) * LAKE.rz * 1.6;
      if (depthAt(x, z) < 0.6) continue;
      const mat = new THREE.MeshStandardMaterial({ color: colors[this.fish.length % colors.length], roughness: 0.5, emissive: colors[this.fish.length % colors.length], emissiveIntensity: 0.15, transparent: true, opacity: 0.9 });
      const g = new THREE.Group();
      const b = new THREE.Mesh(this.bodyGeo, mat);
      const t = new THREE.Mesh(this.tailGeo, mat);
      t.position.x = -0.0;
      g.add(b, t);
      const s = 0.7 + Math.random() * 0.6;
      g.scale.setScalar(s);
      this.group.add(g);
      this.fish.push({
        g, tail: t, x, z, y: -0.3, heading: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.3,
        turn: 0, ph: Math.random() * 10, jump: -1, jumpT: 0, nextJump: 8 + Math.random() * 30, s, dart: 0,
      });
    }
  }

  update(dt, time) {
    for (const f of this.fish) {
      f.ph += dt * (4 + f.speed * 6);
      if (f.jump < 0) {
        // wander
        f.turn += (Math.random() - 0.5) * dt * 3;
        f.turn *= Math.exp(-dt * 1.5);
        let h = f.heading + f.turn * dt * 2;
        const ahead = 0.9;
        const nx = f.x + Math.cos(h) * ahead, nz = f.z + Math.sin(h) * ahead;
        if (depthAt(nx, nz) < 0.45) {
          // steer back toward deeper water
          const toC = Math.atan2(LAKE.z - f.z, LAKE.x - f.x);
          let d = toC - h; d = Math.atan2(Math.sin(d), Math.cos(d));
          h += Math.sign(d) * dt * 3;
        }
        f.heading = h;
        f.dart = Math.max(0, f.dart - dt);
        const sp = f.speed * (1 + f.dart * 2.5) * (0.7 + 0.3 * Math.sin(time * 0.7 + f.ph * 0.1));
        f.x += Math.cos(f.heading) * sp * dt;
        f.z += Math.sin(f.heading) * sp * dt;
        if (depthAt(f.x, f.z) < 0.3) { f.x -= Math.cos(f.heading) * sp * dt * 2; f.z -= Math.sin(f.heading) * sp * dt * 2; f.heading += Math.PI * dt * 2; }
        const targetY = -Math.min(0.45, depthAt(f.x, f.z) * 0.35) + Math.sin(time * 0.5 + f.ph * 0.05) * 0.04;
        f.y += (targetY - f.y) * (1 - Math.exp(-dt * 2));
        f.nextJump -= dt;
        if (f.nextJump <= 0 && depthAt(f.x, f.z) > 0.7) {
          f.jump = 0; f.jumpT = 0; f.nextJump = 15 + Math.random() * 40;
          this._splash(f.x, f.z, 0.5);
        }
        if (Math.random() < dt * 0.05) f.dart = 1;
        f.g.position.set(f.x, f.y, f.z);
        f.g.rotation.set(0, -f.heading, Math.sin(f.ph * 0.5) * 0.05);
        f.tail.rotation.y = Math.sin(f.ph) * 0.5;
      } else {
        // a little leap out of the water
        f.jumpT += dt;
        const T = 0.9;
        const k = f.jumpT / T;
        const fwd = 1.1 * f.speed + 0.5;
        f.x += Math.cos(f.heading) * fwd * dt;
        f.z += Math.sin(f.heading) * fwd * dt;
        f.y = -0.1 + Math.sin(k * Math.PI) * 0.55;
        f.g.position.set(f.x, f.y, f.z);
        f.g.rotation.set(0, -f.heading, (0.5 - k) * 1.8);
        f.tail.rotation.y = Math.sin(f.ph * 2) * 0.6;
        if (k >= 1) { f.jump = -1; f.y = -0.15; this._splash(f.x, f.z, 0.7, true); }
      }
    }
  }

  _splash(x, z, size, sound) {
    this.ripples.spawn(x, z, size, 1.8);
    setTimeout(() => this.ripples.spawn(x, z, size * 0.6, 1.4), 180);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 0.6;
      this.particles.spawn({
        x, y: 0.05, z, vx: Math.cos(a) * s, vy: 1.4 + Math.random() * 1.2, vz: Math.sin(a) * s,
        life: 0.7, size: 0.07, color: new THREE.Color('#e9fbff'), alpha: 0.9, gravity: 6, drag: 0.5,
      });
    }
    if (sound) this.audio?.splash(x, z);
  }
}
