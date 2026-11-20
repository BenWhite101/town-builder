import * as THREE from 'three';

// One draw call particle pool using THREE.Points with per-particle size/alpha/colour.
export class Particles {
  constructor(scene, max = 600, { additive = false, soft = true } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.p = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 }, uSoft: { value: soft ? 1 : 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale;
        varying float vA; varying vec3 vC;
        void main() {
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uSoft;
        varying float vA; varying vec3 vC;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          float a = uSoft > 0.5 ? smoothstep(1.0, 0.2, d) : smoothstep(1.0, 0.8, d);
          if (a <= 0.01) discard;
          gl_FragColor = vec4(vC, a * vA);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  // opts: {x,y,z, vx,vy,vz, life, size, grow, color, alpha, drag, gravity, fadeIn}
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life || 1, t: 0, size: o.size || 0.3, grow: o.grow || 0,
      color: o.color || new THREE.Color(1, 1, 1), alpha: o.alpha ?? 1,
      drag: o.drag ?? 0.5, gravity: o.gravity || 0, fadeIn: o.fadeIn ?? 0.15,
      wobble: o.wobble || 0, ph: Math.random() * 10, update: o.update,
    });
  }

  update(dt) {
    let n = 0;
    const keep = [];
    for (const p of this.p) {
      p.t += dt;
      if (p.t >= p.life) continue;
      keep.push(p);
      if (p.update) p.update(p, dt);
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.gravity * dt;
      p.x += p.vx * dt + (p.wobble ? Math.sin(p.t * 2 + p.ph) * p.wobble * dt : 0);
      p.y += p.vy * dt;
      p.z += p.vz * dt + (p.wobble ? Math.cos(p.t * 1.7 + p.ph) * p.wobble * dt : 0);
      const k = p.t / p.life;
      const fade = Math.min(1, p.t / (p.life * p.fadeIn + 1e-4)) * (1 - k * k);
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 3] = p.color.r; this.col[n * 3 + 1] = p.color.g; this.col[n * 3 + 2] = p.color.b;
      this.size[n] = p.size + p.grow * p.t;
      this.alpha[n] = p.alpha * fade;
      n++;
    }
    this.p = keep;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
  }
}

// Expanding rings on the water (fish, splashes, bobbers)
export class Ripples {
  constructor(scene, max = 40) {
    this.list = [];
    const geo = new THREE.RingGeometry(0.85, 1, 32);
    geo.rotateX(-Math.PI / 2);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.renderOrder = 3;
      scene.add(m);
      this.pool.push(m);
    }
  }
  spawn(x, z, size = 0.6, life = 1.6) {
    const m = this.pool.find((p) => !p.visible) || this.pool[0];
    m.visible = true;
    m.position.set(x, 0.03, z);
    m.userData = { t: 0, life, size };
    this.list.push(m);
  }
  update(dt) {
    this.list = this.list.filter((m) => {
      const u = m.userData;
      u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { m.visible = false; return false; }
      const s = 0.1 + u.size * Math.sqrt(k);
      m.scale.set(s, 1, s);
      m.material.opacity = (1 - k) * 0.55;
      return true;
    });
  }
}
