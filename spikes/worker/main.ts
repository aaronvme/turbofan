// Spike (d) page: ?mode=main|worker&react=0|1, or ?mode=coi. The harness drives it through
// window.__workerBench. In both render modes the frame-time statistics come from the thread
// that renders; the React load always runs on the main thread, as the UI will.

import { BenchApp, type BenchConfig, type ConfigResult } from '../scene/benchApp';
import { summarize, type Summary } from '../lib/stats';
import { mountReactLoad, type ReactLoadStats } from './reactLoad';
import type { ToWorker } from './worker';
import type { ProbeResult } from './workerProbe';

export interface WorkerBenchResult {
  readonly mode: string;
  readonly react: boolean;
  readonly frame: ConfigResult;
  readonly reactUpdates: number;
  readonly reactCommitMs: Summary | null;
  readonly longTasks: { count: number; totalMs: number; maxMs: number };
}

export interface CoiReport {
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: string;
  readonly worker: unknown;
}

export interface WorkerBenchHandle {
  ready: Promise<unknown>;
  run(config: BenchConfig): Promise<WorkerBenchResult>;
  probe(): Promise<Record<string, ProbeResult> | null>;
  dispose(): Promise<void>;
  coiCheck(): Promise<CoiReport>;
}

declare global {
  interface Window {
    __workerBench?: WorkerBenchHandle;
  }
}

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'main';
const withReact = params.get('react') === '1';
const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !ui) throw new Error('page markup missing');

const longTasks: number[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) longTasks.push(e.duration);
}).observe({ type: 'longtask', buffered: true });

let reactStats: ReactLoadStats | null = null;
if (withReact) reactStats = mountReactLoad(ui);

/** Request/response over postMessage. */
function workerChannel(w: Worker) {
  let next = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  w.onmessage = (
    e: MessageEvent<{ id: number; ok: boolean; payload?: unknown; error?: string }>,
  ) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.payload);
    else p.reject(new Error(e.data.error));
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`worker error: ${e.message}`));
    pending.clear();
  };
  return (msg: ToWorker, transfer: Transferable[] = []) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, msg }, transfer);
    });
}

function finish(frame: ConfigResult, startTasks: number): WorkerBenchResult {
  const tasks = longTasks.slice(startTasks);
  return {
    mode,
    react: withReact,
    frame,
    reactUpdates: reactStats?.updates ?? 0,
    reactCommitMs:
      reactStats && reactStats.commitMs.length > 0 ? summarize(reactStats.commitMs) : null,
    longTasks: {
      count: tasks.length,
      totalMs: tasks.reduce((s, x) => s + x, 0),
      maxMs: tasks.length > 0 ? Math.max(...tasks) : 0,
    },
  };
}

async function coiCheck(): Promise<CoiReport> {
  let sab = 'unavailable';
  let shared: SharedArrayBuffer | null = null;
  try {
    shared = new SharedArrayBuffer(16);
    sab = 'constructed';
  } catch (e) {
    sab = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const w = new Worker(new URL('./coiWorker.ts', import.meta.url), { type: 'module' });
  const report = await new Promise<unknown>((resolve) => {
    w.onmessage = (e) => {
      resolve(e.data);
    };
    w.postMessage({ shared });
  });
  w.terminate();
  const seen = shared ? Atomics.load(new Int32Array(shared), 0) : null;
  return {
    crossOriginIsolated,
    sharedArrayBuffer: sab,
    worker: { ...(report as object), mainSawWorkerWrite: seen === 42 },
  };
}

let handle: WorkerBenchHandle;
if (mode === 'worker') {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const call = workerChannel(worker);
  const offscreen = canvas.transferControlToOffscreen();
  const ready = call({ type: 'init', canvas: offscreen, width: 1920, height: 1080 }, [offscreen]);
  handle = {
    ready: ready.then((r) => ({ ...(r as object), innerWidth, innerHeight, devicePixelRatio })),
    run: async (config) => {
      await ready;
      const start = longTasks.length;
      return finish((await call({ type: 'run', config })) as ConfigResult, start);
    },
    probe: async () => (await call({ type: 'probe' })) as Record<string, ProbeResult>,
    dispose: async () => {
      await call({ type: 'dispose' });
      worker.terminate();
    },
    coiCheck,
  };
} else {
  const app = mode === 'coi' ? null : BenchApp.create(canvas, 1920, 1080);
  handle = {
    ready: app
      ? app.then((a) => ({ adapter: a.adapter, innerWidth, innerHeight, devicePixelRatio }))
      : Promise.resolve(null),
    run: async (config) => {
      if (!app) throw new Error('mode=coi has no renderer');
      const start = longTasks.length;
      const result = await (
        await app
      ).run(config, (cb) => {
        requestAnimationFrame(cb);
      });
      return finish(result, start);
    },
    probe: () => Promise.resolve(null),
    dispose: async () => {
      if (app) await (await app).dispose();
    },
    coiCheck,
  };
}
window.__workerBench = handle;
