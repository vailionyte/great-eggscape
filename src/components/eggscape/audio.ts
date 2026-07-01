// Centralised procedural sound engine for Eggscape.
// All sounds are generated via Web Audio API — no external files.
// Cute + cozy defaults with a darker sting on game-over hits.

type ObstacleKind = "pan" | "pot" | "whisk" | "spatula" | "toaster";

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private noiseBuffer: AudioBuffer | null = null;

  // Rolling loop nodes
  private rollGain: GainNode | null = null;
  private rollOsc: OscillatorNode | null = null;
  private rollSub: OscillatorNode | null = null;
  private rollNoise: AudioBufferSourceNode | null = null;
  private rollNoiseGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rolling = false;
  private airborne = false;
  private currentSpeed = 4;

  /** Lazily create the AudioContext. MUST be called from a user gesture the first time. */
  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      // Pre-build a white-noise buffer once for reuse.
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.0, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    } catch { this.ctx = null; }
    return this.ctx;
  }

  /** Call from the very first user gesture (Space/click) — safe to call repeatedly. */
  init(): void {
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === "suspended") { void ctx.resume(); }
  }

  setMuted(v: boolean): void {
    this.muted = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.9;
  }

  // ---------- helpers ----------
  private now(): number { return this.ctx!.currentTime; }

  private tone(opts: {
    freq: number; type?: OscillatorType; dur: number; gain?: number;
    freqEnd?: number; attack?: number; delay?: number;
  }): void {
    const ctx = this.ensureCtx(); if (!ctx || !this.master) return;
    const t0 = this.now() + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + opts.dur);
    const peak = opts.gain ?? 0.15;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + opts.dur + 0.02);
  }

  private noise(opts: {
    dur: number; gain?: number; filter?: BiquadFilterType; freq?: number; q?: number;
    attack?: number; delay?: number;
  }): void {
    const ctx = this.ensureCtx(); if (!ctx || !this.master || !this.noiseBuffer) return;
    const t0 = this.now() + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter; f.frequency.value = opts.freq ?? 1000; f.Q.value = opts.q ?? 1;
      src.connect(f).connect(g).connect(this.master);
    } else {
      src.connect(g).connect(this.master);
    }
    src.start(t0); src.stop(t0 + opts.dur + 0.02);
  }

  // ---------- rolling loop ----------
  startRolling(): void {
    const ctx = this.ensureCtx(); if (!ctx || !this.master || this.rolling) return;
    this.rolling = true;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master);
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 380; filt.Q.value = 0.6;
    filt.connect(g);
    const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = 65;
    const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = 44;
    osc.connect(filt); sub.connect(filt);
    // subtle noise layer
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer; n.loop = true;
    const nGain = ctx.createGain(); nGain.gain.value = 0.35;
    n.connect(nGain).connect(filt);
    osc.start(); sub.start(); n.start();
    g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.25);
    this.rollGain = g; this.rollOsc = osc; this.rollSub = sub;
    this.rollNoise = n; this.rollNoiseGain = nGain; this.rollFilter = filt;
    this.applyRolling();
  }

  stopRolling(): void {
    if (!this.rolling || !this.ctx) return;
    this.rolling = false;
    const t = this.ctx.currentTime;
    try {
      this.rollGain?.gain.cancelScheduledValues(t);
      this.rollGain?.gain.setValueAtTime(this.rollGain.gain.value, t);
      this.rollGain?.gain.linearRampToValueAtTime(0.0001, t + 0.15);
      this.rollOsc?.stop(t + 0.2);
      this.rollSub?.stop(t + 0.2);
      this.rollNoise?.stop(t + 0.2);
    } catch {}
    this.rollGain = this.rollOsc = this.rollSub = null as any;
    this.rollNoise = this.rollNoiseGain = null as any;
    this.rollFilter = null;
  }

  setAirborne(v: boolean): void {
    if (this.airborne === v) return;
    this.airborne = v;
    this.applyRolling();
  }

  setSpeed(speed: number): void {
    this.currentSpeed = speed;
    this.applyRolling();
  }

  private applyRolling(): void {
    if (!this.rolling || !this.ctx || !this.rollOsc || !this.rollGain || !this.rollFilter || !this.rollSub) return;
    const t = this.ctx.currentTime;
    // Speed 3..9 → freq 55..95 Hz, filter 300..800, gain 0.04..0.075
    const spd = Math.max(2, Math.min(10, this.currentSpeed));
    const k = (spd - 2) / 8;
    const baseHz = 55 + k * 40;
    const target = this.airborne ? 0.0001 : (0.04 + k * 0.035);
    this.rollOsc.frequency.linearRampToValueAtTime(baseHz, t + 0.1);
    this.rollSub.frequency.linearRampToValueAtTime(baseHz * 0.7, t + 0.1);
    this.rollFilter.frequency.linearRampToValueAtTime(280 + k * 520, t + 0.1);
    this.rollGain.gain.cancelScheduledValues(t);
    this.rollGain.gain.linearRampToValueAtTime(target, t + 0.08);
  }

  // ---------- named SFX ----------

  /** Jump blip — same as launch flourish. */
  playJump(): void {
    this.tone({ freq: 440, freqEnd: 880, type: "triangle", dur: 0.14, gain: 0.14 });
  }

  /** No-op: landing sound removed. */
  playLand(): void { /* intentionally silent */ }


  /** Launch-out-of-carton flourish. */
  playLaunch(): void {
    this.tone({ freq: 440, freqEnd: 880, type: "triangle", dur: 0.14, gain: 0.14 });
  }

  /** Warm three-note ascending major arpeggio. Same for all powerups. */
  playPowerup(): void {
    // C5, E5, G5
    this.tone({ freq: 523.25, type: "sine", dur: 0.18, gain: 0.14, attack: 0.02, delay: 0.00 });
    this.tone({ freq: 659.25, type: "sine", dur: 0.18, gain: 0.14, attack: 0.02, delay: 0.09 });
    this.tone({ freq: 783.99, type: "sine", dur: 0.28, gain: 0.16, attack: 0.02, delay: 0.18 });
  }

  /** Very quiet whoosh when an obstacle passes the egg. */
  playObstaclePass(): void {
    this.noise({ dur: 0.14, gain: 0.035, filter: "bandpass", freq: 1600, q: 3.5, attack: 0.008 });
  }

  /** Shield absorbs a hit — bright ping. */
  playShieldBlock(): void {
    this.tone({ freq: 880, freqEnd: 1320, type: "triangle", dur: 0.18, gain: 0.15 });
  }

  /** Shell cracks (first hit in easy mode). */
  playCrack(): void {
    this.noise({ dur: 0.12, gain: 0.16, filter: "highpass", freq: 1800, q: 0.7 });
    this.tone({ freq: 260, freqEnd: 120, type: "square", dur: 0.14, gain: 0.06 });
  }

  /** Sparkly two-note hatch chime. */
  playHatch(): void {
    this.tone({ freq: 659.25, type: "triangle", dur: 0.22, gain: 0.14, attack: 0.01 });
    this.tone({ freq: 987.77, type: "triangle", dur: 0.32, gain: 0.16, attack: 0.01, delay: 0.14 });
    this.tone({ freq: 1318.5, type: "sine", dur: 0.4,  gain: 0.10, attack: 0.02, delay: 0.28 });
  }

  // ---------- game-over stings ----------

  /** 🍳 Fried — sharp sizzle burst. */
  playFried(): void {
    // Deep thud underneath for the dark twist
    this.tone({ freq: 130, freqEnd: 60, type: "sawtooth", dur: 0.22, gain: 0.14 });
    // High sizzling noise, fast attack + slow fade
    this.noise({ dur: 0.6, gain: 0.28, filter: "highpass", freq: 3200, q: 0.5, attack: 0.005 });
    this.noise({ dur: 0.45, gain: 0.14, filter: "bandpass", freq: 5200, q: 2, attack: 0.01, delay: 0.02 });
  }

  /** 🍲 Boiled — deep plop + bubbly noise. */
  playBoiled(): void {
    this.tone({ freq: 260, freqEnd: 70, type: "sine", dur: 0.22, gain: 0.28 });
    this.noise({ dur: 0.35, gain: 0.10, filter: "lowpass", freq: 800, q: 1, delay: 0.05 });
    // small bubble tail
    this.tone({ freq: 180, freqEnd: 120, type: "sine", dur: 0.18, gain: 0.10, delay: 0.18 });
  }

  /** 🥄 Whisked — cartoon descending sweep + low bonk. */
  playWhisked(): void {
    // Smooth exponential glide 1200Hz → 80Hz over 400ms.
    this.tone({ freq: 1200, freqEnd: 80, type: "sine", dur: 0.4, gain: 0.2, attack: 0.01 });
    // Low bonk right as the sweep bottoms out.
    this.tone({ freq: 80, type: "sine", dur: 0.1, gain: 0.28, attack: 0.003, delay: 0.4 });
  }

  /** 🍳 Flipped — comedic upward then downward pitch fwip. */
  playFlipped(): void {
    this.tone({ freq: 300, freqEnd: 1100, type: "triangle", dur: 0.11, gain: 0.16 });
    this.tone({ freq: 1100, freqEnd: 180, type: "triangle", dur: 0.16, gain: 0.16, delay: 0.11 });
  }

  /** 🍞 Toasted — bright pop + short sizzle (toaster obstacle). */
  playToasted(): void {
    this.tone({ freq: 180, freqEnd: 90, type: "square", dur: 0.14, gain: 0.16 });
    this.noise({ dur: 0.28, gain: 0.14, filter: "bandpass", freq: 2400, q: 3, delay: 0.05 });
  }

  playGameOver(kind: ObstacleKind): void {
    switch (kind) {
      case "pan": return this.playFried();
      case "pot": return this.playBoiled();
      case "whisk": return this.playWhisked();
      case "spatula": return this.playFlipped();
      case "toaster": return this.playToasted();
    }
  }
}

export const audio = new AudioManager();
export type { ObstacleKind };
