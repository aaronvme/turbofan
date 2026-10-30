// The transient's matched gas-path solve (D4-13). Each solve is warm-started on the last converged
// unknowns. When the engine comes up from the sub-idle model (a start, a relight) those are still
// the reset's idle point, and Newton from them stops at its first iteration below about 60.6 % N2
// on the reference engine: at the idle unknowns one residual no longer depends on any unknown
// there (a map edge), so the Jacobian is singular, although the solution exists a little further
// along the branch through the idle point. So a failed direct solve is retried along a straight
// path in (N1, N2, Wf) from the last converged point to the target, each step warm-started on the
// one before (natural continuation), the step halved on a failure and doubled after a success.
// Only when the step falls below MIN_CONTINUATION_STEP, or the solves run out, is the solve lost,
// and the model holds its last converged gas path.

import { at } from './at';
import type { GasPathSolution, OperatingConditions, SizedEngine, solveGasPath } from './engine';

/** A solve is accepted at this max residual (MATCH_TOLERANCE is Newton's target). */
export const ACCEPTED_RESIDUAL = 1e-6;
/**
 * The smallest continuation step, as a fraction of the path (2^-8). A flameout relight entering the
 * matched model at 57 % N2 with the idle floor's wound-up fuel (65 % above idle) needs a first step
 * of about 1/100 of the way from the idle point; the start's entry about 1/12.
 */
export const MIN_CONTINUATION_STEP = 1 / 256;
/** Most solves one continuation may use. */
export const MAX_CONTINUATION_SOLVES = 64;

export type GasPathSolver = typeof solveGasPath;

/** A converged matched point: its speeds, fuel flow and the six gas unknowns. */
export interface GasPathAnchor {
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly wfKgPerS: number;
  readonly x: readonly number[];
}

/** Why the last attempt of a lost solve failed (W2F-I1): set by solveMatched when it returns null. */
export interface SolveFailure {
  cause: string | null;
}

/**
 * A solution the transient may use: converged, and on a physical root (the bypass ratio, unknown
 * 1, above 1; a root with it near zero exists and is not the engine). A solver that throws (a
 * thermo state out of range, or a programming error) has no solution there. The reason a solution
 * is refused goes into `why` (W2F-I1), so a lost solve keeps its cause: a thrown error by its
 * name and message, so a TypeError cannot pass for a physical loss.
 */
function attempt(f: () => GasPathSolution, why: SolveFailure): GasPathSolution | null {
  try {
    const s = f();
    if (!(s.maxResidual < ACCEPTED_RESIDUAL)) {
      why.cause = `residual ${Number(s.maxResidual.toPrecision(3))} not below ${ACCEPTED_RESIDUAL.toExponential()}`;
      return null;
    }
    const bpr = at(s.x, 1);
    if (!(bpr > 1)) {
      why.cause = `non-physical root (BPR ${Number(bpr.toPrecision(3))})`;
      return null;
    }
    return s;
  } catch (e) {
    why.cause = e instanceof Error ? `${e.name}: ${e.message}` : `threw ${String(e)}`;
    return null;
  }
}

/**
 * The matched solve at (n1, n2, wf), warm-started on the anchor; if that fails, by continuation
 * from the anchor (the first step half the path). null when the solve is lost (D4-13); then
 * `why.cause` says why its last attempt failed (W2F-I1).
 */
export function solveMatched(
  solve: GasPathSolver,
  e: SizedEngine,
  c: OperatingConditions,
  anchor: GasPathAnchor,
  n1Rpm: number,
  n2Rpm: number,
  wfKgPerS: number,
  why: SolveFailure = { cause: null },
): GasPathSolution | null {
  const direct = attempt(() => solve(e, c, n1Rpm, n2Rpm, wfKgPerS, anchor.x), why);
  if (direct !== null) return direct;
  let done = 0;
  let step = 0.5;
  let x = anchor.x;
  for (let solves = 0; solves < MAX_CONTINUATION_SOLVES; solves++) {
    const f = Math.min(1, done + step);
    // the last step lands on the target exactly
    const along = (from: number, to: number) => (f === 1 ? to : from + f * (to - from));
    const guess = x;
    const s = attempt(
      () =>
        solve(
          e,
          c,
          along(anchor.n1Rpm, n1Rpm),
          along(anchor.n2Rpm, n2Rpm),
          along(anchor.wfKgPerS, wfKgPerS),
          guess,
        ),
      why,
    );
    if (s === null) {
      step /= 2;
      if (step < MIN_CONTINUATION_STEP) return null;
      continue;
    }
    if (f === 1) return s;
    done = f;
    x = s.x;
    step *= 2;
  }
  return null;
}
