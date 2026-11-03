// A3 (PHYSICS.md 3.6, D5-4): jet mixing noise per stream, from the cycle model's nozzle exit
// velocity, density and area. The source power's U_j^8 slope (the function, and the power the
// worklet's synth actually plays at the aft peak angle), then the spectral peak's Strouhal number
// at that angle from a Welch PSD of the rendered stream.
import { beforeAll, describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import type { CycleState } from '../../../src/contracts/cycle';
import { NOISE_VOICES, silentFrame, toneVoices, type SoundFrame } from '../../../src/audio/params';
import { renderStream } from '../../../src/audio/render';
import {
  JET_PEAK_DEG,
  createSoundModel,
  engineSoundFrame,
  jetNoise,
  jetStream,
  lighthillPower,
  type JetStream,
} from '../../../src/audio/sources';
import { ENGINE_FACTS } from '../../../src/engine/facts';
import { rms, smoothedPeakHz, welch } from './lib/analysis';
import { AMBIENT, DEF, leverStates } from './lib/states';
import { recorder } from './lib/record';

const record = recorder('A3');

/** The cycle-model runs behind the checks take seconds; more under a parallel run. */
const HOOK_TIMEOUT_MS = 120_000;

const A3 = THRESHOLDS.A3.values;
const FS = 48_000;
const model = createSoundModel(DEF);
const tones = toneVoices(DEF);
const AFT = (JET_PEAK_DEG * Math.PI) / 180;
const rhoAmb = AMBIENT.pressurePa / (287.05 * AMBIENT.temperatureK);
const aAmb = Math.sqrt(1.4 * 287.05 * AMBIENT.temperatureK);

/** Least-squares slope of ln y against ln x. */
function logSlope(xs: readonly number[], ys: readonly number[]): number {
  const lx = xs.map(Math.log);
  const ly = ys.map(Math.log);
  const mx = lx.reduce((s, v) => s + v, 0) / lx.length;
  const my = ly.reduce((s, v) => s + v, 0) / ly.length;
  let sxy = 0;
  let sxx = 0;
  lx.forEach((x, i) => {
    sxy += (x - mx) * ((ly[i] ?? 0) - my);
    sxx += (x - mx) ** 2;
  });
  return sxy / sxx;
}

const ids = NOISE_VOICES.map((v) => v.id);

/** A frame playing only one jet stream's two noise voices (large- and fine-scale). */
function jetOnly(j: JetStream, stream: 'core' | 'bypass'): SoundFrame {
  const n = jetNoise(j, AMBIENT, AFT);
  const f = silentFrame(tones.length, NOISE_VOICES.length);
  const hz = [...f.noiseHz];
  const q = [...f.noiseQ];
  const amp = [...f.noiseAmp];
  for (const [id, part] of [
    [`jet-${stream}-large`, n.large],
    [`jet-${stream}-fine`, n.fine],
  ] as const) {
    const i = ids.indexOf(id);
    expect(i, id).toBeGreaterThanOrEqual(0);
    hz[i] = part.hz;
    q[i] = part.q;
    amp[i] = part.amp;
  }
  // a fixed master well under the limiter's ceiling, so the power played is the source's
  return { ...f, noiseHz: hz, noiseQ: q, noiseAmp: amp, master: 0.01 };
}

function render(f: SoundFrame, seconds: number): Float32Array {
  return renderStream([{ atFrame: 0, frame: f, rampFrames: 0 }], Math.round(seconds * FS), {
    sampleRate: FS,
    toneCount: tones.length,
    noiseCount: NOISE_VOICES.length,
    seed: 5,
  }).samples;
}

let takeoff: CycleState;
beforeAll(() => {
  const [s] = leverStates([1], 8);
  if (s === undefined) throw new Error('no state');
  takeoff = s;
}, HOOK_TIMEOUT_MS);

const SUBSONIC_U = [100, 140, 180, 220, 260, 300, 330];

describe('A3: jet mixing noise', { timeout: 60_000 }, () => {
  it("the source power's log-log slope against U_j is 8 +- 0.2 at fixed rho_j / rho_inf and area", () => {
    for (const ratio of [0.45, 1]) {
      const p = SUBSONIC_U.map((u) => lighthillPower(u, ratio * rhoAmb, rhoAmb, aAmb, 0.9));
      expect(Math.max(...SUBSONIC_U)).toBeLessThan(aAmb);
      expect(Math.abs(logSlope(SUBSONIC_U, p) - A3.slope.value)).toBeLessThanOrEqual(
        A3.slopeTolerance.value,
      );
    }
  });

  it('and so does the power the synth plays, per stream, at the aft peak angle', () => {
    for (const stream of ['core', 'bypass'] as const) {
      const area =
        stream === 'core' ? ENGINE_FACTS.coreNozzleArea.si : ENGINE_FACTS.bypassNozzleArea.si;
      const rho = stream === 'core' ? 0.55 : 1.2;
      const played = SUBSONIC_U.map((u) => {
        const j: JetStream = {
          velocity: u,
          density: rho,
          areaM2: area,
          diameterM: Math.sqrt((4 * area) / Math.PI),
        };
        const y = render(jetOnly(j, stream), 4);
        return rms(y, FS / 2, y.length) ** 2;
      });
      record(`A3 ${stream}: played power slope ${logSlope(SUBSONIC_U, played).toFixed(3)}`);
      expect(Math.abs(logSlope(SUBSONIC_U, played) - A3.slope.value)).toBeLessThanOrEqual(
        A3.slopeTolerance.value,
      );
    }
  });

  it("the frame's jet voices are the cycle state's own nozzle streams", () => {
    const f = engineSoundFrame(model, {
      cycle: takeoff,
      ambient: AMBIENT,
      thetaRad: AFT,
      surgeCycles: 0,
    });
    for (const [stream, st, area] of [
      ['core', takeoff.stations['8'], ENGINE_FACTS.coreNozzleArea.si],
      ['bypass', takeoff.stations['18'], ENGINE_FACTS.bypassNozzleArea.si],
    ] as const) {
      const n = jetNoise(jetStream(st, AMBIENT.pressurePa, area), AMBIENT, AFT);
      const i = ids.indexOf(`jet-${stream}-large`);
      expect(f.noiseHz[i]).toBeCloseTo(n.large.hz, 9);
      expect(f.noiseAmp[i]).toBeCloseTo(n.large.amp, 12);
    }
  });

  it('the spectral peak at the aft peak angle sits at f D_j / U_j in 0.15-0.3, per stream at take-off', () => {
    for (const [stream, st, area] of [
      ['core', takeoff.stations['8'], ENGINE_FACTS.coreNozzleArea.si],
      ['bypass', takeoff.stations['18'], ENGINE_FACTS.bypassNozzleArea.si],
    ] as const) {
      const j = jetStream(st, AMBIENT.pressurePa, area);
      expect(j.velocity).toBeGreaterThan(100);
      const y = render(jetOnly(j, stream), 16);
      const n = 1 << 16;
      const psd = welch(y, n, FS / 2);
      const f = smoothedPeakHz(psd, FS, n, 10, 4000, 6);
      const strouhal = (f * j.diameterM) / j.velocity;
      record(
        `A3 ${stream}: U ${j.velocity.toFixed(0)} m/s, D ${j.diameterM.toFixed(3)} m, peak ${f.toFixed(1)} Hz, St ${strouhal.toFixed(3)}`,
      );
      expect(strouhal, `${stream}: peak ${f.toFixed(1)} Hz`).toBeGreaterThanOrEqual(
        A3.minStrouhal.value,
      );
      expect(strouhal, `${stream}: peak ${f.toFixed(1)} Hz`).toBeLessThanOrEqual(
        A3.maxStrouhal.value,
      );
    }
  });
});
