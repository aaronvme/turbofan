import { describe, expect, it } from 'vitest';
import {
  axialVelocity,
  carterM,
  designRow,
  type RowAerodynamics,
  type RowEdges,
} from '../../../src/engine/bladeDesign';
import { COLD_GAS, HOT_GAS } from '../../../src/engine/designPoint';
import { R_AIR } from '../../../src/contracts/ambient';

const DEG = Math.PI / 180;

/** A radial row between r = 0.3 and 0.5 m, 40 mm of axial chord, flat walls. */
const EDGES: RowEdges = {
  leadingEdge: { hub: { x: 0, r: 0.3 }, tip: { x: 0, r: 0.5 } },
  trailingEdge: { hub: { x: 0.04, r: 0.3 }, tip: { x: 0.04, r: 0.5 } },
};
const R_MID = 0.4;

function stator(alphaIn: number, alphaOut: number, cx = 150): RowAerodynamics {
  return {
    omegaRadPerS: 0,
    inlet: { rcTheta: R_MID * cx * Math.tan(alphaIn), cxMPerS: cx },
    exit: { rcTheta: R_MID * cx * Math.tan(alphaOut), cxMPerS: cx },
    deviation: 'carter',
  };
}

describe('axialVelocity (continuity on the subsonic branch)', () => {
  const tt = 300;
  const pt = 150_000;

  it('satisfies continuity with the static state of the total velocity', () => {
    for (const cTheta of [0, 120, -200]) {
      const r = axialVelocity({
        wKgPerS: 40,
        ttK: tt,
        ptPa: pt,
        areaM2: 0.25,
        cThetaMPerS: cTheta,
        gas: COLD_GAS,
      });
      const c2 = r.cxMPerS ** 2 + cTheta ** 2;
      const t = tt - c2 / (2 * COLD_GAS.cpJPerKgK);
      const p = pt * (t / tt) ** (COLD_GAS.gamma / (COLD_GAS.gamma - 1));
      const rho = p / (R_AIR * t);
      expect(rho * r.cxMPerS * 0.25).toBeCloseTo(40, 6);
      expect(r.choked).toBe(false);
      expect(r.mach).toBeCloseTo(Math.sqrt(c2) / Math.sqrt(COLD_GAS.gamma * R_AIR * t), 9);
      expect(r.axialMach).toBeLessThan(1);
    }
  });

  it('recovers the Mach number of the isentropic flow function', () => {
    const g = COLD_GAS.gamma;
    const m = 0.5;
    const ff = Math.sqrt(g / R_AIR) * m * (1 + ((g - 1) / 2) * m * m) ** (-(g + 1) / (2 * (g - 1)));
    const area = (50 * Math.sqrt(tt)) / (ff * pt);
    const r = axialVelocity({
      wKgPerS: 50,
      ttK: tt,
      ptPa: pt,
      areaM2: area,
      cThetaMPerS: 0,
      gas: COLD_GAS,
    });
    expect(r.mach).toBeCloseTo(0.5, 6);
  });

  it('reports a choked plane (axial Mach 1) when the flow exceeds what the area can pass', () => {
    const r = axialVelocity({
      wKgPerS: 500,
      ttK: tt,
      ptPa: pt,
      areaM2: 0.1,
      cThetaMPerS: 100,
      gas: COLD_GAS,
    });
    expect(r.choked).toBe(true);
    expect(r.axialMach).toBeCloseTo(1, 6);
  });

  it('returns zero velocity for zero flow', () => {
    const r = axialVelocity({
      wKgPerS: 0,
      ttK: tt,
      ptPa: pt,
      areaM2: 0.1,
      cThetaMPerS: 0,
      gas: HOT_GAS,
    });
    expect(r.cxMPerS).toBe(0);
    expect(r.mach).toBe(0);
    expect(r.choked).toBe(false);
  });

  it('W0C-I4: rejects a swirl whose kinetic energy reaches the total enthalpy', () => {
    // cp = 0.5 makes c_theta^2 / (2 cp) = c_theta^2 exactly, so the static enthalpy hits 0
    const gas = { cpJPerKgK: 0.5, gamma: 1.4 };
    const at = (cTheta: number) => () =>
      axialVelocity({ wKgPerS: 1, ttK: 100, ptPa: pt, areaM2: 1, cThetaMPerS: cTheta, gas });
    expect(at(10)).toThrow(/axialVelocity: the swirl exceeds the total enthalpy/);
    expect(at(11)).toThrow(/the swirl exceeds the total enthalpy/);
    expect(at(9.9)).not.toThrow();
  });
});

describe("Carter's rule", () => {
  it('uses m = 0.23 (2a/c)^2 + stagger/500 with a/c = 0.5 (circular-arc camber line)', () => {
    expect(carterM(0)).toBeCloseTo(0.23, 12);
    expect(carterM(30 * DEG)).toBeCloseTo(0.29, 12);
    expect(carterM(-30 * DEG)).toBeCloseTo(0.29, 12); // depends on |stagger|
  });
});

describe('designRow', () => {
  it('free vortex: the flow angle at each span follows c_theta = (r c_theta) / r', () => {
    const aero = stator(40 * DEG, 0);
    const row = designRow(EDGES, aero, { targetSolidity: 1.2 });
    for (const [span, r] of [
      ['hub', 0.3],
      ['mid', 0.4],
      ['tip', 0.5],
    ] as const) {
      expect(Math.tan(row.inletFlowAngle[span])).toBeCloseTo(aero.inlet.rcTheta / r / 150, 9);
      expect(row.exitFlowAngle[span]).toBeCloseTo(0, 12);
    }
  });

  it('a decelerating stator: zero incidence, Carter deviation delta = m theta / sigma^0.5', () => {
    const row = designRow(EDGES, stator(45 * DEG, 0), { targetSolidity: 1.2 });
    expect(row.accelerating).toBe(false);
    for (const span of ['hub', 'mid', 'tip'] as const) {
      expect(row.inletMetalAngle[span]).toBeCloseTo(row.inletFlowAngle[span], 12);
      const camber = Math.abs(row.inletMetalAngle[span] - row.exitMetalAngle[span]);
      const m = carterM(row.stagger[span]);
      expect(row.deviation[span]).toBeCloseTo((m * camber) / Math.sqrt(row.solidity[span]), 9);
      // under-turned: the metal turns further than the flow, past axial here
      expect(row.exitMetalAngle[span]).toBeCloseTo(
        row.exitFlowAngle[span] - row.deviation[span],
        9,
      );
      expect(row.stagger[span]).toBeCloseTo(
        (row.inletMetalAngle[span] + row.exitMetalAngle[span]) / 2,
        12,
      );
    }
  });

  it('an accelerating row (an IGV adding swirl) uses delta = m theta / sigma', () => {
    const row = designRow(EDGES, stator(0, -30 * DEG), { targetSolidity: 1.0 });
    expect(row.accelerating).toBe(true);
    const camber = Math.abs(row.inletMetalAngle.mid - row.exitMetalAngle.mid);
    expect(row.deviation.mid).toBeCloseTo(
      (carterM(row.stagger.mid) * camber) / row.solidity.mid,
      9,
    );
    // turning toward -theta, so the metal exit angle is more negative than the flow's
    expect(row.exitMetalAngle.mid).toBeLessThan(row.exitFlowAngle.mid);
  });

  it('a turbine row follows the camber line (no deviation)', () => {
    const aero: RowAerodynamics = { ...stator(0, -65 * DEG, 200), deviation: 'none' };
    const row = designRow(EDGES, aero, { targetSolidity: 1.2 });
    for (const span of ['hub', 'mid', 'tip'] as const) {
      expect(row.deviation[span]).toBe(0);
      expect(row.exitMetalAngle[span]).toBeCloseTo(row.exitFlowAngle[span], 12);
    }
  });

  it('a rotor works in its own frame: w_theta = c_theta - omega r, mirrored with the rotation sign', () => {
    const base: RowAerodynamics = {
      omegaRadPerS: -500,
      inlet: { rcTheta: 0, cxMPerS: 150 },
      exit: { rcTheta: -0.4 * 100, cxMPerS: 150 },
      deviation: 'carter',
    };
    const neg = designRow(EDGES, base, { targetSolidity: 1.3 });
    expect(Math.tan(neg.inletFlowAngle.tip)).toBeCloseTo((500 * 0.5) / 150, 9);
    expect(neg.inletFlowAngle.mid).toBeGreaterThan(0);
    const mirrored = designRow(
      EDGES,
      { ...base, omegaRadPerS: 500, exit: { rcTheta: 0.4 * 100, cxMPerS: 150 } },
      { targetSolidity: 1.3 },
    );
    for (const span of ['hub', 'mid', 'tip'] as const) {
      expect(mirrored.inletMetalAngle[span]).toBeCloseTo(-neg.inletMetalAngle[span], 12);
      expect(mirrored.exitMetalAngle[span]).toBeCloseTo(-neg.exitMetalAngle[span], 12);
    }
    expect(mirrored.count).toBe(neg.count);
  });

  it('picks the count from the target solidity and derives chord from stagger', () => {
    const row = designRow(EDGES, stator(45 * DEG, 0), { targetSolidity: 1.25 });
    expect(Number.isInteger(row.count)).toBe(true);
    // rounding the count to whole blades moves the mid solidity by at most half a blade
    expect(Math.abs(row.solidity.mid - 1.25)).toBeLessThanOrEqual(
      row.solidity.mid / (2 * row.count) + 1e-9,
    );
    for (const span of ['hub', 'tip'] as const) {
      // chord x cos(stagger) is the meridional length (40 mm on these flat walls)
      expect(row.chord[span] * Math.cos(row.stagger[span])).toBeCloseTo(0.04, 9);
      expect(row.chord[span]).toBeGreaterThanOrEqual(0.04);
    }
  });

  it('keeps a given count (the fan has 24 blades)', () => {
    const row = designRow(EDGES, stator(45 * DEG, 0), { count: 24 });
    expect(row.count).toBe(24);
    expect(row.solidity.mid).toBeCloseTo((row.chord.mid * 24) / (2 * Math.PI * R_MID), 9);
  });

  it('rejects rows it cannot design', () => {
    expect(() => designRow(EDGES, stator(45 * DEG, 0), {})).toThrow(/count or a targetSolidity/);
    expect(() =>
      designRow(
        EDGES,
        { ...stator(0, 0), inlet: { rcTheta: 0, cxMPerS: 0 } },
        { targetSolidity: 1 },
      ),
    ).toThrow(/axial velocity/);
    // an accelerating row turned to 85 deg: the Carter deviation pushes the metal past 90 deg
    expect(() => designRow(EDGES, stator(0, -85 * DEG), { targetSolidity: 1 })).toThrow(
      /beyond 90 deg/,
    );
    // turning so large that Carter's rule has no solution at a tiny solidity
    expect(() => designRow(EDGES, stator(80 * DEG, -60 * DEG), { count: 1 })).toThrow(
      /designRow: Carter's rule has no solution at sigma/,
    );
    // W0C-I4: the exit axial velocity is checked as well as the inlet's
    expect(() =>
      designRow(
        EDGES,
        { ...stator(0, 0), exit: { rcTheta: 0, cxMPerS: 0 } },
        { targetSolidity: 1 },
      ),
    ).toThrow(/axial velocity must be > 0 at both edges/);
  });

  it('W0C-I4: a row that does not turn needs no deviation, even at a tiny solidity', () => {
    // Carter's k exceeds 1 at sigma ~ 0.04, but there is no turning to deviate from
    const row = designRow(EDGES, stator(30 * DEG, 30 * DEG), { count: 1 });
    expect(row.deviation).toEqual({ hub: 0, mid: 0, tip: 0 });
    // equal speeds in and out: a decelerating row in Carter's sense (n = 1/2), not accelerating
    expect(row.accelerating).toBe(false);
  });
});
