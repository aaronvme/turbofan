// Ambient (flight) condition shared by the engine definition, the cycle inputs and the
// flow field reference state.

export interface AmbientConditions {
  /** Static pressure, Pa. */
  readonly pressurePa: number;
  /** Static temperature, K. */
  readonly temperatureK: number;
  /** Flight Mach number (0 = static). */
  readonly machNumber: number;
}

/** International Standard Atmosphere, sea level, static (ICAO Doc 7488). */
export const ISA_SLS: AmbientConditions = {
  pressurePa: 101325,
  temperatureK: 288.15,
  machNumber: 0,
};

/** Specific gas constant of dry air, J/(kg K) (ISA value). */
export const R_AIR = 287.05287;

/** Subsonic flight only: the intake and the solver far field assume M < 1. */
export const MAX_FLIGHT_MACH = 0.95;

export function validateAmbient(ambient: AmbientConditions): string[] {
  const problems: string[] = [];
  if (!(Number.isFinite(ambient.pressurePa) && ambient.pressurePa > 0)) {
    problems.push(`pressure ${String(ambient.pressurePa)} Pa must be finite and > 0`);
  }
  if (!(Number.isFinite(ambient.temperatureK) && ambient.temperatureK > 0)) {
    problems.push(`temperature ${String(ambient.temperatureK)} K must be finite and > 0`);
  }
  if (!(
    Number.isFinite(ambient.machNumber) &&
    ambient.machNumber >= 0 &&
    ambient.machNumber <= MAX_FLIGHT_MACH
  )) {
    problems.push(`Mach ${String(ambient.machNumber)} must be in [0, ${MAX_FLIGHT_MACH}]`);
  }
  return problems;
}
