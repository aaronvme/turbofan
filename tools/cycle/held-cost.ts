// W2F-N5 / D4-84: what a held gas-path step costs, in Node, on the case the app measured: the
// W1K-I2 part-power fit (PART_POWER_FIT_CALIBRATION) at ground idle, the lever ramped from idle to
// take-off over 1 s of sim time (tests/browser/app.test.tsx's W2F-N5 row), stepped at the app's
// 60 Hz frame. Wall time is indicative (a shared machine); the solver-call count is deterministic.
//
//   node --import ./tools/mesh/ts-resolve.mjs tools/cycle/held-cost.ts [--seconds=20] [--json=<file>]
//
// It reads only the public model API, so the same script measures a checkout before and after.

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ISA_SLS } from '../../src/contracts/ambient';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../../src/contracts/cycle';
import * as engine from '../../src/cycle/engine';
import { createCycleModel } from '../../src/cycle/model';
import { withCalibration } from '../../src/cycle/partPower';

const { PART_POWER_FIT_CALIBRATION, referenceEngine, solveGasPath } = engine;
/** The gas-path evaluation count (D4-84 meter) where the checkout has one, else NaN. */
const evaluations = (): number => {
  const f = (engine as Record<string, unknown>).gasPathEvaluations;
  return typeof f === 'function' ? (f as () => number)() : NaN;
};

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SECONDS = Number(arg('seconds') ?? '20');
const JSON_OUT = arg('json');
const DT = 1 / 60;
/** The app boots at idle and the browser row waits 3 s before the ramp. */
const IDLE_S = 3;
/** Held steps above this N1 are the held power balance running the spool away (D4-17). */
const ENVELOPE_N1_PERCENT = 105;

let calls = 0;
const counting: typeof solveGasPath = (...a) => {
  calls++;
  return solveGasPath(...a);
};
const m = createCycleModel({
  engine: withCalibration(referenceEngine(), PART_POWER_FIT_CALIBRATION),
  gasPathSolver: counting,
});
m.reset('groundIdle', ISA_SLS);
const inputs = (lever: number): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  throttleLever: lever,
});

interface Step {
  t: number;
  ms: number;
  calls: number;
  evals: number;
  held: boolean;
  lost: number;
  n1: number;
  n2: number;
}
const steps: Step[] = [];
const n = Math.round((IDLE_S + SECONDS) / DT);
for (let i = 0; i < n; i++) {
  const t = i * DT;
  const lever = t < IDLE_S ? 0 : Math.max(0.01, Math.min(1, t - IDLE_S));
  const c0 = calls;
  const e0 = evaluations();
  const w0 = performance.now();
  const s = m.step(DT, inputs(lever));
  const ms = performance.now() - w0;
  steps.push({
    t: s.timeS,
    ms,
    calls: calls - c0,
    evals: evaluations() - e0,
    held: s.gasPathSolve.status === 'held',
    lost: s.gasPathSolve.lostSolves,
    n1: s.n1Percent,
    n2: s.n2Percent,
  });
}

const q = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? NaN;
};
const stats = (xs: readonly number[]) => ({
  n: xs.length,
  median: q(xs, 0.5),
  p95: q(xs, 0.95),
  max: xs.length === 0 ? NaN : Math.max(...xs),
});

/** Held episodes: runs of held steps, with how long the solve took to recover. */
interface Episode {
  fromS: number;
  n2Percent: number;
  heldSteps: number;
  recoveredAfterS: number | null;
  maxStepMs: number;
  maxStepCalls: number;
}
const episodes: Episode[] = [];
steps.forEach((s, i) => {
  if (!s.held) return;
  const prev = steps[i - 1];
  if (prev === undefined || !prev.held) {
    episodes.push({
      fromS: s.t - DT,
      n2Percent: prev?.n2 ?? s.n2,
      heldSteps: 0,
      recoveredAfterS: null,
      maxStepMs: 0,
      maxStepCalls: 0,
    });
  }
  const ep = episodes[episodes.length - 1];
  if (ep === undefined) return;
  ep.heldSteps++;
  ep.maxStepMs = Math.max(ep.maxStepMs, s.ms);
  ep.maxStepCalls = Math.max(ep.maxStepCalls, s.calls);
  const next = steps[i + 1];
  if (next !== undefined && !next.held) ep.recoveredAfterS = next.t - ep.fromS;
});

const held = steps.filter((s) => s.held);
const heldInEnvelope = held.filter((s) => s.n1 <= ENVELOPE_N1_PERCENT);
const matched = steps.filter((s) => !s.held);
const end = steps[steps.length - 1];
const record = {
  case: 'part-power fit, ground idle, lever 0 -> 1 over 1 s of sim, 60 Hz steps',
  rampStartS: IDLE_S,
  seconds: SECONDS,
  lostSolves: end?.lost ?? 0,
  heldSteps: held.length,
  episodes,
  heldStepMs: stats(held.map((s) => s.ms)),
  heldStepMsInEnvelope: stats(heldInEnvelope.map((s) => s.ms)),
  matchedStepMs: stats(matched.map((s) => s.ms)),
  heldStepCalls: stats(held.map((s) => s.calls)),
  matchedStepCalls: stats(matched.map((s) => s.calls)),
  heldStepEvaluations: stats(held.map((s) => s.evals)),
  matchedStepEvaluations: stats(matched.map((s) => s.evals)),
  msPerEvaluation: stats(steps.filter((s) => s.evals > 0).map((s) => s.ms / s.evals)),
  end: { n1Percent: m.state().n1Percent, status: m.state().gasPathSolve.status },
};
const f = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const line = (k: string, v: ReturnType<typeof stats>) =>
  `${k}: n ${v.n}, median ${f(v.median)}, p95 ${f(v.p95)}, max ${f(v.max)}`;
process.stdout.write(
  [
    record.case,
    `lost solves ${record.lostSolves}; held steps ${record.heldSteps} (ramp from ${IDLE_S} s)`,
    ...episodes.map(
      (e) =>
        `  episode from ${e.fromS.toFixed(2)} s at N2 ${e.n2Percent.toFixed(1)} %: ${e.heldSteps} held steps, recovered after ${e.recoveredAfterS === null ? 'never' : `${e.recoveredAfterS.toFixed(2)} s`}, worst step ${e.maxStepMs.toFixed(1)} ms / ${e.maxStepCalls} calls`,
    ),
    line('held step ms', record.heldStepMs),
    line(`held step ms, N1 <= ${ENVELOPE_N1_PERCENT} %`, record.heldStepMsInEnvelope),
    line('matched step ms', record.matchedStepMs),
    line('held step solver calls', record.heldStepCalls),
    line('matched step solver calls', record.matchedStepCalls),
    line('held step gas-path evaluations', record.heldStepEvaluations),
    line('matched step gas-path evaluations', record.matchedStepEvaluations),
    `ms per evaluation: median ${record.msPerEvaluation.median.toFixed(4)}`,
    `end N1 ${record.end.n1Percent.toFixed(2)} %, ${record.end.status}`,
    '',
  ].join('\n'),
);
if (JSON_OUT !== undefined) writeFileSync(JSON_OUT, `${JSON.stringify(record, null, 2)}\n`);
