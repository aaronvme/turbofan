// The conserved gauge state and its primitives (docs/SOLVER.md section 4).
//   U = (rho', rho u, rho v, rho r w, eta, rho Z)     rho' = rho - rho_inf, eta = rho E - rho h0_inf + p_inf
//   q = (rho', u, v, r w, p', Z, T', c)               p' = p - p_inf, T' = T - T_inf
// In the ambient every entry of U and q except c is an exact zero.
import {
  deltaE,
  pressureGauge,
  productsFraction,
  soundSpeed,
  temperatureFromPressure,
  temperatureGauge,
  type ReferenceState,
} from './gas';

/** Conserved values per cell. */
export const NU = 6;
/** Primitive record per cell: the six reconstructed primitives, then T' and c. */
export const NP = 8;

/** q^2 - q_inf^2 without cancellation: (u - u_inf)(u + u_inf) + v^2 + w^2. */
export function dq2(ref: ReferenceState, u: number, v: number, w: number): number {
  return (u - ref.u) * (u + ref.u) + v * v + w * w;
}

/** Primitives of U[uOff..] (cell radius rc) into P[pOff..pOff + 8). */
export function consToPrim(
  ref: ReferenceState,
  U: ArrayLike<number>,
  uOff: number,
  rc: number,
  P: Float64Array,
  pOff: number,
): void {
  const rhoP = U[uOff] ?? NaN;
  const rho = ref.rho + rhoP;
  const u = (U[uOff + 1] ?? NaN) / rho;
  const v = (U[uOff + 2] ?? NaN) / rho;
  const rw = (U[uOff + 3] ?? NaN) / rho;
  const z = (U[uOff + 5] ?? NaN) / rho;
  const w = rw / rc;
  const de = ((U[uOff + 4] ?? NaN) + rhoP * ref.r * ref.t - 0.5 * rho * dq2(ref, u, v, w)) / rho;
  const phi = productsFraction(ref.gas, z);
  const tP = temperatureGauge(ref, de, phi);
  P[pOff] = rhoP;
  P[pOff + 1] = u;
  P[pOff + 2] = v;
  P[pOff + 3] = rw;
  P[pOff + 4] = pressureGauge(ref, rhoP, tP, phi);
  P[pOff + 5] = z;
  P[pOff + 6] = tP;
  P[pOff + 7] = soundSpeed(ref.gas, ref.t + tP, phi);
}

/** Conserved U[uOff..] of the primitives P[pOff..] (only the first six are read). */
export function primToCons(
  ref: ReferenceState,
  P: ArrayLike<number>,
  pOff: number,
  rc: number,
  U: Float64Array,
  uOff: number,
): void {
  const rhoP = P[pOff] ?? NaN;
  const u = P[pOff + 1] ?? NaN;
  const v = P[pOff + 2] ?? NaN;
  const rw = P[pOff + 3] ?? NaN;
  const pP = P[pOff + 4] ?? NaN;
  const z = P[pOff + 5] ?? NaN;
  const rho = ref.rho + rhoP;
  const phi = productsFraction(ref.gas, z);
  const tP = temperatureFromPressure(ref, rhoP, pP, phi);
  const w = rw / rc;
  U[uOff] = rhoP;
  U[uOff + 1] = rho * u;
  U[uOff + 2] = rho * v;
  U[uOff + 3] = rho * rw;
  U[uOff + 4] = rho * deltaE(ref, tP, phi) - rhoP * ref.r * ref.t + 0.5 * rho * dq2(ref, u, v, w);
  U[uOff + 5] = rho * z;
}

/** A physical state: density, velocity (axial, radial, swirl), static pressure, fuel-air ratio. */
export interface PhysicalState {
  readonly rho: number;
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly p: number;
  readonly z: number;
}

/** The full primitive record (with T' and c) of a physical state at radius rc. */
export function physicalToPrim(ref: ReferenceState, s: PhysicalState, rc: number): Float64Array {
  const q = new Float64Array(NP);
  const rhoP = s.rho - ref.rho;
  const pP = s.p - ref.p;
  const phi = productsFraction(ref.gas, s.z);
  const tP = temperatureFromPressure(ref, rhoP, pP, phi);
  q[0] = rhoP;
  q[1] = s.u;
  q[2] = s.v;
  q[3] = s.w * rc;
  q[4] = pP;
  q[5] = s.z;
  q[6] = tP;
  q[7] = soundSpeed(ref.gas, ref.t + tP, phi);
  return q;
}
