// P1's pure parts (`npm run bench:p1`; PHYSICS 3.4 P1, D4-54, D4-64): the configurations, the
// scene of a production run, the solver-health gate and the verdict. The pages are spikes/p1 (the
// app's own 1080p engine scene, the measurement of record) and spikes/throughput (the W0 1080p
// bench scene, reported beside it for continuity with PHYSICS P1's "W0 spike a" and M34).

import type { ProtocolTimes } from './benchRun.ts';
import { runTimeoutMs } from './timeout.ts';
import type { Validity } from './validity.ts';

/** The scene of a production run (spikes/scene/benchApp.ts BenchConfig.scene). */
export type P1Scene = 'bench' | 'app';

/**
 * The scene a configuration asks for: 'bench' (the W0 bench scene, the default) or 'app' (the
 * app's engine scene, src/render/engineView.ts). Anything else throws, so a configuration is never
 * measured in a scene it did not ask for (W2I-I2 b).
 */
export function sceneOf(scene: unknown): P1Scene {
  if (scene === undefined || scene === 'bench') return 'bench';
  if (scene === 'app') return 'app';
  throw new Error(`unknown bench scene ${JSON.stringify(scene)} (expected 'bench' or 'app')`);
}

/** The page of each scene, loaded fresh for every run (so every run gets a fresh device). */
export const P1_PAGES: Readonly<Record<P1Scene, string>> = {
  bench: '/spikes/throughput/index.html',
  app: '/spikes/p1/index.html',
};

/** D4-64: the measurement of record, the app's GpuFlowSolver in the app's engine scene. */
export const P1_RECORD = 'solver-130k-app';
/** The same solver in the W0 bench scene: PHYSICS P1's wording, for continuity; never the verdict. */
export const P1_BENCH = 'solver-130k-bench';
/** The W0 spike kernel's 130k-16x8 in the bench scene: the calibration against M34's 1.277 ms/it. */
export const P1_SPIKE = 'spike-130k-16x8';

export type P1Config = {
  readonly id: string;
  readonly group: string;
  readonly solver: 'production' | 'spike';
  readonly scene: P1Scene;
  readonly grid: { readonly ni: number; readonly nj: number };
  readonly blocks: { readonly bi: number; readonly bj: number };
  readonly tile: { readonly x: number; readonly y: number };
  readonly iterations: 'adaptive';
  readonly protocol: ProtocolTimes;
  readonly particles: number;
};

/**
 * P1's rows, one group so they rotate together (spikes/lib/order.ts: a Latin square for 3). The
 * production solver runs its own D4-2 scheduler at solverBudgetMs from its scene's measured
 * render (and, in the bench scene, flow-visual) GPU times, the resample counted; the spike kernel
 * runs its 7 ms budget. The shipped asset and the solver's default tile make the production rows'
 * grid, blocks and tile unused.
 */
export function p1Configs(protocol: ProtocolTimes): P1Config[] {
  const production = {
    group: 'p1',
    solver: 'production',
    grid: { ni: 0, nj: 0 },
    blocks: { bi: 0, bj: 0 },
    tile: { x: 16, y: 8 },
    iterations: 'adaptive',
    protocol,
    particles: 65536,
  } as const;
  return [
    { id: P1_RECORD, scene: 'app', ...production },
    { id: P1_BENCH, scene: 'bench', ...production },
    {
      id: P1_SPIKE,
      group: 'p1',
      solver: 'spike',
      scene: 'bench',
      grid: { ni: 512, nj: 256 },
      blocks: { bi: 4, bj: 3 },
      tile: { x: 16, y: 8 },
      iterations: 'adaptive',
      protocol,
      particles: 65536,
    },
  ];
}

/** A fresh page's load before its run: the scene, the device, the 130k asset and the pipelines. */
export const P1_PAGE_LOAD_MS = 60_000;

/** The longest a P1 run may take, its page load included, before it counts as stalled. */
export function p1TimeoutMs(single: ProtocolTimes): number {
  return runTimeoutMs(single) + P1_PAGE_LOAD_MS;
}

/** What the solver-health gate reads from a run's result (spikes/scene/benchApp.ts ConfigResult). */
export interface SolverHealth {
  readonly stateFinite: boolean;
  readonly gpuErrors: readonly { readonly kind: string; readonly message: string }[];
  /** Production runs: the frames whose density residual read back non-finite. */
  readonly nonFiniteResiduals?: number;
  /** Production runs: GpuFlowSolver.status() at the end. */
  readonly solverStatus?: { readonly status: string; readonly error: string | null };
}

const SHOWN_ERRORS = 3;

/**
 * W2I-I2 (a): a run is INVALID, with no number, when the device reported any GPU error, the
 * solver state is non-finite after the run, a frame's density residual read back non-finite (the
 * production run's state reset would otherwise hide a divergence between resets), or the
 * production solver is not running at the end. An invalid run is rerun once, as for D3-6.
 */
export function solverValidity(h: SolverHealth): Validity {
  const reasons: string[] = [];
  const n = h.gpuErrors.length;
  if (n > 0) {
    const shown = h.gpuErrors.slice(0, SHOWN_ERRORS).map((e) => `${e.kind}: ${e.message}`);
    const more = n > SHOWN_ERRORS ? ` (+${n - SHOWN_ERRORS} more)` : '';
    reasons.push(`${n} GPU error${n === 1 ? '' : 's'}: ${shown.join(' | ')}${more}`);
  }
  if (!h.stateFinite) reasons.push('non-finite solver state after the run');
  const bad = h.nonFiniteResiduals ?? 0;
  if (bad > 0) {
    reasons.push(
      `non-finite density residual on ${bad} frames (a divergence between state resets)`,
    );
  }
  const st = h.solverStatus;
  if (st !== undefined && st.status !== 'running') {
    reasons.push(
      `the solver is ${st.status} at the end${st.error === null ? '' : `: ${st.error}`}`,
    );
  }
  return { valid: reasons.length === 0, reasons, warnings: [] };
}

/** A summary row as the harness builds it (spikes/bench/run.ts). */
export interface P1Row {
  readonly id: string;
  readonly validity: Validity;
  readonly aggregate: {
    readonly itPerSec: number;
    readonly solverMsPerIt: number | null;
    readonly fps: number;
  } | null;
}

const numbers = (a: NonNullable<P1Row['aggregate']>) =>
  `${a.itPerSec.toFixed(0)} it/s (${a.solverMsPerIt?.toFixed(3) ?? '-'} ms/it, ${a.fps.toFixed(1)} fps)`;

/**
 * P1's verdict (PHYSICS 3.4 P1, D4-64): PASS or FAIL on the app scene's row, the measurement of
 * record; the W0 bench scene's row on the next line, never a verdict. An INVALID or missing
 * record row gives no verdict. A miss counts only after a quiet re-run (PHYSICS P1), and then goes
 * to the logged decision of P1's rule (D4-66).
 */
export function p1Verdict(rows: readonly P1Row[], minItPerS: number, quick: boolean): string[] {
  const find = (id: string) => rows.find((r) => r.id === id);
  const record = find(P1_RECORD);
  const lines: string[] = [];
  if (record === undefined) lines.push(`P1 of record: ${P1_RECORD} not run, no verdict`);
  else if (record.aggregate === null || !record.validity.valid)
    lines.push(`P1 of record: INVALID, no verdict (${record.validity.reasons.join('; ')})`);
  else {
    const a = record.aggregate;
    const pass = a.itPerSec >= minItPerS;
    lines.push(
      `P1 of record (D4-64: >= ${minItPerS} it/s at 130k inside the app's 1080p engine scene): ` +
        `${pass ? 'PASS' : 'FAIL'} at ${numbers(a)}` +
        (pass
          ? ''
          : '; a miss counts only after a quiet re-run (PHYSICS P1), then the logged decision (D4-66)') +
        (quick ? ' - indicative only (--quick)' : ''),
    );
  }
  const bench = find(P1_BENCH);
  const label = `  beside it, ${P1_BENCH} in the W0 bench scene (PHYSICS P1's W0 spike a, continuity; not the record)`;
  if (bench === undefined) lines.push(`${label}: ${P1_BENCH} not run`);
  else if (bench.aggregate === null || !bench.validity.valid)
    lines.push(`${label}: INVALID (${bench.validity.reasons.join('; ')})`);
  else lines.push(`${label}: ${numbers(bench.aggregate)}`);
  return lines;
}
