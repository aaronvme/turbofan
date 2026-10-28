// L4 (a) (PHYSICS.md 3.3, full size): supersonic nozzle: Mach against quasi-1D theory and the
// choked mass flow against ideal x Cd.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { converge } from '../common';
import {
  GAMMA,
  K,
  LN,
  NI,
  NJ,
  P0,
  RGAS,
  RT,
  T0,
  areaRatioAt,
  columns,
  nozzleSolver,
  quasi1d,
} from '../nozzle';
import { chokedMassFlow, machFromArea } from '../theory';

/** L4 (a)'s set-up: the nozzle at 0.05 p0 from the quasi-1D state (also the D4-58 floor run). */
export function l4aSolver(storage: 'f64' | 'f32' = 'f64') {
  const s = nozzleSolver(0.05 * P0, NI, NJ, storage);
  s.setState((x, r) => quasi1d(x, r, (xx) => ({ p0: P0, aStar: 1, supersonic: xx > 0 })));
  return s;
}

export function run() {
  const L4 = THRESHOLDS.L4.values;
  const s = l4aSolver();
  const conv = converge(s, 1e-5, 8000);
  let worst = 0;
  for (const col of columns(s)) {
    const theory = machFromArea(areaRatioAt(col.x), GAMMA, col.x > 0);
    worst = Math.max(worst, Math.abs(col.mach / theory - 1));
  }
  let mdot = 0;
  for (let j = 0; j < NJ; j++) mdot += 2 * Math.PI * (s.faceFlux(0, 'i', NI / 2, j)[0] ?? NaN);
  // Hall (1962), axisymmetric throat, leading term: Cd = 1 - (g + 1) / (96 Rbar^2), Rbar = R_c / R_t
  const rBar = (LN / RT) ** 2 / K;
  const cd = 1 - (GAMMA + 1) / (96 * rBar * rBar);
  const ideal = chokedMassFlow(Math.PI * RT * RT, P0, T0, GAMMA, RGAS) * cd;
  const mErr = Math.abs(mdot / ideal - 1);
  return {
    id: 'L4a',
    rows: [
      {
        id: 'L4',
        metric: 'supersonic: max |M / M_quasi1D - 1| over columns',
        threshold: `< ${L4.maxMachRelativeError.value}`,
        value: worst,
        pass: worst < L4.maxMachRelativeError.value,
      },
      {
        id: 'L4',
        metric: 'choked mass flow vs ideal x Cd',
        threshold: `< ${L4.maxChokedMassFlowRelativeError.value}`,
        value: mErr,
        pass: mErr < L4.maxChokedMassFlowRelativeError.value,
      },
      {
        id: 'L4',
        metric: 'supersonic case: iterations to converge to 1e-5',
        threshold: '<= 8000',
        value: conv.iterations,
        pass: conv.converged,
      },
    ],
    extra: { conv, cd, mdot, ideal },
  };
}
