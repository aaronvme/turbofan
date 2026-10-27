// The FADEC's control laws, pure (factored out of model.ts for fast tests, D3-13). model.ts keeps
// the state (the Wf/P3 integrator, the recovery clock, the EGT timer) and calls these.
//
// - One Wf/P3 ("ratio unit") integrator driven by the selected loop: the higher of the N1-target
//   and N2 idle-floor demands, then the lowest of the N1, N2 and EGT limiters, each with rate
//   feedback for damping; clamped between the decel schedule and the acceleration limit (the
//   accel schedule, or during a surge recovery its hold, ramp and biased schedule).
// - The EGT limit in force: the TCDS transitory limit for its allowance, then the redline.

import type { FadecLimiter } from '../contracts/cycle';

/** FADEC gains: integrator rate per unit fractional error (1/s), rate-feedback time (s). */
export const K_LOOP = 2;
export const TD = 0.7;
/**
 * Rate feedback of the overspeed limiters, s (short, so they act only near the limit). 0.5 (0.3
 * before W1C-N5) holds a slam overshoot to about 0.1 point, which the 0.5-point N1 margin needs.
 */
export const TD_LIMIT = 0.5;
/**
 * Rate feedback of the EGT limiter, s: the lead that stops the fuel ramp before the 960 C
 * transient limit instead of after it (the EGT rises at several hundred K/s in a slam accel).
 * EGT follows the fuel flow almost algebraically, so the raw derivative would feed the loop's own
 * output back and chatter; it is filtered first-order with TF_EGT = TD_EGT / 3, the usual
 * derivative filter (K. J. Astrom and T. Hagglund, PID Controllers, 2nd ed., ISA 1995, 3.3:
 * TD / N with N = 2-20).
 */
export const TD_EGT = 0.3;
export const TF_EGT = TD_EGT / 3;
/**
 * EGT error that drives the Wf/P3 rate by K_LOOP x K_LIMIT_FACTOR per second, K. 150 K holds a
 * slam from ground idle under the 960 C transitory limit (33.73(a)); 100 K makes an EGT-limited
 * steady point chatter between the EGT and N1 loops.
 */
export const EGT_ERROR_SCALE_K = 150;
/**
 * Accel/decel schedules as multiples of the steady Wf/P3 at the same corrected N2. 1.8 (2.2
 * before W1C-I1) keeps a ground-idle slam out of surge (min HPC margin 0.034) now that the idle
 * working line carries the part-power losses: the HP mechanical loss, the clearance penalty and
 * the VBV dump raise the low-speed HPC operating line, so the steady Wf/P3 sits closer to surge.
 */
export const ACCEL_FACTOR = 1.8;
/** The accel schedule opens up by this much more between 68 and 80 % corrected N2. */
export const ACCEL_FACTOR_HIGH = 0.3;
export const DECEL_FACTOR = 0.6;
/**
 * Overspeed limiter targets sit this many points under the TCDS N1 / N2 limits. N1: 0.5: the
 * 30 C flat-rating corner (rated thrust at 103.5 % N1) is at the limiter target, so the transient
 * model makes rated thrust there (W1C-N5); a corner slam overshoots the target by 0.1 point with
 * TD_LIMIT 0.5 (0.5 with 0.3, which took N1 to 104.02 %).
 */
export const N1_LIMIT_MARGIN_PERCENT = 0.5;
export const N2_LIMIT_MARGIN_PERCENT = 1;
/** The EGT limiter aims this far under the active displayed-EGT limit, K. */
export const EGT_LIMIT_MARGIN_K = 5;
/** Limiter loops run at this multiple of K_LOOP, so they bite hard near their limits only. */
export const K_LIMIT_FACTOR = 4;
/**
 * Surge recovery (D3-17): after a detection the fuel demand is held on the decel schedule for
 * SURGE_HOLD_S, the confirmation delay of [RR06] (about 0.5 s), then the acceleration limit ramps
 * back from the decel to the accel schedule over SURGE_RESTORE_S, the "timed sequence" of
 * [UTC77]. The ramp lets the HP spool climb out of the low speeds where a worn compressor's
 * margin is smallest on a reduced fuel ratio, instead of going straight back to the schedule that
 * surged it.
 */
export const SURGE_HOLD_S = 0.5;
export const SURGE_RESTORE_S = 1;
/**
 * After a surge the re-acceleration runs on a biased schedule: the steady line plus
 * SURGE_ACCEL_RESET of the accel schedule's excess over it (a second surge multiplies the bias
 * again), until the acceleration is over and another loop takes the fuel. The surge line has not
 * moved, so the full schedule would surge again at the same speed: without the bias the C12 slam
 * cycles surge, cut-back and re-surge at 62-63 % N2, the hang a nonrecoverable stall is ([GE91]).
 * 0.8 keeps the C12 slam to one surge and inside its 10 s to 95 % thrust (0.75 needs 9.3 s, 0.85
 * re-surges nowhere but leaves less margin at the surge speed); control tuning, not a threshold.
 */
export const SURGE_ACCEL_RESET = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The lever schedule: N1 target linear in the lever from ground idle to takeoff (0 at the stop). */
export function leverToN1(lever: number, idleN1: number, takeoffN1: number): number {
  return lever <= 0 ? 0 : idleN1 + lever * (takeoffN1 - idleN1);
}

/** A loop's demanded Wf/P3 rate: K_LOOP times the error less the rate feedback, over scale. */
export function loopRate(
  target: number,
  value: number,
  rate: number,
  scale = 100,
  td = TD,
): number {
  return K_LOOP * ((target - value) / scale - (td * rate) / scale);
}

/** The accel schedule's multiple of the steady Wf/P3 at a corrected N2 (%). */
export function accelFactor(n2c: number): number {
  return ACCEL_FACTOR + ACCEL_FACTOR_HIGH * clamp((n2c - 68) / 12, 0, 1);
}

/**
 * The selector: the higher of the N1-target and idle-floor demands (a tie to the N1 loop), then
 * any limiter whose demand, K_LIMIT_FACTOR times its loop rate, is strictly lower.
 */
export function selectLoop(
  rN1: number,
  rIdle: number,
  limiters: readonly (readonly [FadecLimiter, number])[],
): { readonly rate: number; readonly which: FadecLimiter } {
  let rate = Math.max(rN1, rIdle);
  let which: FadecLimiter = rN1 >= rIdle ? 'n1Target' : 'idleFloor';
  for (const [name, rLimit] of limiters) {
    const r = K_LIMIT_FACTOR * rLimit;
    if (r < rate) {
      rate = r;
      which = name;
    }
  }
  return { rate, which };
}

/** Wf/P3 held between the decel schedule and the acceleration limit (the limit wins a conflict). */
export function clampToSchedules(
  ru: number,
  accLimit: number,
  ruDec: number,
  which: FadecLimiter,
): { readonly ru: number; readonly which: FadecLimiter } {
  if (ru > accLimit) return { ru: accLimit, which: 'accelSchedule' };
  if (ru < ruDec) return { ru: ruDec, which: 'decelSchedule' };
  return { ru, which };
}

/**
 * The acceleration limit, Wf/P3: the accel schedule, or after a surge the biased one (the steady
 * line plus `cap` of the schedule's excess); during a recovery (sinceDetectionS not null) the hold
 * on the decel schedule, then the timed ramp. sequenceOver: the ramp has ended.
 */
export function accelLimit(
  ruAcc: number,
  ruDec: number,
  ruSs: number,
  cap: number | null,
  sinceDetectionS: number | null,
): { readonly limit: number; readonly sequenceOver: boolean } {
  const capped = cap === null ? ruAcc : ruSs + cap * (ruAcc - ruSs);
  if (sinceDetectionS === null) return { limit: capped, sequenceOver: false };
  const el = sinceDetectionS;
  if (el >= SURGE_HOLD_S + SURGE_RESTORE_S) return { limit: capped, sequenceOver: true };
  if (el < SURGE_HOLD_S) return { limit: ruDec, sequenceOver: false };
  return {
    limit: ruDec + ((capped - ruDec) * (el - SURGE_HOLD_S)) / SURGE_RESTORE_S,
    sequenceOver: false,
  };
}

/**
 * The bias cap after a detection: detections during the hold are the same surge still cycling;
 * the first one, or one after the hold (on the ramp or the biased schedule), is a new surge, and
 * the cap drops by SURGE_ACCEL_RESET again.
 */
export function surgeCapOnDetection(
  cap: number | null,
  sinceLastDetectionS: number | null,
): number | null {
  return sinceLastDetectionS === null || sinceLastDetectionS >= SURGE_HOLD_S
    ? (cap ?? 1) * SURGE_ACCEL_RESET
    : cap;
}

export interface EgtLimits {
  readonly egtTransientK: number;
  readonly egtTakeoffRedlineK: number;
  readonly egtMaxContinuousK: number;
  readonly egtTransientDurationS: number;
}

/** The displayed-EGT limit in force: transitory while the allowance lasts, else the redline. */
export function egtLimitK(lim: EgtLimits, aboveRedlineS: number): number {
  return aboveRedlineS < lim.egtTransientDurationS
    ? lim.egtTransientK
    : Math.min(lim.egtTransientK, lim.egtTakeoffRedlineK);
}

/**
 * Time the displayed EGT has spent above the takeoff redline, s. TCDS E.004 VI note 4 allows the
 * transitory limit for its duration; the allowance renews once EGT is back under the
 * maximum-continuous limit, and holds in between.
 */
export function egtAboveRedlineS(prevS: number, egtK: number, lim: EgtLimits, dtS: number): number {
  if (egtK > lim.egtTakeoffRedlineK) return prevS + dtS;
  if (egtK <= lim.egtMaxContinuousK) return 0;
  return prevS;
}
