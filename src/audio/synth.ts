// The engine synth: what the AudioWorklet runs (src/audio/worklet/processor.ts) and what the Node
// checks render (src/audio/render.ts). It plays a stream of SoundFrames: each push glides every
// tone, noise band and the master gain to the frame's values over the given frames (the interval
// to the next posting), so the 20 Hz parameter stream never steps the sound (A1). Events are gated
// by the frame: sparks while the igniters are on (the first at the switch-on, then one per
// 1 / rate), a bang per new surge cycle (A5). Everything ends in the -1 dBFS limiter (A6).

import {
  Biquad,
  Limiter,
  Noise,
  OscillatorBank,
  Ramp,
  bandpass,
  bandpassNoiseGain,
  flushDenormal,
  highpass,
  lowpass,
} from './dsp';
import type { SoundFrame } from './params';

/** The Web Audio render quantum, frames. */
export const QUANTUM_FRAMES = 128;
/** Bangs that arrive together are played at least this far apart (each one countable). */
export const BANG_SPACING_S = 0.09;
const SPARK_DECAY_S = 0.0015;
const BANG_THUMP_DECAY_S = 0.022;
const BANG_NOISE_DECAY_S = 0.015;
const BANG_GLIDE_S = 0.04;
/** An envelope under this is over. */
const ENVELOPE_END = 1e-6;

export interface SynthOptions {
  readonly sampleRate: number;
  readonly toneCount: number;
  readonly noiseCount: number;
  readonly seed?: number;
}

export class EngineSynth {
  readonly events = { sparks: 0, bangs: 0 };
  private readonly fs: number;
  private readonly bank: OscillatorBank;
  private readonly noise: Noise[] = [];
  private readonly filters: Biquad[] = [];
  private readonly noiseAmp: Ramp[] = [];
  private readonly noiseHz: Ramp[] = [];
  private readonly noiseQ: Ramp[] = [];
  private readonly master = new Ramp(0);
  private readonly limiter: Limiter;
  private readonly scratch = new Float64Array(QUANTUM_FRAMES);
  private badParams = 0;
  // igniters
  private ignitersOn = false;
  private sparkRate = 0;
  private sparkAmp = 0;
  private sparkPhase = 0;
  private sparkEnv = 0;
  private readonly sparkDecay: number;
  private readonly sparkNoise: Noise;
  private readonly sparkFilter: Biquad;
  // surge
  private cycles: number | null = null;
  private pendingBangs = 0;
  private bangCooldown = 0;
  private bangAmp = 0;
  private thumpEnv = 0;
  private burstEnv = 0;
  private thumpPhase = 0;
  private thumpHz = 0;
  private readonly thumpDecay: number;
  private readonly burstDecay: number;
  private readonly glide: number;
  private readonly bangNoise: Noise;
  private readonly bangFilter: Biquad;

  constructor(o: SynthOptions) {
    this.fs = o.sampleRate;
    const seed = o.seed ?? 1;
    this.bank = new OscillatorBank(o.toneCount, o.sampleRate);
    for (let i = 0; i < o.noiseCount; i++) {
      this.noise.push(new Noise(seed * 977 + i * 7919 + 1));
      this.filters.push(new Biquad());
      this.noiseAmp.push(new Ramp(0));
      this.noiseHz.push(new Ramp(100));
      this.noiseQ.push(new Ramp(1));
    }
    this.limiter = new Limiter(o.sampleRate);
    this.sparkDecay = Math.exp(-1 / (SPARK_DECAY_S * o.sampleRate));
    this.sparkNoise = new Noise(seed * 31 + 5);
    this.sparkFilter = new Biquad(highpass(2500, Math.SQRT1_2, o.sampleRate));
    this.thumpDecay = Math.exp(-1 / (BANG_THUMP_DECAY_S * o.sampleRate));
    this.burstDecay = Math.exp(-1 / (BANG_NOISE_DECAY_S * o.sampleRate));
    this.glide = Math.exp(-1 / (BANG_GLIDE_S * o.sampleRate));
    this.bangNoise = new Noise(seed * 131 + 9);
    this.bangFilter = new Biquad(lowpass(900, Math.SQRT1_2, o.sampleRate));
  }

  /** Non-finite outputs the limiter caught, plus non-finite or negative parameters refused. */
  get faults(): number {
    return this.limiter.faults + this.badParams;
  }

  private num(x: number | undefined): number {
    if (x !== undefined && Number.isFinite(x) && x >= 0) return x;
    this.badParams++;
    return 0;
  }

  /** Glide to a frame over `rampFrames` frames (the interval to the next posting). */
  push(f: SoundFrame, rampFrames: number): void {
    for (let i = 0; i < this.bank.size; i++)
      this.bank.setTarget(i, this.num(f.toneHz[i]), this.num(f.toneAmp[i]), rampFrames);
    for (let i = 0; i < this.noise.length; i++) {
      const amp = this.noiseAmp[i];
      const hz = this.noiseHz[i];
      const q = this.noiseQ[i];
      if (amp === undefined || hz === undefined || q === undefined) continue;
      // a silent band takes its new centre at once (it fades in there)
      const glide = amp.value === 0 && amp.done ? 0 : rampFrames;
      hz.set(Math.max(1, this.num(f.noiseHz[i])), glide);
      q.set(Math.max(0.05, this.num(f.noiseQ[i])), glide);
      amp.set(this.num(f.noiseAmp[i]), rampFrames);
    }
    this.master.set(this.num(f.master), rampFrames);
    if (f.ignitersOn && !this.ignitersOn) this.sparkPhase = 1;
    this.ignitersOn = f.ignitersOn;
    this.sparkRate = this.num(f.sparkRateHz);
    this.sparkAmp = this.num(f.sparkAmp);
    const n = Math.floor(this.num(f.surgeCycles));
    // the first frame sets the count (no bangs for surges before the sound was on); a count
    // that falls is a reset
    if (this.cycles !== null && n > this.cycles) this.pendingBangs += n - this.cycles;
    this.cycles = n;
    this.bangAmp = this.num(f.bangAmp);
  }

  /** Renders n frames (default out.length) into out. */
  process(out: Float32Array, n = out.length): void {
    for (let o = 0; o < n; o += QUANTUM_FRAMES)
      this.quantum(out, o, Math.min(QUANTUM_FRAMES, n - o));
  }

  private quantum(out: Float32Array, offset: number, m: number): void {
    const s = this.scratch;
    s.fill(0, 0, m);
    this.bank.render(s, m);
    for (let v = 0; v < this.noise.length; v++) {
      const amp = this.noiseAmp[v];
      const hz = this.noiseHz[v];
      const q = this.noiseQ[v];
      const bq = this.filters[v];
      const src = this.noise[v];
      if (
        amp === undefined ||
        hz === undefined ||
        q === undefined ||
        bq === undefined ||
        src === undefined
      )
        continue;
      if (amp.value === 0 && amp.done) {
        hz.advance(m);
        q.advance(m);
        continue;
      }
      // the band's coefficients once a quantum; its gain makes the band's RMS its amplitude
      const f0 = Math.min(hz.value, 0.45 * this.fs);
      bq.set(bandpass(f0, q.value, this.fs));
      const g = 1 / Math.sqrt(bandpassNoiseGain(f0, q.value, this.fs));
      hz.advance(m);
      q.advance(m);
      for (let i = 0; i < m; i++) s[i] = (s[i] ?? 0) + amp.next() * g * bq.process(src.white());
    }
    const fs = this.fs;
    for (let i = 0; i < m; i++) {
      let y = (s[i] ?? 0) * this.master.next();
      // igniters: a spark each time the phase passes 1 while they are on
      if (this.ignitersOn && this.sparkRate > 0) {
        if (this.sparkPhase >= 1) {
          this.sparkPhase -= 1;
          this.sparkEnv = this.sparkAmp;
          this.events.sparks++;
        }
        this.sparkPhase += this.sparkRate / fs;
      }
      if (this.sparkEnv > ENVELOPE_END) {
        y += this.sparkEnv * this.sparkFilter.process(this.sparkNoise.white());
        this.sparkEnv *= this.sparkDecay;
      } else this.sparkEnv = 0;
      // surge: the pending bangs, spaced
      if (this.bangCooldown > 0) this.bangCooldown--;
      else if (this.pendingBangs > 0) {
        this.pendingBangs--;
        this.events.bangs++;
        this.thumpEnv = this.bangAmp;
        this.burstEnv = 0.5 * this.bangAmp;
        this.thumpPhase = 0;
        this.thumpHz = 55;
        this.bangCooldown = Math.round(BANG_SPACING_S * fs);
      }
      if (this.thumpEnv > ENVELOPE_END) {
        y +=
          this.thumpEnv * Math.sin(2 * Math.PI * this.thumpPhase) +
          this.burstEnv * this.bangFilter.process(this.bangNoise.white());
        this.thumpPhase += this.thumpHz / fs;
        if (this.thumpPhase >= 1) this.thumpPhase -= 1;
        this.thumpHz = 30 + (this.thumpHz - 30) * this.glide;
        this.thumpEnv *= this.thumpDecay;
        this.burstEnv *= this.burstDecay;
      } else this.thumpEnv = 0;
      out[offset + i] = flushDenormal(this.limiter.process(y));
    }
  }
}
