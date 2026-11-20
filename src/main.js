import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';

import {
  Grid, createTerrain, raycastTerrain, worldToCell, cellIndex, inBounds, cellCenter, terrainHeight, HALF, LAKE,
} from './terrain.js';
import { createWater } from './water.js';
import { Nature, START } from './nature.js';
import { Sky } from './sky.js';
import { CameraRig } from './camera.js';
import { Buildings, DEFS } from './buildings.js';
import { Villagers, JOB_LABEL } from './villagers.js';
import { Fish } from './fish.js';
import { Particles, Ripples } from './particles.js';
import { Audio } from './audio.js';
import { damp } from './noise.js';
import { UI } from './ui.js';

const DAY_LENGTH = 300; // seconds per in-game day at 1x
const SAVE_KEY = 'hearthvale-save-v1';
const MAX_POP = 60;

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.55 }, uSat: { value: 1.08 }, uTint: { value: new THREE.Vector3(1.02, 1.0, 0.97) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat) * uTint;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * uVignette;
      gl_FragColor = c;
    }`,
};

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 1000);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.timeU = { value: 0 };

    this.quality = 'high';
    try { this.quality = localStorage.getItem('hearthvale-gfx') || 'high'; } catch { /* storage unavailable */ }

    this.audio = new Audio();
    this.grid = new Grid();
    this.terrain = createTerrain(this.grid);
    this.scene.add(this.terrain.mesh);
    this.water = createWater();
    this.water.uniforms.uNoise.value = this.terrain.noiseTex;
    this.scene.add(this.water.mesh);
    this.sky = new Sky(this.scene);
    this.nature = new Nature(this.scene, this.grid, this.timeU);
    this.particles = new Particles(this.scene, 900);
    this.sparks = new Particles(this.scene, 160, { additive: true });
    this.ripples = new Ripples(this.scene);
    this.fish = new Fish(this.scene, this.ripples, this.particles, this.audio);
    this.buildings = new Buildings(this.scene, this.grid, this.terrain, this.nature, this.particles, this.audio);
    this.villagers = new Villagers(this);
    this.rig = new CameraRig(this.camera, this.canvas);

    this.res = { wood: 30, food: 12 };
    this.day = 1;
    this.dayT = 0.3;
    this.speed = 1;
    this.tool = null;
    this.rot = 0;
    this.growT = 0;
    this.saveT = 0;
    this.playing = false;
    this.mouse = { x: 0, y: 0, in: false };
    this.hover = null;
    this.bobbers = [];

    this._setupPost();
    this._setupGhost();
    this.ui = new UI(this);
    this._setupInput();
    this.applyQuality();
    addEventListener('resize', () => this.resize());
    this.resize();

    if (!this.load()) this.newVillage();
    this.ui.refresh(true);
    this._fps = { t: 0, n: 0, low: 0 };
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- setup ----------------------------------------------------------------------------
  _setupPost() {
    const size = new THREE.Vector2(innerWidth, innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.32, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.tiltH.uniforms.r.value = this.tiltV.uniforms.r.value = 0.5;
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  _setupGhost() {
    this.ghost = null;
    this.ghostPos = new THREE.Vector3();
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
    plate.rotation.x = -Math.PI / 2;
    plate.renderOrder = 4;
    plate.visible = false;
    this.scene.add(plate);
    this.cellPlate = plate;
    this.bobberGeo = new THREE.SphereGeometry(0.035, 10, 8);
    this.bobberMat = new THREE.MeshStandardMaterial({ color: '#e8574a', roughness: 0.5 });
  }

  makeBobber() {
    const m = new THREE.Mesh(this.bobberGeo, this.bobberMat);
    this.scene.add(m);
    this.bobbers.push(m);
    return m;
  }
  removeBobber(m) { this.scene.remove(m); this.bobbers = this.bobbers.filter((b) => b !== m); }

  applyQuality() {
    const high = this.quality === 'high';
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 1.6 : 1));
    const ms = high ? 2048 : 1024;
    if (this.sky.sun.shadow.mapSize.x !== ms) {
      this.sky.sun.shadow.mapSize.set(ms, ms);
      this.sky.sun.shadow.map?.dispose();
      this.sky.sun.shadow.map = null;
    }
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.particles.uniforms.uScale.value = h * pr * 0.9;
    this.sparks.uniforms.uScale.value = h * pr * 0.9;
  }

  // ---- game state ------------------------------------------------------------------------
  newVillage() {
    const sc = worldToCell(START.x, START.z);
    const { b: store } = this.buildings.place('storehouse', sc.i, sc.j, 0, { instant: true, seed: 1 });
    const e = store.entrance;
    for (const [di, dj] of [[0, 0], [0, 1], [0, 2], [-1, 2], [1, 2], [-2, 2], [2, 2], [0, 3]]) this.setPath(e.i + di, e.j + dj, true, true);
    for (let n = 0; n < 3; n++) {
      const c = cellCenter(e.i + n - 1, e.j + 1);
      const v = this.villagers.spawn(store, c);
      v.appear = 0;
    }
    this.res = { wood: 30, food: 12 };
    this.day = 1; this.dayT = 0.3;
  }

  setPath(i, j, on, silent) {
    if (!inBounds(i, j)) return false;
    const k = cellIndex(i, j);
    if (on && (this.grid.water[k] || this.grid.occ[k] !== -1 || this.grid.path[k])) return false;
    if (!on && !this.grid.path[k]) return false;
    this.grid.path[k] = on ? 1 : 0;
    this.terrain.setPath(i, j, on);
    if (on) {
      const wood = this.nature.clearCell(i, j);
      if (wood && !silent) this.addResource('wood', wood);
      if (!silent) {
        const c = cellCenter(i, j);
        for (let n = 0; n < 4; n++) this.particles.spawn({ x: c.x + (Math.random() - 0.5) * 0.6, y: terrainHeight(c.x, c.z) + 0.05, z: c.z + (Math.random() - 0.5) * 0.6, vy: 0.3, vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 0.8, size: 0.25, grow: 0.3, color: new THREE.Color('#e3cfa6'), alpha: 0.5, drag: 2 });
      }
    } else this.nature.restoreCell(i, j);
    return true;
  }

  addResource(kind, n, at) {
    this.res[kind] += n;
    this.ui.bump(kind);
    if (at) {
      this.ui.floater(at, `+${n} ${kind === 'wood' ? '🪵' : '🍞'}`);
      this.audio.coin();
    }
  }

  toast(msg) { this.ui.toast(msg); }

  get population() { return this.villagers.list.length; }
  get housing() { return this.buildings.list.reduce((s, b) => s + (b.def.capacity || 0), 0); }
  get pathCount() { let n = 0; for (const p of this.grid.path) n += p; return n; }

  cosiness() {
    const homeless = this.villagers.list.filter((v) => v.home?.type === 'storehouse').length;
    const deco = this.buildings.cosy;
    let c = 35 + Math.min(deco, 40) + Math.min(this.pathCount, 50) * 0.3 + (this.res.food > 0 ? 8 : -12) - Math.max(0, homeless - 3) * 4;
    const pop = Math.max(1, this.population);
    c -= Math.max(0, pop - 6) * 0.6; // bigger villages need more love
    return Math.max(0, Math.min(100, c));
  }

  // ---- input ---------------------------------------------------------------------------
  _setupInput() {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.in = true;
      if (this.painting) this._paintAt();
    });
    c.addEventListener('pointerleave', () => { this.mouse.in = false; });
    c.addEventListener('pointerdown', (e) => {
      this.audio.init();
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button === 1 && this.tool && DEFS[this.tool]) { e.preventDefault(); this.rotate(); return; }
      if (e.button !== 0 || !this.playing) return;
      this._updateHover();
      if (this.tool === 'path' || this.tool === 'demolish') {
        this.painting = { last: null, mode: this.tool };
        c.setPointerCapture(e.pointerId);
        this._paintAt();
      } else if (this.tool) this._tryPlace();
    });
    c.addEventListener('pointerup', (e) => {
      if (e.button === 2 && (this.rig.lastDragMoved ?? 0) < 6 && this.tool) this.setTool(null);
      this.painting = null;
    });
    addEventListener('keydown', (e) => {
      if (!this.playing) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { this.setTool(null); this.ui.showHelp(false); }
      else if (k === 'r') this.rotate();
      else if (k === 'x' || k === 'delete') this.setTool(this.tool === 'demolish' ? null : 'demolish');
      else if (k === ' ') { e.preventDefault(); this.setSpeed(this.speed === 0 ? (this._prevSpeed || 1) : 0); }
      else {
        const t = Object.keys(DEFS).find((d) => DEFS[d].key === k);
        if (t) this.setTool(this.tool === t ? null : t);
      }
    });
  }

  setSpeed(s) { if (s === 0) this._prevSpeed = this.speed || 1; this.speed = s; this.ui.refresh(true); }

  rotate() { this.rot = (this.rot + 1) % 4; this.audio.click(); }

  setTool(t) {
    this.tool = t;
    this.rig.panWithLeft = !t;
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (t && DEFS[t] && t !== 'path') {
      this.ghost = this.buildings.getGhost(t);
      this.scene.add(this.ghost);
      this.ghostPos.set(NaN, 0, 0);
    }
    this.terrain.uniforms.uGrid.value = 0;
    this.ui.refresh(true);
    if (t) this.audio.click();
  }

  _updateHover() {
    const ndc = new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const p = raycastTerrain(rc.ray);
    if (!p) { this.hover = null; return; }
    const c = worldToCell(p.x, p.z);
    this.hover = { ...c, x: p.x, z: p.z, y: p.y };
  }

  _paintAt() {
    this._updateHover();
    const h = this.hover;
    if (!h || !inBounds(h.i, h.j)) return;
    const key = h.i + ',' + h.j;
    if (this.painting.last === key) return;
    this.painting.last = key;
    if (this.painting.mode === 'path') {
      if (this.setPath(h.i, h.j, true)) { this.audio.paint(); this.villagers.list.forEach((v) => v.task?.type === 'goto' && this.villagers._startTask(v, v.task)); }
    } else {
      const occ = this.grid.occ[cellIndex(h.i, h.j)];
      if (occ !== -1) {
        const b = this.buildings.byId.get(occ);
        if (b && !b.def.fixed) {
          this.villagers.onBuildingRemoved(b);
          this.buildings.remove(b);
          const refund = Math.floor(b.def.cost / 2);
          if (refund) this.addResource('wood', refund);
          this.villagers.assignHomes();
        } else if (b?.def.fixed) this.toast('The storehouse is the heart of the village 💛');
      } else if (this.setPath(h.i, h.j, false)) this.audio.paint();
    }
  }

  _tryPlace() {
    const h = this.hover;
    if (!h) return;
    const def = DEFS[this.tool];
    const chk = this.buildings.canPlace(this.tool, h.i, h.j);
    if (!chk.ok) { this.toast(chk.why); this.audio.click(); return; }
    if (this.res.wood < def.cost) { this.toast(`Needs ${def.cost} 🪵 wood`); this.audio.click(); return; }
    this.res.wood -= def.cost;
    const { b, wood } = this.buildings.place(this.tool, h.i, h.j, this.rot);
    if (wood) setTimeout(() => this.addResource('wood', wood, { x: b.x, y: b.y + 1.2, z: b.z }), 500);
    this.villagers.onBuildingPlaced(b);
    this.buildings.refreshEntrances();
    this.villagers.assignHomes();
    this.ui.refresh(true);
  }

  // ---- save / load ----------------------------------------------------------------------
  save() {
    const data = {
      v: 1, res: this.res, day: this.day, dayT: this.dayT,
      buildings: this.buildings.list.map((b) => ({ id: b.id, type: b.type, i: b.i, j: b.j, rot: b.rot, seed: b.seed, growth: b.crops?.growth })),
      paths: [...this.grid.path].map((p, k) => (p ? k : -1)).filter((k) => k >= 0),
      villagers: this.villagers.serialize(),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  }

  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }

  load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return false; }
    if (!data || data.v !== 1) return false;
    const idMap = new Map();
    for (const s of data.buildings) {
      const { b } = this.buildings.place(s.type, s.i, s.j, s.rot, { instant: true, seed: s.seed });
      if (s.growth !== undefined && b.crops) b.crops.growth = s.growth;
      idMap.set(s.id, b);
    }
    for (const k of data.paths) this.setPath(k % 64, Math.floor(k / 64), true, true);
    this.buildings.refreshEntrances();
    for (const s of data.villagers) {
      const home = idMap.get(s.home) || this.villagers.storehouse();
      const at = home ? cellCenter(home.entrance.i, home.entrance.j) : { x: s.x, z: s.z };
      this.villagers.spawn(home, at, s);
    }
    this.res = data.res; this.day = data.day; this.dayT = data.dayT;
    return true;
  }

  resetVillage() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* */ }
    location.reload();
  }

  start() {
    this.playing = true;
    document.body.classList.add('playing');
    this.audio.init();
    this.audio.chime();
    this.rig.goal.dist = 22;
    this.rig.panWithLeft = true;
    setTimeout(() => this.toast('Welcome to Hearthvale 💛'), 600);
    setTimeout(() => this.toast('Try building a 🪓 woodcutter and a 🏡 cottage'), 3200);
  }

  // ---- simulation ---------------------------------------------------------------------------
  simulate(dt) {
    const prevT = this.dayT;
    this.dayT += dt / DAY_LENGTH;
    if (this.dayT >= 1) { this.dayT -= 1; this.day++; }
    if (prevT < 0.25 && this.dayT >= 0.25) {
      const eat = Math.ceil(this.population * 0.5);
      this.res.food = Math.max(0, this.res.food - eat);
      this.toast(`Good morning! Day ${this.day} ☀️  (breakfast: −${eat} 🍞)`);
    }
    if (prevT < 0.78 && this.dayT >= 0.78) this.toast('The lanterns are lit… 🌙');

    this.villagers.update(dt, this.dayT, this.time);
    this.nature.update(dt);

    // job / home assignment
    this._assignT = (this._assignT || 0) - dt;
    if (this._assignT <= 0) { this._assignT = 1; this.villagers.assignJobs(); this.villagers.assignHomes(); }

    // families move in
    this.growT += dt;
    const cosy = this.cosiness();
    const interval = 28 * (1.6 - cosy / 100);
    if (this.growT > interval && this.dayT > 0.27 && this.dayT < 0.75) {
      this.growT = 0;
      const homes = this.buildings.list.filter((b) => b.def.capacity && b.residents.length < b.def.capacity && b.anim >= 1);
      const room = homes.find((b) => b.type === 'cottage') || homes[0];
      if (room && this.population < MAX_POP) {
        if (this.res.food >= 4) {
          this.res.food -= 4;
          const e = cellCenter(room.entrance.i, room.entrance.j);
          const v = this.villagers.spawn(room, e);
          v.appear = 0;
          for (let n = 0; n < 8; n++) this.particles.spawn({ x: e.x, y: terrainHeight(e.x, e.z) + 0.5, z: e.z, vx: (Math.random() - 0.5) * 0.8, vy: 0.6 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.8, life: 1.6, size: 0.14, color: new THREE.Color('#ff8fab'), alpha: 1, drag: 1.5, wobble: 0.3 });
          this.toast(`${v.name} has moved to Hearthvale! 🎉`);
          this.audio.chime();
        } else if (!this._hungryToast || this.time - this._hungryToast > 60) {
          this._hungryToast = this.time;
          this.toast('A family wants to move in, but there isn\'t enough food 🍞');
        }
      }
    }
  }

  frame() {
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    this.time += rawDt;
    const dt = rawDt * (this.playing ? this.speed : 1);
    this.timeU.value += rawDt * (this.speed === 0 ? 0.25 : 1);

    if (this.playing && this.speed > 0) this.simulate(dt);
    if (!this.playing) { this.rig.goal.yaw += rawDt * 0.05; this.dayT = 0.33 + Math.sin(this.time * 0.05) * 0.02; }

    this.rig.update(rawDt);
    const night = this.sky.update(this.dayT, rawDt, this.rig.target);
    this.audio.night = night;
    this.audio.listener.x = this.rig.target.x; this.audio.listener.z = this.rig.target.z; this.audio.listener.dist = this.rig.cur.dist;

    const st = this.timeU.value;
    this.buildings.update(rawDt * (this.speed || 0.0001), st, night);
    this.buildings.windowGlow(night);
    if (this.speed > 0) this.fish.update(rawDt * Math.min(this.speed, 2), st);
    this.nature.updateLilies(st);
    this.particles.update(rawDt * (this.speed === 0 ? 0.2 : Math.min(this.speed, 2)));
    this._ambientSparks(rawDt, night);
    this.sparks.update(rawDt);
    this.ripples.update(rawDt);

    // water uniforms
    const wu = this.water.uniforms;
    wu.uTime.value = st;
    wu.uSunDir.value.copy(this.sky.sunDir);
    wu.uSunColor.value.copy(this.sky.state.sun);
    wu.uSky.value.copy(this.sky.state.top).lerp(this.sky.state.hor, 0.5);
    wu.uLight.value = 1 - night * 0.55;
    wu.fogColor.value.copy(this.sky.fog.color); wu.fogNear.value = this.sky.fog.near; wu.fogFar.value = this.sky.fog.far;

    this._updateTool(rawDt);
    if (this.playing) { this.ui.update(rawDt); this.ui.tooltip(this._tip); }

    // gentle tilt-shift: more when zoomed in for a miniature feel
    const zoomK = 1 - (this.rig.cur.dist - 9) / 53;
    const tilt = (0.8 + zoomK * 2.2) / innerHeight;
    this.tiltH.uniforms.h.value = tilt * innerHeight / innerWidth;
    this.tiltV.uniforms.v.value = tilt;
    this.bloom.strength = 0.22 + night * 0.5;

    if (this.quality === 'high') this.composer.render(rawDt);
    else this.renderer.render(this.scene, this.camera);

    if (this.playing) {
      this.saveT += rawDt;
      if (this.saveT > 20) { this.saveT = 0; this.save(); }
      this._watchFps(rawDt);
    }
  }

  _watchFps(dt) {
    const f = this._fps;
    f.t += dt; f.n++;
    if (f.t > 3) {
      const fps = f.n / f.t;
      f.t = 0; f.n = 0;
      if (this.quality === 'high' && fps < 32) f.low++; else f.low = 0;
      if (f.low >= 3) {
        this.quality = 'low';
        this.applyQuality();
        this.ui.refresh(true);
        this.toast('Switched to lighter graphics so things stay smooth ✨');
      }
    }
  }

  _ambientSparks(dt, night) {
    const t = this.rig.target;
    const r = Math.min(this.rig.cur.dist * 0.6, 18);
    if (night > 0.4 && Math.random() < dt * 22 * night) {
      const x = t.x + (Math.random() - 0.5) * r * 2, z = t.z + (Math.random() - 0.5) * r * 2;
      const y = Math.max(terrainHeight(x, z), 0) + 0.2 + Math.random() * 0.8;
      this.sparks.spawn({ x, y, z, vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.1, vz: (Math.random() - 0.5) * 0.2, life: 3 + Math.random() * 3, size: 0.09, color: new THREE.Color('#e4ff8a'), alpha: 0.9 * night, drag: 0.1, wobble: 0.5, fadeIn: 0.3 });
    } else if (night < 0.3 && Math.random() < dt * 5) {
      const x = t.x + (Math.random() - 0.5) * r * 2, z = t.z + (Math.random() - 0.5) * r * 2;
      const y = Math.max(terrainHeight(x, z), 0) + 0.3 + Math.random() * 1.5;
      this.sparks.spawn({ x, y, z, vx: 0.15, vy: 0.03, vz: 0.05, life: 5, size: 0.05, color: new THREE.Color('#fff1c8'), alpha: 0.35, drag: 0.05, wobble: 0.3, fadeIn: 0.4 });
    }
  }

  _updateTool(dt) {
    if (!this.playing) return;
    if (this.mouse.in) this._updateHover();
    const h = this.hover;
    const tu = this.terrain.uniforms;
    const wantGrid = this.tool && h ? 1 : 0;
    tu.uGrid.value = damp(tu.uGrid.value, wantGrid, 8, dt);
    if (h) tu.uHover.value.set(h.x, 0, h.z);
    this.cellPlate.visible = false;
    this._tip = null;
    if (!h || !inBounds(h.i, h.j)) { if (this.ghost) this.ghost.visible = false; return; }

    if (this.ghost && DEFS[this.tool]) {
      const def = DEFS[this.tool];
      const cells = this.buildings.footprint(this.tool, h.i, h.j);
      const ok = this.buildings.canPlace(this.tool, h.i, h.j);
      const afford = this.res.wood >= def.cost;
      const c = this.buildings.footprintCenter(this.tool, h.i, h.j);
      const y = this.buildings.baseHeight(cells.filter(([i, j]) => inBounds(i, j)).length ? cells.filter(([i, j]) => inBounds(i, j)) : [[h.i, h.j]]);
      if (Number.isNaN(this.ghostPos.x)) this.ghostPos.set(c.x, y, c.z);
      this.ghostPos.x = damp(this.ghostPos.x, c.x, 22, dt);
      this.ghostPos.z = damp(this.ghostPos.z, c.z, 22, dt);
      this.ghostPos.y = damp(this.ghostPos.y, y, 22, dt);
      this.ghost.visible = true;
      this.ghost.position.set(this.ghostPos.x, this.ghostPos.y + 0.04 + Math.sin(this.time * 3) * 0.025, this.ghostPos.z);
      const tr = this.rot * Math.PI / 2;
      let d = tr - this.ghost.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.ghost.rotation.y += d * (1 - Math.exp(-dt * 16));
      const good = ok.ok && afford;
      this.buildings.ghostMat.color.copy(good ? this.buildings.ghostGood : this.buildings.ghostBad);
      this.buildings.ghostMat.emissive.set(good ? '#7fd36b' : '#e0604f');
      this.ghost.userData.plate.material.color.set(good ? '#ffffff' : '#ffb0a0');
      if (!ok.ok) this._tip = (`<span class="bad">${ok.why}</span>`);
      else if (!afford) this._tip = (`<span class="bad">Needs ${def.cost} 🪵</span>`);
      else if (def.needsWater) this._tip = ('Lovely spot for fishing 🎣');
    } else if (this.tool === 'path' || this.tool === 'demolish') {
      const k = cellIndex(h.i, h.j);
      const c = cellCenter(h.i, h.j);
      const occ = this.grid.occ[k];
      if (this.tool === 'demolish' && occ !== -1) {
        const b = this.buildings.byId.get(occ);
        if (b) {
          this.cellPlate.visible = true;
          this.cellPlate.scale.set(b.def.size, b.def.size, 1);
          this.cellPlate.position.set(b.x, b.y + 0.08, b.z);
          this.cellPlate.material.color.set(b.def.fixed ? '#ffe2a0' : '#ff8f7a');
          this._tip = (b.def.fixed ? `${b.def.name} can't be removed` : `Remove ${b.def.name} (+${Math.floor(b.def.cost / 2)} 🪵)`);
        }
      } else {
        const valid = this.tool === 'path' ? !this.grid.water[k] && occ === -1 : !!this.grid.path[k];
        this.cellPlate.visible = true;
        this.cellPlate.scale.set(0.96, 0.96, 1);
        this.cellPlate.position.set(c.x, Math.max(terrainHeight(c.x, c.z), 0) + 0.06, c.z);
        this.cellPlate.material.color.set(this.tool === 'path' ? (valid ? '#fff3d6' : '#ff9a8a') : (valid ? '#ff8f7a' : '#ffffff'));
        this.cellPlate.material.opacity = valid ? 0.45 : 0.2;
      }
    } else if (!this.tool && this.mouse.in && !this.rig.drag) {
      // hover info
      const v = this.villagers.pick(this.camera, this.mouse.x, this.mouse.y, innerWidth, innerHeight);
      if (v) {
        const d = this.villagers.describe(v);
        this._tip = (`<b>${d.title}</b><br><span class="small">${d.sub}</span>`);
      } else {
        const occ = this.grid.occ[cellIndex(h.i, h.j)];
        const b = occ !== -1 ? this.buildings.byId.get(occ) : null;
        if (b) this._tip = (this.describeBuilding(b));
      }
    }
  }

  describeBuilding(b) {
    const d = b.def;
    let sub = '';
    if (d.capacity) sub = `${b.residents.length}/${d.capacity} living here` + (b.residents.length ? ': ' + b.residents.map((r) => r.name).join(', ') : '');
    if (d.workers) {
      const names = b.workers.map((w) => w.name).join(', ');
      sub = `${b.workers.length}/${d.workers} ${JOB_LABEL[b.type].toLowerCase()}s` + (names ? ': ' + names : ' – waiting for a free villager');
      if (b.type === 'farm') sub += `<br>Wheat ${Math.round(b.crops.growth * 100)}% grown`;
    }
    if (b.type === 'storehouse') sub = `🪵 ${this.res.wood} · 🍞 ${this.res.food}`;
    if (d.cosy) sub = `+${d.cosy} cosiness`;
    return `<b>${d.icon} ${d.name}</b>${sub ? `<br><span class="small">${sub}</span>` : ''}`;
  }
}

const game = new Game();
window.__game = game; // handy for debugging in the console
