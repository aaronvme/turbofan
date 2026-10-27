// The L4b grid-convergence study (decision D4-9, PHYSICS.md 3.3 "CPU variants", pre-registered
// before the runs): the shock case on 120 x 12, 170 x 17 and 240 x 24 cells, the shock position
// error against the cell size, and its Richardson extrapolation from the three grids. A study run by
// hand (node --import ./tools/mesh/ts-resolve.mjs tests/ladder/runCase.ts l4bgrid), about an hour.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import type { LadderRow } from '../common';
import { shockCase } from './l4b';

const GRIDS = [
  [120, 12, 12000],
  [170, 17, 17000],
  [240, 24, 24000],
] as const;

export function run() {
  const L4 = THRESHOLDS.L4.values;
  const results = GRIDS.map(([ni, nj, cap]) => ({ ni, nj, ...shockCase(ni, nj, cap) }));
  // signed errors e_k = (x_s - 0.2) / (2 L); ratio sqrt(2); observed order from three grids
  const e = results.map((r) => (r.xs - 0.2) / 0.8);
  const [e1, e2, e3] = e as [number, number, number];
  const ratio = Math.SQRT2;
  const order = Math.log(Math.abs((e1 - e2) / (e2 - e3))) / Math.log(ratio);
  const limit = e3 + (e3 - e2) / (ratio ** order - 1);
  const rows: LadderRow[] = results.map((r) => ({
    id: 'L4b grid',
    metric: `${r.ni} x ${r.nj}: shock position error / length (converged: ${String(r.conv.converged)})`,
    threshold: `< ${L4.maxShockPositionFractionOfLength.value}`,
    value: r.frac,
    pass: 'reported' as const,
  }));
  rows.push({
    id: 'L4b grid',
    metric: `Richardson limit h -> 0 (observed order ${order.toFixed(2)})`,
    threshold: `< ${L4.maxShockPositionFractionOfLength.value}`,
    value: Math.abs(limit),
    pass: 'reported',
  });
  return { id: 'L4b-grid', rows, extra: { results, order, limit } };
}
