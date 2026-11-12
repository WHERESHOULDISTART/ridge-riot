// All sound is synthesised live with WebAudio: no audio files to download.
import { mulberry32 } from './util.js';

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], penta: [0, 3, 5, 7, 10], raga: [0, 1, 4, 5, 7, 8, 11], japan: [0, 2, 3, 7, 8],
  major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phryg: [0, 1, 3, 5, 7, 8, 10],
};
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSys {
  constructor() { this.ctx = null; this.muted = false; this.music = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor(); this.master.connect(comp); comp.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musBus = c.createGain(); this.musBus.gain.value = 0.34; this.musBus.connect(this.master);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // continuous wind + tyre rumble
    const mk = (type, f, q) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; src.connect(fl); fl.connect(g); g.connect(this.sfxBus); src.start();
      return { fl, g };
    };
    this.wind = mk('bandpass', 600, 0.6); this.tyre = mk('lowpass', 220, 1); this.storm = mk('bandpass', 260, 0.5);
    this.setVolumes(this.vol || { music: 0.7, sfx: 0.9 });
    if (this.pending) { const p = this.pending; this.pending = null; this.setMusic(p[0], p[1]); }
  }
  setVolumes(v) { this.vol = v; if (this.ctx) { this.sfxBus.gain.value = v.sfx; this.musBus.gain.value = v.music * 0.5; } }
  setStorm(k) { if (this.ctx) { const t = this.ctx.currentTime; this.storm.g.gain.setTargetAtTime(k * 0.9, t, 0.15); this.storm.fl.frequency.setTargetAtTime(200 + k * 500, t, 0.2); } }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.8; return this.muted; }

  tone(o) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (o.delay || 0), dur = o.dur || 0.15, vol = (o.vol ?? 0.3) * (this._v ?? 1);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'square'; osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f2, 1), t + dur);
    if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = o.vibAmt || 30; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.attack || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || this.sfxBus); osc.start(t); osc.stop(t + dur + 0.05);
  }
  noise(o) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + (o.delay || 0), dur = o.dur || 0.2, vol = (o.vol ?? 0.3) * (this._v ?? 1);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const fl = c.createBiquadFilter(); fl.type = o.type || 'bandpass'; fl.Q.value = o.q ?? 1; fl.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.attack || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(o.bus || this.sfxBus); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  arp(notes, step, o = {}) { notes.forEach((n, i) => this.tone({ f: hz(n), dur: o.dur || 0.14, type: o.type || 'square', vol: o.vol ?? 0.18, delay: i * step })); }

  // ---- sound effects -----------------------------------------------------------
  play(name, vol = 1) {
    if (!this.ctx || vol <= 0.02) return;
    this._v = vol;
    const T = (o) => this.tone(o), N = (o) => this.noise(o);
    switch (name) {
      case 'move': T({ f: 660, f2: 880, dur: 0.06, vol: 0.14 }); break;
      case 'select': T({ f: 520, dur: 0.07, vol: 0.2 }); T({ f: 1040, dur: 0.16, vol: 0.2, delay: 0.06 }); N({ f: 5000, dur: 0.08, vol: 0.08, type: 'highpass' }); break;
      case 'back': T({ f: 500, f2: 250, dur: 0.14, vol: 0.18 }); break;
      case 'error': T({ f: 180, dur: 0.2, vol: 0.2, type: 'sawtooth' }); break;
      case 'count': T({ f: 440, dur: 0.22, vol: 0.3, type: 'square' }); break;
      case 'go': T({ f: 880, dur: 0.6, vol: 0.32 }); T({ f: 1320, dur: 0.6, vol: 0.18 }); N({ f: 3000, dur: 0.3, vol: 0.12, type: 'highpass' }); break;
      case 'pickup': this.arp([84, 88, 91, 96], 0.045, { vol: 0.2 }); N({ f: 7000, dur: 0.25, vol: 0.07, type: 'highpass' }); break;
      case 'tick': T({ f: 1300, dur: 0.035, vol: 0.12 }); break;
      case 'ready': this.arp([91, 96, 100], 0.07, { vol: 0.22, dur: 0.2 }); break;
      case 'chili': N({ f: 300, f2: 4500, dur: 0.7, vol: 0.4, q: 2 }); T({ f: 110, f2: 520, dur: 0.6, vol: 0.28, type: 'sawtooth' }); this.arp([72, 76, 79, 84], 0.05, { vol: 0.12, type: 'sawtooth' }); break;
      case 'goat': T({ f: 520, f2: 430, dur: 0.55, vol: 0.3, type: 'sawtooth', vib: 18, vibAmt: 60 }); T({ f: 560, f2: 470, dur: 0.3, vol: 0.2, type: 'square', vib: 22, vibAmt: 70, delay: 0.6 }); break;
      case 'goatHit': T({ f: 600, f2: 380, dur: 0.3, vol: 0.3, type: 'sawtooth', vib: 22, vibAmt: 80 }); N({ f: 400, dur: 0.2, vol: 0.4, type: 'lowpass' }); T({ f: 140, f2: 50, dur: 0.25, vol: 0.4, type: 'sine' }); break;
      case 'mudDrop': T({ f: 300, f2: 90, dur: 0.18, vol: 0.25, type: 'sine' }); N({ f: 500, dur: 0.12, vol: 0.2, type: 'lowpass' }); break;
      case 'splat': N({ f: 900, f2: 200, dur: 0.35, vol: 0.5, type: 'lowpass', q: 3 }); T({ f: 220, f2: 60, dur: 0.3, vol: 0.3, type: 'sine' }); T({ f: 150, f2: 320, dur: 0.12, vol: 0.15, type: 'sine', delay: 0.18 }); break;
      case 'shield': this.arp([72, 79, 84, 91, 96], 0.05, { type: 'sine', vol: 0.22, dur: 0.4 }); T({ f: 300, f2: 1200, dur: 0.5, vol: 0.1, type: 'sine' }); break;
      case 'pop': T({ f: 900, f2: 200, dur: 0.12, vol: 0.3, type: 'sine' }); N({ f: 4000, dur: 0.1, vol: 0.2, type: 'highpass' }); break;
      case 'horn': [0, 0.01].forEach((d, i) => T({ f: i ? 233 : 175, dur: 0.75, vol: 0.3, type: 'sawtooth', attack: 0.03, delay: d })); T({ f: 87, dur: 0.75, vol: 0.3, type: 'square', attack: 0.03 }); N({ f: 120, dur: 1.2, vol: 0.5, type: 'lowpass', delay: 0.15 }); break;
      case 'spring': T({ f: 180, f2: 900, dur: 0.16, vol: 0.3, type: 'sine' }); T({ f: 900, f2: 300, dur: 0.3, vol: 0.2, type: 'sine', delay: 0.15, vib: 30, vibAmt: 120 }); break;
      case 'hop': T({ f: 240, f2: 520, dur: 0.1, vol: 0.12, type: 'sine' }); break;
      case 'blizzard': N({ f: 500, f2: 2600, dur: 1.4, vol: 0.4, q: 4, attack: 0.3 }); this.arp([96, 91, 88, 84, 79, 76], 0.08, { type: 'sine', vol: 0.16, dur: 0.3 }); break;
      case 'frozen': this.arp([100, 96, 93, 88], 0.06, { type: 'triangle', vol: 0.2, dur: 0.25 }); N({ f: 6000, dur: 0.4, vol: 0.12, type: 'highpass' }); break;
      case 'kick': N({ f: 1200, f2: 300, dur: 0.16, vol: 0.28, q: 1.5 }); break;
      case 'hit': N({ f: 700, dur: 0.14, vol: 0.55, type: 'lowpass' }); T({ f: 190, f2: 55, dur: 0.2, vol: 0.5, type: 'sine' }); T({ f: 1200, f2: 400, dur: 0.06, vol: 0.2, type: 'square' }); break;
      case 'bump': N({ f: 400, dur: 0.1, vol: 0.4, type: 'lowpass' }); T({ f: 120, f2: 60, dur: 0.12, vol: 0.35, type: 'sine' }); break;
      case 'crash': N({ f: 1500, f2: 200, dur: 0.6, vol: 0.55, type: 'lowpass' }); T({ f: 160, f2: 40, dur: 0.4, vol: 0.5, type: 'sine' }); [0.12, 0.3, 0.45].forEach((d) => N({ f: 2400, dur: 0.07, vol: 0.25, delay: d, q: 3 })); break;
      case 'land': N({ f: 260, dur: 0.14, vol: 0.4, type: 'lowpass' }); T({ f: 95, f2: 50, dur: 0.14, vol: 0.35, type: 'sine' }); break;
      case 'trick': this.arp([76, 79, 84, 88, 91], 0.055, { vol: 0.2, dur: 0.18 }); N({ f: 6000, dur: 0.35, vol: 0.06, type: 'highpass', delay: 0.2 }); break;
      case 'pad': T({ f: 300, f2: 1400, dur: 0.3, vol: 0.25, type: 'sawtooth' }); N({ f: 800, f2: 5000, dur: 0.35, vol: 0.2, q: 2 }); break;
      case 'finish': this.arp([72, 76, 79, 84, 79, 84, 88, 91], 0.11, { vol: 0.24, dur: 0.3 }); this.arp([48, 55, 60, 60], 0.22, { vol: 0.2, dur: 0.4, type: 'sawtooth' }); break;
      case 'throw': N({ f: 900, f2: 2600, dur: 0.14, vol: 0.3, q: 1.5 }); T({ f: 500, f2: 900, dur: 0.1, vol: 0.12, type: 'sine' }); break;
      case 'boom': N({ f: 900, f2: 60, dur: 0.9, vol: 0.8, type: 'lowpass' }); T({ f: 110, f2: 28, dur: 0.7, vol: 0.7, type: 'sine' }); N({ f: 3000, dur: 0.12, vol: 0.4, type: 'highpass' }); break;
      case 'thud': N({ f: 300, dur: 0.16, vol: 0.5, type: 'lowpass' }); T({ f: 110, f2: 45, dur: 0.2, vol: 0.5, type: 'sine' }); break;
      case 'moo': T({ f: 150, f2: 105, dur: 0.9, vol: 0.4, type: 'sawtooth', attack: 0.1, vib: 5, vibAmt: 6 }); T({ f: 300, f2: 210, dur: 0.9, vol: 0.12, type: 'square', attack: 0.1 }); break;
      case 'bleat': T({ f: 540, f2: 440, dur: 0.5, vol: 0.3, type: 'sawtooth', vib: 19, vibAmt: 65 }); break;
      case 'trumpet': T({ f: 320, f2: 760, dur: 0.35, vol: 0.4, type: 'sawtooth', attack: 0.03 }); T({ f: 760, f2: 520, dur: 0.6, vol: 0.4, type: 'sawtooth', delay: 0.33, vib: 28, vibAmt: 50 }); break;
      case 'carhorn': T({ f: 415, dur: 0.45, vol: 0.3, type: 'square' }); T({ f: 523, dur: 0.45, vol: 0.3, type: 'square' }); break;
      case 'hey': T({ f: 330, f2: 520, dur: 0.14, vol: 0.3, type: 'sawtooth' }); T({ f: 520, f2: 380, dur: 0.25, vol: 0.3, type: 'sawtooth', delay: 0.13 }); break;
      case 'geyser': N({ f: 400, f2: 3500, dur: 1.5, vol: 0.6, q: 1, attack: 0.1 }); T({ f: 60, f2: 120, dur: 1.2, vol: 0.4, type: 'sine' }); break;
      case 'lose': this.arp([67, 63, 60, 55], 0.16, { vol: 0.2, dur: 0.3, type: 'triangle' }); break;
    }
    this._v = 1;
  }

  // wind + tyre noise follow the fastest local rider
  setRide(speed, grounded, off) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = Math.min(speed / 40, 1.3);
    this.wind.g.gain.setTargetAtTime(0.02 + k * k * 0.22, t, 0.1); this.wind.fl.frequency.setTargetAtTime(350 + k * 1500, t, 0.1);
    this.tyre.g.gain.setTargetAtTime(grounded ? k * (0.25 + off * 0.3) : 0, t, 0.04); this.tyre.fl.frequency.setTargetAtTime(120 + k * 300 + off * 200, t, 0.1);
  }
  stopRide() { if (this.ctx) { const t = this.ctx.currentTime; this.storm.g.gain.setTargetAtTime(0, t, 0.1); this.wind.g.gain.setTargetAtTime(0, t, 0.1); this.tyre.g.gain.setTargetAtTime(0, t, 0.05); } }

  // ---- music: tiny generative sequencer ----------------------------------------
  // ---- music: generative metal. Distorted power-chord riffs, gallop chugs, double kick, lead guitar.
  _guitar() {
    if (this.gtr) return this.gtr;
    const c = this.ctx, ws = c.createWaveShaper(), n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 9); }
    ws.curve = curve; ws.oversample = '2x';
    const pre = c.createGain(); pre.gain.value = 1.4;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.7;
    const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 900; mid.gain.value = 5;
    const out = c.createGain(); out.gain.value = 0.2;
    pre.connect(hp); hp.connect(ws); ws.connect(mid); mid.connect(lp); lp.connect(out); out.connect(this.musBus);
    return (this.gtr = pre);
  }
  setMusic(kind, cfg = {}) {
    if (!this.ctx) { this.pending = [kind, cfg]; return; }
    if (this.music && this.music.key === kind + (cfg.root || '')) return;
    this.stopMusic();
    if (!kind) return;
    const menu = kind === 'menu', G = this._guitar(), B = this.musBus;
    const root = menu ? 40 : 36 + ((cfg.root || 45) % 12 > 7 ? (cfg.root % 12) - 12 : (cfg.root || 45) % 12) + 0;
    const scale = SCALES[menu ? 'phryg' : cfg.scale && cfg.scale !== 'major' && cfg.scale !== 'penta' ? cfg.scale : 'minor'];
    const bpm = menu ? 132 : (cfg.bpm || 140) + 26;
    const rnd = mulberry32((root * 131 + bpm) | 0);
    const deg = (d, oct = 0) => root + oct * 12 + scale[((d % scale.length) + scale.length) % scale.length] + 12 * Math.floor(d / scale.length);
    const prog = [[0, 0, 5, 6], [0, 0, 3, 1], [0, 5, 3, 4], [0, 1, 0, 6]][Math.floor(rnd() * 4)];
    // riff: which 16ths are muted chugs (1), open power chords (2) or rests (0)
    const riffs = [[2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 1, 1, 1], [1, 1, 2, 1, 1, 2, 1, 1, 2, 0, 1, 1, 2, 0, 2, 0], [2, 0, 0, 1, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 1, 1]];
    const riff = riffs[Math.floor(rnd() * riffs.length)], riffB = riffs[Math.floor(rnd() * riffs.length)];
    const lead = []; let cur = 7 + Math.floor(rnd() * 3);
    for (let i = 0; i < 64; i++) { if (i % 2 === 0 && rnd() < 0.8) { cur = Math.max(4, Math.min(16, cur + Math.floor(rnd() * 5) - 2)); lead.push(cur); } else lead.push(null); }
    const m = (this.music = { key: kind + (cfg.root || ''), step: 0, next: this.ctx.currentTime + 0.08, timer: 0 });
    const spb = 60 / bpm / 4;
    const chord = (note, dur, d, vol) => { for (const [iv, dt] of [[0, 0], [7, 0.004], [12, -0.003]]) this.tone({ f: hz(note + iv) * (1 + dt), dur, vol, type: 'sawtooth', delay: d, bus: G, attack: 0.004 }); };
    const sched = () => {
      const c = this.ctx;
      while (m.next < c.currentTime + 0.14) {
        const st = m.step % 64, bar = Math.floor(st / 16), s16 = st % 16, d = m.next - c.currentTime, phrase = Math.floor(m.step / 64) % 4;
        const ch = prog[bar], r = (bar % 2 ? riffB : riff)[s16], solo = phrase === 2 || phrase === 3;
        if (menu) {
          // slow, heavy half-time groove
          if (s16 % 8 === 0) chord(deg(ch, 0), spb * 7, d, 0.5);
          if (s16 === 6 || s16 === 14) chord(deg(ch, 0), spb * 0.9, d, 0.35);
          if (s16 === 0 || s16 === 10) this.tone({ f: 150, f2: 40, dur: 0.2, vol: 0.6, type: 'sine', delay: d, bus: B });
          if (s16 === 8) { this.noise({ f: 1700, dur: 0.2, vol: 0.4, q: 0.7, delay: d, bus: B }); this.tone({ f: 190, f2: 110, dur: 0.1, vol: 0.2, type: 'triangle', delay: d, bus: B }); }
          if (s16 % 4 === 0) this.noise({ f: 8500, dur: 0.05, vol: 0.07, type: 'highpass', delay: d, bus: B });
          if (s16 % 8 === 0) this.tone({ f: hz(deg(ch, -1)), dur: spb * 7, vol: 0.3, type: 'sawtooth', delay: d, bus: B });
          if (lead[st] != null && st % 4 === 0 && phrase % 2) this.tone({ f: hz(deg(lead[st], 1)), dur: spb * 3.6, vol: 0.22, type: 'sawtooth', delay: d, bus: G, vib: 5.5, vibAmt: 7, attack: 0.02 });
        } else {
          if (r === 2) chord(deg(ch, 0), spb * 1.9, d, 0.5);
          else if (r === 1) chord(root, spb * 0.55, d, 0.42);
          if (r) this.tone({ f: hz((r === 2 ? deg(ch, 0) : root) - 12), dur: spb * (r === 2 ? 1.8 : 0.7), vol: 0.3, type: 'sawtooth', delay: d, bus: B });
          // drums: double-kick follows the riff, snare on 2 and 4, ride/hat 8ths, crash on the one
          if (r || s16 % 4 === 0) this.tone({ f: 160, f2: 42, dur: 0.11, vol: 0.55, type: 'sine', delay: d, bus: B });
          if (s16 % 8 === 4) { this.noise({ f: 1900, dur: 0.16, vol: 0.42, q: 0.7, delay: d, bus: B }); this.tone({ f: 210, f2: 120, dur: 0.09, vol: 0.22, type: 'triangle', delay: d, bus: B }); }
          if (s16 % 2 === 0) this.noise({ f: 9000, dur: 0.035, vol: s16 % 4 === 0 ? 0.1 : 0.06, type: 'highpass', delay: d, bus: B });
          if (st === 0) this.noise({ f: 6000, dur: 0.9, vol: 0.16, type: 'highpass', delay: d, bus: B });
          if (bar === 3 && s16 >= 12) this.tone({ f: 230 - (s16 - 12) * 30, f2: 90, dur: 0.12, vol: 0.4, type: 'sine', delay: d, bus: B }); // tom fill
          if (solo && lead[st] != null) this.tone({ f: hz(deg(lead[st], 2)), dur: spb * 1.9, vol: 0.2, type: 'sawtooth', delay: d, bus: G, vib: 6, vibAmt: 9, attack: 0.01 });
        }
        m.step++; m.next += spb;
      }
    };
    m.timer = setInterval(sched, 30); sched();
  }
  stopMusic() { if (this.music) { clearInterval(this.music.timer); this.music = null; } }
}
