// Spike (d) render thread: the same BenchApp as the main-thread run, on an OffscreenCanvas.

import { BenchApp, type BenchConfig } from '../scene/benchApp';
import { probeWorkerFeatures } from './workerProbe';

export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number }
  | { type: 'run'; config: BenchConfig }
  | { type: 'probe' }
  | { type: 'dispose' };

let app: BenchApp | null = null;

function reply(id: number, payload: unknown): void {
  self.postMessage({ id, ok: true, payload });
}

self.onmessage = (event: MessageEvent<{ id: number; msg: ToWorker }>) => {
  const { id, msg } = event.data;
  const run = async (): Promise<unknown> => {
    switch (msg.type) {
      case 'init':
        app = await BenchApp.create(msg.canvas, msg.width, msg.height);
        return { adapter: app.adapter, crossOriginIsolated: self.crossOriginIsolated };
      case 'run':
        if (!app) throw new Error('worker not initialised');
        return app.run(msg.config, (cb) => {
          self.requestAnimationFrame(cb);
        });
      case 'probe':
        if (!app) throw new Error('worker not initialised');
        return probeWorkerFeatures(app.renderer);
      case 'dispose':
        await app?.dispose();
        app = null;
        return null;
    }
  };
  run().then(
    (payload) => {
      reply(id, payload);
    },
    (e: unknown) => {
      self.postMessage({
        id,
        ok: false,
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
    },
  );
};
