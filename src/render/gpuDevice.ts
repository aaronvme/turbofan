// Our own GPUDevice for three's WebGPURenderer (`new WebGPURenderer({ device })`), worker-safe.
//
// docs/GPU_FACTS.md (w0/gpu-spikes M15-M17): three adopts a supplied device and never destroys
// it; it ASSIGNS device.onuncapturederror (replacing ours) and only logs, so errors are taken
// with addEventListener, which it cannot clobber; it ignores a loss with reason 'destroyed'.
// Nothing here swallows an error: every report reaches the sink. When w0/gpu-spikes merges,
// src/gpu/device.ts (requestSimDevice) supersedes this file.

export type GpuErrorKind = 'validation' | 'out-of-memory' | 'internal' | 'unknown' | 'device-lost';

export interface GpuErrorReport {
  readonly kind: GpuErrorKind;
  readonly message: string;
}

export interface EngineDevice {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  /** Every report so far (tests assert it stays empty). */
  readonly errors: readonly GpuErrorReport[];
  destroy(): void;
}

function kindOf(error: GPUError): GpuErrorKind {
  switch (error.constructor.name) {
    case 'GPUValidationError':
      return 'validation';
    case 'GPUOutOfMemoryError':
      return 'out-of-memory';
    case 'GPUInternalError':
      return 'internal';
    default:
      return 'unknown';
  }
}

/** Requests an adapter and a device, with error and loss reporting attached. */
export async function createEngineDevice(
  gpu: GPU,
  onError: (r: GpuErrorReport) => void = (r) => {
    console.error(`[gpu ${r.kind}] ${r.message}`);
  },
): Promise<EngineDevice> {
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (adapter === null) throw new Error('WebGPU: no adapter');
  const wanted: GPUFeatureName[] = ['float32-filterable', 'timestamp-query'];
  const requiredFeatures = wanted.filter((f) => adapter.features.has(f));
  // the scene pass writes 3 rgba16float targets (colour, normal, velocity): 24 B/sample
  const requiredLimits: Record<string, number> = {
    maxColorAttachmentBytesPerSample: adapter.limits.maxColorAttachmentBytesPerSample,
  };
  const device = await adapter.requestDevice({
    label: 'turbofan-render',
    requiredFeatures,
    requiredLimits,
  });
  const errors: GpuErrorReport[] = [];
  const report = (r: GpuErrorReport) => {
    errors.push(r);
    onError(r);
  };
  let destroying = false;
  device.addEventListener('uncapturederror', (ev) => {
    report({ kind: kindOf(ev.error), message: ev.error.message });
  });
  void device.lost.then((info) => {
    if (info.reason === 'destroyed' && destroying) return;
    report({ kind: 'device-lost', message: `${info.reason}: ${info.message}` });
  });
  return {
    adapter,
    device,
    errors,
    destroy: () => {
      destroying = true;
      device.destroy();
    },
  };
}
