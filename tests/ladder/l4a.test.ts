// Ladder L4 (PHYSICS.md 3.3), part (a): the supersonic nozzle: Mach against quasi-1D theory and
// the choked mass flow against ideal x Cd.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import { converge, report } from './common';
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
} from './nozzle';
import { chokedMassFlow, machFromArea } from './theory';

const L4 = THRESHOLDS.L4.values;

describe('L4a: axisymmetric converging-diverging nozzle, supersonic exit', () => {
  it('Mach within 1% of quasi-1D theory; choked mass flow within 0.5% of ideal x Cd', () => {
    const s = nozzleSolver(0.05 * P0);
    s.setState((x, r) => quasi1d(x, r, (xx) => ({ p0: P0, aStar: 1, supersonic: xx > 0 })));
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
    report(
      'L4a',
      [
        {
          id: 'L4',
          metric: 'max |M / M_quasi1D - 1| over columns',
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
      ],
      { conv, cd, mdot, ideal },
    );
    expect(conv.converged).toBe(true);
    expect(worst).toBeLessThan(L4.maxMachRelativeError.value);
    expect(mErr).toBeLessThan(L4.maxChokedMassFlowRelativeError.value);
  });
});
