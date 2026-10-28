// The FlowSolver contract on the GPU kernel (src/flow/gpu/device/flowSolver.ts), on Dawn with the
// shipped 130k asset: init, step(budget), the four rgba16float render textures (D0-4: gauge
// ratios, exact ambient outside the fluid), the snapshot status (W1F-I1) and provenance (W1F-N1),
// zero validation errors (P3).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fromHalfBits } from '../../src/contracts/half';
import { FIELD_EXTENTS, type FieldTexturePair, type FlowSolver } from '../../src/contracts/flow';
import { nextSnapshot } from '../../src/contracts/sim';
import type { SimDevice } from '../../src/gpu/device';
import { GpuFlowSolver } from '../../src/flow/gpu/device/flowSolver';
import { NO_CELL, buildResampleMap } from '../../src/flow/gpu/resampleMap';
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
      // the resample is counted in the budget and the ceiling (W2S-A-I4, W2S-B-I3)
      const r = solver.resampleAverageMs ?? NaN;
      expect(r).toBeGreaterThan(0);
      expect(s.iterationsThisStep).toBe(
        Math.min(Math.max(2, Math.floor((5 - r) / ms)), Math.max(1, Math.floor((7 - r) / ms))),
      );
      // the frame's GPU time is the iterations' and the resample's
      expect(s.gpuTimeMs ?? NaN).toBeGreaterThan(solver.resampleGpuMs ?? NaN);
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

  // W2S-A-I1: the resample's values, not only its exact ambient. A smooth non-ambient state with
  // swirl and fuel, on a free stream moving at 40 m/s, resampled with 0 iterations; every texel
  // against the host map (resampleMap.ts) applied to the kernel's primitives in f64, to f16.
  it('resamples a non-ambient state: each channel against the map applied to the primitives', async () => {
    const other = await solverDevice(new GpuErrorLog());
    const U_INF = 40;
    const s2 = new GpuFlowSolver({ lowMachPreconditioning: null, freeStreamVelocity: U_INF });
    const { asset, file } = await shippedAsset();
    await s2.init({ device: other.device, mesh: asset, definition: ENGINE_DEFINITION });
    const k = s2.kernel;
    if (k === null) throw new Error('no kernel');
    const ref = k.ref;
    k.setState((x, r) => {
      const g = Math.exp(-((x - 0.5) ** 2 + (r - 0.6) ** 2) / 0.5);
      return {
        rho: ref.rho * (1 + 0.1 * g),
        u: U_INF + 30 * g,
        v: -12 * g,
        w: 50 * g,
        p: ref.p * (1 + 0.15 * g),
        z: 0.04 * g,
      };
    });
    s2.step({ gpuTimeBudgetMs: 5, maxIterations: 0 });
    const P = await k.readPrimitives();
    const mesh = k.mesh;
    let checked = 0;
    for (const id of ['near', 'far'] as const) {
      const e = FIELD_EXTENTS[id];
      const map = buildResampleMap(file, mesh, e);
      const pair = s2.fields()[id];
      const st = await readTexture(other.device, pair.state);
      const vel = await readTexture(other.device, pair.velocity);
      // per channel: f16 keeps 11 bits (4.9e-4 relative); an absolute floor at each scale
      const floor = [1e-4, 1e-4, 0, 1e-5, 1e-3, 1e-3, 1e-3, 0];
      for (let t = 0; t < e.width * e.height; t++) {
        const want = new Float64Array(8);
        const c0 = map.cells[4 * t] ?? NO_CELL;
        if (c0 === NO_CELL) {
          want.set([0, 0, ref.t, 0, U_INF, 0, 0, map.weights[4 * t + 3] ?? NaN]);
        } else {
          const w3 = 1 - (map.weights[4 * t] ?? 0) - (map.weights[4 * t + 1] ?? 0);
          const ws = [map.weights[4 * t], map.weights[4 * t + 1], map.weights[4 * t + 2]];
          ws.push(w3 - (map.weights[4 * t + 2] ?? 0));
          for (let q = 0; q < 4; q++) {
            const c = map.cells[4 * t + q] ?? NO_CELL;
            const w = ws[q] ?? 0;
            if (w === 0 || c === NO_CELL) continue;
            const o = 8 * c;
            want[0] = (want[0] ?? 0) + (w * (P[o + 4] ?? NaN)) / ref.p;
            want[1] = (want[1] ?? 0) + (w * (P[o] ?? NaN)) / ref.rho;
            want[2] = (want[2] ?? 0) + w * (P[o + 6] ?? NaN);
            want[3] = (want[3] ?? 0) + w * (P[o + 5] ?? NaN);
            want[4] = (want[4] ?? 0) + w * ((P[o + 1] ?? NaN) - k.uInfF32);
            want[5] = (want[5] ?? 0) + w * (P[o + 2] ?? NaN);
            want[6] = (want[6] ?? 0) + (w * (P[o + 3] ?? NaN)) / (mesh.cellR[c] ?? NaN);
          }
          want[2] = ref.t + (want[2] ?? 0);
          want[4] = k.uInfF32 + (want[4] ?? 0);
          want[7] = map.weights[4 * t + 3] ?? NaN;
          checked++;
        }
        const got = [...st.subarray(4 * t, 4 * t + 4), ...vel.subarray(4 * t, 4 * t + 4)];
        for (let ch = 0; ch < 8; ch++) {
          const wv = want[ch] ?? NaN;
          const tol = 1e-3 * Math.abs(wv) + (floor[ch] ?? 0);
          if (!(Math.abs((got[ch] ?? NaN) - wv) <= tol)) {
            throw new Error(`${id} texel ${t} channel ${ch}: ${got[ch]} against ${wv}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
    s2.dispose();
    other.destroy();
  });

  it('a really lost device (destroyed under the solver) reports lost; fields() after dispose says so', async () => {
    const other = await solverDevice(new GpuErrorLog());
    const s3 = new GpuFlowSolver({ lowMachPreconditioning: null });
    const { asset } = await shippedAsset();
    await s3.init({ device: other.device, mesh: asset, definition: ENGINE_DEFINITION });
    s3.step({ gpuTimeBudgetMs: 5, maxIterations: 2 });
    other.device.destroy(); // not through dispose(): the device.lost path (W2S-A-N6, W2S-B-N3)
    await other.device.lost;
    await new Promise((r) => setTimeout(r, 5));
    const status = s3.status();
    expect(status.status).toBe('lost');
    expect(status.error?.length).toBeGreaterThan(0);
    expect(s3.step({ gpuTimeBudgetMs: 5, maxIterations: 2 }).iterationsThisStep).toBe(0);
    expect(nextSnapshot(null, { ...sampleSnapshotParts(), flow: status }).flow.status).toBe('lost');
    s3.dispose();
    expect(() => s3.fields()).toThrow(/after dispose/);
  });

  it('W1F-I1: a lost device with an empty message reports lost and the snapshot still publishes', async () => {
    const other = await solverDevice(new GpuErrorLog());
    const s2 = new GpuFlowSolver({ lowMachPreconditioning: null });
    const { asset } = await shippedAsset();
    await s2.init({ device: other.device, mesh: asset, definition: ENGINE_DEFINITION });
    s2.step({ gpuTimeBudgetMs: 5, maxIterations: 2 });
    // what a lost device with an empty message looks like (the spec allows an empty message),
    // through the contract (W2S-A-I10: the app holds a FlowSolver, not the class)
    const contract: FlowSolver = s2;
    contract.reportGpuError('');
    const status = contract.status();
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
