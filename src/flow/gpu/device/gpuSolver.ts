// The GPU flow solver (docs/SOLVER.md) on a device we own: buffers, pipelines and the command
// encoding of the tracking (3-stage RK, local dt) and physical-time (SSP-RK3, global dt) modes.
// Exercised by `npm run test:gpu` (Dawn) and the GPU ladder; the pure parts it uses (layout,
// params, WGSL generation, scheduler) are unit-tested.
//
// State: three copies C0, C1, C2 of array<vec4f>, two vec4 per cell:
//   (rho', rho u, rho v, rho r w), (eta, rho Z, tau, beta^2)
// (tau and beta^2 are the tracking mode's stage-1 values, carried to stages 2 and 3). An
// iteration with U^n in copy N and the free copies X, Y:
//   stage 1: in N, base N -> X;  stage 2: in X, base N -> Y;  stage 3: in Y, base N -> X
// so U^n alternates between C0 and C1 and C2 holds the middle stage (as W0's spike).
import { primToCons, physicalToPrim, NU, type PhysicalState } from '../../reference/state';
import type { ReferenceState } from '../../reference/gas';
import type { SolverMesh } from '../../reference/solverMesh';
import { blockageData, buildLayout, type GpuLayout, type Tile } from '../layout';
import {
  PARAMS_BYTES,
  PARAMS_STRIDE,
  packParams,
  stageParams,
  type GpuSchemeOptions,
  type StageParamSet,
} from '../params';
import type { LimiterKind } from '../wgsl/flux';
import {
  SCALAR,
  dtKernelWgsl,
  ghostKernelWgsl,
  lambdaKernelWgsl,
  CELL_SOURCE_VEC4,
  cellSourceKernelWgsl,
  primKernelWgsl,
  reductionLength,
  residualFromPartials,
  stageKernelWgsl,
  timeFromReduction,
  tileFaceSlots,
  type KernelOptions,
} from '../wgsl/kernels';

export interface GpuSolverOptions extends GpuSchemeOptions {
  readonly tile?: Tile;
  readonly limiter?: LimiterKind;
  /** BC code -> BC code for physical ghosts (tests only, e.g. ladder L1). */
  readonly bcRemap?: Readonly<Partial<Record<number, number>>>;
  /** The built-in cell source model (setCellSource; wgsl/kernels.ts cellSourceKernelWgsl). */
  readonly cellSource?: boolean;
  /** Test only: keep every face flux of the last stage (readFaceDump). */
  readonly faceDump?: boolean;
  readonly label?: string;
}

export type SolverModeIndex = 0 | 1;

export interface CellSourceCoefficients {
  readonly rate0?: ArrayLike<number>;
  readonly aRho?: ArrayLike<number>;
  readonly kU?: ArrayLike<number>;
  readonly kMass?: ArrayLike<number>;
  readonly damping?: ArrayLike<number>;
}

export async function compileWgsl(
  device: GPUDevice,
  code: string,
  label: string,
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    const lines = errors.map((m) => `${label}:${m.lineNum}:${m.linePos} ${m.message}`);
    throw new Error(`WGSL compilation failed:\n${lines.join('\n')}`);
  }
  return module;
}

// a function, not a module constant: Node gets the WebGPU enums only once Dawn is loaded
const storageUsage = (): number =>
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

export class GpuSolver {
  readonly device: GPUDevice;
  readonly mesh: SolverMesh;
  readonly layout: GpuLayout;
  readonly params: StageParamSet;
  readonly ref: ReferenceState;
  /** Iterations (tracking) or steps (physical) encoded so far. */
  iterations = 0;

  private readonly label: string;
  private readonly copies: GPUBuffer[];
  private readonly prim: GPUBuffer;
  private readonly geo: GPUBuffer;
  private readonly topo: GPUBuffer;
  private readonly red: GPUBuffer;
  private readonly uniforms: GPUBuffer;
  private readonly src: GPUBuffer | null;
  private readonly coef: GPUBuffer | null;
  private readonly dump: GPUBuffer | null;
  private readonly pipes: Record<
    'prim' | 'ghost' | 'stage' | 'lambda' | 'dt' | 'time',
    GPUComputePipeline
  >;
  private readonly sourcePipe: GPUComputePipeline | null;
  /** [copy] */
  private readonly primGroups: GPUBindGroup[];
  private readonly sourceGroups: GPUBindGroup[];
  /** [mode] */
  private readonly ghostGroups: GPUBindGroup[];
  /** [mode][parity][stage] */
  private readonly stageGroups: GPUBindGroup[][][];
  private readonly lambdaGroup: GPUBindGroup;
  private readonly dtGroup: GPUBindGroup;
  private readonly timeGroup: GPUBindGroup;
  private parity = 0;
  private readonly owned: GPUBuffer[];

  private constructor(init: {
    device: GPUDevice;
    mesh: SolverMesh;
    layout: GpuLayout;
    params: StageParamSet;
    label: string;
    buffers: {
      copies: GPUBuffer[];
      prim: GPUBuffer;
      geo: GPUBuffer;
      topo: GPUBuffer;
      red: GPUBuffer;
      uniforms: GPUBuffer;
      src: GPUBuffer | null;
      coef: GPUBuffer | null;
      dump: GPUBuffer | null;
    };
    pipes: GpuSolver['pipes'];
    sourcePipe: GPUComputePipeline | null;
  }) {
    this.device = init.device;
    this.mesh = init.mesh;
    this.layout = init.layout;
    this.params = init.params;
    this.ref = init.params.ref;
    this.label = init.label;
    const b = init.buffers;
    this.copies = b.copies;
    this.prim = b.prim;
    this.geo = b.geo;
    this.topo = b.topo;
    this.red = b.red;
    this.uniforms = b.uniforms;
    this.src = b.src;
    this.coef = b.coef;
    this.dump = b.dump;
    this.pipes = init.pipes;
    this.sourcePipe = init.sourcePipe;
    this.owned = [...b.copies, b.prim, b.geo, b.topo, b.red, b.uniforms];
    for (const x of [b.src, b.coef, b.dump]) if (x !== null) this.owned.push(x);

    const d = this.device;
    const uni = (block: number): GPUBindGroupEntry => ({
      binding: 0,
      resource: { buffer: this.uniforms, offset: block * PARAMS_STRIDE, size: PARAMS_BYTES },
    });
    const buf = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({
      binding,
      resource: { buffer },
    });
    const group = (pipe: GPUComputePipeline, label: string, entries: GPUBindGroupEntry[]) =>
      d.createBindGroup({
        label: `${this.label} ${label}`,
        layout: pipe.getBindGroupLayout(0),
        entries,
      });
    this.primGroups = this.copies.map((c, k) =>
      group(this.pipes.prim, `prim C${k}`, [
        uni(0),
        buf(1, c),
        buf(2, this.prim),
        buf(3, this.geo),
      ]),
    );
    const sp = this.sourcePipe;
    const coef = this.coef;
    const srcBuf = this.src;
    this.sourceGroups =
      sp === null || coef === null || srcBuf === null
        ? []
        : this.copies.map((c, k) =>
            group(sp, `source C${k}`, [
              uni(0),
              buf(1, c),
              buf(2, coef),
              buf(3, srcBuf),
              buf(4, this.prim),
              buf(5, this.geo),
            ]),
          );
    this.ghostGroups = [0, 3].map((block) =>
      group(this.pipes.ghost, `ghost ${block === 0 ? 'tracking' : 'physical'}`, [
        uni(block),
        buf(1, this.prim),
        buf(2, this.topo),
      ]),
    );
    // parity 0: N = C0, X = C1, Y = C2; parity 1: N = C1, X = C0, Y = C2
    const roles = [
      [0, 1, 2],
      [1, 0, 2],
    ] as const;
    this.stageGroups = [0, 1].map((mode) =>
      roles.map(([n, x, y]) =>
        [
          [n, x],
          [x, y],
          [y, x],
        ].map(([inp, out], stage) => {
          const cin = this.copies[inp ?? 0];
          const cbase = this.copies[n];
          const cout = this.copies[out ?? 0];
          if (cin === undefined || cbase === undefined || cout === undefined) {
            throw new Error('bad state copy');
          }
          const entries = [
            uni(3 * mode + stage),
            buf(1, cin),
            buf(2, cbase),
            buf(3, cout),
            buf(4, this.prim),
            buf(5, this.geo),
            buf(6, this.topo),
            buf(7, this.red),
          ];
          if (srcBuf !== null) entries.push(buf(8, srcBuf));
          if (this.dump !== null) entries.push(buf(9, this.dump));
          return group(this.pipes.stage, `stage m${mode} p${n} s${stage + 1}`, entries);
        }),
      ),
    );
    this.lambdaGroup = group(this.pipes.lambda, 'lambda', [
      uni(3),
      buf(4, this.prim),
      buf(5, this.geo),
      buf(6, this.topo),
      buf(7, this.red),
    ]);
    this.dtGroup = group(this.pipes.dt, 'dt', [uni(3), buf(7, this.red)]);
    this.timeGroup = group(this.pipes.time, 'time', [buf(7, this.red)]);
  }

  static async create(
    device: GPUDevice,
    mesh: SolverMesh,
    opts: GpuSolverOptions,
  ): Promise<GpuSolver> {
    const label = opts.label ?? 'flow solver';
    const layout = buildLayout(mesh, {
      ...(opts.tile === undefined ? {} : { tile: opts.tile }),
      ...(opts.bcRemap === undefined ? {} : { bcRemap: opts.bcRemap }),
    });
    const params = stageParams(opts, {
      nCells: layout.nCells,
      nGhosts: layout.nGhosts,
      nWorkgroups: layout.workgroups,
    });
    const ko: KernelOptions = {
      gas: opts.gas,
      layout,
      ...(opts.limiter === undefined ? {} : { limiter: opts.limiter }),
      sources: opts.cellSource === true,
      faceDump: opts.faceDump === true,
    };
    const pipe = async (code: string, name: string, entryPoint: string) => {
      const module = await compileWgsl(device, code, `${label} ${name}`);
      return device.createComputePipelineAsync({
        label: `${label} ${name}`,
        layout: 'auto',
        compute: { module, entryPoint },
      });
    };
    const dtCode = dtKernelWgsl(ko);
    const [prim, ghost, stage, lambda, dt, time, source] = await Promise.all([
      pipe(primKernelWgsl(ko), 'prim', 'primMain'),
      pipe(ghostKernelWgsl(ko), 'ghost', 'ghostMain'),
      pipe(stageKernelWgsl(ko), 'stage', 'stageMain'),
      pipe(lambdaKernelWgsl(ko), 'lambda', 'lambdaMain'),
      pipe(dtCode, 'dt', 'dtMain'),
      pipe(dtCode, 'time', 'advanceTime'),
      opts.cellSource === true
        ? pipe(cellSourceKernelWgsl(ko), 'source', 'sourceMain')
        : Promise.resolve(null),
    ]);

    const n = layout.nCells;
    const nExt = n + layout.nGhosts;
    const make = (size: number, name: string, usage = storageUsage()) =>
      device.createBuffer({ label: `${label} ${name}`, size: Math.max(16, size), usage });
    const copies = [0, 1, 2].map((k) => make(32 * n, `U${k}`));
    const primBuf = make(32 * nExt, 'prim');
    const geo = make(layout.geoData.byteLength, 'geo');
    device.queue.writeBuffer(geo, 0, layout.geoData);
    const topo = make(layout.topoData.byteLength, 'topo');
    device.queue.writeBuffer(topo, 0, layout.topoData);
    const red = make(4 * reductionLength(layout), 'reduction');
    const uniforms = make(
      6 * PARAMS_STRIDE,
      'params',
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    [...params.tracking, ...params.physical].forEach((v, k) => {
      device.queue.writeBuffer(uniforms, k * PARAMS_STRIDE, packParams(v));
    });
    const src = opts.cellSource === true ? make(64 * n, 'sources') : null;
    const coef =
      opts.cellSource === true ? make(16 * CELL_SOURCE_VEC4 * n, 'source coefficients') : null;
    const dump =
      opts.faceDump === true
        ? make(32 * layout.workgroups * tileFaceSlots(layout.tile), 'face dump')
        : null;
    const solver = new GpuSolver({
      device,
      mesh,
      layout,
      params,
      label,
      buffers: { copies, prim: primBuf, geo, topo, red, uniforms, src, coef, dump },
      pipes: { prim, ghost, stage, lambda, dt, time },
      sourcePipe: source,
    });
    solver.setBlockage(new Float64Array(n).fill(1));
    solver.setUniform({ rho: params.ref.rho, u: params.ref.u, v: 0, w: 0, p: params.ref.p, z: 0 });
    return solver;
  }

  /** The buffer holding U^n after everything encoded so far. */
  get state(): GPUBuffer {
    const c = this.copies[this.parity];
    if (c === undefined) throw new Error('bad parity');
    return c;
  }

  /** The primitive records (8 per extended index) of the last prim/ghost pass. */
  get primitives(): GPUBuffer {
    return this.prim;
  }

  /** Blockage per cell (section 8), in (0, 1]. */
  setBlockage(b: ArrayLike<number>): void {
    const { cellB, extB } = blockageData(this.mesh, this.layout, b);
    this.device.queue.writeBuffer(this.geo, 16 * this.layout.geo.cellB, cellB);
    this.device.queue.writeBuffer(this.geo, 16 * this.layout.geo.extB, extB);
  }

  /**
   * Coefficients of the built-in cell source (6 per cell each, kMass 1 per cell; missing: 0):
   * rate = rate0 + rho aRho - kU U - kMass rho (1, u, v, rw, Delta h0, Z), damping d.
   */
  setCellSource(c: CellSourceCoefficients): void {
    if (this.coef === null) throw new Error('the solver was created without cellSource');
    const n = this.layout.nCells;
    const data = new Float32Array(4 * CELL_SOURCE_VEC4 * n);
    const put = (a: ArrayLike<number> | undefined, slot: number) => {
      if (a === undefined) return;
      if (a.length !== NU * n) throw new Error(`source coefficients need ${NU * n} values`);
      for (let k = 0; k < n; k++) {
        for (let m = 0; m < NU; m++) {
          data[4 * CELL_SOURCE_VEC4 * k + 4 * slot + m] = a[NU * k + m] ?? NaN;
        }
      }
    };
    put(c.rate0, 0);
    put(c.aRho, 2);
    put(c.kU, 4);
    put(c.damping, 6);
    // kMass in the z of the second record (after rate0's last two components)
    if (c.kMass !== undefined) {
      if (c.kMass.length !== n) throw new Error(`kMass needs ${n} values`);
      for (let k = 0; k < n; k++) data[4 * CELL_SOURCE_VEC4 * k + 6] = c.kMass[k] ?? NaN;
    }
    this.device.queue.writeBuffer(this.coef, 0, data);
  }

  /** Sets U^n from conserved gauge values (6 per cell, rounded to f32). */
  setConserved(U: ArrayLike<number>): void {
    const n = this.layout.nCells;
    const data = new Float32Array(8 * n);
    for (let c = 0; c < n; c++) {
      for (let m = 0; m < 4; m++) data[8 * c + m] = U[NU * c + m] ?? NaN;
      data[8 * c + 4] = U[NU * c + 4] ?? NaN;
      data[8 * c + 5] = U[NU * c + 5] ?? NaN;
      data[8 * c + 7] = 1;
    }
    this.device.queue.writeBuffer(this.state, 0, data);
  }

  /** Every cell from a physical state at its centroid (f64 on the host, as the oracle). */
  setState(at: (x: number, r: number, cell: number) => PhysicalState): void {
    const m = this.mesh;
    const U = new Float64Array(NU * m.nCells);
    for (let c = 0; c < m.nCells; c++) {
      const rc = m.cellR[c] ?? NaN;
      const q = physicalToPrim(this.ref, at(m.cellX[c] ?? NaN, rc, c), rc);
      primToCons(this.ref, q, 0, rc, U, NU * c);
    }
    this.setConserved(U);
  }

  setUniform(s: PhysicalState): void {
    this.setState(() => s);
  }

  private dispatchCells(pass: GPUComputePassEncoder, count: number): void {
    pass.dispatchWorkgroups(Math.ceil(count / 64));
  }

  /** prim + ghost passes for the copy `copy` in `mode` (0 tracking BCs, 1 physical BCs). */
  private encodePrimGhost(pass: GPUComputePassEncoder, copy: number, mode: SolverModeIndex): void {
    const g = this.primGroups[copy];
    const gg = this.ghostGroups[mode];
    if (g === undefined || gg === undefined) throw new Error('bad copy or mode');
    pass.setPipeline(this.pipes.prim);
    pass.setBindGroup(0, g);
    this.dispatchCells(pass, this.layout.nCells);
    if (this.layout.nGhosts > 0) {
      pass.setPipeline(this.pipes.ghost);
      pass.setBindGroup(0, gg);
      this.dispatchCells(pass, this.layout.nGhosts);
    }
  }

  private encodeStep(pass: GPUComputePassEncoder, mode: SolverModeIndex): void {
    const roles = this.parity === 0 ? [0, 1, 2] : [1, 0, 2];
    const inputs = [roles[0], roles[1], roles[2]];
    for (let k = 0; k < 3; k++) {
      const copy = inputs[k] ?? 0;
      this.encodePrimGhost(pass, copy, mode);
      if (this.sourcePipe !== null) {
        const sg = this.sourceGroups[copy];
        if (sg === undefined) throw new Error('bad source group');
        pass.setPipeline(this.sourcePipe);
        pass.setBindGroup(0, sg);
        this.dispatchCells(pass, this.layout.nCells);
      }
      const group = this.stageGroups[mode]?.[this.parity]?.[k];
      if (group === undefined) throw new Error('bad stage group');
      pass.setPipeline(this.pipes.stage);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(this.layout.workgroups);
    }
    this.parity ^= 1;
    this.iterations++;
  }

  /** Records n tracking iterations into an open compute pass. */
  encodeIterations(pass: GPUComputePassEncoder, n: number): void {
    for (let it = 0; it < n; it++) this.encodeStep(pass, 0);
  }

  /** The physical-time global dt (section 10) of U^n into the dt scalar, on the GPU. */
  encodeGlobalDt(pass: GPUComputePassEncoder): void {
    this.encodePrimGhost(pass, this.parity, 1);
    pass.setPipeline(this.pipes.lambda);
    pass.setBindGroup(0, this.lambdaGroup);
    pass.dispatchWorkgroups(this.layout.workgroups);
    pass.setPipeline(this.pipes.dt);
    pass.setBindGroup(0, this.dtGroup);
    pass.dispatchWorkgroups(1);
  }

  /**
   * Records n SSP-RK3 steps. autoDt: each at the CFL_phys global dt computed on the GPU;
   * otherwise at the dt already in the dt scalar (setPhysicalDt).
   */
  encodePhysicalSteps(pass: GPUComputePassEncoder, n: number, autoDt: boolean): void {
    for (let s = 0; s < n; s++) {
      if (autoDt) this.encodeGlobalDt(pass);
      this.encodeStep(pass, 1);
      pass.setPipeline(this.pipes.time);
      pass.setBindGroup(0, this.timeGroup);
      pass.dispatchWorkgroups(1);
    }
  }

  /** Records the prim + ghost passes of U^n (for the resample or a readback). */
  encodeCurrentPrimitives(pass: GPUComputePassEncoder, mode: SolverModeIndex = 0): void {
    this.encodePrimGhost(pass, this.parity, mode);
  }

  private submit(record: (pass: GPUComputePassEncoder) => void): void {
    const encoder = this.device.createCommandEncoder({ label: this.label });
    const pass = encoder.beginComputePass({ label: this.label });
    record(pass);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** Tracking mode: n iterations (submitted at once). */
  iterate(n = 1): void {
    this.submit((pass) => {
      this.encodeIterations(pass, n);
    });
  }

  setPhysicalDt(dt: number): void {
    if (!(dt > 0 && Number.isFinite(dt))) throw new Error(`dt ${dt} must be positive`);
    this.device.queue.writeBuffer(
      this.red,
      4 * (2 * this.layout.workgroups + SCALAR.dt),
      new Float32Array([dt]),
    );
  }

  /** Physical mode: one SSP-RK3 step at dt (default: the CFL_phys global dt, on the GPU). */
  stepPhysical(dt?: number): void {
    if (dt !== undefined) this.setPhysicalDt(dt);
    this.submit((pass) => {
      this.encodePhysicalSteps(pass, 1, dt === undefined);
    });
  }

  private async readBuffer(src: GPUBuffer, offset: number, size: number): Promise<ArrayBuffer> {
    const staging = this.device.createBuffer({
      label: `${this.label} readback`,
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(src, offset, staging, 0, size);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = staging.getMappedRange().slice(0);
    staging.destroy();
    return out;
  }

  /** U^n as 8 f32 per cell: (rho', rho u, rho v, rho r w), (eta, rho Z, tau, beta^2). */
  async readState(): Promise<Float32Array> {
    return new Float32Array(await this.readBuffer(this.state, 0, 32 * this.layout.nCells));
  }

  /** U^n as 6 conserved gauge values per cell (f64 copies of the f32 values). */
  async readConserved(): Promise<Float64Array> {
    const s = await this.readState();
    const n = this.layout.nCells;
    const U = new Float64Array(NU * n);
    for (let c = 0; c < n; c++) {
      for (let m = 0; m < 6; m++) U[NU * c + m] = s[8 * c + m] ?? NaN;
    }
    return U;
  }

  /** Primitive records (8 per extended index: cells then ghosts) of U^n, after the BCs. */
  async readPrimitives(mode: SolverModeIndex = 0): Promise<Float32Array> {
    this.submit((pass) => {
      this.encodeCurrentPrimitives(pass, mode);
    });
    const n = this.layout.nCells + this.layout.nGhosts;
    return new Float32Array(await this.readBuffer(this.prim, 0, 32 * n));
  }

  private async readReduction(): Promise<Float32Array> {
    return new Float32Array(await this.readBuffer(this.red, 0, 4 * reductionLength(this.layout)));
  }

  /** sqrt(mean (R_rho / (b V))^2) of the last stage 1 (section 11), from the tile partials. */
  async readResidual(): Promise<number> {
    return residualFromPartials(await this.readReduction(), this.layout);
  }

  /** Simulated time of the physical mode, s. */
  async readTime(): Promise<number> {
    return timeFromReduction(await this.readReduction(), this.layout);
  }

  /** The physical-time dt CFL_phys min (b V / lambda) of U^n, computed on the GPU. */
  async globalDt(): Promise<number> {
    this.submit((pass) => {
      this.encodeGlobalDt(pass);
    });
    const r = await this.readReduction();
    return r[2 * this.layout.workgroups + SCALAR.dt] ?? NaN;
  }

  /** Bytes of the reduction buffer (tile residual partials, then the dt and clock scalars). */
  get reductionBytes(): number {
    return 4 * reductionLength(this.layout);
  }

  /** Copies the reduction buffer into dst (MAP_READ) at the end of an encoder. */
  encodeCopyReduction(encoder: GPUCommandEncoder, dst: GPUBuffer): void {
    encoder.copyBufferToBuffer(this.red, 0, dst, 0, this.reductionBytes);
  }

  /** The cell metrics (geo buffer: CELL_GEO section first), for kernels that need r_c. */
  get geometry(): GPUBuffer {
    return this.geo;
  }

  /** The uniform buffer and the byte offset of tracking stage 1's block. */
  get uniformBuffer(): GPUBuffer {
    return this.uniforms;
  }

  /** Test only: the face fluxes of the last stage, 8 f32 per (workgroup, tile face slot). */
  async readFaceDump(): Promise<Float32Array> {
    if (this.dump === null) throw new Error('the solver was created without faceDump');
    return new Float32Array(await this.readBuffer(this.dump, 0, this.dump.size));
  }

  destroy(): void {
    for (const b of this.owned) b.destroy();
  }
}
