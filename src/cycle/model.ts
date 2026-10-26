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
  systemHelmholtzFrequency,
  type CompressionSystem,
} from './surgeSystem';

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
const SUBIDLE_N2_PERCENT = 57;
/** FADEC gains: integrator rate per unit fractional error (1/s), rate-feedback time (s). */
const K_LOOP = 2;
const TD = 0.7;
/**
 * Rate feedback of the overspeed limiters, s (short, so they act only near the limit). 0.5 (0.3
 * before W1C-N5) holds a slam overshoot to about 0.1 point, which the 0.5-point N1 margin needs.
 */
const TD_LIMIT = 0.5;
/**
 * Rate feedback of the EGT limiter, s: the lead that stops the fuel ramp before the 960 C
 * transient limit instead of after it (the EGT rises at several hundred K/s in a slam accel).
 * EGT follows the fuel flow almost algebraically, so the raw derivative would feed the loop's own
 * output back and chatter; it is filtered first-order with TF_EGT = TD_EGT / 3, the usual
 * derivative filter (K. J. Astrom and T. Hagglund, PID Controllers, 2nd ed., ISA 1995, 3.3:
 * TD / N with N = 2-20).
 */
const TD_EGT = 0.3;
const TF_EGT = TD_EGT / 3;
/**
 * EGT error that drives the Wf/P3 rate by K_LOOP x K_LIMIT_FACTOR per second, K. 150 K holds a
 * slam from ground idle under the 960 C transitory limit (33.73(a)); 100 K makes an EGT-limited
 * steady point chatter between the EGT and N1 loops.
 */
const EGT_ERROR_SCALE_K = 150;
/**
 * Accel/decel schedules as multiples of the steady Wf/P3 at the same corrected N2. 1.8 (2.2
 * before W1C-I1) keeps a ground-idle slam out of surge (min HPC margin 0.034) now that the idle
 * working line carries the part-power losses: the HP mechanical loss, the clearance penalty and
 * the VBV dump raise the low-speed HPC operating line, so the steady Wf/P3 sits closer to surge.
 */
const ACCEL_FACTOR = 1.8;
/** The accel schedule opens up by this much more between 68 and 80 % corrected N2. */
const ACCEL_FACTOR_HIGH = 0.3;
/**
 * Overspeed limiter targets sit this many points under the TCDS N1 / N2 limits. N1: 0.5: the
 * 30 C flat-rating corner (rated thrust at 103.5 % N1) is at the limiter target, so the transient
 * model makes rated thrust there (W1C-N5); a corner slam overshoots the target by 0.1 point with
 * TD_LIMIT 0.5 (0.5 with 0.3, which took N1 to 104.02 %).
 */
export const N1_LIMIT_MARGIN_PERCENT = 0.5;
export const N2_LIMIT_MARGIN_PERCENT = 1;
/** The EGT limiter aims this far under the active displayed-EGT limit, K. */
const EGT_LIMIT_MARGIN_K = 5;
/** Limiter loops run at this multiple of K_LOOP, so they bite hard near their limits only. */
const K_LIMIT_FACTOR = 4;
const DECEL_FACTOR = 0.6;
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
/** The FADEC's fuel cut at surge onset (stall recovery), fraction of the Wf/P3 demand. */
const SURGE_FUEL_CUT = 0.25;
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

/** The FADEC's lever schedule: N1 target linear in the lever from ground idle to takeoff. */
function leverToN1(lever: number, idleN1: number, takeoffN1: number): number {
  return lever <= 0 ? 0 : idleN1 + lever * (takeoffN1 - idleN1);
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

class TurbofanCycleModel implements CycleModel {
  readonly source = 'model' as const;
  readonly definition: EngineDefinition;
  private readonly e: SizedEngine;
  private readonly startFuelScale: number;
  private sched!: Schedules;
  private t = 0;
  private n1 = 0;
  private n2 = 0;
  private dn1 = 0;
  private dn2 = 0;
  private x: number[] = [];
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
  private readonly surgeSystem: CompressionSystem;
  private last!: CycleState;
  private inputs: CycleInputs = DEFAULT_CYCLE_INPUTS;

  constructor(definition: EngineDefinition, opts: CycleModelOptions) {
    this.definition = definition;
    this.e = opts.engine ?? referenceEngine();
    this.startFuelScale = opts.startFuelScale ?? 1;
    this.surgeSystem = compressionSystem(definition);
  }

  reset(initial: CycleInitialCondition, ambient: AmbientConditions = ISA_SLS): CycleState {
    this.sched = buildSchedules(this.e, ambient);
    this.t = 0;
    this.dn1 = 0;
    this.dn2 = 0;
    this.surge = null;
    this.pending = null;
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
    this.x = [...idle.unknowns.slice(0, 6)];
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
    this.last = this.compose(this.snapshot(this.inputs));
    return this.last;
  }

  injectFault(fault: CycleFault): void {
    this.pending = fault;
  }

  state(): CycleState {
    return this.last;
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

  /** The displayed-EGT limit in force: transitory while the 20 s allowance lasts, else the redline. */
  private egtLimitK(): number {
    const lim = this.definition.limits;
    return this.egtAboveRedlineS < lim.egtTransientDurationS
      ? lim.egtTransientK
      : Math.min(lim.egtTransientK, lim.egtTakeoffRedlineK);
  }

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
    if (egt > lim.egtTakeoffRedlineK) this.egtAboveRedlineS += dt;
    else if (egt <= lim.egtMaxContinuousK) this.egtAboveRedlineS = 0;
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
      (inp.ignition === 'auto' && this.fuelOnTime !== null && !this.lit && inp.fuelLever === 'run');
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
    const accel = ACCEL_FACTOR + ACCEL_FACTOR_HIGH * clamp((n2c - 68) / 12, 0, 1);
    const ruAcc = (accel * ruSs) / this.sched.ruDesign;
    const ruDec = (DECEL_FACTOR * ruSs) / this.sched.ruDesign;
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
      const loop = (target: number, value: number, rate: number, scale = 100, td = TD) =>
        K_LOOP * ((target - value) / scale - (td * rate) / scale);
      const rN1 = loop(this.n1Target, this.pct1(), this.dn1);
      const rIdle = loop(idleN2, n2p, this.dn2);
      let rate = Math.max(rN1, rIdle);
      let which: FadecLimiter = rN1 >= rIdle ? 'n1Target' : 'idleFloor';
      const caps: [FadecLimiter, number][] = [
        [
          'n1Max',
          loop(
            (100 * lim.n1MaxRpm) / cal.n1ReferenceRpm - N1_LIMIT_MARGIN_PERCENT,
            this.pct1(),
            this.dn1,
            100,
            TD_LIMIT,
          ),
        ],
        [
          'n2Max',
          loop(
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
          loop(this.egtLimitK() - EGT_LIMIT_MARGIN_K, egt, this.dEgt, EGT_ERROR_SCALE_K, TD_EGT),
        ],
      ];
      for (const [name, rLimit] of caps) {
        const r = K_LIMIT_FACTOR * rLimit;
        if (r < rate) {
          rate = r;
          which = name;
        }
      }
      this.ru += rate * dt;
      if (this.ru > ruAcc) {
        this.ru = ruAcc;
        which = 'accelSchedule';
      } else if (this.ru < ruDec) {
        this.ru = ruDec;
        which = 'decelSchedule';
      }
      this.limiter = which;
      this.wf = this.lit ? this.ru * this.sched.ruDesign * p3 : 0;
    } else {
      this.wf = 0;
      this.limiter = 'none';
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
    if (this.surge !== null) {
      const ep = this.surge;
      const sys = this.surgeAt(snap, this.t < ep.forcedUntilS);
      const steps = Math.ceil((sys.omegaH * dt) / SURGE_DXI);
      let g = ep.g;
      for (let k = 0; k < steps; k++) g = greitzerStep(sys.params, g, (sys.omegaH * dt) / steps);
      const elapsedS = ep.elapsedS + dt;
      const eq = equilibrium(sys.params);
      const settled =
        Math.abs(g.phi - eq.phi) <= SURGE_RECOVERED * Math.abs(eq.phi) &&
        Math.abs(g.psi - eq.psi) <= SURGE_RECOVERED * Math.abs(eq.psi);
      const stable = sys.params.b < criticalB(sys.params);
      const done =
        elapsedS >= SURGE_MAX_S ||
        (this.t >= ep.forcedUntilS && elapsedS >= (2 * Math.PI) / sys.omegaH && stable && settled);
      this.surge = done ? null : { ...ep, g, params: sys.params, omegaH: sys.omegaH, elapsedS };
    }
    this.flags = { ...this.flags, surge: this.surge !== null };
    return snap;
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
    const fit = hpcCubic(this.e.maps.hpc, speed, this.surgeSystem, inlet);
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
    this.ru *= 1 - SURGE_FUEL_CUT;
  }

  private snapshot(inp: CycleInputs): Snapshot {
    const c = conditionsOf(inp);
    if (this.lit && this.pct2() >= SUBIDLE_N2_PERCENT && this.wf > 0) {
      const s = solveGasPath(this.e, c, this.n1, this.n2, this.wf, this.x);
      // a converged but non-physical root (BPR near zero) falls back to the similarity model
      if (s.maxResidual < 1e-6 && at(s.x, 1) > 1) {
        this.x = [...s.x];
        return this.fromPoint(s.point);
      }
    }
    return this.subIdle(c);
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
      hpc: this.mapPoint(p.hpc.point, p.n2Rpm, p.stations['25'].ttK, cal.n2ReferenceRpm, m.hpc),
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
      hpc: this.mapPoint(hpcPoint, this.n2, s['25'].ttK, cal.n2ReferenceRpm, m.hpc),
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
      const pr = Math.max(0.2, this.surge.g.psi / eq.psi);
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
    const vsvClosure =
      vsv === undefined
        ? 0
        : hermite1(
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
      vbvOpenFraction:
        cal.vbv.maxFraction > 0 ? vbvScheduleFraction(cal, n2c) / cal.vbv.maxFraction : 0,
      starterEngaged: this.starterOn,
      ignitersOn: this.igniters,
      combustorLit: this.lit,
      fadec: { mode: this.mode, limiter: this.limiter, n1TargetPercent: this.n1Target },
      startPhase: this.phase,
      flags,
    };
  }
}

/** The W1 transient cycle model on the reference engine (or a given sized engine). */
export function createCycleModel(
  opts: CycleModelOptions = {},
  definition: EngineDefinition = ENGINE_DEFINITION,
): CycleModel {
  const m = new TurbofanCycleModel(definition, opts);
  m.reset('shutdown');
  return m;
}
