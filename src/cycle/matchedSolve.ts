// The transient's matched gas-path solve (D4-13). Each solve is warm-started on the last converged
// unknowns. When the engine comes up from the sub-idle model (a start, a relight) those are still
// the reset's: Newton from them can fail outright at N2 57-61 % on the reference engine (it stops
// at its first iteration), although the solution exists and lies on the branch through the last
// converged point. So a failed direct solve is retried along a straight path in (N1, N2, Wf) from
// that point to the target, each step warm-started on the one before (natural continuation). Only
// when that fails too is the solve lost, and the model holds its last converged gas path.

import { at } from './at';
import type { GasPathSolution, OperatingConditions, SizedEngine, solveGasPath } from './engine';

/** A solve is accepted at this max residual (MATCH_TOLERANCE is Newton's target). */
export const ACCEPTED_RESIDUAL = 1e-6;
/** Continuation steps from the last converged point to the target. */
export const CONTINUATION_STEPS = 10;

export type GasPathSolver = typeof solveGasPath;

/** A converged matched point: its speeds, fuel flow and the six gas unknowns. */
export interface GasPathAnchor {
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly wfKgPerS: number;
  readonly x: readonly number[];
}

/**
 * A solution the transient may use: converged, and on a physical root (the bypass ratio, unknown
 * 1, above 1; a root with it near zero exists and is not the engine). A solver that throws (a
 * thermo state out of range) has no solution there.
 */
function attempt(f: () => GasPathSolution): GasPathSolution | null {
  try {
    const s = f();
    return s.maxResidual < ACCEPTED_RESIDUAL && at(s.x, 1) > 1 ? s : null;
  } catch {
    return null;
  }
}

/**
 * The matched solve at (n1, n2, wf), warm-started on the anchor; if that fails, by continuation
 * from the anchor in `steps` steps. null when the solve is lost (D4-13).
 */
export function solveMatched(
  solve: GasPathSolver,
  e: SizedEngine,
  c: OperatingConditions,
  anchor: GasPathAnchor,
  n1Rpm: number,
  n2Rpm: number,
  wfKgPerS: number,
  steps = CONTINUATION_STEPS,
): GasPathSolution | null {
  // TDD stub: the direct solve only, no walk of the given steps
  return steps > 0 ? attempt(() => solve(e, c, n1Rpm, n2Rpm, wfKgPerS, anchor.x)) : null;
}
