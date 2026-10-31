// Display formatting at the UI boundary: the simulation is SI throughout (CLAUDE.md), the overlay
// converts here, with the cockpit's conventions (EGT in degrees C, fuel flow per hour) and the
// unit system the user picked. A missing or non-finite value shows as an en dash, never as 0.

import type { FadecLimiter } from '../contracts/cycle';
import type { UnitSystem } from '../contracts/ui';
import { kelvinToCelsius, LB_TO_KG, LBF_TO_N } from '../engine/units';

export const MISSING = '–';

export function fixed(v: number | null | undefined, digits: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  // -0.0 reads as a sign flicker on a tabular display
  const s = v.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

export interface Shown {
  readonly value: string;
  readonly unit: string;
}

const PSI_PA = 6894.757293168;
const LB_PER_H_KG_PER_S = 3600 / LB_TO_KG;

/** EGT as the cockpit shows it: degrees C (both unit systems; the CFM56-7B indication is C). */
export const egt = (k: number): Shown => ({ value: fixed(kelvinToCelsius(k), 0), unit: '°C' });

export const fuelFlow = (kgPerS: number, u: UnitSystem): Shown =>
  u === 'si'
    ? { value: fixed(kgPerS * 3600, 0), unit: 'kg/h' }
    : { value: fixed(kgPerS * LB_PER_H_KG_PER_S, 0), unit: 'lb/h' };

export const thrust = (n: number, u: UnitSystem): Shown =>
  u === 'si'
    ? { value: fixed(n / 1000, 1), unit: 'kN' }
    : { value: fixed(n / LBF_TO_N, 0), unit: 'lbf' };

export const pressure = (pa: number, u: UnitSystem): Shown =>
  u === 'si'
    ? { value: fixed(pa / 1000, pa < 1e6 ? 1 : 0), unit: 'kPa' }
    : { value: fixed(pa / PSI_PA, 1), unit: 'psia' };

export const temperature = (k: number, u: UnitSystem): Shown =>
  u === 'si' ? { value: fixed(k, 0), unit: 'K' } : { value: fixed(k * 1.8, 0), unit: '°R' };

export const massFlow = (kgPerS: number, u: UnitSystem): Shown =>
  u === 'si'
    ? { value: fixed(kgPerS, kgPerS < 100 ? 1 : 0), unit: 'kg/s' }
    : { value: fixed(kgPerS / LB_TO_KG, kgPerS < 45 ? 1 : 0), unit: 'lb/s' };

/** TSFC in g/(kN s) (SI) or lb/(lbf h); null (no positive thrust) shows as missing. */
export const tsfc = (kgPerNs: number | null, u: UnitSystem): Shown =>
  u === 'si'
    ? { value: fixed(kgPerNs === null ? null : kgPerNs * 1e6, 2), unit: 'g/(kN·s)' }
    : {
        value: fixed(kgPerNs === null ? null : (kgPerNs * 3600 * LBF_TO_N) / LB_TO_KG, 3),
        unit: 'lb/(lbf·h)',
      };

export const percent = (p: number, digits = 1): Shown => ({ value: fixed(p, digits), unit: '%' });

/** Milliseconds for the diagnostics: 2 decimals below 10 ms. */
export const ms = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? MISSING : fixed(v, v < 10 ? 2 : 1);

/** Sim time as m:ss.s. */
export function simTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return MISSING;
  const m = Math.floor(s / 60);
  const rest = s - 60 * m;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

const LIMITER_TEXT: Readonly<Record<FadecLimiter, string>> = {
  none: 'no limiter',
  n1Target: 'N1 target',
  accelSchedule: 'accel schedule',
  decelSchedule: 'decel schedule',
  idleFloor: 'idle floor',
  n1Max: 'N1 limit',
  n2Max: 'N2 limit',
  egtMax: 'EGT limit',
  startSchedule: 'start schedule',
};

/** The FADEC loop that sets the fuel flow, in words (W2A-N8: not its code identifier). */
export const limiterText = (l: FadecLimiter): string => LIMITER_TEXT[l];

/** A time scale as "x1", "x1/200" or "x4". */
export function timeScale(k: number): string {
  if (!(k > 0) || !Number.isFinite(k)) return MISSING;
  if (k >= 1) return `×${Number(k.toPrecision(3))}`;
  return `×1/${Math.round(1 / k)}`;
}
