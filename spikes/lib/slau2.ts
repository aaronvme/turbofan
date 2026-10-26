// f64 reference of the SLAU2 flux exactly as the spike's WGSL kernel computes it, used to test
// the GPU code. SLAU2: Kitamura & Shima, J. Comput. Phys. 245 (2013) 62-83, eqs. for the mass
// flux (SLAU, Shima & Kitamura 2011) and the SLAU2 pressure flux
//   p~ = (pL + pR)/2 + (b+L - b-R)/2 (pL - pR) + sqrt((|uL|^2 + |uR|^2)/2) (b+L + b-R - 1) rho_avg c_avg.
//
// Variables follow the solver design (docs/PHYSICS.md): per-radian r-weighted finite volume
// with conserved (rho', rho u, rho v, rho r w, eta, rho Z), gauge pressure p' = p - pInf and
// total-enthalpy gauge h0 - h0Inf. Primitives carried to faces: rho, u, v, rw (specific angular
// momentum r u_theta), p', Z. The face radius rf turns rw into the swirl velocity w.

import { GAS_R, cpH } from './gas';

export interface FluxPrim {
  readonly rho: number;
  readonly u: number;
  readonly v: number;
  /** r * u_theta, specific angular momentum. */
  readonly rw: number;
  /** p - pInf. */
  readonly pp: number;
  /** Fuel-air ratio. */
  readonly z: number;
}

export interface FluxContext {
  readonly pInf: number;
  readonly h0Inf: number;
  /** Products mass fraction per unit fuel-air ratio: y = clamp(z * zMix, 0, 1). */
  readonly zMix: number;
}

/** [mass, x-momentum, r-momentum, angular momentum, eta, rho Z] through the face. */
export type Flux = [number, number, number, number, number, number];

interface Side {
  rho: number;
  vn: number;
  q2: number;
  c: number;
  dh0: number;
}

function side(q: FluxPrim, n: readonly [number, number], invR: number, ctx: FluxContext): Side {
  const w = q.rw * invR;
  const T = (ctx.pInf + q.pp) / (q.rho * GAS_R);
  const y = Math.min(1, Math.max(0, q.z * ctx.zMix));
  const g = cpH(T, y);
  const gamma = g.cp / (g.cp - GAS_R);
  const q2 = q.u * q.u + q.v * q.v + w * w;
  return {
    rho: q.rho,
    vn: q.u * n[0] + q.v * n[1],
    q2,
    c: Math.sqrt(gamma * GAS_R * T),
    dh0: g.h + 0.5 * q2 - ctx.h0Inf,
  };
}

function betaPlus(m: number): number {
  return Math.abs(m) >= 1 ? 0.5 * (1 + Math.sign(m)) : 0.25 * (2 - m) * (m + 1) ** 2;
}

function betaMinus(m: number): number {
  return Math.abs(m) >= 1 ? 0.5 * (1 - Math.sign(m)) : 0.25 * (2 + m) * (m - 1) ** 2;
}

export function slau2Flux(
  L: FluxPrim,
  R: FluxPrim,
  S: readonly [number, number],
  rf: number,
  ctx: FluxContext,
): Flux {
  const area = Math.hypot(S[0], S[1]);
  if (area <= 0) return [0, 0, 0, 0, 0, 0];
  const n: [number, number] = [S[0] / area, S[1] / area];
  const invR = 1 / rf;
  const l = side(L, n, invR, ctx);
  const r = side(R, n, invR, ctx);

  const cbar = 0.5 * (l.c + r.c);
  const mL = l.vn / cbar;
  const mR = r.vn / cbar;
  const qAvg = Math.sqrt(0.5 * (l.q2 + r.q2));
  const mHat = Math.min(1, qAvg / cbar);
  const chi = (1 - mHat) ** 2;
  const g = -Math.max(Math.min(mL, 0), -1) * Math.min(Math.max(mR, 0), 1);
  const vbar = (l.rho * Math.abs(l.vn) + r.rho * Math.abs(r.vn)) / (l.rho + r.rho);
  const vbarP = (1 - g) * vbar + g * Math.abs(l.vn);
  const vbarM = (1 - g) * vbar + g * Math.abs(r.vn);
  const mdot =
    0.5 * (l.rho * (l.vn + vbarP) + r.rho * (r.vn - vbarM) - (chi / cbar) * (R.pp - L.pp));

  const bp = betaPlus(mL);
  const bm = betaMinus(mR);
  const ptilde =
    0.5 * (L.pp + R.pp) +
    0.5 * (bp - bm) * (L.pp - R.pp) +
    qAvg * (bp + bm - 1) * 0.5 * (l.rho + r.rho) * cbar;

  const mp = 0.5 * (mdot + Math.abs(mdot));
  const mm = 0.5 * (mdot - Math.abs(mdot));
  return [
    area * (mp + mm),
    area * (mp * L.u + mm * R.u + ptilde * n[0]),
    area * (mp * L.v + mm * R.v + ptilde * n[1]),
    area * (mp * L.rw + mm * R.rw),
    area * (mp * l.dh0 + mm * r.dh0),
    area * (mp * L.z + mm * R.z),
  ];
}

/** The exact (inviscid) flux of one state through the face. */
export function physicalFlux(
  q: FluxPrim,
  S: readonly [number, number],
  rf: number,
  ctx: FluxContext,
): Flux {
  const area = Math.hypot(S[0], S[1]);
  if (area <= 0) return [0, 0, 0, 0, 0, 0];
  const n: [number, number] = [S[0] / area, S[1] / area];
  const s = side(q, n, 1 / rf, ctx);
  const m = q.rho * s.vn;
  return [
    area * m,
    area * (m * q.u + q.pp * n[0]),
    area * (m * q.v + q.pp * n[1]),
    area * m * q.rw,
    area * m * s.dh0,
    area * m * q.z,
  ];
}
