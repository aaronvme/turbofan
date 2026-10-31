// D4-91's progressive warm-up, the pure part (src/shell/warmUp.ts): which configuration a view
// needs compiled, the background order (Cutaway and Schlieren first), at most one configuration
// per frame-budget slot, and the view shown while the asked one is prepared (the old one, never a
// freeze), switching as soon as it is warm.
import { describe, expect, it } from 'vitest';
import type { RenderState } from '../../../src/contracts/ui';
import { APP_DEFAULT_VIEW, withViewMode } from '../../../src/shell/viewState';
import {
  BACKGROUND_ORDER,
  BOOT_CONFIGS,
  MAX_WARM_FRAMES,
  SLOT_EVERY,
  SLOT_FRAME_CPU_MS,
  WARM_CONFIGS,
  configFor,
  createWarmScheduler,
  shownView,
} from '../../../src/shell/warmUp';

const view = (mode: RenderState['viewMode'], patch: Partial<RenderState> = {}): RenderState => ({
  ...withViewMode(APP_DEFAULT_VIEW, mode),
  ...patch,
});

describe('configFor: the configuration a view needs compiled', () => {
  it('is the mode with its tracers, the Data plane at its quantity', () => {
    expect(configFor(view('realistic'))).toBe('realistic');
    expect(
      configFor({
        ...view('realistic'),
        overlays: { ...APP_DEFAULT_VIEW.overlays, particles: true },
      }),
    ).toBe('realistic+tracers');
    expect(configFor(view('cutaway'))).toBe('cutaway+tracers');
    expect(configFor(view('schlieren'))).toBe('schlieren');
    expect(configFor(view('exploded'))).toBe('exploded');
    expect(configFor(view('data'))).toBe('data:mach+tracers');
    expect(configFor(view('data', { cutPlaneField: 'pressure' }))).toBe('data:p+tracers');
    expect(configFor(view('data', { cutPlaneField: 'density' }))).toBe('data:rho+tracers');
    expect(configFor(view('data', { cutPlaneField: 'temperature' }))).toBe('data:t+tracers');
  });

  it('every configuration a view can ask for is warmed at boot or in the background', () => {
    const all = new Set([...BOOT_CONFIGS, ...BACKGROUND_ORDER]);
    expect(all.size).toBe(BOOT_CONFIGS.length + BACKGROUND_ORDER.length);
    expect([...all].sort()).toEqual(Object.keys(WARM_CONFIGS).sort());
  });

  it('boots on the default view (Realistic) and warms Cutaway and Schlieren first (D4-91)', () => {
    expect(BOOT_CONFIGS[0]).toBe(configFor(APP_DEFAULT_VIEW));
    expect(BACKGROUND_ORDER.slice(0, 2)).toEqual(['cutaway+tracers', 'schlieren']);
    expect(WARM_CONFIGS['cutaway+tracers']).toEqual({
      flow: 'cutaway',
      look: 'cutaway',
      tracers: true,
    });
    expect(WARM_CONFIGS.schlieren).toEqual({ flow: 'schlieren', look: 'realistic' });
    expect(WARM_CONFIGS['data:p+tracers']).toEqual({
      flow: 'data',
      look: 'cutaway',
      quantity: 'p',
      tracers: true,
    });
    expect(WARM_CONFIGS.exploded).toEqual({ flow: null, look: 'exploded' });
  });
});

describe('the warm scheduler: one configuration per frame-budget slot', () => {
  const booted = () => {
    const s = createWarmScheduler();
    for (const id of BOOT_CONFIGS) s.done(id);
    return s;
  };

  it('warms the background order, one slot every SLOT_EVERY frames', () => {
    const s = booted();
    const asked = configFor(APP_DEFAULT_VIEW);
    expect(s.next(0, 4, asked)).toBe('cutaway+tracers');
    for (let f = 1; f < SLOT_EVERY; f++) expect(s.next(f, 4, asked)).toBeNull();
    expect(s.next(SLOT_EVERY, 4, asked)).toBe('cutaway+tracers');
    s.done('cutaway+tracers');
    expect(s.next(2 * SLOT_EVERY, 4, asked)).toBe('schlieren');
  });

  it('gives no slot after a frame that used more than half the frame budget', () => {
    const s = booted();
    const asked = configFor(APP_DEFAULT_VIEW);
    expect(s.next(0, SLOT_FRAME_CPU_MS + 0.1, asked)).toBeNull();
    expect(s.next(1, SLOT_FRAME_CPU_MS, asked)).toBe('cutaway+tracers');
  });

  it('prepares the asked view first', () => {
    const s = booted();
    expect(s.next(0, 4, 'data:t+tracers')).toBe('data:t+tracers');
    s.done('data:t+tracers');
    expect(s.next(SLOT_EVERY, 4, 'data:t+tracers')).toBe('cutaway+tracers');
  });

  it('is done when every configuration is warm', () => {
    const s = booted();
    for (const id of BACKGROUND_ORDER) s.done(id);
    expect(s.next(0, 1, 'schlieren')).toBeNull();
    expect(s.state()).toEqual({ warm: [...BOOT_CONFIGS, ...BACKGROUND_ORDER], queue: [] });
  });

  it('gives up on a configuration after MAX_WARM_FRAMES slots, so no view waits forever', () => {
    const s = booted();
    let f = 0;
    for (let k = 0; k < MAX_WARM_FRAMES; k++) {
      expect(s.next(f, 1, 'schlieren')).toBe('schlieren');
      f += SLOT_EVERY;
    }
    expect(s.isWarm('schlieren')).toBe(false);
    expect(s.next(f, 1, 'schlieren')).toBe('cutaway+tracers');
    expect(s.isWarm('schlieren')).toBe(true);
    expect(s.gaveUp()).toEqual(['schlieren']);
  });
});

describe('shownView: never a freeze, switched as soon as the view is warm', () => {
  it('shows the asked view once its configuration is warm', () => {
    const asked = view('cutaway');
    expect(shownView(asked, view('realistic'), () => true)).toEqual({
      view: asked,
      preparing: null,
    });
  });

  it('keeps the shown view, and says which mode it prepares, until then', () => {
    const shown = view('realistic');
    const asked = view('cutaway');
    expect(shownView(asked, shown, (id) => id !== 'cutaway+tracers')).toEqual({
      view: shown,
      preparing: 'cutaway',
    });
  });

  it('shows the asked view when nothing is shown yet (the boot)', () => {
    const asked = view('cutaway');
    expect(shownView(asked, null, () => false)).toEqual({ view: asked, preparing: null });
  });
});
