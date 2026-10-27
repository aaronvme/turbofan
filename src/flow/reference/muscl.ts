// MUSCL reconstruction with the van Albada limiter (sharp, or the smooth D4-25 trial form) and the
// per-cell, per-direction positivity fallback (docs/SOLVER.md section 6). Slopes are per cell and
// per grid direction; a cell's two face values in that direction are q +- sigma / 2.
import type { ReferenceState } from './gas';

/** K_eps: the limiter's eps is this fraction of each variable's reference scale (section 6). */
export const LIMITER_EPS = 1e-3;

/** van Albada (1982) limited average of two one-sided slopes; symmetric and odd, bitwise. */
export function vanAlbada(a: number, b: number): number {
  const ab = a * b;
  return ab > 0 ? (ab * (a + b)) / (a * a + b * b + 1e-30) : 0;
}

/**
 * The smooth van Albada (van Albada, van Leer & Roberts 1982) limited average of two one-sided
 * slopes, (a + b)(ab + eps^2) / (a^2 + b^2 + 2 eps^2): the classic van Albada for |a|, |b| >> eps,
 * the central slope for |a|, |b| << eps, and differentiable (no ab > 0 switch). Symmetric and odd,
 * bitwise, in this expression order. The D4-25 trial form (option `limiter: 'smooth'`, section 6).
 */
export function smoothVanAlbada(a: number, b: number, eps: number): number {
  const e2 = eps * eps;
  return ((a + b) * (a * b + e2)) / (a * a + b * b + 2 * e2);
}

/**
 * eps_k = LIMITER_EPS S_k of primitive k at cell radius rc, S = (rho_inf, c_inf, c_inf, c_inf rc,
 * rho_inf c_inf^2, f_st) for (rho', u, v, rw, p', Z): acoustic-consistent scales, and c_inf in
 * w = rw / r for the swirl.
 */
export function limiterEpsilon(ref: ReferenceState, k: number, rc: number): number {
  switch (k) {
    case 0:
      return LIMITER_EPS * ref.rho;
    case 3:
      return LIMITER_EPS * ref.c * rc;
    case 4:
      return LIMITER_EPS * ref.rho * ref.c * ref.c;
    case 5:
      return LIMITER_EPS * ref.gas.stoichFar;
    default:
      return LIMITER_EPS * ref.c;
  }
}

/**
 * Limited slopes of the six primitives of cell c (radius rc; a ghost: its source cell's) along a
 * grid line with neighbours m (before) and p (after), from primitive records P[mOff..], P[cOff..],
 * P[pOff..], into out[oOff..oOff + 6), with the sharp van Albada or (`smooth`) the smooth form at
 * eps_k (limiterEpsilon). If either face value would have rho <= 0 or p <= 0, every slope is set to
 * 0 (first order) and true is returned.
 */
export function limitedSlopes(
  ref: ReferenceState,
  P: ArrayLike<number>,
  mOff: number,
  cOff: number,
  pOff: number,
  rc: number,
  out: Float64Array,
  oOff: number,
  smooth = false,
): boolean {
  for (let k = 0; k < 6; k++) {
    const q = P[cOff + k] as number;
    const a = q - (P[mOff + k] as number);
    const b = (P[pOff + k] as number) - q;
    out[oOff + k] = smooth ? smoothVanAlbada(a, b, limiterEpsilon(ref, k, rc)) : vanAlbada(a, b);
  }
  const rho = ref.rho + (P[cOff] as number);
  const p = ref.p + (P[cOff + 4] as number);
  const halfRho = 0.5 * Math.abs(out[oOff] as number);
  const halfP = 0.5 * Math.abs(out[oOff + 4] as number);
  // the lower of the two face values is q - |sigma| / 2 (written as a negated test so NaN falls back)
  if (!(rho - halfRho > 0 && p - halfP > 0)) {
    out.fill(0, oOff, oOff + 6);
    return true;
  }
  return false;
}
