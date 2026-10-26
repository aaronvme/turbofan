// Render hand-off (plan "GPU shape"): a raw compute pass that resamples the solver state into
// two rgba16float textures three samples from TSL. Texel (x, y) of an NI x NJ texture is
// logical cell (x, y); the real mesh will need a texel -> (cell, weights) map instead, which is
// what the per-texel index buffer stands in for.
//   A = ((p - pInf) / pInf, (rho - rhoInf) / rhoInf, u, v)    B = (w, T, Z, |V|)
// A holds the gauge ratios of D0-4: near freestream they are near 0, where rgba16float is
// fine-grained (1e-6 = 0.1 Pa), whereas p / pInf near 1 has an f16 step of ~50 Pa.
// T uses the linearised e(T) around the freestream (display only, no Newton).

import type { Freestream } from '../lib/gas';
import { GAS_R } from '../lib/gas';
import { cellIndex, cellMetrics, type Layout, type Nodes } from '../lib/mesh';

const RESAMPLE_WGSL = /* wgsl */ `
struct RP { rhoInf: f32, pInf: f32, h0Inf: f32, gasR: f32, tInf: f32, eInf: f32, cvInf: f32, pad: f32 }
@group(0) @binding(0) var<uniform> R: RP;
@group(0) @binding(1) var<storage, read> qa: array<vec4f>;
@group(0) @binding(2) var<storage, read> qb: array<vec4f>;
@group(0) @binding(3) var<storage, read> texel: array<vec2u>; // (cell, bits of rc)
@group(0) @binding(4) var outA: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outB: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let size = textureDimensions(outA);
  if (g.x >= size.x || g.y >= size.y) { return; }
  let m = texel[g.y * size.x + g.x];
  let a = qa[m.x];
  let b = qb[m.x];
  let rho = R.rhoInf + a.x;
  let u = a.y / rho;
  let v = a.z / rho;
  let w = a.w / (rho * bitcast<f32>(m.y));
  let q2 = u * u + v * v + w * w;
  let e = (b.x + rho * R.h0Inf - R.pInf) / rho - 0.5 * q2;
  let T = R.tInf + (e - R.eInf) / R.cvInf;
  let p = rho * R.gasR * T;
  textureStore(outA, g.xy, vec4f((p - R.pInf) / R.pInf, a.x / R.rhoInf, u, v));
  textureStore(outB, g.xy, vec4f(w, T, b.y / rho, sqrt(q2)));
}`;

export class FlowResample {
  readonly textureA: GPUTexture;
  readonly textureB: GPUTexture;
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly params: GPUBuffer;
  private readonly texel: GPUBuffer;
  private readonly groups = new Map<GPUBuffer, GPUBindGroup>();
  private readonly width: number;
  private readonly height: number;

  constructor(device: GPUDevice, nodes: Nodes, layout: Layout, inf: Freestream) {
    this.device = device;
    this.width = layout.NI;
    this.height = layout.NJ;
    const usage =
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    this.textureA = device.createTexture({
      label: 'flow A ((p-pInf)/pInf, (rho-rhoInf)/rhoInf, u, v)',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage,
    });
    this.textureB = device.createTexture({
      label: 'flow B (w, T, Z, |V|)',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage,
    });
    this.pipeline = device.createComputePipeline({
      label: 'flow resample',
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: RESAMPLE_WGSL, label: 'resample' }) },
    });
    this.params = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      this.params,
      0,
      new Float32Array([inf.rho, inf.p, inf.h0, GAS_R, inf.T, inf.e, inf.cv, 0]),
    );
    const map = new Uint32Array(2 * this.width * this.height);
    const f32 = new Float32Array(map.buffer);
    for (let J = 0; J < layout.NJ; J++) {
      for (let I = 0; I < layout.NI; I++) {
        const k = J * layout.NI + I;
        map[2 * k] = cellIndex(layout, I, J);
        f32[2 * k + 1] = cellMetrics(nodes, I, J).rc;
      }
    }
    this.texel = device.createBuffer({
      label: 'resample texel map',
      size: map.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.texel, 0, map);
  }

  /** Records the resample of state (a, b) into an open compute pass. */
  encode(pass: GPUComputePassEncoder, state: { a: GPUBuffer; b: GPUBuffer }): void {
    let group = this.groups.get(state.a);
    if (!group) {
      group = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.params } },
          { binding: 1, resource: { buffer: state.a } },
          { binding: 2, resource: { buffer: state.b } },
          { binding: 3, resource: { buffer: this.texel } },
          { binding: 4, resource: this.textureA.createView() },
          { binding: 5, resource: this.textureB.createView() },
        ],
      });
      this.groups.set(state.a, group);
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
  }

  destroy(): void {
    this.textureA.destroy();
    this.textureB.destroy();
    this.params.destroy();
    this.texel.destroy();
  }
}
