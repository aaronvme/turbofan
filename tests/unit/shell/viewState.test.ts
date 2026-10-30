// What the worker asks of the view for a render state (src/shell/viewState.ts): the flow mode of
// each view mode, the tracers (D4-83: Realistic has none by default, Cutaway and Data do), and the
// cut plane's quantity from the contract's cutPlaneField (only the fields the W2 field carries).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_STATE,
  FIELD_IDS,
  VIEW_MODES,
  renderStateOf,
  type RenderState,
} from '../../../src/contracts/ui';
import { FLOW_VIZ_MODES } from '../../../src/flow/viz/modes';
import {
  APP_DEFAULT_VIEW,
  CUT_PLANE_FIELDS,
  cutPlaneQuantity,
  flowModeFor,
  flowQuantityFor,
  tracersAvailable,
  tracersByDefault,
  withViewMode,
} from '../../../src/shell/viewState';

const view = (patch: Partial<RenderState> = {}): RenderState => ({
  ...renderStateOf(DEFAULT_UI_STATE),
  ...patch,
});

describe('view state (D4-83, the cut plane)', () => {
  it('every view mode but Exploded draws a flow mode; Realistic always (its haze), not only with tracers', () => {
    expect(VIEW_MODES.map((m) => flowModeFor(m))).toEqual([
      'realistic',
      'cutaway',
      null,
      'schlieren',
      'data',
    ]);
  });

  it("D4-83: the tracers default to the flow mode's own default (Realistic none)", () => {
    expect(VIEW_MODES.map((m) => tracersByDefault(m))).toEqual([false, true, false, false, true]);
    expect(VIEW_MODES.map((m) => tracersAvailable(m))).toEqual([true, true, false, false, true]);
    expect(FLOW_VIZ_MODES.realistic.tracersByDefault).toBe(false);
  });

  it('the app starts in Realistic without tracers and with the Data mode on its own Mach', () => {
    expect(APP_DEFAULT_VIEW.viewMode).toBe('realistic');
    expect(APP_DEFAULT_VIEW.overlays.particles).toBe(false);
    expect(APP_DEFAULT_VIEW.cutPlaneField).toBe('mach');
    expect(flowQuantityFor(APP_DEFAULT_VIEW.cutPlaneField)).toBe(FLOW_VIZ_MODES.data.quantity);
  });

  it('a mode switch puts the tracers at the new mode default; the rest of the view is kept', () => {
    const v = withViewMode(view({ quality: 'low' }), 'cutaway');
    expect(v.viewMode).toBe('cutaway');
    expect(v.overlays.particles).toBe(true);
    expect(v.quality).toBe('low');
    expect(withViewMode(v, 'realistic').overlays.particles).toBe(false);
    expect(withViewMode(v, 'exploded').overlays.particles).toBe(false);
    // the other overlays are untouched
    expect(withViewMode(v, 'data').overlays.callouts).toBe(v.overlays.callouts);
  });

  it('maps the contract fields the W2 field carries onto the cut-plane quantities, and no others', () => {
    expect(CUT_PLANE_FIELDS).toEqual(['pressure', 'density', 'temperature', 'mach']);
    expect(CUT_PLANE_FIELDS.map(flowQuantityFor)).toEqual(['p', 'rho', 't', 'mach']);
    for (const f of FIELD_IDS.filter((id) => !CUT_PLANE_FIELDS.includes(id)))
      expect(flowQuantityFor(f)).toBeNull();
  });

  it('the cut-plane field colours the Data plane; Cutaway keeps its velocity magnitude', () => {
    expect(cutPlaneQuantity(view({ viewMode: 'data', cutPlaneField: 'temperature' }))).toBe('t');
    expect(cutPlaneQuantity(view({ viewMode: 'data', cutPlaneField: 'swirlVelocity' }))).toBeNull();
    expect(
      cutPlaneQuantity(view({ viewMode: 'cutaway', cutPlaneField: 'temperature' })),
    ).toBeNull();
    expect(cutPlaneQuantity(view({ viewMode: 'realistic', cutPlaneField: 'pressure' }))).toBeNull();
  });
});
