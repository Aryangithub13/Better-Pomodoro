/* ================================================================
   AmbientEngine — procedural study ambience via the Web Audio API.
   No audio files anywhere:

   Scenes — rain is high-passed white noise with a slow swell,
            deep drone is low-passed brown noise, wind is
            band-passed brown noise swept by a slow LFO.
   Noise colors — the classic spectrum, generated sample by sample:
            white (flat), pink (−3 dB/oct, Kellet filter),
            brown (−6 dB/oct integrator), blue (+3 dB/oct tilt),
            violet (+6 dB/oct derivative).

   Autoplay-safe by construction: no AudioContext, buffer or node
   exists until `wake()` runs inside a user gesture. Until then,
   setChannelOn / setLevel only record intent; wake() materialises
   it, and the guards keep it alive across sleep/backgrounding.
   ================================================================ */

export type SceneKey = "rain" | "drone" | "wind";
export type NoiseColor = "white" | "pink" | "brown" | "blue" | "violet";
export type ChannelKey = SceneKey | NoiseColor;

export const ALL_CHANNELS: ChannelKey[] = [
  "rain",
  "drone",
  "wind",
  "white",
  "pink",
  "brown",
  "blue",
  "violet",
];

const MAX_GAIN: Record<ChannelKey, number> = {
  rain: 0.9,
  drone: 1.1,
  wind: 0.9,
  white: 0.5,
  pink: 0.6,
  brown: 1.1,
  blue: 0.35,
  violet: 0.22,
};

const TAPER = 1.6; /* softer than squared — mid-slider is clearly audible */

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: Partial<Record<ChannelKey, GainNode>> = {};
  private built: Partial<Record<ChannelKey, boolean>> = {};
  private buffers: Partial<Record<NoiseColor, AudioBuffer>> = {};
  private wantedLevel: Record<ChannelKey, number>;
  private wantedOn: Partial<Record<ChannelKey, boolean>> = {};
  private guarded = false;
  /* true while the timer is paused — nothing may sound until released */
  private held = false;

  constructor() {
    this.wantedLevel = Object.fromEntries(ALL_CHANNELS.map((k) => [k, 0])) as Record<
      ChannelKey,
      number
    >;
  }

  /* Context creation happens only here, and wake() is the only caller
     that may run inside a gesture — so the context is never born
     suspended-and-orphaned by an effect. */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx.state === "closed" ? null : this.ctx;
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.installGuards();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /* re-arm after suspend (device sleep, background tab, interruptions) */
  private installGuards() {
    if (this.guarded || !this.ctx) return;
    this.guarded = true;
    const revive = () => {
      if (this.anyOn() && this.ctx && this.ctx.state === "suspended") {
        void this.ctx.resume();
      }
    };
    this.ctx.addEventListener("statechange", revive);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) revive();
    });
  }

  private anyOn(): boolean {
    return Object.values(this.wantedOn).some(Boolean);
  }

  /**
   * The only entry point that creates/resumes audio. Call it from
   * inside a user gesture (click, drag, key press). Returns true when
   * a usable context exists.
   */
  wake(): boolean {
    const ctx = this.ensure();
    if (!ctx) return false;
    if (ctx.state !== "running") void ctx.resume();
    ALL_CHANNELS.forEach((k) => {
      if (this.wantedOn[k]) this.materialise(k);
    });
    return true;
  }

  /* Build the channel (once) and ramp it to its intended level. */
  private materialise(key: ChannelKey) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed") return;
    if (!this.built[key]) this.build(key);
    const g = this.gains[key];
    if (!g) return;
    const v = Math.min(1, Math.max(0, this.wantedLevel[key] ?? 0));
    const target = this.wantedOn[key] ? Math.pow(v, TAPER) * MAX_GAIN[key] : 0;
    g.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
  }

  /** Switch a channel on/off. Safe any time — before the first gesture
      it only records intent; wake() applies it later. */
  setChannelOn(key: ChannelKey, on: boolean) {
    this.wantedOn[key] = on;
    if (this.ctx && this.ctx.state !== "closed") this.materialise(key);
  }

  /** Set a channel's fader (0..1). Safe any time. */
  setLevel(key: ChannelKey, v01: number) {
    this.wantedLevel[key] = Math.min(1, Math.max(0, v01));
    if (this.built[key]) this.materialise(key);
  }

  /* ------------------------------------------------ noise colors */
  private noiseBuffer(kind: NoiseColor): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const cached = this.buffers[kind];
    if (cached) return cached;

    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);

    if (kind === "white") {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else if (kind === "pink") {
      /* Paul Kellet's economical pink-noise filter (−3 dB/oct) */
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;
      /* pre-warm: run the filter settled before the audible region, or
         every loop restart begins with a quiet swell */
      for (let i = 0; i < 1024; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        b6 = w * 0.115926;
      }
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (kind === "brown") {
      /* leaky integrator (−6 dB/oct) */
      let last = 0;
      /* settle the integrator before the audible region */
      for (let i = 0; i < 1024; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      }
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    } else if (kind === "blue") {
      /* ~+3 dB/oct tilt: original blended with its first difference */
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        d[i] = (0.42 * w + 0.58 * (w - prev)) * 0.7;
        prev = w;
      }
    } else {
      /* violet: first difference (+6 dB/oct) */
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        d[i] = (w - prev) * 0.5;
        prev = w;
      }
    }

    /* seamless loop: crossfade the tail into the head so the 4s restart
       point is inaudible — no tick, no thump, no periodic artefact */
    const F = 4096;
    for (let i = 0; i < F; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / F);
      d[i] = d[i] * w + d[len - F + i] * (1 - w);
    }

    this.buffers[kind] = buf;
    return buf;
  }

  /* ------------------------------------------------ channels */
  private build(key: ChannelKey) {
    const ctx = this.ctx as AudioContext;
    const master = this.master as GainNode;
    const src = ctx.createBufferSource();
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;

    if (key === "rain") {
      src.buffer = this.noiseBuffer("white");
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1500;
      hp.Q.value = 0.4;
      src.connect(hp);
      hp.connect(g);
      /* The level must stay dead steady — an earlier LFO on the gain
         made the rain audibly swell and sink every ~9s (and even pump
         while "muted"). Motion now lives only in a slow brightness
         drift of the high-pass corner: the loudness never moves. */
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 90;
      lfo.connect(lfoAmt);
      lfoAmt.connect(hp.frequency);
      lfo.start();
    } else if (key === "drone") {
      src.buffer = this.noiseBuffer("brown");
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 300;
      lp.Q.value = 0.3;
      src.connect(lp);
      lp.connect(g);
    } else if (key === "wind") {
      src.buffer = this.noiseBuffer("brown");
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 520;
      bp.Q.value = 0.9;
      src.connect(bp);
      bp.connect(g);
      /* the wind moves: LFO sweeps the band centre */
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 240;
      lfo.connect(lfoAmt);
      lfoAmt.connect(bp.frequency);
      lfo.start();
    } else {
      /* pure noise color — straight to the fader */
      src.buffer = this.noiseBuffer(key);
      src.connect(g);
    }

    g.connect(master);
    src.start();
    this.gains[key] = g;
    this.built[key] = true;
  }
}

export const ambient = new AmbientEngine();
