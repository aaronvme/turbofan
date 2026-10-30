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
//
// D4-84: the walk can be spread over several steps (heldRetry.ts budgets it). Its target is fixed
// when it sets out, and a solve that a stop interrupts keeps its Newton iterate and the iterations
// it has used, so a resumed walk makes the same solves, to the bit, as the walk run at once.
// Only (N1, N2, Wf) are walked: the operating conditions (a VBV switch, an ambient change) take
// their current value at every solve (W2F-N2).

import { at } from './at';
import {
  MAX_NEWTON_ITERATIONS,
  type GasPathSolution,
  type OperatingConditions,
  type SizedEngine,
  type SolveControl,
  type solveGasPath,
} from './engine';

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

/** Where a matched solve is wanted: speeds and fuel flow. */
export interface GasPathTarget {
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly wfKgPerS: number;
}

/** A converged matched point: its speeds, fuel flow and the six gas unknowns. */
export interface GasPathAnchor extends GasPathTarget {
  readonly x: readonly number[];
}

/** Why the last attempt of a lost solve failed (W2F-I1): set by solveMatched when it returns null. */
export interface SolveFailure {
  cause: string | null;
}

type Attempted =
  | { readonly kind: 'solved'; readonly solution: GasPathSolution }
  | { readonly kind: 'refused' }
  | { readonly kind: 'stopped'; readonly solution: GasPathSolution };

/**
 * A solution the transient may use: converged, and on a physical root (the bypass ratio, unknown
 * 1, above 1; a root with it near zero exists and is not the engine). A solver that throws (a
 * thermo state out of range, or a programming error) has no solution there. The reason a solution
 * is refused goes into `why` (W2F-I1), so a lost solve keeps its cause: a thrown error by its
 * name and message, so a TypeError cannot pass for a physical loss. A solve its control stopped
 * (D4-84) is neither: it was interrupted, not refused.
 */
function attempt(f: () => GasPathSolution, why: SolveFailure): Attempted {
  try {
    const s = f();
    if (s.stopped === true) return { kind: 'stopped', solution: s };
    if (!(s.maxResidual < ACCEPTED_RESIDUAL)) {
      why.cause = `residual ${Number(s.maxResidual.toPrecision(3))} not below ${ACCEPTED_RESIDUAL.toExponential()}`;
      return { kind: 'refused' };
    }
    const bpr = at(s.x, 1);
    if (!(bpr > 1)) {
      why.cause = `non-physical root (BPR ${Number(bpr.toPrecision(3))})`;
      return { kind: 'refused' };
    }
    return { kind: 'solved', solution: s };
  } catch (e) {
    why.cause = e instanceof Error ? `${e.name}: ${e.message}` : `threw ${String(e)}`;
    return { kind: 'refused' };
  }
}

/**
 * The matched solve at the target, warm-started on the anchor (no walk). null when it is refused
 * or `stop` interrupts it; a stopped solve is abandoned (the next step's target is elsewhere), and
 * if nothing else said why, `why.cause` says that the budget stopped it.
 */
export function solveDirect(
  solve: GasPathSolver,
  e: SizedEngine,
  c: OperatingConditions,
  anchor: GasPathAnchor,
  t: GasPathTarget,
  why: SolveFailure,
  stop?: () => boolean,
): GasPathSolution | null {
  const control: SolveControl | undefined = stop === undefined ? undefined : { stop };
  const r = attempt(() => solve(e, c, t.n1Rpm, t.n2Rpm, t.wfKgPerS, anchor.x, true, control), why);
  if (r.kind === 'solved') return r.solution;
  if (r.kind === 'stopped') {
    why.cause ??= `not converged within the held-retry budget (residual ${Number(r.solution.maxResidual.toPrecision(3))} after ${r.solution.iterations} iterations)`;
  }
  return null;
}

/**
 * A continuation walk in flight (D4-84): the straight path in (N1, N2, Wf) from `origin` to a
 * `target` fixed when the walk set out, how far it has converged, and its next step.
 */
export interface ContinuationWalk {
  /** The converged point the walk set out from. */
  readonly origin: GasPathAnchor;
  readonly target: GasPathTarget;
  /** The fraction of the path converged so far, and its unknowns. */
  readonly done: number;
  readonly x: readonly number[];
  /** The next step, as a fraction of the path. */
  readonly step: number;
  /** Solves finished (MAX_CONTINUATION_SOLVES bounds a walk however many steps it spans). */
  readonly solves: number;
  /** A solve its stop interrupted: its Newton iterate and the iterations it has used. */
  readonly paused: { readonly x: readonly number[]; readonly iterations: number } | null;
}

export type WalkOutcome =
  | { readonly kind: 'solved'; readonly solution: GasPathSolution }
  | { readonly kind: 'lost' }
  | { readonly kind: 'paused'; readonly walk: ContinuationWalk };

/** A walk from the anchor to the target, its first step half the path. */
export function startWalk(anchor: GasPathAnchor, target: GasPathTarget): ContinuationWalk {
  return { origin: anchor, target, done: 0, x: anchor.x, step: 0.5, solves: 0, paused: null };
}

/**
 * Walks on until the target converges ('solved'), the walk is lost, or `stop` fires ('paused':
 * resume it with the walk returned). Without a stop the walk runs to its end.
 */
export function advanceWalk(
  solve: GasPathSolver,
  e: SizedEngine,
  c: OperatingConditions,
  walk: ContinuationWalk,
  why: SolveFailure,
  stop?: () => boolean,
): WalkOutcome {
  const { origin: a, target: t } = walk;
  let { done, step, x, solves, paused } = walk;
  while (solves < MAX_CONTINUATION_SOLVES) {
    if (stop?.() === true) {
      return { kind: 'paused', walk: { ...walk, done, step, x, solves, paused } };
    }
    const f = Math.min(1, done + step);
    // the last step lands on the target exactly
    const along = (from: number, to: number) => (f === 1 ? to : from + f * (to - from));
    // a resumed solve goes on from its iterate with the iterations it has left
    const used = paused?.iterations ?? 0;
    const control: SolveControl | undefined =
      stop === undefined && used === 0
        ? undefined
        : { stop, ...(used > 0 ? { maxIterations: MAX_NEWTON_ITERATIONS - used } : {}) };
    const guess = paused?.x ?? x;
    const r = attempt(
      () =>
        solve(
          e,
          c,
          along(a.n1Rpm, t.n1Rpm),
          along(a.n2Rpm, t.n2Rpm),
          along(a.wfKgPerS, t.wfKgPerS),
          guess,
          true,
          control,
        ),
      why,
    );
    if (r.kind === 'stopped') {
      const resume = { x: r.solution.x, iterations: used + r.solution.iterations };
      return { kind: 'paused', walk: { ...walk, done, step, x, solves, paused: resume } };
    }
    paused = null;
    solves++;
    if (r.kind === 'refused') {
      step /= 2;
      if (step < MIN_CONTINUATION_STEP) return { kind: 'lost' };
      continue;
    }
    if (f === 1) return { kind: 'solved', solution: r.solution };
    done = f;
    x = r.solution.x;
    step *= 2;
  }
  return { kind: 'lost' };
}

/**
 * The matched solve at (n1, n2, wf), warm-started on the anchor; if that fails, by continuation
 * from the anchor (the first step half the path), run to its end. null when the solve is lost
 * (D4-13); then `why.cause` says why its last attempt failed (W2F-I1).
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
  const target: GasPathTarget = { n1Rpm, n2Rpm, wfKgPerS };
  const direct = solveDirect(solve, e, c, anchor, target, why);
  if (direct !== null) return direct;
  const w = advanceWalk(solve, e, c, startWalk(anchor, target), why);
  return w.kind === 'solved' ? w.solution : null;
}
