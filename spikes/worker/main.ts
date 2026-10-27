// Spike (d) page: ?mode=main|worker&react=<Hz> (0 = no React load), or ?mode=coi. The harness
// drives it through window.__workerBench. In both render modes the frame-time statistics come
// from the thread that renders; the React load always runs on the main thread, as the UI will.

import { BenchApp, type BenchConfig, type ConfigResult } from '../scene/benchApp';
import { summarize, type Summary } from '../lib/stats';
import { trackFocus, trackVisibility } from '../scene/visibilityTracker';
import { mountReactLoad, type ReactLoadStats } from './reactLoad';
import type { ToWorker } from './worker';
import type { ProbeResult } from './workerProbe';

export interface WorkerBenchResult {
  readonly mode: string;
  /** React load update rate in Hz (0 = none). */
  readonly reactHz: number;
  readonly frame: ConfigResult;
  /** React commits and their render durations (Profiler actualDuration) during the runs. */
  readonly reactUpdates: number;
  readonly reactCommitMs: Summary | null;
  /** Main-thread long tasks (> 50 ms) that started during the runs. */
  readonly longTasks: { count: number; totalMs: number; maxMs: number };
  /** How long the page was hidden during the runs; > 0 makes the timing invalid (D0-1). */
  readonly pageHiddenMs: number;
  /** How often the page lost focus during the runs; > 0 makes the timing invalid (D3-6). */
  readonly pageBlurs: number;
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
const reactHz = Number(params.get('react') ?? '0');
if (!Number.isFinite(reactHz) || reactHz < 0) throw new Error('react=<Hz> must be >= 0');
const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !ui) throw new Error('page markup missing');

const hiddenDuring = trackVisibility();
const blursDuring = trackFocus();

/** Long tasks with absolute start times (timeOrigin + startTime), to compare across threads. */
const longTasks: { start: number; duration: number }[] = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    longTasks.push({ start: performance.timeOrigin + e.startTime, duration: e.duration });
  }
}).observe({ type: 'longtask', buffered: true });

let reactStats: ReactLoadStats | null = null;
if (reactHz > 0) reactStats = mountReactLoad(ui, reactHz);

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

function finish(frame: ConfigResult): WorkerBenchResult {
  const from = frame.measured.timeOrigin + frame.measured.from;
  const to = frame.measured.timeOrigin + frame.measured.to;
  const tasks = longTasks.filter((t) => t.start >= from && t.start < to).map((t) => t.duration);
  const commits = (reactStats?.commits ?? []).filter((c) => c.at >= from && c.at < to);
  return {
    mode,
    reactHz,
    frame,
    reactUpdates: commits.length,
    reactCommitMs: commits.length > 0 ? summarize(commits.map((c) => c.ms)) : null,
    longTasks: {
      count: tasks.length,
      totalMs: tasks.reduce((s, x) => s + x, 0),
      maxMs: tasks.length > 0 ? Math.max(...tasks) : 0,
    },
    pageHiddenMs: hiddenDuring(frame.measured),
    pageBlurs: blursDuring(frame.measured),
  };
}

async function coiCheck(): Promise<CoiReport> {
  let sab: string;
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
      return finish((await call({ type: 'run', config })) as ConfigResult);
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
      const result = await (
        await app
      ).run(config, (cb) => {
        requestAnimationFrame(cb);
      });
      return finish(result);
    },
    probe: () => Promise.resolve(null),
    dispose: async () => {
      if (app) await (await app).dispose();
    },
    coiCheck,
  };
}
window.__workerBench = handle;
