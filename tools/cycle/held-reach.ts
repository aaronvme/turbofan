// W2H-B1 / D4-92: critic pass 15's scenario on the DEFAULT reference model, over the app's frame
// steps: ISA SLS (or --ambient-k=<K>), take-off at 3 s, Surge at 10 s, Flameout at 20 s and the auto
// relight, 35 s. Per frame step it prints each held episode (its start, its length in sim time, the
// peak N1 while held), the longest hold, the peak N1 held, the lost solves, the worst step's
// gas-path evaluations, and a throw if the model throws. Episodes are counted at step level, as
// critic pass 15's probe counts them: consecutive steps whose state is 'held'.
//
//   node --import ./tools/mesh/ts-resolve.mjs tools/cycle/held-reach.ts [--ambient-k=318.15]
//     [--dt=0.02,0.025] [--unbounded] [--escalate-after=<s> | --no-escalate] [--json=<file>]
//
// --escalate-after sets D4-92 (c)'s escalation (--no-escalate: never, the round-1 policy with the
// redline bound), on a checkout that has it. Each row also lists the distinct lost-solve causes the
// model reported (CycleDiagnostics.lostSolveCause, where the checkout has it), with their counts.
//
// It reads only the public model API, so the same script measures a checkout before and after.

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ISA_SLS } from '../../src/contracts/ambient';
import { DEFAULT_CYCLE_INPUTS } from '../../src/contracts/cycle';
import * as engine from '../../src/cycle/engine';
import * as retry from '../../src/cycle/heldRetry';
import { createCycleModel } from '../../src/cycle/model';

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const evaluations = (): number => {
  const f = (engine as Record<string, unknown>).gasPathEvaluations;
  return typeof f === 'function' ? (f as () => number)() : NaN;
};

/** D4-92 (b)'s frame steps: 1/120 to 1/30 s, with the steps critic pass 15 found running away. */
const DEFAULT_DTS = [1 / 120, 1 / 60, 0.02, 0.0205, 0.021, 0.025, 1 / 30];
const dts = arg('dt')?.split(',').map(Number) ?? DEFAULT_DTS;
const ambientK = Number(arg('ambient-k') ?? ISA_SLS.temperatureK);
const ambient = { ...ISA_SLS, temperatureK: ambientK };
const escalateAfter = flag('no-escalate') ? Infinity : arg('escalate-after');
const heldRetry = {
  ...(flag('unbounded') ? retry.UNBOUNDED_RETRY : {}),
  ...(escalateAfter === undefined ? {} : { escalateAfterS: Number(escalateAfter) }),
};
const opts = Object.keys(heldRetry).length > 0 ? { heldRetry } : {};
const SECONDS = 35;

interface Episode {
  startS: number;
  lengthS: number;
  maxN1Percent: number;
}
interface Row {
  dtS: number;
  episodes: Episode[];
  longestS: number;
  maxN1HeldPercent: number;
  maxN1Percent: number;
  lostSolves: number;
  maxStepEvaluations: number;
  maxStepMs: number;
  threw: string | null;
  wallS: number;
  /** Each distinct lost-solve cause (numbers stripped) and the held steps that reported it. */
  causes: Record<string, number>;
}

function run(dt: number): Row {
  const warn = console.warn;
  console.warn = () => undefined;
  const m = createCycleModel(opts);
  m.reset('groundIdle', ambient);
  const base = { ...DEFAULT_CYCLE_INPUTS, fuelLever: 'run' as const, ignition: 'auto' as const };
  const episodes: Episode[] = [];
  let open: Episode | null = null;
  let maxN1 = 0;
  let lost = 0;
  let maxEv = 0;
  let maxMs = 0;
  let threw: string | null = null;
  const causes: Record<string, number> = {};
  const causeOf = (): string | null => {
    const f = (m as { lostSolveCause?: () => string | null }).lostSolveCause;
    return typeof f === 'function' ? f.call(m) : null;
  };
  const w0 = performance.now();
  const n = Math.round(SECONDS / dt);
  let t = 0;
  try {
    for (let i = 0; i < n; i++) {
      t = i * dt;
      if (Math.abs(t - 10) < dt / 2) m.injectFault('surge');
      if (Math.abs(t - 20) < dt / 2) m.injectFault('flameout');
      const e0 = evaluations();
      const s0 = performance.now();
      const s = m.step(dt, { ...base, ambient, throttleLever: t < 3 ? 0 : 1 });
      maxMs = Math.max(maxMs, performance.now() - s0);
      maxEv = Math.max(maxEv, evaluations() - e0);
      maxN1 = Math.max(maxN1, s.n1Percent);
      lost = s.gasPathSolve.lostSolves;
      if (s.gasPathSolve.status === 'held') {
        const cause = (causeOf() ?? 'unknown').replace(/-?[0-9][0-9.e+-]*/g, '#');
        causes[cause] = (causes[cause] ?? 0) + 1;
        if (open === null) {
          open = { startS: t, lengthS: 0, maxN1Percent: 0 };
          episodes.push(open);
        }
        open.lengthS += dt;
        open.maxN1Percent = Math.max(open.maxN1Percent, s.n1Percent);
      } else open = null;
    }
  } catch (e) {
    threw = `at t ${t.toFixed(3)} s: ${e instanceof Error ? e.message : String(e)}`;
  }
  console.warn = warn;
  return {
    dtS: dt,
    episodes,
    longestS: Math.max(0, ...episodes.map((e) => e.lengthS)),
    maxN1HeldPercent: Math.max(0, ...episodes.map((e) => e.maxN1Percent)),
    maxN1Percent: maxN1,
    lostSolves: lost,
    maxStepEvaluations: maxEv,
    maxStepMs: maxMs,
    threw,
    wallS: (performance.now() - w0) / 1000,
    causes,
  };
}

const say = (line: string) =>
  process.stdout.write(`${line}
`);
const rows: Row[] = [];
say(
  `ambient ${ambientK} K, ${flag('unbounded') ? 'UNBOUNDED_RETRY' : 'default policy'}` +
    `${escalateAfter === undefined ? '' : `, escalate after ${escalateAfter} s`}, ${SECONDS} s`,
);
for (const dt of dts) {
  const r = run(dt);
  rows.push(r);
  const eps = r.episodes
    .map((e) => `${e.startS.toFixed(2)}+${e.lengthS.toFixed(3)}s/N1 ${e.maxN1Percent.toFixed(1)}`)
    .join(', ');
  say(
    `dt ${dt.toFixed(4)}: longest ${r.longestS.toFixed(3)} s, max N1 held ${r.maxN1HeldPercent.toFixed(1)} %, ` +
      `max N1 ${r.maxN1Percent.toFixed(1)} %, lost ${r.lostSolves}, worst step ${r.maxStepEvaluations} ev ` +
      `${r.maxStepMs.toFixed(1)} ms, wall ${r.wallS.toFixed(1)} s${r.threw ? ` | THREW ${r.threw}` : ''}`,
  );
  if (eps) say(`  episodes: ${eps}`);
  const cs = Object.entries(r.causes).map(([c, k]) => `${k}x ${c}`);
  if (cs.length > 0) say(`  causes (held steps): ${cs.join('; ')}`);
}
const out = arg('json');
if (out !== undefined) writeFileSync(out, JSON.stringify({ ambientK, opts, rows }, null, 2));
