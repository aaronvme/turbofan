// How many solver iterations a frame gets (decision D4-2 (b), docs/reviews/LOG.md): the solver's
// per-frame GPU budget is min(5 ms, 15 ms - measured render - measured flow visuals), with a floor
// of 2 iterations per frame, and L13's 7 ms is the hard ceiling. The cost per iteration comes from
// timestamp queries, which resolve a few frames late, so it is a moving average. The frame's own
// resample pass (prim + ghost + the texture resample, ~0.64 ms on the Arc 140T) is part of the
// solver's GPU time per frame: the iterations get the budget and the ceiling less its measured
// average (W2S-A-I4, W2S-B-I3).
import type { StepBudget } from '../../contracts/flow';
import { THRESHOLDS } from '../../contracts/thresholds';

export const SOLVER_BUDGET = {
  /** D4-2: the solver's cap at the default preset, ms. */
  capMs: 5,
  /** D4-2: render + solver + flow visuals share 15 ms of the 16.7 ms frame. */
  frameMs: 15,
  /** D4-2: at least this many iterations per frame (settling speed). */
  floorIterations: 2,
  /** L13: the solver never plans more GPU time than this per frame, floor included. */
  hardCeilingMs: THRESHOLDS.L13.values.maxSolverFrameMs.value,
} as const;

const measured = (ms: number | null): number =>
  ms !== null && Number.isFinite(ms) && ms >= 0 ? ms : 0;

/**
 * D4-2: the solver's GPU budget for the next frame, ms, from the measured render and flow-visual
 * GPU times (null, non-finite or negative: not measured yet, counted as 0). Never above the
 * L13 ceiling, never below 0.
 */
export function solverBudgetMs(m: {
  readonly renderMs: number | null;
  readonly flowVisualsMs: number | null;
}): number {
  const left = SOLVER_BUDGET.frameMs - measured(m.renderMs) - measured(m.flowVisualsMs);
  return Math.min(SOLVER_BUDGET.hardCeilingMs, Math.max(0, Math.min(SOLVER_BUDGET.capMs, left)));
}

export interface SchedulerOptions {
  /** Weight of a new sample in the moving average of ms per iteration, in (0, 1]. */
  readonly smoothing?: number;
}

export class IterationScheduler {
  private readonly smoothing: number;
  private average: number | null = null;
  private resample: number | null = null;

  constructor(opts: SchedulerOptions = {}) {
    const a = opts.smoothing ?? 0.2;
    if (!(a > 0 && a <= 1)) throw new Error(`smoothing ${a} must be in (0, 1]`);
    this.smoothing = a;
  }

  /** The moving average of the measured GPU time per iteration, ms (null before a sample). */
  get msPerIteration(): number | null {
    return this.average;
  }

  /** The moving average of the frame's resample pass, ms (null before a sample). */
  get resampleMs(): number | null {
    return this.resample;
  }

  /**
   * A measured frame: `iterations` iterations took `gpuMs` of GPU time and the frame's resample
   * `resampleMs` (bad samples of either are ignored; a frame of 0 iterations still measures the
   * resample).
   */
  observe(iterations: number, gpuMs: number, resampleMs?: number): void {
    const a = this.smoothing;
    const blend = (old: number | null, x: number) => (old === null ? x : (1 - a) * old + a * x);
    if (resampleMs !== undefined && resampleMs >= 0 && Number.isFinite(resampleMs)) {
      this.resample = blend(this.resample, resampleMs);
    }
    if (!(iterations > 0) || !(gpuMs > 0) || !Number.isFinite(gpuMs)) return;
    this.average = blend(this.average, gpuMs / iterations);
  }

  /**
   * Iterations for a frame with this budget: as many as fit gpuTimeBudgetMs less the measured
   * resample (a non-finite budget counts as the D4-2 cap), at least the floor of 2, never more
   * than fit the 7 ms ceiling less the resample (the ceiling wins over the floor) but at least
   * 1, and at most maxIterations (0 pauses the solver). Before any measurement: the floor.
   */
  iterationsFor(budget: StepBudget): number {
    const max = Math.max(0, Math.floor(budget.maxIterations));
    const ms = this.average;
    if (ms === null) return Math.min(max, SOLVER_BUDGET.floorIterations);
    const want = Number.isFinite(budget.gpuTimeBudgetMs)
      ? Math.max(0, budget.gpuTimeBudgetMs)
      : SOLVER_BUDGET.capMs;
    const overhead = this.resample ?? 0;
    const fit = Math.floor(Math.max(0, want - overhead) / ms);
    const ceiling = Math.max(1, Math.floor((SOLVER_BUDGET.hardCeilingMs - overhead) / ms));
    const n = Math.min(ceiling, Math.max(SOLVER_BUDGET.floorIterations, fit));
    return Math.min(max, n);
  }
}
