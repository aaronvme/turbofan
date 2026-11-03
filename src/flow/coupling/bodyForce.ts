// Blade-row body forces (PHYSICS.md 2 and 3.3 CP1; SOLVER.md 8): the f64 form of record, which the
// oracle's source model uses and the WGSL kernel transcribes (src/flow/gpu/wgsl/bodyForce.ts).
//
// Compressor rows (fan, OGV, booster, HPC with the scheduled VSVs): Hall's model with Thollet's
// blockage and compressibility terms (Hall, Greitzer & Tan 2017, J. Turbomach. 139; Thollet 2017,
// PhD thesis, ISAE). Per unit mass, with W the relative velocity, delta its angle from the local
// camber in the x-theta plane, s the pitch, kappa the camber angle, b the blockage:
//   normal f_n = K_n pi K_M W^2 g(delta) / (s |cos kappa| b), normal to W in the x-theta plane,
//            turning W toward the camber (it does no work in the relative frame);
//   loss   f_p = K_p 1/2 W^2 (2 C_f + 2 pi K_M min(|delta|, delta_s)^2 + K_rev rev^2) / (s |cos kappa| b),
//            against W;
// K_M = 1 / sqrt(1 - min(M_rel^2, MACH_CAP^2)) (Thollet's Prandtl-Glauert factor, capped below
// its singularity), C_f = 0.0592 Re_c^-0.2 at the row's design chord Reynolds number.
// g is the stall saturation: g = delta up to the stall incidence delta_s, then held at delta_s and
// rolled off to 0 at a flow exactly against the camber (|delta| = pi), continuous throughout.
// rev = max(0, -u / |W|) is the reversed-flow fraction: the reversed-flow loss is 0 in forward flow
// and grows continuously through u = 0.
//
// Turbine rows (HPT, LPT): a stiff follow-camber relaxation of the cross-camber velocity
// W_n = W . n_c (n_c the camber normal in the x-theta plane) at the rate K_t FOLLOW_CAMBER_RATE |W| / s,
// plus the friction loss. Every force is dissipative in the relative frame (W . f <= 0).
//
// Energy: a rotor's blade does work only by turning, so s_eta = Omega s_(rho r w) exactly (Euler
// work, SOLVER.md 1; ladder L9's identity). The point-implicit damping (SOLVER.md 10) bounds the
// eigenvalue of -ds/dU of the momentum components (each force's Jacobian is about rank one, along
// its normal), applied to each component; it changes the iteration, not the steady state.
import { sutherlandViscosity } from '../../cycle/engine';
import type { EngineDefinition } from '../../contracts/engine';
import { ENGINE_MEANLINE } from '../../engine/definition';
import type { SolverMesh } from '../reference/solverMesh';
import type { SourceModel } from '../reference/sources';
import { NP, NU } from '../reference/state';
import { rowKnobs, type Knobs } from './knobs';
import { MIN_COS_KAMBER, vsvCamberShift, type MeshRow } from './rows';

/** Per cell: omega, kappa, cN, cP, deltaStall, cf2, kRev, kind. */
export const BODY_FORCE_STRIDE = 8;
export const BODY_FORCE_KIND = { none: 0, compressor: 1, turbine: 2 } as const;

/** Assumed: the stall incidence on the local camber, rad (8.6 deg; no public CFM56 data). */
export const STALL_INCIDENCE_RAD = 0.15;
/** Assumed: the relative Mach number at which Thollet's K_M is capped (K_M <= 1.67). */
export const MACH_CAP = 0.8;
/** Assumed: the reversed-flow loss coefficient (about 3 dynamic heads per row at solidity 1). */
export const REVERSED_FLOW_LOSS = 3;
/** Assumed: the follow-camber relaxation rate, per pitch length (stiff: W_n relaxes in s / 20). */
export const FOLLOW_CAMBER_RATE = 20;

/** The operating point the body forces need (FlowTargets' fields). */
export interface RowOperatingPoint {
  /** Shaft speeds as magnitudes, rad/s (the rows' signed Omega = rotation x these). */
  readonly n1RadPerS: number;
  readonly n2RadPerS: number;
  readonly vsvClosureRad: number;
}

/** An angle wrapped to [-pi, pi). */
export function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/**
 * The stall saturation g(delta): delta up to the stall incidence, then delta_s cos^2 of the way
 * from delta_s to pi, so the turning force holds its stall value and falls to 0 for a flow against
 * the camber. Continuous (C0 at delta_s, odd, 0 at +-pi, so continuous across the wrap too).
 */
export function stallSaturation(delta: number, deltaStall: number): number {
  const a = Math.abs(delta);
  if (a <= deltaStall) return delta;
  const c = Math.cos((0.5 * Math.PI * (a - deltaStall)) / (Math.PI - deltaStall));
  return Math.sign(delta) * deltaStall * c * c;
}

/**
 * The force per unit mass (out[0..2]: f_x, f_r, f_theta, m/s^2) and its point-implicit damping
 * (out[3..5], 1/s, for rho u, rho v and rho r w) of one cell with coefficients k[o..o + 8), at the
 * absolute velocity (u, v, w), radius r and sound speed c.
 */
export function cellForce(
  k: ArrayLike<number>,
  o: number,
  u: number,
  v: number,
  w: number,
  r: number,
  c: number,
  out: Float64Array,
): void {
  for (let m = 0; m < 6; m++) out[m] = 0;
  const kind = k[o + 7] as number;
  if (kind === BODY_FORCE_KIND.none) return;
  const omega = k[o] as number;
  const kappa = k[o + 1] as number;
  const cN = k[o + 2] as number;
  const cP = k[o + 3] as number;
  const wt = w - omega * r;
  const w2 = u * u + v * v + wt * wt;
  if (w2 === 0) return;
  const wm = Math.sqrt(w2);
  const rev = Math.max(0, -u / wm);
  let fx = 0;
  let ft = 0;
  let dx = 0;
  let dt = 0;
  let loss = (k[o + 5] as number) + (k[o + 6] as number) * rev * rev;
  if (kind === BODY_FORCE_KIND.compressor) {
    const ds = k[o + 4] as number;
    const km = 1 / Math.sqrt(1 - Math.min(w2 / (c * c), MACH_CAP * MACH_CAP));
    const delta = wrapAngle(Math.atan2(wt, u) - kappa);
    const dl = Math.min(Math.abs(delta), ds);
    loss += 2 * Math.PI * km * dl * dl;
    const a = Math.sqrt(u * u + wt * wt);
    if (a > 0) {
      // -fn n, n = (-wt, 0, u) / a: positive delta pushes W toward -theta
      const fn = cN * km * w2 * stallSaturation(delta, ds);
      fx = (fn * wt) / a;
      ft = (-fn * u) / a;
      // the normal force's Jacobian is about rank one along n with the eigenvalue dn; the full dn
      // on both components keeps the point-implicit step contractive along n at any dt (dn n_i^2
      // would let the n component overshoot by up to 2x at large dt dn: neutral, not damped)
      const dn = (cN * km * w2) / a;
      dx = dn;
      dt = dn;
    }
  } else {
    // follow-camber: -rate W_n n_c, n_c = (-sin kappa, 0, cos kappa)
    const sk = Math.sin(kappa);
    const ck = Math.cos(kappa);
    const rate = cN * wm;
    const wn = -u * sk + wt * ck;
    fx = rate * wn * sk;
    ft = -rate * wn * ck;
    // rank one along n_c with the eigenvalue rate: the full rate on both (as dn above)
    dx = rate;
    dt = rate;
  }
  const fp = cP * w2 * loss;
  const dp = 2 * cP * wm * loss;
  out[0] = fx - (fp * u) / wm;
  out[1] = (-fp * v) / wm;
  out[2] = ft - (fp * wt) / wm;
  out[3] = dx + dp;
  out[4] = dp;
  out[5] = dt + dp;
}

/**
 * Adds the body forces' rates and damping of every row cell (SOLVER.md 8's units: per unit gas
 * volume): rho f_x, rho f_r, rho r f_theta, and Omega times the last for the energy.
 */
export function addBodyForceRates(
  k: ArrayLike<number>,
  mesh: SolverMesh,
  rhoInf: number,
  prim: ArrayLike<number>,
  rate: Float64Array,
  damping: Float64Array,
): void {
  const f = new Float64Array(6);
  for (let c = 0; c < mesh.nCells; c++) {
    const o = BODY_FORCE_STRIDE * c;
    if ((k[o + 7] as number) === BODY_FORCE_KIND.none) continue;
    const p = NP * c;
    const r = mesh.cellR[c] as number;
    const rho = rhoInf + (prim[p] as number);
    cellForce(
      k,
      o,
      prim[p + 1] as number,
      prim[p + 2] as number,
      (prim[p + 3] as number) / r,
      r,
      prim[p + 7] as number,
      f,
    );
    const q = NU * c;
    const torque = rho * r * (f[2] as number);
    rate[q + 1] = (rate[q + 1] as number) + rho * (f[0] as number);
    rate[q + 2] = (rate[q + 2] as number) + rho * (f[1] as number);
    rate[q + 3] = (rate[q + 3] as number) + torque;
    const omega = k[o] as number;
    if (omega !== 0) rate[q + 4] = (rate[q + 4] as number) + omega * torque;
    damping[q + 1] = (damping[q + 1] as number) + (f[3] as number);
    damping[q + 2] = (damping[q + 2] as number) + (f[4] as number);
    damping[q + 3] = (damping[q + 3] as number) + (f[5] as number);
  }
}

/** The oracle's source model of the body forces with coefficients k (BODY_FORCE_STRIDE per cell). */
export function bodyForceSource(k: ArrayLike<number>): SourceModel {
  return (ctx, out) => addBodyForceRates(k, ctx.mesh, ctx.ref.rho, ctx.prim, out.rate, out.damping);
}

/**
 * 2 C_f per row, C_f = 0.0592 Re_c^-0.2 (the turbulent flat plate) at the row's design chord
 * Reynolds number from the blade mean line's inlet (static state from its Mach number at gamma
 * 1.4, Sutherland's viscosity): a stated estimate, trimmed by the loss knobs.
 */
export function rowFriction(def: EngineDefinition): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const m of ENGINE_MEANLINE) {
    const row = def.bladeRows.find((b) => b.id === m.rowId);
    if (row === undefined) continue;
    const i = m.inlet;
    const f = 1 + 0.2 * i.mach * i.mach;
    const t = i.ttK / f;
    const rho = i.ptPa / f ** 3.5 / (287.05 * t);
    const wRel = Math.hypot(i.cxMPerS, i.rcTheta / i.rMid - m.omegaRadPerS * i.rMid);
    const re = (rho * wRel * row.chord.mid) / sutherlandViscosity(t);
    out.set(row.id, 2 * 0.0592 * re ** -0.2);
  }
  return out;
}

/** The splitter radius for the fan's knob split: the first booster row's leading-edge tip. */
export function splitterRadius(def: EngineDefinition): number {
  const r = def.bladeRows.find((b) => b.component === 'booster');
  if (r === undefined) throw new Error('splitterRadius: no booster row');
  return r.leadingEdge.tip.r;
}

/**
 * The per-cell body-force coefficients (BODY_FORCE_STRIDE per cell, kind none outside the rows) at
 * an operating point and knob setting, with the cells' blockage b (the field the solver uses:
 * couplingBlockage) in the loading's s |cos kappa| b.
 */
export function bodyForceCoefficients(
  mesh: SolverMesh,
  rows: readonly MeshRow[],
  def: EngineDefinition,
  op: RowOperatingPoint,
  knobs: Knobs,
  blockage?: ArrayLike<number>,
): Float64Array {
  const k = new Float64Array(BODY_FORCE_STRIDE * mesh.nCells);
  const friction = rowFriction(def);
  const rSplit = splitterRadius(def);
  for (const mr of rows) {
    const row = mr.row;
    const turbine = row.component === 'hpt' || row.component === 'lpt';
    const n = row.spool === 'lp' ? op.n1RadPerS : row.spool === 'hp' ? op.n2RadPerS : 0;
    const omega = row.spool === 'none' ? 0 : def.rotation[row.spool] * n;
    const shift = vsvCamberShift(def, row, op.vsvClosureRad);
    const cf2 = friction.get(row.id) ?? NaN;
    mr.cells.forEach((c, j) => {
      const kappa = (mr.kappa[j] as number) + shift;
      const b = blockage === undefined ? (mr.blockage[j] as number) : (blockage[c] as number);
      const cos = Math.max(Math.abs(Math.cos(kappa)), MIN_COS_KAMBER);
      const g = 1 / ((mr.pitch[j] as number) * cos * b);
      const kn = rowKnobs(row, mesh.cellR[c] as number, rSplit);
      const turn = kn.turning === null ? 1 : knobs[kn.turning];
      const o = BODY_FORCE_STRIDE * c;
      k[o] = omega;
      k[o + 1] = kappa;
      k[o + 2] = turbine
        ? (turn * FOLLOW_CAMBER_RATE) / (mr.pitch[j] as number)
        : turn * Math.PI * g;
      k[o + 3] = knobs[kn.loss] * 0.5 * g;
      k[o + 4] = STALL_INCIDENCE_RAD;
      k[o + 5] = cf2;
      k[o + 6] = REVERSED_FLOW_LOSS;
      k[o + 7] = turbine ? BODY_FORCE_KIND.turbine : BODY_FORCE_KIND.compressor;
    });
  }
  return k;
}
