// Low-Mach preconditioning of the pseudo-time derivative, tracking mode only (docs/SOLVER.md
// section 10, decision D4-10): Turkel's preconditioner with alpha = 0 in (p, u, v, rw, s, Z), which
// for this gas is the Weiss & Smith (1995) form. The pressure's pseudo-time derivative is multiplied
// by 1 / beta^2, so the acoustic speed of the pseudo-time system drops to the order of the flow
// speed; the steady state (R = 0) is unchanged.
import {
  cpMix,
  deltaE,
  deltaH,
  gasConstantMix,
  productsFraction,
  soundSpeed,
  temperatureFromPressure,
  type ReferenceState,
} from './gas';
import { dq2 } from './state';

/**
 * beta^2 = min(1, max(M^2, minMach^2, dpMax / (rho c^2))) of the primitive record P[o..] at cell
 * radius rc, with dpMax the largest |p'| difference to the cell's four face neighbours and rho the
 * cell density. The pressure term (Weiss, Maruszewski & Smith 1999) keeps the preconditioner off
 * where a pressure difference drives a flow that has not yet started (a start from rest), which is
 * otherwise unstable.
 */
export function lowMachBeta2(
  P: ArrayLike<number>,
  o: number,
  rc: number,
  minMach: number,
  dpMax: number,
  rho: number,
): number {
  const u = P[o + 1] as number;
  const v = P[o + 2] as number;
  const w = (P[o + 3] as number) / rc;
  const c2 = (P[o + 7] as number) * (P[o + 7] as number);
  return Math.min(1, Math.max((u * u + v * v + w * w) / c2, minMach * minMach, dpMax / (rho * c2)));
}

/** Spectral radius of the preconditioned system along a unit normal: |vn| + c at beta^2 = 1. */
export function spectralRadius(vn: number, c: number, beta2: number): number {
  const a = Math.abs(vn);
  if (beta2 >= 1) return a + c;
  const d = 1 - beta2;
  return 0.5 * ((1 + beta2) * a + Math.sqrt(d * d * a * a + 4 * beta2 * c * c));
}

/**
 * The preconditioned spectral radius of a face neighbour's state P[o..] (a primitive record) along
 * the unit normal (nx, nr), with the neighbour's own beta (a ghost: its source cell's): the
 * neighbour's half of the local step's face eigenvalue (docs/SOLVER.md section 17, W2S-I1). Its
 * sound speed comes from its own p', rho' and Z by section 3, as SLAU2 takes a face state's (a
 * ghost's stored T' and c are don't-care, W2R-N2).
 */
export function neighbourSpectralRadius(
  ref: ReferenceState,
  P: ArrayLike<number>,
  o: number,
  nx: number,
  nr: number,
  beta: number,
): number {
  const phi = productsFraction(ref.gas, P[o + 5] as number);
  const tP = temperatureFromPressure(ref, P[o] as number, P[o + 4] as number, phi);
  const c = soundSpeed(ref.gas, ref.t + tP, phi);
  return spectralRadius((P[o + 1] as number) * nx + (P[o + 2] as number) * nr, c, beta * beta);
}

/**
 * Replaces the conserved-gauge increment dU[uOff..uOff + 6) of a cell with primitive record
 * P[pOff..] (radius rc) by its preconditioned form: dU - (1 - beta^2) (dp / c^2) dU/dp|_s, where dp
 * is the frozen-composition pressure differential of dU. The pressure increment becomes beta^2 dp;
 * the velocity, swirl, entropy and fuel increments are unchanged.
 */
export function preconditionIncrement(
  ref: ReferenceState,
  P: ArrayLike<number>,
  pOff: number,
  rc: number,
  beta2: number,
  dU: Float64Array,
  uOff: number,
): void {
  if (beta2 >= 1) return;
  const u = P[pOff + 1] as number;
  const v = P[pOff + 2] as number;
  const rw = P[pOff + 3] as number;
  const z = P[pOff + 5] as number;
  const tP = P[pOff + 6] as number;
  const c = P[pOff + 7] as number;
  const w = rw / rc;
  const phi = productsFraction(ref.gas, z);
  const t = ref.t + tP;
  const r = gasConstantMix(ref.gas, phi);
  const cv = cpMix(ref.gas, t, phi) - r;
  const q2 = u * u + v * v + w * w;
  const dRho = dU[uOff] as number;
  const bracket =
    (dU[uOff + 4] as number) +
    (ref.r * ref.t + 0.5 * (ref.u * ref.u + q2) - deltaE(ref, tP, phi)) * dRho -
    u * (dU[uOff + 1] as number) -
    v * (dU[uOff + 2] as number) -
    (w * (dU[uOff + 3] as number)) / rc;
  const dp = r * t * dRho + (r / cv) * bracket;
  const k = ((1 - beta2) * dp) / (c * c);
  const dh0 = deltaH(ref, tP, phi) + 0.5 * dq2(ref, u, v, w);
  dU[uOff] = dRho - k;
  dU[uOff + 1] = (dU[uOff + 1] as number) - k * u;
  dU[uOff + 2] = (dU[uOff + 2] as number) - k * v;
  dU[uOff + 3] = (dU[uOff + 3] as number) - k * rw;
  dU[uOff + 4] = (dU[uOff + 4] as number) - k * dh0;
  dU[uOff + 5] = (dU[uOff + 5] as number) - k * z;
}
