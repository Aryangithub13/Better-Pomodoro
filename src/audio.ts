/* ================================================================
   AmbientEngine — procedural study ambience via the Web Audio API.
   No audio files: rain is high-passed white noise, drone is
   low-passed brown noise, wind is band-passed brown noise swept by
   a slow LFO. Everything stays inside the neutral, quiet register.
   ================================================================ */

export type ChannelKey = "rain" | "drone" | "wind";

const MAX_GAIN: Record<ChannelKey, number> = { rain: 0.5, drone: 0.85, wind: 0.6 };

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gains: Partial<Record<ChannelKey, GainNode>> = {};
  private built: Partial<Record<ChannelKey, boolean>> = {};
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
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

  private noiseBuffer(kind: "white" | "brown"): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const cached = kind === "white" ? this.white : this.brown;
    if (cached) return cached;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    if (kind === "white") {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.white = buf;
    } else {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.2;
      }
      this.brown = buf;
    }
    return buf;
  }

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
    } else {
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
