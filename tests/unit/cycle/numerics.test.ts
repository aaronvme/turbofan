// The numeric kernels' failure paths: checked indexing, the linear solver and Newton's
// non-convergence exits (the steady and transient solvers rely on all three).
import { describe, expect, it } from 'vitest';
import { at } from '../../../src/cycle/at';
import { newton, solveLinear } from '../../../src/cycle/newton';

describe('at: checked array access', () => {
  it('returns in-range elements, including falsy ones', () => {
    expect(at([3, 0, 5], 1)).toBe(0);
    expect(at([3, 0, 5], 2)).toBe(5);
  });
  it('throws a RangeError instead of reading undefined as a number', () => {
    expect(() => at([1, 2], 2)).toThrow(RangeError);
    expect(() => at([1, 2], -1)).toThrow(/outside \[0, 2\)/);
    expect(() => at([], 0)).toThrow(RangeError);
  });
});

describe('solveLinear', () => {
  it('pivots past a zero on the diagonal and solves exactly', () => {
    // x = (1, 2, 3); a naive elimination would divide by the leading 0
    const a = [
      [0, 2, 1],
      [1, 1, 1],
      [2, 0, 3],
    ];
    const x = solveLinear(a, [7, 6, 11]);
    [1, 2, 3].forEach((v, i) => {
      expect(x[i]).toBeCloseTo(v, 12);
    });
  });
  it('picks the largest pivot (stable on a badly scaled row)', () => {
    const x = solveLinear(
      [
        [1e-12, 1],
        [1, 1],
      ],
      [1, 2],
    );
    expect(x[0]).toBeCloseTo(1, 9);
    expect(x[1]).toBeCloseTo(1, 9);
  });
  it('throws on a singular matrix and on a shape mismatch', () => {
    expect(() =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow('singular Jacobian');
    expect(() => solveLinear([[1, 2]], [1])).toThrow(/must be 1 x 1/);
    expect(() => solveLinear([[1], [2]], [1])).toThrow(/must be 1 x 1/);
  });
});

describe('newton: exits without convergence', () => {
  const opts = { tolerance: 1e-12, maxIterations: 20, maxStep: [1, 1] };

  it('stops at once on a singular Jacobian, leaving x untouched', () => {
    // two parallel lines: no solution, rank-1 Jacobian everywhere
    const r = newton(
      (x) => [at(x, 0) + at(x, 1) - 1, 2 * at(x, 0) + 2 * at(x, 1) - 3],
      [0, 0],
      opts,
    );
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(1);
    expect(r.x).toEqual([0, 0]);
    expect(r.maxResidual).toBe(3);
  });

  it('keeps the last good iterate when the residual is not finite along the whole step', () => {
    // defined only within 1e-3 of x = 2: every trial point of the line search (down to
    // lambda = 1/512, i.e. 2 - 1/512) is outside, so no step is accepted
    const f = (x: number[]) => {
      const v = at(x, 0);
      if (Math.abs(v - 2) > 1e-3) throw new Error('outside the table');
      return [v - 1];
    };
    const r = newton(f, [2], { tolerance: 1e-12, maxIterations: 20, maxStep: [10] });
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(1);
    expect(r.x).toEqual([2]);
  });

  it('caps each unknown at its maxStep, which must cover every unknown', () => {
    // root at 10, step cap 1: the first iterate moves exactly 1
    const r = newton((x) => [at(x, 0) - 10], [0], {
      tolerance: 1e-12,
      maxIterations: 1,
      maxStep: [1],
    });
    expect(r.x[0]).toBeCloseTo(1, 9);
    expect(() =>
      newton((x) => [at(x, 0) - 1, at(x, 1) - 1], [0, 0], {
        tolerance: 1e-12,
        maxIterations: 5,
        maxStep: [1],
      }),
    ).toThrow(RangeError);
  });

  it('takes the smallest step when none lowers the residual (escapes a flat spot)', () => {
    // |r| = x^2 + 1 has its minimum at 0 and no root: Newton jumps across, never improves on
    // some steps, and must still return a finite, non-converged result
    const r = newton((x) => [at(x, 0) ** 2 + 1], [0.5], {
      tolerance: 1e-12,
      maxIterations: 8,
      maxStep: [1],
    });
    expect(r.converged).toBe(false);
    expect(Number.isFinite(r.x[0])).toBe(true);
    expect(r.maxResidual).toBeGreaterThanOrEqual(1);
  });
});
