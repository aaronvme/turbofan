import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DynamicDrawUsage,
  ExternalTexture,
  FloatType,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  StorageBufferAttribute,
  type WebGPURenderer,
} from 'three/webgpu';
import { Fn, instanceIndex, int, ivec2, storage, texture, textureLoad, uv, vec2 } from 'three/tsl';
import { GpuErrorLog, requestSimDevice, type SimDevice } from '../../src/gpu/device';
import {
  createRendererOnDevice,
  gpuBufferOf,
  injectGpuBuffer,
} from '../../src/render/rendererOnDevice';

// Spike (b): one GPUDevice shared by raw WGSL compute and three r186 (WebGPURenderer, TSL).
// Each test pins one fact recorded in docs/GPU_FACTS.md.

const W = 16;
const H = 16;

// Writes (x/16, y/16, k, 1): exact in f16, so the read-back values can be compared exactly.
const WRITE_TEXTURE = /* wgsl */ `
@group(0) @binding(0) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> k: vec4f;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let size = textureDimensions(dst);
  if (g.x >= size.x || g.y >= size.y) { return; }
  textureStore(dst, g.xy, vec4f(f32(g.x) / 16.0, f32(g.y) / 16.0, k.x, 1.0));
}`;

// Raw compute writing into a buffer three owns: v[i] = (i, 2i, 3i, 4i).
const WRITE_BUFFER = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> v: array<vec4f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= arrayLength(&v)) { return; }
  let i = f32(g.x);
  v[g.x] = vec4f(i, 2.0 * i, 3.0 * i, 4.0 * i);
}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spike (b): our GPUDevice shared with three r186', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;
  let renderer: WebGPURenderer;
  let canvas: HTMLCanvasElement;
  let flowTex: GPUTexture;
  let writeTex: (k: number) => void;

  beforeAll(async () => {
    sim = await requestSimDevice(navigator.gpu, {
      powerPreference: 'high-performance',
      optionalFeatures: 'all',
      maxLimits: ['maxComputeWorkgroupStorageSize', 'maxStorageBuffersPerShaderStage'],
      onError: log.sink,
    });
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    document.body.append(canvas);
    renderer = await createRendererOnDevice({ device: sim.device, canvas });
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;

    const { device } = sim;
    flowTex = device.createTexture({
      label: 'flow (raw)',
      size: [W, H],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: WRITE_TEXTURE }) },
    });
    const kBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: flowTex.createView() },
        { binding: 1, resource: { buffer: kBuf } },
      ],
    });
    writeTex = (k: number) => {
      device.queue.writeBuffer(kBuf, 0, new Float32Array([k, 0, 0, 0]));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(W / 8, H / 8);
      pass.end();
      device.queue.submit([enc.finish()]);
    };
  });

  afterEach(async () => {
    await sim.device.queue.onSubmittedWorkDone();
    log.assertNone('interop');
  });

  afterAll(async () => {
    await renderer.dispose();
    flowTex.destroy();
    sim.destroy();
    canvas.remove();
  });

  function planeScene(ext: ExternalTexture) {
    const scene = new Scene();
    const material = new MeshBasicNodeMaterial();
    material.colorNode = texture(ext, uv());
    scene.add(new Mesh(new PlaneGeometry(2, 2), material));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    camera.position.z = 1;
    const target = new RenderTarget(W, H, { type: FloatType, depthBuffer: false });
    return { scene, camera, target };
  }

  async function renderAndRead(ext: ExternalTexture, preRender?: () => void) {
    const { scene, camera, target } = planeScene(ext);
    preRender?.();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    return { target, read: () => renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H) };
  }

  function nearestExternal(): ExternalTexture {
    const ext = new ExternalTexture(flowTex);
    ext.minFilter = NearestFilter;
    ext.magFilter = NearestFilter;
    ext.generateMipmaps = false;
    return ext;
  }

  it('three adopts the supplied device in core mode (not compatibility mode)', () => {
    const backend = renderer.backend as unknown as {
      device: GPUDevice;
      compatibilityMode: boolean;
    };
    expect(backend.device).toBe(sim.device);
    expect(backend.compatibilityMode).toBe(false);
    expect(sim.device.features.has('core-features-and-limits')).toBe(true);
  });

  it('raw WGSL -> rgba16float GPUTexture -> TSL material on a plane: the pixels are the written values', async () => {
    writeTex(0.25);
    const { read } = await renderAndRead(nearestExternal());
    const px = (await read()) as Float32Array;
    // Find the row orientation once, then require every pixel to match it exactly.
    const flipped = px[1] !== 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = 4 * (y * W + x);
        const ty = flipped ? H - 1 - y : y;
        expect([px[k], px[k + 1], px[k + 2], px[k + 3]]).toEqual([x / 16, ty / 16, 0.25, 1]);
      }
    }
  });

  it('a TSL compute particle pass samples the same texture (sampler at texel centres, and textureLoad)', async () => {
    writeTex(0.5);
    const n = W * H;
    const sampled = new StorageBufferAttribute(new Float32Array(4 * n), 4);
    const loaded = new StorageBufferAttribute(new Float32Array(4 * n), 4);
    const ext = nearestExternal();
    const pass = Fn(() => {
      const i = int(instanceIndex);
      const x = i.mod(W);
      const y = i.div(W);
      // A particle at the texel centre samples the flow field, as the particle system will.
      const p = vec2(x.toFloat().add(0.5).div(W), y.toFloat().add(0.5).div(H));
      storage(sampled, 'vec4', n).element(instanceIndex).assign(texture(ext, p).level(0));
      storage(loaded, 'vec4', n).element(instanceIndex).assign(textureLoad(ext, ivec2(x, y)));
    })().compute(n);
    renderer.compute(pass);
    const s = new Float32Array(await renderer.getArrayBufferAsync(sampled));
    const l = new Float32Array(await renderer.getArrayBufferAsync(loaded));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = 4 * (y * W + x);
        expect([l[k], l[k + 1], l[k + 2], l[k + 3]]).toEqual([x / 16, y / 16, 0.5, 1]);
        expect([s[k], s[k + 1], s[k + 2], s[k + 3]]).toEqual([x / 16, y / 16, 0.5, 1]);
      }
    }
  });

  it('queue order: compute submitted before render() is seen by that frame; submitted after, it is not', async () => {
    const ext = nearestExternal();
    for (const k of [0.125, 0.375]) {
      const { read } = await renderAndRead(ext, () => {
        writeTex(k);
      });
      expect((await read())[2]).toBe(k);
    }
    // Render first, then write: the frame shows the previous value.
    const { read } = await renderAndRead(ext);
    writeTex(0.75);
    expect((await read())[2]).toBe(0.375);
  });

  it('three never uploads over an ExternalTexture we write (texture still holds our data after renders)', async () => {
    writeTex(0.625);
    const ext = nearestExternal();
    for (let f = 0; f < 5; f++) await renderAndRead(ext);
    const staging = sim.device.createBuffer({
      size: 256 * H,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = sim.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: flowTex }, { buffer: staging, bytesPerRow: 256 }, [W, H]);
    sim.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const half = new Uint16Array(staging.getMappedRange().slice(0));
    staging.destroy();
    // f16 0.625 = 0x3900, 1.0 = 0x3C00 in the b and a channels of texel (0, 0).
    expect([half[2], half[3]]).toEqual([0x3900, 0x3c00]);
  });

  it('a StorageBufferAttribute GPUBuffer exists only after first use; raw writes to it survive until needsUpdate (or DynamicDrawUsage) re-uploads the CPU array', async () => {
    const n = 64;
    const attr = new StorageBufferAttribute(new Float32Array(4 * n), 4);
    const out = new StorageBufferAttribute(new Float32Array(4 * n), 4);
    const copy = Fn(() => {
      storage(out, 'vec4', n)
        .element(instanceIndex)
        .assign(storage(attr, 'vec4', n).toReadOnly().element(instanceIndex));
    })().compute(n);
    expect(() => gpuBufferOf(renderer, attr)).toThrow(/not created yet/);
    renderer.compute(copy); // three creates both buffers here (zeros)
    const buffer = gpuBufferOf(renderer, attr);

    const { device } = sim;
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: WRITE_BUFFER }) },
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }],
      }),
    );
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([enc.finish()]);

    for (let f = 0; f < 3; f++) renderer.compute(copy);
    let v = new Float32Array(await renderer.getArrayBufferAsync(out));
    expect([v[4 * 7], v[4 * 7 + 3]]).toEqual([7, 28]);

    attr.needsUpdate = true; // three re-uploads the (zero) CPU array on next use
    renderer.compute(copy);
    v = new Float32Array(await renderer.getArrayBufferAsync(out));
    expect([v[4 * 7], v[4 * 7 + 3]]).toEqual([0, 0]);

    attr.setUsage(DynamicDrawUsage); // ...and with DynamicDrawUsage on every use
    attr.array[4 * 7] = 99;
    renderer.compute(copy);
    v = new Float32Array(await renderer.getArrayBufferAsync(out));
    expect(v[4 * 7]).toBe(99);
  });

  it('pre-seeding the backend entry with our own GPUBuffer makes three bind it instead of creating one', async () => {
    const n = 64;
    const own = sim.device.createBuffer({
      size: 16 * n,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    sim.device.queue.writeBuffer(own, 0, Float32Array.from({ length: 4 * n }, (_, i) => i));
    const attr = new StorageBufferAttribute(new Float32Array(4 * n), 4);
    injectGpuBuffer(renderer, attr, own);
    const out = new StorageBufferAttribute(new Float32Array(4 * n), 4);
    renderer.compute(
      Fn(() => {
        storage(out, 'vec4', n)
          .element(instanceIndex)
          .assign(storage(attr, 'vec4', n).toReadOnly().element(instanceIndex));
      })().compute(n),
    );
    expect(gpuBufferOf(renderer, attr)).toBe(own);
    const v = new Float32Array(await renderer.getArrayBufferAsync(out));
    expect(v[4 * 9 + 2]).toBe(4 * 9 + 2);
    own.destroy();
  });

  it('pads itemSize-3 storage attributes to 4 and replaces the attribute array', () => {
    const attr = new StorageBufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3);
    const sink = new StorageBufferAttribute(new Float32Array(12), 4);
    renderer.compute(
      Fn(() => {
        storage(sink, 'vec4', 3)
          .element(instanceIndex)
          .assign(storage(attr, 'vec3', 3).element(instanceIndex).xyzz);
      })().compute(3),
    );
    expect(attr.itemSize).toBe(4);
    expect(attr.array).toHaveLength(12);
    expect(Array.from(attr.array.slice(4, 8))).toEqual([4, 5, 6, 0]);
  });

  it('a storage buffer read in a vertex shader needs no toReadOnly(): three emits var<storage, read> outside compute', async () => {
    const n = 4;
    const attr = new StorageBufferAttribute(
      new Float32Array([-1, -1, 0, 1, 3, -1, 0, 1, -1, 3, 0, 1, 0, 0, 0, 1]),
      4,
    );
    const material = new MeshBasicNodeMaterial();
    material.positionNode = storage(attr, 'vec4', n).element(instanceIndex).xyz; // READ_WRITE by default
    const scene = new Scene();
    scene.add(new Mesh(new PlaneGeometry(2, 2), material));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
    camera.position.z = 1;
    const target = new RenderTarget(W, H, { type: FloatType, depthBuffer: false });
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    await sim.device.queue.onSubmittedWorkDone();
    await sleep(50);
    expect(log.reports).toEqual([]); // no "read_write storage in vertex stage" validation error
  });

  it('uncaptured errors reach our listener although three replaced device.onuncapturederror; three logs them too', async () => {
    const threeSaw: string[] = [];
    const previous = renderer.onError;
    renderer.onError = (info: { message: string }) => {
      threeSaw.push(info.message);
    };
    sim.device.createBuffer({ size: 16, usage: 0 });
    await sim.device.queue.onSubmittedWorkDone();
    await sleep(50);
    renderer.onError = previous;
    expect(log.reports.map((r) => r.kind)).toEqual(['validation']);
    expect(threeSaw).toHaveLength(1);
    log.clear();
  });
});

describe('spike (b): device lifetime with three', () => {
  it('three replaces a pre-set onuncapturederror; dispose() leaves a supplied device alive; an unexpected destroy reaches our sink and not three', async () => {
    const log = new GpuErrorLog();
    const sim = await requestSimDevice(navigator.gpu, { onError: log.sink });
    const marker = () => undefined;
    sim.device.onuncapturederror = marker;
    const canvas = document.createElement('canvas');
    const r = await createRendererOnDevice({ device: sim.device, canvas });
    expect(sim.device.onuncapturederror).not.toBe(marker);

    let threeLost = 0;
    r.onDeviceLost = () => {
      threeLost++;
    };
    await r.dispose();
    const probe = sim.device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
    sim.device.queue.writeBuffer(probe, 0, new Float32Array(4));
    await sim.device.queue.onSubmittedWorkDone();
    await sleep(100);
    expect(log.reports).toEqual([]); // still alive after dispose()

    sim.device.destroy(); // not through sim.destroy(): unexpected for our sink
    await sleep(100);
    expect(log.reports).toEqual([
      { kind: 'device-lost', reason: 'destroyed', message: expect.any(String) as string },
    ]);
    expect(threeLost).toBe(0); // three ignores reason 'destroyed'
  });

  it('rgba32float with a filtering sampler needs float32-filterable', async () => {
    const results: Record<string, boolean> = {};
    for (const withFeature of [false, true]) {
      const log = new GpuErrorLog();
      const sim = await requestSimDevice(navigator.gpu, {
        optionalFeatures: withFeature ? ['float32-filterable'] : [],
        onError: log.sink,
      });
      const { device } = sim;
      device.pushErrorScope('validation');
      const layout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
      });
      const tex = device.createTexture({
        size: [4, 4],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      });
      device.createBindGroup({ layout, entries: [{ binding: 0, resource: tex.createView() }] });
      results[String(withFeature)] = (await device.popErrorScope()) === null;
      tex.destroy();
      sim.destroy();
    }
    expect(results).toEqual({ false: false, true: true });
  });
});
