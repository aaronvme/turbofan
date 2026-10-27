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
  for (const r of rows) {
    process.stdout.write(
      `[ladder] ${r.id} | ${r.metric} | ${r.threshold} | ${r.value.toPrecision(4)} | ${String(r.pass)}\n`,
    );
  }
}

export interface Convergence {
  readonly iterations: number;
  readonly first: number;
  readonly last: number;
  readonly converged: boolean;
}

/** Tracking iterations until residual <= drop x the first iteration's, or maxIterations. */
export function converge(s: ReferenceSolver, drop: number, maxIterations: number): Convergence {
  const first = s.iterate(1).residualDensityL2;
  let it = 1;
  let last = first;
  while (it < maxIterations) {
    last = s.iterate(1).residualDensityL2;
    it++;
    if (!Number.isFinite(last)) break;
    if (last <= drop * first) return { iterations: it, first, last, converged: true };
  }
  return { iterations: it, first, last, converged: false };
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
