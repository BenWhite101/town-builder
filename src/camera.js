import * as THREE from 'three';
import { damp, clamp } from './noise.js';
import { terrainHeight, HALF } from './terrain.js';

// Smooth, damped orbit camera: everything eases toward a goal so motion always feels soft.
export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.goal = { x: -2, z: 5, yaw: -0.75, pitch: 0.66, dist: 26 };
    this.cur = { ...this.goal, dist: 46, pitch: 1.0, yaw: -1.2 };
    this.keys = new Set();
    this.drag = null;
    this.target = new THREE.Vector3();
    this.groundY = 0.5;

    addEventListener('keydown', (e) => { if (!e.target.closest?.('input')) this.keys.add(e.key.toLowerCase()); });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022);
      this.goal.dist = clamp(this.goal.dist * k, 9, 62);
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1 || (e.button === 0 && this.panWithLeft)) {
        this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: 0 };
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.button === 2) {
        this.goal.yaw -= dx * 0.006;
        this.goal.pitch = clamp(this.goal.pitch + dy * 0.004, 0.38, 1.3);
      } else {
        this.pan(-dx, -dy, this.goal.dist * 0.0016);
      }
    });
    const end = (e) => { if (this.drag) { try { dom.releasePointerCapture(e.pointerId); } catch { /* */ } this.lastDragMoved = this.drag.moved; this.drag = null; } };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);

    // touch: two-finger pinch/rotate, one finger pan (handled by pointer events above for mouse)
    this._touches = new Map();
    dom.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) this._touches.set(t.identifier, { x: t.clientX, y: t.clientY }); }, { passive: true });
    dom.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        const pa = this._touches.get(a.identifier), pb = this._touches.get(b.identifier);
        if (pa && pb) {
          const d0 = Math.hypot(pa.x - pb.x, pa.y - pb.y), d1 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          this.goal.dist = clamp(this.goal.dist * (d0 / Math.max(d1, 1)), 9, 62);
          const a0 = Math.atan2(pb.y - pa.y, pb.x - pa.x), a1 = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
          this.goal.yaw += (a1 - a0);
          const my0 = (pa.y + pb.y) / 2, my1 = (a.clientY + b.clientY) / 2;
          this.goal.pitch = clamp(this.goal.pitch + (my1 - my0) * 0.004, 0.38, 1.3);
        }
      }
      for (const t of e.changedTouches) this._touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }, { passive: true });
    const tend = (e) => { for (const t of e.changedTouches) this._touches.delete(t.identifier); };
    dom.addEventListener('touchend', tend, { passive: true });
    dom.addEventListener('touchcancel', tend, { passive: true });
  }

  pan(dx, dy, scale) {
    const yaw = this.goal.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);   // forward on ground (camera looks along -f)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    this.goal.x += (rx * dx + fx * dy) * scale;
    this.goal.z += (rz * dx + fz * dy) * scale;
    this.goal.x = clamp(this.goal.x, -HALF - 2, HALF + 2);
    this.goal.z = clamp(this.goal.z, -HALF - 2, HALF + 2);
  }

  update(dt) {
    const k = this.keys;
    const sp = this.goal.dist * 0.9 * dt;
    let mx = 0, mz = 0;
    if (k.has('w') || k.has('arrowup')) mz -= 1;
    if (k.has('s') || k.has('arrowdown')) mz += 1;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (mx || mz) this.pan(mx * sp * 10, mz * sp * 10, 0.1);
    if (k.has('q')) this.goal.yaw += dt * 1.6;
    if (k.has('e')) this.goal.yaw -= dt * 1.6;
    if (k.has('=') || k.has('+')) this.goal.dist = clamp(this.goal.dist * Math.exp(-dt * 1.2), 9, 62);
    if (k.has('-')) this.goal.dist = clamp(this.goal.dist * Math.exp(dt * 1.2), 9, 62);

    const c = this.cur, g = this.goal;
    c.x = damp(c.x, g.x, 7, dt);
    c.z = damp(c.z, g.z, 7, dt);
    c.yaw = damp(c.yaw, g.yaw, 7, dt);
    c.pitch = damp(c.pitch, g.pitch, 7, dt);
    c.dist = damp(c.dist, g.dist, 5, dt);
    this.groundY = damp(this.groundY, Math.max(terrainHeight(c.x, c.z), 0), 3, dt);

    this.target.set(c.x, this.groundY, c.z);
    const cp = Math.cos(c.pitch), sp2 = Math.sin(c.pitch);
    const pos = new THREE.Vector3(
      c.x + Math.sin(c.yaw) * cp * c.dist,
      this.groundY + sp2 * c.dist,
      c.z + Math.cos(c.yaw) * cp * c.dist,
    );
    // never dip under the hills
    const minY = terrainHeight(pos.x, pos.z) + 1.5;
    if (pos.y < minY) pos.y = minY;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }
}
