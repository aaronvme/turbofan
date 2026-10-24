import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { DAWN_TIMESTAMP_QUANTUM_NS, detectQuantumNs } from '../../src/gpu/timestamps';
import { DAWN_EXACT_TIMESTAMPS, createDawnGpu } from './helpers/dawn';

// Spike (e): Dawn in Node is the solver test bed. This pins that a device comes up on the
// real GPU, runs a kernel, reads back, times with timestamp queries, and that validation
// errors reach our sink instead of disappearing.

const DOUBLE_PLUS_INDEX = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&src)) { return; }
  dst[i] = 2.0 * src[i] + f32(i);
}
`;

async function readBack(device: GPUDevice, buffer: GPUBuffer, size: number): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.destroy();
  return copy;
}

const BUSY_KERNEL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> v: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  var x = f32(gid.x);
  for (var k = 0u; k < 256u; k++) { x = fma(x, 1.0001, 0.5); }
  v[gid.x] = x;
}`;

/** Begin/end timestamps of `runs` separately submitted compute passes, flattened. */
async function timeDispatches(device: GPUDevice, runs: number): Promise<bigint[]> {
  const querySet = device.createQuerySet({ type: 'timestamp', count: 2 * runs });
  const resolve = device.createBuffer({
    size: 16 * runs,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const data = device.createBuffer({ size: 4 * 65536, usage: GPUBufferUsage.STORAGE });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: BUSY_KERNEL }) },
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: data } }],
  });
  for (let r = 0; r < runs; r++) {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass({
      timestampWrites: {
        querySet,
        beginningOfPassWriteIndex: 2 * r,
        endOfPassWriteIndex: 2 * r + 1,
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(1024);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  const encoder = device.createCommandEncoder();
  encoder.resolveQuerySet(querySet, 0, 2 * runs, resolve, 0);
  device.queue.submit([encoder.finish()]);
  const values = [...new BigUint64Array(await readBack(device, resolve, 16 * runs))];
  querySet.destroy();
  resolve.destroy();
  data.destroy();
  return values;
}

describe('Dawn (webgpu@0.6.2) in Node', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await requestSimDevice(createDawnGpu(DAWN_EXACT_TIMESTAMPS), {
      powerPreference: 'high-performance',
      optionalFeatures: ['timestamp-query', 'shader-f16'],
      maxLimits: ['maxComputeWorkgroupStorageSize', 'maxStorageBufferBindingSize'],
      onError: log.sink,
    });
  });

  afterEach(() => {
    log.assertNone('dawn-smoke');
  });

  afterAll(() => {
    sim.destroy();
  });

  it('gets a hardware adapter (not the fallback/software one)', () => {
    expect(sim.adapter.info.isFallbackAdapter).toBe(false);
    expect(sim.info.vendor).not.toBe('');
    // The tile kernel needs more than the 16 KiB default for some tile shapes.
    expect(sim.device.limits.maxComputeWorkgroupStorageSize).toBeGreaterThanOrEqual(16384);
  });

  it('runs a compute kernel and reads the result back exactly', async () => {
    const { device } = sim;
    const n = 1000;
    const input = Float32Array.from({ length: n }, (_, i) => i * 0.5);
    const src = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(src, 0, input);
    const dst = device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: DOUBLE_PLUS_INDEX }) },
    });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src } },
        { binding: 1, resource: { buffer: dst } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(n / 64));
    pass.end();
    device.queue.submit([encoder.finish()]);

    const out = new Float32Array(await readBack(device, dst, input.byteLength));
    // 2 * (0.5 i) + i = 2i, exact in f32 for i < 2^23.
    expect(Array.from(out)).toEqual(Array.from({ length: n }, (_, i) => 2 * i));
    src.destroy();
    dst.destroy();
  });

  it('times dispatches with unquantized timestamp queries when the quantization toggle is off', async () => {
    expect(sim.hasTimestamps).toBe(true);
    const values = await timeDispatches(sim.device, 8);
    for (let r = 0; r < 8; r++) {
      expect((values[2 * r + 1] ?? 0n) > (values[2 * r] ?? 0n)).toBe(true);
    }
    // 16 raw values all landing on multiples of 2^17 ns by chance: probability 2^-272.
    expect(detectQuantumNs(values)).not.toBe(DAWN_TIMESTAMP_QUANTUM_NS);
  });

  it('delivers a validation error to our sink (never swallowed)', async () => {
    const { device } = sim;
    device.createBuffer({ size: 16, usage: 0 });
    await device.queue.onSubmittedWorkDone();
    await new Promise((r) => setTimeout(r, 50));
    expect(log.reports.map((r) => r.kind)).toEqual(['validation']);
    expect(log.reports[0]?.message).toMatch(/usage/i);
    log.clear();
  });
});

describe('Dawn default timestamp quantization', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await requestSimDevice(createDawnGpu(), {
      optionalFeatures: ['timestamp-query'],
      onError: log.sink,
    });
  });

  afterAll(() => {
    sim.destroy();
    log.assertNone('dawn-quantization');
  });

  it('rounds every timestamp down to a multiple of 2^17 ns (131.072 us) by default', async () => {
    const values = await timeDispatches(sim.device, 8);
    for (const v of values) expect(v % DAWN_TIMESTAMP_QUANTUM_NS).toBe(0n);
  });
});
