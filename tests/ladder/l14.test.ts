// Ladder L14 (PHYSICS.md 3.3, D5-2; W2S-I1): the hot gas pocket on the f64 oracle.
//
// With SOLVER.md 17's local step (each face's eigenvalue the larger of its two cells' preconditioned
// spectral radii) every case is finite to 2000 iterations (before it the eight moving cases went
// non-finite at iteration 1); with the slip-wall ghost's rho' and Z mirrored (D5-5, SOLVER.md 5)
// no wall cell drains its fuel and entropy (round 1's undershoots of -0.045 to -0.077 dT and the
// 1.39 overshoot); and the peak row reads against the start's hot gas compressed isentropically to
// each cell's pressure (D5-5's restatement: the -300 m/s slug's leading edge compresses). Every row
// of every case passes, so round 1's KNOWN-FAIL pin is lifted (w3/scheme round 2). Round 3 (D5-6):
// "max T' at 2000 <= its start" is read to a stated f64 round-off allowance (W3S-N1: the at-rest
// case is a rest state to round-off, END_ROUND_OFF_ALLOWANCE in hotPocket.ts), and each case's peak
// p' is a fifth, reported row (W3S-N3).
import { describe, expect, it } from 'vitest';
import type { LadderRow } from './common';
import { runCase, type CaseResult } from './spawn';

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
  const expectPass = (sel: readonly LadderRow[]) => {
    for (const r of sel) expect(r.pass, `${r.metric} = ${r.value} (${r.threshold})`).toBe(true);
  };

  it('every case: finite with rho > 0 to 2000 iterations (W2S-I1, SOLVER.md 17)', async () => {
    const sel = (await rows()).filter((r) => r.metric.includes('finite with rho > 0'));
    expect(sel.length).toBe(10);
    expectPass(sel);
  });

  it('every row of every case (the rule as pre-registered, the peak row as restated by D5-5)', async () => {
    const all = await rows();
    const gated = all.filter((r) => r.pass !== 'reported');
    expect(gated.length).toBe(4 * 10);
    expect(all.length).toBe(5 * 10);
    expectPass(gated);
  });
});
