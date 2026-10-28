// The GPU flow solver in the installed Chrome (D3D12, Arc 140T): the FlowSolver contract on the
// shipped 130k asset, stepped frame by frame with the render resample, and zero WebGPU validation
// errors (P3). It prints the indicative cost ("[timing]": GPU timestamps of this run, not D0-1's
// official protocol; other processes may share the GPU).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { loadMeshAsset, parseMeshManifest } from '../../src/flow/mesh/loader';
import { ENGINE_DEFINITION } from '../../src/engine/definition';

const frame = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => {
      r();
    });
  });

describe('GpuFlowSolver in Chrome', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  let solver: GpuFlowSolver;

  beforeAll(async () => {
    sim = await requestSimDevice(navigator.gpu, {
      powerPreference: 'high-performance',
      optionalFeatures: ['timestamp-query'],
      maxLimits: [
        'maxStorageBuffersPerShaderStage',
        'maxComputeWorkgroupStorageSize',
        'maxStorageBufferBindingSize',
        'maxBufferSize',
      ],
      onError: log.sink,
    });
    const manifest = parseMeshManifest(await (await fetch('/mesh/manifest.json')).json());
    const entry = manifest.specs['130k'];
    if (entry === undefined) throw new Error('no 130k mesh');
    const bytes = await (await fetch(`/mesh/${entry.file}`)).arrayBuffer();
    const { asset } = await loadMeshAsset(bytes, entry);
    solver = new GpuFlowSolver();
    await solver.init({ device: sim.device, mesh: asset, definition: ENGINE_DEFINITION });
  }, 120_000);

  afterAll(() => {
    solver.dispose();
    sim.destroy();
  });

  it('steps 300 frames with the resample and no WebGPU errors; prints ms/iteration', async ({
    annotate,
  }) => {
    const msIt: number[] = [];
    const resample: number[] = [];
    let iterations = 0;
    for (let f = 0; f < 300; f++) {
      iterations += solver.step({ gpuTimeBudgetMs: 5, maxIterations: 100 }).iterationsThisStep;
      await frame();
      if (f >= 100) {
        const m = solver.msPerIteration;
        const r = solver.resampleGpuMs;
        if (m !== null) msIt.push(m);
        if (r !== null) resample.push(r);
      }
    }
    await sim.device.queue.onSubmittedWorkDone();
    expect(log.reports, JSON.stringify(log.reports)).toEqual([]);
    expect(solver.status().status).toBe('running');
    expect(iterations).toBeGreaterThan(300);
    if (sim.hasTimestamps) {
      const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? NaN;
      const ms = median(msIt);
      const rs = median(resample);
      await annotate(
        `[timing] indicative Chrome ms/iteration at 130k: ${ms.toFixed(3)} (median of ${msIt.length} frames; ${iterations} iterations in 300 frames); resample ${rs.toFixed(3)} ms per frame`,
      );
      expect(ms).toBeGreaterThan(0);
    }
    // back to back (no frame pacing, so the GPU clock does not idle down, D4-24): wall clock of
    // 100 steps (iterations + the resample each), then the timestamps' ms/iteration
    await sim.device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    let its = 0;
    for (let k = 0; k < 100; k++) {
      its += solver.step({ gpuTimeBudgetMs: 5, maxIterations: 100 }).iterationsThisStep;
    }
    await sim.device.queue.onSubmittedWorkDone();
    const wall = performance.now() - t0;
    for (let k = 0; k < 20; k++) {
      solver.step({ gpuTimeBudgetMs: 5, maxIterations: 100 });
      await sim.device.queue.onSubmittedWorkDone();
    }
    await annotate(
      `[timing] back to back: ${(wall / its).toFixed(3)} ms wall per iteration incl. the resample (${its} iterations in 100 steps, ${wall.toFixed(1)} ms); timestamps ${solver.msPerIteration?.toFixed(3) ?? 'n/a'} ms/iteration, resample ${solver.resampleGpuMs?.toFixed(3) ?? 'n/a'} ms`,
    );
    expect(log.reports).toEqual([]);
  });
});
