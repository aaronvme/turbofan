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
  COLD_SWITCH_WAIT_FRAMES,
  MAX_PREPARE_FRAMES,
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

  it('gives up on a background configuration after MAX_WARM_FRAMES slots, so the queue goes on', () => {
    const s = booted();
    const asked = configFor(APP_DEFAULT_VIEW);
    let f = 0;
    for (let k = 0; k < MAX_WARM_FRAMES; k++) {
      expect(s.next(f, 1, asked, calm(f))).toBe('cutaway+tracers');
      f += SLOT_EVERY;
    }
    expect(s.isWarm('cutaway+tracers')).toBe(false);
    expect(s.next(f, 1, asked, calm(f))).toBe('schlieren');
    expect(s.isWarm('cutaway+tracers')).toBe(true);
    expect(s.gaveUp()).toEqual(['cutaway+tracers']);
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

describe('D4-97 item 1 (W2A-I7), D4-98 item 1: a cold switch waits at most 30 frames, then warms every frame', () => {
  // critic pass 17's probe (docs/reviews/probes/w2a-cold-switch.probe.ts.txt): the viewer clicks
  // a view not yet warm at t = 0 and the shown view's frames take a steady CPU at or above the
  // slot rule's bar, for 10 min at 60 fps. Before D4-97, every slot needed the last frame's CPU <=
  // SLOT_FRAME_CPU_MS, the asked view's too, so at 8.4 or 11.2 ms the switch never left
  // "Preparing". D4-97 bounded the wait at 60 frames, then a slot every SLOT_EVERY frames: 3.1-3.2 s
  // in Chrome, over U4's 2 s. D4-98: the wait is 30 frames, then the asked view takes a slot every
  // frame (the viewer already waits on "Preparing", so the frame budget is the cheaper thing to
  // spend); the background keeps the CPU rule.
  const booted = () => {
    const s = createWarmScheduler();
    for (const id of BOOT_CONFIGS) s.done(id);
    return s;
  };
  const frameMs = 1000 / 60;
  const tenMinutes = 60 * 600;
  /** The asked view's slots (frame numbers) over the run; `doneAfter`: its warm frames. */
  const run = (cpu: (f: number) => number, doneAfter = Infinity) => {
    const s = booted();
    const slots: number[] = [];
    let shown: number | null = null;
    for (let f = 0; f < tenMinutes && shown === null; f++) {
      const id = s.next(f, cpu(f), 'cutaway+tracers', { nowMs: f * frameMs, switchPending: true });
      if (id === 'cutaway+tracers') slots.push(f);
      if (slots.length >= doneAfter) s.done('cutaway+tracers');
      if (s.isWarm('cutaway+tracers')) shown = f;
    }
    return { s, slots, shown };
  };
  const everyFrameFrom = (f0: number, n: number) => Array.from({ length: n }, (_, k) => f0 + k);

  it('the bound is 30 frames of preparing; the give-up counts the frames waited (about 13 s)', () => {
    expect(COLD_SWITCH_WAIT_FRAMES).toBe(30);
    expect(MAX_PREPARE_FRAMES).toBe(800);
  });

  for (const [name, cpu] of [
    ['a steady 8.4 ms', 8.4],
    ['a steady 11.2 ms (critic 15: the held frame in the worker)', 11.2],
    ['a steady 16 ms', 16],
  ] as const)
    it(`at ${name} frame: the first slot at frame 30, then one every frame`, () => {
      const { slots } = run(() => cpu, 20);
      expect(slots).toEqual(everyFrameFrom(COLD_SWITCH_WAIT_FRAMES, 20));
    });

  it('at a steady 8.0 ms frame (under the bar): a slot every SLOT_EVERY frames from the first, then every frame from frame 30', () => {
    expect(run(() => 8.0, 5).slots).toEqual([0, 2, 4, 6, 8]);
    const { slots } = run(() => 8.0, 20);
    expect(slots).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 31, 32, 33, 34,
    ]);
  });

  it('loaded (9-14 ms, one frame in 50 at 8 ms): the light frame gives a slot, then every frame from frame 30', () => {
    const { slots } = run((f) => (f % 50 === 0 ? 8 : 9 + (f % 6)), 12);
    expect(slots).toEqual([0, ...everyFrameFrom(30, 11)]);
  });

  it('a configuration that needs k warm frames is shown 30 + (k - 1) frames after the click, at any steady CPU over the bar', () => {
    for (const cpu of [8.4, 11.2, 30])
      for (const k of [1, 3, 47]) {
        const { shown } = run(() => cpu, k);
        expect(shown, `${String(cpu)} ms, ${String(k)} warm frames`).toBe(
          COLD_SWITCH_WAIT_FRAMES + (k - 1),
        );
      }
  });

  it('at a light CPU, 47 warm frames (Cutaway) are shown by frame 61: 15 slots in the wait, then every frame', () => {
    expect(run(() => 4, 47).shown).toBe(61);
  });

  it('gives up on a view that never finishes after MAX_PREPARE_FRAMES frames waited (shown anyway, said)', () => {
    for (const cpu of [4, 11.2]) {
      const { s, shown } = run(() => cpu);
      expect(shown, `${String(cpu)} ms`).toBe(MAX_PREPARE_FRAMES);
      expect(s.gaveUp()).toEqual(['cutaway+tracers']);
    }
  });

  it('the background keeps the CPU rule (D4-95 item 3): no background slot at a steady 8.4 ms', () => {
    const s = booted();
    for (let f = 0; f < 2000; f++)
      expect(
        s.next(f, 8.4, 'realistic', { nowMs: 1e6 + f * frameMs, switchPending: false }),
      ).toBeNull();
  });

  it('the background keeps its SLOT_EVERY once the asked view is shown', () => {
    const s = booted();
    const clock = (f: number) => ({ nowMs: 1e6 + f * frameMs, switchPending: false });
    for (let f = 0; f < 30; f++) expect(s.next(f, 11.2, 'exploded', clock(f))).toBeNull();
    expect(s.next(30, 11.2, 'exploded', clock(30))).toBe('exploded');
    s.done('exploded');
    // the shown view's last slot was at frame 30: the background's next at 32 at the earliest
    expect(s.next(31, 1, 'exploded', clock(31))).toBeNull();
    expect(s.next(32, 1, 'exploded', clock(32))).toBe('cutaway+tracers');
    expect(s.next(33, 1, 'exploded', clock(33))).toBeNull();
  });

  it('the wait starts again for the next cold switch (it is the asked view that waited)', () => {
    const s = booted();
    const clock = (f: number) => ({ nowMs: f * frameMs, switchPending: true });
    for (let f = 0; f < COLD_SWITCH_WAIT_FRAMES; f++)
      expect(s.next(f, 11.2, 'exploded', clock(f))).toBeNull();
    expect(s.next(COLD_SWITCH_WAIT_FRAMES, 11.2, 'exploded', clock(30))).toBe('exploded');
    expect(s.next(31, 11.2, 'exploded', clock(31))).toBe('exploded');
    s.done('exploded');
    // shown; then a switch into another cold view, at frame 200
    expect(s.next(150, 11.2, 'exploded', clock(150))).toBeNull();
    expect(s.next(200, 11.2, 'schlieren', clock(200))).toBeNull();
    expect(s.next(229, 11.2, 'schlieren', clock(229))).toBeNull();
    expect(s.next(230, 11.2, 'schlieren', clock(230))).toBe('schlieren');
    expect(s.next(231, 11.2, 'schlieren', clock(231))).toBe('schlieren');
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
