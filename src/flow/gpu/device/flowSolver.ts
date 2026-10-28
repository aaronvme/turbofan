// The FlowSolver contract (src/contracts/flow.ts) on the GPU kernel: init from the mesh asset,
// step(budget) with adaptive iterations from timestamp queries (D4-2, scheduler.ts), the render
// resample into the four rgba16float textures (D0-4), the async residual readback, and the
// FlowStatus of the snapshot (status.ts: W1F-I1). Station reductions and the body forces that use
// FlowTargets are W3's (latestReduction() is null until then).
import { ISA_SLS } from '../../../contracts/ambient';
import {
  FIELD_EXTENTS,
  FIELD_TEXTURE_FORMAT,
  fieldExtentDomainProblems,
  type FieldExtentId,
  type FieldTexturePair,
  type FlowField,
  type FlowSolver,
  type FlowSolverInit,
  type FlowStepStats,
  type FlowTargets,
  type SolverMode,
  type StationReduction,
  type StepBudget,
} from '../../../contracts/flow';
import type { FlowStatus } from '../../../contracts/sim';
import { decodeMeshFile } from '../../mesh/meshFile';
import { THERMALLY_PERFECT, type GasModel } from '../../reference/gas';
import { solverMeshFromFile } from '../../reference/solverMesh';
import type { Tile } from '../layout';
import { PARAMS_BYTES } from '../params';
import { buildResampleMap } from '../resampleMap';
import { IterationScheduler } from '../scheduler';
import { solverFlowStatus } from '../status';
import { residualFromPartials, resampleKernelWgsl, timeFromReduction } from '../wgsl/kernels';
import { GpuSolver, compileWgsl } from './gpuSolver';
import { TimestampRing, type RingSlot } from './timestampRing';

export interface GpuFlowSolverOptions {
  readonly tile?: Tile;
  readonly gas?: GasModel;
  /**
   * Tracking mode's low-Mach preconditioning. Default: the engine's minMach = M_cut = 0.003
   * (SOLVER.md 7) at DEFAULT_CFL_PRECONDITIONED; null: the plain scheme. Not final (D4-30, D4-32).
   */
  readonly lowMachPreconditioning?: { readonly minMach: number; readonly machCut?: number } | null;
  readonly cfl?: number;
}

const READBACK_SLOTS = 3;

export class GpuFlowSolver implements FlowSolver {
  mode: SolverMode = 'tracking';
  private readonly opts: GpuFlowSolverOptions;
  private device: GPUDevice | null = null;
  private solver: GpuSolver | null = null;
  private field: FlowField | null = null;
  private textures: GPUTexture[] = [];
  private resample: {
    pipeline: GPUComputePipeline;
    groups: GPUBindGroup[];
    sizes: [number, number][];
  } | null = null;
  private maps: GPUBuffer[] = [];
  private timestamps: TimestampRing | null = null;
  private readbacks: { buffer: GPUBuffer; busy: boolean }[] = [];
  private readonly scheduler = new IterationScheduler();
  private initialised = false;
  private initError: string | null = null;
  private lost: { message: string } | null = null;
  private disposed = false;
  private totalIterations = 0;
  private lastIterations = 0;
  private gpuTimeMs: number | null = null;
  private resampleMs: number | null = null;
  private residual: number | null = null;
  private physicalTimeS = 0;
  private version = 0;
  targets: FlowTargets | null = null;

  constructor(opts: GpuFlowSolverOptions = {}) {
    this.opts = opts;
  }

  async init(params: FlowSolverInit): Promise<void> {
    try {
      await this.build(params);
      this.initialised = true;
    } catch (e) {
      this.initError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  private async build({ device, mesh }: FlowSolverInit): Promise<void> {
    this.device = device;
    void device.lost.then((info) => {
      if (!this.disposed) this.lost = { message: info.message };
    });
    for (const e of Object.values(FIELD_EXTENTS)) {
      const problems = fieldExtentDomainProblems(e, mesh.domain);
      if (problems.length > 0) throw new Error(`mesh domain: ${problems.join('; ')}`);
    }
    const file = decodeMeshFile(new Uint8Array(mesh.bytes));
    const solverMesh = solverMeshFromFile(file);
    const pre =
      this.opts.lowMachPreconditioning === undefined
        ? { minMach: 0.003 }
        : this.opts.lowMachPreconditioning;
    const solver = await GpuSolver.create(device, solverMesh, {
      gas: this.opts.gas ?? THERMALLY_PERFECT,
      freeStream: { pressure: ISA_SLS.pressurePa, temperature: ISA_SLS.temperatureK, velocity: 0 },
      ...(pre === null ? {} : { lowMachPreconditioning: pre }),
      ...(this.opts.cfl === undefined ? {} : { cfl: this.opts.cfl }),
      ...(this.opts.tile === undefined ? {} : { tile: this.opts.tile }),
      label: 'flow solver',
    });
    this.solver = solver;

    const module = await compileWgsl(
      device,
      resampleKernelWgsl({ gas: this.opts.gas ?? THERMALLY_PERFECT, layout: solver.layout }),
      'flow resample',
    );
    const pipeline = await device.createComputePipelineAsync({
      label: 'flow resample',
      layout: 'auto',
      compute: { module, entryPoint: 'resampleMain' },
    });
    const pairs: Partial<Record<FieldExtentId, FieldTexturePair>> = {};
    const groups: GPUBindGroup[] = [];
    const sizes: [number, number][] = [];
    for (const id of ['near', 'far'] as const) {
      const e = FIELD_EXTENTS[id];
      const map = buildResampleMap(file, solverMesh, e);
      const packed = new Uint32Array(8 * e.width * e.height);
      const wbits = new Uint32Array(map.weights.buffer, map.weights.byteOffset, map.weights.length);
      for (let t = 0; t < e.width * e.height; t++) {
        packed.set(map.cells.subarray(4 * t, 4 * t + 4), 8 * t);
        packed.set(wbits.subarray(4 * t, 4 * t + 4), 8 * t + 4);
      }
      const buf = device.createBuffer({
        label: `resample map ${id}`,
        size: packed.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buf, 0, packed);
      this.maps.push(buf);
      const tex = (kind: string) =>
        device.createTexture({
          label: `flow ${id} ${kind}`,
          size: [e.width, e.height],
          format: FIELD_TEXTURE_FORMAT,
          usage:
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC,
        });
      const pair = { state: tex('state'), velocity: tex('velocity') };
      this.textures.push(pair.state, pair.velocity);
      pairs[id] = pair;
      groups.push(
        device.createBindGroup({
          label: `flow resample ${id}`,
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: { buffer: solver.uniformBuffer, offset: 0, size: PARAMS_BYTES },
            },
            { binding: 1, resource: { buffer: solver.primitives } },
            { binding: 2, resource: { buffer: solver.geometry } },
            { binding: 3, resource: { buffer: buf } },
            { binding: 4, resource: pair.state.createView() },
            { binding: 5, resource: pair.velocity.createView() },
          ],
        }),
      );
      sizes.push([e.width, e.height]);
    }
    this.resample = { pipeline, groups, sizes };
    const near = pairs.near;
    const far = pairs.far;
    if (near === undefined || far === undefined) throw new Error('resample textures missing');
    this.field = {
      source: 'solver',
      reference: { pInfPa: solver.ref.p, rhoInfKgPerM3: solver.ref.rho, tInfK: solver.ref.t },
      extents: FIELD_EXTENTS,
      near,
      far,
      version: 0,
    };
    if (device.features.has('timestamp-query')) {
      this.timestamps = new TimestampRing(device, { slots: 4, pairs: 2 });
    }
    this.readbacks = Array.from({ length: READBACK_SLOTS }, (_, k) => ({
      buffer: device.createBuffer({
        label: `solver readback ${k}`,
        size: solver.reductionBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      busy: false,
    }));
    // the first resample, so fields() holds the ambient from the start
    this.submitFrame(0);
  }

  setTargets(targets: FlowTargets): void {
    this.targets = targets;
  }

  setMode(mode: SolverMode): void {
    this.mode = mode;
  }

  /** An uncaptured GPU error reported by the device's error sink: the solver stops (lost). */
  reportGpuError(message: string): void {
    this.lost ??= { message };
  }

  private submitFrame(n: number): void {
    const device = this.device;
    const solver = this.solver;
    const rs = this.resample;
    if (device === null || solver === null || rs === null) return;
    const slot: RingSlot | null = this.timestamps?.acquire() ?? null;
    const encoder = device.createCommandEncoder({ label: 'flow frame' });
    const pass = encoder.beginComputePass({
      label: 'flow solver',
      ...(slot === null ? {} : { timestampWrites: slot.writes(0) }),
    });
    if (this.mode === 'tracking') solver.encodeIterations(pass, n);
    else solver.encodePhysicalSteps(pass, n, true);
    pass.end();
    const rpass = encoder.beginComputePass({
      label: 'flow resample',
      ...(slot === null ? {} : { timestampWrites: slot.writes(1) }),
    });
    solver.encodeCurrentPrimitives(rpass);
    rpass.setPipeline(rs.pipeline);
    rs.groups.forEach((g, k) => {
      const [w, h] = rs.sizes[k] ?? [0, 0];
      rpass.setBindGroup(0, g);
      rpass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    });
    rpass.end();
    slot?.resolve(encoder);
    const rb = n > 0 ? this.readbacks.find((r) => !r.busy) : undefined;
    if (rb !== undefined) solver.encodeCopyReduction(encoder, rb.buffer);
    device.queue.submit([encoder.finish()]);
    this.totalIterations += n;
    this.lastIterations = n;
    this.version++;
    if (this.field !== null) this.field = { ...this.field, version: this.version };
    if (slot !== null) {
      void slot
        .read()
        .then(([solverMs, resampleMs]) => {
          const sOk = solverMs !== undefined && Number.isFinite(solverMs);
          const rOk = resampleMs !== undefined && Number.isFinite(resampleMs);
          this.resampleMs = rOk ? resampleMs : null;
          // the frame's GPU time, the resample included (W2S-B-I3: the app's 15 ms split sees it)
          this.gpuTimeMs = sOk && rOk ? solverMs + resampleMs : null;
          if (sOk) this.scheduler.observe(n, solverMs, rOk ? resampleMs : undefined);
        })
        .catch((e: unknown) => {
          this.readFailed(e);
        });
    }
    if (rb !== undefined) {
      rb.busy = true;
      const physical = this.mode === 'physical';
      void rb.buffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const red = new Float32Array(rb.buffer.getMappedRange().slice(0));
          rb.buffer.unmap();
          this.residual = residualFromPartials(red, solver.layout);
          if (physical) this.physicalTimeS = timeFromReduction(red, solver.layout);
        })
        .catch((e: unknown) => {
          this.readFailed(e);
        })
        .finally(() => {
          rb.busy = false;
        });
    }
  }

  /**
   * A failed read-back mapping: expected once dispose() destroyed the buffers (the pending maps
   * abort); otherwise a device problem, surfaced as lost and never swallowed.
   */
  private readFailed(e: unknown): void {
    if (this.disposed) return;
    this.lost ??= { message: `readback failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  step(budget: StepBudget): FlowStepStats {
    const usable = this.initialised && this.lost === null && !this.disposed;
    const n = usable ? this.scheduler.iterationsFor(budget) : 0;
    if (usable) this.submitFrame(n);
    return this.stats(usable ? n : 0);
  }

  private stats(n: number): FlowStepStats {
    return {
      iterationsThisStep: n,
      totalIterations: this.totalIterations,
      gpuTimeMs: this.gpuTimeMs,
      residualDensityL2: this.residual,
      physicalTimeS: this.mode === 'physical' ? this.physicalTimeS : 0,
    };
  }

  /** The latest measured GPU time of the resample pass, ms (null before one resolves). */
  get resampleGpuMs(): number | null {
    return this.resampleMs;
  }

  /** The moving average of the resample's GPU time the scheduler plans with, ms. */
  get resampleAverageMs(): number | null {
    return this.scheduler.resampleMs;
  }

  /** The measured cost per iteration the scheduler uses, ms. */
  get msPerIteration(): number | null {
    return this.scheduler.msPerIteration;
  }

  status(): FlowStatus {
    return solverFlowStatus({
      initialised: this.initialised,
      initError: this.initError,
      lost: this.lost,
      mode: this.mode,
      stats: this.initialised ? this.stats(this.lastIterations) : null,
    });
  }

  latestReduction(): StationReduction | null {
    return null;
  }

  fields(): FlowField {
    if (this.field === null) throw new Error('fields() before init()');
    return this.field;
  }

  /** The underlying kernel (tests, the coupling). */
  get kernel(): GpuSolver | null {
    return this.solver;
  }

  dispose(): void {
    this.disposed = true;
    this.solver?.destroy();
    for (const t of this.textures) t.destroy();
    for (const b of this.maps) b.destroy();
    for (const r of this.readbacks) r.buffer.destroy();
    this.timestamps?.destroy();
    this.solver = null;
    this.field = null;
  }
}
