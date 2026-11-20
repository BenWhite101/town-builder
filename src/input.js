import { DEFS } from './buildings.js';

// Separate mouse and touch handling.
//
// Mouse: left-drag pans (or paints with the path/demolish tools), a click without movement
//        places/acts, right-drag orbits, middle-click rotates the building, wheel zooms.
// Touch: one finger pans (or paints/erases with the path/demolish tools), two fingers pinch to
//        zoom, twist to turn and move together to pan. A tap is only a tap if the finger barely
//        moved, was quick, and no second finger joined – so moving the camera never taps the world.
//        Buildings are placed in two steps: tap/drag to position the preview, then press Build.

const TAP_SLOP = 10;      // px a finger may wander and still count as a tap
const TAP_TIME = 450;     // ms
const MOUSE_SLOP = 5;

export class Input {
  constructor(game) {
    this.game = game;
    this.rig = game.rig;
    this.c = game.canvas;
    this.touches = new Map();   // pointerId -> {x, y, sx, sy, t}
    this.gesture = null;        // touch gesture state
    this.mouse = null;          // mouse drag state

    const c = this.c;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e, false));
    c.addEventListener('pointercancel', (e) => this._up(e, true));
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') game.mouse.in = false; });
    // stop iOS from turning gestures into page zoom/scroll
    for (const ev of ['gesturestart', 'gesturechange']) c.addEventListener(ev, (e) => e.preventDefault());
  }

  _isTouch(e) { return e.pointerType === 'touch'; }

  _down(e) {
    const g = this.game;
    g.audio.init();
    if (this._isTouch(e)) { g.setInputMode('touch'); this._touchDown(e); return; }
    g.setInputMode('mouse');
    this._mouseDown(e);
  }

  _move(e) {
    if (this._isTouch(e)) { this._touchMove(e); return; }
    const g = this.game;
    // ignore synthetic zero-movement mouse events some touch browsers send
    if (g.inputMode === 'touch' && e.movementX === 0 && e.movementY === 0) return;
    if (g.inputMode !== 'mouse' && !this.mouse) g.setInputMode('mouse');
    this._mouseMove(e);
  }

  _up(e, cancelled) {
    if (this._isTouch(e)) { this._touchUp(e, cancelled); return; }
    this._mouseUp(e, cancelled);
  }

  // ---------------------------------------------------------------- mouse
  _mouseDown(e) {
    const g = this.game;
    g.mouse.x = e.clientX; g.mouse.y = e.clientY; g.mouse.in = true;
    if (!g.playing) return;
    const m = { button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, mode: 'pending' };
    if (e.button === 1) {
      e.preventDefault();
      if (g.tool && DEFS[g.tool] && g.tool !== 'path') { g.rotate(); return; }
      m.mode = 'pan'; this.rig.grab();
    } else if (e.button === 2) {
      m.mode = 'orbit';
    } else if (e.button === 0 && (g.tool === 'path' || g.tool === 'demolish')) {
      m.mode = 'stroke';
      g.beginStroke(g.tool);
      g.strokeAt(e.clientX, e.clientY);
    }
    this.mouse = m;
    try { this.c.setPointerCapture(e.pointerId); } catch { /* */ }
  }

  _mouseMove(e) {
    const g = this.game;
    g.mouse.x = e.clientX; g.mouse.y = e.clientY; g.mouse.in = true;
    const m = this.mouse;
    if (!m) return;
    const dx = e.clientX - m.x, dy = e.clientY - m.y;
    m.x = e.clientX; m.y = e.clientY;
    m.moved = Math.max(m.moved, Math.hypot(e.clientX - m.sx, e.clientY - m.sy));
    if (m.mode === 'pending' && m.moved > MOUSE_SLOP) { m.mode = 'pan'; this.rig.grab(); this.rig.panPixels(e.clientX - m.sx, e.clientY - m.sy); return; }
    if (m.mode === 'pan') this.rig.panPixels(dx, dy);
    else if (m.mode === 'orbit') this.rig.orbitPixels(dx, dy);
    else if (m.mode === 'stroke') g.strokeAt(e.clientX, e.clientY);
  }

  _mouseUp(e, cancelled) {
    const g = this.game;
    const m = this.mouse;
    this.mouse = null;
    try { this.c.releasePointerCapture(e.pointerId); } catch { /* */ }
    if (!m) return;
    if (m.mode === 'pan') this.rig.release();
    if (m.mode === 'stroke') g.endStroke();
    if (cancelled) return;
    if (m.mode === 'pending' && m.button === 0) g.click(e.clientX, e.clientY);
    if (m.mode === 'orbit' && m.moved < MOUSE_SLOP && g.tool) g.setTool(null); // right-click = put tool down
  }

  // ---------------------------------------------------------------- touch
  _touchDown(e) {
    const g = this.game;
    try { this.c.setPointerCapture(e.pointerId); } catch { /* */ }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (!g.playing) return;
    if (this.touches.size === 1) {
      // decide what this finger does once it moves
      let intent = 'pan';
      if ((g.tool === 'path' || g.tool === 'demolish')) intent = 'stroke';
      else if (g.tool && DEFS[g.tool] && g.isOnGhost(e.clientX, e.clientY)) intent = 'ghost';
      this.gesture = { kind: 'pending', intent, id: e.pointerId, t: performance.now() };
      if (intent === 'ghost') g.beginGhostDrag(e.clientX, e.clientY);
    } else if (this.touches.size === 2) {
      // second finger: whatever the first finger was doing becomes a camera gesture
      if (this.gesture?.kind === 'stroke') g.endStroke();
      if (this.gesture?.kind === 'pan') this.rig.release();
      if (this.gesture?.intent === 'ghost') g.endGhostDrag();
      this._startMulti();
    } else {
      this.gesture = { kind: 'ignore' };
    }
  }

  _startMulti() {
    const [a, b] = [...this.touches.values()];
    this.gesture = {
      kind: 'multi',
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
    };
    this.rig.grab();
  }

  _touchMove(e) {
    const p = this.touches.get(e.pointerId);
    if (!p) return;
    const g = this.game;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const s = this.gesture;
    if (!s || !g.playing) return;

    if (s.kind === 'multi' && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (s.dist > 10 && dist > 10) this.rig.zoomBy(s.dist / dist, { followPitch: true });
      let da = ang - s.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      this.rig.rotateBy(da);
      this.rig.panPixels(mx - s.mx, my - s.my);
      s.dist = dist; s.ang = ang; s.mx = mx; s.my = my;
      return;
    }
    if (e.pointerId !== s.id) return;

    if (s.kind === 'pending') {
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < TAP_SLOP) return;
      if (s.intent === 'stroke') {
        s.kind = 'stroke';
        g.beginStroke(g.tool);
        g.strokeAt(p.sx, p.sy);
        g.strokeAt(e.clientX, e.clientY);
      } else if (s.intent === 'ghost') {
        s.kind = 'ghost';
        g.ghostDragTo(e.clientX, e.clientY);
      } else {
        s.kind = 'pan';
        this.rig.grab();
        this.rig.panPixels(e.clientX - p.sx, e.clientY - p.sy);
      }
      return;
    }
    if (s.kind === 'pan') this.rig.panPixels(dx, dy);
    else if (s.kind === 'stroke') g.strokeAt(e.clientX, e.clientY);
    else if (s.kind === 'ghost') g.ghostDragTo(e.clientX, e.clientY);
  }

  _touchUp(e, cancelled) {
    const g = this.game;
    const p = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    try { this.c.releasePointerCapture(e.pointerId); } catch { /* */ }
    const s = this.gesture;
    if (!s) return;

    if (s.kind === 'multi') {
      if (this.touches.size < 2) {
        this.rig.release();
        // the remaining finger must lift before it can do anything else (no accidental taps)
        this.gesture = this.touches.size ? { kind: 'ignore' } : null;
      }
      return;
    }
    if (e.pointerId !== s.id) return;
    this.gesture = null;
    if (s.kind === 'pan') this.rig.release();
    else if (s.kind === 'stroke') g.endStroke();
    else if (s.kind === 'ghost') g.endGhostDrag();
    else if (s.kind === 'pending') {
      if (s.intent === 'ghost') g.endGhostDrag();
      const quick = performance.now() - s.t < TAP_TIME;
      const still = p && Math.hypot(p.x - p.sx, p.y - p.sy) < TAP_SLOP;
      if (!cancelled && quick && still && g.playing) g.tap(p.x, p.y);
    }
  }
}
