// A2 (PHYSICS.md 3.6, D5-4): the buzz-saw. The fan's relative tip Mach from the cycle state
// against an independent computation here (constant gamma, bisection on the mass-flow function);
// then the summed engine-order level against the blade-pass tone, rendered by the worklet's synth
// (the fan's tones and the engine orders only) at the forward angle the buzz-saw radiates to.
import { beforeAll, describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import type { CycleState } from '../../../src/contracts/cycle';
import { NOISE_VOICES, maskFrame, toneVoices } from '../../../src/audio/params';
import { renderStream } from '../../../src/audio/render';
import { createSoundModel, engineSoundFrame, fanTipRelativeMach } from '../../../src/audio/sources';
import { bandPower, db, powerSpectrum } from './lib/analysis';
import { AMBIENT, DEF, leverStates, withSpeeds } from './lib/states';
import { recorder } from './lib/record';

const record = recorder('A2');

/** The cycle-model runs behind the checks take seconds; more under a parallel run. */
const HOOK_TIMEOUT_MS = 120_000;

const A2 = THRESHOLDS.A2.values;
const FS = 48_000;
const N = 1 << 16;
const model = createSoundModel(DEF);
const tones = toneVoices(DEF);
const B = tones.find((t) => t.id === 'fan-h1')?.order ?? 0;

/** The test's own relative tip Mach: gamma 1.4, R 287.05, the fan row's annulus, bisection. */
function independentRelativeTipMach(s: CycleState): number {
  const g = 1.4;
  const R = 287.05;
  const fan = DEF.bladeRows.find((r) => r.id === 'fan');
  if (fan === undefined) throw new Error('no fan row');
  const rt = fan.leadingEdge.tip.r;
  const rh = fan.leadingEdge.hub.r;
  const area = Math.PI * (rt * rt - rh * rh);
  const st = s.stations['2'];
  const target = (st.wKgPerS * Math.sqrt(st.ttK)) / (st.ptPa * area);
  const mfp = (m: number) =>
    m * Math.sqrt(g / R) * (1 + ((g - 1) / 2) * m * m) ** (-(g + 1) / (2 * (g - 1)));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mfp(mid) < target) lo = mid;
    else hi = mid;
  }
  const m = (lo + hi) / 2;
  const ts = st.ttK / (1 + ((g - 1) / 2) * m * m);
  const a = Math.sqrt(g * R * ts);
  const u = ((2 * Math.PI * s.n1Rpm) / 60) * rt;
  return Math.sqrt(m * m + (u / a) ** 2);
}

/** The state's N1 moved (bisection) until the relative tip Mach is `target`. */
function atRelativeMach(s: CycleState, target: number): CycleState {
  let lo = 1;
  let hi = 120;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (fanTipRelativeMach(withSpeeds(s, mid, s.n2Percent), DEF) < target) lo = mid;
    else hi = mid;
  }
  return withSpeeds(s, (lo + hi) / 2, s.n2Percent);
}

/** Summed engine-order power over the blade-pass tone's, dB, rendered at theta = 45 deg. */
function engineOrdersReBpfDb(s: CycleState): number {
  const f = engineSoundFrame(model, {
    cycle: s,
    ambient: AMBIENT,
    thetaRad: Math.PI / 4,
    surgeCycles: 0,
  });
  // a fixed master well under the limiter's ceiling: the levels compared are the sources'
  const fan = { ...maskFrame(f, tones, ['fan', 'buzzSaw']), master: 0.01 };
  const y = renderStream([{ atFrame: 0, frame: fan, rampFrames: 0 }], N + 2400, {
    sampleRate: FS,
    toneCount: tones.length,
    noiseCount: NOISE_VOICES.length,
    seed: 3,
  }).samples;
  const p = powerSpectrum(y, N, 2400);
  const shaft = s.n1Rpm / 60;
  const bpf = bandPower(p, B * shaft, FS, N, 4);
  let eo = 0;
  for (let k = 1; k < B; k++) eo += bandPower(p, k * shaft, FS, N, 4);
  return db(eo / bpf);
}

let states: CycleState[] = [];
beforeAll(() => {
  states = leverStates([0.5, 0.6, 0.8, 1]);
}, HOOK_TIMEOUT_MS);

describe('A2: buzz-saw', { timeout: 60_000 }, () => {
  it('voices the engine orders k = 1 .. B_fan - 1', () => {
    const eo = tones.filter((t) => t.group === 'buzzSaw').map((t) => t.order);
    expect(eo).toEqual(Array.from({ length: B - 1 }, (_, k) => k + 1));
    expect(A2.onsetMach.value).toBe(1);
  });

  it('the relative tip Mach from the cycle state agrees with the independent one within 0.5 %', () => {
    for (const s of states) {
      const mine = fanTipRelativeMach(s, DEF);
      const theirs = independentRelativeTipMach(s);
      record(`A2 N1 ${s.n1Percent.toFixed(1)} %: M_rel ${mine.toFixed(4)} vs ${theirs.toFixed(4)}`);
      expect((100 * Math.abs(mine - theirs)) / theirs).toBeLessThanOrEqual(
        A2.machAgreementPercent.value,
      );
    }
    // the sweep spans the onset: subsonic tips at the lower levers, supersonic at take-off
    const m = states.map((s) => fanTipRelativeMach(s, DEF));
    expect(Math.min(...m)).toBeLessThan(A2.subsonicMach.value);
    expect(Math.max(...m)).toBeGreaterThan(A2.supersonicMach.value);
  });

  it('the summed engine orders are >= 30 dB under the blade-pass tone at M_rel <= 0.98', () => {
    const sub = states.filter((s) => fanTipRelativeMach(s, DEF) <= A2.subsonicMach.value);
    const edge = states[1];
    if (edge === undefined) throw new Error('no state');
    sub.push(atRelativeMach(edge, A2.subsonicMach.value));
    expect(sub.length).toBeGreaterThanOrEqual(3);
    for (const s of sub) {
      expect(fanTipRelativeMach(s, DEF)).toBeLessThanOrEqual(A2.subsonicMach.value + 1e-9);
      const level = engineOrdersReBpfDb(s);
      record(
        `A2 M_rel ${fanTipRelativeMach(s, DEF).toFixed(3)}: engine orders ${level.toFixed(1)} dB re BPF`,
      );
      expect(level).toBeLessThanOrEqual(-A2.minSubsonicDbBelow.value);
    }
  });

  it('and within 20 dB of it at M_rel >= 1.05', () => {
    const sup = states.filter((s) => fanTipRelativeMach(s, DEF) >= A2.supersonicMach.value);
    const edge = states[2];
    if (edge === undefined) throw new Error('no state');
    sup.push(atRelativeMach(edge, A2.supersonicMach.value + 1e-6));
    expect(sup.length).toBeGreaterThanOrEqual(3);
    for (const s of sup) {
      expect(fanTipRelativeMach(s, DEF)).toBeGreaterThanOrEqual(A2.supersonicMach.value);
      const level = engineOrdersReBpfDb(s);
      record(
        `A2 M_rel ${fanTipRelativeMach(s, DEF).toFixed(3)}: engine orders ${level.toFixed(1)} dB re BPF`,
      );
      expect(Math.abs(level)).toBeLessThanOrEqual(A2.maxSupersonicDbBelow.value);
    }
  });
});
