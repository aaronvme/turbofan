// The ladder's convergence driver (tests/ladder/common.ts, PHYSICS.md 3.3 "CPU variants"):
// "converged" must mean the density residual fell below the fraction and stayed there. Ladder L8's
// first run stopped at iteration 1017 on the dip of an oscillating residual (1e-5 at 1017, 1.6e-4
// ten iterations later), with the field still 0.5 % from steady at 1.7 m.
import { describe, expect, it } from 'vitest';
import {
  CAP_CFL,
  CONVERGED_WINDOW,
  STEADY_EVERY,
  STEADY_WINDOW,
  converge,
  scaledCap,
  steadyWindow,
} from '../../ladder/common';
import type { ReferenceSolver } from '../../../src/flow/reference/solver';

/** A stand-in solver whose residual follows a script (iteration n returns history(n), n >= 1). */
function scripted(history: (n: number) => number): ReferenceSolver {
  let n = 0;
  return {
    iterate: () => {
      n++;
      return { residualDensityL2: history(n) };
    },
  } as unknown as ReferenceSolver;
}

describe('ladder convergence driver', () => {
  it('ignores a dip of an oscillating residual below the target', () => {
    // first 1e-2, so the target is 1e-7; one iteration (100) dips to 1e-8, then decay from 2000
    const s = scripted((n) => (n === 100 ? 1e-8 : n < 2000 ? 1e-2 : 1e-2 * 0.99 ** (n - 2000)));
    const c = converge(s, 1e-5, 10000);
    expect(c.converged).toBe(true);
    // first below 1e-7 at 2000 + ln(1e-5)/ln(0.99) = 3146 and it stays: the count is that iteration
    expect(c.iterations).toBe(2000 + Math.ceil(Math.log(1e-5) / Math.log(0.99)));
  });

  it('counts the first iteration of a window that stays below the target', () => {
    const s = scripted((n) => (n === 1 ? 1 : n >= 40 ? 1e-6 : 1e-3));
    const c = converge(s, 1e-5, 1000);
    expect(c).toMatchObject({ converged: true, iterations: 40, first: 1 });
  });

  it('is not converged when the residual keeps returning above the target', () => {
    const s = scripted((n) => (n === 1 ? 1 : n % (CONVERGED_WINDOW - 1) === 0 ? 1e-3 : 1e-7));
    const c = converge(s, 1e-5, 2000);
    expect(c.converged).toBe(false);
    expect(c.iterations).toBe(2000);
  });

  it('stops at a non-finite residual', () => {
    const s = scripted((n) => (n < 5 ? 1 : NaN));
    expect(converge(s, 1e-5, 100)).toMatchObject({ converged: false, iterations: 5 });
  });
});

// D4-45 (W2R-I7): a value row taken before convergence must be steady over the run's last
// STEADY_WINDOW iterations (max - min of the samples within a tenth of the row's tolerance)
describe('the D4-45 steadiness window', () => {
  it('samples the metric at the window start and every STEADY_EVERY iterations to its end', () => {
    let n = 0;
    const s = {
      iterate: (k = 1) => {
        n += k;
        return { residualDensityL2: 1 };
      },
    } as unknown as ReferenceSolver;
    n = 500;
    const w = steadyWindow(s, () => n);
    expect(STEADY_WINDOW).toBe(2000);
    expect(STEADY_EVERY).toBe(100);
    expect(w.samples).toEqual(Array.from({ length: 21 }, (_, k) => 500 + 100 * k));
    expect(w.value).toBe(2500);
    expect(w.spread).toBe(2000);
    expect(n).toBe(2500);
  });

  it('scales an iteration cap set at the plain CFL as 1 / CFL (pseudo-time steps)', () => {
    expect(CAP_CFL).toBe(1.5);
    expect(scaledCap(20000, 0.8)).toBe(37500);
    expect(scaledCap(20000, 1.5)).toBe(20000);
    expect(scaledCap(20000, 1.0)).toBe(30000);
  });
});
