// D4-84: the retry of a lost matched gas-path solve, bounded per step so that a held frame stays
// inside the 16.7 ms frame budget. W2F-N5: on the part-power fit's 1 s lever ramp a held step cost
// 411-602 ms in the worker (452 ms in Node) against 1.7-3.6 ms matched, because every held
// snapshot retried the direct solve and the whole halving walk, and a failing solve runs Newton to
// C7's 25 iterations (about 360 gas-path evaluations).
//
// - (a) The direct solve, warm-started on the last converged point, is tried every step. The
//   continuation walk (matchedSolve.ts) sets out at most once per WALK_INTERVAL_S of sim time;
//   between walks the model holds.
// - (b) The retry spends a per-step work budget, metered by a monotone count (gas-path evaluations
//   by default: deterministic, and close to the CPU time). Newton stops between iterations once it
//   is spent, so a step overshoots it by at most RETRY_OVERSHOOT. A walk the budget interrupts
//   resumes on the next step where it stopped: its target is fixed when it sets out, so a walk spread
//   over several steps converges on the same root, to the bit, as the walk run at once. While a walk
//   is in flight the direct solve gets DIRECT_SHARE of the budget, so the walk always moves on.
// - The matched path is unchanged: a direct solve that converges is not charged while the model is
//   not holding, and the budget (1.5x the largest converged direct solve in the cycle suite) never
//   cuts one. Only a failed direct solve and the walk spend the budget; once the model holds,
//   everything does, so a step that starts held costs at most the budget plus one Newton iteration.
// - Not budgeted: the model's entry from the sub-idle similarity model (a start, a relight) keeps
//   D4-13's whole walk in one snapshot (model.ts), since it is not a held retry.

import type { GasPathSolution, OperatingConditions, SizedEngine } from './engine';
import {
  advanceWalk,
  solveDirect,
  startWalk,
  type ContinuationWalk,
  type GasPathAnchor,
  type GasPathSolver,
  type GasPathTarget,
  type SolveFailure,
} from './matchedSolve';

/**
 * Retry work one step may spend, in gas-path evaluations. It is 1.5x the largest converged direct
 * solve in the whole cycle suite (77 evaluations, 10 Newton iterations; an instrumented run on
 * 2026-10-30), so the budget never cuts the matched path; a held step then costs 120-137
 * evaluations, about 3-8 ms at the 0.025-0.055 ms per evaluation measured in Node on the shared
 * machine (tools/cycle/held-cost.ts), beside the 2-4 ms matched step and well inside 16.7 ms.
 */
export const HELD_RETRY_BUDGET = 120;
/** D4-84 (a): sim time between the starts of two continuation walks, s. */
export const WALK_INTERVAL_S = 0.5;
/** The share of the budget the direct solve may spend while a walk is in flight. */
export const DIRECT_SHARE = 0.5;
/**
 * The most evaluations a stop lets through past the budget: the Newton iteration in flight (6
 * finite differences and at most 10 line-search evaluations, newton.ts) and the solve's final
 * evaluation of its point (solveGasPath).
 */
export const RETRY_OVERSHOOT = 17;

/** How the retry is bounded (CycleModelOptions.heldRetry). */
export interface RetryPolicy {
  /** Retry work one step may spend, in meter units. */
  readonly budget: number;
  /** Sim time between the starts of two continuation walks, s. */
  readonly walkIntervalS: number;
  /**
   * A monotone work count, read as a difference: gas-path evaluations by default. A test can count
   * its own double's work; a host could pass a clock with a budget in ms (not deterministic).
   */
  readonly meter: () => number;
}

/** D4-13's retry, unbounded: the whole walk on every lost snapshot (a test and tool reference). */
export const UNBOUNDED_RETRY = { budget: Infinity, walkIntervalS: 0 } as const satisfies Partial<
  Omit<RetryPolicy, 'meter'>
>;

/** What the retry carries from one snapshot to the next. */
export interface RetryState {
  /** The walk in flight, if any. */
  readonly walk: ContinuationWalk | null;
  /** Sim time the last walk set out, s (null: none since the reset). */
  readonly walkStartedS: number | null;
}

export const NO_RETRY: RetryState = { walk: null, walkStartedS: null };

/** A walk that converged on its own (older) target: the model moves its anchor there. */
export interface ReachedPoint {
  readonly anchor: GasPathAnchor;
  readonly solution: GasPathSolution;
}

export type RetryOutcome =
  | { readonly kind: 'matched'; readonly solution: GasPathSolution; readonly state: RetryState }
  | { readonly kind: 'held'; readonly state: RetryState; readonly reached: ReachedPoint | null };

/** The retry work a step has spent so far (the model resets it at each step). */
export interface StepSpend {
  spent: number;
}

export interface RetryArgs {
  readonly solve: GasPathSolver;
  readonly e: SizedEngine;
  readonly c: OperatingConditions;
  /** The last converged point (the warm start, and where a walk sets out). */
  readonly anchor: GasPathAnchor;
  /** The current state. */
  readonly target: GasPathTarget;
  /** Sim time, s. */
  readonly tS: number;
  /** True while the model holds its gas path (the last snapshot was lost). */
  readonly holding: boolean;
  readonly policy: RetryPolicy;
  readonly spend: StepSpend;
  readonly state: RetryState;
  readonly why: SolveFailure;
}

const sameTarget = (a: GasPathTarget, b: GasPathTarget) =>
  a.n1Rpm === b.n1Rpm && a.n2Rpm === b.n2Rpm && a.wfKgPerS === b.wfKgPerS;

/** One snapshot's matched solve under the D4-84 bounds (see the header). */
export function retryMatched(a: RetryArgs): RetryOutcome {
  const { policy, spend, state } = a;
  const stopAt = (cap: number) => {
    const m0 = policy.meter();
    return {
      stop: () => spend.spent + (policy.meter() - m0) >= cap,
      charge: () => (spend.spent += policy.meter() - m0),
    };
  };

  // (a) the direct solve, every step
  const directCap = (state.walk === null ? 1 : DIRECT_SHARE) * policy.budget;
  if (spend.spent < directCap) {
    const m = stopAt(directCap);
    const s = solveDirect(a.solve, a.e, a.c, a.anchor, a.target, a.why, m.stop);
    if (s === null || a.holding) m.charge();
    if (s !== null) {
      return { kind: 'matched', solution: s, state: { ...state, walk: null } };
    }
  }

  // (a) a walk sets out at most once per walkIntervalS; (b) one in flight resumes
  let walk = state.walk;
  let walkStartedS = state.walkStartedS;
  if (walk === null && (walkStartedS === null || a.tS - walkStartedS >= policy.walkIntervalS)) {
    walk = startWalk(a.anchor, a.target);
    walkStartedS = a.tS;
  }
  if (walk === null || spend.spent >= policy.budget) {
    return { kind: 'held', state: { walk, walkStartedS }, reached: null };
  }
  const m = stopAt(policy.budget);
  const w = advanceWalk(a.solve, a.e, a.c, walk, a.why, m.stop);
  m.charge();
  if (w.kind === 'paused') {
    return { kind: 'held', state: { walk: w.walk, walkStartedS }, reached: null };
  }
  const ended: RetryState = { walk: null, walkStartedS };
  if (w.kind === 'lost') return { kind: 'held', state: ended, reached: null };
  if (sameTarget(walk.target, a.target)) {
    return { kind: 'matched', solution: w.solution, state: ended };
  }
  return {
    kind: 'held',
    state: ended,
    reached: { anchor: { ...walk.target, x: w.solution.x }, solution: w.solution },
  };
}
