// The flow visuals' raw compute on the view's device (w2/flowviz round 2): the field textures
// the visuals read (the solver's own resample textures, or a CPU field uploaded into textures of
// our own: the MOCK fallback and the tests), the density gradient the schlieren and the haze
// march through, and the GPU particles (src/flow/viz/particleKernel.ts, checked against its TS
// mirror on Dawn by tests/gpu/flowParticles.test.ts). One compute pass per frame, timestamped
// (the flow-visual time of D4-2, which the scheduler subtracts from the solver's budget).
// Worker-safe: no DOM.

import {
  FIELD_EXTENTS,
  FIELD_TEXTURE_FORMAT,
  type CpuFlowField,
  type FieldExtent,
  type FieldReference,
  type FlowField,
  type FlowFieldSource,
} from '../contracts/flow';
import { compileWgsl } from '../flow/gpu/device/gpuSolver';
import { TimestampRing } from '../flow/gpu/device/timestampRing';
import {
  GRADIENT_WORKGROUP,
  gradientKernelWgsl,
  initialParticles,
  packParticleParams,
  PARTICLE_PARAMS_BYTES,
  PARTICLE_WORKGROUP,
  particleKernelWgsl,
} from '../flow/viz/particleKernel';
import type { SeedZone } from '../flow/viz/particles';
import { median } from '../gpu/passTimings';

/** The field the visuals draw: GPU textures on the view's device and where they came from. */
export interface FlowFieldBinding {
  readonly source: FlowFieldSource;
  readonly reference: FieldReference;
  readonly near: { readonly state: GPUTexture; readonly velocity: GPUTexture };
  /** Bumped on every rebind (three's ExternalTextures must follow). */
  readonly id: number;
}

export interface FlowComputeFrame {
  /** Simulated (dilated) seconds of this frame: the particles' step. */
  readonly dtSimS: number;
  readonly dtWallS: number;
  readonly particles: boolean;
  readonly gradient: boolean;
}

export interface FlowCompute {
  readonly count: number;
  /** The particle records (src/flow/viz/particleKernel.ts layout): three reads them. */
  readonly particleBuffer: GPUBuffer;
  /** (d g/dx, d g/dr, g, fluid) of the near field, rgba16float. */
  readonly gradient: GPUTexture;
  readonly binding: FlowFieldBinding | null;
  /** The solver's textures (same device), drawn as they are rewritten. */
  bindSolver(field: FlowField): FlowFieldBinding;
  /** A CPU field (the MOCK raster, a readback), uploaded into textures of our own. */
  bindCpu(field: CpuFlowField): FlowFieldBinding;
  /** Encodes and submits this frame's compute (before the render, so the frame sees it). */
  run(f: FlowComputeFrame): void;
  /** Median GPU ms of the compute pass over the last frames (null before one resolves). */
  medianMs(): number | null;
  /** Particles start over (a field switch: they were following the old one). */
  resetParticles(): void;
  /** A copy of the particle records (tests and look-dev inspection; waits for the GPU). */
  readParticles(): Promise<Float32Array>;
  dispose(): void;
}

const TIMED_WINDOW = 60;

export async function createFlowCompute(o: {
  readonly device: GPUDevice;
  readonly count: number;
  readonly zones: readonly SeedZone[];
  readonly lifeMinS: number;
  readonly lifeSpanS: number;
  readonly timestamps: boolean;
}): Promise<FlowCompute> {
  const { device } = o;
  const e: FieldExtent = FIELD_EXTENTS.near;
  const count = o.count;
  const particleBuffer = device.createBuffer({
    label: 'flow particles',
    size: initialParticles(count, 0).byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const resetParticles = () => {
    device.queue.writeBuffer(particleBuffer, 0, initialParticles(count, o.lifeMinS + o.lifeSpanS));
  };
  resetParticles();
  const params = device.createBuffer({
    label: 'flow particle params',
    size: PARTICLE_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const gradientParams = device.createBuffer({
    label: 'flow gradient params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    gradientParams,
    0,
    new Float32Array([
      e.width / (e.xMax - e.xMin),
      e.height / (e.rMax - e.rMin),
      e.width,
      e.height,
    ]),
  );
  const gradient = device.createTexture({
    label: 'flow density gradient',
    size: [e.width, e.height],
    format: FIELD_TEXTURE_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const [pModule, gModule] = await Promise.all([
    compileWgsl(device, particleKernelWgsl(), 'flow particles'),
    compileWgsl(device, gradientKernelWgsl(), 'flow gradient'),
  ]);
  const particlePipeline = device.createComputePipeline({
    label: 'flow particles',
    layout: 'auto',
    compute: { module: pModule, entryPoint: 'particleMain' },
  });
  const gradientPipeline = device.createComputePipeline({
    label: 'flow gradient',
    layout: 'auto',
    compute: { module: gModule, entryPoint: 'gradientMain' },
  });
  const ring = o.timestamps ? new TimestampRing(device, { slots: 4, pairs: 1 }) : null;
  const timed: number[] = [];

  let binding: FlowFieldBinding | null = null;
  let groups: { particles: GPUBindGroup; gradient: GPUBindGroup } | null = null;
  let owned: GPUTexture[] = [];
  let nextId = 1;
  let frame = 0;

  const bind = (b: Omit<FlowFieldBinding, 'id'>): FlowFieldBinding => {
    binding = { ...b, id: nextId++ };
    groups = {
      particles: device.createBindGroup({
        label: 'flow particles',
        layout: particlePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: b.near.velocity.createView() },
          { binding: 2, resource: { buffer: particleBuffer } },
        ],
      }),
      gradient: device.createBindGroup({
        label: 'flow gradient',
        layout: gradientPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: b.near.state.createView() },
          { binding: 1, resource: b.near.velocity.createView() },
          { binding: 2, resource: gradient.createView() },
          { binding: 3, resource: { buffer: gradientParams } },
        ],
      }),
    };
    return binding;
  };
  const dropOwned = () => {
    for (const t of owned) t.destroy();
    owned = [];
  };
  const upload = (data: Uint16Array, label: string): GPUTexture => {
    const t = device.createTexture({
      label,
      size: [e.width, e.height],
      format: FIELD_TEXTURE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: t }, data, { bytesPerRow: 8 * e.width }, [
      e.width,
      e.height,
    ]);
    return t;
  };

  return {
    count,
    particleBuffer,
    gradient,
    get binding() {
      return binding;
    },
    bindSolver(field) {
      const ext = field.extents.near;
      if (ext.width !== e.width || ext.height !== e.height)
        throw new Error('flow visuals: the solver near extent differs from FIELD_EXTENTS.near');
      // three may still sample our old textures in queued work: they go after the rebind
      const old = owned;
      owned = [];
      const b = bind({ source: field.source, reference: field.reference, near: field.near });
      for (const t of old) t.destroy();
      return b;
    },
    bindCpu(field) {
      const old = owned;
      owned = [
        upload(field.near.state, 'flow field state (cpu)'),
        upload(field.near.velocity, 'flow field velocity (cpu)'),
      ];
      const [state, velocity] = owned as [GPUTexture, GPUTexture];
      const b = bind({
        source: field.source,
        reference: field.reference,
        near: { state, velocity },
      });
      for (const t of old) t.destroy();
      return b;
    },
    run(f) {
      if (groups === null || (!f.particles && !f.gradient)) return;
      frame = (frame + 1) >>> 0;
      if (f.particles)
        device.queue.writeBuffer(
          params,
          0,
          packParticleParams({
            extent: e,
            dtSimS: f.dtSimS,
            dtWallS: f.dtWallS,
            lifeMinS: o.lifeMinS,
            lifeSpanS: o.lifeSpanS,
            count,
            frame,
            zones: o.zones,
          }),
        );
      const slot = ring?.acquire() ?? null;
      const enc = device.createCommandEncoder({ label: 'flow visuals' });
      const pass = enc.beginComputePass({
        label: 'Flow compute',
        ...(slot === null ? {} : { timestampWrites: slot.writes(0) }),
      });
      if (f.gradient) {
        pass.setPipeline(gradientPipeline);
        pass.setBindGroup(0, groups.gradient);
        pass.dispatchWorkgroups(
          Math.ceil(e.width / GRADIENT_WORKGROUP),
          Math.ceil(e.height / GRADIENT_WORKGROUP),
        );
      }
      if (f.particles) {
        pass.setPipeline(particlePipeline);
        pass.setBindGroup(0, groups.particles);
        pass.dispatchWorkgroups(Math.ceil(count / PARTICLE_WORKGROUP));
      }
      pass.end();
      slot?.resolve(enc);
      device.queue.submit([enc.finish()]);
      if (slot !== null)
        slot
          .read()
          .then(([ms]) => {
            if (ms !== undefined && Number.isFinite(ms)) {
              timed.push(ms);
              if (timed.length > TIMED_WINDOW) timed.shift();
            }
          })
          .catch((err: unknown) => {
            console.error('flow compute timestamps:', err);
          });
    },
    medianMs: () => (timed.length === 0 ? null : median(timed)),
    resetParticles,
    async readParticles() {
      const rb = device.createBuffer({
        label: 'flow particles read',
        size: particleBuffer.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(particleBuffer, 0, rb, 0, particleBuffer.size);
      device.queue.submit([enc.finish()]);
      try {
        await rb.mapAsync(GPUMapMode.READ);
        return new Float32Array(rb.getMappedRange().slice(0));
      } finally {
        rb.destroy();
      }
    },
    dispose() {
      dropOwned();
      particleBuffer.destroy();
      params.destroy();
      gradientParams.destroy();
      gradient.destroy();
      ring?.destroy();
    },
  };
}
