/**
 * Game audio on WebAudio, built only from real recordings (CC0 / CC-BY, see public/sfx/CREDITS.txt); nothing is
 * synthesised.
 *
 * Samples are fetched once after the first user gesture (and cached by the service worker). Every sound is
 * positioned relative to the listener: stereo pan, distance attenuation, a gentle distance low-pass and a reverb
 * send that grows with distance (and indoors). Gunfire crossfades from the close recording (crack + mechanism) to
 * a separate recording of the same gun made down range, so a distant AK is a real distant AK, not a filtered
 * close one. Pitch and sample choice are randomised so repeated shots and steps don't sound robotic.
 */
export type Surface = 'grass' | 'leaves' | 'wood' | 'stone' | 'gravel' | 'mud' | 'metal';

const SURFACE_GAIN: Partial<Record<Surface, number>> = { grass: 0.8, leaves: 0.9, stone: 1.0, wood: 1.0, gravel: 1.0, mud: 0.9, metal: 1.0 };
export type GunClass = 'pistol' | 'pistol_heavy' | 'rifle' | 'carbine' | 'smg' | 'semi' | 'shotgun' | 'sniper' | 'bolt';
export type HitKind = 'bullet' | 'armor' | 'blunt' | 'blade';
/** Heavy melee gets the long, low swishes. */
const HEAVY_MELEE = new Set(['axe', 'sledge', 'bat', 'crowbar', 'rebar', 'shovel']);
export const BLADES = new Set(['knife', 'machete', 'bayonet', 'kukri', 'hatchet', 'tomahawk', 'karambit', 'axe']);

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

/**
 * Silent for testing. The dev server (localhost) is muted unless the URL has `?sound=1`; any build is muted with
 * `?mute=1` or when the browser is driven by automation. Params may also follow a `#route?`.
 * Muted, the AudioContext is never created, so nothing loads or plays.
 */
const urlFlag = (name: string) => typeof window !== 'undefined' && new RegExp(`[?&]${name}(=1|=true)?(&|#|$)`).test(window.location.href);
export const AUDIO_MUTED =
  typeof window !== 'undefined' &&
  (urlFlag('mute') || navigator.webdriver === true || (import.meta.env.DEV && !urlFlag('sound')));

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private reverbSend!: GainNode;
  private bank: Bank = {};
  private loading: Promise<void> | null = null;
  private listener = { x: 0, y: 0, indoor: false };
  private ambience: AudioScheduledSourceNode[] = [];
  private ambState: { tod: string; rain: boolean } | null = null;
  private heartT = 0;
  private thunderT = 20;
  private volume = 0.7;
  private lastStep = new Map<number, number>();
  private lastVoice = new Map<number, number>();
  private lastIdx = new Map<string, number>();

  /** Must be called from a user gesture (browser autoplay policy). Safe to call repeatedly. */
  unlock(): void {
    if (AUDIO_MUTED) return;
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
    comp.threshold.value = -8;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.3;
    this.reverbSend.connect(reverb).connect(this.master);
    void this.load();
  }

  /** Fetch + decode every sample listed in the manifest (≈3 MB, cached by the service worker). */
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

  /** Diffuse room/outdoor tail for the reverb send: decorrelated stereo noise whose highs die away faster
   * than its lows, like air and soft surfaces do. Only ever heard under the (real) dry recordings. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        // One-pole low-pass whose cutoff falls with time: bright early, dark late.
        const a = 0.15 + 0.8 * k;
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        ch[i] = lp * Math.exp(-5.5 * k) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
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
      lp.frequency.value = Math.max(500, 18000 * Math.pow(1 - dist / range, 1.6) * muffle);
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

  // ── Sounds ───────────────────────────────────────────────────────────────────

  shot(weapon: string, x: number, y: number, mine: boolean, suppressed = false): void {
    const { set, rate } = GUN_VOICE[weapon] ?? { set: 'rifle', rate: 1 };
    const range = suppressed ? 45 : 200;
    const s = this.spatial(mine ? null : x, mine ? null : y, range, mine ? 0.06 : 0.1, suppressed ? 0.35 : 1);
    if (!s) return;
    const jitter = 0.03;
    if (suppressed) {
      // A can takes the crack and most of the boom; what's left is a dull thwack plus the action cycling.
      const lp = this.ctx!.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      lp.connect(s.input);
      this.play(lp, s.t, { set: `shot_${set}`, rate: rate * 1.05, gain: 0.32, jitter });
      this.play(s.input, s.t, { set: 'dry', gain: mine ? 0.45 : 0.3, rate: 0.9, jitter: 0.1, delay: 0.012 });
      return;
    }
    // Close recording fades out and the down-range recording fades in with distance.
    const r = s.dist / range;
    const near = mine ? 1 : 1 - smooth(0.12, 0.5, r);
    const far = mine ? 0 : smooth(0.06, 0.35, r);
    if (near > 0.01) this.play(s.input, s.t, { set: `shot_${set}`, rate, gain: near, jitter });
    if (far > 0.01) this.play(s.input, s.t, { set: `far_${set}`, rate, gain: far * 1.3, jitter });
  }

  step(actor: number, surface: Surface, x: number, y: number, loud: number, mine: boolean): void {
    // De-duplicate when the sim emits several steps for the same actor in one frame.
    const now = this.ctx?.currentTime ?? 0;
    if ((this.lastStep.get(actor) ?? -1) > now - 0.12) return;
    this.lastStep.set(actor, now);
    const s = this.spatial(mine ? null : x, mine ? null : y, 26, 0.04);
    if (!s) return;
    const run = loud > 1.1;
    const g = (mine ? 0.26 : 0.4) * loud * (SURFACE_GAIN[surface] ?? 1);
    this.play(s.input, s.t, { set: `step_${surface}`, gain: g, jitter: run ? 0.07 : 0.05, rate: run ? 1.04 : 1 });
    // Kit rattles when you run.
    if (run && Math.random() < 0.6) this.play(s.input, s.t, { set: Math.random() < 0.5 ? 'gear' : 'cloth', gain: g * 0.45, jitter: 0.08, delay: 0.03 });
  }

  reload(weapon: string, x: number, y: number, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 20, 0.05);
    if (!s) return;
    const cls = GUN_VOICE[weapon]?.set ?? 'rifle';
    if (cls === 'shotgun') {
      for (let i = 0; i < 3; i++) this.play(s.input, s.t, { set: 'items', gain: 0.4, delay: i * 0.45, jitter: 0.1 });
      this.play(s.input, s.t, { set: 'pump', gain: 0.8, delay: 1.5 });
    } else if (cls.startsWith('pistol')) {
      this.play(s.input, s.t, { set: 'reload_pistol', gain: 0.8 });
    } else {
      this.play(s.input, s.t, { set: 'reload_rifle', gain: 0.8 });
    }
  }

  swing(weapon: string, x: number, y: number, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 20, 0.04);
    if (!s) return;
    const heavy = HEAVY_MELEE.has(weapon);
    this.play(s.input, s.t, { set: heavy ? 'swing_heavy' : 'swing', gain: heavy ? 0.5 : 0.4, jitter: 0.08 });
    this.play(s.input, s.t, { set: 'cloth', gain: 0.25, jitter: 0.1 });
  }

  /** Something got hit: a bullet into flesh or armour, or a melee blow (blunt or bladed). */
  hit(x: number, y: number, kind: HitKind, mine: boolean): void {
    const s = this.spatial(mine ? null : x, mine ? null : y, 40, 0.06);
    if (!s) return;
    if (kind === 'armor') {
      this.play(s.input, s.t, { set: 'impact_metal', gain: 0.6, rate: 1.15, jitter: 0.08 });
    } else if (kind === 'bullet') {
      this.play(s.input, s.t, { set: 'flesh', gain: 0.75, jitter: 0.1 });
    } else if (kind === 'blade') {
      this.play(s.input, s.t, { set: 'stab', gain: 0.6, jitter: 0.08 });
      this.play(s.input, s.t, { set: 'flesh', gain: 0.55, jitter: 0.1, delay: 0.01 });
    } else {
      this.play(s.input, s.t, { set: 'punch', gain: 0.9, rate: 0.9, jitter: 0.08 });
    }
  }

  /** A wounded person cries out (rate-limited per actor so automatic fire doesn't stack screams). */
  pain(actor: number, x: number, y: number, sex: 'm' | 'f', infected: boolean, mine: boolean): void {
    const now = this.ctx?.currentTime ?? 0;
    if ((this.lastVoice.get(actor) ?? -9) > now - 0.9) return;
    this.lastVoice.set(actor, now);
    if (infected) return this.groan(x, y);
    const s = this.spatial(mine ? null : x, mine ? null : y, 30, 0.1);
    if (s) this.play(s.input, s.t, { set: `pain_${sex}`, gain: mine ? 0.55 : 0.7, jitter: 0.05 });
  }

  death(actor: number, x: number, y: number, sex: 'm' | 'f', infected: boolean, mine: boolean): void {
    this.lastVoice.set(actor, (this.ctx?.currentTime ?? 0) + 5);
    const s = this.spatial(mine ? null : x, mine ? null : y, 32, 0.12);
    if (!s) return;
    if (infected) this.play(s.input, s.t, { set: 'moan', gain: 0.8, rate: 0.85, jitter: 0.05 });
    else this.play(s.input, s.t, { set: `death_${sex}`, gain: 0.75, jitter: 0.04 });
  }

  impact(x: number, y: number, material: 'wood' | 'metal' | 'ground' | 'glass' = 'ground'): void {
    const s = this.spatial(x, y, 45, 0.08);
    if (!s) return;
    const set = material === 'wood' ? 'impact_wood' : material === 'metal' ? 'impact_metal' : material === 'glass' ? 'glass' : 'impact_stone';
    this.play(s.input, s.t, { set, gain: material === 'ground' ? 0.4 : 0.5, rate: 1.1, jitter: 0.12 });
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
    const gain = { click: 0.3, move: 0.3, deny: 0.35, equip: 0.4 }[kind];
    this.play(s.input, s.t, { set: `ui_${kind}`, gain, jitter: 0.06 });
  }

  /** Called every frame with the player's state. */
  tick(dt: number, hpFrac: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (hpFrac < 0.35) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.55 + hpFrac * 0.8;
        const s = this.spatial(null, null, 0, 0);
        if (s) this.play(s.input, s.t, { set: 'heartbeat', gain: 0.9 - hpFrac, jitter: 0.02 });
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
    if (timeOfDay === 'night' || timeOfDay === 'dusk') bed('amb_crickets', timeOfDay === 'night' ? 0.4 : 0.15);
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
const GUN_VOICE: Record<string, { set: GunClass; rate: number }> = {
  pm: { set: 'pistol', rate: 1.06 },
  mp443: { set: 'pistol', rate: 0.98 },
  glock17: { set: 'pistol', rate: 1.0 },
  rhino: { set: 'pistol_heavy', rate: 0.95 },
  mp133: { set: 'shotgun', rate: 1 },
  saiga12: { set: 'shotgun', rate: 1.05 },
  toz: { set: 'shotgun', rate: 0.96 },
  aks74u: { set: 'rifle', rate: 1.07 },
  ak74m: { set: 'rifle', rate: 1.03 },
  akm: { set: 'rifle', rate: 0.96 },
  rpk16: { set: 'rifle', rate: 0.99 },
  m4a1: { set: 'carbine', rate: 1 },
  hk416: { set: 'carbine', rate: 0.97 },
  aug: { set: 'carbine', rate: 1.03 },
  mp5: { set: 'smg', rate: 1.05 },
  pp19: { set: 'smg', rate: 1.0 },
  vector: { set: 'smg', rate: 1.1 },
  sks: { set: 'semi', rate: 1 },
  vepr: { set: 'semi', rate: 0.94 },
  svd: { set: 'sniper', rate: 1.04 },
  mosin: { set: 'sniper', rate: 0.97 },
  pkm: { set: 'sniper', rate: 1.08 },
  sv98: { set: 'bolt', rate: 1.0 },
};

export function gunClass(defId: string): GunClass {
  return GUN_VOICE[defId]?.set ?? 'rifle';
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
