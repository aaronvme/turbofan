import { describe, expect, it } from 'vitest';
import { freestream } from '../../../spikes/lib/gas';
import { consToPrim, gaugeContext, initialState, primToCons } from '../../../spikes/lib/initial';
import { makeLayout, makeNodes } from '../../../spikes/lib/mesh';

describe("conserved <-> primitive (gauge variables rho', eta)", () => {
  const inf = freestream(288.15, 101325, 100);
  const ctx = gaugeContext(inf, 101325, 288.15);

  it('the freestream has zero gauge density and energy', () => {
    const [a, b] = primToCons({ rho: inf.rho, u: 100, v: 0, rw: 0, pp: 0, z: 0 }, 0.5, ctx);
    expect(a[0]).toBeCloseTo(0, 12);
    expect(b[0]).toBeCloseTo(0, 6);
  });

  it('round-trips a hot, swirling, fuel-laden state', () => {
    const q = { rho: 0.8, u: 150, v: -20, rw: 30, pp: 25000, z: 0.02 };
    const rc = 0.4;
    const [a, b] = primToCons(q, rc, ctx);
    const back = consToPrim(a, b, rc, ctx);
    expect(back.rho).toBeCloseTo(q.rho, 10);
    expect(back.u).toBeCloseTo(q.u, 8);
    expect(back.v).toBeCloseTo(q.v, 8);
    expect(back.rw).toBeCloseTo(q.rw, 8);
    expect(back.pp).toBeCloseTo(q.pp, 4);
    expect(back.z).toBeCloseTo(q.z, 10);
  });
});

describe('initialState', () => {
  it('fills both state buffers for every cell from a primitive field, in layout order', () => {
    const nodes = makeNodes({ ni: 8, nj: 4, x0: 0, x1: 1, r1: 1, wiggle: 0 });
    const layout = makeLayout(8, 4, 2, 2);
    const inf = freestream(288.15, 101325, 50);
    const ctx = gaugeContext(inf, 101325, 288.15);
    const { a, b } = initialState(nodes, layout, ctx, (x) => ({
      rho: inf.rho,
      u: 50,
      v: 0,
      rw: 0,
      pp: x > 0.5 ? 1000 : 0,
      z: 0,
    }));
    expect(a.length).toBe(4 * 32);
    expect(b.length).toBe(4 * 32);
    // Cells left of x = 0.5 are freestream: zero gauge density, zero eta.
    expect(a[0]).toBeCloseTo(0, 6);
    expect(b[0]).toBeCloseTo(0, 2);
    // The right half carries p' = 1000 Pa at the same density: eta = rho e0 - rho h0inf + pInf.
    const right = layout.blocks[1]?.cellOffset ?? 0;
    expect(b[4 * right]).toBeGreaterThan(1000);
  });
});
