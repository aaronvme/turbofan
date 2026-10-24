import { describe, expect, it } from 'vitest';
import { freestream } from '../../../spikes/lib/gas';
import { physicalFlux, slau2Flux, type FluxPrim } from '../../../spikes/lib/slau2';

const inf = freestream(288.15, 101325, 0);
const ctx = { pInf: 101325, h0Inf: inf.h0, zMix: 15 };

function prim(rho: number, u: number, v: number, rw: number, pp: number, z = 0): FluxPrim {
  return { rho, u, v, rw, pp, z };
}

function expectClose(a: readonly number[], b: readonly number[], tol: number): void {
  const scale = Math.max(1, ...b.map(Math.abs));
  a.forEach((x, k) => {
    expect(Math.abs(x - (b[k] ?? Number.NaN)) / scale).toBeLessThan(tol);
  });
}

describe('SLAU2 reference flux (Kitamura & Shima 2013), f64', () => {
  const S: [number, number] = [0.3, 0.4]; // |S| = 0.5
  const rf = 0.7;

  it('is consistent: equal states give the physical flux', () => {
    for (const q of [
      prim(1.2, 80, -10, 5, 300, 0.01),
      prim(0.9, -150, 40, -2, -2000, 0),
      prim(2.0, 500, 0, 0, 50000, 0.03),
    ]) {
      expectClose(slau2Flux(q, q, S, rf, ctx), physicalFlux(q, S, rf, ctx), 1e-12);
    }
  });

  it('is the same flux seen from either side (swap the states, flip the normal)', () => {
    const L = prim(1.25, 90, 12, 3, 800, 0.02);
    const R = prim(1.1, 60, -5, 1, -400, 0.0);
    const a = slau2Flux(L, R, S, rf, ctx);
    const b = slau2Flux(R, L, [-S[0], -S[1]], rf, ctx);
    expectClose(
      a,
      b.map((x) => -x),
      1e-12,
    );
  });

  it('keeps a stationary contact: no mass flux, the momentum flux is the pressure', () => {
    const f = slau2Flux(prim(1.5, 0, 0, 0, 120), prim(0.6, 0, 0, 0, 120), S, rf, ctx);
    expect(Math.abs(f[0] ?? 1)).toBeLessThan(1e-12);
    expect(f[1]).toBeCloseTo(120 * S[0], 10);
    expect(f[2]).toBeCloseTo(120 * S[1], 10);
  });

  it('takes the left pressure when both sides are supersonic in the face direction', () => {
    const L = prim(1.2, 600, 800, 0, 2000);
    const R = prim(1.0, 650, 820, 0, -1000);
    const f = slau2Flux(L, R, S, rf, ctx);
    // mdot > 0, so the x-momentum flux is mdot * uL + p~ * Sx with p~ = p'L.
    expect((f[1] ?? 0) - (f[0] ?? 0) * 600).toBeCloseTo(2000 * S[0], 6);
  });

  it('is zero through a zero-area (axis) face', () => {
    expect(slau2Flux(prim(1, 1, 1, 1, 1), prim(1, 2, 2, 2, 2), [0, 0], 0, ctx)).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
  });
});
