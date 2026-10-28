// Shared pieces of the CPU ladder (tests/ladder, `npm run test:ladder`): the convergence driver
// of PHYSICS.md 3.3 "CPU variants" ("converged" = the density residual below a fraction of its
// first-iteration value), and the result record each case writes to reports/ladder/ (git-ignored)
// and prints, so the numbers of a run can be quoted.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ReferenceSolver } from '../../src/flow/reference/solver';

export interface LadderRow {
  readonly id: string;
  readonly metric: string;
  readonly threshold: string;
  readonly value: number;
  readonly pass: boolean | 'reported';
}

export function report(
  id: string,
  rows: readonly LadderRow[],
  extra: Record<string, unknown> = {},
): void {
  mkdirSync('reports/ladder', { recursive: true });
  writeFileSync(
    `reports/ladder/${id}.json`,
    `${JSON.stringify({ id, rows, ...extra }, null, 2)}\n`,
  );
}

export interface Convergence {
  readonly iterations: number;
  readonly first: number;
  readonly last: number;
  readonly converged: boolean;
}

/**
 * Iterations the residual must stay at or below the target before a case counts as converged: an
 * oscillating residual dips through the target long before the field is steady (ladder L8's first
 * run stopped on such a dip at iteration 1017; the residual was 17x higher ten iterations later).
 */
export const CONVERGED_WINDOW = 50;

/**
 * Tracking iterations until the residual is <= drop x the first iteration's and stays there for
 * CONVERGED_WINDOW iterations, or maxIterations. `iterations` is the first iteration of that window.
 */
export function converge(
  s: ReferenceSolver,
  drop: number,
  maxIterations: number,
  reference: 'first' | 'peak' = 'first',
): Convergence {
  let first = s.iterate(1).residualDensityL2;
  let it = 1;
  let last = first;
  let start = 0;
  while (it < maxIterations) {
    last = s.iterate(1).residualDensityL2;
    it++;
    if (!Number.isFinite(last)) break;
    // 'peak': the reference is the largest residual so far (L9: the first one is zero)
    if (reference === 'peak' && last > first) first = last;
    if (last > drop * first) start = 0;
    else if (start === 0) start = it;
    if (start > 0 && it - start + 1 >= CONVERGED_WINDOW)
      return { iterations: start, first, last, converged: true };
  }
  return { iterations: it, first, last, converged: false };
}

/** D4-45 (after D4-19): a value row taken at the end of a run must be steady over its last window. */
export const STEADY_WINDOW = 2000;
export const STEADY_EVERY = 100;

export interface Steadiness {
  /** The metric at the window's start and after every STEADY_EVERY iterations (21 samples). */
  readonly samples: readonly number[];
  /** max - min of the samples. */
  readonly spread: number;
  /** The last sample: the value the row reports. */
  readonly value: number;
}

/**
 * D4-45 (W2R-I7): runs the last STEADY_WINDOW iterations of a case, sampling `metric` every
 * STEADY_EVERY iterations (and at the start), so a value row can require max - min <= a tenth of
 * its tolerance. Without it a slowly oscillating case passes or fails on the iteration it stopped
 * at (L8 at CFL 0.8 swung between 0.35 % and 0.68 % over 2500-20000 iterations, critic pass 8).
 */
export function steadyWindow(s: ReferenceSolver, metric: () => number): Steadiness {
  const samples = [metric()];
  for (let k = 0; k < STEADY_WINDOW / STEADY_EVERY; k++) {
    s.iterate(STEADY_EVERY);
    samples.push(metric());
  }
  return {
    samples,
    spread: Math.max(...samples) - Math.min(...samples),
    value: samples[samples.length - 1] ?? NaN,
  };
}

/** The tracking CFL the ladder's 20000-iteration caps were set at (the plain default). */
export const CAP_CFL = 1.5;

/**
 * D4-45: pseudo-time iterations to a steady state go as 1 / CFL, so a cap set at CAP_CFL scales by
 * CAP_CFL / cfl (L8 at the preconditioned 0.8: 20000 -> 37500). A property of the scheme, not a
 * tuning: a case at CAP_CFL keeps its cap.
 */
export function scaledCap(cap: number, cfl: number): number {
  return Math.round((cap * CAP_CFL) / cfl);
}

/** Run physical-time steps to exactly tEnd (the last step is shortened). */
export function runTo(s: ReferenceSolver, tEnd: number): number {
  let steps = 0;
  while (s.time < tEnd - 1e-15 * tEnd) {
    const dt = Math.min(s.globalDt(), tEnd - s.time);
    s.stepPhysical(dt);
    steps++;
  }
  return steps;
}

/** Growth ratio g with first spacing h0 and n cells spanning `length`: h0 (g^n - 1)/(g - 1) = length. */
export function geometricGrowth(h0: number, length: number, n: number): number {
  let lo = 1 + 1e-12;
  let hi = 2;
  for (let k = 0; k < 200; k++) {
    const g = 0.5 * (lo + hi);
    if ((h0 * (g ** n - 1)) / (g - 1) > length) hi = g;
    else lo = g;
  }
  return 0.5 * (lo + hi);
}

/** n + 1 node positions from a to b with the first spacing h at a, growing geometrically. */
export function graded(a: number, b: number, h: number, n: number): number[] {
  const g = geometricGrowth(h, Math.abs(b - a), n);
  const out = [a];
  let x = a;
  let step = h;
  for (let k = 0; k < n; k++) {
    x += Math.sign(b - a) * step;
    out.push(x);
    step *= g;
  }
  out[n] = b;
  return out;
}
