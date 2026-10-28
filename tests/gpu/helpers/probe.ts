// Runs one probe entry point of src/flow/gpu/wgsl/kernels.ts probeKernelWgsl: `PROBE_STRIDE` vec4 in
// and as many out per record, with the uniform block of a solver's first tracking stage.
import { buildLayout } from '../../../src/flow/gpu/layout';
import {
  PARAMS_BYTES,
  packParams,
  stageParams,
  type GpuSchemeOptions,
} from '../../../src/flow/gpu/params';
import { compileWgsl } from '../../../src/flow/gpu/device/gpuSolver';
import { PROBE_STRIDE, probeKernelWgsl, type ProbeEntry } from '../../../src/flow/gpu/wgsl/kernels';
import type { SolverMesh } from '../../../src/flow/reference/solverMesh';

export async function runProbe(
  device: GPUDevice,
  mesh: SolverMesh,
  opts: GpuSchemeOptions,
  entryPoint: ProbeEntry,
  input: Float32Array,
  overrides: Partial<Record<'machCut', number>> = {},
): Promise<Float32Array> {
  const layout = buildLayout(mesh);
  const params = stageParams(opts, {
    nCells: layout.nCells,
    nGhosts: layout.nGhosts,
    nWorkgroups: layout.workgroups,
  });
  const module = await compileWgsl(device, probeKernelWgsl({ gas: opts.gas, layout }), 'probe');
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint },
  });
  const first = params.tracking[0];
  if (first === undefined) throw new Error('no params');
  const uni = device.createBuffer({
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uni, 0, packParams({ ...first, ...overrides }));
  const src = device.createBuffer({
    size: input.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(src, 0, input);
  const out = device.createBuffer({
    size: input.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const staging = device.createBuffer({
    size: input.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uni } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: out } },
      ],
    }),
  );
  const stride = 4 * PROBE_STRIDE[entryPoint];
  if (input.length % stride !== 0)
    throw new Error(`${entryPoint} takes ${stride} floats per record`);
  pass.dispatchWorkgroups(Math.ceil(input.length / stride / 64));
  pass.end();
  encoder.copyBufferToBuffer(out, 0, staging, 0, input.byteLength);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(staging.getMappedRange().slice(0));
  for (const b of [uni, src, out, staging]) b.destroy();
  return result;
}
