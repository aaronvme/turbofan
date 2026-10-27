// L3 (PHYSICS.md 3.3, full size): cylindrical Sod against the independent 1D f64 reference.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { NP } from '../../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from '../../unit/flow/helpers';
import { runTo } from '../common';
import { radialSod } from '../radial1d';

export function run() {
  const L3 = THRESHOLDS.L3.values;
  const GAMMA = 1.4;
  const RGAS = 287.05287;
  const n = 400;
  const dr = 1 / n;
  const mesh = solverMesh(
    singleBlock(rectangle('cyl', 0, 2 * dr, 0, 1, 2, n), {
      imin: BC.SLIP_WALL,
      imax: BC.SLIP_WALL,
      jmin: BC.AXIS,
      jmax: BC.SLIP_WALL,
    }),
  );
  const s = new ReferenceSolver(mesh, {
    gas: caloricallyPerfectGas(GAMMA, RGAS),
    freeStream: { pressure: 1e5, temperature: 1e5 / RGAS, velocity: 0 },
  });
  const inner = { rho: 1, p: 1e5 };
  const outer = { rho: 0.125, p: 1e4 };
  s.setState((_, r) => ({ ...(r < 0.5 ? inner : outer), u: 0, v: 0, w: 0, z: 0 }));
  const tEnd = 0.2 / Math.sqrt(1e5 / 1);
  const steps = runTo(s, tEnd);
  const fine = 10;
  const ref = radialSod({
    n: fine * n,
    rMax: 1,
    rDiaphragm: 0.5,
    inner,
    outer,
    gamma: GAMMA,
    tEnd,
    cfl: 0.5,
  });
  const P = s.primitives();
  let err = 0;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    const rho = s.ref.rho + (P[NP * (j * 2)] ?? NaN); // column i = 0
    let avg = 0;
    for (let k = 0; k < fine; k++) avg += (ref.rho[fine * j + k] ?? NaN) / fine;
    err += Math.abs(rho - avg);
    sum += avg;
  }
  const l1 = err / sum;
  return {
    id: 'L3',
    rows: [
      {
        id: 'L3',
        metric: 'L1(rho) relative vs the 1D reference (4000 cells)',
        threshold: `< ${L3.maxDensityL1RelativeError.value}`,
        value: l1,
        pass: l1 < L3.maxDensityL1RelativeError.value,
      },
    ],
    extra: { steps },
  };
}
