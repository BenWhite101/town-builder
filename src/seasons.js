import * as THREE from 'three';
import { smoothstep, lerp } from './noise.js';

export const DAYS_PER_SEASON = 3;

// What each season looks and feels like. Values blend smoothly into the next season.
const SEASONS = [
  { name: 'Spring', icon: '🌸', grass: [1.0, 1.05, 0.9], autumn: 0, blossom: 1, snow: 0, ice: 0, crop: 1.0, leaves: 0.35, snowfall: 0, fireflies: 0.4, flowers: 1 },
  { name: 'Summer', icon: '🌻', grass: [1.05, 1.0, 0.82], autumn: 0, blossom: 0, snow: 0, ice: 0, crop: 1.25, leaves: 0, snowfall: 0, fireflies: 1, flowers: 1 },
  { name: 'Autumn', icon: '🍂', grass: [1.12, 0.94, 0.68], autumn: 1, blossom: 0, snow: 0, ice: 0, crop: 0.8, leaves: 1, snowfall: 0, fireflies: 0.15, flowers: 0.4 },
  { name: 'Winter', icon: '❄️', grass: [0.92, 0.96, 1.0], autumn: 0.35, blossom: 0, snow: 1, ice: 1, crop: 0.25, leaves: 0, snowfall: 1, fireflies: 0, flowers: 0 },
];
export const SEASON_NAMES = SEASONS.map((s) => s.name);

// Shared uniforms: every patched material reads these, so one update changes the whole world.
export const SU = {
  uSnow: { value: 0 },
  uAutumn: { value: 0 },
  uBlossom: { value: 0 },
  uGrassTint: { value: new THREE.Color(1, 1, 1) },
};

export function seasonAt(day, dayT) {
  const pos = ((day - 1) + dayT) / DAYS_PER_SEASON;
  const idx = Math.floor(pos) % 4;
  const frac = pos - Math.floor(pos);
  const a = SEASONS[idx], b = SEASONS[(idx + 1) % 4];
  const k = smoothstep(0.7, 1.0, frac); // the last stretch of a season fades into the next
  const out = { index: idx, name: a.name, icon: a.icon, next: b.name, frac };
  for (const key of ['autumn', 'blossom', 'snow', 'ice', 'crop', 'leaves', 'snowfall', 'fireflies', 'flowers']) out[key] = lerp(a[key], b[key], k);
  // snow settles in slowly once winter begins and melts at the start of spring
  if (a.name === 'Winter') out.snow = Math.min(out.snow, smoothstep(0.0, 0.25, frac));
  out.grass = a.grass.map((v, i) => lerp(v, b.grass[i], k));
  return out;
}

export function applySeason(st) {
  SU.uSnow.value = st.snow;
  SU.uAutumn.value = st.autumn;
  SU.uBlossom.value = st.blossom;
  SU.uGrassTint.value.setRGB(st.grass[0], st.grass[1], st.grass[2]);
}

/**
 * Patch a built-in material so it reacts to the season:
 *  - snow settles on upward-facing surfaces
 *  - foliage turns gold/red in autumn and some trees blossom pink in spring
 *  - grass-coloured things take the season's grass tint
 */
export function seasonal(mat, { foliage = false, grass = false, snow = 1 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, SU, { uSnowAmt: { value: snow } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSWPos; varying vec3 vSWNormal; varying float vSeed;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec4 sp = vec4(transformed, 1.0);
          vec3 sn = objectNormal;
          vSeed = 0.5;
          #ifdef USE_INSTANCING
            sp = instanceMatrix * sp;
            sn = mat3(instanceMatrix) * sn;
            vec4 so = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            vSeed = fract(sin(dot(so.xz, vec2(12.9898, 78.233))) * 43758.5453);
          #endif
          vSWPos = (modelMatrix * sp).xyz;
          vSWNormal = normalize(mat3(modelMatrix) * sn);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSWPos; varying vec3 vSWNormal; varying float vSeed;
        uniform float uSnow, uAutumn, uBlossom, uSnowAmt; uniform vec3 uGrassTint;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${grass ? 'diffuseColor.rgb *= uGrassTint;' : ''}
          ${foliage ? `
            // (linear colour space) russet → amber → gold
            float pick = fract(vSeed * 7.13);
            vec3 autumnCol = pick < 0.5 ? mix(vec3(0.62, 0.1, 0.03), vec3(0.85, 0.3, 0.04), pick * 2.0)
                                        : mix(vec3(0.85, 0.3, 0.04), vec3(0.9, 0.55, 0.06), pick * 2.0 - 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, autumnCol, uAutumn * smoothstep(0.08, 0.35, vSeed));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.45, 0.6), uBlossom * step(0.68, vSeed) * 0.9);
          ` : ''}
          float speck = sin(vSWPos.x * 3.7 + sin(vSWPos.z * 2.3)) * sin(vSWPos.z * 3.1) * 0.5 + 0.5;
          float up = smoothstep(0.25 + speck * 0.35, 0.75 + speck * 0.15, normalize(vSWNormal).y);
          float sn = clamp(uSnow * uSnowAmt * up * (0.75 + 0.5 * speck), 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 1.0), sn);
        }`);
  };
  const key = `season-${foliage}-${grass}-${snow}-${prev ? prev.toString() : ''}`;
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}
