// SLAU2 (docs/SOLVER.md section 7): consistency, the bitwise antisymmetry that makes interfaces
// conservative, wall and contact behaviour, supersonic upwinding, exact zeros in the ambient.
import { describe, expect, it } from 'vitest';
import {
  THERMALLY_PERFECT,
  caloricallyPerfectGas,
  referenceState,
} from '../../../src/flow/reference/gas';
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

function flux(
  L: Float64Array,
  R: Float64Array,
  nx: number,
  nr: number,
  area: number,
  rf: number,
  machCut?: number,
) {
  const out = new Float64Array(6);
  slau2Flux(ref, L, 0, R, 0, nx, nr, area, rf, out, machCut);
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

  describe('low-Mach dissipation scaling (D4-20)', () => {
    const fa = (m: number) => m * (2 - m);
    const low = (p: number, u: number) =>
      physicalToPrim(ref, { rho: 1.2, u, v: 0.4, w: 0.3, p, z: 0 }, 1);

    it('divides only the mass flux pressure diffusion by f_a(M_ref), M_ref = max(qbar/cbar, M_cut)', () => {
      // qbar/cbar ~ 3e-3, below both cuts: the diffusion part is (1/f_a(M_cut)) x the plain one
      const L = low(101325 + 40, 1.0);
      const R = low(101325 - 25, 1.1);
      const plain = flux(L, R, 1, 0, 0.7, 1);
      const unit = flux(L, R, 1, 0, 0.7, 1, 1);
      for (let m = 0; m < 6; m++) expect(unit[m]).toBe(plain[m]);
      const a = flux(L, R, 1, 0, 0.7, 1, 0.01);
      const b = flux(L, R, 1, 0, 0.7, 1, 0.04);
      const ratio = ((a[0] ?? NaN) - (plain[0] ?? NaN)) / ((b[0] ?? NaN) - (plain[0] ?? NaN));
      expect(ratio).toBeCloseTo((1 / fa(0.01) - 1) / (1 / fa(0.04) - 1), 9);
      // with p_L > p_R the extra diffusion pushes mass from L to R
      expect((a[0] ?? NaN) - (plain[0] ?? NaN)).toBeGreaterThan(0);
      // the pressure flux and the velocity weights are untouched: the momentum flux changes only
      // through the mass flux it carries
      const dm = (a[0] ?? NaN) - (plain[0] ?? NaN);
      expect((a[1] ?? NaN) - (plain[1] ?? NaN)).toBeCloseTo(dm * 1.0, 6);
    });

    it('uses the local Mach number above M_cut and leaves transonic faces unchanged', () => {
      const L = low(101325 + 40, 30);
      const R = low(101325 - 25, 31);
      const plain = flux(L, R, 1, 0, 0.7, 1);
      const a = flux(L, R, 1, 0, 0.7, 1, 1e-3);
      const b = flux(L, R, 1, 0, 0.7, 1, 1e-4);
      // M_local ~ 0.09 > both cuts: the same scaled flux
      for (let m = 0; m < 6; m++) expect(a[m]).toBe(b[m]);
      expect(Math.abs((a[0] ?? NaN) - (plain[0] ?? NaN))).toBeGreaterThan(0);
      const S = physicalToPrim(ref, { rho: 1.1, u: 420, v: 30, w: 40, p: 9e4, z: 0 }, 1);
      const T = physicalToPrim(ref, { rho: 0.9, u: 400, v: -20, w: 0, p: 8.5e4, z: 0 }, 1);
      const sp = flux(S, T, 1, 0, 1.5, 1);
      const ss = flux(S, T, 1, 0, 1.5, 1, 0.003);
      for (let m = 0; m < 6; m++) expect(ss[m]).toBe(sp[m]);
    });

    it('stays antisymmetric bitwise and exactly zero in the ambient', () => {
      const next = rng(19);
      for (let k = 0; k < 300; k++) {
        const rf = 0.05 + next();
        const L = randomPrim(next, rf);
        const R = randomPrim(next, rf);
        const a = 2 * Math.PI * next();
        const F = flux(L, R, Math.cos(a), Math.sin(a), 0.3, rf, 0.003);
        const G = flux(R, L, -Math.cos(a), -Math.sin(a), 0.3, rf, 0.003);
        for (let m = 0; m < 6; m++) expect(F[m]).toBe(-(G[m] ?? NaN));
      }
      const q = new Float64Array(NP);
      const Z = flux(q, q, 0.3, -0.95, 1, 1, 0.003);
      for (let m = 0; m < 6; m++) expect(Z[m] === 0).toBe(true);
    });

    it('with p_u (D4-32 trial): bitwise antisymmetric, exact in the ambient, off at K_u = 0', () => {
      const next = rng(23);
      const pu = (
        L: Float64Array,
        R: Float64Array,
        nx: number,
        nr: number,
        rf: number,
        ku: number,
      ) => {
        const out = new Float64Array(6);
        slau2Flux(ref, L, 0, R, 0, nx, nr, 0.3, rf, out, 0.003, ku);
        return out;
      };
      for (let k = 0; k < 300; k++) {
        const rf = 0.05 + next();
        const L = randomPrim(next, rf);
        const R = randomPrim(next, rf);
        const a = 2 * Math.PI * next();
        const F = pu(L, R, Math.cos(a), Math.sin(a), rf, 0.5);
        const G = pu(R, L, -Math.cos(a), -Math.sin(a), rf, 0.5);
        // === (not Object.is): a vacuum-forming expansion (g = 1, chi = 0) has m = +0 both ways
        for (let m = 0; m < 6; m++) expect(F[m] === -(G[m] ?? NaN)).toBe(true);
        // K_u = 0 is the D4-20 flux bitwise; only the pressure flux changes with K_u > 0
        expect(pu(L, R, Math.cos(a), Math.sin(a), rf, 0)).toEqual(
          flux(L, R, Math.cos(a), Math.sin(a), 0.3, rf, 0.003),
        );
        expect(F[0]).toBe(flux(L, R, Math.cos(a), Math.sin(a), 0.3, rf, 0.003)[0]);
      }
      const q = new Float64Array(NP);
      const Z = pu(q, q, 0.3, -0.95, 1, 0.5);
      for (let m = 0; m < 6; m++) expect(Z[m] === 0).toBe(true);
    });
  });
});

// W2R-I4: flux VALUES for unequal states. The property tests above (consistency, antisymmetry,
// the D4-20 ratio) pass for many wrong fluxes (critic pass 7: a wrong face swirl, a wrong face
// density, a wrong dh0 or chi or g or Vbar or p-tilde term all survived), so the expected values
// here are computed outside the module, straight from the paper's formulas (Kitamura & Shima
// 2013 eqs. for SLAU2, Shima & Kitamura 2011 for the SLAU mass flux), in ABSOLUTE variables of
// a calorically perfect gas: c = sqrt(gamma p / rho), h0 = gamma/(gamma - 1) p/rho + q^2/2. None
// of the module's gauge machinery (secant cp, T' from (p', rho'), dq2) is used.
describe('SLAU2 values against an independent evaluation of the paper formulas (W2R-I4)', () => {
  const GAMMA = 1.4;
  const R_GAS = 287.05287;
  // a moving free stream, so that h0_inf includes u_inf^2/2 and the eta flux m (h0 - h0_inf)
  // is checked with q_inf != 0
  const INF = { p: 101325, t: 288.15, u: 40 };
  const cref = referenceState(caloricallyPerfectGas(GAMMA, R_GAS), {
    pressure: INF.p,
    temperature: INF.t,
    velocity: INF.u,
  });
  const RHO_INF = INF.p / (R_GAS * INF.t);

  /** A face state as gauges of the free stream: rho' and p' added to rho_inf and p_inf. */
  interface Gauge {
    readonly drho: number;
    readonly u: number;
    readonly v: number;
    readonly w: number;
    readonly dp: number;
    readonly z: number;
  }

  /** The primitive record the module reads (rw = w r_f; T' and c are not read by the flux). */
  function record(g: Gauge, rf: number): Float64Array {
    return Float64Array.from([g.drho, g.u, g.v, g.w * rf, g.dp, g.z, 0, 0]);
  }

  function absolute(g: Gauge, nx: number, nr: number) {
    const rho = RHO_INF + g.drho;
    const p = INF.p + g.dp;
    const q2 = g.u * g.u + g.v * g.v + g.w * g.w;
    return {
      rho,
      c: Math.sqrt((GAMMA * p) / rho),
      vn: g.u * nx + g.v * nr,
      q2,
      // total enthalpy minus the free stream's, both absolute
      dh0:
        (GAMMA / (GAMMA - 1)) * (p / rho) +
        q2 / 2 -
        ((GAMMA / (GAMMA - 1)) * (INF.p / RHO_INF) + (INF.u * INF.u) / 2),
    };
  }

  /** beta+- of SLAU2 (the AUSM+ fifth-order pressure split). */
  function split(m: number, sign: 1 | -1): number {
    if (Math.abs(m) >= 1) return m * sign > 0 ? 1 : 0;
    return ((m + sign) * (m + sign) * (2 - sign * m)) / 4;
  }

  function expected(
    L: Gauge,
    R: Gauge,
    nx: number,
    nr: number,
    area: number,
    rf: number,
    machCut = 1,
    ku = 0,
  ): number[] {
    const a = absolute(L, nx, nr);
    const b = absolute(R, nx, nr);
    const cBar = (a.c + b.c) / 2;
    const mL = a.vn / cBar;
    const mR = b.vn / cBar;
    const qBar = Math.sqrt((a.q2 + b.q2) / 2);
    const mHat = Math.min(1, qBar / cBar);
    const chi = (1 - mHat) ** 2;
    // g in [-1, 0] only when the two sides move apart (an expansion)
    const g = -Math.max(Math.min(mL, 0), -1) * Math.min(Math.max(mR, 0), 1);
    const vBar = (a.rho * Math.abs(a.vn) + b.rho * Math.abs(b.vn)) / (a.rho + b.rho);
    const vPlus = (1 - g) * vBar + g * Math.abs(a.vn);
    const vMinus = (1 - g) * vBar + g * Math.abs(b.vn);
    const mRef = Math.min(1, Math.max(qBar / cBar, machCut));
    const dp = R.dp - L.dp;
    const mdot =
      (a.rho * (a.vn + vPlus) + b.rho * (b.vn - vMinus)) / 2 -
      (chi * dp) / (2 * cBar * mRef * (2 - mRef));
    const bPlus = split(mL, 1);
    const bMinus = split(mR, -1);
    const pTilde =
      (L.dp + R.dp) / 2 -
      ((bPlus - bMinus) * dp) / 2 +
      qBar * (bPlus + bMinus - 1) * ((a.rho + b.rho) / 2) * cBar -
      // AUSM+-up's p_u (Liou 2006), D4-32's trial: K_u P+ P- (rho_L + rho_R) f_a c (vn_R - vn_L)
      ku * bPlus * bMinus * (a.rho + b.rho) * mRef * (2 - mRef) * cBar * (b.vn - a.vn);
    const up = mdot > 0 ? mdot : 0;
    const dn = mdot > 0 ? 0 : mdot;
    return [
      mdot,
      up * L.u + dn * R.u + pTilde * nx,
      up * L.v + dn * R.v + pTilde * nr,
      up * L.w * rf + dn * R.w * rf,
      up * a.dh0 + dn * b.dh0,
      up * L.z + dn * R.z,
    ].map((f) => f * area);
  }

  function moduleFlux(
    L: Gauge,
    R: Gauge,
    nx: number,
    nr: number,
    area: number,
    rf: number,
    machCut?: number,
    ku?: number,
  ): Float64Array {
    const out = new Float64Array(6).fill(NaN);
    slau2Flux(cref, record(L, rf), 0, record(R, rf), 0, nx, nr, area, rf, out, machCut, ku);
    return out;
  }

  /** Every component to 1e-12 relative; every expected component is nonzero, so none is vacuous. */
  function expectClose(F: Float64Array, E: readonly number[]): void {
    for (let m = 0; m < 6; m++) {
      const e = E[m] ?? NaN;
      expect(Math.abs(e)).toBeGreaterThan(0);
      expect(Math.abs((F[m] ?? NaN) - e)).toBeLessThanOrEqual(1e-12 * Math.abs(e));
    }
  }

  const unit = (a: number) => [Math.cos(a), Math.sin(a)] as const;

  const CASES: {
    name: string;
    L: Gauge;
    R: Gauge;
    angle: number;
    area: number;
    rf: number;
    machCut?: number;
    ku?: number;
    check: (k: { mL: number; mR: number; mHat: number; mdot: number }) => boolean;
  }[] = [
    {
      // both sides move towards -n, the left pressure is higher: m < 0 (the m- branch), chi > 0
      name: 'a subsonic jump with the mass flux against n',
      L: { drho: 0.075, u: -60, v: 25, w: 12, dp: 9000, z: 0.004 },
      R: { drho: -0.125, u: -45, v: -10, w: -8, dp: -4000, z: 0.012 },
      angle: Math.atan2(0.6, 0.8),
      area: 0.37,
      rf: 0.61,
      check: (k) => k.mdot < 0 && k.mL < 0 && k.mR < 0 && k.mHat > 0.1,
    },
    {
      // the sides move apart (M_L < 0 < M_R): g != 0
      name: 'a subsonic expansion (g != 0)',
      L: { drho: -0.075, u: -90, v: -20, w: 30, dp: -2500, z: 0.02 },
      R: { drho: -0.175, u: 120, v: 35, w: -25, dp: -6000, z: 0.005 },
      angle: Math.atan2(0.28, 0.96),
      area: 1.3,
      rf: 0.23,
      check: (k) => k.mL < -0.2 && k.mR > 0.3,
    },
    {
      // strong swirl and large rho' at r_f != 1 (the face swirl w = rw / r_f enters q^2 and dh0)
      name: 'a swirling face with large rho and p gauges',
      L: { drho: 0.675, u: 35, v: 5, w: 160, dp: 60000, z: 0.03 },
      R: { drho: -0.375, u: 50, v: -12, w: 210, dp: 15000, z: 0.05 },
      angle: 2.2,
      area: 0.55,
      rf: 0.37,
      check: (k) => k.mHat > 0.4 && k.mHat < 1,
    },
    {
      // supersonic left, subsonic right: both branches of beta+- and the clamp M-hat = 1 (chi = 0)
      name: 'a transonic face',
      L: { drho: 0.175, u: 520, v: 40, w: 60, dp: 40000, z: 0.01 },
      R: { drho: -0.025, u: 300, v: 10, w: 50, dp: 30000, z: 0.002 },
      angle: 0.1,
      area: 0.9,
      rf: 1.7,
      check: (k) => k.mL > 1 && k.mR > 0 && k.mR < 1 && k.mHat === 1,
    },
    {
      // D4-20: q-bar/c-bar ~ 2e-3 is below the cut, so M_ref = M_cut = 0.003
      name: 'a low-Mach face below M_cut (D4-20)',
      L: { drho: 0.002, u: 0.6, v: 0.2, w: 0.1, dp: 3, z: 0.001 },
      R: { drho: -0.001, u: 0.5, v: -0.3, w: 0.2, dp: -2, z: 0.002 },
      angle: 0.4,
      area: 0.8,
      rf: 0.45,
      machCut: 0.003,
      check: (k) => k.mHat < 0.003,
    },
    {
      // D4-20: q-bar/c-bar ~ 0.04 is above the cut, so M_ref is the local Mach number
      name: 'a low-Mach face above M_cut (D4-20)',
      L: { drho: 0.01, u: 14, v: 3, w: 2, dp: 120, z: 0.001 },
      R: { drho: -0.004, u: 12, v: -2, w: 4, dp: -60, z: 0.003 },
      angle: -0.3,
      area: 0.25,
      rf: 0.8,
      machCut: 0.003,
      check: (k) => k.mHat > 0.003 && k.mHat < 0.1,
    },
    {
      // D4-32's trial: p_u at the cut (f_a = f_a(M_cut))
      name: 'a low-Mach face below M_cut with p_u (K_u 0.5)',
      L: { drho: 0.002, u: 0.6, v: 0.2, w: 0.1, dp: 3, z: 0.001 },
      R: { drho: -0.001, u: -0.5, v: -0.3, w: 0.2, dp: -2, z: 0.002 },
      angle: 0.4,
      area: 0.8,
      rf: 0.45,
      machCut: 0.003,
      ku: 0.5,
      check: (k) => k.mHat < 0.003,
    },
    {
      // p_u above the cut, f_a = f_a(q-bar / c-bar)
      name: 'a low-Mach face above M_cut with p_u (K_u 0.5)',
      L: { drho: 0.01, u: 14, v: 3, w: 2, dp: 120, z: 0.001 },
      R: { drho: -0.004, u: 9, v: -2, w: 4, dp: -60, z: 0.003 },
      angle: -0.3,
      area: 0.25,
      rf: 0.8,
      machCut: 0.003,
      ku: 0.5,
      check: (k) => k.mHat > 0.003 && k.mHat < 0.1,
    },
    {
      // p_u on a transonic face (f_a = 1: AUSM+-up's own term)
      name: 'a transonic face with p_u (K_u 0.5)',
      L: { drho: 0.175, u: 520, v: 40, w: 60, dp: 40000, z: 0.01 },
      R: { drho: -0.025, u: 300, v: 10, w: 50, dp: 30000, z: 0.002 },
      angle: 0.1,
      area: 0.9,
      rf: 1.7,
      machCut: 0.003,
      ku: 0.5,
      check: (k) => k.mL > 1 && k.mR > 0 && k.mR < 1 && k.mHat === 1,
    },
  ];

  for (const c of CASES) {
    it(`matches on ${c.name}`, () => {
      const [nx, nr] = unit(c.angle);
      const a = absolute(c.L, nx, nr);
      const b = absolute(c.R, nx, nr);
      const cBar = (a.c + b.c) / 2;
      const E = expected(c.L, c.R, nx, nr, c.area, c.rf, c.machCut, c.ku);
      // the case exercises what its name says
      expect(
        c.check({
          mL: a.vn / cBar,
          mR: b.vn / cBar,
          mHat: Math.min(1, Math.sqrt((a.q2 + b.q2) / 2) / cBar),
          mdot: (E[0] ?? NaN) / c.area,
        }),
      ).toBe(true);
      expectClose(moduleFlux(c.L, c.R, nx, nr, c.area, c.rf, c.machCut, c.ku), E);
      // and through the reversed face, F(R, L, -S) = -F(L, R, S)
      expectClose(
        moduleFlux(c.R, c.L, -nx, -nr, c.area, c.rf, c.machCut, c.ku),
        E.map((f) => -f),
      );
    });
  }

  it('gives the physical flux of one state, whatever flux was evaluated before', () => {
    const s: Gauge = { drho: 0.3, u: 80, v: -30, w: 110, dp: 25000, z: 0.02 };
    const [nx, nr] = unit(1.1);
    const area = 0.6;
    const rf = 0.42;
    // an unrelated face first: a physical flux must not read anything that evaluation left behind
    moduleFlux(CASES[3]?.L ?? s, CASES[3]?.R ?? s, 1, 0, 1, 1.7);
    const out = new Float64Array(6).fill(NaN);
    physicalFlux(cref, record(s, rf), 0, nx, nr, area, rf, out);
    const a = absolute(s, nx, nr);
    const m = a.rho * a.vn;
    expectClose(
      out,
      [m, m * s.u + s.dp * nx, m * s.v + s.dp * nr, m * s.w * rf, m * a.dh0, m * s.z].map(
        (f) => f * area,
      ),
    );
  });

  it('writes six zeros through a zero-area face (over whatever the output held)', () => {
    const out = new Float64Array(7).fill(NaN);
    const L = record(CASES[0]?.L ?? { drho: 0, u: 0, v: 0, w: 0, dp: 0, z: 0 }, 0);
    slau2Flux(cref, L, 0, L, 0, 0, 1, 0, 0, out);
    for (let m = 0; m < 6; m++) expect(out[m] === 0).toBe(true);
    expect(Number.isNaN(out[6])).toBe(true);
  });
});
