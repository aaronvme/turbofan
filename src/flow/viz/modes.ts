// The flow-visual modes (w2/flowviz) and how they sit on the look-dev view modes.
//
// Honesty (PHYSICS.md 1): every mode draws only quantities derived from the simulated field
// (particles advected by it, its cut plane, its density gradient, blackbody colour from its
// temperatures). `synthesized` lists anything procedural a mode adds; it is empty, and a test
// keeps it so until the ledger and the "What's simulated" data say otherwise.

import type { LookMode } from '../../render/presets';
import type { FieldQuantityId } from './fields';

export type FlowVizModeId = 'realistic' | 'cutaway' | 'schlieren' | 'data';

export interface FlowVizMode {
  readonly label: string;
  /** Peak particle opacity, 0 = no particles. */
  readonly particleOpacity: number;
  /** The meridional cut plane through the axis, coloured by `quantity`. */
  readonly cutPlane: boolean;
  readonly quantity: FieldQuantityId;
  /** Heat-haze refraction strength (1 = physical Gladstone-Dale deflection). */
  readonly haze: number;
  /** The schlieren image |grad rho| instead of the beauty background. */
  readonly schlieren: boolean;
  /** A colour legend (wherever a field is drawn as colour). */
  readonly legend: boolean;
  readonly synthesized: readonly string[];
}

export const FLOW_VIZ_MODES: Readonly<Record<FlowVizModeId, FlowVizMode>> = {
  realistic: {
    label: 'Realistic',
    particleOpacity: 0.25,
    cutPlane: false,
    quantity: 'speed',
    haze: 1,
    schlieren: false,
    legend: false,
    synthesized: [],
  },
  cutaway: {
    label: 'Cutaway',
    particleOpacity: 0.7,
    cutPlane: true,
    quantity: 'speed',
    haze: 0,
    schlieren: false,
    legend: true,
    synthesized: [],
  },
  schlieren: {
    label: 'Schlieren',
    particleOpacity: 0,
    cutPlane: false,
    quantity: 'rho',
    haze: 0,
    schlieren: true,
    legend: true,
    synthesized: [],
  },
  data: {
    label: 'Data',
    particleOpacity: 0.35,
    cutPlane: true,
    quantity: 'mach',
    haze: 0,
    schlieren: false,
    legend: true,
    synthesized: [],
  },
};

export const FLOW_VIZ_MODE_IDS = Object.keys(FLOW_VIZ_MODES) as readonly FlowVizModeId[];

/** The engine view mode a flow mode needs: the cut plane needs the cutaway wedge open. */
export function lookModeFor(id: FlowVizModeId): LookMode {
  return FLOW_VIZ_MODES[id].cutPlane ? 'cutaway' : 'realistic';
}

/** D4-2: the flow visuals' GPU budget at the default preset, ms (measured back to back, D4-42). */
export const FLOW_VISUALS_BUDGET_MS = 2;
