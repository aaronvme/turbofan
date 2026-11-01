// D4-96 item 4: the indicative flow-visuals timing row (tests/browser/flowViz.test.ts, "[timing]
// the default preset at 1080p, back to back"). The iGPU shares power with the CPU (D0-1), and the
// row failed three times under another builder's concurrent GPU work (tracers 3.27, 3.44 and
// 2.95 ms) while it measured 1.20 ms quiet (critic pass 16). So it records on every run and fails
// the suite only in a quiet run, flagged VITE_UI_QUIET=1 as app-ui's W2A-N16 does for the UI
// wall-time bars. The bar stays D4-2's FLOW_VISUALS_BUDGET_MS, and the measure of record stays the
// official P4 / P4flow capture under D0-1.

import { FLOW_VISUALS_BUDGET_MS } from './modes';

/** The row's two readings, ms: the visuals at the default (no tracers) and with the tracers on. */
export interface FlowTimingReading {
  readonly visualsMs: number;
  readonly tracersMs: number;
}

/** Whether this run is a quiet one (W2A-N16's flag, exactly "1"). */
export function quietRun(env: Readonly<Record<string, string | undefined>> | undefined): boolean {
  return env?.VITE_UI_QUIET === '1';
}

/**
 * What fails the suite: a reading that measured nothing (not finite, or negative) on every run,
 * and a reading over the bar only in a quiet run.
 */
export function flowTimingProblems(r: FlowTimingReading, quiet: boolean): string[] {
  const problems: string[] = [];
  for (const [name, ms] of [
    ['visuals', r.visualsMs],
    ['tracers', r.tracersMs],
  ] as const) {
    if (!(Number.isFinite(ms) && ms >= 0)) problems.push(`${name}: no reading (${String(ms)})`);
    else if (quiet && ms > FLOW_VISUALS_BUDGET_MS)
      problems.push(
        `${name} ${ms.toFixed(3)} ms > ${String(FLOW_VISUALS_BUDGET_MS)} ms (quiet run)`,
      );
  }
  return problems;
}
