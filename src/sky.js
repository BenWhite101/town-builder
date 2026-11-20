import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from './noise.js';

// Keyframed palette over the day (t: 0 = midnight, 0.5 = noon)
const KEYS = [
  { t: 0.00, top: '#1b2442', hor: '#3b4a6e', sun: '#8fa6e0', si: 0.35, hemiSky: '#56689e', hemiGnd: '#2f3442', hi: 0.7, fog: '#33405f', exp: 1.0 },
  { t: 0.20, top: '#273257', hor: '#5b5f86', sun: '#a0a8d8', si: 0.25, hemiSky: '#5a6696', hemiGnd: '#353444', hi: 0.6, fog: '#4c557b', exp: 1.0 },
  { t: 0.25, top: '#7d8fc4', hor: '#f3b48f', sun: '#ffb37a', si: 1.2, hemiSky: '#b8a8c8', hemiGnd: '#6d6450', hi: 0.8, fog: '#e7b79a', exp: 1.0 },
  { t: 0.32, top: '#8cc3ee', hor: '#f6dcc0', sun: '#ffe2b8', si: 2.4, hemiSky: '#cfe4f5', hemiGnd: '#7e8f5a', hi: 1.0, fog: '#e9e0cf', exp: 1.0 },
  { t: 0.50, top: '#79b8ec', hor: '#d9ecf5', sun: '#fff3dc', si: 2.9, hemiSky: '#d6ebfa', hemiGnd: '#84955c', hi: 1.05, fog: '#d8e8ee', exp: 1.0 },
  { t: 0.68, top: '#83b6e3', hor: '#f4dfbf', sun: '#ffe0aa', si: 2.5, hemiSky: '#d8e2ef', hemiGnd: '#8a8a58', hi: 1.0, fog: '#ecdfc8', exp: 1.0 },
  { t: 0.75, top: '#7b7fbf', hor: '#f7a77a', sun: '#ff9d5c', si: 1.5, hemiSky: '#c0a3c0', hemiGnd: '#6e5a48', hi: 0.85, fog: '#eca88a', exp: 1.0 },
  { t: 0.80, top: '#3e3f72', hor: '#a06a82', sun: '#b29ad8', si: 0.35, hemiSky: '#6a6a9e', hemiGnd: '#3d3444', hi: 0.6, fog: '#6a5a78', exp: 1.0 },
  { t: 0.86, top: '#1e2747', hor: '#3e4b70', sun: '#8fa6e0', si: 0.35, hemiSky: '#56689e', hemiGnd: '#2f3442', hi: 0.7, fog: '#35425f', exp: 1.0 },
  { t: 1.00, top: '#1b2442', hor: '#3b4a6e', sun: '#8fa6e0', si: 0.35, hemiSky: '#56689e', hemiGnd: '#2f3442', hi: 0.7, fog: '#33405f', exp: 1.0 },
].map((k) => ({ ...k, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun), hemiSky: new THREE.Color(k.hemiSky), hemiGnd: new THREE.Color(k.hemiGnd), fog: new THREE.Color(k.fog) }));

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.state = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(), fog: new THREE.Color(), si: 1, hi: 1 };

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xd8e8ee, 50, 150);
    scene.fog = this.fog;

    // gradient dome
    this.domeU = {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uNight: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(450, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.domeU, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
        fragmentShader: `
          uniform vec3 uTop, uHor, uSunDir, uSunCol; uniform float uNight;
          varying vec3 vDir;
          float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
          void main(){
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 col = mix(uHor, uTop, smoothstep(-0.02, 0.55, h));
            float s = max(dot(vDir, normalize(uSunDir)), 0.0);
            col += uSunCol * (pow(s, 8.0) * 0.25 + pow(s, 400.0) * 1.5) * (1.0 - uNight);
            // stars
            vec3 sd = floor(vDir * 180.0);
            float st = step(0.997, hash(sd)) * smoothstep(0.05, 0.4, h) * uNight;
            col += vec3(st) * 0.9;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    scene.add(dome);
    this.dome = dome;

    // moon
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff6dd', fog: false, transparent: true }));
    this.moon.renderOrder = -9;
    scene.add(this.moon);

    this._buildClouds();
  }

  _buildClouds() {
    this.clouds = [];
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.35, transparent: true, opacity: 0.95, fog: true });
    this.cloudMat = mat;
    for (let c = 0; c < 12; c++) {
      const parts = [];
      const n = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const r = 1.6 + Math.random() * 1.8;
        const s = new THREE.IcosahedronGeometry(r, 2);
        s.translate((i - n / 2) * 1.9 + Math.random(), Math.random() * 0.8, (Math.random() - 0.5) * 2);
        parts.push(s);
      }
      const geo = mergeGeometries(parts);
      geo.scale(1, 0.55, 0.8);
      const m = new THREE.Mesh(geo, mat);
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 60;
      m.position.set(Math.cos(a) * r, 22 + Math.random() * 10, Math.sin(a) * r);
      m.userData.speed = 0.4 + Math.random() * 0.4;
      this.scene.add(m);
      this.clouds.push(m);
    }
  }

  // returns night factor 0..1
  update(t, dt, focus) {
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    const k = smoothstep(0, 1, (t - a.t) / (b.t - a.t || 1));
    const s = this.state;
    for (const key of ['top', 'hor', 'sun', 'hemiSky', 'hemiGnd', 'fog']) s[key].copy(a[key]).lerp(b[key], k);
    s.si = a.si + (b.si - a.si) * k;
    s.hi = a.hi + (b.hi - a.hi) * k;

    // sun arc (rises in the east-ish, sets west) – tilted so shadows are always pleasant
    // daylight spans t = 0.2 .. 0.82 so dusk stays golden rather than murky
    const df = (t - 0.2) / 0.62;
    const ang = df * Math.PI;
    const sunDir = new THREE.Vector3(-Math.cos(ang) * 0.85, Math.sin(ang) * 0.9 + (df > 0 && df < 1 ? 0.04 : -0.06), 0.45 + Math.cos(ang) * 0.1).normalize();
    if (df <= 0 || df >= 1) sunDir.y = -Math.abs(sunDir.y) - 0.1;
    const night = smoothstep(0.22, 0.17, t) + smoothstep(0.79, 0.84, t);
    this.night = Math.min(1, night);
    const moonDir = new THREE.Vector3(-sunDir.x, Math.max(0.35, -sunDir.y), sunDir.z * 0.6 + 0.4).normalize();
    // light direction: sun during the day, moon at night (switch hidden at dusk/dawn when intensity is low)
    const useSun = sunDir.y > 0.02;
    const L = useSun ? sunDir : moonDir;
    const lightDir = L.clone();
    lightDir.y = Math.max(lightDir.y, 0.18);
    lightDir.normalize();
    const f = focus || new THREE.Vector3();
    this.sun.position.copy(f).addScaledVector(lightDir, 60);
    this.sun.target.position.copy(f);
    this.sun.color.copy(s.sun);
    // fade out around the switch so there's no visible snap
    const sw = useSun ? smoothstep(0.02, 0.14, sunDir.y) : smoothstep(0.1, 0.2, -sunDir.y);
    this.sun.intensity = s.si * (0.25 + 0.75 * sw);
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGnd);
    this.hemi.intensity = s.hi;
    this.fog.color.copy(s.fog);

    this.domeU.uTop.value.copy(s.top);
    this.domeU.uHor.value.copy(s.hor);
    this.domeU.uSunDir.value.copy(sunDir);
    this.domeU.uSunCol.value.copy(s.sun);
    this.domeU.uNight.value = this.night;
    this.moon.position.copy(moonDir).multiplyScalar(380);
    this.moon.material.opacity = this.night;
    this.moon.visible = this.night > 0.01;

    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 110) c.position.x = -110;
    }
    this.cloudMat.color.copy(s.hor).lerp(new THREE.Color(1, 1, 1), 0.6 - this.night * 0.3);
    this.cloudMat.emissive.copy(s.hor).lerp(s.sun, 0.3);
    this.cloudMat.emissiveIntensity = 0.25 + (1 - this.night) * 0.2;

    this.sunDir = sunDir;
    return this.night;
  }
}
