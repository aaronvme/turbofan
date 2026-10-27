// L5 (PHYSICS.md 3.3, full size): choking through a blockage-only row (docs/SOLVER.md section 8,
// no force), mass flow against area theory.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { caloricallyPerfectGas } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { BC, rectangle, singleBlock, solverMesh } from '../../unit/flow/helpers';
import { converge } from '../common';
import { chokedMassFlow, machFromArea, pOverP0, tOverT0 } from '../theory';

export function run() {
  const L5 = THRESHOLDS.L5.values;
  const GAMMA = 1.4;
  const RGAS = 287.05287;
  const P0 = 1e5;
  const T0 = 288.15;
  const B_MIN = 0.8;
  const blockage = (x: number): number =>
    Math.abs(x) < 0.1 ? 1 - (1 - B_MIN) * Math.cos((Math.PI * x) / 0.2) ** 2 : 1;
  const ni = 90;
  const nj = 4;
  const mesh = solverMesh(
    singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, ni, nj), {
      imin: BC.INFLOW,
      imax: BC.OUTFLOW,
      jmin: BC.SLIP_WALL,
      jmax: BC.SLIP_WALL,
    }),
  );
  const s = new ReferenceSolver(mesh, {
    gas: caloricallyPerfectGas(GAMMA, RGAS),
    freeStream: { pressure: P0, temperature: T0, velocity: 0 },
    inflowTotal: { p0: P0, t0: T0 },
    outflowPressure: 0.2 * P0,
  });
  s.setBlockage(Float64Array.from(mesh.cellX, blockage));
  s.setState((x) => {
    const M = machFromArea(blockage(x) / B_MIN, GAMMA, x > 0);
    const T = T0 * tOverT0(M, GAMMA);
    const p = P0 * pOverP0(M, GAMMA);
    return { rho: p / (RGAS * T), u: M * Math.sqrt(GAMMA * RGAS * T), v: 0, w: 0, p, z: 0 };
  });
  const conv = converge(s, 1e-5, 8000);
  let mdot = 0;
  for (let j = 0; j < nj; j++) mdot += 2 * Math.PI * (s.faceFlux(0, 'i', ni / 2, j)[0] ?? NaN);
  const theory = chokedMassFlow(B_MIN * Math.PI * (0.6 ** 2 - 0.5 ** 2), P0, T0, GAMMA, RGAS);
  const err = Math.abs(mdot / theory - 1);
  return {
    id: 'L5',
    rows: [
      {
        id: 'L5',
        metric: 'mass flow vs b_min A rho* u*',
        threshold: `< ${L5.maxMassFlowRelativeError.value}`,
        value: err,
        pass: err < L5.maxMassFlowRelativeError.value,
      },
      {
        id: 'L5',
        metric: 'iterations to converge to 1e-5',
        threshold: '<= 8000',
        value: conv.iterations,
        pass: conv.converged,
      },
    ],
    extra: { conv, mdot, theory },
  };
}
