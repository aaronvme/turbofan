// Indicative profiling of the GPU flow solver (D4-54), shared by the Dawn runner (tools/perf/dawn.ts)
// and the Chrome runner (tools/perf/chrome.perf.ts): the GPU time of every dispatch of one
// iteration, the static bytes each dispatch moves, and paired, interleaved A/B runs of two builds
// of the solver on one device, with a bitwise comparison of their results. None of this is a D0-1
// timing: the official P1 measurement is `npm run bench:p1` (spikes/README.md).
import { NU, physicalToPrim, primToCons } from '../../src/flow/reference/state';
import type { ReferenceState } from '../../src/flow/reference/gas';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';

/** The parts of GpuSolver the profiler uses (old builds of it have the same surface). */
export interface KernelLike {
  readonly layout: {
    readonly nCells: number;
    readonly nGhosts: number;
    readonly workgroups: number;
  };
  readonly ref: ReferenceState;
  encodeIterations(pass: GPUComputePassEncoder, n: number): void;
  setConserved(U: ArrayLike<number>): void;
  readState(): Promise<Float32Array>;
  readConserved(): Promise<Float64Array>;
}

/** The parts of GpuFlowSolver the frame A/B uses. */
export interface FlowLike {
  readonly kernel: KernelLike | null;
  /** The latest resolved GPU time of the frame's resample pass, ms. */
  readonly resampleGpuMs: number | null;
  step(budget: { gpuTimeBudgetMs: number; maxIterations: number }): {
    readonly iterationsThisStep: number;
  };
  fields(): {
    readonly near: { readonly state: GPUTexture; readonly velocity: GPUTexture };
    readonly far: { readonly state: GPUTexture; readonly velocity: GPUTexture };
  };
  dispose(): void;
}

export const median = (a: readonly number[]): number => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? (s[(n - 1) / 2] ?? NaN) : 0.5 * ((s[n / 2 - 1] ?? NaN) + (s[n / 2] ?? NaN));
};

/**
 * A smooth, non-trivial engine-like state for timing (not a solution): an axial jet with swirl, a
 * pressure wave, and a compact hot fuel-air plume (z > 0 on part of the domain only, as in the
 * engine, so both of the gas model's branches run). Conserved values, NU per cell (the oracle's).
 */
export interface PerfAmplitudes {
  /** Axial jet, m/s. */
  readonly jet: number;
  /** The plume's temperature rise, K. */
  readonly dT: number;
  /** Swirl, m/s. */
  readonly swirl: number;
  /** The plume's fuel-air ratio. */
  readonly z: number;
  /** The pressure wave's relative amplitude. */
  readonly dp: number;
  /** Radial velocity, m/s. */
  readonly v: number;
}

/**
 * The timing state's default amplitudes. Not a solution. Before the kernel took M_ref from the
 * face's beta (D4-44), the engine's preconditioned tracking (the GpuFlowSolver default) took it
 * non-finite after about 150 iterations, and a 0.1 % pressure wave at rest within 10 (W2R-I6:
 * w2-solver-perf and w2-solver-int handoffs, tools/perf/dawn.ts soak). With D4-44 both, and the
 * hot plume alone, stay finite for 1000 iterations. Profiles and A/B runs still re-set it.
 */
export const PERF_AMPLITUDES: PerfAmplitudes = {
  jet: 60,
  dT: 300,
  swirl: 20,
  z: 0.025,
  dp: 0.02,
  v: 8,
};

export function perfState(
  mesh: SolverMesh,
  ref: ReferenceState,
  amp: PerfAmplitudes = PERF_AMPLITUDES,
): Float64Array {
  let x0 = Infinity;
  let x1 = -Infinity;
  let r1 = 0;
  for (let c = 0; c < mesh.nCells; c++) {
    const x = mesh.cellX[c] ?? 0;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    r1 = Math.max(r1, mesh.cellR[c] ?? 0);
  }
  const U = new Float64Array(NU * mesh.nCells);
  for (let c = 0; c < mesh.nCells; c++) {
    const r = mesh.cellR[c] ?? NaN;
    const xn = ((mesh.cellX[c] ?? NaN) - x0) / (x1 - x0);
    const rn = r / r1;
    const jet = Math.exp(-((rn / 0.3) ** 2));
    const d2 = ((xn - 0.6) / 0.2) ** 2 + (rn / 0.12) ** 2;
    const plume = d2 < 1 ? 1 - d2 : 0;
    const t = ref.t + amp.dT * plume;
    const p = ref.p * (1 + amp.dp * Math.cos(6 * Math.PI * xn) * jet);
    const q = physicalToPrim(
      ref,
      {
        rho: p / (ref.r * t),
        u: ref.u + amp.jet * jet,
        v: amp.v * Math.sin(2 * Math.PI * xn) * rn * jet,
        w: amp.swirl * jet * Math.exp(-(((xn - 0.45) / 0.1) ** 2)),
        p,
        z: amp.z * plume,
      },
      r,
    );
    primToCons(ref, q, 0, r, U, NU * c);
  }
  return U;
}

/** A one-workgroup no-op pipeline: the marker passes that carry bracket timestamps. */
function markerPipeline(device: GPUDevice): { pipe: GPUComputePipeline; group: GPUBindGroup } {
  const module = device.createShaderModule({
    label: 'perf marker',
    code: `@group(0) @binding(0) var<storage, read_write> m: array<u32>;
@compute @workgroup_size(1) fn main() { m[0] = m[0] + 1u; }`,
  });
  const pipe = device.createComputePipeline({
    label: 'perf marker',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const buf = device.createBuffer({
    label: 'perf marker',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  });
  const group = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: buf } }],
  });
  return { pipe, group };
}

/** A query set with its resolve and read-back buffers: pairs of (begin, end) timestamps. */
class Queries {
  readonly set: GPUQuerySet;
  private readonly resolveBuf: GPUBuffer;
  private readonly readBuf: GPUBuffer;
  private used = 0;
  private readonly device: GPUDevice;
  readonly count: number;

  constructor(device: GPUDevice, count: number) {
    this.device = device;
    this.count = count;
    this.set = device.createQuerySet({ type: 'timestamp', count });
    this.resolveBuf = device.createBuffer({
      size: 8 * count,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuf = device.createBuffer({
      size: 8 * count,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  reset(): void {
    this.used = 0;
  }

  /** The next (begin, end) pair, or null when the set is full. */
  next(): GPUComputePassTimestampWrites {
    if (this.used + 2 > this.count) throw new Error('query set full');
    const w = {
      querySet: this.set,
      beginningOfPassWriteIndex: this.used,
      endOfPassWriteIndex: this.used + 1,
    };
    this.used += 2;
    return w;
  }

  /** Resolves the pairs written so far and returns their durations, ms. */
  async read(): Promise<number[]> {
    const n = this.used;
    const enc = this.device.createCommandEncoder();
    enc.resolveQuerySet(this.set, 0, n, this.resolveBuf, 0);
    enc.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0, 8 * n);
    this.device.queue.submit([enc.finish()]);
    await this.readBuf.mapAsync(GPUMapMode.READ);
    const t = new BigUint64Array(this.readBuf.getMappedRange().slice(0, 8 * n));
    this.readBuf.unmap();
    const out: number[] = [];
    for (let k = 0; k + 1 < n; k += 2) {
      out.push(Number((t[k + 1] ?? 0n) - (t[k] ?? 0n)) / 1e6);
    }
    return out;
  }

  /** The time from the end of pair a to the beginning of pair b, ms (bracket timing). */
  async between(): Promise<number[]> {
    const n = this.used;
    const enc = this.device.createCommandEncoder();
    enc.resolveQuerySet(this.set, 0, n, this.resolveBuf, 0);
    enc.copyBufferToBuffer(this.resolveBuf, 0, this.readBuf, 0, 8 * n);
    this.device.queue.submit([enc.finish()]);
    await this.readBuf.mapAsync(GPUMapMode.READ);
    const t = new BigUint64Array(this.readBuf.getMappedRange().slice(0, 8 * n));
    this.readBuf.unmap();
    const out: number[] = [];
    for (let k = 1; k + 2 < n; k += 4) out.push(Number((t[k + 1] ?? 0n) - (t[k] ?? 0n)) / 1e6);
    return out;
  }

  destroy(): void {
    this.set.destroy();
    this.resolveBuf.destroy();
    this.readBuf.destroy();
  }
}

/**
 * A stand-in for a compute pass that opens a real pass, with its own timestamp pair, for every
 * dispatch recorded into it: the solver's encodeIterations runs unchanged on it.
 */
function splitPass(
  encoder: GPUCommandEncoder,
  queries: Queries,
  names: string[],
): GPUComputePassEncoder {
  let pipe: GPUComputePipeline | null = null;
  const groups = new Map<number, GPUBindGroup>();
  const fake = {
    setPipeline(p: GPUComputePipeline) {
      pipe = p;
    },
    setBindGroup(index: number, g: GPUBindGroup) {
      groups.set(index, g);
    },
    dispatchWorkgroups(x: number, y?: number, z?: number) {
      if (pipe === null) throw new Error('dispatch before setPipeline');
      const pass = encoder.beginComputePass({ timestampWrites: queries.next() });
      pass.setPipeline(pipe);
      for (const [k, g] of groups) pass.setBindGroup(k, g);
      pass.dispatchWorkgroups(x, y, z);
      pass.end();
      names.push(pipe.label);
    },
  };
  return fake as unknown as GPUComputePassEncoder;
}

export interface DispatchTime {
  readonly name: string;
  readonly ms: number;
}

/**
 * GPU time of each dispatch of one tracking iteration, each in its own pass (median over reps),
 * and of the same iteration in one pass (the solver's way). The sum of the dispatches leaves out
 * the drains between them; the one-pass time includes them.
 */
export async function profileIteration(
  device: GPUDevice,
  kernel: KernelLike,
  U: ArrayLike<number>,
  reps: number,
): Promise<{ dispatches: DispatchTime[]; sumMs: number; onePassMs: number }> {
  const per = 64;
  const q = new Queries(device, 2 * per);
  const samples: number[][] = [];
  let names: string[] = [];
  const one: number[] = [];
  kernel.setConserved(U);
  for (let r = 0; r < reps; r++) {
    // split: every dispatch timed alone
    q.reset();
    names = [];
    const enc = device.createCommandEncoder();
    kernel.encodeIterations(splitPass(enc, q, names), 1);
    device.queue.submit([enc.finish()]);
    const t = await q.read();
    t.forEach((ms, k) => {
      (samples[k] ??= []).push(ms);
    });
    // the same iteration in one pass
    q.reset();
    const enc2 = device.createCommandEncoder();
    const pass = enc2.beginComputePass({ timestampWrites: q.next() });
    kernel.encodeIterations(pass, 1);
    pass.end();
    device.queue.submit([enc2.finish()]);
    one.push((await q.read())[0] ?? NaN);
    if (r % 10 === 9) kernel.setConserved(U);
  }
  q.destroy();
  const dispatches = names.map((name, k) => ({ name, ms: median(samples[k] ?? []) }));
  return {
    dispatches,
    sumMs: dispatches.reduce((s, d) => s + d.ms, 0),
    onePassMs: median(one),
  };
}

/**
 * GPU time of `record`'s submissions, bracketed by marker passes on the queue (so the gaps between
 * submits and every pass boundary are inside), ms.
 */
export async function bracket(
  device: GPUDevice,
  marker: { pipe: GPUComputePipeline; group: GPUBindGroup },
  q: Queries,
  record: () => void,
): Promise<number> {
  q.reset();
  const mark = () => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass({ timestampWrites: q.next() });
    pass.setPipeline(marker.pipe);
    pass.setBindGroup(0, marker.group);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  mark();
  record();
  mark();
  return (await q.between())[0] ?? NaN;
}

export interface Side {
  readonly label: string;
  readonly flow: FlowLike;
}

export interface AbResult {
  readonly label: string;
  /** Tracking iterations in one pass, back to back: ms per iteration (median of reps). */
  readonly msPerIteration: number;
  /** Whole frames of the FlowSolver (n iterations + the resample), back to back, ms per frame. */
  readonly msPerFrame: number;
  /** Frames with 0 iterations (the resample alone), ms per frame. */
  readonly msPerResampleFrame: number;
  readonly samples: {
    readonly it: number[];
    readonly frame: number[];
    readonly resample: number[];
  };
}

/**
 * Paired, interleaved A/B: per repetition, each side (the order alternating) is reset to U, warmed
 * up, then timed on `iterations` iterations in one pass, `frames` FlowSolver frames of `perFrame`
 * iterations, and `frames` frames of 0 iterations. Both sides share the device, so contamination
 * from other GPU work hits both alike.
 */
export async function pairedAb(
  device: GPUDevice,
  sides: readonly Side[],
  U: ArrayLike<number>,
  o: { reps: number; iterations: number; frames: number; perFrame: number; warmup: number },
): Promise<AbResult[]> {
  const marker = markerPipeline(device);
  const q = new Queries(device, 8);
  const res = sides.map(() => ({
    it: [] as number[],
    frame: [] as number[],
    resample: [] as number[],
  }));
  const budget = (n: number) => ({ gpuTimeBudgetMs: 1000, maxIterations: n });
  for (let r = 0; r < o.reps; r++) {
    const order = sides.map((_, k) => k);
    if (r % 2 === 1) order.reverse();
    for (const k of order) {
      const side = sides[k];
      const out = res[k];
      const kernel = side?.flow.kernel;
      if (side === undefined || out === undefined || kernel === undefined || kernel === null) {
        throw new Error('bad side');
      }
      kernel.setConserved(U);
      for (let w = 0; w < o.warmup; w++) side.flow.step(budget(o.perFrame));
      await device.queue.onSubmittedWorkDone();
      // the iterations' own pass timestamps (GPU time, as the FlowSolver's scheduler sees it)
      q.reset();
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass({ timestampWrites: q.next() });
      kernel.encodeIterations(pass, o.iterations);
      pass.end();
      device.queue.submit([enc.finish()]);
      const itMs = (await q.read())[0] ?? NaN;
      out.it.push(itMs / o.iterations);
      kernel.setConserved(U);
      let its = 0;
      const frameMs = await bracket(device, marker, q, () => {
        for (let f = 0; f < o.frames; f++)
          its += side.flow.step(budget(o.perFrame)).iterationsThisStep;
      });
      // a frame the scheduler cut short (its 7 ms ceiling on a noisy average) is not comparable
      out.frame.push(its === o.frames * o.perFrame ? frameMs / o.frames : NaN);
      // the resample pass's own timestamps (the FlowSolver's ring), a frame at a time
      const rs: number[] = [];
      for (let f = 0; f < 6; f++) {
        side.flow.step(budget(0));
        await device.queue.onSubmittedWorkDone();
        await new Promise((resolve) => setTimeout(resolve, 5));
        rs.push(side.flow.resampleGpuMs ?? NaN);
      }
      out.resample.push(median(rs));
    }
  }
  q.destroy();
  return sides.map((s, k) => {
    const x = res[k] ?? { it: [], frame: [], resample: [] };
    return {
      label: s.label,
      msPerIteration: median(x.it),
      msPerFrame: median(x.frame),
      msPerResampleFrame: median(x.resample),
      samples: x,
    };
  });
}

async function readTexture(device: GPUDevice, tex: GPUTexture): Promise<Uint16Array> {
  const bytesPerRow = Math.ceil((8 * tex.width) / 256) * 256;
  const buf = device.createBuffer({
    size: bytesPerRow * tex.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [tex.width, tex.height]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const all = new Uint16Array(buf.getMappedRange().slice(0));
  buf.destroy();
  const out = new Uint16Array(4 * tex.width * tex.height);
  for (let y = 0; y < tex.height; y++) {
    out.set(
      all.subarray((y * bytesPerRow) / 2, (y * bytesPerRow) / 2 + 4 * tex.width),
      4 * tex.width * y,
    );
  }
  return out;
}

/** Number of differing 32-bit words of two arrays (bitwise; NaN payloads count as words). */
function differingWords(a: ArrayBufferView, b: ArrayBufferView): number {
  const x = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  if (x.length !== y.length) return Math.max(x.length, y.length);
  let n = 0;
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) n++;
  return n;
}

/**
 * Non-finite values of a float array, or of half-float bits (exponent all ones). Two NaN states
 * compare equal word for word, so a bitwise match says nothing without this (W2I-N3).
 */
function nonFinite(a: Float32Array | Float64Array | Uint16Array): number {
  let n = 0;
  if (a instanceof Uint16Array) {
    for (const h of a) if ((h & 0x7c00) === 0x7c00) n++;
  } else {
    for (const x of a) if (!Number.isFinite(x)) n++;
  }
  return n;
}

/**
 * Both sides from U through the same frames (`frames` x `perFrame` iterations, each with its
 * resample): the state copy, the compensated U^n (copy + low part) and the four render textures,
 * compared bitwise, with each side's non-finite values counted. 0 everywhere: the two builds give
 * the same finite results bit for bit.
 */
export async function compareSides(
  device: GPUDevice,
  a: FlowLike,
  b: FlowLike,
  U: ArrayLike<number>,
  frames: number,
  perFrame: number,
): Promise<Record<string, number>> {
  const run = async (f: FlowLike) => {
    const k = f.kernel;
    if (k === null) throw new Error('no kernel');
    k.setConserved(U);
    // the iterations straight on the kernel (the scheduler may cut a frame short, which would make
    // the two runs different computations), then a frame of 0 iterations for the resample
    for (let s = 0; s < frames; s++) {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      k.encodeIterations(pass, perFrame);
      pass.end();
      device.queue.submit([enc.finish()]);
    }
    f.step({ gpuTimeBudgetMs: 1000, maxIterations: 0 });
    await device.queue.onSubmittedWorkDone();
    const fl = f.fields();
    return {
      state: await k.readState(),
      conservedF64: await k.readConserved(),
      nearState: await readTexture(device, fl.near.state),
      nearVelocity: await readTexture(device, fl.near.velocity),
      farState: await readTexture(device, fl.far.state),
      farVelocity: await readTexture(device, fl.far.velocity),
    };
  };
  const x = await run(a);
  const y = await run(b);
  let maxAbs = 0;
  for (let k = 0; k < x.conservedF64.length; k++) {
    maxAbs = Math.max(maxAbs, Math.abs((x.conservedF64[k] ?? NaN) - (y.conservedF64[k] ?? NaN)));
  }
  return {
    stateWords: differingWords(x.state, y.state),
    conservedF64Words: differingWords(x.conservedF64, y.conservedF64),
    conservedMaxAbs: maxAbs,
    nearState: differingWords(x.nearState, y.nearState),
    nearVelocity: differingWords(x.nearVelocity, y.nearVelocity),
    farState: differingWords(x.farState, y.farState),
    farVelocity: differingWords(x.farVelocity, y.farVelocity),
    // the f32 state copy (U^n's high part) and the textures; the f64 U^n follows the state
    nonFiniteStateA: nonFinite(x.state),
    nonFiniteStateB: nonFinite(y.state),
    nonFiniteTexturesA: [x.nearState, x.nearVelocity, x.farState, x.farVelocity].reduce(
      (n, t) => n + nonFinite(t),
      0,
    ),
    nonFiniteTexturesB: [y.nearState, y.nearVelocity, y.farState, y.farVelocity].reduce(
      (n, t) => n + nonFinite(t),
      0,
    ),
  };
}
