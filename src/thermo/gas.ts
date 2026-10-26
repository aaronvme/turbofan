// Thermally perfect gas properties of dry air and of its frozen mixture with stoichiometric
// Jet-A combustion products, by fuel-air ratio (FAR). Mass basis, SI.
//
// - Each of the two gases (air, stoichiometric products) is an ideal mixture of the species in
//   species.ts, so its mass-specific cp is one 4th-order polynomial per range (a linear
//   combination of the species polynomials). That pair of tables is what GAS_TABLES exports for
//   the WGSL code generator.
// - A burned mixture at FAR f is air plus stoichiometric products in the mass fraction
//   phi = f (1 + f_st) / (f_st (1 + f)) (1 kg of air with f kg of fuel: the fuel burns with f / f_st
//   kg of the air), frozen (no dissociation): cp, h, R are mass-weighted (Walsh & Fletcher, Gas
//   Turbine Performance, 2nd ed., section 3.5).
// - h is the sensible enthalpy relative to 298.15 K, so a combustor energy balance with the fuel's
//   lower heating value (defined at 298.15 K, water as vapour) is exact for complete combustion.
// - The entropy function phi_s(T) = integral of cp/T from 298.15 K; at fixed composition the
//   entropy is s(T, p) = phi_s(T) - R ln(p / p_ref) + const.
// - h and phi_s integrate cp analytically per range with continuity imposed at 1000 K, so h(T) is
//   exactly the integral of the piecewise cp (threshold T4).

import { JET_A, MOLAR_MASS, R_UNIVERSAL, SPECIES, type SpeciesId } from './species';

export const T_MIN_K = 200;
export const T_MAX_K = 3500;
export const T_REF_K = 298.15;
const T_BREAK_K = 1000;

/**
 * Dry air, U.S. Standard Atmosphere 1976 (NOAA-S/T 76-1562), Table 3, keeping the four species
 * above 1e-4 and renormalising (the omitted Ne, He, Kr, ... total 2.6e-5).
 */
const AIR_RAW: Readonly<Partial<Record<SpeciesId, number>>> = {
  N2: 0.78084,
  O2: 0.209476,
  Ar: 0.00934,
  CO2: 0.000314,
};

function normalise(
  x: Readonly<Partial<Record<SpeciesId, number>>>,
): Readonly<Partial<Record<SpeciesId, number>>> {
  const total = Object.values(x).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v / total]));
}

export const AIR_MOLE_FRACTIONS = normalise(AIR_RAW);

const xAir = (s: SpeciesId): number => AIR_MOLE_FRACTIONS[s] ?? 0;
const molarMassOf = (x: Readonly<Partial<Record<SpeciesId, number>>>): number =>
  Object.entries(x).reduce((m, [s, xi]) => m + xi * MOLAR_MASS[s as SpeciesId], 0);
const AIR_MOLAR_MASS = molarMassOf(AIR_MOLE_FRACTIONS);

/** C12H23 + n O2 -> 12 CO2 + 11.5 H2O, n = 12 + 23/4 = 17.75 mol O2 per mol fuel. */
const O2_PER_FUEL = JET_A.carbon + JET_A.hydrogen / 4;
const AIR_PER_FUEL = O2_PER_FUEL / xAir('O2');

/** Stoichiometric fuel-air ratio of Jet-A (C12H23) in dry air, kg/kg (0.0682). */
export const STOICH_FAR = JET_A.molarMass / (AIR_PER_FUEL * AIR_MOLAR_MASS);

export const PRODUCT_MOLE_FRACTIONS = normalise({
  N2: AIR_PER_FUEL * xAir('N2'),
  Ar: AIR_PER_FUEL * xAir('Ar'),
  CO2: AIR_PER_FUEL * xAir('CO2') + JET_A.carbon,
  H2O: JET_A.hydrogen / 2,
});

/** One temperature range of a mass-specific gas polynomial (the WGSL generator's input). */
export interface GasSegment {
  /** cp = c0 + c1 T + c2 T^2 + c3 T^3 + c4 T^4, J/(kg K). */
  readonly cp: readonly [number, number, number, number, number];
  /** h = hConst + sum c_k T^(k+1) / (k+1), J/kg (zero at 298.15 K). */
  readonly hConst: number;
  /** phi_s = sConst + c0 ln T + sum_{k>=1} c_k T^k / k, J/(kg K) (zero at 298.15 K). */
  readonly sConst: number;
}

export interface GasTable {
  readonly rJPerKgK: number;
  readonly molarMassGPerMol: number;
  readonly low: GasSegment;
  readonly high: GasSegment;
}

type Coeffs = readonly [number, number, number, number, number];

function massPolynomial(
  x: Readonly<Partial<Record<SpeciesId, number>>>,
  range: 'low' | 'high',
): Coeffs {
  const m = molarMassOf(x) / 1000;
  const c = [0, 0, 0, 0, 0];
  for (const [s, xi] of Object.entries(x)) {
    const a = SPECIES[s as SpeciesId][range];
    for (let k = 0; k < 5; k++) c[k] = (c[k] ?? 0) + (xi * R_UNIVERSAL * (a[k] ?? 0)) / m;
  }
  return c as unknown as Coeffs;
}

const polyCp = (c: Coeffs, t: number): number =>
  c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * c[4])));
const polyH = (c: Coeffs, t: number): number =>
  t * (c[0] + t * (c[1] / 2 + t * (c[2] / 3 + t * (c[3] / 4 + (t * c[4]) / 5))));
const polyS = (c: Coeffs, t: number): number =>
  c[0] * Math.log(t) + t * (c[1] + t * (c[2] / 2 + t * (c[3] / 3 + (t * c[4]) / 4)));

function buildTable(x: Readonly<Partial<Record<SpeciesId, number>>>): GasTable {
  const lo = massPolynomial(x, 'low');
  const hi = massPolynomial(x, 'high');
  const hLo = -polyH(lo, T_REF_K);
  const sLo = -polyS(lo, T_REF_K);
  const hHi = hLo + polyH(lo, T_BREAK_K) - polyH(hi, T_BREAK_K);
  const sHi = sLo + polyS(lo, T_BREAK_K) - polyS(hi, T_BREAK_K);
  const molarMass = molarMassOf(x);
  return {
    rJPerKgK: (R_UNIVERSAL * 1000) / molarMass,
    molarMassGPerMol: molarMass,
    low: { cp: lo, hConst: hLo, sConst: sLo },
    high: { cp: hi, hConst: hHi, sConst: sHi },
  };
}

/** Everything the WGSL code generator needs (W2): two gases, two ranges each. */
export const GAS_TABLES = {
  tMinK: T_MIN_K,
  tMaxK: T_MAX_K,
  tRefK: T_REF_K,
  tBreakK: T_BREAK_K,
  stoichiometricFar: STOICH_FAR,
  gases: { air: buildTable(AIR_MOLE_FRACTIONS), products: buildTable(PRODUCT_MOLE_FRACTIONS) },
} as const;

const AIR = GAS_TABLES.gases.air;
const PROD = GAS_TABLES.gases.products;

function checkT(t: number): void {
  if (!(t >= T_MIN_K && t <= T_MAX_K)) {
    throw new Error(`temperature ${t} K is outside the polynomial range [${T_MIN_K}, ${T_MAX_K}]`);
  }
}

/** Mass fraction of stoichiometric products in a mixture of FAR f (0 for air, 1 at f_st). */
export function productsMassFraction(far: number): number {
  if (!(far >= 0 && far <= STOICH_FAR * (1 + 1e-12))) {
    throw new Error(`FAR ${far} must be in [0, ${STOICH_FAR.toFixed(5)}]`);
  }
  return (far * (1 + STOICH_FAR)) / (STOICH_FAR * (1 + far));
}

const seg = (g: GasTable, t: number): GasSegment => (t < T_BREAK_K ? g.low : g.high);

function mix(far: number, t: number, f: (g: GasTable) => number): number {
  checkT(t);
  const phi = productsMassFraction(far);
  return phi === 0 ? f(AIR) : (1 - phi) * f(AIR) + phi * f(PROD);
}

/** Specific heat at constant pressure, J/(kg K). */
export function cp(t: number, far: number): number {
  return mix(far, t, (g) => polyCp(seg(g, t).cp, t));
}

/** Sensible enthalpy relative to 298.15 K, J/kg. */
export function enthalpy(t: number, far: number): number {
  return mix(far, t, (g) => seg(g, t).hConst + polyH(seg(g, t).cp, t));
}

/** Entropy function: integral of cp/T dT from 298.15 K, J/(kg K). */
export function entropyFunction(t: number, far: number): number {
  return mix(far, t, (g) => seg(g, t).sConst + polyS(seg(g, t).cp, t));
}

/** Specific gas constant of the mixture, J/(kg K). */
export function gasConstant(far: number): number {
  const phi = productsMassFraction(far);
  return (1 - phi) * AIR.rJPerKgK + phi * PROD.rJPerKgK;
}

export function gamma(t: number, far: number): number {
  const c = cp(t, far);
  return c / (c - gasConstant(far));
}

/** Newton stops when the temperature step is below this, K. */
export const INVERSE_TOLERANCE_K = 1e-9;
const MAX_NEWTON = 50;

function invert(
  target: number,
  f: (t: number) => number,
  dfdt: (t: number) => number,
  what: string,
): number {
  if (!(target >= f(T_MIN_K) && target <= f(T_MAX_K))) {
    throw new Error(`${what} ${target} is outside the range of [${T_MIN_K}, ${T_MAX_K}] K`);
  }
  // f is monotonic and smooth, so Newton from a secant guess converges in a few steps
  let t = T_MIN_K + ((target - f(T_MIN_K)) / (f(T_MAX_K) - f(T_MIN_K))) * (T_MAX_K - T_MIN_K);
  for (let i = 0; i < MAX_NEWTON; i++) {
    const step = (f(t) - target) / dfdt(t);
    t = Math.min(T_MAX_K, Math.max(T_MIN_K, t - step));
    if (Math.abs(step) < INVERSE_TOLERANCE_K) return t;
  }
  /* c8 ignore next */
  throw new Error(`${what} inversion did not converge`);
}

/** T such that enthalpy(T, far) = h. */
export function temperatureFromEnthalpy(h: number, far: number): number {
  return invert(
    h,
    (t) => enthalpy(t, far),
    (t) => cp(t, far),
    'enthalpy',
  );
}

/** T such that entropyFunction(T) - R ln(p / 101325) = s (fixed composition). */
export function temperatureFromEntropy(s: number, pPa: number, far: number): number {
  const target = s + gasConstant(far) * Math.log(pPa / 101325);
  return invert(
    target,
    (t) => entropyFunction(t, far),
    (t) => cp(t, far) / t,
    'entropy',
  );
}

/** Temperature after an isentropic pressure change by the ratio p2/p1 from t1. */
export function isentropicTemperature(t1: number, pressureRatio: number, far: number): number {
  const target = entropyFunction(t1, far) + gasConstant(far) * Math.log(pressureRatio);
  return invert(
    target,
    (t) => entropyFunction(t, far),
    (t) => cp(t, far) / t,
    'entropy',
  );
}
