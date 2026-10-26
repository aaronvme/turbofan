// Real Chrome (D3D12, Arc): the look-dev engine view renders every mode and preset with zero
// WebGPU errors, on the main thread and in a dedicated worker on an OffscreenCanvas (D2-4),
// and the frames are real pictures (W1G-N2): the canvas is read back per preset and checked
// against luminance and structure bands, one quality preset at `high`. The per-pass GPU
// timestamps arrive (W1G-I2).

import { afterAll, describe, expect, it } from 'vitest';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createEngineView, type EngineView } from '../../src/render/engineView';
import { LOOK_PRESET_IDS, type LookPresetId } from '../../src/render/presets';
import type { WorkerReply, WorkerRequest } from '../../src/render/worker';

const W = 640;
const H = 360;

function canvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  document.body.appendChild(c);
  return c;
}

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

interface FrameStats {
  readonly mean: number;
  readonly std: number;
  readonly black: number;
  /** |mean of the centre box - mean of the four corner boxes|. */
  readonly centreContrast: number;
}

/** Renders one frame and reads the canvas back in the same task (before it is presented). */
function grab(view: EngineView, c: HTMLCanvasElement): FrameStats {
  view.frame(1 / 60);
  const copy = document.createElement('canvas');
  copy.width = W;
  copy.height = H;
  const ctx = copy.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.drawImage(c, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  const lum = (i: number) =>
    (0.2126 * (px[i] ?? 0) + 0.7152 * (px[i + 1] ?? 0) + 0.0722 * (px[i + 2] ?? 0)) / 255;
  let sum = 0;
  let sq = 0;
  let black = 0;
  for (let i = 0; i < px.length; i += 4) {
    const l = lum(i);
    sum += l;
    sq += l * l;
    if (l < 0.01) black++;
  }
  const n = px.length / 4;
  const mean = sum / n;
  const box = (x0: number, y0: number, w: number, h: number) => {
    let s = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) s += lum(4 * (y * W + x));
    return s / (w * h);
  };
  const bw = W / 5;
  const bh = H / 5;
  const corners =
    (box(0, 0, bw, bh) +
      box(W - bw, 0, bw, bh) +
      box(0, H - bh, bw, bh) +
      box(W - bw, H - bh, bw, bh)) /
    4;
  const centre = box(2 * bw, 2 * bh, bw, bh);
  return {
    mean,
    std: Math.sqrt(Math.max(0, sq / n - mean * mean)),
    black: black / n,
    centreContrast: Math.abs(centre - corners),
  };
}

async function settle(view: EngineView, frames: number): Promise<void> {
  for (let i = 0; i < frames; i++) {
    view.frame(1 / 60);
    await nextFrame();
  }
  await view.device.device.queue.onSubmittedWorkDone();
}

function expectPicture(id: string, s: FrameStats): void {
  // a lit studio and an engine, not a black void, a flat fill or a broken composite
  expect(s.mean, `${id} mean luminance`).toBeGreaterThan(0.08);
  expect(s.mean, `${id} mean luminance`).toBeLessThan(0.85);
  expect(s.std, `${id} structure`).toBeGreaterThan(0.04);
  expect(s.black, `${id} black pixels`).toBeLessThan(0.2);
  expect(s.centreContrast, `${id} something in the middle`).toBeGreaterThan(0.015);
}

describe('engine view, main thread', () => {
  const views: EngineView[] = [];
  afterAll(async () => {
    for (const v of views) await v.dispose();
  });

  it('renders every preset as a real picture with zero GPU errors, and times its passes', async () => {
    const c = canvas();
    const view = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
      quality: 'test',
    });
    views.push(view);
    for (const preset of LOOK_PRESET_IDS) {
      view.setPreset(preset);
      await settle(view, 6);
      expectPicture(preset, grab(view, c));
    }
    await settle(view, 4);
    for (let i = 0; i < 8; i++) await nextFrame();
    const s = view.stats();
    expect(s.errors).toEqual([]);
    expect(s.cycleLabel).toBe('MOCK');
    expect(s.triangles).toBeGreaterThan(1e5);
    if (s.timestamps) {
      expect(s.timings.frames).toBeGreaterThan(0);
      expect(s.timings.gpu.opaque).toBeGreaterThan(0);
      expect(s.timings.gpuTotal).toBeGreaterThan(s.timings.gpu.opaque);
    }
  });

  it('culls the hidden internals of the closed engine and draws them again in the cutaway', async () => {
    const view = views[0];
    if (view === undefined) throw new Error('no view');
    view.setPreset('threeQuarterFront');
    await settle(view, 2);
    const closed = view.stats().drawnTriangles;
    view.setPreset('cutaway');
    await settle(view, 2);
    const open = view.stats().drawnTriangles;
    expect(closed).toBeLessThan(0.6 * open);
  });

  it('the shipped high preset renders a real picture with zero GPU errors', async () => {
    const c = canvas();
    const view = await createEngineView({
      gpu: navigator.gpu,
      canvas: c,
      definition: ENGINE_DEFINITION,
      width: W,
      height: H,
      dpr: 1,
      quality: 'high',
    });
    views.push(view);
    for (const preset of ['hero', 'cutaway'] satisfies LookPresetId[]) {
      view.setPreset(preset);
      await settle(view, 6);
      expectPicture(`high ${preset}`, grab(view, c));
    }
    expect(view.stats().errors).toEqual([]);
  });
});

describe('engine view, dedicated worker on an OffscreenCanvas', () => {
  it('renders the same scene module with zero GPU errors and reports its pass timings', async () => {
    const worker = new Worker(new URL('../../src/render/worker.ts', import.meta.url), {
      type: 'module',
    });
    const replies: WorkerReply[] = [];
    const waiters: ((r: WorkerReply) => void)[] = [];
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const w = waiters.shift();
      if (w) w(e.data);
      else replies.push(e.data);
    };
    const next = () =>
      new Promise<WorkerReply>((resolve) => {
        const r = replies.shift();
        if (r) resolve(r);
        else waiters.push(resolve);
      });
    const send = (m: WorkerRequest, transfer: Transferable[] = []) => {
      worker.postMessage(m, transfer);
    };
    try {
      const offscreen = canvas().transferControlToOffscreen();
      send({ type: 'init', canvas: offscreen, width: W, height: H, dpr: 1, quality: 'test' }, [
        offscreen,
      ]);
      // sent before init has finished: queued, not dropped (W1G-N3)
      send({ type: 'preset', id: 'cutaway' });
      send({ type: 'frames', n: 6 });
      send({ type: 'timings' });
      const r = await next();
      if (r.type === 'error' || r.type === 'gpu-error') throw new Error(r.message);
      expect(r.type).toBe('ready');
      const d = await next();
      if (d.type === 'error' || d.type === 'gpu-error') throw new Error(d.message);
      expect(d).toEqual({ type: 'rendered', frames: 6, errors: [] });
      const t = await next();
      expect(t.type).toBe('timings');
    } finally {
      worker.terminate();
    }
  });
});
