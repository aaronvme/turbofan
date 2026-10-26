// MOCK cycle model: a labelled stand-in for the W1 transient cycle model, so the UI, audio
// and visuals can be built against the CycleModel contract before the real one exists. It
// is not physics: speeds, EGT, thrust and fuel flow follow published operating points, and
// the station totals are scaled from the design-point estimate. The UI must label any data
// that comes from here as MOCK.
//
// Data (docs/ENGINE_FACTS.md via ../engine/facts):
// - N1(N2) passes through the measured idle, MPA and static takeoff points ([WIDURI] Table 7):
//   N1 = N1idle + (N1to - N1idle) s^k with s the N2 fraction between idle and takeoff, k
//   fitted through the MPA point (k = 1.76); below idle N1 = N1idle (N2 / N2idle)^2.
// - Displayed EGT is piecewise linear in s through the same three points, corrected from the
//   run-up day (OAT 25 C) to the ambient with EGT / theta held.
// - Thrust is the TCDS takeoff thrust times (N1 / N1to)^2 delta; fuel flow is interpolated in
//   thrust fraction through the four EEDB LTO points, so takeoff gives the C3 TSFC target.
// - Start: fuel no earlier than minFuelOnN2, light-off lightOffDelay after fuel and
//   igniters, starter cut-out at starterCutoutN2, idle in about startTime.
// The spool and EGT time constants below are mock choices, not engine data.

import { ISA_SLS, R_AIR, type AmbientConditions } from '../contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  percentOfReference,
  validateCycleInputs,
  type CycleFault,
  type CycleInitialCondition,
  type CycleInputs,
  type CycleModel,
  type CycleState,
  type FadecLimiter,
  type FadecMode,
  type MapOperatingPoint,
  type StartPhase,
  type StationState,
} from '../contracts/cycle';
import type { EngineDefinition } from '../contracts/engine';
import type { StationId } from '../contracts/stations';
import { deepFreeze } from '../contracts/sim';
import {
  COLD_GAS,
  DESIGN_LOSSES,
  HOT_GAS,
  estimateDesignPoint,
  type DesignPointEstimate,
} from '../engine/designPoint';
import { factValue as v } from '../engine/facts';

export const MOCK_LABEL = 'MOCK' as const;

export interface MockCycleModel extends CycleModel {
  readonly label: typeof MOCK_LABEL;
}

// ---------------------------------------------------------------------------------------
// Published anchors

const N1_IDLE = (v('idleN1Low') + v('idleN1High')) / 2;
const N2_IDLE = (v('idleN2Low') + v('idleN2High')) / 2;
const N1_TO = v('staticTakeoffN1');
const N2_TO = v('staticTakeoffN2');
const S_MPA = (v('mpaN2') - N2_IDLE) / (N2_TO - N2_IDLE);
const N1_EXPONENT = Math.log((v('mpaN1') - N1_IDLE) / (N1_TO - N1_IDLE)) / Math.log(S_MPA);
const EGT_IDLE = (v('idleEgtLow') + v('idleEgtHigh')) / 2;
const EGT_POINTS: readonly (readonly [number, number])[] = [
  [0, EGT_IDLE],
  [S_MPA, v('mpaEgt')],
  [1, v('staticTakeoffEgt')],
];
/** EEDB LTO points: (fraction of rated thrust, fuel flow kg/s). */
const FUEL_POINTS: readonly (readonly [number, number])[] = [
  [0.07, v('fuelFlowIdle')],
  [0.3, v('fuelFlowApproach')],
  [0.85, v('fuelFlowClimbOut')],
  [1, v('fuelFlowTakeoff')],
];
const LIGHT_OFF_DELAY_S = v('lightOffDelay');
const MIN_FUEL_ON_N2 = v('minFuelOnN2');
const STARTER_CUTOUT_N2 = v('starterCutoutN2');

/** Mock dynamics: chosen so the published start and spool-up times come out, not engine data. */
const MOCK = {
  motoringN2Percent: 28,
  crankTauS: 8,
  startTauS: 9.2,
  accelTauS: 1.1,
  decelTauS: 1.5,
  spoolDownTauS: 12,
  egtRunTauS: 1,
  egtStartTauS: 2,
  egtCoolTauS: 30,
  /** The start is complete within this of idle N2. */
  idleBandPercent: 0.5,
  surgeDurationS: 0.3,
  surgeThrustFactor: 0.7,
  surgeMargin: 0.2,
  surgeMarginInSurge: -0.05,
  /** Core flow ~ N2^3.5 between rest and takeoff (BPR rises toward idle). */
  coreFlowExponent: 3.5,
  /** Fuel is limited to keep the combustor FAR below this. */
  maxFuelAirRatio: 0.05,
  vbvOpenBelowN2c: 70,
  vbvClosedAboveN2c: 85,
  offBelowN2Percent: 1,
  maxSubstepS: 0.02,
  /** Longest accepted step, s (2.5 x the 0.4 s the sim loop can ask for). */
  maxStepS: 1,
} as const;

function interpolate(points: readonly (readonly [number, number])[], x: number): number {
  const first = points[0];
  const second = points[1];
  if (first === undefined || second === undefined) return 0;
  let a = first;
  let b = second;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const q = points[i - 1];
    if (p === undefined || q === undefined) continue;
    a = q;
    b = p;
    if (x <= p[0]) break;
  }
  return a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
}

/** N1 (percent) that goes with N2 (percent) on the mock working line. */
export function mockN1PercentFromN2(n2Percent: number): number {
  if (n2Percent <= 0) return 0;
  if (n2Percent < N2_IDLE) return N1_IDLE * (n2Percent / N2_IDLE) ** 2;
  const s = (n2Percent - N2_IDLE) / (N2_TO - N2_IDLE);
  return N1_IDLE + (N1_TO - N1_IDLE) * s ** N1_EXPONENT;
}

/** Lever 0..1 commands N1 linearly from idle to the static takeoff N1; this is its N2. */
function n2ForLever(lever: number): number {
  return N2_IDLE + lever ** (1 / N1_EXPONENT) * (N2_TO - N2_IDLE);
}

const n1TargetForLever = (lever: number) => N1_IDLE + lever * (N1_TO - N1_IDLE);

// ---------------------------------------------------------------------------------------
// Station totals

interface Ambient {
  readonly amb: AmbientConditions;
  readonly tt0: number;
  readonly pt0: number;
  readonly theta: number;
  readonly delta: number;
  readonly flightSpeed: number;
}

function ambientTotals(amb: AmbientConditions): Ambient {
  const g = COLD_GAS.gamma;
  const ram = 1 + ((g - 1) / 2) * amb.machNumber ** 2;
  const tt0 = amb.temperatureK * ram;
  const pt0 = amb.pressurePa * ram ** (g / (g - 1));
  return {
    amb,
    tt0,
    pt0,
    theta: tt0 / ISA_SLS.temperatureK,
    delta: pt0 / ISA_SLS.pressurePa,
    flightSpeed: amb.machNumber * Math.sqrt(g * R_AIR * amb.temperatureK),
  };
}

interface Context {
  readonly def: EngineDefinition;
  readonly est: DesignPointEstimate;
}

interface MockStations {
  readonly stations: Record<StationId, StationState>;
  readonly fuelFlow: number;
  readonly prFan: number;
  readonly prHpc: number;
  readonly flowTotal: number;
  readonly flowCore: number;
}

const st = (ptPa: number, ttK: number, wKgPerS: number, fuelAirRatio = 0): StationState => ({
  ptPa,
  ttK,
  wKgPerS,
  fuelAirRatio,
});

/**
 * Station totals at the given speeds: pressure ratios scale as 1 + (PR - 1) n^2 (fan laws),
 * flows with N; the hot section hangs off the EGT (T49.5) with the turbine temperature drops
 * of the shaft balances. Unlit, the hot section just holds the gas temperature.
 */
function mockStations(
  ctx: Context,
  a: Ambient,
  n1Percent: number,
  n2Percent: number,
  fuelDemand: number,
  t495Lit: number,
  lit: boolean,
): MockStations {
  const { def, est } = ctx;
  const dp = def.designPoint;
  const e = est.stations;
  const cold = COLD_GAS;
  const hot = HOT_GAS;
  const k = (cold.gamma - 1) / cold.gamma;
  const n1f = Math.max(0, n1Percent / N1_TO);
  const n2f = Math.max(0, n2Percent / N2_TO);
  const flowScale = a.delta / Math.sqrt(a.theta);
  const wb = e['13'].wKgPerS * n1f * flowScale;
  const coreFraction = n2f ** MOCK.coreFlowExponent;
  const wc = e['21'].wKgPerS * coreFraction * flowScale;
  const pr = (design: number, n: number) => 1 + (design - 1) * n * n;
  const compress = (tIn: number, p: number, eta: number) => tIn * (1 + (p ** k - 1) / eta);
  const prs = dp.pressureRatios;
  const eta = dp.efficiencies;
  const prFb = pr(prs.fanBypass, n1f);
  const prFc = pr(prs.fanCore, n1f);
  const prB = pr(prs.booster, n1f);
  const prH = pr(prs.hpc, n2f);
  const t13 = compress(a.tt0, prFb, eta.fanBypass);
  const t21 = compress(a.tt0, prFc, eta.fanCore);
  const t24 = compress(t21, prB, eta.booster);
  const t3 = compress(t24, prH, eta.hpc);
  const p13 = a.pt0 * prFb;
  const p21 = a.pt0 * prFc;
  const p24 = p21 * prB;
  const p3 = p24 * prH;
  // duct losses scale with the dynamic head, i.e. with flow squared
  const p18 = p13 - DESIGN_LOSSES.bypassDuctPtLoss * e['13'].ptPa * a.delta * n1f * n1f;
  const p4 = p3 - dp.combustorPressureLossFraction * e['3'].ptPa * a.delta * coreFraction ** 2;

  const wCool = wc * dp.turbineCoolingFraction;
  const wComb = wc - wCool;
  const wf = Math.min(fuelDemand, MOCK.maxFuelAirRatio * wComb);
  const wg = wc + wf;
  let t4: number;
  let t41: number;
  let t45: number;
  let t495: number;
  let t5: number;
  if (lit && wg > 0) {
    const perGas = DESIGN_LOSSES.mechanicalEfficiency * wg * hot.cpJPerKgK;
    const lpDrop =
      (wb * cold.cpJPerKgK * (t13 - a.tt0) + wc * cold.cpJPerKgK * (t24 - a.tt0)) / perGas;
    const hpDrop = (wc * cold.cpJPerKgK * (t3 - t24)) / perGas;
    t495 = t495Lit;
    t45 = t495 + lpDrop / 4;
    t5 = Math.max(a.tt0, t495 - (3 * lpDrop) / 4);
    t41 = t45 + hpDrop;
    t4 = Math.max(
      t41,
      (t41 * wg * hot.cpJPerKgK - wCool * cold.cpJPerKgK * t3) / ((wComb + wf) * hot.cpJPerKgK),
    );
  } else {
    const tGas = Math.max(t495Lit, t3);
    t4 = t41 = t45 = t495 = t5 = tGas;
  }
  const gauge = (id: StationId) => e[id].ptPa / e['0'].ptPa - 1;
  const p41 = p4;
  const p45 = Math.min(p41, a.pt0 * (1 + gauge('45') * n2f * n2f));
  const p5 = Math.min(p45, a.pt0 * (1 + gauge('5') * n1f * n1f));
  const p495 = p45 * (p5 / p45) ** 0.25;
  const p8 = Math.max(
    a.pt0,
    p5 - DESIGN_LOSSES.coreNozzlePtLoss * e['5'].ptPa * a.delta * n1f * n1f,
  );
  const farComb = wComb > 0 ? wf / wComb : 0;
  const farGas = wc > 0 ? wf / wc : 0;
  const w = wb + wc;
  return {
    stations: {
      '0': st(a.pt0, a.tt0, w),
      '1': st(a.pt0, a.tt0, w),
      '2': st(a.pt0, a.tt0, w),
      '13': st(p13, t13, wb),
      '18': st(p18, t13, wb),
      '19': st(p18, t13, wb),
      '21': st(p21, t21, wc),
      '24': st(p24, t24, wc),
      '25': st(p24, t24, wc),
      '3': st(p3, t3, wc),
      '4': st(p4, t4, wComb + wf, farComb),
      '41': st(p41, t41, wg, farGas),
      '45': st(p45, t45, wg, farGas),
      '49.5': st(p495, t495, wg, farGas),
      '5': st(p5, t5, wg, farGas),
      '8': st(p8, t5, wg, farGas),
      '9': st(p8, t5, wg, farGas),
    },
    fuelFlow: wf,
    prFan: prFb,
    prHpc: prH,
    flowTotal: w,
    flowCore: wc,
  };
}

// ---------------------------------------------------------------------------------------
// Model state

interface Internal {
  timeS: number;
  ambient: AmbientConditions;
  n2: number;
  /** Measured T49.5, K (lagged). */
  egtK: number;
  lit: boolean;
  inStart: boolean;
  aborted: boolean;
  starterCutout: boolean;
  lightTimerS: number;
  wetS: number;
  flameout: boolean;
  hotStart: boolean;
  surgeS: number;
  pendingFault: CycleFault | null;
  inputs: CycleInputs;
}

function shuntK(def: EngineDefinition, n2Rpm: number): number {
  const s = def.limits.egtShunt;
  if (n2Rpm <= s.rampStartN2Rpm) return 0;
  if (n2Rpm >= s.fullN2Rpm) return s.offsetK;
  return (s.offsetK * (n2Rpm - s.rampStartN2Rpm)) / (s.fullN2Rpm - s.rampStartN2Rpm);
}

/** Run-up-day displayed EGT on the working line, corrected to the ambient (EGT / theta held). */
function displayedEgtTarget(a: Ambient, inStart: boolean, n2: number): number {
  const runUp = inStart
    ? v('startPeakEgt')
    : interpolate(EGT_POINTS, (n2 - N2_IDLE) / (N2_TO - N2_IDLE));
  return (runUp * a.tt0) / v('runUpOat');
}

function measuredEgtTarget(ctx: Context, a: Ambient, inStart: boolean, n2: number): number {
  const n2Rpm = (n2 * ctx.def.designPoint.n2Rpm) / 100;
  return displayedEgtTarget(a, inStart, n2) - shuntK(ctx.def, n2Rpm);
}

/** Fuel flow that holds the steady working line at this N1 (EEDB points in thrust fraction). */
function runFuelFlow(a: Ambient, n1: number): number {
  const fraction = (n1 / N1_TO) ** 2;
  return Math.max(0, interpolate(FUEL_POINTS, fraction)) * a.delta * Math.sqrt(a.theta);
}

/** Start schedule: from light-off to idle the fuel flow rises with N2 to the idle flow. */
function startFuelFlow(a: Ambient, n2: number): number {
  return runFuelFlow(a, N1_IDLE) * (0.5 + (0.5 * n2) / N2_IDLE);
}

const relax = (x: number, target: number, dt: number, tau: number) =>
  x + (target - x) * (1 - Math.exp(-dt / tau));

function substep(ctx: Context, s: Internal, dt: number): void {
  const inputs = s.inputs;
  const a = ambientTotals(inputs.ambient);
  if (s.pendingFault === 'flameout' && s.lit) {
    s.lit = false;
    s.flameout = true;
  } else if (s.pendingFault === 'surge') {
    s.surgeS = MOCK.surgeDurationS;
  }
  s.pendingFault = null;

  // starter: the FADEC cuts it out at the cut-out speed until the switch is released
  if (!inputs.starter) s.starterCutout = false;
  else if (s.n2 >= STARTER_CUTOUT_N2) s.starterCutout = true;
  const starterEngaged = inputs.starter && !s.starterCutout;
  if (starterEngaged && !s.lit && s.n2 < N2_IDLE - MOCK.idleBandPercent) {
    s.inStart = true;
    s.aborted = false;
  }
  if (s.inStart && !s.lit && !inputs.starter) {
    s.inStart = false;
    s.aborted = true;
  }

  // fuel and ignition
  const fuelRun = inputs.fuelLever === 'run';
  if (!fuelRun) s.lit = false;
  const fuelAdmitted = fuelRun && (s.lit || s.n2 >= MIN_FUEL_ON_N2);
  const ignitersOn =
    inputs.ignition === 'continuous' || (inputs.ignition === 'auto' && fuelAdmitted && !s.lit);
  if (fuelAdmitted && !s.lit) {
    s.wetS += dt;
    if (ignitersOn) s.lightTimerS += dt;
    if (s.lightTimerS >= LIGHT_OFF_DELAY_S) {
      s.lit = true;
      s.flameout = false;
    }
  }
  if (s.lit || !fuelAdmitted) {
    s.lightTimerS = 0;
    s.wetS = 0;
  }
  if (s.inStart && s.lit && s.n2 >= N2_IDLE - MOCK.idleBandPercent) s.inStart = false;

  // spool
  let target: number;
  let tau: number;
  if (s.lit && s.inStart) {
    target = N2_IDLE;
    tau = MOCK.startTauS;
  } else if (s.lit) {
    target = n2ForLever(inputs.throttleLever);
    tau = target > s.n2 ? MOCK.accelTauS : MOCK.decelTauS;
  } else if (starterEngaged) {
    target = MOCK.motoringN2Percent;
    tau = MOCK.crankTauS;
  } else {
    target = 0;
    tau = MOCK.spoolDownTauS;
  }
  s.n2 = relax(s.n2, target, dt, tau);

  // EGT
  if (s.lit) {
    const t = measuredEgtTarget(ctx, a, s.inStart, s.n2);
    s.egtK = relax(s.egtK, t, dt, s.inStart ? MOCK.egtStartTauS : MOCK.egtRunTauS);
  } else {
    s.egtK = relax(s.egtK, a.tt0, dt, MOCK.egtCoolTauS);
  }
  const displayed = s.egtK + shuntK(ctx.def, (s.n2 * ctx.def.designPoint.n2Rpm) / 100);
  if (s.inStart && displayed > ctx.def.limits.egtStartLimitK) s.hotStart = true;
  s.surgeS = Math.max(0, s.surgeS - dt);
  s.timeS += dt;
}

function fuelDemand(s: Internal, a: Ambient, n1: number): number {
  const fuelRun = s.inputs.fuelLever === 'run';
  if (!fuelRun) return 0;
  if (s.lit && !s.inStart) return runFuelFlow(a, n1);
  if (s.lit || s.n2 >= MIN_FUEL_ON_N2) return startFuelFlow(a, s.n2);
  return 0;
}

function mapPoint(
  correctedFlow: number,
  pressureRatio: number,
  designEta: number,
  speedFraction: number,
  surge: boolean,
): MapOperatingPoint {
  const n = Math.min(1, speedFraction);
  return {
    correctedFlowKgPerS: correctedFlow,
    pressureRatio,
    isentropicEfficiency: Math.min(1, Math.max(0, designEta * (1 - 0.3 * (1 - n) ** 2))),
    correctedSpeedFraction: speedFraction,
    surgeMarginFraction: surge ? MOCK.surgeMarginInSurge : MOCK.surgeMargin,
  };
}

function buildState(ctx: Context, s: Internal): CycleState {
  const { def } = ctx;
  const dp = def.designPoint;
  const inputs = s.inputs;
  const a = ambientTotals(inputs.ambient);
  const n1 = mockN1PercentFromN2(s.n2);
  const n1Rpm = (n1 * dp.n1Rpm) / 100;
  const n2Rpm = (s.n2 * dp.n2Rpm) / 100;
  const ms = mockStations(ctx, a, n1, s.n2, fuelDemand(s, a, n1), s.egtK, s.lit);
  const t495 = ms.stations['49.5'].ttK;
  const egtDisplayedK = t495 + shuntK(def, n2Rpm);
  const surge = s.surgeS > 0;
  const thrust =
    v('takeoffThrust') * (n1 / N1_TO) ** 2 * a.delta * (surge ? MOCK.surgeThrustFactor : 1);
  const theta25 = ms.stations['25'].ttK / ISA_SLS.temperatureK;
  const delta25 = ms.stations['25'].ptPa / ISA_SLS.pressurePa;
  const n2c = (100 * n2Rpm) / Math.sqrt(theta25) / dp.n2Rpm;
  const schedule = def.vsvSchedules[0];
  const vsv =
    schedule === undefined
      ? 0
      : interpolate(
          schedule.points.map((p) => [p.n2CorrectedPercent, p.closure] as const),
          Math.min(
            Math.max(n2c, schedule.points[0]?.n2CorrectedPercent ?? 0),
            schedule.points[schedule.points.length - 1]?.n2CorrectedPercent ?? 0,
          ),
        );
  const vbv = Math.min(
    1,
    Math.max(0, (MOCK.vbvClosedAboveN2c - n2c) / (MOCK.vbvClosedAboveN2c - MOCK.vbvOpenBelowN2c)),
  );
  const starterEngaged = inputs.starter && !s.starterCutout;
  const fuelAdmitted = ms.fuelFlow > 0;
  const ignitersOn =
    inputs.ignition === 'continuous' || (inputs.ignition === 'auto' && fuelAdmitted && !s.lit);
  let mode: FadecMode;
  if (s.inStart) mode = 'start';
  else if (s.lit) mode = 'run';
  else mode = s.n2 >= MOCK.offBelowN2Percent ? 'shutdown' : 'off';
  let phase: StartPhase = 'none';
  if (s.inStart) {
    if (!fuelAdmitted) phase = 'cranking';
    else if (!s.lit) phase = 'ignition';
    else phase = starterEngaged ? 'accelerating' : 'selfSustaining';
  } else if (s.aborted) phase = 'aborted';
  const n2Target = n2ForLever(inputs.throttleLever);
  let limiter: FadecLimiter = 'none';
  if (mode === 'start') limiter = 'startSchedule';
  else if (mode === 'run') {
    if (Math.abs(n2Target - s.n2) > 1)
      limiter = n2Target > s.n2 ? 'accelSchedule' : 'decelSchedule';
    else limiter = inputs.throttleLever === 0 ? 'idleFloor' : 'n1Target';
  }
  const egtLimit = s.inStart ? def.limits.egtStartLimitK : def.limits.egtTakeoffRedlineK;
  const state: CycleState = {
    timeS: s.timeS,
    n1Rpm,
    n2Rpm,
    n1Percent: percentOfReference(n1Rpm, dp.n1Rpm),
    n2Percent: percentOfReference(n2Rpm, dp.n2Rpm),
    stations: ms.stations,
    fuelFlowKgPerS: ms.fuelFlow,
    grossThrustN: thrust + ms.flowTotal * a.flightSpeed,
    netThrustN: thrust,
    tsfcKgPerNs: thrust > 0 ? ms.fuelFlow / thrust : null,
    egtDisplayedK,
    egtMeasuredK: t495,
    fan: mapPoint(
      (ms.flowTotal * Math.sqrt(a.theta)) / a.delta,
      ms.prFan,
      dp.efficiencies.fanBypass,
      n1Rpm / Math.sqrt(a.theta) / dp.n1Rpm,
      surge,
    ),
    hpc: mapPoint(
      (ms.flowCore * Math.sqrt(theta25)) / delta25,
      ms.prHpc,
      dp.efficiencies.hpc,
      n2Rpm / Math.sqrt(theta25) / dp.n2Rpm,
      surge,
    ),
    vsvClosureRad: vsv,
    vbvOpenFraction: vbv,
    starterEngaged,
    ignitersOn,
    combustorLit: s.lit,
    fadec: {
      mode,
      limiter,
      n1TargetPercent:
        mode === 'run' ? n1TargetForLever(inputs.throttleLever) : mode === 'start' ? N1_IDLE : 0,
    },
    startPhase: phase,
    flags: {
      surge,
      flameout: s.flameout,
      hungStart: false,
      hotStart: s.hotStart,
      noLightOff: !s.lit && s.wetS > 2 * LIGHT_OFF_DELAY_S,
      n1Overspeed: n1Rpm > def.limits.n1MaxRpm,
      n2Overspeed: n2Rpm > def.limits.n2MaxRpm,
      egtExceedance: egtDisplayedK > egtLimit,
    },
  };
  return deepFreeze(state);
}

function initialInternal(
  ctx: Context,
  initial: CycleInitialCondition,
  ambient: AmbientConditions,
  lever = 0,
): Internal {
  const a = ambientTotals(ambient);
  const running = initial === 'groundIdle';
  const n2 = running ? n2ForLever(lever) : 0;
  return {
    timeS: 0,
    ambient,
    n2,
    egtK: running ? measuredEgtTarget(ctx, a, false, n2) : a.tt0,
    lit: running,
    inStart: false,
    aborted: false,
    starterCutout: false,
    lightTimerS: 0,
    wetS: 0,
    flameout: false,
    hotStart: false,
    surgeS: 0,
    pendingFault: null,
    inputs: running
      ? {
          ...DEFAULT_CYCLE_INPUTS,
          throttleLever: lever,
          fuelLever: 'run',
          ignition: 'auto',
          ambient,
        }
      : { ...DEFAULT_CYCLE_INPUTS, ambient },
  };
}

function context(def: EngineDefinition): Context {
  return { def, est: estimateDesignPoint(def.designPoint, v('fuelLhv')) };
}

/** A new MOCK cycle model, at rest (call reset to choose the initial condition). */
export function createMockCycle(definition: EngineDefinition): MockCycleModel {
  const ctx = context(definition);
  let s = initialInternal(ctx, 'shutdown', ISA_SLS);
  let current = buildState(ctx, s);
  return {
    label: MOCK_LABEL,
    source: 'mock',
    definition,
    reset(initial: CycleInitialCondition, ambient: AmbientConditions = ISA_SLS): CycleState {
      s = initialInternal(ctx, initial, ambient);
      current = buildState(ctx, s);
      return current;
    },
    step(dtS: number, inputs: CycleInputs): CycleState {
      // the sim never asks for more than MAX_WALL_STEP_S x TIME_SCALE_MAX = 0.4 s; a runaway
      // dt would otherwise mean dt / maxSubstepS substeps, i.e. a hang (W0C-N6)
      if (!(Number.isFinite(dtS) && dtS >= 0 && dtS <= MOCK.maxStepS))
        throw new Error(
          `mockCycle: dtS ${String(dtS)} must be finite and in [0, ${MOCK.maxStepS}] s`,
        );
      const problems = validateCycleInputs(inputs);
      if (problems.length > 0) throw new Error(`mockCycle: ${problems.join('; ')}`);
      // a zero step (paused) still takes the inputs, so the controls answer while paused
      s.inputs = inputs;
      const n = Math.ceil(dtS / MOCK.maxSubstepS);
      for (let i = 0; i < n; i++) substep(ctx, s, dtS / n);
      current = buildState(ctx, s);
      return current;
    },
    injectFault(fault: CycleFault): void {
      s.pendingFault = fault;
    },
    state(): CycleState {
      return current;
    },
  };
}

/** The settled MOCK state at a lever position (lit, running), without integrating. */
export function mockSteadyState(
  definition: EngineDefinition,
  throttleLever: number,
  ambient: AmbientConditions = ISA_SLS,
): CycleState {
  const ctx = context(definition);
  return buildState(ctx, initialInternal(ctx, 'groundIdle', ambient, throttleLever));
}
