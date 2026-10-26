// The engine view in a dedicated Worker on an OffscreenCanvas (D2-4): the same EngineView as
// the main-thread look-dev page. Messages in: init (the transferred canvas, size, DPR),
// resize, preset, mode, throttle, frames (render n frames at 1/60 s), timings. Messages out:
// ready, rendered (with the GPU errors so far), timings, gpu-error (as soon as the device
// reports one, not only inside a later reply), error. The main thread owns sizing and input.
//
// Messages that arrive while init is still running are queued and handled in order once the
// view exists (W1G-N3: they used to throw "init first").

import { ENGINE_DEFINITION } from '../engine/definition';
import type { PassMedians } from '../gpu/passTimings';
import { createEngineView, type EngineView } from './engineView';
import type { LookMode, LookPresetId } from './presets';

export type WorkerRequest =
  | {
      readonly type: 'init';
      readonly canvas: OffscreenCanvas;
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
      readonly quality?: 'test' | 'high';
    }
  | {
      readonly type: 'resize';
      readonly width: number;
      readonly height: number;
      readonly dpr: number;
    }
  | { readonly type: 'preset'; readonly id: LookPresetId }
  | { readonly type: 'mode'; readonly mode: LookMode }
  | { readonly type: 'throttle'; readonly lever: number }
  | { readonly type: 'frames'; readonly n: number }
  | { readonly type: 'timings' };

export type WorkerReply =
  | { readonly type: 'ready'; readonly triangles: number }
  | { readonly type: 'rendered'; readonly frames: number; readonly errors: readonly string[] }
  | { readonly type: 'timings'; readonly timings: PassMedians }
  | { readonly type: 'gpu-error'; readonly message: string }
  | { readonly type: 'error'; readonly message: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(m: WorkerReply): void;
  requestAnimationFrame(cb: () => void): number;
}
const scope = globalThis as unknown as WorkerScope;
let view: EngineView | null = null;
let chain: Promise<void> = Promise.resolve();

const nextFrame = () =>
  new Promise<void>((resolve) => {
    scope.requestAnimationFrame(() => {
      resolve();
    });
  });

async function handle(m: WorkerRequest): Promise<void> {
  if (m.type === 'init') {
    view = await createEngineView({
      gpu: navigator.gpu,
      canvas: m.canvas,
      definition: ENGINE_DEFINITION,
      width: m.width,
      height: m.height,
      dpr: m.dpr,
      quality: m.quality ?? 'high',
      onError: (r) => {
        scope.postMessage({ type: 'gpu-error', message: `${r.kind}: ${r.message}` });
      },
    });
    scope.postMessage({ type: 'ready', triangles: view.stats().triangles });
    return;
  }
  if (view === null) throw new Error('worker: init failed or was not sent first');
  switch (m.type) {
    case 'resize':
      view.setSize(m.width, m.height, m.dpr);
      break;
    case 'preset':
      view.setPreset(m.id);
      break;
    case 'mode':
      view.setMode(m.mode);
      break;
    case 'throttle':
      view.setThrottle(m.lever);
      break;
    case 'frames': {
      for (let i = 0; i < m.n; i++) {
        view.frame(1 / 60);
        await nextFrame();
      }
      await view.device.device.queue.onSubmittedWorkDone();
      const errors = view.stats().errors.map((e) => `${e.kind}: ${e.message}`);
      scope.postMessage({ type: 'rendered', frames: m.n, errors });
      break;
    }
    case 'timings':
      scope.postMessage({ type: 'timings', timings: view.stats().timings });
      break;
  }
}

scope.onmessage = (e) => {
  // one at a time, in arrival order: a message sent during init waits for it
  chain = chain.then(() =>
    handle(e.data).catch((err: unknown) => {
      scope.postMessage({ type: 'error', message: String(err) });
    }),
  );
};
