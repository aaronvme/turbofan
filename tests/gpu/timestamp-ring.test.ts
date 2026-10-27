import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { TimestampRing } from '../../spikes/gpu/timestampRing';
import { DAWN_EXACT_TIMESTAMPS, createDawnGpu } from './helpers/dawn';

const BUSY = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> v: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  var x = f32(gid.x);
  for (var k = 0u; k < 4096u; k++) { x = fma(x, 1.0001, 0.5); }
  v[gid.x] = x;
}`;

describe('TimestampRing (per-frame pass timing without stalling the queue)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await requestSimDevice(createDawnGpu(DAWN_EXACT_TIMESTAMPS), {
      requiredFeatures: ['timestamp-query'],
      onError: log.sink,
    });
  });

  afterEach(() => {
    log.assertNone('timestamp-ring');
  });

  afterAll(() => {
    sim.destroy();
  });

  it('times two passes per frame, delivers each frame once, and hands back the slot', async () => {
    const { device } = sim;
    const ring = new TimestampRing(device, { slots: 3, pairs: 2 });
    // W0G-N7: the second pass does WORK_RATIO times the first's work, so the order of the two
    // pass times survives an integrated GPU's clock moving between them under CPU load (seen:
    // 0.97 then 0.38 ms at 2x the work)
    const WORK_RATIO = 8;
    const groups = (p: number) => 1024 * (p === 0 ? 1 : WORK_RATIO);
    const data = device.createBuffer({
      size: 4 * 64 * groups(1),
      usage: GPUBufferUsage.STORAGE,
    });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: BUSY }) },
    });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: data } }],
    });
    const delivered: { frame: number; ms: number[] }[] = [];
    let skipped = 0;
    for (let frame = 0; frame < 12; frame++) {
      const slot = ring.acquire();
      if (!slot) {
        skipped++;
        await device.queue.onSubmittedWorkDone();
        continue;
      }
      const encoder = device.createCommandEncoder();
      for (let p = 0; p < 2; p++) {
        const pass = encoder.beginComputePass({ timestampWrites: slot.writes(p) });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(groups(p));
        pass.end();
      }
      slot.resolve(encoder);
      device.queue.submit([encoder.finish()]);
      void slot.read().then((ms) => delivered.push({ frame, ms }));
    }
    await device.queue.onSubmittedWorkDone();
    await new Promise((r) => setTimeout(r, 100));
    expect(delivered.length + skipped).toBe(12);
    expect(delivered.length).toBeGreaterThanOrEqual(3);
    expect(new Set(delivered.map((d) => d.frame)).size).toBe(delivered.length);
    const timed: { first: number; second: number }[] = [];
    for (const d of delivered) {
      expect(d.ms).toHaveLength(2);
      // The first timestamp on a fresh D3D12 device can be stale (measured): frame 0 may be NaN.
      if (d.frame === 0 && d.ms.some(Number.isNaN)) continue;
      const [first = NaN, second = NaN] = d.ms;
      expect(Number.isFinite(first) && first > 0).toBe(true);
      expect(Number.isFinite(second) && second > 0).toBe(true);
      timed.push({ first, second });
    }
    // the ratio over the delivered frames' medians, not frame by frame (W0G-N7)
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
    expect(timed.length).toBeGreaterThanOrEqual(2);
    expect(med(timed.map((t) => t.second))).toBeGreaterThan(med(timed.map((t) => t.first)));
    expect(ring.rawTimestamps().length).toBe(4 * delivered.length);
    ring.destroy();
    data.destroy();
  });
});
