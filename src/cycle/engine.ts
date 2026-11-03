// The 0-D gas path of the two-spool separate-flow turbofan: design-point sizing (D1-2) and
// map-based off-design matching (C7, C8). Thermally perfect gas (src/thermo), pyCycle maps
// (src/cycle/maps, Apache-2.0), SI units. The transient model (src/cycle/model.ts) calls
// evaluateGasPath / solveGasPath every step; the steady solver here is its initialiser and the
// C1-C8 test harness.
//
// Component models (Walsh & Fletcher, Gas Turbine Performance, 2nd ed., ch. 5 and 7):
// - inlet: 100 % ram recovery (TCDS E.004 note 2); station 1 = station 2.
// - fan: one map (the bypass/tip stream); the core (root) stream keeps the design ratio of
//   PR - 1 and of efficiency to the tip; booster (LPC) and HPC on their maps; VBV dumps booster
//   flow into the bypass duct; P25 = P24 (the OPR convention of docs/PHYSICS.md 2.2).
// - customer bleed leaves at HPC exit; turbine cooling air skips the combustor and mixes in at
//   the HPT rotor inlet (41), as in the W0 estimate.
// - combustor: sensible-enthalpy balance with eta_b Wf LHV; constant fractional pressure loss.
// - turbines on their maps; the EGT probe (49.5) sits after the LPT stage that does the
//   calibrated share of LPT work.
// - convergent nozzles, choked or not, thermally perfect; gross thrust = W V + (p - p0) A.
//
// Unknowns of the gas path at given spool speeds and fuel flow: fan R-line, BPR, booster R-line,
// HPC R-line, HPT and LPT pressure ratios. Residuals: booster and HPC flow continuity, HPT and LPT
// flow capacity, core and bypass nozzle flow. The steady state adds N1, N2 and fuel flow, with
// the two shaft power balances and one specification (fuel flow, N1, N2 or net thrust).

import { R_AIR, type AmbientConditions } from '../contracts/ambient';
import type { StationState } from '../contracts/cycle';
import type { EngineDefinition } from '../contracts/engine';
import type { StationId } from '../contracts/stations';
import { DESIGN_LOSSES } from '../engine/designPoint';
import { ENGINE_DEFINITION } from '../engine/definition';
import { factValue } from '../engine/facts';
import {
  enthalpy,
  entropyFunction,
  gamma,
  gasConstant,
  isentropicTemperature,
  temperatureFromEnthalpy,
} from '../thermo/gas';
import {
  compressorPoint,
  scaleCompressorMap,
  scaleTurbineMap,
  surgeMargin,
  turbinePoint,
  type CompressorPoint,
  type ScaledCompressorMap,
  type ScaledTurbineMap,
  type TurbinePoint,
} from './componentMaps';
import { FAN_MAP } from './maps/fan';
import { HPC_MAP } from './maps/hpc';
import { HPT_MAP } from './maps/hpt';
import { LPC_MAP } from './maps/lpc';
import { LPT_MAP } from './maps/lpt';
import { at } from './at';
import { newton } from './newton';
import { PART_POWER_FIT } from './partPowerFit';

const T_STD = 288.15;
const P_STD = 101325;

/** Heating value of CO burnt to CO2, J/kg: (393.52 - 110.53) kJ/mol / 28.010 g/mol (JANAF). */
export const CO_HEATING_VALUE_J_PER_KG = ((393.52 - 110.53) / 28.01) * 1e6;

/** Every assumption of the cycle; CYCLE_CALIBRATION documents each value. */
export interface CycleCalibration {
  readonly ambient: AmbientConditions;
  readonly totalAirflowKgPerS: number;
  readonly bypassRatio: number;
  readonly fanCorePressureRatio: number;
  readonly boosterPressureRatio: number;
  readonly overallPressureRatio: number;
  readonly efficiencies: {
    readonly fanBypass: number;
    readonly fanCore: number;
    readonly booster: number;
    readonly hpc: number;
    readonly hpt: number;
    readonly lpt: number;
    readonly combustor: number;
  };
  readonly combustorPressureLossFraction: number;
  readonly turbineCoolingFraction: number;
  readonly bypassDuctPtLoss: number;
  readonly coreNozzlePtLoss: number;
  readonly mechanicalEfficiency: number;
  readonly fuelLhvJPerKg: number;
  readonly fuelFlowKgPerS: number;
  readonly netThrustN: number;
  /** Physical spool speeds at the design point (ISA SLS rated takeoff), rpm. */
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  /** The 100 % speeds that percentages refer to (EngineDefinition.designPoint), rpm. */
  readonly n1ReferenceRpm: number;
  readonly n2ReferenceRpm: number;
  /** Share of the LPT work done upstream of the EGT probe (LPT stage 2 nozzle). */
  readonly egtProbeLptWorkFraction: number;
  /** FADEC ground-idle N2 floor, % of the 100 % speed. */
  readonly groundIdleN2Percent: number;
  /**
   * The mechanical loss (bearings, seals, windage, gearbox and the engine's own pumps) is
   * (1 - mechanicalEfficiency) of the turbine power at the design point and scales with spool
   * speed to this power off design (a drag torque rising with speed), not with turbine power.
   */
  readonly mechanicalLossSpeedExponent: number;
  /**
   * Running tip clearance opens as the rotor's centrifugal growth (proportional to N^2) falls:
   * isentropic efficiency loss k (1 - (N2 / N2_design)^2) for the HPC and the HPT.
   */
  readonly clearanceEfficiencyLoss: { readonly hpc: number; readonly hpt: number };
  /** VBV schedule: maxFraction of the booster flow dumped below openBelow, none above closedAbove (corrected N2, %). */
  readonly vbv: {
    readonly maxFraction: number;
    readonly openBelowN2cPercent: number;
    readonly closedAboveN2cPercent: number;
  };
  /** The part-power mechanisms of D3-11 (PartPowerCalibration); none acts at the design point. */
  readonly partPower: PartPowerCalibration;
}

/**
 * D3-11: part-power mechanisms, each zero at the design point and bounded in src/cycle/partPower.ts
 * (PART_POWER_PARAMETERS, with the reason for each bound; ENGINE_FACTS "Part-power calibration
 * (D3-11)"). tools/cycle/fit-part-power.ts fits them to C10 and C11 together.
 */
export interface PartPowerCalibration {
  /**
   * Fan isentropic efficiency loss (both streams: the core stream keeps its design ratio to the
   * tip) at corrected speeds at or below partSpeedKnee, ramped linearly to zero at design speed.
   * It is the loss at the design efficiency's level; the map efficiency is scaled by
   * (1 - loss / eta_design), so a point that is already poor (near choke) loses in proportion
   * and no efficiency goes negative.
   */
  readonly fanEfficiencyLoss: number;
  /** The same for the booster, on its own corrected speed. */
  readonly boosterEfficiencyLoss: number;
  /** Corrected speed fraction below which the part-speed losses are fully in. */
  readonly partSpeedKnee: number;
  /**
   * LPT Reynolds lapse: at the design efficiency's level (1 - eta) grows by the factor
   * (Re / Re_design)^-n, with Re ~ P45 / (sqrt(T45) mu(T45)) at the turbine inlet (a fixed
   * corrected point); the map efficiency is scaled by the same relative amount.
   */
  readonly lptReynoldsExponent: number;
  /**
   * HPC VSV setting relative to the schedule the HPC map was made with, rad (positive = more
   * closed), piecewise linear in corrected N2 (%) through these knots, constant beyond them.
   */
  readonly vsvOffsetN2cPercent: readonly number[];
  readonly vsvOffsetRad: readonly number[];
  /** Fractional HPC corrected-flow loss per rad of extra closure (vsvFlowSensitivity). */
  readonly vsvFlowLossPerRad: number;
  /** HPC Reynolds lapse exponent, the same form as the LPT's on the HPC inlet (P25, T25). */
  readonly hpcReynoldsExponent: number;
  /**
   * D3-14: combustion efficiency relative to the design point vs corrected fuel flow
   * Wf / (delta2 sqrt(theta2)), kg/s: piecewise linear through the knots, held beyond them.
   * Empty knots: 1 everywhere. The reference engine's knots are the EEDB LTO points
   * (combustionEfficiencyTable).
   */
  readonly combustion: {
    readonly correctedFuelFlowKgPerS: readonly number[];
    readonly relativeEfficiency: readonly number[];
  };
}

const dp = ENGINE_DEFINITION.designPoint;

/** The W0 assumptions exactly as the definition states them (docs/ENGINE_FACTS.md). */
export const W0_CALIBRATION: CycleCalibration = {
  ambient: dp.ambient,
  totalAirflowKgPerS: dp.totalAirflowKgPerS,
  bypassRatio: dp.bypassRatio,
  fanCorePressureRatio: dp.pressureRatios.fanCore,
  boosterPressureRatio: dp.pressureRatios.booster,
  overallPressureRatio: dp.pressureRatios.overall,
  efficiencies: dp.efficiencies,
  combustorPressureLossFraction: dp.combustorPressureLossFraction,
  turbineCoolingFraction: dp.turbineCoolingFraction,
  bypassDuctPtLoss: DESIGN_LOSSES.bypassDuctPtLoss,
  coreNozzlePtLoss: DESIGN_LOSSES.coreNozzlePtLoss,
  mechanicalEfficiency: DESIGN_LOSSES.mechanicalEfficiency,
  fuelLhvJPerKg: factValue('fuelLhv'),
  fuelFlowKgPerS: dp.fuelFlowKgPerS,
  netThrustN: dp.netThrustN,
  n1Rpm: dp.n1Rpm,
  n2Rpm: dp.n2Rpm,
  n1ReferenceRpm: dp.n1Rpm,
  n2ReferenceRpm: dp.n2Rpm,
  egtProbeLptWorkFraction: 0.25,
  groundIdleN2Percent: 61,
  mechanicalLossSpeedExponent: 1,
  clearanceEfficiencyLoss: { hpc: 0, hpt: 0 },
  vbv: { maxFraction: 0, openBelowN2cPercent: 70, closedAboveN2cPercent: 85 },
  partPower: {
    fanEfficiencyLoss: 0,
    boosterEfficiencyLoss: 0,
    partSpeedKnee: 0.875,
    lptReynoldsExponent: 0,
    vsvOffsetN2cPercent: [60, 85, 95],
    vsvOffsetRad: [0, 0, 0],
    vsvFlowLossPerRad: 0,
    hpcReynoldsExponent: 0,
    combustion: { correctedFuelFlowKgPerS: [], relativeEfficiency: [] },
  },
};

/**
 * The calibrated cycle (W0C-I6). Changes from W0_CALIBRATION, each inside the physically
 * plausible range and justified in docs/ENGINE_FACTS.md ("Cycle model calibration (W1)").
 */
export const CYCLE_CALIBRATION: CycleCalibration = {
  ...W0_CALIBRATION,
  // ISA SLS rated takeoff N1 is not published; 101 % reproduces the measured 25 C static run
  // (N2 99.9 % vs 99.8 % measured at N1 97.4 %; 100.3 % with 100 %) and keeps the 30 C corner at
  // 103.4 % N1, under the 104 % TCDS limit.
  n1Rpm: 1.01 * dp.n1Rpm,
  // Effective EGT probe position (D2-3): station 49.5 sits after LPT stage 1 of 4, and stage 1
  // does more than an equal (0.25) share of the LPT work. Fitted to the measured 855 C at N1
  // 97.4 %, OAT 25 C (WIDURI Table 7).
  egtProbeLptWorkFraction: 0.35,
  // W1C-I1, the part-power physics (ENGINE_FACTS "Cycle model calibration (W1)", each with its
  // plausible range). None changes the design point, so C1-C3 and the sizing are unchanged.
  // Drag-type losses: viscous friction torque ~ N gives power ~ N^2 (windage ~ N^3, rolling
  // bearings ~ N^1.5); 2 is the middle.
  mechanicalLossSpeedExponent: 2,
  // ~1 % SFC and ~10 C EGT per 0.010 in of extra HPT tip clearance (Lattime & Steinetz, NASA/TM-
  // 2002-211794); the rotor growth lost between takeoff and idle is a few tenths of a mm, partly
  // offset by the cooler case: 2-4 points at standstill. The upper half (HPC 3, HPT 4 points,
  // about 2 at ground idle) keeps C4's idle N1 inside its range once the duct losses scale with
  // the dynamic head (19.9 % with HPC 2 / HPT 3).
  clearanceEfficiencyLoss: { hpc: 0.03, hpt: 0.04 },
  vbv: {
    maxFraction: factValue('vbvMaxFraction'),
    openBelowN2cPercent: factValue('vbvOpenBelowN2c'),
    closedAboveN2cPercent: factValue('vbvClosedAboveN2c'),
  },
  // D3-11 / D3-14 / D3-15: the part-power mechanisms are implemented but off in the reference
  // calibration; only the EEDB combustion-efficiency table (data, not a fit) acts here. Their
  // bounded fit (PART_POWER_FIT_CALIBRATION below) meets C10, C4 and C11 at climb-out and idle,
  // misses C11 approach (-6.4 %), and was rejected under D3-14's adoption rule because it breaks
  // the transient model: its 33.73(a) ground-idle slam surges and then hangs at about 11 kN
  // (partPower.test.ts pins this). D3-15 accepts the remaining gap (PHYSICS.md ledger). The VSV
  // flow sensitivity is set so that an offset, once fitted, acts.
  partPower: {
    ...W0_CALIBRATION.partPower,
    vsvFlowLossPerRad: vsvFlowSensitivity(ENGINE_DEFINITION),
    combustion: combustionEfficiencyTable(factValue('fuelLhv')),
  },
};

/**
 * D3-11 / D3-14: CYCLE_CALIBRATION with the bounded least-squares part-power fit of
 * tools/cycle/fit-part-power.ts (src/cycle/partPowerFit.ts): the VBV schedule and dump, the HPC
 * VSV offset from the map's schedule, the fan and booster part-speed losses, the LPT and HPC
 * Reynolds lapses, the HPT tip-clearance loss, and the EGT probe share fitted inside [0.25, 0.45].
 * REJECTED under D3-14's adoption rule (it breaks the transient model; see the comment in
 * CYCLE_CALIBRATION), so it is not the reference calibration (D3-15).
 */
export const PART_POWER_FIT_CALIBRATION: CycleCalibration = {
  ...CYCLE_CALIBRATION,
  egtProbeLptWorkFraction: PART_POWER_FIT.egtProbeLptWorkFraction,
  clearanceEfficiencyLoss: {
    ...CYCLE_CALIBRATION.clearanceEfficiencyLoss,
    hpt: PART_POWER_FIT.hptClearanceLoss,
  },
  vbv: {
    maxFraction: PART_POWER_FIT.vbvMaxFraction,
    openBelowN2cPercent: PART_POWER_FIT.vbvOpenBelowN2cPercent,
    closedAboveN2cPercent: PART_POWER_FIT.vbvClosedAboveN2cPercent,
  },
  partPower: {
    ...CYCLE_CALIBRATION.partPower,
    fanEfficiencyLoss: PART_POWER_FIT.fanEfficiencyLoss,
    boosterEfficiencyLoss: PART_POWER_FIT.boosterEfficiencyLoss,
    lptReynoldsExponent: PART_POWER_FIT.lptReynoldsExponent,
    vsvOffsetRad: [PART_POWER_FIT.vsvOffsetLowRad, PART_POWER_FIT.vsvOffsetMidRad, 0],
    hpcReynoldsExponent: PART_POWER_FIT.hpcReynoldsExponent,
  },
};

export interface OperatingConditions {
  readonly ambient: AmbientConditions;
  /** Customer bleed, fraction of HPC inlet flow (leaves at HPC exit). */
  readonly customerBleedFraction: number;
  readonly powerExtractionW: number;
  /**
   * Booster variable bleed valve dump, fraction of booster flow. Default: the FADEC schedule
   * (vbvScheduleFraction); a number overrides it (a stuck or rigged-off valve).
   */
  readonly vbvFraction?: number;
}

/** The scheduled VBV dump, fraction of booster flow, at a corrected N2 (% of the 100 % speed). */
export function vbvScheduleFraction(cal: CycleCalibration, n2CorrectedPercent: number): number {
  const v = cal.vbv;
  const open =
    (v.closedAboveN2cPercent - n2CorrectedPercent) /
    (v.closedAboveN2cPercent - v.openBelowN2cPercent);
  return v.maxFraction * Math.min(1, Math.max(0, open));
}

/** Piecewise linear through (xs, ys), constant beyond the end knots. */
function piecewiseLinear(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= at(xs, 0)) return at(ys, 0);
  for (let i = 1; i < xs.length; i++) {
    const x1 = at(xs, i);
    if (x <= x1) {
      const x0 = at(xs, i - 1);
      return at(ys, i - 1) + ((at(ys, i) - at(ys, i - 1)) * (x - x0)) / (x1 - x0);
    }
  }
  return at(ys, ys.length - 1);
}

/** D3-11: the HPC VSV offset from the map's own schedule at a corrected N2 (%), rad. */
export function vsvOffsetRad(cal: CycleCalibration, n2CorrectedPercent: number): number {
  const pp = cal.partPower;
  return piecewiseLinear(pp.vsvOffsetN2cPercent, pp.vsvOffsetRad, n2CorrectedPercent);
}

/**
 * Fractional loss of HPC corrected flow per rad of extra VSV closure, from the velocity triangle
 * of the inlet guide vane and rotor 1 at mid-span: at a fixed rotor-1 incidence and blade speed U,
 * c_x = U / (tan(beta1) + tan(alpha1)), with alpha1 the IGV exit (pre-swirl) angle and beta1 the
 * rotor-1 inlet angle, so -d ln(c_x) / d alpha1 = sec^2(alpha1) / (tan(beta1) + tan(alpha1)).
 */
export function vsvFlowSensitivity(def: EngineDefinition): number {
  const row = (id: string) => {
    const r = def.bladeRows.find((b) => b.id === id);
    if (r === undefined) throw new Error(`vsvFlowSensitivity: no blade row ${id}`);
    return r;
  };
  const alpha1 = Math.abs(row('hpc-igv').exitMetalAngle.mid);
  const beta1 = Math.abs(row('hpc-r1').inletMetalAngle.mid);
  return 1 / Math.cos(alpha1) ** 2 / (Math.tan(beta1) + Math.tan(alpha1));
}

/**
 * Combustion efficiency from the emission indices (g per kg of fuel): the chemical energy left
 * in the exhaust as CO and unburnt hydrocarbons over the fuel's, the energy balance behind the
 * combustion efficiency of SAE ARP1533: 1 - (EI_CO Q_CO + EI_HC Q_HC) / (1000 Q_fuel), with the
 * hydrocarbons taken at the fuel's own heating value.
 */
export function combustionEfficiencyFromEmissions(
  eiCoGPerKg: number,
  eiHcGPerKg: number,
  fuelLhvJPerKg: number,
): number {
  return (
    1 -
    (eiCoGPerKg * CO_HEATING_VALUE_J_PER_KG + eiHcGPerKg * fuelLhvJPerKg) / (1000 * fuelLhvJPerKg)
  );
}

/**
 * D3-14: the EEDB LTO points as the combustion-efficiency table, relative to takeoff: knots at
 * the databank fuel flows (ISA SLS, so corrected = actual), values the emission-index
 * efficiency over the takeoff one. The design point (the takeoff fuel flow) keeps 1.
 */
export function combustionEfficiencyTable(
  fuelLhvJPerKg: number,
): PartPowerCalibration['combustion'] {
  const modes = [
    ['fuelFlowIdle', 'eiCoIdle', 'eiHcIdle'],
    ['fuelFlowApproach', 'eiCoApproach', 'eiHcApproach'],
    ['fuelFlowClimbOut', 'eiCoClimbOut', 'eiHcClimbOut'],
    ['fuelFlowTakeoff', 'eiCoTakeoff', 'eiHcTakeoff'],
  ] as const;
  const eta = modes.map(([, co, hc]) =>
    combustionEfficiencyFromEmissions(1000 * factValue(co), 1000 * factValue(hc), fuelLhvJPerKg),
  );
  const top = at(eta, eta.length - 1);
  return {
    correctedFuelFlowKgPerS: modes.map(([wf]) => factValue(wf)),
    relativeEfficiency: eta.map((e) => e / top),
  };
}

/**
 * The combustion efficiency eta_b of the gas path at a fuel flow (D3-14: the design efficiency times
 * the EEDB emission-index table at the fuel flow corrected to the fan face; 0 unlit). The flow
 * solver's combustor source takes its heat eta_b W_f LHV from here (PHYSICS.md 3.3 CP2).
 */
export function combustionEfficiency(
  cal: CycleCalibration,
  wfKgPerS: number,
  p2Pa: number,
  t2K: number,
  lit: boolean,
): number {
  if (!lit) return 0;
  const comb = cal.partPower.combustion;
  const wfCorrected = wfKgPerS / (p2Pa / P_STD) / Math.sqrt(t2K / T_STD);
  const etaRel =
    comb.correctedFuelFlowKgPerS.length === 0
      ? 1
      : piecewiseLinear(comb.correctedFuelFlowKgPerS, comb.relativeEfficiency, wfCorrected);
  return cal.efficiencies.combustor * etaRel;
}

/** Part-speed loss ramp: 1 at or below the knee, 0 at or above design speed, linear between. */
function partSpeedRamp(knee: number, speedFraction: number): number {
  return Math.min(1, Math.max(0, (1 - speedFraction) / (1 - knee)));
}

/** Dynamic viscosity of air, Pa s (Sutherland, 1.458e-6 T^1.5 / (T + 110.4)); ratios only. */
export function sutherlandViscosity(tK: number): number {
  return (1.458e-6 * tK ** 1.5) / (tK + 110.4);
}

/** Reynolds number index at a fixed corrected point, up to a constant: P / (sqrt(T) mu(T)). */
export function reynoldsIndex(ptPa: number, ttK: number): number {
  return ptPa / (Math.sqrt(ttK) * sutherlandViscosity(ttK));
}

/** Corrected N2 the FADEC schedules on, % of the 100 % speed (corrected to the inlet T2). */
export function correctedN2Percent(cal: CycleCalibration, n2Rpm: number, t2K: number): number {
  return (100 * n2Rpm) / cal.n2ReferenceRpm / Math.sqrt(t2K / T_STD);
}

export interface MapState<P> {
  readonly point: P;
  readonly speedFraction: number;
}

export interface EnginePoint {
  readonly stations: Readonly<Record<StationId, StationState>>;
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly n1Percent: number;
  readonly n2Percent: number;
  readonly fuelFlowKgPerS: number;
  readonly grossThrustN: number;
  readonly netThrustN: number;
  readonly tsfcKgPerNs: number | null;
  readonly bypassRatio: number;
  readonly overallPressureRatio: number;
  readonly totalAirflowKgPerS: number;
  readonly fan: MapState<CompressorPoint> & { readonly rline: number };
  readonly lpc: MapState<CompressorPoint> & { readonly rline: number };
  readonly hpc: MapState<CompressorPoint> & { readonly rline: number };
  readonly hpt: MapState<TurbinePoint> & { readonly pressureRatio: number };
  readonly lpt: MapState<TurbinePoint> & { readonly pressureRatio: number };
  /** Component powers, W (compressors absorbed, turbines delivered). */
  readonly power: {
    readonly fan: number;
    readonly lpc: number;
    readonly hpc: number;
    readonly hpt: number;
    readonly lpt: number;
  };
  /** Mechanical losses of each spool, W (CycleCalibration.mechanicalLossSpeedExponent). */
  readonly mechanicalLossW: { readonly hp: number; readonly lp: number };
  /** VBV dump, kg/s (booster exit to the bypass duct). */
  readonly vbvFlowKgPerS: number;
  /** D3-11: HPC VSV offset from the map's schedule, rad, and the resulting flow factor. */
  readonly vsvOffsetRad: number;
  readonly hpcVsvFlowFactor: number;
  /** Shaft power surplus after compressors, extraction and mechanical losses, W. */
  readonly netPowerHpW: number;
  readonly netPowerLpW: number;
  readonly coreNozzleChoked: boolean;
  readonly bypassNozzleChoked: boolean;
  /** Energy bookkeeping for C8 (W): flows in and out of the engine control volume. */
  readonly energy: { readonly inW: number; readonly outW: number };
  /** Mass bookkeeping for C8 (kg/s): nozzle-computed exit flows plus bleed. */
  readonly mass: { readonly inKgPerS: number; readonly outKgPerS: number };
  /** The six gas-path residuals (relative). */
  readonly residuals: readonly number[];
}

export interface DesignData {
  readonly point: EnginePoint;
  readonly unknowns: readonly number[];
  readonly fanBypassPressureRatio: number;
  readonly coreNozzleAreaM2: number;
  readonly bypassNozzleAreaM2: number;
  /** Ratios that tie the fan core stream to the fan map (tip) stream. */
  readonly fanCorePrRatio: number;
  readonly fanCoreEffRatio: number;
  /** Design corrected speeds: compressors N / sqrt(Tt / 288.15), turbines N / sqrt(Tt), rpm. */
  readonly corrSpeed: {
    readonly fan: number;
    readonly lpc: number;
    readonly hpc: number;
    readonly hpt: number;
    readonly lpt: number;
  };
  /** Normalisers of the residuals. */
  readonly scale: {
    readonly wcLpc: number;
    readonly wcHpc: number;
    readonly fpHpt: number;
    readonly fpLpt: number;
    readonly wCore: number;
    readonly wBypass: number;
    readonly powerHp: number;
    readonly powerLp: number;
    /** Design W sqrt(Tt) / Pt (SI) of the ducts whose cold loss scales with its square. */
    readonly fpBypassDuct: number;
    readonly fpCoreNozzle: number;
    readonly fpCombustor: number;
    /** Design Reynolds number index of the LPT inlet (reynoldsIndex at P45, T45). */
    readonly reLpt: number;
    /** The same at the HPC inlet (P25, T25). */
    readonly reHpc: number;
  };
}

export interface SizedEngine {
  readonly calibration: CycleCalibration;
  readonly definition: EngineDefinition;
  readonly maps: {
    readonly fan: ScaledCompressorMap;
    readonly lpc: ScaledCompressorMap;
    readonly hpc: ScaledCompressorMap;
    readonly hpt: ScaledTurbineMap;
    readonly lpt: ScaledTurbineMap;
  };
  readonly design: DesignData;
}

// ---------------------------------------------------------------------------------------
// Thermodynamic building blocks

interface Flow {
  readonly tt: number;
  readonly pt: number;
}

function compress(inlet: Flow, pr: number, eff: number): Flow & { readonly dh: number } {
  const h1 = enthalpy(inlet.tt, 0);
  const h2s = enthalpy(isentropicTemperature(inlet.tt, pr, 0), 0);
  const h2 = h1 + (h2s - h1) / eff;
  return { tt: temperatureFromEnthalpy(h2, 0), pt: inlet.pt * pr, dh: h2 - h1 };
}

function expand(inlet: Flow, pr: number, eff: number, far: number): Flow & { readonly dh: number } {
  const h1 = enthalpy(inlet.tt, far);
  const h2s = enthalpy(isentropicTemperature(inlet.tt, 1 / pr, far), far);
  const h2 = h1 - eff * (h1 - h2s);
  return { tt: temperatureFromEnthalpy(h2, far), pt: inlet.pt / pr, dh: h1 - h2 };
}

/** Turbine pressure ratio that extracts dh J/kg at efficiency eff. */
function prForWork(inlet: Flow, dh: number, eff: number, far: number): number {
  const h1 = enthalpy(inlet.tt, far);
  const t2s = temperatureFromEnthalpy(h1 - dh / eff, far);
  return Math.exp((entropyFunction(inlet.tt, far) - entropyFunction(t2s, far)) / gasConstant(far));
}

export interface NozzleState {
  /** Mass flow per unit throat area, kg/(s m^2). */
  readonly flux: number;
  readonly velocity: number;
  readonly staticPressure: number;
  readonly choked: boolean;
}

/** Convergent nozzle, isentropic from (pt, tt) to the throat; thermally perfect. */
export function nozzle(pt: number, tt: number, far: number, pAmb: number): NozzleState {
  if (pt <= pAmb) return { flux: 0, velocity: 0, staticPressure: pAmb, choked: false };
  const r = gasConstant(far);
  const ht = enthalpy(tt, far);
  const st = entropyFunction(tt, far);
  // sonic throat: 2 (ht - h(T*)) = gamma R T*
  let ts = (2 * tt) / (gamma(tt, far) + 1);
  for (let i = 0; i < 30; i++) {
    const g = gamma(ts, far);
    const res = 2 * (ht - enthalpy(ts, far)) - g * r * ts;
    const step = res / ((-2 * (g * r)) / (g - 1) - g * r);
    ts -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  const pStar = pt * Math.exp((entropyFunction(ts, far) - st) / r);
  let t = ts;
  let p = pStar;
  const choked = pStar >= pAmb;
  if (!choked) {
    p = pAmb;
    t = isentropicTemperature(tt, pAmb / pt, far);
  }
  const v = Math.sqrt(Math.max(0, 2 * (ht - enthalpy(t, far))));
  return { flux: (p / (r * t)) * v, velocity: v, staticPressure: p, choked };
}

function freeStream(a: AmbientConditions): Flow & { readonly v0: number; readonly h0t: number } {
  const r = gasConstant(0);
  const v0 = a.machNumber * Math.sqrt(gamma(a.temperatureK, 0) * r * a.temperatureK);
  const h0t = enthalpy(a.temperatureK, 0) + 0.5 * v0 * v0;
  const tt = temperatureFromEnthalpy(h0t, 0);
  const pt =
    a.pressurePa * Math.exp((entropyFunction(tt, 0) - entropyFunction(a.temperatureK, 0)) / r);
  return { tt, pt, v0, h0t };
}

const st = (pt: number, tt: number, w: number, far = 0): StationState => ({
  ptPa: pt,
  ttK: tt,
  wKgPerS: w,
  fuelAirRatio: far,
});

// ---------------------------------------------------------------------------------------
// Gas path

interface PathInputs {
  readonly n1Rpm: number;
  readonly n2Rpm: number;
  readonly wf: number;
  /** Combustor lit: fuel releases eta_b LHV; otherwise it only adds mass at 298.15 K. */
  readonly lit: boolean;
  /** [fan R-line, BPR, booster R-line, HPC R-line, HPT PR, LPT PR]. */
  readonly x: readonly number[];
}

interface DesignTies {
  readonly fanCorePrRatio: number;
  readonly fanCoreEffRatio: number;
  readonly corrSpeed: DesignData['corrSpeed'];
  readonly scale: DesignData['scale'];
  readonly areas: { readonly core: number; readonly bypass: number };
}

function gasPath(
  maps: SizedEngine['maps'],
  ties: DesignTies,
  cal: CycleCalibration,
  c: OperatingConditions,
  inp: PathInputs,
): EnginePoint {
  const rFan = at(inp.x, 0);
  const bpr = at(inp.x, 1);
  const rLpc = at(inp.x, 2);
  const rHpc = at(inp.x, 3);
  const prHpt = at(inp.x, 4);
  const prLpt = at(inp.x, 5);
  const { n1Rpm, n2Rpm, wf } = inp;
  const p0 = c.ambient.pressurePa;
  const f0 = freeStream(c.ambient);
  const s2: Flow = { tt: f0.tt, pt: f0.pt };
  const theta = (t: number) => Math.sqrt(t / T_STD);
  const sc = ties.scale;

  const nFan = n1Rpm / theta(s2.tt) / ties.corrSpeed.fan;
  const pp = cal.partPower;
  // D3-11 part-speed efficiency trends (zero at design speed)
  const fanMap = compressorPoint(maps.fan, nFan, rFan);
  const fan = {
    ...fanMap,
    efficiency:
      fanMap.efficiency *
      (1 -
        (pp.fanEfficiencyLoss * partSpeedRamp(pp.partSpeedKnee, nFan)) /
          cal.efficiencies.fanBypass),
  };
  const w2 = (fan.correctedFlow * (s2.pt / P_STD)) / theta(s2.tt);
  const w13 = (w2 * bpr) / (1 + bpr);
  const w21 = w2 / (1 + bpr);
  const s13 = compress(s2, fan.pressureRatio, fan.efficiency);
  const s21 = compress(
    s2,
    1 + ties.fanCorePrRatio * (fan.pressureRatio - 1),
    fan.efficiency * ties.fanCoreEffRatio,
  );

  const nLpc = n1Rpm / theta(s21.tt) / ties.corrSpeed.lpc;
  const lpcMap = compressorPoint(maps.lpc, nLpc, rLpc);
  const lpc = {
    ...lpcMap,
    efficiency:
      lpcMap.efficiency *
      (1 -
        (pp.boosterEfficiencyLoss * partSpeedRamp(pp.partSpeedKnee, nLpc)) /
          cal.efficiencies.booster),
  };
  const wc21 = (w21 * theta(s21.tt)) / (s21.pt / P_STD);
  const s24 = compress(s21, lpc.pressureRatio, lpc.efficiency);
  const n2c = correctedN2Percent(cal, n2Rpm, s2.tt);
  const vbv = c.vbvFraction ?? vbvScheduleFraction(cal, n2c);
  const wVbv = vbv * w21;
  const w25 = w21 - wVbv;

  const nHpc = n2Rpm / theta(s24.tt) / ties.corrSpeed.hpc;
  // tip clearance opens as the centrifugal growth (~ N^2) falls off design
  const clearance = 1 - (n2Rpm / cal.n2Rpm) ** 2;
  const hpcMap = compressorPoint(maps.hpc, nHpc, rHpc);
  // D3-14: Reynolds lapse of the HPC, the LPT's form on the HPC inlet
  const reHpc = Math.max(1e-3, reynoldsIndex(s24.pt, s24.tt) / sc.reHpc);
  const etaHpcDes = cal.efficiencies.hpc;
  const hpc = {
    ...hpcMap,
    efficiency:
      hpcMap.efficiency *
        (1 - ((1 - etaHpcDes) / etaHpcDes) * (reHpc ** -pp.hpcReynoldsExponent - 1)) -
      cal.clearanceEfficiencyLoss.hpc * clearance,
  };
  const wc25 = (w25 * theta(s24.tt)) / (s24.pt / P_STD);
  // D3-11: a VSV setting off the map's own schedule shifts the speed line in flow. The point and
  // its stall line stay in the map's frame (surge margins, the Greitzer cubic); only the
  // continuity residual sees the physical flow.
  const dVsv = vsvOffsetRad(cal, n2c);
  const vsvFlowFactor = 1 - pp.vsvFlowLossPerRad * dVsv;
  const s3 = compress(s24, hpc.pressureRatio, hpc.efficiency);

  const wBleed = c.customerBleedFraction * w25;
  const wCool = cal.turbineCoolingFraction * w25;
  const wComb = w25 - wBleed - wCool;
  const h3 = enthalpy(s3.tt, 0);
  const far4 = wf / wComb;
  const w4 = wComb + wf;
  const etaB = combustionEfficiency(cal, wf, s2.pt, s2.tt, inp.lit);
  const h4 = (wComb * h3 + etaB * wf * cal.fuelLhvJPerKg) / w4;
  const tt4 = temperatureFromEnthalpy(h4, far4);
  // cold (friction and dump) losses go with the dynamic head, i.e. (W sqrt(Tt) / Pt)^2 (Walsh &
  // Fletcher, Gas Turbine Performance, 2nd ed., 5.10-5.11); capped so that a Newton probe far
  // from the root cannot drive a duct's exit pressure negative
  const coldLoss = (design: number, w: number, tt: number, pt: number, ref: number): number =>
    Math.min(0.5, design * ((w * Math.sqrt(tt)) / pt / ref) ** 2);
  const pt4 =
    s3.pt * (1 - coldLoss(cal.combustorPressureLossFraction, wComb, s3.tt, s3.pt, sc.fpCombustor));
  const w41 = w4 + wCool;
  const far41 = wf / (wComb + wCool);
  const h41 = (w4 * h4 + wCool * h3) / w41;
  const s41: Flow = { tt: temperatureFromEnthalpy(h41, far41), pt: pt4 };

  const nHpt = n2Rpm / Math.sqrt(s41.tt) / ties.corrSpeed.hpt;
  const hptMap = turbinePoint(maps.hpt, nHpt, prHpt);
  const hpt = {
    ...hptMap,
    efficiency: hptMap.efficiency - cal.clearanceEfficiencyLoss.hpt * clearance,
  };
  const fp41 = (w41 * Math.sqrt(s41.tt)) / s41.pt;
  const s45 = expand(s41, prHpt, hpt.efficiency, far41);

  const nLpt = n1Rpm / Math.sqrt(s45.tt) / ties.corrSpeed.lpt;
  const lptMap = turbinePoint(maps.lpt, nLpt, prLpt);
  // D3-11: Reynolds lapse of the LPT (the scaled map holds the design Reynolds number)
  // (floored so that a start from standstill cannot blow the factor up)
  const reRatio = Math.max(1e-3, reynoldsIndex(s45.pt, s45.tt) / sc.reLpt);
  const etaLpt = cal.efficiencies.lpt;
  const lpt = {
    ...lptMap,
    efficiency:
      lptMap.efficiency * (1 - ((1 - etaLpt) / etaLpt) * (reRatio ** -pp.lptReynoldsExponent - 1)),
  };
  const fp45 = (w41 * Math.sqrt(s45.tt)) / s45.pt;
  const s5 = expand(s45, prLpt, lpt.efficiency, far41);

  // EGT probe after the calibrated share of LPT work, same stage efficiency
  const h45 = h41 - s45.dh;
  const h495 = h45 - cal.egtProbeLptWorkFraction * s5.dh;
  const tt495 = temperatureFromEnthalpy(h495, far41);
  const t495s = temperatureFromEnthalpy(h45 - (h45 - h495) / Math.max(lpt.efficiency, 1e-6), far41);
  const pt495 =
    s45.pt *
    Math.exp((entropyFunction(t495s, far41) - entropyFunction(s45.tt, far41)) / gasConstant(far41));

  const pt8 = s5.pt * (1 - coldLoss(cal.coreNozzlePtLoss, w41, s5.tt, s5.pt, sc.fpCoreNozzle));
  const n8 = nozzle(pt8, s5.tt, far41, p0);
  const w8 = n8.flux * ties.areas.core;

  const w18 = w13 + wVbv;
  const h13 = enthalpy(s13.tt, 0);
  const h24 = enthalpy(s24.tt, 0);
  const h18 = w18 > 0 ? (w13 * h13 + wVbv * h24) / w18 : h13;
  const tt18 = temperatureFromEnthalpy(h18, 0);
  const pt18 = s13.pt * (1 - coldLoss(cal.bypassDuctPtLoss, w13, s13.tt, s13.pt, sc.fpBypassDuct));
  const n18 = nozzle(pt18, tt18, 0, p0);
  const w18n = n18.flux * ties.areas.bypass;

  const fg =
    w41 * n8.velocity +
    (n8.staticPressure - p0) * ties.areas.core +
    w18 * n18.velocity +
    (n18.staticPressure - p0) * ties.areas.bypass;
  const fn = fg - w2 * f0.v0;

  const power = {
    fan: w13 * s13.dh + w21 * s21.dh,
    lpc: w21 * s24.dh,
    hpc: w25 * s3.dh,
    hpt: w41 * s45.dh,
    lpt: w41 * s5.dh,
  };
  // the design loss is (1 - eta_m) of the turbine power, i.e. (1 / eta_m - 1) of the compressor
  // power the sizing balanced; off design it follows the spool speed
  const lossAt = (designCompressorW: number, speedRatio: number): number =>
    (1 / cal.mechanicalEfficiency - 1) *
    designCompressorW *
    speedRatio ** cal.mechanicalLossSpeedExponent;
  const mechanicalLossW = {
    hp: lossAt(sc.powerHp, n2Rpm / cal.n2Rpm),
    lp: lossAt(sc.powerLp, n1Rpm / cal.n1Rpm),
  };
  const netPowerHpW = power.hpt - mechanicalLossW.hp - power.hpc - c.powerExtractionW;
  const netPowerLpW = power.lpt - mechanicalLossW.lp - power.fan - power.lpc;
  const h5 = h45 - s5.dh;
  const residuals = [
    (lpc.correctedFlow - wc21) / sc.wcLpc,
    (hpc.correctedFlow * vsvFlowFactor - wc25) / sc.wcHpc,
    (hpt.flowParameter - fp41) / sc.fpHpt,
    (lpt.flowParameter - fp45) / sc.fpLpt,
    (w8 - w41) / sc.wCore,
    (w18n - w18) / sc.wBypass,
  ];

  const stations: Record<StationId, StationState> = {
    '0': st(f0.pt, f0.tt, w2),
    '1': st(s2.pt, s2.tt, w2),
    '2': st(s2.pt, s2.tt, w2),
    '13': st(s13.pt, s13.tt, w13),
    '18': st(pt18, tt18, w18),
    '19': st(pt18, tt18, w18),
    '21': st(s21.pt, s21.tt, w21),
    '24': st(s24.pt, s24.tt, w21),
    '25': st(s24.pt, s24.tt, w25),
    '3': st(s3.pt, s3.tt, w25),
    '4': st(pt4, tt4, w4, far4),
    '41': st(s41.pt, s41.tt, w41, far41),
    '45': st(s45.pt, s45.tt, w41, far41),
    '49.5': st(pt495, tt495, w41, far41),
    '5': st(s5.pt, s5.tt, w41, far41),
    '8': st(pt8, s5.tt, w41, far41),
    '9': st(pt8, s5.tt, w41, far41),
  };
  return {
    stations,
    n1Rpm,
    n2Rpm,
    n1Percent: (100 * n1Rpm) / cal.n1ReferenceRpm,
    n2Percent: (100 * n2Rpm) / cal.n2ReferenceRpm,
    fuelFlowKgPerS: wf,
    grossThrustN: fg,
    netThrustN: fn,
    tsfcKgPerNs: fn > 0 ? wf / fn : null,
    bypassRatio: w13 / w21,
    overallPressureRatio: s3.pt / s2.pt,
    totalAirflowKgPerS: w2,
    fan: { point: fan, speedFraction: nFan, rline: rFan },
    lpc: { point: lpc, speedFraction: nLpc, rline: rLpc },
    hpc: { point: hpc, speedFraction: nHpc, rline: rHpc },
    hpt: { point: hpt, speedFraction: nHpt, pressureRatio: prHpt },
    lpt: { point: lpt, speedFraction: nLpt, pressureRatio: prLpt },
    power,
    mechanicalLossW,
    vbvFlowKgPerS: wVbv,
    vsvOffsetRad: dVsv,
    hpcVsvFlowFactor: vsvFlowFactor,
    netPowerHpW,
    netPowerLpW,
    coreNozzleChoked: n8.choked,
    bypassNozzleChoked: n18.choked,
    energy: {
      inW: w2 * f0.h0t + etaB * wf * cal.fuelLhvJPerKg,
      outW:
        w8 * h5 +
        w18n * h18 +
        wBleed * h3 +
        mechanicalLossW.hp +
        mechanicalLossW.lp +
        c.powerExtractionW,
    },
    mass: { inKgPerS: w2 + wf, outKgPerS: w8 + w18n + wBleed },
    residuals,
  };
}

// ---------------------------------------------------------------------------------------
// Design-point sizing (D1-2)

interface DesignCycle {
  readonly fpr: number;
  readonly thrust: number;
  readonly ties: DesignTies;
  readonly comp: {
    readonly fan: { wc: number; pr: number; eff: number };
    readonly lpc: { wc: number; pr: number; eff: number };
    readonly hpc: { wc: number; pr: number; eff: number };
  };
  readonly turb: {
    readonly hpt: { fp: number; pr: number; eff: number };
    readonly lpt: { fp: number; pr: number; eff: number };
  };
}

function designCycle(cal: CycleCalibration, fpr: number): DesignCycle {
  const e = cal.efficiencies;
  const f0 = freeStream(cal.ambient);
  const p0 = cal.ambient.pressurePa;
  const s2: Flow = { tt: f0.tt, pt: f0.pt };
  const w2 = cal.totalAirflowKgPerS;
  const w13 = (w2 * cal.bypassRatio) / (1 + cal.bypassRatio);
  const w21 = w2 / (1 + cal.bypassRatio);
  const s13 = compress(s2, fpr, e.fanBypass);
  const s21 = compress(s2, cal.fanCorePressureRatio, e.fanCore);
  const s24 = compress(s21, cal.boosterPressureRatio, e.booster);
  const prHpc = cal.overallPressureRatio / (cal.fanCorePressureRatio * cal.boosterPressureRatio);
  const s3 = compress(s24, prHpc, e.hpc);
  const wCool = cal.turbineCoolingFraction * w21;
  const wComb = w21 - wCool;
  const wf = cal.fuelFlowKgPerS;
  const h3 = enthalpy(s3.tt, 0);
  const h4 = (wComb * h3 + e.combustor * wf * cal.fuelLhvJPerKg) / (wComb + wf);
  const w41 = wComb + wf + wCool;
  const far41 = wf / (wComb + wCool);
  const h41 = ((wComb + wf) * h4 + wCool * h3) / w41;
  const s41: Flow = {
    tt: temperatureFromEnthalpy(h41, far41),
    pt: s3.pt * (1 - cal.combustorPressureLossFraction),
  };
  const pHpc = w21 * s3.dh;
  const pLp = w13 * s13.dh + w21 * (s21.dh + s24.dh);
  const etaM = cal.mechanicalEfficiency;
  const prHpt = prForWork(s41, pHpc / (etaM * w41), e.hpt, far41);
  const s45 = expand(s41, prHpt, e.hpt, far41);
  const prLpt = prForWork(s45, pLp / (etaM * w41), e.lpt, far41);
  const s5 = expand(s45, prLpt, e.lpt, far41);
  const n8 = nozzle(s5.pt * (1 - cal.coreNozzlePtLoss), s5.tt, far41, p0);
  const n18 = nozzle(s13.pt * (1 - cal.bypassDuctPtLoss), s13.tt, 0, p0);
  const a8 = w41 / n8.flux;
  const a18 = w13 / n18.flux;
  const thrust =
    w41 * n8.velocity +
    (n8.staticPressure - p0) * a8 +
    w13 * n18.velocity +
    (n18.staticPressure - p0) * a18 -
    w2 * f0.v0;
  const th = (t: number) => Math.sqrt(t / T_STD);
  return {
    fpr,
    thrust,
    ties: {
      fanCorePrRatio: (cal.fanCorePressureRatio - 1) / (fpr - 1),
      fanCoreEffRatio: e.fanCore / e.fanBypass,
      corrSpeed: {
        fan: cal.n1Rpm / th(s2.tt),
        lpc: cal.n1Rpm / th(s21.tt),
        hpc: cal.n2Rpm / th(s24.tt),
        hpt: cal.n2Rpm / Math.sqrt(s41.tt),
        lpt: cal.n1Rpm / Math.sqrt(s45.tt),
      },
      scale: {
        wcLpc: (w21 * th(s21.tt)) / (s21.pt / P_STD),
        wcHpc: (w21 * th(s24.tt)) / (s24.pt / P_STD),
        fpHpt: (w41 * Math.sqrt(s41.tt)) / s41.pt,
        fpLpt: (w41 * Math.sqrt(s45.tt)) / s45.pt,
        wCore: w41,
        wBypass: w13,
        powerHp: pHpc,
        powerLp: pLp,
        fpBypassDuct: (w13 * Math.sqrt(s13.tt)) / s13.pt,
        fpCoreNozzle: (w41 * Math.sqrt(s5.tt)) / s5.pt,
        fpCombustor: (wComb * Math.sqrt(s3.tt)) / s3.pt,
        reLpt: reynoldsIndex(s45.pt, s45.tt),
        reHpc: reynoldsIndex(s24.pt, s24.tt),
      },
      areas: { core: a8, bypass: a18 },
    },
    comp: {
      fan: { wc: (w2 * th(s2.tt)) / (s2.pt / P_STD), pr: fpr, eff: e.fanBypass },
      lpc: {
        wc: (w21 * th(s21.tt)) / (s21.pt / P_STD),
        pr: cal.boosterPressureRatio,
        eff: e.booster,
      },
      hpc: { wc: (w21 * th(s24.tt)) / (s24.pt / P_STD), pr: prHpc, eff: e.hpc },
    },
    turb: {
      hpt: { fp: (w41 * Math.sqrt(s41.tt)) / s41.pt, pr: prHpt, eff: e.hpt },
      lpt: { fp: (w41 * Math.sqrt(s45.tt)) / s45.pt, pr: prLpt, eff: e.lpt },
    },
  };
}

/**
 * Sizes the engine at the calibration's design point: the fan bypass pressure ratio is found
 * (secant) so that net thrust equals cal.netThrustN at cal.fuelFlowKgPerS; the nozzle areas and
 * the map scalars follow. Pure and deterministic.
 */
export function sizeEngine(cal: CycleCalibration, definition: EngineDefinition): SizedEngine {
  const tolerance = 1e-9 * cal.netThrustN;
  const miss = (fpr: number): number => {
    try {
      return designCycle(cal, fpr).thrust - cal.netThrustN;
    } catch (err) {
      throw new Error(`sizing: the design cycle failed at fan PR ${fpr}: ${String(err)}`, {
        cause: err,
      });
    }
  };
  let a = 1.5;
  let b = 1.6;
  let fa = miss(a);
  let fb = miss(b);
  for (let i = 0; i < 40 && Math.abs(fb) > tolerance; i++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    a = b;
    fa = fb;
    b = c;
    fb = miss(b);
  }
  // W1C-N3: an unreachable thrust (or a NaN) must not come back as a sized engine
  if (!(Math.abs(fb) <= tolerance)) {
    throw new Error(
      `sizing: no fan pressure ratio gives ${cal.netThrustN} N (last miss ${fb} N at fan PR ${b})`,
    );
  }
  const d = designCycle(cal, b);
  const maps = {
    fan: scaleCompressorMap(FAN_MAP, {
      correctedFlow: d.comp.fan.wc,
      pressureRatio: d.comp.fan.pr,
      efficiency: d.comp.fan.eff,
    }),
    lpc: scaleCompressorMap(LPC_MAP, {
      correctedFlow: d.comp.lpc.wc,
      pressureRatio: d.comp.lpc.pr,
      efficiency: d.comp.lpc.eff,
    }),
    hpc: scaleCompressorMap(HPC_MAP, {
      correctedFlow: d.comp.hpc.wc,
      pressureRatio: d.comp.hpc.pr,
      efficiency: d.comp.hpc.eff,
    }),
    hpt: scaleTurbineMap(HPT_MAP, {
      flowParameter: d.turb.hpt.fp,
      pressureRatio: d.turb.hpt.pr,
      efficiency: d.turb.hpt.eff,
    }),
    lpt: scaleTurbineMap(LPT_MAP, {
      flowParameter: d.turb.lpt.fp,
      pressureRatio: d.turb.lpt.pr,
      efficiency: d.turb.lpt.eff,
    }),
  };
  const unknowns = [
    FAN_MAP.design.rline,
    cal.bypassRatio,
    LPC_MAP.design.rline,
    HPC_MAP.design.rline,
    d.turb.hpt.pr,
    d.turb.lpt.pr,
    1,
    1,
    1,
  ];
  const conditions = { ambient: cal.ambient, customerBleedFraction: 0, powerExtractionW: 0 };
  const point = gasPath(maps, d.ties, cal, conditions, {
    n1Rpm: cal.n1Rpm,
    n2Rpm: cal.n2Rpm,
    wf: cal.fuelFlowKgPerS,
    lit: true,
    x: unknowns.slice(0, 6),
  });
  return {
    calibration: cal,
    definition,
    maps,
    design: {
      point,
      unknowns,
      fanBypassPressureRatio: d.fpr,
      coreNozzleAreaM2: d.ties.areas.core,
      bypassNozzleAreaM2: d.ties.areas.bypass,
      fanCorePrRatio: d.ties.fanCorePrRatio,
      fanCoreEffRatio: d.ties.fanCoreEffRatio,
      corrSpeed: d.ties.corrSpeed,
      scale: d.ties.scale,
    },
  };
}

const tiesOf = (e: SizedEngine): DesignTies => ({
  ...e.design,
  areas: { core: e.design.coreNozzleAreaM2, bypass: e.design.bypassNozzleAreaM2 },
});

/** Gas-path evaluations so far (in this realm); see gasPathEvaluations. */
let evaluations = 0;

/**
 * D4-84: how many times the gas path has been evaluated so far. The held retry meters its per-step
 * work with it: a deterministic count, so the model stays free of the wall clock, and close to the
 * CPU time, since the evaluation dominates a solve (6 finite differences and the line search per
 * Newton iteration). Read it as a difference.
 */
export function gasPathEvaluations(): number {
  return evaluations;
}

/** One evaluation of the gas path at given speeds, fuel flow and the six gas unknowns. */
export function evaluateGasPath(
  e: SizedEngine,
  c: OperatingConditions,
  n1Rpm: number,
  n2Rpm: number,
  wf: number,
  x: readonly number[],
  lit = true,
): EnginePoint {
  evaluations++;
  return gasPath(e.maps, tiesOf(e), e.calibration, c, { n1Rpm, n2Rpm, wf, lit, x });
}

/** C7 tolerance with a margin: the matching converges to max |residual| below this. */
export const MATCH_TOLERANCE = 1e-10;
/** Per-iteration step caps: R-lines, BPR, R-lines, turbine PRs, N1/N1des, N2/N2des, Wf/Wfdes. */
const MAX_STEP = [0.3, 0.6, 0.3, 0.3, 0.3, 0.3, 0.04, 0.04, 0.2];
/** C7's iteration budget (PHYSICS.md: at most 25). */
export const MAX_NEWTON_ITERATIONS = 25;

export interface GasPathSolution {
  readonly point: EnginePoint;
  readonly x: readonly number[];
  readonly iterations: number;
  readonly converged: boolean;
  readonly maxResidual: number;
  /** D4-84: stopped by its control between Newton iterations, to be resumed from x. */
  readonly stopped?: boolean;
}

/** D4-84: how a budgeted caller drives one gas-path solve. */
export interface SolveControl {
  /** Asked before each Newton iteration; true stops the solve there. */
  readonly stop?: () => boolean;
  /** The iteration limit (default C7's MAX_NEWTON_ITERATIONS); a resumed solve gets what is left. */
  readonly maxIterations?: number;
}

/** Solves the six gas-path residuals at given speeds and fuel flow (the transient's inner loop). */
export function solveGasPath(
  e: SizedEngine,
  c: OperatingConditions,
  n1Rpm: number,
  n2Rpm: number,
  wf: number,
  guess: readonly number[],
  lit = true,
  control: SolveControl = {},
): GasPathSolution {
  const r = newton(
    (x) => [...evaluateGasPath(e, c, n1Rpm, n2Rpm, wf, x, lit).residuals],
    guess.slice(0, 6),
    {
      tolerance: MATCH_TOLERANCE,
      maxIterations: control.maxIterations ?? MAX_NEWTON_ITERATIONS,
      maxStep: MAX_STEP.slice(0, 6),
      stop: control.stop,
    },
  );
  return {
    point: evaluateGasPath(e, c, n1Rpm, n2Rpm, wf, r.x, lit),
    x: r.x,
    iterations: r.iterations,
    converged: r.converged,
    maxResidual: r.maxResidual,
    stopped: r.stopped,
  };
}

export type SteadySpec =
  | { readonly kind: 'fuelFlow'; readonly value: number }
  | { readonly kind: 'n1Percent'; readonly value: number }
  | { readonly kind: 'n2Percent'; readonly value: number }
  | { readonly kind: 'netThrust'; readonly value: number };

export interface SteadySolution {
  readonly point: EnginePoint;
  /** [6 gas unknowns, N1/N1des, N2/N2des, Wf/Wfdes]: a warm start for the next solve. */
  readonly unknowns: readonly number[];
  readonly iterations: number;
  readonly converged: boolean;
  readonly maxResidual: number;
}

function specResidual(e: SizedEngine, p: EnginePoint, spec: SteadySpec): number {
  switch (spec.kind) {
    case 'fuelFlow':
      return (p.fuelFlowKgPerS - spec.value) / e.calibration.fuelFlowKgPerS;
    case 'n1Percent':
      return (p.n1Percent - spec.value) / 100;
    case 'n2Percent':
      return (p.n2Percent - spec.value) / 100;
    case 'netThrust':
      return (p.netThrustN - spec.value) / e.calibration.netThrustN;
  }
}

/** Steady (shaft-balanced) operating point meeting one specification. */
export function solveSteady(
  e: SizedEngine,
  c: OperatingConditions,
  spec: SteadySpec,
  guess: readonly number[] = e.design.unknowns,
): SteadySolution {
  const cal = e.calibration;
  const pointAt = (x: readonly number[]): EnginePoint =>
    evaluateGasPath(
      e,
      c,
      at(x, 6) * cal.n1Rpm,
      at(x, 7) * cal.n2Rpm,
      at(x, 8) * cal.fuelFlowKgPerS,
      x,
    );
  const r = newton(
    (x) => {
      const p = pointAt(x);
      return [
        ...p.residuals,
        p.netPowerHpW / e.design.scale.powerHp,
        p.netPowerLpW / e.design.scale.powerLp,
        specResidual(e, p, spec),
      ];
    },
    guess,
    { tolerance: MATCH_TOLERANCE, maxIterations: MAX_NEWTON_ITERATIONS, maxStep: MAX_STEP },
  );
  return {
    point: pointAt(r.x),
    unknowns: r.x,
    iterations: r.iterations,
    converged: r.converged,
    maxResidual: r.maxResidual,
  };
}

/** N1 steps (%) of the continuation from the design point down to ground idle. */
const IDLE_PATH = [90, 75, 60, 45, 35, 28, 24];

/** Stabilised ground idle (the FADEC N2 floor), reached by continuation from the design point. */
export function groundIdle(e: SizedEngine, c: OperatingConditions): SteadySolution {
  let s = solveSteady(e, c, { kind: 'fuelFlow', value: e.calibration.fuelFlowKgPerS });
  for (const n1 of IDLE_PATH) s = solveSteady(e, c, { kind: 'n1Percent', value: n1 }, s.unknowns);
  return solveSteady(
    e,
    c,
    { kind: 'n2Percent', value: e.calibration.groundIdleN2Percent },
    s.unknowns,
  );
}

/** C8: relative mass and energy imbalance of the whole engine (nozzle-computed exit flows). */
export function balances(p: EnginePoint): { readonly mass: number; readonly energy: number } {
  return {
    mass: (p.mass.inKgPerS - p.mass.outKgPerS) / p.mass.inKgPerS,
    energy: (p.energy.inW - p.energy.outW) / p.energy.inW,
  };
}

/** FADEC display shunt (TCDS E.004 IV.1.1): ramps in linearly between the two N2 speeds. */
export function egtShunt(def: EngineDefinition, n2Rpm: number): number {
  const s = def.limits.egtShunt;
  const k = (n2Rpm - s.rampStartN2Rpm) / (s.fullN2Rpm - s.rampStartN2Rpm);
  return s.offsetK * Math.min(1, Math.max(0, k));
}

/** Cockpit EGT: T49.5 plus the display shunt, K. */
export function displayedEgt(e: SizedEngine, p: EnginePoint): number {
  return p.stations['49.5'].ttK + egtShunt(e.definition, p.n2Rpm);
}

/** Surge margins of the fan and the HPC at a point. */
export function surgeMargins(
  e: SizedEngine,
  p: EnginePoint,
): { readonly fan: number; readonly hpc: number } {
  return { fan: surgeMargin(e.maps.fan, p.fan.point), hpc: surgeMargin(e.maps.hpc, p.hpc.point) };
}

/** Sanity: the ISA gas constant the contracts use differs from the thermo mixture by < 1e-4. */
export const R_MISMATCH = Math.abs(gasConstant(0) / R_AIR - 1);

let reference: SizedEngine | undefined;

/**
 * The reference engine: CYCLE_CALIBRATION sized on the reference definition, built on first use
 * and memoized (D2-15: sizing at import made every sizing mutant "static" for Stryker, so each
 * one reran the whole suite).
 */
export function referenceEngine(): SizedEngine {
  reference ??= sizeEngine(CYCLE_CALIBRATION, ENGINE_DEFINITION);
  return reference;
}
