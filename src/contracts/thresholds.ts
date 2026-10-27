// Pre-registered pass/fail thresholds, mirrored from docs/PHYSICS.md section 3 (set by the
// orchestrator on 2026-10-24, before any physics code). Tests import their numbers from here.
// tests/unit/contracts/thresholds.test.ts reads PHYSICS.md and checks that every Check and
// Pass text below is verbatim and that every number is parsed from that text, so the two
// files cannot drift. A threshold changes only through a logged orchestrator decision
// (docs/reviews/LOG.md); never edit one here to make a test pass.

export interface ThresholdNumber {
  readonly value: number;
  readonly unit: string;
  /** The exact substring of the Check or Pass text the value is read from. */
  readonly token: string;
  readonly from: 'check' | 'pass';
}

export interface ThresholdSpec {
  readonly id: string;
  readonly section: '3.1' | '3.2' | '3.3' | '3.4';
  readonly checkText: string;
  readonly passText: string;
  /** Where the comparison target comes from: these numbers, or cited figures in ENGINE_FACTS.md. */
  readonly targetsFrom: 'PHYSICS' | 'ENGINE_FACTS';
  readonly values: Readonly<Record<string, ThresholdNumber>>;
}

const pass = (value: number, unit: string, token: string): ThresholdNumber => ({
  value,
  unit,
  token,
  from: 'pass',
});
const check = (value: number, unit: string, token: string): ThresholdNumber => ({
  value,
  unit,
  token,
  from: 'check',
});

export const THRESHOLDS = {
  // 3.1 Thermo
  T1: {
    id: 'T1',
    section: '3.1',
    checkText: 'cp of air at 300, 500, 1000, 1500 K vs NASA/JANAF tables',
    passText: 'within 0.5%',
    targetsFrom: 'PHYSICS',
    values: {
      maxRelativeError: pass(0.005, '1', '0.5%'),
      temperature1K: check(300, 'K', '300'),
      temperature2K: check(500, 'K', '500'),
      temperature3K: check(1000, 'K', '1000'),
      temperature4K: check(1500, 'K', '1500'),
    },
  },
  T2: {
    id: 'T2',
    section: '3.1',
    checkText: 'γ of air at the same temperatures',
    passText: 'within 0.5%',
    targetsFrom: 'PHYSICS',
    values: { maxRelativeError: pass(0.005, '1', '0.5%') },
  },
  T3: {
    id: 'T3',
    section: '3.1',
    checkText:
      'cp of stoichiometric Jet-A products at 1000, 1500, 2000 K vs JANAF species tables mixed at the frozen stoichiometric Jet-A product composition (the method CEA uses for a frozen mixture)',
    passText: 'within 0.5%',
    targetsFrom: 'PHYSICS',
    values: {
      maxRelativeError: pass(0.005, '1', '0.5%'),
      temperature1K: check(1000, 'K', '1000'),
      temperature2K: check(1500, 'K', '1500'),
      temperature3K: check(2000, 'K', '2000'),
    },
  },
  T4: {
    id: 'T4',
    section: '3.1',
    checkText: 'h(T) integrates cp(T): h(T2) − h(T1) vs numeric integral',
    passText: 'within 1e-6 relative',
    targetsFrom: 'PHYSICS',
    values: { maxRelativeError: pass(1e-6, '1', '1e-6') },
  },

  // 3.2 Cycle
  C1: {
    id: 'C1',
    section: '3.2',
    checkText: 'SLS takeoff thrust',
    passText: 'within 3% of published',
    targetsFrom: 'ENGINE_FACTS',
    values: { maxRelativeError: pass(0.03, '1', '3%') },
  },
  C2: {
    id: 'C2',
    section: '3.2',
    checkText: 'SLS takeoff BPR, OPR, total airflow',
    passText: 'each within 3% of published',
    targetsFrom: 'ENGINE_FACTS',
    values: { maxRelativeError: pass(0.03, '1', '3%') },
  },
  C3: {
    id: 'C3',
    section: '3.2',
    checkText: 'SLS takeoff TSFC',
    passText: 'within 3% of published (or of the cited estimate, if no official figure)',
    targetsFrom: 'ENGINE_FACTS',
    values: { maxRelativeError: pass(0.03, '1', '3%') },
  },
  C4: {
    id: 'C4',
    section: '3.2',
    checkText: 'Ground-idle N1, N2, EGT',
    passText: 'inside the published ranges',
    targetsFrom: 'ENGINE_FACTS',
    values: {},
  },
  C5: {
    id: 'C5',
    section: '3.2',
    checkText: 'Flight idle to 95% takeoff thrust (14 CFR 33.73)',
    passText: '≤ 5.0 s',
    targetsFrom: 'PHYSICS',
    values: {
      maxTimeS: pass(5, 's', '≤ 5.0'),
      thrustFraction: check(0.95, '1', '95%'),
    },
  },
  C6: {
    id: 'C6',
    section: '3.2',
    checkText: 'Takeoff EGT',
    passText: 'below the redline in the type certificate data sheet',
    targetsFrom: 'ENGINE_FACTS',
    values: {},
  },
  C7: {
    id: 'C7',
    section: '3.2',
    checkText:
      'Off-design matching converges (residual < 1e-8 relative) at every point of a throttle sweep idle → takeoff',
    passText: '100% of points, ≤ 25 Newton iterations each',
    targetsFrom: 'PHYSICS',
    values: {
      maxRelativeResidual: check(1e-8, '1', '1e-8'),
      convergedFraction: pass(1, '1', '100%'),
      maxNewtonIterations: pass(25, 'iterations', '≤ 25'),
    },
  },
  C8: {
    id: 'C8',
    section: '3.2',
    checkText: 'Mass and energy balance across the whole engine at every matched point',
    passText: 'within 1e-6 relative',
    targetsFrom: 'PHYSICS',
    values: { maxRelativeImbalance: pass(1e-6, '1', '1e-6') },
  },
  C9: {
    id: 'C9',
    section: '3.2',
    checkText:
      'Greitzer model, B above critical: deep-surge limit cycle appears; B below critical: rotating-stall-free recovery',
    passText: 'qualitative, plus cycle period within 20% of the Helmholtz estimate',
    targetsFrom: 'PHYSICS',
    values: { maxPeriodRelativeError: pass(0.2, '1', '20%') },
  },
  // D3-3: the measured ground-run points; the measured values themselves are ENGINE_FACTS rows
  C10: {
    id: 'C10',
    section: '3.2',
    checkText:
      'Measured ground-run points, [WIDURI] Table 7 (OAT 25 °C, 1008 hPa, 14 ft): at the measured N1 of ground idle (20.5 / 21.0 %), MPA (65.0 %) and takeoff (97.4 %)',
    passText:
      "the model's displayed EGT within ±30 K of the measured value (idle: inside the measured 466-493 °C range widened by 30 K on each side, i.e. 436-523 °C; MPA 585 ± 30 °C; takeoff 855 ± 30 °C) and N2 within ±1.5 points of the measured value (idle 60.6 / 60.7 %, MPA 89.3 %, takeoff 99.8 %)",
    targetsFrom: 'ENGINE_FACTS',
    values: {
      maxEgtErrorK: pass(30, 'K', '±30 K'),
      maxN2ErrorPoints: pass(1.5, 'points', '±1.5 points'),
    },
  },
  // D3-11: the EEDB LTO fuel flows; the databank values themselves are ENGINE_FACTS rows
  C11: {
    id: 'C11',
    section: '3.2',
    checkText: 'Fuel flow at the EEDB LTO settings 7 / 30 / 85% rated thrust (ISA SLS)',
    passText: 'within ±5% of the databank',
    targetsFrom: 'ENGINE_FACTS',
    values: {
      maxRelativeError: pass(0.05, '1', '±5%'),
      // % of the rated thrust (eedbRatedThrust)
      idleThrustPercent: check(7, '%', '7 /'),
      approachThrustPercent: check(30, '%', '30 /'),
      climbOutThrustPercent: check(85, '%', '/ 85'),
    },
  },

  // D3-17: surge detection and recovery on a reduced-margin HPC (the EGT limit and the C4 idle
  // ranges are ENGINE_FACTS rows)
  C12: {
    id: 'C12',
    section: '3.2',
    checkText:
      'Surge recovery (D3-17): the 33.73(a) ground-idle slam (ISA SLS, lever to maximum in 1 s and held 30 s, then to minimum in 1 s and held 45 s) on an HPC whose surge pressure ratio is lowered by 6% (ΔPRS, SAE ARP1420), so that the slam surges',
    passText:
      'the slam surges; the FADEC detects each surge from the sensed P3 within 0.1 s of its onset and cuts fuel flow below its pre-surge value, with the VBVs fully open and the igniters on; at most 2 surges, no flameout, displayed EGT below the 960 °C transitory limit; ≥ 95% rated takeoff thrust within 10 s of the lever movement, then surge-free to the end of the hold; at minimum lever, N1 and N2 inside the C4 ground-idle ranges at the end of the 45 s (no hang)',
    targetsFrom: 'PHYSICS',
    values: {
      surgePressureRatioLoss: check(0.06, '1', '6%'),
      leverMoveS: check(1, 's', 'in 1 s'),
      maximumLeverHoldS: check(30, 's', 'held 30 s'),
      minimumLeverHoldS: check(45, 's', 'held 45 s'),
      maxDetectionDelayS: pass(0.1, 's', '0.1 s'),
      maxSurges: pass(2, 'surges', 'at most 2'),
      thrustFraction: pass(0.95, '1', '95%'),
      maxTimeToThrustS: pass(10, 's', 'within 10 s'),
    },
  },

  // 3.3 Flow solver validation ladder
  L1: {
    id: 'L1',
    section: '3.3',
    checkText:
      'Quiescent ambient and uniform M 0.5 flow on the real mesh (axis + block interfaces)',
    passText: 'spurious velocity < 1e-4 m/s after 20k iterations',
    targetsFrom: 'PHYSICS',
    values: {
      uniformFlowMach: check(0.5, '1', 'M 0.5'),
      maxSpuriousVelocityMPerS: pass(1e-4, 'm/s', '1e-4'),
      iterations: pass(20_000, 'iterations', '20k'),
    },
  },
  L2: {
    id: 'L2',
    section: '3.3',
    checkText: 'Axial Sod shock tube, 400 cells',
    passText: 'L1(ρ) < 1%; shock within 1 cell of exact',
    targetsFrom: 'PHYSICS',
    values: {
      cells: check(400, 'cells', '400'),
      maxDensityL1RelativeError: pass(0.01, '1', '< 1%'),
      maxShockOffsetCells: pass(1, 'cells', '1 cell'),
    },
  },
  L3: {
    id: 'L3',
    section: '3.3',
    checkText: 'Cylindrical (radial) Sod vs a 1D f64 reference',
    passText: 'L1(ρ) < 2%',
    targetsFrom: 'PHYSICS',
    values: { maxDensityL1RelativeError: pass(0.02, '1', '2%') },
  },
  L4: {
    id: 'L4',
    section: '3.3',
    checkText: 'Axisymmetric converging-diverging nozzle',
    passText:
      "Mach within 1% of quasi-1D theory; normal-shock position within 2% of nozzle length; choked mass flow within 0.5% of ideal × the contour's Cd",
    targetsFrom: 'PHYSICS',
    values: {
      maxMachRelativeError: pass(0.01, '1', 'Mach within 1%'),
      maxShockPositionFractionOfLength: pass(0.02, '1', '2%'),
      maxChokedMassFlowRelativeError: pass(0.005, '1', '0.5%'),
    },
  },
  L5: {
    id: 'L5',
    section: '3.3',
    checkText: 'Choking through a blockage-only row',
    passText: 'mass flow within 1% of area theory',
    targetsFrom: 'PHYSICS',
    values: { maxMassFlowRelativeError: pass(0.01, '1', '1%') },
  },
  L6: {
    id: 'L6',
    section: '3.3',
    checkText: 'Free vortex and solid-body rotation in an annulus',
    passText: 'radial-equilibrium error < 0.1% of dynamic pressure; angular-momentum drift < 1e-4',
    targetsFrom: 'PHYSICS',
    values: {
      maxRadialEquilibriumErrorFractionOfQ: pass(0.001, '1', '0.1%'),
      maxAngularMomentumDrift: pass(1e-4, '1', '1e-4'),
    },
  },
  L7: {
    id: 'L7',
    section: '3.3',
    checkText: 'Inviscid sphere at M 0.01',
    passText:
      'Cp fore/aft symmetric within 2%; Cd < 0.01; iterations to converge within 3× the M 0.3 case',
    targetsFrom: 'PHYSICS',
    values: {
      mach: check(0.01, '1', 'M 0.01'),
      maxCpAsymmetry: pass(0.02, '1', '2%'),
      maxDragCoefficient: pass(0.01, '1', 'Cd < 0.01'),
      maxIterationRatio: pass(3, '1', '3×'),
      referenceMach: pass(0.3, '1', 'M 0.3'),
    },
  },
  L8: {
    id: 'L8',
    section: '3.3',
    checkText: 'Static point sink in ambient at rest',
    passText: 'velocity within 1% of ṁ/(4πr²ρ)',
    targetsFrom: 'PHYSICS',
    values: { maxVelocityRelativeError: pass(0.01, '1', '1%') },
  },
  L9: {
    id: 'L9',
    section: '3.3',
    checkText: 'Actuator disk',
    passText: 'ΔT₀ = ΩΔ(r u_θ)/cp to 1e-4 relative; momentum theory within 2%',
    targetsFrom: 'PHYSICS',
    values: {
      maxEulerWorkRelativeError: pass(1e-4, '1', '1e-4'),
      maxMomentumTheoryRelativeError: pass(0.02, '1', '2%'),
    },
  },
  L10: {
    id: 'L10',
    section: '3.3',
    checkText: 'NASA Rotor 67 speedline (TP-2879), stretch goal',
    passText: 'pressure ratio within 3%; choke flow within 1%',
    targetsFrom: 'PHYSICS',
    values: {
      maxPressureRatioRelativeError: pass(0.03, '1', '3%'),
      maxChokeFlowRelativeError: pass(0.01, '1', '1%'),
    },
  },
  L11: {
    id: 'L11',
    section: '3.3',
    checkText: 'Jets',
    passText:
      'round-jet spreading rate 0.086–0.096 ±15%; centreline decay constant B ≈ 5.8 ±15%; cold M 0.9 potential core 6–7 D ±1 D; hot-jet trend matches Bridges & Wernet; coaxial centreline velocity ±15% vs NASA separate-flow nozzle data',
    targetsFrom: 'PHYSICS',
    values: {
      spreadingRateMin: pass(0.086, '1', '0.086'),
      spreadingRateMax: pass(0.096, '1', '0.096'),
      spreadingRateTolerance: pass(0.15, '1', '±15%'),
      decayConstantB: pass(5.8, '1', '5.8'),
      decayConstantTolerance: pass(0.15, '1', '±15%'),
      coldJetMach: pass(0.9, '1', 'M 0.9'),
      potentialCoreMinD: pass(6, 'D', '6–7 D'),
      potentialCoreMaxD: pass(7, 'D', '7 D'),
      potentialCoreToleranceD: pass(1, 'D', '±1 D'),
      coaxialVelocityTolerance: pass(0.15, '1', '±15%'),
    },
  },
  L12: {
    id: 'L12',
    section: '3.3',
    checkText: 'Calibrated engine vs the cycle model',
    passText: 'station flows ±0.5%; T₄ ±10 K; thrust ±2%; 1% lag < 1 s on a throttle ramp',
    targetsFrom: 'PHYSICS',
    values: {
      maxStationFlowRelativeError: pass(0.005, '1', '±0.5%'),
      t4ErrorK: pass(10, 'K', '±10 K'),
      maxThrustRelativeError: pass(0.02, '1', '±2%'),
      lagFraction: pass(0.01, '1', '1% lag'),
      maxLagS: pass(1, 's', '< 1 s'),
    },
  },
  L13: {
    id: 'L13',
    section: '3.3',
    checkText: '10-minute soak on the laptop (Arc 140T)',
    passText: 'solver p95 ≤ 7 ms per frame while holding 60 fps at the default preset',
    targetsFrom: 'PHYSICS',
    values: {
      soakDurationMin: check(10, 'min', '10-minute'),
      percentile: pass(95, 'percentile', 'p95'),
      maxSolverFrameMs: pass(7, 'ms', '≤ 7'),
      frameRateFps: pass(60, 'fps', '60 fps'),
    },
  },

  // 3.4 Performance
  P1: {
    id: 'P1',
    section: '3.4',
    checkText: 'Solver throughput at ~130k cells inside a 1080p three.js scene (W0 spike a)',
    passText:
      '≥ 150 iterations/s, else a logged decision (≈80k cells or a half-rate solver). Measurement protocol (D0-1): on AC power, no other agents/builds/tests running, Chrome in the foreground, 10 s warm-up then the median of 3 runs of 60 s; the conditions (power source, CPU load, GPU clock if readable) are recorded with the number. A result below 150 counts only after a quiet re-run under this protocol.',
    targetsFrom: 'PHYSICS',
    values: {
      cells: check(130_000, 'cells', '~130k'),
      resolutionLines: check(1080, 'px', '1080p'),
      minIterationsPerS: pass(150, 'iterations/s', '≥ 150'),
      fallbackCells: pass(80_000, 'cells', '≈80k'),
      warmUpS: pass(10, 's', '10 s warm-up'),
      runs: pass(3, 'runs', '3 runs'),
      runDurationS: pass(60, 's', '60 s'),
    },
  },
  P2: {
    id: 'P2',
    section: '3.4',
    checkText: 'Default preset frame rate',
    passText: '≥ 55 fps (performance trace)',
    targetsFrom: 'PHYSICS',
    values: { minFps: pass(55, 'fps', '≥ 55') },
  },
  P3: {
    id: 'P3',
    section: '3.4',
    checkText: 'WebGPU validation errors during any test or scenario',
    passText: 'zero',
    targetsFrom: 'PHYSICS',
    values: { maxValidationErrors: pass(0, 'errors', 'zero') },
  },
  P4: {
    id: 'P4',
    section: '3.4',
    checkText:
      'Render GPU time (engine plus post, excluding the solver and flow visuals) at the default preset, 1080p, default three-quarter front view (D4-2)',
    passText:
      '≤ 8.0 ms median under D0-1. The cutaway and hero views are reported (target ≤ 10 ms) but not gated.',
    targetsFrom: 'PHYSICS',
    values: {
      resolutionLines: check(1080, 'px', '1080p'),
      maxRenderGpuMs: pass(8, 'ms', '≤ 8.0'),
      reportedTargetMs: pass(10, 'ms', '≤ 10 ms'),
    },
  },
} as const satisfies Record<string, ThresholdSpec>;

export type ThresholdId = keyof typeof THRESHOLDS;

export const THRESHOLD_IDS = Object.keys(THRESHOLDS) as readonly ThresholdId[];

const THRESHOLD_ID_SET: ReadonlySet<string> = new Set(THRESHOLD_IDS);

export function isThresholdId(value: unknown): value is ThresholdId {
  return typeof value === 'string' && THRESHOLD_ID_SET.has(value);
}

/** All typed numbers of one threshold, for generic checks. */
export function thresholdNumbers(id: ThresholdId): readonly ThresholdNumber[] {
  const spec: ThresholdSpec = THRESHOLDS[id];
  return Object.values(spec.values);
}

/**
 * Reads the number in a threshold token: the first decimal or scientific literal, then an
 * immediately following suffix: "%" divides by 100, lower-case "k" multiplies by 1000 (so
 * "±10 K" stays 10 kelvin). "zero" is 0. Prefixes such as "≤", "±", "~", "M " are ignored.
 */
export function parseThresholdToken(token: string): number {
  if (token.trim().toLowerCase() === 'zero') return 0;
  const match = /(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)(%|k)?/.exec(token);
  if (match?.[1] === undefined) throw new Error(`threshold token "${token}" has no number`);
  const n = Number(match[1]);
  const suffix = match[2];
  if (suffix === '%') return n / 100;
  if (suffix === 'k') return n * 1000;
  return n;
}
