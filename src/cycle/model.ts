// The transient cycle model (CycleModel, src/contracts/cycle.ts): shaft dynamics, a FADEC-like
// controller, the start sequence and surge, around the gas path of engine.ts. Deterministic:
// simulation time only, no wall clock, no randomness.
//
// - Shafts: J dw/dt = (eta_m P_turbine - P_compressors - P_extraction) / w + starter - friction,
//   explicit Euler at DT_INTERNAL (the spool time constants are about 1 s).
// - Above SUBIDLE_N2_PERCENT and lit, the gas path is the matched map model (solveGasPath,
//   warm-started each step). Below it, or unlit, a similarity model anchored at the ground-idle
//   point of the current ambient (the sub-idle method of Agrawal & Yunis, "A Generalized
//   Mathematical Model to Estimate Gas Turbine Starting Characteristics", ASME 81-GT-202):
//   compressor flow ~ N, PR - 1 ~ N^2, power ~ N^3; turbine power from the actual combustor
//   energy balance, scaled from the anchor by flow, inlet temperature and expansion. The two
//   agree exactly at the anchor.
// - D4-13: the similarity model runs only in a genuine sub-idle state (a start, a windmill, a
//   shutdown). A matched solve lost above the switch (no convergence, or a non-physical root)
//   holds the last converged gas path and says so in the state (gasPathSolve: status 'held', the
//   lost solves counted since the reset); the shafts integrate the held power balance and every
//   substep retries the solve from the last converged point. A failed warm-started solve is
//   retried by continuation from that point before it counts as lost (matchedSolve.ts).
// - FADEC: throttle -> N1 target; one Wf/P3 ("ratio unit") integrator driven by the selected
//   loop (max of N1 target and the N2 idle floor, then min of the N1, N2 and EGT limiters), with
//   rate feedback for damping, clamped between decel and accel schedules built from the steady
//   working line (RU_ss times ACCEL/DECEL factors).
// - Surge (D3-4): an HPC operating point beyond the surge line, or an injected fault, starts a
//   Greitzer episode on the engine's own compression system (surgeSystem.ts: B from the HPC duct,
//   the combustor plenum and the rotor tip speed at the current N2; the cubic from the scaled HPC
//   map's current speed line). The throttle line runs through the matched HPC operating point, so
//   once the FADEC's fuel cut moves that point back inside the surge line the equilibrium is
//   stable again, the oscillation decays and the episode ends. The period is whatever the derived
//   Helmholtz frequency and B give.
// - Surge detection and recovery (D3-17, PHYSICS.md C12; ENGINE_FACTS "Surge detection and
//   recovery"): the FADEC never reads the surge margin. It detects a surge from the decay of the
//   sensed P3 (surgeDetection.ts), then cuts the fuel back to the decel schedule, opens the VBVs
//   fully and switches the igniters on, holds that for the confirmation time and restores the
//   acceleration limit on a timed ramp. A new detection restarts the sequence.

import { ISA_SLS, type AmbientConditions } from '../contracts/ambient';
import {
  DEFAULT_CYCLE_INPUTS,
  validateCycleInputs,
  type CycleFault,
  type CycleFlags,
  type CycleInitialCondition,
  type CycleInputs,
  type CycleModel,
  type CycleState,
  type FadecLimiter,
  type FadecMode,
  type GasPathSolveStatus,
  type MapOperatingPoint,
  type StartPhase,
  type StationState,
} from '../contracts/cycle';
import type { EngineDefinition } from '../contracts/engine';
import type { StationId } from '../contracts/stations';
import { ENGINE_DEFINITION } from '../engine/definition';
import { factValue } from '../engine/facts';
import { rpmToRadPerS } from '../engine/units';
import { enthalpy, gamma, gasConstant, temperatureFromEnthalpy } from '../thermo/gas';
import { at } from './at';
import { hermite1 } from './componentMaps';
import {
  referenceEngine,
  egtShunt,
  groundIdle,
  solveGasPath,
  solveSteady,
  surgeMargins,
  vbvScheduleFraction,
  vsvOffsetRad,
  type EnginePoint,
  type OperatingConditions,
  type SizedEngine,
  type SteadySolution,
} from './engine';
import {
  criticalB,
  equilibrium,
  greitzerStep,
  type GreitzerParams,
  type GreitzerState,
} from './greitzer';
import {
  compressionSystem,
  ductVariables,
  engineGreitzerParams,
  greitzerB,
  hpcCubic,
  stallRlineForLoss,
  systemHelmholtzFrequency,
  withStallRline,
  type CompressionSystem,
} from './surgeSystem';
import { P3_DETECTOR_START, feedP3, type P3DecayDetector } from './surgeDetection';
import { solveMatched, type GasPathAnchor, type SolveFailure } from './matchedSolve';
import {
  DECEL_FACTOR,
  EGT_ERROR_SCALE_K,
  EGT_LIMIT_MARGIN_K,
  N1_LIMIT_MARGIN_PERCENT,
  N2_LIMIT_MARGIN_PERCENT,
  TD_EGT,
  TD_LIMIT,
  TF_EGT,
  accelFactor,
  accelLimit,
  clampToSchedules,
  egtAboveRedlineS,
  egtLimitK,
  leverToN1,
  loopRate,
  selectLoop,
  surgeCapOnDetection,
} from './fadec';

export { N1_LIMIT_MARGIN_PERCENT, N2_LIMIT_MARGIN_PERCENT } from './fadec';

/**
 * Spool polar moments of inertia (estimates; no public figure), kg m^2. LP: 24 fan blades of
 * 4.91 kg (NTSB) at a 0.48 m radius of gyration give 27; fan disk and spinner about 3; the
 * 3-stage booster drum about 8; the 4-stage LPT (about 200 kg at 0.36 m) about 26; total about
 * 60. HP: the 9-stage HPC and the HPT (about 250 kg at a 0.2 m radius of gyration) about 10.
 */
export const SPOOL_INERTIA = { lpKgM2: 60, hpKgM2: 10 } as const;

const DT_INTERNAL = 0.02;
/** Light-off delay after fuel and igniters (ENGINE_FACTS lightOffDelay, a model assumption). */
const LIGHT_OFF_DELAY_S = factValue('lightOffDelay');
/** Below this N2 (or unlit, or without fuel) the gas path is the sub-idle similarity model. */
export const SUBIDLE_N2_PERCENT = 57;
/** Start fuel: this multiple of the ground-idle fuel flow times N2 / N2_idle. */
const START_FUEL_FACTOR = 1.2;
/** Air turbine starter: stall torque as a fraction of the idle HPC torque; free-run N2 %. */
const STARTER_STALL_FRACTION = 0.5;
const STARTER_FREE_N2 = 75;
/** Bearing and windage friction: this fraction of the idle compressor torque at idle speed. */
const FRICTION_FRACTION = 0.005;
/** A hung start: N2 rising slower than this (%/s) for HUNG_TIME_S while lit below idle. */
const HUNG_RATE = 0.05;
const HUNG_TIME_S = 10;
/** No light-off: fuel on for this long beyond the light-off delay without lighting. */
const NO_LIGHT_WINDOW_S = 10;
/**
 * An injected surge fault holds the throttle this far inside the surge line (equilibrium at
 * (1 - x) of the peak flow) for SURGE_FAULT_S, as a transient blockage or ingestion would.
 */
const SURGE_FAULT_INSIDE = 0.1;
const SURGE_FAULT_S = 0.1;
/** The episode ends once Phi and Psi are within this fraction of a stable equilibrium. */
const SURGE_RECOVERED = 0.02;
/** Longest episode before the model ends it regardless (a FADEC would shut down), s. */
const SURGE_MAX_S = 5;
/** Greitzer integration step in xi = omega_H t (C9 resolves the limit cycle at 0.01-0.02). */
const SURGE_DXI = 0.02;

interface SurgeEpisode {
  readonly g: GreitzerState;
  readonly params: GreitzerParams;
  readonly omegaH: number;
  readonly elapsedS: number;
  /** An injected fault holds the throttle inside the surge line until this time, s. */
  readonly forcedUntilS: number;
}

export interface CycleModelOptions {
  readonly engine?: SizedEngine;
  /** Test hook: scales the start fuel schedule (hot / hung start cases). */
  readonly startFuelScale?: number;
  /**
   * Scenario hook: loss in HPC surge pressure ratio, Delta PRS = 1 - PRS_reduced / PRS (SAE
   * ARP1420's measure), as a deteriorated or distorted compressor would have. The surge line
   * (the reported margin and the Greitzer cubic's peak) moves down; the map's working line does
   * not. 0 by default.
   */
  readonly hpcSurgeMarginLoss?: number;
  /**
   * Test hook: the matched gas-path solver (engine.ts solveGasPath by default), so that a test
   * can lose a solve on purpose (D4-13).
   */
  readonly gasPathSolver?: typeof solveGasPath;
}

interface Schedules {
  readonly key: string;
  readonly idle: SteadySolution;
  readonly n1TakeoffPercent: number;
  readonly ruN2c: number[];
  readonly ruSteady: number[];
  readonly ruDesign: number;
  readonly hpcTorqueIdleNm: number;
}

interface Snapshot {
  readonly stations: Record<StationId, StationState>;
  readonly netPowerHpW: number;
  readonly netPowerLpW: number;
  readonly netThrustN: number;
  readonly grossThrustN: number;
  readonly fan: MapOperatingPoint;
  readonly hpc: MapOperatingPoint;
  /** Which model gave this gas path (D4-13). */
  readonly solve: GasPathSolveStatus;
}

const conditionsOf = (i: CycleInputs): OperatingConditions => ({
  ambient: i.ambient,
  customerBleedFraction: i.customerBleedFraction,
  powerExtractionW: i.powerExtractionW,
});

/**
 * The lever's two end points at an ambient: ground idle, and the N1 of rated takeoff thrust
 * (flat rated to flatRatingTemperature, then held at that corrected N1 above it).
 */
function leverEnds(e: SizedEngine, ambient: AmbientConditions) {
  const c: OperatingConditions = { ambient, customerBleedFraction: 0, powerExtractionW: 0 };
  const idle = groundIdle(e, c);
  const tFlat = factValue('flatRatingTemperature');
  const ratingAmbient = { ...ambient, temperatureK: Math.min(ambient.temperatureK, tFlat) };
  const rated = solveSteady(
    e,
    { ...c, ambient: ratingAmbient },
    { kind: 'netThrust', value: factValue('takeoffThrust') },
  );
  const n1TakeoffPercent =
    rated.point.n1Percent * Math.sqrt(ambient.temperatureK / ratingAmbient.temperatureK);
  return { c, idle, n1TakeoffPercent };
}

/**
 * The throttle lever whose N1 target holds a given steady net thrust (no bleed or extraction),
 * e.g. the 14 CFR 33.73(b) start point at 15 % of rated takeoff thrust. Inverse of leverToN1.
 */
export function leverForNetThrust(
  thrustN: number,
  ambient: AmbientConditions = ISA_SLS,
  engine: SizedEngine = referenceEngine(),
): number {
  const { c, idle, n1TakeoffPercent } = leverEnds(engine, ambient);
  const s = solveSteady(engine, c, { kind: 'netThrust', value: thrustN }, idle.unknowns);
  const idleN1 = idle.point.n1Percent;
  return (s.point.n1Percent - idleN1) / (n1TakeoffPercent - idleN1);
}

function buildSchedules(e: SizedEngine, ambient: AmbientConditions): Schedules {
  const { c, idle, n1TakeoffPercent } = leverEnds(e, ambient);
  const ruN2c: number[] = [];
  const ruSteady: number[] = [];
  let s = idle;
  const nPts = 10;
  for (let k = 0; k <= nPts + 2; k++) {
    if (k > 0) {
      const n1 =
        idle.point.n1Percent + ((n1TakeoffPercent + 3 - idle.point.n1Percent) * k) / (nPts + 2);
      s = solveSteady(e, c, { kind: 'n1Percent', value: n1 }, s.unknowns);
    }
    ruN2c.push(s.point.n2Percent / Math.sqrt(s.point.stations['2'].ttK / 288.15));
    ruSteady.push(s.point.fuelFlowKgPerS / s.point.stations['3'].ptPa);
  }
  const d = e.design.point;
  return {
    key: JSON.stringify(ambient),
    idle,
    n1TakeoffPercent,
    ruN2c,
    ruSteady,
    ruDesign: d.fuelFlowKgPerS / d.stations['3'].ptPa,
    hpcTorqueIdleNm: idle.point.power.hpc / rpmToRadPerS(idle.point.n2Rpm),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** HPC exit pressure during a surge relative to the matched point's: Psi / Psi_eq, at least 0.2. */
const surgePressureFactor = (g: GreitzerState, eq: GreitzerState) => Math.max(0.2, g.psi / eq.psi);

/**
 * The model's own diagnostics beside the CycleModel contract (W2F-I1): the app's worker reads them
 * and shows them next to `gasPathSolve` (the snapshot contract is unchanged).
 */
export interface CycleDiagnostics {
  /** Why the last matched solve was lost, null when none was lost since the reset. */
  lostSolveCause(): string | null;
}

class TurbofanCycleModel implements CycleModel, CycleDiagnostics {
  readonly source = 'model' as const;
  readonly definition: EngineDefinition;
  private readonly e: SizedEngine;
  private readonly startFuelScale: number;
  private readonly surgeLoss: number;
  private sched!: Schedules;
  private t = 0;
  private n1 = 0;
  private n2 = 0;
  private dn1 = 0;
  private dn2 = 0;
  /** The last converged matched point, the next solve's warm start (D4-13). */
  private anchor!: GasPathAnchor;
  private ru = 0;
  private wf = 0;
  private lit = false;
  private mode: FadecMode = 'off';
  private phase: StartPhase = 'none';
  private limiter: FadecLimiter = 'none';
  private n1Target = 0;
  private starterOn = false;
  private starterCutOut = false;
  private igniters = false;
  private fuelOnTime: number | null = null;
  private hungTimer = 0;
  private egtPrev: number | null = null;
  /**
   * Time the displayed EGT has spent above the takeoff redline, s. TCDS E.004 VI note 4 allows
   * the 960 C transitory limit for 20 s; after that the limiter aims under the redline. The
   * allowance renews once EGT is back under the maximum-continuous limit.
   */
  private egtAboveRedlineS = 0;
  private dEgt = 0;
  private flags: CycleFlags = {
    surge: false,
    flameout: false,
    hungStart: false,
    hotStart: false,
    noLightOff: false,
    n1Overspeed: false,
    n2Overspeed: false,
    egtExceedance: false,
  };
  private pending: CycleFault | null = null;
  private surge: SurgeEpisode | null = null;
  /** The FADEC's surge detector on the sensed P3 (D3-17). */
  private p3Detector: P3DecayDetector = P3_DETECTOR_START;
  /** Simulation time of the last surge detection while the recovery sequence runs, else null. */
  private recoverySinceS: number | null = null;
  /** The decel schedule's Wf/P3 at the last fuel computation (the recovery's cut-back level). */
  private ruDecNow = 0;
  /** The steady line's Wf/P3 at the last fuel computation. */
  private ruSsNow = 0;
  /** Corrected N2 at the last fuel computation, % (the recovery opens the VBVs below closing). */
  private n2cNow = 0;
  /** After a surge: the fraction of the accel schedule's excess over the steady line allowed. */
  private surgeCap: number | null = null;
  private readonly surgeSystem: CompressionSystem;
  private last!: CycleState;
  private readonly solveGas: typeof solveGasPath;
  /** The last converged gas path (matched, or the sub-idle model's), held on a lost solve. */
  private held!: Snapshot;
  /** Matched solves lost since the last reset (D4-13). */
  private lostSolves = 0;
  /** W2F-I1: why the last matched solve was lost (null: none since the reset). */
  private lostCause: string | null = null;
  /** True while the gas path is held: a held episode is logged once, at its first lost solve. */
  private holding = false;
  private inputs: CycleInputs = DEFAULT_CYCLE_INPUTS;

  constructor(definition: EngineDefinition, opts: CycleModelOptions) {
    this.definition = definition;
    this.e = opts.engine ?? referenceEngine();
    this.startFuelScale = opts.startFuelScale ?? 1;
    this.surgeLoss = opts.hpcSurgeMarginLoss ?? 0;
    if (!(this.surgeLoss >= 0 && this.surgeLoss < 1)) {
      throw new Error(`hpcSurgeMarginLoss ${this.surgeLoss} must be in [0, 1)`);
    }
    this.surgeSystem = compressionSystem(definition);
    this.solveGas = opts.gasPathSolver ?? solveGasPath;
  }

  reset(initial: CycleInitialCondition, ambient: AmbientConditions = ISA_SLS): CycleState {
    this.sched = buildSchedules(this.e, ambient);
    this.t = 0;
    this.dn1 = 0;
    this.dn2 = 0;
    this.surge = null;
    this.pending = null;
    this.p3Detector = P3_DETECTOR_START;
    this.recoverySinceS = null;
    this.ruDecNow = 0;
    this.ruSsNow = 0;
    this.n2cNow = 0;
    this.surgeCap = null;
    this.phase = 'none';
    this.starterOn = false;
    this.starterCutOut = false;
    this.fuelOnTime = null;
    this.hungTimer = 0;
    this.egtPrev = null;
    this.egtAboveRedlineS = 0;
    this.dEgt = 0;
    this.flags = {
      ...this.flags,
      ...Object.fromEntries(Object.keys(this.flags).map((k) => [k, false])),
    };
    const idle = this.sched.idle;
    this.anchor = {
      n1Rpm: idle.point.n1Rpm,
      n2Rpm: idle.point.n2Rpm,
      wfKgPerS: idle.point.fuelFlowKgPerS,
      x: idle.unknowns.slice(0, 6),
    };
    if (initial === 'groundIdle') {
      this.n1 = idle.point.n1Rpm;
      this.n2 = idle.point.n2Rpm;
      this.wf = idle.point.fuelFlowKgPerS;
      this.ru = this.wf / idle.point.stations['3'].ptPa / this.sched.ruDesign;
      this.lit = true;
      this.igniters = false;
      this.mode = 'run';
      this.limiter = 'idleFloor';
      this.inputs = { ...DEFAULT_CYCLE_INPUTS, fuelLever: 'run', ignition: 'auto', ambient };
    } else {
      this.n1 = 0;
      this.n2 = 0;
      this.wf = 0;
      this.ru = 0;
      this.lit = false;
      this.igniters = false;
      this.mode = 'off';
      this.limiter = 'none';
      this.inputs = { ...DEFAULT_CYCLE_INPUTS, ambient };
    }
    this.n1Target = 0;
    this.lostSolves = 0;
    this.lostCause = null;
    this.holding = false;
    // the steady idle point is a converged gas path at the ambient (a start replaces it with the
    // sub-idle model's before the matched model is ever tried)
    this.held = this.fromPoint(idle.point);
    this.last = this.compose(this.snapshot(this.inputs));
    return this.last;
  }

  injectFault(fault: CycleFault): void {
    this.pending = fault;
  }

  state(): CycleState {
    return this.last;
  }

  lostSolveCause(): string | null {
    return this.lostCause;
  }

  step(dtS: number, inputs: CycleInputs): CycleState {
    const problems = validateCycleInputs(inputs);
    if (problems.length > 0) throw new Error(`invalid cycle inputs: ${problems.join('; ')}`);
    if (!(dtS >= 0 && dtS <= 1)) throw new Error(`dtS ${dtS} must be in [0, 1] s`);
    if (JSON.stringify(inputs.ambient) !== this.sched.key) {
      this.sched = buildSchedules(this.e, inputs.ambient);
    }
    this.inputs = inputs;
    const n = Math.ceil(dtS / DT_INTERNAL - 1e-9);
    let snap = this.snapshot(inputs);
    for (let i = 0; i < n; i++) snap = this.substep(dtS / n, inputs, snap);
    this.last = this.compose(snap);
    return this.last;
  }

  // -------------------------------------------------------------------------------------

  private pct1(): number {
    return (100 * this.n1) / this.e.calibration.n1ReferenceRpm;
  }

  private pct2(): number {
    return (100 * this.n2) / this.e.calibration.n2ReferenceRpm;
  }

  private substep(dt: number, inp: CycleInputs, prev: Snapshot): Snapshot {
    const cal = this.e.calibration;
    const lim = this.definition.limits;
    if (this.pending === 'flameout') {
      this.lit = false;
      this.flags = { ...this.flags, flameout: true };
      this.fuelOnTime = this.t;
    } else if (this.pending === 'surge' && this.pct2() >= SUBIDLE_N2_PERCENT) {
      // below the sub-idle speed the HPC is not pressurised: nothing to surge, the fault is dropped
      this.startSurge(prev, true);
    }
    this.pending = null;
    const n2p = this.pct2();
    const idleN2 = cal.groundIdleN2Percent;
    const egt = prev.stations['49.5'].ttK + egtShunt(this.definition, this.n2);
    const dEgtRaw = this.egtPrev === null ? 0 : (egt - this.egtPrev) / dt;
    this.dEgt += ((dEgtRaw - this.dEgt) * dt) / TF_EGT;
    this.egtPrev = egt;
    this.egtAboveRedlineS = egtAboveRedlineS(this.egtAboveRedlineS, egt, lim, dt);
    const p3 = prev.stations['3'].ptPa;

    // starter and start sequence
    if (!inp.starter) this.starterCutOut = false;
    this.starterOn = inp.starter && !this.starterCutOut && n2p < factValue('starterCutoutN2');
    if (inp.starter && n2p >= factValue('starterCutoutN2')) this.starterCutOut = true;
    const fuelAllowed =
      inp.fuelLever === 'run' && n2p >= this.definition.startSchedule.minFuelOnN2Percent;
    if (inp.fuelLever === 'cutoff') {
      if (this.mode === 'run' || (this.mode === 'start' && this.fuelOnTime !== null)) {
        this.mode = 'shutdown';
        if (this.phase !== 'none') this.phase = 'aborted';
      }
      this.lit = false;
      this.fuelOnTime = null;
    }
    if (this.mode === 'off' || this.mode === 'shutdown') {
      if (inp.starter && !this.lit && n2p < idleN2) {
        this.mode = 'start';
        this.phase = 'cranking';
      }
    }
    if (this.mode === 'start' && this.phase === 'cranking' && fuelAllowed) {
      this.phase = 'ignition';
      this.fuelOnTime = this.t;
    }
    if (this.mode === 'start' && this.phase === 'cranking' && !inp.starter) this.phase = 'aborted';
    this.igniters =
      inp.ignition === 'continuous' ||
      (inp.ignition === 'auto' &&
        this.fuelOnTime !== null &&
        !this.lit &&
        inp.fuelLever === 'run') ||
      (inp.ignition === 'auto' && this.recovering());
    if (
      !this.lit &&
      this.igniters &&
      this.fuelOnTime !== null &&
      this.t - this.fuelOnTime >= LIGHT_OFF_DELAY_S
    ) {
      this.lit = true;
      if (this.phase === 'ignition') this.phase = 'accelerating';
    }
    if (
      !this.lit &&
      this.fuelOnTime !== null &&
      this.t - this.fuelOnTime > LIGHT_OFF_DELAY_S + NO_LIGHT_WINDOW_S
    ) {
      this.flags = { ...this.flags, noLightOff: true };
    }
    if (this.phase === 'accelerating' && !this.starterOn) this.phase = 'selfSustaining';

    // fuel
    const n2c = n2p / Math.sqrt(prev.stations['2'].ttK / 288.15);
    const ruSs = hermite1(
      this.sched.ruN2c,
      this.sched.ruSteady,
      Math.max(n2c, at(this.sched.ruN2c, 0)),
    );
    const accel = accelFactor(n2c);
    const ruAcc = (accel * ruSs) / this.sched.ruDesign;
    const ruDec = (DECEL_FACTOR * ruSs) / this.sched.ruDesign;
    this.ruDecNow = ruDec;
    this.ruSsNow = ruSs / this.sched.ruDesign;
    this.n2cNow = n2c;
    if (this.mode === 'start' && this.phase !== 'cranking' && this.phase !== 'aborted') {
      this.wf =
        this.startFuelScale *
        START_FUEL_FACTOR *
        this.sched.idle.point.fuelFlowKgPerS *
        (this.n2 / this.sched.idle.point.n2Rpm);
      this.limiter = 'startSchedule';
      if (this.lit && n2p >= idleN2 - 0.3) {
        this.mode = 'run';
        this.phase = 'none';
        this.ru = this.wf / p3 / this.sched.ruDesign;
      }
    } else if (this.mode === 'run') {
      const lever = inp.throttleLever;
      const idleN1 = this.sched.idle.point.n1Percent;
      this.n1Target = leverToN1(lever, idleN1, this.sched.n1TakeoffPercent);
      const rN1 = loopRate(this.n1Target, this.pct1(), this.dn1);
      const rIdle = loopRate(idleN2, n2p, this.dn2);
      const caps: [FadecLimiter, number][] = [
        [
          'n1Max',
          loopRate(
            (100 * lim.n1MaxRpm) / cal.n1ReferenceRpm - N1_LIMIT_MARGIN_PERCENT,
            this.pct1(),
            this.dn1,
            100,
            TD_LIMIT,
          ),
        ],
        [
          'n2Max',
          loopRate(
            (100 * lim.n2MaxRpm) / cal.n2ReferenceRpm - N2_LIMIT_MARGIN_PERCENT,
            n2p,
            this.dn2,
            100,
            TD_LIMIT,
          ),
        ],
        // TCDS E.004 VI note 4: 960 C transitory at takeoff for up to 20 s, then the redline
        [
          'egtMax',
          loopRate(
            egtLimitK(lim, this.egtAboveRedlineS) - EGT_LIMIT_MARGIN_K,
            egt,
            this.dEgt,
            EGT_ERROR_SCALE_K,
            TD_EGT,
          ),
        ],
      ];
      const selected = selectLoop(rN1, rIdle, caps);
      const acc = accelLimit(
        ruAcc,
        ruDec,
        this.ruSsNow,
        this.surgeCap,
        this.recoverySinceS === null ? null : this.t - this.recoverySinceS,
      );
      if (acc.sequenceOver) this.recoverySinceS = null;
      const clamped = clampToSchedules(
        this.ru + selected.rate * dt,
        acc.limit,
        ruDec,
        selected.which,
      );
      this.ru = clamped.ru;
      const which = clamped.which;
      // the acceleration after a surge is over once another loop takes the fuel
      if (this.recoverySinceS === null && which !== 'accelSchedule') this.surgeCap = null;
      this.limiter = which;
      this.wf = this.lit ? this.ru * this.sched.ruDesign * p3 : 0;
    } else {
      this.wf = 0;
      this.limiter = 'none';
    }
    if (this.mode !== 'run' || !this.lit) {
      // the recovery belongs to a running engine; a start, a flameout or a shutdown ends it
      this.recoverySinceS = null;
      this.surgeCap = null;
      this.p3Detector = P3_DETECTOR_START;
    }
    if (this.mode !== 'run' && this.mode !== 'start') this.wf = 0;
    if (!fuelAllowed) this.wf = 0;

    // shaft dynamics with the snapshot at the current state
    const snap = this.snapshot(inp);
    const w1 = Math.max(rpmToRadPerS(this.n1), 1);
    const w2 = Math.max(rpmToRadPerS(this.n2), 1);
    const idleW2 = rpmToRadPerS(this.sched.idle.point.n2Rpm);
    const tauIdle = this.sched.hpcTorqueIdleNm;
    const friction = (w: number) => (FRICTION_FRACTION * tauIdle * w) / idleW2;
    const starter = this.starterOn
      ? STARTER_STALL_FRACTION * tauIdle * Math.max(0, 1 - n2p / STARTER_FREE_N2)
      : 0;
    const a1 = (snap.netPowerLpW / w1 - friction(w1)) / SPOOL_INERTIA.lpKgM2;
    const a2 = (snap.netPowerHpW / w2 + starter - friction(w2)) / SPOOL_INERTIA.hpKgM2;
    const n1Old = this.pct1();
    const n2Old = this.pct2();
    this.n1 = Math.max(0, this.n1 + (a1 * dt * 60) / (2 * Math.PI));
    this.n2 = Math.max(0, this.n2 + (a2 * dt * 60) / (2 * Math.PI));
    this.dn1 = (this.pct1() - n1Old) / dt;
    this.dn2 = (this.pct2() - n2Old) / dt;
    this.t += dt;

    // start supervision
    const inStart = this.mode === 'start';
    if (inStart && egt > lim.egtStartLimitK) this.flags = { ...this.flags, hotStart: true };
    if (inStart && this.lit && this.dn2 < HUNG_RATE) this.hungTimer += dt;
    else this.hungTimer = 0;
    if (this.hungTimer > HUNG_TIME_S) this.flags = { ...this.flags, hungStart: true };
    if (this.mode === 'shutdown' && this.n2 < 1) this.mode = 'off';

    // surge: beyond the surge line in the matched regime
    if (
      this.surge === null &&
      snap.hpc.surgeMarginFraction < 0 &&
      this.pct2() >= SUBIDLE_N2_PERCENT
    ) {
      this.startSurge(snap, false);
    }
    const sensing = this.mode === 'run' && this.lit;
    /** Feeds the FADEC's P3 sensor; true on a detection. */
    const sense = (p3Pa: number, dtS: number): boolean => {
      if (!sensing) return false;
      const r = feedP3(this.p3Detector, p3Pa, dtS);
      this.p3Detector = r.detector;
      return r.surge;
    };
    let detected = this.surge === null && sense(snap.stations['3'].ptPa, dt);
    if (this.surge !== null) {
      const ep = this.surge;
      const sys = this.surgeAt(snap, this.t < ep.forcedUntilS);
      const steps = Math.ceil((sys.omegaH * dt) / SURGE_DXI);
      const eq = equilibrium(sys.params);
      let g = ep.g;
      for (let k = 0; k < steps; k++) {
        g = greitzerStep(sys.params, g, (sys.omegaH * dt) / steps);
        // the P3 sensor follows the plenum pressure through the surge cycle (compose's P3)
        detected =
          sense(snap.stations['3'].ptPa * surgePressureFactor(g, eq), dt / steps) || detected;
      }
      const elapsedS = ep.elapsedS + dt;
      const settled =
        Math.abs(g.phi - eq.phi) <= SURGE_RECOVERED * Math.abs(eq.phi) &&
        Math.abs(g.psi - eq.psi) <= SURGE_RECOVERED * Math.abs(eq.psi);
      const stable = sys.params.b < criticalB(sys.params);
      const done =
        elapsedS >= SURGE_MAX_S ||
        (this.t >= ep.forcedUntilS && elapsedS >= (2 * Math.PI) / sys.omegaH && stable && settled);
      this.surge = done ? null : { ...ep, g, params: sys.params, omegaH: sys.omegaH, elapsedS };
    }
    if (detected) this.startRecovery(prev.stations['3'].ptPa, inp);
    this.flags = { ...this.flags, surge: this.surge !== null };
    return snap;
  }

  private recovering(): boolean {
    return this.recoverySinceS !== null;
  }

  /**
   * The recovery commands the VBVs fully open (D3-17, [UTC77]'s bleed opening) wherever their
   * schedule has them open at all, i.e. below its closing corrected speed. Above it they stay
   * shut: the booster has no stall to guard there, and dumping a quarter of its flow at high
   * power pushes it past its map's choke edge (the D3-14 fit's failure, ENGINE_FACTS).
   */
  private recoveryVbvOpen(): boolean {
    return this.recovering() && this.n2cNow < this.e.calibration.vbv.closedAboveN2cPercent;
  }

  /**
   * D3-17 recovery on a detection: the fuel demand drops to the decel schedule at once (the
   * minimum while running, [UTC93], so the flame stays lit), the VBVs open and the igniters come
   * on ([UTC77], [RR06]); the sequence (re)starts now, and the re-acceleration is biased below the
   * schedule that surged (SURGE_ACCEL_RESET).
   */
  private startRecovery(p3Pa: number, inp: CycleInputs): void {
    this.surgeCap = surgeCapOnDetection(
      this.surgeCap,
      this.recoverySinceS === null ? null : this.t - this.recoverySinceS,
    );
    this.recoverySinceS = this.t;
    this.ru = Math.min(this.ru, this.ruDecNow);
    this.wf = this.ru * this.sched.ruDesign * p3Pa;
    if (inp.ignition === 'auto') this.igniters = true;
  }

  /**
   * The engine's Greitzer system at a state: B and omega_H at the current N2 and T3, the cubic
   * of the HPC speed line at the current corrected speed, the throttle through the matched HPC
   * point (held inside the surge line while an injected fault lasts).
   */
  private surgeAt(snap: Snapshot, forced: boolean): { params: GreitzerParams; omegaH: number } {
    const st = snap.stations;
    const r = gasConstant(0);
    const t3 = st['3'].ttK;
    const a3 = Math.sqrt(gamma(t3, 0) * r * t3);
    const inlet = { pt25Pa: st['25'].ptPa, tt25K: st['25'].ttK, n2Rpm: this.n2, rJPerKgK: r };
    const speed = this.n2 / Math.sqrt(inlet.tt25K / 288.15) / this.e.design.corrSpeed.hpc;
    const map = withStallRline(
      this.e.maps.hpc,
      stallRlineForLoss(this.e.maps.hpc, speed, this.surgeLoss),
    );
    const fit = hpcCubic(map, speed, this.surgeSystem, inlet);
    const op = ductVariables(
      this.surgeSystem,
      inlet,
      snap.hpc.correctedFlowKgPerS,
      snap.hpc.pressureRatio,
    );
    const peak = 2 * fit.w;
    // the cubic is positive up to Phi = 3W (x = 2), so the throttle line is defined there
    const phiOp = Math.min(op.phi, 1.5 * peak);
    const phiEq = forced ? Math.min(phiOp, (1 - SURGE_FAULT_INSIDE) * peak) : phiOp;
    const b = greitzerB(this.surgeSystem, this.n2, a3);
    return {
      params: engineGreitzerParams(fit, b, phiEq),
      omegaH: systemHelmholtzFrequency(this.surgeSystem, a3),
    };
  }

  private startSurge(snap: Snapshot, injected: boolean): void {
    const forcedUntilS = injected ? this.t + SURGE_FAULT_S : this.t;
    const sys = this.surgeAt(snap, injected);
    const eq = equilibrium(sys.params);
    this.surge = {
      g: { phi: eq.phi * 0.95, psi: eq.psi },
      params: sys.params,
      omegaH: sys.omegaH,
      elapsedS: 0,
      forcedUntilS,
    };
  }

  private snapshot(inp: CycleInputs): Snapshot {
    const c: OperatingConditions = this.recoveryVbvOpen()
      ? { ...conditionsOf(inp), vbvFraction: this.e.calibration.vbv.maxFraction }
      : conditionsOf(inp);
    if (!(this.lit && this.pct2() >= SUBIDLE_N2_PERCENT && this.wf > 0)) {
      // a genuine sub-idle state: a start, a windmill, a shutdown. It ends a held episode, so
      // the next loss above sub-idle is logged as a new one (W2A-N6)
      this.holding = false;
      this.held = this.subIdle(c);
      return this.held;
    }
    // converged on a physical root, directly or by continuation from the last converged point
    const why: SolveFailure = { cause: null };
    const s = solveMatched(this.solveGas, this.e, c, this.anchor, this.n1, this.n2, this.wf, why);
    if (s !== null) {
      this.holding = false;
      this.anchor = { n1Rpm: this.n1, n2Rpm: this.n2, wfKgPerS: this.wf, x: s.x };
      this.held = this.fromPoint(s.point);
      return this.held;
    }
    // D4-13: lost; never the similarity model above the switch. The next try starts from the
    // last converged point again (the anchor does not move).
    this.lostSolves++;
    this.lostCause = why.cause ?? 'no attempt was made';
    if (!this.holding) {
      // W2F-I1: once per held episode, with its cause (the app's diagnostics show it too)
      console.warn(
        `[cycle] matched gas-path solve lost at N2 ${this.pct2().toFixed(1)} %: ${this.lostCause}`,
      );
      this.holding = true;
    }
    return { ...this.held, solve: 'held' };
  }

  /** The HPC margin against the surge line lowered by hpcSurgeMarginLoss: (1 + m)(1 - loss) - 1. */
  private hpcMargin(margin: number): number {
    return (1 + margin) * (1 - this.surgeLoss) - 1;
  }

  private mapPoint(
    p: { correctedFlow: number; pressureRatio: number; efficiency: number },
    rpm: number,
    tt: number,
    ref: number,
    margin: number,
  ): MapOperatingPoint {
    return {
      correctedFlowKgPerS: p.correctedFlow,
      pressureRatio: p.pressureRatio,
      isentropicEfficiency: clamp(p.efficiency, 0, 1),
      correctedSpeedFraction: rpm / Math.sqrt(tt / 288.15) / ref,
      surgeMarginFraction: margin,
    };
  }

  private fromPoint(p: EnginePoint): Snapshot {
    const m = surgeMargins(this.e, p);
    const cal = this.e.calibration;
    return {
      stations: { ...p.stations },
      netPowerHpW: p.netPowerHpW,
      netPowerLpW: p.netPowerLpW,
      netThrustN: p.netThrustN,
      grossThrustN: p.grossThrustN,
      fan: this.mapPoint(p.fan.point, p.n1Rpm, p.stations['2'].ttK, cal.n1ReferenceRpm, m.fan),
      hpc: this.mapPoint(
        p.hpc.point,
        p.n2Rpm,
        p.stations['25'].ttK,
        cal.n2ReferenceRpm,
        this.hpcMargin(m.hpc),
      ),
      solve: 'matched',
    };
  }

  /** The similarity sub-idle model anchored at ground idle (see the header). */
  private subIdle(c: OperatingConditions): Snapshot {
    const a = this.sched.idle.point;
    const s = a.stations;
    const cal = this.e.calibration;
    const r = this.n2 / a.n2Rpm;
    const q = this.n1 / a.n1Rpm;
    const p0 = c.ambient.pressurePa;
    const t2 = s['2'].ttK;
    const p2 = s['2'].ptPa;
    const pr = (k: number, ratio: number) => 1 + (ratio - 1) * k * k;
    const rise = (k: number, tt: number) => t2 + (tt - t2) * k * k;
    const w13 = s['13'].wKgPerS * q;
    const w25 = s['25'].wKgPerS * r;
    const w2 = w13 + w25;
    const t3 = rise(r, s['3'].ttK);
    const p3 = p2 * pr(r, s['3'].ptPa / p2);
    const wCool = cal.turbineCoolingFraction * w25;
    const wComb = Math.max(w25 - wCool, 1e-9);
    const wf = this.wf;
    const far4 = Math.min(wf / wComb, 0.05);
    const h3 = enthalpy(t3, 0);
    const etaB = this.lit ? cal.efficiencies.combustor : 0;
    const h4 = (wComb * h3 + etaB * wf * cal.fuelLhvJPerKg) / (wComb + wf);
    const t4 = temperatureFromEnthalpy(h4, far4);
    const w41 = wComb + wf + wCool;
    const far41 = Math.min(wf / (wComb + wCool), 0.05);
    const h41 = ((wComb + wf) * h4 + wCool * h3) / w41;
    const t41 = temperatureFromEnthalpy(h41, far41);
    const expansion = (k: number, prA: number) =>
      (1 - Math.pow(pr(k, prA), -0.25)) / (1 - Math.pow(prA, -0.25));
    const pHpt =
      a.power.hpt *
      (w41 / s['41'].wKgPerS) *
      (t41 / s['41'].ttK) *
      expansion(r, a.hpt.pressureRatio);
    const h45 = h41 - pHpt / w41;
    const t45 = temperatureFromEnthalpy(h45, far41);
    const pLpt =
      a.power.lpt *
      (w41 / s['45'].wKgPerS) *
      (t45 / s['45'].ttK) *
      expansion(r, a.lpt.pressureRatio);
    const t5 = temperatureFromEnthalpy(h45 - pLpt / w41, far41);
    const t495 = temperatureFromEnthalpy(h45 - (cal.egtProbeLptWorkFraction * pLpt) / w41, far41);
    // mechanical losses follow the spool speed as in the gas path (engine.ts), so the two agree
    const mech = cal.mechanicalLossSpeedExponent;
    const netHp =
      pHpt - a.mechanicalLossW.hp * r ** mech - a.power.hpc * r * r * r - c.powerExtractionW;
    const netLp = pLpt - a.mechanicalLossW.lp * q ** mech - (a.power.fan + a.power.lpc) * q * q * q;
    const pt4 = p3 * (1 - cal.combustorPressureLossFraction);
    // pressures below the anchor's expansion are not resolved; never below ambient
    const pt45 = Math.max(p0, pt4 / pr(r, a.hpt.pressureRatio));
    const pt5 = Math.max(p0, pt45 / pr(r, a.lpt.pressureRatio));
    const pt13 = p2 * pr(q, s['13'].ptPa / p2);
    const st = (pt: number, tt: number, w: number, far = 0): StationState => ({
      ptPa: pt,
      ttK: tt,
      wKgPerS: w,
      fuelAirRatio: far,
    });
    const t13 = rise(q, s['13'].ttK);
    const stations: Record<StationId, StationState> = {
      '0': { ...s['0'], wKgPerS: w2 },
      '1': st(p2, t2, w2),
      '2': st(p2, t2, w2),
      '13': st(pt13, t13, w13),
      '18': st(Math.max(p0, pt13 * (1 - cal.bypassDuctPtLoss)), t13, w13),
      '19': st(Math.max(p0, pt13 * (1 - cal.bypassDuctPtLoss)), t13, w13),
      '21': st(p2 * pr(q, s['21'].ptPa / p2), rise(q, s['21'].ttK), w25),
      '24': st(p2 * pr(r, s['24'].ptPa / p2), rise(r, s['24'].ttK), w25),
      '25': st(p2 * pr(r, s['25'].ptPa / p2), rise(r, s['25'].ttK), w25),
      '3': st(p3, t3, w25),
      '4': st(pt4, t4, wComb + wf, far4),
      '41': st(pt4, t41, w41, far41),
      '45': st(pt45, t45, w41, far41),
      '49.5': st(
        Math.max(p0, pt45 / Math.pow(pr(r, a.lpt.pressureRatio), cal.egtProbeLptWorkFraction)),
        t495,
        w41,
        far41,
      ),
      '5': st(pt5, t5, w41, far41),
      '8': st(Math.max(p0, pt5 * (1 - cal.coreNozzlePtLoss)), t5, w41, far41),
      '9': st(Math.max(p0, pt5 * (1 - cal.coreNozzlePtLoss)), t5, w41, far41),
    };
    const m = surgeMargins(this.e, a);
    const fanPoint = {
      correctedFlow: a.fan.point.correctedFlow * q,
      pressureRatio: pr(q, a.fan.point.pressureRatio),
      efficiency: a.fan.point.efficiency,
    };
    const hpcPoint = {
      correctedFlow: a.hpc.point.correctedFlow * r,
      pressureRatio: pr(r, a.hpc.point.pressureRatio),
      efficiency: a.hpc.point.efficiency,
    };
    return {
      stations,
      netPowerHpW: netHp,
      netPowerLpW: netLp,
      netThrustN: a.netThrustN * q * q,
      grossThrustN: a.grossThrustN * q * q,
      fan: this.mapPoint(fanPoint, this.n1, t2, cal.n1ReferenceRpm, m.fan),
      hpc: this.mapPoint(hpcPoint, this.n2, s['25'].ttK, cal.n2ReferenceRpm, this.hpcMargin(m.hpc)),
      solve: 'subIdle',
    };
  }

  private compose(snap: Snapshot): CycleState {
    const cal = this.e.calibration;
    const lim = this.definition.limits;
    let stations = snap.stations;
    let hpc = snap.hpc;
    let thrustScale = 1;
    if (this.surge !== null) {
      // the HPC exit follows the Greitzer state; reverse flow shows as zero (StationState.w >= 0)
      const eq = equilibrium(this.surge.params);
      const fr = this.surge.g.phi / eq.phi;
      const pr = surgePressureFactor(this.surge.g, eq);
      const s3 = stations['3'];
      stations = {
        ...stations,
        '3': { ...s3, ptPa: s3.ptPa * pr, wKgPerS: s3.wKgPerS * Math.max(0, fr) },
      };
      hpc = {
        ...hpc,
        pressureRatio: hpc.pressureRatio * pr,
        surgeMarginFraction: Math.min(hpc.surgeMarginFraction, -0.01),
      };
      thrustScale = 0.6 + 0.4 * clamp(fr, 0, 1);
    }
    const egtMeasured = stations['49.5'].ttK;
    const egtDisplayed = egtMeasured + egtShunt(this.definition, this.n2);
    const fn = snap.netThrustN * thrustScale;
    const t2 = stations['2'].ttK;
    const n2c = this.pct2() / Math.sqrt(t2 / 288.15);
    const vsv = this.definition.vsvSchedules[0];
    // the displayed schedule stands for the HPC map's own; D3-11 adds the fitted offset
    const vsvClosure =
      vsv === undefined
        ? 0
        : vsvOffsetRad(cal, n2c) +
          hermite1(
            vsv.points.map((p) => p.n2CorrectedPercent),
            vsv.points.map((p) => p.closure),
            clamp(
              n2c,
              at(vsv.points, 0).n2CorrectedPercent,
              at(vsv.points, vsv.points.length - 1).n2CorrectedPercent,
            ),
          );
    const flags: CycleFlags = {
      ...this.flags,
      n1Overspeed: this.n1 > lim.n1MaxRpm,
      n2Overspeed: this.n2 > lim.n2MaxRpm,
      // W1C-N5: above the transitory limit at any time, or above the redline for longer than the
      // 20 s the TCDS allows
      egtExceedance:
        this.mode === 'start'
          ? egtDisplayed > lim.egtStartLimitK
          : egtDisplayed > lim.egtTransientK ||
            (egtDisplayed > lim.egtTakeoffRedlineK &&
              this.egtAboveRedlineS > lim.egtTransientDurationS),
    };
    return {
      timeS: this.t,
      n1Rpm: this.n1,
      n2Rpm: this.n2,
      n1Percent: (100 * this.n1) / cal.n1ReferenceRpm,
      n2Percent: (100 * this.n2) / cal.n2ReferenceRpm,
      stations,
      fuelFlowKgPerS: this.wf,
      grossThrustN: snap.grossThrustN * thrustScale,
      netThrustN: fn,
      tsfcKgPerNs: fn > 0 ? this.wf / fn : null,
      egtDisplayedK: egtDisplayed,
      egtMeasuredK: egtMeasured,
      fan: snap.fan,
      hpc,
      vsvClosureRad: Math.max(0, vsvClosure),
      vbvOpenFraction: this.recoveryVbvOpen()
        ? 1
        : cal.vbv.maxFraction > 0
          ? vbvScheduleFraction(cal, n2c) / cal.vbv.maxFraction
          : 0,
      starterEngaged: this.starterOn,
      ignitersOn: this.igniters,
      combustorLit: this.lit,
      fadec: { mode: this.mode, limiter: this.limiter, n1TargetPercent: this.n1Target },
      startPhase: this.phase,
      flags,
      gasPathSolve: { status: snap.solve, lostSolves: this.lostSolves },
    };
  }
}

/** The W1 transient cycle model on the reference engine (or a given sized engine). */
export function createCycleModel(
  opts: CycleModelOptions = {},
  definition: EngineDefinition = ENGINE_DEFINITION,
): CycleModel & CycleDiagnostics {
  const m = new TurbofanCycleModel(definition, opts);
  m.reset('shutdown');
  return m;
}
