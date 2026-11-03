// A4 (PHYSICS.md 3.6, D5-4): directivity from the listener's angle to the inlet axis. Rendered by
// the worklet's synth at take-off and at a part-power point: the fan's blade-pass tone read from
// the FFT forward (45 deg) and aft (150 deg); the jet streams' power over a sweep of angles.
import { beforeAll, describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import type { CycleState } from '../../../src/contracts/cycle';
import { NOISE_VOICES, maskFrame, toneVoices, type VoiceGroup } from '../../../src/audio/params';
import { renderStream } from '../../../src/audio/render';
import { createSoundModel, engineSoundFrame } from '../../../src/audio/sources';
import { bandPower, db, powerSpectrum, rms } from './lib/analysis';
import { AMBIENT, DEF, leverStates } from './lib/states';

/** The cycle-model runs behind the checks take seconds; more under a parallel run. */
const HOOK_TIMEOUT_MS = 120_000;

const A4 = THRESHOLDS.A4.values;
const FS = 48_000;
const N = 1 << 15;
const model = createSoundModel(DEF);
const tones = toneVoices(DEF);
const rad = (deg: number) => (deg * Math.PI) / 180;

function play(s: CycleState, deg: number, keep: readonly VoiceGroup[], frames: number) {
  const f = engineSoundFrame(model, {
    cycle: s,
    ambient: AMBIENT,
    thetaRad: rad(deg),
    surgeCycles: 0,
  });
  return renderStream(
    // a fixed master well under the limiter's ceiling: the levels compared are the sources'
    [{ atFrame: 0, frame: { ...maskFrame(f, tones, keep), master: 0.01 }, rampFrames: 0 }],
    frames,
    {
      sampleRate: FS,
      toneCount: tones.length,
      noiseCount: NOISE_VOICES.length,
      seed: 9,
    },
  ).samples;
}

let points: CycleState[] = [];
beforeAll(() => {
  points = leverStates([0.6, 1]);
}, HOOK_TIMEOUT_MS);

describe('A4: directivity', { timeout: 60_000 }, () => {
  it('the fan tones are at least 6 dB louder at 45 deg than at 150 deg', () => {
    for (const s of points) {
      const bpf = (24 * s.n1Rpm) / 60;
      const level = (deg: number) =>
        bandPower(powerSpectrum(play(s, deg, ['fan'], N + 2400), N, 2400), bpf, FS, N, 4);
      const forward = level(A4.forwardDeg.value);
      const aft = level(A4.aftDeg.value);
      console.log(
        `A4 N1 ${s.n1Percent.toFixed(1)} %: fan BPF 45 - 150 deg = ${db(forward / aft).toFixed(1)} dB`,
      );
      expect(forward).toBeGreaterThan(0);
      expect(db(forward / aft)).toBeGreaterThanOrEqual(A4.minForwardDb.value);
    }
  });

  it('the jet mixing noise peaks at an angle in 140-160 deg', () => {
    for (const s of points) {
      let best = -1;
      let bestPower = -1;
      for (let deg = 0; deg <= 180; deg += 5) {
        const y = play(s, deg, ['jet'], 3 * FS);
        const p = rms(y, FS / 2, y.length) ** 2;
        if (p > bestPower) {
          bestPower = p;
          best = deg;
        }
      }
      console.log(`A4 N1 ${s.n1Percent.toFixed(1)} %: jet noise peaks at ${best} deg`);
      expect(best).toBeGreaterThanOrEqual(A4.jetPeakMinDeg.value);
      expect(best).toBeLessThanOrEqual(A4.jetPeakMaxDeg.value);
    }
  });
});
