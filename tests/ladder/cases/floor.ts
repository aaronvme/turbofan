// D4-58 (SOLVER.md 12.4): the oracle's f32-storage residual floors of L4 (a) and L5, the floors of
// D4-38's GPU stopping rule. Each set-up runs 20000 tracking iterations with the state rounded to f32
// after every stage, and once in f64; the floor is the minimum of the residual over the first
// iteration's, over the last 2000 iterations (round 7's measure, D4-47). Two checks per case:
// - the stated floor (tests/ladder/oracle.ts) is this measurement to two significant figures, so a
//   scheme change that moves the oracle's floor shows here and the floor is restated with it;
// - f64 falls at least 100x below it, so the plateau is the storage, not the scheme (D4-58).
import { GPU_CONVERGENCE_FLOOR } from '../oracle';
import type { ReferenceSolver } from '../../../src/flow/reference/solver';
import { l4aSolver } from './l4a';
import { l5Solver } from './l5';

const ITERATIONS = 20000;
const LAST = 2000;

/** min over the last LAST of ITERATIONS iterations of residual / first residual. */
function floorOf(s: ReferenceSolver): number {
  const first = s.iterate(1).residualDensityL2;
  let minR = Infinity;
  for (let it = 2; it <= ITERATIONS; it++) {
    const r = s.iterate(1).residualDensityL2;
    if (it > ITERATIONS - LAST) minR = Math.min(minR, r);
  }
  return minR / first;
}

export function run() {
  const cases = [
    { id: 'L4a' as const, make: l4aSolver },
    { id: 'L5' as const, make: l5Solver },
  ];
  const rows = cases.flatMap(({ id, make }) => {
    const stated = GPU_CONVERGENCE_FLOOR[id];
    const f32 = floorOf(make('f32'));
    const f64 = floorOf(make('f64'));
    return [
      {
        id: 'floor',
        metric: `${id} f32 storage: min residual / first over the last ${LAST} of ${ITERATIONS} iterations`,
        threshold: `= the D4-58 floor ${stated} (2 significant figures)`,
        value: f32,
        pass: Number(f32.toPrecision(2)) === stated,
      },
      {
        id: 'floor',
        metric: `${id} f64: min residual / first over the last ${LAST} of ${ITERATIONS} iterations`,
        threshold: `< floor / 100 = ${stated / 100}`,
        value: f64,
        pass: f64 < stated / 100,
      },
    ];
  });
  return { id: 'floor', rows };
}
