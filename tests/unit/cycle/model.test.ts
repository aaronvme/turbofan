import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { ISA_SLS } from '../../../src/contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  validateCycleState,
  type CycleInputs,
  type CycleModel,
  type CycleState,
} from '../../../src/contracts/cycle';
import { factValue } from '../../../src/engine/facts';
import { createCycleModel, leverForNetThrust, SPOOL_INERTIA } from '../../../src/cycle/model';
import { expectNoLostSolves } from './fixtures';

// The pure C9 Greitzer tests are in greitzer.test.ts; this file holds the slow whole-engine
// transients, which the mutation config (vitest.mutation.config.ts, D3-13) leaves out.

/** Simulation tests take 1-10 s each; Stryker's instrumented runs are several times slower. */
const TIMEOUT_MS = 600_000;
const refs = { n1Rpm: factValue('n1ReferenceRpm'), n2Rpm: factValue('n2ReferenceRpm') };
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
  stop?: (s: CycleState) => boolean,
): CycleState[] {
  const out: CycleState[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const s = m.step(dt, f(m.state().timeS));
    out.push(s);
    if (stop?.(s) === true) break;
  }
  // D4-13: no lost gas-path solve since the model's reset, in every run of this file
  expectNoLostSolves(m.state());
  return out;
}

describe('transient model: shaft dynamics and FADEC', { timeout: TIMEOUT_MS }, () => {
  it('spool inertias are positive estimates (LP larger than HP)', () => {
    expect(SPOOL_INERTIA.lpKgM2).toBeGreaterThan(SPOOL_INERTIA.hpKgM2);
    expect(SPOOL_INERTIA.hpKgM2).toBeGreaterThan(0);
  });

  it('C5 (14 CFR 33.73(b)): from a stabilised 15 % of rated takeoff thrust to 95 % within 5.0 s', () => {
    // D2-1. 33.73(b) starts the 5 s clock at the fixed flight-idle lever position or, when there
    // is none (no published flight-idle point; ENGINE_FACTS "Flight-idle N1"), at not more than
    // 15 % of rated takeoff thrust (accelStartMaxThrustFraction), from a stabilized static
    // condition. The start point sits START_MARGIN below that ceiling so a settling residual can
    // never put it above.
    const takeoff = factValue('takeoffThrust');
    const ceiling = factValue('accelStartMaxThrustFraction');
    const START_MARGIN = 0.001;
    const lever0 = leverForNetThrust((ceiling - START_MARGIN) * takeoff, ISA_SLS);
    expect(lever0).toBeGreaterThan(0);
    expect(lever0).toBeLessThan(1);
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    expect(m.source).toBe('model');
    // the ~1 s spool time constant plus the slower LP thermal settling of the part-power loads:
    // 40 s gets N1 inside the 0.05-point stability criterion below
    const settle = run(m, 40, 0.05, () => inputs({ throttleLever: lever0 }));
    const start = m.state();
    // stabilised: N1 moved less than 0.05 points over the last second
    expect(Math.abs(start.n1Percent - (settle[settle.length - 21]?.n1Percent ?? 0))).toBeLessThan(
      0.05,
    );
    expect(start.netThrustN / takeoff).toBeLessThanOrEqual(ceiling);
    expect(start.netThrustN / takeoff).toBeGreaterThan(ceiling - 2 * START_MARGIN);
    const target = THRESHOLDS.C5.values.thrustFraction.value * takeoff;
    const t0 = start.timeS;
    // 33.73(a): the lever goes from the start position to maximum in 1 s
    const states = run(
      m,
      8,
      0.02,
      (t) => inputs({ throttleLever: Math.min(1, lever0 + (1 - lever0) * (t - t0)) }),
      (s) => s.netThrustN >= target,
    );
    const last = states[states.length - 1];
    expect(last?.netThrustN ?? 0).toBeGreaterThanOrEqual(target);
    expect((last?.timeS ?? Infinity) - t0).toBeLessThanOrEqual(THRESHOLDS.C5.values.maxTimeS.value);
    // 33.73(a): without overtemperature or surge
    for (const s of states) {
      expect(validateCycleState(s, refs)).toEqual([]);
      expect(s.flags.surge).toBe(false);
      expect(s.egtDisplayedK).toBeLessThan(factValue('egtTransientLimit'));
    }
  });

  it('33.73(a): ground idle to rated takeoff, lever moved in 1 s, without overtemperature or surge', () => {
    // 33.73(a) sets no time, but asks for no overtemperature, surge or stall from the minimum
    // lever position, which is a harsher start than C5's 15 %
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    const states = run(m, 10, 0.02, (t) => inputs({ throttleLever: Math.min(1, t) }));
    expect(states[states.length - 1]?.netThrustN ?? 0).toBeGreaterThan(
      THRESHOLDS.C5.values.thrustFraction.value * factValue('takeoffThrust'),
    );
    for (const s of states) {
      expect(validateCycleState(s, refs)).toEqual([]);
      expect(s.flags.surge).toBe(false);
      expect(s.hpc.surgeMarginFraction).toBeGreaterThan(0);
      expect(s.egtDisplayedK).toBeLessThan(factValue('egtTransientLimit'));
    }
  });

  it('leverForNetThrust: the lever that holds a steady thrust, monotonic, 0..1', () => {
    const takeoff = factValue('takeoffThrust');
    const a = leverForNetThrust(0.3 * takeoff, ISA_SLS);
    const b = leverForNetThrust(0.6 * takeoff, ISA_SLS);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(leverForNetThrust(takeoff, ISA_SLS)).toBeCloseTo(1, 6);
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    run(m, 30, 0.05, () => inputs({ throttleLever: b }));
    expect(m.state().netThrustN / takeoff).toBeCloseTo(0.6, 3);
  });

  it('settles at rated takeoff without overspeed and holds N1 inside the limits', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    const states = run(m, 20, 0.05, () => inputs({ throttleLever: 1 }));
    const s = states[states.length - 1];
    expect(Math.abs((s?.netThrustN ?? 0) / factValue('takeoffThrust') - 1)).toBeLessThan(0.03);
    for (const x of states) {
      expect(x.n1Rpm).toBeLessThanOrEqual(factValue('n1MaxRpm'));
      expect(x.n2Rpm).toBeLessThanOrEqual(factValue('n2MaxRpm'));
    }
  });

  it('is deterministic', () => {
    const a = createCycleModel();
    const b = createCycleModel();
    a.reset('groundIdle');
    b.reset('groundIdle');
    const ra = run(a, 3, 0.05, (t) => inputs({ throttleLever: Math.min(1, t / 2) }));
    const rb = run(b, 3, 0.05, (t) => inputs({ throttleLever: Math.min(1, t / 2) }));
    expect(JSON.stringify(ra[ra.length - 1])).toBe(JSON.stringify(rb[rb.length - 1]));
  });

  it('an injected surge raises the flag, then recovers', () => {
    const m = createCycleModel();
    m.reset('groundIdle');
    run(m, 6, 0.05, () => inputs({ throttleLever: 1 }));
    m.injectFault('surge');
    const states = run(m, 2, 0.02, () => inputs({ throttleLever: 1 }));
    expect(states.some((s) => s.flags.surge)).toBe(true);
    expect(states[states.length - 1]?.flags.surge).toBe(false);
    for (const s of states) expect(validateCycleState(s, refs)).toEqual([]);
  });
});

describe('start sequence', { timeout: TIMEOUT_MS }, () => {
  function start(fuelScale = 1, ignition: CycleInputs['ignition'] = 'auto') {
    const m = createCycleModel({ startFuelScale: fuelScale });
    m.reset('shutdown', ISA_SLS);
    let fuel = false;
    const states = run(
      m,
      150,
      0.05,
      () => {
        const s = m.state();
        if (s.n2Percent >= factValue('startFuelOnN2')) fuel = true;
        return inputs({ starter: true, fuelLever: fuel ? 'run' : 'cutoff', ignition });
      },
      (s) => s.startPhase === 'none' && s.fadec.mode === 'run',
    );
    return { m, states };
  }

  it('cranks, lights off, cuts the starter out and stabilises at ground idle inside C4', () => {
    const { states } = start();
    const last = states[states.length - 1];
    expect(last?.fadec.mode).toBe('run');
    expect(last?.combustorLit).toBe(true);
    expect(last?.starterEngaged).toBe(false);
    const peak = Math.max(...states.map((s) => s.egtDisplayedK));
    expect(peak).toBeLessThan(factValue('egtStartLimit'));
    for (const s of states) {
      expect(validateCycleState(s, refs)).toEqual([]);
      expect(s.flags.hotStart || s.flags.hungStart || s.flags.noLightOff).toBe(false);
      if (s.starterEngaged) expect(s.n2Percent).toBeLessThan(factValue('starterCutoutN2') + 0.5);
      if (s.combustorLit && !(states[0]?.combustorLit ?? false))
        expect(s.n2Percent).toBeGreaterThanOrEqual(factValue('minFuelOnN2'));
    }
    expect(last?.n2Percent ?? 0).toBeGreaterThanOrEqual(factValue('idleN2Min'));
    expect(last?.n1Percent ?? 0).toBeGreaterThanOrEqual(factValue('idleN1Min'));
    expect(last?.n1Percent ?? 0).toBeLessThanOrEqual(factValue('idleN1Max'));
    expect(last?.egtDisplayedK ?? Infinity).toBeLessThan(factValue('idleEgtMax'));
  });
  it('flags a hot start when the start fuel is far too rich', () => {
    const { states } = start(3);
    expect(states.some((s) => s.flags.hotStart)).toBe(true);
  });
  it('flags a hung start when the start fuel is too lean to accelerate', () => {
    const { states } = start(0.35);
    expect(states.some((s) => s.flags.hungStart)).toBe(true);
  });
  it('flags no light-off when fuel flows without igniters', () => {
    const { states } = start(1, 'off');
    expect(states.some((s) => s.flags.noLightOff)).toBe(true);
    expect(states.every((s) => !s.combustorLit)).toBe(true);
  });
});
