// MUSCL with the smooth van Albada limiter (decision D4-25) and the per-cell, per-direction
// positivity fallback (docs/SOLVER.md section 6).
import { describe, expect, it } from 'vitest';
import { THERMALLY_PERFECT, referenceState } from '../../../src/flow/reference/gas';
import {
  LIMITER_EPS,
  limitedSlopes,
  limiterEpsilon,
  smoothVanAlbada,
  vanAlbada,
} from '../../../src/flow/reference/muscl';
import { NP } from '../../../src/flow/reference/state';

const ref = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});

/** The classic (eps = 0) van Albada of two slopes of one sign. */
const sharp = (a: number, b: number) => (a * b * (a + b)) / (a * a + b * b);

describe('van Albada limiter (sharp, the default)', () => {
  it('is symmetric and odd, bitwise', () => {
    for (const [a, b] of [
      [1, 2],
      [3e-7, 1e-6],
      [-4, -0.5],
      [1e5, 3e4],
    ] as const) {
      expect(vanAlbada(a, b)).toBe(vanAlbada(b, a));
      expect(vanAlbada(-a, -b)).toBe(-vanAlbada(a, b));
    }
  });

  it('is the slope for equal slopes, 0 at an extremum, between the two otherwise', () => {
    expect(vanAlbada(2, 2)).toBeCloseTo(2, 14);
    expect(vanAlbada(1, -1)).toBe(0);
    expect(vanAlbada(0, 5)).toBe(0);
    const s = vanAlbada(1, 3);
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThan(3);
  });
});

describe('smooth van Albada limiter (D4-25)', () => {
  it('is symmetric and odd, bitwise', () => {
    for (const [a, b, e] of [
      [1, 2, 0.1],
      [3e-7, 1e-6, 1e-6],
      [-4, -0.5, 1e-3],
      [1e5, 3e4, 7],
      [2, -3, 0.5],
      [0, 5, 1],
    ] as const) {
      expect(smoothVanAlbada(a, b, e)).toBe(smoothVanAlbada(b, a, e));
      expect(smoothVanAlbada(-a, -b, e)).toBe(-smoothVanAlbada(a, b, e));
    }
  });

  it('is the classic van Albada for slopes much larger than eps', () => {
    for (const [a, b] of [
      [1, 3],
      [-2, -0.5],
      [4, 4],
    ] as const)
      expect(smoothVanAlbada(a, b, 1e-4) / sharp(a, b) - 1).toBeLessThan(1e-7);
    // without the switch, an extremum (opposite signs) gets ab(a + b)/(a^2 + b^2), bounded by
    // min(|a|, |b|): a face value can overshoot by up to half the smaller jump (section 6)
    expect(smoothVanAlbada(1, -3, 1e-4) / sharp(1, -3) - 1).toBeLessThan(1e-7);
    for (const [a, b] of [
      [1, -3],
      [-0.2, 5],
      [2, -2.1],
    ] as const)
      expect(Math.abs(smoothVanAlbada(a, b, 1e-4))).toBeLessThanOrEqual(
        Math.min(Math.abs(a), Math.abs(b)),
      );
  });

  it('is the central slope (a + b) / 2 for slopes much smaller than eps', () => {
    for (const [a, b] of [
      [1e-9, 3e-9],
      [2e-9, -1e-9],
      [-5e-9, 0],
    ] as const)
      expect(Math.abs(smoothVanAlbada(a, b, 1) - 0.5 * (a + b))).toBeLessThan(1e-17);
  });

  it('is homogeneous of degree 1 in (a, b, eps): the eps rule scales with the variable', () => {
    for (const lam of [1e-6, 3, 1e5])
      for (const [a, b, e] of [
        [1, 3, 0.2],
        [-2, 5, 1],
        [0.3, 0.3, 1e-3],
      ] as const)
        expect(smoothVanAlbada(lam * a, lam * b, lam * e)).toBeCloseTo(
          lam * smoothVanAlbada(a, b, e),
          12 - Math.log10(lam),
        );
  });

  it('is 0 at a symmetric extremum and overshoots a step by at most eps / (2 sqrt 2)', () => {
    expect(smoothVanAlbada(2, -2, 0.7) === 0).toBe(true);
    const e = 0.01;
    let worst = 0;
    for (let k = 1; k <= 4000; k++) worst = Math.max(worst, smoothVanAlbada(0, (k * e) / 400, e));
    expect(worst).toBeLessThanOrEqual(e / (2 * Math.SQRT2));
    expect(worst).toBeGreaterThan(0.999 * (e / (2 * Math.SQRT2)));
    expect(smoothVanAlbada(0, Math.SQRT2 * e, e)).toBeCloseTo(e / (2 * Math.SQRT2), 15);
  });

  it('takes eps_k = 1e-3 of (rho_inf, c_inf, c_inf, c_inf r_c, rho_inf c_inf^2, f_st)', () => {
    expect(LIMITER_EPS).toBe(1e-3);
    const rc = 0.37;
    const scale = [ref.rho, ref.c, ref.c, ref.c * rc, ref.rho * ref.c * ref.c, ref.gas.stoichFar];
    for (let k = 0; k < 6; k++)
      expect(limiterEpsilon(ref, k, rc)).toBeCloseTo(LIMITER_EPS * (scale[k] as number), 14);
  });
});

function prim(rhoP: number, u: number, pP: number): Float64Array {
  const q = new Float64Array(NP);
  q[0] = rhoP;
  q[1] = u;
  q[4] = pP;
  return q;
}

describe('limited slopes', () => {
  it('reproduces a linear profile', () => {
    const P = new Float64Array(3 * NP);
    P.set(prim(0.1, 10, 1000), 0);
    P.set(prim(0.2, 20, 2000), NP);
    P.set(prim(0.3, 30, 3000), 2 * NP);
    const s = new Float64Array(6);
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, s, 0)).toBe(false);
    expect(s[0]).toBeCloseTo(0.1, 14);
    expect(s[1]).toBeCloseTo(10, 12);
    expect(s[4]).toBeCloseTo(1000, 10);
  });

  it('keeps face values positive between positive cells (van Albada), so no fallback', () => {
    const P = new Float64Array(3 * NP);
    P.set(prim(2.0, 10, 1000), 0);
    P.set(prim(-ref.rho + 0.02, 20, 2000), NP);
    P.set(prim(-ref.rho + 1e-6, 30, 3000), 2 * NP);
    const s = new Float64Array(6);
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, s, 0)).toBe(false);
    expect(ref.rho + (P[NP] ?? 0) + 0.5 * (s[0] ?? 0)).toBeGreaterThan(0);
  });

  it('falls back to first order in every component when a face density would not be positive', () => {
    // a non-physical neighbour (a diverging run, a bad ghost): the face value would go negative
    const P = new Float64Array(3 * NP);
    P.set(prim(2.0, 10, 1000), 0);
    P.set(prim(-ref.rho + 0.02, 20, 2000), NP);
    P.set(prim(-ref.rho - 0.5, 30, 3000), 2 * NP);
    const s = new Float64Array(6).fill(7);
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, s, 0)).toBe(true);
    for (let k = 0; k < 6; k++) expect(s[k]).toBe(0);
  });

  it('falls back when a face pressure would not be positive', () => {
    const P = new Float64Array(3 * NP);
    P.set(prim(0, 0, 0), 0);
    P.set(prim(0, 0, -ref.p + 500), NP);
    P.set(prim(0, 0, -ref.p - 2000), 2 * NP);
    const s = new Float64Array(6);
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, s, 0)).toBe(true);
  });

  it('falls back at exactly zero face density or pressure (the test is > 0)', () => {
    for (const k of [0, 4]) {
      const P = new Float64Array(3 * NP);
      // a flat line (zero slopes) whose cells sit exactly at rho = 0 or p = 0
      for (let c = 0; c < 3; c++) P[NP * c + k] = k === 0 ? -ref.rho : -ref.p;
      const s = new Float64Array(6);
      expect(limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, s, 0)).toBe(true);
    }
  });

  it('writes only its own six slots', () => {
    const P = new Float64Array(3 * NP);
    P.set(prim(0.1, 10, 1000), 0);
    P.set(prim(0.2, 20, 2000), NP);
    P.set(prim(0.3, 30, 3000), 2 * NP);
    const s = new Float64Array(8).fill(7);
    limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, s, 1);
    expect(s[0]).toBe(7);
    expect(s[7]).toBe(7);
    // the fallback too (the configuration of the density fallback test above)
    P.set(prim(2.0, 10, 1000), 0);
    P.set(prim(-ref.rho + 0.02, 20, 2000), NP);
    P.set(prim(-ref.rho - 0.5, 30, 3000), 2 * NP);
    const f = new Float64Array(8).fill(7);
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, f, 1)).toBe(true);
    expect(f[0]).toBe(7);
    expect(f[7]).toBe(7);
  });

  it('smooth: reconstructs a small swirl jump centrally, with eps at the cell radius', () => {
    const P = new Float64Array(3 * NP);
    // rw jumps of 1e-6 and 3e-6 m^2/s: far below eps = 1e-3 c_inf r_c, so the central slope
    P[3] = 1;
    P[NP + 3] = 1 + 1e-6;
    P[2 * NP + 3] = 1 + 4e-6;
    const s = new Float64Array(6);
    limitedSlopes(ref, P, 0, NP, 2 * NP, 0.5, s, 0, true);
    expect(s[3]).toBeCloseTo(2e-6, 15);
    // a jump far above eps (2 and 6 m^2/s at r_c 0.01 m, eps 3.4e-3) is limited as van Albada
    P[NP + 3] = 3;
    P[2 * NP + 3] = 9;
    limitedSlopes(ref, P, 0, NP, 2 * NP, 0.01, s, 0, true);
    expect((s[3] as number) / sharp(2, 6) - 1).toBeLessThan(1e-5);
  });
});
