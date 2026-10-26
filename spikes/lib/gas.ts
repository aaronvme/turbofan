// Thermally perfect gas for the throughput spike, in the shape of the NASA 7-coefficient form
// the real solver will use (two temperature ranges, frozen two-species mix of air and
// combustion products by mass fraction y).
//
// THE COEFFICIENTS ARE PLACEHOLDERS, not NASA/JANAF data. They have air-like magnitudes and are
// built to be continuous in cp, dcp/dT and h at T_MID, so the GPU kernel does the same
// arithmetic as the real one (range select, Horner, Newton for T). The real coefficient sets
// come from src/thermo in W1 (docs/PHYSICS.md section 2).
//
// Form: cp/R = c0 + c1 T + c2 T^2 + c3 T^3;  h/R = c0 T + c1 T^2/2 + c2 T^3/3 + c3 T^4/4 + d.

export const GAS_R = 287.05; // J/(kg K), frozen
export const T_MID = 1000; // K, range boundary

export type Poly = readonly [number, number, number, number];

function hNoDatum(c: Poly, T: number): number {
  return T * (c[0] + T * (c[1] / 2 + T * (c[2] / 3 + T * (c[3] / 4))));
}

function datumForContinuity(lo: Poly, hi: Poly): number {
  return hNoDatum(lo, T_MID) - hNoDatum(hi, T_MID);
}

const AIR_LO: Poly = [3.4, 2.0e-4, 1.0e-7, -6.0e-11];
const AIR_HI: Poly = [3.38, 3.0e-4, -4.0e-8, 0];
const PRD_LO: Poly = [3.6, 3.0e-4, 1.2e-7, -8.0e-11];
const PRD_HI: Poly = [3.59, 4.0e-4, -5.0e-8, 0];

export interface Species {
  readonly lo: Poly;
  readonly hi: Poly;
  readonly dLo: number;
  readonly dHi: number;
}

export const AIR: Species = {
  lo: AIR_LO,
  hi: AIR_HI,
  dLo: 0,
  dHi: datumForContinuity(AIR_LO, AIR_HI),
};
export const PRODUCTS: Species = {
  lo: PRD_LO,
  hi: PRD_HI,
  dLo: 0,
  dHi: datumForContinuity(PRD_LO, PRD_HI),
};

function mixPoly(a: Poly, b: Poly, y: number): Poly {
  return [
    a[0] + (b[0] - a[0]) * y,
    a[1] + (b[1] - a[1]) * y,
    a[2] + (b[2] - a[2]) * y,
    a[3] + (b[3] - a[3]) * y,
  ];
}

/** cp [J/(kg K)] and h [J/kg] at T for products mass fraction y. */
export function cpH(T: number, y: number): { cp: number; h: number } {
  const hiRange = T > T_MID;
  const c = hiRange ? mixPoly(AIR.hi, PRODUCTS.hi, y) : mixPoly(AIR.lo, PRODUCTS.lo, y);
  const d = hiRange ? AIR.dHi + (PRODUCTS.dHi - AIR.dHi) * y : 0;
  const cpR = c[0] + T * (c[1] + T * (c[2] + T * c[3]));
  return { cp: GAS_R * cpR, h: GAS_R * (hNoDatum(c, T) + d) };
}

/** Internal energy e = h - R T. */
export function internalEnergy(T: number, y: number): number {
  return cpH(T, y).h - GAS_R * T;
}

/**
 * T from e by Newton (de/dT = cp - R), started from a linearisation around a reference state.
 * The GPU kernel takes the same start and stops after two steps.
 */
export function tempFromE(e: number, y: number, tRef: number, cvRef: number): number {
  let T = tRef + (e - internalEnergy(tRef, y)) / cvRef;
  for (let k = 0; k < 30; k++) {
    const g = cpH(T, y);
    const step = (g.h - GAS_R * T - e) / (g.cp - GAS_R);
    T -= step;
    if (Math.abs(step) < 1e-10 * T) break;
  }
  return T;
}

export interface Freestream {
  readonly T: number;
  readonly p: number;
  readonly u: number;
  readonly rho: number;
  readonly h0: number;
  readonly e: number;
  readonly cv: number;
  readonly gamma: number;
  readonly c: number;
}

/** Uniform axial freestream of air (y = 0). */
export function freestream(T: number, p: number, u: number): Freestream {
  const g = cpH(T, 0);
  const cv = g.cp - GAS_R;
  const gamma = g.cp / cv;
  return {
    T,
    p,
    u,
    rho: p / (GAS_R * T),
    h0: g.h + 0.5 * u * u,
    e: g.h - GAS_R * T,
    cv,
    gamma,
    c: Math.sqrt(gamma * GAS_R * T),
  };
}
