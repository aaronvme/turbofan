import { describe, expect, it } from 'vitest';
import { boundedLeastSquares, solveLinear } from '../../../src/cycle/boundedLeastSquares';

// The bounded least-squares solver of the D3-11 part-power fit, on problems with known answers.

describe('solveLinear', () => {
  it('solves a system that needs a row swap (zero first pivot)', () => {
    const x = solveLinear(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 1, 3],
      ],
      [7, 6, 13],
    );
    // the solution is (1, 2, 3): 0 + 4 + 3 = 7, 1 + 2 + 3 = 6, 2 + 2 + 9 = 13
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(2, 12);
    expect(x[2]).toBeCloseTo(3, 12);
  });

  it('throws on a singular matrix', () => {
    expect(() =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(/singular/);
  });
});

describe('boundedLeastSquares', () => {
  it('finds the unconstrained minimum of a linear fit when no bound is active', () => {
    // r = A x - b with the exact solution (0.3, -0.2) inside the box
    const f = (x: readonly number[]) => {
      const [a = 0, b = 0] = x;
      return [a + b - 0.1, a - b - 0.5, 2 * a + b - 0.4];
    };
    const r = boundedLeastSquares(f, [0, 0], [-1, -1], [1, 1]);
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(0.3, 6);
    expect(r.x[1]).toBeCloseTo(-0.2, 6);
    expect(r.cost).toBeLessThan(1e-12);
    expect(r.active).toEqual([0, 0]);
  });

  it('converges on the Rosenbrock valley (r = [10 (y - x^2), 1 - x])', () => {
    const f = (x: readonly number[]) => {
      const [a = 0, b = 0] = x;
      return [10 * (b - a * a), 1 - a];
    };
    const r = boundedLeastSquares(f, [-1.2, 1], [-2, -2], [2, 2], { maxIterations: 200 });
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(1, 4);
    expect(r.x[1]).toBeCloseTo(1, 4);
  });

  it('holds a variable on the bound its gradient pushes against, and reports it', () => {
    // minimum of (x - 2)^2 + (y + 3)^2 is outside the box: x sticks at 1, y at -1
    const f = (x: readonly number[]) => [(x[0] ?? 0) - 2, (x[1] ?? 0) + 3];
    const r = boundedLeastSquares(f, [0.5, 0.5], [0, -1], [1, 1]);
    expect(r.converged).toBe(true);
    expect(r.x).toEqual([1, -1]);
    expect(r.active).toEqual([1, -1]);
    // the cost still falls outward: dcost/du = (x - 2) * span < 0 at the upper bound
    expect(r.gradient[0]).toBeLessThan(0);
    expect(r.gradient[1]).toBeGreaterThan(0);
    expect(r.cost).toBeCloseTo(0.5 * (1 + 4), 12);
  });

  it('treats a failed evaluation as a rejected step and steers around it', () => {
    // the residuals cannot be evaluated for x > 0.6; the minimum (0.5) is just inside
    const f = (x: readonly number[]) => ((x[0] ?? 0) > 0.6 ? null : [(x[0] ?? 0) - 0.5]);
    const r = boundedLeastSquares(f, [0], [0], [1]);
    expect(r.converged).toBe(true);
    // to the default gradient tolerance (1e-4 in the scaled variable)
    expect(r.x[0]).toBeCloseTo(0.5, 4);
  });

  it('uses the backward difference where the forward one cannot be evaluated', () => {
    // at the start (0.6) the forward step lands where f fails
    const f = (x: readonly number[]) => ((x[0] ?? 0) > 0.6 ? null : [(x[0] ?? 0) - 0.2]);
    const r = boundedLeastSquares(f, [0.6], [0], [1]);
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(0.2, 4);
  });

  it('stops without a step when the Jacobian cannot be evaluated at all', () => {
    let calls = 0;
    const f = () => {
      calls++;
      return calls === 1 ? [1] : null;
    };
    const r = boundedLeastSquares(f, [0.5], [0], [1]);
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(0);
    expect(r.x).toEqual([0.5]);
  });

  it('is deterministic: the same start gives the same answer', () => {
    const f = (x: readonly number[]) => [Math.sin(3 * (x[0] ?? 0)) - 0.4, (x[0] ?? 0) * 0.1];
    const a = boundedLeastSquares(f, [0.1], [0], [1]);
    const b = boundedLeastSquares(f, [0.1], [0], [1]);
    expect(b).toEqual(a);
  });

  it('calls onStep after every accepted step with a falling cost', () => {
    const costs: number[] = [];
    const f = (x: readonly number[]) => [(x[0] ?? 0) - 0.7, 0.5 * ((x[1] ?? 0) - 0.1)];
    boundedLeastSquares(f, [0, 0], [-1, -1], [1, 1], { onStep: (_k, c) => costs.push(c) });
    expect(costs.length).toBeGreaterThan(0);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeLessThan(costs[i - 1] ?? Infinity);
  });

  it('rejects inconsistent inputs and a start where the residuals fail', () => {
    const f = (x: readonly number[]) => [x[0] ?? 0];
    expect(() => boundedLeastSquares(f, [0, 0], [0], [1])).toThrow(/same length/);
    expect(() => boundedLeastSquares(f, [0], [1], [1])).toThrow(/empty/);
    expect(() => boundedLeastSquares(() => null, [0], [0], [1])).toThrow(/start point/);
  });
});
