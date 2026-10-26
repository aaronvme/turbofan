// Hand-made CycleState for contract tests. The numbers only need to be self-consistent
// plain data (not physics); the mocks and the real cycle model are tested elsewhere.
import type { CycleState, StationState } from '../../../../src/contracts/cycle';
import { STATION_IDS, type StationId } from '../../../../src/contracts/stations';

const N1_100 = 5175;
const N2_100 = 14460;

function station(id: StationId): StationState {
  const hot = ['4', '41', '45', '49.5', '5', '8', '9'].includes(id);
  return {
    ptPa: hot ? 300_000 : 150_000,
    ttK: hot ? 1100 : 320,
    wKgPerS: id === '13' || id === '18' || id === '19' ? 290 : 58,
    fuelAirRatio: hot ? 0.022 : 0,
  };
}

export function sampleCycleState(): CycleState {
  const stations = Object.fromEntries(STATION_IDS.map((id) => [id, station(id)])) as Record<
    StationId,
    StationState
  >;
  return {
    timeS: 12.5,
    n1Rpm: 0.85 * N1_100,
    n2Rpm: 0.95 * N2_100,
    n1Percent: 85,
    n2Percent: 95,
    stations,
    fuelFlowKgPerS: 1.0,
    grossThrustN: 95_000,
    netThrustN: 95_000,
    tsfcKgPerNs: 1.0 / 95_000,
    egtDisplayedK: 1130, // measured plus the 30 K TCDS shunt
    egtMeasuredK: 1100, // stations['49.5'].ttK
    fan: {
      correctedFlowKgPerS: 320,
      pressureRatio: 1.5,
      isentropicEfficiency: 0.9,
      correctedSpeedFraction: 0.85,
      surgeMarginFraction: 0.2,
    },
    hpc: {
      correctedFlowKgPerS: 22,
      pressureRatio: 10,
      isentropicEfficiency: 0.86,
      correctedSpeedFraction: 0.95,
      surgeMarginFraction: 0.22,
    },
    vsvClosureRad: 0.02,
    vbvOpenFraction: 0,
    starterEngaged: false,
    ignitersOn: false,
    combustorLit: true,
    fadec: { mode: 'run', limiter: 'n1Target', n1TargetPercent: 85 },
    startPhase: 'none',
    flags: {
      surge: false,
      flameout: false,
      hungStart: false,
      hotStart: false,
      noLightOff: false,
      n1Overspeed: false,
      n2Overspeed: false,
      egtExceedance: false,
    },
  };
}

export const SAMPLE_REFERENCE_SPEEDS = { n1Rpm: N1_100, n2Rpm: N2_100 } as const;
