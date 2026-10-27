// Volume sources: the interface W3's body forces, combustor and bleeds plug into (docs/SOLVER.md
// section 8). A source model is called once per RK stage with that stage's primitives and fills,
// per cell, six conserved-gauge rates per unit gas volume and six point-implicit damping rates.
import { deltaH, productsFraction, type ReferenceState } from './gas';
import type { SolverMesh } from './solverMesh';
import { dq2 } from './state';

export interface SourceRates {
  /** Per cell, 6 values: d(rho', rho u, rho v, rho r w, eta, rho Z)/dt per unit gas volume. */
  readonly rate: Float64Array;
  /** Per cell, 6 values >= 0, 1/s: the diagonal of -d(rate)/dU for the point-implicit update. */
  readonly damping: Float64Array;
}

export interface SourceContext {
  readonly mesh: SolverMesh;
  readonly ref: ReferenceState;
  /** Primitive records (NP per cell; ghosts after the cells). */
  readonly prim: Float64Array;
  /** The stage's conserved state (6 per cell). */
  readonly U: Float64Array;
  /** Blockage per cell. */
  readonly blockage: Float64Array;
  /** Simulated time of the stage (physical mode: t, t + dt, t + dt / 2 for SSP-RK3's stages), s. */
  readonly time: number;
}

/** Writes into `out` (zeroed by the solver before every call). */
export type SourceModel = (ctx: SourceContext, out: SourceRates) => void;

/**
 * Rates of a mass source sm (kg/(m^3 s), negative for a sink) at the local state of the primitive
 * record P[pOff..] (cell radius rc): it carries the local velocity, angular momentum, fuel and
 * stagnation enthalpy, so s_eta = sm (h0 - h0_inf) (section 8). Writes out[oOff..oOff + 6).
 */
export function massSourceRates(
  ref: ReferenceState,
  P: ArrayLike<number>,
  pOff: number,
  rc: number,
  sm: number,
  out: Float64Array,
  oOff: number,
): void {
  const u = P[pOff + 1] as number;
  const v = P[pOff + 2] as number;
  const rw = P[pOff + 3] as number;
  const z = P[pOff + 5] as number;
  const tP = P[pOff + 6] as number;
  const dh0 = deltaH(ref, tP, productsFraction(ref.gas, z)) + 0.5 * dq2(ref, u, v, rw / rc);
  out[oOff] = sm;
  out[oOff + 1] = sm * u;
  out[oOff + 2] = sm * v;
  out[oOff + 3] = sm * rw;
  out[oOff + 4] = sm * dh0;
  out[oOff + 5] = sm * z;
}
