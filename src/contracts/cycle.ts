// The 0-D transient cycle model contract (the performance truth). W1 implements CycleModel;
// src/mocks/mockCycle.ts is a labelled stand-in. SI units throughout.

import { validateAmbient, type AmbientConditions, ISA_SLS } from './ambient';
import type { EngineDefinition } from './engine';
import { STATION_IDS, type StationId } from './stations';
import { describeValue } from './describe';

export type FuelLever = 'cutoff' | 'run';
/** off: no igniters; auto: FADEC lights them for start/relight; continuous: always on. */
export type IgnitionMode = 'off' | 'auto' | 'continuous';
export const FUEL_LEVER_POSITIONS = ['cutoff', 'run'] as const satisfies readonly FuelLever[];
export const IGNITION_MODES = [
  'off',
  'auto',
  'continuous',
] as const satisfies readonly IgnitionMode[];

/**
 * Customer bleed upper bound: EASA TCDS E.004 III.10 allows HPC 5th + 9th stage bleed of
 * 13 % of primary airflow combined (20-61 % N1K). Bleed is a fraction of core flow.
 */
export const MAX_CUSTOMER_BLEED_FRACTION = 0.13;

/** Fuel-air ratio of a stoichiometric Jet-A/air mixture (about 0.068); FAR above it is impossible. */
export const STOICHIOMETRIC_FAR = 0.068;

/** Pilot and environment commands to the cycle model. */
export interface CycleInputs {
  /** Throttle lever travel: 0 = idle stop, 1 = full forward (maximum takeoff). */
  readonly throttleLever: number;
  /** Start switch at START: starter air valve open (FADEC cuts it out at the cut-out speed). */
  readonly starter: boolean;
  readonly fuelLever: FuelLever;
  readonly ignition: IgnitionMode;
  /** Customer (aircraft) bleed as a fraction of core flow, 0..MAX_CUSTOMER_BLEED_FRACTION. */
  readonly customerBleedFraction: number;
  /** Shaft power extracted by aircraft accessories (HP spool), W. */
  readonly powerExtractionW: number;
  readonly ambient: AmbientConditions;
}

export const DEFAULT_CYCLE_INPUTS: CycleInputs = {
  throttleLever: 0,
  starter: false,
  fuelLever: 'cutoff',
  ignition: 'off',
  customerBleedFraction: 0,
  powerExtractionW: 0,
  ambient: ISA_SLS,
};

/** Total conditions and flow at one station plane (mass-averaged). */
export interface StationState {
  readonly ptPa: number;
  readonly ttK: number;
  readonly wKgPerS: number;
  /** Fuel-air ratio (kg fuel per kg air); 0 upstream of the combustor and in the bypass. */
  readonly fuelAirRatio: number;
}

/** A compressor's operating point on its map. */
export interface MapOperatingPoint {
  /** W sqrt(Tt/288.15) / (Pt/101325), kg/s. */
  readonly correctedFlowKgPerS: number;
  readonly pressureRatio: number;
  readonly isentropicEfficiency: number;
  /** N / sqrt(Tt/288.15) over the 100 % reference speed. */
  readonly correctedSpeedFraction: number;
  /** (PR_surge - PR) / PR at the same corrected flow; negative in surge. */
  readonly surgeMarginFraction: number;
}

export const FADEC_MODES = ['off', 'start', 'run', 'shutdown'] as const;
export type FadecMode = (typeof FADEC_MODES)[number];

/** Which control loop currently sets fuel flow (the lowest-wins selector output). */
export const FADEC_LIMITERS = [
  'none',
  'n1Target',
  'accelSchedule',
  'decelSchedule',
  'idleFloor',
  'n1Max',
  'n2Max',
  'egtMax',
  'startSchedule',
] as const;
export type FadecLimiter = (typeof FADEC_LIMITERS)[number];

/**
 * none: not starting. cranking: starter only. ignition: fuel and igniters on, waiting for
 * light-off. accelerating: lit, starter assisting. selfSustaining: starter cut out, still
 * below idle. aborted: start abandoned (cut-off or starter released before light-off).
 */
export const START_PHASES = [
  'none',
  'cranking',
  'ignition',
  'accelerating',
  'selfSustaining',
  'aborted',
] as const;
export type StartPhase = (typeof START_PHASES)[number];

export interface FadecStatus {
  readonly mode: FadecMode;
  readonly limiter: FadecLimiter;
  readonly n1TargetPercent: number;
}

export interface CycleFlags {
  readonly surge: boolean;
  readonly flameout: boolean;
  readonly hungStart: boolean;
  readonly hotStart: boolean;
  /** Fuel on during a start without an EGT rise (a "wet" start). */
  readonly noLightOff: boolean;
  readonly n1Overspeed: boolean;
  readonly n2Overspeed: boolean;
  readonly egtExceedance: boolean;
}

export interface CycleState {
  readonly timeS: number;
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  /** Percent of the 100 % reference speed (EngineDefinition.designPoint.n1Rpm). */
  readonly n1Percent: number;
  readonly n2Percent: number;
  readonly stations: Readonly<Record<StationId, StationState>>;
  readonly fuelFlowKgPerS: number;
  readonly grossThrustN: number;
  readonly netThrustN: number;
  /** Fuel flow / net thrust, kg/(N s); null when net thrust is not positive. */
  readonly tsfcKgPerNs: number | null;
  /** Cockpit EGT: measured T49.5 plus the FADEC display shunt (EASA TCDS E.004 IV.1.1). */
  readonly egtDisplayedK: number;
  /** Physical T49.5 (stations['49.5'].ttK, averaged over the probe span). */
  readonly egtMeasuredK: number;
  readonly fan: MapOperatingPoint;
  readonly hpc: MapOperatingPoint;
  /** VSV closure from the design (open) setting, rad; positive = closed. */
  readonly vsvClosureRad: number;
  /** Booster variable bleed valve opening, 0 closed .. 1 fully open. */
  readonly vbvOpenFraction: number;
  readonly starterEngaged: boolean;
  readonly ignitersOn: boolean;
  readonly combustorLit: boolean;
  readonly fadec: FadecStatus;
  readonly startPhase: StartPhase;
  readonly flags: CycleFlags;
}

export type CycleFault = 'surge' | 'flameout';
export const CYCLE_FAULTS = ['surge', 'flameout'] as const satisfies readonly CycleFault[];

/** Where a reset puts the engine: stopped and cold, or stabilised at ground idle. */
export type CycleInitialCondition = 'shutdown' | 'groundIdle';
export const CYCLE_INITIAL_CONDITIONS = [
  'shutdown',
  'groundIdle',
] as const satisfies readonly CycleInitialCondition[];

/**
 * The transient cycle model. step() integrates the shaft dynamics and controller over dtS
 * seconds of simulation time and returns the new state; it never mutates a returned state.
 */
export interface CycleModel {
  readonly definition: EngineDefinition;
  reset(initial: CycleInitialCondition, ambient?: AmbientConditions): CycleState;
  step(dtS: number, inputs: CycleInputs): CycleState;
  /** Scenario hook: forces a surge or a flameout at the next step. */
  injectFault(fault: CycleFault): void;
  state(): CycleState;
}

export function percentOfReference(rpm: number, referenceRpm: number): number {
  return (100 * rpm) / referenceRpm;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateCycleInputs(inputs: CycleInputs): string[] {
  const problems: string[] = [];
  if (!(
    isFiniteNumber(inputs.throttleLever) &&
    inputs.throttleLever >= 0 &&
    inputs.throttleLever <= 1
  )) {
    problems.push(`throttleLever ${String(inputs.throttleLever)} must be in [0, 1]`);
  }
  if (typeof inputs.starter !== 'boolean') problems.push('starter must be a boolean');
  if (!(FUEL_LEVER_POSITIONS as readonly string[]).includes(inputs.fuelLever)) {
    problems.push(
      `fuelLever "${describeValue(inputs.fuelLever)}" must be one of ${FUEL_LEVER_POSITIONS.join(', ')}`,
    );
  }
  if (!(IGNITION_MODES as readonly string[]).includes(inputs.ignition)) {
    problems.push(
      `ignition "${describeValue(inputs.ignition)}" must be one of ${IGNITION_MODES.join(', ')}`,
    );
  }
  if (!(
    isFiniteNumber(inputs.customerBleedFraction) &&
    inputs.customerBleedFraction >= 0 &&
    inputs.customerBleedFraction <= MAX_CUSTOMER_BLEED_FRACTION
  )) {
    problems.push(
      `customerBleedFraction ${String(inputs.customerBleedFraction)} must be in [0, ${MAX_CUSTOMER_BLEED_FRACTION}]`,
    );
  }
  if (!(isFiniteNumber(inputs.powerExtractionW) && inputs.powerExtractionW >= 0)) {
    problems.push(`powerExtractionW ${String(inputs.powerExtractionW)} must be finite and >= 0`);
  }
  for (const p of validateAmbient(inputs.ambient)) problems.push(`ambient: ${p}`);
  return problems;
}

/** Tolerance for percent-vs-rpm consistency (percent points). */
const PERCENT_TOLERANCE = 1e-6;

function checkMapPoint(name: string, p: MapOperatingPoint, problems: string[]): void {
  if (!(isFiniteNumber(p.correctedFlowKgPerS) && p.correctedFlowKgPerS >= 0)) {
    problems.push(`${name}.correctedFlowKgPerS must be finite and >= 0`);
  }
  if (!(isFiniteNumber(p.pressureRatio) && p.pressureRatio > 0)) {
    problems.push(`${name}.pressureRatio must be finite and > 0`);
  }
  if (!(
    isFiniteNumber(p.isentropicEfficiency) &&
    p.isentropicEfficiency >= 0 &&
    p.isentropicEfficiency <= 1
  )) {
    problems.push(
      `${name}.isentropicEfficiency ${String(p.isentropicEfficiency)} must be in [0, 1]`,
    );
  }
  if (!(isFiniteNumber(p.correctedSpeedFraction) && p.correctedSpeedFraction >= 0)) {
    problems.push(`${name}.correctedSpeedFraction must be finite and >= 0`);
  }
  if (!isFiniteNumber(p.surgeMarginFraction))
    problems.push(`${name}.surgeMarginFraction must be finite`);
}

/**
 * Checks a state for physical plausibility and internal consistency (not accuracy).
 * referenceSpeeds are the 100 % speeds (EngineDefinition.designPoint).
 */
export function validateCycleState(
  state: CycleState,
  referenceSpeeds: { readonly n1Rpm: number; readonly n2Rpm: number },
): string[] {
  const problems: string[] = [];
  const finite = (name: string, v: number): void => {
    if (!isFiniteNumber(v)) problems.push(`${name} must be finite (got ${String(v)})`);
  };
  finite('timeS', state.timeS);
  for (const [spool, rpm, percent, ref] of [
    ['n1', state.n1Rpm, state.n1Percent, referenceSpeeds.n1Rpm],
    ['n2', state.n2Rpm, state.n2Percent, referenceSpeeds.n2Rpm],
  ] as const) {
    if (!(isFiniteNumber(rpm) && rpm >= 0)) problems.push(`${spool}Rpm must be finite and >= 0`);
    else if (!(
      isFiniteNumber(percent) &&
      Math.abs(percent - percentOfReference(rpm, ref)) <= PERCENT_TOLERANCE
    )) {
      problems.push(
        `${spool}Percent ${String(percent)} does not match ${spool}Rpm ${String(rpm)} (expected ${percentOfReference(rpm, ref).toFixed(4)})`,
      );
    }
  }
  for (const id of STATION_IDS) {
    const s = (state.stations as Partial<Record<StationId, StationState>>)[id];
    if (s === undefined) {
      problems.push(`station ${id} is missing`);
      continue;
    }
    if (!(isFiniteNumber(s.ptPa) && s.ptPa > 0))
      problems.push(`station ${id} ptPa ${String(s.ptPa)} must be > 0`);
    if (!(isFiniteNumber(s.ttK) && s.ttK > 0))
      problems.push(`station ${id} ttK ${String(s.ttK)} must be > 0`);
    if (!(isFiniteNumber(s.wKgPerS) && s.wKgPerS >= 0)) {
      problems.push(`station ${id} wKgPerS ${String(s.wKgPerS)} must be >= 0`);
    }
    if (!(
      isFiniteNumber(s.fuelAirRatio) &&
      s.fuelAirRatio >= 0 &&
      s.fuelAirRatio <= STOICHIOMETRIC_FAR
    )) {
      problems.push(
        `station ${id} fuelAirRatio ${String(s.fuelAirRatio)} must be in [0, ${STOICHIOMETRIC_FAR}]`,
      );
    }
  }
  if (!(isFiniteNumber(state.fuelFlowKgPerS) && state.fuelFlowKgPerS >= 0)) {
    problems.push(`fuelFlowKgPerS ${String(state.fuelFlowKgPerS)} must be finite and >= 0`);
  }
  finite('grossThrustN', state.grossThrustN);
  finite('netThrustN', state.netThrustN);
  if (state.tsfcKgPerNs === null) {
    if (isFiniteNumber(state.netThrustN) && state.netThrustN > 0) {
      problems.push('tsfcKgPerNs must be a number when net thrust is positive');
    }
  } else if (!(isFiniteNumber(state.tsfcKgPerNs) && state.tsfcKgPerNs >= 0)) {
    problems.push(`tsfcKgPerNs ${String(state.tsfcKgPerNs)} must be finite and >= 0`);
  } else if (!(state.netThrustN > 0)) {
    problems.push('tsfcKgPerNs must be null when net thrust is not positive');
  }
  if (!(isFiniteNumber(state.egtDisplayedK) && state.egtDisplayedK > 0))
    problems.push('egtDisplayedK must be > 0');
  if (!(isFiniteNumber(state.egtMeasuredK) && state.egtMeasuredK > 0))
    problems.push('egtMeasuredK must be > 0');
  checkMapPoint('fan', state.fan, problems);
  checkMapPoint('hpc', state.hpc, problems);
  finite('vsvClosureRad', state.vsvClosureRad);
  if (!(
    isFiniteNumber(state.vbvOpenFraction) &&
    state.vbvOpenFraction >= 0 &&
    state.vbvOpenFraction <= 1
  )) {
    problems.push(`vbvOpenFraction ${String(state.vbvOpenFraction)} must be in [0, 1]`);
  }
  if (!(FADEC_MODES as readonly string[]).includes(state.fadec.mode)) {
    problems.push(`fadec.mode "${describeValue(state.fadec.mode)}" is not a FADEC mode`);
  }
  if (!(FADEC_LIMITERS as readonly string[]).includes(state.fadec.limiter)) {
    problems.push(`fadec.limiter "${describeValue(state.fadec.limiter)}" is not a FADEC limiter`);
  }
  finite('fadec.n1TargetPercent', state.fadec.n1TargetPercent);
  if (!(START_PHASES as readonly string[]).includes(state.startPhase)) {
    problems.push(`startPhase "${describeValue(state.startPhase)}" is not a start phase`);
  }
  return problems;
}
