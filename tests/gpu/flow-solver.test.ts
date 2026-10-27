// The FlowSolver contract on the GPU kernel (src/flow/gpu/device/flowSolver.ts), on Dawn with the
// shipped 130k asset: init, step(budget), the four rgba16float render textures (D0-4: gauge
// ratios, exact ambient outside the fluid), the snapshot status (W1F-I1) and provenance (W1F-N1),
// zero validation errors (P3).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fromHalfBits } from '../../src/contracts/half';
import { FIELD_EXTENTS, type FieldTexturePair } from '../../src/contracts/flow';
import { nextSnapshot } from '../../src/contracts/sim';
import type { SimDevice } from '../../src/gpu/device';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { snapshotSources } from '../../src/flow/gpu/status';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { createMockCycle } from '../../src/mocks/mockCycle';
import { GpuErrorLog, shippedAsset, solverDevice } from './helpers/solver';
import { sampleSnapshotParts } from '../unit/contracts/fixtures/snapshotFixture';

async function readTexture(device: GPUDevice, tex: GPUTexture): Promise<Float32Array> {
  const bytesPerRow = 8 * tex.width;
  const buf = device.createBuffer({
    size: bytesPerRow * tex.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [tex.width, tex.height]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const bits = new Uint16Array(buf.getMappedRange().slice(0));
  buf.destroy();
  return Float32Array.from(bits, fromHalfBits);
}

const flush = async (device: GPUDevice) => {
  await device.queue.onSubmittedWorkDone();
  for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 5));
};

describe('GpuFlowSolver (the FlowSolver contract)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  let solver: GpuFlowSolver;

  beforeAll(async () => {
    sim = await solverDevice(log);
    solver = new GpuFlowSolver();
    const { asset } = await shippedAsset();
    expect(solver.status().status).toBe('initialising');
    await solver.init({ device: sim.device, mesh: asset, definition: ENGINE_DEFINITION });
  }, 300_000);

  afterEach(() => {
    log.assertNone('flow-solver');
  });

  afterAll(() => {
    solver.dispose();
    sim.destroy();
  });

  it('runs the scheduler floor first, then fits the budget from timestamps', async () => {
    const first = solver.step({ gpuTimeBudgetMs: 5, maxIterations: 100 });
    expect(first.iterationsThisStep).toBe(2);
    for (let k = 0; k < 6; k++) {
      solver.step({ gpuTimeBudgetMs: 5, maxIterations: 100 });
      await flush(sim.device);
    }
    const s = solver.step({ gpuTimeBudgetMs: 5, maxIterations: 100 });
    if (sim.hasTimestamps) {
      expect(solver.msPerIteration).not.toBeNull();
      const ms = solver.msPerIteration ?? NaN;
      expect(s.iterationsThisStep).toBe(
        Math.min(Math.max(2, Math.floor(5 / ms)), Math.max(1, Math.floor(7 / ms))),
      );
      process.stdout.write(
        `[timing] indicative Dawn ms/iteration at 130k: ${ms.toFixed(3)}; resample ${solver.resampleGpuMs?.toFixed(3)} ms\n`,
      );
    }
    await flush(sim.device);
    const status = solver.status();
    expect(status.status).toBe('running');
    expect(status.stats?.residualDensityL2).toBe(0); // the quiescent ambient: exactly zero
    expect(solver.step({ gpuTimeBudgetMs: 5, maxIterations: 0 }).iterationsThisStep).toBe(0);
  });

  it('hands out the same textures for its lifetime and labels them as the solver (W1F-N1)', async () => {
    const f = solver.fields();
    const v = f.version;
    solver.step({ gpuTimeBudgetMs: 5, maxIterations: 3 });
    const g = solver.fields();
    expect(g.near.state).toBe(f.near.state);
    expect(g.far.velocity).toBe(f.far.velocity);
    expect(g.version).toBe(v + 1);
    expect(g.source).toBe('solver');
    // the snapshot's provenance is copied from the field and the cycle model, not declared
    const sources = snapshotSources(createMockCycle(ENGINE_DEFINITION), g);
    expect(sources).toEqual({ cycle: 'mock', flow: 'solver' });
    expect(snapshotSources({ source: 'model' }, null)).toEqual({ cycle: 'model', flow: 'none' });
    for (const tex of [g.near.state, g.near.velocity, g.far.state, g.far.velocity]) {
      expect(tex.format).toBe('rgba16float');
    }
    await flush(sim.device);
  });

  it('writes the exact ambient: gauge ratios 0 everywhere, fluid fraction 1 in the open far field', async () => {
    for (const id of ['near', 'far'] as const) {
      const pair: FieldTexturePair = solver.fields()[id];
      const e = FIELD_EXTENTS[id];
      const st = await readTexture(sim.device, pair.state);
      const vel = await readTexture(sim.device, pair.velocity);
      let fluid = 0;
      let solid = 0;
      for (let t = 0; t < e.width * e.height; t++) {
        expect(st[4 * t]).toBe(0);
        expect(st[4 * t + 1]).toBe(0);
        expect(st[4 * t + 3]).toBe(0);
        expect(Math.abs((st[4 * t + 2] ?? NaN) - 288.15)).toBeLessThanOrEqual(0.25);
        expect([vel[4 * t], vel[4 * t + 1], vel[4 * t + 2]]).toEqual([0, 0, 0]);
        const ff = vel[4 * t + 3] ?? NaN;
        expect(ff).toBeGreaterThanOrEqual(0);
        expect(ff).toBeLessThanOrEqual(1);
        if (ff === 1) fluid++;
        if (ff === 0) solid++;
      }
      expect(fluid, id).toBeGreaterThan(0.5 * e.width * e.height);
      if (id === 'near') expect(solid).toBeGreaterThan(0); // the engine's casings
      // the top row of the far extent is open air
      const top = e.height - 1;
      expect(vel[4 * (top * e.width + 10) + 3]).toBe(1);
    }
  });

  it('W1F-I1: a lost device with an empty message reports lost and the snapshot still publishes', async () => {
    const other = await solverDevice(new GpuErrorLog());
    const s2 = new GpuFlowSolver({ lowMachPreconditioning: null });
    const { asset } = await shippedAsset();
    await s2.init({ device: other.device, mesh: asset, definition: ENGINE_DEFINITION });
    s2.step({ gpuTimeBudgetMs: 5, maxIterations: 2 });
    // what a lost device with an empty message looks like (the spec allows an empty message)
    s2.reportGpuError('');
    const status = s2.status();
    expect(status.status).toBe('lost');
    expect(status.error?.length).toBeGreaterThan(0);
    const snap = nextSnapshot(null, { ...sampleSnapshotParts(), flow: status });
    expect(snap.flow.status).toBe('lost');
    // a lost solver queues nothing more
    expect(s2.step({ gpuTimeBudgetMs: 5, maxIterations: 5 }).iterationsThisStep).toBe(0);
    s2.dispose();
    other.destroy();
  });
});
