// The engine synth (src/audio/synth.ts) and the offline render (src/audio/render.ts): the code the
// AudioWorklet runs, fed a parameter stream in 128-frame quanta as the worklet is.
import { describe, expect, it } from 'vitest';
import { NOISE_VOICES, silentFrame, type SoundFrame } from '../../../src/audio/params';
import { QUANTUM_FRAMES, renderStream, type TimedFrame } from '../../../src/audio/render';
import { BANG_SPACING_S, EngineSynth } from '../../../src/audio/synth';
import { onsets, peakAbs, rms } from './lib/analysis';

const FS = 48_000;
const TONES = 4;
const NOISES = NOISE_VOICES.length;
const base = silentFrame(TONES, NOISES);
const opts = { sampleRate: FS, toneCount: TONES, noiseCount: NOISES, seed: 1 };
const frame = (over: Partial<SoundFrame>): SoundFrame => ({ ...base, master: 1, ...over });
const at = (s: number, f: SoundFrame, rampS = 0.05): TimedFrame => ({
  atFrame: Math.round(s * FS),
  frame: f,
  rampFrames: Math.round(rampS * FS),
});

describe('EngineSynth', () => {
  it('is silent before any parameters, and the quantum is 128 frames', () => {
    expect(QUANTUM_FRAMES).toBe(128);
    const s = new EngineSynth(opts);
    const out = new Float32Array(128);
    s.process(out);
    expect(peakAbs(out)).toBe(0);
  });

  it('plays the same samples for the same seed and different noise for another', () => {
    const f = frame({ noiseAmp: [0.1, 0, 0, 0, 0, 0], noiseHz: [300, 1, 1, 1, 1, 1] });
    const a = renderStream([at(0, f)], 9600, opts).samples;
    const b = renderStream([at(0, f)], 9600, opts).samples;
    const c = renderStream([at(0, f)], 9600, { ...opts, seed: 2 }).samples;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('a noise voice plays at its RMS amplitude whatever its centre and Q', () => {
    for (const [hz, q] of [
      [60, 1.2],
      [400, 0.6],
      [3000, 0.35],
    ] as const) {
      const f = frame({
        noiseAmp: [0, 0, 0.05, 0, 0, 0],
        noiseHz: [1, 1, hz, 1, 1, 1],
        noiseQ: [1, 1, q, 1, 1, 1],
      });
      const y = renderStream([at(0, f)], FS * 8, opts).samples;
      expect(rms(y, FS, y.length) / 0.05).toBeGreaterThan(0.93);
      expect(rms(y, FS, y.length) / 0.05).toBeLessThan(1.07);
    }
  });

  it('a tone fades in at its pitch from silence (no sweep up from 0 Hz)', () => {
    const f = frame({ toneHz: [440, 0, 0, 0], toneAmp: [0.5, 0, 0, 0] });
    const s = new EngineSynth(opts);
    s.push(f, 4800);
    const out = new Float32Array(4800);
    s.process(out);
    // upward zero crossings in the first 0.1 s: a 440 Hz tone has 44; a sweep up from 0 Hz 22
    let zc = 0;
    for (let i = 1; i < out.length; i++) if ((out[i - 1] ?? 0) < 0 && (out[i] ?? 0) >= 0) zc++;
    expect(zc).toBeGreaterThanOrEqual(43);
  });

  it('processes any block length, in quanta, with the same result', () => {
    const f = frame({
      toneHz: [440, 880, 0, 0],
      toneAmp: [0.2, 0.1, 0, 0],
      noiseAmp: [0.02, 0, 0, 0, 0, 0],
      noiseHz: [200, 1, 1, 1, 1, 1],
    });
    const a = new EngineSynth(opts);
    const b = new EngineSynth(opts);
    a.push(f, 1000);
    b.push(f, 1000);
    const ya = new Float32Array(1000);
    a.process(ya);
    const yb = new Float32Array(1000);
    for (let o = 0; o < 1000; o += 128) {
      const n = Math.min(128, 1000 - o);
      const blk = new Float32Array(n);
      b.process(blk, n);
      yb.set(blk, o);
    }
    expect(ya).toEqual(yb);
  });

  it('the master gain scales every voice and glides', () => {
    const f = (master: number) =>
      frame({ toneHz: [440, 0, 0, 0], toneAmp: [0.2, 0, 0, 0], master });
    const y = renderStream([at(0, f(1)), at(1, f(0.25), 0.1)], 2 * FS, opts).samples;
    expect(rms(y, FS / 2, FS)).toBeCloseTo(0.2 / Math.SQRT2, 3);
    expect(rms(y, 1.2 * FS, 2 * FS)).toBeCloseTo(0.05 / Math.SQRT2, 3);
  });

  it('igniter sparks: the first on the switch-on, then one per 1/rate, none while off', () => {
    const on = frame({ ignitersOn: true, sparkRateHz: 2, sparkAmp: 0.3 });
    const off = frame({ ignitersOn: false, sparkRateHz: 2, sparkAmp: 0.3 });
    const r = renderStream(
      [at(0, off), at(0.5, on), at(1.8, off), at(3, on), at(3.2, off)],
      4 * FS,
      opts,
    );
    // on 0.5-1.8 s: sparks at 0.5, 1.0, 1.5; on 3.0-3.2: one at 3.0
    expect(r.synth.events.sparks).toBe(4);
    const hits = onsets(r.samples, 0.1, 0.01);
    expect(hits.map((i) => Math.round((i / FS) * 10) / 10)).toEqual([0.5, 1, 1.5, 3]);
  });

  it('one bang per new surge cycle, spaced, none for a count that falls (a reset)', () => {
    const f = (n: number) => frame({ surgeCycles: n, bangAmp: 0.6 });
    const r = renderStream([at(0, f(0)), at(0.2, f(3)), at(1.5, f(1)), at(2, f(2))], 3 * FS, opts);
    expect(r.synth.events.bangs).toBe(3 + 1);
    const hits = onsets(r.samples, 0.3, 0.05);
    expect(hits.length).toBe(4);
    const gaps = hits.slice(1, 3).map((h, i) => (h - (hits[i] ?? 0)) / FS);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(BANG_SPACING_S - 0.002);
    expect(peakAbs(r.samples)).toBeLessThan(0.9);
  });

  it('a non-finite parameter never reaches the output', () => {
    const bad = frame({ toneHz: [440, 0, 0, 0], toneAmp: [Number.NaN, 0, 0, 0] });
    const r = renderStream([at(0, bad)], 4800, opts);
    expect(r.samples.every((x) => Number.isFinite(x))).toBe(true);
    expect(r.synth.faults).toBeGreaterThan(0);
  });
});
