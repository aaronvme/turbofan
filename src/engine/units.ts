// SI is used everywhere inside the simulation. These convert published figures
// (lbf, lb/s, rpm, degC, in) at the boundary, so a figure in ENGINE_FACTS.md can be
// entered in its source's units and checked against the model in SI.

/** Pound-force in newtons (exact, by definition of the pound and standard gravity). */
export const LBF_TO_N = 4.4482216152605;
/** Avoirdupois pound in kilograms (exact). */
export const LB_TO_KG = 0.45359237;
/** Inch in metres (exact). */
export const IN_TO_M = 0.0254;
/** 0 degC in kelvin (exact). */
export const ZERO_C_IN_K = 273.15;

export function lbfToN(lbf: number): number {
  return lbf * LBF_TO_N;
}

export function lbPerSToKgPerS(lbPerS: number): number {
  return lbPerS * LB_TO_KG;
}

export function inToM(inches: number): number {
  return inches * IN_TO_M;
}

export function celsiusToKelvin(celsius: number): number {
  return celsius + ZERO_C_IN_K;
}

export function kelvinToCelsius(kelvin: number): number {
  return kelvin - ZERO_C_IN_K;
}

export function rpmToRadPerS(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}

export function radPerSToRpm(radPerS: number): number {
  return (radPerS * 60) / (2 * Math.PI);
}

/**
 * TSFC in (lb/h)/lbf, the unit engine data is usually published in, to SI
 * kg/(N*s).
 */
export function tsfcImperialToSi(lbPerHourPerLbf: number): number {
  return (lbPerHourPerLbf * LB_TO_KG) / 3600 / LBF_TO_N;
}
