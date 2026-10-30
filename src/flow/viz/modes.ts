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

/**
 * D4-76: the cut plane's near-field crop, x in [xMin, xMax], r <= rMax. D4-83: its edge is crisp,
 * with a thin outline (CROP_OUTLINE), not a fade: the fade left viridis' darkest end as a soft
 * purple fog round the engine.
 */
export interface CutPlaneCrop {
  readonly xMin: number;
  readonly xMax: number;
  readonly rMax: number;
}

/** D4-83: the crop's outline, drawn just inside the edge: about a pixel, light, translucent. */
export const CROP_OUTLINE = { widthPx: 1.25, alpha: 0.55, rgb: [0.88, 0.9, 0.93] } as const;

export type FlowVizModeId = 'realistic' | 'cutaway' | 'schlieren' | 'data';

export interface FlowVizMode {
  readonly label: string;
  /** Peak particle opacity when the tracers are shown, 0 = the mode has none to show. */
  readonly particleOpacity: number;
  /**
   * D4-83: whether the tracers show unless the viewer says otherwise. Realistic has none by
   * default (the cinematic view read them as hair); the cut modes show them.
   */
  readonly tracersByDefault: boolean;
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
  return { xMin: hl.x - 0.6, xMax: tip.x + 0.9, rMax: 1.15 * rNacelle };
}

/** The crop's opacity at (x, r): 1 inside, 0 outside (D4-83: a crisp edge; the shader anti-aliases it). */
export function cropAlpha(c: CutPlaneCrop, x: number, r: number): number {
  return r <= c.rMax && x >= c.xMin && x <= c.xMax ? 1 : 0;
}

const CROP = nearFieldCrop(ENGINE_DEFINITION);

/**
 * The schlieren's default sensitivity: a/f = 1 milliradian (W2V-N10). A hot core jet deflects
 * light by about K rho_inf (delta g / shear width) x path ~ 2.3e-4 x 1.2 x (0.6 / 0.05 m) x
 * 0.3 m ~ 1e-3 rad (the critic's probe: 9.9e-4), so a/f at that estimate keeps the shear layers
 * just inside the grey scale; 500 microradians saturated them.
 */
const SCHLIEREN_RANGE_RAD = 1e-3;

/**
 * A streak is the tracer's path over this much wall time, s (a long film exposure of smoke
 * tracers: at 1/200 the intake's 150 m/s draws 19 cm, so the streaks read as flow lines).
 */
export const STREAK_EXPOSURE_S = 0.25;
/**
 * The longest streak drawn, m (W2V-N18: stated in the note and the ledger). At 1/200 it caps every
 * stream above 360 m/s, so the core and bypass jets draw equal streaks: a long line would hide
 * the field it is on, and the cut plane's colour says how fast each jet is.
 */
export const STREAK_MAX_M = 0.45;

export const FLOW_VIZ_MODES: Readonly<Record<FlowVizModeId, FlowVizMode>> = {
  realistic: {
    label: 'Realistic',
    particleOpacity: 0.18,
    tracersByDefault: false,
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
    tracersByDefault: true,
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
    tracersByDefault: false,
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
    tracersByDefault: true,
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

/** D4-83: whether a mode draws its tracers, given the viewer's choice (null: the mode's default). */
export function tracersShown(mode: FlowVizMode, choice: boolean | null): boolean {
  return mode.particleOpacity > 0 && (choice ?? mode.tracersByDefault);
}

/** The engine view mode a flow mode needs: the cut plane needs the cutaway wedge open. */
export function lookModeFor(id: FlowVizModeId): LookMode {
  return FLOW_VIZ_MODES[id].cutPlane ? 'cutaway' : 'realistic';
}

/** D4-2: the flow visuals' GPU budget at the default preset, ms (measured back to back, D4-42). */
export const FLOW_VISUALS_BUDGET_MS = 2;
