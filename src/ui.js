import * as THREE from 'three';
import { DEFS } from './buildings.js';

const $ = (s) => document.querySelector(s);

export class UI {
  constructor(game) {
    this.game = game;
    this.els = {
      wood: $('#s-wood'), food: $('#s-food'), pop: $('#s-pop'), cosy: $('#s-cosy'), cosyBar: $('#s-cosy-bar'),
      day: $('#c-day'), time: $('#c-time'), hand: $('#dial-hand'), dialIco: $('#dial-ico'),
      toolbar: $('#toolbar'), toasts: $('#toasts'), tooltip: $('#tooltip'), floaters: $('#floaters'), hint: $('#hint'),
    };
    this.last = {};
    this.floaters = [];
    this._buildToolbar();
    this._wire();
  }

  _buildToolbar() {
    const tb = this.els.toolbar;
    const tools = ['path', 'cottage', 'farm', 'woodcutter', 'fishery', 'well', 'garden', 'lantern'];
    this.toolEls = {};
    for (const t of tools) {
      const d = DEFS[t];
      const b = document.createElement('button');
      b.className = 'tool';
      b.innerHTML = `<span class="tk">${d.key}</span><span class="ti">${d.icon}</span><span class="tn">${d.name}</span><span class="tc">${d.cost ? d.cost + ' 🪵' : 'free'}</span>
        <div class="tool-desc"><b>${d.icon} ${d.name}</b>${d.desc}</div>`;
      b.addEventListener('click', () => { this.game.audio.init(); this.game.setTool(this.game.tool === t ? null : t); });
      tb.appendChild(b);
      this.toolEls[t] = b;
    }
    const del = document.createElement('button');
    del.className = 'tool sep';
    del.innerHTML = `<span class="tk">X</span><span class="ti">🧹</span><span class="tn">Demolish</span><span class="tc">½ refund</span>
      <div class="tool-desc"><b>🧹 Demolish</b>Tidy away buildings or paths. Click & drag over paths.</div>`;
    del.addEventListener('click', () => this.game.setTool(this.game.tool === 'demolish' ? null : 'demolish'));
    tb.appendChild(del);
    this.toolEls.demolish = del;
  }

  _wire() {
    const g = this.game;
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { g.audio.init(); g.setSpeed(+b.dataset.speed); g.audio.click(); }));
    $('#b-sfx').addEventListener('click', (e) => { g.audio.init(); g.audio.setSfx(!g.audio.sfxOn); e.currentTarget.classList.toggle('on', g.audio.sfxOn); e.currentTarget.textContent = g.audio.sfxOn ? '🔊' : '🔈'; });
    $('#b-music').addEventListener('click', (e) => { g.audio.init(); g.audio.setMusic(!g.audio.musicOn); e.currentTarget.classList.toggle('on', g.audio.musicOn); });
    $('#b-gfx').addEventListener('click', () => {
      g.quality = g.quality === 'high' ? 'low' : 'high';
      try { localStorage.setItem('hearthvale-gfx', g.quality); } catch { /* */ }
      g._fps.low = 0;
      g.applyQuality();
      this.refresh(true);
      g.toast(g.quality === 'high' ? 'Pretty graphics ✨' : 'Lighter graphics – smoother on slower machines');
    });
    $('#b-help').addEventListener('click', () => this.showHelp(true));
    $('#help-close').addEventListener('click', () => this.showHelp(false));

    const intro = $('#intro');
    const startBtn = $('#b-start'), newBtn = $('#b-new');
    if (g.hasSave()) { startBtn.textContent = 'Continue'; newBtn.style.display = ''; }
    startBtn.addEventListener('click', () => { intro.classList.add('gone'); g.start(); });
    newBtn.addEventListener('click', () => { if (confirm('Start a fresh village? Your current one will be forgotten.')) g.resetVillage(); });
  }

  showHelp(on) { $('#help').classList.toggle('show', on); }

  refresh(force) {
    const g = this.game;
    for (const [t, el] of Object.entries(this.toolEls)) {
      el.classList.toggle('active', g.tool === t);
      if (DEFS[t]) el.classList.toggle('poor', g.res.wood < DEFS[t].cost);
    }
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === g.speed));
    $('#b-gfx').classList.toggle('on', g.quality === 'high');
    const hint = this.els.hint;
    if (g.tool === 'path') hint.innerHTML = 'Click & drag to paint paths · Right-click to stop';
    else if (g.tool === 'demolish') hint.innerHTML = 'Click buildings or drag over paths to remove';
    else if (g.tool) hint.innerHTML = '<kbd>R</kbd> rotate · Right-click to cancel';
    else hint.innerHTML = 'Drag to move · Right-drag to orbit · Scroll to zoom';
    if (force) this.last = {};
  }

  update(dt) {
    const g = this.game, l = this.last, e = this.els;
    const set = (k, v, el) => { if (l[k] !== v) { l[k] = v; el.textContent = v; } };
    set('wood', String(Math.floor(g.res.wood)), e.wood);
    set('food', String(Math.floor(g.res.food)), e.food);
    set('pop', `${g.population} / ${g.housing}`, e.pop);
    this._cosyT = (this._cosyT || 0) - dt;
    if (this._cosyT <= 0) {
      this._cosyT = 0.5;
      const c = g.cosiness();
      e.cosyBar.style.width = `${c}%`;
      const label = c > 85 ? 'Blissful' : c > 65 ? 'Very cosy' : c > 45 ? 'Cosy' : c > 25 ? 'Alright' : 'Gloomy';
      set('cosy', label, e.cosy);
      if (l.woodPoor !== g.res.wood) { l.woodPoor = g.res.wood; for (const [t, el] of Object.entries(this.toolEls)) if (DEFS[t]) el.classList.toggle('poor', g.res.wood < DEFS[t].cost); }
    }
    set('day', `Day ${g.day}`, e.day);
    const t = g.dayT;
    const label = t < 0.22 ? 'Night' : t < 0.3 ? 'Dawn' : t < 0.45 ? 'Morning' : t < 0.58 ? 'Midday' : t < 0.72 ? 'Afternoon' : t < 0.8 ? 'Dusk' : 'Night';
    set('time', label, e.time);
    e.hand.style.transform = `rotate(${t * 360 + 180}deg)`;
    set('dialIco', t > 0.22 && t < 0.8 ? '☀️' : '🌙', e.dialIco);

    // floaters follow their world position
    const cam = g.camera;
    const v = new THREE.Vector3();
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      if (f.t > 1.6) { f.el.remove(); return false; }
      v.set(f.x, f.y + f.t * 0.6, f.z).project(cam);
      f.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      f.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      f.el.style.opacity = String(Math.min(1, (1.6 - f.t) * 2));
      return true;
    });
  }

  bump(kind) {
    const el = kind === 'wood' ? this.els.wood.parentElement : this.els.food.parentElement;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  floater(at, text) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    this.els.floaters.appendChild(el);
    this.floaters.push({ el, x: at.x, y: at.y, z: at.z, t: 0 });
  }

  toast(msg) {
    const box = this.els.toasts;
    if ([...box.children].some((c) => c.textContent === msg && !c.classList.contains('out'))) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 650); }, 3600);
  }

  tooltip(html) {
    const tt = this.els.tooltip;
    if (!html) { if (this._tt) { tt.classList.remove('show'); this._tt = null; } return; }
    if (this._tt !== html) { tt.innerHTML = html; this._tt = html; }
    tt.classList.add('show');
    const m = this.game.mouse;
    const w = tt.offsetWidth;
    tt.style.left = `${Math.min(innerWidth - w - 8, m.x + 16)}px`;
    tt.style.top = `${m.y + 18}px`;
  }
}
