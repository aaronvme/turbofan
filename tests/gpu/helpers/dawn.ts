import { create, globals } from 'webgpu';

// Dawn's node bindings (`webgpu@0.6.2`). The WebGPU enums (GPUBufferUsage, GPUMapMode,
// GPUShaderStage, ...) are not globals in Node, so install them once per worker.
Object.assign(globalThis, globals);

/**
 * A `GPU` object backed by Dawn. On Windows Dawn picks D3D12 (docs/GPU_FACTS.md). Keep the
 * returned object only as long as its devices: dawn.node keeps the process alive while the
 * object is referenced and a device is live.
 */
export function createDawnGpu(flags: readonly string[] = []): GPU {
  return create([...flags]);
}
