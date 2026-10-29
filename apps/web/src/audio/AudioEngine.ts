/**
 * Procedural game audio on WebAudio — no sound files to download or cache.
 *
 * Every sound is synthesised from noise and oscillators, positioned relative to the listener (stereo pan +
 * distance attenuation + distance low-pass, so far-away gunfire sounds muffled like in Tarkov) and sent
 * through a generated convolution reverb.
 */
type Surface = 'grass' | 'wood' | 'hard' | 'dirt';
type GunClass = 'pistol' | 'rifle' | 'shotgun' | 'sniper' | 'mg';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private listener = { x: 0, y: 0 };
  private ambience: AudioNode[] = [];
  private heartT = 0;
  private volume = 0.7;
  private lastStep = new Map<number, number>();

  /** Must be called from a user gesture (browser autoplay policy). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.55;
    this.amb.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
  }

  // ── Building blocks ──────────────────────────────────────────────────────────

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** Spatial output chain for one sound. Returns null when inaudible (saves nodes). */
  private spatial(x: number | null, y: number | null, range: number, reverb = 0.25): { input: GainNode; t: number } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const t = ctx.currentTime;
    const input = ctx.createGain();
    let out: AudioNode = input;
    if (x !== null && y !== null) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const dist = Math.hypot(dx, dy);
      if (dist > range) return null;
      const att = 1 / (1 + Math.pow(dist / (range * 0.18), 1.6));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(500, 16000 * Math.pow(1 - dist / range, 2.2));
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, dx / 14));
      const g = ctx.createGain();
      g.gain.value = att;
      out = input.connect(lp).connect(pan).connect(g);
      reverb += (dist / range) * 0.5;
    }
    out.connect(this.sfx);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      out.connect(send).connect(this.reverbSend);
    }
    return { input, t };
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 1, attack = 0.002): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ── Sounds ───────────────────────────────────────────────────────────────────

  shot(cls: GunClass, x: number, y: number, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 120, 0.3);
    if (!s) return;
    const { input: o, t } = s;
    const v = mine ? 0.9 : 1;
    switch (cls) {
      case 'pistol':
        this.noiseBurst(o, t, 0.09, 0.9 * v, 'bandpass', 2600, 0.8);
        this.tone(o, t, 'triangle', 220, 60, 0.12, 0.5 * v);
        break;
      case 'shotgun':
        this.noiseBurst(o, t, 0.28, 1.1 * v, 'lowpass', 1400, 0.7);
        this.tone(o, t, 'sine', 120, 38, 0.4, 0.9 * v);
        break;
      case 'sniper':
        this.noiseBurst(o, t, 0.16, 1.2 * v, 'bandpass', 2200, 0.6);
        this.tone(o, t, 'sine', 110, 32, 0.55, 1.0 * v);
        this.noiseBurst(o, t + 0.02, 0.8, 0.25 * v, 'lowpass', 600, 0.5, 0.05);
        break;
      case 'mg':
      case 'rifle':
      default:
        this.noiseBurst(o, t, 0.12, 1.0 * v, 'bandpass', 2400, 0.7);
        this.tone(o, t, 'sine', 140, 40, 0.26, 0.75 * v);
        this.noiseBurst(o, t + 0.01, 0.35, 0.18 * v, 'lowpass', 900, 0.6, 0.02);
    }
  }

  step(actor: number, surface: Surface, x: number, y: number, loud: number, mine: boolean): void {
    // De-duplicate when the sim emits several steps for the same actor in one frame.
    const now = this.ctx?.currentTime ?? 0;
    if ((this.lastStep.get(actor) ?? -1) > now - 0.12) return;
    this.lastStep.set(actor, now);
    const s = this.spatial(mine ? null : x, mine ? null : y, 28, 0.05);
    if (!s) return;
    const g = (mine ? 0.18 : 0.32) * loud;
    switch (surface) {
      case 'wood':
        this.noiseBurst(s.input, s.t, 0.08, g, 'bandpass', 340, 2.2);
        this.tone(s.input, s.t, 'sine', 150, 90, 0.06, g * 0.6);
        break;
      case 'hard':
        this.noiseBurst(s.input, s.t, 0.05, g, 'bandpass', 1500, 1.4);
        break;
      case 'dirt':
        this.noiseBurst(s.input, s.t, 0.07, g, 'lowpass', 900, 0.8);
        break;
      default:
        this.noiseBurst(s.input, s.t, 0.09, g * 0.8, 'highpass', 2200, 0.6, 0.012);
    }
  }

  reload(x: number, y: number, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 18, 0.05);
    if (!s) return;
    for (const [dt, f] of [[0, 3200], [0.35, 2400], [0.9, 4200]] as const) this.noiseBurst(s.input, s.t + dt, 0.04, 0.45, 'bandpass', f, 6);
  }

  swing(x: number, y: number, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 20, 0.05);
    if (!s) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, s.t);
    f.frequency.exponentialRampToValueAtTime(1800, s.t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s.t);
    g.gain.linearRampToValueAtTime(0.5, s.t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, s.t + 0.22);
    src.connect(f).connect(g).connect(s.input);
    src.start(s.t);
    src.stop(s.t + 0.25);
  }

  hit(x: number, y: number, armor: boolean, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 40, 0.1);
    if (!s) return;
    if (armor) {
      this.tone(s.input, s.t, 'sine', 1900, 1700, 0.18, 0.35);
      this.tone(s.input, s.t, 'sine', 2850, 2700, 0.12, 0.2);
    } else {
      this.noiseBurst(s.input, s.t, 0.14, 0.7, 'lowpass', 500, 0.8);
      this.tone(s.input, s.t, 'sine', 95, 50, 0.12, 0.6);
    }
  }

  impact(x: number, y: number): void {
    const s = this.spatial(x, y, 50, 0.1);
    if (!s) return;
    this.noiseBurst(s.input, s.t, 0.05, 0.4, 'highpass', 3000, 0.8);
    this.noiseBurst(s.input, s.t + 0.02, 0.18, 0.12, 'bandpass', 1200, 0.6);
  }

  groan(x: number, y: number): void {
    const s = this.spatial(x, y, 26, 0.25);
    if (!s) return;
    const ctx = this.ctx!;
    const dur = 0.9 + Math.random() * 0.8;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 75 + Math.random() * 45;
    o.frequency.setValueAtTime(base, s.t);
    o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.2), s.t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5 + Math.random() * 3;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 6;
    lfo.connect(lfoG).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 520;
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1200;
    f2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s.t);
    g.gain.linearRampToValueAtTime(0.32, s.t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, s.t + dur);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(s.input);
    o.start(s.t);
    lfo.start(s.t);
    o.stop(s.t + dur);
    lfo.stop(s.t + dur);
  }

  meds(): void {
    const s = this.spatial(null, null, 0, 0);
    if (!s) return;
    for (let i = 0; i < 4; i++) this.noiseBurst(s.input, s.t + i * 0.09, 0.07, 0.25, 'bandpass', 4200, 1.5);
  }

  ui(kind: 'click' | 'move' | 'deny'): void {
    const s = this.spatial(null, null, 0, 0);
    if (!s) return;
    if (kind === 'click') this.tone(s.input, s.t, 'sine', 1300, 1100, 0.03, 0.08);
    else if (kind === 'move') this.noiseBurst(s.input, s.t, 0.05, 0.12, 'lowpass', 900, 0.6);
    else this.tone(s.input, s.t, 'square', 180, 140, 0.08, 0.06);
  }

  /** Called every frame with the player's state. */
  tick(dt: number, hpFrac: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (hpFrac < 0.35) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.55 + hpFrac * 0.8;
        const s = this.spatial(null, null, 0, 0);
        if (s) {
          this.tone(s.input, s.t, 'sine', 60, 40, 0.12, 0.5);
          this.tone(s.input, s.t + 0.16, 'sine', 55, 38, 0.12, 0.35);
        }
      }
    }
  }

  startAmbience(timeOfDay: string, rain: boolean): void {
    this.stopAmbience();
    const ctx = this.ctx;
    if (!ctx) return;
    const loop = (filterType: BiquadFilterType, freq: number, gain: number, lfoHz = 0.08) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lg = ctx.createGain();
      lg.gain.value = gain * 0.6;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(this.amb);
      src.start();
      lfo.start();
      this.ambience.push(src, lfo);
    };
    loop('lowpass', 380, 0.22); // wind
    if (rain) {
      loop('highpass', 2600, 0.12, 0.2);
      loop('lowpass', 1200, 0.05, 0.3);
    }
    if (timeOfDay === 'night') {
      // Crickets: pulsed high sine.
      const o = ctx.createOscillator();
      o.frequency.value = 4400;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pulse = ctx.createOscillator();
      pulse.type = 'square';
      pulse.frequency.value = 14;
      const pg = ctx.createGain();
      pg.gain.value = 0.012;
      pulse.connect(pg).connect(g.gain);
      o.connect(g).connect(this.amb);
      o.start();
      pulse.start();
      this.ambience.push(o, pulse);
    }
  }

  stopAmbience(): void {
    for (const n of this.ambience) {
      try {
        (n as AudioScheduledSourceNode).stop();
      } catch {
        /* already stopped */
      }
    }
    this.ambience = [];
  }

  suspend(): void {
    void this.ctx?.suspend();
  }
}

export const audio = new AudioEngine();

export function gunClass(defId: string): GunClass {
  if (defId === 'pm' || defId === 'mp443') return 'pistol';
  if (defId === 'mp133') return 'shotgun';
  if (defId === 'svd' || defId === 'sks') return 'sniper';
  if (defId === 'pkm') return 'mg';
  return 'rifle';
}
