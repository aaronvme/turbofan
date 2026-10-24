import { describe, expect, it } from 'vitest';
import { COMPONENT_IDS } from '../../../src/contracts/engine';
import { findNonPlainData } from '../../../src/contracts/sim';
import {
  COLORMAP_IDS,
  DEFAULT_UI_STATE,
  FIELD_IDS,
  OVERLAY_IDS,
  PARTICLE_TIME_DILATION_RANGE,
  QUALITY_PRESETS,
  VIEW_MODES,
  renderStateOf,
  validateRenderStatePatch,
  validateUiState,
  type UiState,
} from '../../../src/contracts/ui';

describe('UI store schema', () => {
  it('has the five view modes from the plan', () => {
    expect([...VIEW_MODES]).toEqual(['realistic', 'cutaway', 'exploded', 'schlieren', 'data']);
  });

  it('only offers perceptually uniform colormaps (plus a diverging one for signed fields)', () => {
    expect(COLORMAP_IDS).toEqual(['viridis', 'magma', 'inferno', 'plasma', 'cividis', 'balance']);
  });

  it('has a default for every overlay and every field', () => {
    expect(Object.keys(DEFAULT_UI_STATE.overlays).sort()).toEqual([...OVERLAY_IDS].sort());
    expect(Object.keys(DEFAULT_UI_STATE.colormaps).sort()).toEqual([...FIELD_IDS].sort());
    expect(QUALITY_PRESETS).toContain(DEFAULT_UI_STATE.quality);
    expect(validateUiState(DEFAULT_UI_STATE)).toEqual([]);
    expect(findNonPlainData(DEFAULT_UI_STATE)).toBeNull();
  });

  it('defaults signed velocity components to the diverging colormap', () => {
    expect(DEFAULT_UI_STATE.colormaps.radialVelocity).toBe('balance');
    expect(DEFAULT_UI_STATE.colormaps.swirlVelocity).toBe('balance');
    expect(DEFAULT_UI_STATE.colormaps.temperature).not.toBe('balance');
  });

  it('accepts any engine component as the selection', () => {
    for (const id of COMPONENT_IDS) {
      expect(validateUiState({ ...DEFAULT_UI_STATE, selectedComponent: id })).toEqual([]);
    }
  });

  const bad = (patch: Record<string, unknown>): unknown => ({ ...DEFAULT_UI_STATE, ...patch });

  it.each<[string, unknown, RegExp]>([
    ['a non-object', 'ui', /UI state must be an object/],
    ['an unknown view mode', bad({ viewMode: 'xray' }), /viewMode/],
    ['an unknown quality', bad({ quality: 'max' }), /quality/],
    ['an unknown selection', bad({ selectedComponent: 'gearbox' }), /selectedComponent/],
    ['a missing overlay', bad({ overlays: { particles: true } }), /overlays\.cutPlane/],
    [
      'a non-boolean overlay',
      bad({ overlays: { ...DEFAULT_UI_STATE.overlays, particles: 'on' } }),
      /overlays\.particles/,
    ],
    [
      'an unknown colormap',
      bad({ colormaps: { ...DEFAULT_UI_STATE.colormaps, temperature: 'jet' } }),
      /colormaps\.temperature/,
    ],
    ['an unknown cut-plane field', bad({ cutPlaneField: 'vorticity' }), /cutPlaneField/],
    ['unknown units', bad({ units: 'furlongs' }), /units/],
    [
      'particle time dilation out of range',
      bad({ particleTimeDilation: PARTICLE_TIME_DILATION_RANGE.max * 2 }),
      /particleTimeDilation/,
    ],
  ])('rejects %s', (_name, value, pattern) => {
    expect(validateUiState(value).join('\n')).toMatch(pattern);
  });

  it('splits out the render-relevant subset that crosses to the sim/render side', () => {
    const ui: UiState = { ...DEFAULT_UI_STATE, viewMode: 'schlieren', units: 'imperial' };
    const render = renderStateOf(ui);
    expect(render.viewMode).toBe('schlieren');
    expect('units' in render).toBe(false);
    expect(Object.keys(render).sort()).toEqual(
      [
        'colormaps',
        'cutPlaneField',
        'overlays',
        'particleTimeDilation',
        'quality',
        'selectedComponent',
        'viewMode',
      ].sort(),
    );
  });

  it('validates partial render-state patches', () => {
    expect(validateRenderStatePatch({ quality: 'low' })).toEqual([]);
    expect(validateRenderStatePatch({ overlays: { particles: false } })).toEqual([]);
    expect(validateRenderStatePatch({ colormaps: { temperature: 'magma' } })).toEqual([]);
    expect(validateRenderStatePatch({ units: 'si' }).join()).toMatch(
      /units is not a render-state key/,
    );
    expect(validateRenderStatePatch(null).join()).toMatch(/must be an object/);
    expect(validateRenderStatePatch({ colormaps: { heat: 'magma' } }).join()).toMatch(/heat/);
  });
});
