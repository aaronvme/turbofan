// The engine synth's DSP building blocks, shared by the AudioWorklet and the offline Node render
// (PHYSICS.md 3.6: the checks render the worklet's own code). Pure, allocation-free per sample,
// deterministic (seeded noise, no clock).
//
// - Noise: xorshift32 (G. Marsaglia, "Xorshift RNGs", J. Stat. Software 8(14), 2003).
// - Biquads: R. Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter coefficients"
//   (the W3C Audio EQ Cookbook), in transposed direct form II, states flushed below 1e-30 so a
//   decaying filter never runs on denormals (A6).
// - The oscillator bank: additive sines (band-limited by construction), phase accumulators that
//   carry through every frequency change (phase continuous), each partial faded out between 0.40
//   and 0.45 of the sample rate so none plays above 0.45 f_s (A1: no aliasing).
// - The limiter: instant attack, exponential release, a ceiling under -1 dBFS (A6).

/** Below this a filter state or an output sample is flushed to zero (no denormals, A6). */
export const DENORMAL_FLOOR = 1e-30;

export function flushDenormal(x: number): number {
  return x > -DENORMAL_FLOOR && x < DENORMAL_FLOOR ? 0 : x;
}

export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(g);

/** Seeded white noise (xorshift32). */
export class Noise {
  private s: number;
  constructor(seed: number) {
    // 0 is xorshift's fixed point
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [-1, 1). */
  uniform(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 2 ** 31 - 1;
  }
  /** Zero-mean, unit-variance white noise (uniform, scaled by sqrt 3). */
  white(): number {
    return this.uniform() * Math.sqrt(3);
  }
}

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

function rbj(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): BiquadCoefficients {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** RBJ band-pass with a constant 0 dB peak gain at fHz. */
export function bandpass(fHz: number, q: number, fs: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * fHz) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  return rbj(alpha, 0, -alpha, 1 + alpha, -2 * Math.cos(w0), 1 - alpha);
}

export function lowpass(fHz: number, q: number, fs: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * fHz) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return rbj((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

export function highpass(fHz: number, q: number, fs: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * fHz) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return rbj((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

/** |H(e^{j 2 pi f / fs})|. */
export function biquadResponse(c: BiquadCoefficients, fHz: number, fs: number): number {
  const w = (2 * Math.PI * fHz) / fs;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
  const ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = 1 + c.a1 * c1 + c.a2 * c2;
  const di = -(c.a1 * s1 + c.a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/**
 * The white-noise power gain sum(h_n^2) of a biquad, exactly: b0^2 + P11 for the transposed
 * direct form's state covariance P, which solves the discrete Lyapunov equation P = A P A' + B B'
 * (A = [[-a1, 1], [-a2, 0]], B = [b1 - a1 b0, b2 - a2 b0]); solved here in closed form.
 */
export function biquadNoiseGain(c: BiquadCoefficients): number {
  const B1 = c.b1 - c.a1 * c.b0;
  const B2 = c.b2 - c.a2 * c.b0;
  const k = 1 + c.a2;
  const num = B1 * B1 + B2 * B2 - (2 * c.a1 * B1 * B2) / k;
  const den = 1 - c.a1 * c.a1 - c.a2 * c.a2 + (2 * c.a1 * c.a1 * c.a2) / k;
  return c.b0 * c.b0 + num / den;
}

export function bandpassNoiseGain(fHz: number, q: number, fs: number): number {
  return biquadNoiseGain(bandpass(fHz, q, fs));
}

/** A biquad in transposed direct form II. */
export class Biquad {
  private c: BiquadCoefficients;
  private s1 = 0;
  private s2 = 0;
  constructor(c: BiquadCoefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }) {
    this.c = c;
  }
  /** New coefficients; the state carries over (a glide, not a restart). */
  set(c: BiquadCoefficients): void {
    this.c = c;
  }
  reset(): void {
    this.s1 = 0;
    this.s2 = 0;
  }
  process(x: number): number {
    const c = this.c;
    const y = c.b0 * x + this.s1;
    this.s1 = flushDenormal(c.b1 * x - c.a1 * y + this.s2);
    this.s2 = flushDenormal(c.b2 * x - c.a2 * y);
    return y;
  }
}

/** A value that moves linearly to its target over a number of frames. */
export class Ramp {
  value: number;
  private target: number;
  private step = 0;
  private remaining = 0;
  constructor(value = 0) {
    this.value = value;
    this.target = value;
  }
  get done(): boolean {
    return this.remaining === 0;
  }
  /** Go to target over `frames` frames from the current value (0: at once). */
  set(target: number, frames: number): void {
    this.target = target;
    if (frames <= 0) {
      this.value = target;
      this.remaining = 0;
      return;
    }
    this.remaining = Math.round(frames);
    this.step = (target - this.value) / this.remaining;
  }
  jump(value: number): void {
    this.set(value, 0);
  }
  next(): number {
    if (this.remaining > 0) {
      this.remaining--;
      this.value = this.remaining === 0 ? this.target : this.value + this.step;
    }
    return this.value;
  }
  /** `frames` steps at once (a once-per-quantum parameter). */
  advance(frames: number): number {
    const m = Math.min(this.remaining, Math.max(0, Math.round(frames)));
    this.remaining -= m;
    this.value = this.remaining === 0 ? this.target : this.value + this.step * m;
    return this.value;
  }
}

/** A partial's gain is 1 up to this fraction of the sample rate ... */
export const BAND_LIMIT_START = 0.4;
/** ... and 0 from this one (A1: no partial above 0.45 f_s). */
export const BAND_LIMIT_END = 0.45;

export function bandLimitGain(fHz: number, fs: number): number {
  const r = fHz / fs;
  if (r <= 0 || r >= BAND_LIMIT_END) return 0;
  if (r <= BAND_LIMIT_START) return 1;
  return (BAND_LIMIT_END - r) / (BAND_LIMIT_END - BAND_LIMIT_START);
}

/**
 * Additive sine partials with per-sample linear frequency and amplitude glides. The phase is in
 * cycles and carries over every change, so a glide never steps the waveform.
 */
export class OscillatorBank {
  readonly size: number;
  private readonly fs: number;
  private readonly phase: Float64Array;
  private readonly f: Float64Array;
  private readonly fStep: Float64Array;
  private readonly fTarget: Float64Array;
  private readonly fLeft: Int32Array;
  private readonly a: Float64Array;
  private readonly aStep: Float64Array;
  private readonly aTarget: Float64Array;
  private readonly aLeft: Int32Array;

  constructor(size: number, sampleRate: number) {
    this.size = size;
    this.fs = sampleRate;
    this.phase = new Float64Array(size);
    this.f = new Float64Array(size);
    this.fStep = new Float64Array(size);
    this.fTarget = new Float64Array(size);
    this.fLeft = new Int32Array(size);
    this.a = new Float64Array(size);
    this.aStep = new Float64Array(size);
    this.aTarget = new Float64Array(size);
    this.aLeft = new Int32Array(size);
  }

  frequency(i: number): number {
    return this.f[i] ?? 0;
  }
  amplitude(i: number): number {
    return this.a[i] ?? 0;
  }

  /** Glide partial i to freqHz and amp over `frames` frames (0: at once). */
  setTarget(i: number, freqHz: number, amp: number, frames: number): void {
    const n = Math.max(0, Math.round(frames));
    const f = Math.max(0, freqHz);
    // a silent partial takes its new pitch at once: it fades in at it, never sweeping up from 0 Hz
    const silent = (this.a[i] ?? 0) === 0 && (this.aLeft[i] ?? 0) === 0;
    this.fTarget[i] = f;
    this.aTarget[i] = amp;
    if (n === 0 || silent) {
      this.f[i] = f;
      this.fLeft[i] = 0;
    } else {
      this.fLeft[i] = n;
      this.fStep[i] = (f - (this.f[i] ?? 0)) / n;
    }
    if (n === 0) {
      this.a[i] = amp;
      this.aLeft[i] = 0;
    } else {
      this.aLeft[i] = n;
      this.aStep[i] = (amp - (this.a[i] ?? 0)) / n;
    }
  }

  /** Adds `frames` samples of every partial into out[0 .. frames). */
  render(out: Float64Array, frames: number): void {
    const fs = this.fs;
    const lo = BAND_LIMIT_START * fs;
    const hi = BAND_LIMIT_END * fs;
    const TWO_PI = 2 * Math.PI;
    for (let v = 0; v < this.size; v++) {
      let ph = this.phase[v] ?? 0;
      let f = this.f[v] ?? 0;
      let a = this.a[v] ?? 0;
      let fLeft = this.fLeft[v] ?? 0;
      let aLeft = this.aLeft[v] ?? 0;
      const fStep = this.fStep[v] ?? 0;
      const aStep = this.aStep[v] ?? 0;
      if (a === 0 && aLeft === 0) {
        // silent and staying so: only the phase moves (closed form over the glide)
        const m = Math.min(frames, fLeft);
        ph += (m * f + (fStep * m * (m + 1)) / 2) / fs;
        f = m === fLeft && m > 0 ? (this.fTarget[v] ?? 0) : f + fStep * m;
        fLeft -= m;
        ph += (f * (frames - m)) / fs;
        ph -= Math.floor(ph);
      } else {
        const fTarget = this.fTarget[v] ?? 0;
        const aTarget = this.aTarget[v] ?? 0;
        for (let i = 0; i < frames; i++) {
          if (fLeft > 0) f = --fLeft === 0 ? fTarget : f + fStep;
          if (aLeft > 0) a = --aLeft === 0 ? aTarget : a + aStep;
          const g = f <= 0 || f >= hi ? 0 : f <= lo ? 1 : (hi - f) / (hi - lo);
          if (g > 0) out[i] = (out[i] ?? 0) + a * g * Math.sin(TWO_PI * ph);
          ph += f / fs;
          if (ph >= 1) ph -= 1;
        }
      }
      this.phase[v] = ph;
      this.f[v] = f;
      this.a[v] = a;
      this.fLeft[v] = fLeft;
      this.aLeft[v] = aLeft;
    }
  }
}

/** The final limiter's ceiling: under A6's -1 dBFS with room for the float32 output's rounding. */
export const LIMITER_CEILING_DB = -1.05;

/** Peak limiter: instant attack (so no sample passes the ceiling), exponential release. */
export class Limiter {
  gain = 1;
  /** Non-finite inputs seen (each played as silence). */
  faults = 0;
  private readonly ceiling: number;
  private readonly release: number;
  constructor(sampleRate: number, ceiling = dbToGain(LIMITER_CEILING_DB), releaseS = 0.1) {
    this.ceiling = ceiling;
    this.release = Math.exp(-1 / (releaseS * sampleRate));
  }
  process(x: number): number {
    if (!Number.isFinite(x)) {
      this.faults++;
      return 0;
    }
    const a = Math.abs(x);
    const target = a > this.ceiling ? this.ceiling / a : 1;
    this.gain = target < this.gain ? target : target + (this.gain - target) * this.release;
    const y = x * this.gain;
    return flushDenormal(Math.max(-this.ceiling, Math.min(this.ceiling, y)));
  }
}
