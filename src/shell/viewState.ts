// What the worker asks of the engine view for a render state: the flow mode of each view mode,
// the tracers (D4-83: Realistic draws no tracers by default, its haze and schlieren stay; Cutaway
// and Data draw them) and the cut plane's quantity from the contract's cutPlaneField. Pure, so the
// sim core (a mode switch resets the tracers to the mode's default) and the worker share it.

import {
  DEFAULT_UI_STATE,
  renderStateOf,
  type FieldId,
  type RenderState,
  type ViewMode,
} from '../contracts/ui';
import type { FieldQuantityId } from '../flow/viz/fields';
import { FLOW_VIZ_MODES, type FlowVizModeId } from '../flow/viz/modes';

/** The flow mode a view mode draws (Exploded draws none: the parts move off the field). */
export function flowModeFor(mode: ViewMode): FlowVizModeId | null {
  return mode === 'exploded' ? null : mode;
}

/** Whether the view mode can draw tracers at all (Schlieren and Exploded cannot). */
export function tracersAvailable(mode: ViewMode): boolean {
  const f = flowModeFor(mode);
  return f !== null && FLOW_VIZ_MODES[f].particleOpacity > 0;
}

/** D4-83: the tracers a view mode starts with (Realistic none, Cutaway and Data on). */
export function tracersByDefault(mode: ViewMode): boolean {
  const f = flowModeFor(mode);
  return f !== null && tracersAvailable(mode) && FLOW_VIZ_MODES[f].tracersByDefault;
}

/** A mode switch: the new mode with the tracers at its default (the viewer may toggle them). */
export function withViewMode(view: RenderState, mode: ViewMode): RenderState {
  return {
    ...view,
    viewMode: mode,
    overlays: { ...view.overlays, particles: tracersByDefault(mode) },
  };
}

/**
 * The contract's fields the cut plane can draw, in the contract's order. flowviz's plane has
 * quantities for p, rho, T, Mach and the velocity magnitude (src/flow/viz/fields.ts); the velocity
 * components and the fuel-air ratio have none yet, so they are not offered rather than drawn as
 * something else.
 */
export const CUT_PLANE_FIELDS: readonly FieldId[] = ['pressure', 'density', 'temperature', 'mach'];

const QUANTITY: Readonly<Partial<Record<FieldId, FieldQuantityId>>> = {
  pressure: 'p',
  density: 'rho',
  temperature: 't',
  mach: 'mach',
};

/** The cut-plane quantity a contract field draws as; null: not drawable in this build. */
export function flowQuantityFor(field: FieldId): FieldQuantityId | null {
  return QUANTITY[field] ?? null;
}

/**
 * The Data plane's quantity (null: the mode's own). The cut-plane field colours the Data view
 * only; Cutaway keeps its velocity magnitude (the flow mode's own quantity, which has no
 * contract FieldId).
 */
export function cutPlaneQuantity(view: RenderState): FieldQuantityId | null {
  return view.viewMode === 'data' ? flowQuantityFor(view.cutPlaneField) : null;
}

/** The app's first render state: the contract's defaults, D4-83's Realistic, Data on its Mach. */
export const APP_DEFAULT_VIEW: RenderState = Object.freeze({
  ...withViewMode(renderStateOf(DEFAULT_UI_STATE), DEFAULT_UI_STATE.viewMode),
  cutPlaneField: 'mach',
});
