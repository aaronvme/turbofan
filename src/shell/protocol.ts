// The main thread <-> sim worker messages (D2-4). Commands go in as SimCommandMessages (the
// contract, validated again in the worker); snapshots come out frozen-and-cloned with what the
// app shows beside them: the frame budget, the solver's iteration plan, the lost-solve cause
// (W2F-I1, kept by the model, not by the snapshot contract) and the projected callout anchors.
// The main thread owns sizing and input (DPR, resize, the orbit event proxy).

import type { SimCommandMessage, SimSnapshot } from '../contracts/sim';
import type { FlowFieldSource } from '../contracts/flow';
import type { Anchor } from '../hud/callouts';
import type { OrbitInput } from './orbit';

export type FieldChoice = FlowFieldSource;

export type ToWorker =
  | {
      readonly type: 'init';
      readonly canvas: OffscreenCanvas;
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
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
  | { readonly type: 'field'; readonly source: FieldChoice };

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
  /** CPU ms of the whole worker frame (sim + render submit), rolling median. */
  readonly frameCpuMs: number;
  /** Frames per second over the last second, from rAF timestamps. */
  readonly fps: number;
}

export interface AppDiagnostics {
  readonly budget: FrameBudget;
  /** W2F-I1: why the last matched solve was lost (null: none lost since the reset). */
  readonly lostSolveCause: string | null;
  /** The worker's own errors so far (GPU errors, a throwing step), newest last, at most 8. */
  readonly errors: readonly string[];
  readonly adapter: string;
  readonly triangles: number;
  readonly renderScale: number;
}

export type FromWorker =
  | { readonly type: 'ready'; readonly adapter: string }
  | {
      readonly type: 'snapshot';
      readonly snapshot: SimSnapshot;
      readonly diagnostics: AppDiagnostics;
      readonly anchors: readonly Anchor[];
      /** Problems of the commands refused since the last snapshot. */
      readonly refused: readonly string[];
    }
  | { readonly type: 'gpu-error'; readonly message: string }
  | { readonly type: 'device-lost'; readonly message: string }
  | { readonly type: 'fatal'; readonly message: string };
