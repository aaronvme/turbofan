import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { detectQuantumNs } from '../../src/gpu/timestamps';

// Facts about WebGPU in the installed Chrome on this machine, recorded in docs/GPU_FACTS.md.
// This suite's Chrome runs with --enable-unsafe-webgpu (vitest.browser.config.ts); the bench
// harness runs Chrome without flags, and its JSON records the default quantum (65536 ns).

// Enough ALU work per invocation that a pass lasts well over one 65.536 us quantum.
const BUSY = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  var x = f32(g.x);
  for (var i = 0u; i < 2000u; i++) { x = fract(x * 1.0001 + 0.37); }
  out[g.x] = x;
}`;

describe('WebGPU in Chrome on the Arc 140T', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  let adapterInfo: GPUAdapterInfo;

  beforeAll(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    adapterInfo = adapter.info;
    sim = await requestSimDevice(navigator.gpu, {
      requiredFeatures: ['timestamp-query'],
      onError: log.sink,
    });
  });

  afterAll(() => {
    sim.destroy();
  });

  it('adapter.info names the vendor and architecture but not the device or a description', () => {
    expect(adapterInfo.vendor).toBe('intel');
    expect(adapterInfo.architecture).toBe('xe-lpg');
    expect(adapterInfo.device).toBe('');
    expect(adapterInfo.description).toBe('');
  });

  it('with --enable-unsafe-webgpu, timestamps are not quantized to 2^16 ns', async () => {
    const { device } = sim;
    const passes = 16;
    const n = 64 * 256;
    const out = device.createBuffer({ size: 4 * n, usage: GPUBufferUsage.STORAGE });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: BUSY }) },
    });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: out } }],
    });
    const querySet = device.createQuerySet({ type: 'timestamp', count: 2 * passes });
    const resolve = device.createBuffer({
      size: 16 * passes,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    const read = device.createBuffer({
      size: 16 * passes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const enc = device.createCommandEncoder();
    for (let p = 0; p < passes; p++) {
      const pass = enc.beginComputePass({
        timestampWrites: {
          querySet,
          beginningOfPassWriteIndex: 2 * p,
          endOfPassWriteIndex: 2 * p + 1,
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(n / 64);
      pass.end();
    }
    enc.resolveQuerySet(querySet, 0, 2 * passes, resolve, 0);
    enc.copyBufferToBuffer(resolve, 0, read, 0, 16 * passes);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const stamps = [...new BigUint64Array(read.getMappedRange().slice(0))];
    read.unmap();
    for (const b of [out, resolve, read]) b.destroy();
    querySet.destroy();
    log.assertNone('timestamps');

    const quantum = detectQuantumNs(stamps);
    expect(quantum).not.toBeNull();
    expect(quantum).not.toBe(65536n);
    expect((quantum ?? 0n) < 1000n).toBe(true);
  });
});
