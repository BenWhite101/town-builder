import * as THREE from 'three';
import { terrainHeight, LAKE, WATER_LEVEL } from './terrain.js';

// Stylised lake: colour by depth (baked from the heightfield), animated foam at the shoreline,
// soft sparkles and gentle waves. No render-to-texture, so it is cheap.
export function createWater() {
  const pad = 1.45;
  const w = LAKE.rx * 2 * pad, d = LAKE.rz * 2 * pad;
  const cx = LAKE.x, cz = LAKE.z;
  const res = 160;
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

  const geo = new THREE.PlaneGeometry(w, d, 96, 72);
  geo.rotateX(-Math.PI / 2);

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDepth: { value: null },
      uNoise: { value: null },
      uRect: { value: new THREE.Vector4(cx - w / 2, cz - d / 2, w, d) },
      uShallow: { value: new THREE.Color('#8fe0d2') },
      uDeep: { value: new THREE.Color('#3f8fb0') },
      uFoam: { value: new THREE.Color('#ffffff') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunColor: { value: new THREE.Color('#fff2d6') },
      uSky: { value: new THREE.Color('#bfe3f5') },
      uLight: { value: 1 },
    },
  ]);
  uniforms.uDepth.value = depthTex;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWPos;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        wp.y += sin(wp.x * 0.9 + uTime * 1.1) * 0.012 + sin(wp.z * 1.3 - uTime * 0.9) * 0.01;
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform sampler2D uDepth; uniform sampler2D uNoise;
      uniform vec4 uRect;
      uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSky;
      uniform float uLight;
      varying vec3 vWPos;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = (vWPos.xz - uRect.xy) / uRect.zw;
        float depth = texture2D(uDepth, uv).r * 2.4 - 0.4;
        if (depth < -0.02) discard;
        vec2 q = vWPos.xz;
        float n1 = texture2D(uNoise, q * 0.08 + vec2(uTime * 0.012, uTime * 0.008)).r;
        float n2 = texture2D(uNoise, q * 0.21 - vec2(uTime * 0.018, -uTime * 0.01)).g;
        float n = (n1 + n2) * 0.5;

        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.3, depth + (n - 0.5) * 0.2));

        // wave normal from noise gradient
        vec2 e = vec2(0.15, 0.0);
        float hx = texture2D(uNoise, (q + e.xy) * 0.21 - vec2(uTime * 0.018, -uTime * 0.01)).g - n2;
        float hz = texture2D(uNoise, (q + e.yx) * 0.21 - vec2(uTime * 0.018, -uTime * 0.01)).g - n2;
        vec3 N = normalize(vec3(-hx * 2.2, 1.0, -hz * 2.2));
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col = mix(col, uSky, fres * 0.55);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 220.0);
        col += uSunColor * spec * 1.6 * step(0.0, uSunDir.y);
        // sparkles
        float sp = texture2D(uNoise, q * 0.9 + vec2(uTime * 0.05, 0.0)).b * texture2D(uNoise, q * 0.7 - vec2(0.0, uTime * 0.04)).b;
        col += uSunColor * smoothstep(0.72, 0.8, sp) * 0.5 * uLight;

        // shoreline foam: a soft rim plus slow ripples that roll in
        float foamW = 0.1 + n * 0.12;
        float rim = 1.0 - smoothstep(0.0, foamW, depth);
        float bands = smoothstep(0.75, 1.0, sin(depth * 26.0 - uTime * 1.6 + n * 6.0) * 0.5 + 0.5)
                    * (1.0 - smoothstep(0.05, 0.38, depth));
        float foam = clamp(rim + bands * 0.55, 0.0, 1.0);
        col = mix(col * uLight, uFoam * (0.35 + 0.65 * uLight), foam * 0.85);

        float alpha = mix(0.62, 0.93, smoothstep(0.0, 0.9, depth));
        alpha = max(alpha, foam * 0.9);
        alpha *= smoothstep(-0.02, 0.03, depth);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, WATER_LEVEL, cz);
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return { mesh, uniforms };
}
