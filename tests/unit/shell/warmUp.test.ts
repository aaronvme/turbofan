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
  PREPARE_FRAME_CPU_MS,
  QUIET_AFTER_INPUT_MS,
  SLOT_EVERY,
  SLOT_FRAME_CPU_MS,
  WARM_BUDGET_MS,
  WARM_CONFIGS,
  bootWarmed,
  configFor,
  createWarmScheduler,
  nextWarmBudget,
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

  it('D4-100: the asked view takes a slot every frame while preparing, whatever the last frame took', () => {
    const s = booted();
    expect(s.next(0, 1, 'exploded', at(0, true))).toBe('exploded');
    expect(s.next(1, 1, 'exploded', at(17, true))).toBe('exploded');
    expect(s.next(SLOT_EVERY, SLOT_FRAME_CPU_MS + 1, 'exploded', at(34, true))).toBe('exploded');
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

  it('the bound is 0 frames of preparing (D4-100; D4-98 had 30); the give-up counts the frames waited (about 13 s)', () => {
    expect(COLD_SWITCH_WAIT_FRAMES).toBe(0);
    expect(MAX_PREPARE_FRAMES).toBe(800);
  });

  for (const [name, cpu] of [
    ['a steady 8.4 ms', 8.4],
    ['a steady 11.2 ms (critic 15: the held frame in the worker)', 11.2],
    ['a steady 16 ms', 16],
  ] as const)
    it(`at ${name} frame: the first slot at frame ${String(COLD_SWITCH_WAIT_FRAMES)}, then one every frame`, () => {
      const { slots } = run(() => cpu, 20);
      expect(slots).toEqual(everyFrameFrom(COLD_SWITCH_WAIT_FRAMES, 20));
    });

  it('at a steady 8.0 ms frame (under the bar): a slot every frame from the first (D4-100)', () => {
    expect(run(() => 8.0, 5).slots).toEqual([0, 1, 2, 3, 4]);
    expect(run(() => 8.0, 20).slots).toEqual(everyFrameFrom(0, 20));
  });

  it('loaded (9-14 ms, one frame in 50 at 8 ms): a slot every frame from the first (D4-100)', () => {
    const { slots } = run((f) => (f % 50 === 0 ? 8 : 9 + (f % 6)), 12);
    expect(slots).toEqual(everyFrameFrom(0, 12));
  });

  it('a configuration that needs k slots is shown COLD_SWITCH_WAIT_FRAMES + (k - 1) frames after the click, at any steady CPU', () => {
    for (const cpu of [8.4, 11.2, 30])
      for (const k of [1, 3, 47]) {
        const { shown } = run(() => cpu, k);
        expect(shown, `${String(cpu)} ms, ${String(k)} warm frames`).toBe(
          COLD_SWITCH_WAIT_FRAMES + (k - 1),
        );
      }
  });

  it('at a light CPU, 47 slots (Cutaway) are shown at frame 46: every frame (D4-100; D4-98 waited, frame 61)', () => {
    expect(run(() => 4, 47).shown).toBe(46);
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
    expect(s.next(30, 11.2, 'exploded', clock(30))).toBe('exploded');
    s.done('exploded');
    // the shown view's last slot was at frame 30: the background's next at 32 at the earliest
    expect(s.next(31, 1, 'exploded', clock(31))).toBeNull();
    expect(s.next(32, 1, 'exploded', clock(32))).toBe('cutaway+tracers');
    expect(s.next(33, 1, 'exploded', clock(33))).toBeNull();
  });

  it('each cold switch prepares from its first frame (it is the asked view that is prepared)', () => {
    const s = booted();
    const clock = (f: number) => ({ nowMs: f * frameMs, switchPending: true });
    expect(s.next(0, 11.2, 'exploded', clock(0))).toBe('exploded');
    expect(s.next(1, 11.2, 'exploded', clock(1))).toBe('exploded');
    s.done('exploded');
    // shown; then a switch into another cold view, at frame 200
    expect(s.next(150, 11.2, 'exploded', clock(150))).toBeNull();
    expect(s.next(200, 11.2, 'schlieren', clock(200))).toBe('schlieren');
    expect(s.next(201, 11.2, 'schlieren', clock(201))).toBe('schlieren');
  });
});

describe('D4-100 (U4 on AC): past its wait the asked view warms several frames in one, up to PREPARE_FRAME_CPU_MS', () => {
  // The W2 official window (AC, quiet): the cold switch into Data took 2.46-2.56 s against U4's
  // 2 s, with 56-57 warm frames, one a frame past the 30-frame wait, each lengthening its frame
  // past one vsync. The longest snapshot gap while preparing was 108-145 ms against the test's
  // 1 s freeze bar, so there is room: past its wait the asked view's frame takes warm frames until
  // its warm CPU reaches PREPARE_FRAME_CPU_MS (one object is always let through, so one slow build
  // can pass it). Before the wait, and for the background, a slot is one warm frame at
  // WARM_BUDGET_MS, as before (D4-95 item 3: the background keeps its rule).
  const booted = () => {
    const s = createWarmScheduler();
    for (const id of BOOT_CONFIGS) s.done(id);
    return s;
  };
  const frameMs = 1000 / 60;
  const pending = (f: number): WarmClock => ({ nowMs: f * frameMs, switchPending: true });

  it('the cap is stated: 200 ms of warm CPU a frame (inside D4-100 gap room), one warm frame 4 ms', () => {
    expect(PREPARE_FRAME_CPU_MS).toBe(200);
    expect(WARM_BUDGET_MS).toBe(4);
    // a frame of the cap, its slowest object (the official run's 24-26 ms) and a heavy frame's own
    // CPU stays far inside the 1 s freeze bar (firstSwitch.test.tsx FREEZE_MS)
    expect(PREPARE_FRAME_CPU_MS + 50 + 16.7).toBeLessThan(1000 / 2);
  });

  it('a background slot: one warm frame at WARM_BUDGET_MS; the asked view: the cap from its first frame', () => {
    const s = booted();
    expect(s.slot(0, 4, 'realistic', calm(0))).toEqual({
      id: 'cutaway+tracers',
      capMs: WARM_BUDGET_MS,
      several: false,
    });
    const t = booted();
    expect(t.slot(0, 4, 'data:mach+tracers', pending(0))).toEqual({
      id: 'data:mach+tracers',
      capMs: PREPARE_FRAME_CPU_MS,
      several: true,
    });
  });

  for (const cpu of [4, 8.4, 11.2])
    it(`past the wait (at a ${String(cpu)} ms frame) the asked view's slot is several warm frames up to the cap, every frame`, () => {
      const s = booted();
      for (let f = 0; f < COLD_SWITCH_WAIT_FRAMES; f++)
        s.slot(f, cpu, 'data:mach+tracers', pending(f));
      for (let f = COLD_SWITCH_WAIT_FRAMES; f < COLD_SWITCH_WAIT_FRAMES + 5; f++)
        expect(s.slot(f, cpu, 'data:mach+tracers', pending(f)), String(f)).toEqual({
          id: 'data:mach+tracers',
          capMs: PREPARE_FRAME_CPU_MS,
          several: true,
        });
      // next() names the same configuration
      expect(s.next(40, cpu, 'data:mach+tracers', pending(40))).toBe('data:mach+tracers');
    });

  it('nextWarmBudget: the first warm frame takes the cap; more follow under the cap while they draw something new', () => {
    const several = { id: 'data:mach+tracers', capMs: 200, several: true } as const;
    const one = { id: 'cutaway+tracers', capMs: 4, several: false } as const;
    const report = (done: boolean, newObjects: number) => ({ done, newObjects });
    expect(nextWarmBudget(several, 0, null)).toBe(200);
    expect(nextWarmBudget(one, 0, null)).toBe(4);
    // a background slot is one warm frame, whatever it drew
    expect(nextWarmBudget(one, 1, report(false, 1))).toBe(0);
    // the cap less what the frame's warm frames took so far
    expect(nextWarmBudget(several, 60, report(false, 3))).toBe(140);
    expect(nextWarmBudget(several, 199, report(false, 3))).toBe(1);
    // the cap reached, the configuration done, or nothing new drawn (what is left is the GPU
    // compiling, which another warm frame in the same frame cannot hurry): no more this frame
    expect(nextWarmBudget(several, 200, report(false, 3))).toBe(0);
    expect(nextWarmBudget(several, 230, report(false, 3))).toBe(0);
    expect(nextWarmBudget(several, 50, report(true, 3))).toBe(0);
    expect(nextWarmBudget(several, 50, report(false, 0))).toBe(0);
  });

  /**
   * A cold switch in a model of the warm frames: the configuration's objects, each built once in
   * a warm frame (its build CPU, ms; at least one a warm frame, then while the budget lasts), each
   * drawn with a fixed CPU once built; a warm frame is done when it drew nothing new and nothing
   * is left. The frames at 60 Hz, each lasting whole vsyncs: its own CPU plus its warm frames',
   * which the next frame's slot rule sees (the worker's lastFrameMs). The CPU side only: the GPU's
   * compiles run alongside, and the Chrome run measures the whole (firstSwitch.test.tsx).
   */
  const coldSwitch = (
    frameCpuMs: number,
    builds: readonly number[],
    drawMs: number,
    /** D4-98's rule: one warm frame at WARM_BUDGET_MS a slot (the official run's). */
    oneWarmFrame = false,
  ) => {
    const s = booted();
    const asked = 'data:mach+tracers';
    let next = 0;
    let t = 0;
    let longest = 0;
    let lastCpu = frameCpuMs;
    /** One warm frame at a budget: its CPU, and what it drew new. */
    const warmFrame = (budget: number) => {
      let used = 0;
      let n = 0;
      while (next < builds.length && (n === 0 || used < budget)) {
        used += builds[next] ?? 0;
        next++;
        n++;
      }
      return { cpuMs: used + drawMs * next, done: n === 0, newObjects: n };
    };
    for (let f = 0; f < 2000; f++) {
      const given = s.slot(f, lastCpu, asked, { nowMs: t, switchPending: true });
      // D4-98's rule: in its 30-frame wait a slot only every SLOT_EVERY frames after a light frame
      const waiting =
        oneWarmFrame && f < 30 && (lastCpu > SLOT_FRAME_CPU_MS || f % SLOT_EVERY !== 0);
      const slot =
        given === null || waiting
          ? null
          : oneWarmFrame
            ? { ...given, capMs: WARM_BUDGET_MS, several: false }
            : given;
      let spent = 0;
      if (slot !== null) {
        let budget = nextWarmBudget(slot, 0, null);
        while (budget > 0) {
          const r = warmFrame(budget);
          spent += r.cpuMs;
          if (r.done) s.done(asked);
          budget = nextWarmBudget(slot, spent, r);
        }
      }
      lastCpu = frameCpuMs + spent;
      const wall = Math.ceil(lastCpu / frameMs - 1e-9) * frameMs;
      longest = Math.max(longest, wall);
      t += wall;
      if (s.isWarm(asked)) return { shownMs: t, longestFrameMs: longest };
    }
    return { shownMs: Infinity, longestFrameMs: longest };
  };

  it('the model: 57 objects of 4-26 ms (the official run: 56-57 warm frames, the slowest object 24-26 ms) show within 2 s at a light, 8.4 and 11.2 ms frame, no frame near 1 s', () => {
    const builds = Array.from({ length: 57 }, (_, k) => 4 + ((k * 7) % 23));
    for (const cpu of [4, 8.4, 11.2]) {
      const r = coldSwitch(cpu, builds, 0.05);
      expect(r.shownMs, `${String(cpu)} ms`).toBeLessThan(2000);
      expect(r.longestFrameMs, `${String(cpu)} ms`).toBeLessThan(PREPARE_FRAME_CPU_MS + 26 + 34);
      // D4-98's one warm frame a frame, in the same model, misses U4 as the official run did at a
      // steady frame over the slot rule (no slot in the wait: the model's light frames take 15
      // there, which the official light run, 2.46 s, did not show)
      if (cpu > SLOT_FRAME_CPU_MS)
        expect(coldSwitch(cpu, builds, 0.05, true).shownMs, `${String(cpu)} ms`).toBeGreaterThan(
          2000,
        );
    }
  });
});

describe('W2A-N29: a cold view the viewer leaves keeps no slots against the background cap', () => {
  // critic pass 18's probe (docs/reviews/probes/w2a-abandoned-cold.probe.ts.txt): past its wait
  // the asked view takes a slot every frame, and they counted against MAX_WARM_FRAMES, so a view
  // left after about 470 such slots (about 8 s, on a machine whose compiles take that long) was
  // given up at its first background slot with no further warm frame. Only background slots count
  // toward MAX_WARM_FRAMES now; the asked view's own give-up is its frames waited.
  for (const waited of [300, 420, 500, 790])
    it(`after ${String(waited)} frames as the asked view, it is warmed in the background, not given up`, () => {
      const s = createWarmScheduler();
      for (const id of ['realistic', 'realistic+tracers', 'cutaway+tracers', 'schlieren'] as const)
        s.done(id);
      const calmAt = (f: number) => ({ nowMs: f * 16.7, switchPending: false });
      for (let f = 0; f < waited; f++) s.next(f, 11.2, 'data:mach+tracers', calmAt(f));
      // back to Realistic (warm): the background reaches Data next (a calm clock, a light CPU)
      let got: string | null = null;
      for (let f = waited; f < waited + 50 && got === null; f++)
        got = s.next(f, 4, 'realistic', { nowMs: f * 16.7 + 5000, switchPending: false });
      expect(got).toBe('data:mach+tracers');
      expect(s.gaveUp()).toEqual([]);
      expect(s.isWarm('data:mach+tracers')).toBe(false);
    });

  it('a background configuration is still given up after MAX_WARM_FRAMES background slots', () => {
    const s = createWarmScheduler();
    for (const id of ['realistic', 'realistic+tracers', 'cutaway+tracers', 'schlieren'] as const)
      s.done(id);
    const calmAt = (f: number) => ({ nowMs: 1e6 + f * 16.7, switchPending: false });
    // 100 frames asked (70 every-frame slots past the wait), then left
    for (let f = 0; f < 100; f++) s.next(f, 11.2, 'data:mach+tracers', calmAt(f));
    // the asked view's last slot was at frame 99: the background's first at 101
    let f = 101;
    for (let k = 0; k < MAX_WARM_FRAMES; k++) {
      expect(s.next(f, 1, 'realistic', calmAt(f)), String(k)).toBe('data:mach+tracers');
      f += SLOT_EVERY;
    }
    expect(s.next(f, 1, 'realistic', calmAt(f))).toBe('exploded');
    expect(s.gaveUp()).toEqual(['data:mach+tracers']);
  });
});

describe('W2A-N23: the boot warm-up says whether it finished each configuration', () => {
  it('marks warm only the boot configurations it finished', () => {
    expect(bootWarmed(BOOT_CONFIGS, [{ done: true }, { done: true }])).toEqual(BOOT_CONFIGS);
    expect(bootWarmed(BOOT_CONFIGS, [{ done: true }, { done: false }])).toEqual(['realistic']);
    expect(bootWarmed(BOOT_CONFIGS, [{ done: false }, { done: true }])).toEqual([
      'realistic+tracers',
    ]);
    // a report shorter than the list (a warm-up that stopped) finished nothing past its end
    expect(bootWarmed(BOOT_CONFIGS, [{ done: true }])).toEqual(['realistic']);
  });

  it('an unfinished boot configuration is left to the scheduler, which warms it first', () => {
    const s = createWarmScheduler();
    for (const id of bootWarmed(BOOT_CONFIGS, [{ done: true }, { done: false }])) s.done(id);
    expect(s.state().queue[0]).toBe('realistic+tracers');
    expect(s.next(0, 4, 'realistic', calm(0))).toBe('realistic+tracers');
  });

  it('the boot view unfinished: shown (it is the view already on screen), never "preparing", and warmed first', () => {
    const s = createWarmScheduler();
    for (const id of bootWarmed(BOOT_CONFIGS, [{ done: false }, { done: true }])) s.done(id);
    const boot = view('realistic');
    const first = shownView(boot, null, (id) => s.isWarm(id));
    expect(first).toEqual({ view: boot, preparing: null });
    // the next frames: the same view asked and shown
    expect(shownView(boot, first.view, (id) => s.isWarm(id))).toEqual({
      view: boot,
      preparing: null,
    });
    expect(s.next(0, 4, 'realistic', calm(0))).toBe('realistic');
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
