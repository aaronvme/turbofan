// MUSCL with the van Albada limiter and the per-cell, per-direction positivity fallback
// (docs/SOLVER.md section 6).
import { describe, expect, it } from 'vitest';
import { THERMALLY_PERFECT, referenceState } from '../../../src/flow/reference/gas';
import { limitedSlopes, vanAlbada } from '../../../src/flow/reference/muscl';
import { NP } from '../../../src/flow/reference/state';

const ref = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});

describe('van Albada limiter', () => {
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
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, s, 0)).toBe(false);
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
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, s, 0)).toBe(false);
    expect(ref.rho + (P[NP] ?? 0) + 0.5 * (s[0] ?? 0)).toBeGreaterThan(0);
  });

  it('falls back to first order in every component when a face density would not be positive', () => {
    // a non-physical neighbour (a diverging run, a bad ghost): the face value would go negative
    const P = new Float64Array(3 * NP);
    P.set(prim(2.0, 10, 1000), 0);
    P.set(prim(-ref.rho + 0.02, 20, 2000), NP);
    P.set(prim(-ref.rho - 0.5, 30, 3000), 2 * NP);
    const s = new Float64Array(6).fill(7);
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, s, 0)).toBe(true);
    for (let k = 0; k < 6; k++) expect(s[k]).toBe(0);
  });

  it('falls back when a face pressure would not be positive', () => {
    const P = new Float64Array(3 * NP);
    P.set(prim(0, 0, 0), 0);
    P.set(prim(0, 0, -ref.p + 500), NP);
    P.set(prim(0, 0, -ref.p - 2000), 2 * NP);
    const s = new Float64Array(6);
    expect(limitedSlopes(ref, P, 0, NP, 2 * NP, s, 0)).toBe(true);
  });
});
