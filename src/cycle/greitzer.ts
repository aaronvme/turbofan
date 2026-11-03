// Greitzer lumped-parameter compression system (E. M. Greitzer, "Surge and Rotating Stall in
// Axial Flow Compressors, Part I", J. Eng. Power 98, 1976): a compressor duct (length L_c, area
// A_c) feeding a plenum (volume V_p) discharging through a throttle. Non-dimensional time
// xi = omega_H t with the Helmholtz frequency omega_H = a sqrt(A_c / (V_p L_c)):
//   dPhi/dxi = B (Psi_c(Phi) - Psi),   dPsi/dxi = (Phi - Phi_T(Psi)) / B,   B = U / (2 omega_H L_c).
// Compressor characteristic: the Moore-Greitzer cubic (Moore & Greitzer, J. Eng. Gas Turbines
// Power 108, 1986), Psi_c = psi0 + H (1 + 1.5 (Phi/W - 1) - 0.5 (Phi/W - 1)^3), extended to reverse
// flow by the same cubic. Throttle: Phi_T = gammaT sqrt(Psi) (Psi > 0), -gammaT sqrt(-Psi) else.
// The equilibrium on the characteristic's rising (positive-slope) branch loses stability when
// B > B_crit = sqrt(Phi_T' / Psi_c') (trace of the Jacobian through zero, Greitzer 1976 eq. 18).

import { at } from './at';

export interface GreitzerParams {
  readonly b: number;
  readonly psi0: number;
  /** Semi-height H and semi-width W of the cubic. */
  readonly h: number;
  readonly w: number;
  readonly gammaT: number;
}

export interface GreitzerState {
  readonly phi: number;
  readonly psi: number;
}

export function characteristic(p: GreitzerParams, phi: number): number {
  const x = phi / p.w - 1;
  return p.psi0 + p.h * (1 + 1.5 * x - 0.5 * x * x * x);
}

function characteristicSlope(p: GreitzerParams, phi: number): number {
  const x = phi / p.w - 1;
  return (p.h * (1.5 - 1.5 * x * x)) / p.w;
}

export function throttleFlow(p: GreitzerParams, psi: number): number {
  return psi >= 0 ? p.gammaT * Math.sqrt(psi) : -p.gammaT * Math.sqrt(-psi);
}

/** The equilibrium where the throttle line crosses the characteristic (bisection on Phi). */
export function equilibrium(p: GreitzerParams): GreitzerState {
  // g = Phi_T(Psi_c(Phi)) - Phi is positive at Phi = 0 (Psi_c(0) = psi0 > 0). A throttled
  // system crosses on the rising branch, below the peak at 2W; a wide-open throttle crosses on
  // the falling branch beyond it, where the cubic heads to Psi < 0 and so g < 0 eventually.
  const g = (phi: number) => throttleFlow(p, characteristic(p, phi)) - phi;
  let lo = 0;
  let hi = 2 * p.w;
  while (g(hi) > 0) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) > 0) lo = mid;
    else hi = mid;
  }
  const phi = 0.5 * (lo + hi);
  return { phi, psi: characteristic(p, phi) };
}

/** Critical B at the equilibrium (Infinity on the stable, falling branch). */
export function criticalB(p: GreitzerParams): number {
  const e = equilibrium(p);
  const slope = characteristicSlope(p, e.phi);
  if (slope <= 0) return Infinity;
  const dPhiT = p.gammaT / (2 * Math.sqrt(e.psi));
  return Math.sqrt(dPhiT / slope);
}

function rates(p: GreitzerParams, s: GreitzerState): [number, number] {
  return [p.b * (characteristic(p, s.phi) - s.psi), (s.phi - throttleFlow(p, s.psi)) / p.b];
}

/** One classical RK4 step of dxi (non-dimensional time). */
export function greitzerStep(p: GreitzerParams, s: GreitzerState, dxi: number): GreitzerState {
  const add = (a: GreitzerState, k: [number, number], f: number): GreitzerState => ({
    phi: a.phi + f * k[0],
    psi: a.psi + f * k[1],
  });
  const k1 = rates(p, s);
  const k2 = rates(p, add(s, k1, dxi / 2));
  const k3 = rates(p, add(s, k2, dxi / 2));
  const k4 = rates(p, add(s, k3, dxi));
  return {
    phi: s.phi + (dxi / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    psi: s.psi + (dxi / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
  };
}

export interface SurgeRun {
  readonly minPhi: number;
  readonly maxPhi: number;
  /** Mean period of the last cycles (upward zero crossings of Phi - Phi_eq), xi units; null if none. */
  readonly periodXi: number | null;
  readonly final: GreitzerState;
}

/** Integrates from a perturbed equilibrium; reports the late-time amplitude and period. */
export function simulateSurge(
  p: GreitzerParams,
  perturbation: number,
  durationXi: number,
  dxi = 0.01,
): SurgeRun {
  const eq = equilibrium(p);
  let s: GreitzerState = { phi: eq.phi * (1 - perturbation), psi: eq.psi };
  const n = Math.round(durationXi / dxi);
  let minPhi = Infinity;
  let maxPhi = -Infinity;
  const crossings: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = greitzerStep(p, s, dxi);
    if (i > n / 2) {
      minPhi = Math.min(minPhi, next.phi);
      maxPhi = Math.max(maxPhi, next.phi);
      if (s.phi < eq.phi && next.phi >= eq.phi) crossings.push((i + 1) * dxi);
    }
    s = next;
  }
  const nc = crossings.length;
  const periodXi = nc >= 2 ? (at(crossings, nc - 1) - at(crossings, 0)) / (nc - 1) : null;
  return { minPhi, maxPhi, periodXi, final: s };
}

/**
 * A surge cycle's flow breakdown (A5, D5-4: the engine sound bangs once per modelled cycle): Phi
 * falls below Phi_eq - SURGE_BREAKDOWN_DROP W, a quarter of the cubic's peak flow 2W, and the
 * counter re-arms once Phi is back at Phi_eq or above. The hysteresis keeps a small oscillation
 * about the equilibrium (a decaying transient) from counting; a deep surge's flow reversal and a
 * classic surge's breakdown count once per cycle.
 */
export const SURGE_BREAKDOWN_DROP = 0.5;

export interface BreakdownCounter {
  readonly armed: boolean;
  readonly cycles: number;
}

export function countBreakdown(
  c: BreakdownCounter,
  p: GreitzerParams,
  eqPhi: number,
  phi: number,
): BreakdownCounter {
  if (c.armed && phi < eqPhi - SURGE_BREAKDOWN_DROP * p.w)
    return { armed: false, cycles: c.cycles + 1 };
  if (!c.armed && phi >= eqPhi) return { armed: true, cycles: c.cycles };
  return c;
}

/** Helmholtz resonator frequency of the compression system, rad/s. */
export function helmholtzFrequency(
  soundSpeed: number,
  ductArea: number,
  plenumVolume: number,
  ductLength: number,
): number {
  return soundSpeed * Math.sqrt(ductArea / (plenumVolume * ductLength));
}
