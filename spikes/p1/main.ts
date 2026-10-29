// The P1 page of record (`npm run bench:p1`, D4-64): spikes/p1/appScene.ts on this page's
// canvas. The harness (spikes/bench/run.ts) loads a fresh page for every run, so every run gets a
// fresh device, and drives it through window.__p1.

import type { GpuErrorReport } from '../../src/gpu/device';
import { adapterReport, type BenchConfig } from '../scene/benchApp';
import { trackFocus, trackVisibility } from '../scene/visibilityTracker';
import type { ThroughputResult } from '../throughput/main';
import { pageReport, type PageReport } from '../throughput/pageReport';
import { createAppView, runInAppScene } from './appScene';

export interface P1Handle {
  ready: Promise<PageReport>;
  run(config: BenchConfig): Promise<ThroughputResult>;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __p1?: P1Handle;
  }
}

const canvas = document.getElementById('view');
const status = document.getElementById('status');
if (!(canvas instanceof HTMLCanvasElement) || !status) throw new Error('page markup missing');

const hiddenDuring = trackVisibility();
const blursDuring = trackFocus();
const errors: GpuErrorReport[] = [];
const view = createAppView(canvas, errors);
const raf = (cb: (t: number) => void) => {
  requestAnimationFrame(cb);
};

window.__p1 = {
  ready: view.then((v) => pageReport(adapterReport(v.device))),
  run: async (config) => {
    status.textContent = `running ${config.id}...`;
    const result = await runInAppScene({ view: await view, config, errors, raf });
    const a = result.aggregate;
    status.textContent = `${config.id}: ${a.solverMsPerIt?.toFixed(3) ?? '-'} ms/it, ${a.itPerSec.toFixed(0)} it/s, frame p50 ${a.frameTimeP50.toFixed(2)} ms`;
    return {
      ...result,
      pageHiddenMs: hiddenDuring(result.measured),
      pageBlurs: blursDuring(result.measured),
    };
  },
  dispose: async () => {
    await (await view).dispose();
  },
};
