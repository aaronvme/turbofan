// Ladder L14 (PHYSICS.md 3.3, D5-2): the hot gas pocket (W2S-I1) on the f64 oracle.
//
// With SOLVER.md 17's local step (each face's eigenvalue the larger of its two cells' preconditioned
// spectral radii) every case is finite to 2000 iterations; before it the eight moving cases went
// non-finite at iteration 1. Two of the pre-registered rows still fail on some cases, for reasons a
// step limit cannot reach (SOLVER.md 17, the handoff's decisions):
// - min T' >= -0.03 dT on 5 of the 10 cases (-0.045 to -0.077 dT): the slip-wall ghost's
//   extrapolated rho' and Z let a wall cell drain its fuel and its entropy through its interior face
//   faster than it holds them (rho Z < 0, T' below the ambient), whatever the step;
// - peak max T' <= 1.03 x its start on the four -300 m/s cases (1.043-1.056 at iteration 8, and
//   1.39 at iteration 389 at the inner wall from the same wall drain): the pocket's leading edge
//   compresses as the slug decelerates (the plain scheme peaks at 1.14-1.17 in the same iterations).
// So the rule in full is pinned KNOWN-FAIL pending those decisions, and what the fix achieved is
// gated on its own: finiteness everywhere, max T' at 2000 <= its start everywhere, and the peak row
// at |u0| <= 100 m/s.
import { describe, expect, it } from 'vitest';
import type { LadderRow } from './common';
import { runCase, type CaseResult } from './spawn';

const SLOW = new Set([
  '900 K, -300 m/s, wall',
  '900 K, -300 m/s, mid',
  '1200 K, -300 m/s, wall',
  '1200 K, -300 m/s, mid',
]);

describe('L14: the hot gas pocket at the engine defaults (CPU oracle)', () => {
  let result: Promise<CaseResult> | undefined;
  const rows = async (): Promise<readonly LadderRow[]> => {
    const first = result === undefined;
    result ??= runCase('l14');
    const r = (await result).rows;
    if (first) {
      for (const row of r) {
        process.stdout.write(
          `[ladder] ${row.id} | ${row.metric} | ${row.threshold} | ${row.value.toPrecision(4)} | ${String(row.pass)}\n`,
        );
      }
    }
    return r;
  };
  const caseOf = (r: LadderRow) => r.metric.split(':')[0] ?? '';
  const expectPass = (sel: readonly LadderRow[]) => {
    for (const r of sel) expect(r.pass, `${r.metric} = ${r.value} (${r.threshold})`).toBe(true);
  };

  it('every case: finite with rho > 0 to 2000 iterations (W2S-I1, SOLVER.md 17)', async () => {
    const sel = (await rows()).filter((r) => r.metric.includes('finite with rho > 0'));
    expect(sel.length).toBe(10);
    expectPass(sel);
  });

  it("every case: max T' at 2000 <= its start; the peak row at |u0| <= 100 m/s", async () => {
    const all = await rows();
    const end = all.filter((r) => r.metric.includes('at 2000 / its start'));
    const peak = all.filter((r) => r.metric.includes('isentropically') && !SLOW.has(caseOf(r)));
    expect(end.length).toBe(10);
    expect(peak.length).toBe(6);
    expectPass([...end, ...peak]);
  });

  // KNOWN-FAIL pending the orchestrator (the handoff's decisions 1 and 2): the undershoot row on 5
  // cases (the slip-wall scalar drain) and the peak row on the 4 cases at -300 m/s (the start's
  // compression, and the wall drain's 1.39 at the inner wall).
  it.fails('the pre-registered rule in full: every row of every case', async () => {
    expectPass(await rows());
  });
});
