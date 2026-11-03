// Offline analysis for the engine-sound checks (PHYSICS.md 3.6): a radix-2 FFT, the Hann window,
// tone peaks with log-parabolic (Gaussian) interpolation, band powers, a Welch PSD, the analytic
// signal's instantaneous frequency and an onset counter. Test-only; nothing here plays.

export type Samples = Float32Array | Float64Array | readonly number[];

/** In-place iterative radix-2 FFT (decimation in time); n = re.length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error(`fft length ${n} not a power of 2`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const xi = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Hann-windowed power spectrum |X_k|^2 of x[offset .. offset + n), k = 0 .. n/2. */
export function powerSpectrum(x: Samples, n: number, offset = 0): Float64Array {
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[offset + i] ?? 0) * (w[i] ?? 0);
  fft(re, im);
  const p = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) p[k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
  return p;
}

export interface Peak {
  /** Interpolated peak frequency, Hz. */
  readonly freqHz: number;
  /** The tone's power: the spectrum summed over the peak bin +- `halfWidth` bins. */
  readonly power: number;
  readonly bin: number;
}

/**
 * The largest bin within +- searchHz of fHz, its frequency by log-parabolic interpolation (exact
 * for a Gaussian main lobe; a Hann lobe leaves a bias well under 0.05 bin) and its power.
 */
export function peakNear(
  p: Float64Array,
  fHz: number,
  fs: number,
  n: number,
  searchHz: number,
  halfWidth = 4,
): Peak {
  const df = fs / n;
  const lo = Math.max(1, Math.floor((fHz - searchHz) / df));
  const hi = Math.min(p.length - 2, Math.ceil((fHz + searchHz) / df));
  let k = lo;
  for (let i = lo; i <= hi; i++) if ((p[i] ?? 0) > (p[k] ?? 0)) k = i;
  const a = Math.log(Math.max(p[k - 1] ?? 0, 1e-300));
  const b = Math.log(Math.max(p[k] ?? 0, 1e-300));
  const c = Math.log(Math.max(p[k + 1] ?? 0, 1e-300));
  const den = a - 2 * b + c;
  const delta = den === 0 ? 0 : (0.5 * (a - c)) / den;
  return { freqHz: (k + delta) * df, power: bandPower(p, k * df, fs, n, halfWidth), bin: k };
}

/** The spectrum summed over the bins within +- halfWidth bins of fHz's bin. */
export function bandPower(
  p: Float64Array,
  fHz: number,
  fs: number,
  n: number,
  halfWidth: number,
): number {
  const k0 = Math.round(fHz / (fs / n));
  let s = 0;
  for (let k = Math.max(0, k0 - halfWidth); k <= Math.min(p.length - 1, k0 + halfWidth); k++)
    s += p[k] ?? 0;
  return s;
}

/** Welch's averaged Hann power spectrum (half-overlapped segments of n). */
export function welch(x: Samples, n: number, from = 0, to = x.length): Float64Array {
  const acc = new Float64Array(n / 2 + 1);
  let count = 0;
  for (let o = from; o + n <= to; o += n / 2) {
    const p = powerSpectrum(x, n, o);
    for (let k = 0; k < acc.length; k++) acc[k] = (acc[k] ?? 0) + (p[k] ?? 0);
    count++;
  }
  if (count === 0) throw new Error('welch: shorter than one segment');
  for (let k = 0; k < acc.length; k++) acc[k] = (acc[k] ?? 0) / count;
  return acc;
}

/**
 * The frequency of a Welch PSD's peak, read from bands of 1/`perOctave` octave between loHz and
 * hiHz (the mean PSD per band, so a broad noise peak is located without the bin-to-bin scatter).
 */
export function smoothedPeakHz(
  psd: Float64Array,
  fs: number,
  n: number,
  loHz: number,
  hiHz: number,
  perOctave = 12,
): number {
  const df = fs / n;
  let best = loHz;
  let bestMean = -1;
  for (let f = loHz; f <= hiHz; f *= 2 ** (1 / perOctave)) {
    const a = Math.max(1, Math.round((f * 2 ** (-0.5 / perOctave)) / df));
    const b = Math.min(psd.length - 1, Math.round((f * 2 ** (0.5 / perOctave)) / df));
    let s = 0;
    for (let k = a; k <= b; k++) s += psd[k] ?? 0;
    const mean = s / (b - a + 1);
    if (mean > bestMean) {
      bestMean = mean;
      best = f;
    }
  }
  return best;
}

/** Instantaneous frequency (Hz) per sample from the analytic signal (FFT Hilbert transform). */
export function instantaneousFrequency(x: Samples, fs: number): Float64Array {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] ?? 0;
  fft(re, im);
  // analytic signal: keep DC and Nyquist, double the positive frequencies, drop the negative
  for (let k = 1; k < n / 2; k++) {
    re[k] = 2 * (re[k] ?? 0);
    im[k] = 2 * (im[k] ?? 0);
  }
  for (let k = n / 2 + 1; k < n; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  fft(re, im, true);
  const f = new Float64Array(x.length);
  for (let i = 1; i < x.length; i++) {
    // the phase advance from i-1 to i: arg(z_i conj(z_{i-1}))
    const ar = (re[i] ?? 0) * (re[i - 1] ?? 0) + (im[i] ?? 0) * (im[i - 1] ?? 0);
    const ai = (im[i] ?? 0) * (re[i - 1] ?? 0) - (re[i] ?? 0) * (im[i - 1] ?? 0);
    f[i] = (Math.atan2(ai, ar) * fs) / (2 * Math.PI);
  }
  f[0] = f[1] ?? 0;
  return f;
}

export function rms(x: Samples, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += (x[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
}

export function peakAbs(x: Samples, from = 0, to = x.length): number {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i] ?? 0));
  return m;
}

/**
 * Sample indices where the block peak (blocks of `block` samples) rises through `on` after it
 * has been below `off`: one per event when events are spaced wider than their decay to `off`.
 */
export function onsets(x: Samples, on: number, off: number, block = 48): number[] {
  const out: number[] = [];
  let armed = true;
  for (let o = 0; o < x.length; o += block) {
    const m = peakAbs(x, o, Math.min(x.length, o + block));
    if (armed && m >= on) {
      out.push(o);
      armed = false;
    } else if (!armed && m < off) armed = true;
  }
  return out;
}

export const db = (ratio: number): number => 10 * Math.log10(ratio);
