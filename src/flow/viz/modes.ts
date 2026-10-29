// The flow-visual modes (w2/flowviz) and how they sit on the look-dev view modes.
//
// Honesty (PHYSICS.md 1): every mode draws only quantities derived from the simulated field
// (particles advected by it, its cut plane, its density gradient, blackbody colour from its
// temperatures). `synthesized` lists anything procedural a mode adds; it is empty, and a test
// keeps it so until the ledger and the "What's simulated" data say otherwise.

import type { EngineDefinition } from '../../contracts/engine';
import { ENGINE_DEFINITION } from '../../engine/definition';
import type { LookMode } from '../../render/presets';
import type { FieldQuantityId } from './fields';

/**
 * Where a mode's flow layer joins the image. D4-76: data colours (the colour maps, the
 * schlieren grey scale) composite after the tone map, in display space, so they show their
 * stated colours and match the legend; AgX, exposure and bloom never touch them. The beauty
 * paths (Realistic) composite in scene-linear light, before the tone map, like the engine.
 */
export type FlowComposite = 'scene' | 'display';

/** D4-76: the cut plane's near-field crop: x in [xMin, xMax], r <= rMax, faded over fadeM. */
export interface CutPlaneCrop {
  readonly xMin: number;
  readonly xMax: number;
  readonly rMax: number;
  readonly fadeM: number;
}

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
  /** D4-76: where the flow layer composites. */
  readonly composite: FlowComposite;
  /** D4-76: the cut plane's crop (null: the full near-field raster). */
  readonly crop: CutPlaneCrop | null;
  /** The schlieren's knife-edge cut-off a/f, rad: deflections of +-this are white / black. */
  readonly schlierenRangeRad: number;
  readonly synthesized: readonly string[];
}

/**
 * D4-76's near field: from a little ahead of the intake to a little behind the plug, out to
 * 15 % beyond the nacelle's largest radius, so the far-field slab does not cover the studio
 * (null definition: no crop, the full raster).
 */
export function nearFieldCrop(def: EngineDefinition | null): CutPlaneCrop | null {
  if (def === null) return null;
  const c = def.flowpath.curves;
  const hl = c.nacelleInner.points[0];
  const tip = c.plug.points.at(-1);
  if (hl === undefined || tip === undefined) throw new Error('nearFieldCrop: no flowpath');
  const rNacelle = Math.max(...c.nacelleOuter.points.map((p) => p.r));
  return { xMin: hl.x - 0.6, xMax: tip.x + 0.9, rMax: 1.15 * rNacelle, fadeM: 0.25 };
}

const smooth = (e0: number, e1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The crop's opacity at (x, r): 1 inside, fading to 0 over fadeM at each edge. */
export function cropAlpha(c: CutPlaneCrop, x: number, r: number): number {
  return (
    smooth(0, c.fadeM, c.rMax - r) * smooth(0, c.fadeM, x - c.xMin) * smooth(0, c.fadeM, c.xMax - x)
  );
}

const CROP = nearFieldCrop(ENGINE_DEFINITION);

/**
 * The schlieren's default sensitivity: a/f = 500 microradians. A hot core jet deflects light by
 * about K rho_inf (delta g / shear width) x path ~ 2.3e-4 x 1.2 x (0.6 / 0.05 m) x 0.3 m ~ 1e-3
 * rad, so this keeps its shear layers inside the grey scale (a tenth of it saturated them).
 */
const SCHLIEREN_RANGE_RAD = 5e-4;

export const FLOW_VIZ_MODES: Readonly<Record<FlowVizModeId, FlowVizMode>> = {
  realistic: {
    label: 'Realistic',
    particleOpacity: 0.18,
    cutPlane: false,
    quantity: 'speed',
    haze: 1,
    schlieren: false,
    legend: false,
    composite: 'scene',
    crop: null,
    schlierenRangeRad: SCHLIEREN_RANGE_RAD,
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
    composite: 'display',
    crop: CROP,
    schlierenRangeRad: SCHLIEREN_RANGE_RAD,
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
    composite: 'display',
    crop: null,
    schlierenRangeRad: SCHLIEREN_RANGE_RAD,
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
    composite: 'display',
    crop: CROP,
    schlierenRangeRad: SCHLIEREN_RANGE_RAD,
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
