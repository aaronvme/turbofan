// The look-dev timing protocol (W1L-I4), pure so it is unit-tested
// (tests/unit/lookdev/timing.test.ts): D0-1 (10 s warm-up, 3 x 60 s runs, median of the
// runs, conditions recorded), D2-12 (a warm-up before EACH run, configs rotated per
// repetition in a seeded order) and D2-11 as amended by D3-6 (INVALID only on the occlusion
// signature, a hidden page or a blur; a slow load is a warning with its numbers kept), D4-42
// (P4 back to back, valid runs only, AC throughout) and D4-46 (back-to-back runs follow D3-6).

import { sweepOrder } from '../../spikes/lib/order.ts';
import type { PowerSource } from '../../spikes/lib/system.ts';
import {
  frameHealth,
  MAX_THROTTLED_STRETCH_MS,
  OCCLUSION_DELTA_MS,
  OCCLUSION_MIN_STRETCH_MS,
  runValidity,
  THROTTLE_FACTOR,
  type Validity,
} from '../../spikes/lib/validity.ts';
import {
  PASS_GROUPS,
  quantile,
  type FrameSample,
  type PassGroup,
  type RunSummary,
  type Spread,
} from '../../src/gpu/passTimings.ts';

export interface TimingConfig {
  readonly id: string;
  readonly group: string;
  readonly preset: string;
  readonly flags: Readonly<Record<string, boolean | number | string>>;
  /** The render profile (D3-7); `quality` when absent. */
  readonly profile?: 'quality' | 'performance';
}

/** The official set (D3-7): the default, the cutaway and the hero. About 11 min at D0-1. */
export const OFFICIAL_CONFIGS: readonly TimingConfig[] = [
  { id: 'default (threeQuarterFront)', group: 'official', preset: 'threeQuarterFront', flags: {} },
  { id: 'cutaway', group: 'official', preset: 'cutaway', flags: {} },
  { id: 'hero (cinematic, DoF on)', group: 'official', preset: 'hero', flags: {} },
  // D3-7: the battery default if the default is over 8 ms on AC
  {
    id: 'default, performance profile',
    group: 'official',
    preset: 'threeQuarterFront',
    flags: {},
    profile: 'performance',
  },
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
  // the rotor pass's cost: the rest of the pass, and per fan time copy
  { id: 'default, no fan', group: 'default', preset: 'threeQuarterFront', flags: { noFan: true } },
  {
    id: 'default, 4 fan copies',
    group: 'default',
    preset: 'threeQuarterFront',
    flags: { fanCopies: 4 },
  },
  { id: 'fanTakeoff', group: 'fan', preset: 'fanTakeoff', flags: {} },
  // what the opaque pass pays for (D4-5): its materials, its vanes, its internal solids
  { id: 'default, flat main', group: 'opaque', preset: 'threeQuarterFront', flags: { flat: true } },
  {
    id: 'default, no main rows',
    group: 'opaque',
    preset: 'threeQuarterFront',
    flags: { hide: '^main:row:' },
  },
  {
    id: 'default, main skins only',
    group: 'opaque',
    preset: 'threeQuarterFront',
    flags: { skinsOnly: true },
  },
  {
    id: 'default, performance, flat main',
    group: 'opaque',
    preset: 'threeQuarterFront',
    flags: { flat: true },
    profile: 'performance',
  },
  { id: 'cutaway, caps off', group: 'cutaway', preset: 'cutaway', flags: { noCaps: true } },
  { id: 'exploded', group: 'other', preset: 'exploded', flags: {} },
  { id: 'hotSection', group: 'other', preset: 'hotSection', flags: {} },
];

/**
 * How frames are paced (D4-24). `vsync`: one frame per animation frame, as the app runs. At
 * that pacing the Arc iGPU idles for most of each 16.7 ms and its clock follows the load, so
 * the GPU ms overstate the cost where there is headroom and understate savings. `backToBack`:
 * the next frame is submitted as soon as the GPU has taken the previous ones (two queued
 * ahead), so the GPU is loaded much more of the time (72-77 % busy with timed passes, M46; not
 * proven to be at its full clock, W2L-N3), as it is in the app with the solver and the flow
 * visuals sharing the frame. D4-42: back to back is P4's measure of record (valid runs only,
 * the OS power source on AC throughout, the busy fraction beside it); vsync is reported
 * beside it.
 */
export type Pacing = 'vsync' | 'backToBack';
export const PACINGS: readonly Pacing[] = ['vsync', 'backToBack'];

export interface TimingArgs {
  readonly warmupS: number;
  readonly runS: number;
  readonly reps: number;
  readonly seed: number;
  readonly diagnostics: boolean;
  readonly pacings: readonly Pacing[];
}

export function parseTimingArgs(argv: readonly string[]): TimingArgs {
  const num = (name: string, fallback: number, ok: (v: number) => boolean): number => {
    const i = argv.indexOf(name);
    if (i < 0) return fallback;
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v) || !ok(v)) throw new Error(`${name}: bad value ${String(argv[i + 1])}`);
    return v;
  };
  const p = argv.indexOf('--pacing');
  const pacingArg = p < 0 ? 'both' : argv[p + 1];
  const pacings: Readonly<Record<string, readonly Pacing[]>> = {
    both: PACINGS,
    vsync: ['vsync'],
    'back-to-back': ['backToBack'],
  };
  const chosen = pacingArg === undefined ? undefined : pacings[pacingArg];
  if (chosen === undefined)
    throw new Error(`--pacing: bad value ${String(pacingArg)} (vsync, back-to-back or both)`);
  return {
    warmupS: num('--warmup-s', 10, (v) => v >= 0),
    runS: num('--run-s', 60, (v) => v > 0),
    reps: num('--reps', 3, (v) => Number.isInteger(v) && v >= 1),
    seed: num('--seed', 1, Number.isInteger),
    diagnostics: argv.includes('--diagnostics'),
    pacings: chosen,
  };
}

export interface PacedConfig extends TimingConfig {
  readonly pacing: Pacing;
}

/** Each config once per pacing; the vsync ids are the ones every earlier run recorded. */
export function withPacings(
  configs: readonly TimingConfig[],
  pacings: readonly Pacing[],
): PacedConfig[] {
  return pacings.flatMap((pacing) =>
    configs.map((c) => ({
      ...c,
      id: pacing === 'vsync' ? c.id : `${c.id} [back to back]`,
      pacing,
    })),
  );
}

/**
 * A back-to-back run's GPU busy fraction (the timed passes' share of the wall time) under which
 * it gets a warning: the loop left the GPU idle, so its clock could still have dropped. A
 * warning, not INVALID (D3-6). 0.6: the timed passes fill 72-77 % of a back-to-back run here
 * (the rest is not measured: probably GPU work the timestamps miss, the copies between
 * passes and TRAA's history copies, GPU_FACTS M46), and 60-72 % of
 * a vsync run of the same frame.
 */
export const BACK_TO_BACK_MIN_BUSY = 0.6;

export interface BackToBackLoad {
  readonly framesPerS: number;
  /** The timed passes' share of the wall time: mean GPU total per frame / mean interval. */
  readonly gpuBusy: number;
}

/**
 * Throughput and GPU load of a back-to-back run, from the frames whose timestamps came back
 * (some may be dropped when the query pool overflows, so the mean frame is used, not the sum)
 * and every frame's interval.
 */
export function backToBackLoad(
  frames: readonly FrameSample[],
  intervalsMs: readonly number[],
): BackToBackLoad {
  const wall = intervalsMs.reduce((a, b) => a + b, 0);
  const meanGpu =
    frames.reduce((t, f) => t + PASS_GROUPS.reduce((s, g) => s + f.gpu[g], 0), 0) / frames.length;
  return {
    framesPerS: (1000 * intervalsMs.length) / wall,
    gpuBusy: meanGpu / (wall / intervalsMs.length),
  };
}

/**
 * W2L-I3: a back-to-back run's rAF watcher must tick at least this share of the run's display
 * intervals, else the run is INVALID (a watcher that stopped, or a window throttled in a way
 * the occlusion signature does not show). Half: a main thread busy with the loop may delay
 * rAF, but not to under 30 Hz for a whole run on a 60 Hz display.
 */
export const MIN_WATCHER_COVERAGE = 0.5;

/** One timing run as the page reports it (src/lookdev/main.ts `timeRun`). */
export interface PacedRun {
  /** The loop's frame intervals: rAF deltas at vsync, GPU frames back to back. */
  readonly intervalsMs: readonly number[];
  readonly hiddenMs: number;
  /** Times the page lost focus during the run (D3-6's blur rule, W2L-I5). */
  readonly blurs: number;
  readonly frames: readonly FrameSample[];
  /**
   * Back to back: the rAF deltas a watcher saw during the run, its last open interval
   * included (W2L-I3). An occluded window throttles rAF, not the frame loop.
   */
  readonly vsyncDeltasMs?: readonly number[];
}

/**
 * D2-11 as amended by D3-6, per pacing (D4-46). vsync: `runValidityOf`. Back to back: INVALID
 * on a hidden page, a blur, a stall of the loop (the occlusion signature on its own
 * intervals), the occlusion signature on the rAF watcher, or a watcher that covered less than
 * MIN_WATCHER_COVERAGE of the run; the watcher's 2.5-interval stretch is a warning, as D3-6
 * makes it for a bench run. No "below display rate" warning (the loop's intervals are GPU
 * frames, not vsyncs); a warning when the GPU was busy less than BACK_TO_BACK_MIN_BUSY.
 */
export function pacedValidity(pacing: Pacing, run: PacedRun, displayMs: number): Validity {
  if (pacing === 'vsync') return runValidityOf(run.intervalsMs, displayMs, run.hiddenMs, run.blurs);
  const deltas = run.vsyncDeltasMs ?? [];
  const watched = frameHealth(deltas, displayMs);
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (watched.longestOcclusionMs >= OCCLUSION_MIN_STRETCH_MS)
    reasons.push(
      `INVALID (occluded): the rAF watcher saw intervals of ${String(OCCLUSION_DELTA_MS)} ms or more for ${watched.longestOcclusionMs.toFixed(0)} ms in a row (the window was occluded)`,
    );
  else if (watched.longestThrottledMs > MAX_THROTTLED_STRETCH_MS)
    warnings.push(
      `the rAF watcher saw intervals over ${String(THROTTLE_FACTOR)} display intervals for ${watched.longestThrottledMs.toFixed(0)} ms in a row (a busy main thread, or a stall)`,
    );
  const wallMs = run.intervalsMs.reduce((a, b) => a + b, 0);
  const expected = MIN_WATCHER_COVERAGE * (wallMs / displayMs);
  if (deltas.length < expected)
    reasons.push(
      `INVALID (watcher): the rAF watcher ticked ${String(deltas.length)} times in a ${wallMs.toFixed(0)} ms run (at least ${expected.toFixed(0)} needed)`,
    );
  const h = frameHealth(run.intervalsMs, displayMs);
  const v = runValidity(
    {
      frameTime: { p50: 0 },
      longestThrottledMs: h.longestThrottledMs,
      longestOcclusionMs: h.longestOcclusionMs,
      displayIntervalMs: displayMs,
    },
    run.hiddenMs,
    run.blurs,
  );
  const load = backToBackLoad(run.frames, run.intervalsMs);
  if (load.gpuBusy < BACK_TO_BACK_MIN_BUSY)
    warnings.push(
      `GPU busy ${(100 * load.gpuBusy).toFixed(0)} % of the wall time (under ${String(100 * BACK_TO_BACK_MIN_BUSY)} %): not saturated, its clock could still fall`,
    );
  return {
    valid: v.valid && reasons.length === 0,
    reasons: [...v.reasons.map((r) => `INVALID (hidden, unfocused or stalled): ${r}`), ...reasons],
    warnings,
  };
}

/**
 * D4-42 / W2L-I4: the OS power source (Win32_Battery, spikes/lib/system.ts) read before and
 * after every run. AC throughout: every reading AC, or a machine with no battery.
 */
export function acThroughout(sources: readonly PowerSource[]): boolean {
  return sources.length > 0 && sources.every((s) => s === 'ac' || s === 'no-battery');
}

/**
 * A run's power check (W2L-I4): on battery is INVALID for an official run (the governor
 * behaves differently there) and a warning for an indicative one; an unreadable source is a
 * warning, and never counts as AC.
 */
export function powerValidity(sources: readonly PowerSource[], official: boolean): Validity {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (sources.includes('battery')) {
    const msg = `on battery during the run (OS power source: ${sources.join(' -> ')})`;
    if (official) reasons.push(`INVALID (power): ${msg}`);
    else warnings.push(msg);
  }
  if (sources.length === 0 || sources.includes('unknown'))
    warnings.push(
      `OS power source unknown (${sources.length === 0 ? 'not read' : sources.join(' -> ')}): not AC`,
    );
  return { valid: reasons.length === 0, reasons, warnings };
}

export type Verdict = 'PASS' | 'FAIL' | 'INVALID';

export interface P4Input {
  /** Per pacing: the default view's GPU ms (median of its valid runs), all runs valid, GPU busy. */
  readonly byPacing: Partial<
    Record<Pacing, { readonly ms: number; readonly valid: boolean; readonly gpuBusy: number }>
  >;
  readonly maxMs: number;
  /** The run used D0-1's protocol (10 s warm-up, 3 x 60 s). */
  readonly protocol: boolean;
  /** The OS power source was AC before and after every run (D4-42, W2L-I4). */
  readonly acThroughout: boolean;
}

export interface P4Result {
  readonly perPacing: Partial<Record<Pacing, Verdict>>;
  readonly verdict: string;
  readonly official: boolean;
  /** The measure of record's GPU busy fraction, reported beside the number (D4-42). */
  readonly gpuBusy?: number;
}

/**
 * P4 (D4-2, D4-42): the default view's median render GPU ms, back to back (the measure of
 * record), against the bound; vsync is judged beside it but does not decide. INVALID when a
 * default back-to-back run was INVALID (W2L-I2); official only under D0-1's protocol with the
 * OS power source on AC throughout (W2L-I4).
 */
export function p4Verdict(input: P4Input): P4Result {
  const perPacing: Partial<Record<Pacing, Verdict>> = {};
  for (const p of PACINGS) {
    const r = input.byPacing[p];
    if (r !== undefined)
      perPacing[p] = !r.valid ? 'INVALID' : r.ms <= input.maxMs ? 'PASS' : 'FAIL';
  }
  const record = input.byPacing.backToBack;
  const v = perPacing.backToBack;
  if (record === undefined || v === undefined)
    return { perPacing, verdict: 'NONE', official: false };
  if (v === 'INVALID')
    return { perPacing, verdict: 'INVALID', official: false, gpuBusy: record.gpuBusy };
  const why = !input.protocol
    ? 'not the D0-1 protocol'
    : !input.acThroughout
      ? 'the OS power source was not AC throughout'
      : undefined;
  return {
    perPacing,
    verdict: why === undefined ? v : `${v} (indicative: ${why})`,
    official: why === undefined,
    gpuBusy: record.gpuBusy,
  };
}

/** One run of the two-commit A/B (tools/lookdev/ab.ts). */
export interface AbRun {
  readonly ref: string;
  readonly pacing: Pacing;
  readonly rep: number;
}

/**
 * The A/B order: per repetition one pair per pacing, the two sides of a pair adjacent (so the
 * machine's drift hits both alike), the side that goes first alternating per repetition and
 * the pacing that leads alternating too.
 */
export function abOrder(
  refs: readonly [string, string],
  pacings: readonly Pacing[],
  reps: number,
): AbRun[] {
  const out: AbRun[] = [];
  for (let rep = 0; rep < reps; rep++) {
    const ps = rep % 2 === 0 ? pacings : [...pacings].reverse();
    for (const pacing of ps) {
      const [a, b] = rep % 2 === 0 ? refs : [refs[1], refs[0]];
      out.push({ ref: a, pacing, rep }, { ref: b, pacing, rep });
    }
  }
  return out;
}

export interface PairedDiff {
  /** a - b per pair, in repetition order. */
  readonly values: readonly number[];
  readonly median: number;
}

export interface AbPacingSummary {
  /** The pairs used: both sides VALID (W2L-I2). */
  readonly pairs: number;
  /** The repetitions of the pairs used, and of those dropped for an INVALID side. */
  readonly reps: readonly number[];
  readonly dropped: readonly number[];
  /** Each side's runs combined (the median of the runs, as combineReps). */
  readonly side: Readonly<Record<string, Combined>>;
  /** Per pass group and the total: the paired differences a - b. */
  readonly diff: Readonly<Record<PassGroup | 'gpuTotal', PairedDiff>>;
}

/**
 * The A/B result per pacing: both sides' medians and the paired differences refs[0] - refs[1],
 * over the pairs whose two runs are both VALID (W2L-I2: the official A/B of record had an
 * INVALID run in its pairs); no valid pair gives NaN, never a number.
 */
export function abSummary(
  refs: readonly [string, string],
  runs: readonly (AbRun & { readonly summary: RunSummary; readonly valid: boolean })[],
): Partial<Record<Pacing, AbPacingSummary>> {
  const out: Partial<Record<Pacing, AbPacingSummary>> = {};
  for (const pacing of PACINGS) {
    const mine = runs.filter((r) => r.pacing === pacing);
    if (mine.length === 0) continue;
    const allReps = [...new Set(mine.map((r) => r.rep))].sort((x, y) => x - y);
    const reps: number[] = [];
    const dropped: number[] = [];
    const pairs = allReps.flatMap((rep) => {
      const of = (ref: string) => mine.find((r) => r.rep === rep && r.ref === ref);
      const a = of(refs[0]);
      const b = of(refs[1]);
      if (a === undefined || b === undefined)
        throw new Error(`abSummary: ${pacing} repetition ${String(rep)} is not a pair`);
      if (!a.valid || !b.valid) {
        dropped.push(rep);
        return [];
      }
      reps.push(rep);
      return [[a.summary, b.summary] as const];
    });
    const paired = (pick: (s: RunSummary) => number): PairedDiff => {
      const values = pairs.map(([a, b]) => pick(a) - pick(b));
      return { values, median: med(values) };
    };
    const diff = { gpuTotal: paired((s) => s.gpuTotal.p50) } as Record<
      PassGroup | 'gpuTotal',
      PairedDiff
    >;
    for (const g of PASS_GROUPS) diff[g] = paired((s) => s.gpu[g].p50);
    out[pacing] = {
      pairs: pairs.length,
      reps,
      dropped,
      side: {
        [refs[0]]: combineReps(pairs.map(([a]) => a)),
        [refs[1]]: combineReps(pairs.map(([, b]) => b)),
      },
      diff,
    };
  }
  return out;
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

/**
 * W2L-I2: a config's result over its VALID runs only (`used`: their indices), and whether every
 * run was valid; no valid run gives NaN, never a number from an INVALID run.
 */
export function combineValid(
  runs: readonly RunSummary[],
  validity: readonly Validity[],
): { combined: Combined; used: number[]; valid: boolean } {
  const used = runs.flatMap((_, i) => (validity[i]?.valid === true ? [i] : []));
  return {
    combined: combineReps(used.flatMap((i) => runs[i] ?? [])),
    used,
    valid: used.length === runs.length,
  };
}

/**
 * D2-11 / D3-6 for one run, from its rAF intervals, the time the page was hidden and the
 * times it lost focus (D3-6's blur rule, which W2L-I5 brings to look-dev captures).
 */
export function runValidityOf(
  rafDeltasMs: readonly number[],
  displayMs: number,
  hiddenMs: number,
  pageBlurs = 0,
): Validity {
  const h = frameHealth(rafDeltasMs, displayMs);
  const v = runValidity(
    {
      frameTime: { p50: med(rafDeltasMs) },
      longestThrottledMs: h.longestThrottledMs,
      longestOcclusionMs: h.longestOcclusionMs,
      displayIntervalMs: displayMs,
    },
    hiddenMs,
    pageBlurs,
  );
  return v.valid
    ? v
    : { ...v, reasons: v.reasons.map((r) => `INVALID (occluded or hidden): ${r}`) };
}
