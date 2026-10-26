// Real Chrome (D3D12, Arc): the look-dev engine view renders with zero WebGPU validation
// errors, on the main thread and in a dedicated worker on an OffscreenCanvas (D2-4).

import { afterAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import type { WorkerReply, WorkerRequest } from '../../src/render/worker';

const HDRI = '/hdri/aircraft_workshop_01_1k.hdr';

function canvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  document.body.appendChild(c);
  return c;
}

describe('engine view, main thread', () => {
  let view: EngineView | null = null;
  afterAll(() => {
    view?.dispose();
  });

  it('renders every mode with zero GPU errors', async () => {
    view = await createEngineView({
      gpu: navigator.gpu,
      canvas: canvas(),
      definition: ENGINE_DEFINITION,
      width: 640,
      height: 360,
      dpr: 1,
      hdriUrl: HDRI,
      quality: 'test',
    });
    for (const preset of ['threeQuarterFront', 'cutaway', 'exploded', 'fanTakeoff'] as const) {
      view.setPreset(preset);
      for (let i = 0; i < 4; i++) view.frame(1 / 60);
      await view.device.device.queue.onSubmittedWorkDone();
    }
    expect(view.stats().errors).toEqual([]);
    expect(view.stats().cycleLabel).toBe('MOCK');
    expect(view.stats().triangles).toBeGreaterThan(1e5);
  });
});

describe('engine view, dedicated worker on an OffscreenCanvas', () => {
  it('renders the same scene module with zero GPU errors', async () => {
    const worker = new Worker(new URL('../../src/render/worker.ts', import.meta.url), {
      type: 'module',
    });
    const next = () =>
      new Promise<WorkerReply>((resolve) => {
        worker.onmessage = (e: MessageEvent<WorkerReply>) => {
          resolve(e.data);
        };
      });
    const send = (m: WorkerRequest, transfer: Transferable[] = []) => {
      worker.postMessage(m, transfer);
    };
    try {
      const offscreen = canvas().transferControlToOffscreen();
      const ready = next();
      send(
        {
          type: 'init',
          canvas: offscreen,
          width: 640,
          height: 360,
          dpr: 1,
          hdriUrl: HDRI,
          quality: 'test',
        },
        [offscreen],
      );
      const r = await ready;
      if (r.type === 'error') throw new Error(r.message);
      expect(r.type).toBe('ready');
      send({ type: 'preset', id: 'cutaway' });
      const done = next();
      send({ type: 'frames', n: 6 });
      const d = await done;
      if (d.type === 'error') throw new Error(d.message);
      expect(d).toEqual({ type: 'rendered', frames: 6, errors: [] });
    } finally {
      worker.terminate();
    }
  });
});
