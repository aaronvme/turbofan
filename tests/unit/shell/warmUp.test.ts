// D4-91's progressive warm-up, the pure part (src/shell/warmUp.ts): which configuration a view
// needs compiled, the background order (Cutaway and Schlieren first), at most one configuration
// per frame-budget slot, and the view shown while the asked one is prepared (the old one, never a
// freeze), switching as soon as it is warm. D4-95: no background slot while a switch is pending,
// nor for QUIET_AFTER_INPUT_MS after any input or switch (a cold switch still prepares its view).
import { describe, expect, it } from 'vitest';
import type { RenderState } from '../../../src/contracts/ui';
import { APP_DEFAULT_VIEW, withViewMode } from '../../../src/shell/viewState';
import {
  BACKGROUND_ORDER,
  BOOT_CONFIGS,
  MAX_WARM_FRAMES,
  QUIET_AFTER_INPUT_MS,
  SLOT_EVERY,
  SLOT_FRAME_CPU_MS,
  WARM_CONFIGS,
  configFor,
  createWarmScheduler,
  shownView,
  type WarmClock,
} from '../../../src/shell/warmUp';

/** A frame long after any input, with no switch pending (the background may warm). */
const calm = (frame: number): WarmClock => ({ nowMs: 1e6 + frame * 16.7, switchPending: false });

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
    expect(s.next(0, 4, asked, calm(0))).toBe('cutaway+tracers');
    for (let f = 1; f < SLOT_EVERY; f++) expect(s.next(f, 4, asked, calm(f))).toBeNull();
    expect(s.next(SLOT_EVERY, 4, asked, calm(SLOT_EVERY))).toBe('cutaway+tracers');
    s.done('cutaway+tracers');
    expect(s.next(2 * SLOT_EVERY, 4, asked, calm(2 * SLOT_EVERY))).toBe('schlieren');
  });

  it('gives no slot after a frame that used more than half the frame budget', () => {
    const s = booted();
    const asked = configFor(APP_DEFAULT_VIEW);
    expect(s.next(0, SLOT_FRAME_CPU_MS + 0.1, asked, calm(0))).toBeNull();
    expect(s.next(1, SLOT_FRAME_CPU_MS, asked, calm(1))).toBe('cutaway+tracers');
  });

  it('prepares the asked view first', () => {
    const s = booted();
    expect(s.next(0, 4, 'data:t+tracers', calm(0))).toBe('data:t+tracers');
    s.done('data:t+tracers');
    expect(s.next(SLOT_EVERY, 4, 'data:t+tracers', calm(SLOT_EVERY))).toBe('cutaway+tracers');
  });

  it('is done when every configuration is warm', () => {
    const s = booted();
    for (const id of BACKGROUND_ORDER) s.done(id);
    expect(s.next(0, 1, 'schlieren', calm(0))).toBeNull();
    expect(s.state()).toEqual({ warm: [...BOOT_CONFIGS, ...BACKGROUND_ORDER], queue: [] });
  });

  it('gives up on a configuration after MAX_WARM_FRAMES slots, so no view waits forever', () => {
    const s = booted();
    let f = 0;
    for (let k = 0; k < MAX_WARM_FRAMES; k++) {
      expect(s.next(f, 1, 'schlieren', calm(f))).toBe('schlieren');
      f += SLOT_EVERY;
    }
    expect(s.isWarm('schlieren')).toBe(false);
    expect(s.next(f, 1, 'schlieren', calm(f))).toBe('cutaway+tracers');
    expect(s.isWarm('schlieren')).toBe(true);
    expect(s.gaveUp()).toEqual(['schlieren']);
  });
});

describe('D4-95: the background warm-up is suspended around input and switches', () => {
  const booted = () => {
    const s = createWarmScheduler();
    for (const id of BOOT_CONFIGS) s.done(id);
    return s;
  };
  const asked = configFor(APP_DEFAULT_VIEW);
  const at = (nowMs: number, switchPending = false): WarmClock => ({ nowMs, switchPending });

  it('gives no background slot for QUIET_AFTER_INPUT_MS after an input', () => {
    expect(QUIET_AFTER_INPUT_MS).toBe(1000);
    const s = booted();
    s.input(5000);
    expect(s.suspended(5000)).toBe(true);
    expect(s.next(0, 1, asked, at(5000))).toBeNull();
    expect(s.next(SLOT_EVERY, 1, asked, at(5999))).toBeNull();
    expect(s.suspended(6000)).toBe(false);
    expect(s.next(2 * SLOT_EVERY, 1, asked, at(6000))).toBe('cutaway+tracers');
  });

  it('a later input extends the quiet; an earlier one does not shorten it', () => {
    const s = booted();
    s.input(5000);
    s.input(5600);
    s.input(5100);
    expect(s.next(0, 1, asked, at(6500))).toBeNull();
    expect(s.next(SLOT_EVERY, 1, asked, at(6600))).toBe('cutaway+tracers');
  });

  it('gives no background slot while a switch is pending, nor for 1 s after it is done', () => {
    const s = booted();
    // the switch's transition (the wedge opening) outlasts the input's own second
    for (let t = 2000, f = 0; t <= 4000; t += 250, f += SLOT_EVERY) {
      expect(s.next(f, 1, asked, at(t, true))).toBeNull();
      expect(s.suspended(t)).toBe(true);
    }
    expect(s.next(100, 1, asked, at(4500))).toBeNull();
    expect(s.next(102, 1, asked, at(4999))).toBeNull();
    expect(s.next(104, 1, asked, at(5000))).toBe('cutaway+tracers');
  });

  it('a switch started while the background warm-up is in progress stops it until 1 s after the switch', () => {
    // 60 fps; the background warms Cutaway, then Schlieren (a slot every SLOT_EVERY frames); at
    // frame 100 the viewer switches into a warm mode, whose transition lasts 84 frames (1.4 s)
    const s = booted();
    const frameMs = 1000 / 60;
    const click = 100;
    const settled = click + 84;
    const slots: { f: number; id: string }[] = [];
    for (let f = 0; f < 400; f++) {
      const nowMs = f * frameMs;
      if (f === click) s.input(nowMs);
      const pending = f >= click && f < settled;
      const id = s.next(f, 4, 'realistic', at(nowMs, pending));
      if (id !== null) slots.push({ f, id });
      if (f === 40) s.done('cutaway+tracers');
    }
    const before = slots.filter((x) => x.f < click);
    expect(before.length).toBeGreaterThan(0);
    // the queue is still warming (Schlieren) when the switch starts
    expect(before.at(-1)?.id).toBe('schlieren');
    expect(s.isWarm('schlieren')).toBe(false);
    // none from the click until 1 s after the switch is done (its last pending frame)
    const resume = (settled - 1) * frameMs + QUIET_AFTER_INPUT_MS;
    expect(slots.filter((x) => x.f >= click && x.f * frameMs < resume)).toEqual([]);
    // then the background goes on where it stopped
    const after = slots.filter((x) => x.f * frameMs >= resume);
    expect(after[0]?.id).toBe('schlieren');
  });

  it('a cold switch still prepares the asked view while quiet (the viewer waits for it)', () => {
    const s = booted();
    s.input(1000);
    expect(s.next(0, 1, 'data:t+tracers', at(1000, true))).toBe('data:t+tracers');
    expect(s.next(SLOT_EVERY, 1, 'data:t+tracers', at(1040, true))).toBe('data:t+tracers');
    s.done('data:t+tracers');
    // shown: pending until settled, then quiet for a second
    expect(s.next(2 * SLOT_EVERY, 1, 'data:t+tracers', at(1100, true))).toBeNull();
    expect(s.next(3 * SLOT_EVERY, 1, 'data:t+tracers', at(2099))).toBeNull();
    expect(s.next(4 * SLOT_EVERY, 1, 'data:t+tracers', at(2100))).toBe('cutaway+tracers');
  });

  it('keeps the slot rule while preparing: one slot every SLOT_EVERY frames, after a light frame', () => {
    const s = booted();
    expect(s.next(0, 1, 'exploded', at(0, true))).toBe('exploded');
    expect(s.next(1, 1, 'exploded', at(17, true))).toBeNull();
    expect(s.next(SLOT_EVERY, SLOT_FRAME_CPU_MS + 1, 'exploded', at(34, true))).toBeNull();
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
