// Blade-row design helper: synthesizes metal angles from mean-line velocity triangles,
// because the real blade geometry is proprietary.
//
// - Free vortex: r c_theta and c_x are uniform across the span at each edge, so the flow
//   angle at radius r follows from c_theta = (r c_theta) / r (Dixon & Hall, Fluid Mechanics
//   and Thermodynamics of Turbomachinery, 7th ed., sec. 6.6).
// - Rotors are designed in their own frame: w_theta = c_theta - omega r, with omega the signed
//   shaft speed about +x. Angles are geometric (from +x, positive toward +theta), so a rotor
//   turning in -theta gets the mirror image of one turning in +theta.
// - Zero incidence. Compressor rows get Carter's rule for deviation, delta = m theta / sigma^n
//   with m = 0.23 (2a/c)^2 + stagger/500 deg (circular arc, a/c = 0.5), n = 1/2 for
//   decelerating rows and n = 1 for accelerating ones such as inlet guide vanes (Dixon & Hall
//   eq. 3.54; Carter, ARC R&M 2804, 1950). Turbine rows follow the camber line (delta = 0),
//   as the solver's turbine body force does.
// - Stagger is the mean of the metal angles; the true chord is the meridional length over
//   cos(stagger); the count comes from a target mid-span solidity unless it is published.

import { R_AIR } from '../contracts/ambient';
import type { EdgeLine, SpanValues } from '../contracts/engine';
import type { GasSection } from './designPoint';

const SPANS = ['hub', 'mid', 'tip'] as const;
type Span = (typeof SPANS)[number];

// ---------------------------------------------------------------------------------------
// Continuity

export interface AxialVelocityInput {
  readonly wKgPerS: number;
  readonly ttK: number;
  readonly ptPa: number;
  readonly areaM2: number;
  /** Absolute swirl velocity at the plane (it lowers the static density), m/s. */
  readonly cThetaMPerS: number;
  readonly gas: GasSection;
}

export interface AxialVelocityResult {
  readonly cxMPerS: number;
  /** Total (absolute) Mach number. */
  readonly mach: number;
  readonly axialMach: number;
  readonly staticTK: number;
  /** True when the flow exceeds what the plane can pass; c_x is then the axial sonic speed. */
  readonly choked: boolean;
}

/**
 * Axial velocity that carries wKgPerS through areaM2 at the given totals and swirl, on the
 * subsonic branch. The mass flux rho c_x peaks where the axial Mach number is 1, so the
 * root is bracketed in [0, c_x*] and found by bisection.
 */
export function axialVelocity(input: AxialVelocityInput): AxialVelocityResult {
  const { wKgPerS, ttK, ptPa, areaM2, cThetaMPerS, gas } = input;
  const { cpJPerKgK: cp, gamma: g } = gas;
  const staticT = (cx: number) => ttK - (cx * cx + cThetaMPerS * cThetaMPerS) / (2 * cp);
  const sound = (t: number) => Math.sqrt(g * R_AIR * t);
  const result = (cx: number, choked: boolean): AxialVelocityResult => {
    const t = staticT(cx);
    const a = sound(t);
    return {
      cxMPerS: cx,
      mach: Math.hypot(cx, cThetaMPerS) / a,
      axialMach: cx / a,
      staticTK: t,
      choked,
    };
  };
  const swirlHead = ttK - (cThetaMPerS * cThetaMPerS) / (2 * cp);
  if (!(swirlHead > 0)) throw new Error('axialVelocity: the swirl exceeds the total enthalpy');
  if (wKgPerS <= 0) return result(0, false);
  const flux = (cx: number) => {
    const t = staticT(cx);
    const p = ptPa * (t / ttK) ** (g / (g - 1));
    return (p / (R_AIR * t)) * cx;
  };
  // axial Mach 1: c_x^2 = gamma R T with T = Tt - (c_x^2 + c_theta^2) / (2 cp)
  const cxStar = Math.sqrt((g * R_AIR * swirlHead) / (1 + (g * R_AIR) / (2 * cp)));
  const target = wKgPerS / areaM2;
  if (target >= flux(cxStar)) return result(cxStar, true);
  let lo = 0;
  let hi = cxStar;
  for (let i = 0; i < 200 && hi - lo > 1e-12 * cxStar; i++) {
    const mid = 0.5 * (lo + hi);
    if (flux(mid) < target) lo = mid;
    else hi = mid;
  }
  return result(0.5 * (lo + hi), false);
}

// ---------------------------------------------------------------------------------------
// Row design

/** Carter's m for a circular-arc camber line (a/c = 0.5) at the given stagger (rad). */
export function carterM(staggerRad: number): number {
  return 0.23 + (Math.abs(staggerRad) * 180) / Math.PI / 500;
}

export interface RowEdges {
  readonly leadingEdge: EdgeLine;
  readonly trailingEdge: EdgeLine;
}

export interface RowPlaneFlow {
  /** r c_theta of the absolute flow, m^2/s (uniform across the span: free vortex). */
  readonly rcTheta: number;
  readonly cxMPerS: number;
}

export interface RowAerodynamics {
  /** Signed shaft speed about +x, rad/s; 0 for stationary rows. */
  readonly omegaRadPerS: number;
  readonly inlet: RowPlaneFlow;
  readonly exit: RowPlaneFlow;
  readonly deviation: 'carter' | 'none';
}

export interface RowShape {
  /** A published count; otherwise targetSolidity sets it. */
  readonly count?: number;
  /** Mid-span chord / pitch to aim for. */
  readonly targetSolidity?: number;
}

export interface DesignedRow {
  readonly count: number;
  /** Flow speeds up through the row (in its own frame): Carter's n = 1. */
  readonly accelerating: boolean;
  readonly chord: SpanValues;
  readonly solidity: SpanValues;
  readonly inletFlowAngle: SpanValues;
  readonly exitFlowAngle: SpanValues;
  readonly inletMetalAngle: SpanValues;
  readonly exitMetalAngle: SpanValues;
  readonly stagger: SpanValues;
  readonly deviation: SpanValues;
}

type Spans = Record<Span, number>;
const spans = (f: (s: Span) => number): Spans => ({ hub: f('hub'), mid: f('mid'), tip: f('tip') });

const MAX_ITERATIONS = 200;
const ANGLE_TOLERANCE = 1e-14;
const MAX_COUNT_PASSES = 10;

export function designRow(edges: RowEdges, aero: RowAerodynamics, shape: RowShape): DesignedRow {
  const { leadingEdge: le, trailingEdge: te } = edges;
  if (!(aero.inlet.cxMPerS > 0 && aero.exit.cxMPerS > 0))
    throw new Error('designRow: the axial velocity must be > 0 at both edges');
  const givenCount = shape.count;
  const targetSolidity = shape.targetSolidity;
  if (givenCount === undefined && targetSolidity === undefined)
    throw new Error('designRow: needs a count or a targetSolidity');

  const mid = (e: EdgeLine) => ({ x: (e.hub.x + e.tip.x) / 2, r: (e.hub.r + e.tip.r) / 2 });
  const point = (e: EdgeLine, s: Span) => (s === 'mid' ? mid(e) : e[s]);
  const rLe = spans((s) => point(le, s).r);
  const rTe = spans((s) => point(te, s).r);
  const rRow = spans((s) => (rLe[s] + rTe[s]) / 2);
  const meridional = spans((s) => {
    const a = point(le, s);
    const b = point(te, s);
    return Math.hypot(b.x - a.x, b.r - a.r);
  });

  const omega = aero.omegaRadPerS;
  const angle = (flow: RowPlaneFlow, r: number) =>
    Math.atan2(flow.rcTheta / r - omega * r, flow.cxMPerS);
  const a1 = spans((s) => angle(aero.inlet, rLe[s]));
  const a2 = spans((s) => angle(aero.exit, rTe[s]));
  const accelerating = aero.exit.cxMPerS / Math.cos(a2.mid) > aero.inlet.cxMPerS / Math.cos(a1.mid);
  const n = accelerating ? 1 : 0.5;

  // fixed point on stagger: stagger -> chord -> solidity -> Carter deviation -> metal angles
  let stagger = spans((s) => (a1[s] + a2[s]) / 2);
  const chordOf = (xi: Spans) => spans((s) => meridional[s] / Math.cos(xi[s]));
  const countFor = (chordMid: number, sigma: number) =>
    Math.max(1, Math.round((2 * Math.PI * rRow.mid * sigma) / chordMid));
  let count = givenCount ?? countFor(chordOf(stagger).mid, targetSolidity ?? 1);
  let deviation = spans(() => 0);
  // under-turned: the metal turns further than the flow, by delta, in the turning direction
  const metalExit = (s: Span, delta: number) => a2[s] - Math.sign(a1[s] - a2[s]) * delta;

  /** Carter: delta = m theta / sigma^n with theta = |turning| + delta, solved for delta. */
  const carterDeviation = (s: Span, chord: number): number => {
    const turning = Math.abs(a1[s] - a2[s]);
    if (aero.deviation === 'none' || turning === 0) return 0;
    const sigma = (chord * count) / (2 * Math.PI * rRow[s]);
    const k = carterM(stagger[s]) / sigma ** n;
    if (!(k < 1))
      throw new Error(`designRow: Carter's rule has no solution at sigma ${sigma.toFixed(3)}`);
    return (k * turning) / (1 - k);
  };

  const solve = (): void => {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const chord = chordOf(stagger);
      const d = spans((s) => carterDeviation(s, chord[s]));
      const next = spans((s) => (a1[s] + metalExit(s, d[s])) / 2);
      const change = Math.max(...SPANS.map((s) => Math.abs(next[s] - stagger[s])));
      stagger = next;
      deviation = d;
      if (change < ANGLE_TOLERANCE) return;
    }
  };

  solve();
  if (givenCount === undefined) {
    for (let pass = 0; pass < MAX_COUNT_PASSES; pass++) {
      const next = countFor(chordOf(stagger).mid, targetSolidity ?? 1);
      if (next === count) break;
      count = next;
      solve();
    }
  }

  const exitMetal = spans((s) => metalExit(s, deviation[s]));
  for (const s of SPANS) {
    if (!(Math.abs(exitMetal[s]) < Math.PI / 2))
      throw new Error(`designRow: exit metal angle at the ${s} is beyond 90 deg`);
  }
  const chord = chordOf(stagger);
  return {
    count,
    accelerating,
    chord,
    solidity: spans((s) => (chord[s] * count) / (2 * Math.PI * rRow[s])),
    inletFlowAngle: a1,
    exitFlowAngle: a2,
    inletMetalAngle: { ...a1 },
    exitMetalAngle: exitMetal,
    stagger,
    deviation,
  };
}
