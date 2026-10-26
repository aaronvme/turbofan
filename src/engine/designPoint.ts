// Design-point estimate: a constant-cp-per-section closure of the takeoff point, used to
// size the nozzles, give the blade-design mean line its densities and give the mocks their
// station magnitudes. It is the derivation recorded in docs/ENGINE_FACTS.md ("Design-point
// estimate"), not the cycle model: W1's thermally perfect, map-based model replaces it as
// the performance truth.
//
// Method (Walsh & Fletcher, Gas Turbine Performance, 2nd ed., ch. 5 and 6, simplified):
// compressor and turbine temperatures from the isentropic efficiency, the combustor exit
// temperature from the fuel energy, turbine work from the shaft balances, convergent
// nozzles fully or partly expanded.

import { R_AIR } from '../contracts/ambient';
import type { StationState } from '../contracts/cycle';
import type { DesignPoint } from '../contracts/engine';
import type { StationId } from '../contracts/stations';

/** A calorically perfect gas section: cp = gamma R / (gamma - 1) with R = R_AIR exactly. */
export interface GasSection {
  readonly cpJPerKgK: number;
  readonly gamma: number;
}

const COLD_GAMMA = 1.4;
const HOT_CP = 1150;
/** Air through the fan and compressors: gamma 1.4, cp = 1004.7 J/(kg K). */
export const COLD_GAS: GasSection = {
  cpJPerKgK: (COLD_GAMMA * R_AIR) / (COLD_GAMMA - 1),
  gamma: COLD_GAMMA,
};
/** Combustion products through the turbines and the core nozzle: cp 1150 J/(kg K), gamma 1.3326. */
export const HOT_GAS: GasSection = { cpJPerKgK: HOT_CP, gamma: HOT_CP / (HOT_CP - R_AIR) };

/** Loss assumptions of the estimate (docs/ENGINE_FACTS.md, design-point estimate). */
export const DESIGN_LOSSES = {
  /** Bypass duct total-pressure loss, fraction of P13. */
  bypassDuctPtLoss: 0.015,
  /** Core nozzle total-pressure loss, fraction of P5. */
  coreNozzlePtLoss: 0.01,
  /** Shaft mechanical efficiency (bearings, accessory drag). */
  mechanicalEfficiency: 0.99,
} as const;

export interface NozzleEstimate {
  readonly areaM2: number;
  readonly exitVelocityMPerS: number;
  readonly exitStaticPressurePa: number;
  readonly choked: boolean;
  readonly grossThrustN: number;
}

export interface DesignPointEstimate {
  readonly stations: Readonly<Record<StationId, StationState>>;
  readonly gas: { readonly cold: GasSection; readonly hot: GasSection };
  readonly mechanicalEfficiency: number;
  /** Shaft power absorbed by the compressors, W. */
  readonly hpShaftPowerW: number;
  readonly lpShaftPowerW: number;
  /**
   * Work per kg of each component's own flow, J/kg: the fan value is mass-averaged over both
   * streams; the turbine values are positive (work extracted).
   */
  readonly specificWorkJPerKg: {
    readonly fan: number;
    readonly booster: number;
    readonly hpc: number;
    readonly hpt: number;
    readonly lpt: number;
  };
  /** Polytropic efficiencies equivalent to the isentropic ones, for per-stage marches. */
  readonly polytropicEfficiency: {
    readonly booster: number;
    readonly hpc: number;
    readonly hpt: number;
    readonly lpt: number;
  };
  readonly bypassNozzle: NozzleEstimate;
  readonly coreNozzle: NozzleEstimate;
  readonly grossThrustN: number;
  readonly netThrustN: number;
  readonly tsfcKgPerNs: number;
}

const exponent = (g: GasSection) => (g.gamma - 1) / g.gamma;

/** Exit total temperature of a compressor with pressure ratio pr and isentropic efficiency eta. */
function compress(tIn: number, pr: number, eta: number, g: GasSection): number {
  return tIn * (1 + (pr ** exponent(g) - 1) / eta);
}

/** Pressure ratio (out/in, < 1) of a turbine dropping tIn to tOut at isentropic efficiency eta. */
function turbinePressureRatio(tIn: number, tOut: number, eta: number, g: GasSection): number {
  return (1 - (1 - tOut / tIn) / eta) ** (1 / exponent(g));
}

function compressorPolytropic(tIn: number, tOut: number, pr: number, g: GasSection): number {
  return (exponent(g) * Math.log(pr)) / Math.log(tOut / tIn);
}

function turbinePolytropic(tIn: number, tOut: number, prOutIn: number, g: GasSection): number {
  return Math.log(tOut / tIn) / (exponent(g) * Math.log(prOutIn));
}

/** Convergent nozzle: choked at the throat if the pressure ratio allows, else fully expanded. */
function convergentNozzle(
  w: number,
  pt: number,
  tt: number,
  pAmb: number,
  g: GasSection,
): NozzleEstimate {
  const critical = ((g.gamma + 1) / 2) ** (g.gamma / (g.gamma - 1));
  const choked = pt / pAmb >= critical;
  const pExit = choked ? pt / critical : pAmb;
  const tExit = choked ? (tt * 2) / (g.gamma + 1) : tt * (pExit / pt) ** exponent(g);
  // sonic at a choked throat; otherwise the isentropic expansion to ambient
  const vExit = choked
    ? Math.sqrt(g.gamma * R_AIR * tExit)
    : Math.sqrt(2 * g.cpJPerKgK * (tt - tExit));
  const area = w / ((pExit / (R_AIR * tExit)) * vExit);
  return {
    areaM2: area,
    exitVelocityMPerS: vExit,
    exitStaticPressurePa: pExit,
    choked,
    grossThrustN: w * vExit + (pExit - pAmb) * area,
  };
}

const st = (ptPa: number, ttK: number, wKgPerS: number, fuelAirRatio = 0): StationState => ({
  ptPa,
  ttK,
  wKgPerS,
  fuelAirRatio,
});

/** The takeoff design point of `dp` (constant cp per section). */
export function estimateDesignPoint(dp: DesignPoint, fuelLhvJPerKg: number): DesignPointEstimate {
  const cold = COLD_GAS;
  const hot = HOT_GAS;
  const { ambient, pressureRatios: pr, efficiencies: eta } = dp;
  const mechEff = DESIGN_LOSSES.mechanicalEfficiency;
  const ram = 1 + ((cold.gamma - 1) / 2) * ambient.machNumber ** 2;
  const tt0 = ambient.temperatureK * ram;
  const pt0 = ambient.pressurePa * ram ** (cold.gamma / (cold.gamma - 1));
  const flightSpeed = ambient.machNumber * Math.sqrt(cold.gamma * R_AIR * ambient.temperatureK);

  const w = dp.totalAirflowKgPerS;
  const wCore = w / (1 + dp.bypassRatio);
  const wBypass = w - wCore;
  const wf = dp.fuelFlowKgPerS;
  const wCooling = wCore * dp.turbineCoolingFraction;
  const wCombustorAir = wCore - wCooling;
  const wGas = wCore + wf;

  // compression (100 % ram recovery: station 2 = free-stream totals)
  const t13 = compress(tt0, pr.fanBypass, eta.fanBypass, cold);
  const t21 = compress(tt0, pr.fanCore, eta.fanCore, cold);
  const t24 = compress(t21, pr.booster, eta.booster, cold);
  const t3 = compress(t24, pr.hpc, eta.hpc, cold);
  const p13 = pt0 * pr.fanBypass;
  const p21 = pt0 * pr.fanCore;
  const p24 = p21 * pr.booster;
  const p3 = p24 * pr.hpc;

  // combustion: fuel energy into the combustor air plus the fuel; cooling air mixes at 41
  const t4 = t3 + (eta.combustor * wf * fuelLhvJPerKg) / ((wCombustorAir + wf) * hot.cpJPerKgK);
  const p4 = p3 * (1 - dp.combustorPressureLossFraction);
  const t41 =
    ((wCombustorAir + wf) * hot.cpJPerKgK * t4 + wCooling * cold.cpJPerKgK * t3) /
    (wGas * hot.cpJPerKgK);

  // shaft balances
  const fanPower = wBypass * cold.cpJPerKgK * (t13 - tt0) + wCore * cold.cpJPerKgK * (t21 - tt0);
  const boosterPower = wCore * cold.cpJPerKgK * (t24 - t21);
  const hpPower = wCore * cold.cpJPerKgK * (t3 - t24);
  const lpPower = fanPower + boosterPower;
  const t45 = t41 - hpPower / (mechEff * wGas * hot.cpJPerKgK);
  const t5 = t45 - lpPower / (mechEff * wGas * hot.cpJPerKgK);
  const prHpt = turbinePressureRatio(t41, t45, eta.hpt, hot);
  const prLpt = turbinePressureRatio(t45, t5, eta.lpt, hot);
  const p45 = p4 * prHpt;
  const p5 = p45 * prLpt;
  const etaPolyLpt = turbinePolytropic(t45, t5, prLpt, hot);
  // EGT plane: after LPT stage 1 of 4, equal stage work
  const t495 = t45 - (t45 - t5) / 4;
  const p495 = p45 * (t495 / t45) ** (1 / (exponent(hot) * etaPolyLpt));

  const p18 = p13 * (1 - DESIGN_LOSSES.bypassDuctPtLoss);
  const p8 = p5 * (1 - DESIGN_LOSSES.coreNozzlePtLoss);
  const bypassNozzle = convergentNozzle(wBypass, p18, t13, ambient.pressurePa, cold);
  const coreNozzle = convergentNozzle(wGas, p8, t5, ambient.pressurePa, hot);
  const grossThrustN = bypassNozzle.grossThrustN + coreNozzle.grossThrustN;
  const netThrustN = grossThrustN - w * flightSpeed;

  const farComb = wf / wCombustorAir;
  const farGas = wf / wCore;
  const stations: Record<StationId, StationState> = {
    '0': st(pt0, tt0, w),
    '1': st(pt0, tt0, w),
    '2': st(pt0, tt0, w),
    '13': st(p13, t13, wBypass),
    '18': st(p18, t13, wBypass),
    '19': st(p18, t13, wBypass),
    '21': st(p21, t21, wCore),
    '24': st(p24, t24, wCore),
    '25': st(p24, t24, wCore),
    '3': st(p3, t3, wCore),
    '4': st(p4, t4, wCombustorAir + wf, farComb),
    '41': st(p4, t41, wGas, farGas),
    '45': st(p45, t45, wGas, farGas),
    '49.5': st(p495, t495, wGas, farGas),
    '5': st(p5, t5, wGas, farGas),
    '8': st(p8, t5, wGas, farGas),
    '9': st(p8, t5, wGas, farGas),
  };

  return {
    stations,
    gas: { cold, hot },
    mechanicalEfficiency: mechEff,
    hpShaftPowerW: hpPower,
    lpShaftPowerW: lpPower,
    specificWorkJPerKg: {
      fan: fanPower / w,
      booster: boosterPower / wCore,
      hpc: hpPower / wCore,
      hpt: hot.cpJPerKgK * (t41 - t45),
      lpt: hot.cpJPerKgK * (t45 - t5),
    },
    polytropicEfficiency: {
      booster: compressorPolytropic(t21, t24, pr.booster, cold),
      hpc: compressorPolytropic(t24, t3, pr.hpc, cold),
      hpt: turbinePolytropic(t41, t45, prHpt, hot),
      lpt: etaPolyLpt,
    },
    bypassNozzle,
    coreNozzle,
    grossThrustN,
    netThrustN,
    tsfcKgPerNs: wf / netThrustN,
  };
}
