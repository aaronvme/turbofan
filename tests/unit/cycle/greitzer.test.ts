import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import {
  characteristic,
  criticalB,
  equilibrium,
  helmholtzFrequency,
  simulateSurge,
  throttleFlow,
  type GreitzerParams,
} from '../../../src/cycle/greitzer';

// C9 on the standard Moore-Greitzer example system (moved from model.test.ts, D3-13: pure and
// fast, so the mutation config keeps it while it leaves the slow transients out).

const C9 = THRESHOLDS.C9.values;
const SURGE: GreitzerParams = { psi0: 0.3, h: 0.18, w: 0.25, gammaT: 0.5, b: 1 };

describe('C9: Greitzer lumped compression system', () => {
  it('B above critical: a deep-surge limit cycle (flow reversal) near the Helmholtz period', () => {
    expect(SURGE.b).toBeGreaterThan(criticalB(SURGE));
    const r = simulateSurge(SURGE, 0.05, 400);
    expect(r.minPhi).toBeLessThan(0);
    expect(r.periodXi).not.toBeNull();
    // in xi = omega_H t units the Helmholtz period is 2 pi
    expect(Math.abs((r.periodXi ?? 0) / (2 * Math.PI) - 1)).toBeLessThan(
      C9.maxPeriodRelativeError.value,
    );
  });
  it('B below critical: the perturbation dies out (recovery, no limit cycle)', () => {
    const p = { ...SURGE, b: 0.5 };
    expect(p.b).toBeLessThan(criticalB(p));
    const r = simulateSurge(p, 0.05, 400);
    expect(r.maxPhi - r.minPhi).toBeLessThan(1e-3);
  });
  it('started at its equilibrium the system stays there and reports no period', () => {
    const r = simulateSurge({ ...SURGE, b: 0.5 }, 0, 100);
    expect(r.maxPhi - r.minPhi).toBeLessThan(1e-9);
    expect(r.periodXi).toBeNull();
  });
  it('a wide-open throttle puts the equilibrium on the falling branch: stable at any B', () => {
    // the characteristic peaks at Phi = 2W; past it the slope is negative
    const p = { ...SURGE, gammaT: 5, b: 5 };
    const eq = equilibrium(p);
    expect(eq.phi).toBeGreaterThan(2 * p.w + 0.01);
    expect(throttleFlow(p, characteristic(p, eq.phi))).toBeCloseTo(eq.phi, 9);
    expect(eq.psi).toBeCloseTo(characteristic(p, eq.phi), 12);
    expect(criticalB(p)).toBe(Infinity);
    const r = simulateSurge(p, 0.05, 400);
    expect(r.minPhi).toBeGreaterThan(0);
    expect(r.maxPhi - r.minPhi).toBeLessThan(1e-3);
  });
  it('the throttle passes reverse flow when the plenum pressure goes negative (odd in Psi)', () => {
    expect(throttleFlow(SURGE, 0.04)).toBeCloseTo(SURGE.gammaT * 0.2, 12);
    expect(throttleFlow(SURGE, -0.04)).toBeCloseTo(-SURGE.gammaT * 0.2, 12);
    expect(throttleFlow(SURGE, 0)).toBe(0);
  });
  it('the Helmholtz frequency is a sqrt(A / (V L))', () => {
    expect(helmholtzFrequency(340, 0.1, 0.4, 1)).toBeCloseTo(170, 9);
  });
});
