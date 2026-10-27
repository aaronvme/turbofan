// SLAU2 (docs/SOLVER.md section 7): consistency, the bitwise antisymmetry that makes interfaces
// conservative, wall and contact behaviour, supersonic upwinding, exact zeros in the ambient.
import { describe, expect, it } from 'vitest';
import { THERMALLY_PERFECT, referenceState } from '../../../src/flow/reference/gas';
import { physicalFlux, slau2Flux } from '../../../src/flow/reference/slau2';
import { NP, physicalToPrim } from '../../../src/flow/reference/state';

const ref = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 0,
});

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPrim(next: () => number, rf: number): Float64Array {
  const speed = 900 * (next() - 0.5);
  return physicalToPrim(
    ref,
    {
      rho: 0.2 + 2 * next(),
      u: speed,
      v: 400 * (next() - 0.5),
      w: 300 * (next() - 0.5),
      p: 2e4 + 3e5 * next(),
      z: 0.06 * next(),
    },
    rf,
  );
}

function flux(L: Float64Array, R: Float64Array, nx: number, nr: number, area: number, rf: number) {
  const out = new Float64Array(6);
  slau2Flux(ref, L, 0, R, 0, nx, nr, area, rf, out);
  return out;
}

describe('SLAU2', () => {
  it('is consistent: F(q, q) is the physical flux', () => {
    const next = rng(7);
    for (let k = 0; k < 200; k++) {
      const rf = 0.1 + next();
      const q = randomPrim(next, rf);
      const a = 2 * Math.PI * next();
      const area = 1e-3 + next();
      const F = flux(q, q, Math.cos(a), Math.sin(a), area, rf);
      const P = new Float64Array(6);
      physicalFlux(ref, q, 0, Math.cos(a), Math.sin(a), area, rf, P);
      const scale = Math.max(...Array.from(P, Math.abs));
      for (let m = 0; m < 6; m++)
        expect(Math.abs((F[m] ?? 0) - (P[m] ?? 0))).toBeLessThan(1e-12 * scale);
    }
  });

  it('is antisymmetric bitwise: F(L, R, S) = -F(R, L, -S)', () => {
    const next = rng(11);
    for (let k = 0; k < 500; k++) {
      const rf = 0.05 + next();
      const L = randomPrim(next, rf);
      const R = randomPrim(next, rf);
      const a = 2 * Math.PI * next();
      const nx = Math.cos(a);
      const nr = Math.sin(a);
      const F = flux(L, R, nx, nr, 0.3, rf);
      const G = flux(R, L, -nx, -nr, 0.3, rf);
      for (let m = 0; m < 6; m++) expect(F[m]).toBe(-(G[m] ?? NaN));
    }
  });

  it('gives no mass, angular-momentum, energy or fuel flux between mirrored wall states (to rounding)', () => {
    const next = rng(3);
    for (let k = 0; k < 100; k++) {
      const rf = 0.5;
      const L = randomPrim(next, rf);
      const a = 2 * Math.PI * next();
      const nx = Math.cos(a);
      const nr = Math.sin(a);
      const R = Float64Array.from(L);
      const vn = (L[1] ?? 0) * nx + (L[2] ?? 0) * nr;
      R[1] = (L[1] ?? 0) - 2 * vn * nx;
      R[2] = (L[2] ?? 0) - 2 * vn * nr;
      const F = flux(L, R, nx, nr, 0.2, rf);
      // the reflection is not bitwise (u^2 + v^2 changes in the last bit), so the mass flux is a
      // rounding residue of the normal mass flux 0.2 rho |vn|
      const scale = 0.2 * (1 + Math.abs(vn)) * 3;
      for (const m of [0, 5]) expect(Math.abs(F[m] ?? NaN)).toBeLessThan(1e-13 * scale);
      expect(Math.abs(F[3] ?? NaN)).toBeLessThan(1e-13 * scale * 300);
      expect(Math.abs(F[4] ?? NaN)).toBeLessThan(1e-13 * scale * 1e6);
    }
  });

  it('keeps a stationary contact: no mass flux, momentum flux p n', () => {
    const L = physicalToPrim(ref, { rho: 1.5, u: 0, v: 0, w: 0, p: 1.3e5, z: 0 }, 1);
    const R = physicalToPrim(ref, { rho: 0.3, u: 0, v: 0, w: 0, p: 1.3e5, z: 0.03 }, 1);
    const F = flux(L, R, 0.6, 0.8, 2, 1);
    expect(F[0] === 0).toBe(true);
    expect(F[1]).toBeCloseTo(2 * 0.6 * (1.3e5 - ref.p), 6);
    expect(F[2]).toBeCloseTo(2 * 0.8 * (1.3e5 - ref.p), 6);
    expect(F[4] === 0).toBe(true);
  });

  it('takes the left pressure and upwinds every convected quantity when both sides are supersonic', () => {
    const L = physicalToPrim(ref, { rho: 1.1, u: 800, v: 30, w: 40, p: 9e4, z: 0.01 }, 1);
    const R = physicalToPrim(ref, { rho: 0.9, u: 750, v: -20, w: 0, p: 8e4, z: 0 }, 1);
    const F = flux(L, R, 1, 0, 1.5, 1);
    const m = F[0] ?? NaN;
    expect(m).toBeGreaterThan(0);
    expect((F[1] ?? NaN) - m * 800).toBeCloseTo(1.5 * (9e4 - ref.p), 6);
    expect(F[2]).toBeCloseTo(m * 30, 9);
    expect(F[3]).toBeCloseTo(m * (L[3] ?? NaN), 9);
    expect(F[5]).toBeCloseTo(m * 0.01, 12);
  });

  it('is exactly zero in the ambient and through a zero-area (axis) face', () => {
    const q = new Float64Array(NP);
    const F = flux(q, q, 0.3, -0.95, 1, 1);
    for (let m = 0; m < 6; m++) expect(F[m] === 0).toBe(true);
    const next = rng(5);
    const G = flux(randomPrim(next, 1), randomPrim(next, 1), 0, 1, 0, 0);
    for (let m = 0; m < 6; m++) expect(G[m] === 0).toBe(true);
  });
});
