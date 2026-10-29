/**
 * Game audio on WebAudio, built from real CC0 recordings (see public/sfx/CREDITS.txt).
 *
 * Samples are fetched once after the first user gesture (and cached by the service worker). Every sound is
 * positioned relative to the listener: stereo pan, distance attenuation, a distance low-pass so far-away
 * gunfire arrives as a muffled thump like in Tarkov, and a convolution reverb send that grows with distance
 * (and indoors). Pitch and sample choice are randomised so repeated shots and steps don't sound robotic.
 */
export type Surface = 'grass' | 'leaves' | 'wood' | 'stone' | 'gravel' | 'mud';

const SURFACE_FILTER: Partial<Record<Surface, { type: BiquadFilterType; freq: number; q?: number; gain?: number }>> = {
  grass: { type: 'lowpass', freq: 2000, q: 0.6 },
  leaves: { type: 'highshelf', freq: 3500, gain: 3 },
  stone: { type: 'highshelf', freq: 2500, gain: 6 },
  wood: { type: 'peaking', freq: 260, q: 1.1, gain: 6 },
  mud: { type: 'lowpass', freq: 1400, q: 0.8 },
};
const SURFACE_GAIN: Partial<Record<Surface, number>> = { grass: 0.85, stone: 1.1, wood: 1.0, gravel: 1.05, leaves: 1.0, mud: 0.9 };
export type GunClass = 'pistol' | 'pistol_heavy' | 'rifle' | 'carbine' | 'smg' | 'semi' | 'shotgun' | 'sniper';

type Bank = Record<string, AudioBuffer[]>;

interface Voice {
  /** Sample set name in the manifest. */
  set: string;
  gain?: number;
  rate?: number;
  /** ± random pitch. */
  jitter?: number;
  delay?: number;
  /** Optional tone shaping for this one voice. */
  filter?: { type: BiquadFilterType; freq: number; q?: number; gain?: number };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private bank: Bank = {};
  private loading: Promise<void> | null = null;
  private listener = { x: 0, y: 0, indoor: false };
  private ambience: AudioScheduledSourceNode[] = [];
  private ambState: { tod: string; rain: boolean } | null = null;
  private heartT = 0;
  private thunderT = 20;
  private volume = 0.7;
  private lastStep = new Map<number, number>();
  private lastIdx = new Map<string, number>();

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
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.6, 3);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.3;
    this.reverbSend.connect(reverb).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    void this.load();
  }

  /** Fetch + decode every sample listed in the manifest (≈1.7 MB, cached by the service worker). */
  load(): Promise<void> {
    if (this.loading || !this.ctx) return this.loading ?? Promise.resolve();
    const ctx = this.ctx;
    const base = `${import.meta.env.BASE_URL}sfx/`;
    this.loading = fetch(`${base}manifest.json`)
      .then((r) => r.json() as Promise<Record<string, string[]>>)
      .then(async (manifest) => {
        await Promise.all(
          Object.entries(manifest).map(async ([set, files]) => {
            const bufs = await Promise.all(
              files.map((f) =>
                fetch(base + f)
                  .then((r) => r.arrayBuffer())
                  .then((b) => ctx.decodeAudioData(b))
                  .catch(() => null),
              ),
            );
            this.bank[set] = bufs.filter((b): b is AudioBuffer => !!b);
          }),
        );
        if (this.ambState) this.startAmbience(this.ambState.tod, this.ambState.rain);
      })
      .catch(() => {});
    return this.loading;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setListener(x: number, y: number, indoor = false): void {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.indoor = indoor;
  }

  // ── Building blocks ──────────────────────────────────────────────────────────

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        // Early reflections + diffuse tail.
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? 0.8 : 0;
        ch[i] = ((Math.random() * 2 - 1) * 0.5 + early) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** Spatial output chain for one sound. Returns null when inaudible (saves nodes). */
  private spatial(x: number | null, y: number | null, range: number, reverb = 0.2, muffle = 1): { input: GainNode; t: number; dist: number } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const t = ctx.currentTime;
    const input = ctx.createGain();
    let out: AudioNode = input;
    let dist = 0;
    if (x !== null && y !== null) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      dist = Math.hypot(dx, dy);
      if (dist > range) return null;
      const att = 1 / (1 + Math.pow(dist / (range * 0.12), 1.5));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(350, 18000 * Math.pow(1 - dist / range, 2.6) * muffle);
      lp.Q.value = 0.5;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, dx / 12)) * Math.min(1, dist / 3);
      const g = ctx.createGain();
      g.gain.value = att;
      out = input.connect(lp).connect(pan).connect(g);
      reverb += (dist / range) * 0.8;
    }
    if (this.listener.indoor) reverb += 0.25;
    out.connect(this.sfx);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      out.connect(send).connect(this.reverbSend);
    }
    return { input, t, dist };
  }

  /** Pick a sample from a set, never the same one twice in a row. */
  private pick(set: string): AudioBuffer | null {
    const bufs = this.bank[set];
    if (!bufs?.length) return null;
    let i = Math.floor(Math.random() * bufs.length);
    if (bufs.length > 1 && i === this.lastIdx.get(set)) i = (i + 1) % bufs.length;
    this.lastIdx.set(set, i);
    return bufs[i]!;
  }

  private play(dest: AudioNode, t: number, v: Voice): boolean {
    const buf = this.pick(v.set);
    if (!buf) return false;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (v.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (v.jitter ?? 0.03));
    const g = ctx.createGain();
    g.gain.value = v.gain ?? 1;
    if (v.filter) {
      const f = ctx.createBiquadFilter();
      f.type = v.filter.type;
      f.frequency.value = v.filter.freq;
      f.Q.value = v.filter.q ?? 0.7;
      if (v.filter.gain !== undefined) f.gain.value = v.filter.gain;
      src.connect(f).connect(g).connect(dest);
    } else src.connect(g).connect(dest);
    src.start(t + (v.delay ?? 0));
    return true;
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
    src.start(t, Math.random() * 0.5);
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

  shot(weapon: string, x: number, y: number, mine: boolean, suppressed = false): void {
    const { set, rate } = GUN_VOICE[weapon] ?? { set: 'shot_rifle', rate: 1 };
    const s = this.spatial(mine ? null : x, mine ? null : y, suppressed ? 45 : 180, mine ? 0.18 : 0.25, suppressed ? 0.25 : 1);
    if (!s) return;
    let dest: AudioNode = s.input;
    if (suppressed) {
      // A can kills the crack: band-limit and drop the level, leave the mechanical clack.
      const ctx = this.ctx!;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      lp.connect(g).connect(s.input);
      dest = lp;
      this.noiseBurst(s.input, s.t, 0.04, 0.12, 'bandpass', 3800, 2);
    }
    if (!this.play(dest, s.t, { set, rate, gain: mine ? 0.95 : 1, jitter: 0.035 })) {
      this.noiseBurst(dest, s.t, 0.12, 1, 'bandpass', 2400, 0.7);
      this.tone(dest, s.t, 'sine', 140, 40, 0.26, 0.75);
    }
    // Distant gunfire: a late, low echo off the treeline.
    if (!mine && s.dist > 40) this.play(dest, s.t, { set, rate: rate * 0.9, gain: 0.25, delay: 0.25 + s.dist / 400 });
  }

  step(actor: number, surface: Surface, x: number, y: number, loud: number, mine: boolean): void {
    // De-duplicate when the sim emits several steps for the same actor in one frame.
    const now = this.ctx?.currentTime ?? 0;
    if ((this.lastStep.get(actor) ?? -1) > now - 0.12) return;
    this.lastStep.set(actor, now);
    const s = this.spatial(mine ? null : x, mine ? null : y, 26, 0.04);
    if (!s) return;
    const run = loud > 1.1;
    const g = (mine ? 0.5 : 0.65) * loud * (SURFACE_GAIN[surface] ?? 1);
    // Each surface gets its own colour so you can hear where you (and they) are walking:
    // grass is a soft muffled swish, concrete a sharp heel click with a short slap-back, wood a hollow knock.
    const filter = SURFACE_FILTER[surface];
    if (!this.play(s.input, s.t, { set: `step_${surface}`, gain: g, jitter: run ? 0.12 : 0.08, rate: run ? 1.08 : 1, filter })) {
      this.noiseBurst(s.input, s.t, 0.08, g * 0.5, 'lowpass', 900, 0.8);
    }
    if (surface === 'grass' || surface === 'leaves') this.noiseBurst(s.input, s.t + 0.01, run ? 0.18 : 0.12, g * 0.22, 'bandpass', surface === 'leaves' ? 3200 : 1800, 0.9, 0.02);
    else if (surface === 'stone') {
      this.noiseBurst(s.input, s.t, 0.03, g * 0.35, 'highpass', 2600, 0.8);
      this.play(s.input, s.t, { set: 'step_stone', gain: g * 0.18, delay: 0.07, filter: { type: 'lowpass', freq: 1800 } });
    } else if (surface === 'wood') this.tone(s.input, s.t, 'sine', 140, 90, 0.09, g * 0.25);
    else if (surface === 'gravel') this.noiseBurst(s.input, s.t + 0.02, 0.1, g * 0.3, 'bandpass', 4200, 1.4, 0.01);
    // Kit rattles when you run.
    if (run && Math.random() < 0.6) this.play(s.input, s.t, { set: Math.random() < 0.5 ? 'gear' : 'cloth', gain: g * 0.35, jitter: 0.1, delay: 0.03 });
  }

  reload(weapon: string, x: number, y: number, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 20, 0.05);
    if (!s) return;
    const cls = GUN_VOICE[weapon]?.set ?? 'shot_rifle';
    if (cls === 'shot_shotgun') {
      for (let i = 0; i < 3; i++) this.play(s.input, s.t, { set: 'items', gain: 0.4, delay: i * 0.45, jitter: 0.1 });
      this.play(s.input, s.t, { set: 'pump', gain: 0.8, delay: 1.5 });
    } else if (cls.startsWith('shot_pistol')) {
      this.play(s.input, s.t, { set: 'reload_pistol', gain: 0.8 });
    } else {
      this.play(s.input, s.t, { set: 'reload_rifle', gain: 0.8 });
    }
  }

  swing(x: number, y: number, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 20, 0.05);
    if (!s) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, s.t);
    f.frequency.exponentialRampToValueAtTime(1400, s.t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s.t);
    g.gain.linearRampToValueAtTime(0.4, s.t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, s.t + 0.24);
    src.connect(f).connect(g).connect(s.input);
    src.start(s.t);
    src.stop(s.t + 0.26);
    this.play(s.input, s.t, { set: 'cloth', gain: 0.3 });
  }

  hit(x: number, y: number, armor: boolean, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 40, 0.08);
    if (!s) return;
    if (armor) this.play(s.input, s.t, { set: 'impact_metal', gain: 0.7, rate: 1.3, jitter: 0.08 });
    else {
      // Flesh: dull, low, short.
      const lp = this.ctx!.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      lp.connect(s.input);
      this.play(lp, s.t, { set: 'impact_hit', gain: 1.1, rate: 0.75, jitter: 0.1 });
    }
  }

  impact(x: number, y: number, material: 'wood' | 'metal' | 'ground' | 'glass' = 'ground'): void {
    const s = this.spatial(x, y, 45, 0.1);
    if (!s) return;
    const set = material === 'wood' ? 'impact_wood' : material === 'metal' ? 'impact_metal' : material === 'glass' ? 'glass' : 'impact_hit';
    this.play(s.input, s.t, { set, gain: material === 'ground' ? 0.35 : 0.5, rate: 1.2, jitter: 0.15 });
    this.noiseBurst(s.input, s.t, 0.04, 0.2, 'highpass', 3500, 0.8);
  }

  groan(x: number, y: number): void {
    const s = this.spatial(x, y, 26, 0.25);
    if (!s) return;
    this.play(s.input, s.t, { set: 'moan', gain: 0.8, jitter: 0.12 });
  }

  door(x: number, y: number): void {
    const s = this.spatial(x, y, 24, 0.15);
    if (s) this.play(s.input, s.t, { set: 'door', gain: 0.6 });
  }

  glass(x: number, y: number): void {
    const s = this.spatial(x, y, 40, 0.2);
    if (s) this.play(s.input, s.t, { set: 'glass', gain: 0.9, jitter: 0.06 });
  }

  /** Rummaging through a container or body. */
  search(x: number, y: number): void {
    const s = this.spatial(x, y, 14, 0.05);
    if (s) {
      this.play(s.input, s.t, { set: 'zipper', gain: 0.5 });
      this.play(s.input, s.t, { set: 'items', gain: 0.4, delay: 0.35 });
    }
  }

  meds(): void {
    const s = this.spatial(null, null, 0, 0);
    if (!s) return;
    this.play(s.input, s.t, { set: 'zipper', gain: 0.5 });
    this.play(s.input, s.t, { set: 'items', gain: 0.35, delay: 0.4 });
  }

  ui(kind: 'click' | 'move' | 'deny' | 'equip'): void {
    const s = this.spatial(null, null, 0, 0);
    if (!s) return;
    if (kind === 'click') this.tone(s.input, s.t, 'sine', 1300, 1100, 0.03, 0.06);
    else if (kind === 'move') {
      if (!this.play(s.input, s.t, { set: 'items', gain: 0.25, rate: 1.2, jitter: 0.1 })) this.noiseBurst(s.input, s.t, 0.05, 0.12, 'lowpass', 900, 0.6);
    }
    else if (kind === 'equip') this.play(s.input, s.t, { set: 'gear', gain: 0.4, jitter: 0.1 });
    else this.tone(s.input, s.t, 'square', 180, 140, 0.08, 0.05);
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
    if (this.ambState?.rain) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 25 + Math.random() * 50;
        const s = this.spatial(null, null, 0, 0.4);
        if (s) this.play(s.input, s.t, { set: 'thunder', gain: 0.5, rate: 0.8 + Math.random() * 0.3 });
      }
    }
  }

  startAmbience(timeOfDay: string, rain: boolean): void {
    this.stopAmbience();
    this.ambState = { tod: timeOfDay, rain };
    const ctx = this.ctx;
    if (!ctx) return;
    const bed = (set: string, gain: number) => {
      const buf = this.bank[set]?.[0];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // mp3 encoder padding: skip the first/last few ms so the loop point is clean.
      src.loopStart = 0.05;
      src.loopEnd = buf.duration - 0.05;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 3);
      src.connect(g).connect(this.amb);
      src.start(ctx.currentTime, Math.random() * (buf.duration - 1));
      this.ambience.push(src);
    };
    bed('amb_wind', timeOfDay === 'night' ? 0.55 : 0.4);
    if (timeOfDay !== 'night' && !rain) bed('amb_birds', timeOfDay === 'dusk' ? 0.25 : 0.45);
    if (rain) bed('amb_rain', 0.7);
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
      pg.gain.value = 0.006;
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
        n.stop();
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

/** Which recording each gun uses, and a playback-rate tweak so siblings don't sound identical. */
const GUN_VOICE: Record<string, { set: string; rate: number }> = {
  pm: { set: 'shot_pistol', rate: 1.05 },
  mp443: { set: 'shot_pistol', rate: 0.97 },
  glock17: { set: 'shot_pistol', rate: 1.0 },
  m1911: { set: 'shot_pistol_heavy', rate: 1 },
  deagle: { set: 'shot_pistol_heavy', rate: 0.85 },
  mp133: { set: 'shot_shotgun', rate: 1 },
  saiga12: { set: 'shot_shotgun', rate: 1.06 },
  aks74u: { set: 'shot_rifle', rate: 1.08 },
  ak74m: { set: 'shot_rifle', rate: 1.02 },
  akm: { set: 'shot_rifle', rate: 0.94 },
  m4a1: { set: 'shot_carbine', rate: 1 },
  hk416: { set: 'shot_carbine', rate: 0.97 },
  mp5: { set: 'shot_smg', rate: 1.05 },
  ppsh: { set: 'shot_smg', rate: 0.95 },
  vector: { set: 'shot_smg', rate: 1.1 },
  sks: { set: 'shot_semi', rate: 1 },
  vepr: { set: 'shot_semi', rate: 0.93 },
  svd: { set: 'shot_sniper', rate: 1.04 },
  mosin: { set: 'shot_sniper', rate: 0.96 },
  m700: { set: 'shot_sniper', rate: 1.0 },
  pkm: { set: 'shot_rifle', rate: 0.86 },
};

export function gunClass(defId: string): GunClass {
  return (GUN_VOICE[defId]?.set.replace('shot_', '') ?? 'rifle') as GunClass;
}
