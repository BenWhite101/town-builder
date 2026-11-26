import * as THREE from 'three';
import { DEFS, TOOL_ORDER, CATEGORIES } from './buildings.js';
import { FAVOURITES } from './villagers.js';

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
    this.toolEls = {};
    this.tabEls = {};
    const tabs = document.createElement('div');
    tabs.className = 'tb-tabs';
    tabs.setAttribute('role', 'tablist');
    const tools = document.createElement('div');
    tools.className = 'tb-tools';
    tb.append(tabs, tools);
    this.cat = CATEGORIES[0].id;
    for (const c of CATEGORIES) {
      const t = document.createElement('button');
      t.className = 'tab';
      t.setAttribute('role', 'tab');
      t.innerHTML = `<span>${c.icon}</span><span class="tab-name">${c.name}</span>`;
      t.addEventListener('click', () => { this.game.audio.init(); this.game.audio.click(); this.setCategory(c.id); });
      tabs.appendChild(t);
      this.tabEls[c.id] = t;
    }
    for (const t of TOOL_ORDER) {
      const d = DEFS[t];
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.cat = CATEGORIES.find((c) => c.tools.includes(t))?.id;
      b.innerHTML = `<span class="tk">${d.key.toUpperCase()}</span><span class="ti">${d.icon}</span><span class="tn">${d.name}</span><span class="tc">${d.cost ? d.cost + ' 🪵' : 'free'}</span>
        <div class="tool-desc"><b>${d.icon} ${d.name}</b>${d.desc}</div>`;
      b.addEventListener('click', () => { this.game.audio.init(); this.game.setTool(this.game.tool === t ? null : t); });
      tools.appendChild(b);
      this.toolEls[t] = b;
    }
    // keep each tab's tools in its own order
    for (const c of CATEGORIES) for (const t of c.tools) tools.appendChild(this.toolEls[t]);
    const del = document.createElement('button');
    del.className = 'tool sep';
    del.innerHTML = `<span class="tk">X</span><span class="ti">🧹</span><span class="tn">Demolish</span><span class="tc">½ refund</span>
      <div class="tool-desc"><b>🧹 Demolish</b>Tidy away buildings or paths. Click & drag over paths.</div>`;
    del.addEventListener('click', () => this.game.setTool(this.game.tool === 'demolish' ? null : 'demolish'));
    tools.appendChild(del);
    this.toolEls.demolish = del;
    this.toolsRow = tools;
    this.setCategory(this.cat);
  }

  setCategory(id) {
    this.cat = id;
    for (const [cid, el] of Object.entries(this.tabEls)) {
      el.classList.toggle('on', cid === id);
      el.setAttribute('aria-selected', String(cid === id));
    }
    for (const el of Object.values(this.toolEls)) if (el.dataset.cat) el.hidden = el.dataset.cat !== id;
    this.toolsRow.scrollLeft = 0;
  }

  _wire() {
    const g = this.game;
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { g.audio.init(); g.setSpeed(+b.dataset.speed); g.audio.click(); }));
    const setToggle = (el, on) => { el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); };
    $('#b-sfx').addEventListener('click', (e) => { g.audio.init(); g.audio.setSfx(!g.audio.sfxOn); setToggle(e.currentTarget, g.audio.sfxOn); g.saveSettings(); g.audio.click(); });
    $('#b-music').addEventListener('click', (e) => { g.audio.init(); g.audio.setMusic(!g.audio.musicOn); setToggle(e.currentTarget, g.audio.musicOn); g.saveSettings(); });
    $('#b-gfx').addEventListener('click', () => {
      g.quality = g.quality === 'high' ? 'low' : 'high';
      try { localStorage.setItem('hearthvale-gfx', g.quality); } catch { /* */ }
      g._fps.low = 0;
      g.applyQuality();
      this.refresh(true);
      g.toast(g.quality === 'high' ? 'Pretty graphics ✨' : 'Lighter graphics – smoother on slower machines');
    });
    const blur = $('#s-blur'), blurVal = $('#s-blur-val');
    const showBlur = () => { blurVal.textContent = blur.value === '0' ? 'Off' : `${blur.value}%`; };
    blur.value = String(Math.round(g.settings.blur * 100));
    showBlur();
    blur.addEventListener('input', () => { g.settings.blur = +blur.value / 100; showBlur(); });
    blur.addEventListener('change', () => g.saveSettings());
    setToggle($('#b-sfx'), g.audio.sfxOn);
    setToggle($('#b-music'), g.audio.musicOn);
    $('#b-help').addEventListener('click', () => { this.showHelp(true); $('#clock').classList.remove('open'); });
    $('#b-menu').addEventListener('click', () => { g.audio.click(); $('#clock').classList.toggle('open'); });
    // close the settings panel when clicking elsewhere
    addEventListener('pointerdown', (e) => { if (!e.target.closest('#clock')) $('#clock').classList.remove('open'); });

    // touch action bar
    this.ab = { el: $('#actionbar'), title: $('#actionbar .ab-title'), sub: $('#actionbar .ab-sub'), ok: $('#ab-ok'), cancel: $('#ab-cancel'), rotate: $('#ab-rotate'), key: null, state: null };
    this.ab.ok.addEventListener('click', () => {
      const st = this.ab.state;
      if (!st) return;
      if (st.kind === 'build') g.confirmPlace();
      else if (st.kind === 'demolish') g.confirmDemolish();
      else g.setTool(null);
    });
    this.ab.cancel.addEventListener('click', () => {
      if (this.ab.state?.kind === 'demolish') { g.demolishSel = null; g.audio.click(); } else g.setTool(null);
    });
    this.ab.rotate.addEventListener('click', () => g.rotate());
    this.infoEl = $('#infocard');
    this.infoEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const v = g.infoTarget?.v;
      if (act === 'close') { g.infoTarget = null; this.renaming = null; g.audio.click(); }
      else if (act === 'follow' && v) { g.setFollow(g.follow === v ? null : v); this._infoKey = null; g.audio.click(); }
      else if (act === 'rename' && v) { this._startRename(v); }
      else if (act === 'save') this._finishRename(true);
      else if (act === 'cancel') this._finishRename(false);
    });
    this.bubbleEl = $('#bubbles');
    this.bubbles = [];
    $('#help-close').addEventListener('click', () => this.showHelp(false));

    const intro = $('#intro');
    const startBtn = $('#b-start'), newBtn = $('#b-new');
    if (g.hasSave()) { startBtn.textContent = 'Continue'; newBtn.style.display = ''; }
    startBtn.addEventListener('click', () => { intro.classList.add('gone'); g.start(); });
    // two-step confirm (no browser dialogs, they're blocked in some embeds)
    let armed = 0;
    newBtn.addEventListener('click', () => {
      if (Date.now() - armed < 4000) { g.resetVillage(); return; }
      armed = Date.now();
      newBtn.textContent = 'Click again to start over';
      setTimeout(() => { if (Date.now() - armed >= 3900) newBtn.textContent = 'New village'; }, 4000);
    });
  }

  showHelp(on) { $('#help').classList.toggle('show', on); }

  // touch: the bar above the toolbar that confirms placing or removing
  actionBar(st) {
    const ab = this.ab;
    let key = null;
    if (st?.kind === 'build') key = `b|${st.def.name}|${st.ok}|${st.why}`;
    else if (st?.kind === 'demolish') key = `d|${st.b.id}`;
    else if (st?.kind === 'hint') key = `h|${st.tool}`;
    ab.state = st;
    if (key === ab.key) return;
    ab.key = key;
    ab.el.classList.toggle('show', !!st);
    if (!st) return;
    ab.el.dataset.kind = st.kind;
    ab.rotate.hidden = st.kind !== 'build';
    ab.cancel.hidden = st.kind === 'hint';
    ab.ok.classList.toggle('danger', st.kind === 'demolish');
    if (st.kind === 'build') {
      const d = st.def;
      ab.title.textContent = `${d.icon} ${d.name} · ${d.cost} 🪵`;
      ab.sub.innerHTML = st.why ? `<span class="bad">${st.why}</span>` : 'Drag it or tap the meadow to move it';
      ab.ok.textContent = 'Build';
      ab.ok.disabled = !st.ok;
    } else if (st.kind === 'demolish') {
      const d = st.b.def;
      ab.title.textContent = `Remove ${d.icon} ${d.name}?`;
      ab.sub.textContent = `You'll get ${Math.floor(d.cost / 2)} 🪵 back`;
      ab.ok.textContent = 'Remove';
      ab.ok.disabled = false;
    } else {
      const path = st.tool === 'path';
      ab.title.textContent = path ? '👣 Painting paths' : '🧹 Tidying up';
      ab.sub.textContent = path ? 'Drag to paint, tap for one tile. Two fingers move the view.' : 'Tap a building to remove it, or drag over paths to erase them.';
      ab.ok.textContent = 'Done';
      ab.ok.disabled = false;
    }
  }

  // touch: card describing a tapped villager or building
  // info card for a clicked/tapped villager or building
  renderInfo(target) {
    if (this.renaming) { if (target?.v !== this.renaming) this._finishRename(false); else return; }
    const g = this.game;
    let html = null;
    if (target?.v) {
      const v = target.v, d = g.villagers.describe(v);
      const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const home = v.home ? (v.home.type === 'storehouse' ? 'the storehouse (needs a cottage)' : 'a cottage') : '–';
      html = `<div class="ic-name"><b>${esc(v.name)}</b></div>
        <div class="small">${d.sub}</div>
        <div class="small">Feeling ${g.mood(v)} · Loves ${FAVOURITES[v.fav] || '…'}</div>
        <div class="small">Lives in ${home}</div>
        <div class="ic-btns"><button class="ic-btn" data-act="rename">✏️ Rename</button><button class="ic-btn${g.follow === v ? ' on' : ''}" data-act="follow">📍 ${g.follow === v ? 'Following' : 'Follow'}</button></div>`;
    } else if (target?.b) html = g.describeBuilding(target.b);
    if (html === this._infoKey) return;
    this._infoKey = html;
    if (html) this.infoEl.innerHTML = `${html}<button class="info-close" data-act="close" aria-label="Close">✕</button>`;
    this.infoEl.classList.toggle('show', !!html);
  }

  _startRename(v) {
    this.renaming = v;
    const row = this.infoEl.querySelector('.ic-name');
    row.innerHTML = `<input id="rename-input" maxlength="16" autocomplete="off" aria-label="New name" /><button class="ic-btn ok" data-act="save">Save</button><button class="ic-btn" data-act="cancel">✕</button>`;
    const inp = row.querySelector('input');
    inp.value = v.name;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this._finishRename(true);
      if (e.key === 'Escape') this._finishRename(false);
    });
    inp.focus(); inp.select();
  }

  _finishRename(save) {
    const v = this.renaming;
    if (!v) return;
    const inp = this.infoEl.querySelector('#rename-input');
    const name = inp?.value.trim().replace(/\s+/g, ' ');
    this.renaming = null;
    this._infoKey = null;
    if (save && name && name !== v.name) {
      const old = v.name;
      v.name = name;
      this.toast(`${old} will now be known as ${name} 💛`);
      this.game.villagers.say(v, '😊', true);
      this.game.save();
    }
  }

  // thought bubbles that float above villagers' heads
  bubble(v, emoji) {
    if (this.bubbles.length > 10 || v.inside) return;
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = emoji;
    this.bubbleEl.appendChild(el);
    this.bubbles.push({ el, v, t: 0, life: 2.8 });
  }

  _updateBubbles(dt) {
    const cam = this.game.camera, p = new THREE.Vector3();
    this.bubbles = this.bubbles.filter((b) => {
      b.t += dt;
      const v = b.v;
      if (b.t > b.life || v.inside || !this.game.villagers.list.includes(v)) { b.el.remove(); return false; }
      p.set(v.x, v.y + 0.72 + b.t * 0.05, v.z);
      const dist = cam.position.distanceTo(p);
      p.project(cam);
      if (p.z > 1 || dist > 45) { b.el.style.opacity = '0'; return true; }
      const pop = b.t < 0.25 ? 0.6 + 0.4 * Math.sin((b.t / 0.25) * Math.PI / 2) * 1.08 : 1;
      const sc = Math.max(0.65, Math.min(1.3, 16 / dist)) * pop;
      const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${sc})`;
      b.el.style.opacity = String(Math.min(1, (b.life - b.t) * 2.5, b.t * 6));
      return true;
    });
  }

  refresh(force) {
    const g = this.game;
    for (const [t, el] of Object.entries(this.toolEls)) {
      el.classList.toggle('active', g.tool === t);
      if (DEFS[t]) el.classList.toggle('poor', g.res.wood < DEFS[t].cost);
    }
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === g.speed));
    $('#b-gfx').classList.toggle('on', g.quality === 'high');
    $('#b-gfx').setAttribute('aria-pressed', String(g.quality === 'high'));
    const hint = this.els.hint;
    if (g.tool === 'path') hint.innerHTML = 'Click & drag to paint paths · Right-click to stop';
    else if (g.tool === 'demolish') hint.innerHTML = 'Click buildings or drag over paths to remove';
    else if (g.tool) hint.innerHTML = 'Click to build · <kbd>R</kbd> rotate · Right-click to cancel';
    else hint.innerHTML = 'Drag to move · Right-drag to orbit · Scroll to zoom';
    // keep the active tool visible in the scrolling touch toolbar
    if (g.tool !== this._lastTool) {
      this._lastTool = g.tool;
      const cat = this.toolEls[g.tool]?.dataset.cat;
      if (cat && cat !== this.cat) this.setCategory(cat);
      if (g.tool && g.isTouch && this.toolEls[g.tool]) this.toolEls[g.tool].scrollIntoView?.({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
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
    const se = g.season;
    set('day', `Day ${g.day}${se ? ' ' + se.icon : ''}`, e.day);
    const t = g.dayT;
    const label = t < 0.22 ? 'Night' : t < 0.3 ? 'Dawn' : t < 0.45 ? 'Morning' : t < 0.58 ? 'Midday' : t < 0.72 ? 'Afternoon' : t < 0.8 ? 'Dusk' : 'Night';
    set('time', se ? `${se.name} ${label.toLowerCase()}` : label, e.time);
    e.hand.style.transform = `rotate(${t * 360 + 180}deg)`;
    set('dialIco', t > 0.22 && t < 0.8 ? '☀️' : '🌙', e.dialIco);

    this._updateBubbles(dt);
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
