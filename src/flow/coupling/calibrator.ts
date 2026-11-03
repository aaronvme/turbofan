// The calibration (the plan's "~16 grouped knobs get a log-space integral trim around a baked
// feedforward table K(N1c, N2c)"; PHYSICS.md 3.3 CP3-CP5, L12). Pure: the app and the tests feed
// it station reductions and cycle targets, and it returns the knobs and the coupling state.
//
// Each knob trims one target of its own (a diagonal pairing): a row family's turning sets its
// stream's total-temperature rise (Euler work), its loss the total pressure at that work, a stator
// family the exit swirl (0 in the cycle), a turbine nozzle's or exhaust nozzle's blockage the flow
// or the back pressure. The sign is the target's response to the knob, so the trim
// ln K_i += -g s_i e_i moves each knob against its own error (e in log space for W, Pt and Tt, in
// rad for the swirl).
import type { FlowTargets, StationReduction } from '../../contracts/flow';
import { SOLVER_REDUCTION_STATIONS, type SolverReductionStationId } from '../../contracts/stations';
import { THRESHOLDS } from '../../contracts/thresholds';
import { KNOB_IDS, UNIT_KNOBS, type KnobId, type Knobs } from './knobs';

export type PairedQuantity = 'W' | 'Pt' | 'Tt' | 'swirl';

export interface Pairing {
  readonly knob: KnobId;
  readonly station: SolverReductionStationId;
  readonly kind: PairedQuantity;
  /** The sign of d(target) / d(ln K). */
  readonly sign: 1 | -1;
}

/** One pairing per knob, in KNOB_IDS order. */
export const PAIRINGS: readonly Pairing[] = [
  { knob: 'fanHub', station: '25', kind: 'W', sign: 1 },
  { knob: 'fanTip', station: '13', kind: 'Tt', sign: 1 },
  { knob: 'fanLoss', station: '13', kind: 'Pt', sign: -1 },
  // the fan's swirl is toward -theta (rotation -1): more OGV turning lifts it toward 0
  { knob: 'fanOgv', station: '13', kind: 'swirl', sign: 1 },
  { knob: 'boosterTurning', station: '25', kind: 'Tt', sign: 1 },
  { knob: 'boosterLoss', station: '25', kind: 'Pt', sign: -1 },
  { knob: 'hpcRotor', station: '3', kind: 'Tt', sign: 1 },
  { knob: 'hpcStator', station: '3', kind: 'swirl', sign: 1 },
  { knob: 'hpcLoss', station: '3', kind: 'Pt', sign: -1 },
  // a larger nozzle-blockage deficit is a smaller throat: a higher pressure ahead of it
  { knob: 'hptNozzle', station: '4', kind: 'Pt', sign: 1 },
  // more turbine turning takes more work out: a lower total temperature behind it
  { knob: 'hptRotor', station: '45', kind: 'Tt', sign: -1 },
  { knob: 'lptNozzle', station: '45', kind: 'Pt', sign: 1 },
  { knob: 'lptRotor', station: '5', kind: 'Tt', sign: -1 },
  { knob: 'turbineLoss', station: '5', kind: 'Pt', sign: -1 },
  // the nozzle knobs are the throat's open fraction: more area, more flow
  { knob: 'coreNozzle', station: '8', kind: 'W', sign: 1 },
  { knob: 'bypassNozzle', station: '13', kind: 'W', sign: 1 },
];

/** The trim state: ln of each knob over its feedforward. */
export interface TrimState {
  readonly logTrim: Readonly<Record<KnobId, number>>;
}

export const ZERO_TRIM: TrimState = {
  logTrim: Object.fromEntries(KNOB_IDS.map((k) => [k, 0])) as Record<KnobId, number>,
};

/**
 * The integral gain per reduction (a reduction every ~10 iterations). 0.5 converges a coupled
 * static plant with a 0.8 diagonal and a 0.25 neighbour coupling in about 16 reductions without
 * overshoot (the unit test). It is the starting value for the field's spike (CP4), whose lagged
 * response may need a lower one; it is a tuning, not a threshold.
 */
export const TRIM_GAIN = 0.5;
/** The trim stays within a factor 4 of the feedforward either way (a knob never runs away). */
export const TRIM_LIMIT = Math.log(4);

/** A pairing's error: ln(measured / target) for W, Pt and Tt; the swirl angle (rad) against 0. */
export function pairingError(p: Pairing, r: StationReduction, t: FlowTargets): number {
  const m = r.stations[p.station];
  const g = t.stations[p.station];
  switch (p.kind) {
    case 'W':
      return Math.log(m.massFlowKgPerS / g.wKgPerS);
    case 'Pt':
      return Math.log(m.ptMassAvgPa / g.ptPa);
    case 'Tt':
      return Math.log(m.ttMassAvgK / g.ttK);
    case 'swirl':
      return m.swirlAngleMassAvgRad;
  }
}

/** One trim step from the pairings' errors (PAIRINGS order), clamped to +-TRIM_LIMIT. */
export function trimFromErrors(
  s: TrimState,
  errors: readonly number[],
  gain = TRIM_GAIN,
): TrimState {
  const logTrim = { ...s.logTrim };
  PAIRINGS.forEach((p, i) => {
    const v = logTrim[p.knob] - gain * p.sign * (errors[i] as number);
    logTrim[p.knob] = Math.min(TRIM_LIMIT, Math.max(-TRIM_LIMIT, v));
  });
  return { logTrim };
}

/** One trim step from a station reduction against the cycle's targets. */
export function trimStep(
  s: TrimState,
  r: StationReduction,
  t: FlowTargets,
  gain = TRIM_GAIN,
): TrimState {
  return trimFromErrors(
    s,
    PAIRINGS.map((p) => pairingError(p, r, t)),
    gain,
  );
}

/** The knobs in force: the feedforward times exp(trim). */
export function knobsFrom(ff: Knobs, s: TrimState): Knobs {
  return Object.fromEntries(KNOB_IDS.map((k) => [k, ff[k] * Math.exp(s.logTrim[k])])) as Record<
    KnobId,
    number
  >;
}

/** A feedforward point on the working line: corrected speeds (percent) and its knobs. */
export interface FeedforwardPoint {
  readonly n1c: number;
  readonly n2c: number;
  readonly knobs: Knobs;
}

/**
 * The feedforward K at (N1c, N2c): log-linear between the working-line points by N2c (the table
 * is the working line, so N2c orders it), held beyond its ends; unit knobs without a table. N1c is
 * carried for the full two-dimensional table of w3/plume-bake's bake.
 */
export function feedforward(table: readonly FeedforwardPoint[], n1c: number, n2c: number): Knobs {
  void n1c;
  if (table.length === 0) return UNIT_KNOBS;
  const pts = [...table].sort((a, b) => a.n2c - b.n2c);
  const lo = pts[0] as FeedforwardPoint;
  const hi = pts[pts.length - 1] as FeedforwardPoint;
  if (n2c <= lo.n2c) return lo.knobs;
  if (n2c >= hi.n2c) return hi.knobs;
  let k = 0;
  while ((pts[k + 1] as FeedforwardPoint).n2c < n2c) k++;
  const a = pts[k] as FeedforwardPoint;
  const b = pts[k + 1] as FeedforwardPoint;
  const f = (n2c - a.n2c) / (b.n2c - a.n2c);
  return Object.fromEntries(
    KNOB_IDS.map((id) => [
      id,
      Math.exp((1 - f) * Math.log(a.knobs[id]) + f * Math.log(b.knobs[id])),
    ]),
  ) as Record<KnobId, number>;
}

export interface L12Check {
  readonly holds: boolean;
  /** max over the reduction stations of |W / W_cycle - 1|. */
  readonly maxStationFlowError: number;
  /** |Tt4 - Tt4_cycle|, K. */
  readonly t4ErrorK: number;
  /** |F / F_cycle - 1| of the gross thrust. */
  readonly thrustError: number;
}

/** L12's tolerances at the current point (PHYSICS.md 3.3): station flows, T4 and the thrust. */
export function l12Check(r: StationReduction, t: FlowTargets, grossThrustN: number): L12Check {
  const v = THRESHOLDS.L12.values;
  let flow = 0;
  for (const id of SOLVER_REDUCTION_STATIONS) {
    flow = Math.max(flow, Math.abs(r.stations[id].massFlowKgPerS / t.stations[id].wKgPerS - 1));
  }
  const t4 = Math.abs(r.stations['4'].ttMassAvgK - t.stations['4'].ttK);
  const thrust = Math.abs(r.grossThrustN / grossThrustN - 1);
  return {
    holds:
      flow <= v.maxStationFlowRelativeError.value &&
      t4 <= v.t4ErrorK.value &&
      thrust <= v.maxThrustRelativeError.value,
    maxStationFlowError: flow,
    t4ErrorK: t4,
    thrustError: thrust,
  };
}

/** CP5: the field reads "coupled" only while L12 holds at the current point, else "calibrating". */
export function couplingStateOf(c: L12Check | null): 'calibrating' | 'coupled' {
  return c?.holds === true ? 'coupled' : 'calibrating';
}

/**
 * CP4's steadiness (D4-45's form): over [from, from + window] iterations every error (absolute,
 * per sample) stays within its tolerance, with a spread (max - min) of at most a tenth of it; the
 * samples must cover the window.
 */
export function steadyWithin(
  history: readonly { readonly iteration: number; readonly errors: readonly number[] }[],
  tolerances: readonly number[],
  from: number,
  window: number,
): boolean {
  const inside = history.filter((h) => h.iteration >= from && h.iteration <= from + window);
  const last = inside[inside.length - 1];
  if (last === undefined || last.iteration < from + window) return false;
  return tolerances.every((tol, i) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of inside) {
      const e = h.errors[i] as number;
      if (!(e <= tol)) return false;
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    return hi - lo <= 0.1 * tol;
  });
}
