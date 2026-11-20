import { bridgeModel } from './models.js';
import { cellIndex, cellCenter, inBounds, streamSurface } from './terrain.js';
import { easeOutBack } from './noise.js';

export const BRIDGE_COST = 2;

// Little wooden footbridges over the brook. Painting a path across the water builds them.
export class Bridges {
  constructor(scene, grid) {
    this.scene = scene;
    this.grid = grid;
    this.tiles = new Map(); // cell index -> { group, i, j, anim }
  }

  deckY(i, j) {
    const c = cellCenter(i, j);
    return streamSurface(c.x) + 0.3;
  }

  has(i, j) { return inBounds(i, j) && this.grid.bridge[cellIndex(i, j)] === 1; }

  add(i, j, instant = false) {
    const k = cellIndex(i, j);
    if (this.grid.bridge[k] || !this.grid.stream[k]) return false;
    this.grid.bridge[k] = 1;
    this._build(i, j, instant ? 1 : 0);
    // neighbours may lose a railing now that they connect to this tile
    for (const di of [-1, 1]) if (this.has(i + di, j)) this._build(i + di, j, 1);
    return true;
  }

  remove(i, j) {
    const k = cellIndex(i, j);
    if (!this.grid.bridge[k]) return false;
    this.grid.bridge[k] = 0;
    const t = this.tiles.get(k);
    if (t) { this.scene.remove(t.group); this._dispose(t.group); this.tiles.delete(k); }
    for (const di of [-1, 1]) if (this.has(i + di, j)) this._build(i + di, j, 1);
    return true;
  }

  _dispose(g) { g.traverse((o) => o.isMesh && o.geometry.dispose()); }

  _build(i, j, anim) {
    const k = cellIndex(i, j);
    const old = this.tiles.get(k);
    if (old) { this.scene.remove(old.group); this._dispose(old.group); }
    const group = bridgeModel({ railW: !this.has(i - 1, j), railE: !this.has(i + 1, j) }).build();
    const c = cellCenter(i, j);
    group.position.set(c.x, this.deckY(i, j), c.z);
    group.scale.setScalar(anim >= 1 ? 1 : 0.001);
    this.scene.add(group);
    this.tiles.set(k, { group, i, j, anim });
  }

  update(dt) {
    for (const t of this.tiles.values()) {
      if (t.anim >= 1) continue;
      t.anim = Math.min(1, t.anim + dt / 0.5);
      const s = easeOutBack(t.anim);
      t.group.scale.set(s, Math.max(0.001, s), s);
    }
  }

  serialize() { return [...this.tiles.keys()]; }
}

