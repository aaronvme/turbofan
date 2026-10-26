// Engine figures for the CFM56-7B27/3-class reference engine, mirrored row by row from
// docs/ENGINE_FACTS.md (which holds the source, the source-unit value and the derivation of
// each one). tests/unit/engine/facts.test.ts parses the doc and fails on any difference, so
// the doc and this file cannot drift. Code that needs an engine figure reads it from here
// (definition.ts, the mocks, the cycle tests); never restate a number as a literal.
//
// `unknown` rows are model assumptions, not facts: no public source gives them, and the doc
// says why each value was chosen.

export const FACT_CONFIDENCES = ['official', 'published', 'estimate', 'unknown'] as const;
export type FactConfidence = (typeof FACT_CONFIDENCES)[number];

export interface EngineFact {
  /** The value in SI (or the unit named, e.g. rpm or % of the 100 % speed). */
  readonly si: number;
  /** '' for dimensionless figures. */
  readonly unit: string;
  readonly confidence: FactConfidence;
}

const f = (si: number, unit: string, confidence: FactConfidence): EngineFact => ({
  si,
  unit,
  confidence,
});

export const ENGINE_FACTS = {
  // Published figures
  takeoffThrust: f(121430, 'N', 'official'),
  maxContinuousThrust: f(115210, 'N', 'official'),
  takeoffThrustFiche: f(121436, 'N', 'official'),
  flatRatingTemperature: f(303.15, 'K', 'official'),
  bypassRatio: f(5.1, '', 'official'),
  overallPressureRatio: f(29, '', 'official'),
  overallPressureRatioAvWeek: f(28.9, '', 'published'),
  overallPressureRatioMaxClimb: f(32.7, '', 'official'),
  totalAirflow: f(359.245, 'kg/s', 'official'),
  totalAirflowCfmWeb: f(354.709, 'kg/s', 'official'),
  maxClimbThrust: f(26511, 'N', 'official'),
  eedbRatedThrust: f(121400, 'N', 'official'),
  fuelFlowTakeoff: f(1.293, 'kg/s', 'official'),
  fuelFlowClimbOut: f(1.031, 'kg/s', 'official'),
  fuelFlowApproach: f(0.343, 'kg/s', 'official'),
  fuelFlowIdle: f(0.11, 'kg/s', 'official'),
  tsfcTakeoff: f(1.0648e-5, 'kg/(N s)', 'estimate'),
  tsfcTakeoffAvWeek: f(1.0934e-5, 'kg/(N s)', 'published'),
  // the w1/cycle design-point sizing (D1-2, D2-2)
  coreNozzleArea: f(0.1851, 'm²', 'estimate'),
  bypassNozzleArea: f(0.9162, 'm²', 'estimate'),
  accelStartMaxThrustFraction: f(0.15, '', 'official'),
  fanDiameter: f(1.5494, 'm', 'official'),
  fanBladeCount: f(24, '', 'published'),
  fanBladeChord: f(0.2794, 'm', 'published'),
  fanBladeMass: f(4.9124, 'kg', 'published'),
  fanStages: f(1, '', 'official'),
  boosterStages: f(3, '', 'official'),
  hpcStages: f(9, '', 'official'),
  hptStages: f(1, '', 'official'),
  lptStages: f(4, '', 'official'),
  engineLength: f(2.508, 'm', 'official'),
  engineLengthFiche: f(2.6289, 'm', 'official'),
  engineWidth: f(2.118, 'm', 'official'),
  engineHeight: f(1.829, 'm', 'official'),
  dryWeight: f(2386, 'kg', 'official'),
  envelopeDiameterAvWeek: f(1.651, 'm', 'published'),
  rotationSense: f(-1, '', 'published'),
  n1MaxRpm: f(5382, 'rpm', 'official'),
  n2MaxRpm: f(15183, 'rpm', 'official'),
  n1ReferenceRpm: f(5175, 'rpm', 'estimate'),
  n2ReferenceRpm: f(14460, 'rpm', 'estimate'),
  egtTakeoffLimit: f(1223.15, 'K', 'official'),
  egtMaxContinuousLimit: f(1198.15, 'K', 'official'),
  egtStartLimit: f(998.15, 'K', 'official'),
  egtTransientLimit: f(1233.15, 'K', 'official'),
  egtTransientDuration: f(20, 's', 'official'),
  egtShuntOffset: f(30, 'K', 'official'),
  egtShuntRampStartN2: f(8300, 'rpm', 'official'),
  egtShuntFullN2: f(8500, 'rpm', 'official'),
  egtTrim: f(0, 'K', 'official'),
  idleN1Min: f(20, '%', 'published'),
  idleN1Max: f(22, '%', 'published'),
  idleN2Min: f(60, '%', 'published'),
  idleN2Max: f(62, '%', 'published'),
  idleEgtMax: f(773.15, 'K', 'published'),
  runUpOat: f(298.15, 'K', 'published'),
  runUpPressure: f(100800, 'Pa', 'published'),
  idleN1Low: f(20.5, '%', 'published'),
  idleN1High: f(21, '%', 'published'),
  idleN2Low: f(60.6, '%', 'published'),
  idleN2High: f(60.7, '%', 'published'),
  idleEgtLow: f(739.15, 'K', 'published'),
  idleEgtHigh: f(766.15, 'K', 'published'),
  mpaN1: f(65, '%', 'published'),
  mpaN2: f(89.3, '%', 'published'),
  mpaEgt: f(858.15, 'K', 'published'),
  staticTakeoffN1: f(97.4, '%', 'published'),
  staticTakeoffN2: f(99.8, '%', 'published'),
  staticTakeoffEgt: f(1128.15, 'K', 'published'),
  startFuelOnN2: f(25, '%', 'published'),
  starterCutoutN2: f(56, '%', 'published'),
  startPeakEgt: f(765.15, 'K', 'published'),
  startTime: f(60, 's', 'published'),
  bleedBypassMax: f(0.02, '', 'official'),
  bleedHpc5Max: f(0.1, '', 'official'),
  bleedHpc9MaxLow: f(0.12, '', 'official'),
  bleedHpc9MaxHigh: f(0.07, '', 'official'),
  bleedCombinedMaxLow: f(0.13, '', 'official'),
  bleedCombinedMaxHigh: f(0.1, '', 'official'),
  // Unknown figures: model assumptions
  fanBypassPressureRatio: f(1.55, '', 'unknown'),
  fanCorePressureRatio: f(1.5, '', 'unknown'),
  boosterPressureRatio: f(1.75, '', 'unknown'),
  etaFanBypass: f(0.9, '', 'unknown'),
  etaFanCore: f(0.89, '', 'unknown'),
  etaBooster: f(0.89, '', 'unknown'),
  etaHpc: f(0.87, '', 'unknown'),
  etaHpt: f(0.9, '', 'unknown'),
  etaLpt: f(0.91, '', 'unknown'),
  combustionEfficiency: f(0.995, '', 'unknown'),
  combustorPressureLoss: f(0.05, '', 'unknown'),
  turbineCoolingFraction: f(0.12, '', 'unknown'),
  fuelLhv: f(4.32e7, 'J/kg', 'unknown'),
  t4Takeoff: f(1746, 'K', 'unknown'),
  fanHubRadius: f(0.229, 'm', 'unknown'),
  fanTipClearance: f(0.002, 'm', 'unknown'),
  inletHighlightRadius: f(0.8, 'm', 'unknown'),
  nacelleMaxDiameter: f(2.12, 'm', 'unknown'),
  fanCaseFlangeX: f(-0.09, 'm', 'unknown'),
  minFuelOnN2: f(20, '%', 'unknown'),
  lightOffDelay: f(3, 's', 'unknown'),
  vsvRowCount: f(4, '', 'unknown'),
  vsvMaxClosure: f(0.7, 'rad', 'unknown'),
  vsvClosedBelowN2c: f(60, '%', 'unknown'),
  vsvOpenAboveN2c: f(95, '%', 'unknown'),
  vbvMaxFraction: f(0.25, '', 'unknown'),
  tbvMaxFraction: f(0.05, '', 'unknown'),
  vbvOpenBelowN2c: f(70, '%', 'unknown'),
  vbvClosedAboveN2c: f(85, '%', 'unknown'),
  groundRunCustomerBleed: f(0, '', 'unknown'),
  groundRunAccessoryLoad: f(40000, 'W', 'unknown'),
} as const satisfies Readonly<Record<string, EngineFact>>;

export type EngineFactId = keyof typeof ENGINE_FACTS;

/** The SI value of a figure. */
export function factValue(id: EngineFactId): number {
  return ENGINE_FACTS[id].si;
}
