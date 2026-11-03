// A5's surge count (PHYSICS.md 3.6, D5-4): the Greitzer model's surge cycles, counted as flow
// breakdowns (Phi falling below Phi_eq - W/2 after it has been back at Phi_eq or above), and the
// cycle model's running count beside the contract (CycleDiagnostics.surgeCycles, like
// lostSolveCause): the engine sound plays one bang per cycle.
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../../../src/contracts/cycle';
import {
  SURGE_BREAKDOWN_DROP,
  countBreakdown,
  criticalB,
  equilibrium,
  greitzerStep,
  simulateSurge,
  type GreitzerParams,
  type GreitzerState,
} from '../../../src/cycle/greitzer';
import { createCycleModel } from '../../../src/cycle/model';

const SURGE: GreitzerParams = { psi0: 0.3, h: 0.18, w: 0.25, gammaT: 0.5, b: 1 };

function countOver(p: GreitzerParams, durationXi: number, perturbation = 0.05) {
  const eq = equilibrium(p);
  let s: GreitzerState = { phi: eq.phi * (1 - perturbation), psi: eq.psi };
  let c = { armed: true, cycles: 0 };
  const dxi = 0.01;
  for (let i = 0; i < Math.round(durationXi / dxi); i++) {
    s = greitzerStep(p, s, dxi);
    c = countBreakdown(c, p, eq.phi, s.phi);
  }
  return c.cycles;
}

describe('countBreakdown', () => {
  it('counts one cycle per period of a deep-surge limit cycle', () => {
    expect(SURGE.b).toBeGreaterThan(criticalB(SURGE));
    const period = simulateSurge(SURGE, 0.05, 400).periodXi ?? Number.NaN;
    const n = countOver(SURGE, 400);
    expect(Math.abs(n - 400 / period)).toBeLessThanOrEqual(1.5);
  });

  it('counts nothing for a decaying perturbation or a resting equilibrium', () => {
    const stable = { ...SURGE, b: 0.5 };
    expect(countOver(stable, 400)).toBe(0);
    expect(countOver(SURGE, 400, 0)).toBe(0);
  });

  it('needs the drop and the re-arm (hysteresis)', () => {
    const eq = 0.5;
    const drop = SURGE_BREAKDOWN_DROP * SURGE.w;
    let c = { armed: true, cycles: 0 };
    c = countBreakdown(c, SURGE, eq, eq - 0.9 * drop);
    expect(c).toEqual({ armed: true, cycles: 0 });
    c = countBreakdown(c, SURGE, eq, eq - 1.1 * drop);
    expect(c).toEqual({ armed: false, cycles: 1 });
    c = countBreakdown(c, SURGE, eq, eq - 2 * drop);
    expect(c.cycles).toBe(1);
    c = countBreakdown(c, SURGE, eq, eq - 0.01);
    expect(c.armed).toBe(false);
    c = countBreakdown(c, SURGE, eq, eq);
    expect(c.armed).toBe(true);
    c = countBreakdown(c, SURGE, eq, -1);
    expect(c).toEqual({ armed: false, cycles: 2 });
  });
});

const inputs = (throttleLever: number): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  throttleLever,
  fuelLever: 'run',
  ignition: 'auto',
});

describe("the cycle model's surge-cycle count", { timeout: 60_000 }, () => {
  it('is 0 without a surge, counts an injected one, and resets', () => {
    const m = createCycleModel();
    m.reset('groundIdle', ISA_SLS);
    for (let i = 0; i < 200; i++) m.step(0.05, inputs(0.6));
    expect(m.surgeCycles()).toBe(0);
    m.injectFault('surge');
    let surged = false;
    for (let i = 0; i < 100; i++) surged = m.step(0.02, inputs(0.6)).flags.surge || surged;
    expect(surged).toBe(true);
    const n = m.surgeCycles();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(n)).toBe(true);
    // over: the count stays
    for (let i = 0; i < 50; i++) m.step(0.02, inputs(0.6));
    expect(m.surgeCycles()).toBe(n);
    m.reset('groundIdle', ISA_SLS);
    expect(m.surgeCycles()).toBe(0);
  });

  it('is deterministic', () => {
    const counts = [0, 1].map(() => {
      const m = createCycleModel();
      m.reset('groundIdle', ISA_SLS);
      for (let i = 0; i < 100; i++) m.step(0.05, inputs(1));
      m.injectFault('surge');
      for (let i = 0; i < 100; i++) m.step(0.02, inputs(1));
      return m.surgeCycles();
    });
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeGreaterThanOrEqual(1);
  });
});
