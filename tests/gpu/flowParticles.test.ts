// The flow visuals' compute kernels on Dawn (w2/flowviz round 2): the GPU particle step must
// be the TS step (src/flow/viz/particleKernel.ts stepParticle: advectParticle on sampleCpuField,
// the PCG respawns, the fades) on the MOCK takeoff raster, and the density-gradient kernel must
// be the central differences of the same texels.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../src/contracts/ambient';
import { fromHalfBits } from '../../src/contracts/half';
import { FIELD_EXTENTS, sampleCpuField, type CpuFieldTextures } from '../../src/contracts/flow';
import { ENGINE_DEFINITION } from '../../src/engine/definition';
import { compileWgsl } from '../../src/flow/gpu/device/gpuSolver';
import {
  GRADIENT_WORKGROUP,
  gradientKernelWgsl,
  initialParticles,
  packParticleParams,
  PARTICLE_FLOATS,
  PARTICLE_WORKGROUP,
  particleKernelWgsl,
  readParticle,
  stepParticle,
  type ParticleParams,
  type ParticleRecord,
} from '../../src/flow/viz/particleKernel';
import type { MeridionalSampler } from '../../src/flow/viz/particles';
import { flowSeedZones, hashRng } from '../../src/flow/viz/seeding';
import { seedParticle } from '../../src/flow/viz/particles';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import { mockSteadyState } from '../../src/mocks/mockCycle';
import { createMockFlowField } from '../../src/mocks/mockFlowField';
import { createDawnGpu } from './helpers/dawn';

const E = FIELD_EXTENTS.near;
const field = createMockFlowField(
  ENGINE_DEFINITION,
  mockSteadyState(ENGINE_DEFINITION, 1),
  ISA_SLS,
);
const zones = flowSeedZones(ENGINE_DEFINITION);
const sampler: MeridionalSampler = (x, r) => {
  const s = sampleCpuField(field.near, field.reference, x, r);
  return s === null
    ? null
    : { ux: s.uxMPerS, ur: s.urMPerS, ut: s.uthetaMPerS, fluid: s.fluidFraction };
};

function texture(device: GPUDevice, data: Uint16Array, usage = 0): GPUTexture {
  const t = device.createTexture({
    size: [E.width, E.height],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | usage,
  });
  device.queue.writeTexture({ texture: t }, data, { bytesPerRow: 8 * E.width }, [
    E.width,
    E.height,
  ]);
  return t;
}

async function readBuffer(device: GPUDevice, src: GPUBuffer, bytes: number): Promise<ArrayBuffer> {
  const rb = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, rb, 0, bytes);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const out = rb.getMappedRange().slice(0);
  rb.unmap();
  rb.destroy();
  return out;
}

/** A mix: live particles from every zone at every age, some near the field end, some unborn. */
function startRecords(n: number): Float32Array {
  const f = new Float32Array(PARTICLE_FLOATS * n);
  const rng = hashRng(99);
  for (let i = 0; i < n; i++) {
    const o = PARTICLE_FLOATS * i;
    const kind = i % 8;
    const s = seedParticle(rng, zones);
    const life = 2 + 2 * rng();
    // spread the live ones along the flowpath, so the step samples the whole engine
    const x = kind === 7 ? E.xMax - 0.01 * rng() : s.x + (E.xMax - 0.5 - s.x) * rng() * (kind % 2);
    f.set(
      [x, s.r, s.theta, kind === 6 ? -0.5 * rng() : kind === 5 ? life + 0.01 : life * rng()],
      o,
    );
    f.set([life, 0, 0, 0], o + 4);
  }
  return f;
}

describe('flow visual kernels on Dawn (MOCK takeoff field)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  beforeAll(async () => {
    sim = await requestSimDevice(createDawnGpu(), { onError: log.sink });
  });
  afterEach(() => {
    log.assertNone('flow kernels');
  });
  afterAll(() => {
    sim.destroy();
  });

  async function runParticles(start: Float32Array, steps: readonly ParticleParams[]) {
    const { device } = sim;
    const n = start.length / PARTICLE_FLOATS;
    const vel = texture(device, field.near.velocity);
    const buffer = device.createBuffer({
      size: start.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, start);
    const uniforms = device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const module = await compileWgsl(device, particleKernelWgsl(), 'flow particles');
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'particleMain' },
    });
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: vel.createView() },
        { binding: 2, resource: { buffer } },
      ],
    });
    for (const p of steps) {
      device.queue.writeBuffer(uniforms, 0, packParticleParams(p));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(n / PARTICLE_WORKGROUP));
      pass.end();
      device.queue.submit([enc.finish()]);
    }
    const out = new Float32Array(await readBuffer(device, buffer, start.byteLength));
    buffer.destroy();
    uniforms.destroy();
    vel.destroy();
    return out;
  }

  const params = (frame: number, n: number): ParticleParams => ({
    extent: E,
    dtSimS: 4e-4,
    dtWallS: 1 / 60,
    lifeMinS: 2.5,
    lifeSpanS: 1.5,
    count: n,
    frame,
    zones,
  });

  it('one GPU step is the TS step: advection, respawns and fades (f32 against f64)', async () => {
    const n = 4096;
    const start = startRecords(n);
    const got = await runParticles(start, [params(17, n)]);
    let advected = 0;
    let respawned = 0;
    let branch = 0;
    let maxPos = 0;
    let maxVel = 0;
    let maxAlpha = 0;
    for (let i = 0; i < n; i++) {
      const before = readParticle(start, i);
      const g = readParticle(got, i);
      const want = stepParticle(before, i, params(17, n), sampler);
      // the same branch: a respawn restarts the age at 0
      const wantRespawn = want.age === 0;
      if (wantRespawn !== (g.age === 0)) {
        branch++;
        continue;
      }
      if (before.age >= 0) {
        if (wantRespawn) respawned++;
        else advected++;
      }
      maxPos = Math.max(maxPos, Math.abs(g.x - want.x), Math.abs(g.r - want.r));
      const dTh = Math.abs(
        Math.atan2(Math.sin(g.theta - want.theta), Math.cos(g.theta - want.theta)),
      );
      maxPos = Math.max(maxPos, dTh * want.r);
      maxVel = Math.max(maxVel, ...g.vel.map((v, k) => Math.abs(v - (want.vel[k] ?? 0))));
      maxAlpha = Math.max(maxAlpha, Math.abs(g.alpha - want.alpha), Math.abs(g.life - want.life));
    }
    // f32 against f64 can only disagree on a test that lands within rounding of its threshold
    // (fluid fraction 0.5, the field's end): at most 1 in 1000
    expect(branch).toBeLessThanOrEqual(n / 1000);
    expect(advected).toBeGreaterThan(n / 4);
    expect(respawned).toBeGreaterThan(n / 20);
    // f32 positions at x ~ 5 m are good to ~5e-7 m, and the f32 bilinear weights (texel
    // coordinates ~1000, so ~6e-5 texel) move a sample by up to ~0.2 m/s at the sharpest shear
    // (measured 1.7e-6 m and 0.027 m/s; a 10 % swirl-step mutant gives 7e-3 m)
    expect(maxPos).toBeLessThan(1e-5);
    expect(maxVel).toBeLessThan(0.25);
    expect(maxAlpha).toBeLessThan(1e-4);
  });

  it('keeps every particle finite and alive over 300 steps (5 s of frames)', async () => {
    const n = 2048;
    const steps = Array.from({ length: 300 }, (_, k) => params(k, n));
    const got = await runParticles(initialParticles(n, 2, 3), steps);
    let visible = 0;
    let swirl = 0;
    for (let i = 0; i < n; i++) {
      const p: ParticleRecord = readParticle(got, i);
      for (const v of [p.x, p.r, p.theta, p.age, p.alpha, p.speed])
        expect(Number.isFinite(v)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(E.xMin);
      expect(p.x).toBeLessThanOrEqual(E.xMax);
      expect(p.r).toBeGreaterThanOrEqual(0);
      expect(Math.abs(p.theta)).toBeLessThanOrEqual(Math.PI + 1e-5);
      if (p.alpha > 0.05) visible++;
      // behind the fan the flow swirls: the 3D velocity has a part along e_theta
      const et = [0, -Math.sin(p.theta), Math.cos(p.theta)];
      const ut = p.vel[1] * (et[1] ?? 0) + p.vel[2] * (et[2] ?? 0);
      if (Math.abs(ut) > 5) swirl++;
    }
    expect(visible).toBeGreaterThan(n / 3);
    expect(swirl).toBeGreaterThan(0);
  });

  it('the gradient kernel gives the central differences of the density gauge, zero across walls', async () => {
    const { device } = sim;
    const st = texture(device, field.near.state);
    const vel = texture(device, field.near.velocity);
    const out = device.createTexture({
      size: [E.width, E.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const uni = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const dx = (E.xMax - E.xMin) / E.width;
    const dr = (E.rMax - E.rMin) / E.height;
    device.queue.writeBuffer(uni, 0, new Float32Array([1 / dx, 1 / dr, E.width, E.height]));
    const module = await compileWgsl(device, gradientKernelWgsl(), 'flow gradient');
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'gradientMain' },
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: st.createView() },
          { binding: 1, resource: vel.createView() },
          { binding: 2, resource: out.createView() },
          { binding: 3, resource: { buffer: uni } },
        ],
      }),
    );
    pass.dispatchWorkgroups(
      Math.ceil(E.width / GRADIENT_WORKGROUP),
      Math.ceil(E.height / GRADIENT_WORKGROUP),
    );
    pass.end();
    const bytesPerRow = 8 * E.width;
    const rb = device.createBuffer({
      size: bytesPerRow * E.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyTextureToBuffer({ texture: out }, { buffer: rb, bytesPerRow }, [E.width, E.height]);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const half = new Uint16Array(rb.getMappedRange().slice(0));
    rb.unmap();
    const at = (t: CpuFieldTextures['state'], i: number, j: number, c: number) =>
      fromHalfBits(t[4 * (j * E.width + i) + c] ?? 0);
    let checked = 0;
    let walls = 0;
    let maxRel = 0;
    let scale = 0;
    for (let j = 0; j < E.height; j += 7) {
      for (let i = 1; i < E.width - 1; i += 13) {
        const jm = j === 0 ? 0 : j - 1;
        const jp = Math.min(E.height - 1, j + 1);
        const fl = [
          at(field.near.velocity, i, j, 3),
          at(field.near.velocity, i - 1, j, 3),
          at(field.near.velocity, i + 1, j, 3),
          at(field.near.velocity, i, jm, 3),
          at(field.near.velocity, i, jp, 3),
        ];
        const gx = at(half, i, j, 0);
        const gr = at(half, i, j, 1);
        if ((fl[0] ?? 0) < 0.5 || (fl[1] ?? 0) < 0.5 || (fl[2] ?? 0) < 0.5) {
          expect(gx).toBe(0);
          walls++;
          continue;
        }
        const wantX =
          (at(field.near.state, i + 1, j, 1) - at(field.near.state, i - 1, j, 1)) / (2 * dx);
        const spanR = jp - (j - 1);
        const wantR =
          (fl[3] ?? 0) < 0.5 || (fl[4] ?? 0) < 0.5
            ? 0
            : (at(field.near.state, i, jp, 1) - at(field.near.state, i, jm, 1)) / (spanR * dr);
        scale = Math.max(scale, Math.abs(wantX), Math.abs(wantR));
        maxRel = Math.max(maxRel, Math.abs(gx - wantX), Math.abs(gr - wantR));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(walls).toBeGreaterThan(0);
    expect(scale).toBeGreaterThan(0.1);
    // the store is f16 (truncating, 2^-10 relative) of an f32 difference of f16 inputs
    expect(maxRel).toBeLessThan(2e-3 * scale);
    for (const b of [rb, uni]) b.destroy();
    for (const t of [st, vel, out]) t.destroy();
  });
});
