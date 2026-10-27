// D4-13: the transient's matched solve, warm-started and, when that fails, entered by continuation
// from the last converged point (src/cycle/matchedSolve.ts). The failing case is the reference
// engine's own start: Newton from the reset's idle unknowns at 57 % N2 (w2/followups probe).
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { at } from '../../../src/cycle/at';
import {
  groundIdle,
  solveGasPath,
  type GasPathSolution,
  type OperatingConditions,
} from '../../../src/cycle/engine';
import {
  ACCEPTED_RESIDUAL,
  CONTINUATION_STEPS,
  solveMatched,
  type GasPathAnchor,
  type GasPathSolver,
} from '../../../src/cycle/matchedSolve';
import { factValue } from '../../../src/engine/facts';
import { REF, lazy } from './fixtures';

const C: OperatingConditions = { ambient: ISA_SLS, customerBleedFraction: 0, powerExtractionW: 0 };
const idle = lazy(() => groundIdle(REF, C));
/** The steady ground-idle point as the last converged point (what a reset leaves). */
const idleAnchor = (): GasPathAnchor => ({
  n1Rpm: idle().point.n1Rpm,
  n2Rpm: idle().point.n2Rpm,
  wfKgPerS: idle().point.fuelFlowKgPerS,
  x: idle().unknowns.slice(0, 6),
});
/** A start at the sub-idle switch: 18.54 % N1, 57.02 % N2, 0.0783 kg/s of start fuel. */
const START = {
  n1Rpm: 0.1854 * factValue('n1ReferenceRpm'),
  n2Rpm: 0.5702 * factValue('n2ReferenceRpm'),
  wf: 0.0783,
};

/** The reference solver, recording the (n2, wf) of each call. */
function recording(inner: GasPathSolver = solveGasPath) {
  const calls: { n2Rpm: number; wf: number }[] = [];
  const solver: GasPathSolver = (e, c, n1, n2, wf, guess, lit) => {
    calls.push({ n2Rpm: n2, wf });
    return inner(e, c, n1, n2, wf, guess, lit);
  };
  return { calls, solver };
}

describe('D4-13: the matched solve with a continuation entry', () => {
  it("a start's 57 % N2: Newton from the idle unknowns fails, the continuation converges", () => {
    const direct = solveGasPath(REF, C, START.n1Rpm, START.n2Rpm, START.wf, idleAnchor().x);
    expect(direct.maxResidual).toBeGreaterThan(ACCEPTED_RESIDUAL);
    const { calls, solver } = recording();
    const s = solveMatched(solver, REF, C, idleAnchor(), START.n1Rpm, START.n2Rpm, START.wf);
    expect(s).not.toBeNull();
    expect(s?.maxResidual ?? Infinity).toBeLessThan(ACCEPTED_RESIDUAL);
    // on the engine's branch: the idle bypass ratio is about 6
    expect(at(s?.x ?? [], 1)).toBeGreaterThan(5);
    expect(s?.point.n2Rpm).toBe(START.n2Rpm);
    expect(s?.point.fuelFlowKgPerS).toBe(START.wf);
    // the direct try, then CONTINUATION_STEPS steps ending on the target
    expect(calls.length).toBe(1 + CONTINUATION_STEPS);
    const walk = calls.slice(1);
    for (let k = 1; k < walk.length; k++) {
      expect(at(walk, k).n2Rpm).toBeLessThan(at(walk, k - 1).n2Rpm);
    }
    expect(at(walk, 0).n2Rpm).toBeCloseTo(
      idleAnchor().n2Rpm + (START.n2Rpm - idleAnchor().n2Rpm) / CONTINUATION_STEPS,
      6,
    );
    expect(at(walk, walk.length - 1)).toEqual({ n2Rpm: START.n2Rpm, wf: START.wf });
  });

  it('a direct solve that converges is used as it is, without a walk', () => {
    const a = idleAnchor();
    const { calls, solver } = recording();
    const s = solveMatched(solver, REF, C, a, a.n1Rpm, 1.001 * a.n2Rpm, a.wfKgPerS);
    expect(calls.length).toBe(1);
    expect(s?.maxResidual ?? Infinity).toBeLessThan(ACCEPTED_RESIDUAL);
  });

  it('a step that fails ends the walk: the solve is lost (null)', () => {
    let n = 0;
    // converges on the direct try's guess never, and on the third walk step never again
    const failing: GasPathSolver = (...args) => {
      n++;
      const s = solveGasPath(...args);
      return n === 1 || n >= 4 ? { ...s, maxResidual: 1, converged: false } : s;
    };
    const { calls, solver } = recording(failing);
    const s = solveMatched(solver, REF, C, idleAnchor(), START.n1Rpm, START.n2Rpm, START.wf);
    expect(s).toBeNull();
    expect(calls.length).toBe(4);
  });

  it('a solver that throws (a thermo state out of range) is a lost solve, not an exception', () => {
    const throwing: GasPathSolver = () => {
      throw new Error('enthalpy -4e5 is outside the range');
    };
    const a = idleAnchor();
    expect(solveMatched(throwing, REF, C, a, a.n1Rpm, a.n2Rpm, a.wfKgPerS)).toBeNull();
  });

  it('a converged root with a bypass ratio of 1 or less is not accepted', () => {
    const a = idleAnchor();
    const root =
      (bpr: number): GasPathSolver =>
      (...args) => {
        const s: GasPathSolution = solveGasPath(...args);
        return { ...s, x: s.x.map((v, i) => (i === 1 ? bpr : v)) };
      };
    expect(solveMatched(root(1), REF, C, a, a.n1Rpm, a.n2Rpm, a.wfKgPerS)).toBeNull();
    expect(solveMatched(root(1.01), REF, C, a, a.n1Rpm, a.n2Rpm, a.wfKgPerS)).not.toBeNull();
  });

  it('accepts a residual just under ACCEPTED_RESIDUAL and rejects one at it', () => {
    const a = idleAnchor();
    const withResidual =
      (r: number): GasPathSolver =>
      (...args) => ({
        ...solveGasPath(...args),
        maxResidual: r,
      });
    expect(ACCEPTED_RESIDUAL).toBe(1e-6);
    const at1 = solveMatched(
      withResidual(ACCEPTED_RESIDUAL),
      REF,
      C,
      a,
      a.n1Rpm,
      a.n2Rpm,
      a.wfKgPerS,
    );
    expect(at1).toBeNull();
    const under = solveMatched(
      withResidual(0.99 * ACCEPTED_RESIDUAL),
      REF,
      C,
      a,
      a.n1Rpm,
      a.n2Rpm,
      a.wfKgPerS,
    );
    expect(under).not.toBeNull();
  });
});
