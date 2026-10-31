// D4-91's progressive warm-up, the pure part. D4-88 compiled every mode's pipelines behind the
// boot spinner, which moved the first-switch stall into the boot (10-26 s to ready). Now the
// worker posts `ready` once the boot configurations (the default Realistic view) are compiled,
// and warms the others in the background, Cutaway and Schlieren first, at most one configuration
// per frame-budget slot (EngineView.warmFrame: one budgeted frame of it, its pipelines compiled
// asynchronously). A view asked for before its configuration is warm is not shown yet: the view
// shown stays, the overlay says "preparing", and the switch happens as soon as it is warm.

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
   * then the background order.
   */
  next(frame: number, lastFrameCpuMs: number, asked: WarmConfigId): WarmConfigId | null;
  /** The configuration is compiled (its warm frame drew it whole, nothing pending). */
  done(id: WarmConfigId): void;
  isWarm(id: WarmConfigId): boolean;
  /** The configurations given up on after MAX_WARM_FRAMES (shown anyway). */
  gaveUp(): readonly WarmConfigId[];
  state(): { readonly warm: readonly WarmConfigId[]; readonly queue: readonly WarmConfigId[] };
}

export function createWarmScheduler(): WarmScheduler {
  const warm: WarmConfigId[] = [];
  const frames = new Map<WarmConfigId, number>();
  const given: WarmConfigId[] = [];
  let lastSlot = -Infinity;
  const isWarm = (id: WarmConfigId) => warm.includes(id);
  const done = (id: WarmConfigId) => {
    if (!isWarm(id)) warm.push(id);
  };
  const queue = () => [...BOOT_CONFIGS, ...BACKGROUND_ORDER].filter((id) => !isWarm(id));
  return {
    next(frame, cpuMs, asked) {
      if (frame - lastSlot < SLOT_EVERY || !(cpuMs <= SLOT_FRAME_CPU_MS)) return null;
      for (;;) {
        const id = !isWarm(asked) ? asked : queue()[0];
        if (id === undefined) return null;
        const n = frames.get(id) ?? 0;
        if (n >= MAX_WARM_FRAMES) {
          given.push(id);
          done(id);
          continue;
        }
        frames.set(id, n + 1);
        lastSlot = frame;
        return id;
      }
    },
    done,
    isWarm,
    gaveUp: () => [...given],
    state: () => ({ warm: [...warm], queue: queue() }),
  };
}

/**
 * The view to show (D4-91): the asked one once its configuration is warm (or at boot, when nothing
 * is shown yet), otherwise the one shown so far, with the mode being prepared.
 */
export function shownView(
  asked: RenderState,
  shown: RenderState | null,
  isWarm: (id: WarmConfigId) => boolean,
): { readonly view: RenderState; readonly preparing: ViewMode | null } {
  if (shown === null || isWarm(configFor(asked))) return { view: asked, preparing: null };
  return { view: shown, preparing: asked.viewMode };
}
