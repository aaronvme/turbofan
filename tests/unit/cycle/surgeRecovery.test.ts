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
import { createCycleModel } from '../../../src/cycle/model';
import { withCalibration } from '../../../src/cycle/partPower';

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

function run(
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

/** 14 CFR 33.73(a): from ground idle, the lever to maximum in 1 s, run for 10 s at dt 0.02 s. */
function slam(m: CycleModel): CycleState[] {
  m.reset('groundIdle', ISA_SLS);
  return run(m, 10, 0.02, (t) => inputs({ throttleLever: Math.min(1, t) }));
}

describe('W1K-I2: why the D3-14 part-power fit was rejected', { timeout: TIMEOUT_MS }, () => {
  it('its 33.73(a) slam surges, then hangs far below 95 % thrust (the adoption rule fails)', () => {
    // Pins the D3-14 adoption-rule rejection in the repo instead of on a scratch copy (critic pass
    // 5, probe w1k-calib). On the fit the HPC working line crosses the surge line about 1.5 s into
    // the slam (min margin below zero, the surge flag raised). Then, at N2 about 74 % with the VBV
    // still fully open (the fit opens it below 75 % N2c), the matched gas path stops converging and
    // the engine hangs at N1 about 35 %, 10-11 kN, until the end of the 10 s. The reference makes
    // 95 % thrust at about 5.8 s without a surge (model.test.ts).
    const states = slam(
      createCycleModel({ engine: withCalibration(referenceEngine(), PART_POWER_FIT_CALIBRATION) }),
    );
    expect(states.some((s) => s.flags.surge)).toBe(true);
    expect(Math.min(...states.map((s) => s.hpc.surgeMarginFraction))).toBeLessThan(0);
    const target = THRESHOLDS.C5.values.thrustFraction.value * takeoff;
    expect(Math.max(...states.map((s) => s.netThrustN))).toBeLessThan(target);
    const end = states[states.length - 1];
    expect(end?.n1Percent ?? Infinity).toBeLessThan(40);
    expect(end?.netThrustN ?? Infinity).toBeLessThan(0.15 * takeoff);
  });
});
