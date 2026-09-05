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

   Everything stays inside the neutral, quiet register.
   ================================================================ */

export type SceneKey = "rain" | "drone" | "wind";
export type NoiseColor = "white" | "pink" | "brown" | "blue" | "violet";
export type ChannelKey = SceneKey | NoiseColor;

const MAX_GAIN: Record<ChannelKey, number> = {
  rain: 0.5,
  drone: 0.85,
  wind: 0.6,
  white: 0.2,
  pink: 0.3,
  brown: 0.85,
  blue: 0.14,
  violet: 0.09,
};

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: Partial<Record<ChannelKey, GainNode>> = {};
  private built: Partial<Record<ChannelKey, boolean>> = {};
  private buffers: Partial<Record<NoiseColor, AudioBuffer>> = {};
  private enabled = false;

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
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
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
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
      /* slow amplitude swell so the rain breathes */
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.08;
      lfo.connect(lfoAmt);
      lfoAmt.connect(g.gain);
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

  setLevel(key: ChannelKey, v01: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (!this.built[key]) this.build(key);
    const g = this.gains[key];
    if (!g) return;
    const v = Math.min(1, Math.max(0, v01));
    /* perceptual taper */
    g.gain.setTargetAtTime(v * v * MAX_GAIN[key], ctx.currentTime, 0.2);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.3);
  }
}

export const ambient = new AmbientEngine();
