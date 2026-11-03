// The engine synth's DSP building blocks (src/audio/dsp.ts): seeded noise, RBJ biquads and their
// noise gain, linear parameter ramps, the band-limited phase-continuous oscillator bank and the
// final limiter. Also checks the test-side analysis (FFT, peak interpolation) the A-rows use.
import { describe, expect, it } from 'vitest';
import {
  BAND_LIMIT_END,
  BAND_LIMIT_START,
  Biquad,
  LIMITER_CEILING_DB,
  Limiter,
  Noise,
  OscillatorBank,
  Ramp,
  bandLimitGain,
  bandpass,
  bandpassNoiseGain,
  biquadResponse,
  dbToGain,
  flushDenormal,
  gainToDb,
  highpass,
  lowpass,
} from '../../../src/audio/dsp';
import { fft, instantaneousFrequency, peakNear, powerSpectrum, rms } from './lib/analysis';

const FS = 48_000;

describe('the analysis helpers', () => {
  it('fft matches a direct DFT', () => {
    const n = 64;
    const x = Array.from({ length: n }, (_, i) => Math.sin(0.3 * i) + 0.2 * Math.cos(1.7 * i * i));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (const k of [0, 1, 5, 31, 32, 63]) {
      let dr = 0;
      let di = 0;
      for (let i = 0; i < n; i++) {
        dr += (x[i] ?? 0) * Math.cos((-2 * Math.PI * k * i) / n);
        di += (x[i] ?? 0) * Math.sin((-2 * Math.PI * k * i) / n);
      }
      expect(re[k]).toBeCloseTo(dr, 9);
      expect(im[k]).toBeCloseTo(di, 9);
    }
  });

  it('locates a pure tone within 0.02 % from a 2^16 Hann spectrum', () => {
    for (const f of [41.3, 103.7, 1234.5, 9876.1]) {
      const n = 1 << 16;
      const x = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / FS));
      const pk = peakNear(powerSpectrum(x, n), f, FS, n, 20);
      expect(Math.abs(pk.freqHz / f - 1)).toBeLessThan(2e-4);
    }
  });

  it('reads the instantaneous frequency of a chirp', () => {
    const n = 48_000;
    const x = new Float64Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      x[i] = Math.sin(ph);
      ph += (2 * Math.PI * (200 + (800 * i) / n)) / FS;
    }
    const f = instantaneousFrequency(x, FS);
    for (const i of [5000, 24_000, 40_000])
      expect(f[i] ?? 0).toBeCloseTo(200 + (800 * (i - 0.5)) / n, 1);
  });
});

describe('Noise (xorshift32)', () => {
  it('is deterministic per seed, uniform in [-1, 1), and white() has unit variance', () => {
    const a = new Noise(7);
    const b = new Noise(7);
    const c = new Noise(8);
    const xs: number[] = [];
    let differs = false;
    for (let i = 0; i < 100_000; i++) {
      const u = a.uniform();
      expect(u).toBe(b.uniform());
      if (u !== c.uniform()) differs = true;
      expect(u).toBeGreaterThanOrEqual(-1);
      expect(u).toBeLessThan(1);
      xs.push(u);
    }
    expect(differs).toBe(true);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    const w = new Noise(3);
    let s2 = 0;
    for (let i = 0; i < 200_000; i++) s2 += w.white() ** 2;
    expect(s2 / 200_000).toBeCloseTo(1, 1);
    // seed 0 is a fixed point of xorshift: it is remapped
    const z = new Noise(0);
    expect(z.uniform()).not.toBe(z.uniform());
  });
});

describe('biquads (RBJ Audio EQ Cookbook)', () => {
  it('the band-pass has unit gain at its centre and falls away on both sides', () => {
    for (const [f0, q] of [
      [60, 1.2],
      [400, 0.6],
      [3000, 1],
    ] as const) {
      const c = bandpass(f0, q, FS);
      expect(biquadResponse(c, f0, FS)).toBeCloseTo(1, 9);
      expect(biquadResponse(c, f0 / 8, FS)).toBeLessThan(0.3);
      expect(biquadResponse(c, f0 * 8, FS)).toBeLessThan(0.3);
    }
  });

  it('low- and high-pass have unit pass-band gain', () => {
    expect(biquadResponse(lowpass(1000, Math.SQRT1_2, FS), 1, FS)).toBeCloseTo(1, 6);
    expect(biquadResponse(lowpass(1000, Math.SQRT1_2, FS), 20_000, FS)).toBeLessThan(0.01);
    expect(biquadResponse(highpass(1000, Math.SQRT1_2, FS), 23_999, FS)).toBeCloseTo(1, 3);
    expect(biquadResponse(highpass(1000, Math.SQRT1_2, FS), 20, FS)).toBeLessThan(0.001);
  });

  it("bandpassNoiseGain is the filter's white-noise power gain (within 4 %)", () => {
    for (const [f0, q] of [
      [50, 1.2],
      [200, 0.6],
      [2000, 1.2],
    ] as const) {
      const bq = new Biquad(bandpass(f0, q, FS));
      const n = new Noise(11);
      let pin = 0;
      let pout = 0;
      const N = 1 << 20;
      for (let i = 0; i < N; i++) {
        const x = n.white();
        const y = bq.process(x);
        if (i > 48_000) {
          pin += x * x;
          pout += y * y;
        }
      }
      expect(pout / pin / bandpassNoiseGain(f0, q, FS)).toBeCloseTo(1, 1);
      expect(Math.abs(pout / pin / bandpassNoiseGain(f0, q, FS) - 1)).toBeLessThan(0.04);
    }
  });

  it('a filter left without input decays to exact zero (no denormals)', () => {
    const bq = new Biquad(bandpass(100, 5, FS));
    bq.process(1);
    let y = 1;
    for (let i = 0; i < 2_000_000; i++) y = bq.process(0);
    expect(y).toBe(0);
    expect(flushDenormal(1e-35)).toBe(0);
    expect(flushDenormal(-1e-35)).toBe(0);
    expect(flushDenormal(1e-20)).toBe(1e-20);
    bq.reset();
    expect(bq.process(0)).toBe(0);
  });
});

describe('Ramp', () => {
  it('goes linearly to its target in the frames given, and retargets from where it is', () => {
    const r = new Ramp(0);
    r.set(1, 4);
    expect([r.next(), r.next(), r.next(), r.next(), r.next()]).toEqual([0.25, 0.5, 0.75, 1, 1]);
    expect(r.done).toBe(true);
    r.set(0, 2);
    expect(r.next()).toBe(0.5);
    r.set(1, 1);
    expect(r.next()).toBe(1);
    r.set(3, 0);
    expect(r.value).toBe(3);
    expect(r.next()).toBe(3);
    r.jump(5);
    expect(r.value).toBe(5);
    expect(r.done).toBe(true);
  });
});

describe('band limit', () => {
  it('passes below 0.40 fs, mutes from 0.45 fs, linear between', () => {
    expect(BAND_LIMIT_START).toBe(0.4);
    expect(BAND_LIMIT_END).toBe(0.45);
    expect(bandLimitGain(0.3 * FS, FS)).toBe(1);
    expect(bandLimitGain(0.4 * FS, FS)).toBe(1);
    expect(bandLimitGain(0.425 * FS, FS)).toBeCloseTo(0.5, 12);
    expect(bandLimitGain(0.45 * FS, FS)).toBe(0);
    expect(bandLimitGain(0.6 * FS, FS)).toBe(0);
    expect(bandLimitGain(-5, FS)).toBe(0);
  });
});

describe('OscillatorBank', () => {
  it('plays a sine of the asked frequency and amplitude, added into the buffer', () => {
    const bank = new OscillatorBank(2, FS);
    expect(bank.size).toBe(2);
    bank.setTarget(0, 1000, 0.5, 0);
    const out = new Float64Array(4800).fill(0.25);
    bank.render(out, out.length);
    for (let i = 0; i < out.length; i += 97)
      expect(out[i]).toBeCloseTo(0.25 + 0.5 * Math.sin((2 * Math.PI * 1000 * i) / FS), 9);
    expect(bank.frequency(0)).toBe(1000);
    expect(bank.amplitude(0)).toBe(0.5);
    expect(bank.frequency(1)).toBe(0);
  });

  it('is phase continuous through a frequency glide (no sample-to-sample jump)', () => {
    const bank = new OscillatorBank(1, FS);
    bank.setTarget(0, 300, 1, 0);
    const out = new Float64Array(9600);
    bank.render(out, 4800);
    bank.setTarget(0, 3000, 1, 2400);
    const tail = new Float64Array(4800);
    bank.render(tail, 4800);
    const all = [...out.subarray(0, 4800), ...tail];
    let maxStep = 0;
    for (let i = 1; i < all.length; i++)
      maxStep = Math.max(maxStep, Math.abs((all[i] ?? 0) - (all[i - 1] ?? 0)));
    // a unit sine at f moves at most 2 pi f / fs per sample
    expect(maxStep).toBeLessThanOrEqual((2 * Math.PI * 3000) / FS + 1e-9);
    expect(bank.frequency(0)).toBe(3000);
  });

  it('never plays a partial at or above 0.45 fs, and fades one between 0.40 and 0.45 fs', () => {
    const bank = new OscillatorBank(3, FS);
    bank.setTarget(0, 0.46 * FS, 1, 0);
    bank.setTarget(1, 0.5 * FS, 1, 0);
    bank.setTarget(2, 0.6 * FS, 1, 0);
    const out = new Float64Array(4096);
    bank.render(out, out.length);
    expect(rms(out)).toBe(0);
    const fade = new OscillatorBank(1, FS);
    fade.setTarget(0, 0.425 * FS, 1, 0);
    const y = new Float64Array(1 << 15);
    fade.render(y, y.length);
    expect(rms(y)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('a silent voice keeps its phase moving and costs nothing to play', () => {
    const bank = new OscillatorBank(1, FS);
    bank.setTarget(0, 1000, 0, 0);
    const out = new Float64Array(128);
    bank.render(out, 128);
    expect(rms(out)).toBe(0);
    bank.setTarget(0, 1000, 1, 0);
    bank.render(out, 1);
    // 128 samples of 1 kHz advanced the phase by 128 * 1000 / 48000 cycles
    expect(out[0]).toBeCloseTo(Math.sin((2 * Math.PI * 1000 * 128) / FS), 9);
  });
});

describe('Limiter', () => {
  const ceiling = dbToGain(LIMITER_CEILING_DB);

  it('its ceiling is under -1 dBFS (A6), with float32 headroom', () => {
    expect(LIMITER_CEILING_DB).toBeLessThan(-1);
    expect(gainToDb(Math.fround(ceiling))).toBeLessThanOrEqual(-1);
  });

  it('holds a loud signal at or under its ceiling, passes a quiet one unchanged', () => {
    const lim = new Limiter(FS);
    let peak = 0;
    for (let i = 0; i < 48_000; i++)
      peak = Math.max(peak, Math.abs(lim.process(4 * Math.sin((2 * Math.PI * 50 * i) / FS))));
    expect(peak).toBeLessThanOrEqual(ceiling);
    expect(peak).toBeGreaterThan(0.95 * ceiling);
    const quiet = new Limiter(FS);
    for (let i = 0; i < 1000; i++) {
      const x = 0.1 * Math.sin(i);
      expect(quiet.process(x)).toBe(x);
    }
    expect(quiet.gain).toBe(1);
  });

  it('recovers with its release time and maps a non-finite input to silence', () => {
    const lim = new Limiter(FS, ceiling, 0.1);
    lim.process(10);
    expect(lim.gain).toBeCloseTo(ceiling / 10, 12);
    for (let i = 0; i < 4800; i++) lim.process(0);
    // after one release time constant the gain has closed 63 % of its gap to 1
    expect(lim.gain).toBeCloseTo(1 - (1 - ceiling / 10) * Math.exp(-1), 3);
    expect(lim.process(Number.NaN)).toBe(0);
    expect(lim.process(Number.POSITIVE_INFINITY)).toBe(0);
    expect(lim.faults).toBe(2);
  });
});
