import { create, globals } from 'webgpu';

// Dawn's node bindings (`webgpu@0.6.2`). The WebGPU enums (GPUBufferUsage, GPUMapMode,
// GPUShaderStage, ...) are not globals in Node, so install them once per worker.
Object.assign(globalThis, globals);

/**
 * Dawn quantizes timestamp queries to 2^16 ns unless this toggle is off (measured,
 * docs/GPU_FACTS.md). Solver timing tests want the full resolution.
 */
export const DAWN_EXACT_TIMESTAMPS: readonly string[] = [
  'disable-dawn-features=timestamp_quantization',
];

/**
 * A `GPU` object backed by Dawn. On Windows Dawn picks D3D12 (docs/GPU_FACTS.md). Keep the
 * returned object referenced for as long as any of its devices lives: dawn.node segfaults if
 * it is garbage-collected first (SimDevice holds it). A live device does not keep the process
 * alive (spikes/dawn/exit-probe.ts).
 */
export function createDawnGpu(flags: readonly string[] = []): GPU {
  return create([...flags]);
}
