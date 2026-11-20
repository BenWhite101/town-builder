import * as THREE from 'three';
import { damp, clamp } from './noise.js';
import { terrainHeight, HALF } from './terrain.js';

export const ZOOM_MIN = 9, ZOOM_MAX = 62;
const PITCH_MIN = 0.38, PITCH_MAX = 1.3;

// Smooth, damped orbit camera: everything eases toward a goal so motion always feels soft.
// Pointer/touch input lives in input.js and drives this through panPixels/orbitPixels/zoomBy.
export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.goal = { x: -2, z: 5, yaw: -0.75, pitch: 0.66, dist: 26 };
    this.cur = { ...this.goal, dist: 46, pitch: 1.0, yaw: -1.2 };
    this.keys = new Set();
    this.target = new THREE.Vector3();
    this.groundY = 0.5;
    this.held = false;              // a finger/mouse is actively dragging the view
    this.vel = { x: 0, z: 0 };      // pan inertia (world units / s)
    this._lastPan = 0;

    addEventListener('keydown', (e) => { if (!e.target.closest?.('input')) this.keys.add(e.key.toLowerCase()); });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022));
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // world units per screen pixel at the focus point
  _pxScale() {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    return (2 * this.cur.dist * Math.tan(fov / 2)) / Math.max(1, innerHeight);
  }

  _move(dx, dz) {
    const nx = clamp(this.goal.x + dx, -HALF - 2, HALF + 2);
    const nz = clamp(this.goal.z + dz, -HALF - 2, HALF + 2);
    const ax = nx - this.goal.x, az = nz - this.goal.z;
    this.goal.x = nx; this.goal.z = nz;
    return [ax, az];
  }

  // Drag the ground with the pointer: the world moves with the finger.
  panPixels(dx, dy) {
    const k = this._pxScale();
    const yaw = this.goal.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);   // screen-right on the ground
    const fx = Math.sin(yaw), fz = Math.cos(yaw);    // toward the camera on the ground
    const vy = 1 / Math.max(0.45, Math.sin(this.cur.pitch)); // foreshortening of screen-vertical
    const wx = (-dx * rx - dy * vy * fx) * k;
    const wz = (-dx * rz - dy * vy * fz) * k;
    const [ax, az] = this._move(wx, wz);
    // track velocity for a gentle glide after release
    const now = performance.now();
    const dt = Math.max(1, now - this._lastPan) / 1000;
    this._lastPan = now;
    const a = Math.min(1, dt * 18);
    this.vel.x += (ax / dt - this.vel.x) * a;
    this.vel.z += (az / dt - this.vel.z) * a;
  }

  release() {
    this.held = false;
    // only glide if the finger was still moving when it lifted
    if (performance.now() - this._lastPan > 90) this.vel.x = this.vel.z = 0;
    const sp = Math.hypot(this.vel.x, this.vel.z), max = 40;
    if (sp > max) { this.vel.x *= max / sp; this.vel.z *= max / sp; }
  }

  grab() { this.held = true; this.vel.x = this.vel.z = 0; this._lastPan = performance.now(); }

  orbitPixels(dx, dy) {
    this.goal.yaw -= dx * 0.006;
    this.goal.pitch = clamp(this.goal.pitch + dy * 0.004, PITCH_MIN, PITCH_MAX);
  }

  rotateBy(rad) { this.goal.yaw += rad; }

  zoomBy(k, { followPitch = false } = {}) {
    this.goal.dist = clamp(this.goal.dist * k, ZOOM_MIN, ZOOM_MAX);
    // on touch there is no easy tilt gesture, so tilt gently with zoom: close = more side-on
    if (followPitch) {
      const t = (this.goal.dist - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
      this.goal.pitch = damp(this.goal.pitch, 0.5 + t * 0.55, 6, 1 / 30);
    }
  }

  tiltBy(d) { this.goal.pitch = clamp(this.goal.pitch + d, PITCH_MIN, PITCH_MAX); }

  update(dt) {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) mz -= 1;
    if (k.has('s') || k.has('arrowdown')) mz += 1;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (mx || mz) {
      const sp = this.goal.dist * 0.9 * dt;
      const yaw = this.goal.yaw;
      this._move((Math.cos(yaw) * mx + Math.sin(yaw) * mz) * sp, (-Math.sin(yaw) * mx + Math.cos(yaw) * mz) * sp);
    }
    if (k.has('q')) this.goal.yaw += dt * 1.6;
    if (k.has('e')) this.goal.yaw -= dt * 1.6;
    if (k.has('=') || k.has('+')) this.zoomBy(Math.exp(-dt * 1.2));
    if (k.has('-')) this.zoomBy(Math.exp(dt * 1.2));

    // inertia glide
    if (!this.held && (this.vel.x || this.vel.z)) {
      const [ax, az] = this._move(this.vel.x * dt, this.vel.z * dt);
      if (!ax && !az) this.vel.x = this.vel.z = 0;
      const f = Math.exp(-dt * 4.5);
      this.vel.x *= f; this.vel.z *= f;
      if (Math.hypot(this.vel.x, this.vel.z) < 0.05) this.vel.x = this.vel.z = 0;
    }

    const c = this.cur, g = this.goal;
    const follow = this.held ? 14 : 8;
    c.x = damp(c.x, g.x, follow, dt);
    c.z = damp(c.z, g.z, follow, dt);
    c.yaw = damp(c.yaw, g.yaw, 9, dt);
    c.pitch = damp(c.pitch, g.pitch, 7, dt);
    c.dist = damp(c.dist, g.dist, 7, dt);
    this.groundY = damp(this.groundY, Math.max(terrainHeight(c.x, c.z), 0), 3, dt);

    this.target.set(c.x, this.groundY, c.z);
    const cp = Math.cos(c.pitch), sp2 = Math.sin(c.pitch);
    const pos = new THREE.Vector3(
      c.x + Math.sin(c.yaw) * cp * c.dist,
      this.groundY + sp2 * c.dist,
      c.z + Math.cos(c.yaw) * cp * c.dist,
    );
    const minY = terrainHeight(pos.x, pos.z) + 1.5; // never dip under the hills
    if (pos.y < minY) pos.y = minY;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }
}
