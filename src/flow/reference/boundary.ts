// Ghost-cell boundary conditions (docs/SOLVER.md section 5). The codes are the mesh asset's
// (tools/mesh/types.ts BC, never renumbered): 0 interface, 1 slip wall, 2 axis, 3 far field,
// 4 inflow, 5 outflow. Each ghost is computed from its source cell's primitive record and the unit
// outward normal of its boundary face.
import {
  NEWTON_STEPS,
  cpMix,
  enthalpyDelta,
  entropyDelta,
  soundSpeed,
  type ReferenceState,
} from './gas';
import { NP } from './state';

export const BC_CODE = {
  INTERFACE: 0,
  SLIP_WALL: 1,
  AXIS: 2,
  FARFIELD: 3,
  INFLOW: 4,
  OUTFLOW: 5,
} as const;

export interface BoundaryParams {
  /** Inflow total pressure and temperature (default: the free stream's). */
  readonly p0: number;
  readonly t0: number;
  /** Outflow static pressure (default p_inf). */
  readonly pOut: number;
}

/** Total temperature and pressure of the free stream (thermally perfect: h and phi_s exact). */
export function freeStreamTotals(ref: ReferenceState): { p0: number; t0: number } {
  const g = ref.gas;
  const dh = 0.5 * ref.u * ref.u;
  let tau = dh / ref.cp;
  for (let k = 0; k < 20; k++)
    tau -= (enthalpyDelta(g, ref.t, tau, 0) - dh) / cpMix(g, ref.t + tau, 0);
  return { p0: ref.p * Math.exp(entropyDelta(g, ref.t, tau, 0) / ref.r), t0: ref.t + tau };
}

export function boundaryParams(
  ref: ReferenceState,
  opts: {
    readonly inflowTotal?: { readonly p0: number; readonly t0: number };
    readonly outflowPressure?: number;
  } = {},
): BoundaryParams {
  const totals = opts.inflowTotal ?? freeStreamTotals(ref);
  return { p0: totals.p0, t0: totals.t0, pOut: opts.outflowPressure ?? ref.p };
}

function copy(P: ArrayLike<number>, s: number, out: Float64Array, o: number): void {
  for (let k = 0; k < NP; k++) out[o + k] = P[s + k] ?? NaN;
}

/** Linearised characteristic far field about the free stream (section 5). */
function farField(
  ref: ReferenceState,
  P: ArrayLike<number>,
  s: number,
  nx: number,
  nr: number,
  out: Float64Array,
  o: number,
): void {
  const rhoC = ref.rho * ref.c;
  const du = (P[s + 1] ?? NaN) - ref.u;
  const dv = P[s + 2] ?? NaN;
  const pP = P[s + 4] ?? NaN;
  const dun = du * nx + dv * nr;
  const dut = -du * nr + dv * nx;
  const vnInf = ref.u * nx;
  const wPlus = vnInf + ref.c > 0 ? pP + rhoC * dun : 0;
  const wMinus = vnInf - ref.c > 0 ? pP - rhoC * dun : 0;
  const pb = 0.5 * (wPlus + wMinus);
  const unb = (wPlus - wMinus) / (2 * rhoC);
  const outflow = vnInf + unb >= 0;
  const ws = outflow ? pP - ref.c * ref.c * (P[s] ?? NaN) : 0;
  const utb = outflow ? dut : 0;
  out[o] = (pb - ws) / (ref.c * ref.c);
  out[o + 1] = ref.u + unb * nx - utb * nr;
  out[o + 2] = unb * nr + utb * nx;
  out[o + 3] = outflow ? (P[s + 3] ?? NaN) : 0;
  out[o + 4] = pb;
  out[o + 5] = outflow ? (P[s + 5] ?? NaN) : 0;
  out[o + 6] = P[s + 6] ?? NaN;
  out[o + 7] = P[s + 7] ?? NaN;
}

/**
 * Subsonic inflow at the total conditions (p0, t0), normal to the boundary, no swirl, Z = 0: the
 * static pressure is the cell's, the temperature is on the isentrope through (p0, t0) and the speed
 * follows from h0. A supersonic free stream is imposed whole.
 */
function inflow(
  ref: ReferenceState,
  bp: BoundaryParams,
  P: ArrayLike<number>,
  s: number,
  nx: number,
  nr: number,
  out: Float64Array,
  o: number,
): void {
  if (ref.u >= ref.c) {
    out.fill(0, o, o + NP);
    out[o + 1] = ref.u;
    out[o + 7] = ref.c;
    return;
  }
  const g = ref.gas;
  const r = ref.r;
  const pP = P[s + 4] ?? NaN;
  // phi_s(t0 + tau) - phi_s(t0) = R ln(pb / p0), written with log1p of the small difference
  const x = (pP - (bp.p0 - ref.p)) / bp.p0;
  const target = r * Math.log1p(x);
  const cp0 = cpMix(g, bp.t0, 0);
  let tau = bp.t0 * Math.expm1((r / cp0) * Math.log1p(x));
  for (let k = 0; k < NEWTON_STEPS; k++) {
    const t = bp.t0 + tau;
    tau -= (entropyDelta(g, bp.t0, tau, 0) - target) / (cpMix(g, t, 0) / t);
  }
  const tb = bp.t0 + tau;
  const speed = Math.sqrt(Math.max(0, -2 * enthalpyDelta(g, bp.t0, tau, 0)));
  const dT = bp.t0 - ref.t + tau;
  out[o] = (pP - ref.rho * r * dT) / (r * tb);
  out[o + 1] = -nx * speed;
  out[o + 2] = -nr * speed;
  out[o + 3] = 0;
  out[o + 4] = pP;
  out[o + 5] = 0;
  out[o + 6] = dT;
  out[o + 7] = soundSpeed(g, tb, 0);
}

/**
 * The ghost primitives for BC `code` from the source cell's record P[s..], with the boundary
 * face's unit outward normal (nx, nr), into out[o..o + 8).
 */
export function ghostPrimitive(
  ref: ReferenceState,
  bp: BoundaryParams,
  code: number,
  P: ArrayLike<number>,
  s: number,
  nx: number,
  nr: number,
  out: Float64Array,
  o: number,
): void {
  switch (code) {
    case BC_CODE.SLIP_WALL: {
      copy(P, s, out, o);
      const u = P[s + 1] ?? NaN;
      const v = P[s + 2] ?? NaN;
      const vn = u * nx + v * nr;
      out[o + 1] = u - 2 * vn * nx;
      out[o + 2] = v - 2 * vn * nr;
      return;
    }
    case BC_CODE.AXIS:
      copy(P, s, out, o);
      out[o + 2] = -(P[s + 2] ?? NaN);
      return;
    case BC_CODE.FARFIELD:
      farField(ref, P, s, nx, nr, out, o);
      return;
    case BC_CODE.INFLOW:
      inflow(ref, bp, P, s, nx, nr, out, o);
      return;
    case BC_CODE.OUTFLOW: {
      copy(P, s, out, o);
      const vn = (P[s + 1] ?? NaN) * nx + (P[s + 2] ?? NaN) * nr;
      if (vn < (P[s + 7] ?? NaN)) out[o + 4] = bp.pOut - ref.p;
      return;
    }
    default:
      copy(P, s, out, o);
  }
}
