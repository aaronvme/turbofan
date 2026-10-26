// D3-11: the part-power calibration. The mechanisms are physically real and each is bounded to a
// plausible range with a stated reason (PART_POWER_PARAMETERS; the sources are in
// docs/ENGINE_FACTS.md, "Part-power calibration (D3-11)"). They are fitted to both datasets at
// once, never to a single point: the measured ground run of C10 ([WIDURI] Table 7: N2 and the
// displayed EGT at idle, MPA and takeoff) and the EEDB LTO fuel flows of C11 (7 / 30 / 85 %
// rated thrust, ISA SLS test bed), with C4's ISA ground idle as a guard. Every residual is
// normalised by its threshold's tolerance (thresholds.ts), so a residual of 1 sits on the edge.
//
// tools/cycle/fit-part-power.ts runs the bounded least-squares fit (boundedLeastSquares.ts) and
// writes src/cycle/partPowerFit.ts, which CYCLE_CALIBRATION reads; partPower.test.ts checks
// that the written values are the fit's bounded optimum. None of the mechanisms acts at the
// design point, so the sizing (C1-C3) does not depend on them.

import { ISA_SLS } from '../contracts/ambient';
import { THRESHOLDS } from '../contracts/thresholds';
import { factValue } from '../engine/facts';
import { enthalpy } from '../thermo/gas';
import {
  displayedEgt,
  egtShunt,
  groundIdle,
  solveSteady,
  type CycleCalibration,
  type OperatingConditions,
  type SizedEngine,
  type SteadySolution,
} from './engine';
import { at } from './at';

export type PartPowerParameterId =
  | 'fanEfficiencyLoss'
  | 'boosterEfficiencyLoss'
  | 'lptReynoldsExponent'
  | 'vbvMaxFraction'
  | 'vbvOpenBelowN2cPercent'
  | 'vbvClosedAboveN2cPercent'
  | 'vsvOffsetLowRad'
  | 'vsvOffsetMidRad';

export interface PartPowerParameter {
  readonly id: PartPowerParameterId;
  readonly lower: number;
  readonly upper: number;
  readonly unit: string;
  /** Why the range is plausible (the full reasoning and sources are in ENGINE_FACTS). */
  readonly reason: string;
}

/** The fitted parameters and their bounds, set before the fit was run. */
export const PART_POWER_PARAMETERS: readonly PartPowerParameter[] = [
  {
    id: 'fanEfficiencyLoss',
    lower: 0.032,
    upper: 0.042,
    unit: '1',
    reason:
      'NASA SDT R4 fan (NASA/TM-2005-211681 Table 3) falls 0.8-1.2 points from 100 % to 87.5 % speed and 1.8-2.6 points to 61.7 %, where the scaled pyCycle map rises 3.1 and 1.4 points: matching it takes a 3.2-4.2 point loss',
  },
  {
    id: 'boosterEfficiencyLoss',
    lower: 0,
    upper: 0.042,
    unit: '1',
    reason:
      'no booster part-speed data found: from the map as it is (0) up to the fan falloff (the booster turns with the fan on the LP shaft)',
  },
  {
    id: 'lptReynoldsExponent',
    lower: 0,
    upper: 0.2,
    unit: '1',
    reason:
      'turbine loss ~ Re^-0.2 (Ainley and Mathieson, ARC R&M 2974; Dunham and Came 1970) applied to the whole (1 - eta) is the upper end; 0 is a Reynolds-insensitive turbine',
  },
  {
    id: 'vbvMaxFraction',
    lower: 0.1,
    upper: 0.3,
    unit: '1',
    reason:
      'up to the dump that puts the ISA ground-idle booster on the choke edge of its map (R-line 2.92 at 0.30); at least enough to move it well off its stall line (R-line 1.60 with the VBV shut, 1.94 at 0.10)',
  },
  {
    id: 'vbvOpenBelowN2cPercent',
    lower: 61,
    upper: 75,
    unit: '%',
    reason:
      'fully open at ground idle (61 % N2c), as the QAR record shows on the ground (Yan Tan 2019); at most 5 points under the lowest closing speed',
  },
  {
    id: 'vbvClosedAboveN2cPercent',
    lower: 80,
    upper: 95,
    unit: '%',
    reason:
      'closed in climb and cruise (QAR, Yan Tan 2019; model cruise N2c 98 %), partly open in descent (QAR; model N2c 78-88 % at 35,000 ft, N1 50-70 %)',
  },
  {
    id: 'vsvOffsetLowRad',
    lower: -0.105,
    upper: 0.105,
    unit: 'rad',
    reason:
      'the HPC map schedule vs this engine at and below 60 % N2c: within the 6 deg IGV mis-rig that Tsalavoutas et al. (ASME GT2000-0033) implant as a detectable fault',
  },
  {
    id: 'vsvOffsetMidRad',
    lower: -0.105,
    upper: 0.105,
    unit: 'rad',
    reason: 'the same at 85 % N2c (the offset is 0 at and above 95 %, where the VSVs are open)',
  },
];

/** The fitted parameters of a calibration, in PART_POWER_PARAMETERS order. */
export function partPowerVector(cal: CycleCalibration): number[] {
  const pp = cal.partPower;
  return [
    pp.fanEfficiencyLoss,
    pp.boosterEfficiencyLoss,
    pp.lptReynoldsExponent,
    cal.vbv.maxFraction,
    cal.vbv.openBelowN2cPercent,
    cal.vbv.closedAboveN2cPercent,
    at(pp.vsvOffsetRad, 0),
    at(pp.vsvOffsetRad, 1),
  ];
}

/** A calibration with the fitted parameters x (PART_POWER_PARAMETERS order). */
export function withPartPower(cal: CycleCalibration, x: readonly number[]): CycleCalibration {
  if (x.length !== PART_POWER_PARAMETERS.length) {
    throw new Error(`withPartPower: ${x.length} values for ${PART_POWER_PARAMETERS.length}`);
  }
  return {
    ...cal,
    vbv: {
      maxFraction: at(x, 3),
      openBelowN2cPercent: at(x, 4),
      closedAboveN2cPercent: at(x, 5),
    },
    partPower: {
      ...cal.partPower,
      fanEfficiencyLoss: at(x, 0),
      boosterEfficiencyLoss: at(x, 1),
      lptReynoldsExponent: at(x, 2),
      vsvOffsetRad: [at(x, 6), at(x, 7), 0],
    },
  };
}

/**
 * The sized engine with another part-power calibration. Valid because none of the part-power
 * mechanisms acts at the design point: re-sizing would give the same maps and design data.
 */
export function withCalibration(e: SizedEngine, cal: CycleCalibration): SizedEngine {
  return { ...e, calibration: cal };
}

export interface PartPowerPoint {
  readonly id: string;
  /** 'map': the booster must stay on its map (BOOSTER_RLINE_LIMIT). */
  readonly threshold: 'C4' | 'C10' | 'C11' | 'map';
  readonly model: number;
  /** The measured or published value (C4: the range edge that is nearest). */
  readonly target: number;
  readonly unit: string;
  /** (model - target) / tolerance; for C4 zero inside the published range. */
  readonly residual: number;
}

export interface PartPowerEvaluation {
  readonly converged: boolean;
  readonly points: readonly PartPowerPoint[];
}

const C10 = THRESHOLDS.C10.values;
const C11 = THRESHOLDS.C11.values;
const K = 273.15;

/** The C10 ground-run conditions (ENGINE_FACTS "Ground-run loads"). */
export const GROUND_RUN: OperatingConditions = {
  ambient: {
    temperatureK: factValue('runUpOat'),
    pressurePa: factValue('runUpPressure'),
    machNumber: 0,
  },
  customerBleedFraction: factValue('groundRunCustomerBleed'),
  powerExtractionW: factValue('groundRunAccessoryLoad'),
};

/** The C11 test bed: ISA SLS, no bleed, no power extraction ([EEDB]). */
export const TEST_BED: OperatingConditions = {
  ambient: ISA_SLS,
  customerBleedFraction: 0,
  powerExtractionW: 0,
};

const C10_POINTS = [
  { id: 'takeoff', n1: 'staticTakeoffN1', n2: 'staticTakeoffN2', egt: 'staticTakeoffEgt' },
  { id: 'MPA', n1: 'mpaN1', n2: 'mpaN2', egt: 'mpaEgt' },
  { id: 'idle position 2', n1: 'idleN1High', n2: 'idleN2High', egt: 'range' },
  { id: 'idle position 1', n1: 'idleN1Low', n2: 'idleN2Low', egt: 'range' },
] as const;
const idleEgtLow = factValue('idleEgtLow');
const idleEgtHigh = factValue('idleEgtHigh');

const C11_POINTS = [
  { id: 'climb-out', pct: C11.climbOutThrustPercent.value, wf: 'fuelFlowClimbOut' },
  { id: 'approach', pct: C11.approachThrustPercent.value, wf: 'fuelFlowApproach' },
  { id: 'idle', pct: C11.idleThrustPercent.value, wf: 'fuelFlowIdle' },
] as const;

/** Continuation steps (N1 %, thrust %) from the design point down to the fitted points. */
const N1_PATH = [90, 80, 70, 55, 45, 35, 28, 24];
const THRUST_PATH = [92, 70, 50, 40, 20, 14, 10];

/**
 * The booster map ends at R-line 3.0 on its choke side, where its efficiency at low speed falls
 * to zero; beyond it the model would be extrapolating. Every fitted point keeps 0.1 inside.
 */
export const BOOSTER_RLINE_LIMIT = 2.9;

/** Solves every C10, C11 and C4 point of the fit (continuation from the design point). */
export function evaluatePartPower(e: SizedEngine): PartPowerEvaluation {
  const points: PartPowerPoint[] = [];
  let converged = true;
  let boosterRline = 0;
  const step = (s: SteadySolution): SteadySolution => {
    converged &&= s.converged;
    return s;
  };
  const fitted = (s: SteadySolution): SteadySolution => {
    boosterRline = Math.max(boosterRline, s.point.lpc.rline);
    return step(s);
  };

  const rated = factValue('eedbRatedThrust');
  let s = step(solveSteady(e, TEST_BED, { kind: 'fuelFlow', value: e.calibration.fuelFlowKgPerS }));
  for (const p of C11_POINTS) {
    for (const pct of THRUST_PATH) {
      if (pct < (100 * s.point.netThrustN) / rated && pct > p.pct) {
        s = step(
          solveSteady(e, TEST_BED, { kind: 'netThrust', value: (pct / 100) * rated }, s.unknowns),
        );
      }
    }
    s = fitted(
      solveSteady(e, TEST_BED, { kind: 'netThrust', value: (p.pct / 100) * rated }, s.unknowns),
    );
    const target = factValue(p.wf);
    const model = s.point.fuelFlowKgPerS;
    points.push({
      id: `C11 ${p.id} fuel flow`,
      threshold: 'C11',
      model,
      target,
      unit: 'kg/s',
      residual: (model / target - 1) / C11.maxRelativeError.value,
    });
  }

  s = step(solveSteady(e, GROUND_RUN, { kind: 'fuelFlow', value: e.calibration.fuelFlowKgPerS }));
  for (const p of C10_POINTS) {
    const n1 = factValue(p.n1);
    for (const k of N1_PATH) {
      if (k < s.point.n1Percent && k > n1) {
        s = step(solveSteady(e, GROUND_RUN, { kind: 'n1Percent', value: k }, s.unknowns));
      }
    }
    s = fitted(solveSteady(e, GROUND_RUN, { kind: 'n1Percent', value: n1 }, s.unknowns));
    const n2 = factValue(p.n2);
    points.push({
      id: `C10 ${p.id} N2`,
      threshold: 'C10',
      model: s.point.n2Percent,
      target: n2,
      unit: '%',
      residual: (s.point.n2Percent - n2) / C10.maxN2ErrorPoints.value,
    });
    // the measured EGT; at idle the measured range of the two positions (466-493 C), as C10 has it
    const egt = displayedEgt(e, s.point);
    const target =
      p.egt === 'range' ? Math.min(idleEgtHigh, Math.max(idleEgtLow, egt)) : factValue(p.egt);
    points.push({
      id: `C10 ${p.id} EGT`,
      threshold: 'C10',
      model: egt - K,
      target: target - K,
      unit: 'C',
      residual: (egt - target) / C10.maxEgtErrorK.value,
    });
  }

  // C4 guard: zero inside the published ranges, steep outside (0.1 point / 3 K per unit)
  const idle = fitted(groundIdle(e, TEST_BED));
  const n1 = idle.point.n1Percent;
  const [lo, hi] = [factValue('idleN1Min'), factValue('idleN1Max')];
  const edge = Math.min(hi, Math.max(lo, n1));
  points.push({
    id: 'C4 ISA ground idle N1',
    threshold: 'C4',
    model: n1,
    target: edge,
    unit: '%',
    residual: (n1 - edge) / 0.1,
  });
  const egt = displayedEgt(e, idle.point);
  const egtMax = factValue('idleEgtMax');
  points.push({
    id: 'C4 ISA ground idle EGT',
    threshold: 'C4',
    model: egt - K,
    target: egtMax - K,
    unit: 'C',
    residual: Math.max(0, egt - egtMax) / 3,
  });
  points.push({
    id: 'booster R-line on its map',
    threshold: 'map',
    model: boosterRline,
    target: BOOSTER_RLINE_LIMIT,
    unit: '1',
    residual: Math.max(0, boosterRline - BOOSTER_RLINE_LIMIT) / 0.05,
  });
  return { converged, points };
}

/**
 * W0C-I6 / D2-3: the EGT probe's share of the LPT work is the one that shows the measured 855 C
 * at the 25 C static takeoff run (N1 97.4 %, no bleed or extraction, as engine.test.ts checks
 * it). The part-power mechanisms move that point (its fan runs at 95 % corrected speed), so the
 * share is re-derived for every candidate instead of staying at the value fitted without them.
 * The share does not enter the gas path, so it follows from the solved point directly:
 * share = (h45 - h(T49.5 measured)) / (h45 - h5). Null if the point does not converge.
 */
export function probeShareForStaticTakeoff(e: SizedEngine): number | null {
  const run: OperatingConditions = {
    ambient: GROUND_RUN.ambient,
    customerBleedFraction: 0,
    powerExtractionW: 0,
  };
  const s = solveSteady(e, run, { kind: 'n1Percent', value: factValue('staticTakeoffN1') });
  if (!s.converged) return null;
  const st = s.point.stations;
  const far = st['45'].fuelAirRatio;
  const t495 = factValue('staticTakeoffEgt') - egtShunt(e.definition, s.point.n2Rpm);
  const h45 = enthalpy(st['45'].ttK, far);
  return (h45 - enthalpy(t495, far)) / (h45 - enthalpy(st['5'].ttK, far));
}

/** The calibration the fit evaluates at x: the mechanisms plus the re-derived probe share. */
export function partPowerCalibration(
  e: SizedEngine,
  x: readonly number[],
): CycleCalibration | null {
  const cal = withPartPower(e.calibration, x);
  const share = probeShareForStaticTakeoff(withCalibration(e, cal));
  return share === null ? null : { ...cal, egtProbeLptWorkFraction: share };
}

/** The fit's residual vector at x, or null where a solve does not converge. */
export function partPowerResiduals(e: SizedEngine, x: readonly number[]): number[] | null {
  const cal = partPowerCalibration(e, x);
  if (cal === null) return null;
  const ev = evaluatePartPower(withCalibration(e, cal));
  return ev.converged ? ev.points.map((p) => p.residual) : null;
}

/** The fit's bounds, in PART_POWER_PARAMETERS order. */
export const PART_POWER_LOWER = PART_POWER_PARAMETERS.map((p) => p.lower);
export const PART_POWER_UPPER = PART_POWER_PARAMETERS.map((p) => p.upper);

/** The deterministic start of the fit: the middle of every bound. */
export const PART_POWER_START = PART_POWER_PARAMETERS.map((p) => 0.5 * (p.lower + p.upper));
