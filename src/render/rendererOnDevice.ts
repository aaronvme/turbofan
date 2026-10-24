// three r186 WebGPURenderer on a GPUDevice we created (src/gpu/device.ts), so the solver's raw
// WGSL and three's passes share one device and one queue. Measured behaviour this relies on
// (docs/GPU_FACTS.md, spike b; tests/browser/interop.test.ts):
// - `new WebGPURenderer({ device })` adopts the device; dispose() does not destroy it.
// - A core-feature-level device from Chrome has 'core-features-and-limits', so three stays out
//   of compatibility mode (which would disable MSAA). We check it anyway.
// - three *assigns* device.onuncapturederror (replacing any handler) and only logs; device loss
//   with reason 'destroyed' is ignored by three. Our addEventListener-based reporting in
//   src/gpu/device.ts is unaffected, so errors are never swallowed.
// - Queue order is the only ordering: submit solver compute before renderer.render() and that
//   frame sees it.
// - The GPUBuffer behind a StorageBufferAttribute is internal (`renderer.backend.get(attr)`),
//   which is why three stays pinned at 0.186.1.

import { WebGPURenderer, type BufferAttribute, type ComputeNode } from 'three/webgpu';

export interface RendererOnDeviceOptions {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly antialias?: boolean;
  /** three's own timestamp queries for its render passes. */
  readonly trackTimestamp?: boolean;
}

interface BackendInternals {
  readonly device?: GPUDevice;
  readonly compatibilityMode?: boolean;
  get(object: object): { buffer?: GPUBuffer };
}

function internals(renderer: WebGPURenderer): BackendInternals {
  return renderer.backend as unknown as BackendInternals;
}

export async function createRendererOnDevice(o: RendererOnDeviceOptions): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    device: o.device,
    canvas: o.canvas as HTMLCanvasElement,
    antialias: o.antialias ?? false,
    trackTimestamp: o.trackTimestamp ?? false,
  });
  await renderer.init();
  const backend = internals(renderer);
  if (backend.device !== o.device) {
    throw new Error('three did not adopt the supplied GPUDevice (WebGL fallback?)');
  }
  if (backend.compatibilityMode) {
    throw new Error('three is in WebGPU compatibility mode: request a core-feature-level device');
  }
  return renderer;
}

/** The GPUBuffer three created for a storage attribute (after its first render/compute). */
export function gpuBufferOf(renderer: WebGPURenderer, attribute: BufferAttribute): GPUBuffer {
  const buffer = internals(renderer).get(attribute).buffer;
  if (!buffer) throw new Error('GPU buffer not created yet: use the attribute in a pass first');
  return buffer;
}

/**
 * Makes three bind `buffer` for `attribute` instead of creating its own. Must run before the
 * attribute's first use; three's createAttribute() skips creation when a buffer is present.
 * Never set needsUpdate or DynamicDrawUsage on such an attribute: three would writeBuffer its
 * CPU array over the GPU data.
 */
export function injectGpuBuffer(
  renderer: WebGPURenderer,
  attribute: BufferAttribute,
  buffer: GPUBuffer,
): void {
  const data = internals(renderer).get(attribute);
  if (data.buffer && data.buffer !== buffer) {
    throw new Error('attribute already has a GPU buffer: inject before its first use');
  }
  data.buffer = buffer;
}

/**
 * renderer.compute() on an initialised renderer, as a statement. three returns a Promise only
 * when the renderer is not initialised yet, in which case the work would land in a later
 * frame; for solver/particle ordering that is a bug, so it throws instead.
 */
export function computeNow(renderer: WebGPURenderer, nodes: ComputeNode | ComputeNode[]): void {
  const pending = renderer.compute(nodes);
  if (pending !== undefined) {
    pending.catch(() => undefined);
    throw new Error('renderer.compute() before init(): the dispatch would be deferred');
  }
}
