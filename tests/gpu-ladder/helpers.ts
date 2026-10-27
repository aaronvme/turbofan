// Shared parts of the GPU ladder: the oracle-shell round trip (the GPU state into a ReferenceSolver
// for the CPU ladder's f64 metric code), the rows report, the CPU ladder's convergence rule run on
// the GPU, and D4-38's stopping rule at the f32 floor.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import { GpuSolver, type GpuSolverOptions } from '../../src/flow/gpu/device/gpuSolver';
import type { ReferenceSolver, SolverOptions } from '../../src/flow/reference/solver';
import { CONVERGED_WINDOW, type LadderRow } from '../ladder/common';

export function report(
  id: string,
  rows: readonly LadderRow[],
  extra: Record<string, unknown> = {},
) {
  mkdirSync('reports/gpu-ladder', { recursive: true });
  writeFileSync(
    `reports/gpu-ladder/${id}.json`,
    `${JSON.stringify({ id, rows, ...extra }, null, 2)}\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `[gpu-ladder] ${r.id} | ${r.metric} | ${r.threshold} | ${r.value.toPrecision(4)} | ${String(r.pass)}\n`,
    );
  }
  for (const r of rows) {
    if (r.pass === 'reported') continue;
    expect(r.pass, `${r.id}: ${r.metric} = ${r.value} (${r.threshold})`).toBe(true);
  }
}

/** A GPU solver with the oracle's options, started from the oracle's state rounded to f32. */
export async function onGpu(
  device: GPUDevice,
  s: ReferenceSolver,
  options: SolverOptions,
  extra: Partial<GpuSolverOptions> = {},
): Promise<GpuSolver> {
  const g = await GpuSolver.create(device, s.mesh, {
    gas: options.gas,
    freeStream: options.freeStream,
    ...(options.cfl === undefined ? {} : { cfl: options.cfl }),
    ...(options.inflowTotal === undefined ? {} : { inflowTotal: options.inflowTotal }),
    ...(options.outflowPressure === undefined ? {} : { outflowPressure: options.outflowPressure }),
    ...(options.bcRemap === undefined ? {} : { bcRemap: options.bcRemap }),
    ...(options.lowMachPreconditioning === undefined
      ? {}
      : { lowMachPreconditioning: options.lowMachPreconditioning }),
    ...extra,
  });
  g.setBlockage(s.blockage);
  g.setConserved(Float64Array.from(s.U, Math.fround));
  return g;
}

/** The GPU's state into the oracle shell, for the CPU ladder's f64 metric code. */
export async function back(g: GpuSolver, s: ReferenceSolver): Promise<void> {
  s.U.set(await g.readConserved());
}

export interface GpuConvergence {
  readonly iterations: number;
  readonly first: number;
  readonly last: number;
  readonly converged: boolean;
}

/** PHYSICS.md 3.3's "converged" (drop x the first, or the peak, residual for the window). */
export async function convergeGpu(
  g: GpuSolver,
  drop: number,
  max: number,
  reference: 'first' | 'peak' = 'first',
): Promise<GpuConvergence> {
  g.iterate(1);
  let first = await g.readResidual();
  let it = 1;
  let start = 0;
  let last = first;
  while (it < max) {
    g.iterate(1);
    last = await g.readResidual();
    it++;
    if (!Number.isFinite(last)) break;
    if (reference === 'peak') first = Math.max(first, last);
    if (last > drop * first) start = 0;
    else if (start === 0) start = it;
    if (start > 0 && it - start + 1 >= CONVERGED_WINDOW) {
      return { iterations: start, first, last, converged: true };
    }
  }
  return { iterations: it, first, last, converged: false };
}

/** D4-38: the accuracy metric's window and tolerance. */
export const SETTLE_WINDOW = 2000;
export const SETTLE_TOLERANCE = 1e-4;
const CHUNK = 250;

export interface Settled extends GpuConvergence {
  /** The residual plateau used: stated per case, or detected (null: not reached). */
  readonly plateau: number | null;
  readonly detected: boolean;
  /** The metric's largest relative change over the last SETTLE_WINDOW iterations. */
  readonly change: number;
  readonly metric: readonly number[];
}

/**
 * D4-38's GPU stopping rule: the density residual (over the first, or the peak, residual) is at
 * its f32 plateau and every accuracy metric changes by less than 1e-4 relative over the last 2000
 * iterations. The plateau is stated per case (L4a 4e-5, L5 1.7e-4: the oracle's converged state
 * rounded to f32), or, for a case without one, detected: the smallest residual of the last 2000
 * iterations is no less than half that of the 2000 before (it has stopped falling). The metric is
 * evaluated every 250 iterations on the oracle shell.
 */
export async function settle(
  g: GpuSolver,
  s: ReferenceSolver,
  metric: () => number[],
  opts: { max: number; plateau?: number; reference?: 'first' | 'peak' },
): Promise<Settled> {
  g.iterate(1);
  let first = await g.readResidual();
  let it = 1;
  const hist: { it: number; res: number; m: number[] }[] = [];
  let last = first;
  while (it < opts.max) {
    g.iterate(CHUNK - (it % CHUNK));
    it += CHUNK - (it % CHUNK);
    last = await g.readResidual();
    if (opts.reference === 'peak') first = Math.max(first, last);
    if (!Number.isFinite(last)) break;
    await back(g, s);
    const m = metric();
    hist.push({ it, res: last / first, m });
    const old = hist.find((h) => h.it === it - SETTLE_WINDOW);
    if (old === undefined) continue;
    const change = Math.max(
      ...m.map((v, k) => Math.abs(v - (old.m[k] ?? NaN)) / Math.max(Math.abs(v), 1e-300)),
    );
    let plateau: number | null = null;
    let detected = false;
    if (opts.plateau !== undefined) {
      if (last / first <= opts.plateau) plateau = opts.plateau;
    } else {
      const recent = hist.filter((h) => h.it > it - SETTLE_WINDOW).map((h) => h.res);
      const before = hist
        .filter((h) => h.it > it - 2 * SETTLE_WINDOW && h.it <= it - SETTLE_WINDOW)
        .map((h) => h.res);
      if (it >= 2 * SETTLE_WINDOW && Math.min(...recent) >= 0.5 * Math.min(...before)) {
        plateau = Math.max(...recent);
        detected = true;
      }
    }
    if (plateau !== null && change < SETTLE_TOLERANCE) {
      return { iterations: it, first, last, converged: true, plateau, detected, change, metric: m };
    }
  }
  const lastM = hist.at(-1)?.m ?? [];
  const old = hist.find((h) => h.it === (hist.at(-1)?.it ?? 0) - SETTLE_WINDOW);
  const change =
    old === undefined
      ? NaN
      : Math.max(...lastM.map((v, k) => Math.abs(v - (old.m[k] ?? NaN)) / Math.abs(v)));
  return {
    iterations: it,
    first,
    last,
    converged: false,
    plateau: null,
    detected: false,
    change,
    metric: lastM,
  };
}

/** The D4-38 convergence row of a case. */
export function settleRow(id: string, c: Settled, max: number): LadderRow {
  const plateau =
    c.plateau === null
      ? 'not reached'
      : `${c.plateau.toExponential(2)}${c.detected ? ' (detected)' : ''}`;
  return {
    id,
    metric: `GPU iterations to the D4-38 rule (residual ${(c.last / c.first).toExponential(2)} of the first, plateau ${plateau}; metric change over ${SETTLE_WINDOW} its ${c.change.toExponential(2)})`,
    threshold: `<= ${max}`,
    value: c.iterations,
    pass: c.converged,
  };
}
