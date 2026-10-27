// Ladder L4 (PHYSICS.md 3.3), part (b): a normal shock in the diverging section, positioned by
// the back pressure that quasi-1D theory gives for a shock at x = 0.2 m.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import { converge, report } from './common';
import { GAMMA, LN, P0, areaRatioAt, columns, nozzleSolver, quasi1d } from './nozzle';
import { machFromArea, normalShock, pOverP0 } from './theory';

const L4 = THRESHOLDS.L4.values;
const XS = 0.2;

describe('L4b: normal shock position in the diverging section', () => {
  it('lies within 2% of the nozzle length of quasi-1D theory', () => {
    const M1 = machFromArea(areaRatioAt(XS), GAMMA, true);
    const shock = normalShock(M1, GAMMA);
    const aStar2 = 1 / shock.p02p01;
    const Me = machFromArea(areaRatioAt(LN) / aStar2, GAMMA, false);
    const pExit = P0 * shock.p02p01 * pOverP0(Me, GAMMA);
    const s = nozzleSolver(pExit);
    s.setState((x, r) =>
      quasi1d(x, r, (xx) =>
        xx < XS
          ? { p0: P0, aStar: 1, supersonic: xx > 0 }
          : { p0: P0 * shock.p02p01, aStar: aStar2, supersonic: false },
      ),
    );
    const conv = converge(s, 1e-5, 12000);
    const p1 = P0 * pOverP0(M1, GAMMA);
    const mid = 0.5 * (p1 + p1 * shock.p2p1);
    const cols = columns(s);
    let xs = NaN;
    for (let i = 1; i < cols.length; i++) {
      const a = cols[i - 1];
      const b = cols[i];
      if (a === undefined || b === undefined || a.x <= 0) continue;
      if (a.p < mid && b.p >= mid) {
        xs = a.x + ((mid - a.p) / (b.p - a.p)) * (b.x - a.x);
        break;
      }
    }
    const frac = Math.abs(xs - XS) / (2 * LN);
    report(
      'L4b',
      [
        {
          id: 'L4',
          metric: 'normal-shock position error / nozzle length',
          threshold: `< ${L4.maxShockPositionFractionOfLength.value}`,
          value: frac,
          pass: frac < L4.maxShockPositionFractionOfLength.value,
        },
      ],
      { conv, xs, pExit },
    );
    expect(conv.converged).toBe(true);
    expect(frac).toBeLessThan(L4.maxShockPositionFractionOfLength.value);
  });
});
