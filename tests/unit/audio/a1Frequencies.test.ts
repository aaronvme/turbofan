// A1 (PHYSICS.md 3.6, D5-4): the tone frequencies. Every voiced tone (the fan's blade-pass tone
// and harmonics at the published 24 blades, the buzz-saw engine orders, the booster, HPC and LPT
// rotor tones at the definition's estimated counts, the starter) is rendered alone at 48 kHz by the
// worklet's own synth and its peak read from a 2^16-point Hann FFT with log-parabolic
// interpolation; a 1 s N1 ramp posted at the snapshot rate is checked for steps at the 128-frame
// quantum boundaries; no partial plays above 0.45 f_s.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import {
  NOISE_VOICES,
  toneFrequencyHz,
  toneVoices,
  type SoundFrame,
} from '../../../src/audio/params';
import { QUANTUM_FRAMES, renderStream } from '../../../src/audio/render';
import { createSoundModel, engineSoundFrame } from '../../../src/audio/sources';
import { instantaneousFrequency, peakNear, powerSpectrum } from './lib/analysis';
import { AMBIENT, DEF, groundIdle, withSpeeds } from './lib/states';

const A1 = THRESHOLDS.A1.values;
const FS = 48_000;
const N = 1 << 16;
const model = createSoundModel(DEF);
const tones = toneVoices(DEF);
const idle = groundIdle();

/** The frame of a state with only tone i playing, at a fixed level (frequency checks only). */
function solo(f: SoundFrame, i: number): SoundFrame {
  return {
    ...f,
    toneAmp: f.toneAmp.map((_, k) => (k === i ? 0.1 : 0)),
    noiseAmp: f.noiseAmp.map(() => 0),
    sparkAmp: 0,
    bangAmp: 0,
    master: 1,
  };
}

const opts = (fs = FS) => ({
  sampleRate: fs,
  toneCount: tones.length,
  noiseCount: NOISE_VOICES.length,
  seed: 1,
});

/** Sub-idle to 105 %: N1 and N2 steps (percent of the 100 % speeds). */
const STEPS: readonly (readonly [number, number])[] = [
  [5, 20],
  [10, 30],
  [20, 61],
  [40, 75],
  [60, 85],
  [80, 92],
  [100, 100],
  [A1.maxN1Percent.value, 105],
];

describe('A1: tone frequencies', () => {
  it('the fan blade-pass tone is B_fan N1 / 60 with the published 24 blades', () => {
    expect(A1.fanBlades.value).toBe(24);
    const bpf = tones.find((t) => t.id === 'fan-h1');
    expect(bpf?.order).toBe(A1.fanBlades.value);
  });

  it.each(STEPS)('N1 %f %, N2 %f %: each tone peaks within 0.25 % of order x N / 60', (n1, n2) => {
    const s = withSpeeds(idle, n1, n2);
    const f = engineSoundFrame(model, { cycle: s, ambient: AMBIENT, thetaRad: 1, surgeCycles: 0 });
    let worst = 0;
    tones.forEach((t, i) => {
      // the buzz-saw orders at three of the steps (their frequencies are the same law)
      if (t.group === 'buzzSaw' && ![20, 80, 105].includes(n1)) return;
      const want = toneFrequencyHz(t, s.n1Rpm, s.n2Rpm);
      expect(want).toBeLessThan(A1.maxPartialOfSampleRate.value * FS);
      const ramp = 2400;
      const y = renderStream(
        [{ atFrame: 0, frame: solo(f, i), rampFrames: ramp }],
        ramp + N,
        opts(),
      ).samples;
      const pk = peakNear(powerSpectrum(y, N, ramp), want, FS, N, Math.max(5, 0.02 * want));
      const err = (100 * Math.abs(pk.freqHz - want)) / want;
      worst = Math.max(worst, err);
      expect(err, `${t.id} at ${want.toFixed(2)} Hz`).toBeLessThanOrEqual(
        A1.maxFrequencyErrorPercent.value,
      );
    });
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it('a 1 s linear N1 ramp at the snapshot rate: no frequency step over 0.5 % at a quantum boundary', () => {
    expect(A1.quantumFrames.value).toBe(QUANTUM_FRAMES);
    const i = tones.findIndex((t) => t.id === 'fan-h1');
    // about the worker's 20 Hz snapshots, on a quantum boundary so each target lands on time
    const post = 19 * QUANTUM_FRAMES;
    const rampS = A1.rampS.value;
    const n1At = (t: number) => 20 + 80 * Math.min(1, Math.max(0, (t - 0.2) / rampS));
    const stream = [];
    for (let k = 0; k * post < 1.6 * FS; k++) {
      const t = (k * post) / FS;
      const s = withSpeeds(idle, n1At(t), 61 + (39 * (n1At(t) - 20)) / 80);
      const f = engineSoundFrame(model, {
        cycle: s,
        ambient: AMBIENT,
        thetaRad: 1,
        surgeCycles: 0,
      });
      stream.push({ atFrame: k * post, frame: solo(f, i), rampFrames: post });
    }
    const y = renderStream(stream, 1.6 * FS, opts()).samples;
    const fi = instantaneousFrequency(y, FS);
    let worstStep = 0;
    let worstLag = 0;
    for (let b = Math.round(0.25 * FS); b < 1.3 * FS; b += QUANTUM_FRAMES) {
      const step = (100 * Math.abs((fi[b] ?? 0) - (fi[b - 1] ?? 0))) / (fi[b - 1] ?? 1);
      worstStep = Math.max(worstStep, step);
      // the synth glides to each posted target over one posting interval, so it plays the ramp
      // one interval late, exactly
      // (away from the ramp's two corners, which fall between postings)
      if (b < 0.32 * FS || b > 1.15 * FS) continue;
      const want = (24 * (n1At(b / FS - post / FS) / 100) * DEF.designPoint.n1Rpm) / 60;
      worstLag = Math.max(worstLag, (100 * Math.abs((fi[b] ?? 0) - want)) / want);
    }
    expect(worstStep).toBeLessThanOrEqual(A1.maxQuantumStepPercent.value);
    expect(worstLag).toBeLessThanOrEqual(A1.maxFrequencyErrorPercent.value);
  });

  it.each([48_000, 44_100, 16_000])(
    'at %i Hz no partial plays above 0.45 f_s, even with every voice on at 105 %',
    (fs) => {
      const s = withSpeeds(idle, A1.maxN1Percent.value, 105);
      const f = engineSoundFrame(model, {
        cycle: s,
        ambient: AMBIENT,
        thetaRad: 1,
        surgeCycles: 0,
      });
      const all = {
        ...f,
        toneAmp: f.toneAmp.map(() => 0.02),
        noiseAmp: f.noiseAmp.map(() => 0),
        sparkAmp: 0,
        bangAmp: 0,
        master: 1,
      };
      const n = 1 << 15;
      const y = renderStream(
        [{ atFrame: 0, frame: all, rampFrames: 0 }],
        n + 4800,
        opts(fs),
      ).samples;
      const p = powerSpectrum(y, n, 4800);
      // the bin of 0.45 f_s, plus the Hann window's main lobe
      const cut = Math.ceil(A1.maxPartialOfSampleRate.value * n) + 8;
      let total = 0;
      let above = 0;
      for (let k = 0; k < p.length; k++) {
        total += p[k] ?? 0;
        if (k >= cut) above += p[k] ?? 0;
      }
      expect(total).toBeGreaterThan(0);
      expect(10 * Math.log10(above / total + 1e-300)).toBeLessThan(-100);
      // at 16 kHz the fan's upper harmonics are above 0.45 f_s: they are muted, not folded
      if (fs === 16_000)
        expect(tones.some((t) => toneFrequencyHz(t, s.n1Rpm, s.n2Rpm) > 0.45 * fs)).toBe(true);
    },
  );
});
