// Runs the spike (a) stage kernel with raw WebGPU on a device we own. The same code runs in
// Node (Dawn, tests/gpu) and in Chrome (the throughput and worker benchmarks).
//
// Three state copies C0, C1, C2, each two vec4 buffers (A, B). An iteration with U^n in copy N
// and free copies X, Y:
//   stage 1: in = N, base = N -> X      (reads alias read-only bindings, which is allowed)
//   stage 2: in = X, base = N -> Y
//   stage 3: in = Y, base = N -> X      => U^{n+1} is in X
// so U^n alternates between C0 and C1 and C2 is always the middle stage. 2 parities x 3 stages
// = 6 bind groups, built once.

import { GAS_R } from '../lib/gas';
import type { Freestream } from '../lib/gas';
import type { GaugeContext } from '../lib/initial';
import { RK3_ALPHA, fluxProbeWgsl, packParams, stageKernelWgsl, PARAMS_BYTES } from '../lib/kernel';
import { buildGeometry, buildTopology, type Layout, type Nodes, type Tile } from '../lib/mesh';
import type { FluxPrim } from '../lib/slau2';

const UNIFORM_STRIDE = 256; // minUniformBufferOffsetAlignment

export interface SolverSetup {
  readonly device: GPUDevice;
  readonly nodes: Nodes;
  readonly layout: Layout;
  readonly ghosts: Uint32Array;
  readonly tile: Tile;
  readonly inf: Freestream;
  readonly ctx: GaugeContext;
  readonly cfl: number;
  readonly initial: { readonly a: Float32Array; readonly b: Float32Array };
  readonly label?: string;
}

async function compile(device: GPUDevice, code: string, label: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    const lines = errors.map((m) => `${label}:${m.lineNum}:${m.linePos} ${m.message}`);
    throw new Error(`WGSL compilation failed:\n${lines.join('\n')}`);
  }
  return module;
}

function storageBuffer(device: GPUDevice, data: ArrayBufferView, label: string): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.max(16, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
  return buffer;
}

export class StageSolver {
  readonly workgroups: number;
  readonly cells: number;
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroups: GPUBindGroup[][];
  private readonly copies: { a: GPUBuffer; b: GPUBuffer }[];
  private readonly owned: GPUBuffer[];
  private parity = 0;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroups: GPUBindGroup[][],
    copies: { a: GPUBuffer; b: GPUBuffer }[],
    owned: GPUBuffer[],
    workgroups: number,
    cells: number,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroups = bindGroups;
    this.copies = copies;
    this.owned = owned;
    this.workgroups = workgroups;
    this.cells = cells;
  }

  static async create(s: SolverSetup): Promise<StageSolver> {
    const { device, layout } = s;
    const label = s.label ?? `stage ${s.tile.x}x${s.tile.y}`;
    const module = await compile(device, stageKernelWgsl(s.tile), label);
    const topo = buildTopology(layout, s.ghosts, s.tile);

    const storage = (readOnly: boolean): GPUBindGroupLayoutEntry['buffer'] => ({
      type: readOnly ? 'read-only-storage' : 'storage',
    });
    const bgl = device.createBindGroupLayout({
      label,
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ...[1, 2, 3, 4].map((binding) => ({
          binding,
          visibility: GPUShaderStage.COMPUTE,
          buffer: storage(true),
        })),
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: storage(false) },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: storage(false) },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: storage(true) },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: storage(true) },
      ],
    });
    const pipeline = await device.createComputePipelineAsync({
      label,
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module, entryPoint: 'main' },
    });

    const copies = [0, 1, 2].map((k) => ({
      a: storageBuffer(device, s.initial.a, `${label} U${k}.A`),
      b: storageBuffer(device, s.initial.b, `${label} U${k}.B`),
    }));
    const geo = storageBuffer(device, buildGeometry(s.nodes, layout), `${label} geometry`);
    const topology = storageBuffer(device, topo.data, `${label} topology`);

    const params = device.createBuffer({
      label: `${label} params`,
      size: 3 * UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    RK3_ALPHA.forEach((alpha, stage) => {
      device.queue.writeBuffer(
        params,
        stage * UNIFORM_STRIDE,
        packParams({
          rhoInf: s.inf.rho,
          pInf: s.inf.p,
          uInf: s.inf.u,
          vInf: 0,
          h0Inf: s.inf.h0,
          gasR: GAS_R,
          cfl: s.cfl,
          alpha,
          tInf: s.inf.T,
          zMix: s.ctx.zMix,
          gammaInf: s.inf.gamma,
          cInf: s.inf.c,
          eInf: s.inf.e,
          cvInf: s.inf.cv,
          stage,
          wgBase: topo.wgBase,
          ghostBase: topo.ghostBase,
        }),
      );
    });

    const group = (stage: number, input: number, base: number, out: number): GPUBindGroup => {
      const [ci, cb, co] = [copies[input], copies[base], copies[out]];
      if (!ci || !cb || !co) throw new Error('bad copy index');
      return device.createBindGroup({
        label: `${label} stage ${stage + 1} ${input}/${base}->${out}`,
        layout: bgl,
        entries: [
          {
            binding: 0,
            resource: { buffer: params, offset: stage * UNIFORM_STRIDE, size: PARAMS_BYTES },
          },
          { binding: 1, resource: { buffer: ci.a } },
          { binding: 2, resource: { buffer: ci.b } },
          { binding: 3, resource: { buffer: cb.a } },
          { binding: 4, resource: { buffer: cb.b } },
          { binding: 5, resource: { buffer: co.a } },
          { binding: 6, resource: { buffer: co.b } },
          { binding: 7, resource: { buffer: geo } },
          { binding: 8, resource: { buffer: topology } },
        ],
      });
    };
    // parity 0: U^n in C0 (X = C1, Y = C2); parity 1: U^n in C1 (X = C0, Y = C2).
    const bindGroups = [
      [group(0, 0, 0, 1), group(1, 1, 0, 2), group(2, 2, 0, 1)],
      [group(0, 1, 1, 0), group(1, 0, 1, 2), group(2, 2, 1, 0)],
    ];
    const owned = [...copies.flatMap((c) => [c.a, c.b]), geo, topology, params];
    return new StageSolver(
      device,
      pipeline,
      bindGroups,
      copies,
      owned,
      topo.workgroups,
      layout.nCells,
    );
  }

  /** Records `iterations` x 3 stage dispatches into an open compute pass. */
  encode(pass: GPUComputePassEncoder, iterations: number): void {
    pass.setPipeline(this.pipeline);
    for (let it = 0; it < iterations; it++) {
      const groups = this.bindGroups[this.parity];
      if (!groups) throw new Error('bad parity');
      for (const g of groups) {
        pass.setBindGroup(0, g);
        pass.dispatchWorkgroups(this.workgroups);
      }
      this.parity ^= 1;
    }
  }

  /** The buffers holding U^n after everything encoded so far. */
  current(): { a: GPUBuffer; b: GPUBuffer } {
    const c = this.copies[this.parity];
    if (!c) throw new Error('bad parity');
    return c;
  }

  async readState(): Promise<{ a: Float32Array; b: Float32Array }> {
    const { a, b } = this.current();
    const size = a.size;
    const staging = this.device.createBuffer({
      size: 2 * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(a, 0, staging, 0, size);
    encoder.copyBufferToBuffer(b, 0, staging, size, size);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const all = new Float32Array(staging.getMappedRange().slice(0));
    staging.destroy();
    const n = 4 * this.cells;
    return { a: all.slice(0, n), b: all.slice(size / 4, size / 4 + n) };
  }

  destroy(): void {
    for (const b of this.owned) b.destroy();
  }
}

export interface ProbeFace {
  readonly L: FluxPrim;
  readonly R: FluxPrim;
  readonly S: readonly [number, number];
  readonly rf: number;
}

/** Runs the stage kernel's SLAU2 on a list of faces (tests/gpu). */
export async function runFluxProbe(
  device: GPUDevice,
  inf: Freestream,
  ctx: GaugeContext,
  faces: readonly ProbeFace[],
): Promise<number[][]> {
  const module = await compile(device, fluxProbeWgsl(), 'flux probe');
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const input = new Float32Array(16 * faces.length);
  faces.forEach((f, k) => {
    input.set([f.L.rho, f.L.u, f.L.v, f.L.rw, f.L.pp, f.L.z, f.S[0], f.S[1]], 16 * k);
    input.set([f.R.rho, f.R.u, f.R.v, f.R.rw, f.R.pp, f.R.z, f.rf, 0], 16 * k + 8);
  });
  const params = device.createBuffer({
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    params,
    0,
    packParams({
      rhoInf: inf.rho,
      pInf: inf.p,
      uInf: inf.u,
      vInf: 0,
      h0Inf: inf.h0,
      gasR: GAS_R,
      cfl: 1,
      alpha: 1,
      tInf: inf.T,
      zMix: ctx.zMix,
      gammaInf: inf.gamma,
      cInf: inf.c,
      eInf: inf.e,
      cvInf: inf.cv,
      stage: 0,
      wgBase: 0,
      ghostBase: 0,
    }),
  );
  const src = storageBuffer(device, input, 'probe faces');
  const out = device.createBuffer({
    size: 32 * faces.length,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const staging = device.createBuffer({
    size: 32 * faces.length,
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
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: out } },
      ],
    }),
  );
  pass.dispatchWorkgroups(Math.ceil(faces.length / 64));
  pass.end();
  encoder.copyBufferToBuffer(out, 0, staging, 0, 32 * faces.length);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const f = new Float32Array(staging.getMappedRange().slice(0));
  for (const b of [params, src, out, staging]) b.destroy();
  return faces.map((_, k) => [...f.subarray(8 * k, 8 * k + 6)]);
}
