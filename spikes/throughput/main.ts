// Spike (a) page. The harness (spikes/bench/run.ts) drives it through window.__bench; opening
// it by hand with ?demo runs one short configuration and prints the result.

import { BenchApp, type BenchConfig, type ConfigResult } from '../scene/benchApp';
import { QUICK } from '../lib/protocol';
import { pageReport, type PageReport } from './pageReport';
import { trackVisibility } from '../scene/visibilityTracker';

/** A configuration's result plus how long the page was hidden during its runs (D0-1). */
export type ThroughputResult = ConfigResult & { readonly pageHiddenMs: number };

export interface BenchHandle {
  ready: Promise<PageReport>;
  run(config: BenchConfig): Promise<ThroughputResult>;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    __bench?: BenchHandle;
  }
}

const canvas = document.getElementById('view');
const status = document.getElementById('status');
if (!(canvas instanceof HTMLCanvasElement) || !status) throw new Error('page markup missing');

const hiddenDuring = trackVisibility();
const app = BenchApp.create(canvas, 1920, 1080);
const raf = (cb: (t: number) => void) => {
  requestAnimationFrame(cb);
};

window.__bench = {
  ready: app.then((a) => pageReport(a.adapter)),
  run: async (config) => {
    status.textContent = `running ${config.id}...`;
    const result = await (await app).run(config, raf);
    const a = result.aggregate;
    status.textContent = `${config.id}: ${a.solverMsPerIt?.toFixed(3) ?? '-'} ms/it, ${a.itPerSec.toFixed(0)} it/s, frame p50 ${a.frameTimeP50.toFixed(2)} ms`;
    return { ...result, pageHiddenMs: hiddenDuring(result.measured) };
  },
  dispose: async () => {
    await (await app).dispose();
  },
};

if (new URLSearchParams(location.search).has('demo')) {
  void window.__bench
    .run({
      id: 'demo-130k-16x8',
      grid: { ni: 512, nj: 256 },
      blocks: { bi: 4, bj: 3 },
      tile: { x: 16, y: 8 },
      iterations: 'adaptive',
      protocol: QUICK,
      particles: 65536,
    })
    .then((r) => {
      status.textContent = JSON.stringify(r.aggregate, null, 2);
    });
}
