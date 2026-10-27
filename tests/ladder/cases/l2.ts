// L2 (PHYSICS.md 3.3, full size): axial Sod, 400 cells, against the exact solution.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { NP } from '../../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from '../../unit/flow/helpers';
import { runTo } from '../common';
import { exactRiemann } from '../theory';

export function run() {
  const L2 = THRESHOLDS.L2.values;
  const GAMMA = 1.4;
  const RGAS = 287.05287;
  const n = L2.cells.value;
  const mesh = solverMesh(
    singleBlock(rectangle('tube', 0, 1, 1.0, 1.1, n, 2), {
      imin: BC.SLIP_WALL,
      imax: BC.SLIP_WALL,
      jmin: BC.SLIP_WALL,
      jmax: BC.SLIP_WALL,
    }),
  );
  const s = new ReferenceSolver(mesh, {
    gas: caloricallyPerfectGas(GAMMA, RGAS),
    freeStream: { pressure: 1e5, temperature: 1e5 / RGAS, velocity: 0 },
  });
  const left = { rho: 1, u: 0, p: 1e5 };
  const right = { rho: 0.125, u: 0, p: 1e4 };
  s.setState((x) => ({ ...(x < 0.5 ? left : right), v: 0, w: 0, z: 0 }));
  const tEnd = 0.2 / Math.sqrt(1e5 / 1);
  const steps = runTo(s, tEnd);
  const exact = exactRiemann(left, right, GAMMA);
  const P = s.primitives();
  const dx = 1 / n;
  let err = 0;
  let sum = 0;
  const rho = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rho[i] = s.ref.rho + (P[NP * i] ?? NaN); // row j = 0
    let avg = 0;
    for (let k = 0; k < 32; k++) {
      avg += exact.sample(((i + (k + 0.5) / 32) * dx - 0.5) / tEnd).rho / 32;
    }
    err += Math.abs((rho[i] ?? NaN) - avg);
    sum += avg;
  }
  const l1 = err / sum;
  // the right-most crossing of the mean of the post- and pre-shock densities
  const mid = 0.5 * (exact.rhoStarR + right.rho);
  let xs = NaN;
  for (let i = n - 1; i > 0; i--) {
    const a = rho[i - 1] ?? NaN;
    const b = rho[i] ?? NaN;
    if (a >= mid && b < mid) {
      xs = (i - 0.5 + (a - mid) / (a - b)) * dx;
      break;
    }
  }
  const xsExact = 0.5 + exact.shockSpeedR * tEnd;
  const offset = Math.abs(xs - xsExact) / dx;
  return {
    id: 'L2',
    rows: [
      {
        id: 'L2',
        metric: 'L1(rho) relative',
        threshold: `< ${L2.maxDensityL1RelativeError.value}`,
        value: l1,
        pass: l1 < L2.maxDensityL1RelativeError.value,
      },
      {
        id: 'L2',
        metric: 'shock offset (cells)',
        threshold: `<= ${L2.maxShockOffsetCells.value}`,
        value: offset,
        pass: offset <= L2.maxShockOffsetCells.value,
      },
    ],
    extra: { steps, xs, xsExact },
  };
}
