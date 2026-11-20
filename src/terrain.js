import * as THREE from 'three';
import { mulberry32, createNoise2D, smoothstep, lerp } from './noise.js';
import { seasonal } from './seasons.js';

// ---- Map layout -----------------------------------------------------------
export const GRID = 64;            // playable cells per side
export const HALF = GRID / 2;      // world spans [-HALF, HALF]
export const WORLD_SIZE = 120;     // terrain mesh incl. scenery border
export const WATER_LEVEL = 0;
export const LAKE = { x: 9, z: -5, rx: 11.5, rz: 8.5 };
export const ISLAND = { x: 12.5, z: -7, r: 1.9 };

const rng = mulberry32(1337);
const nA = createNoise2D(rng);
const nB = createNoise2D(rng);
const nC = createNoise2D(rng);

export function fbm(noise, x, z, oct = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += noise(x * freq, z * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

export function lakeDistance(x, z) {
  const lx = (x - LAKE.x) / LAKE.rx;
  const lz = (z - LAKE.z) / LAKE.rz;
  return Math.sqrt(lx * lx + lz * lz) + nC(x * 0.11, z * 0.11) * 0.16 + nC(x * 0.31 + 9, z * 0.31) * 0.04;
}

function baseHeight(x, z) {
  // gentle rolling meadow
  let h = 0.55 + fbm(nA, x * 0.03 + 3.1, z * 0.03 - 7.2, 4) * 0.85;
  h = 0.25 + Math.log1p(Math.exp((h - 0.25) * 4)) / 4; // soft floor so land stays above water
  // hills ringing the valley
  const r = Math.max(Math.abs(x), Math.abs(z)) + nB(x * 0.05, z * 0.05) * 4;
  h += smoothstep(HALF - 3, HALF + 16, r) * (4.5 + fbm(nB, x * 0.06, z * 0.06, 3) * 2.5);
  // lake basin
  const d = lakeDistance(x, z);
  const m = smoothstep(1.02, 0.62, d);
  const bed = -0.55 - smoothstep(0.75, 0.0, d) * 1.25;
  h = lerp(h, bed, m);
  // little island with a tree on it
  const id = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r;
  h = lerp(h, 0.42 + nA(x * 0.8, z * 0.8) * 0.05, smoothstep(1.25, 0.55, id));
  return h;
}

// ---- Stream ---------------------------------------------------------------
// A brook winds out of the western hills, passes north of the village and feeds the lake.
// Its course is z = streamZ(x) for x in [x0, x1]; its surface steps gently downhill.
export const STREAM = { x0: -66, x1: 0.6, mouth: -1.2, step: 0.25 };
export const streamZ = (x) => -4.5 + Math.sin((x + 1.5) * 0.15) * 3.0 + Math.sin(x * 0.33 + 0.7) * 1.3;
const streamDZ = (x) => 0.45 * Math.cos((x + 1.5) * 0.15) + 0.429 * Math.cos(x * 0.33 + 0.7);
export const streamWidth = (x) => 0.5 + 0.45 * smoothstep(-36, 0, x); // half-width of the water
const streamSurf = (() => {
  const n = Math.ceil((STREAM.x1 - STREAM.x0) / STREAM.step) + 1;
  const s = new Float32Array(n);
  let prev = Infinity;
  for (let i = 0; i < n; i++) {
    const x = STREAM.x0 + i * STREAM.step;
    prev = Math.min(prev, baseHeight(x, streamZ(x)) - 0.34);
    s[i] = Math.max(WATER_LEVEL, prev);
  }
  // soften the steps a little but keep it flowing downhill
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < n - 1; i++) s[i] = Math.min(s[i - 1], (s[i - 1] + s[i] * 2 + s[i + 1]) / 4);
  }
  for (let i = 0; i < n; i++) if (STREAM.x0 + i * STREAM.step > STREAM.mouth) s[i] = WATER_LEVEL;
  return s;
})();
export function streamSurface(x) {
  const f = (Math.min(Math.max(x, STREAM.x0), STREAM.x1) - STREAM.x0) / STREAM.step;
  const i = Math.min(streamSurf.length - 2, Math.floor(f));
  return lerp(streamSurf[i], streamSurf[i + 1], f - i);
}
// distance from (x,z) to the stream centre line, plus local width & surface height
export function streamInfo(x, z) {
  if (x < STREAM.x0 - 4 || x > STREAM.x1 + 2) return null;
  const xc = Math.min(Math.max(x, STREAM.x0), STREAM.x1);
  const dz = streamDZ(xc);
  const d = Math.abs(z - streamZ(xc)) / Math.sqrt(1 + dz * dz) + Math.max(0, x - STREAM.x1) * 2;
  if (d > 6) return null;
  return { d, w: streamWidth(xc), s: streamSurface(xc) };
}

export function terrainHeight(x, z) {
  const h = baseHeight(x, z);
  const st = streamInfo(x, z);
  if (!st) return h;
  const { d, w, s } = st;
  const target = d < w ? s - 0.04 - 0.36 * (1 - (d / w) ** 2) : s - 0.04 + (d - w) * 0.5;
  const m = smoothstep(w + 3.0, w + 1.2, d);
  return lerp(h, Math.min(h, target), m);
}

// ---- Grid helpers ---------------------------------------------------------
export const cellIndex = (i, j) => j * GRID + i;
export const inBounds = (i, j) => i >= 0 && j >= 0 && i < GRID && j < GRID;
export const cellCenter = (i, j) => ({ x: i - HALF + 0.5, z: j - HALF + 0.5 });
export const worldToCell = (x, z) => ({ i: Math.floor(x + HALF), j: Math.floor(z + HALF) });

export class Grid {
  constructor() {
    const n = GRID * GRID;
    this.water = new Uint8Array(n);      // 1 = water
    this.stream = new Uint8Array(n);     // 1 = brook (a bridge can be built here)
    this.bridge = new Uint8Array(n);     // 1 = bridge over the brook
    this.occ = new Int32Array(n).fill(-1); // building id
    this.path = new Uint8Array(n);       // 1 = path
    this.h = new Float32Array(n);        // centre height
    this.slope = new Float32Array(n);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const { x, z } = cellCenter(i, j);
        const k = cellIndex(i, j);
        const hc = terrainHeight(x, z);
        this.h[k] = hc;
        let mn = hc, mx = hc, wet = hc < WATER_LEVEL + 0.12;
        for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
          const hh = terrainHeight(x + ox, z + oz);
          mn = Math.min(mn, hh); mx = Math.max(mx, hh);
          if (hh < WATER_LEVEL + 0.02) wet = true;
        }
        const st = streamInfo(x, z);
        if (st && x < STREAM.mouth && st.d < st.w + 0.3) { wet = true; this.stream[k] = 1; }
        this.water[k] = wet ? 1 : 0;
        this.slope[k] = mx - mn;
      }
    }
  }
  isWater(i, j) { return !inBounds(i, j) || this.water[cellIndex(i, j)] === 1; }
  nearWater(i, j, r) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (inBounds(i + di, j + dj) && this.water[cellIndex(i + di, j + dj)]) return true;
    }
    return false;
  }
}

// ---- Terrain mesh ---------------------------------------------------------
// Seamless (periodic) noise so the texture tiles without seams or stretching.
//  R: soft large blobs   G: medium detail   B: smooth cells (worley)   A: fine detail
function periodicGradient(rng, period) {
  const g = [];
  for (let i = 0; i < period * period; i++) { const a = rng() * Math.PI * 2; g.push([Math.cos(a), Math.sin(a)]); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => { // x, y in [0, period)
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const at = (ix, iy, dx, dy) => { const v = g[((iy % period + period) % period) * period + ((ix % period + period) % period)]; return v[0] * dx + v[1] * dy; };
    const u = fade(xf), v = fade(yf);
    const n00 = at(xi, yi, xf, yf), n10 = at(xi + 1, yi, xf - 1, yf);
    const n01 = at(xi, yi + 1, xf, yf - 1), n11 = at(xi + 1, yi + 1, xf - 1, yf - 1);
    return (n00 + (n10 - n00) * u + (n01 - n00) * v + (n00 - n10 - n01 + n11) * u * v) * 1.41;
  };
}
function periodicFbm(rng, base, oct) {
  const layers = [];
  for (let o = 0; o < oct; o++) layers.push({ f: periodicGradient(rng, base << o), p: base << o, a: Math.pow(0.5, o) });
  const norm = layers.reduce((s, l) => s + l.a, 0);
  return (u, v) => layers.reduce((s, l) => s + l.f(u * l.p, v * l.p) * l.a, 0) / norm; // u, v in [0,1)
}
function periodicWorley(rng, period) {
  const pts = [];
  for (let i = 0; i < period * period; i++) pts.push([rng(), rng()]);
  return (u, v) => {
    const x = u * period, y = v * period, xi = Math.floor(x), yi = Math.floor(y);
    let d = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const p = pts[((cy % period + period) % period) * period + ((cx % period + period) % period)];
      d = Math.min(d, Math.hypot(cx + p[0] - x, cy + p[1] - y));
    }
    return Math.min(1, d);
  };
}

function makeNoiseTexture(size = 256) {
  const r = mulberry32(42);
  const fR = periodicFbm(r, 4, 4), fG = periodicFbm(r, 8, 4), wB = periodicWorley(r, 10), fA = periodicFbm(r, 32, 2);
  const data = new Uint8Array(size * size * 4);
  const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const k = (y * size + x) * 4;
    data[k] = to8(fR(u, v) * 0.5 + 0.5);
    data[k + 1] = to8(fG(u, v) * 0.5 + 0.5);
    data[k + 2] = to8(wB(u, v));
    data[k + 3] = to8(fA(u, v) * 0.5 + 0.5);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createTerrain(grid) {
  const seg = 240;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grassA = new THREE.Color('#86bb5a');
  const grassB = new THREE.Color('#a4c964');
  const grassDark = new THREE.Color('#6fa24f');
  const sand = new THREE.Color('#e3d3a0');
  const bed = new THREE.Color('#9fae7a');
  const deep = new THREE.Color('#6f8f72');
  const hill = new THREE.Color('#93b860');
  const c = new THREE.Color();
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v);
    const h = terrainHeight(x, z);
    pos.setY(v, h);
    const t = fbm(nB, x * 0.08, z * 0.08, 2) * 0.5 + 0.5;
    c.copy(grassA).lerp(grassB, smoothstep(0.35, 0.75, t));
    c.lerp(grassDark, smoothstep(0.55, 0.9, fbm(nC, x * 0.05 + 4, z * 0.05, 2) * 0.5 + 0.5) * 0.5);
    c.lerp(hill, smoothstep(1.2, 3.5, h) * 0.6);
    // sandy shore & lake bed
    c.lerp(sand, smoothstep(0.32, 0.12, h));
    c.lerp(bed, smoothstep(0.0, -0.3, h));
    c.lerp(deep, smoothstep(-0.4, -1.4, h));
    colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // path mask texture, one texel per cell -> bilinear filtering gives soft rounded paths
  const pathData = new Uint8Array(GRID * GRID * 4);
  const pathTex = new THREE.DataTexture(pathData, GRID, GRID, THREE.RGBAFormat);
  pathTex.magFilter = THREE.LinearFilter;
  pathTex.minFilter = THREE.LinearFilter;
  pathTex.needsUpdate = true;

  const noiseTex = makeNoiseTexture();
  const uniforms = {
    uPath: { value: pathTex },
    uNoise: { value: noiseTex },
    uHover: { value: new THREE.Vector3(0, 0, 0) },
    uGrid: { value: 0 },
    uGridColor: { value: new THREE.Color('#fff6dc') },
  };

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform sampler2D uPath; uniform sampler2D uNoise;
        uniform vec3 uHover; uniform float uGrid; uniform vec3 uGridColor;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec4 nz = texture2D(uNoise, vWPos.xz * 0.045);
        vec4 nzf = texture2D(uNoise, vWPos.xz * 0.37);
        diffuseColor.rgb *= 0.93 + 0.12 * nz.r + 0.05 * nzf.g;
        // soft dirt paths
        vec2 puv = (vWPos.xz + ${HALF.toFixed(1)}) / ${GRID.toFixed(1)};
        float p = texture2D(uPath, puv).r;
        float edge = smoothstep(0.40, 0.56, p + (nzf.r - 0.5) * 0.22);
        vec3 dirt = mix(vec3(0.80, 0.66, 0.47), vec3(0.88, 0.76, 0.56), nzf.g);
        dirt *= 0.92 + 0.16 * texture2D(uNoise, vWPos.xz * 0.6).a;
        float rim = smoothstep(0.25, 0.45, p) * (1.0 - edge);
        diffuseColor.rgb *= 1.0 - rim * 0.12; // slight darker trodden edge
        diffuseColor.rgb = mix(diffuseColor.rgb, dirt, edge);
        // placement grid that fades out around the cursor
        vec2 g = abs(fract(vWPos.xz) - 0.5);
        float line = smoothstep(0.455, 0.49, max(g.x, g.y));
        float inside = step(abs(vWPos.x), ${HALF.toFixed(1)}) * step(abs(vWPos.z), ${HALF.toFixed(1)});
        float fade = uGrid * inside * (1.0 - smoothstep(2.0, 6.5, distance(vWPos.xz, uHover.xz)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uGridColor, line * fade * 0.45);
      `);
  };

  seasonal(mat, { grass: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  function setPath(i, j, on) {
    const k = (j * GRID + i) * 4;
    pathData[k] = pathData[k + 1] = pathData[k + 2] = on ? 255 : 0;
    pathTex.needsUpdate = true;
  }

  return { mesh, uniforms, setPath, noiseTex };
}

// Ray vs heightfield (cheap, no triangle raycasting needed)
export function raycastTerrain(ray, maxDist = 400) {
  const o = ray.origin, d = ray.direction;
  let t = 0, step = 0.5, prev = 0;
  for (let n = 0; n < 1200 && t < maxDist; n++) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const h = Math.max(terrainHeight(x, z), WATER_LEVEL);
    if (y < h) {
      let a = prev, b = t;
      for (let k = 0; k < 18; k++) {
        const m = (a + b) / 2;
        const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
        if (my < Math.max(terrainHeight(mx, mz), WATER_LEVEL)) b = m; else a = m;
      }
      return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
    }
    prev = t; t += step; step = Math.min(step * 1.02, 1.5);
  }
  return null;
}
