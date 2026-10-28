// The official P1 command's page path (`npm run bench:p1`, D4-54): the bench app runs the app's
// GpuFlowSolver on the shipped 130k asset inside the 1080p bench scene at D4-2's budget, and
// returns a valid run with the solver's own per-frame timings. A smoke run of 2 s after a 3 s warm-up, no timing
// claim (the official numbers come from the orchestrator's D0-1 run of the harness).
import { describe, expect, it } from 'vitest';
import { BenchApp } from '../../spikes/scene/benchApp';

describe('the P1 bench, production solver (smoke)', () => {
  it('runs solver-130k in the bench scene: per-frame solver timings, a finite state, no GPU errors', async ({
    annotate,
  }) => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const app = await BenchApp.create(canvas, 1920, 1080);
    try {
      const r = await app.run(
        {
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
        },
        (cb) => {
          requestAnimationFrame(cb);
        },
      );
      expect(r.solver).toBe('production');
      expect(r.cells).toBeGreaterThan(125_000);
      expect(r.gpuErrors).toEqual([]);
      expect(r.stateFinite).toBe(true);
      const run = r.runs[0];
      expect(run?.iterations ?? 0).toBeGreaterThan(0);
      expect(run?.gpuSamples ?? 0).toBeGreaterThan(0);
      const ms = r.aggregate.solverMsPerIt ?? NaN;
      expect(ms).toBeGreaterThan(0);
      expect(r.resampleMsP50 ?? NaN).toBeGreaterThan(0);
      await annotate(
        `[timing] indicative P1 smoke (2 s, not D0-1): ${ms.toFixed(3)} ms/it, ${r.aggregate.itPerSec.toFixed(0)} it/s, ${r.aggregate.fps.toFixed(1)} fps, resample ${r.resampleMsP50?.toFixed(3) ?? '-'} ms, render ${r.renderGpuMsP50?.toFixed(2) ?? '-'} ms`,
      );
    } finally {
      await app.dispose();
      canvas.remove();
    }
  });
});
