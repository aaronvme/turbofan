// The FADEC's pure control laws (TDD stub; model.ts still holds the real ones).
/* eslint-disable @typescript-eslint/no-unused-vars -- TDD stub, replaced by the laws moved from model.ts */
import type { FadecLimiter } from '../contracts/cycle';

export const K_LOOP = 2;
export const TD = 0.7;
export const K_LIMIT_FACTOR = 4;
export const ACCEL_FACTOR = 1.8;
export const ACCEL_FACTOR_HIGH = 0.3;
export const SURGE_HOLD_S = 0.5;
export const SURGE_RESTORE_S = 1;
export const SURGE_ACCEL_RESET = 0.8;

const stub = (): never => {
  throw new Error('TDD stub');
};

export function leverToN1(_lever: number, _idleN1: number, _takeoffN1: number): number {
  return stub();
}
export function loopRate(
  _target: number,
  _value: number,
  _rate: number,
  _scale = 100,
  _td = TD,
): number {
  return stub();
}
export function accelFactor(_n2c: number): number {
  return stub();
}
export function selectLoop(
  _rN1: number,
  _rIdle: number,
  _limiters: readonly (readonly [FadecLimiter, number])[],
): { readonly rate: number; readonly which: FadecLimiter } {
  return stub();
}
export function clampToSchedules(
  _ru: number,
  _accLimit: number,
  _ruDec: number,
  _which: FadecLimiter,
): { readonly ru: number; readonly which: FadecLimiter } {
  return stub();
}
export function accelLimit(
  _ruAcc: number,
  _ruDec: number,
  _ruSs: number,
  _cap: number | null,
  _sinceDetectionS: number | null,
): { readonly limit: number; readonly sequenceOver: boolean } {
  return stub();
}
export function surgeCapOnDetection(
  _cap: number | null,
  _sinceLastDetectionS: number | null,
): number | null {
  return stub();
}
export interface EgtLimits {
  readonly egtTransientK: number;
  readonly egtTakeoffRedlineK: number;
  readonly egtMaxContinuousK: number;
  readonly egtTransientDurationS: number;
}
export function egtLimitK(_lim: EgtLimits, _aboveRedlineS: number): number {
  return stub();
}
export function egtAboveRedlineS(
  _prevS: number,
  _egtK: number,
  _lim: EgtLimits,
  _dtS: number,
): number {
  return stub();
}
