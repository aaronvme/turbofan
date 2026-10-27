// Linear (von Neumann) stability of the tracking-mode 3-stage RK (docs/SOLVER.md section 10,
// decision D4-8): G(z) = 1 + z + a2 z^2 + a1 a2 z^3 on the Fourier symbol of upwind advection
// with the solver's MUSCL in smooth regions (van Albada -> the kappa = 0 central slope, whose
// dissipation is O(theta^4)) and with first-order upwinding. Pins the stability limits of the
// coefficients the oracle uses, (0.2, 0.5, 1), and that the W0 spike's (0.1918, 0.4929, 1) are
// unstable for long waves at any CFL.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CFL,
  DEFAULT_CFL_PRECONDITIONED,
  RK3_ALPHA,
} from '../../../src/flow/reference/solver';
import { acousticLimit, type AcousticCase } from './acoustic';

type C = readonly [number, number];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const scale = (s: number, a: C): C => [s * a[0], s * a[1]];
const expi = (t: number): C => [Math.cos(t), Math.sin(t)];

/** Semi-discrete symbol per unit CFL: d u_j/dt = (nu / dt) z(theta) u_j. */
function symbol(order: 1 | 2, t: number): C {
  if (order === 1) return scale(-1, add([1, 0], scale(-1, expi(-t))));
  // face flux u_i + sigma_i / 2 with sigma_i = (u_{i+1} - u_{i-1}) / 2: 3/4 + e^{it}/4 - 5/4 e^{-it} + e^{-2it}/4
  const s = add(
    add([0.75, 0], scale(0.25, expi(t))),
    add(scale(-1.25, expi(-t)), scale(0.25, expi(-2 * t))),
  );
  return scale(-1, s);
}

function maxGain(alpha: readonly number[], order: 1 | 2, cfl: number): number {
  const [a1, a2] = alpha as [number, number];
  let worst = 0;
  for (let k = 1; k <= 4000; k++) {
    const z = scale(cfl, symbol(order, (Math.PI * k) / 4000));
    const z2 = mul(z, z);
    const g = add(add([1, 0], z), add(scale(a2, z2), scale(a1 * a2, mul(z2, z))));
    worst = Math.max(worst, Math.hypot(g[0], g[1]));
  }
  return worst;
}

function stabilityLimit(alpha: readonly number[], order: 1 | 2): number {
  let lo = 0.01;
  let hi = 4;
  for (let k = 0; k < 50; k++) {
    const mid = 0.5 * (lo + hi);
    if (maxGain(alpha, order, mid) <= 1 + 1e-12) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe('tracking RK3: linear stability (D4-8)', () => {
  it('(0.2, 0.5, 1) is stable to CFL 1.54 at second order and 1.86 at first order', () => {
    expect(RK3_ALPHA).toEqual([0.2, 0.5, 1]);
    expect(stabilityLimit(RK3_ALPHA, 2)).toBeCloseTo(1.54, 2);
    expect(stabilityLimit(RK3_ALPHA, 1)).toBeCloseTo(1.86, 2);
    expect(DEFAULT_CFL).toBeLessThanOrEqual(stabilityLimit(RK3_ALPHA, 2));
  });

  it("the W0 spike's (0.1918, 0.4929, 1) grow long waves at second order at any CFL", () => {
    const spike = [0.1918, 0.4929, 1] as const;
    for (const cfl of [0.05, 0.5, 1, 1.5]) expect(maxGain(spike, 2, cfl)).toBeGreaterThan(1 + 1e-9);
    // 1.5e-3 per iteration at the default CFL 1.5, 1.3e-4 at CFL 1 (section 10)
    expect(maxGain(spike, 2, 1.5) - 1).toBeGreaterThan(1e-3);
    expect(maxGain(spike, 2, 1.5) - 1).toBeLessThan(2e-3);
    expect(maxGain(spike, 2, 1) - 1).toBeGreaterThan(1e-4);
  });
});

// D4-32 (docs/SOLVER.md section 10): the fully discrete limit of the same 3-stage scheme on the
// pseudo-acoustic family at rest (tests/unit/flow/acoustic.ts), where SLAU2's velocity dissipation
// vanishes and only the mass-flux pressure diffusion damps the pair. aspect = r-face / x-face
// area; 0 is the 1D limit. The 1D numbers are the critic's probe w2r-l8-vonneumann's.
describe('preconditioned tracking RK3: the acoustic family at rest (D4-32)', () => {
  const mRef = 0.003;
  const matched = (ku: number, aspect: number): AcousticCase => ({
    beta: mRef,
    fa: mRef * (2 - mRef),
    ku,
    aspect,
  });
  // 96 wave numbers in 1D; 48 x 49 in 2D (the limits agree with 96 x 97 to 1e-3)
  const limit = (k: AcousticCase) => acousticLimit(RK3_ALPHA, k, k.aspect > 0 ? 48 : 96);

  it('pins the limits: plain 1.236 (1D); matched 0.972 (1D) / 1.550 (square)', () => {
    expect(limit({ beta: 1, fa: 1, ku: 0, aspect: 0 })).toBeCloseTo(1.236, 3);
    expect(limit(matched(0, 0))).toBeCloseTo(0.972, 3);
    expect(limit(matched(0, 1))).toBeCloseTo(1.55, 3);
    // the matched limit does not depend on beta (= M_ref): 0.9727 at 0.006 against 0.9722
    const at006 = acousticLimit(RK3_ALPHA, { ...matched(0, 0), beta: 0.006, fa: 0.006 * 1.994 });
    expect(Math.abs(at006 - limit(matched(0, 0)))).toBeLessThan(1e-3);
  }, 60_000);

  it('pins the limits with the AUSM+-up p_u term at K_u 0.5: 1.413 (1D) / 1.958 (square)', () => {
    expect(limit(matched(0.5, 0))).toBeCloseTo(1.413, 3);
    expect(limit(matched(0.5, 1))).toBeCloseTo(1.958, 3);
  }, 60_000);

  it('sets the preconditioned default at 0.8-0.825 x the worst (1D) limit; 1.5 is beyond it', () => {
    const worst = limit(matched(0, 0));
    expect(DEFAULT_CFL_PRECONDITIONED / worst).toBeGreaterThanOrEqual(0.8);
    expect(DEFAULT_CFL_PRECONDITIONED / worst).toBeLessThanOrEqual(0.825);
    // the plain default would be unstable on the pseudo-acoustic pair of cells up to aspect 0.5
    expect(DEFAULT_CFL).toBeGreaterThan(limit(matched(0, 0.5)));
  }, 60_000);
});
