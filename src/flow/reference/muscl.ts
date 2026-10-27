// MUSCL reconstruction with the van Albada limiter and the per-cell, per-direction positivity
// fallback (docs/SOLVER.md section 6). Slopes are per cell and per grid direction; a cell's two face
// values in that direction are q +- sigma / 2.
import type { ReferenceState } from './gas';

/** van Albada (1982) limited average of two one-sided slopes; symmetric and odd, bitwise. */
export function vanAlbada(a: number, b: number): number {
  const ab = a * b;
  return ab > 0 ? (ab * (a + b)) / (a * a + b * b + 1e-30) : 0;
}

/**
 * Limited slopes of the six primitives of cell c along a grid line with neighbours m (before) and
 * p (after), from primitive records P[mOff..], P[cOff..], P[pOff..], into out[oOff..oOff + 6).
 * If either face value would have rho <= 0 or p <= 0, every slope is set to 0 (first order) and
 * true is returned.
 */
export function limitedSlopes(
  ref: ReferenceState,
  P: ArrayLike<number>,
  mOff: number,
  cOff: number,
  pOff: number,
  out: Float64Array,
  oOff: number,
): boolean {
  for (let k = 0; k < 6; k++) {
    const q = P[cOff + k] as number;
    out[oOff + k] = vanAlbada(q - (P[mOff + k] as number), (P[pOff + k] as number) - q);
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
