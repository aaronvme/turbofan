// Engine station numbering. Follows SAE ARP755 ("Aircraft Propulsion System Performance
// Station Designation and Nomenclature"); ARP755 was cancelled in 2014 and superseded by
// SAE AS755, which keeps the station numbering (classical nomenclature moved to AS6502).
// The subset below is the two-spool, separate-flow turbofan set this project uses:
// single-digit stations along the core, "1x" stations in the bypass stream, and
// intermediate stations (21, 24, 41, 49.5) inside a component.
//
// Coordinates (shared with the mesh): x axial, x = 0 at the station 2 plane (fan face),
// positive downstream; r >= 0 from the engine axis; theta right-handed about +x.

export const STATION_IDS = [
  '0',
  '1',
  '2',
  '13',
  '18',
  '19',
  '21',
  '24',
  '25',
  '3',
  '4',
  '41',
  '45',
  '49.5',
  '5',
  '8',
  '9',
] as const;

export type StationId = (typeof STATION_IDS)[number];
/** Every station except the free stream is a plane (a radial line in the meridional slice). */
export type PlaneStationId = Exclude<StationId, '0'>;
export type StationStream = 'freestream' | 'common' | 'core' | 'bypass';

export interface StationInfo {
  readonly id: StationId;
  readonly name: string;
  readonly stream: StationStream;
  readonly plane: boolean;
  readonly description: string;
}

export const STATIONS: Readonly<Record<StationId, StationInfo>> = {
  '0': {
    id: '0',
    name: 'Free stream',
    stream: 'freestream',
    plane: false,
    description: 'Undisturbed ambient far upstream (flight condition).',
  },
  '1': {
    id: '1',
    name: 'Inlet highlight',
    stream: 'common',
    plane: true,
    description: 'Intake entry plane at the nacelle highlight (engine/aircraft interface).',
  },
  '2': {
    id: '2',
    name: 'Fan face',
    stream: 'common',
    plane: true,
    description: 'First compressor (fan) face; defines x = 0.',
  },
  '13': {
    id: '13',
    name: 'Fan exit, bypass',
    stream: 'bypass',
    plane: true,
    description: 'Bypass stream behind the fan outlet guide vanes.',
  },
  '18': {
    id: '18',
    name: 'Bypass nozzle throat',
    stream: 'bypass',
    plane: true,
    description: 'Fan (bypass) nozzle throat; equals the exit plane for a convergent nozzle.',
  },
  '19': {
    id: '19',
    name: 'Bypass nozzle exit',
    stream: 'bypass',
    plane: true,
    description: 'Fan (bypass) nozzle exit plane.',
  },
  '21': {
    id: '21',
    name: 'Fan exit, core',
    stream: 'core',
    plane: true,
    description: 'Core stream behind the fan root, at the booster (LPC) inlet.',
  },
  '24': {
    id: '24',
    name: 'Booster exit',
    stream: 'core',
    plane: true,
    description: 'Booster (LPC) exit, ahead of the variable bleed valves and transition duct.',
  },
  '25': {
    id: '25',
    name: 'HPC inlet',
    stream: 'core',
    plane: true,
    description: 'High-pressure compressor inlet, after the transition (gooseneck) duct.',
  },
  '3': {
    id: '3',
    name: 'HPC exit',
    stream: 'core',
    plane: true,
    description: 'High-pressure compressor delivery (OPR is P3/P2).',
  },
  '4': {
    id: '4',
    name: 'Combustor exit',
    stream: 'core',
    plane: true,
    description: 'Combustor exit / HPT nozzle guide vane inlet (T4).',
  },
  '41': {
    id: '41',
    name: 'HPT rotor inlet',
    stream: 'core',
    plane: true,
    description: 'HPT rotor inlet, after the NGV with its cooling air mixed in.',
  },
  '45': {
    id: '45',
    name: 'LPT inlet',
    stream: 'core',
    plane: true,
    description: 'Low-pressure turbine inlet, after the inter-turbine duct.',
  },
  '49.5': {
    id: '49.5',
    name: 'LPT stage 2 nozzle (EGT)',
    stream: 'core',
    plane: true,
    description: 'Where EGT is measured: LPT stage 2 nozzle (EASA TCDS E.004, IV.1.1).',
  },
  '5': {
    id: '5',
    name: 'LPT exit',
    stream: 'core',
    plane: true,
    description: 'Low-pressure turbine exit.',
  },
  '8': {
    id: '8',
    name: 'Core nozzle throat',
    stream: 'core',
    plane: true,
    description: 'Core (primary) nozzle throat; equals the exit plane for a convergent nozzle.',
  },
  '9': {
    id: '9',
    name: 'Core nozzle exit',
    stream: 'core',
    plane: true,
    description: 'Core (primary) nozzle exit plane.',
  },
};

export const PLANE_STATION_IDS = STATION_IDS.filter(
  (id): id is PlaneStationId => id !== '0',
) as readonly PlaneStationId[];

/** Stations where the flow solver mass-averages its field for the cycle coupling. */
export const SOLVER_REDUCTION_STATIONS = [
  '2',
  '13',
  '18',
  '25',
  '3',
  '4',
  '45',
  '5',
  '8',
] as const satisfies readonly PlaneStationId[];

export type SolverReductionStationId = (typeof SOLVER_REDUCTION_STATIONS)[number];

/** Upstream-to-downstream order of the plane stations along each stream. */
export const STREAM_ORDER: {
  readonly core: readonly PlaneStationId[];
  readonly bypass: readonly PlaneStationId[];
} = {
  core: ['1', '2', '21', '24', '25', '3', '4', '41', '45', '49.5', '5', '8', '9'],
  bypass: ['1', '2', '13', '18', '19'],
};

const STATION_ID_SET: ReadonlySet<string> = new Set(STATION_IDS);

export function isStationId(value: unknown): value is StationId {
  return typeof value === 'string' && STATION_ID_SET.has(value);
}
