// UI store schema (W2 builds the zustand store on it). The render-relevant subset crosses
// the sim/UI boundary as a command (setRenderState), so rendering can live in a worker.

import { COMPONENT_IDS, type ComponentId } from './engine';
import { describeValue } from './describe';

export const VIEW_MODES = ['realistic', 'cutaway', 'exploded', 'schlieren', 'data'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const OVERLAY_IDS = [
  'particles',
  'cutPlane',
  'callouts',
  'engineDisplay',
  'stationStrip',
  'compressorMaps',
  'tsDiagram',
  'fidelityPanel',
  'performanceHud',
] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

/** Fields a cut plane or the data view can colour by (all derivable from the render textures). */
export const FIELD_IDS = [
  'pressure',
  'density',
  'temperature',
  'mach',
  'axialVelocity',
  'radialVelocity',
  'swirlVelocity',
  'fuelAirRatio',
] as const;
export type FieldId = (typeof FIELD_IDS)[number];

/** Perceptually uniform maps only (no rainbow/jet); "balance" (cmocean) is diverging, for signed fields. */
export const COLORMAP_IDS = [
  'viridis',
  'magma',
  'inferno',
  'plasma',
  'cividis',
  'balance',
] as const;
export type ColormapId = (typeof COLORMAP_IDS)[number];

export const QUALITY_PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

export const UNIT_SYSTEMS = ['si', 'imperial'] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/** Particle advection runs this many times slower than sim time (1 = real time). */
export const PARTICLE_TIME_DILATION_RANGE = { min: 1, max: 4096 } as const;

export interface UiState {
  readonly viewMode: ViewMode;
  readonly overlays: Readonly<Record<OverlayId, boolean>>;
  readonly selectedComponent: ComponentId | null;
  readonly colormaps: Readonly<Record<FieldId, ColormapId>>;
  readonly cutPlaneField: FieldId;
  readonly quality: QualityPreset;
  readonly particleTimeDilation: number;
  /** Display units only; the simulation is SI throughout. */
  readonly units: UnitSystem;
}

export const RENDER_STATE_KEYS = [
  'viewMode',
  'overlays',
  'selectedComponent',
  'colormaps',
  'cutPlaneField',
  'quality',
  'particleTimeDilation',
] as const satisfies readonly (keyof UiState)[];

/** The part of the UI state the renderer needs. */
export type RenderState = Pick<UiState, (typeof RENDER_STATE_KEYS)[number]>;

/** A partial update to the render state; overlays and colormaps may be partial too. */
export interface RenderStatePatch {
  readonly viewMode?: ViewMode;
  readonly overlays?: Partial<Readonly<Record<OverlayId, boolean>>>;
  readonly selectedComponent?: ComponentId | null;
  readonly colormaps?: Partial<Readonly<Record<FieldId, ColormapId>>>;
  readonly cutPlaneField?: FieldId;
  readonly quality?: QualityPreset;
  readonly particleTimeDilation?: number;
}

export const DEFAULT_UI_STATE: UiState = {
  viewMode: 'realistic',
  overlays: {
    particles: true,
    cutPlane: false,
    callouts: true,
    engineDisplay: true,
    stationStrip: false,
    compressorMaps: false,
    tsDiagram: false,
    fidelityPanel: false,
    performanceHud: false,
  },
  selectedComponent: null,
  colormaps: {
    pressure: 'viridis',
    density: 'cividis',
    temperature: 'inferno',
    mach: 'magma',
    axialVelocity: 'plasma',
    radialVelocity: 'balance',
    swirlVelocity: 'balance',
    fuelAirRatio: 'magma',
  },
  cutPlaneField: 'temperature',
  quality: 'high',
  particleTimeDilation: 1,
  units: 'si',
};

export function renderStateOf(ui: UiState): RenderState {
  return {
    viewMode: ui.viewMode,
    overlays: ui.overlays,
    selectedComponent: ui.selectedComponent,
    colormaps: ui.colormaps,
    cutPlaneField: ui.cutPlaneField,
    quality: ui.quality,
    particleTimeDilation: ui.particleTimeDilation,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = (list: readonly string[], v: unknown): boolean =>
  typeof v === 'string' && list.includes(v);

type FieldCheck = (value: unknown, problems: string[], complete: boolean) => void;

const RENDER_FIELD_CHECKS: Readonly<Record<(typeof RENDER_STATE_KEYS)[number], FieldCheck>> = {
  viewMode: (v, p) => {
    if (!oneOf(VIEW_MODES, v))
      p.push(`viewMode "${describeValue(v)}" must be one of ${VIEW_MODES.join(', ')}`);
  },
  overlays: (v, p, complete) => {
    if (!isRecord(v)) {
      p.push('overlays must be an object');
      return;
    }
    for (const key of Object.keys(v))
      if (!oneOf(OVERLAY_IDS, key)) p.push(`overlays.${key} is not an overlay`);
    for (const id of OVERLAY_IDS) {
      if (!(id in v)) {
        if (complete) p.push(`overlays.${id} is missing`);
      } else if (typeof v[id] !== 'boolean') p.push(`overlays.${id} must be a boolean`);
    }
  },
  selectedComponent: (v, p) => {
    if (v !== null && !oneOf(COMPONENT_IDS, v))
      p.push(`selectedComponent "${describeValue(v)}" is not a component`);
  },
  colormaps: (v, p, complete) => {
    if (!isRecord(v)) {
      p.push('colormaps must be an object');
      return;
    }
    for (const key of Object.keys(v))
      if (!oneOf(FIELD_IDS, key)) p.push(`colormaps.${key} is not a field`);
    for (const id of FIELD_IDS) {
      if (!(id in v)) {
        if (complete) p.push(`colormaps.${id} is missing`);
      } else if (!oneOf(COLORMAP_IDS, v[id]))
        p.push(`colormaps.${id} "${describeValue(v[id])}" is not a colormap`);
    }
  },
  cutPlaneField: (v, p) => {
    if (!oneOf(FIELD_IDS, v)) p.push(`cutPlaneField "${describeValue(v)}" is not a field`);
  },
  quality: (v, p) => {
    if (!oneOf(QUALITY_PRESETS, v))
      p.push(`quality "${describeValue(v)}" must be one of ${QUALITY_PRESETS.join(', ')}`);
  },
  particleTimeDilation: (v, p) => {
    const { min, max } = PARTICLE_TIME_DILATION_RANGE;
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max)) {
      p.push(`particleTimeDilation ${describeValue(v)} must be in [${min}, ${max}]`);
    }
  },
};

/** Validates a complete UI state (e.g. one restored from storage). */
export function validateUiState(value: unknown): string[] {
  if (!isRecord(value)) return ['UI state must be an object'];
  const problems: string[] = [];
  for (const key of RENDER_STATE_KEYS) RENDER_FIELD_CHECKS[key](value[key], problems, true);
  if (!oneOf(UNIT_SYSTEMS, value['units']))
    problems.push(`units "${String(value['units'])}" must be si or imperial`);
  return problems;
}

/** Validates a partial render-state update (the setRenderState command payload). */
export function validateRenderStatePatch(value: unknown): string[] {
  if (!isRecord(value)) return ['render state patch must be an object'];
  const problems: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (!oneOf(RENDER_STATE_KEYS, key)) {
      problems.push(`${key} is not a render-state key`);
      continue;
    }
    RENDER_FIELD_CHECKS[key as (typeof RENDER_STATE_KEYS)[number]](v, problems, false);
  }
  return problems;
}
