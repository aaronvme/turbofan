// Shared parts of the GPU ladder: the oracle-shell round trip (the GPU state into a ReferenceSolver
// for the CPU ladder's f64 metric code), the rows report, the CPU ladder's convergence rule run on
// the GPU, and D4-38's stopping rule at the f32 floor.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import { GpuSolver, type GpuSolverOptions } from '../../src/flow/gpu/device/gpuSolver';
import type { ReferenceSolver, SolverOptions } from '../../src/flow/reference/solver';
import {
  CONVERGED_WINDOW,
  STEADY_EVERY,
  STEADY_WINDOW,
  type LadderRow,
  type Steadiness,
} from '../ladder/common';

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
  /**
   * The metric's largest relative change over the last SETTLE_WINDOW iterations: the largest
   * |m - m_end| / |m_end| over every sample of the window, not only its endpoints (W2S-A-I6).
   */
  readonly change: number;
  readonly metric: readonly number[];
  /** The metric samples (every 250 its) of the last SETTLE_WINDOW iterations, the last one last. */
  readonly window: readonly (readonly number[])[];
  /** The plateau the detection rule sees at the end (also when a stated one was not reached). */
  readonly seen: number | null;
}

type Sample = { it: number; res: number; m: number[] };

function windowOf(hist: readonly Sample[], it: number): number[][] {
  return hist.filter((h) => h.it >= it - SETTLE_WINDOW && h.it <= it).map((h) => h.m);
}

/** The largest relative change of the metrics over the window ending at `it` (every sample). */
function windowChange(hist: readonly Sample[], it: number): number {
  if (hist.find((h) => h.it === it - SETTLE_WINDOW) === undefined) return NaN;
  const win = windowOf(hist, it);
  const end = win.at(-1) ?? [];
  let worst = 0;
  for (const m of win) {
    end.forEach((v, k) => {
      worst = Math.max(worst, Math.abs((m[k] ?? NaN) - v) / Math.max(Math.abs(v), 1e-300));
    });
  }
  return worst;
}

/**
 * D4-45's steadiness of a value row, as the oracle's ladder measures it (tests/ladder/common.ts
 * steadyWindow, W2R-I16): STEADY_WINDOW more iterations after the stop, the value sampled at the
 * start and every STEADY_EVERY iterations (on the oracle shell), the spread max - min of the
 * samples and the value of record the last one. A value is of record within a tenth of its
 * tolerance.
 */
export async function steadyWindowGpu(
  g: GpuSolver,
  s: ReferenceSolver,
  value: () => number,
): Promise<Steadiness> {
  await back(g, s);
  const samples = [value()];
  for (let k = 0; k < STEADY_WINDOW / STEADY_EVERY; k++) {
    g.iterate(STEADY_EVERY);
    await back(g, s);
    samples.push(value());
  }
  return {
    samples,
    spread: Math.max(...samples) - Math.min(...samples),
    value: samples[samples.length - 1] ?? NaN,
  };
}

/** A residual that fell by less than this over SETTLE_WINDOW iterations has stopped (B-I5). */
export const PLATEAU_FALL = 0.1;

/**
 * The detected plateau at `it`: the smallest residual of the last SETTLE_WINDOW iterations is at
 * least (1 - PLATEAU_FALL) of that of the window before (it has stopped falling), else null.
 */
function detect(hist: readonly Sample[], it: number): number | null {
  if (it < 2 * SETTLE_WINDOW) return null;
  const recent = hist.filter((h) => h.it > it - SETTLE_WINDOW).map((h) => h.res);
  const before = hist
    .filter((h) => h.it > it - 2 * SETTLE_WINDOW && h.it <= it - SETTLE_WINDOW)
    .map((h) => h.res);
  return Math.min(...recent) >= (1 - PLATEAU_FALL) * Math.min(...before)
    ? Math.max(...recent)
    : null;
}

/**
 * D4-38's GPU stopping rule: the density residual (over the first, or the peak, residual) is at
 * its f32 plateau and every accuracy metric changes by less than 1e-4 relative over the last 2000
 * iterations. The plateau is stated per case (L4a 1.6e-4, L5 1.1e-3: GPU_CONVERGENCE_FLOOR, the
 * oracle's own with f32 storage, D4-58), or, for a case without one, detected: the smallest residual of the last 2000
 * iterations is at least 90 % of that of the 2000 before (it has stopped falling). The metric is
 * evaluated every 250 iterations on the oracle shell, and its change is the largest over every
 * sample of the window (W2S-A-I6, W2S-B-N6).
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
  const hist: Sample[] = [];
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
    const change = windowChange(hist, it);
    if (Number.isNaN(change)) continue;
    let plateau: number | null = null;
    let detected = false;
    const seen = detect(hist, it);
    if (opts.plateau !== undefined) {
      if (last / first <= opts.plateau) plateau = opts.plateau;
    } else if (seen !== null) {
      plateau = seen;
      detected = true;
    }
    if (plateau !== null && change < SETTLE_TOLERANCE) {
      const metric = m;
      return {
        iterations: it,
        first,
        last,
        converged: true,
        plateau,
        detected,
        change,
        metric,
        window: windowOf(hist, it),
        seen,
      };
    }
  }
  const lastM = hist.at(-1)?.m ?? [];
  const end = hist.at(-1)?.it ?? 0;
  return {
    iterations: it,
    first,
    last,
    converged: false,
    plateau: null,
    detected: false,
    change: windowChange(hist, end),
    metric: lastM,
    window: windowOf(hist, end),
    seen: detect(hist, end),
  };
}

/** The D4-38 convergence row of a case. */
export function settleRow(id: string, c: Settled, max: number): LadderRow {
  const plateau =
    c.plateau === null
      ? `not reached (${c.seen === null ? 'still falling' : `it fell < 10 % per ${SETTLE_WINDOW} its at ${c.seen.toExponential(2)}`})`
      : `${c.plateau.toExponential(2)}${c.detected ? ' (detected: fell < 10 % per 2000 its)' : ''}`;
  return {
    id,
    metric: `GPU iterations to the D4-38 rule (residual ${(c.last / c.first).toExponential(2)} of the first, plateau ${plateau}; metric change over ${SETTLE_WINDOW} its ${c.change.toExponential(2)})`,
    threshold: `<= ${max}`,
    value: c.iterations,
    pass: c.converged,
  };
}
