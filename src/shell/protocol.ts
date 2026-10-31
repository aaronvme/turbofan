// The main thread <-> sim worker messages (D2-4). Commands go in as SimCommandMessages (the
// contract, validated again in the worker); snapshots come out frozen-and-cloned with what the
// app shows beside them: the frame budget, the solver's iteration plan, the lost-solve cause
// (W2F-I1, kept by the model, not by the snapshot contract) and the projected callout anchors.
// The main thread owns sizing and input (DPR, resize, the orbit event proxy).

import type { SimCommandMessage, SimSnapshot } from '../contracts/sim';
import type { FlowFieldSource } from '../contracts/flow';
import type { FlowLinkState } from '../flow/viz/fieldLink';
import type { AxialAnchor, Rect } from '../hud/callouts';
import type { ViewMode } from '../contracts/ui';
import type { OrbitInput } from './orbit';

export type FieldChoice = FlowFieldSource;

/**
 * The worker's cycle model: the reference calibration (the app), or the W1K-I2 part-power fit,
 * whose slam is a known held-gas-path case (W2F-N5): the browser suite measures the held step's
 * frame cost on it. Not a user setting.
 */
export type CycleChoice = 'reference' | 'partPowerFit';

export type ToWorker =
  | {
      readonly type: 'init';
      readonly canvas: OffscreenCanvas;
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
      /** Default 'reference'. */
      readonly cycle?: CycleChoice;
    }
  | {
      readonly type: 'resize';
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
    }
  | { readonly type: 'command'; readonly message: SimCommandMessage }
  | { readonly type: 'orbit'; readonly input: OrbitInput }
  | { readonly type: 'camera'; readonly preset: CameraPresetId }
  /** D4-92 (zz): the view's free area between the panels, CSS px (Schlieren's framing). */
  | { readonly type: 'viewArea'; readonly free: Rect }
  | { readonly type: 'field'; readonly source: FieldChoice }
  /**
   * The browser suite's controls, never sent by the app: a steady frame CPU (the worker pads each
   * frame's CPU to at least this many ms: U4's cold switch at any frame CPU, W2A-I7) and the knife
   * edge off (W2A-I10's S1 control, EngineView's noKnifeEdge).
   */
  | { readonly type: 'debug'; readonly frameCpuMs?: number; readonly knifeEdge?: boolean };

export type CameraPresetId = 'threeQuarterFront' | 'side' | 'hero' | 'hotSection';

/** What one frame cost (ms) and what D4-2 planned for the solver. */
export interface FrameBudget {
  /** Engine render GPU ms (P4's measure), median of the view's rolling window. */
  readonly renderGpuMs: number | null;
  /** Flow visuals GPU ms (render + compute), 0 with no flow mode. */
  readonly flowVisualsGpuMs: number;
  /** The solver's latest whole-frame GPU ms (iterations + resample). */
  readonly solverGpuMs: number | null;
  /** D4-2: min(5, 15 - render - flow visuals). */
  readonly solverBudgetMs: number;
  readonly solverIterations: number;
  readonly msPerIteration: number | null;
  /** CPU ms of the cycle step this frame, rolling median. */
  readonly cycleCpuMs: number;
  /** CPU ms of the cycle step, the worst frame of the rolling window (a held step shows here). */
  readonly cycleCpuMaxMs: number;
  /** CPU ms of the cycle step on frames whose gas path was held (W2F-N5), median; null: none. */
  readonly cycleCpuHeldMs: number | null;
  /** CPU ms of the whole worker frame (sim + render submit), rolling median. */
  readonly frameCpuMs: number;
  /** CPU ms of the whole worker frame, the worst of the rolling window. */
  readonly frameCpuMaxMs: number;
  /** CPU ms of the worker frame on held frames, median; null: none in the window. */
  readonly frameCpuHeldMs: number | null;
  /**
   * CPU ms of the latest MOCK raster (null: none yet), and how many there have been. Measured on
   * the raster's own worker, off the frame (only the boot raster, or a fallback, is on it).
   */
  readonly mockRasterMs: number | null;
  readonly mockRasters: number;
  /** Frames per second over the last second, from rAF timestamps. */
  readonly fps: number;
}

/** The MOCK raster's health (W2A-I1: a failure is annunciated, not only listed). */
export interface RasterHealth {
  /** Its worker failed, so the raster runs on the frame (slower frames, never a stale field). */
  readonly onFrame: boolean;
  /** Why the last raster (or its worker) failed; null: none failed. */
  readonly lastError: string | null;
}

export interface AppDiagnostics {
  readonly budget: FrameBudget;
  /**
   * D4-82: the drawn field's link state (the coupling for the badge and the legend; W2V-I6: why
   * the MOCK stands in for the solver asked for). null before the field is bound.
   */
  readonly field: FlowLinkState | null;
  readonly raster: RasterHealth;
  /**
   * D4-88's settled-view signal: the mode the view was asked for and how many frames it has
   * shown it settled (src/shell/settle.ts; the shots wait for SETTLED_FRAMES). D4-91: the mode
   * still being prepared (its pipelines compiling; the view shown is the previous one), or null.
   */
  readonly view: {
    readonly mode: ViewMode;
    readonly settledFrames: number;
    readonly preparing: ViewMode | null;
  };
  /**
   * D4-91's background warm-up (src/shell/warmUp.ts): the configurations compiled and still
   * queued, the warm frames so far, the slowest warm frame's CPU ms, those given up on. D4-95:
   * whether the background waited in this frame (an input or a switch less than 1 s ago).
   */
  readonly warm: {
    readonly warm: readonly string[];
    readonly queue: readonly string[];
    readonly frames: number;
    readonly cpuMaxMs: number;
    /** The slowest warm frame's configuration and its slowest new object, with its own ms. */
    readonly slowest: string;
    readonly gaveUp: readonly string[];
    readonly suspended: boolean;
  };
  /** D4-85: the canvas's backing store, px, and the pixel ratio it renders at. */
  readonly backingStore: { readonly width: number; readonly height: number; readonly dpr: number };
  /** D4-91: what the boot's warm-up (the boot configurations) took, wall ms, and each one's. */
  readonly warmUpMs: number;
  readonly warmUpSteps: readonly {
    readonly name: string;
    readonly ms: number;
    readonly cpuMs: number;
  }[];
  /** W2F-I1: why the last matched solve was lost (null: none lost since the reset). */
  readonly lostSolveCause: string | null;
  /** The worker's own errors so far (GPU errors, a throwing step), newest last, at most 8. */
  readonly errors: readonly string[];
  readonly adapter: string;
  readonly triangles: number;
  readonly renderScale: number;
}

export type FromWorker =
  /** Posted after the boot's pipeline warm-up (D4-88), so the spinner covers it. */
  | { readonly type: 'ready'; readonly adapter: string; readonly warmUpMs?: number }
  | {
      readonly type: 'snapshot';
      readonly snapshot: SimSnapshot;
      readonly diagnostics: AppDiagnostics;
      readonly anchors: readonly AxialAnchor[];
      /** D4-92 (zz): the engine's screen box (the cut views' label rows), null off screen. */
      readonly engineBox: Rect | null;
      /** Problems of the commands refused since the last snapshot. */
      readonly refused: readonly string[];
    }
  | { readonly type: 'gpu-error'; readonly message: string }
  | { readonly type: 'device-lost'; readonly message: string }
  /**
   * W2A-I1: the cycle step threw (a bug), so the sim stopped: the clock and the gas path are
   * frozen while the worker keeps rendering (the view can still be orbited and read).
   */
  | { readonly type: 'sim-stopped'; readonly message: string }
  /** The app cannot go on (init failed, the snapshots cannot be posted). */
  | { readonly type: 'fatal'; readonly message: string };
