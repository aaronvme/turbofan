// D4-96 item 4: the indicative flow-visuals timing row (tests/browser/flowViz.test.ts, "[timing]
// the default preset at 1080p, back to back") records on every run and fails the suite only in a
// quiet run (VITE_UI_QUIET=1, the flag app-ui's W2A-N16 gates its wall-time bars with). The bar
// stays D4-2's 2 ms; the measure of record stays the official P4 / P4flow run.
import { describe, expect, it } from 'vitest';
import { FLOW_VISUALS_BUDGET_MS } from '../../../../src/flow/viz/modes';
import { flowTimingProblems, quietRun } from '../../../../src/flow/viz/timingRow';

describe('D4-96: the indicative flow timing row', () => {
  it('keeps the bar at D4-2 (2 ms)', () => {
    expect(FLOW_VISUALS_BUDGET_MS).toBe(2);
  });

  it('fails a forced slow value under the quiet flag, the visuals and the tracers each', () => {
    const slow = flowTimingProblems({ visualsMs: 0.7, tracersMs: 3.44 }, true);
    expect(slow).toHaveLength(1);
    expect(slow[0]).toMatch(/tracers 3\.440 ms > 2 ms/);
    const both = flowTimingProblems({ visualsMs: 2.01, tracersMs: 2.5 }, true);
    expect(both).toHaveLength(2);
    expect(both[0]).toMatch(/visuals 2\.010 ms > 2 ms/);
  });

  it('passes the same values on a loaded run: recorded, not gated', () => {
    expect(flowTimingProblems({ visualsMs: 0.7, tracersMs: 3.44 }, false)).toEqual([]);
    expect(flowTimingProblems({ visualsMs: 9, tracersMs: 9 }, false)).toEqual([]);
  });

  it('passes the bar itself and below under the flag', () => {
    expect(flowTimingProblems({ visualsMs: 2, tracersMs: 2 }, true)).toEqual([]);
    expect(flowTimingProblems({ visualsMs: 0.69, tracersMs: 1.2 }, true)).toEqual([]);
  });

  it('fails a reading that measured nothing on every run, quiet or not', () => {
    for (const quiet of [true, false]) {
      expect(flowTimingProblems({ visualsMs: Number.NaN, tracersMs: 1 }, quiet)).toHaveLength(1);
      expect(
        flowTimingProblems({ visualsMs: 1, tracersMs: Number.POSITIVE_INFINITY }, quiet),
      ).toHaveLength(1);
      expect(flowTimingProblems({ visualsMs: -1, tracersMs: 1 }, quiet)).toHaveLength(1);
    }
  });

  it('reads the quiet flag as app-ui does: VITE_UI_QUIET exactly "1"', () => {
    expect(quietRun({ VITE_UI_QUIET: '1' })).toBe(true);
    for (const env of [{}, { VITE_UI_QUIET: '0' }, { VITE_UI_QUIET: 'true' }, undefined])
      expect(quietRun(env)).toBe(false);
  });
});
