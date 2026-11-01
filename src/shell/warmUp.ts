// D4-91's progressive warm-up, the pure part. D4-88 compiled every mode's pipelines behind the
// boot spinner, which moved the first-switch stall into the boot (10-26 s to ready). Now the
// worker posts `ready` once the boot configurations (the default Realistic view) are compiled,
// and warms the others in the background, Cutaway and Schlieren first, at most one configuration
// per frame-budget slot (EngineView.warmFrame: one budgeted frame of it, its pipelines compiled
// asynchronously). A view asked for before its configuration is warm is not shown yet: the view
// shown stays, the overlay says "preparing", and the switch happens as soon as it is warm.
// D4-95: the background warm-up is suspended around the viewer's input and mode switches (a warm
// frame that lands in a switch's window shows as a hitch in it, U2): no background slot while a
// switch is pending, nor for QUIET_AFTER_INPUT_MS after any input or switch. A cold switch still
// prepares its own view in that time, since the viewer waits for that one.
// D4-97 item 1 (W2A-I7): a cold switch has a bound. The asked view takes its slots under the same
// rule, but once it has waited COLD_SWITCH_WAIT_FRAMES frames it takes them whatever the last
// frame's CPU, and its give-up counts the frames waited, so a steady frame CPU over the bar can no
// longer hold the switch in "Preparing" for good (U4, PHYSICS.md 3.5). D4-98 item 1: the wait is
// 30 frames, and after it the asked view takes a slot every frame, not every SLOT_EVERY: the viewer
// already waits on "Preparing", so the frame budget is the cheaper thing to spend (D4-97's 60
// frames and every second frame showed Data in 3.1-3.2 s at a steady 8.4-11.2 ms, over U4's 2 s).
// The background keeps the CPU rule and SLOT_EVERY (D4-95 item 3).

import type { RenderState, ViewMode } from '../contracts/ui';
import type { FieldQuantityId } from '../flow/viz/fields';
import type { FlowVizModeId } from '../flow/viz/modes';
import type { LookMode } from '../render/presets';
import { cutPlaneQuantity } from './viewState';

/** What one warm frame renders: a flow mode on a look mode (EngineView.warmFrame). */
export interface WarmConfig {
  readonly flow: FlowVizModeId | null;
  readonly look: LookMode;
  /** The cut plane's quantity (the Data view's). */
  readonly quantity?: FieldQuantityId;
  readonly tracers?: boolean;
}

const dataConfig = (quantity: FieldQuantityId): WarmConfig => ({
  flow: 'data',
  look: 'cutaway',
  quantity,
  tracers: true,
});

/**
 * Every configuration the app's views draw (the Data plane at the app's four quantities,
 * src/shell/viewState.ts). Cutaway's and Data's tracers off, and Schlieren's on, draw a subset of
 * their configuration's pipelines.
 */
export const WARM_CONFIGS = {
  realistic: { flow: 'realistic', look: 'realistic' },
  'realistic+tracers': { flow: 'realistic', look: 'realistic', tracers: true },
  'cutaway+tracers': { flow: 'cutaway', look: 'cutaway', tracers: true },
  schlieren: { flow: 'schlieren', look: 'realistic' },
  exploded: { flow: null, look: 'exploded' },
  'data:mach+tracers': dataConfig('mach'),
  'data:p+tracers': dataConfig('p'),
  'data:rho+tracers': dataConfig('rho'),
  'data:t+tracers': dataConfig('t'),
} as const satisfies Record<string, WarmConfig>;

export type WarmConfigId = keyof typeof WARM_CONFIGS;

/** Compiled before `ready`: the app's first view (Realistic), with and without its tracers. */
export const BOOT_CONFIGS: readonly WarmConfigId[] = ['realistic', 'realistic+tracers'];

/** The background order (D4-91: Cutaway and Schlieren first, then Data at its default Mach). */
export const BACKGROUND_ORDER: readonly WarmConfigId[] = [
  'cutaway+tracers',
  'schlieren',
  'data:mach+tracers',
  'exploded',
  'data:p+tracers',
  'data:rho+tracers',
  'data:t+tracers',
];

/** A warm slot at most every this many frames (the warm frame's GPU time joins its frame's). */
export const SLOT_EVERY = 2;
/**
 * A slot only after a frame whose CPU took at most half the 16.7 ms frame (the warm frame's own
 * CPU is budgeted inside it: src/app/simWorker.ts WARM_BUDGET).
 */
export const SLOT_FRAME_CPU_MS = 8.3;
/**
 * The warm frames one configuration may take before it is given up on (shown anyway, its last
 * pipelines compiling on first use, and said so): about 13 s at 60 fps and SLOT_EVERY 2. The
 * slowest, Cutaway, took 6.9-14.5 s to compile in one frame at boot (round 3).
 */
export const MAX_WARM_FRAMES = 400;
/**
 * D4-97 item 1, D4-98 item 1: after this many frames of preparing, the asked view takes a slot
 * every frame, whatever the last frame's CPU. 0.5 s at 60 fps.
 */
export const COLD_SWITCH_WAIT_FRAMES = 30;
/**
 * D4-97 item 1: the asked view is given up on (shown anyway, its last pipelines compiling on first
 * use, and said so) after this many frames waited, not slots taken: about 13 s at 60 fps (the
 * background's give-up, MAX_WARM_FRAMES slots at SLOT_EVERY).
 */
export const MAX_PREPARE_FRAMES = 800;
/** D4-95: no background slot for this long after any input or switch, ms. */
export const QUIET_AFTER_INPUT_MS = 1000;

/** D4-95: the frame's time and whether a mode switch is pending, for the quiet rule. */
export interface WarmClock {
  /** The frame's time, ms (the clock input() is given). */
  readonly nowMs: number;
  /** A mode switch not yet done: the asked view not yet shown, or its transition not settled. */
  readonly switchPending: boolean;
}

/** The configuration a view needs compiled before it is shown. */
export function configFor(view: RenderState): WarmConfigId {
  switch (view.viewMode) {
    case 'realistic':
      return view.overlays.particles ? 'realistic+tracers' : 'realistic';
    case 'cutaway':
      return 'cutaway+tracers';
    case 'schlieren':
      return 'schlieren';
    case 'exploded':
      return 'exploded';
    case 'data': {
      const q = cutPlaneQuantity(view) ?? 'mach';
      return q === 'p' || q === 'rho' || q === 't' ? `data:${q}+tracers` : 'data:mach+tracers';
    }
  }
}

export interface WarmScheduler {
  /**
   * The configuration to warm in this frame (null: no slot, or all warm): the asked view's first,
   * then the background order, which waits while the clock says suspended (D4-95).
   */
  next(
    frame: number,
    lastFrameCpuMs: number,
    asked: WarmConfigId,
    clock: WarmClock,
  ): WarmConfigId | null;
  /** D4-95: a viewer input (a command, the orbit, a camera preset, a field choice, a resize). */
  input(nowMs: number): void;
  /** D4-95: whether the background waits at this time (an input or a switch less than 1 s ago). */
  suspended(nowMs: number): boolean;
  /** The configuration is compiled (its warm frame drew it whole, nothing pending). */
  done(id: WarmConfigId): void;
  isWarm(id: WarmConfigId): boolean;
  /**
   * The configurations given up on after MAX_WARM_FRAMES slots (the background), or (the asked
   * view) after MAX_PREPARE_FRAMES frames waited (shown anyway).
   */
  gaveUp(): readonly WarmConfigId[];
  state(): { readonly warm: readonly WarmConfigId[]; readonly queue: readonly WarmConfigId[] };
}

export function createWarmScheduler(): WarmScheduler {
  const warm: WarmConfigId[] = [];
  const frames = new Map<WarmConfigId, number>();
  const given: WarmConfigId[] = [];
  let lastSlot = -Infinity;
  // D4-97 item 1: the cold view the viewer asked for, and the frame its wait began
  let preparing: { readonly id: WarmConfigId; readonly since: number } | null = null;
  const giveUp = (id: WarmConfigId) => {
    given.push(id);
    done(id);
  };
  // the background waits until then: QUIET_AFTER_INPUT_MS after the last input or pending switch
  let quietUntil = -Infinity;
  const quiet = (untilMs: number) => {
    quietUntil = Math.max(quietUntil, untilMs);
  };
  const isWarm = (id: WarmConfigId) => warm.includes(id);
  const done = (id: WarmConfigId) => {
    if (!isWarm(id)) warm.push(id);
  };
  const queue = () => [...BOOT_CONFIGS, ...BACKGROUND_ORDER].filter((id) => !isWarm(id));
  const slot = (id: WarmConfigId, frame: number) => {
    frames.set(id, (frames.get(id) ?? 0) + 1);
    lastSlot = frame;
    return id;
  };
  return {
    next(frame, cpuMs, asked, clock) {
      if (clock.switchPending) quiet(clock.nowMs + QUIET_AFTER_INPUT_MS);
      if (isWarm(asked)) preparing = null;
      else if (preparing?.id !== asked) preparing = { id: asked, since: frame };
      const waited = preparing === null ? 0 : frame - preparing.since;
      if (preparing !== null && waited >= MAX_PREPARE_FRAMES) {
        giveUp(preparing.id);
        preparing = null;
      }
      // the asked view's own bound: past it, a slot every frame whatever the last frame's CPU
      if (preparing !== null && waited >= COLD_SWITCH_WAIT_FRAMES) return slot(preparing.id, frame);
      if (frame - lastSlot < SLOT_EVERY || cpuMs > SLOT_FRAME_CPU_MS) return null;
      const suspended = clock.nowMs < quietUntil;
      for (;;) {
        // while suspended only a cold switch's own view (the one the viewer waits for)
        const id = !isWarm(asked) ? asked : suspended ? undefined : queue()[0];
        if (id === undefined) return null;
        // the asked view's give-up is its frames waited (MAX_PREPARE_FRAMES), not its slots
        if (id === asked) return slot(id, frame);
        const n = frames.get(id) ?? 0;
        if (n >= MAX_WARM_FRAMES) {
          giveUp(id);
          continue;
        }
        return slot(id, frame);
      }
    },
    input(nowMs) {
      quiet(nowMs + QUIET_AFTER_INPUT_MS);
    },
    suspended: (nowMs) => nowMs < quietUntil,
    done,
    isWarm,
    gaveUp: () => [...given],
    state: () => ({ warm: [...warm], queue: queue() }),
  };
}

/**
 * W2A-N23: the boot configurations the boot's warm-up finished (its report, in the same order).
 * Only these are marked warm; an unfinished one is left to the scheduler, which warms it first
 * (the asked view's, or the queue's head), instead of its first frames compiling it unseen.
 */
export function bootWarmed(
  ids: readonly WarmConfigId[],
  report: readonly { readonly done: boolean }[],
): WarmConfigId[] {
  return ids.filter((_, i) => report[i]?.done === true);
}

/**
 * The view to show (D4-91): the asked one once its configuration is warm (or at boot, when nothing
 * is shown yet, or when it needs the configuration already shown: W2A-N23's unfinished boot view),
 * otherwise the one shown so far, with the mode being prepared.
 */
export function shownView(
  asked: RenderState,
  shown: RenderState | null,
  isWarm: (id: WarmConfigId) => boolean,
): { readonly view: RenderState; readonly preparing: ViewMode | null } {
  if (shown === null || isWarm(configFor(asked)) || configFor(shown) === configFor(asked))
    return { view: asked, preparing: null };
  return { view: shown, preparing: asked.viewMode };
}
