// Ladder L14's restated peak row (PHYSICS.md 3.3, amended by D5-5): for every cell and iteration
// T' <= 1.03 T'_s, with T'_s = T_h (p / p_inf)^((gamma - 1) / gamma) - T_inf the start's hot gas
// (T_h = T_inf + dT, Z 0.015) compressed isentropically to the cell's own pressure, gamma of the
// thermally perfect gas at T_h and Z 0.015. The row code is tests/ladder/hotPocket.ts, shared by the
// CPU and GPU ladders.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import {
  THERMALLY_PERFECT,
  cpMix,
  gasConstantMix,
  productsFraction,
} from '../../../src/flow/reference/gas';
import { NP, NU } from '../../../src/flow/reference/state';
import {
  HOT_POCKET_ITERATIONS,
  POCKET_Z,
  hotPocketRows,
  isentropicPocketBound,
  samplePocket,
  tracePocket,
  type HotPocketCase,
} from '../../ladder/hotPocket';

const P_INF = 101325;
const T_INF = 288.15;
const WALL_900: HotPocketCase = { dT: 900, u0: -300, where: 'wall' };

/** Primitive records of cells with the given (p', T'), every other entry 0, and U = 0. */
function field(cells: readonly (readonly [number, number])[]) {
  const P = new Float64Array(NP * cells.length);
  cells.forEach(([pG, tG], c) => {
    P[NP * c + 4] = pG;
    P[NP * c + 6] = tG;
  });
  return { P, U: new Float64Array(NU * cells.length), n: cells.length };
}

describe("L14's restated peak row: the isentropic compression bound (D5-5)", () => {
  it('is the 1.03 of PHYSICS.md 3.3 and the pocket fuel 0.015 of its set-up', () => {
    expect(THRESHOLDS.L14.values.maxPeakOverIsentropicCompression.value).toBe(1.03);
    expect(POCKET_Z).toBe(0.015);
  });

  it("is dT at p_inf and T_h (p / p_inf)^((gamma - 1) / gamma) - T_inf at the cell's pressure", () => {
    for (const dT of [900, 1200]) {
      const bound = isentropicPocketBound({ dT, u0: -100, where: 'mid' });
      expect(bound(0)).toBeCloseTo(dT, 9);
      const th = T_INF + dT;
      const phi = productsFraction(THERMALLY_PERFECT, 0.015);
      const cp = cpMix(THERMALLY_PERFECT, th, phi);
      const r = gasConstantMix(THERMALLY_PERFECT, phi);
      const k = r / cp; // (gamma - 1) / gamma with gamma = cp / (cp - R)
      for (const pG of [-20e3, 5e3, 11e3, 40e3]) {
        expect(bound(pG)).toBeCloseTo(th * ((P_INF + pG) / P_INF) ** k - T_INF, 9);
      }
    }
  });

  it('gives the 1.034 x dT that PHYSICS.md 3.3 quotes for 900 K at p′ = 11 kPa', () => {
    expect(isentropicPocketBound(WALL_900)(11e3) / 900).toBeCloseTo(1.034, 3);
  });

  it("samples max over cells of T' / T'_s and the cell it sits in", () => {
    const bound = isentropicPocketBound(WALL_900);
    const { P, U, n } = field([
      [0, 0],
      [11e3, 1.02 * bound(11e3)],
      [-5e3, 1.05 * bound(-5e3)],
      [0, 900],
    ]);
    const s = samplePocket(P, U, 1.225, n, bound);
    expect(s.overBound).toBeCloseTo(1.05, 12);
    expect(s.overBoundAt).toBe(2);
    expect(s.tMax).toBeCloseTo(1.02 * bound(11e3), 9);
  });

  it('fails a cell over 1.03 T′_s and passes one at 1.02 T′_s even above 1.03 x the start', async () => {
    const bound = isentropicPocketBound(WALL_900);
    const rowFor = async (over: number) => {
      const start = samplePocket(field([[0, 900]]).P, field([[0, 900]]).U, 1.225, 1, bound);
      // 11 kPa above p_inf: 1.02 x T'_s is 1.055 x the start, which the pre-registered row failed
      const late = field([[11e3, over * bound(11e3)]]);
      const t = await tracePocket(start, () => samplePocket(late.P, late.U, 1.225, 1, bound));
      expect(t.soundIterations).toBe(HOT_POCKET_ITERATIONS);
      const row = hotPocketRows(WALL_900, t).find((r) => r.metric.includes('isentropic'));
      expect(row).toBeDefined();
      return row;
    };
    const ok = await rowFor(1.02);
    expect(ok?.value).toBeCloseTo(1.02, 12);
    expect(ok?.pass).toBe(true);
    expect((1.02 * bound(11e3)) / 900).toBeGreaterThan(1.05);
    const bad = await rowFor(1.031);
    expect(bad?.pass).toBe(false);
  });

  it('fails a cell whose bound is not positive unless its T′ is below it', () => {
    const bound = isentropicPocketBound(WALL_900);
    // p / p_inf = 1e-4: T_h (1e-4)^0.25 is about 120 K, below T_inf, so T'_s < 0
    const pLow = 1e-4 * P_INF - P_INF;
    expect(bound(pLow)).toBeLessThan(0);
    const hot = field([[pLow, 10]]);
    expect(samplePocket(hot.P, hot.U, 1.225, 1, bound).overBound).toBe(Infinity);
    const cold = field([[pLow, 1.04 * bound(pLow)]]);
    expect(samplePocket(cold.P, cold.U, 1.225, 1, bound).overBound).toBe(-Infinity);
  });
});
