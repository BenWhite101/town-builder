import { GRID, cellIndex, inBounds, cellCenter } from './terrain.js';

// A* over the cell grid. cost(i,j) returns Infinity for blocked cells.
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

class Heap {
  constructor() { this.a = []; }
  push(n, f) { this.a.push([f, n]); let i = this.a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.a[p][0] <= this.a[i][0]) break; [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p; } }
  pop() {
    const top = this.a[0]; const last = this.a.pop();
    if (this.a.length) { this.a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < this.a.length && this.a[l][0] < this.a[m][0]) m = l; if (r < this.a.length && this.a[r][0] < this.a[m][0]) m = r; if (m === i) break; [this.a[m], this.a[i]] = [this.a[i], this.a[m]]; i = m; } }
    return top[1];
  }
  get size() { return this.a.length; }
}

const gScore = new Float32Array(GRID * GRID);
const came = new Int32Array(GRID * GRID);
const stamp = new Uint32Array(GRID * GRID);
const closed = new Uint32Array(GRID * GRID);
let gen = 1;

export function findPath(si, sj, ti, tj, cost) {
  if (!inBounds(si, sj) || !inBounds(ti, tj)) return null;
  gen++;
  const start = cellIndex(si, sj), goal = cellIndex(ti, tj);
  const heap = new Heap();
  stamp[start] = gen; gScore[start] = 0; came[start] = -1;
  heap.push(start, 0);
  const h = (i, j) => { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return (dx + dz + (1.414 - 2) * Math.min(dx, dz)) * 0.6; };
  let iter = 0;
  while (heap.size && iter++ < 6000) {
    const cur = heap.pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === goal) break;
    const ci = cur % GRID, cj = (cur / GRID) | 0;
    for (const [di, dj, w] of N8) {
      const ni = ci + di, nj = cj + dj;
      if (!inBounds(ni, nj)) continue;
      const c = cost(ni, nj);
      if (c === Infinity) continue;
      if (di && dj && (cost(ci + di, cj) === Infinity || cost(ci, cj + dj) === Infinity)) continue; // no corner cutting
      const nk = cellIndex(ni, nj);
      if (closed[nk] === gen) continue;
      const g = gScore[cur] + w * c;
      if (stamp[nk] !== gen || g < gScore[nk]) {
        stamp[nk] = gen; gScore[nk] = g; came[nk] = cur;
        heap.push(nk, g + h(ni, nj));
      }
    }
  }
  if (closed[goal] !== gen) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(k);
  cells.reverse();
  return cells.map((k) => cellCenter(k % GRID, (k / GRID) | 0));
}

// Drop waypoints that can be skipped with a clear straight line → natural, less zig-zaggy walking
export function smoothPath(pts, walkable) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    for (; b > a + 1; b--) if (lineClear(pts[a], pts[b], walkable)) break;
    out.push(pts[b]);
    a = b;
  }
  return out;
}

function lineClear(p, q, walkable) {
  const d = Math.hypot(q.x - p.x, q.z - p.z);
  const n = Math.ceil(d / 0.25);
  for (let s = 1; s < n; s++) {
    const t = s / n;
    const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
    if (!walkable(x, z)) return false;
  }
  return true;
}
