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
  readonly section: '3.1' | '3.2' | '3.3' | '3.4' | '3.6';
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
  // D4-90 (flagged contract addition): D4-84's held-frame bar, gated in Node in the held retry's
  // own deterministic unit (gas-path evaluations); the browser's wall time is a record. D4-96 item 3
  // (N3, a flagged contract text edit): the check states the window D4-90 measured; no bar changed
  P5: {
    id: 'P5',
    section: '3.4',
    checkText:
      "Held gas-path frame (D4-84, D4-90): the W1K-I2 part-power fit's 1 s lever ramp (the W2F-N5 case), stepped at 60 Hz, with the matched gas-path solve held; the window is 23 s from ground idle: 3 s at idle, the 1 s ramp, then the take-off lever (D4-96)",
    passText:
      "Gated in Node, deterministic: every step that starts held costs ≤ 137 gas-path evaluations (the retry budget plus one Newton iteration), and every step ≤ 217 (plus one converged direct solve). The browser's held-frame wall time, ≤ 16.7 ms, is recorded beside it and counts only in an official run under D0-1, like P1 and P4.",
    targetsFrom: 'PHYSICS',
    values: {
      leverRampS: check(1, 's', '1 s'),
      stepRateHz: check(60, 'Hz', '60 Hz'),
      windowS: check(23, 's', '23 s from ground idle'),
      idleS: check(3, 's', '3 s at idle'),
      maxHeldStepEvaluations: pass(137, 'evaluations', '≤ 137'),
      maxStepEvaluations: pass(217, 'evaluations', '≤ 217'),
      heldFrameMs: pass(16.7, 'ms', '≤ 16.7 ms'),
    },
  },
  // D4-94 (flagged contract addition): D4-92 (b)'s recovery bound, written as a test row before the
  // round-2 fix, made a P5 row
  P5b: {
    id: 'P5b',
    section: '3.4',
    checkText:
      "Held gas-path recovery (D4-92 (b), D4-94): the default reference model in critic pass 15's scenario, ISA SLS from ground idle with take-off at 3 s, an injected surge at 10 s and a flameout at 20 s with the auto relight, run for 35 s, at every frame step from 1/120 to 1/30 s (120 Hz to 30 Hz; sampled at 1/120, 1/60, 0.020, 0.0205, 0.021, 0.025 and 1/30 s)",
    passText:
      "Gated in Node, deterministic: every held episode (a run of consecutive held steps, its length the steps times the frame step) lasts ≤ 0.5 s of sim time, and N1 stays at or below its redline (ENGINE_FACTS n1MaxRpm) while held. The recorded exception beside P5, like the sub-idle entry: an episode held for 0.25 s escalates once to D4-13's whole walk in one snapshot, unbudgeted (3,100-4,400 gas-path evaluations, 50-240 ms in Node), outside P5's per-step bars.",
    targetsFrom: 'PHYSICS',
    values: {
      takeoffAtS: check(3, 's', 'take-off at 3 s'),
      surgeAtS: check(10, 's', 'surge at 10 s'),
      flameoutAtS: check(20, 's', 'flameout at 20 s'),
      scenarioS: check(35, 's', '35 s'),
      maxStepRateHz: check(120, 'Hz', '120 Hz'),
      minStepRateHz: check(30, 'Hz', '30 Hz'),
      maxHeldEpisodeS: pass(0.5, 's', '≤ 0.5 s'),
      escalateAfterS: pass(0.25, 's', 'held for 0.25 s'),
    },
  },
  // 3.6 Engine sound (D5-4, pre-registered before any audio code): levels are relative (dB against
  // the blade-pass tone at the same operating point); src/audio and tests/unit/audio check them
  A1: {
    id: 'A1',
    section: '3.6',
    checkText:
      "Tone frequencies: the fan blade-pass tone B_fan·N1/60 (B_fan = 24, the definition's published count) and its harmonics; the HPC rotor tones B_row·N2/60 for the rows the synth voices (counts from the definition, estimates labelled); any turbine tones likewise",
    passText:
      "each tone's measured peak within 0.25 % of its formula at every N1 (and N2) step from sub-idle to 105 %; in a 1 s linear N1 ramp, no step in instantaneous frequency > 0.5 % between 128-sample quanta; no partial above 0.45 f_s (no aliasing)",
    targetsFrom: 'PHYSICS',
    values: {
      maxFrequencyErrorPercent: pass(0.25, '%', '0.25 %'),
      maxN1Percent: pass(105, '%', '105 %'),
      rampS: pass(1, 's', '1 s linear'),
      maxQuantumStepPercent: pass(0.5, '%', '> 0.5 %'),
      quantumFrames: pass(128, 'frames', '128-sample'),
      maxPartialOfSampleRate: pass(0.45, '1', '0.45 f_s'),
      fanBlades: check(24, 'blades', 'B_fan = 24'),
    },
  },
  A2: {
    id: 'A2',
    section: '3.6',
    checkText:
      "Buzz-saw: the multiple pure tones at engine orders k·N1/60, k = 1 … B_fan − 1, with onset at the fan's relative tip Mach 1",
    passText:
      "M_rel,tip from the cycle state (N1, the definition's fan tip radius, the fan-face total temperature and axial Mach) agrees with an independent computation in the test within 0.5 %; the summed engine-order level is ≥ 30 dB below the blade-pass tone at M_rel ≤ 0.98 and within 20 dB of it at M_rel ≥ 1.05",
    targetsFrom: 'PHYSICS',
    values: {
      machAgreementPercent: pass(0.5, '%', 'within 0.5 %'),
      minSubsonicDbBelow: pass(30, 'dB', '≥ 30 dB'),
      subsonicMach: pass(0.98, '1', 'M_rel ≤ 0.98'),
      maxSupersonicDbBelow: pass(20, 'dB', 'within 20 dB'),
      supersonicMach: pass(1.05, '1', 'M_rel ≥ 1.05'),
      onsetMach: check(1, '1', 'Mach 1'),
    },
  },
  A3: {
    id: 'A3',
    section: '3.6',
    checkText:
      "Jet mixing noise from each stream (core, bypass), from the cycle model's nozzle exit velocity, density and area",
    passText:
      "the source power follows Lighthill's U_j⁸ law: its log-log slope against U_j at fixed ρ_j/ρ∞ and area is 8 ± 0.2 over the subsonic operating range; the spectral peak at the aft peak angle sits at a Strouhal number f·D_j/U_j in 0.15-0.3",
    targetsFrom: 'PHYSICS',
    values: {
      slope: pass(8, '1', '8 ± 0.2'),
      slopeTolerance: pass(0.2, '1', '± 0.2'),
      minStrouhal: pass(0.15, '1', '0.15-0.3'),
      maxStrouhal: pass(0.3, '1', '-0.3'),
    },
  },
  A4: {
    id: 'A4',
    section: '3.6',
    checkText: "Directivity, from the listener's angle θ to the inlet axis (the camera position)",
    passText:
      'the fan tones are louder forward, with the level at θ = 45° at least 6 dB above that at θ = 150°; jet mixing noise peaks at θ in 140-160° (20-40° from the jet axis)',
    targetsFrom: 'PHYSICS',
    values: {
      forwardDeg: pass(45, 'deg', 'θ = 45°'),
      aftDeg: pass(150, 'deg', 'θ = 150°'),
      minForwardDb: pass(6, 'dB', '6 dB'),
      jetPeakMinDeg: pass(140, 'deg', '140-160°'),
      jetPeakMaxDeg: pass(160, 'deg', '-160°'),
    },
  },
  A5: {
    id: 'A5',
    section: '3.6',
    checkText:
      "Events from the cycle state: the starter's whine (speed ∝ N2 through the starter gear ratio, an estimate labelled), the igniters' clicks, the combustion rumble (∝ fuel flow), and a surge bang per surge cycle",
    passText:
      "exact gating: no igniter click while the igniters are off and none missing while they are on; no rumble while unlit; one bang per modelled surge cycle (the Greitzer model's cycle count)",
    targetsFrom: 'PHYSICS',
    values: {},
  },
  A6: {
    id: 'A6',
    section: '3.6',
    checkText: 'Safety and cost',
    passText:
      "over 60 s of a scripted transient (start, take-off, surge, flameout, relight), the output stays finite with no denormals and peaks ≤ −1 dBFS through a final limiter; sound is off until the viewer turns it on, with mute and volume controls in the HUD; the DSP's median cost per 128-frame quantum is ≤ 0.4 ms (15 % of 2.67 ms) in Node, indicative; P1 and P4 do not change beyond their noise (the worklet runs on the audio thread)",
    targetsFrom: 'PHYSICS',
    values: {
      transientS: pass(60, 's', '60 s'),
      peakDbBelowFullScale: pass(1, 'dB', '≤ −1 dBFS'),
      maxQuantumMs: pass(0.4, 'ms', '≤ 0.4 ms'),
      quantumFrames: pass(128, 'frames', '128-frame'),
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
