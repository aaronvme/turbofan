import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  type CycleInputs,
  type CycleModel,
  type CycleState,
} from '../../../src/contracts/cycle';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { factValue } from '../../../src/engine/facts';
import { PART_POWER_FIT_CALIBRATION, referenceEngine } from '../../../src/cycle/engine';
import { SUBIDLE_N2_PERCENT, createCycleModel } from '../../../src/cycle/model';
import { compressionSystem, systemHelmholtzFrequency } from '../../../src/cycle/surgeSystem';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { gamma, gasConstant } from '../../../src/thermo/gas';
import { withCalibration } from '../../../src/cycle/partPower';
import { expectNoLostSolves, lazy } from './fixtures';

// Transient surge scenarios (slow: whole-engine simulations of 10-40 s). The mutation config
// (vitest.mutation.config.ts, D3-13) leaves this file out; mutants that only these tests reach are
// reported as "no fast coverage".

const TIMEOUT_MS = 600_000;
const takeoff = factValue('takeoffThrust');
const inputs = (over: Partial<CycleInputs>): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  ...over,
});

/** Steps the model, without the D4-13 check (the W1K-I2 pin loses solves on purpose). */
function steps(
  m: CycleModel,
  seconds: number,
  dt: number,
  f: (t: number) => CycleInputs,
): CycleState[] {
  const out: CycleState[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) out.push(m.step(dt, f(m.state().timeS)));
  return out;
}

/** steps(), then D4-13: no lost gas-path solve since the model's reset. */
function run(
  m: CycleModel,
  seconds: number,
  dt: number,
  f: (t: number) => CycleInputs,
): CycleState[] {
  const out = steps(m, seconds, dt, f);
  expectNoLostSolves(m.state());
  return out;
}

/** 14 CFR 33.73(a): from ground idle, the lever to maximum in 1 s, run for 10 s at dt 0.02 s. */
function slam(m: CycleModel): CycleState[] {
  m.reset('groundIdle', ISA_SLS);
  return steps(m, 10, 0.02, (t) => inputs({ throttleLever: Math.min(1, t) }));
}

describe('W1K-I2: why the D3-14 part-power fit was rejected', { timeout: TIMEOUT_MS }, () => {
  it('its 33.73(a) slam surges, then loses the matched gas path: the "hang" is a lost solve (D4-13)', () => {
    // Pins the D3-14 adoption-rule rejection in the repo instead of on a scratch copy (critic pass
    // 5, probe w1k-calib). On the fit the HPC working line crosses the surge line about 1.5 s into
    // the slam (min margin below zero, the surge flag raised). Then, at N2 about 74 % with the VBV
    // still fully open (the fit opens it below 75 % N2c), the matched gas path stops converging.
    // Before D4-13 the model fell back to the sub-idle similarity model there without a word, and
    // the engine "hung" at N1 about 35 %, 10-11 kN; now the state holds the last converged gas path
    // and says so. The reference makes 95 % thrust at about 5.8 s without a surge (model.test.ts).
    const states = slam(
      createCycleModel({ engine: withCalibration(referenceEngine(), PART_POWER_FIT_CALIBRATION) }),
    );
    expect(states.some((s) => s.flags.surge)).toBe(true);
    expect(Math.min(...states.map((s) => s.hpc.surgeMarginFraction))).toBeLessThan(0);
    // the real cause: lost matched solves, lit and fuelled above the sub-idle switch
    const first = states.find((s) => s.gasPathSolve.lostSolves > 0);
    expect(first, 'a lost solve').toBeDefined();
    expect(first?.combustorLit).toBe(true);
    expect(first?.n2Percent ?? 0).toBeGreaterThan(SUBIDLE_N2_PERCENT);
    expect(states.some((s) => s.gasPathSolve.status === 'held')).toBe(true);
    // never the silent switch: above the switch, lit and fuelled, a state is matched or held
    for (const s of states) {
      if (s.combustorLit && s.fuelFlowKgPerS > 0 && s.n2Percent >= SUBIDLE_N2_PERCENT) {
        expect(s.gasPathSolve.status).not.toBe('subIdle');
      }
    }
    // and the adoption rule fails: no 95 % thrust in the 10 s
    const target = THRESHOLDS.C5.values.thrustFraction.value * takeoff;
    expect(Math.max(...states.map((s) => s.netThrustN))).toBeLessThan(target);
  });
});

describe(
  'C12 (D3-17): surge detection and recovery on a reduced-margin HPC',
  { timeout: TIMEOUT_MS },
  () => {
    const C12 = THRESHOLDS.C12.values;
    const dt = 0.02;
    const hold = C12.maximumLeverHoldS.value;
    const move = C12.leverMoveS.value;
    const lever = (t: number) =>
      t < hold ? Math.min(1, t / move) : Math.max(0, 1 - (t - hold) / move);
    // the whole case, once: 30 s at maximum, 1 s back, 45 s at minimum
    const states = lazy(() => {
      const m = createCycleModel({ hpcSurgeMarginLoss: C12.surgePressureRatioLoss.value });
      m.reset('groundIdle', ISA_SLS);
      return run(m, hold + move + C12.minimumLeverHoldS.value, dt, (t) =>
        inputs({ throttleLever: lever(t) }),
      );
    });
    /** Indices of the steps where a surge episode starts (the flag rises). */
    const onsets = () =>
      states().flatMap((s, i) =>
        s.flags.surge && !(states()[i - 1]?.flags.surge ?? false) ? [i] : [],
      );

    it('the slam surges (the case is not void)', () => {
      expect(onsets().length).toBeGreaterThan(0);
    });

    it('every surge is detected from the sensed P3 within 0.1 s: fuel cut, VBVs open, igniters on', () => {
      const window = Math.round(C12.maxDetectionDelayS.value / dt);
      for (const i of onsets()) {
        const before = states()[i - 1];
        expect(before).toBeDefined();
        const preFuel = before?.fuelFlowKgPerS ?? 0;
        const acted = states()
          .slice(i, i + window + 1)
          .some((s) => s.ignitersOn && s.vbvOpenFraction === 1 && s.fuelFlowKgPerS < preFuel);
        expect(acted, `surge at ${states()[i]?.timeS.toFixed(2)} s`).toBe(true);
      }
    });

    it('at most 2 surges, no flameout, displayed EGT below the transitory limit', () => {
      expect(onsets().length).toBeLessThanOrEqual(C12.maxSurges.value);
      for (const s of states()) {
        expect(s.flags.flameout).toBe(false);
        expect(s.combustorLit).toBe(true);
        expect(s.egtDisplayedK).toBeLessThan(factValue('egtTransientLimit'));
      }
    });

    it('95 % rated takeoff thrust within 10 s of the lever movement, then surge-free to the end of the hold', () => {
      const target = C12.thrustFraction.value * takeoff;
      const k = states().findIndex((s) => s.netThrustN >= target);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(states()[k]?.timeS ?? Infinity).toBeLessThanOrEqual(C12.maxTimeToThrustS.value);
      for (const s of states().filter((x, j) => j >= k && x.timeS <= hold)) {
        expect(s.flags.surge).toBe(false);
        expect(s.netThrustN).toBeGreaterThanOrEqual(target);
      }
    });

    it('back at minimum lever, N1 and N2 inside the C4 ground-idle ranges at the end of the 45 s', () => {
      const end = states()[states().length - 1];
      expect(end?.timeS ?? 0).toBeCloseTo(hold + move + C12.minimumLeverHoldS.value, 6);
      expect(end?.n1Percent ?? 0).toBeGreaterThanOrEqual(factValue('idleN1Min'));
      expect(end?.n1Percent ?? Infinity).toBeLessThanOrEqual(factValue('idleN1Max'));
      expect(end?.n2Percent ?? 0).toBeGreaterThanOrEqual(factValue('idleN2Min'));
      expect(end?.n2Percent ?? Infinity).toBeLessThanOrEqual(factValue('idleN2Max'));
      for (const s of states().filter((x) => x.timeS > hold)) expect(s.flags.surge).toBe(false);
    });
  },
);

describe('D3-17: the surge detector on the clean engine', { timeout: TIMEOUT_MS }, () => {
  it('a slam deceleration from takeoff never trips it (no recovery: igniters stay off in auto)', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    run(m, 15, 0.05, () => inputs({ throttleLever: 1 }));
    const states = run(m, 20, 0.02, () => inputs({ throttleLever: 0 }));
    for (const s of states) {
      expect(s.ignitersOn).toBe(false);
      expect(s.flags.surge).toBe(false);
    }
  });

  it('an injected surge at takeoff is detected at once and recovered: igniters on, fuel cut, then back', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    const steady = run(m, 15, 0.05, () => inputs({ throttleLever: 1 }));
    const before = steady[steady.length - 1];
    m.injectFault('surge');
    const after = run(m, 10, 0.02, () => inputs({ throttleLever: 1 }));
    const onset = after[0];
    expect(onset?.flags.surge).toBe(true);
    expect(onset?.ignitersOn).toBe(true);
    // above their closing speed the VBVs stay shut: at takeoff the booster has no stall to guard,
    // and a quarter of its flow dumped would push it past its map's choke edge
    expect(onset?.vbvOpenFraction).toBe(0);
    expect(onset?.fuelFlowKgPerS ?? Infinity).toBeLessThan(before?.fuelFlowKgPerS ?? 0);
    const end = after[after.length - 1];
    expect(end?.flags.surge).toBe(false);
    expect(end?.ignitersOn).toBe(false);
    expect(end?.vbvOpenFraction).toBe(0);
    expect((end?.netThrustN ?? 0) / takeoff).toBeGreaterThan(0.98);
  });
});

// moved from surge.test.ts (D3-13: a whole-engine transient)
describe('W1C-I2: the model surges on its own compression system', { timeout: TIMEOUT_MS }, () => {
  it('an injected surge at takeoff: reverse flow at the derived period, then recovery', () => {
    const m = createCycleModel();
    m.reset('groundIdle');
    for (let i = 0; i < 300; i++) m.step(0.05, inputs({ throttleLever: 1 }));
    const before = m.state();
    m.injectFault('surge');
    const p3: number[] = [];
    const ts: number[] = [];
    let reverse = 0;
    for (let i = 0; i < 1000; i++) {
      const s = m.step(0.001, inputs({ throttleLever: 1 }));
      if (!s.flags.surge) continue;
      p3.push(s.stations['3'].ptPa);
      ts.push(s.timeS);
      if (s.stations['3'].wKgPerS === 0) reverse++;
    }
    expect(p3.length).toBeGreaterThan(0);
    expect(reverse).toBeGreaterThan(0);
    expect(m.state().flags.surge).toBe(false);
    expectNoLostSolves(m.state());
    // period of the P3 oscillation vs the derived Helmholtz period at the onset state
    const mean = p3.reduce((a, b) => a + b, 0) / p3.length;
    const ups: number[] = [];
    for (let k = 1; k < p3.length; k++) {
      if ((p3[k - 1] ?? 0) < mean && (p3[k] ?? 0) >= mean) ups.push(ts[k] ?? 0);
    }
    expect(ups.length).toBeGreaterThanOrEqual(3);
    const period = ((ups[ups.length - 1] ?? 0) - (ups[0] ?? 0)) / (ups.length - 1);
    const t3 = before.stations['3'].ttK;
    const tH =
      (2 * Math.PI) /
      systemHelmholtzFrequency(
        compressionSystem(ENGINE_DEFINITION),
        Math.sqrt(gamma(t3, 0) * gasConstant(0) * t3),
      );
    expect(period).toBeGreaterThan(tH);
    // B < 1 makes it a relaxation oscillation, longer than the Helmholtz period
    expect(period).toBeLessThan(4 * tH);
  });
});
