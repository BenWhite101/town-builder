import * as THREE from 'three';
import {
  terrainHeight, LAKE, WATER_LEVEL, STREAM, streamZ, streamWidth, streamSurface,
} from './terrain.js';

// Stylised water shared by the lake and the brook.
// The surface itself is flat: ripples come from a normal built out of smooth, seamless noise,
// so floating things (lily pads, bobbers, ripples) never get covered by moving geometry.

const COMMON = /* glsl */`
  uniform float uTime;
  uniform sampler2D uNoise;
  uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSky;
  uniform float uLight, uIce;

  // height of two soft noise layers drifting in different directions
  float wHeight(vec2 q) {
    float a = texture2D(uNoise, q * 0.085 + vec2(uTime * 0.011, uTime * 0.007)).g;
    float b = texture2D(uNoise, q * 0.19 + vec2(-uTime * 0.009, uTime * 0.013)).r;
    return a + b * 0.6;
  }
  vec3 wNormal(vec2 q) {
    float e = 0.18;
    float h = wHeight(q);
    float hx = wHeight(q + vec2(e, 0.0));
    float hz = wHeight(q + vec2(0.0, e));
    return normalize(vec3((h - hx) * 2.2, 1.0, (h - hz) * 2.2));
  }

  // depth in world units; foamBoost adds whitewater (rapids)
  vec4 shadeWater(vec3 wp, vec3 N, float depth, float foamBoost) {
    vec2 q = wp.xz;
    float n = texture2D(uNoise, q * 0.06).r;
    vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.2, depth + (n - 0.5) * 0.25));
    // soft light patches dancing over the shallows
    float cau = texture2D(uNoise, q * 0.32 + N.xz * 0.35 + vec2(uTime * 0.015, -uTime * 0.01)).b;
    col += vec3(1.0, 0.98, 0.9) * (1.0 - smoothstep(0.08, 0.3, cau)) * 0.1 * (1.0 - smoothstep(0.1, 1.0, depth));
    vec3 V = normalize(cameraPosition - wp);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col = mix(col, uSky, 0.1 + fres * 0.5);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 160.0) * step(0.0, uSunDir.y);
    col += uSunColor * spec * 1.1;
    col *= uLight;

    // shoreline foam: a soft rim and one gentle band that breathes in and out
    float rim = 1.0 - smoothstep(0.0, 0.06 + n * 0.1, depth);
    float band = smoothstep(0.55, 1.0, sin(depth * 16.0 - uTime * 1.1 + n * 5.0) * 0.5 + 0.5)
               * (1.0 - smoothstep(0.03, 0.2, depth)) * 0.45;
    float foam = clamp(rim + band + foamBoost, 0.0, 1.0);
    // winter: icy, frosted edges
    float ice = uIce * (1.0 - smoothstep(0.0, 0.12 + uIce * 0.35 + n * 0.15, depth));
    col = mix(col, vec3(0.86, 0.93, 0.97) * (0.4 + 0.6 * uLight), ice * 0.9);
    col = mix(col, uFoam * (0.35 + 0.65 * uLight), foam * 0.8);

    float alpha = mix(0.6, 0.92, smoothstep(0.0, 0.9, depth));
    alpha = max(alpha, max(foam * 0.9, ice));
    return vec4(col, alpha);
  }
`;

function baseUniforms() {
  return THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uNoise: { value: null },
      uShallow: { value: new THREE.Color('#93e2d4') },
      uDeep: { value: new THREE.Color('#4596b8') },
      uFoam: { value: new THREE.Color('#ffffff') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunColor: { value: new THREE.Color('#fff2d6') },
      uSky: { value: new THREE.Color('#bfe3f5') },
      uLight: { value: 1 },
      uIce: { value: 0 },
    },
  ]);
}

export function createWater() {
  const pad = 1.45;
  const w = LAKE.rx * 2 * pad, d = LAKE.rz * 2 * pad;
  const cx = LAKE.x, cz = LAKE.z;
  const res = 192;
  const data = new Uint8Array(res * res * 4);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const wx = cx - w / 2 + (x + 0.5) / res * w;
    const wz = cz - d / 2 + (y + 0.5) / res * d;
    const depth = WATER_LEVEL - terrainHeight(wx, wz); // >0 under water
    const v = Math.min(1, Math.max(0, (depth + 0.4) / 2.4));
    const k = (y * res + x) * 4;
    data[k] = v * 255; data[k + 1] = data[k + 2] = 0; data[k + 3] = 255;
  }
  const depthTex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(w, d, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const uniforms = baseUniforms();
  uniforms.uDepth = { value: depthTex };
  uniforms.uRect = { value: new THREE.Vector4(cx - w / 2, cz - d / 2, w, d) };

  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, fog: true, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vWPos;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      ${COMMON}
      uniform sampler2D uDepth;
      uniform vec4 uRect;
      varying vec3 vWPos;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = (vWPos.xz - uRect.xy) / uRect.zw;
        float depth = texture2D(uDepth, uv).r * 2.4 - 0.4;
        if (depth < -0.02) discard;
        vec3 N = wNormal(vWPos.xz);
        vec4 c = shadeWater(vWPos, N, depth, 0.0);
        c.a *= smoothstep(-0.02, 0.03, depth);
        gl_FragColor = c;
        #include <fog_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, WATER_LEVEL, cz);
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return { mesh, uniforms };
}

// The brook: a ribbon that follows the stream's course, flowing downhill toward the lake.
export function createStream() {
  const xs = [];
  for (let x = -60; x <= STREAM.x1; x += 0.25) xs.push(x);
  const n = xs.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const dir = new Float32Array(n * 2 * 2);
  const extra = new Float32Array(n * 2 * 3); // steepness, fade, half-width
  const idx = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], z = streamZ(x);
    const xa = xs[Math.max(0, i - 1)], xb = xs[Math.min(n - 1, i + 1)];
    let tx = xb - xa, tz = streamZ(xb) - streamZ(xa);
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx; // left normal
    const hw = streamWidth(x) + 0.32;
    const y = streamSurface(x) + 0.005;
    const drop = streamSurface(xa) - streamSurface(xb);
    const steep = Math.min(1, Math.max(0, drop / Math.max(0.01, xb - xa) * 2.2));
    const fade = 1 - Math.min(1, Math.max(0, (x - (STREAM.mouth - 0.8)) / 1.6));
    if (i > 0) along += Math.hypot(x - xs[i - 1], z - streamZ(xs[i - 1]));
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s, side = s ? -1 : 1;
      pos[k * 3] = x + nx * hw * side; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z + nz * hw * side;
      uv[k * 2] = s; uv[k * 2 + 1] = along;
      dir[k * 2] = tx; dir[k * 2 + 1] = tz;
      extra[k * 3] = steep; extra[k * 3 + 1] = fade; extra[k * 3 + 2] = hw;
    }
    if (i < n - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 2));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const uniforms = baseUniforms();
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, fog: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec2 aDir; attribute vec3 aExtra;
      varying vec3 vWPos; varying vec2 vUv; varying vec2 vDir; varying vec3 vExtra;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vDir = aDir; vExtra = aExtra;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      ${COMMON}
      varying vec3 vWPos; varying vec2 vUv; varying vec2 vDir; varying vec3 vExtra;
      #include <fog_pars_fragment>
      void main() {
        // two-phase flow so the ripples travel downstream without smearing over time
        float sp = 0.9 + vExtra.x * 2.5;
        float p0 = fract(uTime * 0.18), p1 = fract(uTime * 0.18 + 0.5);
        float wgt = abs(1.0 - 2.0 * p0);
        vec2 q = vWPos.xz;
        vec3 N0 = wNormal(q - vDir * p0 * sp * 5.0);
        vec3 N1 = wNormal(q - vDir * p1 * sp * 5.0 + 3.7);
        vec3 N = normalize(mix(N1, N0, wgt));
        float across = abs(vUv.x * 2.0 - 1.0);              // 0 centre, 1 edge
        float hw = vExtra.z;
        float dd = across * hw / max(0.2, hw - 0.32);       // 1 where the water meets the bank
        float depth = max(0.0, 1.0 - dd * dd) * 0.75;
        // whitewater on the little drops
        float rap = texture2D(uNoise, (q - vDir * uTime * 1.4) * 0.5).g;
        float foamBoost = vExtra.x * smoothstep(0.45, 0.7, rap) * 0.9;
        vec4 c = shadeWater(vWPos, N, depth, foamBoost);
        c.a *= vExtra.y;
        gl_FragColor = c;
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.name = 'stream';
  return { mesh, uniforms };
}
