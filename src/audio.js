// Procedural, gentle sound: soft pops, chops & splashes, birdsong by day, crickets by night,
// and a sparse little pentatonic tune. Everything is synthesised – no audio files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.listener = { x: 0, z: 0, dist: 30 };
    this.night = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.8; this.amb.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.0; this.music.connect(this.master);
    // reverb for the music & birds
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.8);
    const vg = ctx.createGain(); vg.gain.value = 0.35;
    this.verb.connect(vg).connect(this.master);
    this.noise = this._noiseBuffer(2);
    this._wind();
    this._schedule();
    this.setMusic(this.musicOn);
    this.setSfx(this.sfxOn);
  }

  _impulse(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }
  _noiseBuffer(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setSfx(on) { this.sfxOn = on; if (this.ctx) { this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1); this.amb.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.3); } }
  setMusic(on) { this.musicOn = on; if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.8); }

  // distance attenuation from the camera focus
  _vol(x, z) {
    if (x === undefined) return 1;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    const zoom = Math.min(1, 26 / Math.max(this.listener.dist, 1));
    return Math.max(0, 1 - d / 22) * (0.35 + 0.65 * zoom);
  }

  _env(node, t, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  _tone(freq, { type = 'sine', dur = 0.3, vol = 0.2, slide = 0, out = this.sfx, at = 0, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, attack, vol, dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + attack + 0.05);
    return g;
  }

  _noise({ dur = 0.2, vol = 0.2, freq = 1200, q = 1, type = 'bandpass', out = this.sfx, at = 0, attack = 0.003 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }

  pop(x, z, size = 1) {
    const v = this._vol(x, z) * 0.9 + 0.1;
    this._tone(420 / Math.sqrt(size), { dur: 0.25, vol: 0.18 * v, slide: 1.8, type: 'sine' });
    this._tone(640 / Math.sqrt(size), { dur: 0.18, vol: 0.07 * v, slide: 1.5, type: 'triangle', at: 0.06 });
    this._noise({ dur: 0.35, vol: 0.05 * v, freq: 600, q: 0.5, type: 'lowpass' });
  }
  poof(x, z) { const v = this._vol(x, z) * 0.9 + 0.1; this._noise({ dur: 0.45, vol: 0.12 * v, freq: 500, q: 0.6, type: 'lowpass' }); this._tone(300, { dur: 0.25, vol: 0.06 * v, slide: 0.5 }); }
  tick() { this._tone(1320, { dur: 0.035, vol: 0.025, type: 'sine' }); }
  click() { this._tone(880, { dur: 0.06, vol: 0.05, type: 'triangle' }); }
  paint() { this._noise({ dur: 0.08, vol: 0.05, freq: 900, q: 0.8 }); }
  chop(x, z) { const v = this._vol(x, z); if (v < 0.02) return; this._noise({ dur: 0.07, vol: 0.22 * v, freq: 1800, q: 2 }); this._tone(180, { dur: 0.08, vol: 0.12 * v, slide: 0.6, type: 'triangle' }); }
  thud(x, z) { const v = this._vol(x, z); if (v < 0.02) return; this._tone(90, { dur: 0.4, vol: 0.25 * v, slide: 0.5 }); this._noise({ dur: 0.5, vol: 0.1 * v, freq: 300, q: 0.7, type: 'lowpass' }); }
  rustle(x, z) { const v = this._vol(x, z); if (v < 0.02) return; this._noise({ dur: 0.4, vol: 0.08 * v, freq: 3000, q: 0.6, attack: 0.08 }); }
  splash(x, z, s = 1) { const v = this._vol(x, z) * s; if (v < 0.02) return; this._noise({ dur: 0.35, vol: 0.14 * v, freq: 2200, q: 0.7, attack: 0.01 }); this._tone(700, { dur: 0.12, vol: 0.05 * v, slide: 0.4 }); }
  plip(x, z) { const v = this._vol(x, z); if (v < 0.02) return; this._tone(1200, { dur: 0.1, vol: 0.07 * v, slide: 0.5 }); }
  bell(x, z) {
    const v = Math.max(0.35, this._vol(x, z));
    // a soft church bell: a few inharmonic partials with long tails, struck three times
    for (let s = 0; s < 3; s++) {
      const at = s * 1.6;
      for (const [m, g, d] of [[1, 0.05, 4], [2.0, 0.025, 2.6], [2.4, 0.02, 2.2], [3.0, 0.012, 1.6], [4.2, 0.008, 1.0]]) {
        const out = this.ctx ? this.ctx.createGain() : null;
        if (!out) return;
        out.gain.value = 1; out.connect(this.sfx); out.connect(this.verb);
        this._tone(392 * m, { dur: d, vol: g * v, at, out, attack: 0.004 });
      }
    }
  }
  // farmyard voices
  animal(kind, x, z) {
    const v = this._vol(x, z);
    if (!this.ctx || v < 0.05) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const voice = (type, f0, f1, dur, vol, fq, q, vib = 0) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      if (vib) { const l = ctx.createOscillator(); l.frequency.value = vib; const lg = ctx.createGain(); lg.gain.value = f0 * 0.06; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.1); }
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * v, t + Math.min(0.08, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(this.sfx);
      o.start(t); o.stop(t + dur + 0.05);
    };
    if (kind === 'sheep') voice('sawtooth', 330 + Math.random() * 80, 290, 0.7, 0.06, 1000, 1.2, 17);
    else if (kind === 'cow') voice('sawtooth', 120, 105, 1.3, 0.09, 500, 0.8, 4);
    else if (kind === 'chicken') { for (let i = 0; i < 3; i++) this._tone(600 + Math.random() * 200, { dur: 0.06, vol: 0.03 * v, type: 'square', at: i * 0.11 }); }
    else if (kind === 'duck') { for (let i = 0; i < 2; i++) this._noise({ dur: 0.1, vol: 0.06 * v, freq: 1300, q: 4, at: i * 0.16 }); voice('sawtooth', 260, 230, 0.12, 0.05, 1200, 3); }
    else if (kind === 'duckling') { for (let i = 0; i < 3; i++) this._tone(2600 + Math.random() * 500, { dur: 0.05, vol: 0.02 * v, slide: 1.15, at: i * 0.12 }); }
  }

  coin() { this._tone(1046, { dur: 0.12, vol: 0.05, type: 'triangle' }); this._tone(1568, { dur: 0.2, vol: 0.04, type: 'triangle', at: 0.07 }); }
  chime() { [784, 988, 1175, 1568].forEach((f, i) => this._tone(f, { dur: 0.6, vol: 0.05, type: 'sine', at: i * 0.09, out: this.music.gain.value > 0 ? this.sfx : this.sfx })); }

  _wind() {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.035;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(this.amb);
    s.start(); lfo.start();
  }

  _schedule() {
    // birds / crickets
    const loopAmb = () => {
      if (!this.ctx) return;
      if (this.night < 0.5) this._bird(); else this._cricket();
      setTimeout(loopAmb, (this.night < 0.5 ? 2500 + Math.random() * 6000 : 900 + Math.random() * 1600));
    };
    setTimeout(loopAmb, 2000);
    // music
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // major pentatonic
    const roots = [62, 67, 64, 69]; // D G E A-ish progression, soft
    let step = 0, deg = 4;
    const loopMusic = () => {
      if (!this.ctx) return;
      const bar = Math.floor(step / 8) % roots.length;
      const root = roots[bar] - 12;
      if (this.musicOn) {
        if (step % 8 === 0) this._pad(root, bar);
        if (Math.random() < 0.62) {
          deg = Math.max(0, Math.min(scale.length - 1, deg + Math.floor(Math.random() * 5) - 2));
          const midi = 62 + scale[deg];
          this._pluck(440 * Math.pow(2, (midi - 69) / 12), 0.07 + Math.random() * 0.03);
          if (Math.random() < 0.18) this._pluck(440 * Math.pow(2, (midi + 12 - 69) / 12), 0.03, 0.18);
        }
      }
      step++;
      setTimeout(loopMusic, 520 + (step % 2 ? 60 : 0));
    };
    setTimeout(loopMusic, 1500);
  }

  _pluck(freq, vol, at = 0) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.005;
    const g = ctx.createGain(), g2 = ctx.createGain(); g2.gain.value = 0.25;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 6, t); f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 1.2);
    this._env(g, t, 0.006, vol, 1.6);
    o.connect(f); o2.connect(g2).connect(f);
    f.connect(g);
    g.connect(this.music); g.connect(this.verb);
    o.start(t); o2.start(t); o.stop(t + 1.8); o2.stop(t + 1.8);
  }

  _pad(rootMidi, bar) {
    const ctx = this.ctx, t = ctx.currentTime;
    const chord = [0, 7, 16].map((s) => 440 * Math.pow(2, (rootMidi + s - 69) / 12));
    for (const fr of chord) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.6);
      o.connect(g); g.connect(this.music); g.connect(this.verb);
      o.start(t); o.stop(t + 4.8);
    }
  }

  _bird() {
    const base = 2400 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    const out = this.ctx.createGain(); out.gain.value = 0.5; out.connect(this.amb); out.connect(this.verb);
    for (let i = 0; i < n; i++) {
      this._tone(base * (0.9 + Math.random() * 0.25), { dur: 0.07 + Math.random() * 0.05, vol: 0.025, slide: 1.25 + Math.random() * 0.3, at: i * (0.1 + Math.random() * 0.06), out, attack: 0.01 });
    }
  }

  _cricket() {
    const out = this.amb;
    const f = 4300 + Math.random() * 500;
    for (let i = 0; i < 3; i++) this._tone(f, { dur: 0.03, vol: 0.012, type: 'square', at: i * 0.06, out, attack: 0.004 });
  }
}
