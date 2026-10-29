// The official P1 command's page paths (`npm run bench:p1`, D4-54, D4-64): the app's GpuFlowSolver
// on the shipped 130k asset at D4-2's budget, inside the app's own 1080p engine scene (the
// measurement of record, spikes/p1/appScene.ts) and inside the W0 1080p bench scene (beside it).
// Each returns a valid run with the solver's own per-frame timings and the health that
// spikes/lib/p1.ts solverValidity gates (W2I-I2). Smoke runs of 2 s after a 3 s warm-up, no
// timing claim (the official numbers come from the orchestrator's D0-1 run of the harness).
import { describe, expect, it } from 'vitest';
import type { GpuErrorReport } from '../../src/gpu/device';
import { solverValidity } from '../../spikes/lib/p1';
import { createAppView, runInAppScene } from '../../spikes/p1/appScene';
import { BenchApp, type BenchConfig, type ConfigResult } from '../../spikes/scene/benchApp';

const raf = (cb: (t: number) => void) => {
  requestAnimationFrame(cb);
};

const production: BenchConfig = {
  id: 'solver-130k',
  solver: 'production',
  grid: { ni: 0, nj: 0 },
  blocks: { bi: 0, bj: 0 },
  tile: { x: 16, y: 8 },
  iterations: 'adaptive',
  // the harness passes its idle probe's interval; the first frame compiles the scene
  protocol: { warmupMs: 3000, runMs: 2000, runs: 1 },
  displayIntervalMs: 1000 / 60,
  particles: 65536,
};

/** A healthy production run: finite, no GPU error, the solver still running, timed frames. */
function expectHealthy(r: ConfigResult) {
  expect(r.solver).toBe('production');
  expect(r.cells).toBeGreaterThan(125_000);
  expect(r.gpuErrors).toEqual([]);
  expect(r.stateFinite).toBe(true);
  expect(r.nonFiniteResiduals).toBe(0);
  expect(r.solverStatus).toEqual({ status: 'running', error: null });
  expect(solverValidity(r)).toEqual({ valid: true, reasons: [], warnings: [] });
  const run = r.runs[0];
  expect(run?.iterations ?? 0).toBeGreaterThan(0);
  expect(run?.gpuSamples ?? 0).toBeGreaterThan(0);
  expect(r.aggregate.solverMsPerIt ?? NaN).toBeGreaterThan(0);
  expect(r.resampleMsP50 ?? NaN).toBeGreaterThan(0);
  expect(r.renderGpuMsP50 ?? NaN).toBeGreaterThan(0);
}

const line = (r: ConfigResult) =>
  `${r.aggregate.solverMsPerIt?.toFixed(3) ?? '-'} ms/it, ${r.aggregate.itPerSec.toFixed(0)} it/s, ${r.aggregate.fps.toFixed(1)} fps, resample ${r.resampleMsP50?.toFixed(3) ?? '-'} ms, render ${r.renderGpuMsP50?.toFixed(2) ?? '-'} ms`;

describe('the P1 bench, production solver (smoke)', () => {
  it("runs solver-130k in the app's engine scene (the record): timed frames, healthy", async ({
    annotate,
  }) => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const errors: GpuErrorReport[] = [];
    const view = await createAppView(canvas, errors);
    try {
      // the D4-50 limit reaches the view's device (the adapter offers 16, GPU_FACTS M1)
      expect(view.device.device.limits.maxStorageBuffersPerShaderStage).toBeGreaterThanOrEqual(9);
      expect(() => runInAppScene({ view, config: production, errors, raf })).toThrow(
        /scene 'app' only/,
      );
      const r = await runInAppScene({ view, config: { ...production, scene: 'app' }, errors, raf });
      expect(r.scene).toBe('app');
      expect(r.drawingBuffer).toEqual([1920, 1080]);
      expectHealthy(r);
      await annotate(`[timing] indicative P1 smoke, app scene (2 s, not D0-1): ${line(r)}`);
    } finally {
      await view.dispose();
      canvas.remove();
    }
  });

  it('runs solver-130k in the W0 bench scene, and BenchApp refuses any other scene', async ({
    annotate,
  }) => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const app = await BenchApp.create(canvas, 1920, 1080);
    try {
      // W2I-I2 (b): never the bench scene in place of the one asked for
      await expect(app.run({ ...production, scene: 'app' }, raf)).rejects.toThrow(/P1 page/);
      await expect(
        app.run({ ...production, scene: 'engine' as unknown as 'app' }, raf),
      ).rejects.toThrow(/unknown bench scene "engine"/);
      const r = await app.run({ ...production, scene: 'bench' }, raf);
      expect(r.scene).toBe('bench');
      expectHealthy(r);
      await annotate(`[timing] indicative P1 smoke, bench scene (2 s, not D0-1): ${line(r)}`);
    } finally {
      await app.dispose();
      canvas.remove();
    }
  });
});
