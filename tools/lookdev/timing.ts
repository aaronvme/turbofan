// The look-dev timing protocol (W1L-I4), pure so it is unit-tested
// (tests/unit/lookdev/timing.test.ts): D0-1 (10 s warm-up, 3 x 60 s runs, median of the
// runs, conditions recorded), D2-12 (a warm-up before EACH run, configs rotated per
// repetition in a seeded order) and D2-11 as amended by D3-6 (INVALID only on the occlusion
// signature or a hidden page; a slow load is a warning with its numbers kept).

import { sweepOrder } from '../../spikes/lib/order.ts';
import { frameHealth, runValidity, type Validity } from '../../spikes/lib/validity.ts';
import {
  PASS_GROUPS,
  quantile,
  type PassGroup,
  type RunSummary,
  type Spread,
} from '../../src/gpu/passTimings.ts';

export interface TimingConfig {
  readonly id: string;
  readonly group: string;
  readonly preset: string;
  readonly flags: Readonly<Record<string, boolean>>;
}

/** The official set (D3-7): the default, the cutaway and the hero. About 11 min at D0-1. */
export const OFFICIAL_CONFIGS: readonly TimingConfig[] = [
  { id: 'default (threeQuarterFront)', group: 'official', preset: 'threeQuarterFront', flags: {} },
  { id: 'cutaway', group: 'official', preset: 'cutaway', flags: {} },
  { id: 'hero (cinematic, DoF on)', group: 'official', preset: 'hero', flags: {} },
];

/** The A/B diagnostics (`--diagnostics`): run once at 20 s each to rank them. */
export const DIAGNOSTIC_CONFIGS: readonly TimingConfig[] = [
  { id: 'default', group: 'default', preset: 'threeQuarterFront', flags: {} },
  {
    id: 'default, culling off',
    group: 'default',
    preset: 'threeQuarterFront',
    flags: { noCull: true },
  },
  {
    id: 'default, no cyclorama',
    group: 'default',
    preset: 'threeQuarterFront',
    flags: { noStage: true },
  },
  {
    id: 'default, no shadows',
    group: 'default',
    preset: 'threeQuarterFront',
    flags: { noShadow: true },
  },
  {
    id: 'default, no post',
    group: 'default',
    preset: 'threeQuarterFront',
    flags: { noPost: true },
  },
  { id: 'fanTakeoff', group: 'fan', preset: 'fanTakeoff', flags: {} },
  { id: 'cutaway, caps off', group: 'cutaway', preset: 'cutaway', flags: { noCaps: true } },
  { id: 'exploded', group: 'other', preset: 'exploded', flags: {} },
  { id: 'hotSection', group: 'other', preset: 'hotSection', flags: {} },
];

export interface TimingArgs {
  readonly warmupS: number;
  readonly runS: number;
  readonly reps: number;
  readonly seed: number;
  readonly diagnostics: boolean;
}

export function parseTimingArgs(argv: readonly string[]): TimingArgs {
  const num = (name: string, fallback: number, ok: (v: number) => boolean): number => {
    const i = argv.indexOf(name);
    if (i < 0) return fallback;
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || !ok(v)) throw new Error(`${name}: bad value ${String(argv[i + 1])}`);
    return v;
  };
  return {
    warmupS: num('--warmup-s', 10, (v) => v >= 0),
    runS: num('--run-s', 60, (v) => v > 0),
    reps: num('--reps', 3, (v) => Number.isInteger(v) && v >= 1),
    seed: num('--seed', 1, Number.isInteger),
    diagnostics: argv.includes('--diagnostics'),
  };
}

/** Config ids per repetition: seeded, rotated so each takes each position (D2-12). */
export function runOrder(configs: readonly TimingConfig[], reps: number, seed: number): string[][] {
  return sweepOrder(configs, reps, seed);
}

export interface Combined {
  readonly runs: number;
  /** Per pass: the median over runs of each run's p10, p50 and p90. */
  readonly gpu: Readonly<Record<PassGroup, Spread>>;
  readonly gpuTotal: Spread;
  readonly cpu: Spread;
  /** Each run's median GPU total, in run order (the spread between runs). */
  readonly gpuTotalPerRun: readonly number[];
}

const med = (xs: readonly number[]): number => quantile(xs, 0.5);
const medSpread = (xs: readonly Spread[]): Spread => ({
  p10: med(xs.map((s) => s.p10)),
  p50: med(xs.map((s) => s.p50)),
  p90: med(xs.map((s) => s.p90)),
});

export function combineReps(runs: readonly RunSummary[]): Combined {
  const gpu = {} as Record<PassGroup, Spread>;
  for (const g of PASS_GROUPS) gpu[g] = medSpread(runs.map((r) => r.gpu[g]));
  return {
    runs: runs.length,
    gpu,
    gpuTotal: medSpread(runs.map((r) => r.gpuTotal)),
    cpu: medSpread(runs.map((r) => r.cpu)),
    gpuTotalPerRun: runs.map((r) => r.gpuTotal.p50),
  };
}

/** D2-11 / D3-6 for one run, from its rAF intervals and the time the page was hidden. */
export function runValidityOf(
  rafDeltasMs: readonly number[],
  displayMs: number,
  hiddenMs: number,
): Validity {
  const h = frameHealth(rafDeltasMs, displayMs);
  const v = runValidity(
    {
      frameTime: { p50: med(rafDeltasMs) },
      longestThrottledMs: h.longestThrottledMs,
      displayIntervalMs: displayMs,
    },
    hiddenMs,
  );
  return v.valid
    ? v
    : { ...v, reasons: v.reasons.map((r) => `INVALID (occluded or hidden): ${r}`) };
}
