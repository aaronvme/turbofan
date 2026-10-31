// D4-13: the transient's matched solve, warm-started and, when that fails, entered by continuation
// from the last converged point (src/cycle/matchedSolve.ts). The failing case is the reference
// engine's own start: Newton from the reset's idle unknowns at 57 % N2 (w2/followups probe).
import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import type { StationId } from '../../../src/contracts/stations';
import { at } from '../../../src/cycle/at';
import {
  groundIdle,
  solveGasPath,
  type GasPathSolution,
  type OperatingConditions,
} from '../../../src/cycle/engine';
import {
  ACCEPTED_RESIDUAL,
  MAX_CONTINUATION_SOLVES,
  MIN_CONTINUATION_STEP,
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

/** Where a call sits on the path from the idle anchor to START, 0..1 (from its N2). */
const fractionOf = (k: { n2Rpm: number }) =>
  (k.n2Rpm - idleAnchor().n2Rpm) / (START.n2Rpm - idleAnchor().n2Rpm);
/** A solve that did not converge. */
const lost: GasPathSolver = () => ({ ...converged(), maxResidual: 1, converged: false });
/** A converged solve (the idle point's, only its acceptance matters here). */
const converged = (): GasPathSolution => ({
  point: idle().point,
  x: idleAnchor().x,
  iterations: 1,
  converged: true,
  maxResidual: 0,
});

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
    // the direct try, then the walk from half the path, which ends on the target exactly
    expect(calls.length).toBeLessThanOrEqual(1 + MAX_CONTINUATION_SOLVES);
    expect(fractionOf(at(calls, 1))).toBeCloseTo(0.5, 9);
    expect(at(calls, calls.length - 1)).toEqual({ n2Rpm: START.n2Rpm, wf: START.wf });
    expect(s?.point.n2Rpm).toBe(START.n2Rpm);
    expect(s?.point.fuelFlowKgPerS).toBe(START.wf);
  });

  it('a direct solve that converges is used as it is, without a walk', () => {
    const a = idleAnchor();
    const { calls, solver } = recording();
    const s = solveMatched(solver, REF, C, a, a.n1Rpm, 1.001 * a.n2Rpm, a.wfKgPerS);
    expect(calls.length).toBe(1);
    expect(s?.maxResidual ?? Infinity).toBeLessThan(ACCEPTED_RESIDUAL);
  });

  it('a failed step halves the step down to MIN_CONTINUATION_STEP, then the solve is lost', () => {
    const { calls, solver } = recording(lost);
    expect(solveMatched(solver, REF, C, idleAnchor(), START.n1Rpm, START.n2Rpm, START.wf)).toBe(
      null,
    );
    // the direct try, then 1/2, 1/4, ... down to 1/256 of the path
    expect(MIN_CONTINUATION_STEP).toBe(1 / 256);
    expect(calls.slice(1).map((k) => fractionOf(k))).toEqual(
      [1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64, 1 / 128, 1 / 256].map(
        (f) => expect.closeTo(f, 9) as number,
      ),
    );
  });

  it('a step that converges doubles the next one', () => {
    let n = 0;
    // the direct try and the half-way step fail, everything after converges
    const solver = recording((...args) => (++n <= 2 ? lost(...args) : converged()));
    const s = solveMatched(solver.solver, REF, C, idleAnchor(), START.n1Rpm, START.n2Rpm, START.wf);
    expect(s).not.toBeNull();
    expect(solver.calls.map((k) => fractionOf(k))).toEqual(
      [1, 1 / 2, 1 / 4, 3 / 4, 1].map((f) => expect.closeTo(f, 9) as number),
    );
  });

  it('the walk ends on the target exactly, not on anchor + 1 x (target - anchor)', () => {
    // 0.7 + (0.1 - 0.7) is 0.09999999999999998 in floating point
    expect(0.7 + 1 * (0.1 - 0.7)).not.toBe(0.1);
    const anchor: GasPathAnchor = { n1Rpm: 0.7, n2Rpm: 0.7, wfKgPerS: 0.7, x: idleAnchor().x };
    let n = 0;
    const calls: number[][] = [];
    const solver: GasPathSolver = (_e, _c, n1, n2, wf) => {
      calls.push([n1, n2, wf]);
      return ++n === 1 ? lost(_e, _c, n1, n2, wf, []) : converged();
    };
    expect(solveMatched(solver, REF, C, anchor, 0.1, 0.1, 0.1)).not.toBeNull();
    // the direct try, half way, then the target
    expect(calls.length).toBe(3);
    expect(calls[2]).toEqual([0.1, 0.1, 0.1]);
  });

  it('a walk that only creeps runs out of solves: lost after MAX_CONTINUATION_SOLVES', () => {
    // converges only on steps of at most the minimum, so the step never grows past 2x the minimum
    let done = 0;
    const creeping: GasPathSolver = (...args) => {
      const f = fractionOf({ n2Rpm: args[3] });
      if (f - done > MIN_CONTINUATION_STEP + 1e-9) return lost(...args);
      done = f;
      return converged();
    };
    const { calls, solver } = recording(creeping);
    expect(MAX_CONTINUATION_SOLVES).toBe(64);
    expect(solveMatched(solver, REF, C, idleAnchor(), START.n1Rpm, START.n2Rpm, START.wf)).toBe(
      null,
    );
    expect(calls.length).toBe(1 + MAX_CONTINUATION_SOLVES);
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(1);
  });

  it('a solver that throws (a thermo state out of range) is a lost solve, not an exception', () => {
    const throwing: GasPathSolver = () => {
      throw new Error('enthalpy -4e5 is outside the range');
    };
    const a = idleAnchor();
    expect(solveMatched(throwing, REF, C, a, a.n1Rpm, a.n2Rpm, a.wfKgPerS)).toBeNull();
  });

  it('a solver that throws something other than an Error is lost with what it threw', () => {
    const throwing: GasPathSolver = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
      throw 'boom';
    };
    const a = idleAnchor();
    const why = { cause: null as string | null };
    expect(solveMatched(throwing, REF, C, a, a.n1Rpm, a.n2Rpm, a.wfKgPerS, why)).toBeNull();
    expect(why.cause).toBe('threw boom');
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

  // D4-94 (W2H-B1/I3): after a long hold the matched path followed a branch on which the booster
  // cools the flow (T25 below T2 by up to 61 K at ISA, 82 K at ISA+30); the residual and BPR alone
  // accepted it. A compressor whose total temperature does not rise is not the engine.
  const COMPRESSORS = [
    // name, its exit stations (the booster's 24 and the HPC inlet 25 carry the same Tt), its inlet
    ['fan bypass', ['13'], '2'],
    ['fan core', ['21'], '2'],
    ['booster', ['24', '25'], '21'],
    ['HPC', ['3'], '25'],
  ] as const satisfies readonly (readonly [string, readonly StationId[], StationId])[];

  it.each(COMPRESSORS)(
    'D4-94: a root whose %s total-temperature rise is 0 or less is refused, with its cause',
    (name, exits, inlet) => {
      const a = idleAnchor();
      /** The reference root with the compressor's exit Tt set dK above its inlet's. */
      const rise =
        (dK: number): GasPathSolver =>
        (...args) => {
          const s = solveGasPath(...args);
          const st = { ...s.point.stations };
          for (const id of exits) st[id] = { ...st[id], ttK: st[inlet].ttK + dK };
          return { ...s, point: { ...s.point, stations: st } };
        };
      for (const dK of [0, -61]) {
        const why = { cause: null as string | null };
        expect(solveMatched(rise(dK), REF, C, a, a.n1Rpm, a.n2Rpm, a.wfKgPerS, why)).toBeNull();
        expect(why.cause).toBe(`non-physical root (${name} total-temperature rise ${dK} K)`);
      }
      expect(solveMatched(rise(0.01), REF, C, a, a.n1Rpm, a.n2Rpm, a.wfKgPerS)).not.toBeNull();
    },
  );

  it('D4-94: the reference roots raise the total temperature across every compressor', () => {
    const a = idleAnchor();
    const s = solveMatched(solveGasPath, REF, C, a, START.n1Rpm, START.n2Rpm, START.wf);
    expect(s).not.toBeNull();
    for (const p of [idle().point, REF.design.point, s?.point]) {
      for (const [, exits, inlet] of COMPRESSORS) {
        for (const id of exits) {
          expect(p?.stations[id].ttK).toBeGreaterThan(p?.stations[inlet].ttK ?? Infinity);
        }
      }
    }
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
