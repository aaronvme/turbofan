// SLAU2 face flux (docs/SOLVER.md section 7): Kitamura & Shima, J. Comput. Phys. 245 (2013) 62-83,
// with the SLAU mass flux of Shima & Kitamura, AIAA J. 49 (2011) 1693-1709. Pressures are gauges
// (p'), the energy component is the eta flux m (h0 - h0_inf). The expression order is chosen so that
// F(L, R, S) = -F(R, L, -S) bitwise, which keeps max/max block interfaces exactly conservative.
import {
  cpMix,
  deltaH,
  gasConstantMix,
  productsFraction,
  temperatureFromPressure,
  type ReferenceState,
} from './gas';
import { dq2 } from './state';

interface Side {
  rho: number;
  vn: number;
  q2: number;
  c: number;
  dh0: number;
}

const sideL: Side = { rho: 0, vn: 0, q2: 0, c: 0, dh0: 0 };
const sideR: Side = { rho: 0, vn: 0, q2: 0, c: 0, dh0: 0 };

function side(
  ref: ReferenceState,
  P: ArrayLike<number>,
  o: number,
  nx: number,
  nr: number,
  rf: number,
  s: Side,
): void {
  const rhoP = P[o] ?? NaN;
  const u = P[o + 1] ?? NaN;
  const v = P[o + 2] ?? NaN;
  const w = (P[o + 3] ?? NaN) / rf;
  const phi = productsFraction(ref.gas, P[o + 5] ?? NaN);
  const tP = temperatureFromPressure(ref, rhoP, P[o + 4] ?? NaN, phi);
  const t = ref.t + tP;
  const cp = cpMix(ref.gas, t, phi);
  const r = gasConstantMix(ref.gas, phi);
  s.rho = ref.rho + rhoP;
  s.vn = u * nx + v * nr;
  s.q2 = u * u + v * v + w * w;
  s.c = Math.sqrt((cp * r * t) / (cp - r));
  s.dh0 = deltaH(ref, tP, phi) + 0.5 * dq2(ref, u, v, w);
}

function betaPlus(m: number): number {
  return Math.abs(m) >= 1 ? 0.5 * (1 + Math.sign(m)) : 0.25 * (2 - m) * (m + 1) * (m + 1);
}

function betaMinus(m: number): number {
  return Math.abs(m) >= 1 ? 0.5 * (1 - Math.sign(m)) : 0.25 * (2 + m) * (m - 1) * (m - 1);
}

/**
 * SLAU2 flux through a face of unit normal (nx, nr), per-radian area `area` (= r_bar L) and
 * radius rf, between the face states L = PL[lOff..] and R = PR[rOff..] (primitive records).
 * Writes the six components (already times the area) to out[0..6). A zero area gives zeros.
 */
export function slau2Flux(
  ref: ReferenceState,
  PL: ArrayLike<number>,
  lOff: number,
  PR: ArrayLike<number>,
  rOff: number,
  nx: number,
  nr: number,
  area: number,
  rf: number,
  out: Float64Array,
): void {
  if (!(area > 0)) {
    out.fill(0, 0, 6);
    return;
  }
  const l = sideL;
  const r = sideR;
  side(ref, PL, lOff, nx, nr, rf, l);
  side(ref, PR, rOff, nx, nr, rf, r);
  const pL = PL[lOff + 4] ?? NaN;
  const pR = PR[rOff + 4] ?? NaN;
  const cbar = 0.5 * (l.c + r.c);
  const mL = l.vn / cbar;
  const mR = r.vn / cbar;
  const qAvg = Math.sqrt(0.5 * (l.q2 + r.q2));
  const mHat = Math.min(1, qAvg / cbar);
  const chi = (1 - mHat) * (1 - mHat);
  const g = -Math.max(Math.min(mL, 0), -1) * Math.min(Math.max(mR, 0), 1);
  const vbar = (l.rho * Math.abs(l.vn) + r.rho * Math.abs(r.vn)) / (l.rho + r.rho);
  const vbarP = (1 - g) * vbar + g * Math.abs(l.vn);
  const vbarM = (1 - g) * vbar + g * Math.abs(r.vn);
  const mdot = 0.5 * (l.rho * (l.vn + vbarP) + r.rho * (r.vn - vbarM) - (chi / cbar) * (pR - pL));
  const bp = betaPlus(mL);
  const bm = betaMinus(mR);
  const pt =
    0.5 * (pL + pR) +
    0.5 * (bp - bm) * (pL - pR) +
    qAvg * (bp + bm - 1) * 0.5 * (l.rho + r.rho) * cbar;
  const mp = 0.5 * (mdot + Math.abs(mdot));
  const mm = 0.5 * (mdot - Math.abs(mdot));
  out[0] = area * (mp + mm);
  out[1] = area * (mp * (PL[lOff + 1] ?? NaN) + mm * (PR[rOff + 1] ?? NaN) + pt * nx);
  out[2] = area * (mp * (PL[lOff + 2] ?? NaN) + mm * (PR[rOff + 2] ?? NaN) + pt * nr);
  out[3] = area * (mp * (PL[lOff + 3] ?? NaN) + mm * (PR[rOff + 3] ?? NaN));
  out[4] = area * (mp * l.dh0 + mm * r.dh0);
  out[5] = area * (mp * (PL[lOff + 5] ?? NaN) + mm * (PR[rOff + 5] ?? NaN));
}

/** The exact inviscid flux of one state through the face (for consistency checks). */
export function physicalFlux(
  ref: ReferenceState,
  P: ArrayLike<number>,
  o: number,
  nx: number,
  nr: number,
  area: number,
  rf: number,
  out: Float64Array,
): void {
  const s = sideL;
  side(ref, P, o, nx, nr, rf, s);
  const m = s.rho * s.vn;
  const pP = P[o + 4] ?? NaN;
  out[0] = area * m;
  out[1] = area * (m * (P[o + 1] ?? NaN) + pP * nx);
  out[2] = area * (m * (P[o + 2] ?? NaN) + pP * nr);
  out[3] = area * m * (P[o + 3] ?? NaN);
  out[4] = area * m * s.dh0;
  out[5] = area * m * (P[o + 5] ?? NaN);
}
