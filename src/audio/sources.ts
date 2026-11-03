// The engine sound's source model (D5-4, PHYSICS.md 3.6 and 2.4): a cycle state, the ambient and
// the listener's angle become one SoundFrame for the synth. Pure; the main thread runs it at the
// snapshot rate.
//
// Physics or exact (PHYSICS.md 1, "Engine sound"): every tone's frequency (order x N / 60 with the
// definition's blade counts), the buzz-saw's onset at the fan's relative tip Mach 1 (from N1, the
// definition's fan tip radius and the fan face's total temperature and axial Mach), Lighthill's
// U_j^8 law for each jet stream from the cycle model's own nozzle exit velocity, density and area,
// the jet spectrum's Strouhal peak, and the event gating (starter, igniters, combustion, surge).
// Synthesized on physical trends: the levels (scalings below, with mix constants chosen by ear),
// the spectral shapes (biquad bands) and the directivity lobes.

import type { AmbientConditions } from '../contracts/ambient';
import type { CycleState, StationState } from '../contracts/cycle';
import type { EngineDefinition } from '../contracts/engine';
import { nozzle } from '../cycle/engine';
import { factValue } from '../engine/facts';
import { gamma, gasConstant } from '../thermo/gas';
import { Noise } from './dsp';
import {
  NOISE_VOICES,
  toneFrequencyHz,
  toneVoices,
  type SoundFrame,
  type ToneVoice,
} from './params';

/** ENGINE_FACTS starterSpeedRatio (unknown for the CFM56-7B: an estimate, labelled). */
export const STARTER_SPEED_RATIO = factValue('starterSpeedRatio');
/** ENGINE_FACTS igniterSparkRate (unknown for the CFM56-7B: a generic exciter's). */
export const IGNITER_SPARK_RATE_HZ = factValue('igniterSparkRate');

// ---------------------------------------------------------------------------------------
// The fan's relative tip Mach (A2)

export function fanTipRadiusM(def: EngineDefinition): number {
  return fanRow(def).leadingEdge.tip.r;
}

/** The fan face's annulus at the fan rotor's leading edge, m^2. */
export function fanFaceAnnulusM2(def: EngineDefinition): number {
  const le = fanRow(def).leadingEdge;
  return Math.PI * (le.tip.r * le.tip.r - le.hub.r * le.hub.r);
}

function fanRow(def: EngineDefinition) {
  const r = def.bladeRows.find((b) => b.id === 'fan');
  if (r === undefined) throw new Error('the definition has no fan row');
  return r;
}

/**
 * The subsonic axial Mach that passes w through the annulus at (pt, tt): the inverse of the
 * mass-flow function W sqrt(Tt) / (Pt A) = M sqrt(g / R) (1 + (g - 1) M^2 / 2)^(-(g + 1) / (2 (g - 1)))
 * (air, g and R of the thermally perfect gas at Tt), by bisection; held at 1 beyond the choke.
 */
export function fanFaceAxialMach(w: number, pt: number, tt: number, areaM2: number): number {
  if (!(w > 0)) return 0;
  const g = gamma(tt, 0);
  const r = gasConstant(0);
  const target = (w * Math.sqrt(tt)) / (pt * areaM2);
  const mfp = (m: number) =>
    m * Math.sqrt(g / r) * (1 + ((g - 1) / 2) * m * m) ** (-(g + 1) / (2 * (g - 1)));
  if (target >= mfp(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mfp(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** M_rel,tip = sqrt(M_x^2 + (U_tip / a)^2) at the fan face's static temperature. */
export function fanTipRelativeMach(c: CycleState, def: EngineDefinition): number {
  const st = c.stations['2'];
  const m = fanFaceAxialMach(st.wKgPerS, st.ptPa, st.ttK, fanFaceAnnulusM2(def));
  const g0 = gamma(st.ttK, 0);
  const ts = st.ttK / (1 + ((g0 - 1) / 2) * m * m);
  const a = Math.sqrt(gamma(ts, 0) * gasConstant(0) * ts);
  const u = ((2 * Math.PI * c.n1Rpm) / 60) * fanTipRadiusM(def);
  return Math.sqrt(m * m + (u / a) ** 2);
}

/** The buzz-saw starts where the fan's tip goes supersonic relative to the blade (A2). */
export const BUZZ_SAW_ONSET_MACH = 1;

/**
 * The summed engine-order power over the blade-pass tone's, dB (synthesized on the trend: none
 * at a subsonic tip, rising through the onset as the shocks strengthen, -6 dB at M_rel 1.05 and
 * +3 dB from 1.30, where the buzz-saw dominates the forward arc at take-off).
 */
export function buzzSawLevelDb(mRel: number): number {
  if (!(mRel > BUZZ_SAW_ONSET_MACH)) return Number.NEGATIVE_INFINITY;
  const s = Math.min(1, (mRel - BUZZ_SAW_ONSET_MACH) / 0.05);
  const onset = s * s * (3 - 2 * s);
  const full = -6 + 9 * Math.min(1, Math.max(0, (mRel - 1.05) / 0.25));
  return full + 20 * Math.log10(onset);
}

/**
 * The engine orders' share of the buzz-saw (k = 1 .. B - 1, sum of squares 1): a broad hump about
 * B / 3 with a fixed, seeded +-4 dB scatter per order, standing for the blade-to-blade differences
 * of shock strength and spacing that put energy into every order (synthesized).
 */
export function buzzSawShape(bladeCount: number): number[] {
  const n = new Noise(bladeCount * 7919);
  const peak = bladeCount / 3;
  const p: number[] = [];
  for (let k = 1; k < bladeCount; k++) {
    const hump = Math.exp(-0.5 * (Math.log(k / peak) / 0.6) ** 2);
    p.push(hump * 10 ** ((4 * n.uniform()) / 10));
  }
  const sum = p.reduce((s, v) => s + v, 0);
  return p.map((v) => Math.sqrt(v / sum));
}

// ---------------------------------------------------------------------------------------
// Jet mixing noise (A3)

export interface JetStream {
  readonly velocity: number;
  readonly density: number;
  readonly areaM2: number;
  /** The equivalent diameter sqrt(4 A / pi), the Strouhal length. */
  readonly diameterM: number;
}

/** A nozzle stream from its station: the cycle model's convergent nozzle (cycle/engine.ts). */
export function jetStream(st: StationState, pAmbPa: number, areaM2: number): JetStream {
  const n = nozzle(st.ptPa, st.ttK, st.fuelAirRatio, pAmbPa);
  const density =
    n.velocity > 0 ? n.flux / n.velocity : pAmbPa / (gasConstant(st.fuelAirRatio) * st.ttK);
  return { velocity: n.velocity, density, areaM2, diameterM: Math.sqrt((4 * areaM2) / Math.PI) };
}

/**
 * Lighthill's acoustic power of a jet (M. J. Lighthill, "On sound generated aerodynamically I",
 * Proc. R. Soc. A 211, 1952): P ~ (rho_j^2 / rho_inf) U^8 A / a_inf^5, the source scale rho_j U^2
 * of his stress tensor rho u_i u_j. Here in units of rho_inf a_inf^3 x 1 m^2 with the constant 1:
 * (rho_j / rho_inf)^2 (U / a_inf)^8 A. Above U = a_inf it is continued as U^3 (the high-speed limit
 * of Ffowcs Williams, Phil. Trans. R. Soc. A 255, 1963), an assumption; A3's slope is over the
 * subsonic range. The hot-jet density exponent of the data (SAE ARP876) is not modelled.
 */
export function lighthillPower(
  u: number,
  rhoJet: number,
  rhoAmb: number,
  aAmb: number,
  areaM2: number,
): number {
  if (!(u > 0)) return 0;
  const m = u / aAmb;
  const base = (rhoJet / rhoAmb) ** 2 * areaM2;
  return m <= 1 ? base * m ** 8 : base * m ** 3;
}

/** The aft peak angle of jet mixing noise (A4: 140-160 deg), deg from the inlet axis. */
export const JET_PEAK_DEG = 150;
/** The large-scale mixing noise's peak Strouhal number at the aft peak angle (A3: 0.15-0.3). */
export const JET_STROUHAL_LARGE = 0.2;
/** The fine-scale noise's (sideline) peak Strouhal number (synthesized). */
export const JET_STROUHAL_FINE = 0.6;
/** The fine-scale noise's share of the stream's power at its own peak (-8 dB; synthesized). */
export const JET_FINE_SHARE = 10 ** (-8 / 10);
/** Mixes the jet's Lighthill power against the fan's tones (synthesized, by ear). */
const K_JET = 4;
const JET_Q_LARGE = 1.2;
const JET_Q_FINE = 0.6;

export interface NoiseBand {
  readonly hz: number;
  readonly q: number;
  readonly amp: number;
}

const clampHz = (f: number) => Math.min(18_000, Math.max(20, f));

/** A stream's two noise bands at the listener's angle (Tam's two-source picture, synthesized). */
export function jetNoise(
  j: JetStream,
  ambient: AmbientConditions,
  thetaRad: number,
): { readonly large: NoiseBand; readonly fine: NoiseBand } {
  const t = ambient.temperatureK;
  const r = gasConstant(0);
  const rhoAmb = ambient.pressurePa / (r * t);
  const aAmb = Math.sqrt(gamma(t, 0) * r * t);
  const p = K_JET * lighthillPower(j.velocity, j.density, rhoAmb, aAmb, j.areaM2);
  const f = j.velocity / j.diameterM;
  return {
    large: {
      hz: clampHz(JET_STROUHAL_LARGE * f),
      q: JET_Q_LARGE,
      amp: Math.sqrt(p * jetLargeScaleDirectivity(thetaRad)),
    },
    fine: {
      hz: clampHz(JET_STROUHAL_FINE * f),
      q: JET_Q_FINE,
      amp: Math.sqrt(p * JET_FINE_SHARE * jetFineScaleDirectivity(thetaRad)),
    },
  };
}

// ---------------------------------------------------------------------------------------
// Directivity (A4): power gains of the listener's angle to the inlet axis (synthesized lobes)

const toDeg = (rad: number) => (rad * 180) / Math.PI;
const fromDb = (db: number) => 10 ** (db / 10);

/** The inlet's forward lobe (the fan's tones, the buzz-saw, the compressors' whine). */
export function inletDirectivity(thetaRad: number): number {
  return fromDb(Math.max(-25, -12 * ((toDeg(thetaRad) - 50) / 60) ** 2));
}

/** The fan's tones: the inlet's lobe plus a weaker aft lobe out of the bypass nozzle. */
export function fanDirectivity(thetaRad: number): number {
  const aft = Math.max(-40, -8 - 12 * ((toDeg(thetaRad) - 120) / 40) ** 2);
  return inletDirectivity(thetaRad) + fromDb(aft);
}

/** The large-scale mixing noise: a lobe about JET_PEAK_DEG, falling toward the jet axis. */
export function jetLargeScaleDirectivity(thetaRad: number): number {
  return fromDb(Math.max(-30, -10 * ((toDeg(thetaRad) - JET_PEAK_DEG) / 22) ** 2));
}

/** The fine-scale mixing noise: broad, slightly aft. */
export function jetFineScaleDirectivity(thetaRad: number): number {
  return fromDb(-3 * ((toDeg(thetaRad) - 110) / 70) ** 2);
}

/** The core's own noise (combustion rumble, the LPT's tones) out of the core nozzle. */
export function aftDirectivity(thetaRad: number): number {
  return fromDb(Math.max(-30, -10 * ((toDeg(thetaRad) - 125) / 45) ** 2));
}

// ---------------------------------------------------------------------------------------
// The listener

/** The point on the engine axis the listener's angle is taken about: mid-flowpath, m. */
export function listenerReferenceX(def: EngineDefinition): number {
  const x = (id: string) => def.stations.find((s) => s.id === id)?.x ?? Number.NaN;
  return (x('2') + x('8')) / 2;
}

/**
 * The angle (rad) between the inlet axis (-x, upstream) and the listener, seen from the
 * reference point: 0 straight ahead of the inlet, pi straight behind the nozzle. The engine's
 * frame is the world's (x along the axis, D2-4's scene), so the camera position is used as is.
 */
export function listenerAngle(position: readonly number[], def: EngineDefinition): number {
  const dx = (position[0] ?? 0) - listenerReferenceX(def);
  const rho = Math.hypot(position[1] ?? 0, position[2] ?? 0);
  if (rho === 0 && dx === 0) return Math.PI / 2;
  return Math.atan2(rho, -dx);
}

// ---------------------------------------------------------------------------------------
// The frame

export interface SoundInputs {
  readonly cycle: CycleState;
  readonly ambient: AmbientConditions;
  /** The listener's angle to the inlet axis, rad. */
  readonly thetaRad: number;
  /** Modelled surge cycles since the reset (the cycle model's CycleDiagnostics.surgeCycles). */
  readonly surgeCycles: number;
}

export interface SoundModel {
  readonly def: EngineDefinition;
  readonly tones: readonly ToneVoice[];
  readonly buzzShape: readonly number[];
  readonly coreAreaM2: number;
  readonly bypassAreaM2: number;
}

export function createSoundModel(def: EngineDefinition): SoundModel {
  return {
    def,
    tones: toneVoices(def),
    buzzShape: buzzSawShape(fanRow(def).count),
    coreAreaM2: factValue('coreNozzleArea'),
    bypassAreaM2: factValue('bypassNozzleArea'),
  };
}

// The levels (synthesized on physical trends, PHYSICS.md 1): fan and compressor tones on
// Heidmann's leading scaling, power ~ mass flow x (stage temperature rise)^2 (M. F. Heidmann,
// "Interim prediction method for fan and compressor source noise", NASA TM X-71763, 1975; his
// Mach-number functions are not modelled); normalisers below are scales, not data.
const FAN_DT_REF_K = 40;
const HPC_STAGE_DT_REF_K = 50;
const BOOSTER_STAGE_DT_REF_K = 25;
const LPT_STAGE_DT_REF_K = 70;
/** The fan's harmonics re its blade-pass tone, dB (synthesized). */
const FAN_HARMONIC_DB = [0, -6, -10, -14];
/** The HPC's voiced rotors re its first, dB (synthesized). */
const HPC_ROW_DB = [0, -3, -6];
const K_HPC = 0.05;
const K_BOOSTER = 0.02;
const K_LPT = 0.03;
/** The fan's broadband noise re its blade-pass tone's power (synthesized). */
const K_FAN_BROADBAND = 0.3;
/** The combustion rumble's power at the design fuel flow (amplitude proportional to fuel flow). */
const K_RUMBLE = 0.05;
const RUMBLE_HZ = 300;
const RUMBLE_Q = 0.5;
/** The starter whine at its cut-out speed, and its harmonics' amplitudes. */
const K_STARTER = 1e-3;
const STARTER_HARMONIC_AMP = [1, 0.5, 0.35, 0.25];
/** A spark's and a bang's peaks in output units (the clicks and the bang are not compressed). */
export const SPARK_AMP = 0.08;
export const BANG_AMP = 0.7;
/**
 * The listener's level map (synthesized): output RMS = OUT_REF (P / P_REF)^(1/4), half the dB
 * range of the summed source power P, so ground idle stays audible beside take-off.
 */
const OUT_REF = 0.12;
const P_REF = 1;
const P_FLOOR = 1e-9;
const LEVEL_EXPONENT = 0.25;

const pos = (x: number) => (x > 0 ? x : 0);

export function engineSoundFrame(model: SoundModel, inputs: SoundInputs): SoundFrame {
  const { def, tones } = model;
  const c = inputs.cycle;
  const st = c.stations;
  const th = inputs.thetaRad;
  const dp = def.designPoint;
  const coreRef = dp.totalAirflowKgPerS / (1 + dp.bypassRatio);
  const fan =
    (st['2'].wKgPerS / dp.totalAirflowKgPerS) *
    (pos(st['13'].ttK - st['2'].ttK) / FAN_DT_REF_K) ** 2;
  const stage = (dt: number, n: number, ref: number) => (pos(dt) / n / ref) ** 2;
  const hpc =
    K_HPC *
    (st['25'].wKgPerS / coreRef) *
    stage(st['3'].ttK - st['25'].ttK, factValue('hpcStages'), HPC_STAGE_DT_REF_K);
  const booster =
    K_BOOSTER *
    (st['21'].wKgPerS / coreRef) *
    stage(st['24'].ttK - st['21'].ttK, factValue('boosterStages'), BOOSTER_STAGE_DT_REF_K);
  const lpt =
    K_LPT *
    (st['45'].wKgPerS / coreRef) *
    stage(st['45'].ttK - st['5'].ttK, factValue('lptStages'), LPT_STAGE_DT_REF_K);
  const buzzDb = buzzSawLevelDb(fanTipRelativeMach(c, def));
  const buzz = buzzDb === Number.NEGATIVE_INFINITY ? 0 : 10 ** (buzzDb / 10);
  const dFan = fanDirectivity(th);
  const dIn = inletDirectivity(th);
  const dAft = aftDirectivity(th);
  const starter = c.starterEngaged
    ? K_STARTER * (c.n2Percent / factValue('starterCutoutN2')) ** 2
    : 0;
  let hpcRow = 0;
  const toneHz = tones.map((t) => toneFrequencyHz(t, c.n1Rpm, c.n2Rpm));
  const toneAmp = tones.map((t) => {
    // a tone of power P has a peak amplitude sqrt(2 P)
    switch (t.group) {
      case 'fan':
        return Math.sqrt(2 * fan * dFan * fromDb(FAN_HARMONIC_DB[t.harmonic - 1] ?? -20));
      case 'buzzSaw':
        return Math.sqrt(2 * fan * buzz * dIn) * (model.buzzShape[t.order - 1] ?? 0);
      case 'hpc':
        return Math.sqrt(2 * hpc * dIn * fromDb(HPC_ROW_DB[hpcRow++] ?? -9));
      case 'booster':
        return Math.sqrt(2 * booster * dIn);
      case 'lpt':
        return Math.sqrt(2 * lpt * dAft);
      case 'starter':
        return Math.sqrt(2 * starter) * (STARTER_HARMONIC_AMP[t.harmonic - 1] ?? 0);
      default:
        return 0;
    }
  });
  const pAmb = inputs.ambient.pressurePa;
  const core = jetNoise(jetStream(st['8'], pAmb, model.coreAreaM2), inputs.ambient, th);
  const bypass = jetNoise(jetStream(st['18'], pAmb, model.bypassAreaM2), inputs.ambient, th);
  const bpf = toneHz[0] ?? 0;
  const broadband: NoiseBand = {
    hz: clampHz(0.8 * bpf),
    q: 0.35,
    amp: Math.sqrt(K_FAN_BROADBAND * fan * dFan),
  };
  const rumble: NoiseBand = {
    hz: RUMBLE_HZ,
    q: RUMBLE_Q,
    amp: c.combustorLit
      ? Math.sqrt(K_RUMBLE * dAft) * (pos(c.fuelFlowKgPerS) / dp.fuelFlowKgPerS)
      : 0,
  };
  const bands: Record<string, NoiseBand> = {
    'jet-core-large': core.large,
    'jet-core-fine': core.fine,
    'jet-bypass-large': bypass.large,
    'jet-bypass-fine': bypass.fine,
    'fan-broadband': broadband,
    rumble,
  };
  const noise = NOISE_VOICES.map((v) => bands[v.id] ?? { hz: 100, q: 1, amp: 0 });
  let power = 0;
  for (const a of toneAmp) power += (a * a) / 2;
  for (const b of noise) power += b.amp * b.amp;
  const master =
    OUT_REF * P_REF ** -LEVEL_EXPONENT * Math.max(power, P_FLOOR) ** (LEVEL_EXPONENT - 0.5);
  return {
    toneHz,
    toneAmp,
    noiseHz: noise.map((b) => b.hz),
    noiseQ: noise.map((b) => b.q),
    noiseAmp: noise.map((b) => b.amp),
    ignitersOn: c.ignitersOn,
    sparkRateHz: IGNITER_SPARK_RATE_HZ,
    sparkAmp: SPARK_AMP,
    surgeCycles: Math.max(0, Math.floor(inputs.surgeCycles)),
    bangAmp: BANG_AMP,
    master,
  };
}
