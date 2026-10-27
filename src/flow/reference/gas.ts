// The flow solver's gas model (docs/SOLVER.md section 3): the src/thermo polynomial tables (or a
// calorically perfect stand-in for the verification cases) evaluated in "gauge" form. Enthalpy and
// entropy differences are divided differences, (T - T0) times a secant cp, never a difference of two
// large numbers, so the ambient gives exact zeros and an f32 kernel keeps the perturbation's bits.
import { GAS_TABLES, type GasSegment } from '../../thermo/gas';

export interface GasSpecies {
  /** Specific gas constant, J/(kg K). */
  readonly r: number;
  readonly low: GasSegment;
  readonly high: GasSegment;
}

/** Air and stoichiometric products, mixed by the products mass fraction phi(Z). */
export interface GasModel {
  readonly name: string;
  readonly air: GasSpecies;
  readonly products: GasSpecies;
  readonly stoichFar: number;
  /** Polynomial range break, K: T < tBreak uses `low`. */
  readonly tBreak: number;
}

const species = (g: (typeof GAS_TABLES.gases)['air']): GasSpecies => ({
  r: g.rJPerKgK,
  low: g.low,
  high: g.high,
});

/** The production gas: src/thermo's NASA-polynomial air and Jet-A products (PHYSICS.md section 2). */
export const THERMALLY_PERFECT: GasModel = {
  name: 'thermally perfect (src/thermo)',
  air: species(GAS_TABLES.gases.air),
  products: species(GAS_TABLES.gases.products),
  stoichFar: GAS_TABLES.stoichiometricFar,
  tBreak: GAS_TABLES.tBreakK,
};

/**
 * Constant cp = gamma R / (gamma - 1) for both gases, in the same table form (same code path),
 * for the cases checked against calorically perfect theory (ladder L2-L5, L7, L9).
 */
export function caloricallyPerfectGas(gamma: number, r: number): GasModel {
  const cp = (gamma * r) / (gamma - 1);
  const tRef = GAS_TABLES.tRefK;
  const seg: GasSegment = {
    cp: [cp, 0, 0, 0, 0],
    hConst: -cp * tRef,
    sConst: -cp * Math.log(tRef),
  };
  const sp: GasSpecies = { r, low: seg, high: seg };
  return {
    name: `calorically perfect (gamma ${gamma})`,
    air: sp,
    products: sp,
    stoichFar: GAS_TABLES.stoichiometricFar,
    tBreak: GAS_TABLES.tBreakK,
  };
}

function segCp(seg: GasSegment, t: number): number {
  const [c0, c1, c2, c3, c4] = seg.cp;
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * c4)));
}

function segH(seg: GasSegment, t: number): number {
  const [c0, c1, c2, c3, c4] = seg.cp;
  return seg.hConst + t * (c0 + t * (c1 / 2 + t * (c2 / 3 + t * (c3 / 4 + (t * c4) / 5))));
}

/** Secant cp: (h(t) - h(t0)) / (t - t0) = sum_k c_k / (k + 1) P_k, P_0 = 1, P_k = t P_{k-1} + t0^k. */
function secantCp(seg: GasSegment, t: number, t0: number): number {
  const [c0, c1, c2, c3, c4] = seg.cp;
  const p1 = t + t0;
  const t02 = t0 * t0;
  const p2 = t * p1 + t02;
  const p3 = t * p2 + t02 * t0;
  const p4 = t * p3 + t02 * t02;
  return c0 + (c1 / 2) * p1 + (c2 / 3) * p2 + (c3 / 4) * p3 + (c4 / 5) * p4;
}

/** Entropy secant: (phi_s(t) - phi_s(t0) - c0 ln(t / t0)) / (t - t0) = sum_{k>=1} c_k / k P_{k-1}. */
function secantS(seg: GasSegment, t: number, t0: number): number {
  const [, c1, c2, c3, c4] = seg.cp;
  const p1 = t + t0;
  const t02 = t0 * t0;
  const p2 = t * p1 + t02;
  const p3 = t * p2 + t02 * t0;
  return c1 + (c2 / 2) * p1 + (c3 / 3) * p2 + (c4 / 4) * p3;
}

function speciesDh(sp: GasSpecies, tb: number, t0: number, tau: number): number {
  const t = t0 + tau;
  if (t0 < tb) {
    if (t < tb) return tau * secantCp(sp.low, t, t0);
    return (tb - t0) * secantCp(sp.low, tb, t0) + (t - tb) * secantCp(sp.high, t, tb);
  }
  if (t >= tb) return tau * secantCp(sp.high, t, t0);
  return (tb - t0) * secantCp(sp.high, tb, t0) + (t - tb) * secantCp(sp.low, t, tb);
}

function segDs(seg: GasSegment, t0: number, tau: number): number {
  return seg.cp[0] * Math.log1p(tau / t0) + tau * secantS(seg, t0 + tau, t0);
}

function speciesDs(sp: GasSpecies, tb: number, t0: number, tau: number): number {
  const t = t0 + tau;
  if (t0 < tb) {
    if (t < tb) return segDs(sp.low, t0, tau);
    return segDs(sp.low, t0, tb - t0) + segDs(sp.high, tb, t - tb);
  }
  if (t >= tb) return segDs(sp.high, t0, tau);
  return segDs(sp.high, t0, tb - t0) + segDs(sp.low, tb, t - tb);
}

const segmentAt = (sp: GasSpecies, tb: number, t: number): GasSegment =>
  t < tb ? sp.low : sp.high;

/** Products mass fraction of a mixture of fuel-air ratio z (z clamped to [0, f_st]). */
export function productsFraction(gas: GasModel, z: number): number {
  const f = gas.stoichFar;
  const zc = z > 0 ? (z < f ? z : f) : 0;
  return (zc * (1 + f)) / (f * (1 + zc));
}

export function gasConstantMix(gas: GasModel, phi: number): number {
  return gas.air.r + phi * (gas.products.r - gas.air.r);
}

export function cpMix(gas: GasModel, t: number, phi: number): number {
  const a = segCp(segmentAt(gas.air, gas.tBreak, t), t);
  return phi === 0 ? a : a + phi * (segCp(segmentAt(gas.products, gas.tBreak, t), t) - a);
}

/** h(t0 + tau, phi) - h(t0, phi), J/kg, as a divided difference. */
export function enthalpyDelta(gas: GasModel, t0: number, tau: number, phi: number): number {
  const a = speciesDh(gas.air, gas.tBreak, t0, tau);
  return phi === 0 ? a : a + phi * (speciesDh(gas.products, gas.tBreak, t0, tau) - a);
}

/** phi_s(t0 + tau, phi) - phi_s(t0, phi), J/(kg K) (phi_s = the integral of cp / T). */
export function entropyDelta(gas: GasModel, t0: number, tau: number, phi: number): number {
  const a = speciesDs(gas.air, gas.tBreak, t0, tau);
  return phi === 0 ? a : a + phi * (speciesDs(gas.products, gas.tBreak, t0, tau) - a);
}

export function soundSpeed(gas: GasModel, t: number, phi: number): number {
  const cp = cpMix(gas, t, phi);
  const r = gasConstantMix(gas, phi);
  return Math.sqrt((cp * r * t) / (cp - r));
}

/** The ambient the gauge variables are measured from (axial free-stream velocity u). */
export interface ReferenceState {
  readonly gas: GasModel;
  readonly rho: number;
  readonly p: number;
  readonly t: number;
  readonly u: number;
  /** Air's gas constant (the ambient is air, Z = 0). */
  readonly r: number;
  readonly cp: number;
  readonly cv: number;
  readonly gamma: number;
  readonly c: number;
  /** Static and total enthalpy of the ambient (src/thermo datum: 0 at 298.15 K). */
  readonly h: number;
  readonly h0: number;
  /** h_products(T_inf) - h_air(T_inf). */
  readonly dInf: number;
}

export function referenceState(
  gas: GasModel,
  free: { readonly pressure: number; readonly temperature: number; readonly velocity: number },
): ReferenceState {
  const t = free.temperature;
  const r = gas.air.r;
  const cp = cpMix(gas, t, 0);
  const h = segH(segmentAt(gas.air, gas.tBreak, t), t);
  return {
    gas,
    rho: free.pressure / (r * t),
    p: free.pressure,
    t,
    u: free.velocity,
    r,
    cp,
    cv: cp - r,
    gamma: cp / (cp - r),
    c: Math.sqrt((cp * r * t) / (cp - r)),
    h,
    h0: h + 0.5 * free.velocity * free.velocity,
    dInf: segH(segmentAt(gas.products, gas.tBreak, t), t) - h,
  };
}

/** Delta h(T', phi) = h(T_inf + T', phi) - h_air(T_inf). */
export function deltaH(ref: ReferenceState, tP: number, phi: number): number {
  const g = ref.gas;
  const a = speciesDh(g.air, g.tBreak, ref.t, tP);
  return phi === 0 ? a : a + phi * (speciesDh(g.products, g.tBreak, ref.t, tP) - a + ref.dInf);
}

/** Delta e(T', phi) = e(T, phi) - e_inf = Delta h - R_inf T' - (R - R_inf) T. */
export function deltaE(ref: ReferenceState, tP: number, phi: number): number {
  const dr = gasConstantMix(ref.gas, phi) - ref.r;
  return deltaH(ref, tP, phi) - ref.r * tP - dr * (ref.t + tP);
}

/** Fixed Newton count of the energy inversion (the WGSL kernel uses the same). */
export const NEWTON_STEPS = 3;

/** T' with Delta e(T', phi) = de: NEWTON_STEPS Newton steps from the linearised start. */
export function temperatureGauge(ref: ReferenceState, de: number, phi: number): number {
  const g = ref.gas;
  const r = gasConstantMix(g, phi);
  const dr = r - ref.r;
  let tP = (de - phi * ref.dInf + dr * ref.t) / (cpMix(g, ref.t, phi) - r);
  for (let k = 0; k < NEWTON_STEPS; k++) {
    tP -= (deltaE(ref, tP, phi) - de) / (cpMix(g, ref.t + tP, phi) - r);
  }
  return tP;
}

/** T' from the pressure and density gauges: rho R (T_inf + T') = p_inf + p'. */
export function temperatureFromPressure(
  ref: ReferenceState,
  rhoP: number,
  pP: number,
  phi: number,
): number {
  const r = gasConstantMix(ref.gas, phi);
  return (pP - rhoP * r * ref.t - ref.rho * ref.t * (r - ref.r)) / ((ref.rho + rhoP) * r);
}

/** p' = rho R T - p_inf in gauge form. */
export function pressureGauge(ref: ReferenceState, rhoP: number, tP: number, phi: number): number {
  const r = gasConstantMix(ref.gas, phi);
  const rho = ref.rho + rhoP;
  return rhoP * ref.r * ref.t + rho * ref.r * tP + rho * (r - ref.r) * (ref.t + tP);
}
